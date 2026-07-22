# Bulk Camera Import via CSV (with edge-site routing)

> Plan · 2026-07-17 · owner: Prakasit Rochanavipart (Dojo-mAn)
> Status: **planned** (design approved, implementation pending)

## Problem Statement

Adding cameras one-by-one through the single-camera form does not scale when
onboarding many cameras at once (e.g. a new site rollout). The owner needs to
download a CSV template, fill in camera details offline, and upload it to
batch-create cameras — including routing a batch to a specific edge site
(e.g. "add all these cameras to หาดใหญ่/hdy"). Imported cameras must come
**online immediately** (no extra enable step).

## Decisions locked with owner (2026-07-17)

1. **Passwords in CSV = plaintext** — same trust model as the existing
   single-create and `bulk-create-channels` paths (stored plaintext in
   `cameras-config.json`, encrypted only on the way to the edge by
   `publishSiteConfig` → `encryptCamCreds`). UI warns the user the CSV holds
   credentials.
2. **Cameras online immediately** — insert with `enabled = TRUE`; the config
   push makes the edge/ingester pick them up and start polling right away.
3. **Partial success** — validate per row, skip bad rows, never fail the whole
   file. Response reports `created[]` + `skipped[{row, camera_id, reason}]`.

## Design Principle

CSV import is a **generalization of `bulk-create-channels`** (cameras.js:1101):
same backbone — `loadCameraConfig` → dedup → per-row `INSERT` + push to
`config.cameras` → `saveCameraConfig` → `publishSiteConfig(siteId, …)` per
affected site. The only new parts are: (a) each row is a full standalone camera
(own vendor/IP/creds/site/role) rather than N channels sharing one device, and
(b) the `site` column must resolve (by code **or** name) to a `site_id`.

**Parse the CSV in the browser**, POST parsed rows as JSON — no server-side
multipart/multer, and the preview/validation is instant. The template is
generated client-side (no download endpoint needed).

## Reuse (no new code)

| Piece | Role |
|---|---|
| `bulk-create-channels` (cameras.js:1101) | backbone pattern to copy |
| `publishSiteConfig(siteId, cams, pool)` (helpers/publishSiteConfig.js) | **edge routing** — filters a site's cams, encrypts creds, publishes retained `projects/{code}/_config/cameras`; edge pulls on receipt/reconnect |
| `saveCameraConfig` / `loadCameraConfig` | config file I/O |
| `_sanitizeCameraId`, `VALID_VENDORS` (`bosch/hikvision/dahua/onvif`), `_CAP_CATS` (`face/anpr/vehicle/nonmotor/person/rule`) | validation |
| `sites` table | code/name → site_id (main·bma·phuket·vss·hdy·vittavat) |

## CSV Template Columns

Required: `camera_id`, `vendor`, `ip_address`, `site`.

| column | req | example | notes |
|---|---|---|---|
| `camera_id` | ✓ | hdy-cam-05 | unique; run through `_sanitizeCameraId` |
| `vendor` | ✓ | dahua | one of VALID_VENDORS |
| `ip_address` | ✓ | 172.17.22.30 | IPv4 shape check |
| `site` | ✓ | hdy | site **code or name** ("หาดใหญ่" ok) |
| `camera_name` | | LOTUS Zone A | default = camera_id |
| `cam_role` | | lpr | standard / face / lpr (default standard) |
| `username` | | admin | |
| `password` | | secret | plaintext; encrypted on edge push |
| `http_port` | | 80 | default 80 |
| `capture_categories` | | face;person | `;`-separated, filtered against `_CAP_CATS` |
| `location` | | ด่าน LOTUS ใน | |
| `latitude` / `longitude` | | 7.01 / 100.47 | |
| `nvr_channel` | | 0 | set only for NVR sub-channels |
| `notes` | | | |

## Validation (server authoritative; client mirrors for preview)

- required fields present; `vendor` ∈ VALID_VENDORS; `cam_role` ∈ {standard,face,lpr}
- `site` resolves to a site_id (by code, else by name) — else row `reason: 'unknown site'`
- `camera_id` unique against existing config **and** within the uploaded file
- `http_port` numeric; `ip_address` valid IPv4 shape
- unknown `capture_categories` values dropped (not a row failure)

## Flow

```
[Download template.csv]         ← generated client-side, no endpoint
      ↓ fill offline
[Choose file] → FileReader → quote-aware CSV parse (~15 lines, no lib)
      ↓
[Preview table]  per row: ✓ or ✗ + reason (client validate)
      ↓ "Import N cameras"
POST /api/cameras/bulk-import   (auth.requireAdmin)   ← re-validate server-side
      ↓  per row: sanitize → dedup → INSERT enabled=TRUE → push to config.cameras
      ↓  saveCameraConfig once
      ↓  group created by site_id → publishSiteConfig() per site (skip 'main')
      ↓
{ created:[...], skipped:[{row,camera_id,reason}] }  → result report
```

## Implementation Phases

**P1 — Backend** (`src/routes/cameras.js`)
- `POST /api/cameras/bulk-import` (`auth.requireAdmin`), body `{ cameras: [row,…] }`
- site-resolve helper: code → id, fallback name → id (cache the `sites` lookup)
- per-row validate + `_sanitizeCameraId` + dedup (config set + in-batch set)
- `INSERT INTO cameras (... enabled=TRUE ...) ON CONFLICT (id) DO NOTHING`,
  push entry to config
- `saveCameraConfig(config)` once; `publishSiteConfig(siteId,…)` per affected
  non-main site
- return `{ created, skipped }`

**P2 — Frontend** (`page-camera-settings.js`, `index.html`, `index.css`,
`page-nav-bindings.js`, `i18n.js`)
- "นำเข้า CSV" button beside "+ เพิ่มจาก NVR"
- modal: [Download template] + `<input type=file>` + client CSV parser +
  preview table (row status) + [Import] + result report
- i18n th + en for all strings

**P3 — Polish**
- validation messages; responsive ≤768px (preview table scrolls in
  `overflow-x:auto`); warn that the CSV contains plaintext passwords

## Out of scope (ponytail)

- No server-side file upload / multer (parse in browser)
- No CSV library (hand-rolled quote-aware parser)
- No per-row live Test Connection at import time (SSRF surface + slow) — later
- No update-existing (dedup skips; edits use the existing single-edit form)

## Verification Plan

- import a small CSV to `hdy` → rows appear in Settings › Cameras, `ON`,
  `site = หาดใหญ่`; `publishSiteConfig` log shows the push; edge
  `edge-config-agent` receives `_config/cameras` and starts previews/events
- duplicate `camera_id` and unknown `site` rows land in `skipped` with reasons
- main-site rows import with no edge push
- responsive ≤768px preview table

## Risks

- Plaintext passwords transit the browser + land in `cameras-config.json`
  (accepted; matches existing model; edge push encrypts)
- CSV with commas inside quoted fields (location/notes) — parser must handle
  RFC-4180 quoting
- Large uploads: cap rows (e.g. 500) to keep one push payload sane; log if
  truncated
