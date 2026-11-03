#!/usr/bin/env node
// ============================================================
// Vigil Platform — repro/verify ของ crop ป้ายทะเบียน (hkt)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// รันก่อนแก้ = baseline · รันหลังแก้ = verify · ตัวเลขต้องพลิกตามที่คาดไว้
//
// สองอย่างที่วัด และเหตุผลว่าทำไมต้องวัดทั้งคู่:
//
//   1) กรอบ — plate_image ควรมีสัดส่วนเท่ากับ bbox และขนาด = bbox × 1.30
//      (เผื่อ 15% ต่อด้าน) · ก่อนแก้ กล้องส่ง cutout ขนาดตายตัวไม่กี่แบบ
//      (96x96, 112x96, 144x80, 224x112) ซึ่งไม่สัมพันธ์กับ bbox เลย
//
//   2) ความคม — plate_image ควรกว้างประมาณ 2 เท่าของกรอบเดียวกันบนภาพ
//      scene 1080p ที่เก็บไว้ · ข้อนี้สำคัญกว่า เพราะถ้าวันหนึ่งมีคนย้าย
//      extract() ไปไว้ "หลัง" resize กรอบจะยังถูกต้องทุกประการ มีแต่ความคม
//      ที่หายไปเงียบ ๆ — เป็น regression ที่ตาเปล่าจับไม่ได้จากตัวเลขกรอบ
//
// ใช้: node scripts/lpr-crop-repro.js [จำนวนตัวอย่าง] [ชั่วโมงย้อนหลัง]

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
require(path.join(SRC, 'node_modules', 'dotenv')).config({ path: path.join(SRC, '.env'), quiet: true });
const { Pool } = require(path.join(SRC, 'node_modules', 'pg'));
const sharp = require(path.join(SRC, 'node_modules', 'sharp'));
const si = require(path.join(SRC, 'helpers', 'signedImage'));

const N = Number(process.argv[2] || 40);
const HOURS = Number(process.argv[3] || 6);
const PAD = 0.15;

const fetchImg = async (rel) => {
  const u = si.signedImageUrl(rel);
  if (!u) return null;
  const r = await fetch(u).catch(() => null);
  return r && r.ok ? Buffer.from(await r.arrayBuffer()) : null;
};
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

(async () => {
  const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

  // เฉพาะกล้อง Hikvision (hkt) — ยี่ห้อตัดสินจาก cameras.model ไม่ใช่ path ที่เก็บไฟล์
  const { rows } = await pool.query(`
    SELECT lp.camera_id, lp.plate_number, lp.plate_image, e.snapshot_filename sc,
           lp.bbox_x x, lp.bbox_y y, lp.bbox_width w, lp.bbox_height h
      FROM license_plates lp
      JOIN cameras c ON c.id = lp.camera_id
      JOIN events  e ON e.id = lp.event_id
     WHERE lp.detected_at > now() - ($1 || ' hours')::interval
       AND lp.bbox_width > 0 AND lp.plate_image IS NOT NULL AND e.snapshot_filename IS NOT NULL
       AND (c.model ILIKE 'iDS-%' OR c.model ILIKE 'DS-%')
     ORDER BY lp.detected_at DESC LIMIT $2`, [String(HOURS), N]);

  const dims = new Map();          // "WxH" -> จำนวน (ดูว่าเป็นค่าตายตัวของกล้องหรือต่อเนื่อง)
  const frameErr = [];             // ขนาดจริง ÷ ขนาดที่คาด (กรอบ)
  const detail = [];               // ความกว้าง plate_image ÷ ความกว้างกรอบเดียวกันบน scene 1080p
  let clamped = 0, noFile = 0;

  for (const r of rows) {
    const [cut, scene] = await Promise.all([fetchImg(r.plate_image), fetchImg(r.sc)]);
    if (!cut || !scene) { noFile++; continue; }
    const cm = await sharp(cut).metadata().catch(() => null);
    const sm = await sharp(scene).metadata().catch(() => null);
    if (!cm || !sm) { noFile++; continue; }

    dims.set(`${cm.width}x${cm.height}`, (dims.get(`${cm.width}x${cm.height}`) || 0) + 1);

    // กรอบที่ "ควรจะเป็น" วัดบนภาพ scene 1080p (bbox เป็นกริด 0–1000)
    const bw1080 = r.w * sm.width / 1000;
    const bh1080 = r.h * sm.height / 1000;
    if (bw1080 < 4) continue;
    // ป้ายชิดขอบเฟรม → กรอบถูกหนีบ ตัวเลขจะเพี้ยนโดยไม่ใช่ความผิดของโค้ด
    const nearEdge = (r.x - r.w * PAD) < 0 || (r.y - r.h * PAD) < 0
                  || (r.x + r.w * (1 + PAD)) > 1000 || (r.y + r.h * (1 + PAD)) > 1000;
    if (nearEdge) { clamped++; continue; }

    detail.push(cm.width / (bw1080 * (1 + 2 * PAD)));
    frameErr.push((cm.width / cm.height) / (bw1080 / bh1080));   // 1.00 = สัดส่วนตรงกับ bbox
  }

  const uniq = [...dims.entries()].sort((a, b) => b[1] - a[1]);
  // กล้อง Hikvision ปัดขนาด cutout เป็นพหุคูณของ 16 เสมอ (80x64, 96x48, 112x80 …)
  // ส่วนของเราคำนวณจาก bbox ตรง ๆ จึงเป็นเลขอะไรก็ได้ — เป็นสัญญาณแบ่งที่คมที่สุด
  const mult16 = [...dims.entries()].reduce((n, [k, v]) => {
    const [w, h] = k.split('x').map(Number);
    return n + ((w % 16 === 0 && h % 16 === 0) ? v : 0);
  }, 0);
  const totalDims = [...dims.values()].reduce((a, b) => a + b, 0);
  const pct = (n) => `${(n / totalDims * 100).toFixed(0)}%`;
  const spread = (a) => { const s = [...a].sort((x, y) => x - y);
    return s.length ? (s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)]) : NaN; };

  console.log(`\n  ตัวอย่าง ${rows.length} ใบ (hkt, ${HOURS} ชม.ล่าสุด) · ใช้ได้ ${detail.length} · ชิดขอบเฟรม ${clamped} · โหลดไม่ได้ ${noFile}\n`);
  console.log(`  ── 1) ใครเป็นคน crop ──`);
  console.log(`  ขนาดเป็นพหุคูณของ 16 : ${mult16}/${totalDims} (${pct(mult16)})`);
  console.log(`      ~100% = กล้อง crop มาให้ (ยังไม่แก้)`);
  console.log(`      ~0%   = เรา crop เอง (แก้แล้ว)`);
  uniq.slice(0, 5).forEach(([k, v]) => console.log(`      ${k.padEnd(10)} ${v} ใบ`));
  console.log(`\n  ── 2) กรอบตรงกับ bbox ไหม ──`);
  console.log(`  สัดส่วน plate_image ÷ สัดส่วน bbox : กลาง ${med(frameErr).toFixed(2)} (ต้องเป็น 1.00)`);
  console.log(`\n  ── 3) ความคม (ข้อสำคัญที่สุด) ──`);
  console.log(`  plate_image กว้างกี่เท่าของกรอบเดียวกันบน scene 1080p`);
  console.log(`      กลาง ${med(detail).toFixed(2)}x · ช่วง p10–p90 กว้าง ${spread(detail).toFixed(2)}`);
  console.log(`      ~1.0x = crop มาจากภาพ 1080p ที่ย่อแล้ว → เสียความคม ❌`);
  console.log(`      ~2.0x = crop มาจากบัฟเฟอร์ 9MP ก่อนย่อ ✅`);
  console.log(`      ช่วงต้องแคบลงมากหลังแก้ — ของเราใช้สูตรเดียวทุกใบ ส่วนกล้องเผื่อขอบไม่เท่ากัน\n`);

  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
