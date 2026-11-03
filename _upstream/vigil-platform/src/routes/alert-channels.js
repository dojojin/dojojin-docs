// ============================================================
// Vigil Platform — ช่องทางแจ้งเตือนประจำระบบ (HCP Face · AuraFace · LPR)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// สามอย่างนี้เป็นส่วนหนึ่งของระบบที่ใช้ประจำ ไม่ใช่กฎที่ผู้ใช้สร้างเอง — เดิมไปอยู่ปน
// ใน Alert Rules ซึ่ง **ลบได้** ถ้าใครเผลอลบแถว HCP ความสามารถหลักหายไปเงียบ ๆ
// (เจ้าของชี้ปัญหานี้ 2026-08-13) ⇒ แยกเป็นหน้า config ของตัวเองแบบแท็บ Edge Offline
//
// ใช้แถวใน `alert_rules` เดิมที่ทำเครื่องหมาย `channel` ไว้ (migration 146) จึงได้
// เครื่องยนต์ส่ง · cooldown · ผู้รับ · template · หน้าตาการ์ด · alert_logs ของเดิมทั้งหมด
'use strict';

const { validateDeliverVia } = require('../helpers/deliverViaValidate');

// ⚠️ เพิ่มคีย์ใหม่ต้องขยาย CHECK alert_rules_channel_chk ด้วย migration เสมอ
// (146 → 238) — ไม่งั้นบันทึกจากหน้าตั้งค่าได้ 500 และเทสต์ที่ใช้ pool ปลอมไม่มีวันเห็น
const CHANNELS = {
  hcp_face: { th: 'HCP · จดจำใบหน้า', ruleNames: ['Face Recognition Match'] },
  auraface: { th: 'AuraFace · บัญชีดำ (Lab)', ruleNames: ['AuraFace Blacklist Match'] },
  // LPR ยิงเองไม่ผ่าน rule engine (alert_logs rule_id = null) — แถวนี้เก็บค่าตั้งไว้
  // ให้หน้าจอแก้ได้ ส่วนการทำให้ตัวส่งของ LPR มาอ่านค่านี้เป็นงานถัดไป
  lpr:      { th: 'ป้ายทะเบียน · เฝ้าระวัง', ruleNames: [] },
  // GuruSquare `/alert` feed (migration 237, blacklist.gs_alarms) — ยิงเองไม่ผ่าน
  // rule engine เหมือนกัน แต่ผู้รับเลือกจาก recipient_ids ธรรมดา (ไม่ใช่ lpr_sites/
  // lpr_groups รายคนแบบช่องทาง LPR) — เจ้าของสั่งเฉพาะ LINE ของตัวเองก่อน
  gs_alarm: { th: 'GuruSquare · Events Alarm', ruleNames: [] },
};

// ── ผู้รับเฉพาะครั้งนี้ (ปุ่มทดสอบ / ส่งเอง) ────────────────────────────────
// คืน null = ไม่ได้ระบุมา ให้ใช้ผู้รับที่ตั้งไว้ตามปกติ
// คืน []   = ระบุมาแต่ใช้ไม่ได้สักคน (ผู้เรียกต้องตอบ error ไม่ใช่เงียบ ๆ ส่งหาทุกคน)
//
// 🔒 id ที่ส่งมาต้องมีอยู่ใน line_config.recipients และเปิดอยู่ · ไม่ใช่ LINE id
// อะไรก็ได้ · ถ้าไม่กรอง endpoint นี้จะกลายเป็นช่องยิงข้อความหา LINE id ใดก็ได้
// โดยใช้ token ของลูกค้า
async function resolveTestRecipients(pool, raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const want = new Set(raw.map(String));
  const { rows } = await pool.query('SELECT recipients FROM line_config WHERE id = 1');
  return (rows[0]?.recipients || [])
    .filter(r => r && r.enabled !== false && want.has(String(r.id)))
    .map(r => String(r.id));
}

// ── แชท Telegram เฉพาะครั้งนี้ (ปุ่ม "ส่งเข้า Telegram · ระบุเอง") — คู่ของ
// resolveTestRecipients() ข้างบน กติกาเดียวกันทุกประการ แค่แหล่งเป็น telegram_config
async function resolveTestChats(pool, raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const want = new Set(raw.map(String));
  const { rows } = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
  return (rows[0]?.chats || [])
    .filter(c => c && c.enabled !== false && want.has(String(c.chat_id)))
    .map(c => String(c.chat_id));
}

module.exports = function alertChannelRoutes(app, pool, { auth, routeError }) {

  /** สถานะที่หน้าจอต้องใช้ — รูปแบบเดียวกับบรรทัดสถานะของ Alert Rules */
  async function statusFor(rule) {
    if (!rule) return null;
    // ⚠️ แยก "ส่งจริง" · "ล้มเหลว" · "ข้าม" ออกจากกัน — LPR เขียน alert_logs ทุกครั้ง
    // ที่ตัดสินใจ รวมถึงตอนที่ตั้งใจไม่ส่ง (cooldown_skip / no_recipients) ถ้านับ
    // status <> 'sent' เป็นล้มเหลว หน้าจอจะขึ้น "ล้มเหลว 1,346" ทั้งที่ระบบทำงานปกติ
    // (เห็นจริงตอน reproduce 2026-08-13)
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE status IN ('sent','sent_manual'))::int AS n_24h,
              count(*) FILTER (WHERE status = 'failed')::int AS n_failed,
              count(*) FILTER (WHERE status NOT IN ('sent','sent_manual','failed'))::int AS n_skipped,
              -- ทางสำรองทำงานกี่ครั้ง (migration 147) — ข้อมูลเดียวที่บอกได้ว่า
              -- ลิงก์ของเราเชื่อถือได้แค่ไหน และถอด imgbb ทิ้งได้หรือยัง
              count(*) FILTER (WHERE image_source = 'imgbb')::int AS n_imgbb,
              count(*) FILTER (WHERE image_source = 'none')::int  AS n_noimg,
              max(sent_at) FILTER (WHERE status IN ('sent','sent_manual')) AS last_sent
         FROM alert_logs
        WHERE rule_id = $1 AND sent_at > NOW() - INTERVAL '24 hours'`, [rule.id]);
    const s = rows[0] || {};
    return {
      cooldown_seconds: rule.cooldown_seconds,
      send_snapshot: rule.send_snapshot !== false,
      push_count: (rule.push_user_ids || []).length,
      recipient_count: (rule.recipient_ids || []).length,
      last_triggered_at: rule.last_triggered_at,
      trigger_count: rule.trigger_count || 0,
      sent_24h: s.n_24h || 0,
      failed_24h: s.n_failed || 0,
      skipped_24h: s.n_skipped || 0,
      imgbb_24h: s.n_imgbb || 0,
      noimg_24h: s.n_noimg || 0,
      last_sent_at: s.last_sent || null,
    };
  }

  // GET /api/alert-channels — ทั้งสามช่องทาง พร้อมสถานะ
  app.get('/api/alert-channels', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM alert_rules WHERE channel IS NOT NULL ORDER BY channel`);
      const byCh = new Map(rows.map((r) => [r.channel, r]));
      const out = [];
      for (const key of Object.keys(CHANNELS)) {
        const rule = byCh.get(key) || null;
        out.push({
          channel: key, label: CHANNELS[key].th,
          expected_rule_names: CHANNELS[key].ruleNames,
          // ไม่มีแถว = ยังไม่เคยตั้งค่า · หน้าจอจะเสนอให้สร้าง ไม่ใช่แสดงว่าพัง
          configured: !!rule,
          rule: rule ? {
            id: rule.id, name: rule.name, enabled: rule.enabled,
            camera_ids: rule.camera_ids, rule_names: rule.rule_names, list_types: rule.list_types,
            recipient_ids: rule.recipient_ids, push_user_ids: rule.push_user_ids,
            cooldown_seconds: rule.cooldown_seconds, send_snapshot: rule.send_snapshot,
            message_template: rule.message_template, min_likelihood: rule.min_likelihood,
            show_open_link: rule.show_open_link, title_template: rule.title_template,
            subtitle_template: rule.subtitle_template, text_position: rule.text_position,
            // T2: ต้องคืนสองค่านี้ด้วย — หน้าจออ่านไปตั้ง select แล้วส่งกลับตอนบันทึก ถ้าไม่คืน
            // หน้าจอจะขึ้น LINE เสมอ และกดบันทึกค่าอื่นทีหลังจะเขียนทับกลับเป็น 'line'
            // เงียบ ๆ (audit T2 2026-09-24)
            deliver_via: rule.deliver_via || 'line', telegram_chat_ids: rule.telegram_chat_ids || [],
          } : null,
          status: await statusFor(rule),
        });
      }
      // Edge Offline ไม่มีแถวใน alert_rules (เก็บใน line_config.edge_alert) แต่หน้าจอ
      // ต้องการบรรทัดสถานะแบบเดียวกัน — ดึงจาก alert_logs ที่เพิ่งเริ่มบันทึก (2026-08-13)
      const { rows: ecfg } = await pool.query(
        `SELECT edge_alert FROM line_config WHERE id = 1`);
      const ea = ecfg[0]?.edge_alert || {};
      const { rows: elog } = await pool.query(
        `SELECT max(sent_at) FILTER (WHERE status = 'sent') AS last_sent,
                count(*) FILTER (WHERE status = 'sent'
                                   AND sent_at > NOW() - INTERVAL '24 hours')::int AS n_24h
           FROM alert_logs WHERE rule_name IN ('Edge Offline', 'Edge Data Loss')`);
      // ⚠️ ต้องนับทั้งสองชื่อ — สวิตช์ edge_alert ตัวเดียวคุมการแจ้งเตือน 2 อย่าง
      // (ขาดการติดต่อ + ทำข้อมูลหาย, เพิ่ม 2026-08-14) ถ้านับแต่ 'Edge Offline'
      // การเตือนข้อมูลหายจะส่งออกไปจริงแต่บรรทัดสถานะขึ้นว่า "ยังไม่เคยส่ง"
      out.push({
        channel: 'edge', label: 'สุขภาพ Edge (ขาดการติดต่อ / ข้อมูลหาย)', configured: true, rule: null,
        status: {
          // Edge ใช้ cooldown เป็นชั่วโมง ต่างจากกฎอื่นที่เป็นวินาที — แปลงให้หน่วยเดียวกัน
          cooldown_seconds: (ea.cooldown_hours ?? 4) * 3600,
          send_snapshot: false,
          push_count: 0,
          recipient_count: (ea.recipient_ids || []).length,
          enabled: ea.enabled !== false,
          last_triggered_at: elog[0]?.last_sent || null,
          last_sent_at: elog[0]?.last_sent || null,
          sent_24h: elog[0]?.n_24h || 0,
          failed_24h: 0,
          trigger_count: null,
        },
      });
      res.json(out);
    } catch (e) { routeError(res, e, 'GET /api/alert-channels'); }
  });

  // PUT /api/alert-channels/:channel — สร้างแถวให้ถ้ายังไม่มี แล้วอัปเดต
  // 🔴 admin เท่านั้น — เดิมไม่มีด่านเลย viewer ที่ล็อกอินเปลี่ยนผู้รับ LINE/Telegram ของช่องทางในตัวได้
  // (พบจากตัวสแกน route เขียนที่ไม่มีด่าน 2026-10-02 · GOTCHAS #217) · route /test ข้างล่างเป็น requireAdmin อยู่แล้ว
  app.put('/api/alert-channels/:channel', auth.requireAdmin, async (req, res) => {
    const ch = String(req.params.channel);
    if (!CHANNELS[ch]) return res.status(404).json({ error: 'ไม่รู้จักช่องทางนี้' });
    const b = req.body || {};
    // T2b: validation เดียวกับ T2a เดิม ย้ายไปเป็นฟังก์ชันกลาง (deliverViaValidate.js)
    // ให้ alert-rules.js (กฎที่ผู้ใช้สร้างเอง) เรียกซ้ำได้ — พฤติกรรม/ข้อความ error เหมือนเดิมทุกประการ
    let existingChatIds = [];
    if (ch !== 'lpr' && b.deliver_via === 'telegram' && b.telegram_chat_ids === undefined) {
      // ไม่ได้ส่งรายการมาในคำขอนี้ = ใช้ที่บันทึกไว้แล้ว (เปลี่ยนแค่ช่องทางต้องไม่ถูกปฏิเสธ)
      const { rows } = await pool.query('SELECT telegram_chat_ids FROM alert_rules WHERE channel = $1', [ch]);
      existingChatIds = rows[0]?.telegram_chat_ids || [];
    }
    const v = await validateDeliverVia(pool, {
      deliverVia: b.deliver_via, telegramChatIds: b.telegram_chat_ids,
      isLprChannel: ch === 'lpr', existingChatIds,
    });
    if (v.error) return res.status(400).json({ error: v.error });
    try {
      const { rows: cur } = await pool.query('SELECT id FROM alert_rules WHERE channel = $1', [ch]);
      let id = cur[0]?.id;
      if (!id) {
        // สร้างครั้งแรก — ตั้ง rule_names ตามช่องทางให้เลย ผู้ใช้ไม่ต้องรู้ชื่อภายใน
        // ⚠️ message_template ต้องเป็น NULL ชัด ๆ — คอลัมน์นี้มี DB default เป็น
        // template ทั่วไป ('🚨 [{camera}] {rule}…') ถ้าปล่อยให้ default ทำงาน
        // ช่องทาง LPR จะเปลี่ยนข้อความการ์ดเองทันทีที่สร้างแถว โดยไม่มีใครสั่ง
        const { rows } = await pool.query(
          `INSERT INTO alert_rules (name, enabled, channel, rule_names, recipient_ids,
                                    cooldown_seconds, message_template)
           VALUES ($1, false, $2, $3, ARRAY[]::text[], 60, NULL) RETURNING id`,
          [CHANNELS[ch].th, ch, CHANNELS[ch].ruleNames]);
        id = rows[0].id;
      }
      const fields = ['enabled', 'camera_ids', 'recipient_ids', 'push_user_ids', 'cooldown_seconds',
                      'send_snapshot', 'message_template', 'list_types', 'min_likelihood',
                      'show_open_link', 'title_template', 'subtitle_template', 'text_position',
                      'deliver_via', 'telegram_chat_ids'];
      const sets = [], vals = [];
      let i = 1;
      for (const f of fields) {
        if (b[f] === undefined) continue;
        let v = b[f];
        if (f === 'text_position') v = v === 'above' ? 'above' : 'below';
        if (f === 'title_template' || f === 'subtitle_template' || f === 'message_template') v = v || null;
        if (f === 'list_types') v = Array.isArray(v) && v.length ? v : null;
        if (f === 'telegram_chat_ids') v = (Array.isArray(v) ? v : []).map(String);
        sets.push(`${f} = $${i++}`); vals.push(v);
      }
      // 🔒 rule_names ของช่องทางแก้จากหน้าจอไม่ได้ — เป็นชื่อภายในที่ต้องตรงกับตัวส่ง
      // ถ้าปล่อยให้แก้ จะกลับไปเป็นบั๊กเดิมที่ปล่อยว่างแล้วกินเหตุการณ์ของช่องทางอื่น
      if (sets.length) {
        vals.push(id);
        await pool.query(`UPDATE alert_rules SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals);
        // บันทึกว่าใครแก้ช่องทางไหน (ชื่อฟิลด์เท่านั้น ไม่มีค่า) — เดิมไม่มี จึงพิสูจน์ย้อนหลังไม่ได้ว่าช่วงที่
        // route นี้ไม่มีด่าน มีใครที่ไม่ใช่ admin แก้ผู้รับหรือไม่ (GOTCHAS #218) · log ล้มต้องไม่ทำให้การบันทึกล้ม
        pool.query(
          `INSERT INTO audit_log (user_id, username, action, details, ip_address) VALUES ($1, $2, 'alert_channel_update', $3, $4)`,
          [req.user?.id || null, req.user?.username || null,
           JSON.stringify({ channel: ch, fields: sets.map((x) => x.split(' = ')[0]) }), req.ip || null],
        ).catch((e) => console.warn('[alert-channels] audit log:', e.message));
      }
      pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
      const { rows } = await pool.query('SELECT * FROM alert_rules WHERE id = $1', [id]);
      res.json({ ok: true, rule: rows[0], status: await statusFor(rows[0]) });
    } catch (e) { routeError(res, e, 'PUT /api/alert-channels/:channel'); }
  });

  // POST /api/alert-channels/:channel/test — ส่งซ้ำการแจ้งเตือนล่าสุดของช่องทางนี้
  //
  // ทำไมส่ง "ของจริงล่าสุด" ไม่ใช่ข้อความปลอม: การทดสอบต้องเดินผ่านเส้นทางเดียวกับ
  // ของจริงทั้งหมด — template · ตัวแปร · รูปคู่ · หน้าตาการ์ด · ผู้รับ — ข้อความปลอม
  // จะผ่านแค่ครึ่งทางแล้วบอกว่า "ส่งได้" ทั้งที่ของจริงอาจพังตรงรูปหรือตัวแปร
  //
  // ⚠️ ใส่คำนำหน้าบอกว่าเป็นการทดสอบเสมอ — ส่งซ้ำการแจ้งเตือนบัญชีดำโดยไม่บอก
  // จะทำให้ผู้รับเข้าใจว่าเพิ่งเจอคนคนนั้นอีกครั้ง แล้วออกไปตามจับผิดเวลา
  app.post('/api/alert-channels/:channel/test', auth.requireAdmin, async (req, res) => {
    const ch = String(req.params.channel);
    if (!CHANNELS[ch]) return res.status(404).json({ error: 'ไม่รู้จักช่องทางนี้' });
    try {
      const { rows: rr } = await pool.query('SELECT * FROM alert_rules WHERE channel = $1', [ch]);
      const rule = rr[0];
      if (!rule) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่าช่องทางนี้' });

      // ผู้รับเฉพาะครั้งนี้ — ทดสอบหน้าตาการ์ดโดยไม่ต้องยิงหาทีมจริงทุกครั้ง
      // ตัวส่งกรองซ้ำอีกชั้นเสมอ ที่นี่ตรวจแต่เนิ่นเพื่อให้ error อ่านรู้เรื่อง
      const pickIds = await resolveTestRecipients(pool, req.body?.recipient_ids);
      if (pickIds && !pickIds.length) {
        return res.status(400).json({ error: 'ผู้รับที่เลือกใช้ไม่ได้ (ไม่รู้จัก หรือถูกปิดอยู่)' });
      }
      // LPR คัดผู้รับจาก lpr_sites/lpr_groups ของแต่ละคน ไม่ใช่ recipient_ids บนแถวนี้
      if (!pickIds && ch !== 'lpr' && !(rule.recipient_ids || []).length) {
        return res.status(400).json({ error: 'ยังไม่ได้เลือกผู้รับ — เลือกก่อนจึงจะทดสอบได้' });
      }

      // ── ป้ายทะเบียนเดินคนละเส้นทาง (lprLineAlert ไม่ผ่าน rule engine) ────
      // ต้องยิงผ่านตัวส่งของมันเอง ไม่งั้นการ์ดที่ได้จะไม่ใช่การ์ดจริงของ LPR
      if (ch === 'lpr') {
        const { rows: lg } = await pool.query(
          `SELECT event_id, rule_name, triggered_rule FROM alert_logs
            WHERE rule_name LIKE 'LPR: %' AND event_id IS NOT NULL AND status = 'sent'
            ORDER BY id DESC LIMIT 1`);
        if (!lg[0]) return res.status(400).json({ error: 'ยังไม่เคยส่งแจ้งเตือนป้ายทะเบียนสำเร็จ จึงไม่มีของจริงให้ส่งซ้ำ' });
        const groupId = lg[0].rule_name.slice('LPR: '.length);
        const plate = String(lg[0].triggered_rule || '').replace(/^watchlist:/, '');
        const { rows: ev } = await pool.query('SELECT * FROM events WHERE id = $1', [lg[0].event_id]);
        if (!ev[0]) return res.status(400).json({ error: 'ไม่พบ event เดิมแล้ว (อาจถูกล้างตามอายุข้อมูล)' });
        const out = await require('../helpers/lprLineAlert').sendLprAlert({
          pool, lineSender: require('../line-sender'), event: ev[0], plate,
          groupId, force: true, recipientIds: pickIds,
        });
        return res.json({ ok: true, event_id: lg[0].event_id, plate, lpr: out || null });
      }

      // ── GuruSquare Events Alarm เดินคนละเส้นทาง (gsAlarmLine ไม่ผ่าน rule engine
      // เหมือนกัน — ไม่มี `events.rule_name` ให้หา ใช้แถวล่าสุดของ gs_alarms แทน) ───
      if (ch === 'gs_alarm') {
        const { rows: ga } = await pool.query(
          `SELECT * FROM blacklist.gs_alarms ORDER BY id DESC LIMIT 1`);
        if (!ga[0]) return res.status(400).json({ error: 'ยังไม่มี Events Alarm ให้ส่งซ้ำ' });
        const out = await require('../helpers/gsAlarmLine').sendGsAlarm({
          pool, lineSender: require('../line-sender'), alarm: ga[0], force: true, recipientIds: pickIds,
        });
        return res.json({ ok: true, alarm_id: ga[0].id, plate: ga[0].plate, gs_alarm: out || null });
      }

      // หาเหตุการณ์ล่าสุดที่ช่องทางนี้เคยส่งจริง
      const { rows: lg } = await pool.query(
        `SELECT event_id FROM alert_logs
          WHERE rule_id = $1 AND event_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [rule.id]);
      let eventId = lg[0]?.event_id || null;

      // ยังไม่เคยส่ง → หาเหตุการณ์ที่ "เข้าเงื่อนไข" ล่าสุดแทน เพื่อให้ปุ่มใช้ได้ตั้งแต่วันแรก
      //
      // ⚠️ ต้องคาดเวลาไว้เสมอ: `events` ไม่มี index บน rule_name และมี ~294k แถว/วัน
      // เขียนแบบไม่จำกัดช่วงเวลาแล้ววัดจริง = ค้างเกิน 120 วินาที (2026-08-13)
      // จำกัด 3 วัน + statement_timeout ให้ตอบว่า "ไม่เจอ" แทนที่จะแขวนคำขอไว้
      // AuraFace ไม่มีทางเจอจาก `events.rule_name` เลย — ชื่อ 'AuraFace Blacklist Match'
      // เป็นชื่อสังเคราะห์ที่ยิงผ่าน pg_notify ไม่เคยถูกเขียนลงตาราง events
      // การจับคู่จริงอยู่ที่ face_blacklist_hits (30 แถว ณ 2026-08-13)
      let extra = null;
      if (ch === 'auraface') {
        // 🔴 ต้องดึงชุดเดียวกับที่ face-embed-worker ส่งตอนแจ้งเตือนจริง (refInfo)
        // ไม่งั้นปุ่มทดสอบจะโชว์การ์ดคนละหน้าตากับของจริง ซึ่งคือสิ่งเดียวที่ปุ่มนี้
        // มีไว้ป้องกัน · แก้ที่นี่แล้วต้องแก้ที่ face-embed-worker.js:78 ด้วยเสมอ
        const { rows } = await pool.query(
          `SELECT h.event_id, h.label, h.similarity, bl.group_id, bl.ref_image,
                  bl.notes AS bl_notes, sr.photo_path, sr.name AS ref_name,
                  sr.case_ref, sr.case_note, sr.updated_at AS ref_updated
             FROM face_blacklist_hits h
             LEFT JOIN face_blacklist bl ON bl.id = h.blacklist_id
             LEFT JOIN blacklist.source_records sr ON sr.id::text = bl.enrolled_ref
            WHERE h.event_id IS NOT NULL ${eventId ? 'AND h.event_id = $1' : ''}
            ORDER BY h.event_time DESC LIMIT 1`, eventId ? [eventId] : []);
        if (rows[0]) {
          eventId = eventId || rows[0].event_id;
          // ให้ตรงกับ payload ที่ face-embed-worker ยิงจริงทาง pg_notify **บวก**
          // ภาพอ้างอิง — ไม่มี ref_path การ์ดจะตกไปเป็น bubble รูปเดียว หน้าตา
          // ไม่เหมือนของ HCP (เจ้าของเจอ 2026-08-13)
          const sim = Number(rows[0].similarity);
          extra = {
            person_name: rows[0].label,
            rule_name: 'AuraFace Blacklist Match',
            list_type: 'blackList',
            watchlist: 'LabTest Alarm',   // ชื่อระบบที่เตือน ไม่ใช่ชื่อกลุ่มในโรสเตอร์
            similarity_pct: Number.isFinite(sim) ? (sim <= 1 ? sim * 100 : sim).toFixed(1) + '%' : undefined,
            ref_path: rows[0].photo_path || rows[0].ref_image || null,
            ref_info: {
              ref_name: rows[0].ref_name, case_ref: rows[0].case_ref,
              case_note: rows[0].case_note, ref_updated: rows[0].ref_updated,
              bl_notes: rows[0].bl_notes,
            },
          };
        }
      }

      if (!eventId && (rule.rule_names || []).length) {
        const client = await pool.connect();
        try {
          // SET LOCAL มีผลเฉพาะใน transaction — นอก transaction จะเงียบ ๆ ไม่ทำอะไร
          // และ SET ธรรมดาจะติดค้างไปกับ client ตัวนั้นใน pool ต่อคำขอถัดไป
          await client.query('BEGIN');
          await client.query(`SET LOCAL statement_timeout = 5000`);
          const { rows } = await client.query(
            `SELECT id FROM events
              WHERE event_time > NOW() - INTERVAL '3 days' AND rule_name = ANY($1)
              ORDER BY event_time DESC LIMIT 1`, [rule.rule_names]);
          eventId = rows[0]?.id || null;
        } catch (e) { console.warn('[alert-channels] หา event สำรอง:', e.message); }
        finally {
          await client.query('ROLLBACK').catch(() => {});   // อ่านอย่างเดียว — คืน SET LOCAL ทิ้ง
          client.release();
        }
      }
      if (!eventId) {
        return res.status(400).json({ error: 'ยังไม่เคยมีเหตุการณ์ของช่องทางนี้ให้ทดสอบ' });
      }

      const engine = require('../alert-engine');
      const out = await engine.sendTestForRule(pool, rule, eventId, extra, { recipientIds: pickIds });
      res.json({ ok: true, event_id: eventId, ...out });
    } catch (e) { routeError(res, e, 'POST /api/alert-channels/:channel/test'); }
  });
};

module.exports.CHANNELS = CHANNELS;
module.exports.resolveTestRecipients = resolveTestRecipients;
module.exports.resolveTestChats = resolveTestChats;
