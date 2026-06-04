# LOGIC_camera-ingesters — Camera Ingesters, Multi-vendor & Clip Capture

> Extracted from DECISIONS.md. Canonical source for Bosch MQTT ingestion,
> Hikvision ISAPI, Dahua CGI, generic ONVIF, pre-alarm clip capture,
> snapshot logic, and camera lifecycle decisions.
> Parent index: DECISIONS.md
> Last updated: 2026-05-26 · v1.5.0

---

## Pre-alarm Video Clip Capture (#62–#71, #77–#79)

**#62 — Server-side RTSP rolling buffer (not camera FTP push)**
Bosch FW 9.80.106 cannot push pre-alarm clips via FTP without a microSD card. `media-recorder.js` runs ffmpeg per camera 24/7, segments RTSP into 1-sec MPEG-TS files in `media-buffer/<camera_id>/`.

**#63 — ffmpeg native segmenter, not custom NAL parser**
`-f segment -segment_time 1 -segment_format mpegts -strftime 1` writes `<unix_ts>.ts` files. Concat on alarm via `-f concat -c copy` (no re-encode — CPU cheap).

**#64 — Postgres LISTEN/NOTIFY for alarm trigger**
`mqtt-subscriber` calls `pg_notify('event_for_clip', {event_id, camera_id, event_time})` after every rule_name event insert. `media-recorder` LISTENs on a dedicated `pg.Client`. Decoupled, race-free.

**#65 — Per-camera toggles, default OFF for clip**
`enable_clip_capture` defaults `false`. `enable_snapshot` + `enable_vca_overlay` default `true` (preserve prior behaviour).

**#66 — `clip_retention_days` separate from `snapshot_retention_days`**
Clips are ~100× bigger. Default 30 days, max 90, validated server-side.

**#67 — `/media/:filename` auth-gated (PDPA)**
Same pattern as `/snapshots/:filename`. Regex-validated filename blocks path traversal.

**#68 — VCA Object Overlay = `&VCAOverlay=1` on Bosch `snap.jpg`**
Case-sensitive all-caps VCA. Confirmed working on FW 9.80.106. `Vca=1`, `VcaOverlay=1`, `vca=1` etc. do NOT work.

> STUBBORN_FACT: `VCAOverlay=1` is case-sensitive. Wrong case = no overlay, no error. Decision #68.

**#69 — `getCamFlags(cameraId)` 30s in-memory cache in `mqtt-subscriber`**
Avoids hot DB lookup per event for `enable_snapshot` + `enable_vca_overlay`. Stale-by-30s acceptable.

**#70 — Real clip duration via `ffprobe`**
`segment_ts_end - segment_ts_start + 1` fails when Bosch GOP=2s and only 1 segment lands. `ffprobe -show_entries format=duration` runs once per clip after concat (~50ms).

**#71 — Skip snapshot AND clip for `*Aggregation*` events**
Bosch IVA Aggregation events fire 10–30s AFTER the object has left the scene. Both snapshot and clip window capture empty frames. The original detection is already captured by the corresponding `LineDetector/Crossed` or `FieldDetector` event.

**#77 — Use Stream 2 (sub-stream, ~1080p / 2 Mbps) not Stream 1 (4K / 9 Mbps)**
Bosch URL: `rtsp://...//rtsp_tunnel?inst=2`. 4–5× less network + disk + RAM per camera.

**#78 — `-timeout 30000000` (30s socket I/O timeout)**
Without it, ffmpeg hangs forever if camera RTSP stalls after TCP handshake. Use `-timeout` (ffmpeg 5+), not `-stimeout` (ffmpeg < 5) or `-rw_timeout`.

**#79 — Other RTSP resilience flags**
`-rtbufsize 64M` (vs 3MB default), `-fflags +discardcorrupt`, `-err_detect ignore_err`, `-thread_queue_size 1024`.

---

## Bosch-specific (#40, #111, #112)

**#40 — Bosch `/snap.jpg` returns NATIVE resolution when `JpegSize` is OMITTED**
`JpegSize=WxH` param caps output to exactly that size. Both `mqtt-subscriber.js` and `/api/snapshot/live` previously hard-coded `JpegSize=1280x720`, silently capping every Bosch snapshot to 720p. Fixed 2026-05-21 — `JpegSize` dropped from both routes. Native: 8100i = 3840×2160 ~920KB, 8000i = 3264×1840 ~620KB.
Consequence: stored Bosch event snapshots are now ~4–6× larger on disk. `HARDWARE_SIZING_GUIDE.md` 160KB/snap constant is stale for native captures.

**#111 — IVA Basic CAN produce object_class / likelihood / speed / GeoLocation after Camera Calibration**
Earlier belief that IVA Basic was hardware-incapable of object classification was wrong. Both Basic and Pro follow ONVIF Profile M. The genuine FW gap: Pro sends base64 object crop in `Appearance.Image`, Basic doesn't (falls through to HTTP `/snap.jpg`).

**#112 — MQTT broker swapped Mosquitto 2.0 → EMQX 5.8**
Mosquitto 2.x strict validator rejects MQTT 3.1 packets from older Bosch FW (8000i IVA Basic). No config flag to relax. EMQX 5.8 is more lenient. After swap: 8000i went 0 → 4 events in first 2 minutes. All other cameras unchanged.
EMQX ports: MQTT `:1883`, WS `:8083`, dashboard `:18083` (default `admin/public` — change in production).
EMQX default ACL denies `subscribe #` for non-localhost — subscriber uses specific patterns (`+/onvif-ej/...`) which pass.

> STUBBORN_FACT: Mosquitto 2.x cannot be configured to accept old-firmware Bosch packets. The fix is EMQX. GOTCHAS #33.

---

## Multi-vendor Architecture (#114–#116, #121, #123)

**#114 — Multi-vendor work started with Hikvision (not generic ONVIF) because a real camera arrived**
`src/ingesters/hikvision-isapi.js` — outbound connection to camera's ISAPI Alert Stream (`GET /ISAPI/Event/notification/alertStream`). Long-lived multipart/mixed HTTP push. HTTP Digest auth hand-rolled (~40 lines, `crypto` only). XML parsing via per-tag regex — zero new npm deps.
Normalization: Hikvision `eventType` maps to shared `events` table using Bosch vocabulary where applicable (`linedetection → LineDetector/Crossed`). `raw_json.vendor='hikvision'` tags the source.
Dedup: Hikvision re-posts `eventState=active` ~1×/s. Ingester keeps 3-second per-(camera,eventType) window — repeats within 3s dropped; `inactive` half dropped outright.

**#115 — `vendor` field is first-class + per-camera stream selection**
Config fields: `vendor` (`'bosch'|'hikvision'|'dahua'|'onvif'`, absent = `'bosch'`), `clip_stream` (RTSP stream for media-recorder), `snapshot_stream` (stream for still image). Live code branches on `vendor` in `media-recorder.js` `buildRtspUrl()` and `api-server.js` `/api/snapshot/live`. `mqtt-subscriber.js` filters its `cameraMap` to Bosch-only.

**#116 — Hikvision reaches Bosch parity for core flow**
- MV.2a: alert-engine wired into `hikvision-isapi.js` — same rule-match/cooldown/quiet-hours/LINE pipeline.
- MV.2b: `pg_notify('event_for_clip')` after INSERT — `media-recorder` picks up Hikvision cameras through existing `syncRecorders` query.
- MV.2c: `captureSnapshot()` pulls still from ISAPI picture endpoint (digest auth), saves to `snapshots/`, patches `raw_json._snapshot`.

**#121 — Camera settings: full SPA page, vendor set 2 → 4**
`#page-camera-settings` — admin-only nav item `⚙️ ตั้งค่ากล้อง`. Vendor-adaptive form via `onVendorChange()`. Media Capture section hidden for ONVIF (monitor-only). VCA-overlay toggle Bosch-only. ONVIF online status via 60s TCP-reachability probe (`checkMonitorCameras`).

**#123 — Dahua VCA events via eventManager CGI stream**
`src/ingesters/dahua-cgi.js` — outbound `GET /cgi-bin/eventManager.cgi?action=attach`. HTTP Digest auth. Codes must be listed explicitly — `codes=[All]` delivers only Heartbeat + system events, NOT VCA events.
Event snapshot extracted from media-recorder's RTSP clip buffer (not `snapshot.cgi` — too slow, ~1.6s/grab, misses fast subjects). Current flow: snapManager event JPEG if available → RTSP burst scoring around server receive time → low-confidence/missing/failed first pass is repaired by the clip resolver after `clip_done`. The resolver retries when `clip_done` arrives before first-pass `_snapshot_status` is written.
`data.UTC` is the camera's LOCAL time sent as unix timestamp (NOT UTC). Strip the whole-hour offset before using.
Live Dahua snapshot timing and recovery findings are maintained in `DahuaProblem.MD`. Read that file before changing Dahua snapshot selection, `low_confidence` handling, clip resolver behavior, or camera-specific timing offsets.

> STUBBORN_FACT: Dahua FaceDetection must NOT route to the face gallery — detection-only, no reliable crop, demographics unreliable on IPC-HFW5541E-ZE. Decision #123. GOTCHAS #39.

---

## Camera Lifecycle (#86, #109, #110)

**#86 — Camera list ALWAYS reads from `cameras-config.json`, never `cameras` DB table**
DB table auto-registers any camera_id seen on MQTT (including stale test entries). Nothing writes lat/lon to it. Every report/stat endpoint that lists cameras must read the JSON.

> STUBBORN_FACT: `cameras-config.json` is the source of truth for camera list. DB `cameras` table is runtime state only. Decision #86.

**#109 — Same-model hardware replacement should REUSE the existing `camera_id`**
Swapping to a new physical camera: reconfigure Bosch CM to publish under the SAME MQTT topic prefix. Don't add a parallel entry — that fragments historical events and silences alert rules pinned to the old id.
`POST /api/cameras` soft-blocks when an IP duplicate is detected, offers "ใช้ camera_id เดิม" path.

**#110 — `camera_id` must be ASCII-clean — strip invisible characters at ingest**
Incident 2026-05-19: Thai phinthu (U+0E3A) prepended to camera_id was invisible but broke MQTT topic matching. `POST /api/cameras` gained `_sanitizeCameraId()` — strips ASCII control chars, zero-width chars, BOM, Thai phinthu, Thai tone marks U+0E48–U+0E4E. Returns 409 + warnings[] when sanitisation changes input.
`mqtt-subscriber.js` `ensureCamera()` logs one-time diagnostic when MQTT id and config id differ only by stripped characters.

> STUBBORN_FACT: Invisible Thai characters in `camera_id` break MQTT topic matching silently. Sanitise at every write path. GOTCHAS #32.

---

## Snapshot Display (#41, #125)

**#41 — Hikvision live-snapshot route picks ISAPI channel by requested `?w` size**
Small `?w` (grid ≤400, detail hero 640) → channel 102 (sub-stream, 720p). Large/absent `?w` ("view full") → channel `10<snapshot_stream||1>` (main, up to 4K). Hard-coding channel 102 capped "view full" at 720p regardless of operator setting.

**#125 — Snapshot images served at display-appropriate size via `?w=N` thumbnails**
Phase 1: `/snapshots/:filename?w=N` builds disk-cached thumbnail (`snapshots/.thumbs/<w>/`). Phase 2: event modal + camera-detail hero load `?w=640`; "view full" button opens native resolution capped by per-camera `full_view_width` setting. Width restricted to `THUMB_WIDTHS` set — out-of-set `?w` serves full image.

---

## Analytics Events (#89, #113)

**#89 — Camera-automation events: store always, filter on display**
`ImageTooBright|Blurry|Dark`, `GlobalSceneChange`, `Trigger/DigitalInput`, `Trigger/Relay` — always stored, display gated by `system_settings.analytics_event_display`.
`state='false'` "ended" halves always hidden (state dedup).

**#113 — Trigger/DigitalInput + Trigger/Relay are opt-in display (default OFF)**
Phase 7.5 collapsed 4 granular trigger keys into 2 broad prefix keys. `disabledAnalyticsClause(col)` helper wired into all stat endpoints. Visible on Health Check "🔌 Camera Automation Triggers (24h)" card.

---

## WS Performance (#96)

**#96 — WS `new_event` via Postgres LISTEN/NOTIFY — push, not poll**
`mqtt-subscriber` `pg_notify('new_event', <id>)` after every event INSERT. api-server's `listenClient` picks up notification, queries full row by id, broadcasts. Old 1s `setInterval` poll + `lastEventId` watermark deleted. ~86,400 DB queries/day saved per api-server instance.

---

## Camera Offline Alerts (#134–#135 Ph.1)

Per-camera LINE notification when camera goes offline. Config per camera: `enabled`, `notify_after_sec` (default 300), `escalate_interval_min` (default 60), `escalate_once` (no-repeat flag), `quiet_from/to`, `recipients`.
`camera_status_log` table (migration 018) — every online↔offline transition, 90d retention.
Recovery alert fires once when offline camera comes back online.

LINE delivery, recipient resolution, quiet-hours semantics, and quota rules are owned by `docs/LOGIC_line-notifications.md`.

---

## Related files
- `src/mqtt-subscriber.js` — Bosch MQTT ingestion
- `src/ingesters/hikvision-isapi.js` — Hikvision ISAPI Alert Stream
- `src/ingesters/dahua-cgi.js` — Dahua CGI eventManager
- `src/media-recorder.js` — RTSP rolling buffer + clip dump
- `docs/LOGIC_line-notifications.md` — LINE alert delivery and recipient behavior
- `cameras-config.json` — source of truth for camera list
- `db/db_migration_clip_capture.sql` — clip toggles schema
- `db/db_migration_018_*.sql` — camera_status_log + camera_offline_alerts
- GOTCHAS #6 (Mosquitto + Bosch), #10 (MotionAlarm filtered), #32 (invisible chars), #33 (EMQX), #39 (Dahua), #40 (Bosch snap.jpg), #41 (Hikvision channel)
