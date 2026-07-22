# LOGIC_dahua-ingester — Dahua CGI Event Ingester

> บันทึกครบวงจรสำหรับ `src/ingesters/dahua-cgi.js` และ module ที่เกี่ยวข้อง
> เป้าหมาย: AI agent อ่านไฟล์นี้แล้ววิเคราะห์หรือต่องานได้ทันที ไม่ต้องไล่อ่านโค้ดใหม่ทั้งหมด
> Last updated: 2026-06-18

---

## สารบัญ

1. [ภาพรวม Architecture](#1-ภาพรวม-architecture)
2. [Transport: eventManager CGI stream](#2-transport-eventmanager-cgi-stream)
3. [Event Map & Normalization](#3-event-map--normalization)
4. [Snapshot Waterfall (5 ระดับ)](#4-snapshot-waterfall-5-ระดับ)
5. [Pure Helper Modules](#5-pure-helper-modules)
6. [Test Coverage](#6-test-coverage)
7. [Configuration Fields](#7-configuration-fields)
8. [Constants อ้างอิง](#8-constants-อ้างอิง)
9. [ปัญหาที่พบและวิธีแก้ (Incident Log)](#9-ปัญหาที่พบและวิธีแก้-incident-log)
10. [GOTCHAS References](#10-gotchas-references)
11. [งานที่ยังค้างอยู่](#11-งานที่ยังค้างอยู่)
12. [Related Files](#12-related-files)

---

## 1. ภาพรวม Architecture

```
กล้อง Dahua
  │
  │  GET /cgi-bin/eventManager.cgi?action=attach&codes=[...]
  │  (long-lived HTTP connection, Digest auth)
  │  body: multipart/x-mixed-replace stream
  │
  ▼
dahua-cgi.js (PM2 worker: dahua-cgi, max:3)
  │
  ├── parseDahuaEventText()         ← dahua-protocol.js (pure)
  ├── parseSnapManagerCode()        ← dahua-protocol.js (pure)
  │
  ├── Snapshot waterfall
  │    ├── waitForEventSnapshot()   ← snapManager companion stream
  │    ├── extractBestFrameFromBuffer()   ← burst 11 frames, score
  │    ├── extractScanFrameFromBuffer()   ← scan ±30s segments [NEW 2026-06-18]
  │    ├── extractFrameFromBuffer()       ← dumb single frame
  │    └── captureFrame()                ← CGI live snapshot.cgi
  │
  ├── INSERT events (shared table, vendor-tagged)
  ├── pg_notify('new_event')        ← WS bridge picks up
  ├── pg_notify('event_for_clip')   ← media-recorder dumps clip
  └── alertEngine.onEvent()         ← LINE alert pipeline
```

**Design principle:** ingester normalise event เข้า shared `events` table ใช้ vocabulary เดียวกับ Bosch — dashboard/alerts/stats ไม่ต้องรู้ vendor

**Worker:** `application_name: 'dahua'`, pool max 3 connections, `SET TIME ZONE 'UTC'` on connect

**Singleton guard:** `require('../singleton')('dahua-cgi')` — ป้องกัน PM2 restart ซ้อน process

---

## 2. Transport: eventManager CGI stream

### Connection

```
GET /cgi-bin/eventManager.cgi?action=attach&codes=[CrossLineDetection,CrossRegionDetection,...]
Host: <ip>
Authorization: Digest ...   (two-step: 401 → re-request with computed header)
```

**ต้อง list codes ชัดเจน:** `codes=[All]` คืนแค่ Heartbeat + system events ไม่รวม VCA (GOTCHAS #39a)

**Reconnect:** exponential backoff `RECONNECT_BASE_MS = 5000` → `RECONNECT_MAX_MS = 30000`
`EHOSTUNREACH` / `ENETUNREACH` → ไม่ backoff ยาว (กล้อง offline ชั่วคราว — reconnect ปกติ)

### snapManager companion stream

`GET /cgi-bin/snapManager.cgi?action=attachFileProc&channel=1&heartbeat=5`

เปิดคู่กับ eventManager เพื่อรับ event JPEG จากกล้อง (บางรุ่นส่งมาพร้อม event) ใช้เป็น level 1 ของ waterfall

**ข้อจำกัด:**
- กล้องที่ไม่มี SD card อาจ stream ว่าง
- Node HTTP parser reject response headers ของ snapManager บางรุ่น ("Invalid header token") — แม้ใช้ `insecureHTTPParser` (GOTCHAS #39c)
- ถ้าไม่ได้ JPEG ภายใน `SNAP_EVENT_WAIT_MS = 1200` ms → waterfall ต่อขั้นถัดไป

### Heartbeat (last_seen_at)

`UPDATE cameras SET last_seen_at=NOW()` ทุกครั้งที่รับ event text (รวม Heartbeat line)
ทำให้ Health Check เห็นกล้อง online แม้ไม่มี VCA event นาน

---

## 3. Event Map & Normalization

### DAHUA_EVENT_MAP (ใน dahua-protocol.js)

| Dahua code | event_type | rule_name |
|---|---|---|
| `CrossLineDetection` | `LineDetector/Crossed` | Line Crossing |
| `CrossRegionDetection` | `FieldDetector/ObjectsInside` | Intrusion Detection |
| `LeftDetection` | `ObjectLeft` | Unattended Object |
| `TakenAwayDetection` | `ObjectRemoval` | Object Removal |
| `SmartMotionHuman` | `SmartMotion/Human` | Smart Motion (Human) |
| `SmartMotionVehicle` | `SmartMotion/Vehicle` | Smart Motion (Vehicle) |
| `VideoBlind` | `TamperDetection` | Camera Tampering |

**Unmapped codes:** บันทึก `last_seen_at` แล้วผ่าน (ไม่ INSERT event) — `last_seen_at` ต้องอัปเดตเสมอแม้ไม่ได้ map

### DAHUA_CLASS — object class mapping

| Dahua ObjectType | normalized |
|---|---|
| `Human` | `Person` |
| `Vehicle` | `Vehicle` |
| `NonMotor` | `Vehicle` |
| (อื่นๆ) | ส่งผ่าน unchanged |

### raw_json structure

```json
{
  "vendor": "dahua",
  "code": "CrossRegionDetection",
  "action": "Start",
  "index": 0,
  "data": {
    "Direction": "Enter",
    "Object": {
      "ObjectID": 42,
      "ObjectType": "Human",
      "BoundingBox": [3000, 2000, 5000, 6000]
    }
  },
  "_snapshot": "DAHUA_CAM01_12345_1718600000000.jpg",
  "_snapshot_source": "dahua-rtsp-buffer-best",
  "_snapshot_status": "ok",
  "_snapshot_debug": { "strategy": "...", "confidence": 72.4, ... }
}
```

### dedup

`_dedup` Map keyed by `${cameraId}|${code}` — collapse repeats ภายใน `DEDUP_WINDOW_MS = 3000` ms

**dedupKey:** `${code}|${objectId}|${direction}` — Enter/Leave ของ object เดียวกันได้ key ต่างกัน ป้องกันทิ้ง Leave ทับ Enter

---

## 4. Snapshot Waterfall (5 ระดับ)

### ลำดับ (เรียงตาม priority)

```
1. snapManager event JPEG          → snapSource: 'dahua-event-snapshot'
   ↓ ถ้าไม่ได้ภายใน SNAP_EVENT_WAIT_MS

2. RTSP buffer burst (11 frames)   → snapSource: 'dahua-rtsp-buffer-best'
   ↓ ถ้า candidates = 0

3. RTSP buffer scan (±30s)         → snapSource: 'dahua-rtsp-buffer-scan'   [NEW]
   ↓ ถ้าไม่มี closed segment ใน window

4. Single RTSP fallback            → snapSource: 'dahua-rtsp-buffer'
   ↓ ถ้า segment ไม่พร้อม

5. CGI live (snapshot.cgi)         → snapSource: 'dahua-cgi-live'
```

ระดับ 3–5 ได้ `snapshotStatus = 'low_confidence'` → clip resolver จะ upgrade ให้เมื่อ clip_done มาถึง

### Level 1: snapManager event JPEG

`waitForEventSnapshot(cameraId, code, startMs)` — รอ cache ที่ snapManager ส่งมาก่อน
timeout: `SNAP_EVENT_WAIT_MS = 1200` ms

### Level 2: RTSP buffer burst (`extractBestFrameFromBuffer`)

**Algorithm:**
1. สร้าง candidate times จาก `SERVER_ANCHOR_FRAME_OFFSETS_MS` รอบ server receive time
   `[-4000, -2000, -1000, 0, 1000, 2000, 3000, 5000, 7000, 10000, 12000]` ms
2. แต่ละ offset → `extractFrameCandidateFromBuffer()` → รอ segment ปิด → ffmpegFrame
3. Score แต่ละ candidate:
   - `rawScore` = `scoreFrameForObject()` (pixel stdev ใน ROI)
   - `motionScore` = `scoreFrameMotion()` vs baseline frame (pixel diff ใน ROI)
   - `timingPenalty` = `|offset| / 1200`
   - `score` = `(motionScore × 8) + (rawScore / 20) − timingPenalty`
4. `chooseBestSnapshotCandidate()` — near-best band + closer-to-anchor tiebreak
5. `low_confidence` เมื่อ `score < SNAPSHOT_CONFIDENCE_THRESHOLD (45)` หรือ `edge_risk.triggered`

**Segment close detection (สำคัญ — ดู Incident #2):**
```js
let segClosed = segs[segs.length - 1] > pick;   // fast path: มี segment ใหม่กว่า
if (!segClosed) {
  segClosed = Date.now() - fs.statSync(segPath).mtimeMs > SEGMENT_CLOSE_AGE_MS; // 2000ms
}
```

### Level 3: RTSP buffer scan (`extractScanFrameFromBuffer`) [เพิ่ม 2026-06-18]

ใช้เมื่อ burst คืน `candidates = 0` (buffer sparse / camera เพิ่ง reconnect)

**Algorithm:**
1. `readdirSync` directory → filter `.ts` → sort → `selectScanSegments(segs, eventSec, 30, 5)`
2. เลือก segments ที่ `|seg − eventSec| ≤ 30` เรียงจากใกล้ที่สุด, cap 5
3. แต่ละ segment: ตรวจ `segClosed` (same mtime logic) → ffmpegFrame → scoreFrameForObject
4. เลือก frame ที่ score สูงสุด

**Constants:** `SCAN_WINDOW_SEC = 30`, `SCAN_MAX_SEGS = 5`

### Level 4: Single RTSP fallback (`extractFrameFromBuffer`)

`snapshotTargetTs(cam, data)` คำนวณ target timestamp จาก event data
ไม่มีการ score ทำให้ได้ภาพที่อาจไม่ตรงเหตุการณ์

### Level 5: CGI live (`captureFrame`)

`GET /cgi-bin/snapshot.cgi?channel=1` — digest auth พร้อม cache nonce
ภาพมาช้ากว่า event เสมอ — ไม่ควรใช้เป็นหลัก

### Clip Resolver (async upgrade)

หลัง waterfall เสร็จ → `pg_notify('event_for_clip')` → media-recorder dump clip → `clip_done` notify →
`resolveDahuaSnapshotFromClip()` เลือกภาพจาก clip ที่ดีกว่า → upgrade snapshot ถ้า status `low_confidence/missing/failed`

**Clip resolver gate:** upgrade ถ้า status ∈ `['low_confidence', 'missing', 'failed']`
หรือ source ∈ `['dahua-rtsp-buffer', 'dahua-cgi-live']` (unreliable sources)

---

## 5. Pure Helper Modules

### `src/ingesters/dahua-protocol.js` [สร้าง 2026-06-17, commit 1aeb94d]

ไม่มี I/O ไม่มี DB ไม่มี singleton — import ใน test ได้ทันที

**Exports:**
- `DAHUA_EVENT_MAP` — code → { event_type, rule_name }
- `DAHUA_CLASS` — Dahua ObjectType → normalized class
- `parseDahuaEventText(text)` — parse CGI event text → `{ code, action, index, data, mapping, dedupKey }`
- `parseSnapManagerCode(text)` — parse snapManager text → code string (หรือ null ถ้า unmapped)
- `extractObjectClass(data)` — ดึง object class จาก event data

### `src/ingesters/dahua-snapshot-selector.js` [สร้าง 2026-06-17, commit 8fc5078; ขยาย 2026-06-18, commit 0731ca6]

dep เดียวคือ `sharp` — import ใน test ได้

**Exports:**
| Symbol | ประเภท | คำอธิบาย |
|---|---|---|
| `SNAPSHOT_DEBUG_MAX_CANDIDATES` | const (12) | จำนวน candidates สูงสุดใน debug log |
| `SNAPSHOT_CONFIDENCE_THRESHOLD` | const (45) | คะแนน min สำหรับ high confidence |
| `SNAPSHOT_NEAR_BEST_MIN_DELTA` | const (8) | near-best band ขั้นต่ำ |
| `SNAPSHOT_NEAR_BEST_RATIO` | const (0.08) | near-best band สัดส่วน |
| `SNAPSHOT_EDGE_RISK_MARGIN` | const (0.02) | margin ratio สำหรับ edge detection |
| `SCAN_WINDOW_SEC` | const (30) | window สำหรับ scan fallback |
| `SCAN_MAX_SEGS` | const (5) | จำนวน segment สูงสุดที่ scan |
| `eventBoundingBox(data)` | fn | ดึง BoundingBox array (4 numbers) หรือ null |
| `eventBoxEdgeRisk(data)` | fn | ตรวจ bbox ชิดขอบ frame → { triggered, edges } |
| `frameRoi(meta, data, padRatio)` | fn | คำนวณ ROI rect สำหรับ sharp.extract() |
| `scoreFrameForObject(buf, data)` | async fn | score ภาพด้วย pixel stdev ใน ROI |
| `scoreFrameMotion(buf, baseline, data)` | async fn | score motion diff ระหว่าง 2 frames |
| `chooseBestSnapshotCandidate(cands)` | fn | เลือก best จาก near-best band + anchor proximity |
| `selectScanSegments(segs, eventSec, window, maxN)` | fn | กรอง+เรียง segment สำหรับ scan fallback |

---

## 6. Test Coverage

| ไฟล์ | Tests | สิ่งที่ครอบ |
|---|---|---|
| `test/dahua-parser.test.js` | 21 | parseDahuaEventText, parseSnapManagerCode, extractObjectClass, DAHUA_EVENT_MAP |
| `test/dahua-snapshot-selector.test.js` | 27 | eventBoundingBox, eventBoxEdgeRisk, frameRoi, scoreFrameForObject, scoreFrameMotion, chooseBestSnapshotCandidate, selectScanSegments |
| **รวม** | **48** | |

**Image-level discriminating tests:**
- `noisy ROI scores higher than flat grey ROI` — ยืนยัน scoreFrameForObject ใช้ visual detail จริง ไม่ใช่แค่ buffer size
- `different frames > identical frames` — ยืนยัน scoreFrameMotion detect pixel diff ได้จริง

**Run:**
```bash
node --test test/dahua-parser.test.js
node --test test/dahua-snapshot-selector.test.js
```

**หมายเหตุ sharp path:** sharp อยู่ใน `src/node_modules/` (ไม่ใช่ root) — test ต้องใช้ `require('../src/node_modules/sharp')`

---

## 7. Configuration Fields

ใน `cameras-config.json` สำหรับ `vendor: 'dahua'`:

| Field | Default | คำอธิบาย |
|---|---|---|
| `camera_id` | required | ASCII-clean identifier ห้ามมี invisible chars (#110) |
| `vendor` | `'dahua'` | trigger ingester routing |
| `ip_address` | required | กล้อง IP |
| `http_port` | `80` | port สำหรับ CGI endpoints |
| `username` / `password` | required | Digest auth credentials (ถูก encrypt ถ้าใช้ crypto-creds) |
| `snapshot_path` | `/cgi-bin/snapshot.cgi?channel=1` | path สำหรับ live CGI snapshot |
| `clip_stream` | `1` | stream index สำหรับ RTSP buffer (ต้องเป็น main stream ที่มี fps สูงพอ — ดู Incident #5) |
| `snapshot_stream` | (ไม่ใช้ใน Dahua) | Dahua ใช้ snapshot_path แทน |
| `dahua_server_frame_offsets_ms` | `SERVER_ANCHOR_FRAME_OFFSETS_MS` | override offsets สำหรับ burst (per-camera tuning) |
| `enable_clip_capture` | `false` | เปิด/ปิด clip capture |
| `enable_snapshot` | `true` | เปิด/ปิด snapshot |

---

## 8. Constants อ้างอิง

```js
RECONNECT_BASE_MS = 5_000       // base reconnect delay
RECONNECT_MAX_MS  = 30_000      // backoff ceiling
DEDUP_WINDOW_MS   = 3_000       // collapse repeated event text
EVENT_LOOKBACK_MS = 1_200       // fallback lookback
RTSP_FRAME_LOOKBACK_MS = 700    // pick frame before event timestamp
MAX_FUTURE_EVENT_MS = 6_000     // CGI text อาจมาก่อน RTSP frame
SNAP_EVENT_WAIT_MS = 1_200      // รอ snapManager JPEG
FRAME_WAIT_MS     = 3_000       // max wait สำหรับ segment flush
FRAME_WAIT_POLL_MS = 300        // re-check interval
SERVER_ANCHOR_FRAME_OFFSETS_MS = [-4000,-2000,-1000,0,1000,2000,3000,5000,7000,10000,12000]
SERVER_ANCHOR_MAX_FUTURE_MS = 12_000
SEGMENT_CLOSE_AGE_MS = 2_000   // mtime threshold สำหรับ segment closed
CLIP_RESOLVER_OFFSETS_SEC = [4,6,8,9,10,11,12,14,16]
CLIP_RESOLVER_STATUS_RETRY_MS = 1_500
CLIP_RESOLVER_STATUS_MAX_RETRIES = 30
SCAN_WINDOW_SEC = 30            // ใน dahua-snapshot-selector.js
SCAN_MAX_SEGS   = 5             // ใน dahua-snapshot-selector.js
```

---

## 9. ปัญหาที่พบและวิธีแก้ (Incident Log)

### Incident #1 — snapManager.cgi response headers ถูก Node reject (2026-05-21)

**อาการ:** `http.get` ของ snapManager stream throw "Invalid header token" แม้ใช้ `insecureHTTPParser: true`
**Root cause:** Dahua snapManager response มี header format ที่ Node HTTP parser ไม่ยอมรับทุก firmware รุ่น + กล้องที่ไม่มี SD card ไม่ส่ง JPEG เลย
**แก้:** ใช้ snapManager เฉพาะเป็น "bonus" fallback สำหรับรุ่นที่รองรับ; ไม่ depend on it, timeout 1.2s แล้วผ่านไป waterfall ต่อไป
**GOTCHAS #39c**

### Incident #2 — burst คืน candidates=0 แม้ buffer มี segment (2026-06-17, event 103109)

**อาการ:** DAHUA_CAM01 event 103109 (12:59:42) ได้ `candidates: []` ใน debug → ตกไป dumb single fallback → ภาพแย่
**Root cause:** guard เดิมต้องการ `segs[last] > pick` (segment ใหม่กว่าอยู่ใน buffer) ก่อนอ่าน segment เป้าหมาย เมื่อ segment ล่าสุดเป็นตัวที่ต้องการพอดี → guard false ทุก candidate
**แก้ (commit 8689855):** เพิ่ม mtime fallback — ถ้า ffmpeg ไม่ได้เขียน segment นั้นมา > 2 วินาที ถือว่าปิดแล้ว
```js
let segClosed = segs[segs.length - 1] > pick;
if (!segClosed) {
  segClosed = Date.now() - fs.statSync(segPath).mtimeMs > SEGMENT_CLOSE_AGE_MS;
}
```
**GOTCHAS #39** (ดูหัวข้อ 39e/f ด้วย — sub-stream fps และ segment กว้าง)

### Incident #3 — data.UTC เป็น local time ไม่ใช่ UTC (2026-05-21)

**อาการ:** timestamp ของ event คลาดเคลื่อน +7h ในไทย
**Root cause:** Dahua field `data.UTC` ส่ง local time ของกล้องในรูป unix timestamp (NOT UTC)
**แก้:** ใช้ server receive time เป็น anchor (`snapshotStartMs = Date.now()`) ไม่ใช้ `data.UTC` ตรงๆ
**GOTCHAS #39d**

### Incident #4 — Dahua firmware ใหม่ (realm 32-hex) Digest ล้มเหลว (2026-06-02)

**อาการ:** `has_snapshot = false` ทุก event; `/api/snapshot/live/:id` คืน 502; web UI login ยังใช้งานได้
**Root cause:** Dahua firmware ใหม่บางรุ่นใช้ realm format `Login to <32-hex MD5>` ซึ่งไม่ตรงกับ Digest formula เดิม
**แก้:** เปิด **Compatibility Mode** ในหน้า Camera Settings ของกล้อง (web UI → Security → CGI Service Authentication → ติ๊ก Compatibility Mode) → realm กลับเป็น format เดิม
**GOTCHAS #73**

### Incident #5 — sub-stream 1 fps ทำให้ clip/segment ใช้งานไม่ได้ (2026-05-21)

**อาการ:** ffmpeg segment ขนาด 0 bytes สำหรับกล้อง Dahua sub-stream บางตัว
**Root cause:** sub-stream ของ IPC-HFW5541E-ZE ถูก set เป็น 1 fps (vs main 12 fps); ffmpeg `-c copy` cut ได้แค่ที่ keyframe → 1 fps stream มี GOP หลายวินาที → segment 0 bytes
**แก้:** ตั้ง `clip_stream: 1` (main stream) ใน cameras-config.json เสมอ สำหรับ Dahua
**GOTCHAS #39f**

### Incident #6 — RTSP credential ถูก URL-encode ในชื่อ (2026-06-02)

**อาการ:** ffmpeg ได้ URL `rtsp://admin:enc%3Av1%3A...@ip/...` → 401 ทุก clip
**Root cause:** `dahua-cgi.js` decrypt credentials แต่ `media-recorder.js` ที่ build RTSP URL ลืม decrypt
**แก้:** เพิ่ม `decryptCamCreds(cam)` ใน media-recorder.js ก่อน build URL
**GOTCHAS #75**

### Incident #7 — LivePulse WS event มาก่อน snapshot save (2026-05-28)

**อาการ:** Live Pulse card ไม่มีภาพแม้ snapshot บันทึกสำเร็จ
**Root cause:** `pg_notify('new_event')` ถูกยิงก่อน snapshot UPDATE → WS event ถึง frontend โดย `snapshot_filename = NULL`
**แก้:** ย้าย `pg_notify('new_event')` ไปหลัง snapshot UPDATE block ครบ (ทุก path รวมถึง catch)
**GOTCHAS #58**

### Incident #8 — Smart Plan ไม่ active → connect สำเร็จแต่ไม่ได้ event (2026-05-21)

**อาการ:** eventManager attach OK, Heartbeat ไหล แต่ไม่มี VCA events เลย แม้ rule `Enable=true`
**Root cause:** กล้องต้องเปิด **Smart Plan** ใน AI settings ของกล้อง (`Setting → AI → Smart Plan`) ต่างหากจาก rule enable
**แก้:** เปิด Smart Plan ในกล้อง
**GOTCHAS #39e**

### Incident #9 — has_snapshot = false ทั้งที่ snapshot file มีอยู่ (2026-05-26)

**อาการ:** `WHERE has_snapshot = TRUE` คืน 0 rows
**Root cause:** ingesters เขียนแค่ `raw_json._snapshot` ไม่ได้เขียน column `snapshot_filename` / `has_snapshot`
**แก้:** migration 025 backfill + เพิ่ม column write ใน ingester ทุกตัว
**GOTCHAS #43**

---

## 10. GOTCHAS References

| # | หัวข้อ | ผลต่อ Dahua |
|---|---|---|
| #32 | Invisible chars ใน camera_id | `camera_id` ต้องผ่าน `_sanitizeCameraId()` ก่อน save |
| #39 | Dahua CGI quirks (ครบทุกข้อ a–f) | **อ่านก่อนแตะโค้ดทุกครั้ง** |
| #43 | has_snapshot column ว่าง | ใช้ `COALESCE(snapshot_filename, raw_json->>'_snapshot')` |
| #49 | uptime % ต่ำกว่าจริง | อย่าเขียน `enabled=TRUE` จาก ingester |
| #58 | WS event มาก่อน snapshot | pg_notify หลัง snapshot UPDATE เสมอ |
| #73 | Dahua realm 32-hex Digest fail | เปิด Compatibility Mode ในกล้อง |
| #75 | media-recorder ลืม decrypt creds | RTSP URL ต้อง decrypt ก่อนส่ง ffmpeg |
| #84 | macOS LNP / EHOSTUNREACH | restart PM2 ด้วย Terminal GUI เท่านั้น |

---

## 11. งานที่ยังค้างอยู่

| รายการ | สถานะ | หมายเหตุ |
|---|---|---|
| Verify scan fallback path ที่ runtime | **ยังไม่ verify** | เดิน past DAHUA_CAM01 หลัง camera reconnect แล้ดู `_snapshot_source = 'dahua-rtsp-buffer-scan'` |
| Verify clip-resolver upgrade scan snapshot | **ยังไม่ verify** | scan snapshot ควรถูก upgrade เป็น `dahua-clip-resolver / ok` เมื่อ clip มาถึง |
| `dahua_server_frame_offsets_ms` per-camera tuning | ยังไม่ได้ test ครบ | ค่า default ใช้ได้; ถ้า burst ยังพลาดเพิ่ม offset หรือ widen range |
| DahuaProblem.MD sync | ควรอัปเดต | บันทึก incident ใหม่ (segment guard fix, scan fallback) ลงใน DahuaProblem.MD ด้วย |

---

## 12. Related Files

| ไฟล์ | Role |
|---|---|
| `src/ingesters/dahua-cgi.js` | Main ingester (I/O, DB, ffmpeg, waterfall orchestration) |
| `src/ingesters/dahua-protocol.js` | Pure parser (testable in isolation) |
| `src/ingesters/dahua-snapshot-selector.js` | Pure scoring + selection (testable in isolation) |
| `src/helpers/digestAuth.js` | HTTP Digest auth (shared กับ Hikvision) |
| `src/media-recorder.js` | RTSP buffer → 1s .ts segments |
| `src/alert-engine.js` | LINE alert pipeline (vendor-agnostic) |
| `test/dahua-parser.test.js` | Parser tests (21 tests) |
| `test/dahua-snapshot-selector.test.js` | Selector/scoring tests (27 tests) |
| `test/fixtures/dahua/` | 7 fixture files สำหรับ parser tests |
| `cameras-config.json` | Source of truth camera list |
| `media-buffer/<camera_id>/<unix_ts>.ts` | RTSP rolling buffer segments |
| `docs/LOGIC_camera-ingesters.md` | Shared multi-vendor decisions |
| `GOTCHAS.md` | Known pitfalls (#39, #43, #58, #73, #75) |
| `DahuaProblem.MD` | Dahua snapshot timing หลักฐานและ incident log |
| `SKILL.md §14` | Operator guide สำหรับ Dahua snapshot |
| `SKILL-TH.md §14` | (ภาษาไทย) |
