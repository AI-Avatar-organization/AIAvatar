# 0010 Host บน Mac ของเจ้าของโครงการ และเปิดสาธารณะด้วย Tailscale Funnel

สถานะ: ยอมรับ (2026-11-12) ใช้ร่วมกับ ADR 0009
หมายเหตุ (2026-11-17): ทีม DEV deploy ไว้ที่ `https://ai.mangosgo.com/aiavatar/` (k3s บน ntserver02) ด้วย Login MANGOs ดู ADR 0011 ที่นั่นเป็นที่เปิดให้คนทั่วไปใช้ ส่วนการ host บน Mac ยังเป็นทางเลือกเมื่อต้องใช้ GPU

เลือก host ระบบใหม่บน Mac ของเจ้าของโครงการ (Apple M5, 10 คอร์, RAM 16 GiB) และเปิดให้คนทั่วไปเข้าใช้ด้วย Tailscale Funnel
แทนการวางบน server ของ NT/MANGOs เหตุผลคือ Mac มี GPU (MPS) ที่ถอดเสียงไทยได้ประมาณ 1.3 วินาทีต่อคำสั่ง (ADR 0007)
ซึ่งทันเป้า 3 วินาที ส่วน server ทั้งสองเครื่องไม่มี GPU, Funnel ให้ HTTPS ที่ certificate ถูกต้อง ไมค์และ Browser STT Fallback จึงใช้งานได้
และไม่ต้องแตะ host nginx ของ mangosgo.com, k3s หรือ service ของทีมอื่นเลย

## ข้อเท็จจริงจากเอกสารของ Tailscale (tailscale.com/kb/1223/funnel, อ่านเมื่อ 2026-11-12)
- เปิดสาธารณะได้เฉพาะพอร์ต 443, 8443 และ 10000 ชื่อเว็บอยู่ใต้โดเมน `<tailnet>.ts.net` ของเรา
- process ของ Tailscale บนเครื่องเป็นผู้ถอด TLS ส่งต่อไปที่ HTTP บน localhost ได้ จึงไม่ต้องมี nginx หรือ certificate ของเราเอง
- ต้องเปิด MagicDNS และ HTTPS ใน tailnet และต้องมี node attribute `funnel` ใน policy file ปิดอยู่โดยค่าเริ่มต้น
- มี bandwidth limit ที่ตั้งค่าไม่ได้และเอกสารไม่บอกตัวเลข ไม่ระบุว่ารับการเชื่อมต่อพร้อมกันได้กี่ตัว และยังเป็น beta
- ขอ certificate ถี่เกินไปอาจติด rate limit ของ Let's Encrypt (รอนานถึง 34 ชั่วโมง)

## ผลที่ตามมา
- STT Service รันแบบ native บน macOS เพื่อใช้ MPS (Docker บน macOS ใช้ MPS ไม่ได้) benchmark บน MPS กลายเป็นตัวเลขหลัก
- RAM 16 GiB ใช้ร่วมกับทุกอย่างบน Mac จำนวน worker ต่อภาษาต้องมาจาก benchmark (โมเดลไทยหนึ่งชุดใช้หลาย GB)
- Mac ต้องเปิดและออนไลน์ตลอด และห้ามหลับ (ตอนนี้ตั้ง sleep ไว้ 1 นาที)
- ต้องวัดว่า bandwidth ของ Funnel และ upload ของเน็ตรองรับ Visitor 50 คนที่โหลดไฟล์ 3D คนละประมาณ 34 MB ได้หรือไม่
- ขั้นตอนตั้งค่า Tailscale ต้องทำโดยเจ้าของ tailnet (เปิด HTTPS, MagicDNS, ใส่ funnel node attribute) เครื่องนี้มี Tailscale 1.98.8
  (แบบ Standalone system extension) และชื่อเครื่องในอนาคตจะเป็น `macbook-pro--ark1.tailfee591.ts.net` ตอนตรวจ Tailscale ยังออฟไลน์อยู่
- เอกสารของ Tailscale เขียนขัดกันเองว่า Funnel บน macOS ต้องใช้แอปแบบไหน ต้องลองบนเครื่องจริง
- release 2026-11-10 และการ deploy บน NT Server ไม่ใช่เส้นทางหลักอีกต่อไป
