// ============================================================
// Vigil Platform — test: การ์ดจุดที่พบมากที่สุด + ตัวเลือกกล้อง
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เจ้าของสั่ง 2026-08-27: ย้ายการ์ด "จุดตรวจจับที่พบมากที่สุด" จากหน้าอันดับ
// ป้ายทะเบียนมาไว้หน้าวินัยจราจร ต่อจากกราฟหมวกรายชั่วโมง · และเอา % ออกจาก
// หน้าต่างเลือกกล้อง
//
// 🔴 สิ่งที่ต้องกันจริง ๆ คือ **ตัวเลขที่ใช้**:
//   hits      = ครั้งที่พบเฉพาะคนที่ทำผิดซ้ำ (≥3 ครั้ง และเกินครึ่ง) — ชุดที่กรองแล้ว
//   no_helmet = ครั้งที่พบไม่สวมหมวกทั้งหมด = คอลัมน์ "จำนวนที่พบ" ในตารางถัดลงไป
// การ์ดนี้อยู่เหนือตารางนั้นโดยตรง ถ้าใช้ hits จะได้ตัวเลขรายกล้องสองชุดติดกัน
// ต่างกันหลายเท่าโดยไม่มีอะไรอธิบาย
// ============================================================
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'page-traffic.js'), 'utf8');
const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const grab = (name) => {
  const m = SRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, `หาฟังก์ชัน ${name} ไม่เจอ`);
  return m[0];
};

// ── 1. การ์ดต้องใช้ no_helmet ไม่ใช่ hits ───────────────────────────────────
{
  const body = grab('_trfCamRankCard');
  assert.ok(/no_helmet/.test(body), 'ต้องเรียงด้วย no_helmet');
  assert.ok(!/\bc\.hits\b/.test(body),
    'ห้ามใช้ hits — เป็นยอดของคนทำผิดซ้ำ คนละตัวกับตารางที่อยู่ใต้การ์ดนี้');
}

// ── 2. เรนเดอร์จริง: เรียงถูก · ตัดกล้องที่ไม่มีข้อมูล · ไม่พังเมื่อว่าง ─────
{
  const ctx = {
    escapeHtml: (s) => String(s ?? '').replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c])),
  };
  vm.createContext(ctx);
  vm.runInContext([SRC.match(/const _tfmt\s*=.*/)[0], grab('_trfCamRankCard')].join('\n'), ctx);

  const cams = [
    { id: 'A', name: 'กล้อง A', no_helmet: 100, detect: true },
    { id: 'B', name: 'กล้อง B', no_helmet: 900, detect: true },
    { id: 'C', name: 'กล้อง C', no_helmet: 0,   detect: true },
    { id: 'D', name: 'กล้อง D', no_helmet: 500, detect: true },
  ];
  const html = ctx._trfCamRankCard(cams);
  const order = [...html.matchAll(/<b>กล้อง (\w)<\/b>/g)].map((m) => m[1]);
  assert.deepStrictEqual(order, ['B', 'D', 'A'], 'ต้องเรียงจากมากไปน้อย และตัดตัวที่เป็น 0 ออก');
  assert.ok(/900/.test(html) && !/>0<\/b>/.test(html));
  // แถบของอันดับหนึ่งต้องเต็ม 100% — ถ้าคิดฐานผิดจะได้แถบสั้นทุกอัน
  assert.ok(/width:100\.0%/.test(html), 'อันดับหนึ่งต้องเป็นฐาน 100%');
  // ไม่มีข้อมูลเลย = ไม่ต้องขึ้นการ์ดเปล่า
  assert.strictEqual(ctx._trfCamRankCard([]), '');
  assert.strictEqual(ctx._trfCamRankCard([{ id: 'X', name: 'X', no_helmet: 0, detect: true }]), '');
}

// ── 3. ต้องอยู่ในหน้าวินัยจราจร ต่อจากกราฟหมวกรายชั่วโมง ────────────────────
{
  const i = code.indexOf('trfChartHelmet');
  // ต้องหา **จุดเรียก** ไม่ใช่นิยามฟังก์ชัน — `function _trfCamRankCard(det) {`
  // มีข้อความเดียวกันและอยู่ก่อนหน้า ทำให้เทียบลำดับผิด (พลาดมาแล้วตอนเขียนเทสต์นี้)
  const j = code.indexOf('${_trfCamRankCard(det)}');
  const k = code.indexOf('อัตราฝ่าฝืนรายกล้อง');
  assert.ok(j > -1, 'ต้องถูกเรียกในหน้าวินัยจราจร');
  assert.ok(i < j && j < k, 'ลำดับต้องเป็น กราฟหมวกรายชั่วโมง → การ์ดอันดับ → ตารางรายกล้อง');
}

// ── 4. การ์ดเดิมต้องหายไปจากหน้าอันดับป้ายทะเบียน ───────────────────────────
// เหลือไว้ทั้งสองที่ = การ์ดชื่อคล้ายกันสองใบ ตัวเลขต่างกัน ซึ่งแย่กว่าเลือกอย่างใดอย่างหนึ่ง
// 🔴 ต้องสแกน `code` (ตัดคอมเมนต์แล้ว) ไม่ใช่ SRC — คอมเมนต์ที่บอกว่า "ย้ายไป
// หน้าวินัยจราจรแล้ว" มีชื่อการ์ดเดิมอยู่ในนั้น ถ้าสแกน SRC จะฟ้องว่ายังไม่ได้ลบ
// ทั้งที่ลบไปแล้ว (พลาดแบบเดียวกันนี้มาแล้วสามครั้งวันนี้)
assert.ok(!/จุดตรวจจับที่พบมากที่สุด/.test(code),
  'การ์ดเดิมต้องถูกลบ ไม่ใช่ทิ้งไว้ให้ซ้ำกัน');
assert.ok(!/camList/.test(code), 'โค้ดสร้างการ์ดเดิมต้องถูกเก็บกวาดด้วย');

// ── 5. ตัวเลือกกล้องต้องไม่มี % แต่ต้องเหลือป้าย "ยังไม่เปิดตรวจจับ" ─────────
// ป้ายนั้นไม่ใช่สถิติ แต่เป็นคำเตือนว่าเลือกกล้องตัวนั้นไปก็ไม่ได้ข้อมูลกลับมา
{
  const i = code.indexOf('const list = siteCams.map');
  assert.ok(i > -1, 'หาบล็อกตัวเลือกกล้องไม่เจอ');
  const body = code.slice(i, code.indexOf(".join('')", i));
  assert.ok(!/_tpct\(c\.helmet_pct\)/.test(body), '% ต้องถูกเอาออกจากตัวเลือกกล้อง');
  assert.ok(/trf-nodetect/.test(body), 'ป้าย "ยังไม่เปิดตรวจจับ" ต้องยังอยู่');
}

console.log('✅ traffic cam rank: ผ่าน 5 ข้อ');
