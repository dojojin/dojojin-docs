// ============================================================
// Vigil Platform — Routes: LPR GuruSquare Alarms (HKT "Events Alarm" feed)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Read-only screen over blacklist.gs_alarms (migration 237) — one row per
// GuruSquare `/alert` hit, stored by src/helpers/gsAlarmPoll.js. Deliberately
// a SEPARATE tab/endpoint from /api/lpr/alerts (RF-ALERT): that one matches on
// plate only OR plate+region depending on the watch-list row's alert_mode,
// while GuruSquare matches on plate only always — mixing the two counts would
// make the two tabs disagree for no reason a viewer could see (owner decision).
'use strict';

const fs = require('fs');
const path = require('path');

// ไฟล์รูปของ alarm อยู่ใต้ blacklist-photos/ (gsAlarmPoll → savePhoto) — ที่เดียวกับ
// blacklistImport.PHOTO_DIR
const PHOTO_DIR = path.join(__dirname, '..', '..', 'blacklist-photos');

module.exports = function lprGsAlarmRoutes(app, pool) {
  // Every row is scoped to its source's site via blacklist.sources.site_code
  // → sites.code. gs_alarms carries no camera_id FK (camera_name/camera_ip are
  // denormalized text off the GuruSquare payload, and may not even be one of
  // OUR cameras for a 'lprresult' capture) — so a per-camera-restricted user
  // (allowedSites.cameras set) cannot be verified at all here. Fail closed:
  // such a user sees zero rows rather than guessing.
  function rbacClause(req, args) {
    const allowedSites = req.user?.allowedSites ?? null;
    if (allowedSites === null) return '';
    if (allowedSites.cameras) return ' AND FALSE';
    args.push(Array.from(allowedSites));
    return ` AND st.id = ANY($${args.length})`;
  }

  const BASE = `FROM blacklist.gs_alarms a
       JOIN blacklist.sources src ON src.id = a.source_id AND src.source_type = 'gurusquare'
       JOIN sites st ON st.code = src.site_code`;

  // GET /api/lpr/gs-alarms/meta — tab visibility gate + owner filter options.
  app.get('/api/lpr/gs-alarms/meta', async (req, res) => {
    try {
      const args = [];
      const rbac = rbacClause(req, args);
      const [srcR, ownR] = await Promise.all([
        pool.query(
          `SELECT EXISTS (
             SELECT 1 FROM blacklist.sources src
               JOIN sites st ON st.code = src.site_code
              WHERE src.source_type = 'gurusquare' AND src.active AND src.alarm_enabled${rbac}
           ) AS enabled`, args),
        pool.query(
          `SELECT DISTINCT a.owner ${BASE}
            WHERE a.owner IS NOT NULL AND a.owner <> ''
              AND a.alarm_time >= NOW() - INTERVAL '90 days'${rbac}
            ORDER BY a.owner`, args),
      ]);
      let enabled = !!srcR.rows[0]?.enabled;
      let owners = ownR.rows.map(r => r.owner);
      if (!enabled && owners.length) enabled = true;
      if (!enabled) {
        // Second half of the spec'd OR: "at least one gs_alarms row the user
        // may see" — owners only covers rows WITH an owner in the last 90
        // days, so check separately rather than widen that query's WHERE.
        const anyR = await pool.query(`SELECT EXISTS (SELECT 1 ${BASE} WHERE TRUE${rbac}) AS any`, args);
        enabled = !!anyR.rows[0]?.any;
      }
      res.json({ enabled, owners });
    } catch (e) {
      console.error('[lpr-gs-alarms] GET /api/lpr/gs-alarms/meta:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/gs-alarms — paginated feed. Filters: from, to, q, owner.
  app.get('/api/lpr/gs-alarms', async (req, res) => {
    // unscoped: ไม่ใช้ siteWhere() เพราะ gs_alarms ไม่มี camera_id ให้กรอง — กรองด้วย
    // sites.id ผ่าน rbacClause() แทน (ผู้ใช้ที่จำกัดรายกล้อง = AND FALSE) · events แตะแค่
    // LATERAL ที่ผูก e.id + e.event_time (partition key) ของแถวที่ผ่านสิทธิ์แล้ว
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const where = [];
    const args = [];
    const add = (clause, val) => { args.push(val); where.push(clause.replace('$$', `$${args.length}`)); };
    if (req.query.from) add(`a.alarm_time >= $$`, req.query.from);
    if (req.query.to)   add(`a.alarm_time <= $$`, req.query.to);
    if (req.query.owner) add(`a.owner = $$`, req.query.owner);
    if (req.query.q) {
      const p = `%${String(req.query.q).trim()}%`;
      args.push(p);
      const p1 = `$${args.length}`;
      args.push(p.replace(/ /g, ''));
      const p2 = `$${args.length}`;
      where.push(`(a.plate ILIKE ${p1} OR a.owner ILIKE ${p1} OR a.detail ILIKE ${p1} OR a.camera_name ILIKE ${p1}
                   OR replace(a.plate, ' ', '') ILIKE ${p2})`);
    }
    const whereSql = (where.length ? ' AND ' + where.join(' AND ') : '') + rbacClause(req, args);
    try {
      const [rows, cnt] = await Promise.all([
        pool.query(
          `SELECT a.id, a.source_id, a.ext_id, a.alarm_time, a.plate, a.province, a.cartype, a.carcolor,
                  a.carbrand, a.platetype, a.owner, a.detail,
                  a.ref_photo_path, a.matched_event_id, a.matched_event_time,
                  a.camera_name, a.camera_ip, a.capture_source, a.capture_photo_path,
                  a.line_status, a.line_sent_at,
                  st.code AS site_code,
                  -- bounded by the partition key (event_time) — events is huge and
                  -- partitioned by RANGE(event_time); never scan it without one
                  cap.snapshot_file, cap.plate_image, cap.read_region, cap.vehicle_type, cap.plate_color
             ${BASE}
             LEFT JOIN LATERAL (
               SELECT e.snapshot_filename AS snapshot_file, lp.plate_image,
                      lp.region AS read_region, lp.vehicle_type, lp.plate_color
                 FROM events e
                 JOIN license_plates lp ON lp.event_id = e.id
                WHERE e.id = a.matched_event_id AND e.event_time = a.matched_event_time
                LIMIT 1
             ) cap ON TRUE
            WHERE TRUE${whereSql}
            ORDER BY a.alarm_time DESC, a.id DESC
            LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
          [...args, limit, offset]
        ),
        pool.query(`SELECT COUNT(*) ${BASE} WHERE TRUE${whereSql}`, args),
      ]);
      // 🔒 รูปผ่านเส้นทางของแท็บนี้เอง (ด้านล่าง) ไม่ใช่ /api/blacklist/photo — อันนั้น
      // เสิร์ฟรูปบัญชีดำ **ทุกไฟล์** รวมใบหน้าบุคคล ถ้าเปิดให้วิว lpr ใช้ ผู้ที่มีสิทธิ์แค่
      // หน้า LPR จะเดาชื่อไฟล์ดึงรูปคนได้ (audit G3 2026-09-24)
      const photoUrl = (r, kind, p) => p ? `/api/lpr/gs-alarms/${r.id}/photo/${kind}` : null;
      const out = rows.rows.map(r => ({
        ...r,
        ref_image_url: photoUrl(r, 'ref', r.ref_photo_path),
        // 'ours' captures use the events/license_plates snapshot (cap.*) via
        // /snapshots/ on the client, same as every other LPR card — only a
        // 'lprresult' capture (GuruSquare's own read log, not our camera) has
        // its own saved file under blacklist-photos/.
        capture_image_url: r.capture_source === 'lprresult' ? photoUrl(r, 'cap', r.capture_photo_path) : null,
      }));
      res.set('X-Total-Count', cnt.rows[0].count);
      res.json(out);
    } catch (e) {
      console.error('[lpr-gs-alarms] GET /api/lpr/gs-alarms:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/gs-alarms/:id/photo/:kind — kind = ref (รูปอ้างอิงจากบัญชีดำ) | cap
  // (ภาพจาก /lprresult) · path มาจากแถวใน DB เสมอ ไม่เคยมาจาก URL และผ่าน RBAC
  // ชุดเดียวกับรายการ — เห็นรายการไม่ได้ = ดึงรูปไม่ได้
  app.get('/api/lpr/gs-alarms/:id/photo/:kind', async (req, res) => {
    const col = { ref: 'ref_photo_path', cap: 'capture_photo_path' }[req.params.kind];
    if (!col || !/^\d+$/.test(req.params.id)) return res.status(400).end();
    try {
      const args = [req.params.id];
      const rbac = rbacClause(req, args);
      const { rows } = await pool.query(`SELECT a.${col} AS p ${BASE} WHERE a.id = $1${rbac}`, args);
      const rel = rows[0]?.p;
      if (!rel) return res.status(404).end();
      const f = path.join(PHOTO_DIR, rel);
      if (!f.startsWith(PHOTO_DIR + path.sep) || !fs.existsSync(f)) return res.status(404).end();
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.type('jpeg').send(fs.readFileSync(f));
    } catch (e) {
      console.error('[lpr-gs-alarms] GET photo:', e.message);
      res.status(500).end();
    }
  });

  // ── ส่งการแจ้งเตือนของ alarm นี้ด้วยมือ — คู่กันของ /api/lpr/alerts/:id/notify
  // (RF-ALERT) แต่ยิงผ่าน sendGsAlarm() ไม่ใช่ sendLprAlert() (ดู gsAlarmLine.js
  // หัวไฟล์ว่าทำไมสองเส้นทางแยกกัน) เดิมโมดัล GuruSquare ซ่อนปุ่ม LINE ไว้เพราะยังไม่มี
  // endpoint ให้กด — เพิ่มทั้งสองเส้นทาง (LINE + Telegram) พร้อมกันตอนนี้
  //
  // RBAC เดียวกับรายการ (rbacClause) — เห็นแถวไม่ได้ = ส่งแถวนั้นไม่ได้เช่นกัน
  app.post('/api/lpr/gs-alarms/:id/notify', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    try {
      const args = [id];
      const rbac = rbacClause(req, args);
      const { rows } = await pool.query(`SELECT a.* ${BASE} WHERE a.id = $1${rbac}`, args);
      const alarm = rows[0];
      if (!alarm) return res.status(404).json({ error: 'ไม่พบรายการนี้' });

      const { rows: chanRows } = await pool.query(
        `SELECT recipient_ids FROM alert_rules WHERE channel = 'gs_alarm'`);
      const chan = chanRows[0];

      const { resolveTestRecipients } = require('./alert-channels');
      const pickIds = await resolveTestRecipients(pool, req.body?.recipient_ids);
      if (pickIds && !pickIds.length) {
        return res.status(400).json({ error: 'ผู้รับที่เลือกใช้ไม่ได้ (ไม่รู้จัก หรือถูกปิดอยู่)' });
      }
      if (!pickIds && !(chan?.recipient_ids || []).length) {
        return res.status(400).json({ error: 'ช่องทางนี้ยังไม่ได้เลือกผู้รับ — เลือกก่อนจึงจะส่งได้' });
      }

      const out = await require('../helpers/gsAlarmLine').sendGsAlarm({
        pool, lineSender: require('../line-sender'), alarm,
        force: true, manualBy: req.user?.username || 'ไม่ทราบชื่อ',
        recipientIds: pickIds,
      });
      // ไม่ได้ส่งถึงใครเลย = ตอบ error ให้หน้าจอขึ้น "ส่งไม่สำเร็จ" (เดิมตอบ 200 เสมอ
      // เจ้าของเห็น "ส่งแล้ว" ทั้งที่ Telegram ปฏิเสธทุกแชท — 2026-09-25)
      if (!['sent', 'sent_manual'].includes(out?.status)) {
        return res.status(502).json({ error: out?.err || out?.status || 'ส่งไม่สำเร็จ', result: out || null });
      }
      res.json({ ok: true, alarm_id: id, result: out || null });
    } catch (e) {
      console.error('[lpr-gs-alarms] POST /api/lpr/gs-alarms/:id/notify:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // POST /api/lpr/gs-alarms/:id/notify-telegram — คู่ของ /notify ข้างบน แต่ส่งเข้า
  // Telegram เท่านั้น · ว่าง = แชทที่ตั้งไว้ของช่องทางนี้ (alert_rules.telegram_chat_ids)
  app.post('/api/lpr/gs-alarms/:id/notify-telegram', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
    try {
      const args = [id];
      const rbac = rbacClause(req, args);
      const { rows } = await pool.query(`SELECT a.* ${BASE} WHERE a.id = $1${rbac}`, args);
      const alarm = rows[0];
      if (!alarm) return res.status(404).json({ error: 'ไม่พบรายการนี้' });

      const { rows: tgCfgRows } = await pool.query(
        'SELECT enabled, bot_token_enc FROM telegram_config WHERE id = 1');
      const tgCfg = tgCfgRows[0];
      if (!tgCfg?.enabled || !tgCfg.bot_token_enc) {
        return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Telegram' });
      }

      const { rows: chanRows } = await pool.query(
        `SELECT telegram_chat_ids FROM alert_rules WHERE channel = 'gs_alarm'`);
      const chan = chanRows[0];

      const { resolveTestChats } = require('./alert-channels');
      let chatIds = await resolveTestChats(pool, req.body?.telegram_chat_ids);
      if (chatIds && !chatIds.length) {
        return res.status(400).json({ error: 'แชทที่เลือกใช้ไม่ได้ (ไม่รู้จัก หรือถูกปิดอยู่)' });
      }
      if (!chatIds) {
        // ว่าง = แชทที่ตั้งไว้ของช่องทางนี้ — ต้องเช็คว่ายังมีอยู่จริงและเปิดอยู่
        // ไม่ใช่แค่ telegram_chat_ids ไม่ว่าง (กันตอบ 200 ทั้งที่ไม่ได้ส่งไปหาใครเลย)
        chatIds = await resolveTestChats(pool, chan?.telegram_chat_ids);
        if (!chatIds || !chatIds.length) {
          return res.status(400).json({ error: 'ช่องทางนี้ยังไม่ได้เลือกแชท Telegram' });
        }
      }

      const out = await require('../helpers/gsAlarmLine').sendGsAlarm({
        pool, lineSender: require('../line-sender'), alarm,
        force: true, manualBy: req.user?.username || 'ไม่ทราบชื่อ',
        manualChannel: 'telegram', telegramChatIds: chatIds,
      });
      // ไม่ได้ส่งถึงใครเลย = ตอบ error ให้หน้าจอขึ้น "ส่งไม่สำเร็จ" (เดิมตอบ 200 เสมอ
      // เจ้าของเห็น "ส่งแล้ว" ทั้งที่ Telegram ปฏิเสธทุกแชท — 2026-09-25)
      if (!['sent', 'sent_manual'].includes(out?.status)) {
        return res.status(502).json({ error: out?.err || out?.status || 'ส่งไม่สำเร็จ', result: out || null });
      }
      res.json({ ok: true, alarm_id: id, result: out || null });
    } catch (e) {
      console.error('[lpr-gs-alarms] POST /api/lpr/gs-alarms/:id/notify-telegram:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });
};
