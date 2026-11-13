# Voice Command load benchmark (native)

วันที่ 2026-11-13T04:39:51.878Z · เครื่อง Apple M5 (10 คอร์, RAM 16 GiB, darwin arm64)
ข้อจำกัด: native ไม่จำกัด CPU, STT ใช้ MPS ถ้ามี · STT Service ไทย 3 worker, อังกฤษ 2 worker · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-load.mjs --workers-th 3 --workers-en 2 --label mac`

## ต้นทุนของแต่ละโมเดลและของทั้งระบบ

| ภาษา | โมเดล@device | worker | โหลดโมเดลตอนเริ่ม (ms, ช้าสุด) | RAM ต่อ worker (MiB) | GPU memory ต่อ worker (MiB) |
|---|---|---|---|---|---|
| th | biodatlab/whisper-th-small-combined@mps | 3 | 8285 | 139 | 1523 |
| en | openai/whisper-base.en@mps | 2 | 5816 | 4 | 1267 |

ทั้งระบบตอนว่าง: RAM 473 MiB (launcher 2, stt-service 27, web-app 20, stt-worker-en 8, stt-worker-th 416) + GPU memory 7103 MiB = **7576 MiB** (บน Mac GPU memory เป็นส่วนหนึ่งของ RAM 16 GiB เดียวกัน)

ffmpeg ต่อคำสั่ง (วัดแยกหนึ่งครั้ง เพราะทำงานสั้นกว่าช่วงสุ่มวัด): RAM peak 15 MiB, CPU 17 ms

## เวลาแต่ละขั้น (ms, median / p95) ตามจำนวนคนที่พูดพร้อมกัน

ขั้นของ End-to-End Latency ฝั่ง server: 2 upload · 3 ffmpeg · 4 รอ worker · 5 ถอดเสียง · 6 ส่งกลับ (ขั้น 1, 7, 8 อยู่ในเบราว์เซอร์ ดูหัวข้อ End-to-End Latency ด้านล่างเมื่อรัน `npm run bench:e2e` แล้ว)

| ภาษา | พร้อมกัน | ได้ slot | ไป Browser STT Fallback | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | รวมฝั่ง server | ถูก Station | เดินผิดที่ | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3/3 | 0 | 0 / 0 | 32 / 37 | 3 / 3 | 379 / 383 | 1 / 1 | 416 / 426 | 3/3 | 0 | biodatlab/whisper-th-small-combined@mps |
| th | 3 | 9/9 | 0 | 0 / 0 | 34 / 40 | 2 / 3 | 851 / 903 | 1 / 4 | 891 / 947 | 7/9 | 0 | biodatlab/whisper-th-small-combined@mps |
| th | 5 | 9/15 | 6 | 0 / 0 | 28 / 39 | 2 / 3 | 801 / 1077 | 1 / 2 | 839 / 1119 | 7/9 | 0 | biodatlab/whisper-th-small-combined@mps |
| th | 6 | 9/18 | 9 | 0 / 1 | 28 / 46 | 2 / 2 | 814 / 878 | 1 / 4 | 863 / 926 | 7/9 | 0 | biodatlab/whisper-th-small-combined@mps |
| en | 1 | 3/3 | 0 | 0 / 0 | 35 / 39 | 2 / 3 | 112 / 300 | 1 / 1 | 155 / 341 | 3/3 | 0 | openai/whisper-base.en@mps |
| en | 3 | 6/9 | 3 | 0 / 0 | 35 / 45 | 2 / 3 | 171 / 365 | 1 / 6 | 212 / 414 | 6/6 | 0 | openai/whisper-base.en@mps |
| en | 5 | 6/15 | 9 | 0 / 0 | 36 / 39 | 2 / 3 | 178 / 190 | 1 / 3 | 220 / 235 | 6/6 | 0 | openai/whisper-base.en@mps |
| en | 6 | 6/18 | 12 | 0 / 0 | 35 / 40 | 2 / 2 | 171 / 180 | 2 / 4 | 213 / 222 | 6/6 | 0 | openai/whisper-base.en@mps |
| mix | 1 | 3/3 | 0 | 0 / 0 | 28 / 39 | 2 / 3 | 392 / 425 | 0 / 0 | 423 / 468 | 2/3 | 0 | biodatlab/whisper-th-small-combined@mps |
| mix | 3 | 9/9 | 0 | 0 / 0 | 26 / 36 | 2 / 2 | 594 / 703 | 1 / 3 | 626 / 743 | 7/9 | 0 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |
| mix | 5 | 15/15 | 0 | 0 / 0 | 36 / 54 | 2 / 4 | 898 / 1029 | 1 / 7 | 938 / 1088 | 13/15 | 0 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |
| mix | 6 | 15/18 | 3 | 0 / 0 | 37 / 50 | 2 / 3 | 903 / 1041 | 1 / 5 | 957 / 1085 | 13/15 | 0 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |

p95 จากตัวอย่างน้อย ใกล้เคียงค่าสูงสุด · 2 upload วัดบน localhost จึงเกือบ 0 · 4 รอ worker = เวลาที่อยู่กับ STT Service แต่ไม่ได้ถอดเสียง (worker ไม่ต่อคิว) · 6 ส่งกลับ = เวลาที่ client วัดได้ลบเวลาฝั่ง server

## ทรัพยากรต่อ process (ระหว่างแต่ละระดับ, RAM peak / CPU avg)

| ภาษา | พร้อมกัน | web-app | stt-service | stt-worker-th | stt-worker-en | ffmpeg | STT worker CPU ต่อคำสั่ง (ms) |
|---|---|---|---|---|---|---|---|
| th | 1 | 31 MiB / 1% | 43 MiB / 0% | 418 MiB / 15% | 99 MiB / 0% | 2 MiB / 1% | 100 |
| th | 3 | 34 MiB / 1% | 45 MiB / 1% | 452 MiB / 42% | 99 MiB / 0% | – | 178 |
| th | 5 | 35 MiB / 1% | 45 MiB / 0% | 460 MiB / 34% | 85 MiB / 0% | – | 133 |
| th | 6 | 35 MiB / 1% | 44 MiB / 0% | 450 MiB / 31% | 81 MiB / 0% | – | 111 |
| en | 1 | 35 MiB / 1% | 45 MiB / 0% | 450 MiB / 0% | 100 MiB / 17% | – | 67 |
| en | 3 | 32 MiB / 2% | 45 MiB / 2% | 258 MiB / 0% | 225 MiB / 24% | – | 67 |
| en | 5 | 33 MiB / 2% | 46 MiB / 0% | 248 MiB / 0% | 239 MiB / 18% | – | 50 |
| en | 6 | 34 MiB / 2% | 46 MiB / 1% | 248 MiB / 0% | 247 MiB / 18% | – | 50 |
| mix | 1 | 35 MiB / 1% | 47 MiB / 0% | 284 MiB / 19% | 219 MiB / 0% | – | 133 |
| mix | 3 | 38 MiB / 1% | 47 MiB / 1% | 339 MiB / 29% | 216 MiB / 5% | – | 100 |
| mix | 5 | 40 MiB / 2% | 47 MiB / 1% | 367 MiB / 33% | 218 MiB / 10% | – | 113 |
| mix | 6 | 40 MiB / 2% | 43 MiB / 1% | 372 MiB / 30% | 224 MiB / 7% | – | 100 |

## สัดส่วนการใช้เครื่อง (% ของ 10 คอร์ และ RAM 16 GiB ของเครื่อง: CPU เฉลี่ย / CPU สูงสุด / RAM สูงสุด)

| ภาษา | พร้อมกัน | web-app | stt-service | stt-worker-th | stt-worker-en | ffmpeg |
|---|---|---|---|---|---|---|
| th | 1 | 0.1% / 0.1% / 0.2% | 0.0% / 0.0% / 0.3% | 1.5% / 1.5% / 2.6% | 0.0% / 0.0% / 0.6% | 0.1% / 0.1% / 0.0% |
| th | 3 | 0.1% / 0.1% / 0.2% | 0.1% / 0.1% / 0.3% | 4.2% / 5.3% / 2.8% | 0.0% / 0.0% / 0.6% | – |
| th | 5 | 0.1% / 0.1% / 0.2% | 0.0% / 0.1% / 0.3% | 3.4% / 4.2% / 2.8% | 0.0% / 0.0% / 0.5% | – |
| th | 6 | 0.1% / 0.2% / 0.2% | 0.0% / 0.0% / 0.3% | 3.1% / 3.1% / 2.7% | 0.0% / 0.0% / 0.5% | – |
| en | 1 | 0.1% / 0.1% / 0.2% | 0.0% / 0.0% / 0.3% | 0.0% / 0.0% / 2.7% | 1.7% / 1.7% / 0.6% | – |
| en | 3 | 0.2% / 0.2% / 0.2% | 0.2% / 0.2% / 0.3% | 0.0% / 0.0% / 1.6% | 2.4% / 2.4% / 1.4% | – |
| en | 5 | 0.2% / 0.2% / 0.2% | 0.0% / 0.0% / 0.3% | 0.0% / 0.0% / 1.5% | 1.8% / 1.8% / 1.5% | – |
| en | 6 | 0.2% / 0.2% / 0.2% | 0.1% / 0.1% / 0.3% | 0.0% / 0.0% / 1.5% | 1.8% / 1.8% / 1.5% | – |
| mix | 1 | 0.1% / 0.1% / 0.2% | 0.0% / 0.0% / 0.3% | 1.9% / 1.9% / 1.7% | 0.0% / 0.0% / 1.3% | – |
| mix | 3 | 0.1% / 0.1% / 0.2% | 0.1% / 0.2% / 0.3% | 2.9% / 3.1% / 2.1% | 0.5% / 0.6% / 1.3% | – |
| mix | 5 | 0.2% / 0.2% / 0.2% | 0.1% / 0.1% / 0.3% | 3.3% / 3.4% / 2.2% | 1.0% / 1.5% / 1.3% | – |
| mix | 6 | 0.2% / 0.2% / 0.2% | 0.1% / 0.1% / 0.3% | 3.0% / 3.1% / 2.3% | 0.7% / 0.9% / 1.4% | – |

stt-worker-th = ทุก worker ของโมเดลไทยรวมกัน, stt-worker-en = ของโมเดลอังกฤษ · CPU สูงสุด = ช่วง 2 วินาทีที่ใช้มากที่สุด

### GPU utilization (ทั้ง GPU จาก ioreg, ตอนว่าง 5% เฉลี่ย / 84% สูงสุด มาจากแอปอื่นและจอ)

| ภาษา | พร้อมกัน | GPU เฉลี่ย | GPU สูงสุด | ส่วนที่เพิ่มจากตอนว่าง (เฉลี่ย) |
|---|---|---|---|---|
| th | 1 | 60% | 94% | 55% |
| th | 3 | 56% | 100% | 51% |
| th | 5 | 68% | 100% | 63% |
| th | 6 | 82% | 100% | 77% |
| en | 1 | 59% | 86% | 54% |
| en | 3 | 63% | 97% | 58% |
| en | 5 | 72% | 94% | 67% |
| en | 6 | 70% | 96% | 65% |
| mix | 1 | 67% | 94% | 62% |
| mix | 3 | 62% | 100% | 57% |
| mix | 5 | 81% | 100% | 76% |
| mix | 6 | 75% | 100% | 70% |

### ตอนว่าง (ทุก worker โหลดโมเดลแล้ว)

| process / โมเดล | จำนวน process | RAM (MiB) | % ของ RAM |
|---|---|---|---|
| launcher | 1 | 2 | 0.0% |
| stt-service | 2 | 27 | 0.2% |
| web-app | 1 | 20 | 0.1% |
| stt-worker-en | 2 | 8 | 0.0% |
| stt-worker-th | 3 | 416 | 2.5% |
| GPU memory โมเดล th (3 worker) | – | 4569 | 28% |
| GPU memory โมเดล en (2 worker) | – | 2534 | 15% |
| **รวม** | | **7576** | **46%** |

หมายเหตุ: CPU% คิดจากเวลา CPU สะสมต่อเวลาจริง (100% = 1 คอร์) · GPU memory คือหน่วยความจำ MPS ที่ worker จองไว้ (unified memory) GPU utilization วัดจาก ioreg ของ macOS ทั้ง GPU (รวมแอปอื่น) จึงแสดงคู่กับค่าตอนว่าง

<!-- e2e:start -->
## End-to-End Latency ในเบราว์เซอร์ (ms, median / p95) — http://127.0.0.1:3321

STT Service ไทย 3 worker, อังกฤษ 2 worker · วันที่ 2026-11-13T04:46:38.991Z · Chrome อัตโนมัติ (headless, WebGL แบบ SwiftShader) 6 หน้าต่างบนเครื่องเดียวกับ server · ใช้ไฟล์เสียงแทนไมค์ · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-e2e.mjs --workers-th 3 --workers-en 2 --report docs/benchmarks/2026-11-13-voice-load-native-mac.md` · ข้อมูลดิบ: 2026-11-13-voice-e2e-local.json

| ภาษา | พร้อมกัน | n (server) | 1 หยุดอัด | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | 7 parseCommand | 8 วางเส้นทาง + Avatar เริ่มเดิน | **End-to-End รวม** | ไป Browser STT Fallback | ถึง Station ถูก | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3 | 53 / 53 | 0 / 1 | 32 / 49 | 8 / 10 | 516 / 623 | 2 / 2 | 3 / 3 | 0 / 1 | **632 / 721** | 0 | 3/3 | biodatlab/whisper-th-small-combined@mps |
| th | 3 | 9 | 53 / 57 | 0 / 0 | 42 / 125 | 8 / 22 | 1215 / 1323 | 3 / 5 | 4 / 8 | 1 / 2 | **1354 / 1433** | 0 | 9/9 | biodatlab/whisper-th-small-combined@mps |
| th | 5 | 9 | 53 / 54 | 0 / 0 | 55 / 135 | 4 / 52 | 1292 / 1382 | 2 / 4 | 4 / 8 | 1 / 2 | **1419 / 1558** | 6 | 15/15 | biodatlab/whisper-th-small-combined@mps |
| th | 6 | 9 | 52 / 54 | 0 / 4 | 61 / 112 | 8 / 17 | 1551 / 1861 | 7 / 17 | 5 / 15 | 1 / 4 | **1667 / 2068** | 9 | 18/18 | biodatlab/whisper-th-small-combined@mps |
| en | 1 | 3 | 51 / 52 | 1 / 2 | 33 / 36 | 7 / 7 | 309 / 320 | 2 / 2 | 1 / 1 | 0 / 0 | **410 / 418** | 0 | 3/3 | openai/whisper-base.en@mps |
| en | 3 | 6 | 52 / 52 | 0 / 4 | 55 / 68 | 21 / 45 | 392 / 2239 | 3 / 3 | 5 / 8 | 1 / 15 | **529 / 2355** | 3 | 9/9 | openai/whisper-base.en@mps |
| en | 5 | 6 | 52 / 52 | 0 / 0 | 50 / 65 | 5 / 9 | 492 / 559 | 3 / 14 | 4 / 26 | 1 / 33 | **608 / 741** | 9 | 15/15 | openai/whisper-base.en@mps |
| en | 6 | 6 | 52 / 60 | 0 / 2 | 59 / 113 | 8 / 27 | 565 / 592 | 3 / 21 | 3 / 15 | 1 / 5 | **687 / 751** | 12 | 18/18 | openai/whisper-base.en@mps |
| mix | 1 | 3 | 52 / 52 | 0 / 0 | 31 / 36 | 4 / 4 | 470 / 496 | 2 / 2 | 2 / 4 | 0 / 0 | **563 / 586** | 0 | 3/3 | biodatlab/whisper-th-small-combined@mps |
| mix | 3 | 9 | 52 / 54 | 0 / 1 | 38 / 110 | 7 / 42 | 1043 / 2680 | 3 / 29 | 3 / 9 | 0 / 1 | **1170 / 2857** | 0 | 9/9 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |
| mix | 5 | 15 | 52 / 53 | 0 / 0 | 49 / 102 | 12 / 49 | 1519 / 4555 | 7 / 18 | 6 / 45 | 1 / 8 | **1645 / 4696** | 0 | 15/15 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |
| mix | 6 | 15 | 52 / 56 | 0 / 2 | 54 / 257 | 8 / 111 | 1546 / 1801 | 8 / 24 | 5 / 13 | 1 / 7 | **1673 / 2094** | 3 | 18/18 | biodatlab/whisper-th-small-combined@mps + openai/whisper-base.en@mps |

End-to-End รวม = ตั้งแต่กดหยุดอัดจนถึง Avatar เริ่มเดิน (เป้าหมาย ≤ 3000 ms) · 6 ส่งกลับ = เวลา request ที่เบราว์เซอร์วัดลบเวลาฝั่ง server · 2 upload = เวลาที่ server อ่าน body เท่านั้น การเชื่อมต่อ/TLS/hop ของ URL สาธารณะจึงไปรวมอยู่ใน 6 ส่งกลับ · 4 รอ worker รวมเวลาเริ่ม worker และโหลดโมเดลถ้ามี · 7 และ 8 วัดในเบราว์เซอร์ที่ใช้ CPU เรนเดอร์ 3D (SwiftShader) และแย่ง CPU กับ server จึงช้ากว่าเครื่องของ Visitor จริงที่มี GPU · เปิดโหมด Flash ให้ Avatar ถึงเร็ว (ไม่กระทบขั้น 8) · server: Apple M5, native
<!-- e2e:end -->
