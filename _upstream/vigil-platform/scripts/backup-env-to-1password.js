#!/usr/bin/env node
// ============================================================
// Vigil Platform — Back up Central src/.env to 1Password
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// เจ้าของสั่งตรง ๆ (2026-09-28): อยากมีสำเนา src/.env ตัวจริงที่กู้คืนได้ ถ้าเครื่อง
// Central พังหรือไฟล์หาย. 1Password Personal vault ที่มีอยู่เดิมเก็บภาพเก่า
// 2026-08-14 ค้างไว้เฉยๆ — ห้ามใช้ภาพนั้น restore. ทิศทางเป็น one-way เสมอ:
// .env → 1Password เท่านั้น ห้ามมีเส้นทางย้อนกลับ (1Password → .env) ใน repo นี้.
//
//   node scripts/backup-env-to-1password.js [--dry-run]
//
// อ่าน src/.env เป็นไฟล์ตรงๆ (ไม่ load เข้า process.env) แล้วส่งทั้งก้อนเป็น
// SECURE_NOTE เดียวใน 1Password — notesPlain = เนื้อไฟล์ทั้งหมด, และแยกเป็น
// custom field ต่อ 1 ตัวแปรในหมวด "env" เพื่อ diff/ค้นหาราย key ได้ในเว็บ
// 1Password. token อ่านจากไฟล์ ส่งให้ `op` ผ่าน child env เท่านั้น; JSON ของ
// item ส่งทาง stdin เท่านั้น — ไม่มีค่าไหนขึ้น argv หรือ stdout ของ process นี้.
// ============================================================
'use strict';

const path = require('path');
const fsReal = require('fs');
const os = require('os');
const { spawn: spawnReal } = require('child_process');
const { runOp, opAvailable } = require('./lib/onepassword-cli');

const DEFAULT_TITLE = 'Vigil · CENTRAL — src/.env (live)';
const DEFAULT_VAULT = 'Vigil Central';
const CONCEALED_RE = /SECRET|PASSWORD|TOKEN|_KEY$|KEY_ENC/;

function defaultTokenFile() {
  return path.join(os.homedir(), '.config', 'op', 'vigil-central.token');
}

// Last assignment of a key wins · skips comments/blank lines · strips
// surrounding quotes only when the whole value is quoted · empty values kept.
function parseEnvFile(text) {
  const map = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1);
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

function buildItem({ text, title, vault }) {
  const vars = parseEnvFile(text);
  const fields = [{ id: 'notesPlain', type: 'STRING', purpose: 'NOTES', label: 'notesPlain', value: text }];
  let concealedCount = 0;
  for (const [key, value] of vars) {
    const concealed = CONCEALED_RE.test(key);
    if (concealed) concealedCount++;
    fields.push({ id: key, type: concealed ? 'CONCEALED' : 'STRING', label: key, value, section: { id: 'env' } });
  }
  const item = {
    title,
    category: 'SECURE_NOTE',
    vault: { name: vault },
    tags: ['vigil'],
    sections: [{ id: 'env', label: 'env' }],
    fields,
  };
  return { item, fieldCount: vars.size, concealedCount };
}

/**
 * Core backup logic — no argv/stdout, deps injectable for tests. Never
 * throws: always resolves { ok, action, reason } so a caller (e.g. the
 * rotation script) can treat a failed backup as a warning, not a fatal error.
 * action: 'created' | 'updated' | 'skipped' | 'failed' | 'dry-run'.
 */
async function backupEnvToOnePassword({ dryRun = false } = {}, deps = {}) {
  const {
    fs = fsReal,
    spawn = spawnReal,
    env = process.env,
    log = (msg) => process.stderr.write(msg), // status only — stderr, never a value
  } = deps;

  const envPath = env.VIGIL_ENV_FILE || path.join(__dirname, '..', 'src', '.env');
  const title = env.VIGIL_OP_ITEM_TITLE || DEFAULT_TITLE;
  const vault = env.VIGIL_OP_VAULT || DEFAULT_VAULT;
  const tokenFile = env.VIGIL_OP_TOKEN_FILE || defaultTokenFile();

  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch (e) {
    log(`[backup-env-to-1password] อ่าน ${envPath} ไม่ได้ (${e.code || 'error'}) — ข้าม backup\n`);
    return { ok: false, action: 'skipped', reason: 'env file unreadable' };
  }

  const { item, fieldCount, concealedCount } = buildItem({ text, title, vault });

  if (dryRun) {
    const tokenPresent = fs.existsSync(tokenFile);
    const opReady = tokenPresent && (await opAvailable(spawn));
    log(
      `[dry-run] title="${title}" · vault="${vault}" · fields=${fieldCount} (concealed ${concealedCount}) · ` +
      `1Password ${opReady ? 'พร้อม backup' : 'จะข้าม (ไม่มี token file หรือ op ไม่อยู่ใน PATH)'}\n`
    );
    return { ok: true, action: 'dry-run', reason: null };
  }

  if (!fs.existsSync(tokenFile)) {
    log(`[backup-env-to-1password] ข้าม: ไม่มี token file (${tokenFile})\n`);
    return { ok: false, action: 'skipped', reason: 'no token file' };
  }
  if (!(await opAvailable(spawn))) {
    log('[backup-env-to-1password] ข้าม: op ไม่อยู่ใน PATH\n');
    return { ok: false, action: 'skipped', reason: 'op not on PATH' };
  }

  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  // minimal env for op: the caller's process.env may already hold every .env
  // secret (rotation loads src/config), and op needs none of them
  const childEnv = { PATH: env.PATH, HOME: env.HOME, OP_SERVICE_ACCOUNT_TOKEN: token };

  let exists = true;
  try {
    await runOp(spawn, ['item', 'get', title, '--vault', vault, '--format', 'json'], { env: childEnv });
  } catch { exists = false; }

  try {
    if (!exists) {
      await runOp(spawn, ['item', 'create', '--vault', vault, '-'], { env: childEnv, input: JSON.stringify(item) });
    } else {
      await runOp(spawn, ['item', 'edit', title, '--vault', vault], { env: childEnv, input: JSON.stringify(item) });
    }
  } catch (e) {
    log(`[backup-env-to-1password] op ล้มเหลว (exit ${e.code === undefined ? '?' : e.code}) — ข้าม backup\n`);
    return { ok: false, action: 'failed', reason: `op exit ${e.code === undefined ? '?' : e.code}` };
  }

  const action = exists ? 'updated' : 'created';
  log(`[backup-env-to-1password] title="${title}" · vault="${vault}" · fields=${fieldCount} (concealed ${concealedCount}) · ${action}\n`);
  return { ok: true, action, reason: null };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const result = await backupEnvToOnePassword({ dryRun });
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { backupEnvToOnePassword, parseEnvFile, buildItem, CONCEALED_RE };
