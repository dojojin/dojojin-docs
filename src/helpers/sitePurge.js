// ============================================================
// Vigil Platform — Helper: Site Purge (ลบไซต์พร้อมข้อมูลทั้งหมด · S5)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// planSitePurge  — นับว่าจะลบอะไร + ตัวบล็อก (อ่านอย่างเดียว)
// startSitePurge — บันทึก job ลง system_settings แล้วรันเบื้องหลัง
// runSitePurge   — ทำตามลำดับขั้น (ทุกขั้น idempotent · รันซ้ำจากต้นได้เสมอ)
// resumePendingPurge — boot: job ที่ค้าง 'running' รันใหม่จากต้น
//
// 🔴 กฎของไฟล์นี้:
//   • ทุก DELETE/UPDATE ต้องมีขอบเขต (camera_id = ANY / event_id = ANY / site id / code)
//     — มีเทสต์ตรวจ SQL ทุกคำสั่งที่ยิงจริง (test/site-purge.test.js)
//   • ห้ามแตะตาราง users (อ่านได้อย่างเดียว เพื่อหา user ที่สิทธิ์จะ "กว้างขึ้น")
//   • ค่าว่าง = "ทั้งหมด" ในหลายที่ (alert_rules.camera_ids · lpr_sites/lpr_groups ·
//     user_cameras) — ตัดจนว่างเมื่อไหร่ = เปิดกว้างเงียบ ๆ · ไฟล์นี้ปิดตัวนั้นแทน
//     (enabled=false / lpr_enabled=false) หรือบล็อก (user_cameras)
//   • รายชื่อกล้อง + code ถูกตรึงไว้ใน job ตั้งแต่เริ่ม — หลังขั้น cameras/site
//     SELECT จาก DB จะคืนว่าง resume ต้องใช้ค่าที่ตรึงไว้เท่านั้น
// ============================================================
'use strict';

const env = require('../config');
const brokerAdmin = require('./brokerAdmin');
const { deleteCameraMedia } = require('../camera-media-delete');
const { safeCamDir } = require('../snapshot-path');

const JOB_KEY = 'site_purge_job';
const BATCH = 5000;
const PAUSE_MS = 100;
const EDGE_DRAIN_MS = 5000; // ให้ delete-media ข้าม bridge ก่อนถอนรหัส (deleteClient เตะ session ทันที)
const COUNT_TIMEOUT = '60s';

// ลูกของ events ที่ผูกด้วย event_id (ไม่มี FK cascade แล้ว — ต้องลบเอง)
const EVENT_CHILDREN = ['appearances', 'license_plates', 'face_event_notes', 'face_event_acks', 'lpr_alert_acks'];
// ตารางที่มี camera_id — ลบหลัง events (ลำดับไม่สำคัญระหว่างกันเอง ไม่มี FK ระหว่างกัน)
const CAMERA_TABLES = [
  'license_plates', 'appearances', 'face_embeddings', 'face_embed_queue', 'face_blacklist_hits',
  'alert_logs', 'event_category_rules', 'camera_offline_alerts', 'camera_quiet_alerts',
  'camera_status_log', 'camera_event_baseline', 'camera_httphost_backups', 'hcp_camera_map', 'lpr_gates',
  'traffic_hourly_stats', 'traffic_daily_stats', 'event_kpi_hourly', 'event_dim_bucket',
  'lpr_hourly_stats', 'lpr_dim_daily', 'appearance_dim_hourly', 'appearance_dim_daily',
];

let _running = null; // job object ของ process นี้ระหว่างรัน (GET อ่านจากนี่ก่อน DB)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isMissingTable = (e) => e && e.code === '42P01';

function _assertCams(cams) {
  if (!Array.isArray(cams) || !cams.length || !cams.every((c) => typeof c === 'string' && c)) {
    throw new Error('sitePurge: camera list must be a non-empty array of ids');
  }
}

// ── อ่าน/เขียนสถานะ job ─────────────────────────────────────────
async function _saveJob(pool, job) {
  await pool.query(
    `INSERT INTO system_settings (key, value, description) VALUES ($1, $2, 'site purge job state (S5)')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JOB_KEY, JSON.stringify(job)]);
}

async function _loadJob(pool) {
  const { rows } = await pool.query('SELECT value FROM system_settings WHERE key = $1', [JOB_KEY]);
  if (!rows.length || !rows[0].value) return null;
  try { return JSON.parse(rows[0].value); } catch { return null; }
}

async function getPurgeJob(pool) {
  return _running || _loadJob(pool);
}

// ── ผู้ใช้ ────────────────────────────────────────────────────────
// widened = user_cameras ทุกแถวอยู่ในกล้องที่จะลบ แต่ยังมีไซต์อื่นเหลือ → แถวหายหมด =
// getAllowedCameras คืน null = "เห็นทุกกล้องในไซต์ที่เหลือ" (กว้างขึ้นเงียบ ๆ)
// excludeSiteId = null (ลบกล้องตัวเดียว) → ไซต์ใดก็ได้ที่ยังมีอยู่ถือว่า "เหลือ"
async function findWidenedUsers(pool, cams, excludeSiteId = null) {
  if (!cams.length) return [];
  const { rows } = await pool.query(
    `SELECT u.id, u.username FROM users u
      WHERE u.role NOT IN ('admin', 'auditor')
        AND EXISTS (SELECT 1 FROM user_cameras uc WHERE uc.user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM user_cameras uc WHERE uc.user_id = u.id AND NOT (uc.camera_id = ANY($1)))
        AND EXISTS (SELECT 1 FROM user_sites us WHERE us.user_id = u.id AND ($2::int IS NULL OR us.site_id <> $2))
      ORDER BY u.id`, [cams, excludeSiteId]);
  return rows;
}

// ── ชื่อโฟลเดอร์รูป ───────────────────────────────────────────────
// snapPath เขียนด้วย safeCamDir() (แทนอักขระแปลกเป็น '_') แต่ deleteCameraMedia รับ
// เฉพาะ [A-Za-z0-9._-] → ต้องแปลงก่อนส่ง ไม่งั้นกล้องที่มีช่องว่าง/ภาษาไทยในชื่อ
// จะถูกปฏิเสธแล้วรูปค้างเงียบ ๆ · ชื่อชนกับกล้องที่ยังอยู่ (เช่น "a b" กับ "a_b") = ข้าม
function mediaDirNames(cams, survivorIds) {
  const taken = new Set((survivorIds || []).map(safeCamDir));
  const ok = [], collisions = [];
  for (const id of cams) {
    const name = safeCamDir(id);
    if (taken.has(name)) collisions.push(id); else ok.push({ id, name });
  }
  return { ok, collisions };
}

async function _survivorIds(pool, cams, loadCameraConfig) {
  const { rows } = await pool.query('SELECT id FROM cameras WHERE NOT (id = ANY($1))', [cams]);
  const set = new Set(rows.map((r) => r.id));
  if (loadCameraConfig) {
    for (const c of (loadCameraConfig().cameras || [])) if (!cams.includes(c.camera_id)) set.add(c.camera_id);
  }
  return [...set];
}

async function deleteCentralMedia(snapshotDir, names) {
  let dirs = 0; const rejected = [];
  if (!snapshotDir) return { dirs, rejected, skipped: 'no snapshotDir' };
  for (const { id, name } of names) {
    const r = await deleteCameraMedia(snapshotDir, name);
    if (r.rejected) rejected.push(id); else dirs += r.dirsRemoved;
  }
  return { dirs, rejected };
}

async function sendEdgeDeleteMedia(code, names) {
  const sent = [], failed = [];
  for (const { id, name } of names) {
    try {
      await brokerAdmin.publish(`projects/${code}/_config/delete-media`, {
        camera_id: name, // ชื่อโฟลเดอร์ (safeCamDir) — edge ใช้ค่านี้เป็นชื่อโฟลเดอร์ตรง ๆ
        secret: env.str('CAMERA_SECRET_KEY'), // SEC5-HIGH-003 — edge-config-agent command gate
      });
      sent.push(id);
    } catch (e) { failed.push({ id, error: e.message }); }
  }
  return { sent, failed };
}

// ── config: alert_rules ───────────────────────────────────────────
// camera_ids ว่าง = "ทุกกล้อง" (alert-engine matchRule) → กฎที่ถูกตัดจนว่างต้องปิดด้วย
async function scrubAlertRules(pool, cams) {
  _assertCams(cams);
  const { rows } = await pool.query(
    `UPDATE alert_rules
        SET camera_ids = ARRAY(SELECT c FROM unnest(camera_ids) c WHERE NOT (c = ANY($1))),
            enabled = CASE WHEN camera_ids <@ $1::text[] THEN false ELSE enabled END
      WHERE camera_ids && $1::text[]
      RETURNING id, name, enabled, cardinality(camera_ids) AS left`, [cams]);
  return { updated: rows.length, disabled: rows.filter((r) => r.left === 0).map((r) => ({ id: r.id, name: r.name })) };
}

// ── ข้อมูลรายกล้อง ────────────────────────────────────────────────
async function _batchedDelete(pool, table, whereSql, args, onBatch) {
  let total = 0;
  for (;;) {
    const r = await pool.query(
      `DELETE FROM ${table} WHERE ctid = ANY(ARRAY(SELECT ctid FROM ${table} WHERE ${whereSql} LIMIT ${BATCH})) AND ${whereSql}`, args);
    if (!r.rowCount) break;
    total += r.rowCount;
    if (onBatch) await onBatch(table, total);
    await sleep(PAUSE_MS);
  }
  return total;
}

/** ลบ events (+ลูกตาม event_id) แล้วทุกตารางที่มี camera_id · counts สะสมลงใน object ที่ส่งมา */
async function deleteCameraData(pool, cams, counts = {}, onBatch = null) {
  _assertCams(cams);
  const add = (t, n) => { counts[t] = (counts[t] || 0) + n; };
  // events: id มาจาก index (camera_id, event_time) ของทุก partition · ลบลูกก่อนแม่ทีละชุด
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id, event_time FROM events WHERE camera_id = ANY($1) LIMIT ${BATCH}`, [cams]);
    if (!rows.length) break;
    const ids = rows.map((r) => r.id);
    let lo = rows[0].event_time, hi = rows[0].event_time;
    for (const r of rows) { if (r.event_time < lo) lo = r.event_time; if (r.event_time > hi) hi = r.event_time; }
    // pg แปลง timestamptz เป็น Date (ตัดไมโครวินาทีทิ้ง) → ขอบบนต้อง +1ms ไม่งั้นแถวที่ใหม่สุด
    // ของชุดซึ่งมีเศษไมโครวินาที (เขียนด้วย NOW()) หลุดขอบ ลบไม่ได้ แล้ววนติด (lo ถูกตัดลงอยู่แล้ว ปลอดภัย)
    hi = new Date(new Date(hi).getTime() + 1);
    for (const t of EVENT_CHILDREN) {
      try { add(t, (await pool.query(`DELETE FROM ${t} WHERE event_id = ANY($1)`, [ids])).rowCount); }
      catch (e) { if (!isMissingTable(e)) throw e; }
    }
    const d = await pool.query(
      `DELETE FROM events WHERE camera_id = ANY($1) AND id = ANY($2) AND event_time >= $3 AND event_time <= $4`,
      [cams, ids, lo, hi]);
    if (!d.rowCount) throw new Error('events batch deleted 0 rows — stopping to avoid an endless loop');
    add('events', d.rowCount);
    if (onBatch) await onBatch('events', counts.events);
    await sleep(PAUSE_MS);
  }
  for (const t of CAMERA_TABLES) {
    try { add(t, await _batchedDelete(pool, t, 'camera_id = ANY($1)', [cams], onBatch)); }
    catch (e) { if (!isMissingTable(e)) throw e; }
  }
  return counts;
}

/** user_cameras + แถว cameras (cascade ingester_camera_status) — ตรวจ widening ซ้ำก่อนเสมอ */
async function deleteCameraRows(pool, cams, excludeSiteId = null) {
  _assertCams(cams);
  const widened = await findWidenedUsers(pool, cams, excludeSiteId);
  if (widened.length) {
    const err = new Error(`ผู้ใช้ ${widened.map((u) => u.username).join(', ')} จะเห็นกล้องกว้างขึ้นถ้าลบ — แก้สิทธิ์รายกล้องของผู้ใช้เหล่านี้ก่อน`);
    err.status = 409; err.widened = widened;
    throw err;
  }
  const uc = (await pool.query('DELETE FROM user_cameras WHERE camera_id = ANY($1)', [cams])).rowCount;
  const cr = (await pool.query('DELETE FROM cameras WHERE id = ANY($1)', [cams])).rowCount;
  return { user_cameras: uc, cameras: cr };
}

// ── settings ที่อ้างรหัสไซต์ ───────────────────────────────────────
// lpr_sites / lpr_groups ว่าง = "ทุกไซต์/ทุกกลุ่ม" (lprLineAlert.selectRecipients)
// ตัดจนว่างเมื่อไหร่ → ปิดรับป้าย (lpr_enabled=false) แทน ไม่งั้นคนนั้นได้การ์ดทุกไซต์
function scrubRecipients(list, code, groupIds) {
  const touched = [];
  const out = (Array.isArray(list) ? list : []).map((r) => {
    if (!r || typeof r !== 'object') return r;
    const s = Array.isArray(r.lpr_sites) ? r.lpr_sites : [];
    const g = Array.isArray(r.lpr_groups) ? r.lpr_groups : [];
    const s2 = s.filter((x) => x !== code);
    const g2 = g.filter((x) => !groupIds.includes(x));
    if (s2.length === s.length && g2.length === g.length) return r;
    const n = { ...r, lpr_sites: s2, lpr_groups: g2 };
    const disable = (s.length > 0 && !s2.length) || (g.length > 0 && !g2.length);
    if (disable) n.lpr_enabled = false;
    touched.push({ id: r.id ?? r.chat_id ?? null, name: r.name || null, disable });
    return n;
  });
  return { list: out, touched };
}

async function _siteGroupIds(pool, siteId) {
  const q = async (t) => {
    try { return (await pool.query(`SELECT id FROM ${t} WHERE site_id = $1`, [siteId])).rows.map((r) => r.id); }
    catch (e) { if (isMissingTable(e) || e.code === '42703') return []; throw e; }
  };
  return { lpr: await q('lpr_watchlist_groups'), face: await q('face_blacklist_groups') };
}

async function _settingsRefs(pool, site, groups) {
  const out = { alert_rules: [], line_recipients: [], telegram_chats: [], edge_alert_muted: false,
    api_consumers: [], face_blacklist_site_rows: 0, blacklist_sources: [] };
  const soft = async (fn) => { try { return await fn(); } catch (e) { if (isMissingTable(e) || e.code === '3F000') return null; throw e; } };
  const allGroups = [...groups.lpr, ...groups.face];

  const lc = await soft(() => pool.query('SELECT recipients, edge_alert FROM line_config WHERE id = 1'));
  if (lc && lc.rows[0]) {
    out.line_recipients = scrubRecipients(lc.rows[0].recipients, site.code, allGroups).touched;
    const dis = lc.rows[0].edge_alert && lc.rows[0].edge_alert.disabled_sites;
    out.edge_alert_muted = Array.isArray(dis) && dis.includes(site.code);
  }
  const tg = await soft(() => pool.query('SELECT chats FROM telegram_config WHERE id = 1'));
  if (tg && tg.rows[0]) out.telegram_chats = scrubRecipients(tg.rows[0].chats, site.code, allGroups).touched;
  const ac = await soft(() => pool.query('SELECT slug FROM api_consumers WHERE $1 = ANY(site_codes)', [site.code]));
  if (ac) out.api_consumers = ac.rows.map((r) => r.slug);
  // face_blacklist.site_id = ไซต์ที่ worker ประมวลผล (migration 129/261) ไม่ใช่ขอบเขต → รายงานเฉย ๆ ไม่ลบ
  const fb = await soft(() => pool.query('SELECT count(*)::int AS n FROM face_blacklist WHERE site_id = $1', [site.code]));
  if (fb) out.face_blacklist_site_rows = fb.rows[0].n;
  // blacklist.sources.site_code = edge ที่เป็นทางออกของการดึงข้อมูลภายนอก → รายงานเฉย ๆ ไม่ลบ
  const bs = await soft(() => pool.query('SELECT id, label FROM blacklist.sources WHERE site_code = $1', [site.code]));
  if (bs) out.blacklist_sources = bs.rows;
  return out;
}

// ── PLAN ──────────────────────────────────────────────────────────
async function _countAll(pool, siteId, code, cams, groups) {
  const counts = {}, notes = {};
  const client = await pool.connect();
  const one = async (key, sql, args) => {
    try { counts[key] = Number((await client.query(sql, args)).rows[0].n); }
    catch (e) {
      counts[key] = null;
      notes[key] = e.code === '57014' ? 'timeout' : isMissingTable(e) ? 'missing' : e.message;
    }
  };
  try {
    await client.query(`SET statement_timeout = '${COUNT_TIMEOUT}'`);
    if (cams.length) {
      await one('events', 'SELECT count(*) AS n FROM events WHERE camera_id = ANY($1)', [cams]);
      for (const t of ['face_event_notes', 'face_event_acks', 'lpr_alert_acks']) {
        await one(t, `SELECT count(*) AS n FROM ${t} WHERE event_id IN (SELECT id FROM events WHERE camera_id = ANY($1))`, [cams]);
      }
      for (const t of CAMERA_TABLES) await one(t, `SELECT count(*) AS n FROM ${t} WHERE camera_id = ANY($1)`, [cams]);
      await one('user_cameras', 'SELECT count(*) AS n FROM user_cameras WHERE camera_id = ANY($1)', [cams]);
    }
    await one('lpr_watchlist', 'SELECT count(*) AS n FROM lpr_watchlist WHERE group_id = ANY($1)', [groups.lpr]);
    await one('face_blacklist', 'SELECT count(*) AS n FROM face_blacklist WHERE group_id = ANY($1)', [groups.face]);
    await one('bridge_rules', 'SELECT count(*) AS n FROM blacklist.bridge_rules WHERE target_group_id = ANY($1) AND active', [groups.lpr]);
    await one('face_bridge_rules', 'SELECT count(*) AS n FROM blacklist.face_bridge_rules WHERE target_group_id = ANY($1) AND active', [groups.face]);
    counts.lpr_watchlist_groups = groups.lpr.length;
    counts.face_blacklist_groups = groups.face.length;
    for (const t of ['event_categories', 'report_schedules', 'camera_groups', 'user_sites']) {
      await one(t, `SELECT count(*) AS n FROM ${t} WHERE site_id = $1`, [siteId]);
    }
    await one('hcp_camera_map_site', 'SELECT count(*) AS n FROM hcp_camera_map WHERE site_id = $1', [code]);
  } finally {
    await client.query('RESET statement_timeout').catch(() => {});
    client.release();
  }
  return { counts, notes };
}

async function _centralDirCount(snapshotDir, names, budgetMs = 10000) {
  if (!snapshotDir) return null;
  const fs = require('fs'), path = require('path');
  const t0 = Date.now();
  let dirs = 0;
  for (const cat of ['events', 'face', 'lpr']) {
    const dates = await fs.promises.readdir(path.join(snapshotDir, cat), { withFileTypes: true }).catch(() => []);
    for (const d of dates) {
      if (!d.isDirectory()) continue;
      for (const { name } of names) {
        if (Date.now() - t0 > budgetMs) return { dirs, bytes: null, partial: true };
        if (await fs.promises.stat(path.join(snapshotDir, cat, d.name, name)).then((s) => s.isDirectory()).catch(() => false)) dirs++;
      }
    }
  }
  // ponytail: ไม่นับไบต์ — ต้องเดินทุกไฟล์ (หลักล้าน) · นับเป็นจำนวนโฟลเดอร์วัน×กล้องพอ
  return { dirs, bytes: null };
}

/**
 * อ่านอย่างเดียว — ไม่ลบอะไร · blockers ว่าง = เริ่ม purge ได้
 * opts.snapshotDir, opts.loadCameraConfig (ใช้หา survivor สำหรับชื่อโฟลเดอร์ที่ชนกัน)
 */
async function planSitePurge(pool, siteId, opts = {}) {
  const { rows: srows } = await pool.query('SELECT id, code, name, status FROM sites WHERE id = $1', [siteId]);
  if (!srows.length) { const e = new Error('ไม่พบ Site'); e.status = 404; throw e; }
  const site = srows[0];
  const cams = (await pool.query('SELECT id FROM cameras WHERE site_id = $1 ORDER BY id', [siteId])).rows.map((r) => r.id);
  // job ที่ล้มกลางทางของไซต์เดียวกัน (หลังขั้นลบแถว cameras) — กล้องพวกนั้นไม่มีใน cameras แล้ว
  // แต่ข้อมูล/รูปอาจยังค้าง · รวมเข้ามาให้รอบนี้เก็บต่อ
  const prev = await getPurgeJob(pool);
  if (prev && prev.site_id === site.id && prev.status === 'failed' && Array.isArray(prev.cameras)) {
    for (const c of prev.cameras) if (!cams.includes(c)) cams.push(c);
  }

  const blockers = [];
  if (site.code === 'main') blockers.push({ code: 'main', message: 'ไม่สามารถลบ Site หลักได้' });
  if (site.status !== 'maintenance' && site.status !== 'archived') {
    blockers.push({ code: 'status', message: 'ต้องเปลี่ยนไซต์เป็น "ปิดปรับปรุง" หรือ "เก็บถาวร" ก่อน' });
  }
  if (_running || (prev && prev.status === 'running')) {
    blockers.push({ code: 'running', message: `มีงานลบไซต์ ${(prev && prev.code) || ''} กำลังทำอยู่` });
  }

  const widened = await findWidenedUsers(pool, cams, site.id);
  if (widened.length) {
    blockers.push({ code: 'widened', message: 'ผู้ใช้บางคนจะเห็นกล้องกว้างขึ้นหลังลบ — แก้สิทธิ์รายกล้องของผู้ใช้เหล่านี้ก่อน' });
  }
  const { rows: onlySite } = await pool.query(
    `SELECT u.id, u.username FROM users u
      WHERE EXISTS (SELECT 1 FROM user_sites us WHERE us.user_id = u.id AND us.site_id = $1)
        AND NOT EXISTS (SELECT 1 FROM user_sites us WHERE us.user_id = u.id AND us.site_id <> $1)
      ORDER BY u.id`, [site.id]);

  const groups = await _siteGroupIds(pool, site.id);
  // skipCounts: POST /purge ตรวจแค่ตัวบล็อก — นับทุกตาราง (สูงสุด 60 วิ/ตาราง) ซ้ำในคำขอเดียว
  // เสี่ยงชนเพดาน 100 วิของ Cloudflare ทั้งที่ job เริ่มไปแล้ว
  const { counts, notes } = opts.skipCounts ? { counts: {}, notes: {} } : await _countAll(pool, site.id, site.code, cams, groups);
  const settings = await _settingsRefs(pool, site, groups);
  if (cams.length) {
    const { rows: ar } = await pool.query(
      `SELECT id, name, camera_ids <@ $1::text[] AS disable FROM alert_rules WHERE camera_ids && $1::text[] ORDER BY id`, [cams]);
    settings.alert_rules = ar;
  }

  const hasEdge = (await pool.query('SELECT 1 FROM edge_status WHERE site_id = $1', [site.code])).rowCount > 0;
  // archived = รหัส edge ถูกถอนไปแล้วตอน archive (sites.js) → สั่งลบรูปบน edge ไม่ถึง
  const edge = !hasEdge ? 'none' : site.status === 'archived' ? 'unreachable' : 'pending';
  const survivors = cams.length ? await _survivorIds(pool, cams, opts.loadCameraConfig) : [];
  const names = mediaDirNames(cams, survivors);

  return {
    site, cameras: cams, counts, count_notes: notes,
    files: { central: opts.skipCounts ? null : await _centralDirCount(opts.snapshotDir, names.ok), edge, name_collisions: names.collisions },
    users: { onlySite, widened },
    groups, settings, blockers,
  };
}

// ── RUN ───────────────────────────────────────────────────────────
const STEPS = ['edge_media', 'broker', 'config', 'events_and_tables', 'cameras', 'site_rows', 'central_files', 'audit'];

/**
 * deps: { loadCameraConfig, saveCameraConfig, loadCameraGroups, saveCameraGroups, snapshotDir, user, onProgress }
 * job (ตรึงไว้ตอน start): { site_id, code, cameras[], edge, groups:{lpr,face}, ... }
 * ทุกขั้น idempotent — crash แล้วรันใหม่จากต้นได้
 */
async function runSitePurge(pool, siteId, deps = {}) {
  const job = deps.job || await _loadJob(pool);
  if (!job || job.site_id !== siteId) throw new Error('sitePurge: no persisted job for this site');
  const cams = job.cameras || [];
  const code = job.code;
  if (!code || code === 'main') throw new Error('sitePurge: refusing to purge main / unknown code');
  job.status = 'running';
  job.counts = job.counts || {}; // resume: นับต่อจากของเดิม (ลบซ้ำได้ 0 แถว ไม่บวกซ้ำ)
  job.results = job.results || {};
  job.error = null;
  _running = job;
  let lastSave = 0;
  const progress = async (step, extra) => {
    job.step = step; job.step_index = STEPS.indexOf(step) + 1; job.step_total = STEPS.length;
    if (extra) job.progress = extra;
    if (deps.onProgress) deps.onProgress(job);
    if (Date.now() - lastSave > 2000) { lastSave = Date.now(); await _saveJob(pool, job); }
  };
  const onBatch = (table, n) => progress('events_and_tables', { table, deleted: n });

  try {
    // b. สั่ง edge ลบรูป — ก่อนถอนรหัส (หลังถอน bridge หลุด ข้อความไม่ถึง)
    await progress('edge_media');
    if (cams.length) {
      const survivors = await _survivorIds(pool, cams, deps.loadCameraConfig);
      const names = mediaDirNames(cams, survivors);
      job.results.name_collisions = names.collisions;
      if (job.edge === 'pending') {
        job.results.edge_media = await sendEdgeDeleteMedia(code, names.ok);
        if (job.results.edge_media.sent.length) await sleep(deps.edgeDrainMs ?? EDGE_DRAIN_MS);
      } else job.results.edge_media = job.edge; // 'none' | 'unreachable'
    }

    // a. broker: ถอนรหัส edge + role + ล้าง retained config (ทุกตัวไม่ fatal)
    await progress('broker');
    const br = {};
    const tryStep = async (k, fn) => { try { await fn(); br[k] = 'ok'; } catch (e) { br[k] = e.message; } };
    await tryStep('delete_user', () => brokerAdmin.deleteUser(`edge-${code}`));
    await tryStep('delete_role', () => brokerAdmin.deleteSiteRole(code));
    await tryStep('clear_cameras', () => brokerAdmin.clearRetained(`projects/${code}/_config/cameras`));
    await tryStep('clear_retention', () => brokerAdmin.clearRetained(`projects/${code}/_config/retention`));
    job.results.broker = br;

    // c. ไฟล์ config + alert_rules
    await progress('config');
    if (cams.length) {
      const set = new Set(cams);
      if (deps.loadCameraConfig) {
        const cfg = deps.loadCameraConfig();
        const before = (cfg.cameras || []).length;
        cfg.cameras = (cfg.cameras || []).filter((c) => !set.has(c.camera_id));
        if (cfg.cameras.length !== before && deps.saveCameraConfig(cfg) === false) throw new Error('บันทึก cameras-config.json ไม่สำเร็จ');
        job.counts.config_cameras = before - cfg.cameras.length;
      }
      if (deps.loadCameraGroups) {
        const g = deps.loadCameraGroups();
        let n = 0;
        g.groups = (g.groups || []).map((x) => {
          const ids = (x.cameraIds || []).filter((id) => !set.has(id));
          n += (x.cameraIds || []).length - ids.length;
          return { ...x, cameraIds: ids };
        });
        if (n && deps.saveCameraGroups(g) === false) throw new Error('บันทึก camera-groups.json ไม่สำเร็จ');
        job.counts.config_group_refs = n;
      }
      job.results.alert_rules = await scrubAlertRules(pool, cams);
    }

    // d. ข้อมูลรายกล้อง
    await progress('events_and_tables');
    if (cams.length) await deleteCameraData(pool, cams, job.counts, onBatch);

    // e. user_cameras + cameras
    await progress('cameras');
    if (cams.length) Object.assign(job.counts, await deleteCameraRows(pool, cams, siteId));

    // f. แถวที่ผูกกับไซต์ (ลูกก่อนแม่) + settings + sites
    await progress('site_rows');
    await _deleteSiteRows(pool, siteId, code, job);

    // g. รูปบน central (ทุกกล้อง ไม่ว่าไซต์มี edge หรือไม่ — face-push/กล้องตรงเขียนลง central)
    await progress('central_files');
    if (cams.length) {
      const survivors = await _survivorIds(pool, cams, deps.loadCameraConfig);
      job.results.central_files = await deleteCentralMedia(deps.snapshotDir, mediaDirNames(cams, survivors).ok);
    }

    // h. audit
    await progress('audit');
    const user = deps.user || job.user || {};
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1, $2, 'site_purged', $3)`,
      [user.id || null, user.username || 'system', JSON.stringify({
        site_id: siteId, code, cameras: cams, counts: job.counts, results: job.results })]);

    job.status = 'done';
    job.finished_at = new Date().toISOString();
  } catch (e) {
    job.status = 'failed';
    job.error = e.message;
    job.finished_at = new Date().toISOString();
    console.error(`[site-purge] ${code} ล้มที่ขั้น ${job.step}:`, e.message);
  } finally {
    _running = null;
    await _saveJob(pool, job).catch((e) => console.error('[site-purge] save job state failed:', e.message));
    if (deps.onProgress) deps.onProgress(job);
  }
  return job;
}

async function _deleteSiteRows(pool, siteId, code, job) {
  const c = job.counts;
  // กลุ่มที่สร้างหลัง plan ก็ต้องโดนด้วย (ไม่งั้นสมาชิกกลายเป็น Global ผ่าน SET NULL)
  const fresh = await _siteGroupIds(pool, siteId);
  const saved = job.groups || { lpr: [], face: [] };
  const g = { lpr: [...new Set([...saved.lpr, ...fresh.lpr])], face: [...new Set([...saved.face, ...fresh.face])] };
  const run = async (key, sql, args) => {
    try { c[key] = (c[key] || 0) + (await pool.query(sql, args)).rowCount; }
    catch (e) { if (!isMissingTable(e) && e.code !== '3F000') throw e; }
  };
  // กลุ่มเฝ้าระวังเฉพาะไซต์ — FK ของสมาชิก/กฎ bridge เป็น SET NULL = กลายเป็น Global เงียบ ๆ
  // (migration 261) → ปิดกฎ bridge ก่อน แล้วลบสมาชิก แล้วค่อยลบกลุ่ม
  if (g.lpr.length) {
    await run('bridge_rules_disabled', 'UPDATE blacklist.bridge_rules SET active = false WHERE target_group_id = ANY($1) AND active', [g.lpr]);
    await run('lpr_watchlist', 'DELETE FROM lpr_watchlist WHERE group_id = ANY($1)', [g.lpr]);
  }
  if (g.face.length) {
    await run('face_bridge_rules_disabled', 'UPDATE blacklist.face_bridge_rules SET active = false WHERE target_group_id = ANY($1) AND active', [g.face]);
    await run('face_blacklist', 'DELETE FROM face_blacklist WHERE group_id = ANY($1)', [g.face]);
  }
  await run('lpr_watchlist_groups', 'DELETE FROM lpr_watchlist_groups WHERE site_id = $1', [siteId]);
  await run('face_blacklist_groups', 'DELETE FROM face_blacklist_groups WHERE site_id = $1', [siteId]);
  await run('event_category_rules', 'DELETE FROM event_category_rules WHERE category_id IN (SELECT id FROM event_categories WHERE site_id = $1)', [siteId]);
  await run('event_categories', 'DELETE FROM event_categories WHERE site_id = $1', [siteId]);
  await run('report_schedules', 'DELETE FROM report_schedules WHERE site_id = $1', [siteId]);
  await run('camera_groups', 'DELETE FROM camera_groups WHERE site_id = $1', [siteId]);
  await run('hcp_camera_map', 'DELETE FROM hcp_camera_map WHERE site_id = $1', [code]);
  await run('edge_status', 'DELETE FROM edge_status WHERE site_id = $1', [code]);
  // api_consumers: [] = ไม่มีไซต์ (integrations.js) → ตัดจนว่าง = แคบลง ปลอดภัย
  await run('api_consumers', 'UPDATE api_consumers SET site_codes = array_remove(site_codes, $1) WHERE $1 = ANY(site_codes)', [code]);

  const allGroups = [...g.lpr, ...g.face];
  const settings = {};
  try {
    const { rows } = await pool.query('SELECT recipients, edge_alert FROM line_config WHERE id = 1');
    if (rows[0]) {
      const r = scrubRecipients(rows[0].recipients, code, allGroups);
      const ea = rows[0].edge_alert || {};
      const dis = Array.isArray(ea.disabled_sites) ? ea.disabled_sites : [];
      const ea2 = dis.includes(code) ? { ...ea, disabled_sites: dis.filter((s) => s !== code) } : ea;
      if (r.touched.length || ea2 !== ea) {
        // unscoped: line_config เป็นตารางแถวเดียว (CHECK id = 1)
        await pool.query('UPDATE line_config SET recipients = $1, edge_alert = $2 WHERE id = 1',
          [JSON.stringify(r.list), JSON.stringify(ea2)]);
      }
      settings.line_recipients = r.touched;
      settings.edge_alert_unmuted = ea2 !== ea;
    }
  } catch (e) { if (!isMissingTable(e)) throw e; }
  try {
    const { rows } = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
    if (rows[0]) {
      const r = scrubRecipients(rows[0].chats, code, allGroups);
      // unscoped: telegram_config เป็นตารางแถวเดียว (CHECK id = 1)
      if (r.touched.length) await pool.query('UPDATE telegram_config SET chats = $1 WHERE id = 1', [JSON.stringify(r.list)]);
      settings.telegram_chats = r.touched;
    }
  } catch (e) { if (!isMissingTable(e)) throw e; }
  job.results.settings = settings;

  await run('user_sites', 'DELETE FROM user_sites WHERE site_id = $1', [siteId]);
  await run('sites', 'DELETE FROM sites WHERE id = $1', [siteId]);
}

/** เริ่มจาก plan ที่เพิ่งตรวจ (ไม่มี blocker) · คืน job ทันที งานรันเบื้องหลัง */
async function startSitePurge(pool, plan, deps = {}) {
  if (_running) { const e = new Error('มีงานลบไซต์กำลังทำอยู่'); e.status = 409; throw e; }
  const job = {
    site_id: plan.site.id, code: plan.site.code, name: plan.site.name,
    cameras: plan.cameras, edge: plan.files.edge, groups: plan.groups,
    user: deps.user ? { id: deps.user.id || null, username: deps.user.username || null } : null,
    status: 'running', step: 'queued', started_at: new Date().toISOString(), finished_at: null, error: null,
    counts: {}, results: {},
  };
  _running = job; // จองทันที กันกดซ้อน ก่อน await ตัวแรก
  try { await _saveJob(pool, job); }
  catch (e) { _running = null; throw e; }
  runSitePurge(pool, job.site_id, { ...deps, job })
    .catch((e) => console.error('[site-purge] unexpected:', e.message));
  return job;
}

/** boot: job ที่ค้าง running (process ตายกลางทาง) → รันใหม่จากต้น (ทุกขั้น idempotent) */
async function resumePendingPurge(pool, deps = {}) {
  if (_running) return null;
  const job = await _loadJob(pool);
  if (!job || job.status !== 'running') return null;
  console.log(`[site-purge] resume ${job.code} (ค้างที่ขั้น ${job.step})`);
  return runSitePurge(pool, job.site_id, { ...deps, job });
}

module.exports = {
  planSitePurge, startSitePurge, runSitePurge, resumePendingPurge, getPurgeJob,
  // ชิ้นส่วนที่ DELETE /api/cameras/:id ใช้ร่วม
  findWidenedUsers, deleteCameraData, deleteCameraRows, scrubAlertRules,
  mediaDirNames, deleteCentralMedia, sendEdgeDeleteMedia, scrubRecipients,
  STEPS, CAMERA_TABLES, EVENT_CHILDREN, JOB_KEY,
  _reset: () => { _running = null; }, // test-only
};
