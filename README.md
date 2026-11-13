# AI Avatar 3D — แพ็กส่งมอบสำหรับ deploy

เว็บโลก 3D (อุทยาน ร.2 อัมพวา) ที่ Visitor สั่ง Avatar ด้วยเสียงหรือพิมพ์ เช่น "ไปที่ศาลาดนตรี", "go to the main hall", "โบกมือ"
รองรับ Visitor หลายคนพูดพร้อมกันโดยไม่ต่อคิว: แต่ละภาษามี STT Service ของตัวเอง ถ้าเต็มจะใช้การถอดเสียงของเบราว์เซอร์แทนทันที

> สร้างโฟลเดอร์นี้ใหม่จาก repo ได้ด้วย `npm run handoff` (โฟลเดอร์ `frontend`, `backend`, `assets`, `benchmarks`, `docs` ถูกสร้างใหม่ทุกครั้ง)

## Tech stack

| ส่วน | ใช้อะไร |
|---|---|
| Frontend | HTML + JavaScript (ES modules) ล้วน ไม่มี framework และไม่มีขั้นตอน build · Three.js 0.186 (3D) · recast-navigation 0.43 (หาทางเดิน) · MediaRecorder (อัดเสียง) · Web Speech API (fallback) |
| Backend | Node.js 22+ ใช้ `node:http` ในตัว (ไม่มี Express) · ffmpeg (แปลงเสียงเป็น WAV 16 kHz) |
| STT Service | Node.js คุม worker Python 3.10+ · PyTorch + Hugging Face transformers · Whisper |
| โมเดล STT | ไทย `biodatlab/whisper-th-small-combined` · อังกฤษ `openai/whisper-base.en` (float32, ใช้ GPU ผ่าน MPS บน Mac, CPU ใน Docker) |
| Deploy | Docker + Docker Compose · nginx 1.27 (HTTPS) · หรือรันตรงบน macOS |
| ข้อมูล | ไม่มีฐานข้อมูล: Map เป็นไฟล์ `map.json` + `.glb`, ท่าทางเป็น `manifest.json` + `.glb` |

## ในโฟลเดอร์นี้มีอะไร

```
handoff/
  frontend/public/     หน้าเว็บ: index.html, app.js (UI + คำสั่ง), world.js (ฉาก 3D), avatar.js, voice.js (ไมค์ + fallback), i18n.js (ไทย/อังกฤษ)
  frontend/shared/     command.mjs (แปลงข้อความเป็นคำสั่ง), route.mjs (วางเส้นทาง) ใช้ทั้งเบราว์เซอร์และ server
  backend/server/      index.mjs (เว็บแอป + API), stt.mjs (speech gateway: slot, ffmpeg), stt-service.mjs (STT Service), maps.mjs, gestures.mjs
  backend/scripts/     stt_worker.py (worker Python 1 ตัว = 1 โมเดล), start-all.mjs (เปิดทั้ง 3 ส่วนในคำสั่งเดียว)
  backend/package.json dependencies ของ Node (three, recast-navigation)
  assets/maps/         Map rama2-park: map.json (Station, จุดเกิด, ทางขึ้นบันได) + โมเดล 3D
  assets/models/       avatar.glb
  assets/gestures/     ท่าทาง: manifest.json + clips/*.glb
  deploy/              Dockerfile, compose.yaml, nginx.conf, .env.example, gen-cert.sh, run-native.sh, requirements.txt
  benchmarks/          รายงาน benchmark ฉบับเต็ม (ก่อน/หลัง)
  docs/                CONTEXT.md (ศัพท์ของโครงการ) และ ADR 0007, 0009, 0010 (เหตุผลของการออกแบบ STT)
```

## ระบบทำงานอย่างไร

```
เบราว์เซอร์ ──HTTPS──▶ nginx :443 ──▶ web :3300 ──▶ stt-th :3401  (worker ไทย × STT_WORKERS_TH)
                                        │        └──▶ stt-en :3402  (worker อังกฤษ × STT_WORKERS_EN)
                                        └── เสิร์ฟหน้าเว็บ, Map, Avatar, ท่าทาง
```

1. Visitor กดไมค์ → หน้าเว็บขอจอง slot ของภาษานั้น (`POST /api/stt/reserve?lang=th`) ตอบทันทีเสมอ
2. ได้ slot → อัดเสียง กดอีกครั้ง → ส่งเสียงพร้อม token (`POST /api/stt?lang=th&token=…`) → web แปลงด้วย ffmpeg → ส่งให้ worker ที่ว่าง
3. ได้ข้อความ → แปลงเป็นคำสั่งในเบราว์เซอร์ → Avatar เดินไป Station หรือทำท่า
4. **เต็ม** (worker ทุกตัวของภาษานั้นมีคนใช้): ใช้ **Browser STT Fallback** ทันที คือการถอดเสียงของเบราว์เซอร์เอง (Chrome, Edge, Safari)
   ซึ่ง**ส่งเสียงของ Visitor ไปถอดที่บริการภายนอก** (เช่น Google) และแม่นน้อยกว่า หน้าเว็บบอกข้อนี้ทุกครั้งที่ใช้
5. เต็มพอดีตอนส่งเสียง → ขอให้พูดอีกครั้ง และรอบนั้นใช้ fallback · เบราว์เซอร์ที่ไม่มีการถอดเสียง (Firefox) → ขอให้พิมพ์คำสั่งแทน
6. ถ้า STT Service ล่ม หน้าเว็บ, Map และคำสั่งพิมพ์ยังใช้ได้ คำสั่งเสียงจะบอกชัดว่าใช้ไม่ได้ (หรือใช้ fallback)

ไม่มีการต่อคิว: จำนวน slot ของแต่ละภาษา = จำนวน worker ของ STT Service ภาษานั้น slot ที่จองแล้วไม่ได้ใช้คืนเองหลัง 30 วินาที

## สเปกเครื่องขั้นต่ำ

| | Mac (แนะนำ, เร็วสุด) | Server Linux (Docker, CPU) |
|---|---|---|
| CPU / GPU | Apple Silicon (M1 ขึ้นไป) ใช้ GPU ผ่าน MPS | x86_64 หรือ arm64, 4 คอร์ขึ้นไป |
| RAM | 16 GiB (ระบบใช้ ~8 GiB ที่ ไทย 3 + อังกฤษ 2 worker) | ~1.4 GiB ต่อ worker ไทย, ~0.5 GiB ต่อ worker อังกฤษ, + 0.1 GiB web/nginx (วัดครั้งเดียว ดูด้านล่าง) |
| Disk | ~3 GB (โมเดล 2 ตัว + Python) | image ~1.3 GB + volume ของ Map |
| ซอฟต์แวร์ | Node 22+, ffmpeg, Python 3.10+ | Docker 24+ และ Docker Compose v2 |
| เครือข่าย | HTTPS เท่านั้น (เบราว์เซอร์อนุญาตไมค์เฉพาะ HTTPS หรือ localhost) | เปิดพอร์ต HTTPS (ค่าเริ่ม 3443) |

ความเร็ว End-to-End (median, benchmark 2026-11-13, `benchmarks/2026-11-13-summary-clim-vs-mac.md`, ไทย 3 + อังกฤษ 2 worker):

| | ไทย 1 คน | ไทย 3 คนพร้อมกัน | อังกฤษ 1 คน | 5 คน (ไทย 3 + อังกฤษ 2) | หน่วยความจำ |
|---|---|---|---|---|---|
| Mac M5 (GPU) | 0.6 s | 1.4 s | 0.4 s | 1.6 s | 46% ของ 16 GiB |
| Docker CPU 10 คอร์ (จำลอง CLIM000551VM01) | 3.2 s | 9.3 s | 0.9 s | 8.5 s | 41% ของ 16 GiB (6.5 GiB) |

บน CPU อย่างเดียว worker ไทยใช้ CPU 61–92% ของทั้งเครื่อง CPU จึงเป็นคอขวดเมื่อพูดไทยพร้อมกันหลายคน อังกฤษผ่านเป้า 3 วินาที
Docker CPU 4 คอร์ช้ากว่านี้อีก ดู `benchmarks/2026-11-13-voice-load-docker-4cpu-stt-services.md`
ตัวเลข CPU ของ server จริงขึ้นกับเครื่อง ให้วัดบนเครื่องนั้นก่อนตั้งจำนวน worker (ดู "วัดบนเครื่องใหม่")

## วิธีรันแบบ Docker (server Linux)

```bash
cd handoff
docker build -f deploy/Dockerfile -t ai-avatar-3d .        # x86 server: เพิ่ม --platform linux/amd64 · ครั้งแรกดาวน์โหลดโมเดล ~0.6 GB
cd deploy
cp .env.example .env                                         # ตั้งจำนวน worker, พอร์ต, RAM cap
./gen-cert.sh <ชื่อโดเมนหรือ IP>                             # self-signed สำหรับทดสอบ หรือวาง server.crt + server.key ของจริงใน certs/
docker compose up -d
docker compose ps                                            # stt-th และ stt-en ต้องเป็น healthy (โหลดโมเดล ~5 วินาทีบน M5 เครื่องช้ากว่านานกว่านี้)
curl -k https://localhost:3443/api/stt/status                # slots = จำนวน worker ที่พร้อม
```

เปิด `https://<server>:3443` · หยุด: `docker compose down` (ข้อมูล Map ที่แก้ใน Author mode อยู่ใน volume ไม่หาย)
อัปเดต: build image ใหม่ด้วย `IMAGE_TAG` ใหม่ ตั้งใน `.env` แล้ว `docker compose up -d` · ย้อนกลับ: ตั้ง `IMAGE_TAG` เดิมแล้ว `docker compose up -d`

ถ้ามี nginx หรือ reverse proxy อยู่แล้ว ไม่ต้องใช้ service `nginx` ใน compose ให้ proxy ไปที่ web:3300
(ต้องเปิด `client_max_body_size 25m` และ timeout ≥ 120 วินาที ดู `deploy/nginx.conf`)

## วิธีรันบน Mac (ใช้ GPU)

```bash
brew install node ffmpeg python@3.12
python3 -m pip install torch -r handoff/deploy/requirements.txt
# โหลดโมเดลครั้งแรก (ครั้งเดียว ~0.6 GB)
python3 -c "from huggingface_hub import snapshot_download as d; [d(m) for m in ['biodatlab/whisper-th-small-combined','openai/whisper-base.en']]"
cp handoff/deploy/.env.example handoff/deploy/.env            # ค่าเริ่ม ไทย 3 + อังกฤษ 2 worker (พอดี Mac 16 GiB)
handoff/deploy/run-native.sh                                  # เปิด web :3300 + STT ไทย + STT อังกฤษ, Ctrl-C หยุดทั้งหมด
```

`http://localhost:3300` ใช้ไมค์ได้บนเครื่องนั้น ถ้าให้คนอื่นเข้าต้องมี HTTPS ข้างหน้า เช่น nginx ใน `deploy/` หรือ Tailscale Funnel (ADR 0010)
รันแต่ละส่วนแยกได้: `STT_LANG=th STT_WORKERS=3 node server/stt-service.mjs`, `STT_SERVICE_TH=http://<host>:3401 STT_SERVICE_EN=… node server/index.mjs`

## การตั้งค่า (environment)

| ตัวแปร | ค่าเริ่ม | ความหมาย |
|---|---|---|
| `STT_WORKERS_TH` / `STT_WORKERS_EN` | 3 / 2 | จำนวน Visitor ที่พูดภาษานั้นพร้อมกันได้ คนที่เกินใช้ fallback |
| `STT_MODEL_TH` / `STT_MODEL_EN` | whisper-th-small-combined / whisper-base.en | โมเดล (ใน Docker ต้อง build ด้วย `--build-arg STT_MODELS="<th> <en>"`) |
| `STT_QUANTIZE` | ว่าง | `int8` = ย่อโมเดลบน CPU (บน Mac ช้ากว่า ต้องวัดบน server ก่อนใช้) |
| `STT_DEVICE` | อัตโนมัติ | `cpu` บังคับไม่ใช้ GPU |
| `SLOT_TTL_MS` | 30000 | slot ที่จองแล้วไม่ได้ใช้คืนเองหลังกี่ ms |
| `PORT`, `HOST` | 3300, 127.0.0.1 | ที่อยู่ของเว็บแอป |
| `STT_SERVICE_TH` / `STT_SERVICE_EN` | http://127.0.0.1:3401 / :3402 | ที่อยู่ STT Service ที่เว็บแอปเรียก |
| `MAPS_DIR`, `GESTURES_DIR` | maps/, gestures/ | โฟลเดอร์ข้อมูลที่แก้ได้ใน Author mode |
| `HTTPS_PORT` | 3443 | พอร์ตของ nginx ใน compose |

## API

| Method | Path | ใช้ทำอะไร |
|---|---|---|
| GET | `/api/maps`, `/api/maps/:id` | รายการ Map / Map เดียว (ใช้เป็น health check ของ web ด้วย) |
| PUT | `/api/maps/:id` | บันทึก map.json (Author mode) |
| GET / POST / PATCH / DELETE | `/api/gestures…` | ท่าทาง |
| POST | `/api/stt/reserve?lang=th\|en` | จอง slot → `{ token, expiresInMs }` หรือ 503 `{ busy: true, fallback: "browser" }` |
| POST | `/api/stt?lang=&token=&prompt=` | body = เสียง (webm/mp4/wav ≤ 8 MB) → `{ text, provider, transcribedBy, timings }` · 503 busy / unavailable |
| GET | `/api/stt/status` | slot ต่อภาษา (ทั้งหมด, จอง, ใช้อยู่, ว่าง), โมเดล, device |
| POST | `/api/stt/release?lang=&token=` | คืน slot ที่จองแต่ไม่ได้ใช้ (ไมค์เปิดไม่ได้, เสียงสั้นไป, ปิดหน้าเว็บ) |
| POST | `/api/stt/warmup` | เก็บไว้ให้หน้าเว็บรุ่นเก่า ไม่ทำอะไร |
| GET | STT Service `/health` | `{ ok, workers, ready, busy, model, device }` (200 เมื่อมี worker พร้อมอย่างน้อย 1 ตัว) |

## ผล Benchmark (Apple M5, 16 GiB, native MPS, 2026-11-13)

ไทย 3 worker + อังกฤษ 2 worker · End-to-End Latency = กดหยุดพูด → Avatar เริ่มเดิน (เป้าหมาย p95 ≤ 3 วินาที)

| พูดพร้อมกัน | ก่อน: ไทย (worker เดียว ต่อคิว) | หลัง: ไทย | หลัง: ไทย+อังกฤษ สลับกัน | รอ worker (หลัง) |
|---|---|---|---|---|
| 1 | 1.6 / 1.7 s | **0.6 / 0.6 s** | 0.5 / 0.5 s | ≤ 0.1 s |
| 3 | 3.0 / 4.1 s | **1.3 / 1.6 s** | 0.9 / 1.9 s | ≤ 0.1 s |
| 5 | 4.1 / 6.3 s | 1.3 / 1.5 s (2 คนใช้ fallback) | **1.2 / 2.0 s** (ทุกคนได้ server) | ≤ 0.1 s |
| 6 | 4.4 / 7.7 s | 1.5 / 1.8 s (3 คนใช้ fallback) | 1.4 / 1.8 s (1 คนใช้ fallback) | ≤ 0.1 s |

(median / p95) · ไม่มีใครรอคิว (รอ worker p95 ≤ 0.1 s คือเวลาส่งต่อ ไม่ใช่คิว; เดิม 5–6 วินาที) · ใน benchmark เบราว์เซอร์ Avatar ถึง Station ที่ถูก 135/135
· benchmark ฝั่ง server ถอดไทยตรง 7/9 ต่อระดับ (คลิป "สระน้ำ") แต่เดินผิดที่ 0 · หน่วยความจำทั้งระบบ 7.9 GiB
· 5 คนพูด**ไทยพร้อมกันทั้งหมด**: 3 คนได้ server อีก 2 คนใช้ fallback ถ้าต้องการให้ทั้ง 5 คนได้ server ต้องมี 5 worker ไทย (~9 GB, ต้องใช้ RAM มากกว่า 16 GiB)
รายละเอียดทุกขั้น (8 ขั้น), CPU/RAM/GPU ต่อ process และต่อโมเดล: `benchmarks/2026-11-13-before-after.md` และ `benchmarks/2026-11-13-voice-load-native-stt-services.md`

ความจุที่ออกแบบไว้: Concurrent Visitors ≤ 50 (เปิดเว็บพร้อมกัน), Simultaneous Voice Commands ≤ 5 (กดไมค์พร้อมกัน), End-to-End Latency ≤ 3 วินาที

### วัดบนเครื่องใหม่

ต้องใช้ repo เต็ม (มีเสียงทดสอบและสคริปต์ benchmark) ไม่ได้อยู่ในแพ็กนี้:
`npm run bench:load -- --workers-th 3 --workers-en 2` (ฝั่ง server), `npm run bench:e2e -- --url https://<server>:3443` (ผ่านเบราว์เซอร์)

## ข้อจำกัดที่รู้แล้ว

- ความแม่นวัดด้วยเสียงสังเคราะห์ของ macOS ยังไม่ได้วัดกับเสียงคนจริงและเสียงรบกวนในสถานที่ · ไทยพลาดคำว่า "สระน้ำ" (ได้ยินเป็น "สนาม") แต่ไม่ได้เดินผิดที่
- ยังไม่ได้ทดสอบ Visitor 50 คนเปิดหน้าเว็บพร้อมกันผ่านเครือข่ายจริง Visitor แต่ละคนโหลดไฟล์ 3D ~20 MB ครั้งแรก (50 คน ≈ 1 GB) ให้ตรวจ bandwidth ของที่ deploy
- Browser STT Fallback ส่งเสียงไปถอดที่บริการภายนอกของเบราว์เซอร์ และใช้ไม่ได้ใน Firefox
- Author mode (แก้ Map, เพิ่มท่าทาง) ไม่มีระบบ login ถ้าเปิดสู่สาธารณะควรปิดทางเข้าเหล่านี้ที่ proxy (`PUT /api/maps`, `POST/PATCH/DELETE /api/gestures`)
