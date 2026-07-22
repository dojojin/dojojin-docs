# Group 2 — Emoji → SVG Dedicated Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all emoji used as UI icons in action buttons, section headings, and tab buttons with inline SVG sprites so icons are cross-OS consistent, `currentColor`-themeable, and no longer depend on OS emoji font rendering.

**Architecture:** Two-pass — Pass 1 adds 11 new `<symbol>` elements to `dashboard/icons.svg`; Pass 2 updates `dashboard/index.html` (restructure data-i18n elements, fix hardcoded emoji) and strips emoji prefixes from `dashboard/i18n.js` string values (th + en). Existing symbols `icon-camera` and `icon-stats` are reused where 📷 / 📈 appear.

**Tech Stack:** Vanilla JS, inline SVG sprite (`dashboard/icons.svg`), `data-i18n` system (applies `textContent` — SVG cannot go into i18n.js values directly), Heroicons/Feather-style stroke paths (24×24, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`).

**Key constraint confirmed:** `dashboard/i18n.js:1528` — `data-i18n` sets `textContent`. SVG in i18n values is not rendered. Pattern for data-i18n elements: move `data-i18n` to an inner `<span>`; add `<svg>` as a sibling before it.

**Exclusions:** 🔕 all uses (GOTCHAS #90), 📜 EULA headings, 🎬 clip viewer links, 👥 groups tab (no icon), 🔐 license activation, `<option>` elements inside `<select>`, empty-state info text, placeholder attributes, descriptive notes.

---

## Files Modified

| File | Changes |
|---|---|
| `dashboard/icons.svg` | Add 11 new `<symbol>` elements after line 125 |
| `dashboard/i18n.js` | Strip emoji prefixes from 14 keys in th block + same 14 in en block |
| `dashboard/index.html` | Restructure ~40 elements (data-i18n buttons/headings + hardcoded) |

---

## Task 1: Add SVG Symbols to icons.svg (Pass 1)

**Files:**
- Modify: `dashboard/icons.svg:125` (insert before closing `</svg>`)

- [ ] **Step 1: Insert 11 new symbols before the closing `</svg>` tag**

Find line 127 in `dashboard/icons.svg`:
```
</svg>
```

Replace with:
```svg

  <!-- icon-download: arrow down into tray (📥 📄 — export/download) -->
  <symbol id="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </symbol>

  <!-- icon-refresh: circular arrows (🔄 — reload/refresh/retry) -->
  <symbol id="icon-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
  </symbol>

  <!-- icon-trash: trash can (🗑 — delete/clear) -->
  <symbol id="icon-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
  </symbol>

  <!-- icon-search: magnifying glass (🔍 — search/probe/find) -->
  <symbol id="icon-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </symbol>

  <!-- icon-save: floppy disk (💾 — save settings/backup) -->
  <symbol id="icon-save" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/>
    <polyline points="7 3 7 8 15 8"/>
  </symbol>

  <!-- icon-send: paper airplane (📤 — send to LINE) -->
  <symbol id="icon-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </symbol>

  <!-- icon-eye: open eye (👁 — preview/view) -->
  <symbol id="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </symbol>

  <!-- icon-bell: bell (🔔 — alert/notification) -->
  <symbol id="icon-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 01-3.46 0"/>
  </symbol>

  <!-- icon-chart-bar: bar chart (📊 — data/stats/report load) -->
  <symbol id="icon-chart-bar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="12" width="4" height="9"/>
    <rect x="10" y="7" width="4" height="14"/>
    <rect x="17" y="3" width="4" height="18"/>
    <line x1="1" y1="21" x2="23" y2="21"/>
  </symbol>

  <!-- icon-clipboard: clipboard with lines (📋 — audit log/info section) -->
  <symbol id="icon-clipboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="2" width="6" height="4" rx="1"/>
    <path d="M14 4h2a2 2 0 012 2v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
    <line x1="9" y1="12" x2="15" y2="12"/>
    <line x1="9" y1="16" x2="13" y2="16"/>
  </symbol>

  <!-- icon-plug: lightning bolt (🔌 — connection/power) -->
  <symbol id="icon-plug" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </symbol>

</svg>
```

- [ ] **Step 2: Verify SVG is valid XML**

```bash
node -e "const fs=require('fs'); const x=fs.readFileSync('dashboard/icons.svg','utf8'); if(!x.includes('icon-plug'))throw new Error('missing'); console.log('ok, symbols:', (x.match(/<symbol/g)||[]).length)"
```
Expected: `ok, symbols: 29`

- [ ] **Step 3: Commit**

```bash
git add dashboard/icons.svg
git commit -m "feat(icons): add 11 SVG symbols for action buttons and headings"
```

---

## Task 2: Strip Emoji from i18n.js Values (Pass 2a)

**Files:**
- Modify: `dashboard/i18n.js` (th block ~lines 84–753, en block ~lines 821–1490)

**Context:** Many i18n.js values contain emoji prefixes. Stripping them here means once the page loads and i18n replaces textContent, no emoji appears. The HTML also needs fixing (fallback text shown before i18n loads) — that is done in Tasks 3–7.

**Keys to fix (th block first, then en block):**

| Key | th: before → after | en: before → after |
|---|---|---|
| `evt.searchLabel` | `🔍 ค้นหา` → `ค้นหา` | `🔍 Search` → `Search` |
| `al.refresh` | `🔄 รีเฟรช` → `รีเฟรช` | `🔄 Refresh` → `Refresh` |
| `al.clearOld` | `🗑 ลบ Log เก่า (>30d)` → `ลบ Log เก่า (>30d)` | `🗑 Clear Old Logs (>30d)` → `Clear Old Logs (>30d)` |
| `hlth.refresh` | `🔄 รีเฟรช` → `รีเฟรช` | `🔄 Refresh` → `Refresh` |
| `cs.secInfo` | `📋 ข้อมูลกล้อง` → `ข้อมูลกล้อง` | `📋 Camera Info` → `Camera Info` |
| `cs.secConnection` | `🔌 การเชื่อมต่อ` → `การเชื่อมต่อ` | `🔌 Connection` → `Connection` |
| `cs.probeBtn` | `🔍 ตรวจหาอัตโนมัติ` → `ตรวจหาอัตโนมัติ` | `🔍 Auto-detect` → `Auto-detect` |
| `cs.snapPathPh` | `กด "🔍 ตรวจหาอัตโนมัติ"…` → `กด "ตรวจหาอัตโนมัติ"…` | `Click "🔍 Auto-detect"…` → `Click "Auto-detect"…` |
| `cs.probeMsg` | `กด "🔍 ตรวจหาอัตโนมัติ" ให้…` → `กด "ตรวจหาอัตโนมัติ" ให้…` | `Click "🔍 Auto-detect" to…` → `Click "Auto-detect" to…` |
| `co.tabCamera` | `📷 กล้อง` → `กล้อง` | `📷 Cameras` → `Cameras` |
| `co.tab` | `📋 ประวัติสถานะ` → `ประวัติสถานะ` | `📋 Status Log` → `Status Log` |
| `aud.title` | `📋 Audit Log (90 วันล่าสุด)` → `Audit Log (90 วันล่าสุด)` | `📋 Audit Log (last 90 days)` → `Audit Log (last 90 days)` |
| `lic.renewHeader` | `🔄 ต่ออายุ License` → `ต่ออายุ License` | `🔄 Renew License` → `Renew License` |
| `rt.trendTitle` | `📊 ภาพรวมเหตุการณ์ {label}` → `ภาพรวมเหตุการณ์ {label}` | `📊 Event Overview {label}` → `Event Overview {label}` |
| `aux.camDetailTitle` | `📷 รายละเอียดกล้อง` → `รายละเอียดกล้อง` | `📷 Camera Detail` → `Camera Detail` |

- [ ] **Step 1: Fix th block — `evt.searchLabel` (line 84)**

Find:
```
'evt.searchLabel':'🔍 ค้นหา',
```
Change to:
```
'evt.searchLabel':'ค้นหา',
```

- [ ] **Step 2: Fix th block — `al.refresh` + `al.clearOld` (line 376)**

Find:
```
'al.refresh':'🔄 รีเฟรช','al.clearOld':'🗑 ลบ Log เก่า (>30d)',
```
Change to:
```
'al.refresh':'รีเฟรช','al.clearOld':'ลบ Log เก่า (>30d)',
```

- [ ] **Step 3: Fix th block — `hlth.refresh` (line 388)**

Find:
```
'hlth.refresh':'🔄 รีเฟรช',
```
Change to:
```
'hlth.refresh':'รีเฟรช',
```

- [ ] **Step 4: Fix th block — `cs.secInfo`, `cs.secConnection` (lines 406, 409)**

Find:
```
'cs.secInfo':'📋 ข้อมูลกล้อง',
```
Change to:
```
'cs.secInfo':'ข้อมูลกล้อง',
```

Find:
```
'cs.secConnection':'🔌 การเชื่อมต่อ',
```
Change to:
```
'cs.secConnection':'การเชื่อมต่อ',
```

- [ ] **Step 5: Fix th block — `cs.probeBtn`, `cs.snapPathPh`, `cs.probeMsg` (lines 411–412)**

Find:
```
'cs.snapPathPh':'กด "🔍 ตรวจหาอัตโนมัติ" หรือกรอกเอง','cs.probeBtn':'🔍 ตรวจหาอัตโนมัติ',
```
Change to:
```
'cs.snapPathPh':'กด "ตรวจหาอัตโนมัติ" หรือกรอกเอง','cs.probeBtn':'ตรวจหาอัตโนมัติ',
```

Find:
```
'cs.probeMsg':'กด "🔍 ตรวจหาอัตโนมัติ" ให้ระบบหา snapshot path — กรอกเองได้หลังตรวจไม่พบ',
```
Change to:
```
'cs.probeMsg':'กด "ตรวจหาอัตโนมัติ" ให้ระบบหา snapshot path — กรอกเองได้หลังตรวจไม่พบ',
```

- [ ] **Step 6: Fix th block — `co.tabCamera`, `co.tab` (line 439)**

Find:
```
'co.tabCamera':'📷 กล้อง',
```
Change to:
```
'co.tabCamera':'กล้อง',
```

Find:
```
'co.tab':'📋 ประวัติสถานะ',
```
Change to:
```
'co.tab':'ประวัติสถานะ',
```

- [ ] **Step 7: Fix th block — `lic.renewHeader` (line 577)**

Find:
```
'lic.renewHeader':'🔄 ต่ออายุ License',
```
Change to:
```
'lic.renewHeader':'ต่ออายุ License',
```

- [ ] **Step 8: Fix th block — `aud.title` (line 590)**

Find:
```
'aud.title':'📋 Audit Log (90 วันล่าสุด)',
```
Change to:
```
'aud.title':'Audit Log (90 วันล่าสุด)',
```

- [ ] **Step 9: Fix th block — `rt.trendTitle` (line 753)**

Find:
```
'rt.trendTitle':'📊 ภาพรวมเหตุการณ์ {label}',
```
Change to:
```
'rt.trendTitle':'ภาพรวมเหตุการณ์ {label}',
```

- [ ] **Step 10: Fix en block — `evt.searchLabel` (line 821)**

Find:
```
'evt.searchLabel':'🔍 Search',
```
Change to:
```
'evt.searchLabel':'Search',
```

- [ ] **Step 11: Fix en block — `cs.secInfo`, `cs.secConnection`, `cs.probeBtn`, `cs.snapPathPh`, `cs.probeMsg` (lines 1143–1150)**

Find:
```
'cs.secInfo':'📋 Camera Info',
```
Change to:
```
'cs.secInfo':'Camera Info',
```

Find:
```
'cs.secConnection':'🔌 Connection',
```
Change to:
```
'cs.secConnection':'Connection',
```

Find:
```
'cs.snapPathPh':'Click "🔍 Auto-detect" or enter manually','cs.probeBtn':'🔍 Auto-detect',
```
Change to:
```
'cs.snapPathPh':'Click "Auto-detect" or enter manually','cs.probeBtn':'Auto-detect',
```

Find:
```
'cs.probeMsg':'Click "🔍 Auto-detect" to find the snapshot path — enter it manually if not found',
```
Change to:
```
'cs.probeMsg':'Click "Auto-detect" to find the snapshot path — enter it manually if not found',
```

- [ ] **Step 12: Fix en block — `al.refresh`, `al.clearOld` (line 1113)**

Find:
```
'al.refresh':'🔄 Refresh','al.clearOld':'🗑 Clear Old Logs (>30d)',
```
Change to:
```
'al.refresh':'Refresh','al.clearOld':'Clear Old Logs (>30d)',
```

- [ ] **Step 13: Fix en block — `hlth.refresh` (line 1125)**

Find:
```
'hlth.refresh':'🔄 Refresh',
```
Change to:
```
'hlth.refresh':'Refresh',
```

- [ ] **Step 14: Fix en block — `co.tabCamera`, `co.tab` (line 1176)**

Find:
```
'co.tabCamera':'📷 Cameras',
```
Change to:
```
'co.tabCamera':'Cameras',
```

Find:
```
'co.tab':'📋 Status Log',
```
Change to:
```
'co.tab':'Status Log',
```

- [ ] **Step 15: Fix en block — `lic.renewHeader` (line 1314)**

Find:
```
'lic.renewHeader':'🔄 Renew License',
```
Change to:
```
'lic.renewHeader':'Renew License',
```

- [ ] **Step 16: Fix en block — `aud.title` (line 1327)**

Find:
```
'aud.title':'📋 Audit Log (last 90 days)',
```
Change to:
```
'aud.title':'Audit Log (last 90 days)',
```

- [ ] **Step 17: Fix en block — `rt.trendTitle` (line 1490)**

Find:
```
'rt.trendTitle':'📊 Event Overview {label}',
```
Change to:
```
'rt.trendTitle':'Event Overview {label}',
```

- [ ] **Step 18: Fix th block — `aux.camDetailTitle` (line 674)**

Find:
```
'aux.camDetailTitle':'📷 รายละเอียดกล้อง',
```
Change to:
```
'aux.camDetailTitle':'รายละเอียดกล้อง',
```

- [ ] **Step 19: Fix en block — `aux.camDetailTitle` (line 1411)**

Find:
```
'aux.camDetailTitle':'📷 Camera Detail',
```
Change to:
```
'aux.camDetailTitle':'Camera Detail',
```

- [ ] **Step 20: Syntax check**

```bash
node --check dashboard/i18n.js
```
Expected: no output

- [ ] **Step 21: Verify no emoji remaining in target keys**

```bash
node -e "
const s=require('fs').readFileSync('dashboard/i18n.js','utf8');
const keys=['evt.searchLabel','al.refresh','al.clearOld','hlth.refresh','cs.secInfo','cs.secConnection','cs.probeBtn','co.tabCamera','co.tab','aud.title','lic.renewHeader','rt.trendTitle','aux.camDetailTitle'];
const emoji=/[\u{1F300}-\u{1F9FF}]/u;
let ok=true;
for(const k of keys){
  const m=s.match(new RegExp(\"'\" + k + \"':'([^']+)'\"));
  if(m&&emoji.test(m[1])){console.error('FAIL:',k,'still has emoji:',m[1]);ok=false;}
}
if(ok)console.log('all clean');
"
```
Expected: `all clean`

- [ ] **Step 22: Commit**

```bash
git add dashboard/i18n.js
git commit -m "fix(i18n): strip emoji prefixes from button/heading string values"
```

---

## Task 3: Fix Hardcoded Buttons and Heading in index.html

**Files:**
- Modify: `dashboard/index.html` at lines 296, 782, 911, 924, 945, 958, 977, 1008, 1021, 1107, 1451, 1755

These elements have no `data-i18n` — emoji is hardcoded directly in HTML.

SVG helper to use (13px for buttons):
```html
<svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg>
```

- [ ] **Step 1: Fix CSV export button (line 296)**

Find:
```html
<button class="csv-btn" id="evtExportCsvBtn" style="font-size:11px">📥 CSV</button>
```
Change to:
```html
<button class="csv-btn" id="evtExportCsvBtn" style="font-size:11px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg> CSV</button>
```

- [ ] **Step 2: Fix timeline CSV button (line 782)**

Find:
```html
<button class="csv-btn" id="csvBtnTimeline" title="Export timeline as CSV">📥 CSV</button>
```
Change to:
```html
<button class="csv-btn" id="csvBtnTimeline" title="Export timeline as CSV"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg> CSV</button>
```

- [ ] **Step 3: Fix breakdown, KPI, people, vehicle, heatmap, quiet-camera, top-rules CSV buttons (lines 911, 924, 945, 958, 977, 1008, 1021)**

Find and replace each in order:
```html
<button class="csv-btn" id="csvBtnBreakdown" title="Export breakdown as CSV">📥 CSV</button>
```
→
```html
<button class="csv-btn" id="csvBtnBreakdown" title="Export breakdown as CSV"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg> CSV</button>
```

```html
<button class="csv-btn" id="csvBtnKpi" title="Export category counts as CSV">📥 CSV</button>
```
→
```html
<button class="csv-btn" id="csvBtnKpi" title="Export category counts as CSV"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg> CSV</button>
```

```html
<button class="csv-btn" id="csvBtnPeople" title="Export as CSV">📥 CSV</button>
```
→
```html
<button class="csv-btn" id="csvBtnPeople" title="Export as CSV"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg> CSV</button>
```

```html
<button class="csv-btn" id="csvBtnVehicle" title="Export as CSV">📥 CSV</button>
```
→
```html
<button class="csv-btn" id="csvBtnVehicle" title="Export as CSV"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg> CSV</button>
```

```html
<button class="csv-btn" id="csvBtnHeatmap" title="Export heatmap as CSV">📥 CSV</button>
```
→
```html
<button class="csv-btn" id="csvBtnHeatmap" title="Export heatmap as CSV"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg> CSV</button>
```

```html
<button class="csv-btn" id="csvBtnQuietCameras" title="Export as CSV">📥 CSV</button>
```
→
```html
<button class="csv-btn" id="csvBtnQuietCameras" title="Export as CSV"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg> CSV</button>
```

```html
<button class="csv-btn" id="csvBtnTopRules" title="Export as CSV">📥 CSV</button>
```
→
```html
<button class="csv-btn" id="csvBtnTopRules" title="Export as CSV"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg> CSV</button>
```

- [ ] **Step 4: Fix hardcoded All categories option (line 1107)**

Find:
```html
<option value="">📊 All categories</option>
```
Change to:
```html
<option value="">All categories</option>
```
(no SVG in option — browsers don't render it; just strip emoji)

- [ ] **Step 5: Fix monitor-mode note (line 1451)**

Find:
```html
              🔍 <strong style="color:var(--text)">โหมด Monitor อย่างเดียว</strong>
```
Change to:
```html
              <svg aria-hidden="true" width="13" height="13"><use href="#icon-search"/></svg> <strong style="color:var(--text)">โหมด Monitor อย่างเดียว</strong>
```
(This note uses `data-i18n-html="cs.monitorNote"` so the emoji version from i18n.js replaces it on load — but the fallback inline HTML also has 🔍. The i18n.js value still has 🔍 in `cs.monitorNote` since that key has inline HTML and is applied via `data-i18n-html`. Leave the i18n.js value as-is for now; fixing it requires stripping emoji inside HTML which is out of scope for this pass. This step only fixes the fallback.)

Actually, check `cs.monitorNote` in i18n.js:

```bash
grep -n "cs.monitorNote" dashboard/i18n.js
```

If it contains `🔍 <strong...>`, replace the leading `🔍 ` with empty string in both th and en values. The HTML structure is preserved; only the emoji prefix is removed.

Find in i18n.js th block (line ~413):
```
'cs.monitorNote':'🔍 <strong style="color:var(--text)">โหมด Monitor อย่างเดียว</strong>
```
Change to:
```
'cs.monitorNote':'<strong style="color:var(--text)">โหมด Monitor อย่างเดียว</strong>
```

Find in i18n.js en block (line ~1150):
```
'cs.monitorNote':'🔍 <strong style="color:var(--text)">Monitor-only mode</strong>
```
Change to:
```
'cs.monitorNote':'<strong style="color:var(--text)">Monitor-only mode</strong>
```

- [ ] **Step 6: Fix hardcoded Backup/Restore heading (line 1755)**

Find:
```html
           <h3 class="set-h">💾 Backup / Restore</h3>
```
Change to:
```html
           <h3 class="set-h"><svg aria-hidden="true" width="14" height="14"><use href="#icon-save"/></svg> Backup / Restore</h3>
```

- [ ] **Step 7: Syntax check**

```bash
node --check dashboard/i18n.js
```
Expected: no output (i18n.js was also edited in this task for cs.monitorNote)

- [ ] **Step 8: Commit**

```bash
git add dashboard/index.html dashboard/i18n.js
git commit -m "fix(ui): replace hardcoded emoji with SVG in CSV buttons and headings"
```

---

## Task 4: Fix Report Panel + HR Buttons (data-i18n, lines 1114–1122 + 2212)

**Files:**
- Modify: `dashboard/index.html` at lines 1114, 1115, 1119, 1120, 1121, 1122, 2212

Pattern for data-i18n buttons:
```html
<!-- before -->
<button id="repLoadBtn" data-i18n="rep.btnLoad">📊 โหลดข้อมูล</button>

<!-- after: move data-i18n to span, add SVG before it -->
<button id="repLoadBtn"><svg aria-hidden="true" width="13" height="13"><use href="#icon-chart-bar"/></svg><span data-i18n="rep.btnLoad">โหลดข้อมูล</span></button>
```

Note: `rep.btnLoad` in i18n.js is already `'โหลดข้อมูล'` (no emoji) — only HTML needs fixing. Same for all keys in this task.

- [ ] **Step 1: Fix Load Data button (line 1114)**

Find:
```html
              <button class="btn btn-primary" id="repLoadBtn" style="width:100%;margin-bottom:8px" data-i18n="rep.btnLoad">📊 โหลดข้อมูล</button>
```
Change to:
```html
              <button class="btn btn-primary" id="repLoadBtn" style="width:100%;margin-bottom:8px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-chart-bar"/></svg><span data-i18n="rep.btnLoad">โหลดข้อมูล</span></button>
```

- [ ] **Step 2: Fix Download PDF button (line 1115)**

Find:
```html
              <button class="btn btn-primary" id="repPdfBtn" style="width:100%;background:var(--green);margin-bottom:8px" data-i18n="rep.btnPdf">📥 ดาวน์โหลด PDF</button>
```
Change to:
```html
              <button class="btn btn-primary" id="repPdfBtn" style="width:100%;background:var(--green);margin-bottom:8px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg><span data-i18n="rep.btnPdf">ดาวน์โหลด PDF</span></button>
```

- [ ] **Step 3: Fix HR Preview button (line 1119)**

Find:
```html
              <button class="btn btn-primary" id="hrPreviewBtn" style="width:100%;margin-bottom:8px" data-i18n="hr.btnPreview">👁 ดู Preview</button>
```
Change to:
```html
              <button class="btn btn-primary" id="hrPreviewBtn" style="width:100%;margin-bottom:8px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-eye"/></svg><span data-i18n="hr.btnPreview">ดู Preview</span></button>
```

- [ ] **Step 4: Fix HR Download PDF button (line 1120)**

Find:
```html
              <button class="btn btn-primary" id="hrPdfBtn" style="width:100%;background:var(--green);margin-bottom:8px" data-i18n="hr.btnDownloadPdf">📄 ดาวน์โหลด PDF</button>
```
Change to:
```html
              <button class="btn btn-primary" id="hrPdfBtn" style="width:100%;background:var(--green);margin-bottom:8px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg><span data-i18n="hr.btnDownloadPdf">ดาวน์โหลด PDF</span></button>
```

- [ ] **Step 5: Fix HR Download PNG button (line 1121)**

Find:
```html
              <button class="btn btn-primary" id="hrPngBtn" style="width:100%;background:var(--green);margin-bottom:8px" data-i18n="hr.btnDownloadPng">📥 ดาวน์โหลด PNG</button>
```
Change to:
```html
              <button class="btn btn-primary" id="hrPngBtn" style="width:100%;background:var(--green);margin-bottom:8px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg><span data-i18n="hr.btnDownloadPng">ดาวน์โหลด PNG</span></button>
```

- [ ] **Step 6: Fix HR Send to LINE button (line 1122)**

Find:
```html
              <button class="btn btn-primary admin-only" id="hrSendNowBtn" style="width:100%;background:var(--accent);margin-bottom:8px" data-i18n="hr.btnSendNow">📤 ส่งเข้า LINE ทันที</button>
```
Change to:
```html
              <button class="btn btn-primary admin-only" id="hrSendNowBtn" style="width:100%;background:var(--accent);margin-bottom:8px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-send"/></svg><span data-i18n="hr.btnSendNow">ส่งเข้า LINE ทันที</span></button>
```

- [ ] **Step 7: Fix Save Schedule button (line 2212)**

Find:
```html
          <button class="btn btn-primary" id="saveReportScheduleBtn" style="font-size:12px" data-i18n="rs.btnSave">💾 บันทึกตาราง</button>
```
Change to:
```html
          <button class="btn btn-primary" id="saveReportScheduleBtn" style="font-size:12px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-save"/></svg><span data-i18n="rs.btnSave">บันทึกตาราง</span></button>
```

- [ ] **Step 8: Commit**

```bash
git add dashboard/index.html
git commit -m "fix(ui): replace emoji with SVG in report panel and HR buttons"
```

---

## Task 5: Fix Refresh/Delete/Save/Probe Action Buttons (data-i18n, lines 1163–1909)

**Files:**
- Modify: `dashboard/index.html` at lines 1163, 1164, 1227, 1262, 1308, 1331, 1436, 1549, 1725, 1735, 1762, 1894, 1909, 2269

Note: i18n.js values for these keys are already emoji-free (confirmed: `al.refresh`, `common.refresh`, `aud.refresh`, `bk.runNow`, `co.saveAlert`, `common.saveBtn` all have clean values). Only HTML restructuring needed.

- [ ] **Step 1: Fix Alert Log Refresh button (line 1163)**

Find:
```html
                  <button class="btn btn-secondary" id="alRefreshBtn" data-i18n="al.refresh">🔄 รีเฟรช</button>
```
Change to:
```html
                  <button class="btn btn-secondary" id="alRefreshBtn"><svg aria-hidden="true" width="13" height="13"><use href="#icon-refresh"/></svg><span data-i18n="al.refresh">รีเฟรช</span></button>
```

- [ ] **Step 2: Fix Alert Log Clear button (line 1164)**

Find:
```html
                  <button class="btn btn-danger admin-only" id="alClearOldBtn" data-i18n="al.clearOld">🗑 ลบ Log เก่า (>30d)</button>
```
Change to:
```html
                  <button class="btn btn-danger admin-only" id="alClearOldBtn"><svg aria-hidden="true" width="13" height="13"><use href="#icon-trash"/></svg><span data-i18n="al.clearOld">ลบ Log เก่า (>30d)</span></button>
```

- [ ] **Step 3: Fix Status Log Refresh button (line 1227)**

Find:
```html
                    <button class="btn btn-secondary" id="statusLogRefreshBtn" data-i18n="common.refresh" style="font-size:11px">🔄 โหลดใหม่</button>
```
Change to:
```html
                    <button class="btn btn-secondary" id="statusLogRefreshBtn" style="font-size:11px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-refresh"/></svg><span data-i18n="common.refresh">โหลดใหม่</span></button>
```

- [ ] **Step 4: Fix Image Quality Refresh button (line 1262)**

Find:
```html
                    <button class="btn btn-secondary" id="imgQualRefreshBtn" data-i18n="common.refresh" style="font-size:11px">🔄 โหลดใหม่</button>
```
Change to:
```html
                    <button class="btn btn-secondary" id="imgQualRefreshBtn" style="font-size:11px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-refresh"/></svg><span data-i18n="common.refresh">โหลดใหม่</span></button>
```

- [ ] **Step 5: Fix Audit Refresh button (line 1308)**

Find:
```html
                <button class="btn btn-secondary" id="auditRefreshBtn" data-i18n="aud.refresh">🔄 รีเฟรช</button>
```
Change to:
```html
                <button class="btn btn-secondary" id="auditRefreshBtn"><svg aria-hidden="true" width="13" height="13"><use href="#icon-refresh"/></svg><span data-i18n="aud.refresh">รีเฟรช</span></button>
```

- [ ] **Step 6: Fix Health Refresh button (line 1331)**

Find:
```html
            <button class="btn btn-secondary" id="healthRefreshBtn" data-i18n="hlth.refresh">🔄 รีเฟรช</button>
```
Change to:
```html
            <button class="btn btn-secondary" id="healthRefreshBtn"><svg aria-hidden="true" width="13" height="13"><use href="#icon-refresh"/></svg><span data-i18n="hlth.refresh">รีเฟรช</span></button>
```

- [ ] **Step 7: Fix Auto-detect Probe button (line 1436)**

Find:
```html
                  <button type="button" class="btn btn-secondary" id="frmCamProbeBtn" style="white-space:nowrap" data-i18n="cs.probeBtn">🔍 ตรวจหาอัตโนมัติ</button>
```
Change to:
```html
                  <button type="button" class="btn btn-secondary" id="frmCamProbeBtn" style="white-space:nowrap"><svg aria-hidden="true" width="13" height="13"><use href="#icon-search"/></svg><span data-i18n="cs.probeBtn">ตรวจหาอัตโนมัติ</span></button>
```

- [ ] **Step 8: Fix Save Alert Settings button (line 1549)**

Find:
```html
              <button class="btn btn-secondary" id="saveCamOfflineAlertBtn" data-i18n="co.saveAlert">💾 บันทึกการตั้งค่าแจ้งเตือน</button>
```
Change to:
```html
              <button class="btn btn-secondary" id="saveCamOfflineAlertBtn"><svg aria-hidden="true" width="13" height="13"><use href="#icon-save"/></svg><span data-i18n="co.saveAlert">บันทึกการตั้งค่าแจ้งเตือน</span></button>
```

- [ ] **Step 9: Fix two LINE recipient Refresh buttons (lines 1725, 1735)**

Find:
```html
                       <button class="btn btn-secondary" id="loadPendingRecipientsBtn" style="font-size:11px" data-i18n="common.refresh">🔄 โหลดใหม่</button>
```
Change to:
```html
                       <button class="btn btn-secondary" id="loadPendingRecipientsBtn" style="font-size:11px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-refresh"/></svg><span data-i18n="common.refresh">โหลดใหม่</span></button>
```

Find:
```html
                       <button class="btn btn-secondary" id="loadBlockedRecipientsBtn" style="font-size:11px" data-i18n="common.refresh">🔄 โหลดใหม่</button>
```
Change to:
```html
                       <button class="btn btn-secondary" id="loadBlockedRecipientsBtn" style="font-size:11px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-refresh"/></svg><span data-i18n="common.refresh">โหลดใหม่</span></button>
```

- [ ] **Step 10: Fix Run Backup Now button (line 1762)**

Find:
```html
               <button class="btn btn-primary" id="backupRunBtn" data-i18n="bk.runNow">🔄 สำรองข้อมูลตอนนี้</button>
```
Change to:
```html
               <button class="btn btn-primary" id="backupRunBtn"><svg aria-hidden="true" width="13" height="13"><use href="#icon-refresh"/></svg><span data-i18n="bk.runNow">สำรองข้อมูลตอนนี้</span></button>
```

- [ ] **Step 11: Fix Map Recalculate button (line 1894)**

Find:
```html
                 <button class="btn btn-secondary" id="mapDownloadEstimateBtn" data-i18n="mapMgr.recalculate">🔄 คำนวณใหม่</button>
```
Change to:
```html
                 <button class="btn btn-secondary" id="mapDownloadEstimateBtn"><svg aria-hidden="true" width="13" height="13"><use href="#icon-refresh"/></svg><span data-i18n="mapMgr.recalculate">คำนวณใหม่</span></button>
```

- [ ] **Step 12: Fix Map Clear Cache button (line 1909)**

Find:
```html
                   <button class="btn btn-danger" id="mapClearCacheBtn" style="padding:4px 10px;font-size:10px" data-i18n="mapMgr.clearCache">🗑 ลบ Cache ทั้งหมด</button>
```
Change to:
```html
                   <button class="btn btn-danger" id="mapClearCacheBtn" style="padding:4px 10px;font-size:10px"><svg aria-hidden="true" width="13" height="13"><use href="#icon-trash"/></svg><span data-i18n="mapMgr.clearCache">ลบ Cache ทั้งหมด</span></button>
```

- [ ] **Step 13: Fix Save User button (line 2269)**

Find:
```html
        <button class="btn btn-primary" id="saveUserBtn" data-i18n="common.saveBtn">💾 บันทึก</button>
```
Change to:
```html
        <button class="btn btn-primary" id="saveUserBtn"><svg aria-hidden="true" width="13" height="13"><use href="#icon-save"/></svg><span data-i18n="common.saveBtn">บันทึก</span></button>
```

- [ ] **Step 14: Commit**

```bash
git add dashboard/index.html
git commit -m "fix(ui): replace emoji with SVG in action and refresh buttons"
```

---

## Task 6: Fix Headings, Tab, Modal Heading, Form Labels (data-i18n)

**Files:**
- Modify: `dashboard/index.html` at lines 265, 1285, 1356, 1376, 1394, 1887, 1908, 2009, 2041

Pattern for data-i18n headings (move data-i18n to span):
```html
<!-- before -->
<h3 class="set-h" data-i18n="aud.title">📋 Audit Log</h3>

<!-- after -->
<h3 class="set-h"><svg aria-hidden="true" width="14" height="14"><use href="#icon-clipboard"/></svg><span data-i18n="aud.title">Audit Log</span></h3>
```

- [ ] **Step 1: Fix Search label (line 265)**

Find:
```html
              <label class="form-label" data-i18n="evt.searchLabel">🔍 ค้นหา</label>
```
Change to:
```html
              <label class="form-label"><svg aria-hidden="true" width="13" height="13"><use href="#icon-search"/></svg><span data-i18n="evt.searchLabel">ค้นหา</span></label>
```

- [ ] **Step 2: Fix Audit Log heading (line 1285)**

Find:
```html
              <h3 class="set-h" data-i18n="aud.title">📋 Audit Log (90 วันล่าสุด)</h3>
```
Change to:
```html
              <h3 class="set-h"><svg aria-hidden="true" width="14" height="14"><use href="#icon-clipboard"/></svg><span data-i18n="aud.title">Audit Log (90 วันล่าสุด)</span></h3>
```

- [ ] **Step 3: Fix Camera sub-tab button (line 1356)**

Find:
```html
          <button class="tab active" id="camSubTabCameras" data-i18n="co.tabCamera">📷 กล้อง</button>
```
Change to:
```html
          <button class="tab active" id="camSubTabCameras"><svg aria-hidden="true" width="13" height="13"><use href="#icon-camera"/></svg><span data-i18n="co.tabCamera">กล้อง</span></button>
```

- [ ] **Step 4: Fix Camera Info section heading (line 1376)**

Find:
```html
                <div class="cfsec-h" data-i18n="cs.secInfo">📋 ข้อมูลกล้อง</div>
```
Change to:
```html
                <div class="cfsec-h"><svg aria-hidden="true" width="14" height="14"><use href="#icon-clipboard"/></svg><span data-i18n="cs.secInfo">ข้อมูลกล้อง</span></div>
```

- [ ] **Step 5: Fix Connection section heading (line 1394)**

Find:
```html
                <div class="cfsec-h" data-i18n="cs.secConnection">🔌 การเชื่อมต่อ</div>
```
Change to:
```html
                <div class="cfsec-h"><svg aria-hidden="true" width="14" height="14"><use href="#icon-plug"/></svg><span data-i18n="cs.secConnection">การเชื่อมต่อ</span></div>
```

- [ ] **Step 6: Fix Map Estimate label (line 1887)**

Find:
```html
                 <div style="font-size:11px;color:var(--text-secondary);margin-bottom:5px;font-weight:600" data-i18n="mapMgr.estimate">📊 ประมาณการ</div>
```
Change to:
```html
                 <div style="font-size:11px;color:var(--text-secondary);margin-bottom:5px;font-weight:600"><svg aria-hidden="true" width="13" height="13"><use href="#icon-chart-bar"/></svg><span data-i18n="mapMgr.estimate">ประมาณการ</span></div>
```

- [ ] **Step 7: Fix Map Cache Local label (line 1908)**

Find:
```html
                   <div style="font-size:11px;color:var(--text-secondary);font-weight:600" data-i18n="mapMgr.cacheLocal">💾 Cache บนเครื่อง</div>
```
Change to:
```html
                   <div style="font-size:11px;color:var(--text-secondary);font-weight:600"><svg aria-hidden="true" width="13" height="13"><use href="#icon-save"/></svg><span data-i18n="mapMgr.cacheLocal">Cache บนเครื่อง</span></div>
```

- [ ] **Step 8: Fix Camera Detail modal heading (line 2009)**

Find:
```html
      <h2 id="camDetailTitle" data-i18n="aux.camDetailTitle">📷 รายละเอียดกล้อง</h2>
```
Change to:
```html
      <h2 id="camDetailTitle"><svg aria-hidden="true" width="16" height="16"><use href="#icon-camera"/></svg><span data-i18n="aux.camDetailTitle">รายละเอียดกล้อง</span></h2>
```

- [ ] **Step 9: Fix Cameras form label in alert rule editor (line 2041)**

Find:
```html
          <label class="form-label" data-i18n="ar.fldCameras">📷 Cameras (ว่าง = ทุกตัว)</label>
```
Change to:
```html
          <label class="form-label"><svg aria-hidden="true" width="13" height="13"><use href="#icon-camera"/></svg><span data-i18n="ar.fldCameras">Cameras (ว่าง = ทุกตัว)</span></label>
```

- [ ] **Step 10: Commit**

```bash
git add dashboard/index.html
git commit -m "fix(ui): replace emoji with SVG in headings, tab, modal heading, and form labels"
```

---

## Task 7: Fix Health Report Checkbox Labels (Both Sets)

**Files:**
- Modify: `dashboard/index.html` at lines 1087–1091 and 2177–2181

These checkboxes already have `data-i18n` on the `<span>` (not on the label). The i18n.js values for these keys are already emoji-free. We add an SVG before the span and remove the emoji from the fallback span text.

Pattern:
```html
<!-- before -->
<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
  <input type="checkbox" class="hrPreviewSec" value="alerts" checked>
  <span data-i18n="hr.secAlerts">🔔 การแจ้งเตือน</span>
</label>

<!-- after -->
<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
  <input type="checkbox" class="hrPreviewSec" value="alerts" checked>
  <svg aria-hidden="true" width="13" height="13"><use href="#icon-bell"/></svg>
  <span data-i18n="hr.secAlerts">การแจ้งเตือน</span>
</label>
```

(inline for compactness in the actual file — no line breaks needed)

- [ ] **Step 1: Fix first set of checkboxes (lines 1087–1091, class `hrPreviewSec`)**

Find (line 1087):
```html
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrPreviewSec" value="camera_status" checked><span data-i18n="hr.secCameraStatus">📷 สถานะกล้อง</span></label>
```
Change to:
```html
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrPreviewSec" value="camera_status" checked><svg aria-hidden="true" width="13" height="13"><use href="#icon-camera"/></svg><span data-i18n="hr.secCameraStatus">สถานะกล้อง</span></label>
```

Find (line 1088):
```html
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrPreviewSec" value="camera_uptime" checked><span data-i18n="hr.secCameraUptime">📈 Uptime กล้อง</span></label>
```
Change to:
```html
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrPreviewSec" value="camera_uptime" checked><svg aria-hidden="true" width="13" height="13"><use href="#icon-stats"/></svg><span data-i18n="hr.secCameraUptime">Uptime กล้อง</span></label>
```

Find (line 1089):
```html
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrPreviewSec" value="alerts" checked><span data-i18n="hr.secAlerts">🔔 การแจ้งเตือน</span></label>
```
Change to:
```html
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrPreviewSec" value="alerts" checked><svg aria-hidden="true" width="13" height="13"><use href="#icon-bell"/></svg><span data-i18n="hr.secAlerts">การแจ้งเตือน</span></label>
```

Find (line 1090):
```html
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrPreviewSec" value="storage" checked><span data-i18n="hr.secStorage">💾 พื้นที่จัดเก็บ</span></label>
```
Change to:
```html
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrPreviewSec" value="storage" checked><svg aria-hidden="true" width="13" height="13"><use href="#icon-save"/></svg><span data-i18n="hr.secStorage">พื้นที่จัดเก็บ</span></label>
```

Find (line 1091 — bonus: ⚙️ already has icon-settings):
```html
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrPreviewSec" value="system" checked><span data-i18n="hr.secSystem">⚙️ ระบบ</span></label>
```
Change to:
```html
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrPreviewSec" value="system" checked><svg aria-hidden="true" width="13" height="13"><use href="#icon-settings"/></svg><span data-i18n="hr.secSystem">ระบบ</span></label>
```

And fix `hr.secSystem` in i18n.js (check if it has ⚙️):
```bash
grep "hr.secSystem" dashboard/i18n.js
```
If value is `'⚙️ ระบบ'` / `'⚙️ System'`, strip the emoji prefix.

- [ ] **Step 2: Fix second set of checkboxes (lines 2177–2181, class `hrSecCheck`)**

Find (line 2177):
```html
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrSecCheck" value="camera_status" checked><span data-i18n="hr.secCameraStatus">📷 สถานะกล้อง</span></label>
```
Change to:
```html
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrSecCheck" value="camera_status" checked><svg aria-hidden="true" width="13" height="13"><use href="#icon-camera"/></svg><span data-i18n="hr.secCameraStatus">สถานะกล้อง</span></label>
```

Find (line 2178):
```html
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrSecCheck" value="camera_uptime" checked><span data-i18n="hr.secCameraUptime">📈 Uptime กล้อง</span></label>
```
Change to:
```html
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrSecCheck" value="camera_uptime" checked><svg aria-hidden="true" width="13" height="13"><use href="#icon-stats"/></svg><span data-i18n="hr.secCameraUptime">Uptime กล้อง</span></label>
```

Find (line 2179):
```html
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrSecCheck" value="alerts" checked><span data-i18n="hr.secAlerts">🔔 การแจ้งเตือน</span></label>
```
Change to:
```html
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrSecCheck" value="alerts" checked><svg aria-hidden="true" width="13" height="13"><use href="#icon-bell"/></svg><span data-i18n="hr.secAlerts">การแจ้งเตือน</span></label>
```

Find (line 2180):
```html
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrSecCheck" value="storage" checked><span data-i18n="hr.secStorage">💾 พื้นที่จัดเก็บ</span></label>
```
Change to:
```html
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrSecCheck" value="storage" checked><svg aria-hidden="true" width="13" height="13"><use href="#icon-save"/></svg><span data-i18n="hr.secStorage">พื้นที่จัดเก็บ</span></label>
```

Find (line 2181):
```html
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrSecCheck" value="system" checked><span data-i18n="hr.secSystem">⚙️ ระบบ</span></label>
```
Change to:
```html
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" class="hrSecCheck" value="system" checked><svg aria-hidden="true" width="13" height="13"><use href="#icon-settings"/></svg><span data-i18n="hr.secSystem">ระบบ</span></label>
```

- [ ] **Step 3: Strip ⚙️ from hr.secSystem in i18n.js if present**

```bash
grep -n "hr.secSystem" dashboard/i18n.js
```

If th value is `'⚙️ ระบบ'`, find and replace in th block:
```
'hr.secSystem':'⚙️ ระบบ'
```
→
```
'hr.secSystem':'ระบบ'
```

If en value has `'⚙️ System'`, same pattern:
```
'hr.secSystem':'⚙️ System'
```
→
```
'hr.secSystem':'System'
```

- [ ] **Step 4: Syntax check**

```bash
node --check dashboard/i18n.js
```
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html dashboard/i18n.js
git commit -m "fix(ui): replace emoji with SVG in health report section checkboxes"
```

---

## Task 8: Reproduce

- [ ] **Step 1: Open dashboard in browser — verify icons render (desktop)**

Navigate to each touched page section:
- Stats page → CSV buttons show download icon
- Report page → Load Data (chart-bar icon), Download PDF/PNG (download icon), Preview (eye icon), Send to LINE (send icon)
- Alert Log → Refresh (refresh icon), Clear Old (trash icon)
- Camera Settings → Camera Info (clipboard icon), Connection (plug icon), Auto-detect probe button (search icon), Save Alert Settings (save icon)
- Audit Log → heading shows clipboard icon + text
- Health/System page → Refresh button (refresh icon)
- Backup section → heading shows save icon, Run backup button (refresh icon)
- Map Manager → Estimate label (chart-bar icon), Recalculate (refresh icon), Cache label (save icon), Clear Cache (trash icon)
- HR section checkboxes → camera/stats/bell/save/settings icons

Verify: icons visible, no ☐ boxes (missing glyphs), no raw emoji characters

- [ ] **Step 2: Test at ≤768px width (DevTools → 375px)**

Open each page above. Verify:
- No layout break (icon is 13×13px inline, should not cause overflow)
- Buttons still readable (icon + text)
- No icon clipped or hidden

- [ ] **Step 3: Switch language Thai → English → Thai**

Use the language toggle. Verify:
- Icon does NOT change (it is static SVG, not from i18n)
- Text changes to English / back to Thai correctly
- No button shows emoji (both languages should be clean)

- [ ] **Step 4: Toggle dark/light theme**

Switch theme. Verify:
- Icons follow `currentColor` — they lighten/darken with the text
- No hardcoded color icons

- [ ] **Step 5: Scan DOM for remaining emoji in scope**

Open browser console and run:
```js
// check for emoji in button text
Array.from(document.querySelectorAll('button')).filter(b => /[\u{1F300}-\u{1F9FF}]/u.test(b.textContent)).map(b => b.id || b.textContent.trim().slice(0,30))
```
Expected: empty array `[]` (or only buttons outside scope like EULA/license)

```js
// check for emoji in h2/h3 headings
Array.from(document.querySelectorAll('h2,h3')).filter(h => /[\u{1F300}-\u{1F9FF}]/u.test(h.textContent)).map(h => h.textContent.trim().slice(0,40))
```
Expected: empty array (EULA headings excluded/not in scope)
