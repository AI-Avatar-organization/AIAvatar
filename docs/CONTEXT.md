# AI Avatar 3D

ภาษากลางของโครงการวิจัยเรื่องการสร้างและนำประสบการณ์การนำชมใน 3D World กลับมาใช้ซ้ำ ในบริบทพิพิธภัณฑ์ มรดกทางวัฒนธรรม และการเรียนการสอนในมหาวิทยาลัย

## Language

**Creator**:
คนที่สร้างประสบการณ์ใน 3D World เช่น อาจารย์ที่อัด Replay การสอน หรือภัณฑารักษ์และนักการศึกษาที่ใส่ข้อมูลให้ AI Tour เป็น Primary User ของโครงการ (ขอบเขตบทบาทและสมมติฐานนี้ยังไม่ยืนยันภาคสนาม)
_Avoid_: User, ผู้ใช้, ผู้สร้าง Map

**Visitor**:
นักเรียน นักศึกษา นักท่องเที่ยว หรือผู้เข้าชมพิพิธภัณฑ์ที่เข้ามาเรียนรู้หรือสำรวจประสบการณ์นำชม เป็น Secondary User ของโครงการ
_Avoid_: User, ผู้ใช้, Learner, End User

**AI Tour**:
ประสบการณ์หลักของโครงการ ที่ AI Avatar พา Visitor ไปตาม Station ใน 3D World อธิบายสถานที่ และตอบคำถามจากข้อมูลที่ Creator ให้ไว้
_Avoid_: Chatbot, Virtual Tour

**Station**:
จุดหนึ่งใน 3D World ที่มีความหมายและมีความรู้ของสถานที่ผูกอยู่
_Avoid_: POI, จุดหมาย

**Replay**:
ประสบการณ์หลักคู่กับ AI Tour ที่เล่นซ้ำการเดิน ท่าทาง และเสียงของ Avatar ที่ Creator อัดไว้ในโลก 3D ไม่ใช่วิดีโอ 2D
_Avoid_: Reply, วิดีโอบันทึก

**Map**:
โลก 3D Low Poly หนึ่งผืนที่รวมภูมิทัศน์และ Asset ทุกชิ้นของพื้นที่ไว้ด้วยกัน (เช่น อุทยาน ร.2 อัมพวา มีถนน แม่น้ำ ต้นไม้ และอาคารมรดกหลายหลัง) เก็บเป็น Map Package `maps/<mapId>/` (map.json, scene.glb, knowledge/) เพิ่ม Map ได้โดยไม่แก้โค้ด อาคารเดี่ยวไม่ใช่ Map แต่เป็น Asset ที่วางลงใน Map
_Avoid_: Scene, ฉาก (เมื่อหมายถึงหน่วยข้อมูล)

**Pin**:
เครื่องหมายบนจอที่แสดง Station ให้คลิกหรือเรียกด้วยเสียง Station คือความหมาย ส่วน Pin คือสิ่งที่เห็น

**Voice Command**:
ประโยคที่ผู้ใช้พูดแล้วถูกแปลงเป็น Intent (goto, gesture, ask, stop) ด้วย keyword/regex จากคำศัพท์ของ Map และ Gesture Library

**Gesture**:
ท่าทางของ Avatar ที่เป็นคลิป animation บนโครงกระดูกของ Avatar ในคลัง Gesture Library ไม่ขึ้นกับว่ามาจาก Motion Source ไหน
_Avoid_: Animation (เมื่อหมายถึงท่าที่สั่งได้)

**Motion File**:
ไฟล์ท่าทางที่ Author นำเข้า (.glb / .fbx / .bvh) ก่อนถูกแปลง (retarget) เป็น Gesture บนโครงกระดูกของ Avatar
_Avoid_: Gesture (เมื่อยังไม่ได้แปลง), clip (เมื่อหมายถึงไฟล์ต้นทาง)

**Motion Source**:
แหล่งที่สร้าง Motion File เช่น Mixamo, QuickMagic, Rokoko เก็บในช่อง `source` ของ Gesture ไม่ตรงกับแหล่งที่รู้จักให้ใช้ `other`
แต่ละแหล่งมีสถานะสิทธิ์ใช้งาน: เชิงพาณิชย์ได้ หรือ ทดลองเท่านั้น

**Prop**:
Asset ที่ติดกับตัวนักแสดงระหว่างเล่น Gesture (กีตาร์, ไม้กลอง) Author นำเข้าผ่านระบบ Input พร้อมจุดยึด (มือซ้าย, มือขวา, Hips, พื้นหน้านักแสดง) และตำแหน่ง/มุม
_Avoid_: Asset (เมื่อหมายถึงของที่วางใน Map)

**T2 Avatar**:
Avatar แบบ Avaturn T2 ที่มี ARKit blendshapes + Visemes จึงขยับปากได้ Avatar ที่ไม่ใช่ T2 เล่น Gesture ได้แต่ขยับปากไม่ได้

**Author**:
ทีมงานที่เปิด Author mode (`?author=1`) แก้ Map และนำเข้า Motion File ผู้ชมทั่วไปนำเข้าไม่ได้

**Recording**:
ไฟล์ที่ Replay ใช้เล่น เก็บ Event Timeline ของ Avatar และเสียงพูดพร้อมคำบรรยาย ผูกกับ Map

**Asset**:
วัตถุ 3D ที่วางลงใน Map เช่น อาคาร รถ ของตกแต่ง ไฟล์อยู่ใน Map Package หรือคลังกลาง `assets/places/`
_Avoid_: Map (เมื่อหมายถึงอาคารเดี่ยว)

**Connector**:
ทางเชื่อมระหว่างระดับที่วาดไว้ใน map.json (บันได ทางลาด) ใช้เมื่อพื้นที่เดินได้ที่สร้างอัตโนมัติ (navmesh) เชื่อมสองระดับไม่ได้

**Concurrent Visitors**:
จำนวน Visitor ที่เปิดหน้าเว็บอยู่พร้อมกันในช่วงเวลาหนึ่ง ภาระหลักคือการส่งไฟล์ Map และ Avatar ครั้งแรก เพราะโลก 3D แสดงผลในเครื่องของ Visitor เอง
_Avoid_: Concurrent users, ผู้ใช้พร้อมกัน

**Simultaneous Voice Commands**:
จำนวน Voice Command ที่ถูกส่งมาถอดเสียงในวินาทีเดียวกัน เป็นภาระที่หนักที่สุดของระบบ ต่างจาก Concurrent Visitors
_Avoid_: Concurrent users (เมื่อหมายถึงคนที่กำลังพูด)

**End-to-End Latency**:
เวลาตั้งแต่ Visitor พูดจบจนถึง Avatar เริ่มทำตาม Voice Command (เดินหรือเล่น Gesture)
_Avoid_: Response time (คลุมเครือว่านับถึงตอนไหน)

**STT Service**:
บริการถอดเสียงของภาษาเดียว (เช่น STT Service ภาษาไทย, STT Service ภาษาอังกฤษ) แยกจากหน้าเว็บ และเพิ่มจำนวนได้อิสระตามภาระของภาษานั้น
_Avoid_: STT worker (เมื่อหมายถึงทั้งบริการ), Model server

**Browser STT Fallback**:
การถอดเสียงด้วยความสามารถของเบราว์เซอร์เอง ใช้เมื่อ STT Service ของภาษานั้นไม่ว่างทุกตัว Visitor จึงไม่ต้องรอคิว แต่ความแม่นยำต่ำกว่า STT Service
_Avoid_: Queue, คิวสำรอง
