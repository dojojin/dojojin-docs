# Group 3 — Legacy Token Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ **Task 2 (index.html) MUST be executed by the controller in main context — NOT dispatched to a subagent.** Group 2 lesson: subagent writes to index.html may not persist to disk. The controller should run Task 2 steps directly using the Edit tool.

**Goal:** Replace all usages of legacy CSS variable names (`--dim`, `--panel`, `--border`, etc.) with semantic token equivalents across 18 dashboard files — zero visual change, 3 commits.

**Architecture:** Pure string replacement — no logic changes. `index.css :root {}` definition block (lines 1–40) must be preserved as-is; replacements apply from line 41 onward in that file. All other target files get unconditional replacement.

**Tech Stack:** macOS BSD sed (`sed -i ''`), Edit tool (`replace_all`), grep for verification.

---

## Token Mapping (reference for all tasks)

| Old | New |
|---|---|
| `var(--dim)` | `var(--text-secondary)` |
| `var(--border)` | `var(--border-hairline)` |
| `var(--panel2)` | `var(--surface-overlay)` |
| `var(--panel)` | `var(--surface-elevated)` |
| `var(--text)` | `var(--text-primary)` |
| `var(--amber)` | `var(--warn)` |
| `var(--green)` | `var(--status-ok)` |
| `var(--red)` | `var(--status-bad)` |
| `var(--bg)` | `var(--surface-base)` |
| `var(--bg-card)` | `var(--surface-overlay)` |

All replacements are literal string substitutions. No regex needed — `var(--panel)` cannot match inside `var(--panel2)` because the strings differ.

---

## Task 1: Replace legacy tokens in index.css

**Files:**
- Modify: `dashboard/index.css` (lines 41+, skip :root definition block)

- [ ] **Step 1: Run sed replacement (lines 41 onward only)**

```bash
sed -i '' \
  -e '41,${s/var(--dim)/var(--text-secondary)/g}' \
  -e '41,${s/var(--panel2)/var(--surface-overlay)/g}' \
  -e '41,${s/var(--panel)/var(--surface-elevated)/g}' \
  -e '41,${s/var(--text)/var(--text-primary)/g}' \
  -e '41,${s/var(--border)/var(--border-hairline)/g}' \
  -e '41,${s/var(--amber)/var(--warn)/g}' \
  -e '41,${s/var(--green)/var(--status-ok)/g}' \
  -e '41,${s/var(--red)/var(--status-bad)/g}' \
  -e '41,${s/var(--bg)/var(--surface-base)/g}' \
  dashboard/index.css
```

Note: `41,$` means "apply only to lines 41 through end of file." Lines 1–40 contain the `:root {}` definition block (semantic alias definitions like `--surface-base: var(--bg)`) which must not be changed.

- [ ] **Step 2: Verify — no legacy tokens remain below line 40**

```bash
awk 'NR>40' dashboard/index.css | grep -n 'var(--dim)\|var(--panel2\?)\|var(--text)\b\|var(--border)\b\|var(--amber)\|var(--green)\|var(--red)\|var(--bg)\b'
```

Expected output: **empty** (no matches).

Also verify the definition block was NOT touched (lines 10–21 must still have the legacy names):

```bash
sed -n '10,21p' dashboard/index.css
```

Expected output (unchanged):
```
    --surface-base:     var(--bg);
    --surface-elevated: var(--panel);
    --surface-overlay:  var(--panel2);
    --text-primary:     var(--text);
    --text-secondary:   var(--dim);
    --accent-muted:     #4a7bd4;
    --warn:             var(--amber);
    --status-ok:        var(--green);
    --status-bad:       var(--red);
    --border-hairline:  var(--border);
```

- [ ] **Step 3: Confirm diff looks right**

```bash
git diff --stat HEAD dashboard/index.css
```

Expected: `dashboard/index.css | NNN +++++...-----` (number of changed lines, roughly 264 replacements but many lines have multiple tokens so actual line count will vary).

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.css
git commit -m "refactor(tokens): replace legacy token names with semantic tokens in index.css"
```

---

## Task 2: Replace legacy tokens in index.html

> ⚠️ **CONTROLLER EXECUTES THIS TASK DIRECTLY — do not dispatch to a subagent.**
> Subagents writing to `dashboard/index.html` may not persist changes to disk (Group 2 lesson).
> The controller must use the Edit tool with `replace_all` in the main context.

**Files:**
- Modify: `dashboard/index.html`

- [ ] **Step 1: Read the file** (required before editing)

Read `dashboard/index.html` to load it into context. The file is large (~2300+ lines).

- [ ] **Step 2: Apply all 9 token replacements using replace_all**

Apply these Edit calls in sequence (each is a separate `replace_all: true` call):

**2a.** `var(--dim)` → `var(--text-secondary)` (~88 occurrences)

**2b.** `var(--border)` → `var(--border-hairline)` (~35 occurrences)

**2c.** `var(--panel2)` → `var(--surface-overlay)` (~11 occurrences)

**2d.** `var(--panel)` → `var(--surface-elevated)` (~15 occurrences)

**2e.** `var(--text)` → `var(--text-primary)` (~9 occurrences)

**2f.** `var(--amber)` → `var(--warn)` (~6 occurrences)

**2g.** `var(--green)` → `var(--status-ok)` (~5 occurrences)

**2h.** `var(--red)` → `var(--status-bad)` (~3 occurrences)

**2i.** `var(--bg-card)` → `var(--surface-overlay)` (1 occurrence)

Note: `var(--bg)` is not used in `index.html` — skip it.

- [ ] **Step 3: Verify — no legacy tokens remain**

```bash
grep -n 'var(--dim)\|var(--panel2\?)\|var(--text)\b\|var(--border)\b\|var(--amber)\|var(--green)\|var(--red)\|var(--bg-card)' dashboard/index.html
```

Expected output: **empty**.

- [ ] **Step 4: Verify diff persisted to disk**

```bash
git diff --stat HEAD dashboard/index.html
```

Expected: non-zero changes (if output is empty or shows 0 changes, the Edit tool did not persist — do NOT commit and re-apply the replacements).

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html
git commit -m "refactor(tokens): replace legacy token names with semantic tokens in index.html"
```

---

## Task 3: Replace legacy tokens in JS files

**Files:**
- Modify: `dashboard/dashboard.js`
- Modify: `dashboard/page-alerts.js` (73 usages)
- Modify: `dashboard/page-camera-settings.js` (47 usages)
- Modify: `dashboard/page-cameras.js` (46 usages)
- Modify: `dashboard/page-reports.js` (42 usages)
- Modify: `dashboard/page-user-mgmt.js` (35 usages)
- Modify: `dashboard/page-stats.js` (24 usages)
- Modify: `dashboard/page-map-settings.js` (20 usages)
- Modify: `dashboard/page-system.js` (14 usages)
- Modify: `dashboard/page-health.js` (13 usages)
- Modify: `dashboard/page-snapshots.js` (12 usages)
- Modify: `dashboard/page-map.js` (8 usages)
- Modify: `dashboard/page-media.js` (7 usages)
- Modify: `dashboard/page-categories.js` (7 usages)
- Modify: `dashboard/page-face-gallery.js` (4 usages)
- Modify: `dashboard/page-appearance.js` (3 usages)

- [ ] **Step 1: Run sed batch on all JS files**

```bash
sed -i '' \
  -e 's/var(--dim)/var(--text-secondary)/g' \
  -e 's/var(--panel2)/var(--surface-overlay)/g' \
  -e 's/var(--panel)/var(--surface-elevated)/g' \
  -e 's/var(--text)/var(--text-primary)/g' \
  -e 's/var(--border)/var(--border-hairline)/g' \
  -e 's/var(--amber)/var(--warn)/g' \
  -e 's/var(--green)/var(--status-ok)/g' \
  -e 's/var(--red)/var(--status-bad)/g' \
  -e 's/var(--bg)/var(--surface-base)/g' \
  -e 's/var(--bg-card)/var(--surface-overlay)/g' \
  dashboard/dashboard.js dashboard/page-*.js
```

Note: no line-range restriction — JS files have no definition blocks to preserve.

- [ ] **Step 2: Verify — no legacy tokens remain**

```bash
grep -rn 'var(--dim)\|var(--panel2\?)\|var(--text)\b\|var(--border)\b\|var(--amber)\|var(--green)\|var(--red)\|var(--bg)\b\|var(--bg-card)' \
  dashboard/dashboard.js dashboard/page-*.js
```

Expected output: **empty**.

- [ ] **Step 3: Confirm diff looks right**

```bash
git diff --stat HEAD dashboard/dashboard.js dashboard/page-*.js
```

Expected: all 16 files show changes (roughly 305+ total replacements across page-*.js + 20 in dashboard.js).

- [ ] **Step 4: Commit**

```bash
git add dashboard/dashboard.js dashboard/page-*.js
git commit -m "refactor(tokens): replace legacy token names with semantic tokens in JS files"
```

---

## Task 4: Final verification

- [ ] **Step 1: Confirm zero legacy token usages remain (outside :root block)**

```bash
grep -rn \
  'var(--dim)\|var(--amber)\|var(--green)\|var(--red)\|var(--bg-card)' \
  dashboard/index.{html,css} dashboard/*.js
```

Expected output: **empty** (these tokens have no legitimate use outside the definition block).

```bash
grep -rn 'var(--panel2\?)' dashboard/index.{html,css} dashboard/*.js
```

Expected: only the `:root` definition lines in `index.css` (lines 11–12, 21–22).

```bash
grep -rn 'var(--text)\b\|var(--border)\b\|var(--bg)\b' dashboard/index.{html,css} dashboard/*.js
```

Expected: only the `:root` definition lines in `index.css` (lines 10, 13–14, 19).

- [ ] **Step 2: Confirm :root block intact**

```bash
sed -n '4,25p' dashboard/index.css
```

Expected: the `:root {}` block unchanged — legacy names still defined as hex values, semantic aliases still pointing to legacy names.

- [ ] **Step 3: Smoke test in browser**

Open `http://localhost:3000` (or the live dashboard). Verify:
- Visual appearance is identical to before (no color changes)
- Light/dark mode toggle still works
- DevTools → Elements → Computed: confirm `--surface-base`, `--text-secondary`, `--border-hairline`, `--status-ok`, `--status-bad`, `--warn` resolve to the correct hex values

- [ ] **Step 4: Done — report results**

Report the final state:
- Total replacements made (from git diff stats across 3 commits)
- Any unexpected legacy tokens still found (should be zero)
- Browser smoke test result
