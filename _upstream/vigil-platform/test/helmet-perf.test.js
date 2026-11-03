// Vigil Platform — หน้าอันดับ/สถิติหมวกต้องไม่คิดซ้ำ (O5 · 2026-10-03)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const helmet = require('../src/helpers/helmetCriteria');

test('d3/d5/d7 have their own TTL, not the 60 s default', () => {
  for (const p of ['d3', 'd5', 'd7']) assert.equal(helmet.ttlFor(p), 300_000, p);
});

test('helmet-series hourly uses an index-friendly range, today part is cached by exact scope', () => {
  const s = rd('src/routes/traffic.js');
  assert.doesNotMatch(s, /\(t\.bucket_hour AT TIME ZONE '\$\{TZ\}'\)::date = \$2::date/);
  assert.match(s, /SERIES_TODAY\.wrap\(JSON\.stringify\(\[scope3\.sql, scope3\.params\]\)/);
});

test('helmet-top report.pdf fetches images concurrently', () => {
  const s = rd('src/routes/traffic-report-pdf.js');
  assert.doesNotMatch(s, /for \(const r of rows\) \{\s*r\.sceneB64 = await grab/);
  assert.match(s, /Array\.from\(\{ length: 4 \}, worker\)/);
});
