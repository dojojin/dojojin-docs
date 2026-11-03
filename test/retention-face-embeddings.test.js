// Vigil Platform — retention ต้องลบเวกเตอร์ใบหน้าและคิวของมันด้วยขอบเวลาเดียวกับ events
// pool ปลอม · ไม่แตะ DB/ไฟล์จริง · ดึง enforceRetention จาก timer ที่ start() ตั้งไว้
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');

test('daily retention deletes face_embeddings and face_embed_queue older than data_retention_days', async () => {
  const sqls = []; const failures = [];
  const pool = { query: async (sql, args) => { sqls.push({ sql: String(sql).replace(/\s+/g, ' '), args }); return { rows: [], rowCount: 0 }; } };
  const realST = global.setTimeout, realSI = global.setInterval;
  const scheduled = new Map();
  global.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { scheduled.set(ms, fn); return { unref() {} }; } return realST(fn, ms, ...a); };
  global.setInterval = () => ({ unref() {} });
  try {
    const dir = os.tmpdir();
    require('../src/jobs/retention').start({
      pool, getSystemSetting: async (_p, k) => (k === 'data_retention_days' ? '100' : null),
      retentionBeat: { beat() {}, beatFail(...a) { failures.push(a); } },
      SNAPSHOT_DIR: dir, THUMBS_DIR: dir, BBOX_CACHE_DIR: dir, MEDIA_DIR: dir, REPORTS_DIR: dir, FILES_DIR: dir,
    });
    const enforceRetention = scheduled.get(300 * 1000);
    assert.equal(typeof enforceRetention, 'function');
    const t0 = Date.now();
    await enforceRetention();
    const want = (t) => sqls.find((s) => s.sql.startsWith(`DELETE FROM ${t} WHERE id IN`));
    for (const t of ['face_embeddings', 'face_embed_queue']) {
      const s = want(t);
      assert.ok(s, `${t} delete missing`);
      assert.match(s.sql, /event_time < \$1/);
      const cutoff = new Date(s.args[0]).getTime();
      assert.ok(Math.abs(t0 - 100 * 86400_000 - cutoff) < 60_000, 'same 100-day cutoff as events');
    }
    assert.deepEqual(failures, [], 'enforceRetention must not fail');
  } finally { global.setTimeout = realST; global.setInterval = realSI; }
});
