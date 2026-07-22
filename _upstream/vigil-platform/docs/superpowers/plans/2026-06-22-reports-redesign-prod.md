# Reports Redesign → Production deploy plan (implementation-ready)

> Created 2026-06-22 · **Rewritten 2026-06-26** (verified against live schema + code,
> demo bumped `?v=r9`). Port `public/others/demo/report/` → prod, phased by restart
> boundary + dependency. ทุก phase เดินตาม Working Agreement #4 (PLAN→EXECUTE→AUDIT→
> **STOP รอ confirm**→COMMIT). เอกสารนี้ออกแบบให้ **Sonnet/Codex หยิบไปเขียนได้ทันที** —
> ทุก path/column/signature ด้านล่าง **verify จาก source จริงแล้ว** (ไม่ใช่ memory).

## 🔑 Verified anchors (2026-06-26 — ใช้ค่าเหล่านี้ ห้ามเดาใหม่)

| สิ่งของ | ค่าจริง | หลักฐาน |
|---|---|---|
| Reports page (prod) | `dashboard/page-reports.js` | — |
| Renderer | `src/report-renderer.js` — analytics=Puppeteer (`report-template.js`) · **health=SVG+sharp** | plan baseline |
| Face events | `events.event_type IN ('FaceCapture','FaceRecognition')` | `routes/faces.js:31,119-122` |
| Face match fields | `raw_json->>'fdLibName' / 'listType'(blackList\|whiteList) / 'similarity' / 'humanId' / 'personName'` | `faces.js:281,297,346` · `hikvision-isapi.js:1043-1162` |
| Face demographics | `raw_json->>'gender' / 'age' / 'ageGroup' / 'faceExpression' / 'mask'` (จาก **FaceCapture** เท่านั้น) | `faces.js:36-104` |
| Face ref image | disk `snapshots/face/ref/<fdLibName>/<humanId>.jpg` | `hikvision-isapi.js:1081` |
| **มี `/api/faces/stats` แล้ว** (FP2) | KPI + demographics + hourly peak (period-aware) | `faces.js:163` |
| **มี `/api/appearances/stats`** (BP1) | body demographics + peak + by-camera | `routes/appearances.js:191` |
| LPR source | `events e JOIN license_plates lp ON lp.event_id = e.id` | `lpr-query.js:253` |
| LPR watchlist | table **`lpr_watchlist`** join `w.plate_number = UPPER(lp.plate_number) AND w.active` (+ `lpr_watchlist_groups` migration 051) | `lpr-query.js:264` |
| license_plates cols จริง | `country` · `region`(จังหวัด) · `vehicle_type` · `color` · `brand` — **ไม่มี `plate_type`** | init.sql:172-222 · mig 036 |
| LPR unknown sentinel | `region = 'ไม่ทราบ'` (province id 0) **หรือ NULL** · `vehicle_type = NULL` (ไม่ใช่ string `'unknown'`) | `lpr-core.js:66,358-359` |
| Face peak helper (proven) | `_facePeriodClause()` + `_BKK`/`_BKK_DAY` + `EXTRACT(HOUR FROM e.event_time AT TIME ZONE 'Asia/Bangkok')` — period vocab = `today\|yesterday\|week\|month\|custom` (**ไม่ใช่** daily/weekly/monthly) | `faces.js:138-180` |
| `/api/faces/stats` params | รับแค่ `period/from/to` — **ไม่รับ** `fd_lib_name`/min_score (floor = `face_similarity_min` setting) | `faces.js:163` |
| LPR alerts route | `routes/lpr-alerts.js` (`GET /api/lpr/alerts`, RF-ALERT, migration 060) | — |
| report_schedules cols | `report_type VARCHAR(16) CHECK(daily\|weekly\|monthly\|health)` · `health_sections JSONB` · `send_day_of_week smallint`(0=Mon..6=Sun) · `send_days_of_month text` | mig 013/015/022 |
| report_schedules **ขาด** | `site_id` (→R5) · `report_family` (→R4) | verified |
| report_history | table มีแล้ว (migration 021) | — |
| CSP /others + dashboard | **ห้าม inline handler** → `data-action="X" data-id="Y"` + central dispatcher | `page-reports.js:540-542` |
| i18n | `dashboard/i18n.js` — เพิ่ม **ทั้ง `th` และ `en`** (gotcha #42) | — |

## ⚠️ 3 corrections สำคัญจาก review (อ่านก่อนเริ่ม R1/R2/R3)

1. **ไม่มีตาราง face-watchlist** (ROADMAP บรรทัด 111 ยืนยัน; `grep face_watchlist db/` = ว่าง).
   Face "กลุ่มเฝ้าระวัง / ผู้ต้องสงสัย" สร้างจาก **FaceRecognition events** (`raw_json->>'fdLibName'` =
   กลุ่ม, `listType='blackList'` = เฝ้าระวัง, ref จาก `face/ref/`) — **ห้าม** join ตาราง watchlist.
   ⚠️ **LPR ต่างจาก Face:** LPR watchlist เป็นของจริง (`lpr_watchlist`) → LPR tab join ได้ตามปกติ.

2. **Scope bar = R5 เท่านั้น.** demo โชว์ scope bar (RBAC+Site) ครอบทุกแท็บ แต่ผูกกับ MS-1..MS-8.
   **R2 ship tabbed shell โดย *ไม่มี* scope bar** (หรือซ่อน/inert). เปิด scope bar ตอน R5 เท่านั้น.

3. **R3 SVG render = ห้าม emoji ใน report doc** (GOTCHAS #25a — librsvg/Pango abort). demo face/LPR
   report doc สะอาดแล้ว (verified). health banner `⚠/✓` ใน demo = browser-only (prod health template
   แยก + `_svgSafeText()` strip อยู่แล้ว). template ใหม่ face/LPR ต้องผ่าน `_svgSafeText()` เสมอ.

> **Theme:** demo = light-only (memory rule 2026-06-25, บังคับใน `report-demo.js` init).
> prod Reports page รองรับทั้ง light/dark ผ่าน token ตามปกติ — ไม่ต้องทำพิเศษ.

---

## Phase R1 — Backend stats endpoints (no UI) · **restart** · model: opus (SQL)

เพิ่ม endpoint อ่านอย่างเดียว ไม่กระทบของเดิม. **Face report เบากว่าที่คิด** เพราะ KPI/demographics/
peak มีใน `/api/faces/stats` (FP2) แล้ว — endpoint ใหม่เพิ่มเฉพาะ top-persons + suspect-hits + trend.

### R1a — `GET /api/stats/face/report` (`src/routes/faces.js`, เพิ่มท้ายไฟล์)
Query params: `?from=ISO&to=ISO&period=today|week|month|custom&group=<fdLibName|all>&min_score=80`
(ใช้ period vocab เดียวกับ `_facePeriodClause` — **ไม่ใช่** daily/weekly/monthly)

> ⚠️ **filter-parity:** `/api/faces/stats` (FP2) **ไม่รับ** `group`/`min_score` (ใช้แค่ period + `face_similarity_min` setting).
> ถ้า report doc โชว์ KPI จาก `/api/faces/stats` (global) ข้าง suspect-hits ที่ filter ด้วย group/min_score → ตัวเลขขัดกันในฉบับเดียว.
> **R1a ต้องคำนวณ KPI เอง** (รับ `group`+`min_score`) ให้ consistency — หรือเพิ่ม param ให้ `/api/faces/stats`. อย่า mix global KPI กับ filtered detail.

```sql
-- top persons (recognition matches grouped by identity)
SELECT raw_json->>'humanId'    AS human_id,
       raw_json->>'personName' AS name,
       raw_json->>'fdLibName'  AS group_name,
       COUNT(*)::int           AS hits,
       MAX(event_time)         AS last_seen
FROM events
WHERE event_type='FaceRecognition'
  AND raw_json->>'listType' IS NOT NULL
  AND (raw_json->>'similarity')::float >= $min_score
  AND event_time >= $from AND event_time < $to
  AND ($group = 'all' OR raw_json->>'fdLibName' = $group)
GROUP BY 1,2,3 ORDER BY hits DESC LIMIT 20;

-- suspect hits (blackList only — แนบ ref image path)
SELECT id, event_time, camera_id,
       raw_json->>'personName' AS name,
       raw_json->>'fdLibName'  AS group_name,
       (raw_json->>'similarity')::float AS score,
       raw_json->>'humanId'    AS human_id   -- ref = <SNAPSHOT_DIR>/face/ref/<fdLibName>/<humanId>.jpg
                                             -- SNAPSHOT_DIR = path.join(__dirname,'..','snapshots') (api-server.js:58)
FROM events
WHERE event_type='FaceRecognition' AND raw_json->>'listType'='blackList'
  AND (raw_json->>'similarity')::float >= $min_score
  AND event_time >= $from AND event_time < $to
ORDER BY event_time DESC LIMIT 50;

-- trend (known=whiteList vs watch=blackList per bucket — ใช้ period clause R1c)
```
- ⚠️ **boundary:** `event_time >= $from AND event_time < $to` ที่โชว์ใน SQL = เฉพาะ period=`custom`. period อื่น (today/week/month) **ต้องใช้ clause จาก R1c** (`_facePeriodClause`) ไม่ใช่ inline `$from/$to` — มิฉะนั้นเสีย BKK boundary.
- demographics + hourly peak: **reuse `/api/faces/stats`** ได้ (ถ้า group/min_score=default); แต่ KPI ที่ filter ดู filter-parity ข้างบน.
- `min_score` ต้อง `>=` `face_similarity_min` (FP6, default 80) — `getSystemSetting(pool,'face_similarity_min')` เป็น floor.

### R1b — `GET /api/stats/lpr/report` (`src/routes/lpr-query.js` หรือ `lpr-alerts.js`)
```sql
-- base ใช้ pattern เดิม: FROM events e JOIN license_plates lp ON lp.event_id = e.id
-- peak (period bucket, R1c) + province(region) + vehicle_type + direction (cameras.lpr_direction)
-- watch hits: reuse RF-ALERT clause —
LEFT JOIN lpr_watchlist w ON w.plate_number = UPPER(lp.plate_number) AND w.active
-- exclude unknown (⚠️ column จริง: ไม่มี plate_type · vehicle_type sentinel = NULL ไม่ใช่ 'unknown'):
WHERE lp.region IS NOT NULL AND lp.region <> 'ไม่ทราบ'
  AND lp.vehicle_type IS NOT NULL
```
- direction มาจาก `cameras.lpr_direction` (in/out, migration 063) join `c.id = e.camera_id`.
- ⚠️ time boundary: ใช้ **period clause R1c** (`_facePeriodClause`/BKK) เหมือน face — อย่า hardcode inline `$from/$to` สำหรับ period today/week/month.
- ⚠️ prod LPR rows = 0 ตอนนี้ → ก่อน finalize sentinel ให้ดูค่าจริงจาก row แรกตอน data ไหล (region อาจเป็น raw province-id string ถ้า `TH_PROVINCE[idx]` miss — `lpr-core.js:187`).

### R1c — peak bucket: **extract proven version จาก faces.js** (อย่าเขียนใหม่)
faces.js มี tz handling ที่ verify แล้ว (psql 2026-06-22: UTC hr 4 = BKK hr 11). **ห้าม hand-write** —
ยกของจริงมา:
```js
// faces.js:140-158 — period clause + BKK boundary helpers (ยกมาตรง ๆ)
const _BKK     = `(NOW() AT TIME ZONE 'Asia/Bangkok')`;
const _BKK_DAY = `${_BKK}::date::timestamp AT TIME ZONE 'Asia/Bangkok'`;
// _facePeriodClause(period, from, to, startIdx) → period ∈ today|yesterday|week|month|custom
// hourly peak bucket ที่ proven แล้ว (faces.js:190):
//   EXTRACT(HOUR FROM e.event_time AT TIME ZONE 'Asia/Bangkok')::int  AS hr   (0-23)
// weekly/monthly = ขยาย pattern เดิม (ใช้ AT TIME ZONE เดียวกัน):
//   weekly  → EXTRACT(DOW FROM e.event_time AT TIME ZONE 'Asia/Bangkok')::int  (0=Sun..6=Sat)
//   monthly → EXTRACT(DAY FROM e.event_time AT TIME ZONE 'Asia/Bangkok')::int  (1-31)
```
- **event_time ใช้กับ `AT TIME ZONE 'Asia/Bangkok'` ได้** (ยืนยันจาก faces.js ที่รันจริง) — อย่าเปลี่ยน expression
- LPR (R1b) ใช้ **bucket expression เดียวกัน** (refactor `_facePeriodClause` → `src/helpers/peakClause.js` ให้ทั้ง face+lpr import ถ้าอยากแชร์; ไม่บังคับ)

### R1 — verify + restart
- [ ] e2e: seed rows + rollback (GOTCHAS #95 — **ห้าม operate prod row แรก**); face/LPR prod rows ปัจจุบัน=0 → ship dormant (เหมือน RF4) คืน `[]`/0 ไม่ throw
- [ ] **restart** api-server (Terminal LAN-safe `scripts/pm2-lan-safe-restart.command`, GOTCHAS #84)
- **Acceptance:** ยิง endpoint ด้วย date range จริง → 200 + shape ตรง demo; min_score floor ทำงาน; ไม่กระทบ endpoint เดิม

---

## Phase R2 — Reports page → tabbed shell + Face/LPR/Health builder · **no restart** · model: sonnet

port demo → prod pattern. **ไม่รวม scope bar** (R5).

- [ ] `dashboard/page-reports.js`: หน้าเดียว → **6 แท็บ** (วิเคราะห์/สุขภาพ/ใบหน้า/ป้ายทะเบียน/ส่งอัตโนมัติ/ประวัติ). คง analytics + health เดิมไว้ในแท็บ 1-2
- [ ] port `rpt-doc` live-preview + Face/LPR builder consume R1a/R1b + `/api/faces/stats`. config: period/section/group/min_score
- [ ] **exec ordering** (กราฟก่อน → รูปท้าย) · Peak graph · ตัด unknown (LPR) / expression gated (`face_show_expression`, FP6)
- [ ] **CSP**: ทุกปุ่ม `data-action="..." data-id="..."` + central dispatcher (pattern `page-reports.js:540`); **ห้าม** inline `onclick`
- [ ] **i18n** (`dashboard/i18n.js`, th+en, gotcha #42): prefix `rpt.*` — เช่น `rpt.tabFace/tabLpr/tabAuto/peak/demographics/suspectHits/topPersons/exportPng/exportPdf/sendLine`
- [ ] **responsive ≤768px**: builder aside stack บน mobile (เทียบ demo `rb-layout`); ตรวจก่อน commit (WA#2-B)
- [ ] reuse CSS จาก demo `report-demo.css` (merge เข้า `index.css` หรือ scope ใต้ `.rpt-doc`)
- **Acceptance:** 4 builder render preview ตรง demo; download stub→R3; ≤768px ผ่าน; 0 inline handler (CSP)

---

## Phase R3 — Server-side render templates (PNG/PDF) · **restart** · model: opus (renderer + no-emoji)

- [ ] `src/report-renderer.js`: เพิ่ม `renderFaceReportImage/Pdf` + `renderLprReportImage/Pdf` = **SVG+sharp** (pattern เดียวกับ `renderHealthReportImage`, **ไม่ใช่** Puppeteer)
- [ ] ทุก text ผ่าน `_svgSafeText()` (strip emoji — GOTCHAS #25a); per-lang dict `FACE_LABELS.{th,en}` + `LPR_LABELS.{th,en}` (pattern `HR_LABELS`)
- [ ] suspect/watch card = `<image>` จาก ref path (face: `face/ref/...` · LPR: `lpr_watchlist` ref) — **PDPA: face อ่อนไหว**, gate admin/auditor
- [ ] wire ปุ่ม download PNG/PDF (R2) → endpoint จริง + reuse ใน auto-send (R4)
- **restart** · **Acceptance:** download PNG/PDF ของ face+LPR ได้จริง; ไม่มี emoji หลุด (render ไม่ abort); A4 page number (PDF)

---

## Phase R4 — Auto-send schedule: family + sections · **restart (migration)** · model: sonnet

- [ ] migration `db/db_migration_<NNN>_report_family.sql` (idempotent):
  ```sql
  ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS report_family VARCHAR(16)
    NOT NULL DEFAULT 'analytics';
  ALTER TABLE report_schedules DROP CONSTRAINT IF EXISTS report_schedules_report_family_check;
  ALTER TABLE report_schedules ADD CONSTRAINT report_schedules_report_family_check
    CHECK (report_family IN ('analytics','health','face','lpr'));
  ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS section_config JSONB;  -- per-family sections/filters
  ```
- [ ] `report-worker` (scheduler) เลือก renderer ตาม `report_family` → LINE send (reuse `report_history` + roster เดิม). คง `send_day_of_week`/`send_days_of_month` logic เดิม
- [ ] schedule editor UI (แท็บ 5): family selector + content sections + LINE recipient (data-action, i18n th+en)
- **restart (migration)** · **Acceptance:** สร้าง schedule family=face → ยิง "run now" → PNG เข้า report_history + LINE; default analytics ไม่พังของเดิม

---

## Phase R5 — Multi-site scope + RBAC · **restart (migration)** · **GATED on MS-1..MS-8** · model: opus (security)

ทำเมื่อ multi-site foundation ลง prod แล้วเท่านั้น (ดู spec `2026-06-21-camera-status-multisite-design.md`).

- [ ] **เปิด scope bar** (Site selector + RBAC viewer) ครอบทุกแท็บ (port จาก demo `scope-bar`)
- [ ] role-based filter ทุก endpoint R1 + schedule + history; `report_schedules.site_id` (migration); `requireSiteAccess` middleware; `/api/sites`
- [ ] site-user เห็นเฉพาะ Site ตน (locked 🔒) · super/admin เลือกรวม/แยก · per-site breakdown เมื่อ "ทุก Site"
- **restart** · **Acceptance:** site-user ถูก scope; cross-site เห็นเฉพาะ super/admin; audit_log ทุก export

---

## Restart boundary + ลำดับ
`R1→restart · R2→no restart · R3→restart · R4→restart(migration) · R5→restart(migration, gated MS)`
**ลำดับ:** R1 → R2 (เห็นผลเร็ว, single-site ใช้ได้) → R3 (export) → R4 (auto-send) → R5 (รอ MS).
รวม restart ฝั่งเรา ~4 ครั้ง (owner รัน Terminal LAN-safe ทุกครั้ง, GOTCHAS #84).

## ของที่ owner จะปรับเอง (ไม่ block)
- **frame รถเฝ้าระวัง (LPR watch card)** — ยังไม่ finalize detail
- ภาพ captured+ref จริง (face/LPR) = `<img>` snapshot + ref — PDPA face = อ่อนไหว (gate role)

## STOP gates (WA #4)
ทุก phase: PLAN→EXECUTE→AUDIT→**STOP รอ confirm**→COMMIT. ห้าม commit เองก่อน confirm.
