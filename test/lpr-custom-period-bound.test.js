// Vigil Platform — custom period ต้องมีขอบล่างเสมอ (ไม่แตะ DB/เครือข่าย)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// โมดูลตั้ง setInterval/setTimeout (warm loop) ตอน mount เท่านั้น — require เฉย ๆ ไม่ติด
const { periodClause: pc } = require('../src/routes/lpr-query');

test('custom without from or to: bounded to the last 31 days', () => {
  const r = pc('custom', undefined, undefined, 1);
  assert.match(r.sql, /NOW\(\) - INTERVAL '31 days'/);
  assert.deepEqual(r.args, []);
});

test('custom with only to: 31 days before that bound', () => {
  const r = pc('custom', undefined, '2026-09-21T00:00:00Z', 1);
  assert.match(r.sql, /\$1::timestamptz - INTERVAL '31 days'/);
  assert.match(r.sql, /<= \$1::timestamptz/);
  assert.deepEqual(r.args, ['2026-09-21T00:00:00Z']);
});

test('custom that already had a lower bound is unchanged', () => {
  assert.equal(pc('custom', 'F', 'T', 3).sql, 'e.event_time >= $3::timestamptz AND e.event_time <= $4::timestamptz');
  assert.equal(pc('custom', 'F', undefined, 1).sql, 'e.event_time >= $1::timestamptz');
  assert.equal(pc('custom', 'F', 'T', 1, 'r.bucket_hour').sql, 'r.bucket_hour >= $1::timestamptz AND r.bucket_hour <= $2::timestamptz');
});

test('other periods do not get the clamp', () => {
  for (const p of ['today', 'hour', 'yesterday', 'week', 'month']) {
    assert.equal(pc(p, 'F', 'T', 1).sql.includes('31 days'), false, p);
  }
});
