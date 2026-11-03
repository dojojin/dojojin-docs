// ============================================================
// Vigil Platform — แยก "ช่วงเวลา" ออกจากประโยคภาษาไทย
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ใช้กับคำสั่งผ่าน LINE — "ขอทราบยอดคนไม่สวมหมวกนิรภัย ชั่วโมงที่แล้ว หน่อย"
//
// นิยามที่ต้องตกลงกันให้ชัดตั้งแต่ต้น เพราะสองอย่างนี้ให้คำตอบคนละเลข:
//   "ชั่วโมงที่แล้ว" = **ชั่วโมงเต็มก่อนหน้า** (ถามตอน 15:20 ⇒ 14:00-14:59)
//                      ไม่ใช่ 60 นาทีล่าสุด (14:20-15:20)
// เลือกแบบแรกเพราะเป็นสิ่งที่คนพูดถึงจริงเวลาถามหาสถิติ และเทียบกับรายงานรายชั่วโมง
// ที่มีอยู่แล้วได้ตรง ๆ · การ์ดคำตอบต้องพิมพ์ช่วงที่ตีความได้กลับไปเสมอ ให้คนค้านได้
//
// เขตเวลาตายตัว Asia/Bangkok เหมือน routes/traffic.js — ทุกกล้องอยู่ไทย
// ============================================================
'use strict';

const TZ_OFFSET_MIN = 7 * 60;   // ไทยไม่มี DST ⇒ ค่าคงที่ปลอดภัยกว่าการพึ่ง locale ของเครื่อง

/** แปลงเลขไทยเป็นอารบิก — เจ้าหน้าที่พิมพ์ "๓ วัน" มาได้ */
function thaiDigits(s) {
  return String(s).replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)));
}

// เวลาไทยของ instant หนึ่ง ในรูป "ชิ้นส่วน" ที่คำนวณต่อได้
function _parts(d) {
  const t = new Date(d.getTime() + TZ_OFFSET_MIN * 60000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(),
           h: t.getUTCHours(), mi: t.getUTCMinutes() };
}
// สร้าง instant จริงจากเวลาไทย
function _mk(y, m, d, h = 0, mi = 0, s = 0, ms = 0) {
  return new Date(Date.UTC(y, m, d, h, mi, s, ms) - TZ_OFFSET_MIN * 60000);
}

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                   'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** ป้ายกำกับที่พิมพ์กลับไปในการ์ด — ต้องอ่านแล้วรู้ทันทีว่าระบบเข้าใจว่าอะไร */
function _label(kind, from, to) {
  const f = _parts(from), t = _parts(new Date(to.getTime() - 1));
  const hh = (x) => String(x).padStart(2, '0');
  const day = (p) => `${p.d} ${MONTHS_TH[p.m]}`;
  if (kind === 'clock') {
    // ปลายช่วงพิมพ์ค่าจริง (ไม่ลบ 1 มิลลิวินาที) — คนพิมพ์ 18:00-19:00 ต้องเห็น 19:00
    const e = _parts(to);
    const sameDay = e.d === f.d && e.m === f.m;
    return `${day(f)} ${hh(f.h)}:${hh(f.mi)}-${sameDay ? '' : day(e) + ' '}${hh(e.h)}:${hh(e.mi)}`;
  }
  if (kind === 'hour')      return `${day(f)} ${hh(f.h)}:00-${hh(f.h)}:59`;
  if (kind === 'this_hour') return `${day(f)} ${hh(f.h)}:00 ถึงตอนนี้`;
  if (kind === 'today')     return `วันนี้ ${day(f)}`;
  if (kind === 'yesterday') return `เมื่อวาน ${day(f)}`;
  if (kind === 'day')       return day(f);
  return `${day(f)} - ${day(t)}`;
}

function _res(kind, from, to, extra = {}) {
  return {
    kind,
    from,
    to,
    label: _label(kind, from, to),
    // ชั่วโมงเต็มที่ครอบช่วงนี้ — endpoint ฝั่ง traffic รับเป็น "จำนวนวัน" อย่างเดียว
    // จึงต้องมีทั้งสองหน่วยให้ตัวแปลง query เลือกใช้
    hours: Math.max(1, Math.round((to - from) / 3600000)),
    days: Math.max(1, Math.ceil((to - from) / 86400000)),
    ...extra,
  };
}

/**
 * หา "ช่วงเวลา" จากประโยค
 * @param {string} text ประโยคที่ผู้ใช้พิมพ์
 * @param {Date}   now  เวลาอ้างอิง (ฉีดเข้ามาได้เพื่อทดสอบ)
 * @returns {object|null} null = ประโยคนี้ไม่ได้ระบุช่วงเวลา (ให้ผู้เรียกใช้ค่าเริ่มต้นของคำสั่ง)
 */
function _parseBase(text, now) {
  const s = thaiDigits(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const p = _parts(now);

  // ── ชั่วโมง ────────────────────────────────────────────────
  // "ชั่วโมงที่แล้ว / ชั่วโมงที่ผ่านมา / ชม.ที่แล้ว" (ไม่มีตัวเลขนำหน้า)
  if (/(?<!\d\s?)(ชั่วโมง|ชม\.?)\s*(ที่แล้ว|ที่ผ่านมา|ก่อน)/.test(s) && !/\d\s*(ชั่วโมง|ชม\.?)/.test(s)) {
    const to = _mk(p.y, p.m, p.d, p.h);          // ต้นชั่วโมงนี้ = ปลายของชั่วโมงที่แล้ว
    return _res('hour', new Date(to.getTime() - 3600000), to);
  }
  if (/ชั่วโมงนี้|ชม\.?\s*นี้/.test(s)) {
    return _res('this_hour', _mk(p.y, p.m, p.d, p.h), now);
  }
  // "12 ชั่วโมงที่ผ่านมา" — ย้อนหลังจากเดี๋ยวนี้จริง ๆ (คนถามแบบนี้ต้องการเวลาวิ่ง)
  const mh = s.match(/(\d+)\s*(?:ชั่วโมง|ชม\.?)/);
  if (mh) {
    const n = Math.min(parseInt(mh[1], 10), 720);
    if (n > 0) return _res('range', new Date(now.getTime() - n * 3600000), now);
  }

  // ── วัน ───────────────────────────────────────────────────
  if (/เมื่อวาน|เมื่อวานนี้|วานนี้/.test(s)) {
    const start = _mk(p.y, p.m, p.d - 1);
    return _res('yesterday', start, _mk(p.y, p.m, p.d));
  }
  if (/วันนี้|ทั้งวัน/.test(s)) {
    return _res('today', _mk(p.y, p.m, p.d), now);
  }
  const md = s.match(/(\d+)\s*วัน/);
  if (md) {
    const n = Math.min(parseInt(md[1], 10), 365);
    if (n > 0) return _res('range', _mk(p.y, p.m, p.d - (n - 1)), now);
  }
  if (/สัปดาห์นี้|อาทิตย์นี้|7\s*วัน|สัปดาห์ที่ผ่านมา/.test(s)) {
    return _res('range', _mk(p.y, p.m, p.d - 6), now);
  }
  if (/เดือนที่แล้ว|เดือนก่อน/.test(s)) {
    return _res('range', _mk(p.y, p.m - 1, 1), _mk(p.y, p.m, 1));
  }
  if (/เดือนนี้/.test(s)) {
    return _res('range', _mk(p.y, p.m, 1), now);
  }

  // ── วันที่ระบุ: "1 ก.ย." · "1 กันยายน" · "1/9/2569" · "2026-09-01" ─────
  const MONTH_WORDS = ['มกรา', 'กุมภา', 'มีนา', 'เมษา', 'พฤษภา', 'มิถุนา',
                       'กรกฎา', 'สิงหา', 'กันยา', 'ตุลา', 'พฤศจิกา', 'ธันวา'];
  const mw = s.match(new RegExp(`(\\d{1,2})\\s*(${MONTH_WORDS.join('|')})`));
  if (mw) {
    const mi = MONTH_WORDS.indexOf(mw[2]);
    return _res('day', _mk(p.y, mi, +mw[1]), _mk(p.y, mi, +mw[1] + 1));
  }
  const mAbbr = s.match(/(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)/);
  if (mAbbr) {
    const mi = MONTHS_TH.indexOf(mAbbr[2]);
    return _res('day', _mk(p.y, mi, +mAbbr[1]), _mk(p.y, mi, +mAbbr[1] + 1));
  }
  // ปี พ.ศ. ที่คนพิมพ์จริง (2569) ต้องลบ 543 — ไม่งั้นได้ช่วงเวลาปีค.ศ. 2569 ที่ไม่มีข้อมูล
  const mSlash = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (mSlash) {
    let y = parseInt(mSlash[3], 10);
    if (y < 100) y += 2500;                 // "69" = พ.ศ. 2569
    if (y > 2400) y -= 543;
    return _res('day', _mk(y, +mSlash[2] - 1, +mSlash[1]), _mk(y, +mSlash[2] - 1, +mSlash[1] + 1));
  }
  const mIso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) {
    return _res('day', _mk(+mIso[1], +mIso[2] - 1, +mIso[3]), _mk(+mIso[1], +mIso[2] - 1, +mIso[3] + 1));
  }

  return null;
}

/**
 * ช่วงนาฬิกาในประโยค — "18:00-19:00" · "18-19 น." · "ตอน 18 โมง"
 * คืน {fromMin, toMin} เป็นนาทีนับจากเที่ยงคืน (toMin เป็นขอบขวาแบบไม่รวม)
 *
 * ⚠️ ต้องมีเครื่องหมายบอกว่าเป็น "เวลา" จริง (`:` หรือ น./โมง/นาฬิกา) เสมอ
 * ไม่งั้น "3-5 วัน" หรือ "top 5" จะกลายเป็นช่วงเวลาไปด้วย
 */
function _parseClock(text) {
  const s = thaiDigits(String(text || '')).replace(/\s+/g, ' ');
  const mm = (h, m) => Math.min(h, 23) * 60 + Math.min(m || 0, 59);

  // 18:00-19:00 · 18.00 ถึง 19.00
  let m = s.match(/(\d{1,2})[:.](\d{2})\s*(?:-|–|—|ถึง)\s*(\d{1,2})[:.](\d{2})/);
  if (m) return { fromMin: mm(+m[1], +m[2]), toMin: mm(+m[3], +m[4]) };

  // 18-19 น. · 18 ถึง 19 โมง  (ต้องมีหน่วยเวลาปิดท้าย ไม่งั้นชนกับ "3-5 วัน")
  m = s.match(/(\d{1,2})\s*(?:-|–|—|ถึง)\s*(\d{1,2})\s*(?:น\.|นาฬิกา|โมง)/);
  if (m) return { fromMin: mm(+m[1], 0), toMin: mm(+m[2], 0) };

  // ตอน 18 โมง · 18 น. → ชั่วโมงนั้นชั่วโมงเดียว
  m = s.match(/(?:ตอน|เวลา)?\s*(\d{1,2})\s*(?:น\.|นาฬิกา|โมง)/);
  if (m) { const h = +m[1]; return { fromMin: mm(h, 0), toMin: mm(h, 0) + 60 }; }

  // "10.30" หรือ "10:30" เดี่ยว ๆ → ชั่วโมงนับจากนาทีนั้น
  // ⚠️ ต้องไม่มีตัวเลขต่อท้าย ("10.305") และชั่วโมง/นาทีต้องอยู่ในช่วงจริง ไม่งั้น
  //    เลขทศนิยมอื่นในประโยคจะกลายเป็นเวลาไปด้วย
  m = s.match(/(?:^|[^\d])(\d{1,2})[:.](\d{2})(?![\d])/);
  if (m && +m[1] <= 23 && +m[2] <= 59) {
    return { fromMin: mm(+m[1], +m[2]), toMin: mm(+m[1], +m[2]) + 60 };
  }

  return null;
}

// ── ช่วงของวันแบบที่คนพูดจริง ────────────────────────────────────
// ขอบเขตชั่วโมงยึดตามที่ใช้อยู่แล้วใน helpers/acuseekPhrase.js (BANDS) เพื่อให้คำเดียวกัน
// หมายถึงช่วงเดียวกันทั้งสองฟีเจอร์ — แก้ที่ไหนต้องแก้ให้ตรงกันทั้งคู่
const BANDS = [
  { re: /เช้ามืด|หัวรุ่ง|ย่ำรุ่ง/,              from: 4,  to: 6,  th: 'เช้ามืด' },
  { re: /พักเที่ยง/,                           from: 12, to: 13, th: 'พักเที่ยง' },
  { re: /ดึก|ตอนดึก/,                          from: 0,  to: 5,  th: 'ดึก' },
  { re: /กลางคืน|ตอนกลางคืน|ช่วงกลางคืน|หัวค่ำ|ค่ำ/, from: 18, to: 6, th: 'กลางคืน' },
  { re: /ตอนเย็น|ช่วงเย็น/,                     from: 16, to: 18, th: 'ตอนเย็น' },
  { re: /ตอนบ่าย|ช่วงบ่าย|บ่าย/,                from: 12, to: 18, th: 'ช่วงบ่าย' },
  { re: /ตอนเช้า|ช่วงเช้า|เช้า/,                from: 6,  to: 12, th: 'ช่วงเช้า' },
];

// "ก่อน/หลัง <เวลา>" — ครึ่งวันจริง ๆ ไม่ใช่ชั่วโมงเดียว
// 🔴 ของเดิม "ก่อนเที่ยง" กับ "หลังเที่ยง" ให้ผลเท่ากันคือ 12:00-13:00 ทั้งคู่ ซึ่ง
//    "ก่อนเที่ยง" หมายถึงตรงข้ามเลย — เจ้าของเจอเอง 2026-09-09 จากประโยค
//    "สรุปจำนวนรถจักรยานยนต์ เมื่อวานก่อนเที่ยง ..." แล้วได้ยอดของช่วงบ่ายกลับไป
function _beforeAfter(s) {
  const anchor = () => {
    const h = _spokenHour(s.replace(/ก่อน|หลัง|ตั้งแต่|จนถึง|ถึง/g, ' '));
    if (h != null) return h;
    const m = s.match(/(\d{1,2})[:.](\d{2})/);
    return m ? +m[1] : null;
  };
  if (/ก่อน\s*(เที่ยง|\d|ตี|บ่าย|สาม|สอง|หนึ่ง|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)/.test(s)) {
    const h = anchor(); if (h != null) return { fromMin: 0, toMin: h * 60, label: `ก่อน ${h}:00` };
  }
  if (/หลัง\s*(เที่ยง|\d|ตี|บ่าย|สาม|สอง|หนึ่ง|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)/.test(s)) {
    const h = anchor(); if (h != null) return { fromMin: h * 60, toMin: 24 * 60, label: `หลัง ${h}:00` };
  }
  return null;
}

/** ชั่วโมงแบบที่คนไทยพูด — "ตีหนึ่ง" · "บ่ายสองโมง" · "สามทุ่ม" · "เที่ยง" */
const _NUM_TH = { หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10, สิบเอ็ด: 11 };
function _spokenHour(s) {
  const num = (t) => {
    const m = t.match(/^\d{1,2}$/) ? parseInt(t, 10) : _NUM_TH[t];
    return Number.isFinite(m) ? m : null;
  };
  const N = `(\\d{1,2}|${Object.keys(_NUM_TH).join('|')})`;
  let m;
  if (/เที่ยงคืน/.test(s)) return 0;
  if (/เที่ยงวัน|เที่ยงตรง|ตอนเที่ยง|เที่ยง/.test(s)) return 12;
  // ตี 1-5 = 01:00-05:00
  m = s.match(new RegExp(`ตี\\s*${N}`));
  if (m) { const h = num(m[1]); if (h >= 1 && h <= 5) return h; }
  // บ่าย 1-5 โมง = 13:00-17:00
  m = s.match(new RegExp(`บ่าย\\s*${N}`));
  if (m) { const h = num(m[1]); if (h >= 1 && h <= 5) return 12 + h; }
  // 1-6 ทุ่ม = 19:00-24:00
  m = s.match(new RegExp(`${N}\\s*ทุ่ม`));
  if (m) { const h = num(m[1]); if (h >= 1 && h <= 6) return 18 + h; }
  // 6-11 โมงเช้า = 06:00-11:00
  m = s.match(new RegExp(`${N}\\s*โมงเช้า`));
  if (m) { const h = num(m[1]); if (h >= 6 && h <= 11) return h; }
  m = s.match(new RegExp(`${N}\\s*โมง`));
  if (m) { const h = num(m[1]); if (h >= 1 && h <= 11) return h < 6 ? h + 12 : h; }
  return null;
}

/**
 * ช่วงเวลาจากประโยค = "วันไหน" (ตัวเดิม) แล้วค่อยหั่นด้วย "กี่โมงถึงกี่โมง" ถ้ามี
 *
 * เดิมช่วงนาฬิกาถูกทิ้งเงียบ ๆ — พิมพ์ "เมื่อวาน 18:00-19:00" ได้ยอดทั้งวันกลับมา
 * ซึ่งหน้าตาเหมือนคำตอบที่ถูกต้องทุกประการ (เจ้าของเจอเอง 2026-09-09)
 */
function parseThaiPeriod(text, now = new Date()) {
  const base = _parseBase(text, now);
  const t = thaiDigits(String(text || ''));
  // ลำดับความชัดเจน: ช่วงนาฬิกาเป๊ะ → ชั่วโมงที่คนพูด ("ตีหนึ่ง") → ช่วงของวัน ("ตอนเช้า")
  // คนพิมพ์ "ตอนเช้าช่วงตีหนึ่ง" มาพร้อมกันได้ ⇒ ตัวที่เจาะจงกว่าต้องชนะเสมอ
  let clock = _beforeAfter(t) || _parseClock(text);
  if (!clock) {
    const h = _spokenHour(t);
    if (h != null) clock = { fromMin: h * 60, toMin: h * 60 + 60 };
  }
  if (!clock) {
    const b = BANDS.find((x) => x.re.test(t));
    if (b) clock = { fromMin: b.from * 60, toMin: b.to * 60, label: b.th };
  }
  if (!clock) return base;

  // ต้องรู้ก่อนว่าวันไหน — ไม่ระบุมา = วันนี้ · ช่วงหลายวันไม่หั่น (หั่นแล้วได้ช่วงเดียว
  // ที่ไม่ตรงกับสิ่งที่ถาม เช่น "7 วัน 18:00-19:00" ไม่ใช่ "หนึ่งชั่วโมงของวันแรก")
  const p = _parts(now);
  // ติดธงไว้ให้การ์ดบอกตรง ๆ ว่าชั่วโมงที่ระบุมาไม่ได้ถูกใช้ — เงียบแล้วตอบทั้งช่วง
  // คือบั๊กเดิมที่กำลังแก้อยู่นี่เอง แค่ย้ายไปโผล่ที่ช่วงหลายวันแทน
  if (base && (base.to - base.from) > 86400000 + 1000) return { ...base, clockDropped: true };
  const d = _parts(base ? base.from : _mk(p.y, p.m, p.d));

  const from = _mk(d.y, d.m, d.d, 0, clock.fromMin);
  let to = _mk(d.y, d.m, d.d, 0, clock.toMin);
  // ข้ามเที่ยงคืน ("22:00-02:00") — ไม่งั้นได้ช่วงติดลบแล้วตอบว่าไม่มีข้อมูล
  if (to <= from) to = new Date(to.getTime() + 86400000);
  const r = _res('clock', from, to);
  // ระบุเป็นช่วงของวัน ("ตอนเช้า") ให้พิมพ์คำนั้นกำกับด้วย จะได้ค้านได้ว่าตีความตรงไหม
  if (clock.label) r.label = `${r.label} (${clock.label})`;
  return r;
}

/** จำนวนที่ขอ — "3 ป้าย" · "top 5" · "5 อันดับ" (เพดาน 20 เท่ากับหน้าเว็บ) */
function parseLimit(text, { max = 20 } = {}) {
  const s = thaiDigits(String(text || ''));
  const m = s.match(/(?:top|อันดับ|เอา|ขอ)\s*(\d+)/i)
         || s.match(/(\d+)\s*(?:ป้าย|อันดับ|รายการ|คัน|อัน)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, max);
}

module.exports = { parseThaiPeriod, parseLimit, thaiDigits };
