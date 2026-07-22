// ============================================================
// Vigil Platform — Helper: publishSiteConfig
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { encryptCamCreds } = require('../crypto-creds');
const EMQX_API_BASE = 'http://localhost:18083/api/v5';

// EC1: publish per-site camera config to retained MQTT topic so edge agents
// receive it immediately or on reconnect. Fire-and-forget safe — caller catches.
module.exports = async function publishSiteConfig(siteId, cameras, pool) {
  const dashPass = process.env.EMQX_DASHBOARD_PASSWORD;
  if (!dashPass) return;
  const { rows } = await pool.query('SELECT code FROM sites WHERE id = $1', [siteId]);
  if (!rows.length) return;
  const siteCode = rows[0].code;
  // cameras-config.json doesn't store site_id — use DB as authoritative source
  const { rows: camRows } = await pool.query('SELECT id FROM cameras WHERE site_id = $1', [siteId]);
  const siteSet = new Set(camRows.map(r => r.id));
  const siteCams = cameras.filter(c => siteSet.has(c.camera_id)).map(encryptCamCreds);
  const loginRes = await fetch(`${EMQX_API_BASE}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: dashPass }),
  });
  if (!loginRes.ok) throw new Error(`EMQX login ${loginRes.status}`);
  const { token } = await loginRes.json();
  const pubRes = await fetch(`${EMQX_API_BASE}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      topic: `projects/${siteCode}/_config/cameras`,
      payload: JSON.stringify({ version: Date.now(), cameras: siteCams }),
      qos: 1, retain: true,
    }),
  });
  if (!pubRes.ok) throw new Error(`EMQX publish ${pubRes.status}`);
  console.log(`[edge-config] → projects/${siteCode}/_config/cameras (${siteCams.length} cams)`);
  return { siteCode, count: siteCams.length };
};
