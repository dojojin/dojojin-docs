# Per-Site Event Categories + Site-Scoped Stats Dashboard — Plan (for Sonnet)

> Status: **PLANNED 2026-07-02**. Extends `2026-07-02-site-rbac.md`. Goal: the Stats page
> (สถิติเหตุการณ์) + Event-Category management (จัดการหมวดหมู่ Event) become **per-site** —
> each site defines its own categories; a site's dashboard shows only that site's categories
> and only that site's camera data; "ALL" (multi-site users only) shows every allowed site's
> categories together. Same dashboard UI everywhere; only the category set differs.
>
> **DEPENDENCY (hard):** this consumes the site-RBAC **P1 resolver** (`req.user.allowedSites`)
> and **`siteWhere()` helper**. **P1 must land first.** Do NOT invent a second isolation path.

## Owner requirements (verbatim intent)
1. Each site has its own dashboard, separated on this Stats page.
2. Category management depends on site (different cameras/events per site; sites cannot see each other's camera data).
3. Selecting "ALL" shows the categories combined — **only** for a viewer allocated to all sites, auditor, or admin.
4. All sites use the same dashboard; only the event categories differ.

---

## 🔴 CRITICAL design invariant (isolation) — read first

There are **TWO independent mechanisms; do NOT conflate them**:

| Mechanism | Job | Where |
|---|---|---|
| `event_categories.site_id` | **which category CARDS to display** (incl. empty categories) | `WHERE c.site_id = <active>` on the category list |
| **event→camera→site constraint** | **DATA ISOLATION** (the security boundary) | `AND e.camera_id IN (SELECT id FROM cameras WHERE site_id = ANY(<allowed>))` on EVERY count/timeline subquery |

**Why both:** category rules match with `(r.camera_id IS NULL OR r.camera_id = e.camera_id)`. A
**NULL `camera_id` rule is a cross-site wildcard** (built-ins like People Counting match by
`object_class` across ALL cameras). If you scope only by `c.site_id`, a per-site "People
Counting" with a NULL-camera rule counts **every site's events** → the exact leak requirement #2
forbids. **The camera-in-site constraint is what enforces isolation — it must be on every event
subquery, always.** `site_id` on the category only picks which cards show.

**Verification (put in the test):** create a category on `vss` whose rule has `camera_id IS NULL`
(object_class match); confirm its count on the vss dashboard **excludes** `main`'s events.

---

## DB model (SC1)

Migration `db_migration_0NN_event_categories_site.sql` (idempotent):
```sql
ALTER TABLE event_categories ADD COLUMN IF NOT EXISTS site_id INT REFERENCES sites(id);
-- name was globally unique; make it per-site
ALTER TABLE event_categories DROP CONSTRAINT IF EXISTS event_categories_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_categories_site_name ON event_categories(site_id, name);
CREATE INDEX IF NOT EXISTS idx_event_categories_site ON event_categories(site_id, sort_order, id);
-- D4 backfill: assign ALL existing categories to Central (main). Do NOT auto-guess from rules.
UPDATE event_categories SET site_id = (SELECT id FROM sites WHERE code='main')
  WHERE site_id IS NULL;
```
- `event_category_rules` — **no schema change** (already carries `camera_id`). But add validation
  (SC2): a rule's `camera_id`, if set, must belong to the category's `site_id`.
- Built-ins (People/Vehicle Counting, `is_builtin=true`): after backfill they live on `main`.
  Admin clones/creates per site via the UI (SC5). (Do not auto-clone to every site.)

## Decisions to confirm (add to site-RBAC D-list)
- **D4 — backfill target:** all existing categories → `main`, admin reassigns/clones per site.
  (Safe/reversible; do NOT derive site from rule-cameras — breaks on NULL-camera + empty categories.)
- **D5 — ALL aggregation:** ALL = **union of cards, each labelled with its site** (two sites'
  custom categories are different metrics — never sum). Built-in *kinds* (people/vehicle counter)
  MAY merge by kind, but keep explicit + still site-labelled. Default: pure union, no merging.

---

## Phases (each: files + how-to)

### SC0 — Prereq: site-RBAC **P1** landed
`req.user.allowedSites` (Set; admin/auditor = ALL sentinel) + `siteWhere(req, camCol)` returning
`{ sql, args }` for `camCol IN (SELECT id FROM cameras WHERE site_id = ANY($n))`. Everything below uses these.

### SC1 — DB migration (above). Backend seed check on boot (migrate.js picks it up).

### SC2 — `src/routes/categories.js` (management, admin-only)
- All queries gain a **site dimension**. Read the active site from `?site_id=` (admin picks) or,
  for a scoped user, from `req.user.allowedSites` (their single site).
- `GET /api/categories?site_id=X` → `WHERE c.site_id = $site` (validate X ∈ allowedSites or admin).
- `POST/PUT/DELETE` → set/enforce `site_id` = the active site; keep admin gating (already via
  `requireAdminForWrites('/api/categories')`).
- **Rule validation:** when a rule sets `camera_id`, verify that camera's `site_id` = the category's site.
- `event_categories.name` now unique per-site → the create path no longer errors on cross-site dup names.

### SC3 — `src/routes/stats.js` (the isolation-critical phase)
Every category-driven query (lines ~497–669: `/api/stats/categories`, `timeline-by-category`,
`breakdown-v2`, etc.) changes in **two** places:
1. `FROM event_categories c` → add `WHERE c.site_id = $activeSite` (single) **or**
   `c.site_id = ANY($allowedSites)` (ALL view). ← controls which cards.
2. Each inner `FROM events e JOIN event_category_rules r …` subquery → **append the
   `siteWhere()` camera constraint** `AND e.camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($allowed))`.
   ← enforces isolation (the BLOCKER above). This is IN ADDITION to the existing `${camFilter}`
   (vendor-chip filter), not a replacement.
- Resolve `activeSite`: `?site_id=` param if present **and** ∈ allowedSites; else if user is
  single-site → their site; else (multi-site, no param) → ALL (`ANY(allowedSites)`).
- The other ~20 stats endpoints (non-category) get the same `siteWhere()` from site-RBAC P2 —
  coordinate so a query isn't scoped twice differently.

### SC4 — `dashboard/page-stats.js` (dashboard UI)
- Load path today: `loadStats()` (line 84) builds `camParam` from `getActiveGroupCameraIds()`
  (the vendor chips = camera groups) → fetches `/api/stats/categories?…&cameras=…` →
  `renderCategoryKPI()` (line 1136) + `renderCategoryPie` + timeline.
- Add a **SITE selector** as the OUTER scope (above/left of the vendor chips):
  - Single-site viewer → **locked** to their site (no selector, or a static label).
  - Multi-site (all-sites viewer / auditor / admin) → dropdown of their sites **+ "ทั้งหมด"** (ALL).
  - Selecting a site → set `_statsSite`, pass `&site_id=X` (or omit for ALL) on every fetch, and
    reload. Vendor chips + camera pool become **site-relative** (only that site's cameras/groups).
- `renderCategoryKPI(cats)` unchanged in shape — it just receives the active site's categories.
  In **ALL view**, cards come pre-unioned from the backend, each carrying its `site_code`; render
  a small site tag on each card (D5).

### SC5 — `dashboard/page-categories.js` (management UI, admin)
- Add the same **site selector** at top; the list + add/edit operate on the selected site.
- "＋ เพิ่มหมวดหมู่" and Edit/Rules write to the active site. Rules camera-picker shows **only that
  site's cameras** (prevents cross-site rule → matches SC2 validation).

### SC6 — RBAC integration + tests
- Viewer sees only their site's dashboard + categories (rides site-RBAC P2 read-scope).
- Category **management** stays admin (config, already gated) — but now per-site.
- **Tests:** (a) the leak test above; (b) single-site viewer cannot pass `?site_id=<other>` (403 or
  ignored); (c) ALL view for admin unions all sites, each card site-labelled; (d) empty category on
  a site still shows a 0 card.

---

## Handoff notes for Sonnet
- **Do SC0 (site-RBAC P1) or confirm it's merged before SC3.** SC3 is where a mistake = a silent
  cross-site data leak — treat the camera-in-site constraint as non-negotiable on every subquery.
- Follow existing patterns: raw SQL (no ORM), idempotent migration, i18n th+en for any new string,
  token-based colors, ≤768px check. Config writes stay admin (`requireAdminForWrites`).
- After SC3, run the verification query manually against real data (main+vss) before wiring UI.
- Sequence: SC1 → SC2 → SC3 (+verify) → SC4 → SC5 → SC6. Commit per phase; STOP for owner confirm
  before each commit (WA#4).
- Related: `2026-07-02-site-rbac.md` (P1/P2 this depends on), `project_multisite_camera_sites`.
