// ============================================================
// Vigil Platform — Site Provisioning (multi-site edge onboarding)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Reusable engine for adding a Site + its edge MQTT bridge identity. Used by
// scripts/provision-site.js (CLI) and a future Settings › Sites endpoint (so the
// logic lives in ONE place). One call provisions:
//   1. a `sites` row (idempotent upsert by code)
//   2. an EMQX user  edge-<code>  (authn, bcrypt — password returned ONCE)
//   3. an EMQX ACL restricting that user to projects/<code>/#  (built_in_database)
//
// NOTE on isolation: we add the per-site ALLOW rule but DON'T flip EMQX
// `no_match` to deny — the default ACL still allows authenticated clients, so
// existing cameras/subscriber keep working. True deny-by-default isolation is a
// production hardening step (every existing user needs an explicit rule first).
// ============================================================
'use strict';

const crypto = require('crypto');

const EMQX_API = 'http://localhost:18083/api/v5';
const AUTHN_ID = 'password_based%3Abuilt_in_database';

function genPassword() { return crypto.randomBytes(18).toString('base64url'); }

async function apiReq(method, p, body, token) {
  const res = await fetch(`${EMQX_API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

async function emqxLogin(dashboardPassword) {
  if (!dashboardPassword) throw new Error('EMQX_DASHBOARD_PASSWORD not set');
  const r = await apiReq('POST', '/login', { username: 'admin', password: dashboardPassword });
  if (!r.ok) throw new Error(`EMQX login failed: ${JSON.stringify(r.json)}`);
  return r.json.token;
}

async function upsertEmqxUser(token, userId, password) {
  const create = await apiReq('POST', `/authentication/${AUTHN_ID}/users`,
    { user_id: userId, password, is_superuser: false }, token);
  if (create.status === 409) {
    const upd = await apiReq('PUT', `/authentication/${AUTHN_ID}/users/${encodeURIComponent(userId)}`,
      { password, is_superuser: false }, token);
    if (!upd.ok) throw new Error(`Update EMQX user ${userId}: ${JSON.stringify(upd.json)}`);
    return 'updated';
  }
  if (!create.ok) throw new Error(`Create EMQX user ${userId}: ${JSON.stringify(create.json)}`);
  return 'created';
}

async function ensureAuthzBuiltInDb(token) {
  const list = await apiReq('GET', '/authorization/sources', null, token);
  const exists = (list.json?.sources || []).some(s => s.type === 'built_in_database');
  if (exists) return 'exists';
  const r = await apiReq('POST', '/authorization/sources', { type: 'built_in_database', enable: true }, token);
  if (!r.ok) throw new Error(`Create authz built_in_database source: ${JSON.stringify(r.json)}`);
  return 'created';
}

async function setEdgeAcl(token, username, siteCode) {
  // The edge user may publish/subscribe ONLY within its own site namespace.
  const rules = [{ topic: `projects/${siteCode}/#`, action: 'all', permission: 'allow' }];
  // Create the user's rule set; if it already exists, replace it via PUT.
  const create = await apiReq('POST', '/authorization/sources/built_in_database/rules/users',
    [{ username, rules }], token);
  if (create.ok) return 'created';
  const upd = await apiReq('PUT', `/authorization/sources/built_in_database/rules/users/${encodeURIComponent(username)}`,
    { username, rules }, token);
  if (!upd.ok) throw new Error(`Set ACL for ${username}: ${JSON.stringify(upd.json)}`);
  return 'updated';
}

async function upsertSiteRow(pool, { code, name, color }) {
  const r = await pool.query(
    `INSERT INTO sites (code, name, color) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color
     RETURNING id, code, name, color`,
    [code, name || code, color || '#5b8def']);
  return r.rows[0];
}

// Orchestrator — sites row + EMQX user + ACL. Returns the edge config to apply
// at the edge device (password is plaintext here ONLY — shown once, not stored).
async function provisionSite(pool, token, { code, name, color, brokerUrl }) {
  if (!/^[a-z0-9-]+$/.test(code)) throw new Error('site code must be [a-z0-9-]');
  const site = await upsertSiteRow(pool, { code, name, color });
  await ensureAuthzBuiltInDb(token);
  const username = `edge-${code}`;
  const password = genPassword();
  const userAction = await upsertEmqxUser(token, username, password);
  await setEdgeAcl(token, username, code);
  return {
    site,
    userAction,                                  // 'created' | 'updated'
    mqtt: { username, password },                // password shown ONCE
    topicPrefix: `projects/${code}/`,
    brokerUrl: brokerUrl || 'wss://dashboard.dojojin.tech/mqtt',
  };
}

module.exports = { provisionSite, upsertSiteRow, emqxLogin, genPassword };
