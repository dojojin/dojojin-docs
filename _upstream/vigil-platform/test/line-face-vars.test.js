// ============================================================
// Vigil Platform — Tests: ตัวแปรใบหน้า/บัญชีดำ ในข้อความ LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เจ้าของแจ้ง 2026-08-12: แจ้งเตือนใบหน้าจาก HCP ใน LINE บอกแค่ "Person (91%)"
// ตัดสินใจไม่ได้ว่าเป็นใคร อยู่บัญชีไหน · ข้อมูลมีครบใน events.raw_json อยู่แล้ว
// แต่ template ไม่เคยขอ และไม่มีตัวแปรให้ขอ

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatMessage } = require('../src/line-sender');

const EVENT = {
  camera_name: 'สนามบินภูเก็ต Inter (C45)',
  camera_id: 'C45-SKU-SB-18',
  event_time: '2026-08-12T06:32:49.000Z',
  object_class: 'Person',
  likelihood: 0.9,
  rule_name: 'HCP · พบใบหน้าในบัญชีดำ (ภูเก็ต)',
  person_name: 'ลักทรัพย์ สภ.วิชิต สกัดจับ',
  watchlist: 'BLACKLIST WICHIT',
  similarity_pct: '90.0%',
};

// ใช้ร่วมกันทุก describe — เป็นตัวชี้ว่า box แนวนอนใบไหนคือ "แถวภาพคู่" จริง ๆ
// (หัวการ์ดมี box แนวนอนสำหรับจัดป้ายกลุ่มให้กึ่งกลางอยู่ก่อนแล้ว — 2026-08-27)
const allImgs = (n, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (n.type === 'image') out.push(n);
  for (const c of n.contents || []) allImgs(c, out);
  return out;
};

describe('formatMessage — ตัวแปรใบหน้า/บัญชีดำ', () => {
  it('แทนค่าชื่อบุคคล · บัญชี · ความคล้าย ครบ', () => {
    const out = formatMessage('{person_name}|{watchlist}|{similarity}', EVENT);
    assert.equal(out, 'ลักทรัพย์ สภ.วิชิต สกัดจับ|BLACKLIST WICHIT|90.0%');
  });

  it('ไม่มีข้อมูล → ขีดกลาง ไม่ใช่ undefined หรือช่องว่าง', () => {
    assert.equal(formatMessage('{person_name}|{watchlist}', {}), '-|-');
  });

  it('{similarity} ถอยไปใช้ likelihood ถ้าไม่มีค่า similarity', () => {
    // เหตุการณ์ที่ไม่ใช่ใบหน้า (เช่น IVA) ไม่มี similarity — ต้องไม่ขึ้น "-"
    // ให้ผู้ใช้เข้าใจผิดว่าไม่มีความมั่นใจเลย
    assert.equal(formatMessage('{similarity}', { likelihood: 0.87 }), '87%');
  });

  it('ตัวแปรเดิมยังทำงานเหมือนเดิมทุกตัว (ไม่ทำของเก่าพัง)', () => {
    const out = formatMessage('{camera}|{camera_id}|{rule}|{object_class}|{likelihood}', EVENT);
    assert.equal(out, 'สนามบินภูเก็ต Inter (C45)|C45-SKU-SB-18|HCP · พบใบหน้าในบัญชีดำ (ภูเก็ต)|Person|90%');
  });

  it('template ของจริงที่จะใช้ ให้ข้อความที่อ่านแล้วตัดสินใจได้', () => {
    const out = formatMessage(
      '🚨 พบบุคคลในบัญชีดำ\n👤 {person_name}\n📋 {watchlist}\n🎯 ความคล้าย {similarity}\n📍 {camera}\n⏰ {time}',
      EVENT);
    assert.match(out, /ลักทรัพย์ สภ\.วิชิต สกัดจับ/);
    assert.match(out, /BLACKLIST WICHIT/);
    assert.match(out, /90\.0%/);
    assert.ok(!out.includes('{'), 'ต้องไม่มีตัวแปรตกค้างที่ไม่ถูกแทนค่า');
  });
});

describe('buildFaceFlexAlert — bubble เทียบภาพ (ระลอก 2)', () => {
  const { buildFaceFlexAlert } = require('../src/line-sender');
  const IMGS = { scene: 'https://i/s.jpg', face: 'https://i/f.jpg', ref: 'https://i/r.jpg' };

  // ผังใหม่ 2026-08-26: รูปทุกใบอยู่ใน body — `hero` เหลือแค่แถบสี เพราะ hero ของ
  // Flex ถูกวางบนสุดเสมอ ย้ายลงมาอยู่ใต้ข้อความไม่ได้ ซึ่งขัดกับผังที่เจ้าของอนุมัติ

  it('มีครบ 3 ภาพ และแต่ละภาพกดเปิดได้เอง', () => {
    const b = buildFaceFlexAlert('x', IMGS, EVENT, null).contents;
    assert.equal(allImgs(b.body).map(i => i.url).includes(IMGS.scene), true);
    assert.equal(allImgs(b.hero).length, 0, 'hero เป็นแถบสี ห้ามมีรูป');
    // "แถวภาพคู่" = box แนวนอนที่มีรูปข้างใน ไม่ใช่ box แนวนอนใบแรก — หัวการ์ด
    // มี box แนวนอนสำหรับจัดป้ายกลุ่มให้กึ่งกลางอยู่ก่อนแล้ว (2026-08-27)
    const row = b.body.contents.find(c => c.layout === 'horizontal' && allImgs(c).length > 0);
    assert.equal(row.contents.length, 2);
    assert.deepEqual(row.contents.map(c => c.contents[0].url), [IMGS.face, IMGS.ref]);
    // กดซูมทีละใบได้ — เหตุผลหลักที่ไม่รวมเป็นภาพเดียว
    for (const c of row.contents) assert.equal(c.contents[0].action.type, 'uri');
  });

  it('ภาพคู่มาก่อนรายละเอียด — คนตัดสินด้วยตาก่อน', () => {
    const b = buildFaceFlexAlert('รายละเอียด', IMGS, EVENT, null).contents;
    const iRow = b.body.contents.findIndex(c => c.layout === 'horizontal' && allImgs(c).length > 0);
    // รายละเอียดเป็นตารางแล้ว (หัวข้อ = กล่องที่มี separator เป็นลูกใบที่สอง)
    const iDetail = b.body.contents.findIndex(
      c => c.contents?.[1]?.type === 'separator' || c.text === 'รายละเอียด');
    assert.ok(iRow >= 0 && iDetail > iRow, 'แถวภาพต้องอยู่เหนือรายละเอียด');
  });

  it('ไม่มีข้อมูลโรสเตอร์ → ยังได้ตารางจากข้อมูลกล้อง ไม่ใช่การ์ดที่มีแต่รูป', () => {
    const b = buildFaceFlexAlert('x', IMGS, EVENT, null).contents;
    const flat = JSON.stringify(b.body);
    assert.ok(flat.includes('ข้อมูลจากกล้อง'));
    assert.ok(flat.includes('สนามบินภูเก็ต Inter (C45)'), 'ชื่อกล้องต้องอยู่ในตาราง');
  });

  it('ไม่มีภาพเต็มเฟรม → ยังส่งได้ แค่เหลือรูปคู่', () => {
    const b = buildFaceFlexAlert('x', { face: IMGS.face, ref: IMGS.ref }, EVENT, null).contents;
    assert.equal(allImgs(b.body).length, 2);
    assert.ok(b.body.contents.find(c => c.layout === 'horizontal' && allImgs(c).length > 0));
  });

  it('ไม่ได้ตั้ง URL สาธารณะ → ไม่มีปุ่ม (ไม่ใช่ปุ่มที่กดแล้วพัง)', () => {
    assert.equal(buildFaceFlexAlert('x', IMGS, EVENT, null).contents.footer, undefined);
    assert.ok(buildFaceFlexAlert('x', IMGS, EVENT, 'https://d/x').contents.footer);
  });

  it('altText บอกชื่อคน + กล้อง (คือสิ่งเดียวที่เห็นบนแบนเนอร์แจ้งเตือน)', () => {
    const a = buildFaceFlexAlert('x', IMGS, EVENT, null).altText;
    assert.match(a, /ลักทรัพย์ สภ\.วิชิต สกัดจับ/);
    assert.match(a, /C45/);
    assert.ok(a.length <= 400);
  });
});

describe('buildLprFlexAlert — ป้ายทะเบียนใช้โครงเดียวกับใบหน้า', () => {
  const { buildLprFlexAlert, buildFaceFlexAlert, buildCompareFlexAlert } = require('../src/line-sender');
  const IMGS = { face: 'https://i/scene.jpg', ref: 'https://i/wl.jpg' };
  const META = { plate: 'กษ9323', region: 'ภูเก็ต', groupName: 'รถตามหมายจับ',
                 cameraName: 'ด่านฉลอง (C7)', refImage: 'lpr-watchlist/wl_1.jpg' };

  it('ป้ายทะเบียนเป็นหัวข้อ กลุ่มเป็นป้ายกำกับด้านบน — สลับกันไม่ได้', () => {
    const b = buildLprFlexAlert('x', IMGS, META, null).contents.body.contents;
    // ผังใหม่: กลุ่มเป็น "ป้าย" (กล่องพื้นสี) ไม่ใช่บรรทัดข้อความเปล่า
    // อ่านข้อความจากข้างในแบบไม่ผูกกับความลึก — ป้ายถูกห่อเพิ่มอีกชั้นตอนทำให้
    // อยู่กึ่งกลาง (2026-08-27) การเจาะ contents[0] ตรง ๆ จึงพังทั้งที่การ์ดถูก
    const firstText = (n) => n?.type === 'text' ? n.text
      : (n?.contents || []).reduce((f, c) => f ?? firstText(c), undefined);
    assert.equal(firstText(b[0]), 'รถตามหมายจับ');
    assert.equal(b[1].text, 'กษ9323');
    assert.equal(b[2].text, 'ภูเก็ต', 'จังหวัดแยกเป็นบรรทัดรอง ไม่ปนกับเลขป้าย');
    assert.ok(b[1].weight === 'bold' && b[1].size === 'xxl', 'เลขป้ายต้องใหญ่สุด');
  });

  it('ป้ายกำกับใต้ภาพเป็นของ LPR ไม่ใช่ของใบหน้า', () => {
    const row = buildLprFlexAlert('x', IMGS, META, null).contents.body.contents
      .find(c => c.layout === 'horizontal' && allImgs(c).length > 0);
    assert.deepEqual(row.contents.map(c => c.contents[1].text), ['ภาพจากกล้อง', 'ภาพอ้างอิง']);
  });

  it('โครงเหมือนใบหน้า — ใช้ builder ตัวเดียวกันจริง', () => {
    const lpr  = buildLprFlexAlert('x', IMGS, META, 'https://d/1').contents;
    const face = buildFaceFlexAlert('x', IMGS, EVENT, 'https://d/1').contents;
    // เทียบ "ชนิดของกล่อง" ไม่ใช่จำนวนแถว — ตารางของสองใบมีจำนวนแถวไม่เท่ากัน
    // โดยธรรมชาติ (คนละชุดข้อมูล) แต่ลำดับ ป้าย→หัวข้อ→รูป→ตาราง ต้องเหมือนกัน
    const shape = n => ({ type: n.type, hero: n.hero.height,
                          head: n.body.contents.slice(0, 2).map(c => c.type) });
    assert.deepEqual(shape(lpr), shape(face));
    assert.equal(!!lpr.footer, !!face.footer);
  });

  it('altText บอกกลุ่ม + ป้าย + กล้อง', () => {
    const a = buildLprFlexAlert('x', IMGS, META, null).altText;
    assert.match(a, /รถตามหมายจับ/);
    assert.match(a, /กษ9323/);
    assert.match(a, /ด่านฉลอง/);
  });

  it('ไม่มีภาพอ้างอิง → ไม่มีช่องว่างข้าง ๆ (ผู้เรียกจะตกไปใช้ bubble เดิม)', () => {
    // buildCompareFlexAlert รับ object ชุดเดียวแล้ว (2026-08-26) ไม่ใช่ 4 อาร์กิวเมนต์
    const b = buildCompareFlexAlert({ chip: 'g', title: 'p',
      pair: [{ url: IMGS.face, caption: 'ภาพจากกล้อง' }, { url: null }] }).contents;
    const row = b.body.contents.find(c => c.layout === 'horizontal' && allImgs(c).length > 0);
    assert.equal(row.contents.length, 1, 'มีภาพเดียวก็ไม่ควรมีช่องว่างข้างๆ');
  });
});
