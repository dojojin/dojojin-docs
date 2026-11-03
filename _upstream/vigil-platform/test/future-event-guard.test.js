// Vigil Platform — ตัววัดสุขภาพและ feed สดต้องไม่เชื่อ event เวลาอนาคต (GOTCHAS #217)
// เหตุจริง 2026-09-15: กล้องนาฬิกาเพี้ยนส่ง event ปี 2032 → MAX(event_time) ติดอนาคต → Health เขียวตลอด
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Health liveness probe ignores future-dated events', () => {
  const s = read('src/routes/health.js');
  assert.match(s, /SELECT MAX\(event_time\) AS last FROM events WHERE event_time <= now\(\) \+ interval '5 minutes'/);
  assert.doesNotMatch(s, /SELECT MAX\(event_time\) AS last FROM events`/);
  assert.match(s, /future_events/);
});

test('summary live feed ignores future-dated events', () => {
  const s = read('src/stats-summary-route.js');
  const i = s.indexOf("_t('recentEvents'");
  const block = s.slice(i, s.indexOf('LIMIT 8', i));
  assert.match(block, /event_time <= now\(\) \+ interval '5 minutes'/);
});

test('other latest-event readers are bounded above too', () => {
  const G = /event_time <= now\(\) \+ interval '5 minutes'/;
  assert.match(read('src/routes/devices.js'), G);
  assert.match(read('src/routes/stats-core.js'), G);
  const hr = read('src/routes/health-reporting.js');
  assert.equal((hr.match(/e\.event_time <= now\(\) \+ interval '5 minutes'/g) || []).length, 2);
  assert.doesNotMatch(hr, /MAX\(event_time\) AS last_event_at/);
});
