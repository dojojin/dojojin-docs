// ============================================================
// Vigil Platform — Tests: ยามตรวจ i18n ต้องจับของผิดได้จริง
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ที่มา 2026-09-13: เจ้าของถามเรื่องคีย์ i18n กำพร้าสองตัว · ไล่ดูแล้วเจอของที่ขึ้น
// จออยู่จริง 7 จุด — หัวตารางหน้าประวัติรายงาน 3 คอลัมน์แสดง "rh.colDate"
// เป็นตัวอักษรดิบ และช่องค้นหา 3 จุดไม่เคยถูกแปลเพราะสะกด attribute ผิด
//
// 🔴 ยามที่จับอะไรไม่ได้แล้วไม่มีใครรู้ แย่กว่าไม่มียาม เพราะมันสร้างความมั่นใจปลอม ⇒
// เทสต์นี้ฉีดของผิดทีละแบบเข้าไฟล์ชั่วคราวแล้วยืนยันว่ายาม **ตก** จริง
// (เคยพลาดมาแล้วตอนทดสอบด้วยมือ: ใช้คีย์ทดสอบที่ไม่มีอยู่ในไฟล์ การแทนที่เลยเป็น
//  no-op และเทสต์ "ผ่าน" ทั้งที่ไม่ได้ทดสอบอะไรเลย — จึง assert ทุกครั้งว่าฉีดติด)

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-i18n.js');
const TARGETS = ['dashboard/i18n.js', 'dashboard/index.html', 'dashboard/page-blacklist.js'];

let backup;
before(() => {
  backup = new Map(TARGETS.map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
});
after(() => { for (const [f, s] of backup) fs.writeFileSync(path.join(ROOT, f), s); });

/** รันยาม → คืน { code, out } · code 0 = ผ่าน */
function runCheck() {
  try {
    const out = execFileSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/** แทนที่ครั้งเดียวในไฟล์ · โยนถ้าหาไม่เจอ เพื่อไม่ให้เทสต์กลายเป็น no-op เงียบ ๆ */
function inject(rel, find, replace) {
  const p = path.join(ROOT, rel);
  const s = fs.readFileSync(p, 'utf8');
  const n = s.split(find).length - 1;
  assert.ok(n >= 1, `ฉีดไม่ติด: หา ${JSON.stringify(find)} ใน ${rel} ไม่เจอ — เทสต์นี้จะไม่ได้ทดสอบอะไรเลย`);
  fs.writeFileSync(p, s.replace(find, replace));
}
function restore() { for (const [f, s] of backup) fs.writeFileSync(path.join(ROOT, f), s); }

describe('สถานะปัจจุบันของ repo', () => {
  it('ผ่านสะอาด — ถ้าแดงแปลว่ามีของจริงพัง ไม่ใช่เทสต์พัง', () => {
    const r = runCheck();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ครบทั้ง th และ en/);
  });

  it('รายงานคีย์ที่หาการอ้างถึงไม่เจอ แต่ต้องไม่ทำให้ตก', () => {
    // false positive 75% (วัดแล้ว) — คีย์ถูกอ้างผ่าน _blT/_hfsT, ตารางแปลง,
    // และการประกอบสตริงตอนรัน · ทำให้ตกเมื่อไหร่ก็มีคนลบคีย์ที่ใช้อยู่เมื่อนั้น
    const r = runCheck();
    assert.equal(r.code, 0);
    assert.match(r.out, /ℹ️.*หาการอ้างถึงแบบตรงตัวไม่เจอ \d+ คีย์/);
    assert.match(r.out, /ห้ามลบตามนี้โดยไม่ตรวจทีละตัว/);
  });
});

describe('A — คีย์ที่มีแค่ภาษาเดียว (gotcha #42)', () => {
  it('เพิ่มคีย์ใน th อย่างเดียว ⇒ ต้องตก', () => {
    inject('dashboard/i18n.js', "'common.all'", "'zz.onlyThai':'ทดสอบ','common.all'");
    const r = runCheck(); restore();
    assert.equal(r.code, 1, 'ยามปล่อยผ่าน — คีย์ที่มีแค่ภาษาเดียวจะโผล่เป็นภาษาไทยบนหน้าอังกฤษ');
    assert.match(r.out, /zz\.onlyThai/);
    assert.match(r.out, /ขาดใน en/);
  });
});

describe('B — โค้ดเรียกคีย์ที่ไม่มีในพจนานุกรม', () => {
  it('ผ่าน data-i18n ใน html ⇒ ต้องตก', () => {
    inject('dashboard/index.html', 'data-i18n="nav.events"', 'data-i18n="zz.noSuchKey"');
    const r = runCheck(); restore();
    assert.equal(r.code, 1);
    assert.match(r.out, /zz\.noSuchKey/);
    assert.match(r.out, /index\.html:\d+/, 'ต้องบอกไฟล์และบรรทัด ไม่ใช่แค่ชื่อคีย์');
  });

  it('ผ่านฟังก์ชันห่อของแต่ละหน้า (_blT) ⇒ ต้องตก', () => {
    // รูปนี้สำคัญ: หน้า blacklist/hcp-face-search/lpr-settings อ้างคีย์ผ่าน wrapper
    // ไม่ใช่ I18N.t ตรง ๆ · ยามที่รู้จักแค่ I18N.t จะมองไม่เห็นทั้งหน้า
    inject('dashboard/page-blacklist.js', "_blT('bl.dupNone'", "_blT('zz.viaWrapper'");
    const r = runCheck(); restore();
    assert.equal(r.code, 1, 'ยามมองไม่เห็นการอ้างผ่าน wrapper');
    assert.match(r.out, /zz\.viaWrapper/);
  });

  it('prefix ที่ประกอบตอนรัน (ลงท้ายด้วยจุด) ต้องไม่ถูกนับว่าขาด', () => {
    // I18N.t('page.' + name) — 'page.' ไม่ใช่คีย์จริง ถ้านับจะแดงถาวร 25 จุด
    const r = runCheck();
    assert.equal(r.code, 0);
    assert.equal(/→ page\.$/m.test(r.out), false);
  });
});

describe('C — attribute ที่ applyI18n ไม่รองรับ', () => {
  it('data-i18n-placeholder ⇒ ต้องตก (ของจริงคือ data-i18n-ph)', () => {
    inject('dashboard/index.html', 'data-i18n-ph=', 'data-i18n-placeholder=');
    const r = runCheck(); restore();
    assert.equal(r.code, 1, 'attribute ที่สะกดผิดไม่มี error ให้เห็น มันแค่ไม่เคยถูกแปล');
    assert.match(r.out, /data-i18n-placeholder/);
    assert.match(r.out, /ที่รองรับจริงมีแค่/);
  });

  it('รายการ attribute ที่รองรับอ่านมาจาก applyI18n ไม่ได้ hardcode ไว้', () => {
    // วันหน้ามีคนเพิ่ม attribute ใหม่ใน applyI18n ยามต้องรู้ตามเอง ไม่ใช่เตือนผิด
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(src, /function handledAttrs/);
    assert.match(src, /applyI18n/);
  });
});

describe('ต่อสายเข้าเครื่องมือของโปรเจกต์', () => {
  it('มี npm run check:i18n', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['check:i18n'], 'node scripts/check-i18n.js');
  });

  it('pre-commit เรียกเมื่อแตะไฟล์ใน dashboard/', () => {
    const hook = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', 'pre-commit'), 'utf8');
    assert.match(hook, /check-i18n\.js/);
    assert.match(hook, /dashboard\/\.\*\\\.\(js\|html\)/);
  });
});

describe('เจ็ดจุดที่แก้ไปวันนี้ต้องไม่ย้อนกลับมา', () => {
  const i18n = () => fs.readFileSync(path.join(ROOT, 'dashboard', 'i18n.js'), 'utf8');
  const html = () => fs.readFileSync(path.join(ROOT, 'dashboard', 'index.html'), 'utf8');

  it('หัวตารางหน้าประวัติรายงานมีครบทั้ง th และ en', () => {
    for (const k of ['rh.colDate', 'rh.colType', 'rh.colLayout']) {
      assert.equal((i18n().match(new RegExp(`'${k}'`, 'g')) || []).length, 2,
        `${k} หายอีกแล้ว — หัวคอลัมน์จะแสดงชื่อคีย์ดิบบนหน้าจอ`);
    }
  });

  it('common.add มีครบ (ก่อนหน้านี้รอดเพราะ fallback แต่ไม่แปลเป็นอังกฤษ)', () => {
    assert.equal((i18n().match(/'common\.add'/g) || []).length, 2);
  });

  it('ไม่เหลือ data-i18n-placeholder ที่ไหนอีก', () => {
    assert.equal(/data-i18n-placeholder/.test(html()), false);
  });

  it('คีย์กำพร้าสองตัวที่เจ้าของชี้ถูกลบแล้ว', () => {
    assert.equal(/'menu\.popupNotify'/.test(i18n()), false);
    assert.equal(/'smb\.allOnline'/.test(i18n()), false);
  });
});
