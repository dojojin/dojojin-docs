// ============================================================
// Vigil Platform — Helper: Broker Admin (EMQX / Mosquitto switch)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ทุกอย่างที่ผูกกับ broker admin (provision user, ACL, publish, connected-list)
// อยู่ที่ไฟล์เดียวนี้ — ไฟล์อื่นเรียกผ่าน interface นี้เท่านั้น. เปลี่ยน broker
// ครั้งหน้า = เขียนไฟล์นี้ใหม่ (docs/reports/2026-09-27_mosquitto-migration-plan.md §1).
//
// BROKER_KIND=emqx (ค่าเริ่มต้น, ของเดิม)
//   ทุก HTTP request ตรงกับโค้ดเดิมทุก byte (ย้ายมาจาก routes/cameras.js
//   _emqxProvisionCamera, site-provision.js, api-server.js
//   _emqxConnectedUsernames, helpers/emqxPublish.js, helpers/publishSiteConfig.js,
//   helpers/publishSiteRetention.js) — "behaves EXACTLY as today".
//
// BROKER_KIND=mosquitto (ใหม่ — ยังไม่ cutover จนกว่าจะถึง M2)
//   ใช้ dynamic security plugin ผ่าน MQTT เอง ($CONTROL/dynamic-security/v1)
//   ด้วยบัญชี provisioner (สิทธิ์เฉพาะ $CONTROL/dynamic-security/#) —
//   คำสั่งอ้างจาก spike ที่ทดสอบแล้วบน broker แยกขาด (ดู §0 ของแผน). โค้ดส่วนนี้
//   "ยังไม่เคยรันกับ Mosquitto จริงที่มี dynsec โหลดจากไฟล์ config จริง" —
//   idempotent-retry path (client/role มีอยู่แล้ว) เป็น 🟡 ไม่ได้ทดสอบ (unverified).
//
// ทั้งสองโหมด: อ่าน BROKER_KIND "ตอนเรียก" ไม่ snapshot ตอน require (เทสต์ตั้ง
// env หลัง require ได้ — เหมือน src/config.js)
// ============================================================
'use strict';

const env = require('../config');

function _kind() {
  const k = env.str('BROKER_KIND');
  return k === 'mosquitto' ? 'mosquitto' : 'emqx';
}

// ================================================================
// ── EMQX backend — literal port of the pre-migration REST calls ──
// ================================================================
const EMQX_API_BASE = 'http://localhost:18083/api/v5';
const EMQX_AUTHN_ID = 'password_based%3Abuilt_in_database';

async function _emqxLogin() {
  const dashPass = env.str('EMQX_DASHBOARD_PASSWORD');
  if (!dashPass) throw new Error('EMQX_DASHBOARD_PASSWORD not set');
  const loginRes = await fetch(`${EMQX_API_BASE}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: dashPass }),
  });
  if (!loginRes.ok) throw new Error(`EMQX login failed: HTTP ${loginRes.status}`);
  const { token } = await loginRes.json();
  return token;
}

// ── upsertUser — ports cameras.js _emqxProvisionCamera + site-provision.js
// upsertEmqxUser (both already byte-identical create/409→PUT shape) ──
async function _emqxUpsertUser(username, password) {
  const token = await _emqxLogin();
  const createRes = await fetch(`${EMQX_API_BASE}/authentication/${EMQX_AUTHN_ID}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: username, password, is_superuser: false }),
  });
  if (createRes.status === 409) {
    const updRes = await fetch(
      `${EMQX_API_BASE}/authentication/${EMQX_AUTHN_ID}/users/${encodeURIComponent(username)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password, is_superuser: false }),
      }
    );
    if (!updRes.ok) throw new Error(`EMQX update user failed: HTTP ${updRes.status}`);
    return 'updated';
  }
  if (!createRes.ok) throw new Error(`EMQX create user failed: HTTP ${createRes.status}`);
  return 'created';
}

async function _emqxDeleteUser(username) {
  const token = await _emqxLogin();
  const res = await fetch(
    `${EMQX_API_BASE}/authentication/${EMQX_AUTHN_ID}/users/${encodeURIComponent(username)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok && res.status !== 404) throw new Error(`EMQX delete user failed: HTTP ${res.status}`);
}

// ── setSiteAcl — literal port of site-provision.js setEdgeAcl ──
async function _emqxSetSiteAcl(username, siteCode) {
  const token = await _emqxLogin();
  const rules = [{ topic: `projects/${siteCode}/#`, action: 'all', permission: 'allow' }];
  const create = await fetch(`${EMQX_API_BASE}/authorization/sources/built_in_database/rules/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify([{ username, rules }]),
  });
  if (create.ok) return 'created';
  const upd = await fetch(
    `${EMQX_API_BASE}/authorization/sources/built_in_database/rules/users/${encodeURIComponent(username)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ username, rules }),
    }
  );
  if (!upd.ok) throw new Error(`Set ACL for ${username}: HTTP ${upd.status}`);
  return 'updated';
}

// ── addCameraAcl — documented manual step in site-provision.js (GOTCHAS #92):
// per-camera publish rule for ONVIF metadata (<cameraId>/onvif-ej/#). NOT called
// by any M1 caller yet (today's provision flow makes no ACL call for cameras —
// keeping that unchanged is required for "behaves EXACTLY as today"). Real,
// working implementation, wired up in a later phase. ──
async function _emqxAddCameraAcl(username, cameraId) {
  const token = await _emqxLogin();
  const rule = { topic: `${cameraId}/onvif-ej/#`, action: 'publish', permission: 'allow' };
  const res = await fetch(
    `${EMQX_API_BASE}/authorization/sources/built_in_database/rules/users/${encodeURIComponent(username)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(rule),
    }
  );
  if (!res.ok) throw new Error(`Add camera ACL for ${username}: HTTP ${res.status}`);
  return 'created';
}

// ── listConnectedUsers — literal port of api-server.js _emqxConnectedUsernames.
// GET only — no Content-Type header (matches original exactly). Never throws. ──
async function _emqxListConnectedUsers() {
  const dashPass = env.str('EMQX_DASHBOARD_PASSWORD');
  if (!dashPass) return null;
  try {
    const login = await fetch(`${EMQX_API_BASE}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: dashPass }),
    });
    if (!login.ok) return null;
    const { token } = await login.json();
    const r = await fetch(`${EMQX_API_BASE}/clients?limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const body = await r.json();
    return new Set((body.data || []).filter((c) => c.connected).map((c) => c.username).filter(Boolean));
  } catch { return null; }
}

// ── publish — literal port of helpers/emqxPublish.js (also matches the inline
// login+publish that publishSiteConfig.js / publishSiteRetention.js used to
// carry themselves — the two are byte-identical to emqxPublish.js already) ──
async function _emqxPublish(topic, payloadObj, { qos = 1, retain = false } = {}) {
  const dashPass = env.str('EMQX_DASHBOARD_PASSWORD');
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
}

// ── deleteSiteRole (EMQX) — the EMQX equivalent of Mosquitto's `site-<code>` role is
// the per-user rule set `_emqxSetSiteAcl` wrote for `edge-<code>`. 404 = already gone.
// ⚠️ neither this nor _emqxDeleteUser disconnects a live session — the edge keeps its
// current connection until it drops (then it cannot log back in).
async function _emqxDeleteSiteRole(siteCode) {
  const token = await _emqxLogin();
  const res = await fetch(
    `${EMQX_API_BASE}/authorization/sources/built_in_database/rules/users/${encodeURIComponent(`edge-${siteCode}`)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok && res.status !== 404) throw new Error(`EMQX delete site ACL failed: HTTP ${res.status}`);
}

// ── clearRetained (EMQX) — same login+publish as _emqxPublish but with a zero-length
// retained payload (MQTT's "delete the retained message on this topic") ──
async function _emqxClearRetained(topic) {
  const token = await _emqxLogin();
  const pubRes = await fetch(`${EMQX_API_BASE}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ topic, payload: '', qos: 1, retain: true }),
  });
  if (!pubRes.ok) throw new Error(`EMQX clear retained ${pubRes.status}`);
}

// ── ensureAuthzSource — literal port of site-provision.js ensureAuthzBuiltInDb ──
async function _emqxEnsureAuthzSource() {
  const token = await _emqxLogin();
  const list = await fetch(`${EMQX_API_BASE}/authorization/sources`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listJson = await list.json().catch(() => ({}));
  const exists = (listJson?.sources || []).some((s) => s.type === 'built_in_database');
  if (exists) return 'exists';
  const r = await fetch(`${EMQX_API_BASE}/authorization/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'built_in_database', enable: true }),
  });
  if (!r.ok) throw new Error(`Create authz built_in_database source: HTTP ${r.status}`);
  return 'created';
}

// ================================================================
// ── Mosquitto backend — dynamic security over MQTT (command shapes
// proven by the isolated spike, 2026-09-27) ──
// 🟡 unverified: idempotent-retry error strings (client/role that already
// exists) were not exercised against a real dynsec plugin loaded from a
// config file — only the happy path (fresh objects) was.
// ================================================================
let _provisioner = null;      // { client, ready(Promise) } — lazy, one per process
let _dynsecQueue = Promise.resolve(); // serializes commands so responses can't cross-talk

function _requireMqtt() {
  // Lazy require — emqx mode must never load or connect the mqtt module.
  return require('mqtt');
}

function _getProvisioner() {
  if (_provisioner) return _provisioner.ready;
  const user = env.str('MQTT_PROVISIONER_USER');
  const pass = env.str('MQTT_PROVISIONER_PASSWORD');
  if (!user || !pass) return Promise.reject(new Error('MQTT_PROVISIONER_USER/PASSWORD not set'));
  const mqtt = _requireMqtt();
  const client = mqtt.connect(env.str('MQTT_BROKER_URL'), {
    username: user, password: pass, clean: true,
    clientId: `vigil-broker-admin-${process.pid}`,
    reconnectPeriod: 2000, connectTimeout: 8000,
  });
  client.on('error', () => {}); // avoid unhandled 'error' crashing the process after first connect
  const ready = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('mosquitto dynsec connect timeout')), 8000);
    client.once('connect', () => {
      client.subscribe('$CONTROL/dynamic-security/v1/response', { qos: 1 }, (err) => {
        clearTimeout(to);
        if (err) return reject(err);
        resolve(client);
      });
    });
    client.once('error', (e) => { clearTimeout(to); reject(e); });
  });
  _provisioner = { client, ready };
  ready.catch(() => { _provisioner = null; }); // allow retry on next call
  return ready;
}

function _dynsecSendOne(commands) {
  return _getProvisioner().then((client) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener('message', onMsg);
      reject(new Error('mosquitto dynsec response timeout'));
    }, 8000);
    function onMsg(topic, buf) {
      if (topic !== '$CONTROL/dynamic-security/v1/response') return;
      clearTimeout(timer);
      client.removeListener('message', onMsg);
      try { resolve(JSON.parse(buf.toString())); }
      catch (e) { reject(e); }
    }
    client.on('message', onMsg);
    client.publish('$CONTROL/dynamic-security/v1', JSON.stringify({ commands }), { qos: 1 }, (err) => {
      if (err) { clearTimeout(timer); client.removeListener('message', onMsg); reject(err); }
    });
  }));
}

// ponytail: one in-flight command batch at a time, per process — avoids
// building correlationData matching for a call volume (admin ops) that is
// low-frequency by nature. Upgrade to correlationData if concurrent
// provisioning throughput ever matters.
function _dynsecSend(commands) {
  const p = _dynsecQueue.then(() => _dynsecSendOne(commands));
  _dynsecQueue = p.catch(() => {}); // one failed batch must not wedge the queue
  return p;
}

function _dynsecErrors(res) {
  return (res.responses || []).filter((r) => r && r.error);
}
function _dynsecErrorsIgnoringExists(res) {
  return _dynsecErrors(res).filter((r) => !/already exists|not found/i.test(String(r.error)));
}


// addClientRole on a role the client already has answers "Internal error"
// (seen on Mosquitto 2.1.2, 2026-09-27) — indistinguishable from a real failure
// by text, so check membership first instead of pattern-matching the error.
async function _ensureClientRole(username, rolename) {
  const got = await _dynsecSend([{ command: 'getClient', username }]);
  const r0 = (got.responses || [])[0] || {};
  if (r0.error) throw new Error(`mosquitto getClient ${username}: ${JSON.stringify(r0.error)}`);
  const roles = (r0.data && r0.data.client && r0.data.client.roles) || [];
  if (roles.some((r) => r && r.rolename === rolename)) return 'exists';
  const res = await _dynsecSend([{ command: 'addClientRole', username, rolename }]);
  const bad = _dynsecErrors(res);
  if (bad.length) throw new Error(`mosquitto addClientRole ${username}/${rolename}: ${JSON.stringify(bad)}`);
  return 'added';
}

// Rotation scripts must refuse to silently create an account — check first.
async function _mosClientExists(username) {
  const res = await _dynsecSend([{ command: 'getClient', username }]);
  const r0 = (res.responses || [])[0] || {};
  if (!r0.error) return true;
  if (/not found/i.test(String(r0.error))) return false;
  throw new Error(`mosquitto getClient ${username}: ${JSON.stringify(r0.error)}`);
}

async function _mosUpsertUser(username, password, { role } = {}) {
  const roles = role ? [{ rolename: role }] : [];
  const res = await _dynsecSend([{ command: 'createClient', username, password, roles }]);
  const bad = _dynsecErrors(res);
  if (!bad.length) return 'created';
  if (!/already exists/i.test(String(bad[0].error))) {
    throw new Error(`mosquitto createClient ${username}: ${JSON.stringify(bad)}`);
  }
  const res2 = await _dynsecSend([{ command: 'setClientPassword', username, password }]);
  const bad2 = _dynsecErrors(res2);
  if (bad2.length) throw new Error(`mosquitto upsertUser ${username}: ${JSON.stringify(bad2)}`);
  if (role) await _ensureClientRole(username, role);
  return 'updated';
}

async function _mosDeleteUser(username) {
  const res = await _dynsecSend([{ command: 'deleteClient', username }]);
  const bad = _dynsecErrorsIgnoringExists(res);
  if (bad.length) throw new Error(`mosquitto deleteClient ${username}: ${JSON.stringify(bad)}`);
}

// ── deleteSiteRole — removes the `site-<code>` role _mosSetSiteAcl created.
// "not found" = already gone (idempotent re-run). ──
async function _mosDeleteSiteRole(siteCode) {
  const res = await _dynsecSend([{ command: 'deleteRole', rolename: `site-${siteCode}` }]);
  const bad = _dynsecErrorsIgnoringExists(res);
  if (bad.length) throw new Error(`mosquitto deleteRole site-${siteCode}: ${JSON.stringify(bad)}`);
}

// ── setSiteAcl — role `site-<code>`: publishClientSend projects/<code>/# +
// subscribePattern projects/<code>/_config/# (plan §1/§6.1, spike role()) ──
async function _mosSetSiteAcl(username, siteCode) {
  const rolename = `site-${siteCode}`;
  const acls = [
    ['publishClientSend', `projects/${siteCode}/#`],
    ['subscribePattern', `projects/${siteCode}/_config/#`],
  ];
  const createCmds = [
    { command: 'createRole', rolename },
    ...acls.map(([acltype, topic]) => ({ command: 'addRoleACL', rolename, acltype, topic, allow: true })),
  ];
  const res = await _dynsecSend(createCmds);
  const bad = _dynsecErrorsIgnoringExists(res);
  if (bad.length) throw new Error(`mosquitto setSiteAcl ${siteCode}: ${JSON.stringify(bad)}`);
  await _ensureClientRole(username, rolename);
  return 'updated';
}

// ── addCameraAcl — per-camera role `cam-role-<username>` with a single
// publishClientSend rule (plan §1 item 4). Not exercised by any M1 caller. ──
async function _mosAddCameraAcl(username, cameraId) {
  const rolename = `cam-role-${username}`;
  const createCmds = [
    { command: 'createRole', rolename },
    { command: 'addRoleACL', rolename, acltype: 'publishClientSend', topic: `${cameraId}/onvif-ej/#`, allow: true },
  ];
  const res = await _dynsecSend(createCmds);
  const bad = _dynsecErrorsIgnoringExists(res);
  if (bad.length) throw new Error(`mosquitto addCameraAcl ${cameraId}: ${JSON.stringify(bad)}`);
  await _ensureClientRole(username, rolename);
  return 'updated';
}

async function _mosClearRetained(topic) {
  const user = env.str('MQTT_PUBLISHER_USER');
  const pass = env.str('MQTT_PUBLISHER_PASSWORD');
  if (!user || !pass) throw new Error('MQTT_PUBLISHER_USER/PASSWORD not set');
  return require('./mqttPublisher').publishRaw(topic, '', { qos: 1, retain: true });
}

async function _mosPublish(topic, payloadObj, opts) {
  const user = env.str('MQTT_PUBLISHER_USER');
  const pass = env.str('MQTT_PUBLISHER_PASSWORD');
  if (!user || !pass) throw new Error('MQTT_PUBLISHER_USER/PASSWORD not set');
  const mqttPublisher = require('./mqttPublisher'); // lazy — same reason as _requireMqtt
  return mqttPublisher.publish(topic, payloadObj, opts);
}

// ================================================================
// ── Public interface ──
// ================================================================

/**
 * Whether the broker admin path has what it needs to run right now.
 * as: 'provisioner' (default, dynsec / EMQX admin ops) | 'publisher' (MQTT publish)
 * emqx mode uses one credential for both — 'as' is accepted but ignored there.
 */
function isConfigured({ as = 'provisioner' } = {}) {
  if (_kind() === 'emqx') return !!env.str('EMQX_DASHBOARD_PASSWORD');
  if (as === 'publisher') return !!(env.str('MQTT_PUBLISHER_USER') && env.str('MQTT_PUBLISHER_PASSWORD'));
  return !!(env.str('MQTT_PROVISIONER_USER') && env.str('MQTT_PROVISIONER_PASSWORD'));
}

async function upsertUser(username, password, opts = {}) {
  return _kind() === 'mosquitto' ? _mosUpsertUser(username, password, opts) : _emqxUpsertUser(username, password);
}

async function deleteUser(username) {
  return _kind() === 'mosquitto' ? _mosDeleteUser(username) : _emqxDeleteUser(username);
}

async function setSiteAcl(username, siteCode) {
  return _kind() === 'mosquitto' ? _mosSetSiteAcl(username, siteCode) : _emqxSetSiteAcl(username, siteCode);
}

async function addCameraAcl(username, cameraId) {
  return _kind() === 'mosquitto' ? _mosAddCameraAcl(username, cameraId) : _emqxAddCameraAcl(username, cameraId);
}

/** Whether `username` already has a client on the broker — mosquitto only
 * (dynsec getClient). Used by rotation scripts that must refuse to create. */
async function clientExists(username) {
  if (_kind() !== 'mosquitto') throw new Error('clientExists: mosquitto only (BROKER_KIND=emqx not supported)');
  return _mosClientExists(username);
}

async function listConnectedUsers() {
  // Mosquitto dynsec lists configured accounts, not live sessions — cannot
  // answer "who is connected right now" (spike test #9, plan §1 item 4).
  return _kind() === 'mosquitto' ? null : _emqxListConnectedUsers();
}

async function publish(topic, payloadObj, opts = {}) {
  return _kind() === 'mosquitto' ? _mosPublish(topic, payloadObj, opts) : _emqxPublish(topic, payloadObj, opts);
}

/** Remove the site's broker ACL (mosquitto role `site-<code>` / EMQX rules of `edge-<code>`). */
async function deleteSiteRole(siteCode) {
  return _kind() === 'mosquitto' ? _mosDeleteSiteRole(siteCode) : _emqxDeleteSiteRole(siteCode);
}

/** Clear a retained message (zero-length retained publish). */
async function clearRetained(topic) {
  return _kind() === 'mosquitto' ? _mosClearRetained(topic) : _emqxClearRetained(topic);
}

async function ensureAuthzSource() {
  return _kind() === 'mosquitto' ? 'n/a' : _emqxEnsureAuthzSource();
}

module.exports = {
  isConfigured, upsertUser, deleteUser, setSiteAcl, addCameraAcl,
  listConnectedUsers, publish, ensureAuthzSource, clientExists, deleteSiteRole, clearRetained,
  _kind, // test-only accessor
};
