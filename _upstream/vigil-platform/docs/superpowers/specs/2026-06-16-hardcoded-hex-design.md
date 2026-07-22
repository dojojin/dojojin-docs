# Design: Group 4 — Hardcoded Hex Colors → Semantic Tokens

**Date:** 2026-06-16
**Scope:** Replace hardcoded hex color values in inline styles and JS status objects with semantic CSS tokens
**Approach:** Edit tool, targeted old_string → new_string per occurrence (~21 changes, 5 files, 1 commit)

---

## Goal

Replace hardcoded hex values used as status/accent colors in inline `style=""` attributes and JS status-object `color:` properties with semantic token equivalents. Zero visual change — the tokens resolve to the same hex values.

**Not in scope (explicitly excluded):**
- `:root {}` definition block in `index.css` (lines 1–40) — always preserved
- Hex+alpha variants (`#ef444430`, `#22c55e30`, `#5b8def30`) — `var()` inside 8-digit hex position is invalid CSS
- `rgba(239,68,68,...)`, `rgba(34,197,94,...)` — decimal form; `var()` not composable directly
- `<input type="color" value="#5b8def">` (index.html:2473) — color picker default must remain hex
- `c.color || '#5b8def'` and `settings.brand_primary_color?.value || '#5b8def'` — data defaults, not design tokens
- Chart.js `backgroundColor` values — data visualization palette, separate pass
- Vendor badge tint colors (`#9ab8f5`, `#f0a0a0`, `#f5c97a`, `#86d9a4`) — brand-specific, not tokens

---

## Token Mapping

| Hex | Token | Semantic meaning |
|---|---|---|
| `#ef4444` | `var(--status-bad)` | Error / offline / license expired |
| `#22c55e` | `var(--status-ok)` | Success / online / license active |
| `#f59e0b` | `var(--warn)` | Warning / trial mode |
| `#5b8def` | `var(--accent)` | Primary accent / kind badge |

---

## Target Changes — Complete List

### dashboard/index.css

| Line | Old | New |
|---|---|---|
| 1177 | `background:#ef4444` | `background:var(--status-bad)` |

Only 1 change. The nav-badge alert dot uses the raw status-bad color.

### dashboard/index.html

| Line | Old | New |
|---|---|---|
| 787 | `style="background:#5b8def"` | `style="background:var(--accent)"` |
| 788 | `style="background:#22c55e"` | `style="background:var(--status-ok)"` |
| 801 | `style="background:#22c55e"` | `style="background:var(--status-ok)"` |
| 828 | `style="background:#5b8def"` | `style="background:var(--accent)"` |
| 829 | `style="background:#f59e0b"` | `style="background:var(--warn)"` |
| 879 | `style="background:#22c55e"` | `style="background:var(--status-ok)"` |
| 880 | `style="background:#f59e0b"` | `style="background:var(--warn)"` |

These are chart legend color swatches (`.lgdd`) and live badges. All use `background:` with no alpha.

**SKIP line 2473:** `<input type="color" ... value="#5b8def">` — color picker default must stay hex.

### dashboard/page-categories.js

| Old string | New string | Context |
|---|---|---|
| `background:#ef444430;color:#ef4444` | `background:#ef444430;color:var(--status-bad)` | EVENT badge (alpha bg stays, text color fixed) |
| `color:#ef4444">${escapeHtml(I18N.t('cat.ruleIdMissing'))}` | `color:var(--status-bad)">${escapeHtml(I18N.t('cat.ruleIdMissing'))}` | Error message inline style |
| `text-align:center;color:#ef4444">` (line 244) | `text-align:center;color:var(--status-bad)">` | Error message inline style |
| `background:#22c55e30;color:#22c55e` | `background:#22c55e30;color:var(--status-ok)` | PEOPLE badge (alpha bg stays, text color fixed) |
| `background:#5b8def30;color:#5b8def` | `background:#5b8def30;color:var(--accent)` | VEHICLE badge (alpha bg stays, text color fixed) |

**SKIP:** `c.color || '#5b8def'` (line 55) and `c.color : '#5b8def'` (line 94) — data defaults for user-defined category colors.

### dashboard/page-cameras.js

| Old string | New string | Context |
|---|---|---|
| `{ color: '#22c55e', label: '🟢 Activated' }` | `{ color: 'var(--status-ok)', label: '🟢 Activated' }` | License status object |
| `{ color: '#f59e0b', label: '🟡 Trial' }` | `{ color: 'var(--warn)', label: '🟡 Trial' }` | License status object |
| `{ color: '#ef4444', label: '🔴 Trial Expired' }` | `{ color: 'var(--status-bad)', label: '🔴 Trial Expired' }` | License status object |
| `{ color: '#ef4444', label: '🔴 License Expired' }` | `{ color: 'var(--status-bad)', label: '🔴 License Expired' }` | License status object |
| `{ color: '#ef4444', label: '🔴 Invalid License' }` | `{ color: 'var(--status-bad)', label: '🔴 Invalid License' }` | License status object |
| `border-radius:5px;color:#ef4444"></div>` | `border-radius:5px;color:var(--status-bad)"></div>` | License error div inline style |
| `border:1px solid rgba(34,197,94,0.5);color:#22c55e;` | `border:1px solid rgba(34,197,94,0.5);color:var(--status-ok);` | License success banner cssText |

**SKIP:** `rgba(239,68,68,0.1)`, `rgba(239,68,68,0.3)`, `rgba(34,197,94,0.15)`, `rgba(34,197,94,0.5)` — decimal alpha forms, not replaceable.

### dashboard/page-stats.js

| Old string | New string | Context |
|---|---|---|
| `text-align:center;color:#ef4444">${escapeHtml(I18N.t('stats.densityHeatmapErr'))}` | `text-align:center;color:var(--status-bad)">${escapeHtml(I18N.t('stats.densityHeatmapErr'))}` | Error row inline style |
| `text-align:center;color:#ef4444">${escapeHtml(I18N.t('stats.heatmapErr'))}` | `text-align:center;color:var(--status-bad)">${escapeHtml(I18N.t('stats.heatmapErr'))}` | Error row inline style |

**SKIP:** `backgroundColor: '#22c55e'` (line 1298), `backgroundColor: '#f59e0b'` (line 1300) — Chart.js dataset colors.

---

## Commit

Single commit after all 5 files edited and verified:

```
refactor(tokens): replace hardcoded status hex colors with semantic tokens
```

---

## Verification

```bash
# Should return only :root definitions and explicitly excluded patterns
grep -rn '#ef4444\|#22c55e\|#f59e0b\|#5b8def' \
  dashboard/index.{html,css} dashboard/page-categories.js dashboard/page-cameras.js dashboard/page-stats.js
```

Expected remaining:
- `index.css:6` — `:root` definition block (expected, kept)
- `index.html:2473` — color picker `value="#5b8def"` (expected, kept)
- `page-categories.js:55,94` — `c.color || '#5b8def'` data defaults (expected, kept)
- `page-cameras.js` — `rgba(239,68,68,...)`, `rgba(34,197,94,...)` decimal forms (expected, kept)
- `page-stats.js` — Chart.js `backgroundColor` values (expected, kept)
- Any hex+alpha variants (`#ef444430` etc.) — alpha bg kept, only text color was fixed

---

## What Not To Do

- Do not replace `rgba()` decimal color values with `var()` — not directly composable
- Do not replace `<input type="color" value="#5b8def">` — must remain hex for browser color picker
- Do not replace `c.color || '#5b8def'` data defaults — these are fallback values for user-defined colors
- Do not replace Chart.js `backgroundColor` values — separate pass (getComputedStyle pattern)
- Do not touch `:root {}` definition block
