#!/usr/bin/env node
// ============================================================
// Vigil Platform — Central broker env (MQTT broker migration)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// เขียนค่าที่ Central ต้องใช้กับ Mosquitto ลง src/.env โดยไม่พิมพ์รหัสออกมาเลย
//
//   node scripts/set-central-broker-env.js --init            # เพิ่ม MQTT_PROVISIONER_* / MQTT_PUBLISHER_* (สุ่มรหัส) ถ้ายังไม่มี
//   node scripts/set-central-broker-env.js --kind mosquitto  # ตั้ง BROKER_KIND (emqx | mosquitto)
//
// สำรอง src/.env เป็น .env.bak-broker-<ts> ทุกครั้งที่เขียน · ค่าที่มีอยู่แล้วไม่ถูกเขียนทับ
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV = process.env.VIGIL_ENV_FILE || path.join(__dirname, '..', 'src', '.env');

/** คืนข้อความ .env ใหม่ — เพิ่ม key ที่ไม่มี · แทนค่า key ใน `overwrite` */
function applyEnv(text, add, overwrite = {}) {
  let s = text.endsWith('\n') || text === '' ? text : text + '\n';
  for (const [k, v] of Object.entries(overwrite)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    s = re.test(s) ? s.replace(re, () => `${k}=${v}`) : s + `${k}=${v}\n`;
  }
  for (const [k, v] of Object.entries(add)) {
    if (!new RegExp(`^${k}=.+$`, 'm').test(s)) s += `${k}=${v}\n`;
  }
  return s;
}

function main() {
  const init = process.argv.includes('--init');
  const ki = process.argv.indexOf('--kind');
  const kind = ki > -1 ? process.argv[ki + 1] : null;
  if (!init && !kind) { console.error('ใช้ --init หรือ --kind <emqx|mosquitto>'); process.exit(2); }
  if (kind && !['emqx', 'mosquitto'].includes(kind)) { console.error('kind ต้องเป็น emqx หรือ mosquitto'); process.exit(2); }

  const before = fs.readFileSync(ENV, 'utf8');
  const pw = () => crypto.randomBytes(18).toString('base64url');
  const add = init ? {
    MQTT_PROVISIONER_USER: 'provisioner', MQTT_PROVISIONER_PASSWORD: pw(),
    MQTT_PUBLISHER_USER: 'publisher', MQTT_PUBLISHER_PASSWORD: pw(),
  } : {};
  const after = applyEnv(before, add, kind ? { BROKER_KIND: kind } : {});
  if (after === before) { console.error('ไม่มีอะไรเปลี่ยน'); return; }
  fs.copyFileSync(ENV, `${ENV}.bak-broker-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`);
  fs.writeFileSync(ENV, after, { mode: 0o600 });
  fs.chmodSync(ENV, 0o600); // `mode` above applies only when the file is created, not on overwrite
  const keys = after.split('\n').filter((l) => /^(BROKER_KIND|MQTT_PROVISIONER_USER|MQTT_PUBLISHER_USER)=/.test(l));
  console.error('เขียนแล้ว:', keys.join(' · '), '· รหัส provisioner/publisher', /^MQTT_PROVISIONER_PASSWORD=.+$/m.test(after) && /^MQTT_PUBLISHER_PASSWORD=.+$/m.test(after) ? 'มีแล้ว' : 'ยังไม่มี');
}

if (require.main === module) main();
module.exports = { applyEnv };
