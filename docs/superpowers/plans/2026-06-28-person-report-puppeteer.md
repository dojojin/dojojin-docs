# Person Report → HTML→Puppeteer (รูปการ์ด + แบ่งหน้า)

> 2026-06-28 · owner-approved scope: ทั้ง 167 ใบ / rewrite Puppeteer / PDPA OK / ทาง X (auth `/snapshots`)

## เป้าหมาย
PDF/PNG รายงานบุคคล = preview เป๊ะ: การ์ดใบหน้าผู้ต้องสงสัยทุกใบตามช่วงเวลา,
แบ่งหน้า A4 สวย (ไม่ตัดกลางการ์ด), preview บนจอแบ่งหน้า (pager).

## ทำไม Puppeteer (ไม่ใช่ SVG เดิม)
- SVG สูงตัน 16000px → 167 การ์ดล้น/ถูกตัด
- PDF ฝัง PNG ตัดกลางการ์ดตรงรอยต่อหน้า
- HTML→Puppeteer = engine เดียวกับ Analytics/Health; `break-inside:avoid` แบ่งหน้าสะอาด
- infra พร้อม: `report-print.html/js` มี pattern + **รอ img โหลดครบ** ก่อน __reportReady

## ทาง X (รูปภาพ)
การ์ดใช้ `/snapshots/<f>?w=120` (thumbnail disk-cached, edge=memory-only PDPA-safe).
ต้องแก้ `/snapshots` ให้รับ `X-Internal-Token` (Puppeteer ไม่มี session).
- token server-only, ผู้ถืออ่าน disk ได้อยู่แล้ว, pattern เดียวกับ `/api/stats`
- จำกัด GET + path validation เดิม

## Phases

### P1 — Shared builder (report-template.js)
- `buildFaceReportFull(data, brand, {mode,lang,page,perPage})` → HTML เต็ม:
  header(logo+title+range / brand+tagline+gen) · KPIs · demographics(gender donut canvas + age bar canvas) ·
  accessories tiles · peak canvas · trend canvas · top persons · **suspect cards (img ?w=120)**
  - mode `screen`: suspects ตาม page + `<div id=rptSuspectPager>`
  - mode `print`: ทุกใบ + `.cmp-card{break-inside:avoid}`
- `initFaceReportCharts(data)` → init Chart.js (donut/age/peak/trend)
- reuse esc/_label/_kpis/_personsSection ใน module

### P2 — Preview ใช้ shared builder (page-reports.js)
- `renderFaceReportPreview` → `ReportTemplate.buildFaceReportFull(data,_brand,{mode:'screen',page,perPage:12})`
  + `initFaceReportCharts` + wire `renderPagination('rptSuspectPager',...)`
- ลบ _rptFaceDemoSection/_rptFaceAccessoriesSection/_rptFaceSuspectsSection/_rptBuildFaceCharts (ย้ายเข้า template)

### P3 — Face print page (report-face-print.html + .js)
- mirror report-print.*; params period/group/min_score/sections/lang/site_id
- fetch /api/stats/face/report + /api/branding → buildFaceReportFull(mode:print) → initCharts
- รอ Chart.js paint + ทุก img โหลด → __reportReady
- print CSS: @page A4 + break-inside:avoid

### P4 — Server render (report-renderer.js)
- `renderFaceReportImage` → Puppeteer screenshot print page
- `renderFaceReportPdf` → page.pdf A4 (multi-page)
- ลบ dead SVG face code (_renderFaceReportSvg/FACE_LABELS/donutArc เฉพาะ face) — LPR/Health คง SVG

### P5 — Auth (api-server.js:466)
- `/snapshots`: `if (isValidInternalToken(req)) ข้าม session check` (GET, path validation คงไว้)

### P6 — Reproduce (167 ใบจริง)
- ยิง live /api/reports/face/image + /pdf
- วัด: page count, file size, render time, page-break ไม่ตัดการ์ด, รูปขึ้นครบ

## คงเดิม / ไม่แตะ
- LPR + Health report (SVG) · Analytics report · DPI knob (เฉพาะ LPR/Health ใช้ต่อ)

## เสี่ยง
- render time แรก: gen 334 thumbnail (cached หลังจากนั้น)
- preview verify browser เองไม่ได้ (extension down) → reproduce ผ่าน server render แทน
