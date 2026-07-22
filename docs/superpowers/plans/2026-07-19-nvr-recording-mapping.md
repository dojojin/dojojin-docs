# NVR Recording Mapping — Config UI (Camera Settings) + edge-driven fan-out

> Plan · 2026-07-19 · owner: Prakasit Rochanavipart (Dojo-mAn)
> Status: **planned** (design approved, implementation pending)

## Problem Statement

Some Dahua LPR cameras are added to Vigil with their own IP (standalone), but
their footage is actually recorded on a separate physical NVR, not on the
camera itself (confirmed live 2026-07-19: `storageDevice.cgi` 400s on a
standalone LPR camera, 200s on its NVR). The pilot (commit `7d8590c`) proved
the check works end-to-end but hardcodes the 16-camera↔4-NVR mapping in
`edge-config-agent.js` (`DAHUA_NVR_PILOT`) — invisible and unchangeable
without a code deploy. The owner wants to *see* which NVR backs a camera in
Camera Settings, and *edit* it there (owner confirmed the mapping itself
rarely changes — "ไม่เปลี่ยนหรอก นานๆ ที" — so editability is for the rare
re-cabling event, not routine churn).

## Decisions locked with owner (2026-07-19)

1. **Full scope: B + C, not just A** — owner wants the field both visible
   *and* editable, and wants it to actually drive the edge probe (not a
   cosmetic label). Do not ship an editable field that silently does nothing
   (Phase B) without also wiring the edge to read it (Phase C) — land them
   close together.
2. **Free-text input, not a dropdown/MultiPicker** — 4 NVRs, 16 cameras. Not
   worth a picker component at this scale (ponytail: add a picker if the
   fleet grows enough that typos become a real risk).
3. **Rarely changes** — soft-validate (warn, don't hard-block) rather than
   over-engineer a strict foreign-key-style constraint.

## Design Principle

One column, one meaning: `recording_nvr_id` on `cameras` = "the camera_id
whose `ip_address`/credentials should be used to probe storage for this
camera." **Every member of an NVR group — including the NVR's own two
channel rows — points at the same canonical reference row** (chosen as each
NVR's `-ch0` entry). This makes the edge scan uniform: group all cameras by
`recording_nvr_id`, probe `_cameraMap[refId]` once per distinct value, fan
the result out to every camera in that group. No special-casing "is this
camera itself an NVR channel" — it's just another group member.

Example seed for NVR-01 (all 6 rows get `recording_nvr_id = 'HDY-NVR-01-ch0'`):
`HDY-NVR-01-ch0` (self), `HDY-NVR-01-ch1`, `hdy-anpr1`, `hdy-anpr-lotus2`,
`hdy-motor-lotus1`, `hdy-motor-lotus2`.

## Phase A — visible (DB + read-only display)

**Migration** `db/db_migration_087_recording_nvr_mapping.sql`:
```sql
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS recording_nvr_id VARCHAR(100);
-- Seed the 16 known mappings (idempotent — safe to re-run)
UPDATE cameras SET recording_nvr_id = 'HDY-NVR-01-ch0'
  WHERE id IN ('HDY-NVR-01-ch0','HDY-NVR-01-ch1','hdy-anpr1','hdy-anpr-lotus2','hdy-motor-lotus1','hdy-motor-lotus2')
  AND recording_nvr_id IS NULL;
-- ...repeat for NVR-02/03/04 (172.17.22.23/.36/.49 groups, per the pilot's DAHUA_NVR_PILOT map)
```
Without the seed, the column is NULL for all 16 rows and the feature looks
broken on first load — do not skip this.

**Backend** `src/routes/cameras.js` GET /api/cameras (~line 341/347, same
spot `model`/`firmware` were added): add `recording_nvr_id` to the SELECT and
response object.

**Frontend** `dashboard/page-camera-settings.js`: mirror the `model`/`firmware`
display pattern (line ~537 card, ~1254 edit-form init) — show a small label
under the vendor badge when `c.recording_nvr_id` is set, e.g. "→ NVR:
HDY-NVR-01". `dashboard/i18n.js`: new key `cs.fldRecordingNvr` (th/en).

## Phase B — editable

**Backend** `POST /api/cameras` (src/routes/cameras.js ~line 443, same
dual-write pattern as `capture_categories`): accept `recording_nvr_id`,
write to both the DB column and the camera's entry in `cameras-config.json`
(the edge needs it from the JSON, same as other edge-consumed fields).
**Soft validation**: if the typed value doesn't match any existing
`camera_id`, save it anyway but return a warning in the response (surfaced
as a non-blocking toast) — a typo should be visible, not silently swallowed
and not hard-blocked either, since the owner may be staging cabling changes
before the referenced camera exists.

**Frontend**: add a text `form-group` (`frmCamRecordingNvr`) to the edit form
in `dashboard/index.html` next to the model/firmware group, editable (unlike
those two, which stay disabled/read-only).

## Phase C — wired (edge reads the field, hardcode retired)

**Edge** `src/edge-config-agent.js`: replace the hardcoded `DAHUA_NVR_PILOT`
object with a dynamic scan of `_cameraMap`:
```js
function buildNvrPilotGroups() {
  const groups = {};
  for (const [id, cam] of Object.entries(_cameraMap)) {
    if (!cam.recording_nvr_id) continue;
    (groups[cam.recording_nvr_id] ||= []).push(id);
  }
  return groups;
}
```
called fresh each `pollDahuaNvrStorageOnce()` tick (so config edits take
effect on the next hourly cycle, no edge restart needed) instead of the
static `DAHUA_NVR_PILOT` constant. Requires `recording_nvr_id` to reach
`cameras-config.json` (Phase B) and `decryptCamCreds`/config-apply to pass
the field through untouched (it already passes through unknown fields
verbatim, per the existing `capture_categories` precedent — verify this
assumption live before deleting the hardcode).

**Regression oracle**: before deleting `DAHUA_NVR_PILOT`, re-run the exact
DB check used to verify the pilot (2026-07-18/19) — all 24 camera_ids must
still land `sd_status='ok'` with a fresh `sd_last_check_at` after the swap.
This is the concrete pass/fail gate for "the refactor didn't silently drop
a camera or a group."

## Traps to watch during implementation

1. **Dual source of truth between B and C.** If B ships before C, editing
   the field does *nothing* (edge still reads the hardcode) — either ship
   B+C in the same deploy window, or clearly label the field "not yet
   active" in the UI until C lands.
2. **Self-reference for NVR channel rows** — `HDY-NVR-0X-ch0` must have
   `recording_nvr_id` pointing at itself, not left NULL, or those 8 rows
   silently drop out of Phase C's dynamic scan (Phase A's hardcoded-pilot
   parity check will catch this if the seed migration is written correctly).
3. **Deploy order** (per the pattern established in commits `26aadc4`,
   `7d8590c`): central (schema + API) before edge (Phase C code) — an edge
   with `recording_nvr_id`-aware code deployed before the API/config
   propagates the field would just see nothing to group (safe no-op, not
   dangerous, but confirm the order anyway for consistency).

## Rollout order

A → B → C, each independently committable/shippable per the established
PLAN→EXECUTE→AUDIT→STOP→COMMIT cycle. A alone is low-risk and could ship on
its own if priorities shift; B should not ship without C close behind it.
