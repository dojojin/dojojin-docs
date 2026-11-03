// ============================================================
// Vigil Platform — Partner lifecycle (Phase TP5b)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Create, rotate, extend and revoke — the operations that change WHO can call
// /v1, as opposed to routes/integrations.js which changes WHAT they may read.
//
// Extracted here because two callers need them and must not diverge:
// src/partner-admin.js (the CLI, for an operator on the box) and
// src/routes/integrations.js (the console, for an operator in a browser). Two
// implementations of "create a partner" would eventually differ on something
// like whether the role is checked before the row is written, and the one that
// gets it wrong would be the one nobody tested.
//
// Every function here takes a pg client or pool as its first argument and does
// no I/O of its own beyond that — no console output, no process exit. The
// callers own how results are presented.
// ============================================================
'use strict';

const crypto = require('crypto');
const { encryptCred, decryptCred } = require('../crypto-creds');

// A slug becomes a Postgres role name, and CREATE ROLE takes an identifier,
// which cannot be parameterised. This regex is the only thing standing between
// the caller's input and interpolated SQL, so it is deliberately narrow:
// lowercase start, then lowercase/digit/underscore, bounded length.
const SLUG_RE = /^[a-z][a-z0-9_]{1,30}$/;

// Terms an operator actually issues. A short list makes "when does this end" a
// decision with few answers, which reviews more easily than a free-form date —
// and it removes any question of what a malformed date should mean.
const TERMS = [30, 60, 90, 120, 180, 365];

// Reserved because they already exist in this cluster or are Postgres' own.
// Creating a partner named 'postgres' would either fail confusingly or, worse,
// attach a partner row to an existing privileged role.
const RESERVED = new Set(['postgres', 'public', 'vigil_sql', 'third_party_readonly', 'pg_monitor']);

const newKey = () => 'vk_' + crypto.randomBytes(12).toString('hex');
const newSecret = () => crypto.randomBytes(32).toString('base64url');

function termDate(days) {
  if (days === undefined || days === null || days === '') return null;   // no expiry
  const n = Number(days);
  if (!TERMS.includes(n)) throw new Error(`ระยะเวลาต้องเป็น ${TERMS.join(' / ')} วัน (หรือเว้นว่าง = ไม่หมดอายุ)`);
  return new Date(Date.now() + n * 86400000);
}

/**
 * encryptCred falls back to returning the plaintext with a warning when
 * CAMERA_SECRET_KEY is unset — acceptable for the camera config it was written
 * for, where it allowed a gradual migration. Here it would write a working
 * credential into the table in the clear, so it is checked rather than trusted.
 */
function encryptSecret(secret) {
  const enc = encryptCred(secret);
  if (!enc.startsWith('enc:v1:') || decryptCred(enc) !== secret) {
    throw new Error('CAMERA_SECRET_KEY ไม่ได้ตั้งหรือใช้ไม่ได้ — ปฏิเสธการเก็บ secret แบบไม่เข้ารหัส');
  }
  return enc;
}

function validateSlug(slug) {
  if (!SLUG_RE.test(String(slug || ''))) {
    throw new Error('slug ต้องขึ้นต้นด้วย a-z แล้วตามด้วย a-z 0-9 _ ยาว 2–31 ตัว (จะกลายเป็นชื่อ database role)');
  }
  if (RESERVED.has(slug)) throw new Error(`slug "${slug}" สงวนไว้ ใช้ไม่ได้`);
}

/**
 * Create a partner: a Postgres role, and a row pointing at it.
 *
 * @param {object} client  a pg client ALREADY inside a transaction — the role
 *                         and the row must land together. A row pointing at a
 *                         role that does not exist authenticates fine and then
 *                         fails every query, which is the confusing way round.
 * @returns {{appKey, appSecret, expiresAt, dbRole}}  appSecret is plaintext and
 *          exists only in this return value; it is never stored or logged.
 */
async function createPartner(client, { slug, label, sites, days, createdBy, siteScope }) {
  validateSlug(slug);
  if (!String(label || '').trim()) throw new Error('ต้องระบุชื่อที่แสดง');
  const expiresAt = termDate(days);
  const dbRole = `${slug}_ro`;

  const { rows: dup } = await client.query('SELECT 1 FROM api_consumers WHERE slug = $1', [slug]);
  if (dup.length) throw new Error(`มี partner ชื่อ "${slug}" อยู่แล้ว`);

  // Reusing an existing role would silently inherit whatever grants it already
  // carries, which is not something an operator creating a new partner is
  // asking for. The CLI tolerated this because the person running it could see
  // the message; over HTTP it has to be an error.
  const { rows: role } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [dbRole]);
  if (role.length) throw new Error(`role ${dbRole} มีอยู่แล้วใน Postgres — ลบก่อนหรือใช้ slug อื่น`);

  await client.query(`CREATE ROLE ${dbRole} NOLOGIN`);
  // เริ่มที่ไม่มีสิทธิ์ข้อมูลเลย — แอดมินกำหนดชุดข้อมูลให้ตามความจำเป็นของ partner รายนั้น (ระยะ 2 ขั้น 0 · 2026-10-21)
  // เดิม GRANT third_party_readonly = SELECT ทั้ง view ทั้ง 11 ตัว ซึ่งครอบคลุมคอลัมน์ที่จะเพิ่มในอนาคตด้วย
  await client.query(`GRANT USAGE ON SCHEMA public TO ${dbRole}`);

  // A non-superuser can only SET ROLE to a role it belongs to. A superuser can
  // assume anything, and the grant would only accumulate memberships on it, one
  // per partner forever.
  const { rows: [me] } = await client.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
  if (!me.rolsuper) await client.query(`GRANT ${dbRole} TO CURRENT_USER`);

  const appKey = newKey();
  const appSecret = newSecret();

  await client.query(
    `INSERT INTO api_consumers
       (slug, label, app_key, app_secret_enc, db_role, site_codes, created_by, expires_at, max_lookback_days, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [slug, String(label).trim(), appKey, encryptSecret(appSecret), dbRole,
     sites && sites.length ? sites : null, createdBy || null, expiresAt,
     siteScope?.maxLookbackDays ?? null, siteScope?.notes ?? null]);

  return { appKey, appSecret, expiresAt, dbRole };
}

/**
 * New key and secret. The term is left alone unless days is supplied —
 * replacing a leaked secret should not quietly extend a contract.
 */
async function rotatePartner(client, slug, days) {
  const appKey = newKey();
  const appSecret = newSecret();
  const enc = encryptSecret(appSecret);
  const setExpiry = days !== undefined && days !== null && days !== '';
  const { rows } = await client.query(
    setExpiry
      ? `UPDATE api_consumers SET app_key=$1, app_secret_enc=$2, expires_at=$4 WHERE slug=$3 RETURNING expires_at`
      : `UPDATE api_consumers SET app_key=$1, app_secret_enc=$2 WHERE slug=$3 RETURNING expires_at`,
    setExpiry ? [appKey, enc, slug, termDate(days)] : [appKey, enc, slug]);
  if (!rows.length) throw new Error(`ไม่พบ partner "${slug}"`);
  return { appKey, appSecret, expiresAt: rows[0].expires_at };
}

/** New term counted from today, not stacked onto a date that may have passed. */
async function extendPartner(client, slug, days) {
  const expiresAt = termDate(days);
  if (!expiresAt) throw new Error('ต้องระบุระยะเวลา');
  const { rows } = await client.query(
    `UPDATE api_consumers SET expires_at=$1 WHERE slug=$2 RETURNING expires_at`, [expiresAt, slug]);
  if (!rows.length) throw new Error(`ไม่พบ partner "${slug}"`);
  return { expiresAt: rows[0].expires_at };
}

/**
 * Deactivate. The row and the role both stay: requests stop at authentication
 * immediately, which is the part that matters, and the row cannot be deleted
 * because api_request_log references it.
 */
async function revokePartner(client, slug, by) {
  const { rows } = await client.query(
    `UPDATE api_consumers SET active=FALSE, revoked_at=NOW(), revoked_by=$2
      WHERE slug=$1 AND active RETURNING db_role`, [slug, by || null]);
  if (!rows.length) throw new Error(`ไม่พบ partner "${slug}" ที่ยังใช้งานอยู่`);
  return { dbRole: rows[0].db_role };
}

/**
 * ลบถาวร — ย้อนทุกอย่างที่ createPartner สร้างไว้ แล้วเอาแถวออกจริง
 *
 * ต่างจาก revokePartner ตรงที่กู้คืนไม่ได้ จึงมีด่านกันไว้สามชั้น:
 *   1. ต้องถูก revoke มาก่อน (active = FALSE) — ทำให้ "เผลอลบ partner ที่ยังใช้งาน
 *      อยู่" เป็นไปไม่ได้เลย ไม่ใช่แค่ยากขึ้น · ถ้าลบผิดตอนที่ยัง active อีกฝั่งจะ
 *      ขาดการเชื่อมต่อทันทีโดยไม่มีใครรู้ตัว ส่วน revoke ยังกดคืนได้ด้วย reactivate
 *   2. ผู้เรียกต้องส่งคำยืนยันที่พิมพ์เองมาด้วย (ตรวจที่ฝั่ง route)
 *   3. ทุกขั้นอยู่ใน transaction เดียว — ล้มกลางทางแล้วไม่เหลือของครึ่ง ๆ เช่น
 *      role หายแต่แถวยังอยู่ (แถวนั้นจะกลายเป็น partner ที่แก้สิทธิ์ไม่ได้ตลอดไป)
 *
 * สิ่งที่ยังอยู่หลังลบ: แถว audit (`integration_deleted` เก็บ slug/label/app_key/
 * db_role ไว้) และแถวใน api_request_log ซึ่งถูกตัด consumer_id เป็น NULL แต่ยังคง
 * app_key ไว้ ⇒ ยังสืบย้อนได้ว่าใครเรียกอะไรไปบ้าง
 */
async function deletePartner(client, slug, actor = {}) {
  const { rows } = await client.query(
    `SELECT id, slug, label, app_key, db_role, active
       FROM api_consumers WHERE slug = $1 FOR UPDATE`, [slug]);
  if (!rows.length) throw new Error(`ไม่พบ partner "${slug}"`);
  const c = rows[0];
  if (c.active) throw new Error(`partner "${slug}" ยังใช้งานอยู่ — ต้องถอนสิทธิ์ (revoke) ก่อนจึงจะลบถาวรได้`);

  // ชื่อ role ใส่ลง DDL ตรง ๆ ไม่ได้ (identifier parameterise ไม่ได้) — ด่านเดียว
  // ที่กั้นอยู่คือ regex นี้ เหมือนที่ createPartner และหน้าแก้สิทธิ์ทำ ต้องอยู่
  // **ก่อน** DDL คำสั่งแรก ไม่ใช่หลัง
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(c.db_role)) {
    throw new Error(`ชื่อ role "${c.db_role}" ผิดรูป — ลบไม่ได้ ต้องแก้ด้วยมือ`);
  }
  if (RESERVED.has(c.db_role)) {
    throw new Error(`role "${c.db_role}" เป็น role ของระบบ — ปฏิเสธการลบ`);
  }

  let roleDropped = false;
  const { rows: exists } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [c.db_role]);
  if (exists.length) {
    // ถอนสิทธิ์ให้หมดก่อน ไม่งั้น DROP ROLE จะฟ้อง "cannot be dropped because
    // some objects depend on it" · ไม่ไล่จากลิสต์ view ที่เขียนไว้ตายตัว เพราะลิสต์
    // ดริฟต์ได้ — ถามจากสิ่งที่ role นั้นถืออยู่จริง ครอบคลุมทั้ง grant ระดับตาราง
    // และระดับคอลัมน์ (REVOKE ALL ON <table> เก็บทั้งสองแบบ)
    const { rows: held } = await client.query(
      `SELECT DISTINCT table_schema AS s, table_name AS t
         FROM information_schema.role_table_grants WHERE grantee = $1
        UNION
       SELECT DISTINCT table_schema, table_name
         FROM information_schema.column_privileges WHERE grantee = $1`, [c.db_role]);
    for (const g of held) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(g.s) || !/^[a-z_][a-z0-9_]*$/i.test(g.t)) continue;
      await client.query(`REVOKE ALL ON "${g.s}"."${g.t}" FROM ${c.db_role}`);
    }
    await client.query(`REVOKE ALL ON SCHEMA public FROM ${c.db_role}`);
    // ย้อน GRANT third_party_readonly ที่ createPartner ให้ไว้
    await client.query(`REVOKE third_party_readonly FROM ${c.db_role}`);
    await client.query(`DROP ROLE ${c.db_role}`);
    roleDropped = true;
  }

  // api_request_log.consumer_id เป็น FK แบบ NO ACTION — ลบแถว consumer ทั้งที่ยัง
  // มี log ชี้อยู่จะล้ม · ตัดการอ้างอิงแทนการลบ log ทิ้ง เพราะ app_key ยังอยู่ใน
  // แถวนั้น ประวัติการเรียกจึงยังสืบย้อนได้ (ลบ log = ทำลายหลักฐานโดยไม่จำเป็น)
  const { rowCount: logRows } = await client.query(
    'UPDATE api_request_log SET consumer_id = NULL WHERE consumer_id = $1', [c.id]);

  await client.query('DELETE FROM api_consumers WHERE id = $1', [c.id]);

  // 🔴 แถว audit ต้องเขียน **ในทรานแซกชันเดียวกับการลบ** ไม่ใช่หลัง COMMIT
  //
  // ของเดิม route เรียก audit() หลัง COMMIT และ auth.logAudit() เป็น
  // `catch { /* ignore */ }` ⇒ ถ้าการเขียน audit ล้ม การลบก็ commit ไปแล้ว
  // เหลือ partner ที่หายไปโดยไม่มีร่องรอยว่าใครลบ เมื่อไหร่ คีย์อะไร
  // ซึ่งสำหรับ hard delete แถวนี้คือ **หลักฐานชิ้นเดียวที่เหลือ**
  //
  // พอย้ายมาอยู่ตรงนี้ ได้คุณสมบัติ "ไม่มี audit = ไม่มีการลบ" และผู้เรียกทั้งสอง
  // ทาง (console กับ CLI) ได้หลักประกันเดียวกันโดยไม่ต้องจำว่าต้องเขียนเอง
  await client.query(
    `INSERT INTO audit_log (user_id, username, action, ip_address, user_agent, details)
     VALUES ($1, $2, 'integration_deleted', $3, $4, $5::jsonb)`,
    [actor.userId ?? null, actor.username || 'unknown', actor.ip || null, actor.userAgent || null,
     JSON.stringify({
       consumer: c.slug, label: c.label, appKey: c.app_key,
       dbRole: c.db_role, roleDropped, logRowsDetached: logRows,
     })]);

  return { slug: c.slug, label: c.label, appKey: c.app_key, dbRole: c.db_role, roleDropped, logRows };
}

/** Re-enable a revoked partner. Its key and grants are untouched. */
async function reactivatePartner(client, slug) {
  const { rows } = await client.query(
    `UPDATE api_consumers SET active=TRUE, revoked_at=NULL, revoked_by=NULL
      WHERE slug=$1 AND NOT active RETURNING db_role`, [slug]);
  if (!rows.length) throw new Error(`ไม่พบ partner "${slug}" ที่ถูกถอนไว้`);
  return { dbRole: rows[0].db_role };
}

/** Fields an operator may change after creation. Identity and grants are not among them. */
async function updatePartner(client, slug, patch) {
  const sets = [], args = [];
  const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };

  if (patch.label !== undefined) {
    if (!String(patch.label).trim()) throw new Error('ชื่อที่แสดงว่างไม่ได้');
    put('label', String(patch.label).trim());
  }
  if (patch.siteCodes !== undefined) {
    const s = patch.siteCodes;
    if (s !== null && !Array.isArray(s)) throw new Error('ขอบเขตไซต์ต้องเป็นรายการ');
    // An empty array means "no sites", which allowedCameraIds() resolves to no
    // cameras. NULL is what "all sites" is spelled as. Collapsing one into the
    // other here would silently widen or narrow the scope.
    put('site_codes', s === null || s.length === 0 ? (s === null ? null : []) : s);
  }
  if (patch.ratePerMin !== undefined) {
    const n = Number(patch.ratePerMin);
    if (!Number.isInteger(n) || n < 1 || n > 6000) throw new Error('โควตาต้องเป็นจำนวนเต็ม 1–6000 ต่อนาที');
    put('rate_per_min', n);
  }
  if (patch.maxLookbackDays !== undefined) {
    const v = patch.maxLookbackDays;
    if (v === null || v === '') put('max_lookback_days', null);
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 3650) throw new Error('จำนวนวันย้อนหลังต้องเป็น 1–3650 (หรือเว้นว่าง)');
      put('max_lookback_days', n);
    }
  }
  if (patch.notes !== undefined) put('notes', String(patch.notes || '').slice(0, 2000) || null);

  if (!sets.length) throw new Error('ไม่มีอะไรให้แก้');
  args.push(slug);
  const { rows } = await client.query(
    `UPDATE api_consumers SET ${sets.join(', ')} WHERE slug = $${args.length} RETURNING slug`, args);
  if (!rows.length) throw new Error(`ไม่พบ partner "${slug}"`);
  return { changed: sets.length };
}

/** The stored secret, decrypted. Callers MUST audit every use. */
async function revealSecret(client, slug) {
  const { rows } = await client.query(
    'SELECT app_key, app_secret_enc FROM api_consumers WHERE slug = $1', [slug]);
  if (!rows.length) throw new Error(`ไม่พบ partner "${slug}"`);
  const secret = decryptCred(rows[0].app_secret_enc);
  // Still ciphertext means CAMERA_SECRET_KEY is missing or wrong. Saying so
  // beats handing back a string that looks like a secret and is not.
  if (!secret || secret.startsWith('enc:v1:')) {
    throw new Error('ถอดรหัส secret ไม่ได้ — ตรวจ CAMERA_SECRET_KEY');
  }
  return { appKey: rows[0].app_key, appSecret: secret };
}

module.exports = {
  createPartner, rotatePartner, extendPartner, revokePartner, reactivatePartner, deletePartner,
  updatePartner, revealSecret,
  termDate, validateSlug, encryptSecret, newKey, newSecret,
  SLUG_RE, TERMS, RESERVED,
};

if (require.main === module) {
  const assert = require('assert');

  for (const bad of ['', 'A', '1abc', 'ab-cd', 'a', 'x'.repeat(32), 'has space', 'postgres', 'vigil_sql']) {
    assert.throws(() => validateSlug(bad), `slug "${bad}" ควรถูกปฏิเสธ`);
  }
  for (const ok of ['ab', 'cib', 'partner_a', 'x9', 'a'.repeat(31)]) {
    assert.doesNotThrow(() => validateSlug(ok), `slug "${ok}" ควรผ่าน`);
  }

  assert.strictEqual(termDate(undefined), null);
  assert.strictEqual(termDate(''), null);
  assert.throws(() => termDate(45), /30 \/ 60/);
  assert.throws(() => termDate('abc'));
  const d = termDate(30);
  const days = Math.round((d - Date.now()) / 86400000);
  assert.strictEqual(days, 30, 'termDate(30) ควรได้ 30 วันจากนี้');

  // Keys are prefixed and unique; secrets are URL-safe and long enough to be
  // worth the HMAC around them.
  assert.ok(newKey().startsWith('vk_'));
  assert.notStrictEqual(newKey(), newKey());
  assert.ok(newSecret().length >= 40 && /^[A-Za-z0-9_-]+$/.test(newSecret()));
  assert.notStrictEqual(newSecret(), newSecret());

  console.log('partnerAdmin self-check: all assertions passed');
}
