// ============================================================
// Vigil Platform — Routes: Sites
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const { provisionSite } = require('../site-provision');
const publishSiteConfig = require('../helpers/publishSiteConfig');
const publishSiteRetention = require('../helpers/publishSiteRetention');
const brokerAdmin = require('../helpers/brokerAdmin');
const { setCamerasPaused } = require('../helpers/cameraPause');
const siteStatus = require('../helpers/siteStatus');
const sitePurge = require('../helpers/sitePurge');

// ตรวจรูปร่างของ ids · แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อให้เทสต์ยิงตรงได้
// โดยไม่ต้องมี DB/HTTP (แนวเดียวกับ _lossDecision ใน alert-engine)
function _validateOrderShape(ids) {
  if (!Array.isArray(ids) || !ids.length) return 'ต้องส่ง ids เป็น array';
  if (!ids.every(n => Number.isInteger(n))) return 'ids ต้องเป็นจำนวนเต็มทั้งหมด';
  if (new Set(ids).size !== ids.length) return 'ids ซ้ำกัน';
  return null;
}

// 🔴 เทียบกับ "ทุก site ในตาราง" เสมอ ไม่ใช่ site ที่ผู้เรียกมองเห็น — บัญชี admin
// ถูกจำกัด allowedSites ได้ ถ้าเทียบกับ subset ที่มันเห็น มันจะส่งรายการสั้น ๆ มา
// แล้วตัด site อื่นหายจากลำดับของทุกคนโดยไม่มีอะไรฟ้อง
function _validateOrderSet(ids, allIds) {
  const have = new Set(allIds);
  if (ids.length !== have.size || !ids.every(id => have.has(id))) {
    return `ids ต้องครบทุก site (มี ${have.size} รายการ ส่งมา ${ids.length})`;
  }
  return null;
}

// ตารางที่มี site_id → sites(id) แบบ NO ACTION · ชื่อตาราง hardcode ที่นี่เท่านั้น (ไม่รับจาก user)
const SITE_FK_TABLES = [
  { table: 'event_categories',       label: 'หมวดเหตุการณ์' },
  { table: 'report_schedules',       label: 'ตารางรายงาน' },
  { table: 'lpr_watchlist_groups',   label: 'กลุ่ม watchlist ป้ายทะเบียน' },
  { table: 'face_blacklist_groups',  label: 'กลุ่ม blacklist ใบหน้า' },
];

module.exports = function sitesRoutes(app, pool, { auth, loadCameraConfig, saveCameraConfig, loadGroups, saveGroups, SNAPSHOT_DIR } = {}) {
  // GET /api/sites — list sites with camera count + capability flags.
  // Site-scoped viewers (allowedSites = [ids]) only get their own sites, so
  // scope bars never render — or even leak the names of — sites they can't
  // access. admin/auditor (allowedSites = null) get all sites.
  // has_face/has_lpr/has_appearance let the frontend hide Face/LPR/Person nav
  // pages and report domains when none of the visible sites have that camera
  // type — single source used by both nav-hide (session-static) and the
  // reports scope bar (per active site chip). Each flag maps to exactly one
  // cam_role: face events come from cam_role='face' cameras, LPR plates from
  // cam_role='lpr', and appearance/person-detection data comes from
  // cam_role='standard' cameras' VCA (verified: face/lpr cameras produce 0
  // Person-class events on this platform) — NOT from face cameras, so
  // appearance is its own flag rather than reusing has_face.
  app.get('/api/sites', async (req, res) => {
    try {
      const allowed = req.user?.allowedSites ?? null;
      const params = [];
      let where = '';
      if (allowed !== null) { params.push(allowed); where = 'WHERE s.id = ANY($1)'; }
      const { rows } = await pool.query(
        `SELECT s.id, s.code, s.name, s.color,
                s.retention_events_days, s.retention_lpr_days,
                s.retention_face_days, s.retention_min_free_gb,
                s.status, s.status_since, s.status_by, s.status_note, s.maintenance_ingest,
                -- What the edge says it is running and what it actually holds.
                -- Joined here rather than fetched separately: the page that
                -- sets the policy is the page that has to show what applying it
                -- would remove, and splitting that across two requests is how
                -- the two drift apart on screen.
                es.retention_json AS edge_retention,
                es.inventory_json AS edge_inventory,
                es.last_prune_json AS edge_last_prune,
                es.disk_free_gb   AS edge_free_gb,
                COUNT(c.id)::int AS camera_count,
                COALESCE(bool_or(c.cam_role = 'face'),     false) AS has_face,
                COALESCE(bool_or(c.cam_role = 'lpr'),      false) AS has_lpr,
                COALESCE(bool_or(c.cam_role = 'standard'), false) AS has_appearance
         FROM sites s
         LEFT JOIN cameras c ON c.site_id = s.id
         LEFT JOIN edge_status es ON es.site_id = s.code
         ${where}
         GROUP BY s.id, es.retention_json, es.inventory_json,
                  es.last_prune_json, es.disk_free_gb
         -- ลำดับนี้ต้องเหมือนกันทุกที่ที่เรียง site (traffic.js:175/291/952/1300)
         -- ส่วนท้าย s.id คือตัวตัดสินเมื่อ sort_order ซ้ำ ห้ามตัดออก (migration 189)
         ORDER BY s.sort_order, s.id`,
        params
      );
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/sites'); }
  });

  // POST /api/sites — create site (admin only)
  app.post('/api/sites', auth.requireAdmin, async (req, res) => {
    try {
      const code  = String(req.body.code  || '').trim().toLowerCase();
      const name  = String(req.body.name  || '').trim();
      const color = String(req.body.color || '#6366f1').trim();
      if (!code || !/^[a-z0-9_-]{1,30}$/.test(code)) return res.status(400).json({ error: 'รหัส site ต้องเป็นตัวเล็ก a-z 0-9 _ - และยาวไม่เกิน 30 ตัว' });
      if (!name) return res.status(400).json({ error: 'กรุณาใส่ชื่อ Site' });
      const { rows } = await pool.query(
        // site ใหม่ไปต่อท้ายเสมอ · COALESCE จำเป็นตอนตารางว่าง (ติดตั้งใหม่)
        `INSERT INTO sites (code, name, color, sort_order)
         VALUES ($1,$2,$3,(SELECT COALESCE(MAX(sort_order),0)+1 FROM sites))
         RETURNING id, code, name, color, sort_order`,
        [code, name, color]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'รหัส site นี้มีอยู่แล้ว' });
      routeError(res, err, 'POST /api/sites');
    }
  });

  // PUT /api/sites/:id — edit name/color only (code is immutable after create)
  app.put('/api/sites/:id', auth.requireAdmin, async (req, res) => {
    try {
      const id    = parseInt(req.params.id, 10);
      const name  = String(req.body.name  || '').trim();
      const color = String(req.body.color || '').trim();
      if (!name) return res.status(400).json({ error: 'กรุณาใส่ชื่อ Site' });
      const { rows, rowCount } = await pool.query(
        `UPDATE sites SET name=$2, color=$3 WHERE id=$1 RETURNING id, code, name, color`,
        [id, name, color]
      );
      if (!rowCount) return res.status(404).json({ error: 'ไม่พบ Site' });
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'PUT /api/sites/:id'); }
  });

  // PUT /api/sites/order — จัดลำดับการแสดง site ใหม่ (admin เท่านั้น)
  //
  // รับ "ทั้งรายการ" ไม่ใช่ทีละก้าว: การย้ายทีละแถวต้องเขียนสองครั้ง ซึ่งถ้ามี
  // admin อีกคนย้ายพร้อมกันจะสลับกันจนลำดับเพี้ยน · ส่งทั้งชุดแล้วให้คนเขียนทีหลัง
  // ชนะ เป็นผลลัพธ์ที่ถูกสำหรับค่า preference ระดับนี้
  //
  // 🔴 ตรวจเทียบกับ "ทุก site ในตาราง" ไม่ใช่ site ที่ผู้เรียกมองเห็น — บัญชี admin
  //    ถูกจำกัด allowedSites ได้ และ GET /api/sites คืนมาแค่ subset ถ้าเทียบกับ
  //    subset นั้น admin ที่ถูกจำกัดจะส่งรายการสั้น ๆ มาแล้วตัด site อื่นหายจาก
  //    ลำดับของทุกคนโดยไม่มีอะไรฟ้อง
  app.put('/api/sites/order', auth.requireAdmin, async (req, res) => {
    const ids = req.body && req.body.ids;
    const shapeErr = _validateOrderShape(ids);
    if (shapeErr) return res.status(400).json({ error: shapeErr });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: all } = await client.query('SELECT id FROM sites');
      const setErr = _validateOrderSet(ids, all.map(r => r.id));
      if (setErr) { await client.query('ROLLBACK'); return res.status(400).json({ error: setErr }); }
      for (let i = 0; i < ids.length; i++) {
        await client.query('UPDATE sites SET sort_order = $2 WHERE id = $1', [ids[i], i + 1]);
      }
      await client.query('COMMIT');
      // ไม่ audit endpoint นี้ — เปลี่ยนแค่ลำดับการแสดงผล (ส่วน DELETE / provision / retention มี audit_log)
      res.json({ ok: true, count: ids.length });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      routeError(res, err, 'PUT /api/sites/order');
    } finally { client.release(); }
  });

  // ── ลบไซต์พร้อมข้อมูลทั้งหมด (S5 · helpers/sitePurge) ──────────────
  // ลำดับ: GET purge-plan (นับ + ตัวบล็อก) → POST purge {confirm: <code>} → poll GET purge-job
  // ต้องอยู่ในสถานะ maintenance/archived ก่อน · ไซต์หลักลบไม่ได้ · ทีละงานเดียว
  const purgeDeps = () => ({
    loadCameraConfig, saveCameraConfig,
    loadCameraGroups: loadGroups, saveCameraGroups: saveGroups,
    snapshotDir: SNAPSHOT_DIR,
  });

  // GET /api/sites/purge-job — สถานะงานลบไซต์ล่าสุด (กำลังทำ/เสร็จ/ล้ม) · null = ไม่เคยมี
  // ต้องประกาศก่อน /api/sites/:id/* ไม่งั้น express จับ "purge-job" เป็น :id
  app.get('/api/sites/purge-job', auth.requireAdmin, async (req, res) => {
    try { res.json({ job: await sitePurge.getPurgeJob(pool) }); }
    catch (err) { routeError(res, err, 'GET /api/sites/purge-job'); }
  });

  app.get('/api/sites/:id/purge-plan', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(404).json({ error: 'ไม่พบ Site' });
      res.json(await sitePurge.planSitePurge(pool, id, purgeDeps()));
    } catch (err) { routeError(res, err, 'GET /api/sites/:id/purge-plan'); }
  });

  app.post('/api/sites/:id/purge', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(404).json({ error: 'ไม่พบ Site' });
      const plan = await sitePurge.planSitePurge(pool, id, { ...purgeDeps(), skipCounts: true });
      if (typeof req.body?.confirm !== 'string' || req.body.confirm !== plan.site.code) {
        return res.status(400).json({ error: 'รหัสยืนยันไม่ตรงกับรหัสไซต์' });
      }
      if (plan.blockers.length) {
        return res.status(409).json({ error: plan.blockers.map(b => b.message).join(' · '), blockers: plan.blockers, users: plan.users });
      }
      const job = await sitePurge.startSitePurge(pool, plan, { ...purgeDeps(), user: req.user });
      res.status(202).json({ ok: true, job });
    } catch (err) { routeError(res, err, 'POST /api/sites/:id/purge'); }
  });

  // DELETE /api/sites/:id — ลบไซต์ "ว่าง" (0 กล้อง ไม่มีข้อมูลผูก) · ไซต์ที่มีข้อมูลใช้ purge ข้างบน
  app.delete('/api/sites/:id', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const siteRow = await pool.query(`SELECT code FROM sites WHERE id=$1`, [id]);
      if (!siteRow.rowCount) return res.status(404).json({ error: 'ไม่พบ Site' });
      if (siteRow.rows[0].code === 'main') return res.status(400).json({ error: 'ไม่สามารถลบ Site หลักได้' });
      const camCount = await pool.query(`SELECT COUNT(*)::int AS n FROM cameras WHERE site_id=$1`, [id]);
      if (camCount.rows[0].n > 0) return res.status(409).json({ error: `ไม่สามารถลบได้ — มีกล้อง ${camCount.rows[0].n} ตัวอยู่ใน Site นี้ ย้ายกล้องออกก่อน` });
      // ตารางที่ FK ชี้มาที่ sites(id) แบบ NO ACTION — ถ้ามีแถวค้างอยู่ DELETE จะโยน 23503
      // (เดิมตอบ 500) · นับก่อนเพื่อบอกแอดมินว่าอะไรยังผูกอยู่
      const blockers = {};
      for (const t of SITE_FK_TABLES) {
        const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${t.table} WHERE site_id=$1`, [id])).rows[0].n;
        if (n > 0) blockers[t.table] = n;
      }
      if (Object.keys(blockers).length) {
        const list = SITE_FK_TABLES.filter(t => blockers[t.table]).map(t => `${t.label} ${blockers[t.table]}`).join(' · ');
        return res.status(409).json({ error: `ไม่สามารถลบได้ — ยังมีข้อมูลผูกกับ Site นี้: ${list}`, blockers });
      }
      try {
        await pool.query(`DELETE FROM sites WHERE id=$1`, [id]);
      } catch (e) {
        // ตารางอื่นที่เพิ่งมี FK มาทีหลัง (ไม่อยู่ในลิสต์ข้างบน) · ตอบ 409 พร้อมรายละเอียดแทน 500
        if (e.code === '23503') return res.status(409).json({ error: `ไม่สามารถลบได้ — ยังมีข้อมูลผูกกับ Site นี้: ${e.detail || e.message}` });
        throw e;
      }
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown', 'site_deleted',
         JSON.stringify({ site_id: id, code: siteRow.rows[0].code })]
      ).catch(() => {});
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/sites/:id'); }
  });

  // PUT /api/sites/:id/status — เปลี่ยนสถานะไซต์ active ⇄ maintenance ⇄ archived (admin only · migration 285)
  // maintenance = เงียบทุกแจ้งเตือน (helpers/siteStatus) · ข้อมูลเดิมค้นได้ปกติ · ปกติ pause กล้องทั้งไซต์
  // (paused_by_site=TRUE) ไม่รับข้อมูลใหม่ เว้นแต่ ingest=true · ออกจากโหมด = คืนเฉพาะกล้องที่ "ระบบ" pause ไว้
  // archived (เก็บถาวร) = เหมือน maintenance + ถอนรหัส broker ของ edge (`edge-<code>`) + ซ่อนจากหน้าสด
  // ถอนรหัสล้ม ≠ request ล้ม (สถานะเปลี่ยนแล้ว) — ตอบ ok พร้อม warning ให้แอดมินเข้าไปถอนเอง
  // archived → active ต้องกด provision-edge ใหม่ก่อน edge จะต่อได้ (needs_edge_provision)
  app.put('/api/sites/:id/status', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const to = req.body?.status;
      if (to !== 'active' && to !== 'maintenance' && to !== 'archived') return res.status(400).json({ error: 'status ต้องเป็น active, maintenance หรือ archived' });
      const rawNote = req.body?.note;
      if (rawNote != null && typeof rawNote !== 'string') return res.status(400).json({ error: 'note ต้องเป็นข้อความ' });
      const note = (rawNote || '').trim() || null;
      if (note && note.length > 500) return res.status(400).json({ error: 'note ยาวเกิน 500 ตัวอักษร' });
      // 🔴 ingest=true (รับข้อมูลต่อระหว่าง maintenance) ปิดไว้ก่อน — แจ้งเตือนจากเหตุการณ์ (watchlist ป้าย ·
      // ใบหน้า · กฎแจ้งเตือน) ยังไม่ถูกปิดเสียงตามสถานะไซต์ ถ้ารับข้อมูลต่อ การ์ดจะยังเข้ากลุ่ม LINE (31 ต.ค.)
      if (req.body?.ingest === true) return res.status(400).json({ error: 'ยังไม่รองรับการรับข้อมูลต่อระหว่าง maintenance' });
      const ingest = false;

      const sr = Number.isInteger(id)
        ? await pool.query(`SELECT id, code, status FROM sites WHERE id=$1`, [id])
        : { rows: [] };
      if (!sr.rows.length) return res.status(404).json({ error: 'ไม่พบ Site' });
      const site = sr.rows[0];
      if (site.code === 'main') return res.status(400).json({ error: 'ไม่สามารถเปลี่ยนสถานะ Site หลักได้' });
      if (site.status === to) return res.json({ ok: true, unchanged: true });

      const user = req.user || { id: null, username: 'unknown' };
      const by = String(user.username || 'unknown').slice(0, 64);
      // 🔴 pause/resume กล้องก่อนแล้วค่อยเขียน sites.status — ล้มกลางทางแล้วกดซ้ำได้
      // (ทางลัด unchanged จะไม่บล็อก เพราะสถานะไซต์ยังไม่เปลี่ยน · pause ซ้ำเลือกเฉพาะ paused=FALSE)
      let n = 0;
      if (to === 'maintenance' || to === 'archived') {
        if (!ingest) {
          const { rows } = await pool.query(`SELECT id FROM cameras WHERE site_id=$1 AND paused=FALSE`, [id]);
          n = (await setCamerasPaused(pool, {
            cameraIds: rows.map(r => r.id), paused: true, bySite: true,
            reason: to === 'archived' ? 'site archived' : 'site maintenance', user, loadCameraConfig, saveCameraConfig,
          })).length;
        }
        await pool.query(
          `UPDATE sites SET status='${to}', status_since=NOW(), status_by=$2, status_note=$3, maintenance_ingest=$4 WHERE id=$1`,
          [id, by, note, ingest]);
      } else {
        const { rows } = await pool.query(`SELECT id FROM cameras WHERE site_id=$1 AND paused_by_site=TRUE`, [id]);
        n = (await setCamerasPaused(pool, {
          cameraIds: rows.map(r => r.id), paused: false,
          reason: site.status === 'archived' ? 'site unarchived' : 'site maintenance ended', user, loadCameraConfig, saveCameraConfig,
        })).length;
        await pool.query(
          `UPDATE sites SET status='active', status_since=NOW(), status_by=$2, status_note=NULL, maintenance_ingest=FALSE WHERE id=$1`,
          [id, by]);
      }
      siteStatus.invalidate();

      // edge ของไซต์นี้ = มีแถวใน edge_status (เคย heartbeat เข้ามา) · ตรวจไม่ได้ = ไม่รู้ ไม่ใช่ "ไม่มี"
      let hasEdge = false, edgeErr = null;
      if (n > 0 || to === 'archived' || site.status === 'archived') {
        try { hasEdge = (await pool.query(`SELECT 1 FROM edge_status WHERE site_id=$1`, [site.code])).rowCount > 0; }
        catch (err) { edgeErr = err; console.warn('[site-status] edge_status lookup failed:', err.message); }
      }

      // flag paused ไปถึง edge ทาง _config/cameras (payload = แถวใน cameras-config.json ซึ่งมี .paused)
      // ingester ฝั่ง edge อ่านจากไฟล์นั้น · ไม่ publish ก็ไม่ผิด (central ทิ้ง event ของกล้อง paused อยู่แล้ว)
      if (n > 0 && hasEdge && loadCameraConfig) {
        try { await publishSiteConfig(id, loadCameraConfig().cameras, pool); }
        catch (err) { console.warn('[site-status] publish to edge failed:', err.message); }
      }
      // 🧊 hold ไปถึง edge (retained _config/retention) ทั้งตอนเข้าและออกจากโหมด — ล้มไม่ fatal
      // ส่งไม่ถึง = edge ยังลบตามอายุอยู่จนกว่าจะ boot central ใหม่ (republish ตอน boot) หรือกดบันทึก retention
      // archived ก็ hold=true (status <> 'active')
      try { await publishSiteRetention(id, pool); }
      catch (err) { console.warn('[site-status] publish retention hold failed:', err.message); }

      // ถอนรหัส broker ของ edge — username ต้องตรงกับ site-provision.js (`edge-<code>`)
      // ล้มไม่ fail request: สถานะ/กล้องเปลี่ยนไปแล้ว คืน warning ให้แอดมินตามต่อ
      // ponytail: ไม่ล้าง retained topic projects/<code>/_config/* — brokerAdmin ไม่มี helper ลบ retained
      let edgeRevoked = false, warning = null;
      if (to === 'archived') {
        if (edgeErr) warning = `ตรวจไม่ได้ว่าไซต์มี edge หรือไม่ จึงยังไม่ได้ถอนรหัส: ${edgeErr.message}`;
        else if (hasEdge) {
          try { await brokerAdmin.deleteUser(`edge-${site.code}`); edgeRevoked = true; }
          catch (err) {
            warning = `ถอนรหัส edge ไม่สำเร็จ: ${err.message}`;
            console.warn('[site-status] revoke edge credential failed:', err.message);
          }
        }
      }

      const counted = to === 'active' ? { cameras_resumed: n } : { cameras_paused: n };
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [user.id, user.username || 'unknown', 'site_status',
         JSON.stringify({ site_id: id, code: site.code, from: site.status, to, ingest: to === 'maintenance' ? ingest : false, ...counted, edge_revoked: edgeRevoked, note })]
      ).catch(() => {});

      const out = { ok: true, status: to, ...counted };
      if (to === 'archived') {
        out.edge_revoked = edgeRevoked;
        if (warning) out.warning = warning;
      }
      // รหัส edge ถูกถอนตอน archive แล้ว — ต้องออกรหัสใหม่ (provision-edge) ก่อน edge จะต่อได้
      if (to === 'active' && site.status === 'archived' && hasEdge) out.needs_edge_provision = true;
      res.json(out);
    } catch (err) { routeError(res, err, 'PUT /api/sites/:id/status'); }
  });

  // POST /api/sites/:id/provision-edge — create/rotate this site's edge MQTT
  // bridge identity (broker user edge-<code> + ACL projects/<code>/#, EMQX or
  // Mosquitto per BROKER_KIND). Admin only. Reuses src/site-provision (same
  // engine as the CLI). Returns credentials ONCE (cleartext password is never
  // stored — an encrypted copy lands in sites.bridge_password_enc); re-running
  // ROTATES the password.
  app.post('/api/sites/:id/provision-edge', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const sr = await pool.query(`SELECT id, code, name, color FROM sites WHERE id=$1`, [id]);
      if (!sr.rowCount) return res.status(404).json({ error: 'ไม่พบ Site' });
      const site = sr.rows[0];
      const out = await provisionSite(pool, { code: site.code, name: site.name, color: site.color });
      // audit — record who/which site; NEVER log the password
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || null, 'site_provision_edge',
         JSON.stringify({ site_id: site.id, code: site.code, mqtt_username: out.mqtt.username })]);
      res.json(out);
    } catch (err) { routeError(res, err, 'POST /api/sites/:id/provision-edge'); }
  });

  // PUT /api/sites/:id/retention — per-site image retention (R1).
  //
  // Writes the row and publishes in the same request, so an operator can never
  // be looking at a saved value the edge has not been told about. If the publish
  // fails the row is still saved and the response says so — the retained topic
  // is re-sent on the next save or on POST /push-config, and the edge keeps its
  // previous policy in the meantime rather than falling back to a default.
  app.put('/api/sites/:id/retention', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);

      // PUT ตัวนี้แทนค่าทั้งก้อน ฟิลด์ที่ไม่ได้ส่งมาจะกลายเป็น null ซึ่งถูกต้องตาม
      // semantics ของ PUT แต่แปลว่าพิมพ์ชื่อฟิลด์ผิดหนึ่งตัว = ลบ policy ของไซต์นั้น
      // ทิ้งเงียบ ๆ แล้วยังตอบ ok:true (เกิดจริงกับ hkt 2026-08-23 — ส่ง
      // retention_lpr_days แทน lpr_days ทั้งสี่ค่าจึงกลายเป็น null)
      // ผู้เรียกจริงมีรายเดียวคือ saveSiteRetention() ใน dashboard/page-system.js
      // ซึ่งส่งครบสี่ฟิลด์ทุกครั้ง การปฏิเสธ key แปลกจึงไม่กระทบของเดิม
      // — คนที่โดนคือ script ad-hoc ซึ่งคือคนที่ควรโดนพอดี
      const KNOWN = ['events_days', 'lpr_days', 'face_days', 'min_free_gb'];
      const unknown = Object.keys(req.body || {}).filter((k) => !KNOWN.includes(k));
      if (unknown.length) {
        return res.status(400).json({
          error: `ไม่รู้จักฟิลด์: ${unknown.join(', ')} — ต้องเป็น ${KNOWN.join(', ')}`,
        });
      }

      // null = ไม่ตั้ง (edge ใช้ค่าเดิม). Anything unparseable becomes null
      // rather than 0 — 0 days would mean "delete everything" on a remote box.
      const num = (v, lo, hi) => {
        if (v === null || v === undefined || v === '') return null;
        const n = parseInt(v, 10);
        if (!Number.isFinite(n)) return null;
        return Math.max(lo, Math.min(hi, n));
      };
      const vals = [
        num(req.body?.events_days, 1, 3650),
        num(req.body?.lpr_days, 1, 3650),
        num(req.body?.face_days, 1, 3650),
        num(req.body?.min_free_gb, 1, 100000),
      ];
      const { rows } = await pool.query(
        `UPDATE sites SET retention_events_days = $2, retention_lpr_days = $3,
                          retention_face_days = $4, retention_min_free_gb = $5
          WHERE id = $1
      RETURNING id, code, retention_events_days, retention_lpr_days,
                retention_face_days, retention_min_free_gb`, [id, ...vals]);
      if (!rows.length) return res.status(404).json({ error: 'ไม่พบ Site' });

      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown', 'site_retention_changed',
         JSON.stringify({ site_id: id, code: rows[0].code, ...req.body })]
      ).catch(() => {});

      let published = null, publishError = null;
      try { published = await publishSiteRetention(id, pool); }
      catch (e) { publishError = e.message; }
      res.json({ ok: true, site: rows[0], published, publish_error: publishError });
    } catch (err) { routeError(res, err, 'PUT /api/sites/:id/retention'); }
  });

  // POST /api/sites/:id/push-config — manually push cameras-config to edge
  // (initial bootstrap or force-resync). EC1 auto-fires on every camera save;
  // this endpoint handles the first-time push before any camera is edited.
  app.post('/api/sites/:id/push-config', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const sr = await pool.query(`SELECT id, code FROM sites WHERE id=$1`, [id]);
      if (!sr.rowCount) return res.status(404).json({ error: 'ไม่พบ Site' });
      const cameras = loadCameraConfig ? loadCameraConfig().cameras : [];
      const result = await publishSiteConfig(id, cameras, pool);
      res.json({ ok: true, ...result });
    } catch (err) { routeError(res, err, 'POST /api/sites/:id/push-config'); }
  });
};

// export เพื่อให้เทสต์เรียกตรงได้ ไม่ต้องมี DB/HTTP
module.exports._validateOrderShape = _validateOrderShape;
module.exports._validateOrderSet = _validateOrderSet;
