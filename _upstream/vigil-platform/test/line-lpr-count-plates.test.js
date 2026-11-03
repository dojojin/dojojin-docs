// Vigil Platform — LINE "ยอดอ่านป้าย": part=kpi ไม่มี unique แล้ว ต้องขอจาก part=plates (2026-10-06)
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SOURCES } = require('../src/line-answer-sources');

describe('lpr_count unique comes from part=plates', () => {
  const now = new Date('2026-10-06T08:00:00Z');
  it('asks kpi and plates in parallel and merges unique', async () => {
    const seen = [];
    const call = async (path, q) => { seen.push(q.part); return { ok: true, body: q.part === 'plates' ? { unique: 263246, local: 1 } : { total: 781696, noread: 9376, vehicles: 791072 } }; };
    const out = await SOURCES.lpr_count.fetchAll({ call, slots: {}, now });
    assert.deepEqual(seen.sort(), ['kpi', 'plates']);
    assert.equal(out.body.unique, 263246);
    assert.equal(out.body.total, 781696);
    const card = SOURCES.lpr_count.format(out.body, {});
    assert.deepEqual(card.rows.find((r) => r[0] === 'ป้ายไม่ซ้ำ'), ['ป้ายไม่ซ้ำ', '263,246']);
  });
  it('plates failing shows "-" not a fake 0', async () => {
    const call = async (path, q) => (q.part === 'plates' ? { ok: false, status: 503 } : { ok: true, body: { total: 5, noread: 0, vehicles: 5 } });
    const out = await SOURCES.lpr_count.fetchAll({ call, slots: {}, now });
    const card = SOURCES.lpr_count.format(out.body, {});
    assert.deepEqual(card.rows.find((r) => r[0] === 'ป้ายไม่ซ้ำ'), ['ป้ายไม่ซ้ำ', '-']);
  });
});
