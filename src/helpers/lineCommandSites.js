// ============================================================
// Vigil Platform — ไซต์สำหรับคำสั่งผ่าน LINE: มีอะไรให้เลือก · แปลงเป็นกล้อง
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ทำไมส่ง `cameras=` ไม่ใช่ `sites=`: จาก 3 endpoint ที่คำสั่งชุดแรกใช้ มีแค่
// /api/traffic/helmet-top ที่รับ `sites` ส่วน helmet-series กับ /api/lpr/stats
// รับแต่ `cameras` ⇒ แปลงเป็นรายชื่อกล้องที่นี่ที่เดียว แล้วทุก endpoint ใช้ทางเดียวกัน
// (ทางเลือกอื่นคือไปเพิ่ม `sites` ให้อีกสอง endpoint ซึ่งแตะโค้ดที่หน้าเว็บใช้อยู่จริง
//  เพื่อประโยชน์ของ LINE อย่างเดียว — ไม่คุ้มความเสี่ยง)
//
// 🔒 การส่ง `cameras=` **ไม่ใช่การให้สิทธิ์** — endpoint ยังใส่ siteWhere(allowedSites)
// ทับอีกชั้นเสมอ ผลลัพธ์คือส่วนร่วมของสองอย่าง · ส่งกล้องที่ไม่มีสิทธิ์ไปก็ได้ศูนย์
// ============================================================
'use strict';

/**
 * ไซต์ที่บัญชีนี้ถามได้จริง — ใช้สร้างตัวเลือกตอนบอทถามกลับว่า "ไซต์ไหน"
 * ห้ามเสนอไซต์ที่เขาถามไปก็ไม่ได้ข้อมูล
 * @returns {Promise<Array<{code,name,site_id}>>}
 */
async function sitesForUser(pool, auth, user) {
  const allowed = await auth.getAllowedSites(user, pool);   // null = ทุกไซต์
  const { rows } = await pool.query(
    `SELECT id AS site_id, code, name, name_th FROM sites
      ${allowed ? 'WHERE id = ANY($1)' : ''}
      ORDER BY sort_order, id`,
    allowed ? [Array.from(allowed)] : []);
  // ไซต์ 'main' คือฝั่ง central ที่ไม่มีกล้องจราจรของตัวเอง — ไม่ต้องเสนอให้เลือก
  // ถ้าไม่มีกล้องอยู่จริง (กันตัวเลือกที่กดแล้วได้ศูนย์เสมอ)
  const { rows: counts } = await pool.query(
    `SELECT site_id, count(*)::int AS n FROM cameras WHERE site_id IS NOT NULL GROUP BY 1`);
  const have = new Map(counts.map((c) => [c.site_id, c.n]));
  return rows.filter((r) => (have.get(r.site_id) || 0) > 0);
}

/** ชื่อที่เอาไว้โชว์ — ไทยก่อนถ้ามี (คนตอบบอทเป็นภาษาไทย) */
const siteLabel = (s) => s.name_th || s.name || s.code;

/** หาไซต์จากคำที่ผู้ใช้พิมพ์ — รับทั้งชื่อไทย ชื่ออังกฤษ และรหัส */
function matchSite(text, sites) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  const words = (s) => [s.name_th, s.name, s.code].filter(Boolean).map((x) => String(x).toLowerCase());
  for (const s of sites) {
    if (words(s).includes(t)) return s;
  }
  // ไม่ตรงเป๊ะค่อยหาแบบมีคำนั้นอยู่ในประโยค (ลำดับนี้สำคัญ: "hdy" ไม่ควรชนะ "hkt"
  // เพียงเพราะมาก่อนในรายการ ถ้าผู้ใช้พิมพ์ชื่อเต็มมาแล้ว)
  for (const s of sites) {
    if (words(s).some((w) => w.length >= 2 && t.includes(w))) return s;
  }
  return null;
}

/** camera_id ทั้งหมดของไซต์ — ส่งต่อเป็นพารามิเตอร์ `cameras` ให้ endpoint */
async function camerasOfSite(pool, siteCode) {
  const { rows } = await pool.query(
    `SELECT c.id FROM cameras c JOIN sites s ON s.id = c.site_id WHERE s.code = $1`,
    [siteCode]);
  // parseCams ของ traffic.js ตัดที่ 200 ตัว — ไซต์ใหญ่สุดตอนนี้ 84 กล้อง ยังห่างเพดาน
  // ถ้าวันหน้าเกิน ต้องเปลี่ยนไปใช้ `sites=` แทน ไม่ใช่ปล่อยให้ถูกตัดเงียบ ๆ
  return rows.map((r) => r.id).slice(0, 200);
}


/**
 * กล้องที่บัญชีนี้ดูได้ — ใช้ทั้งตอนจับชื่อกล้องจากประโยค และตอนสร้างตัวเลือกให้เลือก
 * ⚠️ ต้องผ่าน auth.scopedCameraIds() เท่านั้น ห้ามเขียน `WHERE site_id = ANY()` เอง —
 * แกน "จำกัดรายกล้อง" (user_cameras) เดินทางมากับ scope เป็น property ที่มีแต่ helper
 * ในไฟล์ auth เท่านั้นที่อ่าน (GOTCHAS #166)
 */
async function camerasForUser(pool, auth, user) {
  const scope = await auth.getAllowedSites(user, pool);
  // ⚠️ scopedCameraIds() คืน **Set** ไม่ใช่ array — ส่ง Set เข้า ANY($1) ตรง ๆ pg แปลงเป็น
  // `{}` แล้วไม่ match อะไรเลย โดยไม่มี error (บัญชีที่ถูกจำกัดจะกลายเป็น "ไม่มีกล้อง"
  // ทั้งที่มี 4 ตัว — เจอตอนทดสอบ 2026-09-08)
  const ids = await auth.scopedCameraIds(scope, pool);   // null = ไม่จำกัด
  const idList = ids ? Array.from(ids) : null;
  const { rows } = await pool.query(
    `SELECT c.id, c.name, s.code AS site_code, s.name AS site_name, s.name_th AS site_name_th
       FROM cameras c LEFT JOIN sites s ON s.id = c.site_id
      ${idList ? 'WHERE c.id = ANY($1)' : ''}
      ORDER BY c.name`, idList ? [idList] : []);
  return rows;
}

/** กล้องทั้งระบบ — ใช้เฉพาะเพื่อ "รู้ว่าเขาพูดถึงกล้องที่ไม่มีสิทธิ์" แล้วบอกให้ชัด
 *  ห้ามเอาไปใช้เป็นขอบเขตของคำตอบเด็ดขาด */
async function allCameras(pool) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, s.code AS site_code FROM cameras c LEFT JOIN sites s ON s.id = c.site_id`);
  return rows;
}

// ชื่อกล้องของจริงเป็นแบบ "หน้าโรงเรียนนาบอน (C20)" — ส่วนในวงเล็บคือรหัสที่คนใช้เรียกกัน
const _camCode = (name) => {
  const m = String(name || '').match(/\(([^)]{1,12})\)\s*$/);
  return m ? m[1].trim().toLowerCase() : null;
};
const _camBase = (name) => String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();

/**
 * หากล้องจากประโยค — คืน { exact } เมื่อชี้ตัวเดียวได้ หรือ { many } เมื่อกำกวม
 *
 * ของจริงมีกล้องชื่อฐานเดียวกันต่างแค่เลขในวงเล็บ (C19/C20 = "หน้าโรงเรียนนาบอน")
 * ⇒ พูดแค่ชื่อฐานต้องถามกลับ ไม่ใช่หยิบตัวแรกมาตอบแล้วเงียบ
 *
 * ⚠️ จับหลังเลือกคำสั่งได้แล้วเท่านั้น — ชื่อกล้องบางตัวมีคำที่ชนกับคำเรียกคำสั่งได้
 * และห้ามจับคำสั้น (< 4 ตัวอักษร) นอกจากเป็นรหัสในวงเล็บ ไม่งั้นชื่อกล้องอย่าง "C4"
 * จะไปตรงกับตัวอักษรที่โผล่ในประโยคทั่วไป
 */
function matchCamera(text, cams, { stop = [] } = {}) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  // 1) ชื่อเต็มพร้อมวงเล็บ — แม่นที่สุด เอาก่อนเสมอ
  for (const c of cams) {
    const full = String(c.name || '').toLowerCase();
    if (full.length >= 4 && t.includes(full)) return { exact: c };
  }
  // 2) รหัสในวงเล็บ ("c20") — ต้องมีขอบเขตคำ ไม่งั้น "c2" ไปตรงกลางคำอื่น
  for (const c of cams) {
    const code = _camCode(c.name);
    if (code && code.length >= 2 && new RegExp(`(^|[^a-z0-9])${code}([^a-z0-9]|$)`, 'i').test(t)) {
      return { exact: c };
    }
  }
  // 3) camera_id ตรง ๆ (คนก๊อปมาจากหน้าเว็บ)
  for (const c of cams) {
    const id = String(c.id || '').toLowerCase();
    if (id.length >= 4 && t.includes(id)) return { exact: c };
  }
  // 4) ชื่อฐานไม่รวมวงเล็บ — ตรงได้หลายตัว
  const hits = cams.filter((c) => { const b = _camBase(c.name); return b.length >= 4 && t.includes(b); });
  if (hits.length === 1) return { exact: hits[0] };
  if (hits.length > 1) return { many: hits.slice(0, 8) };

  // 5) **ชื่อบางส่วน** — คนพูดถึงกล้องด้วยชื่อสถานที่ ไม่ใช่ชื่อเต็มในระบบ
  //    ของจริง 2026-09-09: "กล้องท่าฉัตรไชย" ไม่ติดเลย ทั้งที่มีกล้องชื่อนี้ 6 ตัว
  //    (ชื่อเต็มคือ "ก่อนถึงขาเข้าท่าฉัตรไชย (C2)" · "ด่านตรวจฉัตรไชยขาเข้า (C6)" ฯลฯ)
  //    เจอหลายตัวไม่ใช่ปัญหา — ผู้เรียกจะถามกลับว่าอันไหน ซึ่งดีกว่าเงียบแล้วตอบทั้งไซต์
  //
  // 🔴 อ่านเฉพาะคำที่อยู่ **หลังคำว่า "กล้อง"** เท่านั้น และตัดคำที่เป็นชื่อไซต์ทิ้ง
  //    ไม่งั้น "กล้องดับกี่ตัว ภูเก็ต" จะเอาคำว่า "ภูเก็ต" ไปตรงกับ "สนามบินภูเก็ต (C44)"
  //    แล้วถามกลับว่า "กล้องไหน" ทั้งที่ผู้ใช้ถามยอดของทั้งไซต์ (เจอตอนทดสอบ 2026-09-09)
  const cue = t.lastIndexOf('กล้อง');
  if (cue < 0) return null;
  const stopRe = (stop || []).map((x) => String(x).toLowerCase()).filter(Boolean);
  const words = t.slice(cue + 'กล้อง'.length)
    .replace(/เฉพาะ|ทั้งหมด|ทุกตัว|ที่|ของ|หน่อย|ครับ|ค่ะ/g, ' ')
    .split(/[\s,]+/)
    .filter((w) => w.length >= 4 && !stopRe.some((sn) => sn.includes(w) || w.includes(sn)));
  let used = null;
  const part = cams.filter((c) => {
    const b = _camBase(c.name).toLowerCase();
    const w = words.find((x) => b.length >= 4 && b.includes(x));
    if (w && !used) used = w;
    return !!w;
  });
  // `word` = คำที่ทำให้จับได้ — ผู้เรียกเอาไปเขียนบนการ์ดว่า "กล้องที่ชื่อมีคำว่า …"
  if (part.length === 1) return { exact: part[0], word: used };
  if (part.length > 1) return { many: part.slice(0, 12), word: used };
  return null;
}

/**
 * ชื่อหมวดเหตุการณ์ของไซต์หนึ่ง — ตัดวงเล็บ (IN)/(OUT) ทิ้งแล้วรวมเป็นชื่อเดียว
 * เพราะบนการ์ดก็รวมเป็นแถวเดียวอยู่แล้ว คนถามจึงพูดถึงชื่อฐาน ("รถจักรยานยนต์")
 * ไม่มีใครพิมพ์ "รถจักรยานยนต์ (IN)" มาเอง
 */
async function categoriesOfSite(pool, siteCode) {
  const { rows } = await pool.query(
    `SELECT c.name FROM event_categories c JOIN sites s ON s.id = c.site_id
      WHERE s.code = $1 ORDER BY c.sort_order, c.id`, [siteCode]);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const m = String(r.name || '').match(/^(.*?)\s*\((?:IN|OUT)\)\s*$/i);
    const base = (m ? m[1] : String(r.name || '')).trim();
    if (base && !seen.has(base)) { seen.add(base); out.push(base); }
  }
  return out;
}

/**
 * หาหมวดที่ผู้ใช้พูดถึงในประโยค — เอาชื่อที่ **ยาวที่สุด** ที่อยู่ในประโยค
 * ยาวที่สุดสำคัญ: ไซต์หนึ่งมีทั้ง "รถยนต์" และ "รถจักรยานยนต์" ซึ่งชื่อสั้นเป็นส่วนหนึ่ง
 * ของชื่อยาว — จับสั้นก่อนจะได้หมวดผิดทุกครั้งที่ถามหมวดยาว
 */
function matchCategory(text, names) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  let best = null;
  for (const n of names || []) {
    const k = String(n).toLowerCase();
    if (k.length >= 2 && t.includes(k) && (!best || k.length > best.length)) best = n;
  }
  return best;
}

module.exports = { sitesForUser, matchSite, camerasOfSite, siteLabel,
  camerasForUser, matchCamera, allCameras, categoriesOfSite, matchCategory };
