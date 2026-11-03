// ============================================================
// Vigil Platform — Tests: scripts/migrate-emqx-to-mosquitto.js
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// docs/reports/2026-09-27_mosquitto-migration-plan.md §8 A2.
//
// Covers: EMQX-rule → dynsec-ACL translation table, password source
// resolution + skip logic, apply-mode idempotency (fake dynsec broker, same
// technique as test/broker-admin.test.js), and — the hard requirement for a
// script that handles real credentials — that no password value EVER reaches
// stdout/stderr, in dry-run OR apply mode, verified by actually spawning the
// CLI and grepping its captured output for the injected fake secrets.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EventEmitter = require('events');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'migrate-emqx-to-mosquitto.js');
const mig = require(SCRIPT_PATH);

const EXPORT_FIXTURE = {
  users: [
    { username: 'snapshot-publisher' },
    { username: 'edge-vss' },
    { username: 'edge-nrw' },
    { username: 'dashboard-subscriber' },
    { username: 'cam-c28' },
    { username: 'cam-no-password' },   // deliberately absent from cameraPasswords below
    { username: 'edge-no-stdin' },     // deliberately absent from edgePasswords below
  ],
  rules: [
    { username: 'snapshot-publisher', rules: [{ action: 'publish', topic: '+/onvif-ej/Device/snapshot', permission: 'allow' }] },
    { username: 'edge-vss', rules: [
      { action: 'all', topic: 'projects/vss/#', permission: 'allow' },
      { action: 'publish', topic: 'BOSCH_3100i/onvif-ej/#', permission: 'allow' },
    ] },
    { username: 'edge-nrw', rules: [{ action: 'all', topic: 'projects/nrw/#', permission: 'allow' }] },
    { username: 'dashboard-subscriber', rules: [
      { action: 'subscribe', topic: '+/onvif-ej/Device/#', permission: 'allow' },
      { action: 'subscribe', topic: 'projects/+/#', permission: 'allow' },
    ] },
    { username: 'cam-c28', rules: [{ action: 'publish', topic: 'C28/onvif-ej/#', permission: 'allow' }] },
    // no rules entry for cam-no-password / edge-no-stdin — matches real export shape
  ],
};

function fullCtx(overrides = {}) {
  return {
    subscriberPassword: 'sub-pw', snapshotPassword: 'snap-pw',
    provisionerPassword: 'prov-pw', publisherPassword: 'pub-pw',
    edgePasswords: { 'edge-vss': 'vss-pw', 'edge-nrw': 'nrw-pw' },
    cameraPasswords: { 'cam-c28': 'cam-pw' },
    ...overrides,
  };
}

// ================================================================
// pure translation table
// ================================================================

describe('ACTION_ACLTYPES translation table', () => {
  test('publish → publishClientSend only', () => {
    assert.deepEqual(mig.ACTION_ACLTYPES.publish, ['publishClientSend']);
  });
  test('subscribe → subscribePattern only', () => {
    assert.deepEqual(mig.ACTION_ACLTYPES.subscribe, ['subscribePattern']);
  });
  test('all → both', () => {
    assert.deepEqual(mig.ACTION_ACLTYPES.all, ['publishClientSend', 'subscribePattern']);
  });
});

describe('buildUserRole', () => {
  test('createRole first, then one addRoleACL per (acltype, rule)', () => {
    const { rolename, commands } = mig.buildUserRole('edge-vss', [
      { action: 'all', topic: 'projects/vss/#', permission: 'allow' },
      { action: 'publish', topic: 'BOSCH_3100i/onvif-ej/#', permission: 'allow' },
    ]);
    assert.equal(rolename, 'r-edge-vss');
    assert.deepEqual(commands, [
      { command: 'createRole', rolename: 'r-edge-vss' },
      { command: 'addRoleACL', rolename: 'r-edge-vss', acltype: 'publishClientSend', topic: 'projects/vss/#', allow: true },
      { command: 'addRoleACL', rolename: 'r-edge-vss', acltype: 'subscribePattern', topic: 'projects/vss/#', allow: true },
      { command: 'addRoleACL', rolename: 'r-edge-vss', acltype: 'publishClientSend', topic: 'BOSCH_3100i/onvif-ej/#', allow: true },
    ]);
  });

  test('permission: deny is preserved as allow:false', () => {
    const { commands } = mig.buildUserRole('x', [{ action: 'publish', topic: 't', permission: 'deny' }]);
    assert.equal(commands[1].allow, false);
  });

  test('no rules → createRole only, no addRoleACL', () => {
    const { commands } = mig.buildUserRole('x', []);
    assert.deepEqual(commands, [{ command: 'createRole', rolename: 'r-x' }]);
  });
});

describe('buildProvisionerRole / buildPublisherRole', () => {
  test('provisioner: publishClientSend + publishClientReceive + subscribePattern on $CONTROL/dynamic-security/#', () => {
    const { rolename, commands } = mig.buildProvisionerRole();
    assert.equal(rolename, 'provisioner');
    const acltypes = commands.filter((c) => c.command === 'addRoleACL').map((c) => c.acltype).sort();
    assert.deepEqual(acltypes, ['publishClientReceive', 'publishClientSend', 'subscribePattern']);
    assert.ok(commands.every((c) => c.command !== 'addRoleACL' || c.topic === '$CONTROL/dynamic-security/#'));
  });

  test('publisher: publishClientSend on projects/+/_config/# only', () => {
    const { rolename, commands } = mig.buildPublisherRole();
    assert.equal(rolename, 'publisher');
    assert.deepEqual(commands, [
      { command: 'createRole', rolename: 'publisher' },
      { command: 'addRoleACL', rolename: 'publisher', acltype: 'publishClientSend', topic: 'projects/+/_config/#', allow: true },
    ]);
  });
});

// ================================================================
// password resolution + skip logic
// ================================================================

describe('resolvePassword', () => {
  const ctx = fullCtx();
  test('dashboard-subscriber ← MQTT_SUBSCRIBER_PASSWORD', () => {
    assert.deepEqual(mig.resolvePassword('dashboard-subscriber', ctx), { password: 'sub-pw', source: 'env MQTT_SUBSCRIBER_PASSWORD' });
  });
  test('snapshot-publisher ← SNAPSHOT_PUBLISHER_PASSWORD', () => {
    assert.deepEqual(mig.resolvePassword('snapshot-publisher', ctx), { password: 'snap-pw', source: 'env SNAPSHOT_PUBLISHER_PASSWORD' });
  });
  test('edge-* ← stdin map', () => {
    assert.deepEqual(mig.resolvePassword('edge-vss', ctx), { password: 'vss-pw', source: 'stdin' });
  });
  test('edge-* missing from stdin map → null (never guessed)', () => {
    assert.equal(mig.resolvePassword('edge-no-stdin', ctx), null);
  });
  test('cam-* ← cameras-config.json map', () => {
    assert.deepEqual(mig.resolvePassword('cam-c28', ctx), { password: 'cam-pw', source: 'cameras-config.json (mqtt_password)' });
  });
  test('cam-* missing from cameras-config → null', () => {
    assert.equal(mig.resolvePassword('cam-no-password', ctx), null);
  });
  test('unknown username shape → null', () => {
    assert.equal(mig.resolvePassword('provisioner', ctx), null, 'provisioner/publisher are resolved separately in buildPlan, not via resolvePassword');
  });
});

describe('buildPlan — skip logic + provisioner/publisher inclusion', () => {
  test('every export user gets resolved when every source is present', () => {
    const plan = mig.buildPlan(EXPORT_FIXTURE, fullCtx());
    const names = plan.users.map((u) => u.username);
    assert.ok(names.includes('snapshot-publisher'));
    assert.ok(names.includes('edge-vss'));
    assert.ok(names.includes('cam-c28'));
    assert.ok(names.includes('provisioner'));
    assert.ok(names.includes('publisher'));
    const skippedNames = plan.skipped.map((s) => s.username);
    assert.deepEqual(skippedNames.sort(), ['cam-no-password', 'edge-no-stdin']);
  });

  test('users with rules get a role; users with none (e.g. some cam-*) do not', () => {
    const plan = mig.buildPlan(EXPORT_FIXTURE, fullCtx());
    const camC28 = plan.users.find((u) => u.username === 'cam-c28');
    assert.equal(camC28.rolename, 'r-cam-c28');
    assert.equal(camC28.roleCommands.length, 2); // createRole + 1 addRoleACL
  });

  test('provisioner/publisher skipped by name (not guessed a password) when their env is unset', () => {
    const plan = mig.buildPlan(EXPORT_FIXTURE, fullCtx({ provisionerPassword: undefined, publisherPassword: undefined }));
    const names = plan.users.map((u) => u.username);
    assert.ok(!names.includes('provisioner'));
    assert.ok(!names.includes('publisher'));
    const skipped = plan.skipped.map((s) => s.username);
    assert.ok(skipped.includes('provisioner'));
    assert.ok(skipped.includes('publisher'));
  });

  test('default ACL is always present in the plan', () => {
    const plan = mig.buildPlan(EXPORT_FIXTURE, fullCtx());
    assert.deepEqual(plan.defaultAcl, mig.defaultAclCommands());
  });
});

describe('formatPlan — never renders a password value', () => {
  test('every injected secret is absent from the formatted text; sources and SKIP lines are present', () => {
    const ctx = fullCtx();
    const plan = mig.buildPlan(EXPORT_FIXTURE, ctx);
    const text = mig.formatPlan(plan);
    for (const secret of ['sub-pw', 'snap-pw', 'prov-pw', 'pub-pw', 'vss-pw', 'nrw-pw', 'cam-pw']) {
      assert.ok(!text.includes(secret), `formatPlan output must never contain the password value "${secret}"`);
    }
    assert.match(text, /password: from env MQTT_SUBSCRIBER_PASSWORD/);
    assert.match(text, /cam-no-password\s+SKIP \(no password\)/);
    assert.match(text, /edge-no-stdin\s+SKIP \(no password\)/);
  });
});

// ================================================================
// apply-mode — fake dynsec broker (same technique as test/broker-admin.test.js)
// ================================================================

function fakeDynsecClient(scriptFn) {
  const c = new EventEmitter();
  c.connected = false;
  c.sentBatches = [];
  c.subscribe = (_topic, _opts, cb) => cb(null, [{ qos: 1 }]);
  c.publish = (topic, payload, _opts, cb) => {
    if (topic !== '$CONTROL/dynamic-security/v1') { if (cb) cb(); return; }
    const { commands } = JSON.parse(payload);
    c.sentBatches.push(commands);
    const responses = scriptFn(commands);
    if (cb) cb();
    setImmediate(() => c.emit('message', '$CONTROL/dynamic-security/v1/response', Buffer.from(JSON.stringify({ responses }))));
  };
  c.end = () => {};
  setImmediate(() => { c.connected = true; c.emit('connect'); });
  return c;
}

describe('applyPlan — first run vs. idempotent re-run', () => {
  test('happy path: default ACL once, then role+createClient per user', async () => {
    const client = fakeDynsecClient((cmds) => cmds.map(() => ({})));
    const plan = mig.buildPlan(EXPORT_FIXTURE, fullCtx());
    const report = await mig.applyPlan(client, plan);
    assert.equal(report.failed.length, 0);
    assert.equal(report.created.length, plan.users.length);
    assert.deepEqual(client.sentBatches[0], plan.defaultAcl);
  });

  test('re-run: createClient "already exists" falls back to setClientPassword + ensureClientRole', async () => {
    let n = 0;
    const client = fakeDynsecClient((cmds) => {
      n++;
      if (cmds[0].command === 'setDefaultACLAccess') return cmds.map(() => ({}));
      if (cmds[0].command === 'createRole') return cmds.map(() => ({ error: 'already exists' })); // role batch idempotent-ignored
      if (cmds[0].command === 'createClient') return [{ error: 'Client already exists' }];
      if (cmds[0].command === 'setClientPassword') return [{}];
      if (cmds[0].command === 'getClient') return [{ data: { client: { roles: [] } } }];
      if (cmds[0].command === 'addClientRole') return [{}];
      return cmds.map(() => ({}));
    });
    const plan = mig.buildPlan(EXPORT_FIXTURE, fullCtx());
    const soloUser = { defaultAcl: plan.defaultAcl, users: [plan.users.find((u) => u.username === 'cam-c28')], skipped: [] };
    const report = await mig.applyPlan(client, soloUser);
    assert.equal(report.failed.length, 0);
    assert.deepEqual(report.updated, ['cam-c28']);
    assert.ok(client.sentBatches.some((b) => b[0].command === 'setClientPassword'));
    assert.ok(client.sentBatches.some((b) => b[0].command === 'getClient'));
    assert.ok(client.sentBatches.some((b) => b[0].command === 'addClientRole'));
  });

  test('re-run: role already assigned ⇒ getClient sees it, no addClientRole sent (mirrors brokerAdmin.js _ensureClientRole)', async () => {
    const client = fakeDynsecClient((cmds) => {
      if (cmds[0].command === 'setDefaultACLAccess') return cmds.map(() => ({}));
      if (cmds[0].command === 'createRole' || cmds[0].command === 'addRoleACL') return cmds.map(() => ({ error: 'already exists' }));
      if (cmds[0].command === 'createClient') return [{ error: 'Client already exists' }];
      if (cmds[0].command === 'setClientPassword') return [{}];
      if (cmds[0].command === 'getClient') return [{ data: { client: { roles: [{ rolename: 'r-cam-c28' }] } } }];
      return cmds.map(() => ({}));
    });
    const plan = mig.buildPlan(EXPORT_FIXTURE, fullCtx());
    const soloUser = { defaultAcl: plan.defaultAcl, users: [plan.users.find((u) => u.username === 'cam-c28')], skipped: [] };
    const report = await mig.applyPlan(client, soloUser);
    assert.equal(report.failed.length, 0);
    assert.ok(!client.sentBatches.some((b) => b[0].command === 'addClientRole'), 'role already present — must not re-send addClientRole');
  });

  test('an unrelated dynsec error is recorded in report.failed, not thrown out of applyPlan, and does not block other users', async () => {
    const client = fakeDynsecClient((cmds) => {
      if (cmds[0].command === 'setDefaultACLAccess') return cmds.map(() => ({}));
      if (cmds[0].username === 'cam-c28' || cmds[0].rolename === 'r-cam-c28') return cmds.map(() => ({ error: 'permission denied' }));
      return cmds.map(() => ({}));
    });
    const plan = mig.buildPlan(EXPORT_FIXTURE, fullCtx());
    const report = await mig.applyPlan(client, plan);
    assert.ok(report.failed.some((f) => f.username === 'cam-c28'));
    assert.ok(report.created.some((u) => u === 'snapshot-publisher'), 'other users must still succeed');
  });

  test('role/ACL "already exists" alone is not an error (re-applying the same plan twice is safe)', async () => {
    const client = fakeDynsecClient((cmds) => cmds.map((c) =>
      (c.command === 'createRole' || c.command === 'addRoleACL') ? { error: 'already exists' } : {}));
    const plan = mig.buildPlan(EXPORT_FIXTURE, fullCtx());
    const report = await mig.applyPlan(client, plan);
    assert.equal(report.failed.length, 0);
  });
});

// ================================================================
// stdin edge-password parsing
// ================================================================

describe('readStdinEdgePasswords', () => {
  test('a TTY stdin (nothing piped) resolves to {} without blocking', async () => {
    const fakeTty = { isTTY: true };
    const prev = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeTty, configurable: true });
    try {
      assert.deepEqual(await mig.readStdinEdgePasswords(), {});
    } finally {
      Object.defineProperty(process, 'stdin', { value: prev, configurable: true });
    }
  });
});

// ================================================================
// CLI — spawn the real script, grep captured stdout/stderr for fake secrets
// (the hard requirement: never print a password in ANY mode)
// ================================================================

describe('CLI — no password ever printed, dry-run or apply', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigil-migrate-test-'));
  const exportFile = path.join(tmpDir, 'export.json');
  const camerasFile = path.join(tmpDir, 'cameras-config.json');
  fs.writeFileSync(exportFile, JSON.stringify(EXPORT_FIXTURE));
  fs.writeFileSync(camerasFile, JSON.stringify({
    cameras: [{ camera_id: 'C28', mqtt_username: 'cam-c28', mqtt_password: 'CLI-CAM-SECRET-XYZ' }],
  }));

  const FAKE_ENV = {
    ...process.env,
    MQTT_SUBSCRIBER_PASSWORD: 'CLI-SUB-SECRET-XYZ',
    SNAPSHOT_PUBLISHER_PASSWORD: 'CLI-SNAP-SECRET-XYZ',
    MQTT_PROVISIONER_PASSWORD: 'CLI-PROV-SECRET-XYZ',
    MQTT_PUBLISHER_PASSWORD: 'CLI-PUB-SECRET-XYZ',
  };
  const SECRETS = ['CLI-SUB-SECRET-XYZ', 'CLI-SNAP-SECRET-XYZ', 'CLI-PROV-SECRET-XYZ', 'CLI-PUB-SECRET-XYZ', 'CLI-CAM-SECRET-XYZ', 'CLI-EDGE-SECRET-XYZ'];

  test('dry-run: stdout contains sources, never the secret values', () => {
    const r = spawnSync(process.execPath, [SCRIPT_PATH, '--export', exportFile, '--cameras-config', camerasFile], {
      env: FAKE_ENV, input: JSON.stringify({ 'edge-vss': 'CLI-EDGE-SECRET-XYZ', 'edge-nrw': 'CLI-EDGE-SECRET-XYZ' }),
      encoding: 'utf8', timeout: 10000,
    });
    const combined = (r.stdout || '') + (r.stderr || '');
    for (const secret of SECRETS) assert.ok(!combined.includes(secret), `dry-run leaked a secret: ${secret}`);
    assert.match(r.stdout, /password: from env MQTT_SUBSCRIBER_PASSWORD/);
    assert.equal(r.status, 0);
  });

  test('apply mode against an unreachable broker: still never prints a secret, even on connect failure', () => {
    const r = spawnSync(process.execPath, [
      SCRIPT_PATH, '--export', exportFile, '--cameras-config', camerasFile,
      '--apply', '--url', 'mqtt://127.0.0.1:1', // port 1 — nothing listens, refuses fast
    ], {
      env: { ...FAKE_ENV, MOSQ_ADMIN_USER: 'admin', MOSQ_ADMIN_PASSWORD: 'CLI-ADMIN-SECRET-XYZ' },
      input: JSON.stringify({ 'edge-vss': 'CLI-EDGE-SECRET-XYZ', 'edge-nrw': 'CLI-EDGE-SECRET-XYZ' }),
      encoding: 'utf8', timeout: 10000,
    });
    const combined = (r.stdout || '') + (r.stderr || '');
    for (const secret of [...SECRETS, 'CLI-ADMIN-SECRET-XYZ']) {
      assert.ok(!combined.includes(secret), `apply mode leaked a secret: ${secret}`);
    }
    assert.notEqual(r.status, 0, 'unreachable broker must exit non-zero, not silently succeed');
  });

  test('--apply without --url refuses cleanly (no secrets printed, non-zero exit)', () => {
    const r = spawnSync(process.execPath, [SCRIPT_PATH, '--export', exportFile, '--cameras-config', camerasFile, '--apply'], {
      env: FAKE_ENV, input: '', encoding: 'utf8', timeout: 10000,
    });
    const combined = (r.stdout || '') + (r.stderr || '');
    for (const secret of SECRETS) assert.ok(!combined.includes(secret));
    assert.notEqual(r.status, 0);
  });
});
