# Group 4 — Hardcoded Hex Colors → Semantic Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ All edits must be made in **main context** using the Edit tool — not subagents. Subagent writes to HTML/JS files may not persist (Group 2 lesson).

**Goal:** Replace ~21 hardcoded hex color values in inline styles and JS status objects with semantic CSS tokens across 5 files — zero visual change, 1 commit.

**Architecture:** Targeted Edit tool replacements (old_string → new_string) per occurrence. No global string replace — each edit is precise to avoid touching rgba(), hex+alpha (#ef444430), color picker values, and data defaults.

**Tech Stack:** Edit tool with replace_all: false (all edits are unique strings).

---

## Exclusions (do NOT touch these — read before editing)

- `index.css` lines 1–40: `:root {}` definition block
- `#ef444430`, `#22c55e30`, `#5b8def30`: hex+alpha — alpha background stays, only `color:` text was fixed
- `rgba(239,68,68,...)`, `rgba(34,197,94,...)`: decimal alpha — not replaceable with var()
- `<input type="color" value="#5b8def">` (index.html line ~2473): color picker default must remain hex
- `c.color || '#5b8def'` and `|| '#5b8def'` data defaults in page-categories.js and page-system.js
- Chart.js `backgroundColor: '#22c55e'`, `backgroundColor: '#f59e0b'` in page-stats.js

---

## Task 1: index.css — nav-badge color

**Files:**
- Modify: `dashboard/index.css` (~line 1177)

- [ ] **Step 1: Apply edit**

Find this exact string in `dashboard/index.css`:
```
background:#ef4444; color:#fff; font-size:10px; font-weight:700; min-width:17px; height:17px; border-radius:9px; display:none; align-items:center; justify-content:center; padding:0 5px; }
```

Replace with:
```
background:var(--status-bad); color:#fff; font-size:10px; font-weight:700; min-width:17px; height:17px; border-radius:9px; display:none; align-items:center; justify-content:center; padding:0 5px; }
```

- [ ] **Step 2: Verify**

```bash
grep -n '#ef4444' dashboard/index.css
```

Expected: only line 6 (`:root` definition block) — nothing else.

---

## Task 2: index.html — chart legend swatches and live badge

**Files:**
- Modify: `dashboard/index.html` (~lines 787, 788, 801, 828, 829, 879, 880)

All 7 edits are unique strings. Apply each separately.

- [ ] **Step 1: Apply 7 edits**

**2a.** Find:
```
<div class="lgdi"><div class="lgdd" style="background:#5b8def"></div><span data-i18n="stats.lgdTotalEvts">
```
Replace with:
```
<div class="lgdi"><div class="lgdd" style="background:var(--accent)"></div><span data-i18n="stats.lgdTotalEvts">
```

**2b.** Find:
```
<div class="lgdi"><div class="lgdd" style="background:#22c55e"></div><span data-i18n="stats.lgdAlerts">
```
Replace with:
```
<div class="lgdi"><div class="lgdd" style="background:var(--status-ok)"></div><span data-i18n="stats.lgdAlerts">
```

**2c.** Find:
```
<span class="cbadge" id="occBadge" style="background:#22c55e"
```
Replace with:
```
<span class="cbadge" id="occBadge" style="background:var(--status-ok)"
```

**2d.** Find:
```
<div class="lgdi"><div class="lgdd" style="background:#5b8def"></div><span data-i18n="stats.avgOcc">
```
Replace with:
```
<div class="lgdi"><div class="lgdd" style="background:var(--accent)"></div><span data-i18n="stats.avgOcc">
```

**2e.** Find:
```
<div class="lgdi"><div class="lgdd" style="background:#f59e0b"></div><span data-i18n="stats.peakOcc">
```
Replace with:
```
<div class="lgdi"><div class="lgdd" style="background:var(--warn)"></div><span data-i18n="stats.peakOcc">
```

**2f.** Find:
```
<div class="lgdi"><div class="lgdd" style="background:#22c55e"></div><span data-i18n="stats.pcEnter">
```
Replace with:
```
<div class="lgdi"><div class="lgdd" style="background:var(--status-ok)"></div><span data-i18n="stats.pcEnter">
```

**2g.** Find:
```
<div class="lgdi"><div class="lgdd" style="background:#f59e0b"></div><span data-i18n="stats.pcExit">
```
Replace with:
```
<div class="lgdi"><div class="lgdd" style="background:var(--warn)"></div><span data-i18n="stats.pcExit">
```

- [ ] **Step 2: Verify**

```bash
grep -n '#5b8def\|#22c55e\|#f59e0b' dashboard/index.html
```

Expected: only `value="#5b8def"` (line ~2473, color picker — intentionally kept) and nothing else.

---

## Task 3: page-categories.js — kind badges and error messages

**Files:**
- Modify: `dashboard/page-categories.js`

- [ ] **Step 1: Apply 5 edits**

**3a.** Fix PEOPLE badge text color (alpha bg stays):

Find:
```
'<span style="background:#22c55e30;color:#22c55e;padding:2px 6px;border-radius:4px;font-size:10px">PEOPLE</span>'
```
Replace with:
```
'<span style="background:#22c55e30;color:var(--status-ok);padding:2px 6px;border-radius:4px;font-size:10px">PEOPLE</span>'
```

**3b.** Fix VEHICLE badge text color (alpha bg stays):

Find:
```
: c.kind === 'vehicle_counter' ? '<span style="background:#5b8def30;color:#5b8def;padding:2px 6px;border-radius:4px;font-size:10px">VEHICLE</span>'
```
Replace with:
```
: c.kind === 'vehicle_counter' ? '<span style="background:#5b8def30;color:var(--accent);padding:2px 6px;border-radius:4px;font-size:10px">VEHICLE</span>'
```

**3c.** Fix EVENT badge text color (alpha bg stays):

Find:
```
: '<span style="background:#ef444430;color:#ef4444;padding:2px 6px;border-radius:4px;font-size:10px">EVENT</span>';
```
Replace with:
```
: '<span style="background:#ef444430;color:var(--status-bad);padding:2px 6px;border-radius:4px;font-size:10px">EVENT</span>';
```

**3d.** Fix ruleIdMissing error message:

Find:
```
`<div style="padding:20px;text-align:center;color:#ef4444">${escapeHtml(I18N.t('cat.ruleIdMissing'))}</div>`
```
Replace with:
```
`<div style="padding:20px;text-align:center;color:var(--status-bad)">${escapeHtml(I18N.t('cat.ruleIdMissing'))}</div>`
```

**3e.** Fix rule list error message:

Find:
```
list.innerHTML = `<div style="padding:20px;text-align:center;color:#ef4444">
```
Replace with:
```
list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--status-bad)">
```

- [ ] **Step 2: Verify**

```bash
grep -n '#ef4444\|#22c55e\|#5b8def' dashboard/page-categories.js
```

Expected: only `#ef444430`, `#22c55e30`, `#5b8def30` (alpha bg), `c.color || '#5b8def'` (line ~55), and `c.color : '#5b8def'` (line ~94) — all intentionally kept.

---

## Task 4: page-cameras.js — license status objects and error divs

**Files:**
- Modify: `dashboard/page-cameras.js`

- [ ] **Step 1: Apply 7 edits**

**4a.** LICENSED status:

Find:
```
LICENSED:          { color: '#22c55e', label: '🟢 Activated' },
```
Replace with:
```
LICENSED:          { color: 'var(--status-ok)', label: '🟢 Activated' },
```

**4b.** TRIAL status:

Find:
```
TRIAL:             { color: '#f59e0b', label: '🟡 Trial' },
```
Replace with:
```
TRIAL:             { color: 'var(--warn)', label: '🟡 Trial' },
```

**4c.** TRIAL_EXPIRED status:

Find:
```
TRIAL_EXPIRED:     { color: '#ef4444', label: '🔴 Trial Expired' },
```
Replace with:
```
TRIAL_EXPIRED:     { color: 'var(--status-bad)', label: '🔴 Trial Expired' },
```

**4d.** EXPIRED status:

Find:
```
EXPIRED:           { color: '#ef4444', label: '🔴 License Expired' },
```
Replace with:
```
EXPIRED:           { color: 'var(--status-bad)', label: '🔴 License Expired' },
```

**4e.** INVALID status:

Find:
```
INVALID:           { color: '#ef4444', label: '🔴 Invalid License' },
```
Replace with:
```
INVALID:           { color: 'var(--status-bad)', label: '🔴 Invalid License' },
```

**4f.** License activate error div:

Find:
```
border-radius:5px;color:#ef4444"></div>
```
Replace with:
```
border-radius:5px;color:var(--status-bad)"></div>
```

**4g.** License success banner cssText:

Find:
```
border:1px solid rgba(34,197,94,0.5);color:#22c55e;padding:10px;border-radius:5px;margin-bottom:12px;text-align:center;font-weight:bold'
```
Replace with:
```
border:1px solid rgba(34,197,94,0.5);color:var(--status-ok);padding:10px;border-radius:5px;margin-bottom:12px;text-align:center;font-weight:bold'
```

- [ ] **Step 2: Verify**

```bash
grep -n '#ef4444\|#22c55e\|#f59e0b' dashboard/page-cameras.js
```

Expected: only `rgba(239,68,68,...)` and `rgba(34,197,94,...)` decimal forms, plus `#94a3b8` (unrelated neutral gray) — no bare status hex values.

---

## Task 5: page-stats.js — error row inline styles

**Files:**
- Modify: `dashboard/page-stats.js`

- [ ] **Step 1: Apply 2 edits**

**5a.** Density heatmap error:

Find:
```
`<tr><td style="padding:20px;text-align:center;color:#ef4444">${escapeHtml(I18N.t('stats.densityHeatmapErr'))}
```
Replace with:
```
`<tr><td style="padding:20px;text-align:center;color:var(--status-bad)">${escapeHtml(I18N.t('stats.densityHeatmapErr'))}
```

**5b.** Heatmap error:

Find:
```
`<tr><td style="padding:20px;text-align:center;color:#ef4444">${escapeHtml(I18N.t('stats.heatmapErr'))}
```
Replace with:
```
`<tr><td style="padding:20px;text-align:center;color:var(--status-bad)">${escapeHtml(I18N.t('stats.heatmapErr'))}
```

- [ ] **Step 2: Verify**

```bash
grep -n '#ef4444' dashboard/page-stats.js
```

Expected: only `backgroundColor: '#ef4444'` if any (Chart.js — kept), otherwise empty. The two inline style `color:#ef4444` lines should be gone.

---

## Task 6: Final verification and commit

- [ ] **Step 1: Full verification sweep**

```bash
grep -rn '#ef4444\|#22c55e\|#f59e0b\|#5b8def' \
  dashboard/index.{html,css} dashboard/page-categories.js dashboard/page-cameras.js dashboard/page-stats.js
```

Expected remaining (all intentional — verify each):
- `index.css:6` — `:root` definition block
- `index.html:~2473` — `value="#5b8def"` color picker
- `page-categories.js:~55` — `c.color || '#5b8def'`
- `page-categories.js:~94` — `c.color : '#5b8def'`
- `page-categories.js` — `#ef444430`, `#22c55e30`, `#5b8def30` alpha bg (kept)
- `page-cameras.js` — `rgba(239,68,68,...)`, `rgba(34,197,94,...)` decimal forms
- `page-stats.js` — `backgroundColor: '#22c55e'`, `backgroundColor: '#f59e0b'` (Chart.js)

- [ ] **Step 2: Check diff stat**

```bash
git diff --stat HEAD
```

Expected: 5 files changed with small line counts (no file should show hundreds of changes — this is targeted).

- [ ] **Step 3: Wait for user confirm, then commit**

```bash
git add dashboard/index.css dashboard/index.html \
  dashboard/page-categories.js dashboard/page-cameras.js dashboard/page-stats.js
git commit -m "refactor(tokens): replace hardcoded status hex colors with semantic tokens"
```
