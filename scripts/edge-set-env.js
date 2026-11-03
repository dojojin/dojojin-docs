#!/usr/bin/env node
// ============================================================
// Vigil Platform — edge site env writer (Mosquitto migration E1)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// เขียน/แทนค่า KEY=VALUE ใน src/.env ของ edge โดยไม่พิมพ์ค่าที่มีอยู่แล้วออกมา
// เลย (แต่ต่างจาก scripts/set-central-broker-env.js ตรงที่นี่รับค่า
// non-secret จาก command line ได้ตรง ๆ — เหตุผลจึงต้องปฏิเสธ key ที่ดูเหมือน
// ความลับ กันคนพิมพ์ EDGE_CAMERA_BROKER_URL=... ที่มี PASSWORD/SECRET/TOKEN/
// *KEY ติดมาด้วยความเข้าใจผิดว่าใช้ตัวนี้ตั้งรหัสได้).
//
//   node scripts/edge-set-env.js EDGE_BROKER=mosquitto EDGE_CAMERA_BROKER_URL=mqtt://172.29.51.52:1883
//
// สำรอง src/.env เป็น .env.bak-edge-<ts> ก่อนเขียนทุกครั้ง · mode 600
// path ของ .env override ได้ด้วย env VIGIL_ENV_FILE (ใช้ในเทสต์)
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { applyEnv } = require('./set-central-broker-env.js');

const ENV_FILE = process.env.VIGIL_ENV_FILE || path.join(__dirname, '..', 'src', '.env');
const SECRET_KEY_RE = /PASS|SECRET|TOKEN|KEY$/i;

function parseArgs(argv) {
  const overwrite = {};
  for (const arg of argv) {
    const i = arg.indexOf('=');
    if (i < 1) throw new Error(`รูปแบบไม่ถูกต้อง (ต้องเป็น KEY=VALUE): ${arg}`);
    const key = arg.slice(0, i);
    const value = arg.slice(i + 1);
    if (!/^[A-Z][A-Z_0-9]*$/.test(key)) throw new Error(`ชื่อ key ไม่ถูกต้อง: ${key}`);
    if (SECRET_KEY_RE.test(key)) throw new Error(`ปฏิเสธ key ที่ดูเหมือนความลับ: ${key} — ใช้ scripts/set-central-broker-env.js สำหรับ credential`);
    overwrite[key] = value;
  }
  return overwrite;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { console.error('ใช้: node scripts/edge-set-env.js KEY=VALUE [KEY2=VALUE2 ...]'); process.exit(2); }

  let overwrite;
  try { overwrite = parseArgs(argv); }
  catch (e) { console.error(e.message); process.exit(2); }

  const before = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const after = applyEnv(before, {}, overwrite);
  if (after === before) { console.error('ไม่มีอะไรเปลี่ยน'); return; }

  if (fs.existsSync(ENV_FILE)) {
    const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    fs.copyFileSync(ENV_FILE, `${ENV_FILE}.bak-edge-${ts}`);
  }
  fs.writeFileSync(ENV_FILE, after, { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600); // writeFileSync's `mode` is only honoured on file CREATE, not on an overwrite of an existing file (POSIX open() semantics) — force it explicitly
  console.error('เขียนแล้ว:', Object.keys(overwrite).join(' · '));
}

if (require.main === module) main();
module.exports = { parseArgs, SECRET_KEY_RE };
