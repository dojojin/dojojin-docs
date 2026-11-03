// ============================================================
// Vigil Platform — ค้นป้ายทะเบียน "ตามรูปแบบ" → POSIX regex ของ Postgres
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา 2026-10-22: เจ้าของอยากค้น "หลักแรก 5–9 หลักสอง 0–9 ที่เหลือไม่สน" · RegEx ตรง ๆ คนใช้งง (ลืม ^ แล้วได้เกือบทุกป้าย)
// ⇒ ภาษาเล็ก ๆ ที่เทียบกับ "ทั้งป้าย" เสมอ (ใส่ ^…$ ให้เอง) และ escape ทุกอย่างที่ไม่ใช่สัญลักษณ์ของเรา
//   #  ตัวเลข 1 หลัก         @  อักษรไทย 1 ตัว (ก–ฮ)     ?  อะไรก็ได้ 1 ตัว     *  อะไรก็ได้ กี่ตัวก็ได้
//   [5-9] [กขค] [ก-ง]  ตัวเดียวจากชุด/ช่วง (ตัวเลขหรืออักษรไทยเท่านั้น)     ตัวอื่น = ตรงตามที่พิมพ์
// เว้นวรรคถูกตัดทิ้ง เพราะ plate_number เก็บแบบไม่มีเว้นวรรค (เหมือนโหมดค้นปกติ)
// ไม่มีทางสร้าง regex แปลก ๆ ได้ (ไม่มี alternation, backreference, quantifier ซ้อน) ⇒ pattern ผิดรูปตอบ 400 ไม่ใช่ 500
// ============================================================
'use strict';

const MAX_LEN = 32;
const CLASS_CH = /[0-9ก-ฮ]/;
const esc = (c) => c.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');

/** @returns {{ regex: string } | { error: string }} */
function toRegex(input) {
  const p = String(input || '').replace(/\s+/g, '');
  if (!p) return { error: 'empty' };
  if (p.length > MAX_LEN) return { error: 'too_long' };
  let out = '', i = 0, constrained = false;
  while (i < p.length) {
    const c = p[i];
    if (c === '#') { out += '[0-9]'; constrained = true; i++; continue; }
    if (c === '@') { out += '[ก-ฮ]'; constrained = true; i++; continue; }
    if (c === '?') { out += '.'; i++; continue; }
    if (c === '*') { if (!out.endsWith('.*')) out += '.*'; i++; continue; }
    if (c === '[') {
      const end = p.indexOf(']', i);
      if (end < 0) return { error: 'unclosed_bracket' };
      const body = p.slice(i + 1, end);
      if (!body) return { error: 'empty_bracket' };
      // ตัวเดียว หรือช่วง a-b ซ้ำได้ · ทั้งสองข้างของช่วงต้องเป็นชนิดเดียวกันและเรียงจากน้อยไปมาก
      let j = 0;
      while (j < body.length) {
        const a = body[j];
        if (!CLASS_CH.test(a)) return { error: 'bad_bracket' };
        if (body[j + 1] === '-') {
          const b = body[j + 2];
          if (!b || !CLASS_CH.test(b) || /[0-9]/.test(a) !== /[0-9]/.test(b) || a > b) return { error: 'bad_range' };
          j += 3;
        } else j++;
      }
      out += `[${body}]`; constrained = true; i = end + 1; continue;
    }
    if (c === ']') return { error: 'bad_bracket' };
    out += esc(c); constrained = true; i++;
  }
  // มีแต่ ? กับ * = ไม่ได้กรองอะไร ไล่ทั้งช่วงเวลาเปล่า ๆ
  if (!constrained) return { error: 'no_constraint' };
  return { regex: `^${out}$` };
}

module.exports = { toRegex, MAX_LEN };

if (require.main === module) {
  const assert = require('assert');
  const ok = (p) => toRegex(p).regex;
  assert.strictEqual(ok('[5-9]#*'), '^[5-9][0-9].*$');
  assert.strictEqual(ok('#@@####'), '^[0-9][ก-ฮ][ก-ฮ][0-9][0-9][0-9][0-9]$');
  assert.strictEqual(ok('*1234'), '^.*1234$');
  assert.strictEqual(ok('กข *'), '^กข.*$');
  assert.strictEqual(ok('[กขค]#**'), '^[กขค][0-9].*$');
  assert.strictEqual(ok('a.b+(c)'), '^a\\.b\\+\\(c\\)$', 'metacharacters are literal');
  const re = new RegExp(ok('[5-9]#*'));
  for (const s of ['59ฒ96', '880ฐ', '9170ก4']) assert.ok(re.test(s), s);
  for (const s of ['1กข1234', 'กข1234', '5ก12']) assert.ok(!re.test(s), s);
  for (const [p, e] of [['', 'empty'], ['*?*', 'no_constraint'], ['[5-', 'unclosed_bracket'], ['[9-5]', 'bad_range'],
    ['[5-ก]', 'bad_range'], ['[a-z]', 'bad_bracket'], ['[]#', 'empty_bracket'], ['5]', 'bad_bracket'], ['#'.repeat(33), 'too_long']]) {
    assert.strictEqual(toRegex(p).error, e, p);
  }
  console.log('platePattern self-check: all assertions passed');
}
