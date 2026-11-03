// ============================================================
// Vigil Platform — Tests: helpers/telegramCard.js (T2a)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Pure function — no DB, no network. Same buildAlertSections() shape used by
// lprLineAlert.js/gsAlarmLine.js.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fromSections, CAPTION_MAX } = require('../src/helpers/telegramCard');

describe('telegramCard.fromSections — escaping', () => {
  it('escapes HTML-special characters in labels and values', () => {
    const r = fromSections({
      title: 'เฝ้าระวัง', plate: '<script>', region: 'a & b',
      sections: [{ title: 'จากกล้อง', rows: [['<label>', 'a & b <c>']] }],
    });
    assert.ok(r.caption.includes('&lt;script&gt;'));
    assert.ok(r.caption.includes('a &amp; b'));
    assert.ok(r.caption.includes('&lt;label&gt;: a &amp; b &lt;c&gt;'));
    assert.ok(!r.caption.includes('<script>'), 'raw tag must never appear unescaped');
  });

  it('escapes quotes in the link href (attribute context, not just text)', () => {
    const r = fromSections({ plate: 'x', link: 'https://dashboard.example/?q="onmouseover=alert(1)' });
    assert.ok(r.caption.includes('&quot;onmouseover'));
    assert.ok(!r.caption.includes('"onmouseover'));
  });
});

describe('telegramCard.fromSections — layout', () => {
  it('bold title line + bold plate/region line', () => {
    const r = fromSections({ title: 'เฝ้าระวัง', plate: 'กษ9323', region: 'ภูเก็ต' });
    assert.ok(r.caption.startsWith('<b>เฝ้าระวัง</b>\n<b>กษ9323  ภูเก็ต</b>'));
  });

  it('a strong row bolds the whole label: value line', () => {
    const r = fromSections({ plate: 'x', sections: [{ title: 't', rows: [['ทะเบียน', 'กษ9323', true], ['ยานพาหนะ', 'เก๋ง']] }] });
    assert.ok(r.caption.includes('<b>ทะเบียน: กษ9323</b>'));
    assert.ok(r.caption.includes('ยานพาหนะ: เก๋ง') && !r.caption.includes('<b>ยานพาหนะ: เก๋ง</b>'));
  });

  it('rows with an empty value are dropped entirely (no dangling label)', () => {
    const r = fromSections({ plate: 'x', sections: [{ title: 't', rows: [['ว่าง', ''], ['เวลา', null], ['มีค่า', 'ok']] }] });
    assert.ok(!r.caption.includes('ว่าง:'));
    assert.ok(!r.caption.includes('เวลา:'));
    assert.ok(r.caption.includes('มีค่า: ok'));
  });

  it('a section with no non-empty rows is skipped (no empty header)', () => {
    const r = fromSections({ plate: 'x', sections: [{ title: 'หัวข้อว่าง', rows: [['a', '']] }, { title: 'จริง', rows: [['b', 'c']] }] });
    assert.ok(!r.caption.includes('หัวข้อว่าง'));
    assert.ok(r.caption.includes('จริง'));
  });

  it('noteText is used for the free-text fallback (custom template path)', () => {
    const r = fromSections({ title: 'เฝ้าระวัง', plate: 'x', noteText: 'ข้อความที่ผู้ใช้พิมพ์เอง' });
    assert.ok(r.caption.includes('ข้อความที่ผู้ใช้พิมพ์เอง'));
  });

  it('link appends a final "เปิดในระบบ" anchor line', () => {
    const r = fromSections({ plate: 'x', link: 'https://dashboard.example/?page=lpr&event=1' });
    assert.ok(r.caption.endsWith('<a href="https://dashboard.example/?page=lpr&amp;event=1">เปิดในระบบ</a>'));
  });

  it('no link => no anchor line', () => {
    const r = fromSections({ plate: 'x' });
    assert.ok(!r.caption.includes('<a href'));
  });

  it('Thai text round-trips untouched (no mangling of multi-byte content)', () => {
    const r = fromSections({
      title: 'รถตามหมายจับ', plate: 'กษ9323', region: 'ภูเก็ต',
      sections: [{ title: 'ข้อมูลอ้างอิง · บัญชีดำ', rows: [['คดี', 'ลักทรัพย์'], ['แจ้งเหตุที่', 'สภ.นราธิวาส']] }],
    });
    assert.ok(r.caption.includes('รถตามหมายจับ'));
    assert.ok(r.caption.includes('ข้อมูลอ้างอิง · บัญชีดำ'));
    assert.ok(r.caption.includes('คดี: ลักทรัพย์'));
    assert.ok(r.caption.includes('แจ้งเหตุที่: สภ.นราธิวาส'));
  });
});

describe('telegramCard.fromSections — 1024 cap + overflow', () => {
  it('short caption fits whole, overflow is null', () => {
    const r = fromSections({ title: 't', plate: 'x' });
    assert.ok(r.caption.length <= CAPTION_MAX);
    assert.equal(r.overflow, null);
  });

  it('caption longer than 1024 is cut at a line boundary, not mid-tag or mid-word', () => {
    const rows = [];
    for (let i = 0; i < 60; i++) rows.push([`แถวที่ ${i}`, `ค่าของแถวนี้คือหมายเลข ${i} และมีข้อความยาวพอสมควร`]);
    const r = fromSections({ title: 'หัวข้อยาว', plate: 'กก1234', sections: [{ title: 's', rows }] });
    assert.ok(r.caption.length <= CAPTION_MAX);
    assert.ok(r.overflow && r.overflow.length > 0, 'must overflow given 60 long rows');
    // ตัดที่ขอบบรรทัดเสมอ — ต่อ caption+\n+overflow กลับต้องได้เนื้อหาเดิมทั้งก้อน
    // (พิสูจน์ว่าไม่มี tag ถูกตัดครึ่งเพราะแต่ละบรรทัดปิด tag ของตัวเองสมบูรณ์)
    assert.ok(!r.caption.endsWith('<b>') && !r.caption.match(/<[^>]*$/), 'must not cut mid-tag');
    const openTags = (r.caption.match(/<b>/g) || []).length;
    const closeTags = (r.caption.match(/<\/b>/g) || []).length;
    assert.equal(openTags, closeTags, 'caption HTML must be well-formed after the cut');
  });
});
