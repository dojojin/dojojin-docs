# CODEX_debt_suggestion.md — Frontend Debt Suggestions

Date: 2026-06-16
Scope: Dashboard frontend debt from product/coding review

## Summary

เอกสารนี้สรุปคำแนะนำสำหรับ frontend/UI debt 4 กลุ่ม:

1. hardcoded Thai/English dynamic strings ใน page modules
2. legacy emoji UI จำนวนมาก
3. hardcoded colors ในบางส่วน
4. `innerHTML` discipline และ `escapeHtml()` safety

เป้าหมายไม่ใช่ทำ big-bang cleanup แต่ทำแบบ opportunistic, reviewable และไม่เปลี่ยน behavior โดยไม่จำเป็น

หลักสำคัญ:

- Thai UI เป็น source language
- ทุก user-visible string ต้องมี key ทั้ง `th` และ `en`
- new UI ใช้ SVG sprite icon, ไม่ใช้ emoji
- สีใน new code ใช้ semantic tokens
- ถ้าใช้ `innerHTML` ต้อง escape ข้อมูลที่มาจาก DB/API/user/camera/MQTT เสมอ
- ห้ามทำ sweep ใหญ่โดยไม่มีเหตุผล เพราะเสี่ยง regression ใน dashboard ที่ใช้งานจริง

---

## 1. Hardcoded Thai/English Dynamic Strings

### Problem

ยังมีข้อความ Thai/English ที่ถูกสร้างจาก JavaScript ใน `dashboard/page-*.js` บางจุดโดยไม่ได้ผ่าน `I18N.t()`

ตัวอย่าง pattern ที่ควรหา:

```js
el.innerHTML = 'No rule firings in this window';
option.textContent = 'All categories';
showToast('บันทึกสำเร็จ');
```

### Why it matters

- Thai/English parity พังง่าย
- เปลี่ยนภาษาแล้ว dynamic text บางส่วนไม่เปลี่ยน
- future customer/white-label จะเห็นภาษาปนกัน
- ทำให้ review i18n ยาก เพราะ string กระจายตาม page modules

### Recommended approach

ทำแบบ opportunistic ตาม page ที่แตะ ไม่ต้อง sweep ทั้ง dashboard ในครั้งเดียว

ขั้นตอน:

1. หา hardcoded string ใน page ที่กำลังจะแก้
2. เพิ่ม key ใน `dashboard/i18n.js` ทั้ง `th` และ `en`
3. เปลี่ยน JS dynamic string ให้ใช้ `I18N.t(key, fallback)`
4. ถ้าเป็น static HTML ให้ใช้ `data-i18n`, `data-i18n-html`, `data-i18n-ph`, `data-i18n-title`, หรือ `data-i18n-value`
5. ตรวจว่า fallback ไม่กลายเป็น source of truth ใหม่

### Naming convention suggestion

ใช้ namespace ตาม page/feature:

```text
stats.*
cam.*
health.*
rep.*
ar.*
line.*
map.*
common.*
```

ตัวอย่าง:

```js
I18N.t('stats.noRuleFirings', 'No rule firings in this window')
I18N.t('stats.allCategories', 'All categories')
I18N.t('cam.statusLogLoadError', 'Error loading status log')
```

ใน `dashboard/i18n.js`:

```js
th: {
  stats: {
    noRuleFirings: 'ยังไม่มี rule firing ในช่วงเวลานี้',
    allCategories: 'ทุกหมวดหมู่',
  },
},
en: {
  stats: {
    noRuleFirings: 'No rule firings in this window',
    allCategories: 'All categories',
  },
}
```

### Suggested scan commands

```bash
rg -n "'[^']*[ก-๙][^']*'|\"[^\"]*[ก-๙][^\"]*\"" dashboard/page-*.js dashboard/dashboard.js
rg -n "'(All|No|Error|Loading|Save|Cancel|Connected|Disconnected)[^']*'|\"(All|No|Error|Loading|Save|Cancel|Connected|Disconnected)[^\"]*\"" dashboard/page-*.js dashboard/dashboard.js
```

Review result manually because comments, locale dictionaries, and intentional fallback strings may appear

### Validation

After changing:

```bash
node --check dashboard/dashboard.js
node --check dashboard/page-<name>.js
```

Manual UI validation:

- switch language Thai -> English -> Thai
- reload page
- verify dynamic empty/error/loading states change language
- verify no visible mixed Thai/English text except intended technical labels

### Recommended commit style

```text
fix(i18n): move stats dynamic strings into locale dictionary
fix(i18n): localize camera status log messages
```

---

## 2. Legacy Emoji UI

### Problem

Dashboard เดิมยังมี emoji UI จำนวนมากใน sidebar, headings, buttons, status labels, form labels, placeholders, and dynamic HTML

ตัวอย่าง:

```html
📷 รายละเอียดกล้อง
💾 บันทึก
🔔 การแจ้งเตือน
```

หรือใน JS:

```js
label: '🟢 Activated'
```

### Why it matters

- emoji render ไม่สม่ำเสมอข้าม OS/browser
- ไม่ themeable ด้วย `currentColor`
- ไม่ align กับ SVG icon system
- ไม่เหมาะกับ white-label visual consistency
- server-side SVG report path เคย crash จาก emoji fallback font; dashboard DOM ไม่ crash แต่ยังเป็น quality debt

### Current policy

ตาม project rule:

- existing dashboard emoji เป็น grandfathered
- new UI ไม่ควรเพิ่ม emoji
- ห้าม sweep ใหญ่
- เปลี่ยนเป็น inline SVG sprite opportunistically เมื่อแตะ component เดิม
- LINE alert/docs มี carve-out ตาม context

### Recommended approach

ทำเป็น “UI chrome cleanup” ทีละ surface:

1. เลือก page/component ที่กำลังแตะ
2. ถ้า emoji เป็น icon ของปุ่ม/heading/status ให้เปลี่ยนเป็น SVG sprite
3. ถ้า emoji เป็น value ที่ต้องเก็บเป็น data เช่น category icon ให้คงไว้ได้จนมี design ใหม่
4. เพิ่ม icon ใน `dashboard/icons.svg` ถ้ายังไม่มี
5. ใช้ `<svg aria-hidden="true"><use href="#icon-name"/></svg>` และ `currentColor`
6. ตรวจ spacing/alignment บน desktop/mobile

### Good replacement pattern

```html
<button class="btn btn-primary">
  <svg aria-hidden="true" width="13" height="13">
    <use href="#icon-save"></use>
  </svg>
  <span data-i18n="common.saveBtn">บันทึก</span>
</button>
```

### Suggested priority

1. Buttons and actions
   - save, delete, edit, export, import, preview, send

2. Section headings and tabs
   - camera detail, reports, health, users, alerts

3. Status labels
   - online/offline, activated/trial/expired

4. Free-text/category icons
   - do later, because some contexts need plain text and may not support SVG

### Suggested scan commands

```bash
rg -n "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" dashboard/index.html dashboard/page-*.js dashboard/dashboard.js
```

Manual review required because:

- comments may contain emoji
- LINE/report text may intentionally contain emoji
- category icon data may intentionally allow emoji

### Validation

- Check desktop layout
- Check mobile `<=768px`
- Check icon color follows text color/theme
- Check button height and alignment unchanged
- Check no server-side SVG report template receives emoji

### Recommended commit style

```text
refactor(ui): replace report action emoji with SVG icons
refactor(ui): replace camera action emoji with SVG icons
```

---

## 3. Hardcoded Colors

### Problem

บางส่วนยังใช้ hardcoded colors เช่น `#fff`, `#ef4444`, `#22c55e`, `#f59e0b`, `#94a3b8`
ใน dashboard pages, report templates, map/chart styles, and public docs

### Why it matters

- white-label/theme ทำได้ไม่ครบ
- contrast อาจไม่ผ่านในทุก surface/theme
- chart/map/report อาจ drift จาก design system
- new code อาจย้อนกลับไปใช้ legacy palette แทน semantic tokens

### Current policy

ตาม `DESIGN.md` / decisions:

- new UI ใช้ semantic tokens
- ห้าม hardcode colors per surface โดยไม่มีเหตุผล
- existing legacy colors ไม่ต้อง sweep ทั้งหมด
- reports/maps/charts ต้องค่อย ๆ อ่านจาก token/source เดียวกัน

### Recommended approach

แบ่งสีเป็น 4 กลุ่มก่อนแก้:

#### A. UI semantic colors

ควรเปลี่ยนเป็น CSS variables:

```css
color: var(--text-secondary);
background: var(--surface-elevated);
border-color: var(--border-hairline);
color: var(--status-bad);
color: var(--status-ok);
```

#### B. Chart colors

ควรอ่านจาก design token/JS palette:

```js
const palette = getChartPalette();
```

ถ้ายังไม่มี helper ให้ทำเฉพาะจุดที่แตะ อย่าสร้าง refactor ใหญ่

#### C. Map/OpenLayers colors

OpenLayers ต้องใช้ JS colors จึงควรมี helper mapping จาก token:

```js
const token = cssToken('--status-ok');
```

#### D. Report renderer colors

ต้องระวังมาก เพราะ reports มี HTML/PDF/PNG/SVG paths
อย่าแก้ `report-renderer.js` SVG template แบบ sweep ถ้าไม่ validate PNG path

### Suggested priority

1. New code: ห้าม hardcode เพิ่ม
2. Buttons/cards/status ที่แตะอยู่: เปลี่ยนเป็น semantic tokens
3. Dashboard dynamic HTML inline style: ลด hardcoded สี
4. Chart/map palette: ทำเมื่อแตะ chart/map feature
5. Report renderer: ทำเฉพาะเมื่อมีเวลาทดสอบ preview/PDF/PNG ครบ

### Suggested scan commands

```bash
rg -n "#[0-9a-fA-F]{3,8}|color:\\s*#|background:\\s*#" dashboard src public/others --glob '!dashboard/vendor/**' --glob '!src/node_modules/**'
```

Manual classification required:

- vendor/static docs อาจตั้งใจมี palette ของตัวเอง
- report renderer อาจต้องใช้ explicit color สำหรับ export
- SVG/Chart/Map contexts ใช้ CSS variable ตรง ๆ ไม่ได้เสมอ

### Validation

- Check desktop and mobile
- Check light/dark theme if supported by surface
- Check status color contrast
- Check charts still readable
- Check maps still show markers/popups
- If report renderer touched: validate preview, PDF, PNG/LINE image path

### Recommended commit style

```text
refactor(ui): replace camera status colors with semantic tokens
refactor(stats): read chart colors from dashboard tokens
refactor(map): derive marker status colors from CSS tokens
```

---

## 4. `innerHTML` and `escapeHtml()` Discipline

### Problem

Frontend ใช้ `innerHTML` หลายจุดเพื่อ render cards, rows, modals, and tables
นี่เป็นเรื่องปกติใน vanilla dashboard แต่ต้องมี discipline สูง เพราะข้อมูลหลายแหล่งมาจาก:

- DB
- MQTT/camera payload
- camera config
- LINE recipients/profile names
- user input
- report/history records
- alert rules

ถ้าข้อมูลเหล่านี้ถูกใส่ใน `innerHTML` โดยไม่ escape จะเสี่ยง XSS

### Why it matters

ระบบนี้เป็น CCTV/security software มี data จาก external devices และ operators
บาง field เช่น `camera_id`, `rule_name`, `object_class`, `event_type`, `snapshot_source`, LINE display name อาจเป็น attacker-controlled หรือ least-trusted data

### Current good pattern

ควรใช้:

```js
escapeHtml(value)
encodeURIComponent(filename)
textContent = value
setAttribute(name, safeValue)
```

แทน:

```js
el.innerHTML = `<div>${value}</div>`;
```

ถ้า `value` มาจาก DB/API/user/camera โดยตรง

### Rules

#### Rule 1 — Prefer DOM APIs for simple text

```js
const div = document.createElement('div');
div.textContent = row.rule_name || '';
```

#### Rule 2 — If using `innerHTML`, escape all dynamic text

```js
el.innerHTML = `
  <div class="event-title">${escapeHtml(row.rule_name || '')}</div>
  <div class="event-meta">${escapeHtml(row.camera_id || '')}</div>
`;
```

#### Rule 3 — URL/path segments must use `encodeURIComponent`

```js
const src = `${API}/snapshots/${encodeURIComponent(row.snapshot_filename)}`;
```

#### Rule 4 — Do not escape trusted markup labels blindly

ถ้าเป็น i18n string ที่ intentionally contains safe HTML ให้ใช้ pattern แยก เช่น `data-i18n-html`
และอย่าปนกับ untrusted DB text

#### Rule 5 — Event handler attributes are discouraged

หลีกเลี่ยง:

```html
onclick="doSomething('${id}')"
```

ใช้:

```html
<button data-action="open" data-id="${escapeHtml(id)}">
```

แล้ว bind ผ่าน event delegation

### Suggested helper discipline

ถ้ายังไม่มี helper เฉพาะจุด ให้ใช้ pattern เหล่านี้:

```js
function esc(v) {
  return escapeHtml(v == null ? '' : String(v));
}

function attr(v) {
  return escapeHtml(v == null ? '' : String(v));
}

function pathPart(v) {
  return encodeURIComponent(v == null ? '' : String(v));
}
```

ควรหลีกเลี่ยง helper ที่ชื่อกว้างเกินไปถ้าทำให้คนเข้าใจผิดว่า escape ใช้ได้ทุก context

### Suggested scan commands

```bash
rg -n "innerHTML\\s*=|insertAdjacentHTML|outerHTML\\s*=" dashboard/page-*.js dashboard/dashboard.js
```

Review checklist สำหรับทุกผลลัพธ์:

- dynamic text ทุกตัวผ่าน `escapeHtml()` หรือไม่
- path/filename ผ่าน `encodeURIComponent()` หรือไม่
- HTML attribute มี quote-safe escaping หรือไม่
- มี inline event handler หรือไม่
- value มาจาก trusted constant หรือ untrusted API/DB/user/camera

### Risk classification

| Data source | Risk | Required handling |
|---|---:|---|
| Static local constant | Low | OK in template |
| i18n text without HTML | Low | `escapeHtml()` if inserted via HTML |
| i18n HTML string | Medium | only from controlled dictionary |
| DB event fields | High | `escapeHtml()` |
| Camera/MQTT payload | High | `escapeHtml()` |
| User-entered config | High | `escapeHtml()` |
| Filename/path | High | `encodeURIComponent()` |
| LINE display names | High | `escapeHtml()` |

### Validation

- Run `node --check` on touched JS file
- Test page with sample values containing `<script>`, `"`, `'`, `&`, `/`
- Confirm rendered text shows literal characters, not executed HTML
- Confirm links/images still load when filename has spaces/special chars

### Recommended commit style

```text
fix(ui): escape event table dynamic fields
fix(ui): encode snapshot filenames in media cards
refactor(ui): replace inline event handlers with data-action binding
```

---

## Suggested Execution Plan

### Phase 1 — Guardrails first

Add lightweight review docs/checklists or comments near helper definitions:

- `escapeHtml()` usage rules
- no new emoji UI
- dynamic strings require `I18N.t()`
- semantic tokens for new UI colors

No behavior change

### Phase 2 — Page-by-page opportunistic cleanup

When touching a page, include cleanup only in that page:

1. Move visible strings to `i18n.js`
2. Replace action/heading emoji with SVG if icon exists
3. Replace hardcoded colors with semantic tokens
4. Review all `innerHTML` in that page

### Phase 3 — High-risk `innerHTML` pass

Prioritize pages rendering external data:

1. `page-events.js`
2. `page-snapshots.js`
3. `page-media.js`
4. `page-alerts.js`
5. `page-camera-settings.js`
6. `page-stats.js`

### Phase 4 — Visual polish pass

Only after functional/security cleanup:

- icon consistency
- spacing/alignment
- token cleanup
- chart/map color token bridge

---

## Recommended Priority

| Priority | Debt | Reason |
|---:|---|---|
| P1 | `innerHTML` / `escapeHtml()` discipline | security-sensitive, external data |
| P2 | hardcoded dynamic strings | i18n correctness and product polish |
| P3 | hardcoded colors | design system / white-label consistency |
| P4 | legacy emoji UI | visual polish; grandfathered unless touched |

### Why this order

`innerHTML` safety has security impact, so it should be checked first

i18n strings affect user-facing correctness and bilingual quality

colors affect design consistency but usually do not break behavior

emoji UI is visible debt, but existing emoji are grandfathered and should be replaced opportunistically

---

## Validation Checklist

For each cleanup slice:

```bash
node --check dashboard/<touched-file>.js
```

If `dashboard/i18n.js` changed:

```bash
node --check dashboard/i18n.js
```

Manual:

- switch Thai/English
- check desktop layout
- check mobile `<=768px`
- inspect page for mixed language
- test empty/loading/error states
- test data containing special HTML characters if relevant

If reports touched:

- preview
- PDF
- PNG/LINE image path if Health Report or server-side render path changed

---

## What Not To Do

- Do not sweep all emoji in one giant commit
- Do not rewrite frontend framework
- Do not replace all `innerHTML` with DOM APIs in a big-bang pass
- Do not move strings to i18n without checking both `th` and `en`
- Do not replace report renderer colors without validating all report output paths
- Do not add icon webfont or CDN icons
- Do not hardcode new colors because they look close enough

---

## Suggested Commit Examples

```text
fix(ui): escape events page dynamic fields
fix(i18n): localize stats empty states
refactor(ui): replace report action emoji with SVG icons
refactor(ui): use semantic tokens in media cards
fix(ui): encode snapshot filenames in media preview
```

---

## Final Recommendation

ควรจัด frontend debt ทั้ง 4 กลุ่มแบบ incremental:

1. เริ่มจาก `innerHTML` safety ในหน้าที่ render external data
2. ย้าย dynamic strings ที่เจอในหน้านั้นเข้า `dashboard/i18n.js`
3. เปลี่ยน hardcoded colors เป็น semantic tokens เฉพาะ component ที่แตะ
4. แทน emoji UI ด้วย SVG เฉพาะ action/heading/status ที่แตะ

แนวทางนี้ลด risk ได้จริงโดยไม่ทำให้ dashboard พังจาก cleanup sweep ขนาดใหญ่
