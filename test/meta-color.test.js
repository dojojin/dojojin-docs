// ============================================================
// Vigil Platform — สีของวัตถุจากสตรีม ONVIF metadata
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// XML ข้างล่างคัดมาจากของจริงที่ดึงจาก BH5100i_RMUTR-V_02 (firmware 9.80.0106)
// ซึ่งเป็นกล้องที่ **ไม่แนบสีไปกับ event MQTT** — สีมีอยู่แค่ในสตรีมนี้เท่านั้น
// ถ้า parse ตรงนี้พังเมื่อไหร่ หน้า "ข้อมูลวัตถุ" กับแถบ "สีของวัตถุ" จะกลับไปว่าง
// โดยไม่มีอะไรฟ้อง เพราะทุกอย่างอื่น (กรอบ · ความเร็ว · พื้นที่) ยังทำงานปกติ

const test = require('node:test');
const assert = require('node:assert');
const { parseMetadata } = require('../src/helpers/onvifMetaTrack');

const DOC = `<tt:MetadataStream xmlns:tt="http://www.onvif.org/ver10/schema">
<tt:VideoAnalytics><tt:Frame UtcTime="2026-08-26T12:39:29.507Z">
<tt:Object ObjectId="1816"><tt:Appearance velocity="6.94" area="1.04">
<tt:Shape><tt:BoundingBox bottom="-0.97" top="-0.67" right="0.00" left="-0.09"/>
<tt:CenterOfGravity x="-0.05" y="-0.81"/></tt:Shape>
<tt:Color>
<tt:ColorCluster><tt:Color X="159.38" Y="159.38" Z="159.38"/><tt:Weight>0.43</tt:Weight></tt:ColorCluster>
<tt:ColorCluster><tt:Color X="31.88" Y="31.88" Z="31.88"/><tt:Weight>0.21</tt:Weight></tt:ColorCluster>
<tt:ColorCluster><tt:Color X="223.13" Y="223.13" Z="223.13"/><tt:Weight>0.21</tt:Weight></tt:ColorCluster>
</tt:Color>
<tt:Class><tt:ClassCandidate><tt:Type>Human</tt:Type><tt:Likelihood>0.11</tt:Likelihood></tt:ClassCandidate></tt:Class>
</tt:Appearance></tt:Object>
</tt:Frame></tt:VideoAnalytics></tt:MetadataStream>`;

test('แกะกลุ่มสีออกมาได้ครบทุกก้อน พร้อมน้ำหนัก', () => {
  const [s] = parseMetadata(DOC);
  assert.ok(s, 'ต้อง parse ได้อย่างน้อย 1 วัตถุ');
  assert.equal(s.objectId, 1816);
  assert.ok(Array.isArray(s.colors), 'ต้องมี colors');
  assert.equal(s.colors.length, 3);
  assert.deepEqual(s.colors[0], { x: 159.38, y: 159.38, z: 159.38, w: 0.43 });
  assert.deepEqual(s.colors[2], { x: 223.13, y: 223.13, z: 223.13, w: 0.21 });
});

test('ของเดิมต้องไม่เปลี่ยน — กรอบ ความเร็ว พื้นที่ ยังมาเหมือนเดิม', () => {
  const [s] = parseMetadata(DOC);
  assert.equal(s.speed, 6.94);
  assert.equal(s.area, 1.04);
  assert.deepEqual(s.box, { bottom: -0.97, top: -0.67, right: 0, left: -0.09 });
  assert.equal(s.type, 'Human');
});

// ⚠️ ห้ามให้ <tt:Color X=…> ที่อยู่ "ข้างใน" ColorCluster ไปชนกับ <tt:Color> ที่เป็น
// กล่องครอบ — regex ต้องยึดจาก ColorCluster ไม่ใช่จาก Color เฉย ๆ
test('วัตถุที่ไม่มีสี ต้องได้ colors = null ไม่ใช่ array ว่าง', () => {
  const noColor = DOC.replace(/<tt:Color>[\s\S]*?<\/tt:Color>/, '');
  const [s] = parseMetadata(noColor);
  assert.equal(s.colors, null, 'ไม่มีสี = null เพื่อให้ฝั่งรับแยกออกจาก "มีแต่ว่าง"');
  assert.equal(s.speed, 6.94, 'ฟิลด์อื่นต้องไม่ได้รับผลกระทบ');
});

test('วัตถุที่ไม่มีกรอบ ต้องถูกข้ามเหมือนเดิม แม้จะมีสี', () => {
  const noBox = DOC.replace(/<tt:BoundingBox[^>]*\/>/, '');
  assert.equal(parseMetadata(noBox).length, 0);
});
