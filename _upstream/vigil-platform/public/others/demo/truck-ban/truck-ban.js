// ============================================================
// Vigil Platform — รถบรรทุกวิ่งในช่วงห้าม (live demo)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// หน้าตาตาม "อันดับไม่สวมหมวกนิรภัย" + "สถิติหมวกนิรภัย" (เจ้าของสั่ง 2026-10-26): เน้นป้ายทะเบียนและการทำผิดซ้ำ
//
// ทุกตัวเลขนับที่เซิร์ฟเวอร์ (routes/lpr-list.js) — อันดับ/KPI = GET /api/lpr/truck-ban/ranking ทุกช่วงเวลา (เจ้าของสั่ง 2026-11-02)
//   หน้าเว็บส่ง "วันบังคับใช้" (ตัดเสาร์–อาทิตย์ + วันหยุดราชการจาก truck-ban-data.js) · ภาพของป้าย = /plate/:plate ตอนเปิดหน้าต่าง
// "ครั้ง" = 1 ต่อป้ายต่อช่วงห้ามต่อวัน · หนึ่งคันผ่านหลายกล้องในช่วงเดียวกันยังนับ 1
//   (นับตามภาพที่กล้องจับได้จะทำให้คันที่ผ่าน 3 กล้องดูผิดซ้ำ 3 เท่า) · ตรวจเทียบอัลกอริทึมเดิม 3 วัน ตรงทุกป้าย (2026-11-02)
// ปุ่มต่อป้าย: Reject (ซ่อนถาวร) · ไม่แน่ใจ (kind=defer — ไม่นับเหมือน Reject แต่อยู่ในกล่อง "ไม่แน่ใจ N ป้าย" ให้ตัดสินทีหลัง) · migration 286
// CSP: script-src 'self' — ไม่มี inline handler · ทุกปุ่มใช้ data-action ผ่าน listener เดียว
// ============================================================
(function () {
  'use strict';
  const CFG = window.TRUCK_BAN;
  if (!CFG || !window.Chart) return;

  const MAX_DAYS = 400, CHIPS = 3, BUCKETS = 48;   // MAX_DAYS = เพดานวันบังคับใช้ต่อคำขอของเซิร์ฟเวอร์
  const BANDS = [[12, 18], [32, 38]];              // ดัชนีถัง 30 นาที: 06:00–09:00 · 16:00–19:00
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (n) => Number(n).toLocaleString('th-TH');
  const img = (p) => (p ? '/snapshots/' + encodeURI(p) : '');
  const wrap = document.querySelector('.tb-wrap');
  const css = (name) => getComputedStyle(wrap).getPropertyValue(name).trim();

  // ── เวลาไทย ──────────────────────────────────────────────────
  const bkkParts = (d) => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t).value;
    return { day: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}` };
  };
  const hm = (t) => bkkParts(new Date(t)).hm;
  const iso = (day, t) => new Date(`${day}T${t.length === 5 ? t + ':00' : t}+07:00`).toISOString();
  const addDays = (day, n) => { const d = new Date(day + 'T12:00:00+07:00'); d.setUTCDate(d.getUTCDate() + n); return bkkParts(d).day; };
  const dow = (day) => new Date(day + 'T12:00:00+07:00').getUTCDay();
  const thDate = (day, o) => new Date(day + 'T12:00:00+07:00').toLocaleDateString('th-TH', { ...o, timeZone: 'Asia/Bangkok' });
  const dayShort = (day) => thDate(day, { weekday: 'short', day: 'numeric', month: 'short' });
  const dayLong = (day) => thDate(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const bucketOf = (t) => { const [h, m] = hm(t).split(':').map(Number); return h * 2 + (m >= 30 ? 1 : 0); };
  const bucketLabel = (i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  const LABELS = Array.from({ length: BUCKETS }, (_, i) => bucketLabel(i));

  function statusOf(day) {
    const w = dow(day);
    if (w === 6) return { enforce: false, label: 'วันเสาร์' };
    if (w === 0) return { enforce: false, label: 'วันอาทิตย์' };
    if (CFG.holidays[day]) return { enforce: false, label: CFG.holidays[day], holiday: true };
    return { enforce: true, label: 'บังคับใช้' };
  }
  const fmtPlate = (p) => (/^\d{6}$/.test(p) ? p.slice(0, 2) + '-' + p.slice(2) : /^\d{7}$/.test(p) ? p.slice(0, 3) + '-' + p.slice(3) : p);
  const WIN = Object.fromEntries(CFG.windows.map((w) => [w.key, w]));

  // ── ดึงข้อมูล ───────────────────────────────────────────────
  // ตัวกรองร่วมของทุกคำขอฝั่งเซิร์ฟเวอร์ (กล้อง · รถบรรทุกเล็ก) — Reject ตัดที่เซิร์ฟเวอร์อยู่แล้ว
  function baseQs(extra) {
    const qs = new URLSearchParams({ site: CFG.site, ...extra });
    if (state.light) qs.set('light', '1');
    if (state.cams) qs.set('cameras', [...state.cams].join(','));
    return qs;
  }
  async function fetchRank(days, signal) {
    // marked=1 = จำนวนครั้งของป้ายใน Reject/ไม่แน่ใจ ในช่วงเดียวกัน (ให้กล่อง "ไม่แน่ใจ" แสดงครั้ง) · ไม่กระทบ kpis/rows
    const r = await fetch('/api/lpr/truck-ban/ranking?' + baseQs({ days: days.join(','), q: state.q.replace(/\D/g, ''), limit: '2000', marked: '1' }),
      { credentials: 'same-origin', signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.oldest) state.oldest = d.oldest;
    state.marked = new Map((d.marked || []).map((x) => [x.plate, x]));
    return d;
  }

  // ── สถานะหน้า ───────────────────────────────────────────────
  const today = bkkParts(new Date()).day;
  const yesterday = addDays(today, -1);
  // light=false (ค่าเริ่ม) = เฉพาะ truck · buggy ในศัพท์ Hikvision = รถบรรทุกเล็ก (src/helpers/lprLabels.js) ซึ่งไม่อยู่ในข้อห้าม
  //   ดึงมาทั้งคู่เสมอแล้วกรองที่หน้าเว็บ ⇒ สลับปุ่มได้ทันทีไม่ต้องดึงใหม่ (22 ต.ค.: 464 จาก 1,140 ป้ายเป็น buggy อย่างเดียว)
  // rank = คำตอบของ /ranking (kpis · groups · rows · cam_plates) · days = วันที่ส่งไปล่าสุด (หน้าต่างป้าย/PDF ใช้ชุดเดียวกัน)
  const state = { r: '0', from: today, to: today, q: '', open: new Set(), rank: null, days: [], oldest: null, light: false, cams: null, marked: new Map() };   // cams: null = ทุกกล้องของไซต์ · Set = เฉพาะที่เลือก
  // Reject รายป้าย (migration 281) = ไม่ต้องแจ้งป้ายนี้อีก · ซ่อนทั้งย้อนหลังและต่อไป · คืนสถานะได้จากปุ่ม "ซ่อนแล้ว N ป้าย"
  // ไม่แน่ใจ (migration 286, kind='defer') = ไม่นับเหมือนกัน แต่ดูครั้ง/ภาพได้ในกล่อง "ไม่แน่ใจ N ป้าย" · marked = นับครั้งในช่วงที่เลือก
  const rej = { map: new Map(), ok: false };
  async function loadRejections() {
    try {
      const r = await fetch('/api/lpr/truck-ban/rejections', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      rej.map = new Map((await r.json()).map((x) => [x.plate_number, x])); rej.ok = true;
    } catch { rej.ok = false; }   // ยังไม่มีตาราง/API = ซ่อนปุ่ม Reject ไว้ ทุกอย่างอื่นทำงานตามเดิม
  }
  let curDay = null;
  let rangeCtrl = null, liveCtrl = null, dayCtrl = null, liveChart = null, dayChart = null;

  function setState(t) { const el = $('tbState'); el.textContent = t; el.hidden = !t; }
  function rangeDays() {
    const out = []; for (let d = state.from; d <= state.to; d = addDays(d, 1)) out.push(d);
    return out;
  }

  async function loadRange({ silent = false } = {}) {
    if (rangeCtrl) rangeCtrl.abort();
    rangeCtrl = new AbortController(); const signal = rangeCtrl.signal;
    const days = rangeDays(), enf = days.filter((d) => statusOf(d).enforce).slice(-MAX_DAYS);
    const off = days.length - enf.length;
    $('tbRangeInfo').textContent = days.length ? `${days.length === 1 ? dayShort(days[0]) : dayShort(days[0]) + ' – ' + dayShort(days[days.length - 1])} · บังคับใช้ ${enf.length} วัน`
      + (off ? ` · ไม่นับ ${off} วัน (เสาร์–อาทิตย์/วันหยุดราชการ)` : '') : '';
    const now = new Date();
    state.days = enf.filter((d) => new Date(iso(d, CFG.windows[0].from)) <= now);
    renderPdfBtns();
    if (!state.days.length) {
      state.rank = null; state.marked = new Map(); renderAll();
      setState(enf.length ? 'ยังไม่ถึงช่วงห้ามของวันนี้' : `${days.map((d) => statusOf(d).label).filter((v, i, a) => a.indexOf(v) === i).join(' · ')} · ไม่บังคับใช้`);
      return;
    }
    if (!silent) setState('กำลังโหลด…');
    try {
      const d = await fetchRank(state.days, signal);
      if (signal.aborted) return;
      state.rank = d;
      setState('');
      renderAll();
    } catch (e) {
      if (e.name !== 'AbortError') setState('โหลดไม่สำเร็จ · ' + e.message);
    }
  }

  // ── วาด: KPI + อันดับ ───────────────────────────────────────
  function renderKpis() {
    const k = state.rank && state.rank.kpis, has = !!(k && k.plates);
    $('kpiViol').textContent = has ? fmtN(k.violations) : '—';
    $('kpiPlates').textContent = has ? fmtN(k.plates) : '—';
    $('kpiRepeat').textContent = has ? fmtN(k.repeaters) : '—';
    $('kpiRepeatU').textContent = has ? `คัน · สูงสุด ${fmtN(k.max_per_plate)} ครั้ง/คัน` : 'คัน';
    $('kpiPeak').textContent = has && k.peak ? k.peak.bucket : '—';
    $('kpiPeakU').textContent = has && k.peak ? `${fmtN(k.peak.n)} ครั้ง` : '';
  }

  function chip(p) {
    return `<button class="tb-chip" data-action="plate" data-p="${esc(p.plate)}">
      <b>${esc(fmtPlate(p.plate))}</b><span>${esc(p.region || 'ไม่ทราบจังหวัด')}</span></button>`;
  }

  // จำนวนคันต่อกลุ่มมาจาก groups (นับครบทุกคัน) · ป้ายที่โหลดมามีถึง 2,000 คัน — กลุ่มท้ายของช่วงยาวอาจโหลดมาไม่ครบ
  function renderRank() {
    const d = state.rank, rows = d ? d.rows : [];
    const byN = new Map();
    for (const p of rows) { if (!byN.has(p.n)) byN.set(p.n, []); byN.get(p.n).push(p); }
    const groups = d ? d.groups : [];
    const max = groups.length ? groups[0].n : 1;
    $('tbRank').innerHTML = groups.map((g, i) => {
      const ps = byN.get(g.n) || [];
      const open = state.open.has(g.n);
      const shown = open ? ps : ps.slice(0, CHIPS);
      const more = g.plates - shown.length;
      return `<div class="tb-row${i < 3 ? ' top' : ''}">
        <span class="tb-rk">${i + 1}</span>
        <div class="tb-chips">${shown.map(chip).join('')}
          ${more > 0 ? (ps.length > shown.length ? `<button class="tb-more" data-action="more" data-n="${g.n}">+${fmtN(more)} ป้าย</button>`
            : `<span class="tb-note">+${fmtN(more)} ป้าย</span>`) : ''}
          ${open && ps.length > CHIPS ? `<button class="tb-more" data-action="more" data-n="${g.n}">ย่อ</button>` : ''}</div>
        <span class="tb-rbar"><span class="tb-rbar-f" data-w="${Math.max(2, Math.round((g.n / max) * 100))}"></span></span>
        <span class="tb-rnum n1"><b>${fmtN(g.n)}</b><small>ครั้ง</small></span>
        <span class="tb-rnum n2"><b>${fmtN(g.plates)}</b><small>คัน</small></span>
      </div>`;
    }).join('');
    for (const el of $('tbRank').querySelectorAll('.tb-rbar-f')) el.style.width = el.dataset.w + '%';
    $('tbRankEmpty').hidden = !!groups.length || !!$('tbState').textContent;
  }

  function renderAll() {
    renderKpis(); renderRank();
    for (const [id, k, t] of [['tbRejBtn', 'reject', 'ซ่อนแล้ว'], ['tbDeferBtn', 'defer', 'ไม่แน่ใจ']]) {
      const b = $(id), n = markedRows(k).length;
      b.hidden = !rej.ok || !n;
      b.textContent = `${t} ${fmtN(n)} ป้าย`;
    }
  }

  // ── รายละเอียดป้าย ──────────────────────────────────────────
  // หน้าต่างมี 2 มุมมองในกรอบเดียว: ตารางรวมทุกครั้งของป้าย (list) → กดภาพ = รายละเอียดหนึ่งภาพ (detail) + ปุ่มย้อนกลับ
  const lb = { plate: null, reads: [], idx: -1, scroll: 0, tok: 0, list: null };   // list = 'reject' | 'defer' ตอนเปิดกล่องรายชื่อ
  // ปุ่มหัวหน้าต่าง: ป้ายปกติ = ไม่แน่ใจ + Reject · ป้าย "ไม่แน่ใจ" = ใช่เป้าหมาย + Reject · ป้ายที่ Reject แล้ว = ไม่มีปุ่ม (คืนสถานะที่กล่อง "ซ่อนแล้ว")
  const curPlate = () => (lb.plate ? lb.plate.plate : (lb.reads[lb.idx] || {}).plate_number);
  function syncMarkBtns() {
    const p = curPlate(), k = p && rej.map.has(p) ? (rej.map.get(p).kind === 'defer' ? 'defer' : 'reject') : null;
    const on = rej.ok && !!p;
    $('lbDefer').hidden = !on || !!k;
    $('lbYes').hidden = !on || k !== 'defer';
    $('lbReject').hidden = !on || k === 'reject';
  }
  const VT_TH = { truck: 'รถบรรทุก', buggy: 'รถบรรทุกเล็ก' };
  const VCOLOR_TH = { white: 'ขาว', black: 'ดำ', gray: 'เทา', grey: 'เทา', silver: 'เงิน', red: 'แดง', blue: 'น้ำเงิน', yellow: 'เหลือง',
    green: 'เขียว', brown: 'น้ำตาล', orange: 'ส้ม', cyan: 'ฟ้า', pink: 'ชมพู', purple: 'ม่วง', golden: 'ทอง', unknown: 'ไม่ทราบ' };
  const PCOLOR_TH = { white: 'ป้ายขาว (ส่วนบุคคล)', yellow: 'ป้ายเหลือง (รับจ้าง)', green: 'ป้ายเขียว', red: 'ป้ายแดง (รถใหม่)',
    blue: 'ป้ายน้ำเงิน', black: 'ป้ายดำ', orange: 'ป้ายส้ม', colorful: 'ป้ายประมูล' };
  const brandOf = (b) => (!b ? '' : /^\d+$/.test(b) ? ((window.TRUCK_BAN_BRANDS || {})[b] || 'รหัส ' + b) : b);
  const confOf = (c) => (c == null ? '' : `${Math.round(c <= 1 ? c * 100 : c)}%`);
  const bboxOk = (r) => r.vehicle_bbox_width > 0 && r.vehicle_bbox_height > 0 && r.vehicle_bbox_x >= 0 && r.vehicle_bbox_y >= 0
    && r.vehicle_bbox_x + r.vehicle_bbox_width <= 1000 && r.vehicle_bbox_y + r.vehicle_bbox_height <= 1000;

  // ภาพของป้ายดึงตอนเปิด (GET /api/lpr/truck-ban/plate/:plate · วัน/กล้อง/ประเภทชุดเดียวกับอันดับ) แล้วจัดเป็น "ครั้ง" ที่นี่
  async function openPlate(plate) {
    // ป้ายใน Reject/ไม่แน่ใจ ไม่อยู่ใน rows ของอันดับ ⇒ ใช้ผลนับของ marked (ไม่มีครั้งในช่วงนี้ = 0)
    const row = (state.rank && state.rank.rows.find((x) => x.plate === plate)) || state.marked.get(plate)
      || (rej.map.has(plate) ? { plate, n: 0, region: null } : null);
    if (!row) return;
    const tok = ++lb.tok;
    lb.plate = { plate, region: row.region, viol: [] }; lb.reads = []; lb.idx = -1; lb.list = null;
    $('lbBack').hidden = true; $('lbNav').hidden = true; syncMarkBtns(); $('lbRejForm').hidden = true;
    $('lbTitle').textContent = fmtPlate(plate) + (row.region ? ' · ' + row.region : '');
    $('lbSub').textContent = `${fmtN(row.n)} ครั้ง`;
    $('lbBody').innerHTML = '<div class="tb-empty">กำลังโหลด…</div>';
    $('tbLb').hidden = false;
    $('lbBody').scrollTop = 0;
    $('tbLb').querySelector('[data-action="lbClose"]').focus();
    try {
      const r = await fetch('/api/lpr/truck-ban/plate/' + encodeURIComponent(plate) + '?'
        + baseQs({ days: state.days.join(','), ...(rej.map.has(plate) ? { include_marked: '1' } : {}) }),
        { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const reads = await r.json();
      if (tok !== lb.tok || !lb.plate) return;   // ผู้ใช้กดป้ายอื่น/ปิดไปแล้ว
      const vm = new Map();
      for (const x of reads) {
        const k = x.day + '|' + x.win;
        if (!vm.has(k)) vm.set(k, { day: x.day, win: x.win, reads: [] });
        vm.get(k).reads.push(x);
      }
      const viol = [...vm.values()];
      for (const v of viol) { v.first = v.reads[0].event_time; v.last = v.reads[v.reads.length - 1].event_time; }
      viol.sort((a, b) => (a.first < b.first ? 1 : -1));
      lb.plate.viol = viol; lb.reads = viol.flatMap((v) => v.reads);
      renderPlateList();
    } catch (e) {
      if (tok === lb.tok) $('lbBody').innerHTML = `<div class="tb-empty">โหลดไม่สำเร็จ · ${esc(e.message)}</div>`;
    }
  }
  function renderPlateList() {
    const p = lb.plate, days = new Set(p.viol.map((v) => v.day)).size;
    $('lbBack').hidden = true; $('lbNav').hidden = true; syncMarkBtns(); $('lbRejForm').hidden = true;
    $('lbTitle').textContent = fmtPlate(p.plate) + (p.region ? ' · ' + p.region : '');
    $('lbSub').textContent = `${fmtN(p.viol.length)} ครั้ง · ${fmtN(days)} วัน · กดภาพเพื่อดูรายละเอียด`;
    $('lbBody').innerHTML = p.viol.map((v) => {
      const cams = [...new Set(v.reads.map((r) => r.camera_id))];
      return `<section class="tb-lb-v">
        <h4><span class="tb-pill ${v.win}">${esc(WIN[v.win].label)}</span> ${esc(dayShort(v.day))} · ${hm(v.first)}${v.last !== v.first ? '–' + hm(v.last) : ''} น.
          <small>${esc(cams.join(' · '))}</small></h4>
        <div class="tb-lb-pics">${v.reads.map((r) => `<button class="tb-lb-item" data-action="read" data-i="${lb.reads.indexOf(r)}">
          ${r.snapshot_file ? `<img src="${img(r.snapshot_file)}" alt="" loading="lazy">` : '<span class="tb-noimg">ไม่มีภาพเต็ม</span>'}
          <span class="tb-lb-cap"><b>${hm(r.event_time)} น.</b> · ${esc(r.camera_id)} · ${esc(VT_TH[r.lp_vehicle_type] || r.lp_vehicle_type || '')}
            ${r.plate_image ? `<img class="tb-lb-plate" src="${img(r.plate_image)}" alt="">` : ''}</span></button>`).join('')}</div>
      </section>`;
    }).join('');
  }
  function openRead(i) {
    const r = lb.reads[i]; if (!r) return;
    if (lb.idx < 0) lb.scroll = $('lbBody').scrollTop;
    lb.idx = i;
    $('lbBack').hidden = false; $('lbNav').hidden = false; syncMarkBtns(); $('lbRejForm').hidden = true;
    $('lbPos').textContent = `${i + 1} / ${lb.reads.length}`;
    $('lbPrev').disabled = i === 0; $('lbNext').disabled = i === lb.reads.length - 1;
    $('lbTitle').textContent = fmtPlate(r.plate_number) + (r.lp_region ? ' · ' + r.lp_region : '');
    $('lbSub').textContent = `${dayShort(r.day)} · ${hm(r.event_time)} น. · ${WIN[r.win].label}`;
    const pc = r.raw_json && r.raw_json.plateColor, lane = r.raw_json && r.raw_json.laneNo;
    // ปุ่มแว่นขยาย = ดูรูปเต็ม (แบบ _lprZoomBtn ของหน้า LPR) · SVG ไม่ใช่ emoji
    const zoomBtn = (k) => `<button type="button" class="tb-zoom-btn" data-action="zoom" data-k="${k}" title="ดูรูปเต็ม" aria-label="ดูรูปเต็ม">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="15.65" y2="15.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg></button>`;
    const field = (k, v) => `<div class="tb-dt-f"><span>${k}</span><b>${esc(v || '—')}</b></div>`;
    $('lbBody').innerHTML = `<div class="tb-dt">
      <div class="tb-dt-left">
        <section class="tb-dt-card"><h5>ภาพป้ายทะเบียน</h5>
          <div class="tb-dt-crop">${r.plate_image ? `<img src="${img(r.plate_image)}" alt="ภาพป้ายทะเบียน">${zoomBtn('plate')}` : '<span class="tb-noimg">ไม่มีภาพ</span>'}</div></section>
        <section class="tb-dt-card"><h5>ระบบอ่านได้</h5>
          <div class="tb-dt-read"><b>${esc(r.plate_number)}</b><span>${esc(r.lp_region || 'ไม่ทราบจังหวัด')}</span></div></section>
      </div>
      <section class="tb-dt-card tb-dt-scene"><h5>Snapshot ภาพเต็ม</h5>
        ${r.snapshot_file ? `<div class="tb-dt-img"><img src="${img(r.snapshot_file)}" alt="ภาพเต็ม">
          ${bboxOk(r) ? '<span class="tb-dt-box" id="lbBox"></span>' : ''}${zoomBtn('scene')}</div>` : '<span class="tb-noimg">ไม่มีภาพเต็ม</span>'}</section>
    </div>
    <div class="tb-dt-fields">
      ${field('ป้ายทะเบียน', fmtPlate(r.plate_number))}${field('จังหวัด', r.lp_region)}
      ${field('ประเภทรถ', VT_TH[r.lp_vehicle_type] || r.lp_vehicle_type)}${field('สีรถ', VCOLOR_TH[r.lp_vehicle_color] || r.lp_vehicle_color)}
      ${field('สีป้าย', PCOLOR_TH[pc] || pc)}${field('เลน', lane)}
      ${field('ความมั่นใจ', confOf(r.confidence))}${field('ยี่ห้อ', brandOf(r.lp_vehicle_brand))}
      ${field('กล้อง', r.camera_id)}${field('เวลา', `${dayShort(r.day)} ${hm(r.event_time)} น.`)}
    </div>`;
    const box = $('lbBox');
    if (box) Object.assign(box.style, { left: r.vehicle_bbox_x / 10 + '%', top: r.vehicle_bbox_y / 10 + '%',
      width: r.vehicle_bbox_width / 10 + '%', height: r.vehicle_bbox_height / 10 + '%' });
    $('lbBody').scrollTop = 0;
  }
  // ดูรูปเต็ม: ภาพขนาดจริงพอดีจอ · ภาพเต็มฉากมีกรอบรถเหมือนในรายละเอียด · ปิดด้วย × หรือ Esc (คลิกนอกภาพไม่ปิด)
  function openZoom(kind) {
    const r = lb.reads[lb.idx]; if (!r) return;
    const src = img(kind === 'plate' ? r.plate_image : r.snapshot_file); if (!src) return;
    const box = kind === 'scene' && bboxOk(r);
    $('tbZoomIn').innerHTML = `<div class="tb-zoom-img"><img src="${src}" alt="รูปเต็ม">${box ? '<span class="tb-dt-box" id="zoomBox"></span>' : ''}</div>`;
    if (box) Object.assign($('zoomBox').style, { left: r.vehicle_bbox_x / 10 + '%', top: r.vehicle_bbox_y / 10 + '%',
      width: r.vehicle_bbox_width / 10 + '%', height: r.vehicle_bbox_height / 10 + '%' });
    $('tbZoom').hidden = false;
    $('tbZoom').querySelector('[data-action="zoomClose"]').focus();
  }
  const closeZoom = () => { $('tbZoom').hidden = true; $('tbZoomIn').innerHTML = ''; };

  function backToList() { lb.idx = -1; renderPlateList(); $('lbBody').scrollTop = lb.scroll; }
  const closeLb = () => { $('tbLb').hidden = true; lb.idx = -1; lb.plate = null; lb.list = null; lb.tok++; };

  // ── Reject / ไม่แน่ใจ / คืนสถานะ ─────────────────────────────
  const rejMsg = (t) => { $('lbRejMsg').textContent = t; };
  async function markPlate(plate, kind, reason) {
    const r = await fetch('/api/lpr/truck-ban/rejections/' + encodeURIComponent(plate), {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, reason }) });
    if (r.status === 403) throw new Error('ต้องเป็นผู้ดูแลระบบจึงจะทำรายการนี้ได้');
    if (!r.ok) throw new Error('บันทึกไม่สำเร็จ (HTTP ' + r.status + ')');
    const row = await r.json();
    rej.map.set(plate, row);
  }
  async function restorePlate(plate) {
    const r = await fetch('/api/lpr/truck-ban/rejections/' + encodeURIComponent(plate), { method: 'DELETE', credentials: 'same-origin' });
    if (r.status === 403) throw new Error('ต้องเป็นผู้ดูแลระบบจึงจะคืนสถานะได้');
    if (!r.ok) throw new Error('คืนสถานะไม่สำเร็จ (HTTP ' + r.status + ')');
    rej.map.delete(plate);
  }
  // ทุกอย่างที่เปลี่ยนเกณฑ์ (Reject · ไม่แน่ใจ · กล้อง · รถบรรทุกเล็ก) ดึงใหม่ทั้งหมด (เกณฑ์อยู่ฝั่งเซิร์ฟเวอร์)
  function rebuild() { state.open.clear(); loadRange(); loadLive(); loadDay(curDay); loadBack(); loadMonth(); }
  const kindOf = (x) => (x.kind === 'defer' ? 'defer' : 'reject');
  const markedRows = (k) => [...rej.map.values()].filter((x) => kindOf(x) === k);
  const listHead = (title, rows, msg) => {
    lb.plate = null; lb.idx = -1;
    $('lbBack').hidden = true; $('lbNav').hidden = true; syncMarkBtns(); $('lbRejForm').hidden = true;
    $('lbTitle').textContent = title;
    $('lbSub').textContent = `${fmtN(rows.length)} ป้าย · ไม่แสดงในอันดับและไม่นับในตัวเลข` + (msg ? ` · ${msg}` : '');
    $('tbLb').hidden = false;
  };
  const renderList = (msg) => (lb.list === 'defer' ? renderDeferList(msg) : renderRejList(msg));
  function renderRejList(msg = '') {
    lb.list = 'reject';
    const rows = markedRows('reject').sort((a, b) => (a.rejected_at < b.rejected_at ? 1 : -1));
    listHead('ป้ายที่ Reject แล้ว', rows, msg);
    $('lbBody').innerHTML = rows.length ? `<div class="tb-rejlist">${rows.map((x) => `<div class="tb-rejrow">
        <span class="tb-chip tb-chip-static"><b>${esc(fmtPlate(x.plate_number))}</b></span>
        <span class="tb-rej-why">${esc(x.reason || '—')}</span>
        <span class="tb-note">${esc(x.rejected_by || '')} · ${esc(x.rejected_at ? dayShort(bkkParts(new Date(x.rejected_at)).day) + ' ' + hm(x.rejected_at) + ' น.' : '')}</span>
        <button class="tb-more" data-action="plate" data-p="${esc(x.plate_number)}">ดูภาพ</button>
        <button class="tb-more" data-action="unreject" data-p="${esc(x.plate_number)}">คืนสถานะ</button></div>`).join('')}</div>`
      : '<div class="tb-empty">ยังไม่มีป้ายที่ Reject</div>';
  }
  // กล่อง "ไม่แน่ใจ": ป้าย · จังหวัด · จำนวนครั้งในช่วงที่เลือก (marked จาก /ranking) · ดูภาพ · ใช่เป้าหมาย · Reject
  function renderDeferList(msg = '') {
    lb.list = 'defer';
    const num = (x) => (state.marked.get(x.plate_number) || {}).n || 0;
    const rows = markedRows('defer').sort((a, b) => num(b) - num(a) || (a.plate_number < b.plate_number ? -1 : 1));
    listHead('ป้ายที่ไม่แน่ใจ', rows, msg);
    $('lbBody').innerHTML = rows.length ? `<div class="tb-rejlist">${rows.map((x) => {
      const m = state.marked.get(x.plate_number) || {}, p = esc(x.plate_number);
      return `<div class="tb-defrow">
        <span class="tb-chip tb-chip-static"><b>${esc(fmtPlate(x.plate_number))}</b><span>${esc(m.region || 'ไม่ทราบจังหวัด')}</span></span>
        <span class="tb-def-n"><b>${fmtN(m.n || 0)}</b> ครั้ง</span>
        <span class="tb-def-btns">
          <button class="tb-more" data-action="plate" data-p="${p}">ดูภาพ</button>
          <button class="tb-apply tb-apply-s" data-action="unreject" data-p="${p}">ใช่เป้าหมาย</button>
          <button class="tb-reject" data-action="rejAsk" data-p="${p}">Reject</button></span></div>`;
    }).join('')}</div>` : '<div class="tb-empty">ไม่มีป้ายที่ไม่แน่ใจ</div>';
  }
  let rejTarget = null;   // ป้ายที่ฟอร์ม Reject กำลังถามอยู่ (ปุ่มหัวหน้าต่าง = ป้ายที่เปิดอยู่ · ปุ่มในกล่อง = ป้ายของแถว)

  // ── กราฟ 24 ชม. ─────────────────────────────────────────────
  const bandPlugin = {
    id: 'banBands',
    beforeDatasetsDraw(c, _a, o) {
      if (!o || !o.on) return;
      const { ctx, chartArea: a, scales: { x } } = c;
      ctx.save(); ctx.fillStyle = o.color; ctx.globalAlpha = 0.09;
      for (const [s, e] of BANDS) { const x0 = x.getPixelForValue(s), x1 = x.getPixelForValue(e); ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top); }
      ctx.restore();
    },
  };
  function drawChart(prev, canvas, data, enforce) {
    const line = css('--warn'), bad = css('--status-bad'), grid = css('--border-hairline'), txt = css('--text-secondary');
    const cfg = {
      type: 'line',
      data: { labels: LABELS, datasets: [{ data, borderColor: line, backgroundColor: /^#[0-9a-f]{6}$/i.test(line) ? line + '22' : 'rgba(0,0,0,0.06)', fill: true, tension: 0.35,
        pointRadius: 2.5, pointBackgroundColor: line, borderWidth: 2, spanGaps: false }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, banBands: { on: enforce, color: bad },
          tooltip: { callbacks: { title: (it) => `${it[0].label}–${bucketLabel(it[0].dataIndex + 1 === BUCKETS ? 0 : it[0].dataIndex + 1)} น.`,
            label: (it) => ` ${fmtN(it.parsed.y)} คัน` } } },
        scales: { x: { grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, maxRotation: 90, minRotation: 90, autoSkip: true, autoSkipPadding: 4 } },
                  y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, precision: 0 } } } },
      plugins: [bandPlugin],
    };
    if (prev) { prev.data.datasets[0].data = data; prev.options.plugins.banBands.on = enforce; prev.update(); return prev; }
    return new Chart(canvas, cfg);
  }

  // กราฟ 24 ชม. นับที่เซิร์ฟเวอร์ (GET /api/lpr/truck-ban/buckets) — เดิมดึงทุกแถวของวัน ~4 MB/กราฟ/ผู้ชม (ข้อ 6 หลัง perfWatch 26 ต.ค.)
  //   เกณฑ์ทั้งหมด (กล้อง · รถบรรทุกเล็ก · Reject) ส่งไปให้เซิร์ฟเวอร์ ⇒ เปลี่ยนตัวกรองแล้วดึงใหม่ (คำตอบเล็ก ~1 KB)
  async function fetchBuckets(day, signal) {
    const r = await fetch('/api/lpr/truck-ban/buckets?' + baseQs({ day }), { credentials: 'same-origin', signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function loadLive() {
    if (liveCtrl) liveCtrl.abort();
    liveCtrl = new AbortController();
    const st = statusOf(today);
    $('tbLiveSub').textContent = `วันนี้ · ${dayLong(today)} · ทุก 30 นาที` + (st.enforce ? '' : ` · ${st.label} · ไม่บังคับใช้`);
    try {
      const d = await fetchBuckets(today, liveCtrl.signal);
      const upto = bucketOf(new Date().toISOString());
      // แถบช่วงห้ามแสดงทุกวัน (เจ้าของขอ 2 พ.ย.) — ให้ตรงกับตัวเลขในช่วง/นอกช่วงที่ขึ้นทุกวัน · หัวการ์ดบอก "ไม่บังคับใช้" อยู่แล้ว
      liveChart = drawChart(liveChart, $('tbChartLive'), d.buckets.map((n, i) => (i > upto ? null : n)), true);
      $('tbLiveBan').textContent = st.enforce ? `${fmtN(d.ban)} คัน` : '—';
      $('tbLiveAll').textContent = `ทั้งวัน ${fmtN(d.all)} คัน · ข้อมูล ณ ${bkkParts(new Date()).hm}`;
    } catch (e) { if (e.name !== 'AbortError') $('tbLiveAll').textContent = 'โหลดไม่สำเร็จ'; }
  }

  async function loadDay(day) {
    if (!day) return;
    if (dayCtrl) dayCtrl.abort();
    dayCtrl = new AbortController();
    curDay = day;
    const st = statusOf(day);
    $('tbDaySub').textContent = `${dayLong(day)} · 00:00–23:59` + (st.enforce ? '' : ` · ${st.label} · ไม่บังคับใช้`);
    $('tbDayBan').textContent = '…'; $('tbDayAll').textContent = '';
    try {
      const d = await fetchBuckets(day, dayCtrl.signal);
      dayChart = drawChart(dayChart, $('tbChartDay'), d.buckets, true);
      // แสดงในช่วง/นอกช่วงทุกวัน (เจ้าของขอ 2 พ.ย.) — วันไม่บังคับใช้ก็นับตามช่วงเวลาเดียวกัน หัวเรื่องบอก "ไม่บังคับใช้" อยู่แล้ว
      $('tbDayBan').textContent = `${fmtN(d.ban)} คัน`;
      $('tbDayAll').textContent = `นอกช่วงห้าม ${fmtN(d.outside)} คัน · ทั้งวัน ${fmtN(d.all)} คัน`;
    } catch (e) { if (e.name !== 'AbortError') $('tbDayAll').textContent = 'โหลดไม่สำเร็จ'; }
  }

  // ── เลือกกล้อง (แบบหน้ากวดขันวินัยจราจร) ──────────────────────
  // รายชื่อจาก /api/cameras (กรองตามสิทธิ์ของบัญชีให้แล้ว) เฉพาะไซต์นี้ · ตัวเลขข้างชื่อ = คันในช่วงห้ามของช่วงเวลาที่เลือกอยู่
  let camList = [], camDraft = null;
  async function loadCams() {
    try {
      const r = await fetch('/api/cameras', { credentials: 'same-origin' });
      const a = await r.json();
      // ⚠️ ช่องชื่อ site มีแค่ 21 จาก 86 กล้องของภูเก็ต (ที่เหลือ undefined) ⇒ ใช้ชื่อหา site_id แล้วกรองด้วย site_id
      const all = Array.isArray(a) ? a : [];
      const ids = new Set(all.filter((c) => c.site === CFG.siteLabel).map((c) => c.site_id));
      // เฉพาะกล้อง LPR (cam_role='lpr') — กล้องใบหน้า 68 ตัวของภูเก็ตไม่เคยอ่านป้าย (เจ้าของสั่ง 2026-10-26)
      camList = all.filter((c) => ids.has(c.site_id) && c.cam_role === 'lpr')
        .map((c) => ({ id: c.camera_id ?? c.id, name: c.camera_name || c.camera_id || c.id })).filter((c) => c.id);
    } catch { camList = []; }
    renderCamBtn();
  }
  function renderCamBtn() {
    const n = state.cams ? state.cams.size : camList.length;
    $('tbCamBtn').textContent = state.cams ? `เลือก ${fmtN(n)} จาก ${fmtN(camList.length)} กล้อง` : `ทุกกล้อง (${fmtN(camList.length)})`;
    $('tbCamBtn').classList.toggle('on', !!state.cams);
  }
  // คันต่อกล้องในช่วงห้ามของช่วงเวลาที่เลือก (นับข้ามตัวเลือกกล้อง — เซิร์ฟเวอร์ส่ง cam_plates มากับอันดับ)
  const camCounts = () => new Map(((state.rank && state.rank.cam_plates) || []).map((c) => [c.id, c.plates]));
  function renderCamList() {
    const cnt = camCounts();
    const list = [...camList].sort((a, b) => ((cnt.get(b.id) || 0) - (cnt.get(a.id) || 0)) || a.id.localeCompare(b.id));
    $('camList').innerHTML = list.map((c) => `<label class="tb-cam-row">
        <input type="checkbox" data-cam="${esc(c.id)}" ${camDraft.has(c.id) ? 'checked' : ''}>
        <span class="tb-cam-t"><b>${esc(c.name)}</b><small>${esc(c.id)} · ${esc(CFG.siteLabel)} · ${fmtN(cnt.get(c.id) || 0)} คัน</small></span>
      </label>`).join('') || '<div class="tb-empty">ไม่พบกล้องของไซต์นี้</div>';
    $('camCount').textContent = `เลือกไว้ ${fmtN(camDraft.size)} จาก ${fmtN(camList.length)} กล้อง`;
    $('tbCam').querySelector('[data-action="camApply"]').disabled = !camDraft.size;
  }
  function openCam() {
    camDraft = new Set(state.cams || camList.map((c) => c.id));
    renderCamList();
    $('tbCam').hidden = false;
    $('tbCam').querySelector('[data-action="camClose"]').focus();
  }
  function applyCam() {
    state.cams = camDraft.size === camList.length ? null : new Set(camDraft);
    $('tbCam').hidden = true;
    renderCamBtn(); rebuild();
  }

  // ── กราฟย้อนหลัง + รายเดือน (GET /api/lpr/truck-ban/daily — นับฝั่งเซิร์ฟเวอร์ ไม่ต้องดึงทุกแถว) ─
  const back = { b: '7', from: null, to: null };
  let backCtrl = null, monthCtrl = null, backChart = null, monthChart = null;
  async function fetchDaily(from, to, signal) {
    const r = await fetch('/api/lpr/truck-ban/daily?' + baseQs({ from, to }), { credentials: 'same-origin', signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const by = new Map((await r.json()).map((x) => [x.day, x]));
    const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push({ day: d, am: by.get(d)?.am || 0, pm: by.get(d)?.pm || 0, st: statusOf(d) });
    return out;
  }
  function drawBars(prev, canvas, days, label) {
    const am = css('--accent'), pm = css('--warn'), off = css('--border-hairline'), grid = css('--border-hairline'), txt = css('--text-secondary');
    const col = (c) => days.map((x) => (x.st.enforce ? c : off));
    const data = {
      labels: days.map(label),
      datasets: [
        { label: 'ช่วงเช้า', data: days.map((x) => x.am), backgroundColor: col(am), stack: 's', borderRadius: 2 },
        { label: 'ช่วงเย็น', data: days.map((x) => x.pm), backgroundColor: col(pm), stack: 's', borderRadius: 2 },
      ],
    };
    if (prev) { prev.data = data; prev.update(); return prev; }
    return new Chart(canvas, { type: 'bar', data,
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: {
            title: (it) => { const x = days[it[0].dataIndex]; return dayShort(x.day) + (x.st.enforce ? '' : ` · ${x.st.label} · ไม่บังคับใช้`); },
            label: (it) => ` ${it.dataset.label} ${fmtN(it.parsed.y)} คัน`,
            footer: (it) => { const x = days[it[0].dataIndex]; return `รวม ${fmtN(x.am + x.pm)} ครั้ง`; } } } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { color: txt, font: { size: 11 }, autoSkip: false, maxRotation: 0 } },
                  y: { stacked: true, beginAtZero: true, grid: { color: grid }, ticks: { color: txt, precision: 0 } } } } });
  }
  const sumEnforced = (days) => days.reduce((s, x) => s + (x.st.enforce ? x.am + x.pm : 0), 0);
  function setBack(b) {
    back.b = b;
    for (const el of $('tbBackRange').children) el.setAttribute('aria-pressed', String(el.dataset.b === b));
    $('tbBackCustom').hidden = b !== 'custom';
    if (b === 'custom') { back.from = $('tbBackFrom').value || addDays(today, -6); back.to = $('tbBackTo').value || today; }
    else { back.from = addDays(today, -(Number(b) - 1)); back.to = today; }
    if (back.from > back.to) [back.from, back.to] = [back.to, back.from];
    if (addDays(back.from, 61) < back.to) back.from = addDays(back.to, -61);
    $('tbBackFrom').value = back.from; $('tbBackTo').value = back.to;
    loadBack();
  }
  async function loadBack() {
    if (!back.from) return;
    if (backCtrl) backCtrl.abort();
    backCtrl = new AbortController();
    $('tbBackSub').textContent = `${dayShort(back.from)} – ${dayShort(back.to)}`;
    try {
      const days = await fetchDaily(back.from, back.to, backCtrl.signal);
      const many = days.length > 16;
      backChart = drawBars(backChart, $('tbChartBack'), days, (x) => (many ? String(Number(x.day.slice(8))) : dayShort(x.day)));
      $('tbBackTotal').textContent = fmtN(sumEnforced(days));
    } catch (e) { if (e.name !== 'AbortError') $('tbBackSub').textContent += ' · โหลดไม่สำเร็จ'; }
  }
  async function loadMonth() {
    const m = $('tbMonthPick').value || today.slice(0, 7);
    if (monthCtrl) monthCtrl.abort();
    monthCtrl = new AbortController();
    const from = m + '-01';
    const last = addDays(addDays(from, 32).slice(0, 7) + '-01', -1);
    $('tbMonthSub').textContent = `${dayShort(from)} – ${dayShort(last)}`;
    try {
      const days = await fetchDaily(from, last, monthCtrl.signal);
      monthChart = drawBars(monthChart, $('tbChartMonth'), days, (x) => String(Number(x.day.slice(8))));
      $('tbMonthTotal').textContent = fmtN(sumEnforced(days));
    } catch (e) { if (e.name !== 'AbortError') $('tbMonthSub').textContent += ' · โหลดไม่สำเร็จ'; }
  }

  // ── รายงาน PDF (แบบหน้าอันดับไม่สวมหมวก: dashboard/page-traffic.js trfTopReport/trfTopTable/trfExportPdf) ──
  // วัน/กล้อง/ประเภทชุดเดียวกับอันดับบนจอ · เปิดแท็บใหม่ (สร้างหลายวินาที) · `_` กันแคชตัวกลาง
  function renderPdfBtns() { for (const b of document.querySelectorAll('[data-action="pdf"]')) b.disabled = !state.days.length; }
  function openPdf(mode) {
    if (!state.days.length) return;
    if (mode === 'image' && !confirm('รายงานพร้อมภาพของทุกคันใน 10 อันดับ ใช้เวลาสร้างราว 30–40 วินาที\nเปิดในแท็บใหม่แล้วรอสักครู่ ยืนยันหรือไม่?')) return;
    const qs = baseQs({ days: state.days.join(','), _: String(Date.now()) });
    if (mode !== 'top') qs.set('mode', mode);
    window.open(`/api/lpr/truck-ban/${mode === 'top' ? 'report.pdf' : 'report-table.pdf'}?${qs}`, '_blank', 'noopener');
  }
  // Export PDF = POST /api/traffic/export-page.pdf (ตัวเดียวกับหน้าหมวก) — renderer ใส่แค่ index.css
  //   ⇒ แนบ truck-ban.css เป็น <style> ไปกับ HTML · กราฟแปลงเป็นภาพจากจอจริง · ตัดของที่กดได้ทิ้ง (ชิปป้ายเป็นเนื้อหา เก็บไว้)
  //   ใช้ทั้งปุ่มทั้งหน้า (root = wrap) และปุ่มกราฟ (root = #tbCharts ห่อ 4 การ์ด) — แถบปุ่มอยู่นอก #tbCharts จึงไม่ติดเข้า PDF
  async function exportSection(btn, root, title, file) {
    const orig = btn.innerHTML;
    btn.disabled = true; btn.textContent = 'กำลังสร้าง…';
    try {
      // 🔴 ใช้ URL เดียวกับ <link> ของหน้า (มี ?v=) + no-store — เดิม fetch './truck-ban.css' เปล่า ๆ แล้วได้ไฟล์เก่า
      //    จาก cache ของเบราว์เซอร์/Cloudflare (.css แคชตามนามสกุล) ⇒ หน้าเว็บแก้แล้วแต่ PDF ยังเป็นแบบเก่า (2 พ.ย.)
      const cssHref = document.querySelector('link[rel="stylesheet"][href*="truck-ban.css"]')?.href || './truck-ban.css';
      const cssText = await (await fetch(cssHref, { credentials: 'same-origin', cache: 'no-store' })).text();
      const clone = root.cloneNode(true);
      const liveCv = root.querySelectorAll('canvas'), cloneCv = clone.querySelectorAll('canvas');
      liveCv.forEach((cv, i) => {
        try { const im = document.createElement('img'); im.src = cv.toDataURL('image/png'); cloneCv[i].replaceWith(im); }
        catch { cloneCv[i].remove(); }
      });
      clone.querySelectorAll('.tb-head, .tb-filterbar, .tb-state, .tb-lb, .tb-zoom, .tb-repbtns, .tb-search, .tb-exportbar, #tbRejBtn, #tbDeferBtn, .tb-backctl, input, select, button:not(.tb-chip):not(.tb-more)')
        .forEach((el) => el.remove());
      const scope = [$('tbRangeInfo').textContent, $('tbCamBtn').textContent, $('tbScopeVt').textContent, '06:00–09:00 และ 16:00–19:00'].filter(Boolean).join(' · ');
      // wrap เอง = เอาลูก (ตัว .tb-wrap ห่อให้ใหม่) · การ์ด = เอาทั้งก้อน
      const body = root === wrap ? clone.innerHTML : clone.outerHTML;
      const html = `<style>${cssText}
        .tb-wrap{max-width:none;padding:0} .tb-card-s{page-break-inside:avoid} .tb-chart{height:auto}
        .tb-chart img{display:block;width:100%;height:auto}</style><div class="tb-wrap">${body}</div>`;
      const r = await fetch('/api/traffic/export-page.pdf', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab: 'truckBan', title, scope, html }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'HTTP ' + r.status); }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `${file}-${today}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      alert('Export PDF ไม่สำเร็จ: ' + e.message);
    } finally { btn.disabled = false; btn.innerHTML = orig; }
  }
  const TB_PDF_TITLE = 'รถบรรทุกวิ่งในช่วงห้าม';
  function exportPage(btn) { return exportSection(btn, wrap, 'รายงาน - ' + TB_PDF_TITLE, 'truck-ban-report'); }
  function exportCharts(btn) { return exportSection(btn, $('tbCharts'), 'กราฟ · ' + TB_PDF_TITLE, 'truck-ban-charts'); }

  // ── เหตุการณ์ ───────────────────────────────────────────────
  function setRange(r) {
    state.r = r; state.open.clear();
    for (const b of $('tbRange').children) b.setAttribute('aria-pressed', String(b.dataset.r === r));
    $('tbCustom').hidden = r !== 'custom';
    if (r === '0') { state.from = state.to = today; }
    else if (r === 'y') { state.from = state.to = yesterday; }
    else if (r === 'all') {
      // วันแรกที่ไซต์มีข้อมูลมากับคำตอบของ /ranking · ยังไม่มี = ถามครั้งเดียว (days ว่าง ⇒ เซิร์ฟเวอร์ตอบแค่ oldest)
      if (!state.oldest) { fetchRank([]).then(() => { if (state.r === 'all' && state.oldest) setRange('all'); }).catch((e) => setState('โหลดไม่สำเร็จ · ' + e.message)); return; }
      state.from = state.oldest; state.to = today;
    }
    else if (r === 'custom') { state.from = $('tbFrom').value || addDays(today, -6); state.to = $('tbTo').value || today; }
    else { state.from = addDays(today, -(Number(r) - 1)); state.to = today; }
    if (state.from > state.to) [state.from, state.to] = [state.to, state.from];
    $('tbFrom').value = state.from; $('tbTo').value = state.to;
    loadRange();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    // คลิกพื้นหลังนอกกรอบ = ไม่ปิด (เจ้าของสั่ง 2026-10-26) · กันปิดโดยไม่ตั้งใจระหว่างไล่ดูภาพ/กรอกเหตุผล Reject
    //   ปิดได้จากปุ่ม × หรือ Esc เท่านั้น
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'range') setRange(el.dataset.r);
    else if (a === 'more') { const n = Number(el.dataset.n); state.open.has(n) ? state.open.delete(n) : state.open.add(n); renderRank(); }
    else if (a === 'plate') openPlate(el.dataset.p);
    else if (a === 'read') openRead(Number(el.dataset.i));
    else if (a === 'camOpen') openCam();
    else if (a === 'camClose') { $('tbCam').hidden = true; }
    else if (a === 'camAll') { camDraft = new Set(camList.map((c) => c.id)); renderCamList(); }
    else if (a === 'camNone') { camDraft = new Set(); renderCamList(); }
    else if (a === 'camApply') applyCam();
    else if (a === 'back') setBack(el.dataset.b);
    else if (a === 'pdf') openPdf(el.dataset.mode);
    else if (a === 'exportPage') exportPage(el);
    else if (a === 'exportCharts') exportCharts(el);
    else if (a === 'zoom') openZoom(el.dataset.k);
    else if (a === 'zoomClose') closeZoom();
    else if (a === 'lbBack') backToList();
    else if (a === 'lbPrev') openRead(lb.idx - 1);
    else if (a === 'lbNext') openRead(lb.idx + 1);
    else if (a === 'lbClose') closeLb();
    else if (a === 'rejAsk') {
      rejTarget = el.dataset.p || curPlate();
      $('lbRejT').textContent = `Reject ${fmtPlate(rejTarget || '')} · ไม่ต้องแจ้งป้ายนี้อีก`;
      $('lbRejForm').hidden = false; rejMsg(''); $('lbRejReason').focus();
    }
    else if (a === 'rejCancel') { $('lbRejForm').hidden = true; }
    else if (a === 'rejConfirm') {
      const plate = rejTarget || curPlate();
      if (!plate) return;
      el.disabled = true; rejMsg('กำลังบันทึก…');
      markPlate(plate, 'reject', $('lbRejReason').value)
        .then(() => { rebuild(); if (lb.plate || lb.list === null) closeLb(); else { renderList(`Reject ${fmtPlate(plate)} แล้ว`); } })
        .catch((err) => rejMsg(err.message))
        .finally(() => { el.disabled = false; });
    }
    else if (a === 'deferAsk') {
      const plate = curPlate();
      if (!plate || !window.confirm(`ไม่แน่ใจป้าย ${fmtPlate(plate)}?`)) return;
      el.disabled = true;
      markPlate(plate, 'defer', null).then(() => { closeLb(); rebuild(); })
        .catch((err) => window.alert(err.message)).finally(() => { el.disabled = false; });
    }
    else if (a === 'yesAsk') {
      const plate = curPlate();
      if (!plate || !window.confirm(`ป้าย ${fmtPlate(plate)} เป็นเป้าหมาย?`)) return;
      el.disabled = true;
      restorePlate(plate).then(() => { closeLb(); rebuild(); })
        .catch((err) => window.alert(err.message)).finally(() => { el.disabled = false; });
    }
    else if (a === 'rejList') renderRejList();
    else if (a === 'deferList') renderDeferList();
    else if (a === 'unreject') {
      el.disabled = true;
      restorePlate(el.dataset.p).then(() => { rebuild(); renderList(`คืนสถานะ ${fmtPlate(el.dataset.p)} แล้ว`); })
        .catch((err) => { el.disabled = false; renderList(err.message); });
    }
    else if (a === 'light') {
      state.light = !state.light; el.setAttribute('aria-pressed', String(state.light));
      $('tbScopeVt').textContent = state.light ? 'กล้องจัดเป็นรถบรรทุกหรือรถบรรทุกเล็ก' : 'กล้องจัดเป็นรถบรรทุก';
      rebuild();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!$('tbCam').hidden) { if (e.key === 'Escape') $('tbCam').hidden = true; return; }
    if (!$('tbZoom').hidden) { if (e.key === 'Escape') closeZoom(); return; }
    if ($('tbLb').hidden) return;
    if (e.key === 'Escape') { lb.idx >= 0 ? backToList() : closeLb(); }
    else if (lb.idx >= 0 && e.key === 'ArrowLeft' && lb.idx > 0) openRead(lb.idx - 1);
    else if (lb.idx >= 0 && e.key === 'ArrowRight' && lb.idx < lb.reads.length - 1) openRead(lb.idx + 1);
  });
  // ค้นที่เซิร์ฟเวอร์ — ป้ายที่ไม่ได้อยู่ใน 2,000 คันแรกก็ค้นเจอ · KPI ไม่เปลี่ยนตามคำค้น (เหมือนเดิม)
  let qTimer = null;
  $('tbSearch').addEventListener('input', (e) => {
    state.q = e.target.value; clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.open.clear(); loadRange({ silent: true }); }, 300);
  });
  $('camList').addEventListener('change', (e) => {
    const id = e.target.dataset && e.target.dataset.cam; if (!id) return;
    e.target.checked ? camDraft.add(id) : camDraft.delete(id);
    $('camCount').textContent = `เลือกไว้ ${fmtN(camDraft.size)} จาก ${fmtN(camList.length)} กล้อง`;
    $('tbCam').querySelector('[data-action="camApply"]').disabled = !camDraft.size;
  });
  for (const id of ['tbBackFrom', 'tbBackTo']) $(id).addEventListener('change', () => { if (back.b === 'custom') setBack('custom'); });
  $('tbMonthPick').addEventListener('change', loadMonth);
  for (const id of ['tbFrom', 'tbTo']) {
    $(id).max = today;
    $(id).addEventListener('change', () => { if (state.r === 'custom') setRange('custom'); });
  }
  $('tbDayPick').max = yesterday;
  $('tbDayPick').value = yesterday;
  $('tbDayPick').addEventListener('change', (e) => { if (e.target.value) loadDay(e.target.value > yesterday ? yesterday : e.target.value); });

  // วันนี้: อัปเดตทุก 5 นาทีเมื่อหน้าเปิดอยู่ (ช่วงห้ามที่จบแล้วไม่ดึงซ้ำ)
  setInterval(() => {
    if (document.visibilityState !== 'visible' || !$('tbLb').hidden) return;
    loadLive();
    if (state.to === today) loadRange({ silent: true });
    if (back.to === today) loadBack();
    if (($('tbMonthPick').value || '') === today.slice(0, 7)) loadMonth();
  }, 300000);

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  $('tbMonthPick').value = today.slice(0, 7); $('tbMonthPick').max = today.slice(0, 7);
  for (const id of ['tbBackFrom', 'tbBackTo']) $(id).max = today;
  Promise.all([loadRejections(), loadCams()]).then(() => { setRange('0'); setBack('7'); loadMonth(); });
  // อันดับขึ้นก่อน แล้วค่อยกราฟ (กราฟทั้งวันหนัก ~4 MB/วัน)
  (async () => { await new Promise((r) => setTimeout(r, 300)); await loadLive(); await loadDay(yesterday); })();
})();
