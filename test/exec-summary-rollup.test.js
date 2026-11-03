// Vigil Platform — executive summary อ่านชั่วโมงเต็มจาก event_kpi_hourly + ขอบสด (O2 · 2026-10-06)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '..', 'src/stats-summary-route.js'), 'utf8');

test('the three former raw scans read the rollup and keep a live edge', () => {
  for (const name of ['eventsByHour', 'topCameras', 'cameraEventCounts']) {
    const i = s.indexOf(`_t('${name}'`);
    assert.ok(i > 0, name);
    const block = s.slice(i, s.indexOf('`, ', i) + 3);
    assert.match(block, /FROM event_kpi_hourly/, name);
    assert.match(block, /\$\{KPI_LIVE_EDGE\}/, name);
    assert.match(block, /UNION ALL/, name);
  }
});

test('live edge is one full hour behind now (refresher runs every 5 min)', () => {
  assert.match(s, /const KPI_LIVE_EDGE = `\(date_trunc\('hour', NOW\(\)\) - INTERVAL '1 hour'\)`;/);
});
