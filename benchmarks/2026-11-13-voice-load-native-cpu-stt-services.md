# Voice Command load benchmark (native)

วันที่ 2026-11-13T03:39:01.109Z · เครื่อง Apple M5 (10 คอร์, RAM 16 GiB, darwin arm64)
ข้อจำกัด: native ไม่จำกัด CPU, STT ใช้ MPS ถ้ามี · STT Service ไทย 3 worker, อังกฤษ 2 worker · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-load.mjs --workers-th 3 --workers-en 2 --label cpu-stt-services`

## ต้นทุนของแต่ละโมเดลและของทั้งระบบ

| ภาษา | โมเดล@device | worker | โหลดโมเดลตอนเริ่ม (ms, ช้าสุด) | RAM ต่อ worker (MiB) | GPU memory ต่อ worker (MiB) |
|---|---|---|---|---|---|
| th | biodatlab/whisper-th-small-combined@cpu | 3 | 10874 | 218 | – |
| en | openai/whisper-base.en@cpu | 2 | 9637 | 313 | – |

ทั้งระบบตอนว่าง: RAM 1461 MiB (other 38, stt-service 88, web-app 55, stt-worker-en 625, stt-worker-th 655) + GPU memory 0 MiB = **1461 MiB** (บน Mac GPU memory เป็นส่วนหนึ่งของ RAM 16 GiB เดียวกัน)

ffmpeg ต่อคำสั่ง (วัดแยกหนึ่งครั้ง เพราะทำงานสั้นกว่าช่วงสุ่มวัด): RAM peak 15 MiB, CPU 37 ms

## เวลาแต่ละขั้น (ms, median / p95) ตามจำนวนคนที่พูดพร้อมกัน

ขั้นของ End-to-End Latency ฝั่ง server: 2 upload · 3 ffmpeg · 4 รอ worker · 5 ถอดเสียง · 6 ส่งกลับ (ขั้น 1, 7, 8 อยู่ในเบราว์เซอร์ ดูหัวข้อ End-to-End Latency ด้านล่างเมื่อรัน `npm run bench:e2e` แล้ว)

| ภาษา | พร้อมกัน | ได้ slot | ไป Browser STT Fallback | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | รวมฝั่ง server | ถูก Station | เดินผิดที่ | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3/3 | 0 | 0 / 0 | 42 / 43 | 5 / 6 | 986 / 1043 | 2 / 2 | 1032 / 1095 | 3/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 3 | 9/9 | 0 | 0 / 0 | 40 / 47 | 4 / 24 | 1829 / 2821 | 1 / 4 | 1885 / 2868 | 7/9 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 5 | 9/15 | 6 | 0 / 0 | 49 / 55 | 4 / 6 | 1836 / 2458 | 2 / 5 | 1885 / 2522 | 7/9 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 6 | 9/18 | 9 | 0 / 0 | 40 / 44 | 3 / 4 | 1590 / 1854 | 2 / 3 | 1642 / 1905 | 7/9 | 0 | biodatlab/whisper-th-small-combined@cpu |
| en | 1 | 3/3 | 0 | 0 / 0 | 39 / 43 | 3 / 6 | 265 / 301 | 1 / 1 | 309 / 352 | 3/3 | 0 | openai/whisper-base.en@cpu |
| en | 3 | 6/9 | 3 | 0 / 0 | 56 / 65 | 3 / 6 | 356 / 434 | 1 / 5 | 423 / 487 | 6/6 | 0 | openai/whisper-base.en@cpu |
| en | 5 | 6/15 | 9 | 0 / 0 | 38 / 42 | 3 / 4 | 363 / 389 | 1 / 3 | 407 / 437 | 6/6 | 0 | openai/whisper-base.en@cpu |
| en | 6 | 6/18 | 12 | 0 / 0 | 38 / 42 | 3 / 3 | 338 / 357 | 1 / 5 | 379 / 403 | 6/6 | 0 | openai/whisper-base.en@cpu |
| mix | 1 | 3/3 | 0 | 0 / 0 | 44 / 57 | 4 / 4 | 1024 / 1027 | 1 / 1 | 1073 / 1088 | 2/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| mix | 3 | 9/9 | 0 | 0 / 0 | 39 / 42 | 4 / 5 | 1329 / 1925 | 1 / 5 | 1376 / 1975 | 7/9 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |
| mix | 5 | 15/15 | 0 | 0 / 3 | 41 / 136 | 6 / 18 | 2755 / 3359 | 4 / 42 | 2808 / 3513 | 13/15 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |
| mix | 6 | 15/18 | 3 | 0 / 0 | 42 / 51 | 7 / 17 | 2303 / 3110 | 2 / 24 | 2364 / 3199 | 13/15 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |

p95 จากตัวอย่างน้อย ใกล้เคียงค่าสูงสุด · 2 upload วัดบน localhost จึงเกือบ 0 · 4 รอ worker = เวลาที่อยู่กับ STT Service แต่ไม่ได้ถอดเสียง (worker ไม่ต่อคิว) · 6 ส่งกลับ = เวลาที่ client วัดได้ลบเวลาฝั่ง server

## ทรัพยากรต่อ process (ระหว่างแต่ละระดับ, RAM peak / CPU avg)

| ภาษา | พร้อมกัน | web-app | stt-service | stt-worker-th | stt-worker-en | ffmpeg | STT worker CPU ต่อคำสั่ง (ms) |
|---|---|---|---|---|---|---|---|
| th | 1 | 59 MiB / 1% | 98 MiB / 1% | 1237 MiB / 167% | 726 MiB / 0% | – | 2133 |
| th | 3 | 61 MiB / 1% | 98 MiB / 0% | 3526 MiB / 407% | 637 MiB / 0% | – | 3256 |
| th | 5 | 61 MiB / 1% | 93 MiB / 0% | 3526 MiB / 411% | 598 MiB / 0% | – | 3289 |
| th | 6 | 62 MiB / 1% | 92 MiB / 0% | 3533 MiB / 438% | 595 MiB / 0% | – | 2989 |
| en | 1 | 62 MiB / 1% | 95 MiB / 1% | 3388 MiB / 0% | 734 MiB / 107% | – | 600 |
| en | 3 | 61 MiB / 1% | 98 MiB / 0% | 3036 MiB / 0% | 879 MiB / 198% | – | 717 |
| en | 5 | 60 MiB / 1% | 97 MiB / 1% | 958 MiB / 0% | 864 MiB / 215% | – | 717 |
| en | 6 | 62 MiB / 2% | 98 MiB / 1% | 958 MiB / 0% | 865 MiB / 207% | – | 683 |
| mix | 1 | 62 MiB / 1% | 100 MiB / 0% | 1804 MiB / 166% | 865 MiB / 0% | 12 MiB / 1% | 2067 |
| mix | 3 | 65 MiB / 1% | 101 MiB / 0% | 2378 MiB / 284% | 855 MiB / 47% | – | 2156 |
| mix | 5 | 63 MiB / 1% | 98 MiB / 1% | 3490 MiB / 338% | 879 MiB / 63% | 4 MiB / 1% | 2853 |
| mix | 6 | 49 MiB / 1% | 61 MiB / 0% | 3529 MiB / 355% | 878 MiB / 69% | 4 MiB / 0% | 2653 |

หมายเหตุ: CPU% คิดจากเวลา CPU สะสมต่อเวลาจริง (100% = 1 คอร์) · GPU memory คือหน่วยความจำ MPS ที่ worker จองไว้ (unified memory) ไม่มีค่า GPU utilization เพราะต้องใช้ sudo powermetrics
