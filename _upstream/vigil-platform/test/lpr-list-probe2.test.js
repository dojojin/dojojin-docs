// Vigil Platform — GET /api/lpr ด่าน probe ชั้นสอง: "เกินหนึ่งหน้า" ≠ หนาแน่น (2026-10-07)
// เหตุจริง: กล้อง + จังหวัด มี 217 แถวกระจาย 100 วัน → เดินตามเวลา 173 วิ → ผู้ใช้โดน timeout
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = fs.readFileSync(path.join(__dirname, '..', 'src/routes/lpr-list.js'), 'utf8');

test('second probe collects up to PROBE_CAP ids under its own short timeout', () => {
  assert.match(s, /const PROBE_CAP = \d+;/);
  assert.match(s, /const PROBE2_MS = \d+;/);
  assert.match(s, /SET LOCAL statement_timeout = \$\{PROBE2_MS\}/);
  assert.match(s, /LIMIT \$\{PROBE_CAP \+ 1\}/);
  assert.match(s, /if \(p2\.rows\.length <= PROBE_CAP\) ids = p2\.rows;/);
  // เฉพาะกรองจังหวัด และทุกพารามิเตอร์อยู่ในชุดที่ index ตอบได้เอง (กรุงเทพฯ+สีม่วง เคยถดถอย 1.5 → 2.9 วิ)
  assert.match(s, /else if \(\(region \|\| req\.query\.regions\) && Object\.entries\(req\.query\)/);
  assert.match(s, /const PROBE2_KEYS = new Set\(\[/);
  for (const k of ['vehicle_colors', 'vehicle_types', 'helmet', 'belt', 'dup', 'mismatch', 'plate']) {
    assert.doesNotMatch(s.slice(s.indexOf('const PROBE2_KEYS'), s.indexOf(']);', s.indexOf('const PROBE2_KEYS'))), new RegExp(`'${k}'`));
  }
});

test('first probe path is unchanged (cheap LIMIT page+1, complete set when it fits)', () => {
  assert.match(s, /LIMIT \$\{fetchLimit \+ offset\}`,\s*pageArgs\);\s*if \(probe\.rows\.length <= limit \+ offset\) ids = probe\.rows;/);
});
