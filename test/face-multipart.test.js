// ============================================================
// Vigil Platform — Tests: face-push multipart parse + transform (IM3-R)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// NOTE: payload here is FORMAT-CORRECT but synthetic — it proves the parse/
// transform logic (and that the extraction from hikvision-isapi.js is intact).
// Whether the real HKT01 camera emits this exact shape is the ON-SITE step.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseFaceAlarmMultipart, faceAlarmToRecord } = require('../src/helpers/face-multipart');

const B = 'testboundary';
// Build one multipart part exactly as parseFaceAlarmMultipart expects:
// --B\r\n <headers>\r\n\r\n <body bytes>\r\n
function part(name, contentType, bodyBuf) {
  const hdr = `--${B}\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: ${contentType}\r\nContent-Length: ${bodyBuf.length}\r\n\r\n`;
  return Buffer.concat([Buffer.from(hdr, 'utf8'), bodyBuf, Buffer.from('\r\n')]);
}

const ALARM = {
  CaptureResult: [{
    Face: { Property: [
      { description: 'age', value: '34' },
      { description: 'gender', value: 'male' },
      { description: 'mask', value: 'no' },
    ] },
    FaceContrastResult: [{ faces: [{ identify: [{ candidate: [{
      reserve_field: { name: 'สมชาย ทดสอบ' },
      listType: 'blackList', FDLibName: 'VIP', similarity: 0.91, human_id: 'h-42',
    }] }] }] }],
  }],
};

function buildBody() {
  return Buffer.concat([
    part('alarmResult', 'application/json', Buffer.from(JSON.stringify(ALARM), 'utf8')),
    part('faceImage', 'image/jpeg', Buffer.from([0xFF, 0xD8, 0xFF, 0xAA, 0xBB])),
    part('backgroundImage', 'image/jpeg', Buffer.from([0xFF, 0xD8, 0x01, 0x02])),
    Buffer.from(`--${B}--\r\n`, 'utf8'),
  ]);
}

describe('IM3-R face multipart', () => {
  it('parses alarm JSON + named image parts', () => {
    const { alarmJson, images } = parseFaceAlarmMultipart(buildBody(), B);
    assert.ok(alarmJson, 'alarmJson present');
    assert.equal(images.faceImage.length, 5);
    assert.equal(images.backgroundImage.length, 4);
    assert.ok(images.faceImage.equals(Buffer.from([0xFF, 0xD8, 0xFF, 0xAA, 0xBB])), 'face bytes intact');
  });

  it('skips a mixedTargetDetection part out of alarmJson', () => {
    const body = Buffer.concat([
      part('mixedTargetDetection', 'application/json', Buffer.from(JSON.stringify({ x: 1 }), 'utf8')),
      Buffer.from(`--${B}--\r\n`, 'utf8'),
    ]);
    const { alarmJson, bodyJson } = parseFaceAlarmMultipart(body, B);
    assert.equal(alarmJson, null);
    assert.deepEqual(bodyJson, { x: 1 });
  });

  it('transforms alarm JSON to the canonical events.raw_json shape', () => {
    const { alarmJson } = parseFaceAlarmMultipart(buildBody(), B);
    const { rawJson, personName, listType, similarity } = faceAlarmToRecord(alarmJson);
    assert.equal(personName, 'สมชาย ทดสอบ');
    assert.equal(listType, 'blackList');
    assert.equal(similarity, 0.91);
    assert.equal(rawJson.eventType, 'faceRecognition');
    assert.equal(rawJson.vendor, 'hikvision');
    assert.equal(rawJson.age, '34');
    assert.equal(rawJson.gender, 'male');
    assert.equal(rawJson.fdLibName, 'VIP');
  });

  it('no-match / empty alarm degrades to nulls (no throw)', () => {
    const { rawJson, personName } = faceAlarmToRecord({});
    assert.equal(personName, null);
    assert.equal(rawJson.eventType, 'faceRecognition');
    assert.equal(rawJson.age, null);
  });
});
