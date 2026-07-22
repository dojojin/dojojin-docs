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
module.exports = function lineRoutes(app, pool, { auth, getIP, routeError }) {

  // ── LINE Config (CRUD) ──────────────────────────────────────
  app.get('/api/line-config', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM line_config WHERE id = 1');
      const cfg = rows[0] || { id: 1, channel_access_token: null, recipients: [], enabled: false };
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
      };
      res.json(masked);
    } catch (e) { routeError(res, e, 'GET /api/line-config'); }
  });

  app.put('/api/line-config', async (req, res) => {
    try {
      const { channel_access_token, channel_secret, imgbb_api_key, enabled, recipients, oa_basic_id } = req.body;
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

  // LINE message quota
  app.get('/api/line-config/quota', auth.requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query('SELECT channel_access_token FROM line_config WHERE id = 1');
      const token = rows[0]?.channel_access_token;
      if (!token) return res.json({ connected: false });
      const quota = await lineSender.getLineQuota(token);
      if (!quota) return res.json({ connected: false });
      res.json({ connected: true, ...quota });
    } catch (e) { routeError(res, e, 'GET /api/line-config/quota'); }
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
        if (!senderId || !['user', 'group', 'room'].includes(sourceType)) continue;

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
