// ============================================================
// Vigil Platform — Tests: mqttPublisher (mosquitto migration M1)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// mqttPublisher.js เป็น MQTT client ตัวเดียวที่เปิดค้างสำหรับ brokerAdmin โหมด
// mosquitto — mock ผ่าน require.cache (ห้ามต่อ broker จริง, ตาม feedback
// harness_real_line_send / no leftover process). สิ่งที่ต้องคุม:
//   1. resolve เมื่อ publish callback สำเร็จ (จำลอง PUBACK)
//   2. reject เมื่อ client.connected=false — ห้าม "คิวไว้ก่อน" (advisor: reboot-
//      device/storage-purge ที่ UI รายงานว่าพังต้องพังจริง ไม่ใช่หลุดไปส่งทีหลัง)
//   3. reject เมื่อ timeout (ack ไม่มาเลย) — ใช้ node:test mock.timers แทนรอ 8s จริง
//   4. reject ทันทีเมื่อ MQTT_PUBLISHER_USER/PASSWORD ไม่ได้ตั้ง (ไม่แตะ mqtt เลย)
// ============================================================
'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const EventEmitter = require('events');

const MODULE = path.join(__dirname, '..', 'src', 'helpers', 'mqttPublisher.js');
const MQTT_PATH = require.resolve('mqtt', { paths: [path.join(__dirname, '..', 'src', 'helpers')] });

function freshPublisher() {
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

function installFakeMqtt(makeClient) {
  const prev = require.cache[MQTT_PATH];
  require.cache[MQTT_PATH] = {
    id: MQTT_PATH, filename: MQTT_PATH, loaded: true, exports: { connect: () => makeClient() },
  };
  return () => { if (prev) require.cache[MQTT_PATH] = prev; else delete require.cache[MQTT_PATH]; };
}

function fakeClient({ connectImmediately = true, publishImpl } = {}) {
  const c = new EventEmitter();
  c.connected = false;
  c.publishCalls = [];
  c.publish = (topic, payload, opts, cb) => {
    c.publishCalls.push({ topic, payload, opts });
    if (publishImpl) return publishImpl(cb, { topic, payload, opts });
    cb(null); // default: instant PUBACK
  };
  c.end = () => {};
  if (connectImmediately) {
    setImmediate(() => { c.connected = true; c.emit('connect'); });
  }
  return c;
}

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  });
}

test('publish() resolves once the publish callback fires (simulated PUBACK)', async () => {
  await withEnv({ MQTT_PUBLISHER_USER: 'pub', MQTT_PUBLISHER_PASSWORD: 'pw' }, async () => {
    let client;
    const restore = installFakeMqtt(() => (client = fakeClient()));
    try {
      const mqttPublisher = freshPublisher();
      await mqttPublisher.publish('projects/x/_config/cameras', { a: 1 }, { qos: 1, retain: true });
      assert.equal(client.publishCalls.length, 1);
      assert.equal(client.publishCalls[0].topic, 'projects/x/_config/cameras');
      assert.equal(client.publishCalls[0].payload, JSON.stringify({ a: 1 }));
      assert.deepEqual(client.publishCalls[0].opts, { qos: 1, retain: true });
    } finally { restore(); }
  });
});

test('publish() rejects immediately when not connected — never silently queues', async () => {
  await withEnv({ MQTT_PUBLISHER_USER: 'pub', MQTT_PUBLISHER_PASSWORD: 'pw' }, async () => {
    let client;
    const restore = installFakeMqtt(() => (client = fakeClient({ connectImmediately: true })));
    try {
      const mqttPublisher = freshPublisher();
      await mqttPublisher.publish('x', { a: 1 }); // let it connect once
      client.connected = false; // simulate a drop
      await assert.rejects(
        () => mqttPublisher.publish('x', { a: 1 }),
        /not connected/
      );
      assert.equal(client.publishCalls.length, 1, 'must not have called publish() while disconnected');
    } finally { restore(); }
  });
});

test('publish() rejects on ack timeout instead of hanging forever', async () => {
  await withEnv({ MQTT_PUBLISHER_USER: 'pub', MQTT_PUBLISHER_PASSWORD: 'pw' }, async () => {
    const restore = installFakeMqtt(() => fakeClient({ publishImpl: () => {} })); // cb never called
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const mqttPublisher = freshPublisher();
      const p = mqttPublisher.publish('x', { a: 1 });
      const assertion = assert.rejects(p, /ack timeout/);
      await new Promise((r) => setImmediate(r)); // let the fake client's real setImmediate 'connect' fire first
      mock.timers.tick(8001);
      await assertion;
    } finally { mock.timers.reset(); restore(); }
  });
});

test('publish() rejects without touching mqtt at all when creds are unset', async () => {
  await withEnv({ MQTT_PUBLISHER_USER: '', MQTT_PUBLISHER_PASSWORD: '' }, async () => {
    let connectCalled = false;
    const restore = installFakeMqtt(() => { connectCalled = true; return fakeClient(); });
    try {
      const mqttPublisher = freshPublisher();
      await assert.rejects(() => mqttPublisher.publish('x', { a: 1 }), /MQTT_PUBLISHER_USER\/PASSWORD not set/);
      assert.equal(connectCalled, false, 'must not call mqtt.connect() without credentials');
    } finally { restore(); }
  });
});
