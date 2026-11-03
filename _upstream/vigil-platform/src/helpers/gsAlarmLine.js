// ============================================================
// Vigil Platform — Helper: LINE alert for GuruSquare "Events Alarm"
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// blacklist.gs_alarms (migration 237) is GuruSquare's real-time `/alert` hit —
// a SEPARATE feed from the roster (blacklist.source_records) with its own
// text fields (cartype/carcolor/carbrand/platetype/owner/detail) that never
// went through the roster's raw_json shape. gsAlarmPoll.js inserts each row
// and calls sendGsAlarm() once per new alarm (see the `notify` hook there).
//
// This deliberately reuses as much of lprLineAlert.js as the shapes allow —
// same decision function (suppressionReason), same message builders
// (buildAlertText/buildAlertSections), same cooldown/hourly-cap tables (keyed
// on the pseudo group_id 'gs_alarm'), same lpr_plate_mutes table, and the same
// lineSender.sendAlert()+lprMeta call shape that produces the plate-headline
// compare card (buildLprFlexAlert). What it does NOT reuse is sendLprAlert()
// itself: that function's queries assume a `lpr_watchlist`/`lpr_watchlist_groups`
// row, which a GuruSquare alarm never has — the group here is fixed
// ('Events Alarm · GuruSquare'), not a roster row.
'use strict';

const fs = require('fs');
const path = require('path');
const { snapshotDir } = require('./snapshotDir');
const { vtypeLabel } = require('./lprLabels');
const { colorTh, typeTh, plateTh } = require('./lprRefLabels');
const { formatMessage, _dashboardEventLink } = require('../line-sender');
const {
  suppressionReason, buildAlertText, buildAlertSections,
  lprImageExpireSec, signedTtlSecFor, imgbbFallbackAllowed,
  agoTh, STALE_LABEL_SEC_DEFAULT,
} = require('./lprLineAlert');
const telegramCard = require('./telegramCard');
const { sendTelegramLeg, pickFallbackChats } = require('./notifier');

const SNAPSHOT_DIR = snapshotDir();
const REF_DIR = path.join(SNAPSHOT_DIR, 'lpr-watchlist');
const PHOTO_DIR = path.join(__dirname, '..', '..', 'blacklist-photos');

const COOLDOWN_SEC_DEFAULT = 300;   // 5 minutes — GuruSquare alarms are already ~2/day at HKT
const GROUP_ID = 'gs_alarm';        // pseudo group_id shared with lpr_alert_cooldown/lpr_alert_hourly
const GROUP_NAME = 'Events Alarm · GuruSquare';

// Copies a blacklist-photos/<rel> file into SNAPSHOT_DIR/lpr-watchlist/<destName>
// — same directory the B3 bridge already materializes reference photos into
// (blacklistBridge.js materializeBridgePhoto), so the LINE image path can stay
// a plain SNAPSHOT_DIR-relative filename the way sendAlert()/usableSignedUrl()
// expect. Already-copied files are left alone (no content-diff check — a
// GuruSquare alarm photo never changes after the alert fires, unlike the
// roster's bridge photos, so unconditional overwrite isn't needed here).
// copyFn is injectable so tests never touch the real filesystem.
function _copyPhoto(relSrc, destName, copyFn) {
  if (!relSrc) return null;
  const destRel = `lpr-watchlist/${destName}`;
  if (copyFn) { copyFn(relSrc, destRel); return destRel; }
  try {
    const src = path.join(PHOTO_DIR, String(relSrc));
    if (!src.startsWith(PHOTO_DIR) || !fs.existsSync(src)) return null;
    const dest = path.join(REF_DIR, destName);
    if (fs.existsSync(dest)) return destRel;
    fs.mkdirSync(REF_DIR, { recursive: true });
    fs.copyFileSync(src, dest);
    return destRel;
  } catch (e) {
    console.error('[gs-alarm-line] photo copy failed:', e.message);
    return null;
  }
}

// ── ค่าตั้งของช่องทางนี้ (alert_rules WHERE channel='gs_alarm') ─────────────
// 🔴 ไม่มีแถว = ปิด เสมอ — ต่างจาก lprChannel() ของ lprLineAlert.js ที่ไม่มีแถว
// แปลว่า "ทำงานเหมือนเดิมทุกอย่าง" (เพราะ LPR ทำงานมาก่อนหน้าตั้งค่าจะมีอยู่แล้ว)
// ช่องทางนี้เพิ่งสร้าง ไม่มีพฤติกรรมเดิมให้รักษา จึงต้องรอคนกดเปิดก่อนเสมอ
async function _channel(pool) {
  const { rows } = await pool.query(
    `SELECT id, enabled, cooldown_seconds, send_snapshot, message_template,
            show_open_link, title_template, subtitle_template, text_position, recipient_ids,
            deliver_via, telegram_chat_ids
       FROM alert_rules WHERE channel = $1`, [GROUP_ID]);
  return rows[0] || null;
}

function _log(pool, { chanId, alarm, eventId, cameraId, status, text, n, ms, err, imageSource, recipientsJson }) {
  return pool.query(
    `INSERT INTO alert_logs
       (rule_id, rule_name, event_id, camera_id, triggered_rule, event_time,
        status, message_text, recipient_count, error_message, duration_ms, image_source, recipients_json)
     VALUES ($11,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12,$13)`,
    ['GuruSquare: Events Alarm', eventId || null, cameraId || null,
     `${GROUP_ID}:${alarm.ext_id}`, alarm.alarm_time || new Date().toISOString(),
     status, text, n, err || null, ms, chanId || null, imageSource, recipientsJson]
  ).catch(e => console.error('[gs-alarm-line] log:', e.message));
}

// alert_logs row + blacklist.gs_alarms.line_status/line_sent_at in one place —
// every non-dryRun outcome (suppressed, sent, failed) goes through here so the
// two never drift apart (one records history, the other is what the LPR page
// shows next to the alarm row).
async function _finish(pool, { chanId, alarm, eventId, cameraId, status, text, n, ms, err, imageSource, recipientsJson, isTest = false }) {
  await _log(pool, { chanId, alarm, eventId, cameraId, status, text, n, ms, err, imageSource, recipientsJson });
  // ปุ่มทดสอบส่งซ้ำ alarm เก่า — ห้ามเขียนทับสถานะของ alarm จริง ไม่งั้นหน้า Events Alarm
  // จะขึ้นว่าแจ้งแล้วทั้งที่ของจริงอาจถูกข้าม (audit G4 2026-09-24) · ประวัติยังอยู่ใน alert_logs
  if (isTest) return { status, n, text };
  const sent = status === 'sent' || status === 'sent_manual';
  await pool.query(
    `UPDATE blacklist.gs_alarms
        SET line_status = $2, line_sent_at = CASE WHEN $3 THEN now() ELSE line_sent_at END
      WHERE id = $1`, [alarm.id, status, sent]
  ).catch(e => console.warn('[gs-alarm-line] gs_alarms status update:', e.message));
  return { status, n, text };
}

/**
 * The impure half — read state, decide, send, record. Never throws (mirrors
 * sendLprAlert): gsAlarmPoll.js calls this once per newly inserted row and a
 * LINE failure must never break polling or lose the row.
 */
async function sendGsAlarm({ pool, lineSender, alarm, force = false, dryRun = false,
                              recipientIds = null, manualBy = null, copyFn = null,
                              // manualChannel='telegram' — ปุ่ม "ส่งเข้า Telegram · ระบุเอง"
                              // (คู่กับ recipientIds ฝั่ง LINE) ดู sendLprAlert() สำหรับ
                              // เหตุผลเดียวกันทั้งหมด — ที่นี่แค่พอร์ตมาให้ตรงกัน
                              manualChannel = null, telegramChatIds = null }) {
  const manualTelegram = manualChannel === 'telegram';
  const started = Date.now();
  let recipients = [];
  let text = '';
  try {
    const { rows: cfgRows } = await pool.query(
      'SELECT enabled, channel_access_token, imgbb_api_key, recipients FROM line_config WHERE id = 1');
    const cfg = cfgRows[0] || {};
    const chan = await _channel(pool);

    // 🔒 เหมือน sendLprAlert: ผู้รับต้องเป็นคนที่ cfg.recipients รู้จักและเปิดอยู่เท่านั้น
    recipients = (Array.isArray(recipientIds) && recipientIds.length)
      ? (cfg.recipients || []).filter(r => r && r.enabled !== false
                                        && recipientIds.map(String).includes(String(r.id)))
      : (cfg.recipients || []).filter(r => r && r.enabled !== false
                                        && (chan?.recipient_ids || []).includes(r.id));

    // ── ขา Telegram (T2/T3) — เหมือน sendLprAlert แต่ผู้รับเป็นรายชื่อ (telegram_chat_ids)
    // ไม่ใช่ตัวกรองไซต์/กลุ่มแบบ LPR (GuruSquare ไม่มีแนวคิด lpr_sites/lpr_groups
    // อยู่แล้ว — recipient_ids ของ LINE ก็เป็นรายชื่อแบบเดียวกันนี้)
    const deliverVia = chan?.deliver_via || 'line';
    const usesLine = manualTelegram ? false : deliverVia !== 'telegram';
    const usesTelegram = manualTelegram ? true : (deliverVia === 'telegram' || deliverVia === 'both');
    const usesFallback = manualTelegram ? false : deliverVia === 'line_then_telegram';
    const skipTelegram = !manualTelegram && Array.isArray(recipientIds) && recipientIds.length > 0;
    let telegramChats = [];
    let allTgChats = [];
    if ((usesTelegram || usesFallback) && !skipTelegram) {
      try {
        const { rows: tgRows } = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
        allTgChats = Array.isArray(tgRows[0]?.chats) ? tgRows[0].chats : [];
        if (usesTelegram) {
          // manualTelegram + telegramChatIds ระบุมา = ส่งเฉพาะแชทนั้น · ไม่ระบุ =
          // แชทที่ตั้งไว้ของช่องทางนี้ตามปกติ (chan.telegram_chat_ids)
          const wantIds = new Set(
            (manualTelegram && Array.isArray(telegramChatIds) && telegramChatIds.length
              ? telegramChatIds : (chan?.telegram_chat_ids || [])).map(String));
          telegramChats = allTgChats.filter(c => c && c.enabled !== false && wantIds.has(String(c.chat_id)));
        }
      } catch (e) { console.warn('[gs-alarm-line] อ่านแชท Telegram ไม่สำเร็จ:', e.message); }
    }

    const cooldownSec = chan?.cooldown_seconds ?? COOLDOWN_SEC_DEFAULT;
    const { rows: cdRows } = await pool.query(
      `SELECT GREATEST(0, $2::int - EXTRACT(epoch FROM (now() - last_sent_at))::int) AS remain
         FROM lpr_alert_cooldown WHERE plate_number = $1 AND group_id = $3`,
      [alarm.plate, cooldownSec, GROUP_ID]);
    const { rows: hrRows } = await pool.query(
      `SELECT sent FROM lpr_alert_hourly WHERE group_id = $1 AND hour_start = date_trunc('hour', now())`,
      [GROUP_ID]);
    const { rows: muteRows } = await pool.query(
      'SELECT muted_until FROM lpr_plate_mutes WHERE plate_number = $1', [alarm.plate]
    ).catch(() => ({ rows: [] }));

    const checks = {
      lineEnabled: !!cfg.enabled && !!cfg.channel_access_token,
      // ไม่มีแถว alert_rules = ปิด — ตรงข้ามกับ lprChannel() ตั้งใจ (ดูคอมเมนต์ _channel())
      channelEnabled: chan ? chan.enabled === true : false,
      groupNotify: true,     // ไม่มี "กลุ่ม" ให้ปิดแยก — ช่องทางทั้งช่องคุมด้วย channelEnabled แล้ว
      plateNotify: undefined,
      mutedUntil: muteRows[0]?.muted_until || null,
      recipientCount: (usesLine ? recipients.length : 0) + (usesTelegram ? telegramChats.length : 0),
      cooldownRemainingSec: cdRows[0]?.remain || 0,
      hourlySent: hrRows[0]?.sent || 0,
      eventAgeSec: alarm.alarm_time
        ? Math.max(0, Math.round((Date.now() - new Date(alarm.alarm_time).getTime()) / 1000))
        : null,
    };
    const reason = force ? null : suppressionReason(checks);

    // ── สิ่งที่กล้อง**เรา**เห็น (เฉพาะ capture_source='ours' มีข้อมูลนี้จริง) ────
    let event = null, lp = null;
    if (alarm.capture_source === 'ours' && alarm.matched_event_id && alarm.matched_event_time) {
      try {
        const { rows: evRows } = await pool.query(
          'SELECT * FROM events WHERE id = $1 AND event_time = $2',
          [alarm.matched_event_id, alarm.matched_event_time]);
        event = evRows[0] || null;
      } catch (e) { console.warn('[gs-alarm-line] event lookup:', e.message); }
      if (event) {
        try {
          const { rows: lpRows } = await pool.query(
            'SELECT vehicle_type, vehicle_color, region, plate_image FROM license_plates WHERE event_id = $1 LIMIT 1',
            [event.id]);
          lp = lpRows[0] || null;
        } catch (e) { console.warn('[gs-alarm-line] license_plates lookup:', e.message); }
      }
    }
    // ไม่มี event จริง (capture_source อื่น หรือ 'ours' ที่ event ถูกล้างตามอายุข้อมูลไปแล้ว)
    // → event สังเคราะห์: มีรูปให้ก็ต่อเมื่อเป็น lprresult (ก๊อบภาพมาไว้ในโฟลเดอร์ของเรา)
    if (!event) {
      let snapshotFilename = null;
      if (alarm.capture_source === 'lprresult' && alarm.capture_photo_path) {
        snapshotFilename = _copyPhoto(alarm.capture_photo_path, `gs_alarm_${alarm.ext_id}_cap.jpg`, copyFn);
      }
      event = { id: null, camera_id: null, event_time: alarm.alarm_time, snapshot_filename: snapshotFilename };
    }

    let siteName = null;
    try {
      const { rows: srcRows } = await pool.query(
        `SELECT s.name FROM blacklist.sources bs LEFT JOIN sites s ON s.code = bs.site_code WHERE bs.id = $1`,
        [alarm.source_id]);
      siteName = srcRows[0]?.name || null;
    } catch (e) { console.warn('[gs-alarm-line] site lookup:', e.message); }

    // สิ่งที่กล้องเราเห็น (จาก license_plates ของ event ที่จับคู่ได้) — ไม่มี event
    // จริงก็ไม่มีข้อมูลนี้ให้แสดง ต่างจาก ref ด้านล่างซึ่งมาจากตัว alarm เองเสมอ
    const camColor = colorTh(lp?.vehicle_color);
    const vehicleDesc = lp
      ? [vtypeLabel(lp.vehicle_type, 'th', ''), camColor ? `สี${camColor}` : ''].filter(Boolean).join(' · ')
      : '';

    // ── สิ่งที่ฐานข้อมูล (GuruSquare) บันทึกไว้ — มาจากคอลัมน์ของ alarm เองเสมอ
    const refColor = colorTh(alarm.carcolor);
    const ref = {
      plateNumber: alarm.plate || '',
      province: alarm.province || '',
      vehicle: [alarm.carbrand, typeTh(alarm.cartype), refColor ? `สี${refColor}` : '']
        .filter(Boolean).join(' · '),
      plate: plateTh(alarm.platetype),
      // gs_alarms มีช่องเดียว (`detail`) ที่บรรจุคดี ไม่ได้แยกคดี/รายละเอียดเหมือนโรสเตอร์
      // → ใส่ที่ case เท่านั้น เหลือ detail ว่าง (buildAlertText/Sections ตัดบรรทัดว่างทิ้งเอง)
      case: alarm.detail || '',
      detail: '',
      unit: alarm.owner || '',
      tier: 'GuruSquare',
      updated: '',
    };

    text = buildAlertText({
      groupName: GROUP_NAME, plate: alarm.plate, region: lp?.region || '',
      cameraName: alarm.camera_name || null, siteName, eventTime: alarm.alarm_time,
      vehicle: vehicleDesc, note: null, ref,
    });
    let sections = buildAlertSections({
      plate: alarm.plate, region: lp?.region || '',
      cameraName: alarm.camera_name || null, siteName, eventTime: alarm.alarm_time,
      vehicle: vehicleDesc, note: null, ref,
    });

    // ── ข้อความที่ผู้ใช้เขียนเอง — ตัวแปรชุดเดียวกับที่ formatMessage() รู้จักสำหรับ
    // ช่องทางป้ายทะเบียน (ดู line-sender.js V{}) ว่าง = ใช้ตารางอัตโนมัติ (เหมือน LPR)
    const gsVars = {
      event_time: alarm.alarm_time, plate: alarm.plate, region: lp?.region || '',
      group_name: GROUP_NAME, site_name: siteName || null,
      camera_name: alarm.camera_name || null, location: alarm.camera_name || null,
      vehicle_desc: vehicleDesc || null, note: null,
      ref_vehicle: ref.vehicle || null, ref_brand: alarm.carbrand || null,
      ref_type: typeTh(alarm.cartype) || null, ref_color: refColor || null,
      ref_plate: ref.plateNumber || null, ref_plate_type: ref.plate || null,
      ref_province: ref.province || null, ref_case: ref.case || null, ref_detail: ref.detail || null,
      ref_unit: ref.unit || null, ref_group: ref.tier || null, ref_tier: ref.tier || null,
      ref_updated: ref.updated || null, rule_name: 'GuruSquare Events Alarm',
    };
    const userTpl = (chan?.message_template || '').trim();
    if (userTpl) { text = formatMessage(userTpl, gsVars); sections = null; }

    if (dryRun) {
      return {
        dryRun: true, plate: alarm.plate, groupId: GROUP_ID, groupName: GROUP_NAME,
        wouldSend: !reason, blockedBy: reason,
        recipients: recipients.map(r => ({ id: r.id, name: r.name, type: r.type })),
        deliverVia, telegramChats: telegramChats.map(c => ({ chat_id: c.chat_id, name: c.name, type: c.type })),
        checks, text, cooldownSec,
      };
    }

    if (reason) {
      return _finish(pool, {
        chanId: chan?.id, alarm, eventId: event.id, cameraId: event.camera_id,
        status: reason, text, n: checks.recipientCount, ms: Date.now() - started,
      });
    }

    if (manualBy) text = `📣 [ส่งด้วยตนเองโดย ${manualBy}]\n${text}`;
    else if (force) text = `🧪 [ทดสอบระบบ — ไม่ใช่เหตุการณ์ใหม่]\n${text}`;
    else if (checks.eventAgeSec != null && checks.eventAgeSec > STALE_LABEL_SEC_DEFAULT) {
      text = `⏱ [ข้อมูลย้อนหลัง — เห็นเมื่อ ${agoTh(checks.eventAgeSec)}ที่แล้ว]\n${text}`;
    }

    // Claim BEFORE sending — same reasoning as sendLprAlert (two near-simultaneous
    // matches must not both pass the cooldown check).
    if (!force) {
      await pool.query(
        `INSERT INTO lpr_alert_cooldown (plate_number, group_id, last_sent_at)
         VALUES ($1, $2, now())
         ON CONFLICT (plate_number, group_id) DO UPDATE SET last_sent_at = now()`,
        [alarm.plate, GROUP_ID]);
      await pool.query(
        `INSERT INTO lpr_alert_hourly (group_id, hour_start, sent)
         VALUES ($1, date_trunc('hour', now()), 1)
         ON CONFLICT (group_id, hour_start) DO UPDATE SET sent = lpr_alert_hourly.sent + 1`,
        [GROUP_ID]);
    }

    // refImage: lpr_watchlist ref_image ก่อน (ถ้าป้ายนี้อยู่ในเฝ้าระวังด้วย) — ไม่มีค่อยก๊อบ
    // ภาพอ้างอิงของ GuruSquare เองมาไว้ในโฟลเดอร์เดียวกับที่ sendAlert() เซ็นลิงก์ได้
    let refImage = null;
    try {
      const { rows: wl } = await pool.query(
        `SELECT ref_image FROM lpr_watchlist
          WHERE plate_number = $1 AND active AND ref_image IS NOT NULL LIMIT 1`, [alarm.plate]);
      refImage = wl[0]?.ref_image || null;
    } catch (e) { console.warn('[gs-alarm-line] ref image lookup:', e.message); }
    if (!refImage && alarm.ref_photo_path) {
      refImage = _copyPhoto(alarm.ref_photo_path, `gs_alarm_${alarm.ext_id}.jpg`, copyFn);
    }

    // ปุ่ม "เปิดในระบบ" มีความหมายเฉพาะ capture_source='ours' — event สังเคราะห์
    // ไม่มีหน้าให้เปิด (ไม่มี id จริง) การส่ง show_open_link:true ไปเฉย ๆ จะได้ปุ่มที่กดแล้วพัง
    const wantLink = alarm.capture_source === 'ours' && (chan?.show_open_link !== false);

    let result = null;
    if (usesLine) {
      result = await lineSender.sendAlert({
        rule: {
          message_template: text,
          send_snapshot: chan ? chan.send_snapshot !== false : true,
          show_open_link: wantLink,
          title_template: chan?.title_template || null,
          subtitle_template: chan?.subtitle_template || null,
          text_position: chan?.text_position || 'below',
          name: GROUP_NAME,
          lprMeta: { plate: alarm.plate, region: lp?.region || '', refImage, sections,
                     groupName: GROUP_NAME, plateImage: lp?.plate_image || null,
                     cameraName: alarm.camera_name || null },
        },
        event, recipients, token: cfg.channel_access_token, imgbbKey: cfg.imgbb_api_key,
        pool,
        imgbbExpireSec: await lprImageExpireSec(pool),
        signedTtlSec: await signedTtlSecFor(pool),
        allowImgbb: await imgbbFallbackAllowed(pool),
      });
    }

    // ── ขา Telegram (T2) + สำรอง (T3) — การ์ดชุดเดียวกับ LINE (sections/text) ·
    // ลิงก์ "เปิดในระบบ" ใช้เงื่อนไข wantLink เดียวกับ LINE (capture_source='ours'
    // เท่านั้นถึงมีหน้าให้เปิด) — สร้างการ์ดครั้งเดียว ใช้ได้ทั้งขาตรงและขาสำรอง
    let tgCard = null;
    if ((usesTelegram && telegramChats.length) || usesFallback) {
      tgCard = telegramCard.fromSections({
        title: GROUP_NAME, plate: alarm.plate, region: lp?.region || '',
        sections, noteText: sections ? null : text,
        // เหมือน sendLprAlert — เฉพาะเส้นทางส่ง Telegram ด้วยมือเท่านั้น ไม่แตะขา
        // Telegram อัตโนมัติ/สำรอง
        // sections=null (พิมพ์ template เอง) → noteText = text ซึ่งมีป้ายนี้ติดอยู่แล้ว
        // ใส่ label ซ้ำจะเห็นป้ายสองครั้ง — ใส่เฉพาะตอนที่ sections ยังอยู่ (การ์ดตาราง
        // อัตโนมัติ ซึ่งไม่มีป้ายอยู่ในตัวมันเอง) เหมือน sendLprAlert
        label: (manualTelegram && manualBy && sections) ? `📣 ส่งด้วยตนเองโดย ${manualBy}` : null,
        link: wantLink ? _dashboardEventLink(event, 'lpr') : null,
      });
    }
    const tgImages = { plate: lp?.plate_image || null, scene: event.snapshot_filename || null, ref: refImage };
    const tgTtl = await signedTtlSecFor(pool);

    let tgResults = [];
    if (usesTelegram && telegramChats.length) {
      tgResults = await sendTelegramLeg({ pool, chats: telegramChats, card: tgCard, images: tgImages, signedTtlSec: tgTtl });
    }

    // ── T3: LINE ปฏิเสธด้วย "monthly limit" → ส่งการ์ดเดียวกันไปแชทที่ผูกไว้
    // (mirror_of_line_id) — ข้ามเสมอสำหรับปุ่มทดสอบ/ส่งเจาะจงผู้รับ (skipTelegram)
    // และปุ่มทดสอบระบบ/ส่งด้วยตนเอง (force) ตามสเปค T3
    let fbResults = [];
    if (usesFallback && !skipTelegram && !force && tgCard && result?.recipientsLog?.length) {
      const fbChats = pickFallbackChats(result.recipientsLog, recipients, allTgChats);
      if (fbChats.length) {
        const raw = await sendTelegramLeg({ pool, chats: fbChats, card: tgCard, images: tgImages, signedTtlSec: tgTtl });
        fbResults = raw.map(r => ({ ...r, fallback: true }));
      }
    }

    const lineLog = result?.recipientsLog || [];
    const totalSent = (result?.sentCount || 0) + tgResults.filter(r => r.ok).length + fbResults.filter(r => r.ok).length;
    const errs = [result?.error, tgResults.find(r => !r.ok && r.error)?.error, fbResults.find(r => !r.ok && r.error)?.error].filter(Boolean);
    const combinedLog = lineLog.concat(tgResults).concat(fbResults);
    return _finish(pool, {
      chanId: chan?.id, alarm, eventId: event.id, cameraId: event.camera_id,
      status: totalSent ? (manualBy ? 'sent_manual' : 'sent') : 'failed',
      text, n: totalSent, ms: Date.now() - started, err: errs.length ? errs.join('; ') : null,
      imageSource: result?.imageSource || null,
      recipientsJson: combinedLog.length ? JSON.stringify(combinedLog) : null,
      // manualTelegram เขียนทับ gs_alarms.line_status ไม่ได้ — คอลัมน์นี้ชื่อ line_status
      // ตรง ๆ (ผูกกับขา LINE เท่านั้นตามที่ตั้งชื่อไว้แต่ต้น) การส่ง Telegram ล้วนสำเร็จ/
      // ล้มเหลวไม่ควรไปเขียนทับสถานะ LINE ของแถวเดิม (ประวัติยังอยู่ครบใน alert_logs)
      isTest: manualTelegram ? true : (force && !manualBy),
    });
  } catch (e) {
    if (dryRun) return { dryRun: true, plate: alarm?.plate, groupId: GROUP_ID, wouldSend: false, error: e.message };
    console.error('[gs-alarm-line] send failed:', e.message);
    return _finish(pool, {
      alarm, status: 'failed', text, n: recipients.length, ms: Date.now() - started, err: e.message,
      isTest: manualTelegram ? true : (force && !manualBy),
    });
  }
}

module.exports = { sendGsAlarm, GROUP_ID, GROUP_NAME, COOLDOWN_SEC_DEFAULT };

if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(GROUP_ID, 'gs_alarm');
  console.log('gsAlarmLine self-check: all assertions passed');
}
