# Design: Group 2 — Emoji → SVG Dedicated Pass

**Date:** 2026-06-16
**Scope:** Replace emoji in action buttons, section headings, and tab buttons with inline SVG sprites (scope B)
**Approach:** Two-pass (A) — Pass 1 adds all needed symbols to icons.svg; Pass 2 replaces emoji in index.html + i18n.js

---

## Goal

All emoji used as UI icons in interactive elements (buttons, section headings, tab buttons) are replaced with inline SVG sprites so icons render consistently cross-OS/browser, respond to `currentColor` for theming, and are accessible.

**Not in scope:**
- 🔕 (bell-off) anywhere — GOTCHAS #90, semantics protected
- 📜 EULA modal headings — legal document headers, not action UI
- 🎬 Pre-alarm Clip link — content label inside snapshot viewer
- 👥 Groups tab — no icon-users symbol; out of scope
- 🔐 License activation header — auth flow, not a daily action button
- `<select><option>` elements — browsers don't render SVG inside option elements
- Empty-state / status messages (`📊 ยังไม่มีข้อมูล`, `📊 ไม่มีข้อมูล...`) — informational text
- 🔍 inside placeholder text and descriptive notes — not interactive elements
- LINE alert text — carve-out per project policy
- Dynamic strings in `page-*.js` — handled in Group 1 (i18n pass, already complete)
- `_APP_*` local dicts in `page-snapshots.js`

---

## Files Modified

| File | Changes |
|---|---|
| `dashboard/icons.svg` | Add 11 new `<symbol>` elements |
| `dashboard/index.html` | Pass 2: restructure data-i18n buttons/headings + fix hardcoded emoji |
| `dashboard/i18n.js` | Pass 2: strip emoji prefixes from string values (th + en blocks) |

---

## Pass 1 — New SVG Symbols

All symbols follow the existing sprite format exactly:

```svg
<symbol id="icon-*" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <!-- Heroicons outline path(s) -->
</symbol>
```

| Symbol ID | Replaces | Uses |
|---|---|---|
| `icon-download` | 📥 📄 | CSV/PDF/PNG export buttons |
| `icon-refresh` | 🔄 | Refresh + run-backup + recalculate buttons |
| `icon-trash` | 🗑 | Delete-log, clear-cache, delete-camera buttons |
| `icon-search` | 🔍 | Probe-auto button, search labels |
| `icon-save` | 💾 | Save-alert-settings button, Backup/Restore heading, Cache heading |
| `icon-send` | 📤 | Send to LINE button |
| `icon-eye` | 👁 | HR Preview button |
| `icon-bell` | 🔔 | Health-report checkbox (alerts section), camera-alert dropdown option |
| `icon-chart-bar` | 📊 | Load-data button, Estimate label |
| `icon-clipboard` | 📋 | Audit Log heading, Camera Info section heading |
| `icon-plug` | 🔌 | Connection section heading |

Already in sprite (reuse, no new symbol needed):
- `icon-camera` ✅ — replaces 📷 in tab button + camera headings
- `icon-stats` ✅ — replaces 📈 in HR uptime checkbox

---

## Pass 2 — Replacement Patterns

### Key constraint

`data-i18n` → `textContent` (confirmed in `dashboard/i18n.js:1528`). SVG HTML in i18n values will not render. Solution: move `data-i18n` to a `<span>` child; SVG is a static sibling.

### Pattern A — data-i18n button

```html
<!-- before -->
<button id="repLoadBtn" data-i18n="rep.btnLoad">📊 โหลดข้อมูล</button>

<!-- after -->
<button id="repLoadBtn">
  <svg aria-hidden="true" width="13" height="13"><use href="#icon-chart-bar"/></svg>
  <span data-i18n="rep.btnLoad">โหลดข้อมูล</span>
</button>
```

i18n.js change (both th + en):
```
'rep.btnLoad':'📊 โหลดข้อมูล'  →  'rep.btnLoad':'โหลดข้อมูล'
```

### Pattern B — hardcoded button (no data-i18n)

```html
<!-- before -->
<button class="csv-btn" id="evtExportCsvBtn">📥 CSV</button>

<!-- after -->
<button class="csv-btn" id="evtExportCsvBtn">
  <svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg> CSV
</button>
```

### Pattern C — data-i18n heading / section label

```html
<!-- before -->
<h3 class="set-h" data-i18n="aud.title">📋 Audit Log (90 วันล่าสุด)</h3>

<!-- after -->
<h3 class="set-h">
  <svg aria-hidden="true" width="14" height="14"><use href="#icon-clipboard"/></svg>
  <span data-i18n="aud.title">Audit Log (90 วันล่าสุด)</span>
</h3>
```

i18n.js change:
```
'aud.title':'📋 Audit Log (90 วันล่าสุด)'  →  'aud.title':'Audit Log (90 วันล่าสุด)'
```

### Pattern D — hardcoded heading (no data-i18n)

```html
<!-- before -->
<h3 class="set-h">💾 Backup / Restore</h3>

<!-- after -->
<h3 class="set-h">
  <svg aria-hidden="true" width="14" height="14"><use href="#icon-save"/></svg>
  Backup / Restore
</h3>
```

### Pattern E — checkbox label with data-i18n span (health report sections)

```html
<!-- before -->
<label>
  <input type="checkbox" class="hrPreviewSec" value="alerts" checked>
  <span data-i18n="hr.secAlerts">🔔 การแจ้งเตือน</span>
</label>

<!-- after -->
<label>
  <input type="checkbox" class="hrPreviewSec" value="alerts" checked>
  <svg aria-hidden="true" width="13" height="13"><use href="#icon-bell"/></svg>
  <span data-i18n="hr.secAlerts">การแจ้งเตือน</span>
</label>
```

---

## SVG sizing

| Context | Width/Height |
|---|---|
| Inline in button text | 13×13 px |
| Section heading (h3 / cfsec-h) | 14×14 px |

No layout changes needed — SVG renders inline, same line-height as text.

---

## Target Elements — Complete List

### Buttons

| Element ID / selector | Emoji | Icon |
|---|---|---|
| `#evtExportCsvBtn` (hardcoded) | 📥 | icon-download |
| `#csvBtnTimeline` (hardcoded) | 📥 | icon-download |
| `#csvBtnBreakdown` (hardcoded) | 📥 | icon-download |
| `#csvBtnKpi` (hardcoded) | 📥 | icon-download |
| `#csvBtnPeople` (hardcoded) | 📥 | icon-download |
| `#csvBtnVehicle` (hardcoded) | 📥 | icon-download |
| `#csvBtnHeatmap` (hardcoded) | 📥 | icon-download |
| `#csvBtnQuietCameras` (hardcoded) | 📥 | icon-download |
| `#csvBtnTopRules` (hardcoded) | 📥 | icon-download |
| `data-i18n="rep.btnLoad"` → `#repLoadBtn` | 📊 | icon-chart-bar |
| `data-i18n="rep.btnPdf"` → `#repPdfBtn` | 📥 | icon-download |
| `data-i18n="hr.btnPreview"` → `#hrPreviewBtn` | 👁 | icon-eye |
| `data-i18n="hr.btnDownloadPdf"` → `#hrPdfBtn` | 📄 | icon-download |
| `data-i18n="hr.btnDownloadPng"` → `#hrPngBtn` | 📥 | icon-download |
| `data-i18n="hr.btnSendNow"` → `#hrSendNowBtn` | 📤 | icon-send |
| `data-i18n="al.refresh"` → `#alRefreshBtn` | 🔄 | icon-refresh |
| `data-i18n="al.clearOld"` → `#alClearOldBtn` | 🗑 | icon-trash |
| `data-i18n="common.refresh"` → `#statusLogRefreshBtn` | 🔄 | icon-refresh |
| `data-i18n="common.refresh"` → `#imgQualRefreshBtn` | 🔄 | icon-refresh |
| `data-i18n="aud.refresh"` → `#auditRefreshBtn` | 🔄 | icon-refresh |
| `data-i18n="hlth.refresh"` → `#healthRefreshBtn` | 🔄 | icon-refresh |
| `data-i18n="cs.probeBtn"` → `#frmCamProbeBtn` | 🔍 | icon-search |
| `data-i18n="co.saveAlert"` → `#saveCamOfflineAlertBtn` | 💾 | icon-save |
| `data-i18n="common.refresh"` → `#loadPendingRecipientsBtn` | 🔄 | icon-refresh |
| `data-i18n="common.refresh"` → `#loadBlockedRecipientsBtn` | 🔄 | icon-refresh |
| `data-i18n="bk.runNow"` → `#backupRunBtn` | 🔄 | icon-refresh |
| `data-i18n="mapMgr.recalculate"` → `#mapDownloadEstimateBtn` | 🔄 | icon-refresh |
| `data-i18n="mapMgr.clearCache"` → `#mapClearCacheBtn` | 🗑 | icon-trash |

### Headings / Section labels

| Element | data-i18n key | Emoji | Icon |
|---|---|---|---|
| `<h3>` | `aud.title` | 📋 | icon-clipboard |
| `<div class="cfsec-h">` | `cs.secInfo` | 📋 | icon-clipboard |
| `<div class="cfsec-h">` | `cs.secConnection` | 🔌 | icon-plug |
| `<h3>` (hardcoded, no key) | — | 💾 | icon-save |
| `<div>` | `mapMgr.estimate` | 📊 | icon-chart-bar |
| `<div>` | `mapMgr.cacheLocal` | 💾 | icon-save |
| `<div>` | `co.secOfflineAlert` | 🔕 | **EXCLUDED** |
| `<label>` | `co.quietFrom` | 🔕 | **EXCLUDED** |

### Tabs

| Element | data-i18n key | Emoji | Icon |
|---|---|---|---|
| `<button class="tab">` | `co.tabCamera` | 📷 | icon-camera (existing) |

### Checkbox labels (health report section selectors)

| data-i18n key | Emoji | Icon |
|---|---|---|
| `hr.secCameraStatus` | 📷 | icon-camera (existing) |
| `hr.secCameraUptime` | 📈 | icon-stats (existing) |
| `hr.secAlerts` | 🔔 | icon-bell |
| `hr.secStorage` | 💾 | icon-save |

### i18n.js-only strings (no matching HTML element in index.html — also updated for consistency)

| Key | Emoji to strip |
|---|---|
| `evt.searchLabel` | 🔍 |
| `cs.probeMsg` | 🔍 (inside descriptive text — strip only the leading 🔍) |
| `aud.actUserDelete`, `aud.actCameraDelete` | 🗑 (dropdown options — strip emoji; SVG not applicable inside option) |
| `aud.actCameraCreate` | 📷 (strip emoji) |
| `aud.actCameraAlert` | 🔔 (strip emoji) |
| `us.roleViewer` | 👁 (strip emoji) |
| `us.roleAuditor` | 🔍 (strip emoji) |
| `stats.allCatsOpt` | 📊 (strip emoji) |
| `common.refresh` | 🔄 (buttons are restructured; strip from i18n value) |
| All other button/heading keys in target list above | strip emoji prefix |

---

## Reproduce

After Pass 2 (per-commit):
1. Open dashboard — verify icons render on all touched pages (desktop)
2. DevTools → 375px — verify no layout break from SVG insertion
3. Switch language Thai → English → Thai — icon stays, text changes
4. Toggle light/dark theme (if available) — icon `currentColor` follows text color
5. Scan DOM for visible emoji characters in button text or heading text (none expected in scope)

---

## What Not To Do

- Do not replace 🔕 anywhere — GOTCHAS #90
- Do not embed SVG markup inside `data-i18n` string values (textContent, won't render)
- Do not use `data-i18n-html` as a workaround — puts SVG paths in i18n dict, hard to maintain
- Do not strip emoji from LINE alert strings, EULA strings, or empty-state messages
- Do not use `data-i18n-html` on elements where `data-i18n` already exists — changing attribute type is a silent breaking change if other code reads the old attribute
