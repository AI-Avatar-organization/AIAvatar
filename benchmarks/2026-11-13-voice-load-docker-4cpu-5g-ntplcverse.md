# Voice Command load benchmark (docker)

วันที่ 2026-11-13T04:17:56.640Z · เครื่อง Apple M5 (10 คอร์, RAM 16 GiB, darwin arm64)
ข้อจำกัด: container CPU-only, 4 คอร์ (--cpuset-cpus), RAM ไม่เกิน 5g, ไม่มี GPU · STT Service ไทย 1 worker, อังกฤษ 1 worker · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-load.mjs --mode docker --cpus 4 --memory 5g --server-ram 15g --server ntplcverse (4 คอร์, RAM 15 GiB ว่าง ~5 GiB) --image ai-avatar-3d:bench-stt --workers-th 1 --workers-en 1 --label ntplcverse`

## ต้นทุนของแต่ละโมเดลและของทั้งระบบ

| ภาษา | โมเดล@device | worker | โหลดโมเดลตอนเริ่ม (ms, ช้าสุด) | RAM ต่อ worker (MiB) | GPU memory ต่อ worker (MiB) |
|---|---|---|---|---|---|
| th | biodatlab/whisper-th-small-combined@cpu | 1 | 8294 | 1536 | ไม่มี GPU |
| en | openai/whisper-base.en@cpu | 1 | 7124 | 845 | ไม่มี GPU |

ทั้งระบบตอนว่าง: RAM 2605 MiB (other 52, stt-service 108, web-app 64, stt-worker-th 1536, stt-worker-en 845) + GPU memory 0 MiB = **2605 MiB**

ffmpeg ต่อคำสั่ง (วัดแยกหนึ่งครั้ง เพราะทำงานสั้นกว่าช่วงสุ่มวัด): RAM peak 52 MiB, CPU 42 ms

## เวลาแต่ละขั้น (ms, median / p95) ตามจำนวนคนที่พูดพร้อมกัน

ขั้นของ End-to-End Latency ฝั่ง server: 2 upload · 3 ffmpeg · 4 รอ worker · 5 ถอดเสียง · 6 ส่งกลับ (ขั้น 1, 7, 8 อยู่ในเบราว์เซอร์ ดูหัวข้อ End-to-End Latency ด้านล่างเมื่อรัน `npm run bench:e2e` แล้ว)

| ภาษา | พร้อมกัน | ได้ slot | ไป Browser STT Fallback | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | รวมฝั่ง server | ถูก Station | เดินผิดที่ | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3/3 | 0 | 0 / 1 | 55 / 67 | 5 / 7 | 1465 / 1670 | 3 / 4 | 1521 / 1747 | 3/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 3 | 3/9 | 6 | 0 / 1 | 60 / 70 | 4 / 7 | 1596 / 1640 | 6 / 7 | 1681 / 1713 | 2/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 5 | 3/15 | 12 | 0 / 0 | 41 / 57 | 5 / 6 | 1498 / 1688 | 2 / 5 | 1548 / 1754 | 2/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 6 | 3/18 | 15 | 0 / 0 | 57 / 62 | 3 / 8 | 1475 / 1555 | 4 / 5 | 1526 / 1626 | 2/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| en | 1 | 3/3 | 0 | 0 / 0 | 53 / 68 | 3 / 5 | 397 / 546 | 3 / 3 | 457 / 624 | 3/3 | 0 | openai/whisper-base.en@cpu |
| en | 3 | 3/9 | 6 | 0 / 0 | 61 / 79 | 3 / 8 | 430 / 432 | 3 / 4 | 499 / 522 | 3/3 | 0 | openai/whisper-base.en@cpu |
| en | 5 | 3/15 | 12 | 0 / 2 | 60 / 61 | 3 / 3 | 372 / 397 | 3 / 4 | 443 / 445 | 3/3 | 0 | openai/whisper-base.en@cpu |
| en | 6 | 3/18 | 15 | 0 / 0 | 62 / 74 | 3 / 3 | 421 / 473 | 2 / 4 | 490 / 539 | 3/3 | 0 | openai/whisper-base.en@cpu |
| mix | 1 | 3/3 | 0 | 0 / 0 | 71 / 99 | 5 / 5 | 1847 / 2392 | 3 / 3 | 1957 / 2476 | 2/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| mix | 3 | 6/9 | 3 | 0 / 2 | 48 / 62 | 3 / 9 | 1449 / 2560 | 3 / 5 | 1522 / 2620 | 5/6 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |
| mix | 5 | 6/15 | 9 | 0 / 1 | 63 / 81 | 4 / 13 | 1335 / 2191 | 3 / 10 | 1411 / 2265 | 5/6 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |
| mix | 6 | 6/18 | 12 | 0 / 0 | 55 / 79 | 3 / 12 | 1444 / 2242 | 3 / 5 | 1518 / 2303 | 5/6 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |

p95 จากตัวอย่างน้อย ใกล้เคียงค่าสูงสุด · 2 upload วัดบน localhost จึงเกือบ 0 · 4 รอ worker = เวลาที่อยู่กับ STT Service แต่ไม่ได้ถอดเสียง (worker ไม่ต่อคิว) · 6 ส่งกลับ = เวลาที่ client วัดได้ลบเวลาฝั่ง server

## สัดส่วนที่ใช้ของเครื่อง (%) — จำลอง ntplcverse (4 คอร์, RAM 15 GiB ว่าง ~5 GiB): container 4 คอร์, RAM ของเครื่อง 15g (container จำกัดที่ 5g)

นับเฉพาะ process ของโปรเจกต์นี้ (เว็บแอป, STT Service, STT worker, ffmpeg) ไม่นับโปรแกรมอื่นในเครื่อง · CPU 100% = ทุกคอร์ทำงานเต็ม

ตอนว่าง (โหลดโมเดลครบ): RAM 17.0% ของเครื่อง · ต่อ worker: th 10.0%, en 5.5%

| ภาษา | พร้อมกัน | CPU เฉลี่ย (% ของทุกคอร์) | RAM สูงสุด (% ของเครื่อง) |
|---|---|---|---|
| th | 1 | 75.3% | 17.6% |
| th | 3 | 83.5% | 17.6% |
| th | 5 | 79.3% | 17.6% |
| th | 6 | 75% | 17.6% |
| en | 1 | 43.8% | 18.3% |
| en | 3 | 54.5% | 18.4% |
| en | 5 | 50.5% | 18.4% |
| en | 6 | 54.8% | 18.4% |
| mix | 1 | 76% | 18.4% |
| mix | 3 | 83.3% | 18.6% |
| mix | 5 | 82.8% | 19% |
| mix | 6 | 79.3% | 18.6% |

## ทรัพยากรต่อ process (ระหว่างแต่ละระดับ, RAM peak / CPU avg)

| ภาษา | พร้อมกัน | web-app | stt-service | stt-worker-th | stt-worker-en | ffmpeg | STT worker CPU ต่อคำสั่ง (ms) |
|---|---|---|---|---|---|---|---|
| th | 1 | 67 MiB / 0% | 109 MiB / 0% | 1733 MiB / 301% | 724 MiB / 0% | 20 MiB / 0% | 5667 |
| th | 3 | 68 MiB / 0% | 109 MiB / 0% | 1733 MiB / 334% | 724 MiB / 0% | 17 MiB / 0% | 6000 |
| th | 5 | 69 MiB / 0% | 110 MiB / 0% | 1733 MiB / 317% | 724 MiB / 0% | 17 MiB / 0% | 5667 |
| th | 6 | 69 MiB / 0% | 110 MiB / 0% | 1733 MiB / 300% | 724 MiB / 0% | 21 MiB / 0% | 5333 |
| en | 1 | 70 MiB / 0% | 111 MiB / 0% | 1715 MiB / 0% | 852 MiB / 175% | 17 MiB / 0% | 1333 |
| en | 3 | 70 MiB / 0% | 111 MiB / 0% | 1715 MiB / 0% | 855 MiB / 218% | 18 MiB / 0% | 1667 |
| en | 5 | 70 MiB / 0% | 111 MiB / 0% | 1715 MiB / 0% | 857 MiB / 202% | 17 MiB / 0% | 1333 |
| en | 6 | 70 MiB / 0% | 112 MiB / 0% | 1715 MiB / 0% | 857 MiB / 219% | 18 MiB / 0% | 1667 |
| mix | 1 | 71 MiB / 0% | 112 MiB / 0% | 1733 MiB / 304% | 850 MiB / 0% | 15 MiB / 0% | 7000 |
| mix | 3 | 73 MiB / 0% | 112 MiB / 0% | 1733 MiB / 256% | 850 MiB / 77% | 34 MiB / 0% | 4333 |
| mix | 5 | 73 MiB / 0% | 117 MiB / 0% | 1733 MiB / 248% | 850 MiB / 83% | 57 MiB / 0% | 4000 |
| mix | 6 | 74 MiB / 0% | 118 MiB / 0% | 1734 MiB / 234% | 853 MiB / 83% | 23 MiB / 0% | 3833 |

หมายเหตุ: CPU% คิดจากเวลา CPU สะสมต่อเวลาจริง (100% = 1 คอร์) · GPU memory คือหน่วยความจำ MPS ที่ worker จองไว้ (unified memory) ไม่มีค่า GPU utilization เพราะต้องใช้ sudo powermetrics
ใน Docker เวลา CPU จาก `ps` ของ Linux ละเอียดแค่ 1 วินาที process ที่ใช้ CPU น้อย (web-app, ffmpeg) จึงแสดงเป็น 0% ดูต้นทุน ffmpeg จากค่าที่วัดแยกด้านบน
