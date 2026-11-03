// ============================================================
// Vigil Platform — DEMO Manage Event Categories (ฉบับเต็ม คู่กับ stats demo)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// CRUD หมวด + rules = ของจริง (API เดียวกับหน้า Manage เดิม) ·
// "กลุ่มในหน้าสถิติ" = demo เก็บ localStorage key เดียวกับที่ stats-demo.js อ่าน
// ไม่มี emoji: แถวใช้จุดสีของหมวด และฟอร์มแก้ไขไม่ส่ง field icon (ค่าเดิมคงอยู่)
'use strict';

const OV_KEY = 'vmh_demo_cat_groups';
const GROUPS = [
  { key: 'vehicle',    name: 'ยานพาหนะ' },
  { key: 'people',     name: 'คนและพฤติกรรม' },
  { key: 'identify',   name: 'ระบุตัวตน (ทะเบียน / ใบหน้า)' },
  { key: 'watch',      name: 'เฝ้าระวังและอื่น ๆ' },
  { key: 'standalone', name: 'ไม่รวมกับหมวดพื้นฐาน (แยกนับ)' },
];
const gname = (k) => (GROUPS.find((g) => g.key === k) || {}).name || k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);

let sites = [], cats = [], cameras = [], siteId = null;
let rulesCache = [];
let editingIds = null;   // rule ids ที่กำลังแก้ (แก้ = POST ใหม่สำเร็จก่อน แล้วค่อย DELETE เดิม)

// ── สีอัตโนมัติ: เลือกจาก palette ที่ยังไม่ถูกใช้ (เจ้าของขอ กันสีซ้ำ) ──────
// เก็บสีที่เคยเห็นจากทุกไซต์ (boot โหลด "ทั้งหมด" หนึ่งรอบ) + สีที่บันทึกใหม่
const PALETTE = ['#e05d44', '#3564d6', '#1d9d57', '#d68a1f', '#8b5cf6', '#0ea5b7',
  '#d6456f', '#6b8e23', '#f59e0b', '#2563eb', '#10b981', '#c2410c', '#7c3aed',
  '#0891b2', '#be185d', '#4d7c0f', '#b45309', '#1d4ed8', '#047857', '#9333ea',
  '#dc2626', '#0d9488', '#a21caf', '#65a30d'];
const usedColors = new Set();
function autoColor() {
  return PALETTE.find((c) => !usedColors.has(c.toLowerCase()))
    || PALETTE[cats.length % PALETTE.length];
}

// ── จัดกลุ่มอัตโนมัติ 3 ชั้น: kind → object class ใน rules → ชื่อ ──────────
// ชุด regex ชื่อ = ชุดเดียวกับ CAT_GROUPS ใน stats-demo.js (ตอน prod รวมเป็น helper)
function groupByName(n) {
  if (/รถ|car|bus|truck|motorcycle|bicycle|จักรยาน|suv|mpv|van/i.test(n)
      && !/หมวก|helmet|เข็มขัด|belt|เลี้ยว/i.test(n)) return 'vehicle';
  if (/คน|people|person|ห้องน้ำ|ตู้เย็น|อาหาร|ข้ามถนน|crosswalk/i.test(n)
      && !/เฝ้าระวัง/i.test(n)) return 'people';
  if (/ทะเบียน|ใบหน้า|face|plate|lpr/i.test(n)) return 'identify';
  return 'watch';
}
function groupByRules(rules) {
  const veh = /^(car|truck|bus|motorcycle|bicycle|van|pickup|vehicle)$/i;
  const per = /^(person|human|people)$/i;
  let sawVeh = false, sawPer = false;
  for (const r of rules || []) {
    if (r.vehicle_type || (r.object_class && veh.test(r.object_class))) sawVeh = true;
    else if (r.object_class && per.test(r.object_class)) sawPer = true;
  }
  return sawVeh ? 'vehicle' : sawPer ? 'people' : null;
}
function autoGroup(c, rules) {
  if (c.kind === 'vehicle_counter') return ['vehicle', 'จากชนิดตัวนับ (kind)'];
  if (c.kind === 'people_counter') return ['people', 'จากชนิดตัวนับ (kind)'];
  const fromRules = groupByRules(rules);
  if (fromRules) return [fromRules, 'จาก object class ใน rules'];
  return [groupByName(c.name), 'จากชื่อหมวด'];
}

// ── override (demo) ─────────────────────────────────────────
function overrides() {
  try { return JSON.parse(localStorage.getItem(OV_KEY) || '{}'); } catch { return {}; }
}
function saveOverride(id, val) {
  const ov = overrides();
  if (val === 'auto') delete ov[id]; else ov[id] = val;
  localStorage.setItem(OV_KEY, JSON.stringify(ov));
  renderCount();
}
function renderCount() {
  const n = Object.keys(overrides()).length;
  $('ovCount').textContent = n ? `override อยู่ ${n} หมวด` : 'ยังไม่มี override (อัตโนมัติทั้งหมด)';
}

async function jget(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}
async function jsend(url, method, body) {
  const r = await fetch(url, { method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${r.status}`);
  }
  return r.json().catch(() => ({}));
}

// ── โหลด + วาดรายการหมวด ────────────────────────────────────
const ruleMap = new Map();
async function loadCats() {
  cats = await jget(`/api/categories${siteId ? `?site_id=${siteId}` : ''}`);
  cats.forEach((c) => c.color && usedColors.add(c.color.toLowerCase()));
  // ชั้น rules: อ่านเฉพาะหมวดที่มี rule และยังไม่เคยโหลด (ก้อนละ 8)
  const need = cats.filter((c) => c.rule_count > 0 && !ruleMap.has(c.id));
  for (let i = 0; i < need.length; i += 8) {
    await Promise.all(need.slice(i, i + 8).map(async (c) => {
      try { ruleMap.set(c.id, await jget(`/api/categories/${c.id}/rules`)); }
      catch { ruleMap.set(c.id, []); }
    }));
  }
  renderCats();
}

function kindBadge(kind) {
  const [txt, cls] = kind === 'people_counter' ? ['PEOPLE', 'ok']
    : kind === 'vehicle_counter' ? ['VEHICLE', 'acc'] : ['EVENT', 'ev'];
  return `<span class="cat-kind ${cls}">${txt}</span>`;
}

function renderCats() {
  $('catTotal').textContent = `${cats.length} หมวด (ระบบ ${cats.filter((c) => c.is_locked).length})`;
  const ov = overrides();
  const siteName = new Map(sites.map((s) => [s.id, s.name || s.code]));
  const opts = (sel) => [
    `<option value="auto" ${!sel ? 'selected' : ''}>อัตโนมัติ</option>`,
    ...GROUPS.map((g) => `<option value="${g.key}" ${sel === g.key ? 'selected' : ''}>${g.name}</option>`),
  ].join('');
  const bySite = new Map();
  for (const c of cats) {
    const k = c.site_id || 0;
    if (!bySite.has(k)) bySite.set(k, []);
    bySite.get(k).push(c);
  }
  $('catList').innerHTML = [...bySite.entries()].map(([sid, rows]) => `
    ${siteId ? '' : `<div class="cat-site">${esc(siteName.get(sid) || `site ${sid}`)} · ${rows.length} หมวด</div>`}
    ${rows.map((c) => {
      const [auto, src] = autoGroup(c, ruleMap.get(c.id));
      return `
      <div class="cat-row ${ov[c.id] ? 'ov' : ''}">
        <span class="cat-dot" style="background:${esc(c.color || '#5b8def')}"></span>
        <span class="cat-name">${esc(c.name)}${c.is_locked ? ' <span class="cat-lock">ระบบ</span>' : ''}</span>
        ${kindBadge(c.kind)}
        <span class="cat-rules">${c.rule_count} rule</span>
        <span class="cat-auto">อัตโนมัติ = <b>${gname(auto)}</b> <i>(${src})</i></span>
        <select class="cat-sel" data-cat="${c.id}">${opts(ov[c.id])}</select>
        <span class="cat-btns">
          <button class="tool-btn" data-action="rules" data-id="${c.id}">Rules</button>
          <button class="tool-btn" data-action="edit" data-id="${c.id}">แก้ไข</button>
          <button class="tool-btn cd-danger" data-action="del" data-id="${c.id}"
            ${c.is_locked ? 'disabled title="หมวดระบบ ลบไม่ได้"' : ''}>ลบ</button>
        </span>
      </div>`; }).join('')}
  `).join('');
  renderCount();
}

// ── เพิ่ม/แก้หมวด (ของจริง — ไม่แตะ field icon) ─────────────
function openEdit(id) {
  const c = id ? cats.find((x) => x.id === id) : null;
  $('emTitle').textContent = c ? `แก้ไข: ${c.name}` : 'เพิ่มหมวด';
  $('emId').value = c ? c.id : '';
  $('emName').value = c?.name || '';
  $('emName').disabled = !!c?.is_locked;
  $('emLockNote').hidden = !c?.is_locked;
  $('emColor').value = /^#[0-9a-f]{6}$/i.test(c?.color || '') ? c.color : autoColor();
  $('emSort').value = c?.sort_order ?? 0;
  const s = sites.find((x) => x.id === (c ? c.site_id : siteId));
  $('emSiteNote').textContent = s ? `ไซต์: ${s.name || s.code}` : '';
  $('editModal').hidden = false;
}
async function saveCat() {
  const id = $('emId').value;
  const name = $('emName').value.trim();
  if (!name) return alert('ต้องมีชื่อหมวด');
  if (!id && !siteId) return alert('เลือกไซต์ก่อนสร้างหมวด');
  const payload = { name, color: $('emColor').value, sort_order: parseInt($('emSort').value, 10) || 0 };
  if (!id) payload.site_id = siteId;
  try {
    await jsend(id ? `/api/categories/${id}` : '/api/categories', id ? 'PUT' : 'POST', payload);
    usedColors.add(payload.color.toLowerCase());
    $('editModal').hidden = true;
    await loadCats();
  } catch (e) { alert(`บันทึกไม่สำเร็จ: ${e.message}`); }
}
async function delCat(id) {
  const c = cats.find((x) => x.id === id);
  if (!c || c.is_locked) return;
  if (!confirm(`ลบหมวด "${c.name}" ? (rules ของมันถูกลบด้วย — มีผลจริง)`)) return;
  try { await jsend(`/api/categories/${id}`, 'DELETE'); await loadCats(); }
  catch (e) { alert(`ลบไม่สำเร็จ: ${e.message}`); }
}

// ── mapping rules (ของจริง) ─────────────────────────────────
function openRules(id) {
  const c = cats.find((x) => x.id === id);
  $('rmCatId').value = id;
  $('rmTitle').textContent = `Mapping Rules — ${c ? c.name : ''}`;
  const scoped = c?.site_id ? cameras.filter((x) => x.site_id === c.site_id) : cameras;
  $('rmCams').innerHTML = scoped.map((x) =>
    `<option value="${esc(x.camera_id)}">${esc(x.camera_id)} (${esc(x.camera_name || '')})</option>`).join('');
  cancelEditRule();
  $('rulesModal').hidden = false;
  loadRules();
  loadFacets(); // ช้า (unbounded DISTINCT ~11s) — เติม datalist ทีหลัง ไม่บล็อก modal
}
async function loadRules() {
  const id = $('rmCatId').value;
  try {
    rulesCache = await jget(`/api/categories/${id}/rules`);
    ruleMap.set(Number(id), rulesCache);
  } catch (e) { $('rulesList').textContent = `โหลด rules ไม่สำเร็จ: ${e.message}`; return; }
  $('delAllBtn').disabled = !rulesCache.length;
  const w = (v) => v == null || v === '' ? '<i class="cd-any">*</i>' : esc(v);
  if (!rulesCache.length) { $('rulesList').innerHTML = '<div class="cd-empty">ยังไม่มี rule</div>'; renderCats(); return; }
  // bulk-add สร้าง rule เหมือนกันหลายกล้อง — ยุบตาม signature แบบหน้าจริง
  const groups = new Map();
  for (const r of rulesCache) {
    const k = [r.rule_name, r.event_type, r.object_class, r.vehicle_type, r.match_state, r.priority].join('\x1f');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  $('rulesList').innerHTML = `
    <div class="cd-rrow cd-rhead"><span>Camera</span><span>Rule</span><span>Event Type</span>
      <span>Object Class</span><span>State</span><span>Pri</span><span></span></div>` +
    [...groups.values()].map((grp) => {
      const s = grp[0];
      const obj = `${w(s.object_class)}${s.vehicle_type ? ` · <b>${esc(s.vehicle_type)}</b>` : ''}`;
      const ids = grp.map((r) => r.id).join(',');
      if (grp.length === 1) return `
        <div class="cd-rrow"><span>${w(s.camera_id)}</span><span>${w(s.rule_name)}</span>
          <span>${w(s.event_type)}</span><span>${obj}</span><span>${w(s.match_state)}</span>
          <span>${s.priority}</span>
          <span class="cd-rbtns"><button class="tool-btn" data-action="editRule" data-ids="${ids}">แก้ไข</button><button class="tool-btn cd-danger" data-action="delRule" data-id="${s.id}">ลบ</button></span></div>`;
      const gid = `grp${s.id}`;
      return `
        <div class="cd-rrow cd-rgroup" data-action="toggleGrp" data-grp="${gid}">
          <span>▾ ${grp.length} กล้อง</span><span>${w(s.rule_name)}</span><span>${w(s.event_type)}</span>
          <span>${obj}</span><span>${w(s.match_state)}</span><span>${s.priority}</span>
          <span class="cd-rbtns"><button class="tool-btn" data-action="editRule" data-ids="${ids}">แก้ไข</button><button class="tool-btn cd-danger" data-action="delGrp"
            data-ids="${ids}">ลบ ×${grp.length}</button></span></div>
        <div id="${gid}" hidden>${grp.map((r) => `
          <div class="cd-rrow cd-rsub"><span>${w(r.camera_id)}</span><span></span><span></span><span></span><span></span><span></span>
            <span><button class="tool-btn cd-danger" data-action="delRule" data-id="${r.id}">ลบ</button></span></div>`).join('')}</div>`;
    }).join('');
  renderCats(); // rule เปลี่ยน → กลุ่มอัตโนมัติ/ตัวนับ rule อาจเปลี่ยน
}
async function loadFacets() {
  try {
    const f = await jget('/api/events/facets');
    $('dlRules').innerHTML = (f.rule_names || []).map((v) => `<option value="${esc(v)}"></option>`).join('');
    $('dlEvTypes').innerHTML = (f.event_types || []).map((v) => `<option value="${esc(v)}"></option>`).join('');
    const fill = (id, items) => { $(id).innerHTML = `<option value="">* (any)</option>` +
      (items || []).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join(''); };
    fill('rmObjClass', f.object_classes);
    fill('rmVType', f.vehicle_types);
  } catch { /* facets เป็นแค่ autocomplete — พังก็กรอกมือได้ */ }
}
// เริ่มแก้ rule: เติมค่าเดิมลงฟอร์ม + จำ id ชุดเดิมไว้ (แก้ = replace ทั้ง signature)
function startEditRule(ids) {
  const grp = rulesCache.filter((r) => ids.includes(r.id));
  if (!grp.length) return;
  const s = grp[0];
  $('rmRule').value = s.rule_name || '';
  $('rmEvType').value = s.event_type || '';
  ensureOption('rmObjClass', s.object_class);
  ensureOption('rmVType', s.vehicle_type);
  $('rmObjClass').value = s.object_class || '';
  $('rmVType').value = s.vehicle_type || '';
  $('rmState').value = s.match_state ?? '';
  $('rmPri').value = s.priority ?? 0;
  const camSet = new Set(grp.map((r) => r.camera_id).filter(Boolean));
  [...$('rmCams').options].forEach((o) => { o.selected = camSet.has(o.value); });
  editingIds = ids;
  $('addRuleBtn').textContent = 'บันทึกแก้ไข (แทนที่เดิม)';
  $('cancelEditBtn').hidden = false;
}
// facets โหลดช้า/ยังไม่มา — ค่าเดิมของ rule ต้องมี option ให้เลือกเสมอ
function ensureOption(id, val) {
  if (!val) return;
  const el = $(id);
  if (![...el.options].some((o) => o.value === val)) {
    const o = document.createElement('option');
    o.value = val; o.textContent = val;
    el.appendChild(o);
  }
}
function cancelEditRule() {
  editingIds = null;
  $('rmRule').value = ''; $('rmEvType').value = '';
  $('rmObjClass').value = ''; $('rmVType').value = '';
  $('rmState').value = 'true'; $('rmPri').value = 0;
  [...$('rmCams').options].forEach((o) => { o.selected = false; });
  $('addRuleBtn').textContent = '+ เพิ่ม rule';
  $('cancelEditBtn').hidden = true;
}

async function addRule() {
  const id = $('rmCatId').value;
  const camIds = [...$('rmCams').selectedOptions].map((o) => o.value);
  const targets = camIds.length ? camIds : ['']; // ไม่เลือก = rule เดียว any camera
  const base = {
    rule_name: $('rmRule').value.trim(), event_type: $('rmEvType').value.trim(),
    object_class: $('rmObjClass').value, vehicle_type: $('rmVType').value,
    match_state: $('rmState').value, priority: parseInt($('rmPri').value, 10) || 0,
  };
  // กันเพิ่มซ้ำ: signature+camera เดิมมีอยู่แล้ว (ยกเว้นแถวที่กำลังแก้เอง)
  const sig = (r) => [r.camera_id || '', r.rule_name || '', r.event_type || '',
    r.object_class || '', r.vehicle_type || '', r.match_state ?? '', r.priority || 0].join('\x1f');
  const existing = new Set(rulesCache.filter((r) => !(editingIds || []).includes(r.id)).map(sig));
  const fresh = targets.filter((camera_id) => !existing.has(sig({ camera_id, ...base,
    match_state: base.match_state === '' ? null : base.match_state })));
  if (!fresh.length && !editingIds) return alert('rule แบบเดียวกันนี้มีอยู่แล้วทุกกล้องที่เลือก — ไม่เพิ่มซ้ำ');
  const btn = $('addRuleBtn'); btn.disabled = true; btn.textContent = '…';
  const work = editingIds ? targets : fresh;   // โหมดแก้ = สร้างชุดใหม่เต็มชุดเสมอ
  const rs = await Promise.allSettled(work.map((camera_id) =>
    jsend(`/api/categories/${id}/rules`, 'POST', { camera_id, ...base })));
  const fail = rs.filter((r) => r.status === 'rejected');
  if (editingIds && !fail.length) {
    // ชุดใหม่ครบแล้ว → ค่อยลบชุดเดิม (ลำดับนี้ทำให้พลาดแล้วของเดิมไม่หาย)
    await Promise.allSettled(editingIds.map((rid) => jsend(`/api/category-rules/${rid}`, 'DELETE')));
    cancelEditRule();
  }
  btn.disabled = false;
  btn.textContent = fail.length ? (editingIds ? 'บันทึกแก้ไข (แทนที่เดิม)' : '+ เพิ่ม rule')
    : `สำเร็จ (${work.length - fail.length})`;
  if (fail.length) alert(`สำเร็จ ${work.length - fail.length}/${work.length} — ${fail[0].reason?.message || ''}`
    + (editingIds ? ' · ชุดเดิมยังไม่ถูกลบ' : ''));
  else setTimeout(() => { btn.textContent = editingIds ? 'บันทึกแก้ไข (แทนที่เดิม)' : '+ เพิ่ม rule'; }, 900);
  await loadRules();
}
async function delRules(ids) {
  await Promise.allSettled(ids.map((id) => jsend(`/api/category-rules/${id}`, 'DELETE')));
  await loadRules();
}

// ── แผง rule discovery: combo ที่เห็นจริงแต่ยังไม่มีหมวดรับ ─────────────────
// การจับคู่ทำฝั่งนี้ (ruleMap มี rules ทุกหมวดจาก boot ที่โหลด "ทั้งหมด") —
// wildcard semantics เดียวกับ matcher จริง: field ว่างของ rule = จับทุกค่า
// ต้องเทียบ vehicle_type ด้วย — หมวด LPR ตั้ง rule ด้วย vehicle_type ล้วน
// (ช่องอื่นว่างหมด) ถ้าข้าม field นี้ matcher จะเห็นทุก event ว่า map แล้ว
// หมายเหตุ: ยังไม่เทียบ match_state (combo รวมทุก state) — พอสำหรับงานค้นหา
let discCombos = null;
function comboMapped(combo) {
  for (const rules of ruleMap.values()) {
    for (const r of rules) {
      if ((!r.camera_id || r.camera_id === combo.camera_id)
        && (!r.rule_name || r.rule_name === combo.rule_name)
        && (!r.event_type || r.event_type === combo.event_type)
        && (!r.object_class || r.object_class === combo.object_class)
        && (!r.vehicle_type || r.vehicle_type === combo.vehicle_type)) return true;
    }
  }
  return false;
}
async function loadDiscovery(force) {
  if (force || !discCombos) {
    $('discList').textContent = 'กำลังสแกน… (ราว 5 วินาที)';
    try { discCombos = (await jget('/api/categories/rule-discovery')).combos; }
    catch (e) { $('discList').textContent = `สแกนไม่สำเร็จ: ${e.message}`; return; }
  }
  renderDiscovery();
}
function renderDiscovery() {
  if (!discCombos) return;
  const siteName = new Map(sites.map((s) => [s.id, s.name || s.code]));
  // เรียง "เห็นล่าสุดก่อน" — เป้าหมายของแผงคือจับ rule ที่เพิ่งตั้งบนกล้อง
  // (เรียงตาม n จะให้ของเก่าค้างบนสุดตลอด ของใหม่ n น้อยจมท้าย)
  const un = discCombos
    .filter((c) => !siteId || c.site_id === siteId)
    .filter((c) => !comboMapped(c))
    .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
  $('discCount').textContent = un.length ? `${un.length} รายการ` : '';
  if (!un.length) {
    $('discList').innerHTML = '<div class="cd-empty">ทุก rule ที่พบในช่วงนี้ถูก map เข้าหมวดแล้ว</div>';
    return;
  }
  const CAP = 30;
  const age = (t) => {
    const h = Math.round((Date.now() - new Date(t)) / 3600e3);
    return h < 1 ? 'ชม.นี้' : h < 24 ? `${h} ชม.ก่อน` : `${Math.round(h / 24)} วันก่อน`;
  };
  $('discList').innerHTML = un.slice(0, CAP).map((c, i) => `
    <div class="cat-row disc-row">
      <span class="cat-name">${esc(c.rule_name || c.event_type || '(ไม่มีชื่อ rule)')}</span>
      <span class="cat-rules">${esc(siteName.get(c.site_id) || '')} · ${esc(c.camera_id)}</span>
      <span class="cat-auto">${c.object_class ? `class=<b>${esc(c.object_class)}</b> · ` : ''}
        ${c.vehicle_type ? `vtype=<b>${esc(c.vehicle_type)}</b> · ` : ''}
        ${c.rule_name && c.event_type ? `type=${esc(c.event_type)} · ` : ''}
        ${c.n.toLocaleString()} events · ล่าสุด ${age(c.last_seen)}</span>
      <span class="cat-btns"><button class="cd-add" data-action="mapCombo" data-i="${i}">สร้างหมวด</button></span>
    </div>`).join('')
    + (un.length > CAP ? `<div class="cd-empty">แสดง ${CAP} จาก ${un.length} (เห็นล่าสุดก่อน)</div>` : '');
  // เก็บชุดที่แสดงไว้ให้ปุ่มอ้างตาม index
  renderDiscovery._shown = un.slice(0, CAP);
}
async function mapCombo(i) {
  const c = (renderDiscovery._shown || [])[i];
  if (!c) return;
  const name = (c.rule_name || c.event_type || '').trim();
  if (!name) return alert('combo นี้ไม่มีชื่อ rule/event type ให้ตั้งเป็นชื่อหมวด — สร้างมือจากปุ่ม + เพิ่มหมวด');
  if (!confirm(`สร้างหมวด "${name}"${c.object_class ? ` (class=${c.object_class})` : ''} ที่ไซต์ของกล้อง ${c.camera_id} พร้อม rule จับ combo นี้? (มีผลจริง)`)) return;
  try {
    // ชื่อซ้ำในไซต์เดิม → ไม่สร้างซ้ำ เอา rule ไปเกาะหมวดเดิมแทน
    let cat = cats.find((x) => x.name === name && x.site_id === c.site_id);
    if (!cat) {
      cat = await jsend('/api/categories', 'POST',
        { name, color: autoColor(), sort_order: 0, site_id: c.site_id });
      usedColors.add((cat.color || '').toLowerCase());
    }
    await jsend(`/api/categories/${cat.id}/rules`, 'POST', {
      camera_id: c.camera_id, rule_name: c.rule_name || '',
      event_type: c.event_type || '', object_class: c.object_class || '',
      vehicle_type: c.vehicle_type || '', match_state: '', priority: 0,
    });
    ruleMap.delete(cat.id);   // ให้โหลด rules ใหม่รอบหน้า
    await loadCats();
    renderDiscovery();
  } catch (e) { alert(`สร้างไม่สำเร็จ: ${e.message}`); }
}

// ── events ──────────────────────────────────────────────────
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b) return;
  const a = b.dataset.action;
  if (a === 'edit') openEdit(Number(b.dataset.id));
  else if (a === 'del') delCat(Number(b.dataset.id));
  else if (a === 'rules') openRules(Number(b.dataset.id));
  else if (a === 'saveCat') saveCat();
  else if (a === 'closeEdit') $('editModal').hidden = true;
  else if (a === 'closeRules') { $('rulesModal').hidden = true; }
  else if (a === 'addRule') addRule();
  else if (a === 'editRule') startEditRule(b.dataset.ids.split(',').map(Number));
  else if (a === 'cancelEdit') cancelEditRule();
  else if (a === 'delRule') { if (confirm('ลบ rule นี้? (มีผลจริง)')) delRules([Number(b.dataset.id)]); }
  else if (a === 'delGrp') { const ids = b.dataset.ids.split(',').map(Number);
    if (confirm(`ลบ ${ids.length} rules ของกลุ่มนี้? (มีผลจริง)`)) delRules(ids); }
  else if (a === 'delAllRules') { if (rulesCache.length &&
    confirm(`ลบ rules ทั้งหมด ${rulesCache.length} แถวของหมวดนี้? (มีผลจริง)`))
    delRules(rulesCache.map((r) => r.id)); }
  else if (a === 'toggleGrp') { const g = $(b.dataset.grp); if (g) g.hidden = !g.hidden; }
  else if (a === 'mapCombo') mapCombo(Number(b.dataset.i));
  else if (a === 'reloadDisc') loadDiscovery(true);
});
document.getElementById('catList').addEventListener('change', (ev) => {
  const sel = ev.target.closest('.cat-sel');
  if (!sel) return;
  saveOverride(Number(sel.dataset.cat), sel.value);
  sel.closest('.cat-row').classList.toggle('ov', sel.value !== 'auto');
});
$('clearOv').addEventListener('click', () => {
  localStorage.removeItem(OV_KEY);
  renderCats();
});

// ── boot ────────────────────────────────────────────────────
(async () => {
  try {
    const camsP = jget('/api/cameras').catch(() => []);
    sites = await jget('/api/sites');
    const cs = await camsP;
    cameras = Array.isArray(cs) ? cs : (cs.cameras || []);
    $('sitePills').innerHTML =
      `<button class="on" data-site="">ทั้งหมด</button>` +
      sites.map((s) => `<button data-site="${s.id}">${esc(s.name || s.code)}</button>`).join('');
    $('sitePills').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      [...$('sitePills').children].forEach((x) => x.classList.toggle('on', x === btn));
      siteId = btn.dataset.site ? Number(btn.dataset.site) : null;
      $('addCatBtn').disabled = !siteId;
      loadCats().then(renderDiscovery).catch(console.error);
    });
    $('addCatBtn').addEventListener('click', () => openEdit(null));
    await loadCats();
    loadDiscovery().catch(console.error);   // สแกน ~5 วิ — ไม่บล็อกรายการหมวด
  } catch (e) {
    console.error(e);
    $('authNote').hidden = false;
    $('catList').textContent = '';
  }
})();
