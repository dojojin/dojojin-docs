// Vigil Platform — freeze-big-tables (ระดับ source/const · ไม่ต่อ DB)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const f = require('../scripts/freeze-big-tables');
const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'freeze-big-tables.js'), 'utf8');

test('candidate query covers tables+matviews and the toast age', () => {
  assert.ok(f.CANDIDATES_SQL.includes("relkind IN ('r', 'm')"));
  assert.ok(f.CANDIDATES_SQL.includes('reltoastrelid'));
  assert.equal(f.MIN_BYTES, 1073741824);
  assert.equal(f.MIN_AGE, 50000000);
});

test('vacuum is PARALLEL 0 (DSM vs 1 GB /dev/shm), 512MB, stops before backup', () => {
  for (const s of ['PARALLEL 0', 'maintenance_work_mem=512MB', "'02:50'", 'application_name=maint_freeze']) {
    assert.ok(src.includes(s), s);
  }
});
