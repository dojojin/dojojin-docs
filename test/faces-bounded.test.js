// Vigil Platform — /api/faces ภาพรวม และ /faces/summary ต้องมีขอบเวลาเสมอ (D8 · 2026-10-03)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '..', 'src/routes/faces.js'), 'utf8');

test('grouped overview asks the 7-day rollup first and bounds the scan to 7 days', () => {
  assert.match(s, /if \(grouped && !req\.query\.from && !req\.query\.to\) \{/);
  assert.match(s, /FROM event_kpi_hourly WHERE \$\{kw\.join\(' AND '\)\} \$\{ksw\.sql\} LIMIT 1/);
  assert.match(s, /if \(!any\.rows\.length\) return res\.json\(\[\]\);\s*\n\s*f\.where \+= ` AND event_time >= NOW\(\) - INTERVAL '7 days'`;/);
});

test('summary without a range defaults to the same 24 h as the list', () => {
  const i = s.indexOf("app.get('/api/faces/summary'");
  assert.ok(i > 0);
  assert.match(s.slice(i, i + 1200), /if \(!req\.query\.from && !req\.query\.to\) f\.where \+= ` AND event_time >= NOW\(\) - INTERVAL '24 hours'`;/);
});
