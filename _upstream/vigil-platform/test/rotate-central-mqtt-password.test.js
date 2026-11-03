// ============================================================
// Vigil Platform — Tests: scripts/rotate-central-mqtt-password.js
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Everything here runs against fakes (brokerAdmin, fs, spawn, crypto, log) —
// no real broker, no real .env, no real `op` process, no network. Status
// output is captured via the injected `log` dep, not by monkeypatching the
// real process.stdout/stderr — doing that in more than one test at a time
// was observed to corrupt node:test's own TAP bookkeeping for this file
// (later tests silently vanish from the report). One dedicated test below
// still proves nothing reaches the real stdout, in isolation.
//
// Proves:
//   - refuses to run outside BROKER_KIND=mosquitto, with an empty USER key,
//     or when the broker client does not already exist (rotation only)
//   - broker is updated before .env, and a failure writing .env after the
//     broker changed is reported as non-zero with a recovery message
//   - .env backup + final file land at mode 0600; existing PASSWORD line is
//     replaced in place, a missing one is appended
//   - after a successful .env write, the whole-.env 1Password backup
//     (backup-env-to-1password.js) is invoked, and best-effort: a failure
//     there does not fail rotation. Token/argv/stdin transport rules and the
//     item shape are covered by test/backup-env-to-1password.test.js, not here.
//   - the generated password never appears in the log or on real stdout
// ============================================================
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { rotate } = require('../scripts/rotate-central-mqtt-password');

const FIXED_PASSWORD = Buffer.alloc(24, 7).toString('base64url');
const fakeCrypto = { randomBytes: () => Buffer.alloc(24, 7) };
const fakeNow = () => new Date('2026-09-28T12:00:00.000Z');

const BASE_ENV = {
  VIGIL_ENV_FILE: '/fake/src/.env',
  VIGIL_OP_TOKEN_FILE: '/fake/op-token.txt',
  VIGIL_OP_VAULT: 'Vigil Central Test',
};

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  });
}

function makeLog() {
  const lines = [];
  const log = (msg) => lines.push(String(msg));
  return { log, text: () => lines.join('') };
}

function makeFakeFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles).map(([p, content]) => [p, { content, mode: 0o644 }]));
  return {
    _files: files,
    existsSync: (p) => files.has(p),
    readFileSync: (p, enc) => {
      if (!files.has(p)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; }
      const f = files.get(p);
      return enc ? f.content : Buffer.from(f.content);
    },
    writeFileSync: (p, data, opts) => { files.set(p, { content: data, mode: (opts && opts.mode) || 0o644 }); },
    copyFileSync: (src, dst) => {
      if (!files.has(src)) { const e = new Error(`ENOENT: ${src}`); throw e; }
      files.set(dst, { ...files.get(src) });
    },
    chmodSync: (p, mode) => {
      if (!files.has(p)) { const e = new Error(`ENOENT: ${p}`); throw e; }
      files.get(p).mode = mode;
    },
  };
}

function makeFakeBrokerAdmin({ exists = true, upsertError = null } = {}) {
  const calls = [];
  return {
    calls,
    clientExists: async (username) => { calls.push({ fn: 'clientExists', username }); return exists; },
    upsertUser: async (username, password) => {
      calls.push({ fn: 'upsertUser', username, password });
      if (upsertError) throw upsertError;
      return 'updated';
    },
  };
}

// Fake `op` binary: `available` gates `op --version`; `script(call)` answers every
// other invocation ({code, stdout, stderr, error}); every call is recorded.
function makeFakeSpawn({ available = true, script = () => ({ code: 0 }) } = {}) {
  const calls = [];
  function spawn(cmd, args, opts) {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.stdin = {
      end: (data) => {
        setImmediate(() => {
          const call = { cmd, args, env: opts.env, stdin: data || '' };
          calls.push(call);
          if (args[0] === '--version' && !available) {
            c.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
            return;
          }
          const r = script(call) || {};
          if (r.stdout) c.stdout.emit('data', r.stdout);
          if (r.stderr) c.stderr.emit('data', r.stderr);
          if (r.error) { c.emit('error', r.error); return; }
          c.emit('close', r.code === undefined ? 0 : r.code);
        });
      },
    };
    return c;
  }
  return { spawn, calls };
}

async function rejects(promiseFactory) {
  try { await promiseFactory(); return undefined; } catch (e) { return e; }
}

// ================================================================
// Refusals
// ================================================================

test('unknown account arg -> usage error, never touches broker or fs', async () => {
  const e = await rejects(() => rotate('bogus', {}, {}));
  assert.ok(e && e.usage === true);
});

test('BROKER_KIND not mosquitto -> refuse', async () => {
  await withEnv({ BROKER_KIND: 'emqx', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const e = await rejects(() => rotate('subscriber', {}, { brokerAdmin, env: BASE_ENV }));
    assert.match(e.message, /BROKER_KIND/);
    assert.equal(brokerAdmin.calls.length, 0, 'must refuse before ever calling brokerAdmin');
  });
});

test('empty USER key -> refuse', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: '' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const e = await rejects(() => rotate('subscriber', {}, { brokerAdmin, env: BASE_ENV }));
    assert.match(e.message, /MQTT_SUBSCRIBER_USER/);
    assert.equal(brokerAdmin.calls.length, 0);
  });
});

test('client missing on broker -> refuse (rotation only, never creates)', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin({ exists: false });
    const e = await rejects(() => rotate('subscriber', {}, { brokerAdmin, env: BASE_ENV }));
    assert.match(e.message, /ไม่มีอยู่ใน broker/);
    assert.ok(!brokerAdmin.calls.some((c) => c.fn === 'upsertUser'));
  });
});

// ================================================================
// Happy path — broker, then .env, in order; file modes; replace vs append
// ================================================================

test('subscriber rotation: broker before .env, existing PASSWORD line replaced, modes 0600, password never logged', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const fs = makeFakeFs({
      '/fake/src/.env': 'MQTT_SUBSCRIBER_USER=dashboard-subscriber\nMQTT_SUBSCRIBER_PASSWORD=old-secret\nOTHER=1\n',
    });
    const spawn = makeFakeSpawn({ available: false }).spawn; // no token file anyway -> op never runs
    const { log, text } = makeLog();

    const value = await rotate('subscriber', {}, { brokerAdmin, fs, spawn, crypto: fakeCrypto, now: fakeNow, env: BASE_ENV, log });

    // order: broker call recorded before the .env write landed
    assert.deepEqual(brokerAdmin.calls.map((c) => c.fn), ['clientExists', 'upsertUser']);
    assert.equal(brokerAdmin.calls[1].username, 'dashboard-subscriber');
    assert.equal(brokerAdmin.calls[1].password, FIXED_PASSWORD);

    const finalEnv = fs._files.get('/fake/src/.env');
    assert.match(finalEnv.content, /^MQTT_SUBSCRIBER_PASSWORD=/m);
    assert.equal(finalEnv.content.match(/^MQTT_SUBSCRIBER_PASSWORD=(.*)$/m)[1], FIXED_PASSWORD);
    assert.match(finalEnv.content, /^OTHER=1$/m, 'unrelated lines preserved');
    assert.equal(finalEnv.mode, 0o600);

    const backup = fs._files.get(value.backupPath);
    assert.ok(backup, 'backup file was written');
    assert.equal(backup.mode, 0o600);
    assert.equal(backup.content, 'MQTT_SUBSCRIBER_USER=dashboard-subscriber\nMQTT_SUBSCRIBER_PASSWORD=old-secret\nOTHER=1\n', 'backup holds the pre-rotation content');

    assert.ok(!text().includes(FIXED_PASSWORD), 'password must never be logged');
  });
});

test('snapshot rotation: missing PASSWORD line is appended, not replaced', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', SNAPSHOT_PUBLISHER_USER: 'snapshot-publisher' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const fs = makeFakeFs({ '/fake/src/.env': 'SNAPSHOT_PUBLISHER_USER=snapshot-publisher\n' });
    const spawn = makeFakeSpawn({ available: false }).spawn;
    const { log } = makeLog();

    const value = await rotate('snapshot', {}, { brokerAdmin, fs, spawn, crypto: fakeCrypto, now: fakeNow, env: BASE_ENV, log });
    const finalEnv = fs._files.get('/fake/src/.env');
    assert.equal(finalEnv.content, `SNAPSHOT_PUBLISHER_USER=snapshot-publisher\nSNAPSHOT_PUBLISHER_PASSWORD=${FIXED_PASSWORD}\n`);
    assert.ok(value.backupPath.includes('.bak-rotate-'));
  });
});

// ================================================================
// .env write failure after the broker already changed
// ================================================================

test('.env write failure after broker rotated -> rejects with envWriteFailed + recovery message', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const fs = makeFakeFs({ '/fake/src/.env': 'MQTT_SUBSCRIBER_PASSWORD=old\n' });
    fs.writeFileSync = () => { throw new Error('disk full'); };
    const spawn = makeFakeSpawn({ available: false }).spawn;
    const { log } = makeLog();

    const e = await rejects(() => rotate('subscriber', {}, { brokerAdmin, fs, spawn, crypto: fakeCrypto, now: fakeNow, env: BASE_ENV, log }));
    assert.ok(e);
    assert.equal(e.envWriteFailed, true);
    assert.match(e.message, /รัน rotation นี้ใหม่/);
    assert.ok(brokerAdmin.calls.some((c) => c.fn === 'upsertUser'), 'broker was already rotated before the .env failure');
  });
});

test('.env write failure -> not classified as a usage error (main() would exit 1, not 2)', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const fs = makeFakeFs({ '/fake/src/.env': 'MQTT_SUBSCRIBER_PASSWORD=old\n' });
    fs.writeFileSync = () => { throw new Error('disk full'); };
    const { log } = makeLog();
    const e = await rejects(() => rotate('subscriber', {}, {
      brokerAdmin, fs, spawn: makeFakeSpawn({ available: false }).spawn, crypto: fakeCrypto, now: fakeNow, env: BASE_ENV, log,
    }));
    assert.ok(e);
    assert.notEqual(e.usage, true);
  });
});

// ================================================================
// dry-run — validates, changes nothing
// ================================================================

test('--dry-run validates and changes nothing', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const fs = makeFakeFs({ '/fake/src/.env': 'MQTT_SUBSCRIBER_PASSWORD=old\n' });
    const spawn = makeFakeSpawn({ available: false }).spawn;
    const { log, text } = makeLog();

    const value = await rotate('subscriber', { dryRun: true }, { brokerAdmin, fs, spawn, crypto: fakeCrypto, now: fakeNow, env: BASE_ENV, log });
    assert.equal(value.dryRun, true);
    assert.equal(fs._files.get('/fake/src/.env').content, 'MQTT_SUBSCRIBER_PASSWORD=old\n', 'unchanged');
    assert.ok(!brokerAdmin.calls.some((c) => c.fn === 'upsertUser'), 'never rotates on dry-run');
    assert.ok(text().includes('dry-run'));
  });
});

// ================================================================
// 1Password backup — delegated to backup-env-to-1password.js. Transport
// rules (token/secret never in argv, JSON shape, create vs edit) are
// covered in test/backup-env-to-1password.test.js. Here we only prove the
// wiring: called after a successful .env write, best-effort, never fails
// rotation, password never reaches the log.
// ================================================================

test('default wiring: no token file -> whole-.env backup skipped, rotation still succeeds', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const fs = makeFakeFs({ '/fake/src/.env': 'MQTT_SUBSCRIBER_PASSWORD=old\n' }); // no VIGIL_OP_TOKEN_FILE entry
    const { spawn, calls } = makeFakeSpawn();
    const { log, text } = makeLog();
    const value = await rotate('subscriber', {}, { brokerAdmin, fs, spawn, crypto: fakeCrypto, now: fakeNow, env: BASE_ENV, log });
    assert.equal(value.op.ok, false);
    assert.equal(value.op.action, 'skipped');
    assert.equal(value.op.reason, 'no token file');
    assert.equal(calls.length, 0, 'op must never be spawned when there is no token file');
    assert.ok(!text().includes(FIXED_PASSWORD));
  });
});

test('backupEnv is called only after the .env write, and its success is reflected in the returned op', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const fs = makeFakeFs({ '/fake/src/.env': 'MQTT_SUBSCRIBER_PASSWORD=old\n' });
    const backupCalls = [];
    const backupEnv = async (opts, deps) => {
      // proves ordering: by the time this runs, the new password is already on disk
      backupCalls.push(deps.fs.readFileSync('/fake/src/.env', 'utf8'));
      return { ok: true, action: 'updated', reason: null };
    };
    const { log, text } = makeLog();

    const value = await rotate('subscriber', {}, { brokerAdmin, fs, crypto: fakeCrypto, now: fakeNow, env: BASE_ENV, log, backupEnv });

    assert.equal(backupCalls.length, 1);
    assert.match(backupCalls[0], new RegExp(`MQTT_SUBSCRIBER_PASSWORD=${FIXED_PASSWORD}`));
    assert.equal(value.op.ok, true);
    assert.equal(value.op.action, 'updated');
    assert.match(text(), /1Password updated/);
  });
});

test('backupEnv failure -> warning logged, rotation still resolves, password not in the warning', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const fs = makeFakeFs({ '/fake/src/.env': 'MQTT_SUBSCRIBER_PASSWORD=old\n' });
    const backupEnv = async () => ({ ok: false, action: 'failed', reason: 'op exit 1' });
    const { log, text } = makeLog();

    const value = await rotate('subscriber', {}, { brokerAdmin, fs, crypto: fakeCrypto, now: fakeNow, env: BASE_ENV, log, backupEnv });
    assert.equal(value.op.ok, false);
    assert.ok(text().includes('ไม่ได้ backup'), 'a warning was logged');
    assert.ok(!text().includes(FIXED_PASSWORD));
  });
});

test('backupEnv throws -> caught, treated as a failed backup, does not propagate', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const fs = makeFakeFs({ '/fake/src/.env': 'MQTT_SUBSCRIBER_PASSWORD=old\n' });
    const backupEnv = async () => { throw new Error('boom'); };
    const { log, text } = makeLog();

    const value = await rotate('subscriber', {}, { brokerAdmin, fs, crypto: fakeCrypto, now: fakeNow, env: BASE_ENV, log, backupEnv });
    assert.equal(value.op.ok, false);
    assert.equal(value.op.reason, 'boom');
    assert.equal(value.envUpdated, true, 'rotation itself still succeeded');
    assert.ok(!text().includes(FIXED_PASSWORD));
  });
});

// ================================================================
// stdout — isolated: proves nothing reaches the real stream. Kept as the
// only test in the file that touches the global process.stdout, and last,
// so it cannot disturb any other test's reporting (see file header).
// ================================================================

test('nothing is ever written to the real stdout', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' }, async () => {
    const brokerAdmin = makeFakeBrokerAdmin();
    const fs = makeFakeFs({ '/fake/src/.env': 'MQTT_SUBSCRIBER_PASSWORD=old\n' });
    const spawn = makeFakeSpawn({ available: false }).spawn;
    const chunks = [];
    const orig = process.stdout.write;
    process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
    try {
      await rotate('subscriber', {}, { brokerAdmin, fs, spawn, crypto: fakeCrypto, now: fakeNow, env: BASE_ENV });
    } finally {
      process.stdout.write = orig;
    }
    assert.equal(chunks.length, 0, 'rotate() must never write to stdout');
  });
});
