# LOGIC — Edge Ingester Divergence (POC, VIGIL-ARCH-003)

> **Status:** POC design, branch `edge-poc-mqtt-publish`.
> **Audience:** whoever deploys the Site Edge for real — read this so you do
> **not** rewrite the edge ingesters back to the central shape. The divergence
> below is intentional and permanent-by-design.

## Why edge ≠ central

The platform has **two** event-normalization paths, and they are deliberately
different:

| | Central (`src/mqtt-subscriber.js`) | Edge (`src/ingesters/*.js`, `EDGE_MODE=1`) |
|---|---|---|
| Input | Bosch ONVIF-EJ MQTT payload | Hik ISAPI XML / Dahua CGI |
| Normalize | `processMessage()` derives columns from ONVIF nested shape | vendor-specific code already in each ingester |
| Output | row in `events` table (local PG) | **publish a pre-normalized row** to local NanoMQ |

The edge ingesters perform vendor-specific normalization that the central ONVIF
normalizer cannot reproduce:

- `HIK_EVENT_MAP` (Hik eventType → `event_type` / `rule_name`)
- `detectionRegions` polygon extraction (snapshot overlay)
- People-counting dedup via `NOT EXISTS (window_start)`
- fielddetection **false-half** ("zone clear" leg) → `event_state='false'`
- explicit `event_state='true'` on every active event

If the edge published raw ONVIF and let central re-normalize, all of the above
would be **lost**. So the edge publishes the *finished* `events`-table row and
central inserts it verbatim through a lightweight passthrough — bypassing
`processMessage` normalization.

## Dataflow

```
Hik/Dahua cam ──(ISAPI/CGI)──▶ Edge ingester (normalize)
                                   │  saves image → local disk (Tier 2, buffered)
                                   ▼  publishes METADATA ONLY (no base64)
                          NanoMQ local :1883
                                   │  bridge: forward +/onvif-ej/#
                                   ▼
                          Central EMQX (dashboard.dojojin.tech)
                                   ▼
                  mqtt-subscriber → _edge passthrough → INSERT events
```

Bosch is unchanged: cam publishes ONVIF straight to NanoMQ → bridge → central →
`processMessage` (the normal path). Only Hik/Dahua use the `_edge` passthrough.

## Wire contract

**Topic** (same namespace as Bosch so the bridge rule `+/onvif-ej/#` covers all):
```
{camera_id}/onvif-ej/{event_category}/{event_type}
```

**Payload** (JSON, metadata only — IMAGES NEVER CROSS MQTT):
```jsonc
{
  "_edge": 1,
  "_edge_vendor": "hikvision" | "dahua",
  "_edge_corr": "<uuid>",        // correlation id; replaces DB "RETURNING id".
                                  // used to name the locally-buffered image and
                                  // to map metadata ⇄ image for on-demand fetch.
  "_preview_ref":    "cam_corr_ts.jpg" | null,  // image buffered AT EDGE (crop/scene).
                                                 // Central stores it; fetches the
                                                 // bytes later via tunnel/nginx.
  "_preview_full":   "cam_full_corr_ts.jpg" | null, // full-frame (face bg)
  "_preview_source": "hikvision-face" | "lpr-scene" | ... | null,
  "appearance":  { "object_class": "Person", "confidence": 0.9,
                   "gender": "Male", "glasses": false } | null, // → appearances table
  "license_plate": {                              // → license_plates table (LPR only)
    "plate_number": "...", "confidence": 0.97, "country": "...", "region": "...",
    "vehicle_type": null, "vehicle_color": null, "vehicle_brand": null,
    "bbox_x": null, "bbox_y": null, "bbox_width": null, "bbox_height": null,
    "plate_image": "lpr/YYYY-MM-DD/lpr_plate_...jpg"
  } | null,
  "event": {                      // pre-normalized — matches `events` columns 1:1
    "camera_id":      "...",
    "event_category": "RuleEngine" | null,   // LPR stores null (type 'anprAlarm')
    "event_type":     "FieldDetector/ObjectInField",
    "rule_name":      "...",
    "object_id":      null,
    "object_class":   null,
    "likelihood":     null,
    "event_state":    "true" | "false" | "unknown" | null,
    "raw_json":       { ... },   // vendor raw + detectionRegions etc.
    "event_time":     "2026-06-23T...Z"   // ISO-8601 UTC
  },
  "dedup":  { "window_start": "..." } | null,  // people-counting NOT EXISTS guard
  "alert":  { ... } | null,       // present when rule_name set → alert_event notify
  "clip":   { ... } | null        // event_for_clip notify payload
}
```

**Topic routing note:** the topic category is `routeCategory || event.event_category`.
LPR's stored `event_category` is `null`, but it publishes with `routeCategory:
'RuleEngine'` so the message lands on the central `+/onvif-ej/RuleEngine/#`
subscription. The stored row keeps the null category.

**Sources covered by the edge passthrough** (`EDGE_MODE=1`):

| Source | File | event_type | extra tables |
|---|---|---|---|
| Hik Smart Events | `ingesters/hikvision-isapi.js` | LineDetector/Crossed, FieldDetector/…, PeopleCounting, Tamper… | — |
| Hik Face Capture | `ingesters/hikvision-isapi.js` | FaceCapture | appearances |
| Hik Face Recognition push | `routes/face-push.js` | FaceRecognition | — |
| Hik LPR / ANPR push | `lpr-core.js` (`/lpr`) | anprAlarm | license_plates |
| Dahua events | `ingesters/dahua-cgi.js` | per DAHUA_EVENT_MAP | — |
| Bosch | (unchanged — native ONVIF, no `_edge`) | — | — |

**Central passthrough** (`handleEdgeEvent` in `mqtt-subscriber.js`): when
`msg._edge` is truthy, skip `processMessage` normalization and instead:
1. `ensureCamera` + `touchCamera`
2. INSERT `msg.event` verbatim (people-counting uses the `dedup.window_start`
   `NOT EXISTS` guard so retransmissions don't double-insert)
3. merge `_preview_ref` / `_preview_full` / `_preview_lib` / `_preview_source` into
   `raw_json` (`_snapshot`, `_snapshot_full`, `_snapshot_ref`, `_snapshot_source`)
   and set `snapshot_filename` + `has_snapshot` when a preview exists
4. if `msg.appearance` → INSERT into `appearances` (event_id, …)
5. if `msg.license_plate` → INSERT into `license_plates` (event_id, …)
6. `pg_notify('new_event', id)`
7. if `msg.alert` → `pg_notify('alert_event', { ...msg.alert, event_id: id, snapshot_filename })`;
   if `msg.clip` → `pg_notify('event_for_clip', { ...msg.clip, event_id: id })`

> **Status (2026-06-25): IMPLEMENTED.** `handleEdgeEvent` is live in
> `mqtt-subscriber.js` (commit `bacaf59`) — edge events ingest end-to-end on central.

## Image handling (Tier 2)

- The image bytes **never** travel over MQTT (bandwidth + PDPA).
- The edge ingester saves the still to local NVMe (the existing
  `captureSnapshot()` path) named `{camera_id}_{corr}_{ts}.jpg`.
- Only filenames are published — `_preview_ref` (face crop), `_preview_full`
  (full frame), `_preview_lib` (FDLib ref photo, recognition). Never image bytes.
  Recognition ref uses a deterministic path `face/ref/<fdLibName>/<humanId>.jpg`
  (written once per person → fetched once, no re-send).
- Central renders metadata immediately; when an operator opens the image, the
  dashboard fetches it on-demand from the edge through the tunnel. **IMPLEMENTED
  (2026-06-25) as T2-B** in `api-server.js` (commit `caa781f`): snapshot serve is
  local-first, else proxy-fetches from the edge via `SNAPSHOT_PROXY_URL` +
  `SNAPSHOT_PROXY_SECRET` (Bearer), **no disk copy on central (PDPA)**; thumbnails
  (`?w=N`) are disk-cached.

## EDGE_MODE flag

- `EDGE_MODE=1` (set in edge `.env`): ingesters **publish** the pre-normalized
  row to local NanoMQ and **skip** all direct `pool.query` DB writes.
- unset / `0`: original behaviour (direct DB insert) — central/all-in-one box.
