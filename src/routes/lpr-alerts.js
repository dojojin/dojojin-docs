// ============================================================
// Vigil Platform — Routes: LPR Alerts (RF-ALERT — watch-list hits)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// An "alert" = an anprAlarm event whose plate matches an ACTIVE lpr_watchlist
// entry. The match condition reuses the exact, proven join already used by the
// /api/lpr/stats watch KPI: w.plate_number = UPPER(lp.plate_number) AND w.active.
// Ack state lives in lpr_alert_acks (mirror of face_event_acks / FP5).
'use strict';

const { siteWhere } = require('../auth');
const { scrubRawJsonSql } = require('../helpers/scrubRawJson');

// Asia/Bangkok local day boundary (api-server forces session TZ = UTC; see lpr-query.js).
const BKK_DAY = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date::timestamp AT TIME ZONE 'Asia/Bangkok'`;

const { watchSiteOk } = require('../helpers/watchScope');

module.exports = function lprAlertRoutes(app, pool) {
  // Shared FROM + watch-list match (the proven join) — anprAlarm ⨝ active watch-list.
  const BASE =
    `FROM events e
       JOIN license_plates lp ON lp.event_id = e.id
       JOIN lpr_watchlist  w  ON w.plate_number = UPPER(lp.plate_number) AND w.active
         -- Alert Match Mode is enforced HERE (2026-07-27) — the column existed
         -- and was displayed for months without ever gating a match. A row in
         -- 'plate' mode still only needs the plate; 'plate_region' additionally
         -- requires the detected province (lp.region) to equal the watchlist
         -- row's stored province (w.region). Both sides are stored in Thai text
         -- from the same convention (dltProvince / GuruSquare's own field), so a
         -- plain equality is correct — no locale/case normalization needed.
         AND (w.alert_mode <> 'plate_region' OR w.region = lp.region)
         -- กลุ่มเฉพาะ Site จับคู่เฉพาะกล้องของ Site นั้น (migration 261 · helpers/watchScope.js)
         AND ${watchSiteOk('w', 'e.camera_id')}
       LEFT JOIN lpr_alert_acks ack ON ack.event_id = e.id
       -- Camera display name. cameras.id is the PK (143/143 distinct) so this
       -- cannot multiply rows — it is safe in BASE, which the COUNT query for
       -- X-Total-Count also uses. All 58 cameras that have ever raised an
       -- anprAlarm resolve here, but COALESCE keeps the id showing rather than
       -- a blank if a camera row is ever deleted out from under its events.
       LEFT JOIN cameras c ON c.id = e.camera_id
      WHERE e.event_type = 'anprAlarm'`;

  // GET /api/lpr/alerts — paginated watch-list hits. Filters: group_id, q, from, to.
  app.get('/api/lpr/alerts', async (req, res) => {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const where = [];
    const args = [];
    const add = (clause, val) => { args.push(val); where.push(clause.replace('$$', `$${args.length}`)); };
    if (req.query.group_id) add(`w.group_id = $$`, req.query.group_id);
    if (req.query.q) {
      // one value across 4 columns → push once, reference $N four times
      args.push(`%${String(req.query.q).trim()}%`);
      const p = `$${args.length}`;
      where.push(`(lp.plate_number ILIKE ${p} OR lp.region ILIKE ${p} OR w.label ILIKE ${p} OR w.notes ILIKE ${p})`);
    }
    if (req.query.from)     add(`e.event_time >= $$`, req.query.from);
    if (req.query.to)       add(`e.event_time <= $$`, req.query.to);
    if (req.query.cameras) {
      const a = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
      if (a.length) add(`e.camera_id = ANY($$)`, a);
    }
    // Site-RBAC P2
    const swA = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', args.length + 1);
    if (swA.sql) { where.push(swA.sql.replace(/^AND /, '')); args.push(...swA.args); }
    const whereSql = where.length ? ' AND ' + where.join(' AND ') : '';
    try {
      const [rows, cnt] = await Promise.all([
        // MATERIALIZED, then sort — do not fold the ORDER BY ... LIMIT into the
        // join. A watch-list hit is rare (172 among 2.7M anprAlarm rows), so
        // when the planner sees "newest 15" it walks events backwards expecting
        // to fill the page quickly and instead scans ~926k of them: measured
        // 2.12s. Collecting every hit first costs the same as the COUNT beside
        // it (0.046s) and sorting 172 rows is free — 0.014s, byte-identical
        // results. This scales with the number of ALERTS, not the number of
        // events, which is the direction that stays sane as cameras are added.
        pool.query(
          `WITH hits AS MATERIALIZED (
             SELECT e.id, e.event_time, e.camera_id,
                    COALESCE(c.name, e.camera_id) AS camera_name,
                    e.snapshot_filename AS snapshot_file,
                    -- ปิดบัง IP/MAC ของกล้องใน rawXml สำหรับผู้ที่ไม่ใช่ admin
                    -- (security backlog 2026-08-12 · S1 — เหมือน /api/lpr, commit d3fe320)
                    ${req.user?.role === 'admin' ? 'e.raw_json' : `${scrubRawJsonSql('e.raw_json')} AS raw_json`},
                    lp.plate_number, lp.region, lp.vehicle_type, lp.vehicle_color,
                    lp.vehicle_brand, lp.plate_image, lp.confidence,
                    -- กรอบ bounding box — หน้าต่างแจ้งเตือนวาดกรอบแดงทับภาพจากกล้อง
                    -- (migration 117) · เดิมไม่ได้เลือกมาเลย หน้าจอจึงไม่มีพิกัดให้วาด
                    -- แม้จะเพิ่มโค้ดวาดแล้วก็ตาม · พิกัดเป็นกริด 0-1000 ที่กล้องส่งมา
                    lp.bbox_x, lp.bbox_y, lp.bbox_width, lp.bbox_height,
                    lp.vehicle_bbox_x, lp.vehicle_bbox_y,
                    lp.vehicle_bbox_width, lp.vehicle_bbox_height,
                    w.label AS wl_label, w.group_id, w.notes AS wl_notes,
                    w.ref_image, w.alert_mode, w.blacklist_master_id,
                    ack.acked_by, ack.acked_at
               ${BASE}${whereSql}
           )
           SELECT * FROM hits
            ORDER BY event_time DESC
            LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
          [...args, limit, offset]
        ),
        pool.query(`SELECT COUNT(*) ${BASE}${whereSql}`, args),
      ]);
      res.set('X-Total-Count', cnt.rows[0].count);
      res.json(rows.rows);
    } catch (e) {
      console.error('[lpr-alerts] GET /api/lpr/alerts:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/alerts/count — badge: today's hits + unacknowledged total.
  app.get('/api/lpr/alerts/count', async (req, res) => {
    try {
      const swC = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', 1);
      const r = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE e.event_time >= ${BKK_DAY})::int AS today,
                COUNT(*) FILTER (WHERE ack.event_id IS NULL)::int         AS unacked
           ${BASE} ${swC.sql}`,
        swC.args
      );
      res.json(r.rows[0] || { today: 0, unacked: 0 });
    } catch (e) {
      console.error('[lpr-alerts] GET /api/lpr/alerts/count:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // POST /api/lpr/alerts/:id/ack — acknowledge a hit (upsert; mirror FP5 face ack).
  app.post('/api/lpr/alerts/:id/ack', async (req, res) => {
    // unbounded: อ่าน/เขียนแถวเดียวตาม event id
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    try {
      if (req.user?.isSiteScoped) {
        const chk = await pool.query(
          'SELECT 1 FROM events WHERE id = $1 AND camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($2))',
          [id, req.user.allowedSites]);
        if (!chk.rowCount) return res.status(403).json({ error: 'forbidden' });
      }
      const r = await pool.query(
        `INSERT INTO lpr_alert_acks (event_id, acked_by, acked_by_id, acked_at)
              VALUES ($1, $2, $3, now())
         ON CONFLICT (event_id) DO UPDATE
              SET acked_by = EXCLUDED.acked_by, acked_by_id = EXCLUDED.acked_by_id, acked_at = now()
         RETURNING acked_by, acked_at`,
        [id, req.user?.username || null, req.user?.id || null]);
      res.json(r.rows[0]);
    } catch (e) {
      console.error('[lpr-alerts] POST /api/lpr/alerts/:id/ack:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // POST /api/lpr/alerts/:id/notify — เจ้าหน้าที่กดส่งการแจ้งเตือนนี้เข้า LINE เอง
  //
  // ทำไมต้องมี: ตัวส่งอัตโนมัติมีตัวกันหลายชั้น (cooldown 10 นาทีต่อคันต่อกลุ่ม ·
  // เพดานรายชั่วโมง · ปิดรายกลุ่ม/รายคัน) ซึ่งถูกสำหรับงานประจำ แต่พอเจ้าหน้าที่
  // เปิดดูแล้วตัดสินใจว่า "คันนี้ต้องแจ้งเดี๋ยวนี้" กลับไม่มีทางส่งเลย
  //
  // ⚠️ ข้ามตัวกันทั้งหมด (force) แต่ **ไม่ข้ามการคัดผู้รับ** — ยังส่งเฉพาะคนที่
  // ตั้งไว้ว่ารับไซต์/กลุ่มนั้น · และติดป้าย "ส่งด้วยตนเองโดย <ชื่อ>" ที่ต้นข้อความ
  // เสมอ ผู้รับต้องแยกออกว่านี่ไม่ใช่ระบบตรวจพบเอง
  app.post('/api/lpr/alerts/:id/notify', async (req, res) => {
    // unbounded: อ่านแถวเดียวตาม event id แล้วส่งแจ้งเตือน
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    try {
      if (req.user?.isSiteScoped) {
        const chk = await pool.query(
          'SELECT 1 FROM events WHERE id = $1 AND camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($2))',
          [id, req.user.allowedSites]);
        if (!chk.rowCount) return res.status(403).json({ error: 'forbidden' });
      }
      const { rows } = await pool.query(
        `SELECT e.*, lp.plate_number, lp.region, lp.vehicle_type, lp.vehicle_color, w.group_id
           FROM events e
           JOIN license_plates lp ON lp.event_id = e.id
           LEFT JOIN lpr_watchlist w ON w.plate_number = UPPER(lp.plate_number) AND w.active
                AND ${watchSiteOk('w', 'e.camera_id')}
          WHERE e.id = $1`, [id]);
      const ev = rows[0];
      if (!ev) return res.status(404).json({ error: 'ไม่พบเหตุการณ์นี้' });
      if (!ev.group_id) return res.status(400).json({ error: 'ป้ายนี้ไม่ได้อยู่ในกลุ่มเฝ้าระวัง จึงไม่มีผู้รับให้ส่งถึง' });

      // ผู้รับเฉพาะครั้งนี้ — ตัวกรองเดียวกับปุ่มทดสอบในหน้าตั้งค่า ใช้ helper ตัวเดียวกัน
      const { resolveTestRecipients } = require('./alert-channels');
      const pickIds = await resolveTestRecipients(pool, req.body?.recipient_ids);
      if (pickIds && !pickIds.length) {
        return res.status(400).json({ error: 'ผู้รับที่เลือกใช้ไม่ได้ (ไม่รู้จัก หรือถูกปิดอยู่)' });
      }

      const out = await require('../helpers/lprLineAlert').sendLprAlert({
        pool, lineSender: require('../line-sender'), event: ev,
        plate: ev.plate_number, region: ev.region || '', groupId: ev.group_id,
        force: true, manualBy: req.user?.username || 'ไม่ทราบชื่อ',
        recipientIds: pickIds,
      });
      res.json({ ok: true, event_id: id, result: out || null });
    } catch (e) {
      console.error('[lpr-alerts] POST /api/lpr/alerts/:id/notify:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // POST /api/lpr/alerts/:id/notify-telegram — คู่ของ /notify ข้างบน แต่ส่งเข้า
  // Telegram เท่านั้น (ไม่แตะขา LINE เลย ไม่ว่า deliver_via ของช่องทางจะตั้งเป็นอะไร)
  // ว่าง = แชทที่ตั้งไว้ของไซต์/กลุ่มของคันนี้ (selectRecipients ตัวเดียวกับ auto)
  app.post('/api/lpr/alerts/:id/notify-telegram', async (req, res) => {
    // unbounded: อ่านแถวเดียวตาม event id แล้วส่งแจ้งเตือน (เหมือน /notify ข้างบน)
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    try {
      if (req.user?.isSiteScoped) {
        const chk = await pool.query(
          'SELECT 1 FROM events WHERE id = $1 AND camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($2))',
          [id, req.user.allowedSites]);
        if (!chk.rowCount) return res.status(403).json({ error: 'forbidden' });
      }
      const { rows } = await pool.query(
        `SELECT e.*, lp.plate_number, lp.region, lp.vehicle_type, lp.vehicle_color, w.group_id
           FROM events e
           JOIN license_plates lp ON lp.event_id = e.id
           LEFT JOIN lpr_watchlist w ON w.plate_number = UPPER(lp.plate_number) AND w.active
                AND ${watchSiteOk('w', 'e.camera_id')}
          WHERE e.id = $1`, [id]);
      const ev = rows[0];
      if (!ev) return res.status(404).json({ error: 'ไม่พบเหตุการณ์นี้' });
      if (!ev.group_id) return res.status(400).json({ error: 'ป้ายนี้ไม่ได้อยู่ในกลุ่มเฝ้าระวัง จึงไม่มีผู้รับให้ส่งถึง' });

      const { rows: tgCfgRows } = await pool.query(
        'SELECT enabled, bot_token_enc FROM telegram_config WHERE id = 1');
      const tgCfg = tgCfgRows[0];
      if (!tgCfg?.enabled || !tgCfg.bot_token_enc) {
        return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Telegram' });
      }

      const { resolveTestChats } = require('./alert-channels');
      const explicitIds = await resolveTestChats(pool, req.body?.telegram_chat_ids);
      if (explicitIds && !explicitIds.length) {
        return res.status(400).json({ error: 'แชทที่เลือกใช้ไม่ได้ (ไม่รู้จัก หรือถูกปิดอยู่)' });
      }
      let chatIds = explicitIds;
      if (!chatIds) {
        // ว่าง = แชทที่ตั้งไว้ของไซต์/กลุ่มนี้ — ตัวกรองเดียวกับที่ sendLprAlert
        // ใช้ภายในตัวมันเอง (selectRecipients) เพื่อให้เช็ค 400 ตรงกับของจริงที่จะส่ง
        const { selectRecipients } = require('../helpers/lprLineAlert');
        const { rows: camRows } = await pool.query(
          'SELECT s.code AS site_code FROM cameras c LEFT JOIN sites s ON s.id = c.site_id WHERE c.id = $1',
          [ev.camera_id]);
        const { rows: tgChatRows } = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
        const scoped = selectRecipients(tgChatRows[0]?.chats,
          { siteCode: camRows[0]?.site_code || null, groupId: ev.group_id });
        if (!scoped.length) {
          return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่าแชท Telegram สำหรับไซต์/กลุ่มนี้' });
        }
        chatIds = scoped.map(c => String(c.chat_id));
      }

      const out = await require('../helpers/lprLineAlert').sendLprAlert({
        pool, lineSender: require('../line-sender'), event: ev,
        plate: ev.plate_number, region: ev.region || '', groupId: ev.group_id,
        force: true, manualBy: req.user?.username || 'ไม่ทราบชื่อ',
        manualChannel: 'telegram', telegramChatIds: chatIds,
      });
      // ไม่ได้ส่งถึงใครเลย = ตอบ error ให้หน้าจอขึ้น "ส่งไม่สำเร็จ" (เดิมตอบ 200 เสมอ
      // เจ้าของเห็น "ส่งแล้ว" ทั้งที่ Telegram ปฏิเสธทุกแชท — 2026-09-25)
      if (!['sent', 'sent_manual'].includes(out?.status)) {
        return res.status(502).json({ error: out?.err || out?.status || 'ส่งไม่สำเร็จ', result: out || null });
      }
      res.json({ ok: true, event_id: id, result: out || null });
    } catch (e) {
      console.error('[lpr-alerts] POST /api/lpr/alerts/:id/notify-telegram:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });
};
