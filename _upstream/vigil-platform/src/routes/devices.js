// ============================================================
// Vigil Platform — Device & integration inventory (Maintenance tab)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// "What is connected to us and is it healthy" — grouped the way someone doing
// maintenance thinks about it, not the way the tables are laid out. Its own
// route, fetched when the tab opens, for the same reason as the metrics one:
// /api/health/details already carries eighteen keys and has been slow before.
'use strict';

const { OFFLINE_THRESHOLD_SEC } = require('../constants');

// A camera that nobody has walked past all morning is not a broken camera. The
// existing "online" badge keys off event age, so a quiet gate reads as offline
// and a real outage looks the same as a slow Sunday — the two need different
// answers from whoever is on shift.
//
// Reachability comes from last_seen_at, which is a heartbeat: on edge sites the
// agent TCP-probes every camera every 60s and only publishes when the socket
// opens, so it means "the camera answered", independent of any detection.
//
// "Has it detected anything lately" does NOT come from cameras.last_event_at.
// That column is written by only two narrow paths (face-push.js, lpr-core.js)
// and is populated for 2 of 59 cameras — trusting it would mark 57 healthy
// cameras quiet for ever. The events table is the real source; one grouped
// query over the last hour costs 13ms measured against live data, against the
// partition index, so it is asked directly.
const QUIET_AFTER_SEC = 3600;

function deviceState(row) {
  if (row.paused) return 'paused';
  if (row.enabled === false) return 'disabled';
  if (row.seen_sec == null) return 'unknown';
  if (row.seen_sec > OFFLINE_THRESHOLD_SEC) return 'offline';
  if (row.event_sec == null || row.event_sec > QUIET_AFTER_SEC) return 'quiet';
  return 'online';
}

module.exports = function registerDeviceRoutes(app, pool, { auth, routeError, loadCameraConfig }) {
  app.get('/api/health/devices', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const [camsRes, ingRes, srcRes, evRes] = await Promise.all([
        pool.query(`
          SELECT c.id, c.name, c.cam_role, c.model, c.ip_address, c.http_port,
                 c.enabled, c.paused, c.site_id, c.nvr_channel, c.device_id,
                 c.vca_rule_issues,
                 extract(epoch from (now() - c.last_seen_at)) AS seen_sec
          FROM cameras c ORDER BY c.cam_role, c.name
        `),
        // Dahua-only, and only trustworthy for cameras this machine can actually
        // reach — see the edge filter where it is attached.
        pool.query(`SELECT camera_id, event_stream, snap_stream, retry_count,
                           last_event_http_status, last_snap_http_status, last_error_code,
                           reported_by, updated_at
                    FROM ingester_camera_status`),
        pool.query(`SELECT id, source_type, label, site_code, active,
                           last_import_at, last_import_status, last_import_note,
                           extract(epoch from (now() - last_import_at)) AS import_age_sec
                    FROM blacklist.sources ORDER BY id`),
        pool.query(`SELECT camera_id, extract(epoch from (now() - max(event_time))) AS event_sec
                    FROM events WHERE event_time > now() - ($1 || ' seconds')::interval
                      AND event_time <= now() + interval '5 minutes'   -- กันเวลาอนาคต (GOTCHAS #217)
                    GROUP BY camera_id`, [String(QUIET_AFTER_SEC)]),
      ]);
      const evById = new Map(evRes.rows.map(r => [r.camera_id, Math.round(r.event_sec)]));

      // Vendor is not a column — it lives in cameras-config.json, which is also
      // what the ingesters read, so this matches what is actually running.
      const vendorById = new Map();
      try {
        for (const c of (loadCameraConfig()?.cameras || [])) {
          vendorById.set(c.camera_id || c.id, String(c.vendor || 'bosch').toLowerCase());
        }
      } catch { /* config unreadable — vendor shows as unknown, nothing else breaks */ }

      const ingById = new Map(ingRes.rows.map(r => [r.camera_id, r]));

      // ingester_camera_status is written by whichever dahua process attempted
      // the connection — including the one on CENTRAL, which cannot route to a
      // site LAN. Measured 2026-07-27: 48 of 48 rows for hdy cameras said
      // reconnecting/EHOSTUNREACH with 432 retries while those same cameras were
      // delivering events seconds old. Showing that next to a green Online badge
      // is worse than showing nothing, so an edge camera's row is dropped: this
      // machine's opinion of it is not evidence. The edge keeps its own state in
      // its own process and has no DB to write it to.
      const edgeSites = new Set((await pool.query(
        `SELECT id FROM sites WHERE code <> 'main'`)).rows.map(r => r.id));

      const cams = camsRes.rows.map(r => {
        const seen = r.seen_sec == null ? null : Math.round(r.seen_sec);
        // Anything older than the window simply is not in evById — which is
        // exactly the "no event within QUIET_AFTER_SEC" the state machine wants.
        const ev = evById.has(r.id) ? evById.get(r.id) : null;
        // ทิ้งเฉพาะ "ความเห็นของ central" เรื่องกล้องที่อยู่หลัง edge — เครื่องนี้ต่อ
        // ไม่ถึงอยู่แล้ว ความเห็นจึงไม่ใช่หลักฐาน (ดูคอมเมนต์ยาวข้างบน)
        //
        // แต่แถวที่ `reported_by='edge'` คือไซต์นั้นรายงานสายกล้องของตัวเองขึ้นมา
        // (migration 155) ซึ่งเป็นความจริงเรื่องกล้องจริง ๆ ⇒ ต้องแสดง
        const _ing = ingById.get(r.id) || null;
        const ing = (_ing && _ing.reported_by === 'edge') ? _ing
                  : (edgeSites.has(r.site_id) ? null : _ing);
        return {
          id: r.id, name: r.name, role: r.cam_role || 'standard',
          vendor: vendorById.get(r.id) || null,
          model: r.model, ip: r.ip_address, port: r.http_port,
          site_id: r.site_id, nvr_channel: r.nvr_channel, device_id: r.device_id,
          paused: r.paused, enabled: r.enabled,
          vca_rule_issues: Array.isArray(r.vca_rule_issues) ? r.vca_rule_issues : [],
          last_seen_sec: seen, last_event_sec: ev,
          state: deviceState({ paused: r.paused, enabled: r.enabled, seen_sec: seen, event_sec: ev }),
          ingester: ing && {
            event_stream: ing.event_stream, snap_stream: ing.snap_stream,
            retry_count: ing.retry_count, last_error_code: ing.last_error_code,
            last_event_http_status: ing.last_event_http_status,
            last_snap_http_status: ing.last_snap_http_status,
          },
        };
      });

      // Channels of a shared chassis are rolled up so the NVR itself is one row.
      // Without this an NVR outage reads as N separate camera failures and the
      // one thing to actually go and look at is not on the list at all.
      const nvrMap = new Map();
      for (const c of cams) {
        if (!c.device_id) continue;
        const n = nvrMap.get(c.device_id) || {
          id: c.device_id, ip: c.ip, vendor: c.vendor, site_id: c.site_id,
          channels: [], states: [], seen: [],
        };
        n.channels.push({ id: c.id, name: c.name, channel: c.nvr_channel, state: c.state });
        n.states.push(c.state);
        if (c.last_seen_sec != null) n.seen.push(c.last_seen_sec);
        nvrMap.set(c.device_id, n);
      }
      const nvrs = [...nvrMap.values()].map(n => ({
        id: n.id, ip: n.ip, vendor: n.vendor, site_id: n.site_id,
        channel_count: n.channels.length,
        channels: n.channels,
        // The chassis answered if ANY of its channels did, so the freshest
        // channel is the chassis's last reply. Omitting this rendered every
        // recorder as "last reply never" while its channels were seconds old.
        last_seen_sec: n.seen.length ? Math.min(...n.seen) : null,
        // Worst channel wins: one dead channel on a live chassis still needs a look.
        state: n.states.includes('offline') ? 'offline'
             : n.states.includes('unknown') ? 'unknown'
             : n.states.every(s => s === 'paused') ? 'paused'
             : n.states.includes('quiet') ? 'quiet' : 'online',
      }));

      res.json({
        groups: [
          { key: 'anpr',  devices: cams.filter(c => c.role === 'lpr') },
          { key: 'face',  devices: cams.filter(c => c.role === 'face') },
          { key: 'event', devices: cams.filter(c => c.role !== 'lpr' && c.role !== 'face') },
          { key: 'nvr',   devices: nvrs },
        ],
        integrations: srcRes.rows.map(r => ({
          id: r.id, type: r.source_type, label: r.label, site_code: r.site_code,
          active: r.active,
          last_import_at: r.last_import_at,
          last_import_status: r.last_import_status,
          last_import_note: r.last_import_note,
          import_age_sec: r.import_age_sec == null ? null : Math.round(r.import_age_sec),
        })),
        thresholds: { offline_sec: OFFLINE_THRESHOLD_SEC, quiet_sec: QUIET_AFTER_SEC },
      });
    } catch (e) { routeError(res, e, 'health/devices'); }
  });
};

module.exports.deviceState = deviceState;
module.exports.QUIET_AFTER_SEC = QUIET_AFTER_SEC;
