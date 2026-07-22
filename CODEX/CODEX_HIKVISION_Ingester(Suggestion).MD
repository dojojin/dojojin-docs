# CODEX_HIKVISION_Ingester(Suggestion)

วันที่จัดทำ: 2026-06-18  
Scope: วิเคราะห์ `docs/LOGIC_hikvision-ingester.md` เทียบกับ code deploy จริงใน `src/ingesters/hikvision-isapi.js`, `ecosystem.config.js`, และเอกสารภายนอกของ Hikvision / developer community

## Executive Summary

ภาพรวม: แนวทางปัจจุบันของ Hikvision ingester **ถูกทางแล้ว** สำหรับ production on-prem ของ Vigil Platform:

- ใช้ ISAPI Alert Stream แบบ long-lived HTTP push ผ่าน `GET /ISAPI/Event/notification/alertStream`
- ใช้ HTTP Digest auth แบบไม่เพิ่ม dependency ใหญ่
- Parse multipart แบบ binary-safe เพื่อรองรับ XML/JSON/JPEG ใน stream เดียว
- Normalize Smart Events เข้าตาราง `events` ด้วย vocabulary กลางของระบบ
- เก็บ Face Capture, Face Recognition, Body Appearance, People Counting และ Dwell false-half ได้ครบกว่ารอบแรกมาก
- PM2 deploy จริงเป็น worker ชื่อ `hikvision` ผ่าน `ecosystem.config.js`
- `node --check src/ingesters/hikvision-isapi.js` ผ่าน

แต่ยังมีจุดที่ควรปรับเพื่อให้ incident-prone น้อยลง:

1. `_pendingFaces` keyed ด้วย `face.pId` อย่างเดียว เสี่ยงชนกันข้ามกล้องหรือข้าม capture batch
2. `_pendingBodyLink` keyed ด้วย `camera_id` อย่างเดียว เสี่ยง link body appearance ผิด event เมื่อ face alarms ซ้อนใน 10 วินาที
3. Face Alarm Server ยัง harden ไม่พอ: global allow IP เดียว, always-on, ไม่ enforce method/Content-Type/body size, และ fallback รับ camera ที่ไม่อยู่ใน config
4. Multipart parser hardcode boundary เป็น `--boundary`; ใช้ได้กับ payload ที่เจอจริง แต่ควร parse boundary จาก `Content-Type` เป็นหลัก แล้ว fallback
5. Snapshot/image write ยังไม่ validate JPEG magic bytes, content-type, max size หรือ `_snapshot_status`
6. Smart Event dedup ใช้ `cameraId|eventType`; อาจ collapse คนละ rule/zone ถ้ากล้องส่ง eventType เดียวกันหลาย rule ในช่วง 3 วินาที
7. `enable_snapshot` ใน config doc มี แต่ Smart Event path ใน code ยัง capture snapshot เสมอ
8. Observability ยังน้อย: ไม่มี counter ต่อกล้องสำหรับ dedup drop, unmapped event, snapshot fail, face timeout, FAS rejected/accepted, PeopleCounting skipped/inserted
9. ยังขาด fixture tests สำหรับ alertStream multipart, Face Capture multipart, Face Alarm Server multipart, PeopleCounting dedup, fielddetection inactive

ข้อเสนอหลัก: ไม่ควร rewrite ใหม่ทั้งไฟล์ทันที ให้ทำเป็น phased hardening โดยแยก parser/normalizer/test fixture ก่อน แล้วค่อยปรับ runtime behavior ที่มีผลกับ event volume หรือ alert timing

## Sources Checked

### Internal repo facts

- `docs/LOGIC_hikvision-ingester.md`
- `src/ingesters/hikvision-isapi.js`
- `ecosystem.config.js`
- `docs/LOGIC_camera-ingesters.md`
- `DECISIONS.md`, `GOTCHAS.md`, `ROADMAP.md` ผ่านบริบท repo

### External references

1. Hikvision Technology Partner Portal  
   URL: https://tpp.hikvision.com/  
   Notes:
   - Official Hikvision portal มีหมวด `Hikvision Open Capabilities`, `Download`, และ `ISAPI Developer Guides`
   - แต่หน้า download/documentation มี restriction สำหรับ partner/company account ในบางส่วน จึงไม่สามารถยืนยัน schema ลึกทั้งหมดจาก public unauthenticated page ได้

2. Home Assistant Hikvision Integration  
   URL: https://www.home-assistant.io/integrations/hikvision/  
   Notes:
   - ยืนยันว่า Hikvision integration ใช้ camera event stream เป็น source ของ binary sensors
   - ต้องเปิด event action เช่น `Notify the surveillance center`
   - ระบุเรื่อง user permission `Remote: Notify Surveillance Center/Trigger Alarm Output`
   - ระบุว่า `WEB Authentication` ควรตั้งเป็น `digest/basic`
   - Supported event types รวม Motion, Line Crossing, Field Detection, Tamper, Face Detection, Unattended Baggage, Exiting/Entering Region

3. openHAB IP Camera Binding - Hikvision notes  
   URL: https://www.openhab.org/addons/bindings/ipcamera/  
   Notes:
   - ระบุว่า Hikvision CGI/API และ ONVIF อาจ disabled by default ต้อง enable ก่อน
   - ระบุว่า alarm ที่ต้องการใช้ควร enable `Notify Surveillance Center`
   - ระบุว่า Hikvision/NVR ควร enable ISAPI, ONVIF, RTSP ตาม feature ที่ใช้
   - ยืนยันว่าการใช้ vendor API ลด CPU กว่าการ derive alarm/snapshot ผ่าน ffmpeg อย่างเดียว

4. NVD CVE-2021-36260  
   URL: https://nvd.nist.gov/vuln/detail/CVE-2021-36260  
   Notes:
   - Hikvision เคยมี command injection ใน web server ของบาง product, CVSS 9.8
   - NVD อ้างอิง vendor advisory และ CISA KEV
   - Implication ต่อระบบนี้: อย่า expose camera web/ISAPI ออก internet, ใช้ network isolation, firmware policy, และ least-privilege camera account

5. NVD CVE-2017-7921  
   URL: https://nvd.nist.gov/vuln/detail/CVE-2017-7921  
   Notes:
   - Hikvision หลายรุ่นเคยมี improper authentication, CVSS 9.8
   - Implication ต่อระบบนี้: Face Alarm Server / ISAPI receiver ต้องถือว่า traffic จาก camera subnet ก็ต้องมี guard, size cap, allowlist, และไม่ trust payload เกินจำเป็น

## Fact: Current Deployment Shape

จาก `ecosystem.config.js`:

- PM2 app ชื่อ `hikvision`
- script จริงคือ `ingesters/hikvision-isapi.js`
- `cwd` คือ `src`
- ใช้ explicit interpreter `/opt/homebrew/opt/node@24/bin/node`
- autorestart เปิดอยู่, `min_uptime: 10s`, `restart_delay: 3000`, `max_restarts: 15`

จาก `src/ingesters/hikvision-isapi.js`:

- มี singleton guard `require('../singleton')('hikvision')`
- DB pool `application_name: 'hikvision'`
- โหลด camera จาก `cameras-config.json` เฉพาะ `vendor: 'hikvision'` และไม่ `paused`
- connect Alert Stream ที่ `/ISAPI/Event/notification/alertStream`
- ใช้ Digest auth helper จาก `src/helpers/digestAuth.js`
- มี hot reload camera config ผ่าน `fs.watch`
- `HIK_EVENT_MAP` ครอบคลุม line, field, region entrance/exiting, baggage, face detection, tamper
- PeopleCounting มี branch เฉพาะก่อน Smart Event mapping
- Snapshot ใช้ `/ISAPI/Streaming/channels/10${snapshot_stream}/picture`
- Face Alarm Server bind ที่ `FACE_PUSH_BIND`, port `FACE_PUSH_PORT`, allow IP เดียวจาก `FACE_PUSH_ALLOW`

## Verdict: วิธีปัจจุบันถูกต้องไหม

### ถูกต้องในภาพรวม

วิธีใช้ Alert Stream เป็น primary path ถูกต้องกับ ecosystem ของ Hikvision และตรงกับสิ่งที่ Home Assistant/openHAB community ใช้:

- กล้อง push event ผ่าน stream เมื่อเปิด `Notify Surveillance Center`
- ระบบไม่ต้อง poll ทุก event เอง จึงเบากว่า polling
- Digest/basic auth เป็น reality ของกล้อง Hikvision หลายรุ่น
- Mapping eventType เช่น `linedetection`, `fielddetection`, `facedetection`, `regionEntrance`, `regionExiting` ตรงกับ event family ที่ community integration รองรับ

### จุดที่ยังต้องระวัง

Hikvision รุ่น/firmware มีความหลากหลายมาก:

- Boundary ใน multipart อาจไม่ควรสมมติว่าเป็น `boundary` เสมอ
- Content-Length ปกติควรมีใน payload ที่เจอ แต่ควรมี fixture proving ว่า parser handle ได้ตามจริง
- Face Capture / Face Recognition / mixedTargetDetection format อาจเปลี่ยนตาม firmware/model
- NVR กับ standalone camera อาจมี channel naming หรือ event notification method แตกต่างกัน
- บาง feature ต้อง enable ใน camera UI ก่อน ไม่ใช่ code แก้อย่างเดียว

ดังนั้นแนวทางปัจจุบันดีแล้ว แต่ควรเพิ่ม guard, fixture, capability diagnostics และลด state matching แบบหลวม

## Detailed Findings

### 1. Alert Stream connection

Fact:

- Code connect ไปที่ `/ISAPI/Event/notification/alertStream`
- Reconnect มี backoff และ update `last_seen_at` ทุก message รวม `videoloss`
- `videoloss` ถูกใช้เป็น heartbeat และไม่ insert เป็น event

Opinion:

- Pattern นี้ดีและควรรักษาไว้
- ควรเพิ่ม per-camera status ใน health details:
  - `alert_stream_connected`
  - `last_stream_message_at`
  - `last_event_type`
  - `last_reconnect_at`
  - `reconnect_count`
  - `last_error_code`
  - `last_error_message_safe`

เหตุผล:

- ตอนนี้ถ้ากล้องเงียบ เรารู้ผ่าน `last_seen_at` แต่ debug root cause ยังต้องเปิด PM2 logs
- Health page ควรบอกได้ว่า "stream alive but no Smart Event", "auth failed", "EHOSTUNREACH", "timeout", หรือ "no configured Hikvision cameras"

### 2. Multipart parser

Fact:

- `processMultipart()` ใช้ binary-safe Buffer
- hardcode `_BOUNDARY = Buffer.from('--boundary')`
- require `Content-Length`
- part types ที่รองรับ: XML, JSON, JPEG
- XML ส่งเข้า `ingestEvent()`
- JSON ส่งเข้า `handleFaceJson()`
- JPEG match ด้วย `Content-Disposition name="..."`

Opinion:

- Binary-safe parser เป็นจุดแข็ง ควรรักษา
- แต่ควร refactor เป็น pure parser function ที่ test ได้:
  - `parseMultipartBuffer(buffer, { boundary, requireContentLength })`
  - คืน array ของ `{ headers, contentType, name, body }` และ `remainingBuffer`
- Boundary ควร parse จาก response header `Content-Type: multipart/mixed; boundary=...` ถ้ามี
- ใช้ `--boundary` เป็น fallback เฉพาะ Hikvision รุ่นที่ส่งแบบเดิม
- ไม่ควรรีบรองรับ missing `Content-Length` ใน alertStream จนกว่าจะมี payload จริง เพราะ fallback boundary-to-boundary กับ JPEG มีโอกาสกิน memory/ตัด body ผิด แต่ควรมี design เผื่อไว้

Suggested low-risk change:

```js
const boundary = parseBoundary(res.headers['content-type']) || 'boundary';
const boundaryBuf = Buffer.from(`--${boundary}`);
```

### 3. Event normalization

Fact:

- `HIK_EVENT_MAP` map Hikvision eventType เป็น Bosch vocabulary กลาง
- Unmapped eventType log once พร้อม sample XML 1500 chars
- `fielddetection inactive` insert เป็น `event_state='false'` เพื่อ dwell stats
- PeopleCounting เก็บเป็น `CountAggregation/PeopleCounting` และไม่ alert/snapshot/clip

Opinion:

- ดีมากในแง่ cross-vendor consistency
- แต่ควรลด risk ของ sample XML log:
  - XML ของ Smart Event ปกติไม่ใช่ PII หนัก แต่บางรุ่นอาจแนบ field เพิ่ม
  - ควร sanitize/truncate เฉพาะ tag whitelist หรือ redact known sensitive fields ก่อน log
- `HIK_EVENT_MAP` ควรมี doc/table ที่ระบุ confidence:
  - `verified_on_real_device`
  - `inferred_from_docs`
  - `unverified`
  - `needs_payload_fixture`

### 4. Dedup strategy

Fact:

- Dedup key ปัจจุบันคือ `${cameraId}|${eventType}`
- Window คือ `DEDUP_WINDOW_MS = 3000`
- ใช้แก้ปัญหา Hikvision re-post `eventState=active` ประมาณ 1 ครั้งต่อวินาที

Opinion:

- Dedup จำเป็นและถูกต้อง
- แต่ key อาจหยาบเกินไป ถ้ากล้องเดียวมีหลาย line/zone/rule ที่ใช้ eventType เดียวกัน เช่น line crossing 2 เส้น หรือ field detection 2 region
- ควรขยาย key แบบ backward-compatible:
  - `cameraId`
  - `eventType`
  - `channelID`
  - `eventDescription` หรือ rule/region id ถ้ามีใน payload
  - fallback เป็น eventType เดิมเมื่อไม่มี field

Suggested key:

```text
camera_id | hik_event_type | channel_id | rule_id_or_event_description | event_state
```

ต้อง verify ด้วย XML จริงก่อน เพราะบางรุ่น `eventDescription` อาจเป็นข้อความทั่วไปไม่ stable

### 5. Snapshot capture

Fact:

- `captureSnapshot()` ใช้ `/ISAPI/Streaming/channels/10${snapshot_stream}/picture`
- Digest two-step
- timeout 5s
- save raw buffer เป็น `.jpg`
- Smart Event path update `snapshot_filename` แล้วค่อย `pg_notify('new_event')`

Opinion:

- การ notify หลัง snapshot update ถูกต้อง และตรงกับ decision #163
- ควรเพิ่ม:
  - honor `enable_snapshot === false`
  - max bytes เช่น 5-10 MB
  - validate status code + `Content-Type` image
  - validate JPEG magic bytes `FF D8 ... FF D9` แบบ tolerant
  - `_snapshot_status` ใน `raw_json`: `ok`, `disabled`, `http_status`, `timeout`, `invalid_image`, `write_failed`

เหตุผล:

- ตอนนี้ถ้า camera web endpoint คืน HTML error page ด้วย HTTP 200 ระบบจะเขียนเป็น `.jpg`
- ถ้า snapshot disabled ใน camera config แต่ code ยัง capture เสมอ จะขัดกับ config expectation

### 6. Alert timing

Fact:

- Smart Event path เรียก `alertEngine.onEvent()` ก่อน snapshot capture
- `pg_notify('new_event')` ถูกเลื่อนหลัง snapshot update แล้ว
- Face Alarm path save image ก่อน notify และ alert ใช้ `fullFile || snapFile`

Opinion:

- UI realtime ถูกต้องแล้วเพราะ notify หลัง snapshot
- แต่ LINE/alert ของ Smart Event อาจไม่มี snapshot เพราะ alert engine ได้ `snapshot_filename: null`
- ถ้าต้องการให้ LINE alert มีภาพจาก Hikvision Smart Event ควรพิจารณา delayed alert:
  - insert event
  - notify clip immediately ได้
  - capture snapshot
  - update event
  - call alertEngine with snapshot filename
  - notify frontend

Risk:

- Alert latency เพิ่ม 0-5s
- ถ้ากล้อง snapshot fail, alert จะช้ากว่าเดิม

Recommendation:

- อย่าเปลี่ยนทันทีจนกว่าจะยืนยันว่า business ต้องการภาพใน LINE สำหรับ Hikvision Smart Event
- ถ้าทำ ให้มี timeout fallback และ metric แยก

### 7. Face Capture pending map

Fact:

- `_pendingFaces` keyed ด้วย `face.pId`
- pending entry เก็บ `cam`, `face`, `eventTime`, `bgPid`, `faceImg`, `bgImg`, `timer`
- timeout 8s แล้ว ingest ด้วยภาพเท่าที่มี

Opinion:

- Pattern รอทั้ง crop และ background ดี และแก้ incident เดิมได้ถูกทาง
- แต่ key ด้วย `face.pId` อย่างเดียวเสี่ยง:
  - camera A กับ camera B ส่ง pId ซ้ำ
  - กล้องเดียวส่ง pId ซ้ำหลัง reconnect หรือ batch ใกล้กัน
  - background fan-out อาจ attach ผิด capture ถ้า `bgPid` ซ้ำ

Suggested change:

```text
pendingFaceKey = camera_id + "|" + face.pId + "|" + capture_time_or_batch_id
```

ถ้า payload ไม่มี batch id:

- ใช้ `camera_id|pId` เป็น minimum improvement
- เก็บ `createdAt`
- เมื่อ image part มา ให้ match เฉพาะ camera context ด้วย ไม่ใช่ global name อย่างเดียว

### 8. Face Alarm Server

Fact:

- Server start เสมอใน `main()`
- bind default `192.168.10.31:3010`
- allow source IP เดียวจาก `FACE_PUSH_ALLOW`
- `parseFaceAlarmMultipart()` hardcode boundary `--boundary`
- ถ้า source IP allowed แต่ไม่พบ camera ใน `_activeCams` จะ fallback เป็น `{ camera_id: src }`
- ไม่มี method guard, Content-Type guard, body size cap, request timeout
- server object ไม่ถูกเก็บไว้เพื่อ close ตอน shutdown

Opinion:

นี่เป็นจุดที่ควร harden ก่อนที่สุด เพราะเป็น inbound HTTP surface:

Recommended changes:

1. เปิด server เฉพาะเมื่อมี config:
   - `FACE_PUSH_ENABLED=true`, หรือ
   - มี camera `fas_enabled: true`

2. ใช้ per-camera allowlist:
   - `camera.fas_source_ip`
   - fallback env `FACE_PUSH_ALLOW`
   - รองรับหลาย IP ด้วย comma-separated list

3. Require configured camera:
   - ถ้า `findCamByIp(src)` ไม่เจอ ให้ reject/log
   - อย่า insert event ด้วย `camera_id` เป็น IP เพราะจะหลุด source-of-truth split

4. Request guard:
   - accept เฉพาะ `POST`
   - require `Content-Type` multipart
   - body size cap เช่น 10 MB หรือ configurable
   - `req.setTimeout(10000)`
   - return `413` เมื่อเกิน cap

5. Parse boundary:
   - อ่าน boundary จาก `Content-Type`
   - fallback `boundary`

6. Shutdown:
   - เก็บ `_faceAlarmServer`
   - close ใน `shutdown()`

### 9. Body Appearance linking

Fact:

- `_pendingBodyLink` keyed ด้วย `camera_id`
- หลัง Face Alarm insert event จะ set `{ eventId, ts }`
- `mixedTargetDetection` ที่เข้ามาภายใน 10s จะ patch body เข้ากับ event ล่าสุดของกล้องนั้น

Opinion:

- ใช้ได้ถ้า traffic ต่ำและกล้องส่ง alarmResult แล้วตามด้วย mixedTargetDetection แบบ serial
- แต่เสี่ยง link ผิดเมื่อ face recognition ซ้อนกันเร็ว ๆ

Suggested improvement:

- เปลี่ยน `_pendingBodyLink` เป็น queue ต่อ camera:
  - `Map<camera_id, Array<{ eventId, ts, faceId, humanId, captureId }>>`
- ถ้า payload มี id ร่วม เช่น faceId/humanId/capture time ให้ match ด้วย id
- ถ้าไม่มี id ให้ match nearest timestamp และ expire ทุก entry เกิน 10s
- log metric `body_link_miss`, `body_link_ambiguous`, `body_link_attached`

### 10. People Counting

Fact:

- Code เก็บเฉพาะ `statisticalMethods=timeRange` และมี `startTime`
- Dedup ด้วย `NOT EXISTS` บน `camera_id`, `event_type`, `raw_json->>'window_start'`
- ไม่ alert/snapshot/clip
- Doc บอกบางรุ่น Face Capture กับ People Counting อาจ conflict เพราะ memory

Opinion:

- Current logic ถูกต้องสำหรับ metric event
- ควรเพิ่ม health warning:
  - "PeopleCounting stream not seen for X minutes"
  - "PeopleCounting realtime mode ignored"
  - "PeopleCounting duplicate retransmission skipped"
- ควร update doc ให้ตรงกับ current UI ถ้า dashboard widget ship แล้วหรือยัง pending
- ควรเพิ่ม fixture test สำหรับ:
  - timeRange insert
  - realtime ignored
  - duplicate window skipped
  - retransmission flag preserved

### 11. Appearance normalization

Fact:

- Body Appearance map `longTrousers` -> `Trousers`, `shortTrousers` -> `Shorts`
- Normalize color case
- Insert `appearances` row
- Store unhandled body attributes into event `raw_json`
- `age_group` issue ถูกแก้บางส่วนด้วย chart fallback แต่ column backfill ยังเป็น remaining work ใน doc

Opinion:

- ควรปรับ `appearances.attributes` ให้เก็บ raw body attributes เพิ่มขึ้น ไม่ใช่เฉพาะ selected fields
- ควรมี schema/version marker ใน attributes เช่น:

```json
{
  "vendor": "hikvision",
  "source": "mixedTargetDetection",
  "raw_property_map": { "...": "..." }
}
```

- ถ้า `appearances.age_group` เป็น column แล้ว ควร populate จาก Hikvision face/body paths แทนให้ chart fallback แบก logic ระยะยาว

### 12. Security posture

Fact:

- Hikvision camera ISAPI/web stack เคยมี CVE critical ตาม NVD
- ระบบนี้ต้องใช้ camera credentials เพื่อ Digest auth และรับ inbound Face Alarm POST
- Credential at-rest encryption มี decision แล้วในระบบ

Opinion:

ควรเขียน operational guard สำหรับ Hikvision โดยเฉพาะ:

- ห้าม expose camera web/ISAPI/FAS path ออก internet
- Camera subnet แยกจาก user LAN
- Allow traffic เฉพาะ:
  - Vigil host -> camera HTTP/RTSP
  - camera -> Vigil FAS bind IP/port เมื่อ `fas_enabled`
- Firmware policy:
  - record model/firmware version
  - review Hikvision security advisories เป็นรอบ
  - firmware update test กับ Alert Stream/Face Capture ก่อน production rollout
- Least privilege:
  - camera user ต้องมีสิทธิ์ notify/event/snapshot เท่าที่ใช้
  - อย่าใช้ admin ถ้ารุ่นรองรับ permission ที่พอ
- Log redaction:
  - ห้าม log full credential, full image, full person profile
  - sample payload ต้อง truncate + redact

## Recommended Roadmap

### Phase 1: Low-risk hardening

ทำได้โดยไม่เปลี่ยน behavior หลัก:

1. Add fixture tests
   - `test/fixtures/hikvision/alertstream-smart-event.multipart`
   - `test/fixtures/hikvision/alertstream-face-capture.multipart`
   - `test/fixtures/hikvision/face-alarm.multipart`
   - `test/fixtures/hikvision/people-counting.xml`

2. Extract pure helpers
   - `src/ingesters/hikvision/multipart.js`
   - `src/ingesters/hikvision/normalizers.js`
   - `src/ingesters/hikvision/image-guard.js`

3. Parse boundary from `Content-Type`
   - fallback to current `boundary`
   - keep Content-Length requirement for alertStream until proven otherwise

4. Validate images before writing
   - JPEG magic bytes
   - max byte size
   - content-type guard
   - `_snapshot_status`

5. Key pending faces by camera
   - minimum: `${camera_id}|${pId}`
   - update image routing to include camera context

6. Respect `enable_snapshot`
   - if false: skip Smart Event snapshot and write `_snapshot_status: disabled`

### Phase 2: Inbound surface hardening

1. Face Alarm Server enable gate
   - `FACE_PUSH_ENABLED=true` or any `fas_enabled`

2. Per-camera allowlist
   - `fas_source_ip`
   - env fallback

3. Reject unknown source camera
   - no fallback event with `camera_id=src`

4. HTTP request guard
   - POST only
   - multipart only
   - size cap
   - timeout
   - 413/415/405 responses

5. Close server on shutdown

### Phase 3: Correctness under concurrent events

1. Improve Smart Event dedup key
   - include channel/rule/region if payload supports it
   - keep fallback to eventType only

2. Change `_pendingBodyLink` to queue
   - match by id when possible
   - timestamp nearest fallback
   - ambiguity metric

3. Add body appearance realtime refresh
   - optional `pg_notify('new_event')` after body patch if UI should refresh existing event card
   - avoid repeated spam by notifying once per event body patch

### Phase 4: Observability

Expose in `/api/health/details` or a vendor diagnostics section:

- per-camera stream connected/disconnected
- last message time
- last Smart Event time
- reconnect count
- snapshot success/fail counters
- dedup dropped count
- unmapped event count + last unmapped type
- pending face timeout count
- FAS accepted/rejected count
- body link miss/ambiguous/attached count
- PeopleCounting inserted/skipped count

### Phase 5: Optional product improvements

1. Smart Event overlay on snapshots
   - use `raw_json.detectionRegions`
   - verify coordinate scale per model before drawing

2. Face embedding / pgvector
   - currently planned elsewhere
   - should run after image validation and stable Face Capture fixtures

3. Capability probe
   - query device info/model/firmware
   - query supported event/notification capabilities if available through accessible ISAPI endpoints
   - store non-secret capability snapshot for troubleshooting

## Suggested Module Split

ไม่จำเป็นต้องทำทันที แต่ถ้าไฟล์โตขึ้น ควร split แบบนี้:

```text
src/ingesters/hikvision-isapi.js
src/ingesters/hikvision/multipart.js
src/ingesters/hikvision/event-normalizer.js
src/ingesters/hikvision/face-capture.js
src/ingesters/hikvision/face-alarm-server.js
src/ingesters/hikvision/body-appearance.js
src/ingesters/hikvision/people-counting.js
src/ingesters/hikvision/snapshot.js
src/ingesters/hikvision/diagnostics.js
```

Guideline:

- `hikvision-isapi.js` เหลือเป็น composition root ของ ingester
- parser/normalizer ต้อง pure และมี unit tests
- DB write functions แยกจาก protocol parsing
- อย่าเพิ่ม XML parser dependency ก่อนมี payload ที่ regex helper รับไม่ไหวจริง ๆ

## Test Plan

ขั้นต่ำก่อนแก้ runtime:

```bash
node --check src/ingesters/hikvision-isapi.js
```

หลังเพิ่ม helper tests:

```bash
node --test test/hikvision-*.test.js
```

Runtime smoke กับกล้องจริง:

1. Restart เฉพาะ worker:

```bash
pm2 restart hikvision
```

2. Verify stream:

```bash
pm2 logs hikvision --lines 80 --nostream
```

3. Trigger Smart Event:

- Line Crossing หรือ Field Detection
- ตรวจ `events` insert
- ตรวจ snapshot saved ถ้า `enable_snapshot=true`
- ตรวจ `pg_notify new_event` ทำให้ Live feed เห็น event พร้อมภาพ

4. Trigger Face Capture / Face Alarm:

- ตรวจ face crop/full image
- ตรวจ raw_json fields
- ตรวจ body appearance attach ถูก event

5. Trigger People Counting:

- ตรวจ timeRange window insert
- reconnect แล้ว window เดิมไม่ duplicate

6. Negative smoke:

- FAS wrong IP -> 403
- FAS non-POST -> 405
- oversized body -> 413
- invalid image -> no file written, `_snapshot_status=invalid_image`

## What Not To Change Casually

- อย่า rewrite จาก Alert Stream ไป polling
- อย่าเปลี่ยนกลับไป ffmpeg snapshot extraction สำหรับ event snapshot ถ้า ISAPI picture endpoint ใช้ได้
- อย่าเปิด static media/snapshot path เป็น public
- อย่า hardcode channel `102`; ใช้ `snapshot_stream`
- อย่า remove dedup เพราะ Hikvision active repost ทำ event flood ได้จริง
- อย่าเพิ่ม ORM หรือ framework
- อย่า log camera credentials หรือ full PII payload

## Priority Recommendation

ลำดับที่ควรทำก่อน:

1. **P0:** Fixture tests + extract parser/normalizer helpers
2. **P0:** Hardening Face Alarm Server inbound guard
3. **P1:** `_pendingFaces` key by camera and `_pendingBodyLink` queue
4. **P1:** Image validation + `_snapshot_status`
5. **P1:** Respect `enable_snapshot`
6. **P2:** Dedup key refinement after collecting real payload samples
7. **P2:** Health/diagnostics counters
8. **P3:** Overlay and face embedding improvements

## Final Assessment

ระบบ Hikvision ingester ปัจจุบันไม่ใช่ prototype แล้ว แต่เป็น production integration ที่เดินมาถูกทาง:

- core transport ถูก
- mapping ถูก
- snapshot notify timing ถูก
- Face/Body/PeopleCounting coverage ดี
- incident fixes หลายจุดถูก capture ใน doc

จุดที่ยังต้องทำคือเปลี่ยนจาก "works with current observed payloads" ให้เป็น "resilient against firmware/model variance and concurrent bursts" โดยเน้น tests, parser isolation, inbound hardening, pending-state key correctness, และ observability มากกว่าการ rewrite architecture.
