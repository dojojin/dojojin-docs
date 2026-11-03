// ============================================================
// Vigil Platform — Tests: scripts/backup-env-to-1password.js
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Everything here runs against fakes (fs, spawn, log) — no real .env, no
// real `op` process, no network, no real 1Password account. The fixture
// .env text below uses obviously-fake values, never real secrets.
//
// Proves:
//   - parses the .env text: comments/blank lines skipped, last assignment of
//     a duplicate key wins, quotes stripped only when the whole value is
//     quoted, empty values kept
//   - item JSON: category SECURE_NOTE, tag "vigil", one field per variable
//     under section "env", notesPlain = the raw file text, CONCEALED vs
//     STRING typing per key (SECRET/PASSWORD/TOKEN/_KEY suffix/KEY_ENC)
//   - `op item get` success -> edit branch; failure -> create branch
//   - token reaches the child only via env, item JSON only via stdin, never
//     argv — same for every parsed value
//   - op failing resolves { ok:false } without throwing
//   - no token file -> skipped, op never spawned
//   - nothing ever reaches the real stdout; no value ever appears in the
//     injected log
// ============================================================
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { backupEnvToOnePassword, parseEnvFile, buildItem, CONCEALED_RE } = require('../scripts/backup-env-to-1password');

const FIXTURE_TEXT =
  '# comment line\n' +
  'MQTT_BROKER_URL=mqtt://localhost:1883\n' +
  'DB_PASSWORD="fakepassword123"\n' +
  'API_TOKEN=abc123\n' +
  'LICENSE_KEY_ENC=encblob\n' +
  "SOME_KEY='single-quoted'\n" +
  'EMPTY_VAL=\n' +
  '\n' +
  'DB_PASSWORD=fakepassword456\n' + // duplicate — last wins
  'MIXED_QUOTE="not-fully-closed\n' + // not stripped: not fully quoted
  'BROKER_KIND=mosquitto\n';

const BASE_ENV = {
  VIGIL_ENV_FILE: '/fixture/src/.env',
  VIGIL_OP_TOKEN_FILE: '/fixture/op-token.txt',
  VIGIL_OP_VAULT: 'Vigil Central Test',
};

const SECRET_VALUES = ['fakepassword123', 'fakepassword456', 'abc123', 'encblob', 'single-quoted', 'test-op-token-value'];

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

function makeFakeFs(files = {}) {
  const map = new Map(Object.entries(files));
  return {
    existsSync: (p) => map.has(p),
    readFileSync: (p) => {
      if (!map.has(p)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; }
      return map.get(p);
    },
  };
}

// Same shape as test/rotate-central-mqtt-password.test.js's fake `op` binary.
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

// ================================================================
// parseEnvFile / buildItem — pure parsing
// ================================================================

test('parseEnvFile: skips comments/blank, last duplicate wins, strips only fully-quoted values, keeps empty', () => {
  const vars = parseEnvFile(FIXTURE_TEXT);
  assert.equal(vars.get('DB_PASSWORD'), 'fakepassword456', 'last assignment wins');
  assert.equal(vars.get('SOME_KEY'), 'single-quoted', 'single-quote pair stripped');
  assert.equal(vars.get('MQTT_BROKER_URL'), 'mqtt://localhost:1883');
  assert.equal(vars.get('EMPTY_VAL'), '', 'empty value kept as empty string');
  assert.equal(vars.get('MIXED_QUOTE'), '"not-fully-closed', 'not fully quoted -> left as-is');
  assert.equal(vars.size, 8, 'comment + blank line produce no entries; duplicate key counted once');
});

test('CONCEALED_RE: PASSWORD/TOKEN/_KEY suffix/KEY_ENC concealed, plain URL/KIND vars stay STRING', () => {
  assert.ok(CONCEALED_RE.test('DB_PASSWORD'));
  assert.ok(CONCEALED_RE.test('API_TOKEN'));
  assert.ok(CONCEALED_RE.test('LICENSE_KEY_ENC'));
  assert.ok(CONCEALED_RE.test('SOME_KEY'));
  assert.ok(!CONCEALED_RE.test('MQTT_BROKER_URL'));
  assert.ok(!CONCEALED_RE.test('BROKER_KIND'));
});

test('buildItem: SECURE_NOTE, tag vigil, section "env", notesPlain = raw file text, field typing per key', () => {
  const { item, fieldCount, concealedCount } = buildItem({ text: FIXTURE_TEXT, title: 'T', vault: 'V' });
  assert.equal(item.category, 'SECURE_NOTE');
  assert.deepEqual(item.tags, ['vigil']);
  assert.deepEqual(item.vault, { name: 'V' });
  assert.equal(item.title, 'T');
  assert.deepEqual(item.sections, [{ id: 'env', label: 'env' }]);
  assert.equal(fieldCount, 8);
  assert.equal(concealedCount, 4, 'DB_PASSWORD, API_TOKEN, LICENSE_KEY_ENC, SOME_KEY');

  const notes = item.fields.find((f) => f.id === 'notesPlain');
  assert.equal(notes.value, FIXTURE_TEXT, 'notesPlain is the full raw .env text');
  assert.equal(notes.purpose, 'NOTES');

  const dbPw = item.fields.find((f) => f.id === 'DB_PASSWORD');
  assert.equal(dbPw.type, 'CONCEALED');
  assert.equal(dbPw.value, 'fakepassword456');
  assert.deepEqual(dbPw.section, { id: 'env' });

  const brokerUrl = item.fields.find((f) => f.id === 'MQTT_BROKER_URL');
  assert.equal(brokerUrl.type, 'STRING');

  const empty = item.fields.find((f) => f.id === 'EMPTY_VAL');
  assert.equal(empty.type, 'STRING');
  assert.equal(empty.value, '', 'empty value kept as empty STRING');

  assert.equal(item.fields.length, fieldCount + 1, 'one field per var, plus notesPlain');
});

// ================================================================
// backupEnvToOnePassword — transport + control flow
// ================================================================

test('no token file -> skipped, op never spawned, rotation-style callers see ok:false', async () => {
  await withEnv(BASE_ENV, async () => {
    const fs = makeFakeFs({ '/fixture/src/.env': FIXTURE_TEXT }); // no token file entry
    const { spawn, calls } = makeFakeSpawn();
    const { log, text } = makeLog();
    const result = await backupEnvToOnePassword({}, { fs, spawn, env: BASE_ENV, log });
    assert.deepEqual(result, { ok: false, action: 'skipped', reason: 'no token file' });
    assert.equal(calls.length, 0);
    for (const v of SECRET_VALUES) assert.ok(!text().includes(v));
  });
});

test('op not on PATH -> skipped without throwing', async () => {
  await withEnv(BASE_ENV, async () => {
    const fs = makeFakeFs({ '/fixture/src/.env': FIXTURE_TEXT, '/fixture/op-token.txt': 'test-op-token-value\n' });
    const { spawn } = makeFakeSpawn({ available: false });
    const { log } = makeLog();
    const result = await backupEnvToOnePassword({}, { fs, spawn, env: BASE_ENV, log });
    assert.deepEqual(result, { ok: false, action: 'skipped', reason: 'op not on PATH' });
  });
});

test('item does not exist -> create branch; token only via child env, every value only via stdin, never argv', async () => {
  await withEnv(BASE_ENV, async () => {
    const fs = makeFakeFs({ '/fixture/src/.env': FIXTURE_TEXT, '/fixture/op-token.txt': 'test-op-token-value\n' });
    const { spawn, calls } = makeFakeSpawn({
      available: true,
      script: (call) => (call.args[0] === 'item' && call.args[1] === 'get' ? { code: 1, stderr: 'not found' } : { code: 0 }),
    });
    const { log, text } = makeLog();

    const result = await backupEnvToOnePassword({}, { fs, spawn, env: BASE_ENV, log });
    assert.equal(result.ok, true);
    assert.equal(result.action, 'created');

    const argvBlob = JSON.stringify(calls.map((c) => c.args));
    assert.ok(!argvBlob.includes('test-op-token-value'), 'token must never be in argv');
    for (const v of SECRET_VALUES) assert.ok(!argvBlob.includes(v), `value "${v}" must never be in argv`);

    const createCall = calls.find((c) => c.args[0] === 'item' && c.args[1] === 'create');
    assert.ok(createCall, 'op item create was invoked');
    assert.equal(createCall.env.OP_SERVICE_ACCOUNT_TOKEN, 'test-op-token-value', 'token passed only via child env');

    const item = JSON.parse(createCall.stdin);
    assert.equal(item.category, 'SECURE_NOTE');
    assert.equal(item.fields.find((f) => f.id === 'DB_PASSWORD').value, 'fakepassword456', 'value passed only via stdin');

    for (const v of SECRET_VALUES) assert.ok(!text().includes(v));
  });
});

test('item already exists -> edit branch, not create', async () => {
  await withEnv(BASE_ENV, async () => {
    const fs = makeFakeFs({ '/fixture/src/.env': FIXTURE_TEXT, '/fixture/op-token.txt': 'test-op-token-value\n' });
    const { spawn, calls } = makeFakeSpawn({ available: true, script: () => ({ code: 0, stdout: '{}' }) });
    const { log } = makeLog();

    const result = await backupEnvToOnePassword({}, { fs, spawn, env: BASE_ENV, log });
    assert.equal(result.ok, true);
    assert.equal(result.action, 'updated');
    assert.ok(calls.some((c) => c.args[0] === 'item' && c.args[1] === 'edit'));
    assert.ok(!calls.some((c) => c.args[0] === 'item' && c.args[1] === 'create'));
  });
});

test('op failure (non-zero exit) -> resolves ok:false without throwing, reason has no stderr text', async () => {
  await withEnv(BASE_ENV, async () => {
    const fs = makeFakeFs({ '/fixture/src/.env': FIXTURE_TEXT, '/fixture/op-token.txt': 'test-op-token-value\n' });
    const { spawn } = makeFakeSpawn({
      available: true,
      script: (call) => (call.args[0] === '--version' ? { code: 0 } : { code: 1, stderr: 'permission denied: fakepassword456' }),
    });
    const { log, text } = makeLog();

    const result = await backupEnvToOnePassword({}, { fs, spawn, env: BASE_ENV, log });
    assert.equal(result.ok, false);
    assert.equal(result.action, 'failed');
    assert.match(result.reason, /^op exit \d+$/);
    assert.ok(!result.reason.includes('fakepassword456'));
    assert.ok(!text().includes('fakepassword456'), 'op stderr must never be surfaced verbatim');
  });
});

test('env file unreadable -> skipped without throwing', async () => {
  await withEnv(BASE_ENV, async () => {
    const fs = makeFakeFs({}); // no .env entry at all
    const { log } = makeLog();
    const result = await backupEnvToOnePassword({}, { fs, env: BASE_ENV, log });
    assert.equal(result.ok, false);
    assert.equal(result.action, 'skipped');
  });
});

test('--dry-run: reports counts, checks token file + op availability, changes nothing (op never spawned to write)', async () => {
  await withEnv(BASE_ENV, async () => {
    const fs = makeFakeFs({ '/fixture/src/.env': FIXTURE_TEXT, '/fixture/op-token.txt': 'test-op-token-value\n' });
    const { spawn, calls } = makeFakeSpawn({ available: true });
    const { log, text } = makeLog();

    const result = await backupEnvToOnePassword({ dryRun: true }, { fs, spawn, env: BASE_ENV, log });
    assert.deepEqual(result, { ok: true, action: 'dry-run', reason: null });
    assert.ok(!calls.some((c) => c.args[0] === 'item'), 'dry-run never writes an item');
    assert.match(text(), /fields=8/);
    assert.match(text(), /concealed 4/);
  });
});

test('default title/vault, overridable via VIGIL_OP_ITEM_TITLE / VIGIL_OP_VAULT', async () => {
  await withEnv(BASE_ENV, async () => {
    const fs = makeFakeFs({ '/fixture/src/.env': FIXTURE_TEXT, '/fixture/op-token.txt': 'test-op-token-value\n' });
    const { spawn, calls } = makeFakeSpawn({
      available: true,
      script: (call) => (call.args[0] === 'item' && call.args[1] === 'get' ? { code: 1 } : { code: 0 }), // get fails -> create
    });
    const { log } = makeLog();

    await backupEnvToOnePassword({}, { fs, spawn, env: BASE_ENV, log });
    const createCall = calls.find((c) => c.args[0] === 'item' && c.args[1] === 'create');
    const item = JSON.parse(createCall.stdin);
    assert.equal(item.title, 'Vigil · CENTRAL — src/.env (live)');
    assert.deepEqual(item.vault, { name: 'Vigil Central Test' });
  });
});

test('nothing is ever written to the real stdout', async () => {
  await withEnv(BASE_ENV, async () => {
    const fs = makeFakeFs({ '/fixture/src/.env': FIXTURE_TEXT }); // no token file -> skips fast
    const chunks = [];
    const orig = process.stdout.write;
    process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
    try {
      await backupEnvToOnePassword({}, { fs, env: BASE_ENV });
    } finally {
      process.stdout.write = orig;
    }
    assert.equal(chunks.length, 0, 'backupEnvToOnePassword() must never write to stdout');
  });
});
