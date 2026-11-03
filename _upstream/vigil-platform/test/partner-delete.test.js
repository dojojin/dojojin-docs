// ============================================================
// Vigil Platform — test: ลบ partner ถาวร
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เส้นทางนี้กู้คืนไม่ได้ และรัน DDL (DROP ROLE) จากชื่อที่ต่อเข้า SQL ตรง ๆ
// เทสต์นี้เลยเน้นสองอย่าง: ด่านกันพลาดต้องยังอยู่ครบ และลำดับการถอนสิทธิ์ต้องมาก่อน
// DROP ROLE เสมอ · ไม่ต่อ DB จริง — ใช้ fake client บันทึกคำสั่งที่ส่งออกไป
// (ตัวที่พิสูจน์กับ Postgres จริงคือ repro ตอนแก้ ซึ่งรวมเคส column-level grant)
// ============================================================
'use strict';

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const PA     = require(path.join(__dirname, '..', 'src', 'helpers', 'partnerAdmin'));

const ROUTES_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'integrations.js'), 'utf8');

// fake client: ตอบตามลำดับที่กำหนด และเก็บทุก SQL ที่ถูกยิงไว้ตรวจลำดับ
function fakeClient(rowsFor) {
  const sql = [];
  return {
    sql,
    query: async (q, params) => {
      sql.push(q.replace(/\s+/g, ' ').trim());
      for (const [re, res] of rowsFor) if (re.test(q)) return res(params);
      return { rows: [], rowCount: 0 };
    },
  };
}

const consumerRow = (over = {}) => ({
  id: 99, slug: 'acme', label: 'ACME', app_key: 'vk_dead', db_role: 'acme_ro', active: false, ...over,
});

const baseRows = (over = {}) => [
  [/FROM api_consumers WHERE slug/, () => ({ rows: [consumerRow(over)] })],
  [/FROM pg_roles WHERE rolname/,  () => ({ rows: [{ ok: 1 }] })],
  [/role_table_grants/,            () => ({ rows: [{ s: 'public', t: 'v_lpr_events_public' }] })],
  [/UPDATE api_request_log/,       () => ({ rows: [], rowCount: 4 })],
];

(async () => {
  // ── 1. ต้อง revoke ก่อนถึงลบได้ — กันลบ partner ที่ยังวิ่งอยู่โดยไม่ตั้งใจ ──
  {
    const c = fakeClient(baseRows({ active: true }));
    await assert.rejects(() => PA.deletePartner(c, 'acme'), /ยังใช้งานอยู่/);
    assert.ok(!c.sql.some((s) => /DROP ROLE|DELETE FROM api_consumers/.test(s)),
      'ถูกปฏิเสธแล้วต้องไม่มีคำสั่งทำลายใด ๆ หลุดออกไป');
  }

  // ── 2. ไม่มีแถว = error ไม่ใช่เงียบ ๆ สำเร็จ ────────────────────────────────
  await assert.rejects(
    () => PA.deletePartner(fakeClient([[/FROM api_consumers WHERE slug/, () => ({ rows: [] })]]), 'ghost'),
    /ไม่พบ partner/);

  // ── 3. ชื่อ role ผิดรูป = ปฏิเสธ **ก่อน** ยิง DDL ตัวแรก ────────────────────
  // identifier ใส่ parameter ไม่ได้ regex นี้คือด่านเดียวที่กั้น SQL injection อยู่
  for (const bad of ['acme_ro; DROP TABLE events', 'Acme_RO', 'a', '1acme', '']) {
    const c = fakeClient(baseRows({ db_role: bad }));
    await assert.rejects(() => PA.deletePartner(c, 'acme'), /ผิดรูป|ปฏิเสธ/,
      `db_role ${JSON.stringify(bad)} ต้องถูกปฏิเสธ`);
    assert.ok(!c.sql.some((s) => /DROP ROLE|REVOKE/.test(s)),
      `db_role ${JSON.stringify(bad)}: ห้ามมี DDL หลุดออกไปก่อนตรวจ`);
  }

  // ── 4. role ของระบบ = ปฏิเสธ ────────────────────────────────────────────────
  for (const sys of ['postgres', 'vigil_sql', 'third_party_readonly']) {
    await assert.rejects(() => PA.deletePartner(fakeClient(baseRows({ db_role: sys })), 'acme'),
      /role ของระบบ/, `${sys} ต้องลบไม่ได้`);
  }

  // ── 5. ทางปกติ: ต้องถอนสิทธิ์ให้หมดก่อน DROP ROLE ──────────────────────────
  // สลับลำดับเมื่อไร DROP ROLE จะล้มด้วย "cannot be dropped because some objects
  // depend on it" ซึ่งกลางคันแบบนั้นแปลว่า transaction ย้อนกลับทั้งก้อน
  {
    const c = fakeClient(baseRows());
    const out = await PA.deletePartner(c, 'acme');
    const at = (re) => c.sql.findIndex((s) => re.test(s));
    assert.ok(at(/REVOKE ALL ON "public"."v_lpr_events_public"/) > -1, 'ต้องถอนสิทธิ์ระดับ view');
    assert.ok(at(/REVOKE third_party_readonly/) > -1, 'ต้องย้อน GRANT ที่ createPartner ให้ไว้');
    assert.ok(at(/DROP ROLE acme_ro/) > -1, 'ต้อง DROP ROLE');
    assert.ok(at(/REVOKE ALL ON "public"/) < at(/DROP ROLE/), 'REVOKE view ต้องมาก่อน DROP ROLE');
    assert.ok(at(/REVOKE third_party_readonly/) < at(/DROP ROLE/), 'REVOKE role ต้องมาก่อน DROP ROLE');

    // ── 6. log ต้องถูก "ตัดการเชื่อมโยง" ไม่ใช่ถูกลบ ────────────────────────
    // app_key ยังอยู่ในแถวนั้น ⇒ สืบย้อนได้ว่าคีย์ไหนเคยเรียกอะไร · ลบ log =
    // ทำลายหลักฐานทั้งที่ FK แค่ต้องการให้เลิกชี้เท่านั้น
    assert.ok(c.sql.some((s) => /UPDATE api_request_log SET consumer_id = NULL/.test(s)),
      'ต้องตัด consumer_id เป็น NULL');
    assert.ok(!c.sql.some((s) => /DELETE FROM api_request_log/.test(s)),
      'ห้ามลบประวัติการเรียก API');
    assert.ok(at(/UPDATE api_request_log/) < at(/DELETE FROM api_consumers/),
      'ต้องตัด FK ก่อนลบแถว ไม่งั้น DELETE ล้มด้วย FK violation');

    // ── 7. ต้องคืนของที่ audit ต้องใช้ ───────────────────────────────────────
    assert.deepStrictEqual(
      { slug: out.slug, appKey: out.appKey, dbRole: out.dbRole, roleDropped: out.roleDropped, logRows: out.logRows },
      { slug: 'acme', appKey: 'vk_dead', dbRole: 'acme_ro', roleDropped: true, logRows: 4 });
  }

  // ── 8. role ไม่มีอยู่แล้ว → ลบแถวต่อได้ ไม่ใช่ค้างตลอดไป ────────────────────
  {
    const rows = baseRows().map(([re, fn]) => [re, /pg_roles/.test(re.source) ? () => ({ rows: [] }) : fn]);
    const c = fakeClient(rows);
    const out = await PA.deletePartner(c, 'acme');
    assert.strictEqual(out.roleDropped, false);
    assert.ok(!c.sql.some((s) => /DROP ROLE/.test(s)), 'ไม่มี role ก็ไม่ต้องสั่ง DROP');
    assert.ok(c.sql.some((s) => /DELETE FROM api_consumers/.test(s)), 'แถวยังต้องถูกลบ');
  }

  // ── 9. route ต้องตรวจคำยืนยันเองที่ฝั่ง server ──────────────────────────────
  // ถ้าตรวจแค่ในเบราว์เซอร์ ใครยิง curl ตรงก็ลบได้ทันที = ด่านที่เจ้าของสั่งให้มี
  // หายไปทั้งอัน
  assert.ok(/app\.delete\('\/api\/integrations\/:slug', auth\.requireAdmin/.test(ROUTES_SRC),
    'ต้องเป็น DELETE + requireAdmin');
  assert.ok(/req\.body\?\.confirm/.test(ROUTES_SRC) && /DELETE_WORD/.test(ROUTES_SRC),
    'route ต้องตรวจ confirm จาก body เอง');
  assert.ok(/const DELETE_WORD = 'Confirm'/.test(ROUTES_SRC),
    "คำยืนยันต้องเป็น 'Confirm' ให้ตรงกับที่หน้าจอบอกให้พิมพ์");

  // ── 11. audit ต้องเขียนในทรานแซกชันเดียวกับการลบ ────────────────────────────
  // ของเดิม route เขียนหลัง COMMIT ผ่าน auth.logAudit() ซึ่งเป็น catch{ignore}
  // ⇒ audit ล้มเงียบได้ทั้งที่การลบ commit ไปแล้ว เหลือ partner ที่หายไปโดยไม่มี
  // ร่องรอยว่าใครลบ · สำหรับ hard delete แถวนั้นคือหลักฐานชิ้นเดียวที่เหลือ
{
  const c = fakeClient(baseRows());
  await PA.deletePartner(c, 'acme', { username: 'someone', ip: '1.2.3.4' });
  const at = (re) => c.sql.findIndex((s) => re.test(s));
  assert.ok(at(/INSERT INTO audit_log/) > -1, 'deletePartner ต้องเขียน audit เอง');
  assert.ok(at(/INSERT INTO audit_log/) > at(/DELETE FROM api_consumers/),
    'audit ต้องเขียนหลังลบสำเร็จ แต่ยังอยู่ในทรานแซกชันเดียวกัน');
  const payload = c.sql.find((s) => /INSERT INTO audit_log/.test(s));
  assert.ok(/integration_deleted/.test(payload), 'ต้องบันทึก action ให้ถูก');
  // สิ่งที่หายไปพร้อมแถวต้องอยู่ในนี้ครบ — หลังลบแล้วไม่มีที่อื่นให้ดูอีก
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'helpers', 'partnerAdmin.js'), 'utf8');
  const ins = src.slice(src.indexOf('INSERT INTO audit_log'));
  for (const f of ['appKey', 'dbRole', 'label', 'consumer']) {
    assert.ok(ins.slice(0, 700).includes(f), `audit ต้องเก็บ ${f}`);
  }
}

  // ── 12. route ต้องเลิกเขียน audit หลัง COMMIT ───────────────────────────────
{
  const del = ROUTES_SRC.slice(ROUTES_SRC.indexOf("app.delete('/api/integrations/:slug'"));
  const body = del.slice(0, del.indexOf('\n  app.'));
  const code = body.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/await audit\(req, 'integration_deleted'/.test(code),
    'route ต้องไม่เขียน audit หลัง COMMIT อีก — ย้ายเข้าไปใน deletePartner แล้ว');
  assert.ok(/username: req\.user\?\.username/.test(code),
    'route ต้องส่งตัวตนผู้ลบเข้าไปให้ deletePartner บันทึก');
}

  // ── 13. CLI ต้องมีคำสั่ง delete และไม่มีทางลัดข้ามการยืนยัน ─────────────────
{
  const CLI = fs.readFileSync(path.join(__dirname, '..', 'src', 'partner-admin.js'), 'utf8');
  const code = CLI.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  assert.ok(/cmd === 'delete'/.test(code), 'CLI ต้องรับคำสั่ง delete');
  assert.ok(/String\(typed\)\.trim\(\) !== slug/.test(code),
    'CLI ต้องบังคับให้พิมพ์ slug ให้ตรง');
  assert.ok(/process\.stdin\.isTTY/.test(code),
    'ไม่ใช่ TTY ต้องบังคับ --confirm ไม่ใช่ปล่อยผ่าน');
  assert.ok(!/--yes|--force/.test(code), 'ห้ามมีธงข้ามการยืนยัน');
  // ข้อความของ revoke ต้องไม่แนะนำ DROP ROLE มือเปล่าอีก — role ยังถือ grant อยู่
  // จะล้มด้วย "cannot be dropped because some objects depend on it"
  assert.ok(!/DROP ROLE it once you are sure/.test(code),
    'ข้อความ revoke ยังแนะนำ DROP ROLE เอง ซึ่งจะล้มจริง');
}

console.log('✅ partner delete: ผ่าน 13 ข้อ');
})().catch((e) => { console.error('🔴', e.message); process.exit(1); });
