// ============================================================
// Vigil Platform — Helper: publishSiteConfig
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { encryptCamCreds } = require('../crypto-creds');
const brokerAdmin = require('./brokerAdmin');

// EC1: publish per-site camera config to retained MQTT topic so edge agents
// receive it immediately or on reconnect. Fire-and-forget safe — caller catches.
module.exports = async function publishSiteConfig(siteId, cameras, pool) {
  if (!brokerAdmin.isConfigured({ as: 'publisher' })) return;
  const { rows } = await pool.query('SELECT code FROM sites WHERE id = $1', [siteId]);
  if (!rows.length) return;
  const siteCode = rows[0].code;
  // cameras-config.json doesn't store site_id — use DB as authoritative source.
  // enable_vca_overlay / enable_snapshot / snapshot_mode ride along the same
  // way — DB-only columns (edge-config-agent.js has no other path to learn
  // them; see captureAndPublish and its caller in the RuleEngine handler).
  const { rows: camRows } = await pool.query('SELECT id, enable_vca_overlay, enable_snapshot, snapshot_mode, meta_crop FROM cameras WHERE site_id = $1', [siteId]);
  const flagsById = new Map(camRows.map(r => [r.id, r]));
  const siteSet = new Set(camRows.map(r => r.id));
  const siteCams = cameras.filter(c => siteSet.has(c.camera_id))
    .map(c => {
      const f = flagsById.get(c.camera_id);
      return {
        ...c,
        enable_vca_overlay: f.enable_vca_overlay !== false,
        enable_snapshot:    f.enable_snapshot !== false,
        snapshot_mode:      f.snapshot_mode || 'both',
        // ONVIF metadata crop (migration 164) — replaces the META_CROP_CAMERAS
        // env allow-list. The edge reconciles its live metadata sessions against
        // this on every config push, so a toggle takes effect without a restart.
        meta_crop:          f.meta_crop === true,
      };
    })
    .map(encryptCamCreds);
  await brokerAdmin.publish(
    `projects/${siteCode}/_config/cameras`,
    { version: Date.now(), cameras: siteCams },
    { qos: 1, retain: true }
  );
  console.log(`[edge-config] → projects/${siteCode}/_config/cameras (${siteCams.length} cams)`);
  return { siteCode, count: siteCams.length };
};
