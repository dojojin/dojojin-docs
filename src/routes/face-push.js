// ============================================================
// Vigil Platform — Routes: Cross-site face push receiver (IM3-R)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Public receiver for Hikvision face cameras at remote sites (e.g. Phuket) that
// push to the server over the Cloudflare tunnel (dashboard.dojojin.tech) instead
// of being pulled. The LAN FAS server (hikvision-isapi.js:3010) is unreachable
// from a remote site; this route sits on the api-server behind the tunnel — same
// path the LPR ANPR push (/lpr) already uses.
//
// Auth: a per-camera SECRET TOKEN in the path (cameras-config.json face_push_token).
// Cloudflare masks the source IP, so the token (not IP) identifies the camera —
// mirrors HikCentral's UUID-in-path alarm-server pattern. The path is in
// PUBLIC_PREFIXES; an unknown token resolves to no camera and is dropped.
//
// v1 = ingest-only (event + images + heartbeat + new_event/event_for_clip notify).
// LINE alerting and HCP relay are deliberately out of v1 (ROADMAP §IM3-R).
// ============================================================
'use strict';
const { touchCamera } = require('../helpers/touchCamera');

const fs   = require('fs');
const path = require('path');
const { parseFaceAlarmMultipart, faceAlarmToRecord } = require('../helpers/face-multipart');
const { createForwarder } = require('../lpr-forward');
// EDGE_MODE: on a Site Edge box, publish the pre-normalized event to local
// NanoMQ instead of writing to a (non-existent) local Postgres. This module is
// shared with api-server (central) — there EDGE_MODE is unset, so behaviour is
// unchanged. See docs/LOGIC_edge-ingester-divergence.md.
const { EDGE_MODE, publishEdgeEvent, newCorrId } = require('../edge/publisher');

module.exports = function facePushRoutes(app, pool, { SNAPSHOT_DIR, loadCameraConfig }) {
  const rawBodyParser = require('express').raw({ type: '*/*', limit: '20mb' });

  // F2 — relay to CIB. Same forwarder the ANPR path uses, so spool, retry, the
  // concurrency cap and the loud drop of expired items are all shared rather
  // than written twice.
  //
  // Per-process spool dir for the same reason as lpr.js: api-server and
  // lpr-receiver both mount this module, and during a cutover both are up. One
  // shared dir would let the idle process's drain re-POST the active one's spool
  // and deliver everything to CIB twice.
  //
  // maxAgeMs left at the 1h default rather than ANPR's 6h. ANPR needs six
  // because those cameras hoard to microSD and replay at ~4x on reconnect; of
  // the 34 face cameras at Phuket, 25 have an unformatted card and 2 have none,
  // so 27 cannot replay anything and CIB has never received anything
  // retrospectively from them (surveyed 2026-08-04, F0.4). Raise it once a real
  // push has been measured — do not guess it upward.
  const procTag = process.env.APP_NAME
               || path.basename(process.argv[1] || 'app', '.js');
  const forwarder = createForwarder({
    spoolDir: path.join(SNAPSHOT_DIR, '..', 'spool', `face-forward-${procTag}`),
    label: 'face',
    // 6h, matching routes/lpr.js. This relay carries the same responsibility as
    // the plate one — we hold the camera's only push slot, so what we fail to
    // deliver the partner never gets from anywhere else — but it was left on
    // the 1h default while the plate side was deliberately raised to 6h after
    // the 2026-07-30 hkt outage needed 46 of its 60 minutes to clear. Nothing
    // about faces makes an hour the right ceiling; the difference was an
    // oversight, not a decision.
    //
    // Not yet load-bearing: the face spool is empty because CIB currently
    // refuses our relay (403), so no face has ever needed retrying. Which is
    // exactly why this should be corrected now rather than discovered during
    // the first outage after that is resolved.
    maxAgeMs: 6 * 3600 * 1000,
    // Left at the default 4. The plate side was raised to 6 against a measured
    // arrival rate; faces have no such measurement yet, and guessing a
    // concurrency limit for traffic that is not flowing would be inventing a
    // number. Revisit once the relay is actually delivering.
  });

  // Resolve a camera by its face_push_token (exact match on a hard-to-guess
  // 122-bit UUID — the entropy is the protection). Returns the config entry or null.
  function camByToken(token) {
    if (!token) return null;
    try {
      return (loadCameraConfig().cameras || []).find(c => c.face_push_token && c.face_push_token === token) || null;
    } catch { return null; }
  }

  // LIVE-HIGH-001: reject unknown tokens before express.raw() buffers the body
  // (observed sustained ~2 req/s of unknown-token /face-push hits in production
  // logs since 2026-07-17 — this was costing a full 20mb-capable Buffer.concat
  // per hit for zero legitimate traffic).
  // log เป็นสรุปทุก 10 นาทีพร้อมต้นทาง (helpers/unknownTokenLog · audit 2026-10-02 · D15)
  const _unknownFace = require('../helpers/unknownTokenLog').createUnknownTokenLog('face-push');
  function facePushTokenGate(req, res, next) {
    const cam = camByToken(req.params.token);
    if (!cam) {
      _unknownFace.record(req);
      res.status(200).end('OK');
      req.resume(); // drain socket without buffering into memory
      return;
    }
    req._cam = cam;
    next();
  }

  // A push we could not read is indistinguishable from a heartbeat here — both
  // just return — and that silence is why the format mismatch went unnoticed
  // until a camera was about to be pointed at us. This says what actually
  // arrived, once.
  //
  // Structure only: part names, content types, sizes, and the text of the
  // non-image parts. Image bytes are never written anywhere. The text parts of a
  // face alarm carry no image but DO carry a person's name and library when the
  // camera matched someone, so this is capped hard — a handful of samples per
  // camera per process lifetime, enough to write a parser against and not enough
  // to become a second store of who walked past.
  const _unparsed = new Map();
  const UNPARSED_MAX = 3;

  // Structure-only manifest (name/contentType/bytes, never a body) logged for
  // every push regardless of whether it parsed — 4.2/4.3 of the CIB face
  // migration (2026-08-05): _describeUnparsed only ever fires on FAILURE, so a
  // camera whose alarmResult parses fine (as C23WIC-SB-17's has, even with
  // parameterFormatType=XML set on its httpHost) left every other part of its
  // payload invisible. This is how we find out whether an XML part is present
  // and being silently skipped alongside the JSON one, and whether toggling
  // the format flag changes anything at all. Capped the same way and for the
  // same reason as _unparsed — this is diagnostic, not a second event store.
  const _partsSeen = new Map();
  const PARTS_MAX = 5;

  // 5.0c — does the alarm-server slot carry faces at all?
  //
  // Both pilot cameras declare isSupportFaceSnap/FaceLib/FaceContrast = false
  // and isSupportMixedTargetDetection = true, and 874/874 of their FaceCapture
  // rows over 7 days came from mixedTargetDetection via the PULL path. The push
  // path has produced none — but every diagnostic above is capped per camera per
  // process, so "no Face-bearing push observed" is a statement about a 12-sample
  // window taken right after a restart, not a measurement. Cutting pull (Phase
  // 5.1) on that basis would risk every face event on the camera.
  //
  // Uncapped on purpose: it is counters and one summary line per camera per
  // window, never a body, so it cannot become a second event store the way the
  // capped dumps could. Nothing here touches control flow — the payload is
  // dropped exactly as before (WA #3, "log / warn / metric" tier).
  // Vehicle is broken out rather than lumped into "other" because 9 of the 12
  // payloads captured before this counter existed were vehicles — a tally that
  // reads "Face 0 · other 900" would leave us guessing whether the slot is
  // carrying nothing useful or simply watching a road.
  // Volume per camera, counted without touching the body. The mixedTargetDetection
  // tally below is richer but needs a full multipart parse, and that parse no
  // longer runs for cameras we also pull — which is nearly all of them. This
  // keeps the one thing the rollout actually needs: how much each camera pushes,
  // so a batch cutover can be sized and watched.
  const _volTally = new Map();   // camId → { n, bytes }

  const _mixTally = new Map();   // camId → { face, human, vehicle, other }
  const _sawFaceOnce = new Set();
  function _tallyMixed(camId, bodyJson) {
    if (!bodyJson) return;
    const t = _mixTally.get(camId) || { face: 0, human: 0, vehicle: 0, other: 0 };
    let face = null, human = false, vehicle = false;
    for (const cap of (bodyJson.CaptureResult || [])) {
      if (cap.Face?.pId1) { face = cap; break; }
      if (cap.Human) human = true;
      else if (cap.Vehicle) vehicle = true;
    }
    if (face) t.face++; else if (human) t.human++; else if (vehicle) t.vehicle++; else t.other++;
    _mixTally.set(camId, t);

    // The first Face-bearing push is the whole answer to 5.0a — print it once,
    // in full enough detail to confirm it carries what the pull path ingests
    // (pId to bind the JPEG part, plus the attributes that become raw_json).
    if (face && !_sawFaceOnce.has(camId)) {
      _sawFaceOnce.add(camId);
      const attrs = {};
      for (const p of (face.Face.Property || [])) if (p.description) attrs[p.description] = p.value;
      console.log(`[face-push] ${camId}: 🎯 push แรกที่มี Face — pId1=${face.Face.pId1} ` +
        `pId2=${face.Face.pId2 || '(none)'} targetID=${face.targetID} ` +
        `body=${face.Human ? 'มี' : 'ไม่มี'} attrs=${JSON.stringify(attrs)}`);
    }
  }
  setInterval(() => {
    for (const [camId, v] of _volTally) {
      const perMin = (v.n / 15).toFixed(1);
      console.log(`[face-push] ${camId}: รับเข้า 15 นาทีล่าสุด — ${v.n} ครั้ง ` +
        `(${perMin}/นาที · ${(v.bytes / 1048576).toFixed(1)} MB · เฉลี่ย ${Math.round(v.bytes / v.n / 1024)} KB)`);
    }
    _volTally.clear();

    for (const [camId, t] of _mixTally) {
      console.log(`[face-push] ${camId}: mixedTargetDetection 15 นาทีล่าสุด — ` +
        `Face ${t.face} · Human ${t.human} · Vehicle ${t.vehicle} · อื่น ${t.other}`);
    }
    _mixTally.clear();   // per-window rate; silent when the camera sent nothing
  }, 900_000).unref();

  // 2026-08-06 — CIB answered our relay with HTTP 403 on all 6 attempts of the
  // C9-TCC-SB-04 cutover, while the same events posted straight from the camera
  // are accepted every day. The relay sends only Content-Type and
  // Content-Length (lpr-forward.js _post); the camera sends whatever a
  // Hikvision alarm client sends. We have never looked at that list — the
  // receiver reads two headers and discards the rest — so "which header does
  // their gateway require" is currently unanswerable from our side, and the
  // alternative is guessing against a partner's production endpoint, where a
  // guess that happens to work writes a duplicate event into police evidence.
  //
  // Logged before parsing and before the pause check so a payload we cannot
  // read still tells us its headers. Values are recorded as-is: this request
  // carries no credentials (httpAuthenticationMethod=none on every slot, and
  // the token lives in the path, not a header).
  const _hdrsSeen = new Set();
  function _describeHeaders(camId, req) {
    if (_hdrsSeen.has(camId)) return;
    _hdrsSeen.add(camId);
    const h = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`).join('\n    ');
    console.log(`[face-push] ${camId}: header ที่กล้องส่งมา (${req.method} ${req.httpVersion}) —\n    ${h}`);
  }

  function _describeParts(camId, partsInfo) {
    const n = _partsSeen.get(camId) || 0;
    if (n >= PARTS_MAX) return;
    _partsSeen.set(camId, n + 1);
    console.log(`[face-push] ${camId}: parts (${n + 1}/${PARTS_MAX}) — ` +
      partsInfo.map(p => `${p.name}:${p.contentType}:${p.bytes}b`).join(', '));
  }
  function _describeUnparsed(camId, body, boundary) {
    const n = _unparsed.get(camId) || 0;
    if (n >= UNPARSED_MAX) return;
    _unparsed.set(camId, n + 1);
    try {
      const bound = Buffer.from(`--${boundary}`);
      const parts = [];
      let off = 0;
      while (parts.length < 12) {
        const bs = body.indexOf(bound, off);
        if (bs < 0) break;
        const hs = bs + bound.length;
        if (body.slice(hs, hs + 2).toString() === '--') break;
        const he = body.indexOf(Buffer.from('\r\n\r\n'), hs);
        if (he < 0) break;
        const hdrs = body.slice(hs, he).toString('utf8');
        const ct = (hdrs.match(/Content-Type:\s*([^\r\n;]+)/i) || [])[1]?.trim() || '(none)';
        const nm = (hdrs.match(/name="([^"]+)"/i) || [])[1] || '(unnamed)';
        const cl = parseInt((hdrs.match(/Content-Length:\s*(\d+)/i) || [])[1] || '0', 10);
        const start = he + 4;
        const isImg = /image/i.test(ct);
        const end = cl > 0 ? start + cl : body.indexOf(Buffer.from('\r\n--'), start);
        parts.push({ name: nm, type: ct, bytes: cl,
                     text: isImg ? null : body.slice(start, end < 0 ? body.length : end).toString('utf8').slice(0, 2000) });
        off = start + (cl > 0 ? cl : 0);
      }
      console.warn(`[face-push] ${camId}: push ที่อ่านไม่ออก (${n + 1}/${UNPARSED_MAX}) — ` +
        `รวม ${body.length} ไบต์ · ${parts.length} part`);
      for (const p of parts) {
        console.warn(`  part name=${p.name} type=${p.type} bytes=${p.bytes}` +
          (p.text === null ? ' [ภาพ — ไม่บันทึกเนื้อหา]' : `\n${p.text}`));
      }
    } catch (e) { console.warn(`[face-push] ${camId}: อธิบาย payload ไม่ได้: ${e.message}`); }
  }

  app.post('/face-push/:token', facePushTokenGate, rawBodyParser, async (req, res) => {
    // Respond 200 immediately — camera retries if it doesn't get a response.
    res.status(200).end('OK');

    const cam = req._cam;
    const ct = req.headers['content-type'] || '';
    _describeHeaders(cam.camera_id, req);

    // Counted before the relay so the number reflects what the camera sent,
    // not what we managed to hand on.
    const _v = _volTally.get(cam.camera_id) || { n: 0, bytes: 0 };
    _v.n++; _v.bytes += req.body ? req.body.length : 0;
    _volTally.set(cam.camera_id, _v);

    // Relay FIRST, and unconditionally — before the pause check, before parsing,
    // before anything of ours can fail. Once a camera is repointed at us we are
    // CIB's only feed from it, and everything below this line is our concern,
    // not theirs: a body we cannot parse, a category we ignore, a camera an
    // operator paused for maintenance. The camera would have sent all of it
    // straight to CIB before; it still should. Same order and same reasoning as
    // the ANPR path (lpr-core.js:365).
    //
    // No target configured = no relay, silently. That is the opt-in default:
    // a camera pushing to us before anyone has copied its CIB URL across must
    // not have its faces sent somewhere unintended.
    forwarder.forward(req.body, ct, cam.face_forward_url);

    // CS1 — maintenance pause: drop without storing. The relay above already ran.
    if (cam.paused) return;

    // ── Past this point is INGEST, which a camera in relay mode must not reach ──
    //
    // PLAN_hkt-face-cib-forward §F4 is "pull ingest, push relay": once a camera's
    // push is being handed to CIB, alertStream is where its data enters us, and
    // the push slot is CIB's. Ingesting here too would store the event twice.
    //
    // The condition is face_forward_url — is this camera relaying? — and NOT
    // "can we pull it". An earlier draft used !push_only, on the theory that any
    // pullable camera's push is redundant. That is false, and expensively so:
    // Hikvision_FaceReg_C01 on vss is pulled AND pushes, and of 380 push rows on
    // 2026-08-06 all 380 carried fdLib match data while its 746 pull rows carried
    // none, with only 20 sharing a timestamp. The push is where face-recognition
    // MATCHES arrive; the pull only ever sees FaceCapture. !push_only would have
    // deleted a live feature — 6,550 rows since 2026-06-22 — on deploy.
    //
    // push_only stays as the second condition. Such a camera cannot be pulled, so
    // even in relay mode its push is the only source and dropping it loses the
    // data outright. None exist today (checked across hkt/hdy/vss 2026-08-07:
    // no camera carries both face_push_token and push_only) but a future one
    // must not fall into a silent hole.
    //
    // Today this guard fires for C9-TCC-SB-04 and C59-PKT-SB-17 only — the two
    // hkt cameras already carrying a forward URL, which between them have pushed
    // 6 times ever and produced no rows. It is the cutover in S4-S6 that makes
    // it load-bearing, when 30 cameras get a forward URL.
    //
    // Correctness, not CPU. The first draft of this comment claimed a perf win;
    // measured on central, 300 runs per mode, relay-only is 0.77 ms CPU per push
    // against 0.81 ms for relay+ingest — a 0.04-0.21 ms delta across repeats,
    // under 0.2% of one core even at the 7.9/s that 68 cameras would produce, and
    // inside the run-to-run noise. parseFaceAlarmMultipart is 4-6 µs on a 300 KB
    // body (it slices, it does not copy) and the DB work behind it is I/O wait.
    if (cam.face_forward_url && !cam.push_only) return;

    const bMatch = ct.match(/boundary=([-\w]+)/i);
    if (!bMatch) { console.warn(`[face-push] ${cam.camera_id}: missing multipart boundary — ignoring`); return; }

    try {
      const { alarmJson, bodyJson, images, partsInfo } = parseFaceAlarmMultipart(req.body, bMatch[1]);
      _describeParts(cam.camera_id, partsInfo);
      _tallyMixed(cam.camera_id, bodyJson);
      if (!alarmJson) { _describeUnparsed(cam.camera_id, req.body, bMatch[1]); return; }

      const camId = cam.camera_id;
      // Push = liveness for a push-only camera (server can't poll it). Fire-and-forget.
      // EDGE_MODE: no local DB — central touches last_seen on the published event.
      if (!EDGE_MODE) {
        touchCamera(pool, camId, { event: true });
      }

      const { rawJson, personName, listType, fdLibName, similarity } = faceAlarmToRecord(alarmJson);
      const eventTime = new Date();

      if (EDGE_MODE) {
        // Buffer images locally (Tier 2 — never cross MQTT), named by corr.
        const corr = newCorrId();
        const saveImg = (buf, suffix) => {
          if (!buf || buf.length === 0) return null;
          const fn = `${camId}_${suffix}_${corr}_${Date.now()}.jpg`;
          try { fs.writeFileSync(path.join(SNAPSHOT_DIR, fn), buf); return fn; }
          catch { return null; }
        };
        const snapFile = saveImg(images['faceImage'],       'face');
        const fullFile = saveImg(images['backgroundImage'], 'full');
        const refFile  = saveImg(images['faceLibImage'],    'ref');
        if (refFile) rawJson._snapshot_ref = refFile;   // 4th image → raw_json mapping
        const eventTimeIso = eventTime.toISOString();
        publishEdgeEvent({
          vendor: 'hikvision',
          corr,
          previewRef:    snapFile,
          previewFull:   fullFile,
          previewSource: 'hikvision-alarm',
          event: {
            camera_id: camId,
            event_category: 'RuleEngine',
            event_type: 'FaceRecognition',
            rule_name: 'Face Recognition Match',
            object_id: null, object_class: null, likelihood: null,
            event_state: 'true',
            raw_json: rawJson,
            event_time: eventTimeIso,
          },
          clip: { camera_id: camId, event_time: eventTimeIso, received_at_ms: Date.now() },
        });
        const match = personName
          ? ` ${personName} (${fdLibName || listType || '?'}, ${Math.round((similarity || 0) * 100)}%)`
          : ' (no match)';
        console.log(`[face-push] ${camId} → Face Recognition →${match} → edge`);
        return;
      }

      let eventId;
      try {
        const r = await pool.query(
          `INSERT INTO events
             (camera_id, event_category, event_type, rule_name,
              object_id, object_class, likelihood, event_state, raw_json, event_time)
           VALUES ($1,'RuleEngine','FaceRecognition','Face Recognition Match',NULL,NULL,NULL,'true',$2,$3)
           RETURNING id`,
          [camId, JSON.stringify(rawJson), eventTime]
        );
        eventId = r.rows[0].id;
      } catch (err) {
        console.error(`[face-push] DB insert [${camId}]:`, err.message);
        return;
      }

      // Save images — same naming as the FAS receiver so the dashboard finds them.
      const saveImg = (buf, suffix) => {
        if (!buf || buf.length === 0) return null;
        const fn = `${camId}_${suffix}_${eventId}_${Date.now()}.jpg`;
        try { fs.writeFileSync(path.join(SNAPSHOT_DIR, fn), buf); return fn; }
        catch { return null; }
      };
      const snapFile = saveImg(images['faceImage'],       'face');
      const fullFile = saveImg(images['backgroundImage'], 'full');
      const refFile  = saveImg(images['faceLibImage'],    'ref');

      const patch = {};
      if (snapFile) { patch._snapshot = snapFile; patch._snapshot_source = 'hikvision-alarm'; }
      if (fullFile) patch._snapshot_full = fullFile;
      if (refFile)  patch._snapshot_ref  = refFile;
      if (Object.keys(patch).length) {
        const fields = [`raw_json = raw_json || $1::jsonb`];
        const params = [JSON.stringify(patch)];
        if (snapFile) { fields.push(`snapshot_filename = $2`, `has_snapshot = TRUE`); params.push(snapFile); }
        params.push(eventId);
        await pool.query(`UPDATE events SET ${fields.join(', ')} WHERE id=$${params.length}`, params).catch(() => {});
      }

      pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)])
        .catch(err => console.error('[face-push] pg_notify new_event:', err.message));
      pool.query(`SELECT pg_notify('event_for_clip', $1)`, [JSON.stringify({
        event_id: eventId, camera_id: camId, event_time: eventTime, received_at_ms: Date.now(),
      })]).catch(() => {});

      const match = personName
        ? ` ${personName} (${fdLibName || listType || '?'}, ${Math.round((similarity || 0) * 100)}%)`
        : ' (no match)';
      console.log(`[face-push] ${camId} → Face Recognition →${match} event ${eventId}`);
    } catch (e) {
      console.error('[face-push] ingest error:', e.message);
    }
  });
};
