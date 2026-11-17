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

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const authorMode = params.get('author') === '1';

const world = new World($('viewport'));
const labels = $('labels');
const state = { session: null, map: null, avatar: null, pins: new Map(), queue: Promise.resolve(), editing: null, gestures: [] };
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

$('toggle-flash').addEventListener('change', event => { state.avatar.flash = event.target.checked; });
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
      setStatus(t('ask.soon', { text: intent.text }));
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

// ---------- Avatar: Guest gets the default, a Member picks (ADR 0011) ----------
let avatarHooks = [];

/** Wire an Avatar into the world and the UI; returns undo functions so a swap can unhook the previous one. */
function attachAvatar(avatar) {
  state.avatar = avatar;
  avatar.groundAt = (...args) => world.groundAt(...args);
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
  hooks.push(avatar.onChange(event => { if (event.type === 'walk-start') renderGestureActive(null); }));
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
  $('avatar-member-only').hidden = can.avatarPicker || !session.enabled;
  $('avatar-section').hidden = !can.avatarPicker && !session.enabled;
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

/** Which Avatar to open with: a Member's last pick; ?avatar= only in Author mode (testing); otherwise the default. */
function firstAvatar(session) {
  const wanted = features(session).avatarPicker ? savedAvatar(session) : authorMode ? params.get('avatar') : null;
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
