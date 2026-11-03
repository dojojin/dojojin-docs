// ============================================================
// Vigil Platform — Test: scrubRawJson helper
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { scrubRawJson, scrubRawJsonSql } = require('../src/helpers/scrubRawJson');

// ตัดมาจาก rawXml ของจริง (Hikvision anprAlarm, events id 42552034)
const XML = '<EventNotificationAlert><ipAddress>10.6.100.19</ipAddress>'
  + '<ipv6Address>::</ipv6Address><portNo>80</portNo>'
  + '<macAddress>08:3b:c1:92:ae:68</macAddress><channelID>1</channelID>'
  + '<pilotsafebelt>no</pilotsafebelt><vicepilotsafebelt>unknown</vicepilotsafebelt>'
  + '</EventNotificationAlert>';

test('ปิดบังครบทั้งสาม tag และไม่แตะส่วนอื่นของ XML', () => {
  const out = scrubRawJson({ rawXml: XML, plateColor: 'white' });
  assert.match(out.rawXml, /<ipAddress>\*\*\*<\/ipAddress>/);
  assert.match(out.rawXml, /<ipv6Address>\*\*\*<\/ipv6Address>/);
  assert.match(out.rawXml, /<macAddress>\*\*\*<\/macAddress>/);
  assert.ok(!/10\.6\.100\.19/.test(out.rawXml), 'IP ยังหลุด');
  assert.ok(!/08:3b:c1/.test(out.rawXml), 'MAC ยังหลุด');
  // เข็มขัดนิรภัยต้องรอด — page-lpr.js:1833 อ่านจากตรงนี้
  assert.match(out.rawXml, /<pilotsafebelt>no<\/pilotsafebelt>/);
  assert.match(out.rawXml, /<vicepilotsafebelt>unknown<\/vicepilotsafebelt>/);
  assert.match(out.rawXml, /<portNo>80<\/portNo>/);
  assert.equal(out.plateColor, 'white');       // key อื่นไม่ถูกแตะ
});

test('ไม่แก้ input เดิม (pure) และทำซ้ำได้ผลเท่าเดิม (idempotent)', () => {
  const src = { rawXml: XML };
  const once = scrubRawJson(src);
  assert.equal(src.rawXml, XML, 'input ถูกแก้');
  assert.equal(scrubRawJson(once).rawXml, once.rawXml);
});

test('rawXml ที่ไม่ใช่สตริง / ไม่มี key = คืนของเดิม', () => {
  const noXml = { plate: 'กข1234' };
  assert.strictEqual(scrubRawJson(noXml), noXml);
  const objXml = { rawXml: { nested: true } };
  assert.strictEqual(scrubRawJson(objXml), objXml);
});

test('null / undefined / ค่าที่ไม่ใช่ object ปลอดภัย', () => {
  assert.strictEqual(scrubRawJson(null), null);
  assert.strictEqual(scrubRawJson(undefined), undefined);
  assert.strictEqual(scrubRawJson('x'), 'x');
  assert.strictEqual(scrubRawJson(7), 7);
});

test('scrubRawJsonSql มีครบทั้งสาม tag และ replacement ***', () => {
  const sql = scrubRawJsonSql('e.raw_json');
  for (const tag of ['ipAddress', 'ipv6Address', 'macAddress']) assert.ok(sql.includes(tag), tag);
  assert.ok(sql.includes('***'), 'ไม่มี replacement ***');
  assert.ok(sql.includes('e.raw_json'), 'ไม่ได้ใส่ชื่อคอลัมน์');
  assert.ok(sql.includes('regexp_replace') && sql.includes('jsonb_set'));
});
