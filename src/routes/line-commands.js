// ============================================================
// Vigil Platform — Routes: ตั้งค่าคำสั่งผ่าน LINE (admin เท่านั้น)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// สามเรื่องในไฟล์เดียว เพราะหน้าตั้งค่าหน้าเดียวใช้ทั้งสามและแยกกันไม่ได้ในทางปฏิบัติ:
//   1. ใครสั่งได้        (line_operators)
//   2. คำสั่งมีอะไรบ้าง   (line_commands + ทะเบียนแหล่งข้อมูลที่อยู่ในโค้ด)
//   3. ใช้ไปแล้วยังไง    (line_command_log)
//
// ⚠️ `source_key` รับเฉพาะคีย์ที่มีอยู่จริงในทะเบียน — ถ้าปล่อยให้พิมพ์อะไรก็ได้
// คำสั่งจะบันทึกสำเร็จแต่ใช้งานจริงพังตอนมีคนสั่ง ซึ่งไปโผล่ในกลุ่ม LINE ไม่ใช่บนหน้าจอ
// ของคนตั้ง (แพตเทิร์นเดียวกับ isValidKey ของ view-registry ที่ /api/users/:id/views ใช้)
// ============================================================
'use strict';

const { SOURCES } = require('../line-answer-sources');
const { ACTIONS } = require('../line-actions');
const { sitesForUser, siteLabel } = require('../helpers/lineCommandSites');
const lineSender = require('../line-sender');
const { genLinkCode, hashLinkCode } = require('../helpers/telegramLinkCode');

const SLOT_KEYS = ['period', 'limit', 'site', 'camera', 'plate', 'hours'];

module.exports = function lineCommandRoutes(app, pool, { auth, routeError }) {
  const _arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

  // ── ทะเบียนแหล่งข้อมูล (อ่านอย่างเดียว — มาจากโค้ด) ─────────
  app.get('/api/line/command-sources', auth.requireAdminOrAuditor, async (_req, res) => {
    res.json(Object.entries(SOURCES).map(([key, s]) => ({
      key, label: s.label, path: s.path, accepts: s.accepts || [],
    })));
  });

  // ── ทะเบียนการกระทำ + ผู้รับปลายทาง (ฟอร์มใช้พร้อมกัน จึงรวมเป็นคำขอเดียว) ──
  app.get('/api/line/command-actions', auth.requireAdminOrAuditor, async (_req, res) => {
    try {
      const { rows } = await pool.query('SELECT recipients FROM line_config WHERE id = 1');
      const recipients = (rows[0]?.recipients || [])
        .filter((r) => r && r.enabled !== false)
        .map((r) => ({ id: r.id, name: r.name || String(r.id).slice(-6), type: r.type }));
      res.json({
        actions: Object.entries(ACTIONS).map(([key, a]) => ({
          key, label: a.label, accepts: a.accepts || [], needsTargets: !!a.needsTargets,
        })),
        recipients,
      });
    } catch (e) { routeError(res, e, 'GET /api/line/command-actions'); }
  });

  // ── คำสั่ง ─────────────────────────────────────────────────
  // ?source_type=telegram = นับ "ใช้ 30 วัน"/"ใช้ล่าสุด" เฉพาะแถวปูมของ Telegram
  // (หน้า "คำสั่งผ่าน Telegram" ใช้พารามิเตอร์นี้ — หน้า LINE ไม่ส่งมา = พฤติกรรมเดิมเป๊ะ)
  app.get('/api/line/commands', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const srcType = req.query.source_type ? String(req.query.source_type) : null;
      const { rows } = await pool.query(`
        SELECT c.*,
               (SELECT max(at) FROM line_command_log l
                 WHERE l.matched_key = c.key ${srcType ? 'AND l.source_type = $1' : ''}) AS last_used_at,
               (SELECT count(*) FROM line_command_log l
                 WHERE l.matched_key = c.key AND l.status = 'ok'
                   AND l.at > NOW() - interval '30 days'
                   ${srcType ? 'AND l.source_type = $1' : ''})::int AS used_30d
          FROM line_commands c ORDER BY c.id`,
        srcType ? [srcType] : []);
      res.json(rows);
    } catch (e) { routeError(res, e, 'GET /api/line/commands'); }
  });

  function validateBody(b) {
    const key = String(b.key || '').trim();
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) return { error: 'key ต้องเป็น a-z0-9_ ขึ้นต้นด้วยตัวอักษร' };
    if (!String(b.label || '').trim()) return { error: 'ต้องมีชื่อคำสั่ง' };
    // คำสั่งเป็นได้อย่างใดอย่างหนึ่ง: ถามข้อมูล (source) หรือ ลงมือทำ (action)
    const actionKey = b.action_key ? String(b.action_key) : null;
    if (actionKey) {
      if (!ACTIONS[actionKey]) return { error: `ไม่รู้จักการกระทำ ${actionKey}` };
      if (ACTIONS[actionKey].needsTargets) {
        const to = Array.isArray(b.fixed_params?.to) ? b.fixed_params.to.filter(Boolean) : [];
        // คำสั่งที่ส่งของออกไปข้างนอกโดยไม่รู้ว่าส่งถึงใคร = สร้างไว้ก็กดไม่ได้
        if (!to.length) return { error: 'คำสั่งชนิดลงมือทำ ต้องเลือกผู้รับปลายทางอย่างน้อยหนึ่งราย' };
      }
    } else if (!SOURCES[String(b.source_key || '')]) {
      return { error: `ไม่รู้จักแหล่งข้อมูล ${b.source_key}` };
    }
    const slots = _arr(b.slots).filter((s) => SLOT_KEYS.includes(s));
    const required = _arr(b.required_slots).filter((s) => SLOT_KEYS.includes(s));
    // บังคับช่องที่คำสั่งไม่ได้ดึงมาตั้งแต่แรก = บอทจะถามวนไม่จบ เพราะคำตอบไม่มีที่ลง
    const orphan = required.filter((s) => !slots.includes(s));
    if (orphan.length) return { error: `ช่องที่บังคับต้องอยู่ในช่องที่ดึงด้วย: ${orphan.join(', ')}` };
    const triggers = _arr(b.triggers);
    if (!triggers.length && !_arr(b.require_all).length) return { error: 'ต้องมีคำเรียกอย่างน้อยหนึ่งคำ' };
    return {
      key, label: String(b.label).trim(),
      source_key: actionKey ? null : b.source_key,
      action_key: actionKey,
      enabled: b.enabled !== false,
      triggers, require_all: _arr(b.require_all), exclude: _arr(b.exclude),
      slots, required_slots: required,
      fixed_params: (b.fixed_params && typeof b.fixed_params === 'object') ? b.fixed_params : {},
      reply_title: b.reply_title ? String(b.reply_title).trim() : null,
      // ตัวอย่างที่โชว์ตอนพิมพ์ "ช่วยเหลือ" — เก็บที่นี่เพราะคำสั่งเป็นข้อมูลที่แก้เองได้
      example: b.example ? String(b.example).trim().slice(0, 200) : null,
      cooldown_sec: Math.min(Math.max(parseInt(b.cooldown_sec, 10) || 0, 0), 3600),
    };
  }

  app.post('/api/line/commands', auth.requireAdmin, async (req, res) => {
    const v = validateBody(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    try {
      const { rows } = await pool.query(`
        INSERT INTO line_commands
          (key, label, enabled, source_key, action_key, triggers, require_all, exclude,
           fixed_params, slots, required_slots, reply_title, cooldown_sec, example)
        VALUES ($1,$2,$3,$4,$13,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$14)
        RETURNING *`,
        [v.key, v.label, v.enabled, v.source_key, JSON.stringify(v.triggers),
         JSON.stringify(v.require_all), JSON.stringify(v.exclude), JSON.stringify(v.fixed_params),
         JSON.stringify(v.slots), JSON.stringify(v.required_slots), v.reply_title, v.cooldown_sec,
         v.action_key, v.example]);
      await auth.logAudit(req.user?.id, req.user?.username, 'line_command_create', null, null,
        null, null, { key: v.key });
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'มีคำสั่งคีย์นี้อยู่แล้ว' });
      routeError(res, e, 'POST /api/line/commands');
    }
  });

  app.patch('/api/line/commands/:id', auth.requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    // เปิด/ปิดอย่างเดียวไม่ต้องส่งทั้งก้อนมา — เป็นการกดสวิตช์บนตาราง
    if (Object.keys(req.body || {}).length === 1 && typeof req.body.enabled === 'boolean') {
      try {
        const { rows } = await pool.query(
          'UPDATE line_commands SET enabled = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
          [id, req.body.enabled]);
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        return res.json(rows[0]);
      } catch (e) { return routeError(res, e, 'PATCH /api/line/commands (toggle)'); }
    }
    // สวิตช์เฉพาะฝั่ง Telegram — คำสั่งเดียวกันยังเปิดอยู่บน LINE ได้ตามเดิม (migration 244)
    if (Object.keys(req.body || {}).length === 1 && typeof req.body.telegram_enabled === 'boolean') {
      try {
        const { rows } = await pool.query(
          'UPDATE line_commands SET telegram_enabled = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
          [id, req.body.telegram_enabled]);
        if (!rows[0]) return res.status(404).json({ error: 'not found' });
        return res.json(rows[0]);
      } catch (e) { return routeError(res, e, 'PATCH /api/line/commands (telegram toggle)'); }
    }
    const v = validateBody(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    try {
      const { rows } = await pool.query(`
        UPDATE line_commands SET
          key = $2, label = $3, enabled = $4, source_key = $5, action_key = $14,
          triggers = $6::jsonb, require_all = $7::jsonb, exclude = $8::jsonb,
          fixed_params = $9::jsonb, slots = $10::jsonb, required_slots = $11::jsonb,
          reply_title = $12, cooldown_sec = $13, example = $15, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
        [id, v.key, v.label, v.enabled, v.source_key, JSON.stringify(v.triggers),
         JSON.stringify(v.require_all), JSON.stringify(v.exclude), JSON.stringify(v.fixed_params),
         JSON.stringify(v.slots), JSON.stringify(v.required_slots), v.reply_title, v.cooldown_sec,
         v.action_key, v.example]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      await auth.logAudit(req.user?.id, req.user?.username, 'line_command_update', null, null,
        null, null, { key: v.key });
      res.json(rows[0]);
    } catch (e) { routeError(res, e, 'PATCH /api/line/commands'); }
  });

  app.delete('/api/line/commands/:id', auth.requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query('DELETE FROM line_commands WHERE id = $1 RETURNING key', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      await auth.logAudit(req.user?.id, req.user?.username, 'line_command_delete', null, null,
        null, null, { key: rows[0].key });
      res.json({ ok: true });
    } catch (e) { routeError(res, e, 'DELETE /api/line/commands'); }
  });

  // ── ผู้มีสิทธิ์สั่ง ─────────────────────────────────────────
  app.get('/api/line/operators', auth.requireAdminOrAuditor, async (_req, res) => {
    try {
      // telegram_link_code/telegram_link_expires ไม่ส่งออก — เป็น hash+อายุของรหัสผูก
      // ชั่วคราว ไม่มีประโยชน์ต่อหน้าจอ และไม่ควรมีทางรั่วออกไปโดยไม่จำเป็น
      // telegram_display_name: ไม่มีคอลัมน์เก็บ @username ตรงๆ (ไม่ยิง getChat ออกเน็ตตอน
      // โหลดหน้า) ⇒ อาศัย telegram_pending.title ที่บันทึกไว้แล้วตอนผู้สั่งทัก /start บอท
      // เป็นการส่วนตัว (chat_id ของแชทส่วนตัว = telegram_user_id คนนั้นเป๊ะ) — ไม่เจอ = NULL
      const { rows } = await pool.query(`
        SELECT o.line_user_id, o.display_name, o.user_id, o.enabled, o.allow_in,
               o.telegram_allow_in, o.note,
               o.added_by, o.created_at, o.last_used_at, o.telegram_user_id,
               tp.title AS telegram_display_name,
               u.username, u.role, u.full_name, u.enabled AS user_enabled
          FROM line_operators o
          LEFT JOIN users u ON u.id = o.user_id
          LEFT JOIN telegram_pending tp ON tp.chat_id = o.telegram_user_id
         ORDER BY o.created_at DESC`);
      res.json(rows);
    } catch (e) { routeError(res, e, 'GET /api/line/operators'); }
  });

  app.post('/api/line/operators', auth.requireAdmin, async (req, res) => {
    const lineUserId = String(req.body?.line_user_id || '').trim();
    const userId = parseInt(req.body?.user_id, 10);
    // รูปแบบจริงของ LINE เท่านั้น — เดิมมีทางลัดให้ id ที่ขึ้นต้นด้วย "Utest" ผ่านได้
    // ซึ่งใส่ไว้ตอนทดสอบ ไม่ควรติดไปกับของจริง (ถอดออก 2026-09-08)
    if (!/^U[0-9a-f]{32}$/i.test(lineUserId)) {
      return res.status(400).json({ error: 'line_user_id ต้องเป็นรูป U ตามด้วยตัวอักษร/ตัวเลข 32 ตัว' });
    }
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'ต้องเลือกบัญชีที่ให้ยืมสิทธิ์' });
    try {
      const { rows } = await pool.query(`
        INSERT INTO line_operators (line_user_id, display_name, user_id, enabled, allow_in, note, added_by)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
        ON CONFLICT (line_user_id) DO UPDATE SET
          display_name = EXCLUDED.display_name, user_id = EXCLUDED.user_id,
          enabled = EXCLUDED.enabled, allow_in = EXCLUDED.allow_in, note = EXCLUDED.note
        RETURNING *`,
        [lineUserId, req.body?.display_name || null, userId, req.body?.enabled !== false,
         Array.isArray(req.body?.allow_in) && req.body.allow_in.length
           ? JSON.stringify(req.body.allow_in) : null,
         req.body?.note || null, req.user?.id || null]);
      await auth.logAudit(req.user?.id, req.user?.username, 'line_operator_grant', userId, null,
        null, null, { line_user_id: lineUserId.slice(0, 8) + '…' });
      res.status(201).json(rows[0]);
    } catch (e) { routeError(res, e, 'POST /api/line/operators'); }
  });

  app.patch('/api/line/operators/:id', auth.requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE line_operators SET enabled = COALESCE($2, enabled), note = COALESCE($3, note)
          WHERE line_user_id = $1 RETURNING *`,
        [req.params.id, typeof req.body?.enabled === 'boolean' ? req.body.enabled : null,
         req.body?.note ?? null]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      res.json(rows[0]);
    } catch (e) { routeError(res, e, 'PATCH /api/line/operators'); }
  });

  app.delete('/api/line/operators/:id', auth.requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        'DELETE FROM line_operators WHERE line_user_id = $1 RETURNING line_user_id', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      await auth.logAudit(req.user?.id, req.user?.username, 'line_operator_revoke', null, null,
        null, null, { line_user_id: String(req.params.id).slice(0, 8) + '…' });
      res.json({ ok: true });
    } catch (e) { routeError(res, e, 'DELETE /api/line/operators'); }
  });

  // ── ผูก/ยกเลิกผูก Telegram (T4) ──────────────────────────────
  // ออกรหัส 6 หลัก อายุ 10 นาที — ผู้สั่งพิมพ์ "/link <รหัส>" ทักบอทเป็นการส่วนตัว
  // เอง (telegramPoller.js เป็นคนตรวจ/ผูกจริง) ไม่ให้พิมพ์ telegram_user_id เอง
  // เพราะเป็นตัวเลขที่คัดลอกผิดง่ายและเดา/สวมรอยผู้สั่งคนอื่นได้ถ้าปล่อยให้กรอกตรง ๆ
  app.post('/api/line/operators/:id/telegram-link', auth.requireAdmin, async (req, res) => {
    try {
      const code = genLinkCode();
      const { rows } = await pool.query(
        `UPDATE line_operators SET telegram_link_code = $2, telegram_link_expires = NOW() + interval '10 minutes'
          WHERE line_user_id = $1 RETURNING line_user_id`,
        [req.params.id, hashLinkCode(code)]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      await auth.logAudit(req.user?.id, req.user?.username, 'line_operator_telegram_link_code', null, null,
        null, null, { line_user_id: String(req.params.id).slice(0, 8) + '…' });
      res.json({ code, expires_in_sec: 600 });
    } catch (e) { routeError(res, e, 'POST /api/line/operators/:id/telegram-link'); }
  });

  app.delete('/api/line/operators/:id/telegram-link', auth.requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE line_operators
            SET telegram_user_id = NULL, telegram_link_code = NULL, telegram_link_expires = NULL
          WHERE line_user_id = $1 RETURNING line_user_id`,
        [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      await auth.logAudit(req.user?.id, req.user?.username, 'line_operator_telegram_unlink', null, null,
        null, null, { line_user_id: String(req.params.id).slice(0, 8) + '…' });
      res.json({ ok: true });
    } catch (e) { routeError(res, e, 'DELETE /api/line/operators/:id/telegram-link'); }
  });

  // ── ห้อง Telegram ที่ผู้สั่งคนนี้สั่งได้ (migration 244) ─────────
  // คนละคอลัมน์กับ allow_in ของ LINE — ตรวจว่าทุก id เป็นแชทที่อนุมัติ+เปิดใช้แล้วใน
  // telegram_config.chats หรือเป็นแชทส่วนตัวของผู้สั่งคนนี้เอง (tg:<telegram_user_id>)
  // ก่อนบันทึก ไม่งั้นแอดมินพิมพ์ chat id ผิดแล้วผู้สั่งจะไม่มีทางสั่งได้เลยโดยไม่รู้ตัว
  app.put('/api/line/operators/:id/telegram-allow-in', auth.requireAdmin, async (req, res) => {
    try {
      const list = _arr(req.body?.telegram_allow_in);
      const { rows: opRows } = await pool.query(
        'SELECT line_user_id, telegram_user_id FROM line_operators WHERE line_user_id = $1', [req.params.id]);
      if (!opRows[0]) return res.status(404).json({ error: 'not found' });
      const ownPrivate = opRows[0].telegram_user_id ? `tg:${opRows[0].telegram_user_id}` : null;
      const { rows: cfgRows } = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
      const approved = new Set(
        (Array.isArray(cfgRows[0]?.chats) ? cfgRows[0].chats : [])
          .filter((c) => c && c.enabled !== false)
          .map((c) => `tg:${c.chat_id}`));
      const bad = list.filter((id) => !/^tg:-?\d+$/.test(id) || (id !== ownPrivate && !approved.has(id)));
      if (bad.length) {
        return res.status(400).json({ error: `ไม่ใช่ห้อง Telegram ที่อนุมัติ/เปิดใช้แล้ว: ${bad.join(', ')}` });
      }
      const { rows } = await pool.query(
        `UPDATE line_operators SET telegram_allow_in = $2::jsonb WHERE line_user_id = $1 RETURNING *`,
        [req.params.id, list.length ? JSON.stringify(list) : null]);
      await auth.logAudit(req.user?.id, req.user?.username, 'line_operator_telegram_allow_in', null, null,
        null, null, { line_user_id: String(req.params.id).slice(0, 8) + '…', rooms: list.length });
      res.json(rows[0]);
    } catch (e) { routeError(res, e, 'PUT /api/line/operators/:id/telegram-allow-in'); }
  });

  // ── คนที่ระบบ "รู้จัก" แล้ว — ไว้ให้เลือกแทนการพิมพ์ id เอง ────
  // LINE user id เป็นสตริง 33 ตัวที่คนคัดลอกผิดได้ง่ายมาก และไม่มีทางรู้ว่าพิมพ์ถูกไหม
  // จนกว่าจะลองสั่งแล้วเงียบ · ระบบรู้จักคนสองกลุ่มอยู่แล้ว จึงเอามาให้เลือก:
  //   1. คนที่เคยทักบอท (pending_recipients — เฉพาะแถวที่ id ขึ้นต้นด้วย U = คน ไม่ใช่กลุ่ม)
  //   2. คนที่เคยพิมพ์ในกลุ่มที่บอทอยู่ (line_command_log) — กลุ่มนี้สำคัญกว่า เพราะคนที่
  //      จะสั่งงานคือคนที่อยู่ในกลุ่มอยู่แล้ว ซึ่งอาจไม่เคยแอดบอทเป็นเพื่อนเลย
  // คนที่เป็นผู้สั่งอยู่แล้วถูกตัดออก — ไม่มีประโยชน์ให้เลือกซ้ำ
  app.get('/api/line/known-senders', auth.requireAdminOrAuditor, async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        WITH seen AS (
          SELECT line_user_id AS line_id, max(at) AS last_at, count(*)::int AS n,
                 (array_agg(source_id ORDER BY at DESC))[1] AS room
            FROM line_command_log
           WHERE line_user_id LIKE 'U%' AND at > NOW() - interval '90 days'
           GROUP BY 1
        )
        SELECT COALESCE(p.line_id, s.line_id)        AS line_user_id,
               p.display_name,
               p.status,
               s.room,
               COALESCE(s.n, 0)                      AS seen_count,
               GREATEST(COALESCE(s.last_at, 'epoch'::timestamptz),
                        COALESCE(p.last_message_at, 'epoch'::timestamptz)) AS last_seen
          FROM pending_recipients p
          FULL JOIN seen s ON s.line_id = p.line_id
         WHERE COALESCE(p.line_id, s.line_id) LIKE 'U%'
           AND COALESCE(p.line_id, s.line_id) NOT IN (SELECT line_user_id FROM line_operators)
         ORDER BY seen_count DESC, last_seen DESC
         LIMIT 60`);
      // เติมชื่อให้คนที่ยังไม่รู้จัก — ถามโปรไฟล์ "สมาชิกในกลุ่ม" จาก LINE
      // จำกัด 8 คนต่อครั้ง เพราะเป็นการยิงออกเน็ตทีละคน และหน้านี้เปิดไม่บ่อย
      // ล้มก็ไม่เป็นไร ปล่อยชื่อว่างไว้ ดีกว่าทำให้ทั้งรายการโหลดไม่ขึ้น
      const cfg = (await pool.query('SELECT channel_access_token FROM line_config WHERE id = 1')).rows[0];
      if (cfg?.channel_access_token) {
        const need = rows.filter((r) => !r.display_name && r.room && String(r.room).startsWith('C')).slice(0, 8);
        for (const r of need) {
          try {
            const p = await lineSender.getLineGroupMemberProfile(cfg.channel_access_token, r.room, r.line_user_id);
            if (p?.displayName) r.display_name = p.displayName;
          } catch { /* ไม่รู้ชื่อก็ยังเลือกได้จากจำนวนครั้งที่พิมพ์ */ }
        }
      }
      res.json(rows.map(({ room, ...rest }) => rest));
    } catch (e) { routeError(res, e, 'GET /api/line/known-senders'); }
  });

  // ── ปูมการใช้งาน ───────────────────────────────────────────
  // ?source_type=telegram = เฉพาะปูมฝั่ง Telegram (หน้า "คำสั่งผ่าน Telegram")
  app.get('/api/line/command-log', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
      const status = req.query.status ? String(req.query.status) : null;
      const srcType = req.query.source_type ? String(req.query.source_type) : null;
      const conds = [];
      const params = [];
      if (status) { conds.push(`status = $${params.length + 1}`); params.push(status); }
      if (srcType) { conds.push(`source_type = $${params.length + 1}`); params.push(srcType); }
      params.push(limit);
      const { rows } = await pool.query(`
        SELECT id, at, operator_name, source_type, text_in, matched_key, status,
               http_status, rows_out, ms, error
          FROM line_command_log
         WHERE at > NOW() - interval '30 days' ${conds.length ? 'AND ' + conds.join(' AND ') : ''}
         ORDER BY id DESC LIMIT $${params.length}`, params);
      res.json(rows);
    } catch (e) { routeError(res, e, 'GET /api/line/command-log'); }
  });

  // ── ทดลองสั่ง (ไม่ส่ง LINE จริง) ─────────────────────────────
  // ตัวเดียวกับที่ webhook เรียกทุกประการ ต่างแค่ไม่ส่งข้อความออกไป — ถ้าเขียนตัวจำลอง
  // แยกอีกตัว วันหนึ่งมันจะให้ผลไม่ตรงกับของจริงแล้วไม่มีใครรู้
  app.post('/api/line/commands/test', auth.requireAdmin, async (req, res) => {
    try {
      const { handleLineText } = require('../helpers/lineCommandRun');
      const env = require('../config');
      const text = String(req.body?.text || '');
      const asUser = parseInt(req.body?.user_id, 10) || req.user?.id;
      if (!text.trim()) return res.status(400).json({ error: 'ต้องมีข้อความ' });

      // 🔴 ห้ามสร้างแถวใน line_operators เพื่อทดลอง — เดิมทำแบบนั้นแล้วมันค้างอยู่ใน
      // ตาราง "ผู้มีสิทธิ์สั่ง" ถาวรทุกครั้งที่มีคนกดปุ่มทดลอง (แก้ 2026-09-08)
      // ⇒ ฉีดตัวผู้สั่งเข้าไปตรง ๆ แทน · สิทธิ์ยังยึดตามบัญชีที่เลือกเหมือนของจริงทุกประการ
      const { rows: ur } = await pool.query(
        'SELECT id, username, role, enabled FROM users WHERE id = $1', [asUser]);
      if (!ur[0] || ur[0].enabled === false) {
        return res.status(400).json({ error: 'บัญชีที่เลือกใช้ไม่ได้' });
      }
      const probe = {
        line_user_id: `ui:${req.user?.username || 'admin'}`,   // ให้ปูมบอกได้ว่ามาจากหน้าตั้งค่า
        display_name: `ทดลองจากหน้าตั้งค่า (${ur[0].username})`,
        user_id: ur[0].id, role: ur[0].role, enabled: true, allow_in: null,
      };
      const r = await handleLineText(
        { pool, auth, baseUrl: `http://127.0.0.1:${env.int('API_PORT')}` },
        { text, lineUserId: probe.line_user_id, sourceType: 'user',
          sourceId: `test-ui-${req.user?.id || 0}`, op: probe });
      res.json(r);
    } catch (e) { routeError(res, e, 'POST /api/line/commands/test'); }
  });

  // ── ไซต์ที่บัญชีหนึ่งถามได้ (ไว้โชว์ในฟอร์มว่าผู้สั่งคนนี้จะเห็นอะไร) ──
  app.get('/api/line/operator-scope/:userId', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT id, role FROM users WHERE id = $1', [req.params.userId]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      const sites = await sitesForUser(pool, auth, rows[0]);
      res.json({ role: rows[0].role, sites: sites.map((s) => ({ code: s.code, label: siteLabel(s) })) });
    } catch (e) { routeError(res, e, 'GET /api/line/operator-scope'); }
  });
};
