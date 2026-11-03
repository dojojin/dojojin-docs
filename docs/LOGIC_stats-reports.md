# LOGIC_stats-reports — Statistics, Reports & Scheduled Delivery

> Extracted from DECISIONS.md. Canonical source for Stats v2, Reports,
> Puppeteer rendering, scheduled report configuration, and i18n decisions.
> LINE delivery behavior lives in `docs/LOGIC_line-notifications.md`.
> Parent index: DECISIONS.md
> Last updated: 2026-06-08 · v1.5.0

---

## Stats v2 Core (#15–#27)

**#15 — All-match category mapping (not first-match)**
An event lands in EVERY category whose rule matches. One event can be in both "People Counting" and "Alerts" simultaneously.

**#16 — Compute category at query time, never store `category_id` on event row**
Edit a mapping → effect is immediate, retroactive over all history within retention.

**#17 — Buckets aligned to `display_timezone`**
Timeline day-boundaries use `display_timezone` setting, not server UTC.

**#18 — Counters excluded from Distribution pie**
Prevents double-count: a `CountAggregation` event that is also in a category would inflate the pie.

**#19 — Always show every category in KPI grid (even count=0)**
Operator needs to see that a category exists and is active, even on quiet days.

**#20 — Friendly comparison strings**
`↑ NEW` / `▼ STOPPED` / `▲ +N events` instead of meaningless `9000%` when baseline is tiny. Replace with friendly string when `prev_count < 5`.

**#21 — Distinct visualisation per kind**
Line per category for Event Overview; per-camera bars only for counter kinds.

**#22 — Activity Heatmap**
Hour × day-of-week matrix with category filter. Amber palette for occupancy heatmap (distinguished from blue Activity Heatmap).

**#23 — Drill-down click**
Chart/pie/bar click → Events page with filter pre-applied (category, camera, rule_name, date range). Every visualisation element that represents a subset of events must be clickable.

Drill-down must preserve the full scope used to build the clicked visualisation,
not just the visible bucket. For Activity Heatmap this means `from`, `to`,
active camera group as `cameras`, selected `category_id`, and the clicked
`dow/hour`. `/api/events` must apply these filters server-side before
pagination so `X-Total-Count` and the first page match the Stats cell.

> STUBBORN_FACT: A heatmap click that sends only `dow/hour` is overbroad when
> Stats is scoped by category or camera group. See GOTCHAS #44 and fix commit
> `c2ed5f7`.

**#24 — Quiet Cameras alert**
Camera online (heartbeat <90s) but no event in last 24h → flagged in Stats page "Top Rules / Quiet Cameras" section. Helps operator spot cameras that are reachable but not detecting — often a calibration or IVA rule issue.

**#25 — Top 10 rule_name leaderboard**
Ranks `rule_name` by event count in the selected date range.

**#26 — CSV export**
KPI / breakdown / timeline / heatmap all exportable. Server-side query, same filters as the live view.

**#27 — Calendar-boundary presets**
Today = midnight of today onward. This Week = Monday onward `(d.getDay()+6) % 7`. This Month = day 1 onward. Rolling comparison is a separate concern.

**#141 — Stats page compact control header + Event Overview focus**
The Stats page top area is a page-scoped control header: camera-group filter, period selector, and compact category badges live together above the main analytics sections. The group editor shortcut is intentionally hidden on Stats because group editing belongs in Settings; Stats should only select/filter groups.

Category badges are not just display counters. They are the focus control for "ภาพรวมเหตุการณ์" / Event Overview: `All` shows every category line, while selecting a built-in or custom category filters the Event Overview chart, legend, subtitle, and timeline CSV export to that category. Other Stats sections remain independently scoped unless explicitly wired later. This keeps focus behavior understandable and prevents a badge click from unexpectedly changing every unrelated panel.

---

## Reports (#28–#32, #85, #92–#94, #98–#99)

**#28 — Reports built on Stats v2 endpoints (DRY)**
No parallel data path. What Stats shows = what PDF contains. Retroactive when mappings change.

**#29 — report types** *(updated 2026-09-06)*
`REPORT_TYPES = ['daily', 'weekly', 'monthly', 'summary', 'health']` (`src/routes/reports.js:20`) —
**5 analytics types plus health**. `summary` was added 2026-09-03 (migration 197, `40d0f8e`);
`health` uses a different renderer — **PNG** via SVG + `sharp`, **PDF** still via Puppeteer for A4 pagination (see #148). The four analytics types
share one renderer. `daily`/`weekly` are rolling windows; `monthly` is a **calendar** month —
see #94.

**#30 → superseded by #93**
Original html2canvas + jsPDF replaced by Puppeteer in mid-2026.

**#31 — Per-bucket trend bar chart uses `animation: false`**
So html2canvas (legacy path) and Puppeteer both capture the static final frame rather than a mid-animation freeze. All Chart.js instances in the report template must set `animation: false`.

**#32 — Brand-aware header/footer**
Auto-pulls customer logo + name + accent color. Footer `© DojoJin Tech` is locked — only product name on the left is editable.

> STUBBORN_FACT: Footer `© DojoJin Tech` is hardcoded in all templates. Decision #38.

**#85 — Executive Summary lives inside `index.html` as `#page-summary` (SPA merge)**
Not a standalone page. CSS scoped under `#page-summary` with `--es-*` custom properties. All DOM ids prefixed `summary*`.

LINE image delivery for scheduled reports is owned by `docs/LOGIC_line-notifications.md` (Decision #91).

**#92 — Single report layout: `dashboard/report-template.js` is the ONLY place that builds report HTML**
Used by both `renderReportPreviewV2` (interactive Reports page) and `report-print.html` (Puppeteer print page). Never add a parallel server-side template.

> STUBBORN_FACT: `report-template.js` is the single template. Adding a parallel server-side template creates the duplication problem this decision was made to prevent.

**#93 — Puppeteer renders BOTH PDF and "full" image from `/report-print.html`**
`report-renderer.js` opens print page with `X-Internal-Token` header, waits for `window.__reportReady`, then either `page.pdf()` or `page.screenshot()`. Old `renderReportHtml` A4 server template was deleted.

*Updated 2026-09-06 — **where** it renders:* Chromium now lives in `src/report-worker.js`, a
separate PM2 process, so a Chrome crash restarts the worker instead of api-server. Operator
downloads reach it over loopback (`POST /render`, `src/helpers/renderViaWorker.js`) with an
in-process fallback and a `REPORT_RENDER_VIA_WORKER=0` kill switch. The browser is **closed after
`REPORT_BROWSER_IDLE_MS` idle** (default 5 min) rather than held open all day; the next render
pays the cold relaunch. Health-report PNG **and PDF** plus the 3 traffic PDF routes still render
in-process — see `docs/REF_api-reference.md` → *Internal endpoints*.

**#94 — `monthly` = the PREVIOUS CALENDAR MONTH** *(changed 2026-09-03 — decision #269, owner request, `213c931`)*
`computeScheduledRange()` (`src/report-renderer.js:51-80`): `monthly` = `[1st of previous month,
1st of current month)`, so the report sent on 1 September covers all of August, matching what the
manual UI produces. `daily` = `[today-1d, today)` and `weekly` = `[today-7d, today)` are unchanged
rolling windows.

> *History — why it used to be rolling:* both weekly and monthly were originally
> `[today-Nd, today)`. Calendar periods broke on young deployments — mid-May with data starting
> May 8 meant the most-recent-completed week predated the events and the report came out nearly
> empty. That reasoning still holds for **weekly**, which is why only monthly moved: a whole
> calendar month is long enough that the young-deployment case stops mattering, and "last month"
> is what a person means by a monthly report.

**#98 — Weekly/monthly schedules need day gate**
`send_day_of_week` (smallint 0=Mon..6=Sun) + `send_days_of_month` (CSV `1,15` or `L` for last-day-of-month). Migration 015. Without this, weekly reports fired 7× daily and burned LINE quota.

**#99 — Report filename uses display_timezone, not UTC**
`new Date(range.from).toLocaleDateString('sv', { timeZone: tz })` — Swedish locale gives YYYY-MM-DD naturally. `slice(0, 10)` of a UTC ISO string gives wrong date for TZ east of UTC.

---

## Puppeteer Performance (#95, #131, #148)

**#95 — Puppeteer browser pool: one Chromium per process, fresh page per render**
`_getBrowser()` — module-level promise, lazily launched. `_withPage(fn)` — newPage → fn → close. Cold: ~1,419ms. Warm: ~150ms (~9× faster). `browser.on('disconnected')` nulls the promise so next call relaunches transparently.

*Updated 2026-09-06:* "one per process" now means **one in `report-worker`**, not one in
api-server. Two things follow from the same `_withPage` serialisation that makes the pool safe:
- the browser is dropped after `REPORT_BROWSER_IDLE_MS` idle (default `300000`,
  `report-renderer.js:224`) — a pool held open all day costs RSS for a job that runs a handful of
  times, so the cold ~1.4 s is paid on the next render instead
- **a manual download queues behind a scheduled report.** A busy worker does not fail fast into
  the in-process fallback; the caller waits out the full 120 s timeout first
  (`src/helpers/renderViaWorker.js`)

> STUBBORN_FACT: Puppeteer `networkidle0` does not wait for post-innerHTML image decoding. Await all `<img>` elements before signalling `__reportReady`. GOTCHAS #22.

**#131 — Puppeteer `protocolTimeout` raised 30s → 120s**
Default 30s insufficient for large full-layout report screenshot on cold browser. Setting is at browser launch time (pool) — restart api-server for change to take effect.

**#148 — Health Report PNG preview uses SVG + `sharp`, not Puppeteer**
*(renumbered 2026-05-27 — was mistakenly logged as a second `#141`, which collides with "Stats compact control header"; #141 stays the Stats decision.)*
2026-05-26 regression: `/api/health/report/preview` reproduced as HTTP 500 after Chromium/CDP stalled on `Runtime.callFunctionOn`; removing the explicit `evaluate()`/`fullPage` height probe still left preview dependent on a stuck browser pool. Health PNG generation now gathers the same `/api/health/*` data and renders an SVG through `sharp`. This applies to Preview / PNG / Health Report LINE image delivery. Health PDF still uses Puppeteer because it needs A4 pagination.

> STUBBORN_FACT: Do not route Health Report PNG preview back through Puppeteer unless there is a concrete rendering feature `sharp` cannot provide and the Chrome timeout path is re-tested. The SVG renderer strips decorative emoji via `report-renderer._svgSafeText()` because local `librsvg/Pango` can abort the Node process when emoji fallback fonts are unavailable. This is the architectural basis of the no-emoji-as-UI rule — Decision #144, GOTCHAS #25a, DESIGN.md §6.

---

## System Health Report (#136–#139)

**#136 — Health Report is a new `report_type` on existing `report_schedules` table**
Migration 022 widens CHECK constraint to include `'health'` + adds `health_sections JSONB`. Reuses scheduler loop, `runScheduledReport()`, `report_history`, history UI, recipient resolution, day-of-week gating. Not a separate table.

LINE send-now and scheduled delivery rules are owned by `docs/LOGIC_line-notifications.md`.

**#137 — Server-side report i18n via per-module label dict, NOT `dashboard/i18n.js`**
Puppeteer-rendered HTML runs server-side; `I18N.t()` doesn't exist there. Pattern: `HR_LABELS = { th: {...}, en: {...} }` at top of `report-renderer.js`. See also: Decision #128 (i18n engine `dashboard/i18n.js`), SKILL.md §8 (Language/i18n), GOTCHAS #42 (th/en parity).

**#138 — Events section dropped from Health Report**
Overlapped with analytics report. Final 4 sections: cameras, alerts, storage, system. "What happened" = analytics report. "Is the system OK" = health report.

**#139 — Health Report "last frame" uses indexed snapshot columns**
2026-05-24 context: `has_snapshot` / `snapshot_filename` existed but were not populated, so the Health Report temporarily had to read `raw_json->>'_snapshot'`. Migration 025 (2026-05-26) backfilled the columns and patched all ingesters. Use `WHERE has_snapshot = TRUE` for filters and `COALESCE(snapshot_filename, raw_json->>'_snapshot')` when reading filenames.

> STUBBORN_FACT: snapshot filters use `events.has_snapshot`; `raw_json._snapshot` remains a legacy metadata fallback. GOTCHAS #43.

---

## Report History (#134 Ph.2)

Every scheduled and manual send is logged to `report_history` table (migration 021). `runScheduledReport()` writes a row on every attempt — success + failed + skipped. Retention: rows 90d + PNG files 30d.

---

## Schedule Fixes (#132)

**#87 — Live "People in Area" = CountAggregation/Counter + 2s median smoothing**
Bosch fires the Count event many times per second with raw flicker. The tracker (`api-server.js`) keeps a `Map<camera_id, Map<rule, entry>>`, 2-second median over recent samples, 30s stale-TTL decay to 0. WS-broadcasts `occupancy_update` only on smoothed-value change. Per-camera rule name discovery is automatic — no schema/config needed for new occupancy rules.

**#88 — Density viz uses Postgres `date_bin()` (PG14+)**
`/api/stats/occupancy/timeline` + `/api/stats/occupancy/heatmap`. Bucket auto-picked from range (1m / 5m / 1h / 1d). Buckets anchored at unix epoch so they align with wall-clock minutes/hours. Aggregates `(raw_json->'Data'->>'Count')::int` AVG + MAX over the bucket. DoW/hour heatmap aligned to `display_timezone`.

Per-rule LINE quiet hours are owned by `docs/LOGIC_line-notifications.md` (Decision #90).

**#133 — Stats page i18n Stage 4 (2026-05-23)**
58 keys added to `dashboard/i18n.js` under namespace `stats.*`. Covers: "การนับในพื้นที่" (Area Count — Live), Density, Heatmap (activity + occupancy), period buttons, chart labels, chart-sub dynamic strings, relative time (now / Ns ago / Nm ago). Key parity verified 0 mismatch. All static markup updated to `data-i18n*` attributes; all dynamic strings use `I18N.t('key')`.

---

## Schedule Fixes (#132)

**#132 — Schedule edit button onclick latent bug — never embed `JSON.stringify` in `onclick='...'`**
If `last_error` contains single quotes, the HTML attribute breaks silently. Fix: `_rsRowMap` (Map<id, schedule>), onclick passes only integer id, function looks up the Map.

> STUBBORN_FACT: Never embed `JSON.stringify(obj)` inside `onclick='...'` single-quoted attribute. GOTCHAS #32.

---

## Report customisation 2026-09-03 → 09-04

One burst of report work, in ship order. Read this before "adding" any of it again.

| Commit | What changed |
|---|---|
| `59e66b7` | Optional **per-day time window** on the report stats endpoints (server side of the UI below) |
| `213c931` | Schedule time window + **`monthly` becomes the previous calendar month** — decision #269, see #94 |
| `40d0f8e` | New **`summary` report type** (migration 197), donut % labels, time-window UI |
| `a09e3bd` | Merge IN/OUT in the share donut; pair the category table with its own donut |
| `ab70ad8` | **Choose which sections appear** in the report |
| `00acb35` | Last-7-days and month-to-date bar charts |
| `91efd2a` | Show each category's share in the category table |
| `2f86ad6` | Split the daily bars **by category** |
| `080d4ce` | Hide analytics-only fields on the `summary` report; real month label |

All of it goes through `dashboard/report-template.js` — decision #92 still holds, there is no
parallel server-side template.

---

## Related files
- `src/report-renderer.js` — Puppeteer orchestrator + `computeScheduledRange()`
- `src/report-worker.js` — the PM2 process that owns Chromium and the scheduler loop
- `src/helpers/renderViaWorker.js` — api-server → worker `POST /render`, with in-process fallback
- `docs/LOGIC_line-notifications.md` — LINE delivery, imgbb, recipient, and quiet-hours behavior
- `dashboard/report-template.js` — ONLY place that builds analytics report HTML
- `dashboard/report-print.html` — Puppeteer print target
- `src/stats-summary-route.js` — Executive Summary aggregator
- `src/alert-engine.js` — quiet hours enforcement (`active_from`/`active_to`)
- `db/db_migration_012_alert_quiet_hours.sql` — quiet hours columns
- `db/db_migration_013_report_schedules.sql` — report_schedules schema
- `db/db_migration_021_*.sql` — report_history
- `db/db_migration_022_*.sql` — health report type
- GOTCHAS #16 (PDF rasterized), #22 (Puppeteer image timing), #24 (quiet hours naming), #25 (browser pool), #34 (Cloudflare JS cache)
