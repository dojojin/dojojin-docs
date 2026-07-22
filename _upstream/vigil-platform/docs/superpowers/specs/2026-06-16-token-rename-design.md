# Design: Group 3 — Legacy Token Rename Pass

**Date:** 2026-06-16
**Scope:** Replace all usages of legacy CSS variable names with semantic token equivalents across dashboard files
**Approach:** Hybrid — sed pipeline for JS/CSS, Edit tool for index.html

---

## Goal

All usages of legacy CSS variable names (`--dim`, `--panel`, `--border`, etc.) in dashboard source files are renamed to their semantic equivalents (`--text-secondary`, `--surface-elevated`, `--border-hairline`, etc.) per decision #173.

Zero visual change — the legacy names remain defined in `index.css :root {}` and resolve to identical hex values. The semantic names are already aliased to legacy names in the same block.

---

## Out of Scope

- Hardcoded hex values in CSS (vendor badge colors, Chart.js dataset colors, contrast-on-color `#fff`/`#000`)
- Chart.js dataset colors in `page-*.js` (requires `getComputedStyle` pattern — separate pass)
- The `:root {}` definition block in `index.css` (lines 5–38) — **must be preserved as-is**
- `dashboard/login.css`, `dashboard/disclaimer.css`, `dashboard/report-print*.css` — not dashboard UI

---

## Token Mapping

All 10 replacement pairs. Every occurrence of the left column in target files becomes the right column.

| Old (legacy) | New (semantic) | Approx usages |
|---|---|---|
| `var(--dim)` | `var(--text-secondary)` | ~322 |
| `var(--border)` | `var(--border-hairline)` | ~152 |
| `var(--panel2)` | `var(--surface-overlay)` | ~67 |
| `var(--panel)` | `var(--surface-elevated)` | ~48 |
| `var(--text)` | `var(--text-primary)` | ~56 |
| `var(--amber)` | `var(--warn)` | ~42 |
| `var(--green)` | `var(--status-ok)` | ~41 |
| `var(--red)` | `var(--status-bad)` | ~45 |
| `var(--bg)` | `var(--surface-base)` | ~3 |
| `var(--bg-card)` | `var(--surface-overlay)` | 1 |

**Collision safety:** All pairs are literal string replacements. No partial-match collisions exist:
- `var(--panel)` does not match inside `var(--panel2)` (different strings)
- `var(--text)` does not match inside `var(--text-primary)` or `var(--text-secondary)` (different strings)
- `var(--border)` does not match inside `var(--border-hairline)` (different strings)
- `var(--bg)` does not match inside `var(--bg-card)` (different strings)

---

## Files Modified

| File | Method | Notes |
|---|---|---|
| `dashboard/index.css` | sed with `40,$` line-range | Skips `:root` definition block (lines 5–38); only replaces usages below line 40 |
| `dashboard/index.html` | Edit tool (`replace_all`) in main context | Group 2 lesson: subagent writes to index.html may not persist to disk |
| `dashboard/dashboard.js` | sed | ~20 usages |
| `dashboard/page-alerts.js` | sed | 73 usages |
| `dashboard/page-camera-settings.js` | sed | 47 usages |
| `dashboard/page-cameras.js` | sed | 46 usages |
| `dashboard/page-reports.js` | sed | 42 usages |
| `dashboard/page-user-mgmt.js` | sed | 35 usages |
| `dashboard/page-stats.js` | sed | 24 usages |
| `dashboard/page-map-settings.js` | sed | 20 usages |
| `dashboard/page-system.js` | sed | 14 usages |
| `dashboard/page-health.js` | sed | 13 usages |
| `dashboard/page-snapshots.js` | sed | 12 usages |
| `dashboard/page-map.js` | sed | 8 usages |
| `dashboard/page-media.js` | sed | 7 usages |
| `dashboard/page-categories.js` | sed | 7 usages |
| `dashboard/page-face-gallery.js` | sed | 4 usages |
| `dashboard/page-appearance.js` | sed | 3 usages |

---

## index.css Constraint

The `:root {}` definition block (approximately lines 5–38) defines the semantic aliases and must be preserved:

```css
/* dark mode — MUST NOT CHANGE */
--surface-base:     var(--bg);
--surface-elevated: var(--panel);
--surface-overlay:  var(--panel2);
--text-primary:     var(--text);
--text-secondary:   var(--dim);
--warn:             var(--amber);
--status-ok:        var(--green);
--status-bad:       var(--red);
--border-hairline:  var(--border);
--bg-card:          var(--panel2);
```

If these lines were replaced, `--surface-base` would become `var(--surface-base)` — a circular reference that breaks rendering. The sed line-range `40,$` skips this block.

---

## Execution Plan

### Pass 1 — index.css (sed, line-range)

```bash
sed -i '' \
  -e '40,${s/var(--dim)/var(--text-secondary)/g}' \
  -e '40,${s/var(--panel2)/var(--surface-overlay)/g}' \
  -e '40,${s/var(--panel)/var(--surface-elevated)/g}' \
  -e '40,${s/var(--text))/var(--text-primary))/g}' \
  -e '40,${s/var(--border))/var(--border-hairline))/g}' \
  -e '40,${s/var(--amber)/var(--warn)/g}' \
  -e '40,${s/var(--green)/var(--status-ok)/g}' \
  -e '40,${s/var(--red)/var(--status-bad)/g}' \
  -e '40,${s/var(--bg))/var(--surface-base))/g}' \
  -e '40,${s/var(--bg-card)/var(--surface-overlay)/g}' \
  dashboard/index.css
```

Verify: `grep -n 'var(--dim)\|var(--panel\b\|var(--text))\|var(--border))\|var(--amber)\|var(--green)\|var(--red)\|var(--bg))' dashboard/index.css` — must return only lines inside `:root {}` block.

Commit: `refactor(tokens): replace legacy token names with semantic tokens in index.css`

### Pass 2 — index.html (Edit tool, main context)

Apply `replace_all` for each of the 10 token pairs in sequence. Verify with `git diff --stat HEAD` showing correct line count.

Commit: `refactor(tokens): replace legacy token names with semantic tokens in index.html`

### Pass 3 — JS files (sed batch)

```bash
sed -i '' \
  -e 's/var(--dim)/var(--text-secondary)/g' \
  -e 's/var(--panel2)/var(--surface-overlay)/g' \
  -e 's/var(--panel)/var(--surface-elevated)/g' \
  -e 's/var(--text))/var(--text-primary))/g' \
  -e 's/var(--border))/var(--border-hairline))/g' \
  -e 's/var(--amber)/var(--warn)/g' \
  -e 's/var(--green)/var(--status-ok)/g' \
  -e 's/var(--red)/var(--status-bad)/g' \
  -e 's/var(--bg))/var(--surface-base))/g' \
  dashboard/dashboard.js dashboard/page-*.js
```

Verify: `grep -rn 'var(--dim)\|var(--panel\b\|var(--text))\|var(--border))\|var(--amber)\|var(--green)\|var(--red)\|var(--bg))' dashboard/page-*.js dashboard/dashboard.js` — must return empty.

Commit: `refactor(tokens): replace legacy token names with semantic tokens in JS files`

---

## Verification

After all 3 commits, run the final check:

```bash
grep -rn \
  'var(--dim)\|var(--panel2\?)\|var(--amber)\|var(--green)\|var(--red)\|var(--bg-card)' \
  dashboard/index.{html,css} dashboard/*.js
```

Expected: zero results (all converted). Also confirm no circular references in `index.css`:

```bash
grep -n 'var(--surface-base)\|var(--surface-elevated)\|var(--surface-overlay)' dashboard/index.css | head -15
```

Expected: definition block lines only (e.g. `--surface-base: var(--bg)` unchanged), plus the new semantic usages below line 40.

---

## Reproduce

1. Open dashboard — verify visual appearance identical to pre-pass (no color changes)
2. DevTools → Elements → Computed — confirm `--surface-base`, `--text-secondary` etc. resolve to correct hex values
3. Toggle light/dark mode — confirm both themes still work
4. Check `≤768px` breakpoint — no layout regressions

---

## What Not To Do

- Do not touch lines 5–38 of `index.css` (the `:root {}` legacy value definitions and semantic alias block)
- Do not replace legacy names in `dashboard/login.css`, `dashboard/disclaimer.css`, `dashboard/report-print*.css`
- Do not replace hardcoded hex values — that is a separate pass
- Do not use subagents to edit `index.html` — edits may not persist to disk (Group 2 lesson)
