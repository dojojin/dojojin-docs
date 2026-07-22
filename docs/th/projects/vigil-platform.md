---
title: Vigil Platform
description: ระบบ CCTV analytics แบบ self-hosted — รองรับกล้องหลายยี่ห้อ, ติดตาม real-time, แจ้งเตือน LINE, และบริหารข้อมูลตาม PDPA แบบ on-premise ไม่ผูกติดกับยี่ห้อใด
---

# Vigil Platform

Vigil Platform คือระบบ CCTV analytics แบบ self-hosted สำหรับองค์กรที่ต้องการมากกว่า NVR ทั่วไป — intelligent alerting, รวมกล้องหลายยี่ห้อไว้บน dashboard เดียว และควบคุมข้อมูลได้เบ็ดเสร็จ

ชื่อ Vigil มาจากภาษาอังกฤษ หมายถึงการเฝ้าระวังอย่างตื่นตัว นั่นคือสิ่งที่แพลตฟอร์มนี้ทำ: ติดตามกล้องทุกตัวตลอด 24 ชั่วโมง ตรวจจับ event แจ้งเตือนคนที่ใช่ และบันทึกทุกอย่างโดยอัตโนมัติ โดยไม่ต้องมีคนนั่งเฝ้าตลอดเวลา

**เวอร์ชันปัจจุบัน:** v1.5.3 — production-ready, deploy ในสภาพแวดล้อมจริงแล้ว

---

## กลุ่มเป้าหมาย

Vigil Platform ออกแบบสำหรับองค์กรที่ดำเนินระบบ CCTV อยู่แล้วและต้องการ analytics, intelligent alerting, และการบริหารข้อมูลที่ตรวจสอบได้:

| กลุ่ม | ขนาดทั่วไป | ความต้องการหลัก |
|---|---|---|
| สำนักงาน, ภาครัฐ, ธนาคาร, สาธารณสุข | 100–500 กล้อง | Dashboard รวม, แจ้งเตือน LINE, PDPA compliance |
| สนามบิน, มหาวิทยาลัย, ศูนย์ประชุม | 200–1,000 กล้อง | รวมกล้องหลายยี่ห้อ, รายงานกำหนดเอง, วิเคราะห์ผู้เข้าชม |
| โรงงาน, คลังสินค้า, อุตสาหกรรม | 50–2,000 กล้อง | Perimeter analytics, เก็บข้อมูลระยะยาว, intelligence เชิงปฏิบัติการ |
| ค้าปลีก (ห้างสรรพสินค้า, ร้านสะดวกซื้อ, outlet) | 30–500 กล้อง | นับคน, วิเคราะห์การจราจร, multi-branch |
| การศึกษา | 50–500 กล้อง | ความปลอดภัยนักเรียน, PDPA เข้มงวด, งบประมาณจำกัด |

---

## ความสามารถหลัก

### รองรับกล้องหลายยี่ห้อ

Vigil รับ event จากกล้องหลายยี่ห้อผ่าน pipeline ที่เป็นกลางต่อยี่ห้อ alert engine, analytics, reporting, และ dashboard ไม่มี logic ที่ผูกกับยี่ห้อใด — การเพิ่มกล้องยี่ห้อใหม่ต้องการแค่ ingester module ใหม่

Protocol ที่รองรับ:

- **Bosch BVMS** — MQTT over ONVIF Profile M; รองรับ IVA Pro และ IVA Basic (Crossing Line, Object In Field, Loitering, Counting และอื่น ๆ)
- **Hikvision** — ISAPI HTTP alert stream; Smart Events และ Face Capture
- **Dahua** — CGI VCA events: Line Crossing, Intrusion, Smart Motion; ANPR/LPR อ่านป้ายทะเบียน (กล้อง ITC); Face Capture ผ่านการดึง crop จาก NVR (RPC2); pre-alarm RTSP clips; รองรับ NVR หลาย channel
- **ONVIF generic** — โหมด monitor-only (live snapshot + reachability probe); full event ingestion อยู่ใน roadmap

### อ่านป้ายทะเบียน (LPR)

Vigil รับ event ANPR/LPR จากกล้องที่รองรับและ index ลงในฐานข้อมูลป้ายทะเบียนที่ค้นหาได้ แต่ละ record เก็บ crop ป้าย, ภาพ scene เต็ม, ประเภทยานพาหนะ, ประเภททะเบียน (จากสีป้าย), จังหวัด, และความเร็ว (กรณีมีข้อมูล)

- **Hikvision ANPR** — integration ผ่าน ISAPI stream
- **Dahua ITC** — integration ผ่าน CGI event; ประเภทยานพาหนะได้แก่ รถเก๋ง, SUV, รถบรรทุก, กระบะ, มอเตอร์ไซค์ และอื่น ๆ

หน้า LPR ให้ค้นหา forensic ตามเลขป้าย, ช่วงเวลา, กล้อง, และประเภทยานพาหนะ พร้อม dashboard สถิติแสดง activity ตาม category, แยกต่อกล้อง, และ timeline

**ฟีเจอร์บังคับใช้กฎจราจร:**
- **ตรวจจับไม่สวมหมวกกันน็อค** — มอเตอร์ไซค์ที่ผู้ขับไม่สวมหมวกถูกแยกเป็นประเภทยานพาหนะเฉพาะ มี KPI card และ filter แยก
- **ตรวจจับซ้อนสาม (3+ คน)** — KPI card แสดง event ที่ตรวจพบผู้ซ้อนเกิน 2 คน คลิกผ่านไปยัง event list ที่กรองแล้ว
- **ตรวจจับไม่คาดเข็มขัดนิรภัย** — ผู้ขับขี่ที่ไม่คาดเข็มขัดถูก flag แยกต่างหาก รองรับกล้อง Dahua ITC ที่รองรับฟีเจอร์นี้
- **ตรวจจับป้ายทะเบียนไม่ตรง (สวมป้าย)** — เมื่อป้ายทะเบียนเดิมถูกอ่านพร้อมลักษณะยานพาหนะที่ไม่สอดคล้องกันในหลาย event จะถูก flag ว่าเป็นผู้ต้องสงสัยป้ายโจร/ป้ายปลอม เจ้าหน้าที่สามารถตรวจสอบและ dismiss กรณี false positive
- **จดจำป้ายทะเบียนในพื้นที่** — ป้ายทะเบียนที่จดทะเบียนในกองยานพาหนะของสถานที่ถูกติดตามแยกต่างหาก ช่วยแยกแยะยานพาหนะประจำพื้นที่กับผู้มาจากภายนอก
- **บัญชีเฝ้าระวังป้ายทะเบียน (Watchlist)** — ป้ายที่อยู่ในบัญชีเฝ้าระวังจะ trigger แจ้งเตือนทันทีพร้อมระบบรับทราบ (acknowledge) เมื่อกล้องตรวจพบ

### ติดตาม Real-Time

กล้องทุกตัวถูก probe ตาม heartbeat cycle การเปลี่ยนสถานะจาก online เป็น offline ตรวจพบภายใน 60 วินาทีและ trigger notification

Dashboard **Security Morning Briefing** ให้ภาพรวมปฏิบัติการทันที:

- Status strip ของกล้องทั้งหมด
- Attention alert ใน 4 ชั่วโมงที่ผ่านมา
- Activity timeline 24 ชั่วโมง
- แผนที่ site พร้อม event overlay แบบ live
- Top 5 กล้องที่มี event มากสุด

Snapshot กล้องส่งผ่าน live proxy พร้อม fallback อัตโนมัติ KPI counts (กล้อง online, event วันนี้, การใช้ disk) อัปเดตฝั่ง server พร้อมจัดการ timezone อย่างถูกต้อง

กล้องจัดกลุ่มได้ตาม floor, อาคาร, หรือ zone dashboard รองรับการกรองตาม tab ต่อกลุ่ม event ที่เข้ามาทุกรายการแสดง toast notification ที่มองเห็นได้ทุกหน้า พร้อม burst throttling กันกล้อง high-frequency ท่วม interface

### บริหาร Event และ Analytics

Event ถูกเก็บพร้อม metadata ครบ สามารถค้นหา กรอง และ paginate ฝั่ง server ได้ filter ได้ตาม กล้อง, rule name, event class, ยี่ห้อ, และช่วงเวลา

**Stats v2** มี:

- KPI card แยกตาม event category
- Breakdown เป็นสัดส่วน (pie chart)
- Event timeline ต่อกล้อง
- Activity Heatmap — ชั่วโมงต่อวันเทียบกับวันในสัปดาห์
- Top rules และกล้องที่เงียบที่สุด
- Export CSV
- Click-to-drill-down บน chart element ใด ๆ เพื่อดู event list ดิบ
- **Zone Dwell Time** — stat card แสดงระยะเวลาที่วัตถุอยู่ภายใน zone ที่กำหนด (FieldDetector events); ระยะเวลาแสดงใน event detail modal ด้วย

**Density Over Time** ติดตาม aggregation จำนวนคน (จากกล้องที่รองรับ) และแสดง trend พร้อม median smoothing ส่งผ่าน WebSocket

### Alert และ Report

**LINE Notification** — integration LINE ในตัว ส่ง alert พร้อม snapshot โดยตรงไปยังผู้ใช้หรือกลุ่มแชทใน LINE ภายใน 5 วินาทีจากที่ตรวจพบ event

**Camera Offline Alert** — เมื่อกล้องออฟไลน์ จะส่ง LINE notification พร้อมชื่อกล้องและเวลาที่ไม่สามารถเข้าถึงได้ ตั้งค่า repeat interval, escalation, และการแจ้งกู้คืนได้

**Recorder Wedge Detection** — เมื่อ buffer บันทึกก่อน event หยุดอัปเดตนานกว่า 5 นาที จะส่ง LINE notification อัตโนมัติ ตรวจจับ recorder ที่ขัดข้องแบบเงียบ — service ยังทำงานอยู่แต่ไม่ได้บันทึก clip — ก่อนที่จะพบปัญหาในระหว่างการทบทวนเหตุการณ์

**Analytics Report** — รายงาน 4 ประเภท (รายวัน, รายสัปดาห์, รายเดือน, ช่วงกำหนดเอง) render เป็น PDF หรือ PNG ส่งอัตโนมัติไปยัง LINE ตามกำหนดและเก็บประวัติ 90 วัน

**Health Report** — รายงานสถานะระบบทั้งหมด render เป็น PNG พร้อม 5 ส่วนที่ตั้งค่าได้: สรุป uptime กล้อง, ปริมาณ event, การใช้ disk, กิจกรรม alert, และการประเมินคุณภาพภาพ banner แจ้งอัตโนมัติเมื่อกล้องออฟไลน์เกิน 50% หรือ disk เกิน 85%

### Face Capture

Vigil จับและเก็บ face crop พร้อมภาพพื้นหลังเต็มรูปสำหรับยี่ห้อที่รองรับ แต่ละ face record มี demographic attribute ที่ firmware ของกล้องตรวจจับ: ช่วงอายุโดยประมาณ, เพศ, อารมณ์, และ attribute เช่น หน้ากาก, แว่น, หรือหมวก ภาพเก็บใน server ของลูกค้า — ไม่ใช้ cloud storage มีแกลเลอรี่ที่กรองได้และ face detail modal ใน dashboard

- **Hikvision** — ดึง face crop ผ่าน ISAPI stream
- **Dahua** — ดึง face crop และภาพเต็มโดยตรงจาก NVR storage; รวมคะแนน similarity และสถานะ blacklist match จาก event `FaceComparision`

### Snapshot Overlay

Snapshot ของ event แสดง overlay bounding-box และ geometry ของ zone วาดตรงบนภาพ overlay render ฝั่ง client โดยใช้ coordinate ที่กล้องจับได้ ณ เวลาที่เกิด event:

- **Dahua** — event ประเภท face และ FieldDetector มี bounding box รอบตัวคน
- **Hikvision** — Smart Events มี bounding box และ polygon ของ zone

ตั้งค่าต่อกล้องได้อิสระว่าจะเปิด/ปิด overlay ของ bounding box และ zone outline โดยปุ่ม toggle แสดงเฉพาะยี่ห้อที่ส่งข้อมูล coordinate มาเท่านั้น

### Appearance Search (Bosch IVA)

สำหรับ site ที่ใช้กล้อง Bosch ที่มี IVA Pro firmware Vigil จับและ index ข้อมูลสีเสื้อผ้าของทุกคนที่ตรวจจับได้ แต่ละ appearance record เก็บ color cluster ครบชุด — สีหลักและสีรอง — สามารถค้นหาแบบ two-tone clothing ได้จากหน้า Events และ Appearances โดยตรง

กล้องที่รัน IVA firmware มาตรฐาน (ไม่ใช่ Pro) รองรับด้วยแม้ความละเอียดลดลง: จับสีเด่นหนึ่งสีต่อคน ช่วยให้กรองตามสีได้กว้างๆ แม้ไม่มี Pro license

### Pre-Alarm Video Clip

RTSP buffer แบบ rolling บันทึกต่อเนื่องจาก sub-stream ที่ตั้งค่าได้ เมื่อ event trigger ระบบ dump clip พร้อมวินาทีก่อนและหลัง event ที่ตั้งค่าได้ clip เข้าถึงได้จาก event detail view และเล่นได้ใน mobile app ฟีเจอร์นี้รองรับทั้ง 3 ยี่ห้อ

### Map View

กล้องถูก plot บนแผนที่จริงโดยใช้ OpenLayers 9 ฟีเจอร์:

- **Multi-group color-coded overlay** — แต่ละกลุ่มกล้องมีสี pin และ ring เป็นของตัวเอง ซ่อนหรือแสดงแต่ละกลุ่มได้
- **Live Pulse** — เมื่อ event เข้ามา การ์ดลอยพร้อม snapshot และประเภท event จะปรากฏเหนือ pin ของกล้องแบบ real-time; debounced ต่อกล้องกันวุ่นวาย
- **Heatmap** — ความหนาแน่น event 24 ชั่วโมง render เป็น color overlay; คลิก zone ใดก็ drill down ไปยัง event list
- **Wall Mode** — แผนที่แบบเต็มจอ ซ่อน sidebar และ header เหมาะสำหรับจอ SOC และ TV wall
- **Camera popup** — แตะ pin เพื่อดูสถานะปัจจุบัน, last-seen time, top event rules ใน 24 ชั่วโมงที่ผ่านมา, และ snapshot ล่าสุด
- **Offline tile cache** — download map tile ล่วงหน้าสำหรับ bounding box และ zoom range ที่กำหนดเอง; แผนที่ทำงานได้โดยไม่ต้องต่ออินเทอร์เน็ต เหมาะสำหรับเครือข่ายแบบ isolated

### Maintenance Mode

กล้องใด ๆ สามารถวางเข้า Pause / Maintenance Mode ระหว่างการซ่อมบำรุง ขณะ pause:

- ingester หยุดประมวลผล event ของกล้องนั้น
- LINE offline alert ถูก suppress
- การ์ดกล้องแสดง maintenance indicator แทน live feed
- ช่วง pause ถูก exclude จากการคำนวณ uptime percentage
- ทุก pause และ resume ถูกบันทึก audit log พร้อม timestamp และชื่อ operator

### System Health Dashboard

หน้า admin-only ที่ auto-refresh ทุก 15 วินาที รายงาน: database latency, event rate, MQTT pipeline freshness, จำนวน online/offline, snapshot file count และขนาด, disk free/total, process uptime และ memory, WebSocket client count, system load average, และคุณภาพภาพต่อกล้อง

Service management controls ให้ admin restart service แต่ละตัวโดยไม่ต้อง SSH ทุก action บันทึก audit log

---

## ประโยชน์หลัก

**เป็นเจ้าของข้อมูลเองทั้งหมด** ข้อมูลกล้อง event, snapshot, face image, และ report ทั้งหมดเก็บบน server ของลูกค้าเอง ข้อมูลไม่ออกนอกสถานที่หากไม่ตั้งค่าเป็นพิเศษ

**ไม่ผูกติดกับยี่ห้อ** กล้องหลายยี่ห้ออยู่ร่วมบน dashboard เดียว การเปลี่ยนหรือเพิ่มกล้องไม่ต้องเปลี่ยน analytics platform

**ค่าใช้จ่ายแบบ one-time** Vigil ขายเป็น perpetual license (tier G1–G5 แยกตามจำนวนกล้อง) พร้อม annual maintenance ไม่มีค่า subscription รายเดือนต่อกล้อง

**เข้าถึง source code** ลูกค้าได้รับ source code ทั้งหมดภายใต้ license สามารถ customize, extend, หรือ audit ภายในได้

**White-label ready** logo, สี, และชื่อแบรนด์ตั้งค่าได้ต่อ deployment system integrator และ reseller สามารถส่งมอบ Vigil ภายใต้ชื่อแบรนด์ตัวเองได้

**Interface สองภาษา** dashboard และ report รองรับทั้งภาษาไทยและอังกฤษ สลับได้ทันที

**ความยืดหยุ่นในการ deploy** Vigil รันบน Docker Compose บน Linux hardware ของลูกค้า ใช้ Cloudflare Tunnel สำหรับ remote access โดยไม่ต้องเปิด inbound firewall port

---

## สถาปัตยกรรมระบบ

Vigil Platform แบ่งเป็น 4 layer:

**Ingestion Layer** — ingester process เฉพาะยี่ห้อเชื่อมต่อกับระบบกล้องและแปลง event format ที่เป็น proprietary ให้เป็น internal schema มาตรฐาน EMQX 5.8 MQTT broker จัดการการเชื่อมต่อกล้อง Bosch และ provision credential ต่อกล้องโดยอัตโนมัติเมื่อเพิ่มกล้อง Bosch ใหม่

**Processing Layer** — Node.js API server จัดการ authentication, authorization, business logic, alert rule evaluation, และ report generation WebSocket connection push snapshot stream และ real-time event notification ไปยัง browser และ mobile client

**Storage Layer** — PostgreSQL 16 เก็บ event, camera metadata, user account, alert rule, LINE configuration, face image, audit log, และ report ทั้งหมด

**Presentation Layer** — SPA 15 หน้าสร้างเพื่อความเร็ว หน้าโหลดเสร็จภายใน 2 วินาทีด้วย server-side pagination และ caching

**Deployment profiles:**

| Profile | รวม |
|---|---|
| A | Event ingestion, statistics, LINE alerts |
| B | Profile A + live snapshots |
| C | Profile B + pre-alarm video clips |

**License tier แยกตามจำนวนกล้อง:**

| Tier | กล้อง |
|---|---|
| G1 Starter | สูงสุด 100 |
| G2 Standard | สูงสุด 500 |
| G3 Pro | สูงสุด 1,000 |
| G4 Enterprise | สูงสุด 2,000 |
| G5 Datacenter | สูงสุด 3,000 |

**Performance ที่วัดได้ (v1.5.0 production):**

- Alert latency จาก event ถึง LINE push: ต่ำกว่า 5 วินาที
- Dashboard page load: ต่ำกว่า 2 วินาที

---

## ความปลอดภัย

Vigil Platform ผ่านการ audit ความปลอดภัย 6 รอบ ครอบคลุม codebase ทั้งหมด: backend API, frontend, database, และ infrastructure รอบล่าสุดเป็นการยิงทดสอบแบบ low-impact กับระบบ production จริงที่กำลังรัน — ไม่ใช่แค่อ่าน source code การ audit ใช้วิธีการตาม OWASP Top 10 และรวมถึงการตรวจสอบ PDPA compliance

**ดำเนินการ security audit 6 รอบอย่างเป็นทางการ รวมถึงการทดสอบเจาะระบบกับ production จริง (live pentest) ปัญหาระดับ Critical และ High ได้รับการแก้ไขครบถ้วนแล้ว จุดที่ยังเปิดอยู่เป็นการเลื่อนตั้งใจพร้อมเหตุผลที่บันทึกไว้**

### Authentication และ Authorization

- Password ถูก hash ด้วย bcrypt Session ใช้ HMAC-SHA256 signing อายุ token 7 วัน พร้อม idle timeout 15 นาที
- **Brute-force protection** — พยายาม login ผิด 5 ครั้งติดต่อกัน lock account 15 นาที
- **Triple-layer session handling** — รองรับ browser ที่มี third-party cookie restrictions เข้มงวด รวมถึง Safari ITP
- **Role-based access control (RBAC)** 3 ระดับ: admin (เข้าถึงได้ทั้งหมด), viewer (อ่านอย่างเดียว), auditor (อ่าน + export; คำขอ write ทั้งหมดถูกบล็อกที่ server middleware ไม่ใช่แค่ UI)
- **Server-side password-change enforcement** — ผู้ใช้ที่ถูก flag ให้เปลี่ยนรหัสผ่านบังคับไม่สามารถเรียก API endpoint ใดได้จนกว่าจะปฏิบัติตาม บังคับที่ server middleware
- WebSocket connection ทั้งหมดต้องการ JWT authentication ตอน upgrade

### การป้องกันข้อมูล

- Camera credential ถูก encrypt at rest ด้วย AES-256-GCM encryption key เก็บแยกจาก configuration file
- Camera password ถูกซ่อนใน log ส่งเป็น plaintext เฉพาะ admin session สำหรับ pre-fill แบบฟอร์มแก้ไข; viewer และ auditor session ได้รับค่าที่ถูก redact
- API error response ส่ง generic message ไปยัง client stack trace แบบเต็มเขียนเฉพาะ server-side log
- File upload ถูก validate ด้วย magic bytes (ตรวจ header ไฟล์จริง) ไม่ใช่ MIME type จาก browser SVG ที่ปลอมแปลงด้วย extension ภาพถูกปฏิเสธ
- Map tile API token ไม่เคยถูกส่งไปยัง browser คำขอ tile ทั้งหมดถูก proxy ฝั่ง server

### Network และ Protocol Security

- **CORS** ล็อค whitelist ของ domain ที่อนุมัติ
- **MQTT access control** — EMQX broker ต้องการ credential ต่อกล้อง anonymous connection ปิดใช้งาน
- **PostgreSQL transport** — TLS 1.3 เปิดใช้งานบน database server
- **CSRF** — SameSite cookie policy และ token-based validation ป้องกัน cross-site request forgery
- **SQL injection** — query database ทั้งหมดใช้ parameterized statement ตลอดทั้ง codebase
- **XSS** — event และ camera data ทั้งหมดที่ render เป็น HTML ถูก HTML-escape Content Security Policy header พร้อม nonce
- **Path traversal** — strict path validation ป้องกัน directory traversal บน file-serving endpoint

### License Integrity

ระบบ license ใช้ Ed25519 asymmetric cryptography license key ปลอมแปลงไม่ได้หากไม่มี private signing key License ผูกกับเครื่อง deploy และระบุ camera-count ceiling ที่บังคับที่ runtime

### PDPA Compliance

Vigil Platform ออกแบบให้สอดคล้องกับ พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA) ของไทย:

- **Data residency** — ข้อมูลส่วนบุคคลทั้งหมดเก็บบน server ของลูกค้าเอง ไม่มีการโอนข้อมูลข้ามพรมแดนหากไม่ตั้งค่าโดยลูกค้าอย่างชัดเจน
- **Automated data purge** — background job 3 ตัวรันทุกคืนเพื่อลบ event, snapshot, และ video clip ที่เกิน retention period ที่กำหนด
- **Consent สำหรับ LINE notification** — LINE user ต้อง follow official account ของระบบและได้รับการอนุมัติจาก admin ก่อนรับ notification ใด ๆ
- **On-demand deletion ข้อมูล biometric** — face image ลบได้ทีละรายการหรือเป็น bulk ผ่าน admin interface
- **Audit trail** — user action ทั้งหมดที่ create, modify, หรือ delete ข้อมูลถูกบันทึก structured audit log พร้อม user ID, action type, resource reference, และ timestamp admin สามารถตรวจสอบและ revoke active session แต่ละ session ได้

### OWASP Top 10

| หมวดหมู่ | สถานะ |
|---|---|
| A01 Broken Access Control | แก้ไขแล้ว — RBAC middleware บน endpoint ทั้งหมด |
| A02 Cryptographic Failures | แก้ไขแล้ว — Ed25519 license; TLS ทุกการเชื่อมต่อ |
| A03 Injection | แก้ไขแล้ว — parameterized query ตลอดทั้งระบบ |
| A04 Insecure Design | จัดการแล้ว — PDPA by design; data isolation |
| A05 Security Misconfiguration | จัดการแล้ว — strict CORS; MQTT ACL |
| A06 Vulnerable Dependencies | ติดตาม — patch ภายใน 7 วันหลัง CVE release |
| A07 Authentication Failures | แก้ไขแล้ว — idle timeout 15 นาที; brute-force lockout |
| A08 Data Integrity Failures | แก้ไขแล้ว — magic bytes file validation; Ed25519 license |
| A09 Logging Failures | ปรับปรุงแล้ว — structured audit log บน write action ทั้งหมด |
| A10 SSRF/XXE | ปลอดภัย — ไม่มี URL ที่ user ควบคุมได้; JSON-only API |

---

## Integration LINE

LINE ถูก integrate ใน Vigil Platform แบบ native ส่ง alert พร้อม snapshot ตรงไปยัง LINE user แต่ละคน, กลุ่มแชท, หรือ room

**เนื้อหา alert message:**
- Snapshot จากกล้อง ณ เวลาที่เกิด event
- ชื่อกล้องและ group/zone
- ประเภท event และ timestamp
- ชื่อ alert rule ที่ trigger

**Quiet hours** — alert rule แต่ละ rule ตั้งค่าช่วงเงียบได้ ระบบ suppress LINE message ในช่วงนั้นแต่บันทึก event ใน dashboard ต่อไป

**Cooldown 60 วินาที** — trigger ซ้ำจาก rule เดิมภายใน 60 วินาทีจะถูกรวมเพื่อป้องกัน notification ท่วม

**Self-service onboarding** — admin แชร์ QR code พนักงาน scan, follow official account, และ request access admin อนุมัติใน dashboard ยกเลิกสิทธิ์ได้โดยลบผู้ใช้จาก recipient list

**Camera offline alert** — ส่ง LINE notification เมื่อกล้องออฟไลน์; ส่ง recovery notification เมื่อกลับมา online

**Scheduled report** — Health Report และ Analytics Report ส่งอัตโนมัติไปยังกลุ่ม LINE ตามกำหนดรายวัน รายสัปดาห์ หรือรายเดือน

---

## Roadmap

ฟีเจอร์ต่อไปนี้วางแผนสำหรับ phase ถัดไป:

- **ONVIF generic event ingestion** — ประมวลผล event เต็มรูปแบบสำหรับกล้องที่ยังไม่มี vendor-specific ingester
- **Event workflow** — acknowledge, dismiss, และ escalate event จาก dashboard
- **Face Recognition AI** — person re-identification แบบ vector-based โดยใช้ face embedding
- **Anomaly detection** — ตรวจจับความหนาแน่นผิดปกติหรือการนิ่งเงียบยาวนานใน zone
- **Email alert** — ส่ง alert ทาง SMTP เป็นทางเลือกนอกเหนือจาก LINE
- **Webhook integration** — ส่ง outbound webhook ไปยังระบบภายนอก
