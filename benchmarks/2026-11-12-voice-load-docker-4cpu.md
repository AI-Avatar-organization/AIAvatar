# Voice Command load benchmark (docker)

วันที่ 2026-11-12T12:17:02.856Z · เครื่อง Apple M5 (10 คอร์, RAM 16 GiB, darwin arm64)
ข้อจำกัด: container CPU-only, --cpus 4, RAM 8 GiB, ไม่มี GPU · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-load.mjs --mode docker --cpus 4 --image ai-avatar-3d:bench --levels 1,3,5,6 --repeat 3 --langs th,en`

## ต้นทุนของแต่ละโมเดล

| ภาษา | โมเดล | โหลด + รันครั้งแรก (ms) | RAM ที่เพิ่มใน STT worker (MiB) | GPU memory ที่เพิ่ม (MiB) |
|---|---|---|---|---|
| th | biodatlab/distill-whisper-th-medium | 41593 | 2249 | ไม่มี GPU |
| en | openai/whisper-small.en | 3895 | 982 | ไม่มี GPU |

ffmpeg ต่อคำสั่ง (วัดแยกหนึ่งครั้ง เพราะทำงานสั้นกว่าช่วงสุ่มวัด): RAM peak 52 MiB, CPU 78 ms

## เวลาแต่ละขั้น (ms, median / p95) ตามจำนวนคนที่พูดพร้อมกัน

ขั้นของ End-to-End Latency ฝั่ง server: 2 upload · 3 ffmpeg · 4 รอ worker · 5 ถอดเสียง · 6 ส่งกลับ (ขั้น 1, 7, 8 อยู่ในเบราว์เซอร์ วัดใน ticket 2)

| ภาษา | พร้อมกัน | n | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | รวมฝั่ง server | ถูก Station | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3 | 1 / 1 | 73 / 78 | 1 / 1 | 8928 / 9119 | 6 / 9 | 9003 / 9207 | 3/3 | biodatlab/distill-whisper-th-medium@cpu |
| th | 3 | 9 | 0 / 2 | 90 / 99 | 8988 / 18733 | 8592 / 9727 | 8 / 15 | 18231 / 27011 | 8/9 | biodatlab/distill-whisper-th-medium@cpu |
| th | 5 | 15 | 0 / 4 | 95 / 110 | 17251 / 35751 | 8760 / 10494 | 10 / 17 | 26315 / 45914 | 14/15 | biodatlab/distill-whisper-th-medium@cpu |
| th | 6 | 18 | 0 / 1 | 130 / 164 | 16609 / 44850 | 8498 / 9917 | 13 / 22 | 25299 / 53927 | 17/18 | biodatlab/distill-whisper-th-medium@cpu |
| en | 1 | 3 | 1 / 1 | 70 / 156 | 1 / 1 | 3199 / 3374 | 6 / 8 | 3279 / 3544 | 3/3 | openai/whisper-small.en@cpu |
| en | 3 | 9 | 0 / 2 | 110 / 121 | 3271 / 6658 | 3270 / 3599 | 8 / 16 | 6471 / 10398 | 9/9 | openai/whisper-small.en@cpu |
| en | 5 | 15 | 0 / 1 | 90 / 102 | 6362 / 13446 | 3235 / 3896 | 7 / 10 | 10056 / 16965 | 15/15 | openai/whisper-small.en@cpu |
| en | 6 | 18 | 0 / 2 | 133 / 148 | 6834 / 17018 | 3225 / 3616 | 8 / 20 | 10277 / 20657 | 18/18 | openai/whisper-small.en@cpu |

n = จำนวนคำสั่งที่วัด (p95 จากตัวอย่างน้อย ใกล้เคียงค่าสูงสุด) · 2 upload วัดบน localhost จึงเกือบ 0 · 4 รอ worker รวมเวลาเริ่ม worker และโหลดโมเดลถ้ามี · 6 ส่งกลับ = เวลาที่ client วัดได้ลบเวลาฝั่ง server (รวมการเชื่อมต่อและแปลง JSON)

## ทรัพยากรต่อ process (ระหว่างแต่ละระดับ)

| ภาษา | พร้อมกัน | web-app RAM peak / CPU avg | ffmpeg RAM peak / CPU avg | STT worker RAM peak / CPU avg | STT worker CPU ต่อคำสั่ง (ms) | GPU memory (MiB) |
|---|---|---|---|---|---|---|
| th | 1 | 109 MiB / 0% | 20 MiB / 0% | 3451 MiB / 383% | 35333 | ไม่มี GPU |
| th | 3 | 110 MiB / 0% | 68 MiB / 0% | 3456 MiB / 393% | 34667 | ไม่มี GPU |
| th | 5 | 105 MiB / 0% | 83 MiB / 0% | 3457 MiB / 396% | 35333 | ไม่มี GPU |
| th | 6 | 85 MiB / 0% | 48 MiB / 0% | 3458 MiB / 395% | 34444 | ไม่มี GPU |
| en | 1 | 63 MiB / 0% | 19 MiB / 0% | 3469 MiB / 358% | 12667 | ไม่มี GPU |
| en | 3 | 84 MiB / 0% | 88 MiB / 0% | 3466 MiB / 384% | 13000 | ไม่มี GPU |
| en | 5 | 107 MiB / 0% | 94 MiB / 0% | 3466 MiB / 392% | 13267 | ไม่มี GPU |
| en | 6 | 65 MiB / 0% | 156 MiB / 0% | 3468 MiB / 391% | 13056 | ไม่มี GPU |

หมายเหตุ: CPU% คิดจากเวลา CPU สะสมต่อเวลาจริง (100% = 1 คอร์) · GPU memory คือหน่วยความจำ MPS ที่ worker จองไว้ (unified memory) ไม่มีค่า GPU utilization เพราะต้องใช้ sudo powermetrics
ใน Docker เวลา CPU จาก `ps` ของ Linux ละเอียดแค่ 1 วินาที process ที่ใช้ CPU น้อย (web-app, ffmpeg) จึงแสดงเป็น 0% ดูต้นทุน ffmpeg จากค่าที่วัดแยกด้านบน
