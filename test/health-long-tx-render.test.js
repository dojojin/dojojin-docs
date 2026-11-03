// ============================================================
// Vigil Platform — test: หน้า Health แสดง transaction ที่เปิดค้าง
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// GOTCHAS #181 — ก่อนหน้านี้ตัวเลขอยู่ใน payload ครบแต่ไม่มีที่ยืนบนหน้าจอ คนจึง
// ไม่รู้ว่าระบบกำลังพังจนผู้ใช้มาบอกว่าหน้าสถิติว่าง เทสต์นี้กันไม่ให้กลับไปเป็นแบบนั้น
// ดึงฟังก์ชันจริงจากซอร์ส (ไม่ก็อป logic มาเขียนซ้ำ) แล้วรันในกล่องที่ stub DOM ไว้
// ============================================================
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'page-health.js'), 'utf8');

const grab = (name) => {
  const m = SRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, `หาฟังก์ชัน ${name} ในซอร์สไม่เจอ — ถูกลบหรือเปลี่ยนชื่อ?`);
  return m[0];
};

const ctx = {
  escapeHtml: (s) => String(s ?? '').replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c])),
  I18N: { t: (k, d) => d || k },
};
vm.createContext(ctx);
vm.runInContext([grab('_dbStuckRows'), grab('_humanSec')].join('\n'), ctx);
const rows = (tx, qry) => ctx._dbStuckRows(tx, qry);

// ── 1. ไม่มีอะไรค้าง = ยังต้องมีแถวบอกว่า "ไม่มี" ───────────────────────────
// แถวที่หายไปตอนปกติ = คนไม่รู้ว่ามีตัวเฝ้าอยู่ และไม่รู้ว่ามันยังทำงานอยู่ไหม
{
  const r = rows([], []);
  assert.ok(r.length >= 2, 'ตอนปกติต้องยังแสดงหัวข้อทั้งสองชุด');
  assert.ok(r.every(([, v]) => v !== null), 'ตอนไม่มีอะไรค้าง ไม่ต้องมีหัวข้อคั่น');
}

// ── 2. มี transaction ค้าง → ต้องบอก pid และอายุ ────────────────────────────
// pid คือสิ่งเดียวที่เอาไปปิดตัวที่ค้างได้ ถ้าไม่แสดง หน้าจอก็บอกได้แค่ "มีปัญหา"
{
  const r = rows([{ pid: 892927, state: 'idle in transaction', tx_age_sec: 124712 }], []);
  const flat = r.map(([k, v]) => `${k} ${v}`).join('\n');
  assert.ok(flat.includes('892927'), 'ต้องแสดง pid');
  assert.ok(flat.includes('idle in transaction'), 'ต้องแสดง state — เป็นลายนิ้วมือของบั๊กนี้');
  assert.ok(/1d 10h/.test(flat), `ต้องแปลงอายุเป็นหน่วยที่อ่านออก ได้: ${flat}`);
  assert.ok(r.some(([, v]) => v === null), 'ตอนมีของค้างต้องมีหัวข้อคั่นให้สะดุดตา');
}

// ── 3. ค้างพร้อมกันหลายตัว → ตัดที่ 5 แต่ต้องบอกว่าเหลืออีกเท่าไร ───────────
// ตัดเงียบ ๆ = หน้าจอโกหกว่ามี 5 ทั้งที่มี 12 (บทเรียนเดิม: no silent caps)
{
  const many = Array.from({ length: 12 }, (_, i) => ({ pid: 1000 + i, state: 'active', tx_age_sec: 3600 }));
  const flat = rows(many, []).map(([k, v]) => `${k} ${v}`).join('\n');
  assert.ok(flat.includes('1004') && !flat.includes('1005'), 'ต้องแสดง 5 ตัวแรก');
  assert.ok(flat.includes('+7'), 'ต้องบอกจำนวนที่ไม่ได้แสดง');
}

// ── 4. ตัวเรียกต้องกัน long_running_queries ที่คืน { error } แทน array ──────
// health.js คืน { error: ... } เมื่อ pool ตัน ซึ่งคือสถานการณ์ที่การ์ดนี้ต้องรอด
// ที่สุด — .slice() บน object จะโยน แล้วหน้า Health ทั้งหน้าว่างแทนที่จะบอกปัญหา
{
  assert.ok(/Array\.isArray\(h\.db\.long_running_queries\)/.test(SRC),
    'ต้องเช็ค Array.isArray ก่อนใช้ long_running_queries');
  assert.ok(/Array\.isArray\(h\.db\.long_transactions\)/.test(SRC),
    'ต้องเช็ค Array.isArray ก่อนใช้ long_transactions');
}

// ── 5. badge ต้องเปลี่ยนเป็น warn เมื่อมีของค้าง ─────────────────────────────
// การ์ดขึ้นเขียว "3ms" ทั้งที่ transaction ค้างอยู่ = ตรงกับที่พลาดมาแล้วเป๊ะ
assert.ok(/longTx\.length\s*\?\s*_healthBadge\('warn'/.test(SRC),
  'badge ของ Database ต้องเป็น warn เมื่อมี transaction ค้าง ไม่ใช่ ok ตาม latency');

// ── 6. ห้าม hardcode สี ต้องมาจาก token (DESIGN.md / decision #145) ─────────
{
  const body = grab('_dbStuckRows');
  const hex = body.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.strictEqual(hex.length, 0, `พบสี hardcode: ${hex.join(', ')} — ต้องใช้ var(--...)`);
  assert.ok(/var\(--warn\)/.test(body) && /var\(--text-secondary\)/.test(body),
    'ต้องใช้ semantic token');
}

// ── 7. ห้าม emoji เป็น UI (decision #144) ──────────────────────────────────
{
  const body = grab('_dbStuckRows').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const emoji = body.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];
  assert.strictEqual(emoji.length, 0, `พบ emoji ใน UI: ${emoji.join(' ')}`);
}

console.log('✅ health long-tx render: ผ่าน 7 ข้อ');
