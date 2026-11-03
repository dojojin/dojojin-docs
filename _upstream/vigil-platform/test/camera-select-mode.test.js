// ============================================================
// Vigil Platform — โหมดเลือกกล้องต่อผู้ใช้ (migration 180)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เจ้าของสั่ง 2026-08-27: บาง user ควรดูได้ทีละกล้อง แม้จะมีสิทธิ์หลายกล้อง
//
// 🔒 สิ่งที่ต้องกันคือ "บังคับจริงหรือแค่หน้าจอ" — ระบบนี้มีหนี้แบบนั้นอยู่แล้วใน
// เรื่องสิทธิ์ระดับหน้า (กันได้แค่หน้าจอ 20/29 แท็บ) เพิ่มอีกอันจะแยกไม่ออกว่า
// อันไหนกันจริง · เทสนี้จึงยิงที่ตัวตัดสินฝั่ง server ไม่ใช่ที่ DOM

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { cameraSelectMode } = require('../src/auth');

test('ไม่ตั้งค่า = multi — คนที่มีอยู่ก่อนคอลัมน์นี้ต้องไม่เปลี่ยนพฤติกรรม', () => {
  assert.equal(cameraSelectMode({ role: 'viewer' }), 'multi');
  assert.equal(cameraSelectMode({ role: 'viewer', camera_select_mode: null }), 'multi');
  assert.equal(cameraSelectMode(null), 'multi');
  assert.equal(cameraSelectMode(undefined), 'multi');
});

test('single มีผลเฉพาะ viewer — admin/auditor ไม่ถูกจำกัด', () => {
  assert.equal(cameraSelectMode({ role: 'viewer',  camera_select_mode: 'single' }), 'single');
  assert.equal(cameraSelectMode({ role: 'admin',   camera_select_mode: 'single' }), 'multi');
  assert.equal(cameraSelectMode({ role: 'auditor', camera_select_mode: 'single' }), 'multi');
});

test('ค่าที่ไม่รู้จัก ต้องตกเป็น multi ไม่ใช่ single', () => {
  // ตกไปทาง single จะล็อกคนที่ไม่มีใครสั่งให้ล็อก และดูเหมือนหน้าจอพัง
  for (const v of ['SINGLE', 'one', '', 0, {}, []]) {
    assert.equal(cameraSelectMode({ role: 'viewer', camera_select_mode: v }), 'multi', String(v));
  }
});

test('การบังคับต้องอยู่ฝั่ง server ไม่ใช่แค่สลับ input ที่หน้าจอ', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'traffic.js'), 'utf8');
  // parseCams เป็นทางเข้าเดียวของทุก endpoint ในไฟล์นี้
  const m = SRC.match(/const parseCams = \([^)]*\) => \{[\s\S]*?\n  \};/);
  assert.ok(m, 'หา parseCams ไม่เจอ');
  assert.ok(/cameraSelectMode\(req\?\.user\) === 'single'/.test(m[0]),
    'parseCams ต้องเช็คโหมด ไม่งั้นยิง API เองข้ามได้');
  assert.ok(/e\.status = 400/.test(m[0]),
    'ต้องตอบ 400 ไม่ใช่ตัดให้เหลือตัวแรกเงียบ ๆ');
  // ทุก endpoint ต้องส่ง req เข้าไป ไม่งั้นด่านนี้เป็นโมฆะเฉพาะจุดนั้น
  const calls = SRC.match(/parseCams\(req\.query\.cameras[^)]*\)/g) || [];
  assert.ok(calls.length >= 4, `พบจุดเรียกแค่ ${calls.length}`);
  for (const c of calls) assert.ok(c.includes(', req'), `จุดเรียกไม่ได้ส่ง req: ${c}`);
});

test('routeError ต้องส่ง 4xx ที่ตั้งใจโยนกลับไป ไม่ใช่กลืนเป็น 500', () => {
  const routeError = require('../src/helpers/routeError');
  const cap = () => { const o = {}; return { o,
    res: { status(c) { o.code = c; return this; }, json(b) { o.body = b; return this; } } }; };

  const a = cap(); const e = new Error('บัญชีนี้ดูได้ทีละกล้องเท่านั้น'); e.status = 400;
  routeError(a.res, e, 'test');
  assert.equal(a.o.code, 400);
  assert.equal(a.o.body.error, 'บัญชีนี้ดูได้ทีละกล้องเท่านั้น');

  // 🔒 error ที่ไม่ได้ตั้งใจโยน ต้องยังถูกปิดบังเหมือนเดิม (SEC-2T-004)
  const b = cap();
  routeError(b.res, new Error('column "secret_col" does not exist'), 'test');
  assert.equal(b.o.code, 500);
  assert.equal(b.o.body.error, 'Internal server error');
  assert.ok(!JSON.stringify(b.o.body).includes('secret_col'), 'ห้ามรั่วรายละเอียดภายใน');

  // 5xx ที่ตั้งใจโยนก็ยังต้องถูกปิดบัง — ช่องนี้เปิดไว้เฉพาะ 4xx
  const c = cap(); const e5 = new Error('upstream ตาย'); e5.status = 502;
  routeError(c.res, e5, 'test');
  assert.equal(c.o.code, 500);
  assert.equal(c.o.body.error, 'Internal server error');
});

test('หน้าจัดการผู้ใช้ ต้องตั้งค่าได้และไม่เผลอเปลี่ยนคนที่ไม่ได้ตั้งใจ', () => {
  const HTML = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'index.html'), 'utf8');
  const UI   = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'page-user-mgmt.js'), 'utf8');
  const I18N = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'i18n.js'), 'utf8');

  // ช่องเลือกต้องมีทั้งสองค่า และค่าที่ส่งขึ้นไปต้องตรงกับที่ server ยอมรับ
  const sel = HTML.match(/<select[^>]*id="ueCamMode"[\s\S]*?<\/select>/);
  assert.ok(sel, 'ไม่มีช่องเลือกในฟอร์ม');
  for (const v of ['multi', 'single']) {
    assert.ok(sel[0].includes(`value="${v}"`), `ขาดตัวเลือก ${v}`);
  }

  // 🔴 ค่าเริ่มต้นต้องเป็น multi — ถ้าเผลอทำเป็น single แค่เปิดฟอร์มดูแล้วกดบันทึก
  // จะไปจำกัดคนที่ไม่มีใครสั่งให้จำกัด (คลาสเดียวกับ DEFAULT ของคอลัมน์ใน DB)
  assert.ok(/camera_select_mode === 'single' \? 'single' : 'multi'/.test(UI),
    'การโหลดค่าเดิมต้องตกกลับไปที่ multi ไม่ใช่ single');

  // ต้องยิงไป endpoint ของตัวเอง ไม่ใช่ปนกับ /cameras (คนละแกน · audit ต้องแยกออก)
  assert.ok(/\/camera-mode`/.test(UI), 'ต้องบันทึกผ่าน /api/users/:id/camera-mode');
  assert.ok(/camera_select_mode: modeEl\.value/.test(UI));

  // i18n ครบสองภาษา (gotcha #42)
  for (const k of ['us.camModeLabel', 'us.camModeMulti', 'us.camModeSingle', 'us.camModeHint']) {
    assert.equal(I18N.split(`'${k}':`).length - 1, 2, `${k} ต้องมีทั้ง th และ en`);
  }
});

test('ตัวเลือกกล้องต้องเปิดได้แม้ผู้ใช้เห็นเฉพาะแท็บหมวก', () => {
  // loadTraffic() ออกก่อนถึง fetch เมื่อไม่มีสิทธิ์แท็บ enforcement (_trfCanLoadEnforcement)
  // ⇒ TRF.data เป็น null · โค้ดเดิมอ่าน TRF.data.cameras ตรง ๆ แล้วโยน TypeError
  // ผลคือกดปุ่มเลือกกล้องแล้วไม่เกิดอะไรขึ้นเลย ไม่มี error ให้ผู้ใช้เห็น
  const UI = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'page-traffic.js'), 'utf8');
  const fn = UI.match(/function trfOpenCams\(\)[\s\S]*?\n\}/);
  assert.ok(fn, 'หา trfOpenCams ไม่เจอ');
  assert.ok(!/\(TRF\.data\.cameras/.test(fn[0]),
    'ห้ามอ่าน TRF.data.cameras ตรง ๆ — เป็น null ได้');
  assert.ok(/TRF_HELMET\.data && TRF_HELMET\.data\.cameras/.test(fn[0]),
    'ต้องตกไปใช้รายชื่อกล้องของแท็บหมวก');
  // และต้องไม่เปิดหน้าต่างเปล่าเมื่อยังไม่มีข้อมูลจริง ๆ
  assert.ok(/if \(!camSrc\)/.test(fn[0]), 'ต้องมีทางออกเมื่อยังโหลดไม่เสร็จ');
});
