// ============================================================
// Vigil Platform — Image magic-byte validator
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Validates image buffers by checking magic bytes, not MIME type or filename.
// Spec: GOTCHAS #55 (SEC-005 — file upload validation).
// Never trust Content-Type headers — they are spoofable.
'use strict';

/**
 * Validates that a buffer contains a supported image format by checking magic bytes.
 * Supported formats: PNG, JPEG, WebP, GIF.
 * Explicitly rejects SVG (librsvg/Pango failure — GOTCHAS #25a).
 *
 * @param {Buffer} buf - The buffer to validate
 * @returns {boolean} true if valid, false otherwise
 * @throws {Error} if buffer is too small or invalid
 */
function assertImageBuffer(buf) {
  if (!Buffer.isBuffer(buf)) {
    throw new Error('expected a Buffer');
  }
  if (buf.length < 4) {
    throw new Error('buffer too small for magic-byte check');
  }

  // PNG: 89 50 4E 47 (full header is 8 bytes)
  const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;

  // JPEG: FF D8 FF
  const isJpeg = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;

  // WebP: RIFF....WEBP (at bytes 0-3 and 8-11)
  const isWebP = buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';

  // GIF87a or GIF89a
  const isGif = buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF' &&
    (buf.toString('ascii', 3, 6) === '87a' || buf.toString('ascii', 3, 6) === '89a');

  if (isPng || isJpeg || isWebP || isGif) return true;

  // Only now, once the raster formats are ruled out, is it worth sniffing text.
  // Order matters: an XMP packet (Illustrator/Photoshop export) sits inside the
  // first KB of a perfectly valid JPEG/PNG and routinely contains both `xmlns`
  // and the string `svg` — the original asset's filename. Sniffing before the
  // magic bytes rejected those real files as SVG. A buffer that carries PNG/
  // JPEG/WebP/GIF magic cannot be an SVG, so the magic test is the decision and
  // this is only here to name the most common mistake in the error message.
  const head = buf.toString('utf8', 0, Math.min(1024, buf.length));
  if (/<svg[\s>]/i.test(head) || /<!DOCTYPE\s+svg/i.test(head)) {
    // SVG is refused outright, not merely unsupported: librsvg/Pango aborts on
    // server-side render (GOTCHAS #25a) and carries its own CVE history.
    throw new Error('SVG format not supported');
  }
  throw new Error('invalid image magic bytes (not PNG/JPEG/WebP/GIF)');
}

// ── Self-check (runnable via `node src/helpers/imageMagic.js`) ──
if (require.main === module) {
  const assert = require('assert');

  // Test: valid PNG
  const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  assert.doesNotThrow(() => assertImageBuffer(pngBuf), 'PNG should pass');

  // Test: valid JPEG
  const jpegBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
  assert.doesNotThrow(() => assertImageBuffer(jpegBuf), 'JPEG should pass');

  // Test: valid WebP
  const webpBuf = Buffer.from('RIFF\x00\x00\x00\x00WEBP');
  assert.doesNotThrow(() => assertImageBuffer(webpBuf), 'WebP should pass');

  // Test: valid GIF87a
  const gif87Buf = Buffer.from('GIF87a');
  assert.doesNotThrow(() => assertImageBuffer(gif87Buf), 'GIF87a should pass');

  // Test: valid GIF89a
  const gif89Buf = Buffer.from('GIF89a');
  assert.doesNotThrow(() => assertImageBuffer(gif89Buf), 'GIF89a should pass');

  // Test: text file should fail
  const textBuf = Buffer.from('hello world this is plain text');
  assert.throws(() => assertImageBuffer(textBuf), /invalid image magic bytes/, 'text file should fail');

  // Test: SVG should fail (even though it might have valid XML headers)
  const svgBuf = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.throws(() => assertImageBuffer(svgBuf), /SVG format not supported/, 'SVG should fail');

  // Regression: a real raster file whose XMP metadata mentions svg/xmlns must
  // still pass. This is what an Illustrator-exported logo looks like, and the
  // sniff-first version rejected it — found while extending this helper to
  // /api/branding/logo, which is exactly where such files arrive.
  const xmp = 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<dc:title>logo.svg</dc:title></x:xmpmeta>';
  const jpegXmp = Buffer.concat([
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]),
    Buffer.from([0xFF, 0xE1, 0x00, 0x00]), Buffer.from(xmp),
  ]);
  assert.doesNotThrow(() => assertImageBuffer(jpegXmp), 'JPEG carrying XMP metadata must pass');
  const pngXmp = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from(xmp),
  ]);
  assert.doesNotThrow(() => assertImageBuffer(pngXmp), 'PNG carrying XMP metadata must pass');

  // Test: small buffer should fail
  const smallBuf = Buffer.from([0x89, 0x50]);
  assert.throws(() => assertImageBuffer(smallBuf), /buffer too small/, 'small buffer should fail');

  console.log('✓ All self-checks passed');
}

module.exports = { assertImageBuffer };
