// ============================================================
// Vigil Platform — Telegram Config + Pending Chats routes
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ที่มา: docs/reports/2026-09-24_telegram-plan.md (phase T1) — คู่กับ routes/line.js
// (line_config / pending_recipients) แต่แยกไฟล์เพราะ chat_id เป็น bigint คนละรูปร่าง
// กับ LINE user/group id (text) และ token เข้ารหัสด้วยคนละ helper (encryptPii ของ
// blacklist-crypto ตามที่ตกลงไว้ใน T1 spec)
//
// 🔒 token ไม่เคยถูกส่งกลับใน response ไหนเลย — GET คืนแค่ has_token: boolean
// factory: telegramRoutes(app, pool, { auth, getIP, routeError })
'use strict';

const QRCode = require('qrcode');
const { encryptPii, decryptPii } = require('../helpers/blacklist-crypto');
const telegramSender = require('../helpers/telegramSender');
const telegramPoller = require('../helpers/telegramPoller');

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{30,}$/;
const CHAT_ID_RE = /^-?\d+$/;

// migration 245 เพิ่ม bot_name ทีหลัง bot_token_enc — แถวที่ตั้ง token ไว้ก่อนหน้านั้น
// ไม่มี bot_name เก็บไว้เลย ⇒ backfill แบบ lazy ตอน GET ครั้งแรกของ process นี้
// (getMe เป็น read-only ปลอดภัยที่จะเรียกจาก GET, แต่ห้ามยิงซ้ำทุก request — flag
// นี้กันไม่ให้ token ที่ผิด/เน็ตล่มทำให้ทุกการเปิดหน้าตั้งค่าช้าลง)
let _botNameBackfillAttempted = false;

// ── ความล้มเหลวล่าสุดฝั่ง Telegram (ไว้โชว์คู่กับสถานะ poller บนแผง Telegram
// Config — เทียบเคียง "LINE ปฏิเสธการส่งถึง … 13:26" ของฝั่ง LINE) ──────────
// bound ด้วย "200 แถวล่าสุด" ไม่ใช่ full scan/ILIKE ข้ามตาราง (ต่างจาก findLimitHit
// ของ LINE ที่ scan ทั้งเดือนด้วย sent_at — alert_logs ไม่มี index บน recipients_json
// เลย การกรองด้วย jsonb ในเงื่อนไข WHERE จะ sequential scan ทั้งช่วงนั้น)
async function _findTelegramLastFailure(pool) {
  try {
    // ขอบเขต 24 ชม. + กรอง jsonb ต้องอยู่ "นอก" subquery — ถ้าใส่ไว้ข้างในด้วยกันกับ
    // ORDER BY id DESC LIMIT 200 planner จะเลือก Index Scan Backward + Filter ซึ่ง
    // ต้องไล่ตรวจ sent_at ของทุกแถวที่สแกนผ่านก่อนจะครบ 200 แถวที่ผ่านเงื่อนไข —
    // ช่วงที่เงียบ (ปกติ, แถว telegram ล้มเหลวน้อยกว่า 200) เท่ากับ full scan ทั้งตาราง
    // ⇒ subquery ต้องเป็น "ORDER BY id DESC LIMIT 200" เปล่าๆ (Limit ล้วน ไม่มี Filter)
    // แล้วค่อยกรอง 24 ชม./jsonb ทับบน 200 แถวนั้นทีหลัง
    const { rows } = await pool.query(
      `SELECT id, sent_at, recipients_json FROM (
         SELECT id, sent_at, recipients_json FROM alert_logs
          ORDER BY id DESC LIMIT 200
       ) recent
       WHERE sent_at >= NOW() - interval '24 hours'
         AND jsonb_typeof(recipients_json) = 'array'
       ORDER BY id DESC`);
    for (const row of rows) {   // แถวมาเรียง id DESC อยู่แล้ว = ใหม่สุดก่อน
      const items = Array.isArray(row.recipients_json) ? row.recipients_json : [];
      const bad = items.find((r) => r && r.channel === 'telegram' && r.ok === false);
      if (bad) return { at: row.sent_at, name: bad.name || null, error: bad.error || null };
    }
    return null;
  } catch (e) {
    console.warn('[telegram-config] หา last_failure ไม่สำเร็จ:', e.message);
    return null;
  }
}

module.exports = function telegramRoutes(app, pool, { auth, getIP, routeError }) {
  // ── GET config (ไม่เคยคืน token จริง) ──────────────────────
  app.get('/api/telegram-config', auth.requireAdminOrAuditor, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT enabled, bot_username, bot_name, bot_token_enc, chats FROM telegram_config WHERE id = 1');
      const cfg = rows[0] || { enabled: false, bot_username: null, bot_name: null, bot_token_enc: null, chats: [] };

      // backfill ชื่อบอทครั้งเดียวต่อ process — ตั้งค่า flag ก่อน await เสมอ กัน
      // request คู่ขนานยิง getMe ซ้ำกันระหว่างรอผลรอบแรก
      let botName = cfg.bot_name || null;
      if (!botName && cfg.bot_token_enc && !_botNameBackfillAttempted) {
        _botNameBackfillAttempted = true;
        try {
          const token = decryptPii(cfg.bot_token_enc);
          const me = await telegramSender.getMe(token);
          if (me.success && me.result?.first_name) {
            botName = me.result.first_name;
            await pool.query('UPDATE telegram_config SET bot_name = $1 WHERE id = 1', [botName]);
          }
        } catch (e) {
          console.warn('[telegram-config] backfill bot_name ไม่สำเร็จ (จะไม่ลองซ้ำจนกว่า process จะ restart):', e.message);
        }
      }

      const lastFailure = await _findTelegramLastFailure(pool);
      res.json({
        enabled: !!cfg.enabled,
        bot_username: cfg.bot_username || null,
        bot_name: botName,
        has_token: !!cfg.bot_token_enc,
        chats: Array.isArray(cfg.chats) ? cfg.chats : [],
        poller: {
          running: telegramPoller.state.running,
          last_ok_at: telegramPoller.state.last_ok_at,
          last_error: telegramPoller.state.last_error,
          conflict: telegramPoller.state.conflict,
        },
        last_failure: lastFailure,
      });
    } catch (e) { routeError(res, e, 'GET /api/telegram-config'); }
  });

  // QR code + t.me link ไว้บนแผง "วิธีเพิ่มบอท" (เทียบเคียง GET /api/line-config/qr)
  app.get('/api/telegram-config/qr', auth.requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query('SELECT bot_username FROM telegram_config WHERE id = 1');
      const username = rows[0]?.bot_username?.trim();
      if (!username) return res.status(404).json({ error: 'bot_username ยังไม่ได้ตั้งค่า' });
      const url = `https://t.me/${encodeURIComponent(username)}`;
      const png = await QRCode.toBuffer(url, { type: 'png', width: 200, margin: 2 });
      res.set('Content-Type', 'image/png').send(png);
    } catch (e) { routeError(res, e, 'GET /api/telegram-config/qr'); }
  });

  // ── PUT config — token: validate format → getMe จริง → ค่อยเข้ารหัสเก็บ ──
  app.put('/api/telegram-config', auth.requireAdmin, async (req, res) => {
    try {
      const { enabled, bot_token, chats } = req.body || {};
      let tokenEnc, botUsername, botName;

      if (bot_token !== undefined && bot_token !== null && String(bot_token).trim() !== '') {
        const token = String(bot_token).trim();
        if (!TOKEN_RE.test(token)) {
          return res.status(400).json({ error: 'รูปแบบ bot token ไม่ถูกต้อง (ต้องเป็น <digits>:<35+ ตัวอักษร>)' });
        }
        const me = await telegramSender.getMe(token);
        if (!me.success) {
          return res.status(400).json({ error: `เชื่อมต่อบอทด้วย token นี้ไม่สำเร็จ: ${me.error || 'ไม่ทราบสาเหตุ'}` });
        }
        try {
          tokenEnc = encryptPii(token);
        } catch {
          return res.status(400).json({ error: 'ระบบเข้ารหัสยังไม่พร้อม (ไม่มีกุญแจเข้ารหัส) — ไม่ได้บันทึกค่าใด ๆ' });
        }
        botUsername = me.result?.username || null;
        botName = me.result?.first_name || null;
      }

      let cleanChats, removedIds = [];
      if (chats !== undefined) {
        if (!Array.isArray(chats)) return res.status(400).json({ error: 'chats ต้องเป็น array' });
        const { rows: approvedRows } = await pool.query(
          `SELECT chat_id FROM telegram_pending WHERE status = 'approved'`);
        const approvedIds = new Set(approvedRows.map((r) => String(r.chat_id)));
        // T3: mirror_of_line_id ต้องชี้ไปยังผู้รับ LINE ที่มีอยู่จริง (หรือ null = ไม่ผูก)
        // — กัน id พิมพ์ผิด/ผู้รับที่ถูกลบไปแล้วค้างอยู่เงียบ ๆ จนกลายเป็น mirror
        // ที่ไม่มีวัน resolve ได้จริงตอนสลับช่องทาง (notifier.pickFallbackChats)
        const { rows: lineRows } = await pool.query('SELECT recipients FROM line_config WHERE id = 1');
        const lineRecipientIds = new Set((lineRows[0]?.recipients || []).map((r) => String(r?.id)).filter(Boolean));
        cleanChats = [];
        for (const c of chats) {
          const chatId = String(c?.chat_id ?? '').trim();
          if (!CHAT_ID_RE.test(chatId)) {
            return res.status(400).json({ error: `chat_id ไม่ถูกต้อง: ${chatId || '(ว่าง)'}` });
          }
          if (!approvedIds.has(chatId)) {
            return res.status(400).json({ error: `chat_id ยังไม่ได้รับการอนุมัติ: ${chatId}` });
          }
          const mirrorOf = c.mirror_of_line_id != null ? String(c.mirror_of_line_id) : null;
          if (mirrorOf !== null && !lineRecipientIds.has(mirrorOf)) {
            return res.status(400).json({ error: `mirror_of_line_id ไม่รู้จัก (ไม่ใช่ผู้รับ LINE ที่มีอยู่): ${mirrorOf}` });
          }
          cleanChats.push({
            chat_id: chatId,
            name: String(c.name || chatId).slice(0, 200),
            type: typeof c.type === 'string' ? c.type : null,
            enabled: c.enabled !== false,
            lpr_enabled: c.lpr_enabled !== false,
            lpr_sites: Array.isArray(c.lpr_sites) ? c.lpr_sites.filter((s) => typeof s === 'string') : [],
            lpr_groups: Array.isArray(c.lpr_groups)
              ? c.lpr_groups.filter((g) => typeof g === 'string' || typeof g === 'number') : [],
            mirror_of_line_id: mirrorOf,
          });
        }
        const prevRes = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
        const prevIds = new Set((prevRes.rows[0]?.chats || []).map((c) => String(c?.chat_id)).filter(Boolean));
        const newIds = new Set(cleanChats.map((c) => c.chat_id));
        removedIds = [...prevIds].filter((id) => !newIds.has(id));
      }

      const updates = [];
      const values = [];
      let idx = 1;
      if (enabled !== undefined) { updates.push(`enabled = $${idx++}`); values.push(!!enabled); }
      if (tokenEnc !== undefined) {
        updates.push(`bot_token_enc = $${idx++}`); values.push(tokenEnc);
        updates.push(`bot_username = $${idx++}`); values.push(botUsername);
        updates.push(`bot_name = $${idx++}`); values.push(botName);
        // update_id ของ getUpdates ผูกกับตัวบอท — เปลี่ยนบอทแล้วเดิน offset เดิมต่อ
        // จะข้ามข้อความทั้งหมดของบอทใหม่ไปเงียบๆ (ไม่มีใครเห็นว่าทำไมกดเข้ากลุ่ม
        // แล้วไม่มีอะไรขึ้นในรออนุมัติ) — 0 = อ่านย้อน 24 ชม.แรกของบอทใหม่ ซึ่ง
        // idempotent อยู่แล้วจาก ON CONFLICT ของ _upsertPending
        updates.push(`poll_offset = 0`);
      }
      if (cleanChats !== undefined) { updates.push(`chats = $${idx++}::jsonb`); values.push(JSON.stringify(cleanChats)); }
      if (!updates.length) return res.json({ success: true, message: 'No changes' });
      updates.push('updated_at = NOW()');
      await pool.query(`UPDATE telegram_config SET ${updates.join(', ')} WHERE id = 1`, values);

      // แชทที่ถูกถอดออกจาก chats ต้อง reset เป็น 'ignored' ไม่งั้นค้างสถานะ
      // 'approved' ทั้งที่หายไปจากรายการแล้ว — จะ approve ซ้ำไม่ได้อีกเลย
      // (เหมือน removedIds ของ routes/line.js PUT /api/line-config)
      if (removedIds.length) {
        await pool.query(
          `UPDATE telegram_pending SET status = 'ignored' WHERE chat_id = ANY($1::bigint[]) AND status = 'approved'`,
          [removedIds]
        );
      }

      await auth.logAudit(req.user?.id, req.user?.username, 'telegram_config_update', null, null,
        getIP(req), req.headers['user-agent'],
        { enabled: enabled !== undefined ? !!enabled : undefined, bot_username: botUsername,
          chats_count: cleanChats ? cleanChats.length : undefined, token_changed: tokenEnc !== undefined });

      res.json({ success: true });
    } catch (e) { routeError(res, e, 'PUT /api/telegram-config'); }
  });

  // ── Test connection: getMe + (optional) ส่งข้อความทดสอบ ────
  app.post('/api/telegram-config/test', auth.requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT bot_token_enc, chats FROM telegram_config WHERE id = 1');
      const enc = rows[0]?.bot_token_enc;
      if (!enc) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า bot token' });
      let token;
      try { token = decryptPii(enc); }
      catch { return res.status(500).json({ error: 'ถอดรหัส token ไม่สำเร็จ' }); }

      const me = await telegramSender.getMe(token);
      if (!me.success) return res.json({ success: false, error: me.error, step: 'getMe' });

      const chatId = req.body?.chat_id != null ? String(req.body.chat_id).trim() : '';
      if (!chatId) return res.json({ success: true, bot_username: me.result?.username || null });
      if (!CHAT_ID_RE.test(chatId)) return res.status(400).json({ error: 'chat_id ไม่ถูกต้อง' });
      // ยิงได้เฉพาะแชทที่อนุมัติแล้วเท่านั้น — กันแอบทดสอบยิงเข้าแชทที่ยังไม่ผ่าน
      // ขั้นตอนอนุมัติ (PDPA — ดู docs/reports/2026-09-24_telegram-plan.md ความเสี่ยง)
      const chats = Array.isArray(rows[0]?.chats) ? rows[0].chats : [];
      if (!chats.some((c) => String(c.chat_id) === chatId)) {
        return res.status(400).json({ error: 'chat_id นี้ยังไม่ได้อนุมัติเป็นช่องทาง' });
      }

      const sendRes = await telegramSender.sendMessage(token, chatId,
        telegramSender.escapeHtml('นี่คือข้อความทดสอบจากระบบ Vigil Platform') + '\n<i>(Test message)</i>');
      res.json({ success: sendRes.success, error: sendRes.error, bot_username: me.result?.username || null });
    } catch (e) { routeError(res, e, 'POST /api/telegram-config/test'); }
  });

  // ── Pending chats ────────────────────────────────────────────
  app.get('/api/telegram/pending', auth.requireAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT chat_id, title, type, first_seen, last_seen, status
        FROM telegram_pending WHERE status = 'pending'
        ORDER BY last_seen DESC LIMIT 100
      `);
      res.json(rows.map((r) => ({ ...r, chat_id: String(r.chat_id) })));
    } catch (e) { routeError(res, e, 'GET /api/telegram/pending'); }
  });

  app.post('/api/telegram/pending/:chatId/approve', auth.requireAdmin, async (req, res) => {
    const chatId = String(req.params.chatId || '').trim();
    if (!CHAT_ID_RE.test(chatId)) return res.status(400).json({ error: 'chat_id ไม่ถูกต้อง' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pendingRes = await client.query(`SELECT * FROM telegram_pending WHERE chat_id = $1 FOR UPDATE`, [chatId]);
      if (!pendingRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'ไม่พบรายการนี้' });
      }
      const p = pendingRes.rows[0];
      const cfgRes = await client.query('SELECT chats FROM telegram_config WHERE id = 1 FOR UPDATE');
      const chats = Array.isArray(cfgRes.rows[0]?.chats) ? cfgRes.rows[0].chats : [];
      const name = String(req.body?.name || p.title || chatId).trim();
      const exists = chats.some((c) => String(c.chat_id) === chatId);
      const nextChats = exists
        ? chats.map((c) => String(c.chat_id) === chatId ? { ...c, name, type: p.type, enabled: c.enabled !== false } : c)
        : chats.concat([{
            chat_id: chatId, name, type: p.type, enabled: true, lpr_enabled: true,
            lpr_sites: [], lpr_groups: [], mirror_of_line_id: null,
          }]);
      await client.query(`UPDATE telegram_config SET chats = $1::jsonb, updated_at = NOW() WHERE id = 1`, [JSON.stringify(nextChats)]);
      await client.query(`UPDATE telegram_pending SET status = 'approved', title = $2 WHERE chat_id = $1`, [chatId, name]);
      await client.query('COMMIT');
      await auth.logAudit(req.user?.id, req.user?.username, 'telegram_chat_approve', null, null,
        getIP(req), req.headers['user-agent'], { chat_id: chatId, type: p.type, title: name, existing: exists });
      res.json({ success: true, chat: { chat_id: chatId, name, type: p.type, enabled: true } });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      routeError(res, e, 'POST /api/telegram/pending/:chatId/approve');
    } finally {
      client.release();
    }
  });

  app.post('/api/telegram/pending/:chatId/ignore', auth.requireAdmin, async (req, res) => {
    try {
      const chatId = String(req.params.chatId || '').trim();
      if (!CHAT_ID_RE.test(chatId)) return res.status(400).json({ error: 'chat_id ไม่ถูกต้อง' });
      const { rows } = await pool.query(
        `UPDATE telegram_pending SET status = 'ignored'
         WHERE chat_id = $1 AND status = 'pending'
         RETURNING chat_id, title, type`, [chatId]);
      if (!rows.length) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
      await auth.logAudit(req.user?.id, req.user?.username, 'telegram_chat_ignore', null, null,
        getIP(req), req.headers['user-agent'], rows[0]);
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'POST /api/telegram/pending/:chatId/ignore'); }
  });

  app.post('/api/telegram/pending/:chatId/block', auth.requireAdmin, async (req, res) => {
    try {
      const chatId = String(req.params.chatId || '').trim();
      if (!CHAT_ID_RE.test(chatId)) return res.status(400).json({ error: 'chat_id ไม่ถูกต้อง' });
      const { rows } = await pool.query(
        `UPDATE telegram_pending SET status = 'blocked'
         WHERE chat_id = $1 AND status IN ('pending', 'ignored')
         RETURNING chat_id, title, type`, [chatId]);
      if (!rows.length) return res.status(404).json({ error: 'ไม่พบรายการนี้ หรืออนุมัติอยู่แล้ว (ถอดออกจากรายการอนุมัติก่อน)' });
      await auth.logAudit(req.user?.id, req.user?.username, 'telegram_chat_block', null, null,
        getIP(req), req.headers['user-agent'], rows[0]);
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'POST /api/telegram/pending/:chatId/block'); }
  });
};

// เทสต์เท่านั้น — module-level flag กัน getMe ซ้ำทุก request ของ process จริง แต่
// ต้อง reset ได้ระหว่างเทสต์เพื่อยืนยันพฤติกรรม "ลองครั้งแรกแล้วไม่ลองซ้ำอีก" ตรงๆ
module.exports._resetBotNameBackfillFlag = () => { _botNameBackfillAttempted = false; };
