// ============================================================
// Vigil Platform — รัน query ในนามสิทธิ์ของ partner (partner-api ทุก endpoint + หน้า preview ของแอดมิน)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ทางเดียวที่ partner เข้าถึงฐานข้อมูล — partner-api.partnerQuery() กับ preview ใช้ตัวนี้ตัวเดียว (รวมสำเนา 2026-10-22) · GOTCHAS #145:
//   - ต้อง BEGIN ก่อน ไม่งั้น SET LOCAL ROLE เงียบ ๆ ไม่มีผล แล้ว query รันเป็น superuser อ่านได้ทุกอย่าง
//   - ใช้ SET LOCAL (ไม่ใช่ SET) กันสิทธิ์ค้างไปกับ connection ที่คืน pool
//   - ตรวจ current_user ซ้ำ ถ้าไม่ใช่ role ของ partner ต้องล้มเสียงดัง
//   - ชื่อ role ถูกต่อเข้า SQL ตรง ๆ (SET ROLE รับ identifier ไม่ใช่ parameter) จึงตรวจรูปแบบก่อน
// ============================================================
'use strict';

const ROLE_RE = /^[a-z][a-z0-9_]{2,62}$/;

async function asPartnerRole(pool, dbRole, sql, params = []) {
  if (!ROLE_RE.test(String(dbRole || ''))) throw new Error(`refusing to assume malformed role: ${dbRole}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '5s'`);   // เพดานเดียวกับ partner-api
    await client.query(`SET LOCAL ROLE ${dbRole}`);
    const { rows: [who] } = await client.query('SELECT current_user AS u');
    if (who.u !== dbRole) throw new Error(`role not assumed: got ${who.u}, expected ${dbRole}`);
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { asPartnerRole, ROLE_RE };
