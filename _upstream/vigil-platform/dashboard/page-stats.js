// ============================================================
// Vigil Platform — Event Statistics (redesign 2026-08)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// แทนหน้า Statistics เดิมทั้งหน้า — port จาก demo ที่เจ้าของอนุมัติ
// (public/others/demo/dashboard/stats-demo.js) · ต่างจาก demo:
//   - จัดกลุ่ม override อ่าน stat_group จาก DB (migration 183) ไม่ใช่ localStorage
//   - การ์ดยานพาหนะ "อัตโนมัติ" จาก /api/stats/vehicle-cards (traffic_hourly_stats
//     normalize สอง vendor แล้ว) — ไซต์ที่มี LPR ได้การ์ดเองโดยไม่ต้องสร้างหมวด
//   - contract เดิมของ dashboard: loadStats() / invalidateStats() / renderOccupancy stub
// ⚠️ i18n: ข้อความหน้านี้ยังเป็นไทยล้วน (ตาม demo ที่อนุมัติ) — extraction เข้า
// i18n.js เป็นงานค้างใน ROADMAP
// ============================================================
'use strict';

const _es$ = (s) => document.querySelector(s);
const _esT = (k, vars) => Object.entries(vars || {})
  .reduce((t, [x, v]) => t.replace('{' + x + '}', v), I18N.t(k));
const _esFmt = (n) => Math.round(n || 0).toLocaleString('th-TH');

let _ES_SITES = [], _esGROUPS_CAM = [], _esCAM_SITE = new Map();   // camera_id → site_id
let _esSiteSel = null, _esGroupSel = null;
let _esPeriod = 'today', _esCustomFrom = null, _esCustomTo = null;
// trunc → วินาทีต่อถัง (ส่งให้ /api/stats/vehicle-cards ตัดสินใจอ่านสรุปหรือนับสด)
const _ES_TRUNC_SEC = { minute2_5: 150, minute5: 300, minute30: 1800, hour: 3600, day: 86400 };
// ⚠️ ทุก Set ข้างล่างเก็บ **คีย์ "กลุ่ม+ชื่อ"** จาก StatsSel ไม่ใช่ชื่อการ์ดเปล่า ๆ
// ชื่อซ้ำกันข้ามกลุ่มได้จริง (หมวดที่ผู้ใช้สร้างเองชนกับการ์ดยานพาหนะอัตโนมัติ)
// ถ้าจำด้วยชื่อ การยุบกลุ่มหนึ่งจะลบเส้นของอีกกลุ่มทิ้ง — ดู stats-selection.js
let _esSelected = null;        // Set ของคีย์ที่ขึ้นกราฟหลัก (null = ยังไม่แตะ → ค่าเริ่มต้น)
let _esSelectedDir = new Set(); // คีย์ + ทิศ (IN/OUT) — เส้นรายทิศที่ถูกกดเพิ่ม
let _esSelectedExtra = new Set(); // การ์ดพิเศษ (หมวก/เข็มขัด/แจ้งเตือน) ที่ขึ้นกราฟ
let _esShowGhost = false;         // v15: default ปิดเส้นเทียบ (เจ้าของสั่ง 2026-08-28)
let _esExpanded = false;          // v14: ปุ่มขยายความละเอียดถังเวลา (ต่อช่วงที่รองรับ)
let _esMatrixOn = new Set();   // group key ที่เปิดมุมมองตาราง
let _esMatrixMode = new Map(); // group key → 'sum' | 'IN' | 'OUT' (ตารางไซต์)
let _esCharts = [], _esLastData = null;

// v13: ยุบ/กางกลุ่ม — สถานะยุบจำข้าม reload · เส้นที่ถูกถอดตอนยุบเก็บใน stash
// (เฉพาะ session) คืนให้อัตโนมัติตอนกางกลับ
const _ES_COLLAPSE_KEY = 'vigil_stats_collapsed';
let _esCollapsedGroups = new Set((() => {
  try { return JSON.parse(localStorage.getItem(_ES_COLLAPSE_KEY) || '[]'); } catch { return []; }
})());
const _esCollapseStash = {};
function _esRestoreCollapseStash(key) {
  const st = _esCollapseStash[key];
  if (!st) return;
  st.bases.forEach((b) => _esSelected && _esSelected.add(b));
  st.dirs.forEach((x) => _esSelectedDir.add(x));
  st.extras.forEach((x) => _esSelectedExtra.add(x));
  delete _esCollapseStash[key];
}

// ── ช่วงเวลา + ช่วงเทียบ ───────────────────────────────────────────────────
// i18n: setLang() ของระบบ reload ทั้งหน้า — resolve ข้อความตอน parse ได้เลย
const _ES_PERIODS = [
  { key: 'hour',   name: I18N.t('es.perHour'),   cmpName: I18N.t('es.cmpHour') },
  { key: 'today',  name: I18N.t('es.perToday'),  cmpName: I18N.t('es.cmpYday') },
  { key: 'yday',   name: I18N.t('es.perYday'),   cmpName: I18N.t('es.cmpDayBefore') },
  { key: 'week',   name: I18N.t('es.perWeek'),   cmpName: I18N.t('es.cmpPrevWeek') },
  { key: 'custom', name: I18N.t('es.perCustom'), cmpName: I18N.t('es.cmpPrevEqual') },
];

function _esWindows() {
  const now = new Date();
  const day0 = (off) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
  let cur, cmp;
  if (_esPeriod === 'hour') {
    // "ชั่วโมงล่าสุด" = rolling 60 นาทีย้อนจากตอนนี้ snap ขอบถัง 5 นาที — วิธีของ
    // หน้าเดิม (commit e114351) ที่เอากลับมา 2026-08-30: ชั่วโมงปฏิทินทำให้เปิดดู
    // ตอนนาทีที่ 5 แล้วกราฟว่างโดยนิยาม · ขอบบน = ถังปัจจุบัน+1 ให้วงแหวน
    // "กำลังเก็บ" อยู่ท้ายเส้นพอดี
    const to = new Date(Math.ceil(now.getTime() / 300e3) * 300e3);
    const from = new Date(to.getTime() - 3600e3);
    cur = [from, to];
    // ← เทียบ "ช่วงเดียวกันของเมื่อวาน" ไม่ใช่ชั่วโมงก่อนหน้า (สั่งไว้ชัด)
    cmp = [new Date(from.getTime() - 86400e3), new Date(to.getTime() - 86400e3)];
  } else if (_esPeriod === 'today') {
    cur = [day0(0), now];
    cmp = [day0(-1), day0(0)];
  } else if (_esPeriod === 'yday') {
    cur = [day0(-1), day0(0)];
    cmp = [day0(-2), day0(-1)];
  } else if (_esPeriod === 'week') {
    cur = [day0(-6), now];
    cmp = [day0(-13), day0(-6)];
  } else {
    const f = _esCustomFrom ? new Date(_esCustomFrom + 'T00:00:00') : day0(-2);
    const t = _esCustomTo ? new Date(new Date(_esCustomTo + 'T00:00:00').getTime() + 86400e3) : day0(0);
    const span = t - f;
    cur = [f, t];
    cmp = [new Date(f.getTime() - span), new Date(f)];
  }
  const spanH = (cur[1] - cur[0]) / 3600e3;
  // v14 ตามสเปกเจ้าของ: ชั่วโมงนี้ = 5 นาที (expand → 2.5 นาที) ·
  // วันนี้/เมื่อวาน = รายชั่วโมง (expand → 30 นาที) · หลายวัน = รายวันเสมอ
  let trunc;
  if (_esPeriod === 'hour') trunc = _esExpanded ? 'minute2_5' : 'minute5';
  else if (_esPeriod === 'today' || _esPeriod === 'yday') trunc = _esExpanded ? 'minute30' : 'hour';
  else trunc = spanH <= 2 ? 'minute5' : spanH <= 48 ? 'hour' : 'day';
  return { cur, cmp, trunc };
}
const _ES_STEP_MS = { minute2_5: 150e3, minute5: 300e3, minute30: 1800e3, hour: 3600e3, day: 86400e3 };
// expand ได้เฉพาะช่วงที่มีถังละเอียดกว่าให้ลง — หลายวัน/กำหนดเองคงรายวันตามสเปก
const _ES_EXPANDABLE = { hour: I18N.t('es.u2_5min'), today: I18N.t('es.u30min'), yday: I18N.t('es.u30min') };

// ── กลุ่มตายตัว (v3 ตามสเปกเจ้าของ 2026-08-28) — ไม่ต้องตั้งค่าเอง ──────────
// ระบบดูจากหมวด/กล้องที่มีจริง: หมวดไหนไม่มีข้อมูลในไซต์นั้นก็ไม่ขึ้นเอง
//
// "นับคน" ทุกหมวด (People Counting / นับคน) ถูกรวบเป็นการ์ดเดียวชื่อ
// "คนผ่านหน้ากล้อง (นับรวม)" — ชื่อจงใจสื่อว่าเป็น "ครั้งที่ตรวจพบ" ไม่ใช่ยอด
// คนเข้าอาคาร และไม่แยกเข้า-ออก · จำนวนกล้องที่ตรวจจับคนได้โชว์ในการ์ด
// (auto จาก cameras_seen ของหมวดพวกนั้นเอง ไม่ต้องไปตั้งรายชื่อกล้อง)
const _ES_PEOPLE_COUNT_RE = /^(people counting|นับคน)$/i;
const _ES_PEOPLE_COUNT_NAME = 'คนผ่านหน้ากล้อง (นับรวม)';

// หมวดพ้องความหมายข้ามไซต์ — บางไซต์ตั้งชื่ออังกฤษ (Motorcycle ของ RMUTR-V)
// แต่มันคือหมวดตายตัวเดียวกับ "รถจักรยานยนต์" · รวมเป็นการ์ด/แถวเดียว
// ไม่งั้นตารางแยกตามไซต์จะมีสองแถวของของเดียวกัน (เจ้าของทัก 2026-08-28)
// จับคู่ด้วยชื่อเต็มตัวพิมพ์เล็กเท่านั้น — ห้ามใช้ substring (จักรยาน ⊂ รถจักรยานยนต์)
const _ES_CANON = new Map(Object.entries({
  'motorcycle': 'รถจักรยานยนต์', 'car': 'รถยนต์', 'truck': 'รถบรรทุก',
  'bus': 'รถบัส', 'bicycle': 'จักรยาน', 'van': 'รถตู้', 'pickup': 'รถกระบะ',
  'crosswalk': 'คนข้ามถนน',
}));
// หมวดตายตัวของระบบ — ที่เหลือคือหมวดที่ผู้ใช้สร้างเอง (ติดป้าย "กำหนดเอง")
const _ES_FIXED_SET = new Set(['รถจักรยานยนต์', 'รถยนต์', 'รถกระบะ', 'รถตู้', 'รถบรรทุก',
  'รถบัส', 'จักรยาน', 'SUV/MPV', 'รถสามล้อพ่วงข้าง', 'รถประเภทอื่นๆ',
  'ป้ายทะเบียน', 'ใบหน้า', _ES_PEOPLE_COUNT_NAME, 'บุคคลเฝ้าระวัง', 'คนข้ามถนน']);

// default ของเส้นบนกราฟ: ชุดตายตัวที่เหมือนกันทุกวัน (top6 เปลี่ยนตามข้อมูล =
// เปิดมาแต่ละวันเห็นไม่เหมือนเดิม ไม่เหมาะกับ monitoring) · ล้างหมดได้
const _ES_DEFAULT_SELECTION = ['รถจักรยานยนต์', 'รถยนต์', 'ป้ายทะเบียน', 'ใบหน้า',
  _ES_PEOPLE_COUNT_NAME, 'บุคคลเฝ้าระวัง'];
const _ES_CAT_GROUPS = [
  { key: 'vehicle',  name: I18N.t('es.grpVehicle'),
    test: (n) => /รถ|car|bus|truck|motorcycle|bicycle|จักรยาน|suv|mpv|van/i.test(n)
                 && !/หมวก|helmet|เข็มขัด|belt|เลี้ยว/i.test(n) },
  { key: 'people',   name: I18N.t('es.grpPeople'),
    test: (n) => /คน|people|person|ห้องน้ำ|ตู้เย็น|อาหาร|ข้ามถนน|crosswalk/i.test(n)
                 && !/เฝ้าระวัง/i.test(n) },
  { key: 'identify', name: I18N.t('es.grpIdentify'),
    test: (n) => /ทะเบียน|ใบหน้า|face|plate|lpr/i.test(n) },
  { key: 'watch',    name: I18N.t('es.grpWatch'), test: () => true },
];

// override การจัดกลุ่มมาจากคอลัมน์ stat_group ใน event_categories (migration 183)
// — ติดมากับแถว categories ของ /api/stats/categories อยู่แล้ว ไม่ต้องยิงเพิ่ม
function _esSplitDir(name) {
  const m = /^(.*?)\s*\((IN|OUT)\)\s*$/i.exec(name.trim());
  return m ? [m[1].trim(), m[2].toUpperCase()] : [name.trim(), null];
}

async function _esJget(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

function _esScopeParam() {
  let q = '';
  if (_esSiteSel) q += `&site_id=${_esSiteSel}`;
  if (_esGroupSel) {
    const g = _esGROUPS_CAM.find((x) => String(x.id ?? x.name) === String(_esGroupSel));
    if (g && (g.cameraIds || []).length) q += `&cameras=${encodeURIComponent(g.cameraIds.join(','))}`;
  }
  return q;
}
// /api/lpr/alerts ไม่รับ site_id — แปลงไซต์ที่เลือกเป็นรายชื่อกล้อง (แผนที่มีแล้ว)
// (v15.1: เดิมการ์ด extras ไม่กรองตามไซต์เลย — เลือก Phuket ก็ได้ยอดทั้งระบบ)
function _esAlertScopeParam() {
  if (_esGroupSel) {
    const g = _esGROUPS_CAM.find((x) => String(x.id ?? x.name) === String(_esGroupSel));
    if (g && (g.cameraIds || []).length) return `&cameras=${encodeURIComponent(g.cameraIds.join(','))}`;
  }
  if (_esSiteSel) {
    const cams = [..._esCAM_SITE].filter(([, s]) => String(s) === String(_esSiteSel)).map(([id]) => id);
    if (cams.length) return `&cameras=${encodeURIComponent(cams.join(','))}`;
  }
  return '';
}

// ── โหลด ────────────────────────────────────────────────────────────────────
// จำนวนแจ้งเตือนทะเบียนในช่วง — /api/lpr/alerts รองรับ from/to อยู่แล้ว
// ขอ limit=1 แล้วอ่าน X-Total-Count (ไม่ลากรายการมาทิ้ง)
async function _esAlertCount(from, to) {
  try {
    // limit=200 เอาแถวมาด้วย (event_time) เพื่อวาดเส้นบนกราฟ — ยอดแจ้งเตือนจริง
    // หลักหน่วยถึงหลักสิบต่อวัน 200 เกินพอ · ถ้าวันไหนทะลุ ยอดรวมยังถูก (มาจาก
    // header) แค่เส้นขาดปลาย และจะโชว์หมายเหตุ
    const r = await fetch(`/api/lpr/alerts?from=${from.toISOString()}&to=${to.toISOString()}&limit=200${_esAlertScopeParam()}`,
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
async function _esHelmetHourly(dayDate) {
  try {
    const d = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
    const r = await _esJget(`/api/traffic/helmet-series?date=${d}${_esScopeParam()}`);
    const nh = new Array(24).fill(null), sb = new Array(24).fill(null);
    for (const h of r.hourly || []) if (h.hour != null) {
      nh[h.hour] = Number(h.no_helmet || 0);
      sb[h.hour] = Number(h.no_seatbelt || 0);   // v13: เข็มขัดรายชั่วโมงมาแล้ว
    }
    return { nh, sb };
  } catch { return null; }
}

async function _esLoad() {
  const { cur, cmp, trunc } = _esWindows();
  const iso = (d) => d.toISOString();
  // enforcement ให้ days ครอบทั้งช่วงเลือกและช่วงเทียบ แล้วค่อยตัดจาก daily เอง —
  // เกณฑ์หมวก/เข็มขัดเป็นชุดเดียวกับหน้า "สถิติหมวกนิรภัย" (n_no_helmet ของ
  // lpr_hourly_stats) ตามที่สั่ง ไม่คิดเกณฑ์เองใหม่
  const daysBack = Math.min(60, Math.max(2, Math.ceil((Date.now() - cmp[0].getTime()) / 86400e3) + 1));
  const [catsCur, catsCmp, tlCur, tlCmp, wlCur, wlCmp, enf, nhHrCur, nhHrCmp, vcCur, vcCmp] = await Promise.all([
    _esJget(`/api/stats/categories?from=${iso(cur[0])}&to=${iso(cur[1])}${_esScopeParam()}`),
    _esJget(`/api/stats/categories?from=${iso(cmp[0])}&to=${iso(cmp[1])}${_esScopeParam()}`),
    _esJget(`/api/stats/timeline-by-category?from=${iso(cur[0])}&to=${iso(cur[1])}&trunc=${trunc}${_esScopeParam()}`),
    _esJget(`/api/stats/timeline-by-category?from=${iso(cmp[0])}&to=${iso(cmp[1])}&trunc=${trunc}${_esScopeParam()}`),
    _esAlertCount(cur[0], cur[1]),
    _esAlertCount(cmp[0], cmp[1]),
    _esJget(`/api/traffic/enforcement?days=${daysBack}${_esScopeParam()}`).catch(() => null),
    // โหมดรายชั่วโมงวันเดียว (วันนี้/เมื่อวาน): หมวกมีเส้นรายชั่วโมงจาก helmet-series
    ['hour', 'minute30'].includes(trunc) && (cur[1] - cur[0]) <= 86400e3 ? _esHelmetHourly(cur[0]) : Promise.resolve(null),
    ['hour', 'minute30'].includes(trunc) && (cur[1] - cur[0]) <= 86400e3 ? _esHelmetHourly(cmp[0]) : Promise.resolve(null),
    // step บอก endpoint ว่าแกนละเอียดแค่ไหน — ต่ำกว่าชั่วโมง endpoint สลับไปนับสด
    // จาก license_plates เป็นถังขนาดเดียวกับแกน (ไม่งั้นเส้นวาดไม่ได้ ดู mappable)
    _esJget(`/api/stats/vehicle-cards?from=${iso(cur[0])}&to=${iso(cur[1])}&step=${_ES_TRUNC_SEC[trunc] || 3600}${_esScopeParam()}`).catch(() => null),
    _esJget(`/api/stats/vehicle-cards?from=${iso(cmp[0])}&to=${iso(cmp[1])}&step=${_ES_TRUNC_SEC[trunc] || 3600}${_esScopeParam()}`).catch(() => null),
  ]);
  return { catsCur, catsCmp, tlCur, tlCmp, wlCur, wlCmp, enf, nhHrCur, nhHrCmp, vcCur, vcCmp, cur, cmp, trunc };
}

// รวม daily ของ enforcement ในหน้าต่าง [from,to) → {no_helmet, no_seatbelt, series}
function _esEnfWindow(enf, from, to) {
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
function _esBucketize(tl, from, trunc, n) {
  const stepMs = _ES_STEP_MS[trunc] || 86400e3;
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

function _esLabelsFor(from, n, stepMs, trunc) {
  return [...Array(n).keys()].map((i) => {
    const d = new Date(from.getTime() + i * stepMs);
    if (trunc === 'day') return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
}

// ── ประกอบการ์ด ─────────────────────────────────────────────────────────────
function _esBuildCards(catsCur, catsCmp, curMap, cmpMap, n) {
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
    let [base, dir] = _esSplitDir(c.name);
    if (_ES_PEOPLE_COUNT_RE.test(base)) { base = _ES_PEOPLE_COUNT_NAME; dir = null; }
    base = _ES_CANON.get(base.toLowerCase()) || base;
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
  const grouped = _ES_CAT_GROUPS.map((g) => ({ ...g, cards: [] }));
  // กลุ่มที่ 5: หมวดที่ตั้งไว้ว่า "ไม่รวมกับหมวดพื้นฐาน" (จากหน้า categories.html)
  // ยอดของมันไม่ปนกับ 4 กลุ่มหลัก — เคสกล้อง recheck ที่นับซ้ำ (เจ้าของ 2026-08-28)
  const standalone = { key: 'standalone', name: I18N.t('es.grpStandalone'), cards: [] };
  const ov = {};
  for (const c of catsCur.categories || []) if (c.stat_group) ov[c.id] = c.stat_group;
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

// ── การ์ดยานพาหนะอัตโนมัติ (จาก traffic_hourly_stats — ไม่พึ่ง event_categories) ──
// ชื่อไทยตรง canonical เดิม ⇒ หมวด category ชื่อเดียวกันที่ยังเหลือ (RMUTR-V/Bosch
// ซึ่งไม่ใช่ LPR จึงไม่นับซ้ำกัน) จะรวมเป็นการ์ดเดียวเหมือนหมวดข้ามไซต์
const _ES_VT_TH = { twoWheelVehicle: 'รถจักรยานยนต์', vehicle: 'รถยนต์', SUVMPV: 'SUV/MPV',
  pickupTruck: 'รถกระบะ', van: 'รถตู้', truck: 'รถบรรทุก', largeBus: 'รถบัส',
  threeWheelVehicle: 'รถสามล้อพ่วงข้าง' };
// สีประจำประเภทรถ — categorical palette ที่วัดระยะห่างเชิงการมองเห็นแล้ว
// (เจ้าของทัก 2026-08-30 รอบสอง: เปิดหลายเส้นพร้อมกันแล้วแยกไม่ออก เพราะชุดเดิม
// เกาะโซนเย็นทั้ง teal/เขียว/น้ำเงิน) · วัดด้วย ΔE ใน CIELab ทุกคู่:
// ชุดเดิมคู่แย่สุด ΔE 17.4 (บัส↔สามล้อ) → ชุดนี้ 36.0 · ค่ากลาง 77.6
// หลักการจัด: ไล่ hue สลับโซนอุ่น/เย็นตามลำดับปริมาณ เพื่อให้เส้นที่มักเปิดคู่กัน
// (จยย. → SUV → รถยนต์ → กระบะ → ตู้) ห่างกันมากที่สุด · "อื่นๆ" เป็นเทาโดยตั้งใจ
// ⚠️ ต้องตรงกับ CLASSES ใน public/others/demo/emission-rate/emission.js
const _ES_VT_COLOR = { 'รถจักรยานยนต์': '#1f77b4', 'SUV/MPV': '#f57c00', 'รถยนต์': '#2ca02c',
  'รถกระบะ': '#9467bd', 'รถตู้': '#d946a6', 'รถบัส': '#d62728', 'รถบรรทุก': '#6d4c41',
  'รถสามล้อพ่วงข้าง': '#c0a000', 'รถประเภทอื่นๆ': '#9aa5b1' };
function _esMergeVehicleCards(grouped, d, stepMs, n) {
  if (!d.vcCur) return;
  const veh = grouped.find((g) => g.key === 'vehicle');
  const put = (arr, points, from) => {
    for (const p of points || []) {
      const i = Math.round((new Date(p.t) - from) / stepMs);
      if (i >= 0 && i < n) arr[i] = (arr[i] || 0) + p.n;
    }
  };
  const byBase = new Map();
  const fold = (resp, slot) => {
    for (const c of resp?.cards || []) {
      if (c.vehicle_type === 'pedestrian') continue;   // คนเดินผ่านกล้อง ANPR ไม่ใช่ยานพาหนะ
      const base = _ES_VT_TH[c.vehicle_type] || 'รถประเภทอื่นๆ';
      if (!byBase.has(base)) byBase.set(base, {
        cur: { total: 0, pts: [], cams: new Set() }, cmp: { total: 0, pts: [], cams: new Set() } });
      const s = byBase.get(base)[slot];
      s.total += c.total; s.pts.push(c.series);
      (c.cameras_seen || []).forEach((x) => s.cams.add(x));
    }
  };
  fold(d.vcCur, 'cur'); fold(d.vcCmp, 'cmp');
  // series ของ traffic_hourly ละเอียดสุด "รายชั่วโมง" — แกนที่ละเอียดกว่านั้น
  // (ชั่วโมงนี้ = ถัง 5/2.5 นาที) ห้าม map ลงถัง: ยอดทั้งชั่วโมงจะกองที่ถังแรก
  // แล้ววาดเส้นดิ่งหลอก (เห็นจริง 2026-08-30 ตี 1 — จยย. 1,010 โผล่ที่ช่อง 01:00
  // แล้วดิ่งศูนย์) · ยอดการ์ด/pill ยังครบ เส้นคงเหลือเฉพาะส่วนที่มีข้อมูลถี่จริง
  const mappable = stepMs >= 3600e3 || String(d.vcCur?.trunc || '').startsWith('second');
  for (const [base, v] of byBase) {
    let card = veh.cards.find((x) => x.base === base);
    // สีประจำประเภทชนะเสมอ — การ์ดที่เกิดจากหมวด category ก่อน (เช่น จยย. RMUTR-V)
    // พกสี auto ของหมวดมา ซึ่งสุ่มแล้วชนกันเองได้ (รถยนต์เคยได้ olive ชน SUV)
    if (card && _ES_VT_COLOR[base]) card.color = _ES_VT_COLOR[base];
    if (!card) {
      card = { base, color: _ES_VT_COLOR[base] || '#5b8def', total: 0, prev: 0, io: {}, dirs: {},
        ids: [], cur: new Array(n).fill(null), cmp: new Array(n).fill(null), camSeen: [], auto: true };
      veh.cards.push(card);
    }
    card.total += v.cur.total; card.prev += v.cmp.total;
    if (mappable) {
      v.cur.pts.forEach((ps) => put(card.cur, ps, d.cur[0]));
      v.cmp.pts.forEach((ps) => put(card.cmp, ps, d.cmp[0]));
    }
    card.camSeen.push(...v.cur.cams);
  }
  veh.cards.sort((a, b) => (b.total - a.total) || (b.prev - a.prev) || a.base.localeCompare(b.base, 'th'));
}

// ── การ์ดตายตัวของกลุ่ม "เฝ้าระวังและอื่น ๆ" (v3) ───────────────────────────
// สามใบนี้ไม่ใช่ event category — มาจากแหล่งของมันเองโดยตรง:
//   แจ้งเตือนทะเบียน = /api/lpr/alerts (X-Total-Count สองช่วง)
//   หมวก/เข็มขัด     = /api/traffic/enforcement.daily ตัดตามช่วง — เกณฑ์เดียว
//                      กับหน้า "สถิติหมวกนิรภัย" เป๊ะ ไม่คิดเกณฑ์ใหม่
// การ์ดพวกนี้คลิกขึ้นกราฟหลักไม่ได้ (ไม่มี timeline ราย bucket) จึงไม่ใส่ data-base
function _esWatchExtras(d, align) {
  const per = _ES_PERIODS.find((x) => x.key === _esPeriod);
  const dayBased = _esPeriod !== 'hour';
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
  // แปลง series รายวัน (จาก _esEnfWindow) ให้ตรงตำแหน่ง bucket รายวัน
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
    out.push({ kind: 'extra', base: I18N.t('es.xPlateAlerts'), color: '#d68a1f',
      total: d.wlCur.n, prev: d.wlCmp?.n,
      line: bucketTimes(d.wlCur.times, d.cur[0]), lineCmp: bucketTimes(d.wlCmp?.times, d.cmp[0]),
      // sparkline ใช้ bucket เดียวกับกราฟหลัก (v8 — เดิมการ์ดนี้ไม่มีกราฟเลย)
      get spark() { return this.line; }, get sparkCmp() { return this.lineCmp; },
      note: I18N.t('es.xPlateNote')
        + (d.wlCur.n > d.wlCur.times.length ? I18N.t('es.xPlateCap') : '') });
  }
  const curW = dayBased ? _esEnfWindow(d.enf, d.cur[0], d.cur[1]) : null;
  const cmpW = dayBased ? _esEnfWindow(d.enf, d.cmp[0], d.cmp[1]) : null;
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
    out.push({ kind: 'extra', base: I18N.t('es.xNoHelmet'), color: '#d64545',
      total: curW.no_helmet, prev: cmpW?.no_helmet ?? 0,
      // โหมดวันเดียว nhSeries มีจุดเดียว → sparkline หาย · ใช้เส้น bucket แทน (v8)
      spark: nhLine || curW.nhSeries, sparkCmp: nhLineCmp || cmpW?.nhSeries,
      line: nhLine, lineCmp: nhLineCmp,
      note: I18N.t('es.xHelmetNote') });
    // v13: โหมดรายชั่วโมงใช้ sb จาก helmet-series (endpoint ขยายให้แล้ว) — เกณฑ์
    // เดียวกับ enforcement (sum เปล่า ไม่กรองชนิดรถ) การ์ดจึงมีกราฟทุกโหมดแบบหมวก
    const sbLine = hourlyMode ? hr2buckets(d.nhHrCur?.sb)
      : align?.trunc === 'day' ? alignDaily(curW.byDate, d.cur[0], (v) => v.sb) : null;
    const sbLineCmp = hourlyMode ? hr2buckets(d.nhHrCmp?.sb)
      : align?.trunc === 'day' ? alignDaily(cmpW?.byDate, d.cmp[0], (v) => v.sb) : null;
    out.push({ kind: 'extra', base: I18N.t('es.xNoBelt'), color: '#b4453c',
      total: curW.no_seatbelt, prev: cmpW?.no_seatbelt ?? 0,
      spark: sbLine || curW.sbSeries, sparkCmp: sbLineCmp || cmpW?.sbSeries,
      line: sbLine, lineCmp: sbLineCmp,
      note: I18N.t('es.xBeltNote') });
  } else if (!dayBased) {
    out.push({ kind: 'note',
      text: I18N.t('es.xEnfDayOnly') });
  } else {
    // enforcement โหลดไม่สำเร็จ (catch → null) — บอกตรง ๆ ดีกว่าการ์ดหายเงียบ
    out.push({ kind: 'note',
      text: I18N.t('es.xEnfFail') });
  }
  if (d.wlCur == null) {
    out.push({ kind: 'note',
      text: I18N.t('es.xAlertFail') });
  }
  void per;
  return out;
}

const _esCmpBadge = (cur, prev) => {
  if (!prev) return { cls: 'flat', txt: cur ? I18N.t('es.newTag') : '—' };
  const pct = (cur - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return { cls: 'flat', txt: I18N.t('es.flatTag') };
  return { cls: pct > 0 ? 'up' : 'down', txt: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%` };
};

// ── ตาราง หมวด×ไซต์ ─────────────────────────────────────────────────────────
function _esSiteMatrix(g) {
  const mode = _esMatrixMode.get(g.key) || 'sum';
  // มีปุ่มสลับเฉพาะกลุ่มที่มีข้อมูลทิศจริง (เข้า/ออกมาจากหมวด (IN)/(OUT))
  const hasDir = g.cards.some((c) => c.dirs && (c.dirs.IN || c.dirs.OUT));
  const rows = g.cards.map((c) => {
    const src = mode === 'sum' ? c.camSeen : (c.dirs?.[mode]?.camSeen || []);
    const per = new Map();
    for (const cs of src) {
      const sid = _esCAM_SITE.get(cs.camera_id);
      if (sid != null) per.set(sid, (per.get(sid) || 0) + Number(cs.count || 0));
    }
    const total = mode === 'sum' ? c.total : (c.dirs?.[mode]?.total || 0);
    return { base: c.base, color: c.color, total, per };
  }).filter((r) => mode === 'sum' || r.total > 0);
  // โชว์เฉพาะไซต์ที่มีข้อมูลในกลุ่มนี้จริง — คอลัมน์ศูนย์ล้วนไม่ช่วยอะไร
  const activeSites = _ES_SITES.filter((s) => rows.some((r) => r.per.get(s.id)));
  const maxCell = Math.max(1, ...rows.flatMap((r) => activeSites.map((s) => r.per.get(s.id) || 0)));
  const modeBar = hasDir ? `<div class="mx-modes">
      ${[['sum', I18N.t('es.mxSum')], ['IN', I18N.t('es.in')], ['OUT', I18N.t('es.out')]].map(([k, th]) =>
        `<button data-mxmode="${g.key}|${k}" class="${mode === k ? 'on' : ''}">${th}</button>`).join('')}
      <span class="mx-note">${mode === 'sum' ? '' : I18N.t('es.mxDirOnly')}</span>
    </div>` : '';
  return `${modeBar}<div class="smwrap"><table class="sitematrix">
    <thead><tr><th>${I18N.t('es.mxCat')}</th>${activeSites.map((s) => `<th>${s.name || s.code}</th>`).join('')}<th>${I18N.t('es.mxSum')}</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td style="--kc:${r.color}">${r.base}</td>
      ${activeSites.map((s) => { const v = r.per.get(s.id) || 0;
        return `<td class="${v ? '' : 'zero'}">${v ? _esFmt(v) : '·'}
          ${v ? `<span class="cellbar" style="--kc:${r.color};width:${Math.max(4, v / maxCell * 100).toFixed(0)}%"></span>` : ''}</td>`; }).join('')}
      <td class="tot">${_esFmt(r.total)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

// ── วาด ─────────────────────────────────────────────────────────────────────
function _esRender(d) {
  _esCharts.forEach((c) => c.destroy()); _esCharts = [];
  const { cur, cmp, trunc } = d;
  const spanMs = cur[1] - cur[0];
  const stepMs = _ES_STEP_MS[trunc] || 86400e3;
  // จำนวน bucket คิดจากความยาวเต็มของช่วง (วันนี้ = ทั้งวัน แม้ยังไม่ถึง) เพื่อให้
  // เส้นเทียบลากเต็มช่วงเสมอ — คือหัวใจของ "เห็นว่าที่เหลือของวันควรเป็นยังไง"
  const fullSpan = _esPeriod === 'today' ? 86400e3 : _esPeriod === 'hour' ? 3600e3 : spanMs;
  const n = Math.max(1, Math.ceil(fullSpan / stepMs));
  const curB = _esBucketize(d.tlCur, cur[0], trunc, n);
  const cmpB = _esBucketize(d.tlCmp, cmp[0], trunc, n);
  const groups = _esBuildCards(d.catsCur, d.catsCmp, curB.map, cmpB.map, n);
  _esMergeVehicleCards(groups, d, stepMs, n);
  // การ์ดตายตัวของกลุ่มเฝ้าระวัง (แจ้งเตือนทะเบียน / หมวก / เข็มขัด)
  const extras = _esWatchExtras(d, { n, stepMs, trunc });
  const watchGroup = groups.find((g) => g.key === 'watch');
  watchGroup.extras = extras.filter((x) => x.kind === 'extra');
  watchGroup.extraNote = extras.filter((x) => x.kind === 'note').map((x) => x.text).join(' · ') || null;
  // v16.1: การ์ดที่ไม่มีข้อมูลทั้งช่วงเลือกและช่วงเทียบ → ซ่อน (เจ้าของสั่ง 2026-08-29
  // — กลับนโยบาย "หมวด 0 ต้องแสดง" ของวันก่อน) · ถ้า cur=0 แต่ prev มี ยังแสดง
  // เพราะ "หายไปจากเมื่อวาน" คือสัญญาณ ไม่ใช่ความว่าง
  for (const g of groups) g.cards = g.cards.filter((c) => c.total || c.prev);
  watchGroup.extras = watchGroup.extras.filter((x) => x.total || x.prev);
  const visGroups = groups.filter((g) => g.cards.length || (g.extras && g.extras.length) || g.extraNote);
  const labels = _esLabelsFor(cur[0], n, stepMs, trunc);
  const per = _ES_PERIODS.find((p) => p.key === _esPeriod);
  // v15: ปิดเส้นเทียบอยู่ = หัวข้อห้ามพูดว่า "เทียบ..." (เจ้าของทัก — หัวกับกราฟต้องตรงกัน)
  _es$('#esChartCmpTitle').textContent = _esShowGhost ? _esT('es.vs', { c: per.cmpName }) : '';
  _es$('#esCmpNote').innerHTML = _esT('es.vsWith', { c: per.cmpName });

  // ── เลือกหมวดขึ้นกราฟ: default = top 6 · คลิกการ์ด toggle ──
  const entries = StatsSel.allKeys(visGroups);            // { key, group, base, card }
  const entryOf = new Map(entries.map((e) => [e.key, e]));
  const defaults = () => StatsSel.pickDefaults(visGroups, _ES_DEFAULT_SELECTION);
  if (!_esSelected) _esSelected = defaults();
  // ตัด base ที่ไม่มีในขอบเขตปัจจุบัน แต่ **ไม่บังคับเติมกลับเมื่อว่าง** —
  // เลือกว่าง = ความตั้งใจของผู้ใช้ กราฟแสดงข้อความแทน (เจ้าของทักว่า blank ไม่ได้)
  _esSelected = new Set([..._esSelected].filter((k) => entryOf.has(k)));
  // v13: กลุ่มที่ถูกยุบ เส้นของมันต้องหลุดจากกราฟด้วย (เจ้าของสั่ง) — เก็บลง stash
  // เพื่อคืนตอนกางกลับ · ทำในนี้ (ไม่ใช่ตอนคลิก) ให้ invariant คงอยู่ข้าม reload/reset
  StatsSel.applyCollapse(visGroups, _esCollapsedGroups, _esSelected, _esSelectedDir,
                         _esSelectedExtra, _esCollapseStash);
  window._demoDefaults = defaults;   // ให้ปุ่ม "ค่าเริ่มต้น" ใช้
  const chosen = entries.filter((e) => _esSelected.has(e.key));
  // ชื่อซ้ำข้ามกลุ่ม = สองเส้นชื่อเดียวกันในกราฟ — ต่อท้ายด้วยชื่อกลุ่มเฉพาะตอนที่ชนกันจริง
  const _dupBase = new Set(chosen.map((e) => e.base)
    .filter((b, i, a) => a.indexOf(b) !== i));
  const _gName = new Map(visGroups.map((g) => [g.key, g.name || g.key]));
  const lineLabel = (e) => (_dupBase.has(e.base) ? `${e.base} · ${_gName.get(e.group)}` : e.base);

  // chart polish (อนุมัติจาก demo v18, 2026-08-29): monotone = โค้งลื่นไม่ overshoot
  // ยอด · gradient จางใต้เส้นหลักให้อ่าน "ปริมาณ" ได้ · จุดปลายเส้น = ข้อมูลจบตรงนี้
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
    return [{ label: `${name} · ${I18N.t('es.collecting')}`, data: pt, borderColor: color + '88', borderDash: [4, 4],
      borderWidth: 1.4, spanGaps: true, fill: false,
      pointRadius: (c2) => (c2.dataIndex === cutIdx ? 4 : 0), pointHoverRadius: 5,
      pointBackgroundColor: token('--surface-elevated'), pointBorderColor: color, pointBorderWidth: 1.6 }];
  };
  const ds = [];
  for (const e of chosen) {
    const c = e.card;
    const cw = closed(c.cur);
    ds.push({ label: lineLabel(e), data: cw, borderColor: c.color, borderWidth: 2.4, ...SMOOTH,
      fill: 'origin', backgroundColor: areaFill(c.color),
      pointRadius: endDot(cw), pointBackgroundColor: c.color,
      pointBorderColor: token('--surface-elevated'),
      pointBorderWidth: 1.5, pointHoverRadius: 4, spanGaps: true });
    ds.push(...pendingDs(c.cur, c.color, lineLabel(e)));
    if (_esShowGhost) ds.push({ label: `${lineLabel(e)} (${per.cmpName})`, data: zfill(c.cmp), borderColor: c.color + '55',
      borderDash: [5, 4], borderWidth: 1.4, ...SMOOTH, pointRadius: 0, spanGaps: true });
  }
  // เส้นรายทิศที่ถูกกดจากป้าย เข้า/ออก ในการ์ด — เข้า = เส้นบางมีจุดสามเหลี่ยม ·
  // ออก = เส้นบางมีจุดสี่เหลี่ยม (สีเดียวกับหมวด แยกกันด้วยรูปจุด ไม่แย่ง dash
  // ที่จองไว้ให้ "ช่วงเทียบ" อยู่แล้ว)
  for (const dkey of _esSelectedDir) {
    const { group, base: b, dir } = StatsSel.parse(dkey);
    const e = entryOf.get(StatsSel.key(group, b));
    const c = e && e.card;
    const dd = c?.dirs?.[dir];
    if (!dd) continue;
    const style = dir === 'IN' ? 'triangle' : 'rect';
    const label = `${lineLabel(e)} · ${dir === 'IN' ? I18N.t('es.in') : I18N.t('es.out')}`;
    ds.push({ label, data: closed(dd.cur), borderColor: c.color, borderWidth: 1.4, ...SMOOTH,
      pointStyle: style, pointRadius: 3, pointHoverRadius: 5, spanGaps: true });
    if (_esShowGhost) ds.push({ label: `${label} (${per.cmpName})`, data: zfill(dd.cmp), borderColor: c.color + '55',
      borderDash: [5, 4], borderWidth: 1, pointStyle: style, pointRadius: 2,
      ...SMOOTH, spanGaps: true });
  }
  for (const x of (watchGroup.extras || [])) {
    if (!_esSelectedExtra.has(StatsSel.key(watchGroup.key, x.base)) || !x.line) continue;
    const xw = closed(x.line);
    ds.push({ label: x.base, data: xw, borderColor: x.color, borderWidth: 2, ...SMOOTH,
      fill: 'origin', backgroundColor: areaFill(x.color),
      pointRadius: endDot(xw), pointBackgroundColor: x.color,
      pointBorderColor: token('--surface-elevated'),
      pointBorderWidth: 1.5, pointHoverRadius: 4, spanGaps: true });
    ds.push(...pendingDs(x.line, x.color, x.base));
    if (x.lineCmp && _esShowGhost) ds.push({ label: `${x.base} (${per.cmpName})`, data: zfill(x.lineCmp),
      borderColor: x.color + '55', borderDash: [5, 4], borderWidth: 1.2,
      ...SMOOTH, pointRadius: 0, spanGaps: true });
  }
  _es$('#esChartTools').innerHTML = `
    <label class="ghost-chk"><input type="checkbox" id="ghostChk" ${_esShowGhost ? 'checked' : ''}> ${I18N.t('es.ghost')}</label>
    ${_ES_EXPANDABLE[_esPeriod] ? `<button class="tool-btn ${_esExpanded ? 'on' : ''}" data-tool="expand"
      title="${I18N.t('es.expandTip')}">${_esExpanded ? I18N.t('es.expandBack') : _esT('es.expandTo', { u: _ES_EXPANDABLE[_esPeriod] })}</button>` : ''}
    <button class="tool-btn" data-tool="clear" ${_esSelected.size || _esSelectedDir.size || _esSelectedExtra.size ? '' : 'disabled'}>${I18N.t('es.clearAll')}</button>
    <button class="tool-btn" data-tool="reset">${I18N.t('es.defaults')}</button>`;
  _es$('#esChartEmpty').hidden = ds.length > 0;
  // แกนเต็มช่วงตายตัวเสมอ (เจ้าของเคาะ 2026-08-30 หลังเทียบหน้าเดิม): ตำแหน่ง
  // เวลาบนจอคงที่ทั้งวัน คนดูซ้ำ ๆ จำ pattern ได้ · หางว่าง = "ยังไม่มา" สื่อด้วย
  // เส้นจบที่วงแหวนกำลังเก็บอยู่แล้ว ไม่ต้องตัดแกน
  // เส้นแนวตั้งจาง ๆ ตามตำแหน่ง hover — กวาดตาเทียบหลายเส้นในจังหวะเดียว
  const hoverLine = { id: 'hoverLine', afterDraw(ch) {
    const act = ch.tooltip?.getActiveElements?.();
    if (!act?.length) return;
    const { top, bottom } = ch.chartArea, g = ch.ctx;
    g.save(); g.strokeStyle = token('--text-secondary') + '55'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(act[0].element.x, top); g.lineTo(act[0].element.x, bottom); g.stroke(); g.restore();
  } };
  // แกน x แบบ time scale สำหรับช่วงต่ำกว่ารายวัน (วิธีของหน้าเดิม e114351):
  // แกน category วาง tick ตามช่องข้อมูล ทำให้ tick สุดท้าย (22:00/23:30) ไม่ปิด
  // ขอบขวา เหลือช่องโล่งไม่สมส่วน (เจ้าของทัก 2026-08-30) — time scale ปัก
  // ขอบ 00:00→24:00 ได้พอดีและแบ่งช่องเท่ากันเสมอ · รายวันคง label ไทยเดิม
  const axisLabels = stepMs < 86400e3
    ? [...Array(n).keys()].map((i) => new Date(cur[0].getTime() + i * stepMs))
    : labels;
  _esCharts.push(new Chart(_es$('#esMainChart'), { type: 'line',
    data: { labels: axisLabels, datasets: ds },
    plugins: [hoverLine],
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false },
        tooltip: { ...chartTooltip(), cornerRadius: 10, padding: 12, boxPadding: 5, usePointStyle: true,
          callbacks: { label: (x) => ` ${x.dataset.label}: ${_esFmt(x.parsed.y)}` } } },
      scales: {
        y: { beginAtZero: true, border: { display: false },
             grid: { color: token('--border-hairline'), drawTicks: false },
             ticks: { precision: 0, callback: _esFmt, color: token('--text-secondary'), font: { size: 11 }, padding: 8, maxTicksLimit: 6 } },
        x: stepMs < 86400e3
          ? { type: 'time',
              min: cur[0].getTime(), max: cur[0].getTime() + n * stepMs,
              time: { unit: stepMs >= 3600e3 ? 'hour' : 'minute',
                      displayFormats: { minute: 'HH:mm', hour: 'HH:mm' }, tooltipFormat: 'HH:mm' },
              border: { display: false }, grid: { display: false },
              ticks: { maxTicksLimit: 13, color: token('--text-secondary'), font: { size: 11 } } }
          : { border: { display: false }, grid: { display: false },
              ticks: { maxTicksLimit: 12, color: token('--text-secondary'), font: { size: 11 } } } } } }));
  _es$('#esMainLegend').innerHTML = chosen.map((c) =>
    `<span><span class="sw" style="background:${c.color}"></span>${c.base}</span>`).join('');

  // ── กลุ่ม ──
  _es$('#esGroups').innerHTML = visGroups.map((g) => {
    const tot = g.cards.reduce((a, c) => a + c.total, 0) + (g.extras || []).reduce((a, c) => a + c.total, 0);
    const prev = g.cards.reduce((a, c) => a + c.prev, 0) + (g.extras || []).reduce((a, c) => a + (c.prev || 0), 0);
    const dd = _esCmpBadge(tot, prev);
    const isMatrix = _esMatrixOn.has(g.key);
    return `<div class="group" data-g="${g.key}">
      <div class="group-head">
        <span class="group-name">${g.name}</span>
        <span class="group-total">${I18N.t('es.total')} <b>${_esFmt(tot)}</b> · ${g.cards.length + (g.extras || []).length} ${I18N.t('es.catsUnit')}</span>
        ${g.key === 'standalone' ? `<span class="group-note">${I18N.t('es.standaloneNote')}</span>` : ''}
        ${prev ? `<span class="group-delta ${dd.cls === 'up' ? 'up' : dd.cls === 'down' ? 'down' : ''}">${dd.txt} ${_esT('es.vs', { c: per.cmpName })}</span>` : ''}
        <span class="group-view">
          ${_esCollapsedGroups.has(g.key) ? '' : `
          <button data-view="cards" data-g="${g.key}" class="${isMatrix ? '' : 'on'}">${I18N.t('es.viewCards')}</button>
          <button data-view="matrix" data-g="${g.key}" class="${isMatrix ? 'on' : ''}">${I18N.t('es.viewMatrix')}</button>
          <button data-csv-group="${g.key}" title="${I18N.t('es.csvTip')}">CSV</button>`}
          <button data-collapse="${g.key}" class="grp-fold" title="${_esCollapsedGroups.has(g.key)
            ? I18N.t('es.unfoldTip') : I18N.t('es.foldTip')}">
            ${_esCollapsedGroups.has(g.key) ? I18N.t('es.unfold') : I18N.t('es.fold')}</button>
        </span>
      </div>
      ${_esCollapsedGroups.has(g.key) ? '' : isMatrix ? _esSiteMatrix(g) : `<div class="group-grid">${g.cards.map((c, i) => {
        const b = _esCmpBadge(c.total, c.prev);
        const dirBtn = (dir, th) => c.io[dir] == null ? '' :
          `<button class="io-btn ${_esSelectedDir.has(StatsSel.keyDir(g.key, c.base, dir)) ? 'on' : ''}"
                   data-dirbtn="${dir}" data-group="${g.key}" data-base="${c.base.replace(/"/g, '&quot;')}"
                   title="${_esT('es.dirTip', { d: th })}">${th} <b>${_esFmt(c.io[dir])}</b></button>`;
        const io = (c.io.IN != null || c.io.OUT != null)
          ? `<div class="kpi-io">${dirBtn('IN', I18N.t('es.in'))}${dirBtn('OUT', I18N.t('es.out'))}</div>` : '';
        const idle = !c.total && !c.prev;   // ตั้งไว้แต่เงียบทั้งสองช่วง
        // การ์ดนับคน: โชว์จำนวนกล้องที่ตรวจจับคนได้ (auto จาก cameras_seen)
        const camNote = c.base === _ES_PEOPLE_COUNT_NAME
          ? `<div class="kpi-io"><span>${_esT('es.pplNote', { n: new Set(c.camSeen.map((x) => x.camera_id)).size })}</span></div>` : '';
        return `<div class="kpi ${_esSelected.has(StatsSel.key(g.key, c.base)) ? 'sel' : ''}" data-base="${c.base.replace(/"/g, '&quot;')}" data-group="${g.key}" style="--kc:${c.color}">
          <div class="kpi-top">
            <div><div class="kpi-name">${c.base}${_ES_FIXED_SET.has(c.base) ? '' : ` <span class="chip-custom">${I18N.t('es.customTag')}</span>`}</div><div class="kpi-val">${_esFmt(c.total)}</div></div>
            <div class="kpi-cmp ${b.cls}">${b.txt}</div>
          </div>${io}${camNote}
          ${idle
            ? `<div class="kpi-idle">${I18N.t('es.noEvents')}</div>`
            : `<div class="kpi-spark"><canvas id="sp-${g.key}-${i}"></canvas></div>
          <div class="kpi-ynote">${_esShowGhost ? _esT('es.ghostNote', { c: per.cmpName }) : ''}</div>`}
        </div>`; }).join('')}${(g.extras || []).map((x, i) => {
        const b = _esCmpBadge(x.total, x.prev || 0);
        const clickable = !!x.line;
        return `<div class="kpi ${clickable && _esSelectedExtra.has(StatsSel.key(g.key, x.base)) ? 'sel' : ''}"
             ${clickable ? `data-extra="${x.base.replace(/"/g, '&quot;')}" data-group="${g.key}"` : 'style="cursor:default"'}
             style="--kc:${x.color}${clickable ? '' : ';cursor:default'}">
          <div class="kpi-top">
            <div><div class="kpi-name">${x.base}</div><div class="kpi-val">${_esFmt(x.total)}</div></div>
            <div class="kpi-cmp ${b.cls}">${b.txt}</div>
          </div>
          ${x.spark && x.spark.length > 1 ? `<div class="kpi-spark"><canvas id="spx-${i}"></canvas></div>` : ''}
          <div class="kpi-ynote">${x.note}</div>
        </div>`; }).join('')}${g.extraNote ? `<div class="kpi" style="cursor:default"><div class="kpi-ynote" style="margin-top:8px">${g.extraNote}</div></div>` : ''}</div>`}
    </div>`; }).join('');

  const nowIdx = Math.floor((Date.now() - cur[0]) / stepMs);
  visGroups.forEach((g) => { if (_esMatrixOn.has(g.key)) return;
    g.cards.forEach((c, i) => {
      if (!c.total && !c.prev) return;          // การ์ดว่างไม่มี canvas
      const el = document.getElementById(`sp-${g.key}-${i}`);
      if (!el) return;
      _esCharts.push(new Chart(el, { type: 'line',
        data: { labels, datasets: [
          ...(_esShowGhost ? [{ data: c.cmp, borderColor: '#9aa6bd88', borderDash: [3, 3], borderWidth: 1,
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
    _esCharts.push(new Chart(el, { type: 'line',
      data: { labels: [...Array(m).keys()], datasets: [
        ...(x.sparkCmp && x.sparkCmp.length > 1 && _esShowGhost ? [{ data: x.sparkCmp, borderColor: '#9aa6bd88',
          borderDash: [3, 3], borderWidth: 1, cubicInterpolationMode: 'monotone', pointRadius: 0, spanGaps: true }] : []),
        { data: x.spark, borderColor: x.color, borderWidth: 1.6, cubicInterpolationMode: 'monotone',
          borderCapStyle: 'round', fill: 'origin', backgroundColor: x.color + '14', pointRadius: 0, spanGaps: true },
      ] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false, beginAtZero: true } } } }));
  });
  _es$('#esStamp').textContent = new Date().toLocaleString('th-TH');
  _esLastData = d;
  _esLastGroups = visGroups;
  _esRenderBI();
}

// ── pills ───────────────────────────────────────────────────────────────────
function _esRenderPills() {
  _es$('#esPeriodPills').innerHTML = _ES_PERIODS.map((p) =>
    `<button data-p="${p.key}" class="${_esPeriod === p.key ? 'on' : ''}">${p.name}</button>`).join('');
  _es$('#esCustomBox').hidden = _esPeriod !== 'custom';
  _es$('#esSitePills').innerHTML =
    `<button data-id="" class="${_esSiteSel ? '' : 'on'}">${I18N.t('es.allSites')}</button>` +
    _ES_SITES.map((s) => `<button data-id="${s.id}" class="${String(_esSiteSel) === String(s.id) ? 'on' : ''}">${s.name || s.code}</button>`).join('');
  _es$('#esGroupPills').innerHTML =
    `<button data-gid="" class="${_esGroupSel ? '' : 'on'}">${I18N.t('es.allCams')}</button>` +
    _esGROUPS_CAM.map((g) => { const id = g.id ?? g.name;
      return `<button data-gid="${id}" class="${String(_esGroupSel) === String(id) ? 'on' : ''}">
        ${g.name} <small>(${(g.cameraIds || []).length})</small></button>`; }).join('');
}

// re-entry guard — dashboard เรียก loadStats ได้จากหลายทาง (showPage + refresher)
// ถ้าปล่อยวิ่งซ้อน _esRender สองรอบจะสร้าง Chart ทับ canvas เดิม → โยน error หลอก
let _esInFlight = null;
function _esRefresh() {
  if (_esInFlight) return _esInFlight;
  _esInFlight = (async () => {
    try { _es$('#esAuthNote').hidden = true; _esRender(await _esLoad()); }
    catch (e) { console.error('stats refresh:', e); _es$('#esAuthNote').hidden = false; }
    finally { _esInFlight = null; }
  })();
  return _esInFlight;
}

// ── v15: ส่วน BI — ของที่รอดจากการสำรวจหน้าเดิม (heatmap · dwell · CSV) ─────
// heatmap ใช้ฐาน 28 วันคงที่ (pattern dow×hour ต้องการหลายสัปดาห์ ไม่ผูก _esPeriod)
// dwell ตามช่วง/ตัวกรองที่เลือก · ทั้งคู่โหลดหลัง _esRender หลัก ไม่บล็อกหน้า
const _ES_DOW_TH = I18N.t('es.dow').split(',');
const _esBiCache = new Map();
let _esLastGroups = null, _esLastDwellRows = [], _esBiCatKey = '';

async function _esBiHeatCells(catIds) {
  // pattern-heatmap อ่านจาก rollup 30 นาที (~0.3s) — endpoint heatmap เดิม scan
  // events ดิบ 28 วัน วัดจริง >60s ใช้บนหน้าไม่ได้ · รับหลาย id ทีเดียว
  const url = `/api/stats/pattern-heatmap?days=28${_esScopeParam()}`
    + (catIds ? `&category_ids=${catIds.join(',')}` : '');
  if (_esBiCache.has(url)) return _esBiCache.get(url);
  const cells = (await _esJget(url)).cells;
  _esBiCache.set(url, cells);
  return cells;
}

function _esRenderHeat(cells) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let max = 0;
  for (const c of cells) { grid[c.dow][c.hour] = c.count; if (c.count > max) max = c.count; }
  const short = (v) => !v ? '' : v >= 10000 ? `${Math.round(v / 1000)}k`
    : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
  _es$('#esBiHeatBody').innerHTML = `<div class="bi-heatwrap"><table class="bi-heat">
    <tr><th></th>${[...Array(24).keys()].map((h) => `<th>${String(h).padStart(2, '0')}</th>`).join('')}</tr>
    ${grid.map((r, d) => `<tr><th>${_ES_DOW_TH[d]}</th>${r.map((v, h) => {
      const a = max ? v / max : 0;
      return `<td title="${_ES_DOW_TH[d]} ${String(h).padStart(2, '0')}:00 ${I18N.t('es.hourSuffix')} · ${_esFmt(v)} ${I18N.t('es.events')}"
        style="background:rgba(53,100,214,${(a * 0.92).toFixed(3)});color:${a > 0.55 ? '#fff' : 'var(--dim)'}">${short(v)}</td>`;
    }).join('')}</tr>`).join('')}
  </table></div>
  <div class="bi-note">${_esT('es.biHeatMax', { n: _esFmt(max) })}</div>`;
}

const _esFmtDur = (s) => s == null ? '–' : s < 60 ? `${s} ${I18N.t('es.uSec')}`
  : s < 3600 ? `${(s / 60) | 0} ${I18N.t('es.uMin')} ${s % 60} ${I18N.t('es.uSec')}`
  : `${(s / 3600) | 0} ${I18N.t('es.uHr')} ${Math.round((s % 3600) / 60)} ${I18N.t('es.uMin')}`;

function _esRenderDwellRows(rows) {
  _esLastDwellRows = rows;
  if (!rows.length) {
    _es$('#esBiDwellBody').innerHTML = `<div class="bi-note">${I18N.t('es.dwEmpty')}</div>`;
    return;
  }
  const top = [...rows].sort((a, b) => b.episodes - a.episodes).slice(0, 8);
  _es$('#esBiDwellBody').innerHTML = `<div class="smwrap"><table class="sitematrix bi-dwell">
    <tr><th>${I18N.t('es.dwZone')}</th><th>${I18N.t('es.dwCam')}</th><th>${I18N.t('es.dwCount')}</th><th>${I18N.t('es.dwAvg')}</th><th>${I18N.t('es.dwMax')}</th><th>${I18N.t('es.dwTotal')}</th></tr>
    ${top.map((r) => `<tr><td>${r.rule_name || I18N.t('es.noName')}</td><td>${r.camera_id}</td>
      <td>${_esFmt(r.episodes)}</td><td>${_esFmtDur(r.avg_sec)}</td><td>${_esFmtDur(r.max_sec)}</td>
      <td>${_esFmtDur(r.total_sec)}</td></tr>`).join('')}
  </table></div>${rows.length > 8 ? `<div class="bi-note">${_esT('es.dwCap', { n: rows.length })}</div>` : ''}`;
}

function _esRenderBI() {
  if (!_esLastData) return;
  for (const [key, cardId] of [['bi-heat', '#esBiHeatCard'], ['bi-dwell', '#esBiDwellCard']]) {
    const card = _es$(cardId);
    if (!card) continue;
    card.querySelector('[data-collapse]').textContent = _esCollapsedGroups.has(key) ? I18N.t('es.unfold') : I18N.t('es.fold');
  }
  _es$('#esBiHeatBody').hidden = _esCollapsedGroups.has('bi-heat');
  _es$('#esBiDwellBody').hidden = _esCollapsedGroups.has('bi-dwell');
  // เติม dropdown หมวด (การ์ด merge แล้ว) — สร้างใหม่เฉพาะเมื่อรายการเปลี่ยน
  const cats = (_esLastGroups || []).flatMap((g) => g.cards).map((c) => ({ base: c.base, ids: c.ids }));
  const k = cats.map((c) => c.base).join('|');
  if (k !== _esBiCatKey) {
    _esBiCatKey = k;
    const cur = _es$('#esBiHeatCat').value;
    _es$('#esBiHeatCat').innerHTML = `<option value="">${I18N.t('es.biAllCats')}</option>` +
      cats.map((c) => `<option value="${c.ids.join(',')}">${c.base}</option>`).join('');
    if ([..._es$('#esBiHeatCat').options].some((o) => o.value === cur)) _es$('#esBiHeatCat').value = cur;
  }
  if (!_esCollapsedGroups.has('bi-heat')) {
    const sel = _es$('#esBiHeatCat').value;
    _esBiHeatCells(sel ? sel.split(',').map(Number) : null).then(_esRenderHeat)
      .catch((e) => { _es$('#esBiHeatBody').textContent = `heatmap ${I18N.t('es.loadFail')}${e.message}`; });
  }
  if (!_esCollapsedGroups.has('bi-dwell')) {
    const { cur } = _esLastData;
    const url = `/api/stats/dwell?from=${cur[0].toISOString()}&to=${cur[1].toISOString()}${_esScopeParam()}`;
    const key = `dwell|${url}`;
    (_esBiCache.has(key) ? Promise.resolve(_esBiCache.get(key)) : _esJget(url).then((r) => { _esBiCache.set(key, r); return r; }))
      .then(_esRenderDwellRows)
      .catch((e) => { _es$('#esBiDwellBody').textContent = `dwell ${I18N.t('es.loadFail')}${e.message}`; });
  }
}

// ── CSV export (BI) — สร้างฝั่งเบราว์เซอร์จากข้อมูลที่โหลดแล้ว ─────────────
function _esDlCsv(name, rows) {
  const csv = rows.map((r) => r.map((v) => {
    v = String(v ?? '');
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}
function _esExportGroupCsv(key) {
  const g = (_esLastGroups || []).find((x) => x.key === key);
  if (!g) return;
  const rows = [[I18N.t('es.mxCat'), I18N.t('es.total'), I18N.t('es.cmpCol'), I18N.t('es.in'), I18N.t('es.out')]];
  for (const c of g.cards) rows.push([c.base, c.total, c.prev, c.io?.IN ?? '', c.io?.OUT ?? '']);
  for (const x of (g.extras || [])) rows.push([x.base, x.total, x.prev ?? '', '', '']);
  _esDlCsv(`stats_${key}_${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#page-stats')) return;   // หน้าอื่นมี .kpi/[data-tool] ของตัวเอง
  const pp = ev.target.closest('#esPeriodPills button');
  if (pp) { _esPeriod = pp.dataset.p; _esRenderPills(); if (_esPeriod !== 'custom') _esRefresh(); return; }
  const sp = ev.target.closest('#esSitePills button');
  if (sp) { _esSiteSel = sp.dataset.id || null; _esRenderPills(); _esRefresh(); return; }
  const gp = ev.target.closest('#esGroupPills button');
  if (gp) { _esGroupSel = gp.dataset.gid || null; _esRenderPills(); _esRefresh(); return; }
  const mx = ev.target.closest('[data-mxmode]');
  if (mx) { const [k, m] = mx.dataset.mxmode.split('|');
    _esMatrixMode.set(k, m); if (_esLastData) _esRender(_esLastData); return; }
  const csv = ev.target.closest('[data-csv],[data-csv-group]');
  if (csv) {
    if (csv.dataset.csvGroup) _esExportGroupCsv(csv.dataset.csvGroup);
    else if (csv.dataset.csv === 'dwell') _esDlCsv(`dwell_${new Date().toISOString().slice(0, 10)}.csv`,
      [[I18N.t('es.dwZone'), I18N.t('es.dwCam'), I18N.t('es.dwCount'),
        `${I18N.t('es.dwAvg')}(${I18N.t('es.uSec')})`, `${I18N.t('es.dwMax')}(${I18N.t('es.uSec')})`,
        `${I18N.t('es.dwTotal')}(${I18N.t('es.uSec')})`],
        ..._esLastDwellRows.map((r) => [r.rule_name, r.camera_id, r.episodes, r.avg_sec, r.max_sec, r.total_sec])]);
    return; }
  // ยุบ/กางกลุ่ม — ต้องมาก่อน .group-view button (ปุ่มอยู่ใน span เดียวกัน)
  const fold = ev.target.closest('[data-collapse]');
  if (fold) { const k = fold.dataset.collapse;
    if (_esCollapsedGroups.has(k)) { _esCollapsedGroups.delete(k); _esRestoreCollapseStash(k); }
    else _esCollapsedGroups.add(k);
    localStorage.setItem(_ES_COLLAPSE_KEY, JSON.stringify([..._esCollapsedGroups]));
    if (_esLastData) _esRender(_esLastData); return; }
  const tool = ev.target.closest('[data-tool]');
  if (tool) {
    if (tool.dataset.tool === 'expand') { _esExpanded = !_esExpanded; _esRefresh(); return; }
    if (tool.dataset.tool === 'clear') { _esSelected = new Set(); _esSelectedDir.clear(); _esSelectedExtra.clear();
      // ล้างทั้งหมด = ล้าง stash ของกลุ่มที่ยุบด้วย ไม่งั้นกางกลับแล้วเส้นเก่าฟื้นทั้งที่ผู้ใช้เพิ่งล้าง
      Object.keys(_esCollapseStash).forEach((k) => delete _esCollapseStash[k]); }
    else { _esSelected = window._demoDefaults ? window._demoDefaults() : null; _esSelectedDir.clear(); _esSelectedExtra.clear(); }
    if (_esLastData) _esRender(_esLastData); return; }
  const gv = ev.target.closest('.group-view button');
  if (gv) { const k = gv.dataset.g;
    if (gv.dataset.view === 'matrix') _esMatrixOn.add(k); else _esMatrixOn.delete(k);
    if (_esLastData) _esRender(_esLastData); return; }
  const db = ev.target.closest('[data-dirbtn]');
  if (db) { ev.stopPropagation();
    const k = StatsSel.keyDir(db.dataset.group, db.dataset.base, db.dataset.dirbtn);
    if (_esSelectedDir.has(k)) _esSelectedDir.delete(k); else _esSelectedDir.add(k);
    // ขึ้นเส้นทิศ = ผู้ใช้กำลังสนใจหมวดนี้ — เปิดเส้นรวมให้ด้วยถ้ายังไม่เปิด
    const base = StatsSel.key(db.dataset.group, db.dataset.base);
    if (_esSelected && !_esSelected.has(base)) _esSelected.add(base);
    if (_esLastData) _esRender(_esLastData); return; }
  const xc = ev.target.closest('.kpi[data-extra]');
  if (xc) { const b = StatsSel.key(xc.dataset.group, xc.dataset.extra);
    if (_esSelectedExtra.has(b)) _esSelectedExtra.delete(b); else _esSelectedExtra.add(b);
    if (_esLastData) _esRender(_esLastData); return; }
  const card = ev.target.closest('.kpi[data-base]');
  if (card) { const b = StatsSel.key(card.dataset.group, card.dataset.base);
    if (_esSelected.has(b)) _esSelected.delete(b); else _esSelected.add(b);
    if (_esLastData) _esRender(_esLastData); return; }
});
document.addEventListener('change', (ev) => {
  if (!ev.target.closest('#page-stats')) return;
  if (ev.target.id === 'ghostChk') { _esShowGhost = ev.target.checked; if (_esLastData) _esRender(_esLastData); }
});
_es$('#esBiHeatCat').addEventListener('change', _esRenderBI);
_es$('#esCGo').addEventListener('click', () => {
  _esCustomFrom = _es$('#esCFrom').value || null; _esCustomTo = _es$('#esCTo').value || null;
  if (!_esCustomFrom || !_esCustomTo) return;
  const span = (new Date(_esCustomTo) - new Date(_esCustomFrom)) / 86400e3 + 1;
  if (span > _esMaxDays) { alert(_esT('es.rangeCap', { n: _esMaxDays })); return; }
  _esRefresh();
});

// ── contract เดิมของ dashboard: showPage('stats') → loadStats() ──────────────
let _esBooted = false;
let _esMaxDays = 60;   // custom_range_max_days จาก system_settings — กัน scan ช่วงยาวเกิน
async function loadStats() {
  if (!_esBooted) {
    _esBooted = true;
    try {
      const [sites, groups, cams] = await Promise.all([
        _esJget('/api/sites'), _esJget('/api/groups'), _esJget('/api/cameras')]);
      _ES_SITES = Array.isArray(sites) ? sites : (sites.sites || []);
      _esGROUPS_CAM = Array.isArray(groups) ? groups : (groups.groups || []);
      const camList = Array.isArray(cams) ? cams : (cams.cameras || []);
      _esCAM_SITE = new Map(camList.map((c) => [c.id ?? c.camera_id, c.site_id]));
      // เพดานช่วงกำหนดเอง (เหตุผลเดิมของหน้าเก่า: กันช่วงยาวลาก events มหาศาล)
      const st = await _esJget('/api/settings').catch(() => null);
      if (st && Number(st.custom_range_max_days) > 0) _esMaxDays = Number(st.custom_range_max_days);
    } catch (e) { console.error('stats bootstrap:', e); }
    _esRenderPills();
    document.getElementById('esOpenCatMgr')?.addEventListener('click', () => {
      if (typeof openCategoryManager === 'function') openCategoryManager();
    });
  }
  await _esRefresh();
}
// invalidateStats() อยู่ที่ page-categories.js (เจ้าของเดิม) — เรียก loadStats() ที่นี่
// stub: dashboard.js (WS occupancy) ยังเรียกอยู่ — การนับสดย้ายไปหน้า Map ตามแผน BI
function renderOccupancy() {}
