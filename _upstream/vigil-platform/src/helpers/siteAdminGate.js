// ============================================================
// Vigil Platform — Site Admin gate (Admin เฉพาะไซต์)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// role 'site_admin' ไม่ใช่ 'admin' ⇒ ถูกปฏิเสธทุกจุดที่เช็ค role === 'admin' อยู่แล้ว (fail-closed)
// ไฟล์นี้คือ "ที่เดียว" ที่เปิดรูให้ — เฉพาะ method+path ใน RULES และ **ตรวจไซต์ของเป้าหมายที่นี่**
// ไม่ปล่อยให้ handler แต่ละตัวจำเช็คเอง (handler ที่ลืม = ทะลุไซต์เงียบ ๆ)
// route ที่ไม่อยู่ใน RULES = 403 เสมอ: alert-rules · report-schedules · settings · users · sites ·
// push-mqtt / httpHost / token ของกล้อง (แตะ credential ของ edge) · restore หมวด
//
// ขอบเขตไซต์ = req.user.allowedSites (array, มี property .cameras ถ้าถูกจำกัดรายกล้อง)
// ห้าม spread/copy array นี้ (GOTCHAS #190) — อ่านอย่างเดียว

const SANITIZE_RE = /[\x00-\x1f\x7f​-‏﻿ฺ่-๎]/g; // ต้องตรงกับ _sanitizeCameraId

const ok = () => ({ ok: true });
const no = (reason) => ({ ok: false, reason });

function scopeOf(user) {
  const s = user && user.allowedSites;
  return Array.isArray(s) && s.length ? s : null;
}
const inSites = (scope, siteId) => siteId != null && scope.includes(Number(siteId));
// Site ของ Site Admin ต้องมี edge — กล้องถูกเพิ่ม/ตรวจ/สแกน "ผ่าน edge ของไซต์นั้น" เสมอ (เจ้าของ 2026-10-14)
// ไซต์ 'main' = central ไม่มี edge → การ probe จะออกจากเครื่อง central ไปยัง IP ที่ผู้ใช้กรอก จึงไม่เปิดให้
// เกณฑ์เดียวกับ scan-nvr / publishSiteConfig ที่ใช้อยู่ (code !== 'main')
async function edgeSiteInScope(pool, scope, siteId) {
  if (!inSites(scope, siteId)) return false;
  const r = await pool.query('SELECT code FROM sites WHERE id = $1', [Number(siteId)]);
  return !!(r.rows[0] && r.rows[0].code && r.rows[0].code !== 'main');
}

// แกนรายกล้อง (user_cameras): มีรายการ = แก้ได้เฉพาะกล้องในรายการ
const camAllowed = (scope, id) => !scope.cameras || scope.cameras.includes(id);

async function cameraRow(pool, id) {
  const r = await pool.query('SELECT id, site_id FROM cameras WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// POST /api/cameras — เป็น upsert: ตรวจทั้ง "แถวเดิม" และ site_id ที่ส่งมา
// ไม่งั้นส่ง camera_id ของไซต์อื่นมาพร้อม site_id ของตัวเอง = ยึดกล้องข้ามไซต์ได้
async function cameraUpsert({ pool, req, scope, loadCameraConfig }) {
  const body = req.body || {};
  const raw = String(body.camera_id || '').trim();
  if (!raw) return no('camera_id required');
  if (raw.replace(SANITIZE_RE, '') !== raw) return no('camera_id has invisible characters');
  const siteId = body.site_id == null || body.site_id === '' ? null : parseInt(body.site_id, 10);
  if (!inSites(scope, siteId)) return no('site_id outside your sites');
  if (!(await edgeSiteInScope(pool, scope, siteId))) return no('site has no edge');
  const cur = await cameraRow(pool, raw);
  // handler รวมค่าเดิมจาก cameras-config.json (รหัสผ่าน/ค่าต่าง ๆ) — id ที่มีในไฟล์แต่ไม่มีแถวใน DB
  // ระบุไซต์ไม่ได้ จึงไม่ให้ site_admin แตะ (ถ้าปล่อย = สืบทอด credential ของกล้องที่ไม่รู้ว่าเป็นของใคร)
  if (!cur && loadCameraConfig && ((loadCameraConfig() || {}).cameras || []).some((c) => c.camera_id === raw)) {
    return no('camera exists in config without a site');
  }
  if (cur) {
    if (!inSites(scope, cur.site_id)) return no('camera belongs to another site');
    if (!camAllowed(scope, raw)) return no('camera outside your camera list');
  } else if (scope.cameras) return no('cannot create cameras with a per-camera restriction');
  return ok();
}

async function cameraDelete({ pool, m, scope }) {
  const id = decodeURIComponent(m[1]);
  const cur = await cameraRow(pool, id);
  if (!cur || !inSites(scope, cur.site_id) || !camAllowed(scope, id)) return no('camera outside your sites');
  return ok();
}

// กลุ่มอยู่ใน camera-groups.json (ไม่ใช่ตาราง) — ทุก cameraId ในกลุ่มต้องเป็นกล้องของไซต์ตัวเอง
async function allCamerasInScope(pool, scope, ids) {
  const list = [...new Set((ids || []).map(String))];
  if (!list.length) return true;
  const r = await pool.query('SELECT id, site_id FROM cameras WHERE id = ANY($1)', [list]);
  if (r.rows.length !== list.length) return false;
  return r.rows.every((c) => inSites(scope, c.site_id) && camAllowed(scope, c.id));
}

async function groupUpsert({ pool, req, scope, loadGroups }) {
  const body = req.body || {};
  const siteId = body.site_id == null || body.site_id === '' ? null : parseInt(body.site_id, 10);
  if (!inSites(scope, siteId)) return no('site_id outside your sites');
  if (!(await allCamerasInScope(pool, scope, Array.isArray(body.cameraIds) ? body.cameraIds : []))) return no('group has cameras outside your sites');
  if (body.id) {
    const prev = ((loadGroups() || {}).groups || []).find((g) => g.id === body.id);
    if (prev) {
      if (prev.site_id != null && !inSites(scope, prev.site_id)) return no('group belongs to another site');
      if (!(await allCamerasInScope(pool, scope, prev.cameraIds))) return no('group has cameras outside your sites');
    }
  }
  return ok();
}

async function groupDelete({ pool, m, scope, loadGroups }) {
  const id = decodeURIComponent(m[1]);
  const prev = ((loadGroups() || {}).groups || []).find((g) => g.id === id);
  if (!prev) return no('group not found');
  if (prev.site_id != null && !inSites(scope, prev.site_id)) return no('group belongs to another site');
  if (prev.site_id == null && !(prev.cameraIds || []).length) return no('group has no site');
  if (!(await allCamerasInScope(pool, scope, prev.cameraIds))) return no('group has cameras outside your sites');
  return ok();
}

// หมวดเหตุการณ์ — event_categories.site_id (migration 075)
async function categoriesInScope(pool, scope, ids) {
  const list = (ids || []).map((n) => parseInt(n, 10)).filter(Number.isFinite);
  if (!list.length) return false;
  const r = await pool.query('SELECT id, site_id FROM event_categories WHERE id = ANY($1)', [list]);
  return r.rows.length === new Set(list).size && r.rows.every((c) => inSites(scope, c.site_id));
}
const categoryById = ({ pool, m, scope }) => categoriesInScope(pool, scope, [m[1]]).then((v) => (v ? ok() : no('category outside your sites')));
// ล็อก/ปลดล็อกหมวด = ของ admin · หมวดที่ล็อกไว้ (เช่น RMUTR-V 151–159 ที่รายงาน #43 ใช้) ห้ามปลดแล้วลบ
async function categoryUpdate(ctx) {
  if ('is_locked' in (ctx.req.body || {})) return no('is_locked is admin-only');
  return categoryById(ctx);
}
async function categoryCreate({ req, scope }) {
  const siteId = parseInt((req.body || {}).site_id, 10);
  return inSites(scope, siteId) ? ok() : no('site_id outside your sites');
}
async function categoryBulkDelete({ pool, req, scope }) {
  return (await categoriesInScope(pool, scope, (req.body || {}).ids)) ? ok() : no('categories outside your sites');
}
async function categoryRuleDelete({ pool, m, scope }) {
  const r = await pool.query(
    'SELECT c.site_id FROM event_category_rules r JOIN event_categories c ON c.id = r.category_id WHERE r.id = $1', [parseInt(m[1], 10)]);
  return r.rows[0] && inSites(scope, r.rows[0].site_id) ? ok() : no('rule outside your sites');
}


// ── รายการเฝ้าระวัง (migration 261): ขอบเขตอยู่ที่กลุ่ม · กลุ่ม Global (site_id NULL) = อ่านอย่างเดียวสำหรับ site_admin
// notify_line ของกลุ่ม = สวิตช์หลักที่ส่ง LINE ถึงโทรศัพท์จริง → ของ admin เท่านั้น
// ป้ายทะเบียนเป็น PK ของ lpr_watchlist ⇒ ป้ายหนึ่งอยู่ได้กลุ่มเดียว · ป้ายที่อยู่ในกลุ่ม Global/ไซต์อื่นแล้ว site_admin แตะไม่ได้
const { normalizePlate } = require('./blacklist-crypto');
const GROUP_TABLE = { lpr: 'lpr_watchlist_groups', face: 'face_blacklist_groups' };
async function groupSite(pool, kind, id) {
  if (id == null || id === '') return undefined;
  const r = await pool.query(`SELECT site_id FROM ${GROUP_TABLE[kind]} WHERE id = $1`, [String(id)]);
  return r.rows[0] ? r.rows[0].site_id : undefined;   // undefined = ไม่มีกลุ่มนี้
}
const groupInScope = async (pool, kind, scope, id) => inSites(scope, await groupSite(pool, kind, id));
function groupBodyOk(scope, body, creating) {
  if ('notify_line' in body) return no('notify_line is admin-only');
  if (creating || 'site_id' in body) {
    const siteId = body.site_id == null || body.site_id === '' ? null : parseInt(body.site_id, 10);
    if (!inSites(scope, siteId)) return no('site_id outside your sites');
  }
  return null;
}
const listGroupCreate = (kind) => async ({ req, scope }) => groupBodyOk(scope, req.body || {}, true) || ok();
const listGroupUpdate = (kind) => async ({ pool, req, m, scope }) => {
  const bad = groupBodyOk(scope, req.body || {}, false); if (bad) return bad;
  return (await groupInScope(pool, kind, scope, decodeURIComponent(m[1]))) ? ok() : no('list outside your sites');
};
const listGroupDelete = (kind) => async ({ pool, m, scope }) =>
  ((await groupInScope(pool, kind, scope, decodeURIComponent(m[1]))) ? ok() : no('list outside your sites'));
const uploadOnly = async () => ok();   // อัปโหลดรูปอ้างอิง — ยังไม่ผูกกับรายการใด (รายการถูกตรวจตอนบันทึก)

async function plateGroup(pool, plate) {
  const r = await pool.query('SELECT group_id FROM lpr_watchlist WHERE plate_number = $1', [plate]);
  return r.rows[0] ? { group_id: r.rows[0].group_id } : null;
}
async function plateUpsert({ pool, req, scope }) {
  const body = req.body || {};
  if (!(await groupInScope(pool, 'lpr', scope, body.group_id))) return no('group outside your sites');
  const cur = await plateGroup(pool, normalizePlate(body.plate_number));
  if (cur && !(await groupInScope(pool, 'lpr', scope, cur.group_id))) return no('plate already in a global or another site list');
  return ok();
}
async function plateUpdate({ pool, req, m, scope }) {
  const body = req.body || {};
  const cur = await plateGroup(pool, normalizePlate(decodeURIComponent(m[1])));
  if (!cur || !(await groupInScope(pool, 'lpr', scope, cur.group_id))) return no('plate outside your sites');
  if ('group_id' in body && !(await groupInScope(pool, 'lpr', scope, body.group_id))) return no('group outside your sites');
  return ok();
}
async function plateDelete({ pool, m, scope }) {
  const cur = await plateGroup(pool, normalizePlate(decodeURIComponent(m[1])));
  return cur && (await groupInScope(pool, 'lpr', scope, cur.group_id)) ? ok() : no('plate outside your sites');
}
async function faceRosterCreate({ pool, req, scope }) {
  return (await groupInScope(pool, 'face', scope, (req.body || {}).group_id)) ? ok() : no('group outside your sites');
}
async function faceRosterUpdate({ pool, req, m, scope }) {
  const r = await pool.query('SELECT group_id FROM face_blacklist WHERE id = $1', [parseInt(m[1], 10)]);
  if (!r.rows[0] || !(await groupInScope(pool, 'face', scope, r.rows[0].group_id))) return no('person outside your sites');
  if ('group_id' in (req.body || {}) && !(await groupInScope(pool, 'face', scope, req.body.group_id))) return no('group outside your sites');
  return ok();
}


// ── เพิ่มกล้องหลายตัว / สแกน NVR / ทดสอบการเชื่อมต่อ / ตรวจรุ่น (เจ้าของ 2026-10-14: "Depend on Site —
// ถ้ากำหนด Site เป็น Site อื่น ระบบจะ Reject ทันที") · ทุกตัวต้องเป็นไซต์ของตัวเองที่มี edge
const siteBodyEdge = async ({ pool, req, scope }) =>
  ((await edgeSiteInScope(pool, scope, parseInt((req.body || {}).site_id, 10))) ? ok() : no('site_id outside your sites or has no edge'));
// เส้นเพิ่มหลายตัวเช็คซ้ำกับ cameras-config.json อย่างเดียวแล้ว INSERT ... ON CONFLICT DO NOTHING — id ที่มีใน DB
// (ไซต์อื่น) แต่ไม่มีในไฟล์จะถูกเติม IP/รหัสของผู้ส่งเข้าไฟล์ = ยึดกล้องข้ามไซต์ · Site Admin ใช้ id ที่ไม่มีที่ไหนเลยเท่านั้น
async function existingIds(pool, loadCameraConfig, ids) {
  const list = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
  if (!list.length) return [];
  const r = await pool.query('SELECT id FROM cameras WHERE id = ANY($1)', [list]);
  const cfg = new Set(((loadCameraConfig && loadCameraConfig()) || {}).cameras?.map((c) => c.camera_id) || []);
  return list.filter((id) => cfg.has(id) || r.rows.some((x) => x.id === id));
}
async function bulkChannels(ctx) {
  const site = await siteBodyEdge(ctx); if (!site.ok) return site;
  const chans = Array.isArray((ctx.req.body || {}).channels) ? ctx.req.body.channels : [];
  const dup = await existingIds(ctx.pool, ctx.loadCameraConfig, chans.map((c) => (c || {}).camera_id));
  return dup.length ? no(`camera_id already exists: ${dup.slice(0, 10).join(',')}`) : ok();
}
async function testConnection({ pool, req, scope }) {
  const body = req.body || {};
  if (body.camera_id) {   // กล้องที่บันทึกแล้ว — ใช้ไซต์ของกล้อง ไม่ใช่ site_id ที่ส่งมา
    const cur = await cameraRow(pool, String(body.camera_id));
    return cur && camAllowed(scope, cur.id) && (await edgeSiteInScope(pool, scope, cur.site_id)) ? ok() : no('camera outside your sites');
  }
  return siteBodyEdge({ pool, req, scope });
}
// CSV: ทุกแถวต้องเป็นไซต์ของตัวเอง — แถวเดียวผิด = ปฏิเสธทั้งไฟล์ (ไม่นำเข้าบางส่วน)
async function bulkImport({ pool, req, scope, loadCameraConfig }) {
  const rows = Array.isArray((req.body || {}).cameras) ? req.body.cameras : [];
  if (!rows.length) return no('cameras required');
  const { rows: sites } = await pool.query('SELECT id, code, name FROM sites');
  const byKey = new Map();
  for (const st of sites) { byKey.set(String(st.code).toLowerCase(), st); byKey.set(String(st.name).toLowerCase(), st); }
  const bad = [];
  rows.forEach((r, i) => {
    const st = byKey.get(String((r || {}).site || '').toLowerCase().trim());
    if (!st || !inSites(scope, st.id) || st.code === 'main') bad.push(i + 1);
  });
  if (bad.length) return no(`rows outside your sites: ${bad.slice(0, 20).join(',')}${bad.length > 20 ? ',…' : ''}`);
  const dup = await existingIds(pool, loadCameraConfig, rows.map((r) => String((r || {}).camera_id || '').replace(SANITIZE_RE, '')));
  return dup.length ? no(`camera_id already exists: ${dup.slice(0, 10).join(',')}`) : ok();
}
// ตรวจรุ่นทั้งชุด — handler จำกัดเฉพาะกล้องของไซต์ตัวเอง (_planModelDetect siteIds) · ที่นี่แค่ยืนยันว่ามีไซต์
const detectModels = async () => ok();

// ── กฎแจ้งเตือน (เจ้าของอนุญาต 2026-10-14 · มี audit ทุกครั้ง) — กฎต้องผูกกล้องของไซต์ตัวเองเท่านั้น
// camera_ids ว่าง = ทุกกล้องทุกไซต์ → ของ admin · กฎประจำระบบ (channel) → ของ admin
async function camerasAllInScope(pool, scope, ids) {
  const list = Array.isArray(ids) ? ids.map(String) : [];
  return list.length > 0 && (await allCamerasInScope(pool, scope, list));
}
async function alertRuleCreate({ pool, req, scope }) {
  return (await camerasAllInScope(pool, scope, (req.body || {}).camera_ids)) ? ok() : no('rule must list cameras of your sites only');
}
async function alertRuleExisting({ pool, req, m, scope }) {
  const r = await pool.query('SELECT camera_ids, channel FROM alert_rules WHERE id = $1', [parseInt(m[1], 10)]);
  const cur = r.rows[0];
  if (!cur || cur.channel || !(await camerasAllInScope(pool, scope, cur.camera_ids))) return no('rule outside your sites');
  if (req.method === 'PUT' && 'camera_ids' in (req.body || {}) && !(await camerasAllInScope(pool, scope, req.body.camera_ids))) {
    return no('rule must list cameras of your sites only');
  }
  return ok();
}
// ── ตารางรายงาน — ต้องเป็นของไซต์ตัวเอง (site_id) · ตารางที่ไม่ระบุไซต์ = รวมทุกไซต์ → ของ admin
async function scheduleCreate({ req, scope }) {
  return inSites(scope, parseInt((req.body || {}).site_id, 10)) ? ok() : no('site_id outside your sites');
}
async function scheduleExisting({ pool, req, m, scope }) {
  const r = await pool.query('SELECT site_id FROM report_schedules WHERE id = $1', [parseInt(m[1], 10)]);
  if (!r.rows[0] || !inSites(scope, r.rows[0].site_id)) return no('schedule outside your sites');
  if (req.method === 'PUT' && 'site_id' in (req.body || {}) && !inSites(scope, parseInt(req.body.site_id, 10))) return no('site_id outside your sites');
  return ok();
}

// รายการที่เปิดให้ — path เทียบกับ baseUrl+path แบบไม่มี trailing slash
const RULES = [
  ['POST',   /^\/api\/cameras$/, cameraUpsert],
  ['DELETE', /^\/api\/cameras\/([^/]+)$/, cameraDelete],
  ['POST',   /^\/api\/cameras\/test-connection$/, testConnection],
  ['POST',   /^\/api\/cameras\/scan-nvr$/, siteBodyEdge],
  ['POST',   /^\/api\/cameras\/bulk-create-channels$/, bulkChannels],
  ['POST',   /^\/api\/cameras\/bulk-import$/, bulkImport],
  ['POST',   /^\/api\/cameras\/detect-models$/, detectModels],
  ['POST',   /^\/api\/alert-rules$/, alertRuleCreate],
  ['PUT',    /^\/api\/alert-rules\/(\d+)$/, alertRuleExisting],
  ['DELETE', /^\/api\/alert-rules\/(\d+)$/, alertRuleExisting],
  ['POST',   /^\/api\/report-schedules$/, scheduleCreate],
  ['PUT',    /^\/api\/report-schedules\/(\d+)$/, scheduleExisting],
  ['DELETE', /^\/api\/report-schedules\/(\d+)$/, scheduleExisting],
  ['POST',   /^\/api\/report-schedules\/(\d+)\/run$/, scheduleExisting],
  ['POST',   /^\/api\/groups$/, groupUpsert],
  ['DELETE', /^\/api\/groups\/([^/]+)$/, groupDelete],
  ['POST',   /^\/api\/categories$/, categoryCreate],
  ['PUT',    /^\/api\/categories\/(\d+)$/, categoryUpdate],
  ['DELETE', /^\/api\/categories\/(\d+)$/, categoryById],
  ['POST',   /^\/api\/categories\/bulk-delete$/, categoryBulkDelete],
  ['POST',   /^\/api\/categories\/(\d+)\/rules$/, categoryById],
  ['DELETE', /^\/api\/category-rules\/(\d+)$/, categoryRuleDelete],
  ['POST',   /^\/api\/lpr\/watchlist\/groups$/, listGroupCreate('lpr')],
  ['PATCH',  /^\/api\/lpr\/watchlist\/groups\/([^/]+)$/, listGroupUpdate('lpr')],
  ['DELETE', /^\/api\/lpr\/watchlist\/groups\/([^/]+)$/, listGroupDelete('lpr')],
  ['POST',   /^\/api\/lpr\/watchlist\/image$/, uploadOnly],
  ['POST',   /^\/api\/lpr\/watchlist$/, plateUpsert],
  ['PATCH',  /^\/api\/lpr\/watchlist\/([^/]+)$/, plateUpdate],
  ['DELETE', /^\/api\/lpr\/watchlist\/([^/]+)$/, plateDelete],
  ['POST',   /^\/api\/face-blacklist\/groups$/, listGroupCreate('face')],
  ['PATCH',  /^\/api\/face-blacklist\/groups\/([^/]+)$/, listGroupUpdate('face')],
  ['DELETE', /^\/api\/face-blacklist\/groups\/([^/]+)$/, listGroupDelete('face')],
  ['POST',   /^\/api\/face-blacklist\/roster\/upload$/, uploadOnly],
  ['POST',   /^\/api\/face-blacklist\/roster$/, faceRosterCreate],
  ['PUT',    /^\/api\/face-blacklist\/roster\/(\d+)$/, faceRosterUpdate],
  ['PUT',    /^\/api\/face-blacklist\/roster\/(\d+)\/active$/, faceRosterUpdate],
];

/** @returns {Promise<{ok:boolean, reason?:string}>} — ok:true เฉพาะ route ใน RULES ที่ผ่านการตรวจไซต์ */
async function checkSiteAdminWrite(req, { pool, loadGroups, loadCameraConfig }) {
  try {
    const scope = scopeOf(req.user);
    if (!scope) return no('no site assigned');
    const full = (req.baseUrl + req.path).replace(/\/+$/, '');
    for (const [method, re, fn] of RULES) {
      if (req.method !== method) continue;
      const m = full.match(re);
      if (m) return await fn({ pool, req, m, scope, loadGroups, loadCameraConfig });
    }
    return no('route not open to site_admin');
  } catch (e) {
    return no('check failed');   // fail closed — ตัดสินไม่ได้ = ไม่ให้ผ่าน
  }
}

module.exports = { checkSiteAdminWrite, RULES };
