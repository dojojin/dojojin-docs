// ============================================================
// Vigil Platform — 3rd Party Integration console API (Phase TP4)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Answers the question nobody could answer before this existed: which partner
// can see which column, right now. Everything here is read from Postgres
// catalogues at request time rather than from a record of what we intended, so
// it cannot drift from reality the way a spreadsheet of grants would.
//
// Mounted under /api, so the session auth and the admin write-gate in
// api-server.js apply. That is the opposite of routes/partner-api.js and
// deliberately so: this is the operator's view of partners, not a partner's
// view of us.
// ============================================================
'use strict';

const PA = require('../helpers/partnerAdmin');

// The views a partner can be granted. Listed rather than discovered by name
// pattern for the same reason migration 118 lists them: a future migration that
// happens to create something matching v_%_public should not silently appear in
// an operator's grant editor as though it were meant to be shared.
const EXPOSED_VIEWS = [
  'v_cameras_public',
  'v_license_plates_public',
  'v_appearances_public',
  'v_events_public',
  'v_camera_groups_public',
  'v_event_categories_public',
  'v_event_category_rules_public',
  'v_alert_rules_public',
  'v_alert_logs_public',
  'v_system_settings_public',
  'v_report_history_public',
  // สถิติ (S1 · migration 270)
  'v_vehicle_stats_hourly_public',
  'v_lpr_stats_hourly_public',
  'v_lpr_stats_daily_public',
  'v_person_stats_daily_public',   // migration 276
  // Traffic Enforcement (S2 · migration 271)
  'v_enforcement_hourly_public',
  'v_enforcement_cameras_public',
  'v_enforcement_daily_public',   // migration 275
];

module.exports = (app, pool, { auth, getIP }) => {
  // GET /api/integrations — consumers, their scope, and what they can read.
  app.get('/api/integrations', auth.requireAdmin, async (req, res) => {
    try {
      const { rows: consumers } = await pool.query(
        `SELECT id, slug, label, app_key, db_role, active, rate_per_min,
                site_codes, max_lookback_days, notes, expires_at,
                created_at, created_by, revoked_at, revoked_by, last_seen_at
           FROM api_consumers ORDER BY active DESC, id`);

      // Every column of every exposed view, with whether each consumer's role
      // can read it. has_column_privilege(), not column_privileges: the latter
      // reports only grants made directly to a role, so a consumer that
      // inherits third_party_readonly — which is all of them by default —
      // would show as having access to nothing. Verified: 0 vs 14 of 14.
      const { rows: cols } = await pool.query(
        `SELECT table_name, column_name, data_type, ordinal_position
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ANY($1)
          ORDER BY table_name, ordinal_position`, [EXPOSED_VIEWS]);

      // has_column_privilege() raises if the role does not exist, which takes
      // the whole page down over one revoked consumer. And revoked consumers
      // with dropped roles are a normal state: partner-admin deactivates the
      // row and tells the operator to DROP ROLE when convenient, while the row
      // itself must stay because api_request_log references it.
      //
      // A missing role is worth showing rather than hiding — it is exactly the
      // condition migration 118 existed to repair, and there was no way to see
      // it before this page.
      const { rows: liveRoles } = await pool.query(
        `SELECT rolname FROM pg_roles WHERE rolname = ANY($1)`,
        [consumers.map((c) => c.db_role)]);
      const roleExists = new Set(liveRoles.map((r) => r.rolname));

      for (const c of consumers) {
        c.roleExists = roleExists.has(c.db_role);
        if (!c.roleExists) { c.grants = {}; c.grantedCount = 0; continue; }
        // One query per consumer, not one per column: eleven views of roughly
        // fifteen columns each is 165 round trips a consumer if the privilege
        // check is done in a loop. Postgres evaluates the function per row
        // just as happily inside the scan.
        const { rows: g } = await pool.query(
          `SELECT table_name, column_name,
                  has_column_privilege($1, quote_ident(table_name), column_name, 'SELECT') AS ok
             FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ANY($2)`,
          [c.db_role, EXPOSED_VIEWS]);
        const grants = {};
        for (const r of g) (grants[r.table_name] ||= {})[r.column_name] = r.ok;
        c.grants = grants;
        // Cheap enough to compute here and saves every caller doing it.
        c.grantedCount = Object.values(grants)
          .reduce((n, v) => n + Object.values(v).filter(Boolean).length, 0);
      }

      // Recent traffic, so an operator can tell a partner that is integrating
      // from one that was provisioned and forgotten.
      const { rows: usage } = await pool.query(
        `SELECT consumer_id,
                count(*) FILTER (WHERE status < 400) AS ok_count,
                count(*) FILTER (WHERE status >= 400) AS err_count,
                max(at) AS last_at,
                round(avg(duration_ms) FILTER (WHERE status < 400)) AS avg_ms
           FROM api_request_log
          WHERE at > NOW() - INTERVAL '7 days' AND consumer_id IS NOT NULL
          GROUP BY consumer_id`);
      const byId = Object.fromEntries(usage.map((u) => [u.consumer_id, u]));
      for (const c of consumers) c.usage = byId[c.id] || null;

      // Rejected calls with no consumer attached — someone using a key we do
      // not know. Worth surfacing: it is the only signal that anyone is
      // probing, and it appears nowhere else.
      const { rows: [unknown] } = await pool.query(
        `SELECT count(*) AS n, count(DISTINCT app_key) AS keys, max(at) AS last_at
           FROM api_request_log
          WHERE at > NOW() - INTERVAL '7 days' AND consumer_id IS NULL AND status >= 400`);

      const columns = {};
      for (const col of cols) {
        (columns[col.table_name] ||= []).push({ name: col.column_name, type: col.data_type });
      }

      // Site codes come from the database rather than a list in the frontend —
      // a site added later should appear in the scope picker without a deploy.
      const { rows: siteRows } = await pool.query(
        'SELECT code FROM sites WHERE code IS NOT NULL ORDER BY code');

      // Endpoint mapping: which endpoints use which view and columns.
      // The frontend needs this to know which endpoints are affected when a
      // column is unchecked, so it can warn with real call counts.
      const { ENDPOINTS } = require('../helpers/partnerSchema');
      const endpoints = ENDPOINTS.map((e) => ({
        path: e.path,
        view: e.view,
        columns: e.columns,
        // ฟิลด์ที่ขาดไม่ได้ (ขาด = 403 ทั้ง endpoint) — หน้าจอเตือนก่อนถอนเฉพาะตัวเหล่านี้ (ฟิลด์อื่นแค่หายจากแถว ตั้งแต่ระยะ 2 ขั้น 1)
        required: e.requiredColumns,
      }));

      // % แถวที่มีค่าจริงต่อฟิลด์ — จาก pg_stats (สถิติของ ANALYZE ไม่ต้องนับทั้งตาราง) ผ่านการจับคู่ view→ตารางจริง
      // เฉพาะคอลัมน์ที่ view ไม่ได้เปลี่ยนชื่อ (ชื่อในตารางจริงตรงกับชื่อใน view) · ไม่มีสถิติ = ไม่แสดง ดีกว่าเดา
      // partition parent มีสถิติแบบ inherited เท่านั้น จึงเลือกแถว inherited ก่อน
      const { rows: fillRows } = await pool.query(
        `SELECT DISTINCT ON (u.view_name, u.column_name) u.view_name, u.column_name,
                round(100 * (1 - s.null_frac))::int AS fill
           FROM information_schema.view_column_usage u
           JOIN information_schema.columns vc
             ON vc.table_schema = 'public' AND vc.table_name = u.view_name AND vc.column_name = u.column_name
           JOIN pg_stats s ON s.schemaname = u.table_schema AND s.tablename = u.table_name AND s.attname = u.column_name
          WHERE u.view_schema = 'public' AND u.view_name = ANY($1)
          ORDER BY u.view_name, u.column_name, s.inherited DESC`, [EXPOSED_VIEWS]).catch(() => ({ rows: [] }));
      const fill = {};
      for (const r of fillRows) (fill[r.view_name] ||= {})[r.column_name] = r.fill;

      res.json({ consumers, columns, views: EXPOSED_VIEWS, endpoints, fill,
        sites: siteRows.map((r) => r.code), unknownKeyAttempts: unknown });
    } catch (e) {
      console.error('[integrations] list failed:', e.message);
      res.status(500).json({ error: 'ไม่สามารถอ่านข้อมูล integration ได้' });
    }
  });

  // GET /api/integrations/:slug/openapi — the exact document that consumer
  // would receive. Rendered here so an operator can read what a partner sees
  // without holding the partner's credentials, which is the only other way to
  // fetch it.
  app.get('/api/integrations/:slug/openapi', auth.requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const { rows: [c] } = await client.query(
        `SELECT * FROM api_consumers WHERE slug = $1`, [req.params.slug]);
      if (!c) return res.status(404).json({ error: 'ไม่พบ consumer นี้' });
      const { buildSpec } = require('../openapi-gen');
      const origin = process.env.PUBLIC_ORIGIN || `https://${req.headers.host}`;
      res.json(await buildSpec(client, c, origin));
    } catch (e) {
      console.error('[integrations] openapi failed:', e.message);
      res.status(500).json({ error: 'สร้าง OpenAPI ไม่สำเร็จ' });
    } finally {
      client.release();
    }
  });

  // GET /api/integrations/:slug/preview — "สิ่งที่ partner รายนี้ได้รับจริง" ต่อ endpoint
  // รันในนามสิทธิ์ของ partner เอง (helpers/asPartnerRole.js) จึงเป็นผลเดียวกับที่ partner จะได้ ไม่ใช่การเดาจากตาราง
  // endpoint ส่งเฉพาะคอลัมน์ที่ถือสิทธิ์ (resolveColumns เดียวกับ partner-api) · ฟิลด์ที่ขาด = dropped ·
  //    ขาดคอลัมน์บังคับ (id/เวลา/camera_id) = partner ได้ 403 ทั้ง endpoint → รายงานเป็น forbidden
  // แถวล่าสุด 1 แถวใน 1 ชม. ต่อ query · กรองไซต์แบบเดียวกับ allowedCameraIds() ของ partner-api
  app.get('/api/integrations/:slug/preview', auth.requireAdmin, async (req, res) => {
    try {
      const { rows: [c] } = await pool.query(
        `SELECT slug, db_role, site_codes FROM api_consumers WHERE slug = $1`, [req.params.slug]);
      if (!c) return res.status(404).json({ error: 'ไม่พบ consumer นี้' });
      const { rows: [role] } = await pool.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [c.db_role]);
      const { ENDPOINTS, resolveColumns } = require('../helpers/partnerSchema');
      if (!role) return res.json({ endpoints: ENDPOINTS.map((e) => ({ path: e.path, status: 'no-role' })) });

      let allowed = null;
      if (c.site_codes !== null && c.site_codes !== undefined) {
        allowed = !c.site_codes.length ? [] : (await pool.query(
          `SELECT c.id FROM cameras c JOIN sites s ON s.id = c.site_id WHERE s.code = ANY($1)`,
          [c.site_codes])).rows.map((r) => r.id);
      }
      const { asPartnerRole } = require('../helpers/asPartnerRole');
      const memo = new Map();                       // /v1/lpr/search ใช้ view+คอลัมน์ชุดเดียวกับ /v1/lpr/events
      const out = [];
      for (const e of ENDPOINTS) {
        const key = `${e.view}|${e.columns.join(',')}|${(e.requiredColumns || []).join(',')}`;
        if (!memo.has(key)) {
          memo.set(key, (async () => {
            const { rows: priv } = await pool.query(
              `SELECT column_name FROM unnest($3::text[]) AS column_name
                WHERE NOT has_column_privilege($1, $2, column_name, 'SELECT')`, [c.db_role, e.view, e.columns]);
            const lost = new Set(priv.map((r) => r.column_name));
            const rc = resolveColumns(e, e.columns.filter((x) => !lost.has(x)));
            if (rc.missingRequired.length) return { status: 'forbidden', missing: rc.missingRequired };
            const dropped = rc.dropped;
            if (Array.isArray(allowed) && !allowed.length) return { status: 'no-scope' };
            const where = [], args = [];
            // สถิติรายวัน (S1) ใช้วันตามเวลาไทย · แถวสรุปไม่มี id ใช้ keyColumn (camera_id) แทน
            if (e.timeColumn) where.push(e.timeType === 'date' ? `${e.timeColumn} >= current_date - 1` : `${e.timeColumn} >= now() - interval '1 hour'`);
            const key = e.keyColumn || 'id';
            if (allowed) { args.push(allowed); where.push(`${e.timeColumn || key !== 'id' ? 'camera_id' : 'id'} = ANY($${args.length})`); }
            const order = e.timeColumn ? `${e.timeColumn} DESC, ${key} DESC` : key;
            try {
              const { rows } = await asPartnerRole(pool, c.db_role,
                `SELECT ${rc.cols.join(', ')} FROM ${e.view}
                  ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 1`, args);
              return rows[0] ? { status: 'ok', row: rows[0], dropped } : { status: 'empty', dropped };
            } catch (err) {
              if (err.code === '42501') return { status: 'forbidden', missing: [] };
              if (err.code === '57014') return { status: 'slow' };
              throw err;
            }
          })());
        }
        out.push({ path: e.path, method: e.method, view: e.view, columns: e.columns, ...(await memo.get(key)) });
      }
      res.json({ endpoints: out, scoped: allowed !== null });
    } catch (e) {
      console.error('[integrations] preview failed:', e.message);
      res.status(500).json({ error: 'สร้างตัวอย่างไม่สำเร็จ' });
    }
  });

  // GET /api/integrations/:slug/endpoint-usage — call counts per endpoint
  // for the last 7 days, used to warn before removing column access.
  app.get('/api/integrations/:slug/endpoint-usage', auth.requireAdmin, async (req, res) => {
    try {
      const { rows: [c] } = await pool.query(
        `SELECT id FROM api_consumers WHERE slug = $1`, [req.params.slug]);
      if (!c) return res.status(404).json({ error: 'ไม่พบ consumer นี้' });

      const { rows: usage } = await pool.query(
        `SELECT path, count(*) AS count
           FROM api_request_log
          WHERE consumer_id = $1 AND at > NOW() - INTERVAL '7 days'
          GROUP BY path
          ORDER BY path`, [c.id]);

      const result = {};
      for (const { path, count } of usage) {
        result[path] = Number(count);
      }
      res.json(result);
    } catch (e) {
      console.error('[integrations] endpoint-usage failed:', e.message);
      res.status(500).json({ error: 'ไม่สามารถอ่านข้อมูลการใช้งาน' });
    }
  });
  // PUT /api/integrations/:slug/grants — change what a partner can read.
  //
  // The only endpoint in this system that alters database privileges from an
  // HTTP request, so it is written to be paranoid about it:
  //
  //   - GRANT takes identifiers, not parameters, so nothing reaches the SQL
  //     text without being matched against a catalogue read in the same
  //     transaction. The view must be one of ours, every column must exist in
  //     that view, and the role must belong to a consumer row.
  //   - It runs in one transaction, so a failure part-way leaves the partner
  //     with the privileges they had rather than half the new set.
  //   - It records what changed, not that something changed.
  app.put('/api/integrations/:slug/grants', auth.requireAdmin, async (req, res) => {
    const wanted = req.body?.grants;
    if (!wanted || typeof wanted !== 'object') {
      return res.status(400).json({ error: 'ต้องส่ง grants มาด้วย' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [c] } = await client.query(
        `SELECT id, slug, label, db_role FROM api_consumers WHERE slug = $1 FOR UPDATE`,
        [req.params.slug]);
      if (!c) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'ไม่พบ consumer นี้' }); }

      const { rows: [role] } = await client.query(
        `SELECT 1 AS ok FROM pg_roles WHERE rolname = $1`, [c.db_role]);
      if (!role) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `role ${c.db_role} ไม่มีอยู่ใน Postgres — สร้างคืนก่อนจึงจะแก้สิทธิ์ได้` });
      }
      // Belt and braces on the identifier we are about to interpolate: it came
      // from our own table, but partner-admin is not the only thing that can
      // write there.
      if (!/^[a-z][a-z0-9_]{2,62}$/.test(c.db_role)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'ชื่อ role ไม่อยู่ในรูปแบบที่ปลอดภัย' });
      }

      // The catalogue, read now, is the only source of legal view and column
      // names. Anything the caller sent that is not in here is rejected rather
      // than skipped — silently ignoring an unknown column would let an
      // operator believe they had revoked something.
      const { rows: catalogue } = await client.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ANY($1)`, [EXPOSED_VIEWS]);
      const legal = {};
      for (const r of catalogue) (legal[r.table_name] ||= new Set()).add(r.column_name);

      for (const [view, cols] of Object.entries(wanted)) {
        if (!legal[view]) { await client.query('ROLLBACK'); return res.status(400).json({ error: `view ไม่ถูกต้อง: ${view}` }); }
        for (const col of Object.keys(cols || {})) {
          if (!legal[view].has(col)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `คอลัมน์ไม่ถูกต้อง: ${view}.${col}` });
          }
        }
      }

      // Column-level grants are invisible while the role inherits the blanket
      // SELECT from third_party_readonly — membership wins, and a REVOKE of one
      // column would appear to do nothing. So membership is dropped the first
      // time an operator sets grants explicitly, and this endpoint owns them
      // from then on. Verified: 0 columns visible via column_privileges but
      // 14/14 via has_column_privilege while membership is held.
      // สิทธิ์ก่อนแก้ — ไว้บันทึกว่าคอลัมน์ไหนเพิ่ม/ถอน (audit เดิมเก็บแค่จำนวนต่อ view)
      const { rows: beforeRows } = await client.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ANY($2)
            AND has_column_privilege($1, quote_ident(table_name), column_name, 'SELECT')`,
        [c.db_role, EXPOSED_VIEWS]);
      const before = new Set(beforeRows.map((r) => `${r.table_name}.${r.column_name}`));

      await client.query(`REVOKE third_party_readonly FROM ${c.db_role}`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${c.db_role}`);

      const changes = [];
      const after = new Set();
      for (const view of EXPOSED_VIEWS) {
        const cols = [...legal[view]];
        const want = wanted[view] || {};
        const on = cols.filter((col) => want[col]);

        // Revoke everything on this view first, then grant back what was asked
        // for. Computing a diff would be fewer statements and one more thing
        // to get wrong; these are eleven views, not a hot path.
        await client.query(`REVOKE ALL ON ${view} FROM ${c.db_role}`);
        // รายคอลัมน์เสมอ แม้ติ๊กครบ — GRANT ทั้ง view ครอบคลุมคอลัมน์ที่จะเพิ่มใน view ในอนาคตด้วย (ทดสอบจริง
        // 2026-10-21) ⇒ ฟิลด์ใหม่จะหลุดไปถึง partner โดยไม่มีใครติ๊ก · แนวทาง "ให้ตามความจำเป็น" (ระยะ 2 ขั้น 0)
        if (on.length) await client.query(`GRANT SELECT (${on.join(', ')}) ON ${view} TO ${c.db_role}`);
        for (const col of on) after.add(`${view}.${col}`);
        changes.push({ view, granted: on.length, of: cols.length });
      }

      await client.query('COMMIT');

      await auth.logAudit(req.user?.id, req.user?.username, 'integration_grants_changed',
        null, null, getIP(req), req.headers['user-agent'],
        { consumer: c.slug, dbRole: c.db_role, changes,
          added: [...after].filter((k) => !before.has(k)), removed: [...before].filter((k) => !after.has(k)) });

      res.json({ ok: true, consumer: c.slug, changes });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[integrations] grant update failed:', e.message);
      res.status(500).json({ error: 'แก้สิทธิ์ไม่สำเร็จ: ' + e.message });
    } finally {
      client.release();
    }
  });
  // ---------------------------------------------------------------
  // Lifecycle — who may call /v1
  // ---------------------------------------------------------------
  // All of these delegate to helpers/partnerAdmin.js, the same functions the
  // CLI drives. Nothing about creating a partner is reimplemented here; this
  // layer owns HTTP concerns only — auth, transaction, audit, response shape.
  const audit = (req, action, details) =>
    auth.logAudit(req.user?.id, req.user?.username, action, null, null,
      getIP(req), req.headers['user-agent'], details);

  // Run fn in a transaction and turn a thrown Error into a 400 with its
  // message. Everything partnerAdmin throws is a validation failure phrased for
  // an operator, so passing the text through is the useful behaviour — but it
  // means nothing in there may embed a secret in an error.
  async function txRoute(req, res, action, fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[integrations] ${action} failed:`, e.message);
      res.status(400).json({ error: e.message });
      return null;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------
  // ทะเบียนข้อตกลงข้อมูล (migration 269) — เวอร์ชันต่อเวอร์ชัน ไม่แก้ทับ · สิทธิ์คอลัมน์ ณ ตอนบันทึกถูกถ่ายภาพไว้
  // ---------------------------------------------------------------
  const LEGAL_BASES = ['consent', 'contract', 'legal_obligation', 'legitimate_interest', 'public_task', 'vital_interest'];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  async function grantsSnapshot(db, dbRole) {
    const { rows } = await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)
          AND has_column_privilege($2, quote_ident(table_name), column_name, 'SELECT')
        ORDER BY table_name, ordinal_position`, [EXPOSED_VIEWS, dbRole]);
    const out = {};
    for (const r of rows) (out[r.table_name] ||= []).push(r.column_name);
    return out;
  }

  app.get('/api/integrations/:slug/agreements', auth.requireAdmin, async (req, res) => {
    try {
      const { rows: [c] } = await pool.query(`SELECT id, db_role FROM api_consumers WHERE slug = $1`, [req.params.slug]);
      if (!c) return res.status(404).json({ error: 'ไม่พบ consumer นี้' });
      const { rows } = await pool.query(
        `SELECT version, purpose, legal_basis, dpa_ref, approved_by, valid_until::text, review_due::text, grants, created_by, created_at
           FROM api_consumer_agreements WHERE consumer_id = $1 ORDER BY version DESC`, [c.id]);
      // สิทธิ์ปัจจุบันต่างจากที่บันทึกในเวอร์ชันล่าสุดหรือไม่ = มีคนแก้สิทธิ์โดยไม่ได้อัปเดตข้อตกลง
      let drift = null;
      if (rows[0]) {
        const now = await grantsSnapshot(pool, c.db_role);
        drift = JSON.stringify(now) !== JSON.stringify(rows[0].grants);
      }
      res.json({ agreements: rows, drift, legalBases: LEGAL_BASES });
    } catch (e) {
      console.error('[integrations] agreements failed:', e.message);
      res.status(500).json({ error: 'โหลดข้อตกลงไม่สำเร็จ' });
    }
  });

  app.post('/api/integrations/:slug/agreements', auth.requireAdmin, async (req, res) => {
    const b = req.body || {};
    const str = (k, max) => (typeof b[k] === 'string' ? b[k].trim().slice(0, max) : '');
    const purpose = str('purpose', 2000), approvedBy = str('approvedBy', 200), dpaRef = str('dpaRef', 200) || null;
    if (!purpose) return res.status(400).json({ error: 'ต้องระบุวัตถุประสงค์การใช้ข้อมูล' });
    if (!approvedBy) return res.status(400).json({ error: 'ต้องระบุผู้อนุมัติ' });
    if (!LEGAL_BASES.includes(b.legalBasis)) return res.status(400).json({ error: 'ฐานทางกฎหมายไม่ถูกต้อง' });
    for (const k of ['validUntil', 'reviewDue']) {
      if (b[k] && (!DATE_RE.test(b[k]) || Number.isNaN(Date.parse(b[k])))) return res.status(400).json({ error: `วันที่ ${k} ไม่ถูกต้อง` });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [c] } = await client.query(`SELECT id, db_role FROM api_consumers WHERE slug = $1 FOR UPDATE`, [req.params.slug]);
      if (!c) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'ไม่พบ consumer นี้' }); }
      const grants = await grantsSnapshot(client, c.db_role);
      const { rows: [r] } = await client.query(
        `INSERT INTO api_consumer_agreements
           (consumer_id, version, purpose, legal_basis, dpa_ref, approved_by, valid_until, review_due, grants, created_by)
         VALUES ($1, COALESCE((SELECT max(version) FROM api_consumer_agreements WHERE consumer_id = $1), 0) + 1,
                 $2, $3, $4, $5, $6, COALESCE($7::date, (CURRENT_DATE + 90)), $8, $9)
         RETURNING version`,
        [c.id, purpose, b.legalBasis, dpaRef, approvedBy, b.validUntil || null, b.reviewDue || null,
         JSON.stringify(grants), req.user?.username || null]);
      await client.query('COMMIT');
      await audit(req, 'integration_agreement', { consumer: req.params.slug, version: r.version, legalBasis: b.legalBasis });
      res.json({ ok: true, version: r.version });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[integrations] agreement save failed:', e.message);
      res.status(500).json({ error: 'บันทึกข้อตกลงไม่สำเร็จ' });
    } finally {
      client.release();
    }
  });

  // POST /api/integrations — create a partner, which creates a database role.
  //
  // The riskiest endpoint here: it runs CREATE ROLE from an HTTP request. The
  // slug is validated by partnerAdmin.validateSlug against a narrow regex and a
  // reserved-name list before it is interpolated, and an existing role is a
  // hard error rather than a silent reuse — inheriting whatever grants that
  // role already held is not what someone creating a new partner is asking for.
  app.post('/api/integrations', auth.requireAdmin, async (req, res) => {
    const b = req.body || {};
    const out = await txRoute(req, res, 'create', (c) => PA.createPartner(c, {
      slug: b.slug, label: b.label, sites: b.siteCodes, days: b.days,
      createdBy: req.user?.username || 'console',
      siteScope: { maxLookbackDays: b.maxLookbackDays ?? null, notes: b.notes ?? null },
    }));
    if (!out) return;

    await audit(req, 'integration_created', {
      consumer: b.slug, dbRole: out.dbRole, sites: b.siteCodes || null,
      expiresAt: out.expiresAt, maxLookbackDays: b.maxLookbackDays ?? null,
      // No secret here, and none in the console log either. The audit trail
      // records that a credential was issued, not what it was.
    });

    // The only time the plaintext secret leaves this process. It is not stored,
    // not logged, and can be read back later only through the reveal endpoint,
    // which audits every call.
    res.json({ ok: true, slug: b.slug, dbRole: out.dbRole,
      appKey: out.appKey, appSecret: out.appSecret, expiresAt: out.expiresAt });
  });

  // PATCH /api/integrations/:slug — label, scope, rate, lookback, notes.
  // Deliberately cannot touch app_key, app_secret or db_role: identity is not
  // configuration, and changing it is rotate's job.
  app.patch('/api/integrations/:slug', auth.requireAdmin, async (req, res) => {
    const b = req.body || {};
    const out = await txRoute(req, res, 'update', (c) => PA.updatePartner(c, req.params.slug, b));
    if (!out) return;
    await audit(req, 'integration_updated', { consumer: req.params.slug, patch: b });
    res.json({ ok: true, changed: out.changed });
  });

  // POST /api/integrations/:slug/rotate — new key and secret.
  app.post('/api/integrations/:slug/rotate', auth.requireAdmin, async (req, res) => {
    const out = await txRoute(req, res, 'rotate',
      (c) => PA.rotatePartner(c, req.params.slug, req.body?.days));
    if (!out) return;
    await audit(req, 'integration_rotated', { consumer: req.params.slug, expiresAt: out.expiresAt });
    res.json({ ok: true, appKey: out.appKey, appSecret: out.appSecret, expiresAt: out.expiresAt });
  });

  // POST /api/integrations/:slug/extend — new term from today.
  app.post('/api/integrations/:slug/extend', auth.requireAdmin, async (req, res) => {
    const out = await txRoute(req, res, 'extend',
      (c) => PA.extendPartner(c, req.params.slug, req.body?.days));
    if (!out) return;
    await audit(req, 'integration_extended', { consumer: req.params.slug, expiresAt: out.expiresAt });
    res.json({ ok: true, expiresAt: out.expiresAt });
  });

  // POST /api/integrations/:slug/revoke — stop accepting requests now.
  app.post('/api/integrations/:slug/revoke', auth.requireAdmin, async (req, res) => {
    const out = await txRoute(req, res, 'revoke',
      (c) => PA.revokePartner(c, req.params.slug, req.user?.username || 'console'));
    if (!out) return;
    await audit(req, 'integration_revoked', { consumer: req.params.slug, dbRole: out.dbRole });
    res.json({ ok: true, dbRole: out.dbRole });
  });

  // DELETE /api/integrations/:slug — ลบถาวร ไม่มีปุ่มย้อนกลับ
  //
  // คำยืนยันที่พิมพ์มาถูกตรวจ **ที่นี่** ด้วย ไม่ใช่เชื่อว่าหน้าจอตรวจมาแล้ว —
  // endpoint นี้เรียกตรงจาก curl ได้เหมือนกัน และช่องพิมพ์ยืนยันที่บังคับใช้แค่ใน
  // เบราว์เซอร์คือกฎที่แต่งตัวเป็นข้อจำกัดทางเทคนิค (แบบเดียวกับที่ /reveal
  // อธิบายไว้) · เทียบแบบตัดช่องว่างหัวท้ายแต่ไม่ตัดตัวพิมพ์เล็กใหญ่ ให้ตรงกับ
  // สิ่งที่หน้าจอบอกให้พิมพ์เป๊ะ ๆ
  const DELETE_WORD = 'Confirm';
  app.delete('/api/integrations/:slug', auth.requireAdmin, async (req, res) => {
    if (String(req.body?.confirm ?? '').trim() !== DELETE_WORD) {
      return res.status(400).json({ error: `ต้องพิมพ์ "${DELETE_WORD}" เพื่อยืนยันการลบถาวร` });
    }
    // audit ถูกเขียนอยู่ใน deletePartner() ในทรานแซกชันเดียวกับการลบแล้ว
    // (ย้ายมาจากตรงนี้ 2026-08-27) — ของเดิมเขียนหลัง COMMIT ผ่าน logAudit()
    // ซึ่งกลืน error เงียบ ๆ ⇒ audit ล้มได้โดยที่การลบ commit ไปแล้ว เหลือ
    // partner ที่หายไปโดยไม่มีร่องรอยว่าใครลบ ทั้งที่แถวนั้นคือหลักฐานชิ้นเดียว
    // ที่เหลือ · ตอนนี้ไม่มีแถว audit = ไม่มีการลบ
    const out = await txRoute(req, res, 'delete', (c) => PA.deletePartner(c, req.params.slug, {
      userId: req.user?.id, username: req.user?.username || 'console',
      ip: getIP(req), userAgent: req.headers['user-agent'],
    }));
    if (!out) return;
    res.json({ ok: true, ...out });
  });

  // POST /api/integrations/:slug/reactivate — undo a revoke. Key and grants are
  // untouched, so this genuinely resumes rather than reissues.
  app.post('/api/integrations/:slug/reactivate', auth.requireAdmin, async (req, res) => {
    const out = await txRoute(req, res, 'reactivate', (c) => PA.reactivatePartner(c, req.params.slug));
    if (!out) return;
    await audit(req, 'integration_reactivated', { consumer: req.params.slug });
    res.json({ ok: true });
  });

  // POST /api/integrations/:slug/reveal — read the stored secret back.
  //
  // POST rather than GET so it cannot land in a browser history, a proxy log or
  // a prefetch. The secret is stored reversibly because HMAC verification needs
  // the original — "shown once" would have been a policy dressed as a technical
  // limit, and the same admin already reads camera and MQTT passwords in
  // plaintext (routes/cameras.js:476). What makes this safe is the audit row,
  // not the pretence that we cannot do it.
  app.post('/api/integrations/:slug/reveal', auth.requireAdmin, async (req, res) => {
    try {
      const out = await PA.revealSecret(pool, req.params.slug);
      await audit(req, 'integration_secret_revealed', { consumer: req.params.slug });
      res.json({ ok: true, appKey: out.appKey, appSecret: out.appSecret });
    } catch (e) {
      console.error('[integrations] reveal failed:', e.message);
      res.status(400).json({ error: e.message });
    }
  });

};

module.exports.EXPOSED_VIEWS = EXPOSED_VIEWS;
