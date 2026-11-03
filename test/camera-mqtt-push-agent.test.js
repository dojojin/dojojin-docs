// ============================================================
// Vigil Platform — Tests: push-MQTT-into-camera wiring (source-text)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// edge-config-agent.js, edge/bridge.js and mqtt-subscriber.js all connect to
// a broker (or process.exit(1) without EDGE_SITE_CODE) at require() time —
// none of the existing commands on this channel (reboot-device, svc,
// detect-model, scan-nvr) have a test that imports them directly either; see
// test/camera-online-confirm.test.js for the same convention applied to
// api-server.js. This checks the actual shipped source text instead.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('edge-config-agent.js — TOPIC_CAMERA_MQTT handler', () => {
  const src = read('src/edge-config-agent.js');

  it('declares the request/result topic pair and subscribes to the request', () => {
    assert.match(src, /TOPIC_CAMERA_MQTT\s*=\s*`projects\/\$\{SITE\}\/_config\/camera-mqtt`/);
    assert.match(src, /TOPIC_CAMERA_MQTT_RESULT\s*=\s*`projects\/\$\{SITE\}\/_config\/camera-mqtt-result`/);
    const subIdx = src.indexOf('client.subscribe([');
    assert.ok(subIdx > 0);
    assert.match(src.slice(subIdx, subIdx + 300), /TOPIC_CAMERA_MQTT[^_]/, 'the request topic must be in the subscribe list');
  });

  it('gates on the shared command secret, same as reboot-device', () => {
    const i = src.indexOf('if (topic === TOPIC_CAMERA_MQTT)');
    assert.ok(i > 0, 'handler block not found');
    const body = src.slice(i, i + 1200);
    assert.match(body, /hasValidCommandSecret\(req\)/);
  });

  it('rejects a camera that is not Bosch, defaulting vendor the same way routes/cameras.js does', () => {
    const i = src.indexOf('if (topic === TOPIC_CAMERA_MQTT)');
    const body = src.slice(i, i + 1200);
    assert.match(body, /\(cam\.vendor \|\| 'bosch'\)\.toLowerCase\(\) !== 'bosch'/,
      'must default missing vendor to bosch like the rest of the codebase — a stricter check here would reject real Bosch cameras with no vendor field');
  });

  it('replies with unknown-camera when the id is not in this site\'s _cameraMap', () => {
    const i = src.indexOf('if (topic === TOPIC_CAMERA_MQTT)');
    const body = src.slice(i, i + 1200);
    assert.match(body, /unknown camera on this site/);
  });

  it('delegates the actual write to pushMqttSettings and never inlines the RCP call itself', () => {
    assert.match(src, /const \{ boschSdProbe, pushMqttSettings, readTaskNames \} = require\('\.\/helpers\/boschRcp'\)/);
    const i = src.indexOf('if (topic === TOPIC_CAMERA_MQTT)');
    const body = src.slice(i, i + 1200);
    assert.match(body, /pushMqttSettings\(cam\)/);
  });
});

describe('edge/bridge.js — camera-mqtt is a relayed downlink topic', () => {
  const src = read('src/edge/bridge.js');

  it('CAMERA_MQTT_TOPIC is declared and included in DOWNLINK_TOPICS', () => {
    assert.match(src, /CAMERA_MQTT_TOPIC\s*=\s*`projects\/\$\{SITE_ID\}\/_config\/camera-mqtt`/);
    const i = src.indexOf('const DOWNLINK_TOPICS');
    assert.ok(i > 0);
    assert.match(src.slice(i, i + 400), /CAMERA_MQTT_TOPIC/,
      'a topic missing from DOWNLINK_TOPICS never reaches the edge agent at all — GOTCHAS precedent (storage-scan/purge) for this exact failure mode');
  });
});

describe('mqtt-subscriber.js — camera-mqtt-result is bridged to Postgres', () => {
  const src = read('src/mqtt-subscriber.js');

  it('forwards the result via pg_notify before the generic _config/ catch-all', () => {
    const resultIdx = src.indexOf("stripped.startsWith('_config/camera-mqtt-result')");
    const catchAllIdx = src.indexOf("if (stripped.startsWith('_config/')) return;");
    assert.ok(resultIdx > 0 && catchAllIdx > 0);
    assert.ok(resultIdx < catchAllIdx, 'must be handled before the catch-all or it never reaches pg_notify');
    assert.match(src.slice(resultIdx, resultIdx + 300), /pg_notify\('camera_mqtt_result'/);
  });

  it('logs only safe scalar fields, not the whole message object', () => {
    const i = src.indexOf("stripped.startsWith('_config/camera-mqtt-result')");
    const body = src.slice(i, i + 500);
    assert.doesNotMatch(body, /console\.(log|warn)\(.*JSON\.stringify\(msg\)/,
      'must not dump the raw message — even though pushMqttSettings never puts a password in it, this handler should not have to be the one place trusted to know that');
  });
});

describe('api-server.js — camera_mqtt_result LISTEN wiring', () => {
  const src = read('src/api-server.js');

  it('LISTENs on the channel', () => {
    // ตั้งแต่ 2026-10-02 ws-bridge ใช้ helpers/pgListen (ต่อกลับเองเมื่อหลุด) — channel อยู่ในรายการ channels
    assert.match(src, /LISTEN camera_mqtt_result|channels: \[[^\]]*'camera_mqtt_result'/);
  });

  it('resolves the registry by req_id, not the whole payload as the key', () => {
    const i = src.indexOf("msg.channel === 'camera_mqtt_result'");
    assert.ok(i > 0);
    const body = src.slice(i, i + 400);
    assert.match(body, /cameraMqttRegistry'\)\.resolve\(p\.req_id, p\)/);
  });
});

describe('routes/cameras.js — POST /api/cameras/:id/push-mqtt', () => {
  const src = read('src/routes/cameras.js');
  const routeIdx = src.indexOf("app.post('/api/cameras/:id/push-mqtt'");

  it('route exists and is admin-gated, same style as mqtt/regenerate and reboot', () => {
    assert.ok(routeIdx > 0, 'route not found');
    assert.match(src.slice(routeIdx, routeIdx + 60), /auth\.requireAdmin/);
  });

  it('validates camera_id with the face-push-token pattern (exact match, no lowercasing — ids like BOSCH_8000i are case-sensitive)', () => {
    const body = src.slice(routeIdx, routeIdx + 2600);
    assert.match(body, /\/\^\[A-Za-z0-9_-\]\+\$\/\.test\(rawId\)/);
    assert.doesNotMatch(body, /rawId\.toLowerCase\(\)/, 'must not lowercase — mqtt/regenerate\'s pattern would reject BOSCH_8000i');
  });

  it('refuses non-Bosch cameras and cameras without provisioned mqtt credentials', () => {
    const body = src.slice(routeIdx, routeIdx + 2600);
    assert.match(body, /vendor.*bosch.*only available for Bosch/is);
    assert.match(body, /mqtt_username.*mqtt_password.*provision first/is);
  });

  it('branches central-local (direct pushMqttSettings) vs edge (MQTT round trip via cameraMqttRegistry)', () => {
    const body = src.slice(routeIdx, routeIdx + 2600);
    assert.match(body, /siteCode && siteCode !== 'main'/);
    assert.match(body, /cameraMqttRegistry\.register\(reqId\)/);
    assert.match(body, /cameraMqttRegistry\.waitFor\(reqId,\s*60_000\)/);
    assert.match(body, /pushMqttSettings\(cam\)/);
  });

  it('an edge timeout is reported as unknown, not as a failure', () => {
    const body = src.slice(routeIdx, routeIdx + 2600);
    assert.match(body, /status\(504\)/);
    assert.doesNotMatch(body, /status\(504\)\.json\(\{[^}]*ok:\s*false[^}]*error:\s*'[^']*(ล้มเหลว|failed|พัง)/i,
      'the 504 response text must not claim it failed — the edge may still be mid round-trip');
  });

  it('the JSON response never has an mqtt_password field', () => {
    const body = src.slice(routeIdx, src.indexOf('});', routeIdx) + 3);
    assert.doesNotMatch(body, /mqtt_password/);
  });
});
