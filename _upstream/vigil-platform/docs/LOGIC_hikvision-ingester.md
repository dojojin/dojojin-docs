# LOGIC_hikvision-ingester — Hikvision ISAPI Ingester

> บันทึกครบวงจรสำหรับ `src/ingesters/hikvision-isapi.js`
> เป้าหมาย: AI agent อ่านไฟล์นี้แล้ววิเคราะห์หรือต่องานได้ทันที ไม่ต้องไล่อ่านโค้ดใหม่ทั้งหมด
> Last updated: 2026-06-18

---

## สารบัญ

1. [ภาพรวม Architecture](#1-ภาพรวม-architecture)
2. [Transport: ISAPI Alert Stream](#2-transport-isapi-alert-stream)
3. [Multipart Parser](#3-multipart-parser)
4. [Event Map & Normalization](#4-event-map--normalization)
5. [Face Capture Pipeline](#5-face-capture-pipeline)
6. [Body Appearance Pipeline](#6-body-appearance-pipeline)
7. [People Counting](#7-people-counting)
8. [Snapshot Capture](#8-snapshot-capture)
9. [Dwell Detection (fielddetection inactive)](#9-dwell-detection-fielddetection-inactive)
10. [Configuration Fields](#10-configuration-fields)
11. [ปัญหาที่พบและวิธีแก้ (Incident Log)](#11-ปัญหาที่พบและวิธีแก้-incident-log)
12. [GOTCHAS References](#12-gotchas-references)
13. [งานที่ยังค้างอยู่](#13-งานที่ยังค้างอยู่)
14. [Related Files](#14-related-files)
15. [ITC/ANPR Camera — HIK-V_LPR01 (iDS-2CD9396-HIS)](#15-itcanpr-camera--hik-v_lpr01-ids-2cd9396-his)

---

## 1. ภาพรวม Architecture

```
กล้อง Hikvision
  │
  │  GET /ISAPI/Event/notification/alertStream
  │  (long-lived HTTP, Digest auth, multipart/mixed response)
  │  Parts: application/xml | application/json | image/jpeg
  │
  ▼
hikvision-isapi.js (PM2 worker: hikvision, max:3)
  │
  ├── processMultipart()          ← parse binary-safe multipart buffer
  │    ├── application/xml  → ingestEvent()          ← Smart Events (VCA)
  │    ├── application/json
  │    │    ├── faceCapture       → handleFaceJson()
  │    │    ├── alarmResult       → ingestFaceAlarmEvent()   [Face Alarm Server]
  │    │    └── mixedTargetDetection → ingestBodyAppearance()
  │    └── image/jpeg
  │         ├── face crop (pId match)  → _pendingFaces
  │         └── background image      → _pendingFaces (bgPid match)
  │
  ├── INSERT events (shared table, vendor-tagged)
  ├── INSERT appearances          ← body + face attributes
  ├── pg_notify('new_event')      ← WS bridge picks up
  ├── pg_notify('event_for_clip') ← media-recorder dumps clip
  └── alertEngine.onEvent()       ← LINE alert pipeline
```

**Design principle:** ingester normalize event เข้า shared `events` table ด้วย vocabulary เดียวกับ Bosch — dashboard/alerts/stats ไม่ต้องรู้ vendor

**Worker:** `application_name: 'hikvision'`, pool max 3, `SET TIME ZONE 'UTC'` on connect

**Singleton guard:** `require('../singleton')('hikvision')` — ป้องกัน process ซ้อน

---

## 2. Transport: ISAPI Alert Stream

### Connection

```
GET /ISAPI/Event/notification/alertStream
Host: <ip>:<port>
Authorization: Digest ...   (two-step: 401 → re-request)
```

Response: `Content-Type: multipart/mixed;boundary=boundary`
ส่ง parts ต่อเนื่อง ไม่ปิด connection ตราบที่กล้อง online

**Reconnect:** exponential backoff `RECONNECT_BASE_MS = 5000` → `RECONNECT_MAX_MS = 30000`
`EHOSTUNREACH` / `ENETUNREACH` → reconnect ปกติ ไม่ backoff ยาว

### Heartbeat (last_seen_at)

กล้อง push `videoloss` event ทุก ~10 วินาทีแม้ไม่มี VCA event
`UPDATE cameras SET last_seen_at=NOW()` ทุก alertStream message รวม videoloss
ทำให้ Health Check เห็นกล้อง online ตลอดเวลา — **ไม่ใช่แค่ตอน VCA event**

### Face Alarm Server endpoint [แยกต่างหาก]

สำหรับกล้อง Face Capture รุ่นที่ push ไปยัง Face Alarm Server (HTTP POST):
```
POST /   ← api-server รับที่ port FAS_PORT
Content-Type: multipart/form-data
```

Parts: `alarmResult` (JSON) + `mixedTargetDetection` (JSON) + face/background images

ถูกจัดการใน `processFaceAlarmPost()` ซึ่งแยกจาก alertStream parser

---

## 3. Multipart Parser

### ทำไมไม่ใช้ parser library

ตัดสินใจใช้ hand-rolled parser เพราะ:
- ต้องการ binary-safe (JPEG parts ต้องไม่ถูก decode เป็น UTF-8)
- โครงสร้าง multipart ของ Hikvision ค่อนข้าง consistent
- รักษา dep count ต่ำ (decision #97: max 10 deps)

### Binary-safe parse loop (`processMultipart`)

```js
// Buffer-based — ไม่ใช่ string (version เดิมใช้ utf8 string ทำให้ JPEG เสีย)
const _BOUNDARY = Buffer.from('--boundary');
const _HDR_END  = Buffer.from('\r\n\r\n');

function processMultipart(cam, buf) {
  let offset = 0;
  while (true) {
    const bStart = buf.indexOf(_BOUNDARY, offset);     // หา boundary
    // parse headers → Content-Type, Content-Length
    // ถ้า body incomplete → เก็บ offset ไว้ รอ data เพิ่ม
    handlePart(cam, headers, body);
    offset = bodyStart + bodyLen;
  }
  return offset > 0 ? buf.slice(offset) : buf;        // คืน unprocessed tail
}
```

**ข้อสำคัญ:** `processMultipart` คืน unprocessed tail กลับมา caller เก็บ concat กับ data ก้อนถัดไป — รองรับ part ที่ถูก TCP แบ่งข้ามหลาย chunks

### Part dispatch (`handlePart`)

| Content-Type | handler |
|---|---|
| `application/json` + `name="alarmResult"` | `ingestFaceAlarmEvent()` |
| `application/json` + `name="mixedTargetDetection"` | `ingestBodyAppearance()` |
| `application/json` (other / faceCapture) | `handleFaceJson()` |
| `application/xml` | `ingestEvent()` (Smart Events) |
| `image/jpeg` | `handleImagePart()` (fan-out ตาม pId) |

### XML parsing (`xmlTag`, `xmlBlocks`)

Per-tag regex แทน XML parser library:
```js
function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}
```

เพียงพอสำหรับ Hikvision `EventNotificationAlert` ซึ่ง flat และ consistent
ไม่ต้องเพิ่ม dep

---

## 4. Event Map & Normalization

### HIK_EVENT_MAP

| Hikvision eventType | event_type (Bosch vocab) | rule_name |
|---|---|---|
| `linedetection` | `LineDetector/Crossed` | Line Crossing |
| `fielddetection` | `FieldDetector/ObjectsInside` | Intrusion Detection |
| `regionEntrance` | `RegionEntrance` | Region Entrance |
| `regionExiting` | `RegionExit` | Region Exit |
| `unattendedBaggage` | `UnattendedBaggage` | Unattended Baggage |
| `attendedBaggage` | `ObjectRemoval` | Object Removal |
| `faceSnap` | `FaceCapture` | Face Capture |
| `facedetection` | `FaceDetection` | Face Detection |
| `shelteralarm` | `TamperDetection` | Camera Tampering (Covered) |
| `scenechangedetection` | `TamperDetection` | Camera Tampering (Scene Change) |
| `defocus` | `TamperDetection` | Camera Tampering (Defocus) |

**Unmapped types:** log warning (ครั้งแรกเท่านั้น) พร้อม sample XML 1500 chars เพื่อ debug ภายหลัง
`videoloss` เงียบ (heartbeat — ไม่ log)

### dedup

`_dedup` Map keyed by `${cameraId}|${hikType}` → last host-ms
Hikvision re-post `eventState=active` ~1×/s ขณะ detection ดำเนินอยู่ → collapse ภายใน `DEDUP_WINDOW_MS = 3000` ms

### raw_json structure (Smart Event)

```json
{
  "vendor": "hikvision",
  "eventType": "linedetection",
  "eventState": "active",
  "channelID": "1",
  "ipAddress": "192.168.1.100",
  "dateTime": "2026-06-18T10:30:00+07:00",
  "description": null,
  "activePostCount": "1",
  "detectionRegions": [
    {
      "regionID": 1,
      "points": [[100, 200], [300, 400]],
      "target": "Human",
      "targetRect": { "x": 150, "y": 250, "width": 100, "height": 200 }
    }
  ]
}
```

### Detection Regions (`extractDetectionRegions`)

Parse `<DetectionRegionList>` → polygon points + targetRect จาก XML
Scale: ISAPI spec บอก grid 0–1000 แต่ยังไม่เคยเห็น XML จริงจากกล้องเรา — เก็บ raw ไว้ก่อน ตัดสินใจ scale ตอนทำ overlay

---

## 5. Face Capture Pipeline

### การไหลของ parts (alertStream)

```
JSON part (faceCapture)   → handleFaceJson()
                               └── register _pendingFaces[pId] = { cam, face, bgPid, ... }
image/jpeg (face crop)    → handleImagePart(name=pId)
                               └── pending.faceImg = body
                               └── maybeIngestFace(pId)
image/jpeg (background)   → handleImagePart(name=bgPid)
                               └── fan-out: ทุก pending ที่มี bgPid === name
                               └── maybeIngestFace(pid) ทุก pid
```

**Invariant:** ไม่ ingest จนกว่าจะมีทั้ง `faceImg` และ `bgImg` (ถ้า `bgPid` มีอยู่)
Timeout 8 วินาที → `flushPendingFace()` — ingest ด้วยรูปที่ได้มาแล้ว

**ทำไมต้องรอทั้งคู่:** `ingestFaceEvent()` เป็น async ถ้า ingest ตอนได้ crop แล้ว background มาทีหลัง — background จะไม่มี event_id ให้ attach (เคยพัง, fixed)

### `_pendingFaces` Map

```js
// facePid → { cam, face, eventTime, bgPid, faceImg, bgImg, timer }
const _pendingFaces = new Map();
```

Key = `face.pId` (ตัวเลขจาก JSON) — unique ต่อ capture ภายใน connection lifetime

### raw_json (face event)

```json
{
  "vendor": "hikvision",
  "eventType": "faceCapture",
  "faceId": 12345,
  "age": 32,
  "ageGroup": "middle",
  "gender": "male",
  "glass": "yes",
  "mask": "no",
  "hat": "no",
  "faceExpression": "neutral",
  "stayDuration": 5,
  "faceScore": 85,
  "faceRect": { "x": 0.35, "y": 0.2, "width": 0.15, "height": 0.25 },
  "pId": 98765
}
```

### Snapshot สำหรับ Face event

บันทึก 2 ภาพ:
- **face crop** → `snapshots/<cameraId>_<eventId>_face.jpg` (thumbnail ใน gallery)
- **full-frame background** → `snapshots/<cameraId>_<eventId>_bg.jpg` (full scene)

event `snapshot_filename` ชี้ไปที่ crop; background เก็บเป็น `raw_json._bg_snapshot`

### appearances INSERT (Face attributes)

หลัง INSERT event → INSERT ใน `appearances` table:
```js
const gender  = face.gender?.value === 'male' ? 'Male' : 'Female';  // normalize
const glasses = face.glass?.value === 'yes' || face.glass?.value === 'sunglasses';
```

**หมายเหตุ `hat`:** จงใจไม่ map ไปยัง column appearances — `hat` ของ Hikvision ≠ `helmet` ของ Bosch (ความหมายต่างกัน กัน search หลอก)

---

## 6. Body Appearance Pipeline

### สองเส้นทาง (Face Alarm Server vs alertStream)

**เส้นทาง A: Face Alarm Server (HTTP POST)**
- กล้อง Face Capture push POST มา api-server
- Parts: `alarmResult` → `ingestFaceAlarmEvent()` → INSERT event + บันทึก `_pendingBodyLink`
- `mixedTargetDetection` → `ingestBodyAppearance()` → ดึง `_pendingBodyLink` ภายใน 10s TTL

**เส้นทาง B: alertStream**
- `faceSnap` event JSON → `handleFaceJson()` → face+bg image accumulation → `ingestFaceEvent()`
- body data มาใน `mixedTargetDetection` part ของ multipart stream เดียวกัน

### `_pendingBodyLink` Map

```js
// camera_id → { eventId, ts }
const _pendingBodyLink = new Map();
```

เมื่อ `ingestFaceAlarmEvent` INSERT event สำเร็จ → set `_pendingBodyLink[camera_id] = { eventId, ts: now }`
เมื่อ `ingestBodyAppearance` มาถึง (ภายใน 10 วินาที) → อ่าน eventId แล้วลบ entry

**TTL:** 10,000 ms — ถ้า `mixedTargetDetection` ไม่มาใน 10s → entry หมดอายุ

### `ingestBodyAppearance` — normalization ที่สำคัญ

```js
const _cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null;
const _BOT_MAP = {
  longTrousers: 'Trousers',
  shortTrousers: 'Shorts',
  skirt: 'Skirt',
  dress: 'Dress',
};

const upper_color     = pm.jacketColor ? _cap(pm.jacketColor) : null;
const lower_color     = pm.trousersColor ? _cap(pm.trousersColor) : null;
const top_category    = pm.jacketType ? _cap(pm.jacketType) : null;
const bottom_category = pm.trousersType ? (_BOT_MAP[pm.trousersType] || _cap(pm.trousersType)) : null;
```

**suppress "unknown" color:** `upper_color === 'Unknown'` → null (ไม่มีความหมายใน search/chart)

**Body attributes ที่เก็บ (raw_json):**
```
jacketColor, trousersColor, jacketType, trousersType,
direction, hairStyle, gender, bag, things (CarryingThings),
ridingBike, ridingWithPassenger
+ catch-all loop: attribute ใหม่ที่ยังไม่ map ก็เก็บไว้ใน raw_json
```

### appearances INSERT (Body)

```sql
INSERT INTO appearances
  (event_id, camera_id, object_class, confidence,
   upper_color, lower_color, top_category, bottom_category,
   bag_category, gender, glasses, attributes)
VALUES ($1, $2, 'Person', $3, $4, $5, $6, $7, $8, $9, $10, $11)
```

`attributes` = JSONB เก็บ hair_style, things, riding_bike, riding_passenger ฯลฯ

---

## 7. People Counting

### กลไก

กล้อง Hikvision บางรุ่น (เช่น กล้อง People Counter) push สถิติ enter/exit ทุก 15 นาที
event ชื่อ `PeopleCounting` เข้า alertStream เป็น XML

**Filter:** เก็บเฉพาะ `statisticalMethods = 'timeRange'` + มี `startTime`
ทิ้ง `realtime` mode (ยอดสะสมรายวัน — ปนกัน SUM ของกราฟ)

**Dedup ด้วย NOT EXISTS:**
```sql
INSERT INTO events ... WHERE NOT EXISTS (
  SELECT 1 FROM events
  WHERE camera_id = $1
    AND event_type = 'CountAggregation/PeopleCounting'
    AND raw_json->>'window_start' = $4
)
```
ป้องกัน retransmission หลัง camera reconnect (กล้องส่ง window เก่าซ้ำ)

### raw_json structure

```json
{
  "vendor": "hikvision",
  "eventType": "PeopleCounting",
  "method": "timeRange",
  "window_start": "2026-06-18T10:00:00",
  "window_end":   "2026-06-18T10:15:00",
  "enter": 5,
  "exit": 3,
  "duplicate": 0,
  "regions": [{ "id": 1, "name": "Main Entrance", "enter": 5, "exit": 3 }],
  "retransmission": false
}
```

**Event type:** `CountAggregation/PeopleCounting` — มีชื่อ `Aggregation` ทำให้ filter เดิมซ่อนจาก Events list / WS / alert engine โดยอัตโนมัติ

---

## 8. Snapshot Capture

### `captureSnapshot(cam, eventId)`

```
GET /ISAPI/Streaming/channels/10<stream>/picture
Authorization: Digest (two-step)
Timeout: 5000 ms
```

**Channel selection:**
- `snapshot_stream` จาก cameras-config.json → `10${stream}` เช่น `101` (main) หรือ `102` (sub)
- default = `1` (main stream)
- **อย่า hardcode channel 102** — ดู GOTCHAS #41

**Stored:** `<cameraId>_<eventId>_<ts>.jpg` ใน `snapshots/`

**pg_notify timing:** `captureSnapshot().then()` → notify AFTER UPDATE (GOTCHAS #58)

```js
captureSnapshot(cam, eventId).then(async (filename) => {
  if (filename) {
    await pool.query(`UPDATE events SET snapshot_filename=$2, has_snapshot=TRUE ...`);
    console.log(`📸 snapshot saved`);
  }
  pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)]);  // AFTER UPDATE
}).catch(() => {
  pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)]);  // always notify
});
```

### Live snapshot (`/api/snapshot/live/:id`)

ใน api-server — ต่างจาก `captureSnapshot` (event-time):
- `?w` ≤ 400 → channel 102 (sub, 720p)
- `?w` absent หรือ ใหญ่ → channel `10<snapshot_stream||1>` (main)

---

## 9. Dwell Detection (fielddetection inactive)

### กลไก

`fielddetection` (Intrusion Zone) มีสองสถานะ:
- `active` → event_state `'true'` — บุกรุกเข้าโซน
- `inactive` → event_state `'false'` — ออกจากโซน

ขา `false` (inactive) ถูกเก็บเพื่อให้ `/api/stats/dwell` คำนวณ dwell time ได้:
```
event_state 'true' → event_state 'false'
  ↑ event_time          ↑ event_time
  └──────────────────────┘
         dwell duration
```

**ขา inactive ของ type อื่น (linedetection ฯลฯ) ทิ้งทั้งหมด** — event ชั่วขณะ ไม่มี "ออกจาก" concept

**Dedup ขา inactive:** ใช้ key `${cameraId}|${hikType}|inactive` — collapse 1×/s ใน 3s window เหมือนกัน

---

## 10. Configuration Fields

| Field | Default | คำอธิบาย |
|---|---|---|
| `camera_id` | required | ASCII-clean identifier |
| `vendor` | `'hikvision'` | trigger ingester routing |
| `ip_address` | required | กล้อง IP |
| `http_port` | `80` | ISAPI port |
| `username` / `password` | required | Digest auth |
| `snapshot_stream` | `1` | channel สำหรับ `captureSnapshot` (1 = main) |
| `clip_stream` | `1` | stream index สำหรับ RTSP buffer |
| `enable_clip_capture` | `false` | เปิด/ปิด clip dump |
| `enable_snapshot` | `true` | เปิด/ปิด event snapshot |
| `fas_enabled` | `false` | เปิด Face Alarm Server POST path |
| `fas_source_ip` | null | allowlist IP ของกล้อง FAS (GOTCHAS #57) |

---

## 11. ปัญหาที่พบและวิธีแก้ (Incident Log)

### Incident #1 — Hikvision re-post active ทุกวินาที ทำ events ล้น (2026-05-21)

**อาการ:** DB events เพิ่มขึ้น ~60 rows/นาที ต่อ detection event เดียว
**Root cause:** Hikvision ส่ง `eventState=active` 1×/s ตลอดที่ detection ดำเนินอยู่
**แก้:** `_dedup` Map per `(cameraId, eventType)` — collapse ภายใน 3000ms
**ผลข้างเคียง:** ถ้า dedup window ยาวเกิน อาจ miss event ที่มาถี่จริงๆ — 3s เป็น tradeoff ที่ยอมรับได้

### Incident #2 — Live Pulse card ไม่มีภาพ (2026-05-28)

**อาการ:** WS event ถึง frontend แต่ `snapshot_file` เป็น null
**Root cause:** `pg_notify('new_event')` ถูกยิงก่อน `captureSnapshot()` resolve → row ยังไม่มี filename
**แก้:** ย้าย notify เข้าไปใน `.then()` ของ captureSnapshot (ดูโค้ดหัวข้อ 8)
**GOTCHAS #58**

### Incident #3 — hard-code channel 102 cap live snapshot ที่ 720p (2026-05-21)

**อาการ:** "View Full" กด → ได้ภาพ 720p ทั้งที่กล้อง 4K
**Root cause:** `/api/snapshot/live` hardcode `channels/102/picture` เสมอ
**แก้:** ปรับให้เลือก channel จาก `?w` + `snapshot_stream` config (ดูหัวข้อ 8)
**GOTCHAS #41**

### Incident #4 — Face Capture background image ถูกทิ้ง (2026-05-21)

**อาการ:** Face event ได้ crop แต่ไม่มี full-frame background
**Root cause:** ingester เดิม call `ingestFaceEvent()` ทันทีที่ได้ crop part โดยไม่ await → background part ถึงขณะที่ INSERT ยังไม่เสร็จ → ไม่มี eventId ให้ attach
**แก้:** เพิ่ม `_pendingFaces` pattern — รอทั้ง crop และ background (หรือ 8s timeout) ก่อน ingest

### Incident #5 — RTSP credential URL-encode ใน media-recorder (2026-06-02)

**อาการ:** ffmpeg 401 Unauthorized สำหรับ Hikvision clip
**Root cause:** media-recorder ลืม `decryptCamCreds(cam)` ก่อน build RTSP URL
**แก้:** เพิ่ม decrypt ใน media-recorder
**GOTCHAS #75**

### Incident #6 — appearances table ว่างทั้งหมด (2026-06-01)

**อาการ:** `SELECT count(*) FROM appearances = 0` ทั้งที่มี event จริงหลายพัน
**Root cause A:** schema drift — `appearances` table เพิ่ม column ใหม่แต่ INSERT ไม่อัปเดต → ล้มเหลวเงียบด้วย `catch (e) { }`
**Root cause B:** `upper_color`/`lower_color` ว่าง — field name ใน INSERT ไม่ตรงกับ column name จริงใน schema
**แก้:** ซ่อม column list ใน INSERT + ตรวจ schema drift ด้วย migration 046 normalize
**GOTCHAS #62, #63**

### Incident #7 — PeopleCounting duplicate rows หลัง camera reconnect (2026-06-12)

**อาการ:** กราฟ People Counting มียอดซ้ำ
**Root cause:** กล้อง retransmit window เก่าหลัง reconnect → INSERT ซ้ำ
**แก้:** `WHERE NOT EXISTS` บน `window_start` + filter เฉพาะ `statisticalMethods=timeRange`

### Incident #8 — color dot ไม่แสดงใน Hikvision appearance cards (2026-06-17)

**อาการ:** Hikvision card บน Appearance page / face match modal ไม่มี color dot
**Root cause A:** `_COLOR_HEX` declare เป็น `const` ระดับ top-level ใน `page-appearance.js` → ไม่ติด `window` → `typeof _COLOR_HEX === 'undefined'` ใน file อื่น
**แก้:** ย้ายเป็น `var` ใน `page-snapshots.js` (shared scope ผ่าน window)
**Root cause B:** Hikvision มี `upper_color` (string เช่น "Red") แต่ไม่มี `top_color_xyz` → dot render path ที่ใช้ XYZ ไม่ทำงาน
**แก้:** เพิ่ม `_colorBgByName(name)` — fallback จาก named color → hex/gradient
**commits: 5f52263, fe7a412**

### Incident #9 — Hikvision body data format ไม่ตรง BOSCH canonical (2026-06-17)

**อาการ:** chip ใน face match modal ต่างจาก BOSCH; `Mixture` color render เป็น gray
**Root cause:** Hikvision ส่ง `longTrousers` / `shortTrousers` ซึ่งไม่มีใน BOSCH vocabulary; color case ไม่ตรง
**แก้:** เพิ่ม `_BOT_MAP` normalize ใน `ingestBodyAppearance` + ใน display layer (`_matchBodyChips`)
`Mixture` → rainbow gradient swatch; `'unknown'` → suppress
**migration 046:** one-time UPDATE normalize historical rows
**commits: 6c38c85**

### Incident #10 — age_group ไม่แสดงใน Appearance chart (2026-06-17)

**อาการ:** Age Group chart ว่างสำหรับ Hikvision events
**Root cause:** `appearances.age_group` column ไม่เคยถูก populate จาก Hikvision face event; chart query ใช้ column โดยตรง
**แก้:** appearances stats query เพิ่ม `COALESCE(a.age_group, e.raw_json->>'ageGroup')` เพื่อดึงจาก events.raw_json เป็น fallback
**commits: 6c38c85**

### Incident #11 — unmapped eventType หายเงียบ (2026-06-11)

**อาการ:** Tampering event ไม่ถูก record แม้กล้องส่งมา
**Root cause:** `shelteralarm`/`scenechangedetection`/`defocus` ไม่อยู่ใน `HIK_EVENT_MAP` เดิม; unmapped types ถูก return ก่อน log
**แก้:** เพิ่ม 3 entries ใน HIK_EVENT_MAP + log warning + sample XML dump สำหรับ type ใหม่ที่ยังไม่ map

### Incident #12 — fielddetection inactive ทิ้งโดยไม่เก็บ (2026-06-11)

**อาการ:** dwell time stats ไม่ทำงานสำหรับ Hikvision; `/api/stats/dwell` คืน 0
**Root cause:** `inactive` ทุก type ถูก `return` ทิ้งก่อน insert
**แก้:** เพิ่ม branch `fielddetection inactive` → INSERT event_state `'false'` แยก (ตาม pattern ของ Bosch/Dahua)

---

## 12. GOTCHAS References

| # | หัวข้อ | ผลต่อ Hikvision |
|---|---|---|
| #32 | Invisible chars ใน camera_id | sanitize ก่อน save ทุกครั้ง |
| #41 | Hikvision live-snapshot channel | อย่า hardcode channel 102 |
| #43 | has_snapshot column ว่าง | write column พร้อม raw_json เสมอ |
| #49 | uptime % ต่ำ | อย่าเขียน `enabled=TRUE` จาก ingester |
| #57 | FAS POST allowlist | bind FAS port ไปยัง LAN IP + allowlist source IP |
| #58 | WS event ก่อน snapshot | pg_notify หลัง snapshot UPDATE |
| #62 | appearances INSERT ล้มเหลวเงียบ | ตรวจ column list vs schema เสมอ |
| #63 | appearances.upper_color ว่าง | field name ต้องตรง schema |
| #67 | appearances.snapshot_b64 dropped | DROP ใน migration 035 — อย่า SELECT |
| #75 | RTSP credential URL-encode | decrypt creds ก่อน build URL |
| #84 | macOS LNP / EHOSTUNREACH | restart PM2 ด้วย Terminal GUI |

---

## 13. งานที่ยังค้างอยู่

| รายการ | สถานะ | หมายเหตุ |
|---|---|---|
| Smart Events overlay บน snapshot | ยังไม่ทำ | `detectionRegions` เก็บไว้แล้วใน raw_json; scale 0–1000 ยังไม่ verify จากกล้องจริง |
| Face Capture pgvector matching | ยังไม่ทำ | ดู `docs/REF_face-recognition.md` Phase FR.1–4 |
| `snapshot_b64` removal cleanup | ✅ migration 035 | อย่า query column นี้ |
| People Counting dashboard widget | ยังไม่ทำ | data เก็บแล้ว — รอ UI |
| `appearances.age_group` backfill | ยังไม่ทำ | ปัจจุบัน COALESCE จาก raw_json; migration ถ้าต้องการ index |
| Body appearance verify บน Hikvision Face Capture จริง | **ยังไม่ verify ครบ** | appearance เต็มได้จาก 8100iX เท่านั้น (ดู memory project_appearance_plan.md) |

---

## 15. ITC/ANPR Camera — HIK-V_LPR01 (iDS-2CD9396-HIS)

> Probed: 2026-06-24 · 76,333 events ใน DB ณ วันที่ probe

### ภาพรวม

กล้องนี้ **ไม่ได้ใช้ `hikvision-isapi.js`** — ใช้ HTTP push แยก pipeline

```
กล้อง iDS-2CD9396-HIS (IP 10.11.100.4)
  │  HTTP POST multipart/form-data  (XML + plate image + scene image)
  ▼
Cloudflare Tunnel → dashboard.dojojin.tech/lpr
  ▼
lpr-receiver.js (PM2 worker, port 3003)
  ▼
routes/lpr.js → lpr-core.js
  ├── INSERT events (event_type='anprAlarm')
  └── INSERT license_plates
```

**ตำแหน่งกล้อง: ส่องไปทางหลังรถ (rear-facing)**
ทำให้ `direction=reverse` เกือบ 100% (76,321/76,333) — รถวิ่งออกจากกล้อง = reverse
`direction=forward` มีแค่ 12 ครั้ง = รถย้อนศร / กลับรถ

---

### XML Fields — ครบทุก field ที่กล้องส่งมา

#### กลุ่ม 1 — ข้อมูลป้ายทะเบียน

| XML Field | ความหมาย | ค่าที่เป็นไปได้ | เก็บใน DB | ค่าจริงใน DB (76k events) |
|---|---|---|---|---|
| `licensePlate` | เลขทะเบียน | string | ✅ `license_plates.plate_number` + `raw_json.plate` | ทะเบียนไทย ส่วนใหญ่ภูเก็ต/พังงา |
| `confidenceLevel` | % ความมั่นใจรวมทั้งป้าย | 0–100 | ✅ `license_plates.confidence` | ส่วนใหญ่ 85–90 |
| `plateCharBelieve` | % ความมั่นใจ **รายตัวอักษร** (comma-separated) | "92,92,92,92,92,92" | ❌ ยังไม่เก็บ | มีค่าจริงทุก event — min-char เป็น quality filter ได้ |
| `plateColor` | สีพื้นป้าย | white/yellow/green/red/blue/black/colorful/orange | ✅ `raw_json.plateColor` | white 85%, yellow 6%, unknown 6%, red 1.5%, green 1.4% |
| `plateType` | ประเภทป้าย (รหัส Hikvision) | 1=ขาวรถยนต์, 12=มอเตอร์ไซค์, 3=เขียว, 32=ชั่วคราว, 34=ราชการ, 21=รถใหญ่, 2=เหลือง, 6=น้ำเงิน, 99=อื่น | ✅ `raw_json.plateType` | 1→41%, 12→17%, 3→16%, 32→5%, 34→4% |
| `licenseBright` | ความสว่างแสงสะท้อนป้าย | 0–255 | ❌ ไม่เก็บ | ไม่มีประโยชน์ pipeline ปัจจุบัน |

#### กลุ่ม 2 — ข้อมูลรถยนต์

| XML Field | ความหมาย | ค่าที่เป็นไปได้ | เก็บใน DB | ค่าจริงใน DB |
|---|---|---|---|---|
| `vehicleType` | ประเภทยานพาหนะ | SUVMPV/pickupTruck/vehicle/twoWheelVehicle/buggy/van/truck/largeBus/threeWheelVehicle/pedestrian | ✅ `license_plates.vehicle_type` + `raw_json.vehicleType` | SUV 21%, pickup 20%, ทั่วไป 18%, มอเตอร์ไซค์ 17% |
| `color` | สีรถ | white/black/gray/blue/red/yellow/green/brown/purple/unknown | ✅ `license_plates.vehicle_color` + `raw_json.vehicleColor` | white 31%, black 21%, gray 20%, unknown 18% |
| `vehicleLogoRecog` | ยี่ห้อรถ (รหัส Hikvision integer) | 1036/1053/1060/1102/1151/… 0=ไม่รู้ | ✅ `license_plates.vehicle_brand` + `raw_json.vehicleBrand` | รหัสตัวเลข — ยังไม่มี lookup table ยี่ห้อ |

#### กลุ่ม 3 — ตำแหน่งและทิศทาง

| XML Field | ความหมาย | ค่าที่เป็นไปได้ | เก็บใน DB | ค่าจริงใน DB |
|---|---|---|---|---|
| `line` / `laneNo` | หมายเลขช่องจราจร | "1", "2", "3" | ✅ `raw_json.laneNo` | มีทุก event |
| `direction` | ทิศทางรถ (relative กับกล้อง) | reverse/forward | ✅ `raw_json.direction` | reverse 99.98%, forward 12 ครั้ง (ย้อนศร) |
| `detectDir` | ทิศทางตรวจจับ (รหัส integer) | 2 | ❌ ไม่เก็บ | ซ้ำกับ direction |
| `relaLaneDirectionType` | ประเภททิศทางช่องจราจร | 0 | ❌ ไม่เก็บ | คงที่ |
| `detectType` | ประเภทการตรวจจับ | 2 | ❌ ไม่เก็บ | คงที่ |
| `tailandStateID` | รหัสจังหวัด (Hikvision) | 1–77 | ✅ แปลงเป็น `raw_json.region` | ส่วนใหญ่ภูเก็ต/พังงา/กรุงเทพฯ |

#### กลุ่ม 4 — การละเมิดกฎจราจร

| XML Field | ความหมาย | ค่าที่เป็นไปได้ | เก็บใน DB | ค่าจริงใน DB |
|---|---|---|---|---|
| `speedLimit` | ความเร็วสูงสุดที่ **ตั้งในกล้อง** (ไม่ใช่ความเร็วรถ) | integer km/h | ❌ ไม่เก็บ | 70 คงที่ทุก event |
| `illegalCode` | รหัสการฝ่าฝืน | 0=ปกติ · **151002=Without_Helmet · 1240=Seatbelt_Unbuckled** | ❌ ยังไม่เก็บ | **⚠️ ไม่ใช่ 0 ทุก event อีกแล้ว — ดู §15.1** (76,333 records) — กล้องยังไม่ถูก config violation detection |
| `illegalName` | ชื่อการฝ่าฝืน | `Normal` · `Without_Helmet` · `Seatbelt_Unbuckled` | ❌ ยังไม่เก็บ | **⚠️ เปลี่ยนแล้ว — ดู §15.1** |
| `illegalDescription` | คำอธิบาย (มักว่าง) | string | ❌ ไม่เก็บ | ว่างทุก event |

#### กลุ่ม 5 — พฤติกรรมผู้ขับขี่

> **แก้ความเข้าใจ 2026-08-07:** เดิมเขียนว่า "field กลุ่มนี้ส่วนใหญ่ `unknown` เพราะมุมกล้อง"
> — จริงเพียงบางส่วน · ตัวกำหนดหลักคือ**สวิตช์ใน `carFeatureParam`** ซึ่งอ่าน/เขียนได้จากระบบเรา
> พิสูจน์แล้ว: เปิด `helmetEnabled` เพิ่ม 8 กล้อง → ตรวจจับได้ทันที **100%** จากที่เคยเป็น 0 มาตลอด

| XML Field | ความหมาย | **สวิตช์ที่คุม** | เก็บใน DB | สถานะจริง 2026-08-07 |
|---|---|---|---|---|
| `helmet` | ผู้ขับมอเตอร์ไซค์สวมหมวกกันน็อก | `helmetEnabled` | ✅ `license_plates.no_helmet` | **เปิดครบ 16/16 กล้อง** · `unknown`=0 · อัตราไม่สวม 17–50% |
| `nonMotorManned` | มีคนซ้อนท้ายมอเตอร์ไซค์ | `twoWheelVehicleEnabled` | ✅ `raw_json.nonMotorManned` | เปิดอยู่ |
| `pilotsafebelt` | คนขับไม่คาดเข็มขัด | `safetyBeltEnabled` + `safeBeltSensitivity` | ✅ `license_plates.no_seatbelt` | **ใช้งานได้จริงแค่ 2 กล้อง** — `C4-CHL-SB-01` 99.7% · `C32-THL-SB-14` 50% |
| `vicepilotsafebelt` | ผู้โดยสารหน้าไม่คาดเข็มขัด | เดียวกับข้างบน | ✅ รวมกับ `no_seatbelt` | เดียวกัน |
| `uphone` | คนขับใช้โทรศัพท์ | `uphoneEnabled` | ✅ `raw_json.uphone` | เปิดเกือบทุกกล้อง · ยังไม่เคยพบ `yes` |
| `smoking` | คนขับสูบบุหรี่ | `smokingEnabled` | ❌ ไม่เก็บ | เปิด 1 กล้อง (`C18-KAR-SB-09`) · **พบจริง 19 เคส/9 วัน** |
| `playMobilePhone` | คนขับเล่นโทรศัพท์ | `playMobilePhone` | ❌ ไม่เก็บ | เปิด 4 กล้อง · ยังไม่พบ `yes` |
| `pilotmask` / `vicepilotMask` / `nonMotorMask` / `pedestrianMask` | สวมหน้ากาก | — | ❌ ไม่เก็บ | `unknown` ทุก event |

> ⚠️ **เข็มขัดยังหาเงื่อนไขไม่เจอ** — 2 กล้องที่ทำงานกับอีก 14 ตัว **รุ่นเดียวกัน (`iDS-2CD9396-HIS`) ·
> config เหมือนกันทุกฟิลด์ · algorithm ชุดเดียวกัน · ขนาดรถในเฟรมไม่ใช่คำตอบ (ตัวที่รถใหญ่สุดได้ 0%) ·
> reboot ไม่ช่วย · กลางวันไม่ช่วย** — เหลือแต่ตัวแปรหน้างาน (ระยะ · องศาก้ม · zoom · ความสูงเสา)

#### กลุ่ม 6 — ของในรถ / ป้ายรถ

> **แก้ความเข้าใจ 2026-08-07:** เดิมเขียนว่า "มองจากหลังไม่เห็น" — **ไม่ใช่สาเหตุหลัก**
> ทุกฟิลด์ในกลุ่มนี้มี**สวิตช์เปิด/ปิดของตัวเอง** ใน `/ISAPI/ITC/carFeatureParam` และ**ปิดอยู่ทุกตัว**
> ค่าจึงเป็น `unknown` ไม่ว่ามุมกล้องจะเป็นอย่างไร · วัดจาก 59,406 event (3 ชม., 16 กล้อง) = `unknown` 100%

| XML Field | ความหมาย | **สวิตช์ที่คุม** | ค่าปัจจุบัน | เก็บใน DB |
|---|---|---|---|---|
| `dangmark` | ป้ายวัตถุอันตราย (รถขนสารเคมี/แก๊ส) | `dangerousVehicleEnabled` | false | ❌ |
| `envprosign` | ป้ายมาตรฐานไอเสีย | `highPollutVehicleEnabled` *(อนุมาน)* | false | ❌ |
| `decoration` | ของตกแต่งในรถ | `decorationEnable` | false | ❌ |
| `label` | สติกเกอร์บนรถ | `labelEnable` | false | ❌ |
| `pendant` | ของห้อยหน้ากระจก | `pendantEnabled` + `pendantSensitivity` | false | ❌ |
| `tissueBox` | กล่องทิชชู่ | `tissueBoxEnable` | false | ❌ |
| `perfumeBox` | น้ำหอมในรถ | **ไม่พบสวิตช์ที่ตรงกัน** — น่าจะรวมกับ decoration | — | ❌ |
| `frontChild` | เด็กนั่งเบาะหน้า | `frontChildEnable` | false | ❌ |
| `pdvs` | **ไม่มีเอกสารรองรับที่ใดเลย** — ค้นทั้งเอกสารทางการ Hikvision และชุมชนนักพัฒนา 2026-08-15 ไม่พบ · `unknown` 100% ⇒ ถือว่าไม่มีผล | ไม่พบสวิตช์ | — | ❌ |
| `pilotsunvisor` / `vicepilotsunvisor` | ดึงบังแดด | `sunVisorEnabled` | false | ❌ |
| `nonMotorShedUmbrella` | มอเตอร์ไซค์กางร่ม | `isSupportShed` | false — รุ่นนี้ไม่รองรับ | ❌ |

#### กลุ่ม 6b — สวิตช์ที่ยังไม่มีฟิลด์คู่ใน XML (เพราะไม่เคยเปิด)

พบใน `carFeatureParam` ครบ 37 สวิตช์ · กลุ่มนี้เปลี่ยน**สิ่งที่กล้องส่งออกมา** ไม่ใช่แค่ค่า yes/no

| สวิตช์ | ทำอะไร | สถานะ |
|---|---|---|
| `CarBodyFeature.enabled` · `faceDetectEnabled` · `hostFaceEnabled` · `viceFaceEnabled` · `nonMotorFaceEnabled` | **ตัดภาพใบหน้าคนขับ / ผู้โดยสารหน้า / คนขี่มอเตอร์ไซค์ ออกมาเป็นภาพแยก** | ปิดทั้งหมด — กล้อง ANPR รุ่นนี้ทำ face capture ได้ในตัว |
| `tempPlateEnable` · `passCardEnable` · `carCardEnable` · `vehicleUseEnable` | อ่านป้าย/บัตรที่ติดกระจกหน้า | ปิด |
| `reflectiveStripeEnabled` | ตรวจเสื้อสะท้อนแสง | ปิด |
| `vehicleSubBrandEnabled` | รุ่นย่อยของยี่ห้อรถ | **เปิดอยู่** — แต่เรายังไม่เก็บค่า |
| กลุ่ม `faceMask*` (6 สวิตช์) | เบลอ/ปิดบังใบหน้าในภาพที่ส่งออก | ปิด — เกี่ยว PDPA โดยตรงถ้าเปิด face capture |

#### กลุ่ม 7 — Metadata event

| XML Field | ความหมาย | ค่าจริง | เก็บใน DB |
|---|---|---|---|
| `ipAddress` | IP กล้อง | 10.11.100.4 | ❌ (ดูจาก camera_id แทน) |
| `macAddress` | MAC กล้อง | 08:3b:c1:92:ae:60 | ❌ |
| `dateTime` | เวลากล้อง (+07:00) | ISO8601 | ✅ `events.event_time` |
| `country` | รหัสประเทศ | 64=Thailand | ✅ `raw_json.country` |
| `tailandStateID` | รหัสจังหวัด | 1–77 | ✅ แปลงเป็น `raw_json.region` |
| `activePostCount` | ลำดับ event สะสมในกล้อง | integer | ❌ |
| `featurePicFileName` | ชื่อไฟล์ภาพใน multipart | "1" | ❌ (ใช้ parse multipart แทน) |

---

### สรุป: field ที่ควรพิจารณาเพิ่มในอนาคต

| Field | เหตุผล | ขนาดงาน |
|---|---|---|
| `plateCharBelieve` | มีค่าจริงทุก event — min-char < 60 = skip → ลด false plate | เล็ก — เพิ่ม filter ใน `lpr-core.js` |
| `illegalCode` / `illegalName` | **มีค่าจริงแล้วตั้งแต่ 2026-07-29 (ดู §15.1)** — ไม่ต้อง config อะไรเพิ่ม | เล็ก — เพิ่ม column + เก็บใน raw_json |
| `smoking` / `playMobilePhone` | **แก้ 2026-08-07** — ไม่ใช่ "unknown เพราะมุมกล้อง" แต่เพราะ `smokingEnabled`/`playMobilePhone` ปิดอยู่ · เปิดแล้ว `C18-KAR-SB-09` พบสูบบุหรี่จริง **19 เคส/9 วัน** (0.025% ของรถที่ผ่าน) · `playMobilePhone` เปิด 4 กล้อง ยังไม่พบเคส | ค่ามีใน `rawXml` แล้ว — กู้ย้อนหลังได้ · **ยังไม่คุ้มที่จะเพิ่มคอลัมน์** เพราะ ~2 เคส/วัน |
| `pilotmask` / `vicepilotMask` ฯลฯ | ปิดอยู่ทุกกล้อง | — |
| **face capture ในตัวกล้อง** | `CarBodyFeature`/`hostFaceEnabled` ตัดภาพใบหน้าคนขับได้ — ปิดอยู่ | เกี่ยวกับงาน driver face capture ที่พักไว้ · เปิดผ่าน ISAPI ได้ |

---

### LPR API & Visibility

The `/api/lpr` search endpoint uses **keyset pagination** (decision #211) with `before_time` + `before_id` cursors for stable cursor-based navigation (no OFFSET). The LPR overview dashboard includes two new Top-10 charts:
- `pcolor[]` — license plate color distribution
- `brand[]` — vehicle brand Top-10 (vehicle_brand codes from ingester parsing)

---

### 15.1 Violation detection เปิดใช้งานแล้ว (สำรวจซ้ำ 2026-08-15)

> §15 probe ไว้ 2026-06-24 ตอนมี 76,333 event · สำรวจซ้ำวันนี้ที่ **5,928,188 event**
> พบว่าข้อมูล 1 จุดล้าสมัย และมีฟีเจอร์ที่กล้องส่งมาแล้วแต่ระบบไม่เคยอ่าน

**🔴 มีคนเปิด violation detection บนกล้องเมื่อ 29–30 ก.ค. 2026 — เราไม่เคยอ่านผลเลย**

| รหัส | `illegalName` | จำนวน (20 วัน) | เริ่มส่ง |
|---|---|---|---|
| `151002` | `Without_Helmet` | 16,279 | 2026-07-29 16:36 |
| `1240` | `Seatbelt_Unbuckled` | 171 | 2026-07-30 05:00 |

**ความสัมพันธ์กับชั้นตรวจจับ (ตรวจแล้ว ไม่ใช่การอนุมาน):**

| เรื่อง | ชั้นตรวจจับ | ชั้นตัดสินความผิด | สัดส่วน |
|---|---|---|---|
| หมวกกันน็อค (`helmet=no`) | 366,328 | 6,793 | 1.9% |
| เข็มขัดนิรภัย (`pilotsafebelt=no`) | 11,095 | 171 | 1.5% |

⇒ **`Without_Helmet` เป็นส่วนย่อยของ `helmet=no` ทั้งหมด ไม่มีเคสไหนเกินออกมา** — ชั้นที่สอง
ไม่เพิ่มจำนวนการตรวจจับ แต่เป็นการคัดของกล้องเองว่าเคสไหนมั่นใจพอจะเรียกว่า "ความผิด"
· **เกณฑ์ที่กล้องใช้คัดยังไม่ทราบ** — เจ้าของยืนยัน 2026-08-15 ว่าเคส `helmet=no` ที่สุ่มดู
เป็นของจริง ไม่ใช่ตรวจผิด จึงยังสรุปไม่ได้ว่าอีก 98% ต่างจาก 1.9% ตรงไหน (งานรอบถัดไป)

**เข็มขัดนิรภัย — แยกคนขับกับผู้โดยสารได้จริง**

| ฟิลด์ | หมายถึง | ตรวจพบ "ไม่คาด" (20 วัน) |
|---|---|---|
| `pilotsafebelt` | คนขับ | 11,095 |
| `vicepilotsafebelt` | ผู้โดยสารเบาะหน้า | 2,722 |

โค้ดปัจจุบันรวมสองค่านี้เป็น `no_seatbelt` ค่าเดียว (`lpr-core.js:234`) ⇒ **แยกไม่ออกว่าใครไม่คาด
ทั้งที่กล้องแยกให้แล้ว**

**หมวกกันน็อค — แยกคนขี่กับคนซ้อนไม่ได้** · มีแท็ก `helmet` ตัวเดียว ไม่มีของคนซ้อนแยก ·
อนุมานทางอ้อมได้จาก `nonMotorManned` เฉพาะกรณีขี่คนเดียว · (`riderCount` ที่นับคนซ้อนได้เป็นของ
Dahua ITC431 ไม่มีในกล้องตัวนี้)

**ความพร้อมใช้ของฟิลด์ (วัดจาก 5,000 event · 38 ฟิลด์ที่สนใจ)**

| กลุ่ม | จำนวน | ตัวอย่าง |
|---|---|---|
| มีค่าเกือบทุก event | 16 | `illegalCode` `direction` `line` `plateType` `vehicleType` `confidenceLevel` |
| มีค่าบางส่วน | 6 | `helmet` 47% · `uphone` 49% · `nonMotorManned` 47% · `pilotsafebelt` 3.9% |
| `unknown` ทุก event (สวิตช์ปิด) | 16 | `pendant` `tissueBox` `perfumeBox` `decoration` `frontChild` `pilotmask` ฯลฯ |

**กลุ่ม "อ่านป้ายไม่ออก" 2.2%** — `confidenceLevel=0` + `plateColor=unknown` + `country=0` +
`licenseBright=0` เกิดพร้อมกันในเคสเดียวกัน · ตรงกับที่ชุมชนภายนอกเตือนว่า `confidence=0`
หมายถึง "อ่านไม่ได้" ไม่ใช่ "มั่นใจน้อย"

**ใบหน้าคนขับ** — กล้องอัป `pilotPicture.jpg` มาจริง แต่ `classifyImage()` (`lpr-core.js:106`)
รู้จักแค่ scene/plate/composite → ตกเป็น unknown แล้วถูกทิ้ง **โดยไม่มี log บอกด้วยซ้ำ**
(ดู ROADMAP "Driver Face Capture" · DEFERRED 2026-07-01)

**วิธีสำรวจซ้ำ (method)** — รายงานเต็มอยู่ที่ `docs/reports/rawxml-anpr-survey-2026-08-15.*`
(HTML/PDF/DOCX · local เท่านั้น ไม่ commit) · หลักการ 3 ขั้น: regex หา leaf tag ทุกตัวจาก
`raw_json.rawXml` → วัดสัดส่วนค่าที่ไม่ใช่ `unknown` → diff กับเอกสารนี้
> ⚠️ **บทเรียน:** เหตุการณ์ที่เกิดน้อยกว่า 1 ใน 1,000 **ต้องค้นทั้งชุด ห้ามสุ่ม** — รอบแรกสุ่ม
> 5,000 event แล้วสรุปผิดว่า `pilotsafebelt` ไม่เคยรายงาน `no` (ความจริง 11,095 ครั้ง)

#### 15.1.1 Probe สดทั้ง 16 กล้อง ANPR (2026-08-15) — ละเมิดจราจร + face

อ่านอย่างเดียว (GET ผ่าน `helpers/digestAuth`) จาก edge hkt · **ตอบครบ 16/16**

**ก) กล้องรองรับการตรวจจับละเมิด 13 ชนิด — เราใช้อยู่ 2**

`GET /ISAPI/Traffic/channels/1/illegalEventNotification` (คืน JSON แม้ header บอก xml)
· `TrafficCap.isSupportIllegalEventNotification` = `true` · **เหมือนกันทั้ง 16 กล้อง**

| `illegalType` | ความหมาย | สถานะ |
|---|---|---|
| `helmet` | ไม่สวมหมวกกันน็อก | ✅ **ใช้อยู่** — `helmetEnabled` เปิด 16/16 |
| `safeBelt` | ไม่คาดเข็มขัด | ✅ **ใช้อยู่** — `safetyBeltEnabled` เปิดแค่ 3/16 (C10-KAR-SB-04 · C4-CHL-SB-01 · C32-THL-SB-14) |
| `reverse` | **ขับย้อนศร** | ⬜ รองรับ แต่ไม่ได้เปิด |
| `banSign` | ฝ่าฝืนป้าย/เครื่องหมายห้าม | ⬜ รองรับ แต่ไม่ได้เปิด — **ใกล้เคียง "จอดในที่ห้ามจอด" ที่สุด** |
| `emergencyLane` | วิ่งไหล่ทาง/ช่องฉุกเฉิน | ⬜ |
| `busWay` | วิ่งช่องทางรถประจำทาง | ⬜ |
| `changeLane` | เปลี่ยนเลนผิดกฎ | ⬜ |
| `driveLine` | คร่อม/ทับเส้น | ⬜ |
| `overSpeed` / `lowSpeed` | เร็ว/ช้าเกินกำหนด | ⬜ |
| `twoWheelPassenger` | ซ้อนท้ายมอเตอร์ไซค์ | ⬜ (`twoWheelVehicleEnabled` เปิดอยู่แต่เป็นคนละชั้น) |
| `uphone` | ใช้โทรศัพท์ | ⬜ `uphoneEnabled` เปิด 3/16 · ยังไม่เคยพบ `yes` |
| `post` | ผ่านจุดตรวจ (ไม่ใช่ความผิด) | — |

> 🔵 **ไม่มี "จอดในที่ห้ามจอด" ตรง ๆ ในรายการ** — illegal parking ของ Hikvision เป็น IVS rule
> คนละตัว (กล้องจอดรถ/checkpoint) ไม่ใช่ ANPR ที่เรามี · ที่ใกล้ที่สุดคือ `banSign`
>
> ⚠️ `reverse` / `banSign` / `emergencyLane` ฯลฯ **ต้องตีเส้น/วางโซนหน้างานก่อน** ไม่ใช่แค่กดเปิดสวิตช์
> — งาน site survey ไม่ใช่งาน config อย่างเดียว · `notificationMethod` ว่างทั้ง 13 ชนิด
> (รวม `helmet`/`safeBelt` ที่ใช้งานได้อยู่) ⇒ ฟิลด์นี้**ไม่ได้บอกว่าเปิด/ปิด** ตัวจริงคือสวิตช์ใน `carFeatureParam`

**ข) `C32-THL-SB-14` เปิด face capture อยู่ — กล้องเดียวจาก 16**

| สวิตช์ | ความหมาย | C32-THL-SB-14 | อีก 15 ตัว |
|---|---|---|---|
| `hostFaceEnabled` | ตัดภาพใบหน้า**คนขับ** | ✅ true | false |
| `viceFaceEnabled` | ตัดภาพใบหน้า**ผู้โดยสารหน้า** | ✅ true | false |
| `faceDetectEnabled` | ตรวจจับใบหน้า | ✅ true | false |
| `nonMotorFaceEnabled` · `CarBodyFeature` | คนขี่มอเตอร์ไซค์ · body | false | false |

⇒ **`classifyImage()` (`lpr-core.js:106`) รู้จักแค่ scene/plate/composite → ภาพใบหน้าจาก C32
ตกเป็น `unknown` แล้วถูกทิ้งเงียบ ๆ ไม่มี log** · กล้องรุ่นนี้มีสวิตช์ face รวม **13 ตัว**
(รวมกลุ่มตรวจหน้ากาก `driverFaceMask*` / `passengerFaceMask*`) ปิดหมดทุกตัวที่เหลือ

> 🟡 **ยังพิสูจน์ไม่ได้ว่า C32 ส่งภาพใบหน้ามาจริงหรือไม่** — สวิตช์เปิดอยู่ (🔵) และโค้ดไม่มีทางรับ (🔵)
> แต่ไม่มี log ชื่อไฟล์ของ part ที่ถูกทิ้ง จึงยืนยันไม่ได้ · **ต้องเพิ่ม log 1 บรรทัดใน `classifyImage()`
> ก่อนถึงจะตอบได้** (log อย่างเดียว ไม่แตะ control flow — แต่อยู่บน ingest path ต้องขออนุมัติ)
>
> เกี่ยวโดยตรงกับงาน **Driver Face Capture** ที่ DEFERRED ไว้ 2026-07-01 (เหตุผลเดิม: ภาพหน้าฝนใช้ไม่ได้)
> — ตอนนี้มีกล้องที่เปิดอยู่แล้วให้ทดสอบ **ไม่ต้องไปแตะกล้องเพิ่ม**

#### 🔑 `faceImgOutputMode` — เงื่อนไขที่ขาด (พบ 2026-08-15)

เปิด `faceDetectEnabled` + `nonMotorFaceEnabled` + `CarBodyFeature` แล้ว **ไม่มีภาพออกมาเลย**
ต้นเหตุอยู่ที่ฟิลด์นี้ใน `carFeatureParam` › `OutputCtrl`:

| ค่า | ความหมาย | กล้อง | ผลจริง |
|---|---|---|---|
| `alarmUpload` | ส่งภาพใบหน้าเป็น **ไฟล์แยก** มากับ alarm | **C32-THL-SB-14 (1 ตัว)** | ✅ ได้ `pilotPicture.jpg` / `copilotPicture.jpg` 4,000+ ใบ/วัน |
| `overPic` | **วาดทับลงบนภาพ scene** ไม่ส่งไฟล์แยก | อีก 15 ตัว | ❌ 0 ใบ แม้เปิดสวิตช์ครบ |

⇒ ความสัมพันธ์ตรง 16/16 — **แต่ยังสรุปไม่ได้ว่าเป็นเหตุ** (ดูย่อหน้าถัดไป)

> 🔴 **ข้อสรุปนี้ถูก confound — อย่าเชื่อว่า `faceImgOutputMode` คือคำตอบเดียว**
> ตรวจซ้ำ (GET สดทั้ง 16 ตัว 2026-08-15) พบว่า **C32 ต่างจากอีก 15 ตัวถึง 8 ฟิลด์พร้อมกัน**
> และทุกตัวต่างแบบล็อกกัน 15/15: `hostFaceEnabled` · `viceFaceEnabled` · `faceImgOutputMode` ·
> `featureFaceOverlayEnabled` · `faceImgScale` (3 vs 1) · `faceImgRatio` (2 vs 1) ·
> `faceImgBrightenEnhenceEnabled` · `faceImgBrightenEnhenceLevel` (50 vs 0)
> ⇒ **n=1 แยกไม่ออกว่าตัวไหนคือเหตุ** · ผู้ต้องสงสัยอันดับต้นอาจเป็น
> `hostFaceEnabled`/`viceFaceEnabled` ด้วยซ้ำ (capabilities เรียกว่า `isSupportPilotFace`/
> `isSupportCopilotFace`) — ถ้าสองตัวนี้ false กล้องอาจไม่ผลิตภาพตั้งแต่ต้นทาง
> ไม่ว่า output mode จะเป็นอะไร
>
> **ตัดออกได้แล้ว** (เหมือนกันทั้ง 16): firmware `V5.3.1 build 260424` · `separatData=false` ·
> `faceDetectEnabled`/`nonMotorFaceEnabled`/`CarBodyFeature.enabled=true` · `DrawFaceRectEnabled=false`

**ค่าที่รองรับจริงมี 4 ไม่ใช่ 2** — `carFeatureParam/capabilities` ประกาศ
`<faceImgOutput opt="none,overPic,alarmUpload,overPicAndAlarmUpload">`
· `overPicAndAlarmUpload` = ทำทั้งสองอย่าง ⇒ **ปลอดภัยกว่าสำหรับ migration** เพราะเปลี่ยนเป็น
`alarmUpload` เฉย ๆ จะทำให้ overlay บนภาพ scene หายไป (`faceImgOutputMode2/3` รองรับแค่ `none,overPic`)

#### ✅ ผลการทดลองแยกตัวแปร (2026-08-15) — ต้องมี **ทั้งสองอย่าง**

| กล้อง | `faceImgOutputMode` | `hostFace`/`viceFace` | ผล |
|---|---|---|---|
| C4-CHL-SB-01 | `overPic` | ✅ true | **0 ใบ** |
| C40-THL-SB-18 | `overPicAndAlarmUpload` | ✅ true | **47 ใบ ใน ~5 นาที** |
| C40 (รอบ 1) | `overPicAndAlarmUpload` | ❌ false | **0 ใบ ใน 6 นาที** (ขณะกล้องยังส่ง event ทุก 30 วิ) |
| C32-THL-SB-14 | `alarmUpload` | ✅ true | 5,785 ใบ/วัน |

⇒ **สูตรที่ถูกต้อง = `hostFaceEnabled`/`viceFaceEnabled` (ตัวผลิต) + `faceImgOutputMode` ที่มี
`alarmUpload` อยู่ในค่า (ตัวส่งออกเป็นไฟล์แยก)** · ขาดตัวใดตัวหนึ่ง = ไม่มีภาพ
· `overPic` = วาดทับบนภาพ scene เท่านั้น ไม่ส่งไฟล์ ยืนยันด้วย C4-CHL ที่เปิด host/vice แล้วยังได้ 0

> 🔵 **ทั้งสองสมมติฐานถูกครึ่งเดียว** — `faceImgOutputMode` จำเป็นแต่ไม่พอ ·
> `hostFace`/`viceFace` ก็จำเป็นแต่ไม่พอ · ต้องมีคู่กัน

#### ⚠️ คุณภาพครอปยังไม่ได้ — ต้องตั้ง 2 ฟิลด์เพิ่ม

ภาพจาก C40 ออกมาจริงแต่ **ครอปผิดที่และเล็กมาก** (3–7 KB · สุ่มดูได้หญ้า/ไฟหน้ารถ ไม่ใช่หน้าคน)
เทียบกับ C32 ที่ได้หน้าคนชัด (สูงสุด 13 KB) — ต่างกันที่:

| ฟิลด์ | C32 (ใช้ได้) | C40 (ครอปเพี้ยน) |
|---|---|---|
| `faceImgScale` | **3** | 1 |
| `faceImgRatio` | **2** | 1 |
| `faceImgBrightenEnhenceLevel` | **50** | 0 |
| `featureFaceOverlayEnabled` | **true** | false |

ทดลองแล้ว: ตั้งครบทั้ง 5 ฟิลด์ให้ตรง C32 บน C40 → **ครอปยังผิดที่เหมือนเดิม** (ได้หญ้า/ไฟหน้ารถ)
· ตัวคุมเวลาเดียวกัน (18:19 น.) C32 ยังได้หน้าคนชัด ⇒ **ไม่ใช่เรื่องแสง ไม่ใช่เรื่องค่าตั้ง
แต่เป็นมุมกล้อง/ฉากของแต่ละจุด** — ต้องประเมินรายกล้อง เปิดหว่านไม่ได้

#### 🔴 หน้าคนขี่มอเตอร์ไซค์ — ส่งเป็นไฟล์แยกไม่ได้บนรุ่นนี้

วัดจาก 800 event (ตอนเปิดแค่ 2 กล้อง) และวัดซ้ำหลัง **rollout สูตรเต็มครบ 15 กล้อง**:

| รอบวัด | ชนิดรถ | event | มีภาพใบหน้ามาด้วย |
|---|---|---|---|
| ก่อน rollout | **มอเตอร์ไซค์** | 300 | **0** |
| ก่อน rollout | รถอื่น | 500 | 29 (5.8%) |
| **หลัง rollout 15 กล้อง** | **มอเตอร์ไซค์** | 276 | **1 (0.4%)** |
| **หลัง rollout 15 กล้อง** | รถอื่น | 424 | **35 (8.3%)** |

⇒ **เปิดครบทุกกล้องแล้วยืนยันผลเดิม — ต่างกัน ~10–20 เท่า** ไม่ใช่เรื่องกล้องตัวใดตัวหนึ่ง

> ⚠️ **แก้ถ้อยคำ (19:20 น.):** ที่เขียนไว้ตอนแรกว่า "ส่งหน้าคนขี่เป็นไฟล์ไม่ได้" **แรงเกินไป**
> วัดซ้ำหลัง rollout ได้ **1.4%** (74 event → 1 ใบ) และเมื่อกรองเก็บเฉพาะ `twoWheelVehicle`
> ได้จริง **24 ใบใน ~15 นาที ตอนกลางคืน** จาก 6 กล้อง ⇒ **มาจริงแต่หายาก ไม่ใช่ศูนย์**
> ประเมินคร่าว ๆ ทั้งวันน่าจะได้ระดับ ~2,000 ใบ ซึ่งพอเป็นชุดข้อมูลได้
> · ยังไม่ทราบว่าอัตราต่ำเพราะข้อจำกัดของรุ่น หรือเพราะตรวจจับหน้าคนสวมหมวกกันน็อกยาก

**เหตุผลที่น่าจะเป็น** — capabilities ประกาศช่อง output ของภาพใบหน้าไว้ 3 ช่อง:

| ช่อง | ค่าที่รองรับ | ส่งเป็นไฟล์แยกได้ไหม |
|---|---|---|
| `faceImgOutput` (หลัก) | `none,overPic,alarmUpload,overPicAndAlarmUpload` | ✅ ได้ — ใช้กับ pilot/copilot |
| `faceImgOutputMode2` | `none,overPic` | ❌ **วาดทับได้อย่างเดียว** |
| `faceImgOutputMode3` | `none,overPic` | ❌ **วาดทับได้อย่างเดียว** |

⇒ 🟡 **สมมติฐาน (ยังไม่พิสูจน์):** ช่อง 2/3 คือช่องของใบหน้ากลุ่มอื่นรวมถึงคนขี่มอเตอร์ไซค์
ซึ่ง**ไม่มี `alarmUpload` ให้เลือก** ⇒ หน้าคนขี่ถูกวาดลงบนภาพ scene ได้อย่างเดียว
ส่งเป็นไฟล์แยกไม่ได้ · สอดคล้องกับ `isSupportNonmotorface=true` (ตรวจจับได้)
คู่กับ `isSupportNonmotorFaceSelect=false` และผลวัด 300→0

> **ทางออกที่เหลือถ้าต้องการหน้าคนขี่:** เราเก็บภาพ scene เต็มเฟรมอยู่แล้ว (~1 MB/ใบ)
> และ edge มี `face-engine` รันอยู่แล้วใน pm2 ⇒ **ตรวจจับใบหน้าเองจากภาพ scene**
> เฉพาะ event ที่ `vehicleType=twoWheelVehicle` น่าจะตรงเป้ากว่าการรอฟีเจอร์กล้อง

#### 🔴 `vehicleSubBrandEnabled` — สวิตช์รับค่าได้ แต่ฮาร์ดแวร์ไม่รองรับ

`carFeatureParam/capabilities` ประกาศตรง ๆ ว่า **`<isSupportVehicleSubBrand>false</...>`**
ทั้งที่เราเปิด `vehicleSubBrandEnabled=true` ครบ 16 ตัวเมื่อ 2026-08-15 (PUT 200 + อ่านกลับ true ทุกตัว)

> ⚠️ **บทเรียน: PUT 200 + อ่านกลับ `true` พิสูจน์แค่ว่า "สวิตช์เก็บค่าได้" ไม่ได้พิสูจน์ว่า
> "ฟีเจอร์ทำงาน"** — ตรงกับที่วัดได้: `vehileSubLogoRecog` = `0` ครบ 7,543 ตัวอย่าง
> · อาการเดียวกับ `faceDetectEnabled` ที่เปิดอยู่แต่เงียบ
> ⇒ **ก่อนจะบอกว่าเปิดฟีเจอร์สำเร็จ ต้องเช็ค `isSupport*` ใน capabilities ก่อนเสมอ**
> แล้วยืนยันด้วยข้อมูลจริงที่ไหลออกมา ไม่ใช่ด้วยค่าที่อ่านกลับ

**ค) `vehicleSubBrandEnabled` เปิดอยู่ 12/16 (ก่อนหน้าเรา)** ⇒ `vehicleSublogo` (รุ่นย่อยรถ) ที่เดิมเขียนว่า
"ยังสรุปไม่ได้" **กล้องส่งมาจริง** แต่เราไม่ได้อ่าน — อยู่เลยจุดตัด 2,000 ตัวอักษรเช่นกัน

#### เทียบกับเอกสารทางการ Hikvision (ค้นภายนอก 2026-08-15)

แหล่งสาธารณะที่ใกล้เคียงที่สุดคือ [`XML_Metadata_ANPR`](http://enpinfo.hikvision.com/unzip/20201110210551_77443_doc/GUID-9A02D489-BED3-4F11-BE4E-BFF5233AB959.html)
· ISAPI ฉบับเต็มต้องเซ็น Material License Agreement กับผู้ผลิตก่อนถึงจะได้

**🔵 ผลเทียบ:** เอกสารทางการระบุไว้ **12 ฟิลด์** · จาก 54 แท็กที่กล้องเราส่งจริง
**48 ตัวไม่มีอยู่ในเอกสารทางการเลย** — รวมถึงกลุ่มพฤติกรรมผู้ขับทั้งหมด
(`helmet` `pilotsafebelt` `uphone` `smoking` `illegalCode` ฯลฯ)
⇒ **§15/§15.1 คือเอกสารชุดเดียวที่เรามีสำหรับฟิลด์เหล่านั้น** — ห้ามลบ ห้ามย่อ

#### 🔴 `raw_json.rawXml` ที่เก็บไว้เป็นแค่ 2,000 ตัวอักษรแรก — ไม่ใช่ XML ฉบับเต็ม

`lpr-core.js:435` เก็บ `xmlStr.slice(0, 2000)` · วัดจาก 5,000 event ล่าสุด:
**ยาว 2,000 เป๊ะทุกใบ (100%) และลงท้ายกลางแท็ก** (`…<detectType>2</detectType>\r<barrierGat`)

⇒ **54 แท็กที่สำรวจได้คือเท่าที่มองเห็นในหน้าต่าง 2,000 ตัวอักษร ไม่ใช่ทั้งหมดที่กล้องส่ง**

**หลักฐานตรง ๆ:** มี 4 แท็กที่ `parseHikXml()` อ่านจาก `xmlStr` (ฉบับเต็ม ก่อนถูกตัด) ได้สำเร็จ
และมีข้อมูลใน DB จริง แต่**ไม่ปรากฏในหน้าต่างที่เก็บไว้เลยสักครั้งใน 5,000 event**:

| แท็ก | โค้ดที่อ่าน | ปลายทาง | ข้อมูลจริง (30 วัน, `iDS-2CD9396-HIS`) |
|---|---|---|---|
| `color` | `lpr-core.js:217` | `license_plates.vehicle_color` | **3,447,597 แถว** (58%) |
| `vehicleLogoRecog` | `lpr-core.js:218` → `resolveHikBrand()` | `license_plates.vehicle_brand` | **3,447,597 แถว** — Toyota 2.6M · Honda 876k · Isuzu 512k (ทั้งระบบ) |
| `laneNo` | `lpr-core.js` | — | อยู่เลยจุดตัด |
| `provinceName` | `lpr-core.js` | — | อยู่เลยจุดตัด |

> ⚠️ **บทเรียนต่อยอด:** สำรวจ `rawXml` แล้วสรุปว่า "กล้องไม่ส่งฟิลด์นี้" **ทำไม่ได้** —
> ต้องอ่านว่า "ไม่อยู่ใน 2,000 ตัวอักษรแรก" เท่านั้น · เกือบสรุปผิดในรายงาน 2026-08-15 ว่า
> `vehicleColor`/`vehicleLogo` เป็นฟีเจอร์ที่ขาด ทั้งที่ใช้งานอยู่แล้ว 3.4M แถว
>
> **ผลกระทบจริง:** ฟีเจอร์ที่อยู่ปลาย XML **ขุดย้อนหลังไม่ได้เลย** (ต่างจาก `illegalCode`
> ที่อยู่ต้น ๆ จึงกู้ย้อนหลังได้) · ถ้าจะสำรวจว่ามีอะไรอีก **ต้อง log XML ฉบับเต็มสัก 1 ใบก่อน**
> — อยู่บนเส้นทาง ingest จริง ต้องขออนุมัติก่อนทำ (WA#3 ข้อ 4)

**ฟิลด์ตามเอกสารทางการที่ยังสรุปไม่ได้** — `directionIndex`, `vehicleConfidence`
ไม่พบในหน้าต่าง 2,000 ตัวอักษร แต่**พิสูจน์ไม่ได้ว่าไม่มี** ด้วยเหตุผลข้างบน
(`vehicleSublogo` ตัดออกจากรายการนี้แล้ว — probe 2026-08-15 พบ `vehicleSubBrandEnabled`
เปิดอยู่ 12/16 กล้อง ⇒ **กล้องส่งมาจริง** ดู §15.1.1 ข้อ ค)
(`vehicleColor`/`vehicleLogo` = มีอยู่แล้ว ดูตาราง) · `confidence` ในเอกสารทางการ
**สันนิษฐาน**ว่าคือ `confidenceLevel` ที่เราใช้อยู่ ยังไม่ได้ยืนยัน

**สิ่งที่ค้นแล้วไม่พบ** (บันทึกไว้กันค้นซ้ำ):
- `pdvs` — ไม่มีทั้งในเอกสารผู้ผลิตและกระทู้ชุมชน ⇒ ปิดเรื่อง
- **ตารางแปล `plateType` ฉบับผู้ผลิต** — เอกสารทางการเขียนแค่ "string, license plate types"
  และตัวอย่างเป็นข้อความ (`arm`) แต่กล้องเราส่ง**เลข** (probe พบ 1, 3, 6, 12, 21, 32, 34) ·
  ไม่มีตารางแปลเผยแพร่ที่ไหน ⇒ **ตารางใน §15 บรรทัด `plateType` เป็นของที่เราถอดเอง
  ไม่มีแหล่งอ้างอิงภายนอกยืนยัน** — ใช้ได้แต่อย่าอ้างว่าเป็นสเปกผู้ผลิต
  · หมายเหตุ: สัดส่วนใน §15 (1→41%, 12→17%) **เก่าแล้ว** — probe 2026-08-15 ได้
  12→47.2%, 1→25.3% (มอเตอร์ไซค์แซงรถยนต์)
- `tailandStateID` (รหัสจังหวัด) และ code ยี่ห้อรถ — ไม่มีเอกสารสาธารณะเช่นกัน

---

## 14. Related Files

| ไฟล์ | Role |
|---|---|
| `src/ingesters/hikvision-isapi.js` | Main ingester (I/O, DB, multipart, face, body, people counting) |
| `src/helpers/digestAuth.js` | HTTP Digest auth (shared กับ Dahua) |
| `src/media-recorder.js` | RTSP buffer → 1s .ts segments |
| `src/alert-engine.js` | LINE alert pipeline (vendor-agnostic) |
| `src/routes/appearances.js` | Appearance search/stats API |
| `src/routes/faces.js` | Face match API + body appearance fields |
| `dashboard/page-face-matches.js` | Face match modal — `_matchBodyChips`, `_colorChipBg` |
| `dashboard/page-appearance.js` | Appearance search — `_buildAppChips`, `_colorBgByName` |
| `dashboard/page-snapshots.js` | Snapshot page — `_COLOR_HEX` (var, shared via window), `_colorChipBg` |
| `db/db_migration_046_normalize_appearance_case.sql` | One-time normalize historical Hikvision body rows |
| `cameras-config.json` | Source of truth camera list |
| `docs/LOGIC_camera-ingesters.md` | Shared multi-vendor decisions (#114–116, #121) |
| `docs/REF_face-recognition.md` | Face Recognition roadmap (FR.1–4) |
| `GOTCHAS.md` | Known pitfalls (#41, #57, #58, #62, #63, #67, #75) |
