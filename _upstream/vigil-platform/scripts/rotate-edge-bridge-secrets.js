#!/usr/bin/env node
// ============================================================
// Vigil Platform — Rotate edge bridge credentials (MQTT broker migration)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ออกรหัส bridge ใหม่ให้ edge ทุกไซต์ในรอบเดียว ใช้ตอนตัดสลับ Central ไป Mosquitto
// (รหัสเดิมหลุดเข้าบทสนทนา 28 ก.ย. 2569 — ดู memory feedback_secret_stdout_pipe)
//
//   node scripts/rotate-edge-bridge-secrets.js            # dry-run: ตรวจ ssh + บรรทัดใน .env ไม่เขียนอะไร
//   node scripts/rotate-edge-bridge-secrets.js --apply | node scripts/migrate-emqx-to-mosquitto.js …
//
// --apply ต่อไซต์: สุ่มรหัสใหม่ → สำรอง src/.env เป็น .env.bak-mosq-<ts> → เขียน BRIDGE_PASSWORD
// ใหม่ (ส่งรหัสผ่าน stdin ของ ssh ไม่อยู่ใน command line) → เก็บ encryptPii ลง
// sites.bridge_password_enc → จบแล้วพิมพ์ JSON {"edge-<code>": "…"} ออก stdout ให้ pipe
// ไม่ restart edge-bridge (ทำหลัง Mosquitto พร้อมแล้วเท่านั้น)
//
// 🔴 stdout = รหัสจริง ห้ามรัน --apply โดยไม่ pipe · ข้อความสถานะทั้งหมดออก stderr ชื่ออย่างเดียว
// ============================================================
'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const EDGES = [
  { alias: 'sshhkt', code: 'hkt' },
  { alias: 'sshhdy', code: 'hdy' },
  { alias: 'sshvss', code: 'vss' },
  { alias: 'sshvss3', code: 'rmutr-v' },
  { alias: 'sshnrw', code: 'nrw' },
];

// บนเครื่อง edge: อ่านรหัสใหม่จาก stdin → สำรอง .env → แทนบรรทัด BRIDGE_PASSWORD
// ใช้ env var ส่งเข้า node (ไม่อยู่ใน argv ⇒ ไม่โผล่ใน ps)
const REMOTE_APPLY = String.raw`set -e
cd ~/vigil-platform/src
IFS= read -r NEWPW
grep -q "^BRIDGE_PASSWORD=" .env || { echo "no BRIDGE_PASSWORD line" >&2; exit 3; }
cp -p .env ".env.bak-mosq-$(date +%Y%m%d%H%M%S)"
NEWPW="$NEWPW" node -e 'const fs=require("fs");const s=fs.readFileSync(".env","utf8");const out=s.replace(/^BRIDGE_PASSWORD=.*$/m,()=>"BRIDGE_PASSWORD="+process.env.NEWPW);fs.writeFileSync(".env",out);'
chmod 600 .env
grep -c "^BRIDGE_PASSWORD=" .env`;

const REMOTE_CHECK = 'grep -E "^BRIDGE_USERNAME=" ~/vigil-platform/src/.env | cut -d= -f2; grep -cE "^BRIDGE_PASSWORD=." ~/vigil-platform/src/.env';

function ssh(alias, cmd, input) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', alias, cmd],
    { encoding: 'utf8', input: input || '', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && process.stdout.isTTY) {
    console.error('--apply พิมพ์รหัสออก stdout — ต้อง pipe เข้า migrate-emqx-to-mosquitto.js เท่านั้น');
    process.exit(2);
  }
  // ตรวจทุกไซต์ก่อน ไม่แตะไซต์ไหนถ้ามีไซต์ใดไม่พร้อม (all-or-nothing ระดับการตรวจ)
  for (const e of EDGES) {
    const [user, n] = ssh(e.alias, REMOTE_CHECK).trim().split('\n');
    if (user !== `edge-${e.code}` || n !== '1') {
      console.error(`  ✗ ${e.alias}: BRIDGE_USERNAME=${user || '-'} · มีบรรทัดรหัส ${n || 0} (ต้องเป็น edge-${e.code} และ 1)`);
      process.exit(1);
    }
    console.error(`  ✓ ${e.alias} → edge-${e.code} พร้อม`);
  }
  if (!apply) { console.error('dry-run: ไม่ได้เขียนอะไร · ใช้ --apply | … ตอนตัดสลับ'); return; }

  const env = require('../src/config');
  const { Pool } = require('../src/node_modules/pg');
  const { encryptPii } = require('../src/helpers/blacklist-crypto');
  const pool = new Pool({ ...env.db(), max: 1 });
  const out = {};
  try {
    for (const e of EDGES) {
      const pw = crypto.randomBytes(18).toString('base64url');
      const enc = encryptPii(pw); // ถ้าไม่มี BLACKLIST_SECRET_KEY จะ throw ก่อนแตะ edge
      const n = ssh(e.alias, REMOTE_APPLY, pw + '\n').trim();
      if (n !== '1') throw new Error(`${e.alias}: เขียน .env ไม่สำเร็จ`);
      const r = await pool.query('UPDATE sites SET bridge_password_enc = $2 WHERE code = $1', [e.code, enc]);
      out[`edge-${e.code}`] = pw;
      console.error(`  ✓ edge-${e.code}: .env ใหม่ (สำรองไว้แล้ว) · DB ${r.rowCount === 1 ? 'เก็บแล้ว' : 'ไม่พบแถว sites'}`);
    }
  } finally { await pool.end(); }
  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
