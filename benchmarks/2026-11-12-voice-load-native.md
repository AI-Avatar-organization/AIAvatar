# Voice Command load benchmark (native)

วันที่ 2026-11-12T10:43:16.557Z · เครื่อง Apple M5 (10 คอร์, RAM 16 GiB, darwin arm64)
ข้อจำกัด: native ไม่จำกัด CPU, STT ใช้ MPS ถ้ามี · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-load.mjs --mode native --levels 1,3,5,6 --repeat 3 --langs th,en`

## ต้นทุนของแต่ละโมเดล

| ภาษา | โมเดล | โหลด + รันครั้งแรก (ms) | RAM ที่เพิ่มใน STT worker (MiB) | GPU memory ที่เพิ่ม (MiB) |
|---|---|---|---|---|
| th | biodatlab/distill-whisper-th-medium | 9585 | 369 | 2289 |
| en | openai/whisper-small.en | 1902 | -224 | 994 |

บน MPS น้ำหนักโมเดลอยู่ใน GPU memory (unified memory) ซึ่ง RSS ไม่นับ ค่า RAM ที่เพิ่มจึงเล็กหรือติดลบได้ ให้ดูคอลัมน์ GPU memory เป็นต้นทุนของโมเดล

ffmpeg ต่อคำสั่ง (วัดแยกหนึ่งครั้ง เพราะทำงานสั้นกว่าช่วงสุ่มวัด): RAM peak 15 MiB, CPU 35 ms

## เวลาแต่ละขั้น (ms, median / p95) ตามจำนวนคนที่พูดพร้อมกัน

ขั้นของ End-to-End Latency ฝั่ง server: 2 upload · 3 ffmpeg · 4 รอ worker · 5 ถอดเสียง · 6 ส่งกลับ (ขั้น 1, 7, 8 อยู่ในเบราว์เซอร์ วัดใน ticket 2)

| ภาษา | พร้อมกัน | n | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | รวมฝั่ง server | ถูก Station | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3 | 0 / 0 | 36 / 41 | 1 / 1 | 723 / 836 | 2 / 3 | 770 / 874 | 3/3 | biodatlab/distill-whisper-th-medium@mps |
| th | 3 | 9 | 0 / 0 | 37 / 44 | 771 / 1636 | 816 / 868 | 3 / 4 | 1659 / 2546 | 8/9 | biodatlab/distill-whisper-th-medium@mps |
| th | 5 | 15 | 0 / 0 | 35 / 43 | 1472 / 3309 | 833 / 989 | 2 / 10 | 2403 / 4297 | 14/15 | biodatlab/distill-whisper-th-medium@mps |
| th | 6 | 18 | 0 / 0 | 37 / 44 | 1643 / 4370 | 841 / 1011 | 3 / 5 | 2562 / 5195 | 17/18 | biodatlab/distill-whisper-th-medium@mps |
| en | 1 | 3 | 0 / 0 | 42 / 43 | 0 / 1 | 377 / 389 | 2 / 2 | 423 / 435 | 3/3 | openai/whisper-small.en@mps |
| en | 3 | 9 | 0 / 0 | 36 / 39 | 329 / 737 | 351 / 434 | 2 / 3 | 721 / 1137 | 9/9 | openai/whisper-small.en@mps |
| en | 5 | 15 | 0 / 0 | 35 / 42 | 734 / 1500 | 378 / 415 | 2 / 3 | 1168 / 1950 | 15/15 | openai/whisper-small.en@mps |
| en | 6 | 18 | 0 / 0 | 34 / 40 | 740 / 1842 | 373 / 414 | 2 / 3 | 1140 / 2266 | 18/18 | openai/whisper-small.en@mps |

n = จำนวนคำสั่งที่วัด (p95 จากตัวอย่างน้อย ใกล้เคียงค่าสูงสุด) · 2 upload วัดบน localhost จึงเกือบ 0 · 4 รอ worker รวมเวลาเริ่ม worker และโหลดโมเดลถ้ามี · 6 ส่งกลับ = เวลาที่ client วัดได้ลบเวลาฝั่ง server (รวมการเชื่อมต่อและแปลง JSON)

## ทรัพยากรต่อ process (ระหว่างแต่ละระดับ)

| ภาษา | พร้อมกัน | web-app RAM peak / CPU avg | ffmpeg RAM peak / CPU avg | STT worker RAM peak / CPU avg | STT worker CPU ต่อคำสั่ง (ms) | GPU memory (MiB) |
|---|---|---|---|---|---|---|
| th | 1 | 29 MiB / 0% | – | 185 MiB / 16% | 167 | 3433 |
| th | 3 | 31 MiB / 0% | – | 186 MiB / 13% | 122 | 3433 |
| th | 5 | 31 MiB / 0% | – | 203 MiB / 15% | 133 | 3321 |
| th | 6 | 32 MiB / 0% | 9 MiB / 1% | 216 MiB / 15% | 133 | 3321 |
| en | 1 | 30 MiB / 0% | – | 183 MiB / 14% | 100 | 3287 |
| en | 3 | 34 MiB / 1% | 4 MiB / 1% | 190 MiB / 23% | 100 | 3287 |
| en | 5 | 35 MiB / 1% | – | 195 MiB / 22% | 93 | 3283 |
| en | 6 | 35 MiB / 1% | – | 195 MiB / 22% | 94 | 3283 |

หมายเหตุ: CPU% คิดจากเวลา CPU สะสมต่อเวลาจริง (100% = 1 คอร์) · GPU memory คือหน่วยความจำ MPS ที่ worker จองไว้ (unified memory) ไม่มีค่า GPU utilization เพราะต้องใช้ sudo powermetrics

<!-- e2e:start -->
## End-to-End Latency ในเบราว์เซอร์ (ms, median / p95) — http://127.0.0.1:3321

วันที่ 2026-11-12T14:10:36.652Z · Chrome อัตโนมัติ (headless, WebGL แบบ SwiftShader) 6 หน้าต่างบนเครื่องเดียวกับ server · ใช้ไฟล์เสียงแทนไมค์ · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-e2e.mjs ` · ข้อมูลดิบ: 2026-11-12-voice-e2e-local.json

| ภาษา | พร้อมกัน | n | 1 หยุดอัด | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | 7 parseCommand | 8 วางเส้นทาง + Avatar เริ่มเดิน | **End-to-End รวม** | ถึง Station ถูก | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3 | 52 / 52 | 0 / 0 | 53 / 56 | 1 / 7 | 1456 / 1579 | 4 / 4 | 6 / 7 | 0 / 0 | **1573 / 1708** | 3/3 | biodatlab/distill-whisper-th-medium@mps |
| th | 3 | 9 | 52 / 63 | 0 / 0 | 61 / 164 | 1618 / 2833 | 1246 / 1641 | 3 / 46 | 9 / 11 | 1 / 4 | **2990 / 4057** | 9/9 | biodatlab/distill-whisper-th-medium@mps |
| th | 5 | 15 | 52 / 56 | 0 / 0 | 57 / 105 | 2772 / 5021 | 1169 / 1672 | 4 / 19 | 8 / 18 | 2 / 6 | **4069 / 6310** | 15/15 | biodatlab/distill-whisper-th-medium@mps |
| th | 6 | 18 | 52 / 54 | 0 / 0 | 64 / 117 | 2881 / 6374 | 1188 / 1821 | 5 / 14 | 10 / 27 | 2 / 6 | **4439 / 7688** | 18/18 | biodatlab/distill-whisper-th-medium@mps |
| en | 1 | 3 | 52 / 53 | 0 / 0 | 73 / 91 | 1 / 1 | 832 / 942 | 4 / 5 | 3 / 3 | 0 / 0 | **968 / 1057** | 3/3 | openai/whisper-small.en@mps |
| en | 3 | 9 | 52 / 56 | 0 / 0 | 60 / 108 | 914 / 1413 | 522 / 1064 | 5 / 26 | 6 / 13 | 1 / 3 | **1517 / 2085** | 9/9 | openai/whisper-small.en@mps |
| en | 5 | 15 | 52 / 58 | 0 / 1 | 60 / 111 | 1445 / 2522 | 538 / 1031 | 5 / 11 | 7 / 24 | 2 / 9 | **2194 / 3183** | 15/15 | openai/whisper-small.en@mps |
| en | 6 | 18 | 52 / 53 | 0 / 1 | 61 / 114 | 1567 / 3024 | 523 / 1109 | 4 / 8 | 7 / 17 | 2 / 11 | **2222 / 3641** | 18/18 | openai/whisper-small.en@mps |

End-to-End รวม = ตั้งแต่กดหยุดอัดจนถึง Avatar เริ่มเดิน (เป้าหมาย ≤ 3000 ms) · 6 ส่งกลับ = เวลา request ที่เบราว์เซอร์วัดลบเวลาฝั่ง server · 2 upload = เวลาที่ server อ่าน body เท่านั้น การเชื่อมต่อ/TLS/hop ของ URL สาธารณะจึงไปรวมอยู่ใน 6 ส่งกลับ · 4 รอ worker รวมเวลาเริ่ม worker และโหลดโมเดลถ้ามี · 7 และ 8 วัดในเบราว์เซอร์ที่ใช้ CPU เรนเดอร์ 3D (SwiftShader) และแย่ง CPU กับ server จึงช้ากว่าเครื่องของ Visitor จริงที่มี GPU · เปิดโหมด Flash ให้ Avatar ถึงเร็ว (ไม่กระทบขั้น 8) · server: Apple M5, native
<!-- e2e:end -->
