# HCP Pull Integration — Design Spec

> Role: `GUIDE_` design spec · Created 2026-06-23 · Owner: Prakasit (Dojo-mAn)
> Status: **DESIGN APPROVED, BUILD GATED** on HCP access (AppKey/AppSecret + OpenAPI gateway IP:port — both being requested).
> Source of truth for the API: `docs/manuals/HCP_OpenAPI.pdf` (HikCentral Professional OpenAPI V3.0.1).
> Implementation plan (steps) → separate doc in `docs/superpowers/plans/` via writing-plans, after this spec is reviewed.

---

## 1. Goal & Principle

Pull events from **HikCentral Professional (HCP)** via its OpenAPI (Artemis gateway) into Vigil, instead of (or in addition to) per-camera push. Order: **LPR → face → blacklist-hit label**.

**Strategic frame — Vigil = central hub.** Future: CIB / third parties connect to *us*, not to each camera one by one. So pulled data must land in a **central store we can re-serve** (the existing `events`/`license_plates` tables + `/api/lpr`, `/api/face-matches` already do this).

**Ponytail guardrails (do NOT violate):**
- ONE HCP instance → one config block + one cursor per stream. **No multi-HCP/connector framework** (YAGNI until a 2nd instance exists).
- Reuse existing tables, UI, alert path. No new dependency (use node `http`/`https`, like every other ingester).
- Separate poller process (crash isolation), matching the hikvision/dahua ingester pattern.
- Do **not** conflate with the dormant `src/lpr-pull.js` — that pulls a *camera's* ISAPI stream over LAN; this is HCP OpenAPI, new code.

---

## 2. Current-state facts (verified against code)

- Architecture is **push-only today**. There is **zero** code that talks to HCP — HCP is only a push *destination* (HKT01 pushes face to HCP `202.124.201.105:10001`). "Pull from HCP" is all-new.
- Ingesters are **separate PM2 processes** (`hikvision`, `dahua`) that **pull** via long-lived HTTP + RFC2617 digest auth. Config from `cameras-config.json` (mtime-cached, secrets `enc:v1:` via `src/crypto-creds.js`). Migration runner `src/migrate.js`, next number **064**.
- **Dedup asymmetry (drives the phase order):**
  - **LPR is clean** — the LPR camera now pushes **direct to CIB**, not to us (`project_lpr_cimb_forward`). HCP becomes the **sole** LPR source → no collision → lowest-risk pilot.
  - **Face collides** — HKT01 pushes face to HCP **and** to us via the active `/face-push/:token` (IM3-R). Pulling face from HCP duplicates every face-push event → H2 must **replace `/face-push`** or carry a dedup key.

---

## 3. HCP API facts (verified from the PDF)

### 3.1 Auth — AK/SK HMAC-SHA256 (§3.2)
Per-request signed headers (NOT the ISAPI digest auth):
- `X-Ca-Key: <appKey>`, `X-Ca-Timestamp`, `X-Ca-Nonce` (UUID, anti-replay)
- `X-Ca-Signature` = `BASE64( HmacSHA256( stringToSign, appSecret ) )`
- `stringToSign` = `METHOD\nAccept\nContent-MD5\nContent-Type\nDate\n<sorted signed headers>\n<URI w/ sorted query>`; `Content-MD5 = BASE64(MD5(body))`.
- `X-Ca-Signature-Headers` lists which headers were signed (lowercase, comma-sorted).
- Doable in ~30 lines with node `crypto`. **AppKey/AppSecret obtained offline from Hik support.**

### 3.2 Pull mechanisms — polling chosen
| Stream | Endpoint | Why |
|---|---|---|
| LPR | `POST /artemis/api/pms/v1/crossRecords/page` | dedicated ANPR record query, rich fields |
| Face | `POST /artemis/api/aiapplication/v1/face/faceMatchRecord` | dedicated face-match query |
| (generic) | `POST /artemis/api/eventService/v1/eventRecords/page` | fallback / scale path (multi-source) |
| Images | `POST /artemis/api/pms/v1/image` | fetch JPEG by `picUri` token |

Subscription (`eventSubscriptionByEventTypes`) is **callback-based** (HCP pushes to our URL) — rejected: misses events on downtime beyond HCP's 500-event/1-day cache, needs new inbound surface, doesn't fit "pull"/hub control.

### 3.3 `crossRecords/page` request/response (verified)
- **Request:** `cameraIndexCode` (Req, **singular**), `plateNo`/`ownerName` (opt), `startTime`/`endTime` (ISO-8601 **with offset**, window **≤31 days**), `pageNo`, `pageSize` (≤500), `sortField:"PassTime"`, `orderType` (1=desc default).
- **Response `list[]` item fields:** `crossRecordSyscode` (**"Vehicle passing record ID", Req String — the stable unique id**), `cameraIndexCode`, `plateNo`, `ownerName`, `contact`, `vehicleType`, `vehicleBrand`, `vehicleColor`, `country`, `vehicleDirectionType`, `vehicleSpeed`, `vehiclePicUri` (→ `/pms/v1/image`), `crossTime` (vehicle pass time = event time), `createTime` (record creation in HCP).
- **Two timestamps matter:** `crossTime` < `createTime` (camera→HCP lag). Sort/query is on **PassTime (crossTime) only** — there is no createTime sort. ⇒ cursor must be on crossTime, with margin (see §5.1).

---

## 4. Architecture

### 4.1 New components (match existing convention)
| File | Responsibility | Notes |
|---|---|---|
| `src/helpers/hcp-sign.js` | AK/SK HMAC-SHA256 signer (pure fn) | + **self-test** (security path; ponytail rule) |
| `src/hcp-client.js` | signed `POST → JSON` over node `https`; `fetchImage(picUri)` | no new dependency |
| `src/hcp-poller.js` | the process: one poll loop per enabled stream; cursor; calls shared writer | one process, multiple loops |
| `ecosystem.config.js` | `+1` entry `hcp-poller` | crash-isolated like other ingesters |

### 4.2 Config & secrets
New `hcp` block in `cameras-config.json` (gitignored, mtime-cached, `enc:v1:` supported):
```jsonc
"hcp": {
  "enabled": true,
  "host": "<gateway-ip>", "port": 443,        // from Hik — NOT the :10001 push port
  "appKey": "<key>", "appSecret": "enc:v1:…", // appSecret encrypted via crypto-creds
  "userId": "<api-user>",                      // required Header on every call
  "pollIntervalSec": 8,
  "cursorMarginSec": 120,                      // trailing re-query window (§5.1)
  "streams": { "lpr": true, "face": false }
}
```
Cursors in `system_settings`: `hcp_cursor_lpr`, `hcp_cursor_face` (stored as **UTC epoch ms**, absolute instant).

### 4.3 Data model (migration 064)
- **Reuse** `events` + `license_plates`; face lands in `events.raw_json` (matches existing face ingest).
- `events.source_ref VARCHAR(80)` + **partial unique index** `WHERE source_ref IS NOT NULL` → idempotent ingest. Key = `hcp:<crossRecordSyscode>` (LPR) / `hcp:<face record id>` (face). Existing push rows keep `source_ref = NULL` → never collide.
- `cameras.hcp_index_code VARCHAR(64)` → map HCP `cameraIndexCode` ↔ vigil `camera.id`.
- **No roster table now** (blacklist roster deferred — see §6).

---

## 5. Cross-cutting rules (apply to every stream)

### 5.1 Cursor — margin + dedup (prevents silent late-arrival loss)
An event's `crossTime` is earlier than when its record becomes queryable (`createTime`). Advancing the cursor straight to `now` drops any record that lands *after* the poll but with a timestamp *before* `now`.
- Each tick: query window `[cursor − margin, now]` (margin = `cursorMarginSec`, must exceed the typical `createTime − crossTime` lag).
- Advance cursor to `now − margin` (re-query the trailing window every tick).
- `source_ref` dedup (ON CONFLICT DO NOTHING) absorbs the repeats — cheap, makes overlap free.
- First run / post-downtime gap >31 days → **chunk** into ≤31-day windows.

### 5.2 Timezone (we've been bitten 3× — HCP is a fresh surface)
- App forces `SET TIME ZONE 'UTC'`. Store cursor as **absolute UTC epoch**.
- Format `startTime`/`endTime` with an **explicit offset** at request time. Phuket is likely `+07:00` — **do not assume**; verify what offset HCP actually returns in `crossTime` against one known real event before trusting the mapping. (PDF examples use `+08:00` = China — not ours.)
- An off-by-7h cursor silently re-pulls or skips 7h every tick. → explicit verify-first line item (§7).

### 5.3 Insert seam — do NOT route through `ingestLprPush`
`lpr-core.js::ingestLprPush` is built for camera **multipart** + 3s-bucket dedup + CIB-forward — none apply to HCP JSON.
- Factor the **insert + image-save + `pg_notify`** core of `lpr-core.js` into a shared writer (e.g. `writeLprRecord(record)`).
- `hcp-poller` normalizes HCP JSON → the same record shape, then calls the shared writer. (Existing push path also calls it → one writer, no drift.)

### 5.4 Alerts & live update — pulled rows must not be inert
A row inserted without firing `pg_notify` = no live WS update, no LINE alert (for blacklist hits in H2 that's the whole point).
- **H1:** wire `pg_notify('new_event', …)` (+ `event_for_clip` if applicable) in the shared writer → WS live update + LPR watchlist-alert path work.
- **H2:** pin the face alert path explicitly. ⚠️ `alertEngine.onEvent` (in-process, ingester) vs `alert_event → alert-worker` are **different impls** (`project_im3_revised_push_path`) — confirm equivalence before choosing; the poller is a separate process so the in-process engine may not be initialized there.

### 5.5 Verify-first when keys arrive
Hik docs vs reality drift. Before mapping any field to DB, hit the **real gateway** and confirm the response shape. The H0 smoke test (§7) doubles as this verification.

---

## 6. Phases

| Phase | Scope | Gate |
|---|---|---|
| **H0** foundation | `hcp-sign` (+test) · `hcp-client` · config block · **smoke = real `crossRecords` call** against a known camera+window (proves signing + appKey + per-capability permission + response shape) | 🔒 AppKey + gateway IP:port |
| **H1** LPR (pilot) | camera discovery (HCP list → `hcp_index_code` map) · `crossRecords/page` poll loop · cursor (§5.1/5.2) · image fetch → `snapshots/lpr/` · shared writer (§5.3) · `pg_notify` (§5.4) · dedup via `source_ref` · migration 064 | H0 green |
| **H2** face | `faceMatchRecord` poll → `events.raw_json` · **resolve `/face-push` collision** (replace or dedup) · **blacklist hit = label only** (filter face-match where group=blacklist; no new DB) · pin alert path (§5.4) | H1 done |
| ~~roster mirror~~ | **DEFERRED** — pull Face Picture Library roster + diff (add/edit/delete) into a canonical table | later |
| ~~CIB→HCP write-back~~ | **DEFERRED** — CIB inbound → transform → write persons/faces into HCP (`person/single/{add,update,delete}`, `person/face/update`) | 🔒 needs CIB format + write-scoped AppKey; one-way flows w/ `origin` tag, no two-way auto-merge |

**Blacklist note:** a blacklist *hit* is just a face match whose library group = blacklist → it arrives free in H2 (label only). Knowing *who is on the list* (roster) and writing the list back to HCP are the deferred pieces; design the eventual roster table with `origin`/`external_id`/`photo` so write-back doesn't require a rebuild.

---

## 7. Known ceilings & open items (verify when keys arrive)

**Known ceiling (log, don't solve now):** `crossRecords` is per-`cameraIndexCode` (singular). Fine for the pilot's handful of cameras. Hub vision (100–3000 cameras × per-camera calls × poll interval) will not scale this way — `eventRecords/page` accepts multiple `srcIndexs` and is the likely scale path. Re-evaluate before scaling beyond the pilot.

**Verify-first checklist (H0):**
1. Gateway reachable from the platform server (TCP, then signed `common/v1/version`).
2. AppKey has permission for `crossRecords` (not just version) → the real-call smoke.
3. Response shape matches §3.3 (esp. `crossRecordSyscode` present & unique).
4. **Timezone:** what offset does `crossTime` carry; what does `startTime/endTime` filter on; measure `createTime − crossTime` lag → size `cursorMarginSec`.
5. `vehiclePicUri` → `/pms/v1/image` returns a usable JPEG.
6. `vehicleBrand`/`vehicleType`/`vehicleColor`/`country` codes — map to our existing `_LPR_BRAND`/color/region dictionaries (codes may differ from the ISAPI push values we already store).

**Still pending from owner:** AppKey/AppSecret, gateway IP:port (both being requested).
