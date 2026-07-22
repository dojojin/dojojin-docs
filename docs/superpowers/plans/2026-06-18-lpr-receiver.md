# LPR Receiver — Hikvision ITS/ANPR HTTP Push

> วันที่วางแผน: 2026-06-18  
> กล้อง: `iDS-2CD9396-HIS` (ITCCAM) @ `10.11.100.4` — camera_id `HIK-V_LPR01`  
> อ้างอิง: probe live camera + โค้ด FAS + DB schema

---

## สิ่งที่รู้แน่ (🔵 Fact)

| จุด | ค่า |
|---|---|
| Push mechanism | กล้อง POST มาหาเรา (HTTP host) — **ไม่ใช่** alertStream pull |
| Push format | `parameterFormatType: XML`, `detectionUpLoadPicturesType: all` (plate crop + full scene) |
| HTTP host slot | Slot 1 = 202.124.201.106:10001 (อื่น); **Slot 2 = ว่าง** (0.0.0.0) |
| Snapshot dir | `vigil-platform/snapshots/` — ใช้ร่วมกับ face/event ingesters |
| DB ที่มีอยู่ | `license_plates` (event_id, camera_id, plate_number, confidence, country, region, vehicle_type, vehicle_color, vehicle_brand) |
| ไม่มีใน DB | column เก็บ filename ของภาพป้าย (plate crop) |
| Pattern เดิม | FAS (`startFaceAlarmServer`) — รับ multipart POST → parse → ingest |
| Payload XML field names | **ยังไม่ทราบแน่ชัด** — ต้อง probe กับกล้องจริงก่อน (ดู Phase L1) |

---

## ลำดับ Phase

```
L1 (probe)  ──►  L2 (migration)  ──►  L3 (parser + ingest)  ──►  L4 (server)
                                                              ──►  L5 (camera config)
                                                              ──►  L6 (dedup)
```

---

## Phase L1: Payload Probe ⚡ (ทำก่อนสุด — ต้องรู้ XML structure)

**เป้าหมาย:** เห็น raw POST body จริงจากกล้องก่อนเขียน parser

### วิธี probe (ทำใน Terminal)

```bash
# 1. รัน one-shot HTTP listener บน port 3011 ฟัง raw POST
node -e "
require('http').createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    console.log('=== HEADERS ===');
    console.log(JSON.stringify(req.headers, null, 2));
    console.log('=== BODY (utf8, 3000 chars) ===');
    console.log(body.toString('utf8').slice(0, 3000));
    res.writeHead(200); res.end('OK');
  });
}).listen(3011, '0.0.0.0', () => console.log('listening :3011'));
"
```

```bash
# 2. ชี้กล้อง slot 2 มาที่เซิร์ฟเวอร์ (แทน IP จริงของ server บน subnet 10.11.100.x)
curl -s -X PUT --digest -u admin:Pktcctv.1 \
  http://10.11.100.4/ISAPI/Event/notification/httpHosts/2 \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0"?>
<HttpHostNotification>
  <id>2</id>
  <url>/lpr</url>
  <protocolType>HTTP</protocolType>
  <parameterFormatType>XML</parameterFormatType>
  <addressingFormatType>ipaddress</addressingFormatType>
  <ipAddress>SERVER_IP</ipAddress>
  <portNo>3011</portNo>
  <httpAuthenticationMethod>none</httpAuthenticationMethod>
  <ANPR><detectionUpLoadPicturesType>all</detectionUpLoadPicturesType></ANPR>
  <SubscribeEvent><heartbeat>25</heartbeat><eventMode>all</eventMode></SubscribeEvent>
  <enabled>true</enabled>
</HttpHostNotification>'
```

**แทน `SERVER_IP`** ด้วย IP ของเซิร์ฟเวอร์บน subnet ที่กล้องมองเห็น (ตรวจด้วย `ip a` หรือ `ifconfig`)

**ผลที่ต้องการ:** ได้ XML body + boundary + Content-Disposition names ของ image parts

---

## Phase L2: Migration

**ไฟล์ใหม่:** `db/db_migration_037_license_plates_image.sql`

```sql
-- Migration 037 — license_plates: add plate_image for crop filename
ALTER TABLE license_plates
  ADD COLUMN IF NOT EXISTS plate_image VARCHAR(200);
-- scene image ใช้ events.snapshot_filename (ไม่เพิ่ม column ใหม่)
```

---

## Phase L3: Parser + Ingest Function

**ไฟล์:** `src/ingesters/hikvision-isapi.js`

### L3a: `parseLprMultipart(body, boundary)`

รู้จาก probe ว่า Content-Disposition names คืออะไร (**ต้องรอ L1**) แต่ expected structure:

```
multipart/form-data; boundary=...
  Part 1: application/xml  → ANPR event XML
  Part 2: image/jpeg       → plate crop  (name TBD จาก probe)
  Part 3: image/jpeg       → full scene  (name TBD จาก probe)
```

Return shape:
```js
{
  plateNumber,   // string ป้ายทะเบียน
  confidence,    // number 0-100
  country,       // 'TH'
  province,      // จังหวัด
  vehicleType,   // 'smallVehicle' etc.
  vehicleColor,  // 'Black' etc.
  direction,     // 'approach'/'away'
  lane,          // number
  bbox,          // { x, y, width, height } — bbox ของป้ายใน full scene
  eventTime,     // ISO string
  channelId,     // number
  rawXml,        // string — เก็บ raw XML ใน raw_json
  plateBuf,      // Buffer|null — plate crop image
  sceneBuf,      // Buffer|null — full scene image
}
```

### L3b: `ingestLprEvent(cam, parsed)`

```
1. สร้าง filenames: plate_<cameraId>_<ts>.jpg + scene_<cameraId>_<ts>.jpg
2. fs.writeFileSync plate crop → SNAPSHOT_DIR
3. fs.writeFileSync full scene → SNAPSHOT_DIR
4. INSERT events (event_type='anprAlarm', camera_id, detected_at, has_snapshot=true,
                  snapshot_filename=sceneFile, raw_json={...})
5. INSERT license_plates (event_id, camera_id, plate_number, confidence,
                          country, region, vehicle_type, vehicle_color, plate_image)
6. pg_notify('new_event', event_id)  ← หลัง write ทุกอย่างเสร็จ (GOTCHAS #58)
```

---

## Phase L4: LPR Alarm Server

**ไฟล์:** `src/ingesters/hikvision-isapi.js`

```js
const LPR_PUSH_PORT  = parseInt(process.env.LPR_PUSH_PORT || '3011', 10);
// bind + allow ใช้ตัวเดียวกับ FAS (FACE_PUSH_BIND + set ของ IP ที่ allow)
// เพิ่ม 10.11.100.4 เข้า LPR_PUSH_ALLOW env

let _lprAlarmServer = null;

function startLprAlarmServer() {
  // guards เดียวกับ startFaceAlarmServer (P1):
  // - POST-only (405)
  // - multipart/* (415)
  // - body size cap 10MB (413)
  // - timeout 10s (408)
  // - unknown cam IP → 403
  // ต่างกัน: ไม่มี allowlist IP (LPR กล้องอาจ push จาก subnet ต่าง)
  //   → ใช้ camera_id lookup จาก IP แทน IP allowlist
  // ...
}
```

เพิ่ม `_lprAlarmServer?.close()` ใน `shutdown()`  
เพิ่ม `_lprAlarmServer = startLprAlarmServer()` ใน `main()`

---

## Phase L5: ชี้กล้องมาที่ server (ทำหลัง L4)

```bash
# ใส่ SERVER_IP จริง + เปิด slot 2 enabled
curl -X PUT --digest -u admin:Pktcctv.1 \
  http://10.11.100.4/ISAPI/Event/notification/httpHosts/2 \
  -H "Content-Type: application/xml" \
  -d '<HttpHostNotification>
    <id>2</id>
    <url>/lpr</url>
    <protocolType>HTTP</protocolType>
    <parameterFormatType>XML</parameterFormatType>
    <addressingFormatType>ipaddress</addressingFormatType>
    <ipAddress>SERVER_LAN_IP</ipAddress>
    <portNo>3011</portNo>
    <httpAuthenticationMethod>none</httpAuthenticationMethod>
    <ANPR><detectionUpLoadPicturesType>all</detectionUpLoadPicturesType></ANPR>
    <SubscribeEvent><heartbeat>25</heartbeat><eventMode>all</eventMode></SubscribeEvent>
    <enabled>true</enabled>
  </HttpHostNotification>'
```

### 🔵 ของจริงบนกล้อง — ยืนยัน 2026-06-20

**กล้อง LPR:** `iDS-2CD9396-HIS` (ITCCAM) @ `10.11.100.4` · camera_id `HIK-V_LPR01`

**ตำแหน่งตั้งค่าใน Web UI กล้อง (HTTP push host = ปลายทาง `/lpr`):**
> `Configuration → Network → Data Connection → **ISAPI Listening** tab`
> (ไม่ใช่ Event → Alarm Linkage; Linked Capture ที่นั่นคือคนละฟีเจอร์ = ลิงก์กล้องตัวอื่น)

ค่าจริงบนหน้านั้น (ตรงกับ ISAPI `httpHosts/1` ที่อ่านด้วย curl):

| field | ค่า |
|---|---|
| Enable ISAPI Listening | ✔ |
| Version | HTTPS |
| Host IP/Domain | `dashboard.dojojin.tech` |
| Host Port | `443` |
| Host URL | `/lpr` |
| Heartbeat | 25 |
| Uploaded Picture Type | All |
| Authentication Mode | None |

**แก้ที่เดียวกันผ่าน CLI ได้:** `GET/PUT /ISAPI/Event/notification/httpHosts/1` (digest auth). ⚠️ slot จริง = **`1`** ไม่ใช่ `2` (ตัวอย่าง curl ข้างบนเขียน `/2` ไว้ — คลาดเคลื่อน). `httpHosts/capabilities` คืน `<hostNumber>1</hostNumber>` = **กล้องมี push slot เดียว** → CIB (`202.124.201.106`) ถูกเขียนทับ จึงพึ่ง `forwardToPhuket` (ดู memory `project_lpr_cimb_forward`).

> 🟡 **ยังต้องเช็ค:** บนหน้านี้ tab `Arm Upload✔` + `Integration Protocol✔` ก็ติ๊กอยู่ → อาจมีช่อง upload อื่นทำงานคู่กัน. ถ้า CIB จริง ๆ รับผ่าน Integration Protocol/Arm Upload เองได้ แปลว่า CIB อาจ **ไม่** พึ่ง forward ของเรา — ต้องยืนยันก่อนสรุปขั้นสุดท้าย.

**On-camera analytics ที่เปิด (Capture → Capture Parameters → Vehicle Feature):** Vehicle Color ✔ (ดึงแล้ว `<color>`), Vehicle Manufacturer ✔ (ดึงแล้ว `<vehicleLogoRecog>`), Manned Non-Motor ✔ (ยังไม่ดึง). Seatbelt/Phone/Helmet = เพิ่งเปิด รอ probe payload จริงดู tag name.

### 🔵 ปลายทาง forward (CIB) — `forwardToPhuket` ใน `src/routes/lpr.js`

กล้อง push slot เดียว = เรา → เรา relay ต่อให้ CIB (หน่วยงานรัฐ) เป็นเส้น push **เดียว** ของเขา. ค่าทั้งหมด **hardcoded** ในโค้ด:

| field | ค่า |
|---|---|
| protocol | HTTP plain (ไม่ใช่ HTTPS) |
| host : port | `202.124.201.106` : `10001` |
| path | `/receive_hik_phuket` |
| method | POST |
| headers | `Content-Type` (ส่งผ่านจากกล้อง) + `Content-Length` |
| body | raw camera push verbatim (XML + รูป) |
| timeout | 10s · fire-and-forget · ไม่ retry · ไม่มี auth/token |

ยืนยันไม่มี tab อื่นบนกล้อง push ไป CIB: `Arm Upload` = format อย่างเดียวไม่มี IP, `Integration Protocol` = ONVIF (pull). → **ห้ามลบ forward** = ตัดฟีดรัฐ. pause กล้อง → ยัง forward เสมอ (ดู memory `project_lpr_cimb_forward`).

---

## Phase L6: Dedup

กล้อง ANPR อาจ POST ซ้ำสำหรับป้ายเดียวกัน (active repost pattern เหมือน alertStream)

```js
// key: `${camera_id}|${plateNumber}|${Math.floor(ts/3000)}` (3-วินาที window)
const _lprDedup = new Map(); // key → true, expire after 3s
```

---

## ข้อควรระวัง

| จุด | เหตุผล |
|---|---|
| **PDPA** | `plate_number` = ข้อมูลส่วนบุคคลตาม PDPA — บันทึก log access ทุกครั้ง (schema เตือนไว้แล้ว) |
| **pg_notify หลัง write** | ต้องทำทั้ง event + plate + snapshot ก่อน notify (GOTCHAS #58) |
| **subnet routing** | กล้องอยู่ subnet 10.11.100.x — server ต้องมี route ไป/กลับ subnet นั้น (ตรวจ `ip a` + `ping 10.11.100.4` จากเซิร์ฟเวอร์) |
| **PORT ต้อง allow** | firewall/Cloudflare ต้อง allow 3011 inbound จาก 10.11.100.x |
| **image naming** | ใช้ `lpr_plate_<camId>_<ts>.jpg` + `lpr_scene_<camId>_<ts>.jpg` ไม่ชนกับ event/face |

---

## เกณฑ์เสร็จ

- [ ] L1: raw POST body จากกล้องปรากฏใน probe listener — รู้ XML structure + image part names
- [ ] L2: migration 037 apply สำเร็จ (plate_image column มีอยู่)
- [ ] L3: `parseLprMultipart` + `ingestLprEvent` เขียนครบ
- [ ] L4: `startLprAlarmServer` ทำงาน + pm2 log แสดง `LPR alarm server on ...`
- [ ] L5: กล้องชี้มาที่เซิร์ฟเวอร์แล้ว — pm2 log แสดงป้ายทะเบียนจริง
- [ ] L6: dedup ทำงาน — ป้ายเดียวไม่เกิน 1 row ใน 3 วินาที
- [ ] DB: `SELECT plate_number, plate_image FROM license_plates ORDER BY id DESC LIMIT 5` มีข้อมูล

---

## Phase F (UI) — Demo → Production Port + No-Read handling (วางแผน 2026-06-19)

> ต่อยอดจาก demo ที่อนุมัติแล้ว (`/others/demo/`, commit `cc71cb3`). พอร์ตเป็น
> production `page-lpr.js` ใหม่ + migration 051 (watchlist groups/image/alert-mode).

### No-read (รถอ่านป้ายไม่ออก) — ตัดสินแล้ว
- **Fact:** กล้อง probe รถที่ OCR ป้ายไม่สำเร็จเข้ามาแล้วจริง ผ่าน ingester ปกติ
  → `anprAlarm` ที่ `raw_json->>'plate' = 'unknown'` = **46 แถว (6.9% ของ anprAlarm)**
  · รถพวกนี้ยังมี vehicleType/vehicleColor/brand ครบ (ไม่ใช่ขยะ)
- **Decision (#208):** แสดง `plate = 'unknown'` เป็น **"อ่านไม่ออก"** ใน UI ภาษาไทย
  (ไม่ใช่ "ไม่ทราบ" / ไม่ใช่ "ไม่มีป้าย") — ตรงกับ ANPR no-read concept + เป็น KPI
  วัดสุขภาพกล้องได้ (no-read rate สูง = มุม/แสง/โฟกัสมีปัญหา). ดู DECISIONS #208
- **งานใน Phase F:**
  1. helper format plate เดียว ใน `lpr-plaque.js`: `plate==='unknown'/ว่าง → I18N('lpr.noRead')`
     ใช้ทุกที่ (plaque, การ์ด, modal, ชื่อใน feed)
  2. i18n `lpr.noRead` = TH "อ่านไม่ออก" / EN "No read"
  3. KPI/filter **"รถไม่ติดป้ายทะเบียน"** (จาก demo) → ผูกกับ `plate='unknown'` จริง
     (ลบ caveat "ต้องแก้ ingestion" — มีข้อมูลแล้ว)

---

## Phase F1 (UI port) — ✅ DONE (รอ commit confirm) · 2026-06-19

พอร์ต demo → production สำเร็จ + verify จริง (DB/SQL/syntax). ไฟล์: migration 051
(watchlist groups/image/alert-mode), lpr-query/lpr-watchlist routes, page-lpr.js rewrite
(3 แท็บ ภาพรวม/ค้นหา/เฝ้าระวัง), lpr-plaque no-read helper, i18n, css, index.html.
**Bug แก้ระหว่างทาง:** (1) CSP `script-src 'self'` บล็อก inline handler ทั้งหมด → แปลงเป็น
delegated `data-action`/`data-change`/`data-input`/`data-err` dispatcher; (2) TZ boundary —
app บังคับ `SET TIME ZONE 'UTC'` (api-server.js:74) → period KPI ต้องใช้
`::date::timestamp AT TIME ZONE 'Asia/Bangkok'`; (3) AirDatepicker (picker migration) +
`position:'bottom right'` กัน popup ตกขอบ; (4) no-read/unknown labels (#208).

---

## Phase F-R (Re-architecture) — แยกหน้าแสดงผล vs ตั้งค่า (วางแผน 2026-06-19)

> เจ้าของสั่ง: แท็บ "เฝ้าระวัง" ในหน้า LPR = **แสดงผลอย่างเดียว**; ส่วน **ตั้งค่า**
> (จัดการเฝ้าระวัง/กลุ่ม/จุดเข้าออก/ประเภทรถ/retention) ย้ายไป **การตั้งค่าระบบ > การตั้งค่าระบบ LPR**.

แบ่ง Phase ตามเส้น "ต้อง restart PM2 ไหม" (frontend block ก่อน แล้วค่อย backend):

### RF1 — แท็บเฝ้าระวัง LPR → read-only (frontend, refresh)
- `#lprTabWatchlist`: group filter chips + การ์ดรถในเฝ้าระวัง (plaque/กลุ่ม/region/note/รูป/mode/notify)
  — **ไม่มีฟอร์ม/แก้/ลบ**. โชว์แค่ list (entries แยกกลุ่ม); "ตรวจพบล่าสุด" รอ F3 (matching)
- reuse group filter; ตัด add/edit/delete ออกจากแท็บ

### RF2 — ย้ายจัดการเฝ้าระวัง → Settings › การตั้งค่าระบบ LPR (frontend, refresh)
- เพิ่ม rail `data-sec="lpr"` + section `#set-lpr` + `settingsNav` dispatch → `loadLprSettings()`
- re-home DOM: ฟอร์มเพิ่ม + จัดการกลุ่ม + list (แก้/ลบ) — reuse `_wlAdd/_renderWlList/_wlUploadImg`
  (ย้ายเป้า element ids, ไม่ duplicate). ทุกปุ่ม/select ผ่าน data-action dispatcher (CSP)
- backend gap: groups มีแค่ POST/DELETE → เพิ่ม **PATCH** (rename/สี)

### RF3 — Drag & Drop upload (frontend, refresh)
- drop zone + `addEventListener('drop'/'dragover')` (**ไม่ใช่ inline — CSP**) → POST /api/lpr/watchlist/image
  (resize อัตโนมัติ sharp 400×400 มีแล้ว). preview ก่อนเพิ่ม

### RF4 — Gate / Vehicle-type / Retention config (backend, 1 restart)
- **จุดเข้า-ออก (gate):** lane→เข้า/ออก หลายจุด — storage (validator settings.js + seed หรือ endpoint เฉพาะ)
- **ประเภทรถที่แสดงผล:** toggle + label TH ต่อ type — storage เดียวกัน. wire → donut/filter หน้า LPR
- **LPR retention:** setting `lpr_retention_days` default **7** (migration 052 seed + validator).
  job `enforceLprRetention()` ลบ `anprAlarm` events + `license_plates` + รูป `snapshots/lpr/<date>/`
  เก่ากว่า N วัน. ⚠️ snapshot retention เดิม scan แค่ top-level → subdir `lpr/` ไม่เคยถูกลบ (ค้างสะสม);
  **เว้น `lpr-watchlist/`** (รูป config). destructive → AUDIT dry-run count ก่อน (Working Agreement #3)

### RF5 — direction chart บน overview (deferred)
- **โมเดล (เจ้าของยืนยัน 2026-06-21): per-camera direction เป็นหลัก** — ผู้ดูแลกำหนดทิศต่อกล้อง
  (กล้อง A = ขาออก นับทุกเลน, B = ขาเข้า) เหมือน assign หมวดหมู่ Events ราย-กล้อง · กล้องที่ไม่กำหนด
  = ไม่แสดง (chart fallback "ผ่าน" รวม + ชี้ไปหน้าตั้งค่า). per-camera ทำ SQL **เบากว่า per-lane มาก**
  (group by ทิศของกล้อง แล้ว sum — ไม่ต้องแยกเลน) → ตัดเหตุ "SQL-heavy" ที่เป็นเหตุ defer ออกไป
- **per-lane gate config (RF4 ที่ ship แล้ว, `lpr_gates.rules`) = advanced case** — เก็บไว้สำหรับจุดที่
  กล้องเดียวคุมหลายทิศ (พบน้อย); per-camera ครอบ ~90% ของเคสจริง
- **demo สาธิตครบแล้ว** (`public/others/demo/`, `lpr-demo.js` `LPR_CAMS`): settings tab = list ราย-กล้อง
  segmented [ขาเข้า/ขาออก/ไม่กำหนด] · `chDir` รวม `sumHr(in)`/`sumHr(out)` · 3 สถานะ
  (none→"ผ่าน"รวม+note / in+out→2 เส้น / ข้างเดียว→1 เส้น+note)
- **prod ที่เหลือ:** column `lpr_direction` ('in'|'out'|null) ต่อกล้อง (เหมือน `cam_role`) + SQL endpoint
  group by direction + `date_bin` รายชั่วโมง + wire `chDir` ใน `page-lpr.js` (fallback "ผ่าน" เมื่อไม่ตั้ง)

---

## Phase CS7 — Standalone receiver split + Cutover Runbook (build DONE 2026-06-21, deploy deferred)

> CS7 = พับเข้า IM7 (แยก `/lpr`+`/face-push` ออกจาก api-server core). **Build เสร็จ committed `f213cca`** —
> `src/lpr-core.js` (shared ANPR ingest, forward-before-DB) · `src/lpr-forward.js` (forwarder + disk
> spool/retry, per-process subdir, `spool/` gitignored) · `src/routes/lpr.js` (thin glue, ยัง mount บน
> api-server = rollback path) · `src/lpr-receiver.js` (process แยก bind 127.0.0.1:3003, reuse routes/lpr +
> routes/face-push) · `src/lpr-pull.js` (Way 1 LAN pull DORMANT, throw จนกว่า confirm) · ecosystem PM2 entry.
>
> **Verified (synthetic, no camera) 2026-06-21:** happy path e2e ผ่าน DB จริง 14/14 — events+license_plates,
> snapshot, region, bbox, **cross-process pg_notify**, forward→sink + spool empties; test rows cleaned.
> เหลือ verify จริงแค่ "byte format กล้องจริง" + "CIB endpoint จริง" (ที่ C4/C5 หน้างาน).

### ⚠️ cloudflared = TOKEN-MANAGED (GOTCHAS #94) — routing อยู่ใน CF dashboard ไม่ใช่ config.yml
`cloudflared tunnel run --token …` → `~/.cloudflared/config.yml` **ถูกเมิน**. การแก้ไฟล์ + kickstart = no-op
(พิสูจน์: probe `POST /lpr` log ที่ api-server ไม่ใช่ receiver). path-route ต้องตั้งใน **Zero Trust dashboard**.

### ลำดับ cutover (ห้ามสลับ)

**P1 — ตั้ง forward→CIB ก่อน (Web UI ของเรา, CS6 field)** — Camera Settings › HIK-V_LPR01 › Data Forwarding
ใส่ CIB URL (`http://202.124.201.106:10001/receive_hik_phuket`) → save. (พอย้าย slot มาเรา CIB พึ่ง forward เรา 100%)

**C1 — start receiver ✅ DONE 2026-06-21** (เจ้าของ, Terminal LAN-safe — GOTCHAS #84; ห้ามจาก Claude/ssh shell)
```
open -a Terminal /Users/dojojin/vigil-platform/scripts/pm2-lan-safe-restart.command
# ใน Terminal นั้น (cwd repo):
pm2 start ecosystem.config.js --only lpr-receiver && pm2 save
curl -s http://127.0.0.1:3003/healthz; echo     # คาด {"ok":true,...}
```
(NVM-not-in-PATH error = PM2 noise, benign; interpreter ยัง pin node@24; receiver online 55mb)

**C2 — path-route ใน Cloudflare dashboard ✅ DONE + verified 2026-06-21** (เจ้าของ, web — GOTCHAS #94)
> tunnel = **`bosch-cctv-mac`** (ID `648a1cd5-…`) ไม่ใช่ `macbook-ssh` (config.yml stale = ถูกเมิน, token-managed).
> One Dash → Networks → Tunnels → `bosch-cctv-mac` → **Routes** → + Add route → **Published application**.
1. เพิ่ม route: Subdomain `dashboard` · Domain `dojojin.tech` · **Path `^/lpr$`** · Service `http://localhost:3003`
   (Path = regex **unanchored** + รวม `/` นำหน้า → ต้อง `^…$`; `http` ไม่ใช่ https. DNS-exists 400 = harmless)
2. ⚠️ route ใหม่ append ต่อท้าย + **reorder ไม่ได้** → catch-all (no-path)→:3000 ที่อยู่บนจะคว้า /lpr ก่อน.
   แก้ no-downtime: **Add** `dashboard.dojojin.tech`(Path ว่าง)→`http://localhost:3000` ใหม่ (ไปต่อท้าย) แล้ว
   **Delete** ตัวเดิมบนสุด → path-route เลยมาอยู่เหนือ catch-all
3. คุม /face-push ด้วย **route เดียว**: Edit Path `^/lpr$` → **`^/(lpr$|face-push/)`** (RE2 alternation, ไม่มี lookahead)
   → ลำดับสุดท้าย: `ssh`→:22 · `dashboard ^/(lpr$|face-push/)`→:3003 · `dashboard`(catch-all)→:3000

**C3 — verify routing ✅ PASS 2026-06-21**
```
curl -s -o /dev/null -w "%{http_code}\n" https://dashboard.dojojin.tech/api/lpr/stats   # 401 ✓ (api-server)
curl -s -o /dev/null -w "%{http_code}\n" https://dashboard.dojojin.tech/                # 302 ✓ (dashboard)
curl -s -X POST https://dashboard.dojojin.tech/lpr -H 'Content-Type: text/plain' --data CHECK            # 200
curl -s -X POST https://dashboard.dojojin.tech/face-push/TESTTOK -H 'Content-Type: text/plain' --data x  # 200
# ✓ [lpr] boundary + [face-push] unknown token ลงที่ lpr-receiver-error.log (ไม่ใช่ api-server)
```

**C4 — ย้าย push slot ที่หัวกล้อง** (เจ้าของทำเอง ที่ camera Web UI — ไม่ใช่ผม curl ISAPI; single slot + lockout)
หน้ากล้อง `10.11.100.4` → Alarm Server/HTTP Listening (ช่องที่ชี้ CIB) → `dashboard.dojojin.tech` Port `443`
Protocol `HTTPS` URL `/lpr` → save. **ต้องมี VPN ขึ้น** ถึงเข้าหน้ากล้องได้

**C5 — verify ingest จริง** — รถผ่าน → `pm2 logs lpr-receiver` เห็น `[lpr] <plate> → event #NN` + LPR Gallery ขึ้น plate
+ CIB ยังได้ผ่าน forward + `spool/lpr-forward-lpr-receiver/` ว่าง (ส่งสำเร็จ)

### Rollback (ทุกขั้นถอยได้)
- C2 พัง → ลบ route `^/(lpr$|face-push/)`→:3003 ใน CF dashboard → /lpr+/face-push กลับไป catch-all api-server (ยัง mount อยู่)
- C4/C5 พัง → ตั้งหัวกล้องกลับ CIB ตรง (กลับสภาพปัจจุบัน 100%) — CIB ผูกกับหัวกล้อง ไม่ผูก uptime เรา
- Abort ระหว่างเดินทาง: pause ฝั่งเรา (กัน offline alert) → ตั้งหัวกล้องกลับ CIB → cloudflared/receiver ปล่อย idle ได้

### Way 1 (LAN pull) — DORMANT
`src/lpr-pull.js` `startLprPull()` throw จนกว่า `{confirmUnverified:true}`. frame→ingest contract **ยังไม่ verify**
(per-frame Content-Type ต้อง derive จาก on-site Python `hikvision_anpr4_v3_fixed2.2.py` ก่อน). ใช้เมื่อต้อง replace ระบบ Python.

---

## RF-IMG — ย่อรูป LPR ตอน ingest (planned 2026-06-21, owner-confirmed)

**ปัญหา:** `src/lpr-core.js:248-254` เขียน `images.scene`/`images.plate` แบบ **RAW** (`fs.writeFileSync`, ไม่ย่อ). scene จากกล้องจริง **9MP** (~4096×2160) + **5MP** (~2592×1944), file **900KB-1.3MB** → ตัวกินดิสก์หลัก (LPR ยิงทุกคัน). เสริม RF4 retention (อายุ) ด้วยการคุม **ขนาดไฟล์**.

**Design (owner-confirmed):**
1. **scene → 1080p (2MP)** — `sharp(images.scene,{failOnError:false}).resize(1920,1080,{fit:'inside',withoutEnlargement:true}).jpeg({quality:Q,mozjpeg:true}).toBuffer()` แล้ว write ทับ. **ไม่เก็บต้นฉบับ** (owner: เก็บแต่ตัวย่อพอ). 9MP 16:9→1920×1080(2.07MP) · 5MP 4:3→1440×1080(1.55MP). ~1MB → ~250-400KB (ลด ~70%)
2. **plate crop คงคม** — q90, ไม่ย่อ (หลักฐานทะเบียน, เล็กอยู่แล้ว)
3. **2 settings ใน Settings › ระบบ LPR** (`#set-lpr`, หน้าเดียวกับ retention/gate/vtype) + validators:
   - `lpr_scene_resolution` — preset 720p/1080p/1440p (default **1080p**) → map เป็น (w,h)
   - `lpr_scene_quality` — 60-95 (default **80**)
   - quality เดียวพอ (ย่อทุกตัวเป็น 2MP เท่ากัน); per-camera ไว้ทีหลัง. เปลี่ยนค่า = มีผลกับรูป**ใหม่**เท่านั้น
4. **ที่ทำ:** `lpr-core.js` (shared core → Way1 pull + Way2 push ได้หมด, modular). resize เป็น async sharp.
5. **forward→CIB ใช้ raw body** → ย่อฝั่งเราไม่กระทบ CIB (รัฐได้ 9/5MP เต็ม) ✅
6. **perf:** sharp 9MP ~30-60ms/event (libvips); ingest async รับได้; burst หนักมาก→queue ทีหลัง

**⚠️ lock default ตอน cutover:** owner ให้ file-size ไม่ใช่ dimension exact ตอนวางแผน — เก็บ sample จริง 1 ใบ ลองย่อ q75/80/85 เทียบตา (อ่านป้าย/เห็นรถชัด) + ขนาดไฟล์ ก่อน lock default ของ site.

**scope:** increment เดียว — sharp ใน lpr-core + 2 validator (`routes/settings.js`) + UI section (`page-lpr-settings.js` + index.html). verify: ย่อ sample จริงเทียบ dimension/quality/size (ไม่แตะ prod, GOTCHAS #95).
