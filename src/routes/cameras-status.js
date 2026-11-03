// ============================================================
// Vigil Platform — Routes: Cameras (offline alerts / status log / live snapshot)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แยกออกจาก routes/cameras.js — ลงทะเบียนต่อท้ายกลุ่ม CRUD ตำแหน่งเดิมเป๊ะ
// `_hikDigestSnapshot` ย้ายมาที่นี่ เพราะผู้เรียกจริงมีแค่ /api/snapshot/live
'use strict';

const http = require('http');
const routeError = require('../helpers/routeError');
const normalizeTimeOfDay = require('../helpers/normalizeTimeOfDay');
const { parseChallenge, buildDigestHeader } = require('../helpers/digestAuth');
const { OFFLINE_THRESHOLD_SEC } = require('../constants');
const { scopedCameraIds } = require('../auth');
const { archivedCameraIds } = require('../helpers/siteStatus');

module.exports = function camerasStatusRoutes(app, pool, {
  auth, loadCameraConfig,
  logCameraAudit: _logCameraAudit,
  thumbWidth, jpegResizer,
  _diffAuditObjects, PUSH_ONLY_OFFLINE_SEC,
}) {

  // ── Hikvision ISAPI snapshot proxy ──────────────────────────
  // The picture endpoint rejects Basic auth, so this does the HTTP Digest
  // two-step (401 challenge → hashed retry) and pipes the JPEG through.
  // Same algorithm as the digest helper in src/ingesters/hikvision-isapi.js
  // — kept inline for the MVP; the MV.2 plugin refactor is the right time
  // to extract a shared lib.
  function _hikDigestSnapshot(host, port, uri, user, pass, res, sendError, resizeW) {
    const attempt = (authHeader) => {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      const r = http.get({ host, port, path: uri, headers, timeout: 5000 }, (pr) => {
        if (pr.statusCode === 401 && !authHeader) {
          const wa = pr.headers['www-authenticate'] || '';
          pr.resume();
          // Some generic ONVIF cameras challenge with Basic instead of Digest
          if (/digest/i.test(wa)) return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa)));
          if (/basic/i.test(wa)) return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
          return sendError(502, 'Camera 401 — no supported auth challenge');
        }
        if (pr.statusCode !== 200) { pr.resume(); return sendError(502, `Camera returned ${pr.statusCode}`); }
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        if (resizeW) {
          const t = jpegResizer(resizeW);
          t.on('error', () => { try { res.end(); } catch {} });
          pr.pipe(t).pipe(res);
        } else {
          pr.pipe(res);
        }
        pr.on('error', () => res.end());
      });
      r.on('error', (e) => sendError(502, e.message));
      r.on('timeout', () => { r.destroy(); sendError(504, 'Timeout'); });
    };
    attempt(null);
  }

  // ============================================================
  // API: Camera Offline Alerts + Status Log (Ph.1)
  // ============================================================

  // GET /api/camera-offline-alerts/:cameraId — return config (defaults if none)
  app.get('/api/camera-offline-alerts/:cameraId', auth.requireAuth, async (req, res) => {
    try {
      const { cameraId } = req.params;
      const { rows } = await pool.query(
        `SELECT * FROM camera_offline_alerts WHERE camera_id = $1`, [cameraId]
      );
      const row = rows[0] || {
        camera_id: cameraId, enabled: false,
        notify_after_sec: 300, escalate_interval_min: 60, escalate_once: false,
        quiet_from: null, quiet_to: null, recipient_ids: '', send_snapshot: false,
      };
      res.json(row);
    } catch (err) { routeError(res, err, 'GET /api/camera-offline-alerts/:cameraId'); }
  });

  // PUT /api/camera-offline-alerts/:cameraId — upsert config
  app.put('/api/camera-offline-alerts/:cameraId', auth.requireAdmin, async (req, res) => {
    try {
      const { cameraId } = req.params;
      const { enabled, notify_after_sec, escalate_interval_min, escalate_once, quiet_from, quiet_to, recipient_ids, send_snapshot } = req.body;
      const beforeResult = await pool.query(
        `SELECT enabled, notify_after_sec, escalate_interval_min, escalate_once, quiet_from, quiet_to, recipient_ids, send_snapshot
           FROM camera_offline_alerts WHERE camera_id = $1`,
        [cameraId]
      );
      const before = beforeResult.rows[0] || null;

      const notifyAfter  = Math.max(30, Math.min(86400, parseInt(notify_after_sec, 10) || 300));
      const escalateMin  = Math.max(1,  Math.min(1440,  parseInt(escalate_interval_min, 10) || 60));
      const escalateOnce = !!escalate_once;
      let qf = null, qt = null;
      try { qf = normalizeTimeOfDay(quiet_from); } catch {}
      try { qt = normalizeTimeOfDay(quiet_to);   } catch {}

      await pool.query(
        `INSERT INTO camera_offline_alerts
           (camera_id, enabled, notify_after_sec, escalate_interval_min, escalate_once, quiet_from, quiet_to, recipient_ids, send_snapshot, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (camera_id) DO UPDATE SET
           enabled=$2, notify_after_sec=$3, escalate_interval_min=$4, escalate_once=$5,
           quiet_from=$6, quiet_to=$7, recipient_ids=$8, send_snapshot=$9, updated_at=NOW()`,
        [cameraId, !!enabled, notifyAfter, escalateMin, escalateOnce, qf, qt, String(recipient_ids || '').trim(), !!send_snapshot]
      );
      const after = {
        enabled: !!enabled,
        notify_after_sec: notifyAfter,
        escalate_interval_min: escalateMin,
        escalate_once: escalateOnce,
        quiet_from: qf,
        quiet_to: qt,
        recipient_ids: String(recipient_ids || '').trim(),
        send_snapshot: !!send_snapshot,
      };
      await _logCameraAudit(req, 'camera_offline_alert_update', cameraId, {
        camera_id: cameraId,
        changed_fields: _diffAuditObjects(before, after),
      });
      res.json({ success: true });
    } catch (err) { routeError(res, err, 'PUT /api/camera-offline-alerts/:cameraId'); }
  });

  // GET /api/cameras/status-current — current operational snapshot for the
  // History › Camera Status view. `updated_at` is the DB row update time and may
  // include runtime updates, so the UI labels it as data update, not config edit.
  app.get('/api/cameras/status-current', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      // ไซต์ archived ไม่ใช่ส่วนของระบบที่ทำงานอยู่ — ซ่อนจากหน้าสด (ค้นหา/รายงานยังเห็น)
      const archived = await archivedCameraIds(pool);
      const cfgCameras = (loadCameraConfig().cameras || []).filter(c => !archived.has(c.camera_id || c.id));
      const cfgIds = cfgCameras.map(c => c.camera_id || c.id).filter(Boolean);
      if (cfgIds.length === 0) {
        return res.json({ summary: { total: 0, online: 0, offline: 0 }, cameras: [] });
      }

      // ⚡ 2026-09-05 — เดิมเป็น CTE `MAX(event_time) ... GROUP BY camera_id` ซึ่งไม่มี
      // ขอบเวลาเลย → aggregate ทั้ง 25 partition ทุกครั้ง วัดจริง 44s. LATERAL
      // ...ORDER BY event_time DESC LIMIT 1 ให้ผลเท่ากันเป๊ะ (MAX ≡ แถวล่าสุด) แต่
      // เดินแค่ปลาย index (camera_id, event_time DESC) ต่อกล้อง → 80 ms / 169 กล้อง
      // LEFT JOIN ... ON true ยังคืน NULL ให้กล้องที่ไม่เคยมี event เหมือนเดิม
      // หมายเหตุ: endpoint นี้ยังอ่าน `events` ของจริง ไม่ใช่ event_dim_bucket
      // เพราะต้องการเวลาแม่นวินาที (dim ละเอียด 30 นาที + lag ~5 นาที) ต่างจาก
      // /api/health/details ที่ย้ายไป dim แล้ว
      const { rows } = await pool.query(`
        SELECT c.id AS camera_id, c.created_at, c.updated_at, c.last_seen_at,
               c.paused, le.last_event_at
        FROM cameras c
        LEFT JOIN LATERAL (
          SELECT e.event_time AS last_event_at
            FROM events e
           WHERE e.camera_id = c.id
           ORDER BY e.event_time DESC
           LIMIT 1) le ON true
        WHERE c.id = ANY($1::text[])
      `, [cfgIds]);

      const dbById = {};
      rows.forEach(r => { dbById[r.camera_id] = r; });
      const now = Date.now();
      const camerasCurrent = cfgCameras.map(c => {
        const cameraId = c.camera_id || c.id;
        const db = dbById[cameraId] || {};
        const lastSeenMs = db.last_seen_at ? new Date(db.last_seen_at).getTime() : 0;
        const _thr = c.push_only ? PUSH_ONLY_OFFLINE_SEC : OFFLINE_THRESHOLD_SEC;
        const status = db.paused ? 'paused'
          : (lastSeenMs && (now - lastSeenMs) / 1000 < _thr ? 'online' : 'offline');
        let offlineForSec = null;
        if (status === 'offline') {
          offlineForSec = lastSeenMs ? Math.max(0, Math.round((now - lastSeenMs) / 1000)) : null;
        }
        return {
          camera_id: cameraId,
          camera_name: c.camera_name || cameraId,
          vendor: c.vendor || 'bosch',
          status,
          created_at: db.created_at || null,
          updated_at: db.updated_at || null,
          last_seen_at: db.last_seen_at || null,
          last_event_at: db.last_event_at || null,
          offline_for_sec: offlineForSec,
        };
      });

      res.json({
        summary: {
          total: camerasCurrent.length,
          online: camerasCurrent.filter(c => c.status === 'online').length,
          offline: camerasCurrent.filter(c => c.status === 'offline').length,
          paused: camerasCurrent.filter(c => c.status === 'paused').length,
        },
        cameras: camerasCurrent,
      });
    } catch (err) { routeError(res, err, 'GET /api/cameras/status-current'); }
  });

  // GET /api/cameras/quiet — กล้องที่ "ยังไม่ส่งข้อมูล" อยู่ ณ ตอนนี้
  //
  // 🔴 ทำไมไม่ไปต่อท้าย /api/health/details ตาม CLAUDE.md #12: ป้ายบน topbar ต้อง
  // เห็นทุกหน้าจึงต้อง poll เอง ส่วน details มี 18 คีย์และเคยช้ามาก่อน (เหตุผลเดียว
  // กับที่ routes/devices.js แยกตัวออกมา) — ยิงมันทุก 2 นาทีจากทุกแท็บไม่คุ้ม
  //
  // ตรงนี้ **ไม่แตะตาราง events เลย** · camera_quiet_alerts ถูกคำนวณไว้แล้วโดย
  // alert-worker ทุก 5 นาที และมีแถวเฉพาะกล้องที่กำลังเงียบ (ปกติ 0–4 แถว)
  //
  // ⚠️ แถวเหล่านี้มีอยู่ไม่ว่าการแจ้งเตือน LINE จะเปิดหรือปิด — นั่นคือเหตุผลที่
  // _computeQuietState ถูกแยกออกจาก _quietAnnounce (alert-engine)
  // 🔴 ต้องคิด scope รายผู้ใช้เหมือน /api/stats/executive-summary (เพิ่ม 2026-09-12):
  // ป้ายบน topbar (อ่านจากที่นี่) กับการ์ดบนหน้าสรุป (อ่านจาก summary ที่ scope อยู่แล้ว)
  // แสดงอยู่บนจอเดียวกัน · ถ้าที่นี่คืนทั้งฟลีต ผู้ใช้ที่ถูกจำกัดสิทธิ์จะเห็นสองเลข
  // ที่ไม่ตรงกัน ซึ่งคือปัญหาเดิมที่เพิ่งแก้ไป ย้ายลงมาอีกชั้นเดียว (GOTCHAS #199)
  app.get('/api/cameras/quiet', auth.requireAuth, async (req, res) => {
    try {
      const allowedSites = req.user?.allowedSites ?? null;
      let allowed = null;                       // null = เห็นทั้งหมด
      if (allowedSites !== null) {
        allowed = allowedSites.length
          ? await scopedCameraIds(allowedSites, pool)        // รวมแกนกล้อง (GOTCHAS #166)
          : new Set();
      }
      const { rows } = await pool.query(`
        SELECT q.camera_id, c.name AS camera_name, c.site_id, q.quiet_since,
               extract(epoch from (now() - q.quiet_since))::int AS quiet_sec,
               q.notify_count
          FROM camera_quiet_alerts q
          JOIN cameras c ON c.id = q.camera_id
         WHERE q.quiet_since IS NOT NULL
         ORDER BY q.quiet_since`);
      const cameras = allowed === null ? rows : rows.filter(r => allowed.has(r.camera_id));
      res.json({ count: cameras.length, cameras });
    } catch (err) { routeError(res, err, 'GET /api/cameras/quiet'); }
  });

  // GET /api/cameras/status-log — paginated transition history
  app.get('/api/cameras/status-log', auth.requireAuth, async (req, res) => {
    try {
      const cameraId = req.query.camera_id || null;
      const status   = ['online', 'offline'].includes(req.query.status) ? req.query.status : null;
      const limit    = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset   = Math.max(0, parseInt(req.query.offset, 10) || 0);

      const params = [limit, offset];
      const where = [];
      let paramIndex = 3;
      if (cameraId) {
        where.push(`camera_id = $${paramIndex++}`);
        params.push(cameraId);
      }
      if (status) {
        where.push(`status = $${paramIndex++}`);
        params.push(status);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const { rows } = await pool.query(
        `SELECT id, camera_id, status, changed_at, reason,
                COUNT(*) OVER () AS total_count
         FROM camera_status_log
         ${whereSql}
         ORDER BY changed_at DESC
         LIMIT $1 OFFSET $2`, params
      );
      const total = rows[0]?.total_count ? parseInt(rows[0].total_count, 10) : 0;
      res.set('X-Total-Count', String(total));
      res.json(rows.map(r => ({
        id: r.id, camera_id: r.camera_id, status: r.status,
        changed_at: r.changed_at, reason: r.reason,
      })));
    } catch (err) { routeError(res, err, 'GET /api/cameras/status-log'); }
  });

  // GET /api/cameras/image-quality-log — paginated camera diagnostics history.
  // These are automation/diagnostic signals, not incident/snapshot events.
  //
  // ⚡ 2026-09-05 — เดิมวัดได้ >30s (timeout) ด้วยสองเหตุรวมกัน: ไม่มีขอบเวลาเลย
  // + `COUNT(*) OVER ()` บังคับให้อ่านทุกแถวที่ match ตั้งแต่เปิดระบบเพื่อจะนับ
  // ยอดรวม. โครงใหม่:
  //   1. **จำกัดหน้าต่างที่ 30 วัน** (IQ_WINDOW_DAYS) — เป็นการเปลี่ยนพฤติกรรมที่
  //      ผู้ใช้เห็นได้: รายการเก่ากว่า 30 วันจะไม่ขึ้นอีกต่อไป (ตั้งใจ — เป็น
  //      สัญญาณสุขภาพกล้อง ของเก่ากว่าเดือนไม่มีใครใช้ตัดสินใจ)
  //   2. หา event_type ที่มีจริงในช่วงนั้นจาก event_dim_bucket ก่อน (ปัจจุบัน 4 ตัว
  //      ตรวจแล้วตรงกับที่มีใน events เป๊ะ) แล้วยิงทีละตัวด้วย **เท่ากับ** ต่อ
  //      branch UNION ALL — equality เข้า index event_type ต่อ partition ได้
  //      (26 ms/ตัว) ต่างจาก LIKE/IN สี่ตัวที่ต้องเดิน time index ทั้งช่วง (5.6s)
  //      แต่ละ branch LIMIT (limit+offset) พอเสมอ เพราะแถวที่ติด top-N รวม ย่อม
  //      ติด top-N ใน branch ของตัวเองด้วย
  //   3. ยอดรวม (X-Total-Count) มาจาก event_dim_bucket — **ตามหลังแถวจริง ≤ ~5 นาที**
  //      (รอบ refresher) ตัวเลขจึงอาจน้อยกว่าที่เห็นบนหน้าจอได้ชั่วครู่
  //      ไม่กรอง event_state ที่นี่ เพื่อให้เท่ากับของเดิมที่นับทุก state
  //      ⚠️ และอาจต่ำกว่าแถวจริงเล็กน้อยแบบ **ถาวร** ไม่ใช่แค่ lag: refresher upsert
  //      `n = EXCLUDED.n` ในหน้าต่างย้อนหลัง 3 ชม. เท่านั้น — event ที่มาถึงช้ากว่านั้น
  //      จะไม่ถูกนับใหม่ใน bucket เดิม (พบจริง bucket 2026-08-24 07:30 ของ
  //      BSH-HDY-4031: dim 2 vs events 4) ผลคือหน้าสุดท้ายอาจมีแถวเกินยอดที่แจ้งไว้
  const IQ_TYPE_PREFIXES = ['ImageTooBright', 'ImageTooBlurry', 'ImageTooDark', 'GlobalSceneChange'];
  const IQ_WINDOW_DAYS = 30;
  app.get('/api/cameras/image-quality-log', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const cameraId = req.query.camera_id || null;
      const type = IQ_TYPE_PREFIXES.includes(req.query.type) ? req.query.type : null;
      const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const likes  = (type ? [type] : IQ_TYPE_PREFIXES).map(p => `${p}/%`);

      // 1) candidate event_type ที่มีจริงในหน้าต่าง (จาก rollup — ถูกกว่ามาก)
      const dimParams = [likes];
      let dimCam = '';
      if (cameraId) { dimParams.push(cameraId); dimCam = ` AND camera_id = $${dimParams.length}`; }
      const [candRes, totRes] = await Promise.all([
        pool.query(
          `SELECT DISTINCT event_type FROM event_dim_bucket
            WHERE bucket > now() - interval '${IQ_WINDOW_DAYS} days'
              AND event_type LIKE ANY($1::text[])${dimCam}`, dimParams),
        pool.query(
          `SELECT COALESCE(SUM(n), 0)::bigint AS n FROM event_dim_bucket
            WHERE bucket > now() - interval '${IQ_WINDOW_DAYS} days'
              AND event_type LIKE ANY($1::text[])${dimCam}`, dimParams),
      ]);
      const total = parseInt(totRes.rows[0]?.n || 0, 10);
      res.set('X-Total-Count', String(total));
      // ไม่มี type ไหนยิงเลยในช่วงนี้ → ไม่ต้องแตะ events
      if (candRes.rows.length === 0) return res.json([]);

      // 2) หนึ่ง branch ต่อ type, equality เข้า index ได้
      const params = [limit, offset, limit + offset];
      const branches = candRes.rows.map(r => {
        params.push(r.event_type);
        const tIdx = params.length;
        let camSql = '';
        if (cameraId) { params.push(cameraId); camSql = ` AND e.camera_id = $${params.length}`; }
        return `(SELECT e.id, e.camera_id, e.event_type, e.event_state, e.event_time
                   FROM events e
                  WHERE e.event_type = $${tIdx}
                    AND e.event_time > now() - interval '${IQ_WINDOW_DAYS} days'${camSql}
                  ORDER BY e.event_time DESC
                  LIMIT $3)`;
      });
      const { rows } = await pool.query(
        `SELECT * FROM (${branches.join(' UNION ALL ')}) u
          ORDER BY event_time DESC
          LIMIT $1 OFFSET $2`, params
      );
      res.json(rows.map(r => ({
        id: r.id,
        camera_id: r.camera_id,
        event_type: r.event_type,
        event_state: r.event_state,
        event_time: r.event_time,
      })));
    } catch (err) { routeError(res, err, 'GET /api/cameras/image-quality-log'); }
  });

  // ============================================================
  // API: Live Snapshot Proxy
  // ============================================================

  // Cameras the server can't pull a live frame from (push-only / behind NAT).
  // Auto-detected on live-pull failure; entries expire so a recovered camera
  // resumes live within 60s. push_only in config is the manual override.
  const _LIVE_UNREACHABLE = new Map(); // cameraId → expiry epoch ms
  const _NO_SCENE = new Map();         // cameraId → expiry epoch ms (no _snapshot_full found)

  app.get('/api/snapshot/live/:cameraId', async (req, res) => {
    // unscoped: 🟡 ยังไม่ได้ตรวจสิทธิ์ราย site — ดูบันทึกใน docs (per-user view authz)
    // กล้องถูกอ้างด้วย camera_id ที่ผู้ใช้ต้องรู้อยู่ก่อน และคืนภาพล่าสุดของกล้องนั้นภาพเดียว
    const { cameraId } = req.params;
    const config = loadCameraConfig();
    const cam = (config.cameras || []).find(c => c.camera_id === cameraId);
    if (!cam || !cam.ip_address) return res.status(404).json({ error: 'Camera IP not configured' });

    // Phase 6.1.4 — honor per-camera VCA overlay toggle for the Live snapshot proxy too
    let withOverlay = true;   // default true (preserves prior visual behaviour)
    // Edge-site cameras live on a remote LAN behind the tunnel — central can't
    // reach their IP, so a live pull just times out (~6s) before falling back to
    // the tile. Detect it here (mirrors the /snapshots proxy's is_local_site) and
    // skip straight to the periodic tile below.
    let isEdgeSite = false;
    try {
      const r = await pool.query(
        `SELECT c.enable_snapshot, c.enable_vca_overlay, c.paused,
                (c.site_id IS NOT NULL AND s.code IS DISTINCT FROM 'main') AS is_edge_site
           FROM cameras c LEFT JOIN sites s ON s.id = c.site_id
          WHERE c.id=$1`,
        [cameraId]
      );
      if (r.rows[0]) {
        if (r.rows[0].paused === true) {
          return res.status(503).json({ error: 'Camera paused for maintenance', paused: true });
        }
        if (r.rows[0].enable_snapshot === false) {
          return res.status(403).json({ error: 'Snapshot disabled for this camera' });
        }
        withOverlay = r.rows[0].enable_vca_overlay !== false;
        isEdgeSite  = r.rows[0].is_edge_site === true;
      }
    } catch {}

    // Helper: ส่ง response ครั้งเดียวเท่านั้น (กัน ERR_HTTP_HEADERS_SENT)
    let responseSent = false;

    // Auto preview fallback: when a live frame can't be pulled (push-only /
    // unreachable camera), serve the most recent captured snapshot instead of an
    // error — generic across vendors + event types. Returns true if it responded.
    const serveLatestSnapshot = async () => {
      if (responseSent || res.headersSent) return false;
      const w = req.query.w ? `?w=${encodeURIComponent(req.query.w)}` : '';
      const redirect = (file) => {
        responseSent = true;
        res.redirect(302, `/snapshots/${file.split('/').map(encodeURIComponent).join('/')}${w}`);
      };
      try {
        // NVR channels: some Dahua NVRs ignore the channel param on snapshot.cgi,
        // so the periodic tile is the SAME feed for every channel (live-verified
        // 2026-07-17). The per-face-event scene (_snapshot_full, fetched via RPC2)
        // IS channel-correct — prefer it for NVR channels so each shows its own view.
        const nvr = await pool.query(`SELECT nvr_channel FROM cameras WHERE id=$1`, [cameraId]);
        if (nvr.rows[0]?.nvr_channel != null && !(_NO_SCENE.get(cameraId) > Date.now())) {
          // Time-bound: unbounded ORDER BY event_time walked the whole 38M-row
          // partition set (~38s) for a camera that has events but no
          // _snapshot_full at all (hdy-anpr1 incident 2026-09-03). A preview
          // older than 7 days is useless anyway.
          // 🔴 2026-09-06 — 7 วันยังแพงเกินไป: hdy-anpr1 มี event เยอะแต่ไม่มี
          // _snapshot_full เลย ⇒ ต้องไล่ index ทิ้ง 42,498 แถว + heap fetch raw_json
          // EXPLAIN ANALYZE: 7 วัน = 4,221 ms / 44k buffers · 24 ชม. = 41 ms
          // ภาพนี้คือ "ภาพสดของกล้อง" ภาพเมื่อวานก็ไม่ได้สดอยู่แล้ว จึงเหลือ 24 ชม.
          // ตรวจแล้ว: NVR channel จริงทั้ง 8 ตัวมีฉากในรอบ ≤14 ชม. ⇒ ไม่มีใครเสียของ
          const sc = await pool.query(
            `SELECT raw_json->>'_snapshot_full' AS scene FROM events
               WHERE camera_id = $1 AND raw_json->>'_snapshot_full' IS NOT NULL
                 AND event_time > now() - interval '24 hours'
               ORDER BY event_time DESC LIMIT 1`, [cameraId]);
          if (sc.rows[0]?.scene) { redirect(sc.rows[0].scene); return true; }
          // 10 → 60 นาที: การพลาดครั้งหนึ่งแพงพอที่จะไม่อยากถามซ้ำบ่อย และช่วงที่
          // เจ็บจริงคือหลัง restart (cache ว่าง) ซึ่งวัดได้ 3.6 วิ × 6 ครั้ง
          // แลกกับ: กล้องที่เพิ่งกลับมามีฉากต้องรอไม่เกิน 60 นาทีจึงจะได้ฉากของช่องตัวเอง
          // (ระหว่างนั้นได้ tile รวมของ NVR ซึ่งเป็นพฤติกรรม fallback เดิมอยู่แล้ว)
          _NO_SCENE.set(cameraId, Date.now() + 3600000); // no scene → skip for 60 min
        }
        // Prefer periodic full-scene tile preview over event snapshot (face/LPR cameras
        // would otherwise show a face crop from their most recent recognition event).
        const tp = await pool.query(
          `SELECT tile_snap_file FROM cameras WHERE id=$1 AND tile_snap_file IS NOT NULL`,
          [cameraId]);
        if (tp.rows[0]) { redirect(tp.rows[0].tile_snap_file); return true; }

        // 🔴 last resort เมื่อ tile_snap_file ยังไม่มี (กล้องเพิ่งเพิ่ม/periodic job
        // ยังไม่รันรอบแรก) — ต้องเอา _snapshot_full ก่อนเหมือนกัน ไม่งั้นกล้องใบหน้า
        // จะโชว์ภาพครอปหน้าคน (เจ้าของถาม 2026-09-15: "ทำไม Preview ไม่เป็น Full
        // Scene" ยืนยันจริงว่าเจอตอน tile_snap_file ยังว่างพอดี — เคสเดียวกับที่
        // แก้ไปแล้วใน api-server.js _lastCameraEventSnapshot())
        const r = await pool.query(
          `SELECT COALESCE(raw_json->>'_snapshot_full', snapshot_filename) AS snapshot_filename
             FROM events
             WHERE camera_id = $1 AND has_snapshot = TRUE AND snapshot_filename IS NOT NULL
             ORDER BY event_time DESC LIMIT 1`, [cameraId]);
        if (responseSent || res.headersSent) return true;
        if (r.rows[0]) { redirect(r.rows[0].snapshot_filename); return true; }
      } catch { /* fall through to error */ }
      return false;
    };

    // live-pull failed → mark unreachable (skip the slow live attempt for 60s) and
    // fall back to the latest snapshot; only surface the error if none exists.
    const sendError = (status, msg) => {
      if (responseSent || res.headersSent) return;
      _LIVE_UNREACHABLE.set(cameraId, Date.now() + 60000);
      serveLatestSnapshot().then(served => {
        if (!served && !responseSent && !res.headersSent) { responseSent = true; res.status(status).json({ error: msg }); }
      }).catch(() => {});
    };

    // Manual override (push_only), edge-site camera (unreachable LAN IP), or
    // recently-unreachable → skip live entirely and serve the periodic tile (instant).
    if (cam.push_only || isEdgeSite || (_LIVE_UNREACHABLE.get(cameraId) > Date.now())) {
      if (await serveLatestSnapshot()) return;
      if (!responseSent) { responseSent = true; res.status(404).json({ error: 'no snapshot available' }); }
      return;
    }

    const vendor = String(cam.vendor || 'bosch').toLowerCase();
    const port = cam.http_port || 80;
    // ?w=N → resize the live frame in-flight (Camera Status grid asks
    // for a small thumbnail; the "view full" path omits ?w).
    const resizeW = thumbWidth(req.query.w);

    if (vendor === 'hikvision') {
      // Pick the ISAPI channel by the requested size:
      //  - small thumbnail (grid ?w<=400, detail hero ?w=640) → the
      //    sub-stream (channel 102, ~720p): the 4K main is ~700KB/frame
      //    and several Camera Status cards at once would stall the page.
      //  - "view full" (large ?w, or no ?w) → the main / snapshot_stream
      //    channel so the requested resolution actually EXISTS.
      // Hard-coding channel 102 here previously capped the "view full"
      // button + the per-camera full_view_width at 720p regardless of
      // the camera settings.
      const big = !resizeW || resizeW > 640;
      const ch  = big ? (parseInt(cam.snapshot_stream, 10) || 1) : 2;
      const uri = `/ISAPI/Streaming/channels/10${ch}/picture`;
      _hikDigestSnapshot(cam.ip_address, port, uri,
        cam.username || '', cam.password || '', res, sendError, resizeW);
      return;
    }

    if (vendor === 'dahua') {
      // Dahua CGI snapshot — digest auth. The default path covers most
      // single-channel models; snapshot_path overrides for NVR / multi-channel.
      const uri = cam.snapshot_path || '/cgi-bin/snapshot.cgi?channel=1';
      _hikDigestSnapshot(cam.ip_address, port, uri,
        cam.username || '', cam.password || '', res, sendError, resizeW);
      return;
    }

    if (vendor === 'onvif') {
      // Generic ONVIF / monitor-only — the still-image URL varies per model,
      // so the operator supplies snapshot_path. _hikDigestSnapshot handles
      // both Digest and Basic auth challenges.
      if (!cam.snapshot_path) {
        return sendError(400, 'ONVIF camera: ตั้งค่า Snapshot URL Path ในหน้าตั้งค่ากล้องก่อน');
      }
      _hikDigestSnapshot(cam.ip_address, port, cam.snapshot_path,
        cam.username || '', cam.password || '', res, sendError, resizeW);
      return;
    }

    // Bosch: snap.jpg endpoint, Basic auth. JpegSize omitted → the camera
    // returns its NATIVE resolution (was hard-coded 1280x720, which capped
    // the "view full" button); the ?w=N resize below scales it down for
    // grid / modal thumbnails server-side.
    const url = `http://${cam.ip_address}:${port}/snap.jpg${withOverlay ? '?VCAOverlay=1' : ''}`;
    const options = { timeout: 5000, headers: {} };
    if (cam.username && cam.password) {
      options.headers['Authorization'] = 'Basic ' + Buffer.from(`${cam.username}:${cam.password}`).toString('base64');
    }

    const proxyReq = http.get(url, options, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        proxyRes.resume(); // drain response
        return sendError(502, `Camera returned ${proxyRes.statusCode}`);
      }
      if (responseSent) { proxyRes.resume(); return; }
      responseSent = true;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      if (resizeW) {
        const t = jpegResizer(resizeW);
        t.on('error', () => { try { res.end(); } catch {} });
        proxyRes.pipe(t).pipe(res);
      } else {
        proxyRes.pipe(res);
      }
      proxyRes.on('error', () => res.end());
    });
    proxyReq.on('error', (err) => sendError(502, err.message));
    proxyReq.on('timeout', () => { proxyReq.destroy(); sendError(504, 'Timeout'); });
  });
};
