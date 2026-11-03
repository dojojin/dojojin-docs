// ============================================================
// Vigil Platform — Tests: checkMqttSilent — broker-neutral (migration 247)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Superseded 2026-09-28 (plan §8 A1): checkMqttSilent used to ask
// brokerAdmin.listConnectedUsers() "who is connected to Central right now"
// — which is structurally wrong for Bosch cameras: every one of them
// connects to its EDGE broker, never to Central, so that list NEVER
// contained them regardless of BROKER_KIND. Measured on prod 2026-09-27:
// 904,783 false "online but MQTT not connected" log lines from 8 cameras.
//
// Replacement signal: cameras.last_mqtt_at (migration 247), written by
// mqtt-subscriber.js on every real <cam>/onvif-ej/... message — see
// test/mqtt-heartbeat-batching.test.js for that half. This file pins the
// checkMqttSilent() decision logic itself.
//
// checkMqttSilent() lives inside api-server.js — a huge file wired to a real
// pool/loadCameraConfig, not import-and-run-safe (same convention as
// test/camera-online-confirm.test.js and test/camera-quiet-alert.test.js):
// source-text asserts pin the real file's shape, and a reimplemented copy
// (mirroring the source line for line) is exercised for behavior — with its
// own stub `send`, never the real _sendCameraStatusLine, so no LINE call is
// reachable from this file at all.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'api-server.js'), 'utf8');

// ── copy of checkMqttSilent's decision loop (src/api-server.js) — pinned below ──
const STALE_MS = 5 * 60 * 1000;
const REALERT_MS = 60 * 60 * 1000;

function makeChecker({ send, inQuiet = () => false }) {
  const _mqttSilent = new Map();
  async function checkMqttSilent({ cfgCameras, onlineIds, lastMqttAtById, alertMap, now = Date.now() }) {
    const mqttCams = cfgCameras.filter((c) =>
      (c.vendor || 'bosch').toLowerCase() === 'bosch' && c.mqtt_username);
    if (mqttCams.length === 0) return;
    for (const cam of mqttCams) {
      const id = cam.camera_id;
      const st = _mqttSilent.get(id) || { streak: 0, lastAlertAt: 0, alerted: false };
      const lastMqttAt = lastMqttAtById.get(id);
      const stale = !lastMqttAt || (now - new Date(lastMqttAt).getTime()) >= STALE_MS;
      const silent = onlineIds.has(id) && stale;
      if (!silent) {
        if (st.alerted && !stale) {
          const alertCfg = alertMap[id];
          if (alertCfg && alertCfg.enabled) send({ cameraId: id, status: 'mqtt_restored' });
        }
        _mqttSilent.delete(id);
        continue;
      }
      st.streak++;
      if (st.streak >= 2 && now - st.lastAlertAt >= REALERT_MS) {
        const alertCfg = alertMap[id];
        if (alertCfg && alertCfg.enabled && !inQuiet(alertCfg)) {
          send({ cameraId: id, status: 'mqtt_silent' });
          st.lastAlertAt = now;
          st.alerted = true;
        }
      }
      _mqttSilent.set(id, st);
    }
  }
  return checkMqttSilent;
}

const CAM = { camera_id: 'C1', vendor: 'bosch', mqtt_username: 'cam-c1' };
const ALERT_ON = { C1: { enabled: true } };

describe('checkMqttSilent — decision logic', () => {
  it('null last_mqtt_at on an online camera = silent from the first check', async () => {
    const sent = [];
    const check = makeChecker({ send: (x) => sent.push(x) });
    const lastMqttAtById = new Map([['C1', null]]);
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: 1_000_000 });
    // streak 1 — no alert yet (needs streak >= 2)
    assert.equal(sent.length, 0);
  });

  it('fresh last_mqtt_at (< 5 min old) on an online camera = never silent, never alerts', async () => {
    const sent = [];
    const check = makeChecker({ send: (x) => sent.push(x) });
    const now = 10_000_000;
    const lastMqttAtById = new Map([['C1', new Date(now - 60_000)]]); // 1 minute ago
    for (let i = 0; i < 3; i++) {
      await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now });
    }
    assert.equal(sent.length, 0);
  });

  it('exactly at the 5-minute boundary counts as stale (>=)', async () => {
    const sent = [];
    const check = makeChecker({ send: (x) => sent.push(x) });
    const now = 10_000_000;
    const lastMqttAtById = new Map([['C1', new Date(now - STALE_MS)]]);
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now });
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: now + 1 });
    assert.equal(sent.length, 1, 'streak reaches 2 on the second stale check and fires');
    assert.equal(sent[0].status, 'mqtt_silent');
  });

  it('offline camera (not in onlineIds) is never "silent" regardless of last_mqtt_at', async () => {
    const sent = [];
    const check = makeChecker({ send: (x) => sent.push(x) });
    const lastMqttAtById = new Map([['C1', null]]);
    for (let i = 0; i < 3; i++) {
      await check({ cfgCameras: [CAM], onlineIds: new Set(), lastMqttAtById, alertMap: ALERT_ON, now: i * 1000 });
    }
    assert.equal(sent.length, 0);
  });

  // Real code keeps lastAlertAt at epoch 0 until the first alert ever fires, and
  // the re-alert gate is `now - lastAlertAt >= REALERT_MS` — so every `now` below
  // starts at T0, comfortably past REALERT_MS, or that gate would block the very
  // first alert regardless of streak (an artifact of epoch-0 `now` in a test, not
  // a real-world case: `now` is always Date.now(), never near zero).
  const T0 = 2 * REALERT_MS;

  it('requires streak >= 2 before the first alert (one stale check alone does not fire)', async () => {
    const sent = [];
    const check = makeChecker({ send: (x) => sent.push(x) });
    const lastMqttAtById = new Map([['C1', null]]);
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 });
    assert.equal(sent.length, 0);
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 + 1 });
    assert.equal(sent.length, 1);
  });

  it('does not re-alert within 1 hour of the last alert', async () => {
    const sent = [];
    const check = makeChecker({ send: (x) => sent.push(x) });
    const lastMqttAtById = new Map([['C1', null]]);
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 });
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 + 1000 });
    assert.equal(sent.length, 1);
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 + 1000 + 30 * 60 * 1000 });
    assert.equal(sent.length, 1, 'still within the 1h re-alert window');
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 + 1000 + REALERT_MS + 1 });
    assert.equal(sent.length, 2, 'past the 1h window — re-alerts');
  });

  it('quiet hours suppress the send but the streak keeps counting', async () => {
    const sent = [];
    const check = makeChecker({ send: (x) => sent.push(x), inQuiet: () => true });
    const lastMqttAtById = new Map([['C1', null]]);
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 });
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 + 1 });
    assert.equal(sent.length, 0, 'quiet hours must block the send entirely');
  });

  it('restored fires ONLY after having actually alerted (no restored spam for a camera that was never announced silent)', async () => {
    const sent = [];
    const check = makeChecker({ send: (x) => sent.push(x) });
    const lastMqttAtById = new Map([['C1', new Date(0)]]);
    // never went stale long enough to alert (single check, streak 1)
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: STALE_MS });
    lastMqttAtById.set('C1', new Date(STALE_MS + 100));
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: STALE_MS + 100 });
    assert.equal(sent.length, 0, 'no mqtt_restored — it was never announced mqtt_silent to begin with');
  });

  it('restored fires after an actual alert, once the camera is fresh again', async () => {
    const sent = [];
    const check = makeChecker({ send: (x) => sent.push(x) });
    const lastMqttAtById = new Map([['C1', null]]);
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 });
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 + 1 });
    assert.equal(sent[0].status, 'mqtt_silent');
    lastMqttAtById.set('C1', new Date(T0 + 2)); // fresh again
    await check({ cfgCameras: [CAM], onlineIds: new Set(['C1']), lastMqttAtById, alertMap: ALERT_ON, now: T0 + 2 });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].status, 'mqtt_restored');
  });

  it('non-Bosch or non-MQTT cameras are skipped entirely', async () => {
    const sent = [];
    const check = makeChecker({ send: (x) => sent.push(x) });
    const cams = [{ camera_id: 'H1', vendor: 'hikvision', mqtt_username: 'cam-h1' },
                  { camera_id: 'B2', vendor: 'bosch' /* no mqtt_username */ }];
    await check({ cfgCameras: cams, onlineIds: new Set(['H1', 'B2']),
      lastMqttAtById: new Map(), alertMap: {}, now: 0 });
    assert.equal(sent.length, 0);
  });
});

// ── pin the real source to this exact shape — fails loudly if api-server.js drifts ──
describe('source-text pin (src/api-server.js)', () => {
  it('checkMqttSilent no longer calls brokerAdmin.listConnectedUsers()', () => {
    const i = src.indexOf('async function checkMqttSilent');
    assert.ok(i > 0, 'checkMqttSilent not found');
    const body = src.slice(i, i + 1400);
    assert.doesNotMatch(body, /listConnectedUsers/,
      'must not depend on the EMQX/Mosquitto connected-client list — structurally wrong for edge-connected cameras');
  });

  it('brokerAdmin is no longer required at module scope (nothing in this file uses it anymore)', () => {
    assert.doesNotMatch(src, /require\(['"]\.\/helpers\/brokerAdmin['"]\)/);
  });

  it('silent = stale last_mqtt_at (null or >= 5 minutes old), same formula for both BROKER_KIND values', () => {
    assert.match(src, /MQTT_SILENT_STALE_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
    const i = src.indexOf('async function checkMqttSilent');
    const body = src.slice(i, i + 1400);
    assert.match(body, /const stale = !lastMqttAt \|\| \(now - new Date\(lastMqttAt\)\.getTime\(\)\) >= MQTT_SILENT_STALE_MS;/);
    assert.match(body, /const silent = onlineIds\.has\(id\) && stale;/);
  });

  it('reads last_mqtt_at from the SAME query checkOfflineCameras already runs — not a second query', () => {
    const i = src.indexOf('async function checkOfflineCameras');
    assert.ok(i > 0);
    const body = src.slice(i, i + 3000);
    assert.match(body, /c\.last_mqtt_at/, 'checkOfflineCameras\' camera SELECT must carry last_mqtt_at');
    assert.match(body, /lastMqttAtById = new Map\(camRes\.rows\.map\(c => \[c\.camera_id, c\.last_mqtt_at\]\)\);/);
    assert.match(body, /checkMqttSilent\(\{ cfgCameras, onlineIds, lastMqttAtById, alertMap, lineCfg, tz \}\)/);
  });

  it('streak >= 2 and the 1h re-alert window are unchanged', () => {
    assert.match(src, /MQTT_SILENT_REALERT_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
    const i = src.indexOf('async function checkMqttSilent');
    const body = src.slice(i, i + 1400);
    assert.match(body, /st\.streak >= 2 && Date\.now\(\) - st\.lastAlertAt >= MQTT_SILENT_REALERT_MS/);
  });

  it('quiet hours are still checked before sending', () => {
    const i = src.indexOf('async function checkMqttSilent');
    const body = src.slice(i, i + 1400);
    assert.match(body, /_camAlertInQuiet\(alertCfg, tz\)/);
  });
});
