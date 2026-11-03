// ============================================================
// Vigil Platform — หน้ากวดขันวินัยจราจร (Traffic Enforcement)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ต่อยอดจากหน้า demo /others/demo/accumulative/ (เก็บไว้อ้างอิง) แต่ใช้ข้อมูลจริง
// จาก /api/traffic/enforcement ซึ่งอ่านตารางสรุป traffic_hourly_stats
//
// ── ข้อที่ห้ามพลาด (เหตุผลเต็มอยู่ใน src/routes/traffic.js) ─────────────
// 1. ตัวหารไม่สวมหมวก = รถ 2-3 ล้อ · ไม่คาดเข็มขัด = รถ 4 ล้อขึ้นไป · คนละชุด
// 2. กล้องที่ยังไม่เปิดตรวจจับต้องไม่ถูกนับเป็น 0% — server ตัดสินมาให้แล้ว (detect)
// 3. ตัวกรองที่แท็บไหนไม่ได้ใช้ ให้ซ่อน — ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้นอ่านว่าระบบเสีย
// ============================================================
'use strict';

const TRF = {
  days: 28,
  gran: 'day',
  volMode: 'cum',
  metric: 'pct',       // pct = อัตรา% · abs = จำนวนคันจริง
  tab: 'volume',
  dows: new Set([1, 2, 3, 4, 5, 6, 7]),
  cams: null,          // null = ทุกกล้อง
  sites: new Set(),    // ว่าง = ทุก site
  types: null,         // null = ทุกประเภทรถ
  effKind: 'helmet',   // แท็บก่อน-หลัง วัดเรื่องอะไร
  effDate: null,       // วันที่เริ่มกวดขัน (YYYY-MM-DD)
  effWin: 14,
  groups: null,        // กลุ่มประเภทรถ (โหลดจาก settings)
  data: null,
  loading: false,
};

// กลุ่มประเภทรถเริ่มต้น — ผู้ใช้แก้ได้ในแท็บตั้งค่า แล้วเก็บลง system_settings
const TRF_DEFAULT_GROUPS = [
  { id: 'moto',  th: 'รถ 2-3 ล้อ',   color: '#e8590c', types: ['twoWheelVehicle', 'threeWheelVehicle'] },
  { id: 'car',   th: 'รถยนต์ 4 ล้อ', color: '#1971c2', types: ['vehicle', 'SUVMPV', 'pickupTruck', 'van'] },
  { id: 'heavy', th: 'รถใหญ่',       color: '#5f3dc4', types: ['truck', 'largeBus'] },
  { id: 'other', th: 'อื่น ๆ',       color: '#868e96', types: ['buggy', 'pedestrian', 'unknown'] },
];
const TRF_CHARTS = {};
const TRF_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const TRF_DOW = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัส', 5: 'ศุกร์', 6: 'เสาร์', 7: 'อาทิตย์' };
const TRF_COLORS = { 1: '#1971c2', 2: '#2f9e44', 3: '#f08c00', 4: '#9c36b5', 5: '#e8590c', 6: '#c2255c', 7: '#0c8599' };
const MOTO_TYPES_FE = ['twoWheelVehicle', 'threeWheelVehicle'];
const TYPE_TH = {
  twoWheelVehicle: 'จักรยานยนต์', threeWheelVehicle: 'สามล้อ', vehicle: 'รถยนต์',
  SUVMPV: 'อเนกประสงค์', pickupTruck: 'กระบะ', van: 'รถตู้', truck: 'รถบรรทุก',
  largeBus: 'รถบัส', buggy: 'รถกอล์ฟ', pedestrian: 'คนเดินเท้า', unknown: 'ไม่ระบุ',
};

const _tfmt  = (n) => Math.round(n || 0).toLocaleString('th-TH');
const _tpct  = (n) => (Math.round((n || 0) * 10) / 10).toFixed(1);
const _tdows = () => [...TRF.dows].sort((a, b) => a - b);

// กล้องที่ผ่านตัวกรอง site + ตัวเลือกกล้อง
function trfSelectedCams() {
  const all = TRF.data?.cameras || [];
  return all.filter(c =>
    (!TRF.sites.size || TRF.sites.has(c.site_code)) &&
    (!TRF.cams || TRF.cams.has(c.id)));
}
// เฉพาะกล้องที่ตรวจจับหมวกได้จริง — ใช้เป็นตัวหารของทุกตัวเลขเรื่องหมวก
function trfDetectingCams() { return trfSelectedCams().filter(c => c.detect); }

function trfHelmetPct() {
  const cams = trfDetectingCams();
  const moto = cams.reduce((a, c) => a + c.moto, 0);
  if (!moto) return null;
  return cams.reduce((a, c) => a + c.no_helmet, 0) / moto * 100;
}

// ── โหลดข้อมูล ───────────────────────────────────────────────
// 5 แท็บแรกกินข้อมูลจาก /api/traffic/enforcement ก้อนเดียวกัน (report/settings ไม่ใช้ข้อมูล)
// ส่วน helmet มี endpoint ของตัวเอง — ดู decision #250 ว่าทำไมมีแค่ helmet ที่กันได้จริง
const TRF_TAB_KEYS = ['volume', 'violation', 'effect', 'deploy', 'helmet', 'topHelmet', 'report', 'settings'];
const TRF_TABS_NEEDING_ENFORCEMENT = ['volume', 'violation', 'effect', 'deploy'];

// ผู้ใช้คนนี้มีสิทธิ์แท็บที่ต้องใช้ /enforcement สักแท็บไหม — ถ้าไม่มี ห้ามยิง endpoint นั้น
// เลย ไม่งั้นเปิดหน้ามาจะเจอ 403 ทั้งที่แท็บที่ตัวเองมีสิทธิ์ใช้งานได้ปกติ
function _trfCanLoadEnforcement() {
  if (typeof ViewsACL === 'undefined') return true;
  return TRF_TABS_NEEDING_ENFORCEMENT.some(t => ViewsACL.allowed('traffic:' + t));
}

async function loadTraffic(force) {
  const el = document.getElementById('trfBody');
  if (!el) return;
  // เปิดหน้าครั้งแรก: เด้งไปแท็บแรกที่มีสิทธิ์ แทนที่จะเป็น 'volume' ที่ตั้งไว้ตายตัว
  if (typeof ViewsACL !== 'undefined' && !ViewsACL.allowed('traffic:' + TRF.tab)) {
    TRF.tab = ViewsACL.firstTab('traffic', TRF_TAB_KEYS, TRF.tab);
  }
  // บัญชี single ต้องได้กล้อง default ก่อนยิงอะไรทั้งนั้น — server ตอบ 400 กับคำขอ
  // ที่ไม่ระบุกล้องของบัญชีโหมดนี้แล้ว (เข้มตามเจตนา migration 180, เจ้าของอนุมัติ 2026-09-03)
  if (_trfCamSingle() && !_trfSinglePicked && (!TRF.cams || TRF.cams.size !== 1)) {
    await _trfEnsureSingleDefault();
  }
  if (!_trfCanLoadEnforcement()) { renderTraffic(); return; }
  if (TRF.data && !force) { renderTraffic(); return; }
  if (TRF.loading) return;
  TRF.loading = true;
  el.innerHTML = `<div class="trf-note">${escapeHtml(I18N.t('trf.loading', 'กำลังโหลดข้อมูล…'))}</div>`;
  try {
    const camQ = _trfCamSingle() && TRF.cams && TRF.cams.size === 1
      ? `&cameras=${encodeURIComponent([...TRF.cams][0])}` : '';
    const r = await fetch(`${API}/api/traffic/enforcement?days=${TRF.days}${camQ}`, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    TRF.data = d;
    renderTraffic();
  } catch (e) {
    el.innerHTML = `<div class="trf-note bad">${escapeHtml(I18N.t('trf.failed', 'โหลดไม่สำเร็จ:'))} ${escapeHtml(e.message)}</div>`;
  } finally { TRF.loading = false; }
}

// ── รวมยอดรายชั่วโมงตามวันที่เลือก ───────────────────────────
// server ส่งมาเป็นรายชั่วโมง × วันในสัปดาห์ พร้อม days_seen เพื่อหารเป็นค่าเฉลี่ยต่อวัน
// (แต่ละวันในสัปดาห์ปรากฏไม่เท่ากันในหน้าต่าง 7/28/90 วัน จึงหารด้วยของจริง ไม่ใช่เดา)
function trfSeriesByDow() {
  const out = {};
  const share = trfShare();
  for (const row of (TRF.data?.hourly || [])) {
    if (!out[row.dow]) out[row.dow] = { vol: Array(24).fill(0), pct: Array(24).fill(null), abs: Array(24).fill(0) };
    const d = Math.max(1, row.days_seen);
    out[row.dow].vol[row.hour] = row.moto / d * share;
    out[row.dow].pct[row.hour] = row.moto ? row.no_helmet / row.moto * 100 : null;
    // จำนวนคันที่ฝ่าฝืนจริงต่อวัน — คนละคำถามกับอัตรา ดู renderViolation
    out[row.dow].abs[row.hour] = row.no_helmet / d * share;
  }
  return out;
}
// สัดส่วนปริมาณของกล้องที่เลือก เทียบกับทั้งหมด — ปรับสเกลกราฟให้ตรงกับที่เลือก
function trfShare() {
  const all = (TRF.data?.cameras || []).reduce((a, c) => a + c.moto, 0);
  const sel = trfSelectedCams().reduce((a, c) => a + c.moto, 0);
  return all ? sel / all : 0;
}
// อัตราฝ่าฝืนของกล้องที่เลือก เทียบกับค่าเฉลี่ยทั้งระบบ — ใช้เลื่อนเส้นรายชั่วโมง
function trfRateScale() {
  const cams = trfDetectingCams();
  const allDet = (TRF.data?.cameras || []).filter(c => c.detect);
  const base = allDet.reduce((a, c) => a + c.moto, 0)
    ? allDet.reduce((a, c) => a + c.no_helmet, 0) / allDet.reduce((a, c) => a + c.moto, 0) * 100 : 0;
  const sel = cams.reduce((a, c) => a + c.moto, 0)
    ? cams.reduce((a, c) => a + c.no_helmet, 0) / cams.reduce((a, c) => a + c.moto, 0) * 100 : 0;
  return base ? sel / base : 1;
}

// ── กราฟ ────────────────────────────────────────────────────
function trfChart(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (TRF_CHARTS[id]) TRF_CHARTS[id].destroy();
  TRF_CHARTS[id] = new Chart(el.getContext('2d'), cfg);
}

// รวมยอดรายวันตามขอบเขตกล้องที่เลือก — ใช้แท็บ "ก่อน-หลังกวดขัน"
// raw data จาก server เป็นรายกล้อง รายวัน ต้องรวมยอดเป็นรายวันเพียงเดียว
function trfDailyScoped() {
  const selected = trfSelectedCams();
  const selectedIds = new Set(selected.map(c => c.id));
  const raw = TRF.data?.daily || [];

  // Group by date, sum across selected cameras
  const byDate = {};
  for (const row of raw) {
    if (!selectedIds.has(row.camera_id)) continue;
    const d = row.date;
    if (!byDate[d]) {
      byDate[d] = {
        date: d, camera_id: null, moto: 0, no_helmet: 0,
        car: 0, no_seatbelt: 0, riders3: 0, cams: 0
      };
    }
    byDate[d].moto += row.moto || 0;
    byDate[d].no_helmet += row.no_helmet || 0;
    byDate[d].car += row.car || 0;
    byDate[d].no_seatbelt += row.no_seatbelt || 0;
    byDate[d].riders3 += row.riders3 || 0;
    byDate[d].cams += 1;  // count distinct cameras per date
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}
const _tgrid = () => token('--border-hairline');
const _ttext = () => token('--text-secondary');
const _tlegend = { labels: { color: null, font: { size: 11 }, boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'rectRounded' } };
function trfLegend() { return { labels: { ..._tlegend.labels, color: _ttext() } }; }

// ── หัวเรื่อง + ตัวกรอง ──────────────────────────────────────
function trfScopeBar() {
  const cams = trfSelectedCams();
  const sites = (TRF.data?.sites || []).filter(s =>
    (TRF.data?.cameras || []).some(c => c.site_code === s.code));
  const camLabel = _trfCamLabel(cams);

  // badge แยกตาม site — นับกล้องที่มีข้อมูลจริงของ site นั้น ไม่ใช่กล้องทั้งหมดในทะเบียน
  const siteChips = sites.map(s => {
    const n = (TRF.data.cameras || []).filter(c => c.site_code === s.code).length;
    const on = TRF.sites.has(s.code);
    return `<button type="button" class="trf-site${on ? ' on' : ''}" data-action="trfSite" data-site="${escapeHtml(s.code)}"
      style="--sc:${escapeHtml(s.color || 'var(--accent)')}" aria-pressed="${on}">
      <span class="dot"></span>${escapeHtml(s.name)} <span class="n">${n}</span></button>`;
  }).join('');

  const dowChips = [1, 2, 3, 4, 5, 6, 7].map(d =>
    `<button type="button" class="trf-dow" data-action="trfDow" data-dow="${d}"
      style="--dc:${TRF_COLORS[d]}" aria-pressed="${TRF.dows.has(d)}">${TRF_DOW[d].slice(0, 2)}</button>`).join('');

  const sc = (list, tab) => list.includes(tab);
  const t = TRF.tab;
  return `
  <div class="trf-scope">
    ${sites.length > 1 ? `<div class="trf-grp"><span class="trf-lbl">Site</span>
      <div class="trf-sites">${siteChips}
        <button type="button" class="btn-mini" data-action="trfSiteAll">ทุก Site</button></div></div>` : ''}
    <div class="trf-grp"><span class="trf-lbl">กล้อง</span>
      <button class="btn-mini" data-action="trfOpenCams">${escapeHtml(camLabel)}</button></div>
    ${sc(['volume', 'violation', 'deploy'], t) ? `<div class="trf-grp"><span class="trf-lbl">ช่วงเวลา</span>
      <div class="trf-seg">${[7, 28, 90].map(d =>
        `<button class="${TRF.days === d ? 'on' : ''}" data-action="trfDays" data-days="${d}">${d} วัน</button>`).join('')}</div></div>` : ''}
    ${sc(['volume'], t) ? `<div class="trf-grp"><span class="trf-lbl">ประเภทรถ</span>
      <button class="btn-mini" data-action="trfOpenTypes">${TRF.types ? `เลือกไว้ ${TRF.types.size} ประเภท` : 'ทุกประเภท'}</button></div>` : ''}
    ${sc(['volume', 'violation'], t) ? `<div class="trf-grp"><span class="trf-lbl">ระดับ</span>
      <div class="trf-seg">${[['day', 'รายวัน'], ['week', 'รายสัปดาห์'], ['month', 'รายเดือน']].map(([g, l]) =>
        `<button class="${TRF.gran === g ? 'on' : ''}" data-action="trfGran" data-gran="${g}">${l}</button>`).join('')}</div></div>` : ''}
    <div class="trf-grp grow"><span class="trf-lbl">วัน</span>
      <div class="trf-dows">${dowChips}</div>
      <button class="btn-mini ghost" data-action="trfDowAll">ทุกวัน</button></div>
  </div>
  <div class="trf-summary">
    ชุดข้อมูลที่เลือก : <b>${escapeHtml(camLabel)}</b>${TRF.sites.size ? ` · Site : <b>${[...TRF.sites].join(', ')}</b>` : ''}<br>
    วัน : <b>${_tdows().map(d => TRF_DOW[d]).join(', ')}</b>
    ${sc(['volume', 'violation'], t) ? ` · ระดับ : <b>${{ day: 'รายวัน', week: 'รายสัปดาห์', month: 'รายเดือน' }[TRF.gran]}</b>` : ''}
    ${t === 'effect' ? ` · หน้าต่างเทียบ : <b>${TRF.effWin} วัน</b> ก่อน/หลัง` : ''}
    ${sc(['volume', 'violation', 'deploy'], t) ? ` · ช่วง : <b>${TRF.days} วันล่าสุด</b>` : ''}
  </div>`;
}

// โหมดดูทีละกล้อง (migration 180): สถานะ "ทุกกล้อง" ต้องไม่มีตั้งแต่แรก — ไม่งั้น
// default (TRF.cams = null = ไม่ส่งพารามิเตอร์) จะได้ข้อมูล "รวมทุกกล้องในสิทธิ์"
// ทั้งที่บัญชีถูกบังคับเลือกทีละตัว เพราะ parseCams() ฝั่ง server บังคับเฉพาะคำขอ
// ที่ส่งมาเกิน 1 (เจ้าของเจอจริง 2026-09-03 บัญชี demo ขึ้น "ทุกกล้อง (4)")
// default = กล้องตัวแรกในสิทธิ์ (เรียง id ให้ deterministic) · /api/cameras เป็น
// CORE route ที่กรองตาม user_cameras ให้แล้ว จึงได้เฉพาะตัวที่บัญชีนี้เห็นได้จริง
let _trfSinglePicked = false;
async function _trfEnsureSingleDefault() {
  try {
    const r = await fetch(`${API}/api/cameras`, { credentials: 'include' });
    const cams = await r.json();
    // /api/cameras ตอบ legacy shape: field ชื่อ `camera_id` (ไม่ใช่ `id`) — อ่านผิด
    // field แล้วได้ลิสต์ว่าง = ไม่ได้เลือก default → ชนกฎ 400 ทั้งหน้า (เจอจริง 2026-09-03)
    const ids = (Array.isArray(cams) ? cams : []).map(c => c.camera_id ?? c.id).filter(Boolean).sort();
    if (ids.length) TRF.cams = new Set([ids[0]]);
  } catch { /* เลือกให้ไม่ได้ = ปล่อยผ่าน radio ในหน้าต่างเลือกยังบังคับตอนกดอยู่ */ }
  _trfSinglePicked = true;
}

// เจ้าของเจอ 2026-09-17 (วัดจริงผ่าน Claude in Chrome, DOM สด): ปุ่มช่วงเวลาใน
// การ์ด "ย้อนหลัง" (และตัวควบคุมอื่นทุกตัวในหน้านี้ — date/month picker,
// trfMetric ฯลฯ) เรียก renderTraffic() ซึ่ง set #trfBody.innerHTML ใหม่ทั้งก้อน
// ทุกครั้ง — เบราว์เซอร์ clamp scrollTop ของ `.content` (scroll container ของ
// ทั้งแอป) กลับเป็น 0 ทันทีตอน replace innerHTML วัดจริง production: ก่อนคลิก
// scrollTop=754.7 หลังคลิก scrollTop=0 (scrollHeight แทบไม่เปลี่ยน 1970→1958
// ไม่ใช่ content ยุบถาวร แค่จังหวะว่างระหว่าง assignment) หน้าเด้งขึ้นบนสุด
// ผู้ใช้ที่ scroll ลงมาดูการ์ดอยู่แล้วมองไม่เห็นว่าค่าเปลี่ยน คิดว่าปุ่มไม่ทำงาน
// ทั้งที่ state/กราฟข้างในถูกต้องอยู่แล้ว — เก็บตำแหน่ง scroll ไว้ก่อนแล้ว
// restore ทันทีหลัง innerHTML แทน
function _trfPreserveScroll(fn) {
  const box = document.querySelector('.content');
  const y = box ? box.scrollTop : 0;
  fn();
  if (box) box.scrollTop = y;
}

function renderTraffic() {
  const el = document.getElementById('trfBody');
  if (!el) return;
  if (_trfCamSingle() && !_trfSinglePicked && (!TRF.cams || TRF.cams.size !== 1)) {
    _trfPreserveScroll(() => {
      el.innerHTML = `<div class="trf-note">${escapeHtml(I18N.t('trf.loading', 'กำลังโหลดข้อมูล…'))}</div>`;
    });
    _trfEnsureSingleDefault().then(() => renderTraffic());
    return;
  }
  // ไม่มี TRF.data ยังวาดได้ ถ้าแท็บที่เปิดอยู่ไม่ได้ใช้ข้อมูลก้อนนั้น (helmet/report/settings)
  // — ผู้ใช้ที่มีสิทธิ์แค่แท็บหมวกนิรภัยจะไม่มี TRF.data เลยตลอดกาล
  if (!TRF.data && TRF_TABS_NEEDING_ENFORCEMENT.includes(TRF.tab)) return;
  const LABELS = { volume: 'ปริมาณรถ', violation: 'วินัยจราจร', effect: 'ก่อน-หลังกวดขัน',
                   deploy: 'จุดที่ควรตั้งด่าน', helmet: 'สถิติหมวกนิรภัย',
                   topHelmet: 'อันดับไม่สวมหมวกนิรภัย', report: 'รายงาน', settings: 'ตั้งค่า' };
  // ซ่อนแท็บที่ผู้ใช้ไม่มีสิทธิ์ (ชั้นความสะดวก — server กันจริงอยู่แล้ว)
  const tabs = (typeof ViewsACL !== 'undefined' ? ViewsACL.filterTabs('traffic', TRF_TAB_KEYS) : TRF_TAB_KEYS)
    .map(k => [k, LABELS[k]]);
  _trfPreserveScroll(() => {
    el.innerHTML = `
      <div class="trf-tabs">${tabs.map(([k, l]) =>
        `<button class="trf-tab${TRF.tab === k ? ' on' : ''}" data-action="trfTab" data-tab="${k}">${l}</button>`).join('')}</div>
      ${(TRF.tab === 'report' || TRF.tab === 'settings' || TRF.tab === 'helmet' || TRF.tab === 'topHelmet') ? '' : trfScopeBar()}
      <div id="trfPanel"></div>`;
    const p = document.getElementById('trfPanel');
    if (TRF.tab === 'volume')    trfRenderVolume(p);
    if (TRF.tab === 'violation') trfRenderViolation(p);
    if (TRF.tab === 'effect')    trfRenderEffect(p);
    if (TRF.tab === 'deploy')    trfRenderDeploy(p);
    if (TRF.tab === 'helmet')    trfRenderHelmet(p);
    if (TRF.tab === 'topHelmet') trfRenderTopHelmet(p);
    if (TRF.tab === 'report')    trfRenderReport(p);
    if (TRF.tab === 'settings')  trfRenderSettings(p);
  });
}

// ── แท็บ 1 · ปริมาณรถ ───────────────────────────────────────
function trfRenderVolume(p) {
  const dows = _tdows();
  const series = trfSeriesByDow();
  p.innerHTML = `
    <div class="trf-card">
      <div class="trf-head"><div>
        <div class="trf-title">ปริมาณรถ${TRF.gran === 'day' ? 'รายชั่วโมง — แยกเส้นตามวันในสัปดาห์' : 'รายสัปดาห์ — เทียบวันต่อวัน'}</div>
        <div class="trf-sub">${TRF.gran === 'day' ? 'แกนนอน = ชั่วโมง · เส้นละวัน' : 'แกนนอน = วันในสัปดาห์'} · เฉลี่ยต่อวัน · เฉพาะรถ 2-3 ล้อ</div>
      </div>
      ${TRF.gran === 'day' ? `<div class="trf-seg sm">
        <button class="${TRF.volMode === 'cum' ? 'on' : ''}" data-action="trfVolMode" data-mode="cum">สะสม</button>
        <button class="${TRF.volMode === 'hour' ? 'on' : ''}" data-action="trfVolMode" data-mode="hour">รายชั่วโมง</button></div>` : ''}
      </div>
      ${_trfChartBox('trfChartVol', TRF.gran === 'day' ? 24 : 7, 'lg', TRF.gran === 'day' ? 26 : 62)}
      <div class="trf-insight" id="trfVolInsight"></div>
    </div>`;

  const cum = (a) => a.reduce((acc, v) => (acc.push((acc.length ? acc[acc.length - 1] : 0) + v), acc), []);
  let data;
  if (TRF.gran === 'day') {
    const isCum = TRF.volMode === 'cum';
    data = { labels: TRF_HOURS, datasets: dows.map(d => ({
      label: TRF_DOW[d], data: isCum ? cum(series[d]?.vol || Array(24).fill(0)) : (series[d]?.vol || []),
      borderColor: TRF_COLORS[d], borderWidth: 2, tension: .3, pointRadius: 0, pointHoverRadius: 4, fill: false })) };
  } else {
    data = { labels: dows.map(d => TRF_DOW[d]),
      datasets: [{ label: 'คัน/วัน', data: dows.map(d => (series[d]?.vol || []).reduce((a, b) => a + b, 0)),
        borderColor: token('--accent'), backgroundColor: token('--accent') + '22', borderWidth: 2.5, tension: .25, pointRadius: 4, fill: true }] };
  }
  trfChart('trfChartVol', { type: 'line', data,
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: trfLegend(), tooltip: { callbacks: { label: c => `${c.dataset.label}: ${_tfmt(c.parsed.y)} คัน` } } },
      scales: { x: { grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 10 }, callback: v => v >= 1000 ? (v / 1000) + 'k' : v } } } } });

  const totals = dows.map(d => (series[d]?.vol || []).reduce((a, b) => a + b, 0));
  const hi = dows[totals.indexOf(Math.max(...totals))], lo = dows[totals.indexOf(Math.min(...totals))];
  document.getElementById('trfVolInsight').innerHTML =
    `รถมากสุด <b>${TRF_DOW[hi] || '—'}</b> (${_tfmt(Math.max(...totals))} คัน/วัน) · น้อยสุด <b>${TRF_DOW[lo] || '—'}</b> (${_tfmt(Math.min(...totals))} คัน/วัน)`;
  trfRenderVolumeExtras(p);
}

// ── แท็บ 2 · วินัยจราจร ─────────────────────────────────────
// ── จุดที่พบการไม่สวมหมวกมากที่สุด (ย้ายมาจากหน้าอันดับป้ายทะเบียน 2026-08-27)
//
// 🔴 ตัวเลขที่ใช้ต้องเป็น `no_helmet` ของหน้านี้ ไม่ใช่ `hits` ของหน้าอันดับป้าย:
//   hits      = ครั้งที่พบ **เฉพาะคนที่ทำผิดซ้ำ** (ไม่สวมหมวก ≥3 ครั้ง และเกินครึ่ง
//               ของครั้งที่ผ่านกล้อง) — เป็นชุดที่ถูกกรองมาแล้ว
//   no_helmet = ครั้งที่พบไม่สวมหมวก **ทั้งหมด** ซึ่งเป็นตัวเดียวกับคอลัมน์
//               "จำนวนที่พบ" ในตารางที่อยู่ถัดลงไป
// ถ้าเอา hits มาวางเหนือตารางนั้น จะได้ตัวเลขรายกล้องสองชุดติดกัน ต่างกันหลายเท่า
// โดยไม่มีอะไรบนจอบอกว่าทำไม — เป็นความสับสนแบบเดียวกับที่ใช้เวลาทั้งวันไล่แก้
//
// เรียงจากจำนวน ส่วนตารางข้างล่างเรียงจากอัตรา — คนละคำถามกัน จึงเขียนกำกับไว้ทั้งคู่
// ว่าอันไหนตอบอะไร เพราะตอนนี้มันอยู่ติดกันแล้ว
function _trfCamRankCard(det) {
  const rows = det.filter(c => (c.no_helmet || 0) > 0)
                  .sort((a, b) => (b.no_helmet || 0) - (a.no_helmet || 0));
  if (!rows.length) return '';
  const cmax = rows[0].no_helmet || 1;
  const list = rows.map((c, i) => `
    <div class="trf-toprow"${i < 3 ? ' data-hot="1"' : ''}>
      <div class="trf-toprank">${i + 1}</div>
      <div class="trf-topname"><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.id)}</small></div>
      <div class="trf-topbarwrap"><div class="trf-topbar-bg"><div class="trf-topbar"
        style="width:${Math.max(5, c.no_helmet / cmax * 100).toFixed(1)}%"></div></div></div>
      <div class="trf-topval"><b>${_tfmt(c.no_helmet)}</b><span>ครั้ง</span></div>
    </div>`).join('');
  return `
    <div class="trf-card">
      <div class="trf-head"><div>
        <div class="trf-title">จุดที่พบการไม่สวมหมวกมากที่สุด</div>
        <div class="trf-sub">นับเฉพาะกล้องที่เปิดตรวจจับหมวก</div>
      </div></div>
      <div class="trf-toplist">${list}</div>
    </div>`;
}

function trfRenderViolation(p) {
  const dows = _tdows();
  const series = trfSeriesByDow();
  const w = trfHelmetPct();
  const cams = trfSelectedCams();
  const det = trfDetectingCams();
  const belt = TRF.data.belt_by_type || [];
  const beltTot = belt.reduce((a, t) => a + t.total, 0), beltBad = belt.reduce((a, t) => a + t.bad, 0);
  const motoPerDay = dows.reduce((a, d) => a + (series[d]?.vol || []).reduce((x, y) => x + y, 0), 0) / (dows.length || 1);
  const riders = cams.reduce((a, c) => a + c.riders3, 0);
  const noDet = cams.filter(c => !c.detect).length;

  p.innerHTML = `
    <div class="trf-kpis">
      <div class="trf-kpi" style="--kc:var(--status-bad)">
        <div class="k-l">ไม่สวมหมวกนิรภัย</div>
        <div class="k-n">${w == null ? '—' : _tpct(w) + '<span>%</span>'}</div>
        <div class="k-s">${w == null ? 'กล้องที่เลือกยังไม่เปิดตรวจจับ'
          : `≈ ${_tfmt(motoPerDay * w / 100)} คัน/วัน · ตัวหาร = <b>รถ 2-3 ล้อ</b> จาก ${det.length} กล้องที่ตรวจจับได้`}</div>
      </div>
      <div class="trf-kpi" style="--kc:var(--warn)">
        <div class="k-l">ไม่คาดเข็มขัดนิรภัย</div>
        <div class="k-n">${beltTot ? (beltBad / beltTot * 100).toFixed(2) : '0.00'}<span>%</span></div>
        <div class="k-s">${_tfmt(beltBad)} จากรถ 4 ล้อขึ้นไป ${_tfmt(beltTot)} คัน · ตัวหารคนละชุดกับหมวก</div>
      </div>
      <div class="trf-kpi" style="--kc:var(--accent)">
        <div class="k-l">ซ้อน 3 คนขึ้นไป</div>
        <div class="k-n">${_tfmt(riders)}<span> คัน</span></div>
        <div class="k-s">นับจาก rider_count ≥ 3 ใน ${TRF.days} วัน</div>
      </div>
      ${noDet ? `<div class="trf-kpi" style="--kc:var(--text-secondary)">
        <div class="k-l">กล้องที่ยังไม่เปิดตรวจจับ</div>
        <div class="k-n">${noDet}<span> ตัว</span></div>
        <div class="k-s">กันออกจากค่าเฉลี่ยแล้ว ไม่นับเป็น 0%</div></div>` : ''}
    </div>

    <div class="trf-card">
      <div class="trf-head">
        <div>
          <div class="trf-title">${TRF.metric === 'pct' ? 'อัตราไม่สวมหมวกนิรภัย รายชั่วโมง' : 'จำนวนคันที่ไม่สวมหมวก รายชั่วโมง'}</div>
          <div class="trf-sub">${TRF.metric === 'pct'
            ? 'ตัวหาร = <b>รถ 2-3 ล้อเท่านั้น</b> · ตอบว่า “วินัยแย่แค่ไหน” · เส้นละวันในสัปดาห์'
            : 'เฉลี่ยคันต่อวัน · ตอบว่า “ตั้งด่านแล้วจะเจอกี่คัน” · เส้นละวันในสัปดาห์'}</div>
        </div>
        <div class="trf-seg sm">
          <button class="${TRF.metric === 'pct' ? 'on' : ''}" data-action="trfMetric" data-metric="pct">อัตรา %</button>
          <button class="${TRF.metric === 'abs' ? 'on' : ''}" data-action="trfMetric" data-metric="abs">จำนวนคัน</button>
        </div>
      </div>
      ${_trfChartBox('trfChartHelmet', TRF.gran === 'day' ? 24 : 7, 'lg', TRF.gran === 'day' ? 26 : 62)}
      <div class="trf-insight" id="trfHelmetInsight"></div>
    </div>

    ${_trfCamRankCard(det)}

    <div class="trf-card">
      <div class="trf-title">อัตราฝ่าฝืนรายกล้อง</div>
      <div class="trf-sub">เรียงจาก<b>อัตรา</b>มากไปน้อย · ตอบว่ากล้องไหน “วินัยแย่ที่สุด”</div>
      <div class="trf-tablewrap"><table class="trf-table" id="trfCamTable"></table></div>
    </div>`;

  const scale = trfRateScale();
  const isPct = TRF.metric === 'pct';
  trfChart('trfChartHelmet', { type: 'line',
    data: { labels: TRF_HOURS, datasets: dows.map(d => ({
      label: TRF_DOW[d],
      data: isPct ? (series[d]?.pct || []).map(v => v == null ? null : Math.min(95, v * scale))
                  : (series[d]?.abs || []),
      borderColor: TRF_COLORS[d], borderWidth: 2.5, tension: .3, pointRadius: 0, pointHoverRadius: 4 })) },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: trfLegend(), tooltip: { callbacks: { label: c =>
        isPct ? `${c.dataset.label}: ${_tpct(c.parsed.y)}%` : `${c.dataset.label}: ${_tfmt(c.parsed.y)} คัน/วัน` } } },
      scales: { x: { grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: _tgrid() },
          title: { display: true, text: isPct ? 'อัตราฝ่าฝืน (%)' : 'คัน/วัน', color: _ttext(), font: { size: 10 } },
          ticks: { color: _ttext(), font: { size: 10 },
            callback: v => isPct ? v + '%' : (v >= 1000 ? (v / 1000) + 'k' : v) } } } } });

  // รวมทุกวันที่เลือกเป็นเส้นเดียวเพื่อหา "ชั่วโมงที่แย่สุด" ของแต่ละมุม
  const sumPct = Array(24).fill(0), cntPct = Array(24).fill(0), sumAbs = Array(24).fill(0);
  dows.forEach(d => {
    (series[d]?.pct || []).forEach((v, h) => { if (v != null) { sumPct[h] += v * scale; cntPct[h]++; } });
    (series[d]?.abs || []).forEach((v, h) => { sumAbs[h] += v; });
  });
  const avgPct = sumPct.map((v, h) => cntPct[h] ? v / cntPct[h] : null);
  const hPct = avgPct.indexOf(Math.max(...avgPct.filter(v => v != null)));
  const hAbs = sumAbs.indexOf(Math.max(...sumAbs));
  if (cntPct.some(Boolean)) {
    document.getElementById('trfHelmetInsight').innerHTML =
      `<b>สองมุมนี้ชี้คนละเวลากัน และนี่คือเหตุผลที่ต้องมีปุ่มสลับ:</b><br>` +
      `· <b>อัตราสูงสุด</b> ${TRF_HOURS[hPct]} (${_tpct(avgPct[hPct])}%) — ช่วงรถน้อย คนใส่หมวกน้อยที่สุด ` +
      `เหมาะกับการวัดว่า “วินัยดีขึ้นไหม”<br>` +
      `· <b>จำนวนสูงสุด</b> ${TRF_HOURS[hAbs]} (${_tfmt(sumAbs[hAbs])} คัน/วัน) — ช่วงรถแน่น ` +
      `เหมาะกับการเลือกว่า “ไปตั้งด่านตอนไหนถึงจะเจอเยอะที่สุด”<br>` +
      `ถ้าดูอัตราอย่างเดียวจะไปตั้งด่านตอนที่แทบไม่มีรถผ่าน`;
  }

  const rows = cams.slice().sort((a, b) => (b.helmet_pct ?? -1) - (a.helmet_pct ?? -1));
  const maxPct = Math.max(...rows.map(r => r.helmet_pct || 0), 1);
  document.getElementById('trfCamTable').innerHTML =
    `<thead><tr><th>จุดติดตั้ง</th><th>Site</th><th class="n">รถ 2-3 ล้อ</th><th class="n">ไม่สวมหมวก</th>
      <th class="bar">เทียบกัน</th><th class="n">จำนวนที่พบ</th></tr></thead>
     <tbody>${rows.map(c => `<tr>
       <td>${escapeHtml(c.name)}</td>
       <td>${c.site_code ? `<span class="trf-badge" style="--sc:${escapeHtml(c.site_color || 'var(--accent)')}"><span class="dot"></span>${escapeHtml(c.site_name || c.site_code)}</span>` : '<span class="dim">—</span>'}</td>
       <td class="n">${_tfmt(c.moto)}</td>
       <td class="n ${c.detect ? (c.helmet_pct >= 30 ? 'bad' : c.helmet_pct >= 18 ? '' : 'ok') : ''}">${
         c.detect ? _tpct(c.helmet_pct) + '%' : '<span class="trf-nodetect">ยังไม่เปิดตรวจจับ</span>'}</td>
       <td class="bar">${c.detect ? `<div class="mb"><i style="width:${(c.helmet_pct / maxPct * 100).toFixed(1)}%"></i></div>` : '<span class="dim">—</span>'}</td>
       <td class="n">${c.detect ? _tfmt(c.no_helmet) : '<span class="dim">—</span>'}</td>
     </tr>`).join('')}</tbody>`;
  trfRenderViolationExtras(p);
}

// ── แท็บ 3 · จุดที่ควรตั้งด่าน ───────────────────────────────
function trfRenderDeploy(p) {
  const series = trfSeriesByDow();
  const scale = trfRateScale();
  p.innerHTML = `
    <div class="trf-card">
      <div class="trf-head"><div>
        <div class="trf-title">ตารางความหนาแน่นการฝ่าฝืน — ชั่วโมง × วันในสัปดาห์</div>
        <div class="trf-sub">สีเข้ม = อัตราไม่สวมหมวกสูง</div>
      </div></div>
      <div class="trf-heatwrap"><div class="trf-heat" id="trfHeat"></div></div>
      <div class="trf-insight" id="trfHeatInsight"></div>
    </div>
    <div class="trf-card">
      <div class="trf-title">จุดที่ควรไปตั้งด่าน</div>
      <div class="trf-sub">เรียงตาม <b>จำนวนคันที่คาดว่าจะพบฝ่าฝืนต่อชั่วโมง</b> = อัตรา × ปริมาณรถ
        ไม่ใช่ดูอัตราอย่างเดียว (จุดที่อัตราสูงแต่รถน้อย จับได้น้อยกว่าจุดที่อัตรากลางแต่รถเยอะ)</div>
      <div class="trf-tablewrap"><table class="trf-table" id="trfDeployTable"></table></div>
    </div>`;

  const grid = [];
  for (let d = 1; d <= 7; d++) grid.push((series[d]?.pct || Array(24).fill(null)).map(v => v == null ? null : v * scale));
  const flat = grid.flat().filter(v => v != null);
  const lo = Math.min(...flat), hi = Math.max(...flat);
  const shade = (v) => v == null ? 'background:var(--surface-base)'
    : `background:color-mix(in srgb, var(--status-bad) ${Math.round(8 + (hi > lo ? (v - lo) / (hi - lo) : 0) * 72)}%, transparent)`;
  let html = '<div class="hl"></div>' + TRF_HOURS.map((h, i) => `<div class="hh">${i % 2 === 0 ? h.slice(0, 2) : ''}</div>`).join('');
  grid.forEach((row, i) => {
    html += `<div class="hl">${TRF_DOW[i + 1].slice(0, 2)}</div>`;
    html += row.map((v, h) => `<div class="hc" style="${shade(v)}" title="${TRF_DOW[i + 1]} ${TRF_HOURS[h]} — ${v == null ? 'ไม่มีข้อมูล' : _tpct(v) + '%'}"></div>`).join('');
  });
  document.getElementById('trfHeat').innerHTML = html;

  let worst = { v: -1 };
  grid.forEach((row, d) => row.forEach((v, h) => { if (v != null && v > worst.v) worst = { v, d, h }; }));
  document.getElementById('trfHeatInsight').innerHTML = worst.v < 0 ? 'ยังไม่มีข้อมูลพอ'
    : `ช่องที่แย่ที่สุดคือ <b>${TRF_DOW[worst.d + 1]} ${TRF_HOURS[worst.h]}</b> ที่ <b>${_tpct(worst.v)}%</b>`;

  // อันดับจุด × ช่วงเวลา จากข้อมูลจริงรายชั่วโมงของแต่ละกล้อง
  const rows = [];
  trfDetectingCams().forEach(c => {
    const camShare = c.moto / Math.max(1, trfDetectingCams().reduce((a, x) => a + x.moto, 0));
    [7, 8, 17, 18, 22, 23].forEach(h => {
      const perDow = _tdows().map(d => series[d]?.vol?.[h] || 0);
      const vol = perDow.reduce((a, b) => a + b, 0) / (perDow.length || 1) * camShare;
      const rate = (c.helmet_pct || 0);
      rows.push({ cam: c.name, site: c.site_name || c.site_code, color: c.site_color, hour: TRF_HOURS[h], vol, rate, expect: vol * rate / 100 });
    });
  });
  rows.sort((a, b) => b.expect - a.expect);
  document.getElementById('trfDeployTable').innerHTML =
    `<thead><tr><th>จุดติดตั้ง</th><th>Site</th><th>ช่วงเวลา</th><th class="n">รถ/ชม.</th><th class="n">อัตรา</th><th class="n">คาดว่าพบ</th></tr></thead>
     <tbody>${rows.slice(0, 15).map(r => `<tr>
       <td>${escapeHtml(r.cam)}</td>
       <td>${r.site ? `<span class="trf-badge" style="--sc:${escapeHtml(r.color || 'var(--accent)')}"><span class="dot"></span>${escapeHtml(r.site)}</span>` : '—'}</td>
       <td>${r.hour}</td><td class="n">${_tfmt(r.vol)}</td>
       <td class="n ${r.rate >= 30 ? 'bad' : ''}">${_tpct(r.rate)}%</td>
       <td class="n"><b>${_tfmt(r.expect)}</b></td></tr>`).join('')}</tbody>`;
}

// ── แท็บ · สถิติหมวกนิรภัย (pilot/demo, decision #243) ────────────────
// ตัวเลือกเดียว = Site + กล้อง (reuse TRF.sites/TRF.cams + modal เดียวกับ
// แท็บอื่นทั้งหมด — ไม่มี modal/state แยก) ตัวกรองอื่น (ช่วงเวลา/ประเภทรถ/วัน)
// ตัดออกตามคำขอเจ้าของ ("ตัวเลือกอื่นตัดออกหมด") — ดู trfScopeBar() ที่ข้าม
// แท็บนี้ไปเลย, แท็บนี้วาด scope bar ของตัวเองแค่ site+กล้อง
//
// ต่างจากแท็บอื่นตรงที่ต้อง fetch endpoint แยก (/api/traffic/helmet-series)
// เพราะกรองกล้อง/ไม่เปิดตรวจจับจริงฝั่ง SQL (ไม่ใช่สเกลฝั่งจอแบบ trfShare())
// — สลับ site/กล้องจึง refetch ใหม่ทุกครั้ง (เทียบ signature ของขอบเขตที่เลือก)
const TRF_HELMET = {
  date: null,       // วันที่ของกราฟ "24 ชม." (YYYY-MM-DD)
  maxDate: null,    // เพดานเลือกได้ = เมื่อวาน (ครบ 24 ชม.แน่นอน)
  todayDate: null,  // วันนี้ (= maxDate + 1) — ปุ่ม 3/5/7 วันยึดตัวนี้ · การ์ด 24 ชม. ยังยึด maxDate
  rangeDays: 7,     // 3|5|7|'custom' — กราฟ "ย้อนหลัง" (แทนที่รายสัปดาห์ จันทร์-ศุกร์ เดิม
                     // ตามคำขอเจ้าของ 2026-08-12 — เปลี่ยนเป็น rolling N วันแทน)
  rangeFrom: null,  // ใช้เฉพาะโหมด custom (YYYY-MM-DD)
  rangeTo: null,    // ใช้เฉพาะโหมด custom (YYYY-MM-DD)
  month: null,      // YYYY-MM ของกราฟ "รายเดือน"
  data: null,
  loading: false,
  loadedSig: null,
  loadError: null,
};

const TRF_HELMET_SLOTS = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

function _trfHelmetScopedCamIds() {
  if (!TRF.sites.size && !TRF.cams) return null;
  const ids = _trfHelmetCams().map(c => c.id);
  // ยังไม่มีรายชื่อกล้องจาก server (fetch แรกของแท็บ) → intersect แล้วได้ []
  // ซึ่งจะกลายเป็น `cameras=` ว่างในคำขอ — บัญชีโหมด single โดน 400 ตั้งแต่โหลดแรก
  // (parseCams เข้มกับคำขอไม่ระบุกล้องแล้ว 2026-09-03) → ใช้ id ที่เลือกไว้ตรงๆ แทน
  if (!ids.length && TRF.cams && TRF.cams.size) return [...TRF.cams];
  return ids;
}

function trfRenderHelmet(p) {
  const camIds = _trfHelmetScopedCamIds();
  // sig ต้องรวม date ด้วย ไม่ใช่แค่ camIds — ไม่งั้นเปลี่ยนวันที่กราฟ 24 ชม.
  // แล้ว sig เดิม (ไม่เปลี่ยน) จะทำให้ trfRenderHelmet() คิดว่าข้อมูลที่มีอยู่ยัง
  // ใช้ได้ ไม่ refetch เลย — บั๊กที่เจ้าของรายงานจริง (เลือกวันที่แล้วไม่มีข้อมูล)
  const sig = `${camIds ? [...camIds].sort().join(',') : '*'}|${TRF_HELMET.date || ''}`;
  if (TRF_HELMET.loading) return;
  // เช็คแค่ sig เปลี่ยนหรือไม่ — ไม่เช็ค !TRF_HELMET.data ด้วย เพราะ fetch ที่พัง
  // ก็ทำให้ data เป็น null เหมือนกัน ถ้าเช็คทั้งคู่จะ fetch ซ้ำไม่หยุดทุกครั้งที่ error
  // (loadedSig ถูก set แล้วแต่ data ยังเป็น null) — ดู GOTCHAS ก่อน commit
  if (TRF_HELMET.loadedSig !== sig) {
    p.innerHTML = `<div class="trf-note">${escapeHtml(I18N.t('trf.loading', 'กำลังโหลดข้อมูล…'))}</div>`;
    _trfLoadHelmet(sig, camIds);
    return;
  }
  _trfRenderHelmetBody(p);
}

async function _trfLoadHelmet(sig, camIds) {
  TRF_HELMET.loading = true;
  try {
    const qs = new URLSearchParams();
    if (TRF_HELMET.date) qs.set('date', TRF_HELMET.date);
    if (camIds) qs.set('cameras', camIds.join(','));
    const r = await fetch(`${API}/api/traffic/helmet-series?${qs}`, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    TRF_HELMET.data = d;
    if (!TRF_HELMET.date) TRF_HELMET.date = d.date;
    if (!TRF_HELMET.maxDate) {
      TRF_HELMET.maxDate = d.date;
      const today = _trfHelmetDateAdd(d.date, 1); // server ส่ง "เมื่อวาน" มา — วันนี้ = +1
      // เก็บไว้ต่างหากจาก maxDate — maxDate ยังต้องเป็น "วันที่ข้อมูลครบสมบูรณ์"
      // สำหรับการ์ด 24 ชั่วโมง ซึ่งเจ้าของสั่งไม่ให้แตะ (2026-08-27)
      TRF_HELMET.todayDate = today;
      if (!TRF_HELMET.month) TRF_HELMET.month = today.slice(0, 7);
    }
  } catch (e) {
    TRF_HELMET.data = null;
    TRF_HELMET.loadError = e.message;
  } finally {
    // set เสมอไม่ว่าสำเร็จหรือพัง — พังแล้วต้อง "จำ" ว่า sig นี้ลองแล้ว ไม่งั้น
    // trfRenderHelmet() จะเห็น sig ไม่ตรง (เพราะยังไม่เคย set) แล้วยิงซ้ำไม่หยุด
    TRF_HELMET.loadedSig = sig;
    TRF_HELMET.loading = false;
    // ผู้ใช้อาจสลับแท็บระหว่างรอ fetch ค้าง — render ซ้ำเฉพาะถ้ายังอยู่แท็บนี้
    if (TRF.tab === 'helmet') renderTraffic();
  }
}

// แท็บนี้ต้องเลี้ยงตัวเองได้ — /helmet-series ส่ง cameras + sites มาให้อยู่แล้ว
// ถ้ายังอ่านจาก TRF.data (ของ /enforcement) ผู้ใช้ที่มีสิทธิ์แค่แท็บนี้จะไม่มีข้อมูลเลย
// เพราะเราไม่ยิง /enforcement ให้เขาตั้งแต่ต้น (decision #250 ทางเลือก B)
function _trfHelmetSrc() { return TRF_HELMET.data || TRF.data || {}; }
function _trfHelmetCams() {
  const all = _trfHelmetSrc().cameras || [];
  return all.filter(c =>
    (!TRF.sites.size || TRF.sites.has(c.site_code)) &&
    (!TRF.cams || TRF.cams.has(c.id)));
}

// ป้ายบอกขอบเขตกล้อง — ใช้ร่วมกันทุกแท็บ
// 1 ตัว = บอกชื่อไปเลย (ไม่ว่าจะเพราะผู้ใช้เลือกเอง หรือเพราะถูกจำกัดสิทธิ์ไว้แค่ตัวนั้น)
// กล่องกราฟ — บนมือถือ (≤768px) กราฟที่มีจุดเยอะจะถูกบีบจนอ่านไม่ออก (48 ช่วงเวลา
// ในจอ 390px = ป้ายเวลาเบียดทับกันจนเป็นแถบดำ) จึงให้เลื่อนแนวนอนแทน โดยกว้างตาม
// จำนวนจุดจริง · ใช้แพทเทิร์นเดียวกับ .trf-heatwrap ที่มีอยู่แล้วในหน้านี้
// เดสก์ท็อปไม่เปลี่ยนอะไรเลย — `.cx` กว้าง 100% ตามเดิม
function _trfChartBox(id, pts, cls, pxPerPoint) {
  const w = Math.max(1, Number(pts) || 24) * (Number(pxPerPoint) || 26);
  return `<div class="trf-chart${cls ? ' ' + cls : ''} scrollx">` +
         `<div class="cx" style="--w:${Math.round(w)}px"><canvas id="${id}"></canvas></div></div>`;
}

function _trfCamLabel(cams) {
  if (cams.length === 1) return cams[0].name || cams[0].id;
  if (!TRF.cams) return `ทุกกล้อง (${cams.length})`;
  return `เลือกไว้ ${TRF.cams.size} กล้อง`;
}

function _trfHelmetScopeBar() {
  const src = _trfHelmetSrc();
  const sites = (src.sites || []).filter(s =>
    (src.cameras || []).some(c => c.site_code === s.code));
  const cams = _trfHelmetCams();
  // เหลือกล้องเดียวต้องบอกชื่อ ไม่ใช่ "ทุกกล้อง (1)" — ผู้ใช้ที่ถูกจำกัดไว้กล้องเดียว
  // (user_cameras) ไม่ได้เลือกเอง `TRF.cams` จึงเป็น null แต่ในทางปฏิบัติเขาเห็นกล้องเดียว
  // การเขียนว่า "ทุกกล้อง" ทำให้เข้าใจผิดว่ากำลังดูภาพรวมทั้ง Site (เจ้าของแจ้ง 2026-08-12)
  const camLabel = _trfCamLabel(cams);
  const siteChips = sites.map(s => {
    const n = (src.cameras || []).filter(c => c.site_code === s.code).length;
    const on = TRF.sites.has(s.code);
    return `<button type="button" class="trf-site${on ? ' on' : ''}" data-action="trfSite" data-site="${escapeHtml(s.code)}"
      style="--sc:${escapeHtml(s.color || 'var(--accent)')}" aria-pressed="${on}">
      <span class="dot"></span>${escapeHtml(s.name)} <span class="n">${n}</span></button>`;
  }).join('');
  return `
  <div class="trf-scope">
    ${sites.length > 1 ? `<div class="trf-grp"><span class="trf-lbl">Site</span>
      <div class="trf-sites">${siteChips}
        <button type="button" class="btn-mini" data-action="trfSiteAll">ทุก Site</button></div></div>` : ''}
    <div class="trf-grp"><span class="trf-lbl">กล้อง</span>
      <button class="btn-mini" data-action="trfOpenCams">${escapeHtml(camLabel)}</button></div>
  </div>`;
}

// ── 4 กราฟเรียงต่อกัน (ไม่มีปุ่มสลับ) ตามคำขอเจ้าของ 2026-08-11 ─────────
// ปุ่ม Export PDF (owner ask 2026-09-03) — ได้ "ไฟล์ PDF จัด A4" ตรงๆ ไม่ใช่ print dialog
// (แบบ window.print() โดนตีกลับ: เบราว์เซอร์จัดหน้าเองไม่พอดี A4) · วิธี: จับ DOM ของแท็บ
// ที่แสดงอยู่ (WYSIWYG ตาม filter ปัจจุบัน) แปลงกราฟ canvas เป็นภาพจากจอจริง แล้วส่งให้
// server ประกอบกับ CSS ของ dashboard และ render เป็น A4 ด้วย Puppeteer ฝั่ง server
function _trfExportBar() {
  return `<div class="trf-exportbar"><button class="btn btn-secondary" data-action="trfExportPdf">
    <svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg>
    <span>Export PDF</span></button></div>`;
}
window.trfExportPdf = async function (btn) {
  const p = document.getElementById('trfBody');
  if (!p) return;
  const label = btn?.querySelector('span');
  const orig = label ? label.textContent : '';
  if (label) label.textContent = 'กำลังสร้าง…';
  if (btn) btn.disabled = true;
  try {
    const clone = p.cloneNode(true);
    // ลำดับ querySelectorAll ของ clone ตรงกับต้นฉบับเสมอ — แทน canvas ตัวที่ i ด้วย
    // ภาพจากจอจริง (toDataURL) ตัวที่ i
    const liveCv = p.querySelectorAll('canvas');
    const cloneCv = clone.querySelectorAll('canvas');
    liveCv.forEach((cv, i) => {
      try {
        const img = document.createElement('img');
        img.src = cv.toDataURL('image/png');
        img.style.width = '100%';
        cloneCv[i]?.replaceWith(img);
      } catch { cloneCv[i]?.remove(); }
    });
    // ของ interactive ไม่มีความหมายบนกระดาษ — ขอบเขตที่เลือกใส่เป็นบรรทัดใน header แทน
    // ⚠️ ห้ามกวาด <button> ทั้งหมด: ชิปป้ายทะเบียน (.trf-plaque) กับ "+N ป้าย" เป็น
    // <button> เหมือนกันแต่เป็น "เนื้อหา" — เคยหายทั้งแถบ (เจ้าของทัก 2026-09-03)
    clone.querySelectorAll(
      '.trf-exportbar, .trf-modal, .trf-scope, .tabs, button.btn, button.tab, button.btn-mini, select, input'
    ).forEach(el => el.remove());
    const tabLabel = TRF.tab === 'helmet'
      ? I18N.t('trf.tabHelmet', 'สถิติหมวกนิรภัย')
      : I18N.t('trf.tabTopHelmet', 'อันดับไม่สวมหมวกนิรภัย');
    // เลือกกล้องเดียว = หัวรายงานต้องบอก **ชื่อกล้อง** และ **ไซต์ของกล้องตัวนั้น**
    // ไม่ใช่ "ทุก Site · 1 กล้องที่เลือก" ซึ่งจริงตามตัวกรองแต่ไม่ตอบว่ารายงานนี้คือที่ไหน
    // (เจ้าของทัก 2026-09-09) · ใช้ตัวช่วยเดิมที่แถบขอบเขตบนหน้าจอใช้อยู่แล้ว
    const _expCams = _trfHelmetCams();
    const _expOne = _expCams.length === 1 ? _expCams[0] : null;
    const scopeBits = [
      TRF.sites.size ? [...TRF.sites].join(', ')
        : (_expOne ? (_expOne.site_name || _expOne.site_code || 'ทุก Site') : 'ทุก Site'),
      _trfCamLabel(_expCams),
    ];
    if (TRF.tab === 'topHelmet') {
      scopeBits.push(TRF_TOP.period === 'custom' && TRF_TOP.from
        ? `${TRF_TOP.from} ถึง ${TRF_TOP.to || TRF_TOP.from}`
        : TRF_TOP.period === 'month' ? `รายเดือน ${TRF_TOP.month || ''}` : `ช่วงเวลา: ${_trfPeriodLabel(TRF_TOP.period)}`);
    } else if (TRF_HELMET.date) {
      scopeBits.push(`กราฟ 24 ชม. วันที่ ${TRF_HELMET.date}`);
    }
    const r = await fetch(`${API}/api/traffic/export-page.pdf`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab: TRF.tab, title: `รายงาน - ${tabLabel}`,
                             scope: scopeBits.join(' · '), html: clone.innerHTML }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'HTTP ' + r.status); }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // ชื่อไฟล์ต้องบอกว่าเป็นรายงานอะไรตั้งแต่ในโฟลเดอร์ดาวน์โหลด — คำว่า traffic
    // ไม่ได้แยกอะไรเลยเพราะทุกไฟล์จากหน้านี้ก็ traffic ทั้งหมด (เจ้าของสั่ง 2026-09-09)
    const fileBase = TRF.tab === 'topHelmet' ? 'top-helmet-report' : 'helmet-report';
    a.download = `${fileBase}-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) {
    alert('Export PDF ไม่สำเร็จ: ' + e.message);
  } finally {
    if (label) label.textContent = orig;
    if (btn) btn.disabled = false;
  }
};

function _trfRenderHelmetBody(p) {
  if (!TRF_HELMET.data) {
    p.innerHTML = `${_trfHelmetScopeBar()}<div class="trf-note bad">${escapeHtml(I18N.t('trf.failed', 'โหลดไม่สำเร็จ:'))} ${escapeHtml(TRF_HELMET.loadError || '')}</div>`;
    return;
  }
  p.innerHTML = `${_trfHelmetScopeBar()}${_trfExportBar()}<div id="trfHelmetG1"></div><div id="trfHelmetG2"></div><div id="trfHelmetG3"></div><div id="trfHelmetG4"></div>`;
  _trfHelmetRenderRealtime(document.getElementById('trfHelmetG1'));
  _trfHelmetRender24h(document.getElementById('trfHelmetG2'));
  _trfHelmetRenderRange(document.getElementById('trfHelmetG3'));
  _trfHelmetRenderMonth(document.getElementById('trfHelmetG4'));
}

function trfHelmetDateChange(el) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
  TRF_HELMET.date = el.value;
  renderTraffic();
}

// ── นับจำนวนคันไม่สวมหมวกล้วน ๆ — ตัดโหมดอัตรา % ออกตามคำขอเจ้าของ 2026-08-12
// (ทำให้เข้าใจตรงกันง่ายกว่า ไม่ต้องอธิบายตัวหาร) รวม helper ไว้ที่เดียว
// ทุกกราฟเรียก แทนที่จะเขียนซ้ำ 4 รอบ
function _trfHelmetData(rows) { return rows.map(r => r.no_helmet); }
function _trfHelmetOverall(rows) { return rows.reduce((a, r) => a + r.no_helmet, 0); }
// คืน null ถ้าไม่มี bucket ไหนมีค่าเลย — แยก "ไม่มีข้อมูล" ออกจาก "มีแต่เป็นศูนย์"
function _trfHelmetOverallOk(rows) {
  const has = rows.some(r => r && r.no_helmet_ok != null);
  return has ? rows.reduce((a, r) => a + (r && r.no_helmet_ok != null ? r.no_helmet_ok : 0), 0) : null;
}
function _trfHelmetFmt(v) { return `${_tfmt(v)} คัน`; }
function _trfHelmetYTicks() {
  return { beginAtZero: true, grid: { color: _tgrid() },
    ticks: { color: _ttext(), font: { size: 10 }, callback: v => _tfmt(v) } };
}
const _trfHelmetLabel = () => 'จำนวนคันไม่สวมหมวก';

// ── คำของ "เลขคู่" — ต้องตรงกันทุกหน้าของระบบ (เจ้าของสั่ง 2026-08-22)
//    หน้าไหนแสดงตัวเลขหมวกนิรภัย ต้องแสดงทั้งคู่เสมอ ห้ามโชว์ตัวเดียวโดด ๆ
//    เพราะนั่นคือต้นเหตุที่ 3 หน้าเคยให้เลขต่างกัน 21% โดยไม่มีใครอธิบายได้
// เหลือเลขเดียว (เจ้าของสั่ง 2026-08-27) — กลับด้านจากคำสั่ง 2026-08-23 ที่ให้โชว์คู่
//
// เหตุผลของเจ้าของ: "เราไม่ใช่คนตัดสินว่าหลักฐานใช้ได้หรือไม่ได้ เราเป็นแค่คนนำสาร
// ไปให้ตำรวจ" · และส่วนต่างที่ถูกกรองออกก็เอาไปทำอะไรต่อไม่ได้อยู่ดี (ไม่รู้ทะเบียน
// = แจ้งใครไม่ได้) การโชว์คู่จึงเพิ่มความสับสน ไม่ได้เพิ่มข้อมูล
//
// ชื่อมาจาก helmetCriteria.LABELS ฝั่ง server เพื่อไม่ให้สองฝั่งเพี้ยนกัน — ที่นี่
// เขียนซ้ำเพราะเป็นสคริปต์เบราว์เซอร์ require ไม่ได้ (รูปแบบเดียวกับ HR_LABELS)
const _TRF_H_METRIC = 'ไม่สวมหมวก · พร้อมข้อมูลทะเบียน';
// ไม่มีคำอธิบายใต้เลข — เจ้าของถอด 2026-08-27 ("ชัดพอ" เป็นการตัดสินแทนคนอ่าน)
// ชื่อตัวชี้วัดบอกไปแล้วว่านับเฉพาะที่มีข้อมูลทะเบียน

// "ข้อมูล ณ HH:MM" — เวลาที่ตัวเลขถูกคำนวณจริง ไม่ใช่เวลาที่เปิดหน้า
// สองหน้าที่ cache หมดอายุคนละจังหวะจะได้เลขต่างกันเล็กน้อยเสมอ ตราบใดที่ภูเก็ต
// ยังส่งข้อมูลย้อนหลัง — บอกเวลาไว้ ผู้ใช้จะเห็นเองว่าเป็นภาพคนละนาที ไม่ใช่ขัดกัน
function _trfStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return ` · ข้อมูล ณ ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

// การ์ดสรุปของแท็บ "อันดับไม่สวมหมวก" — แยกออกมาเพราะต้องแสดงได้แม้ตารางอันดับว่าง
// (ไม่มีป้ายทำผิดซ้ำ ≠ ไม่มีการตรวจพบ) · การ์ดใบที่ 2 และ 3 คิดจากชุด "หลักฐาน"
// จึงต้องเขียนกำกับไว้ ไม่งั้นอ่านคู่กับใบแรกแล้วขัดกันเอง
function _trfTopKpis(t, peakH, stampAt) {
  return `
    <div class="trf-kpis">
      <div class="trf-kpi" style="--kc:var(--status-bad)">
        <div class="k-l">${_TRF_H_METRIC}</div>
        <div class="k-n">${_tfmt(t.hits || 0)}</div>
        <div class="k-s">ครั้ง${_trfStamp(stampAt)}</div>
      </div>
      <div class="trf-kpi" style="--kc:var(--warn)">
        <div class="k-l">ป้ายทะเบียนที่เกี่ยวข้อง</div>
        <div class="k-n">${_tfmt(t.plates || 0)}</div>
        <div class="k-s">คัน (นับป้ายไม่ซ้ำ) · จากชุดเดียวกัน</div>
      </div>
      <div class="trf-kpi" style="--kc:var(--accent)">
        <div class="k-l">สูงสุดต่อคัน</div>
        <div class="k-n">${_tfmt(t.max_per_plate || 0)}</div>
        <div class="k-s">ครั้ง · สูงสุดในชุดเดียวกัน</div>
      </div>
      <div class="trf-kpi" style="--kc:var(--accent)">
        <div class="k-l">ช่วงเวลาที่พบมากที่สุด</div>
        <div class="k-n">${peakH ? String(peakH.h).padStart(2, '0') + ':00' : '—'}</div>
        <div class="k-s">${peakH ? _tfmt(peakH.hits) + ' ครั้ง' : ''}</div>
      </div>
    </div>`;
}
// Badge มุมขวาบนของแต่ละการ์ด (แทนที่ข้อความ "เฉลี่ยเท่าที่มีข้อมูล" เดิมที่ฝังใน
// subtitle) — ใช้ร่วมกันทั้ง 4 กราฟตามคำขอเจ้าของ 2026-08-12
// ⚠️ ป้ายเคยเขียนว่า "ข้อมูลเฉลี่ยสะสม" ซึ่งผิด — ค่านี้คือผลรวมล้วน ๆ
// (_trfHelmetOverall = reduce บวกกันตรง ๆ) คำว่า "เฉลี่ย" ตกค้างมาจากตอนที่การ์ด
// เคยแสดงอัตรา % ซึ่งถูกถอดออกไปแล้ว 2026-08-12
// withStamp: "ข้อมูล ณ HH:MM" มีความหมายเฉพาะกราฟ Realtime — เวลานั้นคือเวลาที่
// เลขสด (ของวันที่ยังไม่จบ) ถูกคิด ผู้ใช้เทียบกับกราฟ 24 ชม.แล้วเลขไม่ตรงเป๊ะได้
// (เจ้าของทัก 2026-09-16): กราฟ 24 ชม./ย้อนหลัง N วัน/รายเดือน นับเฉพาะวันที่
// "ครบสมบูรณ์" แล้ว ไม่ใช่ของสด — และป้ายนี้เป็น generated_at เดียวกันของทั้งหน้า
// (fetch ครั้งเดียวตอนโหลด ไม่ได้รีเฟรชตอนกดปุ่ม 3/5/7 วัน) การแปะไว้ทุกกราฟจึง
// ทำให้ดูเหมือน "กดปุ่มแล้วข้อมูลไม่อัพเดท" ทั้งที่ตัวเลขจริงเปลี่ยนถูกต้องอยู่แล้ว
function _trfHelmetTotalBadge(overall, evidence, withStamp = true) {
  // 🔴 พารามิเตอร์ overall (ยอดที่ยังไม่กรอง) ไม่ถูกแสดงอีกแล้ว — เก็บไว้ใน signature
  //    เพราะผู้เรียกทั้งสองจุดยังส่งมา และมันคือตัวบอกว่า "มีข้อมูลหรือยัง"
  //    evidence == null แปลว่า bucket นั้นยังไม่ backfill (ก่อน migration 170)
  //    ⇒ ต้องขึ้น "—" ไม่ใช่ 0 ซึ่งจะอ่านว่า "ไม่มีใครทำผิด" ทั้งที่แปลว่าไม่รู้
  if (overall == null) return '';
  if (evidence == null) {
    return `<div class="trf-total-badge"><div class="tb-label">${_TRF_H_METRIC}</div>
      <div class="tb-value">— <span></span></div>
      <div class="tb-sub">ยังไม่ได้คำนวณย้อนหลังสำหรับช่วงนี้</div></div>`;
  }
  const stamp = withStamp ? _trfStamp(TRF_HELMET.data && TRF_HELMET.data.generated_at) : '';
  return `<div class="trf-total-badge"><div class="tb-label">${_TRF_H_METRIC}</div>
    <div class="tb-value">${_tfmt(evidence)} <span>ครั้ง</span></div>
    ${stamp ? `<div class="tb-sub">${stamp}</div>` : ''}</div>`;
}

// ── กราฟ 1 · Realtime วันนี้ ทุก 30 นาที (00:00–23:59, ยังไม่จบวันก็แสดงเท่าที่มี) ──
function _trfHelmetRenderRealtime(p) {
  const bySlot = Array(48).fill(null).map(() => ({ moto: 0, no_helmet: 0, no_helmet_ok: 0 }));
  (TRF_HELMET.data.realtime || []).forEach(r => {
    bySlot[r.slot] = { moto: r.moto, no_helmet: r.no_helmet, no_helmet_ok: r.no_helmet_ok };
  });
  const data = _trfHelmetData(bySlot);
  const overall = _trfHelmetOverall(bySlot);
  // 🔴 ยอดของการ์ดนี้มาจาก server (ตารางสรุป) ไม่ใช่ผลรวมแท่งในกราฟ
  // กราฟเป็นสล็อต 30 นาทีจึงต้องคิดสด และของสดนำหน้าตารางสรุปได้ถึง 15 นาที
  // ⇒ ผลรวมแท่งจะมากกว่ายอดเล็กน้อยเป็นเรื่องปกติของกราฟ realtime
  //   แต่ "ตัวเลขที่คนอ่านแล้วเอาไปพูดต่อ" ต้องเท่ากับทุกหน้าในระบบ
  // ไม่มีค่าจาก server (เวอร์ชันเก่า/โหลดไม่ทัน) → ตกกลับไปรวมแท่งเหมือนเดิม
  const overallOk = (TRF_HELMET.data && TRF_HELMET.data.realtime_total_ok != null)
    ? TRF_HELMET.data.realtime_total_ok
    : _trfHelmetOverallOk(bySlot);

  p.innerHTML = `
    <div class="trf-card">
      <div class="trf-head">
        <div>
          <div class="trf-title">Realtime - รถจักรยานยนต์ที่ผู้ขับขี่ หรือ ผู้ซ้อนท้ายไม่สวมหมวกนิรภัย</div>
          <div class="trf-sub">วันนี้ · 00:00–23:59 · อัพเดทข้อมูล · ทุก 30 นาที</div>
        </div>
        ${_trfHelmetTotalBadge(overall, overallOk)}
      </div>
      ${_trfChartBox('trfHelmetChartRealtime', TRF_HELMET_SLOTS.length, 'lg')}
    </div>`;

  trfChart('trfHelmetChartRealtime', {
    type: 'line',
    data: { labels: TRF_HELMET_SLOTS, datasets: [
      { label: _trfHelmetLabel(), data, borderColor: '#e8590c',
        backgroundColor: 'rgba(232,89,12,.14)', borderWidth: 2, tension: .25, pointRadius: 1.5, fill: true, spanGaps: false },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => c.parsed.y == null ? 'ไม่มีข้อมูล' : _trfHelmetFmt(c.parsed.y) } } },
      scales: {
        // แสดงทุกช่วงตามที่เจ้าของระบุ (48 จุด) — หมุน label ให้พอดีแทนการตัดทิ้ง
        x: { grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 8 }, autoSkip: false, maxRotation: 90, minRotation: 90 } },
        y: _trfHelmetYTicks(),
      } },
  });
}

// ── กราฟ 2 · 24 ชั่วโมง (วันที่ครบสมบูรณ์ — default เมื่อวาน) ────────────
function _trfHelmetRender24h(p) {
  const byHour = Array.from({ length: 24 }, () => ({ moto: 0, no_helmet: 0 }));
  (TRF_HELMET.data.hourly || []).forEach(r => {
    byHour[r.hour] = { moto: r.moto, no_helmet: r.no_helmet, no_helmet_ok: r.no_helmet_ok };
  });
  const data = _trfHelmetData(byHour);
  const overall = _trfHelmetOverall(byHour);
  const overallOk = _trfHelmetOverallOk(byHour);

  p.innerHTML = `
    <div class="trf-card">
      <div class="trf-head">
        <div>
          <div class="trf-title">24 ชั่วโมง (วันที่ข้อมูลครบสมบูรณ์)</div>
          <div class="trf-sub">วันที่ <b>${escapeHtml(TRF_HELMET.date || '')}</b> · 00:00–23:59</div>
        </div>
        <div class="trf-head-right">
          ${_trfHelmetTotalBadge(overall, overallOk, false)}
          <input type="date" class="form-input" style="font-size:12px;padding:5px 9px"
            value="${escapeHtml(TRF_HELMET.date || '')}" max="${escapeHtml(TRF_HELMET.maxDate || '')}" data-change="trfHelmetDateChange">
        </div>
      </div>
      ${_trfChartBox('trfHelmetChart24h', 24, 'lg')}
    </div>`;

  trfChart('trfHelmetChart24h', {
    type: 'line',
    data: { labels: TRF_HOURS, datasets: [
      { label: _trfHelmetLabel(), data, borderColor: '#e8590c',
        backgroundColor: 'rgba(232,89,12,.14)', borderWidth: 2.5, tension: .25, pointRadius: 3, fill: true, spanGaps: false },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => c.parsed.y == null ? 'ไม่มีข้อมูล' : _trfHelmetFmt(c.parsed.y) } } },
      scales: {
        // แสดงทุกชั่วโมงตามที่เจ้าของระบุ (24 จุด) — หมุน label กันทับกัน
        x: { grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 9 }, autoSkip: false, maxRotation: 90, minRotation: 90 } },
        y: _trfHelmetYTicks(),
      } },
  });
}

function _trfHelmetDateAdd(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// เติมวันที่ขาดด้วย 0 แทนการ slice ตามจำนวนแถว — ขอบเขตกล้องแคบอาจมีวันข้อมูล
// ขาดได้ (ยืนยันจริง: กล้องเดียวมีข้อมูลแค่ 13/120 วัน) ไม่งั้นป้ายช่วงเวลาจะคลาด
// กับข้อมูลที่แสดงจริงเงียบๆ
function _trfHelmetFillRange(daily, from, to) {
  const byDate = new Map(daily.map(r => [r.date, r]));
  const out = [];
  for (let d = from; d <= to; d = _trfHelmetDateAdd(d, 1)) {
    out.push(byDate.get(d) || { date: d, moto: 0, no_helmet: 0 });
  }
  return out;
}

// ── กราฟ 3 · ย้อนหลัง N วัน (แทนที่ "รายสัปดาห์ จันทร์-ศุกร์" เดิมตามคำขอ
// เจ้าของ 2026-08-12) — ปุ่มสำเร็จรูป 3/5/7 วัน + กำหนดเองได้ (เหมือน trf-seg
// ที่ใช้เลือกช่วง TRF.days วันในแท็บอื่นของหน้านี้) ─────────────────────
function _trfHelmetRangeBounds() {
  const maxDate = TRF_HELMET.maxDate;
  if (!maxDate) return [null, null];
  if (TRF_HELMET.rangeDays === 'custom') {
    const to = TRF_HELMET.rangeTo || maxDate;
    const from = TRF_HELMET.rangeFrom || to;
    return from <= to ? [from, to] : [to, from];
  }
  // 🔴 ปุ่ม 3/5/7 วัน ยึด **วันนี้** ไม่ใช่ maxDate (เจ้าของเลือก 2026-08-27)
  //
  // เดิมยึด maxDate = เมื่อวาน ⇒ "7 วัน" ของหน้านี้เป็น 08-20→08-26 ขณะที่
  // หน้าอันดับเป็น 08-21→08-27 เลื่อนกันหนึ่งวันตลอด ทั้งที่ปุ่มเขียนเหมือนกัน
  //
  // ⚠️ แลกมาด้วย: แท่งสุดท้าย (วันนี้) จะเตี้ยกว่าแท่งอื่นเสมอจนกว่าจะหมดวัน
  //    เพราะวันยังไม่จบ — ไม่ใช่ว่าวันนี้คนทำผิดน้อยลง · การ์ด "24 ชั่วโมง"
  //    ยังยึดเมื่อวานอยู่ตามเดิม สำหรับคนที่ต้องการวันที่ครบ 24 ชม.จริง ๆ
  const anchor = TRF_HELMET.todayDate || maxDate;
  return [_trfHelmetDateAdd(anchor, -(TRF_HELMET.rangeDays - 1)), anchor];
}

function trfHelmetRangeDays(el) {
  const v = el.dataset.n;
  if (v === 'custom') {
    TRF_HELMET.rangeDays = 'custom';
    if (!TRF_HELMET.rangeTo) TRF_HELMET.rangeTo = TRF_HELMET.maxDate;
    if (!TRF_HELMET.rangeFrom) TRF_HELMET.rangeFrom = _trfHelmetDateAdd(TRF_HELMET.maxDate, -6);
  } else {
    TRF_HELMET.rangeDays = Number(v);
  }
  renderTraffic();
}
function trfHelmetRangeFrom(el) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
  TRF_HELMET.rangeFrom = el.value;
  renderTraffic();
}
function trfHelmetRangeTo(el) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
  TRF_HELMET.rangeTo = el.value;
  renderTraffic();
}

function _trfHelmetRenderRange(p) {
  const daily = TRF_HELMET.data.daily || [];
  const [from, to] = _trfHelmetRangeBounds();
  const rows = (from && to) ? _trfHelmetFillRange(daily, from, to) : [];
  const data = _trfHelmetData(rows);
  const overall = _trfHelmetOverall(rows);
  const overallOk = _trfHelmetOverallOk(rows);
  const labels = rows.map(r => TRF_DOW[new Date(r.date + 'T00:00:00Z').getUTCDay() || 7].slice(0, 3) + ' ' + r.date.slice(5));
  const presets = [3, 5, 7];

  p.innerHTML = `
    <div class="trf-card">
      <div class="trf-head">
        <div>
          <div class="trf-title">ย้อนหลัง</div>
          <div class="trf-sub">${from ? `${escapeHtml(from)} – ${escapeHtml(to)}` : '—'}</div>
        </div>
        ${_trfHelmetTotalBadge(overall, overallOk, false)}
      </div>
      <div class="trf-grp" style="margin-top:10px">
        <div class="trf-seg sm">${presets.map(n =>
          `<button class="${TRF_HELMET.rangeDays === n ? 'on' : ''}" data-action="trfHelmetRangeDays" data-n="${n}">${n} วัน</button>`).join('')}
          <button class="${TRF_HELMET.rangeDays === 'custom' ? 'on' : ''}" data-action="trfHelmetRangeDays" data-n="custom">กำหนดเอง</button>
        </div>
        ${TRF_HELMET.rangeDays === 'custom' ? `
        <div class="trf-range-custom">
          <input type="date" class="form-input" style="font-size:12px;padding:5px 9px"
            value="${escapeHtml(TRF_HELMET.rangeFrom || from || '')}"
            min="${escapeHtml(TRF_HELMET.maxDate ? _trfHelmetDateAdd(TRF_HELMET.maxDate, -119) : '')}"
            max="${escapeHtml((TRF_HELMET.todayDate || TRF_HELMET.maxDate) || '')}" data-change="trfHelmetRangeFrom">
          <span>ถึง</span>
          <input type="date" class="form-input" style="font-size:12px;padding:5px 9px"
            value="${escapeHtml(TRF_HELMET.rangeTo || to || '')}"
            min="${escapeHtml(TRF_HELMET.maxDate ? _trfHelmetDateAdd(TRF_HELMET.maxDate, -119) : '')}"
            max="${escapeHtml((TRF_HELMET.todayDate || TRF_HELMET.maxDate) || '')}" data-change="trfHelmetRangeTo">
        </div>` : ''}
      </div>
      ${_trfChartBox('trfHelmetChartWeek', rows.length, 'lg', 62)}
    </div>`;

  // custom range อาจยาวหลายสิบวัน (ไม่ใช่แค่ 3/5/7) — label แนวนอนจะทับกันเอง
  // เกิน ~14 แท่ง สลับไปหมุนตั้งแบบเดียวกับกราฟรายเดือนที่เจอปัญหานี้มาก่อนแล้ว
  const wide = rows.length > 14;
  trfChart('trfHelmetChartWeek', {
    type: 'bar',
    data: { labels, datasets: [
      { label: _trfHelmetLabel(), data, backgroundColor: '#e8590c', borderRadius: 3 },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => c.parsed.y == null ? 'ไม่มีข้อมูล' : _trfHelmetFmt(c.parsed.y) } } },
      scales: {
        x: { grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: wide ? 9 : 11 },
          autoSkip: false, maxRotation: wide ? 90 : 0, minRotation: wide ? 90 : 0 } },
        y: _trfHelmetYTicks(),
      } },
  });
}

// ── กราฟ 4 · รายเดือน (วันที่ 1 ถึงสิ้นเดือนของเดือนที่เลือก) ─────────────
function trfHelmetMonthChange(el) {
  if (!/^\d{4}-\d{2}$/.test(el.value)) return;
  TRF_HELMET.month = el.value;
  renderTraffic();
}

function _trfHelmetMonthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายเดือนนี้
  return [from, `${ym}-${String(lastDay).padStart(2, '0')}`];
}

function _trfHelmetRenderMonth(p) {
  const daily = TRF_HELMET.data.daily || [];
  const ym = TRF_HELMET.month;
  const [from, to] = ym ? _trfHelmetMonthRange(ym) : [null, null];
  const rows = (from && to) ? _trfHelmetFillRange(daily, from, to) : [];
  const data = _trfHelmetData(rows);
  const overall = _trfHelmetOverall(rows);
  const overallOk = _trfHelmetOverallOk(rows);
  const labels = rows.map(r => r.date.slice(8)); // แค่วันที่ 01..31 พอ (เดือนเดียวกันหมด)

  p.innerHTML = `
    <div class="trf-card">
      <div class="trf-head">
        <div>
          <div class="trf-title">รายเดือน (วันที่ 1 ถึงสิ้นเดือน)</div>
          <div class="trf-sub">${from ? `${escapeHtml(from)} – ${escapeHtml(to)}` : '—'}</div>
        </div>
        <div class="trf-head-right">
          ${_trfHelmetTotalBadge(overall, overallOk, false)}
          <input type="month" class="form-input" style="font-size:12px;padding:5px 9px"
            value="${escapeHtml(ym || '')}" data-change="trfHelmetMonthChange">
        </div>
      </div>
      ${_trfChartBox('trfHelmetChartMonth', rows.length, 'lg')}
    </div>`;

  trfChart('trfHelmetChartMonth', {
    type: 'bar',
    data: { labels, datasets: [
      { label: _trfHelmetLabel(), data, backgroundColor: '#e8590c', borderRadius: 3 },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => c.parsed.y == null ? 'ไม่มีข้อมูล' : _trfHelmetFmt(c.parsed.y) } } },
      scales: {
        x: { grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 9 }, autoSkip: false, maxRotation: 90, minRotation: 90 } },
        y: _trfHelmetYTicks(),
      } },
  });
}

function trfRenderReport(p) {
  p.innerHTML = `
    <div class="trf-card soon">
      <div class="trf-soon-badge">กำลังจัดทำ</div>
      <div class="trf-title" style="font-size:16px;margin-top:8px">รายงานเพื่อออกใบสั่ง</div>
      <div class="trf-sub" style="max-width:720px;margin-top:6px">
        ส่วนนี้ยังไม่เปิดใช้งาน · เป้าหมายคือออกรายงานที่<b>เจ้าหน้าที่นำไปออกใบสั่งต่อได้จริง</b>
        จึงต้องตกลงรูปแบบเอกสารและข้อกฎหมายให้จบก่อนลงมือ
      </div>
      <div class="trf-soon-list">
        <div class="si"><div class="h">รายการฝ่าฝืนพร้อมหลักฐาน</div><div class="d">ป้ายทะเบียน · ภาพเต็ม + ภาพครอปป้าย · วันเวลา · จุดติดตั้ง — ระบบเก็บครบแล้ว</div></div>
        <div class="si"><div class="h">คัดกรองก่อนออกใบสั่ง</div><div class="d">แสดงค่าความมั่นใจของการอ่านป้ายและภาพประกอบ ให้เจ้าหน้าที่เป็นผู้พิจารณา</div></div>
        <div class="si"><div class="h">ส่งออก PDF / Excel</div><div class="d">รูปแบบเดียวกับที่ใช้ยื่นจริง พร้อมเลขที่เอกสาร</div></div>
        <div class="si"><div class="h">ตามสถานะ</div><div class="d">ออกใบสั่งแล้ว / ชำระแล้ว / ยกเลิก — กันออกซ้ำคันเดิมวันเดียวกัน</div></div>
      </div>
      <div class="trf-insight" style="margin-top:16px"><b>ต้องตกลงก่อนเริ่มทำ:</b>
        เกณฑ์ความมั่นใจขั้นต่ำที่ยอมรับให้ออกใบสั่งได้ · ใครมีสิทธิ์กดออกใบสั่ง ·
        เก็บหลักฐานย้อนหลังกี่วันตามระเบียบ · รูปแบบเอกสารที่ต้นสังกัดใช้อยู่</div>
    </div>`;
}

// ── modal เลือกกล้อง ────────────────────────────────────────
// ขอบเขตกล้องในหน้าต่างนี้ตาม Site ที่เลือกไว้เสมอ (TRF.sites) — เหมือน
// trfSelectedCams() ที่กราฟใช้จริง ไม่ใช่ list ดิบทั้งหมดทุก site
let _trfPendCams = null;
let _trfModalCamIds = null;
function trfOpenCams() {
  // 🔴 TRF.data เป็น null ได้ — loadTraffic() ออกก่อนถึง fetch เมื่อผู้ใช้ไม่มีสิทธิ์
  // แท็บกลุ่ม enforcement (ดู _trfCanLoadEnforcement) · ผู้ใช้ที่เห็นเฉพาะแท็บหมวก
  // จึงกดปุ่มเลือกกล้องแล้วไม่เกิดอะไรขึ้นเลย เพราะบรรทัดนี้โยน TypeError เงียบ ๆ
  // (เจ้าของเจอ 2026-08-27 · เป็นบั๊กที่มีมาก่อน โผล่เมื่อเริ่มจำกัดสิทธิ์รายกล้อง)
  // ⇒ ตกไปใช้รายชื่อกล้องจาก payload ของแท็บหมวก ซึ่งมีฟิลด์ชุดเดียวกัน
  const camSrc = (TRF.data && TRF.data.cameras)
    || (typeof TRF_HELMET !== 'undefined' && TRF_HELMET.data && TRF_HELMET.data.cameras)
    || null;
  if (!camSrc) {
    // ยังโหลดไม่เสร็จจริง ๆ — บอกไปตรง ๆ ดีกว่าเปิดหน้าต่างเปล่า
    alert(I18N.t('trf.loading', 'กำลังโหลดข้อมูล…'));
    return;
  }
  const siteCams = camSrc.filter(c => !TRF.sites.size || TRF.sites.has(c.site_code));
  _trfModalCamIds = siteCams.map(c => c.id);
  _trfPendCams = new Set(TRF.cams ? siteCams.filter(c => TRF.cams.has(c.id)).map(c => c.id) : _trfModalCamIds);
  // โหมด single (migration 180) — เลือกได้ทีละกล้อง ⇒ radio ไม่ใช่ checkbox
  // ฝั่ง server บังคับซ้ำที่ parseCams() เสมอ · ที่นี่ทำให้ "กดไม่ได้ตั้งแต่แรก"
  // ไม่ใช่ "กดได้แล้วค่อยโดนปฏิเสธ" ซึ่งอ่านเหมือนระบบพัง
  const single = _trfCamSingle();
  if (single && _trfPendCams.size > 1) {
    // สิทธิ์เพิ่งถูกเปลี่ยนเป็น single ขณะที่หน้ายังเปิดค้าง — เหลือตัวแรกไว้
    _trfPendCams = new Set([[..._trfPendCams][0]]);
  }
  const list = siteCams.map(c => `
    <label class="trf-camopt">
      <input type="${single ? 'radio' : 'checkbox'}"${single ? ' name="trfCamPick"' : ''}
             data-change="trfCamToggle" data-id="${escapeHtml(c.id)}" ${_trfPendCams.has(c.id) ? 'checked' : ''}>
      <span class="cn">${escapeHtml(c.name)}<br><span class="cm">${escapeHtml(c.id)} · ${escapeHtml(c.site_name || '—')} · ${_tfmt(c.moto)} คัน</span></span>
      ${/* เอา % ออก (เจ้าของสั่ง 2026-08-27) — หน้าต่างนี้มีหน้าที่ "เลือกกล้อง"
            ตัวเลขอัตราไม่ได้ช่วยตัดสินใจว่าจะเลือกตัวไหน และไปซ้ำกับตารางที่แสดง
            อยู่แล้วบนหน้าหลัก
            🔴 แต่ป้าย "ยังไม่เปิดตรวจจับ" ต้องอยู่ต่อ — มันไม่ใช่สถิติ แต่เป็นคำเตือน
            ว่ากล้องตัวนั้นเลือกไปก็ไม่ได้ข้อมูลหมวกกลับมา ถ้าเอาออกด้วยคนเลือกจะงง
            ว่าทำไมเลือกแล้วผลว่าง · ไม่มีป้าย = ไม่ใส่ span เลย ให้ช่องยุบไปเอง */''}
      ${c.detect ? '' : '<span class="cp"><span class="trf-nodetect">ยังไม่เปิดตรวจจับ</span></span>'}
    </label>`).join('');
  document.getElementById('trfCamModalBody').innerHTML = list;
    // ปุ่มเลือก/ล้างทั้งหมดไม่มีความหมายเมื่อเลือกได้ตัวเดียว
    for (const a of ['trfCamAll', 'trfCamNone']) {
      const b = document.querySelector(`[data-action="${a}"]`);
      if (b) b.hidden = single;
    }
  document.getElementById('trfCamCount').textContent = `เลือกไว้ ${_trfPendCams.size} จาก ${_trfModalCamIds.length} กล้อง`;
  document.getElementById('trfCamModal').hidden = false;
}

// ── actions ─────────────────────────────────────────────────
function trfTab(el)      { TRF.tab = el.dataset.tab; renderTraffic(); }
function trfDays(el)     { TRF.days = Number(el.dataset.days); TRF.data = null; loadTraffic(true); }
function trfGran(el)     { TRF.gran = el.dataset.gran; renderTraffic(); }
function trfVolMode(el)  { TRF.volMode = el.dataset.mode; renderTraffic(); }
function trfDow(el) {
  const d = Number(el.dataset.dow);
  if (TRF.dows.has(d)) { if (TRF.dows.size === 1) return; TRF.dows.delete(d); } else TRF.dows.add(d);
  renderTraffic();
}
function trfDowAll()     { TRF.dows = new Set([1, 2, 3, 4, 5, 6, 7]); renderTraffic(); }
// เลือกได้ทีละ Site เท่านั้น (ไม่ใช่ multi-select) — ทุกแท็บในหน้านี้ใช้ TRF.sites
// ร่วมกัน ดังนั้นแก้จุดเดียวมีผลทุกแท็บ (decision #244) กดซ้ำ site ที่เลือกอยู่ =
// เคลียร์กลับเป็น "ทุก Site"
function trfSite(el) {
  const s = el.dataset.site;
  TRF.sites = (TRF.sites.has(s) && TRF.sites.size === 1) ? new Set() : new Set([s]);
  renderTraffic();
}
function trfSiteAll()    { TRF.sites.clear(); renderTraffic(); }
function trfCloseCams()  { document.getElementById('trfCamModal').hidden = true; }
// บัญชีนี้ดูได้ทีละกล้องหรือไม่ — users.camera_select_mode ผ่าน /api/auth/me
// ไม่รู้ค่า = multi (พฤติกรรมเดิม) · ห้าม default เป็น single ไม่งั้นคนที่ยังโหลด
// ข้อมูลผู้ใช้ไม่เสร็จจะถูกล็อกชั่วคราวโดยไม่มีเหตุผล
function _trfCamSingle() {
  return !!(typeof currentUser === 'object' && currentUser
            && currentUser.camera_select_mode === 'single');
}

function trfCamToggle(el) {
  // radio: เลือกใหม่แทนที่ของเดิมทั้งหมด — Set มีได้ตัวเดียวเสมอ
  if (el.type === 'radio') { _trfPendCams = new Set([el.dataset.id]); }
  else el.checked ? _trfPendCams.add(el.dataset.id) : _trfPendCams.delete(el.dataset.id);
  document.getElementById('trfCamCount').textContent = `เลือกไว้ ${_trfPendCams.size} จาก ${_trfModalCamIds.length} กล้อง`;
}
// 🔒 โหมด single ไม่มี "เลือกทั้งหมด" — ปุ่มนี้จะยัด 58 กล้องเข้า Set แล้ว
// ยิงคำขอที่ server ปฏิเสธ · ซ่อนปุ่มที่หน้าจอด้วย (trfOpenCams)
function trfCamAll()     {
  if (_trfCamSingle()) return;
  _trfPendCams = new Set(_trfModalCamIds); trfOpenCamsRedraw();
}
function trfCamNone()    { _trfPendCams = new Set(); trfOpenCamsRedraw(); }
function trfOpenCamsRedraw() {
  document.querySelectorAll('#trfCamModalBody [data-change="trfCamToggle"]').forEach(cb => {
    cb.checked = _trfPendCams.has(cb.dataset.id);
  });
  document.getElementById('trfCamCount').textContent = `เลือกไว้ ${_trfPendCams.size} จาก ${_trfModalCamIds.length} กล้อง`;
}
// TRF.cams เก็บแค่สิ่งที่เลือกไว้ "ภายในขอบเขต Site ที่กำลังดูอยู่" ตรงๆ — ไม่พยายาม
// จำ/รวมกล้อง site อื่นที่ไม่เห็นในหน้าต่างนี้เข้าไปด้วย (เคยลองทำแบบนั้นแล้วพัง:
// เลือก 1 ใน 16 ของ Phuket กลับไปกลายเป็น "1 + กล้อง HatYai ทั้ง 40 ตัวที่ไม่เห็น"
// เปิดหน้าต่างซ้ำเลยเห็นแค่ 1/16 งงว่า "เลือกไม่ได้" ทั้งที่ตัวเลขถูกทางคณิตศาสตร์
// — ค่าที่เข้าใจง่ายกว่าคือแค่สะท้อนสิ่งที่กดในหน้าต่างนี้ตรงๆ)
function trfApplyCams() {
  if (_trfPendCams.size) {
    // โหมด single: เก็บเป็น Set ชัดๆ เสมอ ห้ามยุบเป็น null ("ทุกกล้อง") แม้บัญชีจะมี
    // กล้องเดียวในสิทธิ์ — null = ไม่ส่งพารามิเตอร์ = โดน 400 จาก parseCams ฝั่ง server
    // และ /enforcement ของบัญชี single เป็นข้อมูลรายกล้องจาก server → ต้อง refetch
    if (_trfCamSingle()) {
      TRF.cams = new Set(_trfPendCams);
      TRF.data = null;
      trfCloseCams(); loadTraffic(true);
      return;
    }
    TRF.cams = _trfPendCams.size === _trfModalCamIds.length ? null : new Set(_trfPendCams);
  }
  trfCloseCams(); renderTraffic();
}

// ── กลุ่มประเภทรถ ────────────────────────────────────────────
function trfGroups() { return TRF.groups || TRF_DEFAULT_GROUPS; }
function trfTypeAllowed(t) { return !TRF.types || TRF.types.has(t); }

// ── กราฟที่ขาดในแท็บ "ปริมาณรถ" ─────────────────────────────
function trfRenderVolumeExtras(host) {
  const types = (TRF.data.vehicle_types || []).filter(t => trfTypeAllowed(t.type));
  const groups = trfGroups();
  const gTot = groups.map(g => types.filter(t => g.types.includes(t.type)).reduce((a, t) => a + t.n, 0));

  host.insertAdjacentHTML('beforeend', `
    <div class="trf-grid2">
      <div class="trf-card">
        <div class="trf-title">แยกตามประเภทรถ</div>
        <div class="trf-sub">รวม ${TRF.days} วัน · จัดกลุ่มเองได้ในแท็บ “ตั้งค่า”</div>
        <div class="trf-chart"><canvas id="trfChartByType"></canvas></div>
      </div>
      <div class="trf-card">
        <div class="trf-title">สัดส่วนวันทำงาน เทียบ วันหยุด</div>
        <div class="trf-sub">ปริมาณรวมต่อวัน แยกตามกลุ่มประเภทรถ</div>
        <div class="trf-chart"><canvas id="trfChartSplit"></canvas></div>
      </div>
    </div>`);

  trfChart('trfChartByType', {
    type: 'bar', data: { labels: groups.map(g => g.th),
      datasets: [{ label: 'คัน', data: gTot, backgroundColor: groups.map(g => g.color), borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${_tfmt(c.parsed.x)} คัน` } } },
      scales: { x: { beginAtZero: true, grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 10 }, callback: v => v >= 1000 ? (v / 1000) + 'k' : v } },
        y: { grid: { display: false }, ticks: { color: _ttext(), font: { size: 11 } } } } },
  });

  // วันทำงาน/วันหยุดของจริง — แยกจาก hourly ที่ server ส่งมา ไม่ได้สมมติสัดส่วน
  const wd = (TRF.data.hourly || []).filter(r => r.dow <= 5);
  const we = (TRF.data.hourly || []).filter(r => r.dow >= 6);
  const perDay = (rows) => {
    const tot = rows.reduce((a, r) => a + r.moto, 0);
    const dayCount = rows.length ? Math.max(1, Math.max(...rows.map(r => r.days_seen))) : 1;
    return tot / dayCount * trfShare();
  };
  const wdV = perDay(wd), weV = perDay(we);
  trfChart('trfChartSplit', {
    type: 'bar', data: { labels: ['จันทร์-ศุกร์', 'เสาร์-อาทิตย์'],
      datasets: [{ label: 'รถ 2-3 ล้อ/วัน', data: [wdV, weV],
        backgroundColor: [token('--accent'), token('--warn')], borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${_tfmt(c.parsed.y)} คัน/วัน` } } },
      scales: { x: { grid: { display: false }, ticks: { color: _ttext(), font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 10 }, callback: v => v >= 1000 ? (v / 1000) + 'k' : v } } } },
  });
}

// ── กราฟที่ขาดในแท็บ "วินัยจราจร" ───────────────────────────
function trfRenderViolationExtras(host) {
  const belt = (TRF.data.belt_by_type || []).slice().sort((a, b) => b.pct - a.pct);
  const series = trfSeriesByDow();
  const dows = _tdows();

  host.insertAdjacentHTML('beforeend', `
    <div class="trf-grid2">
      <div class="trf-card">
        <div class="trf-title">อัตราไม่คาดเข็มขัดนิรภัย แยกตามประเภทรถ</div>
        <div class="trf-sub">ตัวหาร = <b>รถ 4 ล้อขึ้นไปเท่านั้น</b> · จักรยานยนต์ไม่เคยติดธงนี้</div>
        <div class="trf-chart"><canvas id="trfChartBelt"></canvas></div>
      </div>
      <div class="trf-card">
        <div class="trf-title">ซ้อน 3 คนขึ้นไป รายชั่วโมง</div>
        <div class="trf-sub">นับจาก <code>rider_count ≥ 3</code> ของจริง · เฉลี่ยต่อวัน</div>
        <div class="trf-chart"><canvas id="trfChartRiders"></canvas></div>
      </div>
    </div>`);

  trfChart('trfChartBelt', {
    type: 'bar', data: { labels: belt.map(t => TYPE_TH[t.type] || t.type),
      datasets: [{ label: '%', data: belt.map(t => t.pct), backgroundColor: token('--warn'), borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: c => { const t = belt[c.dataIndex]; return `${t.pct.toFixed(3)}% (${_tfmt(t.bad)} จาก ${_tfmt(t.total)} คัน)`; } } } },
      scales: { x: { beginAtZero: true, grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 10 }, callback: v => v + '%' } },
        y: { grid: { display: false }, ticks: { color: _ttext(), font: { size: 11 } } } } },
  });

  // ซ้อน 3 รายชั่วโมงของจริง — เฉลี่ยข้ามวันที่เลือกไว้
  const riders = Array(24).fill(0);
  const cnt = Array(24).fill(0);
  for (const r of (TRF.data.hourly || [])) {
    if (!TRF.dows.has(r.dow)) continue;
    riders[r.hour] += r.riders3 / Math.max(1, r.days_seen) * trfShare();
    cnt[r.hour]++;
  }
  trfChart('trfChartRiders', {
    type: 'bar', data: { labels: TRF_HOURS,
      datasets: [{ label: 'คัน/ชั่วโมง', data: riders.map((v, i) => cnt[i] ? v / cnt[i] * dows.length : 0),
        backgroundColor: '#7048e8', borderRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${_tfmt(c.parsed.y)} คัน` } } },
      scales: { x: { grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 10 } } } } },
  });
}

// ── แท็บ · ก่อน-หลังกวดขัน (ข้อมูลจริงรายวัน) ────────────────
const TRF_EFF_KINDS = {
  helmet: { th: 'ไม่สวมหมวกนิรภัย', denom: 'รถ 2-3 ล้อ', num: 'no_helmet', den: 'moto' },
  belt:   { th: 'ไม่คาดเข็มขัดนิรภัย', denom: 'รถ 4 ล้อขึ้นไป', num: 'no_seatbelt', den: 'car' },
  riders: { th: 'ซ้อน 3 คนขึ้นไป', denom: 'รถ 2-3 ล้อ', num: 'riders3', den: 'moto' },
};

function trfRenderEffect(p) {
  const kind = TRF_EFF_KINDS[TRF.effKind];
  // ดึงข้อมูลรายวันที่รวมยอดตามขอบเขตกล้องที่เลือก
  // จากนั้นกรองตามวันในสัปดาห์ที่เลือก
  const daily = trfDailyScoped().filter(r => {
    const d = new Date(r.date + 'T00:00:00');
    const iso = d.getDay() === 0 ? 7 : d.getDay();
    return TRF.dows.has(iso);
  });
  // ค่าเริ่มต้น = กึ่งกลางของข้อมูลที่มี เพื่อให้มีทั้งก่อนและหลังให้เทียบ
  if (!TRF.effDate && daily.length) TRF.effDate = daily[Math.floor(daily.length / 2)].date;

  p.innerHTML = `
    <div class="trf-card">
      <div class="trf-head">
        <div>
          <div class="trf-title">วัดผลการกวดขัน — ${escapeHtml(kind.th)}</div>
          <div class="trf-sub">วัดเรื่องเดียวต่อครั้ง <b>ไม่ใช่การฝ่าฝืนรวมทุกเรื่อง</b>
            เพราะแต่ละเรื่องมีตัวหารคนละชุด · ตัวหารของหน้านี้ = <b>${escapeHtml(kind.denom)}</b>
            · ข้อมูลจริงรายวัน ${daily.length} วัน</div>
        </div>
        <div class="trf-effctl">
          <span class="trf-lbl">เรื่องที่วัด</span>
          <div class="trf-seg sm">${Object.entries(TRF_EFF_KINDS).map(([k, v]) =>
            `<button class="${TRF.effKind === k ? 'on' : ''}" data-action="trfEffKind" data-kind="${k}">${v.th.replace('นิรภัย', '').replace(' คนขึ้นไป', '')}</button>`).join('')}</div>
          <span class="trf-lbl">วันเริ่มกวดขัน</span>
          <input type="date" class="form-input" id="trfEffDate" value="${escapeHtml(TRF.effDate || '')}"
                 style="font-size:12px;padding:5px 9px" data-change="trfEffDate">
          <span class="trf-lbl">หน้าต่าง</span>
          <div class="trf-seg sm">${[3, 7, 14, 28].map(w =>
            `<button class="${TRF.effWin === w ? 'on' : ''}" data-action="trfEffWin" data-win="${w}">${w} วัน</button>`).join('')}</div>
        </div>
      </div>
      <div id="trfEffVerdict"></div>
      <div class="trf-chart lg"><canvas id="trfChartEffect"></canvas></div>
      <div class="trf-insight" id="trfEffInsight"></div>
    </div>`;

  const idx = daily.findIndex(r => r.date >= TRF.effDate);
  const cut = idx < 0 ? Math.floor(daily.length / 2) : idx;
  const before = daily.slice(Math.max(0, cut - TRF.effWin), cut);
  const after  = daily.slice(cut, cut + TRF.effWin);
  const rate = (rows) => {
    const n = rows.reduce((a, r) => a + r[kind.num], 0);
    const d = rows.reduce((a, r) => a + r[kind.den], 0);
    return d ? n / d * 100 : null;
  };
  const avgB = rate(before), avgA = rate(after);
  const ok = avgB != null && avgA != null;
  const delta = ok ? avgA - avgB : null;
  const rel = ok && avgB ? delta / avgB * 100 : null;
  const good = ok && delta < 0;
  const p2 = (v) => v == null ? '—' : (avgB != null && avgB < 2 ? v.toFixed(2) : _tpct(v));

  document.getElementById('trfEffVerdict').innerHTML = !ok
    ? `<div class="trf-verdict">ข้อมูลไม่พอสำหรับหน้าต่างนี้ — ลองขยายหน้าต่างหรือเลือกวันอื่น</div>`
    : `<div class="trf-verdict ${good ? 'good' : 'bad'}">
        <div class="v-h">${escapeHtml(kind.th)} ${good ? 'ดีขึ้น' : 'แย่ลง'} ${p2(Math.abs(delta))} จุด (${_tpct(Math.abs(rel))}%)</div>
        <div class="v-d">ก่อนกวดขัน <b>${p2(avgB)}%</b> (${before.length} วัน) → หลังกวดขัน <b>${p2(avgA)}%</b> (${after.length} วัน)
          · เทียบเฉพาะวันที่เลือกไว้ · กล้องที่ตรวจจับได้ ${trfDetectingCams().length} ตัว</div></div>`;

  const labels = [...before, ...after].map(r => r.date.slice(5));
  const series = [...before, ...after].map(r => r[kind.den] ? r[kind.num] / r[kind.den] * 100 : null);
  trfChart('trfChartEffect', {
    type: 'line',
    data: { labels, datasets: [
      { label: 'ก่อนกวดขัน', data: series.map((v, i) => i < before.length ? v : null),
        borderColor: '#868e96', borderWidth: 2, tension: .25, pointRadius: 2, spanGaps: false },
      { label: 'หลังกวดขัน', data: series.map((v, i) => i >= before.length ? v : null),
        borderColor: '#2f9e44', backgroundColor: 'rgba(47,158,68,.13)', borderWidth: 2.5, tension: .25, pointRadius: 2, fill: true },
      ...(avgB != null ? [{ label: 'ค่าเฉลี่ยก่อน', data: labels.map(() => avgB),
        borderColor: '#adb5bd', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0 }] : []),
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: trfLegend(), tooltip: { callbacks: { label: c => c.parsed.y == null ? null : `${c.dataset.label}: ${p2(c.parsed.y)}%` } } },
      scales: { x: { grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 10 }, maxTicksLimit: 14 } },
        y: { grid: { color: _tgrid() }, ticks: { color: _ttext(), font: { size: 10 }, callback: v => v + '%' } } } },
  });

  // 🔴 กันการอ่านผิดที่อันตรายที่สุดของหน้านี้:
  // ถ้าสองช่วงมี "กล้องส่งข้อมูล" ไม่เท่ากัน หรือช่วงหนึ่งยังตรวจจับไม่ทำงาน
  // ตัวเลขที่ได้จะไม่ใช่ผลของการกวดขันเลย แต่เป็นผลของข้อมูลมาไม่เท่ากัน
  // เจอจริงตอนทดสอบ: ก่อน 7.8% → หลัง 18.4% ("แย่ลง 136%") ทั้งที่ความจริงคือ
  // ช่วงก่อนมีวันที่ตรวจหมวกยังไม่ทำงาน (nh=0) ปนอยู่ และกล้องเพิ่มจาก 41 เป็น 56 ตัว
  const camsOf = (rows) => rows.length ? rows.reduce((a, r) => a + (r.cams || 0), 0) / rows.length : 0;
  const cb = camsOf(before), ca = camsOf(after);
  const zeroDays = before.filter(r => r[kind.den] > 5000 && r[kind.num] === 0).length
                 + after.filter(r => r[kind.den] > 5000 && r[kind.num] === 0).length;
  const camGap = (cb && ca) ? Math.abs(ca - cb) / Math.max(ca, cb) : 0;
  const unreliable = camGap > 0.15 || zeroDays > 0;

  document.getElementById('trfEffInsight').innerHTML = (unreliable
    ? `<div class="trf-warnbox"><b>⚠️ ตัวเลขนี้ยังเทียบกันไม่ได้</b> — ` +
      (camGap > 0.15 ? `จำนวนกล้องที่ส่งข้อมูลต่างกันมาก (ก่อน ${cb.toFixed(0)} ตัว → หลัง ${ca.toFixed(0)} ตัว) ` : '') +
      (zeroDays ? `· มี ${zeroDays} วันที่มีรถผ่านเยอะแต่ตรวจไม่พบการฝ่าฝืนเลย แปลว่าวันนั้นระบบตรวจจับยังไม่ทำงาน ` : '') +
      `</div>`
    : '') +
    `<b>ข้อควรระวัง:</b> ต้องเทียบวันทำงานกับวันทำงาน วันหยุดกับวันหยุด — วันหยุดอัตราฝ่าฝืนสูงกว่าอยู่แล้ว
     ใช้ปุ่มเลือก “วัน” ด้านบนกรองให้เหลือเฉพาะกลุ่มที่ต้องการเทียบ ·
     ตัวเลขนี้เป็นข้อมูลจริง ไม่ใช่การจำลอง จึงสะท้อนเหตุอื่นที่เกิดพร้อมกันด้วย (ฝนตก วันหยุดยาว งานประเพณี)`;
}

// ── แท็บ · ตั้งค่า ───────────────────────────────────────────
function trfRenderSettings(p) {
  const types = TRF.data.vehicle_types || [];
  const groups = trfGroups();
  const noDet = (TRF.data.cameras || []).filter(c => !c.detect);
  p.innerHTML = `
    <div class="trf-card">
      <div class="trf-title">จัดกลุ่มประเภทรถ</div>
      <div class="trf-sub">ระบบเก็บ <code>vehicle_type</code> ดิบจากกล้อง ${types.length} แบบ ·
        จับกลุ่มใหม่ได้ตามที่ต้องการ แล้วกราฟในแท็บ “ปริมาณรถ” จะใช้กลุ่มนี้</div>
      <div class="trf-groups">${groups.map(g => `
        <div class="trf-group" style="--gc:${escapeHtml(g.color)}">
          <div class="g-n">${escapeHtml(g.th)}</div>
          <div class="g-t">${g.types.map(t => {
            const v = types.find(x => x.type === t);
            return `<span class="g-chip">${escapeHtml(TYPE_TH[t] || t)}<span class="c">${v ? _tfmt(v.n) : 0}</span></span>`;
          }).join('') || '<span class="trf-sub">ยังไม่มีประเภทในกลุ่มนี้</span>'}</div>
        </div>`).join('')}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
        <button class="btn-mini" data-action="trfGroupsReset">คืนค่าเริ่มต้น</button>
        <span class="trf-sub" id="trfGroupMsg">แก้กลุ่มแบบละเอียดจะเปิดให้ทำในรอบถัดไป — ตอนนี้ใช้กลุ่มมาตรฐาน</span>
      </div>
    </div>

    <div class="trf-card">
      <div class="trf-title">เกณฑ์สำหรับรายงานส่งตำรวจ</div>
      <div class="trf-sub">ค่าเหล่านี้ใช้ตอนออกรายงาน — ตั้งไว้ตามที่ตกลงกัน 2026-08-11</div>
      <div class="trf-setrow">
        <span class="trf-lbl">ความมั่นใจการอ่านป้ายขั้นต่ำ</span>
        <input type="number" class="form-input" id="trfConf" value="95" min="50" max="100"
               style="width:80px;font-size:12px;padding:5px 9px">
        <span class="trf-sub">% · ต่ำกว่านี้ไม่ใส่ในรายงาน (ค่าเริ่มต้น 95%)</span>
      </div>
      <div class="trf-setrow">
        <span class="trf-lbl">เก็บหลักฐานย้อนหลัง</span>
        <span class="trf-sub">ใช้ตาม retention ของระบบ (ตั้งที่ ตั้งค่า › ระบบ) — ไม่ตั้งซ้ำที่นี่
          เพื่อไม่ให้มีค่าสองที่ที่ขัดกันเอง</span>
      </div>
      <div class="trf-setrow">
        <span class="trf-lbl">รูปแบบส่งออก</span>
        <span class="trf-sub">PDF · เราจัดทำ<b>รายงานส่งให้ตำรวจ</b> ไม่ได้ออกใบสั่งเอง</span>
      </div>
      <div style="margin-top:10px"><button class="btn-mini" data-action="trfSaveThresh">บันทึก</button>
        <span class="trf-sub" id="trfThreshMsg" style="margin-left:8px"></span></div>
    </div>

    ${noDet.length ? `<div class="trf-card">
      <div class="trf-title">หมายเหตุภายใน — กล้องที่ยังไม่มีข้อมูลหมวกนิรภัย</div>
      <div class="trf-sub"><b>เรื่องนี้เป็นงานหลังบ้าน ไม่ใช่ข้อมูลจราจร</b> จึงเก็บไว้เฉพาะหน้านี้
        · กล้องกลุ่มนี้ส่งค่า “ไม่ฝ่าฝืน” มาทุกคันทั้งที่มีรถผ่านหลักแสน ซึ่งเป็นไปไม่ได้ทางสถิติ
        · ระบบกันออกจากค่าเฉลี่ยให้แล้ว
        · <b>ตรวจแล้วพบว่าแยกขาดตามรุ่นกล้อง</b> จึงน่าจะเป็นข้อจำกัดของรุ่น ไม่ใช่ลืมเปิดค่า</div>
      <div class="trf-tablewrap"><table class="trf-table">
        <thead><tr><th>จุดติดตั้ง</th><th>Site</th><th class="n">รถ 2-3 ล้อ</th><th class="n">ฝ่าฝืนที่พบ</th></tr></thead>
        <tbody>${noDet.map(c => `<tr><td>${escapeHtml(c.name)}</td>
          <td>${c.site_name ? `<span class="trf-badge" style="--sc:${escapeHtml(c.site_color || 'var(--accent)')}"><span class="dot"></span>${escapeHtml(c.site_name)}</span>` : '—'}</td>
          <td class="n">${_tfmt(c.moto)}</td><td class="n">0</td></tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}`;
}

function trfEffKind(el) { TRF.effKind = el.dataset.kind; renderTraffic(); }
function trfEffWin(el)  { TRF.effWin = Number(el.dataset.win); renderTraffic(); }
function trfEffDateChange(el) { TRF.effDate = el.value; renderTraffic(); }
function trfGroupsReset() { TRF.groups = null; renderTraffic(); }
function trfSaveThresh() {
  const m = document.getElementById('trfThreshMsg');
  if (m) { m.textContent = 'ยังไม่บันทึกลงฐานข้อมูล — จะเปิดใช้พร้อมแท็บรายงาน'; m.style.color = 'var(--warn)'; }
}

// ── modal เลือกประเภทรถ ─────────────────────────────────────
let _trfPendTypes = null;
function trfOpenTypes() {
  const types = TRF.data.vehicle_types || [];
  _trfPendTypes = new Set(TRF.types || types.map(t => t.type));
  document.getElementById('trfCamModalBody').innerHTML = types.map(t => `
    <label class="trf-camopt">
      <input type="checkbox" data-change="trfTypeToggle" data-t="${escapeHtml(t.type)}" ${_trfPendTypes.has(t.type) ? 'checked' : ''}>
      <span class="cn">${escapeHtml(TYPE_TH[t.type] || t.type)}<br><span class="cm">${escapeHtml(t.type)}</span></span>
      <span class="cp">${_tfmt(t.n)}</span>
    </label>`).join('');
  document.querySelector('#trfCamModal .trf-title').textContent = 'เลือกประเภทรถ';
  document.getElementById('trfCamCount').textContent = `เลือกไว้ ${_trfPendTypes.size} จาก ${types.length} ประเภท`;
  document.querySelector('[data-action="trfApplyCams"]').dataset.action = 'trfApplyTypes';
  document.getElementById('trfCamModal').hidden = false;
}
function trfTypeToggle(el) {
  el.checked ? _trfPendTypes.add(el.dataset.t) : _trfPendTypes.delete(el.dataset.t);
  const n = (TRF.data.vehicle_types || []).length;
  document.getElementById('trfCamCount').textContent = `เลือกไว้ ${_trfPendTypes.size} จาก ${n} ประเภท`;
}
function trfApplyTypes() {
  if (_trfPendTypes.size) {
    const all = (TRF.data.vehicle_types || []).length;
    TRF.types = _trfPendTypes.size === all ? null : new Set(_trfPendTypes);
  }
  // คืนปุ่ม/หัวข้อ modal ให้กลับไปเป็นของ "เลือกกล้อง" สำหรับครั้งถัดไป
  document.querySelector('[data-action="trfApplyTypes"]').dataset.action = 'trfApplyCams';
  document.querySelector('#trfCamModal .trf-title').textContent = 'เลือกกล้อง';
  document.getElementById('trfCamModal').hidden = true;
  renderTraffic();
}

// สลับมุมมอง อัตรา% ↔ จำนวนคันจริง — สองคำถามคนละคำถาม (ดู insight ในกราฟ)
function trfMetric(el) { TRF.metric = el.dataset.metric; renderTraffic(); }

// ── แท็บ · อันดับไม่สวมหมวกนิรภัย ─────────────────────────────
// ระดับ "ป้ายทะเบียนรายคัน" ต่างจากแท็บ "สถิติหมวกนิรภัย" ที่เป็นยอดรวม
// จึงมี endpoint แยก (/api/traffic/helmet-top) และกันสิทธิ์ที่ server ได้จริง
//
// ⚠️ เกณฑ์คัดกรองป้ายต้องแสดงบนหน้าจอเสมอ — ข้อมูลดิบอันดับต้นคือป้ายที่อ่านไม่ครบ
//    ('ข', '1', '111') ถ้าไม่บอกเกณฑ์ ผู้ใช้จะไม่รู้ว่าตัวเลขนี้ผ่านการกรองมาแล้ว
const TRF_TOP = {
  // day | yesterday | d3 | d5 | d7 | custom | month
  // "รายสัปดาห์" เดิมถูกถอดออก 2026-08-19 — ชื่อบอกว่าสัปดาห์แต่ดึงจากต้นสัปดาห์
  // ตามปฏิทิน เปิดดูวันพุธจึงได้แค่ 2 วัน (ดู resolveTopRange ใน routes/traffic.js)
  period: 'day',
  from: null,          // 'YYYY-MM-DD' — ใช้เมื่อ period === 'custom'
  to: null,
  data: null,
  loading: false,
  loadedSig: null,
  loadError: null,
  expanded: new Set(),   // อันดับที่กดขยายรายชื่อป้ายไว้
};

// พารามิเตอร์ช่วงเวลาที่ต้องแนบไปทุกครั้ง — ทั้งตอนโหลดหน้าจอและตอนสั่ง PDF
// แยกเป็นฟังก์ชันเดียวเพราะถ้า PDF ส่งไม่ครบ เอกสารจะออกคนละช่วงกับที่เห็นบนจอ
// ชุดช่วงเวลาตามที่เจ้าของสั่ง 2026-08-19 — ล้อกับตัวเลือก "ย้อนหลัง N วัน + กำหนดเอง"
// ของกราฟย้อนหลังในแท็บ "สถิติหมวกนิรภัย" หน้าเดียวกัน จะได้ไม่ต้องเรียนรู้ใหม่
// อยู่ระดับไฟล์เพราะ **หัวรายงาน PDF ต้องใช้คำเดียวกับปุ่มบนจอ** — เดิมหัวรายงาน
// พิมพ์ค่าดิบออกไป ("ช่วงเวลา: day") ซึ่งเป็นชื่อตัวแปรของเรา ไม่ใช่ภาษาที่ลูกค้าอ่าน
const TRF_TOP_PERIODS = [
  ['day', 'วันนี้'], ['yesterday', 'เมื่อวานนี้'],
  ['d3', '3 วัน'], ['d5', '5 วัน'], ['d7', '7 วัน'],
  ['custom', 'กำหนดเอง'], ['month', 'รายเดือน'],
];
const _trfPeriodLabel = (k) => (TRF_TOP_PERIODS.find(([v]) => v === k) || [])[1] || k;

function _trfTopPeriodParams() {
  const p = { period: TRF_TOP.period };
  if (TRF_TOP.period === 'custom' && TRF_TOP.from && TRF_TOP.to) {
    p.from = TRF_TOP.from;
    p.to   = TRF_TOP.to;
  }
  return p;
}

function _trfTopCamIds() {
  if (!TRF.sites.size && !TRF.cams) return null;
  return _trfHelmetCams().map(c => c.id);
}

function trfRenderTopHelmet(p) {
  const camIds = TRF.cams ? [...TRF.cams] : null;          // เลือกกล้องเองเท่านั้น
  const sites  = TRF.sites.size ? [...TRF.sites] : null;    // Site ให้ server กรอง
  // from/to ต้องอยู่ใน sig ด้วย ไม่งั้นเปลี่ยนวันที่ในโหมด "กำหนดเอง" แล้วหน้าจอ
  // คิดว่าโหลดชุดเดิมไปแล้ว เลยไม่ยิงใหม่ — ตัวเลขค้างช่วงเก่าอยู่เงียบ ๆ
  const sig = `${TRF_TOP.period}|${TRF_TOP.from || ''}|${TRF_TOP.to || ''}`
    + `|${sites ? sites.join(',') : 'all'}|${camIds ? camIds.join(',') : 'all'}`;
  if (TRF_TOP.loadedSig !== sig && !TRF_TOP.loading) _trfLoadTop(sig, camIds, sites);
  _trfRenderTopBody(p);
}

async function _trfLoadTop(sig, camIds, sites) {
  TRF_TOP.loading = true;
  TRF_TOP.loadError = null;
  try {
    const qs = new URLSearchParams(_trfTopPeriodParams());
    if (camIds) qs.set('cameras', camIds.join(','));
    if (sites) qs.set('sites', sites.join(','));
    const r = await fetch(`${API}/api/traffic/helmet-top?${qs}`, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    TRF_TOP.data = d;
  } catch (e) {
    TRF_TOP.data = null;
    TRF_TOP.loadError = e.message;
  } finally {
    // เหตุผลเดียวกับแท็บ helmet — พังแล้วต้องจำว่า sig นี้ลองแล้ว ไม่งั้นยิงซ้ำไม่หยุด
    TRF_TOP.loadedSig = sig;
    TRF_TOP.loading = false;
    if (TRF.tab === 'topHelmet') renderTraffic();
  }
}

function _trfRenderTopBody(p) {
  const PERIODS = TRF_TOP_PERIODS;
  const maxDate = TRF_HELMET.maxDate || '';
  const minDate = maxDate ? _trfHelmetDateAdd(maxDate, -119) : '';
  // ใช้ scope bar ตัวเดียวกับแท็บ "สถิติหมวกนิรภัย" — site + กล้อง (ไม่สร้างของใหม่)
  // แทรก "ช่วงเวลา" เข้าไปในแถบขอบเขตเดิม แทนที่จะขึ้นแถบที่สอง — ประหยัดพื้นที่
  // (_trfHelmetScopeBar คืน <div class="trf-scope">…</div> จึงเสียบก่อนปิด div)
  const periodGrp = `<div class="trf-grp"><span class="trf-lbl">ช่วงเวลา</span>
      <div class="trf-seg">${PERIODS.map(([k, l]) =>
        `<button type="button" class="${TRF_TOP.period === k ? 'on' : ''}"
           data-action="trfTopPeriod" data-period="${k}">${l}</button>`).join('')}</div>
      ${TRF_TOP.period === 'custom' ? `
      <div class="trf-range-custom">
        <input type="date" class="form-input" style="font-size:12px;padding:5px 9px"
          value="${escapeHtml(TRF_TOP.from || '')}" min="${escapeHtml(minDate)}" max="${escapeHtml(maxDate)}"
          data-change="trfTopFrom">
        <span>ถึง</span>
        <input type="date" class="form-input" style="font-size:12px;padding:5px 9px"
          value="${escapeHtml(TRF_TOP.to || '')}" min="${escapeHtml(minDate)}" max="${escapeHtml(maxDate)}"
          data-change="trfTopTo">
      </div>` : ''}
    </div>`;
  const bar = _trfHelmetScopeBar();
  const cut = bar.lastIndexOf('</div>');
  const head = cut > 0 ? bar.slice(0, cut) + periodGrp + bar.slice(cut) : bar + periodGrp;

  if (TRF_TOP.loadError) {
    p.innerHTML = head + `<div class="trf-note bad">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(TRF_TOP.loadError)}</div>`;
    return;
  }
  if (!TRF_TOP.data) { p.innerHTML = head + `<div class="trf-note">กำลังโหลด…</div>`; return; }
  // สลับช่วงเวลาแล้วข้อมูลเก่ายังอยู่ — ต้องบอกว่ากำลังโหลด ไม่งั้นดูเหมือนปุ่มไม่ทำงาน
  // (รายสัปดาห์/รายเดือนใช้เวลาหลายวินาที — ดู ROADMAP Phase HM เรื่อง index)
  const busy = TRF_TOP.loading
    ? `<div class="trf-note">กำลังโหลดช่วงเวลาใหม่… ช่วงที่ยาวขึ้นใช้เวลาสักครู่</div>` : '';

  const d = TRF_TOP.data;
  const rows = d.rows || [];
  const t = d.totals || {};
  // ต้องคำนวณก่อนสาขา rows ว่างด้านล่าง เพราะการ์ดชุดเดียวกันใช้ทั้งสองทาง
  const peakH = (d.hourly || []).reduce((a, b) => (Number(b.hits) > (a ? Number(a.hits) : -1) ? b : a), null);
  // ตารางอันดับว่างไม่ได้แปลว่าไม่มีการตรวจพบ — มันแปลว่าไม่มีป้ายไหน "ทำผิดซ้ำ"
  // ถึงเกณฑ์ ยอดรวมยังมีอยู่จริงและต้องแสดง (วัดจริง 2026-08-23 ช่วงต้นวัน:
  // ตรวจพบ 202 ครั้ง แต่หน้านี้ขึ้นว่า "ไม่พบรายการ" แล้วซ่อนตัวเลขทั้งหมด)
  if (!rows.length) {
    p.innerHTML = head + busy + _trfTopKpis(t, peakH, d.generated_at)
      + `<div class="trf-note">ยังไม่มีป้ายไหนทำผิดซ้ำถึงเกณฑ์ในช่วงที่เลือก</div>`;
    return;
  }

  // จำนวนครั้งเท่ากัน = อันดับเดียวกัน (server ส่งมาเป็นกลุ่มแล้ว)
  // ข้อมูลจริงหางยาวมาก — อันดับท้าย ๆ มีหลายสิบป้าย จึงโชว์ 3 ใบแรกแล้วให้กดขยาย
  const max = rows[0].hits || 1;
  const SHOW = 3;
  // server คัดผู้เข้าชิงได้สูงสุด 200 ป้าย ซึ่งอาจตัดกลางอันดับล่างสุดพอดี
  // แถวนั้นจึงมีป้ายไม่ครบ — ต้องติดเครื่องหมายไว้ ไม่ใช่โชว์ตัวเลขที่ต่ำกว่าจริงเฉย ๆ
  const cutRank = d.capped ? Math.max(...rows.map(r => r.rank)) : null;
  const list = rows.map((r) => {
    const ps = r.plates || [];
    const open = TRF_TOP.expanded.has(r.rank);
    const shown = open ? ps : ps.slice(0, SHOW);
    const more = ps.length > SHOW
      ? `<button type="button" class="trf-plate-more" data-action="trfTopMore" data-rank="${r.rank}">${
          open ? 'ย่อ' : '+' + (ps.length - SHOW) + ' ป้าย'}</button>`
      : '';
    const cams = Math.max(...ps.map(x => x.cams || 0), 0);
    return `<div class="trf-toprow"${r.rank <= 3 ? ' data-hot="1"' : ''}>
      <div class="trf-toprank">${r.rank}</div>
      <div class="trf-plaques">${shown.map((x) => {
        // จังหวัดบนป้ายเป็นแค่ "เสียงข้างมาก" ของสิ่งที่กล้องอ่านได้ ไม่ใช่ข้อเท็จจริง
        // ติดเครื่องหมายเฉพาะคันที่จังหวัดรองมีน้ำหนักจริง (server ส่ง region_alt มาให้แล้ว
        // ถ้าไม่เข้าเกณฑ์จะเป็น null) — ถ้าติดทุกคันที่อ่านได้เกิน 1 จังหวัด จะติด 3 ใน 4 แถว
        const amb = x.region && x.region_alt
          ? I18N.t('trf.regionAmbiguous', 'จังหวัดยังไม่นิ่ง — กล้องอ่านคันนี้เป็น {alt} อยู่ {pct}% ของครั้งที่อ่านจังหวัดออก ต้องยืนยันก่อนใช้อ้างอิง')
              .replace('{alt}', x.region_alt).replace('{pct}', x.region_alt_pct)
          : '';
        return `<button type="button" class="trf-plaque${amb ? ' is-amb' : ''}" data-action="trfTopPlate" data-plate="${escapeHtml(x.plate)}"${
          amb ? ` title="${escapeHtml(amb)}"` : ''}>
          <strong>${escapeHtml(x.plate)}</strong><small>${
            x.region ? escapeHtml(x.region) : 'ดูรายละเอียด'}${
            amb ? '<i aria-hidden="true">?</i>' : ''}</small></button>`;
      }).join('')}${more}</div>
      <div class="trf-topbarwrap"><div class="trf-topbar-bg"><div class="trf-topbar"
        style="width:${Math.max(6, r.hits / max * 100).toFixed(1)}%"></div></div></div>
      <div class="trf-topval"><b>${_tfmt(r.hits)}</b><span>ครั้ง</span></div>
      <div class="trf-topcam"${r.rank === cutRank ? ' title="อันดับนี้อาจมีป้ายมากกว่าที่แสดง"' : ''
        }><b>${ps.length}${r.rank === cutRank ? '+' : ''}</b><span>คัน</span></div>
    </div>`;
  }).join('');

  // บนมือถือไม่มี hover ⇒ เครื่องหมาย ? อธิบายตัวเองไม่ได้ ต้องมีบรรทัดสรุปใต้ตารางเสมอ


  // การ์ด "จุดตรวจจับที่พบมากที่สุด" ย้ายไปหน้าวินัยจราจรแล้ว (2026-08-27) และใช้
  // no_helmet ของหน้านั้นแทน hits — hits นับเฉพาะคนที่ทำผิดซ้ำ จึงเป็นคนละตัวเลข
  // ⇒ d.cameras ไม่ถูกใช้ในหน้านี้อีก แต่ endpoint ยังส่งมา ไม่ได้แตะฝั่ง server

  p.innerHTML = head + _trfExportBar() + busy + `
    ${_trfTopKpis(t, peakH, d.generated_at)}

    <div class="trf-card">
      <div class="trf-head">
        <div>
          <div class="trf-title">อันดับป้ายทะเบียนที่ตรวจพบบ่อยที่สุด</div>
          <div class="trf-sub">เฉพาะรถจักรยานยนต์ที่ทำผิดซ้ำ พร้อมข้อมูลป้ายทะเบียน
            - กดที่ป้ายเพื่อไปดูรายละเอียดเพิ่มเติม</div>
        </div>
        <div class="trf-repbtns">
          <button class="btn-mini" data-action="trfTopReport"
            title="หนึ่งคันหนึ่งหน้า ภาพหลักฐานขนาดใหญ่ · เฉพาะ 10 คันที่ทำผิดถี่ที่สุด ไม่ใช่ทุกคันในอันดับ"
            >เจาะลึก 10 คัน (PDF)</button>
          <button class="btn-mini" data-action="trfTopTable" data-mode="text"
            title="ตารางแนวนอน หนึ่งคันหนึ่งแถว ครบทุกคันใน 10 อันดับ">ตารางข้อความ (PDF)</button>
          <button class="btn-mini" data-action="trfTopTable" data-mode="image"
            title="ตารางแนวนอนพร้อมภาพ 3 แบบต่อคัน · ใช้เวลาสร้างราวครึ่งนาที">ตารางพร้อมภาพ (PDF)</button>
        </div>
      </div>
      <div class="trf-toplist">${list}</div>

    </div>

    <div class="trf-card">
      <div class="trf-head"><div>
        <div class="trf-title">ช่วงเวลาที่พบมากที่สุด</div>
        <div class="trf-sub">ใช้เลือกเวลาตั้งด่านให้ตรงกับที่คนฝ่าฝืนจริง</div>
      </div></div>
      ${_trfChartBox('trfTopHour', 24, '', 34)}
      <div class="trf-note" id="trfTopHourNote"></div>
    </div>

    <div class="trf-card">
      <div class="trf-head"><div>
        <div class="trf-title">ป้ายทะเบียนที่ทำผิดซ้ำ</div>
        <div class="trf-sub">แยกตามจำนวนครั้งที่ถูกตรวจพบในช่วงที่เลือก</div>
      </div></div>
      ${_trfChartBox('trfTopRepeat', 5, '', 110)}
    </div>`;

  _trfDrawTopCharts(d);
}

// กราฟ 2 อันของแท็บนี้ — ข้อมูลมาจาก endpoint เดียวกัน ไม่ยิงเพิ่ม
function _trfDrawTopCharts(d) {
  const ink  = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#8a94a6';
  const grid = getComputedStyle(document.documentElement).getPropertyValue('--border-hairline').trim() || '#2a3140';
  const warn = getComputedStyle(document.documentElement).getPropertyValue('--warn').trim() || '#d98324';
  const bad  = getComputedStyle(document.documentElement).getPropertyValue('--status-bad').trim() || '#e5484d';
  const acc  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1678d4';

  // ── ช่วงเวลา — เติมชั่วโมงที่ไม่มีข้อมูลให้ครบ 24 ไม่งั้นแกนเบี้ยว
  const byH = new Map((d.hourly || []).map(r => [Number(r.h), Number(r.hits)]));
  const hours = Array.from({ length: 24 }, (_, h) => byH.get(h) || 0);
  const hmax = Math.max(...hours, 1);
  trfChart('trfTopHour', {
    type: 'bar',
    data: { labels: hours.map((_, h) => String(h).padStart(2, '0')),
      datasets: [{ data: hours, borderRadius: 3,
        backgroundColor: hours.map(v => (v >= hmax * 0.8 ? bad : warn)) }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { title: (c) => `เวลา ${c[0].label}:00 น.` } } },
      scales: { x: { grid: { display: false }, ticks: { color: ink, font: { size: 9 }, autoSkip: false, maxRotation: 0 } },
                y: { beginAtZero: true, grid: { color: grid }, ticks: { color: ink, font: { size: 10 } } } } },
  });
  const peak = hours.indexOf(Math.max(...hours));
  const am = hours.slice(6, 9).reduce((a, b) => a + b, 0);
  const pm = hours.slice(16, 19).reduce((a, b) => a + b, 0);
  const hn = document.getElementById('trfTopHourNote');
  if (hn) hn.innerHTML = `ชั่วโมงที่พบมากที่สุดคือ <b>${String(peak).padStart(2, '0')}:00 น.</b> ·
    ช่วงเช้า 06:00–08:00 รวม <b>${_tfmt(am)}</b> ครั้ง · ช่วงเย็น 16:00–18:00 รวม <b>${_tfmt(pm)}</b> ครั้ง`;

  // ── ผู้ทำผิดซ้ำ — เรียงตามลำดับช่วงเสมอ (server คืนมาไม่เรียง)
  // ไม่มีแถบ "1 ครั้ง": การ์ดนี้นับเฉพาะผู้ที่ทำผิดซ้ำตั้งแต่ min_hits (3) ขึ้นไปอยู่แล้ว
  // แถบนั้นจึงเป็น 0 เสมอ และกินที่ในกราฟไปเปล่า ๆ (เจ้าของทัก 2026-09-09)
  const ORDER = ['2-3', '4-7', '8-14', '15+'];
  const byB = new Map((d.repeat || []).map(r => [r.band, Number(r.plates)]));
  const vals = ORDER.map(b => byB.get(b) || 0);
  trfChart('trfTopRepeat', {
    type: 'bar',
    data: { labels: ORDER.map(b => b + ' ครั้ง'),
      datasets: [{ data: vals, borderRadius: 4,
        backgroundColor: ORDER.map((_, i) => (i >= 3 ? bad : acc)) }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${_tfmt(c.raw)} ป้ายทะเบียน` } } },
      scales: { x: { beginAtZero: true, grid: { color: grid }, ticks: { color: ink, font: { size: 10 } } },
                y: { grid: { display: false }, ticks: { color: ink, font: { size: 11 } } } } },
  });
}

function trfTopPeriod(el) {
  TRF_TOP.period = el.dataset.period;
  // ตั้งค่าเริ่มต้นให้ "กำหนดเอง" เป็นช่วง 7 วันล่าสุด — เปิดมาแล้วมีข้อมูลเลย
  // ไม่ใช่ช่องว่างสองช่องที่ยิง request ไม่ได้จนกว่าจะกรอกครบ
  if (TRF_TOP.period === 'custom' && !(TRF_TOP.from && TRF_TOP.to)) {
    const end = TRF_HELMET.maxDate || new Date().toISOString().slice(0, 10);
    TRF_TOP.to   = TRF_TOP.to   || end;
    TRF_TOP.from = TRF_TOP.from || _trfHelmetDateAdd(end, -6);
  }
  TRF_TOP.expanded.clear();
  renderTraffic();
}
function trfTopFrom(el) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
  TRF_TOP.from = el.value; TRF_TOP.expanded.clear(); renderTraffic();
}
function trfTopTo(el) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
  TRF_TOP.to = el.value; TRF_TOP.expanded.clear(); renderTraffic();
}
function trfTopMore(el) {
  const r = Number(el.dataset.rank);
  if (TRF_TOP.expanded.has(r)) TRF_TOP.expanded.delete(r); else TRF_TOP.expanded.add(r);
  renderTraffic();
}

// กดป้าย → เปิด modal รายละเอียดตัวเดียวกับหน้าค้นหาป้ายทะเบียน
// ใช้ _lprOpenModal() ของ page-lpr.js ซ้ำ (รับ event object ตรงได้) แทนการสร้าง
// modal ใหม่ — ของเดิมมีภาพ CROP/snapshot/ประวัติผ่านซ้ำ 24 ชม. ครบอยู่แล้ว
async function trfTopPlate(el) {
  const plate = el.dataset.plate;
  if (typeof _lprOpenModal !== 'function') { alert('เปิดรายละเอียดไม่ได้ในขณะนี้'); return; }
  const old = el.querySelector('small');
  const oldTxt = old ? old.textContent : '';
  if (old) old.textContent = 'กำลังโหลด…';
  try {
    // exact=1 — ไม่งั้นได้ป้ายที่ "คล้าย" ปนมา แล้ว modal จะโชว์คันผิด
    // helmet=no — ป้ายเดียวกันมีทั้งรอบที่ใส่และไม่ใส่หมวก ถ้าไม่กรอง modal จะหยิบ
    // รอบล่าสุดซึ่งอาจเป็นรอบที่ "ใส่หมวก" มาเป็นหลักฐานของอันดับคนไม่สวมหมวก
    // (เจอจริง 2026-08-16: 1กบ9694 โชว์ "ใส่หมวก" ในอันดับไม่สวมหมวก)
    // ดึงมาหลายรอบแล้วเลือก "ใบที่ดีที่สุด" — รอบล่าสุดอาจเป็นภาพกลางคืนที่อ่าน
    // จังหวัดไม่ออก ทำให้ modal ขึ้น "ไม่ทราบ" ทั้งที่ป้ายในภาพเห็นจังหวัดชัด
    // ใช้ endpoint ของแท็บนี้เอง ไม่ใช่ /api/lpr — ผู้ใช้ที่ได้สิทธิ์เฉพาะแท็บนี้จะโดน
    // 403 จาก /api/lpr แล้วขึ้นข้อความว่า "ไม่พบข้อมูล" ซึ่งไม่จริง (เจอจริง 2026-08-16)
    const qs = new URLSearchParams({ plate });
    if (TRF.cams) qs.set('cameras', [...TRF.cams].join(','));
    if (TRF.sites.size) qs.set('sites', [...TRF.sites].join(','));
    const r = await fetch(`${API}/api/traffic/helmet-top/plate?${qs}`, { credentials: 'include' });
    if (!r.ok) {
      // แยก "ไม่มีสิทธิ์" ออกจาก "ไม่มีข้อมูล" ให้ชัด ไม่งั้นคนไล่หาสาเหตุผิดทาง
      alert(r.status === 403
        ? 'บัญชีนี้ไม่มีสิทธิ์ดูรายละเอียดป้ายทะเบียน — ติดต่อผู้ดูแลระบบ'
        : `เปิดรายละเอียดไม่สำเร็จ (${r.status})`);
      return;
    }
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) { alert(`ไม่พบข้อมูลของป้าย ${plate}`); return; }
    const score = (x) => {
      const rj = x.raw_json || {};
      const hasRegion = (x.lp_region || rj.region) ? 1 : 0;
      const hasScene  = x.snapshot_file ? 1 : 0;
      const conf = Number(x.confidence ?? rj.confidence ?? 0);
      return hasRegion * 1000 + hasScene * 100 + conf;   // จังหวัดสำคัญสุด แล้วค่อยภาพ แล้วค่อยความมั่นใจ
    };
    const best = rows.slice().sort((a, b) => score(b) - score(a))[0];
    _lprOpenModal(best);
  } catch (e) {
    alert('โหลดรายละเอียดไม่สำเร็จ: ' + e.message);
  } finally {
    if (old) old.textContent = oldTxt;
  }
}

// ตารางแนวนอน — ครอบคลุมทุกคันใน 10 อันดับ (รายวันมีถึง ~230 คัน) ไม่ใช่แค่ 10 คัน
// แบบมีภาพใช้เวลาราว 35 วินาที จึงบอกผู้ใช้ก่อน ไม่ปล่อยให้นั่งมองแท็บว่าง
function trfTopTable(el) {
  const mode = el.dataset.mode === 'image' ? 'image' : 'text';
  const qs = new URLSearchParams({ ..._trfTopPeriodParams(), mode });
  if (TRF.cams) qs.set('cameras', [...TRF.cams].join(','));
  if (TRF.sites.size) qs.set('sites', [...TRF.sites].join(','));
  qs.set('_', Date.now());   // กันแคชตัวกลาง — URL ซ้ำเดิมทุกวันจึงถูกแคชง่าย
  if (mode === 'image' && !confirm('รายงานพร้อมภาพของทุกคันใน 10 อันดับ ใช้เวลาสร้างราว 30–40 วินาที\nเปิดในแท็บใหม่แล้วรอสักครู่ ยืนยันหรือไม่?')) return;
  window.open(`${API}/api/traffic/helmet-top/report-table.pdf?${qs}`, '_blank', 'noopener');
}

function trfTopReport() {
  // เปิดแท็บใหม่ — PDF ใช้เวลาสร้างหลายวินาที (ต้องโหลดภาพหลักฐานทุกใบ)
  const qs = new URLSearchParams(_trfTopPeriodParams());
  if (TRF.cams) qs.set('cameras', [...TRF.cams].join(','));
  if (TRF.sites.size) qs.set('sites', [...TRF.sites].join(','));
  qs.set('_', Date.now());
  window.open(`${API}/api/traffic/helmet-top/report.pdf?${qs}`, '_blank', 'noopener');
}
