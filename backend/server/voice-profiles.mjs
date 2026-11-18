/**
 * Voice Profile store (spec R6.3, ADR 0012), owned by this project — no Companion folder at run time.
 *
 *   data/voice-profiles/current.json           { "id": "<active profile>" }
 *   data/voice-profiles/<id>/profile.json      { id, name, transcript, durationSeconds, consent, createdAt }
 *   data/voice-profiles/<id>/reference.wav     24 kHz mono reference the voice is cloned from
 *
 * A profile is only stored with the voice owner's consent. Author mode lists, adds, previews, activates and deletes.
 */
import { mkdir, readFile, writeFile, readdir, rm, cp, mkdtemp, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
export const defaultProfileRoot = process.env.VOICE_PROFILE_DIR ?? join(root, 'data', 'voice-profiles');
const ID = /^[a-f0-9-]{8,40}$/;
const MIN_SECONDS = 5, MAX_SECONDS = 30;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

async function duration(path) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { timeout: 10_000 });
  return Number(stdout.trim());
}

export function createProfileStore(dir = defaultProfileRoot) {
  const folder = id => { if (!ID.test(id)) throw fail(`ไม่พบ Voice Profile "${id}"`, 404); return join(dir, id); };
  async function read(id) {
    try { return JSON.parse(await readFile(join(folder(id), 'profile.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw fail(`ไม่พบ Voice Profile "${id}"`, 404); throw error; }
  }
  async function activeId() {
    try { return JSON.parse(await readFile(join(dir, 'current.json'), 'utf8')).id ?? null; } catch { return null; }
  }
  const publicView = (profile, active) => ({ id: profile.id, name: profile.name, transcript: profile.transcript,
    durationSeconds: profile.durationSeconds, createdAt: profile.createdAt, consent: profile.consent, active: profile.id === active });

  return {
    dir,
    async list() {
      let names = [];
      try { names = await readdir(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const active = await activeId();
      const profiles = [];
      for (const name of names.filter(n => ID.test(n))) { try { profiles.push(publicView(await read(name), active)); } catch { /* skip broken */ } }
      return profiles.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    /** The active profile for synthesis: { id, transcript, audioPath } — refuses one without consent. */
    async active() {
      const id = await activeId();
      if (!id) throw Object.assign(fail('ยังไม่ได้เลือก Voice Profile — เปิด Author mode แล้วเพิ่มเสียงของ Guide', 503), { unavailable: true });
      const profile = await read(id);
      if (profile.consent?.confirmed !== true) throw fail('Voice Profile ยังไม่ได้รับความยินยอมจากเจ้าของเสียง', 403);
      return { id, transcript: profile.transcript, audioPath: join(folder(id), 'reference.wav') };
    },
    async get(id) {
      const profile = await read(id);
      if (profile.consent?.confirmed !== true) throw fail('Voice Profile ยังไม่ได้รับความยินยอมจากเจ้าของเสียง', 403);
      return { id, transcript: profile.transcript, audioPath: join(folder(id), 'reference.wav') };
    },
    /** Add a profile from recorded audio (any ffmpeg-readable type), the words spoken in it, and the owner's consent. */
    async create({ audio, transcript, name, consent }) {
      if (consent?.confirmed !== true) throw fail('ต้องยืนยันความยินยอมของเจ้าของเสียงก่อน');
      if (!['self', 'permission'].includes(consent.ownership)) throw fail('ต้องระบุว่าเป็นเสียงของตัวเองหรือได้รับอนุญาตจากเจ้าของเสียง');
      const text = String(transcript ?? '').trim();
      if (text.length < 5) throw fail('ต้องพิมพ์ข้อความที่พูดในตัวอย่างเสียง');
      if (!audio?.length) throw fail('ไม่มีไฟล์เสียง');
      const work = await mkdtemp(join(tmpdir(), 'voice-profile-'));
      try {
        const input = join(work, 'input'), output = join(work, 'reference.wav');
        await writeFile(input, audio);
        await run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', output], { timeout: 30_000 });
        const seconds = await duration(output);
        if (!(seconds >= MIN_SECONDS)) throw fail(`ตัวอย่างเสียงสั้นเกินไป (${seconds.toFixed(1)} วินาที) ต้องอย่างน้อย ${MIN_SECONDS} วินาที`);
        if (seconds > MAX_SECONDS) throw fail(`ตัวอย่างเสียงยาวเกิน ${MAX_SECONDS} วินาที`);
        const id = randomUUID();
        await mkdir(folder(id), { recursive: true });
        await cp(output, join(folder(id), 'reference.wav'));
        const profile = { id, name: String(name ?? '').trim().slice(0, 60) || 'Voice', transcript: text, durationSeconds: Math.round(seconds * 10) / 10,
          consent: { confirmed: true, ownership: consent.ownership, ownerName: String(consent.ownerName ?? '').trim().slice(0, 80), recordedAt: new Date().toISOString(), version: 'ai-avatar-3d-consent-v1' },
          createdAt: new Date().toISOString() };
        await writeFile(join(folder(id), 'profile.json'), JSON.stringify(profile, null, 2));
        if (!await activeId()) await writeFile(join(dir, 'current.json'), JSON.stringify({ id }));
        return publicView(profile, await activeId());
      } finally { await rm(work, { recursive: true, force: true }); }
    },
    async activate(id) {
      const profile = await read(id);
      if (profile.consent?.confirmed !== true) throw fail('Voice Profile ยังไม่ได้รับความยินยอม', 403);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'current.json'), JSON.stringify({ id }));
      return publicView(profile, id);
    },
    async remove(id) {
      await read(id);
      await rm(folder(id), { recursive: true, force: true });
      if (await activeId() === id) await rm(join(dir, 'current.json'), { force: true });
      return { deleted: id };
    }
  };
}

/** Copy the active consented profile of an AI Study Companion Avatar profile folder into this store (once). */
export async function importProfile(sourceDir, dir = defaultProfileRoot) {
  const current = JSON.parse(await readFile(join(sourceDir, 'current.json'), 'utf8'));
  if (!/^profile-[a-f0-9-]{8,40}$/.test(String(current.directory))) throw fail('current.json ของต้นทางไม่ถูกต้อง');
  const from = join(sourceDir, current.directory);
  const profile = JSON.parse(await readFile(join(from, 'profile.json'), 'utf8'));
  if (!ID.test(String(profile.id))) throw fail('profile id ของต้นทางไม่ถูกต้อง');
  if (profile.consent?.confirmed !== true) throw fail('Voice Profile ต้นทางไม่มีความยินยอม ไม่คัดลอก', 403);
  await access(join(from, 'reference.wav'));
  const id = profile.id;
  await mkdir(join(dir, id), { recursive: true });
  await cp(join(from, 'reference.wav'), join(dir, id, 'reference.wav'));
  const imported = { id, name: 'Imported from AI Study Companion Avatar', transcript: profile.transcript, durationSeconds: profile.durationSeconds,
    consent: { ...profile.consent, importedFrom: 'AI Study Companion Avatar' }, createdAt: profile.createdAt ?? new Date().toISOString() };
  await writeFile(join(dir, id, 'profile.json'), JSON.stringify(imported, null, 2));
  await writeFile(join(dir, 'current.json'), JSON.stringify({ id }));
  return imported;
}
