// Vigil Platform — warm loop ของสถิติ LPR ต้องใช้ pool สถิติ ไม่แตะ pool หลัก
// ไม่แตะ DB/เครือข่าย: pool ปลอม · ไม่มี http server
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { after } = require('node:test');
const express = require('../src/node_modules/express');

process.env.LPR_WARM_FIRST_RUN_MS = '20';
const realSetInterval = global.setInterval, realSetTimeout = global.setTimeout;
global.setInterval = () => ({ unref() {} });          // รอบถัดไปของ warm ไม่ต้องมี
const lprQueryRoutes = require('../src/routes/lpr-query');

const row = new Proxy({}, { get: (_, k) => (k === 'then' || typeof k === 'symbol') ? undefined : '0' });
const fakePool = () => {
  const p = { calls: 0, conns: 0 };
  p.query = async () => { p.calls++; await new Promise((r) => realSetTimeout(r, 2)); return { rows: [row], rowCount: 1 }; };
  p.connect = async () => { p.conns++; return { query: p.query, release() {} }; };
  p.on = () => {};
  return p;
};

test('first warm pass reads only from the stats pool', async () => {
  const main = fakePool(), stats = fakePool();
  const logs = [];
  const origLog = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
  try {
    lprQueryRoutes(express(), main, stats);
    const until = Date.now() + 3000;
    while (!logs.some((l) => /warmed stats period=today/.test(l)) && Date.now() < until) await new Promise((r) => realSetTimeout(r, 20));
  } finally { console.log = origLog; }
  assert.ok(logs.some((l) => /warmed stats period=month/.test(l)), 'month warmed');
  assert.ok(logs.some((l) => /warmed stats period=today/.test(l)), 'today warmed');
  assert.ok(stats.calls > 0);
  assert.equal(main.calls, 0);
  assert.equal(main.conns, 0);
});

after(() => { global.setInterval = realSetInterval; });
