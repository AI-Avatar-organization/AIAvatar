# 0009 STT Service แยกต่อภาษา และใช้ Browser STT Fallback แทนคิว

สถานะ: ยอมรับ (2026-11-12) ขยาย ADR 0007

เป้าหมาย: Concurrent Visitors ≤ 50, Simultaneous Voice Commands ≤ 5 และ End-to-End Latency ≤ 3 วินาที
โดย Visitor ไม่ต้องรอคิว
เดิม Python worker ตัวเดียวโหลดทั้งสองภาษาและทำทีละคำสั่ง จึงต่อคิวอยู่แล้วเมื่อมีคนพูดพร้อมกัน

## การตัดสินใจ
1. แยก **STT Service ต่อภาษา** (ไทย, อังกฤษ) ออกจากหน้าเว็บ แต่ละบริการมี worker หลายตัว
   และปรับจำนวนได้อิสระตามภาระของภาษานั้น (compose หรือ k3s ก็ได้)
2. รันบน CPU และย่อโมเดล (เช่น int8) เพื่อให้เร็วพอ ยอมรับได้เมื่อภาษาไทยถูก ≥ 24/26 โดยไม่พาไป Station ผิด
   และภาษาอังกฤษถูก ≥ 25/26 (วัดแบบเดียวกับ ADR 0007) ถ้าโมเดลที่ย่อไม่ผ่านเกณฑ์ ให้ใช้โมเดลเดิมแล้วเพิ่ม worker แทน
3. เมื่อ worker ของภาษานั้นไม่ว่างทุกตัว ให้ใช้ **Browser STT Fallback** แทนการต่อคิว
   ตรวจว่ามี worker ว่างตอน Visitor กดไมค์ (ก่อนพูด) เพราะ STT ของเบราว์เซอร์ฟังได้เฉพาะเสียงสด
   ถ้าเต็มพอดีตอนส่งเสียง ให้ขอให้พูดซ้ำด้วย fallback ส่วนเบราว์เซอร์ที่ไม่รองรับ (Firefox) ให้แจ้งว่าพิมพ์คำสั่งแทน
4. ใช้ตัวเลขจาก benchmark (CPU/RAM ต่อ process และต่อโมเดล, เวลาทั้ง 8 ขั้นของ End-to-End Latency
   ที่ 1/3/5/6 คนพูดพร้อมกัน) กำหนดจำนวน worker ไม่ใช้การเดา

## ตัวเลือกที่ไม่เลือก
- worker pool ใน container เดิม: เพิ่มกำลังได้แค่เครื่องเดียว และหน้าเว็บกับ STT ยังผูกกัน
- STT Service เดียวรวมสองภาษา: ทุก replica ต้องโหลดสองโมเดล เปลือง RAM
- รอคิวสั้นๆ แล้วให้พิมพ์แทน / autoscale (เปิด replica ใหม่ใช้ 10–30 วินาที ไม่ทันคนที่พูดอยู่) / เตรียม worker เกินไว้ตลอด
- STT ในเบราว์เซอร์เป็นหลัก: Visitor ต้องโหลดโมเดล 0.5–1.5 GB และช้ามากบนมือถือ
- GPU: ยังไม่มีบน server ทั้งสองเครื่อง

## ผลที่ตามมา
- เมื่อใช้ Browser STT Fallback, Chrome ส่งเสียงของ Visitor ไปถอดที่ server ของ Google และแม่นยำน้อยกว่า STT Service
- จะวางระบบที่เครื่องไหน (ntplcverse ที่มี host nginx ของ mangosgo.com หรือ k3s บน CLIM000551VM01) ยังไม่ได้ตัดสินใจ
- release 2026-11-10 ยังเป็นแบบคิวเดียว เอกสารของระบบใหม่อยู่ใน release ถัดไป

## ภาคผนวก (2026-11-13): โมเดลที่เล็กลง (ticket 3)

วัดแบบเดียวกับ ADR 0007 บน Apple M5: 26 คลิปคำสั่ง Station และ 21 คลิปคำสั่ง Gesture ต่อภาษา (เสียงสังเคราะห์ macOS)
ภาษาอังกฤษใช้ prompt คำท่าทางแบบที่หน้าเว็บส่งจริง ภาษาไทยไม่มี prompt
`STT_DEVICE=cpu` / `STT_QUANTIZE=int8 npm run bench:stt -- .scratch/stt-bench rama2-park <th|en> <model>`

| ภาษา | โมเดล | device | ถูก Station | เดินผิดที่ | ถูก Gesture | เวลา median |
|---|---|---|---|---|---|---|
| th | distill-whisper-th-medium (เดิม) | MPS | 25/26 | 0 | 18/21 | 699 ms |
| th | distill-whisper-th-medium | CPU float32 | 25/26 | 0 | 18/21 | 1347 ms |
| th | distill-whisper-th-medium | CPU int8 | 25/26 | 0 | 18/21 | 2891 ms |
| th | **whisper-th-small-combined** | **MPS** | **24/26** | **0** | **19/21** | **417 ms** |
| th | whisper-th-small-combined | CPU int8 | 24/26 | 0 | 19/21 | 1133 ms |
| en | whisper-small.en (เดิม) | MPS | 26/26 | 0 | 20/21 | 322 ms |
| en | whisper-small.en | CPU float32 | 26/26 | 0 | 20/21 | 565 ms |
| en | whisper-small.en | CPU int8 | 26/26 | 0 | 19/21 | 1062 ms |
| en | **whisper-base.en** | **MPS** | **26/26** | **0** | **19/21** | **115 ms** |
| en | whisper-base.en | CPU int8 | 24/26 | 1 | 18/21 | 337 ms |

ผลที่ตัดสิน (เกณฑ์: ไทย ≥ 24/26 และไม่เดินผิดที่, อังกฤษ ≥ 25/26):
- **ไทยใช้ biodatlab/whisper-th-small-combined บน MPS** ผ่านเกณฑ์พอดี (24/26, ไม่เดินผิดที่) เร็วขึ้น 1.7 เท่า และใช้หน่วยความจำราวครึ่งหนึ่ง
  จึงวาง worker ได้มากขึ้นบน Mac 16 GiB ที่พลาดคือ "สระน้ำ" ได้ยินเป็น "สนาม" (ตกเป็นถามว่าไม่รู้จักที่นั้น ไม่ได้เดินผิด) ซึ่งรุ่นเดิมก็พลาดคำนี้ 1 ใน 2 ครั้ง
- **อังกฤษใช้ openai/whisper-base.en บน MPS** (26/26, เร็วขึ้น 2.8 เท่า) ท่าทางคำเดียวพลาดเพิ่ม 1 คลิป ("do a wai", "please sit" ตกเป็นคำถาม ไม่ได้ทำท่าผิด)
- **ไม่ใช้ int8**: บน CPU ของ Apple ช้ากว่า float32 2 เท่า (kernel qnnpack ช้ากว่า Accelerate) และ whisper-base.en แบบ int8 ไม่ผ่านเกณฑ์ (24/26 และเดินผิดที่ 1 ครั้ง)
  ยังเลือก int8 ได้ด้วย `STT_QUANTIZE=int8` สำหรับ server x86 ในอนาคต ซึ่งต้องวัดใหม่บนเครื่องนั้น
- รุ่นเดิมยังเลือกได้ด้วยการตั้งค่า ไม่ต้องแก้โค้ด: `STT_MODEL_TH=biodatlab/distill-whisper-th-medium STT_MODEL_EN=openai/whisper-small.en`
- CPU ของ Mac แบบ native (ไทย 1.3 วินาที) เร็วกว่าใน Docker ของ ticket 1 (9 วินาที, 4 CPU) มาก: macOS ใช้ Accelerate ส่วน PyTorch บน Linux ใน container ไม่ได้ใช้ และถูกจำกัดที่ 4 CPU
  ตัวเลข CPU ของ server จริงจึงต้องวัดบนเครื่องนั้น
