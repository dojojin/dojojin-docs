// ============================================================
// Vigil Platform — Tests: src/helpers/mosquittoAuthFiles.js
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// E2 (docs/reports/2026-09-27_mosquitto-migration-plan.md §11). No real
// `mosquitto_passwd` invocation here — `execFile` is always the fake below,
// which stands in for `mosquitto_passwd -U` closely enough to exercise the
// atomic-write/skip/dedup/change-detection logic without a binary dependency
// or ever putting a real password on disk.
// ============================================================
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildAcl, writeAuthFiles, localBrokerUsersFromEnv, incompleteLocalUserKeys } = require('../src/helpers/mosquittoAuthFiles');

const FAKE_PW = 'sup3r-fake-not-real';

function cam(camera_id, { vendor = 'bosch', mqtt_username, mqtt_password } = {}) {
  return { camera_id, vendor, mqtt_username, mqtt_password };
}

// Stands in for `mosquitto_passwd -U <file>`: rewrites each `user:pass` line
// to `user:$7$fake$<junk>`, in place — same shape as the real tool.
function fakeExecFile(callLog) {
  return (bin, args, cb) => {
    callLog.push({ bin, args });
    try {
      const file = args[1];
      const raw = fs.readFileSync(file, 'utf8');
      const hashed = raw.split('\n').filter(Boolean)
        .map((l) => l.slice(0, l.indexOf(':')) + ':$7$fake$deadbeef')
        .join('\n') + (raw ? '\n' : '');
      fs.writeFileSync(file, hashed);
      cb(null, '', '');
    } catch (e) { cb(e); }
  };
}
function failingExecFile(callLog) {
  return (bin, args, cb) => { callLog.push({ bin, args }); cb(new Error('mosquitto_passwd: boom')); };
}

describe('mosquittoAuthFiles.buildAcl', () => {
  it('anonymous line comes first, before any user block', () => {
    const acl = buildAcl([cam('BOSCH_A', { mqtt_username: 'u-a', mqtt_password: 'p-a' })]);
    const lines = acl.split('\n').filter((l) => l && !l.startsWith('#'));
    assert.equal(lines[0], 'topic readwrite #');
  });

  it('one user/topic pair per Bosch camera, sorted by camera_id', () => {
    const acl = buildAcl([
      cam('BOSCH_Z', { mqtt_username: 'u-z', mqtt_password: 'p-z' }),
      cam('BOSCH_A', { mqtt_username: 'u-a', mqtt_password: 'p-a' }),
    ]);
    const idxA = acl.indexOf('user u-a');
    const idxZ = acl.indexOf('user u-z');
    assert.ok(idxA > 0 && idxZ > 0 && idxA < idxZ, 'BOSCH_A must sort before BOSCH_Z');
    assert.match(acl, /user u-a\ntopic write BOSCH_A\/#/);
    assert.match(acl, /user u-z\ntopic write BOSCH_Z\/#/);
  });

  it('excludes non-Bosch vendors even with credentials present', () => {
    const acl = buildAcl([cam('DAHUA_1', { vendor: 'dahua', mqtt_username: 'u', mqtt_password: 'p' })]);
    assert.ok(!acl.includes('user u'));
  });

  it('skips a camera missing mqtt_username or mqtt_password', () => {
    const acl = buildAcl([cam('BOSCH_NOAUTH')]);
    assert.ok(!acl.includes('user '));
    assert.ok(!acl.includes('BOSCH_NOAUTH'));
  });

  it('skips an mqtt_password still in enc:v1: form (decrypt failed upstream)', () => {
    const acl = buildAcl([cam('BOSCH_ENC', { mqtt_username: 'u', mqtt_password: 'enc:v1:abcd==' })]);
    assert.ok(!acl.includes('user u'));
  });

  it('skips a username or camera_id that is unsafe for an ACL line (+, #, :, whitespace)', () => {
    const acl = buildAcl([
      cam('BOSCH#BAD', { mqtt_username: 'u1', mqtt_password: 'p' }),
      cam('BOSCH_OK', { mqtt_username: 'u:2', mqtt_password: 'p' }),
    ]);
    assert.ok(!acl.includes('BOSCH#BAD'));
    assert.ok(!acl.includes('u:2'));
  });

  it('drops a second camera reusing a username already claimed', () => {
    const acl = buildAcl([
      cam('BOSCH_A', { mqtt_username: 'shared', mqtt_password: 'p-a' }),
      cam('BOSCH_B', { mqtt_username: 'shared', mqtt_password: 'p-b' }),
    ]);
    assert.equal((acl.match(/user shared/g) || []).length, 1);
    assert.match(acl, /BOSCH_A\/#/);
    assert.ok(!acl.includes('BOSCH_B/#'));
  });

  it('local service accounts get topic readwrite #, placed after the anonymous line and before cameras', () => {
    const acl = buildAcl(
      [cam('BOSCH_A', { mqtt_username: 'cam-user', mqtt_password: 'p-a' })],
      [{ username: 'dashboard-subscriber', password: 'x' }],
    );
    const idxAnon = acl.indexOf('topic readwrite #');
    const idxLocal = acl.indexOf('user dashboard-subscriber');
    const idxCam = acl.indexOf('user cam-user');
    assert.ok(idxAnon >= 0 && idxLocal > idxAnon && idxCam > idxLocal);
    assert.match(acl, /user dashboard-subscriber\ntopic readwrite #/);
    assert.match(acl, /user cam-user\ntopic write BOSCH_A\/#/);
  });

  it('skips a camera whose mqtt_username clashes with a local service account', () => {
    const acl = buildAcl(
      [cam('BOSCH_A', { mqtt_username: 'dashboard-subscriber', mqtt_password: 'p-a' })],
      [{ username: 'dashboard-subscriber', password: 'x' }],
    );
    assert.ok(!acl.includes('BOSCH_A/#'));
    assert.equal((acl.match(/user dashboard-subscriber/g) || []).length, 1, 'local account keeps the username, camera loses it');
  });
});

describe('mosquittoAuthFiles.incompleteLocalUserKeys', () => {
  it('flags a USER key set without its PASSWORD (vss3 2026-09-28)', () => {
    assert.deepStrictEqual(incompleteLocalUserKeys({ MQTT_SUBSCRIBER_USER: 'svc' }), ['MQTT_SUBSCRIBER_USER']);
  });
  it('ignores complete pairs, blank users and missing pairs', () => {
    assert.deepStrictEqual(incompleteLocalUserKeys({
      MQTT_SUBSCRIBER_USER: 'svc', MQTT_SUBSCRIBER_PASSWORD: 'fake',
      SNAPSHOT_PUBLISHER_USER: '',
    }), []);
    assert.deepStrictEqual(incompleteLocalUserKeys({}), []);
  });
});

describe('mosquittoAuthFiles.localBrokerUsersFromEnv', () => {
  it('returns a pair only when both username and password are set', () => {
    const out = localBrokerUsersFromEnv({
      MQTT_SUBSCRIBER_USER: 'dashboard-subscriber', MQTT_SUBSCRIBER_PASSWORD: 'pw1',
      SNAPSHOT_PUBLISHER_USER: 'snapshot-publisher', SNAPSHOT_PUBLISHER_PASSWORD: 'pw2',
    });
    assert.deepEqual(out, [
      { username: 'dashboard-subscriber', password: 'pw1' },
      { username: 'snapshot-publisher', password: 'pw2' },
    ]);
  });

  it('drops a pair that is only half set', () => {
    const out = localBrokerUsersFromEnv({ MQTT_SUBSCRIBER_USER: 'dashboard-subscriber' });
    assert.deepEqual(out, []);
  });

  it('an empty/undefined env yields no local users', () => {
    assert.deepEqual(localBrokerUsersFromEnv({}), []);
    assert.deepEqual(localBrokerUsersFromEnv(undefined), []);
  });

  it('dedupes when both pairs happen to share a username', () => {
    const out = localBrokerUsersFromEnv({
      MQTT_SUBSCRIBER_USER: 'shared', MQTT_SUBSCRIBER_PASSWORD: 'pw1',
      SNAPSHOT_PUBLISHER_USER: 'shared', SNAPSHOT_PUBLISHER_PASSWORD: 'pw2',
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].username, 'shared');
  });
});

describe('mosquittoAuthFiles.writeAuthFiles', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqauth-')); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  const mode600 = (p) => (fs.statSync(p).mode & 0o777) === 0o600;

  it('writes passwd + acl + sha, all 0600, and reports users/skipped', async () => {
    const cameras = [
      cam('BOSCH_A', { mqtt_username: 'u-a', mqtt_password: FAKE_PW }),
      cam('BOSCH_ENC', { mqtt_username: 'u-enc', mqtt_password: 'enc:v1:xx==' }),
    ];
    const log = [];
    const r = await writeAuthFiles({ cameras, dir, execFile: fakeExecFile(log) });
    assert.equal(r.changed, true);
    assert.deepEqual(r.users, ['u-a']);
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].camera_id, 'BOSCH_ENC');
    assert.match(r.skipped[0].reason, /not decrypted/);

    const passwdPath = path.join(dir, 'mosquitto.passwd');
    const aclPath = path.join(dir, 'mosquitto.acl');
    const shaPath = path.join(dir, '.mosquitto-auth.sha256');
    assert.ok(mode600(passwdPath));
    assert.ok(mode600(aclPath));
    assert.ok(mode600(shaPath));
    assert.match(fs.readFileSync(passwdPath, 'utf8'), /^u-a:\$7\$fake\$deadbeef$/m);
  });

  it('leaves no leftover temp dir/files behind', async () => {
    const cameras = [cam('BOSCH_A', { mqtt_username: 'u-a', mqtt_password: FAKE_PW })];
    await writeAuthFiles({ cameras, dir, execFile: fakeExecFile([]) });
    const leftover = fs.readdirSync(dir).filter((n) => n.startsWith('.auth-'));
    assert.deepEqual(leftover, []);
  });

  it('removes the plaintext temp file even when execFile (mosquitto_passwd) fails', async () => {
    const cameras = [cam('BOSCH_A', { mqtt_username: 'u-a', mqtt_password: FAKE_PW })];
    await assert.rejects(() => writeAuthFiles({ cameras, dir, execFile: failingExecFile([]) }));
    const leftover = fs.readdirSync(dir).filter((n) => n.startsWith('.auth-'));
    assert.deepEqual(leftover, [], 'the mkdtemp scratch dir must be removed on failure too');
    assert.ok(!fs.existsSync(path.join(dir, 'mosquitto.passwd')), 'must not publish a half-written passwd file');
  });

  it('changed is false on an identical second call, and mosquitto_passwd is not re-run', async () => {
    const cameras = [cam('BOSCH_A', { mqtt_username: 'u-a', mqtt_password: FAKE_PW })];
    const log = [];
    const r1 = await writeAuthFiles({ cameras, dir, execFile: fakeExecFile(log) });
    const r2 = await writeAuthFiles({ cameras, dir, execFile: fakeExecFile(log) });
    assert.equal(r1.changed, true);
    assert.equal(r2.changed, false);
    assert.equal(log.length, 1, 'mosquitto_passwd should only run on the first (changing) call');
  });

  it('changed is true again after a password changes', async () => {
    const log = [];
    await writeAuthFiles({
      cameras: [cam('BOSCH_A', { mqtt_username: 'u-a', mqtt_password: FAKE_PW })],
      dir, execFile: fakeExecFile(log),
    });
    const r2 = await writeAuthFiles({
      cameras: [cam('BOSCH_A', { mqtt_username: 'u-a', mqtt_password: FAKE_PW + '-rotated' })],
      dir, execFile: fakeExecFile(log),
    });
    assert.equal(r2.changed, true);
    assert.equal(log.length, 2);
  });

  it('never leaves the plaintext password anywhere in dir, including the sha file', async () => {
    const cameras = [cam('BOSCH_A', { mqtt_username: 'u-a', mqtt_password: FAKE_PW })];
    await writeAuthFiles({ cameras, dir, execFile: fakeExecFile([]) });
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) continue;
      assert.ok(!fs.readFileSync(p, 'utf8').includes(FAKE_PW), `${name} must not contain the plaintext password`);
    }
  });

  it('writes local service accounts into both passwd and acl, alongside cameras', async () => {
    const cameras = [cam('BOSCH_A', { mqtt_username: 'cam-user', mqtt_password: FAKE_PW })];
    const localUsers = [{ username: 'dashboard-subscriber', password: 'local-fake-pw' }];
    const log = [];
    const r = await writeAuthFiles({ cameras, localUsers, dir, execFile: fakeExecFile(log) });
    assert.deepEqual(r.users, ['dashboard-subscriber', 'cam-user']);
    const passwd = fs.readFileSync(path.join(dir, 'mosquitto.passwd'), 'utf8');
    assert.match(passwd, /^dashboard-subscriber:\$7\$fake\$deadbeef$/m);
    assert.match(passwd, /^cam-user:\$7\$fake\$deadbeef$/m);
    const acl = fs.readFileSync(path.join(dir, 'mosquitto.acl'), 'utf8');
    assert.match(acl, /user dashboard-subscriber\ntopic readwrite #/);
  });

  it('changed is true again after only a local user password rotates (cameras unchanged)', async () => {
    const cameras = [cam('BOSCH_A', { mqtt_username: 'cam-user', mqtt_password: FAKE_PW })];
    const log = [];
    await writeAuthFiles({
      cameras, dir, execFile: fakeExecFile(log),
      localUsers: [{ username: 'dashboard-subscriber', password: 'pw-v1' }],
    });
    const r2 = await writeAuthFiles({
      cameras, dir, execFile: fakeExecFile(log),
      localUsers: [{ username: 'dashboard-subscriber', password: 'pw-v2' }],
    });
    assert.equal(r2.changed, true);
    assert.equal(log.length, 2);
  });

  it('never leaves a local service account password in plaintext anywhere', async () => {
    const cameras = [cam('BOSCH_A', { mqtt_username: 'cam-user', mqtt_password: FAKE_PW })];
    const localUsers = [{ username: 'dashboard-subscriber', password: 'local-fake-pw' }];
    await writeAuthFiles({ cameras, localUsers, dir, execFile: fakeExecFile([]) });
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) continue;
      assert.ok(!fs.readFileSync(p, 'utf8').includes('local-fake-pw'), `${name} must not contain the local account's plaintext password`);
    }
  });

  it('an empty camera list writes an empty passwd file without calling execFile', async () => {
    const log = [];
    const r = await writeAuthFiles({ cameras: [], dir, execFile: fakeExecFile(log) });
    assert.equal(r.changed, true);
    assert.deepEqual(r.users, []);
    assert.equal(log.length, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'mosquitto.passwd'), 'utf8'), '');
    const acl = fs.readFileSync(path.join(dir, 'mosquitto.acl'), 'utf8');
    assert.match(acl, /^topic readwrite #$/m);
    assert.ok(!acl.includes('user '));
  });
});
