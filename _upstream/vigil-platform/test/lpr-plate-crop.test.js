// ============================================================
// Vigil Platform — crop ป้ายทะเบียนตอน ingest
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ตรึงสัญญาของ sceneAndPlate() 3 ข้อ:
//   1. crop มาจากบัฟเฟอร์เต็มความละเอียด ไม่ใช่จาก scene ที่ย่อแล้ว
//      ← ถ้าใครย้าย extract() ไปหลัง resize กรอบจะยังถูก มีแต่ความคมที่หายเงียบ ๆ
//   2. bbox ที่ไม่ใช่กริด 0–1000 ต้องไม่ถูก crop (กันเวนเดอร์ที่ส่งพิกเซลดิบมา)
//   3. crop ที่ล้ม ต้องไม่พา scene ตกไปด้วย

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'src', 'node_modules', 'sharp'));
const { sceneAndPlate, _bboxUsable, PLATE_CROP_PAD } = require('../src/lpr-core');

// pool ปลอม — คืนค่า default 1080p/q80 เหมือนที่ getSceneCfg อ่านจาก system_settings
const fakePool = { query: async () => ({ rows: [] }) };
const SRC_W = 3840, SRC_H = 2160;   // จำลองเฟรม 9MP ที่กล้องส่งมา

// ภาพต้นแบบ: noise เบลอ ๆ (ให้ decode มีราคาใกล้ภาพถ่ายจริง ไม่ใช่สีเรียบที่ decode
// เร็วผิดปกติจนเทสเชิงเวลาด้านล่างแยกไม่ออก) + สี่เหลี่ยมขาวตรงตำแหน่ง bbox แทน "ป้าย"
let _frame = null;
async function makeFrame() {
  if (_frame) return _frame;
  const seed = require('crypto').randomBytes(480 * 270 * 3);
  _frame = await sharp(seed, { raw: { width: 480, height: 270, channels: 3 } })
    .resize(SRC_W, SRC_H, { kernel: 'cubic' }).blur(1.2)
    .composite([{ input: { create: { width: 200, height: 90, channels: 3,
      background: { r: 250, g: 250, b: 250 } } }, left: 1600, top: 1000 }])
    .jpeg({ quality: 85 }).toBuffer();
  return _frame;
}
// bbox ในกริด 0–1000 ที่ตรงกับสี่เหลี่ยมขาวข้างบน
const BBOX = { x: 1600 / SRC_W * 1000, y: 1000 / SRC_H * 1000,
               width: 200 / SRC_W * 1000, height: 90 / SRC_H * 1000 };

test('crop มาจากบัฟเฟอร์เต็มความละเอียด ไม่ใช่จาก scene 1080p ที่ย่อแล้ว', async () => {
  const { sceneBuf, plateBuf, reason } = await sceneAndPlate(await makeFrame(), fakePool, BBOX);
  assert.ok(plateBuf, `ต้องได้ crop · reason=${reason}`);
  const sm = await sharp(sceneBuf).metadata();
  const pm = await sharp(plateBuf).metadata();

  assert.equal(sm.width, 1920, 'scene ยังต้องถูกย่อเป็น 1080p เหมือนเดิม');

  // ขนาดที่คาด = ขนาดป้ายบนเฟรมดิบ + เผื่อสองด้าน
  const expectW = Math.round(200 * (1 + 2 * PLATE_CROP_PAD));
  assert.ok(Math.abs(pm.width - expectW) <= 2,
    `crop ควรกว้าง ~${expectW}px (วัดจากเฟรมดิบ) แต่ได้ ${pm.width}px`);

  // ถ้ามีคนย้าย extract ไปหลัง resize จะได้ราวครึ่งเดียว — ด่านนี้คือด่านที่จับได้
  const ifResizedFirst = Math.round(200 * (1920 / SRC_W) * (1 + 2 * PLATE_CROP_PAD));
  assert.ok(pm.width > ifResizedFirst * 1.5,
    `crop กว้าง ${pm.width}px ใกล้ค่าที่จะได้ถ้า crop หลังย่อ (${ifResizedFirst}px) — ` +
    'แปลว่า extract() หลุดไปอยู่หลัง resize แล้ว');
});

test('bbox ที่เป็นพิกเซลดิบ (เกินกริด 0–1000) ต้องไม่ถูก crop', async () => {
  assert.equal(_bboxUsable({ x: 1500, y: 900, width: 200, height: 90 }), false, 'เกิน 1000');
  assert.equal(_bboxUsable({ x: 0, y: 0, width: 0, height: 90 }), false, 'กว้าง 0');
  assert.equal(_bboxUsable(null), false);
  assert.equal(_bboxUsable(BBOX), true);

  const { sceneBuf, plateBuf, reason } = await sceneAndPlate(
    await makeFrame(), fakePool, { x: 1500, y: 900, width: 200, height: 90 });
  assert.equal(plateBuf, null, 'พิกัดนอกกริดต้องไม่ crop');
  assert.match(reason, /0–1000/);
  assert.ok(sceneBuf, 'แต่ scene ต้องยังได้ตามปกติ');
});

// ── ด่านกันการถดถอยที่ตาเปล่าจับไม่ได้ ──────────────────────────────────────
// สองสายของ sceneAndPlate ต้องทำงานพร้อมกัน · clone ใช้ผลถอดรหัสร่วมกันได้ต่อเมื่อ
// ทั้งคู่ยังทำงานอยู่ ถ้าใครแก้เป็น `await sceneJob` แล้วค่อยเริ่ม plateJob ผลลัพธ์
// จะยัง **ถูกต้องทุกประการ** แต่ต้องถอดรหัส 9MP สองรอบ
// วัดบนเครื่อง hkt: ของเดิม 40 ms · พร้อมกัน 41 ms · เรียงกัน 52 ms (+30%)
// วัดซ้ำบน central ด้วยภาพทดสอบใบนี้: resize เปล่า 42.7 · พร้อมกัน 1.04x · เรียงกัน 1.31x
// เกณฑ์ 1.18 อยู่กึ่งกลางของช่องว่างนั้น — ห่างพอที่ noise ของเครื่องจะไม่ทำให้แดงเอง
//
// วัดเป็น "อัตราส่วนกับ resize เปล่า" ไม่ใช่มิลลิวินาทีดิบ เพื่อไม่ให้ผูกกับความเร็ว
// ของเครื่องที่รันเทส · ใช้ค่าต่ำสุดของหลายรอบเพราะทนสัญญาณรบกวนกว่าค่ากลาง
test('สองสายต้องทำงานพร้อมกัน ไม่ใช่เรียงกัน (กันโหลดขึ้น 30% เงียบ ๆ)', async () => {
  const frame = await makeFrame();
  const resizeOnly = () => sharp(frame).rotate()
    .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 }).toBuffer();

  const timeMin = async (fn, n) => {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const t = process.hrtime.bigint();
      await fn();
      best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6);
    }
    return best;
  };
  await timeMin(resizeOnly, 2);                                   // warm-up
  await timeMin(() => sceneAndPlate(frame, fakePool, BBOX), 2);

  // สลับกันวัดเพื่อให้เจอสภาพเครื่องเดียวกัน
  const base = Math.min(await timeMin(resizeOnly, 4), await timeMin(resizeOnly, 4));
  const both = await timeMin(() => sceneAndPlate(frame, fakePool, BBOX), 6);

  const ratio = both / base;
  assert.ok(ratio < 1.18,
    `sceneAndPlate ใช้เวลา ${ratio.toFixed(2)}x ของ resize เปล่า (${both.toFixed(0)} vs ${base.toFixed(0)} ms) — ` +
    'เกิน 1.18x แปลว่า clone ตัวที่สองถูกสร้างหลัง await ตัวแรก จึงต้องถอดรหัส 9MP สองรอบ');
});

test('crop ล้ม ต้องไม่พา scene ตกไปด้วย', async () => {
  // bbox เล็กจนกรอบต่ำกว่าเพดานขั้นต่ำ → ไม่ crop แต่ scene ต้องมา
  const { sceneBuf, plateBuf, reason } = await sceneAndPlate(
    await makeFrame(), fakePool, { x: 500, y: 500, width: 0.5, height: 0.5 });
  assert.equal(plateBuf, null);
  assert.match(reason, /เล็กเกิน/);
  assert.ok(sceneBuf, 'scene คือสิ่งที่ห้ามหาย');
  assert.equal((await sharp(sceneBuf).metadata()).width, 1920);
});
