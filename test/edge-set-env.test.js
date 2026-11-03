// ============================================================
// Vigil Platform — Tests: scripts/edge-set-env.js
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// E1a (docs/reports/2026-09-27_mosquitto-migration-plan.md §9). Proves the
// script: adds/replaces lines in a target .env, refuses PASSWORD/SECRET/
// TOKEN/*KEY-shaped keys, never prints an existing value, backs up before
// writing, and leaves the file at mode 600. Runs against a throwaway temp
// file via VIGIL_ENV_FILE — never touches src/.env.
// ============================================================
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'edge-set-env.js');
const { parseArgs, SECRET_KEY_RE } = require(SCRIPT_PATH);

let tmpDir, envFile;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigil-edge-set-env-'));
  envFile = path.join(tmpDir, '.env');
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    env: { ...process.env, VIGIL_ENV_FILE: envFile, ...extraEnv },
    encoding: 'utf8',
  });
}

describe('parseArgs — secret-key rejection', () => {
  const cases = ['MQTT_PASSWORD', 'BRIDGE_PASSWORD', 'SOME_SECRET', 'API_TOKEN', 'CAMERA_SECRET_KEY', 'ENCRYPTION_KEY'];
  for (const k of cases) {
    test(`rejects ${k}`, () => {
      assert.throws(() => parseArgs([`${k}=x`]), /ปฏิเสธ/);
    });
  }

  const allowed = ['EDGE_BROKER', 'EDGE_CAMERA_BROKER_URL', 'EDGE_SITE_ID'];
  for (const k of allowed) {
    test(`allows ${k} (not secret-shaped)`, () => {
      assert.doesNotThrow(() => parseArgs([`${k}=x`]));
      assert.equal(SECRET_KEY_RE.test(k), false);
    });
  }
});

describe('edge-set-env.js CLI', () => {
  test('creates the file with the given key when none exists', () => {
    const r = run(['EDGE_BROKER=mosquitto']);
    assert.equal(r.status, 0, r.stderr);
    const content = fs.readFileSync(envFile, 'utf8');
    assert.match(content, /^EDGE_BROKER=mosquitto$/m);
  });

  test('replaces an existing line rather than duplicating it', () => {
    fs.writeFileSync(envFile, 'EDGE_BROKER=nanomq\nOTHER=1\n');
    const r = run(['EDGE_BROKER=mosquitto']);
    assert.equal(r.status, 0, r.stderr);
    const content = fs.readFileSync(envFile, 'utf8');
    assert.match(content, /^EDGE_BROKER=mosquitto$/m);
    assert.match(content, /^OTHER=1$/m);
    assert.equal((content.match(/^EDGE_BROKER=/gm) || []).length, 1);
  });

  test('adds a brand-new key alongside existing ones untouched', () => {
    fs.writeFileSync(envFile, 'OTHER=1\n');
    const r = run(['EDGE_CAMERA_BROKER_URL=mqtt://172.29.51.52:1883']);
    assert.equal(r.status, 0, r.stderr);
    const content = fs.readFileSync(envFile, 'utf8');
    assert.match(content, /^OTHER=1$/m);
    assert.match(content, /^EDGE_CAMERA_BROKER_URL=mqtt:\/\/172\.29\.51\.52:1883$/m);
  });

  test('backs up the previous content before writing', () => {
    fs.writeFileSync(envFile, 'EDGE_BROKER=nanomq\n');
    const r = run(['EDGE_BROKER=mosquitto']);
    assert.equal(r.status, 0, r.stderr);
    const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith('.env.bak-edge-'));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(tmpDir, backups[0]), 'utf8'), 'EDGE_BROKER=nanomq\n');
  });

  test('leaves the file at mode 600 even when it already existed with looser permissions', () => {
    fs.writeFileSync(envFile, 'EDGE_BROKER=nanomq\n', { mode: 0o644 });
    const r = run(['EDGE_BROKER=mosquitto']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  });

  test('refuses a secret-looking key and writes nothing', () => {
    fs.writeFileSync(envFile, 'EDGE_BROKER=nanomq\n');
    const r = run(['MQTT_PASSWORD=hunter2']);
    assert.notEqual(r.status, 0);
    assert.equal(fs.readFileSync(envFile, 'utf8'), 'EDGE_BROKER=nanomq\n');
  });

  test('never prints the value of an existing line, even one being replaced', () => {
    fs.writeFileSync(envFile, 'EDGE_CAMERA_BROKER_URL=mqtt://old-secret-looking-value:1883\n');
    const r = run(['EDGE_CAMERA_BROKER_URL=mqtt://172.29.51.52:1883']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('old-secret-looking-value'));
    assert.ok(!r.stderr.includes('old-secret-looking-value'));
  });

  test('rejects malformed KEY=VALUE arguments', () => {
    const r = run(['not-an-assignment']);
    assert.notEqual(r.status, 0);
  });
});
