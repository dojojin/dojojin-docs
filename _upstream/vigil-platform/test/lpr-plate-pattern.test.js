// ============================================================
// Vigil Platform — Tests: ค้นป้ายตามรูปแบบ (# @ ? * [5-9]) บน GET /api/lpr (2026-10-22)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('../src/node_modules/express');
const { toRegex } = require('../src/helpers/platePattern');

test('pattern language: compares the whole plate and keeps every other character literal', () => {
  assert.equal(toRegex('[5-9]#*').regex, '^[5-9][0-9].*$');
  assert.equal(toRegex('กข 12*').regex, '^กข12.*$');
  assert.equal(toRegex('a.b|c').regex, '^a\\.b\\|c$');
  const re = new RegExp(toRegex('[5-9]#*').regex);
  assert.ok(re.test('59ฒ96') && !re.test('1กข1234') && !re.test('กข1234'));
  assert.equal(toRegex('**').error, 'no_constraint');
  assert.equal(toRegex('[9-5]').error, 'bad_range');
});

// pool ปลอม: จดทุก SQL และพารามิเตอร์ · ตอบว่างทุกอย่าง
function fakePool() {
  const log = [];
  const query = async (sql, params) => { log.push({ sql: String(sql), params: params || [] }); return { rows: [], rowCount: 0 }; };
  return { log, query, connect: async () => ({ query, release() {} }) };
}
async function get(qs, pool = fakePool()) {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
  require('../src/routes/lpr-list').registerLprList(app, pool);
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/lpr?${new URLSearchParams(qs)}`);
    return { status: r.status, body: await r.json().catch(() => null), pool };
  } finally { srv.close(); }
}
const day = (n) => new Date(Date.now() - n * 86400000).toISOString();

test('a bad pattern is a 400 with a reason, never reaches the database', async () => {
  const r = await get({ q: '[9-5]#', match: 'pattern', from: day(1) });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'bad_pattern', reason: 'bad_range' });
  assert.equal(r.pool.log.length, 0);
});

test('pattern search needs a window of at most 7 days', async () => {
  assert.equal((await get({ q: '[5-9]#*', match: 'pattern' })).body.error, 'pattern_range_too_wide');
  assert.equal((await get({ q: '[5-9]#*', match: 'pattern', from: day(8) })).body.error, 'pattern_range_too_wide');
  assert.equal((await get({ q: '[5-9]#*', match: 'pattern', from: day(10), to: day(2) })).body.error, 'pattern_range_too_wide');
});

test('a valid pattern is sent as a bind parameter to ~, never spliced into SQL', async () => {
  const r = await get({ q: '[5-9]#*', match: 'pattern', from: day(1) });
  assert.equal(r.status, 200);
  const hit = r.pool.log.find((x) => /\(lp\.plate_number \|\| ''\) ~ \$\d+/.test(x.sql));
  assert.ok(hit, 'query uses the regex operator on an expression (keeps the trigram index out of the plan)');
  assert.ok(!r.pool.log.some((x) => /[^(]lp\.plate_number ~ \$/.test(x.sql)), 'never the bare column — that lets the planner scan the whole table');
  assert.ok(hit.params.includes('^[5-9][0-9].*$'));
  assert.ok(!r.pool.log.some((x) => x.sql.includes('[5-9]')), 'pattern text never appears in SQL');
});

test('a short pattern is allowed (the 3-character rule is for substring search only)', async () => {
  const r = await get({ q: '5*', match: 'pattern', from: day(1) });
  assert.equal(r.status, 200);
});
