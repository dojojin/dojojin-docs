# DESIGN.md — Vigil Platform Design System

> **Living Docs role:** `GUIDE_` (Standards — how we build UI) · Owner: Prakasit Rochanavipart (Dojo-mAn)
> Created: 2026-05-27 · Governs all user-facing visual surfaces
> **Canonical owner of:** UI design system — tokens, icons, component patterns,
> no-emoji rule. Rationale for decisions #142–145 lives here (DECISIONS.md เป็น index เท่านั้น).
> **Enforced by:** Working Agreement #2 (UI-design-first) in [CLAUDE.md](CLAUDE.md).
> **Registered in:** [docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md).
>
> ✅ **ค่า hex อ้างอิงจาก `:root` ใน `dashboard/index.html`** — อัปเดต 2026-05-28 (Phase 0).

---

## 0. หลักการ (Design Principles)

1. **Clean, Material-inspired — หลักการ ไม่ใช่ framework.** เอาโครงสร้างของ
   Material (elevation, spacing grid, type scale, token-based theming) มาใช้
   โดย **ไม่** ลาก Material Web Components / library เข้ามา (decision #142, ชน Notes #1 +
   STUBBORN_FACT "Vanilla JS — no React/Vue/Svelte").
2. **Restraint** — น้อยแต่ชัด. ตัดการตกแต่งที่ไม่สื่อความหมาย. dashboard เป็น
   งานวิเคราะห์ → legibility + data density มาก่อนความสวย.
3. **Token-only** — ทุกสี / ระยะ / ขนาด มาจาก token. ห้าม hardcode ค่าใน
   component (white-label ต้อง re-theme ต่อลูกค้าได้ — decision #145, Notes #10).
4. **No emoji as UI** — ใช้ SVG sprite แทน (decision #143–144). ดู §4.
5. **Mobile first-class** — ทุก component ต้องผ่าน `≤768px` (Working Agreement #2-B, decision #42).

---

## 1. Design Tokens — Tri-layer Single Source (decision #145)

token ชุดเดียว แต่ surface 3 ชนิดเข้าถึงคนละทาง → ต้อง sync จาก **แหล่งเดียว**
ไม่งั้น dashboard / chart / report จะ drift กัน.

```
            +-------------------------------------------+
            |   tokens.json  <- single source of truth  |
            |   (semantic role -> value + light/dark)   |
            +----------------------+--------------------+
        build / import step        | (generate ทั้ง 3 ฝั่งจากไฟล์นี้)
       +---------------------+------+--------------------+
       v                     v                          v
  Layer 1: CSS          Layer 2: JS palette       Layer 3: Puppeteer
  custom properties     module (named export)      inject ตอน render
  -> dashboard DOM      -> Chart.js / OpenLayers    -> report PNG <style>
```

### Token roles (semantic — อย่าตั้งชื่อด้วยสี เช่น `--navy`)

| Role token | ใช้ที่ไหน | ค่าจริง (alias → legacy) |
|---|---|---|
| `--surface-base` | พื้นหลังหลัก (navy เข้ม) | `#0a0e1a` → `var(--bg)` |
| `--surface-elevated` | card / panel ยกระดับ | `#131826` → `var(--panel)` |
| `--surface-overlay` | modal / dropdown | `#1a2030` → `var(--panel2)` |
| `--text-primary` | ตัวอักษรหลัก | `#e4e8f0` → `var(--text)` (AA ✓ บน base) |
| `--text-secondary` | label / caption | `#7f8694` → `var(--dim)` (AA ✓ ตัวใหญ่) |
| `--accent` | action / link / highlight (blue) | `#5b8def` (ชื่อตรงกับ legacy) |
| `--accent-muted` | hover / pressed ของ accent | `#4a7bd4` (darker shade ของ accent) |
| `--warn` | alert / attention (amber) | `#f59e0b` → `var(--amber)` (AA ✓ บน base) |
| `--status-ok` | online / healthy | `#22c55e` → `var(--green)` |
| `--status-bad` | offline / error | `#ef4444` → `var(--red)` |
| `--border-hairline` | เส้นแบ่งบาง | `#232b3d` → `var(--border)` |

> **Contrast gate (decision #145):** ทุก token ที่เป็น "text บน surface" หรือ
> "status บน base" ต้องผ่าน **WCAG AA** (>=4.5:1 ตัวเล็ก / >=3:1 ตัวใหญ่+ไอคอน).
> ตรวจก่อน merge — DevTools contrast checker หรือ snippet ใน REF_operator-sql/SKILL.

### Layer 1 — CSS custom properties (dashboard)
```css
/* Semantic tokens (ใช้ใน new code เสมอ) — alias ไปหา legacy ระหว่าง migration */
:root {
  --surface-base:     var(--bg);      /* #0a0e1a */
  --surface-elevated: var(--panel);   /* #131826 */
  --surface-overlay:  var(--panel2);  /* #1a2030 */
  --text-primary:     var(--text);    /* #e4e8f0 */
  --text-secondary:   var(--dim);     /* #7f8694 */
  --accent-muted:     #4a7bd4;
  --warn:             var(--amber);   /* #f59e0b */
  --status-ok:        var(--green);   /* #22c55e */
  --status-bad:       var(--red);     /* #ef4444 */
  --border-hairline:  var(--border);  /* #232b3d */
  /* --accent ชื่อตรงกับ legacy อยู่แล้ว ไม่ต้อง alias */
}
/* white-label: ลูกค้า override ได้ที่ :root scope เดียว ไม่ต้องแก้ component */
```

### Layer 2 — JS palette (Chart.js / OpenLayers อ่าน CSS var ไม่ได้)
```js
// dashboard/design-tokens.js  — generate จาก tokens.json (อย่าพิมพ์มือซ้ำ)
// อ่านค่าจริงจาก CSS var ตอน runtime เพื่อไม่ให้ drift:
export const token = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Chart.js:   borderColor: token('--accent')
// OpenLayers: new Stroke({ color: token('--status-bad') })
```
> วิธีนี้ทำให้ chart/map ใช้ค่าเดียวกับ CSS เสมอ — re-theme ที่ `:root` แล้วทุกอย่างตามทันที.

### Layer 3 — Puppeteer report PNG (คนละ process, ไม่มี DOM ของ dashboard)
```js
// src/report-renderer.js — inject token เข้า template ตอน render
const tokens = require('./design-tokens.json'); // source เดียวกัน
const css = `:root{ --surface-base:${tokens.surfaceBase}; --accent:${tokens.accent}; /*...*/ }`;
// ฝัง css นี้ใน <style> ของ HTML ที่ส่งให้ Puppeteer
```
> ห้าม hardcode สีใน report template — report ต้องหน้าตาตรงกับ dashboard เสมอ.
> เคารพ STUBBORN_FACT: `report-template.js` เป็นที่เดียวที่ build report HTML (#92).

---

## 2. Type Scale + Spacing

**Type scale (คงที่ — อย่าตั้ง font-size ลอย ๆ):**

| Token | rem | ใช้ |
|---|---|---|
| `--fs-display` | 1.75 | ตัวเลข KPI ใหญ่ |
| `--fs-h1` | 1.375 | หัวหน้า/section |
| `--fs-h2` | 1.125 | หัว card |
| `--fs-body` | 0.9375 | เนื้อหา |
| `--fs-caption` | 0.8125 | label / meta |

**Spacing grid 4 / 8px** — ทุก margin/padding/gap เป็นจำนวนเท่าของ 4px.
`--space-1:4px . --space-2:8px . --space-3:12px . --space-4:16px . --space-6:24px . --space-8:32px`.
ห้ามใส่ค่าแปลก เช่น `padding: 7px`.

---

## 3. Elevation (depth = แสง ไม่ใช่เส้นหนา)

| Tier | ใช้ | shadow (ปรับให้เข้ากับ base เข้ม) |
|---|---|---|
| `rest` | พื้น/พื้นหลัง | none |
| `raised` | card / panel | เงาบาง 1 ชั้น |
| `overlay` | modal / dropdown / tooltip | เงาเข้มกว่า + radius ใหญ่กว่าเล็กน้อย |

บน dark surface ใช้เงาน้อย + พึ่ง `--surface-elevated` (สว่างกว่า base นิด)
เป็นตัวบอก depth แทนเงาหนา.

---

## 4. Icon System — SVG sprite (decision #143–144)

**กฎ:** ห้าม emoji เป็น icon/ปุ่ม/status/heading ใน dashboard + report PNG.

- ใช้ **inline SVG sprite** ไฟล์เดียว เช่น `dashboard/icons.svg` (`<symbol id="...">`)
  เรียกด้วย `<svg><use href="#icon-camera"/></svg>`
- ทุก icon `fill="currentColor"` / `stroke="currentColor"` → รับสีจาก token อัตโนมัติ
- self-hosted ทั้งหมด — **ห้าม** Material Symbols / FontAwesome webfont จาก CDN
  (ชน self-host + PDPA, decision #143)
- ตั้งชื่อ semantic: `icon-camera`, `icon-alert`, `icon-online`, `icon-offline`, `icon-export`...

| Do | Don't |
|---|---|
| `<use href="#icon-alert"/>` สีจาก `--warn` | 🚨 / ⚠️ ใน heading |
| status dot = `<svg>` + `--status-ok/bad` | 🟢🔴 emoji |
| ปุ่ม export มี `icon-export` | 📥 |

**ยกเว้น (carve-out):**
- **LINE alert message** — emoji เป็น norm ของ LINE ไทย (messaging UX ไม่ใช่ design surface)
- **docs / commit / CLAUDE.md** — 🔵🟡 ใช้ scan ได้
- **Legacy dashboard (สำคัญ — แพร่หลาย):** dashboard เดิมใช้ emoji เป็น UI ทั่วทั้งระบบ —
  sidebar/sub-tab/ปุ่ม เช่น `👁 Preview` `📄 PDF` `📥 PNG` `📤 Send` `📜 ประวัติรายงาน`
  `🔌` `📷` `📋` `🔍` `🔕 ช่วงเวลาเงียบ` (#90). **ทั้งหมด grandfathered** → แทนด้วย SVG
  `icon-*` แบบ **opportunistic** เมื่อแตะจุดนั้นเท่านั้น — **ห้าม sweep**, ห้ามแตะ semantics ของ #90

> **⚠️ HARD constraint (server-side):** ดู §6 — Health Report PNG render ด้วย SVG + `sharp`
> ผ่าน librsvg/Pango ซึ่ง **abort** เมื่อไม่มี emoji fallback font. ใน SVG report template
> **ห้ามมี emoji เด็ดขาด** (ไม่ใช่แค่ style — มันทำให้ render พัง). **GOTCHAS #25a / #25**.

---

## 5. Chart / Map Theming

- **Chart.js 4:** สีทุกตัวดึงจาก `token('--...')` (§1 Layer 2). grid/tick =
  `--border-hairline` + `--text-secondary`. ห้าม default palette ของ Chart.js.
  (หมายเหตุ perf: trend bar ใช้ `animation:false` — decision #31.)
- **OpenLayers 9:** stroke/fill ของ feature/marker ดึงจาก token เดียวกัน.
  status ของกล้องบนแผนที่ใช้ `--status-ok/bad` ให้ตรงกับ dashboard.
- เป้าหมาย: ดู chart, map, card แล้วรู้สึกเป็นระบบเดียว ไม่ใช่ 3 ธีม.

---

## 6. Report rendering — แยก 2 path (สำคัญ: คนละ engine)

| Report | Engine | สีจาก | emoji |
|---|---|---|---|
| **Analytics report** (Stats/Reports) | Puppeteer + `report-template.js` (STUBBORN_FACT #92 — ที่เดียว) | token Layer 3 | ห้าม (consistency) |
| **Health Report PNG** | **SVG + `sharp`** (ไม่ใช่ Puppeteer — decision #148) | token inject ใน SVG | **ห้ามเด็ดขาด — librsvg/Pango abort** |
| **Health Report PDF** | Puppeteer | token Layer 3 | ห้าม (consistency) |

- **HARD:** Health Report PNG ใช้ librsvg/Pango ผ่าน `sharp` → emoji ทำให้ render abort
  เมื่อไม่มี fallback font (**GOTCHAS #25a / #25**, 2026-05-26). renderer strip emoji ผ่าน
  `report-renderer._svgSafeText()` เสมอ — และเมื่อเพิ่ม element ใหม่ใน SVG template
  **ห้ามใส่ emoji** ใช้ `<path>`/`<use>` SVG แทน. (HR_LABELS ที่มี emoji เช่น `🏥`
  จะถูก strip เฉพาะตอน render SVG — ฝั่ง HTML/PDF ไม่แตะ)
- ทุก path: ห้าม hardcode สี (token Layer 3, §1). label ผ่าน `HR_LABELS.{th,en}` (Notes #4).
- brand name จาก `system_settings`; footer `© DojoJin Tech` ล็อก (STUBBORN_FACT #38).
- Puppeteer path: รอ `<img>` decode ก่อน signal `__reportReady` (STUBBORN_FACT #22).

---

## 7. Component Patterns (do / don't สั้น ๆ)

| Component | Do | Don't |
|---|---|---|
| **Card** | `--surface-elevated` + tier `raised` + radius/space จาก token | เงาหนา, สี hardcode |
| **Table** | zebra ด้วย `--surface-elevated` จาง, header `--text-secondary` | border ทุกเส้นหนา |
| **Badge/Status** | สี `--status-*` + icon SVG + text (ไม่พึ่งสีอย่างเดียว) | emoji, สีล้วนไม่มี label (a11y) |
| **Button** | `--accent`, hover `--accent-muted`, icon SVG | emoji, ขนาด/สี นอก token |
| **Empty state** | ข้อความ + SVG เรียบ | emoji ใหญ่ |
| **Grid child** | `min-width:0` เมื่อ content กว้าง (กัน mobile scroll) | ลืม → STUBBORN_FACT #29 |

> **a11y:** อย่าสื่อความหมายด้วย "สีอย่างเดียว" — มี icon/label กำกับเสมอ
> (คนตาบอดสี + ผ่าน contrast §1).

---

## 8. Retrofit stance (ของเดิมที่ hardcode อยู่)

- โค้ดเดิม hardcode CSS เยอะ — **ห้าม big-bang refactor**.
- new code + ส่วนที่กำลังแตะ → เปลี่ยนเป็น token/SVG.
- migrate token แบบ **opportunistic** เท่านั้น (แตะตรงไหน เก็บกวาดตรงนั้น).
- ถ้าเจอ hardcode เป็นวงกว้างที่ควรรื้อ → เสนอเป็น `ROADMAP.md` item อย่าทำเงียบ.

---

## 9. Rationale & Decisions (canonical สำหรับ #142–145)

> DECISIONS.md เก็บแค่ one-line + link มาที่นี่. รายละเอียด + alternatives-rejected อยู่ตรงนี้.

### #142 — "Material Design" = หลักการ/tokens ไม่ใช่ framework
เอาโครงสร้าง Material (elevation, spacing grid, type scale, token-based) มาใช้
โดยไม่นำ component library เข้ามา. **Rejected:** Material Web Components (เพิ่ม
build/runtime dep, ชน decision #1 + STUBBORN_FACT Vanilla JS); re-theme palette
ทั้งระบบ (เลื่อนเป็น v2 visual overhaul แยก).

### #143 — Icon = self-hosted SVG sprite ไม่ใช่ webfont
inline SVG sprite (`currentColor`) self-hosted. **Why:** themeable ด้วย token,
ไม่มี network dep, เข้ากับ self-host + PDPA. **Rejected:** Material Symbols /
FontAwesome webfont จาก CDN (ดึง asset ข้าม network ขัดจุดยืน; ธีมสียาก).

### #144 — No emoji as UI ใน user-facing surface
ห้าม emoji เป็น icon/ปุ่ม/status/heading ใน dashboard + report; ใช้ SVG (#143).
**2 ฐานเหตุผล:** (ก) **Dashboard DOM = preference** — emoji พัง consistency ข้าม
OS/เบราว์เซอร์, ไม่ themeable, ไม่เข้า i18n (ไม่ crash). (ข) **Server-side SVG render
(Health Report PNG via `sharp`/librsvg/Pango) = incident จริง** — abort เมื่อไม่มี emoji
fallback font (2026-05-26, **GOTCHAS #25a** — fix = `report-renderer._svgSafeText()`; architecture = **#148** Health Report PNG ใช้ SVG+sharp ไม่ใช่ Puppeteer).
**Scope:** dashboard เดิมมี emoji แพร่หลาย → grandfathered, แทน opportunistic, ห้าม sweep.
**Carve-out:** LINE alert, docs.

### #145 — Design token tri-layer single source
token semantic ชุดเดียว generate/อ่านลง CSS var + JS palette + Puppeteer inject;
status/text ผ่าน WCAG AA. **Why:** chart รันใน JS config และ report รันคนละ
process — เข้าไม่ถึง CSS var ตรง ๆ; ต้องรองรับ white-label re-theme ที่ `:root`
จุดเดียว. **Rejected:** CSS-only (chart/report ทำตามไม่ได้); hardcode ต่อ surface (drift).
**Open question:** ยังไม่ยืนยันว่ามี JS palette module เดิม — ถ้ามีให้ชี้มาแทน design ใหม่นี้.

---

## 10. Light Theme (decision #185)

Light mode เป็น **opt-in** — default คงเป็น dark (สถานะเดิม). ผู้ใช้เปิดผ่าน toggle ใน user dropdown แล้ว persist ใน `localStorage('dashboard_theme')`.

### กลไก

เพราะ semantic token ทั้งหมด alias ไปหา raw legacy token (เช่น `--surface-base: var(--bg)`) การ override แค่ raw token ใน `html[data-theme="light"]` ทำให้ semantic token + legacy consumer ทั้งหมด flip พร้อมกัน — **ไม่ต้องรอ semantic migration #173 เสร็จ**

```css
html[data-theme="light"] {
  /* raw legacy tokens — semantic aliases flip อัตโนมัติ */
  --bg:     #f0f4fa;
  --panel:  #ffffff;
  --panel2: #e8edf5;
  --border: #d0d7e4;
  --text:   #1a2030;
  --dim:    #5a6577;
  --muted:  #9aa3b0;
  /* literal tokens (ไม่ใช่ alias) ต้อง override เองด้วย */
  --accent:       #3b6fd4;
  --accent-muted: #2d5ab8;
  --green:        #16a34a;   /* WCAG AA ≥4.5:1 on #ffffff */
  --red:          #dc2626;   /* WCAG AA ≥4.5:1 on #ffffff */
  --amber:        #b45309;   /* WCAG AA ≥4.5:1 on #ffffff */
  color-scheme: light;
}
```

**FOUC prevention:** inline `<script>` ใน `<head>` ก่อน stylesheet ทุกตัว อ่าน localStorage แล้ว set `data-theme` ก่อน first paint

**Toggle reload:** `setTheme(t)` ทำ `location.reload()` — mirror pattern ของ lang toggle (`I18N.setLang`). Chart.js + inline styles re-read token อัตโนมัติ ไม่ต้องสร้าง refresh trigger แยก

### Scope ของ light theme

| Surface | พฤติกรรม |
|---|---|
| Dashboard HTML/CSS | flip ตาม `data-theme` ✓ |
| Chart.js (ทุก renderer) | flip อัตโนมัติผ่าน `token()` helper เมื่อ reload ✓ |
| air-datepicker popup | flip ผ่าน `theme-vigil.css` ที่ map `--adp-*` → semantic token ✓ |
| OpenLayers basemap (tiles) | **คงเดิม (dark)** — map tile/style เป็น preference แยกของผู้ใช้ |
| OL marker text stroke | **pin เป็น `#0a0e1a`** (fixed dark) — halo ต้องเห็นชัดบน dark tile เสมอ |
| Report PNG / PDF | **fix brand palette เสมอ** — ไม่ตาม user theme (server-side render ไม่มี user context) |

---

<sub>End of DESIGN.md · Vigil Platform · Created 2026-05-27 · Updated 2026-06-08 · role GUIDE_</sub>
