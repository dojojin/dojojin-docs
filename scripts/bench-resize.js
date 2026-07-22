// ============================================================
// Vigil Platform — Edge resize benchmark (hardware sizing)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// รันบน Edge box ตัวจริง (N150 ฯลฯ) เพื่อวัด resize throughput จริง —
// อย่าใช้ตัวเลขจากเครื่อง dev (Mac/x86 แรง) มาตัดสิน.
//
//   node bench-resize.js [path/to/lpr_scene.jpg]
//
// ถ้าไม่ใส่ path จะสร้างภาพทดสอบ 4096x2192 (ขนาดเท่า LPR scene จริง) ให้เอง.
// ต้องมี sharp: `npm i sharp` (หรือใช้ที่มากับ vigil ใน src/node_modules)
// ============================================================
'use strict';

const os = require('os');
let sharp;
try { sharp = require('sharp'); }
catch { try { sharp = require('../src/node_modules/sharp'); } catch { console.error('ไม่พบ sharp — รัน `npm i sharp` ก่อน'); process.exit(1); } }

(async () => {
  const arg = process.argv[2];
  let input;
  if (arg) {
    input = require('fs').readFileSync(arg);
    console.log('input: ' + arg);
  } else {
    // ภาพทดสอบ noise 4096x2192 (บีบยาก = ใกล้เคียง scene จริง)
    const w = 4096, h = 2192;
    const buf = Buffer.allocUnsafe(w * h * 3);
    let s = 12345;
    for (let i = 0; i < buf.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; buf[i] = s & 0xff; }
    input = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
    console.log('input: synthetic 4096x2192 (' + (input.length / 1024).toFixed(0) + ' KB)');
  }

  const cores = os.cpus().length;
  console.log('CPU: ' + (os.cpus()[0] || {}).model + ' · ' + cores + ' threads · sharp concurrency=' + sharp.concurrency());
  console.log('');

  const N = 40;
  const time = async (label, fn) => {
    await fn(); // warm
    const t = Date.now();
    for (let i = 0; i < N; i++) await fn();
    const ms = (Date.now() - t) / N;
    console.log('  ' + label.padEnd(26) + ms.toFixed(0).padStart(4) + ' ms/รูป   →  ' + (1000 / ms).toFixed(1).padStart(5) + ' รูป/วิ (serial)');
    return ms;
  };

  console.log('=== serial (1 ทีละรูป) ===');
  await time('decode อย่างเดียว', () => sharp(input).raw().toBuffer());
  await time('q70 res เท่าเดิม', () => sharp(input).jpeg({ quality: 70 }).toBuffer());
  const dsMs = await time('q70 + downscale 1920', () => sharp(input).resize(1920).jpeg({ quality: 70 }).toBuffer());

  // parallel — ยิงพร้อมกันเท่าจำนวน core เพื่อวัด throughput จริงของทั้งกล่อง
  console.log('');
  console.log('=== parallel (ยิง ' + cores + ' รูปพร้อมกัน, แบบ downscale) ===');
  const ROUNDS = 10;
  const t = Date.now();
  for (let r = 0; r < ROUNDS; r++) {
    await Promise.all(Array.from({ length: cores }, () => sharp(input).resize(1920).jpeg({ quality: 70 }).toBuffer()));
  }
  const total = (Date.now() - t) / 1000;
  const imgs = ROUNDS * cores;
  console.log('  ' + imgs + ' รูป ใน ' + total.toFixed(1) + ' วิ  →  ' + (imgs / total).toFixed(1) + ' รูป/วิ (throughput จริงทั้งกล่อง)');
  console.log('');
  console.log('--- แปลผล ---');
  const tp = imgs / total;
  console.log('  เครื่องนี้ทำ downscale ได้ ~' + tp.toFixed(0) + ' รูป/วิ (รันบน N150 จริงเท่านั้นถึงใช้ได้)');
  console.log('  busy LPR gate 1 ตัว ~0.22 รูป/วิ (เฉลี่ย) · peak อาจ 1-3/วิ');
  console.log('  → รับ busy gate ได้ ~' + Math.floor(tp / 0.22) + ' ตัว (เฉลี่ย) ก่อน resize เริ่มตามไม่ทัน');
  console.log('  (peak จริงต่ำกว่านี้ — เผื่อ headroom + ทำ batch ถ้าเกิน)');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
