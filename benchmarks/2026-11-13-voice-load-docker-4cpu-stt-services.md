# Voice Command load benchmark (docker)

วันที่ 2026-11-13T03:28:47.346Z · เครื่อง Apple M5 (10 คอร์, RAM 16 GiB, darwin arm64)
ข้อจำกัด: container CPU-only, --cpus 4, RAM 8 GiB, ไม่มี GPU · STT Service ไทย 3 worker, อังกฤษ 2 worker · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-load.mjs --mode docker --cpus 4 --image ai-avatar-3d:bench-stt --workers-th 3 --workers-en 2 --label stt-services`

## ต้นทุนของแต่ละโมเดลและของทั้งระบบ

| ภาษา | โมเดล@device | worker | โหลดโมเดลตอนเริ่ม (ms, ช้าสุด) | RAM ต่อ worker (MiB) | GPU memory ต่อ worker (MiB) |
|---|---|---|---|---|---|
| th | biodatlab/whisper-th-small-combined@cpu | 3 | 28756 | 1419 | ไม่มี GPU |
| en | openai/whisper-base.en@cpu | 2 | 21884 | 690 | ไม่มี GPU |

ทั้งระบบตอนว่าง: RAM 5745 MiB (other 17, stt-service 45, web-app 47, stt-worker-th 4256, stt-worker-en 1380) + GPU memory 0 MiB = **5745 MiB**

ffmpeg ต่อคำสั่ง (วัดแยกหนึ่งครั้ง เพราะทำงานสั้นกว่าช่วงสุ่มวัด): RAM peak 52 MiB, CPU 70 ms

## เวลาแต่ละขั้น (ms, median / p95) ตามจำนวนคนที่พูดพร้อมกัน

ขั้นของ End-to-End Latency ฝั่ง server: 2 upload · 3 ffmpeg · 4 รอ worker · 5 ถอดเสียง · 6 ส่งกลับ (ขั้น 1, 7, 8 อยู่ในเบราว์เซอร์ ดูหัวข้อ End-to-End Latency ด้านล่างเมื่อรัน `npm run bench:e2e` แล้ว)

| ภาษา | พร้อมกัน | ได้ slot | ไป Browser STT Fallback | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | รวมฝั่ง server | ถูก Station | เดินผิดที่ | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3/3 | 0 | 0 / 1 | 70 / 121 | 6 / 7 | 5444 / 5837 | 4 / 8 | 5579 / 5925 | 3/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 3 | 9/9 | 0 | 0 / 1 | 103 / 118 | 8 / 66 | 21175 / 23648 | 5 / 16 | 21323 / 23733 | 7/9 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 5 | 9/15 | 6 | 0 / 2 | 91 / 98 | 12 / 61 | 19999 / 30031 | 6 / 9 | 20116 / 30131 | 8/9 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 6 | 9/18 | 9 | 0 / 0 | 106 / 114 | 7 / 189 | 20209 / 21194 | 4 / 9 | 20325 / 21342 | 7/9 | 0 | biodatlab/whisper-th-small-combined@cpu |
| en | 1 | 3/3 | 0 | 1 / 1 | 87 / 212 | 7 / 13 | 1286 / 1607 | 8 / 8 | 1381 / 1847 | 3/3 | 0 | openai/whisper-base.en@cpu |
| en | 3 | 6/9 | 3 | 0 / 1 | 75 / 102 | 5 / 9 | 3349 / 3844 | 4 / 8 | 3436 / 3935 | 6/6 | 0 | openai/whisper-base.en@cpu |
| en | 5 | 6/15 | 9 | 0 / 1 | 81 / 104 | 4 / 11 | 3629 / 4087 | 6 / 14 | 3757 / 4179 | 6/6 | 0 | openai/whisper-base.en@cpu |
| en | 6 | 6/18 | 12 | 0 / 1 | 107 / 138 | 6 / 11 | 3447 / 3609 | 5 / 9 | 3571 / 3768 | 6/6 | 0 | openai/whisper-base.en@cpu |
| mix | 1 | 3/3 | 0 | 0 / 0 | 81 / 132 | 13 / 17 | 5607 / 6596 | 4 / 6 | 5713 / 6743 | 2/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| mix | 3 | 9/9 | 0 | 0 / 2 | 117 / 126 | 10 / 23 | 12359 / 16696 | 5 / 11 | 12491 / 16840 | 7/9 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |
| mix | 5 | 15/15 | 0 | 0 / 1 | 145 / 168 | 14 / 102 | 24516 / 32110 | 6 / 20 | 24701 / 32251 | 13/15 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |
| mix | 6 | 15/18 | 3 | 0 / 66 | 200 / 415 | 25 / 72 | 21523 / 28025 | 13 / 120 | 22201 / 28186 | 13/15 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |

p95 จากตัวอย่างน้อย ใกล้เคียงค่าสูงสุด · 2 upload วัดบน localhost จึงเกือบ 0 · 4 รอ worker = เวลาที่อยู่กับ STT Service แต่ไม่ได้ถอดเสียง (worker ไม่ต่อคิว) · 6 ส่งกลับ = เวลาที่ client วัดได้ลบเวลาฝั่ง server

## ทรัพยากรต่อ process (ระหว่างแต่ละระดับ, RAM peak / CPU avg)

| ภาษา | พร้อมกัน | web-app | stt-service | stt-worker-th | stt-worker-en | ffmpeg | STT worker CPU ต่อคำสั่ง (ms) |
|---|---|---|---|---|---|---|---|
| th | 1 | 55 MiB / 0% | 52 MiB / 0% | 4456 MiB / 373% | 1434 MiB / 0% | 20 MiB / 0% | 21000 |
| th | 3 | 57 MiB / 0% | 53 MiB / 0% | 4856 MiB / 393% | 1434 MiB / 0% | 60 MiB / 0% | 28222 |
| th | 5 | 59 MiB / 1% | 59 MiB / 0% | 4864 MiB / 392% | 1431 MiB / 0% | 49 MiB / 0% | 31667 |
| th | 6 | 60 MiB / 0% | 60 MiB / 0% | 4862 MiB / 388% | 1431 MiB / 0% | 40 MiB / 0% | 26444 |
| en | 1 | 60 MiB / 0% | 60 MiB / 0% | 4279 MiB / 0% | 1536 MiB / 320% | 11 MiB / 0% | 5667 |
| en | 3 | 62 MiB / 0% | 60 MiB / 0% | 4279 MiB / 0% | 1661 MiB / 363% | 34 MiB / 0% | 7167 |
| en | 5 | 62 MiB / 0% | 61 MiB / 0% | 4279 MiB / 0% | 1661 MiB / 370% | 65 MiB / 0% | 7667 |
| en | 6 | 63 MiB / 0% | 61 MiB / 0% | 4279 MiB / 0% | 1657 MiB / 361% | 46 MiB / 0% | 7000 |
| mix | 1 | 63 MiB / 0% | 61 MiB / 0% | 4475 MiB / 370% | 1552 MiB / 0% | 15 MiB / 0% | 21667 |
| mix | 3 | 64 MiB / 2% | 67 MiB / 0% | 4667 MiB / 334% | 1555 MiB / 54% | 40 MiB / 0% | 20000 |
| mix | 5 | 65 MiB / 0% | 67 MiB / 0% | 4845 MiB / 325% | 1656 MiB / 68% | 40 MiB / 0% | 23133 |
| mix | 6 | 65 MiB / 1% | 66 MiB / 0% | 4756 MiB / 320% | 1592 MiB / 67% | 205 MiB / 0% | 20867 |

หมายเหตุ: CPU% คิดจากเวลา CPU สะสมต่อเวลาจริง (100% = 1 คอร์) · GPU memory คือหน่วยความจำ MPS ที่ worker จองไว้ (unified memory) ไม่มีค่า GPU utilization เพราะต้องใช้ sudo powermetrics
ใน Docker เวลา CPU จาก `ps` ของ Linux ละเอียดแค่ 1 วินาที process ที่ใช้ CPU น้อย (web-app, ffmpeg) จึงแสดงเป็น 0% ดูต้นทุน ffmpeg จากค่าที่วัดแยกด้านบน
