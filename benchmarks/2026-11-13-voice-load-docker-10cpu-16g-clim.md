# Voice Command load benchmark (docker)

วันที่ 2026-11-13T04:55:17.337Z · เครื่อง Apple M5 (10 คอร์, RAM 16 GiB, darwin arm64)
ข้อจำกัด: container CPU-only, 10 คอร์ (--cpuset-cpus), RAM ไม่เกิน 16g, ไม่มี GPU · STT Service ไทย 3 worker, อังกฤษ 2 worker · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-load.mjs --mode docker --cpus 10 --memory 16g --image ai-avatar-3d:bench-stt --workers-th 3 --workers-en 2 --label clim`

## ต้นทุนของแต่ละโมเดลและของทั้งระบบ

| ภาษา | โมเดล@device | worker | โหลดโมเดลตอนเริ่ม (ms, ช้าสุด) | RAM ต่อ worker (MiB) | GPU memory ต่อ worker (MiB) |
|---|---|---|---|---|---|
| th | biodatlab/whisper-th-small-combined@cpu | 3 | 7554 | 1649 | ไม่มี GPU |
| en | openai/whisper-base.en@cpu | 2 | 5579 | 727 | ไม่มี GPU |

ทั้งระบบตอนว่าง: RAM 6637 MiB (launcher 52, stt-service 108, web-app 76, stt-worker-th 4947, stt-worker-en 1454) + GPU memory 0 MiB = **6637 MiB**

ffmpeg ต่อคำสั่ง (วัดแยกหนึ่งครั้ง เพราะทำงานสั้นกว่าช่วงสุ่มวัด): RAM peak 52 MiB, CPU 45 ms

## เวลาแต่ละขั้น (ms, median / p95) ตามจำนวนคนที่พูดพร้อมกัน

ขั้นของ End-to-End Latency ฝั่ง server: 2 upload · 3 ffmpeg · 4 รอ worker · 5 ถอดเสียง · 6 ส่งกลับ (ขั้น 1, 7, 8 อยู่ในเบราว์เซอร์ ดูหัวข้อ End-to-End Latency ด้านล่างเมื่อรัน `npm run bench:e2e` แล้ว)

| ภาษา | พร้อมกัน | ได้ slot | ไป Browser STT Fallback | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | รวมฝั่ง server | ถูก Station | เดินผิดที่ | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3/3 | 0 | 0 / 0 | 45 / 54 | 3 / 6 | 1645 / 1785 | 3 / 3 | 1697 / 1850 | 3/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 3 | 9/9 | 0 | 0 / 1 | 56 / 65 | 4 / 6 | 5784 / 6537 | 3 / 9 | 5855 / 6611 | 7/9 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 5 | 9/15 | 6 | 0 / 0 | 50 / 63 | 3 / 7 | 5937 / 7478 | 3 / 7 | 5999 / 7536 | 8/9 | 0 | biodatlab/whisper-th-small-combined@cpu |
| th | 6 | 9/18 | 9 | 0 / 2 | 75 / 89 | 4 / 6 | 5832 / 6929 | 3 / 9 | 5917 / 7006 | 7/9 | 0 | biodatlab/whisper-th-small-combined@cpu |
| en | 1 | 3/3 | 0 | 0 / 0 | 66 / 69 | 3 / 4 | 403 / 434 | 2 / 3 | 476 / 510 | 3/3 | 0 | openai/whisper-base.en@cpu |
| en | 3 | 6/9 | 3 | 0 / 0 | 50 / 56 | 2 / 5 | 1177 / 1247 | 3 / 5 | 1245 / 1304 | 6/6 | 0 | openai/whisper-base.en@cpu |
| en | 5 | 6/15 | 9 | 0 / 0 | 47 / 64 | 2 / 3 | 1213 / 1431 | 2 / 4 | 1260 / 1486 | 6/6 | 0 | openai/whisper-base.en@cpu |
| en | 6 | 6/18 | 12 | 0 / 1 | 43 / 77 | 2 / 5 | 1162 / 1368 | 3 / 10 | 1212 / 1460 | 6/6 | 0 | openai/whisper-base.en@cpu |
| mix | 1 | 3/3 | 0 | 0 / 0 | 49 / 76 | 4 / 6 | 1676 / 1905 | 3 / 5 | 1763 / 1961 | 2/3 | 0 | biodatlab/whisper-th-small-combined@cpu |
| mix | 3 | 9/9 | 0 | 0 / 1 | 58 / 61 | 3 / 6 | 3735 / 4783 | 4 / 5 | 3787 / 4857 | 7/9 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |
| mix | 5 | 15/15 | 0 | 0 / 1 | 56 / 84 | 4 / 11 | 5964 / 7883 | 5 / 11 | 6026 / 7957 | 13/15 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |
| mix | 6 | 15/18 | 3 | 0 / 5 | 56 / 138 | 6 / 10 | 6731 / 8387 | 5 / 15 | 6797 / 8446 | 13/15 | 0 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |

p95 จากตัวอย่างน้อย ใกล้เคียงค่าสูงสุด · 2 upload วัดบน localhost จึงเกือบ 0 · 4 รอ worker = เวลาที่อยู่กับ STT Service แต่ไม่ได้ถอดเสียง (worker ไม่ต่อคิว) · 6 ส่งกลับ = เวลาที่ client วัดได้ลบเวลาฝั่ง server

## ทรัพยากรต่อ process (ระหว่างแต่ละระดับ, RAM peak / CPU avg)

| ภาษา | พร้อมกัน | web-app | stt-service | stt-worker-th | stt-worker-en | ffmpeg | STT worker CPU ต่อคำสั่ง (ms) |
|---|---|---|---|---|---|---|---|
| th | 1 | 81 MiB / 0% | 109 MiB / 0% | 4980 MiB / 608% | 1487 MiB / 0% | 17 MiB / 0% | 12000 |
| th | 3 | 83 MiB / 0% | 110 MiB / 0% | 5220 MiB / 779% | 1487 MiB / 0% | 68 MiB / 0% | 16667 |
| th | 5 | 84 MiB / 0% | 111 MiB / 0% | 5226 MiB / 764% | 1487 MiB / 0% | 51 MiB / 0% | 17667 |
| th | 6 | 85 MiB / 0% | 116 MiB / 0% | 5219 MiB / 787% | 1487 MiB / 0% | 59 MiB / 0% | 17556 |
| en | 1 | 86 MiB / 0% | 116 MiB / 0% | 5012 MiB / 0% | 1597 MiB / 400% | 19 MiB / 0% | 3000 |
| en | 3 | 87 MiB / 0% | 117 MiB / 0% | 5012 MiB / 0% | 1719 MiB / 616% | 34 MiB / 0% | 4667 |
| en | 5 | 89 MiB / 0% | 117 MiB / 0% | 5012 MiB / 0% | 1717 MiB / 629% | 36 MiB / 0% | 5000 |
| en | 6 | 89 MiB / 0% | 118 MiB / 0% | 5012 MiB / 0% | 1717 MiB / 620% | 39 MiB / 0% | 4500 |
| mix | 1 | 89 MiB / 0% | 118 MiB / 0% | 5014 MiB / 604% | 1707 MiB / 0% | 17 MiB / 0% | 12000 |
| mix | 3 | 90 MiB / 0% | 118 MiB / 0% | 5198 MiB / 636% | 1710 MiB / 106% | 51 MiB / 0% | 11667 |
| mix | 5 | 91 MiB / 0% | 124 MiB / 0% | 5215 MiB / 670% | 1712 MiB / 140% | 105 MiB / 0% | 12333 |
| mix | 6 | 91 MiB / 0% | 124 MiB / 0% | 5210 MiB / 649% | 1711 MiB / 154% | 96 MiB / 0% | 13200 |

## สัดส่วนการใช้เครื่อง (% ของ 10 คอร์ และ RAM 16 GiB ที่ให้ container: CPU เฉลี่ย / CPU สูงสุด / RAM สูงสุด)

| ภาษา | พร้อมกัน | web-app | stt-service | stt-worker-th | stt-worker-en | ffmpeg |
|---|---|---|---|---|---|---|
| th | 1 | 0.0% / 0.0% / 0.5% | 0.0% / 0.0% / 0.7% | 61% / 64% / 30% | 0.0% / 0.0% / 9.1% | 0.0% / 0.0% / 0.1% |
| th | 3 | 0.0% / 0.0% / 0.5% | 0.0% / 0.0% / 0.7% | 78% / 84% / 32% | 0.0% / 0.0% / 9.1% | 0.0% / 0.0% / 0.4% |
| th | 5 | 0.0% / 0.0% / 0.5% | 0.0% / 0.0% / 0.7% | 76% / 89% / 32% | 0.0% / 0.0% / 9.1% | 0.0% / 0.0% / 0.3% |
| th | 6 | 0.0% / 0.0% / 0.5% | 0.0% / 0.0% / 0.7% | 79% / 92% / 32% | 0.0% / 0.0% / 9.1% | 0.0% / 0.0% / 0.4% |
| en | 1 | 0.0% / 0.0% / 0.5% | 0.0% / 0.0% / 0.7% | 0.0% / 0.0% / 31% | 40% / 40% / 9.7% | 0.0% / 0.0% / 0.1% |
| en | 3 | 0.0% / 0.0% / 0.5% | 0.0% / 0.0% / 0.7% | 0.0% / 0.0% / 31% | 62% / 62% / 10% | 0.0% / 0.0% / 0.2% |
| en | 5 | 0.0% / 0.0% / 0.5% | 0.0% / 0.0% / 0.7% | 0.0% / 0.0% / 31% | 63% / 66% / 10% | 0.0% / 0.0% / 0.2% |
| en | 6 | 0.0% / 0.0% / 0.5% | 0.0% / 0.0% / 0.7% | 0.0% / 0.0% / 31% | 62% / 67% / 10% | 0.0% / 0.0% / 0.2% |
| mix | 1 | 0.0% / 0.0% / 0.5% | 0.0% / 0.0% / 0.7% | 60% / 62% / 31% | 0.0% / 0.0% / 10% | 0.0% / 0.0% / 0.1% |
| mix | 3 | 0.0% / 0.0% / 0.5% | 0.0% / 0.0% / 0.7% | 64% / 72% / 32% | 11% / 20% / 10% | 0.0% / 0.0% / 0.3% |
| mix | 5 | 0.0% / 0.0% / 0.6% | 0.0% / 0.0% / 0.8% | 67% / 90% / 32% | 14% / 30% / 10% | 0.0% / 0.0% / 0.6% |
| mix | 6 | 0.0% / 0.0% / 0.6% | 0.0% / 0.0% / 0.8% | 65% / 80% / 32% | 15% / 32% / 10% | 0.0% / 0.0% / 0.6% |

stt-worker-th = ทุก worker ของโมเดลไทยรวมกัน, stt-worker-en = ของโมเดลอังกฤษ · CPU สูงสุด = ช่วง 2 วินาทีที่ใช้มากที่สุด

### ตอนว่าง (ทุก worker โหลดโมเดลแล้ว)

| process / โมเดล | จำนวน process | RAM (MiB) | % ของ RAM |
|---|---|---|---|
| launcher | 1 | 52 | 0.3% |
| stt-service | 2 | 108 | 0.7% |
| web-app | 1 | 76 | 0.5% |
| stt-worker-th | 3 | 4947 | 30% |
| stt-worker-en | 2 | 1454 | 8.9% |
| **รวม** | | **6637** | **41%** |

หมายเหตุ: CPU% คิดจากเวลา CPU สะสมต่อเวลาจริง (100% = 1 คอร์) · GPU memory คือหน่วยความจำ MPS ที่ worker จองไว้ (unified memory) GPU utilization วัดจาก ioreg ของ macOS ทั้ง GPU (รวมแอปอื่น) จึงแสดงคู่กับค่าตอนว่าง
ใน Docker เวลา CPU จาก `ps` ของ Linux ละเอียดแค่ 1 วินาที process ที่ใช้ CPU น้อย (web-app, ffmpeg) จึงแสดงเป็น 0% ดูต้นทุน ffmpeg จากค่าที่วัดแยกด้านบน

<!-- e2e:start -->
## End-to-End Latency ในเบราว์เซอร์ (ms, median / p95) — http://127.0.0.1:3330

วันที่ 2026-11-13T04:58:19.698Z · Chrome อัตโนมัติ (headless, WebGL แบบ SwiftShader) 6 หน้าต่างบนเครื่องเดียวกับ server · ใช้ไฟล์เสียงแทนไมค์ · ทำซ้ำ 3 รอบต่อระดับ
สร้างด้วย `node scripts/bench-e2e.mjs --url http://127.0.0.1:3330 --report docs/benchmarks/2026-11-13-voice-load-docker-10cpu-16g-clim.md` · ข้อมูลดิบ: 2026-11-13-voice-e2e-127.0.0.1.json

| ภาษา | พร้อมกัน | n (server) | 1 หยุดอัด | 2 upload | 3 ffmpeg | 4 รอ worker | 5 ถอดเสียง | 6 ส่งกลับ | 7 parseCommand | 8 วางเส้นทาง + Avatar เริ่มเดิน | **End-to-End รวม** | ไป Browser STT Fallback | ถึง Station ถูก | โมเดล@device (float32) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| th | 1 | 3 | 52 / 54 | 1 / 4 | 122 / 124 | 19 / 22 | 2949 / 3193 | 10 / 27 | 2 / 8 | 0 / 0 | **3169 / 3411** | 0 | 3/3 | biodatlab/whisper-th-small-combined@cpu |
| th | 3 | 9 | 52 / 54 | 0 / 2 | 71 / 98 | 14 / 28 | 9128 / 10628 | 6 / 13 | 4 / 6 | 1 / 2 | **9277 / 10765** | 0 | 9/9 | biodatlab/whisper-th-small-combined@cpu |
| th | 5 | 9 | 53 / 54 | 0 / 6 | 85 / 123 | 16 / 54 | 11418 / 12736 | 9 / 34 | 5 / 9 | 2 / 12 | **11618 / 12937** | 6 | 15/15 | biodatlab/whisper-th-small-combined@cpu |
| th | 6 | 9 | 53 / 54 | 0 / 2 | 91 / 136 | 11 / 22 | 8507 / 12605 | 7 / 11 | 3 / 13 | 1 / 3 | **8703 / 12771** | 9 | 18/18 | biodatlab/whisper-th-small-combined@cpu |
| en | 1 | 3 | 53 / 53 | 1 / 1 | 91 / 108 | 10 / 15 | 742 / 1037 | 5 / 5 | 1 / 1 | 0 / 0 | **877 / 1226** | 0 | 3/3 | openai/whisper-base.en@cpu |
| en | 3 | 6 | 53 / 54 | 1 / 1 | 77 / 133 | 10 / 30 | 1759 / 1951 | 5 / 8 | 1 / 6 | 0 / 2 | **1896 / 2135** | 3 | 9/9 | openai/whisper-base.en@cpu |
| en | 5 | 6 | 53 / 54 | 0 / 1 | 65 / 125 | 13 / 19 | 1745 / 1829 | 5 / 10 | 1 / 3 | 0 / 2 | **1906 / 2036** | 9 | 15/15 | openai/whisper-base.en@cpu |
| en | 6 | 6 | 53 / 53 | 1 / 1 | 95 / 135 | 9 / 27 | 1576 / 1686 | 5 / 8 | 3 / 3 | 0 / 1 | **1761 / 1884** | 12 | 18/18 | openai/whisper-base.en@cpu |
| mix | 1 | 3 | 53 / 53 | 0 / 4 | 123 / 140 | 15 / 35 | 2779 / 2909 | 6 / 12 | 2 / 3 | 0 / 0 | **3041 / 3086** | 0 | 3/3 | biodatlab/whisper-th-small-combined@cpu |
| mix | 3 | 9 | 52 / 54 | 0 / 5 | 90 / 126 | 17 / 30 | 5393 / 6358 | 7 / 12 | 2 / 4 | 0 / 1 | **5623 / 6568** | 0 | 9/9 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |
| mix | 5 | 15 | 53 / 53 | 0 / 2 | 85 / 130 | 16 / 49 | 8337 / 9854 | 5 / 32 | 2 / 7 | 0 / 2 | **8523 / 9974** | 0 | 15/15 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |
| mix | 6 | 15 | 53 / 54 | 0 / 3 | 103 / 188 | 13 / 63 | 8159 / 9222 | 7 / 12 | 2 / 6 | 0 / 3 | **8355 / 9381** | 3 | 18/18 | biodatlab/whisper-th-small-combined@cpu + openai/whisper-base.en@cpu |

End-to-End รวม = ตั้งแต่กดหยุดอัดจนถึง Avatar เริ่มเดิน (เป้าหมาย ≤ 3000 ms) · 6 ส่งกลับ = เวลา request ที่เบราว์เซอร์วัดลบเวลาฝั่ง server · 2 upload = เวลาที่ server อ่าน body เท่านั้น การเชื่อมต่อ/TLS/hop ของ URL สาธารณะจึงไปรวมอยู่ใน 6 ส่งกลับ · 4 รอ worker รวมเวลาเริ่ม worker และโหลดโมเดลถ้ามี · 7 และ 8 วัดในเบราว์เซอร์ที่ใช้ CPU เรนเดอร์ 3D (SwiftShader) และแย่ง CPU กับ server จึงช้ากว่าเครื่องของ Visitor จริงที่มี GPU · เปิดโหมด Flash ให้ Avatar ถึงเร็ว (ไม่กระทบขั้น 8)
<!-- e2e:end -->
