// ============================================================
// Vigil Platform — Tests: helpers/htmlSanitize.js
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ที่มา 2026-09-24: /api/files รองรับ HTML แบบ "เปิดเป็นหน้าเว็บทันที" (เจ้าของ
// เลือกโหมดนี้แทนบังคับดาวน์โหลด) — ไฟล์นี้คือด่านความปลอดภัยจริง ไม่ใช่แค่
// sniffUploadType ที่บอกได้แค่ "หน้าตาเหมือน HTML" เท่านั้น
//
// ตรึงพฤติกรรมด้วยเวกเตอร์ XSS จริงที่รู้จัก ไม่ใช่แค่กรณีง่ายๆ — ตาม convention
// ของ upload-magic.test.js: ทำซ้ำ "แก้แล้ว node --check ผ่านแต่รูรั่ว" ให้เห็นว่า
// เทสต์นี้จะจับได้ถ้าใครลด allowlist ผิด

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeUploadedHtml } = require('../src/helpers/htmlSanitize');

describe('htmlSanitize.sanitizeUploadedHtml — ด่านความปลอดภัยจริงของ HTML upload', () => {
  it('script ถูกตัดทั้งแท็กและเนื้อใน ไม่ใช่แค่ unwrap', () => {
    const out = sanitizeUploadedHtml('<p>hi</p><script>alert(document.cookie)</script>');
    assert.ok(!out.includes('script'));
    assert.ok(!out.includes('alert'), 'เนื้อใน script ต้องหายไปด้วย ไม่ใช่แค่ tag');
    assert.ok(out.includes('<p>hi</p>'));
  });

  it('event handler attribute ทุกแบบถูกตัด', () => {
    for (const attr of ['onerror', 'onload', 'onclick', 'onmouseover']) {
      const out = sanitizeUploadedHtml(`<img src="x.png" ${attr}="alert(1)">`);
      assert.ok(!out.includes(attr), `${attr} ต้องหายไป`);
    }
  });

  it('javascript: URL ในทั้ง href และ data: ใน href ถูกตัด', () => {
    assert.ok(!sanitizeUploadedHtml('<a href="javascript:alert(1)">x</a>').includes('javascript:'));
    const dataUrl = sanitizeUploadedHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    assert.ok(!dataUrl.includes('data:'));
    assert.ok(!dataUrl.includes('<script'));
  });

  it('data: URI ยังใช้ใน <img> ได้ (รูปฝังในไฟล์เดียว เป็นกรณีใช้งานจริง)', () => {
    const out = sanitizeUploadedHtml('<img src="data:image/png;base64,iVBORw0KGgo=">');
    assert.ok(out.includes('data:image/png'));
  });

  it('แท็กที่เป็นช่องทาง XSS ทั้งชุดถูกตัดออก', () => {
    for (const tag of ['iframe', 'object', 'embed', 'form', 'base', 'meta']) {
      const out = sanitizeUploadedHtml(`<${tag} src="x" href="x"></${tag}>`);
      assert.ok(!out.includes(`<${tag}`), `<${tag}> ต้องหายไป`);
    }
  });

  // 2026-09-24 เจ้าของเลือกเปิด SVG ฝังใน HTML (แผนผังระบบหายทั้งภาพถ้าตัด)
  // เปิดแค่แท็กวาดรูป — ตัวที่เป็นช่องทางต้องยังหายครบ
  it('svg วาดรูปรอด แต่ script/on*/use/image/foreignObject/animate ข้างในหายหมด', () => {
    const out = sanitizeUploadedHtml(
      '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script>' +
      '<defs><marker id="m" refX="1"><path d="M0 0"/></marker></defs>' +
      '<rect x="1" y="1" width="5" height="5" fill="#123" onclick="alert(3)"/>' +
      '<line x1="0" y1="0" x2="5" y2="5" marker-end="url(#m)"/>' +
      '<text x="1" y="9">ป้าย</text>' +
      '<use href="https://evil.example/x.svg#a"/><image href="https://evil.example/x.png"/>' +
      '<foreignObject><div>x</div></foreignObject><animate attributeName="href" to="javascript:alert(4)"/>' +
      '<a href="javascript:alert(5)"><text>y</text></a></svg>');
    for (const bad of ['alert', 'onload', 'onclick', '<use', '<image', 'foreignobject', '<animate', 'evil.example', 'javascript:']) {
      assert.ok(!out.toLowerCase().includes(bad.toLowerCase()), `${bad} ต้องหายไป`);
    }
    for (const good of ['<svg', 'viewbox="0 0 10 10"', '<rect', 'fill="#123"', 'marker-end="url(#m)"', '>ป้าย</text>']) {
      assert.ok(out.includes(good), `${good} ต้องรอด`);
    }
  });

  it('meta refresh (redirect โดยไม่ต้องมี JS เลย) ถูกตัด', () => {
    const out = sanitizeUploadedHtml('<meta http-equiv="refresh" content="0;url=http://evil.example">');
    assert.ok(!out.includes('meta'));
    assert.ok(!out.includes('evil.example'));
  });

  it('style attribute รอดทั้งค่า (flex/grid ต้องไม่ถูกตัด) — url() ถูกคุมที่ CSP ไม่ใช่ที่นี่', () => {
    const out = sanitizeUploadedHtml('<div style="display:flex;gap:8px;grid-template-columns:1fr 1fr">t</div>');
    assert.ok(out.includes('display:flex'));
    assert.ok(out.includes('grid-template-columns'));
  });

  it('ลิงก์ออกทุกอันถูกบังคับ rel=noopener noreferrer nofollow กัน tabnabbing', () => {
    const out = sanitizeUploadedHtml('<a href="https://example.com">go</a>');
    assert.ok(out.includes('href="https://example.com"'));
    assert.ok(out.includes('noopener'));
    assert.ok(out.includes('noreferrer'));
  });

  it('เนื้อหาปกติของเอกสารที่แชร์ได้ (หัวข้อ ตาราง รูป ลิงก์) รอดครบ', () => {
    const doc = '<h1>รายงาน</h1><table><tr><td>1</td></tr></table>' +
      '<img src="https://example.com/chart.png" alt="chart"><a href="https://example.com">ดูเพิ่ม</a>';
    const out = sanitizeUploadedHtml(doc);
    assert.ok(out.includes('<h1>รายงาน</h1>'));
    assert.ok(out.includes('<table>'));
    assert.ok(out.includes('src="https://example.com/chart.png"'));
  });

  it('รับทั้ง Buffer และ string', () => {
    assert.equal(sanitizeUploadedHtml(Buffer.from('<p>x</p>')), sanitizeUploadedHtml('<p>x</p>'));
  });
});
