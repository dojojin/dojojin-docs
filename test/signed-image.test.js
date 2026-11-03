// ============================================================
// Vigil Platform — Tests: ลิงก์ภาพเซ็นชื่อสำหรับ LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ลิงก์นี้เปิดได้โดยไม่ต้อง login (LINE เป็นคนมาดึง ไม่มี cookie ของเรา) สิ่งเดียว
// ที่กันคือลายเซ็นกับวันหมดอายุ — ถ้าสองอย่างนี้พลาด = ภาพใบหน้า/ป้ายทะเบียนหลุด
// เทสต์ชุดนี้จึงเน้นเคสโจมตี ไม่ใช่เคสปกติ

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const signed = require('../src/helpers/signedImage');

const OLD = { base: process.env.DASHBOARD_PUBLIC_URL, sec: process.env.SNAPSHOT_PROXY_SECRET };
before(() => {
  process.env.DASHBOARD_PUBLIC_URL = 'https://dash.example.com';
  process.env.SNAPSHOT_PROXY_SECRET = 'test-secret-for-unit-tests-only';
});
after(() => {
  if (OLD.base === undefined) delete process.env.DASHBOARD_PUBLIC_URL; else process.env.DASHBOARD_PUBLIC_URL = OLD.base;
  if (OLD.sec === undefined) delete process.env.SNAPSHOT_PROXY_SECRET; else process.env.SNAPSHOT_PROXY_SECRET = OLD.sec;
});

const FILE = 'face/2026-08-12/C45/0400/abc.jpg';
const parse = (url) => {
  const u = new URL(url);
  return { path: decodeURIComponent(u.pathname.replace('/pub/img/', '')),
           exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') };
};

describe('signedImageUrl', () => {
  it('สร้าง URL ที่ verify ผ่าน', () => {
    const p = parse(signed.signedImageUrl(FILE, 3600));
    assert.equal(p.path, FILE);
    assert.equal(signed.verifySignedRequest(p.path, p.exp, p.sig).ok, true);
  });

  it('ยังไม่ตั้งค่า → คืน null (ผู้เรียกจะตกไปใช้ imgbb ไม่ใช่ส่งลิงก์พัง)', () => {
    const keep = process.env.DASHBOARD_PUBLIC_URL;
    delete process.env.DASHBOARD_PUBLIC_URL;
    assert.equal(signed.signedImageUrl(FILE, 3600), null);
    process.env.DASHBOARD_PUBLIC_URL = keep;
  });
});

describe('verifySignedRequest — เคสโจมตี', () => {
  const fresh = () => parse(signed.signedImageUrl(FILE, 3600));

  it('เปลี่ยน path แต่ใช้ลายเซ็นเดิม → 403', () => {
    const p = fresh();
    const r = signed.verifySignedRequest('face/2026-08-12/C45/0400/OTHER.jpg', p.exp, p.sig);
    assert.equal(r.ok, false); assert.equal(r.status, 403);
  });

  it('ยืดวันหมดอายุเอง → 403 (ลายเซ็นผูกกับ exp ด้วย)', () => {
    const p = fresh();
    const r = signed.verifySignedRequest(p.path, Number(p.exp) + 86400, p.sig);
    assert.equal(r.ok, false); assert.equal(r.status, 403);
  });

  it('ลิงก์หมดอายุ → 410 ไม่ใช่ 403 (คนละสาเหตุ ต้องแยกออกจากกันตอนไล่ปัญหา)', () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const r = signed.verifySignedRequest(FILE, exp, signed.sign(FILE, exp));
    assert.equal(r.ok, false); assert.equal(r.status, 410);
  });

  it('ไม่มีลายเซ็น / ลายเซ็นสั้นยาวไม่เท่า → 403 ไม่ใช่ throw', () => {
    const p = fresh();
    assert.equal(signed.verifySignedRequest(p.path, p.exp, '').status, 403);
    assert.equal(signed.verifySignedRequest(p.path, p.exp, 'x').status, 403);
    assert.equal(signed.verifySignedRequest(p.path, p.exp, p.sig + 'x').status, 403);
  });

  it('เปลี่ยนกุญแจ → ลายเซ็นเดิมใช้ไม่ได้ (หมุนกุญแจแล้วลิงก์เก่าตายทันที)', () => {
    const p = fresh();
    const keep = process.env.SNAPSHOT_PROXY_SECRET;
    process.env.SNAPSHOT_PROXY_SECRET = 'different-secret';
    assert.equal(signed.verifySignedRequest(p.path, p.exp, p.sig).ok, false);
    process.env.SNAPSHOT_PROXY_SECRET = keep;
  });

  it('ไม่มีกุญแจเลย → 503 ไม่ใช่ปล่อยผ่าน', () => {
    const p = fresh();
    const keep = process.env.SNAPSHOT_PROXY_SECRET;
    delete process.env.SNAPSHOT_PROXY_SECRET;
    const r = signed.verifySignedRequest(p.path, p.exp, p.sig);
    assert.equal(r.ok, false); assert.equal(r.status, 503);
    process.env.SNAPSHOT_PROXY_SECRET = keep;
  });
});

describe('แยกชนิด img / ref — ลิงก์ข้ามโฟลเดอร์กันไม่ได้', () => {
  it('ลิงก์ ref ชี้ไป /pub/ref/ และ verify ด้วย kind ref เท่านั้น', () => {
    const url = signed.signedImageUrl('14/face_6_2410.jpg', 3600, 'ref');
    assert.match(url, /\/pub\/ref\//);
    const u = new URL(url);
    const rel = decodeURIComponent(u.pathname.replace('/pub/ref/', ''));
    const exp = u.searchParams.get('exp'), sig = u.searchParams.get('sig');
    assert.equal(signed.verifySignedRequest(rel, exp, sig, 'ref').ok, true);
    // ลายเซ็นของ ref ต้องใช้กับเส้นทาง img ไม่ได้ — ไม่งั้นเอาลิงก์ภาพอ้างอิง
    // ไปอ่านไฟล์ใน snapshots ได้โดยแค่เปลี่ยน path บน URL
    assert.equal(signed.verifySignedRequest(rel, exp, sig, 'img').ok, false);
  });

  it('ชนิดที่ไม่รู้จัก → null ไม่ใช่ลิงก์ที่ชี้ไปไหนก็ไม่รู้', () => {
    assert.equal(signed.signedImageUrl('x.jpg', 60, '../etc'), null);
  });
});
