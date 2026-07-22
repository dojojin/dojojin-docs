# Face Page Redesign → Production deploy plan (phased)

> Created 2026-06-22. Demo เสร็จ: `public/others/demo/face/` (`?v=f7`, commits
> 693409c → b4c97f6). นี่คือแผน port → prod แบบแบ่ง phase ตาม restart boundary + dependency.
> **เอกสารนี้ = แผน เท่านั้น** (ยังไม่ลงมือ). ทุก phase เดิน Working Agreement #4
> (PLAN→EXECUTE→AUDIT→STOP→COMMIT); STOP รอ confirm ก่อน commit ทุกครั้ง.
> ชื่อแผน: **FACE-UI** (phase FP1–FP6).

## ภาพรวม demo ที่จะ port (4 แท็บ)
ภาพรวม(KPI+กราฟ+strip บุคคลเฝ้าระวัง+ใบหน้าล่าสุด live) · แจ้งเตือนบุคคล(recognition feed:
เฝ้าระวัง/รู้จัก/ไม่พบ + pager 15/หน้า + modal เทียบ + ack + operator note) ·
ค้นหา(filter ครบ + summary + grid + pager + modal) · ตั้งค่า(threshold/retention/ต่อกล้อง)

## prod ปัจจุบัน (baseline)
- หน้า **ข้อมูลใบหน้า** = 3 แท็บ (capture / match / miss): `dashboard/page-face-gallery.js`
  + `dashboard/page-face-matches.js` · หน้า **ข้อมูลบุคคล** (appearance) แยกต่างหาก `page-appearance.js`
- endpoint มีแล้ว (อ่าน): `GET /api/faces` · `/api/faces/summary` (gender/age band/masked) ·
  `/api/faces/counts` · `/api/face-matches` (hits_only/misses_only/fd_lib_name) · `/api/face-matches/groups`
- data 100% มาจากกล้อง (Hikvision FDLib) → platform **อ่านอย่างเดียว** ผ่าน `events.raw_json`
  (`_snapshot`/`_snapshot_full`/`_snapshot_ref`/`_snapshot_body`/`personName`/`listType`/
  `fdLibName`/`similarity`/`faceExpression`/body attrs). **ไม่มี** ตาราง face-watchlist ฝั่งเรา → ตัดแท็บเฝ้าระวังออกแล้ว
- body appearance: `_matchBodyChips()` ใน `page-face-matches.js` มีอยู่แล้ว (jacket/trousers/hair/bag/direction)
- snapshot retention: `enforceSnapshotRetention()` (api-server.js:1285) ลบ **ไฟล์รูป** เกิน N วัน
  แต่ **เก็บ event row** → raw_json attribute ยังอยู่

## ⚠️ Dependency / ต้องยืนยันก่อน
- **FP3 (avatar จาก metadata เมื่อรูปถูกลบ):** ยืนยันว่า `appearances_retention_days` (anonymise 30 วัน)
  + face retention **ไม่ลบ attribute ใน `events.raw_json`** (gender/glass/mask/hat) — ถ้าลบด้วย ต้องดึง avatar
  จากคอลัมน์ที่ยังเหลือ. (snapshot file retention ยืนยันแล้วว่าเก็บ row)
- **FP5 (ack บุคคลเฝ้าระวัง):** ใช้ ack infra ร่วมกับ **RF-ALERT** (แผน LPR `2026-06-21-rf-alert-prod.md`)
  ถ้า RF-ALERT ลง prod ก่อน → reuse table/endpoint เดียวกัน

---

## Phase FP1 — Tabbed shell + port หน้าเดิม (frontend) · no restart
**sonnet (port demo→pattern).**
- [ ] รวม 3 แท็บเดิม (capture/match/miss) → โครงใหม่ **4 แท็บ** (ภาพรวม/แจ้งเตือนบุคคล/ค้นหา/ตั้งค่า)
- [ ] **ค้นหา** = capture gallery เดิม (reuse `/api/faces` + filter bar เดิม + summary + pagination)
- [ ] **แจ้งเตือนบุคคล** = match+miss รวมเป็น feed เดียว (reuse `/api/face-matches`,
      filter เฝ้าระวัง(blackList)/รู้จัก(whiteList)/ไม่พบ(miss) + pager 15/หน้า)
- [ ] **CSP** data-action dispatcher · **i18n th+en** ทุก string ใหม่ (gotcha #42) · **responsive ≤768px**
- ไม่ restart (frontend ล้วน)

## Phase FP2 — แท็บภาพรวม + stats endpoint · restart
**opus (SQL aggregation).**
- [ ] `GET /api/faces/stats` — peak (period-adaptive `EXTRACT(hour)`/`(dow)`/`(day)`) ·
      gender split · age bands · expression distribution (`faceExpression`) — extend `faces.js`
- [ ] KPI 4 ใบ (ทั้งหมด/จดจำได้/เฝ้าระวังที่พบ/ไม่พบ) + 4 กราฟ + strip บุคคลเฝ้าระวัง +
      ใบหน้าล่าสุด live (reuse WS `new_event` หรือ poll)
- [ ] verify e2e (seed + rollback ตาม GOTCHAS #95)
- **restart**

## Phase FP3 — Modal rework (frontend) · no restart
**sonnet.**
- [ ] recognition modal: crop ใบหน้า ↔ ภาพอ้างอิง FDLib (`_snapshot_ref`) คู่กันขนาดเท่ากัน ·
      ฉากเต็ม (`_snapshot_full`) เป็น thumbnail ใต้ crop · ตัด full-body crop (`_snapshot_body`) ออก
- [ ] **Body Appearance** section จาก `_matchBodyChips()` เดิม (จัด vertical, สีตัวเล็ก, ไม่ตกบรรทัด)
- [ ] **ภาพถูกลบ → avatar สังเคราะห์จาก metadata** (gender/glass/mask/hat) + ป้าย "สร้างจาก metadata"
      แทนกล่องว่าง (ต้องยืนยัน attribute survive ตาม Dependency)
- [ ] face detail modal (capture) แบบเดียวกัน · ตัด media/clip
- ไม่ restart

## Phase FP4 — Operator note (migration + endpoint + UI) · restart
**sonnet + migration.**
- [ ] migration: `face_event_notes` (event_id FK, note text, created_by, created_at) idempotent
- [ ] `POST/GET /api/face-matches/:id/note` (auth; `created_by = req.user.username`)
- [ ] UI: free-text box + ปุ่มบันทึก ใน recognition modal (ต้นฉบับจากกล้องไม่มี note field)
- **restart** (migration)

## Phase FP5 — Acknowledge บุคคลเฝ้าระวัง (blackList) · restart
**sonnet (reuse RF-ALERT ack).**
- [ ] ack table + `POST /api/face-matches/:id/ack` (who/when) — **reuse RF-ALERT ack infra ถ้ามี**
- [ ] badge นับบน tab แจ้งเตือนบุคคล + ปุ่มรับทราบใน feed/modal
- **restart**

## Phase FP6 — แท็บตั้งค่า · restart
**sonnet.**
- [ ] similarity threshold · face retention วัน · toggle แสดงสีหน้า/อารมณ์ · เปิด-ปิด capture/recognition ต่อกล้อง
- [ ] เก็บใน `system_settings` (extend `/api/health/details` ถ้าจำเป็น ตาม CLAUDE.md #12)
- **restart**

---

## Restart boundary + sequencing
- FP1→no restart · FP2→restart · FP3→no restart · FP4→restart(migration) · FP5→restart · FP6→restart
- ลำดับแนะนำ: **FP1 → FP2** (เห็นผลเร็ว: โครงใหม่ + ภาพรวม) → FP3 (modal polish) →
  FP4 (note) → FP5 (ack, ร่วมกับ RF-ALERT) → FP6 (settings)
- รวม restart ฝั่งเรา ~4 ครั้ง (owner รัน Terminal LAN-safe ทุกครั้ง — GOTCHAS #84)

## ของที่ยังเป็น demo-only (ไม่ port)
- avatar สังเคราะห์ (PDPA) — prod แสดงรูปจริง; avatar ใช้เฉพาะตอนรูปถูกลบ (reconstruction)
- mock rows/charts — prod = query สด

## STOP gates (WA #4)
ทุก phase: PLAN→EXECUTE→AUDIT→**STOP รอ confirm**→COMMIT. ไม่ commit เองก่อน confirm.
