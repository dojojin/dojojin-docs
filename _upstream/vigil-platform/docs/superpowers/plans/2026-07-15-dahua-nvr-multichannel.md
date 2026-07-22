# Multi-channel Dahua NVR Support + Flexible Per-Channel Event Filtering

**Status:** 🟡 PLANNED 2026-07-15 (approved, implementation in progress)
**Date:** 2026-07-15
**Site:** HDY (edge node `hdy`, `172.17.22.10` — Dahua DHI-NVR5216-16P-I/L, 16ch)
**Author:** Prakasit Rochanavipart (Dojo-mAn) — planned via Advisor-led cycle (Explore ×2 + Plan agent)

---

## Problem Statement

`src/ingesters/dahua-cgi.js` was built for **single edge IP cameras**: 1 config entry = 1 `camera_id` = 1 IP = 1 CGI event stream that wholly belongs to that camera. The HDY NVR breaks every one of those assumptions — one physical device serves 16 channels on a **single mixed eventManager stream**, with the channel encoded only in the event header `Code=X;action=Y;index=N` (live-verified: `index` = 0-based channel; the JSON body carries no `Channel` field). Today `parseDahuaEventText` discards `index`, `DAHUA_EVENT_MAP` doesn't contain the NVR's onboard-AI codes (Face/ANPR/Vehicle), and the snapshot/RTSP paths hardcode `channel=1`.

**Goal:** make one NVR configurable as N logical cameras (one `camera_id` per channel), route each event to the right channel, and let the operator pick **which channels** and **which event categories** to ingest (face-only, ANPR-only, a subset, or everything) with maximum flexibility.

## Decisions locked with owner (2026-07-15)

- **Phase 1 first** — ANPR (`TrafficJunction`) lands as a generic event, plate text/province preserved in `raw_json`; full LPR (→ `license_plates`, watchlist, gates) is Phase 2.
- **JSON-first authoring** — Phase 1 uses `cameras-config.json` / existing `POST /api/cameras`; dashboard UI + DB columns are Phase 3.
- **Seed = Face ch0-1 first** (single-channel dry run, then add ch1) to verify the NVR opens only one shared stream before scaling up.

## Design Principle

**Keep 1 `camera_id` = 1 channel = 1 DB row; make only the CONNECTION layer device-aware.** Everything downstream of `ingestEvent` (DB insert, `pg_notify`, alertEngine, MQTT snapshot topic, `publishEdgeEvent`, `last_seen`) keys on `cam.camera_id` — unchanged. Only the HTTP connection layer groups Dahua config entries by device (`ip:port:user` or explicit `device_id`), opening **ONE** eventManager + **ONE** snapManager stream per physical NVR, then routes events to channels via `index=N`.

**Rejected:** N independent streams per channel (16 entries → 32 concurrent CGI sessions on a live NVR that already has a VMS client attached — blows the session cap); nested `channels:[]` sub-config (breaks the flat pass-through config model and the flat `cameras` DB table).

## New Config Fields (flat, one entry per channel)

```jsonc
{
  "camera_id": "hdy-nvr1-ch0",
  "vendor": "dahua",
  "ip_address": "172.17.22.10",
  "username": "admin", "password": "…",
  "nvr_channel": 0,                  // NEW — 0-based, == eventManager index=N
  "device_id": "hdy-nvr1",           // NEW (optional) — explicit device grouping key
  "capture_categories": ["face"]     // NEW (optional) — allow-list; omit = capture all mapped
}
```
Back-compat: no `nvr_channel` → single-channel device (today's behavior, unchanged).

## Category → Dahua Code Map

```
face     → FaceRecognition, FaceDetection, FaceAttribute, FaceAnalysis
anpr     → TrafficJunction
vehicle  → VehicleDetect, SmartMotionVehicle
nonmotor → NonMotorDetect
person   → HumanTrait, SmartMotionHuman
rule     → CrossLineDetection, CrossRegionDetection, LeftDetection, TakenAwayDetection, VideoBlind
```
Two-stage filter: device subscription = union of all its channels' codes; per-event post-filter drops codes a given channel didn't opt into.

## Implementation (Phase 1)

- **`src/ingesters/dahua-protocol.js`** (pure) — parse `index=N`, include in dedupKey; expand `DAHUA_EVENT_MAP` with NVR AI codes; new `deviceKey`, `codesForCategories`, `channelAllowsCode` helpers.
- **`src/ingesters/dahua-cgi.js`** — device registry (`_devices: deviceKey → {channels: Map<nvr_channel, cam>}`); `connectCamera`→`connectDevice`; snapManager per-device (drop hardcoded `channel=1`); `parseDahuaEvent` resolves channel cam + applies filter; device-grouped `cameraConfigSignature`/`syncCameras`/reconnect; channel-aware `captureFrame`/`_eventSnaps`/`waitForEventSnapshot`.
- **`src/media-recorder.js`** — Dahua RTSP `buildRtspUrl`: `channel=(nvr_channel||0)+1` instead of hardcoded `channel=1`.
- **`src/routes/cameras.js`** — `POST /api/cameras` persists `nvr_channel` + `capture_categories` into the config entry.
- **Tests** — extend `test/dahua-parser.test.js` (index/dedup/category/deviceKey/map-completeness) + snapshot-selector channel isolation test.

## Phases 2 & 3 (deferred)

- **Phase 2:** `parseDahuaTrafficJunction()` adapter → `ingestLprPush` preParsed branch → `license_plates` (needs a live TrafficJunction payload sample to lock plate-crop sourcing).
- **Phase 3:** `cameras.nvr_channel`/`capture_categories` DB columns + `page-camera-settings.js` UI (clone the `ignore_event_types` checkbox pattern).

## Verification Plan

1. Unit tests green (pure module, no NVR calls).
2. Single-channel dry run: ch0 Face only → confirm exactly 1 eventManager + 1 snapManager session on the NVR, correct `camera_id`/`index`/snapshot.
3. Add ch1 → confirm still 1+1 sessions, not 2+2 (session-limit guard — the NVR already serves another VMS client).
4. Capture one raw `TrafficJunction` line to lock the plate-JSON schema for Phase 2.

## Risks

Session limits (highest — design holds total at 2/device); 0-based (`index`/`nvr_channel`) vs 1-based (RTSP/CGI snapshot `channel=`) conversion; snapshot cross-channel mismatch if snap parts aren't channel-tagged (falls back to channel-correct RTSP buffer); dedup collisions without channel in the key; new `event_type` values may lack alert-category rules until seeded.

---

*See also: [`docs/LOGIC_dahua-ingester.md`](../../LOGIC_dahua-ingester.md), Claude Code plan file `mighty-dazzling-twilight.md` (full Advisor-reviewed design with exact line numbers).*
