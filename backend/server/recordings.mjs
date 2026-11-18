/**
 * Recording store (spec R3.3, ADR 0004): recordings/<id>/recording.json + voice.webm.
 * Recordings are never edited, only listed, read and deleted (re-record instead).
 */
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateRecording } from '../shared/recording.mjs';

const ID = /^[a-f0-9]{12}$/;
const AUDIO_TYPES = { 'audio/webm': 'voice.webm', 'audio/ogg': 'voice.ogg', 'audio/mp4': 'voice.m4a' };
const notFound = id => Object.assign(new Error(`ไม่พบ Recording "${id}"`), { status: 404 });

const summary = ({ id, mapId, title, speaker, createdAt, duration, captions, audio }) =>
  ({ id, mapId, title, speaker, createdAt, duration, captionCount: captions.length, hasAudio: Boolean(audio) });

export function createRecordingStore(dir) {
  const folder = id => {
    if (!ID.test(id)) throw notFound(id);
    return join(dir, id);
  };
  async function read(id) {
    try { return JSON.parse(await readFile(join(folder(id), 'recording.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw notFound(id); throw error; }
  }
  return {
    /** Save a new Recording; audio is optional (a Recording without a microphone still replays). */
    async save(recording, { audio = null, audioType = 'audio/webm' } = {}) {
      validateRecording(recording);
      const id = randomUUID().replace(/-/g, '').slice(0, 12);
      const file = AUDIO_TYPES[audioType.split(';')[0]];
      if (audio && !file) throw Object.assign(new Error(`ไม่รองรับเสียงชนิด ${audioType}`), { status: 400 });
      const saved = {
        ...recording, id,
        title: String(recording.title ?? '').trim().slice(0, 120) || 'Recording',
        speaker: String(recording.speaker ?? '').trim().slice(0, 60),
        createdAt: new Date().toISOString(),
        audio: audio ? { file, type: audioType.split(';')[0] } : null
      };
      await mkdir(folder(id), { recursive: true });
      if (audio) await writeFile(join(folder(id), file), audio);
      await writeFile(join(folder(id), 'recording.json'), JSON.stringify(saved));
      return summary(saved);
    },
    async list(mapId = null) {
      let names;
      try { names = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const all = [];
      for (const name of names.filter(n => ID.test(n))) {
        try { const recording = await read(name); if (!mapId || recording.mapId === mapId) all.push(summary(recording)); }
        catch { /* skip a broken folder */ }
      }
      return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    read,
    /** { path, type, size } of the voice audio, for streaming. */
    async audio(id) {
      const recording = await read(id);
      if (!recording.audio) throw notFound(`${id}/voice`);
      const path = join(folder(id), recording.audio.file);
      return { path, type: recording.audio.type, size: (await stat(path)).size };
    },
    async remove(id) {
      await read(id);
      await rm(folder(id), { recursive: true, force: true });
      return { deleted: id };
    }
  };
}
