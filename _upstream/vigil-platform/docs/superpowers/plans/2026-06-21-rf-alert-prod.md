# RF-ALERT → Production deploy plan (watchlist-hit alarm + การแจ้งเตือน page)

> Created 2026-06-21. Demo เสร็จ (`public/others/demo/`, `?v=rf10`). นี่คือแผน port → prod.
> Architecture decided (advisor-reviewed): **derive at query time + thin ack table + ws-bridge reuse**.
> ห้ามทำ materialize-at-ingest (B) — inject watchlist logic เข้า CIB-critical path โดยไม่จำเป็น.

## ⚠️ HEADLINE — ships DORMANT
DB ปัจจุบัน: **0 anprAlarm, 0 license_plates, 0 active watchlist** (เหลือ 3 seed groups).
LPR ยังไม่ ingest เข้าเรา (กล้องชี้ CIB ตรง). feature นี้ deploy แล้วจะ **ว่างเปล่าจนกว่า LPR cutover**
— posture เดียวกับ RF4 retention / CS7 (ship dormant, live verify ตอน cutover). ทดสอบตอนนี้ = seed + delete by id.

## CORRECTNESS CORE — match predicate (อย่า inherit ของเดิมมาเฉย ๆ)
ปัญหา: `/api/lpr/stats` ใช้ `w.plate_number = UPPER(lp.plate_number) AND w.active` — มี 2 บั๊ก:
1. **ไม่เคารพ `alert_mode`** — `plate_region` entry จะ match แค่ป้าย → **false warrant alert** กับรถป้ายซ้ำคนละจังหวัด
2. **whitespace** — watchlist เก็บ `"1กข 1234"` (เว้นวรรค), license_plates เก็บ `"1กข1234"` → `=` miss ทุก hit

**Fix = shared SQL clause เดียว** (mirror `periodClause` pattern) ใช้ทั้ง stats KPI + alerts list + ws-bridge:
```sql
-- lprWatchMatchClause(): normalize whitespace ทั้งสองฝั่ง + honor alert_mode
REPLACE(UPPER(lp.plate_number),' ','') = REPLACE(w.plate_number,' ','')
AND w.active
AND ( w.alert_mode = 'plate'
   OR (w.alert_mode = 'plate_region' AND lp.region IS NOT NULL AND lp.region = w.region) )
```
> ⚠️ whitespace direction = 🟡 จนกว่ามี sample จริงตอน cutover (0 rows ตอนนี้). normalize ทั้งสองฝั่ง = robust ทั้งกรณีมี/ไม่มีเว้นวรรค.
> แก้ stats KPI ด้วยในเฟสเดียวกัน — เลข KPI / list length / live push จะได้ไม่ divergent.

---

## Phase A1 — Backend read path + ack (1 restart)
**Model: opus (auth write + SQL).** ไฟล์: `src/routes/lpr-alerts.js` (ใหม่) + migration + แก้ stats.

- [ ] migration `db/db_migration_lpr_alert_acks.sql` (idempotent): table `lpr_alert_acks`
      (`event_id BIGINT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE`, `acked_by TEXT`, `acked_by_id INT`, `acked_at TIMESTAMPTZ DEFAULT NOW()`).
- [ ] shared `lprWatchMatchClause()` (ใน lpr-query.js หรือ helper) — ใช้ร่วม stats + alerts.
- [ ] แก้ `/api/lpr/stats` watch-count ให้ใช้ clause ใหม่ (เคารพ alert_mode + whitespace).
- [ ] `GET /api/lpr/alerts` (requireAuth): join `events ⨝ license_plates ⨝ lpr_watchlist ⨝ groups`
      `LEFT JOIN lpr_alert_acks`, filters `period/group/q`, **server-side `LIMIT/OFFSET`**, `X-Total-Count`.
      คืน: plate, region, vtype, vcolor, pcolor, lane, conf, cam, event_time, snapshot(scene+plate paths),
      group{name,color}, alert_mode, note(`w.notes`), ref_image, acked_by, acked_at.
- [ ] `POST /api/lpr/alerts/:eventId/ack` (requireAuth): upsert `acked_by=req.user.username, acked_by_id=req.user.id`.
- [ ] register ใน api-server.js (`require('./routes/lpr-alerts')(app, pool, {SNAPSHOT_DIR})`).
- [ ] **verify e2e:** seed 1 watchlist + 1 matching event+license_plate (ทั้งกรณีเว้นวรรค/ไม่) → GET คืน hit, ack POST เขียน acked_by, GET สะท้อน acked → **DELETE by inserted id** (GOTCHAS #95). ตรวจ plate_region negative case (คนละจังหวัด = ไม่ match).
- **DEPLOY:** migration + route apply ตอน api-server **RESTART** (Terminal LAN-safe, GOTCHAS #84).

## Phase A2 — Frontend: alarm strip + การแจ้งเตือน tab + modal (no restart)
**Model: sonnet (port demo → prod pattern).** ไฟล์: `page-lpr.js`, `index.html`, `index.css`, `i18n.js`, `page-nav-bindings.js`.

- [ ] alarm strip บน overview (ต่อจาก KPI, 4 คันล่าสุด, หัวข้อ "เฝ้าระวังที่ตรวจพบ") ← `GET /api/lpr/alerts?limit=4`.
- [ ] tab "การแจ้งเตือน" (เพิ่มใน `_switchLprTab` panels) — period/group filter + search + **pagination 15/หน้า server-side**
      (`limit=15&offset=`), badge นับวันนี้.
- [ ] alert detail modal `#alertModal` (port จาก demo): captured(scene+real-crop+plaque) เทียบ reference image,
      ปุ่มดูรูปขนาดเต็ม/อ้างอิง→lightbox, หมายเหตุล่างสุด, **กดนอกกรอบไม่ปิด (X เท่านั้น)**,
      ปุ่ม **รับทราบ → POST ack** + แสดง acked_by/at. image-deleted fallback (RF4 plaque/vehicle-vector มีอยู่แล้ว).
- [ ] **CSP**: ทุก handler ผ่าน `data-action`/dispatcher (ACTION_MAP) ห้าม inline (gotcha LPR #1).
- [ ] i18n th+en ทุก string ใหม่ (gotcha #42).
- [ ] **responsive ≤768px** ตรวจก่อน commit (WA #2-B): compare stack 1-col, pager wrap, strip scroll.
- [ ] reference image source = `lpr_watchlist.ref_image` (warrant photo upload, RF3 มี endpoint แล้ว) แสดงคู่ captured.

## Phase A3 — Real-time push (no restart, ws-bridge เป็น api-server = restart)
**Model: opus (cross-process WS).** ไฟล์: `api-server.js` ws-bridge.

- [ ] ใน ws-bridge `new_event` handler: ถ้า event เป็น anprAlarm **และ** plate ∈ active watchlist (ใช้ shared clause ผ่าน query)
      → `broadcast({type:'lpr_alert', alert:{...}})` (นอกเหนือ new_event เดิม).
- [ ] dashboard: รับ `lpr_alert` → prepend alarm strip + bump badge (+ optional toast).
- [ ] **dormant จนกว่า LPR ingest กลับมา** — ไม่มี live push จนกล้องชี้เรา/Way1 pull เปิด.
- **DEPLOY:** api-server **RESTART**.

## Phase A4 — LINE instant alert (DEFERRED)
`lpr_watchlist.notify_line` + alert_mode → ยิง LINE ตอน hit. ต้อง wire alert-worker / line-sender
(แยก concern, ไม่อยู่ใน critical path). ทำตอน LPR ingest จริงกลับมา + owner สั่ง.

---

## Restart boundary summary
- A1 (migration+routes) → restart · A2 (frontend) → no restart · A3 (ws-bridge) → restart · A4 deferred.
- รวม restart 2 ครั้ง (A1, A3) — หรือรวม A1+A3 ปล่อยทีเดียวถ้าทำต่อกัน.
- ทุก restart = owner รัน Terminal LAN-safe (`open -a Terminal scripts/pm2-lan-safe-restart.command`, GOTCHAS #84).

## STOP gates (WA #4)
แต่ละ Phase: PLAN→EXECUTE→AUDIT→**STOP รอ confirm**→COMMIT. ไม่ commit เองก่อน confirm.
