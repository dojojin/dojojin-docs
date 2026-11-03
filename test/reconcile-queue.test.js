// Vigil Platform — คิว reconcile: ทีละตัว และตัวที่ล้มไม่บล็อกตัวถัดไป
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { serial } = require('../src/helpers/reconcileQueue');

test('serial runs bodies one at a time in order', async () => {
  const log = [];
  const a = serial(async () => { log.push('a-start'); await new Promise((r) => setTimeout(r, 50)); log.push('a-end'); return 1; });
  const b = serial(async () => { log.push('b-start'); return 2; });
  assert.deepEqual(await Promise.all([a, b]), [1, 2]);
  assert.deepEqual(log, ['a-start', 'a-end', 'b-start']);
});

test('serial: a rejection does not block the next body', async () => {
  const a = serial(async () => { await new Promise((r) => setTimeout(r, 10)); throw new Error('boom'); });
  const b = serial(async () => 'ok');
  await assert.rejects(a, /boom/);
  assert.equal(await b, 'ok');
});
