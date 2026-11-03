// Vigil Platform — quick wins ชุด 1B (audit 2026-10-02): query ที่เขียนใหม่ต้องคงรูปแบบที่วัดแล้วว่าเร็วและผลเท่าเดิม
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('quiet-cameras uses NOT EXISTS instead of counting every event (O7)', () => {
  const s = rd('src/routes/stats.js');
  const i = s.indexOf("app.get('/api/stats/quiet-cameras'");
  const body = s.slice(i, s.indexOf('routeError(res, err', i));
  assert.match(body, /AND NOT EXISTS \(\s*SELECT 1 FROM events e/);
  assert.doesNotMatch(body, /COUNT\(\*\) AS cnt/);
});

test('facets: vehicle_type from event_dim_bucket, timeout inside a real transaction (O9, D11)', () => {
  const s = rd('src/routes/events.js');
  const i = s.indexOf('SET LOCAL statement_timeout');
  assert.ok(i > 0);
  assert.match(s.slice(i - 200, i), /client\.query\('BEGIN'\)/);
  assert.match(s, /SELECT DISTINCT vehicle_type AS v FROM event_dim_bucket\$\{where\}/);
  assert.doesNotMatch(s, /SELECT DISTINCT lp\.vehicle_type AS v FROM license_plates/);
});

test('executive summary serves stale while revalidating (O2)', () => {
  assert.match(rd('src/stats-summary-route.js'), /staleWhileRevalidate: true/);
});
