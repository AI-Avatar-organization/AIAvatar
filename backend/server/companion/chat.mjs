/**
 * LLM adapter (ADR 0005): local Ollama /api/chat with thinking off. Swap this file to change provider;
 * callers only see chat() (whole reply) and stream() (reply piece by piece, spec R11.2).
 */
const DEFAULT_MODEL = 'qwen3:4b-instruct-2507-q4_K_M';

export function createChat({
  baseUrls = (process.env.OLLAMA_BASE_URLS ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').split(',').map(url => url.trim()).filter(Boolean),
  model = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL,
  // The F5 voice model and the STT workers share the same 16 GiB Mac (ADR 0010), but reloading the model costs
  // about 7 s on the next question; 15 minutes covers the pauses of a walk between Stations.
  keepAlive = process.env.OLLAMA_KEEP_ALIVE ?? '15m',
  // Questions one endpoint answers at the same time: set the same value as the Ollama server's OLLAMA_NUM_PARALLEL.
  parallel = Number(process.env.OLLAMA_NUM_PARALLEL ?? 1),
  timeoutMs = 60_000,
  fetchImpl = fetch
} = {}) {
  const urls = baseUrls.map(url => url.replace(/\/$/, ''));
  // Slots (spec R11.3): each endpoint answers `parallel` questions at once; a new question goes to the least busy one.
  // When all are busy the question waits here, and the asker is told its place in line at once (never a silent wait).
  const busy = urls.map(() => 0);
  const waiting = [];
  const freeEndpoint = () => {
    let best = -1;
    busy.forEach((count, i) => { if (count < parallel && (best === -1 || count < busy[best])) best = i; });
    return best;
  };
  async function acquire(onQueue) {
    let index = freeEndpoint();
    if (index === -1) {
      index = await new Promise(resolve => { waiting.push(resolve); onQueue?.(waiting.length); });
    }
    busy[index] += 1;
    return index;
  }
  function release(index) {
    busy[index] -= 1;
    const next = waiting.shift();
    if (next) next(index);
  }
  const failed = error => {
    if (error.name === 'AbortError') return Object.assign(new Error('AI ตอบช้าเกินกำหนด'), { status: 504 });
    if (error.status) return error;
    return Object.assign(new Error('ติดต่อ AI ไม่ได้ ตรวจสอบว่า Ollama ทำงานอยู่'), { status: 503, cause: error });
  };

  async function post(url, messages, { json, maxTokens, stream }, signal) {
    const response = await fetchImpl(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream, think: false, keep_alive: keepAlive,
        ...(json ? { format: 'json' } : {}),
        options: { num_ctx: 8192, num_predict: maxTokens, temperature: 0.2, seed: 42 } }),
      signal
    });
    if (!response.ok) throw Object.assign(new Error('AI ตอบกลับไม่สำเร็จ ตรวจสอบว่า Ollama ทำงานอยู่'), { status: 502 });
    return response;
  }

  return {
    model,
    /** How busy the endpoints are now (for status and the Benchmark). */
    load: () => ({ busy: busy.reduce((sum, count) => sum + count, 0), slots: urls.length * parallel, waiting: waiting.length }),
    /** Load the model into memory in the background so the first question does not pay the load time. */
    warm() {
      for (const url of urls) {
        fetchImpl(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          // One real token, not just a load: the first generation after a load also pays ~6 s of GPU setup.
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'สวัสดี' }], stream: false, think: false,
            keep_alive: keepAlive, options: { num_predict: 1 } }) }).catch(() => {});
      }
    },
    async chat(messages, { json = false, maxTokens = 400 } = {}) {
      const slot = await acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await post(urls[slot], messages, { json, maxTokens, stream: false }, controller.signal);
        const result = await response.json();
        const content = result.message?.content?.trim();
        if (!content) throw Object.assign(new Error('AI ไม่ได้ส่งคำตอบกลับมา'), { status: 502 });
        return content;
      } catch (error) {
        throw failed(error);
      } finally {
        clearTimeout(timer);
        release(slot);
      }
    },
    /** The reply as it is written: yields text pieces. */
    async *stream(messages, { maxTokens = 400, onQueue } = {}) {
      const slot = await acquire(onQueue);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await post(urls[slot], messages, { json: false, maxTokens, stream: true }, controller.signal);
        const decoder = new TextDecoder();
        let buffered = '';
        for await (const bytes of response.body) {
          buffered += decoder.decode(bytes, { stream: true });
          let newline;
          while ((newline = buffered.indexOf('\n')) !== -1) {
            const line = buffered.slice(0, newline).trim();
            buffered = buffered.slice(newline + 1);
            if (!line) continue;
            const piece = JSON.parse(line);
            if (piece.error) throw Object.assign(new Error(`AI: ${piece.error}`), { status: 502 });
            if (piece.message?.content) yield piece.message.content;
          }
        }
      } catch (error) {
        throw failed(error);
      } finally {
        clearTimeout(timer);
        release(slot);
      }
    }
  };
}
