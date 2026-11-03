// Vigil Platform — rollup n_noread_ev ต้องรันใน transaction ที่ปิด sort (กัน spill ลงดิสก์)
// pool ปลอม ไม่แตะ DB/เครือข่าย
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshLprWindow } = require('../src/traffic-stats-refresher');

function fakePool({ failOn } = {}) {
  const log = [];
  const q = (who) => async (sql) => {
    const t = String(sql).trim().replace(/\s+/g, ' ');
    log.push(`${who}: ${t.slice(0, 120)}`);
    if (failOn && t.includes(failOn)) throw new Error('boom');
    return { rows: [], rowCount: 0 };
  };
  let released = 0;
  return {
    log, released: () => released,
    query: q('pool'),
    connect: async () => ({ query: q('client'), release() { released++; } }),
  };
}

test('noread INSERT runs on one client between BEGIN / SET LOCAL enable_sort = off / COMMIT', async () => {
  const p = fakePool();
  await refreshLprWindow(p, new Date(Date.now() - 3600_000));
  const i = p.log.findIndex((l) => /client: INSERT INTO lpr_hourly_stats \(camera_id, bucket_hour, n_noread_ev/.test(l));
  assert.ok(i > 1, p.log.join('\n'));
  assert.equal(p.log[i - 2], 'client: BEGIN');
  assert.equal(p.log[i - 1], 'client: SET LOCAL enable_sort = off');
  assert.equal(p.log[i + 1], 'client: COMMIT');
  assert.equal(p.released(), 1);
  // คำสั่งอื่นยังยิงบน pool ตามเดิม ไม่ติด enable_sort
  assert.ok(p.log.some((l) => /^pool: INSERT INTO lpr_hourly_stats/.test(l)));
});

test('a failing noread INSERT rolls back and releases the client', async () => {
  const p = fakePool({ failOn: 'n_noread_ev' });
  await assert.rejects(refreshLprWindow(p, new Date(Date.now() - 3600_000)), /boom/);
  assert.ok(p.log.includes('client: ROLLBACK'));
  assert.equal(p.released(), 1);
});
