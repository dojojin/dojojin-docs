// ============================================================
// Vigil Platform — Alert Engine
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Rule matching + Cooldown management
//
// Usage (จาก mqtt-subscriber.js):
//   const alertEngine = require('./alert-engine');
//   alertEngine.init(pool);
//   await alertEngine.onEvent({ event_id, camera_id, rule_name, event_time, ... });
//
// ============================================================

const lineSender = require('./line-sender');
const pushSender = require('./push-sender');
const notifier = require('./helpers/notifier');
const { quietSiteCodes } = require('./helpers/siteStatus');
const telegramCard = require('./helpers/telegramCard');
const { snapshotMount, systemMount } = require('./helpers/storageHealth');

let pool = null;
let rulesCache = [];
let configCache = null;
// T2b: chats ที่อนุมัติแล้วของ Telegram — refresh พร้อม configCache ทุก 30s เหมือนกัน
// ไม่ query ต่อ event (เส้นทางนี้วิ่งหลักร้อย event/นาที) · sendTelegramLeg เองยัง
// เช็ค enabled/token สดจาก DB ทุกครั้งที่จะส่งจริงอยู่ดี ที่นี่ cache ไว้แค่ "จะส่งไปแชท
// ไหนบ้าง" สำหรับตัดสิน recipientCount/no_recipients เท่านั้น
let telegramCache = { chats: [] };
let displayTz = 'Asia/Bangkok';   // refreshed from system_settings alongside the rule cache
let cacheRefreshTimer = null;
let lastRefresh = 0;
let signedTtlSec = 172800;   // 48 ชม. — ค่าเดิมที่เคยตายตัวในโค้ด
let allowImgbb = true;
const CACHE_TTL_MS = 30 * 1000; // 30 วินาที

// ── Init ────────────────────────────────────────────────────
function init(pgPool) {
  pool = pgPool;
  refreshCache(); // Initial load
  // Background refresh ทุก 30 วินาที (กัน race ถ้า admin แก้ rule)
  cacheRefreshTimer = setInterval(refreshCache, CACHE_TTL_MS);
  console.log('🔔 Alert engine initialized');
}

// seam สำหรับเทสต์เท่านั้น — ฉีด pool/lineSender/config ตรง ๆ โดยไม่แตะ DB จริง
// และไม่ยิง LINE จริง · แนวเดียวกับ _lossDecision ที่ export ไว้ให้เทสต์เรียกตรง
// ไม่ตั้ง timer refresh cache เพราะเทสต์กำหนด config เองทั้งก้อน
// 🔴 ทุกทางส่งต้องผ่าน _sender เท่านั้น — เดิม sendAlert 3 จุดเรียก lineSender ตรง ๆ
// ตัวฉีดของเทสต์จึงคุมได้แค่ pushLineMessage · สคริปต์เทียบที่ฉีดตัวปลอมแล้วเชื่อว่า
// ปลอดภัยส่งการ์ดจริงเข้ากลุ่มตำรวจ (เหตุจริง 2026-09-25 00:22 น.) · production
// ไม่เปลี่ยน: _sender = lineSender ตัวเดิมเสมอถ้าไม่มีใครฉีด
let _sender = lineSender;
async function _testInit({ pool: p, lineSender: ls, config, rules, telegram }) {
  pool = p;
  if (ls) _sender = ls;
  configCache = config;
  // T2b: seam เดียวกันนี้ยังไม่เคยตั้ง rulesCache/telegramCache — เทสต์ dispatch
  // (onEvent/checkDwellRules) ต้องกำหนดเอง ค่าเริ่มต้นคือไม่แตะ (ไม่ทับของเดิม)
  if (rules) rulesCache = rules;
  if (telegram) telegramCache = telegram;
  // onEvent() เรียก refreshCache() เองถ้า lastRefresh เก่าเกิน 2×TTL (ค่าเริ่มต้น
  // ของโมดูลคือ 0 = "เก่ามาก") — เทสต์ที่ฉีด state เองต้องไม่โดน refreshCache ทับ
  // ด้วยของจริงจาก pool กลางอากาศ จึงปั๊มเวลาให้ดูเหมือน "เพิ่ง refresh" ไปด้วย
  lastRefresh = Date.now();
  _rx.last.clear(); _rx.mark = null;
}

function shutdown() {
  if (cacheRefreshTimer) clearInterval(cacheRefreshTimer);
}

// ── Cache management ────────────────────────────────────────
async function refreshCache() {
  try {
    // ⚠️ 3 query เดิม (T2b ไม่เพิ่มเข้ามาใน batch นี้โดยตั้งใจ — ดู telegram_config
    // แยกด้านล่าง) — ถ้า query ไหนใน Promise.all นี้พัง rulesCache/configCache
    // ทั้งคู่จะไม่ถูกอัปเดตเลย (LINE ทั้งระบบหยุด) จึงต้องเป็น query ที่เชื่อถือได้ที่สุด
    // ของระบบเท่านั้น — เพิ่ม telegram_config เข้ามาด้วยเคยทำให้ตารางที่ยังไม่มี
    // (ก่อน migration 240 รันตอนอัปเกรด) พา LINE ทั้งระบบหยุดไปด้วย (audit T2b)
    const [rulesRes, configRes, tzRes] = await Promise.all([
      // ⚠️ ช่องทาง 'lpr' **ไม่ได้เดินผ่าน engine นี้** — helpers/lprLineAlert ยิงเอง
      // แถวนั้นเก็บไว้แค่ค่าตั้ง (cooldown/ผู้รับ/หน้าตาการ์ด) และมี rule_names ว่าง
      // ซึ่งในกติกาของ matchRule แปลว่า "ตรงกับทุก event" → ป้ายทุกใบที่อ่านได้
      // (300/นาที) จะถูกนับเป็น match แล้วเขียน alert_logs สถานะ no_recipients
      // วัดจริงหลัง deploy 2026-08-13: **27,552 แถวขยะต่อชั่วโมง**
      pool.query(`SELECT * FROM alert_rules
                   WHERE enabled = true AND (channel IS NULL OR channel <> 'lpr')`),
      pool.query('SELECT * FROM line_config WHERE id = 1'),
      pool.query(`SELECT key, value FROM system_settings
                   WHERE key IN ('display_timezone','signed_image_expire_hours','imgbb_fallback_enabled')`),
    ]);
    rulesCache = rulesRes.rows;
    configCache = configRes.rows[0] || null;
    const st = Object.fromEntries(tzRes.rows.map(r => [r.key, r.value]));
    const tz = st.display_timezone;
    if (typeof tz === 'string' && tz.trim()) displayTz = tz.trim();
    // อายุลิงก์ของเราเอง — เดิมตายตัว 48 ชม. ในโค้ด (migration 147)
    signedTtlSec = require('./helpers/signedImage').ttlSecFromHours(st.signed_image_expire_hours);
    // สวิตช์ PDPA — ปิดแล้วส่งการ์ดไม่มีรูปแทนที่จะโยนภาพขึ้น host ภายนอก
    allowImgbb = st.imgbb_fallback_enabled !== 'false';
    lastRefresh = Date.now();
  } catch (e) {
    // e.message อาจว่าง (เช่น pg connection teardown) — fallback เป็น error เต็ม
    // เพื่อไม่ให้ log บรรทัดว่าง (incident 2026-06-07, audit A5)
    console.error('🔔 Alert engine cache refresh error:', e.message || e);
  }

  // T2b: telegram_config แยก query ต่างหาก นอก Promise.all หลัก — ยิงเฉพาะตอนมีกฎที่
  // ตั้ง Telegram จริง ๆ (ติดตั้งที่ทุกกฎยัง 'line' ไม่ต้องเสีย query นี้เลย ตรงกับที่แผน
  // บอกว่า deliver_via='line' ต้องไม่มี query ใหม่) และ query นี้พังแยกต่างหากจาก
  // batch หลักข้างบน — ถ้าตาราง telegram_config อ่านไม่ได้ (ยังไม่ผ่าน migration 240,
  // หรือเหตุอื่น) แค่คง chats ชุดเดิมไว้ ไม่ทำให้ LINE ทั้งระบบหยุดตามไปด้วย
  // T3: 'line_then_telegram' ก็ต้องมี chats ไว้หา mirror_of_line_id ตอน LINE โดนโควตาเต็ม
  // แม้จะไม่ได้ยิง Telegram ตรง ๆ เหมือน 'telegram'/'both' ก็ตาม
  const anyTg = rulesCache.some(r =>
    r.deliver_via === 'telegram' || r.deliver_via === 'both' || r.deliver_via === 'line_then_telegram');
  if (anyTg) {
    try {
      const tgRes = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
      telegramCache = { chats: Array.isArray(tgRes.rows[0]?.chats) ? tgRes.rows[0].chats : [] };
    } catch (e) {
      console.warn('🔔 Alert engine: อ่าน telegram_config ไม่สำเร็จ (คง chats เดิมไว้):', e.message || e);
    }
  }
}

// Force refresh (เรียกหลัง user แก้ rule ผ่าน UI)
async function invalidateCache() {
  await refreshCache();
}

// ── Rule matching ───────────────────────────────────────────
function matchRule(rule, event) {
  // ── ช่องทางประจำระบบต้องเจาะจงเสมอ (migration 146) ──────────────────────
  // แถวที่มี `channel` เป็นแถว **ค่าตั้งของช่องทาง** ไม่ใช่กฎที่ผู้ใช้เขียน
  // กติกาปกติของฟังก์ชันนี้คือ "ว่าง = ทุกอย่าง" ซึ่งถูกสำหรับกฎที่คนตั้งใจเขียน
  // แต่กับแถวค่าตั้งมันกลับหัว: rule_names ว่างแปลว่า "ยังไม่ได้ผูกชนิดเหตุการณ์"
  // ไม่ใช่ "เอาทุกเหตุการณ์"
  //
  // เกิดจริงแล้ว 2026-08-13: แถว channel='lpr' (rule_names ว่างเพราะตัวส่งไม่ผ่าน
  // engine นี้) กลายเป็นกฎที่ตรงกับทุก event → **27,552 แถวขยะต่อชั่วโมง**
  // แก้เฉพาะหน้าไปแล้วด้วยการตัด 'lpr' ออกตอนโหลด cache แต่นั่นกันได้ชื่อเดียว
  // ด่านนี้กันทั้งคลาส — ช่องทางใหม่ในอนาคตที่ยังไม่ได้ผูก rule_names จะเงียบ
  // ไม่ใช่กลืนทุกเหตุการณ์ในระบบ
  if (rule.channel && !(rule.rule_names && rule.rule_names.length > 0)) return false;
  // camera_ids ว่าง = match ทุก camera
  if (rule.camera_ids && rule.camera_ids.length > 0) {
    if (!rule.camera_ids.includes(event.camera_id)) return false;
  }
  // rule_names ว่าง = match ทุก rule
  if (rule.rule_names && rule.rule_names.length > 0) {
    if (!rule.rule_names.includes(event.rule_name)) return false;
  }
  // list_types ว่าง = match ทุก list type (รวมถึง event ที่ไม่มี list_type)
  if (rule.list_types && rule.list_types.length > 0) {
    if (!rule.list_types.includes(event.list_type)) return false;
  }
  return true;
}

// ── Likelihood guard (migration 045) ────────────────────────
// กรอง ghost detection (เช่น 0.34 หลัง GlobalSceneChange). event ที่ไม่มี
// likelihood (Hikvision/Dahua) ผ่านเสมอ — threshold ใช้กับ Bosch ที่ส่งค่ามา
function belowMinLikelihood(rule, event) {
  if (!rule.min_likelihood) return false;
  // ⚠️ min_likelihood ที่หน้าจอรับมาเป็น **%** (label: "ความเชื่อมั่นขั้นต่ำ (%)")
  // แต่ events.likelihood เก็บเป็นสเกล 0-1 (วัดจริง 15,454 แถว/24 ชม. อยู่ในช่วง
  // 0.05-1.000 ทั้งหมด) · เดิมเทียบดิบกันตรง ๆ → 0.95 < 60 เป็นจริง = บล็อกทุก
  // event ทั้งที่กล้องมั่นใจ 95% · แปลงให้เป็นหน่วยเดียวกันก่อนเทียบเสมอ
  const pct = lineSender.likelihoodPct(event.likelihood);
  return pct !== null && pct < rule.min_likelihood;
}

// ── Cooldown check ──────────────────────────────────────────
function isInCooldown(rule) {
  if (!rule.last_triggered_at) return false;
  const elapsedSec = (Date.now() - new Date(rule.last_triggered_at).getTime()) / 1000;
  return elapsedSec < rule.cooldown_seconds;
}

// ── Quiet-hours check ───────────────────────────────────────
// active_from / active_to are TIME columns naming the QUIET window
// (LINE alerts are SILENCED while now ∈ [from, to); fire outside it).
// NULL columns → no quiet hours configured → never quiet → always fire.
// The columns are still named active_* for historical reasons — semantics
// are now quiet-hours: see UI label "ช่วงเวลาเงียบ (Quiet Hours)".
// Comparison is in display timezone; windows that cross midnight (from > to,
// e.g. 22:00–06:00) are supported.
function isWithinQuietHours(rule) {
  if (!rule.active_from || !rule.active_to) return false;  // not configured → never quiet
  const from = String(rule.active_from).slice(0, 5);       // TIME → "HH:MM:SS" → "HH:MM"
  const to   = String(rule.active_to).slice(0, 5);
  if (from === to) return false;                           // identical → never quiet (no window)
  // Current time-of-day in the display timezone, zero-padded "HH:MM" so a
  // lexicographic string compare is correct.
  const now = new Date().toLocaleTimeString('en-GB', {
    timeZone: displayTz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return from < to
    ? (now >= from && now < to)        // normal window, e.g. 09:15–17:30
    : (now >= from || now < to);       // crosses midnight, e.g. 22:00–06:00
}

// Bosch detection events that edge-config-agent captures a snapshot for
function _snapshotExpected(event) {
  const et = event.event_type || '';
  return et.includes('ObjectDetection') || et.includes('LineDetector') || et.includes('FieldDetector');
}


// ── เติมข้อมูลใบหน้าให้ event ก่อนส่ง LINE (ระลอก 1 ของแผนแจ้งเตือน HCP) ──────
// pg_notify ส่งมาแค่ฟิลด์พื้นฐาน (กล้อง/เวลา/likelihood) ส่วน "ใครคนนี้คือใคร"
// อยู่ใน events.raw_json ซึ่ง worker ไม่ได้รับมาด้วย — เจ้าของแจ้งว่าแจ้งเตือนใน LINE
// ตัดสินใจไม่ได้เพราะไม่รู้ว่าเป็นใครและอยู่บัญชีไหน (2026-08-12)
//
// ยิง query ต่อเมื่อ template ของกฎนั้น "ขอ" ตัวแปรกลุ่มนี้จริงเท่านั้น — ระบบนี้
// เดินหลายร้อย event ต่อนาที การไป query raw_json ทุกใบเพื่อฟิลด์ที่ไม่มีใครใช้
// คือภาระเปล่า · ผลถูก cache ไว้กับ object ของ event นั้น ยิงครั้งเดียวแม้หลายกฎ match
const FACE_VARS_RE = /\{(person_name|watchlist|similarity|ref_note|ref_id)\}/;

// ชุดโรสเตอร์แยกจากชุด raw_json โดยตั้งใจ — วัดแล้ว 2026-08-26 บน event 30075369:
//   อ่าน raw_json เฉย ๆ            median  1.2 ms
//   อ่านพร้อม join โรสเตอร์        median 50.1 ms   (+49 ms)
// การ join ต้อง cast `sr.id::text = bl.enrolled_ref` แล้วคัดด้วย OR สองเงื่อนไข
// จึงใช้ index ไม่ได้ · face_blacklist มี 1,696 แถวและมีคอลัมน์ embedding (pgvector)
// อยู่ด้วย การกวาดจึงแพงกว่าจำนวนแถวบอก
//
// กฎที่ใช้อยู่จริงตอนนี้ (#14 HCP, #15 AuraFace) ขอแค่ {person_name}/{watchlist}/
// {similarity} — ไม่ควรต้องจ่าย 49 ms เพื่อสองช่องที่ไม่ได้ขอ · เจตนาเดิมของไฟล์นี้
// เขียนไว้ข้างบนแล้วว่า "ยิง query ต่อเมื่อ template ของกฎนั้นขอจริง"
const ROSTER_VARS_RE = /\{(ref_note|ref_id)\}/;

// เหตุการณ์ที่ "จับคู่ใบหน้าได้แล้ว" — ต้องเติมชื่อคนเสมอ ไม่ใช่รอให้ template ขอ
//
// เพราะการ์ดแบบเทียบภาพใน line-sender เปิดใช้ก็ต่อเมื่อ `event.person_name` มีค่า
// กฎที่ปล่อย template ว่าง (= ใช้ข้อความอัตโนมัติ ซึ่งตอนนี้เป็นค่าปกติแล้วหลังจาก
// ตารางชนะ template) จะไม่มีใครเติมชื่อให้ แล้วตกไปเป็น bubble รูปเดียวเงียบ ๆ
// ราคา 1.2 ms ต่อใบ (วัด 2026-08-26) — ส่วนที่แพงคือ join โรสเตอร์ ซึ่งแยกออกไปแล้ว
//
// 🔴 **ห้ามใส่ 'Face Capture'** — นั่นคือ "เห็นหน้าคน" ไม่ใช่ "ตรงกับบัญชีดำ"
// กล้องตัวเดียวออก FaceCapture ถี่มาก (หลักหมื่นต่อวัน) ใส่เข้ามาคือจ่าย query
// ให้เหตุการณ์ที่ไม่มีวันมีชื่อคนให้เติม
const FACE_MATCH_RULES = new Set(['Face Recognition Match', 'AuraFace Blacklist Match']);
const _isFaceMatch = (rule, event) =>
  FACE_MATCH_RULES.has(event.rule_name) || FACE_MATCH_RULES.has(rule?.rule_names?.[0]);

// ── T2b: ขา Telegram ของกฎที่เดินผ่าน engine นี้ (onEvent + checkDwellRules) ──────
// รูปแบบเดียวกับ lprLineAlert.js/gsAlarmLine.js ทุกประการ — 'line' ค่าเริ่มต้น =
// พฤติกรรมเดิมเป๊ะ · telegram_chat_ids เป็นรายชื่อแชทตรง ๆ (ไม่ใช่ lpr_sites/lpr_groups
// แบบช่องทาง LPR — กฎที่นี่ไม่มีแนวคิดนั้น) · chats มาจาก telegramCache (refresh 30s)
function _telegramLegFor(rule) {
  const deliverVia = rule.deliver_via || 'line';
  const usesLine = deliverVia !== 'telegram';
  const usesTelegram = deliverVia === 'telegram' || deliverVia === 'both';
  // T3: LINE เป็นหลักเสมอ — สำรองไป Telegram เฉพาะผู้รับที่โดน "monthly limit"
  // (ดู _telegramFallbackFor ที่เรียกหลัง LINE ส่งเสร็จ ไม่ใช่ที่นี่ เพราะยังไม่รู้ผล LINE)
  const usesFallback = deliverVia === 'line_then_telegram';
  let telegramChats = [];
  if (usesTelegram) {
    const wantIds = new Set((rule.telegram_chat_ids || []).map(String));
    telegramChats = (telegramCache.chats || [])
      .filter(c => c && c.enabled !== false && wantIds.has(String(c.chat_id)));
  }
  return { deliverVia, usesLine, usesTelegram, usesFallback, telegramChats };
}

// ── T3: หลัง LINE ส่งเสร็จ — ส่งการ์ดเดิมซ้ำไปแชทที่ผูก (mirror_of_line_id) กับ
// ผู้รับที่โดนปฏิเสธด้วย "monthly limit" เท่านั้น · คืน [] เงียบ ๆ เมื่อไม่เข้าเงื่อนไข
// (ไม่ใช่ fallback rule / ไม่มีผล LINE ให้ตรวจ) — ทำเครื่องหมาย fallback:true ทุกแถว
async function _sendTelegramFallback(rule, event, usesFallback, lineResult, recipients) {
  if (!usesFallback || !lineResult?.recipientsLog?.length) return [];
  const fbChats = notifier.pickFallbackChats(lineResult.recipientsLog, recipients, telegramCache.chats || []);
  if (!fbChats.length) return [];
  const raw = await _sendTelegramForRule(rule, event, fbChats);
  return raw.map(r => ({ ...r, fallback: true }));
}

// รายชื่อผู้รับที่ "ตั้งใจจะส่งถึง" แต่ถูกระงับ (cooldown/quiet hours/no_recipients ฯลฯ)
// รวมทั้งสองช่องทาง — เดิมมีแค่ LINE (recipients.map(...) วนซ้ำ 3 จุด) T2b รวม Telegram
// เข้าไปด้วยแล้วดึงออกมาเป็นฟังก์ชันเดียว กันโค้ดซ้ำ 4 จุด (low_likelihood/quiet/cooldown/no_recipients)
function _suppressedLog(recipients, telegramChats) {
  const lineLog = (recipients || []).map(r => ({
    name: r.name || null, type: r.type || null,
    id_tail: r.id ? String(r.id).slice(-4) : null,
    ok: null, error: null, line_request_id: null,
  }));
  const tgLog = (telegramChats || []).map(c => ({
    name: c.name || String(c.chat_id), type: c.type || null,
    id_tail: String(c.chat_id).slice(-4), ok: null, error: null, channel: 'telegram',
  }));
  return lineLog.concat(tgLog);
}

// Default LINE template เดียวกับที่ line-sender.js sendAlert() ใช้เมื่อไม่ได้ตั้ง —
// Telegram ต้องประกอบข้อความเอง (ไม่ผ่าน sendAlert) จึงต้องมี default คู่กันไว้
const _DEFAULT_TPL = '🚨 {camera}\n📋 {rule}\n📍 {location}\n⏰ {time}';

// ── สร้างการ์ด + ส่งเข้า Telegram สำหรับกฎที่เดินผ่าน engine นี้ (onEvent/checkDwellRules)
// แมตช์ใบหน้า (HCP Face/AuraFace) → ตาราง _faceSections ชุดเดียวกับ LINE (เงื่อนไข
// hasCustomText เดียวกับ buildFaceFlexAlert — พิมพ์ template เอง = ได้ข้อความนั้น
// ไม่ใช่ตาราง) · กฎอื่น → ข้อความที่ formatMessage() ประกอบให้ + snapshot ของเหตุการณ์
// label: บรรทัดแรกสุดของการ์ด — ใช้ป้าย "ส่งด้วยตนเองโดย <ชื่อ>" ของปุ่มส่งเข้า
// Telegram ด้วยมือ (sendTestForRule manualChannel='telegram') เส้นทางอัตโนมัติ/
// สำรองไม่ส่งพารามิเตอร์นี้มา จึงไม่เปลี่ยนพฤติกรรมเดิมของทั้งสองทางนั้น
async function _sendTelegramForRule(rule, event, telegramChats, { label = null } = {}) {
  if (!telegramChats.length) return [];
  const wantLink = rule.show_open_link !== false;
  const hasCustomText = !!(rule.message_template && String(rule.message_template).trim());
  const messageText = lineSender.formatMessage(rule.message_template || _DEFAULT_TPL, event);

  // 🔴 send_snapshot=false บน LINE ตัดทั้งรูปและการ์ดตาราง เหลือแค่ข้อความล้วน —
  // sendAlert() ต้องมี imageUrl ก่อนถึงจะไปต่อ faceImgs/lprImgs เส้นทางไหนก็ตาม
  // (line-sender.js:1117 `if (rule.send_snapshot && event.snapshot_filename)`) Telegram
  // ต้องทำตามเป๊ะ — ไม่งั้นปิด "แนบรูป" ไว้ที่แท็บ HCP Face แล้วรูปใบหน้ายังหลุดไป
  // Telegram อยู่ดี (PDPA — audit T2b) จึงข้ามทั้งการหาภาพอ้างอิงและการสร้างตาราง
  // ไปเลยเมื่อปิดไว้ ไม่ใช่แค่ไม่แนบไฟล์
  const wantSnapshot = rule.send_snapshot !== false;
  const isFace = wantSnapshot && _isFaceMatch(rule, event) && event.person_name && event.person_name !== '-';

  let card;
  let images = { plate: null, scene: null, ref: null };
  if (isFace) {
    const group = (event.watchlist && event.watchlist !== '-') ? String(event.watchlist) : null;
    const person = lineSender._stripDupPrefix(event.person_name, group);
    let refInfo = null;
    try { refInfo = await lineSender._faceRefInfo(event, pool); }
    catch (e) { console.warn('[alert-engine] Telegram: หาภาพอ้างอิงใบหน้าไม่สำเร็จ:', e.message); }
    const sections = hasCustomText ? null : (event.sections || lineSender._faceSections(event, person, group, refInfo || {}));
    card = telegramCard.fromSections({
      title: group || 'บัญชีดำ', plate: person || 'ไม่ทราบชื่อ',
      sections, noteText: sections ? null : messageText, label,
      link: wantLink ? lineSender._dashboardEventLink(event, 'face-matches') : null,
    });
    images = {
      plate: event.snapshot_filename || null,     // ภาพที่จับได้ (crop) — เหมือน LINE
      scene: refInfo?.scene || null,               // ภาพเต็มเฟรม (ถ้ามี)
      ref: refInfo?.ref_path ? { path: refInfo.ref_path, kind: refInfo.refKind || 'ref' } : null,
    };
  } else {
    card = telegramCard.fromSections({
      title: rule.name || event.rule_name || null,
      noteText: messageText, label,
      link: wantLink ? lineSender._dashboardEventLink(event, 'events') : null,
    });
    if (wantSnapshot) images = { plate: null, scene: event.snapshot_filename || null, ref: null };
  }

  try {
    return await notifier.sendTelegramLeg({ pool, chats: telegramChats, card, images, signedTtlSec });
  } catch (e) {
    console.error('[alert-engine] ส่ง Telegram ไม่สำเร็จ:', e.message);
    return [];
  }
}

async function enrichFaceFields(event, wantRoster = false) {
  if (event._faceEnriched) return;
  event._faceEnriched = true;
  if (!event.event_id) return;
  try {
    const { rows } = await pool.query(
      // สามระบบ สามชุดคีย์ — อ่านทั้งหมดในคำสั่งเดียว ถูกกว่าการเดาว่าเป็นระบบไหน
      //   HCP        hcp_person_name  / hcp_group_name
      //   กล้อง Hik  personName       / fdLibName   (ชื่อคลังใบหน้าบนกล้อง)
      //   AuraFace   ไม่มีใน raw_json — ผู้เรียกยัดมาทาง extra อยู่แล้ว
      `SELECT COALESCE(raw_json->>'hcp_person_name', raw_json->>'personName') AS person_name,
              COALESCE(raw_json->>'hcp_group_name',  raw_json->>'fdLibName')  AS watchlist,
              raw_json->>'similarity' AS similarity
         FROM events WHERE id = $1`, [event.event_id]);
    const r = rows[0];
    if (!r) return;
    if (r.person_name) event.person_name = r.person_name;
    // ชื่อบัญชีจาก HCP บางรายการมีอักขระแปลกนำหน้า (เช่น "ฺBLACKLIST WICHIT")
    // ตัดอักขระที่มองไม่เห็น/สระลอยหน้าออก ไม่งั้นข้อความแจ้งเตือนดูเหมือนพิมพ์ผิด
    if (r.watchlist) event.watchlist = String(r.watchlist).replace(/^[\u0e30-\u0e3a\u0e47-\u0e4e\s]+/, '').trim();
    if (wantRoster) await _enrichRosterFields(event);
    if (r.similarity != null && r.similarity !== '') {
      const n = Number(r.similarity);
      if (Number.isFinite(n)) event.similarity_pct = (n <= 1 ? n * 100 : n).toFixed(1) + '%';
    }
  } catch (e) {
    // ข้อมูลเสริมล้วนๆ — พังแล้วต้องไม่ทำให้การแจ้งเตือนไม่ถูกส่ง
    console.warn('[alert-engine] เติมข้อมูลใบหน้าไม่สำเร็จ:', e.message);
  }
}

// เงื่อนไขจับคู่ต้องตรงกับ _faceAlertImages ใน line-sender เป๊ะ ๆ ไม่งั้น template
// จะได้ข้อมูลของคนหนึ่ง แต่การ์ดขึ้นรูปของอีกคน
// try/catch ของตัวเอง — โรสเตอร์ล่มต้องไม่ทำให้ {person_name} หายไปด้วย
async function _enrichRosterFields(event) {
  try {
    const { rows } = await pool.query(
      `SELECT r.case_note, r.external_id
         FROM events e
         LEFT JOIN LATERAL (
           SELECT sr.case_note, sr.external_id
             FROM face_blacklist bl
             JOIN blacklist.source_records sr ON sr.id::text = bl.enrolled_ref
            WHERE (bl.hcp_person_id = e.raw_json->>'hcp_person_id'
                   OR bl.label      = e.raw_json->>'hcp_person_name')
            ORDER BY (bl.hcp_person_id = e.raw_json->>'hcp_person_id') DESC NULLS LAST
            LIMIT 1) r ON TRUE
        WHERE e.id = $1`, [event.event_id]);
    if (rows[0]?.case_note)   event.ref_note = rows[0].case_note;
    if (rows[0]?.external_id) event.ref_id   = rows[0].external_id;
  } catch (e) {
    console.warn('[alert-engine] เติมข้อมูลโรสเตอร์ไม่สำเร็จ:', e.message);
  }
}

// ── Main event handler ──────────────────────────────────────
async function onEvent(event) {
  // Refresh cache ถ้านานเกิน TTL (กัน timer พลาด)
  if (Date.now() - lastRefresh > CACHE_TTL_MS * 2) {
    await refreshCache();
  }

  // === Mobile PUSH — dispatch ตาม rule.push_user_ids (รายคน) ===
  // อิสระจาก LINE channel on/off. ว่าง = ไม่ส่ง (สมมาตรกับ LINE recipients).
  // push-sender มี cooldown 20s/หัวข้อในตัว จึงไม่พึ่ง isInCooldown ของ LINE.
  for (const rule of rulesCache) {
    if (rule.dwell_threshold_sec) continue;   // dwell rule — ยิงจาก checkDwellRules ไม่ใช่ต่อ event
    const pushUsers = rule.push_user_ids || [];
    if (pushUsers.length === 0) continue;     // ไม่เลือกผู้รับ = ไม่ส่ง
    if (!matchRule(rule, event)) continue;
    if (belowMinLikelihood(rule, event)) continue;
    if (isWithinQuietHours(rule)) continue;
    pushSender.notifyAlert(pool, {
      id:          event.event_id,
      camera_id:   event.camera_id,
      camera_name: event.camera_name,
      location:    event.location,
      rule_name:   event.rule_name,
    }, pushUsers);
    break; // ส่ง push ครั้งเดียวต่อ event แม้ match หลาย rule
  }

  // Bosch snapshots arrive ~1s after the event via a separate MQTT message.
  // Wait briefly so LINE includes the image (mobile push already fired above).
  if (!event.snapshot_filename && _snapshotExpected(event)) {
    const DEADLINE = Date.now() + 6000;
    while (Date.now() < DEADLINE) {
      await new Promise(r => setTimeout(r, 500));
      const r = await pool.query(
        `SELECT snapshot_filename FROM events WHERE id = $1`, [event.event_id]);
      const f = r.rows[0]?.snapshot_filename;
      if (f) { event.snapshot_filename = f; break; }
    }
  }

  const lineReady = !!(configCache && configCache.enabled && configCache.channel_access_token);
  if (rulesCache.length === 0) return; // ไม่มี rule
  // T2b: LINE ปิด/ยังไม่ตั้งค่า เคยหยุดทั้งฟังก์ชันตรงนี้ — พา rule ที่ตั้ง
  // deliver_via='telegram'/'both' หยุดไปด้วยทั้งที่ไม่ได้พึ่ง LINE เลย ยังทำงานต่อได้ถ้ามี
  // อย่างน้อยหนึ่งกฎ (ที่ไม่ใช่ dwell) ใช้ Telegram — เป็นแค่ fast-path ข้าม loop ทั้งก้อน
  // เมื่อไม่มีกฎไหนต้องการ Telegram เลย ส่วนกฎ 'line' แต่ละตัวที่ไม่ได้ใช้ Telegram ยัง
  // ต้องเงียบสนิทเหมือนเดิม — เช็คนั้นอยู่ **ในตัว loop** ด้านล่าง (ก่อนถึงจุดที่เคย
  // เขียน log ไหนๆ) ไม่ใช่ที่นี่
  const anyTelegramRule = rulesCache.some(r =>
    !r.dwell_threshold_sec && (r.deliver_via === 'telegram' || r.deliver_via === 'both'));
  if (!lineReady && !anyTelegramRule) return;

  for (const rule of rulesCache) {
    if (rule.dwell_threshold_sec) continue;   // dwell rule — ยิงจาก checkDwellRules ไม่ใช่ต่อ event
    if (!matchRule(rule, event)) continue;

    const { usesLine, usesTelegram, usesFallback, telegramChats } = _telegramLegFor(rule);
    // 🔴 กฎที่ไม่ได้ใช้ Telegram เลย (deliver_via='line'/'line_then_telegram' ค่าเริ่มต้น)
    // เมื่อ LINE ปิดอยู่ ต้องเงียบสนิทเหมือนก่อน T2b เป๊ะ (ฟังก์ชันทั้งก้อนเคย return ก่อน
    // ถึง loop นี้) — ไม่งั้นทุกกฎ 'line' ที่ match จะเขียน alert_logs แถว 'no_recipients'
    // ต่อ event ทั้งที่ก่อนหน้านี้ไม่เคยมีแถวไหนถูกเขียนเลยในสภาวะนี้ (ของขยะคลาสเดียวกับ
    // ที่ refreshCache() คอมเมนต์ไว้ข้างบน — 27,552 แถว/ชม. จากกฎที่ match ทุก event)
    if (!usesTelegram && !lineReady) continue;

    // Get recipients early so we can record who would have received suppressed alerts
    const allRecipients = configCache?.recipients || [];
    // ว่าง = ไม่ส่ง (เดิม fallback all; เปลี่ยนให้สมมาตรกับ mobile — ผู้รับเป็นตัวกำหนด)
    const targetIds = rule.recipient_ids || [];
    const recipients = (usesLine && lineReady)
      ? allRecipients.filter(r => r.enabled && targetIds.includes(r.id)) : [];

    if (belowMinLikelihood(rule, event)) {
      // Record who would have received this alert (suppressed, ok: null) — ทั้งสองช่องทาง
      const recipientsLog = _suppressedLog(recipients, telegramChats);
      // recipient_count คงเป็น 0 เหมือนเดิม — "ตั้งใจส่งถึงใคร" อยู่ใน recipients_json แทน
      // (ops.js:105 stats รวม SUM(recipient_count) อยู่ อย่าเปลี่ยนความหมายคอลัมน์นี้)
      await logAttempt(rule, event, 'low_likelihood_skip', null, 0, 0, '', null, recipientsLog.length > 0 ? JSON.stringify(recipientsLog) : null);
      continue;
    }

    // Quiet hours — skip (and log) if NOW is INSIDE the configured quiet
    // window. Checked before cooldown: no point tracking cooldown for an
    // alert that's silenced anyway.
    if (isWithinQuietHours(rule)) {
      const recipientsLog = _suppressedLog(recipients, telegramChats);
      // recipient_count คงเป็น 0 เหมือนเดิม — "ตั้งใจส่งถึงใคร" อยู่ใน recipients_json แทน
      // (ops.js:105 stats รวม SUM(recipient_count) อยู่ อย่าเปลี่ยนความหมายคอลัมน์นี้)
      await logAttempt(rule, event, 'quiet_hours_skip', null, 0, 0, '', null, recipientsLog.length > 0 ? JSON.stringify(recipientsLog) : null);
      continue;
    }

    // Cooldown check
    if (isInCooldown(rule)) {
      const recipientsLog = _suppressedLog(recipients, telegramChats);
      // recipient_count คงเป็น 0 เหมือนเดิม — "ตั้งใจส่งถึงใคร" อยู่ใน recipients_json แทน
      // (ops.js:105 stats รวม SUM(recipient_count) อยู่ อย่าเปลี่ยนความหมายคอลัมน์นี้)
      await logAttempt(rule, event, 'cooldown_skip', null, 0, 0, '', null, recipientsLog.length > 0 ? JSON.stringify(recipientsLog) : null);
      continue;
    }

    // T2b: นับผู้รับทั้งสองช่องทาง — ช่องทางที่ตั้งเป็น 'telegram' ล้วนต้องไม่โดน
    // no_recipients เพราะ recipients (LINE) เป็น [] อยู่แล้วโดยไม่เกี่ยวกับว่ามีคนรอรับจริงไหม
    if (recipients.length + telegramChats.length === 0) {
      await logAttempt(rule, event, 'no_recipients', null, 0, 0, '');
      continue;
    }

    // เติมชื่อคน/ชื่อบัญชี/ความคล้าย — เมื่อ template ขอ **หรือ** เป็นเหตุการณ์
    // จับคู่ใบหน้า (การ์ดเทียบภาพต้องใช้ person_name ไม่งั้นตกไปเป็น bubble รูปเดียว)
    // ไม่ขึ้นกับ usesLine — Telegram ต้องการชุดเดียวกันนี้ในการ์ดของตัวเอง
    if (FACE_VARS_RE.test(rule.message_template || '') || _isFaceMatch(rule, event))
      await enrichFaceFields(event, ROSTER_VARS_RE.test(rule.message_template || ''));

    // Send!
    const startMs = Date.now();
    let result = null;
    // recipients.length>0 เสมอเมื่อ usesLine เป็นจริงในเส้นทาง 'line' ล้วน (ผ่าน
    // no_recipients gate ด้านบนมาแล้ว) — เช็คซ้ำที่นี่กัน 'both' ที่ LINE ปิดอยู่แต่
    // Telegram มีคนรับ ไม่ให้เสียงาน build ข้อความ/อัปโหลดรูปของ sendAlert() เปล่า ๆ
    if (usesLine && recipients.length > 0) {
      try {
        result = await _sender.sendAlert({
          rule,
          event,
          recipients,
          token: configCache.channel_access_token,
          imgbbKey: configCache.imgbb_api_key,
          signedTtlSec, allowImgbb,
          // Without this the sender cannot tell which edge holds the snapshot and
          // falls back to a text-only alert — silently, since that fallback is a
          // legitimate outcome. Face and event alerts from Phuket and Hat Yai have
          // been arriving without their image for exactly this reason.
          pool,
        });
      } catch (e) {
        result = { success: false, error: e.message, messageText: '', sentCount: 0 };
      }
    }
    const tgResults = usesTelegram ? await _sendTelegramForRule(rule, event, telegramChats) : [];
    // T3: หลัง LINE ส่งเสร็จ — สำรองไป Telegram เฉพาะผู้รับที่โดน "monthly limit"
    const fbResults = await _sendTelegramFallback(rule, event, usesFallback, result, recipients);
    const durationMs = Date.now() - startMs;

    const totalSent = (result?.sentCount || 0) + tgResults.filter(r => r.ok).length + fbResults.filter(r => r.ok).length;

    // Update last_triggered_at + trigger_count (in DB + cache)
    if (totalSent > 0) {
      try {
        await pool.query(
          'UPDATE alert_rules SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = $1',
          [rule.id]
        );
        rule.last_triggered_at = new Date().toISOString();
        rule.trigger_count = (rule.trigger_count || 0) + 1;
      } catch {}
    }

    // Log — alert_logs แถวเดียวรวมทุกช่องทาง (เหมือน lprLineAlert.js/gsAlarmLine.js)
    const combinedLog = (result?.recipientsLog || []).concat(tgResults).concat(fbResults);
    const errs = [result?.error, tgResults.find(r => !r.ok && r.error)?.error, fbResults.find(r => !r.ok && r.error)?.error].filter(Boolean);
    // deliver_via='line' (ไม่แตะ Telegram เลย) ต้องได้ status แบบเดิมเป๊ะ — "ทุกคนต้องได้
    // ถึงนับว่าสำเร็จ" (result.success = sentCount===recipients.length) มีขา Telegram/
    // สำรอง (T3) ร่วมด้วยเมื่อไหร่ ใช้กติกา "ส่งถึงอย่างน้อยหนึ่งช่องทาง = success" แบบเดียวกับ
    // lprLineAlert.js/gsAlarmLine.js (T2a) เพราะตอนนั้น "ทุกคน" ไม่ใช่กลุ่มเดียวกันอีกต่อไป
    const status = (usesTelegram || usesFallback) ? (totalSent > 0 ? 'success' : 'failed')
                                                   : (result?.success ? 'success' : 'failed');
    await logAttempt(
      rule, event,
      status,
      errs.length ? errs.join('; ') : null,
      totalSent,
      durationMs,
      result?.messageText || '',
      result?.imageSource || null,
      combinedLog.length ? JSON.stringify(combinedLog) : null
    );
  }
}

// ── Logging ─────────────────────────────────────────────────
async function logAttempt(rule, event, status, errorMsg, recipientCount, durationMs, messageText, imageSource = null, recipientsJson = null) {
  try {
    await pool.query(
      `INSERT INTO alert_logs
       (rule_id, rule_name, event_id, camera_id, triggered_rule, event_time,
        status, message_text, recipient_count, error_message, duration_ms, image_source, recipients_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        rule.id, rule.name, event.event_id || null,
        event.camera_id, event.rule_name, event.event_time || new Date().toISOString(),
        status, messageText, recipientCount, errorMsg, durationMs, imageSource, recipientsJson
      ]
    );
  } catch (e) {
    console.error('🔔 Log error:', e.message);
  }
}

// ── Dwell alert "อยู่นานผิดปกติ" (migration 044) ─────────────
// rule ที่ตั้ง dwell_threshold_sec: ไม่ยิงต่อ event — ตัวนี้เช็คว่ามี
// "open episode" (FieldDetector/ObjectsInside ขา true ล่าสุดที่ยังไม่มี
// false ตามมา) ค้างนานเกิน threshold แล้วยิง LINE ระหว่างที่คนยังอยู่.
// cooldown ของ rule = ระยะเตือนซ้ำขณะ episode ยังเปิดอยู่.
// เรียกจาก alert-worker เท่านั้น (ห้ามใส่ใน init() — engine นี้ถูก init
// ในหลาย process: api-server/ingesters ด้วย จะยิงซ้ำกันเอง)
function _fmtDurationTh(sec) {
  if (sec < 60) return `${sec} วินาที`;
  if (sec < 3600) return `${Math.floor(sec / 60)} นาที ${sec % 60} วินาที`;
  return `${Math.floor(sec / 3600)} ชม. ${Math.floor((sec % 3600) / 60)} นาที`;
}

async function checkDwellRules() {
  const dwellRules = rulesCache.filter(r => r.dwell_threshold_sec > 0);
  if (dwellRules.length === 0) return;
  const lineReady = !!(configCache && configCache.enabled && configCache.channel_access_token);
  // T2b: เหมือน onEvent — LINE ปิดทั้งระบบไม่ต้องหยุดกฎ dwell ที่ตั้ง Telegram ไว้
  const anyTelegramRule = dwellRules.some(r => r.deliver_via === 'telegram' || r.deliver_via === 'both');
  if (!lineReady && !anyTelegramRule) return;

  let episodes;
  try {
    // open episode ต่อ (camera, rule): row ล่าสุดใน 24 ชม. เป็น true =
    // ยังมีคนอยู่ (cutoff 24 ชม. เดียวกับ /api/stats/dwell กัน state หลุด)
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (e.camera_id, e.rule_name)
               e.id, e.camera_id, e.rule_name, e.event_state, e.event_time,
               e.snapshot_filename
        FROM events e
        WHERE e.event_type = 'FieldDetector/ObjectsInside'
          AND e.event_state IN ('true','false')
          AND e.event_time > NOW() - INTERVAL '24 hours'
        ORDER BY e.camera_id, e.rule_name, e.event_time DESC
      )
      SELECT l.*, c.name AS camera_name, c.location_label AS location,
             EXTRACT(EPOCH FROM (NOW() - l.event_time))::int AS open_sec
      FROM latest l
      LEFT JOIN cameras c ON c.id = l.camera_id
      WHERE l.event_state = 'true'`);
    episodes = rows;
  } catch (e) {
    console.error('🔔 Dwell check query error:', e.message || e);
    return;
  }
  if (episodes.length === 0) return;

  for (const rule of dwellRules) {
    for (const ep of episodes) {
      if (ep.open_sec < rule.dwell_threshold_sec) continue;
      const event = {
        event_id:          ep.id,
        camera_id:         ep.camera_id,
        camera_name:       ep.camera_name || ep.camera_id,
        location:          ep.location || null,
        rule_name:         ep.rule_name,
        event_type:        'DwellTooLong',
        event_time:        ep.event_time,
        snapshot_filename: ep.snapshot_filename || null,
        duration_text:     _fmtDurationTh(ep.open_sec),
      };
      if (!matchRule(rule, event)) continue;
      if (isWithinQuietHours(rule)) continue;     // ไม่ log — loop ทุกนาทีจะ spam alert_logs
      if (isInCooldown(rule)) continue;           // เตือนซ้ำเมื่อพ้น cooldown ถ้ายังอยู่

      const { usesLine, usesTelegram, usesFallback, telegramChats } = _telegramLegFor(rule);
      const allRecipients = configCache?.recipients || [];
      const targetIds = rule.recipient_ids || [];
      const recipients = (usesLine && lineReady)
        ? allRecipients.filter(r => r.enabled && targetIds.includes(r.id)) : [];
      if (recipients.length + telegramChats.length === 0) continue;

      const startMs = Date.now();
      let result = null;
      if (usesLine && recipients.length > 0) {
        try {
          result = await _sender.sendAlert({
            rule, event, recipients,
            token: configCache.channel_access_token,
            imgbbKey: configCache.imgbb_api_key,
            signedTtlSec, allowImgbb,
            pool,   // see the note on the other sendAlert call
          });
        } catch (e) {
          result = { success: false, error: e.message, messageText: '', sentCount: 0 };
        }
      }
      const tgResults = usesTelegram ? await _sendTelegramForRule(rule, event, telegramChats) : [];
      // T3: หลัง LINE ส่งเสร็จ — สำรองไป Telegram เฉพาะผู้รับที่โดน "monthly limit"
      const fbResults = await _sendTelegramFallback(rule, event, usesFallback, result, recipients);
      const totalSent = (result?.sentCount || 0) + tgResults.filter(r => r.ok).length + fbResults.filter(r => r.ok).length;
      if (totalSent > 0) {
        try {
          await pool.query(
            'UPDATE alert_rules SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = $1',
            [rule.id]
          );
          rule.last_triggered_at = new Date().toISOString();
          rule.trigger_count = (rule.trigger_count || 0) + 1;
        } catch {}
      }
      const combinedLog = (result?.recipientsLog || []).concat(tgResults).concat(fbResults);
      const errs = [result?.error, tgResults.find(r => !r.ok && r.error)?.error, fbResults.find(r => !r.ok && r.error)?.error].filter(Boolean);
      // เหตุผลเดียวกับ onEvent: deliver_via='line' ต้องได้ status "ทุกคนต้องได้" เดิมเป๊ะ
      const status = (usesTelegram || usesFallback) ? (totalSent > 0 ? 'success' : 'failed')
                                                      : (result?.success ? 'success' : 'failed');
      await logAttempt(rule, event, status,
        errs.length ? errs.join('; ') : null, totalSent, Date.now() - startMs, result?.messageText || '',
        result?.imageSource || null,
        combinedLog.length ? JSON.stringify(combinedLog) : null);
    }
  }
}

// ── Edge stale alert ─────────────────────────────────────────
// ตรวจ edge_status ทุก 5 นาที — ส่ง LINE ถ้า site ขาดการติดต่อเกิน threshold

// ── Edge data-loss alert ─────────────────────────────────────
// `edge_status.bridge_dropped` = จำนวนข้อความที่ **หายจริง** ของไซต์นั้น
// (คิวเต็มจนต้องเขี่ยทิ้ง + ข้อความที่ใหญ่เกินเพดาน broker จนส่งไม่ได้)
//
// 🔴 ทำไมต้องมี: บั๊กที่ทำให้คิวของ vss ตายค้าง 2 สัปดาห์ และสัญญาณ "กล้องถูกบัง"
// หายไป 7 สัปดาห์ (incident 2026-08-14) เกิดขึ้นโดย **ไม่มีสัญญาณใด ๆ เลย** —
// pm2 ขึ้น online, heartbeat ขึ้น remote=up ทุกนาที, forwarded เดินหน้าปกติ
// ตัวเลขที่บอกความจริงมีอยู่แล้วแต่ไม่มีใครดู · ตัวนี้คือคนที่ดูให้
//
// ⚠️ ค่านี้ **ไม่ monotonic**: `evicted` เป็นตัวนับในหน่วยความจำของ bridge (รีเซ็ต
// เมื่อ restart) ส่วนไฟล์ใน data/oversized ถูกหมุนทิ้งเมื่อเกินเพดาน ⇒ ค่าลดลงได้
// จึงต้องเทียบกับค่าที่เห็นครั้งก่อน ไม่ใช่ดูค่าดิบอย่างเดียว
const _edgeLossLastSent = new Map();  // site_id → timestamp ที่เตือนล่าสุด
const _edgeLossSeen     = new Map();  // site_id → ค่า bridge_dropped ที่เห็นครั้งก่อน
const _edgeDiskLastSent = new Map();  // site_id → timestamp ที่เตือนพื้นที่ล่าสุด

// เกณฑ์ "การลบยังทำงานอยู่ไหม" — prune ที่ edge วิ่งทุกชั่วโมง ถ้าเกิน 3 ชั่วโมง
// แล้วยังไม่มีผลรอบใหม่ส่งกลับมา แปลว่ามันหยุดไปแล้ว ไม่ใช่แค่ช้า
const PRUNE_STALE_MS = parseInt(process.env.EDGE_PRUNE_STALE_MS || String(3 * 3600 * 1000), 10);

/**
 * ตัดสินว่าไซต์นี้ควรเตือนหรือยัง — แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อให้เทสต์ได้
 * โดยไม่ต้องมี DB และไม่ต้องยิง LINE จริง
 *
 * กติกา:
 *   - เพิ่มขึ้นจากครั้งก่อน → เตือน (นี่คือ "มีของหายเพิ่ม")
 *   - เท่าเดิม            → ไม่เตือนซ้ำ
 *   - ลดลง (restart/หมุนไฟล์) → ตั้งฐานใหม่เงียบ ๆ ไม่เตือน
 *   - ยังไม่เคยเห็นไซต์นี้ ฐานคือ 0 ⇒ ถ้ามีของหายค้างอยู่ จะเตือน 1 ครั้งหลัง restart
 *     ตั้งใจให้เป็นแบบนี้ — ของที่ยังหายอยู่ควรถูกเตือนซ้ำ ไม่ใช่เงียบไปเพราะเรา restart
 * @returns {{alert: boolean, delta: number}}
 */
function _lossDecision(siteId, dropped, seenMap = _edgeLossSeen) {
  const prev = seenMap.has(siteId) ? seenMap.get(siteId) : 0;
  const cur  = Number.isFinite(dropped) ? dropped : 0;
  seenMap.set(siteId, cur);
  return { alert: cur > prev, delta: cur - prev };
}

// Settings live in line_config.edge_alert (JSONB). Defaults reproduce the old
// hard-coded behaviour; each field is clamped so a bad DB value can't turn the
// alert into a spam loop (threshold 0 → every site matches every 5 min).
const EDGE_ALERT_DEFAULTS = { enabled: true, threshold_sec: 180, cooldown_hours: 4, disabled_sites: [], recipient_ids: null };
function _edgeAlertSettings(raw) {
  const c = raw || {};
  const thr = parseInt(c.threshold_sec, 10);
  const cd  = Number(c.cooldown_hours);
  return {
    enabled: c.enabled !== false, // default true
    threshold_sec: Number.isFinite(thr) ? Math.max(60, thr) : EDGE_ALERT_DEFAULTS.threshold_sec,
    cooldown_ms: (Number.isFinite(cd) && cd > 0 ? cd : EDGE_ALERT_DEFAULTS.cooldown_hours) * 60 * 60 * 1000,
    disabled_sites: Array.isArray(c.disabled_sites) ? c.disabled_sites : [],
    recipient_ids: Array.isArray(c.recipient_ids) ? c.recipient_ids : null, // null = all enabled
  };
}

// ── ยิง LINE ให้ผู้รับทุกคนแล้วคืนผลรายคน (edge alert 3 ตัวใช้ร่วมกัน) ──────
//
// 🔴 บั๊กเดิมที่แก้ไปพร้อมกัน (พบ 2026-08-31): ลูปเดิมเขียนเป็น
//     try { await lineSender.pushLineMessage(...); sent = true; } catch {}
//   แต่ pushLineMessage() **ไม่เคย throw** — มัน resolve({success:false,error})
//   เสมอแม้ LINE ตอบ 4xx/5xx หรือ timeout · catch จึงไม่เคยทำงาน และ sent
//   กลายเป็น true ทุกครั้งที่มีผู้รับอย่างน้อยหนึ่งคน ไม่ว่าจะส่งถึงจริงหรือไม่
//   ผลคือ cooldown ถูกตั้ง + alert_logs บันทึก 'sent' + recipient_count เต็มจำนวน
//   ทั้งที่อาจไม่มีใครได้รับเลย · ตรงนี้อ่าน result.success จริง ๆ
async function _pushToAll(token, recipients, messages, tag) {
  let sent = false;
  const log = [];
  for (const r of recipients) {
    let result;
    try {
      result = await _sender.pushLineMessage(token, r.id, messages);
    } catch (e) {                       // กันไว้เผื่อวันหน้ามันโยนจริง
      result = { success: false, error: e.message };
    }
    if (result?.success) sent = true;
    else console.warn(`[alert-engine] ${tag} LINE ${r.id}:`, result?.error);
    log.push({
      name: r.name || null,
      type: r.type || null,
      id_tail: r.id ? String(r.id).slice(-4) : null,
      ok: !!result?.success,
      error: result?.success ? null : (result?.error || null),
      line_request_id: result?.request_id || null,
    });
  }
  return { sent, recipientsLog: log, okCount: log.filter(x => x.ok).length };
}

// ── สถานะ "ขาดการติดต่อ" ของ edge — เล่าเป็นเหตุการณ์ ไม่ใช่ส่งซ้ำตามนาฬิกา ──
//
// เดิม: query เฉพาะแถวที่ stale แล้วส่งข้อความเดิมซ้ำทุก cooldown · วัดจริงจาก
// alert_logs 17 วันพบ rmutr-v ดับ ~24 ชม. ได้ข้อความหน้าตาเหมือนกัน 6 ใบ ห่างกัน
// 4h05m เป๊ะ และไม่เคยมีข้อความตอนกลับมาเลย เพราะไซต์ที่กลับมาหลุดออกจาก WHERE
// เงียบ ๆ ไม่มี code path ไหนได้เห็น
//
// ตอนนี้: อ่านทุกไซต์ (ไม่ใช่เฉพาะ stale) แล้วเดิน state machine ที่เก็บใน
// edge_status (migration 188) ซึ่งอยู่รอด restart — ของเดิมเป็น Map ในหน่วยความจำ
// ที่หายทุกครั้งที่ restart ทั้งที่ comment ยอมรับข้อจำกัดนี้ไว้เองตั้งแต่ 2026-08-13
//
// ⚠️ ต้องนิ่ง RECOVER_STABLE_SEC ก่อนถึงจะแจ้งว่ากลับมา — ไซต์ที่กระพริบทุก 10 นาที
//    ไม่งั้นจะกลายเป็นสแปมสองเท่าแทนที่จะเงียบลง
const RECOVER_STABLE_SEC = 600;          // 10 นาที = 2 รอบตรวจ
const OFFLINE_REPEAT_2_MS = 24 * 60 * 60 * 1000;  // ซ้ำใบที่ 3 เป็นต้นไป = วันละครั้ง

function _dur(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} นาที`;
  const h = m / 60;
  return h < 24 ? `${h.toFixed(1)} ชั่วโมง` : `${(h / 24).toFixed(1)} วัน`;
}

async function checkEdgeStale() {
  if (!configCache || !configCache.enabled || !configCache.channel_access_token) return;
  const cfg = _edgeAlertSettings(configCache.edge_alert);
  if (!cfg.enabled) return;

  // Edge alert deliberately ignores each recipient's lpr_sites scope — an edge
  // going down is a system-health event, not per-site LPR traffic. recipient_ids
  // (when set) is the only filter on top of enabled.
  let allRecipients = (configCache.recipients || []).filter(r => r.enabled);
  if (cfg.recipient_ids) allRecipients = allRecipients.filter(r => cfg.recipient_ids.includes(r.id));
  if (allRecipients.length === 0) return;

  let rows;
  try {
    const { rows: r } = await pool.query(`
      SELECT site_id, last_seen_at, bridge_remote, bridge_local, disk_free_gb, disk_total_gb,
             offline_since, offline_notified_at, offline_notify_count, recovered_at,
             extract(epoch from (now() - last_seen_at))::int AS stale_sec
      FROM edge_status
      ORDER BY site_id
    `);
    rows = r;
  } catch (e) { console.error('[alert-engine] checkEdgeStale query:', e.message); return; }

  const now = Date.now();
  const wentDown = [];   // { site, minAgo, detail }
  const cameBack = [];   // { site, downMs }
  const stillDown = [];  // { site, elapsedMs, count }

  // ไซต์ maintenance/archived เงียบทุกแจ้งเตือน (sites.status · migration 285)
  const quiet = await quietSiteCodes(pool);
  for (const site of rows) {
    // ไซต์ที่ถูกปิดเสียงต้องเงียบทุกสถานะ รวมถึงตอนกลับมาด้วย — ไม่ใช่ปิดแค่ขาลง
    if (cfg.disabled_sites.includes(site.site_id) || quiet.has(site.site_id)) continue;

    const isStale = site.stale_sec > cfg.threshold_sec;
    const offlineSince = site.offline_since ? new Date(site.offline_since).getTime() : null;

    if (isStale) {
      if (!offlineSince) {
        // ลง: จับเวลาจาก heartbeat สุดท้าย ไม่ใช่ now() — คือเวลาที่ขาดการติดต่อจริง
        const disk = (site.disk_free_gb !== null && site.disk_total_gb !== null)
          ? `\nDisk: ${site.disk_free_gb}/${site.disk_total_gb} GB` : '';
        wentDown.push({
          site,
          minAgo: Math.round(site.stale_sec / 60),
          detail: `Bridge remote=${site.bridge_remote || '?'} local=${site.bridge_local || '?'}${disk}`,
        });
      } else {
        // ยังดับอยู่ — ใบซ้ำใบแรกที่ cooldown_hours จากนั้นวันละครั้ง
        const notifiedAt = site.offline_notified_at ? new Date(site.offline_notified_at).getTime() : 0;
        const count = site.offline_notify_count || 0;
        const wait = count >= 2 ? OFFLINE_REPEAT_2_MS : cfg.cooldown_ms;
        if (count >= 1 && now - notifiedAt >= wait) {
          stillDown.push({ site, elapsedMs: now - offlineSince, count });
        }
        // ระหว่างที่ยังดับ ถ้าเคยแตะ recovered_at ไว้ก็ต้องล้าง (กระพริบ)
        if (site.recovered_at) {
          await _edgeState(site.site_id, { recovered_at: null }).catch(() => {});
        }
      }
      continue;
    }

    // ── ถึงตรงนี้ = heartbeat สดแล้ว ──
    if (!offlineSince) continue;                    // ปกติดีมาตลอด ไม่ต้องทำอะไร

    if (!site.recovered_at) {
      // เพิ่งเห็นกลับมา — ยังไม่แจ้ง รอให้นิ่งก่อน
      await _edgeState(site.site_id, { recovered_at: new Date(now).toISOString() }).catch(() => {});
      continue;
    }
    const backAt = new Date(site.recovered_at).getTime();
    if (now - backAt >= RECOVER_STABLE_SEC * 1000) {
      cameBack.push({ site, downMs: backAt - offlineSince });
    }
  }

  await _edgeAnnounce(cfg, allRecipients, wentDown, stillDown, cameBack);
}

// เขียนสถานะทีละไซต์ · แยกออกมาเพื่อให้ทุกจุดใช้ UPDATE รูปเดียวกัน และ error
// ของการเขียนสถานะต้องไม่ทำให้ลูปตาย (ผู้เรียกทุกคน .catch เอง)
async function _edgeState(siteId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE edge_status SET ${sets} WHERE site_id = $1`,
    [siteId, ...keys.map(k => fields[k])]);
}

// ส่งข้อความ + บันทึก alert_logs + ขยับสถานะ · สถานะขยับ **หลัง** ส่งสำเร็จเท่านั้น
// (กติกาเดิม: push ที่ล้มเหลวห้ามกิน cooldown)
async function _edgeAnnounce(cfg, recipients, wentDown, stillDown, cameBack) {
  const token = configCache.channel_access_token;
  const nowIso = new Date().toISOString();

  const log = async (ruleName, siteId, prefix, text, r) => {
    try {
      await pool.query(
        `INSERT INTO alert_logs (rule_id, rule_name, camera_id, triggered_rule, event_time,
                                 status, message_text, recipient_count, sent_at, recipients_json)
         VALUES (NULL, $1, $2, $3, NOW(), 'sent', $4, $5, NOW(), $6)`,
        [ruleName, siteId, `${prefix}:${siteId}`, text.slice(0, 500), r.okCount,
         JSON.stringify(r.recipientsLog)]
      );
    } catch (e) { console.warn(`[alert-engine] log ${prefix}:`, e.message); }
  };

  // ── ขาลง ── หลายไซต์พร้อมกันรวบเป็นใบเดียว · การลงพร้อมกันเองก็เป็นสัญญาณ
  // (17/8 และ 23/8 มีสามไซต์ลงในนาทีเดียว ซึ่งคือฝั่งกลางสะดุด ไม่ใช่สามไซต์เสีย)
  if (wentDown.length) {
    const text = wentDown.length === 1
      ? `⚠️ Edge [${wentDown[0].site.site_id.toUpperCase()}] ขาดการติดต่อ ${wentDown[0].minAgo} นาที\n${wentDown[0].detail}`
      : `⚠️ Edge ขาดการติดต่อ ${wentDown.length} ไซต์: `
        + wentDown.map(w => w.site.site_id.toUpperCase()).join(', ')
        + `\nหลายไซต์ลงพร้อมกันมักเป็นฝั่งส่วนกลางหรือ broker มากกว่าตัวไซต์เอง`;
    const r = await _pushToAll(token, recipients, [{ type: 'text', text }], 'edge stale');
    if (r.sent) {
      for (const w of wentDown) {
        await _edgeState(w.site.site_id, {
          offline_since: w.site.last_seen_at,
          offline_notified_at: nowIso,
          offline_notify_count: 1,
          recovered_at: null,
        }).catch(e => console.warn('[alert-engine] state down:', e.message));
        await log('Edge Offline', w.site.site_id, 'edge_stale', text, r);
      }
      console.log(`[alert-engine] edge down: ${wentDown.map(w => w.site.site_id).join(',')}`);
    }
  }

  // ── ยังไม่กลับ ── ส่งแยกทีละไซต์: เหตุคนละเหตุ ระยะเวลาคนละค่า
  for (const d of stillDown) {
    const text = `⚠️ Edge [${d.site.site_id.toUpperCase()}] ยังไม่กลับมา — ดับมาแล้ว ${_dur(d.elapsedMs)}`;
    const r = await _pushToAll(token, recipients, [{ type: 'text', text }], 'edge still');
    if (r.sent) {
      await _edgeState(d.site.site_id, {
        offline_notified_at: nowIso,
        offline_notify_count: d.count + 1,
      }).catch(e => console.warn('[alert-engine] state still:', e.message));
      await log('Edge Still Offline', d.site.site_id, 'edge_still', text, r);
    }
  }

  // ── ขากลับ ── ตัวเลขที่คนอยากรู้ตอนเช้าคือ "หายไปนานแค่ไหน" ไม่ใช่แค่ "กลับมาแล้ว"
  if (cameBack.length) {
    const text = cameBack.length === 1
      ? `✅ Edge [${cameBack[0].site.site_id.toUpperCase()}] กลับมาแล้ว — ดับไปทั้งหมด ${_dur(cameBack[0].downMs)}`
      : `✅ Edge กลับมาแล้ว ${cameBack.length} ไซต์:\n`
        + cameBack.map(c => `· ${c.site.site_id.toUpperCase()} — ดับไป ${_dur(c.downMs)}`).join('\n');
    const r = await _pushToAll(token, recipients, [{ type: 'text', text }], 'edge back');
    if (r.sent) {
      for (const c of cameBack) {
        await _edgeState(c.site.site_id, {
          offline_since: null, offline_notified_at: null,
          offline_notify_count: 0, recovered_at: null,
        }).catch(e => console.warn('[alert-engine] state back:', e.message));
        await log('Edge Recovered', c.site.site_id, 'edge_back', text, r);
      }
      console.log(`[alert-engine] edge back: ${cameBack.map(c => c.site.site_id).join(',')}`);
    }
  }
}

/**
 * เตือนเมื่อไซต์ไหน "ทำข้อมูลหาย" เพิ่มขึ้น — ใช้ค่า edge_status.bridge_dropped
 *
 * ใช้ตั้งค่าชุดเดียวกับ edge stale (line_config.edge_alert) โดยตั้งใจ: คนที่อยาก
 * รู้ว่า edge ล่ม ก็คือคนเดียวกับที่อยากรู้ว่า edge ทำข้อมูลหาย ไม่ต้องมีสวิตช์สองอัน
 */
async function checkEdgeDataLoss() {
  if (!configCache || !configCache.enabled || !configCache.channel_access_token) return;
  const cfg = _edgeAlertSettings(configCache.edge_alert);
  if (!cfg.enabled) return;

  let allRecipients = (configCache.recipients || []).filter(r => r.enabled);
  if (cfg.recipient_ids) allRecipients = allRecipients.filter(r => cfg.recipient_ids.includes(r.id));
  if (allRecipients.length === 0) return;

  let rows;
  try {
    // อ่านทุกไซต์ ไม่ใช่เฉพาะที่ >0 — ต้องเห็นค่าที่ลดลงด้วยเพื่อตั้งฐานใหม่
    // ถ้ากรอง >0 ตั้งแต่ใน SQL ไซต์ที่เพิ่งถูกล้างจะค้างฐานเก่าไว้ตลอดกาล
    ({ rows } = await pool.query(
      `SELECT site_id, COALESCE(bridge_dropped, 0)::int AS dropped, bridge_forwarded
         FROM edge_status`));
  } catch (e) { console.error('[alert-engine] checkEdgeDataLoss query:', e.message); return; }

  // ไซต์ maintenance/archived เงียบทุกแจ้งเตือน (sites.status · migration 285)
  const quiet = await quietSiteCodes(pool);
  for (const site of rows) {
    if (cfg.disabled_sites.includes(site.site_id) || quiet.has(site.site_id)) continue;
    const { alert, delta } = _lossDecision(site.site_id, site.dropped);
    if (!alert) continue;

    const last = _edgeLossLastSent.get(site.site_id) || 0;
    if (Date.now() - last < cfg.cooldown_ms) continue;

    const text = `⚠️ Edge [${site.site_id.toUpperCase()}] มีข้อมูลส่งไม่ถึงส่วนกลาง\n`
      + `หายเพิ่ม ${delta} รายการ (รวมสะสม ${site.dropped})\n`
      + `ดูของจริงได้ที่ data/oversized/ บนเครื่องนั้น`;

    const { sent, recipientsLog, okCount } =
      await _pushToAll(configCache.channel_access_token, allRecipients, [{ type: 'text', text }], 'edge loss');
    if (sent) {
      _edgeLossLastSent.set(site.site_id, Date.now());
      console.log(`[alert-engine] edge data-loss alert sent: ${site.site_id} (+${delta}, total ${site.dropped})`);
      try {
        await pool.query(
          `INSERT INTO alert_logs (rule_id, rule_name, camera_id, triggered_rule, event_time,
                                   status, message_text, recipient_count, sent_at, recipients_json)
           VALUES (NULL, 'Edge Data Loss', $1, $2, NOW(), 'sent', $3, $4, NOW(), $5)`,
          [site.site_id, `edge_loss:${site.site_id}`, text.slice(0, 500), okCount, JSON.stringify(recipientsLog)]
        );
      } catch (e) { console.warn('[alert-engine] log edge loss:', e.message); }
    }
  }
}


// ── พื้นที่ดิสก์ของ edge + การลบยังทำงานอยู่ไหม (2026-08-27) ──────────────
//
// ── กล้องเงียบรายตัว — วัดจาก "ข้อมูลมาถึงเราเมื่อไหร่" ────────────────────
//
// 🔴 incident 2026-09-12: กล้องภูเก็ต 4 ตัว (C9/C10/C17/C30-KAR) หยุดส่งข้อมูล
// 09:13–18:00 น. แล้วคายย้อนหลังทีเดียว ⇒ การ์ดตามจับรถเข้า LINE ตอนหนึ่งทุ่ม
// สำหรับรถที่ผ่านกล้องตั้งแต่เช้า · ไม่มีตัวไหนเตือนเลยทั้งที่สัญญาณมีครบ
//
// ทำไมตัวเฝ้าที่มีอยู่จับไม่ได้ — วัดแล้วทั้งสองตัว:
//   · checkEdgeStale วัด edge_status.last_seen_at = heartbeat ของไซต์ ซึ่ง "up"
//     ตลอดช่วงนั้น และกล้องอีก 9 ตัวบนไซต์เดียวกันก็ส่งข้อมูลปกติ
//     ⇒ ตัวเฝ้าระดับไซต์แก้ให้จับเคสนี้ไม่ได้ ไม่ว่าจะปรับเกณฑ์ยังไง
//   · checkOfflineCameras (api-server) จับได้ถูกต้องตั้งแต่ 09:13 — แต่ปลายทาง
//     ปิดอยู่ทั้ง 188 แถว และมันวัด TCP probe ซึ่งกะพริบ online 90 วินาทีทุกชั่วโมง
//     (วัดจริง: 677 การเปลี่ยนสถานะ/24 ชม. จาก 76 กล้อง · BOSCH_3100i_02 ตัวเดียว
//     143 ช่วง/7 วัน) ⇒ เปิดตามนั้น = สแปม และนั่นคือเหตุผลที่มันถูกปิดไว้
//
// ตัวนี้จึงวัด `events.received_at` แทน — "ข้อมูลมาถึงเราครั้งล่าสุดเมื่อไหร่"
// ระหว่างกล้องกะพริบไม่มีข้อมูลมาสักแถว อายุจึงเดินหน้าต่อเนื่อง **ไม่ต้องเย็บช่วงเอง**
// (ห้ามใช้ event_time: ของที่บัฟเฟอร์ไว้พกเวลาเดิมติดมาด้วย พอคายออกมาประวัติ
//  จะดูสวยงามย้อนหลังทั้งที่เราไม่ได้รับอะไรเลยมา 9 ชั่วโมง — วัดจริงวันนั้น
//  event_time กระจายทุกชั่วโมงเท่า ๆ กัน ส่วน received_at ว่าง 10:00–17:00 สนิท)
//
// เกณฑ์ 20 นาที มาจากการวัด 7 วัน ไม่ใช่เดา: ช่วงเงียบ ≤10 นาที มี 1,286 ครั้ง
// (ถนนเงียบตามปกติ) · 20–60 นาที มี 483 ครั้ง · 4 กล้อง KAR ปกติ 0 ครั้ง
// เพิ่งมี 9 ครั้งในวันเกิดเหตุ ⇒ เส้นนี้เงียบกับกล้องที่สำคัญ ดังกับกล้องที่พังจริง
const QUIET_ALERT_DEFAULTS = {
  enabled: false, floor_min: 20, multiplier: 3, baseline_ceiling_min: 30,
  min_samples: 100, cooldown_hours: 6, excluded_cameras: [], recipient_ids: [],
};

// 🔴 ต่างจาก _edgeAlertSettings ตรง `enabled` และ `recipient_ids` โดยตั้งใจ:
//   · enabled ตั้งต้น **false** และคุม **เฉพาะการยิง LINE** ไม่ได้คุมการคำนวณสถานะ
//   · recipient_ids ตั้งต้น **[] = ไม่ส่งหาใครเลย** ไม่ใช่ null ที่แปลว่า "ทุกคน"
// เหตุผล (เจ้าของสั่ง 2026-09-12): ยังไม่ได้กำหนดกลุ่มผู้รับ และผู้รับ LINE ที่
// enabled อยู่ตอนนี้รวมกลุ่มลูกค้า/ตำรวจ · ตัวเตือนที่เผลอ fallback เป็น "ทุกคน"
// จะยิงเข้ากลุ่มลูกค้าทันทีที่ใครเปิดสวิตช์ ⇒ ที่นี่ต้องระบุกลุ่มเองเสมอ
function _quietAlertSettings(raw) {
  const c = raw || {};
  const num = (v, def, min) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, n) : def;
  };
  return {
    enabled: c.enabled === true,                       // ต้องเปิดเอง ไม่ใช่ default true
    floor_min: num(c.floor_min, QUIET_ALERT_DEFAULTS.floor_min, 5),
    multiplier: num(c.multiplier, QUIET_ALERT_DEFAULTS.multiplier, 1),
    baseline_ceiling_min: num(c.baseline_ceiling_min, QUIET_ALERT_DEFAULTS.baseline_ceiling_min, 1),
    min_samples: num(c.min_samples, QUIET_ALERT_DEFAULTS.min_samples, 1),
    cooldown_ms: num(c.cooldown_hours, QUIET_ALERT_DEFAULTS.cooldown_hours, 0.1) * 3600 * 1000,
    excluded_cameras: Array.isArray(c.excluded_cameras) ? c.excluded_cameras : [],
    // null/undefined = ไม่ส่ง · ไม่ใช่ "ส่งทุกคน"
    recipient_ids: Array.isArray(c.recipient_ids) ? c.recipient_ids : [],
  };
}

/**
 * เกณฑ์ของกล้องหนึ่งตัว — คืน null ถ้ากล้องนี้ "เฝ้าด้วยความเงียบไม่ได้"
 *
 * กล้องที่ p99 ของตัวเองสูง (Face ที่ประตู, กล้องโชว์) เงียบข้ามคืนเป็นเรื่องปกติ
 * ⇒ ไม่ใช่ยกเว้นเพราะมันพัง แต่เพราะ **ความเงียบไม่ใช่สัญญาณของกล้องประเภทนั้น**
 * รายชื่อจึงไม่ต้องมีใครมาดูแล — กล้องใหม่เข้ากลุ่มเองใน ~2 วัน กล้องที่ย้ายจุด
 * ก็เลื่อนกลุ่มเอง (ดูเหตุผลเต็มใน migration 225)
 */
function _quietThresholdMs(cfg, base) {
  if (!base) return null;                                    // ยังไม่มีฐาน = ยังไม่เฝ้า
  if (base.samples < cfg.min_samples) return null;           // ตัวอย่างน้อยเกินจะเชื่อ
  if (base.p99_min > cfg.baseline_ceiling_min) return null;  // เงียบเป็นสภาพปกติของมัน
  return Math.max(cfg.floor_min, cfg.multiplier * base.p99_min) * 60000;
}

/**
 * คำนวณสถานะ "กล้องไหนกำลังเงียบ" — **ทำเสมอ ไม่ขึ้นกับว่า LINE เปิดหรือปิด**
 *
 * 🔴 เหตุผลที่ต้องแยกจากการยิง LINE (แก้ 2026-09-12 หลังเจ้าของถามเรื่อง popup):
 * ของเดิม return ทันทีเมื่อ LINE ปิด ⇒ ไม่มีอะไรคำนวณเลย ⇒ หน้าจอไม่มีตัวเลขให้อ่าน
 * แต่เจ้าของสั่งให้ LINE ปิดไว้จนกว่าจะกำหนดกลุ่มผู้รับ · ป้ายบนหน้าจอไม่มีความเสี่ยง
 * แบบเดียวกับ LINE (ไม่หลุดออกนอกระบบ) จึงต้องเดินได้ตั้งแต่ LINE ยังปิด
 */
async function _computeQuietState(cfg) {
  let cams, fresh, state, bases;
  try {
    [cams, fresh, state, bases] = await Promise.all([
      // ไซต์ maintenance/archived เงียบทุกแจ้งเตือน (sites.status · migration 285)
      pool.query(`SELECT id, name, site_id FROM cameras WHERE paused = FALSE
                     AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = cameras.site_id AND s.status <> 'active')`),
      // ชั้นที่ 1 (ถูก): คัดกล้องที่ "ไม่เงียบแน่ ๆ" ออกก่อน โดยไม่ต้องดูฐาน
      //
      // 🔴 ต้องถามด้วย event_time ไม่ใช่ received_at (แก้ 2026-09-12 หลังหลุดขึ้น prod):
      // `events` **ไม่มี index บน received_at เลยสักตัว** ทุกตัวอยู่บน event_time
      // ⇒ ถาม received_at = seq scan ทั้งตาราง วัดจริง 37,396 ms · ถาม event_time
      // เดินบน index ได้ 686 ms (เร็วขึ้น 54 เท่า) และลูปนี้วิ่งทุก 5 นาที
      //
      // ความคลาดเคลื่อนที่ยอมรับได้ และแก้ตัวเองที่ชั้นสอง: กล้องที่กำลังคายของที่
      // บัฟเฟอร์ไว้จะมี event_time เก่า ⇒ ชั้นนี้ไม่นับว่า "สด" ⇒ ตกไปชั้นสอง ซึ่งอ่าน
      // max(received_at) ของจริงแล้วได้ ≈ เดี๋ยวนี้ ⇒ ไม่ถูกแจ้ง · ชั้นสองคือคำตอบสุดท้าย
      // เสมอ ชั้นนี้เป็นแค่ตัวกรองราคาถูก
      pool.query(`SELECT DISTINCT camera_id FROM events
                   WHERE event_time > now() - ($1 || ' minutes')::interval`,
                 [String(cfg.floor_min)]),
      pool.query(`SELECT * FROM camera_quiet_alerts`),
      pool.query(`SELECT camera_id, p99_min, samples FROM camera_event_baseline`),
    ]);
  } catch (e) { console.error('[alert-engine] quiet state query:', e.message); return null; }

  const isFresh = new Set(fresh.rows.map(r => r.camera_id));
  const stateBy = new Map(state.rows.map(r => [r.camera_id, r]));
  const baseBy  = new Map(bases.rows.map(r => [r.camera_id, r]));

  // กล้องที่มีแถวสถานะอยู่แล้วต้องถูกดูแลต่อแม้ไม่ผ่านเกณฑ์ฐาน (ไม่มีฐาน / p99 > เพดาน) — เหตุ 2026-10-06:
  // กล้อง 12 ตัวที่ภูเก็ตตายตั้งแต่ 14 ก.ย. หลุดจากฐาน (ไม่มีข้อมูลใน 14 วัน) แล้วหลุดจากการเฝ้าเงียบ ๆ
  // และแถวของกล้องที่กลับมาแล้วแต่ p99 > 30 (C56-PT-SB-23) ค้างบนป้าย topbar ไม่มีใครลบ
  const thrOf = (id) => _quietThresholdMs(cfg, baseBy.get(id))
    ?? (stateBy.has(id) ? cfg.floor_min * 60000 : null);
  const watched = cams.rows.filter(c => !cfg.excluded_cameras.includes(c.id) && thrOf(c.id) !== null);
  // แถวของกล้องที่ถูกยกเว้น / หยุดชั่วคราว / ถูกลบ ไม่มีใครดูแลอีกแล้ว — ลบทิ้ง ไม่งั้นค้างบนป้ายตลอดไป
  const watchedIds = new Set(watched.map(c => c.id));
  for (const id of stateBy.keys()) {
    if (!watchedIds.has(id)) {
      await pool.query(`DELETE FROM camera_quiet_alerts WHERE camera_id = $1`, [id]).catch(() => {});
      stateBy.delete(id);
    }
  }
  const quietIds = watched.filter(c => !isFresh.has(c.id)).map(c => c.id);

  // ชั้นที่ 2 (แพงกว่า แต่ทำกับกล้องไม่กี่ตัว): กล้องที่เงียบเกิน floor แล้วเท่านั้น
  // จึงต้องรู้ว่า "ครั้งสุดท้ายที่ได้ยินคือเมื่อไหร่" · กล้องที่ไม่มีแถวเลยใน 7 วัน
  // = ไม่เคยส่งอะไรมา ไม่ใช่กล้องที่เพิ่งเงียบ ⇒ ข้าม (ไม่งั้นเตือนถาวรไม่มีวันหาย)
  let lastRx = new Map();
  // แคชแบบเพิ่มทีละส่วน (2026-10-07): ทุกรอบอ่านเฉพาะแถวที่ id > mark (PK (id, event_time) ทุก partition
  //   ⇒ ไม่กี่พันแถว) แล้วเก็บ max(received_at) ต่อกล้องไว้ · คิวรี 10 วันข้างล่างเหลือเฉพาะกล้องที่ยังไม่เคย
  //   เห็นแถวเลยตั้งแต่ process เริ่ม (รอบแรกหลังบูต) · เดิมยิง 10 วันทุก 5 นาที: เฉลี่ย 3.3 วิ สูงสุด 16 วิ
  //   (อ่าน heap 229k แถวเพื่อเอา received_at ซึ่งไม่มี index) · perfWatch แจ้ง 2026-10-07
  // ถูกต้องเพราะแถวที่เข้ามาหลัง mark มี received_at ใหม่กว่าทุกแถวก่อนหน้า (default now()) ⇒ กล้องที่มีค่า
  //   ในแคชแล้ว ค่านั้นคือ max จริง · mark ถอยไว้ RX_MARK_OVERLAP แถว กันแถวที่ได้ id แล้วแต่ commit ทีหลัง
  try {
    const top = (await pool.query(`SELECT max(id) AS top FROM events`)).rows[0]?.top;
    if (_rx.mark != null) {
      const { rows } = await pool.query(
        `SELECT camera_id, max(received_at) AS rx FROM events
          WHERE id > $1 AND event_time > now() - interval '10 days' GROUP BY camera_id`, [_rx.mark]);
      for (const r of rows) {
        const prev = _rx.last.get(r.camera_id);
        if (!prev || new Date(r.rx) > new Date(prev)) _rx.last.set(r.camera_id, r.rx);
      }
    }
    if (top != null) _rx.mark = Math.max(0, Number(top) - RX_MARK_OVERLAP);
  } catch (e) { console.error('[alert-engine] quiet state rx-incremental:', e.message); _rx.mark = null; _rx.last.clear(); }
  // หน้าต่าง 10 วันเท่าเดิม — ค่าในแคชที่เก่ากว่านั้นถือว่าไม่มี (เหมือนคิวรีที่ไม่คืนแถว)
  const rxCut = Date.now() - 10 * 86_400_000;
  for (const [id, v] of _rx.last) if (new Date(v).getTime() < rxCut) _rx.last.delete(id);
  const needFull = quietIds.filter(id => !_rx.last.has(id));
  for (const id of quietIds) if (_rx.last.has(id)) lastRx.set(id, _rx.last.get(id));
  if (needFull.length) {
    try {
      // 🔴 ขอบเป็น event_time แต่ค่าที่เอาคือ max(received_at) — ตั้งใจให้ต่างกัน
      // ขอบมีไว้ให้เดินบน index (camera_id, event_time DESC) เท่านั้น ส่วนคำถามจริง
      // ยังเป็น "ข้อมูลมาถึงเราครั้งล่าสุดเมื่อไหร่" เหมือนเดิม · วัดจริง 2026-09-12:
      // กรองด้วย received_at 7 วัน = timeout (>60 วิ) · กรองด้วย event_time 10 วัน = 1.4 วิ
      //
      // 10 วันเผื่อไว้เกินเท่าตัวของที่บัฟเฟอร์นานที่สุดที่เคยวัดได้ (71.2 ชม. ≈ 3 วัน)
      // ⚠️ ถ้าเจอไซต์ที่บัฟเฟอร์นานกว่านี้ ให้ขยายขอบ ไม่ใช่ตัดทิ้ง — ตัดทิ้งแล้วคิวรี
      // จะกลับไป timeout เหมือนเดิม
      const { rows } = await pool.query(
        `SELECT camera_id, max(received_at) AS last_rx FROM events
          WHERE camera_id = ANY($1::text[]) AND event_time > now() - interval '10 days'
          GROUP BY camera_id`, [needFull]);
      for (const r of rows) { lastRx.set(r.camera_id, r.last_rx); if (_rx.mark != null) _rx.last.set(r.camera_id, r.last_rx); }
    } catch (e) { console.error('[alert-engine] quiet state lastRx:', e.message); return null; }
  }

  const now = Date.now();
  const wentQuiet = [], stillQuiet = [], cameBack = [];

  for (const cam of watched) {
    const st = stateBy.get(cam.id);
    if (isFresh.has(cam.id)) {
      // มีข้อมูลเข้ามาแล้ว — ถ้าเคยแจ้งไว้ต้องบอกว่ากลับมา ไม่ใช่เงียบหายไปเฉย ๆ
      if (st && st.quiet_since) {
        if (st.notify_count > 0) cameBack.push({ cam, downMs: now - new Date(st.quiet_since).getTime() });
        else await pool.query(`DELETE FROM camera_quiet_alerts WHERE camera_id = $1`, [cam.id]).catch(() => {});
      }
      continue;
    }

    const rx = lastRx.get(cam.id);
    // ไม่มีข้อมูลใน 10 วัน: ไม่เคยมีแถว = ไม่เคยส่งอะไรเลย ข้าม · มีแถว = เงียบต่อเนื่องมานาน ยังต้องนับ
    if (!rx && !st?.quiet_since) continue;
    // แถวเก่าที่ไม่เคยถูกเก็บกวาด (เช่นช่วงที่กล้องอยู่ใน excluded_cameras ลูปข้ามไป) ใช้ตรง ๆ ไม่ได้
    // ข้อมูลที่เข้ามาหลัง quiet_since เดิม = เงียบรอบใหม่เริ่มที่ rx · เหตุจริง 2026-10-06: แจ้ง
    // hdy-motor-bigc2 "ไม่ส่งข้อมูลมา 18.6 วัน" จากแถว 17 ก.ย. ทั้งที่เพิ่งเงียบ 3 ชม.
    const quietSince = new Date(Math.max(st?.quiet_since ? new Date(st.quiet_since).getTime() : 0,
                                         rx ? new Date(rx).getTime() : 0));
    const quietMs = now - quietSince.getTime();
    if (quietMs < thrOf(cam.id)) continue;

    // เงียบเกิน 24 ชม. เตือนซ้ำวันละครั้ง ไม่ใช่ทุกรอบ cooldown — กล้องที่ตายเป็นสัปดาห์จะกลายเป็นเสียงรบกวน
    const cooldown = quietMs > 86_400_000 ? Math.max(cfg.cooldown_ms, 86_400_000) : cfg.cooldown_ms;
    if (!st || st.notify_count === 0) wentQuiet.push({ cam, quietMs, quietSince });
    else if (now - new Date(st.notified_at).getTime() >= cooldown) {
      stillQuiet.push({ cam, quietMs, count: st.notify_count });
    }
  }

  // แถวของกล้องที่เพิ่งเงียบต้องมีอยู่ไม่ว่า LINE จะส่งได้หรือไม่ — หน้าจออ่านจากตรงนี้
  // notify_count ยังเป็น 0 อยู่ · _quietAnnounce เป็นคนขยับเป็น 1 เมื่อส่ง LINE สำเร็จ
  for (const w of wentQuiet) {
    await pool.query(
      `INSERT INTO camera_quiet_alerts (camera_id, quiet_since, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (camera_id) DO UPDATE SET quiet_since = EXCLUDED.quiet_since, updated_at = NOW()`,
      [w.cam.id, w.quietSince.toISOString()]).catch(e =>
        console.warn('[alert-engine] quiet state upsert:', e.message));
  }

  return { wentQuiet, stillQuiet, cameBack, watchedCount: watched.length };
}

// เก็บกวาดแถวของกล้องที่กลับมาแล้ว เมื่อไม่มีทางที่ _quietAnnounce จะได้ทำงาน
//
// 🔴 กรณีที่ทำให้ป้ายบนหน้าจอค้างถาวร: เปิด LINE ไว้จนมีแถว notify_count > 0 แล้วปิด
// LINE ทีหลัง · ขาลบแถวอยู่ใน _quietAnnounce ซึ่งจะไม่ถูกเรียกอีกเลย ⇒ กล้องกลับมา
// ส่งข้อมูลนานแล้วแต่ป้ายยังนับมันอยู่ · ตรงนี้ยอมทิ้งข้อความ "กลับมาแล้ว" (ซึ่งส่ง
// ไม่ได้อยู่แล้วเพราะ LINE ปิด) เพื่อให้ตัวเลขบนจอตรงกับความจริง
async function _sweepRecovered(cameBack) {
  for (const c of cameBack) {
    await pool.query(`DELETE FROM camera_quiet_alerts WHERE camera_id = $1`, [c.cam.id])
      .catch(() => {});
  }
}

// จำนวนวันย้อนหลังที่ใช้สร้างฐาน · 14 วันกลืนทั้งวันธรรมดาและสุดสัปดาห์ ซึ่งจำเป็น
// เพราะกล้องหน้าออฟฟิศเงียบต่างกันมากระหว่างสองแบบนี้
const BASELINE_DAYS = parseInt(process.env.CAMERA_BASELINE_DAYS || '14', 10);

// 🔴 อย่าเติมขอบของ `event_time` เข้าไปเพื่อ "ตัด partition" — ลองแล้วช้าลง 3.7 เท่า
//
// `events` partition ด้วย **event_time** แต่คิวรีนี้ถามด้วย **received_at** ⇒ EXPLAIN
// บอกว่า seq scan ครบทั้ง 20 partition รวมของอนาคต (y2027m04) ซึ่ง *ดูเหมือน* เป็นบั๊ก
// เติม `event_time > now()-21d AND event_time < now()+1d` แล้วตัดเหลือ 2 partition จริง
// แต่ planner เปลี่ยนไปใช้ **Index Scan** บน y2026m08 ซึ่งดึงแถวเกือบทั้ง partition
// แบบสุ่ม ⇒ วัดจริง 2026-09-12:
//
//     ไม่มีขอบ (seq scan 20 partition) — ทั้งงาน  85.4 วินาที
//     มีขอบ   (index scan 2 partition) — แค่ bins 318   วินาที
//
// partition ของอนาคตว่างเปล่า การ scan มันจึงแทบไม่มีราคา ส่วน partition เดือนปัจจุบัน
// ถือข้อมูลเกือบทั้งหมดอยู่แล้วไม่ว่าจะตัดหรือไม่ตัด · "ตัด partition ได้" ไม่เท่ากับ
// "เร็วขึ้น" เมื่อ partition ที่เหลือคือตัวที่ใหญ่ที่สุดอยู่ดี

/**
 * คำนวณ "นิสัยความเงียบ" ของกล้องทุกตัวใหม่ — รันวันละครั้ง
 *
 * ใช้ถังเวลา 5 นาทีแทนการไล่ทุก event: ละเอียดพอสำหรับเกณฑ์ระดับ 20 นาที และลด
 * ของที่ต้องเรียงจาก 8.1 ล้านแถวเหลือ ~274,000 ถัง (วัดจริง 2026-09-12)
 *
 * ⚠️ ต้องเป็น p99 ไม่ใช่ max — เหตุผลเต็มอยู่ใน migration 225 · สรุป: max ของกล้อง
 * ที่เพิ่งเกิดเหตุ **คือตัวเหตุการณ์นั้นเอง** ⇒ ใช้ max = เหตุการณ์กลายเป็นนิสัยปกติ
 *
 * DELETE ก่อน INSERT ในทรานแซกชันเดียว — กล้องที่ถูกถอดออกไปแล้วต้องไม่เหลือฐานค้าง
 * ไว้ให้ตัวเฝ้าอ่าน (ฐานเก่าของกล้องที่ไม่มีอยู่จริงคือของที่ไม่มีวันหมดอายุเอง)
 */
async function refreshCameraBaselines({ skipIfFresherThanHours = null } = {}) {
  if (!pool) return null;
  // ใช้ตอนบูต: ถ้าฐานยังใหม่อยู่ก็ไม่ต้องคำนวณซ้ำ — ไม่งั้น restart บ่อย ๆ
  // จะลากคิวรีหนักตามไปทุกครั้งโดยไม่ได้อะไรเพิ่ม
  if (skipIfFresherThanHours != null) {
    try {
      const { rows } = await pool.query(
        `SELECT max(computed_at) > now() - ($1 || ' hours')::interval AS fresh
           FROM camera_event_baseline`, [String(skipIfFresherThanHours)]);
      if (rows[0]?.fresh) return 0;
    } catch (e) { console.warn('[alert-engine] baseline freshness:', e.message); return null; }
  }
  const t0 = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '300s'`);
    // 🔴 DELETE ต้องเป็นคำสั่งแยก — เดิมเป็น CTE `wipe AS (DELETE …)` ในคำสั่งเดียวกับ INSERT ซึ่ง
    // Postgres รันพร้อมกันบน snapshot เดียว ⇒ INSERT ชน PK ของแถวที่กำลังลบ ทุกครั้งที่ตารางมีข้อมูล
    // ผ่านได้แค่รอบแรก (ตารางว่าง 12 ก.ย.) แล้วล้มทุกคืนจนฐานค้าง 3 สัปดาห์ (GOTCHAS #217 · repro บน TEMP table)
    // อยู่ใน transaction เดียวกัน ผู้อ่านยังเห็นฐานเก่าจน COMMIT
    // ลบเฉพาะกล้องที่ไม่อยู่ในระบบแล้ว · กล้องที่ไม่มีข้อมูลในหน้าต่างนี้ (ตาย/เงียบนาน) คงฐานเดิมไว้
    // ไม่งั้นกล้องที่ตายเกิน 14 วันหลุดจากการเฝ้าเงียบ ๆ (เหตุ 2026-10-06 · กล้องภูเก็ต 12 ตัว)
    await client.query(`DELETE FROM camera_event_baseline b
                         WHERE NOT EXISTS (SELECT 1 FROM cameras c WHERE c.id = b.camera_id)`);
    const { rowCount } = await client.query(`
      WITH bins AS (
        SELECT DISTINCT camera_id, date_bin('5 minutes', received_at, TIMESTAMPTZ '2026-01-01') AS b
          FROM events WHERE received_at > now() - make_interval(days => $1::int)
      ), gaps AS (
        SELECT camera_id, b,
               extract(epoch from (b - lag(b) OVER (PARTITION BY camera_id ORDER BY b)))/60 AS gap_min
          FROM bins
      ), prof AS (
        SELECT camera_id,
               round(percentile_cont(0.99) WITHIN GROUP (ORDER BY gap_min)::numeric)::int AS p99_min,
               count(*)::int AS samples,
               round(extract(epoch from (max(b) - min(b)))/86400.0, 1) AS days_span
          FROM gaps WHERE gap_min IS NOT NULL GROUP BY camera_id
      )
      INSERT INTO camera_event_baseline (camera_id, p99_min, samples, days_span, computed_at)
      SELECT camera_id, p99_min, samples, days_span, NOW() FROM prof
      ON CONFLICT (camera_id) DO UPDATE
         SET p99_min = EXCLUDED.p99_min, samples = EXCLUDED.samples,
             days_span = EXCLUDED.days_span, computed_at = EXCLUDED.computed_at`, [BASELINE_DAYS]);
    await client.query('COMMIT');
    console.log(`[alert-engine] camera baseline: ${rowCount} กล้อง · ${Date.now() - t0} ms`);
    return rowCount;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[alert-engine] camera baseline error:', e.message);
    return null;
  } finally { client.release(); }
}

// แคช max(received_at) ต่อกล้อง สำหรับ _computeQuietState (ดูหมายเหตุที่นั่น)
const _rx = { last: new Map(), mark: null };
const RX_MARK_OVERLAP = 5000;   // ~10 นาทีของแถวที่เข้ามา — อ่านซ้ำได้ (max ไม่เปลี่ยน) ดีกว่าพลาดแถวที่ commit ช้า

async function checkQuietCameras() {
  if (!pool) return;
  const cfg = _quietAlertSettings(configCache?.quiet_alert);

  const st = await _computeQuietState(cfg);      // ← ทำเสมอ
  if (!st) return;

  // ── จากตรงนี้ลงไปคือการยิง LINE เท่านั้น · ทุกประตูอยู่ที่นี่ ไม่ใช่ข้างบน ──
  // ทุกทางที่ "ไม่ส่ง" ต้องเก็บกวาดแถวของกล้องที่กลับมาก่อนเสมอ ไม่งั้นป้ายค้าง
  if (!cfg.enabled || cfg.recipient_ids.length === 0) return _sweepRecovered(st.cameBack);
  if (!configCache || !configCache.enabled || !configCache.channel_access_token) return _sweepRecovered(st.cameBack);
  const recipients = (configCache.recipients || [])
    .filter(r => r.enabled && cfg.recipient_ids.includes(r.id));
  if (recipients.length === 0) return _sweepRecovered(st.cameBack);

  await _quietAnnounce(recipients, st.wentQuiet, st.stillQuiet, st.cameBack);
}

// ส่ง → บันทึก → ค่อยขยับสถานะ · ลำดับเดียวกับ _edgeAnnounce: push ที่ล้มเหลว
// ห้ามกิน cooldown ไม่งั้นใบที่ส่งไม่ถึงจะทำให้เงียบไปอีก 6 ชั่วโมง
async function _quietAnnounce(recipients, wentQuiet, stillQuiet, cameBack) {
  const token = configCache.channel_access_token;
  const label = (c) => `${c.name || c.id} (${c.id})`;

  const log = async (ruleName, camId, prefix, text, r) => {
    try {
      await pool.query(
        `INSERT INTO alert_logs (rule_id, rule_name, camera_id, triggered_rule, event_time,
                                 status, message_text, recipient_count, sent_at, recipients_json)
         VALUES (NULL, $1, $2, $3, NOW(), 'sent', $4, $5, NOW(), $6)`,
        [ruleName, camId, `${prefix}:${camId}`, text.slice(0, 500), r.okCount,
         JSON.stringify(r.recipientsLog)]);
    } catch (e) { console.warn(`[alert-engine] log ${prefix}:`, e.message); }
  };

  // หลายกล้องเงียบพร้อมกันรวบเป็นใบเดียว — เหตุการณ์ 2026-09-12 คือ 4 กล้องพร้อมกัน
  // ซึ่งการพร้อมกันเองก็เป็นข้อมูล (ชี้ไปที่ NVR/สายร่วม ไม่ใช่กล้องเสีย 4 ตัว)
  if (wentQuiet.length) {
    // ไม่มี emoji — การ์ดสถานะกล้องใช้ป้ายข้อความ (เจ้าของสั่ง 2026-09-15 · CLAUDE.md #2-C)
    const text = wentQuiet.length === 1
      ? `กล้องไม่ส่งข้อมูล: ${label(wentQuiet[0].cam)} — เงียบมา ${_dur(wentQuiet[0].quietMs)}`
      : `กล้องไม่ส่งข้อมูล ${wentQuiet.length} ตัวพร้อมกัน:\n`
        + wentQuiet.map(w => `· ${label(w.cam)} — ${_dur(w.quietMs)}`).join('\n')
        + `\nหลายตัวพร้อมกันมักเป็น NVR หรือสายร่วม ไม่ใช่กล้องเสียหลายตัว`;
    const r = await _pushToAll(token, recipients, [{ type: 'text', text }], 'cam quiet');
    if (r.sent) {
      for (const w of wentQuiet) {
        await pool.query(
          `INSERT INTO camera_quiet_alerts (camera_id, quiet_since, notified_at, notify_count, updated_at)
           VALUES ($1, $2, NOW(), 1, NOW())
           ON CONFLICT (camera_id) DO UPDATE
             SET quiet_since = EXCLUDED.quiet_since, notified_at = NOW(),
                 notify_count = 1, updated_at = NOW()`,
          [w.cam.id, w.quietSince.toISOString()]).catch(e =>
            console.warn('[alert-engine] quiet state:', e.message));
        await log('Camera Quiet', w.cam.id, 'cam_quiet', text, r);
      }
      console.log(`[alert-engine] cam quiet: ${wentQuiet.map(w => w.cam.id).join(',')}`);
    }
  }

  // ยังเงียบอยู่ — รวบเป็นใบเดียว (กล้องที่ตายพร้อมกันหลายตัวจะไม่ท่วมแชท) แต่บอกระยะเวลาแยกรายตัว
  if (stillQuiet.length) {
    const text = stillQuiet.length === 1
      ? `กล้องยังไม่ส่งข้อมูล: ${label(stillQuiet[0].cam)} — เงียบมาแล้ว ${_dur(stillQuiet[0].quietMs)}`
      : `กล้องยังไม่ส่งข้อมูล ${stillQuiet.length} ตัว:\n`
        + stillQuiet.map(s => `· ${label(s.cam)} — เงียบมาแล้ว ${_dur(s.quietMs)}`).join('\n');
    const r = await _pushToAll(token, recipients, [{ type: 'text', text }], 'cam still quiet');
    if (r.sent) {
      for (const s of stillQuiet) {
        await pool.query(
          `UPDATE camera_quiet_alerts SET notified_at = NOW(), notify_count = $2, updated_at = NOW()
            WHERE camera_id = $1`, [s.cam.id, s.count + 1]).catch(() => {});
        await log('Camera Still Quiet', s.cam.id, 'cam_still_quiet', text, r);
      }
    }
  }

  // ขากลับ — ตัวเลขที่คนอยากรู้คือ "ข้อมูลหายไปนานแค่ไหน" เพราะนั่นคือช่วงที่
  // การแจ้งเตือนตามจับรถใช้ไม่ได้ (ของที่คายย้อนหลังถูก stale_skip ตัดทิ้งไปแล้ว)
  if (cameBack.length) {
    const text = cameBack.length === 1
      ? `กล้องกลับมาส่งข้อมูล: ${label(cameBack[0].cam)} — เงียบไปทั้งหมด ${_dur(cameBack[0].downMs)}`
      : `กล้องกลับมาส่งข้อมูล ${cameBack.length} ตัว:\n`
        + cameBack.map(c => `· ${label(c.cam)} — เงียบไป ${_dur(c.downMs)}`).join('\n');
    const r = await _pushToAll(token, recipients, [{ type: 'text', text }], 'cam quiet back');
    if (r.sent) {
      for (const c of cameBack) {
        await pool.query(`DELETE FROM camera_quiet_alerts WHERE camera_id = $1`, [c.cam.id])
          .catch(() => {});
        await log('Camera Quiet Recovered', c.cam.id, 'cam_quiet_back', text, r);
      }
      console.log(`[alert-engine] cam quiet back: ${cameBack.map(c => c.cam.id).join(',')}`);
    }
  }
}

// ทำไมต้องมี: hdy เก็บ snapshot 683 GB หมุนเวียน ~114 GB/วัน โดยมีพื้นที่ว่าง
// เหลือ 190 GB · การลบ 6 วันทำงานถูกต้องอยู่ (ตรวจแล้วไม่มีไฟล์เกิน 6 วันเลย)
// แต่ถ้าวันหนึ่งมันหยุด **มีเวลาไม่ถึง 2 วันก่อนดิสก์เต็ม**
//
// ข้อมูลที่ต้องใช้มีอยู่ครบใน edge_status มานานแล้ว — disk_free_gb และ
// last_prune_json ถูกเขียนทุกรอบ heartbeat · แต่ disk_free_gb ถูกใช้แค่ประกอบ
// ข้อความตอนไซต์เงียบ ส่วน last_prune_json **ไม่มีใครอ่านเลย**
// (รูปแบบเดียวกับ bridge_dropped ที่หายไป 7 สัปดาห์ และ long_running_queries
// ที่อยู่ใน payload มาเป็นเดือนโดยไม่มีหน้าจอไหนเรนเดอร์)
//
// 🔴 เตือนสองเรื่องแยกกัน เพราะมันคนละอาการ:
//   1. พื้นที่ต่ำกว่าเกณฑ์ — อาจเป็นเพราะของเข้ามาเร็วกว่าที่ลบทัน
//   2. การลบไม่รายงานผลมาเกิน 3 ชั่วโมง — ตัวลบตายแล้ว ซึ่งร้ายแรงกว่า
//      เพราะข้อ 1 จะตามมาเองในไม่กี่ชั่วโมง
async function checkEdgeDiskLow() {
  if (!configCache || !configCache.enabled || !configCache.channel_access_token) return;
  const cfg = _edgeAlertSettings(configCache.edge_alert);
  if (!cfg.enabled) return;

  let allRecipients = (configCache.recipients || []).filter(r => r.enabled);
  if (cfg.recipient_ids) allRecipients = allRecipients.filter(r => cfg.recipient_ids.includes(r.id));
  if (allRecipients.length === 0) return;

  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT site_id, disk_free_gb, disk_total_gb, retention_json, last_prune_json, storage_json,
              EXTRACT(epoch FROM now() - updated_at)::int AS heartbeat_age
         FROM edge_status`));
  } catch (e) { console.error('[alert-engine] checkEdgeDiskLow query:', e.message); return; }

  // ไซต์ maintenance/archived เงียบทุกแจ้งเตือน (sites.status · migration 285)
  const quiet = await quietSiteCodes(pool);
  for (const site of rows) {
    if (cfg.disabled_sites.includes(site.site_id) || quiet.has(site.site_id)) continue;
    // ไซต์ที่ heartbeat เงียบอยู่แล้ว ปล่อยให้ checkEdgeStale เตือน — ไม่ยิงซ้ำสองใบ
    if (site.heartbeat_age === null || site.heartbeat_age > 900) continue;

    // 🔴 แก้ 2026-08-31: เดิมบรรทัดนี้ใช้ site.disk_free_gb ซึ่ง bridge.js:361 เก็บมา
    // จาก `df -k /` เสมอ = ดิสก์ระบบ · ไซต์ที่แขวน snapshot ไว้คนละดิสก์ (hkt บน md0)
    // จึงเอาดิสก์ที่ "ไม่มีอะไรเขียนลงไป" มาเทียบกับ min_free_gb ที่ตั้งไว้ 80 GB
    // ดิสก์ระบบ hkt ว่าง 408 GB จะไม่มีวันต่ำกว่าเกณฑ์ → เงื่อนไขพื้นที่ตายสนิท
    // วันที่ดิสก์ภาพเหลือ 10 GB ก็จะไม่มีใครได้รับแจ้งเตือน
    //
    // comment เดิมเขียนว่า "ใช้ค่าเดียวกับที่ตัวลบใช้ตัดสิน" — ซึ่งเป็นเท็จพอดีในเคส
    // เดียวที่มันสำคัญ · ตัวลบ (snapshot-retention.js:137) ใช้ readMount(snapshotDir)
    // ตรงนี้จึงใช้ snapshotMount() ซึ่งเป็นตัวเลือก mount ตัวเดียวกับที่หน้า Storage ใช้
    const snapMnt = snapshotMount(site.storage_json);
    const free = snapMnt ? Number(snapMnt.free_gb)
               : site.disk_free_gb === null ? null : Number(site.disk_free_gb);
    const diskLabel = snapMnt && snapMnt.role === 'media' ? 'ดิสก์ที่เก็บภาพ' : 'ดิสก์ระบบ';
    const minFree = Number(site.retention_json?.min_free_gb) || null;

    const reasons = [];
    if (free !== null && minFree && free < minFree) {
      reasons.push(`${diskLabel}ว่าง ${free.toFixed(1)} GB ต่ำกว่าเกณฑ์ ${minFree} GB`);
    }
    // ดิสก์ระบบเป็นสัญญาณของตัวเอง — เครื่องที่แยกดิสก์ภาพออกไปแล้ว ดิสก์ระบบก็ยังเต็มได้
    // (hdy อยู่ที่ 86.3% วันนี้) และไม่มี min_free_gb ของมันเอง จึงใช้เพดาน 90% ตายตัว
    const sysMnt = systemMount(site.storage_json);
    if (sysMnt && snapMnt && sysMnt.mount !== snapMnt.mount && Number(sysMnt.used_pct) >= 90) {
      reasons.push(`ดิสก์ระบบใช้ไป ${Number(sysMnt.used_pct).toFixed(0)}% (ว่าง ${Number(sysMnt.free_gb).toFixed(1)} GB)`);
    }
    const prunedAt = Number(site.last_prune_json?.at) || 0;
    if (!prunedAt) {
      reasons.push('ไม่เคยมีผลการลบส่งกลับมาเลย');
    } else if (Date.now() - prunedAt > PRUNE_STALE_MS) {
      const hrs = ((Date.now() - prunedAt) / 3600000).toFixed(1);
      reasons.push(`การลบไม่รายงานผลมา ${hrs} ชั่วโมง (ปกติทุก 1 ชั่วโมง)`);
    }
    if (!reasons.length) continue;

    const last = _edgeDiskLastSent.get(site.site_id) || 0;
    if (Date.now() - last < cfg.cooldown_ms) continue;

    const totalGb = snapMnt ? Number(snapMnt.total_gb) : Number(site.disk_total_gb);
    const pct = (free !== null && totalGb)
      ? ` (${(100 - free / totalGb * 100).toFixed(0)}% ของ${diskLabel})` : '';
    const text = `⚠️ Edge [${site.site_id.toUpperCase()}] พื้นที่/การลบมีปัญหา\n`
      + reasons.map(r => `· ${r}`).join('\n')
      + (free !== null ? `\nว่างตอนนี้ ${free.toFixed(1)} GB${pct}` : '');

    const { sent, recipientsLog, okCount } =
      await _pushToAll(configCache.channel_access_token, allRecipients, [{ type: 'text', text }], 'edge disk');
    if (sent) {
      _edgeDiskLastSent.set(site.site_id, Date.now());
      console.log(`[alert-engine] edge disk alert sent: ${site.site_id} — ${reasons.join(' · ')}`);
      try {
        await pool.query(
          `INSERT INTO alert_logs (rule_id, rule_name, camera_id, triggered_rule, event_time,
                                   status, message_text, recipient_count, sent_at, recipients_json)
           VALUES (NULL, 'Edge Disk/Prune', $1, $2, NOW(), 'sent', $3, $4, NOW(), $5)`,
          [site.site_id, `edge_disk:${site.site_id}`, text.slice(0, 500), okCount, JSON.stringify(recipientsLog)]
        );
      } catch (e) { console.warn('[alert-engine] log edge disk:', e.message); }
    }
  }
}


// ── ปุ่มทดสอบของหน้าช่องทาง (2026-08-13) ─────────────────────────────────
// ส่งซ้ำ "เหตุการณ์จริงล่าสุด" ของช่องทางนั้นผ่านเส้นทางเดิมทุกขั้น — template ·
// ตัวแปร · รูปคู่ · หน้าตาการ์ด · ผู้รับ · alert_logs
//
// ข้อความปลอมจะผ่านแค่ครึ่งทางแล้วบอกว่า "ส่งได้" ทั้งที่ของจริงอาจพังตรงรูป
// (เคสจริง: ภาพจากกล้องของ AuraFace ไม่ขึ้นเพราะไฟล์อยู่บน edge ไม่ใช่ central)
//
// ⚠️ เติมคำนำหน้าบอกว่าเป็นการทดสอบเสมอ ไม่ใช่ทางเลือก — ส่งซ้ำการแจ้งเตือน
// บัญชีดำเงียบ ๆ จะทำให้ผู้รับเข้าใจว่าเพิ่งเจอคนคนนั้นอีกครั้งแล้วออกไปตามจับผิดเวลา
// ข้าม cooldown โดยตั้งใจ (คนกดปุ่มคือคนที่อยากได้ผลเดี๋ยวนี้) แต่ยังบันทึกลง
// alert_logs ตามปกติเพื่อให้ตรวจย้อนได้ว่าใบไหนคือการทดสอบ
// extra = ฟิลด์ที่เส้นทางจริงยัดเข้ามาทาง pg_notify แต่ไม่ได้เก็บในตาราง events
// (AuraFace: person_name/rule_name อยู่ใน face_blacklist_hits เท่านั้น — ถ้าไม่ส่งมา
// การ์ดทดสอบจะมี {person_name} ว่าง ซึ่งไม่ใช่การ์ดจริง · ตรวจพบ 2026-08-13)
async function sendTestForRule(db, rule, eventId, extra = null, opts = {}) {
  // 🔴 engine นี้ถูก require ในหลาย process แต่ **init() ถูกเรียกเฉพาะตัวที่กิน event**
  // (ingesters / alert-worker) · api-server แค่ require มาใช้ปุ่มทดสอบ pool ภายใน
  // จึงเป็น null → refreshCache ล้ม → configCache ว่าง → "Internal Error" ที่หน้าจอ
  // (เจ้าของเจอ 2026-08-13 · reproduce ได้: Cannot read properties of null)
  // ผู้เรียกส่ง pool เข้ามาอยู่แล้ว — รับไว้ให้ทั้งไฟล์ใช้ ไม่ต้องบังคับให้ init()
  // ทั้งเครื่องยนต์ (ซึ่งจะเปิด LISTEN + timer ซ้ำใน api-server และยิงซ้ำกันเอง)
  if (!pool && db) pool = db;
  if (!configCache) await refreshCache();
  const { rows } = await pool.query(
    `SELECT e.id AS event_id, e.camera_id, e.event_time, e.rule_name, e.event_type,
            e.object_class, e.likelihood, e.snapshot_filename, e.raw_json,
            c.name AS camera_name, c.location_label AS location
       FROM events e LEFT JOIN cameras c ON c.id = e.camera_id
      WHERE e.id = $1`, [eventId]);
  const event = rows[0];
  if (!event) throw new Error('ไม่พบเหตุการณ์ที่จะใช้ทดสอบ');
  if (extra) Object.assign(event, extra);

  if (FACE_VARS_RE.test(rule.message_template || '') || _isFaceMatch(rule, event))
      await enrichFaceFields(event, ROSTER_VARS_RE.test(rule.message_template || ''));

  // ── ปุ่ม "ส่งเข้า Telegram · ระบุเอง" — ข้ามขา LINE ทั้งก้อนด้านล่าง ต้องเช็ค
  // ก่อนถึงบล็อกคัดผู้รับ LINE เสมอ ไม่งั้นกฎที่ไม่มี recipient_ids LINE เลย (มีแต่
  // telegram_chat_ids) จะ throw ที่บล็อก LINE ทั้งที่ผู้เรียกไม่ได้ขอส่ง LINE เลย
  if (opts.manualChannel === 'telegram') {
    const overrideChatIds = Array.isArray(opts.telegramChatIds) && opts.telegramChatIds.length
      ? opts.telegramChatIds.map(String) : null;
    const wantChatIds = overrideChatIds || (rule.telegram_chat_ids || []).map(String);
    // 🔴 telegramCache มาจาก refreshCache() ซึ่งอ่าน telegram_config **เฉพาะเมื่อมีกฎ
    // ตั้ง deliver_via เป็น telegram/both/line_then_telegram อยู่แล้ว** (ดูคอมเมนต์
    // T2b ด้านบน) — กฎ HCP Face/AuraFace ปกติยังเป็น 'line' (ค่าเริ่มต้น) ⇒ cache
    // ว่างเปล่าตลอดแม้ telegram_config จะตั้งแชทไว้จริง ปุ่มส่งด้วยมือจะรายงาน
    // "แชทที่เลือกใช้ไม่ได้" ผิด ๆ ทุกครั้ง ต้องอ่านสดจาก DB แทน ไม่ใช่พึ่ง cache
    let allChats = [];
    try {
      const { rows: tgRows } = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
      allChats = Array.isArray(tgRows[0]?.chats) ? tgRows[0].chats : [];
    } catch (e) { console.warn('[alert-engine] อ่านแชท Telegram ไม่สำเร็จ:', e.message); }
    const chats = allChats.filter(c => c && c.enabled !== false && wantChatIds.includes(String(c.chat_id)));
    if (!chats.length) {
      throw new Error(overrideChatIds
        ? 'แชทที่เลือกใช้ไม่ได้ (ไม่รู้จัก หรือถูกปิดอยู่)'
        : 'ช่องทางนี้ยังไม่ได้เลือกแชท Telegram');
    }
    const label = `📣 ส่งด้วยตนเองโดย ${opts.manualBy || 'ไม่ทราบชื่อ'}`;
    const startMs = Date.now();
    const tgResults = await _sendTelegramForRule(rule, event, chats, { label });
    const okCount = tgResults.filter(r => r.ok).length;
    const err = tgResults.find(r => !r.ok && r.error)?.error || null;
    await logAttempt(rule, event, okCount > 0 ? 'sent_manual' : 'failed', err,
      chats.length, Date.now() - startMs, '', null,
      tgResults.length ? JSON.stringify(tgResults) : null);
    return { sent: okCount > 0, recipients: chats.length, sent_count: okCount, error: err };
  }

  // ผู้รับเฉพาะครั้งนี้ (ปุ่มทดสอบ / ส่งเอง) — ทดสอบการ์ดโดยไม่ต้องรบกวนทีมจริง
  //
  // 🔒 กรองจาก configCache เสมอ ไม่ใช่เชื่อ id ที่ส่งมา · ที่นี่คือด่านสุดท้ายก่อน
  // ยิงเข้า LINE จริง ต่อให้ route ตรวจมาแล้วก็ตรวจซ้ำ — ผู้เรียกมีหลายทางและ
  // เพิ่มได้อีก การปล่อยให้ id อะไรก็ได้ผ่านมาถึงตรงนี้แปลว่าใครยิง LINE หาใครก็ได้
  const override = Array.isArray(opts.recipientIds) && opts.recipientIds.length
    ? opts.recipientIds.map(String) : null;
  const targetIds = override || rule.recipient_ids || [];
  const recipients = (configCache.recipients || []).filter(r => r.enabled && targetIds.includes(r.id));
  if (!recipients.length) {
    throw new Error(override
      ? 'ผู้รับที่เลือกใช้ไม่ได้ (ไม่รู้จัก หรือถูกปิดอยู่)'
      : 'ยังไม่ได้เลือกผู้รับ (หรือผู้รับที่เลือกไว้ถูกปิดอยู่)');
  }

  // ป้ายกำกับต้นข้อความ — ผู้รับต้องแยกออกทันทีว่านี่ไม่ใช่ระบบตรวจพบเอง
  //   manualBy = เจ้าหน้าที่กดส่งเองจากหน้าจอ (เหตุการณ์จริง แต่คนสั่ง)
  //   ไม่ระบุ  = ปุ่มทดสอบระบบ (ไม่ใช่เหตุการณ์ใหม่)
  // ใช้คำเดียวกับฝั่ง LPR (helpers/lprLineAlert) เพื่อให้ผู้รับเห็นรูปแบบเดียวกัน
  const prefix = opts.manualBy
    ? `📣 [ส่งด้วยตนเองโดย ${opts.manualBy}]\n`
    : `🧪 [ทดสอบระบบ — ไม่ใช่เหตุการณ์ใหม่]\n`;
  const testRule = {
    ...rule,
    message_template: prefix
      + (rule.message_template || '🚨 {camera}\n📋 {rule}\n📍 {location}\n⏰ {time}'),
  };
  const startMs = Date.now();
  const result = await _sender.sendAlert({
    rule: testRule, event, recipients,
    token: configCache.channel_access_token,
    imgbbKey: configCache.imgbb_api_key,
    signedTtlSec, allowImgbb,
    pool,
    imgbbExpireSec: configCache.imgbb_expire_sec,
  });
  // ⚠️ sendAlert คืน { success, sentCount, ... } — **ไม่มี field `ok`**
  // เขียน result?.ok จึงเป็น undefined เสมอ = ทดสอบสำเร็จก็รายงานว่าล้มเหลว
  // และเขียนแถว 'failed' ทิ้งไว้ทั้งที่ส่งออกไปแล้ว (เจอตอน reproduce 2026-08-13)
  const okCount = result?.sentCount || 0;
  await logAttempt(testRule, event, okCount > 0 ? (opts.manualBy ? 'sent_manual' : 'sent') : 'failed', result?.error || null,
    recipients.length, Date.now() - startMs, '', result?.imageSource || null,
    result?.recipientsLog ? JSON.stringify(result.recipientsLog) : null);
  return { sent: okCount > 0, recipients: recipients.length, sent_count: okCount, error: result?.error || null };
}

module.exports = {
  init,
  shutdown,
  onEvent,
  invalidateCache,
  checkDwellRules,
  checkEdgeStale,
  checkEdgeDiskLow,
  checkEdgeDataLoss,
  checkQuietCameras,
  refreshCameraBaselines,
  _quietAlertSettings,
  _quietThresholdMs,   // ฟังก์ชันบริสุทธิ์ — เทสต์เรียกตรงได้ ไม่ต้องมี DB
  _pushToAll,      // helpers/helmetMetricCheck.js ใช้ส่ง LINE ผ่านทางเดียวกับที่นี่
                   // (สำคัญเพราะมันอ่าน result.success ให้ — line-sender ไม่เคย throw)
  _lossDecision,   // export เพื่อให้เทสต์เรียกตรงได้ ไม่ต้องมี DB/LINE
  _testInit,       // seam ฉีด pool/sender/config (เทสต์ state machine ของ edge)
  sendTestForRule,
  // exported for unit tests (pure functions — no DB/network deps)
  matchRule,
  isInCooldown,
  belowMinLikelihood,
  _edgeAlertSettings,
  FACE_MATCH_RULES,   // เทสต์ตรึงไว้ว่า 'Face Capture' ต้องไม่หลุดเข้ามา
  _isFaceMatch,
  _telegramLegFor,     // T2b — เทสต์ deliver_via/telegram_chat_ids → usesLine/usesTelegram/chats
  _suppressedLog,      // T2b — pure function ตรวจรูปร่าง log ของการระงับ (สองช่องทาง)
  _sendTelegramFallback, // T3 — เทสต์ fallback หลัง LINE โดนโควตาเต็ม
};

// ── self-check: node src/alert-engine.js ────────────────────
// เฉพาะฟังก์ชันบริสุทธิ์ ไม่แตะ DB/เครือข่าย — รันได้โดยไม่ต้องมี postgres
if (require.main === module) {
  const assert = require('assert');
  const ev = { camera_id: 'C1', rule_name: 'Face Recognition Match', list_type: 'blackList' };

  // กติกาเดิม "ว่าง = ทุกอย่าง" ของกฎที่ผู้ใช้เขียน ต้องไม่เปลี่ยน
  assert.strictEqual(matchRule({}, ev), true, 'กฎว่างเปล่ายังตรงกับทุกอย่างเหมือนเดิม');
  assert.strictEqual(matchRule({ camera_ids: ['C1'] }, ev), true);
  assert.strictEqual(matchRule({ camera_ids: ['C9'] }, ev), false);
  assert.strictEqual(matchRule({ rule_names: ['Face Recognition Match'] }, ev), true);
  assert.strictEqual(matchRule({ rule_names: ['อื่น'] }, ev), false);
  assert.strictEqual(matchRule({ list_types: ['whiteList'] }, ev), false);

  // ── ด่านช่องทาง (incident 2026-08-13) ────────────────────
  // แถวค่าตั้งที่ยังไม่ผูกชนิดเหตุการณ์ ต้องไม่กลืนทุก event
  assert.strictEqual(matchRule({ channel: 'lpr', rule_names: [] }, ev), false, 'channel + rule_names ว่าง = ห้าม match');
  assert.strictEqual(matchRule({ channel: 'lpr' }, ev), false, 'rule_names undefined ก็ต้องไม่ match');
  assert.strictEqual(matchRule({ channel: 'lpr', rule_names: null }, ev), false);
  // ช่องทางที่ผูกชนิดเหตุการณ์ไว้แล้วต้องทำงานปกติ
  assert.strictEqual(matchRule({ channel: 'hcp_face', rule_names: ['Face Recognition Match'] }, ev), true);
  assert.strictEqual(matchRule({ channel: 'hcp_face', rule_names: ['อื่น'] }, ev), false);
  // กฎธรรมดา (channel = null) ที่ rule_names ว่าง ยังต้องตรงกับทุกอย่างเหมือนเดิม
  assert.strictEqual(matchRule({ channel: null, rule_names: [] }, ev), true, 'กฎทั่วไปไม่โดนด่านนี้');

  // ── likelihood / cooldown ────────────────────────────────
  // min_likelihood เป็น % · events.likelihood เป็น 0-1 → ต้องแปลงก่อนเทียบ
  // (บั๊กเดิม: 0.95 < 60 เป็นจริง = บล็อกทุก event ทั้งที่มั่นใจ 95%)
  assert.strictEqual(belowMinLikelihood({ min_likelihood: 60 }, { likelihood: 0.95 }), false, '95% ต้องผ่านเกณฑ์ 60%');
  assert.strictEqual(belowMinLikelihood({ min_likelihood: 60 }, { likelihood: 0.40 }), true, '40% ต้องไม่ผ่านเกณฑ์ 60%');
  assert.strictEqual(belowMinLikelihood({ min_likelihood: 60 }, { likelihood: 1 }), false, '1.0 = 100% ไม่ใช่ 1%');
  assert.strictEqual(belowMinLikelihood({ min_likelihood: 60 }, { likelihood: 0.6 }), false, 'เท่าเกณฑ์พอดี = ผ่าน');
  // ค่าที่มาเป็น % อยู่แล้ว (เผื่อผู้ผลิตรายใหม่) ต้องไม่ถูกคูณซ้ำ
  assert.strictEqual(belowMinLikelihood({ min_likelihood: 60 }, { likelihood: 95 }), false);
  assert.strictEqual(belowMinLikelihood({ min_likelihood: 60 }, { likelihood: 40 }), true);
  // ไม่ได้ตั้งเกณฑ์ = ไม่กรอง แม้ความเชื่อมั่นจะต่ำ
  assert.strictEqual(belowMinLikelihood({}, { likelihood: 0.01 }), false);
  // event ที่ไม่มีค่าความเชื่อมั่น (Hikvision/Dahua) ต้องผ่านเสมอ
  assert.strictEqual(belowMinLikelihood({ min_likelihood: 50 }, {}), false);
  assert.strictEqual(belowMinLikelihood({ min_likelihood: 50 }, { likelihood: null }), false);
  assert.strictEqual(belowMinLikelihood({ min_likelihood: 50 }, { likelihood: '' }), false);
  assert.strictEqual(isInCooldown({}), false, 'ยังไม่เคยยิง = ไม่ติด cooldown');

  console.log('alert-engine self-check: all assertions passed');
}
