// ============================================================
// Vigil Platform — ONVIF Metadata Track (RTSP, metadata-only)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Keeps a short in-memory history of object bounding boxes streamed by the
// camera's ONVIF metadata track, so a snapshot taken at T can be cropped to
// the object that actually triggered the event (MQTT carries @ObjectId but
// no geometry).
//
// Only the `application/vnd.onvif.metadata` track is SETUP — the video track
// is never requested, so this is not a VMS and pulls no H.264. Measured on
// vss3 / BH5100i FW 9.40 (2026-08-19, 5 min): 2.49 KB/s, 0.20% of one core,
// ~15 Hz sampling per tracked object.
//
// Time basis: samples are keyed on edge Date.now() at RTP arrival, NOT the
// camera's <tt:Frame UtcTime>. The consumer's T_snap is an edge-clock instant,
// so keying on the same clock makes camera↔edge skew drop out by construction
// (cf. GOTCHAS #103 — a UtcTime-vs-Date.now() comparison broke once already on
// a camera running 3.5h behind). The observed delta is still tracked and
// exposed as skewMs for diagnostics.
// ============================================================
'use strict';

const net = require('net');
const { parseChallenge, buildDigestHeader } = require('./digestAuth');

const RTSP_PORT      = 554;
const RETENTION_MS   = 5000;   // how long a track's samples stay queryable
const LOOKUP_TOL_MS  = 1000;   // reject a match further than this from T_snap
const KEEPALIVE_MS   = 30000;
const BACKOFF_MIN_MS = 2000;
const BACKOFF_MAX_MS = 60000;
const IDLE_TIMEOUT_MS = 120000; // no metadata at all for this long → reconnect

// ---------- pure helpers (exported for the self-check) ----------

// Picks the control URL of the ONVIF metadata media section out of an SDP.
// Returns null when the camera advertises no such track — the caller must
// treat that as "this camera can't do it" rather than guessing a URL.
function metaControlUrl(sdp, baseUrl) {
  const sections = sdp.split(/^m=/m).slice(1);
  for (const s of sections) {
    if (!/^application\b/.test(s)) continue;
    if (!/vnd\.onvif\.metadata/i.test(s)) continue;
    const c = s.match(/^a=control:\s*(\S+)/m);
    if (!c) continue;
    const ctrl = c[1];
    if (/^rtsp:\/\//i.test(ctrl)) return ctrl;
    if (ctrl === '*') return baseUrl;
    // Bosch returns a full query string here; anything relative joins onto base.
    return baseUrl.includes('?') && ctrl.startsWith('&')
      ? baseUrl + ctrl
      : baseUrl.replace(/\/?$/, '/') + ctrl.replace(/^\//, '');
  }
  return null;
}

// One ONVIF MetadataStream document → [{ objectId, uuid, type, box, frameUtc }].
// Regex rather than an XML parser: the payload shape is fixed, it arrives ~2/s,
// and src/ has 12 dependencies — not worth a 13th. Objects without geometry
// (appearance-only updates) are skipped.
function parseMetadata(xml) {
  const out = [];
  const frames = xml.split(/<[a-z]+:Frame\b/i).slice(1);
  for (const f of frames) {
    const ft = f.match(/UtcTime="([^"]+)"/);
    const frameUtc = ft ? Date.parse(ft[1]) : null;
    const objRe = /<[a-z]+:Object\s+ObjectId="(\d+)"(?:\s+UUID="([^"]*)")?([\s\S]*?)<\/[a-z]+:Object>/gi;
    let m;
    while ((m = objRe.exec(f))) {
      const [, id, uuid, body] = m;
      const bb = body.match(/<[a-z]+:BoundingBox\s+bottom="([-\d.]+)"\s+top="([-\d.]+)"\s+right="([-\d.]+)"\s+left="([-\d.]+)"/i);
      if (!bb) continue;
      const ty = body.match(/<[a-z]+:Type[^>]*>([^<]+)<\/[a-z]+:Type>/i);
      // Speed and Appearance/@velocity carry the same number on this firmware;
      // read either. The MQTT event has one of these, taken at the moment the
      // rule fired — here there is one per frame, for as long as the object is
      // tracked, which is what makes an average possible at all.
      const sp = body.match(/<[a-z]+:Speed>([-\d.]+)<\/[a-z]+:Speed>/i)
              || body.match(/<[a-z]+:Appearance[^>]*\svelocity="([-\d.]+)"/i);
      // area is the camera's own size figure for the object. Unitless and only
      // comparable against other objects on the same camera at roughly the same
      // distance — useful as "bigger than that one", not as square metres.
      const ar = body.match(/<[a-z]+:Appearance[^>]*\sarea="([-\d.]+)"/i);
      // ── กลุ่มสีของวัตถุ (2026-08-26) ──────────────────────────────────────
      // กล้อง Bosch แนบสีมาในสตรีมนี้ทุกเฟรม แต่ **ไม่แนบไปกับ event MQTT** บน
      // firmware 9.80 (กล้อง 02: 0 จาก 4,335 ครั้ง) ขณะที่ 9.82 แนบมาให้ 100%
      // เดิมเรา parse ทิ้ง แล้วไปพึ่ง Appearance.Color ของฝั่ง event อย่างเดียว
      // ผลคือหน้า "ข้อมูลวัตถุ" กับแถบ "สีของวัตถุ" ว่างเปล่าสำหรับกล้องที่ยังไม่ได้อัป
      //
      // เก็บดิบเป็น XYZ + weight ตามที่กล้องส่งมา — การแปลงเป็นชื่อสีทำที่ central
      // ด้วย xyzToColorName ตัวเดียวกับฝั่ง event จะได้ไม่มีสองมาตรฐาน
      const colors = [];
      const ccRe = /<[a-z]+:ColorCluster>\s*<[a-z]+:Color\s+X="([-\d.]+)"\s+Y="([-\d.]+)"\s+Z="([-\d.]+)"\s*\/>\s*<[a-z]+:Weight>([-\d.]+)<\/[a-z]+:Weight>/gi;
      let cm;
      while ((cm = ccRe.exec(body))) {
        colors.push({ x: +cm[1], y: +cm[2], z: +cm[3], w: +cm[4] });
      }
      out.push({
        objectId: Number(id),
        uuid: uuid || null,
        type: ty ? ty[1].trim() : null,
        speed: sp ? Number(sp[1]) : null,
        area: ar ? Number(ar[1]) : null,
        colors: colors.length ? colors : null,
        frameUtc,
        // Raw ONVIF normalised coords: origin at frame centre, y up, nominally
        // [-1,1] — but the camera extrapolates past the edge for objects that
        // are leaving (measured min -1.47 / max 1.17). Clamping is the
        // consumer's job, at the point it knows the pixel dimensions.
        box: { bottom: +bb[1], top: +bb[2], right: +bb[3], left: +bb[4] },
      });
    }
  }
  return out;
}

// ONVIF normalised box → sharp extract region, or null when the result is not
// worth cropping. The camera extrapolates coordinates past the frame edge for
// objects that are leaving (measured -1.47 … 1.17 on vss3), so clamping comes
// first and the size floor is applied to what actually survives it — a bike
// three-quarters out of frame yields a sliver, and no crop beats a sliver.
//
// The floor is on AREA, not on each side. Requiring both sides ≥ minPx threw
// away 100 crops in one day on this camera, 94 of them tall and narrow —
// 36x100, 35x87, 36x74 — which is simply what a person or a rider looks like
// from a camera mounted above a road. Their median area was 2,800 px, larger
// than the 2,128 the camera's own thumbnail gives, so they were the better
// image being discarded for having the wrong shape. A short side floor at half
// minPx still rejects genuine slivers.
function boxToPixels(box, w, h, { pad = 0.12, minPx = 40 } = {}) {
  if (!box || !(w > 0) || !(h > 0)) return null;
  // x runs left→right in [-1,1]; y runs bottom→top, so top maps to the smaller
  // pixel row. Both are half-open against the frame, hence the /2 scaling.
  let x0 = (box.left + 1) / 2 * w;
  let x1 = (box.right + 1) / 2 * w;
  let y0 = (1 - box.top) / 2 * h;
  let y1 = (1 - box.bottom) / 2 * h;
  const padX = (x1 - x0) * pad, padY = (y1 - y0) * pad;
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;

  const left = Math.max(0, Math.round(x0));
  const top = Math.max(0, Math.round(y0));
  const right = Math.min(w, Math.round(x1));
  const bottom = Math.min(h, Math.round(y1));
  const width = right - left, height = bottom - top;
  if (width * height < minPx * minPx) return null;
  if (Math.min(width, height) < minPx / 2) return null;
  return { left, top, width, height };
}

// ONVIF normalised box → {x, y, w, h} as fractions of the frame, y measured
// downward from the top. That is the convention the dashboard's SVG overlay
// already uses (viewBox "0 0 1 1"), so a stored box needs no conversion to be
// drawn, and none to be scaled for a burn-in either.
//
// Kept separate from boxToPixels: this describes where the OBJECT is, while
// that one answers where to CUT, which carries padding and a size floor. The
// frame should sit on the object, not on the crop rectangle.
function boxToFraction(box) {
  if (!box) return null;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const x0 = clamp((box.left + 1) / 2);
  const x1 = clamp((box.right + 1) / 2);
  const y0 = clamp((1 - box.top) / 2);
  const y1 = clamp((1 - box.bottom) / 2);
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0) || !(h > 0)) return null;
  const r = (v) => Math.round(v * 10000) / 10000;
  return { x: r(x0), y: r(y0), w: r(w), h: r(h) };
}

// Direction of travel as an angle on the PICTURE, not on the ground: 0 points
// right, 90 up, measured between the first and last box centre in the ring.
// Deliberately not a compass bearing — the camera is not north-aligned and has
// no geometric reference, so a degree figure against north would be a number
// with no meaning. An angle over the image can be drawn as an arrow the viewer
// matches against the scene in front of them.
//
// A stationary object still jitters, and the angle of jitter is noise. Below
// MIN_TRAVEL of the frame there is no direction worth reporting.
const MIN_TRAVEL = 0.04;
function headingOf(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const mid = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
  const a = mid(samples[0].box), b = mid(samples[samples.length - 1].box);
  const dx = b.x - a.x, dy = b.y - a.y;   // ONVIF y already points up
  if (Math.hypot(dx, dy) < MIN_TRAVEL) return null;
  return Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360);
}

// The path the object took, as fractions of the frame with y downward — the
// same convention as boxToFraction, so the trail and the box land in the same
// coordinate space and need no separate conversion on either consumer.
//
// The camera does not send a trail: there is no Trajectory or Path element
// anywhere in the metadata (28 element types observed, none of them a track).
// The thin green line in Bosch's own VCA overlay is the camera drawing its own
// position history. We hold the same history at ~15Hz, so we can draw it too —
// and we can decide how it looks, which is the point.
//
// Capped at TRAIL_MAX evenly-sampled points: five seconds at 15Hz is ~75
// positions and a 300px overlay cannot show that many distinctly. Sampling
// evenly keeps the shape of the path; taking the first N would keep only its
// beginning. The newest position is always included — that is the end that has
// to meet the box.
const TRAIL_MAX = 20;
function trailOf(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const pt = (s) => ({
    x: Math.min(1, Math.max(0, (s.box.left + s.box.right) / 2 / 2 + 0.5)),
    y: Math.min(1, Math.max(0, (1 - (s.box.top + s.box.bottom) / 2) / 2)),
  });
  const step = samples.length > TRAIL_MAX ? (samples.length - 1) / (TRAIL_MAX - 1) : 1;
  const out = [];
  for (let i = 0; i < samples.length; i += step) out.push(pt(samples[Math.round(i)]));
  const last = pt(samples[samples.length - 1]);
  if (!out.length || out[out.length - 1].x !== last.x || out[out.length - 1].y !== last.y) out.push(last);
  const r = (v) => Math.round(v * 1000) / 1000;
  return out.map((p) => [r(p.x), r(p.y)]);
}

// How far the object actually travelled between the frame and the sample used
// to place it, in metres — the thing that decides whether a box lands on its
// object, where the time gap only stands in for it.
//
// Both inputs are the camera's own: speed in m/s from its calibration, area in
// m² from the same. √area is the object's characteristic width, so the budget
// scales with what is being cropped: half a metre of drift ruins a pedestrian
// and barely dents a truck. Returns null when speed is unknown, which the
// caller must treat as "cannot judge" rather than "fine".
function driftMetres(hit) {
  if (!hit || !Number.isFinite(hit.speed) || hit.speed <= 0) return null;
  return (hit.dtMs / 1000) * hit.speed;
}

// ---------- ring buffer ----------

class TrackStore {
  constructor(retentionMs = RETENTION_MS) {
    this.retentionMs = retentionMs;
    this.tracks = new Map(); // objectId → [{ t, box, type, frameUtc }]
  }

  add(t, samples) {
    for (const s of samples) {
      let arr = this.tracks.get(s.objectId);
      if (!arr) this.tracks.set(s.objectId, (arr = []));
      arr.push({ t, box: s.box, type: s.type, speed: s.speed, area: s.area,
                 colors: s.colors, frameUtc: s.frameUtc });
    }
    this.prune(t);
  }

  prune(now) {
    const cutoff = now - this.retentionMs;
    for (const [id, arr] of this.tracks) {
      while (arr.length && arr[0].t < cutoff) arr.shift();
      if (!arr.length) this.tracks.delete(id);
    }
  }

  // Nearest sample of `objectId` to edge-clock instant `tMs`.
  // null when the object was never seen, or has already aged out — which is a
  // real answer ("the object had left"), not an error.
  lookup(objectId, tMs, tolMs = LOOKUP_TOL_MS) {
    const arr = this.tracks.get(Number(objectId));
    if (!arr || !arr.length) return null;
    let best = null, bestDt = Infinity;
    for (const s of arr) {
      const dt = Math.abs(s.t - tMs);
      if (dt < bestDt) { bestDt = dt; best = s; }
    }
    if (!best || bestDt > tolMs) return null;
    // Averaged over the samples still in the ring, i.e. up to RETENTION_MS of
    // the object's track ending at the lookup — in practice "how fast it was
    // moving while it crossed", not a single instant. Reported alongside the
    // instantaneous value rather than replacing it, because they answer
    // different questions.
    const sp = arr.map((x) => x.speed).filter((v) => Number.isFinite(v) && v > 0);
    const avgSpeed = sp.length ? sp.reduce((a, b) => a + b, 0) / sp.length : null;
    // Whether the track actually spans the instant asked about. A nearest-sample
    // match does not prove the object was there: one that entered the scene
    // afterwards has all its samples on one side, and if it happens to be
    // standing still the drift test below waves it through — onto a frame it
    // was never in. Bracketing is what distinguishes "it was here" from "it is
    // here now".
    const bracketed = arr[0].t <= tMs && arr[arr.length - 1].t >= tMs;
    return {
      box: best.box, type: best.type, dtMs: bestDt, samples: arr.length, bracketed,
      speed: best.speed, avgSpeed, speedSamples: sp.length,
      area: Number.isFinite(best.area) ? best.area : null,
        // สีมาจาก sample เดียวกับ box/speed โดยตั้งใจ — ถ้าเฉลี่ยข้ามเฟรมจะได้สี
        // ของช่วงที่วัตถุยังเข้าเฟรมไม่เต็มปนมาด้วย เพี้ยนกว่าใช้เฟรมเดียวที่ตรงเวลา
        colors: Array.isArray(best.colors) ? best.colors : null,
      heading: headingOf(arr),
      speedSeries: sp,
      trail: trailOf(arr),
    };
  }
}

// ---------- RTSP client ----------

class MetaTrackClient {
  constructor(cameraId, cam, log = console) {
    this.cameraId = cameraId;
    this.cam = cam;
    this.log = log;
    this.store = new TrackStore();
    this.stats = { packets: 0, docs: 0, objects: 0, reconnects: 0, lastDocAt: 0, skewMs: null, bytes: 0 };
    this.stopped = false;
    this._backoff = BACKOFF_MIN_MS;
    this._sock = null;
    this._timers = [];
  }

  start() { this.stopped = false; this._connect(); return this; }

  stop() {
    this.stopped = true;
    this._clearTimers();
    if (this._sock && !this._sock.destroyed) {
      // Explicit TEARDOWN: some firmware only reaps sessions on timeout, and a
      // reconnect loop that leaks them will eventually be refused.
      try { this._send('TEARDOWN', this._baseUrl); } catch { /* closing anyway */ }
      this._sock.end();
    }
    this._sock = null;
  }

  lookup(objectId, tMs, tolMs) { return this.store.lookup(objectId, tMs, tolMs); }

  get baseUrl() {
    // Bosch rtsp_tunnel: p=0 (no transcode), line=1 vcd=2 (VCA line 1). inst=1
    // is the first encoder instance. Only the metadata track gets SETUP below.
    return `rtsp://${this.cam.ip_address}/rtsp_tunnel?p=0&line=1&inst=1&vcd=2`;
  }

  _clearTimers() { for (const t of this._timers) clearInterval(t) || clearTimeout(t); this._timers = []; }

  _retry(why) {
    if (this.stopped) return;
    this._clearTimers();
    if (this._sock) { this._sock.removeAllListeners(); this._sock.destroy(); this._sock = null; }
    const wait = this._backoff;
    this._backoff = Math.min(this._backoff * 2, BACKOFF_MAX_MS);
    this.stats.reconnects++;
    this.log.warn(`[meta] ${this.cameraId} ${why} — retry in ${wait / 1000}s`);
    this._timers.push(setTimeout(() => this._connect(), wait));
  }

  _send(method, uri, extra = '') {
    this._cseq = (this._cseq || 0) + 1;
    let h = `${method} ${uri} RTSP/1.0\r\nCSeq: ${this._cseq}\r\n`;
    if (this._challenge) {
      h += 'Authorization: ' + buildDigestHeader(
        this.cam.username, this.cam.password, method, uri, this._challenge,
        String(this._cseq).padStart(8, '0')) + '\r\n';
    }
    if (this._session) h += `Session: ${this._session}\r\n`;
    h += extra + '\r\n';
    this._sock.write(h);
  }

  _connect() {
    this._baseUrl = this.baseUrl;
    this._cseq = 0; this._session = null; this._challenge = null;
    this._stage = 'describe';
    this._rx = Buffer.alloc(0);
    this._frag = [];

    const sock = net.connect(RTSP_PORT, this.cam.ip_address);
    this._sock = sock;
    sock.setTimeout(15000);
    sock.on('timeout', () => this._retry('socket idle'));
    sock.on('error', (e) => this._retry(`socket error: ${e.message}`));
    sock.on('close', () => { if (!this.stopped && this._stage !== 'retrying') this._retry('connection closed'); });
    sock.on('connect', () => this._send('DESCRIBE', this._baseUrl, 'Accept: application/sdp\r\n'));
    sock.on('data', (c) => this._onData(c));
  }

  _onData(chunk) {
    this.stats.bytes += chunk.length;
    this._rx = Buffer.concat([this._rx, chunk]);
    for (;;) {
      if (!this._rx.length) return;
      if (this._rx[0] === 0x24) { if (!this._takeInterleaved()) return; continue; }
      if (!this._takeResponse()) return;
    }
  }

  // "$" <channel> <len:16> <rtp packet>
  _takeInterleaved() {
    if (this._rx.length < 4) return false;
    const ch = this._rx[1], len = this._rx.readUInt16BE(2);
    if (this._rx.length < 4 + len) return false;
    const pkt = this._rx.subarray(4, 4 + len);
    this._rx = this._rx.subarray(4 + len);
    if (ch === this._rtpChannel) this._onRtp(pkt);
    return true;
  }

  _takeResponse() {
    const s = this._rx.toString('binary');
    const end = s.indexOf('\r\n\r\n');
    if (end < 0) return false;
    const head = s.slice(0, end);
    const clen = /Content-Length:\s*(\d+)/i.exec(head);
    const bodyLen = clen ? Number(clen[1]) : 0;
    if (this._rx.length < end + 4 + bodyLen) return false;
    const body = this._rx.subarray(end + 4, end + 4 + bodyLen).toString('utf8');
    this._rx = this._rx.subarray(end + 4 + bodyLen);
    this._onResponse(head, body);
    return true;
  }

  _onResponse(head, body) {
    const status = Number((head.match(/^RTSP\/1\.0 (\d+)/) || [])[1] || 0);

    if (status === 401 && !this._challenge) {
      const wa = (head.match(/WWW-Authenticate:\s*(.+)/i) || [])[1] || '';
      if (!/digest/i.test(wa)) return this._retry('camera wants a non-digest auth scheme');
      this._challenge = parseChallenge(wa);
      return this._send('DESCRIBE', this._baseUrl, 'Accept: application/sdp\r\n');
    }
    if (status !== 200) return this._retry(`${this._stage} → RTSP ${status}`);

    if (this._stage === 'describe') {
      const ctrl = metaControlUrl(body, this._baseUrl);
      if (!ctrl) return this._retry('SDP advertises no vnd.onvif.metadata track');
      const pt = body.match(/a=rtpmap:(\d+)\s+vnd\.onvif\.metadata/i);
      this._payloadType = pt ? Number(pt[1]) : null;
      this._metaUrl = ctrl;
      this._stage = 'setup';
      return this._send('SETUP', ctrl, 'Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n');
    }

    if (this._stage === 'setup') {
      this._session = ((head.match(/Session:\s*([^;\r\n]+)/i) || [])[1] || '').trim();
      const il = head.match(/interleaved=(\d+)-(\d+)/i);
      this._rtpChannel = il ? Number(il[1]) : 0;
      this._stage = 'play';
      return this._send('PLAY', this._baseUrl, 'Range: npt=0.000-\r\n');
    }

    if (this._stage === 'play') {
      this._stage = 'streaming';
      this._backoff = BACKOFF_MIN_MS;
      this.stats.lastDocAt = Date.now();
      this.log.log(`[meta] ${this.cameraId} streaming (session ${this._session}, ch ${this._rtpChannel})`);
      this._timers.push(setInterval(() => {
        if (this._sock && !this._sock.destroyed) this._send('OPTIONS', this._baseUrl);
      }, KEEPALIVE_MS));
      this._timers.push(setInterval(() => {
        if (Date.now() - this.stats.lastDocAt > IDLE_TIMEOUT_MS) this._retry('no metadata received');
      }, IDLE_TIMEOUT_MS / 2));
    }
  }

  _onRtp(pkt) {
    if (pkt.length < 12) return;
    const cc = pkt[0] & 0x0f, ext = pkt[0] & 0x10, marker = pkt[1] & 0x80;
    if (this._payloadType != null && (pkt[1] & 0x7f) !== this._payloadType) return;
    let off = 12 + cc * 4;
    if (ext) {
      if (pkt.length < off + 4) return;
      off += 4 + pkt.readUInt16BE(off + 2) * 4;
    }
    if (off >= pkt.length) return;
    this.stats.packets++;
    this._frag.push(pkt.subarray(off));
    // Metadata documents larger than the MTU arrive fragmented; the marker bit
    // flags the last packet of a document.
    if (!marker) return;
    const xml = Buffer.concat(this._frag).toString('utf8');
    this._frag = [];

    const t = Date.now();
    let samples;
    try { samples = parseMetadata(xml); }
    catch (e) { this.log.warn(`[meta] ${this.cameraId} parse failed: ${e.message}`); return; }

    this.stats.docs++;
    this.stats.lastDocAt = t;
    if (!samples.length) return;
    this.stats.objects += samples.length;
    if (samples[0].frameUtc) {
      const d = t - samples[0].frameUtc;
      this.stats.skewMs = this.stats.skewMs == null ? d : Math.round(this.stats.skewMs * 0.9 + d * 0.1);
    }
    this.store.add(t, samples);
  }
}

// ---------- registry ----------

const _clients = new Map();

function ensure(cameraId, cam, log) {
  let c = _clients.get(cameraId);
  // An existing client holds the IP it dialled. Config sync can change a
  // camera's address at runtime, and a client keyed only on cameraId would
  // then reconnect-loop against the old host forever — so a changed IP means
  // tear down and redial, not reuse.
  if (c && c.cam.ip_address !== cam.ip_address) {
    (log || console).log(`[meta] ${cameraId} IP เปลี่ยน ${c.cam.ip_address} → ${cam.ip_address} — ต่อใหม่`);
    c.stop();
    _clients.delete(cameraId);
    c = null;
  }
  if (!c) { c = new MetaTrackClient(cameraId, cam, log).start(); _clients.set(cameraId, c); }
  return c;
}

// The set of cameras currently holding a metadata session.
function activeIds() { return new Set(_clients.keys()); }

function lookup(cameraId, objectId, tMs, tolMs) {
  const c = _clients.get(cameraId);
  return c ? c.lookup(objectId, tMs, tolMs) : null;
}

function stop(cameraId) {
  const c = _clients.get(cameraId);
  if (c) { c.stop(); _clients.delete(cameraId); }
}

function stopAll() { for (const id of [..._clients.keys()]) stop(id); }

function stats() {
  const out = {};
  for (const [id, c] of _clients) out[id] = { ...c.stats, tracked: c.store.tracks.size };
  return out;
}

module.exports = {
  ensure, lookup, stop, stopAll, stats, activeIds,
  metaControlUrl, parseMetadata, boxToPixels, boxToFraction, headingOf, trailOf, driftMetres, TrackStore, MetaTrackClient,
  RETENTION_MS, LOOKUP_TOL_MS,
};

// ---------- self-check: node src/helpers/onvifMetaTrack.js ----------
if (require.main === module) {
  const assert = require('assert');

  const SDP = [
    'v=0', 'm=video 0 RTP/AVP 35', 'a=rtpmap:35 H264/90000',
    'a=control:rtsp://1.2.3.4/rtsp_tunnel?p=0&line=1&inst=1&vcd=2&stream=video',
    'm=application 0 RTP/AVP 107', 'a=rtpmap:107 vnd.onvif.metadata/90000',
    'a=control:rtsp://1.2.3.4/rtsp_tunnel?p=0&line=1&inst=1&vcd=2&stream=meta',
  ].join('\r\n');
  assert.match(metaControlUrl(SDP, 'rtsp://1.2.3.4/x'), /stream=meta$/, 'picks the metadata track, not video');
  assert.strictEqual(metaControlUrl(SDP.replace(/vnd\.onvif\.metadata/, 'other'), 'x'), null,
    'no ONVIF metadata track → null, never a guessed URL');

  // Verbatim from vss3 / BH5100i FW 9.40, 2026-08-19.
  const XML = '<tt:Frame UtcTime="2026-08-19T13:56:54.898Z">'
    + '<tt:Object ObjectId="12831" UUID="08dae221-dd33-49d9-b7e5-4d848a35deaa">'
    + '<tt:Appearance velocity="10.44"><tt:Shape>'
    + '<tt:BoundingBox bottom="0.55" top="0.61" right="-0.30" left="-0.37"/>'
    + '<tt:CenterOfGravity x="-0.34" y="0.58"/></tt:Shape>'
    + '<tt:Class><tt:Type Likelihood="0.11">Car</tt:Type></tt:Class>'
    + '</tt:Appearance></tt:Object></tt:Frame>';
  const got = parseMetadata(XML);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].objectId, 12831);
  assert.deepStrictEqual(got[0].box, { bottom: 0.55, top: 0.61, right: -0.30, left: -0.37 });
  assert.strictEqual(got[0].type, 'Car');
  assert.ok(got[0].box.top > got[0].box.bottom, 'ONVIF y axis points up');
  assert.strictEqual(parseMetadata('<tt:Frame UtcTime="2026-01-01T00:00:00Z"><tt:Object ObjectId="7"></tt:Object></tt:Frame>').length,
    0, 'an object with no BoundingBox yields no sample');

  // Speed comes off the same sample; the average is over what the ring still holds.
  const XMLS = '<tt:Frame UtcTime="2026-01-01T00:00:00Z"><tt:Object ObjectId="5" UUID="u">'
    + '<tt:Appearance velocity="10.00"><tt:Shape><tt:BoundingBox bottom="0.1" top="0.2" right="0.2" left="0.1"/>'
    + '</tt:Shape><tt:Behaviour><tt:Speed>10.00</tt:Speed></tt:Behaviour></tt:Appearance></tt:Object></tt:Frame>';
  assert.strictEqual(parseMetadata(XMLS)[0].speed, 10, 'reads tt:Speed');
  assert.strictEqual(parseMetadata(XMLS.replace(/<tt:Behaviour>[\s\S]*<\/tt:Behaviour>/, ''))[0].speed, 10,
    'falls back to Appearance/@velocity when Behaviour is absent');
  const sSpeed = new TrackStore(5000);
  sSpeed.add(1000, parseMetadata(XMLS));
  sSpeed.add(1100, parseMetadata(XMLS.replace(/10\.00/g, '20.00')));
  const hitS = sSpeed.lookup(5, 1100);
  assert.strictEqual(hitS.speed, 20, 'instantaneous is the nearest sample');
  assert.strictEqual(hitS.avgSpeed, 15, 'average is the mean of the ring');
  assert.strictEqual(hitS.speedSamples, 2);
  // A tracked object with no speed at all must not average to zero.
  const sNo = new TrackStore(5000);
  sNo.add(1000, parseMetadata(XMLS.replace(/ velocity="10.00"/, '').replace(/<tt:Behaviour>[\s\S]*<\/tt:Behaviour>/, '')));
  assert.strictEqual(sNo.lookup(5, 1000).avgSpeed, null, 'no speed anywhere → null, not 0');

  // Heading, on the picture. Right = 0, up = 90, and a jittering object is not
  // "moving" — an angle from noise would be worse than no angle.
  const mkBox = (cx, cy) => ({ box: { left: cx - 0.02, right: cx + 0.02, top: cy + 0.02, bottom: cy - 0.02 } });
  assert.strictEqual(headingOf([mkBox(0, 0), mkBox(0.5, 0)]), 0, 'travelling right = 0°');
  assert.strictEqual(headingOf([mkBox(0, 0), mkBox(0, 0.5)]), 90, 'travelling up = 90°');
  assert.strictEqual(headingOf([mkBox(0, 0), mkBox(-0.5, 0)]), 180, 'travelling left = 180°');
  assert.strictEqual(headingOf([mkBox(0, 0), mkBox(0, -0.5)]), 270, 'travelling down = 270°');
  assert.strictEqual(headingOf([mkBox(0, 0), mkBox(0.005, 0.005)]), null, 'jitter yields no heading');
  assert.strictEqual(headingOf([mkBox(0, 0)]), null, 'one sample is not a direction');
  assert.strictEqual(headingOf(null), null);
  // area rides on the same sample and must survive the round trip.
  const XA = '<tt:Frame UtcTime="2026-01-01T00:00:00Z"><tt:Object ObjectId="9" UUID="u">'
    + '<tt:Appearance velocity="6.00" area="1.21"><tt:Shape>'
    + '<tt:BoundingBox bottom="0.1" top="0.2" right="0.2" left="0.1"/></tt:Shape></tt:Appearance></tt:Object></tt:Frame>';
  assert.strictEqual(parseMetadata(XA)[0].area, 1.21, 'reads Appearance/@area');
  const sA = new TrackStore(5000); sA.add(1000, parseMetadata(XA));
  const hA = sA.lookup(9, 1000);
  assert.strictEqual(hA.area, 1.21);
  assert.deepStrictEqual(hA.speedSeries, [6], 'the series is what the sparkline draws');

  // Drift and bracketing — the two questions a reused frame has to answer.
  const XS = (t, cx, sp) => ({ t, box: { left: cx - 0.02, right: cx + 0.02, top: 0.02, bottom: -0.02 }, speed: sp, area: 1.2 });
  const st2 = new TrackStore(5000);
  st2.tracks.set(7, [XS(1000, 0, 10), XS(1100, 0.1, 10), XS(1200, 0.2, 10)]);
  const inside = st2.lookup(7, 1100);
  assert.strictEqual(inside.bracketed, true, 'a sample on each side means it was there');
  assert.strictEqual(driftMetres(inside), 0, 'no gap, no drift');
  const late = st2.lookup(7, 900);           // ก่อนที่วัตถุจะเข้าเฟรม
  assert.strictEqual(late.bracketed, false, 'all samples after the instant → not there yet');
  assert.ok(Math.abs(driftMetres(late) - 1.0) < 1e-9, '100ms at 10 m/s = 1 metre');
  // วัตถุที่หยุดนิ่ง: ไม่มี drift แต่ bracketing ยังต้องเป็นตัวตัดสิน
  const st3 = new TrackStore(5000);
  st3.tracks.set(8, [XS(2000, 0, 0.0), XS(2100, 0, 0.0)]);
  assert.strictEqual(driftMetres(st3.lookup(8, 1500)), null, 'speed 0/unknown → cannot judge, not "fine"');
  assert.strictEqual(st3.lookup(8, 1500).bracketed, false, 'and bracketing still says it was not there');

  // Trail: same coordinate space as the box, capped, newest point always kept.
  const mk = (cx, cy) => ({ box: { left: cx - 0.02, right: cx + 0.02, top: cy + 0.02, bottom: cy - 0.02 } });
  const tr = trailOf([mk(-1, 1), mk(0, 0), mk(1, -1)]);
  assert.deepStrictEqual(tr, [[0, 0], [0.5, 0.5], [1, 1]], 'ONVIF corners map to picture corners');
  assert.strictEqual(trailOf([mk(0, 0)]), null, 'one position is not a path');
  assert.strictEqual(trailOf(null), null);
  const many = trailOf(Array.from({ length: 75 }, (_, i) => mk(-1 + i * 2 / 74, 0)));
  assert.ok(many.length <= 20, `capped at 20, got ${many.length}`);
  assert.deepStrictEqual(many[many.length - 1], [1, 0.5], 'the newest position survives the downsample');
  assert.deepStrictEqual(many[0], [0, 0.5], 'and so does the oldest');
  // The trail's last point must agree with where boxToFraction puts the box centre.
  const bx = boxToFraction(mk(0.4, -0.2).box);
  const tl = trailOf([mk(0, 0), mk(0.4, -0.2)]);
  assert.ok(Math.abs((bx.x + bx.w / 2) - tl[tl.length - 1][0]) < 0.002, 'trail head sits at the box centre (x)');
  assert.ok(Math.abs((bx.y + bx.h / 2) - tl[tl.length - 1][1]) < 0.002, 'trail head sits at the box centre (y)');

  const s = new TrackStore(5000);
  const t0 = 1_000_000;
  s.add(t0, parseMetadata(XML));
  s.add(t0 + 100, parseMetadata(XML.replace('left="-0.37"', 'left="-0.40"')));
  assert.strictEqual(s.lookup(12831, t0 + 90).box.left, -0.40, 'returns the nearest sample in time');
  assert.strictEqual(s.lookup(12831, t0 + 40).box.left, -0.37);
  assert.strictEqual(s.lookup(99999, t0), null, 'unknown object → null');
  assert.strictEqual(s.lookup(12831, t0 + 5000), null, 'beyond tolerance → null, not a stale box');
  s.prune(t0 + 6000);
  assert.strictEqual(s.tracks.size, 0, 'samples age out of the ring');

  // Coordinate conversion. A centred box must land centred; y must not flip.
  const W = 1920, H = 1080;
  const mid = boxToPixels({ left: -0.5, right: 0.5, top: 0.5, bottom: -0.5 }, W, H, { pad: 0 });
  assert.deepStrictEqual(mid, { left: 480, top: 270, width: 960, height: 540 }, 'centred box maps to the centre');
  const upper = boxToPixels({ left: -0.5, right: 0.5, top: 0.9, bottom: 0.5 }, W, H, { pad: 0 });
  assert.ok(upper.top < mid.top, 'a box higher in ONVIF y sits nearer the top of the image');
  // The real sample: left of centre, upper half.
  const real = boxToPixels({ bottom: 0.55, top: 0.61, right: -0.30, left: -0.37 }, W, H, { pad: 0, minPx: 1 });
  assert.deepStrictEqual(real, { left: 605, top: 211, width: 67, height: 32 });
  // Out-of-frame extrapolation must clamp, not produce a negative offset.
  const off = boxToPixels({ left: -1.47, right: -0.9, top: 0.2, bottom: -0.2 }, W, H, { pad: 0, minPx: 1 });
  assert.strictEqual(off.left, 0, 'coordinates past the frame edge clamp to 0');
  assert.ok(off.left + off.width <= W && off.top + off.height <= H, 'never extends past the frame');
  assert.strictEqual(boxToPixels({ left: -0.01, right: 0.01, top: 0.01, bottom: -0.01 }, W, H), null,
    'a box smaller than the floor yields no crop at all');
  // Tall and narrow is what a person looks like from above a road — it must
  // survive on area even though one side is under minPx.
  const tall = boxToPixels({ left: -0.019, right: 0.019, top: 0.081, bottom: -0.081 }, W, H, { pad: 0 });
  assert.ok(tall, 'a 36x175 person is a usable crop, not a sliver');
  assert.ok(tall.width < 40 && tall.width * tall.height >= 1600);
  // A genuine sliver still goes: wide enough in area terms, but one side is
  // too thin to show anything.
  assert.strictEqual(boxToPixels({ left: -0.05, right: 0.05, top: 0.008, bottom: -0.008 }, W, H, { pad: 0 }), null,
    'a 192x17 smear is rejected even though its area passes');
  assert.strictEqual(boxToPixels(null, W, H), null);
  assert.strictEqual(boxToPixels({ left: 0, right: 0.5, top: 0.5, bottom: 0 }, 0, 0), null, 'unknown dimensions → no crop');

  // Fractions for the overlay: same origin as the SVG viewBox (top-left, y down).
  const fr = boxToFraction({ left: -0.5, right: 0.5, top: 0.5, bottom: -0.5 });
  assert.deepStrictEqual(fr, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 'centred box → centred fraction');
  const up = boxToFraction({ left: -0.5, right: 0.5, top: 0.9, bottom: 0.5 });
  assert.ok(up.y < fr.y, 'higher in ONVIF y → smaller fraction y (nearer the top edge)');
  // The frame must agree with the crop: same box, same place in the picture.
  const raw = { bottom: 0.55, top: 0.61, right: -0.30, left: -0.37 };
  const px = boxToPixels(raw, W, H, { pad: 0, minPx: 1 }), f2 = boxToFraction(raw);
  assert.strictEqual(Math.round(f2.x * W), px.left, 'fraction and pixel origins agree on x');
  assert.strictEqual(Math.round(f2.y * H), px.top,  'fraction and pixel origins agree on y');
  // Out-of-frame extrapolation clamps here too, and a box entirely outside is nothing.
  const offF = boxToFraction({ left: -1.47, right: -0.9, top: 0.2, bottom: -0.2 });
  assert.strictEqual(offF.x, 0, 'past the left edge clamps to 0');
  assert.ok(offF.x + offF.w <= 1 && offF.y + offF.h <= 1, 'never extends past the frame');
  assert.strictEqual(boxToFraction({ left: -2, right: -1.5, top: 0.2, bottom: -0.2 }), null,
    'a box entirely outside the frame yields no rectangle');
  assert.strictEqual(boxToFraction(null), null);

  console.log('onvifMetaTrack self-check ok');
}
