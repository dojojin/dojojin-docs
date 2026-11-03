// ============================================================
// Vigil Platform — Tests: ecosystem.edge.config.js broker selection
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// E1a (docs/reports/2026-09-27_mosquitto-migration-plan.md §9). Proves the
// edge ecosystem file includes exactly one broker pm2 app per EDGE_BROKER
// value, and never both (both want port 1883). Spawned as a real child
// process — not required in-process — because the file reads process.env
// at require() time and Node caches modules, so an in-process require
// could only ever see the first value tried.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const ECOSYSTEM_PATH = path.join(__dirname, '..', 'ecosystem.edge.config.js');

function appNamesWith(edgeBroker) {
  const env = { ...process.env };
  if (edgeBroker === undefined) delete env.EDGE_BROKER;
  else env.EDGE_BROKER = edgeBroker;
  const out = spawnSync(process.execPath, ['-e',
    `console.log(JSON.stringify(require(${JSON.stringify(ECOSYSTEM_PATH)}).apps.map(a => a.name)))`,
  ], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout.trim());
}

describe('ecosystem.edge.config.js — EDGE_BROKER selects one broker app', () => {
  test('EDGE_BROKER unset defaults to nanomq only', () => {
    const names = appNamesWith(undefined);
    assert.ok(names.includes('nanomq'));
    assert.ok(!names.includes('mosquitto'));
  });

  test('EDGE_BROKER=nanomq → nanomq only', () => {
    const names = appNamesWith('nanomq');
    assert.ok(names.includes('nanomq'));
    assert.ok(!names.includes('mosquitto'));
  });

  test('EDGE_BROKER=mosquitto → mosquitto only, never both', () => {
    const names = appNamesWith('mosquitto');
    assert.ok(names.includes('mosquitto'));
    assert.ok(!names.includes('nanomq'));
  });

  test('unknown EDGE_BROKER value falls back to nanomq (fail toward the known-good default)', () => {
    const names = appNamesWith('something-typoed');
    assert.ok(names.includes('nanomq'));
    assert.ok(!names.includes('mosquitto'));
  });

  test('every non-broker app is present regardless of EDGE_BROKER', () => {
    const names = appNamesWith('mosquitto');
    for (const n of ['hikvision', 'dahua', 'lpr-receiver', 'hcp-face-matches',
                      'edge-config-agent', 'edge-bridge', 'cloudflared']) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
    assert.equal(names.length, 8); // 1 broker + 7 others
  });
});
