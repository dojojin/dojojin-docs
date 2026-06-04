# Dahua Ingester Snapshot Problem

Last updated: 2026-05-26

## Scope

This note records the Dahua CGI ingester investigation and current fix plan for event snapshots that miss the person even though Dahua VCA emits a valid event.

Affected code:

- `src/ingesters/dahua-cgi.js`
- Runtime dependency: `src/media-recorder.js` RTSP rolling buffer
- Runtime data: `events.raw_json->_snapshot`, `_snapshot_source`, `_snapshot_debug`

## Observed Problem

### DAHUA_CAM01

The camera repeatedly raised `CrossRegionDetection` / `FieldDetector/ObjectsInside` events, but saved snapshots did not show the person.

Confirmed examples:

- 2026-05-25 18:33
- 2026-05-25 18:36
- 2026-05-25 18:38
- 2026-05-25 19:13
- 2026-05-25 19:14
- 2026-05-25 19:42:31
- 2026-05-25 19:42:50

DB facts observed:

- `_snapshot_source` was `dahua-rtsp-buffer-best`.
- `WithSnap` was blank or false, so Dahua did not provide usable event JPEGs for these events.
- `data.UTC + data.UTCMS` on `DAHUA_CAM01` was often about 3.9 seconds ahead of server receive time.
- Older code clamped future event time back to `now`, causing the RTSP buffer frame to be selected too early.
- After the future-timestamp patch, `_snapshot_debug` confirmed that the ingester waited for the future RTSP frame and selected the timestamp reported by Dahua, but the saved snapshot still missed the person.
- Clip review for events `36658` and `36665` showed that the person appears later in the video clip; relying on one camera timestamp still does not produce a reliable still image.

Post-patch examples:

| Event | Server local time | Direction | Dahua corrected delta | Selected target | Result |
|---|---:|---|---:|---:|---|
| `36658` | 2026-05-25 19:42:31.464 | Enter | +4009 ms | event timestamp (`target_delta_ms=0`) | snapshot missed person |
| `36665` | 2026-05-25 19:42:50.088 | Leave | +4022 ms | 700 ms before event timestamp | snapshot missed person |

Conclusion from those examples:

`UTC+UTCMS` is useful as debug data, but it is not reliable enough to be the primary snapshot anchor for `DAHUA_CAM01`.

### BMA-EAST_DAHUA_CAM01

This camera behaved better but still missed some passes.

Observed behavior:

- Some `Enter` events captured the person correctly.
- Some `Leave` events were emitted when the person was already at the edge of the frame or almost outside the frame.
- `snapManager` returned HTTP 400 after restart, so this camera currently falls back to RTSP buffer extraction.

Important difference from `DAHUA_CAM01`:

- `BMA-EAST_DAHUA_CAM01` embeds visible timestamp overlay in captured frames.
- `DAHUA_CAM01` snapshots do not show a visible timestamp overlay, making visual diagnosis harder without `_snapshot_debug` or contact sheets.

## What Has Been Fixed

### 1. Future Dahua Event Timestamps

Changed Dahua detection timestamp handling:

- `UTCMS` is now included with `UTC`.
- Future timestamps are allowed up to `MAX_FUTURE_EVENT_MS = 6000`.
- The first RTSP candidate waits long enough for future target segments to appear.

Reason:

`DAHUA_CAM01` can deliver the CGI event text before the RTSP buffer has reached the timestamp reported by the camera.

### 2. RTSP Burst Candidate Selection

The ingester no longer relies on one candidate frame. It extracts and scores multiple RTSP buffer candidates around the selected anchor.

Scoring includes:

- bounding-box crop detail via `sharp`
- timing penalty from the preferred target time
- segment filename and offset tracking

Earlier testing used direction-aware Dahua-event-time candidates. That helped observability, but the 19:42 examples proved the Dahua event timestamp itself is not reliable enough. The current burst selector uses server receive time as the anchor.

### 3. Snapshot Debugging

Every future Dahua event snapshot update now stores `_snapshot_debug` in `events.raw_json`.

Debug fields include:

- receive time
- Dahua `UTC`, `UTCMS`, `PTS`, `Direction`, `WithSnap`
- corrected event timestamp
- delta from server receive time
- candidate target offsets
- segment file selected
- ffmpeg offset
- raw/detail score, motion score, timing penalty, final score
- baseline candidate used for motion comparison
- confidence threshold and low-confidence flag
- selected candidate

This is required because the Dahua behavior differs by camera and firmware.

### 4. Server-Received-Time Snapshot Anchor

The RTSP burst selector now uses `server_received_ms` as the primary anchor instead of Dahua `UTC+UTCMS`.

Current default candidate offsets around server receive time:

- `[-4000, -2000, -1000, 0, 1000, 2000, 3000, 5000, 7000, 10000, 12000]`

Reason:

Post-patch events `36658` and `36665` proved that waiting for Dahua's own future timestamp still selected frames that missed the person. The server receive timestamp is not perfect, but it is controlled by this system and gives a stable product-level baseline across camera models and firmware.

Dahua `UTC`, `UTCMS`, and `PTS` remain in `_snapshot_debug` for diagnosis only.

### 5. Snapshot Status

Snapshot updates now write `_snapshot_status`.

Current values implemented:

- `ok`: a snapshot file was saved
- `low_confidence`: a snapshot file was saved, but candidate confidence is below threshold
- `missing`: no frame was available from snapManager, RTSP buffer, or live CGI fallback
- `failed`: a frame was available, but saving or extraction failed

Planned values not implemented yet:

- `late`

### 6. snapManager Handling

Existing priority remains:

1. `snapManager` event JPEG, when available
2. RTSP burst candidate selection
3. single RTSP buffer fallback
4. live `snapshot.cgi` fallback

After service restart:

- `DAHUA_CAM01` connected to `snapManager event snapshot stream`.
- `BMA-EAST_DAHUA_CAM01` returned `snapManager HTTP 400` and falls back to RTSP/live paths.

### 7. Event Persistence Is Not Blocked by Snapshot Failure

The current ingester inserts the event first, then attempts snapshot enrichment.

Current flow:

1. Insert event into `events`.
2. Notify dashboard through `pg_notify('new_event')`.
3. Notify media recorder through `pg_notify('event_for_clip')`.
4. Send event to alert engine.
5. Attempt snapshot extraction.
6. Update the event with `_snapshot`, `_snapshot_source`, and `_snapshot_debug` if available.
7. Update `_snapshot_status` as `ok`, `low_confidence`, `missing`, or `failed`.
8. If the first pass is `low_confidence`, `missing`, or `failed`, wait for `clip_done` and try a second-pass clip resolver.

Therefore:

- Missing or incorrect snapshots do not block event insertion.
- Events should still appear in the dashboard even when no image is available.
- Snapshot quality is enrichment, not the source of truth for event existence.

## What Is Not Fixed Yet

### snapManager Reliability

It is not yet proven that `DAHUA_CAM01` will actually deliver JPEG event parts during IVS events, even though the stream connects.

`BMA-EAST_DAHUA_CAM01` currently does not support the current `snapManager` request shape, or rejects it for this model/firmware/config.

### Candidate Scoring

Earlier scoring was image-detail based in the Dahua bounding box area. Live testing at 2026-05-25 20:14-20:16 showed that this could still choose a frame with detailed background instead of the frame with a person.

Current scoring uses:

- motion difference inside the Dahua ROI/bounding box compared with a baseline frame before the event
- a smaller raw image-detail component
- a reduced timing penalty
- a near-best tie-break rule: if several candidates score close to the top score, choose the one closest to `server_received_ms`

This is still not a real person detector. It should improve the Dahua/BMA cases where the person enters the bbox later than `server_received_ms`, but a real person detector remains the stronger long-term fix.

Live post-anchor examples:

| Event | Camera | Time | Result | Finding |
|---|---|---:|---|---|
| `36666` | `DAHUA_CAM01` | 20:14:42 | good | selected frame contained the person |
| `36667` | `BMA-EAST_DAHUA_CAM01` | 20:14:42 | missed | clip contained the person around 20:14:42-43, selected frame was 20:14:40 |
| `36678` | `DAHUA_CAM01` | 20:15:43 | partial/missed | selected frame caught only the right edge of the person |
| `36679` | `BMA-EAST_DAHUA_CAM01` | 20:15:43 | missed | clip contained the person around 20:15:42-44, selected frame was too late/empty |

Conclusion:

The remaining issue is candidate selection, not event ingestion and not missing RTSP buffer data.

Additional live examples at 2026-05-25 20:34:

| Event | Camera | Time | Result | Finding |
|---|---|---:|---|---|
| `36680` | `DAHUA_CAM01` | 20:34:14 | late | `+7000 ms` scored `103.11`, but `0 ms` scored `102.23`; late frame won by only `0.88` |
| `36681` | `BMA-EAST_DAHUA_CAM01` | 20:34:14 | acceptable | selected `+5000 ms`; still usable from operator feedback |
| `36683` | `BMA-EAST_DAHUA_CAM01` | 20:34:21 | missed | score was only `26.39`; should be `low_confidence`, not `ok` |
| `36684` | `DAHUA_CAM01` | 20:34:21 | slightly late | selected `0 ms`; operator reported only a small timing miss |

Changes made from this test:

- raised `_snapshot_debug.confidence_threshold` from `25` to `35`
- added `_snapshot_debug.selection_rule = near-best-closest-anchor`
- added `_snapshot_debug.highest_score` and `_snapshot_debug.near_best_delta`
- selected candidate now uses near-best closest-anchor tie-break instead of always using the numerically highest score

Additional live examples at 2026-05-25 20:42-20:43:

| Event | Camera | Time | Result | Finding |
|---|---|---:|---|---|
| `36685` | `DAHUA_CAM01` | 20:42:58 | acceptable | confidence `107.33`; selected `-1000 ms` |
| `36686` | `BMA-EAST_DAHUA_CAM01` | 20:42:58 | missed | first pass had no `-4000/-2000/-1000/0 ms` candidates; clip contained the person |
| `36692` | `DAHUA_CAM01` | 20:43:15 | good | confidence `108.89`; selected `-1000 ms` |
| `36693` | `BMA-EAST_DAHUA_CAM01` | 20:43:15 | good but low confidence | confidence `26.52`; selected `-2000 ms` |

Changes made from this test:

- Dahua ingester now listens for `clip_done`.
- First-pass `low_confidence`, `missing`, and `failed` Dahua snapshots are reprocessed from `media/<eventId>.mp4`.
- Second-pass clip updates use `_snapshot_source = dahua-clip-resolver`.
- `_snapshot_debug.first_pass` preserves the original RTSP-buffer decision.

Additional live examples at 2026-05-25 21:02-21:03:

| Event | Camera | Time | Result | Finding |
|---|---|---:|---|---|
| `36694` | `DAHUA_CAM01` | 21:02:31 | good | first pass selected `0 ms`, confidence `112.53` |
| `36695` | `BMA-EAST_DAHUA_CAM01` | 21:02:31 | slow | confidence `39.02`, just above the old `35` threshold |
| `36712` | `BMA-EAST_DAHUA_CAM01` | 21:03:04 | usable but borderline | clip resolver selected offset `11s`, confidence `97.14`; first pass confidence was only `27.87` |
| `36713` | `DAHUA_CAM01` | 21:03:05 | missed | confidence `181.55`, but Dahua bbox was `[7256,3488,8184,7744]`; `x2=8184` is effectively at the right edge of the `8192` Dahua coordinate scale |

Changes made from this test:

- raised `_snapshot_debug.confidence_threshold` from `35` to `45`, so borderline first-pass results such as event `36695` become `low_confidence` and are eligible for clip reprocessing.
- added `_snapshot_debug.edge_risk` for first-pass RTSP-buffer selections.
- first-pass selections are now `low_confidence` when the Dahua event bbox touches the outer 2% of the Dahua coordinate plane. This catches cases like event `36713`, where motion score is high because the person is at the edge, but the saved image is already too late.

### Camera-Side Event Timing

Some Dahua events appear to fire when the object is at the edge of the configured IVS region. For `Leave`, a snapshot at the exact event time may already be too late.

For `DAHUA_CAM01`, post-patch testing showed a stronger issue: the vendor timestamp can point to a frame that still misses the subject even after waiting for that future RTSP segment. The camera's CGI event time, RTSP buffer time, and the human-visible crossing moment are not aligned well enough for single-frame selection.

### Per-Camera Tuning

The new defaults are general. `DAHUA_CAM01` and `BMA-EAST_DAHUA_CAM01` may need different offsets.

Supported config hook already exists:

- `dahua_server_frame_offsets_ms`
- `dahua_snapshot_lookback_ms`

However, continuing to tune only Dahua offsets is not a good long-term product strategy. It makes behavior depend on camera model, firmware, IVS rule type, and stream timing quirks.

## Product-Level Principle

Event ingestion and snapshot selection must be independent.

Rules:

- A valid mapped event must be recorded even if there is no snapshot.
- Snapshot extraction must never decide whether an event exists.
- Snapshot extraction may update the event after insert.
- Snapshot extraction may update the event again after the clip is ready.
- Dashboard and LINE should tolerate missing or late snapshots.
- Event completeness is more important than perfect image enrichment.

Recommended event state fields:

- `_snapshot_status`: `ok`, `missing`, `late`, `low_confidence`, `failed`
- `_snapshot_source`: `dahua-event-snapshot`, `dahua-rtsp-buffer-best`, `dahua-rtsp-buffer`, `dahua-cgi-live`, or null
- `_snapshot_debug`: structured diagnostic object

## Standardization Direction

The better long-term design is a vendor-neutral snapshot resolver.

### Vendor Ingester Responsibility

Each vendor ingester should only normalize events into a common shape:

```js
{
  camera_id,
  vendor,
  event_type,
  direction,
  object_class,
  server_received_ms,
  vendor_event_time_ms,
  raw_vendor_json
}
```

The vendor event timestamp is kept as diagnostic data, not necessarily as the snapshot anchor.

### Snapshot Resolver Responsibility

A central resolver should select or generate event snapshots:

```js
resolveEventSnapshot(event, {
  anchor: 'server_received_ms',
  window_ms: [-3000, -1000, 0, 2000, 4000, 6000, 8000, 10000, 12000],
  roi: camera.roi || event.bbox || null
});
```

Recommended default:

- Use `server_received_ms` as the canonical anchor.
- Extract a burst of candidate frames from the RTSP buffer.
- Score/select the best primary snapshot.
- Store candidate/debug metadata.
- Optionally store a contact sheet for operator review.

### Why Server Time

Server receive time is the only timestamp fully controlled by this system.

Dahua examples show that:

- `UTC+UTCMS` can be ahead of server time by about 4 seconds.
- Even after waiting for the matching future frame, the selected image can still miss the person.
- `snapManager` behavior differs by camera: connected on one camera, HTTP 400 on another.

This makes camera timestamp / camera snapshot behavior unsuitable as the universal source of truth.

## Validation Done

Commands run:

```bash
node --check src/ingesters/dahua-cgi.js
./scripts/services.sh restart
./scripts/services.sh status
```

Additional post-patch validation:

- Queried `DAHUA_CAM01` events at 2026-05-25 19:42.
- Confirmed `_snapshot_debug` was stored for event `36658` and `36665`.
- Generated contact sheets from `media/36658.mp4` and `media/36665.mp4`.
- Confirmed the video clips contain the person, while the selected primary snapshots did not.

Current service status after restart:

- `api-server`: 1 instance
- `mqtt-subscriber`: 1 instance
- `media-recorder`: 1 instance
- `hikvision`: 1 instance
- `dahua`: 1 instance
- no duplicate processes

## Validation Still Needed

Next live test:

1. Walk through `DAHUA_CAM01` at least 3 times.
2. Walk through `BMA-EAST_DAHUA_CAM01` at least 4 times.
3. Query events after the test:

```sql
SELECT
  id,
  camera_id,
  event_time AT TIME ZONE 'Asia/Bangkok' AS local_time,
  raw_json->'data'->>'Direction' AS direction,
  raw_json->>'_snapshot' AS snapshot,
  raw_json->>'_snapshot_source' AS source,
  raw_json->'_snapshot_debug' AS debug
FROM events
WHERE camera_id IN ('DAHUA_CAM01', 'BMA-EAST_DAHUA_CAM01')
  AND event_time >= NOW() - INTERVAL '15 minutes'
ORDER BY event_time;
```

4. Inspect whether `_snapshot_source` is:

- `dahua-event-snapshot`: best case, camera supplied JPEG
- `dahua-rtsp-buffer-best`: RTSP burst fallback selected a frame
- `dahua-rtsp-buffer`: single fallback
- `dahua-cgi-live`: last-resort live snapshot

5. If a snapshot still misses the person, inspect `_snapshot_debug.selected` and `_snapshot_debug.candidates`.
6. Compare against the generated clip or contact sheet when available.

## Proposed Next Steps

### Step 1: Live Test the Current Patch

Do not tune more until `_snapshot_debug` data exists from real post-patch events.

### Step 2: If DAHUA_CAM01 Still Misses

Use `_snapshot_debug` to decide one of these:

- add a contact-sheet mode for failed/low-confidence selections
- add real person-detection scoring to choose from the server-anchor candidate frames
- tune `dahua_server_frame_offsets_ms` for only `DAHUA_CAM01` if live data shows a stable offset pattern

After the 19:42 test, increasing future wait alone is not recommended as the next primary fix. The selected frame already followed Dahua's future timestamp and still missed the person.

The server-received-time anchor, wider burst window, motion-difference scoring, near-best tie-break, `low_confidence` status, and second-pass clip resolver have now been implemented. Recommended next fix if snapshots still miss:

- store contact sheet for missed/low-confidence snapshots
- add a lightweight person detector instead of relying on motion/detail scoring

### Step 3: If BMA Still Misses Leave Events

Tune server-anchor offsets for only `BMA-EAST_DAHUA_CAM01`.

Likely candidates:

```json
"dahua_server_frame_offsets_ms": [-3000, -2000, -1000, 0, 1000, 2000, 4000, 6000]
```

### Step 4: Investigate Manufacturer Paths

Known possible Dahua paths to investigate:

- `snapManager.cgi?action=attachFileProc&Flags[0]=Event&Events=[...]`
- alternate `Events=[All]` or model-specific event list
- camera-side event snapshot upload, if firmware supports FTP/HTTP/SD event snapshots
- Dahua SDK / NVR playback path, if CGI cannot provide reliable event JPEGs

### Step 5: Build a Standard Snapshot Resolver

Move snapshot selection out of vendor-specific timing assumptions.

Initial implementation:

- use server receive time as default anchor
- extract frames from a standard candidate window
- store `_snapshot_status`
- store `_snapshot_candidates` or contact sheet when confidence is low
- keep vendor timestamp only as debug/tuning input

Later implementation:

- add lightweight person detection to choose a frame from candidates
- score by person presence/area instead of only image detail in the vendor bbox

## Current Assessment

Superseded by the 2026-05-26 clip-resolver-race fix below. The earlier
server-anchor / motion-scoring patch improved timing and observability, but
the remaining BMA misses were caused by a resolver race, not by another offset
tuning problem.

The main lesson is now clearer:

- Dahua event delivery is good enough for event ingestion.
- Dahua event timing is not good enough to select a single reliable still frame across cameras.
- Product behavior should standardize around event-first ingestion and a vendor-neutral snapshot resolver.

## 2026-05-26 Follow-up: BMA-EAST Clip Resolver Race

Operator feedback:

- `BMA-EAST_DAHUA_CAM01` captured correctly around 07:05, 07:06, and 09:51.
- Many later `BMA-EAST_DAHUA_CAM01` snapshots missed the person, including
  12:01:05, 12:02:02, 12:06:49, 12:09:41, 12:13:54, 12:14:38, and 12:15:51.
- `DAHUA_CAM01` was good overall, except the 09:51 event.

DB/log findings:

- The missed BMA events had `clip_status='done'` and usable `clip_file`, but
  `_snapshot_source` remained `dahua-rtsp-buffer-best` and
  `_snapshot_status='low_confidence'`.
- Logs showed `media-recorder` emitted `clip_done` before the Dahua ingester
  finished writing first-pass `_snapshot_status`.
- The clip resolver saw a blank status and returned early, so it never retried
  after the first-pass snapshot was later marked `low_confidence`.
- `DAHUA_CAM01` 09:51 used `_snapshot_source='dahua-rtsp-buffer'` with
  `_snapshot_status='ok'`. This was a single-frame fallback with no candidate
  scoring, so treating it as final `ok` prevented clip reprocessing.

Code fix:

- `resolveDahuaSnapshotFromClip()` now retries when `_snapshot_status` is not
  written yet, covering the `clip_done` vs first-pass-status race.
- Single RTSP fallback (`dahua-rtsp-buffer`) and live CGI fallback
  (`dahua-cgi-live`) are now marked `low_confidence` when they save a frame,
  because they have no burst/candidate scoring.
- Existing `ok` rows from old unreliable fallback sources are eligible for
  clip resolver reprocessing.

Backfill validation:

- Replayed `clip_done` for event `39026` (`BMA-EAST_DAHUA_CAM01`, 12:15:51)
  and event `37503` (`DAHUA_CAM01`, 09:51). Both updated to
  `_snapshot_source='dahua-clip-resolver'` with status `ok`.
- Replayed eligible Dahua events from 2026-05-26. Most BMA missed snapshots
  changed to `dahua-clip-resolver / ok`.
- Remaining non-ok rows are mostly failed/missing clips around 10:11-10:24
  plus one BMA clip (`38811`, 12:02:02) that remains `low_confidence` after
  clip scoring.

Current assessment after this fix:

- The reported Dahua snapshot problem is considered fixed for the current
  product behavior.
- `BMA-EAST_DAHUA_CAM01` now reaches the clip resolver reliably when first-pass
  RTSP scoring is low confidence or not ready at `clip_done` time.
- `DAHUA_CAM01` keeps good first-pass behavior; old unreliable fallback rows can
  still be repaired by replaying `clip_done`.
- Remaining `missing` rows are tied to failed/no clip generation, not the Dahua
  snapshot resolver path.
- Remaining `low_confidence` rows mean the clip resolver ran but did not find a
  strong candidate; future improvement would be person-detection scoring, not
  more timestamp offset tuning.
