// ============================================================
// Vigil Platform — EMQX → Mosquitto dynamic-security migration
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// One-shot script (M2 cutover, docs/reports/2026-09-27_mosquitto-migration-
// plan.md §8 A2): reads an EMQX user/ACL export (REST /users +
// /authorization/.../rules only — no passwords, EMQX never returns them) and
// creates the equivalent Mosquitto dynamic-security accounts/roles over MQTT
// ($CONTROL/dynamic-security/v1 — same protocol brokerAdmin.js's mosquitto
// backend uses, src/helpers/brokerAdmin.js).
//
// Usage:
//   node scripts/migrate-emqx-to-mosquitto.js --export <file> [--dry-run]
//   node scripts/migrate-emqx-to-mosquitto.js --export <file> --apply --url mqtt://127.0.0.1:1883
//     (dynsec admin creds: env MOSQ_ADMIN_USER / MOSQ_ADMIN_PASSWORD — --apply only)
//   optional: --cameras-config <path>            (default: repo root cameras-config.json)
//   optional: JSON object on stdin {"edge-hdy": "...", ...}  (edge bridge passwords)
//
// Password sources (never guessed — a user with none of these is SKIPPED and
// reported by name, not silently dropped):
//   dashboard-subscriber  ← env MQTT_SUBSCRIBER_PASSWORD
//   snapshot-publisher    ← env SNAPSHOT_PUBLISHER_PASSWORD
//   edge-<site>           ← stdin JSON {"edge-<site>": "..."}  (optional input)
//   cam-<id>               ← cameras-config.json mqtt_password, matched by mqtt_username
//                            (decrypted the same way every ingester does —
//                            src/crypto-creds.js decryptCamCreds; still
//                            "enc:v1:..." after decrypt = key unavailable ⇒
//                            treated as no password, never sent as-is)
//   provisioner            ← env MQTT_PROVISIONER_PASSWORD (user: MQTT_PROVISIONER_USER, default 'provisioner')
//   publisher              ← env MQTT_PUBLISHER_PASSWORD   (user: MQTT_PUBLISHER_USER, default 'publisher')
//
// No password value is EVER printed, in --dry-run or --apply — only its
// source label. Passwords travel exactly once, inside a dynsec MQTT publish,
// never through console.log/error.
//
// Idempotent re-run: createClient on an existing username falls back to
// setClientPassword + ensureClientRole (mirrors brokerAdmin.js's
// _mosUpsertUser/_ensureClientRole — Mosquitto 2.1.2 answers a duplicate
// addClientRole with a bare "Internal error", indistinguishable by text from
// a real failure, so role membership is checked via getClient first, never
// string-matched). createRole / addRoleACL "already exists" responses are
// treated as success, same as brokerAdmin.js's _dynsecErrorsIgnoringExists.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { decryptCamCreds } = require(path.join(ROOT, 'src', 'crypto-creds'));
const env = require(path.join(ROOT, 'src', 'config'));

// ================================================================
// ── pure planning — no network, no fs (unit-testable without a broker) ──
// ================================================================

function defaultAclCommands() {
  return [{
    command: 'setDefaultACLAccess',
    acls: [
      { acltype: 'publishClientSend', allow: false },
      { acltype: 'subscribe', allow: false },
      { acltype: 'publishClientReceive', allow: true },
      { acltype: 'unsubscribe', allow: true },
    ],
  }];
}

// EMQX rule action → Mosquitto dynsec ACL type(s) (plan §8 A2)
const ACTION_ACLTYPES = {
  publish: ['publishClientSend'],
  subscribe: ['subscribePattern'],
  all: ['publishClientSend', 'subscribePattern'],
};

/** One role per migrated user, translating its EMQX rules 1:1. */
function buildUserRole(username, rules) {
  const rolename = `r-${username}`;
  const commands = [{ command: 'createRole', rolename }];
  for (const rule of rules || []) {
    const acltypes = ACTION_ACLTYPES[rule.action] || [];
    for (const acltype of acltypes) {
      commands.push({
        command: 'addRoleACL', rolename, acltype, topic: rule.topic,
        allow: rule.permission !== 'deny',
      });
    }
  }
  return { rolename, commands };
}

/** provisioner role — dynsec admin surface only (plan §1 item 5, §8 A2). */
function buildProvisionerRole() {
  const rolename = 'provisioner';
  const topic = '$CONTROL/dynamic-security/#';
  return {
    rolename,
    commands: [
      { command: 'createRole', rolename },
      { command: 'addRoleACL', rolename, acltype: 'publishClientSend', topic, allow: true },
      { command: 'addRoleACL', rolename, acltype: 'publishClientReceive', topic, allow: true },
      { command: 'addRoleACL', rolename, acltype: 'subscribePattern', topic, allow: true },
    ],
  };
}

/** publisher role — Central's own retained-config publisher (mqttPublisher.js). */
function buildPublisherRole() {
  const rolename = 'publisher';
  return {
    rolename,
    commands: [
      { command: 'createRole', rolename },
      { command: 'addRoleACL', rolename, acltype: 'publishClientSend', topic: 'projects/+/_config/#', allow: true },
    ],
  };
}

/**
 * resolvePassword(username, ctx) → { password, source } | null — never guesses.
 * ctx: { subscriberPassword, snapshotPassword, edgePasswords, cameraPasswords }
 */
function resolvePassword(username, ctx) {
  if (username === 'dashboard-subscriber') {
    return ctx.subscriberPassword ? { password: ctx.subscriberPassword, source: 'env MQTT_SUBSCRIBER_PASSWORD' } : null;
  }
  if (username === 'snapshot-publisher') {
    return ctx.snapshotPassword ? { password: ctx.snapshotPassword, source: 'env SNAPSHOT_PUBLISHER_PASSWORD' } : null;
  }
  if (username.startsWith('edge-')) {
    const pw = ctx.edgePasswords && ctx.edgePasswords[username];
    return pw ? { password: pw, source: 'stdin' } : null;
  }
  if (username.startsWith('cam-')) {
    const pw = ctx.cameraPasswords && ctx.cameraPasswords[username];
    return pw ? { password: pw, source: 'cameras-config.json (mqtt_password)' } : null;
  }
  return null;
}

/**
 * buildPlan(exportData, ctx) →
 *   { defaultAcl, users: [{username, rolename, roleCommands, clientCommand, source}], skipped: [{username, reason}] }
 * Pure. `ctx` carries every password source already resolved by the caller.
 */
function buildPlan(exportData, ctx) {
  const rulesByUser = new Map((exportData.rules || []).map((r) => [r.username, r.rules]));
  const users = [];
  const skipped = [];

  for (const u of exportData.users || []) {
    const username = u.username;
    const resolved = resolvePassword(username, ctx);
    if (!resolved) { skipped.push({ username, reason: 'no password source' }); continue; }
    const rules = rulesByUser.get(username) || [];
    let rolename = null;
    let roleCommands = [];
    if (rules.length) {
      const role = buildUserRole(username, rules);
      rolename = role.rolename;
      roleCommands = role.commands;
    }
    users.push({
      username, rolename, roleCommands,
      clientCommand: { command: 'createClient', username, password: resolved.password, roles: rolename ? [{ rolename }] : [] },
      source: resolved.source,
    });
  }

  // provisioner / publisher — new accounts, not present in the EMQX export
  const provUser = env.str('MQTT_PROVISIONER_USER') || 'provisioner';
  if (ctx.provisionerPassword) {
    const role = buildProvisionerRole();
    users.push({
      username: provUser, rolename: role.rolename, roleCommands: role.commands,
      clientCommand: { command: 'createClient', username: provUser, password: ctx.provisionerPassword, roles: [{ rolename: role.rolename }] },
      source: 'env MQTT_PROVISIONER_PASSWORD',
    });
  } else {
    skipped.push({ username: provUser, reason: 'no password source (MQTT_PROVISIONER_PASSWORD unset)' });
  }

  const pubUser = env.str('MQTT_PUBLISHER_USER') || 'publisher';
  if (ctx.publisherPassword) {
    const role = buildPublisherRole();
    users.push({
      username: pubUser, rolename: role.rolename, roleCommands: role.commands,
      clientCommand: { command: 'createClient', username: pubUser, password: ctx.publisherPassword, roles: [{ rolename: role.rolename }] },
      source: 'env MQTT_PUBLISHER_PASSWORD',
    });
  } else {
    skipped.push({ username: pubUser, reason: 'no password source (MQTT_PUBLISHER_PASSWORD unset)' });
  }

  return { defaultAcl: defaultAclCommands(), users, skipped };
}

/** Dry-run / apply-summary text — password VALUES never appear, only the source label. */
function formatPlan(plan) {
  const lines = [];
  lines.push('default ACL: publishClientSend=deny subscribe=deny publishClientReceive=allow unsubscribe=allow');
  for (const u of plan.users) {
    lines.push(`\n${u.username}  (password: from ${u.source})`);
    if (u.rolename) {
      lines.push(`  role ${u.rolename}:`);
      for (const c of u.roleCommands) {
        if (c.command === 'addRoleACL') lines.push(`    ${c.acltype} ${c.allow ? 'allow' : 'deny'} ${c.topic}`);
      }
    } else {
      lines.push('  no role (no ACL rules in the export)');
    }
  }
  for (const s of plan.skipped) {
    lines.push(`\n${s.username}  SKIP (no password) — ${s.reason}`);
  }
  return lines.join('\n');
}

// ================================================================
// ── dynsec transport (mirrors brokerAdmin.js's mosquitto backend —
// separate implementation on purpose: this script bootstraps with the
// dynsec ADMIN account via --url/env, brokerAdmin.js's runtime provisioner
// is a different, narrower-scoped credential) ──
// ================================================================

function _dynsecErrors(res) {
  return (res.responses || []).filter((r) => r && r.error);
}
function _dynsecErrorsIgnoringExists(res) {
  return _dynsecErrors(res).filter((r) => !/already exists|not found/i.test(String(r.error)));
}

function connectAdmin(url, username, password) {
  // eslint-disable-next-line
  const mqtt = require(path.join(ROOT, 'src', 'node_modules', 'mqtt'));
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, {
      username, password, clean: true, reconnectPeriod: 0, connectTimeout: 8000,
      clientId: `migrate-emqx-mosquitto-${process.pid}`,
    });
    const to = setTimeout(() => { client.end(true); reject(new Error('admin connect timeout')); }, 8000);
    client.once('connect', () => {
      client.subscribe('$CONTROL/dynamic-security/v1/response', { qos: 1 }, (err) => {
        clearTimeout(to);
        if (err) return reject(err);
        resolve(client);
      });
    });
    client.once('error', (e) => { clearTimeout(to); reject(e); });
  });
}

function sendDynsec(client, commands) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener('message', onMsg);
      reject(new Error('dynsec response timeout'));
    }, 8000);
    function onMsg(topic, buf) {
      if (topic !== '$CONTROL/dynamic-security/v1/response') return;
      clearTimeout(timer);
      client.removeListener('message', onMsg);
      try { resolve(JSON.parse(buf.toString())); } catch (e) { reject(e); }
    }
    client.on('message', onMsg);
    client.publish('$CONTROL/dynamic-security/v1', JSON.stringify({ commands }), { qos: 1 }, (err) => {
      if (err) { clearTimeout(timer); client.removeListener('message', onMsg); reject(err); }
    });
  });
}

async function ensureClientRole(client, username, rolename) {
  const got = await sendDynsec(client, [{ command: 'getClient', username }]);
  const r0 = (got.responses || [])[0] || {};
  if (r0.error) throw new Error(`getClient ${username}: ${JSON.stringify(r0.error)}`);
  const roles = (r0.data && r0.data.client && r0.data.client.roles) || [];
  if (roles.some((r) => r && r.rolename === rolename)) return 'exists';
  const res = await sendDynsec(client, [{ command: 'addClientRole', username, rolename }]);
  const bad = _dynsecErrors(res);
  if (bad.length) throw new Error(`addClientRole ${username}/${rolename}: ${JSON.stringify(bad)}`);
  return 'added';
}

async function applyUser(client, u, report) {
  if (u.roleCommands.length) {
    const res = await sendDynsec(client, u.roleCommands);
    const bad = _dynsecErrorsIgnoringExists(res);
    if (bad.length) throw new Error(`role ${u.rolename}: ${JSON.stringify(bad)}`);
  }
  const res = await sendDynsec(client, [u.clientCommand]);
  const bad = _dynsecErrors(res);
  if (!bad.length) { report.created.push(u.username); return; }
  if (!/already exists/i.test(String(bad[0].error))) {
    throw new Error(`createClient ${u.username}: ${JSON.stringify(bad)}`);
  }
  const res2 = await sendDynsec(client, [{ command: 'setClientPassword', username: u.username, password: u.clientCommand.password }]);
  const bad2 = _dynsecErrors(res2);
  if (bad2.length) throw new Error(`setClientPassword ${u.username}: ${JSON.stringify(bad2)}`);
  if (u.rolename) await ensureClientRole(client, u.username, u.rolename);
  report.updated.push(u.username);
}

/** applyPlan(client, plan) — client already connected + subscribed to the response topic. */
async function applyPlan(client, plan) {
  const report = { created: [], updated: [], failed: [] };
  const resDefault = await sendDynsec(client, plan.defaultAcl);
  const badDefault = _dynsecErrorsIgnoringExists(resDefault);
  if (badDefault.length) throw new Error(`setDefaultACLAccess: ${JSON.stringify(badDefault)}`);
  for (const u of plan.users) {
    try { await applyUser(client, u, report); }
    catch (e) { report.failed.push({ username: u.username, error: e.message }); }
  }
  return report;
}

// ================================================================
// ── I/O: export file, cameras-config.json, stdin edge passwords ──
// ================================================================

/** cameras-config.json → { mqtt_username: plaintext_mqtt_password }. Never
 * returns a value still shaped like "enc:v1:..." — that means CAMERA_SECRET_KEY
 * was unavailable to decrypt it, which must read as "no password", not as a
 * password (sending ciphertext as a broker password would just lock the
 * account out with garbage, silently). */
function loadCameraPasswords(camerasConfigPath) {
  const out = {};
  let raw;
  try { raw = fs.readFileSync(camerasConfigPath, 'utf8'); } catch { return out; }
  let data;
  try { data = JSON.parse(raw); } catch { return out; }
  const cams = Array.isArray(data) ? data : (data.cameras || []);
  for (const cam of cams) {
    if (!cam || !cam.mqtt_username || !cam.mqtt_password) continue;
    const decrypted = decryptCamCreds({ ...cam }).mqtt_password;
    if (decrypted && !String(decrypted).startsWith('enc:v1:')) out[cam.mqtt_username] = decrypted;
  }
  return out;
}

/** stdin JSON {"edge-<site>": "password", ...} — optional; empty/absent stdin = {}. */
async function readStdinEdgePasswords() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
  } catch { return {}; }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const obj = JSON.parse(text);
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  } catch { return {}; }
}

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  const exportPath = arg('export');
  if (!exportPath) {
    console.error('usage: migrate-emqx-to-mosquitto.js --export <file> [--dry-run] | --apply --url <mqtt url>');
    process.exitCode = 1;
    return;
  }
  const apply = process.argv.includes('--apply');
  const camerasConfigPath = arg('cameras-config', path.join(ROOT, 'cameras-config.json'));

  const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  const edgePasswords = await readStdinEdgePasswords();
  const cameraPasswords = loadCameraPasswords(camerasConfigPath);

  const ctx = {
    subscriberPassword: env.str('MQTT_SUBSCRIBER_PASSWORD'),
    snapshotPassword: env.str('SNAPSHOT_PUBLISHER_PASSWORD'),
    provisionerPassword: env.str('MQTT_PROVISIONER_PASSWORD'),
    publisherPassword: env.str('MQTT_PUBLISHER_PASSWORD'),
    edgePasswords, cameraPasswords,
  };
  const plan = buildPlan(exportData, ctx);

  if (!apply) {
    console.log(formatPlan(plan));
    console.log(`\n(dry-run — nothing sent. ${plan.users.length} to migrate, ${plan.skipped.length} skipped)`);
    return;
  }

  const url = arg('url');
  if (!url) { console.error('--apply requires --url <mqtt url>'); process.exitCode = 1; return; }
  const adminUser = process.env.MOSQ_ADMIN_USER;
  const adminPass = process.env.MOSQ_ADMIN_PASSWORD;
  if (!adminUser || !adminPass) {
    console.error('--apply requires env MOSQ_ADMIN_USER / MOSQ_ADMIN_PASSWORD');
    process.exitCode = 1;
    return;
  }
  const client = await connectAdmin(url, adminUser, adminPass);
  try {
    const report = await applyPlan(client, plan);
    console.log(`created: ${report.created.length}  updated: ${report.updated.length}  failed: ${report.failed.length}`);
    if (plan.skipped.length) console.log(`skipped (no password): ${plan.skipped.map((s) => s.username).join(', ')}`);
    if (report.failed.length) {
      console.error('FAILED:');
      for (const f of report.failed) console.error(`  ${f.username}: ${f.error}`);
      process.exitCode = 1;
    }
  } finally {
    client.end(true);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; });
}

module.exports = {
  defaultAclCommands, ACTION_ACLTYPES, buildUserRole, buildProvisionerRole, buildPublisherRole,
  resolvePassword, buildPlan, formatPlan,
  _dynsecErrors, _dynsecErrorsIgnoringExists,
  connectAdmin, sendDynsec, ensureClientRole, applyUser, applyPlan,
  loadCameraPasswords, readStdinEdgePasswords, main,
};
