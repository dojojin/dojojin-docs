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

const fs   = require('fs');
const path = require('path');
const { parseFaceAlarmMultipart, faceAlarmToRecord } = require('../helpers/face-multipart');
// EDGE_MODE: on a Site Edge box, publish the pre-normalized event to local
// NanoMQ instead of writing to a (non-existent) local Postgres. This module is
// shared with api-server (central) — there EDGE_MODE is unset, so behaviour is
// unchanged. See docs/LOGIC_edge-ingester-divergence.md.
const { EDGE_MODE, publishEdgeEvent, newCorrId } = require('../edge/publisher');

module.exports = function facePushRoutes(app, pool, { SNAPSHOT_DIR, loadCameraConfig }) {
  const rawBodyParser = require('express').raw({ type: '*/*', limit: '20mb' });

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
  function facePushTokenGate(req, res, next) {
    const cam = camByToken(req.params.token);
    if (!cam) {
      console.warn('[face-push] unknown token — dropped (pre-body)');
      res.status(200).end('OK');
      req.resume(); // drain socket without buffering into memory
      return;
    }
    req._cam = cam;
    next();
  }

  app.post('/face-push/:token', facePushTokenGate, rawBodyParser, async (req, res) => {
    // Respond 200 immediately — camera retries if it doesn't get a response.
    res.status(200).end('OK');

    const cam = req._cam;
    // CS1 — maintenance pause: drop without storing (no downstream relay on this path).
    if (cam.paused) return;

    const ct = req.headers['content-type'] || '';
    const bMatch = ct.match(/boundary=([-\w]+)/i);
    if (!bMatch) { console.warn(`[face-push] ${cam.camera_id}: missing multipart boundary — ignoring`); return; }

    try {
      const { alarmJson, images } = parseFaceAlarmMultipart(req.body, bMatch[1]);
      if (!alarmJson) return; // body/heartbeat-only push — v1 ingests face alarms only

      const camId = cam.camera_id;
      // Push = liveness for a push-only camera (server can't poll it). Fire-and-forget.
      // EDGE_MODE: no local DB — central touches last_seen on the published event.
      if (!EDGE_MODE) {
        pool.query('UPDATE cameras SET last_seen_at = NOW(), last_event_at = NOW() WHERE id = $1', [camId])
          .catch(() => {});
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
