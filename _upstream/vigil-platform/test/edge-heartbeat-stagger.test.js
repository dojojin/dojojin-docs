// ============================================================
// Vigil Platform — Tests: edge heartbeat is spread over the minute
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// 2026-10-17: every camera's Device/heartbeat went out in the same instant (~50 in
// ~90 ms at hdy). edge-bridge forwarded the burst to central and the broker cut the
// link with "Protocol error" at that second, again and again (hdy :19, hkt :12).
// Each camera now has a fixed slot in the minute derived from its id.
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'edge-config-agent.js'), 'utf8');
const HEARTBEAT_INTERVAL_MS = 60_000;
// eslint-disable-next-line no-eval
const heartbeatSlotMs = eval(`(${src.match(/function heartbeatSlotMs\(id\) \{[\s\S]*?\n\}/)[0]})`);

// hdy's real camera ids at the time of the incident
const HDY = ['hdy-anpr1', 'hdy-motor-lotus1', 'hdy-anpr-lotus2', 'hdy-motor-lotus2', 'hdy-anpr-r51', 'hdy-anpr-r52',
  'hdy-motor-r51', 'hdy-motor-r52', 'hdy-anpr-1081', 'hdy-anpr-1082', 'hdy-motor-1081', 'hdy-motor-1082',
  'hdy-anpr-mhatyai1', 'hdy-anpr-mhatyai2', 'hdy-motor-mhatyai1', 'hdy-motor-mhatyai2', 'hdy-anpr-bangfab1',
  'hdy-anpr-bangfab2', 'hdy-motor-bangfab1', 'hdy-motor-bangfab2', 'hdy-anpr-metrocat1', 'hdy-anpr-metrocat2',
  'hdy-motor-metrocat1', 'hdy-motor-metrocat2', 'hdy-anpr-nakuan1', 'hdy-anpr-nakuan2', 'hdy-motor-nakuan1',
  'hdy-motor-nakuan2', 'hdy-anpr-bigc1', 'hdy-anpr-bigc2', 'hdy-motor-bigc1', 'hdy-motor-bigc2', 'BSH-HDY-4031',
  'BSH-HDY-4038', 'hdy-anpr-kohong1', 'hdy-motor-kohong1', 'hdy-anpr-kohong2', 'hdy-motor-kohong2',
  'hdy-anpr-klonghae1', 'hdy-motor-klonghae1', 'hdy-anpr-klonghae2', 'hdy-motor-klonghae2',
  ...['01', '02', '03', '04'].flatMap((n) => [`HDY-NVR-${n}-ch0`, `HDY-NVR-${n}-ch1`])];

test('heartbeat round schedules each camera at its own slot, not all at once', () => {
  const body = src.slice(src.indexOf('function heartbeatRound()'), src.indexOf('setInterval(heartbeatRound'));
  assert.match(body, /for \(const id of Object\.keys\(_cameraMap\)\) setTimeout\(\(\) => \{[\s\S]*Device\/heartbeat[\s\S]*\}, heartbeatSlotMs\(id\)\);/);
  assert.match(src, /setTimeout\(heartbeatRound, 5_000\);/, 'first round right after boot');
});

test('slot is fixed per camera id and inside the interval', () => {
  assert.equal(crypto.createHash('sha1').update('x').digest().length, 20);
  for (const id of HDY) {
    const s = heartbeatSlotMs(id);
    assert.ok(s >= 0 && s < HEARTBEAT_INTERVAL_MS);
    assert.equal(heartbeatSlotMs(id), s, 'same id → same slot every round, whatever order the map is in');
  }
});

test('hdy cameras no longer land in one burst', () => {
  const perSecond = {};
  for (const id of HDY) { const k = Math.floor(heartbeatSlotMs(id) / 1000); perSecond[k] = (perSecond[k] || 0) + 1; }
  const worst = Math.max(...Object.values(perSecond));
  assert.ok(worst <= 4, `at most 4 heartbeats share a second (was ${HDY.length} in one); got ${worst}`);
});
