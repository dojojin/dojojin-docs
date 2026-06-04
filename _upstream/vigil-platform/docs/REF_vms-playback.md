# REF_vms-playback — VMS Playback Integration (On-Demand Proxy)

> Plan + API reference for pulling video playback from an external VMS via REST.
> Primary source: **Qognify SGS v7.2** (Gateway Service REST). Same API surface for
> SeeTec / Qognify / Coda Video (HxGN dC3 Video) — lineage of the same product.
> Status: **PLANNED** — no production code written yet.
> Last updated: 2026-06-04 · Author: Prakasit Rochanavipart (Dojo-mAn)

---

## 1. Goal & Storage Model

**Goal:** Allow vigil operators to play back archive video that lives in an external VMS
directly from the vigil dashboard — without exporting or storing the video locally on the
vigil server.

**Primary model: On-demand proxy (ลดพื้นที่จัดเก็บ)**
- vigil stores NO video clips from the VMS
- When an operator opens a clip window, vigil fetches a just-in-time RTSP URL from the VMS,
  proxies it through the server as HLS/MP4, and streams it to the browser
- This eliminates clip storage cost and dependency on vigil's `clips/` directory for
  VMS-originated cameras

**Secondary model (future): Event-triggered pull** — on IVA event, pull a JPEG sequence
from the VMS and store it as a vigil clip. Reduces storage vs. continuous recording on
the VMS, but doesn't eliminate storage entirely. Decide per-customer based on retention policy.

**Trade-off to communicate to customer:** On-demand proxy depends on:
1. Qognify server being online and reachable from vigil server
2. Qognify's own recording retention window — if footage has been overwritten, vigil
   cannot retrieve it

---

## 2. Supported VMS Sources

| VMS | API | Notes |
|---|---|---|
| Qognify VMS 7.x | SGS REST (this doc) | Legacy name; still the primary SGS API |
| SeeTec (pre-Qognify) | Same SGS REST surface | Same codebase |
| Coda Video / HxGN dC3 Video | Same SGS REST surface | Rebranded Qognify; partner portal needed for v8+ delta |
| Future: Milestone, Genetec | Different APIs | Separate adapter modules |

All VMS sources share one **provider interface** (§4). Qognify-SGS is implementation #1.

---

## 3. Qognify SGS API — Key Facts

### Base URL
```
https://<host>:<port>/SeeTecGatewayService/GatewayServiceRest/<method>?<params>
```

The port is labeled "SOAP port" in Qognify config but serves both SOAP and REST.

### ⚠️ Critical implementation notes

| Trap | Detail |
|---|---|
| **Responses are XML, not JSON** | Must parse XML in Node.js (e.g. `fast-xml-parser` or `xml2js`) |
| **HTTP status ≠ error state** | Real error code is `<a:ErrorCode>` in the body — HTTP 200 can be an error |
| **Auth is NOT HTTP Basic** | `userName` and `password` are each **Base64-encoded UTF-8 strings** passed as query params. Base64 contains `+ / =` → must URL-encode after Base64 |
| **HTTPS mandatory** | Qognify boxes commonly ship self-signed certs → Node `https` agent needs `rejectUnauthorized: false` for self-signed, or pin the cert |
| **Session ID required everywhere** | Every API call needs `?sessionID=<id>`. Session expires → must Ping keepalive or reconnect transparently |
| **RTSP URL is 60s valid, single-use** | Request just-in-time, right before handing to player. Never cache RTSP URLs |
| **Transcoding Service required** | RTSP streams require Qognify Transcoding Service to be installed and configured on the VMS server |
| **RTSP on separate port** | RTSP returns on a different port (commonly 9100); this port must be open from vigil server |
| **Browser cannot play RTSP** | vigil is Vanilla JS — must proxy via ffmpeg → HLS/fMP4, or use JPEG frame sequence |
| **Clock drift** | Qognify box and vigil server may have different clocks — use `Request_Archive_Ranges` to confirm footage exists before requesting RTSP URL |

### Authentication flow
```
GET /Connect?userName=<base64_username>&password=<base64_password>&type=3
→ <SessionID>04e1ea7a2a7552f3225abb1b4d776d94</SessionID>

GET /Ping?sessionID=<id>                  ← keepalive every 60s
GET /Request_Version_Info?sessionID=<id>  ← verify SGS version on connect

GET /Disconnect?sessionID=<id>            ← cleanup on shutdown
```

`type=3` = Interface (correct for server-side integration; 1=mobile, 2=webclient).

### Key endpoints for playback

| Endpoint | Purpose |
|---|---|
| `Request_Camera_List` | Get list of cameras with `entityID` + `name` |
| `Request_Archive_Ranges?cameraEntityID=<id>` | Check what recordings exist (Begin/End ms + Type 0=std 1=alarm). **Always call first** |
| `Request_Archive_RTSP?cameraID=<id>&alarmID=-1&timestamp=<ms>&codec=original` | Get RTSP URL for realtime-speed archive playback |
| `Request_Fast_Archive_RTSP?cameraID=<id>&alarmID=-1&timestamp=<ms>&endTimestamp=<ms>&codec=original` | Get RTSP URL for fast (max speed) clip — **use this for clip extraction** |
| `Request_Archive_JPEG?cameraEntityID=<id>&imageWidth=<w>&timestamp=<ms>` | Single Base64 JPEG frame at timestamp — fallback if RTSP unavailable |
| `Request_Archive_JPEG_Stepwise?...&direction=FORWARD` | Step through frames — use for thumbnail strip |

`codec=original` → no transcoding, raw stream as configured in Qognify. Set this when
vigil will proxy through ffmpeg itself. `codec=mjpeg` if you need mjpeg specifically.

### Archive Ranges response
```xml
<ArchiveRange>
  <Begin>1406106294008</Begin>   ← Unix ms
  <End>1406106295958</End>
  <Type>1</Type>                 ← 1 = alarm recording, 0 = standard
</ArchiveRange>
```

### RTSP URL response
```xml
<RtspURL>rtsp://10.0.8.131:9100/video?videosession=a95488d8...</RtspURL>
```
— valid 60 seconds from the moment it was returned, single connection only.

---

## 4. Provider Interface (vendor-neutral)

All VMS adapters implement the same interface so the vigil endpoint doesn't know
which VMS is behind a given camera:

```js
// src/services/vms-playback-provider.js — interface contract (not runnable alone)
//
// Each VMS adapter must export these methods:
//
//   async getCameraList()
//     → [{ vms_id, name }]
//
//   async getArchiveRanges(vms_camera_id, from_ms, to_ms)
//     → [{ begin_ms, end_ms, type }]  or [] if no footage
//
//   async getPlaybackUrl(vms_camera_id, start_ms, end_ms)
//     → { rtsp_url, expires_at_ms } | { jpeg_frames_url }
//
//   async getFrameJpeg(vms_camera_id, timestamp_ms, width_px)
//     → Buffer (JPEG bytes)
//
//   async disconnect()
```

Camera mapping in `cameras-config.json`:
```json
{
  "id": "CAM_ENTRANCE_A",
  "name": "ทางเข้าอาคาร A",
  "vendor": "qognify_sgs",
  "vms_source_id": "4611967493422188592"
}
```
`vms_source_id` = entityID from `Request_Camera_List`. `vendor = 'qognify_sgs'` tells
`vms-playback-provider.js` which adapter to use.

> **STUBBORN_FACT:** `cameras-config.json` is source of truth for camera list
> (decision #86). Add `vms_source_id` there, not only in DB.

---

## 5. Qognify SGS Adapter Code

```js
// src/services/qognify-sgs-adapter.js
// ============================================================
// DojoJin Tech Dashboard — Qognify SGS REST Adapter
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================

const https = require('https');
const { XMLParser } = require('fast-xml-parser'); // npm install fast-xml-parser

const parser = new XMLParser({ ignoreAttributes: false });

// Self-signed cert support — set SGS_REJECT_UNAUTHORIZED=true in prod if cert is valid
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.SGS_REJECT_UNAUTHORIZED !== 'false'
});

const SGS_HOST = process.env.SGS_HOST; // e.g. "192.168.1.100"
const SGS_PORT = process.env.SGS_PORT || '8080';
const SGS_BASE = `https://${SGS_HOST}:${SGS_PORT}/SeeTecGatewayService/GatewayServiceRest`;

let _sessionId = null;
let _pingInterval = null;

// Base64 UTF-8 encode — Base64 chars include + / = which need URL encoding
function b64(str) {
  return encodeURIComponent(Buffer.from(str, 'utf8').toString('base64'));
}

async function _get(path) {
  return new Promise((resolve, reject) => {
    const url = `${SGS_BASE}/${path}`;
    https.get(url, { agent: httpsAgent }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const parsed = parser.parse(data);
        resolve(parsed);
      });
    }).on('error', reject);
  });
}

function _errorCode(parsed) {
  // Walk the parsed XML to find ErrorCode — structure varies by method
  const values = Object.values(parsed);
  const result = values[0];
  const inner = result ? Object.values(result)[0] : null;
  return inner?.['a:ErrorCode'] ?? inner?.ErrorCode ?? -1;
}

async function connect() {
  const user = b64(process.env.SGS_USERNAME);
  const pass = b64(process.env.SGS_PASSWORD);
  const data = await _get(`Connect?userName=${user}&password=${pass}&type=3`);
  const code = _errorCode(data);
  if (code !== 0) throw new Error(`SGS connect failed: code ${code}`);
  const result = data?.ConnectResponse?.ConnectResult;
  _sessionId = result?.['a:SessionID'];
  if (!_sessionId) throw new Error('SGS connect: no sessionID in response');

  // Keepalive every 60s
  _pingInterval = setInterval(async () => {
    try { await _get(`Ping?sessionID=${_sessionId}`); }
    catch (e) { console.error('[SGS] ping failed, reconnecting'); connect().catch(console.error); }
  }, 60_000);

  console.log('[SGS] connected, sessionID:', _sessionId);
}

async function disconnect() {
  clearInterval(_pingInterval);
  if (_sessionId) {
    await _get(`Disconnect?sessionID=${_sessionId}`).catch(() => {});
    _sessionId = null;
  }
}

async function getVersion() {
  const data = await _get(`Request_Version_Info?sessionID=${_sessionId}`);
  const r = data?.Request_Version_InfoResponse?.Request_Version_InfoResult;
  return { version: r?.['a:Version'], patch: r?.['a:Patch'] };
}

async function getCameraList() {
  const data = await _get(`Request_Camera_List?sessionID=${_sessionId}`);
  const r = data?.Request_Camera_ListResponse?.Request_Camera_ListResult;
  const entities = [].concat(r?.['a:Entity']?.['a:EntityInfo'] || []);
  return entities.map(e => ({
    vms_id: String(e['a:EntityID']),
    name: e['a:EntityName']
  }));
}

async function getArchiveRanges(vms_camera_id) {
  const data = await _get(
    `Request_Archive_Ranges?sessionID=${_sessionId}&cameraEntityID=${vms_camera_id}`
  );
  const r = data?.Request_Archive_RangesResponse?.Request_Archive_RangesResult;
  const ranges = [].concat(r?.['a:ArchiveRange']?.['a:ArchiveRange'] || []);
  return ranges.map(a => ({
    begin_ms: Number(a['a:Begin']),
    end_ms: Number(a['a:End']),
    type: Number(a['a:Type']) // 0=standard 1=alarm
  }));
}

async function getPlaybackUrl(vms_camera_id, start_ms, end_ms) {
  // Use Fast_Archive_RTSP when we have a defined end time (clip extraction)
  const method = end_ms
    ? `Request_Fast_Archive_RTSP?sessionID=${_sessionId}&cameraID=${vms_camera_id}&alarmID=-1&timestamp=${start_ms}&endTimestamp=${end_ms}&codec=original&width=0&height=0`
    : `Request_Archive_RTSP?sessionID=${_sessionId}&cameraID=${vms_camera_id}&alarmID=-1&timestamp=${start_ms}&codec=original&fps=25&width=0&height=0`;

  const data = await _get(method);
  const key = end_ms ? 'Request_Fast_Archive_RTSPResponse' : 'Request_Archive_RTSPResponse';
  const innerKey = end_ms ? 'Request_Fast_Archive_RTSPResult' : 'Request_Archive_RTSPResult';
  const r = data?.[key]?.[innerKey];
  const code = Number(r?.['a:ErrorCode'] ?? -1);
  if (code !== 0) throw new Error(`SGS getPlaybackUrl: code ${code}`);
  return {
    rtsp_url: r['a:RtspURL'],
    expires_at_ms: Date.now() + 55_000 // 60s valid, use 55s safety margin
  };
}

async function getFrameJpeg(vms_camera_id, timestamp_ms, width_px = 640) {
  const data = await _get(
    `Request_Archive_JPEG?sessionID=${_sessionId}&cameraEntityID=${vms_camera_id}&imageWidth=${width_px}&timestamp=${timestamp_ms}`
  );
  const r = data?.Request_Archive_JPEGResponse?.Request_Archive_JPEGResult;
  const b64img = r?.['a:Camera']?.['a:Thumbnail'];
  if (!b64img) return null;
  return Buffer.from(b64img, 'base64');
}

module.exports = { connect, disconnect, getVersion, getCameraList, getArchiveRanges, getPlaybackUrl, getFrameJpeg };
```

**Environment variables to add to `.env`:**
```
# VMS Playback — Qognify SGS
SGS_HOST=192.168.1.100
SGS_PORT=8080
SGS_USERNAME=vigil_api_user
SGS_PASSWORD=changeme
SGS_REJECT_UNAUTHORIZED=false  # false for self-signed certs (common in on-prem)
```

**Dependency to add:**
```bash
npm install fast-xml-parser
```

---

## 6. API Endpoints (vigil-side)

New endpoints to add to `api-server.js`:

```
GET  /api/vms/cameras                        → list cameras with vms_source_id
GET  /api/vms/archive-ranges/:camera_id      → check if footage exists
GET  /api/vms/playback/:camera_id?from=<ms>&to=<ms>   → start playback proxy session
GET  /api/vms/frame/:camera_id?ts=<ms>       → single JPEG frame (thumbnail)
```

The `/api/vms/playback` endpoint workflow:
1. `getArchiveRanges()` → confirm footage exists in `[from, to]`
2. `getPlaybackUrl(camera_id, from_ms, to_ms)` → RTSP URL
3. Spawn `ffmpeg -i <rtsp_url> -c:v libx264 -f hls` → HLS segments in `/tmp/vigil-hls/<session>/`
4. Return `{ hls_url: "/api/vms/hls/<session>/index.m3u8" }` to client
5. Cleanup HLS after 5 minutes of inactivity

**Fallback (no ffmpeg / no Transcoding Service):** return JPEG frames as a timelapse via
`/api/vms/frame/:camera_id?ts=<ms>` — dashboard polls with stepwise timestamps.

> **Note:** ffmpeg must be installed on the vigil server for HLS proxying.
> Check availability: `which ffmpeg`. For JPEG-only fallback, no ffmpeg needed.

---

## 7. Implementation Phases

### Phase 0 — Prerequisites & Connectivity (1–2 days)

**Goal:** Verify SGS is reachable and we can authenticate.

1. Confirm SGS is installed and running on the Qognify server (VersatileApplications module)
2. Create dedicated Cayuga API user — minimum permissions: camera read + archive access
3. Note the SGS port from the Qognify VersatileApplications config (`settings.ini`)
4. Test manually:
   ```bash
   curl -k "https://<host>:<port>/SeeTecGatewayService/GatewayServiceRest/Connect?\
   userName=$(echo -n 'vigil_api' | base64)&password=$(echo -n 'pass' | base64)&type=3"
   ```
5. Call `Request_Version_Info` → confirm version (v7.x expected)
6. Call `Request_Camera_List` → map entityIDs to vigil `camera_id`s
7. Add `vms_source_id` to `cameras-config.json` for each Qognify camera
8. Verify RTSP port (9100) is open: `nc -zv <host> 9100`
9. Verify Transcoding Service is running in Qognify

**Prerequisites checklist:**
- [ ] SGS service running
- [ ] Dedicated API user created + tested
- [ ] Network path: vigil server → SGS HTTPS port
- [ ] Network path: vigil server → RTSP port (9100 or custom)
- [ ] Transcoding Service configured in Qognify
- [ ] Camera entityID ↔ vigil camera_id mapping table ready

### Phase 1 — SGS Adapter Module (2–3 days)

**Goal:** Node.js module that wraps SGS calls.

Files:
- `src/services/qognify-sgs-adapter.js` — adapter (code in §5)
- `src/services/vms-playback-provider.js` — provider router (picks adapter based on `vendor` field)

Tasks:
- [ ] Install `fast-xml-parser`
- [ ] Implement connect / ping keepalive / disconnect
- [ ] Implement `getCameraList()` — smoke test against real SGS
- [ ] Implement `getArchiveRanges()` — verify recordings exist for test window
- [ ] Implement `getFrameJpeg()` — simplest path; verify JPEG bytes come back
- [ ] Unit test with a real Qognify server (manual cURL script in `scripts/sgs-test.sh`)

No changes to `api-server.js` in this phase. Adapter only.

### Phase 2 — JPEG Frame Fallback Path (1–2 days)

**Goal:** Operator can see archive frames from Qognify in the dashboard
without RTSP/ffmpeg complexity.

Endpoints: `GET /api/vms/archive-ranges/:camera_id` + `GET /api/vms/frame/:camera_id?ts=<ms>`

UI: On the Events page, for cameras with `vms_source_id`:
- Show "ดูวีดีโอจาก VMS" button on event rows
- Opens modal → first frame shown → prev/next frame navigation (stepwise)
- This works without ffmpeg — pure JPEG polling

DB migration: add `vms_source_id TEXT` column to `cameras` table (migration 039 or next
available, idempotent: `ADD COLUMN IF NOT EXISTS`). Also write to `cameras-config.json`
(dual-write pattern, same as `cameras.paused`).

### Phase 3 — RTSP → HLS Proxy Path (3–5 days)

**Goal:** Full video playback with audio in the dashboard browser.

Tasks:
- [ ] Confirm ffmpeg is available on vigil server (`apt install ffmpeg` or brew)
- [ ] Implement `/api/vms/playback/:camera_id?from=<ms>&to=<ms>`
  - `getPlaybackUrl()` → RTSP URL (just-in-time)
  - Spawn `ffmpeg -i <rtsp> -c:v copy -f hls /tmp/vigil-hls/<uuid>/index.m3u8`
  - Return `{ hls_url }` to client
  - Serve `/api/vms/hls/<uuid>/*.m3u8` + `*.ts` as static files
  - Auto-cleanup HLS segments after 5 min idle
- [ ] Dashboard: add `<video>` player pointing to HLS URL (HTML5 native HLS on Safari/iOS;
  use `hls.js` for Chrome/Firefox — already a small script, no CDN, self-host)
- [ ] Responsive ≤768px (WA#2-B)

**Gotcha:** RTSP URL expires 60s → vigil must call `getPlaybackUrl()` fresh each time the
user starts playback, never serve a cached URL.

### Phase 4 — Settings & Operator UI (1–2 days)

**Goal:** Operator can configure SGS connection from Settings page.

- Settings › กล้อง sub-tab: "VMS Playback Source" section
  - SGS host/port, username/password (masked)
  - Test Connection button → calls `getVersion()` + shows version
  - Per-camera: VMS Entity ID field (or auto-map from camera name)
- Auth: admin only (same pattern as other credential settings)
- Credentials stored in `system_settings` table (same as other server config)

### Phase 5 — Event-triggered Clip Pull (optional, future)

> Decide after Phase 3 is stable and customer requests it.

When event INSERT fires (pg_notify), optionally:
1. Check if camera has `vms_source_id`
2. `getArchiveRanges()` for `[event_time - 30s, event_time + 60s]`
3. If footage exists: `getPlaybackUrl()` → ffmpeg → mp4 → store as vigil clip
4. Reduces need to keep clips in Qognify long-term

Trade-off: shifts storage to vigil server; only worthwhile if Qognify retention is very short
(< 24h) and vigil has more disk.

---

## 8. Known Gaps & Open Questions

| Gap | Notes |
|---|---|
| ffmpeg must be pre-installed | Check `which ffmpeg` in Phase 0; JPEG fallback available if absent |
| Qognify Transcoding Service required for RTSP | Verify in Phase 0; without it `getPlaybackUrl()` returns empty RTSP URL |
| HLS.js for Chrome/Firefox | Self-host `hls.js` (MIT license, ~300KB) — no CDN (PDPA/offline) |
| RTSP port on a different host | If Qognify NVR is multi-server, RTSP host in URL may differ from SGS host |
| SGS version vs. Coda Video 9.x | SGS REST surface is stable; confirm with customer's actual version in Phase 0 |
| Per-customer VMS credentials | One adapter instance per VMS server; if customer has multiple VMS → `vms_server_id` field needed |

---

## 9. Storage Reduction Summary

| Scenario | vigil storage | Qognify storage | Result |
|---|---|---|---|
| Current (vigil clips only) | Local clips 30d | Full recording | Two copies |
| **On-demand proxy (Phase 1–3)** | **No clips** | Full recording | Qognify is source of truth |
| Event-triggered pull (Phase 5) | Event clips only | Can shorten retention to 7d | Reduced overall |
| Full on-prem archive | Full clips | Can disable recording | Maximum reduction |

Recommend **on-demand proxy** as the default for v1 — simplest, no migration risk.

---

*REF_vms-playback.md · DojoJin Tech Dashboard · 2026-06-04*
