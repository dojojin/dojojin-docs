# Person Data (body appearance) Redesign → Production deploy plan (phased)

> Created 2026-06-22. Demo เสร็จ: `public/others/demo/body/` (`?v=b1`, commit `ebbbd2d`).
> นี่คือแผน port → prod แบบแบ่ง phase ตาม restart boundary + dependency.
> **BP1–BP3 ✅ COMMITTED (commit `bd5a969`, 2026-06-22, อยู่ใน main).**
> Code-verified 2026-06-25: peak-by-hour chart (:849), by-camera (:866), color swatch (:672-774), search-by-example (:598), cross-link Face (:562), avatar-from-metadata (:499).
> **BP4 ❌ optional — ยังไม่ทำ.**
> ชื่อแผน: **BODY-UI** (phase BP1–BP4). theme เดียวกับ Face (FACE-UI).

## ภาพรวม demo ที่จะ port (2 แท็บ)
**ภาพรวม** = headline KPI (total/peak/top-camera/gender) + peak-by-hour + by-camera +
ทิศทาง(เข้า/ออก) + gender/age/accessory + forensic detail (สี/ประเภท/ผม/อารมณ์) แบบพับเก็บ ·
**ค้นหา** = re-skin + color swatch picker + search-by-example + cross-link Face + เส้นเวลา/ตามคนนี้

## prod ปัจจุบัน (baseline)
- หน้า **ข้อมูลบุคคล** = `dashboard/page-appearance.js` (2 แท็บ ภาพรวม/ค้นหา) — **เครื่องยนต์ forensic
  สมบูรณ์อยู่แล้ว**: Forensic Timeline (AP.5a) + "ตามคนนี้" similarity (AP.5b) + วาดเส้นทางบนแผนที่
- endpoint มีครบ (อ่าน): `GET /api/appearances/search` (filter ครบ) · `/api/appearances/stats`
  (gender/top_cat/bottom_cat/upper_color/lower_color/hair_color/hair_length/accessories/volume/
  age_group/expression/direction) · `/api/appearances/timeline` · `/api/appearances/similar-timeline`
- data = ของเรา (ตาราง `appearances`) — ไม่ใช่ฝั่งกล้องเหมือน FDLib → **แก้ไข/เพิ่ม endpoint ได้อิสระ**
- vocab: `_APP_TOP/_BOT/_HAIR/_COLOR` + `_COLOR_HEX` ใน `page-snapshots.js`

## ⚠️ Dependency / ต้องยืนยันก่อน
- **stats ปัจจุบัน ไม่มี** peak-by-hour + by-camera breakdown → ต้องเพิ่ม (BP1)
- **BP3 (ภาพถูกลบ→avatar จาก metadata):** attribute อยู่ใน column ตาราง `appearances` (คงอยู่แม้ไฟล์รูป
  ถูกลบโดย snapshot retention) แต่จะถูก anonymise ตามค่า runtime `appearances_retention_days` —
  **ห้าม hardcode 30 วันใน UI**. ตอน audit 2026-06-22 runtime = appearance 40 วัน / snapshot 30 วัน.

---

## Phase BP1 — Stats endpoint: peak + by-camera (backend) · restart
**opus (SQL aggregation).**
- [x] extend `GET /api/appearances/stats` — เพิ่ม:
      `peak` (period-adaptive `EXTRACT(hour)` รายวัน / `EXTRACT(dow)` สัปดาห์ / `EXTRACT(day)` เดือน) ·
      `by_camera` (count ต่อ `camera_id` เรียงมากสุด) · KPI aggregate (total, top camera, gender ratio)
- [x] verify e2e กับข้อมูลจริง: HTTP 200, mode `hour/dow/day`, cache miss/hit และ no-filter case
- **restart**

## Phase BP2 — แท็บภาพรวม re-skin + new charts (frontend) · no restart
**sonnet (port demo→pattern).**
- [x] re-skin หน้าภาพรวม → design system (card/token/tab) เหมือน Face
- [x] **A** headline KPI row · **B** peak-by-hour chart (แท่งพีคแดง) · **C** ดัน volume+KPI ขึ้นบน,
      ย้ายกราฟสี/forensic ลง **collapsible** · **D** by-camera breakdown (consume BP1)
- [x] คง distribution เดิมครบ (สี/ประเภท/ผม/อายุ/อารมณ์/ทิศทาง/accessory)
- [x] **CSP** data-action · **i18n th+en** (gotcha #42) · **responsive ≤768px**

## Phase BP3 — แท็บค้นหา re-skin + UX adds + modal (frontend) · no restart
**sonnet.**
- [x] re-skin filter + result cards (body chips + color swatch) ตาม design system
- [x] **color swatch picker** แทน dropdown สี (เสื้อ/กางเกง/ผม)
- [x] **search-by-example** — คลิกผล → autofill filter จาก attribute
- [x] **cross-link Face** — เปิด Face Search ด้วยกล้อง + time window เดียวกัน โดยไม่อ้าง identity match
- [x] detail modal: รูปพรรณครบ + **ภาพถูกลบ→avatar จาก metadata** (อิง retention setting จริง)
- [x] คง engine forensic เดิม (timeline/ตามคนนี้/map route) — **ไม่รื้อ**

## Phase BP4 — ทิศทาง → เข้า/ออก (optional) · restart
**sonnet.**
- [ ] ตั้ง direction ต่อกล้อง (reuse LPR gate pattern) → map leftward/rightward/... เป็น เข้า/ออก
- [ ] ถ้ายังไม่ตั้ง = แสดง ซ้าย/ขวา/หน้า/หลัง ตามเดิม
- **restart** (ถ้าเพิ่ม setting)

---

## Restart boundary + sequencing
- BP1→restart · BP2→no restart · BP3→no restart · BP4→restart(optional)
- ลำดับแนะนำ: **BP1 → BP2 → BP3** (BP3 ค้นหา re-skin ทำก่อนได้ถ้าไม่รอ stats; แต่ overview BP2
  ต้องรอ BP1) → BP4 ทีหลังถ้าต้องการ เข้า/ออก
- รวม restart ฝั่งเรา ~1–2 ครั้ง (BP1 + BP4 optional) — **เบากว่า FACE-UI** เพราะ endpoint มีครบแล้ว

## ของที่คง demo-only (ไม่ port)
- avatar สังเคราะห์ (PDPA) — prod แสดงรูปจริง; avatar ใช้เฉพาะตอนรูปถูกลบ (reconstruction, ภายใน 30 วัน)
- mock rows/charts — prod = query สด

## STOP gates (WA #4)
ทุก phase: PLAN→EXECUTE→AUDIT→**STOP รอ confirm**→COMMIT. ไม่ commit เองก่อน confirm.
