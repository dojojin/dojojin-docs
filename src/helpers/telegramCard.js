// ============================================================
// Vigil Platform — Telegram alert card (LPR/GuruSquare sections → HTML caption)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา: docs/reports/2026-09-24_telegram-plan.md (phase T2) — pure function,
// ไม่แตะ DB/network เลย รับ `sections` รูปร่างเดียวกับที่ buildAlertSections()
// (src/helpers/lprLineAlert.js) คืนออกมาพอดี แปลงเป็น Telegram HTML caption
//
// อัลบั้ม (sendMediaGroup) ใส่ inline keyboard ไม่ได้ — ปุ่ม "เปิดในระบบ" ของ LINE
// จึงกลายเป็นบรรทัดลิงก์ธรรมดาต่อท้าย caption แทน (ยังกดเปิดได้เหมือนเดิม)
//
// caption Telegram จำกัด 1,024 ตัวอักษร — ตัดที่ขอบบรรทัด (ไม่ตัดกลาง tag) ส่วนที่
// เกินคืนเป็น overflow ให้ผู้เรียกส่งเป็นข้อความตามหลัง (sendMessage รับได้ถึง 4,096)
'use strict';

const { escapeHtml } = require('./telegramSender');

const CAPTION_MAX = 1024;
const TEXT_MAX = 4096;   // เพดานของ sendMessage (ไม่ใช่ caption) — ใช้กับคำตอบคำสั่งแชท (T4)

// escapeHtml ของ telegramSender ครอบแค่ & < > (พอสำหรับเนื้อข้อความ) — ค่าที่ไปอยู่
// ใน attribute ของ <a href="..."> ต้องกัน " ด้วย ไม่งั้น URL ที่มี " หลุดออกจาก attribute
function _escAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function _row([label, value, strong] = []) {
  if (value == null || value === '') return null;
  const line = `${escapeHtml(label)}: ${escapeHtml(value)}`;
  return strong ? `<b>${line}</b>` : line;
}

/**
 * sections: [{ title, rows: [[label, value, strong?]] }] — เอาต์พุตตรงของ
 * buildAlertSections() ใน lprLineAlert.js ใช้ได้โดยไม่ต้องแปลงรูปร่างก่อน
 */
// label: บรรทัดแรกสุดก่อนหัวข้อ — ใช้ป้าย "ส่งด้วยตนเองโดย <ชื่อ>" ของการส่งเข้า
// Telegram ด้วยมือ (ฝั่ง LINE ติดป้ายนี้ไว้ในตัวข้อความ/การ์ดอยู่แล้ว แต่การ์ดตาราง
// อัตโนมัติของ Telegram ไม่เคยเห็น text ที่มีป้ายต่อหน้าเลย เพราะ noteText ส่งแค่ตอน
// ไม่มี sections — เพิ่มพารามิเตอร์แยกแทนที่จะพึ่ง noteText ไม่กระทบผู้เรียกเดิมที่ไม่ส่งมา)
function fromSections({ title, plate, region, sections, noteText, link, label } = {}) {
  const lines = [];
  if (label) lines.push(`<i>${escapeHtml(label)}</i>`);
  if (title) lines.push(`<b>${escapeHtml(title)}</b>`);
  if (plate) lines.push(`<b>${escapeHtml([plate, region].filter(Boolean).join('  '))}</b>`);

  for (const sec of (sections || [])) {
    const rows = (sec?.rows || []).map(_row).filter(Boolean);
    if (!rows.length) continue;
    lines.push('');
    if (sec.title) lines.push(`<b>${escapeHtml(sec.title)}</b>`);
    lines.push(...rows);
  }

  if (noteText) {
    lines.push('');
    lines.push(escapeHtml(noteText));
  }
  if (link) lines.push(`<a href="${_escAttr(link)}">เปิดในระบบ</a>`);

  return _cut(lines.join('\n'));
}

// ตัดที่ขอบบรรทัด (\n) เสมอ — แต่ละบรรทัดปิด tag ของตัวเองครบอยู่แล้ว (ไม่มี
// ค่าไหนมีบรรทัดใหม่อยู่ข้างใน) จึงตัดตรงนี้แล้วไม่มีทาง tag ค้างครึ่งเดียว
function _cut(full, max = CAPTION_MAX) {
  if (full.length <= max) return { caption: full, overflow: null };
  let cut = full.lastIndexOf('\n', max);
  if (cut <= 0) cut = max; // ไม่มีขอบบรรทัดในช่วงนี้เลย (แถวเดียวยาวมาก) — ตัดดิบ
  const caption = full.slice(0, cut);
  const overflow = full.slice(cut).replace(/^\n+/, '') || null;
  return { caption, overflow };
}

/**
 * แปลงการ์ดคำตอบของ handleLineText() (รูปร่างเดียวกับที่ buildAnswerFlex() ของ
 * line-sender.js ใช้ — title/period/big/unit/rows/rowsTotal/note/empty/emptyText/
 * photos/link) เป็นข้อความ HTML ส่งด้วย sendMessage (T4 — คำสั่งผ่าน Telegram)
 *
 * ไม่ประกอบอัลบั้มรูปให้ที่นี่ — คำสั่งที่ตอบเป็นรูป (เช่นค้นหาอัจฉริยะ) จะได้แค่
 * จำนวนภาพ + ลิงก์เปิดในระบบ แทนที่จะโหลดไฟล์/ยิง sendMediaGroup ในเส้นทางคำสั่งแชท
 * (ponytail: การ์ดข้อความ 4 ใน 5 คำสั่งเป็นตัวเลข/ตาราง ไม่ใช่รูป — ทำอัลบั้มเต็มรูปแบบ
 * เมื่อมีคำสั่งจริงที่ต้องใช้ ไม่ใช่เผื่อไว้ตอนนี้)
 */
function fromAnswerCard(card = {}) {
  const lines = [];
  if (card.title) lines.push(`<b>${escapeHtml(card.title)}</b>`);
  if (card.period) lines.push(escapeHtml(card.period));

  if (card.empty) {
    lines.push('');
    lines.push(escapeHtml(card.emptyText || 'ไม่พบข้อมูลในช่วงเวลานี้'));
  } else {
    if (card.big != null && card.big !== '') {
      lines.push('');
      lines.push(`<b>${escapeHtml(card.big)}${card.unit ? ' ' + escapeHtml(card.unit) : ''}</b>`);
    }
    const rows = Array.isArray(card.rows) ? card.rows.slice(0, 10) : [];
    if (rows.length) {
      lines.push('');
      for (const [k, v] of rows) lines.push(`${escapeHtml(k)}: <b>${escapeHtml(v)}</b>`);
      const total = Number(card.rowsTotal) || rows.length;
      if (total > rows.length) lines.push(`<i>แสดง ${rows.length} จาก ${total} รายการ</i>`);
    }
    // รูปส่งตามเป็นอัลบั้มแยก (telegramPoller._sendAnswerPhotos) ไม่ต้องบอกซ้ำในข้อความ
  }

  if (card.note) { lines.push(''); lines.push(escapeHtml(card.note)); }
  if (card.link) { lines.push(''); lines.push(`<a href="${_escAttr(card.link)}">เปิดในระบบ</a>`); }

  return _cut(lines.join('\n'), TEXT_MAX);
}

module.exports = { fromSections, fromAnswerCard, CAPTION_MAX, TEXT_MAX };

if (require.main === module) {
  const assert = require('assert');
  const r = fromSections({
    title: 'เฝ้าระวัง', plate: 'กษ9323', region: 'ภูเก็ต',
    sections: [{ title: 'ข้อมูลจากกล้อง', rows: [['ทะเบียน', 'กษ9323  ภูเก็ต', true], ['เวลา', '']] }],
    link: 'https://dashboard.example/?page=lpr&event=1',
  });
  assert.ok(r.caption.includes('<b>เฝ้าระวัง</b>'));
  assert.ok(r.caption.includes('<b>ทะเบียน: กษ9323  ภูเก็ต</b>'));
  assert.ok(!r.caption.includes('เวลา:'), 'ค่าว่างต้องถูกตัดทิ้งทั้งแถว');
  assert.ok(r.caption.includes('href="https://dashboard.example/?page=lpr&amp;event=1"'));
  assert.strictEqual(r.overflow, null);

  const a = fromAnswerCard({
    title: 'จำนวนผู้ไม่สวมหมวกนิรภัย', period: 'ภูเก็ต · ชั่วโมงที่แล้ว',
    big: 12, unit: 'ครั้ง', rows: [['C20 ท่าฉัตรไชย', 7], ['C21 หน้าโรงเรียน', 5]],
    note: 'ตัวเลขนี้นับเฉพาะกล้องที่เปิดตรวจจับหมวก', link: 'https://dashboard.example/?page=traffic',
  });
  assert.ok(a.caption.includes('<b>12 ครั้ง</b>'));
  assert.ok(a.caption.includes('C20 ท่าฉัตรไชย: <b>7</b>'));
  assert.ok(a.caption.includes('เปิดในระบบ</a>'));
  const empty = fromAnswerCard({ empty: true, emptyText: 'ไม่พบข้อมูล', big: 999 });
  assert.ok(empty.caption.includes('ไม่พบข้อมูล'));
  assert.ok(!empty.caption.includes('999'), 'การ์ดว่างต้องไม่แอบโชว์ big/rows ปนกับ emptyText');

  console.log('telegramCard self-check: all assertions passed');
}
