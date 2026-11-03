// Vigil Platform — หน้า Health ต้องมีสัญญาณของบั๊กเงียบ 4 ประเภท (GOTCHAS #217 · แผนป้องกัน)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('/api/health/details returns the integrity block', () => {
  const s = rd('src/routes/health.js');
  for (const k of ['future_events', 'baseline_computed_at', 'baseline_stale', 'ws_bridge_connected', 'cameras_stuck_offline', 'disk_io_errors_24h', 'unknown_push_tokens']) {
    assert.match(s, new RegExp(`${k}:`), k);
  }
  assert.match(s, /26 \* 3600_000/, 'baseline stale after 26 h');
});

test('api-server exposes the ws-bridge LISTEN handle to health', () => {
  assert.match(rd('src/api-server.js'), /app\.locals\.wsBridgeListen = listenForever\(/);
});

test('Health page renders the integrity card', () => {
  const s = rd('dashboard/page-health.js');
  assert.match(s, /h\.integrity/);
  assert.match(s, /I18N\.t\('hlth\.integrity'/);
});

test('unknown push tokens are read from lpr-receiver too (where /face-push actually lands)', () => {
  assert.match(rd('src/lpr-receiver.js'), /unknown_push_tokens: require\('\.\/helpers\/unknownTokenLog'\)\.lastWindows\(\)/);
  assert.match(rd('src/routes/health.js'), /LPR_RECEIVER_PORT'\)\}\/healthz/);
});

test('snapshot walk is cached 10 min with stale-while-revalidate (O10)', () => {
  assert.match(rd('src/routes/health.js'),
    /_healthCache\.wrap\('snapshot_stats',\s*\n?\s*\(\) => _snapshotStats\(SNAPSHOT_DIR\), \{ ttlMs: 10 \* 60_000, staleWhileRevalidate: true \}\)/);
});

// preventive P3 (2026-10-06): การ์ดสุขภาพฐานข้อมูล อ่านผลยามรายวัน + ขนาด/อัตราโต
test('health returns db_health from the perf watch, cached, with disk days left', () => {
  const s = rd('src/routes/health.js');
  assert.match(s, /result\.db_health = await _healthCache\.wrap\('db_health', \(\) => _dbHealth\(pool\)/);
  for (const k of ['checked_day', 'db_gb', 'growth_gb_per_day', 'slow_req', 'regressions', 'fresh', 'stale_tables', 'unused_indexes'])
    assert.match(s, new RegExp(`${k}:`), k);
  assert.match(s, /disk_days_left = g > 0 && free != null \? Math\.floor\(free \/ g\) : null/);
  assert.match(rd('src/helpers/perfWatch.js'), /db_history: dbHistory/);
});

test('Health page renders the database health card (th + en keys)', () => {
  assert.match(rd('dashboard/page-health.js'), /I18N\.t\('hlth\.dbHealth'/);
  const i18n = rd('dashboard/i18n.js');
  assert.equal((i18n.match(/'hlth\.dbHealth':/g) || []).length, 2);
});

// ตรวจ 31 ต.ค.: กล้องที่ pause ถูกนับเป็น offline ทั้งหน้า Health และคำสั่ง LINE
test('health cameras block treats paused as its own status, not offline', () => {
  const s = rd('src/routes/health.js');
  assert.match(s, /SELECT id, name, ip_address, last_seen_at, paused,/);
  assert.match(s, /db\.paused \? 'paused'/);
  assert.match(s, /result\.cameras\.offline = total - online - paused;/);
  assert.match(s, /result\.cameras\.paused = paused;/);
});
