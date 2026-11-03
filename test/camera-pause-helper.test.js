// ============================================================
// Vigil Platform — Tests: helpers/cameraPause (setCamerasPaused)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// pool/config เป็น stub — ไม่แตะ DB หรือ cameras-config.json จริง
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { setCamerasPaused } = require('../src/helpers/cameraPause');

function make(rowsForUpdate) {
  const q = [];
  const pool = {
    query: async (sql, args) => {
      q.push({ sql, args });
      if (/^\s*UPDATE cameras SET paused=/.test(sql)) return { rows: rowsForUpdate };
      return { rows: [], rowCount: 1 };
    },
  };
  const cfg = { cameras: [{ camera_id: 'A' }, { camera_id: 'B' }, { camera_id: 'Z' }] };
  const saves = [];
  let loads = 0;
  return {
    q, pool, cfg, saves,
    loads: () => loads,
    loadCameraConfig: () => { loads++; return cfg; },
    saveCameraConfig: (c) => { saves.push(JSON.parse(JSON.stringify(c))); return true; },
  };
}
const user = { id: 3, username: 'admin' };

describe('setCamerasPaused', () => {
  it('pause bySite → paused_by_site=true · config เขียนครั้งเดียว · log+audit ต่อกล้อง', async () => {
    const m = make([{ id: 'A', enabled: true }, { id: 'B', enabled: false }]);
    const rows = await setCamerasPaused(m.pool, {
      cameraIds: ['A', 'B'], paused: true, bySite: true, reason: 'site maintenance', user,
      loadCameraConfig: m.loadCameraConfig, saveCameraConfig: m.saveCameraConfig,
    });
    assert.equal(rows.length, 2);
    const upd = m.q.find(x => /UPDATE cameras SET paused=TRUE/.test(x.sql));
    assert.deepEqual(upd.args, [['A', 'B'], true]);
    assert.ok(!m.q.some(x => /last_seen_at/.test(x.sql)), 'pause ไม่แตะ last_seen_at');
    assert.equal(m.loads(), 1);
    assert.equal(m.saves.length, 1);
    assert.deepEqual(m.saves[0].cameras.map(c => c.paused), [true, true, undefined]);
    const logs = m.q.filter(x => /INSERT INTO camera_status_log/.test(x.sql));
    assert.deepEqual(logs.map(x => x.args), [['A', 'paused', 'site maintenance'], ['B', 'paused', 'site maintenance']]);
    const audits = m.q.filter(x => /INSERT INTO audit_log/.test(x.sql));
    assert.equal(audits.length, 2);
    assert.equal(audits[0].args[2], 'camera_pause');
    assert.deepEqual(JSON.parse(audits[0].args[4]), { paused: true, by_site: true });
  });

  it('manual pause (bySite ไม่ส่ง) → paused_by_site=false และ audit ไม่มี by_site', async () => {
    const m = make([{ id: 'A', enabled: true }]);
    await setCamerasPaused(m.pool, {
      cameraIds: ['A'], paused: true, reason: 'operator paused (maintenance)', user,
      loadCameraConfig: m.loadCameraConfig, saveCameraConfig: m.saveCameraConfig,
    });
    assert.deepEqual(m.q.find(x => /UPDATE cameras SET paused=TRUE/.test(x.sql)).args, [['A'], false]);
    const a = m.q.find(x => /INSERT INTO audit_log/.test(x.sql));
    assert.deepEqual(JSON.parse(a.args[4]), { paused: true });
  });

  it('resume → เคลียร์ paused_by_site · stamp last_seen_at เฉพาะกล้องที่ enabled', async () => {
    const m = make([{ id: 'A', enabled: true }, { id: 'B', enabled: false }]);
    await setCamerasPaused(m.pool, {
      cameraIds: ['A', 'B'], paused: false, reason: 'operator resumed', user,
      loadCameraConfig: m.loadCameraConfig, saveCameraConfig: m.saveCameraConfig,
    });
    assert.match(m.q.find(x => /UPDATE cameras SET paused=FALSE/.test(x.sql)).sql, /paused_by_site=FALSE/);
    const stamp = m.q.filter(x => /last_seen_at=NOW\(\)/.test(x.sql));
    assert.equal(stamp.length, 1);
    assert.deepEqual(stamp[0].args, [['A']]);
    assert.equal(m.saves.length, 1);
    assert.deepEqual(m.saves[0].cameras.map(c => c.paused), [false, false, undefined]);
    assert.equal(m.q.find(x => /INSERT INTO audit_log/.test(x.sql)).args[2], 'camera_resume');
  });

  it('ไม่พบกล้อง → คืน [] ไม่เขียน config/log', async () => {
    const m = make([]);
    const rows = await setCamerasPaused(m.pool, {
      cameraIds: ['nope'], paused: true, reason: 'x', user,
      loadCameraConfig: m.loadCameraConfig, saveCameraConfig: m.saveCameraConfig,
    });
    assert.deepEqual(rows, []);
    assert.equal(m.saves.length, 0);
    assert.equal(m.q.length, 1);
  });

  it('cameraIds ว่าง → ไม่ยิง SQL เลย', async () => {
    const m = make([]);
    await setCamerasPaused(m.pool, { cameraIds: [], paused: true, reason: 'x', user,
      loadCameraConfig: m.loadCameraConfig, saveCameraConfig: m.saveCameraConfig });
    assert.equal(m.q.length, 0);
  });
});
