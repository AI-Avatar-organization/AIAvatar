# 0011 Login ด้วย MANGOs Session (cookie ของ subdomain) และโหมด Guest / Member

สถานะ: ยอมรับ (2026-11-17)

ทีม DEV deploy เว็บไว้ที่ `https://ai.mangosgo.com/aiavatar/` (k3s บน ntserver02) ซึ่งอยู่ใต้ `*.mangosgo.com`
MANGOs มีสองวิธีให้เลือก: First-party Subdomain Cookie SSO สำหรับแอปใต้ `*.mangosgo.com` และ Third-party OAuth สำหรับแอปที่อยู่ที่อื่น
เราเลือก **Cookie SSO** เพราะง่ายที่สุด ไม่ต้องขอ client id/secret และไม่ต้องเก็บ token เอง

## วิธีทำงาน
- เว็บเปิดเป็น **Guest** เสมอ หน้าเว็บเรียก `GET api/auth/me` (same-origin) เพื่อตรวจว่าเป็น **Member** ไหม
- backend อ่าน cookie `accessToken` ที่ MANGOs ตั้งไว้บน `.mangosgo.com` แล้วเรียก `GET https://api.mangosgo.com/api/v1/users/me` แบบ Bearer
- cache ผลที่สำเร็จ 60 วินาทีโดยใช้ token เป็น key (ตามคู่มือ MANGOs) ไม่ cache ผลที่ไม่ผ่าน
- ส่งให้หน้าเว็บเฉพาะ id, ชื่อ และรูปโปรไฟล์ ไม่ส่งอีเมลหรือ role
- ไม่ redirect ไปหน้า Login เอง Visitor ต้องกดปุ่ม "เข้าสู่ระบบด้วย MANGOs" (`https://mangosgo.com/login?redirect=<หน้านี้>`)
- ไม่ตั้ง cookie ของตัวเอง (ชื่อ `accessToken`/`refreshToken` เป็นของ MANGOs)
- ที่อยู่ Login, Logout และ host ของรูปโปรไฟล์มาจาก config ฝั่ง server (`MANGOS_*`) หน้าเว็บไม่ hardcode
- ออกจากระบบคือ logout ของ MANGOs ทั้งระบบ (`POST /auth/logout`) เพราะแอปไม่มี session ของตัวเอง
- ฟีเจอร์ของ Member เช็กที่จุดเดียวคือ `features()` ใน `public/session.js`
  API ที่ต้อง Login ในอนาคต (Multiplayer) ใช้ `auth.requireMember(request)` ใน `server/auth.mjs`

## ผลที่ตามมา
- ใช้ได้เฉพาะเมื่อเว็บอยู่ใต้ `*.mangosgo.com` ถ้าย้ายไปที่อื่น (เช่น Tailscale Funnel ตาม ADR 0010) ให้ตั้ง `MANGOS_AUTH=off`
  ทุกคนจะเป็น Guest ถ้าต้องการ Login ที่นั่นต้องทำ OAuth แยก
- backend ต้องออกเน็ตไป `api.mangosgo.com` ได้ ถ้า MANGOs Auth ไม่ตอบ หน้าเว็บยังใช้งานแบบ Guest ได้
- Member ตอนนี้ได้แค่เปลี่ยน Avatar การเลือกจำไว้ใน localStorage แยกตาม MANGOs user id
  ไฟล์ Avatar ยังเป็นไฟล์ static การล็อกเป็นแค่ระดับหน้าจอ ไม่ใช่การป้องกันไฟล์
- Author mode ยังแยกจาก Login เว็บสาธารณะปิดด้วย `AUTHOR_ENABLED=false`

## ยังต้องยืนยันกับทีม MANGOs
- cookie `accessToken` ตั้ง `Domain=.mangosgo.com` จริงไหม
- `mangosgo.com/login?redirect=` ยอม redirect กลับมา `https://ai.mangosgo.com/aiavatar/` ไหม
- CORS ของ `api.mangosgo.com` อนุญาต origin `https://ai.mangosgo.com` แบบ credentials สำหรับ `POST /auth/logout` ไหม
  ถ้าไม่อนุญาต ปุ่มออกจากระบบจะพาไป `https://mangosgo.com` แทน
