/**
 * The Guide's answer to a Visitor question (the only AI step of AI Tour, ADR 0011).
 * Context = the Current Station (where the Guide stands in the Map) + chunks retrieved from the Map's documents.
 * The model must answer only from those chunks and name the Stations it talks about, so the Guide can point at them.
 */
import { retrieve } from './knowledge.mjs';

const MAX_QUESTION = 500;

const nameIn = (station, lang) => (lang === 'en' && station.nameEn ? station.nameEn : station.name);

export function buildMessages({ map, question, lang, current, chunks }) {
  const english = lang === 'en';
  const stations = map.stations.map(station => `- ${station.id}: ${station.name}${station.nameEn ? ` / ${station.nameEn}` : ''}`).join('\n');
  const context = chunks.length
    ? chunks.map((chunk, i) => `[${i + 1}] (${chunk.source}${chunk.station ? `, station ${chunk.station}` : ''}) ${chunk.heading ? `${chunk.heading}: ` : ''}${chunk.text}`).join('\n\n')
    : '(no documents)';
  const system = [
    `You are the tour guide of "${english && map.nameEn ? map.nameEn : map.name}". You stand next to the visitor inside a 3D model of the site.`,
    `Answer in ${english ? 'English' : 'Thai, polite, ending with ครับ'}, in at most 3 short spoken sentences, because your answer is read aloud.`,
    'Use ONLY the facts in DOCUMENTS. Never invent dates, names, numbers or services.',
    `If DOCUMENTS do not mention the thing asked about, you do not know whether it exists: start the answer with "${english ? "I don't have information about that yet." : 'ผมยังไม่มีข้อมูลเรื่องนี้ครับ'}" and never say it exists or does not exist. Then say what DOCUMENTS do tell about this place, if anything.`,
    'Never send the visitor to another Station unless DOCUMENTS say that Station has the thing asked about.',
    'If DOCUMENTS do answer, give that answer only: never add the no-information sentence after it.',
    current ? `The visitor and you are now at Station "${current.id}" (${nameIn(current, lang)}). "Here"/"this place"/"ที่นี่" means this Station.` : 'You are not at any Station right now.',
    // Plain text, not JSON, so the answer can be shown word by word while it is written (spec R11.2).
    'Write only the spoken answer, no JSON, no markdown. Then, on a new last line, write "STATIONS:" and the ids of the Stations your answer talks about, separated by commas, from STATIONS only (leave it empty if none).',
    `STATIONS:\n${stations}`
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `DOCUMENTS:\n${context}\n\nQUESTION: ${question}` }
  ];
}

const MARKER = 'STATIONS:';
const markerAt = text => text.search(/\n?[ \t]*STATIONS[ \t]*:/);

export function parseAnswer(raw, map, lang = 'th') {
  const ids = new Set(map.stations.map(station => station.id));
  let parsed;
  const at = markerAt(raw);
  if (at !== -1) parsed = { answer: raw.slice(0, at), stations: raw.slice(at).replace(/^[\s\S]*?STATIONS[ \t]*:/, '').split(/[,\s]+/).filter(Boolean) };
  else try { parsed = JSON.parse(raw); } catch { parsed = { answer: raw }; }
  let answer = String(parsed.answer ?? '').trim() || String(raw).trim();
  // The model sometimes writes a Station id ("canal-houses"); a Visitor should read its name.
  for (const station of map.stations) {
    const name = lang === 'en' ? station.nameEn ?? station.name : station.name;
    answer = answer.replace(new RegExp(`['"‘’“”]?\\b${station.id.replace(/[-]/g, '\\-')}\\b['"‘’“”]?`, 'g'), name);
  }
  const stations = [...new Set(Array.isArray(parsed.stations) ? parsed.stations.filter(id => ids.has(id)) : [])];
  return { answer, stations };
}

/** Longest end of `text` that could be the start of the STATIONS line: held back until we know. */
function heldBack(text) {
  for (let size = Math.min(text.length, MARKER.length + 2); size > 0; size -= 1) {
    const tail = text.slice(-size).replace(/^\n?[ \t]*/, '');
    if (MARKER.startsWith(tail) && (tail.length > 0 || text.slice(-size).includes('\n'))) return size;
  }
  return 0;
}

/**
 * The Guide's answer as events (spec R11.2): { type: 'queued', position } when every AI slot is busy,
 * { type: 'text', delta } while the answer is written, then { type: 'done', answer, stations, stationId, sources, ... }.
 */
export async function* streamGuide({ map, index, chat, router = null, question, stationId = null, lang = 'th' }) {
  const text = String(question ?? '').trim();
  if (!text) throw Object.assign(new Error('ไม่มีคำถาม'), { status: 400 });
  if (text.length > MAX_QUESTION) throw Object.assign(new Error(`คำถามยาวเกิน ${MAX_QUESTION} ตัวอักษร`), { status: 400 });
  const current = map.stations.find(station => station.id === stationId) ?? null;
  const routed = performance.now();
  if (router && await router.isOfftopic(text)) {
    const reply = await router.offtopicReply(text, lang).catch(() => null);
    if (reply) {
      const ms = Math.round(performance.now() - routed);
      yield { type: 'text', delta: reply.trim() };
      yield { type: 'done', route: 'offtopic', answer: reply.trim(), stations: [], stationId: current?.id ?? null, model: router.model, sources: [], firstTextMs: ms, llmMs: ms };
      return;
    }
  }
  const routerMs = router ? Math.round(performance.now() - routed) : 0;
  const chunks = retrieve(index, `${text} ${current ? `${current.name} ${current.nameEn ?? ''}` : ''}`, { stationId: current?.id });
  const messages = buildMessages({ map, question: text, lang, current, chunks });
  const started = performance.now();
  // The AI call runs in the background and feeds a small inbox, so a queue position is passed on at once
  // instead of waiting for the first word.
  const inbox = [];
  let wake = null;
  const push = event => { inbox.push(event); wake?.(); };
  const pieces = chat.stream
    ? chat.stream(messages, { onQueue: position => push({ queued: position }) })
    : (async function* () { yield await chat.chat(messages); })(); // adapters without streaming
  (async () => { for await (const piece of pieces) push({ piece }); push({ end: true }); })().catch(error => push({ error }));
  let raw = '';
  let shown = 0;
  let firstTextMs = null;
  for (;;) {
    if (!inbox.length) await new Promise(resolve => { wake = resolve; });
    wake = null;
    const event = inbox.shift();
    if (event.error) throw event.error;
    if (event.end) break;
    if (event.queued) { yield { type: 'queued', position: event.queued }; continue; }
    raw += event.piece;
    const at = markerAt(raw);
    const end = at !== -1 ? at : raw.length - heldBack(raw);
    let delta = raw.slice(shown, end);
    if (!shown) delta = delta.trimStart();
    if (delta) { firstTextMs ??= Math.round(performance.now() - started); yield { type: 'text', delta }; }
    shown = Math.max(shown, end);
  }
  const { answer, stations } = parseAnswer(raw, map, lang);
  const noInformation = /^(ผมยังไม่มีข้อมูล|I don't have information)/i.test(answer); // nothing was used, so nothing to cite
  yield {
    type: 'done', route: 'big', answer, stations, stationId: current?.id ?? null, model: chat.model, routerMs,
    sources: noInformation ? [] : chunks.map(({ source, station, heading, links }) => ({ source, station, heading, links })),
    firstTextMs, llmMs: Math.round(performance.now() - started)
  };
}

/** The whole answer at once (for scripts and clients that do not read the stream). */
export async function askGuide(options) {
  let done;
  for await (const event of streamGuide(options)) if (event.type === 'done') done = event;
  const { type, ...answer } = done;
  return answer;
}
