/**
 * Map knowledge for the Guide's answers (RAG without an embedding model).
 *
 * A Map Package carries its documents in two folders:
 *   maps/<mapId>/knowledge/<stationId>.md | overview.md   — written per Station by the Creator
 *   maps/<mapId>/documents/*.md | *.txt                    — documents attached to the Map (future Map input)
 * A document belongs to a Station when its file name is the Station id, or its first line is `station: <id>`.
 *
 * Retrieval is lexical: Thai has no spaces, so text is indexed as character bigrams (Thai) plus words (Latin),
 * scored with BM25, and chunks of the Current Station get a boost. Good enough for tens of Stations;
 * swap retrieve() for embeddings when documents grow.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

const THAI = /[฀-๿]/;
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Markdown links in a text, e.g. the "ที่มา:" of a paragraph. */
export function linksIn(text) {
  const seen = new Set();
  return [...String(text).matchAll(LINK)].map(([, title, url]) => ({ title, url }))
    .filter(link => !seen.has(link.url) && seen.add(link.url));
}

/** Text for the AI: "ที่มา:" lines and link syntax removed (the Sources are shown to the Visitor separately). */
export function plainText(text) {
  return String(text)
    .replace(/(^|\s)ที่มา:(\s*\[[^\]]+\]\([^)]+\)[\s,;]*(และ)?)+/g, '$1')
    .replace(LINK, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
const MAX_CHUNK = 700;

export function tokenize(text) {
  const tokens = [];
  for (const run of String(text).toLowerCase().match(/[฀-๿]+|[a-z0-9]+/g) ?? []) {
    if (THAI.test(run)) {
      const letters = run.replace(/[ัิ-ฺ็-๎]/g, ''); // drop vowel marks and tone marks
      if (letters.length === 1) tokens.push(letters);
      for (let i = 0; i < letters.length - 1; i += 1) tokens.push(letters.slice(i, i + 2));
    } else if (run.length > 1) tokens.push(run);
  }
  return tokens;
}

/** Split a document into chunks of whole paragraphs, each carrying its nearest heading. */
export function chunkDocument(text, meta) {
  const chunks = [];
  let heading = '';
  let buffer = [];
  const flush = () => {
    const body = buffer.join('\n\n').trim();
    if (body) chunks.push({ ...meta, heading, text: body });
    buffer = [];
  };
  for (const block of text.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/m);
    if (headingMatch && trimmed.startsWith('#')) {
      flush();
      heading = headingMatch[1].trim();
      const rest = trimmed.split('\n').slice(1).join('\n').trim();
      if (rest) buffer.push(rest);
      continue;
    }
    if (buffer.join('\n\n').length + trimmed.length > MAX_CHUNK) flush();
    buffer.push(trimmed);
  }
  flush();
  return chunks;
}

async function listDocuments(directory) {
  try {
    return (await readdir(directory)).filter(name => ['.md', '.txt'].includes(extname(name)) && !name.startsWith('.') && !/^readme\./i.test(name))
      .map(name => join(directory, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Build the search index of one Map from its knowledge/ and documents/ folders. */
export async function buildIndex(mapDir, stationIds = []) {
  const known = new Set(stationIds);
  const files = [...await listDocuments(join(mapDir, 'knowledge')), ...await listDocuments(join(mapDir, 'documents'))];
  const chunks = [];
  for (const file of files) {
    let text = (await readFile(file, 'utf8')).replace(/<!--[\s\S]*?-->/g, ''); // review notes are not knowledge
    const name = basename(file, extname(file));
    let station = known.has(name) ? name : null;
    const tag = text.match(/^station:\s*([a-z0-9-]+)\s*\n/);
    if (tag) { station = known.has(tag[1]) ? tag[1] : station; text = text.slice(tag[0].length); }
    if (!/(ที่มา|Source):\s*\[[^\]]+\]\(https?:/i.test(text)) continue; // no "ที่มา:" link → not knowledge (spec R5.1)
    const source = file.slice(mapDir.length + 1);
    let fileLinks = [];
    for (const chunk of chunkDocument(text, { source, station })) {
      chunk.links = linksIn(chunk.text);
      if (chunk.links.length) fileLinks = chunk.links; else chunk.links = fileLinks; // e.g. the English summary line
      chunk.text = plainText(chunk.text);
      if (chunk.text) chunks.push(chunk);
    }
  }
  const df = new Map();
  for (const chunk of chunks) {
    chunk.tokens = tokenize(`${chunk.heading} ${chunk.text}`);
    chunk.tf = new Map();
    for (const token of chunk.tokens) chunk.tf.set(token, (chunk.tf.get(token) ?? 0) + 1);
    for (const token of chunk.tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const avgLength = chunks.reduce((sum, chunk) => sum + chunk.tokens.length, 0) / (chunks.length || 1);
  const sourcedStations = [...new Set(chunks.map(chunk => chunk.station).filter(Boolean))];
  return { chunks, df, avgLength, files: files.length, sourcedStations };
}

/** Top chunks for a question; chunks of the Current Station are boosted and its best chunk is always included. */
export function retrieve(index, question, { stationId = null, limit = 4 } = {}) {
  const { chunks, df, avgLength } = index;
  const query = [...new Set(tokenize(question))];
  const k1 = 1.2, b = 0.75;
  const scored = chunks.map(chunk => {
    let score = 0;
    for (const token of query) {
      const tf = chunk.tf.get(token);
      if (!tf) continue;
      const idf = Math.log(1 + (chunks.length - df.get(token) + 0.5) / (df.get(token) + 0.5));
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * chunk.tokens.length / avgLength));
    }
    if (stationId && chunk.station === stationId) score = score * 1.5 + 1;
    return { chunk, score };
  }).sort((x, y) => y.score - x.score);
  const picked = scored.filter(entry => entry.score > 0).slice(0, limit).map(entry => entry.chunk);
  const local = stationId && scored.find(entry => entry.chunk.station === stationId)?.chunk;
  if (local) { // "here" means the Current Station: its best chunk always leads
    const at = picked.indexOf(local);
    if (at >= 0) picked.splice(at, 1); else if (picked.length >= limit) picked.pop();
    picked.unshift(local);
  }
  return picked.map(({ source, station, heading, text, links }) => ({ source, station, heading, text, links: links ?? [] }));
}

/** Indexes cached per Map, rebuilt when any document changes. */
export function createKnowledgeStore(mapsDir) {
  const cache = new Map();
  async function signature(mapDir) {
    const files = [...await listDocuments(join(mapDir, 'knowledge')), ...await listDocuments(join(mapDir, 'documents'))];
    const stamps = await Promise.all(files.map(async file => `${file}:${(await stat(file)).mtimeMs}`));
    return stamps.sort().join('|');
  }
  return {
    async index(map) {
      const mapDir = join(mapsDir, map.id);
      const key = await signature(mapDir);
      const hit = cache.get(map.id);
      if (hit?.key === key) return hit.index;
      const index = await buildIndex(mapDir, map.stations.map(station => station.id));
      cache.set(map.id, { key, index });
      return index;
    }
  };
}
