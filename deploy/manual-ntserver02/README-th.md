**คู่มือ deploy AI Avatar ไปยัง https://ai.mangosgo.com/aiavatar/**

จัดเตรียมวันที่ 13 พฤศจิกายน 2569 สำหรับโครงสร้างโปรเจคปัจจุบัน และ k3s แบบหนึ่ง node บน ntserver02

สถานะล่าสุด: ติดตั้งจริงแล้วที่ https://ai.mangosgo.com/aiavatar/ ใช้ release 20261113-5 ใน namespace aiavatar
source บนเซิร์ฟเวอร์อยู่ที่ /opt/aiavatar/releases/20261113-5 และมีข้อมูลสำรองที่ /opt/aiavatar/backups/
ขั้นตอนด้านล่างเป็นคู่มืออ้างอิงสำหรับติดตั้งและดูแลระบบ ไม่ต้องติดตั้งซ้ำเพื่อเข้าใช้งานเว็บ

ทำตามทีละขั้น หากคำสั่งใดล้มเหลว ให้แก้ขั้นนั้นก่อนทำขั้นต่อไป
คำสั่งในกรอบ PowerShell ใช้บน Windows ส่วนคำสั่ง bash ใช้หลัง SSH เข้าเซิร์ฟเวอร์แล้ว

ไฟล์ประกอบทั้งหมดอยู่ที่ C:\CosmoPC\Work\AI\aiavatar\deploy\manual-ntserver02

| ไฟล์ | หน้าที่ |
|---|---|
| prepare-source.ps1 | แสดงรายการแก้ไข หรือสำรองและปรับโค้ดให้ใช้ /aiavatar/ พร้อมสวิตช์ปิด Author API |
| app.yaml | Namespace, PVC, Deployment 3 ตัว และ Service 3 ตัว |
| certificate.yaml | ขอใบรับรอง ai.mangosgo.com ผ่าน ClusterIssuer เดิม |
| ingress.yaml | เปิดเส้นทางสาธารณะ /aiavatar และตัด prefix ก่อนส่งเข้า backend |

คู่มือนี้ใช้ image ชื่อ docker.io/library/aiavatar:20261113-5 เป็น release แรก
ไม่ต้องติดตั้ง Docker Desktop, Node.js หรือ Python บน Windows เพื่อทำขั้นตอนในคู่มือนี้
การ build และติดตั้ง dependencies จะทำบนเซิร์ฟเวอร์ผ่าน Dockerfile

**1. Windows — ตรวจเครื่องมือและ SSH**

เปิด PowerShell แล้วรัน:

~~~powershell
Set-Location -LiteralPath 'C:\CosmoPC\Work\AI\aiavatar'
Get-Command ssh,scp,tar
ssh ntserver02
~~~

เมื่อเข้าได้จะอยู่ใน shell Linux ของ root บน ntserver02 ซึ่ง hostname ที่ตรวจพบคือ CLIM000551VM01
ตรวจระบบเดิมด้วย:

~~~bash
hostname
docker version
kubectl get nodes
kubectl get ingressclass
kubectl get storageclass
kubectl get clusterissuer letsencrypt-production-cloudflare-dns01
kubectl get namespace aiavatar --ignore-not-found
~~~

ควรพบ node สถานะ Ready, ingress class nginx, storage class local-path
และ ClusterIssuer สถานะ Ready=True
namespace aiavatar ยังไม่ควรมีสำหรับการติดตั้งครั้งแรก หากมีแล้ว ให้ตรวจว่าเป็นแอพนี้ก่อนใช้ไฟล์ชุดนี้
จากนั้นกลับ Windows:

~~~bash
exit
~~~

**2. Windows — สำรองโปรเจคและปรับ source**

เริ่มจากโฟลเดอร์โปรเจค:

~~~powershell
Set-Location -LiteralPath 'C:\CosmoPC\Work\AI\aiavatar'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
tar -czf "..\aiavatar-before-deploy-$stamp.tgz" .
if ($LASTEXITCODE -ne 0) { throw 'Backup failed' }
~~~

ไฟล์สำรองจะอยู่ข้างโฟลเดอร์ aiavatar ไม่ได้อยู่ข้างในโฟลเดอร์ที่จะบีบอัด
แสดงรายการแก้ไขก่อน:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\manual-ntserver02\prepare-source.ps1
~~~

ครั้งแรกควรแสดง 7 ไฟล์ และข้อความ Preview only
จากนั้นสั่งใช้จริง:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\manual-ntserver02\prepare-source.ps1 -Apply
if ($LASTEXITCODE -ne 0) { throw 'Source preparation failed' }
~~~

สคริปต์จะ:

- เปลี่ยน URL ของ HTML, imports, API, Avatar, Map และ Gesture ให้มี /aiavatar/
- รองรับไฟล์ asset ของ Map ที่อ้าง path จากรากด้วย
- เพิ่มเงื่อนไข AUTHOR_ENABLED=false เพื่อปิด API แก้ Map และเพิ่ม/แก้/ลบ Gesture
- สำรองไฟล์เดิมไว้ใต้ deploy/manual-ntserver02/source-backups/<timestamp>/

สคริปต์รันซ้ำได้ เมื่อเตรียมครบแล้วจะรายงาน Already prepared และไม่แก้เพิ่ม
การตั้งค่า path ชุดนี้เฉพาะเจาะจงสำหรับ /aiavatar/; หากเปลี่ยน URL ภายหลังต้องปรับ source อีกครั้ง

**3. Windows — แพ็กและส่งไฟล์ไปเซิร์ฟเวอร์**

~~~powershell
tar -czf ..\aiavatar-20261113-5.tgz --exclude=node_modules --exclude=build --exclude=.git --exclude=.env --exclude=certs --exclude=source-backups .
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
scp ..\aiavatar-20261113-5.tgz ntserver02:/tmp/
if ($LASTEXITCODE -ne 0) { throw 'Upload failed' }
ssh ntserver02
~~~

หลังคำสั่งสุดท้าย ให้ใช้คำสั่ง bash ในขั้นต่อไป

**4. Server — แตกไฟล์และ build image**

ตรวจว่า release directory ยังไม่เคยใช้:

~~~bash
test ! -e /opt/aiavatar/releases/20261113-5
~~~

คำสั่งนี้ไม่มีข้อความเมื่อผ่าน หากไม่ผ่านหรือ directory มีอยู่แล้ว อย่าแตกทับ release เดิม
ให้ใช้หมายเลข release ใหม่และแก้ชื่อ image ใน app.yaml ให้ตรงกัน
สำหรับการติดตั้งครั้งแรกที่ path ยังไม่มี:

~~~bash
mkdir -p /opt/aiavatar/releases/20261113-5
tar -xzf /tmp/aiavatar-20261113-5.tgz -C /opt/aiavatar/releases/20261113-5
cd /opt/aiavatar/releases/20261113-5
grep -n '/aiavatar/' frontend/public/index.html
grep -n 'AUTHOR_ENABLED' backend/server/index.mjs
docker build --platform linux/amd64 -f deploy/Dockerfile -t aiavatar:20261113-5 .
~~~

grep สองคำสั่งต้องพบ path ใหม่และสวิตช์ AUTHOR_ENABLED หากไม่พบ ให้กลับไปเตรียม source ตามขั้นที่ 2
การ build ครั้งแรกดาวน์โหลด Node dependencies, Python dependencies และโมเดล Whisper จึงอาจใช้เวลาหลายนาที
รอจน build สำเร็จก่อนดำเนินการต่อ

**5. Server — นำ image เข้า k3s**

Docker กับ k3s ใช้ image store คนละชุด จึงต้อง export และ import:

~~~bash
docker save aiavatar:20261113-5 -o /tmp/aiavatar-image-20261113-5.tar
k3s ctr --namespace k8s.io images import /tmp/aiavatar-image-20261113-5.tar
k3s ctr --namespace k8s.io images list | grep 'docker.io/library/aiavatar:20261113-5'
~~~

ต้องเห็นชื่อ image ตามคำสั่งสุดท้าย
app.yaml ใช้ imagePullPolicy: Never จึงต้อง import image ให้เรียบร้อยก่อนสร้าง Pod
แนวทางนี้ใช้กับ cluster หนึ่ง node ที่ตรวจพบ หากเพิ่ม node ภายหลังต้องนำ image เข้า node ที่จะรัน Pod ด้วย หรือเปลี่ยนไปใช้ registry
อ้างอิง: https://docs.k3s.io/add-ons/import-images

**6. Server — สร้างแอพและ storage**

~~~bash
kubectl apply -f deploy/manual-ntserver02/app.yaml
kubectl -n aiavatar rollout status deployment/aiavatar-web --timeout=600s
kubectl -n aiavatar rollout status deployment/aiavatar-stt-th --timeout=600s
kubectl -n aiavatar rollout status deployment/aiavatar-stt-en --timeout=600s
kubectl -n aiavatar get pods,svc,pvc
~~~

ต้องได้ Pod ทั้ง 3 ตัวเป็น Running และ READY 1/1 และ PVC เป็น Bound
PVC อาจเป็น Pending ชั่วคราวก่อน Pod ถูกจัดลง node เพราะ local-path ใช้ WaitForFirstConsumer

ค่าเริ่มต้นของชุดนี้:

| บริการ | workers | CPU limit | RAM limit |
|---|---:|---:|---:|
| web | — | 1 core | 512 MiB |
| STT ไทย | 3 | 6 cores | 8 GiB |
| STT อังกฤษ | 2 | 2 cores | 3 GiB |

จำนวน worker และขีดจำกัดเป็นค่าเริ่มสำหรับทดลองบนเครื่องจริง ยังไม่ได้ยืนยัน latency บน ntserver02
ตั้งจำนวน thread ของแต่ละ worker ไว้ใน app.yaml เพื่อควบคุมการใช้ CPU ร่วมกับแอพอื่น
ใช้ web เพียง 1 replica เพราะ slot ถอดเสียงยังเก็บในหน่วยความจำของ process
ค่า CPU request คือ web 100m, ไทย 1 core และอังกฤษ 250m เพื่อให้ลง node ที่มีการจอง CPU ของแอพเดิมสูงได้ โดยยังใช้ CPU ได้ถึง limit เมื่อเครื่องมีทรัพยากรว่าง

initContainer ชื่อ seed-data จะคัดลอก Map/Gesture เริ่มต้นเข้า PVC ครั้งแรกและตั้ง owner เป็น UID 1000
ครั้งต่อไปใช้ข้อมูลเดิม ไม่เขียนทับข้อมูลที่มีอยู่

หาก Pod ไม่พร้อม ให้ตรวจเฉพาะ namespace นี้:

~~~bash
kubectl -n aiavatar get events --sort-by=.metadata.creationTimestamp
kubectl -n aiavatar describe pods
kubectl -n aiavatar logs deployment/aiavatar-web -c seed-data
kubectl -n aiavatar logs deployment/aiavatar-web -c web --tail=100
kubectl -n aiavatar logs deployment/aiavatar-stt-th --tail=100
kubectl -n aiavatar logs deployment/aiavatar-stt-en --tail=100
~~~

**7. Server — ตรวจ API ก่อนเปิดสาธารณะ**

~~~bash
kubectl -n aiavatar exec deployment/aiavatar-web -- node -e 'fetch("http://127.0.0.1:3300/api/maps").then(r=>r.json()).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e);process.exit(1)})'
kubectl -n aiavatar exec deployment/aiavatar-web -- node -e 'fetch("http://127.0.0.1:3300/api/stt/status").then(r=>r.json()).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e);process.exit(1)})'
kubectl -n aiavatar exec deployment/aiavatar-web -- node -e 'fetch("http://127.0.0.1:3300/api/maps/rama2-park",{method:"PUT",body:"{}"}).then(r=>{console.log("Author API status:",r.status);if(r.status!==403)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})'
~~~

ผลที่ต้องได้:

- maps มี rama2-park และ stationCount=13, errors เป็นอาร์เรย์ว่าง
- status ของ th มี slots=3 และ en มี slots=2 เมื่อโหลด worker ครบ
- คำสั่งสุดท้ายแสดง Author API status: 403

หากจำนวน slots ยังไม่ครบ รอประมาณ 30 วินาทีแล้วตรวจใหม่
ภายใน cluster ใช้ URL /api/... ตามเดิม ส่วน /aiavatar/... เป็น path ภายนอก

**8. Cloudflare — ตรวจ DNS**

เปิด Cloudflare Dashboard เลือก zone mangosgo.com แล้วไป DNS > Records
ตรวจหรือสร้าง record:

| ช่อง | ค่า |
|---|---|
| Type | A |
| Name | ai |
| IPv4 address | 209.15.122.115 ซึ่งเป็น public IP ที่ใช้ SSH ไป ntserver02 |
| Proxy status | Proxied หรือเมฆสีส้ม |
| TTL | Auto |

หาก record ai เป็น CNAME หรือมี AAAA อยู่แล้ว ให้ตรวจปลายทางของ record เหล่านั้นด้วยก่อนแก้
Cloudflare ต้องส่ง traffic ของ host นี้เข้าถึง Ingress ของ ntserver02 ที่พอร์ต 443
ค่า DNS ที่เห็นจากเครื่องผู้ใช้เมื่อเปิด proxy จะเป็น IP ของ Cloudflare เป็นพฤติกรรมปกติ
ไม่ใส่ /aiavatar ใน DNS

คง SSL/TLS encryption mode แบบ Full (strict) ไว้ และจัด certificate ต้นทางตามขั้นถัดไป
ขณะตรวจครั้งแรก domain นี้ตอบ Error 526 ซึ่งหมายถึง Cloudflare ตรวจใบรับรองต้นทางไม่ผ่าน
อ้างอิง: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-526/

**9. Server — ออก certificate**

~~~bash
cd /opt/aiavatar/releases/20261113-5
kubectl apply -f deploy/manual-ntserver02/certificate.yaml
kubectl -n aiavatar wait --for=condition=Ready certificate/ai-mangosgo-com --timeout=600s
kubectl -n aiavatar get certificate ai-mangosgo-com
~~~

ต้องได้ READY=True
ใช้ ClusterIssuer letsencrypt-production-cloudflare-dns01 ที่มีอยู่แล้ว โดยไม่ต้องสร้าง token ใหม่ในโปรเจค
ไม่ต้องคัดลอก private key ของ certificate มาที่ Windows
หากออก certificate ไม่สำเร็จ:

~~~bash
kubectl -n aiavatar describe certificate ai-mangosgo-com
kubectl -n aiavatar get certificaterequest,orders.acme.cert-manager.io,challenges.acme.cert-manager.io
kubectl -n aiavatar get events --sort-by=.metadata.creationTimestamp
~~~

อ้างอิง: https://cert-manager.io/docs/usage/certificate/

**10. Server — เปิดเส้นทาง /aiavatar**

เมื่อ API และ certificate ผ่านแล้ว:

~~~bash
kubectl apply -f deploy/manual-ntserver02/ingress.yaml
kubectl -n aiavatar get ingress
curl --fail-with-body --silent --show-error --resolve ai.mangosgo.com:443:10.0.6.2 https://ai.mangosgo.com/aiavatar/api/maps
curl --fail-with-body --silent --show-error https://ai.mangosgo.com/aiavatar/api/maps
curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://ai.mangosgo.com/aiavatar/
~~~

curl แรกทดสอบ Ingress ต้นทางโดยข้าม Cloudflare ใช้ IP ภายใน 10.0.6.2 ที่ตรวจพบบนเซิร์ฟเวอร์นี้
curl ที่สองทดสอบเส้นทางสาธารณะผ่าน Cloudflare
สองคำสั่งแรกต้องได้ JSON ของ Map และคำสั่งสุดท้ายต้องแสดง 200
หลัง apply Ingress ครั้งแรกอาจต้องรอ controller โหลด certificate และ route ประมาณ 30 วินาที หาก curl เจอ certificate ชั่วคราวให้รอแล้วลองใหม่
ใช้ GET ตามตัวอย่าง เพราะเว็บเซิร์ฟเวอร์ของแอพนี้ยังไม่ได้รองรับ HEAD สำหรับทุก endpoint

Ingress แปลง URL เช่น /aiavatar/api/maps เป็น /api/maps ก่อนส่งไปเว็บแอพ
รองรับทั้ง /aiavatar และ /aiavatar/ โดย URL ที่ฝังในหน้าเว็บมี prefix ครบ
ชุดนี้ใช้ Ingress เดิม ไม่ต้องรัน docker compose หรือ nginx container ของโปรเจคเพิ่ม
อ้างอิง: https://kubernetes.github.io/ingress-nginx/examples/rewrite/

**11. Windows — เปิดเว็บและทดสอบการใช้งาน**

เปิด https://ai.mangosgo.com/aiavatar/ ด้วย Chrome หรือ Edge

1. ตรวจว่า Map และ Avatar แสดงครบ
2. พิมพ์ “ไปที่ศาลาดนตรี” แล้วตรวจว่า Avatar เดิน
3. พิมพ์ “โบกมือ” แล้วตรวจว่าท่าทางทำงาน
4. อนุญาตไมค์ กดเริ่มพูด แล้วกดหยุดเพื่อส่งเสียง
5. ทดสอบภาษาไทยและอังกฤษโดยสลับภาษาบนหน้าเว็บ
6. กด F12 > Network แล้ว reload ตรวจว่าไม่มีไฟล์ 404 และ URL ของแอพอยู่ใต้ /aiavatar/

หากหน้าเก่าค้างอยู่ ให้ใช้ Ctrl+F5
หาก STT ทำงานบน server ได้แต่ไมค์ใช้ไม่ได้ ให้ตรวจ site permission ของไมค์และ certificate ในเบราว์เซอร์
Browser STT Fallback ขึ้นกับการรองรับของเบราว์เซอร์และใช้บริการถอดเสียงภายนอก
Author API ถูกปิดสำหรับการเปิดเว็บสาธารณะ แม้เปิด ?author=1 ก็จะบันทึกข้อมูลไม่ได้

**12. การดู log และแก้ปัญหา**

~~~bash
kubectl -n aiavatar get pods
kubectl -n aiavatar logs deployment/aiavatar-web -c web --tail=100
kubectl -n aiavatar logs deployment/aiavatar-stt-th --tail=100
kubectl -n aiavatar logs deployment/aiavatar-stt-en --tail=100
kubectl -n aiavatar top pods
~~~

| อาการ | ตรวจอะไร |
|---|---|
| ErrImageNeverPull | import image เข้า k3s แล้วหรือไม่ และชื่อ/tag ตรง app.yaml หรือไม่ |
| Pending | ดู describe pod/PVC และ resources ของ node |
| Init:Error หรือ permission denied | ดู log ของ seed-data และ owner ของ PVC |
| Map ว่าง | seed-data สำเร็จหรือไม่ และ /app/maps มี rama2-park/map.json หรือไม่ |
| 404 ที่ app.js, API หรือ GLB | ขั้น prepare-source สำเร็จหรือไม่ และ Ingress rewrite ตรงหรือไม่ |
| 502/503 | web/STT Pod พร้อมหรือไม่ และ Service มี endpoints หรือไม่ |
| 526 | certificate พร้อมหรือไม่; เปรียบเทียบ curl ต้นทางกับ curl ผ่าน Cloudflare และตรวจ DNS/Origin Rules |
| OOMKilled | ดู memory usage และปรับ memory limit หรือจำนวน worker ใน app.yaml |
| เสียงช้า | วัด latency บน ntserver02 และปรับ workers/CPU/thread ตามภาระจริง |

หากต้องการตรวจ Service:

~~~bash
kubectl -n aiavatar get endpointslices
~~~

**การเตรียมเส้นทางเดินและ cache ของรุ่นปัจจุบัน**

Dockerfile รัน node scripts/build-navigation.mjs ระหว่าง build เพื่อสร้าง Navmesh ไว้ล่วงหน้า
ตัว build ตรวจว่าเส้นทางจากจุดเกิดไปถึง Station ทั้ง 13 จุดได้ก่อนสร้าง image สำเร็จ
ข้อมูลสำเร็จรูปเก็บใน /app/navigation ภายใน image และ API จะส่ง navigation.prebuilt ให้หน้าเว็บเมื่อ geometry ตรงกับข้อมูลที่ใช้สร้าง
จึงไม่ต้องสร้าง Navmesh ใหม่บนเธรดหน้าจอของ Visitor ทุกครั้งที่เปิดเว็บ
ถ้า geometry ไม่ตรง จะกลับไปสร้างจาก Map ปัจจุบันเพื่อไม่ใช้เส้นทางผิดรุ่น

เมื่อเปลี่ยน scene.glb, unitScale, ground, groundPlane, navigation.exclude หรือ Asset/transform ของ Map
ให้นำไฟล์ Map ปัจจุบันกลับเข้า assets/maps ของ source แล้ว build image ใหม่
การเปลี่ยนชื่อ Station และ aliases อย่างเดียวไม่ต้องสร้าง geometry ใหม่
เมื่อเปลี่ยนค่าตัวสร้าง Navmesh หรือรุ่น Recast ให้ปรับ generator version ใน backend/server/navigation.mjs เพื่อให้ URL ของผลลัพธ์เปลี่ยนตามด้วย
ไม่ต้องคัดลอก Navmesh เข้า PVC เพราะข้อมูลสำเร็จรูปอยู่แยกจาก Map/Gesture ที่แก้ไขได้

โมเดล GLB เก็บใน Cache Storage ชื่อ aiavatar-models-v1 ของเบราว์เซอร์
แต่ละการเปิดจะตรวจ ETag กับเซิร์ฟเวอร์ ถ้าไม่เปลี่ยนจะได้ 304 และใช้เนื้อหาไฟล์เดิมในเครื่อง
ถ้าเปลี่ยนจะโหลด 200 และแทนที่ข้อมูล cache หาก browser ไม่อนุญาต storage จะกลับไปโหลดปกติ
ทดสอบกรณี ETag ใน cache เก่าแล้ว: หน้าเว็บรับไฟล์ 200 ใหม่ แทนที่ cache และการเปิดถัดไปกลับมาเป็น 304 ครบทั้ง 5 โมเดล
ส่วน JavaScript/CSS ใช้ URL ที่มี /v/<release>/ เพื่อหลีกเลี่ยง code รุ่นเก่าที่ค้างใน cache

ผลวัดหนึ่งรอบบน Chrome เครื่องทดสอบ: Map พร้อมครั้งแรกประมาณ 0.98 วินาที และเปิดซ้ำประมาณ 0.54 วินาที
ก่อนแก้ได้ประมาณ 6.06 และ 6.35 วินาทีตามลำดับ โดยงานสร้าง Navmesh ใช้ 4.9–5.2 วินาที
หลังแก้การเปิดซ้ำได้ 304 ครบทั้ง 5 GLB ส่งเฉพาะ header รวมประมาณ 1.5 KB แทนเนื้อหาโมเดลประมาณ 20 MB
ตัวเลขนี้เป็นจุด Map พร้อมในเครื่องทดสอบที่เครือข่ายเร็ว ยังมีการเตรียมภาพของ GPU และผลจริงขึ้นกับเครื่องและเครือข่าย
ครั้งแรกหลังล้างข้อมูลเว็บไซต์ยังต้องดาวน์โหลดโมเดล

**13. สำรองข้อมูลก่อนอัปเดต**

ใน deployment สาธารณะนี้ API แก้ข้อมูลถูกปิด จึงไม่มีการเขียน Map/Gesture จากผู้เข้าชม
สร้าง backup จาก PVC โดยใช้ไฟล์ชั่วคราวใน Pod แล้วคัดลอกออกมา:

~~~bash
mkdir -p /opt/aiavatar/backups
stamp=$(date +%Y%m%d-%H%M%S)
pod=$(kubectl -n aiavatar get pod -l app=aiavatar-web -o jsonpath='{.items[0].metadata.name}')
kubectl -n aiavatar exec "$pod" -c web -- tar -czf "/tmp/aiavatar-data-$stamp.tgz" -C /app maps gestures
kubectl -n aiavatar cp -c web "$pod:/tmp/aiavatar-data-$stamp.tgz" "/opt/aiavatar/backups/aiavatar-data-$stamp.tgz"
~~~

สำรองไฟล์จาก /opt/aiavatar/backups ไปเก็บอีกเครื่องได้ด้วย scp จาก Windows
storage class local-path ของเครื่องนี้มี reclaim policy เป็น Delete:
อย่าลบ PVC หรือ namespace aiavatar เพื่อ restart หรืออัปเดตแอพ เพราะอาจทำให้ข้อมูลถาวรถูกลบ

**14. การอัปเดตและย้อนกลับ**

สำหรับ release ถัดไป ใช้ tag ใหม่ เช่น 20261113-6 เสมอ:

1. เตรียม source, แพ็ก และ upload เป็น release directory ใหม่
2. แก้ image ทั้ง 4 จุดใน app.yaml จาก aiavatar:20261113-5 เป็น aiavatar:20261113-6 รวม initContainer
   เมื่อแก้ frontend ให้เปลี่ยน /v/20261113-5/ ใน URL ของ stylesheet และ app.js ที่ frontend/public/index.html เป็น /v/20261113-6/ เพื่อให้ relative ES modules ทั้งชุดใช้รุ่นใหม่
3. build, docker save และ import image ใหม่เข้า k3s ตามขั้น 4–5 โดยใช้ tag ใหม่
4. สำรองข้อมูล แล้ว apply เฉพาะ app.yaml จาก release ใหม่
5. ตรวจ rollout และ API เหมือนขั้น 6–7

Deployment ใช้ Recreate จึงมีช่วงหยุดสั้น ๆ ระหว่างอัปเดต
Map/Gesture บน PVC เดิมยังใช้ต่อได้
หากมี revision ก่อนหน้าอยู่แล้ว สามารถย้อน image ของทั้ง 3 Deployment:

~~~bash
kubectl -n aiavatar rollout undo deployment/aiavatar-web
kubectl -n aiavatar rollout undo deployment/aiavatar-stt-th
kubectl -n aiavatar rollout undo deployment/aiavatar-stt-en
kubectl -n aiavatar rollout status deployment/aiavatar-web --timeout=600s
kubectl -n aiavatar rollout status deployment/aiavatar-stt-th --timeout=600s
kubectl -n aiavatar rollout status deployment/aiavatar-stt-en --timeout=600s
~~~

การย้อน Deployment ไม่ได้ย้อนข้อมูลบน PVC; ใช้ backup เมื่อต้องการย้อนข้อมูลด้วย
เก็บ image ของ release ก่อนหน้าไว้เพื่อให้ rollout undo ใช้ได้
สำหรับการติดตั้งครั้งแรกที่ยังไม่มี revision ก่อนหน้า ให้แก้ปัญหาแล้ว deploy ใหม่

หากต้องการปิดเว็บชั่วคราวโดยเก็บข้อมูล:

~~~bash
kubectl -n aiavatar delete ingress aiavatar
kubectl -n aiavatar scale deployment aiavatar-web aiavatar-stt-th aiavatar-stt-en --replicas=0
~~~

เมื่อจะเปิดใหม่ ให้ scale กลับเป็น 1 รอ Pod พร้อม แล้ว apply ingress.yaml อีกครั้ง

**สถานะการตรวจสอบไฟล์ชุดนี้**

ตรวจสคริปต์กับสำเนาโปรเจคแล้ว: preview, สำรองและแก้ไข, รันซ้ำโดยไม่แก้เพิ่ม และตรวจ syntax ของ JavaScript ผ่าน
ทดสอบ HTTP ในเครื่องกับสำเนาแอพและตัวจำลองการตัด prefix แล้ว: หน้าเว็บ, modules, asset, Map/Gesture API, การปิด Author API และการอนุญาตจองช่อง STT ผ่าน
ทดสอบแพ็กไฟล์ด้วย Windows tar และการยกเว้น source-backups ผ่าน
ตรวจ YAML และ Kubernetes admission แบบ server dry run ผ่าน โดยเปลี่ยน namespace ของสำเนาสำหรับตรวจเป็น default ที่มีอยู่แล้ว ไม่มีการสร้างทรัพยากรจริง
ติดตั้งจริงและตรวจ release 20261113-5 แล้ว: Pod ทั้ง 3 ตัว Running/Ready, PVC Bound, certificate Ready และ HTTPS ตอบ 200 ทั้ง /aiavatar และ /aiavatar/
ทดสอบข้อมูล Map หลังสร้าง Pod ใหม่แล้ว checksum ไม่เปลี่ยน; Map มี 13 Station และคลัง Gesture มี 7 ท่า
ทดสอบหน้าเว็บด้วย Chrome ผ่าน Playwright CLI เพราะ Browser plugin not available ที่ viewport 1440x900 และ 390x844
ตรวจหน้า 3D, navmesh, คำสั่งพิมพ์เดินถึงศาลาดนตรี, ท่าโบกมือ, การพับแผงบนหน้าจอเล็ก และ console ที่ไม่มี error/warning
แก้สีตัวอักษร Station ที่เคยเป็นสีขาวบนพื้นขาว เพิ่ม favicon ว่าง และใช้ URL stylesheet ที่มีเลขรุ่นพร้อม Cache-Control: no-cache สำหรับ HTML/CSS/JavaScript/JSON
ทดสอบ Whisper จริงผ่าน HTTPS ด้วยเสียงสังเคราะห์อังกฤษ “Go to the music pavilion.” ได้ข้อความตรง และคืน slot หลังถอดเสียงแล้ว
บริการไทยพร้อม 3 worker และอังกฤษ 2 worker; การจองและคืนช่องไทยผ่าน
Author API บนเว็บสาธารณะตอบ 403 ตามการตั้งค่า AUTHOR_ENABLED=false
ยังไม่ได้ทดสอบเสียงไทยจากไมค์จริง, Browser STT Fallback ผ่านไมค์จริง หรือภาระหลายผู้เข้าชมพร้อมกัน
