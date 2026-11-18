import * as THREE from 'three';
import { World } from './world.js';
import { Avatar, AVATARS, DEFAULT_AVATAR } from './avatar.js';
import { VoiceInput, BrowserSpeechInput, browserSpeechSupported, reserveSlot, releaseSlot } from './voice.js';
import { loadGestureLibrary } from './gestures.js';
import { convertMotion, isGlb } from './motion-convert.js';
import { speakWithLipSync } from './lipsync.js';
import { parseCommand, vocabularyFor } from './shared/command.mjs';
import { planRoute } from './shared/route.mjs';
import { pageUrl } from './base.js';
import { loadSession, features, login, logout, savedAvatar, saveAvatar } from './session.js';
import { t, lang, setLang, onLangChange, applyI18n, nameOf } from './i18n.js';
import { createFace, currentStation, GuideVoice } from './guide.js';
import { Recorder } from './recorder.js';
import { ReplayPlayer, formatTime } from './replay.js';
import { createFollower, warpBeside } from './shared/follow.mjs';
import { manualStep, MANUAL_KEYS } from './shared/manual.mjs';
import { takeOff, flightStep, landingStep } from './shared/flight.mjs';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const authorMode = params.get('author') === '1';
// Author requests carry the AUTHOR_TOKEN from ?token=… (kept for this tab only) — the server refuses them otherwise.
if (authorMode) {
  let token = params.get('token');
  try { if (token) sessionStorage.setItem('authorToken', token); else token = sessionStorage.getItem('authorToken'); } catch { /* storage blocked */ }
  if (token) {
    const plainFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      // Same page folder works at / and behind /aiavatar/ (ADR 0016 deployment).
      if (url.origin !== location.origin || !url.pathname.startsWith(new URL(pageUrl('api/')).pathname)) return plainFetch(input, init);
      return plainFetch(input, { ...init, headers: { ...(init.headers ?? {}), 'X-Author-Token': token } });
    };
  }
}

const world = new World($('viewport'));
const labels = $('labels');
const state = { session: null, map: null, avatar: null, pins: new Map(), queue: Promise.resolve(), editing: null, gestures: [] };
/** Prompt Presets: ready-made questions the Visitor can tap instead of speaking (keys in i18n.js). */
const PRESETS = ['preset.what', 'preset.story', 'preset.why', 'preset.nearby'];
window.__app = { world, state, runCommand }; // test and debugging hook

// ---------- Map loading ----------
async function listMaps() {
  const { maps, errors } = await (await fetch(pageUrl('api/maps'))).json();
  if (errors.length) console.warn('Map package errors:', errors);
  const select = $('map-select');
  state.maps = maps;
  renderMapOptions();
  return maps;
}

function renderMapOptions() {
  const select = $('map-select');
  const value = select.value;
  select.replaceChildren(...state.maps.map(m => new Option(`${nameOf(m)} (${m.stationCount})`, m.id)));
  if (value) select.value = value;
}

async function openMap(id) {
  $('loading').hidden = false;
  $('loading').textContent = t('loading.map');
  const response = await fetch(pageUrl(`api/maps/${id}`));
  if (!response.ok) throw new Error((await response.json()).error);
  const map = await response.json();
  state.map = map;
  await loadSources(map.id);
  $('map-select').value = id;
  renderMapText();
  $('unit-scale').value = map.unitScale;
  const url = new URL(location.href);
  url.searchParams.set('map', id);
  history.replaceState(null, '', url);
  await world.loadMap(map, { onProgress: stage => { $('loading').textContent = t('loading.' + stage); } });
  const avatar = state.avatar;
  world.scene.add(avatar.root);
  avatar.place(map.spawn.position, map.spawn.facing);
  const ground = world.groundAt(map.spawn.position[0], map.spawn.position[2], map.spawn.position[1] + 1, 1, 50);
  if (ground !== null && Math.abs(ground - map.spawn.position[1]) > 0.05) avatar.root.position.y = ground;
  if (!map.camera) {
    world.controls.target.copy(avatar.root.position).add(new THREE.Vector3(0, 1.2, 0));
    world.camera.position.copy(world.controls.target).add(new THREE.Vector3(4.5, 3.5, 6.5));
  }
  world.followObject(avatar.root);
  renderStations();
  $('loading').hidden = true;
  renderGuide(true);
  document.body.dataset.mapReady = map.id;
}

function renderMapText() {
  const map = state.map;
  if (!map) return;
  $('map-title').textContent = nameOf(map);
  $('map-description').textContent = lang() === 'en' && map.descriptionEn ? map.descriptionEn : map.description;
  document.title = `${nameOf(map)} · AI Avatar 3D`;
}

// ---------- Stations, Pins and list ----------
function renderStations() {
  updatePlaceholderPool();
  for (const pin of state.pins.values()) pin.element.remove();
  state.pins.clear();
  const list = $('station-list');
  list.replaceChildren();
  for (const station of state.map.stations) {
    const element = document.createElement('button');
    element.className = 'pin';
    element.dataset.station = station.id;
    element.innerHTML = '<span class="tag"></span><span class="stem"></span>';
    element.querySelector('.tag').textContent = nameOf(station);
    element.title = nameOf(station);
    element.addEventListener('click', () => openPinCard(station.id));
    labels.append(element);
    state.pins.set(station.id, { element, position: new THREE.Vector3().fromArray(station.position).add(new THREE.Vector3(0, 2.4, 0)) });

    const item = document.createElement('li');
    const button = document.createElement('button');
    button.innerHTML = '<span class="dot"></span><span></span>';
    button.lastChild.textContent = nameOf(station);
    button.addEventListener('click', () => openPinCard(station.id));
    item.append(button);
    list.append(item);
  }
  if (!state.map.stations.length) list.innerHTML = `<li class="empty">${t(authorMode ? 'stations.emptyAuthor' : 'stations.empty')}</li>`;
  $('stations-heading').textContent = t('stations', { count: state.map.stations.length });
}

const avatarLabel = document.createElement('div');
avatarLabel.className = 'avatar-name';
avatarLabel.textContent = 'Avatar';
labels.append(avatarLabel);

world.updaters.add(() => {
  for (const [id, pin] of state.pins) {
    const screen = world.project(pin.position);
    pin.element.style.display = screen ? '' : 'none';
    if (screen) pin.element.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
    pin.element.classList.toggle('active', state.activeStation === id);
  }
  if (state.avatar) {
    const head = state.avatar.root.position.clone().add(new THREE.Vector3(0, state.avatar.height + 0.35, 0));
    const screen = world.project(head);
    avatarLabel.style.display = screen && $('toggle-avatar-name').checked ? '' : 'none';
    if (screen) avatarLabel.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
  }
});
// Pins are positioned via transform; reset base offset.
const pinStyle = document.createElement('style');
pinStyle.textContent = '.pin, .avatar-name { left: 0; top: 0; }';
document.head.append(pinStyle);

// Flash Speed ×3 (spec R8.5): remembered per browser; storage may be blocked (private mode), so it is optional.
const FLASH_KEY = 'avatar3d.flash';
$('toggle-flash').addEventListener('change', event => {
  state.avatar.flash = event.target.checked;
  try { localStorage.setItem(FLASH_KEY, event.target.checked ? '1' : '0'); } catch { /* not remembered */ }
});
try { if (localStorage.getItem(FLASH_KEY) === '1') { $('toggle-flash').checked = true; if (state.avatar) state.avatar.flash = true; } } catch { /* default off */ }
$('toggle-pins').addEventListener('change', event => labels.classList.toggle('hide-pin-names', !event.target.checked));

function openPinCard(id) {
  const station = state.map.stations.find(s => s.id === id);
  if (!station) return;
  state.editing = id;
  const english = lang() === 'en';
  const latin = alias => /^[a-z]/i.test(alias);
  $('pin-card-title').textContent = nameOf(station);
  $('pin-card-command').textContent = `“${t('goto.say', { name: english ? nameOf(station).toLowerCase() : station.name })}”`;
  const others = station.aliases.filter(a => latin(a) === english).filter(a => a.toLowerCase() !== nameOf(station).toLowerCase()).slice(0, 3);
  $('pin-card-alts').textContent = others.length ? t('pin.alts', { list: others.map(a => `“${t('goto.alt', { name: a })}”`).join(', ') }) : '';
  $('pin-card-author').hidden = !authorMode;
  $('pin-name').value = station.name;
  $('pin-name-en').value = station.nameEn ?? '';
  $('pin-aliases').value = station.aliases.join(', ');
  $('pin-card').showModal();
}

$('pin-go').addEventListener('click', () => {
  $('pin-card').close();
  runIntents([{ type: 'goto', stationId: state.editing }], t('pin.click'));
});

// ---------- Gestures (Requirement 2) ----------
const gestureName = id => { const gesture = state.gestures.find(g => g.id === id); return gesture ? nameOf(gesture) : id; };

function renderGestures() {
  const list = $('gesture-list');
  list.replaceChildren(...state.gestures.map(gesture => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.gesture = gesture.id;
    button.textContent = nameOf(gesture);
    button.classList.toggle('placeholder', gesture.source === 'procedural');
    // Voice hint tooltip: phrases in the current STT language first, then one in the other language.
    const phrases = speakable(gesture);
    button.title = phrases.length ? `${t('gesture.sayHint')}: ${phrases.map(a => `"${a}"`).join(', ')}` : '';
    if (gesture.source === 'procedural') button.title += `${button.title ? '\n' : ''}${t('gesture.placeholder')}`;
    button.addEventListener('click', () => runIntents([{ type: 'gesture', gestureId: gesture.id }], nameOf(gesture)));
    if (!authorMode) return button;
    const wrap = document.createElement('span');
    wrap.className = 'gesture-item';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'icon'; edit.textContent = '✏️'; edit.dataset.edit = gesture.id;
    edit.title = edit.ariaLabel = t('gesture.edit', { name: nameOf(gesture) });
    edit.addEventListener('click', () => editGesture(gesture));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'icon'; remove.textContent = '🗑️'; remove.dataset.delete = gesture.id;
    remove.title = remove.ariaLabel = t('gesture.delete', { name: nameOf(gesture) });
    remove.addEventListener('click', () => deleteGesture(gesture));
    wrap.append(button, edit, remove);
    return wrap;
  }));
  // Update rotating placeholder examples to include gesture aliases
  updatePlaceholderPool();
}
async function reloadGestures() {
  state.gestures = await loadGestureLibrary(state.avatar);
  renderGestures();
}
async function editGesture(gesture) {
  const aliases = prompt(t('gesture.editPrompt', { name: nameOf(gesture) }), gesture.aliases.join(', '));
  if (aliases === null) return;
  const response = await fetch(pageUrl(`api/gestures/${gesture.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aliases: aliases.split(',').map(a => a.trim()).filter(Boolean) }) });
  const body = await response.json();
  if (!response.ok) return setStatus(body.error);
  await reloadGestures();
  setStatus(t('gesture.edited', { name: nameOf(gesture) }));
}
async function deleteGesture(gesture) {
  if (!confirm(t('gesture.deleteConfirm', { name: nameOf(gesture) }))) return;
  const response = await fetch(pageUrl(`api/gestures/${gesture.id}`), { method: 'DELETE' });
  const body = await response.json();
  if (!response.ok) return setStatus(body.error);
  await reloadGestures();
  setStatus(t('gesture.deleted', { name: nameOf(gesture) }));
}
function renderGestureActive(id) {
  for (const button of $('gesture-list').querySelectorAll('[data-gesture]')) button.classList.toggle('active', button.dataset.gesture === id);
}

// ---------- Commands ----------
function setStatus(text) { $('voice-status').textContent = text; }

function describe(intent) {
  if (intent.type === 'goto') return intent.stationId ? t('intent.goto', { name: nameOf(state.map.stations.find(s => s.id === intent.stationId)) }) : t('intent.unknown', { query: intent.query });
  if (intent.type === 'gesture') return t('intent.gesture', { name: gestureName(intent.gestureId) });
  if (intent.type === 'stop') return t('intent.stop');
  return t('intent.ask', { text: intent.text });
}

async function runIntents(intents, heard) {
  setStatus(t('heard', { text: heard, plan: intents.map(describe).join(' → ') }));
  state.avatar.cancel();
  for (const intent of intents) {
    if (intent.type === 'stop') { state.avatar.cancel(); state.avatar.stopGesture(); break; }
    if (intent.type === 'goto' && intent.stationId) {
      const station = state.map.stations.find(s => s.id === intent.stationId);
      state.activeStation = station.id;
      const from = state.avatar.root.position.toArray();
      const route = world.navigation ? planRoute((a, b) => world.navigation.path(a, b), from, station.position, state.map.connectors) : null;
      if (world.navigation && !route) console.warn('No route; walking straight to', station.id);
      const path = route?.path ?? null;
      const arrived = await state.avatar.walkTo(station.position, station.facing, { stationId: station.id }, path);
      if (!arrived) break;
      setStatus(t('arrived', { name: nameOf(station) }));
    } else if (intent.type === 'goto') {
      const names = state.map.stations.slice(0, 4).map(nameOf).join(', ');
      setStatus(t('notFound', { query: intent.query, names }));
      break;
    } else if (intent.type === 'gesture') {
      const name = gestureName(intent.gestureId);
      const gesture = state.gestures.find(g => g.id === intent.gestureId);
      setStatus(t('gesture.doing', { name }));
      renderGestureActive(intent.gestureId);
      const finished = await state.avatar.playGesture(intent.gestureId);
      if (gesture?.loop) setStatus(t('gesture.holding', { name }));
      else if (finished) { setStatus(t('gesture.done', { name })); renderGestureActive(null); }
      else break;
    } else if (intent.type === 'ask') {
      await askGuide(intent.text);
    }
  }
}

function runCommand(text, onParsed) {
  const { intents } = parseCommand(text, vocabularyFor(state.map, state.gestures));
  document.body.dataset.lastIntents = JSON.stringify(intents);
  onParsed?.();
  return runIntents(intents, text);
}

/**
 * End-to-End Latency of the last Voice Command (steps 1–8, ms), for the browser benchmark (scripts/bench-e2e.mjs).
 * 1 stop recording · 2–6 from the server's timings (6 = request time minus server time) · 7 parseCommand ·
 * 8 route + Avatar start (until it starts walking or playing a Gesture; stays null when the Avatar does nothing).
 */
function recordVoiceTimings(stopPressed, body, transcribed, parsed) {
  const server = body.timings ?? {};
  const voiceCommand = {
    text: body.text, provider: body.provider ?? null, transcribedBy: body.transcribedBy ?? null,
    stopRecording: body.clientTimings?.stopRecordingMs ?? null,
    upload: server.receiveMs ?? null,
    ffmpeg: server.ffmpegMs ?? null,
    waitForWorker: server.serverMs === undefined ? null : (server.waitMs ?? 0) + (server.workerStartMs ?? 0) + (server.modelLoadMs ?? 0),
    transcribe: server.transcribeMs ?? null,
    responseBack: server.serverMs === undefined ? null : Math.max(0, (body.clientTimings?.requestMs ?? server.serverMs) - server.serverMs),
    parseCommand: Math.round(parsed - transcribed),
    routeAndAvatarStart: null, total: null, stationId: null, gestureId: null
  };
  const stopListening = state.avatar.onChange(event => {
    if (event.type !== 'walk-start' && event.type !== 'gesture-start') return;
    stopListening();
    const started = performance.now();
    Object.assign(voiceCommand, { routeAndAvatarStart: Math.round(started - parsed), total: Math.round(started - stopPressed), stationId: event.meta?.stationId ?? null, gestureId: event.id ?? null });
  });
  window.__app.lastVoiceCommand = voiceCommand;
  return stopListening;
}

$('command-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('command-input').value.trim();
  if (!text) return;
  $('command-input').value = '';
  runCommand(text);
});

const voice = new VoiceInput();
const browserVoice = new BrowserSpeechInput();
let listening = null; // { by: 'server', lang, token } | { by: 'browser', lang } while the mic is open (lang fixed at press)
let useFallbackNext = false; // the STT Service filled up just as audio was sent: the repeat goes to the browser
// Rotating command-input placeholder: whole example commands in the current language (never bare alias
// fragments or the other language's words, which the STT would not hear anyway).
const isThai = text => /[\u0E00-\u0E7F]/.test(text);
/** Phrases that trigger a gesture: Thai name + Thai aliases (or English aliases) first, then one from the other language. */
function speakable(gesture, max = 4) {
  const terms = [...new Set([gesture.name, ...gesture.aliases].map(a => a.trim()).filter(Boolean))];
  const mine = terms.filter(a => isThai(a) === (lang() === 'th'));
  const other = terms.filter(a => isThai(a) !== (lang() === 'th'));
  return [...mine.slice(0, max - 1), ...other.slice(0, 1)];
}
let placeholderExamples = [];
let placeholderIndex = 0;
function updatePlaceholderPool() {
  const stations = (state.map?.stations ?? []).slice(0, 3).map(station => t('goto.say', { name: nameOf(station) }));
  const gestures = state.gestures.map(g => speakable(g)[0]).filter(phrase => phrase && isThai(phrase) === (lang() === 'th'));
  const sequence = stations[0] && gestures[0] ? [`${stations[0]} ${t('then')} ${gestures[0]}`] : [];
  placeholderExamples = [t('voice.input'), ...[...stations, ...gestures, ...sequence].map(example => t('voice.try', { example }))];
  placeholderIndex = 0;
  showPlaceholder();
}
function showPlaceholder() {
  const input = $('command-input');
  if (placeholderExamples.length && document.activeElement !== input && !input.value) input.placeholder = placeholderExamples[placeholderIndex];
}
setInterval(() => {
  if (!placeholderExamples.length) return;
  placeholderIndex = (placeholderIndex + 1) % placeholderExamples.length;
  showPlaceholder();
}, 3500);
/**
 * Whisper priming text. English: the Gesture Library's single-word commands ("wave, wai, point, …"), which the
 * server measured to fix one-word gestures misheard as "why"/"oh"/"coin". Thai: the server drops it (the Thai
 * model breaks on any prompt); the Whisper tiny fallback still gets the command verbs.
 */
function sttPrompt() {
  if (lang() !== 'en') return 'ไปที่ เดินไป พาไป';
  const words = state.gestures.map(g => g.aliases.find(a => !isThai(a))).filter(Boolean);
  return words.length ? words.join(', ') : 'go to, walk to, take me to';
}

// ---------- Language (UI + STT) ----------
// One switch: interface text, Station names, example commands and the STT language. Whisper's auto-detect
// misreads short Thai clips (as Chinese), so the user's chosen language is always sent.
function renderLanguage() {
  for (const button of document.querySelectorAll('.lang-switch [data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === lang()));
  $('lang').textContent = lang().toUpperCase();
  if (!mic.classList.contains('busy') && !listening) setStatus(t('voice.idle', { example: t('example') }));
  mic.setAttribute('aria-label', t(listening ? 'mic.stop' : 'mic.start'));
  if (!$('stt-badge').hidden) showTranscribedBy($('stt-badge').dataset.by);
  if (state.maps) renderMapOptions();
  renderMapText();
  if (state.map) renderStations();
  renderGestures();
  renderGuide(true);
  if ($('pin-card').open && state.editing) openPinCard(state.editing);
}
for (const button of document.querySelectorAll('.lang-switch [data-lang]')) button.addEventListener('click', () => setLang(button.dataset.lang));
$('lang').addEventListener('click', () => setLang(lang() === 'th' ? 'en' : 'th'));
onLangChange(renderLanguage);
const mic = $('mic');
/** Small badge: which transcription the last Voice Command used (server STT Service or Browser STT Fallback). */
function showTranscribedBy(by) {
  const badge = $('stt-badge');
  badge.hidden = false;
  badge.dataset.by = by;
  badge.textContent = t(`stt.by.${by}`);
}
/** Mic pressed: reserve a slot first; without one use Browser STT Fallback, or ask the Visitor to type. */
async function startListening() {
  state.voice?.unlock();
  state.voice?.stop(); // the Visitor speaks: the Guide stops talking and listens
  setGuideState('listening');
  state.speechStart = state.recorder?.status === 'recording' ? state.recorder.now() : null;
  mic.classList.add('busy');
  try {
    const slot = useFallbackNext ? null : await reserveSlot(lang());
    useFallbackNext = false;
    if (slot) {
      try { await voice.start(); } catch (error) { releaseSlot(lang(), slot.token); throw error; }
      listening = { by: 'server', lang: lang(), token: slot.token };
      setStatus(t('mic.listening'));
    } else if (browserSpeechSupported()) {
      browserVoice.start(lang());
      listening = { by: 'browser', lang: lang() };
      setStatus(t('mic.fallback'));
    } else {
      setStatus(t('mic.typeInstead'));
      return;
    }
    mic.setAttribute('aria-pressed', 'true');
    mic.setAttribute('aria-label', t('mic.stop'));
  } catch (error) { setStatus(t('mic.failed', { error: error.message })); }
  finally { mic.classList.remove('busy'); }
}
async function toggleMic() {
  if (mic.classList.contains('busy')) return;
  if (!listening) return startListening();
  const { by, token, lang: spoken } = listening;
  listening = null;
  mic.setAttribute('aria-pressed', 'false');
  mic.setAttribute('aria-label', t('mic.start'));
  mic.classList.add('busy');
  setStatus(t('mic.transcribing'));
  const stopPressed = performance.now();
  try {
    const body = by === 'server' ? await voice.stop(sttPrompt(), spoken, token) : await browserVoice.stop(spoken);
    const transcribed = performance.now();
    showTranscribedBy(body.transcribedBy ?? by);
    if (!body.text) setStatus(t('mic.nothing'));
    else {
      if (state.recorder && state.recorder.status !== 'idle') state.recorder.caption(body.text, state.speechStart);
      let stopListening;
      try { await runCommand(body.text, () => { stopListening = recordVoiceTimings(stopPressed, body, transcribed, performance.now()); }); }
      finally { stopListening?.(); }
    }
  } catch (error) {
    if (error.code === 'busy' || error.code === 'unavailable') {
      // The service filled up (or stopped) between reserving and sending: repeat with Browser STT Fallback.
      useFallbackNext = browserSpeechSupported();
      setStatus(t(useFallbackNext ? 'mic.repeat' : 'mic.typeInstead'));
    } else if (error.code === 'browser-speech') setStatus(t('mic.typeInstead'));
    else {
      if (error.code === 'too-short' && token) releaseSlot(spoken, token);
      setStatus(error.code === 'too-short' ? t('mic.tooShort') : error.message || t('stt.failed'));
    }
  }
  finally { mic.classList.remove('busy'); }
}
mic.addEventListener('click', toggleMic);
// Closing the page while holding the mic gives the reserved slot back at once instead of after it expires.
addEventListener('pagehide', () => { if (listening?.token) releaseSlot(listening.lang, listening.token); });
addEventListener('keydown', event => {
  if (event.code === 'KeyV' && !event.repeat && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !$('pin-card').open) toggleMic();
});

// ---------- Panel ----------
$('panel-toggle').addEventListener('click', () => {
  const collapsed = $('panel').classList.toggle('collapsed');
  $('panel-toggle').setAttribute('aria-expanded', String(!collapsed));
});
$('map-select').addEventListener('change', event => openMap(event.target.value).catch(error => setStatus(error.message)));

// ---------- Author mode (Ticket 03) ----------
function slug(text, taken) {
  let base = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'station';
  if (base.length < 2) base = 'station';
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}
const round = v => Math.round(v * 1000) / 1000;

function mapJson() {
  const { id, name, nameEn, description, descriptionEn, scene, unitScale, version, ground, groundPlane, navigation, assets, connectors, spawn, camera, stations } = state.map;
  return { id, name, nameEn, description, descriptionEn, scene, unitScale, version, ground, groundPlane, navigation, assets, connectors, spawn, ...(camera ? { camera } : {}), stations };
}

if (authorMode) {
  $('mode-badge').hidden = false;
  $('author-tools').hidden = false;
  // Gesture Upload (Author Mode)
  const gestureStatus = $('author-status'); // reuse existing status element
  const gestureIdInput = $('gesture-id');
  const gestureNameInput = $('gesture-name-input');

  // Auto-generate ID from Thai name as user types
  let gestureIdManual = false;
  gestureNameInput?.addEventListener('input', () => {
    if (gestureIdManual) return;
    const slug = gestureNameInput.value.toLowerCase()
      .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    if (gestureIdInput) gestureIdInput.value = slug || '';
  });
  gestureIdInput?.addEventListener('input', () => { gestureIdManual = true; });

  $('gesture-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const file = $('gesture-file').files[0];
    const id = $('gesture-id').value.trim();
    const name = $('gesture-name-input').value.trim();
    const nameEn = $('gesture-name-en-input').value.trim();
    const aliases = $('gesture-aliases-input').value.split(',').map(a => a.trim()).filter(Boolean);
    const loop = $('gesture-loop-input').checked;

    if (!file || !id || !name) {
      gestureStatus.textContent = t('gesture.upload.missing');
      return;
    }

    const extension = file.name.split('.').pop().toLowerCase();
    const started = performance.now();
    try {
      // .glb passes straight through (magic bytes checked); .fbx/.bvh are retargeted to this Avatar in the browser.
      let body = await file.arrayBuffer();
      if (extension === 'glb' || isGlb(body)) {
        if (!isGlb(body)) { gestureStatus.textContent = t('gesture.upload.notGlb'); return; }
      } else if (extension === 'fbx' || extension === 'bvh') {
        gestureStatus.textContent = t('gesture.upload.converting');
        const result = await convertMotion(body, extension, state.avatar, id);
        body = result.glb;
        console.info(`converted ${file.name}: ${result.bones} bones, ${result.tracks} tracks, ${result.duration.toFixed(1)} s, ${(result.bytes / 1024).toFixed(0)} KB`);
      } else {
        gestureStatus.textContent = t('gesture.upload.badType'); return;
      }
      gestureStatus.textContent = t('gesture.upload.uploading');
      // Step 1: upload .glb file
      const uploadRes = await fetch(pageUrl(`api/gestures/clip?id=${encodeURIComponent(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'model/gltf-binary' },
        body
      });
      if (!uploadRes.ok) throw new Error((await uploadRes.json()).error);

      // Step 2: upsert metadata into manifest
      const gestureData = {
        id, name, ...(nameEn ? { nameEn } : {}),
        aliases, file: `clips/${id}.glb`, loop, source: extension === 'bvh' ? 'quickmagic-video' : 'quickmagic-text'
      };
      const metaRes = await fetch(pageUrl('api/gestures'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gestureData)
      });
      if (!metaRes.ok) throw new Error((await metaRes.json()).error);

      // Step 3: live reload gesture library without page refresh
      gestureStatus.textContent = t('gesture.upload.reloading');
      await reloadGestures();
      $('gesture-form').reset();
      gestureIdManual = false;
      gestureStatus.textContent = t('gesture.upload.success', { name }) + ` (${((performance.now() - started) / 1000).toFixed(1)} s)`;
    } catch (err) {
      gestureStatus.textContent = err.message || t('gesture.upload.error');
    }
  });
  let down = null;
  world.renderer.domElement.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY }; });
  world.renderer.domElement.addEventListener('pointerup', event => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || event.button !== 0) return;
    const hit = world.pick(event);
    if (!hit) return;
    const name = prompt(t('author.newName'));
    if (!name?.trim()) return;
    const taken = new Set(state.map.stations.map(s => s.id));
    const english = prompt(t('author.newNameEn')) ?? '';
    const facing = Math.atan2(world.camera.position.x - hit.point.x, world.camera.position.z - hit.point.z);
    state.map.stations.push({ id: slug(english || name, taken), name: name.trim(), nameEn: english.trim() || undefined, aliases: english.trim() ? [english.trim()] : [],
      position: hit.point.toArray().map(round), facing: round(facing), description: '' });
    renderStations();
    $('author-status').textContent = t('author.added', { name });
  });
  $('pin-name').addEventListener('change', event => {
    const station = state.map.stations.find(s => s.id === state.editing);
    station.name = event.target.value.trim() || station.name;
    renderStations();
  });
  $('pin-name-en').addEventListener('change', event => {
    const station = state.map.stations.find(s => s.id === state.editing);
    station.nameEn = event.target.value.trim() || undefined;
    renderStations();
  });
  $('pin-aliases').addEventListener('change', event => {
    state.map.stations.find(s => s.id === state.editing).aliases = event.target.value.split(',').map(a => a.trim()).filter(Boolean);
  });
  $('pin-face').addEventListener('click', () => {
    const station = state.map.stations.find(s => s.id === state.editing);
    station.facing = round(Math.atan2(world.camera.position.x - station.position[0], world.camera.position.z - station.position[2]));
    $('author-status').textContent = t('author.faced', { name: nameOf(station) });
  });
  $('pin-delete').addEventListener('click', () => {
    state.map.stations = state.map.stations.filter(s => s.id !== state.editing);
    $('pin-card').close();
    renderStations();
  });
  $('set-spawn').addEventListener('click', () => {
    state.map.spawn = { position: state.avatar.root.position.toArray().map(round), facing: round(state.avatar.root.rotation.y) };
    $('author-status').textContent = t('author.spawnSet');
  });
  $('unit-scale').addEventListener('change', async event => {
    state.map.unitScale = Number(event.target.value) || 1;
    await world.loadMap(state.map);
  });
  $('download-map').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(mapJson(), null, 2)], { type: 'application/json' }));
    link.download = 'map.json';
    link.click();
  });
  $('save-map').addEventListener('click', async () => {
    state.map.camera = { position: world.camera.position.toArray().map(round), target: world.controls.target.toArray().map(round) };
    const response = await fetch(pageUrl(`api/maps/${state.map.id}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mapJson()) });
    const body = await response.json();
    $('author-status').textContent = response.ok ? t('author.saved', { version: body.version }) : body.error;
    if (response.ok) state.map.version = body.version;
  });
}

// ---------- Avatar: everyone picks a built-in Avatar; the MANGOs library is for Members (ADR 0016) ----------
let avatarHooks = [];

/** Wire an Avatar into the world and the UI; returns undo functions so a swap can unhook the previous one. */
function attachAvatar(avatar) {
  state.avatar = avatar;
  avatar.flash = $('toggle-flash').checked; // remembered Flash (R8.5)
  avatar.groundAt = (...args) => world.groundAt(...args);
  // The Guide's voice moves this Avatar's mouth (GuideVoice is created once, at boot): by phoneme through its
  // visemes when it has them (T2 Avaturn, VRM, a MANGOs T2 Avatar), else by loudness.
  if (state.voice) {
    state.voice.lipSync?.stop();
    state.voice.mouth = createFace(avatar.root);
    state.voice.lipSync = avatar.lipSync;
  }
  const update = dt => avatar.update(dt);
  world.updaters.add(update);
  const hooks = [() => world.updaters.delete(update)];
  // Lip-sync demo (Companion pipeline): a Thai sample → /api/lipsync → Viseme morphs on the audio clock.
  $('lipsync-demo').hidden = !avatar.lipSync;
  if (avatar.lipSync) {
    // Like Companion's canvas.dataset.mouthShape: lets tests and people see what the mouth is doing.
    const mouth = () => {
      $('viewport').dataset.mouthShape = avatar.lipSync.shape;
      $('viewport').dataset.mouthOpen = Math.max(0, ...Object.values(avatar.lipSync.current)).toFixed(3);
    };
    world.updaters.add(mouth);
    hooks.push(() => world.updaters.delete(mouth));
  }
  hooks.push(avatar.onChange(event => {
    if (event.type === 'walk-start') renderGestureActive(null);
    if (event.type === 'arrived' || event.type === 'moved') renderGuide();
  }));
  avatarHooks = hooks;
}

async function loadGesturesFor(avatar) {
  try {
    state.gestures = await loadGestureLibrary(avatar);
  } catch (error) {
    state.gestures = [];
    console.warn('Gesture Library unavailable, using procedural idle/walk:', error);
  }
  renderGestures();
}

/** Free the GPU memory of an Avatar that left the scene (VRM textures are several MB). */
function disposeAvatar(avatar) {
  avatar.mixer.stopAllAction();
  avatar.mixer.uncacheRoot(avatar.root);
  avatar.root.traverse(object => {
    object.geometry?.dispose?.();
    for (const material of [object.material].flat().filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}

/** Replace the Avatar in place: same spot and facing, Gesture Library rebuilt for the new skeleton. */
async function swapAvatar(id) {
  const old = state.avatar;
  if (!old || !AVATARS[id] || old.id === id) return; // nothing to swap before the first Avatar is in the scene
  const select = $('avatar-select');
  select.disabled = true;
  setStatus(t('avatar.loading'));
  try {
    const next = await Avatar.load(id);
    old.cancel();
    old.stopGesture();
    avatarHooks.forEach(undo => undo());
    world.scene.remove(old.root);
    disposeAvatar(old);
    attachAvatar(next);
    world.scene.add(next.root);
    next.place(old.root.position.toArray(), old.root.rotation.y);
    next.root.position.y = old.root.position.y;
    world.followObject(next.root); // camera and roof fading move to the new Avatar
    await loadGesturesFor(next);
    saveAvatar(state.session, id);
    setStatus(t('voice.idle', { example: t('example') }));
  } catch (error) {
    select.value = old.id;
    setStatus(t('avatar.failed', { error: error.message }));
    console.error(error);
  } finally {
    select.disabled = false;
  }
}

function renderAvatarOptions() {
  const select = $('avatar-select');
  const value = select.value || state.avatar?.id;
  select.replaceChildren(...Object.entries(AVATARS).map(([id, entry]) => new Option(nameOf(entry), id)));
  if (value) select.value = value;
}

// ---------- Guest / Member ----------
function renderSession() {
  const session = state.session;
  const member = session.member;
  const can = features(session);
  $('session').dataset.mode = session.mode;
  $('session-name').textContent = member ? member.displayName : t('session.guest');
  $('session-name').title = member ? member.displayName : '';
  $('session-image').hidden = !member?.avatarImageUrl;
  if (member?.avatarImageUrl) $('session-image').src = member.avatarImageUrl;
  // A server without MANGOs (MANGOS_AUTH=off) shows no login button at all.
  $('session-login').hidden = Boolean(member) || !session.enabled;
  $('session-logout').hidden = !member;
  $('avatar-picker').hidden = !can.avatarPicker;
  if (session.error) setStatus(t('session.unavailable'));
}

$('session-login').addEventListener('click', () => login(state.session));
$('session-logout').addEventListener('click', () => logout(state.session, { onFallback: () => setStatus(t('session.logoutElsewhere')) }));
$('avatar-select').addEventListener('change', event => swapAvatar(event.target.value));
$('lipsync-demo').addEventListener('click', async () => {
  const demo = $('lipsync-demo');
  if (!state.avatar?.lipSync) return;
  demo.disabled = true;
  try { console.info('lip-sync timings', (await speakWithLipSync(state.avatar.lipSync, pageUrl('samples/lipsync-demo-th.wav'))).timings); }
  catch (error) { console.warn('lip-sync failed', error); }
  finally { demo.disabled = false; }
});
onLangChange(() => { renderAvatarOptions(); if (state.session) renderSession(); });

/** Which Avatar to open with: ?avatar= in Author mode (testing), else the last pick in this browser, else the default. */
function firstAvatar(session) {
  const wanted = (authorMode && params.get('avatar')) || (features(session).avatarPicker ? savedAvatar(session) : null);
  return AVATARS[wanted] ? wanted : DEFAULT_AVATAR;
}

// ---------- Boot ----------
applyI18n();
renderLanguage();
try {
  const sessionReady = loadSession();
  const [maps, avatar] = await Promise.all([
    listMaps(),
    sessionReady.then(session => {
      state.session = session;
      renderSession();
      $('loading').textContent = t('loading.avatar');
      return Avatar.load(firstAvatar(session));
    })
  ]);
  state.voice = new GuideVoice({
    onCaption: text => { $('guide-caption').hidden = !text; $('guide-caption').textContent = text ?? ''; layoutCaptions(); },
    onState: guideState => setGuideState(guideState),
    onAudio: playing => setSpeaker(playing ? 'ai' : null) // only while the AI's voice is actually heard (R5.4)
  });
  world.updaters.add(dt => state.voice.frame(dt));
  attachAvatar(avatar);
  renderAvatarOptions();
  $('loading').textContent = t('loading.gestures');
  await loadGesturesFor(avatar);
  const wanted = params.get('map');
  const first = maps.find(m => m.id === wanted) ?? maps.find(m => m.stationCount) ?? maps[0];
  if (!first) throw new Error(t('maps.none'));
  await openMap(first.id);
} catch (error) {
  $('loading').hidden = false;
  $('loading').textContent = t('loading.failed', { error: error.message });
  console.error(error);
}

// ---------- Guide: chat at a Station (AI Tour, ADR 0011, spec R5) ----------
function setGuideState(guideState) { document.body.dataset.guideState = guideState; }

/** The Station the question is about: near the Visitor's Avatar, or near the recorded Avatar while a Replay is paused (R5.5). */
function contextStation() {
  if (!state.map || !state.avatar) return null;
  const who = state.replay?.paused ? state.replay.avatar : state.avatar;
  return currentStation(state.map.stations, who.root.position.toArray());
}

/** Prompt Presets appear in the chat box only near a Station whose knowledge has a Source (R5.1–R5.2). */
function renderGuide(force = false) {
  const here = contextStation();
  if (!force && here?.id === state.guideStationId) return;
  state.guideStationId = here?.id ?? null;
  const sourced = here && state.sourced?.has(here.id);
  $('guide-here').textContent = here ? t(sourced ? 'guide.here' : 'guide.noSource', { name: nameOf(here) }) : t('guide.nowhere');
  const list = $('preset-list');
  list.hidden = !sourced;
  list.replaceChildren(...(sourced ? PRESETS : []).map(key => {
    const wrap = document.createElement('span');
    wrap.className = 'preset';
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'send';
    send.textContent = t(key);
    send.addEventListener('click', () => { state.voice.unlock(); askGuide(t(key)); });
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy';
    copy.textContent = '⧉';
    copy.title = t('preset.copy');
    copy.setAttribute('aria-label', `${t('preset.copy')}: ${t(key)}`);
    copy.addEventListener('click', async () => {
      $('command-input').value = t(key);
      try { await navigator.clipboard.writeText(t(key)); setStatus(t('preset.copied')); } catch { setStatus(t('preset.inInput')); }
      $('command-input').focus();
    });
    wrap.append(send, copy);
    return wrap;
  }));
}

async function loadSources(mapId) {
  try {
    const response = await fetch(pageUrl(`api/maps/${mapId}/sources`));
    state.sourced = new Set(response.ok ? (await response.json()).stations : []);
  } catch { state.sourced = new Set(); }
}

async function askGuide(question) {
  if (state.replay && !state.replay.paused) toggleReplay(); // one voice at a time: asking pauses the Replay (R5.5)
  const here = contextStation();
  state.voice.stop();
  setGuideState('thinking');
  setStatus(t('guide.thinking'));
  showQuestion(question);
  const asked = ++state.askRun || (state.askRun = 1);
  const current = () => asked === state.askRun; // a newer question replaces this one
  let body;
  let feed = null;
  try {
    // Spec R11.2: the answer arrives as NDJSON while it is written; words show at once and the voice starts at the
    // first full sentence. A plain JSON reply (cached answers from older servers, test stubs) works the same way.
    const response = await fetch(pageUrl('api/ask'), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/json' },
      body: JSON.stringify({ mapId: state.map.id, question, stationId: here?.id ?? null, lang: lang() }) });
    if (!(response.headers.get('content-type') ?? '').includes('ndjson')) {
      body = await response.json();
      if (!response.ok) throw new Error(body.error ?? response.status);
    } else {
      let text = '';
      const decoder = new TextDecoder();
      let buffered = '';
      for await (const bytes of response.body) {
        if (!current()) return;
        buffered += decoder.decode(bytes, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.type === 'queued') setStatus(t('guide.queued', { position: event.position }));
          else if (event.type === 'text') {
            if (!text) { setStatus(t('guide.writing')); feed = state.voice.speakStream(lang()); }
            text += event.delta;
            $('guide-answer-text').textContent = text;
            feed.push(text);
          } else if (event.type === 'done') body = event;
          else if (event.type === 'error') throw new Error(event.error);
        }
      }
      if (!body) throw new Error('no answer');
    }
  } catch (error) {
    if (current()) { if (feed) state.voice.stop(); setGuideState('idle'); setStatus(t('guide.failed', { error: error.message })); }
    return;
  }
  if (!current()) return;
  document.body.dataset.lastAnswer = JSON.stringify(body);
  showAnswer(body);
  setStatus(t('guide.answered') + (state.voice.voiceAvailable ? '' : ' ' + t('guide.voiceOff')));
  // The Visitor's own Avatar speaks the answer (R5.4). Talking about another Station: point at it first (logic, not AI).
  const elsewhere = body.stations.find(id => id !== here?.id);
  if (elsewhere && !state.avatar.target && state.avatar.gestureIds().includes('point')) {
    const target = state.map.stations.find(s => s.id === elsewhere);
    const p = state.avatar.root.position;
    state.avatar.root.rotation.y = Math.atan2(target.position[0] - p.x, target.position[2] - p.z);
    state.avatar.playGesture('point');
  }
  await (feed ? feed.end(body.answer) : state.voice.speak(body.answer, lang()));
}

// ---------- Collapsible side panel (spec R9.2, T26) ----------
// Each section heading folds its section. Open by default: Ask the Guide and Stations. Remembered per browser.
const FOLD_KEY = 'avatar3d.folded';
const DEFAULT_OPEN = new Set(['guide-section', 'stations-section']);
let foldedSaved = null;
try { foldedSaved = JSON.parse(localStorage.getItem(FOLD_KEY) ?? 'null'); } catch { /* defaults */ }
function setFolded(section, folded, save = true) {
  section.classList.toggle('folded', folded);
  section.querySelector(':scope > h2').setAttribute('aria-expanded', String(!folded));
  if (!save) return;
  const state = Object.fromEntries([...document.querySelectorAll('#panel section[id]')].map(s => [s.id, s.classList.contains('folded')]));
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(state)); } catch { /* not remembered */ }
}
for (const section of document.querySelectorAll('#panel section[id]')) {
  const heading = section.querySelector(':scope > h2');
  heading.classList.add('fold');
  heading.setAttribute('role', 'button');
  heading.tabIndex = 0;
  const toggle = () => setFolded(section, !section.classList.contains('folded'));
  heading.addEventListener('click', toggle);
  heading.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
  setFolded(section, foldedSaved?.[section.id] ?? !DEFAULT_OPEN.has(section.id), false);
}

// ---------- Chat Dock (spec R9.1, T25) ----------
function setChatOpen(open) {
  $('chat-log').hidden = !open || !$('chat-question').textContent;
  $('chat-toggle').setAttribute('aria-expanded', String(open));
  state.chatOpen = open;
  if (open) $('chat-dot').hidden = true;
}
$('chat-toggle').addEventListener('click', () => setChatOpen(!state.chatOpen));
addEventListener('keydown', event => { if (event.key === 'Escape' && state.chatOpen) setChatOpen(false); });
/** Captions sit just above the voice bar (whatever its height); while one shows, the open chat steps aside. */
function layoutCaptions() {
  const guide = $('guide-caption'), replay = $('replay-caption');
  const captioning = !guide.hidden || !replay.hidden;
  document.body.classList.toggle('captioning', captioning);
  if (!captioning) return;
  let bottom = innerHeight - $('voice-bar').getBoundingClientRect().top + 10;
  for (const caption of [guide, replay]) {
    if (caption.hidden) continue;
    caption.style.bottom = `${bottom}px`;
    bottom += caption.getBoundingClientRect().height + 8;
  }
}
world.updaters.add(layoutCaptions);

function showQuestion(question) {
  $('chat-log').hidden = !state.chatOpen;
  $('chat-question').textContent = question;
  $('guide-answer-text').textContent = '…';
  $('guide-answer-stations').replaceChildren();
  $('guide-answer-sources').replaceChildren();
}

function showAnswer(body) {
  if (!state.chatOpen) $('chat-dot').hidden = false; // a new answer waits in the closed chat
  $('guide-answer-text').textContent = body.answer;
  $('guide-answer-stations').replaceChildren(...body.stations.filter(id => id !== body.stationId).map(id => {
    const station = state.map.stations.find(s => s.id === id);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('guide.go', { name: nameOf(station) });
    button.addEventListener('click', () => { state.voice.stop(); runIntents([{ type: 'goto', stationId: id }], t('guide.go', { name: nameOf(station) })); });
    return button;
  }));
  // Sources the answer was built from (R5.3): every link once, opened in a new tab.
  const seen = new Set();
  const links = body.sources.flatMap(source => source.links ?? []).filter(link => !seen.has(link.url) && seen.add(link.url));
  $('guide-answer-sources').replaceChildren(...links.map(link => {
    const item = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = link.title;
    item.append(t('guide.source') + ' ', anchor);
    return item;
  }));
}

/** Speaker Label (R5.4, T17): who the voice now playing belongs to. kind: 'ai' | 'recording' | null. */
function setSpeaker(kind, name = '') {
  const label = $('speaker-label');
  label.hidden = !kind;
  label.dataset.kind = kind ?? '';
  label.textContent = kind === 'ai' ? t('speaker.ai') : kind === 'recording' ? t('speaker.recording', { name }) : '';
}

// ---------- Record mode (spec R3.1–R3.3) ----------
function setRecordStatus() {
  const status = state.recorder?.status ?? 'idle';
  $('record-state').dataset.state = status;
  $('record-start').disabled = status !== 'idle';
  $('record-pause').disabled = status === 'idle';
  $('record-stop').disabled = status === 'idle';
  $('record-pause').textContent = status === 'paused' ? '⏯' : '⏸';
  setStatus(t(status === 'recording' ? 'record.recording' : status === 'paused' ? 'record.paused' : 'record.ready'));
}

async function setRecordMode(on) {
  if (!on && state.recorder && state.recorder.status !== 'idle') {
    if (!confirm(t('record.discardConfirm'))) return;
    await state.recorder.discard();
  }
  if (on && state.replay) closeReplay();
  state.recordMode = on;
  state.recorder = on ? new Recorder(state.avatar) : null;
  $('record-mode').setAttribute('aria-pressed', String(on));
  $('record-bar').hidden = !on;
  document.body.classList.toggle('recording-mode', on);
  if (on) setRecordStatus(); else setStatus('');
}

$('record-mode').addEventListener('click', () => setRecordMode(!state.recordMode));
$('record-start').addEventListener('click', async () => {
  await state.recorder.start();
  if (!state.recorder.stream) setStatus(t('record.noMic'));
  setRecordStatus();
});
$('record-pause').addEventListener('click', () => {
  if (state.recorder.status === 'recording') state.recorder.pause(); else state.recorder.resume();
  setRecordStatus();
});
/** window.prompt, or the default when the browser cannot show one (embedded panes): a Take must never be lost to it. */
function ask(message, fallback) {
  try { return prompt(message, fallback) ?? fallback; } catch { return fallback; }
}
$('record-stop').addEventListener('click', async () => {
  const take = await state.recorder.stop();
  setRecordStatus();
  if (!take || take.recording.duration < 1 || take.recording.track.length < 2) { setStatus(t('record.empty')); return; }
  const fallbackTitle = `${nameOf(currentStation(state.map.stations, state.avatar.root.position.toArray()) ?? { name: state.map.name })} ${new Date().toLocaleDateString()}`;
  const title = ask(t('record.titlePrompt'), fallbackTitle);
  let speaker = '';
  try { speaker = localStorage.getItem('creatorName') ?? ''; } catch { /* storage blocked */ }
  if (!speaker) {
    speaker = ask(t('record.speakerPrompt'), '').trim();
    try { if (speaker) localStorage.setItem('creatorName', speaker); } catch { /* storage blocked */ }
  }
  setStatus(t('record.saving'));
  try {
    const audioBase64 = take.audio ? await blobToBase64(take.audio) : null;
    const response = await fetch(pageUrl('api/recordings'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recording: { ...take.recording, mapId: state.map.id, mapVersion: state.map.version ?? null, title, speaker }, audioBase64, audioType: take.audioType }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? response.status);
    document.body.dataset.lastRecording = body.id;
    setStatus(t('record.saved', { title: body.title, time: formatTime(body.duration) }));
  } catch (error) { setStatus(t('record.failed', { error: error.message })); }
});

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---------- Replay (spec R3.4–R3.5) ----------
const replayLabel = document.createElement('div');
replayLabel.className = 'avatar-name recorded';
replayLabel.style.display = 'none';
labels.append(replayLabel);

/** The second Avatar that plays Recordings, created once with the same clips as the Visitor's Avatar. */
async function recordedAvatar() {
  if (state.recordedAvatar) return state.recordedAvatar;
  const avatar = await Avatar.load();
  if (state.avatar.actions && state.avatar.id === avatar.id) {
    const { idle, walk, gestures } = state.avatar.actions;
    avatar.setClips({ idle: idle.getClip(), walk: walk?.getClip(), gestures });
  } else {
    // The Visitor switched Avatar: its clips are retargeted to another skeleton, so this one loads its own.
    try { await loadGestureLibrary(avatar); } catch (error) { console.warn('Replay Avatar keeps procedural idle/walk:', error); }
  }
  avatar.mouth = createFace(avatar.root);
  world.updaters.add(dt => {
    if (!avatar.root.parent) return;
    avatar.update(dt);
    if (avatar.mouth) {
      const { energy, tone } = state.replay?.player.shape() ?? { energy: 0, tone: 0.5 };
      avatar.mouth.setOpen(energy, tone);
      avatar.mouth.tick(dt);
    }
    const head = avatar.root.position.clone().add(new THREE.Vector3(0, avatar.height + 0.35, 0));
    const screen = world.project(head);
    replayLabel.style.display = screen ? '' : 'none';
    if (screen) replayLabel.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
  });
  state.recordedAvatar = avatar;
  return avatar;
}

async function startReplay(id) {
  if (state.recordMode) await setRecordMode(false);
  closeReplay();
  setStatus(t('replay.loading'));
  try {
    const response = await fetch(pageUrl(`api/recordings/${id}`));
    const recording = await response.json();
    if (!response.ok) throw new Error(recording.error ?? response.status);
    if (recording.mapId !== state.map.id) await openMap(recording.mapId);
    const avatar = await recordedAvatar();
    world.scene.add(avatar.root);
    state.voice.unlock();
    let audio = null;
    if (recording.audio) {
      try { audio = await state.voice.context.decodeAudioData(await (await fetch(pageUrl(`api/recordings/${id}/voice`))).arrayBuffer()); }
      catch (error) { console.warn('Replay without audio:', error); }
    }
    const speaker = recording.speaker || t('replay.unknownSpeaker');
    replayLabel.textContent = `🎙 ${speaker}`;
    const player = new ReplayPlayer({
      recording, avatar, audio, context: state.voice.context,
      onCaption: text => { $('replay-caption').hidden = !text; $('replay-caption').textContent = text ?? ''; layoutCaptions(); },
      onTime: (time, duration) => {
        $('replay-time').textContent = `${formatTime(time)} / ${formatTime(duration)}`;
        if (!state.seeking) $('replay-seek').value = String(Math.round(time / duration * 1000));
        document.body.dataset.replayTime = time.toFixed(2);
      },
      speaker,
      onEnd: () => { renderReplayButton(); setSpeaker(null); renderGuide(true); }
    });
    state.replay = { id, player, avatar, recording, speaker, follower: createFollower(navFloor), following: false, started: false, get paused() { return player.paused; } };
    $('replay-title').textContent = recording.title;
    $('replay-bar').hidden = false;
    document.body.classList.add('replaying');
    document.body.dataset.replay = id;
    const url = new URL(location.href);
    url.searchParams.set('replay', id);
    history.replaceState(null, '', url);
    renderReplayButton();
    setStatus(t('replay.ready', { title: recording.title }));
  } catch (error) { setStatus(t('replay.failed', { error: error.message })); }
}

function closeReplay() {
  if (!state.replay) return;
  state.replay.player.dispose();
  state.replay.avatar.root.removeFromParent();
  replayLabel.style.display = 'none';
  state.replay = null;
  stopFollow();
  world.followObject(state.avatar.root);
  $('replay-bar').hidden = true;
  $('replay-caption').hidden = true;
  document.body.classList.remove('replaying');
  delete document.body.dataset.replay;
  setSpeaker(null);
  const url = new URL(location.href);
  url.searchParams.delete('replay');
  history.replaceState(null, '', url);
  renderGuide(true);
}

function renderReplayButton() {
  const paused = state.replay?.player.paused ?? true;
  $('replay-play').textContent = paused ? '▶' : '⏸';
  document.body.dataset.replayPaused = String(paused);
}

function toggleReplay() {
  const player = state.replay?.player;
  if (!player) return;
  if (player.paused) { state.voice.stop(); player.play(); startFollow(); } else { player.pause(); setSpeaker(null); }
  renderReplayButton();
  renderGuide(true); // paused: questions are about where the recorded Avatar stands (R5.5)
}

// ---------- Follow in Replay (spec R8.1–R8.2, T22): warp beside the recorded Avatar, walk with it, frame both ----------
/** The navmesh for Follow: Recast paths and wall-sliding steps, with the floor height from the Map's ground raycast. */
const onGround = (point, fromY = point?.[1]) => {
  if (!point) return null;
  const ground = world.groundAt(point[0], point[2], fromY, 0.6, 1.5);
  return [point[0], ground ?? point[1], point[2]];
};
const navFloor = {
  path: (from, to) => world.navigation?.path(from, to) ?? null,
  move: (from, to) => onGround(world.navigation?.move(from, to), from[1]),
  snap: (point, half) => onGround(world.navigation?.snap(point, half))
};
const leaderOf = replay => ({ position: replay.avatar.root.position.toArray(), rotY: replay.avatar.root.rotation.y, speed: replay.player.paused ? 0 : replay.player.speed ?? 0 });

function startFollow() {
  const replay = state.replay;
  if (!replay) return;
  const leader = leaderOf(replay);
  if (flight) { flight = null; state.avatar.setFlying(false); } // Follow walks: the warp ends a flight
  state.avatar.place(warpBeside(navFloor, leader), leader.rotY);
  replay.follower.reset();
  replay.following = true;
  replay.started = true;
  if (world.follow?.object !== cameraProxy) {
    // The one camera jump of the warp: aim at the midpoint, keep the viewing angle, then follow it smoothly.
    cameraProxy.position.copy(state.avatar.root.position).lerp(replay.avatar.root.position, 0.5);
    const offset = world.camera.position.clone().sub(world.controls.target);
    world.controls.target.copy(cameraProxy.position).add(new THREE.Vector3(0, 1, 0));
    world.camera.position.copy(world.controls.target).add(offset);
    world.followObject(cameraProxy);
  }
  renderFollow();
}

/** WASD or F (T23/T24) or a walk command takes the Avatar back from Follow; "เดินตาม" / G resumes it. */
function stopFollow() {
  if (state.replay) state.replay.following = false;
  if (state.avatar.puppet) state.avatar.drive(false);
  renderFollow();
}

function renderFollow() {
  const following = Boolean(state.replay?.following);
  $('replay-follow').setAttribute('aria-pressed', String(following));
  document.body.dataset.following = String(following);
}

function followStep(dt) {
  const replay = state.replay;
  if (!replay?.following) return;
  const avatar = state.avatar;
  if (avatar.target) { stopFollow(); return; } // a walk command was given: it wins
  const step = replay.follower.step({ leader: leaderOf(replay), me: { position: avatar.root.position.toArray(), rotY: avatar.root.rotation.y }, dt, flash: Boolean(avatar.flash) });
  avatar.root.position.fromArray(step.position);
  avatar.root.rotation.y = step.rotY;
  avatar.drive(step.walking, step.speed);
}

/** Camera during a Replay: aims at the midpoint of both Avatars and zooms to fit them (6–60 m); one jump at the warp. */
const cameraProxy = new THREE.Object3D();
function replayCamera(dt) {
  const replay = state.replay;
  if (!replay?.started) return;
  const me = state.avatar.root.position, them = replay.avatar.root.position;
  const goal = me.clone().lerp(them, 0.5);
  if (cameraProxy.position.distanceTo(goal) > 8) cameraProxy.position.copy(goal);
  else cameraProxy.position.lerp(goal, 1 - Math.exp(-8 * dt));
  const halfFov = THREE.MathUtils.degToRad(world.camera.fov / 2) * Math.min(1, world.camera.aspect);
  const want = THREE.MathUtils.clamp((me.distanceTo(them) / 2) / Math.tan(halfFov) * 1.5 + 6, 6, 60);
  const offset = world.camera.position.clone().sub(world.controls.target);
  world.camera.position.copy(world.controls.target).add(offset.setLength(THREE.MathUtils.damp(offset.length(), want, 3, dt)));
}

// ---------- WASD Manual Control and click-to-walk (spec R8.3, T23) ----------
const heldKeys = new Set();
const typing = () => ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable || document.querySelector('dialog[open]');
const FLIGHT_KEYS = new Set([' ', 'shift']); // only while flying: Space otherwise plays/pauses a Replay
addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (typing() || event.ctrlKey || event.metaKey || event.altKey) return;
  if (key === 'f' && !event.repeat) { toggleFlight(); return; }
  if (FLIGHT_KEYS.has(key) && flight) { event.preventDefault(); heldKeys.add(key); return; }
  if (!MANUAL_KEYS.has(key)) return;
  if (!heldKeys.size) { state.avatar.cancel(); stopFollow(); } // the keys take over a walk or Follow
  heldKeys.add(key);
});
addEventListener('keyup', event => heldKeys.delete(event.key.toLowerCase()));
window.__app.flight = () => flight; // test hook
addEventListener('blur', () => heldKeys.clear());
let driving = false;
// ---------- Flight (spec R8.4, T24): F takes off and lands, Space/Shift up and down, WASD steers ----------
let flight = null; // { ceiling } while flying; { landing: floorY } while coming down after F
const rayDown = new THREE.Raycaster();
/** Top of the solid floor below (x, y, z): roofs, ceilings and clouds are not solid, so flight passes them. */
function floorBelow(x, y, z) {
  rayDown.set(new THREE.Vector3(x, y + 0.05, z), new THREE.Vector3(0, -1, 0));
  rayDown.far = 400;
  return rayDown.intersectObjects(world.solidMeshes ?? world.meshes, false)[0]?.point ?? null;
}
const rayAhead = new THREE.Raycaster();
/** A horizontal flight step is stopped by any solid mesh at knee or chest height (0.3 m and 1.2 m). */
function blockedAhead(from, to) {
  const direction = new THREE.Vector3(to[0] - from.x, 0, to[2] - from.z);
  const length = direction.length();
  if (length < 1e-6) return false;
  direction.normalize();
  for (const height of [0.3, 1.2]) {
    rayAhead.set(new THREE.Vector3(from.x, from.y + height, from.z), direction);
    rayAhead.far = length + 0.35;
    if (rayAhead.intersectObjects(world.solidMeshes ?? world.meshes, false).length) return true;
  }
  return false;
}

function toggleFlight() {
  const avatar = state.avatar;
  if (!avatar || !state.map || flight?.landing !== undefined) return;
  const here = avatar.root.position;
  if (!flight) {
    stopFollow();
    const { ceiling, position } = takeOff(here.toArray());
    flight = { ceiling };
    avatar.setFlying(true);
    here.fromArray(position);
    return;
  }
  // Land on the navmesh floor below (never a roof: roofs are not in the navmesh); else the nearest navmesh floor.
  const floor = floorBelow(here.x, here.y, here.z);
  const spot = (floor && navFloor.snap(floor.toArray(), { x: 1, y: 1, z: 1 })) ?? navFloor.snap([here.x, here.y - 30, here.z], { x: 8, y: 60, z: 8 });
  if (spot) { here.x = spot[0]; here.z = spot[2]; }
  flight = { landing: spot ? spot[1] : floor?.y ?? here.y };
}

function flightFrame(dt) {
  const avatar = state.avatar;
  const here = avatar.root.position;
  const flash = Boolean(avatar.flash);
  if (flight.landing !== undefined) {
    const { y, done } = landingStep({ y: here.y, floorY: flight.landing, dt, flash });
    here.y = y;
    if (done) { flight = null; avatar.setFlying(false); }
    return;
  }
  const keys = heldKeys;
  const probe = flightStep({ position: [0, 0, 0], rotY: 0, keys, dt, flash, ceiling: Infinity });
  const pieces = Math.max(1, Math.ceil(probe.speed * dt / 0.2));
  for (let i = 0; i < pieces; i += 1) {
    const floor = floorBelow(here.x, here.y, here.z)?.y ?? -Infinity;
    const step = flightStep({ position: here.toArray(), rotY: avatar.root.rotation.y, keys, dt: dt / pieces, flash, ceiling: flight.ceiling, floor });
    avatar.root.rotation.y = step.rotY;
    if (step.speed > 0 && !blockedAhead(here, step.to)) { here.x = step.to[0]; here.z = step.to[2]; }
    here.y = step.y;
  }
}

function manualFrame(dt) {
  const avatar = state.avatar;
  if (flight && avatar) { flightFrame(dt); return; }
  if (!avatar || avatar.target) return;
  const flash = Boolean(avatar.flash);
  const probe = heldKeys.size ? manualStep({ position: [0, 0, 0], rotY: 0, keys: heldKeys, dt, flash }) : null;
  if (!probe) { if (driving) { driving = false; avatar.drive(false); } return; }
  // Steps of ≤ 0.2 m: one long step (slow frame, Flash) can slide along the navmesh past a thin post (seen in testing).
  const pieces = Math.max(1, Math.ceil(probe.speed * dt / 0.2));
  const before = avatar.root.position.clone();
  for (let i = 0; i < pieces; i += 1) {
    const step = manualStep({ position: avatar.root.position.toArray(), rotY: avatar.root.rotation.y, keys: heldKeys, dt: dt / pieces, flash });
    avatar.root.rotation.y = step.rotY;
    if (step.speed <= 0) continue;
    const to = navFloor.move(avatar.root.position.toArray(), step.to); // slides along walls, never through them
    if (to) avatar.root.position.fromArray(to);
  }
  const moved = avatar.root.position.distanceTo(before) / Math.max(dt, 1e-6);
  driving = moved > 0.3;
  avatar.drive(driving, moved);
}
world.updaters.add(manualFrame);

/** Click (not drag) on the ground: walk there over the navmesh. Author mode keeps its own click (place a Station). */
if (!authorMode) {
  let pressed = null;
  world.renderer.domElement.addEventListener('pointerdown', event => { pressed = { x: event.clientX, y: event.clientY }; });
  world.renderer.domElement.addEventListener('pointerup', event => {
    if (!pressed || event.button !== 0 || Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 5) return;
    const hit = world.pick(event);
    const goal = hit && navFloor.snap(hit.point.toArray());
    if (!goal) return;
    stopFollow();
    const path = navFloor.path(state.avatar.root.position.toArray(), goal);
    state.avatar.walkTo(goal, undefined, { clicked: true }, path);
  });
}

world.updaters.add(dt => {
  state.recorder?.frame();
  if (state.recorder && state.recorder.status !== 'idle') $('record-time').textContent = formatTime(state.recorder.now());
  if (state.replay) {
    state.replay.player.frame(dt);
    followStep(dt);
    replayCamera(dt);
    // 🎙 label only while the recorded voice is actually heard; it hides after a short silence (R5.4).
    const loud = !state.replay.player.paused && state.replay.player.energy() > 0.01;
    if (loud) { state.replay.lastSound = performance.now(); if ($('speaker-label').dataset.kind !== 'recording') setSpeaker('recording', state.replay.speaker); }
    else if ($('speaker-label').dataset.kind === 'recording' && performance.now() - (state.replay.lastSound ?? 0) > 600) setSpeaker(null);
  }
});

$('replay-play').addEventListener('click', toggleReplay);
$('replay-follow').addEventListener('click', startFollow);
$('replay-close').addEventListener('click', closeReplay);
$('replay-seek').addEventListener('input', event => {
  if (!state.replay) return;
  state.seeking = true;
  state.replay.player.seek(Number(event.target.value) / 1000 * state.replay.player.duration);
});
$('replay-seek').addEventListener('change', () => { state.seeking = false; renderGuide(true); });
$('replay-volume').addEventListener('input', event => state.replay?.player.setVolume(Number(event.target.value)));
$('replay-mute').addEventListener('click', () => {
  const muted = $('replay-mute').getAttribute('aria-pressed') !== 'true';
  $('replay-mute').setAttribute('aria-pressed', String(muted));
  $('replay-mute').textContent = muted ? '🔇' : '🔊';
  state.replay?.player.setMuted(muted);
});
$('replay-cc').addEventListener('click', () => {
  const on = $('replay-cc').getAttribute('aria-pressed') !== 'true';
  $('replay-cc').setAttribute('aria-pressed', String(on));
  state.replay?.player.setCaptions(on);
});
addEventListener('keydown', event => {
  if (!state.replay || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.querySelector('dialog[open]')) return;
  const player = state.replay.player;
  if (event.code === 'Space') { event.preventDefault(); if (!flight) toggleReplay(); } // flying: Space rises
  else if (event.code === 'ArrowLeft') player.seek(player.t - 5);
  else if (event.code === 'ArrowRight') player.seek(player.t + 5);
  else if (event.code === 'KeyM') $('replay-mute').click();
  else if (event.code === 'KeyC') $('replay-cc').click();
  else if (event.code === 'KeyG') startFollow();
  else if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF'].includes(event.code)) stopFollow(); // hook: manual control (T23) and flight (T24)
});

// ---------- Recording list ----------
async function openRecordings() {
  const list = $('recordings-list');
  list.replaceChildren();
  const response = await fetch(pageUrl(`api/recordings?map=${state.map.id}`));
  const { recordings = [] } = await response.json();
  if (!recordings.length) list.innerHTML = `<li class="empty">${t('recordings.none')}</li>`;
  for (const recording of recordings) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = recording.title;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = t('recordings.meta', { time: formatTime(recording.duration), date: new Date(recording.createdAt).toLocaleString(), speaker: recording.speaker || t('replay.unknownSpeaker') });
    const play = document.createElement('button');
    play.type = 'button';
    play.textContent = t('recordings.play');
    play.addEventListener('click', () => { $('recordings-dialog').close(); startReplay(recording.id); });
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'secondary';
    copy.textContent = t('recordings.copy');
    copy.addEventListener('click', async () => {
      const url = new URL(location.href);
      url.search = `?map=${recording.mapId}&replay=${recording.id}`;
      try { await navigator.clipboard.writeText(url.href); setStatus(t('recordings.copied')); } catch { prompt(t('recordings.copy'), url.href); }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = t('recordings.delete');
    remove.addEventListener('click', async () => {
      if (!confirm(t('recordings.deleteConfirm', { title: recording.title }))) return;
      if (state.replay?.id === recording.id) closeReplay();
      const response = await fetch(pageUrl(`api/recordings/${recording.id}`), { method: 'DELETE' });
      if (!response.ok) { setStatus(t('record.failed', { error: (await response.json()).error })); return; }
      openRecordings();
    });
    if (!authorMode) remove.hidden = true; // deleting is for Authors (the server refuses others)
    item.append(title, play, copy, remove, meta);
    list.append(item);
  }
  if (!$('recordings-dialog').open) $('recordings-dialog').showModal();
}
$('open-recordings').addEventListener('click', openRecordings);
$('recordings-close').addEventListener('click', () => $('recordings-dialog').close());

// A shared Replay link opens straight into the player (runs last: the Replay code above must be initialised).
if (params.get('replay') && state.map) await startReplay(params.get('replay'));

// ---------- Guide voice page (Author mode, spec R6.3) ----------
if (authorMode) {
  $('voice-tools').hidden = false;
  const voiceForm = { audio: null, recorder: null, chunks: [], started: 0, timer: null };
  const setVoiceStatus = text => { $('voice-page-status').textContent = text; };

  async function renderVoiceProfiles() {
    const list = $('voice-profile-list');
    const { profiles = [] } = await (await fetch(pageUrl('api/voice/profiles'))).json();
    list.replaceChildren();
    if (!profiles.length) list.innerHTML = `<li class="empty">${t('voicePage.none')}</li>`;
    for (const profile of profiles) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = profile.name + (profile.active ? ` · ${t('voicePage.active')}` : '');
      const button = (label, className, onClick) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = className; b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
      };
      const use = button(t('voicePage.use'), 'secondary', async () => {
        const response = await fetch(pageUrl(`api/voice/profiles/${profile.id}/activate`), { method: 'POST' });
        if (!response.ok) { setVoiceStatus(t('voicePage.failed', { error: (await response.json()).error })); return; }
        state.voice.voiceAvailable = true;
        renderVoiceProfiles();
      });
      use.disabled = profile.active;
      const preview = button(t('voicePage.preview'), 'secondary', async () => {
        setVoiceStatus(t('voicePage.previewing'));
        state.voice.unlock();
        try {
          const response = await fetch(pageUrl('api/voice/preview'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId: profile.id, text: t('voicePage.previewText'), lang: lang() }) });
          if (!response.ok) throw new Error((await response.json()).error);
          const buffer = await state.voice.context.decodeAudioData(await response.arrayBuffer());
          const source = state.voice.context.createBufferSource();
          source.buffer = buffer;
          source.connect(state.voice.context.destination);
          source.start();
          setVoiceStatus('');
        } catch (error) { setVoiceStatus(t('voicePage.failed', { error: error.message })); }
      });
      const remove = button(t('voicePage.delete'), 'danger', async () => {
        if (!confirm(t('voicePage.deleteConfirm', { name: profile.name }))) return;
        const response = await fetch(pageUrl(`api/voice/profiles/${profile.id}`), { method: 'DELETE' });
        if (!response.ok) setVoiceStatus(t('voicePage.failed', { error: (await response.json()).error }));
        renderVoiceProfiles();
      });
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = t('voicePage.meta', { seconds: profile.durationSeconds, owner: profile.consent?.ownerName || t(profile.consent?.ownership === 'permission' ? 'voicePage.permission' : 'voicePage.self') });
      item.append(name, use, preview, remove, meta);
      list.append(item);
    }
  }

  function showSample(blob) {
    voiceForm.audio = blob;
    $('voice-sample').src = URL.createObjectURL(blob);
    $('voice-sample').hidden = false;
  }

  $('voice-record').addEventListener('click', async () => {
    if (voiceForm.recorder) { voiceForm.recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      voiceForm.chunks = [];
      recorder.ondataavailable = event => voiceForm.chunks.push(event.data);
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        clearInterval(voiceForm.timer);
        voiceForm.recorder = null;
        $('voice-record').textContent = t('voicePage.record');
        showSample(new Blob(voiceForm.chunks, { type: recorder.mimeType }));
      };
      recorder.start();
      voiceForm.recorder = recorder;
      voiceForm.started = performance.now();
      $('voice-record').textContent = t('voicePage.stopRecord');
      voiceForm.timer = setInterval(() => { $('voice-record-time').textContent = `${((performance.now() - voiceForm.started) / 1000).toFixed(0)} s`; }, 250);
    } catch (error) { setVoiceStatus(t('voicePage.failed', { error: error.message })); }
  });
  $('voice-file').addEventListener('change', event => { if (event.target.files[0]) showSample(event.target.files[0]); });
  $('voice-form').addEventListener('submit', async event => {
    event.preventDefault();
    const transcript = $('voice-transcript').value.trim();
    if (!voiceForm.audio || !transcript || !$('voice-consent').checked) { setVoiceStatus(t('voicePage.needAll')); return; }
    setVoiceStatus(t('voicePage.saving'));
    try {
      const ownership = document.querySelector('input[name="voice-ownership"]:checked').value;
      const response = await fetch(pageUrl('api/voice/profiles'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: await blobToBase64(voiceForm.audio), transcript, name: $('voice-name').value,
          consent: { confirmed: true, ownership, ownerName: $('voice-owner-name').value } }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setVoiceStatus(t('voicePage.saved'));
      $('voice-form').reset();
      $('voice-sample').hidden = true;
      voiceForm.audio = null;
      state.voice.voiceAvailable = true;
      renderVoiceProfiles();
    } catch (error) { setVoiceStatus(t('voicePage.failed', { error: error.message })); }
  });
  renderVoiceProfiles();
}
