// ============================================================
// Vigil Platform — รันคำสั่งที่มาจาก LINE แล้วคืน "การ์ดคำตอบ"
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ตัวกลางระหว่าง webhook (ฝั่งรับข้อความ) กับ line-sender (ฝั่งส่งการ์ด) —
// **ไม่ยิง LINE เอง** คืนโครงการ์ดกลับไปให้ผู้เรียกส่ง เพื่อให้ทดสอบทั้งเส้นทางได้
// โดยไม่ต้องมี LINE จริง (แพตเทิร์นเดียวกับ dryRun ของ lprLineAlert.js)
//
// ลำดับที่ยึด: ใครสั่ง → สั่งที่ไหนได้ไหม → ถี่เกินไปไหม → คำสั่งไหน → ยิงในนามเขา
// ทุกทางออกลง line_command_log เสมอ รวมทั้งทางที่ปฏิเสธ — "เงียบ" ต่อผู้ใช้
// ไม่ได้แปลว่าเงียบต่อปูม
// ============================================================
'use strict';

const { matchCommand, suggest } = require('./lineCommandMatch');
const { matchObjectClass } = require('./eventObjectClass');
const env = require('../config');
const { createTtlCache } = require('./ttlCache');

// คำตอบของคำสั่งเดียวกัน ช่วงเวลาเดียวกัน ขอบเขตเดียวกัน = ข้อมูลชุดเดียวกัน
// คำสั่งที่ดึงข้อมูลหนักใช้ 2-5 วินาที และในกลุ่มมักถามซ้ำ ๆ ต่อกัน (คนละคนถามเรื่องเดียวกัน)
// 60 วินาทีสั้นพอที่ตัวเลขยังสด และยาวพอให้คำถามซ้ำในบทสนทนาเดียวกันได้คำตอบทันที
// ⚠️ คีย์ต้องมี **รายชื่อกล้องที่ใช้จริง** ไม่ใช่แค่ชื่อไซต์ — สองบัญชีถามไซต์เดียวกัน
// แต่เห็นกล้องคนละชุด ต้องได้คนละคำตอบ (บทเรียนเดียวกับ GOTCHAS #190/#192)
const _answerCache = createTtlCache({ name: 'line:answer', ttlMs: 60_000, max: 64 });
const { getSource, defaultPeriod } = require('../line-answer-sources');
const { getAction } = require('../line-actions');
const { sitesForUser, matchSite, camerasOfSite, siteLabel,
        camerasForUser, matchCamera, allCameras,
        categoriesOfSite, matchCategory } = require('./lineCommandSites');
const { parseThaiPeriod, thaiDigits } = require('./thaiPeriod');

const RUN_TIMEOUT_MS = 12000;   // ยาวกว่านี้ reply token ก็หมดอายุพอดี (LINE ให้ 60 วิ)
const SLOW_MS = 3000;
// คำถามที่ค้างเกินนี้ถือว่าคนละบทสนทนา — คนในกลุ่มคุยเรื่องอื่นคั่นตลอด ถ้าเก็บนานกว่านี้
// ประโยคที่ไม่เกี่ยวจะถูกตีความเป็นคำตอบของคำถามเมื่อสิบนาทีที่แล้ว
const ASK_TTL_SEC = 120;

/**
 * ตัดคำเรียกคำสั่งออกจากประโยค — เหลือแต่ "สิ่งที่ผู้ใช้อยากได้"
 * ตัดคำที่ยาวที่สุดก่อน ("ค้นหาอัจฉริยะ" ต้องถูกตัดก่อน "ค้นหา" ไม่งั้นเหลือคำว่า "อัจฉริยะ"
 * ค้างอยู่ในประโยคแล้วถูกส่งไปให้เครื่องค้นด้วย)
 */
function _stripTriggers(text, triggers) {
  let out = String(text || '');
  const list = (Array.isArray(triggers) ? triggers : [])
    .map(String).sort((a, b) => b.length - a.length);
  for (const t of list) {
    if (!t) continue;
    const i = out.toLowerCase().indexOf(t.toLowerCase());
    if (i >= 0) out = out.slice(0, i) + ' ' + out.slice(i + t.length);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** อ่านคำสั่งที่เปิดอยู่ + รายชื่อไซต์ (ไว้ให้ slot `site` ใช้) */
async function loadCommands(pool) {
  const [cmds, sites] = await Promise.all([
    pool.query(`SELECT id, key, label, enabled, source_key, triggers, require_all, exclude,
                       fixed_params, slots, required_slots, reply_title, min_role, cooldown_sec,
                       action_key, example, telegram_enabled
                  FROM line_commands WHERE enabled ORDER BY id`),
    pool.query('SELECT code, name, name_th FROM sites'),
  ]);
  // ส่งทั้งชื่อไทยและอังกฤษให้ตัวจับ — matchSite() อ่านทั้งสองช่อง
  const siteList = sites.rows.map((s) => ({ code: s.code, name: s.name, name_th: s.name_th }));
  return cmds.rows.map((c) => ({ ...c, _sites: siteList }));
}

/** ผู้สั่งคนนี้เป็นใครในระบบ — null = ไม่ใช่ผู้มีสิทธิ์ */
async function loadOperator(pool, lineUserId) {
  if (!lineUserId) return null;
  const { rows } = await pool.query(
    `SELECT o.line_user_id, o.display_name, o.enabled, o.allow_in, o.user_id,
            u.username, u.role, u.enabled AS user_enabled
       FROM line_operators o LEFT JOIN users u ON u.id = o.user_id
      WHERE o.line_user_id = $1`, [lineUserId]);
  const op = rows[0];
  if (!op || !op.enabled) return null;
  // ผูกกับบัญชีที่ถูกลบ/ปิดไปแล้ว = ใช้ไม่ได้ ไม่ใช่กลายเป็นไม่จำกัดสิทธิ์
  if (!op.user_id || op.user_enabled === false) return null;
  return op;
}

/** ผู้สั่งคนนี้เป็นใครในระบบ — ผูกผ่าน Telegram (telegram_user_id) แทน LINE user id
 *  (T4) — เงื่อนไขเดียวกับ loadOperator() ทุกประการ แค่คีย์ค้นต่างกัน */
async function loadOperatorByTelegramId(pool, telegramUserId) {
  if (!telegramUserId) return null;
  const { rows } = await pool.query(
    `SELECT o.line_user_id, o.display_name, o.enabled, o.allow_in, o.telegram_allow_in, o.user_id,
            u.username, u.role, u.enabled AS user_enabled
       FROM line_operators o LEFT JOIN users u ON u.id = o.user_id
      WHERE o.telegram_user_id = $1`, [telegramUserId]);
  const op = rows[0];
  if (!op || !op.enabled) return null;
  if (!op.user_id || op.user_enabled === false) return null;
  return op;
}

/** สั่งจากห้องนี้ได้ไหม (allow_in = NULL คือได้ทุกห้อง)
 *  ห้อง Telegram (sourceId ขึ้นต้น "tg:") ใช้ `telegram_allow_in` แทน `allow_in` เสมอ —
 *  คนละรายการห้องกับฝั่ง LINE โดยตั้งใจ (migration 244) เพราะผู้สั่งคนเดียวกันอาจได้รับ
 *  อนุญาตห้อง LINE ชุดหนึ่งกับห้อง Telegram อีกชุดหนึ่งที่ไม่ใช่รายการเดียวกัน */
function allowedHere(op, sourceId) {
  const list = String(sourceId).startsWith('tg:') ? op.telegram_allow_in : op.allow_in;
  if (!Array.isArray(list) || !list.length) return true;
  return list.map(String).includes(String(sourceId));
}

/** ถี่เกินที่ตั้งไว้ไหม — นับจากปูม ไม่ต้องมีตารางเพิ่ม */
async function tooSoon(pool, lineUserId, cmdKey, cooldownSec) {
  if (!cooldownSec) return false;
  // นับ **เฉพาะคำสั่งเดียวกัน** — cooldown มีไว้กันคนถามซ้ำคำถามเดิมรัว ๆ
  // ไม่ใช่ห้ามถามคนละเรื่องต่อกัน (เจอตอนทดสอบ 2026-09-08: ถามยอดแล้วถามอันดับ
  // ต่อทันที โดนบล็อกทั้งที่เป็นคนละคำถาม)
  const { rows } = await pool.query(
    `SELECT 1 FROM line_command_log
      WHERE line_user_id = $1 AND matched_key = $2 AND status = 'ok'
        AND at > NOW() - ($3 || ' seconds')::interval
      LIMIT 1`, [lineUserId, cmdKey, String(cooldownSec)]);
  return !!rows[0];
}

async function loadPendingAsk(pool, lineUserId, sourceId) {
  const { rows } = await pool.query(
    `SELECT command_key, slots, need, options FROM line_pending_asks
      WHERE line_user_id = $1 AND source_id = $2
        AND asked_at > NOW() - ($3 || ' seconds')::interval`,
    [lineUserId, sourceId, String(ASK_TTL_SEC)]);
  return rows[0] || null;
}

async function savePendingAsk(pool, lineUserId, sourceId, ask) {
  await pool.query(
    `INSERT INTO line_pending_asks (line_user_id, source_id, command_key, slots, need, options, asked_at)
     VALUES ($1,$2,$3,$4,$5,$6, NOW())
     ON CONFLICT (line_user_id, source_id) DO UPDATE SET
       command_key = EXCLUDED.command_key, slots = EXCLUDED.slots,
       need = EXCLUDED.need, options = EXCLUDED.options, asked_at = NOW()`,
    [lineUserId, sourceId, ask.command_key, JSON.stringify(ask.slots || {}),
     ask.need, JSON.stringify(ask.options || [])]);
}

async function clearPendingAsk(pool, lineUserId, sourceId) {
  await pool.query('DELETE FROM line_pending_asks WHERE line_user_id = $1 AND source_id = $2',
    [lineUserId, sourceId]).catch(() => {});
}

/**
 * รายการคำสั่งทั้งหมด พร้อม **ตัวอย่างที่พิมพ์ตามได้จริง**
 *
 * เจ้าของขอ 2026-09-09: รายชื่อเปล่า ๆ 21 บรรทัดไม่ได้บอกว่า "พิมพ์ยังไง" — คนอ่านแล้ว
 * ยังต้องเดารูปประโยคอยู่ดี ซึ่งเป็นสาเหตุเดียวกับที่ประโยคจริงหลายอันตกไปก่อนหน้านี้
 * ⇒ ตัวอย่างเก็บใน `line_commands.example` (แอดมินแก้ได้ในหน้าตั้งค่า) ไม่ฝังในโค้ด
 */
function helpText(commands) {
  if (!commands.length) return 'ยังไม่มีคำสั่งที่เปิดใช้งาน';
  const line = (c) => `• ${c.label}` + (c.example ? `\n   ${c.example}` : '');
  const ask = commands.filter((c) => !c.action_key);
  const act = commands.filter((c) => c.action_key);
  return [
    'สั่งได้ดังนี้ — พิมพ์เป็นประโยคปกติได้เลย',
    ask.length ? '\n[ ถามข้อมูล ]' : null,
    ...ask.map(line),
    act.length ? '\n[ สั่งให้ทำ ]' : null,
    ...act.map(line),
    '\n[ เติมท้ายประโยคได้ ]',
    'เวลา: ชั่วโมงที่แล้ว · วันนี้ · เมื่อวาน · 7 วัน · เมื่อวาน 18:00-19:00 · ตีหนึ่ง · บ่ายสองโมง · ก่อนเที่ยง',
    'ขอบเขต: ชื่อไซต์ (ภูเก็ต · หาดใหญ่) หรือกล้อง (กล้อง C20 · กล้องฉัตรไชย ทั้งหมด)',
    'พิมพ์ไม่ตรง บอทจะเสนอคำสั่งที่ใกล้เคียงให้เลือก',
  ].filter(Boolean).join('\n');
}

/** ข้อความถาม + ตัวเลือกที่พิมพ์เลขตอบได้ */
function askText(need, options) {
  const head = need === 'site' ? 'ไซต์ไหน'
    : need === 'period' ? 'ช่วงเวลาไหน'
      : need === 'camera' ? 'กล้องไหน'
        : 'ต้องการอันไหน';
  return [head, ...options.map((o, i) => `${i + 1}. ${o.label}`)].join('\n');
}

/** ตีความข้อความว่าเป็นคำตอบของคำถามที่ค้างอยู่หรือไม่ — null = ไม่ใช่คำตอบ */
function readAnswer(text, ask, now) {
  const t = String(text || '').trim();
  const opts = Array.isArray(ask.options) ? ask.options : [];
  const n = /^\d+$/.test(t) ? parseInt(t, 10) : null;
  if (n && n >= 1 && n <= opts.length) {
    const v = opts[n - 1].value;
    // ตัวเลือกช่วงเวลาถูกเก็บเป็นข้อความ ("ชั่วโมงที่แล้ว") เพราะ Date ผ่าน JSON ไม่ได้
    // ⇒ ตอบเป็นเลขก็ต้องแปลงกลับเป็นก้อนช่วงเวลา **ณ ตอนตอบ** ไม่ใช่ตอนถาม
    return ask.need === 'period' ? parseThaiPeriod(String(v), now) : v;
  }
  if (ask.need === 'site') {
    const hit = matchSite(t, opts.map((o) => ({ code: o.value, name: o.name || o.label, name_th: o.name_th })));
    return hit ? hit.code : null;
  }
  if (ask.need === 'confirm') {
    // ยืนยันต้องชัดเจน — เงียบหรือพิมพ์อย่างอื่น = ไม่ส่ง (ของที่ส่งออกไปเรียกคืนไม่ได้)
    if (/^(ใช่|ยืนยัน|ส่ง|ok|yes|y)$/i.test(t)) return 'yes';
    if (/^(ไม่|ยกเลิก|no|n)$/i.test(t)) return 'no';
    return null;
  }
  if (ask.need === 'camera') {
    // ตอบว่า "ทั้งหมด" = เอาทุกตัวที่เพิ่งเสนอไป (ตัวเลือกถูกเก็บไว้ในคำถามค้างแล้ว)
    if (/^(ทั้งหมด|ทุกตัว|all)$/i.test(t)) {
      return { _cameraIds: opts.map((o) => o.value).filter(Boolean) };
    }
    // ตอบเป็นชื่อกล้องได้ ไม่ต้องเลือกจากรายการ (ตอนถามแบบไม่มีตัวเลือกก็ยังตอบได้)
    // ฟังก์ชันนี้ตั้งใจให้บริสุทธิ์ ไม่แตะ DB ⇒ คืนข้อความดิบให้ผู้เรียกไปหากล้องต่อ
    return t ? { _cameraText: t } : null;
  }
  if (ask.need === 'period') {
    const p = parseThaiPeriod(t, now);
    return p || null;
  }
  if (String(ask.need).startsWith('slot:')) {
    const key = String(ask.need).slice(5);
    if (!t) return null;
    // รหัสวัตถุต้องเป็นตัวเลขล้วน — พิมพ์อย่างอื่นมาคือไม่ได้ตอบคำถาม ไม่ใช่ตอบผิด
    if (key === 'object_id') return /^\d{3,12}$/.test(thaiDigits(t)) ? thaiDigits(t) : null;
    if (key === 'object_class') return matchObjectClass(t);   // ตอบเป็นคำไทย เก็บเป็นรหัส
    return t;
  }
  if (ask.need === 'choice') {
    return opts.find((o) => String(o.label).toLowerCase() === t.toLowerCase())?.value || null;
  }
  return null;
}

async function logRun(pool, row) {
  await pool.query(
    `INSERT INTO line_command_log
       (line_user_id, operator_name, source_type, source_id, text_in, matched_key,
        match_score, slots, status, http_status, rows_out, ms, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [row.line_user_id || null, row.operator_name || null, row.source_type || null,
     row.source_id || null, String(row.text_in || '').slice(0, 500), row.matched_key || null,
     row.match_score ?? null, row.slots ? JSON.stringify(row.slots) : null, row.status,
     row.http_status ?? null, row.rows_out ?? null, row.ms ?? null,
     row.error ? String(row.error).slice(0, 500) : null]
  ).catch((e) => console.warn('[line-cmd] เขียนปูมไม่สำเร็จ:', e.message));
}

/** ยิง endpoint ผ่าน loopback ในนามผู้ใช้จริง */
async function fetchAsUser(deps, userId, path, query, opts = {}) {
  const { auth, baseUrl } = deps;
  const s = await auth.createEphemeralSession(userId, { ttlSec: 60 });
  try {
    const qs = new URLSearchParams(
      Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    const init = {
      method: opts.method || 'GET',
      headers: { Authorization: `Bearer ${s.token}` },
      // แหล่งที่ทำงานสองจังหวะ (ค้นหาอัจฉริยะ ~23 วิ) ตั้งเวลาของตัวเองได้
      // เพดานยังต่ำกว่า reply token ของ LINE (60 วิ) และมีทาง push สำรองถ้าเลย
      signal: AbortSignal.timeout(Math.min(opts.timeoutMs || RUN_TIMEOUT_MS, 50000)),
    };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(`${baseUrl}${path}${qs ? `?${qs}` : ''}`, init);
    const body = res.ok ? await res.json().catch(() => null) : null;
    // บาง endpoint ตอบ "จำนวนทั้งหมด" มาทาง header ไม่ใช่ใน body (เพราะการนับแพงกว่า
    // การดึงแถว และมีเพดานของตัวเอง) — ผู้เรียกต้องเห็นด้วย ไม่งั้นต้องไปนับเองซ้ำ
    const total = res.headers.get('x-total-count');
    return { ok: res.ok, status: res.status, body,
             total: total == null ? null : Number(total),
             totalCapped: res.headers.get('x-total-capped') === '1' };
  } finally {
    await auth.dropEphemeralSession(s.sessionId);
  }
}

/**
 * ประมวลผลข้อความหนึ่งข้อความ
 * @returns {{action:'ignore'|'reply', card?, text?, status:string}}
 *   action 'ignore' = ไม่ตอบอะไรกลับไปเลย (คนนอก / ไม่ใช่คำสั่งของเรา)
 */
async function handleLineText(deps, { text, lineUserId, sourceType, sourceId, now = new Date(),
                                     op: opInjected = null }) {
  const { pool } = deps;
  const t0 = Date.now();
  const base = { line_user_id: lineUserId, source_type: sourceType, source_id: sourceId, text_in: text };

  // `op` ฉีดเข้ามาได้สำหรับปุ่ม "ทดลองสั่ง" ในหน้าตั้งค่า — จะได้ไม่ต้องสร้างแถวผู้สั่ง
  // จริงค้างไว้ในตาราง · เส้นทางที่เหลือเหมือนของจริงทุกบรรทัด รวมทั้งสิทธิ์ของบัญชี
  const op = opInjected || await loadOperator(pool, lineUserId);
  if (!op) {
    // เงียบต่อผู้ใช้โดยตั้งใจ: ตอบว่า "ไม่มีสิทธิ์" คือการบอกใบ้ว่าระบบนี้มีอยู่
    // และห้องแชทกลุ่มมีคนพิมพ์คุยกันตลอด การตอบทุกข้อความคือการก่อกวน
    await logRun(pool, { ...base, status: 'denied', ms: Date.now() - t0 });
    return { action: 'ignore', status: 'denied' };
  }
  base.operator_name = op.display_name || op.username;

  if (!allowedHere(op, sourceId)) {
    await logRun(pool, { ...base, status: 'denied', error: 'ห้องนี้ไม่อยู่ในรายการที่อนุญาต', ms: Date.now() - t0 });
    return { action: 'ignore', status: 'denied' };
  }

  // Telegram: คำสั่งที่ telegram_enabled=false "ไม่มีตัวตน" เลยบนช่องทางนี้ — ไม่จับคำเรียก
  // ไม่ขึ้นใน help ไม่ใช่ตัวเลือกให้ตอบคำถามค้าง (migration 244) · LINE ไม่ถูกกรองอะไรเพิ่ม
  const commands = (await loadCommands(pool))
    .filter((c) => sourceType !== 'telegram' || c.telegram_enabled !== false);

  // ── มีคำถามค้างอยู่ไหม ────────────────────────────────────
  // ต้องเช็คก่อนจับคำสั่ง เพราะคำตอบอย่าง "ภูเก็ต" หรือ "1" ไม่ใช่คำสั่งในตัวมันเอง
  // ตอบไม่ตรงคำถาม = ทิ้งคำถามค้างแล้วถือว่าเป็นคำสั่งใหม่ — บอทต้องไม่ยึดบทสนทนา
  const pending = await loadPendingAsk(pool, lineUserId, sourceId);
  if (pending) {
    let ans = readAnswer(text, pending, now);
    // คำตอบเรื่องกล้องต้องเอาไปหาในรายชื่อกล้องที่บัญชีนั้นดูได้ก่อน
    if (ans && ans._cameraText) {
      const cams = await camerasForUser(pool, deps.auth, { id: op.user_id, role: op.role });
      const hit = matchCamera(ans._cameraText, cams);
      if (hit && hit.exact) ans = hit.exact.id;
      else if (hit && hit.many) {
        // ยังกำกวมอยู่ = ถามซ้ำพร้อมตัวเลือก ไม่ใช่ทิ้งบทสนทนา
        const options = hit.many.map((c) => ({ label: c.name, value: c.id }));
        await savePendingAsk(pool, lineUserId, sourceId,
          { command_key: pending.command_key, slots: pending.slots, need: 'camera', options });
        await logRun(pool, { ...base, matched_key: pending.command_key, status: 'ask_camera',
                             ms: Date.now() - t0 });
        return { action: 'reply', status: 'ask_camera', text: askText('camera', options) };
      } else ans = null;   // ไม่ใช่ชื่อกล้อง = ไม่ใช่คำตอบ ปล่อยไปเป็นคำสั่งใหม่
    }
    if (ans !== null && ans !== undefined) {
      await clearPendingAsk(pool, lineUserId, sourceId);
      const cmd0 = commands.find((c) => c.key === pending.command_key);
      if (cmd0) {
        const slots0 = _slotRestore(pending.slots || {});
        if (pending.need === 'confirm') {
          if (ans === 'no') {
            await logRun(pool, { ...base, matched_key: pending.command_key,
                                 status: 'cancelled', ms: Date.now() - t0 });
            return { action: 'reply', status: 'cancelled', text: 'ยกเลิกแล้ว ไม่ได้ส่งอะไรออกไป' };
          }
          return runAction(deps, { cmd: cmd0, slots: slots0, op, base, now, t0, confirmed: true });
        }
        if (pending.need === 'site') slots0.site = ans;
        else if (pending.need === 'camera') {
          if (ans && ans._cameraIds) slots0._cameraGroup = { label: 'กล้องที่เลือกไว้', ids: ans._cameraIds };
          else slots0.camera = ans;
        }
        else if (pending.need === 'period') slots0.period = ans;
        else if (String(pending.need).startsWith('slot:')) slots0[String(pending.need).slice(5)] = ans;
        return runCommand(deps, { cmd: cmd0, slots: slots0, op, base, now, t0, answered: true });
      }
    } else {
      await clearPendingAsk(pool, lineUserId, sourceId);
    }
  }

  // "ช่วยเหลือ" เป็นคำสั่งในตัว ไม่ได้อยู่ในตาราง — เพราะถ้าเจ้าของเผลอปิดหรือลบทิ้ง
  // ผู้ใช้จะไม่มีทางรู้ว่าสั่งอะไรได้บ้างอีกเลย และไม่มีใครสังเกตจนกว่าจะมีคนถาม
  if (/^\s*(ช่วยเหลือ|คำสั่ง|help|\?)\s*$/i.test(String(text || ''))) {
    await logRun(pool, { ...base, matched_key: 'help', status: 'ok', ms: Date.now() - t0 });
    return { action: 'reply', status: 'ok', text: helpText(commands) };
  }

  // 🔴 ปม 2026-09-15 (ต่อยอด GOTCHAS #209): ข้อความยาว/หลายบรรทัด (เช่น paste
  // log/เอกสารเข้ามาคุยกันในห้อง) มีโอกาสสูงจะมีคำเรียกคำสั่งฝังอยู่กลางเนื้อหา
  // โดยไม่ได้ตั้งใจสั่งบอท — ยืนยันจริง (ปูม id=287): ข้อความปูม log ที่ paste
  // เข้าไปมีคำว่า "offline" ซ้ำหลายจุด ชน camera_offline ตรง ๆ ทั้งที่กำลังคุย
  // วิเคราะห์บั๊กกันอยู่ คำสั่งจริงที่คนพิมพ์เป็นประโยคสั้นบรรทัดเดียวเสมอ ⇒
  // ข้อความหลายบรรทัดหรือยาวเกินไปข้ามการจับคำสั่งไปเลย ไม่เข้า matchCommand/
  // suggest() แม้แต่จะเสนอคำใกล้เคียงก็ไม่ควร (ยิ่งดูเหมือนบอทกวนบทสนทนา)
  if (String(text || '').includes('\n') || String(text || '').length > 200) {
    await logRun(pool, { ...base, status: 'no_match', ms: Date.now() - t0 });
    return { action: 'ignore', status: 'no_match' };
  }

  const m = matchCommand(text, commands, { now });

  if (m.status === 'no_match') {
    await logRun(pool, { ...base, status: 'no_match', ms: Date.now() - t0 });
    // ไม่ตอบทุกประโยคที่ไม่ใช่คำสั่ง — ในกลุ่มมีบทสนทนาปกติเต็มไปหมด
    // ตอบเฉพาะตอนที่ผู้ใช้ "ตั้งใจถามระบบ" ซึ่งดูจากคำเรียกที่ใกล้เคียง
    const near = suggest(text, commands, 3);
    if (!near.length) return { action: 'ignore', status: 'no_match' };
    return {
      action: 'reply', status: 'no_match',
      text: ['ยังไม่เข้าใจคำสั่งนี้ ลองแบบนี้ได้',
             ...near.map((c, i) => `${i + 1}. ${c.label}`)].join('\n'),
    };
  }

  if (m.status === 'ambiguous') {
    await logRun(pool, { ...base, status: 'ambiguous', ms: Date.now() - t0 });
    return {
      action: 'reply', status: 'ambiguous',
      text: ['ต้องการอันไหน พิมพ์ให้ชัดขึ้นอีกนิด',
             ...m.candidates.map((c, i) => `${i + 1}. ${c.label}`)].join('\n'),
    };
  }

  if (m.command.action_key) {
    return runAction(deps, { cmd: m.command, slots: { ...m.slots }, op, base, now, t0,
                             score: m.score });
  }
  return runCommand(deps, { cmd: m.command, slots: { ...m.slots }, op, base, now, t0,
                           score: m.score });
}

/**
 * คำสั่งชนิด "ทำ" — สองจังหวะเสมอ: หาให้เจอว่าจะทำกับอะไร → ถามยืนยัน → ลงมือ
 * ของที่ทำแล้วออกไปข้างนอกองค์กร (เข้ากลุ่มตำรวจ) เรียกคืนไม่ได้ จึงไม่มีทางลัด
 */
async function runAction(deps, { cmd, slots, op, base, now, t0, score = null, confirmed = false }) {
  const { pool } = deps;
  const lineUserId = base.line_user_id;
  const sourceId = base.source_id;
  const act = getAction(cmd.action_key);
  if (!act) {
    await logRun(pool, { ...base, matched_key: cmd.key, status: 'error',
                         error: `ไม่รู้จักการกระทำ ${cmd.action_key}`, ms: Date.now() - t0 });
    return { action: 'reply', status: 'error', text: 'คำสั่งนี้ตั้งค่าไว้ไม่ครบ แจ้งผู้ดูแลระบบด้วย' };
  }

  const targets = Array.isArray(cmd.fixed_params?.to) ? cmd.fixed_params.to.map(String) : [];
  if (act.needsTargets && !targets.length) {
    await logRun(pool, { ...base, matched_key: cmd.key, status: 'error',
                         error: 'ยังไม่ได้ตั้งผู้รับปลายทาง', ms: Date.now() - t0 });
    return { action: 'reply', status: 'error',
             text: 'คำสั่งนี้ยังไม่ได้ตั้งว่าจะส่งถึงใคร ตั้งได้ในหน้าตั้งค่า' };
  }

  // ยืนยันแล้ว: รายการที่จะทำถูกล็อกไว้ตั้งแต่ตอนถาม ไม่ใช่ไปหาใหม่ตอนนี้
  // (ระหว่างที่รอคำตอบอาจมีรถคันใหม่ผ่านกล้อง แล้วจะกลายเป็นส่งผิดคัน)
  if (confirmed) {
    if (!slots.alert) {
      return { action: 'reply', status: 'error', text: 'รายการที่จะส่งหมดอายุแล้ว สั่งใหม่อีกครั้ง' };
    }
    const out = await act.run(deps, { alert: slots.alert, targets, op, fetchAsUser });
    await logRun(pool, { ...base, matched_key: cmd.key, slots: _slotLog(slots),
                         status: out.ok ? 'ok' : 'error', ms: Date.now() - t0,
                         error: out.ok ? null : out.text });
    return { action: 'reply', status: out.ok ? 'ok' : 'error', text: out.text };
  }

  // การกระทำที่ทำกับ "ป้าย" ตรง ๆ (ปิด/เปิดเสียง) ไม่ต้องหาการแจ้งเตือน แต่ต้องรู้ป้าย
  if (act.requiresPlate) {
    if (!slots.plate) {
      await logRun(pool, { ...base, matched_key: cmd.key, status: 'ask_plate', ms: Date.now() - t0 });
      return { action: 'reply', status: 'ask_plate',
               text: 'ป้ายทะเบียนอะไร (พิมพ์เลขป้ายมาในประโยคเดียวกันได้เลย)' };
    }
    const out = await act.run(deps, { slots, op, fetchAsUser });
    await logRun(pool, { ...base, matched_key: cmd.key, match_score: score, slots: _slotLog(slots),
                         status: out.ok ? 'ok' : 'error', ms: Date.now() - t0,
                         error: out.ok ? null : out.text });
    return { action: 'reply', status: out.ok ? 'ok' : 'error', text: out.text };
  }

  const picked = await act.pick(deps, { slots, op, fetchAsUser });
  if (picked?.error) {
    await logRun(pool, { ...base, matched_key: cmd.key, status: 'error',
                         error: picked.error, ms: Date.now() - t0 });
    return { action: 'reply', status: 'error',
             text: picked.error === 'no_permission'
               ? 'บัญชีที่ผูกไว้ไม่มีสิทธิ์ดูรายการแจ้งเตือน'
               : 'ดึงรายการแจ้งเตือนไม่สำเร็จ ลองใหม่อีกครั้ง' };
  }
  if (!picked) {
    await logRun(pool, { ...base, matched_key: cmd.key, status: 'no_target', ms: Date.now() - t0 });
    return { action: 'reply', status: 'no_target',
             text: slots.plate
               ? `ไม่พบการแจ้งเตือนของป้าย ${slots.plate} ในช่วงที่ผ่านมา`
               : 'ไม่พบการแจ้งเตือนล่าสุดในช่วงที่ผ่านมา — ระบุป้ายทะเบียนมาด้วยก็ได้' };
  }
  if (picked.many) {
    const options = picked.many.map((a) => ({
      label: `${a.plate_number} ${a.camera_name || a.camera_id}`, value: a.plate_number }));
    await savePendingAsk(pool, lineUserId, sourceId,
      { command_key: cmd.key, slots: _slotStore(slots), need: 'choice', options });
    await logRun(pool, { ...base, matched_key: cmd.key, status: 'ambiguous', ms: Date.now() - t0 });
    return { action: 'reply', status: 'ambiguous',
             text: ['จะส่งคันไหน', ...options.map((o, i) => `${i + 1}. ${o.label}`)].join('\n') };
  }

  // "รับทราบ" ไม่ปิดเสียงอะไรและกดซ้ำได้ จึงไม่ต้องมีจังหวะยืนยัน — จังหวะยืนยันมีไว้
  // สำหรับของที่ทำแล้วเรียกคืนไม่ได้เท่านั้น ใส่ทุกที่จะกลายเป็นพิธีกรรมที่คนกดผ่านโดยไม่อ่าน
  if (act.noConfirm) {
    const out = await act.run(deps, { alert: picked.alert, slots, op, fetchAsUser });
    await logRun(pool, { ...base, matched_key: cmd.key, match_score: score, slots: _slotLog(slots),
                         status: out.ok ? 'ok' : 'error', ms: Date.now() - t0,
                         error: out.ok ? null : out.text });
    return { action: 'reply', status: out.ok ? 'ok' : 'error', text: out.text };
  }

  // ชื่อผู้รับปลายทาง — ต้องบอกชื่อจริง ไม่ใช่รหัส คนอ่านต้องรู้ว่ากำลังจะส่งเข้าห้องไหน
  const { rows: cfg } = await pool.query('SELECT recipients FROM line_config WHERE id = 1');
  const names = (cfg[0]?.recipients || [])
    .filter((r) => targets.includes(String(r.id)))
    .map((r) => r.name || String(r.id).slice(-4));

  await savePendingAsk(pool, lineUserId, sourceId, {
    command_key: cmd.key, need: 'confirm', options: [],
    slots: { ..._slotStore(slots), alert: picked.alert },
  });
  await logRun(pool, { ...base, matched_key: cmd.key, match_score: score,
                       status: 'ask_confirm', ms: Date.now() - t0 });
  return { action: 'reply', status: 'ask_confirm',
           text: act.confirmText(picked.alert, names.length ? names : ['ผู้รับที่ตั้งไว้']) };
}

/** ส่วนที่ "ลงมือทำจริง" — ใช้ทั้งตอนจับคำสั่งได้ครั้งแรก และตอนได้คำตอบที่ถามกลับ */
async function runCommand(deps, { cmd, slots: slotsIn, op, base, now, t0, score = null }) {
  const { pool } = deps;
  const lineUserId = base.line_user_id;
  const sourceId = base.source_id;
  const src = getSource(cmd.source_key);
  if (!src) {
    await logRun(pool, { ...base, matched_key: cmd.key, status: 'error',
                         error: `ไม่รู้จักแหล่งข้อมูล ${cmd.source_key}`, ms: Date.now() - t0 });
    return { action: 'reply', status: 'error', text: 'คำสั่งนี้ตั้งค่าไว้ไม่ครบ แจ้งผู้ดูแลระบบด้วย' };
  }

  if (await tooSoon(pool, lineUserId, cmd.key, cmd.cooldown_sec)) {
    await logRun(pool, { ...base, matched_key: cmd.key, status: 'rate_limited', ms: Date.now() - t0 });
    return { action: 'reply', status: 'rate_limited', text: 'สั่งถี่เกินไป รอสักครู่แล้วลองใหม่' };
  }

  const slots = { ...slotsIn, ...(cmd.fixed_params || {}) };
  const user = { id: op.user_id, role: op.role };

  // ── ชื่อกล้องในประโยค ──────────────────────────────────────
  // จับที่นี่ ไม่ใช่ในตัวจับคำสั่ง เพราะชื่อกล้องบางตัวมีคำที่ชนกับคำเรียกคำสั่งได้
  // ต้องรู้ก่อนว่าเป็นคำสั่งไหน แล้วค่อยหาว่าเขาหมายถึงกล้องตัวไหน
  // ⚠️ ถ้าคำสั่งไม่ได้ประกาศช่อง camera แต่ผู้ใช้ระบุกล้องมา = **ต้องบอก** ไม่ใช่ตอบ
  // ยอดทั้งไซต์เงียบ ๆ ให้กับคำถามที่ถามถึงกล้องเดียว (ตัวเลขจะดูน่าเชื่อแต่คนละคำถาม)
  if (!slots.camera && base.text_in) {
    const cams = await camerasForUser(pool, deps.auth, user);
    const siteWords = (cmd._sites || []).flatMap((x) => [x.name_th, x.name, x.code].filter(Boolean));
    const hit = matchCamera(base.text_in, cams, { stop: siteWords });
    // "กล้องท่าฉัตรไชย ทั้งหมด" = ทุกตัวที่ชื่อตรงกลุ่มนั้น ไม่ใช่ให้เลือกทีละตัว
    // (เจ้าของสั่ง 2026-09-09 — กลุ่มกล้องตามสถานที่มีจริง เช่น ฉัตรไชย 6 ตัว)
    const wantsAll = /ทั้งหมด|ทุกตัว|ทุกกล้อง|ทุกจุด/.test(base.text_in);
    if (hit && (cmd.slots || []).includes('camera')) {
      if (hit.exact) slots.camera = hit.exact.id;
      else if (wantsAll) {
        slots._cameraGroup = { label: `กล้องที่ชื่อมี "${hit.word || ''}"`,
                               ids: hit.many.map((c) => c.id) };
      } else {
        const options = hit.many.map((c) => ({ label: c.name, value: c.id }));
        await savePendingAsk(pool, lineUserId, sourceId,
          { command_key: cmd.key, slots: _slotStore(slots), need: 'camera', options });
        await logRun(pool, { ...base, matched_key: cmd.key, match_score: score,
                             slots: _slotLog(slots), status: 'ask_camera', ms: Date.now() - t0 });
        return { action: 'reply', status: 'ask_camera',
                 text: `${askText('camera', options)}\nหรือพิมพ์ "ทั้งหมด" เพื่อรวมทุกตัวข้างบน` };
      }
    } else if (hit) {
      const name = hit.exact ? hit.exact.name : hit.many[0].name;
      await logRun(pool, { ...base, matched_key: cmd.key, status: 'error',
                           error: 'คำสั่งนี้ไม่รองรับการเจาะจงกล้อง', ms: Date.now() - t0 });
      return { action: 'reply', status: 'error',
               text: `คำสั่ง "${cmd.label}" ยังเจาะจงกล้องไม่ได้ (${name})\n`
                   + 'ตอบเป็นยอดของทั้งไซต์แทนก็ได้ ลองพิมพ์ใหม่โดยไม่ระบุกล้อง' };
    } else if ((cmd.slots || []).includes('camera')) {
      // ไม่เจอในกล้องที่บัญชีนี้เห็น — แต่เขาอาจพูดถึงกล้องที่ไม่มีสิทธิ์
      // ต้องบอกให้ชัด ไม่ใช่เงียบแล้วตอบยอดของขอบเขตอื่นซึ่งเป็นคนละคำถาม
      const outside = matchCamera(base.text_in, await allCameras(pool), { stop: siteWords });
      if (outside) {
        const name = outside.exact ? outside.exact.name : outside.many[0].name;
        await logRun(pool, { ...base, matched_key: cmd.key, status: 'denied',
                             error: 'กล้องอยู่นอกสิทธิ์ของบัญชีที่ผูกไว้', ms: Date.now() - t0 });
        return { action: 'reply', status: 'denied',
                 text: `บัญชีที่ผูกไว้ไม่มีสิทธิ์ดูกล้อง ${name}` };
      }
    }
  }

  // ── ช่องที่ "ต้องมี" ยังขาดอยู่ไหม → ถามกลับ ไม่ใช่เดา ────────
  // ตัวเลือกไซต์สร้างจาก **สิทธิ์จริงของบัญชีที่ผูกไว้** — ห้ามเสนอไซต์ที่เขาถามไปก็ไม่ได้
  // และถ้าเขาเห็นไซต์เดียวอยู่แล้วก็เติมให้เลย ไม่ถามคำถามที่มีคำตอบเดียว
  const need = (cmd.required_slots || []).find((k) => !slots[k]);
  if (need === 'site') {
    const sites = await sitesForUser(pool, deps.auth, { id: op.user_id, role: op.role });
    if (sites.length === 1) {
      slots.site = sites[0].code;
    } else if (!sites.length) {
      await logRun(pool, { ...base, matched_key: cmd.key, status: 'error',
                           error: 'บัญชีที่ผูกไว้ไม่มีไซต์ที่ดูได้', ms: Date.now() - t0 });
      return { action: 'reply', status: 'error', text: 'บัญชีที่ผูกไว้ยังไม่มีไซต์ที่ดูข้อมูลได้' };
    } else {
      const options = sites.map((s) => ({ label: siteLabel(s), value: s.code, name: s.name, name_th: s.name_th }));
      await savePendingAsk(pool, lineUserId, sourceId,
        { command_key: cmd.key, slots: _slotStore(slots), need: 'site', options });
      await logRun(pool, { ...base, matched_key: cmd.key, match_score: score,
                           slots: _slotLog(slots), status: 'ask_site', ms: Date.now() - t0 });
      return { action: 'reply', status: 'ask_site', text: askText('site', options) };
    }
  } else if (need === 'camera') {
    const cams = await camerasForUser(pool, deps.auth, user);
    if (cams.length === 1) {
      slots.camera = cams[0].id;
    } else {
      // ไม่ไล่รายชื่อกล้องทั้ง 169 ตัวใส่แชท — บอกให้พิมพ์ชื่อมาแทน
      await savePendingAsk(pool, lineUserId, sourceId,
        { command_key: cmd.key, slots: _slotStore(slots), need: 'camera', options: [] });
      await logRun(pool, { ...base, matched_key: cmd.key, match_score: score,
                           slots: _slotLog(slots), status: 'ask_camera', ms: Date.now() - t0 });
      return { action: 'reply', status: 'ask_camera', text: 'กล้องไหน (พิมพ์ชื่อกล้องหรือรหัสในวงเล็บ)' };
    }
  } else if (need === 'period') {
    const options = [
      { label: 'ชั่วโมงที่แล้ว', value: 'ชั่วโมงที่แล้ว' }, { label: 'วันนี้', value: 'วันนี้' },
      { label: 'เมื่อวาน', value: 'เมื่อวาน' }, { label: '7 วัน', value: '7 วัน' },
    ].map((o) => ({ label: o.label, value: parseThaiPeriod(o.value, now) }));
    await savePendingAsk(pool, lineUserId, sourceId,
      { command_key: cmd.key, slots: _slotStore(slots), need: 'period',
        options: options.map((o) => ({ label: o.label, value: o.label })) });
    await logRun(pool, { ...base, matched_key: cmd.key, match_score: score,
                         slots: _slotLog(slots), status: 'ask_period', ms: Date.now() - t0 });
    return { action: 'reply', status: 'ask_period', text: askText('period', options) };
  } else if (need) {
    // 🔴 เดิมช่องที่ไม่ใช่ site/camera/period หลุดผ่านไปเงียบ ๆ แล้วยิง endpoint ทั้งที่
    // ยังไม่มีค่า — "ขอรูปรถ วันนี้" (ไม่บอกป้าย) จึงค้นด้วยป้ายว่างแล้วตอบอะไรก็ไม่รู้กลับมา
    // (บั๊กที่มีอยู่ก่อนแล้ว เจอตอนต่อคำสั่งรูปเหตุการณ์ 2026-09-09)
    const ASK_SLOT = {
      plate: 'ป้ายทะเบียนอะไร (เช่น 1กอ88)',
      object_id: 'รหัสวัตถุเลขอะไร (ดูได้ในหน้ารายละเอียดของเหตุการณ์นั้น)',
      object_class: 'ชนิดไหน (รถจักรยานยนต์ · รถยนต์ · รถกระบะ · รถบรรทุก · รถบัส · จักรยาน · คน)',
    };
    await savePendingAsk(pool, lineUserId, sourceId,
      { command_key: cmd.key, slots: _slotStore(slots), need: `slot:${need}`, options: [] });
    await logRun(pool, { ...base, matched_key: cmd.key, match_score: score,
                         slots: _slotLog(slots), status: 'ask_slot', ms: Date.now() - t0 });
    return { action: 'reply', status: 'ask_slot',
             text: ASK_SLOT[need] || `ยังขาดข้อมูล: ${need}` };
  }

  // ผู้ใช้ไม่ระบุช่วงเวลา (และคำสั่งไม่ได้บังคับ) = ใช้ค่าเริ่มต้น (วันนี้) — แต่ต้องเติม
  // เป็นก้อนช่วงเวลาจริง ไม่ใช่ปล่อยว่าง เพราะการ์ดต้องพิมพ์กลับไปเสมอว่าตีความเป็นช่วงไหน
  // ไม่งั้นคนอ่านไม่มีทางรู้ว่าเลขนี้ตอบคำถามของเขาจริงหรือเปล่า (เจอตอนทดสอบ: ขึ้น null)
  // แหล่งที่มีค่าเริ่มต้นของตัวเอง (เช่น ค้นด้วยรหัสวัตถุ = ย้อน 7 วัน) ต้องได้ใช้ค่านั้น
  // ไม่งั้นถูกเติม "วันนี้" ทับตั้งแต่ตรงนี้แล้ว query() ของแหล่งไม่มีทางรู้เลยว่าผู้ใช้ไม่ได้ระบุ
  if ((src.accepts || []).includes('period') && !slots.period) {
    slots.period = src.defaultPeriod ? src.defaultPeriod(slots, now) : defaultPeriod(now);
  }

  // พูดถึง "จังหวัด" มาแต่คำสั่งนี้กรองตามจังหวัดของป้ายไม่ได้ = ต้องบอก
  // (เจ้าของพิมพ์ "จำนวนป้ายทะเบียน จังหวัดยะลา ที่หาดใหญ่" แล้วได้ยอดรวมของหาดใหญ่
  //  ทั้งหมดกลับไป ซึ่งดูเหมือนคำตอบที่ถูกทุกประการ — 2026-09-09)
  if (!(src.accepts || []).includes('province') && /จังหวัด/.test(String(base.text_in))) {
    await logRun(pool, { ...base, matched_key: cmd.key, status: 'error',
                         error: 'คำสั่งนี้ยังกรองตามจังหวัดของป้ายไม่ได้', ms: Date.now() - t0 });
    return { action: 'reply', status: 'error',
             text: `คำสั่ง "${cmd.label}" ยังกรองตามจังหวัดของป้ายไม่ได้\n`
                 + 'ตอนนี้ทำได้กับคำสั่ง "ยอดอ่านป้ายทะเบียน" เท่านั้น' };
  }

  // ระบุไซต์มาแต่คำสั่งนี้ไม่มีช่องไซต์ = บอกตรง ๆ ว่ายังทำไม่ได้ ไม่ใช่ตอบขอบเขตอื่นเงียบ ๆ
  // (เจ้าของพิมพ์ "กล้องดับ ภูเก็ต" แล้วได้ยอดทุกไซต์ โดยการ์ดไม่เขียนอะไรเลย)
  if (!(src.accepts || []).includes('site')) {
    const named = matchSite(base.text_in, cmd._sites || []);
    if (named) {
      await logRun(pool, { ...base, matched_key: cmd.key, status: 'error',
                           error: 'คำสั่งนี้ยังเจาะจงไซต์ไม่ได้', ms: Date.now() - t0 });
      return { action: 'reply', status: 'error',
               text: `คำสั่ง "${cmd.label}" ยังเจาะจงไซต์ไม่ได้\nตอบเป็นภาพรวมทุกไซต์แทนก็ได้ ลองพิมพ์ใหม่โดยไม่ระบุไซต์` };
    }
  }

  // ── ขอบเขตของคำตอบ: แคบกว่าชนะเสมอ (กล้องเดียว → กลุ่มกล้อง → ไซต์) ──
  let scopeName = null;
  if (!slots.camera && slots._cameraGroup) {
    const g = slots._cameraGroup;
    slots._cameras = g.ids;
    scopeName = `${g.label} (${g.ids.length} ตัว)`;
  } else if (slots.camera) {
    const cams = await camerasForUser(pool, deps.auth, user);
    const cam = cams.find((c) => c.id === slots.camera);
    if (!cam) {
      await logRun(pool, { ...base, matched_key: cmd.key, status: 'error',
                           error: 'กล้องไม่อยู่ในสิทธิ์ของบัญชีที่ผูกไว้', ms: Date.now() - t0 });
      return { action: 'reply', status: 'error', text: 'บัญชีที่ผูกไว้ไม่มีสิทธิ์ดูกล้องตัวนี้' };
    }
    scopeName = cam.name;
    slots._cameras = [cam.id];
    // ระบุไซต์มาด้วยแต่กล้องอยู่คนละไซต์ = บอกตรง ๆ ว่ายึดอันไหน ไม่ใช่เงียบ
    if (slots.site && cam.site_code && cam.site_code !== slots.site) {
      scopeName += ' (คนละไซต์กับที่ระบุ ยึดตามกล้อง)';
    }
  } else if (slots.site) {
    const sites = await sitesForUser(pool, deps.auth, user);
    const hit = sites.find((s) => s.code === slots.site);
    scopeName = hit ? siteLabel(hit) : slots.site;
    // 🔑 ส่งเฉพาะ "กล้องที่บัญชีนี้เห็นได้จริง" ไม่ใช่กล้องทั้งไซต์ — บัญชีที่ถูกจำกัด
    // ไว้ 4 กล้องต้องได้ยอดของ 4 กล้องนั้น (เจ้าของกำหนด 2026-09-08)
    // ตัวเลขจะถูกอยู่แล้วเพราะ endpoint ใส่ siteWhere() ทับให้อีกชั้น แต่ต้องรู้จำนวน
    // ที่แท้จริงตรงนี้เพื่อ **บอกบนการ์ด** ว่าคำตอบนี้ครอบกี่กล้อง
    const mine = (await camerasForUser(pool, deps.auth, user)).filter((c) => c.site_code === slots.site);
    const all = await camerasOfSite(pool, slots.site);
    if (!mine.length) {
      await logRun(pool, { ...base, matched_key: cmd.key, status: 'error',
                           error: 'บัญชีไม่มีกล้องในไซต์นี้', ms: Date.now() - t0 });
      return { action: 'reply', status: 'error',
               text: `บัญชีที่ผูกไว้ไม่มีกล้องในไซต์ ${scopeName}` };
    }
    slots._cameras = mine.map((c) => c.id);
    // เห็นไม่ครบทั้งไซต์ = ต้องเขียนบนการ์ด ไม่งั้นคนอ่านนึกว่าเป็นยอดทั้งไซต์
    if (mine.length < all.length) scopeName += ` (${mine.length} จาก ${all.length} กล้อง)`;
  } else if ((src.accepts || []).includes('site')) {
    // 🔴 ไม่ระบุไซต์ = ตอบ "ทุกไซต์ที่บัญชีนี้ดูได้" ซึ่งถูกต้อง แต่เดิม **ไม่เขียนอะไรเลย**
    //    บนการ์ด ⇒ คนถามยอดของภูเก็ตแล้วได้ยอดรวมทุกไซต์กลับไปโดยไม่มีสัญญาณใด ๆ
    //    (เจ้าของเจอเอง 2026-09-09: "สรุปจำนวน... กล้องท่าฉัตรไชย" ได้ 45,504 ของทุกไซต์)
    const sites = await sitesForUser(pool, deps.auth, { id: op.user_id, role: op.role });
    scopeName = sites.length === 1 ? siteLabel(sites[0])
      : `ทุกไซต์ที่ดูได้ (${sites.length} ไซต์)`;
  }
  // ── ขอเฉพาะหมวดเดียว: "ขอหมวดเหตุการณ์ RMUTR-V เมื่อวาน เฉพาะ รถจักรยานยนต์" ──
  // ชื่อหมวดอยู่ใน DB และตั้งต่างกันทุกไซต์ ⇒ จับได้ต่อเมื่อรู้ไซต์แล้วเท่านั้น
  // จึงทำตรงนี้ ไม่ใช่ใน extractSlots ซึ่งเป็นฟังก์ชันบริสุทธิ์ที่ไม่แตะ DB
  if ((src.accepts || []).includes('category') && slots.site && !slots.category) {
    const names = await categoriesOfSite(pool, slots.site);
    const hit = matchCategory(base.text_in, names);
    if (hit) {
      slots.category = hit;
      scopeName = [scopeName, hit].filter(Boolean).join(' · ');
    } else if (/เฉพาะ|แค่/.test(String(base.text_in))) {
      // พิมพ์ "เฉพาะ ..." มาแล้วจับหมวดไม่ได้ = ห้ามเงียบแล้วตอบยอดรวม เพราะนั่นคือ
      // คนละคำตอบกับที่ถาม และหน้าตาเหมือนคำตอบที่ถูกต้องทุกประการ
      await logRun(pool, { ...base, matched_key: cmd.key, match_score: score,
                           slots: _slotLog(slots), status: 'error',
                           error: 'ไม่พบหมวดที่ระบุในไซต์นี้', ms: Date.now() - t0 });
      return { action: 'reply', status: 'error',
               text: names.length
                 ? `ไซต์นี้ไม่มีหมวดที่ระบุ · มีหมวด: ${names.join(' · ')}`
                 : 'ไซต์นี้ยังไม่ได้ตั้งหมวดเหตุการณ์ไว้' };
    }
  }

  // แหล่งที่คืนแต่ camera_id ต้องได้ชื่อกล้องไปด้วย ไม่งั้นการ์ดขึ้นรหัสล้วนซึ่งคนในกลุ่มอ่านไม่ออก
  if (src.needsCameraNames) {
    const cams = await camerasForUser(pool, deps.auth, user);
    slots._camNames = Object.fromEntries(cams.map((c) => [c.id, c.name]));
  }

  // แหล่งที่ค้นด้วย "ประโยคของผู้ใช้เอง" ต้องได้ประโยคที่ **ตัดคำเรียกคำสั่งออกแล้ว**
  // ("ค้นหาอัจฉริยะ คนถือร่มเมื่อวานบ่ายโมง" → "คนถือร่มเมื่อวานบ่ายโมง") ไม่งั้นคำเรียก
  // กลายเป็นส่วนหนึ่งของสิ่งที่ให้เครื่องไปหา แล้วได้วลีอังกฤษที่เพี้ยน
  if (src.fetchAll) slots._query = _stripTriggers(base.text_in, cmd.triggers);

  let out;
  try {
    const q = src.query(slots, now);
    if (slots._cameras && slots._cameras.length) q.cameras = slots._cameras.join(',');
    const ck = `${cmd.source_key}|${JSON.stringify(q)}`;
    const call = (path, query, opts) => fetchAsUser(deps, op.user_id, path, query,
      { ...opts, timeoutMs: src.timeoutMs });
    out = await _answerCache.wrap(ck, async () => {
      // แหล่งที่ใช้เวลานาน (ค้นหาอัจฉริยะ ~25 วิ) เด้งข้อความรับทราบก่อน ไม่ให้คนถาม
      // นั่งมองห้องเงียบ ๆ แล้วเข้าใจว่าบอทไม่ทำงาน · อยู่ในตัว wrap โดยตั้งใจ =
      // คำถามซ้ำที่ได้คำตอบจากแคชทันที จะไม่เด้ง "กำลังค้น" ให้เก้อ
      if (src.ackText && deps.onAck) {
        await deps.onAck(src.ackText(slots)).catch(() => {});
      }
      return src.fetchAll
        ? src.fetchAll({ call, slots, now })
        : fetchAsUser(deps, op.user_id, src.path, q, { timeoutMs: src.timeoutMs });
    });
  } catch (e) {
    await logRun(pool, { ...base, matched_key: cmd.key, match_score: score, slots: _slotLog(slots),
                         status: 'error', error: e.message, ms: Date.now() - t0 });
    return { action: 'reply', status: 'error', text: 'ดึงข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง' };
  }

  if (!out.ok) {
    // 403 = บัญชีที่ผูกไว้ไม่มีสิทธิ์ดูข้อมูลชุดนี้ — บอกตรง ๆ ดีกว่าปล่อยให้งง
    const msg = out.status === 403
      ? 'บัญชีที่ผูกไว้ไม่มีสิทธิ์ดูข้อมูลชุดนี้'
      : 'ดึงข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง';
    await logRun(pool, { ...base, matched_key: cmd.key, match_score: score, slots: _slotLog(slots),
                         status: 'error', http_status: out.status, ms: Date.now() - t0 });
    return { action: 'reply', status: 'error', text: msg };
  }

  slots._total = out.total;
  slots._totalCapped = out.totalCapped;
  const view = src.format(out.body, slots, now);
  // ลิงก์ภาพต้องเซ็นชื่อและมีอายุ — LINE ดึงรูปจากภายนอกโดยไม่มี session ของเรา
  // อายุใช้ค่าเดียวกับที่การ์ดแจ้งเตือนใช้ (system_settings) ไม่ตั้งเลขใหม่ให้ต่างกันเอง
  if (view.photos && src.signPhotos) {
    const { rows: sr } = await pool.query(
      "SELECT value FROM system_settings WHERE key = 'signed_image_expire_hours'").catch(() => ({ rows: [] }));
    const ttl = require('./signedImage').ttlSecFromHours(sr[0]?.value);
    view.photos = src.signPhotos(view.photos, ttl);
    if (!view.photos.length) { view.empty = true; view.emptyText = 'ลิงก์ภาพยังไม่พร้อมใช้งาน'; }
  }
  const ms = Date.now() - t0;
  if (ms > SLOW_MS) console.warn(`[slow-cmd] ${cmd.key} ${ms}ms — ${String(base.text_in).slice(0, 60)}`);

  await logRun(pool, { ...base, matched_key: cmd.key, match_score: score, slots: _slotLog(slots),
                       status: 'ok', http_status: out.status,
                       rows_out: (view.rows || []).length, ms });
  await pool.query('UPDATE line_operators SET last_used_at = NOW() WHERE line_user_id = $1',
    [lineUserId]).catch(() => {});

  return {
    action: 'reply', status: 'ok',
    card: {
      title: cmd.reply_title || cmd.label,
      // ชื่อไซต์อยู่บรรทัดเดียวกับช่วงเวลา — สองอย่างนี้คือ "ขอบเขตของคำตอบ" ที่คนอ่าน
      // ต้องเห็นพร้อมกันเพื่อรู้ว่าเลขนี้ตอบคำถามของเขาหรือเปล่า
      // `view.periodLabel` = ช่วงเวลาที่ **ปลายทางตีความเอง** (ค้นหาอัจฉริยะอ่านเวลาจาก
      // ประโยคที่ฝั่งโน้น) — ต้องพิมพ์ของจริงที่ถูกใช้ค้น ไม่ใช่ของที่เราเดาเอง
      period: [src.scopeLabel || scopeName,
               view.periodLabel || (slots.period ? slots.period.label : null)]
        .filter(Boolean).join(' · ') || null,
      big: view.big || null,
      unit: view.unit || null,
      rows: view.rows || [],
      rowsTotal: view.rowsTotal || null,
      photos: view.photos || null,
      // ระบุชั่วโมงมาแต่ช่วงเป็นหลายวัน = ยังทำไม่ได้ ต้องบอก ไม่ใช่ตอบทั้งวันเงียบ ๆ
      // และช่วงที่ยังมาไม่ถึงต้องบอกเช่นกัน — "ตอนเช้า" ตอนตีสองคือเช้าของ **วันนี้**
      // ซึ่งยังไม่เกิด ⇒ ได้ 0 ที่ถูกต้อง แต่คนอ่านจะนึกว่าไม่มีคนใส่เสื้อแดงเลย
      note: [view.note,
             slots.period && slots.period.clockDropped
               ? 'ช่วงหลายวันยังเจาะจงชั่วโมงไม่ได้ — ตอบเป็นทั้งวัน' : null,
             slots.period && slots.period.from > now
               ? 'ช่วงเวลานี้ยังมาไม่ถึง (พูดถึงวันนี้) — ถ้าหมายถึงเมื่อวาน พิมพ์คำว่า "เมื่อวาน" ด้วย' : null,
            ].filter(Boolean).join('\n') || null,
      empty: !!view.empty,
      emptyText: [view.emptyText,
                  slots.period && slots.period.from > now
                    ? 'ช่วงเวลานี้ยังมาไม่ถึง — ถ้าหมายถึงเมื่อวาน พิมพ์คำว่า "เมื่อวาน" ด้วย' : null,
                 ].filter(Boolean).join('\n') || null,
      // 🔴 LINE ปฏิเสธทั้งข้อความถ้าปุ่มมี URI ไม่เต็มรูป (เช่น "/traffic") — ตอบกลับ
      // 400 เงียบ ๆ ผู้ใช้เห็นแค่ "ไม่มีอะไรเกิดขึ้น" ทั้งที่คำสั่งรันสำเร็จแล้ว
      // (เกิดจริง 2026-09-08 22:41 · ปูมขึ้น ok แต่ในกลุ่มไม่มีการ์ดมา)
      link: _absLink(src.link),
    },
  };
}

// เก็บลงตารางคำถามค้าง: ตัดสิ่งที่ประกอบใหม่ได้ทิ้ง (รายชื่อกล้อง) และเก็บช่วงเวลา
// เป็นข้อความที่ parse กลับได้ ไม่ใช่ object ที่มี Date ซึ่งกลายเป็นสตริงตอนอ่านกลับมา
function _slotStore(slots) {
  const out = {};
  for (const [k, v] of Object.entries(slots)) {
    if (k.startsWith('_')) continue;
    out[k] = (k === 'period' && v && v.from)
      ? { kind: v.kind, from: v.from.toISOString(), to: v.to.toISOString(),
          label: v.label, days: v.days, hours: v.hours }
      : v;
  }
  return out;
}

/** ประกอบ slots ที่อ่านกลับมาจากตาราง — Date ถูกเก็บเป็น ISO ต้องแปลงกลับก่อนใช้ */
function _slotRestore(slots) {
  const out = { ...slots };
  if (out.period && out.period.from) {
    out.period = { ...out.period, from: new Date(out.period.from), to: new Date(out.period.to) };
  }
  return out;
}

// ลิงก์ในการ์ดต้องเป็น URL เต็มรูปเสมอ — ไม่มีโดเมนตั้งไว้ก็ไม่ต้องใส่ปุ่ม
// ดีกว่าส่งข้อความที่ LINE ทิ้งทั้งใบ
function _absLink(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = env.str('DASHBOARD_PUBLIC_URL');
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/?page=${String(path).replace(/^\/+/, '')}`;
}

// ช่วงเวลาใน slots เป็น object ที่มี Date — เก็บลงปูมเป็นข้อความที่คนอ่านรู้เรื่อง
function _slotLog(slots) {
  const out = { ...slots };
  if (out.period) out.period = out.period.label;
  return out;
}

module.exports = { handleLineText, loadCommands, loadOperator, loadOperatorByTelegramId, allowedHere,
  fetchAsUser,
  readAnswer, askText, helpText,   // export สองตัวนี้เพื่อทดสอบการถาม/ตอบโดยไม่ต้องมี DB
  _stripTriggers };        // และตัวนี้เพื่อทดสอบว่าคำเรียกไม่หลุดไปกับสิ่งที่ให้เครื่องไปค้น
