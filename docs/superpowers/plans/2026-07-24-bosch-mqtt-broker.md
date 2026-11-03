# Bosch Event Broker (MQTT Profile) auto-configure — Phase 0 findings

> สถานะ: **ทั้ง read/write/save shipped + verified end-to-end 2026-07-24.**
> Root cause ของที่ CreateEventBroker fail คือ **เรียกผิดชื่อ operation**
> (ONVIF WSDL ไม่มี `CreateEventBroker` มีแต่ `AddEventBroker`) — ยืนยันด้วยการ
> ยิงจริง `AddEventBroker` → `GetEventBrokers` (verify) → `DeleteEventBroker`
> (cleanup) กับกล้อง 192.168.10.113 ครบทุกขั้น. `configureAlarmServer()`-equivalent
> ฝั่ง Bosch implement แล้ว (ขั้นต่อไป #1–#2 เดิม ปิดครบ), ปุ่ม "บันทึกค่าเข้าหัวกล้อง"
> เปิดใช้งานจริงแล้ว. ระหว่างทางเจอ **Cloudflare บล็อก URL path ที่มีคำว่า "mqtt"**
> (ไม่เกี่ยวกับโค้ดเราเลย — ยืนยันด้วยการยิง path มั่วๆ ที่มี "mqtt" ก็โดนบล็อกเหมือนกัน)
> แก้โดย rename path เป็น `event-broker-status`/`event-broker-configure` — ดู
> `docs/superpowers/plans/*` commit history หรือ git log สำหรับรายละเอียด.
> เหลือแค่ #3 เดิม (multi-broker/replace policy) ที่ยัง parked รอเจ้าของตัดสินใจ.

## เป้าหมายเดิม

ตอน added กล้อง Bosch (face/VCA) ให้ระบบ push ค่า MQTT Profile Settings
(Event Broker) เข้ากล้องอัตโนมัติ แทนที่ต้องเปิด Bosch Configuration Manager
ตั้งเองทุกครั้ง — คู่แฝดของ `configureAlarmServer()` ฝั่ง Hikvision
(`src/ingesters/hikvision-isapi.js`).

## Fact ที่พิสูจน์แล้ว (ทดสอบจริงกับกล้อง Bosch ที่ site `vss`, ผ่าน `vss2-edge`)

- MQTT Event Broker เป็นส่วนหนึ่งของ **ONVIF Events service มาตรฐาน**
  (`http://www.onvif.org/ver10/events/wsdl`, v1.4+) — capability
  `EventBrokerProtocols="mqtt mqtts"` ประกาศไว้ตรงๆ ใน `GetServices`
- **`GetEventBrokers`** (อ่าน) — ใช้งานได้จริง 100% ผ่าน WS-Security
  UsernameToken (digest) เหมือนที่ `edge-config-agent.js`'s
  `buildOnvifSecurityHeader()` ใช้อยู่แล้ว (ย้ายไป
  `src/helpers/onvifSecurity.js` ให้ทั้งสองไฟล์ reuse ร่วมกัน)
- **`DeleteEventBroker`** (ลบ, key ด้วย `<tev:Address>`) — ใช้งานได้จริงเช่นกัน
- **`CreateEventBroker`** (ชื่อที่ Phase 0 รอบแรกลอง) — **ล้มเหลวสม่ำเสมอ**
  ทุกครั้งที่ลอง (HTTP 500, body ว่างเปล่า 2366 ตัวอักษรเป๊ะ ไม่มี SOAP Fault
  message เลย) ลองมาแล้ว: element wrapper ต่างกัน (`EventBroker` /
  `Configuration` / ไม่ห่อ), field เสริม (UserName/Password/CertificateID ว่าง),
  TopicPrefix สั้น/ยาว, HTTP (port 80) vs HTTPS (port 443,
  `rejectUnauthorized:false`) — **ผลเหมือนกันทุกครั้ง**
- **✅ RESOLVED 2026-07-24 — root cause คือชื่อ operation ผิด.** ONVIF Events
  WSDL (`https://www.onvif.org/onvif/ver10/events/wsdl/event.wsdl`, ยืนยันสด
  ผ่าน WebFetch) มี operation แค่ 3 ตัว: `GetEventBrokers` / **`AddEventBroker`**
  / `DeleteEventBroker` — **ไม่มี `CreateEventBroker` อยู่จริงเลย**. request
  element ที่ถูกคือ `<tev:AddEventBroker><tev:EventBroker>...</tev:EventBroker>
  </tev:AddEventBroker>` (wrapper `EventBroker` ที่ Phase 0 เคยลองถูกแล้ว
  แค่ operation name ผิด) อธิบาย HTTP 500 คงที่ทุก variant ได้สมบูรณ์ (ยิง SOAP
  action ที่กล้องไม่รู้จักเลย ไม่ใช่ payload ผิด schema)
- **ทดสอบจริงกับกล้อง 192.168.10.113 ครบ 4 ขั้น — HTTP 200 ทุกจุด:**
  1. `AddEventBroker` (Address `mqtt://192.168.10.139:18830`, TopicPrefix
     `VIGIL_TEST_PROBE`, ไม่ชนกับ `TEST_CFGMG3` เดิม) → **200, สำเร็จ**
  2. `GetEventBrokers` verify → เห็น broker ใหม่จริง (`Status: Connecting` —
     กล้องพยายามต่อ MQTT จริง ไม่ใช่แค่ stub รับแล้วทิ้ง) และของเดิม
     `TEST_CFGMG3` ยังอยู่ไม่กระทบ
  3. `DeleteEventBroker` (key ด้วย Address) → **200, สำเร็จ**
  4. `GetEventBrokers` confirm cleanup → เหลือแค่ `TEST_CFGMG3` เดิม, ของทดสอบ
     หายไปครบ
- ข้อสังเกตเรื่อง RCP+ port 1756 / TLS capture ที่ยังถอดรหัสไม่ได้ (ด้านบน)
  **ไม่ใช่ root cause แล้ว** — เก็บไว้เป็นข้อมูลประกอบเท่านั้น ไม่ต้องตามต่อ

## สรุป

**Write path ปลดล็อกแล้ว 100%** — `AddEventBroker`/`GetEventBrokers`/
`DeleteEventBroker` ใช้งานได้จริงครบวงจรผ่าน ONVIF SOAP มาตรฐาน (WS-Security
UsernameToken digest เดิมที่มีอยู่แล้วใน `src/helpers/onvifSecurity.js`)
ไม่ต้องมี Bosch partner agreement หรือ RCP+ reference ใดๆ เลย. ที่เหลือคือ
งาน implementation ปกติ: เขียน `configureAlarmServer()`-equivalent ฝั่ง Bosch
+ เปิดปุ่ม "บันทึกค่าเข้าหัวกล้อง" ใน UI ที่ disable ไว้

## ขั้นต่อไป

1. ✅ **DONE** — Write function (`POST /mqtt-broker-configure` เดิม, rename เป็น
   `/event-broker-configure`) เช็ค `GetEventBrokers` ก่อนว่ามี broker เราอยู่แล้ว
   หรือยัง (match ทั้ง Address + TopicPrefix — ไม่ใช่แค่ Address เฉยๆ, เจอ edge
   case จริงว่า address ตรงแต่ prefix ผิดจะโดนมองว่า "configured แล้ว" ทั้งที่
   event จะไม่มีวันไหลเข้าถูก) แล้วค่อย `AddEventBroker` ด้วย Address = edge's
   own MQTT broker IP (`FACE_PUSH_HOST_EDGE`), TopicPrefix = camera_id (ตรงกับที่
   `mqtt-subscriber.js` ใช้ parse topic อยู่แล้ว)
2. ✅ **DONE** — เปิดปุ่ม "บันทึกค่าเข้าหัวกล้อง" ใน `dashboard/page-camera-settings.js`
   แล้ว เรียก endpoint จริง ทดสอบผ่าน browser จริง (`dashboard.dojojin.tech`) แล้ว
3. **ยังไม่ทำ, parked รอ owner ตัดสินใจ** — multi-broker policy: ถ้ากล้องมี broker
   อื่นอยู่ก่อน (เช่นจาก Configuration Manager, address ไม่ตรงกับของเรา) จะ add
   เพิ่มหรือ replace — ต้องถามเจ้าของก่อนออกแบบ behavior นี้ (มีผลกับ operator
   ที่อาจตั้งไว้แล้วจากที่อื่น)
4. **[ใหม่ 2026-07-24] Fallback ทาง RCP+ ถ้าเจอกล้องรุ่นเก่าที่ ONVIF Profile M
   ใช้ไม่ได้เต็มรูปแบบ** — ดู section "เอกสารทางการ" ด้านล่าง: มี RCP+ tag
   `CONF_MQTT_SETTINGS` (`0x0d0a`) ที่ทำแบบเดียวกันได้ผ่าน RCP+ ตรงๆ รองรับ
   CPP6/CPP7/CPP7.3 ด้วย (กว้างกว่า ONVIF ที่ต้อง FW ≥7.81) — ยังไม่ต้องใช้ตอนนี้
   เพราะ ONVIF path ที่ shipped ใช้งานได้จริงอยู่แล้ว เก็บไว้เป็นทางเลือกสำรอง

## เอกสารทางการ (official rcpdoc — ได้มาแล้ว 2026-07-24)

`docs/vendor/bosch/RCP_doc_9_41_0019.pdf` — **"Bosch RCP Plus Reference, RCP Version 3
Specification"** ของจริงจาก Bosch Security Systems (1,380 หน้า, ไม่ใช่ community
source แบบเดิมที่เคยใช้). จุดที่เกี่ยวกับงานนี้โดยตรง:

- **`CONF_MQTT_SETTINGS`** (tag `0x0d0a`, section 2.444, หน้า 752) — RCP+ command
  อ่าน/เขียนค่า MQTT broker ได้ตรงๆ, access level `service`, รองรับ
  **CPP6/CPP7/CPP7.3/CPP13/CPP14** ครบ. sub-tag: `MQTT_BROKER_ADDRESS`,
  `MQTT_BROKER_USERNAME`, `MQTT_BROKER_PASSWORD` (write-only),
  `MQTT_BROKER_PREFIX`, `MQTT_BROKER_TOPIC_FILTER` (ระบุตรงๆว่า encoding แบบ
  ONVIF), `MQTT_BROKER_QOS` — เป็น single-broker slot (ไม่ใช่ list 4 ตัวแบบ ONVIF)
- ปิดคำถามที่ค้างจาก Phase 0 ("Configuration Manager อาจใช้ RCP+ ไม่ใช่ ONVIF
  SOAP") — ยืนยันแล้วว่ามี RCP+ tag สำหรับ MQTT จริง ตรงกับเบาะแส Wireshark
  (TLS ไป port 443 ตอนกด Save ใน Config Manager) แต่**ไม่กระทบของที่ shipped
  ไปแล้ว** — ONVIF `AddEventBroker` verify แล้วว่าทำงานจริง ไม่ต้องเปลี่ยน
- `CONF_BICOM_COMMAND` (`0x09A5`, section 2.80, หน้า 168) — ยืนยัน structure
  BiCom ตรงกับ community doc เดิม (ละเอียดกว่า: Flags byte + Lease Time Info +
  Bicom Server ID + Object ID + Operation + Payload)

## ไฟล์ที่เกี่ยวข้อง

- `src/helpers/onvifSecurity.js` — WS-Security header helper (shared)
- `src/lpr-receiver.js` — `POST /event-broker-status`, `POST /event-broker-configure` (edge-side)
- `src/routes/cameras.js` — `POST /api/cameras/:id/event-broker-status` (proxy สำหรับ
  ปุ่ม Test เท่านั้น); `POST /api/cameras/:id/event-broker-configure` **ถูกถอดออกแล้ว** —
  การเขียนจริงย้ายไปเป็น trigger-on-save อัตโนมัติข้างใน `POST /api/cameras` แทน
  (`resolveSiteCode()` helper ยังใช้อยู่ทั้งคู่)
- `dashboard/page-camera-settings.js` — `checkMqttBroker()` เท่านั้น (ปุ่ม Save/
  `saveMqttBroker()` ถูกเอาออกแล้วตาม redesign ด้านล่าง)
- `dashboard/index.html` — `#frmMqttBrokerSection` (Bosch-only, ใน ingest block, ปุ่มเดียว)
- `docs/vendor/bosch/RCP_doc_9_41_0019.pdf` — official rcpdoc (ดูด้านบน)

## [Redesign 2026-07-24] เหลือปุ่มเดียว — auto-configure-on-save

ตามคำขอเจ้าของ: เอาปุ่ม "บันทึกค่าเข้าหัวกล้อง" ออก เหลือแค่ปุ่ม
**"Test Event Connection"** (เช็คอย่างเดียว, ไม่เขียนอะไรเข้ากล้อง) — การเขียนจริง
(`AddEventBroker`) ย้ายไปทำอัตโนมัติทุกครั้งที่กด "บันทึกการตั้งค่ากล้อง" หลัก
(fire-and-forget, ไม่ block การ save; idempotent ฝั่ง edge อยู่แล้วจาก match
Address+TopicPrefix — กด save ซ้ำไม่พังอะไร) — เหมือน pattern
`configureAlarmServer()` ของ Hikvision ที่รันอัตโนมัติทุก sync เช่นกัน. Commit
`683f912`. ทดสอบ full cycle (save→auto-configure→delete→cleanup) ผ่านจริงแล้ว.

## [ใหม่ 2026-07-24] แผนต่อยอด — feature candidates จาก rcpdoc (ปรึกษา Advisor แล้ว, ยังไม่ implement)

เจ้าของถามว่าจากเอกสาร rcpdoc ทางการมีอะไรต่อยอดได้อีกที่เหมาะกับงานเรา —
รอคุยต่อ ยังไม่ตัดสินใจทำตัวไหน:

- **`CONF_JPEG`** (tag `0x099e`, section 2.365, หน้า 657-658, API: encoder) —
  อ่าน JPEG สดจากกล้องแบบ on-demand (เลือก resolution QCIF/CIF/4CIF + quality
  0-100 ได้), access level `live`, รองรับครบทุก tier **CPP6/7/7.3/13/14**.
  🟡 **กรอบที่ถูกต้อง (Advisor แก้ให้แล้ว): เป็น enhancement ไม่ใช่ bug-fix** — ระบบ
  tile-preview เดิม (`mqtt-subscriber.js:793`, periodic push) ทำงานถูกต้องอยู่แล้ว
  (ยืนยันจากเคส "ภาพมาละ" วันเดียวกัน) — `CONF_JPEG` แค่เพิ่มความสามารถดึงภาพสด
  ตามสั่ง (แทนรอ tile รอบถัดไป) ไม่ได้ปะรูอะไร. Priority สูงกว่าอันล่าง เพราะของเดิม
  ทำงานอยู่แล้ว ความเสี่ยงต่ำ. **ยังไม่ verify สดกับกล้องจริง** — เป็น doc claim
- **`CONF_PRIVACY_MODE`** (tag `0x0c33`, section 2.513, หน้า 847-848, API:
  system.settings) — read (`minimal`)/write (`user`) privacy mode + timeout.
  **รองรับแค่ CPP6/CPP7/CPP7.3 — ไม่มี CPP13/CPP14** → deprioritize เพราะ fleet
  ปัจจุบันน่าจะมี CPP13/14 ปนอยู่มาก (ยังไม่เช็ค firmware tier จริงของ fleet)
- **`CONF_SD_CARD_STATUS`/`CONF_STORAGE_REPORT`** (ยังไม่ได้เปิดอ่าน section
  จริง — ค้างจากรอบ grep TOC ที่โดนตัดตอน) — น่าสนเพราะเชื่อมกับ
  [Multi-vendor recording status](../../../memory ดู project_multivendor_recording_status)
  ที่ Bosch ยังไม่มี native storage-health check (มีแต่ ONVIF ที่**เคย deferred
  เพราะตอบไม่สม่ำเสมอ**) — ⚠️ ต้อง spike ทดสอบสดก่อนเชื่อ เพราะมีประวัติปัญหานี้มาก่อน
  (ไม่ใช่แค่ "เอกสารบอกว่ามี" = ใช้ได้จริง — บทเรียนจาก `CreateEventBroker` +
  Cloudflare mqtt-block รอบนี้)
- `CONF_MQTT_SETTINGS` (RCP+ fallback, ดู section ด้านบน) — ปิดคำถามแล้ว ใช้เป็น
  fallback สำรองเท่านั้น ไม่ต้องทำเพิ่ม (ONVIF path ที่ shipped ใช้งานได้จริงอยู่)

**ขั้นถัดไปเมื่อคุยต่อ:** เจ้าของเลือกว่าจะ spike ตัวไหนก่อน (แนะนำ `CONF_JPEG`
ก่อนเพราะเสี่ยงต่ำสุด) แล้วค่อยเข้า Working Agreement ปกติ (reproduce/verify สด
ก่อนถือเป็น Fact ตาม WA #3) — ยังไม่มีโค้ดใดๆ เขียนสำหรับส่วนนี้
