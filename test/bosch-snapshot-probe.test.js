// Vigil Platform — ด่านยืนยันกล้องด้วยภาพต้องรู้จัก Bosch (GOTCHAS #217)
// เหตุจริง: Bosch ตกไปชุด onvif → http_400 ทุกเส้น → 8 กล้องติด offline ถาวร
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('edge snapshot probe has a Bosch path', () => {
  const s = rd('src/lpr-receiver.js');
  const block = s.slice(s.indexOf('const SNAPSHOT_PROBE_CANDIDATES'), s.indexOf('};', s.indexOf('const SNAPSHOT_PROBE_CANDIDATES')));
  assert.match(block, /bosch:\s*\['\/snap\.jpg'\]/);
});

test('central logs why a snapshot confirmation failed (once per reason)', () => {
  const s = rd('src/api-server.js');
  assert.match(s, /result\.reason !== st\.lastReason/);
  assert.match(s, /ยืนยันด้วยภาพไม่ผ่าน/);
});

test('every vendor in use has its own probe path, and boot warns when one does not', () => {
  const s = rd('src/lpr-receiver.js');
  const block = s.slice(s.indexOf('const SNAPSHOT_PROBE_CANDIDATES'), s.indexOf('\n};', s.indexOf('const SNAPSHOT_PROBE_CANDIDATES')));
  for (const v of ['dahua', 'bosch', 'hikvision']) assert.match(block, new RegExp(`\\n\\s*${v}:\\s*\\[`), v);
  assert.match(s, /warnVendorsWithoutProbePath\(\);\n\}\);/);
});
