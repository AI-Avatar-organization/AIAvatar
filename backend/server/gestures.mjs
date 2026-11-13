import { readFile, writeFile, rename, stat, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const SOURCES = ['quickmagic-text', 'quickmagic-video', 'mixamo', 'procedural'];
/** Built-in placeholder motions (public/procedural-gestures.js) used until a QuickMagic clip replaces them. */
export const PROCEDURAL = ['idle', 'wai', 'wave', 'point', 'bow', 'welcome'];

/**
 * Gesture Library (ADR 0003). gestures/manifest.json:
 * { locomotion: { idle, walk }, gestures: [{ id, name, nameEn?, aliases[], file? | procedural?, loop, source, prompt? }] }
 * locomotion values are a clip file (clips/x.glb) or a procedural id.
 */
export function validateGestures(raw, file = 'gestures/manifest.json') {
  const fail = (field, message) => { throw Object.assign(new Error(`${file}: ${field} ${message}`), { field, status: 400 }); };
  const clipRef = (value, field) => {
    if (typeof value !== 'string') fail(field, 'is required');
    if (PROCEDURAL.includes(value)) return { procedural: value };
    if (!/^clips\/[\w.-]+\.glb$/.test(value)) fail(field, 'must be clips/<name>.glb or a procedural id');
    return { file: value };
  };
  if (!raw || typeof raw !== 'object') fail('(root)', 'must be an object');
  const locomotion = {
    idle: clipRef(raw.locomotion?.idle ?? 'idle', 'locomotion.idle'),
    walk: raw.locomotion?.walk ? clipRef(raw.locomotion.walk, 'locomotion.walk') : null
  };
  if (!Array.isArray(raw.gestures)) fail('gestures', 'must be an array');
  const seen = new Set();
  const gestures = raw.gestures.map((gesture, index) => {
    const at = `gestures[${index}]`;
    if (typeof gesture?.id !== 'string' || !ID.test(gesture.id)) fail(`${at}.id`, 'must be lowercase letters, digits or dashes');
    if (seen.has(gesture.id)) fail(`${at}.id`, `duplicates "${gesture.id}"`);
    seen.add(gesture.id);
    if (typeof gesture.name !== 'string' || !gesture.name.trim()) fail(`${at}.name`, 'is required');
    if (!Array.isArray(gesture.aliases ?? []) || (gesture.aliases ?? []).some(a => typeof a !== 'string')) fail(`${at}.aliases`, 'must be an array of strings');
    if (!gesture.file && !gesture.procedural) fail(at, 'needs file or procedural');
    const clip = clipRef(gesture.file ?? gesture.procedural, gesture.file ? `${at}.file` : `${at}.procedural`);
    const source = gesture.source ?? (clip.procedural ? 'procedural' : 'quickmagic-text');
    if (!SOURCES.includes(source)) fail(`${at}.source`, `must be one of ${SOURCES.join(', ')}`);
    return {
      id: gesture.id, name: gesture.name.trim(), ...(gesture.nameEn ? { nameEn: String(gesture.nameEn).trim() } : {}),
      aliases: (gesture.aliases ?? []).map(a => a.trim()).filter(Boolean), ...clip,
      loop: gesture.loop === true, source, ...(gesture.prompt ? { prompt: String(gesture.prompt) } : {}),
      ...(gesture.duration ? { duration: Number(gesture.duration) } : {})
    };
  });
  return { locomotion, gestures };
}

export async function loadGestures(dir) {
  const library = validateGestures(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')));
  const files = [library.locomotion.idle, library.locomotion.walk, ...library.gestures].filter(c => c?.file).map(c => c.file);
  for (const file of files) await stat(join(dir, file)).catch(() => { throw Object.assign(new Error(`gestures/${file} is missing`), { status: 500 }); });
  return library;
}

/** Save a raw .glb buffer to gestures/clips/<id>.glb. Creates clips/ dir if needed. */
export async function saveClip(dir, id, buffer) {
  if (!ID.test(id)) throw Object.assign(new Error(`id "${id}" ไม่ถูกต้อง`), { status: 400 });
  const clipsDir = join(dir, 'clips');
  await mkdir(clipsDir, { recursive: true });
  // Basic GLB magic check: first 4 bytes must be 0x46546C67 ('glTF' little-endian)
  if (buffer.length < 12 || buffer.readUInt32LE(0) !== 0x46546C67) {
    throw Object.assign(new Error('ไฟล์ไม่ใช่ GLB ที่ถูกต้อง'), { status: 400 });
  }
  await writeFile(join(clipsDir, `${id}.glb`), buffer);
  return `clips/${id}.glb`;
}

/** Add or replace one gesture in the manifest (used by scripts/import-gesture.mjs). */
export async function upsertGesture(dir, gesture) {
  const file = join(dir, 'manifest.json');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const index = raw.gestures.findIndex(g => g.id === gesture.id);
  if (index === -1) raw.gestures.push(gesture); else raw.gestures[index] = { ...raw.gestures[index], ...gesture, procedural: undefined };
  validateGestures(raw);
  await writeFile(file + '.tmp', JSON.stringify(raw, null, 2) + '\n');
  await rename(file + '.tmp', file);
  return raw;
}

async function writeManifest(dir, raw) {
  validateGestures(raw);
  const file = join(dir, 'manifest.json');
  await writeFile(file + '.tmp', JSON.stringify(raw, null, 2) + '\n');
  await rename(file + '.tmp', file);
  return raw;
}

/** PATCH: change display names, voice aliases or loop of one gesture. Other fields are not editable here. */
export async function patchGesture(dir, id, changes) {
  const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const gesture = raw.gestures.find(g => g.id === id);
  if (!gesture) throw Object.assign(new Error(`ไม่พบท่า "${id}"`), { status: 404 });
  if (typeof changes.name === 'string' && changes.name.trim()) gesture.name = changes.name.trim();
  if (typeof changes.nameEn === 'string') { if (changes.nameEn.trim()) gesture.nameEn = changes.nameEn.trim(); else delete gesture.nameEn; }
  if (Array.isArray(changes.aliases)) gesture.aliases = changes.aliases.map(String).map(a => a.trim()).filter(Boolean);
  if (typeof changes.loop === 'boolean') gesture.loop = changes.loop;
  await writeManifest(dir, raw);
  return validateGestures(raw).gestures.find(g => g.id === id);
}

/** DELETE: remove the gesture and its clip file (unless another entry or locomotion still uses that file). */
export async function deleteGesture(dir, id) {
  const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const gesture = raw.gestures.find(g => g.id === id);
  if (!gesture) throw Object.assign(new Error(`ไม่พบท่า "${id}"`), { status: 404 });
  raw.gestures = raw.gestures.filter(g => g.id !== id);
  await writeManifest(dir, raw);
  let removedFile = null;
  const stillUsed = [raw.locomotion?.idle, raw.locomotion?.walk, ...raw.gestures.map(g => g.file)].includes(gesture.file);
  if (gesture.file && !stillUsed) {
    await unlink(join(dir, gesture.file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    removedFile = gesture.file;
  }
  return { id, removedFile };
}
