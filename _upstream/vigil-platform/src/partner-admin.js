#!/usr/bin/env node
// ============================================================
// Vigil Platform — Partner API ops tool (CLI)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// A terminal front-end for helpers/partnerAdmin.js. The console at
// ตั้งค่า › เชื่อมต่อภายนอก drives the same functions, so the two cannot
// disagree about what "create a partner" means — which they would eventually,
// if each had its own copy.
//
// This file owns presentation only: argument parsing and what gets printed.
//
//   node src/partner-admin.js list
//   node src/partner-admin.js create <slug> "<label>" [--sites hkt,hdy] [--days 90]
//   node src/partner-admin.js revoke <slug>
//   node src/partner-admin.js rotate <slug> [--days 90]
//   node src/partner-admin.js extend <slug> --days 90
//   node src/partner-admin.js reveal <slug>
//   node src/partner-admin.js delete <slug> [--confirm <slug>]
//
// Run with src/.env loaded:  set -a; . ./src/.env; set +a
// ============================================================
'use strict';

const { Pool } = require('pg');
const PA = require('./helpers/partnerAdmin');
const env = require('./config');

const pool = new Pool({ ...env.db() });

const fmtExpiry = (d) => {
  if (!d) return 'no expiry';
  const left = Math.ceil((new Date(d) - Date.now()) / 86400000);
  return `${new Date(d).toISOString().slice(0, 10)} (${left > 0 ? left + ' days left' : 'EXPIRED'})`;
};

/** Run fn inside a transaction. Create needs one; the rest are single
 *  statements but get the same treatment so there is one shape to read. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function list() {
  const { rows } = await pool.query(
    `SELECT slug, label, app_key, db_role, active, rate_per_min, site_codes,
            max_lookback_days, created_at, last_seen_at, revoked_at, expires_at
       FROM api_consumers ORDER BY active DESC, id`);
  if (!rows.length) return console.log('(no partners yet)');
  for (const r of rows) {
    console.log(
      `${r.active ? '●' : '○'} ${r.slug.padEnd(16)} ${r.label}\n` +
      `    key=${r.app_key}  role=${r.db_role}  rate=${r.rate_per_min}/min` +
      `  sites=${r.site_codes ? (r.site_codes.length ? r.site_codes.join(',') : 'none') : 'all'}` +
      `  lookback=${r.max_lookback_days ? r.max_lookback_days + 'd' : 'system'}\n` +
      `    created=${r.created_at.toISOString().slice(0, 16)}` +
      `  last seen=${r.last_seen_at ? r.last_seen_at.toISOString().slice(0, 16) : 'never'}\n` +
      `    expires=${fmtExpiry(r.expires_at)}` +
      (r.revoked_at ? `  revoked=${r.revoked_at.toISOString().slice(0, 16)}` : ''));
  }
}

async function create(slug, label, sites, days) {
  const r = await tx((c) => PA.createPartner(c, {
    slug, label, sites, days, createdBy: 'partner-admin cli',
  }));
  console.log(`\n  partner "${slug}" created (role ${r.dbRole}).\n`);
  console.log(`  App Key:    ${r.appKey}`);
  console.log(`  App Secret: ${r.appSecret}`);
  console.log(`  Expires:    ${fmtExpiry(r.expiresAt)}`);
  if (!r.expiresAt) console.log(`              (no --days given — these credentials never stop working on their own)`);
  console.log(`\n  Send the secret over a channel you would send a password over.`);
  console.log(`  It can be read back later from ตั้งค่า › เชื่อมต่อภายนอก, or with:`);
  console.log(`      node src/partner-admin.js reveal ${slug}`);
  console.log(`\n  This partner can read all 11 v_*_public views. Narrow that in the console.`);
}

async function revoke(slug) {
  const r = await tx((c) => PA.revokePartner(c, slug, 'partner-admin cli'));
  console.log(`  "${slug}" deactivated — requests are refused from now on.`);
  console.log(`  Role ${r.dbRole} is left in place. To remove it and the row for good:`);
  console.log(`      node src/partner-admin.js delete ${slug}`);
  console.log(`  (do not DROP ROLE by hand — it still holds grants on the v_*_public`);
  console.log(`   views and will fail with "cannot be dropped because some objects`);
  console.log(`   depend on it". delete revokes them in the right order first.)`);
}

/**
 * ลบถาวร — กู้คืนไม่ได้
 *
 * ให้พิมพ์ **slug ซ้ำ** ไม่ใช่คำว่า Confirm เหมือนบน console โดยตั้งใจ:
 * บนหน้าเว็บผู้ใช้กำลังมองการ์ดของ partner ใบนั้นอยู่ตรงหน้า คำยืนยันสั้น ๆ จึงพอ
 * แต่บน terminal ไม่มีอะไรยืนยันว่าพิมพ์ slug ถูกตั้งแต่แรก การพิมพ์ซ้ำจึงเป็น
 * การตรวจตัวเดียวที่มีความหมายจริง (แนวเดียวกับปุ่มรีบูตกล้องที่ให้พิมพ์ชื่อกล้อง)
 *
 * ไม่ใช่ TTY (รันในสคริปต์/cron) → บังคับ --confirm <slug> · ไม่มีธง --yes ที่ข้ามด่าน
 */
function askLine(question) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a); });
  });
}

async function del(slug, confirmFlag) {
  if (!slug) throw new Error('ต้องระบุ slug');
  const { rows } = await pool.query(
    'SELECT slug, label, db_role, active FROM api_consumers WHERE slug = $1', [slug]);
  if (!rows.length) throw new Error(`ไม่พบ partner "${slug}"`);
  const c = rows[0];

  console.log(`\n  ลบถาวร — กู้คืนไม่ได้`);
  console.log(`  ${c.label} (${c.slug}) · role ${c.db_role}${c.active ? '  ⚠️ ยังใช้งานอยู่' : ''}`);
  console.log(`  แถว partner จะหายไป และ role ใน Postgres จะถูกลบพร้อมสิทธิ์ทั้งหมด`);
  console.log(`  ประวัติการเรียก API ยังอยู่ (เก็บ app_key ไว้) แต่จะไม่ผูกกับ partner นี้อีก\n`);

  let typed = confirmFlag;
  if (typed === undefined) {
    if (!process.stdin.isTTY) {
      throw new Error(`ไม่ใช่ terminal — ต้องส่ง --confirm ${slug} มาด้วยเพื่อยืนยัน`);
    }
    typed = await askLine(`  พิมพ์ slug ให้ตรงเพื่อยืนยัน:\n  > `);
  }
  if (String(typed).trim() !== slug) {
    throw new Error('slug ไม่ตรง — ยกเลิกแล้ว ไม่มีอะไรถูกลบ');
  }

  const r = await tx((client) => PA.deletePartner(client, slug, {
    username: `partner-admin cli (${process.env.SUDO_USER || process.env.USER || 'unknown'})`,
  }));
  console.log(`\n  ✓ ลบ "${r.slug}" แล้ว`);
  console.log(`    role ${r.dbRole}: ${r.roleDropped ? 'ลบแล้ว' : 'ไม่มีอยู่แล้วตั้งแต่ต้น'}`);
  console.log(`    api_request_log: ${r.logRows} แถว — เก็บไว้แต่ตัดการเชื่อมโยงแล้ว`);
  console.log(`    บันทึก audit_log ไว้แล้ว (slug / app_key / db_role) — เป็นร่องรอยเดียวที่เหลือ\n`);
}

async function rotate(slug, days) {
  const r = await tx((c) => PA.rotatePartner(c, slug, days));
  console.log(`\n  rotated. The previous key stops working immediately.\n`);
  console.log(`  App Key:    ${r.appKey}`);
  console.log(`  App Secret: ${r.appSecret}`);
  console.log(`  Expires:    ${fmtExpiry(r.expiresAt)}\n`);
}

async function extend(slug, days) {
  const r = await tx((c) => PA.extendPartner(c, slug, days));
  console.log(`  "${slug}" now expires ${fmtExpiry(r.expiresAt)}`);
}

async function reveal(slug) {
  const r = await PA.revealSecret(pool, slug);
  console.log(`  App Key:    ${r.appKey}`);
  console.log(`  App Secret: ${r.appSecret}`);
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const sites = flag('--sites') !== undefined ? flag('--sites').split(',').filter(Boolean) : null;
  const days = flag('--days');
  const firstFlag = rest.findIndex((a) => a.startsWith('--'));
  const args = firstFlag >= 0 ? rest.slice(0, firstFlag) : rest;

  try {
    if (cmd === 'list') await list();
    else if (cmd === 'create') await create(args[0], args[1], sites, days);
    else if (cmd === 'revoke') await revoke(args[0]);
    else if (cmd === 'rotate') await rotate(args[0], days);
    else if (cmd === 'extend') await extend(args[0], days);
    else if (cmd === 'reveal') await reveal(args[0]);
    else if (cmd === 'delete') await del(args[0], flag('--confirm'));
    else {
      console.log(`usage: partner-admin.js
  list
  create <slug> "<label>" [--sites a,b] [--days ${PA.TERMS.join('|')}]
  revoke <slug>
  rotate <slug> [--days N]        rotate keys; keeps the existing term unless --days
  extend <slug> --days N          new term counted from today
  reveal <slug>                   print the stored key and secret
  delete <slug> [--confirm <slug>]  ลบถาวร กู้คืนไม่ได้ — ต้องพิมพ์ slug ซ้ำเพื่อยืนยัน
                                    (ไม่ใช่ terminal ต้องส่ง --confirm มาด้วย)`);
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`  ${e.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
