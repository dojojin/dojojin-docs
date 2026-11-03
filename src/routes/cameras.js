// ============================================================
// Vigil Platform — Routes: Cameras
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const https = require('https');
const routeError         = require('../helpers/routeError');
const { edgeProxyBaseUrl } = require('../helpers/edgeProxyBaseUrl');
const { OFFLINE_THRESHOLD_SEC } = require('../constants');
const env = require('../config');
const publishSiteConfig = require('../helpers/publishSiteConfig');
const { setCamerasPaused } = require('../helpers/cameraPause');
const emqxPublish   = require('../helpers/emqxPublish');
const brokerAdmin    = require('../helpers/brokerAdmin');
const cameraMqttRegistry = require('../helpers/cameraMqttRegistry');
const { pushMqttSettings } = require('../helpers/boschRcp');
const { detectModel } = require('../model-detect');
const sitePurge = require('../helpers/sitePurge');
const { registerConnectivity, registerProbeAndBulk } = require('./cameras-probe');
const camerasHttphostRoutes = require('./cameras-httphost');
const camerasStatusRoutes   = require('./cameras-status');
const { brokerHostname } = require('../helpers/edgeCameraBrokerUrl');
// push_only cameras are event-driven (Alarm Server / ANPR push) with no
// continuous heartbeat — a quiet stretch (no faces/plates) is not "offline".
// LPR's subscribe heartbeat keeps it fresh anyway; this 30-min grace only
// rescues face-push cameras from false offline during quiet periods.
const PUSH_ONLY_OFFLINE_SEC = 30 * 60;

// Resolve which edge site to proxy through for a camera that may not be
// saved yet: prefer the DB-linked site for an existing camera (camera_id
// matches cameras.id), fall back to the site the operator picked in the form
// (site_id) so pre-save "test before you commit" flows can reach an edge too.
async function resolveSiteCode(pool, { camera_id, site_id } = {}) {
  if (camera_id) {
    const { rows } = await pool.query(
      `SELECT s.code FROM cameras c JOIN sites s ON s.id = c.site_id
       WHERE c.id = $1 AND s.code IS NOT NULL AND s.code <> 'main' LIMIT 1`,
      [camera_id]
    );
    if (rows[0]) return rows[0].code;
  }
  if (site_id) {
    const { rows } = await pool.query(
      `SELECT code FROM sites WHERE id = $1 AND code IS NOT NULL AND code <> 'main' LIMIT 1`,
      [site_id]
    );
    if (rows[0]) return rows[0].code;
  }
  return null;
}

const FULL_VIEW_WIDTHS = new Set([960, 1280, 1920, 2560]);

// SEC-008: detect private/loopback/link-local ranges. Audit-log only, never
// blocks — on-prem admin needs LAN cameras + on-prem forward partners are legit.
// Enable hard-rejection only for a multi-tenant cloud SKU.
function _isPrivateIp(ip) {
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.|::1$|fc[0-9a-f]{2}:|fe80:)/i.test(ip) ||
         /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);
}

// CS6: validate an LPR forward endpoint URL set by an admin. Hard-reject what
// forwardToPhuket can't use — malformed or non-http(s) scheme (no legit forward
// target is file://, gopher://, …). Private/loopback hosts are ALLOWED but
// flagged (on-prem partner is legitimate — SEC-008 warn-not-block convention).
// ponytail: literal-IP check only, no DNS resolution — admin-only threat, push
// hot path; runtime is already guarded by forwardToPhuket's try/catch.
function _validateForwardUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: true, url: '' };                 // empty = forwarding off (decision B)
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'invalid_url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'bad_scheme' };
  if (!u.hostname) return { ok: false, error: 'invalid_url' };
  return { ok: true, url: s, isPrivate: _isPrivateIp(u.hostname) };
}

module.exports = function camerasRoutes(app, pool, {
  auth, getIP,
  loadCameraConfig, saveCameraConfig,
  loadGroups, saveGroups,
  logCameraAudit,
  getMapboxToken, getCartoKey,
  license, getCurrentLicenseState,
  thumbWidth, jpegResizer,
  SNAPSHOT_DIR,
}) {

  // Alias to keep all internal call sites unchanged
  const _logCameraAudit = logCameraAudit;

  // ── camera_id sanitiser ──────────────────────────────────────
  // Strips invisible characters that destroy MQTT topic matching.
  // Most common offender: Thai phinthu U+0E3A that sneaks in from a
  // Thai keyboard layout when typing Latin-looking IDs (incident 2026-05-19).
  function _sanitizeCameraId(raw) {
    const original = String(raw || '').trim();
    const cleaned = original.replace(
      /[\x00-\x1f\x7f\u200b-\u200f\ufeff\u0e3a\u0e48-\u0e4e]/g, ''
    );
    return { cleaned, hadDirt: cleaned !== original };
  }

  function _redactCameraAudit(cam) {
    if (!cam || typeof cam !== 'object') return null;
    const out = {};
    for (const [key, value] of Object.entries(cam)) {
      // mqtt_password also redacted — mqtt_provisioned audit event carries the
      // "new password generated" signal separately, so no audit signal is lost.
      out[key] = ['username', 'password', 'mqtt_password', 'face_push_token', 'lpr_push_token'].includes(key) && value ? '***' : value;
    }
    return out;
  }

  // Redact for GET /api/cameras response sent to non-admin roles.
  // mqtt_password is also redacted (plain-text secret); mqtt_username is left
  // visible since it's deterministic (cam-<id>) and not a secret.
  function _redactCameraResponse(cam) {
    if (!cam || typeof cam !== 'object') return null;
    const out = {};
    for (const [key, value] of Object.entries(cam)) {
      out[key] = ['username', 'password', 'mqtt_password', 'face_push_token', 'lpr_push_token'].includes(key) && value ? '***' : value;
    }
    return out;
  }

  // ── Broker auto-provision (SEC-001 Phase 2 — called on Bosch camera save) ──
  // Name kept for call-site stability (2 call sites below). Body now delegates
  // to brokerAdmin.upsertUser — EMQX HTTP calls are byte-identical to before
  // this was rewired (src/helpers/brokerAdmin.js _emqxUpsertUser).
  // ⚠️ addCameraAcl is deliberately NOT called here — today's flow makes no ACL
  // call during camera provision, and M1 keeps that behaviour unchanged
  // (docs/reports/2026-09-27_mosquitto-migration-plan.md M1 acceptance: "deploy
  // with BROKER_KIND=emqx then everything is exactly like before").
  async function _emqxProvisionCamera(cam) {
    // หมายเหตุ: api-server โหลด env จาก src/.env (PM2 cwd=src) — key นี้ต้องอยู่
    // ที่นั่น ไม่ใช่แค่ root .env ของ docker-compose (incident 2026-06-11:
    // ย้ายมา PM2 แล้ว key หล่น → provision คืน null → UI ค้าง "กำลัง provision")
    if (!brokerAdmin.isConfigured()) {
      console.warn('[broker-provision] broker credentials not set in src/.env — cannot provision');
      return null;
    }

    const mqttUser = 'cam-' + cam.camera_id.toLowerCase().replace(/_/g, '-');
    // Reuse existing password (idempotent); generate new only for first-time provision
    const isNew = !cam.mqtt_password;
    const mqttPass = cam.mqtt_password || require('crypto').randomBytes(18).toString('base64url');

    await brokerAdmin.upsertUser(mqttUser, mqttPass, { role: 'camera' });

    return { mqtt_username: mqttUser, mqtt_password: mqttPass, generated_new: isNew };
  }

  function _diffAuditObjects(before, after) {
    const a = before || {};
    const b = after || {};
    const changed = {};
    for (const key of Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        changed[key] = { before: a[key] ?? null, after: b[key] ?? null };
      }
    }
    return changed;
  }

  function _cameraGroupIds(groups, cameraId) {
    return (groups?.groups || [])
      .filter(g => (g.cameraIds || []).includes(cameraId))
      .map(g => g.id);
  }

  function _edgeCall(siteCode, pathAndQuery, { method = 'GET', body = null } = {}) {
    return new Promise((resolve, reject) => {
      const edgeUrl = edgeProxyBaseUrl(siteCode, env.str('SNAPSHOT_PROXY_DOMAIN'));
      const secret  = env.str('SNAPSHOT_PROXY_SECRET');
      if (!secret) return reject(new Error('SNAPSHOT_PROXY_SECRET not configured'));
      const headers = { Authorization: `Bearer ${secret}` };
      if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
      const preq = https.request(`${edgeUrl}${pathAndQuery}`, { method, headers, timeout: 15000 }, (pr) => {
        let b = '';
        pr.on('data', d => { b += d; });
        pr.on('end', () => {
          try { resolve({ code: pr.statusCode, json: JSON.parse(b) }); }
          catch { reject(new Error('bad edge response')); }
        });
      });
      preq.on('error', reject);
      preq.on('timeout', () => { preq.destroy(); reject(new Error('edge timeout')); });
      if (body) preq.write(body);
      preq.end();
    });
  }

  // Per-site Bosch MQTT broker host (migration 248) — site_id(int, sites.id)
  // → hostname reported by that site's edge bridge heartbeat. Admin-only
  // (internal LAN IP); one query per request, not per camera.
  async function _cameraBrokerHosts(pool) {
    const map = new Map();
    const { rows } = await pool.query(
      `SELECT s.id, e.camera_broker_url FROM edge_status e
        JOIN sites s ON s.code = e.site_id
       WHERE e.camera_broker_url IS NOT NULL`
    );
    for (const r of rows) {
      const host = brokerHostname(r.camera_broker_url);
      if (host) map.set(r.id, host); // else: malformed URL somehow past migration 248's validator — skip
    }
    return map;
  }

  // ============================================================
  // Routes
  // ============================================================

  // API: Frontend Config (expose safe env vars)
  app.get('/api/config', async (req, res) => {
    const mapboxToken = await getMapboxToken();
    const cartoKey = await getCartoKey();
    // SEC-017: never send the raw Mapbox token to the client — proxy handles it server-side.
    // CARTO key is intentionally sent (public key by design, not billable) — see carto-plan.md
    res.json({ mapboxAvailable: !!mapboxToken, cartoKey });
  });

  app.get('/api/cameras', async (req, res) => {
    try {
      let dbCameras = {};
      try {
        // Alias canonical schema columns back to legacy shape consumed by
        // the dashboard and merge logic below (camera_id / camera_name /
        // last_seen / location / status).
        const dbResult = await pool.query(`
          SELECT id   AS camera_id,
                 name AS camera_name,
                 ip_address,
                 location_label AS location,
                 last_seen_at   AS last_seen,
                 paused,
                 CASE WHEN paused THEN 'paused' WHEN enabled THEN 'online' ELSE 'offline' END AS status,
                 sd_status, sd_detail_json, recording_data_from, recording_data_until,
                 recording_count, sd_last_check_at, max_hold_sec, max_hold_at,
                 enable_snapshot, enable_vca_overlay, enable_clip_capture, snapshot_mode, meta_crop,
                 clip_pre_sec, clip_post_sec,
                 overlay_show_bbox, overlay_show_zone, overlay_show_trail, ignore_event_types,
                 site_id, cam_role, lpr_direction, sort_order,
                 nvr_channel, capture_categories, device_id, model, firmware, serial_number,
                 recording_nvr_id
            FROM cameras
           ORDER BY last_seen_at DESC NULLS LAST
        `);
        dbResult.rows.forEach(c => { dbCameras[c.camera_id] = c; });
      } catch (e) { /* ignore */ }

      const now = Date.now();
      const config = loadCameraConfig();
      const merged = (config.cameras || []).map(c => {
        const db = dbCameras[c.camera_id] || {};

        // 🆕 Heartbeat-based status: paused beats online/offline
        let status = 'offline';
        if (db.paused) {
          status = 'paused';
        } else if (db.last_seen) {
          const ageSec = (now - new Date(db.last_seen).getTime()) / 1000;
          const threshold = c.push_only ? PUSH_ONLY_OFFLINE_SEC : OFFLINE_THRESHOLD_SEC;
          if (ageSec < threshold) status = 'online';
        }

        // recording flag derived from ONVIF GetRecordingSummary.DataUntil: when
        // SD recording is actively writing, DataUntil tracks real time within
        // seconds of the moment the camera was probed. So freshness is judged
        // against sd_last_check_at (when we asked), NOT wall-clock "now" — edge-
        // site cameras are probed hourly by the edge node (see mqtt-subscriber.js
        // applySdStatusResult), so recording_data_until is routinely tens of
        // minutes old by render time even while genuinely still recording.
        // ~90s threshold gives leeway for clock skew between camera and prober.
        const dataUntilMs = db.recording_data_until ? new Date(db.recording_data_until).getTime() : 0;
        const checkedAtMs = db.sd_last_check_at ? new Date(db.sd_last_check_at).getTime() : now;
        const recording = dataUntilMs > 0 && (checkedAtMs - dataUntilMs) < 90 * 1000;

        return {
          ...c,
          status,
          last_seen: db.last_seen || null,
          recording,
          sd_status: db.sd_status || null,
          // Hikvision's fuller picture (migration 115). Null for every other
          // vendor, so the panel falls back to the ONVIF fields untouched.
          sd_detail: db.sd_detail_json || null,
          // Longest gap between the camera's own timestamp and ours — i.e. how
          // much it has buffered and replayed for us (migration 116). Measured
          // from delivered data, not asked of the camera.
          max_hold_sec: db.max_hold_sec ?? null,
          max_hold_at:  db.max_hold_at  || null,
          recording_data_from:  db.recording_data_from  || null,
          recording_data_until: db.recording_data_until || null,
          recording_count: db.recording_count ?? null,
          sd_last_check_at: db.sd_last_check_at || null,
          // Phase 6.1 — per-camera media capture toggles
          enable_snapshot:     db.enable_snapshot ?? true,
          enable_vca_overlay:  db.enable_vca_overlay ?? true,
          enable_clip_capture: db.enable_clip_capture ?? false,
          snapshot_mode:       db.snapshot_mode || 'both',
          // Migration 164 — ONVIF metadata crop (Bosch only; the edge also
          // checks vendor, so this being true on another vendor does nothing)
          meta_crop:           db.meta_crop === true,
          clip_pre_sec:        db.clip_pre_sec ?? 10,
          clip_post_sec:       db.clip_post_sec ?? 5,
          // Migration 043 — client-side overlay display toggles
          overlay_show_bbox:   db.overlay_show_bbox ?? true,
          // migration 165 — สวิตช์ของเส้นทางเดิน แยกจากกรอบโดยตั้งใจ
          overlay_show_trail:  db.overlay_show_trail === true,
          overlay_show_zone:   db.overlay_show_zone ?? true,
          // Per-camera event suppression (MQTT ingestion)
          ignore_event_types:  db.ignore_event_types ?? [],
          // MS-3: multi-site fields
          site_id:  db.site_id  ?? null,
          cam_role: db.cam_role ?? 'standard',
          lpr_direction: db.lpr_direction ?? null,  // RF5
          sort_order: db.sort_order ?? null,
          model: db.model ?? null,
          firmware: db.firmware ?? null,
          serial_number: db.serial_number ?? null,
          recording_nvr_id: db.recording_nvr_id ?? null,
        };
      });

      // Manual grid order. A camera with no sort_order yet (never touched by
      // the reorder endpoint) keeps its cameras-config.json array position —
      // that's what made it "last" before this feature existed, and it's
      // also why a freshly-added camera still lands last: it's NULL until an
      // admin explicitly moves it via PATCH /api/cameras/reorder.
      merged.forEach((c, i) => { c._configIdx = i; });
      merged.sort((a, b) => (a.sort_order ?? (1e6 + a._configIdx)) - (b.sort_order ?? (1e6 + b._configIdx)));
      merged.forEach(c => { delete c._configIdx; });

      // MS-5: RBAC site scoping. allowedSites is pre-resolved by the global auth
      // middleware (auth.getAllowedSites): null=ALL, []=no sites (fail-open until P2),
      // [id,...]=filter. Internal service calls (no req.user) bypass scoping.
      let scoped = merged;
      const allowedSites = req.user?.allowedSites ?? null;
      if (allowedSites !== null && allowedSites.length > 0) {
        const allowed = new Set(allowedSites);
        scoped = merged.filter(c => allowed.has(c.site_id));
        // แกนที่ 2 — จำกัดรายกล้อง (decision #253) ตัดกับ Site เสมอ · endpoint นี้เป็น
        // แหล่งของ dropdown เลือกกล้องทุกหน้า ถ้าไม่กรองที่นี่ผู้ใช้จะยังเห็นชื่อกล้อง
        // ที่ตัวเองไม่มีสิทธิ์ในตัวเลือก (แม้ยิงข้อมูลไม่ได้ก็ตาม)
        const allowedCams = req.user?.allowedCameras || null;
        if (allowedCams) {
          const camSet = new Set(allowedCams);
          scoped = scoped.filter(c => camSet.has(c.camera_id ?? c.id));
        }
      }

      // Optional ?site_id= filter — coerce to number; absent → all (allowed) cameras
      const siteFilter = req.query.site_id ? Number(req.query.site_id) : null;
      const filtered = siteFilter ? scoped.filter(c => c.site_id === siteFilter) : scoped;

      // SEC-003: admin gets plaintext to prefill the camera-edit form;
      // viewer/auditor have no UI that needs RTSP/MQTT credentials
      const isAdmin = req.user?.role === 'admin';
      // site_admin ได้ plaintext เฉพาะกล้องในไซต์ตัวเอง (`scoped` กรองมาแล้วข้างบน) เพราะฟอร์มแก้ไข
      // prefill รหัสผ่านแล้วส่งกลับทั้งก้อน — ถ้าได้ '***' การกดบันทึกจะเขียนทับรหัสจริงของกล้อง
      // mqtt_broker_host (IP ภายใน) ยังเป็นของ admin อย่างเดียว
      const seesCreds = isAdmin || req.user?.role === 'site_admin';
      let safe = seesCreds ? filtered : filtered.map(_redactCameraResponse);
      // migration 248 — mqtt_broker_host: internal LAN IP, admin-only, Bosch-only.
      // Never let this lookup break the endpoint — fall back to no field.
      if (isAdmin) {
        try {
          const brokerHosts = await _cameraBrokerHosts(pool);
          safe = safe.map(c => {
            if ((c.vendor || 'bosch').toLowerCase() !== 'bosch') return c;
            return { ...c, mqtt_broker_host: brokerHosts.get(c.site_id) || env.str('MQTT_CAMERA_BROKER_HOST') || null };
          });
        } catch (e) { console.warn('[cameras] broker host lookup failed:', e.message); }
      }
      res.json(safe);
    } catch (err) { routeError(res, err, 'GET /api/cameras'); }
  });

  // OPT5-EDGE-004: trigger-on-save model detect (replaces one-time
  // fill-model.js). Fire-and-forget — caller must not await this in the
  // request path. Shared by POST /api/cameras (single add/edit) and
  // POST /api/cameras/bulk-import — connection params travel in the call
  // itself (not a _cameraMap lookup) so this can't race the config-apply for
  // a brand-new or just-edited camera. Edge-site cameras round-trip over MQTT
  // (central can't reach the edge LAN); central-reachable sites detect inline.
  async function triggerModelDetect({ camera_id, ip_address, http_port, username, password, vendor, siteId }) {
    try {
      let siteCode = null;
      if (siteId) {
        const { rows } = await pool.query('SELECT code FROM sites WHERE id = $1', [siteId]);
        siteCode = rows[0]?.code || null;
      }
      const detectReq = {
        camera_id, ip_address, http_port: http_port || 80, username, password, vendor,
        secret: env.str('CAMERA_SECRET_KEY'), // SEC5-HIGH-003 mitigation: edge-config-agent command gate
      };
      if (siteCode && siteCode !== 'main') {
        await emqxPublish(`projects/${siteCode}/_config/detect-model`, detectReq);
      } else {
        const info = await detectModel(
          { ip_address: detectReq.ip_address, username: detectReq.username, vendor: detectReq.vendor },
          detectReq.password
        );
        if (info && info.model) {
          await pool.query(
            `UPDATE cameras SET model=$1, firmware=$2, serial_number=$3, model_detected_at=NOW(), model_detect_error=NULL WHERE id=$4`,
            [info.model, info.firmware, info.serial, camera_id]
          );
        } else {
          await pool.query(
            `UPDATE cameras SET model_detected_at=NOW(), model_detect_error=$1 WHERE id=$2`,
            ['unreachable, auth failed, or model not recognized', camera_id]
          );
        }
      }
    } catch (e) { console.warn('[model-detect] trigger-on-save failed:', e.message); }
  }

  app.post('/api/cameras', async (req, res) => {
    try {
      if (!req.body || !req.body.camera_id) return res.status(400).json({ error: 'camera_id is required' });

      const config = loadCameraConfig();
      if (!config.cameras) config.cameras = [];

      // Sanitise camera_id BEFORE anything else writes/looks it up. Three
      // classes of trouble we warn on (decision 2026-05-19, after the
      // BOSCH_8000i Thai-phinthu incident):
      //   1. Invisible/control characters in the id (auto-fixed; operator
      //      should re-type to avoid keyboard-layout repeats).
      //   2. Non-ASCII in the id — legitimate Thai camera_id is allowed,
      //      but operators commonly hit this by accident; flag for review.
      //   3. Same IP already used by a DIFFERENT camera_id — usually means
      //      hardware replacement; the operator should reuse the existing
      //      id, not create a parallel entry that fragments stats/alerts.
      // Operator overrides by re-sending with ?force=1 (frontend turns the
      // "ดำเนินการต่อ" confirm button into that query param).
      const { cleaned: cleanedId, hadDirt } = _sanitizeCameraId(req.body.camera_id);
      if (!cleanedId) return res.status(400).json({ error: 'camera_id is empty after stripping invisible characters' });

      const warnings = [];
      if (hadDirt) {
        warnings.push({
          code: 'invisible_chars_stripped',
          message_th: `camera_id เดิมมีอักขระมองไม่เห็น — แก้เป็น "${cleanedId}" แล้ว (ตรวจ keyboard layout ตอนพิมพ์ — Thai keyboard ค้างมัก typo อักขระเสริมเข้ามา)`,
        });
      }
      if (/[^\x20-\x7e]/.test(cleanedId)) {
        warnings.push({
          code: 'non_ascii_id',
          message_th: `camera_id "${cleanedId}" มีอักขระไม่ใช่ ASCII — ตรวจสอบให้แน่ใจว่าตั้ง MQTT topic prefix ที่ Bosch CM ให้ตรงกันเป๊ะ ๆ`,
        });
      }
      const ip = String(req.body.ip_address || '').trim();
      if (ip) {
        const ipDup = config.cameras.find(c => c.camera_id !== cleanedId && c.ip_address === ip);
        // Suppress the false positive for a legitimate multi-channel NVR (e.g.
        // Dahua ch0/ch1 sharing one device IP by design — dahua-cgi.js treats
        // same ip:port:user as ONE physical device with multiple channels).
        // Read nvr_channel from the EXISTING config entries, not req.body —
        // the edit form never sends nvr_channel (only set via the add-camera
        // flow, parsed further down at line ~585), so checking req.body here
        // would always see undefined and this check would never suppress.
        // Only suppress when BOTH sides have a defined, DISTINCT channel —
        // same channel number (or either side missing one) still warns, since
        // that's the genuine hardware-swap/accidental-duplicate case this
        // check exists for (live incident: HDY-NVR-04-ch0/ch1 name+location
        // got cross-written after an operator hit this warning while editing
        // one channel of a legitimate 2-channel NVR, 2026-07-16).
        const editingEntry = config.cameras.find(c => c.camera_id === cleanedId);
        const sameDeviceDifferentChannel = ipDup
          && editingEntry && Number.isInteger(editingEntry.nvr_channel)
          && Number.isInteger(ipDup.nvr_channel)
          && editingEntry.nvr_channel !== ipDup.nvr_channel;
        if (ipDup && !sameDeviceDifferentChannel) {
          warnings.push({
            code: 'duplicate_ip',
            message_th: `IP ${ip} ใช้อยู่กับกล้อง "${ipDup.camera_id}" แล้ว — ถ้าเปลี่ยน hardware ตัวเดียวกัน แนะนำใช้ camera_id เดิม "${ipDup.camera_id}" เพื่อรักษา historical events + alert rules + stats`,
            existing_camera_id: ipDup.camera_id,
          });
        }
      }
      // Soft-block on warnings unless the operator passed ?force=1.
      if (warnings.length > 0 && req.query.force !== '1') {
        return res.status(409).json({ warnings, suggested_camera_id: cleanedId });
      }
      // Body looks clean — replace camera_id with the sanitised version so
      // the downstream INSERT/UPDATE uses the canonical form.
      req.body.camera_id = cleanedId;

      // Phase 8.0 — camera-count enforcement against the active license's
      // tier limit. Only enforced when the public key is configured AND we
      // hold a LICENSED state (trial/no-license deployments get unlimited
      // headroom by design — once the operator activates a real license,
      // the cap kicks in). Edits to existing cameras (same id) always pass
      // regardless of count.
      if (license.isPublicKeyConfigured()) {
        const state = await getCurrentLicenseState();
        if (state.mode === 'LICENSED' && state.payload && state.payload.max_cameras) {
          const newId = String(req.body.camera_id).trim();
          const isUpdate = config.cameras.some(c => c.camera_id === newId);
          if (!isUpdate && config.cameras.length >= state.payload.max_cameras) {
            return res.status(403).json({
              error: 'license_camera_limit',
              message_th: `License ปัจจุบัน (${state.payload.tier}) รองรับสูงสุด ${state.payload.max_cameras} กล้อง — ติดต่อทีมงานเพื่ออัพเกรด`,
              max_cameras: state.payload.max_cameras,
              current_count: config.cameras.length,
              tier: state.payload.tier,
            });
          }
        }
      }

      // Existing entry (if this is an edit) — used to preserve optional
      // fields the form may not re-send (http_port / stream selectors).
      const prevIdx = config.cameras.findIndex(c => c.camera_id === cleanedId);
      const prev = prevIdx >= 0 ? (config.cameras[prevIdx] || {}) : {};
      const prevAudit = _redactCameraAudit(prev);

      const VALID_VENDORS = ['bosch', 'hikvision', 'dahua', 'onvif'];
      const vendorRaw = String(req.body.vendor || prev.vendor || 'bosch').toLowerCase();
      const newCam = {
        camera_id: String(req.body.camera_id).trim(),
        camera_name: String(req.body.camera_name || req.body.camera_id).trim(),
        vendor: VALID_VENDORS.includes(vendorRaw) ? vendorRaw : 'bosch',
        ip_address: String(req.body.ip_address || '').trim(),
        username: String(req.body.username || '').trim(),
        password: String(req.body.password || ''),
        latitude: req.body.latitude ? parseFloat(req.body.latitude) : null,
        longitude: req.body.longitude ? parseFloat(req.body.longitude) : null,
        location: String(req.body.location || '').trim(),
        notes: String(req.body.notes || '').trim(),
      };
      // Optional fields — body value wins, else preserve the existing entry's.
      // Omitted entirely (not null) when unset so the JSON stays tidy.
      const httpPort  = parseInt(req.body.http_port, 10)       || prev.http_port;
      const clipStr   = parseInt(req.body.clip_stream, 10)     || prev.clip_stream;
      const snapStr   = parseInt(req.body.snapshot_stream, 10) || prev.snapshot_stream;
      if (httpPort) newCam.http_port      = httpPort;
      if (clipStr)  newCam.clip_stream     = clipStr;
      if (snapStr)  newCam.snapshot_stream = snapStr;
      // snapshot_path — HTTP still-image path for the generic-HTTP vendors
      // (Dahua CGI, generic ONVIF). The form always sends the field, so body
      // value wins (lets the operator clear it); else preserve the entry's.
      const snapPath = req.body.snapshot_path !== undefined
        ? String(req.body.snapshot_path).trim()
        : String(prev.snapshot_path || '').trim();
      if (snapPath) newCam.snapshot_path = snapPath;
      // full_view_width — Phase 2 per-camera cap (px) for the "view full"
      // button. Empty / out-of-set = no cap (serve the native original).
      // The form always sends the field, so body wins (lets the operator
      // clear it back to native).
      const fullW = req.body.full_view_width !== undefined
        ? (FULL_VIEW_WIDTHS.has(parseInt(req.body.full_view_width, 10))
            ? parseInt(req.body.full_view_width, 10) : null)
        : (prev.full_view_width || null);
      if (fullW) newCam.full_view_width = fullW;
      // IM5 Phase 1 — site label (free string, all vendors). Tags which physical
      // site a camera belongs to so a future detector (IM5 Phase 2) can tell
      // "whole site/link down" from "one camera down". Explicit per-camera —
      // NEVER guessed from subnet/gateway. Body wins, else preserve; empty clears.
      const site = req.body.site !== undefined ? String(req.body.site).trim() : String(prev.site || '').trim();
      if (site) newCam.site = site;
      // push_only — Hikvision cameras that send events to us (FAS/ANPR push receiver)
      // and must NOT be pulled (the ingester skips them — IM1). Body wins, else preserve
      // the existing entry's flag so a form-edit never silently re-enables pull spam.
      const pushOnly = req.body.push_only !== undefined ? !!req.body.push_only : !!prev.push_only;
      if (pushOnly) newCam.push_only = true;
      // CS2/CS6 — per-camera LPR forward override (Hikvision only). Body wins (validated),
      // else preserve. Empty body value clears it → forwarding off (decision B = opt-in,
      // no global default). The lpr_forward_url change is captured in the camera_update
      // audit diff below (PDPA: plate/image egress to an external partner).
      if ((newCam.vendor || prev.vendor || 'bosch').toLowerCase() === 'hikvision') {
        if (req.body.lpr_forward_url !== undefined) {
          const fv = _validateForwardUrl(req.body.lpr_forward_url);
          if (!fv.ok) return res.status(400).json({ error: 'lpr_forward_url_invalid', reason: fv.error });
          if (fv.url) {
            newCam.lpr_forward_url = fv.url;
            if (fv.isPrivate) console.warn(`[SEC-008] LPR forward target is a private/loopback host: ${fv.url} (cam ${newCam.camera_id}) set by ${req.user?.username} (${getIP(req)})`);
          } // empty → leave unset = forwarding off
        } else if (prev.lpr_forward_url) {
          newCam.lpr_forward_url = prev.lpr_forward_url; // preserve on edit-without-field
        }
        // F2 — the same field for face pushes, and it has to be its own because
        // the two go to different hosts on different paths: ANPR to .106 on one
        // shared /receive_hik_phuget, faces to .105 on a per-camera /v2/<UUID>
        // that CIB issued. The UUID is the camera's identity there, so this is
        // never derived from anything — it is copied from what the camera itself
        // was already configured with (captured in camera_httphost_backups, F1).
        // Sending camera A's faces to camera B's UUID would file a person at the
        // wrong place, which is worse than not sending at all.
        if (req.body.face_forward_url !== undefined) {
          const fv = _validateForwardUrl(req.body.face_forward_url);
          if (!fv.ok) return res.status(400).json({ error: 'face_forward_url_invalid', reason: fv.error });
          if (fv.url) {
            newCam.face_forward_url = fv.url;
            if (fv.isPrivate) console.warn(`[SEC-008] face forward target is a private/loopback host: ${fv.url} (cam ${newCam.camera_id}) set by ${req.user?.username} (${getIP(req)})`);
          } // empty → leave unset = forwarding off
        } else if (prev.face_forward_url) {
          newCam.face_forward_url = prev.face_forward_url;
        }
      }
      // Dahua NVR multi-channel support (Phase 1)
      // nvr_channel — 0-based Dahua NVR channel index. Body wins, else preserve.
      const nvrCh = req.body.nvr_channel !== undefined
        ? parseInt(req.body.nvr_channel, 10)
        : (prev.nvr_channel !== undefined ? prev.nvr_channel : undefined);
      if (nvrCh !== undefined && nvrCh >= 0 && Number.isInteger(nvrCh)) {
        newCam.nvr_channel = nvrCh;
      }
      // capture_categories — array of event categories to ingest (e.g. ['face'], ['anpr', 'vehicle']).
      // Body wins (if array), else preserve. Omitted if empty or not provided.
      const capCats = Array.isArray(req.body.capture_categories)
        ? req.body.capture_categories
        : (Array.isArray(prev.capture_categories) ? prev.capture_categories : undefined);
      if (Array.isArray(capCats) && capCats.length > 0) {
        newCam.capture_categories = capCats;
      }
      // Preserve MQTT credentials across edits — these are set by auto-provision
      // and must not be erased when the operator edits other camera fields.
      if (prev.mqtt_username) newCam.mqtt_username = prev.mqtt_username;
      if (prev.mqtt_password) newCam.mqtt_password = prev.mqtt_password;
      // Preserve the face-push token (IM3-R) — set by its own endpoint; a normal
      // form-edit must not wipe it (would break the camera's configured push URL).
      // Body may send '***' (redacted echo for non-admin) — never persist that.
      if (prev.face_push_token) newCam.face_push_token = prev.face_push_token;
      // Preserve the LPR push token — same pattern as face_push_token.
      if (prev.lpr_push_token) newCam.lpr_push_token = prev.lpr_push_token;

      const idx = prevIdx;
      if (idx >= 0) config.cameras[idx] = newCam;
      else config.cameras.push(newCam);

      if (!saveCameraConfig(config)) throw new Error('Failed to save config');

      // Auto-provision EMQX MQTT credentials for Bosch cameras (sync, 5s timeout)
      let mqttCreds = null;
      let mqttStatus = 'skipped';
      if ((newCam.vendor || 'bosch').toLowerCase() === 'bosch') {
        try {
          const provPromise = _emqxProvisionCamera(newCam);
          const timeoutPromise = new Promise((_, rej) =>
            setTimeout(() => rej(new Error('broker provision timeout')), 5000)
          );
          mqttCreds = await Promise.race([provPromise, timeoutPromise]);
          // null = broker credential env ไม่ถูกตั้ง (EMQX_DASHBOARD_PASSWORD หรือ
          // MQTT_PROVISIONER_*) — อย่าปล่อยไปตายที่ null.mqtt_username ข้างล่าง
          // (error เดิมหลอกทางหาสาเหตุ)
          if (!mqttCreds) throw new Error('broker credentials not set in src/.env');
          mqttStatus = 'provisioned';
          // Re-read config from disk (guards against concurrent writes) and
          // merge in the new credentials before writing back.
          const fresh = loadCameraConfig();
          const fi = fresh.cameras.findIndex(c => c.camera_id === newCam.camera_id);
          if (fi >= 0) {
            fresh.cameras[fi].mqtt_username = mqttCreds.mqtt_username;
            fresh.cameras[fi].mqtt_password = mqttCreds.mqtt_password;
            saveCameraConfig(fresh);
          }
          newCam.mqtt_username = mqttCreds.mqtt_username;
          newCam.mqtt_password = mqttCreds.mqtt_password;
        } catch (err) {
          console.warn('[broker-provision]', newCam.camera_id, err.message);
          mqttStatus = 'pending'; // camera saved; EMQX provision deferred
        }
      }

      // Phase 6.1 — media capture toggles (DB-only, not in JSON config)
      let previousToggles = {};
      try {
        const tr = await pool.query(
          `SELECT enable_snapshot, enable_vca_overlay, enable_clip_capture, clip_pre_sec, clip_post_sec,
                  overlay_show_bbox, overlay_show_zone, overlay_show_trail, snapshot_mode, meta_crop
             FROM cameras WHERE id=$1`,
          [newCam.camera_id]
        );
        previousToggles = tr.rows[0] || {};
      } catch {}
      const toggles = {
        enable_snapshot:     req.body.enable_snapshot     === undefined ? true  : !!req.body.enable_snapshot,
        enable_vca_overlay:  req.body.enable_vca_overlay  === undefined ? true  : !!req.body.enable_vca_overlay,
        enable_clip_capture: req.body.enable_clip_capture === undefined ? false : !!req.body.enable_clip_capture,
        // Snapshot source mode (migration 160) — separate from enable_snapshot
        // (the master on/off): decides which capture path(s) run when it's on.
        snapshot_mode:        ['both', 'mqtt_only', 'http_only'].includes(req.body.snapshot_mode) ? req.body.snapshot_mode : 'both',
        // Absent means "leave it alone", not "turn it off" — unlike the toggles
        // above, this one is newer than some clients, and a PUT from anything
        // that predates it would otherwise silently stop a camera's metadata
        // session with nothing in the UI to explain why.
        meta_crop:           req.body.meta_crop === undefined
                               ? previousToggles.meta_crop === true
                               : !!req.body.meta_crop,
        clip_pre_sec:        Math.max(1, Math.min(60, parseInt(req.body.clip_pre_sec,  10) || 10)),
        clip_post_sec:       Math.max(0, Math.min(30, parseInt(req.body.clip_post_sec, 10) ||  5)),
        // Migration 043 — client-side overlay display toggles
        overlay_show_bbox:   req.body.overlay_show_bbox   === undefined ? true  : !!req.body.overlay_show_bbox,
        // ไม่มีค่ามา = คงค่าเดิม ไม่ใช่ปิด — เหตุผลเดียวกับ meta_crop: client ที่เก่ากว่า
        // คอลัมน์นี้ ไม่ควรปิดของที่ผู้ใช้เปิดไว้โดยที่หน้าจอไม่มีอะไรบอก
        overlay_show_trail:  req.body.overlay_show_trail === undefined
                               ? previousToggles.overlay_show_trail === true
                               : !!req.body.overlay_show_trail,
        overlay_show_zone:   req.body.overlay_show_zone   === undefined ? true  : !!req.body.overlay_show_zone,
        // Per-camera event suppression (MQTT ingestion)
        ignore_event_types: Array.isArray(req.body.ignore_event_types) ? req.body.ignore_event_types : [],
      };

      const siteId = (req.body.site_id !== undefined && req.body.site_id !== null && req.body.site_id !== '')
        ? (parseInt(req.body.site_id, 10) || null) : null;
      // cam_role = manual deployment tag (standard|lpr|face). null = not in body →
      // COALESCE preserves the existing value (form-edit never silently resets it).
      const camRole = ['standard', 'lpr', 'face'].includes(req.body.cam_role) ? req.body.cam_role : null;

      try {
        // NVR channel config (migration 083). undefined → null → COALESCE keeps
        // the existing value so a plain form-edit never wipes it.
        const nvrChannel = Number.isInteger(newCam.nvr_channel) ? newCam.nvr_channel : null;
        const capCats    = Array.isArray(newCam.capture_categories) ? newCam.capture_categories : null;
        const deviceId   = newCam.device_id || null;
        const updateResult = await pool.query(
          `UPDATE cameras SET
             name=$2, ip_address=$3, location_label=$4,
             enable_snapshot=$5, enable_vca_overlay=$6,
             enable_clip_capture=$7, clip_pre_sec=$8, clip_post_sec=$9,
             overlay_show_bbox=$10, overlay_show_zone=$11, ignore_event_types=$12, overlay_show_trail=$20,
             site_id=$13, cam_role=COALESCE($14, cam_role),
             nvr_channel=COALESCE($15, nvr_channel),
             capture_categories=COALESCE($16, capture_categories),
             device_id=COALESCE($17, device_id),
             snapshot_mode=$18, meta_crop=$19
           WHERE id=$1`,
          [newCam.camera_id, newCam.camera_name, newCam.ip_address, newCam.location,
           toggles.enable_snapshot, toggles.enable_vca_overlay,
           toggles.enable_clip_capture, toggles.clip_pre_sec, toggles.clip_post_sec,
           toggles.overlay_show_bbox, toggles.overlay_show_zone, toggles.ignore_event_types,
           siteId, camRole, nvrChannel, capCats, deviceId, toggles.snapshot_mode, toggles.meta_crop,
           toggles.overlay_show_trail]
        );
        if (updateResult.rowCount === 0) {
          await pool.query(
            `INSERT INTO cameras (id, name, ip_address, location_label, enabled,
                                   enable_snapshot, enable_vca_overlay,
                                   enable_clip_capture, clip_pre_sec, clip_post_sec,
                                   overlay_show_bbox, overlay_show_zone, overlay_show_trail, ignore_event_types,
                                   site_id, cam_role, nvr_channel, capture_categories, device_id,
                                   snapshot_mode, meta_crop)
             VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7,$8,$9,$10,$11,$20,$12,$13,COALESCE($14,'standard'),$15,$16,$17,$18,$19)`,
            [newCam.camera_id, newCam.camera_name, newCam.ip_address, newCam.location,
             toggles.enable_snapshot, toggles.enable_vca_overlay,
             toggles.enable_clip_capture, toggles.clip_pre_sec, toggles.clip_post_sec,
             toggles.overlay_show_bbox, toggles.overlay_show_zone, toggles.ignore_event_types,
             siteId, camRole, nvrChannel, capCats, deviceId, toggles.snapshot_mode, toggles.meta_crop,
             toggles.overlay_show_trail]
          );
        }
      } catch (dbErr) { console.warn('DB sync warn:', dbErr.message); }

      // Dual-write ignore_event_types to cameras-config.json so mqtt-subscriber
      // picks up the change via fs.watch without a restart
      const cfgForIgnore = loadCameraConfig();
      const ignIdx = (cfgForIgnore.cameras || []).findIndex(c => c.camera_id === newCam.camera_id);
      if (ignIdx >= 0) {
        cfgForIgnore.cameras[ignIdx].ignore_event_types = toggles.ignore_event_types;
        saveCameraConfig(cfgForIgnore);
      }

      // EC1: push updated site config to edge via retained MQTT (fire-and-forget)
      if (siteId) publishSiteConfig(siteId, cfgForIgnore.cameras, pool).catch(e =>
        console.warn('[edge-config] publish failed:', e.message)
      );

      // Fire-and-forget — never blocks the Save response.
      triggerModelDetect({
        camera_id: newCam.camera_id, ip_address: newCam.ip_address,
        http_port: newCam.http_port || 80, username: newCam.username,
        password: newCam.password, vendor: newCam.vendor, siteId,
      });

      // Bosch Event Broker auto-configure on save — mirrors how Hikvision's
      // configureAlarmServer() runs automatically every time its ingester
      // syncs a camera; Bosch has no equivalent background process, so this
      // is the trigger instead. Fire-and-forget — a failed attempt (edge
      // unreachable right now, wrong credentials) never blocks the camera
      // row from saving; idempotent on the edge side (matches on Address +
      // TopicPrefix), so the next save retries cleanly. Edge-site only —
      // central has no direct path to a LAN camera to configure this itself.
      if ((newCam.vendor || 'bosch').toLowerCase() === 'bosch') {
        (async () => {
          try {
            let siteCode = null;
            if (siteId) {
              const { rows } = await pool.query('SELECT code FROM sites WHERE id = $1', [siteId]);
              siteCode = rows[0]?.code || null;
            }
            if (!siteCode || siteCode === 'main') return;
            const edgeUrl = edgeProxyBaseUrl(siteCode, env.str('SNAPSHOT_PROXY_DOMAIN'));
            const secret = env.str('SNAPSHOT_PROXY_SECRET');
            if (!secret) throw new Error('SNAPSHOT_PROXY_SECRET not configured');
            const url = `${edgeUrl}/event-broker-configure?camera_id=${encodeURIComponent(newCam.camera_id)}`;
            await new Promise((resolve, reject) => {
              const preq = https.request(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Length': 0 }, timeout: 10000 }, (pr) => {
                let body = ''; pr.on('data', d => { body += d; });
                pr.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('bad edge response')); } });
              });
              preq.on('error', reject);
              preq.end();
            });
          } catch (e) { console.warn('[event-broker] trigger-on-save failed:', newCam.camera_id, e.message); }
        })();
      }

      const action = prevIdx >= 0 ? 'camera_update' : 'camera_create';
      const before = prevIdx >= 0 ? { ...prevAudit, ...previousToggles } : null;
      const after = { ..._redactCameraAudit(newCam), ...toggles };
      // รหัสผ่านถูกปิดเป็น '***' ทั้งสองฝั่งใน changed_fields → มองไม่เห็นว่าเปลี่ยน · บอกตรง ๆ ว่าช่องไหน
      // ถูกตั้ง/เปลี่ยน (ไม่เก็บค่า) — เจ้าของขอ 2026-10-14 เมื่อให้ Site Admin เห็น/แก้รหัสกล้องของไซต์ตัวเอง
      const credentialsChanged = ['username', 'password']
        .filter((k) => String(prev[k] || '') !== String(newCam[k] || ''));
      await _logCameraAudit(req, action, newCam.camera_id, {
        camera_id: newCam.camera_id,
        actor_role: req.user?.role || null,
        site_id: siteId,
        ...(credentialsChanged.length ? { credentials_changed: credentialsChanged } : {}),
        changed_fields: before ? _diffAuditObjects(before, after) : after,
      });

      // Separate audit event for MQTT provision (security trail — compensates for
      // the trust boundary change: provisioning now possible from UI, not just SSH)
      if (mqttCreds) {
        await _logCameraAudit(req, 'mqtt_provisioned', newCam.camera_id, {
          mqtt_username: mqttCreds.mqtt_username,
          generated_new_password: mqttCreds.generated_new,
        });
      }

      // migration 248 — per-site broker host, falling back to the env default
      let mqttBrokerHost = env.str('MQTT_CAMERA_BROKER_HOST') || null;
      try {
        const brokerHosts = await _cameraBrokerHosts(pool);
        if (siteId && brokerHosts.has(siteId)) mqttBrokerHost = brokerHosts.get(siteId);
      } catch (e) { console.warn('[cameras] broker host lookup failed:', e.message); }

      res.json({
        success: true,
        camera: newCam,
        mqtt_status: mqttStatus,
        mqtt_broker_host: mqttBrokerHost,
      });
    } catch (err) { routeError(res, err, 'POST /api/cameras'); }
  });

  // POST /api/cameras/:id/mqtt/regenerate — force-rotate the MQTT password for
  // a Bosch camera. Returns the new cleartext password as a one-time reveal so
  // the operator can enter it in the camera's own web UI to reconnect.
  // NOTE: intentionally NOT passed through _redactCameraResponse — the
  // cleartext is the whole point; admin-only, one-time reveal on success.
  app.post('/api/cameras/:id/mqtt/regenerate', auth.requireAdmin, async (req, res) => {
    try {
      const rawId = req.params.id;
      if (!/^[a-z0-9-]+$/i.test(rawId)) return res.status(400).json({ error: 'Invalid camera_id format' });
      const cameraId = rawId.toLowerCase();

      const config = loadCameraConfig();
      const idx = config.cameras.findIndex(c => c.camera_id === cameraId);
      if (idx < 0) return res.status(404).json({ error: 'Camera not found' });
      const cam = config.cameras[idx];
      if ((cam.vendor || 'bosch').toLowerCase() !== 'bosch') {
        return res.status(400).json({ error: 'MQTT regenerate is only available for Bosch cameras' });
      }

      // Force-generate new password by stripping the existing one before provisioning
      const camForRegen = { ...cam, mqtt_password: undefined };
      const creds = await _emqxProvisionCamera(camForRegen);
      if (!creds) return res.status(503).json({ error: 'broker credentials not configured — cannot regenerate' });

      // Atomic write — re-read to guard against concurrent edits
      const fresh = loadCameraConfig();
      const fi = fresh.cameras.findIndex(c => c.camera_id === cameraId);
      if (fi >= 0) {
        fresh.cameras[fi].mqtt_username = creds.mqtt_username;
        fresh.cameras[fi].mqtt_password = creds.mqtt_password;
        if (!saveCameraConfig(fresh)) throw new Error('Failed to save config');
      }

      await _logCameraAudit(req, 'mqtt_regenerated', cameraId, {
        mqtt_username: creds.mqtt_username,
      });

      res.json({ success: true, mqtt_username: creds.mqtt_username, mqtt_password: creds.mqtt_password });
    } catch (err) {
      console.error('[mqtt-regenerate]', err);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  // POST /api/cameras/:id/push-mqtt — write the camera's own broker/username/
  // password (Mosquitto migration phase B1, decision 6.1 item 4). Central-
  // reachable cameras (site 'main'/unassigned) are written to directly; an
  // edge-site camera round-trips over MQTT to that site's edge-config-agent
  // (central cannot reach the edge LAN) and this route waits on the reply
  // with a timeout, same request/result shape as reboot/scan-nvr elsewhere in
  // this codebase. Never returns the camera's mqtt_password — the response
  // (and the audit row) only ever carry {ok, before, after, error}, and
  // before/after come from boschRcp's decodeMqttSettings(), which drops the
  // password tag unconditionally.
  app.post('/api/cameras/:id/push-mqtt', auth.requireAdmin, async (req, res) => {
    try {
      const rawId = req.params.id;
      if (!/^[A-Za-z0-9_-]+$/.test(rawId)) return res.status(400).json({ error: 'Invalid camera_id format' });

      const config = loadCameraConfig(); // already decrypted (loadCameraConfig() runs decryptCamCreds on read)
      const cam = (config.cameras || []).find(c => c.camera_id === rawId);
      if (!cam) return res.status(404).json({ error: 'Camera not found' });
      if ((cam.vendor || 'bosch').toLowerCase() !== 'bosch') {
        return res.status(400).json({ error: 'push-mqtt is only available for Bosch cameras' });
      }
      if (!cam.mqtt_username || !cam.mqtt_password) {
        return res.status(400).json({ error: 'camera has no mqtt_username/mqtt_password — provision first' });
      }

      const { rows } = await pool.query(
        `SELECT s.code AS site_code FROM cameras c LEFT JOIN sites s ON s.id = c.site_id WHERE c.id = $1`,
        [rawId]
      );
      const siteCode = rows[0]?.site_code || null;

      let result;
      if (siteCode && siteCode !== 'main') {
        const reqId = require('crypto').randomUUID();
        cameraMqttRegistry.register(reqId);
        await emqxPublish(`projects/${siteCode}/_config/camera-mqtt`, {
          req_id: reqId, camera_id: rawId, secret: env.str('CAMERA_SECRET_KEY'),
        });
        const entry = await cameraMqttRegistry.waitFor(reqId, 60_000); // write + read-back + reboot needs more than the 40s default
        if (!entry) {
          // Not a failure — the edge may still be mid round-trip (RCP over
          // digest auth can take a few seconds) or the reply may simply not
          // have arrived yet. Never tell the operator it failed when we
          // genuinely don't know.
          return res.status(504).json({ ok: false, via: 'edge', req_id: reqId,
            error: 'ยังไม่ได้รับคำตอบจาก edge — ผลลัพธ์ยังไม่ทราบ (อาจสำเร็จแล้วก็ได้) ลองตรวจกล้องหรือกดใหม่อีกครั้ง' });
        }
        result = entry.data || { ok: entry.status === 'ready', error: entry.error };
      } else {
        result = await pushMqttSettings(cam);
      }

      const rebootAudit = result.reboot
        ? { ok: !!result.reboot.ok, unconfirmed: !!result.reboot.unconfirmed, error: result.reboot.error || null }
        : null;
      await _logCameraAudit(req, 'mqtt_pushed_to_camera', rawId, {
        camera_id: rawId, ok: !!result.ok, error: result.error || null, via: siteCode && siteCode !== 'main' ? 'edge' : 'central',
        reboot: rebootAudit,
      });

      res.json({ ok: !!result.ok, before: result.before || null, after: result.after || null,
        error: result.error || null, via: siteCode && siteCode !== 'main' ? 'edge' : 'central',
        reboot: result.reboot || null,
        // stamped on central, not taken from the edge: the UI compares it with
        // cameras.last_mqtt_at (central clock) and edge clocks are not trusted
        rebooted_at: result.reboot && result.reboot.ok ? new Date().toISOString() : null });
    } catch (err) { routeError(res, err, 'POST /api/cameras/:id/push-mqtt'); }
  });

  // GET /api/cameras/:id/mqtt-seen — last time this camera's own MQTT
  // messages were seen (cameras.last_mqtt_at, set by mqtt-subscriber from the
  // receive time of the camera's onvif-ej/ topic, flushed every 60s — not a
  // live probe). Used by the push-mqtt UI to poll for "camera reconnected
  // under the new broker" after the reboot it triggers.
  app.get('/api/cameras/:id/mqtt-seen', auth.requireAdmin, async (req, res) => {
    try {
      const rawId = req.params.id;
      if (!/^[A-Za-z0-9_-]+$/.test(rawId)) return res.status(400).json({ error: 'Invalid camera_id format' });
      const { rows } = await pool.query('SELECT last_mqtt_at FROM cameras WHERE id = $1', [rawId]);
      if (!rows[0]) return res.status(404).json({ error: 'Camera not found' });
      res.json({ last_mqtt_at: rows[0].last_mqtt_at });
    } catch (err) { routeError(res, err, 'GET /api/cameras/:id/mqtt-seen'); }
  });

  // POST /api/cameras/:id/face-push-token — generate (or rotate) the per-camera
  // secret token for the cross-site face-push receiver (IM3-R). Returns the token
  // so the UI can show the full https://<host>/face-push/<token> URL to enter in
  // the camera's Alarm Server. Admin-only; the token is a capability secret.
  // NB: do NOT lowercase camera_id (ids are case-sensitive, e.g. HIK-FACE-HKT01)
  // and allow underscore (e.g. BOSCH_*) — match the stored id exactly.
  app.post('/api/cameras/:id/face-push-token', auth.requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'Invalid camera_id format' });
      const config = loadCameraConfig();
      const idx = config.cameras.findIndex(c => c.camera_id === id);
      if (idx < 0) return res.status(404).json({ error: 'Camera not found' });
      if ((config.cameras[idx].vendor || 'bosch').toLowerCase() !== 'hikvision') {
        return res.status(400).json({ error: 'Face push is only available for Hikvision cameras' });
      }

      const token = require('crypto').randomUUID();
      // Atomic write — re-read to guard against a concurrent edit clobbering it.
      const fresh = loadCameraConfig();
      const fi = fresh.cameras.findIndex(c => c.camera_id === id);
      if (fi < 0) return res.status(404).json({ error: 'Camera not found' });
      fresh.cameras[fi].face_push_token = token;
      if (!saveCameraConfig(fresh)) throw new Error('Failed to save config');

      // Push the new token to the owning edge immediately — mirrors
      // /lpr-push-token below, which had this and this route didn't. Found by
      // reproducing it live (2026-08-05, Phase 3 of the CIB face migration):
      // generated a token for C23WIC-SB-17, then httphost-set on slot 2 failed
      // with "camera has no face_push_token" because the edge's own
      // cameras-config.json never got the update — central had it, the edge
      // didn't, and nothing told it to.
      try {
        const { rows } = await pool.query('SELECT site_id FROM cameras WHERE id = $1', [id]);
        const siteId = rows[0]?.site_id;
        if (siteId) await publishSiteConfig(siteId, fresh.cameras, pool);
      } catch (e) { console.warn('[face-push-token] publish to edge failed:', e.message); }

      await _logCameraAudit(req, 'face_push_token_generated', id, {}); // never log the token value
      res.json({ success: true, token });
    } catch (err) {
      console.error('[face-push-token]', err);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  // POST /api/cameras/:id/lpr-push-token — Generate a per-camera LPR push token
  // (mirrors face-push-token pattern). Token is embedded in the push URL path.
  // NB: do NOT lowercase camera_id (ids are case-sensitive, e.g. HIK-FACE-HKT01)
  // and allow underscore (e.g. BOSCH_*) — match the stored id exactly.
  app.post('/api/cameras/:id/lpr-push-token', auth.requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'Invalid camera_id format' });
      const config = loadCameraConfig();
      const idx = config.cameras.findIndex(c => c.camera_id === id);
      if (idx < 0) return res.status(404).json({ error: 'Camera not found' });
      if ((config.cameras[idx].vendor || 'bosch').toLowerCase() !== 'hikvision') {
        return res.status(400).json({ error: 'LPR push is only available for Hikvision cameras' });
      }

      const token = require('crypto').randomUUID();
      // Atomic write — re-read to guard against a concurrent edit clobbering it.
      const fresh = loadCameraConfig();
      const fi = fresh.cameras.findIndex(c => c.camera_id === id);
      if (fi < 0) return res.status(404).json({ error: 'Camera not found' });
      fresh.cameras[fi].lpr_push_token = token;
      if (!saveCameraConfig(fresh)) throw new Error('Failed to save config');

      // Push the new token to the owning edge immediately. Without this the
      // token exists only in central's config until the operator happens to
      // press Save again, and every edge-side path that needs it — notably
      // repointing the camera's httpHost — fails with "camera has no
      // lpr_push_token, generate one first" straight after they generated one.
      try {
        const { rows } = await pool.query('SELECT site_id FROM cameras WHERE id = $1', [id]);
        const siteId = rows[0]?.site_id;
        if (siteId) await publishSiteConfig(siteId, fresh.cameras, pool);
      } catch (e) { console.warn('[lpr-push-token] publish to edge failed:', e.message); }

      await _logCameraAudit(req, 'lpr_push_token_generated', id, {}); // never log the token value
      res.json({ success: true, token });
    } catch (err) {
      console.error('[lpr-push-token]', err);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  // ── กลุ่ม route ที่แยกออกไปเป็นไฟล์ย่อย — เรียกตรงตำแหน่งที่ route กลุ่มนั้น
  //    เคยลงทะเบียนตอนไฟล์นี้ถือครบทั้ง 31 ตัว (ลำดับคือพฤติกรรม) ──
  const subDeps = {
    auth, getIP,
    loadCameraConfig, saveCameraConfig,
    logCameraAudit,
    thumbWidth, jpegResizer,
    resolveSiteCode, triggerModelDetect, _edgeCall,
    _isPrivateIp, _validateForwardUrl, _sanitizeCameraId, _diffAuditObjects,
    PUSH_ONLY_OFFLINE_SEC,
  };

  registerConnectivity(app, pool, subDeps);
  camerasHttphostRoutes(app, pool, subDeps);
  registerProbeAndBulk(app, pool, subDeps);

  // PATCH /api/cameras/reorder — set the manual grid order shown on the
  // Camera Status page. Body: { order: [camera_id, ...] } — the FULL list of
  // cameras currently known to the caller, in the desired order. Writes
  // 0..N-1 across all of them so nothing is left half-numbered.
  app.patch('/api/cameras/reorder', auth.requireAdmin, async (req, res) => {
    const order = Array.isArray(req.body?.order) ? req.body.order.map(String) : null;
    if (!order || !order.length) return res.status(400).json({ error: 'order (non-empty array) is required' });
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < order.length; i++) {
          await client.query('UPDATE cameras SET sort_order = $1 WHERE id = $2', [i, order[i]]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      res.json({ ok: true, count: order.length });
    } catch (e) { routeError(res, e, 'PATCH /api/cameras/reorder'); }
  });

  // PATCH /api/cameras/:cameraId/pause — set/clear maintenance pause flag
  // Dual-write: DB cameras.paused + cameras-config.json .paused (for ingesters)
  // On unpause: stamps last_seen_at=NOW() to prevent a transient watchdog offline alert
  app.patch('/api/cameras/:cameraId/pause', auth.requireAdmin, async (req, res) => {
    try {
      const { cameraId } = req.params;
      const paused = !!req.body?.paused;

      const rows = await setCamerasPaused(pool, {
        cameraIds: [cameraId], paused, bySite: false,
        reason: paused ? 'operator paused (maintenance)' : 'operator resumed',
        user: req.user, loadCameraConfig, saveCameraConfig,
      });
      if (!rows.length) return res.status(404).json({ error: 'Camera not found' });

      res.json({ ok: true, paused });
    } catch (e) { routeError(res, e, 'PATCH /api/cameras/:cameraId/pause'); }
  });

  app.delete('/api/cameras/:cameraId', async (req, res) => {
    // unbounded: ลบข้อมูลของกล้องตัวเดียวตาม id ทั้งหมดโดยตั้งใจ ขอบเวลาจะทำให้ลบไม่หมด
    // unscoped: เขียน — ผ่าน requireAdminForWrites มาแล้ว
    // ใช้ชิ้นส่วนเดียวกับการลบไซต์ (helpers/sitePurge) — รายชื่อตารางมีที่เดียว
    // ไม่กลืน error: ล้มกลางทาง = 500 พร้อมบอกว่าทำขั้นไหนไปแล้ว (กดซ้ำได้ ทุกขั้น idempotent)
    const { cameraId } = req.params;
    // keep_data=1 — remove the camera from the active config/groups but
    // preserve its historical events/appearances/license_plates (orphaned
    // rows: camera_id survives with no matching `cameras` row). Verified
    // 2026-07-16 that the LPR/faces/appearances listing routes don't INNER
    // JOIN cameras, so orphaned rows stay visible.
    const keepData = req.query.keep_data === '1';
    const cams = [cameraId];
    const done = [];
    let step = 'check';
    try {
      // ลบแถว cameras = user_cameras cascade · ผู้ใช้ที่เหลือแค่กล้องนี้จะกลายเป็น "เห็นทุกกล้อง"
      // → ปฏิเสธก่อนแตะอะไร (ทั้งสองโหมด เพราะ keep_data ก็ลบแถว cameras)
      const widened = await sitePurge.findWidenedUsers(pool, cams, null);
      if (widened.length) {
        return res.status(409).json({
          error: `ลบไม่ได้ — ผู้ใช้ ${widened.map(u => u.username).join(', ')} มีสิทธิ์เฉพาะกล้องนี้ ถ้าลบจะเห็นทุกกล้องในไซต์ · แก้สิทธิ์รายกล้องก่อน`,
          widened,
        });
      }

      step = 'config';
      const config = loadCameraConfig();
      const prevCamera = (config.cameras || []).find(c => c.camera_id === cameraId) || null;
      const prevGroups = _cameraGroupIds(loadGroups(), cameraId);
      config.cameras = (config.cameras || []).filter(c => c.camera_id !== cameraId);
      if (saveCameraConfig(config) === false) throw new Error('บันทึก cameras-config.json ไม่สำเร็จ');
      const groups = loadGroups();
      groups.groups = (groups.groups || []).map(g => ({
        ...g, cameraIds: (g.cameraIds || []).filter(id => id !== cameraId)
      }));
      if (saveGroups(groups) === false) throw new Error('บันทึก camera-groups.json ไม่สำเร็จ');
      done.push('config');

      const siteRow = (await pool.query(
        'SELECT c.site_id, s.code, s.status FROM cameras c LEFT JOIN sites s ON s.id = c.site_id WHERE c.id = $1', [cameraId])).rows[0] || {};
      const siteId = siteRow.site_id ?? null;

      if (!keepData) {
        step = 'alert_rules';
        await sitePurge.scrubAlertRules(pool, cams);
        done.push('alert_rules');
        step = 'data';
        await sitePurge.deleteCameraData(pool, cams);
        done.push('data');
      }

      step = 'camera_row';
      await sitePurge.deleteCameraRows(pool, cams, null);
      done.push('camera_row');

      // EC1: push the now-camera-removed config to the edge so its own ingester
      // stops watching a camera that no longer exists (Task #20).
      if (siteId) publishSiteConfig(siteId, config.cameras, pool).catch(e =>
        console.warn('[edge-config] publish failed:', e.message)
      );

      // OPT5-EDGE-005: รูปบนดิสก์ — gate ด้วย !keepData เหมือนแถว DB
      // ชื่อโฟลเดอร์ = safeCamDir (ตรงกับ snapPath) · ชนกับกล้องที่ยังอยู่ = ไม่ลบ (log)
      // central ลบทุกครั้ง (face-push/กล้องตรงเขียนลง central แม้ไซต์มี edge)
      if (!keepData) {
        step = 'media';
        const survivors = (loadCameraConfig().cameras || []).map(c => c.camera_id);
        const names = sitePurge.mediaDirNames(cams, survivors);
        if (names.collisions.length) console.warn(`[camera-media-delete] ${cameraId}: folder name collides with another camera — kept`);
        if (siteRow.code && siteRow.code !== 'main' && siteRow.status !== 'archived') {
          const r = await sitePurge.sendEdgeDeleteMedia(siteRow.code, names.ok);
          for (const f of r.failed) console.warn(`[camera-media-delete] ${f.id}: edge publish failed: ${f.error}`);
        }
        const r = await sitePurge.deleteCentralMedia(SNAPSHOT_DIR, names.ok);
        if (r.rejected.length) console.warn(`[camera-media-delete] ${cameraId}: rejected`);
        else console.log(`[camera-media-delete] ${cameraId}: removed ${r.dirs} date-dir(s)`);
        done.push('media');
      }

      await _logCameraAudit(req, 'camera_delete', cameraId, {
        camera: _redactCameraAudit(prevCamera),
        removed_from_groups: prevGroups,
        kept_data: keepData,
      });

      res.json({ success: true, kept_data: keepData });
    } catch (err) {
      console.error(`[camera-delete] ${cameraId} failed at ${step} (done: ${done.join(',') || '-'}):`, err.message);
      if (err.status === 409) return res.status(409).json({ error: err.message, widened: err.widened });
      res.status(500).json({
        error: `ลบกล้องไม่ครบ — ล้มที่ขั้น ${step}${done.length ? ` (ทำไปแล้ว: ${done.join(', ')})` : ''}: ${err.message} · กดลบซ้ำได้`,
        step, done,
      });
    }
  });

  camerasStatusRoutes(app, pool, subDeps);

};

// CS6: expose the pure forward-URL validator for node tests (SSRF write guard).
module.exports._validateForwardUrl = _validateForwardUrl;
