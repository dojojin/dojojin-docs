// ============================================================
// Vigil Platform — LINE Config + Webhook routes
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @version   1.0.0
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary — Unauthorized copying, distribution, or use
//            of this file is strictly prohibited.
// ============================================================

'use strict';

const crypto     = require('crypto');
const lineSender = require('../line-sender');
const QRCode     = require('qrcode');

// ============================================================
// LINE Config + Webhook (12 routes)
// factory: lineRoutes(app, pool, { auth, getIP, routeError })
// ============================================================
const { handleLineText, loadOperator } = require('../helpers/lineCommandRun');
const env = require('../config');   // config export ฟังก์ชันตรง ๆ ไม่ได้ห่อใน { env }
const {
  monthStartBkkUtc, readAlertSettings, findLimitHit,
} = require('../helpers/lineQuotaWatch');

// T3: นับแถวใน recipients_json ที่มี fallback:true และ ok:true ตั้งแต่ต้นเดือน (Bangkok)
// — jsonb_array_elements ใช้ได้เฉพาะแถวที่ recipients_json ไม่ใช่ NULL (implicit join)
async function _countFallbackThisMonth(pool, monthStart) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n
         FROM alert_logs al, jsonb_array_elements(al.recipients_json) AS elem
        WHERE al.sent_at >= $1
          AND jsonb_typeof(al.recipients_json) = 'array'
          AND (elem->>'fallback') = 'true'
          AND (elem->>'ok') = 'true'`, [monthStart]);
    return parseInt(rows[0]?.n, 10) || 0;
  } catch (e) { console.warn('[line-config] นับจำนวนสลับไป Telegram ไม่สำเร็จ:', e.message); return 0; }
}

module.exports = function lineRoutes(app, pool, { auth, getIP, routeError }) {
  // คำสั่งยิง endpoint ของตัวเองผ่าน loopback — ไม่ออกเน็ต ไม่ผ่าน Cloudflare
  const SELF_BASE = `http://127.0.0.1:${env.int('API_PORT')}`;

  // ── LINE Config (CRUD) ──────────────────────────────────────
  app.get('/api/line-config', auth.requireAdminAuditorOrSiteAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM line_config WHERE id = 1');
      const cfg = rows[0] || { id: 1, channel_access_token: null, recipients: [], enabled: false };
      // Edge sites the offline-alert can toggle = whatever actually sends heartbeats.
      const siteRows = (await pool.query(
        `SELECT es.site_id, COALESCE(s.name, es.site_id) AS name
           FROM edge_status es LEFT JOIN sites s ON s.code = es.site_id
          ORDER BY es.site_id`
      )).rows;
      // Mask token (return เฉพาะ 12 ตัวท้าย)
      const masked = {
        ...cfg,
        channel_access_token: cfg.channel_access_token
          ? '••••••••' + cfg.channel_access_token.slice(-12)
          : null,
        channel_secret: cfg.channel_secret
          ? '••••••••' + cfg.channel_secret.slice(-8)
          : null,
        imgbb_api_key: cfg.imgbb_api_key
          ? '••••••••' + cfg.imgbb_api_key.slice(-6)
          : null,
        _hasToken: !!cfg.channel_access_token,
        _hasSecret: !!cfg.channel_secret,
        _hasImgbb: !!cfg.imgbb_api_key,
        _edge_sites: siteRows,
      };
      // Site Admin ใช้แค่รายชื่อผู้รับไว้เลือกในกฎแจ้งเตือน/ตารางรายงาน (เจ้าของอนุญาต 2026-10-14)
      // — ไม่ส่ง token/secret แม้แต่แบบปิดบัง และไม่ส่งค่าตั้งของระบบอื่น
      if (req.user?.role === 'site_admin') {
        return res.json({
          enabled: !!cfg.enabled, _hasToken: !!cfg.channel_access_token,
          recipients: (cfg.recipients || []).map(r => ({ id: r.id, name: r.name, type: r.type, enabled: r.enabled })),
        });
      }
      res.json(masked);
    } catch (e) { routeError(res, e, 'GET /api/line-config'); }
  });

  app.put('/api/line-config', async (req, res) => {
    try {
      const { channel_access_token, channel_secret, imgbb_api_key, enabled, recipients, oa_basic_id, edge_alert } = req.body;
      // Build update query (skip masked tokens — ที่ขึ้นต้นด้วย ••)
      const updates = [];
      const values = [];
      let idx = 1;
      if (channel_access_token !== undefined && !channel_access_token.startsWith('••')) {
        updates.push(`channel_access_token = $${idx++}`); values.push(channel_access_token || null);
      }
      if (channel_secret !== undefined && !channel_secret.startsWith('••')) {
        updates.push(`channel_secret = $${idx++}`); values.push(channel_secret || null);
      }
      if (imgbb_api_key !== undefined && !imgbb_api_key.startsWith('••')) {
        updates.push(`imgbb_api_key = $${idx++}`); values.push(imgbb_api_key || null);
      }
      if (enabled !== undefined) { updates.push(`enabled = $${idx++}`); values.push(enabled); }
      if (recipients !== undefined) { updates.push(`recipients = $${idx++}::jsonb`); values.push(JSON.stringify(recipients)); }
      if (oa_basic_id !== undefined) { updates.push(`oa_basic_id = $${idx++}`); values.push(oa_basic_id || null); }
      if (edge_alert !== undefined) {
        // Validate as a whole — reject malformed input rather than merge partial garbage.
        const e = edge_alert || {};
        const thr = parseInt(e.threshold_sec, 10);
        const cd  = Number(e.cooldown_hours);
        if (typeof e.enabled !== 'boolean'
          || !Number.isFinite(thr) || thr < 60
          || !Number.isFinite(cd) || cd <= 0
          || !Array.isArray(e.disabled_sites) || !e.disabled_sites.every(s => typeof s === 'string')
          || (e.recipient_ids !== null && (!Array.isArray(e.recipient_ids) || !e.recipient_ids.every(s => typeof s === 'string')))) {
          return res.status(400).json({ error: 'invalid edge_alert (enabled:bool, threshold_sec:int≥60, cooldown_hours:>0, disabled_sites:string[], recipient_ids:null|string[])' });
        }
        const clean = {
          enabled: e.enabled, threshold_sec: thr, cooldown_hours: cd,
          disabled_sites: e.disabled_sites, recipient_ids: e.recipient_ids ?? null,
        };
        updates.push(`edge_alert = $${idx++}::jsonb`); values.push(JSON.stringify(clean));
      }
      if (updates.length === 0) return res.json({ success: true, message: 'No changes' });
      updates.push('updated_at = NOW()');

      // ถ้า recipients เปลี่ยน → หา line_id ที่ถูกลบออก แล้ว reset pending_recipients เป็น 'ignored'
      // เพื่อให้ถ้า user ทักมาอีก webhook จะ reset เป็น 'pending' และขึ้นหน้า "ตรวจพบใหม่"
      let removedIds = [];
      if (recipients !== undefined) {
        const prevRes = await pool.query('SELECT recipients FROM line_config WHERE id = 1');
        const prevIds = new Set((prevRes.rows[0]?.recipients || []).map(r => r?.id).filter(Boolean));
        const newIds = new Set((recipients || []).map(r => r?.id).filter(Boolean));
        removedIds = [...prevIds].filter(id => !newIds.has(id));
      }

      await pool.query(`UPDATE line_config SET ${updates.join(', ')} WHERE id = 1`, values);

      if (removedIds.length > 0) {
        await pool.query(
          `UPDATE pending_recipients SET status = 'ignored' WHERE line_id = ANY($1) AND status = 'approved'`,
          [removedIds]
        );
      }

      pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'PUT /api/line-config'); }
  });

  // LINE message quota — ตัวเลข consumption ของ LINE ไม่ real-time พอเชื่อได้คนเดียว
  // (migration 239 / GOTCHAS) จึงแนบผล "monthly limit" จริงของเดือนนี้ + ค่าตั้งของ
  // ตัวเตือนโควตาไปด้วย ให้หน้า Settings วาดการ์ด/ฟอร์มได้จากคำขอเดียว
  app.get('/api/line-config/quota', auth.requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query('SELECT channel_access_token FROM line_config WHERE id = 1');
      const token = rows[0]?.channel_access_token;
      const alertSettings = await readAlertSettings(pool);
      const monthStart = monthStartBkkUtc(new Date());
      const limitHit = await findLimitHit(pool, monthStart);
      const alert = {
        enabled: alertSettings.enabled, threshold: alertSettings.threshold,
        recipients: alertSettings.recipients, state: alertSettings.state,
      };
      // T3: จำนวนครั้งที่สลับไป Telegram สำเร็จเดือนนี้ — นับจาก recipients_json
      // ของ alert_logs (ทุกแหล่ง: LPR/GuruSquare/alert-engine ต่างเติม
      // {channel:'telegram', fallback:true} เข้าแถวเดิมแบบเดียวกัน)
      const fallback_count_this_month = await _countFallbackThisMonth(pool, monthStart);
      if (!token) return res.json({ connected: false, alert, fallback_count_this_month });
      const quota = await lineSender.getLineQuota(token);
      if (!quota) return res.json({ connected: false, alert, fallback_count_this_month });
      res.json({
        connected: true, ...quota,
        limit_hit_at: limitHit?.at || null,
        limit_hit_recipient: limitHit?.recipient || null,
        alert, fallback_count_this_month,
      });
    } catch (e) { routeError(res, e, 'GET /api/line-config/quota'); }
  });

  // ตั้งค่าตัวเตือนโควตา LINE (migration 239) — recipients ต้องเป็น id ที่มีอยู่จริง
  // ใน line_config.recipients เท่านั้น กันพิมพ์ id ผิดแล้วเงียบไปเฉย ๆ ตอนถึงเวลาแจ้งจริง
  app.put('/api/line-config/quota-alert', auth.requireAdmin, async (req, res) => {
    try {
      const { enabled, threshold, recipients } = req.body || {};
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled ต้องเป็น boolean' });
      }
      const thr = parseInt(threshold, 10);
      if (!Number.isFinite(thr) || thr < 1 || thr > 100000) {
        return res.status(400).json({ error: 'threshold ต้องเป็นจำนวนเต็ม 1–100000' });
      }
      if (!Array.isArray(recipients) || !recipients.every((id) => typeof id === 'string' || typeof id === 'number')) {
        return res.status(400).json({ error: 'recipients ต้องเป็น array ของ id' });
      }
      const { rows: cfgRows } = await pool.query('SELECT recipients FROM line_config WHERE id = 1');
      const knownIds = new Set((cfgRows[0]?.recipients || []).map((r) => String(r?.id)));
      const unknown = recipients.map(String).filter((id) => !knownIds.has(id));
      if (unknown.length) {
        return res.status(400).json({ error: `recipient id ไม่รู้จัก: ${unknown.join(', ')}` });
      }
      await pool.query(
        `INSERT INTO system_settings (key, value) VALUES
           ('line_quota_alert_enabled', $1),
           ('line_quota_alert_threshold', $2),
           ('line_quota_alert_recipients', $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [String(enabled), String(thr), JSON.stringify(recipients.map(String))]
      );
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'PUT /api/line-config/quota-alert'); }
  });

  // Test LINE connection
  app.post('/api/line-config/test', auth.requireAdmin, async (req, res) => {
    try {
      const { recipientId } = req.body;
      if (!recipientId) return res.status(400).json({ error: 'recipientId required' });
      const { rows } = await pool.query('SELECT channel_access_token FROM line_config WHERE id = 1');
      const token = rows[0]?.channel_access_token;
      if (!token) return res.status(400).json({ error: 'LINE token ยังไม่ได้ตั้งค่า' });
      const result = await lineSender.testConnection(token, recipientId);
      res.json(result);
    } catch (e) { routeError(res, e, 'POST /api/line-config/test'); }
  });

  // QR code for LINE OA friend-add (Phase B onboarding)
  app.get('/api/line-config/qr', auth.requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT oa_basic_id FROM line_config WHERE id = 1');
      const basicId = rows[0]?.oa_basic_id?.trim();
      if (!basicId) return res.status(404).json({ error: 'oa_basic_id ยังไม่ได้ตั้งค่า' });
      const id = basicId.startsWith('@') ? basicId : '@' + basicId;
      const url = `https://line.me/R/ti/p/${encodeURIComponent(id)}`;
      const png = await QRCode.toBuffer(url, { type: 'png', width: 200, margin: 2 });
      res.set('Content-Type', 'image/png').send(png);
    } catch (e) { routeError(res, e, 'GET /api/line-config/qr'); }
  });

  // ── LINE pending recipients (self-service onboarding Phase A) ─
  app.get('/api/line/pending', auth.requireAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT line_id, source_type, display_name, avatar_url,
               first_seen_at, last_message_at, message_count, status
        FROM pending_recipients
        WHERE status = 'pending'
        ORDER BY last_message_at DESC
        LIMIT 100
      `);
      res.json(rows);
    } catch (e) { routeError(res, e, 'GET /api/line/pending'); }
  });

  app.post('/api/line/pending/:id/approve', auth.requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const lineId = String(req.params.id || '').trim();
      if (!lineId) return res.status(400).json({ error: 'line_id required' });
      await client.query('BEGIN');
      const pendingRes = await client.query(
        `SELECT * FROM pending_recipients WHERE line_id = $1 FOR UPDATE`, [lineId]
      );
      if (!pendingRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'pending recipient not found' });
      }
      const p = pendingRes.rows[0];
      const cfgRes = await client.query('SELECT recipients FROM line_config WHERE id = 1 FOR UPDATE');
      const recipients = Array.isArray(cfgRes.rows[0]?.recipients) ? cfgRes.rows[0].recipients : [];
      const name = String(req.body?.name || p.display_name || lineId).trim();
      const exists = recipients.some(r => r && r.id === lineId);
      const nextRecipients = exists
        ? recipients.map(r => r && r.id === lineId ? { ...r, type: p.source_type, name, enabled: r.enabled !== false } : r)
        : recipients.concat([{ id: lineId, type: p.source_type, name, enabled: true }]);
      await client.query(
        `UPDATE line_config SET recipients = $1::jsonb, updated_at = NOW() WHERE id = 1`,
        [JSON.stringify(nextRecipients)]
      );
      await client.query(
        `UPDATE pending_recipients SET status = 'approved', display_name = $2 WHERE line_id = $1`,
        [lineId, name]
      );
      await client.query('COMMIT');
      pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
      await auth.logAudit(req.user?.id, req.user?.username, 'line_recipient_approve', null, null, getIP(req), req.headers['user-agent'], {
        line_id: lineId, source_type: p.source_type, display_name: name, existing: exists,
      });
      res.json({ success: true, recipient: { id: lineId, type: p.source_type, name, enabled: true } });
      // แจ้ง user ว่าถูก approved แล้ว (async, ไม่บล็อก response)
      pool.query('SELECT channel_access_token FROM line_config WHERE id = 1')
        .then(async ({ rows }) => {
          const token = rows[0]?.channel_access_token;
          if (!token) { console.warn('⚠️ approve notify: no token configured'); return; }
          const result = await lineSender.pushLineMessage(token, lineId, [{
            type: 'text',
            text: '✓ อนุมัติแล้ว\nคุณจะได้รับการแจ้งเตือนจากระบบกล้องวงจรปิดต่อไป\n\n✓ Approved\nYou will now receive CCTV system alerts.',
          }]);
          if (result.success) console.log(`✅ approve notify sent → ${lineId.slice(0, 8)}…`);
          else console.warn(`⚠️ approve notify push failed → ${lineId.slice(0, 8)}… : ${result.error}`);
        })
        .catch(e => console.warn('⚠️ approve notify push error:', e.message));
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      routeError(res, e, 'POST /api/line/pending/:id/approve');
    } finally {
      client.release();
    }
  });

  app.post('/api/line/pending/:id/ignore', auth.requireAdmin, async (req, res) => {
    try {
      const lineId = String(req.params.id || '').trim();
      if (!lineId) return res.status(400).json({ error: 'line_id required' });
      const { rows } = await pool.query(
        `UPDATE pending_recipients SET status = 'ignored'
         WHERE line_id = $1 AND status = 'pending'
         RETURNING line_id, source_type, display_name`,
        [lineId]
      );
      if (!rows.length) return res.status(404).json({ error: 'pending recipient not found' });
      await auth.logAudit(req.user?.id, req.user?.username, 'line_recipient_ignore', null, null, getIP(req), req.headers['user-agent'], rows[0]);
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'POST /api/line/pending/:id/ignore'); }
  });

  app.post('/api/line/pending/:id/block', auth.requireAdmin, async (req, res) => {
    try {
      const lineId = String(req.params.id || '').trim();
      if (!lineId) return res.status(400).json({ error: 'line_id required' });
      const { rows } = await pool.query(
        `UPDATE pending_recipients SET status = 'blocked'
         WHERE line_id = $1 AND status IN ('pending','ignored')
         RETURNING line_id, source_type, display_name`,
        [lineId]
      );
      if (!rows.length) return res.status(404).json({ error: 'recipient not found or already blocked' });
      await auth.logAudit(req.user?.id, req.user?.username, 'line_recipient_block', null, null, getIP(req), req.headers['user-agent'], rows[0]);
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'POST /api/line/pending/:id/block'); }
  });

  app.post('/api/line/blocked/:id/unblock', auth.requireAdmin, async (req, res) => {
    try {
      const lineId = String(req.params.id || '').trim();
      if (!lineId) return res.status(400).json({ error: 'line_id required' });
      const { rows } = await pool.query(
        `UPDATE pending_recipients SET status = 'ignored'
         WHERE line_id = $1 AND status = 'blocked'
         RETURNING line_id, source_type, display_name`,
        [lineId]
      );
      if (!rows.length) return res.status(404).json({ error: 'blocked recipient not found' });
      await auth.logAudit(req.user?.id, req.user?.username, 'line_recipient_unblock', null, null, getIP(req), req.headers['user-agent'], rows[0]);
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'POST /api/line/blocked/:id/unblock'); }
  });

  app.get('/api/line/blocked', auth.requireAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT line_id, source_type, display_name, avatar_url, first_seen_at, last_message_at, message_count
         FROM pending_recipients WHERE status = 'blocked'
         ORDER BY last_message_at DESC`
      );
      res.json(rows);
    } catch (e) { routeError(res, e, 'GET /api/line/blocked'); }
  });

  // ── LINE Webhook (รับ User ID จากคนที่แอด OA + ส่งข้อความ) ──
  // express.json() stores req.rawBody above because HMAC-SHA256 must use raw bytes.
  // write-guard: public โดยออกแบบ ตรวจลายเซ็น LINE ในตัว
  app.post('/api/line/webhook', async (req, res) => {
    try {
      const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {})));
      // ── Signature verification ──────────────────────────────────
      // LINE ส่ง Base64(HMAC-SHA256(rawBody, channel_secret)) มาใน x-line-signature
      // ถ้าไม่มี / ผิด → reject 400 (LINE จะ retry — แต่ 400 หยุด retry ทันที)
      const sig = req.headers['x-line-signature'];
      const cfgRes = await pool.query('SELECT channel_access_token, channel_secret FROM line_config WHERE id = 1');
      const cfg = cfgRes.rows[0] || {};
      if (cfg.channel_secret) {
        if (!sig) {
          console.warn('🔔 LINE webhook: missing signature — rejected');
          return res.status(400).json({ error: 'missing signature' });
        }
        const expected = crypto
          .createHmac('sha256', cfg.channel_secret)
          .update(rawBody)
          .digest('base64');
        if (sig !== expected) {
          console.warn('🔔 LINE webhook: invalid signature — rejected');
          return res.status(400).json({ error: 'invalid signature' });
        }
      }
      // ── Parse JSON from raw buffer ──────────────────────────────
      const body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
      const events = body.events || [];
      for (const ev of events) {
        const sourceType = ev.source?.type; // 'user' | 'group' | 'room'
        const senderId = sourceType === 'group'
          ? ev.source?.groupId
          : sourceType === 'room'
            ? ev.source?.roomId
            : ev.source?.userId;
        // 🔎 บันทึกรูปร่างของ event ไว้ก่อนตัดสินใจอะไร (log อย่างเดียว ไม่เปลี่ยนพฤติกรรม)
        // เหตุผล: แผนคำสั่งผ่าน LINE (หยุดแจ้งเตือน / ส่งต่อ) ต้องรู้ให้แน่ว่า **ในกลุ่ม**
        // LINE ส่ง `source.userId` ของคนพิมพ์มาด้วยหรือไม่ — เอกสารของ LINE ซ่อนหัวข้อนี้
        // ไว้ในส่วนที่ดึงมาอ่านอัตโนมัติไม่ได้ ⇒ ต้องดูจากของจริง · ไม่ log ตัว id เต็ม
        console.log(`🔔 [webhook-shape] type=${ev.type} src=${sourceType}`
          + `${ev.deliveryContext?.isRedelivery ? ' REDELIVERY' : ''}`
          + ` hasUserId=${!!ev.source?.userId} hasReplyToken=${!!ev.replyToken}`
          + `${ev.type === 'message' ? ` msg=${ev.message?.type} quoted=${!!ev.message?.quotedMessageId}` : ''}`
          + `${ev.type === 'postback' ? ` data=${String(ev.postback?.data || '').slice(0, 40)}` : ''}`);
        if (!senderId || !['user', 'group', 'room'].includes(sourceType)) continue;

        // ── คำสั่งผ่าน LINE ──────────────────────────────────────
        // ทำก่อนงานลงทะเบียนผู้รับ เพราะผู้สั่งคือคนที่ลงทะเบียนไปนานแล้ว
        // ทางที่ไม่ใช่คำสั่ง (หรือคนนอก) ตกลงไปทำงานเดิมต่อตามปกติ
        // ⚠️ เฉพาะข้อความของ "ผู้สั่งที่ลงทะเบียนแล้ว" เท่านั้นที่ตัดออกจากเส้นทางเดิม
        // ข้อความของคนอื่นต้องไหลลงไปทำงานลงทะเบียนผู้รับเหมือนเดิมทุกประการ
        // (ถ้า continue ทุกข้อความ คนที่ทักบอทมาเพื่อขออนุมัติจะไม่ถูกบันทึกอีกเลย)
        const _isOperator = (ev.type === 'message' && ev.message?.type === 'text' && ev.source?.userId)
          ? !!(await loadOperator(pool, ev.source.userId))
          : false;
        // 🔴 GOTCHAS #209 ต่อยอด (2026-09-15, ปูม id=272/276): ข้อความที่กำลังคุยกับคน
        // จริงในห้องเดียวกัน (@แท็กสมาชิกคนอื่น) ดันมีคำเรียกคำสั่งฝังอยู่กลางประโยคพอดี
        // ("@Unlockk ... กล้องดับหรอ...") ⇒ ชน matchCommand ตรง ๆ ยืนยันจาก
        // message.mention ของ LINE จริง (probe บน prod 2026-09-15) — ฟิลด์ `isSelf`
        // บอกตรง ๆ ว่าคนที่ถูกแท็กคือบอทเองหรือเปล่า ⇒ ใช้เป็นสัญญาณกันชนได้แม่นยำ
        const _mentionsSelf = !!(ev.message?.mention?.mentionees?.some((m) => m.isSelf));
        const _mentionsOthersOnly = !!(ev.message?.mention?.mentionees?.length) && !_mentionsSelf;
        // 🔴 decision #289 (2026-09-16): กลับคำตัดสินเดิม "ไม่ต้อง @ บอทก่อนสั่ง"
        // (2026-09-08, docs/LOGIC_line-commands.md §3) เฉพาะ**แชทกลุ่ม/ห้อง** — เจอซ้ำ
        // เป็นรอบที่ 3 ที่ผู้สั่งคุยเรื่องอื่นล้วน ๆ ในกลุ่มแล้วบอทเด้งการ์ด "ยังไม่เข้าใจ
        // คำสั่งนี้" ใส่ (เนื้อหาคุยคนละเรื่องทุกครั้ง ⇒ ไล่แก้ทีละคำสั่งด้วย require_all/
        // exclude ไม่ทันแล้ว) ต้อง @ บอทเองก่อนถึงจะเข้าทางคำสั่ง · แชท 1:1 คงพฤติกรรม
        // เดิมไว้ (ไม่ต้อง @) เพราะไม่มีทางเข้าใจผิดว่าใครเป็นคนฟัง
        const _groupNeedsMention = (sourceType === 'group' || sourceType === 'room') && !_mentionsSelf;
        if (_isOperator && !_mentionsOthersOnly && !_groupNeedsMention) {
          // 🔴 LINE ให้เวลาตอบ webhook สั้นมาก (ระดับ 1 วินาที) ถ้าเกินจะถือว่าล้มเหลว
          // แล้ว **ส่ง event เดิมมาซ้ำ** — คำสั่งจึงรันสองรอบและการ์ดเด้งสองใบ
          // (เกิดจริง 2026-09-08 22:47 คำขอใช้ 2,200 ms → ได้ event ซ้ำตอน 22:48
          //  การ์ดสองใบตัวเลขต่างกันเพราะเป็นคนละการรันจริง ๆ)
          // ⇒ ตัวที่ LINE ส่งซ้ำ ทิ้งทันที และงานที่เหลือไม่ให้ LINE รอ
          if (ev.deliveryContext?.isRedelivery) {
            console.log('🔔 [line-cmd] ข้าม event ที่ LINE ส่งซ้ำ');
            continue;
          }
          // ไม่ await โดยตั้งใจ — reply token ใช้ได้ 60 วินาที มีเวลาเหลือเฟือ
          // ส่วน LINE ได้ 200 กลับไปทันทีตอนจบลูป
          void (async () => {
          // reply token ใช้ได้ **ครั้งเดียว** — ถ้าเอาไปใช้กับข้อความ "กำลังค้น" แล้ว
          // คำตอบจริงต้องไปทาง push · ตัวแปรนี้คือสิ่งที่บอกว่าโทเคนถูกใช้ไปหรือยัง
          let replyUsed = false;
          const onAck = async (text) => {
            if (!cfg.channel_access_token || !text) return;
            const m = { type: 'text', text: String(text).slice(0, 400) };
            if (ev.replyToken && !replyUsed) {
              replyUsed = true;
              const r0 = await lineSender.replyLineMessage(cfg.channel_access_token, ev.replyToken, [m]);
              if (!r0?.success) {
                await lineSender.pushLineMessage(cfg.channel_access_token, senderId, [m]);
              }
            } else {
              await lineSender.pushLineMessage(cfg.channel_access_token, senderId, [m]);
            }
          };
          try {
            const r = await handleLineText(
              { pool, auth, baseUrl: SELF_BASE, onAck },
              { text: ev.message.text, lineUserId: ev.source.userId,
                sourceType, sourceId: senderId });
            if (r.action === 'reply' && cfg.channel_access_token) {
              const msg = r.card
                ? lineSender.buildAnswerFlex(r.card)
                : { type: 'text', text: String(r.text || '').slice(0, 4900) };
              // reply token ใช้ได้ครั้งเดียวและอายุ 60 วินาที — ถ้าหมดอายุ (คำสั่งช้า)
              // หรือถูกใช้ไปกับข้อความ "กำลังค้น" แล้ว ต้อง push เข้าห้องเดิมแทน
              // ไม่งั้นคนถามไม่ได้คำตอบโดยไม่รู้ว่าทำไม
              const sent = (ev.replyToken && !replyUsed)
                ? await lineSender.replyLineMessage(cfg.channel_access_token, ev.replyToken, [msg])
                : { success: false };
              let ok = !!sent?.success;
              if (!ok) {
                const pushed = await lineSender.pushLineMessage(cfg.channel_access_token, senderId, [msg]);
                ok = !!pushed?.success;
                // 🔴 ต้อง log ให้เห็นเสมอ — คำสั่งรันสำเร็จแล้ว (ปูมขึ้น ok) แต่ส่งไม่ออก
                // ผู้ใช้เห็นแค่ "ไม่มีอะไรเกิดขึ้น" แล้วไม่มีใครรู้ว่าพังตรงไหน
                // (เกิดจริง 2026-09-08: การ์ดมีปุ่มลิงก์แบบ path ล้วน LINE ตอบ 400 ทิ้งทั้งใบ)
                if (!ok) {
                  console.error('🔔 [line-cmd] ตอบกลับไม่สำเร็จ:',
                    'reply=' + (sent?.error || '-'), '| push=' + (pushed?.error || '-'));
                }
              }
            }
          } catch (cmdErr) {
            console.error('🔔 [line-cmd] ล้มระหว่างประมวลผลคำสั่ง:', cmdErr.message);
          }
          })();
          continue;   // ข้อความของผู้สั่งไม่ต้องไปนับเป็นการลงทะเบียนผู้รับซ้ำ
        }

        if (ev.type === 'message' || ev.type === 'follow' || ev.type === 'join') {
          let profile = null;
          if (cfg.channel_access_token && sourceType === 'user') {
            profile = await lineSender.getLineUserProfile(cfg.channel_access_token, senderId);
          } else if (cfg.channel_access_token && sourceType === 'group') {
            profile = await lineSender.getLineGroupSummary(cfg.channel_access_token, senderId);
          }
          const displayName = profile?.displayName || profile?.groupName || null;
          const avatarUrl = profile?.pictureUrl || null;
          const upsertRes = await pool.query(`
            WITH prev AS (SELECT status AS old_status FROM pending_recipients WHERE line_id = $1)
            INSERT INTO pending_recipients
              (line_id, source_type, display_name, avatar_url, first_seen_at, last_message_at, message_count, status)
            VALUES ($1, $2, $3, $4, NOW(), NOW(), 1, 'pending')
            ON CONFLICT (line_id) DO UPDATE SET
              source_type = EXCLUDED.source_type,
              display_name = COALESCE(EXCLUDED.display_name, pending_recipients.display_name),
              avatar_url = COALESCE(EXCLUDED.avatar_url, pending_recipients.avatar_url),
              last_message_at = NOW(),
              message_count = pending_recipients.message_count + 1,
              status = CASE
                WHEN pending_recipients.status = 'approved' THEN 'approved'
                WHEN pending_recipients.status = 'blocked'  THEN 'blocked'
                ELSE 'pending'
              END
            RETURNING (xmax = 0) AS inserted, status, (SELECT old_status FROM prev) AS prev_status
          `, [senderId, sourceType, displayName, avatarUrl]);
          const row = upsertRes.rows[0] || {};
          console.log(`🔔 LINE webhook: recipient ${sourceType} ${senderId.slice(0, 6)}… → ${row.status || 'pending'} via ${ev.type}`);
          // ส่ง reply ถ้า: user ใหม่ (inserted) หรือ status เพิ่งเปลี่ยนมาเป็น pending (เช่น deleted user ทักกลับ)
          const shouldReply = row.status === 'pending' && (row.inserted || row.prev_status !== 'pending');
          if (shouldReply && cfg.channel_access_token && ev.replyToken) {
            await lineSender.replyLineMessage(cfg.channel_access_token, ev.replyToken, [{
              type: 'text',
              text: '✓ ลงทะเบียนแล้ว รอแอดมินอนุมัติ\nRegistration received. Waiting for admin approval.',
            }]);
          }

        } else if (ev.type === 'leave' || ev.type === 'unfollow') {
          // Phase C: group/room leave หรือ user unfollow → disable recipient + clear pending
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            // Disable in line_config.recipients (JSONB array)
            const cfgRow = await client.query('SELECT recipients FROM line_config WHERE id = 1 FOR UPDATE');
            const recipients = Array.isArray(cfgRow.rows[0]?.recipients) ? cfgRow.rows[0].recipients : [];
            const updated = recipients.map(r => r && r.id === senderId ? { ...r, enabled: false } : r);
            const changed = updated.some((r, i) => r.enabled !== recipients[i]?.enabled);
            if (changed) {
              await client.query(
                `UPDATE line_config SET recipients = $1::jsonb, updated_at = NOW() WHERE id = 1`,
                [JSON.stringify(updated)]
              );
            }
            // Mark pending row as ignored (if still pending)
            await client.query(
              `UPDATE pending_recipients SET status = 'ignored'
               WHERE line_id = $1 AND status = 'pending'`,
              [senderId]
            );
            await client.query('COMMIT');
            if (changed) pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
            console.log(`🔔 LINE webhook: ${ev.type} ${sourceType} ${senderId.slice(0, 6)}… → disabled in recipients (changed=${changed})`);
          } catch (leaveErr) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('🔔 LINE webhook leave/unfollow error:', leaveErr.message);
          } finally {
            client.release();
          }
        }
      }
      res.status(200).end();
    } catch (e) {
      console.error('🔔 Webhook error:', e.message);
      res.status(200).end(); // ต้อง return 200 เสมอ ไม่งั้น LINE retry
    }
  });

};
