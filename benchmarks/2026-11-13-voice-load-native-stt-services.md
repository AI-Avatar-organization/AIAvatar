# Voice Command load benchmark (native)

วันที่ 2026-11-12T21:07:51.765Z · เครื่อง Apple M5 (10 คอร์, RAM 16 GiB, darwin arm64)
ข้อจำกัด: native ไม่จำกัด CPU, STT ใช้ MPS ถ้ามี · STT Service ไทย 3 worker, อังกฤษ 2 worker · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-load.mjs --workers-th 3 --workers-en 2 --label stt-services`

## ต้นทุนของแต่ละโมเดลและของทั้งระบบ

| ภาษา | โมเดล@device | worker | โหลดโมเดลตอนเริ่ม (ms, ช้าสุด) | RAM ต่อ worker (MiB) | GPU memory ต่อ worker (MiB) |
|---|---|---|---|---|---|
| th | biodatlab/whisper-th-small-combined@mps | 3 | 4732 | 137 | 1523 |
| en | openai/whisper-base.en@mps | 2 | 4307 | 132 | 1267 |

ทั้งระบบตอนว่าง: RAM 845 MiB (other 33, stt-service 84, web-app 52, stt-worker-en 264, stt-worker-th 412) + GPU memory 7103 MiB = **7948 MiB** (บน Mac GPU memory เป็นส่วนหนึ่งของ RAM 16 GiB เดียวกัน)

ffmpeg ต่อคำสั่ง (วัดแยกหนึ่งครั้ง เพราะทำงานสั้นกว่าช่วงสุ่มวัด): RAM peak 15 MiB, CPU 17 ms

## เวลาแต่ละขั้น (ms, median / p95) ตามจำนวนคนที่พูดพร้อมกัน

ขั้นของ End-to-End Latency ฝั่ง server: 2 upload · 3 ffmpeg · 4 รอ worker · 5 ถอดเสียง · 6 ส่งกลับ (ขั้น 1, 7, 8 อยู่ในเบราว์เซอร์ ดูหัวข้อ End-to-End Latency ด้านล่างเมื่อรัน `npm run bench:e2e` แล้ว)

| ภาษา | พร้อมกัน | ได้ slot | ไป Browser STT Fallback | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | รวมฝั่ง server | ถูก Station | เดินผิดที่ | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3/3 | 0 | 0 / 0 | 23 / 38 | 2 / 3 | 382 / 382 | 1 / 1 | 410 / 425 | 3/3 | 0 | biodatlab/whisper-th-small-combined@mps |
| th | 3 | 9/9 | 0 | 0 / 0 | 36 / 46 | 2 / 4 | 841 / 910 | 1 / 3 | 881 / 951 | 7/9 | 0 | biodatlab/whisper-th-small-combined@mps |
| th | 5 | 9/15 | 6 | 0 / 0 | 25 / 37 | 2 / 2 | 816 / 1041 | 1 / 5 | 858 / 1071 | 7/9 | 0 | biodatlab/whisper-th-small-combined@mps |
| th | 6 | 9/18 | 9 | 0 / 0 | 33 / 37 | 2 / 3 | 808 / 858 | 1 / 5 | 850 / 900 | 7/9 | 0 | biodatlab/whisper-th-small-combined@mps |
| en | 1 | 3/3 | 0 | 0 / 0 | 25 / 37 | 2 / 2 | 110 / 130 | 0 / 1 | 151 / 155 | 3/3 | 0 | openai/whisper-base.en@mps |
| en | 3 | 6/9 | 3 | 0 / 0 | 35 / 38 | 2 / 3 | 174 / 303 | 1 / 1 | 210 / 344 | 6/6 | 0 | openai/whisper-base.en@mps |
| en | 5 | 6/15 | 9 | 0 / 0 | 36 / 42 | 2 / 2 | 173 / 192 | 1 / 2 | 220 / 235 | 6/6 | 0 | openai/whisper-base.en@mps |
| en | 6 | 6/18 | 12 | 0 / 0 | 34 / 36 | 2 / 3 | 156 / 184 | 1 / 4 | 196 / 225 | 6/6 | 0 | openai/whisper-base.en@mps |
| mix | 1 | 3/3 | 0 | 0 / 0 | 30 / 35 | 2 / 2 | 349 / 416 | 1 / 1 | 389 / 449 | 2/3 | 0 | biodatlab/whisper-th-small-combined@mps |
| mix | 3 | 9/9 | 0 | 0 / 0 | 31 / 44 | 2 / 3 | 589 / 701 | 1 / 6 | 621 / 739 | 7/9 | 0 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |
| mix | 5 | 15/15 | 0 | 0 / 0 | 39 / 50 | 2 / 4 | 900 / 1042 | 1 / 5 | 944 / 1088 | 13/15 | 0 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |
| mix | 6 | 15/18 | 3 | 0 / 0 | 35 / 40 | 2 / 5 | 864 / 1052 | 2 / 6 | 902 / 1096 | 13/15 | 0 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |

p95 จากตัวอย่างน้อย ใกล้เคียงค่าสูงสุด · 2 upload วัดบน localhost จึงเกือบ 0 · 4 รอ worker = เวลาที่อยู่กับ STT Service แต่ไม่ได้ถอดเสียง (worker ไม่ต่อคิว) · 6 ส่งกลับ = เวลาที่ client วัดได้ลบเวลาฝั่ง server

## ทรัพยากรต่อ process (ระหว่างแต่ละระดับ, RAM peak / CPU avg)

| ภาษา | พร้อมกัน | web-app | stt-service | stt-worker-th | stt-worker-en | ffmpeg | STT worker CPU ต่อคำสั่ง (ms) |
|---|---|---|---|---|---|---|---|
| th | 1 | 58 MiB / 2% | 91 MiB / 1% | 432 MiB / 14% | 279 MiB / 0% | – | 100 |
| th | 3 | 60 MiB / 1% | 96 MiB / 0% | 461 MiB / 31% | 274 MiB / 0% | 40 MiB / 2% | 122 |
| th | 5 | 62 MiB / 1% | 96 MiB / 1% | 480 MiB / 32% | 232 MiB / 0% | – | 133 |
| th | 6 | 62 MiB / 1% | 98 MiB / 0% | 490 MiB / 29% | 230 MiB / 0% | – | 111 |
| en | 1 | 63 MiB / 1% | 98 MiB / 1% | 490 MiB / 0% | 234 MiB / 12% | – | 33 |
| en | 3 | 63 MiB / 1% | 98 MiB / 1% | 489 MiB / 0% | 266 MiB / 27% | 1 MiB / 1% | 67 |
| en | 5 | 61 MiB / 2% | 98 MiB / 0% | 342 MiB / 0% | 279 MiB / 21% | – | 50 |
| en | 6 | 63 MiB / 2% | 98 MiB / 1% | 343 MiB / 0% | 279 MiB / 17% | – | 33 |
| mix | 1 | 64 MiB / 1% | 99 MiB / 0% | 375 MiB / 17% | 279 MiB / 0% | – | 100 |
| mix | 3 | 66 MiB / 1% | 100 MiB / 1% | 375 MiB / 28% | 241 MiB / 5% | – | 100 |
| mix | 5 | 67 MiB / 2% | 100 MiB / 1% | 391 MiB / 32% | 241 MiB / 9% | – | 113 |
| mix | 6 | 66 MiB / 1% | 95 MiB / 0% | 392 MiB / 28% | 241 MiB / 7% | – | 93 |

หมายเหตุ: CPU% คิดจากเวลา CPU สะสมต่อเวลาจริง (100% = 1 คอร์) · GPU memory คือหน่วยความจำ MPS ที่ worker จองไว้ (unified memory) ไม่มีค่า GPU utilization เพราะต้องใช้ sudo powermetrics

<!-- e2e:start -->
## End-to-End Latency ในเบราว์เซอร์ (ms, median / p95) — http://127.0.0.1:3321

STT Service ไทย 3 worker, อังกฤษ 2 worker · วันที่ 2026-11-12T21:08:40.838Z · Chrome อัตโนมัติ (headless, WebGL แบบ SwiftShader) 6 หน้าต่างบนเครื่องเดียวกับ server · ใช้ไฟล์เสียงแทนไมค์ · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-e2e.mjs --workers-th 3 --workers-en 2 --report docs/benchmarks/2026-11-13-voice-load-native-stt-services.md` · ข้อมูลดิบ: 2026-11-13-voice-e2e-local.json

| ภาษา | พร้อมกัน | n (server) | 1 หยุดอัด | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | 7 parseCommand | 8 วางเส้นทาง + Avatar เริ่มเดิน | **End-to-End รวม** | ไป Browser STT Fallback | ถึง Station ถูก | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3 | 53 / 53 | 0 / 0 | 31 / 44 | 4 / 5 | 494 / 541 | 2 / 2 | 2 / 4 | 0 / 0 | **590 / 634** | 0 | 3/3 | biodatlab/whisper-th-small-combined@mps |
| th | 3 | 9 | 53 / 67 | 0 / 1 | 40 / 184 | 6 / 16 | 1239 / 1515 | 4 / 9 | 5 / 7 | 1 / 5 | **1349 / 1642** | 0 | 9/9 | biodatlab/whisper-th-small-combined@mps |
| th | 5 | 9 | 53 / 54 | 0 / 0 | 42 / 61 | 5 / 13 | 1159 / 1358 | 3 / 8 | 5 / 8 | 1 / 5 | **1264 / 1488** | 6 | 15/15 | biodatlab/whisper-th-small-combined@mps |
| th | 6 | 9 | 53 / 54 | 0 / 0 | 46 / 153 | 5 / 13 | 1365 / 1689 | 3 / 4 | 4 / 12 | 2 / 5 | **1493 / 1828** | 9 | 18/18 | biodatlab/whisper-th-small-combined@mps |
| en | 1 | 3 | 53 / 53 | 0 / 0 | 31 / 34 | 5 / 9 | 201 / 219 | 1 / 2 | 1 / 1 | 0 / 0 | **297 / 316** | 0 | 3/3 | openai/whisper-base.en@mps |
| en | 3 | 6 | 53 / 53 | 0 / 0 | 34 / 61 | 5 / 43 | 348 / 2117 | 2 / 4 | 3 / 5 | 0 / 2 | **454 / 2254** | 3 | 9/9 | openai/whisper-base.en@mps |
| en | 5 | 6 | 53 / 53 | 0 / 0 | 34 / 61 | 9 / 14 | 412 / 503 | 4 / 5 | 4 / 12 | 0 / 6 | **516 / 623** | 9 | 15/15 | openai/whisper-base.en@mps |
| en | 6 | 6 | 52 / 53 | 0 / 0 | 54 / 75 | 22 / 91 | 418 / 511 | 4 / 19 | 1 / 10 | 0 / 7 | **577 / 667** | 12 | 18/18 | openai/whisper-base.en@mps |
| mix | 1 | 3 | 53 / 53 | 0 / 0 | 29 / 32 | 5 / 6 | 412 / 423 | 1 / 2 | 2 / 2 | 0 / 0 | **507 / 510** | 0 | 3/3 | biodatlab/whisper-th-small-combined@mps |
| mix | 3 | 9 | 53 / 54 | 0 / 0 | 36 / 58 | 7 / 37 | 775 / 1825 | 4 / 26 | 2 / 5 | 0 / 0 | **890 / 1923** | 0 | 9/9 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |
| mix | 5 | 15 | 53 / 85 | 0 / 2 | 36 / 102 | 11 / 98 | 1130 / 1836 | 6 / 246 | 4 / 13 | 1 / 4 | **1238 / 2002** | 0 | 15/15 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |
| mix | 6 | 15 | 53 / 57 | 0 / 0 | 38 / 169 | 14 / 87 | 1196 / 1608 | 5 / 32 | 4 / 15 | 1 / 2 | **1379 / 1797** | 3 | 18/18 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |

End-to-End รวม = ตั้งแต่กดหยุดอัดจนถึง Avatar เริ่มเดิน (เป้าหมาย ≤ 3000 ms) · 6 ส่งกลับ = เวลา request ที่เบราว์เซอร์วัดลบเวลาฝั่ง server · 2 upload = เวลาที่ server อ่าน body เท่านั้น การเชื่อมต่อ/TLS/hop ของ URL สาธารณะจึงไปรวมอยู่ใน 6 ส่งกลับ · 4 รอ worker รวมเวลาเริ่ม worker และโหลดโมเดลถ้ามี · 7 และ 8 วัดในเบราว์เซอร์ที่ใช้ CPU เรนเดอร์ 3D (SwiftShader) และแย่ง CPU กับ server จึงช้ากว่าเครื่องของ Visitor จริงที่มี GPU · เปิดโหมด Flash ให้ Avatar ถึงเร็ว (ไม่กระทบขั้น 8) · server: Apple M5, native
<!-- e2e:end -->
