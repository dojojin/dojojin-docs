# Hikvision Ingester Hardening — Phase Plan

> วันที่วางแผน: 2026-06-18
> Source: CODEX/CODEX_HIKVISION_Ingester(Suggestion).MD — verified ด้วย spot-check จากโค้ดจริง
> เอกสารอ้างอิง: `src/ingesters/hikvision-isapi.js`, `docs/LOGIC_hikvision-ingester.md`

## ภาพรวม

Hikvision ingester ปัจจุบัน **production-ready ในแง่ transport และ mapping** แต่มีจุด hardening ที่ต้องทำก่อนระบบโตขึ้น:

- Face Alarm Server (FAS) เป็น inbound HTTP surface ที่มี guard น้อยที่สุด
- Snapshot เขียน raw bytes โดยไม่ validate
- Pending state ใช้ key หยาบเกินไปสำหรับ multi-camera concurrent events
- ขาด observability ทำให้ debug ต้องเปิด pm2 logs เสมอ

ลำดับ: Phase 1 → 2 → 3 → 4 (concurrent กับ 6) → Phase 5 รอ payload จริง

---

## Phase 1: FAS Inbound Hardening ⚡ (ทำก่อนสุด — security)

**ไฟล์:** `src/ingesters/hikvision-isapi.js` (function `startFaceAlarmServer`)

**Pre-condition ก่อนลงมือ:**
- โหลด `docs/REF_security-checklist.md` + review GOTCHAS #50–57 (CLAUDE.md #17 บังคับ — แตะ inbound HTTP + multipart upload)

### สิ่งที่ต้องทำ

| # | งาน | รายละเอียด |
|---|---|---|
| 1.1 | POST-only guard | `req.method !== 'POST'` → `res.writeHead(405); res.end()` |
| 1.2 | Content-Type guard | ต้องเป็น `multipart/*` → `res.writeHead(415); res.end()` |
| 1.3 | Body size cap | สะสม chunks ตรวจ total bytes ≤ `FAS_MAX_BODY_BYTES` (default 10 MB) → `res.writeHead(413); res.end()` |
| 1.4 | Request timeout | `req.setTimeout(10_000)` → destroy request + log |
| 1.5 | Reject unknown camera | `findCamByIp(src)` ไม่เจอ → log warning + `res.writeHead(403); res.end()` — ลบ fallback `{ camera_id: src }` |
| 1.6 | Multi-IP allowlist | `FACE_PUSH_ALLOW` รองรับ comma-separated list → `Set<string>` |
| 1.7 | Parse boundary จาก Content-Type | `parseBoundary(req.headers['content-type']) \|\| 'boundary'` แทน hardcode ใน `parseFaceAlarmMultipart` |
| 1.8 | Store + close server | `const _faceAlarmServer = startFaceAlarmServer()` → `_faceAlarmServer?.close()` ใน `shutdown()` |

**ข้อห้าม:** อย่า expose FAS port ออก internet, อย่า trust payload ขนาดใหญ่โดยไม่ cap

**Verify after:**
- FAS wrong IP → 403
- FAS non-POST → 405
- FAS oversized body → 413
- FAS unknown camera → 403 + log
- FAS valid POST → 200 + event insert ปกติ

---

## Phase 2: Snapshot Defense

**ไฟล์:** `src/ingesters/hikvision-isapi.js` (function `captureSnapshot`)

**Pre-condition:** Phase 1 เสร็จ (ไม่ blocking แต่ควรทำต่อกัน)

### สิ่งที่ต้องทำ

| # | งาน | รายละเอียด |
|---|---|---|
| 2.1 | Respect `enable_snapshot` | ถ้า `cam.enable_snapshot === false` → skip capture, set `_snapshot_status: 'disabled'` |
| 2.2 | Validate HTTP status | response ≠ 200 → `_snapshot_status: 'http_error'` |
| 2.3 | Validate Content-Type | response Content-Type ต้องเป็น `image/*` → มิฉะนั้น `_snapshot_status: 'invalid_image'` |
| 2.4 | JPEG magic bytes | ตรวจ `0xFF 0xD8` (SOI) ที่ offset 0 ของ buffer — tolerant check |
| 2.5 | Max size cap | ≤ `SNAPSHOT_MAX_BYTES` (default 10 MB) → `_snapshot_status: 'too_large'` |
| 2.6 | `_snapshot_status` field | เพิ่มใน `raw_json`: `ok` / `disabled` / `http_error` / `timeout` / `invalid_image` / `too_large` / `write_failed` |

**เหตุผล:** ตอนนี้กล้องที่คืน HTML error page ด้วย HTTP 200 จะถูกเขียนเป็น `.jpg` บน disk โดยไม่มีการตรวจสอบ

**Verify after:**
- กล้องที่ `enable_snapshot: false` → ไม่มีไฟล์ถูก write, status = `disabled`
- HTTP 200 + Content-Type `text/html` → ไม่มีไฟล์ถูก write, status = `invalid_image`
- buffer เริ่มต้นไม่ใช่ `FF D8` → ไม่มีไฟล์ถูก write, status = `invalid_image`

---

## Phase 3: Pending State Key Correctness

**ไฟล์:** `src/ingesters/hikvision-isapi.js` (sections `_pendingFaces`, `_pendingBodyLink`)

**Pre-condition:** Phase 2 เสร็จ

### สิ่งที่ต้องทำ

**3A — `_pendingFaces` camera-scoped key**

| # | งาน | รายละเอียด |
|---|---|---|
| 3.1 | เปลี่ยน key | จาก `face.pId` → `` `${cam.camera_id}|${face.pId}` `` |
| 3.2 | อัปเดต set/get/delete ทุกจุด | ทุก `_pendingFaces.set/get/delete` ต้องใช้ composite key |
| 3.3 | อัปเดต image routing | ส่วนที่ match image part ต้องรู้ `camera_id` ก่อน lookup |

**ปัญหาปัจจุบัน:** กล้อง A และ B อาจส่ง `pId` ซ้ำกันได้ → pending entry ชนกัน face crop ไปผิดกล้อง

**3B — `_pendingBodyLink` queue**

| # | งาน | รายละเอียด |
|---|---|---|
| 3.4 | เปลี่ยนเป็น queue | `Map<camera_id, Array<{eventId, ts}>>` แทน single-slot |
| 3.5 | Expire entries เกิน 10s | sweep ก่อน push และก่อน match |
| 3.6 | Nearest-timestamp match | เลือก entry ที่ `ts` ใกล้กับ body event time มากที่สุด |
| 3.7 | Log metrics | `body_link_attached`, `body_link_miss`, `body_link_ambiguous` |

**ปัญหาปัจจุบัน:** face recognition 2 event ซ้อนกันใน 10 วินาที → body appearance patch ไปผิด event

**Verify after:**
- trigger face capture 2 กล้องพร้อมกัน → แต่ละกล้องได้ body appearance ของตัวเอง
- trigger face recognition ซ้อนกันเร็ว → log `body_link_ambiguous` ถ้า resolve ไม่ได้

---

## Phase 4: Observability

**ไฟล์:** `src/ingesters/hikvision-isapi.js` + `src/routes/health.js` (หรือ `src/routes/cameras.js`)

**Pre-condition:** Phase 3 เสร็จ (metrics จาก Phase 3 เป็นส่วนหนึ่ง)

### Counters ที่ต้องเพิ่ม

**Per-camera stream status:**
- `alert_stream_connected` (boolean)
- `last_stream_message_at` (timestamp)
- `last_event_type` (string)
- `last_reconnect_at` (timestamp)
- `reconnect_count` (number)
- `last_error_code` (string)

**Per-camera event counters:**
- `snapshot_ok` / `snapshot_fail` / `snapshot_disabled`
- `dedup_dropped`
- `unmapped_event_count` + `last_unmapped_type`
- `pending_face_timeout_count`

**FAS counters (global):**
- `fas_accepted` / `fas_rejected` / `fas_unknown_src`

**Body link counters (ได้จาก Phase 3):**
- `body_link_attached` / `body_link_miss` / `body_link_ambiguous`

**Expose ผ่าน:** `/api/health/details` ต่อ camera section (extend ของเดิม ไม่สร้าง endpoint ใหม่ — CLAUDE.md note #12)

---

## Phase 5: alertStream Boundary + Dedup Key *(รอ payload จริงก่อน)*

**Pre-condition:** มี XML payload samples จากกล้องจริงที่ deploy ก่อนทำ

### สิ่งที่ทำได้เลย (low risk)

| # | งาน | รายละเอียด |
|---|---|---|
| 5.1 | Parse boundary จาก alertStream Content-Type | `parseBoundary(res.headers['content-type']) \|\| 'boundary'` แทน `_BOUNDARY = Buffer.from('--boundary')` |

### สิ่งที่ต้องรอ payload ยืนยัน

| # | งาน | เงื่อนไข |
|---|---|---|
| 5.2 | Dedup key เพิ่ม `channelID` | ตรวจ XML payload จากกล้องจริงว่า channelID มาสม่ำเสมอทุกรุ่น |
| 5.3 | Dedup key เพิ่ม rule/region id | รวบรวม payload samples จาก multi-zone config ก่อน |

**ข้อควรระวัง:** dedup key พัง = event flood ใน production — อย่าเดา field จาก doc

---

## Phase 6: Fixtures + Helper Extraction *(คู่ขนาน Phase 3/4)*

**ไม่ blocking แต่มีคุณค่าสูงเมื่อมีก่อนแก้ runtime**

| # | งาน | รายละเอียด |
|---|---|---|
| 6.1 | Fixture files | `test/fixtures/hikvision/alertstream-smart-event.multipart`, `alertstream-face-capture.multipart`, `face-alarm.multipart`, `people-counting.xml` |
| 6.2 | Extract pure parser | `parseMultipartBuffer(buffer, { boundary, requireContentLength })` → pure function ไม่มี side effects |
| 6.3 | node --test | test multipart parser, normalizer, image validation |
| 6.4 | Module split (optional, ไม่เร่ง) | แยกเมื่อไฟล์ใหญ่เกินจัดการ: `hikvision/multipart.js`, `face-alarm-server.js` ฯลฯ |

---

## ข้อห้ามตลอด (จาก CODEX analysis + DECISIONS.md)

- อย่า rewrite จาก Alert Stream ไป polling
- อย่าเปลี่ยนกลับไป ffmpeg snapshot extraction สำหรับ event snapshot
- อย่า remove dedup เพราะ Hikvision active repost ทำ event flood ได้จริง
- อย่าเพิ่ม ORM หรือ XML parser library โดยไม่จำเป็น (decision #97)
- อย่า log camera credentials หรือ full PII payload
- อย่า expose FAS port หรือ camera ISAPI ออก internet

---

## Phase 7 (เพิ่ม 2026-06-19): Camera Role / Capability — เลิกเดา ingester จาก IP

> ที่มา: ทบทวนระบบ LPR/Face (2026-06-19). พบว่า `cameras` table **ไม่มี field
> vendor/role/type** เลย — vendor อยู่ใน `cameras-config.json` เท่านั้น และกล้อง
> Hikvision 1 vendor มี **3 บทบาท ingestion ต่างกันสิ้นเชิง** ที่ตอนนี้แยกด้วยการ
> **เดาจาก IP** (push มาที่ endpoint ไหน):

| บทบาท | ingestion path | endpoint |
|---|---|---|
| CCTV / Smart events | ISAPI poll + FAS | poll |
| Face capture / recognition | FAS push | FAS |
| **LPR / ANPR** | HTTP push | `/lpr` (แยกด้วย IP) |

### สิ่งที่ต้องทำ

- เพิ่ม field **`role`** (หรือ `capabilities[]`) ใน `cameras-config.json` ก่อน — เช่น
  `'lpr' | 'face' | 'cctv'` (config-first, ตรง pattern `vendor` เดิม; ยกขึ้น DB column
  ตอนทำ camera-management UI ภายหลัง)
- **3 สิ่งที่ `role` ต้องขับ:**
  1. **เลือก ingester + push endpoint** ที่รับกล้องนี้ — **เลิกเดาจาก IP**
     (โยงตรงกับ **Phase 1 §1.5 "reject unknown camera"** — มี `role` แล้ว FAS/`/lpr`
     จะ validate ได้ว่ากล้องนี้ "ควร" push มา endpoint นี้จริง ไม่ใช่แค่ IP match)
  2. **ขับ UI categorization** — กล้องโผล่ในหน้า LPR / Face / CCTV ตาม role
  3. **gate feature ต่อกล้อง** — เปิด/ปิดความสามารถตาม role (เช่น กล้อง CCTV
     ไม่ต้องโชว์ตัวเลือก LPR/Face)

### Verify after
- กล้อง `role:'lpr'` push มา `/lpr` → รับ · push มา FAS → reject (ผิด role)
- UI หน้า LPR แสดงเฉพาะกล้อง `role:'lpr'`

> หมายเหตุ: Phase นี้ **independent** จาก P1–P6 แต่ **เสริม P1** (reject-unknown-camera
> จะแกร่งขึ้นเมื่อมี role ประกอบ IP). ทำ config-first ได้เลย ไม่ blocking.

---

## Deferred (ไม่อยู่ใน plan นี้)

| Feature | เหตุผลที่ defer |
|---|---|
| Detection overlay บน snapshot | Hikvision coordinate scale ต่างกันต่อรุ่น — ต้อง verify กับกล้องจริงก่อนวาด |
| pgvector / face embedding | ต้องการ GPU server + InsightFace Python service + pgvector schema — งานใหญ่ รอ Phase FR ใน ROADMAP |

---

## ลำดับสรุป

```
Phase 1  ──►  Phase 2  ──►  Phase 3  ──►  Phase 4
FAS guard     Snapshot       Pending        Health
(security)    defense        keys           counters
                         ◄──────────────────────────
                         Phase 6 (fixtures) คู่ขนาน

Phase 5 ── รอ payload จริงจากกล้อง (ไม่ blocking อื่น)
```
