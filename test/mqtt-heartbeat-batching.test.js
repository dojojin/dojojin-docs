// ============================================================
// Vigil Platform — Tests: mqtt-subscriber last_mqtt_at heartbeat (migration 247)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// src/mqtt-subscriber.js can't be require()'d directly in a test — it calls
// require('./singleton')('mqtt-subscriber') at module scope (refuses to run
// a second copy against the real pid file) and opens a real pg.Pool — same
// reasoning as every other mqtt-subscriber-adjacent test in this repo
// (edge-camera-status.test.js, dahua-parser.test.js): none of them require
// it either, they pin behavior with a reimplemented copy + source-text
// asserts that fail loudly if the real file drifts from this copy.
//
// docs/reports/2026-09-27_mosquitto-migration-plan.md §8 A1.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'mqtt-subscriber.js'), 'utf8');

// ── copy of _recordMqttHeartbeat / _flushMqttHeartbeats — pinned below ──
const AGENT_ORIGINATED_TOPICS = new Set([
  'onvif-ej/Device/heartbeat',
  'onvif-ej/Device/sd-status',
  'onvif-ej/Device/vca-rules',
]);
function makeHeartbeatTracker(query) {
  const lastMqttAt = new Map();
  function record(strippedTopic) {
    const slash = strippedTopic.indexOf('/');
    if (slash < 1) return;
    const rest = strippedTopic.slice(slash + 1);
    if (rest.startsWith('onvif-ej/') && !AGENT_ORIGINATED_TOPICS.has(rest)) {
      lastMqttAt.set(strippedTopic.slice(0, slash), new Date());
    }
  }
  async function flush() {
    if (lastMqttAt.size === 0) return;
    const entries = [...lastMqttAt.entries()];
    lastMqttAt.clear();
    try {
      await query(
        `UPDATE cameras c SET last_mqtt_at = v.t
         FROM unnest($1::text[], $2::timestamptz[]) AS v(id, t)
         WHERE c.id = v.id`,
        [entries.map((e) => e[0]), entries.map((e) => e[1])]
      );
    } catch { /* non-fatal — see source-text pin below */ }
  }
  return { record, flush, _map: lastMqttAt };
}

describe('_recordMqttHeartbeat — topic normalisation (both shapes land here identically)', () => {
  it('local (non site-prefixed) onvif-ej topic records the camera id', () => {
    const t = makeHeartbeatTracker(async () => {});
    t.record('BOSCH_3100i/onvif-ej/Device/Monitoring');
    assert.ok(t._map.has('BOSCH_3100i'));
  });

  it('edge-bridged topic — _stripSitePrefix already removed "projects/<site>/" before this runs, so it looks identical to the local shape', () => {
    // real topic on the wire: projects/hdy/BSH-HDY-4031/onvif-ej/Device/Monitoring
    // _stripSitePrefix() turns that into exactly this before _recordMqttHeartbeat sees it
    const t = makeHeartbeatTracker(async () => {});
    t.record('BSH-HDY-4031/onvif-ej/Device/Monitoring');
    assert.ok(t._map.has('BSH-HDY-4031'));
  });

  it('non onvif-ej topics are ignored (_config/*, _edge/*, retention, etc.)', () => {
    const t = makeHeartbeatTracker(async () => {});
    t.record('_config/scan-result');
    t.record('_edge/heartbeat');
    t.record('BOSCH_3100i/RuleEngine/x'); // real event topic shape, but NOT onvif-ej
    assert.equal(t._map.size, 0);
  });

  it('a topic with no slash is ignored safely (no crash)', () => {
    const t = makeHeartbeatTracker(async () => {});
    assert.doesNotThrow(() => t.record('nokey'));
    assert.equal(t._map.size, 0);
  });

  it('agent-originated topics (heartbeat/sd-status/vca-rules) are NOT counted as the camera\'s own MQTT session', () => {
    const t = makeHeartbeatTracker(async () => {});
    t.record('BOSCH_3100i/onvif-ej/Device/heartbeat');
    t.record('BOSCH_3100i/onvif-ej/Device/sd-status');
    t.record('BOSCH_3100i/onvif-ej/Device/vca-rules');
    assert.equal(t._map.size, 0, 'these prove TCP reachability, not that the camera itself is publishing');
  });

  it('other onvif-ej/Device/* and RuleEngine topics from the camera itself are still recorded', () => {
    const t = makeHeartbeatTracker(async () => {});
    t.record('BOSCH_3100i/onvif-ej/Monitoring/Profile/ActiveConnections/&0');
    t.record('BSH-HDY-4031/onvif-ej/RuleEngine/CountAggregation/Counter/&1/some_rule');
    assert.ok(t._map.has('BOSCH_3100i'));
    assert.ok(t._map.has('BSH-HDY-4031'));
  });
});

describe('_flushMqttHeartbeats — batching', () => {
  it('one UPDATE for many cameras in a single call, deduped per camera', async () => {
    const calls = [];
    const t = makeHeartbeatTracker(async (sql, params) => { calls.push({ sql, params }); });
    t.record('CAM_A/onvif-ej/Device/x');
    t.record('CAM_B/onvif-ej/Device/x');
    t.record('CAM_A/onvif-ej/Device/y'); // same camera twice — one entry, not two
    await t.flush();
    assert.equal(calls.length, 1, 'must be exactly one UPDATE for the whole batch');
    assert.deepEqual(calls[0].params[0].sort(), ['CAM_A', 'CAM_B']);
    assert.equal(calls[0].params[1].length, 2);
    assert.match(calls[0].sql, /UPDATE cameras c SET last_mqtt_at = v\.t/);
  });

  it('no query at all when nothing changed since the last flush', async () => {
    const calls = [];
    const t = makeHeartbeatTracker(async (sql, params) => { calls.push({ sql, params }); });
    await t.flush();
    assert.equal(calls.length, 0, 'empty flush must not touch the DB');
  });

  it('a failed flush is swallowed (warn-only), not thrown', async () => {
    const t = makeHeartbeatTracker(async () => { throw new Error('db down'); });
    t.record('CAM_A/onvif-ej/Device/x');
    await assert.doesNotReject(() => t.flush());
  });

  it('clears its map synchronously before the query settles, so messages arriving mid-flush land in the NEXT flush, not this one', async () => {
    const t = makeHeartbeatTracker(async () => {});
    t.record('CAM_A/onvif-ej/Device/x');
    const pending = t.flush();
    assert.equal(t._map.size, 0, 'map must already be empty before the query resolves');
    await pending;
  });
});

// ── pin the real source to this exact shape — fails loudly if mqtt-subscriber.js drifts ──
describe('source-text pin (src/mqtt-subscriber.js)', () => {
  it('records the heartbeat right after site-prefix stripping, before any early return in the handler', () => {
    const i = src.indexOf('const stripped = _stripSitePrefix(topic);');
    assert.ok(i > 0, 'stripped assignment not found');
    assert.match(src.slice(i, i + 100), /_recordMqttHeartbeat\(stripped\);/);
  });

  it('gate matches on "<id>/onvif-ej/..." exactly (not any "/onvif-ej" substring elsewhere)', () => {
    assert.match(src, /rest\.startsWith\('onvif-ej\/'\)/);
  });

  it('gate excludes agent-originated topics via AGENT_ORIGINATED_TOPICS, not counting them as the camera\'s own session', () => {
    assert.match(src, /AGENT_ORIGINATED_TOPICS\.has\(rest\)/);
    assert.match(src, /'onvif-ej\/Device\/heartbeat'/);
    assert.match(src, /'onvif-ej\/Device\/sd-status'/);
    assert.match(src, /'onvif-ej\/Device\/vca-rules'/);
  });

  it('flush uses ONE batched UPDATE via unnest — not a query per camera', () => {
    assert.match(src, /UPDATE cameras c SET last_mqtt_at = v\.t/);
    assert.match(src, /FROM unnest\(\$1::text\[\], \$2::timestamptz\[\]\) AS v\(id, t\)/);
  });

  it('flush failures only warn — never throw out of the 60s interval tick', () => {
    const i = src.indexOf('async function _flushMqttHeartbeats');
    assert.ok(i > 0);
    const body = src.slice(i, i + 700);
    assert.match(body, /console\.warn\('\[mqtt-heartbeat\] flush last_mqtt_at failed:'/);
  });

  it('flushes on a 60s unref()\'d interval (never a per-message DB write)', () => {
    assert.match(src, /setInterval\(\(\) => \{ _flushMqttHeartbeats\(\)\.catch\(\(\) => \{\}\); \}, 60_000\)\.unref\(\);/);
  });
});
