// ============================================================
// Vigil Platform — File type magic-byte validator for uploads
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Validates document/image buffers by checking magic bytes, not MIME type or filename.
// Supported: PNG, JPEG, PDF, DOCX, XLSX (ZIP containers), HTML.
// Spec: SEC-005 (file upload validation via magic bytes, never Content-Type).
//
// HTML (2026-09-24): unlike every other type here, this one gets rendered
// inline by the browser at our own URL (routes/files.js + media-files.js) —
// so passing this sniff is NOT enough on its own to call a file safe. The
// caller (routes/files.js) MUST run the result through
// helpers/htmlSanitize.js before writing it to disk. This function only
// answers "does it look like HTML text" — same job it does for every other
// type here, no more.
// docx/xlsx: Both ZIP containers; magic bytes only prove "this is a zip". We accept
// this deliberately: files are served with Content-Disposition:attachment +
// X-Content-Type-Options:nosniff from a separate hostname (no session cookie), so
// a zip that is not really a document is just a file the recipient cannot open,
// not a security hole. We DO NOT open the zip to read [Content_Types].xml.
'use strict';

/**
 * Sniffs upload buffer for supported file types by magic bytes.
 * Returns { ext, mime } or throws Error.
 *
 * @param {Buffer} buf - The buffer to validate
 * @param {string} originalName - Original filename (used only for ZIP to pick docx vs xlsx)
 * @returns {{ ext: string, mime: string }} - File extension and MIME type
 * @throws {Error} if unsupported, malformed, or SVG (XSS vector)
 */
function sniffUploadType(buf, originalName) {
  if (!Buffer.isBuffer(buf)) {
    throw new Error('expected a Buffer');
  }
  if (buf.length < 8) {
    throw new Error('buffer too small for magic-byte check');
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A (8 bytes)
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) {
    return { ext: 'png', mime: 'image/png' };
  }

  // JPEG: FF D8 FF (any third byte after FF D8 FF is valid)
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  // PDF: ASCII '%PDF' (25 50 44 46)
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { ext: 'pdf', mime: 'application/pdf' };
  }

  // ZIP: 50 4B 03 04 ('PK\x03\x04') — could be docx or xlsx
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) {
    // Extension from originalName determines which container type to claim.
    // Note: originalName is never used to build a path — only to pick between
    // two equally-safe labels for a ZIP whose content we don't inspect.
    const ext = (originalName || '').toLowerCase().split('.').pop();
    if (ext === 'docx') {
      return {
        ext: 'docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };
    }
    if (ext === 'xlsx') {
      return {
        ext: 'xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };
    }
    // ZIP without a recognized office extension is unsupported
    throw new Error('unsupported file type (ZIP must be .docx or .xlsx)');
  }

  // Check for SVG — an XSS pathway and explicitly refused outright.
  // Only check if we've already ruled out all raster/PDF formats,
  // since an XMP packet (Illustrator export) can contain 'svg' string
  // inside a valid JPEG/PNG.
  const head = buf.toString('utf8', 0, Math.min(1024, buf.length));
  const lead = head.replace(/^\uFEFF/, '').trimStart();
  // ไฟล์ SVG ล้วน (ขึ้นต้นด้วย <svg / <?xml / doctype svg) ปฏิเสธเสมอ — ตรวจก่อน HTML
  if (/^<(svg[\s>]|\?xml|!doctype\s+svg)/i.test(lead)) {
    throw new Error('SVG format not supported');
  }
  // HTML has no magic-byte signature (it's text) — look for the markers a
  // real HTML document opens with. Deliberately narrow (doctype, or an
  // <html>/<head>/<body> tag near the top, or a document that opens straight
  // with a <head>-only tag) rather than "contains a < somewhere", so a plain
  // .txt file that happens to mention a tag in prose doesn't pass. The security
  // work is NOT here — it's htmlSanitize.js + the CSP sandbox at serve time.
  //
  // เช็ค HTML **ก่อน** <svg ที่อยู่กลางไฟล์ (2026-09-24): เอกสาร HTML ที่มีแผนผัง
  // SVG ฝังอยู่ใน 1 KB แรกเคยโดนปัดตกว่าเป็น SVG · ขึ้นต้นด้วย <title>/<meta>/
  // <style>/<link> ก็นับ — แผนผัง HKT ขึ้นต้นด้วย <title> เลยไม่มี <html> ครอบ
  if (/^<!doctype\s+html/i.test(lead) || /^<(title|meta|style|link)[\s>]/i.test(lead)
      || /<html[\s>]/i.test(head) || /<head[\s>]/i.test(head) || /<body[\s>]/i.test(head)) {
    return { ext: 'html', mime: 'text/html' };
  }
  if (/<svg[\s>]/i.test(head) || /<!DOCTYPE\s+svg/i.test(head)) {
    throw new Error('SVG format not supported');
  }

  throw new Error('unsupported file type (must be PNG, JPEG, PDF, DOCX, XLSX, or HTML)');
}

// ── Self-check (runnable via `node src/helpers/uploadMagic.js`) ──
if (require.main === module) {
  const assert = require('assert');

  // Test: valid PNG
  const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const result1 = sniffUploadType(pngBuf, 'test.png');
  assert.strictEqual(result1.ext, 'png', 'PNG should return ext=png');
  assert.strictEqual(result1.mime, 'image/png', 'PNG should return correct MIME');

  // Test: valid JPEG (at least 8 bytes)
  const jpegBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]); // JPEG with JFIF app0
  const result2 = sniffUploadType(jpegBuf, 'test.jpg');
  assert.strictEqual(result2.ext, 'jpg', 'JPEG should return ext=jpg');

  // Test: valid PDF (at least 8 bytes)
  const pdfBuf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]); // %PDF-1.4
  const result3 = sniffUploadType(pdfBuf, 'test.pdf');
  assert.strictEqual(result3.ext, 'pdf', 'PDF should return ext=pdf');

  // Test: ZIP named .docx (at least 8 bytes)
  const docxBuf = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
  const result4 = sniffUploadType(docxBuf, 'document.docx');
  assert.strictEqual(result4.ext, 'docx', 'DOCX (ZIP) should return ext=docx');

  // Test: ZIP named .xlsx (at least 8 bytes)
  const xlsxBuf = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
  const result5 = sniffUploadType(xlsxBuf, 'sheet.xlsx');
  assert.strictEqual(result5.ext, 'xlsx', 'XLSX (ZIP) should return ext=xlsx');

  // Test: ZIP without office extension should fail
  assert.throws(
    () => sniffUploadType(xlsxBuf, 'archive.zip'),
    /unsupported file type.*ZIP must be/,
    'ZIP without office extension should fail'
  );

  // Test: SVG should fail
  const svgBuf = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.throws(
    () => sniffUploadType(svgBuf, 'image.svg'),
    /SVG format not supported/,
    'SVG should fail'
  );

  // Test: valid HTML documents (doctype, or a top-level html/head/body tag)
  const html1 = sniffUploadType(Buffer.from('<!DOCTYPE html><html><body>hi</body></html>'), 'page.html');
  assert.strictEqual(html1.ext, 'html', 'doctype HTML should return ext=html');
  assert.strictEqual(html1.mime, 'text/html', 'HTML should return correct MIME');
  const html2 = sniffUploadType(Buffer.from('<html><head></head><body>no doctype</body></html>'), 'page.html');
  assert.strictEqual(html2.ext, 'html', 'HTML without doctype but with <html> tag should still pass');

  // Test: this sniff only asks "looks like HTML" — it must NOT be treated as
  // the security boundary on its own (see the module header comment). Prose
  // that merely mentions a tag name must not slip through.
  const notHtml = Buffer.from('Please close the <door> when you leave the <house>.');
  assert.throws(
    () => sniffUploadType(notHtml, 'note.txt'),
    /unsupported file type/,
    'text mentioning an unrelated tag name should not be sniffed as HTML'
  );

  // Test: plain text should fail
  const textBuf = Buffer.from('hello world this is plain text');
  assert.throws(
    () => sniffUploadType(textBuf, 'text.txt'),
    /unsupported file type/,
    'text file should fail'
  );

  // Test: small buffer should fail
  const smallBuf = Buffer.from([0x89, 0x50]);
  assert.throws(
    () => sniffUploadType(smallBuf, 'small.bin'),
    /buffer too small/,
    'small buffer should fail'
  );

  console.log('✓ All self-checks passed');
}

module.exports = { sniffUploadType };
