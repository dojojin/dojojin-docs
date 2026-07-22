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
| `illegalCode` | รหัสการฝ่าฝืน | 0=ปกติ, ≠0=มีความผิด | ❌ ยังไม่เก็บ | 0 ทุก event (76,333 records) — กล้องยังไม่ถูก config violation detection |
| `illegalName` | ชื่อการฝ่าฝืน | "Normal" / "Speeding" / "RedLight" | ❌ ยังไม่เก็บ | "Normal" ทุก event |
| `illegalDescription` | คำอธิบาย (มักว่าง) | string | ❌ ไม่เก็บ | ว่างทุก event |

#### กลุ่ม 5 — พฤติกรรมผู้ขับขี่

> ⚠️ **กล้องส่องหลังรถ** — มุมมองไม่เห็นคนขับในห้องโดยสาร
> field กลุ่มนี้ส่วนใหญ่ `unknown` ยกเว้น `helmet` และ `nonMotorManned` ที่เห็นจากด้านหลังมอเตอร์ไซค์ได้

| XML Field | ความหมาย | ค่าที่เป็นไปได้ | เก็บใน DB | ค่าจริงใน DB |
|---|---|---|---|---|
| `helmet` | ผู้ขับมอเตอร์ไซค์ใส่หมวกกันน็อคไหม | yes/no/unknown | ✅ `raw_json.helmet` | **no=3,967** / yes=9,802 / unknown=รถยนต์ |
| `nonMotorManned` | มีคนซ้อนท้ายมอเตอร์ไซค์ไหม | yes/no/unknown | ✅ `raw_json.nonMotorManned` | **yes=2,751** / no=11,018 / unknown=รถยนต์ |
| `uphone` | คนขับใช้โทรศัพท์ | yes/no/unknown | ✅ `raw_json.uphone` | yes=0 / no=13,864 / unknown=มอเตอร์ไซค์ — ไม่เคย fire เพราะมุมกล้อง |
| `pilotsafebelt` | คนขับคาดเข็มขัดนิรภัย | on/off/unknown | ✅ `license_plates.no_seatbelt` (boolean) | Parsed at ingest (src/lpr-core.js, migration 073); `belt=no` filter uses this column |
| `vicepilotsafebelt` | ผู้โดยสารด้านหน้าคาดเข็มขัด | on/off/unknown | ✅ `license_plates.no_seatbelt` (boolean) | Parsed at ingest; combined with `pilotsafebelt` |
| `smoking` | คนขับสูบบุหรี่ | yes/no/unknown | ❌ ไม่เก็บ | **unknown ทุก event** |
| `playMobilePhone` | คนขับเล่นโทรศัพท์ | yes/no/unknown | ❌ ไม่เก็บ | **unknown ทุก event** |
| `pilotsunvisor` | คนขับดึงบังแดด | yes/no/unknown | ❌ ไม่เก็บ | **unknown ทุก event** |
| `vicepilotsunvisor` | ผู้โดยสารดึงบังแดด | yes/no/unknown | ❌ ไม่เก็บ | **unknown ทุก event** |
| `nonMotorMask` | คนขับมอเตอร์ไซค์ใส่หน้ากาก | yes/no/unknown | ❌ ไม่เก็บ | unknown (ไม่ reliable จากมุมหลัง) |
| `pilotmask` | คนขับรถยนต์ใส่หน้ากาก | yes/no/unknown | ❌ ไม่เก็บ | **unknown ทุก event** |
| `vicepilotMask` | ผู้โดยสารด้านหน้าใส่หน้ากาก | yes/no/unknown | ❌ ไม่เก็บ | **unknown ทุก event** |
| `frontChild` | มีเด็กนั่งที่นั่งหน้า | yes/no/unknown | ❌ ไม่เก็บ | **unknown ทุก event** |
| `nonMotorShedUmbrella` | คนขับมอเตอร์ไซค์กางร่ม | yes/no/unknown | ❌ ไม่เก็บ | unknown |

#### กลุ่ม 6 — ของในรถ / ป้ายรถ

| XML Field | ความหมาย | ค่าที่เป็นไปได้ | เก็บใน DB | หมายเหตุ |
|---|---|---|---|---|
| `dangmark` | ป้ายสินค้าอันตราย (hazmat) | yes/no/unknown | ❌ ไม่เก็บ | unknown ทุก event ที่ probe |
| `envprosign` | ป้ายมาตรฐานไอเสีย | yes/no/unknown | ❌ ไม่เก็บ | unknown ทุก event |
| `pendant` | ของห้อยหน้ากระจก | yes/no/unknown | ❌ ไม่เก็บ | มองจากหลังไม่เห็น |
| `tissueBox` | กล่องทิชชู่ | yes/no/unknown | ❌ ไม่เก็บ | มองจากหลังไม่เห็น |
| `perfumeBox` | น้ำหอมในรถ | yes/no/unknown | ❌ ไม่เก็บ | มองจากหลังไม่เห็น |
| `decoration` | ของตกแต่งในรถ | yes/no/unknown | ❌ ไม่เก็บ | มองจากหลังไม่เห็น |
| `label` | สติกเกอร์บนรถ | yes/no/unknown | ❌ ไม่เก็บ | unknown ทุก event |
| `pdvs` | Passenger display system | yes/no/unknown | ❌ ไม่เก็บ | unknown ทุก event |

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
| `illegalCode` / `illegalName` | ตอนนี้ 0 ทั้งหมด แต่ถ้า config violation จะได้ค่าทันที | เล็ก — เพิ่ม column + เก็บใน raw_json |
| `smoking` / `playMobilePhone` / `pilotmask` ฯลฯ | **ไม่คุ้ม** — unknown ทุก event เพราะกล้องส่องหลังรถ | — |

---

### LPR API & Visibility

The `/api/lpr` search endpoint uses **keyset pagination** (decision #211) with `before_time` + `before_id` cursors for stable cursor-based navigation (no OFFSET). The LPR overview dashboard includes two new Top-10 charts:
- `pcolor[]` — license plate color distribution
- `brand[]` — vehicle brand Top-10 (vehicle_brand codes from ingester parsing)

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
