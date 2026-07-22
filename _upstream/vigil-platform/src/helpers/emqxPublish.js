// ============================================================
// Vigil Platform — Helper: EMQX one-shot publish
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Publish a single message to central EMQX via its HTTP API (same login+publish
// path publishSiteConfig uses for the config push). Used for the NVR scan
// request central→edge — the edge-bridge relays projects/{site}/_config/* down
// to the edge's local NanoMQ, so the edge-config-agent receives it.
// ------------------------------------------------------------
'use strict';

const EMQX_API_BASE = 'http://localhost:18083/api/v5';

module.exports = async function emqxPublish(topic, payloadObj, { qos = 1, retain = false } = {}) {
  const dashPass = process.env.EMQX_DASHBOARD_PASSWORD;
  if (!dashPass) throw new Error('EMQX_DASHBOARD_PASSWORD not set');
  const loginRes = await fetch(`${EMQX_API_BASE}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: dashPass }),
  });
  if (!loginRes.ok) throw new Error(`EMQX login ${loginRes.status}`);
  const { token } = await loginRes.json();
  const pubRes = await fetch(`${EMQX_API_BASE}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ topic, payload: JSON.stringify(payloadObj), qos, retain }),
  });
  if (!pubRes.ok) throw new Error(`EMQX publish ${pubRes.status}`);
};
