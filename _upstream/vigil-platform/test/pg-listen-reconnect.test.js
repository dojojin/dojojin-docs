// Vigil Platform — LISTEN ต้องต่อกลับเองเมื่อหลุด (GOTCHAS #217) · client ปลอม ไม่แตะ DB
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { listenForever } = require('../src/helpers/pgListen');

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
function factory({ failFirst = 0 } = {}) {
  const made = [];
  let fails = failFirst;
  const make = () => {
    const c = new EventEmitter();
    c.queries = []; c.ended = false;
    c.connect = async () => { if (fails-- > 0) throw new Error('ECONNREFUSED'); };
    c.query = async (q) => { c.queries.push(q); return {}; };
    c.end = async () => { c.ended = true; };
    made.push(c);
    return c;
  };
  return { make, made };
}

test('retries when the first connect fails, then LISTENs every channel', async (t) => {
  const f = factory({ failFirst: 2 });
  const h = listenForever({ label: 't', channels: ['a', 'b'], onNotification() {}, makeClient: f.make, minDelayMs: 5, maxDelayMs: 20 });
  t.after(() => h.stop());
  await tick(80);
  assert.equal(h.isConnected(), true);
  assert.equal(f.made.length, 3);
  assert.deepEqual(f.made[2].queries, ['LISTEN a', 'LISTEN b']);
});

test('a dropped connection (error + end) reconnects exactly once and re-LISTENs', async (t) => {
  const f = factory();
  const got = [];
  const h = listenForever({ label: 't', channels: ['new_event'], onNotification: (m) => got.push(m.payload), makeClient: f.make, minDelayMs: 5 });
  t.after(() => h.stop());
  await tick();
  const first = f.made[0];
  first.emit('error', new Error('Connection terminated unexpectedly'));
  first.emit('end');
  assert.equal(first.ended, true);
  first.emit('notification', { payload: 'stale' });          // ตัวเก่าต้องไม่ส่งต่อแล้ว
  await tick(60);
  assert.equal(f.made.length, 2, 'one new client, not two');
  assert.equal(h.isConnected(), true);
  assert.deepEqual(f.made[1].queries, ['LISTEN new_event']);
  f.made[1].emit('notification', { payload: 'fresh' });
  assert.deepEqual(got, ['fresh']);
});

test('stop() ends the client and stops reconnecting', async () => {
  const f = factory();
  const h = listenForever({ label: 't', channels: ['x'], onNotification() {}, makeClient: f.make, minDelayMs: 5 });
  await tick();
  await h.stop();
  f.made[0].emit('end');
  await tick(40);
  assert.equal(f.made.length, 1);
  assert.equal(f.made[0].ended, true);
});

test('api-server ws-bridge and the Dahua clip resolver use the reconnecting helper', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const api = rd('src/api-server.js');
  assert.match(api, /listenForever\(\{\s*label: 'ws-bridge'/);
  assert.doesNotMatch(api, /listenClient\.connect\(\)/);
  const dh = rd('src/ingesters/dahua-cgi.js');
  assert.match(dh, /listenForever\(\{\s*label: 'dahua clip resolver'/);
});

test('alert-worker and media-recorder also use the reconnecting helper', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(rd('src/alert-worker.js'), /listenForever\(\{\s*label: 'alert-worker'/);
  assert.match(rd('src/media-recorder.js'), /listenForever\(\{\s*label: 'recorder'/);
});
