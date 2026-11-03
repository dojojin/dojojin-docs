// ============================================================
// Vigil Platform — สลับมุมมองรายการ / ภาพ ในหน้าเหตุการณ์
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เจ้าของขอ 2026-08-27 — ตารางอ่านง่ายเวลาไล่เวลา แต่ตอนกวาดหาภาพที่ใช่
// รูป 44×28px เล็กเกินจะดูออก · สองมุมมองตอบคนละคำถาม จึงเก็บทั้งคู่

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...f) => fs.readFileSync(path.join(__dirname, '..', ...f), 'utf8');
const EV   = read('dashboard', 'page-events.js');
const HTML = read('dashboard', 'index.html');
const NAV  = read('dashboard', 'page-nav-bindings.js');
const CSS  = read('dashboard', 'index.css');
const I18N = read('dashboard', 'i18n.js');

test('ปุ่มสลับต้องต่อกับ ACTION_MAP จริง ไม่ใช่ปุ่มลอย', () => {
  assert.ok(/data-action="evtSetView"[\s\S]{0,200}data-view="list"/.test(HTML), 'ขาดปุ่มรายการ');
  assert.ok(/data-action="evtSetView"[\s\S]{0,200}data-view="grid"/.test(HTML), 'ขาดปุ่มภาพ');
  // ⚠️ ต้องอยู่นอกตัวฟังก์ชันของ action อื่น — เคยแทรกเข้าไปใน showSnapshot แล้วไฟล์พัง
  assert.ok(/^\s*evtSetView:\s+\(el\) => evtSetView\(el\),$/m.test(NAV),
    'ต้องลงทะเบียนเป็นสมาชิกของ ACTION_MAP');
});

test('จำมุมมองไว้ข้ามการรีเฟรช และไม่ล้มเมื่อ localStorage ใช้ไม่ได้', () => {
  assert.ok(/localStorage\.setItem\(EVT_VIEW_KEY/.test(EV), 'ต้องจำค่าไว้');
  // โหมด private ของบางเบราว์เซอร์โยน exception ที่ localStorage — ห้ามพาทั้งหน้าล้ม
  const init = EV.match(/let _evtView = \(\(\) => \{[\s\S]*?\}\)\(\);/);
  assert.ok(init && /catch/.test(init[0]), 'ตอนอ่านค่าต้องมี catch');
  assert.ok(/setItem\(EVT_VIEW_KEY, v\); \} catch/.test(EV), 'ตอนเขียนค่าต้องมี catch');
});

test('มุมมองภาพต้องซ่อนหัวคอลัมน์ — หัวตารางไม่มีความหมายกับการ์ด', () => {
  const sync = EV.match(/function _evtSyncViewUI\(\)[\s\S]*?\n\}/);
  assert.ok(sync, 'หา _evtSyncViewUI ไม่เจอ');
  assert.ok(/evtColHeader/.test(sync[0]) && /'none'/.test(sync[0]));
  assert.ok(/classList\.toggle\('events-list--grid'/.test(sync[0]));
});

test('การ์ดต้องไม่มี emoji — โค้ดใหม่ใช้ SVG เท่านั้น (CLAUDE.md ข้อ 16)', () => {
  const card = EV.match(/if \(_evtView === 'grid'\)[\s\S]*?\n    \}/);
  assert.ok(card, 'หาบล็อกการ์ดไม่เจอ');
  // แถวรายการเดิมมี ${icon} ที่เป็น emoji (grandfathered) — การ์ดต้องไม่หยิบมาใช้ต่อ
  assert.ok(!/\$\{icon\}/.test(card[0]), 'การ์ดห้ามใช้ตัวแปร icon ที่เป็น emoji');
  // ตรวจเฉพาะ markup ที่ผู้ใช้เห็น — คอมเมนต์ใช้ emoji ได้ (CLAUDE.md ยกเว้นไว้)
  // ถ้าไม่ตัดคอมเมนต์ออก เทสจะดังใส่ ⚠️ ที่เขียนอธิบายกฎข้อนี้เอง
  const visible = card[0].split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(visible), 'พบ emoji ในการ์ด');
});

test('ทุกสี/ระยะมาจาก token และมี breakpoint ≤768px', () => {
  const block = CSS.slice(CSS.indexOf('.evt-viewtoggle'));
  const hex = block.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
  // อนุญาต #fff บนแถบเวลาที่ทับภาพ — ตัวอักษรบนภาพต้องขาวเสมอ ไม่ขึ้นกับธีม
  assert.deepEqual(hex.filter((h) => h.toLowerCase() !== '#fff'), [], `พบสี hardcode: ${hex}`);
  assert.ok(/@media \(max-width: 768px\)[\s\S]*events-list--grid/.test(block), 'ขาด breakpoint มือถือ');
});

test('ป้ายกำกับปุ่มมีครบทั้งไทยและอังกฤษ (gotcha #42)', () => {
  for (const k of ['evt.viewList', 'evt.viewGrid']) {
    assert.equal(I18N.split(`'${k}':`).length - 1, 2, `${k} ต้องมีทั้ง th และ en`);
  }
});
