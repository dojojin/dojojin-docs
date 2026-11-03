// Vigil Platform — refreshCameraBaselines ต้องลบแล้วใส่เป็นสองคำสั่ง (GOTCHAS #217)
// pool ปลอม · lineSender ปลอม (ไม่มีทางส่งจริง) · ไม่แตะ DB/เครือข่าย
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/alert-engine');

test('baseline refresh: DELETE runs as its own statement before the INSERT, inside one transaction', async () => {
  const seen = [];
  const client = {
    query: async (sql) => { seen.push(String(sql).replace(/\s+/g, ' ').trim()); return { rows: [], rowCount: 3 }; },
    release() {},
  };
  await engine._testInit({
    pool: { connect: async () => client, query: client.query },
    lineSender: { sendAlert: async () => { throw new Error('must not send'); }, pushLineMessage: async () => { throw new Error('must not send'); } },
    config: {},
  });
  const n = await engine.refreshCameraBaselines();
  assert.equal(n, 3);
  // 2026-10-06: ลบเฉพาะกล้องที่ไม่อยู่ในระบบแล้ว (คงฐานของกล้องที่เงียบ) + INSERT … ON CONFLICT
  const del = seen.findIndex((s) => s.startsWith('DELETE FROM camera_event_baseline b WHERE NOT EXISTS'));
  const ins = seen.findIndex((s) => /INSERT INTO camera_event_baseline/.test(s));
  assert.ok(seen[0] === 'BEGIN', seen.join('\n'));
  assert.ok(del > 0 && ins > del, seen.join('\n'));
  assert.ok(!seen.some((s) => /wipe AS \(DELETE/.test(s)), 'no data-modifying CTE in the INSERT');
  assert.match(seen[ins], /ON CONFLICT \(camera_id\) DO UPDATE/);
  assert.equal(seen[seen.length - 1], 'COMMIT');
});
