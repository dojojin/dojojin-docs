// ============================================================
// Vigil Platform — Tests: LPR no-read self-check (noreadCheck)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ยามตัวนี้รันสัปดาห์ละครั้ง — บั๊กในตัวจับเวลาจึงใช้เวลาเป็นสัปดาห์กว่าจะโผล่
// เทสต์จึงตรวจ "เวลาที่ลงจอดจริง" ไม่ใช่แค่ว่า delay อยู่ในช่วงที่สมเหตุสมผล
// (0 < delay <= 1 สัปดาห์ ผ่านได้แม้ฟังก์ชันพัง)

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { nextRunDelayMs, compare } = require('../src/helpers/noreadCheck');

// เวลาไทยของ instant หนึ่ง ในรูป "Sun 04:30" ไว้เทียบตรง ๆ
const bkk = (d) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Bangkok', weekday: 'short',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).format(d);

const landing = (isoNow) => {
  const now = new Date(isoNow);
  return bkk(new Date(now.getTime() + nextRunDelayMs(now, {})));
};

describe('nextRunDelayMs — อาทิตย์ 04:30 เวลาไทย', () => {
  // 2026-09-06 คือวันอาทิตย์ · UTC+7 ⇒ 04:30 ไทย = 21:30Z ของวันเสาร์
  it('กลางสัปดาห์ (พุธ) → ลงจอดอาทิตย์ 04:30', () => {
    assert.equal(landing('2026-09-02T10:00:00Z'), 'Sun 04:30:00');
  });

  it('ก่อนถึงเวลาไม่กี่นาทีของวันอาทิตย์เอง → ลงจอดอาทิตย์นี้ ไม่ใช่อาทิตย์หน้า', () => {
    const now = new Date('2026-09-05T21:00:00Z');           // อาทิตย์ 04:00 ไทย
    assert.equal(bkk(now), 'Sun 04:00:00');
    assert.equal(nextRunDelayMs(now, {}), 30 * 60_000);     // อีก 30 นาทีพอดี
  });

  it('เลยเวลามาแล้วในวันอาทิตย์ → ข้ามไปอาทิตย์หน้า ไม่ใช่ยิงย้อนหลัง', () => {
    const now = new Date('2026-09-05T22:00:00Z');           // อาทิตย์ 05:00 ไทย
    assert.equal(bkk(now), 'Sun 05:00:00');
    const delay = nextRunDelayMs(now, {});
    assert.equal(delay, 7 * 24 * 3600_000 - 30 * 60_000);
    assert.equal(bkk(new Date(now.getTime() + delay)), 'Sun 04:30:00');
  });

  it('ข้ามขอบเดือน (จันทร์ 31 ส.ค. → อาทิตย์ 6 ก.ย.)', () => {
    const now = new Date('2026-08-31T03:00:00Z');           // จันทร์ 10:00 ไทย
    assert.equal(bkk(now), 'Mon 10:00:00');
    const at = new Date(now.getTime() + nextRunDelayMs(now, {}));
    assert.equal(bkk(at), 'Sun 04:30:00');
    assert.equal(at.toISOString(), '2026-09-05T21:30:00.000Z');
  });

  it('ตรงเวลาเป๊ะ → รออีกหนึ่งสัปดาห์เต็ม ไม่ใช่ 0 (กันยิงซ้ำตอน timer ตื่นพอดี)', () => {
    const now = new Date('2026-09-05T21:30:00.000Z');
    assert.equal(bkk(now), 'Sun 04:30:00');
    assert.equal(nextRunDelayMs(now, {}), 7 * 24 * 3600_000);
  });

  it('ทุก instant ตลอด 1 สัปดาห์ (ทีละ 37 นาที) ลงจอดที่อาทิตย์ 04:30 เสมอ', () => {
    const t0 = Date.parse('2026-09-01T00:00:00Z');
    for (let m = 0; m < 7 * 24 * 60; m += 37) {
      const now = new Date(t0 + m * 60_000);
      assert.equal(bkk(new Date(now.getTime() + nextRunDelayMs(now, {}))), 'Sun 04:30:00',
        `พลาดที่ ${now.toISOString()}`);
    }
  });
});

// pool ปลอม: compare() ใช้ client จาก pool.connect() (SET LOCAL ต้องมี transaction)
// สเปกเดิมให้ stub แค่ { query } — เพิ่ม connect() ที่คืน client ตัวเดียวกันแทนที่จะ
// ใส่ if (pool.connect) ลงในโค้ดจริง เพราะนั่นคือ branch ที่มีไว้รับใช้เทสต์เท่านั้น
const fakePool = (row) => {
  const query = async () => ({ rows: [row] });
  return { query, connect: async () => ({ query, release() {} }) };
};

describe('compare — รูปร่างผลลัพธ์', () => {
  it('ตรงกัน → ตัวเลขเป็น integer และ mismatch = 0', async () => {
    const r = await compare(fakePool({ predicate: '5', anti_join: '5', mismatch: '0' }));
    assert.deepEqual(r, { predicate: 5, anti_join: 5, mismatch: 0 });
    assert.equal(r.mismatch === 0, true);
  });

  it('ไม่ตรงกัน → mismatch > 0 ถึงแม้ยอดรวมสองฝั่งจะเท่ากัน (เหตุผลที่ต้องนับสองทาง)', async () => {
    const r = await compare(fakePool({ predicate: '7', anti_join: '7', mismatch: '2' }));
    assert.deepEqual(r, { predicate: 7, anti_join: 7, mismatch: 2 });
    assert.equal(r.mismatch === 0, false);
  });

  it('DB ไม่คืนแถว → 0 ทั้งหมด ไม่ใช่ NaN', async () => {
    const query = async () => ({ rows: [] });
    const pool = { query, connect: async () => ({ query, release() {} }) };
    assert.deepEqual(await compare(pool), { predicate: 0, anti_join: 0, mismatch: 0 });
  });

  it('คืน client เข้า pool เสมอแม้ query จะพัง', async () => {
    let released = 0;
    const pool = {
      connect: async () => ({
        query: async (sql) => {
          if (sql.includes('license_plates')) throw new Error('boom');
          return { rows: [] };
        },
        release() { released++; },
      }),
    };
    await assert.rejects(() => compare(pool), /boom/);
    assert.equal(released, 1);
  });
});
