// ============================================================
// Vigil Platform — Stats page: line-selection keys
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// หน้า "สถิติเหตุการณ์" จำว่าเส้นไหนถูกเลือกขึ้นกราฟ เดิมจำด้วย **ชื่อการ์ดเปล่า ๆ**
// ซึ่งพังเมื่อชื่อซ้ำข้ามกลุ่ม: หมวดที่ผู้ใช้สร้างเอง (stat_group='standalone') ชื่อ
// "รถจักรยานยนต์ (IN)/(OUT)" ถูกตัดท้ายเหลือ base "รถจักรยานยนต์" ซึ่งตรงกับการ์ด
// ยานพาหนะอัตโนมัติเป๊ะ ๆ · พอกลุ่มใดกลุ่มหนึ่งถูกยุบ ขั้นตอน "ถอดเส้นของกลุ่มที่ยุบ"
// จะลบชื่อนั้นทิ้งโดยดูแค่ชื่อ การ์ดในกลุ่มที่ยังเปิดอยู่จึงถูกลบตามไปด้วยทุกครั้งที่
// เรนเดอร์ = กดแล้วเหมือนไม่มีอะไรเกิดขึ้น (เจอจริง 2026-09-04)
//
// ทางแก้: คีย์ทุกอย่างด้วย "กลุ่ม + ชื่อ" ไม่ใช่ชื่อเปล่า
// แยกออกมาเป็นไฟล์เพราะเป็น logic ล้วน — เทสต์จาก Node ได้โดยไม่ต้องมี DOM
// ============================================================
(function (global) {
  'use strict';

  // ตัวคั่นเป็น Unit Separator (U+001F) — ไม่มีทางปรากฏในชื่อหมวดที่ผู้ใช้พิมพ์
  // ('|' ใช้ไม่ได้ ของเดิมใช้คั่น IN/OUT อยู่แล้วและชื่อหมวดอาจมีอักขระนั้นได้)
  const SEP = '\u001f';

  const key    = (groupKey, base) => `${groupKey}${SEP}${base}`;
  const keyDir = (groupKey, base, dir) => `${groupKey}${SEP}${base}${SEP}${dir}`;
  const parse  = (k) => {
    const p = String(k).split(SEP);
    return { group: p[0], base: p[1], dir: p[2] || null };
  };
  // คีย์ทุกตัวของกลุ่มนี้ (ใช้ตอนยุบ/กาง) — เทียบ prefix จึงไม่แตะกลุ่มอื่นเด็ดขาด
  const inGroup = (k, groupKey) => String(k).startsWith(groupKey + SEP);

  // รายการคีย์ทั้งหมดที่ "เลือกได้" ในตอนนี้ — ใช้ทั้งตัดคีย์ตกยุคและหาค่าเริ่มต้น
  function allKeys(groups) {
    const out = [];
    (groups || []).forEach((g) => (g.cards || []).forEach((c) => {
      out.push({ key: key(g.key, c.base), group: g.key, base: c.base, card: c });
    }));
    return out;
  }

  // ค่าเริ่มต้น = หมวดในรายการที่ตั้งไว้ (ทุกกลุ่มที่ชื่อตรง) · ไม่มีเลย → 6 ใบแรก
  function pickDefaults(groups, defaultBases) {
    const entries = allKeys(groups);
    const want = new Set(defaultBases || []);
    const hit = entries.filter((e) => want.has(e.base)).map((e) => e.key);
    return new Set(hit.length ? hit : entries.slice(0, 6).map((e) => e.key));
  }

  // ถอดเส้นของกลุ่มที่ถูกยุบออกจากกราฟ แล้วพักไว้ใน stash เพื่อคืนตอนกางกลับ
  // ⚠️ หัวใจของบั๊ก: ต้องตัดสินด้วย "กลุ่ม" ของคีย์ ไม่ใช่ชื่อการ์ด
  // mutate ของที่ส่งเข้ามาโดยตรง (เรียกทุกรอบเรนเดอร์ — invariant ต้องคงอยู่ข้าม reload)
  function applyCollapse(groups, collapsed, sel, dirSel, extraSel, stash) {
    (groups || []).forEach((g) => {
      if (!collapsed.has(g.key)) return;
      const st = (stash[g.key] || (stash[g.key] = { bases: new Set(), dirs: new Set(), extras: new Set() }));
      [...sel].forEach((k) => { if (inGroup(k, g.key)) { sel.delete(k); st.bases.add(k); } });
      [...dirSel].forEach((k) => { if (inGroup(k, g.key)) { dirSel.delete(k); st.dirs.add(k); } });
      [...extraSel].forEach((k) => { if (inGroup(k, g.key)) { extraSel.delete(k); st.extras.add(k); } });
    });
  }

  global.StatsSel = { SEP, key, keyDir, parse, inGroup, allKeys, pickDefaults, applyCollapse };
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);

// Enable Node.js require() for tests
typeof module !== 'undefined' && (module.exports = global.StatsSel);
