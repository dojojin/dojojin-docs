# CODEX_dahua-cgi_suggestion.md — Dahua CGI Ingester Hardening Suggestions

Date: 2026-06-16
Scope: `src/ingesters/dahua-cgi.js`

## Summary

`src/ingesters/dahua-cgi.js` เป็นหนึ่งในไฟล์ที่ incident-prone ที่สุดของระบบ เพราะ Dahua CGI behavior แตกต่างตามรุ่น/firmware/config จริงมากกว่า vendor อื่น:

- `eventManager.cgi?action=attach&codes=[All]` ไม่ครอบ VCA events ในกล้องที่ทดสอบ ต้องระบุ code explicit
- `data.UTC` เป็น local time disguised as unix timestamp ไม่ใช่ UTC จริง
- `UTCMS` / `PTS` ใช้เป็น diagnostic ได้ แต่ไม่ควรเป็น snapshot anchor หลัก
- `snapManager.cgi?action=attachFileProc` บางรุ่นใช้ได้ บางรุ่น HTTP 400 หรือ parser reject
- firmware ใหม่บางรุ่นใช้ Digest realm 32-hex ที่ standard formula ใช้ไม่ได้ ต้องเปลี่ยน Compatibility Mode
- Smart Plan ต้อง active จริง ไม่ใช่แค่ rule enable
- sub-stream บางตัว 1 fps ทำให้ RTSP clip/snapshot unusable
- Dahua dwell semantics เป็น per-object ไม่ใช่ zone-state
- snapshot timing ต้องใช้ RTSP buffer burst + clip resolver มากกว่า single timestamp

เอกสารนี้เสนอแนวทางลด quirk และลด incident-prone โดยไม่เปลี่ยน architecture หลัก:

- eventManager ยังเป็น source of truth สำหรับ event ingestion
- event insertion ไม่ควรถูก block โดย snapshot failure
- snapshot enrichment ควรเป็น best-effort + diagnostic-rich
- FaceDetection ยังไม่ควรเข้าหน้า face gallery
- no full rewrite; refactor เป็น protocol/capability/snapshot/test layers แบบ incremental

---

## External Research Notes

มีการค้นหาแหล่งข้อมูลภายนอกเพื่อหา Dahua official/public CGI specification สำหรับ `eventManager.cgi`, `snapManager.cgi`, `snapshot.cgi`, และ event codes แต่รอบนี้ไม่พบ public official spec ที่ค้นหาและอ้างอิงได้ชัดเจนผ่าน web search

ผลที่ควรนำไปใช้:

- อย่า assume ว่า Dahua CGI behavior จะ stable ตามเอกสาร public
- ควรทำระบบแบบ capability-driven จากกล้องจริง
- เก็บ model/firmware/capability fingerprint ต่อกล้อง
- ใช้ observed behavior จาก `DahuaProblem.MD` เป็น source หลักของ implementation decisions

External security reference ที่เกี่ยวข้อง:

- TechRadar รายงาน CVE-2025-31700 / CVE-2025-31701 จาก Bitdefender และระบุว่า Dahua patch firmware แล้ว; mitigation สำคัญคือ update firmware, ไม่ expose กล้องตรง internet, disable UPnP, และ isolate camera network
  Source: https://www.techradar.com/pro/security/hackers-could-take-over-millions-of-dahua-cctv-cameras-because-of-two-critical-flaws-heres-how-to-stay-safe

Security implication:

- `dahua-cgi.js` ควรถูกออกแบบภายใต้ assumption ว่า camera firmware/network stack เปลี่ยนและมี vulnerability history
- อย่าเพิ่ม behavior ที่ทำให้กล้องถูก retry ถี่, lockout ง่าย, หรือ expose credentials/log details
- deployment ต้อง isolate Dahua camera subnet และ keep firmware current

---

## Current Strengths

สิ่งที่ `dahua-cgi.js` ทำดีแล้ว:

- ใช้ outbound connection ไป camera เหมือน Hikvision ingester ไม่ต้องเปิด inbound port
- filter เฉพาะ `vendor:'dahua'` และ skip paused cameras
- `eventManager` explicit code list ลดปัญหา `codes=[All]` ไม่ส่ง VCA
- มี `DAHUA_EVENT_MAP` normalize event_type ให้เข้ากับระบบกลาง
- insert event ก่อน snapshot enrichment ทำให้ snapshot failure ไม่ทำ event หาย
- `pg_notify('new_event')` หลัง snapshot update เพื่อให้ dashboard ได้ snapshot metadata
- มี `clip_done` second-pass resolver สำหรับ low-confidence/missing/failed snapshot
- มี `_snapshot_debug` ละเอียดมาก ช่วย postmortem ได้จริง
- มี low-confidence status และ edge-risk detection
- มี dedup key ที่ใช้ ObjectID + Direction ลด dwell pairing bug จากคนหลายคน
- มี log-once สำหรับ unmapped event code
- มี hot reload จาก `cameras-config.json`
- ใช้ singleton กันรันซ้ำ
- ใช้ credential decryption path แล้ว

---

## Main Problem Areas

### 1. Protocol behavior ยังปนกับ business flow

ในไฟล์เดียวมี:

- HTTP Digest handshake
- eventManager streaming
- snapManager streaming
- multipart parser
- Dahua text parsing
- event normalization
- DB insert/update
- alert engine call
- pg_notify
- RTSP buffer scoring
- clip resolver
- config hot reload
- reconnect state

ผลคือเวลาแก้ quirk เฉพาะ protocol อาจกระทบ ingestion/event/snapshot flow โดยไม่ตั้งใจ

### 2. Capability detection ยังไม่เป็น first-class

ตอนนี้ code มี fallback หลายชั้น แต่ยังไม่มี per-camera capability profile ที่ชัดเจน เช่น:

- digest mode ใช้งานได้หรือ realm 32-hex problematic
- snapManager supported / unsupported / parser rejected / HTTP 400
- eventManager connected but only heartbeat
- Smart Plan likely inactive
- RTSP main/sub stream fps/GOP usable หรือไม่
- camera model/firmware/build date
- coordinate bbox scale observed

### 3. Snapshot scoring เป็น empirical heuristic แต่ยังไม่มี fixture tests

ปัจจุบัน scoring ดีขึ้นจาก incident จริง แต่ยังเสี่ยง regression เพราะไม่มี golden fixtures/contact sheet tests

### 4. Retry/reconnect state รวม event stream และ snap stream บางส่วน

`_retryCount` ถูกใช้ทั้ง eventManager และ snapManager reconnect path ถ้าปรับไม่ระวังอาจทำให้ stream หนึ่งกระทบ backoff ของอีก stream

### 5. Diagnostics อยู่ใน raw_json แต่ยังไม่ aggregate เป็น health surface

`_snapshot_debug` ดีมากสำหรับ SQL deep dive แต่ operator/admin ยังต้อง query เองเพื่อเห็น pattern เช่น snapManager unsupported, low-confidence rate, clip resolver rate, digest realm failure

---

## Recommended Refactor Shape

ไม่ควร rewrite ทั้ง ingester ในครั้งเดียว ให้แยกตาม responsibility แบบนี้

### `src/ingesters/dahua/protocol.js`

Responsibilities:

- build eventManager URI
- build snapManager URI
- parse Dahua event text line
- parse snapManager text
- parse multipart stream safely
- expose parser functions for fixtures/tests

Suggested exports:

```js
parseDahuaEventText(text)
parseSnapManagerText(text)
processMultipartBuffer(buffer, mode)
buildEventManagerPath(eventCodes)
buildSnapManagerPath(eventCodes)
```

Benefit:

- test parser without connecting to camera
- reduce risk from multipart/text parsing changes
- isolate Dahua protocol quirks from DB/alert/snapshot code

### `src/ingesters/dahua/capabilities.js`

Responsibilities:

- track per-camera capability profile
- record digest realm shape
- record snapManager status
- record eventManager status
- record stream FPS/GOP findings if available
- expose diagnostics summary

Suggested data shape:

```js
{
  camera_id,
  model: null,
  firmware: null,
  digest_realm_kind: 'standard' | 'realm_32_hex' | 'unknown',
  event_manager: 'connected' | 'auth_failed' | 'heartbeat_only' | 'offline',
  snap_manager: 'connected' | 'unsupported_400' | 'parser_rejected' | 'disabled' | 'unknown',
  smart_plan: 'active_observed' | 'no_vca_seen' | 'unknown',
  rtsp_main: { fps: null, gop_sec: null, usable: null },
  rtsp_sub: { fps: null, gop_sec: null, usable: null },
  last_error_code,
  last_error_at
}
```

Benefit:

- turn quirks into observable state
- make Health page/admin diagnostics easier
- avoid re-debugging same camera behavior

### `src/ingesters/dahua/snapshot-selector.js`

Responsibilities:

- event bbox normalization
- edge-risk detection
- ROI extraction
- scoreFrameForObject
- scoreFrameMotion
- chooseBestSnapshotCandidate
- server-anchor offset selection
- clip resolver offset selection

Benefit:

- snapshot scoring can be tested with image fixtures
- can evolve heuristic without touching event ingest
- lower risk around the most incident-prone code

### `src/ingesters/dahua/connection-manager.js`

Responsibilities:

- eventManager request lifecycle
- snapManager request lifecycle
- reconnect timers
- backoff state per stream
- stop/reconnect on config changes
- destroyed camera state

Important:

- separate retry counters for `eventManager` and `snapManager`
- avoid snapManager instability affecting eventManager reconnect

### `src/ingesters/dahua/event-normalizer.js`

Responsibilities:

- `DAHUA_EVENT_MAP`
- `DAHUA_CLASS`
- Direction to `event_state`
- ObjectID extraction
- dedup key construction
- event raw_json shape
- unmapped code handling

Benefit:

- easier to add new Dahua code
- isolate dwell semantics and per-object behavior
- test mapping without DB

### `src/ingesters/dahua/db-writer.js`

Responsibilities:

- insert event row
- update snapshot fields
- update `_snapshot_status`
- notify `event_for_clip`
- notify `new_event`
- keep notify-after-snapshot rule centralized

Benefit:

- DB writes easier to audit
- raw_json mutation consistent
- lower risk when adding status/diagnostic fields

---

## Suggested Hardening Improvements

### 1. Add Dahua Capability Fingerprint at startup

On connect or periodic refresh, record:

- camera id
- IP/port
- model/firmware if available from a safe CGI probe
- digest realm format from 401 challenge
- eventManager connected timestamp
- snapManager status
- last VCA event timestamp
- last heartbeat timestamp
- snapManager disabled reason
- RTSP stream health summary from media-recorder/ffprobe if available

Do not block event ingestion if fingerprint fails

Output to:

- log once per camera on startup
- optional `/api/health/details` Dahua section later
- maybe raw memory state exported by local health endpoint in future

### 2. Make snapManager a quarantined optional accelerator

Current flow already treats snapManager as optional; make this explicit:

- status: `unknown`, `connected`, `unsupported_http_400`, `unsupported_http_404`, `parser_rejected`, `auth_failed`, `disabled_by_config`
- do not reconnect snapManager forever after known unsupported errors
- reset snapManager quarantine only on config reload or camera reconnect with changed signature
- keep eventManager independent

Expected effect:

- lower log noise
- less camera load
- less retry-induced lockout risk

### 3. Split retry/backoff by stream

Current `_retryCount` is shared enough that future changes can accidentally couple event/snap behavior

Recommendation:

```js
const _eventRetryCount = new Map();
const _snapRetryCount = new Map();
```

Also track:

```js
last_event_error
last_snap_error
last_event_reconnect_at
last_snap_reconnect_at
```

### 4. Add Digest realm diagnostics

For 401 Digest challenge:

- parse realm
- classify:
  - `standard_16_hex`
  - `realm_32_hex_problematic`
  - `other`
- log actionable warning once:
  - if realm 32-hex and auth fails repeatedly, tell operator to check Dahua Compatibility Mode

Do not brute-force many formulas in production

Reason:

- GOTCHAS #73 shows repeated retries can cause lockout
- standard Digest works only after Compatibility Mode for affected firmware

### 5. Add Smart Plan / no-VCA detection guard

Problem:

Camera can connect and heartbeat but no VCA events arrive because Smart Plan is inactive

Recommendation:

- Track `eventManager_connected_at`
- Track `last_vca_event_at`
- If connected for N minutes with heartbeat but no VCA event, log once:

```text
[dahua] camera connected but no VCA events observed for 10m; check Smart Plan / IVS rule enablement
```

Optional health warning:

```json
{
  "camera_id": "DAHUA_CAM01",
  "warning": "eventManager connected but no VCA events observed"
}
```

Avoid behavior-changing validation until verified per camera

### 6. Add RTSP stream suitability guard

Problem:

Dahua sub-stream can be 1 fps and unusable for clip/snapshot resolver

Recommendation:

- On camera config save or health check, show warning if Dahua `clip_stream` is not main stream and ffprobe reports low fps/GOP problem
- In ingester, if buffer candidates are repeatedly missing, surface likely cause:

```text
clip buffer missing/late; verify media-recorder running and Dahua clip_stream main/fps > 5
```

Do not silently trust sub-stream

### 7. Make snapshot status taxonomy richer

Current statuses:

- `ok`
- `low_confidence`
- `missing`
- `failed`

Suggested additions:

- `late`
- `edge_risk`
- `snap_unsupported`
- `buffer_unavailable`
- `clip_resolver_pending`

Keep DB behavior simple:

- `has_snapshot=true` only when actual image exists
- `_snapshot_status` explains confidence/quality

### 8. Generate contact sheet diagnostics

For debug mode only:

- create a contact sheet of candidate frames around event
- overlay offset/score/status
- save under debug directory or attach path in `_snapshot_debug`

Use only when enabled per camera:

```json
"dahua_snapshot_debug_contact_sheet": true
```

Benefit:

- faster field diagnosis
- can visually compare why scorer selected a frame

Risk:

- storage overhead
- may contain sensitive images

So keep disabled by default and auth-gated if exposed

### 9. Add parser fixtures and regression tests

Create test fixtures:

```text
test/fixtures/dahua/event-cross-region-enter.txt
test/fixtures/dahua/event-cross-region-leave.txt
test/fixtures/dahua/event-line-crossing.txt
test/fixtures/dahua/snapmanager-text.txt
test/fixtures/dahua/multipart-text-no-content-length.bin
test/fixtures/dahua/multipart-jpeg-with-content-length.bin
```

Tests should cover:

- `parseDahuaEventText`
- `parseSnapManagerCode`
- multipart parser with text parts without Content-Length
- multipart parser with JPEG parts
- Direction Enter/Leave -> event_state true/false
- ObjectID + Direction dedup key
- unmapped code behavior

This gives most confidence with low runtime cost

### 10. Add snapshot selector tests with synthetic images

Use small generated images, not real customer frames:

- baseline empty ROI
- ROI with object-like rectangle at candidate offsets
- edge-risk bbox
- no bbox fallback
- near-best closest-anchor tie-break

Expected tests:

- candidate with stronger motion wins
- near-best closer-to-anchor beats barely higher late frame
- edge-risk marks low confidence
- no candidate returns missing

### 11. Add health/admin summary for Dahua quality

Add later, not first:

```json
{
  "dahua": {
    "cameras": [
      {
        "id": "DAHUA_CAM01",
        "event_manager": "connected",
        "snap_manager": "unsupported_http_400",
        "last_vca_event_at": "...",
        "snapshot_24h": {
          "ok": 120,
          "low_confidence": 8,
          "missing": 2,
          "clip_resolver_used": 14
        }
      }
    ]
  }
}
```

Benefit:

- operator sees pattern without SQL
- better monitoring for recurring firmware/config problems

---

## Suggested Execution Plan

### Phase 0 — Documentation and test seams

No behavior change

- Extract parser pure functions
- Add fixtures for Dahua event text/multipart
- Add unit tests around parser/event mapping/dedup key
- Keep `dahua-cgi.js` behavior unchanged

Suggested commit:

```text
refactor(dahua): extract CGI parser helpers
test(dahua): add event and multipart parser fixtures
```

### Phase 1 — Capability tracking

Low behavior risk

- Add in-memory capability state
- Record eventManager/snapManager status
- Record Digest realm classification
- Log actionable warnings once
- Do not block ingestion

Suggested commit:

```text
feat(dahua): track per-camera CGI capability state
```

### Phase 2 — Snapshot selector extraction

Medium risk but high payoff

- Move scoring/ROI/edge-risk logic into `snapshot-selector.js`
- Add synthetic image tests
- Keep thresholds and offsets unchanged initially

Suggested commit:

```text
refactor(dahua): extract snapshot selector
test(dahua): cover snapshot candidate selection
```

### Phase 3 — Reconnect/backoff isolation

Low-to-medium risk

- Split event/snap retry counters
- Add status fields for last errors
- Ensure eventManager reconnect is not impacted by snapManager failures

Suggested commit:

```text
refactor(dahua): isolate event and snapshot stream reconnect state
```

### Phase 4 — Health/diagnostic surface

Medium risk

- Export Dahua summary from ingester or DB-derived stats
- Surface in `/api/health/details` or admin diagnostics
- Add warning for connected-but-no-VCA events
- Add warning for high low-confidence/missing snapshot rate

Suggested commit:

```text
feat(health): expose Dahua ingestion quality summary
```

### Phase 5 — Optional contact sheet/debug tools

Only if field debugging still costs time

- Disabled by default
- Per-camera opt-in
- Auth-gated storage/view

Suggested commit:

```text
feat(dahua): add optional snapshot candidate contact sheet
```

---

## Code Organization Target

Suggested directory:

```text
src/ingesters/dahua/
  protocol.js
  event-normalizer.js
  snapshot-selector.js
  capabilities.js
  connection-manager.js
  db-writer.js
```

Keep root file:

```text
src/ingesters/dahua-cgi.js
```

as the process entrypoint:

- load config
- init pool/alert engine
- start connection manager
- watch config
- listen for clip_done
- shutdown

Target:

```text
dahua-cgi.js current: ~1,281 lines
reasonable target after extraction: ~350-550 lines entrypoint
```

Do not target tiny entrypoint if it hides lifecycle too deeply

---

## Validation Checklist

### Always

```bash
node --check src/ingesters/dahua-cgi.js
node --test test/*.test.js
```

Also run `node --check` on every new Dahua helper file

### Parser changes

- test event text fixtures
- test multipart no Content-Length
- test JPEG part extraction
- test unknown code log-once behavior

### Snapshot selector changes

- test synthetic image fixtures
- verify `low_confidence`, `edge_risk`, `near-best-closest-anchor`
- verify `_snapshot_debug` shape does not lose important fields

### Runtime smoke

With real camera only when owner approves:

- Dahua eventManager connects
- snapManager status logged
- at least one real VCA event inserted
- `event_for_clip` notification still fires
- `new_event` fires after snapshot update
- snapshot fields update:
  - `snapshot_filename`
  - `has_snapshot`
  - `_snapshot_source`
  - `_snapshot_status`
  - `_snapshot_debug`
- clip resolver still handles low-confidence/missing/failed first pass

### SQL inspection

```sql
SELECT
  id,
  camera_id,
  event_time AT TIME ZONE 'Asia/Bangkok' AS local_time,
  raw_json->>'_snapshot_source' AS source,
  raw_json->>'_snapshot_status' AS status,
  raw_json->'_snapshot_debug'->>'confidence' AS confidence
FROM events
WHERE camera_id LIKE '%DAHUA%'
ORDER BY event_time DESC
LIMIT 20;
```

---

## What Not To Do

- Do not route Dahua FaceDetection to face gallery
- Do not use ONVIF as primary Dahua VCA transport unless a real camera proves useful topics exist
- Do not trust `codes=[All]` for VCA
- Do not trust `data.UTC` as UTC
- Do not use `snapshot.cgi` as primary event snapshot path
- Do not block event insert on snapshot failure
- Do not remove `_snapshot_debug`
- Do not retry Digest formulas aggressively against Dahua firmware with realm 32-hex
- Do not allow snapManager instability to break eventManager ingestion
- Do not change dwell semantics without respecting Dahua per-object behavior
- Do not use sub-stream for clip/snapshot resolver unless fps/GOP is verified usable

---

## Recommended Priority

| Priority | Work | Why |
|---:|---|---|
| P1 | Extract parser + fixtures | Lowest risk, highest regression protection |
| P1 | Capability tracking / Digest realm diagnostics | Turns quirks into observable state |
| P2 | Snapshot selector extraction + tests | Most incident-prone logic gets testable |
| P2 | Separate event/snap retry state | Prevent snapManager failures from affecting ingestion |
| P3 | Health/admin Dahua quality summary | Helps operators see recurring patterns |
| P3 | Optional contact sheets | Useful for field debugging, but storage-sensitive |

---

## Final Recommendation

Do not rewrite `dahua-cgi.js` as a new ingester

Instead, reduce incident-prone behavior by making Dahua behavior explicit and testable:

1. isolate protocol parsing
2. add fixtures
3. track per-camera capabilities
4. extract snapshot selector
5. separate reconnect state
6. expose Dahua health diagnostics

The biggest engineering win is not a new algorithm immediately; it is converting hidden camera/firmware quirks into visible state and tests. Once that is in place, tuning snapshot scoring or adding model-specific behavior becomes much safer
