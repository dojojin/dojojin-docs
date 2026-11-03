// ============================================================
// Vigil Platform — จับว่าประโยคใน LINE ตรงกับคำสั่งไหน
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ฟังก์ชันบริสุทธิ์ล้วน ไม่แตะ DB ไม่แตะเครือข่าย — ผู้เรียกส่งรายการคำสั่ง
// (แถวจาก line_commands) เข้ามาเอง จึงทดสอบทุกกรณีได้โดยไม่ต้องมีฐานข้อมูล
//
// ทำไมไม่ใช้ "คำสั่งขึ้นต้นด้วย /" แบบบอททั่วไป: เจ้าของสั่งเป็นประโยคไทยเต็ม
// ("ขอทราบยอดคนไม่สวมหมวกนิรภัย ชั่วโมงที่แล้ว หน่อย") การบังคับรูปแบบจะทำให้
// ต้องจำ syntax ซึ่งขัดกับเหตุผลที่อยากสั่งผ่านแชทตั้งแต่แรก
//
// ทำไมให้คะแนนตามความยาวคำ: คำเรียกของคำสั่งหนึ่งมักเป็นคำย่อยของอีกคำสั่ง
// ("หมวก" อยู่ใน "หมวกนิรภัย") ถ้านับเป็น 1 คะแนนเท่ากันหมด คำสั่งที่ตั้งคำเรียก
// ไว้กว้างกว่าจะชนะเสมอโดยไม่มีเหตุผล
// ============================================================
'use strict';

const { parseThaiPeriod, parseLimit, thaiDigits } = require('./thaiPeriod');
const { matchSite } = require('./lineCommandSites');   // ฟังก์ชันบริสุทธิ์ ไม่แตะ DB
const { matchObjectClass } = require('./eventObjectClass');
const { parseFaceAttrs } = require('./faceQueryTh');

// คำสุภาพที่ไม่ได้บอกความหมาย
// ⚠️ ภาษาไทยไม่มีช่องว่างระหว่างคำ และ `\b` ของ regex ใช้กับอักษรไทยไม่ได้เลย
//    (ทดสอบแล้ว: `/\bขอ\b/` ไม่ match "ขอทราบ") · ถ้าลบแบบ replace ทั้งสตริงจะพัง
//    คำที่มีคำสุภาพเป็นส่วนหนึ่ง เช่น "ขอบเขต" → "บเขต" ⇒ ตัดแบบ **รายคำ** เท่านั้น
// คำนำ/คำท้ายที่คนพิมพ์จริงแต่ไม่ได้บอกว่าอยากได้อะไร — ตัดทิ้งก่อนเทียบคำสั่ง
// เพิ่มชุด "สรุป/รายงาน/กี่ตัว/เท่าไหร่" 2026-09-09 หลังเจ้าของพิมพ์
// "สรุปจำนวนป้ายทะเบียน ... มาหน่อย" แล้วไม่ตรงคำสั่งไหนเลย
const FILLER_WHOLE = ['ขอทราบ', 'ขอดู', 'ขอ', 'ช่วย', 'หน่อย', 'ที', 'ด้วย', 'แล้วกัน', 'please',
  'มาหน่อย', 'ให้หน่อย', 'ทีนึง', 'กี่ตัว', 'กี่คัน', 'กี่ราย', 'กี่ครั้ง', 'เท่าไหร่', 'เท่าไร', 'บ้าง'];
// 🔴 ห้ามใส่ 'สรุป' / 'รายงาน' ลงรายการนี้ — สองคำนั้นเป็นคำนามของคำสั่งได้จริง
//    (แอดมินตั้งคำเรียกว่า "รายงาน…" ได้) และการตัดทิ้งทำให้คำสั่งนั้นจับไม่ได้เลย
//    (เทสต์ "คะแนนสูสี = ถามกลับ" จับไว้แล้ว 2026-09-09)
//    อีกอย่าง: ภาษาไทยไม่มีช่องว่าง "สรุปจำนวนป้ายทะเบียน" เป็นคำเดียว การตัดรายคำ
//    จึงไม่ช่วยอยู่ดี — ทางที่ได้ผลคือเพิ่ม **คำเรียกที่เป็นคำนามจริง** (migration 218)
// อนุภาคท้ายประโยคที่ติดมากับคำหน้าได้ ("หน่อยครับ") — ตัดจากท้ายคำเท่านั้น
const FILLER_TAIL = ['ครับ', 'คะ', 'ค่ะ', 'นะ', 'จ้า', 'จ้ะ'];

function _stripToken(tok) {
  let t = tok;
  let changed = true;
  while (changed && t) {
    changed = false;
    for (const w of FILLER_TAIL) {
      if (t.length > w.length && t.endsWith(w)) { t = t.slice(0, -w.length); changed = true; }
    }
    if (FILLER_TAIL.includes(t) || FILLER_WHOLE.includes(t)) return '';
  }
  return t;
}

/** ทำให้ประโยคเทียบได้: เลขไทย→อารบิก · ตัดคำสุภาพรายคำ · ยุบช่องว่าง · ตัวพิมพ์เล็ก */
function normalize(text) {
  return thaiDigits(String(text || ''))
    .toLowerCase()
    .replace(/[.,!?"'()]/g, ' ')
    .split(/\s+/)
    .map(_stripToken)
    .filter(Boolean)
    .join(' ')
    .trim();
}

const _arr = (v) => (Array.isArray(v) ? v : []);

/**
 * ให้คะแนนคำสั่งหนึ่งกับประโยคหนึ่ง
 * @returns {number} 0 = ไม่เข้าเงื่อนไข
 */
// ── ทนต่อการพิมพ์วรรณยุกต์/สระผิด ────────────────────────────────
//
// ของจริง 2026-09-09: เจ้าของพิมพ์ "คันหาอัจฉริยะ" (ไม้หันอากาศ ั = U+0E31) แทน
// "ค้นหาอัจฉริยะ" (ไม้โท ้ = U+0E49) ผิดตัวเดียว ⇒ ไม่ตรงคำสั่งไหนเลย และบอท**เงียบสนิท**
// ซึ่งจากฝั่งคนพิมพ์แยกไม่ออกเลยว่า "พิมพ์ผิด" หรือ "ระบบค้าง"
//
// วิธีแก้: ถ้าเทียบแบบตรงตัวไม่เจอ ค่อยเทียบอีกรอบโดย**ถอดวรรณยุกต์/สระบนล่างทิ้ง**
// ⚠️ ใช้เฉพาะคำเรียกที่ยาว ≥ 5 ตัวอักษร — คำสั้นถอดวรรณยุกต์แล้วชนกันง่ายมาก
//    ("ค้น" → "คน" ซึ่งเป็นคำที่โผล่ในทุกประโยคเรื่องคน) และให้คะแนนน้อยกว่านิดหนึ่ง
//    เพื่อให้คำที่สะกดถูกชนะเสมอเมื่อทั้งคู่เข้าเงื่อนไข
const _MARKS = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g;
const _loose = (s) => String(s || '').replace(_MARKS, '');
const LOOSE_MIN = 5;

/** เจอคำนี้ในประโยคไหม — ตรงตัวก่อน ถ้าไม่เจอค่อยลองแบบถอดวรรณยุกต์ */
function _hasWord(norm, w, { loose = true } = {}) {
  const t = String(w || '').toLowerCase();
  if (!t) return false;
  if (norm.includes(t)) return 'exact';
  if (!loose || t.length < LOOSE_MIN) return false;
  return _loose(norm).includes(_loose(t)) ? 'loose' : false;
}

function scoreCommand(norm, cmd, { loose = false } = {}) {
  if (cmd.enabled === false) return 0;
  // คำต้องห้าม: เจอคำเดียวก็ตัดทิ้ง — นี่คือเครื่องมือหลักที่กันคำสั่งชนกัน
  // คำต้องห้ามเทียบแบบทนพิมพ์ผิดด้วย — กันไว้มากกว่าปล่อยผ่าน ปลอดภัยกว่าเสมอ
  for (const w of _arr(cmd.exclude)) {
    if (w && _hasWord(norm, w)) return 0;
  }
  // คำที่ต้องมีครบ
  for (const w of _arr(cmd.require_all)) {
    if (!w || !_hasWord(norm, w)) return 0;
  }
  let score = 0;
  for (const w of _arr(cmd.triggers)) {
    const t = String(w || '').toLowerCase();
    if (_hasWord(norm, t, { loose })) score += t.length;
  }
  // require_all เป็นตัว **จำกัด** ไม่ใช่ตัว **เรียก** — ถ้าไม่มี trigger ตรงสักคำ
  // ต้องได้ 0 ไม่งั้นคำสั่ง "อันดับป้ายที่ไม่สวมหมวก" (require_all=["ป้าย"]) จะโดนจับ
  // ทุกครั้งที่ประโยคมีคำว่า "ป้าย" แม้จะพูดถึงเรื่องอื่นล้วน ๆ (เจอตอนเขียนเทสต์)
  // ยกเว้นคำสั่งที่ตั้งใจไม่มี trigger เลย — ตอนนั้นคำบังคับคือสัญญาณเดียวที่มี
  if (!score && _arr(cmd.require_all).length && !_arr(cmd.triggers).length) score = 1;
  return score;
}

/** ดึงค่าที่คำสั่งต้องใช้ออกจากประโยคเดียวกัน */
function extractSlots(rawText, cmd, now = new Date()) {
  const want = new Set(_arr(cmd.slots).map(String));
  const out = {};
  if (want.has('period')) {
    const p = parseThaiPeriod(rawText, now);
    if (p) out.period = p;
  }
  if (want.has('limit')) {
    const n = parseLimit(rawText);
    if (n) out.limit = n;
  }
  if (want.has('hours')) {
    // "หยุดแจ้งเตือน 1กอ88 3 ชั่วโมง" — ตัวเลขที่ตามด้วยหน่วยเวลาเท่านั้น
    // ไม่ใช้ parseThaiPeriod เพราะนี่คือ "นานแค่ไหน" ไม่ใช่ "ช่วงไหน"
    const m = thaiDigits(rawText).match(/(\d+)\s*(?:ชั่วโมง|ชม\.?|hr|hour)/i);
    if (m) out.hours = Math.min(Math.max(parseInt(m[1], 10), 1), 168);
  }
  if (want.has('plate')) {
    // ป้ายไทย: 1-2 ตัวอักษร/เลขนำ + พยัญชนะไทย 1-3 ตัว + เลข 1-4 ตัว
    const m = thaiDigits(rawText).match(/\b(\d{0,2}[ก-ฮ]{1,3}\s?\d{1,4})\b/);
    if (m) out.plate = m[1].replace(/\s/g, '');
  }
  if (want.has('province')) {
    // ต้องมีคำว่า "จังหวัด" นำเสมอ — ชื่อจังหวัดหลายตัวเป็นชื่อไซต์ด้วย ("ภูเก็ต")
    // ถ้าจับจากชื่อลอย ๆ จะแยกไม่ออกว่า "ที่ภูเก็ต" (สถานที่) กับ "ป้ายจังหวัดภูเก็ต" (ทะเบียน)
    // ⚠️ ไม่มีรายชื่อจังหวัดฝังไว้ — ส่งคำที่พิมพ์มาให้ endpoint กรองตรง ๆ
    //    สะกดผิดจะได้ 0 พร้อมข้อความให้ตรวจชื่อ ดีกว่ามีรายชื่อที่ต้องตามอัปเดตตลอด
    const m = String(rawText).match(/จังหวัด\s*([\u0E00-\u0E7F]+(?:\s[\u0E00-\u0E7F]+){0,2})/);
    if (m) {
      const p = m[1].trim().split(/\s+/)[0];
      if (p.length >= 2) out.province = p;
    }
  }
  if (want.has('face_attrs')) {
    // ชุดคำตายตัวเหมือน object_class จึงอยู่ในฟังก์ชันบริสุทธิ์ตัวนี้ได้
    const a = parseFaceAttrs(rawText);
    if (Object.keys(a).length) out.face_attrs = a;
  }
  if (want.has('object_class')) {
    // ชุดคำตายตัว (ไม่ต้องอ่าน DB) จึงอยู่ในฟังก์ชันบริสุทธิ์ตัวนี้ได้
    // ต่างจาก `category` ที่ชื่อหมวดตั้งเองต่อไซต์ ⇒ ต้องไปจับใน lineCommandRun
    const cls = matchObjectClass(rawText);
    if (cls) out.object_class = cls;
  }
  if (want.has('object_id')) {
    // "ขอรูปวัตถุ 121766" — เลขนี้อยู่บนหน้าจอรายละเอียดเหตุการณ์ (รหัสวัตถุ)
    const m = thaiDigits(rawText).match(/(?:วัตถุ|object|id)\s*(?:เลข|ที่)?\s*(\d{3,12})/i);
    if (m) out.object_id = m[1];
  }
  if (want.has('site')) {
    // ใช้ตัวจับชื่อไซต์ตัวเดียวกับที่ใช้ตอนอ่านคำตอบ (รับทั้งชื่อไทย อังกฤษ และรหัส)
    // 🔴 เดิมเทียบกับ `name` อย่างเดียวซึ่งเป็นอังกฤษล้วน ("Phuket") ⇒ พิมพ์ "ภูเก็ต"
    // มาในประโยคแรกไม่เคยติดเลย บอทถามกลับทุกครั้งทั้งที่ผู้ใช้ระบุมาแล้ว
    // (เจอจากภาพหน้าจอของเจ้าของ 2026-09-08 — เทสต์เดิมใช้ label อังกฤษจึงไม่จับ)
    const hit = matchSite(rawText, _arr(cmd._sites));
    if (hit) out.site = hit.code;
  }
  return out;
}

/**
 * เลือกคำสั่งที่ตรงที่สุด
 * @param {string} text ประโยคดิบจาก LINE
 * @param {object[]} commands แถวจาก line_commands (เติม `_sites` ได้ถ้าต้องการ slot site)
 * @param {object} opts { now, marginPct } — marginPct = อันดับ 1 ต้องนำอันดับ 2 กี่ %
 * @returns {{status:'ok'|'ambiguous'|'no_match', command?, score?, slots?, candidates?}}
 */
function matchCommand(text, commands, { now = new Date(), marginPct = 0.3 } = {}) {
  const norm = normalize(text);
  if (!norm) return { status: 'no_match', candidates: [] };

  // เทียบแบบตรงตัวก่อนเสมอ — ถอดวรรณยุกต์เป็น **ตาข่ายรอง** ใช้ต่อเมื่อไม่มีอะไรตรงเลย
  // (ถ้าปนกันในรอบเดียว คำที่สะกดถูกกับคำที่สะกดผิดจะได้คะแนนใกล้กันจนกลายเป็น "สูสี"
  // แล้วบอทถามกลับทั้งที่มีคำสั่งที่สะกดถูกอยู่ตรงหน้า)
  const rank = (loose) => (commands || [])
    .map((c) => ({ command: c, score: scoreCommand(norm, c, { loose }) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const strict = rank(false);
  const scored = strict.length ? strict : rank(true);

  if (!scored.length) return { status: 'no_match', candidates: [] };

  const top = scored[0];
  const second = scored[1];
  // สูสีเกินไป = ไม่เดา ถามกลับเป็นรายการให้เลือก · เดาผิดแล้วตอบเลขผิดแย่กว่าถามหนึ่งครั้ง
  if (second && (top.score - second.score) / top.score < marginPct) {
    return {
      status: 'ambiguous',
      candidates: scored.slice(0, 3).map((x) => x.command),
    };
  }
  return {
    status: 'ok',
    command: top.command,
    score: top.score,
    slots: extractSlots(text, top.command, now),
  };
}

/** คำสั่งที่ใกล้เคียงที่สุด ไว้เสนอกลับเมื่อจับไม่ได้ (แชร์คำอย่างน้อย 1 ตัวอักษรไทย) */
function suggest(text, commands, n = 3) {
  const norm = normalize(text);
  const words = norm.split(' ').filter((w) => w.length >= 3);
  return (commands || [])
    .filter((c) => c.enabled !== false)
    .map((c) => {
      let hit = 0;
      for (const t of _arr(c.triggers)) {
        const tl = String(t).toLowerCase();
        for (const w of words) {
          if (tl.includes(w) || w.includes(tl)) hit++;
          else if (tl.length >= LOOSE_MIN && (_loose(tl).includes(_loose(w))
                                              || _loose(w).includes(_loose(tl)))) hit++;
        }
      }
      return { c, hit };
    })
    // 🔴 ต้องมีคำซ้อนกันจริงอย่างน้อยหนึ่งคำ — ถ้าคืนคำสั่งมั่ว ๆ เมื่อไม่มีอะไรตรงเลย
    // บอทจะตอบ "ยังไม่เข้าใจคำสั่งนี้" ใส่ทุกบทสนทนาปกติในกลุ่ม (เจอตอนทดสอบจริง
    // 2026-09-08: "สวัสดีครับพี่ ๆ วันนี้ประชุมกี่โมง" ก็ได้คำตอบ)
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit)
    .slice(0, n)
    .map((x) => x.c);
}

module.exports = { normalize, scoreCommand, extractSlots, matchCommand, suggest };
