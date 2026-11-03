// ============================================================
// Vigil Platform — Helper: LINE alert for LPR watch-list hits
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// lpr_watchlist.notify_line has been stored and editable for months with no
// sender reading it. This is the sender.
//
// It deliberately does NOT go through alert_rules. That table keys on
// camera_ids + rule_names — "this camera doing this thing" — while an LPR alert
// fires on "this plate is on a list", a different axis entirely. Forcing it in
// would mean rules with an empty camera list carrying a special meaning, which
// is harder to read than a second small path. What IS shared: line-sender,
// line_config.recipients, and alert_logs, so LPR alerts appear in the same
// history as every other alert and nobody maintains two recipient systems.
//
// Volume, measured 2026-08-03: 4.6 hits a day across every site. That is what
// makes LINE the right channel here, unlike face capture at 47,000 a day.
//
// The decision half is pure and exported for the self-check at the bottom; the
// database and LINE calls live in sendLprAlert().
// ============================================================
'use strict';

const { vtypeLabel } = require('./lprLabels');
// pure function ตัวเดียว ไม่ใช่ circular (line-sender ไม่ได้ require ไฟล์นี้ — เช็คแล้ว)
const { formatMessage, _dashboardEventLink } = require('../line-sender');
const { refFields, colorTh } = require('./lprRefLabels');
const telegramCard = require('./telegramCard');
const { sendTelegramLeg, pickFallbackChats } = require('./notifier');

const HOURLY_CAP_DEFAULT = 20;

// ── อายุของเหตุการณ์ ณ ตอนจะส่ง (เจ้าของสั่ง 2026-09-12) ────────────────────
// เหตุการณ์มาถึงช้าได้จากหลายเหตุ — วันที่ตั้งค่านี้คือวันที่กล้องภูเก็ต 4 ตัวค้าง
// ไม่ส่งข้อมูล 9 ชั่วโมง แล้วคายออกมาทีเดียว ⇒ การ์ดตามจับรถ "ชนแล้วหนี" ไปถึง
// เจ้าหน้าที่ตอนหนึ่งทุ่ม สำหรับรถที่ผ่านกล้องไปตั้งแต่เที่ยง โดยไม่มีอะไรบอกว่าช้า
//
// เจ้าของตัดสิน: **เกิน 1 ชั่วโมงไม่ต้องส่งแล้ว ตามจับไม่ทันอยู่ดี**
// วัดย้อนหลัง 30 วันก่อนตั้งค่า: เกิน 1 ชม. มี 18 ใบ เป็นการส่งอัตโนมัติ 5 ใบ
// ที่เหลือ 13 ใบเป็น `sent_manual` ซึ่ง **ไม่ถูกกระทบ** เพราะปุ่ม "ส่งให้ตำรวจ"
// ส่งมาด้วย force:true (routes/lpr-alerts.js:195) ซึ่งข้าม suppressionReason ทั้งก้อน
// ⇒ ต้นทุนจริงของกฎนี้คือ 5 ข้อความ/เดือน ทั้งหมดเป็นของที่มาจากกล้องค้าง
//
// ช่วง 15–60 นาทีให้ส่งแต่ติดป้าย — ในข้อมูลจริงแทบไม่มี (30 วันมี 1 ใบ) แต่เก็บไว้
// เพราะมันเป็น **ตัวเฝ้า**: ถ้ากล้องตัวไหนเริ่มส่งช้าประจำ จะเห็นป้ายทุกใบก่อนที่มัน
// จะเลื่อนไปเกิน 1 ชม. แล้วเงียบหายไปโดยไม่มีใครรู้
const STALE_LABEL_SEC_DEFAULT = 15 * 60;   // ติดป้าย "ย้อนหลัง"
const STALE_MAX_SEC_DEFAULT   = 60 * 60;   // เกินนี้ไม่ส่ง LINE (ยังเก็บลงระบบตามปกติ)

// "44 นาที" / "1 ชม. 5 น." — ใช้บนป้ายย้อนหลังเท่านั้น จึงไม่ต้องรองรับหน่วยวัน
// (เกิน 1 ชม. ไม่ส่งอยู่แล้ว ป้ายจึงไม่มีทางเกินหลักชั่วโมงเดียว)
function _agoTh(sec) {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม. ${m % 60} น. `;
}

// How long a plate photo may sit on imgbb. Separate from the platform default
// (48h) at the owner's request: an ANPR frame on a third-party host is a heavier
// thing to leave lying around than a doorway alert, and the two should be
// tunable apart. Cached for a minute — this is read on the send path.
const LPR_IMG_EXPIRE_DEFAULT_H = 24;
let _expireCache = { sec: LPR_IMG_EXPIRE_DEFAULT_H * 3600, at: 0 };
async function lprImageExpireSec(pool) {
  if (Date.now() - _expireCache.at < 60000) return _expireCache.sec;
  try {
    const { rows } = await pool.query(
      "SELECT value FROM system_settings WHERE key = 'lpr_line_image_expire_hours'");
    const h = parseInt(rows[0]?.value, 10);
    if (Number.isFinite(h) && h >= 1 && h <= 720) _expireCache.sec = h * 3600;
  } catch (e) { console.warn('[lpr-line] expire cfg:', e.message); }
  _expireCache.at = Date.now();
  return _expireCache.sec;
}
const COOLDOWN_SEC_DEFAULT = 600;   // 10 minutes per plate per group

// ค่าตั้งร่วมของทั้งระบบ (migration 147) — cache สั้น ๆ เพราะอยู่บนเส้นทางส่ง
let _sysCache = { at: 0, ttl: 172800, allow: true };
async function _sysSettings(pool) {
  if (Date.now() - _sysCache.at < 60000) return _sysCache;
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM system_settings
        WHERE key IN ('signed_image_expire_hours','lpr_line_image_expire_hours',
                      'imgbb_fallback_enabled')`);
    const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
    // lpr_line_image_expire_hours มาก่อน (เจ้าของแจ้ง 2026-08-25)
    //
    // คีย์นี้ถูกสร้างไว้ตั้งแต่ 79aceca (4 ส.ค.) เพื่อคุมอายุรูปบน imgbb โดยเฉพาะ
    // ต่อมา 24 ส.ค. รูป LPR ย้ายมาใช้ลิงก์เซ็นของเราเองเป็นทางหลัก แต่ตัวอ่านค่ายัง
    // อ่านแค่ signed_image_expire_hours (48 ชม.) — ค่า 240 ที่ตั้งไว้จึงไม่มีผลกับ
    // ลิงก์ที่ส่งเข้า LINE จริง ทั้งที่หน้าตั้งค่าเขียนว่า "อายุลิงก์รูปป้ายทะเบียน"
    // ป้ายกับพฤติกรรมไม่ตรงกัน ตัวที่ต้องขยับคือพฤติกรรม ไม่ใช่ป้าย
    //
    // รูปป้ายทะเบียนมีอายุยาวกว่ารูปทั่วไปโดยตั้งใจ — คดีที่ต้องย้อนดูภาพรถมักตามมา
    // เป็นวัน ต่างจากภาพเหตุการณ์ประตูที่ดูจบภายในกะเดียว
    const hLpr = parseInt(m.lpr_line_image_expire_hours, 10);
    const hGen = parseInt(m.signed_image_expire_hours, 10);
    const h = (Number.isFinite(hLpr) && hLpr >= 1 && hLpr <= 720) ? hLpr : hGen;
    _sysCache.ttl = require('./signedImage').ttlSecFromHours(h);
    _sysCache.allow = m.imgbb_fallback_enabled !== 'false';
  } catch (e) { console.warn('[lpr-line] อ่านค่าตั้งรูปไม่สำเร็จ:', e.message); }
  _sysCache.at = Date.now();
  return _sysCache;
}
const signedTtlSecFor      = async (pool) => (await _sysSettings(pool)).ttl;
const imgbbFallbackAllowed = async (pool) => (await _sysSettings(pool)).allow;

// ── ค่าตั้งของช่องทางนี้ (alert_rules WHERE channel='lpr', migration 146) ────
// เดิม LPR ไม่มีหน้าตั้งค่าแจ้งเตือนของตัวเองเลย — cooldown/แนบรูป/หน้าตาการ์ด
// ตายตัวอยู่ในโค้ด แก้ไม่ได้ (เจ้าของชี้ 2026-08-13)
//
// สิ่งที่ **ไม่** ย้ายมา: ผู้รับ · เพราะ LPR เลือกผู้รับจาก lpr_sites/lpr_groups
// ของแต่ละคน ซึ่งละเอียดกว่ารายชื่อแบนของ alert_rules — เอามาแทนคือถอยหลัง
// และ message_template · เพราะข้อความประกอบจากโครงสร้าง (ป้าย/กล้อง/หมายเหตุ)
// ถ้าเปิดให้พิมพ์เอง ป้ายทะเบียนหลุดจากการ์ดได้เงียบ ๆ
let _chanCache = { row: null, at: 0 };
async function lprChannel(pool) {
  if (Date.now() - _chanCache.at < 30000) return _chanCache.row;
  try {
    const { rows } = await pool.query(
      `SELECT id, enabled, cooldown_seconds, send_snapshot, message_template,
              show_open_link, title_template, subtitle_template, text_position,
              deliver_via, telegram_chat_ids
         FROM alert_rules WHERE channel = 'lpr'`);
    _chanCache.row = rows[0] || null;
    // จำผลเฉพาะตอนอ่านสำเร็จ — ตอนบูต LISTEN เริ่มพร้อม migration (ไม่รอกัน) ถ้าอ่านพลาด
    // เพราะคอลัมน์ใหม่ยังไม่มา แล้วจำ "ไม่มีแถว" ไว้ 30 วินาที ค่าที่ตั้งของช่องทางนี้
    // จะถูกข้ามทั้งช่วงนั้น (reproduce ได้ 2026-09-24 ก่อน migration 241 รัน)
    _chanCache.at = Date.now();
  } catch (e) { console.warn('[lpr-line] อ่านค่าช่องทางไม่สำเร็จ:', e.message); }
  return _chanCache.row;
}

/**
 * Which recipients should hear about this hit.
 *
 * A missing or empty lpr_sites / lpr_groups means "everything" — that is what
 * keeps the three recipients configured before this feature existed behaving
 * exactly as they did, with nobody having to go and tick boxes.
 *
 * Site lives on the recipient rather than on the watch-list group on purpose: a
 * group is a KIND of vehicle and a site is a TEAM's patch. A wanted car is
 * wanted everywhere, so putting the site on the group would force one group per
 * site per kind — four groups times N sites, with the same plate needing a row
 * in several of them. Unmanageable by the third site.
 */
function selectRecipients(recipients, { siteCode, groupId }) {
  return (recipients || []).filter(r => {
    if (!r || !r.enabled) return false;
    // ปิดรับ "เฉพาะป้ายทะเบียน" ได้ทีละคน โดยไม่ต้องปิดคนนั้นทั้งระบบ (2026-08-13)
    // ⚠️ ไม่ได้ตั้ง (undefined) = รับ — ผู้รับทุกคนที่มีอยู่ก่อนฟีเจอร์นี้ต้องไม่เงียบไป
    if (r.lpr_enabled === false) return false;
    const sites  = Array.isArray(r.lpr_sites)  ? r.lpr_sites  : [];
    const groups = Array.isArray(r.lpr_groups) ? r.lpr_groups : [];
    // A hit from a camera with no site resolves to null: it can only reach
    // recipients who asked for everything, rather than vanishing silently.
    if (sites.length  && !(siteCode && sites.includes(siteCode))) return false;
    if (groups.length && !(groupId  && groups.includes(groupId))) return false;
    return true;
  });
}

/**
 * Everything that can stop a send, in the order the cost of checking rises.
 * Returns null to proceed, or a status string that goes straight into
 * alert_logs — the reason is always recorded, never a silent drop.
 */
function suppressionReason({
  lineEnabled, channelEnabled, groupNotify, plateNotify, mutedUntil, recipientCount,
  cooldownRemainingSec, hourlySent, hourlyCap = HOURLY_CAP_DEFAULT,
  eventAgeSec = null, staleMaxSec = STALE_MAX_SEC_DEFAULT,
}) {
  if (!lineEnabled)  return 'line_disabled';
  // ปิดจากแท็บ "ป้ายทะเบียน" ในหน้าตั้งค่าแจ้งเตือน — แยกจาก line_disabled
  // (ระบบ LINE ทั้งระบบปิด) เพื่อให้ alert_logs บอกได้ว่าใครเป็นคนปิด
  if (channelEnabled === false) return 'channel_disabled';
  if (!groupNotify)  return 'group_muted';
  // Per-plate opt-out. The group turns a category on; this turns one car off.
  if (plateNotify === false) return 'plate_muted';
  // ปิดชั่วคราวจากคำสั่งใน LINE — แยก reason จากการปิดถาวร ไม่งั้นดูปูมย้อนหลังแล้ว
  // แยกไม่ออกว่า "คนสั่งปิดไว้ 24 ชม." กับ "ปิดถาวรตั้งแต่เมื่อไหร่ไม่รู้"
  if (mutedUntil && new Date(mutedUntil).getTime() > Date.now()) return 'plate_muted_until';
  // Checked before cooldown: a hit nobody would receive should not consume the
  // cooldown window, or the next hit — which might have an audience — is
  // silenced by a send that never happened.
  if (!recipientCount) return 'no_recipients';
  // อยู่ **ก่อน** cooldown ด้วยเหตุผลเดียวกับ no_recipients ข้างบน: ใบที่เราไม่ส่ง
  // ต้องไม่ไปกินหน้าต่าง cooldown ไม่งั้นรถคันเดิมที่ผ่านกล้องสด ๆ ในอีก 5 นาที
  // จะถูกปิดปากด้วยการส่งที่ไม่เคยเกิดขึ้น
  //
  // ⚠️ เช็คนี้อยู่ใน suppressionReason โดยตั้งใจ — ปุ่ม "ส่งให้ตำรวจ" ส่ง force:true
  // ซึ่งข้ามฟังก์ชันนี้ทั้งก้อน ⇒ เจ้าหน้าที่ยังกดส่งเหตุการณ์เก่าให้ตำรวจได้เสมอ
  // ห้ามย้ายไปเช็คนอกฟังก์ชัน จะกลายเป็นปิดปากการตัดสินใจของคน
  if (eventAgeSec != null && eventAgeSec > staleMaxSec) return 'stale_skip';
  if (cooldownRemainingSec > 0) return 'cooldown_skip';
  if (hourlySent >= hourlyCap)  return 'hourly_cap_skip';
  return null;
}

// The note is free text copied from the upstream roster (GuruSquare writes one
// blob: contact · brand · colour · type · plate style · offence). It is not
// truncated, because the offence — the part an operator most needs — is at the
// END of that blob. The cap is a safety valve against a bad import, not
// formatting: the longest real note today is ~150 characters, and LINE rejects
// a message over 5000.
const NOTE_MAX = 500;

// Flex message text. The plate is the headline because it is what an operator
// matches against; everything else is context under it.
//
// ── ทำไมแบ่งเป็นสองบล็อก (2026-08-13) ────────────────────────────────────
// เดิมทุกอย่างกองรวมเป็นรายการเดียว แล้วปิดท้ายด้วย `note` ซึ่งเป็น blob ดิบจาก
// โรสเตอร์ ("ลักทรัพย์ · ยี่ห้อ ฮอนด้า · สี White · ประเภท Motorcycle ·
// ชนิดป้าย normal-white-black · ลักทรัพย์") — เจ้าหน้าที่อ่านแล้วแยกไม่ออกว่า
// อันไหนคือสิ่งที่กล้องเพิ่งเห็น อันไหนคือสิ่งที่ฐานข้อมูลบันทึกไว้
//
// สองอย่างนี้ **ไม่ตรงกันได้และต้องเห็นว่าไม่ตรง** — กล้องเห็นจักรยานยนต์สีดำ
// แต่โรสเตอร์ว่าสีขาว = อาจพ่นสีใหม่ อาจสลับป้าย หรืออาจอ่านป้ายผิด ทั้งสามอย่าง
// เปลี่ยนสิ่งที่เจ้าหน้าที่ต้องทำต่อ · การกลบให้เนียนเป็นก้อนเดียวคือการทิ้งข้อมูลนั้น
//
// บล็อกที่ไม่มีเนื้อหาจะไม่พิมพ์หัวข้อออกมา — รายการที่โรสเตอร์ไม่ได้กรอกอะไรเลย
// จึงได้ข้อความหน้าตาเหมือนเดิมทุกประการ
const _fmtTime = (v, locale = 'th-TH') => new Date(v).toLocaleString(locale, {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function buildAlertText({ groupName, plate, region, cameraName, siteName, eventTime, vehicle, note, ref },
                        lang = 'th') {
  const th = lang !== 'en';
  // ⚠️ ต้องระบุ timeZone เสมอ — ไม่ระบุ = ใช้ TZ ของเครื่องที่รัน ซึ่งวันนี้บังเอิญ
  // เป็น Asia/Bangkok แต่ไม่มีอะไรรับประกัน (container/เครื่อง edge ตั้งต่างกันได้)
  // เวลาผิดชั่วโมงบนการ์ดตามจับรถคือความผิดพลาดที่สังเกตยากและแพง · รูปแบบเดียวกับ
  // {time} ของ formatMessage เป๊ะ ๆ เพื่อให้ข้อความกับการ์ดพูดตรงกัน
  const t = eventTime ? _fmtTime(eventTime, th ? 'th-TH' : 'en-GB') : '';
  const head = (label) => `━━ ${label} ━━`;
  const lines = [
    `${groupName || (th ? 'เฝ้าระวัง' : 'Watch list')}`,
    `${plate}${region ? `  ${region}` : ''}`,
  ];

  // ── สิ่งที่กล้องเพิ่งเห็น ──────────────────────────────────
  // Camera and site on one line: a recipient who hears about every site cannot
  // tell Hat Yai from Phuket by camera name alone.
  const seen = [[cameraName, siteName].filter(Boolean).join(' · '), t, vehicle].filter(Boolean);

  // ── สิ่งที่ฐานข้อมูลเฝ้าระวังบันทึกไว้ ──────────────────────
  const r = ref || {};
  const known = [
    // แสดงเสมอ (แก้ 2026-08-31 พร้อมฝั่งการ์ด flex) — เดิมซ่อนเมื่อ "ตรงกับที่กล้อง
    // อ่านได้" ซึ่งพังในเคสอ่านตัดท้าย: 1กอ8835 ถูกอ่านเป็น 1กอ88 ตรงกับรายการ
    // 1กอ88 พอดี เลยไม่มีเลข DB บนการ์ดในจังหวะที่ต้องการมันที่สุด
    r.plateNumber ? `${th ? 'ในฐานข้อมูลคือ' : 'On file'} ${[r.plateNumber, r.province].filter(Boolean).join('  ')}` : '',
    r.vehicle,
    r.plate,
    (!r.plateNumber && r.province) ? `${th ? 'จดทะเบียน' : 'Registered'} ${r.province}` : '',
    r.case,
    r.detail,
    r.unit,
    r.updated ? `${th ? 'ต้นทางแก้ไขล่าสุด' : 'Source updated'} ${r.updated}` : '',
  ].filter(Boolean);

  // หัวข้อโผล่เมื่อ **มีทั้งสองบล็อก** เท่านั้น — มีบล็อกเดียวก็ไม่ต้องมีป้ายบอกว่า
  // กำลังแยกอะไรจากอะไร (ข้อความของรายการที่ไม่มีข้อมูลอ้างอิงจึงเหมือนเดิมเป๊ะ)
  const split = seen.length > 0 && known.length > 0;
  if (seen.length) {
    if (split) lines.push('', head(th ? 'จากกล้อง' : 'From the camera'));
    lines.push(...seen);
  }
  if (known.length) {
    if (split) lines.push('', head((th ? 'ข้อมูลอ้างอิง' : 'Reference') + (r.tier ? ` · ${r.tier}` : '')));
    lines.push(...known);
  }

  // note ดิบต่อท้ายเฉพาะตอนที่ยังไม่มีชุดข้อมูลที่แปลแล้ว — ไม่งั้นข้อมูลเดียวกัน
  // จะโผล่สองรอบ รอบหนึ่งอ่านออก อีกรอบเป็นคำของระบบต้นทาง
  if (note && !known.length) {
    const n = String(note);
    lines.push(`${th ? 'หมายเหตุ' : 'Note'}: ${n.length > NOTE_MAX ? n.slice(0, NOTE_MAX) + '…' : n}`);
  }
  return lines.join('\n');
}

// ── ตารางหัวข้อ/ค่าสำหรับการ์ด Flex (2026-08-26) ───────────────────────────
// ข้อมูลชุดเดียวกับ buildAlertText เป๊ะ ๆ แค่คืนเป็นโครงสร้างแทนสตริง เพราะเลย์เอาต์
// ที่เจ้าของอนุมัติจัดเป็นคอลัมน์ ซึ่งสตริงทำไม่ได้ (ฟอนต์ไทยไม่ใช่ความกว้างคงที่
// การเว้นวรรคให้ตรงกันจึงเป็นไปไม่ได้)
//
// buildAlertText ยังอยู่ครบ — ใช้กับ template ของกฎและกับข้อความสำรองเมื่อการ์ด
// ประกอบไม่ได้ ทั้งสองทางจึงพูดตรงกันเสมอเพราะอ่านจากอาร์กิวเมนต์ชุดเดียวกัน
function buildAlertSections({ plate, region, cameraName, siteName, eventTime, vehicle, note, ref }) {
  const t = eventTime ? _fmtTime(eventTime) : '';
  const r = ref || {};
  const out = [];

  const seen = [
    ['ทะเบียน', [plate, region].filter(Boolean).join('  '), true],
    ['ยานพาหนะ', vehicle],
    ['จุดตรวจ', [cameraName, siteName].filter(Boolean).join(' · ')],
    ['เวลา', t],
  ].filter(([, v]) => v);
  if (seen.length) out.push({ title: 'ข้อมูลจากกล้อง', rows: seen });

  // ⚠️ โรสเตอร์ของจริงเก็บข้อความเดียวกันไว้หลายช่อง — ตรวจ 2026-08-26 กับ ผธ4973:
  //   detail == unit เป๊ะ ๆ ("พบเห็นแจ้ง สภ.ถลาง ร.ต.อ. ... 0909157747")
  //   province == region ที่กล้องอ่านได้ ซึ่งขึ้นเป็นบรรทัดรองของการ์ดไปแล้ว
  // สตริงเดิมยอมให้ซ้ำได้เพราะ emoji นำหน้าคนละตัว แต่พอจัดเป็นคอลัมน์ ข้อความ
  // เดียวกันสองแถวติดกันอ่านเหมือนระบบพัง
  const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
  const same = (a, b) => !!a && !!b && norm(a) === norm(b);
  const _contains = (a, b) => !!a && !!b && norm(a).includes(norm(b));
  const known = [
    // 🔴 ทะเบียน/จังหวัดจากฐานข้อมูลแสดง **เสมอ** (แก้ 2026-08-31) — เดิมซ่อนเมื่อ
    // "ตรงกับที่กล้องอ่านได้" ซึ่งยืนบนสมมติฐานว่ากล้องอ่านถูก · เคสจริงที่หักล้าง:
    // รถ 1กอ8835 ถูกอ่านตัดท้ายเหลือ "1กอ88" ไปจับคู่กับรายการทดสอบ 1กอ88 พอดี
    // โค้ดเทียบแล้ว "ตรงกัน" จึงซ่อนเลขในบล็อกอ้างอิง — ทั้งที่นี่คือเคสที่เจ้าหน้าที่
    // ต้องเห็นเลขใน DB มากที่สุด เพื่อรู้ว่าการ์ดใบนี้จับคู่กับรายการไหน
    // "อ่านตรงกับรายการ" ไม่ใช่ "ถูกต้อง" — ค่าที่กล้องอ่านเชื่อไม่ได้ (การอ่านไม่ครบ
    // วัดจริง 182,229 ครั้ง/10 วัน) จึงห้ามเอามาเป็นเกณฑ์ตัดสินการแสดงค่าที่เชื่อได้
    // · กติกาซ่อนของช่องอื่นข้างล่าง (คดี/หน่วย/รายละเอียด) คงเดิม — นั่นคือการซ้ำ
    //   ภายใน DB เอง ไม่ได้เอาค่าจากกล้องมาตัดสิน คนละปัญหากัน
    // ทะเบียน+จังหวัดรวมบรรทัดเดียว รูปแบบเดียวกับบล็อก "ข้อมูลจากกล้อง" ข้างบน
    // (เจ้าของสั่ง 2026-09-01) · ถ้าโรสเตอร์มีแต่จังหวัดไม่มีเลข ให้คงป้าย "จดทะเบียน"
    // ไว้ตามเดิม — จังหวัดเดี่ยว ๆ ใต้หัวข้อ "ทะเบียน" อ่านแล้วเหมือนเลขหาย
    ['ทะเบียน', [r.plateNumber, r.plateNumber ? r.province : ''].filter(Boolean).join('  ')],
    ['ชนิดป้าย', r.plate],
    ['ยานพาหนะ', r.vehicle],
    ['จดทะเบียน', r.plateNumber ? '' : r.province],
    ['คดี', r.case, true],
    // ของจริง (ผธ4973) detail = "พบเห็นแจ้ง " + unit เป๊ะ ๆ — ไม่ใช่ซ้ำทั้งก้อน
    // แต่เป็นซ้ำแบบ "อีกช่องอยู่ข้างใน" จึงต้องเทียบด้วย includes ไม่ใช่ ===
    ['รายละเอียด', _contains(r.detail, r.unit) ? '' : r.detail],
    // ป้ายที่เพิ่มเองด้วยมือมักกรอกข้อความเดียวกันทั้งช่อง "คดี" และชื่อหน่วย
    // (2กก5078 = "รถทดสอบ VISION" ทั้งคู่) ขึ้นสองแถวติดกันอ่านเหมือนระบบพัง
    ['แจ้งเหตุที่', same(r.unit, r.case) ? '' : r.unit],
    ['ปรับปรุง', r.updated],
  ].filter(([, v]) => v);
  // note ดิบต่อท้ายเฉพาะตอนไม่มีชุดข้อมูลที่แปลแล้ว — ไม่งั้นข้อมูลเดียวกันโผล่สองรอบ
  if (note && !known.length) {
    const n = String(note);
    known.push(['หมายเหตุ', n.length > NOTE_MAX ? n.slice(0, NOTE_MAX) + '…' : n]);
  }
  if (known.length) {
    out.push({ title: 'ข้อมูลอ้างอิง' + (r.tier ? ` · ${r.tier}` : ' · บัญชีดำ'), rows: known });
  }
  return out.length ? out : null;
}

/**
 * The impure half: read state, decide, send, record. Never throws — it runs
 * fire-and-forget off the WebSocket broadcast path, which carries 300 events a
 * minute and must not wait on LINE or stall if LINE is down.
 *
 * Every outcome lands in alert_logs, including the suppressed ones. A silent
 * drop is what let notify_line sit unread for months.
 *
 * dryRun walks this exact path and then writes nothing — no cooldown claim, no
 * hourly tick, no LINE call, no alert_logs row — and returns the whole picture
 * instead of just the first blocker. That distinction matters: line_config is
 * deliberately still disabled, so a dry run that short-circuited at
 * `line_disabled` the way a real send does would answer none of the questions
 * it exists to answer (who would receive this, what would it say, what else
 * would have stopped it).
 */
async function sendLprAlert({ pool, lineSender, event, plate, region, siteCode, groupId, groupName,
                              dryRun = false, force = false, manualBy = null,
                              recipientIds = null,
                              // manualChannel='telegram' — ปุ่ม "ส่งเข้า Telegram · ระบุเอง"
                              // (คู่กับ recipientIds ฝั่ง LINE) ส่งเฉพาะขา Telegram เท่านั้น
                              // ไม่แตะขา LINE เลย ไม่ว่า deliver_via ของช่องทางจะตั้งเป็นอะไร
                              // telegramChatIds ว่าง/ไม่ส่งมา = ใช้แชทที่ตั้งไว้ของไซต์/กลุ่มนี้
                              // (selectRecipients ตัวเดียวกับ auto) เหมือนพฤติกรรม LINE ที่
                              // recipientIds ว่างแล้วใช้ผู้รับจริง
                              manualChannel = null, telegramChatIds = null }) {
  const manualTelegram = manualChannel === 'telegram';
  const started = Date.now();
  let recipients = [];
  let text = '';
  try {
    const { rows: cfgRows } = await pool.query(
      'SELECT enabled, channel_access_token, imgbb_api_key, recipients FROM line_config WHERE id = 1');
    const cfg = cfgRows[0] || {};

    const { rows: gRows } = await pool.query(
      'SELECT name, notify_line FROM lpr_watchlist_groups WHERE id = $1', [groupId]);
    const g = gRows[0] || {};

    // No group_id in this WHERE, and no ORDER BY, which is the shape that hid
    // the bridge's first-wins bug (25ed4be). Safe here for a structural reason,
    // checked not assumed: lpr_watchlist's primary key IS plate_number, so a
    // plate has exactly one row. Adding `AND group_id = $2` would in fact be
    // worse — it would return nothing if the plate moved group between the
    // watch-set refresh and this read.
    const { rows: wRows } = await pool.query(
      'SELECT notes, notify_line, blacklist_master_id FROM lpr_watchlist WHERE plate_number = $1', [plate]);
    const w = wRows[0] || {};

    // ชุดข้อมูลอ้างอิงจากโรสเตอร์ — ยี่ห้อ/ประเภท/สี/ชนิดป้าย/จังหวัดจดทะเบียน/
    // ประเภทคดี/หน่วยที่แจ้ง · เดิมมีแค่ notes ซึ่งเป็น blob ดิบก้อนเดียว
    // (เจ้าของสั่งให้แสดงเป็นชุดที่อ่านออก 2026-08-13)
    // อ่านเมื่อมีการจับคู่จริงเท่านั้น — 4.6 ครั้ง/วัน ไม่ใช่เส้นทางร้อน
    let ref = refFields(null);
    if (w.blacklist_master_id) {
      try {
        // Richest-wins: photo, then province, then longest case narrative, then
        // lowest source_id. Photo and province match bestRecordsByMaster()
        // (blacklistBridge.js) and the dashboard's alert detail modal
        // (page-lpr.js _lprLoadAlertMasterDetail) exactly; the note term here
        // reads raw_json.remark/owner_detail instead of case_note because that
        // is what refFields() below actually renders onto the LINE card — a
        // tie on photo+province could in principle rank differently between
        // this query and bestRecordsByMaster, though it does not on any master
        // seen so far.
        // Found 2026-08-19: this used to be `ORDER BY sr.imported_at DESC` — "most
        // recently imported wins" — which was harmless while GuruSquare was the
        // only LPR source touching most masters, but broke the moment HCP's LPR
        // side started auto-importing (today's fix): its plain, photo-less,
        // note-less copy of a plate is now often the newest record, so the LINE
        // card silently dropped GuruSquare's case note in favor of nothing.
        const { rows: sr } = await pool.query(
          `SELECT COALESCE(NULLIF(o.name,''), sr.name) AS name,
                  sr.case_ref, sr.raw_json, sr.plate_numbers,
                  o.updated_at AS ovr_updated,
                  o.brand, o.vehicle_type, o.vehicle_color, o.plate_type,
                  o.case_kind, o.province, o.photo_path
             FROM blacklist.master_links ml
             JOIN blacklist.source_records sr ON sr.id = ml.source_record_id
             LEFT JOIN blacklist.overrides o
               ON o.source_id = sr.source_id AND o.external_id = sr.external_id
            WHERE ml.master_id = $1
            ORDER BY (COALESCE(NULLIF(o.photo_path,''), sr.photo_path) IS NOT NULL) DESC,
                     (COALESCE(NULLIF(o.province,''), sr.raw_json->>'province') IS NOT NULL) DESC,
                     length(COALESCE(sr.raw_json->>'remark', sr.raw_json->>'owner_detail', '')) DESC,
                     sr.source_id
            LIMIT 1`, [w.blacklist_master_id]);
        if (sr[0]) {
          // migration 149 — ค่าที่คนแก้เองชนะค่าดิบเสมอ · ยัดทับลง raw_json ก่อนแปล
          // เพื่อให้ตารางแปล (lprRefLabels) ทำงานกับค่าที่แก้แล้วเหมือนค่าดิบทุกประการ
          // NULL = ไม่ได้แก้ (ไม่ใช่ "ตั้งเป็นว่าง") จึงต้อง ?? ไม่ใช่ ||
          const o = sr[0];
          const raw = { ...(o.raw_json || {}) };
          if (o.brand         != null) raw.carbrand     = o.brand;
          if (o.vehicle_type  != null) raw.cartype      = o.vehicle_type;
          if (o.vehicle_color != null) raw.carcolor     = o.vehicle_color;
          if (o.plate_type    != null) raw.platetype    = o.plate_type;
          if (o.case_kind     != null) raw.owner_detail = o.case_kind;
          if (o.province      != null) raw.province     = o.province;
          // "ปรับปรุงล่าสุด" = ครั้งล่าสุดที่ **ข้อมูลบนการ์ดใบนี้** เปลี่ยน ซึ่งมาได้ 3 ทาง
          //   raw_json.last_update  ต้นทางแก้เอง (โรสเตอร์ที่นำเข้ามา)
          //   o.updated_at          มีคนแก้ผ่านหน้าจอเรา (migration 149) ← ค่านี้แหละ
          //                         ที่การ์ดกำลังแสดงอยู่ ถ้าไม่นับจะบอกเวลาผิด
          //
          // เดิมอ่านแต่ตัวแรก — ป้ายที่เพิ่มเองด้วยมือไม่มี last_update เลย แถวนั้น
          // จึงหายไปทั้งบรรทัดเงียบ ๆ ทั้งที่เรารู้เวลาอยู่ (เจ้าของเจอ 2026-08-27)
          // เอาตัวใหม่สุด ไม่ใช่ตัวแรกที่เจอ — คำถามคือ "ข้อมูลนี้เก่าแค่ไหน"
          //
          // 🔴 **ห้ามเอา sr.updated_at มาร่วมด้วย** ถึงจะดูเข้าท่า — วัดจริง 2026-08-27
          // พบว่ามันเด้ง 1,960 แถวพร้อมกันในวันเดียว คือทั้งชุดตอน re-import ไม่ใช่
          // การแก้เนื้อหา · เอามาใช้แล้วทุกป้ายจะขึ้น "ปรับปรุงเมื่อวาน" ตลอดกาล
          // ซึ่งทำลายสิ่งเดียวที่บรรทัดนี้มีไว้บอก คือ "ข้อมูลนี้เก่าแค่ไหน"
          // (บทเรียนเดียวกับ B3 bridge: mtime/updated_at ใช้เป็นสัญญาณไม่ได้)
          const upd = [raw.last_update, o.ovr_updated]
            .map(v => (v ? new Date(v) : null))
            .filter(d => d && !Number.isNaN(d.getTime()))
            .sort((a, b) => b - a)[0] || null;
          ref = refFields(raw, o.name, o.case_ref,
            { plateNumber: (o.plate_numbers || [])[0] || '',
              updatedAt: upd ? upd.toISOString() : '' });
        }
      } catch (e) { console.warn('[lpr-line] อ่านข้อมูลอ้างอิงไม่สำเร็จ:', e.message); }
    }
    // ชื่อกลุ่มต้องเป็นชื่อที่คนอ่านออก ไม่ใช่รหัสในฐานข้อมูล — บางแหล่ง (เช่นป้ายที่
    // เพิ่มเอง) เก็บ "รหัสกลุ่มเฝ้าระวัง" ไว้ใน raw_json แทนคำอย่าง blacklist/watchlist
    // แล้วตารางแปลไม่รู้จัก จึงส่งค่าดิบออกไปเป็น "gmsbgdhh2" บนการ์ด
    // (เจ้าของเจอ 2026-08-13 · อาการเดียวกับ ghcp07 ของฝั่ง AuraFace)
    const groupLabel = g.name || groupName || null;
    if (groupLabel && (!ref.tier || ref.tier === groupId)) ref.tier = groupLabel;

    // Camera, site, and what the camera saw. Joined here rather than cached on
    // the hot path: this runs on watch-list hits only — 4.6 a day measured —
    // not on the 300 plate reads a minute that reach the broadcast.
    //
    // The vehicle fields are read HERE rather than taken from the caller's
    // event on purpose. The two callers hand in different shapes: the live path
    // passes an `events` row, which has vehicle_type but no vehicle_color;
    // the preview passes a license_plates row, which has both. Reading them at
    // one point means one message format regardless of who asked — the "two
    // callers, one assumption" divergence has cost this codebase four separate
    // silent bugs already.
    const { rows: camRows } = await pool.query(
      `SELECT c.name AS camera_name, s.code AS site_code, s.name AS site_name,
              lp.vehicle_type, lp.vehicle_color, lp.plate_image
         FROM cameras c
         LEFT JOIN sites s ON s.id = c.site_id
         LEFT JOIN license_plates lp ON lp.event_id = $2
        WHERE c.id = $1`, [event.camera_id, event.id || null]);
    const cam = camRows[0] || {};
    // The caller may already know the site; fall back to the join so a caller
    // that does not (the preview endpoint) still gets the routing right.
    const site = siteCode || cam.site_code || null;

    // ผู้รับเฉพาะครั้งนี้ (ปุ่มทดสอบ / ส่งเอง) — ข้ามตัวกรองไซต์/กลุ่มโดยตั้งใจ
    //
    // ถ้าไม่ข้าม การติ๊กชื่อตัวเองแล้วไม่ได้รับจะดูเหมือนระบบพัง ทั้งที่เป็นเพราะ
    // lpr_sites ของคนคนนั้นไม่ครอบคลุมไซต์ของเหตุการณ์ที่หยิบมาทดสอบ — คนกดทดสอบ
    // เลือกชื่อมากับมือแล้ว เจตนาชัดกว่าค่าที่ตั้งไว้ล่วงหน้า
    //
    // 🔒 แต่ยังกรองด้วย cfg.recipients เสมอ — ส่งได้เฉพาะผู้รับที่ระบบรู้จักและเปิดอยู่
    // ไม่ใช่ LINE id อะไรก็ได้ที่ยัดมาใน body
    recipients = (Array.isArray(recipientIds) && recipientIds.length)
      ? (cfg.recipients || []).filter(r => r && r.enabled !== false
                                        && recipientIds.map(String).includes(String(r.id)))
      : selectRecipients(cfg.recipients, { siteCode: site, groupId });

    // Read both counters before deciding, so the reason recorded is the real
    // first blocker rather than whichever query happened to run.
    const chan = await lprChannel(pool);

    // ── ขา Telegram (T2/T3) ──────────────────────────────────────────────
    // deliver_via ว่าง/ไม่มีแถว = 'line' เป๊ะ พฤติกรรมเดิมไม่เปลี่ยนเลย
    // 'line_then_telegram' (T3): LINE เป็นหลักเสมอ (usesLine=true) — สำรองไป
    // Telegram เฉพาะผู้รับที่ LINE ปฏิเสธด้วย "monthly limit" เท่านั้น (ดูหลัง
    // ขา LINE ส่งเสร็จด้านล่าง) ไม่ใช่ผู้รับทุกคนแบบ 'both'
    const deliverVia = chan?.deliver_via || 'line';
    // manualTelegram: ปุ่ม "ส่งเข้า Telegram · ระบุเอง" — ข้าม LINE เสมอ ไม่สน deliver_via
    const usesLine = manualTelegram ? false : deliverVia !== 'telegram';
    const usesTelegram = manualTelegram ? true : (deliverVia === 'telegram' || deliverVia === 'both');
    const usesFallback = manualTelegram ? false : deliverVia === 'line_then_telegram';
    // recipientIds มา = ปุ่มทดสอบเลือกผู้รับ LINE เจาะจง — ข้าม Telegram ไปเลย
    // (เจตนาของคนกดคือทดสอบ LINE คนที่เลือก ไม่ใช่ยิงลง Telegram ด้วย) — ครอบคลุม
    // ทั้งขา Telegram ตรง (T2) และขาสำรอง (T3) ด้วยธงเดียวกัน (สเปค T3: ปุ่มทดสอบ/
    // ส่งเจาะจงผู้รับ ต้องไม่ trigger fallback) · manualTelegram ไม่เกี่ยวกับ recipientIds
    // (คนละปุ่ม คนละช่องทาง) จึงไม่ให้ recipientIds มาบังขาที่เพิ่งสั่งให้ส่งตรงนี้
    const skipTelegram = !manualTelegram && Array.isArray(recipientIds) && recipientIds.length > 0;
    let telegramChats = [];
    let allTgChats = [];
    if ((usesTelegram || usesFallback) && !skipTelegram) {
      try {
        const { rows: tgRows } = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
        allTgChats = Array.isArray(tgRows[0]?.chats) ? tgRows[0].chats : [];
        // แชทของ Telegram มีฟิลด์ enabled/lpr_enabled/lpr_sites/lpr_groups ชุดเดียว
        // กับผู้รับ LINE — ใช้ตัวกรองเดียวกันเป๊ะ (selectRecipients) แทนที่จะมีสองชุด
        if (usesTelegram) {
          // ระบุแชทเอง (telegramChatIds ไม่ว่าง) = ส่งเฉพาะแชทนั้น (ยังต้องเปิดอยู่)
          // ว่าง = แชทที่ตั้งไว้ของไซต์/กลุ่มนี้ตามปกติ (เหมือนไม่ระบุ recipientIds ฝั่ง LINE)
          telegramChats = (manualTelegram && Array.isArray(telegramChatIds) && telegramChatIds.length)
            ? allTgChats.filter(c => c && c.enabled !== false
                                  && telegramChatIds.map(String).includes(String(c.chat_id)))
            : selectRecipients(allTgChats, { siteCode: site, groupId });
        }
      } catch (e) { console.warn('[lpr-line] อ่านแชท Telegram ไม่สำเร็จ:', e.message); }
    }

    const cooldownSec = chan?.cooldown_seconds ?? COOLDOWN_SEC_DEFAULT;
    const { rows: cdRows } = await pool.query(
      `SELECT GREATEST(0, $3::int - EXTRACT(epoch FROM (now() - last_sent_at))::int) AS remain
         FROM lpr_alert_cooldown WHERE plate_number = $1 AND group_id = $2`,
      [plate, groupId, cooldownSec]);
    const { rows: hrRows } = await pool.query(
      `SELECT sent FROM lpr_alert_hourly
        WHERE group_id = $1 AND hour_start = date_trunc('hour', now())`, [groupId]);

    const checks = {
      lineEnabled: !!cfg.enabled && !!cfg.channel_access_token,
      // ไม่มีแถว = ยังไม่เคยเปิดหน้าตั้งค่า → ทำงานเหมือนเดิมทุกอย่าง ไม่ใช่ปิดเงียบ
      channelEnabled: chan ? chan.enabled : true,
      groupNotify: !!g.notify_line,
      plateNotify: w.notify_line,
      mutedUntil: (await pool.query(
        'SELECT muted_until FROM lpr_plate_mutes WHERE plate_number = $1', [plate]
      ).catch(() => ({ rows: [] }))).rows[0]?.muted_until || null,
      // รวมทั้งสองช่องทาง — ช่องทางที่ตั้งเป็น 'telegram' ล้วนต้องไม่โดน no_recipients
      // เพราะ recipients (LINE) เป็น [] อยู่แล้วโดยไม่เกี่ยวกับว่ามีคนรอรับจริงไหม
      recipientCount: (usesLine ? recipients.length : 0) + (usesTelegram ? telegramChats.length : 0),
      cooldownRemainingSec: cdRows[0]?.remain || 0,
      hourlySent: hrRows[0]?.sent || 0,
      // อายุของเหตุการณ์ ณ ตอนตัดสินใจส่ง — ไม่ใช่ตอนที่มันเกิด
      // ไม่มี event_time (ไม่ควรเกิด แต่ถ้าเกิด) = null = ไม่เอาเกณฑ์นี้มาตัดสิน
      // ปล่อยให้ส่ง ดีกว่าเงียบเพราะข้อมูลขาด
      eventAgeSec: event?.event_time
        ? Math.max(0, Math.round((Date.now() - new Date(event.event_time).getTime()) / 1000))
        : null,
    };
    // ปุ่ม "ทดสอบส่ง" — ข้ามตัวกัน (cooldown/เพดานรายชั่วโมง/ปิดอยู่) แต่เดินเส้นทาง
    // เดิมทุกขั้น ผู้รับยังคัดจาก lpr_sites/lpr_groups ตามจริง ไม่ใช่ยิงหาทุกคน
    const reason = force ? null : suppressionReason(checks);

    // สีที่กล้องอ่านได้มาเป็นอังกฤษ ("black") เหมือนฝั่งโรสเตอร์ — แปลด้วยตารางเดียวกัน
    // ไม่งั้นบรรทัดเดียวมีทั้งไทยและอังกฤษปนกัน ("จักรยานยนต์ · black")
    const camColor = colorTh(cam.vehicle_color || event.vehicle_color);
    const vehicleDesc = [vtypeLabel(cam.vehicle_type || event.vehicle_type, 'th', ''),
                         camColor ? `สี${camColor}` : ''].filter(Boolean).join(' · ');

    text = buildAlertText({
      groupName: g.name || groupName, plate, region,
      cameraName: cam.camera_name || event.camera_name || event.camera_id,
      siteName: cam.site_name || null,
      eventTime: event.event_time,
      // The detector's own words ("twoWheelVehicle · black") are not a language
      // an operator reads. This line describes the vehicle the camera SAW; the
      // note below describes the one the roster WANTS, and a mismatch between
      // them is worth an operator noticing, so both stay.
      vehicle: vehicleDesc,
      note: w.notes || null,
      ref,
    });

    // ชุดเดียวกันในรูปตาราง สำหรับการ์ด Flex (buildAlertText ยังใช้กับข้อความสำรอง
    // และกับปุ่มพรีวิว จึงต้องประกอบทั้งสองทางจากอาร์กิวเมนต์ชุดเดียว)
    let sections = buildAlertSections({
      plate, region,
      cameraName: cam.camera_name || event.camera_name || event.camera_id,
      siteName: cam.site_name || null,
      eventTime: event.event_time,
      vehicle: vehicleDesc,
      note: w.notes || null,
      ref,
    });

    // ── ข้อความที่ผู้ใช้เขียนเอง (แท็บ "ป้ายทะเบียน" ในหน้าตั้งค่าแจ้งเตือน) ──────
    // ⚠️ ว่าง = ใช้ข้อความที่ระบบประกอบให้เหมือนเดิมเป๊ะ ไม่ใช่การ์ดเปล่า
    // (บั๊กแบบเดียวกับ rule_names ว่างแล้วกินเหตุการณ์ของช่องทางอื่น 2026-08-12)
    const lprVars = {
      ...event,
      camera_name: cam.camera_name || event.camera_name || event.camera_id,
      location: cam.camera_name ? (event.location || null) : event.location,
      plate, region: region || '',
      group_name: g.name || groupName || null,
      site_name: cam.site_name || null,
      vehicle_desc: vehicleDesc || null,
      note: w.notes || null,
      // ชุดรวม (ใช้บ่อยสุด) + ชุดแยกรายช่อง สำหรับคนที่อยากจัดวางเอง
      ref_vehicle: ref.vehicle || null,        // ยี่ห้อ · ประเภท · สี
      ref_brand: ref.brand || null,
      ref_type: ref.type || null,
      ref_color: ref.color || null,
      ref_plate: ref.plateNumber || null,      // เลขป้ายตามฐานข้อมูล ไม่ใช่ที่กล้องอ่าน
      ref_plate_type: ref.plate || null,       // สี/ชนิดป้าย
      ref_province: ref.province || null,
      ref_case: ref.case || null,
      ref_detail: ref.detail || null,
      ref_unit: ref.unit || null,
      ref_group: ref.tier || null,             // ชื่อที่เจ้าของเรียก
      ref_tier: ref.tier || null,              // ชื่อเดิม เก็บไว้ไม่ให้ template เก่าพัง
      ref_updated: ref.updated || null,        // ต้นทางแก้ไขล่าสุด
      rule_name: 'LPR Watchlist Match',
    };
    const userTpl = (chan?.message_template || '').trim();
    // 🔴 พิมพ์เอง = ต้องได้ตามที่พิมพ์ (เจ้าของสั่ง 2026-08-27 · กลับด้านจากตอนเช้า)
    //
    // เมื่อเช้าผมให้ตารางชนะเสมอ ด้วยเหตุผลว่า template ของกฎ #16 เป็น "ตาราง
    // เวอร์ชันอิโมจิ" ถ้าปล่อยให้ชนะ งานออกแบบใหม่จะไม่มีผลกับใคร — แต่นั่นแก้
    // ปัญหาเฉพาะหน้าด้วยการทำให้ช่องกรอกทั้งช่องกลายเป็นของหลอก ซึ่งเป็นกับดัก
    // แบบเดียวกับที่ไฟล์นี้เตือนไว้เองเรื่อง lpr_line_image_expire_hours
    // (ป้ายบอกอย่าง พฤติกรรมอีกอย่าง)
    //
    // กติกาที่ชัดและอธิบายได้: **ว่าง = ตารางอัตโนมัติ · พิมพ์ = ได้ตามที่พิมพ์**
    // ทั้งสองทางใช้ค่าตัวแปรชุดเดียวกัน จึงไม่มีทางที่ข้อมูลจะขัดกันเอง
    if (userTpl) { text = formatMessage(userTpl, lprVars); sections = null; }

    // Report, do not act. Every check is returned, not just the first failing
    // one, so a preview run against a disabled config still shows routing.
    if (dryRun) {
      return {
        dryRun: true, plate, region, groupId, groupName: g.name || groupName,
        siteCode: site, cameraName: cam.camera_name || event.camera_id,
        wouldSend: !reason, blockedBy: reason,
        recipients: recipients.map(r => ({ id: r.id, name: r.name, type: r.type })),
        // T2: ขา Telegram ที่ *จะ* ใช้จริงถ้าไม่ใช่ dry run — deliverVia บอกว่าช่องทาง
        // ไหนทำงานอยู่ (ไม่ใช่แค่ 'line' เป็นค่าเริ่มต้นเสมอเหมือนก่อนมี T2)
        deliverVia, telegramChats: telegramChats.map(c => ({ chat_id: c.chat_id, name: c.name, type: c.type })),
        checks, text, hourlyCap: HOURLY_CAP_DEFAULT, cooldownSec, ref,
        plateOnWatchlist: wRows.length > 0, groupExists: gRows.length > 0,
      };
    }

    if (reason) return _log(pool, { groupId, event, plate, status: reason, text, n: checks.recipientCount, ms: Date.now() - started, ruleId: chan?.id });

    // ⚠️ ต้องบอกให้ชัดว่าเป็นการทดสอบ — ส่งซ้ำการแจ้งเตือนรถเฝ้าระวังโดยไม่บอก
    // จะทำให้ผู้รับออกไปตามจับรถที่ผ่านไปแล้วเมื่อวาน
    // ป้ายกำกับต้นข้อความ — ผู้รับต้องแยกออกทันทีว่านี่ไม่ใช่ระบบตรวจพบเอง
    //   manualBy = เจ้าหน้าที่กดส่งเองจากหน้าจอ (ของจริง แต่คนสั่ง)
    //   force เฉย ๆ = ปุ่มทดสอบระบบ (ไม่ใช่เหตุการณ์ใหม่)
    if (manualBy) text = `📣 [ส่งด้วยตนเองโดย ${manualBy}]\n${text}`;
    else if (force) text = `🧪 [ทดสอบระบบ — ไม่ใช่เหตุการณ์ใหม่]\n${text}`;
    // ผ่านเกณฑ์ "ไม่ส่ง" มาแล้ว แต่ยังช้ากว่าปกติ — ต้องบอกว่าช้าเท่าไหร่
    // ผู้รับจะได้ไม่ออกไปที่จุดนั้นโดยคิดว่ารถเพิ่งผ่าน (เหตุผลเดียวกับป้ายทดสอบข้างบน)
    else if (checks.eventAgeSec != null && checks.eventAgeSec > STALE_LABEL_SEC_DEFAULT) {
      text = `⏱ [ข้อมูลย้อนหลัง — เห็นเมื่อ ${_agoTh(checks.eventAgeSec)}ที่แล้ว]\n${text}`;
    }

    // Claim the cooldown BEFORE sending. Two cameras seeing the same car within
    // milliseconds would otherwise both pass the check and both send.
    if (!force) await pool.query(
      `INSERT INTO lpr_alert_cooldown (plate_number, group_id, last_sent_at)
       VALUES ($1, $2, now())
       ON CONFLICT (plate_number, group_id) DO UPDATE SET last_sent_at = now()`,
      [plate, groupId]);
    if (!force) await pool.query(
      `INSERT INTO lpr_alert_hourly (group_id, hour_start, sent)
       VALUES ($1, date_trunc('hour', now()), 1)
       ON CONFLICT (group_id, hour_start) DO UPDATE SET sent = lpr_alert_hourly.sent + 1`,
      [groupId]);

    // ภาพอ้างอิงของรายการเฝ้าระวัง (มีครบทั้ง 488 รายการ) — ส่งไปให้ sendAlert
    // ประกอบ bubble แบบ "เทียบภาพ" ตัวเดียวกับแจ้งเตือนใบหน้า (2026-08-12)
    // ไม่มีภาพ = ตกกลับไป bubble เดิมเอง ไม่ต้องเช็คตรงนี้
    let refImage = null;
    try {
      const { rows: wl } = await pool.query(
        `SELECT ref_image FROM lpr_watchlist
          WHERE plate_number = $1 AND active AND ref_image IS NOT NULL LIMIT 1`, [plate]);
      refImage = wl[0]?.ref_image || null;
    } catch (e) { console.warn('[lpr-line] หาภาพอ้างอิงไม่สำเร็จ:', e.message); }

    // ── ขา LINE — 'telegram' ล้วนข้ามไปเลย (deliver_via) ── ทุกอย่างข้างในบล็อกนี้
    // เหมือนก่อนมี T2 ทุกประการ เมื่อ usesLine เป็นจริง (deliverVia default = 'line')
    let result = null;
    if (usesLine) {
      result = await lineSender.sendAlert({
        rule: {
          message_template: text,
          send_snapshot: chan ? chan.send_snapshot !== false : true,
          show_open_link: chan ? chan.show_open_link : true,
          title_template: chan?.title_template || null,
          subtitle_template: chan?.subtitle_template || null,
          text_position: chan?.text_position || 'below',
          name: g.name || groupId,
          // plateImage = ภาพ crop เฉพาะป้าย (license_plates.plate_image) ใช้เป็นภาพซ้าย
          // ของการ์ดเทียบภาพ ส่วนภาพเต็มเฟรมย้ายขึ้นไปเป็น hero — ผังเดียวกับการ์ดใบหน้า
          // ⚠️ ผู้เรียกสองรายส่ง event คนละรูป: เส้นทางจริงส่งแถว events (ต้องพึ่ง join)
          // เส้นทางพรีวิวส่งแถว license_plates มาเลย (join ไม่ติดเพราะ id คนละความหมาย)
          // อ่านทั้งสองทางไว้ ไม่งั้นพรีวิวจะไม่มีภาพป้ายทั้งที่ข้อมูลอยู่ในมือแล้ว
          lprMeta: { plate, region, refImage, sections, groupName: g.name || groupId,
                     plateImage: cam.plate_image || event.plate_image || null,
                     cameraName: event.camera_name || event.camera_id },
        },
        // event ตัวนี้เป็นที่มาของ **ภาพเต็มเฟรม** (snapshot_filename) ซึ่งเดิมถูกใช้เป็น
        // ภาพเดียวของการ์ด ด้วยเหตุผลว่าเลขป้ายอยู่ในข้อความอยู่แล้ว สิ่งที่ข้อความบอก
        // ไม่ได้คือ "ใช่คันนั้นจริงไหม" — 'กร6' เคยตรงกับ SUV ขาวและ Ford ดำในสัปดาห์
        // เดียว ทั้งที่คันที่ตามหาเป็น Alphard ดำ ภาพเต็มเฟรมใบเดียวจบเรื่อง ส่วน crop
        // ป้ายที่ยัดลงกรอบ 16:9 ตอบคำถามนั้นไม่ได้
        //
        // 2026-08-25: ไม่ต้องเลือกอย่างใดอย่างหนึ่งแล้ว — ภาพเต็มเฟรมย้ายไปเป็น hero
        // (ได้กรอบ 16:9 ของตัวเอง ตามเหตุผลข้างบนทุกประการ) และ crop ป้ายลงช่องซ้าย
        // ในกรอบ 1:1 ของมันเอง ดู _lprAlertImages() ใน line-sender.js
        event,
        recipients,
        token: cfg.channel_access_token,
        imgbbKey: cfg.imgbb_api_key,
        // pool lets the sender find which edge holds the image.
        pool,
        imgbbExpireSec: await lprImageExpireSec(pool),
        // อายุลิงก์ของเราเอง (system_settings) แยกจากอายุภาพบน imgbb ซึ่ง LPR
        // ตั้งสั้นกว่าโดยตั้งใจ — ไฟล์บน host ภายนอกเป็นข้อมูลคนละน้ำหนักกัน
        signedTtlSec: await signedTtlSecFor(pool),
        allowImgbb: await imgbbFallbackAllowed(pool),
      });
    }

    // ── ขา Telegram (T2) + สำรอง (T3) ── การ์ดใช้ sections ชุดเดียวกับ LINE (ตาราง
    // auto) หรือ text ดิบเมื่อผู้ใช้พิมพ์ template เอง (sections = null ตอนนั้น) —
    // พฤติกรรมเดียวกับที่ buildLprFlexAlert ทำกับ LINE (note: meta.sections ? null : messageText)
    // สร้างการ์ดครั้งเดียว ใช้ได้ทั้งขา Telegram ตรง (T2) และขาสำรอง (T3)
    const wantLink = chan ? chan.show_open_link !== false : true;
    let tgCard = null;
    if ((usesTelegram && telegramChats.length) || usesFallback) {
      tgCard = telegramCard.fromSections({
        title: g.name || groupId, plate, region,
        sections, noteText: sections ? null : text,
        // ป้าย "ส่งด้วยตนเองโดย" ฝังอยู่ใน `text` อยู่แล้ว แต่ noteText ส่งเฉพาะตอน
        // ไม่มี sections (พิมพ์ template เอง) — การ์ดตารางอัตโนมัติ (กรณีปกติ) จึงไม่เคย
        // เห็นป้ายนี้เลย ใส่ label แยกเฉพาะเส้นทางส่ง Telegram ด้วยมือเท่านั้น ไม่แตะ
        // พฤติกรรมเดิมของขา Telegram อัตโนมัติ/สำรอง (deliver_via='both'/'telegram')
        // sections=null (พิมพ์ template เอง) → noteText = text ซึ่งมีป้ายนี้ติดอยู่แล้ว
        // (บรรทัดก่อนขา LINE ด้านบน) ใส่ label ซ้ำจะเห็นป้ายสองครั้ง — ใส่เฉพาะตอนที่
        // sections ยังอยู่ (การ์ดตารางอัตโนมัติ ซึ่งไม่มีป้ายอยู่ในตัวมันเอง)
        label: (manualTelegram && manualBy && sections) ? `📣 ส่งด้วยตนเองโดย ${manualBy}` : null,
        link: wantLink ? _dashboardEventLink(event, 'lpr') : null,
      });
    }
    const tgImages = {
      plate: cam.plate_image || event.plate_image || null,
      scene: event.snapshot_filename || null,
      ref: refImage,
    };
    const tgTtl = await signedTtlSecFor(pool);

    let tgResults = [];
    if (usesTelegram && telegramChats.length) {
      tgResults = await sendTelegramLeg({ pool, chats: telegramChats, card: tgCard, images: tgImages, signedTtlSec: tgTtl });
    }

    // ── T3: LINE ปฏิเสธด้วย "monthly limit" → ส่งการ์ดเดียวกันไปแชทที่ผูกไว้
    // (mirror_of_line_id) แทนผู้รับคนนั้น — ข้ามเสมอสำหรับปุ่มทดสอบ/ส่งเจาะจงผู้รับ
    // (skipTelegram) และปุ่มทดสอบระบบ/ส่งด้วยตนเอง (force) ตามสเปค T3
    let fbResults = [];
    if (usesFallback && !skipTelegram && !force && tgCard && result?.recipientsLog?.length) {
      const fbChats = pickFallbackChats(result.recipientsLog, recipients, allTgChats);
      if (fbChats.length) {
        const raw = await sendTelegramLeg({ pool, chats: fbChats, card: tgCard, images: tgImages, signedTtlSec: tgTtl });
        fbResults = raw.map(r => ({ ...r, fallback: true }));
      }
    }

    // alert_logs แถวเดียวรวมทุกช่องทาง — ไม่เพิ่มแถวใหม่ (เหมือน notifier.js
    // ที่ตั้งใจให้ผู้เรียกฝัง telegram เข้าไปใน recipients_json เดิม ไม่ใช่ตารางแยก)
    const lineLog = result?.recipientsLog || [];
    const totalSent = (result?.sentCount || 0) + tgResults.filter(r => r.ok).length + fbResults.filter(r => r.ok).length;
    const errs = [result?.error, tgResults.find(r => !r.ok && r.error)?.error, fbResults.find(r => !r.ok && r.error)?.error].filter(Boolean);
    const combinedLog = lineLog.concat(tgResults).concat(fbResults);
    return _log(pool, { groupId, event, plate,
      status: totalSent ? (manualBy ? 'sent_manual' : 'sent') : 'failed',
      text, n: totalSent, ms: Date.now() - started, err: errs.length ? errs.join('; ') : null,
      ruleId: chan?.id, imageSource: result?.imageSource || null,
      recipientsJson: combinedLog.length ? JSON.stringify(combinedLog) : null });
  } catch (e) {
    if (dryRun) return { dryRun: true, plate, groupId, wouldSend: false, error: e.message };
    return _log(pool, { groupId, event, plate, status: 'failed', text,
      n: recipients.length, ms: Date.now() - started, err: e.message });
  }
}

// Shares alert_logs with alert-engine so LPR alerts show up in the same history
// page. rule_id stays null — these do not come from alert_rules.
function _log(pool, { groupId, event, plate, status, text, n, ms, err, ruleId = null, imageSource = null, recipientsJson = null }) {
  return pool.query(
    `INSERT INTO alert_logs
       (rule_id, rule_name, event_id, camera_id, triggered_rule, event_time,
        status, message_text, recipient_count, error_message, duration_ms, image_source, recipients_json)
     VALUES ($11,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12,$13)`,
    [`LPR: ${groupId}`, event.id || null, event.camera_id || null,
     `watchlist:${plate}`, event.event_time || new Date().toISOString(),
     status, text, n, err || null, ms, ruleId, imageSource, recipientsJson]
  ).catch(e => console.error('[lpr-line] log:', e.message))
    // ผลที่ผู้เรียกใช้ตัดสินได้ว่าส่งถึงจริงไหม (เดิมคืนผล INSERT ของ pg ซึ่งบอกไม่ได้)
    .then(() => ({ status, n, err: err || null }));
}

/**
 * สถานะการแจ้งเตือนของป้ายหนึ่ง ณ ตอนนี้ — ไว้ตอบกลับให้ตรงความจริง
 *
 * 🔴 ทำไมต้องมี: `plate_muted` อยู่ **หลัง** `channel_disabled` และ `group_muted`
 * ในลำดับการตัดสิน ⇒ สั่ง "เปิดแจ้งเตือน" แล้วตอบว่า "เปิดแล้ว" อาจเป็นคำโกหก
 * ถ้าช่องทางหรือกลุ่มถูกปิดอยู่ · ต้องรายงานสิ่งที่ระบบจะทำจริง ไม่ใช่สิ่งที่เพิ่งเขียนลงไป
 * (ไม่รวม cooldown/เพดานรายชั่วโมง/จำนวนผู้รับ — สามอย่างนั้นขึ้นกับเหตุการณ์ที่ยังไม่เกิด)
 */
async function plateAlertState(pool, plate) {
  const { rows: wRows } = await pool.query(
    `SELECT w.notify_line, w.group_id, w.active, g.notify_line AS group_notify, g.name AS group_name
       FROM lpr_watchlist w LEFT JOIN lpr_watchlist_groups g ON g.id = w.group_id
      WHERE w.plate_number = $1`, [plate]);
  const w = wRows[0] || null;
  const { rows: mRows } = await pool.query(
    'SELECT muted_until, muted_by FROM lpr_plate_mutes WHERE plate_number = $1', [plate]);
  const { rows: cfgRows } = await pool.query(
    'SELECT enabled, channel_access_token FROM line_config WHERE id = 1');
  const chan = await lprChannel(pool);
  const cfg = cfgRows[0] || {};
  const mutedUntil = mRows[0]?.muted_until || null;
  const reason = !w ? 'not_watched' : suppressionReason({
    lineEnabled: !!cfg.enabled && !!cfg.channel_access_token,
    channelEnabled: chan ? chan.enabled : true,
    groupNotify: !!w.group_notify,
    plateNotify: w.notify_line,
    mutedUntil,
    recipientCount: 1,          // จำนวนผู้รับจริงขึ้นกับไซต์ของเหตุการณ์ที่ยังไม่เกิด
    cooldownRemainingSec: 0,
    hourlySent: 0,
  });
  return { watched: !!w, groupName: w?.group_name || null, mutedUntil,
           mutedBy: mRows[0]?.muted_by || null, reason };
}

module.exports = {
  plateAlertState, selectRecipients, suppressionReason, buildAlertText, buildAlertSections,
                   sendLprAlert, lprImageExpireSec, signedTtlSecFor, imgbbFallbackAllowed,
                   agoTh: _agoTh,
                   HOURLY_CAP_DEFAULT, COOLDOWN_SEC_DEFAULT,
                   STALE_LABEL_SEC_DEFAULT, STALE_MAX_SEC_DEFAULT };

if (require.main === module) {
  const assert = require('assert');
  const R = (id, extra = {}) => ({ id, enabled: true, ...extra });

  // ── selectRecipients ──────────────────────────────────────
  // The default must be "hears everything", or turning this feature on would
  // silently stop the three existing recipients from receiving anything.
  const plain = [R('a'), R('b', { enabled: false })];
  assert.deepStrictEqual(selectRecipients(plain, { siteCode: 'hkt', groupId: 'warrant' }).map(r => r.id), ['a']);
  assert.deepStrictEqual(selectRecipients(plain, { siteCode: null, groupId: null }).map(r => r.id), ['a']);

  const scoped = [
    R('all'),
    R('phuket', { lpr_sites: ['hkt'] }),
    R('hatyai', { lpr_sites: ['hdy'] }),
    R('warrantOnly', { lpr_groups: ['warrant'] }),
    R('phuketWarrant', { lpr_sites: ['hkt'], lpr_groups: ['warrant'] }),
  ];
  assert.deepStrictEqual(
    selectRecipients(scoped, { siteCode: 'hkt', groupId: 'warrant' }).map(r => r.id),
    ['all', 'phuket', 'warrantOnly', 'phuketWarrant']);
  assert.deepStrictEqual(
    selectRecipients(scoped, { siteCode: 'hkt', groupId: 'suspect' }).map(r => r.id),
    ['all', 'phuket']);
  assert.deepStrictEqual(
    selectRecipients(scoped, { siteCode: 'hdy', groupId: 'warrant' }).map(r => r.id),
    ['all', 'hatyai', 'warrantOnly']);

  // A camera without a site must not reach a site-scoped recipient — that would
  // send Hat Yai's team a car they cannot place.
  assert.deepStrictEqual(
    selectRecipients(scoped, { siteCode: null, groupId: 'warrant' }).map(r => r.id),
    ['all', 'warrantOnly']);

  // Empty arrays mean the same as absent, since a UI that clears every box
  // should not mean "receive nothing" without saying so.
  assert.strictEqual(selectRecipients([R('x', { lpr_sites: [], lpr_groups: [] })],
    { siteCode: 'hkt', groupId: 'warrant' }).length, 1);

  // ── suppressionReason ─────────────────────────────────────
  const ok = { lineEnabled: true, groupNotify: true, plateNotify: true,
               recipientCount: 2, cooldownRemainingSec: 0, hourlySent: 0 };
  assert.strictEqual(suppressionReason(ok), null);
  assert.strictEqual(suppressionReason({ ...ok, lineEnabled: false }), 'line_disabled');
  assert.strictEqual(suppressionReason({ ...ok, groupNotify: false }), 'group_muted');
  assert.strictEqual(suppressionReason({ ...ok, plateNotify: false }), 'plate_muted');
  assert.strictEqual(suppressionReason({ ...ok, recipientCount: 0 }), 'no_recipients');
  assert.strictEqual(suppressionReason({ ...ok, cooldownRemainingSec: 5 }), 'cooldown_skip');
  assert.strictEqual(suppressionReason({ ...ok, hourlySent: 20 }), 'hourly_cap_skip');
  assert.strictEqual(suppressionReason({ ...ok, hourlySent: 19 }), null, 'cap is a ceiling, not an off-by-one');

  // Order matters: with no audience AND a live cooldown, the answer must be
  // no_recipients, so the cooldown is not consumed by a send that never went.
  assert.strictEqual(suppressionReason({ ...ok, recipientCount: 0, cooldownRemainingSec: 300 }), 'no_recipients');

  // ── อายุเหตุการณ์ (เจ้าของสั่ง 2026-09-12: เกิน 1 ชม. ไม่ส่ง) ──────────────
  assert.strictEqual(suppressionReason({ ...ok, eventAgeSec: 30 }), null, 'สด ๆ ต้องส่ง');
  assert.strictEqual(suppressionReason({ ...ok, eventAgeSec: 3600 }), null, 'พอดี 1 ชม. ยังส่ง (เป็นเพดาน ไม่ใช่ off-by-one)');
  assert.strictEqual(suppressionReason({ ...ok, eventAgeSec: 3601 }), 'stale_skip');
  // ไม่รู้เวลาเหตุการณ์ = ไม่เอาเกณฑ์นี้มาตัดสิน ปล่อยให้ส่ง ดีกว่าเงียบเพราะข้อมูลขาด
  assert.strictEqual(suppressionReason({ ...ok, eventAgeSec: null }), null);
  // ต้องมาก่อน cooldown ด้วยเหตุผลเดียวกับ no_recipients — ใบที่ไม่ส่งห้ามกินหน้าต่าง
  assert.strictEqual(
    suppressionReason({ ...ok, eventAgeSec: 7200, cooldownRemainingSec: 300 }), 'stale_skip');
  // แต่ต้องมา **หลัง** no_recipients — เหตุผลที่บันทึกต้องเป็นตัวที่บล็อกจริงตัวแรก
  assert.strictEqual(
    suppressionReason({ ...ok, eventAgeSec: 7200, recipientCount: 0 }), 'no_recipients');
  // ตั้งเกณฑ์เองได้ (เผื่อวันหน้าย้ายไปเป็นค่าตั้งค่า)
  assert.strictEqual(suppressionReason({ ...ok, eventAgeSec: 700, staleMaxSec: 600 }), 'stale_skip');

  // ปิดจากแท็บ "ป้ายทะเบียน" — ต้องแยกจาก line_disabled ให้เห็นใน alert_logs
  assert.strictEqual(suppressionReason({ ...ok, channelEnabled: false }), 'channel_disabled');
  // ยังไม่มีแถว channel (undefined) ต้องทำงานเหมือนเดิม ไม่ใช่เงียบไปทั้งระบบ
  assert.strictEqual(suppressionReason({ ...ok, channelEnabled: undefined }), null);
  // ระบบ LINE ปิดทั้งระบบยังชนะเสมอ — เหตุผลที่ตื้นกว่าต้องมาก่อน
  assert.strictEqual(suppressionReason({ ...ok, lineEnabled: false, channelEnabled: false }), 'line_disabled');

  // plateNotify null/undefined is "not set", which must not read as muted —
  // rows predating the per-plate column would all fall silent.
  assert.strictEqual(suppressionReason({ ...ok, plateNotify: null }), null);
  assert.strictEqual(suppressionReason({ ...ok, plateNotify: undefined }), null);

  // ปิดรับเฉพาะ LPR ได้ทีละคน · ไม่ตั้ง = รับ (แถวเก่าทั้งหมดต้องทำงานเหมือนเดิม)
  assert.strictEqual(
    selectRecipients([{ id: 'a', enabled: true, lpr_enabled: false }], {}).length, 0, 'lpr_enabled=false ต้องไม่ได้รับ');
  assert.strictEqual(
    selectRecipients([{ id: 'a', enabled: true }], {}).length, 1, 'ไม่ตั้ง lpr_enabled ต้องยังได้รับ');
  assert.strictEqual(
    selectRecipients([{ id: 'a', enabled: true, lpr_enabled: true }], {}).length, 1);
  // ปิดทั้งคนยังชนะเสมอ — ไม่ใช่ว่าเปิด lpr_enabled แล้วแหกด่านหลักได้
  assert.strictEqual(
    selectRecipients([{ id: 'a', enabled: false, lpr_enabled: true }], {}).length, 0);

  // ── buildAlertText ────────────────────────────────────────
  const txt = buildAlertText({
    groupName: 'รถตามหมายจับ', plate: 'กษ9323', region: 'ภูเก็ต',
    cameraName: 'ทางเข้าตลาดบังกร (C4)', eventTime: '2026-08-03T07:32:05Z',
    vehicle: 'เก๋ง · สีขาว', note: 'หมายจับ 123/2569',
  });
  assert.ok(txt.startsWith('รถตามหมายจับ\nกษ9323  ภูเก็ต'), 'plate is the headline');
  assert.ok(txt.includes('ทางเข้าตลาดบังกร (C4)') && txt.includes('หมายเหตุ: หมายจับ 123/2569'));
  assert.ok(!txt.includes('━━'), 'ไม่มี ref = ไม่มีหัวข้อ — ของเดิมต้องไม่เปลี่ยนหน้าตา');
  // Missing optional fields must drop out rather than print as blanks.
  const bare = buildAlertText({ plate: '1กข1234' });
  assert.strictEqual(bare.split('\n').length, 2, bare);
  assert.ok(!bare.includes('undefined'));

  // Camera and site share a line. Site matters because all three recipients
  // today hear about every site and cannot otherwise tell them apart.
  const withSite = buildAlertText({ plate: 'x', cameraName: 'ประตู 108', siteName: 'HatYai' });
  assert.ok(withSite.includes('ประตู 108 · HatYai'), withSite);
  // Site alone still prints; camera alone must not gain a stray separator.
  assert.ok(buildAlertText({ plate: 'x', siteName: 'HatYai' }).includes('HatYai'));
  assert.ok(!buildAlertText({ plate: 'x', cameraName: 'C1' }).includes('·'));

  // ── สองบล็อก: กล้องเห็นอะไร vs ฐานข้อมูลว่าไง ────────────
  const two = buildAlertText({
    groupName: 'รถตามหมายจับ', plate: 'คษธ703', region: 'สงขลา',
    cameraName: 'ประตู 108', siteName: 'HatYai', eventTime: '2026-08-12T16:10:34Z',
    vehicle: 'จักรยานยนต์ · สีดำ',
    ref: { vehicle: 'ฮอนด้า เวฟ110ไอ · จักรยานยนต์ · สีขาว', plate: 'ป้ายขาว ตัวดำ (ส่วนบุคคล)',
           province: 'สงขลา', case: 'ลักทรัพย์', unit: 'สภ.นราธิวาส', tier: 'บัญชีดำ',
           plateNumber: 'คษธ703', detail: 'พบเห็นแจ้ง ภ.จว.สงขลา', updated: '18 ต.ค. 2567 18:13' },
    note: 'ลักทรัพย์ · ยี่ห้อ ฮอนด้า · สี White · ประเภท Motorcycle · ชนิดป้าย normal-white-black',
  });
  assert.ok(two.includes('━━ จากกล้อง ━━') && two.includes('━━ ข้อมูลอ้างอิง · บัญชีดำ ━━'), two);
  assert.ok(two.indexOf('จากกล้อง') < two.indexOf('ข้อมูลอ้างอิง'), 'กล้องมาก่อนเสมอ — เป็นสิ่งที่เพิ่งเกิด');
  // ค่าดิบต้องไม่หลุดออกไปพร้อมกับชุดที่แปลแล้ว
  assert.ok(!/normal-white-black|Motorcycle|สี White/.test(two), 'note ดิบต้องไม่ซ้ำกับชุดที่แปลแล้ว');
  // สีที่ขัดกันต้องเห็นทั้งคู่ ไม่ใช่เลือกข้างให้
  assert.ok(two.includes('สีดำ') && two.includes('สีขาว'), 'กล้องว่าดำ โรสเตอร์ว่าขาว ต้องเห็นทั้งคู่');
  assert.ok(two.includes('พบเห็นแจ้ง ภ.จว.สงขลา'), 'รายละเอียดต้องมาแยกจากประเภทคดี');
  assert.ok(two.includes('ต้นทางแก้ไขล่าสุด 18 ต.ค. 2567 18:13'), two);
  // เลขป้ายตรงกับที่กล้องอ่านได้ = ไม่ต้องพิมพ์ซ้ำ
  assert.ok(!two.includes('ในฐานข้อมูลคือ'), 'ป้ายตรงกันไม่ต้องขึ้นบรรทัดเทียบ');
  // ป้ายไม่ตรงกัน = ต้องเห็น (อ่านผิด/สลับป้าย)
  const mism = buildAlertText({ plate: 'คษธ708', cameraName: 'C1',
    ref: { plateNumber: 'คษธ703', case: 'ลักทรัพย์' } });
  assert.ok(mism.includes('ในฐานข้อมูลคือ คษธ703'), mism);

  // ไม่มีข้อมูลอ้างอิง = ข้อความหน้าตาเหมือนก่อนมีฟีเจอร์นี้เป๊ะ (ไม่มีหัวข้อโผล่)
  const oneBlock = buildAlertText({
    groupName: 'เฝ้าระวัง', plate: '1กข1234', cameraName: 'ประตู 1',
    eventTime: '2026-08-12T16:10:34Z', note: 'หมายเหตุเดิม',
  });
  assert.ok(!oneBlock.includes('━━'), 'บล็อกเดียวไม่ต้องมีหัวข้อ: ' + oneBlock);
  assert.ok(oneBlock.includes('หมายเหตุ: หมายเหตุเดิม'), 'ไม่มีชุดแปลแล้ว → note ดิบยังต้องมา');

  // มีเฉพาะข้อมูลอ้างอิง (กล้องไม่ส่งอะไรมาเลย) ก็ไม่ต้องมีหัวข้อเช่นกัน
  const refOnly = buildAlertText({ plate: 'x', ref: { case: 'ลักทรัพย์' } });
  assert.ok(!refOnly.includes('━━') && refOnly.includes('ลักทรัพย์'), refOnly);

  // The note cap is a safety valve, not formatting: real notes (~150 chars,
  // with the offence at the END) must pass through untouched.
  const realNote = 'พบเห็นติดต่อ ด.ต.สุพร รักนวล  0896567188 สภ.หาดใหญ่ · ยี่ห้อ ฮอนด้า · สี Black · ประเภท Motorcycle · ชนิดป้าย normal-white-black · ทำร้ายร่างกาย ด.ต.สุพร รักนวล สภ.หาดใหญ่ 0896567188';
  assert.ok(buildAlertText({ plate: 'x', note: realNote }).endsWith(realNote), 'a real note is not truncated');
  assert.ok(buildAlertText({ plate: 'x', note: 'ก'.repeat(900) }).endsWith('…'), 'a runaway note is capped');

  console.log('lprLineAlert self-check: all assertions passed');
}
