# CLAUDE.md — Vigil Platform

> **Project context handoff document for AI assistants (Claude Code, future chat sessions, etc.)**
> Last updated: 2026-09-06 · Owner: Prakasit Rochanavipart (Dojo-mAn)
> Current version: **v1.5.4** · live at `https://dashboard.dojojin.tech`
>
> **What changed:** this file used to hold everything (~1,750 lines).
> It was slimmed on 2026-05-23 to 4 top blocks + pointers — detail
> moved to companion files. See [Documentation Map](#-documentation-map)
> below.
> · 2026-05-27 — Working Agreement #2 ขยายเป็น **UI-design-first**
> (Responsive เป็น subset) + เพิ่ม #3 **Reproduce-before-fix**;
> เพิ่มไฟล์ `DESIGN.md` (role `GUIDE_`); log เหตุผลใน `DECISIONS.md` #142–147.
> · 2026-05-27 — owner's machine เปิด `.claude/settings.local.json` = `{"model":"opus"}`
> (effective default = opus เฉพาะเครื่องนี้; ดู Enforcement).
> · 2026-09-06 — **v1.5.4** performance & security hardening (commit `ea4b64d`→`07ebe6d`, first git tag):
> query shape บน events 40M แถว, static cache, WS subscribe, Chrome idle-close, boot stagger,
> scope-aware cache key (GOTCHAS #190), rawXml IP/MAC scrub, migrations 198–199,
> Postgres slow log 2 s + `[slow-req]` — รายละเอียดใน CHANGELOG 2026-09-03→06
> · 2026-09-09 — Working Agreement #4 เพิ่มข้อยกเว้นของ STOP: งานถ้อยคำบน UI
> ที่เจ้าของสั่งมาตรง ๆ ให้ commit+deploy ต่อได้เลย — decision #286.
> · 2026-09-09 — Working Agreement #2 เพิ่มเสา **D. No-explainer-on-screen**
> (ห้ามเขียนคำอธิบายวิธีคิดบนหน้าจอ prod ย้ายมาที่ CLAUDE.md/docs) — decision #285;
> กวาดของเดิมออกจากหน้า Traffic / LPR / โมดัลเหตุการณ์แล้วในวันเดียวกัน.
> · 2026-09-15 — Working Agreement #2 เพิ่มเสา **E. Reports = Light Mode เสมอ**
> (รายงานทุกรูปแบบ ห้ามทำ dark mode) — เจ้าของสั่งตรง ๆ หลังเห็น artifact รายงานที่ทำ
> auto dark/light ตาม system theme.
> · 2026-07-20 — Working Agreement #1 เพิ่มกฎภาษา: ระหว่าง investigate/audit/
> reproduce ใช้อังกฤษได้ แต่สรุปผล (Fact/Opinion/ข้อเสนอแนะ) ต้องเป็นไทยเสมอ.

---

## 🧭 Working Agreement (ข้อตกลงการทำงาน — บังคับทุกครั้ง)

> เพิ่ม 2026-05-22 ตามคำสั่งเจ้าของโปรเจกต์. กฎเหล่านี้ใช้กับ **ทุกคำสั่ง**
> ไม่ใช่เฉพาะงานใหญ่ — และ override พฤติกรรม default.

### 1. Investigate-first — แยก Fact ออกจาก Opinion ให้ชัด

เมื่อได้รับคำสั่ง ทำตามลำดับนี้ทุกครั้งก่อนลงมือแก้โค้ด:

1. **ตรวจสอบ** — อ่านไฟล์ / โครงสร้าง / git ที่เกี่ยวข้องจริง
2. **หาความจริง** — ยืนยันข้อเท็จจริงจาก source (โค้ด / schema / git log). อย่าเดา
3. **ประมวลผล + วิเคราะห์ผล**
4. **นำเสนอ โดยแบ่ง 2 ส่วนแยกกันชัดเจน:**
   - **🔵 Fact** — สิ่งที่ตรวจสอบแล้วเป็นจริง อ้างอิงได้ (ไฟล์ / บรรทัด / decision #)
   - **🟡 Opinion** — ข้อดี / ข้อเสีย + แผนการแก้ที่เสนอ + ความเห็นเพิ่มเติม
5. **รอเจ้าของตัดสินใจ** — ไม่ลงมือจนกว่าจะได้ไฟเขียว

**ข้อยกเว้น:** ถ้าคำสั่งเป็นไฟเขียวในตัว ("ทำเลย" / "จัดการเลย" / "ต่อเลย" /
อนุมัติแผนใน plan mode) = ตัดสินใจแล้ว → ลงมือได้ทันที ไม่ต้องวนถามซ้ำ. แต่
ผลลัพธ์ยังต้องรายงานแบบแยก Fact / Opinion เสมอ.

**ภาษาที่ใช้รายงาน:** ระหว่างลงมือ (investigate / audit / reproduce / progress
update ระหว่างทาง) ใช้ภาษาอังกฤษได้ปกติ. แต่เมื่อสรุปผล — ขั้น 4 (นำเสนอ Fact/Opinion)
และทุกข้อสรุป/ข้อเสนอแนะ/คำแนะนำถึงเจ้าของ — **ต้องเป็นภาษาไทย** เสมอ (คง
keyword/โค้ด/ชื่อไฟล์เป็นอังกฤษได้ตามปกติ).

### 2. UI-design-first (Responsive เป็น subset)

ก่อนลงมือทำ **อะไรก็ตามที่แตะ UI / CSS / layout / หน้าใหม่** ต้องเคารพ design
system ทุกครั้ง — spec เต็มอยู่ใน [DESIGN.md](DESIGN.md) (เหตุผล: decision #142–145).
3 เสาหลัก:

**A. Design language — clean, Material-inspired (หลักการ ไม่ใช่ framework)**
- เรียบ เข้าใจง่าย hierarchy ชัด · ยึด restraint (น้อยแต่ชัด ไม่ตกแต่งเกิน)
- "Material" = เอา *โครงสร้าง* (elevation, spacing grid, type scale, token-based)
  มาใช้ — **ไม่ใช่** ลาก Material Web Components / framework เข้ามา (ชน Notes #1,
  STUBBORN_FACT Frontend) — decision #142
- ทุกสี / ระยะ / ขนาด มาจาก **token** (CSS custom properties) เสมอ — ห้าม hardcode
  (white-label ต้อง re-theme ได้ต่อลูกค้า — Notes #10) — decision #145
- **new code (2026-05-29+) ใช้ semantic token เท่านั้น** (decision #173) — ห้ามแตะ legacy names ตรงๆ:

  | ต้องการ | ใช้ | ห้ามใช้ |
  |---|---|---|
  | พื้นหลังหลัก | `--surface-base` | `--bg` |
  | card / panel | `--surface-elevated` | `--panel` |
  | modal / dropdown | `--surface-overlay` | `--panel2` |
  | ตัวอักษรหลัก | `--text-primary` | `--text` |
  | label / caption | `--text-secondary` | `--dim` |
  | hover ของ accent | `--accent-muted` | `--accent2` |
  | amber / warning | `--warn` | `--amber` |
  | online / healthy | `--status-ok` | `--green` |
  | offline / error | `--status-bad` | `--red` |
  | เส้นแบ่ง | `--border-hairline` | `--border` |
  | accent | `--accent` | (ชื่อตรงกันอยู่แล้ว ใช้ได้) |

  legacy `--bg/--panel` ฯลฯ ยังอยู่เป็น alias ของเดิมยังทำงานได้ แต่ new code ห้ามใช้
- dashboard = งานวิเคราะห์ → ให้ legibility / data density มาก่อนการตกแต่ง
- status color ต้องผ่าน contrast WCAG AA บน surface ปัจจุบัน (decision #145)

**B. Responsive (subset ของ A)**
- breakpoint `≤768px` (มือถือ) first-class เสมอ — decision #42, gotchas #29-31
- ถ้าคำสั่งของเจ้าของมีจุดที่จะ **กระทบ responsive ในทางลบ** → แจ้งทันทีตามรูปแบบ
  ข้อ 1 (แยก Fact / Opinion) ก่อนทำ — ห้ามเงียบแล้วทำตามจนพังบนมือถือ
- **ก่อน commit UI ทุกครั้ง** → ตรวจ responsive ≤768px ด้วยตัวเองและรายงานผลใน
  summary (ผ่าน / แก้แล้ว / จุดที่อาจเป็นปัญหา) — ไม่รอให้ถูกถาม

**C. No-emoji-as-UI** (decision #144) — มี 2 ระดับความเข้ม
- **Dashboard DOM** = preference: emoji พัง visual consistency ข้าม OS/เบราว์เซอร์ +
  ไม่ themeable + ไม่เข้า i18n → ใช้ inline **SVG sprite** (`currentColor`, decision #143).
  เบราว์เซอร์ render emoji ได้ ไม่ crash — เป็นเรื่องคุณภาพ ไม่ใช่ความปลอดภัย
- **Server-side render (Health Report PNG = SVG + `sharp`)** = **HARD constraint** —
  `librsvg/Pango` abort เมื่อไม่มี emoji fallback font → renderer **strip emoji เสมอ**
  ผ่าน `report-renderer._svgSafeText()` (incident จริง 2026-05-26, **GOTCHAS #25a / #25**;
  architecture = decision **#148** Health Report PNG ใช้ SVG+sharp ไม่ใช่ Puppeteer).
  **ห้ามใส่ emoji ใน SVG report template เด็ดขาด** (analytics report = Puppeteer/
  report-template.js คนละ path)
- **ยกเว้น:** LINE alert (norm ของ LINE ไทย) · docs/commit/CLAUDE.md (🔵🟡 ใช้ scan ได้)
  — **แต่การ์ดสถานะกล้อง (offline/online/MQTT/recorder) ไม่เข้าข้อยกเว้นนี้**
  (เจ้าของสั่ง 2026-09-15: "ไม่เอา emoticon สิครับ มันดูเป็น AI" — ใช้ป้ายข้อความ
  แทน เช่น "กล้อง:"/"ตำแหน่ง:"/"เวลา:") การ์ด LPR/ใบหน้า/watchlist ยังใช้ emoji
  ตามเดิม ไม่ได้แตะ
- **Legacy reality (สำคัญ):** dashboard เดิมใช้ emoji เป็น UI **แพร่หลาย** — sidebar/
  sub-tab/ปุ่ม (👁 📄 📥 📤 📜 🔌 📷 📋 🔍 🔕 ฯลฯ). ทั้งหมด grandfathered → แทนด้วย
  SVG แบบ **opportunistic** เมื่อแตะจุดนั้น **ห้าม sweep**. ห้ามแตะ semantics label `🔕` (#90)
- **Retrofit stance:** new code + ส่วนที่แตะ → token/SVG; **ห้าม big-bang refactor**;
  opportunistic เท่านั้น. hardcode/emoji วงกว้างที่ควรรื้อ → เสนอ ROADMAP ไม่ทำเงียบ

**D. No-explainer-on-screen — ห้ามเขียนคำอธิบายวิธีคิดลงหน้าจอ prod** (decision #285)
- หน้าจอมีไว้ **แสดงตัวเลขและสถานะ** ไม่ใช่สอนว่าตัวเลขคิดมายังไง · คำอธิบายเกณฑ์ /
  วิธีนับ / ข้อจำกัดของข้อมูล / เหตุผลว่าทำไมเลขสองการ์ดไม่เท่ากัน → **เขียนใน
  `CLAUDE.md` หรือ `docs/` ไม่ใช่บนหน้าเว็บ** (เจ้าของสั่ง 2026-09-09: มันรก และ
  ทำให้ลูกค้าตั้งคำถามกับตัวเลขที่ปกติดีอยู่แล้ว)
- ที่ยังเขียนบนจอได้ มี 3 อย่างเท่านั้น:
  1. **ขอบเขตของข้อมูล** สั้น ๆ — "นับเฉพาะกล้องที่เปิดตรวจจับหมวก" · "วันนี้ 00:00–23:59"
  2. **กุญแจอ่านกราฟ** — "สีเข้ม = อัตราสูง"
  3. **คำเตือนที่กันอ่านผิดจนเกิดความเสียหาย** — "ตัวเลขนี้ยังเทียบกันไม่ได้" ·
     "มักเป็นการอ่านผิด ไม่ใช่หลักฐานสวมป้าย" — ให้สั้นที่สุดเท่าที่ยังกันพลาดได้
- **ห้ามใส่แถว/แกน/ช่องที่รู้อยู่แล้วว่าจะว่างเสมอ** (เช่นแถบ "1 ครั้ง" ในกราฟที่นับเฉพาะ
  ผู้ทำผิดซ้ำ ≥3 ครั้ง) — มันไม่ใช่ข้อมูล มันคือที่ว่างที่ชวนให้ตั้งคำถาม
- ข้อความสถานะ (`กำลังโหลด…` / `โหลดไม่สำเร็จ`), กล่องยืนยันก่อนทำสิ่งที่เรียกคืนไม่ได้
  และ **help ในหน้าตั้งค่า** (คนอ่านคือแอดมินที่กำลังตั้งค่า ไม่ใช่ลูกค้าที่ดูรายงาน)
  **ไม่นับเป็นคำอธิบายตามข้อนี้** — เก็บไว้ตามเดิม

**E. Reports = Light Mode เสมอ ห้ามทำ dark mode** (เจ้าของสั่ง 2026-09-15)
- ใช้กับ **รายงานทุกรูปแบบที่ทำขึ้นให้คนอ่าน** — HTML artifact, Health Report PNG,
  PDF (RCA/email skill), เอกสารสรุปใน `docs/reports/` — ไม่ว่าจะ publish เป็น
  artifact หรือไฟล์ local
- **ห้ามใส่ `@media (prefers-color-scheme: dark)` หรือ `[data-theme="dark"]`**
  ในหน้ารายงาน — ให้ประกาศสี/พื้นหลัง/ตัวอักษรเป็น light palette ตรง ๆ ค่าเดียว
  ไม่สลับตาม system theme ของผู้ดู (ต่างจาก dashboard ปกติที่ยัง support ทั้งสองธีม)
- เหตุผล: รายงานส่งให้คนอ่าน/พิมพ์/แคปหน้าจอ ไม่ใช่ UI ที่เปิดค้างไว้ตามธีมเครื่องแต่ละคน
  ต้องการความคงที่ของหน้าตามากกว่า

### 3. Reproduce-before-fix → Verify-after → Capture (เฉพาะงาน bug / behavior แปลก)

ใช้กับงาน "แก้บั๊ก / พฤติกรรมไม่ตรงคาด" เท่านั้น — **ไม่ใช่** feature ใหม่,
**ไม่ใช่** typo/rename. เป็นส่วนขยายของข้อ 1: เพิ่มขา **runtime** เข้าไปใน
"หาความจริง" (ข้อ 1 เป็น static investigation — อ่านไฟล์/schema/git; ข้อนี้บังคับ
ให้เห็นของรันจริง). เหตุผล: decision #146–147.

1. **Reproduce ก่อนเสมอ** — สร้าง repro ที่สังเกตได้จริงก่อนเสนอวิธีแก้:
   รัน SQL จริงกับ schema จริง · ยิง endpoint จริงดู response shape จริง (อย่าเดา
   รูป payload) · ดู log / Network / DevTools ของจริง.
   **ถ้า reproduce ไม่ได้** → บอกตรง ๆ ว่าทำซ้ำไม่ได้ และวิธีแก้ที่เสนอนับเป็น
   🟡 Opinion (สมมติฐาน) ไม่ใช่ 🔵 Fact.

2. **Root cause ไม่ใช่ symptom** — heisenbug (EMQX broker swap #112/#33, Safari ITP,
   Cloudflare cache stale JS, license fingerprint #108/#26) ห้ามเดา —
   ต้องเห็นของจริงว่าอะไรทำให้ repro เกิด ก่อนแตะโค้ด.

3. **Verify-after** — หลังแก้ ต้องรัน repro เดิมซ้ำให้กลายเป็น "เขียว" + เช็ค
   regression ที่ใกล้เคียง. ยังไม่ verify = งานยังไม่เสร็จ (ไม่ใช่แค่ "เขียนโค้ดเสร็จ").

4. **Capture — ปิด loop preventive** แบ่ง 2 ชั้นตาม blast radius (hybrid, decision #147):
   - **Log / warn / metric / non-throwing assert** (ไม่แตะ control flow) →
     **ทำได้เลย** นับเป็นส่วนหนึ่งของ fix แล้วรายงานใน diff.
   - **Throw / reject / validation ที่บล็อกของเดิม** (เปลี่ยน behavior) →
     **เสนอ รอไฟเขียว** เสมอ — โดยเฉพาะใน MQTT ingest / WS `verifyClient` /
     migration (กัน failure mode ใหม่หลุดเข้า prod โดยไม่ผ่านตา; cf. STUBBORN_FACT
     #81 — failing migration aborts startup โดยตั้งใจ).
   - ถ้าเป็น footgun จริง → เสนอบรรทัด `GOTCHAS.md` ใหม่ตาม convention
     incident-based เดิม (root cause / fix / lesson).

> Repro template ละเอียดต่อชนิดบั๊ก (MQTT / WS / cache / ITP) อยู่ใน
> `docs/REF_troubleshooting.md` / `GOTCHAS.md` — ไฟล์นี้เก็บแค่กฎ.

### 4. Advisor-led cycle — PLAN → EXECUTE → AUDIT → STOP → COMMIT (บังคับทุกคำสั่งที่ให้ลงมือ)

> เพิ่ม 2026-06-16 ตามคำสั่งเจ้าของ. เป็น **meta-process** ครอบ #1–#3 (Investigate /
> UI / Reproduce กลายเป็นเนื้อหาภายในขั้น PLAN/AUDIT). owner ไม่ต้องสั่งซ้ำทุกครั้ง —
> ทุกคำสั่งที่ให้ "ลงมือทำ" เดินตาม 5 ขั้นนี้โดยอัตโนมัติ.

1. **PLAN — ให้ Advisor วางแผน + reproduce/audit แผนทีละขั้นก่อนลงมือ**
   - มี codebase / process ชัดอยู่แล้ว → ดำเนินตามแผนได้เลย
   - ยังไม่ทราบ process → ให้ Advisor ตกผลึกจนได้ **spec ที่ชัด** (absolute path + เกณฑ์เสร็จ)
     ก่อน แล้วจึงส่งต่อให้ executor
2. **EXECUTE — เฉพาะงานกลไกที่ spec ครบแล้วเท่านั้น → delegate ให้ subagent**
   (Sonnet ตาม [Model Assignment Rules](#-model-assignment-rules); งานที่ spec ยังไม่ครบ ห้าม execute)
   > 🔴 **ข้อห้ามเด็ดขาดของ subagent (เพิ่ม 2026-08-11 หลัง GOTCHAS #150):**
   > ห้ามแตะ **credential ของจริง** ทุกกรณี — ห้าม `UPDATE`/`DELETE` ตาราง `users`
   > แถวที่ไม่ได้สร้างเอง · ห้ามแตะ `password_hash` ของบัญชีจริง · **ห้ามเดารหัสผ่าน**
   > (เดา = พา account ไปโดน lockout และทำให้ audit trail สกปรก) · ห้ามแตะ
   > EMQX authn/authz, `.env`, license key. ต้องใช้สิทธิ์ → **สร้างบัญชีชั่วคราวของตัวเอง
   > แล้วลบทิ้งเมื่อจบ** เท่านั้น. ติดขัดจนทำต่อไม่ได้ = **รายงานกลับ ห้ามแก้ทางลัดเอง**.
   > prompt ที่สั่ง subagent ต้อง**เขียนข้อห้ามนี้ลงไปตรงๆ** ไม่ใช่แค่บอกให้ "สร้างของชั่วคราว"
3. **AUDIT — หลังทำเสร็จ ให้ main loop (หรือ subagent) re-run repro แล้วให้ Advisor audit ผลอีกรอบ**
   → สรุปผล audit ให้เจ้าของดู แยก **🔵 Fact / 🟡 Opinion** ตาม #1
   > Advisor อ่าน transcript ได้แต่ **รัน repro เองไม่ได้** — ขา runtime ต้องให้ main loop/subagent รันจริงแล้วส่งผลให้ Advisor ตรวจ
4. **STOP — หยุดรอเจ้าของยืนยัน. ห้าม commit เองเด็ดขาดจนกว่าจะ confirm**

   **ข้อยกเว้น (เจ้าของอนุมัติ 2026-09-09, decision #286) — งาน "ถ้อยคำบน UI"
   ไม่ต้องหยุด: EXECUTE → COMMIT → DEPLOY → pull ครบ 5 ไซต์ → แล้วค่อยรายงาน**
   - เข้าข่ายเมื่อครบทั้งสองข้อ: (ก) เจ้าของสั่งจุดนั้นมาตรง ๆ (ชี้ภาพ/ระบุข้อความ)
     **และ** (ข) diff แตะได้แค่ **ข้อความ · ป้ายกำกับ · คำแปล i18n · สไตล์ของข้อความนั้น**
   - เหตุผล: กฎ STOP มีไว้กันของที่ผิดแล้วกู้ยากหลุดขึ้น prod — คำบนหน้าจอที่เจ้าของ
     สั่งเองไม่ใช่ของแบบนั้น และการรอทำให้เจ้าของเห็นของเก่าซ้ำ ๆ จนเข้าใจว่ายังไม่ได้แก้
     (เกิดจริง 3 รอบติดกันวันที่ 2026-09-09)
   - **ยังต้อง STOP เหมือนเดิมทุกกรณี** เมื่อ diff แตะ: schema/migration · ตัวนำเข้าข้อมูล
     (import/ingest) · auth/สิทธิ์ · การเขียนลง DB ของ prod · ตั้งค่ากล้อง/EMQX/edge ·
     พฤติกรรมของตัวเลข (สูตรคำนวณ เกณฑ์ ตัวกรอง) — **เปลี่ยนคำที่อธิบายตัวเลข = UI ·
     เปลี่ยนวิธีได้ตัวเลข = ต้องหยุด**
   - เงื่อนไขไม่เปลี่ยน: เทสต์ต้องผ่านครบ · ตรวจ ≤768px ถ้าแตะ layout · รายงานผลหลัง
     deploy พร้อมสิ่งที่ตรวจจริง

5. **COMMIT — หลังเจ้าของ confirm แล้วค่อย commit** (หรือทันที ถ้าเข้าข้อยกเว้นด้านบน)

> **เส้นแบ่งสำคัญ vs #1:** ไฟเขียวของ #1 ("ทำเลย / จัดการเลย / ต่อเลย") = อนุมัติให้ **execute**
> เท่านั้น — **ไม่ใช่** ไฟเขียวให้ **commit**. STOP ในข้อ 4 ยังบังคับเสมอ ต้องได้ confirm
> แยกต่างหากก่อน commit ทุกครั้ง.

---

## 🤖 Model Assignment Rules

> *Guidance* — CLAUDE.md เลือก model จริงไม่ได้. การบังคับใช้อยู่ที่
> `.claude/settings.json` (committed) + `/model` picker + subagent frontmatter.
> ใช้ตารางนี้ตัดสินใจว่าจะ `/model` สลับเมื่อไหร่.

### Default
- **`opusplan`** — Opus วางแผนใน plan mode → สลับ Sonnet ตอน execute อัตโนมัติ
- ⚠️ plan-mode ของ opusplan อาจได้ context window เล็กกว่า `opus` ตรง ๆ —
  งานวิเคราะห์ทั้ง `dashboard.js` / `api-server.js` พร้อมกันทั้งก้อน ให้สลับเป็น
  `opus` (เช็คขนาด context จริงได้ใน `/model` picker)
- **นิสัยที่สำคัญกว่าค่า default:** debug ข้ามเลเยอร์ + งาน security ทำใน
  *execute mode* ซึ่ง opusplan ช่วยไม่ถึง → พิมพ์ `/model opus` เองทุกครั้งที่
  เริ่มงานสองกลุ่มนี้

### Task → Model
| งาน | Model | ตัวอย่างจริงในโปรเจกต์ |
|---|---|---|
| Architecture / data-flow design | `opus` | ออกแบบ ingester เวนเดอร์ใหม่, plugin-loader refactor, endpoint รวบยอด, WS channel ใหม่ |
| Complex SQL / query performance | `opus` | stats aggregation, `analyticsEventClause()`, `date_bin()` density, EXPLAIN tuning, partition plan |
| Cross-cutting / heisenbug debug | `opus` | broker swap (#112), license fingerprint (#108), Cloudflare cache stale JS, Safari ITP |
| Security & auth | `opus` | auth middleware, WS `verifyClient`, RBAC, license Ed25519 JWT, CORS allowlist |
| Schema migration ที่แตะ data เดิม | `opus` | type change, retroactive column convert |
| Design-system architecture | `opus` | วาง token tri-layer (#145), icon-system, theming Chart/OpenLayers/Puppeteer ให้ตรง token |
| Feature ตาม pattern เดิม | `sonnet` | ingester ตามแม่แบบ hikvision/dahua, หน้า dashboard ใหม่ (Vanilla JS), widget Chart.js/OpenLayers |
| Apply component / design pattern | `sonnet` | สร้าง card/table/badge ตาม DESIGN.md, แทน emoji เป็น SVG sprite ตาม spec |
| Refactor ในกรอบ convention เดิม | `sonnet` | แยก helper, ปรับ endpoint, migration file ใหม่ (idempotent), i18n string extraction |
| Docs / commit msg / session summary | `haiku` | README / CLAUDE.md / SKILL.md, commit message, push summary |
| Search / grep / read (รันเป็น subagent) | `haiku` | cost lever — ตั้งใน `settings.json` ให้แล้ว |
| Boilerplate / format / find-replace กลไกล้วน | `haiku` | rename, จัด format, แทนที่ string ที่ pattern ชัด |

### Cheat sheet
```
/model opusplan   # default
/model opus       # architecture / SQL / debug ข้ามไฟล์ / security / design-system
/model sonnet     # implement ตาม pattern / component / i18n
/model haiku      # docs / search / cleanup
```

### Enforcement
- **`.claude/settings.json`** (committed) — `model: opusplan` + `CLAUDE_CODE_SUBAGENT_MODEL: haiku`
- **`.claude/settings.local.json`** (gitignored) — override เฉพาะเครื่อง เช่น `{"model":"opus"}`
  - **ACTIVE (2026-05-27):** เครื่องหลักของ owner เปิด override นี้แล้ว → effective default = **`opus`**
    (subagent ยังเป็น `haiku` จาก settings.json). เหตุผล: งานช่วงนี้เอียงไป architecture/SQL/
    heisenbug/security (กลุ่ม opus) จนต้อง `/model opus` เองบ่อย → ทำให้อัตโนมัติ.
    ไฟล์ gitignored → ไม่กระทบ Codex/เครื่องอื่น (ยังได้ opusplan). ปิด override = `rm` ไฟล์นี้
- subagent ตั้ง `model:` ใน frontmatter ของตัวเองได้ → override ค่า subagent default
- ล็อกเวอร์ชันแบบ reproducible: ใช้ full ID เช่น `claude-opus-4-7` แทน alias

---

## 🎯 Project Purpose

A **production-grade CCTV analytics platform** that ingests events from Bosch BVMS / FlexiDome IP cameras via MQTT (ONVIF Profile M), provides real-time monitoring, intelligent LINE alerts, branded reports, and operational dashboards for security operations teams.

**Why it exists:**
- Bosch IVA Pro detects events but vendor cloud is expensive + locks data in
- Customers want LINE notifications (Thailand market) — Bosch doesn't support this natively
- Need self-hosted, customizable, PDPA-compliant solution
- Source code ownership for customers (no vendor lock-in)
- White-label support so single codebase can be resold to multiple customers

**Target customers:** Industrial / Office Buildings / Retail / Schools (Thailand market, 100-3,000 cameras range)

**Status:** Production v1.5.4 — deployed live at `https://dashboard.dojojin.tech` (Cloudflare Tunnel, root cloudflared launchd service auto-starts on boot). Multi-vendor (Bosch / Hikvision / Dahua / ONVIF) + bilingual Thai/English + license + EULA. See [CHANGELOG.md](CHANGELOG.md).

---

## 📚 Documentation Map

Detailed reference content has been split into companion files. Read what's
relevant to your current task. **For doc management tasks or when scope is
unclear → open `docs/ARCH_documentation-governance.md` first.**

> Living Docs system active (adapted from github.com/Diew/living-docs, 2026-05-24).
> `docs/ARCH_documentation-governance.md` is the formal registry for all files below.

| File | Role (Living Docs) | What's inside |
|------|--------------------|----|
| [ARCHITECTURE.md](ARCHITECTURE.md) | `ARCH_` | Owner context · architecture · tech stack · project structure · DB schema · code patterns · critical ops · commercial info |
| [DESIGN.md](DESIGN.md) | `GUIDE_` | Design system — tokens (tri-layer) · type scale · spacing · elevation · icon/SVG system · Chart/Map/Report theming · component patterns · no-emoji rule |
| [DECISIONS.md](DECISIONS.md) | `LOGIC_` | Decision index #1–#288 (one-line + link to LOGIC/canonical file) — don't second-guess |
| [GOTCHAS.md](GOTCHAS.md) | `INCIDENT_` | Known issues / quirks / footguns (#1–#191) — each from a real incident |
| [docs/LOGIC_line-commands.md](docs/LOGIC_line-commands.md) | `LOGIC_` | คำสั่งผ่าน LINE — สั่งงาน/ถามข้อมูลจากในแชท · ผู้มีสิทธิ์สั่ง · ทะเบียนคำสั่ง · หยุดแจ้งเตือนรายป้าย · ส่งต่อเข้ากลุ่มอื่น |
| [docs/REF_notification-channel-limits.md](docs/REF_notification-channel-limits.md) | `REF_` | เพดาน/ราคา/วิธีนับของ LINE และ Telegram · วิธีวัดปริมาณของเรา · snapshot โควตารายเดือน |
| [docs/LOGIC_map-features.md](docs/LOGIC_map-features.md) | `LOGIC_` | Map page — what exists, improvement backlog, Option B (multi-group overlay), Live Pulse Toast-on-map T2, bug history |
| [CHANGELOG.md](CHANGELOG.md) | Completed work log | Completed features by version (v1.2 → v1.5) + recent updates timeline |
| [ROADMAP.md](ROADMAP.md) | `REFACTOR_TODO` | Pending work · operational roadmap Ph.1–Ph.6 · strategic direction |
| [SKILL.md](SKILL.md) | `REF_` | Operator's playbook (English) — mental model, mapping recipes, system settings, branding, Health Check, reports, i18n, camera offline alerts, report history, health report, auditor role, license, Dahua snapshots, camera pause, runtime stack |
| [SKILL-TH.md](SKILL-TH.md) | `REF_` | Operator's playbook (Thai) — same content as SKILL.md, prose in Thai, technical terms kept in English with Thai remarks |
| [service_start.md](service_start.md) | `REF_` | Daily start / stop / health check / troubleshoot manual |
| [docs/REF_database-schema.md](docs/REF_database-schema.md) | `REF_` | Full DB schema (all tables/columns/indexes) · PostgreSQL user/credentials · security/impact analysis · example queries |
| [docs/REF_third-party-integration.md](docs/REF_third-party-integration.md) | `REF_` | Third-party DB integration — `v_*_public` view catalog · ops setup (CREATE USER + GRANT role + pg_hba + docker bind + SSL) · query do/don't · PDPA · change policy · decommissioning |
| [docs/REF_api-reference.md](docs/REF_api-reference.md) | `REF_` | REST API reference — **344 routes** ใน process ของ api-server (นับด้วย `node scripts/check-api-reference.js` 2026-09-06) (ไม่รวม `lpr-receiver.js` ซึ่งเป็นคนละ service) · สายของ middleware 3 ชั้น (session → viewGuard → requireAdminForWrites) · หมวด 1–25 = รายละเอียด · **ภาคผนวก A = สารบัญครบทุก route สร้างจากโค้ดจริง** · WebSocket protocol |
| [docs/REF_face-recognition.md](docs/REF_face-recognition.md) | `REF_` | **PLANNED** Face Recognition — options A/B/C · InsightFace server-side · DB schema (pgvector) · Python service · hardware sizing · Mac dev → GPU migration · PDPA · phases FR.1–FR.4 |
| [docs/REF_edge-install.md](docs/REF_edge-install.md) | `REF_` | Edge node install guide — N150/Linux Mint 22 (Ubuntu 24.04 base), NanoMQ, cloudflared, EDGE_MODE, camera config, WSL2 vs pure Linux comparison (VIGIL-ARCH-003) |
| [HARDWARE_SIZING_GUIDE.md](HARDWARE_SIZING_GUIDE.md) | `REF_` | Hardware sizing per camera count (G1–G5) + software scale-up plan |
| [README.md](README.md) | Public overview | User-facing project intro (v1.5.4) |
| [CODEX/](CODEX/) | Audit reports | รายงาน audit จาก Codex (security / performance / refactor) — ล่าสุด `CODEX/CODEX_MODULAR_PERFORMANCE_AUDIT_2026-09-06.md` (modular + performance, ผลลัพธ์ที่ทำแล้วอยู่ท้ายไฟล์) |
| [LICENSE](LICENSE) + [docs/EULA-th.md](docs/EULA-th.md) | Legal | Proprietary license + Thai EULA |
| **[docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md)** | **Registry** | **File registry · task→load mapping · STUBBORN_FACT index · maintenance rules** |

### Task → Load Mapping (quick reference)

| Task | Load |
|---|---|
| General technical work | `CLAUDE.md` only |
| Architecture / DB schema | + `ARCHITECTURE.md` |
| Feature implementation | + `DECISIONS.md` (relevant #s) + `GOTCHAS.md` (related #s) |
| Debugging | + `GOTCHAS.md` + `docs/REF_troubleshooting.md` (+ Working Agreement #3) |
| Security / auth | + `docs/LOGIC_auth-security.md` + `GOTCHAS.md` (#36–#38) |
| UI / design / responsive / i18n | + `DESIGN.md` + `DECISIONS.md` (#1, #42, #128, #142–145) + `GOTCHAS.md` (#29–#31, #35, #42) |
| Multi-vendor cameras | + `docs/LOGIC_camera-ingesters.md` + `GOTCHAS.md` (#32–#33, #39–#41) |
| Dahua ingester (snapshot / CGI / test) | + `docs/LOGIC_dahua-ingester.md` + `GOTCHAS.md` (#39, #43, #58, #73, #75) |
| Hikvision ingester (ISAPI / face / body / people) | + `docs/LOGIC_hikvision-ingester.md` + `GOTCHAS.md` (#41, #57, #58, #62, #63) |
| Edge node (EDGE_MODE / site edge deploy / VIGIL-ARCH-003) | + `docs/REF_edge-install.md` + `docs/LOGIC_edge-ingester-divergence.md` + `GOTCHAS.md` (#97–#99) |
| Face Recognition (planned) | + `docs/REF_face-recognition.md` + `docs/LOGIC_face-capture.md` |
| Map page / OpenLayers / camera grouping / Live Pulse | + `docs/LOGIC_map-features.md` + `GOTCHAS.md` (#53) |
| Reports / Puppeteer / LINE | + `DESIGN.md` (Report PNG section) + `docs/LOGIC_stats-reports.md` + `docs/LOGIC_line-notifications.md` |
| คำสั่งผ่าน LINE (สั่งงาน/ถามข้อมูลจากในแชท) | + `docs/LOGIC_line-commands.md` + `GOTCHAS.md` (#196–#198) |
| โควตา LINE / `monthly limit` / เทียบ Telegram / ราคาช่องทางแจ้งเตือน | + `docs/REF_notification-channel-limits.md` |
| License / EULA | + `docs/LOGIC_license.md` + `GOTCHAS.md` (#26–#28) |
| 3rd party DB integration / setup new partner / rollout views | + `docs/REF_third-party-integration.md` (+ `docs/REF_database-schema.md` สำหรับ column ละเอียด) |
| Schema lookup / DBA reference | + `docs/REF_database-schema.md` |
| API endpoint work / mobile app / integration | + `docs/REF_api-reference.md` |
| Performance / slow-query investigation | + `service_start.md` (§หน้าเว็บโหลดช้า) + `GOTCHAS.md` (#187–#191) + `CODEX/CODEX_MODULAR_PERFORMANCE_AUDIT_2026-09-06.md` |
| Hardware sizing | + `HARDWARE_SIZING_GUIDE.md` |
| Service ops | + `service_start.md` |
| Planning | + `ROADMAP.md` |
| Doc management / scope unclear | `docs/ARCH_documentation-governance.md` |

**Memory pointer:** `~/.claude/projects/-Users-dojojin-vigil-platform/memory/MEMORY.md`
carries feedback/preference memories across sessions.

---

## 🤖 Notes for AI Assistants

When working on this project:

1. **Don't suggest rewriting in React/Vue/Svelte** — Vanilla JS is a deliberate choice. Discussed and decided.

2. **Don't simplify the auth back to cookie-only** — Safari ITP requires triple-layer.

3. **Don't add ORM (Prisma/Drizzle/etc.)** — Raw SQL is fine for this scale.

4. **Respect Thai-language UI** — Many UI strings are Thai. Don't translate unless asked. All new UI strings MUST be added to both `th` AND `en` blocks in `dashboard/i18n.js` — see gotcha #42. Server-side rendered reports (e.g. Health Report PNG via Puppeteer) also need their own per-language label dict — `HR_LABELS.{th,en}` pattern in `src/report-renderer.js`.

5. **`init.sql` is idempotent — but DO NOT edit it to evolve schema.** It only runs on a fresh volume. New schema → write `db/db_migration_<NNN>_<topic>.sql` (idempotent: `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `ADD COLUMN IF NOT EXISTS`, or a defensive `DO $$ ... information_schema ...` block). The runner in `src/migrate.js` will pick it up on next api-server boot. Updating `init.sql` is fine when you want the new column to also be present on truly fresh installs — but the migration is what reaches existing volumes.

6. **All `.js` files have copyright headers** — Preserve when editing. Format:
   ```javascript
   // ============================================================
   // Vigil Platform — [Module Name]
   // @author Prakasit Rochanavipart (Dojo-mAn)
   // @copyright (c) 2025-2026 ... All Rights Reserved.
   // @license Proprietary
   // ============================================================
   ```

7. **Owner is technical and pragmatic** — Show working code first, explain after. Use tables/structured output. Don't over-explain basics.

8. **Communication preference:**
   - Owner writes in Thai, technical terms in English
   - Respond in Thai with English code/keywords
   - Show concrete examples + commands to run, not abstract advice
   - When unsure, ask one specific question — don't ask multiple at once

9. **Owner has wide-ranging interests** — Bosch BVMS work is the core, but conversations may detour into smartphones, audio gear, Thai politics, music (Shibuya Kei, action movies), Liverpool FC, 3D printing.

10. **Branding is white-label-aware** — when adding any user-facing text, prefer pulling brand name from `_brand.name` (frontend) or `system_settings` (backend) instead of hardcoding "DojoJin Tech".

11. **Mobile considered first-class** — when adding UI, always test ≤768px breakpoint in DevTools. See gotchas #29–#31 for grid/CSS reflexes. (Now formalized under Working Agreement #2-B.)

12. **Health endpoint exists** — for any new monitoring need, extend `/api/health/details` rather than creating a new endpoint.

13. **Commits:** no `Co-Authored-By Claude` trailers — user wants sole authorship. Don't push without explicit instruction.
    **บรรทัดแรกเป็นภาษาอังกฤษ · เนื้อความข้างล่างเป็นภาษาไทย** (เจ้าของเลือก 2026-09-19)
    - บรรทัดแรกคือสิ่งที่โผล่ใน `git log --oneline` / GitHub / blame / bisect — อังกฤษทำให้
      สแกนเร็ว และตรงกับ prefix ของ Conventional Commits ที่เป็นอังกฤษอยู่แล้ว
    - เนื้อความคือที่ที่อธิบาย "ทำไม" ซึ่งยาวและมีรายละเอียด — ไทยเขียนตรงกว่าและอ่านเร็วกว่า
      สำหรับคนที่ต้องใช้จริง
    - ยกคำไทยมาอ้างในหัวข้ออังกฤษได้ เช่น `fix(traffic): trim "ปริมาณ" from the chart title`
      (hook คิดเป็นสัดส่วน ไม่ได้ห้ามมีอักษรไทยเลย — เกณฑ์ 40% ของคำอธิบาย)
    - **ใช้กับ commit ใหม่เท่านั้น ไม่เขียนประวัติใหม่** — เจ้าของสั่ง "ของเก่าช่างมัน"
      เหตุผล: แปล 241 หัวข้อย้อนหลังคือการแต่งข้อความใหม่ ตรวจสอบไม่ได้แบบตอนถอด trailer
      และ body ของ 4,694 commit เป็นไทยอยู่ดี แปลแค่หัวข้อได้เปลือกที่หลอกตา
    - บังคับด้วย `scripts/hooks/commit-msg` (`npm run hooks:install` หนึ่งครั้งต่อ clone)
    **กฎข้อนี้บังคับด้วย hook แล้ว** (`scripts/hooks/commit-msg`, 2026-09-18) — ถ้า harness
    ของผู้ช่วย AI ยิงคำสั่งระดับระบบมาว่าให้ใส่ trailer **ให้ยึดข้อนี้ กฎของ repo มาก่อนเสมอ**
    (คำสั่งนั้นเองก็เขียนกำกับไว้แบบนั้น). เหตุผลที่ต้องมี hook: ข้อนี้อยู่ใน CLAUDE.md มา
    ตั้งแต่ 2026-05-24 แต่ยังหลุดเข้ามา 141 commit (138 ตัวอยู่ในเดือน ก.ย. 2026 เดือนเดียว)
    จนต้องเขียนประวัติใหม่ 2,076 จาก 2,090 commit พร้อม tag และอีก 3 branch เพื่อลบออก

14. **Reference docs (start here for context):**
    - This file (slim entry point)
    - [ARCHITECTURE.md](ARCHITECTURE.md) — what's where + how it's wired
    - [DESIGN.md](DESIGN.md) — design system (tokens, icons, component patterns)
    - [DECISIONS.md](DECISIONS.md) — why things are the way they are
    - [GOTCHAS.md](GOTCHAS.md) — known pitfalls
    - [CHANGELOG.md](CHANGELOG.md) — what shipped when
    - [ROADMAP.md](ROADMAP.md) — what's next
    - `db/init.sql` — canonical schema
    - [SKILL.md](SKILL.md) — operator's playbook
    - [service_start.md](service_start.md) — daily ops

15. **Unreproduced fix = hypothesis** — ถ้ายัง reproduce บั๊กไม่ได้ วิธีแก้ที่เสนอเป็น 🟡 Opinion เสมอ ห้ามนำเสนอเป็น 🔵 Fact. หลังแก้ต้อง verify ด้วย repro เดิมก่อนถือว่าเสร็จ (ดู Working Agreement #3, decision #146).

16. **No emoji as UI** — ใช้ inline SVG sprite (`currentColor`) ไม่ใช่ emoji/webfont. **Server-side SVG render (Health Report PNG via `sharp`) ต้อง strip emoji เสมอ** — librsvg/Pango abort (GOTCHAS #25a, `_svgSafeText()`). ยกเว้น LINE alert + docs + legacy emoji ใน dashboard เดิม (แพร่หลาย — แทน opportunistic ห้าม sweep). ทุกสี/ระยะดึงจาก token ใน `DESIGN.md` (Working Agreement #2-C, decision #143–144).

17. **Security checklist:** เมื่อแตะโค้ดกลุ่ม auth / file upload / cookie / credential / docker port → โหลด [`docs/REF_security-checklist.md`](docs/REF_security-checklist.md) + review GOTCHAS #50–#57 ก่อนเขียนโค้ด เหตุผล: audit SEC-001–011 (2026-05-28) พบ 4 class ของ bug ที่เกิดซ้ำได้ในจุดเหล่านี้ (magic bytes, flag drift, middleware bypass, port wildcard)

---

<sub>End of CLAUDE.md (slim) · Vigil Platform v1.5.4 · Updated 2026-09-06</sub>
