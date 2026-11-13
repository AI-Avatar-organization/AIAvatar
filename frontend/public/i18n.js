/**
 * UI language (Thai / English). One switch drives the interface text, Station names, example commands
 * and the speech-to-text language. Choice is remembered per browser when storage is available.
 */
const strings = {
  th: {
    'loading.avatar': 'กำลังโหลดตัวละคร…', 'loading.gestures': 'กำลังเตรียมท่าทาง…',
    'loading.model': 'กำลังโหลดสถานที่ 3D…', 'loading.navigation': 'กำลังเตรียมเส้นทางเดิน…',
    'lang.name': 'ไทย', 'lang.switch': 'Switch to English', 'map.pick': 'เลือก Map', 'loading': 'กำลังโหลด…',
    'loading.map': 'กำลังโหลด Map…', 'loading.failed': 'โหลดไม่สำเร็จ: {error}', 'maps.none': 'ยังไม่มี Map ในโฟลเดอร์ maps/',
    'panel': 'แผงควบคุม', 'panel.toggle': 'พับแผง', 'show': 'แสดงในฉาก', 'show.pins': 'ชื่อ Pin', 'show.avatar': 'ชื่อ Avatar',
    'show.flash': 'Flash speed (ไปถึงทันที)', 'stations': 'Station ({count})',
    'stations.empty': 'Map นี้ยังไม่มี Station', 'stations.emptyAuthor': 'ยังไม่มี Station คลิกพื้นเพื่อเพิ่ม',
    'author.hint': 'คลิกบนพื้นเพื่อเพิ่ม Station (ลากเพื่อหมุนกล้อง)', 'author.spawn': 'ตั้งจุดเกิด = ตำแหน่ง Avatar',
    'author.save': 'บันทึก map.json', 'author.download': 'ดาวน์โหลด', 'author.mode': 'Author mode',
    'author.newName': 'ชื่อ Station ใหม่ (ไทย)', 'author.newNameEn': 'ชื่อภาษาอังกฤษ (ใช้เป็น id และคำเรียก, เว้นว่างได้)',
    'author.added': 'เพิ่ม {name} แล้ว อย่าลืมบันทึก', 'author.faced': '{name} หันหากล้องแล้ว', 'author.spawnSet': 'ตั้งจุดเกิดแล้ว',
    'author.saved': 'บันทึกแล้ว (version {version})',
    'voice': 'คำสั่งเสียง', 'voice.idle': 'กดไมค์ (หรือปุ่ม V) แล้วพูด เช่น “{example}”', 'voice.input': 'หรือพิมพ์คำสั่ง แล้วกด Enter',
    'voice.typeLabel': 'พิมพ์คำสั่ง', 'mic.start': 'เริ่มฟังคำสั่งเสียง', 'mic.stop': 'หยุดฟังและส่งคำสั่ง',
    'mic.listening': 'กำลังฟัง… กดอีกครั้งเมื่อพูดจบ', 'mic.failed': 'เปิดไมค์ไม่ได้: {error}', 'mic.transcribing': 'กำลังถอดเสียง…',
    'mic.nothing': 'ไม่ได้ยินคำพูด ลองใหม่อีกครั้ง', 'mic.tooShort': 'เสียงสั้นเกินไป ลองพูดใหม่', 'stt.failed': 'ถอดเสียงไม่สำเร็จ',
    'mic.fallback': 'ระบบถอดเสียงเต็ม ใช้การถอดเสียงของเบราว์เซอร์แทน (เสียงถูกส่งไปถอดที่บริการภายนอก) — กำลังฟัง… กดอีกครั้งเมื่อพูดจบ',
    'mic.repeat': 'ระบบถอดเสียงเต็มพอดี กรุณากดไมค์แล้วพูดอีกครั้ง (รอบนี้ใช้การถอดเสียงของเบราว์เซอร์)',
    'mic.typeInstead': 'ระบบถอดเสียงเต็มและเบราว์เซอร์นี้ถอดเสียงเองไม่ได้ กรุณาพิมพ์คำสั่งแทน',
    'stt.by.server': 'ถอดโดยเซิร์ฟเวอร์', 'stt.by.browser': 'ถอดโดยเบราว์เซอร์ (บริการภายนอก)',
    'heard': 'ได้ยิน: “{text}” → {plan}', 'intent.goto': 'เดินไป {name}', 'intent.unknown': 'ไม่รู้จักสถานที่ “{query}”',
    'intent.gesture': 'ท่าทาง {name}', 'intent.stop': 'หยุด', 'intent.ask': 'คำถาม: {text}',
    'arrived': 'ถึง {name} แล้ว', 'notFound': 'ไม่พบ “{query}” ใน Map นี้ ลอง: {names}',
    'gestures': 'ท่าทาง', 'gesture.doing': 'กำลังทำท่า {name}', 'gesture.done': 'ทำท่า {name} แล้ว',
    'gesture.holding': 'ค้างท่า {name} อยู่ (สั่งเดินหรือพูดว่า “หยุด” เพื่อเลิก)', 'gesture.placeholder': 'ท่าชั่วคราว รอคลิป QuickMagic', 'ask.soon': 'คำถาม “{text}” — ระบบถามตอบจะมาใน Ticket 10',
    'pin.click': 'คลิก Pin', 'pin.say': 'กดไมค์แล้วพูดว่า', 'pin.alts': 'พูดแบบอื่นได้: {list}', 'pin.go': 'เดินไปเลย',
    'pin.close': 'ปิด', 'pin.name': 'ชื่อ (ไทย)', 'pin.nameEn': 'ชื่อ (อังกฤษ)', 'pin.aliases': 'คำเรียกอื่น (คั่นด้วย ,)',
    'pin.face': 'หันตามกล้อง', 'pin.delete': 'ลบ', 'goto.say': 'ไปที่{name}', 'goto.alt': 'ไป{name}', 'example': 'ไปที่…',
    'gesture.sayHint': 'พูดได้', 'voice.try': 'ลองพิมพ์หรือพูด: {example}', 'then': 'แล้ว',
    'gesture.edit': 'แก้ไขคำสั่งเสียงของ {name}', 'gesture.delete': 'ลบท่า {name}', 'gesture.editPrompt': 'คำสั่งเสียงของ “{name}” (คั่นด้วย ,)',
    'gesture.edited': 'บันทึกคำสั่งเสียงของ {name} แล้ว', 'gesture.deleteConfirm': 'ลบท่า “{name}” และไฟล์คลิป? ย้อนกลับไม่ได้', 'gesture.deleted': 'ลบท่า {name} แล้ว',
    'gesture.upload.converting': 'กำลังแปลงท่าให้เข้ากับ Avatar…', 'gesture.upload.badType': 'รองรับเฉพาะ .glb .fbx .bvh',

    'gesture.upload.heading': 'เพิ่ม Gesture ใหม่',
    'gesture.upload.file': 'ไฟล์ท่าทาง (.glb .fbx .bvh)',
    'gesture.upload.id': 'ID (a-z, 0-9, -)',
    'gesture.upload.name': 'ชื่อไทย',
    'gesture.upload.nameEn': 'ชื่ออังกฤษ (ไม่บังคับ)',
    'gesture.upload.aliases': 'คำสั่งเสียง (คั่นด้วย ,)',
    'gesture.upload.loop': 'Loop (เล่นวนซ้ำ)',
    'gesture.upload.add': 'Add Gesture',
    'gesture.upload.missing': 'กรุณากรอกข้อมูลให้ครบ',
    'gesture.upload.notGlb': 'ไฟล์ไม่ใช่ GLB ที่ถูกต้อง',
    'gesture.upload.uploading': 'กำลังอัปโหลด…',
    'gesture.upload.reloading': 'โหลด Gesture ใหม่…',
    'gesture.upload.success': 'เพิ่ม "{name}" สำเร็จ 🎉',
    'gesture.upload.error': 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง',
  },
  en: {
    'loading.avatar': 'Loading avatar…', 'loading.gestures': 'Preparing gestures…',
    'loading.model': 'Loading the 3D location…', 'loading.navigation': 'Preparing walking paths…',
    'lang.name': 'English', 'lang.switch': 'เปลี่ยนเป็นภาษาไทย', 'map.pick': 'Choose a Map', 'loading': 'Loading…',
    'loading.map': 'Loading Map…', 'loading.failed': 'Could not load: {error}', 'maps.none': 'No Map in the maps/ folder yet',
    'panel': 'Control panel', 'panel.toggle': 'Collapse panel', 'show': 'Show in the scene', 'show.pins': 'Pin names',
    'show.avatar': 'Avatar name', 'show.flash': 'Flash speed (arrive instantly)', 'stations': 'Stations ({count})',
    'stations.empty': 'This Map has no Stations yet', 'stations.emptyAuthor': 'No Stations yet. Click the ground to add one',
    'author.hint': 'Click the ground to add a Station (drag to orbit)', 'author.spawn': 'Set spawn = Avatar position',
    'author.save': 'Save map.json', 'author.download': 'Download', 'author.mode': 'Author mode',
    'author.newName': 'New Station name (Thai)', 'author.newNameEn': 'English name (used as id and command word, optional)',
    'author.added': 'Added {name}. Remember to save', 'author.faced': '{name} now faces the camera', 'author.spawnSet': 'Spawn set',
    'author.saved': 'Saved (version {version})',
    'voice': 'Voice commands', 'voice.idle': 'Press the mic (or V) and say e.g. “{example}”', 'voice.input': 'Or type a command and press Enter',
    'voice.typeLabel': 'Type a command', 'mic.start': 'Start listening', 'mic.stop': 'Stop and send',
    'mic.listening': 'Listening… press again when you finish', 'mic.failed': 'Microphone unavailable: {error}',
    'mic.transcribing': 'Transcribing…', 'mic.nothing': 'Didn’t catch that. Please try again', 'mic.tooShort': 'Too short. Please speak again',
    'stt.failed': 'Transcription failed',
    'mic.fallback': 'Speech service is full, using your browser’s speech recognition (audio is sent to an outside service) — listening… press again when you finish',
    'mic.repeat': 'Speech service just filled up. Please press the mic and speak again (this time your browser transcribes)',
    'mic.typeInstead': 'Speech service is full and this browser cannot transcribe speech. Please type your command',
    'stt.by.server': 'Transcribed by server', 'stt.by.browser': 'Transcribed by browser (outside service)',
    'heard': 'Heard: “{text}” → {plan}', 'intent.goto': 'walk to {name}', 'intent.unknown': 'unknown place “{query}”',
    'intent.gesture': 'gesture {name}', 'intent.stop': 'stop', 'intent.ask': 'question: {text}',
    'arrived': 'Arrived at {name}', 'notFound': '“{query}” is not on this Map. Try: {names}',
    'gestures': 'Gestures', 'gesture.doing': 'Doing {name}', 'gesture.done': 'Finished {name}',
    'gesture.holding': 'Holding {name} (walk somewhere or say “stop” to end)', 'gesture.placeholder': 'Placeholder until the QuickMagic clip', 'ask.soon': 'Question “{text}” — Q&A arrives in Ticket 10',
    'pin.click': 'Pin click', 'pin.say': 'Press the mic and say', 'pin.alts': 'Also works: {list}', 'pin.go': 'Walk there',
    'pin.close': 'Close', 'pin.name': 'Name (Thai)', 'pin.nameEn': 'Name (English)', 'pin.aliases': 'Other names (comma separated)',
    'pin.face': 'Face the camera', 'pin.delete': 'Delete', 'goto.say': 'go to {name}', 'goto.alt': 'go to {name}', 'example': 'go to…',
    'gesture.sayHint': 'Say', 'voice.try': 'Try typing or saying: {example}', 'then': 'then',
    'gesture.edit': 'Edit voice commands for {name}', 'gesture.delete': 'Delete {name}', 'gesture.editPrompt': 'Voice commands for “{name}” (comma separated)',
    'gesture.edited': 'Saved voice commands for {name}', 'gesture.deleteConfirm': 'Delete “{name}” and its clip file? This cannot be undone', 'gesture.deleted': 'Deleted {name}',
    'gesture.upload.converting': 'Converting the motion to this Avatar…', 'gesture.upload.badType': 'Only .glb .fbx .bvh are supported',

    'gesture.upload.heading': 'Add New Gesture',
    'gesture.upload.file': 'Motion file (.glb .fbx .bvh)',
    'gesture.upload.id': 'ID (a-z, 0-9, -)',
    'gesture.upload.name': 'Thai name',
    'gesture.upload.nameEn': 'English name (optional)',
    'gesture.upload.aliases': 'Voice commands (comma-separated)',
    'gesture.upload.loop': 'Loop (play on repeat)',
    'gesture.upload.add': 'Add Gesture',
    'gesture.upload.missing': 'Please fill in all required fields',
    'gesture.upload.notGlb': 'File is not a valid GLB',
    'gesture.upload.uploading': 'Uploading…',
    'gesture.upload.reloading': 'Reloading gestures…',
    'gesture.upload.success': 'Added "{name}" successfully 🎉',
    'gesture.upload.error': 'An error occurred, please try again',
  }
};

export const LANGUAGES = ['th', 'en'];
let current = 'th';
try { const saved = localStorage.getItem('avatar3d.lang'); if (LANGUAGES.includes(saved)) current = saved; } catch { /* storage unavailable */ }
const listeners = new Set();

export const lang = () => current;

export function t(key, vars = {}) {
  const template = strings[current][key] ?? strings.th[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

export function setLang(next) {
  if (!LANGUAGES.includes(next) || next === current) return;
  current = next;
  try { localStorage.setItem('avatar3d.lang', next); } catch { /* storage unavailable */ }
  applyI18n();
  for (const listener of listeners) listener(next);
}

export const onLangChange = listener => listeners.add(listener);

/** Fill [data-i18n] text and [data-i18n-<attr>] attributes (aria-label, placeholder, title). */
export function applyI18n(root = document) {
  document.documentElement.lang = current;
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const attribute of ['aria-label', 'placeholder', 'title']) {
    const key = 'i18n' + attribute.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
    for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) element.setAttribute(attribute, t(element.dataset[key]));
  }
}

/** Display name of a Station or Map in the current language (English falls back to the first Latin alias). */
export function nameOf(entry) {
  if (current === 'en') return entry.nameEn || entry.aliases?.find(alias => /^[a-z]/i.test(alias))?.replace(/\b\w/g, c => c.toUpperCase()) || entry.name;
  return entry.name;
}
