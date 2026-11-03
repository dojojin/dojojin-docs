// ============================================================
// Vigil Platform — Tests: helpers/renderViaWorker
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ปุ่มดาวน์โหลดรายงานต้องทำงานได้แม้ report-worker ล่ม — เทสต์นี้คุมทางตกกลับ
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/helpers/renderViaWorker');

// ห้าม require report-renderer ของจริง (มัน require puppeteer ตั้งแต่บรรทัดบน)
// จึงฉีด renderer ปลอมเข้าไปทาง deps ทุกครั้ง
function stubs(fetchImpl) {
  const calls = { fetch: 0, inProcess: 0 };
  return {
    calls,
    deps: {
      fetchImpl: async (...a) => { calls.fetch++; return fetchImpl(...a); },
      renderer: {
        renderReportPdf: async () => { calls.inProcess++; return Buffer.from('in-process'); },
      },
    },
  };
}

const ok = async () => ({
  ok: true, status: 200,
  arrayBuffer: async () => Uint8Array.from(Buffer.from('from-worker')).buffer,
});

let savedSecret, savedSwitch;
beforeEach(() => {
  savedSecret = process.env.INTERNAL_API_SECRET;
  savedSwitch = process.env.REPORT_RENDER_VIA_WORKER;
  process.env.INTERNAL_API_SECRET = 'x'.repeat(48);
  delete process.env.REPORT_RENDER_VIA_WORKER;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = savedSecret;
  if (savedSwitch === undefined) delete process.env.REPORT_RENDER_VIA_WORKER;
  else process.env.REPORT_RENDER_VIA_WORKER = savedSwitch;
});

describe('renderViaWorker.render', () => {
  it('worker ตอบ 200 → ใช้ bytes จาก worker ไม่เรนเดอร์ในโปรเซส', async () => {
    const s = stubs(ok);
    const buf = await render('renderReportPdf', { a: 1 }, s.deps);
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.toString(), 'from-worker');
    assert.equal(s.calls.fetch, 1);
    assert.equal(s.calls.inProcess, 0);
  });

  it('worker ต่อไม่ติด (ECONNREFUSED) → ตกกลับมาเรนเดอร์ในโปรเซสครั้งเดียว', async () => {
    const s = stubs(async () => { throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }); });
    const buf = await render('renderReportPdf', {}, s.deps);
    assert.equal(buf.toString(), 'in-process');
    assert.equal(s.calls.fetch, 1);
    assert.equal(s.calls.inProcess, 1);
  });

  it('timeout (DOMException ไม่มี .code) → ตกกลับเหมือนกัน', async () => {
    // AbortSignal.timeout โยน TimeoutError ที่ไม่มี err.code — โค้ดต้องไม่แยกตาม code
    const s = stubs(async () => { throw new DOMException('signal timed out', 'TimeoutError'); });
    const buf = await render('renderReportPdf', {}, s.deps);
    assert.equal(buf.toString(), 'in-process');
    assert.equal(s.calls.inProcess, 1);
  });

  it('worker ตอบ non-2xx → ตกกลับ', async () => {
    const s = stubs(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }));
    const buf = await render('renderReportPdf', {}, s.deps);
    assert.equal(buf.toString(), 'in-process');
    assert.equal(s.calls.inProcess, 1);
  });

  it('fn นอก allowlist → reject ก่อนเรียกอะไรทั้งสิ้น', async () => {
    const s = stubs(ok);
    await assert.rejects(() => render('process', {}, s.deps), /allowlist/);
    assert.equal(s.calls.fetch, 0);
    assert.equal(s.calls.inProcess, 0);
  });

  it('REPORT_RENDER_VIA_WORKER=0 → ข้าม worker ไปเรนเดอร์ในโปรเซสเลย', async () => {
    process.env.REPORT_RENDER_VIA_WORKER = '0';
    const s = stubs(ok);
    const buf = await render('renderReportPdf', {}, s.deps);
    assert.equal(buf.toString(), 'in-process');
    assert.equal(s.calls.fetch, 0);
  });

  it('ไม่มี INTERNAL_API_SECRET → ไม่ยิงคำขอที่รู้ว่าจะโดน 401', async () => {
    delete process.env.INTERNAL_API_SECRET;
    const s = stubs(ok);
    const buf = await render('renderReportPdf', {}, s.deps);
    assert.equal(buf.toString(), 'in-process');
    assert.equal(s.calls.fetch, 0);
  });
});
