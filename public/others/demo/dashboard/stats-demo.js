// ============================================================
// Vigil Platform — DEMO Event Statistics redesign (v2)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ข้อมูลจริงผ่าน session ของคนเปิด · v2 ตาม comment เจ้าของ 2026-08-28:
//
// 1. กลุ่มกล้อง (/api/groups) — filter ทั้งหน้าด้วย cameras=<ids>
// 2. คลิกการ์ดหมวด = เปิด/ปิดเส้นบนกราฟหลัก (default = 6 หมวดใหญ่สุด)
// 3. ช่วงเวลา + ช่วงเทียบอัจฉริยะ:
//      ชั่วโมงนี้   ↔ ชั่วโมงเดียวกันของเมื่อวาน   ← กรณีพิเศษตามที่สั่ง
//      วันนี้      ↔ เมื่อวาน (เวลาเดียวกัน)
//      เมื่อวาน    ↔ วานซืน
//      7 วัน      ↔ 7 วันก่อนหน้า
//      กำหนดเอง   ↔ ช่วงยาวเท่ากันก่อนหน้า
//    ⚠️ % เทียบคิดจากการเรียก categories สองครั้ง (ช่วงเลือก + ช่วงเทียบ) —
//    ไม่ใช้ prev_count ของ endpoint เพราะมันเทียบ "ช่วงก่อนหน้า" เสมอ ซึ่งผิด
//    นิยามในโหมดชั่วโมง (ต้องเทียบเมื่อวานเวลาเดียวกัน ไม่ใช่ชั่วโมงก่อนหน้า)
//    ใช้วิธีเดียวทุกโหมดจะได้ไม่มีสองนิยามปนกัน
// 4. ปุ่ม "แยกตามไซต์" ต่อกลุ่ม — ตาราง หมวด×ไซต์ จาก cameras_seen ที่
//    endpoint ส่งมาอยู่แล้ว + แผนที่ camera→site จาก /api/cameras
// ============================================================
'use strict';

const $ = (s) => document.querySelector(s);
const fmt = (n) => Math.round(n || 0).toLocaleString('th-TH');

let SITES = [], GROUPS_CAM = [], CAM_SITE = new Map();   // camera_id → site_id
let siteSel = null, groupSel = null;
let period = 'today', customFrom = null, customTo = null;
let selected = null;        // Set ของ base ที่ขึ้นกราฟหลัก (null = ยังไม่แตะ → top6)
let selectedDir = new Set(); // "base|IN" / "base|OUT" — เส้นรายทิศที่ถูกกดเพิ่ม
let selectedExtra = new Set(); // การ์ดพิเศษ (หมวก/เข็มขัด/แจ้งเตือน) ที่ขึ้นกราฟ
let showGhost = false;         // v15: default ปิดเส้นเทียบ (เจ้าของสั่ง 2026-08-28)
let expanded = false;          // v14: ปุ่มขยายความละเอียดถังเวลา (ต่อช่วงที่รองรับ)
let matrixOn = new Set();   // group key ที่เปิดมุมมองตาราง
let matrixMode = new Map(); // group key → 'sum' | 'IN' | 'OUT' (ตารางไซต์)
let charts = [], lastData = null;

// v13: ยุบ/กางกลุ่ม — สถานะยุบจำข้าม reload · เส้นที่ถูกถอดตอนยุบเก็บใน stash
// (เฉพาะ session) คืนให้อัตโนมัติตอนกางกลับ
const COLLAPSE_KEY = 'vmh_demo_collapsed';
let collapsedGroups = new Set((() => {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'); } catch { return []; }
})());
const collapseStash = {};
function restoreCollapseStash(key) {
  const st = collapseStash[key];
  if (!st) return;
  st.bases.forEach((b) => selected && selected.add(b));
  st.dirs.forEach((x) => selectedDir.add(x));
  st.extras.forEach((x) => selectedExtra.add(x));
  delete collapseStash[key];
}

// ── ช่วงเวลา + ช่วงเทียบ ───────────────────────────────────────────────────
const PERIODS = [
  { key: 'hour',   name: 'ชั่วโมงล่าสุด',  cmpName: 'ช่วงเดียวกันเมื่อวาน' },
  { key: 'today',  name: 'วันนี้',      cmpName: 'เมื่อวาน' },
  { key: 'yday',   name: 'เมื่อวาน',    cmpName: 'วานซืน' },
  { key: 'week',   name: '7 วัน',      cmpName: '7 วันก่อนหน้า' },
  { key: 'custom', name: 'กำหนดเอง',   cmpName: 'ช่วงเท่ากันก่อนหน้า' },
];

function windows() {
  const now = new Date();
  const day0 = (off) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
  let cur, cmp;
  if (period === 'hour') {
    // rolling 60 นาที snap ขอบถัง 5 นาที (วิธีหน้าเดิม e114351 — เอากลับ 2026-08-30)
    const to = new Date(Math.ceil(now.getTime() / 300e3) * 300e3);
    const from = new Date(to.getTime() - 3600e3);
    cur = [from, to];
    // ← เทียบ "ชั่วโมงนี้ของเมื่อวาน" ไม่ใช่ชั่วโมงก่อนหน้า (สั่งไว้ชัด)
    cmp = [new Date(from.getTime() - 86400e3), new Date(to.getTime() - 86400e3)];
  } else if (period === 'today') {
    cur = [day0(0), now];
    cmp = [day0(-1), day0(0)];
  } else if (period === 'yday') {
    cur = [day0(-1), day0(0)];
    cmp = [day0(-2), day0(-1)];
  } else if (period === 'week') {
    cur = [day0(-6), now];
    cmp = [day0(-13), day0(-6)];
  } else {
    const f = customFrom ? new Date(customFrom + 'T00:00:00') : day0(-2);
    const t = customTo ? new Date(new Date(customTo + 'T00:00:00').getTime() + 86400e3) : day0(0);
    const span = t - f;
    cur = [f, t];
    cmp = [new Date(f.getTime() - span), new Date(f)];
  }
  const spanH = (cur[1] - cur[0]) / 3600e3;
  // v14 ตามสเปกเจ้าของ: ชั่วโมงนี้ = 5 นาที (expand → 2.5 นาที) ·
  // วันนี้/เมื่อวาน = รายชั่วโมง (expand → 30 นาที) · หลายวัน = รายวันเสมอ
  let trunc;
  if (period === 'hour') trunc = expanded ? 'minute2_5' : 'minute5';
  else if (period === 'today' || period === 'yday') trunc = expanded ? 'minute30' : 'hour';
  else trunc = spanH <= 2 ? 'minute5' : spanH <= 48 ? 'hour' : 'day';
  return { cur, cmp, trunc };
}
const STEP_MS = { minute2_5: 150e3, minute5: 300e3, minute30: 1800e3, hour: 3600e3, day: 86400e3 };
// expand ได้เฉพาะช่วงที่มีถังละเอียดกว่าให้ลง — หลายวัน/กำหนดเองคงรายวันตามสเปก
const EXPANDABLE = { hour: '2.5 นาที', today: '30 นาที', yday: '30 นาที' };

// ── กลุ่มตายตัว (v3 ตามสเปกเจ้าของ 2026-08-28) — ไม่ต้องตั้งค่าเอง ──────────
// ระบบดูจากหมวด/กล้องที่มีจริง: หมวดไหนไม่มีข้อมูลในไซต์นั้นก็ไม่ขึ้นเอง
//
// "นับคน" ทุกหมวด (People Counting / นับคน) ถูกรวบเป็นการ์ดเดียวชื่อ
// "คนผ่านหน้ากล้อง (นับรวม)" — ชื่อจงใจสื่อว่าเป็น "ครั้งที่ตรวจพบ" ไม่ใช่ยอด
// คนเข้าอาคาร และไม่แยกเข้า-ออก · จำนวนกล้องที่ตรวจจับคนได้โชว์ในการ์ด
// (auto จาก cameras_seen ของหมวดพวกนั้นเอง ไม่ต้องไปตั้งรายชื่อกล้อง)
const PEOPLE_COUNT_RE = /^(people counting|นับคน)$/i;
const PEOPLE_COUNT_NAME = 'คนผ่านหน้ากล้อง (นับรวม)';

// หมวดพ้องความหมายข้ามไซต์ — บางไซต์ตั้งชื่ออังกฤษ (Motorcycle ของ RMUTR-V)
// แต่มันคือหมวดตายตัวเดียวกับ "รถจักรยานยนต์" · รวมเป็นการ์ด/แถวเดียว
// ไม่งั้นตารางแยกตามไซต์จะมีสองแถวของของเดียวกัน (เจ้าของทัก 2026-08-28)
// จับคู่ด้วยชื่อเต็มตัวพิมพ์เล็กเท่านั้น — ห้ามใช้ substring (จักรยาน ⊂ รถจักรยานยนต์)
const CANON = new Map(Object.entries({
  'motorcycle': 'รถจักรยานยนต์', 'car': 'รถยนต์', 'truck': 'รถบรรทุก',
  'bus': 'รถบัส', 'bicycle': 'จักรยาน', 'van': 'รถตู้', 'pickup': 'รถกระบะ',
  'crosswalk': 'คนข้ามถนน',
}));
// หมวดตายตัวของระบบ — ที่เหลือคือหมวดที่ผู้ใช้สร้างเอง (ติดป้าย "กำหนดเอง")
const FIXED_SET = new Set(['รถจักรยานยนต์', 'รถยนต์', 'รถกระบะ', 'รถตู้', 'รถบรรทุก',
  'รถบัส', 'จักรยาน', 'SUV/MPV', 'รถสามล้อพ่วงข้าง', 'รถประเภทอื่นๆ',
  'ป้ายทะเบียน', 'ใบหน้า', PEOPLE_COUNT_NAME, 'บุคคลเฝ้าระวัง', 'คนข้ามถนน']);

// default ของเส้นบนกราฟ: ชุดตายตัวที่เหมือนกันทุกวัน (top6 เปลี่ยนตามข้อมูล =
// เปิดมาแต่ละวันเห็นไม่เหมือนเดิม ไม่เหมาะกับ monitoring) · ล้างหมดได้
const DEFAULT_SELECTION = ['รถจักรยานยนต์', 'รถยนต์', 'ป้ายทะเบียน', 'ใบหน้า',
  PEOPLE_COUNT_NAME, 'บุคคลเฝ้าระวัง'];
const CAT_GROUPS = [
  { key: 'vehicle',  name: 'ยานพาหนะ',
    test: (n) => /รถ|car|bus|truck|motorcycle|bicycle|จักรยาน|suv|mpv|van/i.test(n)
                 && !/หมวก|helmet|เข็มขัด|belt|เลี้ยว/i.test(n) },
  { key: 'people',   name: 'คนและพฤติกรรม',
    test: (n) => /คน|people|person|ห้องน้ำ|ตู้เย็น|อาหาร|ข้ามถนน|crosswalk/i.test(n)
                 && !/เฝ้าระวัง/i.test(n) },
  { key: 'identify', name: 'ระบุตัวตน (ทะเบียน / ใบหน้า)',
    test: (n) => /ทะเบียน|ใบหน้า|face|plate|lpr/i.test(n) },
  { key: 'watch',    name: 'เฝ้าระวังและอื่น ๆ', test: () => true },
];

// override การจัดกลุ่มจากหน้า categories.html (demo คู่กัน) — เก็บใน localStorage
// key = category id จริง · ค่า = key ของกลุ่ม หรือ 'standalone' (ไม่รวมหมวดพื้นฐาน)
// ตอน execute ขึ้น prod ชั้นนี้จะย้ายไปคอลัมน์ group ใน event_categories
const OV_KEY = 'vmh_demo_cat_groups';
function catOverrides() {
  try { return JSON.parse(localStorage.getItem(OV_KEY) || '{}'); } catch { return {}; }
}
function splitDir(name) {
  const m = /^(.*?)\s*\((IN|OUT)\)\s*$/i.exec(name.trim());
  return m ? [m[1].trim(), m[2].toUpperCase()] : [name.trim(), null];
}

async function jget(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

function scopeParam() {
  let q = '';
  if (siteSel) q += `&site_id=${siteSel}`;
  if (groupSel) {
    const g = GROUPS_CAM.find((x) => String(x.id ?? x.name) === String(groupSel));
    if (g && (g.cameraIds || []).length) q += `&cameras=${encodeURIComponent(g.cameraIds.join(','))}`;
  }
  return q;
}
// /api/lpr/alerts ไม่รับ site_id — แปลงไซต์ที่เลือกเป็นรายชื่อกล้อง (แผนที่มีแล้ว)
// (v15.1: เดิมการ์ด extras ไม่กรองตามไซต์เลย — เลือก Phuket ก็ได้ยอดทั้งระบบ)
function alertScopeParam() {
  if (groupSel) {
    const g = GROUPS_CAM.find((x) => String(x.id ?? x.name) === String(groupSel));
    if (g && (g.cameraIds || []).length) return `&cameras=${encodeURIComponent(g.cameraIds.join(','))}`;
  }
  if (siteSel) {
    const cams = [...CAM_SITE].filter(([, s]) => String(s) === String(siteSel)).map(([id]) => id);
    if (cams.length) return `&cameras=${encodeURIComponent(cams.join(','))}`;
  }
  return '';
}

// ── โหลด ────────────────────────────────────────────────────────────────────
// จำนวนแจ้งเตือนทะเบียนในช่วง — /api/lpr/alerts รองรับ from/to อยู่แล้ว
// ขอ limit=1 แล้วอ่าน X-Total-Count (ไม่ลากรายการมาทิ้ง)
async function alertCount(from, to) {
  try {
    // limit=200 เอาแถวมาด้วย (event_time) เพื่อวาดเส้นบนกราฟ — ยอดแจ้งเตือนจริง
    // หลักหน่วยถึงหลักสิบต่อวัน 200 เกินพอ · ถ้าวันไหนทะลุ ยอดรวมยังถูก (มาจาก
    // header) แค่เส้นขาดปลาย และจะโชว์หมายเหตุ
    const r = await fetch(`/api/lpr/alerts?from=${from.toISOString()}&to=${to.toISOString()}&limit=200${alertScopeParam()}`,
      { credentials: 'include' });
    if (!r.ok) return null;
    const rows = await r.json();
    const n = r.headers.get('X-Total-Count');
    return { n: n == null ? (Array.isArray(rows) ? rows.length : 0) : Number(n),
             times: (Array.isArray(rows) ? rows : []).map((x) => x.event_time).filter(Boolean) };
  } catch { return null; }
}

// หมวกรายชั่วโมงของวันเดียว — /api/traffic/helmet-series?date=YYYY-MM-DD
// (เกณฑ์เดียวกับหน้าสถิติหมวกนิรภัย) ใช้เฉพาะโหมดวันนี้/เมื่อวานที่กราฟเป็นรายชั่วโมง
async function helmetHourly(dayDate) {
  try {
    const d = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
    const r = await jget(`/api/traffic/helmet-series?date=${d}${scopeParam()}`);
    const nh = new Array(24).fill(null), sb = new Array(24).fill(null);
    for (const h of r.hourly || []) if (h.hour != null) {
      nh[h.hour] = Number(h.no_helmet || 0);
      sb[h.hour] = Number(h.no_seatbelt || 0);   // v13: เข็มขัดรายชั่วโมงมาแล้ว
    }
    return { nh, sb };
  } catch { return null; }
}

async function load() {
  const { cur, cmp, trunc } = windows();
  const iso = (d) => d.toISOString();
  // enforcement ให้ days ครอบทั้งช่วงเลือกและช่วงเทียบ แล้วค่อยตัดจาก daily เอง —
  // เกณฑ์หมวก/เข็มขัดเป็นชุดเดียวกับหน้า "สถิติหมวกนิรภัย" (n_no_helmet ของ
  // lpr_hourly_stats) ตามที่สั่ง ไม่คิดเกณฑ์เองใหม่
  const daysBack = Math.min(60, Math.max(2, Math.ceil((Date.now() - cmp[0].getTime()) / 86400e3) + 1));
  const [catsCur, catsCmp, tlCur, tlCmp, wlCur, wlCmp, enf, nhHrCur, nhHrCmp] = await Promise.all([
    jget(`/api/stats/categories?from=${iso(cur[0])}&to=${iso(cur[1])}${scopeParam()}`),
    jget(`/api/stats/categories?from=${iso(cmp[0])}&to=${iso(cmp[1])}${scopeParam()}`),
    jget(`/api/stats/timeline-by-category?from=${iso(cur[0])}&to=${iso(cur[1])}&trunc=${trunc}${scopeParam()}`),
    jget(`/api/stats/timeline-by-category?from=${iso(cmp[0])}&to=${iso(cmp[1])}&trunc=${trunc}${scopeParam()}`),
    alertCount(cur[0], cur[1]),
    alertCount(cmp[0], cmp[1]),
    jget(`/api/traffic/enforcement?days=${daysBack}${scopeParam()}`).catch(() => null),
    // โหมดรายชั่วโมงวันเดียว (วันนี้/เมื่อวาน): หมวกมีเส้นรายชั่วโมงจาก helmet-series
    ['hour', 'minute30'].includes(trunc) && (cur[1] - cur[0]) <= 86400e3 ? helmetHourly(cur[0]) : Promise.resolve(null),
    ['hour', 'minute30'].includes(trunc) && (cur[1] - cur[0]) <= 86400e3 ? helmetHourly(cmp[0]) : Promise.resolve(null),
  ]);
  return { catsCur, catsCmp, tlCur, tlCmp, wlCur, wlCmp, enf, nhHrCur, nhHrCmp, cur, cmp, trunc };
}

// รวม daily ของ enforcement ในหน้าต่าง [from,to) → {no_helmet, no_seatbelt, series}
function enfWindow(enf, from, to) {
  if (!enf || !Array.isArray(enf.daily)) return null;
  const days = new Map();   // date → {nh, sb}
  for (const r of enf.daily) {
    const d = new Date(r.date + 'T00:00:00');
    if (d >= from && d < to) {
      const k = r.date;
      const cur = days.get(k) || { nh: 0, sb: 0 };
      cur.nh += r.no_helmet || 0; cur.sb += r.no_seatbelt || 0;
      days.set(k, cur);
    }
  }
  const keys = [...days.keys()].sort();
  return { no_helmet: keys.reduce((a, k) => a + days.get(k).nh, 0),
           no_seatbelt: keys.reduce((a, k) => a + days.get(k).sb, 0),
           nhSeries: keys.map((k) => days.get(k).nh),
           sbSeries: keys.map((k) => days.get(k).sb),
           byDate: days };
}

// series → Map(catId → count[nBuckets]) จัดตำแหน่งด้วย offset จากต้นช่วง
// ⚠️ id อยู่ที่ series[].category.id (routes/stats.js ~1020) — พลาดแล้วทุกอย่าง
// เงียบ: กราฟว่างโดยไม่มี error (เจอจริงตอน reproduce v1)
function bucketize(tl, from, trunc, n) {
  const stepMs = STEP_MS[trunc] || 86400e3;
  const out = new Map();
  for (const s of tl.series || []) {
    const id = s.category?.id ?? s.id;
    const arr = new Array(n).fill(null);
    for (const p of s.points || []) {
      const i = Math.floor((new Date(p.bucket) - from) / stepMs);
      if (i >= 0 && i < n) arr[i] = (arr[i] || 0) + Number(p.count || 0);
    }
    out.set(id, arr);
  }
  return { map: out, stepMs };
}

function labelsFor(from, n, stepMs, trunc) {
  return [...Array(n).keys()].map((i) => {
    const d = new Date(from.getTime() + i * stepMs);
    if (trunc === 'day') return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
}

// ── ประกอบการ์ด ─────────────────────────────────────────────────────────────
function buildCards(catsCur, catsCmp, curMap, cmpMap, n) {
  const cmpById = new Map((catsCmp.categories || []).map((c) => [c.id, c.count]));
  const byBase = new Map();
  for (const c of catsCur.categories || []) {
    const prev = cmpById.get(c.id) || 0;
    // v4: ไม่ซ่อนหมวดที่เป็น 0 อีก (เจ้าของทัก "กลุ่มไม่ครบ" 2026-08-28) —
    // หมวดที่ถูกตั้งไว้แล้วเงียบคือข้อมูล ("rule ไม่ยิง") ไม่ใช่ของไม่มีตัวตน
    // การกรองรายไซต์ยังถูกต้องอยู่: endpoint คืนเฉพาะหมวดของไซต์ที่เลือก
    // ⇒ ไซต์ที่ไม่มี rule ที่เกี่ยวข้องจะไม่เห็นหมวดนั้นเองตามสเปก
    // หมวดนับคน (People Counting / นับคน) ทุกไซต์ → การ์ดเดียว ชื่อที่ไม่ชวน
    // เข้าใจผิดว่าเป็นยอดเข้า-ออก · จำนวนกล้องเก็บจาก cameras_seen อัตโนมัติ
    let [base, dir] = splitDir(c.name);
    if (PEOPLE_COUNT_RE.test(base)) { base = PEOPLE_COUNT_NAME; dir = null; }
    base = CANON.get(base.toLowerCase()) || base;
    if (!byBase.has(base)) {
      byBase.set(base, { base, color: c.color, total: 0, prev: 0, io: {}, dirs: {}, ids: [],
        cur: new Array(n).fill(null), cmp: new Array(n).fill(null), camSeen: [] });
    }
    const card = byBase.get(base);
    card.ids.push(c.id);
    card.total += c.count; card.prev += prev;
    if (dir) card.io[dir] = (card.io[dir] || 0) + c.count;
    card.camSeen.push(...(c.cameras_seen || []));
    // เก็บ series รายทิศไว้ด้วย — หมวด (IN)/(OUT) เป็นคนละ category id จึงมี
    // timeline ของตัวเองอยู่แล้ว การรวมการ์ดต้องไม่ทำให้ข้อมูลนี้หายไป
    // (เจ้าของทัก 2026-08-28: รวมอ่านง่าย แต่ต้องยังเทียบ "เข้า vs เมื่อวาน" ได้)
    const dirDst = dir ? (card.dirs[dir] ||= {
      cur: new Array(n).fill(null), cmp: new Array(n).fill(null), total: 0, prev: 0, camSeen: [] }) : null;
    if (dirDst) { dirDst.total += c.count; dirDst.prev += prev;
      dirDst.camSeen.push(...(c.cameras_seen || [])); }
    for (const [src, dst, dd] of [[curMap.get(c.id), card.cur, dirDst?.cur],
                                  [cmpMap.get(c.id), card.cmp, dirDst?.cmp]]) {
      if (!src) continue;
      for (let i = 0; i < n; i++) if (src[i] != null) {
        dst[i] = (dst[i] || 0) + src[i];
        if (dd) dd[i] = (dd[i] || 0) + src[i];
      }
    }
  }
  const cards = [...byBase.values()].sort((a, b) =>
    (b.total - a.total) || (b.prev - a.prev) || a.base.localeCompare(b.base, 'th'));
  const grouped = CAT_GROUPS.map((g) => ({ ...g, cards: [] }));
  // กลุ่มที่ 5: หมวดที่ตั้งไว้ว่า "ไม่รวมกับหมวดพื้นฐาน" (จากหน้า categories.html)
  // ยอดของมันไม่ปนกับ 4 กลุ่มหลัก — เคสกล้อง recheck ที่นับซ้ำ (เจ้าของ 2026-08-28)
  const standalone = { key: 'standalone', name: 'หมวดกำหนดเอง (แยกนับ)', cards: [] };
  const ov = catOverrides();
  for (const card of cards) {
    // การ์ดหนึ่งใบอาจรวมหลาย category id (IN/OUT + ข้ามไซต์) —
    // standalone ชนะเสมอ ไม่งั้นใช้ override ตัวแรกที่เจอ แล้วค่อย fallback ชื่อ
    const picks = card.ids.map((id) => ov[id]).filter(Boolean);
    const pick = picks.includes('standalone') ? 'standalone' : picks[0];
    if (pick === 'standalone') { standalone.cards.push(card); continue; }
    const forced = pick && grouped.find((g) => g.key === pick);
    (forced || grouped.find((g) => g.test(card.base))).cards.push(card);
  }
  grouped.push(standalone);
  return grouped;
}

// ── การ์ดตายตัวของกลุ่ม "เฝ้าระวังและอื่น ๆ" (v3) ───────────────────────────
// สามใบนี้ไม่ใช่ event category — มาจากแหล่งของมันเองโดยตรง:
//   แจ้งเตือนทะเบียน = /api/lpr/alerts (X-Total-Count สองช่วง)
//   หมวก/เข็มขัด     = /api/traffic/enforcement.daily ตัดตามช่วง — เกณฑ์เดียว
//                      กับหน้า "สถิติหมวกนิรภัย" เป๊ะ ไม่คิดเกณฑ์ใหม่
// การ์ดพวกนี้คลิกขึ้นกราฟหลักไม่ได้ (ไม่มี timeline ราย bucket) จึงไม่ใส่ data-base
function watchExtras(d, align) {
  const per = PERIODS.find((x) => x.key === period);
  const dayBased = period !== 'hour';
  const out = [];
  // แปลง timestamp เป็น array ตามแกน bucket ของกราฟหลัก
  const bucketTimes = (times, from) => {
    if (!align || !times) return null;
    const arr = new Array(align.n).fill(null);
    for (const t of times) {
      const i = Math.floor((new Date(t) - from) / align.stepMs);
      if (i >= 0 && i < align.n) arr[i] = (arr[i] || 0) + 1;
    }
    return arr;
  };
  // แปลง series รายวัน (จาก enfWindow) ให้ตรงตำแหน่ง bucket รายวัน
  const alignDaily = (byDate, from, pick) => {
    if (!align || align.trunc !== 'day' || !byDate) return null;
    const arr = new Array(align.n).fill(null);
    for (const [k, v] of byDate) {
      const i = Math.floor((new Date(k + 'T00:00:00') - from) / align.stepMs);
      if (i >= 0 && i < align.n) arr[i] = pick(v);
    }
    return arr;
  };
  if (d.wlCur != null) {
    out.push({ kind: 'extra', base: 'การแจ้งเตือนป้ายทะเบียน', color: '#d68a1f',
      total: d.wlCur.n, prev: d.wlCmp?.n,
      line: bucketTimes(d.wlCur.times, d.cur[0]), lineCmp: bucketTimes(d.wlCmp?.times, d.cmp[0]),
      // sparkline ใช้ bucket เดียวกับกราฟหลัก (v8 — เดิมการ์ดนี้ไม่มีกราฟเลย)
      get spark() { return this.line; }, get sparkCmp() { return this.lineCmp; },
      note: 'จากกฎ watch list ที่ยิง LINE จริง'
        + (d.wlCur.n > d.wlCur.times.length ? ' · เส้นแสดง 200 รายการแรก' : '') });
  }
  const curW = dayBased ? enfWindow(d.enf, d.cur[0], d.cur[1]) : null;
  const cmpW = dayBased ? enfWindow(d.enf, d.cmp[0], d.cmp[1]) : null;
  if (curW) {
    // เส้นบนกราฟหลัก: โหมดหลายวัน = รายวันจาก byDate · โหมดวันเดียว (รายชั่วโมง)
    // = จาก helmet-series (มีเฉพาะหมวก — เข็มขัดยังไม่มี endpoint รายชั่วโมง จึงมี
    // เส้นเฉพาะโหมดหลายวัน · เป็นข้อจำกัดของ endpoint ปัจจุบัน ระบุไว้ในการ์ด)
    // v14: โหมด expand (minute30) — ข้อมูลหมวก/เข็มขัดละเอียดสุดที่รายชั่วโมง
    // วางค่าที่ต้นชั่วโมง เว้นช่องครึ่งชั่วโมงเป็น null ให้ spanGaps ลากเชื่อม
    // (ไม่หารครึ่งแจกสองถัง — นั่นคือแต่งข้อมูล)
    const hourlyMode = align?.trunc === 'hour' || align?.trunc === 'minute30';
    const hr2buckets = (arr) => {
      if (!arr) return null;
      if (align?.trunc === 'hour') return arr;
      const out = new Array(arr.length * 2).fill(null);
      arr.forEach((v, i) => { out[i * 2] = v; });
      return out;
    };
    const nhLine = hourlyMode ? hr2buckets(d.nhHrCur?.nh) : alignDaily(curW.byDate, d.cur[0], (v) => v.nh);
    const nhLineCmp = hourlyMode ? hr2buckets(d.nhHrCmp?.nh) : alignDaily(cmpW?.byDate, d.cmp[0], (v) => v.nh);
    out.push({ kind: 'extra', base: 'ไม่สวมหมวกนิรภัย', color: '#d64545',
      total: curW.no_helmet, prev: cmpW?.no_helmet ?? 0,
      // โหมดวันเดียว nhSeries มีจุดเดียว → sparkline หาย · ใช้เส้น bucket แทน (v8)
      spark: nhLine || curW.nhSeries, sparkCmp: nhLineCmp || cmpW?.nhSeries,
      line: nhLine, lineCmp: nhLineCmp,
      note: 'เกณฑ์เดียวกับหน้า “สถิติหมวกนิรภัย” · เฉพาะรถ 2-3 ล้อ' });
    // v13: โหมดรายชั่วโมงใช้ sb จาก helmet-series (endpoint ขยายให้แล้ว) — เกณฑ์
    // เดียวกับ enforcement (sum เปล่า ไม่กรองชนิดรถ) การ์ดจึงมีกราฟทุกโหมดแบบหมวก
    const sbLine = hourlyMode ? hr2buckets(d.nhHrCur?.sb)
      : align?.trunc === 'day' ? alignDaily(curW.byDate, d.cur[0], (v) => v.sb) : null;
    const sbLineCmp = hourlyMode ? hr2buckets(d.nhHrCmp?.sb)
      : align?.trunc === 'day' ? alignDaily(cmpW?.byDate, d.cmp[0], (v) => v.sb) : null;
    out.push({ kind: 'extra', base: 'ไม่คาดเข็มขัดนิรภัย', color: '#b4453c',
      total: curW.no_seatbelt, prev: cmpW?.no_seatbelt ?? 0,
      spark: sbLine || curW.sbSeries, sparkCmp: sbLineCmp || cmpW?.sbSeries,
      line: sbLine, lineCmp: sbLineCmp,
      note: 'เกณฑ์เดียวกับหน้า “สถิติหมวกนิรภัย” · เฉพาะรถ 4 ล้อขึ้นไป' });
  } else if (!dayBased) {
    out.push({ kind: 'note',
      text: 'หมวก/เข็มขัด แสดงเฉพาะช่วงรายวันขึ้นไป (สถิติชุดนี้เก็บเป็นรายวันตามหน้าสถิติหมวกนิรภัย)' });
  } else {
    // enforcement โหลดไม่สำเร็จ (catch → null) — บอกตรง ๆ ดีกว่าการ์ดหายเงียบ
    out.push({ kind: 'note',
      text: 'โหลดข้อมูลหมวก/เข็มขัดไม่สำเร็จ (/api/traffic/enforcement) — รีเฟรชอีกครั้ง' });
  }
  if (d.wlCur == null) {
    out.push({ kind: 'note',
      text: 'โหลดจำนวนแจ้งเตือนป้ายทะเบียนไม่สำเร็จ (/api/lpr/alerts)' });
  }
  void per;
  return out;
}

const cmpBadge = (cur, prev) => {
  if (!prev) return { cls: 'flat', txt: cur ? 'ใหม่' : '—' };
  const pct = (cur - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return { cls: 'flat', txt: 'เท่าเดิม' };
  return { cls: pct > 0 ? 'up' : 'down', txt: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%` };
};

// ── ตาราง หมวด×ไซต์ ─────────────────────────────────────────────────────────
function siteMatrix(g) {
  const mode = matrixMode.get(g.key) || 'sum';
  // มีปุ่มสลับเฉพาะกลุ่มที่มีข้อมูลทิศจริง (เข้า/ออกมาจากหมวด (IN)/(OUT))
  const hasDir = g.cards.some((c) => c.dirs && (c.dirs.IN || c.dirs.OUT));
  const rows = g.cards.map((c) => {
    const src = mode === 'sum' ? c.camSeen : (c.dirs?.[mode]?.camSeen || []);
    const per = new Map();
    for (const cs of src) {
      const sid = CAM_SITE.get(cs.camera_id);
      if (sid != null) per.set(sid, (per.get(sid) || 0) + Number(cs.count || 0));
    }
    const total = mode === 'sum' ? c.total : (c.dirs?.[mode]?.total || 0);
    return { base: c.base, color: c.color, total, per };
  }).filter((r) => mode === 'sum' || r.total > 0);
  // โชว์เฉพาะไซต์ที่มีข้อมูลในกลุ่มนี้จริง — คอลัมน์ศูนย์ล้วนไม่ช่วยอะไร
  const activeSites = SITES.filter((s) => rows.some((r) => r.per.get(s.id)));
  const maxCell = Math.max(1, ...rows.flatMap((r) => activeSites.map((s) => r.per.get(s.id) || 0)));
  const modeBar = hasDir ? `<div class="mx-modes">
      ${[['sum', 'รวม'], ['IN', 'เข้า'], ['OUT', 'ออก']].map(([k, th]) =>
        `<button data-mxmode="${g.key}|${k}" class="${mode === k ? 'on' : ''}">${th}</button>`).join('')}
      <span class="mx-note">${mode === 'sum' ? '' : 'เฉพาะหมวดที่แยกทิศได้ (มีหมวด เข้า/ออก บนกล้อง)'}</span>
    </div>` : '';
  return `${modeBar}<div class="smwrap"><table class="sitematrix">
    <thead><tr><th>หมวด</th>${activeSites.map((s) => `<th>${s.name || s.code}</th>`).join('')}<th>รวม</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td style="--kc:${r.color}">${r.base}</td>
      ${activeSites.map((s) => { const v = r.per.get(s.id) || 0;
        return `<td class="${v ? '' : 'zero'}">${v ? fmt(v) : '·'}
          ${v ? `<span class="cellbar" style="--kc:${r.color};width:${Math.max(4, v / maxCell * 100).toFixed(0)}%"></span>` : ''}</td>`; }).join('')}
      <td class="tot">${fmt(r.total)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

// ── วาด ─────────────────────────────────────────────────────────────────────
function render(d) {
  charts.forEach((c) => c.destroy()); charts = [];
  const { cur, cmp, trunc } = d;
  const spanMs = cur[1] - cur[0];
  const stepMs = STEP_MS[trunc] || 86400e3;
  // จำนวน bucket คิดจากความยาวเต็มของช่วง (วันนี้ = ทั้งวัน แม้ยังไม่ถึง) เพื่อให้
  // เส้นเทียบลากเต็มช่วงเสมอ — คือหัวใจของ "เห็นว่าที่เหลือของวันควรเป็นยังไง"
  const fullSpan = period === 'today' ? 86400e3 : period === 'hour' ? 3600e3 : spanMs;
  const n = Math.max(1, Math.ceil(fullSpan / stepMs));
  const curB = bucketize(d.tlCur, cur[0], trunc, n);
  const cmpB = bucketize(d.tlCmp, cmp[0], trunc, n);
  const groups = buildCards(d.catsCur, d.catsCmp, curB.map, cmpB.map, n);
  // การ์ดตายตัวของกลุ่มเฝ้าระวัง (แจ้งเตือนทะเบียน / หมวก / เข็มขัด)
  const extras = watchExtras(d, { n, stepMs, trunc });
  const watchGroup = groups.find((g) => g.key === 'watch');
  watchGroup.extras = extras.filter((x) => x.kind === 'extra');
  watchGroup.extraNote = extras.filter((x) => x.kind === 'note').map((x) => x.text).join(' · ') || null;
  const visGroups = groups.filter((g) => g.cards.length || (g.extras && g.extras.length) || g.extraNote);
  const labels = labelsFor(cur[0], n, stepMs, trunc);
  const per = PERIODS.find((p) => p.key === period);
  // v15: ปิดเส้นเทียบอยู่ = หัวข้อห้ามพูดว่า "เทียบ..." (เจ้าของทัก — หัวกับกราฟต้องตรงกัน)
  $('#chartCmpTitle').textContent = showGhost ? `เทียบ${per.cmpName}` : '';
  $('#cmpNote').innerHTML = `เทียบกับ <b>${per.cmpName}</b>`;

  // ── เลือกหมวดขึ้นกราฟ: default = top 6 · คลิกการ์ด toggle ──
  const all = visGroups.flatMap((g) => g.cards);
  const defaults = () => {
    const d = DEFAULT_SELECTION.filter((b) => all.some((c) => c.base === b));
    return new Set(d.length ? d : all.slice(0, 6).map((c) => c.base));
  };
  if (!selected) selected = defaults();
  // ตัด base ที่ไม่มีในขอบเขตปัจจุบัน แต่ **ไม่บังคับเติมกลับเมื่อว่าง** —
  // เลือกว่าง = ความตั้งใจของผู้ใช้ กราฟแสดงข้อความแทน (เจ้าของทักว่า blank ไม่ได้)
  selected = new Set([...selected].filter((b) => all.some((c) => c.base === b)));
  // v13: กลุ่มที่ถูกยุบ เส้นของมันต้องหลุดจากกราฟด้วย (เจ้าของสั่ง) — เก็บลง stash
  // เพื่อคืนตอนกางกลับ · ทำในนี้ (ไม่ใช่ตอนคลิก) ให้ invariant คงอยู่ข้าม reload/reset
  for (const g of visGroups) {
    if (!collapsedGroups.has(g.key)) continue;
    const st = (collapseStash[g.key] ||= { bases: new Set(), dirs: new Set(), extras: new Set() });
    for (const c of g.cards) if (selected.has(c.base)) { selected.delete(c.base); st.bases.add(c.base); }
    for (const key of [...selectedDir])
      if (g.cards.some((c) => key.startsWith(c.base + '|'))) { selectedDir.delete(key); st.dirs.add(key); }
    if (g.extras) for (const x of g.extras)
      if (selectedExtra.has(x.base)) { selectedExtra.delete(x.base); st.extras.add(x.base); }
  }
  window._demoDefaults = defaults;   // ให้ปุ่ม "ค่าเริ่มต้น" ใช้
  const chosen = all.filter((c) => selected.has(c.base));

  // v18 chart polish (เจ้าของทัก "ทื่อๆ" 2026-08-29):
  // monotone = โค้งลื่นแบบไม่ overshoot ยอด (tension เดิมทำให้หักเป็นสัน) ·
  // เติม gradient จาง ๆ ใต้เส้นหลักให้อ่าน"ปริมาณ" ได้ ไม่ใช่แค่ขอบ ·
  // จุดปลายเส้น = บอกว่า "ข้อมูลจบตรงนี้" แทนเส้นขาดกลางกราฟเฉย ๆ
  const areaFill = (color) => (ctx) => {
    const a = ctx.chart.chartArea;
    if (!a) return color + '00';
    const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
    g.addColorStop(0, color + '26'); g.addColorStop(1, color + '00');
    return g;
  };
  // จุด marker ทุกถังแบบหน้าเดิม เมื่อจุดไม่เยอะ (วันนี้=24, ชั่วโมงนี้=12-24) —
  // 7 วันขึ้นไป (168+ จุด) ปิด ไม่งั้นเส้นกลายเป็นลูกปัด · จุดปลายใหญ่กว่าเสมอ
  const DOTS = n <= 50;
  const endDot = (data) => {
    let last = -1;
    for (let i = data.length - 1; i >= 0; i--) if (data[i] != null) { last = i; break; }
    return (ctx) => (ctx.dataIndex === last ? 3
      : (DOTS && data[ctx.dataIndex] != null ? 1.8 : 0));
  };
  const SMOOTH = { cubicInterpolationMode: 'monotone', borderCapStyle: 'round', borderJoinStyle: 'round' };
  // ถังที่กำลังเก็บ (ยังไม่จบ) ห้ามลากเส้น — ค่าครึ่ง ๆ ทำปลายเส้นดิ่งหลอกทุกต้นชั่วโมง/
  // ต้นวัน (เจ้าของทัก 2026-08-30 ตอนตี 1 เหลือ 2 จุดกลายเป็นสามเหลี่ยมเต็มจอ) ·
  // แสดงแทนด้วยวงแหวนโปร่ง = "กำลังเก็บ" · เส้นช่วงเทียบเป็นช่วงที่จบแล้ว ไม่ต้องตัด
  const cutIdx = Math.floor((Date.now() - cur[0]) / stepMs);
  // ถังปิดที่ไม่มี event = ศูนย์จริง ไม่ใช่ "ไม่มีข้อมูล" — ปล่อย null แล้ว spanGaps
  // จะลากทแยงข้ามช่องว่างเหมือนมีเหตุการณ์ต่อเนื่อง (เห็นจริง 2026-08-30 ตี 1 ครึ่ง)
  // เส้นที่ไม่มีข้อมูลเลยยังเป็น null ทั้งแถบ = ไม่วาด (การ์ดยานพาหนะบนแกน 5 นาที)
  const closed = (data) => {
    const has = data.some((v) => v != null);
    return data.map((v, i) => ((cutIdx >= 0 && i >= cutIdx) ? null : (has ? (v ?? 0) : null)));
  };
  const zfill = (data) => (data.some((v) => v != null) ? data.map((v) => v ?? 0) : data);
  const pendingDs = (data, color, name) => {
    if (!(cutIdx >= 0 && cutIdx < data.length) || data[cutIdx] == null) return [];
    // สะพานเส้นประจากจุดปิดล่าสุด → วงแหวน "กำลังเก็บ" — จุดโดดไร้เส้นเชื่อม
    // อ่านเหมือนกราฟพัง (เจ้าของทัก 2026-08-30 รอบสอง)
    const pt = new Array(data.length).fill(null);
    pt[cutIdx] = data[cutIdx];
    for (let i = cutIdx - 1; i >= 0; i--) if (data[i] != null) { pt[i] = data[i]; break; }
    return [{ label: `${name} · กำลังเก็บ`, data: pt, borderColor: color + '88', borderDash: [4, 4],
      borderWidth: 1.4, spanGaps: true, fill: false,
      pointRadius: (c2) => (c2.dataIndex === cutIdx ? 4 : 0), pointHoverRadius: 5,
      pointBackgroundColor: '#ffffff', pointBorderColor: color, pointBorderWidth: 1.6 }];
  };
  const ds = [];
  for (const c of chosen) {
    const cw = closed(c.cur);
    ds.push({ label: c.base, data: cw, borderColor: c.color, borderWidth: 2.4, ...SMOOTH,
      fill: 'origin', backgroundColor: areaFill(c.color),
      pointRadius: endDot(cw), pointBackgroundColor: c.color, pointBorderColor: '#fff',
      pointBorderWidth: 1.5, pointHoverRadius: 4, spanGaps: true });
    ds.push(...pendingDs(c.cur, c.color, c.base));
    if (showGhost) ds.push({ label: `${c.base} (${per.cmpName})`, data: zfill(c.cmp), borderColor: c.color + '55',
      borderDash: [5, 4], borderWidth: 1.4, ...SMOOTH, pointRadius: 0, spanGaps: true });
  }
  // เส้นรายทิศที่ถูกกดจากป้าย เข้า/ออก ในการ์ด — เข้า = เส้นบางมีจุดสามเหลี่ยม ·
  // ออก = เส้นบางมีจุดสี่เหลี่ยม (สีเดียวกับหมวด แยกกันด้วยรูปจุด ไม่แย่ง dash
  // ที่จองไว้ให้ "ช่วงเทียบ" อยู่แล้ว)
  for (const key of selectedDir) {
    const [b, dir] = key.split('|');
    const c = all.find((x) => x.base === b);
    const dd = c?.dirs?.[dir];
    if (!dd) continue;
    const style = dir === 'IN' ? 'triangle' : 'rect';
    const label = `${b} · ${dir === 'IN' ? 'เข้า' : 'ออก'}`;
    ds.push({ label, data: closed(dd.cur), borderColor: c.color, borderWidth: 1.4, ...SMOOTH,
      pointStyle: style, pointRadius: 3, pointHoverRadius: 5, spanGaps: true });
    if (showGhost) ds.push({ label: `${label} (${per.cmpName})`, data: zfill(dd.cmp), borderColor: c.color + '55',
      borderDash: [5, 4], borderWidth: 1, pointStyle: style, pointRadius: 2,
      ...SMOOTH, spanGaps: true });
  }
  for (const x of (watchGroup.extras || [])) {
    if (!selectedExtra.has(x.base) || !x.line) continue;
    const xw = closed(x.line);
    ds.push({ label: x.base, data: xw, borderColor: x.color, borderWidth: 2, ...SMOOTH,
      fill: 'origin', backgroundColor: areaFill(x.color),
      pointRadius: endDot(xw), pointBackgroundColor: x.color, pointBorderColor: '#fff',
      pointBorderWidth: 1.5, pointHoverRadius: 4, spanGaps: true });
    ds.push(...pendingDs(x.line, x.color, x.base));
    if (x.lineCmp && showGhost) ds.push({ label: `${x.base} (${per.cmpName})`, data: zfill(x.lineCmp),
      borderColor: x.color + '55', borderDash: [5, 4], borderWidth: 1.2,
      ...SMOOTH, pointRadius: 0, spanGaps: true });
  }
  $('#chartTools').innerHTML = `
    <label class="ghost-chk"><input type="checkbox" id="ghostChk" ${showGhost ? 'checked' : ''}> เส้นเทียบ</label>
    ${EXPANDABLE[period] ? `<button class="tool-btn ${expanded ? 'on' : ''}" data-tool="expand"
      title="สลับความละเอียดถังเวลา">${expanded ? `กลับถังปกติ` : `ขยายเป็น ${EXPANDABLE[period]}`}</button>` : ''}
    <button class="tool-btn" data-tool="clear" ${selected.size || selectedDir.size || selectedExtra.size ? '' : 'disabled'}>ล้างทั้งหมด</button>
    <button class="tool-btn" data-tool="reset">ค่าเริ่มต้น</button>`;
  $('#chartEmpty').hidden = ds.length > 0;
  // แกนเต็มช่วงตายตัวเสมอ (เจ้าของเคาะ 2026-08-30 หลังเทียบหน้าเดิม): ตำแหน่ง
  // เวลาบนจอคงที่ทั้งวัน คนดูซ้ำ ๆ จำ pattern ได้ · หางว่าง = "ยังไม่มา" สื่อด้วย
  // เส้นจบที่วงแหวนกำลังเก็บอยู่แล้ว ไม่ต้องตัดแกน
  // เส้นแนวตั้งจาง ๆ ตามตำแหน่ง hover — ช่วยกวาดตาเทียบหลายเส้นในจังหวะเดียว
  const hoverLine = { id: 'hoverLine', afterDraw(ch) {
    const act = ch.tooltip?.getActiveElements?.();
    if (!act?.length) return;
    const { top, bottom } = ch.chartArea, g = ch.ctx;
    g.save(); g.strokeStyle = '#9db0c455'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(act[0].element.x, top); g.lineTo(act[0].element.x, bottom); g.stroke(); g.restore();
  } };
  // แกน x แบบ time scale สำหรับช่วงต่ำกว่ารายวัน (วิธีของหน้าเดิม e114351):
  // แกน category วาง tick ตามช่องข้อมูล ทำให้ tick สุดท้าย (22:00/23:30) ไม่ปิด
  // ขอบขวา เหลือช่องโล่งไม่สมส่วน (เจ้าของทัก 2026-08-30) — time scale ปัก
  // ขอบ 00:00→24:00 ได้พอดีและแบ่งช่องเท่ากันเสมอ · รายวันคง label ไทยเดิม
  const axisLabels = stepMs < 86400e3
    ? [...Array(n).keys()].map((i) => new Date(cur[0].getTime() + i * stepMs))
    : labels;
  charts.push(new Chart($('#mainChart'), { type: 'line',
    data: { labels: axisLabels, datasets: ds },
    plugins: [hoverLine],
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false },
        tooltip: { backgroundColor: '#243244f0', cornerRadius: 10, padding: 12,
          titleColor: '#dfe7f2', bodyColor: '#c6d2e2', boxPadding: 5, usePointStyle: true,
          callbacks: { label: (x) => ` ${x.dataset.label}: ${fmt(x.parsed.y)}` } } },
      scales: {
        y: { beginAtZero: true, border: { display: false },
             grid: { color: '#eaeff6', drawTicks: false },
             ticks: { precision: 0, callback: fmt, color: '#93a1b3', font: { size: 11 }, padding: 8, maxTicksLimit: 6 } },
        x: stepMs < 86400e3
          ? { type: 'time',
              min: cur[0].getTime(), max: cur[0].getTime() + n * stepMs,
              time: { unit: stepMs >= 3600e3 ? 'hour' : 'minute',
                      displayFormats: { minute: 'HH:mm', hour: 'HH:mm' }, tooltipFormat: 'HH:mm' },
              border: { display: false }, grid: { display: false },
              ticks: { maxTicksLimit: 13, color: '#93a1b3', font: { size: 11 } } }
          : { border: { display: false }, grid: { display: false },
              ticks: { maxTicksLimit: 12, color: '#93a1b3', font: { size: 11 } } } } } }));
  $('#mainLegend').innerHTML = chosen.map((c) =>
    `<span><span class="sw" style="background:${c.color}"></span>${c.base}</span>`).join('');

  // ── กลุ่ม ──
  $('#groups').innerHTML = visGroups.map((g) => {
    const tot = g.cards.reduce((a, c) => a + c.total, 0) + (g.extras || []).reduce((a, c) => a + c.total, 0);
    const prev = g.cards.reduce((a, c) => a + c.prev, 0) + (g.extras || []).reduce((a, c) => a + (c.prev || 0), 0);
    const dd = cmpBadge(tot, prev);
    const isMatrix = matrixOn.has(g.key);
    return `<div class="group" data-g="${g.key}">
      <div class="group-head">
        <span class="group-name">${g.name}</span>
        <span class="group-total">รวม <b>${fmt(tot)}</b> · ${g.cards.length + (g.extras || []).length} หมวด</span>
        ${g.key === 'standalone' ? `<span class="group-note">ไม่นับรวมกับกลุ่มพื้นฐาน · ตั้งค่าที่ <a href="categories.html">Event Categories demo</a></span>` : ''}
        ${prev ? `<span class="group-delta ${dd.cls === 'up' ? 'up' : dd.cls === 'down' ? 'down' : ''}">${dd.txt} เทียบ${per.cmpName}</span>` : ''}
        <span class="group-view">
          ${collapsedGroups.has(g.key) ? '' : `
          <button data-view="cards" data-g="${g.key}" class="${isMatrix ? '' : 'on'}">การ์ด</button>
          <button data-view="matrix" data-g="${g.key}" class="${isMatrix ? 'on' : ''}">แยกตามไซต์</button>
          <button data-csv-group="${g.key}" title="ดาวน์โหลดตัวเลขกลุ่มนี้เป็น CSV">CSV</button>`}
          <button data-collapse="${g.key}" class="grp-fold" title="${collapsedGroups.has(g.key)
            ? 'กางกลุ่มนี้ (เส้นที่เคยเลือกจะกลับมา)' : 'ยุบกลุ่มนี้ (เส้นบนกราฟจะถูกถอดออกด้วย)'}">
            ${collapsedGroups.has(g.key) ? 'แสดง ▸' : 'ซ่อน ▾'}</button>
        </span>
      </div>
      ${collapsedGroups.has(g.key) ? '' : isMatrix ? siteMatrix(g) : `<div class="group-grid">${g.cards.map((c, i) => {
        const b = cmpBadge(c.total, c.prev);
        const dirBtn = (dir, th) => c.io[dir] == null ? '' :
          `<button class="io-btn ${selectedDir.has(`${c.base}|${dir}`) ? 'on' : ''}"
                   data-dirbtn="${c.base.replace(/"/g, '&quot;')}|${dir}"
                   title="กดเพื่อขึ้นเส้น ${th} บนกราฟ (พร้อมเส้นเทียบ)">${th} <b>${fmt(c.io[dir])}</b></button>`;
        const io = (c.io.IN != null || c.io.OUT != null)
          ? `<div class="kpi-io">${dirBtn('IN', 'เข้า')}${dirBtn('OUT', 'ออก')}</div>` : '';
        const idle = !c.total && !c.prev;   // ตั้งไว้แต่เงียบทั้งสองช่วง
        // การ์ดนับคน: โชว์จำนวนกล้องที่ตรวจจับคนได้ (auto จาก cameras_seen)
        const camNote = c.base === PEOPLE_COUNT_NAME
          ? `<div class="kpi-io"><span>จาก <b>${new Set(c.camSeen.map((x) => x.camera_id)).size}</b> กล้องที่ตรวจจับคนได้ · ไม่แยกเข้า-ออก</span></div>` : '';
        return `<div class="kpi ${selected.has(c.base) ? 'sel' : ''}" data-base="${c.base.replace(/"/g, '&quot;')}" style="--kc:${c.color}">
          <div class="kpi-top">
            <div><div class="kpi-name">${c.base}${FIXED_SET.has(c.base) ? '' : ' <span class="chip-custom">กำหนดเอง</span>'}</div><div class="kpi-val">${fmt(c.total)}</div></div>
            <div class="kpi-cmp ${b.cls}">${b.txt}</div>
          </div>${io}${camNote}
          ${idle
            ? '<div class="kpi-idle">ยังไม่มีเหตุการณ์ในช่วงที่เลือก</div>'
            : `<div class="kpi-spark"><canvas id="sp-${g.key}-${i}"></canvas></div>
          <div class="kpi-ynote">${showGhost ? `เส้นจาง = ${per.cmpName}` : ''}</div>`}
        </div>`; }).join('')}${(g.extras || []).map((x, i) => {
        const b = cmpBadge(x.total, x.prev || 0);
        const clickable = !!x.line;
        return `<div class="kpi ${clickable && selectedExtra.has(x.base) ? 'sel' : ''}"
             ${clickable ? `data-extra="${x.base}"` : 'style="cursor:default"'}
             style="--kc:${x.color}${clickable ? '' : ';cursor:default'}">
          <div class="kpi-top">
            <div><div class="kpi-name">${x.base}</div><div class="kpi-val">${fmt(x.total)}</div></div>
            <div class="kpi-cmp ${b.cls}">${b.txt}</div>
          </div>
          ${x.spark && x.spark.length > 1 ? `<div class="kpi-spark"><canvas id="spx-${i}"></canvas></div>` : ''}
          <div class="kpi-ynote">${x.note}</div>
        </div>`; }).join('')}${g.extraNote ? `<div class="kpi" style="cursor:default"><div class="kpi-ynote" style="margin-top:8px">${g.extraNote}</div></div>` : ''}</div>`}
    </div>`; }).join('');

  const nowIdx = Math.floor((Date.now() - cur[0]) / stepMs);
  visGroups.forEach((g) => { if (matrixOn.has(g.key)) return;
    g.cards.forEach((c, i) => {
      if (!c.total && !c.prev) return;          // การ์ดว่างไม่มี canvas
      const el = document.getElementById(`sp-${g.key}-${i}`);
      if (!el) return;
      charts.push(new Chart(el, { type: 'line',
        data: { labels, datasets: [
          ...(showGhost ? [{ data: c.cmp, borderColor: '#9aa6bd88', borderDash: [3, 3], borderWidth: 1,
            cubicInterpolationMode: 'monotone', pointRadius: 0, spanGaps: true }] : []),
          { data: c.cur.map((v, x) => (x >= nowIdx ? null : v)), borderColor: c.color,
            borderWidth: 1.6, cubicInterpolationMode: 'monotone', borderCapStyle: 'round',
            fill: 'origin', backgroundColor: c.color + '14', pointRadius: 0, spanGaps: true },
        ] },
        options: { responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: { x: { display: false }, y: { display: false, beginAtZero: true } } } }));
    });
  });
  (watchGroup.extras || []).forEach((x, i) => {
    if (!(x.spark && x.spark.length > 1)) return;
    const el = document.getElementById(`spx-${i}`);
    if (!el) return;
    const m = Math.max(x.spark.length, (x.sparkCmp || []).length);
    charts.push(new Chart(el, { type: 'line',
      data: { labels: [...Array(m).keys()], datasets: [
        ...(x.sparkCmp && x.sparkCmp.length > 1 && showGhost ? [{ data: x.sparkCmp, borderColor: '#9aa6bd88',
          borderDash: [3, 3], borderWidth: 1, cubicInterpolationMode: 'monotone', pointRadius: 0, spanGaps: true }] : []),
        { data: x.spark, borderColor: x.color, borderWidth: 1.6, cubicInterpolationMode: 'monotone',
          borderCapStyle: 'round', fill: 'origin', backgroundColor: x.color + '14', pointRadius: 0, spanGaps: true },
      ] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false, beginAtZero: true } } } }));
  });
  $('#stamp').textContent = new Date().toLocaleString('th-TH');
  lastData = d;
  lastGroups = visGroups;
  renderBI();
}

// ── pills ───────────────────────────────────────────────────────────────────
function renderPills() {
  $('#periodPills').innerHTML = PERIODS.map((p) =>
    `<button data-p="${p.key}" class="${period === p.key ? 'on' : ''}">${p.name}</button>`).join('');
  $('#customBox').hidden = period !== 'custom';
  $('#sitePills').innerHTML =
    `<button data-id="" class="${siteSel ? '' : 'on'}">ทุกไซต์</button>` +
    SITES.map((s) => `<button data-id="${s.id}" class="${String(siteSel) === String(s.id) ? 'on' : ''}">${s.name || s.code}</button>`).join('');
  $('#groupPills').innerHTML =
    `<button data-gid="" class="${groupSel ? '' : 'on'}">ทุกกล้อง</button>` +
    GROUPS_CAM.map((g) => { const id = g.id ?? g.name;
      return `<button data-gid="${id}" class="${String(groupSel) === String(id) ? 'on' : ''}">
        ${g.name} <small>(${(g.cameraIds || []).length})</small></button>`; }).join('');
}

async function refresh() {
  try { $('#authNote').hidden = true; render(await load()); }
  catch (e) { console.error(e); $('#authNote').hidden = false; }
}

// ── v15: ส่วน BI — ของที่รอดจากการสำรวจหน้าเดิม (heatmap · dwell · CSV) ─────
// heatmap ใช้ฐาน 28 วันคงที่ (pattern dow×hour ต้องการหลายสัปดาห์ ไม่ผูก period)
// dwell ตามช่วง/ตัวกรองที่เลือก · ทั้งคู่โหลดหลัง render หลัก ไม่บล็อกหน้า
const DOW_TH = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const biCache = new Map();
let lastGroups = null, lastDwellRows = [], biCatKey = '';

async function biHeatCells(catIds) {
  // pattern-heatmap อ่านจาก rollup 30 นาที (~0.3s) — endpoint heatmap เดิม scan
  // events ดิบ 28 วัน วัดจริง >60s ใช้บนหน้าไม่ได้ · รับหลาย id ทีเดียว
  const url = `/api/stats/pattern-heatmap?days=28${scopeParam()}`
    + (catIds ? `&category_ids=${catIds.join(',')}` : '');
  if (biCache.has(url)) return biCache.get(url);
  const cells = (await jget(url)).cells;
  biCache.set(url, cells);
  return cells;
}

function renderHeat(cells) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let max = 0;
  for (const c of cells) { grid[c.dow][c.hour] = c.count; if (c.count > max) max = c.count; }
  const short = (v) => !v ? '' : v >= 10000 ? `${Math.round(v / 1000)}k`
    : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
  $('#biHeatBody').innerHTML = `<div class="bi-heatwrap"><table class="bi-heat">
    <tr><th></th>${[...Array(24).keys()].map((h) => `<th>${String(h).padStart(2, '0')}</th>`).join('')}</tr>
    ${grid.map((r, d) => `<tr><th>${DOW_TH[d]}</th>${r.map((v, h) => {
      const a = max ? v / max : 0;
      return `<td title="${DOW_TH[d]} ${String(h).padStart(2, '0')}:00 น. · ${fmt(v)} เหตุการณ์"
        style="background:rgba(53,100,214,${(a * 0.92).toFixed(3)});color:${a > 0.55 ? '#fff' : 'var(--dim)'}">${short(v)}</td>`;
    }).join('')}</tr>`).join('')}
  </table></div>
  <div class="bi-note">ช่องเข้มสุด = ${fmt(max)} เหตุการณ์ · เอา metric event (counter) ออกแล้วเมื่อดูทุกหมวด</div>`;
}

const fmtDur = (s) => s == null ? '–' : s < 60 ? `${s} วิ`
  : s < 3600 ? `${(s / 60) | 0} น. ${s % 60} วิ` : `${(s / 3600) | 0} ชม. ${Math.round((s % 3600) / 60)} น.`;

function renderDwellRows(rows) {
  lastDwellRows = rows;
  if (!rows.length) {
    $('#biDwellBody').innerHTML = '<div class="bi-note">ไม่มีเหตุการณ์โซน (FieldDetector) ในช่วง/ขอบเขตที่เลือก</div>';
    return;
  }
  const top = [...rows].sort((a, b) => b.episodes - a.episodes).slice(0, 8);
  $('#biDwellBody').innerHTML = `<div class="smwrap"><table class="sitematrix bi-dwell">
    <tr><th>โซน (rule)</th><th>กล้อง</th><th>จำนวนครั้ง</th><th>อยู่นานเฉลี่ย</th><th>นานสุด</th><th>รวมเวลา</th></tr>
    ${top.map((r) => `<tr><td>${r.rule_name || '(ไม่มีชื่อ)'}</td><td>${r.camera_id}</td>
      <td>${fmt(r.episodes)}</td><td>${fmtDur(r.avg_sec)}</td><td>${fmtDur(r.max_sec)}</td>
      <td>${fmtDur(r.total_sec)}</td></tr>`).join('')}
  </table></div>${rows.length > 8 ? `<div class="bi-note">แสดง 8 จาก ${rows.length} โซน (เรียงตามจำนวนครั้ง)</div>` : ''}`;
}

function renderBI() {
  if (!lastData) return;
  for (const [key, cardId] of [['bi-heat', '#biHeatCard'], ['bi-dwell', '#biDwellCard']]) {
    const card = $(cardId);
    if (!card) continue;
    card.querySelector('[data-collapse]').textContent = collapsedGroups.has(key) ? 'แสดง ▸' : 'ซ่อน ▾';
  }
  $('#biHeatBody').hidden = collapsedGroups.has('bi-heat');
  $('#biDwellBody').hidden = collapsedGroups.has('bi-dwell');
  // เติม dropdown หมวด (การ์ด merge แล้ว) — สร้างใหม่เฉพาะเมื่อรายการเปลี่ยน
  const cats = (lastGroups || []).flatMap((g) => g.cards).map((c) => ({ base: c.base, ids: c.ids }));
  const k = cats.map((c) => c.base).join('|');
  if (k !== biCatKey) {
    biCatKey = k;
    const cur = $('#biHeatCat').value;
    $('#biHeatCat').innerHTML = `<option value="">ทุกหมวด</option>` +
      cats.map((c) => `<option value="${c.ids.join(',')}">${c.base}</option>`).join('');
    if ([...$('#biHeatCat').options].some((o) => o.value === cur)) $('#biHeatCat').value = cur;
  }
  if (!collapsedGroups.has('bi-heat')) {
    const sel = $('#biHeatCat').value;
    biHeatCells(sel ? sel.split(',').map(Number) : null).then(renderHeat)
      .catch((e) => { $('#biHeatBody').textContent = `โหลด heatmap ไม่สำเร็จ: ${e.message}`; });
  }
  if (!collapsedGroups.has('bi-dwell')) {
    const { cur } = lastData;
    const url = `/api/stats/dwell?from=${cur[0].toISOString()}&to=${cur[1].toISOString()}${scopeParam()}`;
    const key = `dwell|${url}`;
    (biCache.has(key) ? Promise.resolve(biCache.get(key)) : jget(url).then((r) => { biCache.set(key, r); return r; }))
      .then(renderDwellRows)
      .catch((e) => { $('#biDwellBody').textContent = `โหลด dwell ไม่สำเร็จ: ${e.message}`; });
  }
}

// ── CSV export (BI) — สร้างฝั่งเบราว์เซอร์จากข้อมูลที่โหลดแล้ว ─────────────
function dlCsv(name, rows) {
  const csv = rows.map((r) => r.map((v) => {
    v = String(v ?? '');
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}
function exportGroupCsv(key) {
  const g = (lastGroups || []).find((x) => x.key === key);
  if (!g) return;
  const rows = [['หมวด', 'รวม', 'ช่วงเทียบ', 'เข้า', 'ออก']];
  for (const c of g.cards) rows.push([c.base, c.total, c.prev, c.io?.IN ?? '', c.io?.OUT ?? '']);
  for (const x of (g.extras || [])) rows.push([x.base, x.total, x.prev ?? '', '', '']);
  dlCsv(`stats_${key}_${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

document.addEventListener('click', (ev) => {
  const pp = ev.target.closest('#periodPills button');
  if (pp) { period = pp.dataset.p; renderPills(); if (period !== 'custom') refresh(); return; }
  const sp = ev.target.closest('#sitePills button');
  if (sp) { siteSel = sp.dataset.id || null; renderPills(); refresh(); return; }
  const gp = ev.target.closest('#groupPills button');
  if (gp) { groupSel = gp.dataset.gid || null; renderPills(); refresh(); return; }
  const mx = ev.target.closest('[data-mxmode]');
  if (mx) { const [k, m] = mx.dataset.mxmode.split('|');
    matrixMode.set(k, m); if (lastData) render(lastData); return; }
  const csv = ev.target.closest('[data-csv],[data-csv-group]');
  if (csv) {
    if (csv.dataset.csvGroup) exportGroupCsv(csv.dataset.csvGroup);
    else if (csv.dataset.csv === 'dwell') dlCsv(`dwell_${new Date().toISOString().slice(0, 10)}.csv`,
      [['โซน', 'กล้อง', 'ครั้ง', 'เฉลี่ย(วิ)', 'นานสุด(วิ)', 'รวม(วิ)'],
        ...lastDwellRows.map((r) => [r.rule_name, r.camera_id, r.episodes, r.avg_sec, r.max_sec, r.total_sec])]);
    return; }
  // ยุบ/กางกลุ่ม — ต้องมาก่อน .group-view button (ปุ่มอยู่ใน span เดียวกัน)
  const fold = ev.target.closest('[data-collapse]');
  if (fold) { const k = fold.dataset.collapse;
    if (collapsedGroups.has(k)) { collapsedGroups.delete(k); restoreCollapseStash(k); }
    else collapsedGroups.add(k);
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsedGroups]));
    if (lastData) render(lastData); return; }
  const tool = ev.target.closest('[data-tool]');
  if (tool) {
    if (tool.dataset.tool === 'expand') { expanded = !expanded; refresh(); return; }
    if (tool.dataset.tool === 'clear') { selected = new Set(); selectedDir.clear(); selectedExtra.clear();
      // ล้างทั้งหมด = ล้าง stash ของกลุ่มที่ยุบด้วย ไม่งั้นกางกลับแล้วเส้นเก่าฟื้นทั้งที่ผู้ใช้เพิ่งล้าง
      Object.keys(collapseStash).forEach((k) => delete collapseStash[k]); }
    else { selected = window._demoDefaults ? window._demoDefaults() : null; selectedDir.clear(); selectedExtra.clear(); }
    if (lastData) render(lastData); return; }
  const gv = ev.target.closest('.group-view button');
  if (gv) { const k = gv.dataset.g;
    if (gv.dataset.view === 'matrix') matrixOn.add(k); else matrixOn.delete(k);
    if (lastData) render(lastData); return; }
  const db = ev.target.closest('[data-dirbtn]');
  if (db) { ev.stopPropagation();
    const k = db.dataset.dirbtn;
    if (selectedDir.has(k)) selectedDir.delete(k); else selectedDir.add(k);
    // ขึ้นเส้นทิศ = ผู้ใช้กำลังสนใจหมวดนี้ — เปิดเส้นรวมให้ด้วยถ้ายังไม่เปิด
    const base = k.split('|')[0];
    if (selected && !selected.has(base)) selected.add(base);
    if (lastData) render(lastData); return; }
  const xc = ev.target.closest('.kpi[data-extra]');
  if (xc) { const b = xc.dataset.extra;
    if (selectedExtra.has(b)) selectedExtra.delete(b); else selectedExtra.add(b);
    if (lastData) render(lastData); return; }
  const card = ev.target.closest('.kpi[data-base]');
  if (card) { const b = card.dataset.base;
    if (selected.has(b)) selected.delete(b); else selected.add(b);
    if (lastData) render(lastData); return; }
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'ghostChk') { showGhost = ev.target.checked; if (lastData) render(lastData); }
});
$('#biHeatCat').addEventListener('change', renderBI);
$('#cGo').addEventListener('click', () => {
  customFrom = $('#cFrom').value || null; customTo = $('#cTo').value || null;
  if (customFrom && customTo) refresh();
});

(async () => {
  try {
    const [sites, groups, cams] = await Promise.all([
      jget('/api/sites'), jget('/api/groups'), jget('/api/cameras')]);
    SITES = Array.isArray(sites) ? sites : (sites.sites || []);
    GROUPS_CAM = Array.isArray(groups) ? groups : (groups.groups || []);
    const camList = Array.isArray(cams) ? cams : (cams.cameras || []);
    CAM_SITE = new Map(camList.map((c) => [c.id ?? c.camera_id, c.site_id]));
  } catch (e) { console.error('bootstrap:', e); }
  renderPills();
  await refresh();
})();
