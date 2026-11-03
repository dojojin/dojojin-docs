// ============================================================
// Vigil Platform — Tests: ลิงก์ภาพผลค้นหาอัจฉริยะที่ส่งเข้า LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ภาพของ AcuSeek ไม่ใช่ไฟล์บนดิสก์ แต่เป็น URL ภายในที่ **มี token ของเครื่องเก็บภาพ
// อยู่ในตัว** และข้อความ LINE ค้างอยู่ในเครื่องของทุกคนในห้อง ⇒ ห้ามอ่านออก
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.SNAPSHOT_PROXY_SECRET = process.env.SNAPSHOT_PROXY_SECRET || 'test-secret-for-seal';
process.env.DASHBOARD_PUBLIC_URL = process.env.DASHBOARD_PUBLIC_URL || 'https://example.test';
const si = require('../src/helpers/signedImage');

const URL_IN = 'http://10.0.10.12:6120/isapiHikStor?id=abc&len=1&token=deadbeefsecret&PoolID=1';

describe('ลิงก์ภาพผลค้นหา (kind=seek)', () => {
  it('ปิดผนึกแล้วต้องอ่าน token ไม่ออก และเปิดกลับได้ตรงตัวเดิม', () => {
    const blob = si.sealUrl(URL_IN);
    assert.ok(!blob.includes('deadbeefsecret'), 'token ห้ามอ่านออกจากก้อนที่ส่งไป LINE');
    assert.ok(!blob.includes('10.0.10'), 'ไอพีภายในก็ห้ามอ่านออก');
    assert.equal(si.openUrl(blob), URL_IN);
  });

  it('ก้อนที่ถูกแก้แม้ตัวอักษรเดียว ต้องเปิดไม่ออก (AES-GCM ไม่ใช่แค่ base64)', () => {
    const blob = si.sealUrl(URL_IN);
    assert.equal(si.openUrl(blob.slice(0, -2) + 'AA'), null);
    assert.equal(si.openUrl('ไม่ใช่ก้อนเลย'), null);
  });

  it('ลายเซ็นผูกกับ kind — เอาลิงก์ seek ไปใช้เป็น img ไม่ได้', () => {
    const blob = si.sealUrl(URL_IN);
    const url = si.signedImageUrl(blob, 3600, 'seek');
    const q = new URL(url).searchParams;
    assert.ok(url.includes('/pub/seek/'));
    assert.equal(si.verifySignedRequest(blob, q.get('exp'), q.get('sig'), 'seek').ok, true);
    assert.equal(si.verifySignedRequest(blob, q.get('exp'), q.get('sig'), 'img').ok, false);
  });

  it('ยืดวันหมดอายุเองไม่ได้ · หมดอายุแล้วตอบ 410 ไม่ใช่ 403', () => {
    const blob = si.sealUrl(URL_IN);
    const url = si.signedImageUrl(blob, 3600, 'seek');
    const sig = new URL(url).searchParams.get('sig');
    assert.equal(si.verifySignedRequest(blob, 9999999999, sig, 'seek').status, 403);
    assert.equal(si.verifySignedRequest(blob, 1000000000, sig, 'seek').status, 410);
  });

  // 🔴 ด่านสุดท้ายกัน SSRF — ถึงกุญแจหลุด ก็ยิงเข้าเครือข่ายภายในที่อื่นไม่ได้
  it('รูปแบบ URL ที่ปลายทางยอมรับ ต้องแคบไว้เหมือนเดิม', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/routes/acuseek.js'), 'utf8');
    assert.match(src, /PIC_RE\.test\(u\)/,
      'เปิดผนึกแล้วต้องตรวจรูปแบบ URL ซ้ำเสมอ ห้ามเชื่อว่าก้อนที่ถอดออกมาปลอดภัยแล้ว');
  });
});
