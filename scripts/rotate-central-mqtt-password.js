#!/usr/bin/env node
// ============================================================
// Vigil Platform — Rotate a Central MQTT account password
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// dashboard-subscriber และ snapshot-publisher หลุดเข้า session transcript
// 28 ก.ย. 2569 — ต้องหมุนรหัสใหม่โดยไม่พิมพ์รหัสออกที่ไหนเลย (ไม่ argv ไม่ stdout
// ไม่ log). service ที่ถืออยู่ (mqtt-subscriber / hikvision+dahua) ยังต่อด้วย
// รหัสเดิมจนกว่าจะ restart เอง — script นี้ไม่ restart ให้.
//
//   node scripts/rotate-central-mqtt-password.js subscriber|snapshot [--dry-run]
//
// ลำดับ: หมุนที่ broker (Mosquitto dynsec, บัญชีต้องมีอยู่แล้ว — rotation only,
// ไม่สร้างใหม่) ก่อน แล้วค่อยเขียน src/.env (สำรองก่อนเขียนทุกครั้ง 0600) แล้ว
// สุดท้าย backup ไป 1Password (optional, ไม่ผ่านก็ไม่ทำให้ rotation ล้ม)
// ============================================================
'use strict';

const path = require('path');
const fsReal = require('fs');
const cryptoReal = require('crypto');
const os = require('os');
const { spawn: spawnReal } = require('child_process');
const { applyEnv } = require('./set-central-broker-env');
const { opAvailable } = require('./lib/onepassword-cli');
const { backupEnvToOnePassword } = require('./backup-env-to-1password');

const ACCOUNTS = {
  subscriber: { userKey: 'MQTT_SUBSCRIBER_USER', passKey: 'MQTT_SUBSCRIBER_PASSWORD', pm2: ['mqtt-subscriber'] },
  snapshot: { userKey: 'SNAPSHOT_PUBLISHER_USER', passKey: 'SNAPSHOT_PUBLISHER_PASSWORD', pm2: ['hikvision', 'dahua'] },
};

function usageError(msg) {
  const e = new Error(msg);
  e.usage = true;
  return e;
}

function tsOf(d) {
  return d.toISOString().replace(/\D/g, '').slice(0, 14);
}

/**
 * Core rotation logic — no argv/stdout, deps injectable for tests.
 * Throws (err.usage = true for a usage/argument error) on refusal.
 * Throws (err.envWriteFailed = true) when the broker changed but .env did not.
 */
async function rotate(account, { dryRun = false } = {}, deps = {}) {
  const {
    brokerAdmin = require('../src/helpers/brokerAdmin'),
    fs = fsReal,
    crypto = cryptoReal,
    spawn = spawnReal,
    env = process.env,
    now = () => new Date(),
    config = require('../src/config'),
    log = (msg) => process.stderr.write(msg), // status output — stderr only, never stdout
    backupEnv = backupEnvToOnePassword, // whole-.env backup, called after a successful write
  } = deps;

  const acct = ACCOUNTS[account];
  if (!acct) throw usageError(`ไม่รู้จักบัญชี "${account}" — ต้องเป็น subscriber หรือ snapshot`);

  if (config.str('BROKER_KIND') !== 'mosquitto') {
    throw new Error('BROKER_KIND ไม่ใช่ mosquitto — script นี้หมุนรหัสผ่าน dynsec เท่านั้น');
  }
  const username = config.str(acct.userKey);
  if (!username) throw new Error(`${acct.userKey} ยังไม่ตั้งใน env`);

  const exists = await brokerAdmin.clientExists(username);
  if (!exists) {
    throw new Error(`บัญชี ${username} ไม่มีอยู่ใน broker แล้ว — script นี้หมุนรหัสเท่านั้น ไม่สร้างบัญชีใหม่`);
  }
  if (dryRun) {
    const tokenFile = env.VIGIL_OP_TOKEN_FILE || path.join(os.homedir(), '.config', 'op', 'vigil-central.token');
    const opWouldRun = fs.existsSync(tokenFile) && (await opAvailable(spawn));
    log(
      `[dry-run] ${account} (${username}): broker พร้อมหมุน · .env key ${acct.passKey} พร้อมเขียน · ` +
      `1Password ${opWouldRun ? 'พร้อม backup ทั้ง .env' : 'จะข้าม (ไม่มี token file หรือ op ไม่อยู่ใน PATH)'}\n`
    );
    return { dryRun: true, account, username };
  }

  const password = crypto.randomBytes(24).toString('base64url');

  await brokerAdmin.upsertUser(username, password); // client มีอยู่แล้ว ⇒ setClientPassword เท่านั้น ไม่แตะ roles

  const ENV_PATH = env.VIGIL_ENV_FILE || path.join(__dirname, '..', 'src', '.env');
  let before;
  try {
    before = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (e) {
    const err = new Error(
      `broker หมุนรหัส ${username} สำเร็จแล้ว แต่อ่าน ${ENV_PATH} ไม่ได้ (${e.message}) — ` +
      `.env ยังเป็นรหัสเก่า กู้จาก backup ไม่พอเพราะ broker ไม่มีรหัสเดิมให้ rollback ต้องรัน rotation นี้ใหม่ให้จบ`
    );
    err.envWriteFailed = true;
    throw err;
  }

  const backupPath = `${ENV_PATH}.bak-rotate-${tsOf(now())}`;
  let envUpdated = false;
  try {
    fs.copyFileSync(ENV_PATH, backupPath);
    fs.chmodSync(backupPath, 0o600);
    const after = applyEnv(before, {}, { [acct.passKey]: password });
    fs.writeFileSync(ENV_PATH, after, { mode: 0o600 });
    fs.chmodSync(ENV_PATH, 0o600); // mode ข้างบนมีผลแค่ตอนสร้างไฟล์ใหม่ ไม่ใช่ตอนเขียนทับ
    envUpdated = true;
  } catch (e) {
    const err = new Error(
      `broker หมุนรหัส ${username} สำเร็จแล้ว แต่เขียน ${ENV_PATH} ไม่สำเร็จ (${e.message}) — ` +
      `.env ยังเป็นรหัสเก่า กู้จาก backup ไม่พอเพราะ broker ไม่มีรหัสเดิมให้ rollback ต้องรัน rotation นี้ใหม่ให้จบ`
    );
    err.envWriteFailed = true;
    throw err;
  }

  // backup ทั้ง .env (ไม่ใช่แค่รหัสที่เพิ่งหมุน) — best effort เสมอ, ล้มเหลวไม่ทำให้ rotation ล้ม
  let op;
  try {
    op = await backupEnv({}, { fs, spawn, env, log: () => {} }); // เงียบ log ภายใน — สรุปรวมด้านล่างแทน
  } catch (e) {
    op = { ok: false, action: 'failed', reason: e.message };
  }
  if (!op.ok) {
    log(`[rotate-central-mqtt-password] ไม่ได้ backup .env เข้า 1Password: ${op.reason}\n`);
  }

  log(
    `[rotate-central-mqtt-password] ${account} (${username}): broker หมุนแล้ว · ` +
    `.env เขียนแล้ว (สำรอง ${backupPath}) · 1Password ${op.ok ? op.action : `${op.action}${op.reason ? ` (${op.reason})` : ''}`} · ` +
    `ต้อง restart pm2: ${acct.pm2.join(' ')}\n`
  );

  return { dryRun: false, account, username, envUpdated, backupPath, op };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const account = args.find((a) => !a.startsWith('--'));
  if (!account) {
    console.error('ใช้: node scripts/rotate-central-mqtt-password.js subscriber|snapshot [--dry-run]');
    process.exit(2);
  }
  try {
    await rotate(account, { dryRun });
    // brokerAdmin keeps its provisioner MQTT connection open for reuse, so the
    // event loop never drains on its own — exit explicitly once done
    process.exit(0);
  } catch (e) {
    console.error(`[rotate-central-mqtt-password] ${e.message}`);
    process.exit(e.usage ? 2 : 1);
  }
}

if (require.main === module) main();
module.exports = { rotate, ACCOUNTS };
