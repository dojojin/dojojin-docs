# EXECUTION SPEC — LPR vehicle_type as a Mapping-Rule dimension

> **For the executor (Sonnet, 2026-07-20):** this is a copy-paste-precise spec.
> Every edit gives an exact `old_string` → `new_string`. Line numbers are hints
> only — **anchor on the quoted text, not the number** (files drift). Read each
> target file region before editing to confirm the anchor still matches, then use
> the Edit tool. Do NOT improvise structure. Preserve copyright headers.
>
> **Goal:** let Event-Category Mapping Rules target LPR vehicle sub-types
> (e.g. รถสามล้อพ่วงข้าง = `threeWheelVehicle`) so the owner can build a custom
> Event-Stats dashboard card/pie/timeline for them. Scope this round = **vehicle_type
> only** (region/brand/color/plate-pattern deferred).
>
> **Model:** opus-tier work (schema + cross-table SQL) — owner is running opus.
> **Deploy:** central-only, **api-server restart required** (Phases 1–2). No edge.
> **Process (WA#4):** after each phase group, run the verify step, report Fact/Opinion,
> **STOP for explicit owner confirm before every commit.** Two commits total:
> (A) Phase 1+2 schema+backend, (B) Phase 3+4 frontend. No `Co-Authored-By` trailer.

---

## Why this design (do not second-guess)

The LPR page already holds fine-grained `license_plates.vehicle_type` but has **no**
Customize-Dashboard capability — that lives only in the Categories/Stats engine,
which today matches only coarse `events.object_class` (Person/Vehicle/Motorcycle)
and never joins `license_plates`. Owner explicitly chose to extend that one engine
(not build a parallel LPR-page system). Verified facts:

- `license_plates` is **1 row per LPR event** (`src/lpr-core.js:417`) and
  `license_plates.camera_id == events.camera_id == cameras.id`. So EXISTS/JOIN can't
  fan-out, and site-scoping via `lp.camera_id` is valid.
- `vehicle_type` holds Hikvision vocab for BOTH vendors (`threeWheelVehicle`,
  `twoWheelVehicle`, `SUVMPV`, `van`, `pickupTruck`, `truck`, `vehicle`, …).
- Thai labels: `_lprVType(code)` — top-level global in `dashboard/page-lpr.js:154`
  (function declaration, available at runtime). **Always** render vehicle_type
  through it; never show raw `threeWheelVehicle`.
- Latest migration = 087 → new = **088**.

---

## Phase 1 — Schema

### 1a. New migration file
Create `db/db_migration_088_category_rule_vehicle_type.sql`:
```sql
-- ============================================================
-- Vigil Platform — migration 088: event_category_rules.vehicle_type
-- Lets a Mapping Rule target an LPR vehicle sub-type (license_plates.vehicle_type,
-- e.g. threeWheelVehicle) in addition to the coarse events.object_class. NULL =
-- wildcard (same convention as the rule's other columns). No backfill — existing
-- rules stay wildcard. See docs/superpowers/plans/2026-07-19-lpr-vehicle-type-category-rules.md
-- ============================================================
ALTER TABLE event_category_rules ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(30);
```

### 1b. init.sql (fresh installs)
In `db/init.sql`, find the `event_category_rules` CREATE TABLE (search
`CREATE TABLE IF NOT EXISTS event_category_rules`). Add a `vehicle_type VARCHAR(30),`
line right after the `object_class` column definition, matching surrounding style.
If the table has an idempotent `ADD COLUMN` guard block elsewhere, leave it; the
migration is what reaches existing volumes.

**Verify:** after api-server restart, `\d event_category_rules` shows
`vehicle_type | character varying(30)`; existing rows all NULL.

---

## Phase 2 — Backend (opus). 3 files.

### 2a. `src/routes/stats.js` — add the vehicle_type match to **all 4** blocks

The condition to insert (identical everywhere, indentation adapts per block):
```
AND (r.vehicle_type IS NULL OR EXISTS (SELECT 1 FROM license_plates lp WHERE lp.event_id = e.id AND lp.vehicle_type = r.vehicle_type))
```

**Block A — `/api/stats/categories` (TWO identical subqueries, 19-space indent).**
This exact 1-line anchor appears **twice** (count + prev_count subqueries) with
identical text — use Edit with `replace_all: true`.

old_string (one line, 19 leading spaces):
```
                   AND (r.object_class IS NULL OR r.object_class = e.object_class)
                   AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
```
new_string:
```
                   AND (r.object_class IS NULL OR r.object_class = e.object_class)
                   AND (r.vehicle_type IS NULL OR EXISTS (SELECT 1 FROM license_plates lp WHERE lp.event_id = e.id AND lp.vehicle_type = r.vehicle_type))
                   AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
```
> Both subqueries use `COUNT(DISTINCT e.id)` already — DISTINCT stays the safety net.

**Block B — `/api/stats/timeline-v2` (single-category, 20-space indent).**
old_string:
```
                    AND (r.object_class IS NULL OR r.object_class = e.object_class)
                    AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
```
new_string:
```
                    AND (r.object_class IS NULL OR r.object_class = e.object_class)
                    AND (r.vehicle_type IS NULL OR EXISTS (SELECT 1 FROM license_plates lp WHERE lp.event_id = e.id AND lp.vehicle_type = r.vehicle_type))
                    AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
```

**Block C — `/api/stats/timeline-by-category` (multi-category Event-Overview chart, 11-space indent).**
old_string:
```
           AND (r.object_class IS NULL OR r.object_class = e.object_class)
           AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
```
new_string:
```
           AND (r.object_class IS NULL OR r.object_class = e.object_class)
           AND (r.vehicle_type IS NULL OR EXISTS (SELECT 1 FROM license_plates lp WHERE lp.event_id = e.id AND lp.vehicle_type = r.vehicle_type))
           AND (r.match_state  IS NULL OR r.match_state  = e.event_state OR e.event_type = 'anprAlarm')
```

> After editing, grep `vehicle_type` in stats.js → must appear **4** times (once per block).
> Do NOT touch `/api/stats/per-camera-counts` — deferred.

### 2b. `src/routes/events.js` — add a `vehicle_types` facet

In `/api/events/facets`, the existing `Promise.all([...])` has 3 queries (rules,
types, classes). Do NOT try to reuse the `where` string for LPR (it references
`event_type NOT LIKE ...` which license_plates lacks). Instead build a **separate**
predicate on `license_plates` alone (its `camera_id` == the event's camera).

Right **before** the `const [rules, types, classes] = await Promise.all([` line, add:
```js
      // LPR vehicle_type facet — distinct sub-types seen in license_plates,
      // camera/site-scoped the same way (lp.camera_id == events.camera_id == cameras.id).
      const vparams = [];
      let vwhere = ` WHERE lp.vehicle_type IS NOT NULL AND lp.vehicle_type <> ''`;
      if (req.query.camera_id) { vparams.push(req.query.camera_id); vwhere += ` AND lp.camera_id = $${vparams.length}`; }
      const vsw = siteWhere(req.user?.allowedSites ?? null, 'lp.camera_id', vparams.length + 1);
      if (vsw.sql) { vwhere += ` ${vsw.sql}`; vparams.push(...vsw.args); }
```
Change the destructure + `Promise.all` to include a 4th query:
```js
      const [rules, types, classes, vtypes] = await Promise.all([
```
…and add as the 4th array element (after the `object_class` query, keep a trailing comma on it):
```js
        pool.query(`SELECT DISTINCT lp.vehicle_type AS v FROM license_plates lp${vwhere}
                    ORDER BY v LIMIT 100`, vparams),
```
Add to the `res.json({...})`:
```js
        vehicle_types:  vtypes.rows.map(r => r.v),     // LPR sub-type facet (2026-07-20)
```
> Confirm `siteWhere` is already imported/in-scope in events.js (it is — used by the
> existing facet query). If not, import from `../auth`.

### 2c. `src/routes/categories.js` — accept vehicle_type on POST

In `POST /api/categories/:id/rules`:
- Destructure: change
  `const { camera_id, rule_name, event_type, object_class, priority } = body;`
  → add `vehicle_type`:
  `const { camera_id, rule_name, event_type, object_class, vehicle_type, priority } = body;`
- INSERT column list: add `vehicle_type` after `object_class`. Current:
  ```
  (category_id, camera_id, rule_name, event_type, object_class, match_state, priority)
  VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0))
  ```
  →
  ```
  (category_id, camera_id, rule_name, event_type, object_class, vehicle_type, match_state, priority)
  VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 0))
  ```
- Values array: insert `blank(vehicle_type)` between `blank(object_class)` and
  `matchState`, and bump `priority` to $8:
  ```
  [id, blank(camera_id), blank(rule_name), blank(event_type), blank(object_class),
   blank(vehicle_type), matchState, priority]
  ```
> `blank()` already maps '' → null. GET `/rules` uses `SELECT *` so it returns the
> new column automatically — no GET change needed.

**Verify Phase 2 (before any frontend):**
1. Restart api-server. `curl -s "$API/api/events/facets" | jq .vehicle_types` →
   non-empty, includes `"threeWheelVehicle"`.
2. In a **rolled-back** tx, insert a rule
   `(category_id=<a real cat>, vehicle_type='threeWheelVehicle')` then compute the
   category count via the `/api/stats/categories` SQL and assert it equals:
   `SELECT COUNT(DISTINCT lp.event_id) FROM license_plates lp JOIN events e ON e.id=lp.event_id WHERE lp.vehicle_type='threeWheelVehicle' AND e.event_time >= <from> AND e.event_time < <to>` (same camera/site scope). ROLLBACK.
3. `EXPLAIN` the categories count subquery with a vehicle_type rule present → the
   EXISTS must use `idx_plates_event` (on `license_plates.event_id`); no seq-scan on
   license_plates. If parallel-worker memory balloons (see GOTCHAS / misty-wondering-scott
   `/dev/shm` note), wrap the endpoint's queries with `SET LOCAL max_parallel_workers_per_gather = 0`.

---

## Phase 3 — Frontend: rule-editor input. 3 files, frontend-only (no restart).

### 3a. `dashboard/index.html` — vehicle_type select as its own row
In `#categoryRulesModal`, the add-box ends with the 7-col input grid then two
`</div>`. Anchor:
```
          <button class="btn btn-primary cat-rule-add" id="addCategoryRuleBtn" style="font-size:11px;padding:6px 10px">+ Add</button>
        </div>
      </div>
```
Replace with (insert the vehicle row between the grid-close and box-close):
```
          <button class="btn btn-primary cat-rule-add" id="addCategoryRuleBtn" style="font-size:11px;padding:6px 10px">+ Add</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
          <label style="font-size:11px;color:var(--text-secondary)" data-i18n="cat.fldVehicleType">ประเภทรถ (LPR)</label>
          <select id="crVehicleType" class="form-input" style="width:auto;font-size:11px">
            <option value="">* (any)</option>
          </select>
          <span style="font-size:10px;color:var(--text-secondary)" data-i18n="cat.vtypeHint">ใช้กับกล้อง LPR — จับประเภทรถละเอียด เช่น รถสามล้อ</span>
        </div>
      </div>
```

### 3b. `dashboard/i18n.js` — keys in BOTH th and en blocks (gotcha #42)
Add next to the other `cat.*` rule keys (near `cat.filterCamType` added 2026-07-19):
- th: `'cat.fldVehicleType':'ประเภทรถ (LPR)','cat.vtypeHint':'ใช้กับกล้อง LPR — จับประเภทรถละเอียด เช่น รถสามล้อ',`
- en: `'cat.fldVehicleType':'Vehicle type (LPR)','cat.vtypeHint':'For LPR cameras — fine vehicle sub-type e.g. tricycle',`

### 3c. `dashboard/page-categories.js`
**(i) Reset in `openCategoryRules()`** — after `document.getElementById('crObjClass').value = '';` add:
```js
  { const el = document.getElementById('crVehicleType'); if (el) el.value = ''; }
```

**(ii) `loadFacets()`** — after `_fillObjClassOptions(f.object_classes);` add:
```js
    _fillVehicleTypeOptions(f.vehicle_types);
```
Then add this helper right after the `_fillObjClassOptions` function:
```js
// Vehicle-type select — LPR sub-types seen in license_plates (facet). Labels go
// through _lprVType() (page-lpr.js) so raw codes like 'threeWheelVehicle' never
// show; value stays the raw code (what the rule matcher compares).
function _fillVehicleTypeOptions(vtypes) {
  const el = document.getElementById('crVehicleType');
  if (!el || !Array.isArray(vtypes)) return;
  const cur = el.value;
  const label = c => (typeof _lprVType === 'function' ? _lprVType(c) : c) || c;
  el.innerHTML = `<option value="">* (any)</option>` +
    vtypes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(label(c))}</option>`).join('');
  if (vtypes.includes(cur)) el.value = cur;
}
```

**(iii) `addCategoryRule()` base object** — add vehicle_type:
```js
  const base = {
    rule_name:    document.getElementById('crRule').value.trim(),
    event_type:   document.getElementById('crEventType').value.trim(),
    object_class: document.getElementById('crObjClass').value,
    vehicle_type: document.getElementById('crVehicleType').value,
    match_state:  document.getElementById('crState').value,
    priority:     parseInt(document.getElementById('crPri').value, 10) || 0,
  };
```

**Verify Phase 3:** open a category's Rules modal → the "ประเภทรถ (LPR)" select is
populated with Thai labels (e.g. "รถสามล้อ"); picking it + cameras + Add posts
`vehicle_type=threeWheelVehicle` (Network tab); reopening shows the rules.

---

## Phase 4 — Frontend: grouping-signature fix + list display. `page-categories.js`, frontend-only.

> **CRITICAL regression guard.** The grouping shipped 2026-07-19 (commit 1709e33)
> keys on `[rule_name, event_type, object_class, match_state, priority]`. Without
> vehicle_type in the key, two rules differing only by vehicle_type merge into one
> collapsed group and **delete-group deletes both**. Fix the key AND show the value.

**(i) Grouping key** — in `loadCategoryRules()`:
old:
```js
      const key = [r.rule_name, r.event_type, r.object_class, r.match_state, r.priority]
        .map(v => v == null ? ' ' : v).join('');
```
new:
```js
      const key = [r.rule_name, r.event_type, r.object_class, r.vehicle_type, r.match_state, r.priority]
        .map(v => v == null ? ' ' : v).join('');
```
> (Also switched the join separator to `` to avoid value-boundary collisions
> like `'Car'+''` vs `''+'Car'` — harmless improvement while we're here.)

**(ii) Display** — show the vehicle_type Thai label appended in the Object Class
cell (no new table column). Right after the `const w = v => ...` line, add:
```js
    const objCell = s => {
      const base = w(s.object_class);
      if (!s.vehicle_type) return base;
      const vl = (typeof _lprVType === 'function' ? _lprVType(s.vehicle_type) : s.vehicle_type) || s.vehicle_type;
      return `${base} · <span style="color:var(--accent)">${escapeHtml(vl)}</span>`;
    };
```
Then replace BOTH occurrences (single-row branch + group-header branch — identical
text) of:
```
          <div class="cat-rule-list-cell">${w(s.object_class)}</div>
```
with:
```
          <div class="cat-rule-list-cell">${objCell(s)}</div>
```
(Use Edit `replace_all: true`; there are exactly two.)

**Verify Phase 4:** a category with a `threeWheelVehicle` rule shows
"Motorcycle · รถสามล้อ" (or "* · รถสามล้อ") in the Object Class cell; two rules
differing only by vehicle_type render as **separate** groups; delete-group removes
only its own set.

---

## Phase 5 — End-to-end verify (reproduce the owner's use case) + AUDIT

1. Create a real EVENT category "รถสามล้อพ่วงข้าง" → add one rule:
   object_class = * (any), **vehicle_type = รถสามล้อ**, cameras = the LPR fleet.
2. Stats page (สถิติเหตุการณ์): the new category's **KPI card count**, its **pie
   slice**, and its **Event-Overview timeline line** must each reflect ONLY
   `threeWheelVehicle` LPR events. Cross-check the card count vs a direct SQL count
   for the same range/site.
3. **No-regression:** an existing plain rule (e.g. object_class=Motorcycle, no
   vehicle_type) still counts everything exactly as before.
4. Responsive ≤768px: the new modal row stacks cleanly (WA#2 — check unprompted).
5. Advisor AUDIT of the diff + SQL correctness (DISTINCT/EXISTS, index use) → then
   STOP and report Fact/Opinion for the owner's commit decision.

---

## Deploy / commit boundaries

| Phase | Layer | Deploy |
|---|---|---|
| 1 + 2 | migration + backend | **api-server restart** (central; migration runs on boot). Restart central BEFORE nothing-on-edge. |
| 3 + 4 | dashboard JS/HTML | cache-bust only, no restart |
| 5 | verify | — |

**Commit A** (after Phase 2 verify + confirm): migration 088 + init.sql +
stats.js + events.js + categories.js.
**Commit B** (after Phase 4 verify + confirm): index.html + i18n.js +
page-categories.js.
STOP for explicit owner confirm before EACH commit (WA#4). No `Co-Authored-By`.

## Pre-flight checklist for the executor
- [ ] `git status` clean / on a branch; know current HEAD.
- [ ] Re-read each anchor region before editing (line numbers may have drifted).
- [ ] `node --check` every edited `.js`; SQL: run migration on a scratch DB or
      trust the idempotent `ADD COLUMN IF NOT EXISTS`.
- [ ] grep `vehicle_type` in stats.js == 4 matches after 2a.
- [ ] Never restart PM2 on central via SSH/shell (GOTCHAS #84) — ask the owner to
      restart api-server, or they do the deploy.
- [ ] All new UI strings in BOTH i18n blocks (gotcha #42).

## Deferred (Phase 6, only if owner asks)
- `/api/stats/per-camera-counts` vehicle_type support ("จำนวนรถต่อกล้อง" bar).
- Other LPR dims as rule fields: region / brand / plate_color / plate_type.
