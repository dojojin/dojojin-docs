// ============================================================
// Vigil Platform — Report Worker
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Standalone PM2 process that owns the scheduled-report loop.
// Crash-isolates Puppeteer from api-server: if Chrome dies here,
// PM2 restarts this worker; api-server stays online.
//
// Exposes a minimal HTTP server on 127.0.0.1:REPORT_WORKER_PORT for
// on-demand "run now" requests proxied from api-server (Option B, Step 3).
// ============================================================
'use strict';

require('dotenv').config({ quiet: true });
const env = require('./config');
const { Pool } = require('pg');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getSystemSetting } = require('./helpers/getSystemSetting');
const { ttlSecFromHours } = require('./helpers/signedImage');
// อายุลิงก์รูปรายงานที่แนบ LINE — อ่านจาก setting เดียวกับ alert-engine/lprLineAlert
// (2026-09-07: เดิม hardcode 172800 สองจุดในไฟล์นี้ ทำให้ค่าที่ตั้งใน Settings ไม่มีผลกับรายงาน)
async function _signedTtlSec() {
  try { return ttlSecFromHours(await getSystemSetting(pool, 'signed_image_expire_hours')); }
  catch (e) { console.warn('[report-worker] อ่าน signed_image_expire_hours ไม่ได้ ใช้ 48 ชม.:', e.message); return 172800; }
}

// ── DB pool ────────────────────────────────────────────────
const pool =   // 🔴 ไม่มี statement_timeout = query ค้างได้ไม่จำกัด · เจอจริง 2026-08-27:
  // query หนึ่งค้าง 34 ชั่วโมง ทำให้ autovacuum เก็บ dead tuple ไม่ได้ ตาราง events
  // บวมจนทั้งระบบช้า และหน้าสถิติว่างเปล่า · มีแค่ api-server ที่ตั้งค่านี้ไว้
  // รวมยอดข้ามเดือนเพื่อออกรายงาน — งานหนักโดยธรรมชาติ
new Pool({
  options: '-c statement_timeout=600000',
  ...env.db(),
  max: 3,
  application_name: 'report-worker',
});

pool.on('error', (err) => {
  console.error('[report-worker] pg pool error:', err.message);
});

const _workerStartedAt = Date.now();
let _lastSchedulerCheckAt = null;

// ── Constants ──────────────────────────────────────────────
// Base URL pointing back to api-server (not this worker).
// The report-renderer fetches stats data via HTTP — it must hit api-server.
const API_BASE_URL = `http://localhost:${env.int('API_PORT')}`;

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// Hard-fail if secret is missing: worker cannot render without a shared token.
const INTERNAL_API_TOKEN = (() => {
  const s = env.str('INTERNAL_API_SECRET');
  if (!s || s.length < 32) {
    console.error('[report-worker] INTERNAL_API_SECRET not set or too short — exiting');
    process.exit(1);
  }
  return s;
})();

const WORKER_PORT = env.int('REPORT_WORKER_PORT');

const REPORT_TITLE_TH = {
  daily: 'รายงานประจำวัน',
  weekly: 'รายงานรายสัปดาห์',
  monthly: 'รายงานรายเดือน',
  summary: 'รายงานสรุป',
  health: 'รายงานสุขภาพระบบ',
  face: 'รายงานการจดจำใบหน้า',
  lpr: 'รายงานป้ายทะเบียน',
};

// ── Helpers (copied from api-server — NOT moved to avoid touching those call sites) ──

async function getBrandForReport() {
  const b = {};
  try {
    const r = await pool.query("SELECT key, value FROM system_settings WHERE key LIKE 'brand_%'");
    for (const row of r.rows) {
      if (row.key === 'brand_name')          b.name = row.value;
      if (row.key === 'brand_tagline')       b.tagline = row.value;
      if (row.key === 'brand_primary_color') b.primary_color = row.value;
      if (row.key === 'brand_logo_path' && row.value) {
        b.logo_url = `${API_BASE_URL}/branding/${row.value}`;
      }
    }
  } catch { /* defaults */ }
  return b;
}

let _displayTz = 'Asia/Bangkok';
let _displayTzAt = 0;
async function getDisplayTz() {
  if (Date.now() - _displayTzAt < 60_000) return _displayTz;
  try {
    const r = await pool.query("SELECT value FROM system_settings WHERE key='display_timezone'");
    const v = r.rows[0]?.value;
    if (typeof v === 'string' && v.trim()) _displayTz = v.trim();
  } catch {}
  _displayTzAt = Date.now();
  return _displayTz;
}

// ── Date helpers (moved from api-server) ──────────────────

function todayDayOfMonthInTz(tz) {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  return parseInt(ymd.slice(8, 10), 10);
}

function todayDayOfWeekInTz(tz) {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const d = new Date(ymd + 'T00:00:00Z');
  return (d.getUTCDay() + 6) % 7;
}

function isLastDayOfMonthInTz(tz) {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const [y, m, d] = ymd.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d === lastDay;
}

// ── Scheduled report runner (moved from api-server) ───────

async function runScheduledReport(schedule) {
  const reportRenderer = require('./report-renderer');
  const lineSender = require('./line-sender');
  const { sendTelegramReport } = require('./helpers/reportTelegramLeg');
  const record = (status, err) => pool.query(
    `UPDATE report_schedules SET last_run_at = NOW(), last_status = $2, last_error = $3 WHERE id = $1`,
    [schedule.id, status, err ? String(err).slice(0, 500) : null]
  ).catch(() => {});
  // telegram_sent_count/telegram_total_recipients/telegram_error_message (migration 243)
  // เป็นคนละคอลัมน์จาก sent_count/total_recipients/error_message เดิมโดยสิ้นเชิง —
  // คอลัมน์เดิมยังหมายถึง LINE เท่านั้นเป๊ะเหมือนก่อน T5 (ไม่ใส่ = NULL = ตารางนี้
  // ไม่ได้ตั้ง Telegram ไว้ ไม่ใช่ "ส่งแล้วไม่มีใครได้")
  // ใส่คอลัมน์ telegram_* เฉพาะตอนมีขา Telegram จริง — ตารางที่ไม่ได้ตั้ง Telegram ใช้
  // INSERT รูปเดิมเป๊ะ (audit T5 2026-09-25): ถ้า report-worker บูตก่อน migration 243
  // (เช่นเครื่องรีบูต pm2 เริ่มทุกตัวพร้อมกัน) INSERT ที่อ้างคอลัมน์ใหม่จะล้มแล้วถูก
  // .catch() กลืนเงียบ ประวัติรายงาน **ทุกตาราง** จะหาย · แบบนี้เสี่ยงเฉพาะตารางที่ใช้ Telegram
  const logHistory = (fields) => {
    const withTg = fields.telegram_sent_count != null || fields.telegram_total_recipients != null
      || !!fields.telegram_error_message;
    const cols = ['schedule_id', 'report_type', 'range_from', 'range_to', 'image_layout',
      'file_path', 'recipients_sent', 'sent_count', 'total_recipients', 'status', 'error_message',
      'report_family', 'image_source'];
    const vals = [
      schedule.id, fields.report_type, fields.range_from || null, fields.range_to || null,
      fields.image_layout || null, fields.file_path || null, fields.recipients_sent || null,
      fields.sent_count || 0, fields.total_recipients || 0,
      fields.status, fields.error_message ? String(fields.error_message).slice(0, 500) : null,
      fields.report_family || null, fields.image_source || null,
    ];
    if (withTg) {
      cols.push('telegram_sent_count', 'telegram_total_recipients', 'telegram_error_message');
      vals.push(
        fields.telegram_sent_count != null ? fields.telegram_sent_count : null,
        fields.telegram_total_recipients != null ? fields.telegram_total_recipients : null,
        fields.telegram_error_message ? String(fields.telegram_error_message).slice(0, 500) : null);
    }
    return pool.query(
      `INSERT INTO report_history (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`,
      vals
    ).catch(() => {});
  };
  // ฟิลด์ telegram_* ของ sent.telegram (ผล sendTelegramReport) → object เดียวใส่ตรงๆ
  // ให้ logHistory ได้เลย · tg=null (ตารางนี้ไม่ได้ตั้ง Telegram) = ทุกฟิลด์เป็น undefined
  // ซึ่ง logHistory ข้างบนแปลงเป็น NULL ให้เอง
  const _tgFields = (tg) => tg ? {
    telegram_sent_count: tg.sentCount, telegram_total_recipients: tg.totalRecipients,
    telegram_error_message: tg.error || null,
  } : {};
  // ข้อความ error รวม LINE+Telegram — ใช้ตอนทั้งสองช่องส่งไม่สำเร็จ (หรือ LINE ไม่มีให้
  // ส่งและ Telegram ก็ส่งไม่ผ่าน) กันไม่ให้ last_error บอกแค่ "LINE ไม่พร้อม" ทั้งที่
  // Telegram ก็ล้มเหมือนกัน — tg เป็น null (ไม่ได้ตั้ง Telegram) = คืน lineErr เดิมเป๊ะ
  const _combineErr = (lineErr, tg) => (tg && tg.error) ? `${lineErr} · Telegram: ${tg.error}` : lineErr;

  try {
    // R4: Dispatch by report_family (or fallback to legacy report_type for health)
    const family = schedule.report_family || (schedule.report_type === 'health' ? 'health' : 'analytics');
    const brand = await getBrandForReport();
    let png, fname, rangeFrom, rangeTo, rangeLabel;
    const tzForName = await getDisplayTz();

    // ── ผู้รับ LINE — ใช้ร่วมกันทุก family ────────────────────────────
    // เดิมโค้ดส่วนนี้อยู่หลังสาขา face/lpr ซึ่ง return ก่อนเสมอ จึงเรียกจากในนั้นไม่ได้
    // แยกออกมาเพราะ face/lpr ส่ง LINE ได้แล้วเมื่อเจ้าของเปิดสวิตช์ (2026-08-24)
    async function resolveLineTarget() {
      const cfgRes = await pool.query('SELECT * FROM line_config WHERE id = 1');
      const cfg = cfgRes.rows[0];
      if (!cfg || !cfg.enabled || !cfg.channel_access_token) {
        return { error: 'LINE is not enabled / no channel access token' };
      }
      const roster = Array.isArray(cfg.recipients) ? cfg.recipients : [];
      let wanted = String(schedule.recipients || '').split(',').map(x => x.trim()).filter(Boolean);
      // ไม่ระบุผู้รับ = ส่งให้ผู้รับเริ่มต้นรายเดียว ไม่ใช่ทุกคนที่เปิดใช้งาน
      // ค่า default เดิมทำให้ตารางที่ปล่อยช่องผู้รับว่างยิงรายงานเข้าผู้รับจริงครบทั้ง 7 ราย
      // รวมกลุ่มลูกค้าและกลุ่มตำรวจ (23 ส.ค. 2569) — ตารางที่ตั้งใจส่งหลายคนต้องเลือกเอง
      if (wanted.length === 0) {
        const dflt = (await getSystemSetting(pool, 'line_default_recipient') || '').trim();
        wanted = dflt ? [dflt] : [];
      }
      const recipientIds = roster.filter(r => r.enabled && wanted.includes(r.id)).map(r => r.id);
      if (recipientIds.length === 0) return { error: 'no enabled LINE recipients' };
      return { cfg, recipientIds };
    }

    // ส่ง LINE ของรายงาน face/lpr ปิดไว้เป็นค่าเริ่มต้น — เหตุผลเดิมที่ปิดคือภาพใบหน้า
    // และป้ายทะเบียนจะไหลออกไปอยู่บน imgbb ของบุคคลที่สาม ตั้งแต่ 2026-08-24 รูปเสิร์ฟ
    // จากโดเมนเราเองแล้ว เหตุผลนั้นจึงหมดไป แต่การเปิดเป็นการตัดสินใจเชิง PDPA
    // ไม่ใช่เชิงเทคนิค จึงเปิดด้วยสวิตช์ และบังคับ allowImgbb:false ตลอด —
    // ลิงก์ของเราใช้ไม่ได้ = ไม่ส่ง ไม่ใช่ตกกลับไป imgbb
    // T5: ขา Telegram ต่อท้ายขา LINE เสมอ (ไม่ใช่ก่อน) — schedule.telegram_chat_ids
    // ว่าง = sendTelegramReport ไม่แตะ DB เลย (ดู helpers/reportTelegramLeg.js)
    // switch report_line_send_<fam> ปิด = คืนก่อนถึงตรงนี้ ⇒ ไม่ส่งทั้งสองช่องทาง
    async function sendSensitiveReport(fam, pngBuf, reportFile, rangeLbl) {
      const on = (await getSystemSetting(pool, `report_line_send_${fam}`)) === '1';
      if (!on) return { skipped: true };
      const sc2 = (schedule.section_config && typeof schedule.section_config === 'object') ? schedule.section_config : {};
      const ttl = sc2.title || REPORT_TITLE_TH[fam] || fam;
      const caption = `📊 ${ttl}\n${rangeLbl}`;

      const tgt = await resolveLineTarget();
      if (tgt.error) {
        // ไม่มี LINE ให้ส่ง — ตารางที่ตั้ง Telegram ไว้ยังต้องส่งได้ตามปกติ ไม่ใช่ถือว่า
        // ส่งไม่ได้ทั้งใบ (ตารางที่ตั้งใจใช้ Telegram อย่างเดียวไม่ได้เปิด LINE เลย)
        const telegram = await sendTelegramReport({ pool, telegramChatIds: schedule.telegram_chat_ids, pngBuffer: pngBuf, caption });
        if (telegram && telegram.sentCount > 0) {
          return { result: null, recipientIds: [], lineError: tgt.error, telegram };
        }
        return { error: _combineErr(tgt.error, telegram), telegram };
      }
      const result = await lineSender.sendReportToLine({
        token: tgt.cfg.channel_access_token,
        imgbbKey: tgt.cfg.imgbb_api_key,
        recipients: tgt.recipientIds,
        pngBuffer: pngBuf,
        caption,
        reportFile,
        allowImgbb: false,
        signedTtlSec: await _signedTtlSec(),
      });
      const telegram = await sendTelegramReport({ pool, telegramChatIds: schedule.telegram_chat_ids, pngBuffer: pngBuf, caption });
      return { result, recipientIds: tgt.recipientIds, telegram };
    }

    // ── R4: Face/LPR path (render first, BEFORE LINE config gate) ──────
    if (family === 'face') {
      try {
        const range = reportRenderer.computeScheduledRange(schedule.report_type);
        rangeFrom = range.from;
        rangeTo = range.to;
        rangeLabel = range.label;
        // Map report_type cadence to period string
        const periodMap = { daily: 'yesterday', weekly: 'week', monthly: 'month' };
        const period = periodMap[schedule.report_type] || 'today';
        png = await reportRenderer.renderFaceReportImage({
          baseUrl: API_BASE_URL,
          internalToken: INTERNAL_API_TOKEN,
          brand,
          period,
          sections: (schedule.section_config && typeof schedule.section_config === 'object') ? schedule.section_config : {},
          lang: 'th',
          site_id: schedule.site_id || null,
        });
        const fnameDate = new Date(rangeFrom).toLocaleDateString('sv', { timeZone: tzForName });
        fname = `report_face_${fnameDate}_${Date.now()}.png`;
        let fileOk = true;
        try { await fs.promises.writeFile(path.join(REPORTS_DIR, fname), png); }
        catch (e) { fileOk = false; console.error('[report-worker] เขียนไฟล์รายงานไม่สำเร็จ:', e.message); }
        const sent = await sendSensitiveReport('face', png, fileOk ? fname : null, rangeLabel);
        if (sent.skipped) {
          await record('success', null);
          await logHistory({
            report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
            image_layout: null, file_path: fileOk ? fname : null,
            recipients_sent: null, sent_count: 0, total_recipients: 0,
            status: 'success', report_family: 'face',
          });
          console.warn(`📅 schedule #${schedule.id} (face): สร้างรายงานแล้ว — การส่ง LINE ปิดอยู่ (report_line_send_face=0)`);
        } else if (sent.error) {
          // ไม่มีทั้ง LINE และ Telegram ที่ส่งได้เลย (byte-identical กับก่อน T5 เมื่อ
          // ตารางนี้ไม่ได้ตั้ง telegram_chat_ids — sent.telegram เป็น undefined)
          await record('failed', sent.error);
          await logHistory({
            report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
            image_layout: null, file_path: fileOk ? fname : null,
            status: 'failed', error_message: sent.error, report_family: 'face',
            ..._tgFields(sent.telegram),
          });
          console.warn(`📅 schedule #${schedule.id} (face): ${sent.error}`);
        } else if (sent.result === null) {
          // T5: LINE ไม่มีให้ส่ง (ปิด/ไม่มีผู้รับ) แต่ Telegram ส่งสำเร็จ — ยังนับว่า
          // ตารางนี้ "มีทางออก" ไม่ใช่ล้มเหลวทั้งใบ
          await record('success', null);
          await logHistory({
            report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
            image_layout: null, file_path: fileOk ? fname : null,
            recipients_sent: null, sent_count: 0, total_recipients: 0,
            status: 'success', report_family: 'face',
            ..._tgFields(sent.telegram),
          });
          console.warn(`📅 schedule #${schedule.id} (face): LINE ข้าม (${sent.lineError}) · Telegram ส่งแล้ว ${sent.telegram.sentCount}/${sent.telegram.totalRecipients}`);
        } else {
          const r = sent.result;
          await record(r.success ? 'success' : 'failed', r.success ? null : r.error);
          await logHistory({
            report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
            image_layout: null, file_path: fileOk ? fname : null,
            recipients_sent: sent.recipientIds.join(','), sent_count: r.sentCount || 0,
            total_recipients: r.totalRecipients || sent.recipientIds.length,
            status: r.success ? 'success' : 'failed',
            error_message: r.success ? null : r.error, report_family: 'face',
            image_source: r.imageSource,
            ..._tgFields(sent.telegram),
          });
          console.warn(`📅 schedule #${schedule.id} (face): ส่งแล้ว ${r.sentCount || 0}/${sent.recipientIds.length} [${r.imageSource}]${sent.telegram ? ` · Telegram ${sent.telegram.sentCount}/${sent.telegram.totalRecipients}` : ''}`);
        }
      } catch (e) {
        await record('failed', e.message);
        await logHistory({
          report_type: schedule.report_type, status: 'failed', error_message: e.message, report_family: 'face',
        });
        console.error(`📅 schedule #${schedule.id} (face) failed:`, e.message);
      }
      return;
    }

    if (family === 'lpr') {
      try {
        const range = reportRenderer.computeScheduledRange(schedule.report_type);
        rangeFrom = range.from;
        rangeTo = range.to;
        rangeLabel = range.label;
        const periodMap = { daily: 'yesterday', weekly: 'week', monthly: 'month' };
        const period = periodMap[schedule.report_type] || 'today';
        png = await reportRenderer.renderLprReportImage({
          baseUrl: API_BASE_URL,
          internalToken: INTERNAL_API_TOKEN,
          brand,
          period,
          sections: (schedule.section_config && typeof schedule.section_config === 'object') ? schedule.section_config : {},
          lang: 'th',
          site_id: schedule.site_id || null,
        });
        const fnameDate = new Date(rangeFrom).toLocaleDateString('sv', { timeZone: tzForName });
        fname = `report_lpr_${fnameDate}_${Date.now()}.png`;
        let fileOk = true;
        try { await fs.promises.writeFile(path.join(REPORTS_DIR, fname), png); }
        catch (e) { fileOk = false; console.error('[report-worker] เขียนไฟล์รายงานไม่สำเร็จ:', e.message); }
        const sent = await sendSensitiveReport('lpr', png, fileOk ? fname : null, rangeLabel);
        if (sent.skipped) {
          await record('success', null);
          await logHistory({
            report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
            image_layout: null, file_path: fileOk ? fname : null,
            recipients_sent: null, sent_count: 0, total_recipients: 0,
            status: 'success', report_family: 'lpr',
          });
          console.warn(`📅 schedule #${schedule.id} (lpr): สร้างรายงานแล้ว — การส่ง LINE ปิดอยู่ (report_line_send_lpr=0)`);
        } else if (sent.error) {
          await record('failed', sent.error);
          await logHistory({
            report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
            image_layout: null, file_path: fileOk ? fname : null,
            status: 'failed', error_message: sent.error, report_family: 'lpr',
            ..._tgFields(sent.telegram),
          });
          console.warn(`📅 schedule #${schedule.id} (lpr): ${sent.error}`);
        } else if (sent.result === null) {
          await record('success', null);
          await logHistory({
            report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
            image_layout: null, file_path: fileOk ? fname : null,
            recipients_sent: null, sent_count: 0, total_recipients: 0,
            status: 'success', report_family: 'lpr',
            ..._tgFields(sent.telegram),
          });
          console.warn(`📅 schedule #${schedule.id} (lpr): LINE ข้าม (${sent.lineError}) · Telegram ส่งแล้ว ${sent.telegram.sentCount}/${sent.telegram.totalRecipients}`);
        } else {
          const r = sent.result;
          await record(r.success ? 'success' : 'failed', r.success ? null : r.error);
          await logHistory({
            report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
            image_layout: null, file_path: fileOk ? fname : null,
            recipients_sent: sent.recipientIds.join(','), sent_count: r.sentCount || 0,
            total_recipients: r.totalRecipients || sent.recipientIds.length,
            status: r.success ? 'success' : 'failed',
            error_message: r.success ? null : r.error, report_family: 'lpr',
            image_source: r.imageSource,
            ..._tgFields(sent.telegram),
          });
          console.warn(`📅 schedule #${schedule.id} (lpr): ส่งแล้ว ${r.sentCount || 0}/${sent.recipientIds.length} [${r.imageSource}]${sent.telegram ? ` · Telegram ${sent.telegram.sentCount}/${sent.telegram.totalRecipients}` : ''}`);
        }
      } catch (e) {
        await record('failed', e.message);
        await logHistory({
          report_type: schedule.report_type, status: 'failed', error_message: e.message, report_family: 'lpr',
        });
        console.error(`📅 schedule #${schedule.id} (lpr) failed:`, e.message);
      }
      return;
    }

    // ── Health/Analytics path ────────────────────────────────────────────
    // T5: ไม่ return ทันทีอีกต่อไปเมื่อ LINE ไม่พร้อม — เก็บเป็น lineError แล้วเช็ค
    // ทีหลังว่าตารางนี้ตั้ง Telegram ไว้ไหม ก่อน T5 บล็อกนี้ return ทันทีเสมอเมื่อ
    // LINE ไม่พร้อม ทำให้ตารางที่ตั้งใจใช้ Telegram อย่างเดียว (ไม่เปิด LINE เลย)
    // จะไม่มีวันส่งอะไรออกไปได้เลย
    const cfgRes = await pool.query('SELECT * FROM line_config WHERE id = 1');
    const cfg = cfgRes.rows[0];
    let lineError = null;
    let recipientIds = [];
    if (!cfg || !cfg.enabled || !cfg.channel_access_token) {
      lineError = 'LINE is not enabled / no channel access token';
    } else {
      const roster = Array.isArray(cfg.recipients) ? cfg.recipients : [];
      let wanted = String(schedule.recipients || '').split(',').map(s => s.trim()).filter(Boolean);
      // ไม่ระบุผู้รับ = ส่งให้ผู้รับเริ่มต้นรายเดียว ไม่ใช่ทุกคนที่เปิดใช้งาน
      // ค่า default เดิมทำให้ตารางที่ปล่อยช่องผู้รับว่างยิงรายงานเข้าผู้รับจริงครบทั้ง 7 ราย
      // รวมกลุ่มลูกค้าและกลุ่มตำรวจ (23 ส.ค. 2569) — ตารางที่ตั้งใจส่งหลายคนต้องเลือกเอง
      if (wanted.length === 0) {
        const dflt = (await getSystemSetting(pool, 'line_default_recipient') || '').trim();
        wanted = dflt ? [dflt] : [];
      }
      recipientIds = roster.filter(r => r.enabled && wanted.includes(r.id)).map(r => r.id);
      if (recipientIds.length === 0) lineError = 'no enabled LINE recipients';
    }

    // ไม่มี LINE ให้ส่ง และตารางนี้ไม่ได้ตั้ง telegram_chat_ids เลย = ล้มเหลวเหมือน
    // ก่อน T5 เป๊ะ — fail-fast ก่อน render กัน Chrome เรนเดอร์ทิ้งเปล่าๆ
    const telegramConfigured = Array.isArray(schedule.telegram_chat_ids) && schedule.telegram_chat_ids.length > 0;
    if (lineError && !telegramConfigured) {
      await record('failed', lineError);
      await logHistory({
        report_type: schedule.report_type, image_layout: schedule.image_layout,
        status: 'failed', error_message: lineError, report_family: family,
      });
      console.warn(`📅 schedule #${schedule.id}: ${lineError} — skipped`);
      return;
    }

    // Analytics option set, stored in section_config since 2026-08-23 so a schedule
    // stops re-rendering the whole report regardless of what the operator picked.
    // node-postgres hands JSONB back already parsed, same as health_sections above.
    const sc = (schedule.section_config && typeof schedule.section_config === 'object') ? schedule.section_config : {};

    const title = sc.title || REPORT_TITLE_TH[family] || REPORT_TITLE_TH[schedule.report_type] || schedule.report_type;

    if (family === 'health') {
      const sections = Array.isArray(schedule.health_sections) && schedule.health_sections.length
        ? schedule.health_sections : null;
      png = await reportRenderer.renderHealthReportImage({
        baseUrl: API_BASE_URL,
        internalToken: INTERNAL_API_TOKEN,
        brand, sections,
        range: { preset: '7d' },
        lang: 'th',
        // ตารางของ Site Admin ผูก site_id เสมอ — เดิมไม่ส่งต่อ ทำให้รายงานสุขภาพรวมทุกไซต์ (renderer รับ site_id อยู่แล้ว)
        // ตาราง health ที่มีอยู่ทั้งหมด site_id = NULL (ตรวจ 2026-10-14) ⇒ ของเดิมไม่เปลี่ยน
        site_id: schedule.site_id || null,
      });
      rangeFrom  = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      rangeTo    = new Date().toISOString();
      rangeLabel = '7 วันล่าสุด';
    } else {
      // analytics (family === 'analytics')
      const range = reportRenderer.computeScheduledRange(schedule.report_type);
      rangeFrom  = range.from;
      rangeTo    = range.to;
      rangeLabel = range.label;
      // หน้าต่างเวลาในวัน (CR.2) — ต้องเห็นบนหัวรายงาน ไม่งั้นตัวเลขที่ถูกกรอง
      // จะอ่านเหมือนยอดทั้งวัน
      if (sc.tod?.from && sc.tod?.to) rangeLabel += ` (${sc.tod.from}–${sc.tod.to})`;
      png = await reportRenderer.renderReportImage({
        baseUrl: API_BASE_URL,
        internalToken: INTERNAL_API_TOKEN,
        from: range.from, to: range.to,
        brand, title, rangeLabel,
        layout: schedule.image_layout || 'compact',
        site_id: schedule.site_id || null,
        domains: Array.isArray(sc.domains) ? sc.domains : null,
        kpis:    Array.isArray(sc.kpis)    ? sc.kpis    : null,
        secs:    Array.isArray(sc.secs)    ? sc.secs    : null,
        catsort: sc.catsort || null,
        // cats_hide ไม่มี/ว่าง = ไม่ซ่อนหมวดไหน · showDelta/showPct ไม่มี = แสดง
        // ตารางที่บันทึกไว้ก่อนมีตัวเลือกเหล่านี้จึงส่งรายงานหน้าตาเดิมทุกประการ
        // `cats` คือรูปแบบเก่า (รายชื่อที่เลือก) ส่งต่อไปให้หน้าพิมพ์แปลงเอง
        // เพราะการแปลงต้องรู้ว่าข้อมูลชุดนั้นมีหมวดอะไรบ้าง ซึ่งรู้ตอนเรนเดอร์เท่านั้น
        catsHide:  Array.isArray(sc.cats_hide) && sc.cats_hide.length ? sc.cats_hide : null,
        catsLegacyShown: Array.isArray(sc.cats) && sc.cats.length ? sc.cats : null,
        showDelta: sc.showDelta !== false,
        showPct: sc.showPct !== false,
        todFrom: sc.tod?.from || null,
        todTo: sc.tod?.to || null,
        // CR.5 — summary reports need anchor date for the print page to compute windows
        rtype: schedule.report_type === 'summary' ? 'summary' : null,
        anchor: schedule.report_type === 'summary' && range.anchor ? range.anchor : null,
      });
    }

    const fnameDate = new Date(rangeFrom).toLocaleDateString('sv', { timeZone: tzForName });
    fname = `report_${family}_${fnameDate}_${Date.now()}.png`;
    let fileOk = true;
    try { await fs.promises.writeFile(path.join(REPORTS_DIR, fname), png); }
    catch (e) { fileOk = false; console.error('[report-worker] เขียนไฟล์รายงานไม่สำเร็จ:', e.message); }

    const caption = `📊 ${title}\n${rangeLabel}`;

    // T5: ขา Telegram ต่อท้ายขา LINE เสมอ — schedule.telegram_chat_ids ว่าง =
    // sendTelegramReport ไม่แตะ DB เลย (ดู helpers/reportTelegramLeg.js)
    if (lineError) {
      // LINE ไม่พร้อม (เก็บไว้ข้างบน) แต่ตารางนี้ตั้ง Telegram ไว้ (ไม่งั้น fail-fast
      // ไปแล้วก่อนหน้านี้) — ลองส่ง Telegram เดี่ยวๆ
      const telegram = await sendTelegramReport({ pool, telegramChatIds: schedule.telegram_chat_ids, pngBuffer: png, caption });
      if (telegram && telegram.sentCount > 0) {
        await record('success', null);
        await logHistory({
          report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
          image_layout: schedule.image_layout || null, file_path: fileOk ? fname : null,
          recipients_sent: null, sent_count: 0, total_recipients: 0,
          status: 'success', report_family: family,
          ..._tgFields(telegram),
        });
        console.warn(`📅 schedule #${schedule.id} (${family}): LINE ข้าม (${lineError}) · Telegram ส่งแล้ว ${telegram.sentCount}/${telegram.totalRecipients}`);
      } else {
        await record('failed', _combineErr(lineError, telegram));
        await logHistory({
          report_type: schedule.report_type, image_layout: schedule.image_layout,
          status: 'failed', error_message: _combineErr(lineError, telegram), report_family: family,
          ..._tgFields(telegram),
        });
        console.warn(`📅 schedule #${schedule.id}: ${lineError} — skipped`);
      }
      return;
    }

    // 2026-08-24: ลองลิงก์เซ็นชื่อจากโดเมนเราก่อน · ถ้าล้มใช้ imgbb ตามการตั้งค่า
    let allowImgbb = true;
    try { allowImgbb = (await getSystemSetting(pool, 'imgbb_fallback_enabled')) !== 'false'; }
    catch (e) { console.warn('[report-worker] อ่าน imgbb_fallback_enabled ล้ม โดยค่าเริ่มต้นให้เปิด'); }

    const result = await lineSender.sendReportToLine({
      token: cfg.channel_access_token,
      imgbbKey: cfg.imgbb_api_key,
      recipients: recipientIds,
      pngBuffer: png,
      caption,
      reportFile: fileOk ? fname : null,
      allowImgbb,
      signedTtlSec: await _signedTtlSec(),  // จาก signed_image_expire_hours (เดิม hardcode 48 ชม. — ดูข้างบนexpire_hours ถ้าจำเป็น)
    });
    const telegram = await sendTelegramReport({ pool, telegramChatIds: schedule.telegram_chat_ids, pngBuffer: png, caption });
    if (result.success) {
      await record('success', null);
      await logHistory({
        report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
        image_layout: schedule.image_layout || null, file_path: fileOk ? fname : null,
        recipients_sent: recipientIds.join(','), sent_count: result.sentCount,
        total_recipients: result.totalRecipients || recipientIds.length, status: 'success',
        report_family: family, image_source: result.imageSource,
        ..._tgFields(telegram),
      });
      console.log(`📅 schedule #${schedule.id} (${family}) → sent to ${result.sentCount} LINE recipient(s) [${result.imageSource}]`);
    } else {
      const errMsg = result.error || `sent ${result.sentCount}/${result.totalRecipients}`;
      await record('failed', errMsg);
      await logHistory({
        report_type: schedule.report_type, range_from: rangeFrom, range_to: rangeTo,
        image_layout: schedule.image_layout || null, file_path: fileOk ? fname : null,
        recipients_sent: recipientIds.join(','), sent_count: result.sentCount || 0,
        total_recipients: result.totalRecipients || recipientIds.length,
        status: 'failed', error_message: errMsg, report_family: family, image_source: result.imageSource,
        ..._tgFields(telegram),
      });
      console.error(`📅 schedule #${schedule.id} → LINE send failed:`, result.error);
    }
  } catch (e) {
    const family = schedule.report_family || (schedule.report_type === 'health' ? 'health' : 'analytics');
    await record('failed', e.message);
    await logHistory({
      report_type: schedule.report_type, image_layout: schedule.image_layout,
      status: 'failed', error_message: e.message, report_family: family,
    });
    console.error(`📅 schedule #${schedule.id} failed:`, e.message);
  }
}

// ── Scheduler loop (moved from api-server) ────────────────

async function checkReportSchedules() {
  _lastSchedulerCheckAt = new Date().toISOString();
  try {
    const tz = await getDisplayTz();
    const nowHHMM = new Date().toLocaleTimeString('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    const { rows } = await pool.query('SELECT * FROM report_schedules WHERE enabled = true');
    for (const s of rows) {
      const sendHHMM = String(s.send_time).slice(0, 5);
      if (sendHHMM !== nowHHMM) continue;
      if (s.last_run_at) {
        const ranStr = new Date(s.last_run_at).toLocaleDateString('en-CA', { timeZone: tz });
        if (ranStr === todayStr) continue;
      }
      if ((s.report_type === 'weekly' || s.report_type === 'health') &&
          s.send_day_of_week !== null && s.send_day_of_week !== undefined) {
        if (todayDayOfWeekInTz(tz) !== s.send_day_of_week) continue;
      }
      if (s.report_type === 'monthly' && s.send_days_of_month) {
        const todayDom = todayDayOfMonthInTz(tz);
        const isLast = isLastDayOfMonthInTz(tz);
        const days = String(s.send_days_of_month).split(',').map(x => x.trim()).filter(Boolean);
        const match = days.some(spec => {
          if (spec.toUpperCase() === 'L') return isLast;
          const n = parseInt(spec, 10);
          return Number.isFinite(n) && n === todayDom;
        });
        if (!match) continue;
      }
      await runScheduledReport(s);
    }
  } catch (e) { console.error('📅 scheduler check failed:', e.message); }
}

setInterval(checkReportSchedules, 60 * 1000);

// ── On-demand HTTP server (Step 3) ────────────────────────
// Binds to 127.0.0.1 only — never reachable from outside the host.

function isValidInternalToken(token) {
  if (typeof token !== 'string' || token.length !== INTERNAL_API_TOKEN.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(INTERNAL_API_TOKEN));
  } catch { return false; }
}

// ── POST /render (VMOD-03) ────────────────────────────────
// api-server ยืมโปรเซสนี้เรนเดอร์รายงานที่คนกดดาวน์โหลดเอง เพื่อไม่ให้ Chromium
// เกิดในโปรเซส api-server · เรียกผ่าน helpers/renderViaWorker.js เท่านั้น
//
// allowlist ไม่ใช่ตัวประดับ — body มาจากเครือข่าย (แม้จะ loopback) การเรียก
// reportRenderer[fn] ตรง ๆ จากสตริงที่ส่งมาคือเรียกฟังก์ชันอะไรก็ได้ในโมดูลนั้น
const RENDER_FNS = new Set([
  'renderReportPdf', 'renderReportImage',
  'renderFaceReportImage', 'renderFaceReportPdf',
  'renderLprReportImage', 'renderLprReportPdf',
]);
// โลโก้ footer เป็น base64 ในตัว args (ของจริงวันนี้ 27 KB → base64 36 KB)
// 2 MB จึงเหลือที่ว่างเยอะ · นับระหว่างรับ ไม่ใช่รับครบแล้วค่อยวัด
const RENDER_BODY_LIMIT = 2 * 1024 * 1024;

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit && !tooLarge) {
        // ทิ้ง buffer แล้วปล่อยให้ไหลจนจบ — หน่วยความจำไม่โต และยังตอบ 400 กลับได้
        // (req.destroy() ตรงนี้จะฆ่า socket ทิ้ง ผู้เรียกได้ ECONNRESET แทนเหตุผล)
        tooLarge = true;
        chunks = [];
        req.resume();
        return;
      }
      if (!tooLarge) chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error(`body เกิน ${limit} bytes`), { tooLarge: true, size }));
        return;
      }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('body ไม่ใช่ JSON ที่อ่านได้')); }
    });
    req.on('error', reject);
  });
}

const workerServer = http.createServer(async (req, res) => {
  // Health endpoint — no token required, loopback-only
  if (req.method === 'GET' && req.url === '/health') {
    const t0 = Date.now();
    pool.query('SELECT 1')
      .then(() => {
        const body = {
          ok: true,
          worker: 'report-worker',
          uptime_sec: Math.floor((Date.now() - _workerStartedAt) / 1000),
          pid: process.pid,
          memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          db: { ok: true, latency_ms: Date.now() - t0 },
          scheduler: { last_check_at: _lastSchedulerCheckAt },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      })
      .catch((e) => {
        const body = {
          ok: false,
          worker: 'report-worker',
          uptime_sec: Math.floor((Date.now() - _workerStartedAt) / 1000),
          pid: process.pid,
          memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          db: { ok: false, latency_ms: null, error: e.message },
          scheduler: { last_check_at: _lastSchedulerCheckAt },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    return;
  }

  if (req.method === 'POST' && req.url === '/render') {
    if (!isValidInternalToken(req.headers['x-internal-token'])) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let body;
    try {
      body = await readJsonBody(req, RENDER_BODY_LIMIT);
    } catch (e) {
      if (e.tooLarge) console.warn(`[report-worker] /render ปฏิเสธ body ${e.size}+ bytes (เพดาน ${RENDER_BODY_LIMIT})`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
    const fn = body && body.fn;
    if (!RENDER_FNS.has(fn)) {
      console.warn(`[report-worker] /render ปฏิเสธ fn ที่ไม่อยู่ใน allowlist: ${JSON.stringify(fn)}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'fn not allowed' }));
      return;
    }
    const t0 = Date.now();
    try {
      const buf = await require('./report-renderer')[fn](body.args || {});
      console.log(`[report-worker] /render ${fn}: ${buf.length} bytes ใน ${Date.now() - t0} ms`);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length });
      res.end(buf);
    } catch (e) {
      console.error(`[report-worker] /render ${fn} ล้มเหลวหลัง ${Date.now() - t0} ms:`, e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  const match = req.method === 'POST' && /^\/run\/(\d+)$/.exec(req.url);
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  if (!isValidInternalToken(req.headers['x-internal-token'])) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const id = parseInt(match[1], 10);
  let row;
  try {
    const { rows } = await pool.query('SELECT * FROM report_schedules WHERE id = $1', [id]);
    if (!rows.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'schedule not found' }));
      return;
    }
    row = rows[0];
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
  runScheduledReport(row).catch((e) =>
    console.error(`[report-worker] on-demand run #${id} failed:`, e.message)
  );
});

workerServer.listen(WORKER_PORT, '127.0.0.1', () => {
  console.log(`[report-worker] HTTP listening on 127.0.0.1:${WORKER_PORT}`);
});

console.log(`[report-worker] started — scheduler 60s, api-server at ${API_BASE_URL}`);

// เพิ่มไว้ให้เทสต์ require ฟังก์ชันเดียวนี้ได้ (ดู test/telegram-t5-report-worker.test.js)
// โดยไม่แตะ side effect ตอน require ข้างบน (Pool จริง/HTTP listen/setInterval) —
// เทสต์ปลอม pg.Pool + http.createServer ก่อน require ไฟล์นี้แทน
module.exports = { runScheduledReport };
