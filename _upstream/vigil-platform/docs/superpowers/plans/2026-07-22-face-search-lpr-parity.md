# Face Data Search — LPR-Parity Roadmap

**Status:** 📋 PLANNED — เขียนไว้ล่วงหน้าตามคำขอเจ้าของ ยังไม่ execute
**Trigger:** เจ้าของตัดสินใจเริ่มยกระดับ "ข้อมูลใบหน้า" ให้ค้นหา/แสดงผลละเอียดเท่า LPR
**Date:** 2026-07-22
**Scope:** ยก Face Gallery / Face Matches / Person Data (appearances) ให้ใช้กลไก
เดียวกับที่ LPR ใช้อยู่ (component เดิม ไม่สร้างใหม่) + วางเส้นทางสำหรับ
"ค้นหาด้วยตัวตน" (identity search) ซึ่งเป็นคนละงานจาก attribute search
**Author:** Prakasit Rochanavipart (Dojo-mAn)
**เกี่ยวข้อง:** [docs/REF_face-recognition.md](../../REF_face-recognition.md) (§2
Option B pgvector — ยังไม่ implement), memory `project_face_redesign.md`
(watchlist tab ถูกถอดไปแล้ว — เหตุผลด้านล่าง)

---

## ทำไมต้องแยกเป็น 2 แกน ก่อนวางแผนอะไรทั้งนั้น

คำขอ "ค้นหาใบหน้าให้ละเอียดเหมือน LPR" ฟังดูเป็นงานเดียว แต่จริงๆ คือ 2 งานที่
ต้นทุนต่างกันเป็นสิบเท่า:

| แกน | LPR ทำอะไร | Face ทำอะไรได้ตอนนี้ | ต้นทุน |
|---|---|---|---|
| **1. Attribute search** — กรองด้วยคุณสมบัติ (สี, เพศ, อายุ, ประเภท) | multi-filter + pagination + chart ครบทุก tab | มีอยู่แล้วแต่ **กระจัดกระจาย** 3 หน้า (Gallery/Matches/Appearances) คนละ pattern | งาน UI/query รวม component — ทำได้เลย |
| **2. Identity search** — "นี่ใคร" ค้นด้วยชื่อ/ความเหมือน | ค้นป้ายทะเบียนด้วย string ตรงๆ (`plate_number ILIKE`) — plate เป็น string ที่แน่นอน | ใบหน้าไม่มี "string" ให้ค้น ต้องเทียบ embedding (similarity) — **โครงสร้างพื้นฐานยังไม่มี** | ผูกกับ FR.3 (pgvector) ที่ยังไม่ build — ดู REF_face-recognition.md §2 |

**Phase 0-2 ด้านล่าง = แกน 1 (ทำได้ตอนนี้). Phase 3 = แกน 2 (รอ FR.3)."** ห้ามสับสน
ว่าทำ Phase 0-2 ครบแล้ว = ได้ "ค้นหาเหมือน LPR" เต็มรูปแบบ — แกน 2 ต่างหากที่เป็น
ของที่ LPR plate-search เทียบเคียงได้จริงๆ

### Watchlist parity — ไม่ใช่เป้าหมายของแผนนี้ (ตัดสินใจไปแล้วก่อนหน้านี้)

LPR watchlist = platform เก็บ/แก้ป้ายทะเบียนเองได้เต็มที่ (ข้อมูลเป็นของ platform)
Face ตรงข้าม — enrollment (ลงทะเบียนใบหน้าที่รู้จัก) ทำที่กล้อง Hikvision FDLib
เท่านั้น platform **push/enroll ไม่ได้** → เคยตัดสินใจไปแล้วตอน Face redesign
(2026-06-22) ว่า "watchlist tab dropped — face read-only platform-side" สิ่งที่
Face Matches ทำได้ตอนนี้ (ack + list_type filter) คือเพดานสูงสุดแล้วโดยไม่เพิ่ม
camera-side integration ใหม่ — แผนนี้ไม่เสนอสร้าง watchlist CRUD ฝั่ง Face

---

## Phase 0 — Component parity (attribute axis, ทำได้ทันที)

เป้าหมาย: ทุกหน้า Face ใช้ shared component ชุดเดียวกับ LPR แทนของที่ต่างกันอยู่

| Component | LPR ใช้อยู่ | Face Gallery | Face Matches | Person Data |
|---|---|---|---|---|
| `renderPagination` (jump-to-page) | ✅ | **❌ ไม่มีเลย** | ✅ มีแล้ว | ✅ มีแล้ว |
| `MultiPicker` (multi-select filter) | ✅ | native `<select>` | ต้องเช็ค | ต้องเช็ค |
| AirDatepicker range preset (วันนี้/เมื่อวาน/7วัน/1เดือน) | ✅ | ❌ (from/to เปล่าๆ ไม่มี preset) | ต้องเช็ค | ✅ มีแล้ว (`setAppRange`) |
| Chart.js breakdown tile pattern (`_renderLprCharts`) | 7 charts | มี demographic summary แต่คนละ pattern | ไม่มี | ไม่มี |

**งานหลัก:** เพิ่ม `renderPagination` ให้ Face Gallery ก่อน (ตอนนี้ fetch ครั้งเดียว
จบ ไม่มีปุ่มหน้าถัดไปเลย) — ใช้ pattern เดียวกับ `loadLprNoRead`/`loadAppearanceSearch`
เป๊ะๆ (`limit`/`offset` params + `X-Total-Count` header ที่ backend `/api/faces`
มีอยู่แล้ว ไม่ต้องแก้ backend). ตามด้วย MultiPicker + date-range preset ให้ตรงกับ
LPR/Appearances

**ไม่ต้องแตะ:** อย่าทำ OFFSET→keyset pagination conversion — วัดจริงในเซสชันนี้
(CEN-005, 2026-07-22) แล้วว่า offset ไม่ใช่คอขวดที่ scale ปัจจุบัน (LPR no-read/
Appearances ช้าเพราะ join plan ไม่ใช่ offset depth) ใช้ `renderPagination` เดิมได้เลย

## Phase 1 — Chart/stats parity

เพิ่ม breakdown chart ให้ Face Gallery ตาม pattern `_renderLprCharts` (page-lpr.js):
hourly histogram, per-camera breakdown เป็นอย่างน้อย (province/vtype/brand ไม่มี
equivalent ฝั่ง face — ข้ามได้) ใช้ endpoint `/api/faces/summary` ที่มีอยู่แล้วเป็นฐาน
ขยาย response ให้มี hourly/per-camera breakdown เพิ่ม (mirror `lpr-query.js` KPI
query shape)

## Phase 2 — โครงสร้างหน้า (product decision — ต้องถามเจ้าของก่อนทำ)

LPR รวมทุกอย่างไว้ใต้หน้าเดียวแบบ tab (ภาพรวม/ไม่พบทะเบียน/แจ้งเตือน/ตั้งค่า)
ส่วน Face กระจายเป็น 3 หน้าแยก (Gallery/Matches/Person Data) คนละเมนู

**ทางเลือก:**
- **(a) คงแยก 3 หน้า** แค่ทำให้แต่ละหน้าใช้ component เดียวกัน (Phase 0-1 พอ)
- **(b) รวมเป็นหน้าเดียวแบบ tab เหมือน LPR** ("ข้อมูลใบหน้า" → tab ภาพรวม/ค้นหา/
  จับคู่/ตั้งค่า) — งานใหญ่กว่า กระทบ routing + เมนู sidebar + i18n keys จำนวนมาก

ไม่ตัดสินใจในแผนนี้ — เสนอ (a) ก่อนเพราะความเสี่ยงต่ำกว่ามาก ถ้าเจ้าของอยากได้
IA แบบ LPR จริงๆ (b) ค่อยแยกเป็นแผนของตัวเอง

## Phase 3 — Identity search (แกน 2) — **GATED บน FR.3, ยังเริ่มไม่ได้**

นี่คือของที่เทียบเท่า "ค้นป้ายทะเบียนด้วย string" ของฝั่งใบหน้าจริงๆ — ต้องมี:
1. Face embedding extraction service (InsightFace/DeepFace) — REF_face-recognition.md §2 Option B
2. `pgvector` extension + `known_persons` table + cosine similarity query
3. UI "ค้นด้วยรูป" (upload/เลือกใบหน้าอ้างอิง → ระบบคืนใบหน้าที่คล้ายกัน) — คนละ
   UX จาก text-search ของ LPR (ไม่มี "พิมพ์ชื่อแล้วเจอ" เพราะไม่มี ground-truth
   identity ต่อ event จนกว่าจะ match)

**Prerequisite:** FR.3 ต้อง implement ก่อน (สถานะปัจจุบัน: ยังไม่เริ่ม — ดู
REF_face-recognition.md บรรทัดบนสุด) แผนนี้ไม่ duplicate รายละเอียด FR.3 — อ้างอิง
ไฟล์นั้นเมื่อถึงเวลาจริง

---

## ลำดับแนะนำ

Phase 0 → 1 ก่อน (ความเสี่ยงต่ำ, ใช้ component/endpoint ที่มีอยู่แล้วทั้งหมด,
ไม่แตะ backend มาก) → Phase 2 เป็น checkpoint ถามเจ้าของอีกที (a หรือ b) → Phase 3
รอ FR.3 แยกต่างหาก ไม่ผูกกับ timeline ของ Phase 0-2
