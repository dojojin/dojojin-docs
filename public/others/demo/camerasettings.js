// Camera Settings redesign — DEMO v2 interactions (Phase CS).
// External file + event delegation (no inline handlers) — /others CSP.
// Scale test: TOTAL cameras (3000 target per HARDWARE_SIZING_GUIDE; mock 1000).
'use strict';

const TOTAL = 1000;  // bump to 3000 to stress the upper bound

// 5 hand-crafted seed cameras (rich ingest → editor demo). Rest generated.
const SEED = [
  { id: 'BOSCH_3100i',     name: 'BOSCH 3100i',       ip: '192.168.10.250', vendor: 'Bosch',     loc: 'ทางเดินชั้น 25 (กล้องที่ 2)', status: 'ok',
    ingest: { kind: 'info', txt: '✓ MQTT (ONVIF Profile M) — กล้อง publish ผ่าน broker เอง · ไม่ต้องเลือกโหมด' } },
  { id: 'B3100i_2',        name: 'กล้องทดสอบ 2',       ip: '192.168.10.113', vendor: 'Bosch',     loc: 'ห้องประชุมด้านหลัง',          status: 'paused',
    ingest: { kind: 'info', txt: '✓ MQTT — กล้อง publish ผ่าน broker เอง' } },
  { id: 'HIKVISION_CAM01', name: 'HIKVISION CCTV 01',  ip: '192.168.10.55',  vendor: 'Hikvision', loc: 'กล้องหน้าตู้เย็น',            status: 'ok',
    ingest: { kind: 'choose', mode: 'pull', rec: { cls: 'ok', txt: '✓ ใช้ Pull ได้ — server เข้าถึงกล้อง (alertStream ตอบ)' }, pull: '✓ alertStream ใช้ได้ (192.168.10.55)', push: 'ยังไม่เคยได้รับ push' } },
  { id: 'HIK-V_LPR01',     name: 'HIK-V LPR 01 (ANPR)',ip: '10.11.100.4',    vendor: 'Hikvision', loc: 'ประตูทางเข้า Phuket (push)',  status: 'ok', pushOnly: true,
    ingest: { kind: 'choose', mode: 'push', rec: { cls: 'warn', txt: '⚠ ใช้ Push — server เข้ากล้องไม่ได้ (cross-site)' }, pull: '✗ server เข้าไม่ถึง (10.11.100.4) — pull ใช้ไม่ได้', push: '✓ ได้รับ push ล่าสุด 12:41' } },
  { id: 'DAHUA_GATE01',    name: 'DAHUA Gate 01',     ip: '192.168.10.80',  vendor: 'Dahua',     loc: 'ประตูโรงงาน (VCA)',          status: 'ok',
    ingest: { kind: 'info', txt: '✓ Pull (eventManager CGI) — server ดึง event จากกล้อง' } },
];

// deterministic generator (no Math.random → stable mock)
function buildCameras(total) {
  const out = SEED.slice();
  const vendors = ['Bosch', 'Hikvision', 'Dahua', 'ONVIF'];
  const zones = ['อาคาร A', 'อาคาร B', 'อาคาร C', 'ลานจอด', 'ประตูเข้า-ออก', 'โกดัง', 'ห้อง Server', 'รั้วรอบนอก'];
  for (let i = out.length; i < total; i++) {
    const v = vendors[i % vendors.length];
    const st = i % 17 === 0 ? 'bad' : (i % 23 === 0 ? 'paused' : 'ok');
    const ingest = v === 'Hikvision'
      ? { kind: 'choose', mode: 'pull', rec: { cls: 'ok', txt: '✓ ใช้ Pull ได้' }, pull: '✓ alertStream ใช้ได้', push: 'ยังไม่เคยได้รับ push' }
      : v === 'Dahua' ? { kind: 'info', txt: '✓ Pull (eventManager CGI)' }
      : v === 'ONVIF' ? { kind: 'info', txt: 'Monitor อย่างเดียว' }
      : { kind: 'info', txt: '✓ MQTT — กล้อง publish ผ่าน broker เอง' };
    out.push({
      id: `CAM_${String(i).padStart(4, '0')}`,
      name: `${v} ${zones[i % zones.length]} #${i}`,
      ip: `10.${(i >> 8) & 255}.${i & 255}.${(i * 7) % 250 + 1}`,
      vendor: v,
      loc: `${zones[i % zones.length]} · ชั้น ${(i % 30) + 1}`,
      status: st, ingest,
    });
  }
  return out;
}

const CAMERAS = buildCameras(TOTAL);
const STATUS_LABEL = { ok: 'ออนไลน์', bad: 'ออฟไลน์', paused: 'หยุดชั่วคราว' };
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function rowHtml(c, i) {
  return `<div class="row">
      <div><div class="cam-name">${esc(c.name)}</div><div class="cam-sub">${esc(c.id)} · ${esc(c.ip)}</div></div>
      <div><span class="badge ${c.vendor.toLowerCase()}">${esc(c.vendor)}</span></div>
      <div>${esc(c.loc)}</div>
      <div><span class="dot ${c.status}"></span>${STATUS_LABEL[c.status]}</div>
      <div class="actions">
        <button class="btn primary sm" data-action="edit" data-idx="${i}">แก้ไข</button>
        <button class="btn warn sm" data-action="noop">|| Pause</button>
        <button class="btn danger sm" data-action="noop">ลบ</button>
      </div>
    </div>`;
}

const PAGE_SIZE = 25;
let _filtered = [];   // indices into CAMERAS that pass the filter
let _page = 1;
const zoneOf = (c) => String(c.loc).split(' · ')[0];

function populateLocations() {
  const zones = [...new Set(CAMERAS.map(zoneOf))].sort((a, b) => a.localeCompare(b, 'th'));
  $('#fLocFilter').insertAdjacentHTML('beforeend', zones.map(z => `<option value="${esc(z)}">${esc(z)}</option>`).join(''));
}

function applyFilter() {
  const q = ($('#q').value || '').toLowerCase().trim();
  const fv = $('#fVendorFilter').value;
  const fs = $('#fStatusFilter').value;
  const fl = $('#fLocFilter').value;
  _filtered = [];
  for (let i = 0; i < CAMERAS.length; i++) {
    const c = CAMERAS[i];
    if (fv && c.vendor !== fv) continue;
    if (fs && c.status !== fs) continue;
    if (fl && zoneOf(c) !== fl) continue;
    if (q && !(`${c.name} ${c.id} ${c.ip} ${c.loc}`.toLowerCase().includes(q))) continue;
    _filtered.push(i);
  }
  _page = 1;
  renderPage();
}

function renderPage() {
  const total = _filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (_page > pages) _page = pages;
  const start = (_page - 1) * PAGE_SIZE;
  const slice = _filtered.slice(start, start + PAGE_SIZE);
  $('#camRows').innerHTML = slice.map(i => rowHtml(CAMERAS[i], i)).join('');
  const from = total ? start + 1 : 0;
  $('#count').textContent = `${from.toLocaleString()}–${(start + slice.length).toLocaleString()} จาก ${total.toLocaleString()} กล้อง`;
  renderPager(pages);
}

// windowed page buttons: « ‹ 1 … 4 5 6 … 40 › »
function renderPager(pages) {
  const btn = (p, label = p, opt = {}) =>
    `<button data-action="page" data-page="${p}" ${opt.disabled ? 'disabled' : ''} class="${opt.cur ? 'cur' : ''}">${label}</button>`;
  const gap = '<span class="gap">…</span>';
  let h = btn(_page - 1, '‹', { disabled: _page <= 1 });
  const win = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || (p >= _page - 1 && p <= _page + 1)) win.push(p);
  }
  let prev = 0;
  for (const p of win) { if (p - prev > 1) h += gap; h += btn(p, p, { cur: p === _page }); prev = p; }
  h += btn(_page + 1, '›', { disabled: _page >= pages });
  $('#pager').innerHTML = pages > 1 ? h : '';
}

function openEditor(cam) {
  const isHik = cam.vendor.toLowerCase() === 'hikvision';
  const isBosch = cam.vendor.toLowerCase() === 'bosch';
  const isDahua = cam.vendor.toLowerCase() === 'dahua';
  const hikOrDahua = isHik || isDahua;
  $('#edBadge').textContent = cam.vendor;
  $('#edBadge').className = 'badge ' + cam.vendor.toLowerCase();
  $('#edTitle').textContent = cam.name;
  $('#fId').value = cam.id; $('#fName').value = cam.name; $('#fLoc').value = cam.loc;
  $('#fNotes').value = ''; $('#fIp').value = cam.ip; $('#fVendor').value = cam.vendor;

  const ing = cam.ingest || { kind: 'info', txt: '—' };
  const choose = ing.kind === 'choose';
  $('#ingestInfo').hidden = choose;
  $('#ingestChoose').hidden = !choose;
  if (choose) {
    $('#ingestRec').className = 'ingest ' + ing.rec.cls;
    $('#ingestRec').querySelector('.dot').className = 'dot ' + (ing.rec.cls === 'warn' ? 'paused' : 'ok');
    $('#recText').textContent = ing.rec.txt;
    $('#pullStat').textContent = ing.pull;
    $('#pushStat').textContent = ing.push;
    $('#modePull').checked = ing.mode === 'pull';
    $('#modePush').checked = ing.mode === 'push';
  } else {
    $('#ingestInfoTxt').textContent = ing.txt;
  }

  $('#chkVca').hidden = !isBosch;
  $('#chkBbox').hidden = !hikOrDahua;
  $('#chkZone').hidden = !hikOrDahua;
  $('#fldSnapStream').hidden = !hikOrDahua;
  $('#fldSnapPath').hidden = !isDahua;
  $('#dahuaNote').hidden = !isDahua;
  $('#fwdGenWrap').hidden = !isHik;
  $('#navFwd').hidden = !isHik;
  $('#sec-fwd').hidden = !isHik;
  $('#fFwdEnable').checked = !!cam.pushOnly;
  $('#fFwdUrl').value = '';

  $('#editor').classList.add('open');
  $('#editor').setAttribute('aria-hidden', 'false');
  $('#edBody').scrollTop = 0;
  setActiveNav('sec-info');
}
function closeEditor() { $('#editor').classList.remove('open'); $('#editor').setAttribute('aria-hidden', 'true'); }

function setActiveNav(id) { document.querySelectorAll('#edNav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + id)); }
function onBodyScroll() {
  const body = $('#edBody');
  const secs = [...document.querySelectorAll('section.sec')].filter(s => !s.hidden);
  let cur = secs[0];
  for (const s of secs) { if (s.offsetTop - body.scrollTop <= 80) cur = s; }
  if (cur) setActiveNav(cur.id);
}

let _toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('show'), 1600); }

let _filterT;
document.addEventListener('input', (e) => { if (e.target.id === 'q') { clearTimeout(_filterT); _filterT = setTimeout(applyFilter, 120); } });
document.addEventListener('change', (e) => { if (['fVendorFilter', 'fStatusFilter', 'fLocFilter'].includes(e.target.id)) applyFilter(); });
document.addEventListener('click', (e) => {
  const navlink = e.target.closest('#edNav a');
  if (navlink) { e.preventDefault(); const id = navlink.getAttribute('href').slice(1); $('#' + id).scrollIntoView(); setActiveNav(id); return; }
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  if (act === 'edit') openEditor(CAMERAS[+a.dataset.idx]);
  else if (act === 'page') { _page = +a.dataset.page; renderPage(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (act === 'close') closeEditor();
  else if (act === 'save') toast('บันทึกการตั้งค่าแล้ว (demo)');
  else if (act === 'noop') toast('demo — ปุ่มนี้ยังไม่ทำงาน');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEditor(); });

populateLocations();
applyFilter();
$('#edBody').addEventListener('scroll', onBodyScroll);
