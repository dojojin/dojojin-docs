// ============================================================
// Vigil Platform — Routes: Alert Rules
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const auth = require('../auth');
const { auditChange } = require('../helpers/auditTrail');

const routeError = require('../helpers/routeError');
const normalizeTimeOfDay = require('../helpers/normalizeTimeOfDay');
const { createTtlCache } = require('../helpers/ttlCache');
const { validateDeliverVia } = require('../helpers/deliverViaValidate');

module.exports = function alertRulesRoutes(app, pool) {

  // ── Alert Rules (CRUD) ──────────────────────────────────────
  app.get('/api/alert-rules', async (req, res) => {
    try {
      // ช่องทางประจำระบบ (channel IS NOT NULL) มีหน้า config ของตัวเองแล้ว —
      // ไม่แสดงซ้ำที่นี่ ไม่งั้นแก้ได้สองที่แล้วงงว่าอันไหนมีผล (migration 146)
      const { rows } = await pool.query(
        'SELECT * FROM alert_rules WHERE channel IS NULL ORDER BY enabled DESC, id DESC');
      // Site Admin เห็นเฉพาะกฎที่ผูกกล้องของไซต์ตัวเองทั้งหมด (กฎกล้องว่าง = ทุกกล้อง = ของ admin)
      if (req.user?.role === 'site_admin') {
        const ids = await auth.scopedCameraIds(req.user.allowedSites, pool);
        return res.json(rows.filter(r => (r.camera_ids || []).length && r.camera_ids.every(c => ids.has(c))));
      }
      res.json(rows);
    } catch (e) { routeError(res, e, 'GET /api/alert-rules'); }
  });

  app.post('/api/alert-rules', async (req, res) => {
    try {
      const {
        name, enabled = true,
        camera_ids = [], rule_names = [], recipient_ids = [],
        cooldown_seconds = 60, send_snapshot = true, push_user_ids = [],
        message_template, active_from, active_to, dwell_threshold_sec,
        list_types = null,
        // หน้าตาการ์ด LINE (migration 145) — ค่าว่าง = ใช้ของเดิมที่โค้ดประกอบให้
        show_open_link = true, title_template = null, subtitle_template = null,
        text_position = 'below',
        // T2b: ช่องทางส่ง — ค่าเริ่มต้น 'line'/[] ทำงานเหมือนก่อนมี Telegram เป๊ะ
        deliver_via = 'line', telegram_chat_ids = [],
      } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
      // กฎที่ผู้ใช้สร้างเองไม่ใช่ช่องทาง lpr — เลือกแชทจาก telegram_chat_ids เสมอ
      // (ไม่มีแนวคิด lpr_sites/lpr_groups แบบช่องทางป้ายทะเบียน)
      const dv = await validateDeliverVia(pool, {
        deliverVia: deliver_via, telegramChatIds: telegram_chat_ids, isLprChannel: false,
      });
      if (dv.error) return res.status(400).json({ error: dv.error });
      // dwell threshold (044): int > 0 หรือ NULL (= rule ปกติ)
      const dwellSec = parseInt(dwell_threshold_sec, 10) > 0 ? parseInt(dwell_threshold_sec, 10) : null;
      // min likelihood (045): 0 < x <= 1 หรือ NULL
      const minLh = (() => {
        const v = parseFloat(req.body.min_likelihood);
        return Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
      })();
      let af, at;
      try { af = normalizeTimeOfDay(active_from); at = normalizeTimeOfDay(active_to); }
      catch (e) { return res.status(400).json({ error: 'active window: ' + e.message }); }
      // Default template: {camera} renders real camera name, {location} install location.
      const tpl = message_template
        || '🚨 {camera}\n📋 {rule}\n📍 {location}\n⏰ {time}\n👤 {object_class} ({likelihood})';
      const { rows } = await pool.query(
        `INSERT INTO alert_rules (name, enabled, camera_ids, rule_names, recipient_ids,
          cooldown_seconds, send_snapshot, push_user_ids, message_template, active_from, active_to,
          dwell_threshold_sec, min_likelihood, list_types,
          show_open_link, title_template, subtitle_template, text_position,
          deliver_via, telegram_chat_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
        [name.trim(), enabled, camera_ids, rule_names, recipient_ids, cooldown_seconds, send_snapshot, push_user_ids, tpl, af, at, dwellSec, minLh,
         Array.isArray(list_types) && list_types.length > 0 ? list_types : null,
         show_open_link !== false, title_template || null, subtitle_template || null,
         text_position === 'above' ? 'above' : 'below',
         // validateDeliverVia ข้างบนตรวจแล้วว่าค่าเหล่านี้ใช้ได้ ไม่ต้องเช็คซ้ำ
         deliver_via, (Array.isArray(telegram_chat_ids) ? telegram_chat_ids : []).map(String)]
      );
      pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
      await auditChange(req, 'alert_rule_create', { after: rows[0], target: rows[0].id });
      res.json(rows[0]);
    } catch (e) { routeError(res, e, 'POST /api/alert-rules'); }
  });

  app.put('/api/alert-rules/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // T2b: ช่องทางส่ง — validate ก่อนแตะ DB เสมือนกัน (ฟังก์ชันกลางเดียวกับ
      // alert-channels.js) · ถ้าคำขอนี้เปลี่ยนแค่ deliver_via โดยไม่ส่ง telegram_chat_ids
      // มาด้วย ใช้รายการที่บันทึกไว้แล้วของแถวนี้ตัดสิน "พร้อมไหม" เหมือน alert-channels.js
      if (req.body.deliver_via !== undefined || req.body.telegram_chat_ids !== undefined) {
        let existingChatIds = [];
        if (req.body.deliver_via === 'telegram' && req.body.telegram_chat_ids === undefined) {
          const { rows: cur } = await pool.query(
            'SELECT telegram_chat_ids FROM alert_rules WHERE id = $1', [id]);
          existingChatIds = cur[0]?.telegram_chat_ids || [];
        }
        const dv = await validateDeliverVia(pool, {
          deliverVia: req.body.deliver_via, telegramChatIds: req.body.telegram_chat_ids,
          isLprChannel: false, existingChatIds,
        });
        if (dv.error) return res.status(400).json({ error: dv.error });
      }
      const fields = ['name', 'enabled', 'camera_ids', 'rule_names', 'recipient_ids',
                      'cooldown_seconds', 'send_snapshot', 'push_user_ids', 'message_template',
                      // หน้าตาการ์ด LINE (migration 145)
                      'show_open_link', 'title_template', 'subtitle_template', 'text_position',
                      'deliver_via'];   // T2b — validate แล้วข้างบน ผ่าน loop ธรรมดาได้เลย
      const updates = [];
      const values = [];
      let idx = 1;
      for (const f of fields) {
        if (req.body[f] === undefined) continue;
        let v = req.body[f];
        // CHECK constraint รับแค่ above|below — ดักที่นี่ ไม่ปล่อยให้ DB โยน 500 ใส่หน้าจอ
        if (f === 'text_position') v = v === 'above' ? 'above' : 'below';
        if (f === 'title_template' || f === 'subtitle_template') v = v || null;
        updates.push(`${f} = $${idx++}`);
        values.push(v);
      }
      // telegram_chat_ids (T2b): validate แล้วข้างบน — ที่เหลือแค่แปลงเป็น text[]
      if (req.body.telegram_chat_ids !== undefined) {
        updates.push(`telegram_chat_ids = $${idx++}`);
        values.push((Array.isArray(req.body.telegram_chat_ids) ? req.body.telegram_chat_ids : []).map(String));
      }
      // list_types (047): ว่าง/[] → NULL (= ไม่กรอง)
      if (req.body.list_types !== undefined) {
        const lt = req.body.list_types;
        updates.push(`list_types = $${idx++}`);
        values.push(Array.isArray(lt) && lt.length > 0 ? lt : null);
      }
      // dwell threshold (044): int > 0 หรือ NULL (ส่งค่าว่าง/0 = ปิด dwell mode)
      if (req.body.dwell_threshold_sec !== undefined) {
        const ds = parseInt(req.body.dwell_threshold_sec, 10);
        updates.push(`dwell_threshold_sec = $${idx++}`);
        values.push(ds > 0 ? ds : null);
      }
      // min likelihood (045): 0 < x <= 1 หรือ NULL (ว่าง/0 = ไม่กรอง)
      if (req.body.min_likelihood !== undefined) {
        const v = parseFloat(req.body.min_likelihood);
        updates.push(`min_likelihood = $${idx++}`);
        values.push(Number.isFinite(v) && v > 0 && v <= 1 ? v : null);
      }
      // active_from / active_to need normalization (HH:MM, empty → NULL),
      // so they're handled outside the generic field loop.
      for (const f of ['active_from', 'active_to']) {
        if (req.body[f] !== undefined) {
          let v;
          try { v = normalizeTimeOfDay(req.body[f]); }
          catch (e) { return res.status(400).json({ error: `${f}: ${e.message}` }); }
          updates.push(`${f} = $${idx++}`);
          values.push(v);
        }
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(id);
      const { rows: before } = await pool.query('SELECT * FROM alert_rules WHERE id = $1', [id]);
      const { rows } = await pool.query(
        `UPDATE alert_rules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
      pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
      await auditChange(req, 'alert_rule_update', { before: before[0], after: rows[0], target: id });
      res.json(rows[0]);
    } catch (e) { routeError(res, e, 'PUT /api/alert-rules/:id'); }
  });

  app.delete('/api/alert-rules/:id', async (req, res) => {
    // unbounded: ลบ rule ตาม id แล้วเก็บกวาด row ที่อ้างถึงมัน ไม่ใช่การอ่าน events ตามช่วงเวลา
    // unscoped: เขียน — ผ่าน requireAdminForWrites (middleware กลางใน api-server) มาแล้ว
    try {
      const id = parseInt(req.params.id);
      // 🔒 ช่องทางประจำระบบลบไม่ได้ — เป็นเหตุผลทั้งหมดที่แยกมาเป็นหน้าของตัวเอง
      // (เจ้าของชี้ว่าเผลอลบแถว HCP แล้วความสามารถหลักหายเงียบ ๆ)
      const { rows: chk } = await pool.query('SELECT channel FROM alert_rules WHERE id = $1', [id]);
      if (chk[0]?.channel) {
        return res.status(400).json({ error: 'กฎนี้เป็นช่องทางประจำระบบ ลบไม่ได้ — ปิดใช้งานได้จากหน้าตั้งค่าของช่องทางนั้น' });
      }
      const { rows: gone } = await pool.query('DELETE FROM alert_rules WHERE id = $1 RETURNING *', [id]);
      pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
      if (gone[0]) await auditChange(req, 'alert_rule_delete', { before: gone[0], target: id });
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'DELETE /api/alert-rules/:id'); }
  });

  // ── Helper: ดึง rule_names ที่มีใน DB (สำหรับ UI dropdown) ─
  // ⚡ 2026-09-05 — เดิม `SELECT DISTINCT rule_name FROM events ... 30 days` วัดจริง >300s
  // (ไม่มี index บน rule_name, ต้องอ่าน partition ทั้งเดือน) จนหน้าตั้ง rule ค้าง
  // ตอนนี้อ่านจาก event_dim_bucket แทน (rollup 30 นาที · migration 163 ·
  // src/category-rollup-refresher.js) — แหล่งของ rollup กรองแค่ camera_id IS NOT NULL
  // จึงได้ rule_name ครบเท่าเดิม แค่ช้ากว่าของจริง ≤ ~5 นาที ซึ่งไม่มีผลกับ dropdown
  // + cache 5 นาทีในโปรเซส (route นี้ไม่มี RBAC scope จึงใช้ cache ก้อนเดียวได้)
  const _sugCache = createTtlCache({ name: 'alert-rules:suggestions', ttlMs: 5 * 60 * 1000, max: 1 });
  app.get('/api/alert-rules-suggestions', async (req, res) => {
    try {
      const merged = await _sugCache.wrap('suggestions', async () => {
      const { rows } = await pool.query(`
        SELECT DISTINCT rule_name FROM event_dim_bucket
        WHERE bucket > now() - interval '30 days' AND rule_name <> ''
        ORDER BY rule_name
      `);
      // rule_name แบบ synthetic — ยิงผ่าน pg_notify('alert_event') โดยไม่เคยเขียนลง
      // events.rule_name จึงไม่มีวันโผล่ในคิวรีข้างบน ต้องเติมเองให้เลือกตั้ง rule ได้
      //
      // 🔴 AuraFace เพิ่งถูกเติม (2026-08-13) — ก่อนหน้านี้หายไปจากรายการ ทำให้
      // ตั้งกฎเจาะจงไม่ได้เลย ต้องปล่อย rule_names ว่าง (= ทุก rule) ซึ่งไปกิน
      // event ของ HCP ด้วย แล้วยิง LINE ซ้ำสองใบต่อหนึ่งเหตุการณ์ (ยืนยันจาก alert_logs
      // #429/#430 event_id เดียวกัน) · ดู face-embed-worker.js notifyMatch()
      const SYNTHETIC_NAMES = [
        'AuraFace Blacklist Match',
        'Camera Tampering (Scene Change)', 'Camera Tampering (Defocus)',
        'Camera Tampering (Image Dark)', 'Camera Tampering (Image Bright)', 'Camera Tampering (Covered)'];
      return [...new Set([...rows.map(r => r.rule_name), ...SYNTHETIC_NAMES])].sort();
      });   // wrap เก็บเฉพาะตอนคิวรีสำเร็จ — reject ไม่ทิ้งค่าไว้ในแคช
      res.json(merged);
    } catch (e) { routeError(res, e, 'GET /api/alert-rules-suggestions'); }
  });
};
