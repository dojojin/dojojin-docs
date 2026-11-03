// ============================================================
// Vigil Platform — การ์ดใบหน้าต้องทำงานครบทั้ง 3 ระบบ ไม่ใช่แค่ HCP
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เรามีระบบจดจำใบหน้า 3 ระบบที่ใช้การ์ดใบเดียวกัน แต่ส่งข้อมูลคนละคีย์:
//   HCP        hcp_person_name / hcp_person_id · โรสเตอร์ของเรา (PHOTO_DIR)
//   AuraFace   ไม่มีใน raw_json เลย            · โรสเตอร์ของเรา (PHOTO_DIR)
//   กล้อง Hik  personName / fdLibName          · FD Library ของกล้อง (SNAPSHOT_DIR)
//
// ทุกอย่างที่ค้นด้วยคีย์ของ HCP อย่างเดียวจะเงียบ ๆ ตกไปใช้ bubble รูปเดียวสำหรับ
// อีกสองระบบ — ไม่ error ไม่มี log · เทสในไฟล์นี้ตรึงไว้ว่าอ่านครบทั้งสามชุด

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SENDER = fs.readFileSync(path.join(__dirname, '..', 'src', 'line-sender.js'), 'utf8');
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'src', 'alert-engine.js'), 'utf8');

test('query หาภาพอ้างอิง ต้องดึงคุณลักษณะของทั้ง HCP และกล้อง Hik', () => {
  const m = SENDER.match(/`SELECT e\.raw_json->>'_snapshot_full'[\s\S]*?WHERE e\.id = \$1`/);
  assert.ok(m, 'หา query ไม่เจอ');
  const q = m[0];
  // HCP ส่งรหัสตัวเลข
  for (const k of ['hcp_gender', 'hcp_glasses', 'hcp_mask']) {
    assert.ok(q.includes(`'${k}'`), `ขาด ${k} — สาย HCP จะไม่มีลักษณะ`);
  }
  // กล้อง Hik ส่งค่าที่อ่านออกและละเอียดกว่า — คนละคีย์ ไม่ใช่ชื่อพ้อง
  for (const k of ['age', 'hat', 'glass', 'mask', 'faceExpression']) {
    assert.ok(q.includes(`'${k}'`), `ขาด ${k} — สาย Hik จะขึ้นแค่เพศ`);
  }
  assert.ok(q.includes("'_snapshot_ref'"), 'ขาด _snapshot_ref — กล้องจะไม่มีภาพอ้างอิง');
});

test('ชนิดลิงก์ของภาพอ้างอิง ต้องเป็นค่าที่ signedImageUrl ยอมรับจริง ๆ', () => {
  // 🔴 เทสเดิมของไฟล์นี้เขียนว่า `assert /refKind = null/` ซึ่ง **ตรึงบั๊กเอาไว้**:
  // มันตรวจว่าโค้ดตรงกับที่คนเขียนพิมพ์ ไม่ได้ตรวจว่าค่านั้นใช้งานได้
  // ของจริงพัง 2026-08-27 — kind = null ไม่ผ่าน validate ที่ signedImage.js:112
  // คืน null เงียบ ๆ การ์ดตกไปเป็น bubble รูปเดียว ไม่มี error ให้เห็น
  // (default parameter ของ JS ทำงานกับ undefined เท่านั้น ไม่ทำงานกับ null)
  //
  // เทสใหม่เรียกของจริง แทนที่จะจับคู่สตริง
  // ตั้งค่าที่ signedImageUrl ต้องใช้ ไม่งั้นมันคืน null ให้ทุก kind แล้วเทสจะ
  // "ผ่าน" เพราะเหตุผลผิด ๆ (ทดสอบ config ที่ไม่ได้ตั้ง แทนที่จะทดสอบ kind)
  process.env.DASHBOARD_PUBLIC_URL ||= 'https://example.test';
  process.env.SNAPSHOT_PROXY_SECRET ||= 'test-secret';
  const { signedImageUrl } = require('../src/helpers/signedImage');
  const kinds = [...SENDER.matchAll(/refKind = '([a-z]*)'/g)].map(m => m[1]);
  assert.ok(kinds.length >= 2, 'ต้องมีทั้งคลังโรสเตอร์และคลังของกล้อง');
  assert.ok(kinds.includes('ref'), 'โรสเตอร์ของเราอยู่ PHOTO_DIR = ref');
  assert.ok(kinds.includes('img'), 'FD Library ของกล้องอยู่ SNAPSHOT_DIR = img');
  // ทุกค่าที่โค้ดใช้จริง ต้องสร้างลิงก์ได้ ไม่ใช่คืน null
  for (const k of kinds) {
    assert.notEqual(signedImageUrl('a/b.jpg', 60, k), null, `kind '${k}' สร้างลิงก์ไม่ได้`);
  }
  assert.equal(signedImageUrl('a/b.jpg', 60, null), null,
    'ยืนยันว่า null คือค่าที่ใช้ไม่ได้จริง — เทสนี้จะไร้ความหมายถ้าอะไรก็ผ่าน');

  assert.ok(SENDER.includes('usableSignedUrl(row.ref_path, signedTtlSec ?? expireSec, refKind)'),
    'ต้องเซ็นด้วย refKind ไม่ใช่ค่าคงที่ ref');
  // ทางสำรอง imgbb อ่านจาก PHOTO_DIR — ห้ามเอา path ของ SNAPSHOT_DIR ไปต่อ
  assert.ok(/refKind !== 'ref'[\s\S]{0,140}PHOTO_DIR/.test(SENDER),
    'ทางสำรอง imgbb ต้องข้ามภาพที่ไม่ได้อยู่ใน PHOTO_DIR');
});

test('ข้อมูลโรสเตอร์ที่ผู้เรียกส่งมา ต้องไม่ทับของที่ค้นเจอเอง', () => {
  assert.ok(/row\[k\] == null \|\| row\[k\] === ''/.test(SENDER),
    'ต้องเติมเฉพาะช่องว่าง — ของที่ค้นเจอเองตรงกว่าเสมอ');
});

test('เติมชื่อคน: อ่านคีย์ของกล้อง Hik ด้วย ไม่ใช่แค่ HCP', () => {
  assert.ok(ENGINE.includes("raw_json->>'personName'"), 'ขาดชื่อคนฝั่งกล้อง');
  assert.ok(ENGINE.includes("raw_json->>'fdLibName'"), 'ขาดชื่อคลังใบหน้าฝั่งกล้อง');
});

test("ด่านเติมชื่อคน ห้ามมี 'Face Capture' — คนละเรื่องกับการจับคู่ และปริมาณมหาศาล", () => {
  const { FACE_MATCH_RULES, _isFaceMatch } = require('../src/alert-engine');
  assert.ok(FACE_MATCH_RULES.has('Face Recognition Match'));
  assert.ok(FACE_MATCH_RULES.has('AuraFace Blacklist Match'));
  assert.ok(!FACE_MATCH_RULES.has('Face Capture'), '"เห็นหน้าคน" ไม่ใช่ "ตรงกับบัญชีดำ"');
  assert.equal(_isFaceMatch({}, { rule_name: 'Face Capture' }), false);
  assert.equal(_isFaceMatch({}, { rule_name: 'Face Recognition Match' }), true);
  // กฎที่ยังไม่มี event (ปุ่มทดสอบ) ดูจาก rule_names ของกฎแทน
  assert.equal(_isFaceMatch({ rule_names: ['AuraFace Blacklist Match'] }, {}), true);
});

test('ปุ่มทดสอบ AuraFace ต้องส่งข้อมูลชุดเดียวกับของจริง', () => {
  // ปุ่มทดสอบมีไว้จับความต่างระหว่างของจริงกับสิ่งที่เห็น — ถ้าตัวมันเองส่งคนละชุด
  // มันจะกลายเป็นตัวสร้างความมั่นใจปลอม
  const ROUTE = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'alert-channels.js'), 'utf8');
  const WORKER = fs.readFileSync(path.join(__dirname, '..', 'src', 'face-embed-worker.js'), 'utf8');
  for (const f of ['ref_name', 'case_ref', 'case_note', 'ref_updated', 'bl_notes']) {
    assert.ok(ROUTE.includes(f), `ปุ่มทดสอบขาด ${f}`);
    assert.ok(WORKER.includes(f), `เส้นทางจริงขาด ${f}`);
  }
  assert.ok(ROUTE.includes('ref_info') && WORKER.includes('ref_info'),
    'ทั้งสองทางต้องส่ง ref_info');
});
