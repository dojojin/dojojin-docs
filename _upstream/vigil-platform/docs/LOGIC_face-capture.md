# LOGIC_face-capture — Face Capture Ingestion & Gallery

> Extracted from DECISIONS.md. Canonical source for Hikvision Face Capture
> multipart parsing, face gallery page design, background image handling,
> and PDPA boundary decisions.
> Parent index: DECISIONS.md
> Last updated: 2026-06-08 · v1.5.0

---

## Multipart Parser & Ingestion (#117)

**#117 — Binary-safe multipart parser + Face Capture ingest**
Face Capture does NOT emit XML `EventNotificationAlert` like Smart Events — it pushes a JSON part (`eventType:'faceCapture'`) plus binary JPEG parts (face crop + full-frame background) in the same multipart/mixed alertStream.

Original string-based parser (`res.setEncoding('utf8')`) would have corrupted binary JPEGs. Rewritten:
- `processMultipart` — binary-safe Buffer parser: walks `--boundary` markers, reads each part's `Content-Length`, slices exact body, handles partial chunks.
- Part routing: `application/xml` → `ingestEvent` (Smart Events); `application/json` → `handleFaceJson`; `image/jpeg` → `handleImagePart`.
- Face-crop pairing: JSON part arrives BEFORE image parts. Each face stashed in `_pendingFaces` keyed by `face.pId`. Matching JPEG (Content-Disposition `name="<pId>"`) resolves it. 8s timer flushes event imageless if crop never arrives.

`ingestFaceEvent` INSERTs `event_type='FaceCapture'`, `rule_name='Face Capture'`. Face attributes flattened into `raw_json`: age, ageGroup, gender, glass, mask, hat, faceExpression, stayDuration, faceScore, faceRect, faceId, pId.

---

## Background Image & Async Race Fix (#119)

**#119 — Face Capture gains full-frame background image, pre-alarm clip, detail modal**

**Background image:** multipart carries TWO JPEGs — face crop (`name="<face.pId>"`) + full-frame background (`name="<targetAttrs.pId>"`). Crop → `raw_json._snapshot` (gallery thumbnail). Background → `raw_json._snapshot_full` (detail modal). Camera's background JPEG chosen over fetching Stream 1 because Face Capture fires at end-of-capture — a Stream-1 grab *then* would catch an empty frame.

**Async-race fix:** first cut called `ingestFaceEvent` without awaiting mid-parse. Synchronous `processMultipart` loop reached the background part before INSERT resolved → background had no event to attach to, dropped. Fix: `_pendingFaces` now collects `faceImg` + `bgImg` onto pending entry. `maybeIngestFace` ingests ONCE both are in hand (or 8s timer fires). One INSERT, both images written + patched in single UPDATE.

> STUBBORN_FACT: Never fire async ingest mid-parse in a multipart loop — it races the rest of the same batch. Collect all parts, then ingest. Decision #119.

**Clip:** `ingestFaceEvent` fires `pg_notify('event_for_clip')` — Face Capture gets pre-alarm clip. `clip_pre_sec` raised 3→15 because Face Capture events land at end-of-capture, needing longer pre-roll.

---

## Face Gallery Page (#118)

**#118 — "ภาพใบหน้า" gallery page — deliberately SEPARATE from incident feed**

Two reasons:
1. Different mental model — demographic browsing vs. security monitoring. Mixing faces into the incident feed makes both confusing.
2. Cleaner PDPA boundary — face = biometric/sensitive. Separate page allows retention + access scope to be drawn around it independently.

`GET /api/faces` — paginated query of `event_type='FaceCapture'`. Filters: gender / mask / camera / age band (`age_min`/`age_max` against `(raw_json->>'age')::int`). `X-Total-Count` header.

**No separate `face_captures` table** — faces stay in `events` (`event_type='FaceCapture'`, attributes in `raw_json`). Materialise a dedicated table only if demographic group-bys get heavy.

**Display spec:**
- Age → 10-year band (`faceAgeBucket`) — show band, NOT raw estimate (face age estimation carries ±5–10y error)
- Gender / expression / wear → Thai-labelled (`FACE_EXPR_TH` map with raw-token fallback for unmapped)
- `stayDuration` ms → sec, rolling to min ≥ 60s
- `faceScore` shown as "%" labelled "คุณภาพ" (image quality, not attribute confidence)
- `faceId` / `faceRect` / `pId` kept in `raw_json` but NOT displayed

**FaceCapture excluded from `/api/events`** — both SQL (`AND event_type <> 'FaceCapture'`) and `new_event` WS handler skip it. Without the filter, face rows would match the Snapshot page's `hasSnapshot=true` query.

---

## Vendor Boundary for Face Analytics

**Dahua Face Detection must NOT route to the face gallery** — Dahua IPC-HFW5541E-ZE does Face Detection (flags "a face is present" with coarse BoundingBox + unreliable demographics) but NOT Face Capture. No reliable crop, no precise timestamp (second-precision LOCAL time, not UTC, `UTCMS` always 0). See LOGIC_camera-ingesters.md #123.

Rule: **"detects a face" ≠ "captures a face"**. Only cameras that crop + push an image with reliable attributes should feed the face gallery.

Newer Dahua WizMind / face-recognition models DO crop + push real face images (similar to Hikvision Face Capture). When one arrives: add `faceCapture` path to `dahua-cgi.js` modelled on `hikvision-isapi.js` binary-safe parser.

> STUBBORN_FACT: Never route Dahua FaceDetection to "ภาพใบหน้า" gallery. GOTCHAS #39.

---

## Related files
- `src/ingesters/hikvision-isapi.js` — Face Capture multipart parser + `ingestFaceEvent`
- `dashboard/dashboard.js` — Face gallery page (`#page-faces`), `openFaceModal`
- `src/api-server.js` — `GET /api/faces` endpoint
- GOTCHAS #39 (Dahua face detection limitations)
