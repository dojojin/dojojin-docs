// ============================================================
// Vigil Platform — Tests: scripts/edge-sync-broker-auth.js
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// E2 (docs/reports/2026-09-27_mosquitto-migration-plan.md §11). Runs the
// real CLI as a subprocess against a scratch $HOME and a scratch
// cameras-config.json (EDGE_CAMERAS_CONFIG_PATH override — see the script's
// own comment on why that override exists). Uses the real `mosquitto_passwd`
// binary when present — safe here because it only ever touches files under
// the scratch HOME this test created, never a real broker's files. All
// credentials below are made up for this test only.
// ============================================================
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'edge-sync-broker-auth.js');

const hasMosquittoPasswd = (() => {
  try { execFileSync('mosquitto_passwd', [], { stdio: 'ignore' }); return true; }
  catch (e) { return e.status !== undefined; } // ran and exited non-zero (no args) = binary exists
})();

describe('scripts/edge-sync-broker-auth.js', { skip: hasMosquittoPasswd ? false : 'mosquitto_passwd not installed on this machine' }, () => {
  let home, cfgDir, camerasConfigPath;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-sync-home-'));
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-sync-cfg-'));
    camerasConfigPath = path.join(cfgDir, 'cameras-config.json');
    fs.writeFileSync(camerasConfigPath, JSON.stringify({
      cameras: [
        { camera_id: 'BOSCH_TEST', vendor: 'bosch', mqtt_username: 'cam-test', mqtt_password: 'cam-fake-pw' },
        { camera_id: 'DAHUA_TEST', vendor: 'dahua', mqtt_username: 'x', mqtt_password: 'y' },
      ],
    }));
  });
  afterEach(() => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(cfgDir, { recursive: true, force: true }); } catch {}
  });

  // All four local-account keys pinned every time (empty string, not omitted)
  // so dotenv (loaded by src/config.js inside the script) can never fill an
  // unset one from the real src/.env on this machine — dotenv only sets a
  // key that is NOT already present in the child's env, and an explicit ''
  // counts as present.
  const baseEnv = () => ({
    PATH: process.env.PATH, HOME: home, EDGE_CAMERAS_CONFIG_PATH: camerasConfigPath,
    MQTT_SUBSCRIBER_USER: '', MQTT_SUBSCRIBER_PASSWORD: '',
    SNAPSHOT_PUBLISHER_USER: '', SNAPSHOT_PUBLISHER_PASSWORD: '',
  });

  it('writes local + camera accounts under $HOME/.config/vigil, prints counts only (no secrets), exits 0', () => {
    const env = {
      ...baseEnv(),
      MQTT_SUBSCRIBER_USER: 'dashboard-subscriber-test',
      MQTT_SUBSCRIBER_PASSWORD: 'sub-fake-pw',
      SNAPSHOT_PUBLISHER_USER: 'snapshot-publisher-test',
      SNAPSHOT_PUBLISHER_PASSWORD: 'snap-fake-pw',
    };
    const out = execFileSync('node', [SCRIPT], { env, encoding: 'utf8' });
    assert.match(out, /users=3/); // 2 local + BOSCH_TEST (DAHUA_TEST excluded — non-Bosch)
    assert.doesNotMatch(out, /sub-fake-pw|snap-fake-pw|cam-fake-pw/);

    const authDir = path.join(home, '.config', 'vigil');
    const passwd = fs.readFileSync(path.join(authDir, 'mosquitto.passwd'), 'utf8');
    const acl = fs.readFileSync(path.join(authDir, 'mosquitto.acl'), 'utf8');

    assert.match(passwd, /^dashboard-subscriber-test:\$7\$/m);
    assert.match(passwd, /^snapshot-publisher-test:\$7\$/m);
    assert.match(passwd, /^cam-test:\$7\$/m);
    assert.ok(!passwd.includes('sub-fake-pw') && !passwd.includes('snap-fake-pw') && !passwd.includes('cam-fake-pw'),
      'passwd must hold hashes only, never the plaintext fixtures');

    assert.match(acl, /^topic readwrite #$/m);
    assert.match(acl, /user dashboard-subscriber-test\ntopic readwrite #/);
    assert.match(acl, /user snapshot-publisher-test\ntopic readwrite #/);
    assert.match(acl, /user cam-test\ntopic write BOSCH_TEST\/#/);
    assert.ok(!acl.includes('DAHUA_TEST'));

    assert.equal(fs.statSync(path.join(authDir, 'mosquitto.passwd')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(authDir, 'mosquitto.acl')).mode & 0o777, 0o600);
  });

  it('a missing cameras-config.json still writes the local accounts and exits 0 (fresh-edge case)', () => {
    const env = {
      ...baseEnv(),
      EDGE_CAMERAS_CONFIG_PATH: path.join(home, 'does-not-exist.json'),
      MQTT_SUBSCRIBER_USER: 'dashboard-subscriber-test',
      MQTT_SUBSCRIBER_PASSWORD: 'sub-fake-pw',
    };
    const out = execFileSync('node', [SCRIPT], { env, encoding: 'utf8' });
    assert.match(out, /users=1/);
    const passwd = fs.readFileSync(path.join(home, '.config', 'vigil', 'mosquitto.passwd'), 'utf8');
    assert.match(passwd, /^dashboard-subscriber-test:\$7\$/m);
  });

  it('a camera whose mqtt_username clashes with a local account is skipped and reported (no secrets)', () => {
    fs.writeFileSync(camerasConfigPath, JSON.stringify({
      cameras: [{ camera_id: 'BOSCH_CLASH', vendor: 'bosch', mqtt_username: 'dashboard-subscriber-test', mqtt_password: 'cam-fake-pw' }],
    }));
    const env = {
      ...baseEnv(),
      MQTT_SUBSCRIBER_USER: 'dashboard-subscriber-test',
      MQTT_SUBSCRIBER_PASSWORD: 'sub-fake-pw',
    };
    const out = execFileSync('node', [SCRIPT], { env, encoding: 'utf8' });
    assert.match(out, /BOSCH_CLASH: username clashes with local service account/);
    assert.doesNotMatch(out, /sub-fake-pw|cam-fake-pw/);
  });

  it('runs twice with no env change and exits 0 both times (idempotent, --reload-free)', () => {
    const env = { ...baseEnv(), MQTT_SUBSCRIBER_USER: 'dashboard-subscriber-test', MQTT_SUBSCRIBER_PASSWORD: 'sub-fake-pw' };
    execFileSync('node', [SCRIPT], { env, encoding: 'utf8' });
    const out2 = execFileSync('node', [SCRIPT], { env, encoding: 'utf8' });
    assert.match(out2, /changed=false/);
  });
});
