/**
 * Voice Command parser (ADR 0002): transcript → ordered Intents, keyword/regex + fuzzy match.
 * Pure and shared by browser and tests. Vocabulary comes from the active Map and Gesture Library.
 *
 * vocabulary = { stations: [{id, name, aliases}], gestures: [{id, name, aliases}] }
 * returns { intents: Intent[] } where Intent is
 *   { type: 'goto', stationId, matched, score } | { type: 'goto', stationId: null, reason: 'unknown-station', query }
 *   { type: 'gesture', gestureId, matched } | { type: 'stop' } | { type: 'ask', text }
 */

// Polite particles are only stripped at the end of a clause so station names keep their letters.
const POLITE = /(?:\s*(?:ครับผม|ครับ|คับ|ค่ะ|คะ|ค่า|นะคะ|นะครับ|นะ|หน่อย|ด้วย|จ้า|จ้ะ|please|pls))+$/;
const GOTO_VERBS = ['พาฉันไปที่', 'พาผมไปที่', 'พาไปที่', 'เดินไปที่', 'ไปที่', 'ไปยัง', 'พาไป', 'เดินไป', 'วิ่งไป', 'ไปหา', 'ไปดู', 'ไป',
  'takemeto', 'bringmeto', 'walkto', 'workto', 'wokto', 'goto', 'headto', 'moveto', 'navigateto', 'runto', 'gotothe', 'go'];
const STOP_WORDS = ['หยุด', 'หยุดเดิน', 'พอแล้ว', 'stop', 'halt', 'wait'];
const SPLIT = /\s*(?:แล้วก็|แล้ว|จากนั้น|ต่อด้วย|และ|,|;|\bthen\b|\band then\b|\band\b)\s*/i;
const QUESTION = /(อะไร|ทำไม|อย่างไร|ยังไง|เมื่อไร|ใคร|ไหม|มั้ย|หรือเปล่า|\?|what|why|how|when|who|where is|tell me)/i;

/** Lowercase, drop punctuation, polite particles and all whitespace (Thai has no word spaces). */
export function normalize(text) {
  return String(text ?? '').toLowerCase().normalize('NFC')
    .replace(/[​‌‍]/g, '')
    .replace(/[“”"'`.!?,:;()\[\]{}\-_/\\]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .trim()
    .replace(POLITE, '')
    .replace(/\s+/g, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** Best similarity (0..1) of term against any window of text with length term±2. */
export function fuzzyContains(text, term) {
  if (!term) return 0;
  if (text.includes(term)) return 1;
  if (term.length < 3) return 0;
  let best = 0;
  for (let size = Math.max(1, term.length - 2); size <= term.length + 2; size += 1) {
    for (let start = 0; start + size <= text.length; start += 1) {
      const score = 1 - levenshtein(text.slice(start, start + size), term) / Math.max(size, term.length);
      if (score > best) best = score;
    }
  }
  return best;
}

// Sound-alike skeleton for Thai: drop tone marks/shortening marks, merge letters Whisper often confuses.
const SOUND_ALIKE = [[/[\u0E47-\u0E4C]/g, ''], [/ใ/g, 'ไ'], [/[ซศษ]/g, 'ส'], [/[ขฃฅฆ]/g, 'ค'], [/[ธฑฒถฐ]/g, 'ท'], [/ฏ/g, 'ต'],
  [/ฎ/g, 'ด'], [/[ภผ]/g, 'พ'], [/ฝ/g, 'ฟ'], [/ณ/g, 'น'], [/[รฬ]/g, 'ล'], [/ญ/g, 'ย'], [/[ฌฉ]/g, 'ช'], [/ะ/g, ''], [/ั/g, '']];
export const soundAlike = text => SOUND_ALIKE.reduce((value, [pattern, to]) => value.replace(pattern, to), text);
/** Thai consonant skeleton (all vowel signs removed): Whisper-tiny garbles Thai vowels far more than consonants. */
export const skeleton = text => soundAlike(text).replace(/[\u0E30-\u0E3A\u0E40-\u0E46]/g, '').replace(/อ/g, '');

const termsOf = entry => [entry.name, entry.id.replace(/-/g, ' '), ...(entry.aliases ?? [])].map(normalize).filter(t => t.length >= 2);

/**
 * Best entry for text. An entry passes when its score ≥ threshold, or (relaxed) when ≥ relaxed and it beats
 * every other entry by a clear margin, which tolerates Whisper's Thai misspellings after a goto verb.
 */
function bestMatch(text, entries, threshold, relaxed = threshold) {
  const sound = soundAlike(text);
  const bones = skeleton(text);
  const thai = /[\u0E00-\u0E7F]/.test(text);
  const perEntry = [];
  for (const entry of entries ?? []) {
    let top = null;
    for (const term of termsOf(entry)) {
      const termBones = skeleton(term);
      const score = Math.max(fuzzyContains(text, term), fuzzyContains(sound, soundAlike(term)) * 0.98,
        thai && termBones.length >= 3 ? fuzzyContains(bones, termBones) * 0.9 : 0);
      // Rank by similarity weighted by how much of the spoken phrase the term explains, so a short alias that
      // nearly matches one word (เรือนซ้าย ≈ เรือนท้าย) loses to a full name matching the whole phrase.
      const coverage = Math.min(1, term.length / Math.max(text.length, 1));
      const rank = score * (0.7 + 0.3 * coverage) + term.length / 1000;
      if (!top || rank > top.rank) top = { entry, term, score, rank };
    }
    if (top) perEntry.push(top);
  }
  perEntry.sort((a, b) => b.rank - a.rank);
  let [best, second] = perEntry;
  if (!best) return null;
  // A short name heard exactly ("pond") that begins a longer Station name which fuzzily matches the whole
  // phrase ("pond pavelevan" ≈ "pond pavilion") means the speaker said the more specific place.
  const specific = perEntry.find(other => other !== best && other.term.length > best.term.length
    && other.term.startsWith(best.term) && fuzzyContains(text, other.term) >= 0.6);
  if (specific) { second = best; best = { ...specific, score: Math.max(specific.score, threshold) }; }
  if (best.score >= threshold) return best;
  // Relaxed matches need a long enough term: short words (e.g. ชาน) fuzzily resemble too many others (บ้าน).
  if (best.score >= relaxed && best.term.length >= 4 && (!second || best.rank - second.rank >= 0.08)) return best;
  return null;
}

function stripVerb(text) {
  for (const verb of GOTO_VERBS) {
    const index = text.indexOf(verb);
    if (index !== -1) return { verb, index, rest: text.slice(index + verb.length) };
  }
  return null;
}

function parseClause(clause, vocabulary, previous) {
  const raw = clause.trim();
  const text = normalize(raw);
  if (!text) return null;
  if (STOP_WORDS.some(word => text === normalize(word) || text.startsWith(normalize(word)))) return { type: 'stop' };

  const gesture = bestMatch(text, vocabulary.gestures, 0.8);
  const verb = stripVerb(text);
  const isQuestion = QUESTION.test(raw);

  // A gesture word said before the verb ("ชี้ไปทางนั้น", point over there) is the action; the rest only
  // describes it, so a loose Station match on that rest must not turn it into a walk.
  const gestureFirst = gesture?.score === 1 && verb && text.indexOf(gesture.term) !== -1 && text.indexOf(gesture.term) < verb.index;
  if (verb && !isQuestion) {
    const station = bestMatch(verb.rest || text, vocabulary.stations, 0.72, 0.5);
    if (station && !(gestureFirst && station.score < 0.85)) return { type: 'goto', stationId: station.entry.id, matched: station.term, score: Number(station.score.toFixed(2)) };
    if (!gesture) return { type: 'goto', stationId: null, reason: 'unknown-station', query: verb.rest };
  }
  if (gesture && !isQuestion) return { type: 'gesture', gestureId: gesture.entry.id, matched: gesture.term };
  // A bare station name after a goto clause ("go to A then B") or alone counts as goto.
  if (!isQuestion) {
    const station = bestMatch(text, vocabulary.stations, 0.85);
    if (station && (previous?.type === 'goto' || text.length <= station.term.length + 3))
      return { type: 'goto', stationId: station.entry.id, matched: station.term, score: Number(station.score.toFixed(2)) };
  }
  return { type: 'ask', text: raw };
}

export function parseCommand(transcript, vocabulary = {}) {
  const intents = [];
  for (const clause of String(transcript ?? '').split(SPLIT)) {
    const intent = parseClause(clause, vocabulary, intents.at(-1));
    if (!intent) continue;
    // Merge consecutive ask fragments back into one question.
    if (intent.type === 'ask' && intents.at(-1)?.type === 'ask') intents.at(-1).text += ' ' + intent.text;
    else intents.push(intent);
  }
  // If any part is a question, treat the whole utterance as a question (RAG may return goto).
  if (intents.some(i => i.type === 'ask') && intents.some(i => i.type !== 'ask')) {
    if (QUESTION.test(transcript)) return { intents: [{ type: 'ask', text: String(transcript).trim() }] };
  }
  return { intents };
}

/** Build vocabulary from a validated map and optional gesture manifest. */
export function vocabularyFor(map, gestures = []) {
  return {
    stations: (map?.stations ?? []).map(({ id, name, aliases }) => ({ id, name, aliases })),
    gestures: gestures.map(({ id, name, aliases }) => ({ id, name, aliases }))
  };
}
