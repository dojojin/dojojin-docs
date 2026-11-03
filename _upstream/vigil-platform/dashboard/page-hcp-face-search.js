// ============================================================
// Vigil Platform — HC2 · ค้นหาใบหน้าด้วยรูป (ผ่าน HCP)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// อัปโหลดรูป → HCP ค้นย้อนหลังให้ → เอาผลมาต่อกับเหตุการณ์ของเราเองด้วย
// (กล้องเดียวกัน + เวลาใกล้กัน) · ปิดช่องที่รูปฝั่งเราหายไปตาม retention
//
// ขอบเขต: HKT เท่านั้น — เราต่อ HCP ผ่าน edge ภูเก็ต
// ============================================================
'use strict';

const _hfsT = (k, d) => (typeof I18N !== 'undefined' && I18N.t) ? I18N.t(k, d) : d;
const _hfsEsc = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s);

let _hfsImage = null;      // base64 ของรูปที่เลือกไว้
let _hfsBusy = false;
let _hfsLast = null;       // ผลค้นล่าสุด — ใช้ตอนสลับมุมมองและเปิด modal โดยไม่ค้นซ้ำ
let _hfsView = 'grid';     // ค่าเริ่มต้นตามที่เจ้าของเลือก: ตาราง
let _hfsEngine = 'hcp';    // 'hcp' = ให้ HCP ค้น · 'edge' = เครื่องของเราเองบน edge

// เกณฑ์ของเครื่องเรา — วัดจริง 2026-08-09 จากใบหน้าคนทั่วไป 2,805 ใบของกล้องเราเอง:
// มัธยฐาน 0.218 · p99 0.352 · **สูงสุด 0.434** ⇒ ที่ 0.45 ไม่มีการเตือนผิดเลยสักใบ
// ตัวเลขนี้เป็นคนละสเกลกับ % ของ HCP โดยสิ้นเชิง อย่าเอามาเทียบกันตรง ๆ
const HFS_EDGE_CONFIDENT = 0.45;
// ค่าตั้งต้นของช่อง "ความคล้ายขั้นต่ำ" — เจ้าของกำหนด 0.8 ทั้งสองเครื่อง (2026-08-09)
// ⚠️ ตัวเลขเดียวกันคนละความหมาย: ของ HCP 0.8 = 80% ซึ่งเป็นย่านที่ใช้งานได้จริง
// ส่วนของเรา 0.8 สูงมาก — วัดจริงคู่ที่เป็นคนเดียวกันมัธยฐานอยู่ 0.29 และสูงสุด 0.80
// ⇒ ที่ 0.8 เครื่องเราจะคืนเฉพาะ "ภาพเดียวกันแทบเป๊ะ" เท่านั้น
const HFS_DEFAULT_THRESHOLD = 0.8;

function hfsInit() {
  const el = document.getElementById('hfsBody');
  if (!el) return;
  const today = new Date().toISOString().slice(0, 10);
  const back = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="hfs-enginebar" role="radiogroup" aria-label="${_hfsEsc(_hfsT('hfs.engine', 'เครื่องค้น'))}">
      ${[['hcp', _hfsT('hfs.engineHcp', 'HCP')], ['edge', _hfsT('hfs.engineEdge', 'Lab Test')]].map(([k, label]) => `
      <span class="hfs-viewbtn${_hfsEngine === k ? ' on' : ''}" data-action="hfsEngine" data-engine="${k}"
        role="radio" aria-checked="${_hfsEngine === k}">${_hfsEsc(label)}</span>`).join('')}
      <span class="hfs-labbadge" id="hfsLabBadge" hidden
        >${_hfsEsc(_hfsT('hfs.labTestRemark', 'เพื่อการทดสอบและพัฒนาเท่านั้น'))}</span>
      <span class="hfs-hint" id="hfsEngineNote"></span>
    </div>
    <div class="hfs-grid">
      <div>
        <label class="form-label">${_hfsEsc(_hfsT('hfs.photo', 'รูปใบหน้า'))}</label>
        <div class="hfs-drop" id="hfsDrop" tabindex="0" role="button">
          <div class="hfs-drop-t">${_hfsEsc(_hfsT('hfs.dropTitle', 'ลากรูปมาวางที่นี่'))}</div>
          <div class="hfs-drop-s">${_hfsEsc(_hfsT('hfs.dropSub', 'หรือกดเพื่อเลือกไฟล์ · JPEG / PNG'))}</div>
          <input type="file" id="hfsFile" accept="image/jpeg,image/png" data-input="hfsFile">
        </div>
        <div class="hfs-hint">${_hfsEsc(_hfsT('hfs.photoHint', 'รูปหนึ่งใบมีหลายหน้าได้ ระบบจะใช้หน้าแรกที่ตรวจพบ'))}</div>
        <img id="hfsPreview" class="hfs-preview" alt="${_hfsEsc(_hfsT('hfs.photo', 'รูปใบหน้า'))}" hidden>
      </div>
      <div>
        <label class="form-label" for="hfsFrom">${_hfsEsc(_hfsT('hfs.from', 'ตั้งแต่'))}</label>
        <input class="form-input" type="date" id="hfsFrom" value="${back}">
      </div>
      <div>
        <label class="form-label" for="hfsTo">${_hfsEsc(_hfsT('hfs.to', 'ถึง'))}</label>
        <input class="form-input" type="date" id="hfsTo" value="${today}">
      </div>
      <div id="hfsThresholdWrap">
        <label class="form-label" for="hfsThreshold">${_hfsEsc(_hfsT('hfs.threshold', 'ความคล้ายขั้นต่ำ'))}</label>
        <input class="form-input" type="number" id="hfsThreshold" min="0.1" max="0.99" step="0.05" value="${HFS_DEFAULT_THRESHOLD}">
      </div>
      <div id="hfsJoinWrap">
        <label class="form-label" for="hfsJoin">${_hfsEsc(_hfsT('hfs.join', 'จับคู่กับข้อมูลเรา ±วินาที'))}</label>
        <input class="form-input" type="number" id="hfsJoin" min="1" max="300" value="3">
      </div>
      <div class="hfs-camwrap">
        <label class="form-label">${_hfsEsc(_hfsT('hfs.cameraFilter', 'กล้อง'))}</label>
        <div class="mp" data-mp-unit-key="sys.camerasUnit" data-mp-unit="กล้อง"
             data-mp-label-key="hfs.allCameras" data-mp-label="ทุกกล้อง"
             data-mp-search-key="grp.searchPh" data-mp-search="ค้นหากล้อง..."><select id="hfsCam" multiple></select></div>
      </div>
    </div>
    <div class="hfs-hint" id="hfsRangeHint">${_hfsEsc(_hfsT('hfs.dateRangeHint', 'ช่วงเวลาต้องไม่เกิน 31 วัน · จำนวนคำขอสูงสุด 40'))}</div>
    <div class="hfs-actions">
      <button class="btn btn-primary" data-action="hfsSearch" id="hfsBtn">${_hfsEsc(_hfsT('hfs.search', 'ค้นหา'))}</button>
    </div>
    <div id="hfsDrift"></div>
    <div id="hfsResult"></div>`;
  hfsBindDrop();
  hfsCheckMap();
  hfsLoadEngine();
  hfsSyncEngineFields();
}

// ทำให้ช่องกรอกตรงกับเครื่องที่เลือกอยู่ · เรียกทั้งตอนเปิดหน้าและตอนสลับ
// เพราะ `_hfsEngine` อยู่ระดับโมดูล มันจำค่าข้ามการเข้าออกหน้า แต่ HTML ถูกวาดใหม่ทุกครั้ง
// ⇒ ถ้าไม่ซิงก์ จะได้หน้าที่ปุ่มบอกอย่าง สถานะจริงอีกอย่าง (เกิดจริง 2026-08-09:
// เข้าหน้ามาแล้วกด "เครื่องของเรา" ไม่ติด เพราะข้างในเป็น edge อยู่แล้วจากครั้งก่อน
// แต่ปุ่มถูกวาดให้ HCP สว่าง ⇒ ต้องกด HCP ก่อนหนึ่งครั้งถึงจะกดกลับมาได้)
function hfsSyncEngineFields() {
  // ป้ายเตือนติดอยู่กับ "Lab Test" เสมอ ไม่ใช่แค่ข้อความอธิบายที่เปลี่ยนไปมา — โมเดล
  // buffalo_l มีสิทธิ์ใช้เฉพาะงานวิจัย/ทดสอบภายในเท่านั้น (ดู docs/REF_face-recognition.md §12)
  // ป้ายนี้จึงต้องเห็นชัดทุกครั้งที่เลือกเครื่องนี้ ไม่ใช่แค่บรรทัดเดียวที่อ่านผ่านได้ง่าย
  const lb = document.getElementById('hfsLabBadge');
  if (lb) lb.hidden = (_hfsEngine !== 'edge');
  const jw = document.getElementById('hfsJoinWrap');
  if (jw) jw.hidden = (_hfsEngine === 'edge');
  const rh = document.getElementById('hfsRangeHint');
  if (rh) {
    rh.textContent = _hfsEngine === 'edge'
      ? _hfsT('hfs.edgeRangeHint', 'ไม่เลือกกล้อง = ทุกกล้อง · ค้นได้เท่าที่ดัชนีครอบคลุม')
      : _hfsT('hfs.dateRangeHint', 'ช่วงเวลาต้องไม่เกิน 31 วัน · จำนวนคำขอสูงสุด 40');
  }
  hfsEngineNote();
}

// รายชื่อกล้อง + ความครอบคลุมของดัชนี · เรียกครั้งเดียวตอนเปิดหน้า ใช้ได้ทั้งสองเครื่อง
let _hfsStats = null;
async function hfsLoadEngine() {
  try {
    const r = await fetch(`${API}/api/hcp/engine-stats`, { credentials: 'include' });
    if (!r.ok) return;
    _hfsStats = await r.json();
    const sel = document.getElementById('hfsCam');
    if (sel) {
      sel.innerHTML = (_hfsStats.cameras || [])
        .map((c) => `<option value="${_hfsEsc(c.id)}">${_hfsEsc(c.name || c.id)}</option>`).join('');
      if (typeof MultiPicker !== 'undefined') MultiPicker.initAll(document.getElementById('hfsBody'));
    }
    hfsEngineNote();
  } catch { /* เลือกกล้องไม่ได้ ≠ ค้นไม่ได้ — ไม่ระบุกล้อง = ทุกกล้อง อยู่แล้ว */ }
}

// บอกความครอบคลุมของดัชนี **ก่อน** กดค้น — ไม่ใช่หลังจากได้ผลมาแล้ว
// เพราะ "ค้นทุกกล้องทุกวัน" กับ "ดัชนีมีอยู่ 2 วันจาก 33 วัน" หน้าตาเหมือนกันเป๊ะ
function hfsEngineNote() {
  const box = document.getElementById('hfsEngineNote');
  if (!box) return;
  if (_hfsEngine !== 'edge') {
    box.textContent = _hfsT('hfs.engineHcpNote', 'ค้นด้วยดัชนีของ HCP · เวลาที่ HCP คืนมาเป็นเวลาที่ประมวลผลเสร็จ ไม่ใช่เวลาที่กล้องจับ');
    return;
  }
  const idx = _hfsStats?.index;
  if (!idx || idx.error) {
    box.innerHTML = `<span class="hfs-bad">${_hfsEsc(_hfsT('hfs.engineNoIdx', 'ถามดัชนีบน edge ไม่ได้'))}
      ${_hfsEsc(idx?.error || '')}</span>`;
    return;
  }
  // ตัวหาร = เฉพาะภาพที่ยัง "มีสิทธิ์" กลายเป็น embedding ได้จริง — ไม่นับภาพที่
  // ตรวจไม่พบใบหน้า (ภาพนั้นไม่มีหน้าให้ตรวจจริง ๆ) และภาพซ้ำที่ตั้งใจข้าม เพราะ
  // สองกลุ่มนี้เพิ่มขึ้นทุกวันและไม่มีวันกลายเป็น embedding ⇒ ถ้านับเข้าไปด้วย
  // เปอร์เซ็นต์จะไหลลงเรื่อย ๆ ทั้งที่ระบบทำงานทัน (วัดจริง 2026-08-10: ส่วนต่าง
  // 13,974 ภาพ เป็นของที่ปิดไม่ได้ 8,926 = 64%) · ตัวเลขที่ปิดไม่ได้ยังแสดงแยก
  // ด้านหลังอยู่ เพื่อให้ยังตอบได้ว่า "ห่างเพราะช้า" หรือ "ห่างเพราะข้ามถูกต้องแล้ว"
  const dayMap = idx.days || {};
  const listed = idx.listed_total || 0;
  const noFace = idx.no_face_total || 0;
  const skipped = idx.skipped_total || 0;
  const pending = idx.pending_total || 0;
  const failed = idx.failed_total || 0;
  // เซิร์ฟเวอร์รุ่นเก่ายังไม่ส่ง embeddable_total มา — ถอยไปใช้ listed เหมือนเดิม
  const denom = idx.embeddable_total != null ? idx.embeddable_total : listed;
  const done = Object.values(dayMap).filter((v) => (v.indexed || 0) >= (v.listed || 0) && v.listed).length;
  const pct = denom ? Math.round((idx.vectors / denom) * 100) : 0;
  const cls = pct >= 99 ? 'hfs-ok' : 'hfs-warnt';
  const parts = [];
  if (pending) parts.push(`${_hfsEsc(_hfsT('hfs.qPending', 'รอคิว'))} ${pending.toLocaleString()}`);
  if (noFace)  parts.push(`${_hfsEsc(_hfsT('hfs.qNoFace', 'ไม่พบใบหน้า'))} ${noFace.toLocaleString()}`);
  if (skipped) parts.push(`${_hfsEsc(_hfsT('hfs.qSkipped', 'ข้ามภาพซ้ำ'))} ${skipped.toLocaleString()}`);
  if (failed)  parts.push(`${_hfsEsc(_hfsT('hfs.qFailed', 'ล้มเหลว'))} ${failed.toLocaleString()}`);
  box.innerHTML = `<span class="${cls}">${_hfsEsc(_hfsT('hfs.coverage', 'ดัชนีครอบคลุม'))}
    ${Number(idx.vectors || 0).toLocaleString()} / ${Number(denom).toLocaleString()}
    ${_hfsEsc(_hfsT('hfs.images', 'ภาพ'))} (${pct}%) · ${_hfsEsc(_hfsT('hfs.daysDone', 'ครบแล้ว'))}
    ${done}/${Object.keys(dayMap).length} ${_hfsEsc(_hfsT('hfs.days', 'วัน'))}</span>
    ${parts.length ? `· <span class="hfs-hint">${parts.join(' · ')}</span>` : ''}
    · ${_hfsEsc(_hfsT('hfs.engineEdgeNote', 'ภาพที่ยังไม่ได้เข้าดัชนีจะไม่ถูกค้น'))}`;
}

function hfsEngine(el) {
  const e = el?.dataset?.engine;
  if (!e || e === _hfsEngine) return;
  _hfsEngine = e;
  document.querySelectorAll('[data-action="hfsEngine"]').forEach((n) => {
    const on = n.dataset.engine === e;
    n.classList.toggle('on', on);
    n.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  // ±วินาที มีไว้จับคู่ผลของ HCP กับของเราด้วยเวลา · เครื่องเราคืนเหตุการณ์ของเราเอง
  // อยู่แล้ว ไม่มีอะไรต้องจับคู่ ⇒ ซ่อนทิ้ง ดีกว่าปล่อยให้ปรับแล้วไม่มีผล
  // "ความคล้ายขั้นต่ำ" ใช้ทั้งสองเครื่อง (เจ้าของสั่ง 2026-08-09) — ไม่เขียนทับค่าที่
  // คนพิมพ์ไว้ตอนสลับเครื่อง · จำนวนที่ถูกตัดจะถูกรายงานเสมอ ไม่ตัดเงียบ
  hfsSyncEngineFields();
}

// แมปกล้องบน edge เป็นไฟล์ที่ก๊อปมือมาจากตาราง hcp_camera_map — ถ้ามันดริฟต์
// HC1 จะตั้งชื่อไฟล์รูปด้วยกล้องผิดตัวโดยไม่มีใครรู้ · เตือนตรงหน้าที่คนทำงานกับ
// ข้อมูล HCP อยู่แล้ว ดีกว่ารอให้ไปเจอตอนรูปกับเหตุการณ์ไม่ตรงกัน
async function hfsCheckMap() {
  const box = document.getElementById('hfsDrift');
  if (!box) return;
  try {
    const r = await fetch(`${API}/api/hcp/cameras`, { credentials: 'include' });
    if (!r.ok) return;
    const d = (await r.json()).drift;
    if (!d || d.error || d.in_sync) return;   // ต่อ edge ไม่ได้ = เทียบไม่ได้ ไม่ใช่ดริฟต์
    const parts = [];
    if (d.changed?.length) parts.push(`${_hfsEsc(_hfsT('hfs.driftChanged', 'ชี้คนละกล้อง'))} ${d.changed.length}`);
    if (d.missing_on_edge?.length) parts.push(`${_hfsEsc(_hfsT('hfs.driftMissing', 'ขาดบน edge'))} ${d.missing_on_edge.length}`);
    if (d.extra_on_edge?.length) parts.push(`${_hfsEsc(_hfsT('hfs.driftExtra', 'เกินบน edge'))} ${d.extra_on_edge.length}`);
    box.innerHTML = `<div class="hfs-warn">${_hfsEsc(_hfsT('hfs.drift',
      'แมปกล้องบน edge ไม่ตรงกับฐานข้อมูล — รูปของ HC1 อาจถูกตั้งชื่อด้วยกล้องผิดตัว'))}
      · ${_hfsEsc(_hfsT('hfs.driftDb', 'ฐานข้อมูล'))} ${d.db_count} / edge ${d.edge_count}
      · ${parts.join(' · ')}
      <div class="hfs-hint">node src/hcp-setup.js --export-map hcp-camera-map.json</div></div>`;
  } catch { /* หน้าค้นยังใช้ได้ตามปกติแม้เช็คแมปไม่สำเร็จ */ }
}

// ลากวาง + กดเลือก · CSP บล็อก inline handler ทุกตัว จึงผูก listener ที่นี่หลัง render
function hfsBindDrop() {
  const box = document.getElementById('hfsDrop');
  const input = document.getElementById('hfsFile');
  if (!box || !input) return;
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { stop(e); box.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, (e) => { stop(e); box.classList.remove('over'); }));
  box.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (!/^image\/(jpeg|png)$/.test(f.type)) {
      document.getElementById('hfsResult').innerHTML =
        `<div class="hfs-warn">${_hfsEsc(_hfsT('hfs.errType', 'รับเฉพาะไฟล์ JPEG หรือ PNG'))}</div>`;
      return;
    }
    // ยัดไฟล์กลับเข้า input เพื่อให้เส้นทางเดียวกับการกดเลือกไฟล์ ไม่แยกโค้ดสองชุด
    const dt = new DataTransfer();
    dt.items.add(f);
    input.files = dt.files;
    hfsPickFile(input);
  });
  // กดที่กล่อง = เปิดหน้าต่างเลือกไฟล์ (input ถูกซ่อนด้วย CSS)
  //
  // ⚠️ ผูกตรงนี้เอง **ห้ามใช้ data-action** — ตัว dispatcher กลางเรียก `e.preventDefault()`
  // ทุกครั้งที่เจอ `[data-action]` · คลิกที่เราสร้างด้วย `input.click()` จะลอยขึ้นไปเจอ
  // กล่องที่เป็น `[data-action]` แล้วโดน preventDefault → **หน้าต่างเลือกไฟล์ถูกยกเลิกเงียบ ๆ**
  // (ลากวางยังทำงานเพราะไม่ได้ผ่าน dispatcher)
  //
  // และต้องกัน `e.target === input` ไม่งั้นคลิกที่เราสร้างเองจะวนเรียกตัวเองไม่รู้จบ
  const openPicker = (e) => {
    if (e.target === input) return;
    e.preventDefault();
    input.click();
  };
  box.addEventListener('click', openPicker);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openPicker(e); });
}

function hfsPickFile(input) {
  const prev = document.getElementById('hfsPreview');
  const btn = document.getElementById('hfsBtn');
  const f = input?.files?.[0];
  if (!f) { _hfsImage = null; if (prev) prev.hidden = true; return; }
  // FileReader เป็น async — ถ้าไม่ปิดปุ่มไว้ คนกดค้นทันทีจะเจอ "เลือกรูปก่อน"
  // ทั้งที่เห็นชื่อไฟล์อยู่ตรงหน้า
  if (btn) btn.disabled = true;
  const rd = new FileReader();
  rd.onload = () => {
    _hfsImage = String(rd.result);
    if (prev) { prev.src = _hfsImage; prev.hidden = false; }   // ยืนยันว่าเลือกรูปถูกใบ
    if (btn && !_hfsBusy) btn.disabled = false;
  };
  rd.onerror = () => {
    _hfsImage = null;
    if (prev) prev.hidden = true;
    if (btn && !_hfsBusy) btn.disabled = false;
  };
  rd.readAsDataURL(f);
}

async function hfsSearch() {
  const out = document.getElementById('hfsResult');
  if (_hfsBusy) return;
  if (!_hfsImage) { out.innerHTML = `<div class="hfs-warn">${_hfsEsc(_hfsT('hfs.errNoPhoto', 'เลือกรูปก่อน'))}</div>`; return; }
  const v = (id) => document.getElementById(id)?.value;
  // ถึง ก่อน ตั้งแต่ = ช่วงว่าง · หลังบ้านปฏิเสธอยู่แล้ว แต่บอกตรงนี้เร็วกว่าและ
  // ไม่ต้องส่งรูปข้าม tunnel ไปโดนปฏิเสธ
  if (v('hfsTo') < v('hfsFrom')) {
    out.innerHTML = `<div class="hfs-warn">${_hfsEsc(_hfsT('hfs.errRange', 'วันที่ "ถึง" ต้องไม่อยู่ก่อนวันที่ "ตั้งแต่"'))}</div>`;
    return;
  }
  _hfsBusy = true;
  document.getElementById('hfsBtn').disabled = true;
  out.innerHTML = `<div class="hfs-hint">${_hfsEsc(_hfsT('hfs.searching', 'กำลังค้น… อาจใช้เวลาหลายสิบวินาทีถ้าช่วงเวลากว้าง'))}</div>`;
  try {
    const r = await fetch(`${API}/api/hcp/face-search`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine: _hfsEngine,
        pictureData: _hfsImage,
        since: `${v('hfsFrom')}T00:00:00+07:00`,
        until: `${v('hfsTo')}T23:59:59+07:00`,
        threshold: Number(v('hfsThreshold')) || 0.7,
        joinSeconds: Number(v('hfsJoin')) || 3,
        // ไม่เลือกกล้อง = ทุกกล้อง (ทั้งสองเครื่องตีความเหมือนกัน)
        cameras: (typeof MultiPicker !== 'undefined') ? MultiPicker.values('hfsCam') : [],
        maxResults: 100,
      }),
    });
    const j = await r.json();
    if (!r.ok) { out.innerHTML = `<div class="hfs-warn">${_hfsEsc(j.error || `HTTP ${r.status}`)}</div>`; return; }
    hfsRender(j);
  } catch (e) {
    out.innerHTML = `<div class="hfs-warn">${_hfsEsc(e.message)}</div>`;
  } finally {
    _hfsBusy = false;
    document.getElementById('hfsBtn').disabled = false;
  }
}

function hfsRender(j) {
  _hfsLast = j;
  const edge = j.engine === 'edge';
  // ขอบเขตที่ค้นจริง — ฝั่งเครื่องเราต้องบอกตัวหารเสมอ ไม่งั้น "ค้นทั้งหมด" ที่ดัชนี
  // มีอยู่ 2 วันจาก 33 วัน จะอ่านเหมือนกวาดครบทุกวัน
  const cvg = j.coverage || {};
  const scope = edge
    ? `${_hfsEsc(_hfsT('hfs.scopeEdge', 'ค้นจาก'))} ${Number(cvg.indexed_in_range || 0).toLocaleString()}`
      + ` / ${Number(cvg.events_in_range || 0).toLocaleString()} ${_hfsEsc(_hfsT('hfs.images', 'ภาพ'))}`
      + ` ${_hfsEsc(_hfsT('hfs.inRange', 'ในช่วงที่เลือก'))}`
      + (cvg.by_day ? ` <span class="hfs-dim">(${_hfsEsc(_hfsT('hfs.byDay', 'นับเป็นรายวัน'))})</span>` : '')
      + (cvg.events_in_range && cvg.indexed_in_range < cvg.events_in_range
          ? ` · <span class="hfs-warnt">${_hfsEsc(_hfsT('hfs.notFull', 'ดัชนียังไม่ครบช่วงนี้'))}</span>` : '')
      + (j.dropped_no_event ? ` · ${j.dropped_no_event} ${_hfsEsc(_hfsT('hfs.droppedNoEvent', 'ภาพที่ไม่มีเหตุการณ์แล้ว'))}` : '')
      + (j.dropped_out_of_range ? ` · ${j.dropped_out_of_range} ${_hfsEsc(_hfsT('hfs.droppedOutOfRange', 'ภาพที่หลุดขอบช่วงเวลา'))}` : '')
      + (j.below_threshold ? ` · <span class="hfs-warnt">${j.below_threshold} ${_hfsEsc(_hfsT('hfs.belowThreshold', 'ภาพที่คล้ายแต่ต่ำกว่าเกณฑ์'))}</span>` : '')
      + ` · ${j.searched?.took_ms} ms`
    : `${_hfsEsc(_hfsT('hfs.scope', 'ค้นแล้ว'))} ${j.searched?.cameras} ${_hfsEsc(_hfsT('hfs.cameras', 'กล้อง'))} · `
      + `${j.searched?.calls} ${_hfsEsc(_hfsT('hfs.calls', 'คำขอ'))}`
      + (j.searched?.failed_calls ? ` · <span class="hfs-bad">${j.searched.failed_calls} ${_hfsEsc(_hfsT('hfs.failed', 'ล้มเหลว'))}</span>` : '');

  const rows = j.results || [];
  if (!rows.length) {
    document.getElementById('hfsResult').innerHTML =
      `<div class="hfs-hint">${scope}</div><div class="hfs-warn">${_hfsEsc(_hfsT('hfs.none', 'ไม่พบใบหน้าที่ใกล้เคียงในขอบเขตนี้'))}</div>`;
    return;
  }
  const bar = `<div class="hfs-viewbar">
      <span class="hfs-viewbtn${_hfsView === 'grid' ? ' on' : ''}" data-action="hfsView" data-view="grid">${_hfsEsc(_hfsT('hfs.viewGrid', 'ตาราง'))}</span>
      <span class="hfs-viewbtn${_hfsView === 'thumb' ? ' on' : ''}" data-action="hfsView" data-view="thumb">${_hfsEsc(_hfsT('hfs.viewThumb', 'ภาพย่อ'))}</span>
    </div>`;
  // ฝั่งเครื่องเรา: ผลลัพธ์ **คือ** เหตุการณ์ของเราอยู่แล้ว ไม่มีการจับคู่ด้วยเวลา
  // จึงไม่มีบรรทัด "มีภาพของเราในช่วงเวลาใกล้กัน" ให้อ่านผิดว่าเป็นการยืนยันตัวคน
  const note = edge
    ? `<span class="hfs-dim">${_hfsEsc(_hfsT('hfs.edgeNote',
        'คะแนนของเครื่องเราเป็นคนละสเกลกับ % ของ HCP · วัดจริงแล้วคนทั่วไปไม่เคยเกิน 0.43'))}</span>`
    : `${_hfsEsc(_hfsT('hfs.nearInTime', 'มีภาพของเราในช่วงเวลาใกล้กัน'))}
       ${j.near_in_time}/${rows.length} (±${j.join_seconds} ${_hfsEsc(_hfsT('hfs.sec', 'วินาที'))})
       · <span class="hfs-dim">${_hfsEsc(_hfsT('hfs.nearNote', 'จับคู่ด้วยเวลา ไม่ใช่การยืนยันว่าเป็นคนเดียวกัน'))}</span>`;
  document.getElementById('hfsResult').innerHTML = `
    <div class="hfs-hint">${scope} · ${note}</div>
    ${bar}${_hfsView === 'thumb' ? _hfsThumbs(rows) : _hfsTable(rows)}`;
}

// URL ของรูปฝั่ง HCP ต้องผ่าน central เสมอ (เบราว์เซอร์ไปไม่ถึงวง LAN ของ HCP)
const _hfsPic = (u) => `${API}/api/hcp/picture?u=${encodeURIComponent(u)}`;
const _hfsPct = (x) => Math.round(Number(x.similarity) * 100);
// ⚠️ ทุกตัวช่วย render ต้องถามจาก **ผลลัพธ์ที่กำลังแสดงอยู่** ไม่ใช่จากปุ่มที่เลือกไว้
// ตอนนี้ — คนกดค้นด้วย HCP แล้วสลับปุ่มไปเครื่องเราโดยไม่ค้นใหม่ได้ตลอด ถ้าอ่าน
// `_hfsEngine` ตรง ๆ แถวของ HCP จะถูก render เป็นคะแนนแบบเครื่องเรา (0.88 แทน 88%)
// และกดเปิดแถวจะเข้าทางของเครื่องเรา ซึ่ง `ours` มักเป็น null ⇒ modal ว่างเปล่า
// และแถบให้เลือกภาพ (หัวใจของเส้นทาง HCP) ถูกข้ามไปทั้งอัน
const _hfsIsEdge = () => _hfsLast?.engine === 'edge';

// คะแนนของเครื่องเราไม่ใช่เปอร์เซ็นต์ และไม่ได้อยู่สเกลเดียวกับของ HCP — แสดงเป็น
// ทศนิยมดิบพร้อมบอกว่าถึงเกณฑ์ที่วัดแล้วว่า "ไม่เคยเตือนผิด" หรือยัง · เขียนเป็น %
// จะชวนให้เอา 0.55 ไปเทียบกับ 88% ของ HCP ตรง ๆ ซึ่งคนละความหมายกันคนละเรื่อง
const _hfsScore = (x) => _hfsIsEdge()
  ? `<span class="${Number(x.similarity) >= HFS_EDGE_CONFIDENT ? 'hfs-ok' : 'hfs-dim'}">${Number(x.similarity).toFixed(2)}</span>`
  : `${_hfsPct(x)}%`;
// รูปที่ใช้แทนแถวหนึ่ง — ฝั่ง HCP ใช้ภาพที่ HCP ตัดมา · ฝั่งเราใช้ภาพของเราเอง
const _hfsRowImg = (x) => _hfsIsEdge()
  ? (x.ours?.snapshot ? `${API}/snapshots/${x.ours.snapshot}` : null)
  : (x.subpic_url ? _hfsPic(x.subpic_url) : null);
// เวลาไทยเสมอ — ค่าดิบจากฐานข้อมูลเป็น UTC ถ้าพิมพ์ตรง ๆ จะเพี้ยนไป 7 ชั่วโมง
const _hfsTime = (v, withDate = true) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? String(v)
    : d.toLocaleString('th-TH', withDate ? { dateStyle: 'medium', timeStyle: 'medium' } : { timeStyle: 'medium' });
};
// ห่างกี่วินาที + สีตามความน่าเชื่อ · ≤1s เกือบแน่ · ≤3s น่าเชื่อ · เกินนั้นระวัง
const _hfsDelta = (x) => {
  // เครื่องเราไม่ได้จับคู่ด้วยเวลา — ผลลัพธ์คือเหตุการณ์ของเราตรง ๆ ไม่มีระยะห่างให้วัด
  if (_hfsIsEdge())
    return `<span class="hfs-ok">${_hfsEsc(_hfsT('hfs.ownEvent', 'ภาพของเราเอง'))}</span>`;
  if (!x.ours) return `<span class="hfs-dim">${_hfsEsc(_hfsT('hfs.noNear', 'ไม่มีภาพในช่วงนั้น'))}</span>`;
  // ⚠️ ห้าม `?? 0` — ถ้าหลังบ้านยังไม่ส่ง delta_sec (เช่นหน้าจอใหม่ + API เก่าที่ยังไม่ restart)
  // การเดาว่า 0 จะขึ้นเป็น "ห่าง 0s" สีเขียว = มั่นใจผิด ๆ ในหน้าที่ใช้ชี้ตัวคน
  if (x.ours.delta_sec == null) return `<span class="hfs-dim">—</span>`;
  const d = Number(x.ours.delta_sec);
  const cls = d <= 1 ? 'hfs-ok' : d <= 3 ? 'hfs-warnt' : 'hfs-dim';
  return `<span class="${cls}">${_hfsEsc(_hfsT('hfs.apart', 'ห่าง'))} ${d}s</span>`;
};
// รหัสคุณลักษณะของ HCP (คู่มือ V3.0.1 ภาคผนวก A.1.45)
const _HCP_GENDER = { 1: 'ชาย', 2: 'หญิง' };
const _HCP_GLASSES = { 1: 'สวมแว่น', 3: 'แว่นกันแดด' };
const _HCP_MASK = { 1: 'สวมหน้ากาก' };
const _HCP_SMILE = { 3: 'ยิ้ม' };
const _HCP_AGE = { 1: 'วัยรุ่น', 2: 'ผู้ใหญ่ตอนต้น', 3: 'วัยกลางคน', 4: 'ผู้สูงอายุ', 5: 'ทารก',
                   6: 'เด็ก', 7: 'วัยรุ่นตอนต้น', 8: 'วัยฉกรรจ์', 9: 'วัยกลางคนถึงสูงอายุ' };
const _hfsWear = (x) => [_HCP_GLASSES[Number(x.glasses)], _HCP_MASK[Number(x.mask)]]
  .filter(Boolean).join(' · ') || _hfsT('hfs.wearNone', 'ไม่พบ');
const _hfsOurs = (x) => x.ours
  ? `<span class="hfs-ok">${_hfsEsc(_hfsT('hfs.hasOurs', 'มีในระบบเรา'))}</span>`
  : `<span class="hfs-dim">${_hfsEsc(_hfsT('hfs.noOurs', 'ไม่มีในระบบเรา'))}</span>`;

function _hfsTable(rows) {
  const body = rows.map((x, i) => `<tr data-action="hfsOpen" data-i="${i}">
      <td><b>${_hfsScore(x)}</b></td>
      <td>${_hfsEsc(_hfsTime(x.capture_time))}</td>
      <td>${_hfsEsc(x.camera_name || x.camera_id || `HCP ${x.hcp_index}`)}</td>
      <td>${_hfsDelta(x)}</td>
    </tr>`).join('');
  return `<div class="hfs-tablewrap"><table class="hfs-table">
      <thead><tr>
        <th>${_hfsEsc(_hfsT('hfs.similarity', 'ความคล้าย'))}</th>
        <th>${_hfsEsc(_hfsT('hfs.time', 'เวลา'))}</th>
        <th>${_hfsEsc(_hfsT('hfs.camera', 'กล้อง'))}</th>
        <th>${_hfsEsc(_hfsT('hfs.ourImage', 'ภาพของเรา'))}</th>
      </tr></thead><tbody>${body}</tbody></table></div>`;
}

function _hfsThumbs(rows) {
  return `<div class="hfs-thumbs">${rows.map((x, i) => `
    <div class="hfs-card" data-action="hfsOpen" data-i="${i}">
      ${_hfsRowImg(x)
        ? `<img class="hfs-card-img" src="${_hfsRowImg(x)}" alt="" loading="lazy" decoding="async" data-err="hide">`
        : `<div class="hfs-card-img"></div>`}
      <div class="hfs-card-b">
        <div class="hfs-card-p">${_hfsScore(x)}</div>
        <div class="hfs-card-m">${_hfsEsc(_hfsTime(x.capture_time))}<br>
          ${_hfsEsc(x.camera_name || x.camera_id || `HCP ${x.hcp_index}`)}<br>${_hfsDelta(x)}</div>
      </div>
    </div>`).join('')}</div>`;
}

function hfsView(el) {
  const v = el?.dataset?.view;
  if (!v || v === _hfsView || !_hfsLast) return;
  _hfsView = v;
  hfsRender(_hfsLast);
}

// เปิดเทียบรูป — ผังเดียวกับ modal "รายละเอียดใบหน้า" ของระบบเรา
//
// ⚠️ ไม่เลือกภาพฝั่งเราให้อัตโนมัติอีกแล้ว (ยกเว้นห่าง ≤1 วินาที) เพราะ `captureTime`
// ของ HCP คือเวลาที่มันประมวลผลเสร็จ ไม่ใช่เวลาที่กล้องจับ — วัดจริงพบช้าถึง 26 นาที
// ⇒ แสดงภาพของเราจากกล้องตัวนั้นเป็นแถบให้ "คน" เลือก ซึ่งจำหน้าได้ดีกว่าเครื่อง
let _hfsSel = null;      // ผลลัพธ์ที่กำลังเปิดอยู่
let _hfsNearby = [];     // ภาพของเราที่ดึงมาให้เลือก
let _hfsWin = 60;        // ขนาดหน้าต่าง (วินาที)
let _hfsAt = null;       // เวลาที่ผู้ใช้อ่านจาก OSD บนภาพแล้วระบุเอง (ทับเวลาของ HCP)

function hfsOpen(el) {
  const x = (_hfsLast?.results || [])[Number(el?.dataset?.i)];
  if (!x) return;
  _hfsSel = x;
  _hfsWin = 60;
  _hfsAt = null;
  _hfsNearby = [];
  const cam = x.camera_name || x.camera_id || `HCP ${x.hcp_index}`;
  const box = document.createElement('div');
  box.className = 'hfs-modal';
  box.id = 'hfsModal';
  // ฝั่งเครื่องเรา: ผลลัพธ์ชี้ไปที่เหตุการณ์ของเราตรง ๆ อยู่แล้ว **ไม่ต้องให้คนเลือก
  // ภาพซ้ำอีก** — แถบให้เลือกมีไว้แก้ปัญหาเวลาของ HCP ที่หน่วง ซึ่งไม่มีในเส้นทางนี้
  const edge = _hfsIsEdge();
  box.innerHTML = `
    <div class="hfs-modal-box">
      <div class="hfs-modal-h">
        <div class="hfs-modal-t">${edge ? _hfsScore(x) : `${_hfsPct(x)}%`} · ${_hfsEsc(cam)}</div>
        <button class="hfs-modal-x" data-action="hfsClose" aria-label="close">×</button>
      </div>
      <div class="hfs-modal-body" id="hfsModalBody">${edge ? _hfsOursBlock(x, cam) : `${_hfsHcpBlock(x, cam)}
        <div class="fm-section-label" style="margin-top:18px">${_hfsEsc(_hfsT('hfs.secPick', 'เลือกภาพของเราที่เป็นคนเดียวกัน'))}</div>
        <div id="hfsNearbyBox"><div class="hfs-hint">${_hfsEsc(_hfsT('hfs.loading', 'กำลังโหลด…'))}</div></div>
        <div id="hfsPickedBox"></div>`}
      </div>
    </div>`;
  box.addEventListener('click', (e) => { if (e.target === box) hfsClose(); });
  document.body.appendChild(box);
  if (!edge) hfsLoadNearby();
  else if (x.ours?.id) _hfsLoadAppearance(x.ours.id, 'hfsAppearanceSection');
}

// IVA Pro appearance (appearances table, matched via event_id) — lazy, only
// shown when a record exists. Reuses the same fetch+render pair as the Events
// modal and the Face Recognition match modal (page-snapshots.js).
function _hfsLoadAppearance(eventId, containerId) {
  fetch(`${API}/api/events/${eventId}/appearance`)
    .then(r => r.ok ? r.json() : null)
    .then(ap => {
      if (!ap) return;
      const sec = document.getElementById(containerId);
      if (!sec || sec.dataset.eid !== String(eventId)) return;
      sec.innerHTML = _renderAppearanceSection(ap);
    })
    .catch(() => {});
}

// รายละเอียดของภาพที่เครื่องเราหาเจอ — ทุกอย่างมาจากเหตุการณ์ของเราเอง
function _hfsOursBlock(x, cam) {
  const o = x.ours || {};
  return _hfsPair(_hfsT('fmatch.cropLabel', 'ใบหน้า (CROP)'),
                  _hfsImgBox(o.snapshot ? `${API}/snapshots/${o.snapshot}` : null, '1/1'),
                  _hfsT('fmatch.sceneLabel', 'ภาพฉากเต็ม (SNAPSHOT)'),
                  _hfsImgBox(o.snapshot_full ? `${API}/snapshots/${o.snapshot_full}` : null, '16/9'))
    + `<div class="fm-section-label" style="margin-top:18px">${_hfsEsc(_hfsT('hfs.secOursDetail', 'รายละเอียดจากระบบเรา'))}</div>`
    + _hfsGrid([
      [_hfsT('hfs.time', 'เวลา'), _hfsEsc(_hfsTime(x.capture_time))],
      [_hfsT('hfs.camera', 'กล้อง'), _hfsEsc(cam)],
      [_hfsT('hfs.similarity', 'ความคล้าย'), _hfsScore(x)],
      [_hfsT('hfs.eventType', 'ชนิดเหตุการณ์'), _hfsEsc(o.event_type || '—')],
      [_hfsT('face.gender', 'เพศ'), _hfsEsc(o.gender || '—')],
      [_hfsT('face.age', 'อายุ'), _hfsEsc(o.age || '—')],
      [_hfsT('hfs.wear', 'สวมใส่'), _hfsEsc([o.glass, o.mask, o.hat].filter((v) => v && v !== 'no').join(' · ') || '—')],
      [_hfsT('hfs.eventId', 'รหัสเหตุการณ์'), _hfsEsc(o.id != null ? `#${o.id}` : '—')],
    ])
    + (o.id != null ? `<div id="hfsAppearanceSection" data-eid="${o.id}"></div>` : '');
}

const _hfsImgBox = (src, ratio) => src
  ? `<img src="${src}" alt="" data-err="hide" style="width:100%;aspect-ratio:${ratio};object-fit:cover;border-radius:8px;background:var(--surface-base);display:block">`
  : `<div style="width:100%;aspect-ratio:${ratio};border-radius:8px;background:var(--surface-base);display:flex;
       align-items:center;justify-content:center;color:var(--text-secondary);font-size:11px">
       ${_hfsEsc(_hfsT('hfs.noImg', 'ไม่มีภาพ'))}</div>`;
const _hfsGrid = (rows) => `<div class="fm-data-grid">${rows.filter(Boolean).map(([k, v]) =>
  `<div class="fm-data-row"><span>${_hfsEsc(k)}</span><strong>${v}</strong></div>`).join('')}</div>`;
const _hfsPair = (l1, i1, l2, i2) => `
  <div class="fc-img-pair">
    <div><div class="fm-section-label" style="margin-top:0;padding-top:0;border-top:none">${_hfsEsc(l1)}</div>
      <div class="fc-imgwrap">${i1}</div></div>
    <div><div class="fm-section-label" style="margin-top:0;padding-top:0;border-top:none">${_hfsEsc(l2)}</div>
      <div class="fc-imgwrap">${i2}</div></div>
  </div>`;

function _hfsHcpBlock(x, cam) {
  return _hfsPair(_hfsT('hfs.capFace', 'ใบหน้าที่ HCP ตัดมา'), _hfsImgBox(x.subpic_url ? _hfsPic(x.subpic_url) : null, '1/1'),
                  _hfsT('hfs.capScene', 'ภาพเต็มจากกล้องของ HCP'), _hfsImgBox(x.pic_url ? _hfsPic(x.pic_url) : null, '16/9'))
    + `<div class="fm-section-label" style="margin-top:18px">${_hfsEsc(_hfsT('hfs.secHcp', 'รายละเอียดจาก HCP'))}</div>`
    + _hfsGrid([
      [_hfsT('hfs.time', 'เวลา'), _hfsEsc(_hfsTime(x.capture_time))],
      [_hfsT('hfs.camera', 'กล้อง'), _hfsEsc(cam)],
      [_hfsT('hfs.similarity', 'ความคล้าย'), `${_hfsPct(x)}%`],
      [_hfsT('face.gender', 'เพศ'), _hfsEsc(_HCP_GENDER[Number(x.gender)] || '—')],
      [_hfsT('face.age', 'อายุ'), _hfsEsc(_HCP_AGE[Number(x.age_group)] || '—')],
      [_hfsT('face.wearing', 'การสวมใส่'), _hfsEsc(_hfsWear(x))],
      [_hfsT('face.emotion', 'อารมณ์'), _hfsEsc(_HCP_SMILE[Number(x.smile)] || '—')],
    ])
    // เตือนตรงจุดที่คนอ่านตัวเลขเวลา — มีหลักฐานเคสจริงกำกับ
    + `<div class="hfs-modal-cap">⚠️ ${_hfsEsc(_hfsT('hfs.timeWarn',
        'เวลานี้คือเวลาที่ HCP ประมวลผลเสร็จ ไม่ใช่เวลาที่กล้องจับ — พบช้ากว่าจริงได้ถึง 26 นาที ให้ยึดเวลาที่ปรากฏบนภาพ'))}</div>`;
}

async function hfsLoadNearby(win) {
  const x = _hfsSel;
  const box = document.getElementById('hfsNearbyBox');
  if (!x || !box) return;
  if (win) _hfsWin = win;
  if (!x.camera_id) {
    box.innerHTML = `<div class="hfs-warn">${_hfsEsc(_hfsT('hfs.notOurCam', 'กล้องตัวนี้ HCP ดูแลอยู่ตัวเดียว ระบบเราไม่ได้ต่อด้วย'))}</div>`;
    return;
  }
  box.innerHTML = `<div class="hfs-hint">${_hfsEsc(_hfsT('hfs.loading', 'กำลังโหลด…'))}</div>`;
  try {
    const q = new URLSearchParams({ camera_id: x.camera_id, at: _hfsAt || x.capture_time,
      window: String(_hfsAt ? Math.min(_hfsWin, 60) : _hfsWin), limit: '24' });
    const r = await fetch(`${API}/api/hcp/nearby?${q}`, { credentials: 'include' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _hfsNearby = j.rows || [];
    _hfsRenderNearby(j);
    // ห่าง ≤1 วินาที = แทบแน่นอนว่าเป็นภาพเดียวกัน — เลือกให้เลย · นอกนั้นปล่อยให้คนเลือก
    const auto = _hfsNearby.findIndex((o) => Number(o.delta_sec) <= 1);
    if (auto >= 0) hfsPickNear({ dataset: { i: String(auto) } });
    else document.getElementById('hfsPickedBox').innerHTML = '';
  } catch (e) {
    box.innerHTML = `<div class="hfs-warn">${_hfsEsc(e.message)}</div>`;
  }
}

function _hfsRenderNearby(j) {
  const btn = (w, label) => `<span class="hfs-viewbtn${_hfsWin === w ? ' on' : ''}" data-action="hfsWin" data-w="${w}">${_hfsEsc(label)}</span>`;
  // ⏱ ช่องกรอกเวลาจากภาพ — ทางออกของเคสที่ HCP หน่วงนาน (พบถึง 26 นาที)
  // เรียง "ใกล้ที่สุด 24 ใบ" รอบเวลาของ HCP จะไม่มีวันมีภาพที่ถูกต้องอยู่เลย
  // แต่ OSD บนภาพบอกเวลาจริงไว้ชัด ๆ ⇒ ให้คนอ่านแล้วพิมพ์ลงไป แล้วเราค้นตรงจุดนั้น
  const t = String(_hfsAt || _hfsSel.capture_time);
  const bar = `<div class="hfs-viewbar">
      ${_hfsAt ? '' : btn(60, '±1 ' + _hfsT('hfs.minute', 'นาที')) + btn(300, '±5 ' + _hfsT('hfs.minute', 'นาที')) + btn(1800, '±30 ' + _hfsT('hfs.minute', 'นาที'))}
      <span class="hfs-dim" style="font-size:11.5px">${_hfsEsc(_hfsT('hfs.found', 'พบ'))} ${j.total}
        ${j.total > j.shown ? `· ${_hfsEsc(_hfsT('hfs.showingFirst', 'แสดง'))} ${j.shown}` : ''}</span>
    </div>
    <div class="hfs-viewbar">
      <span class="hfs-dim" style="font-size:11.5px">${_hfsEsc(_hfsT('hfs.osdTime', 'เวลาที่เห็นบนภาพ'))}</span>
      <input class="form-input hfs-osd" type="text" id="hfsOsd" value="${_hfsEsc(t.slice(11, 19))}" placeholder="HH:MM:SS">
      <span class="hfs-viewbtn" data-action="hfsUseOsd">${_hfsEsc(_hfsT('hfs.useOsd', 'ค้นรอบเวลานี้'))}</span>
      ${_hfsAt ? `<span class="hfs-viewbtn" data-action="hfsResetOsd">${_hfsEsc(_hfsT('hfs.backToHcp', 'กลับไปใช้เวลาของ HCP'))}</span>` : ''}
    </div>`;
  if (!_hfsNearby.length) {
    document.getElementById('hfsNearbyBox').innerHTML = bar
      + `<div class="hfs-warn">${_hfsEsc(_hfsT('hfs.noneNearby', 'ไม่มีภาพของกล้องตัวนี้ในช่วงเวลานี้ — ลองขยายช่วงเวลา'))}</div>`;
    return;
  }
  document.getElementById('hfsNearbyBox').innerHTML = bar + `<div class="hfs-strip">${_hfsNearby.map((o, i) => `
    <div class="hfs-strip-item" data-action="hfsPickNear" data-i="${i}" id="hfsNear${i}">
      <img src="${API}/snapshots/${_hfsEsc(o.snapshot)}" alt="" loading="lazy" decoding="async" data-err="hide">
      <div class="hfs-strip-t">${_hfsEsc(_hfsTime(o.event_time, false))}</div>
      <div class="hfs-strip-d">${Number(o.delta_sec) <= 1 ? '<span class="hfs-ok">' : '<span class="hfs-dim">'}
        ${_hfsEsc(_hfsT('hfs.apart', 'ห่าง'))} ${o.delta_sec}s</span></div>
    </div>`).join('')}</div>`;
}

function hfsWin(el) { hfsLoadNearby(Number(el?.dataset?.w) || 60); }

// ใช้เวลาที่ผู้ใช้อ่านจาก OSD — ประกอบกับวันที่ของผลลัพธ์นั้น แล้วค้นแคบ ๆ รอบจุดนั้น
function hfsUseOsd() {
  const v = String(document.getElementById('hfsOsd')?.value || '').trim();
  const m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const box = document.getElementById('hfsNearbyBox');
  if (!m) {
    box.insertAdjacentHTML('beforeend',
      `<div class="hfs-warn">${_hfsEsc(_hfsT('hfs.badTime', 'กรอกเวลาแบบ HH:MM:SS'))}</div>`);
    return;
  }
  const day = String(_hfsSel.capture_time).slice(0, 10);
  const hh = m[1].padStart(2, '0');
  _hfsAt = `${day}T${hh}:${m[2]}:${m[3] || '00'}+07:00`;
  _hfsWin = 60;
  hfsLoadNearby();
}

function hfsResetOsd() { _hfsAt = null; hfsLoadNearby(60); }

function hfsPickNear(el) {
  const i = Number(el?.dataset?.i);
  const o = _hfsNearby[i];
  if (!o) return;
  document.querySelectorAll('.hfs-strip-item').forEach((n) => n.classList.remove('on'));
  document.getElementById(`hfsNear${i}`)?.classList.add('on');
  const near = Number(o.delta_sec) <= 1;
  document.getElementById('hfsPickedBox').innerHTML =
    _hfsPair(_hfsT('fmatch.cropLabel', 'ใบหน้า (CROP)'), _hfsImgBox(o.snapshot ? `${API}/snapshots/${o.snapshot}` : null, '1/1'),
             _hfsT('fmatch.sceneLabel', 'ภาพฉากเต็ม (SNAPSHOT)'), _hfsImgBox(o.snapshot_full ? `${API}/snapshots/${o.snapshot_full}` : null, '16/9'))
    + _hfsGrid([
      [_hfsT('hfs.time', 'เวลา'), _hfsEsc(_hfsTime(o.event_time))],
      [_hfsT('hfs.apartFull', 'ห่างจากเวลาที่ HCP บันทึก'), `${o.delta_sec}s`],
      [_hfsT('face.gender', 'เพศ'), _hfsEsc(typeof faceGenderLabel === 'function' ? faceGenderLabel(o.gender) : (o.gender || '—'))],
      [_hfsT('face.age', 'อายุ'), _hfsEsc(typeof faceAgeBucket === 'function' ? faceAgeBucket(o.age) : (o.age || '—'))],
      o.expression ? [_hfsT('face.emotion', 'อารมณ์'), _hfsEsc(typeof faceExprLabel === 'function' ? faceExprLabel(o.expression) : o.expression)] : null,
      [_hfsT('face.wearing', 'การสวมใส่'), _hfsEsc([o.glass === 'sunglasses' ? 'แว่นกันแดด' : o.glass === 'yes' ? 'สวมแว่น' : null,
        o.mask === 'yes' ? 'หน้ากาก' : null, o.hat === 'yes' ? 'หมวก' : null].filter(Boolean).join(' · ') || _hfsT('hfs.wearNone', 'ไม่พบ'))],
      [_hfsT('face.quality', 'คุณภาพ'), o.face_score ? `${_hfsEsc(o.face_score)}%` : '—'],
    ])
    + `<div class="hfs-modal-cap">${near
        ? '✅ ' + _hfsEsc(_hfsT('hfs.likelySame', 'ห่างไม่ถึงวินาที — น่าจะเป็นภาพเดียวกัน'))
        : _hfsEsc(_hfsT('hfs.pickedNote', 'ภาพนี้เป็นภาพที่คุณเลือกเอง ระบบไม่ได้ยืนยันว่าเป็นคนเดียวกัน'))}</div>`
    + (o.id != null ? `<div id="hfsPickedAppearance" data-eid="${o.id}"></div>` : '');
  if (o.id != null) _hfsLoadAppearance(o.id, 'hfsPickedAppearance');
}

function hfsClose() { document.getElementById('hfsModal')?.remove(); }
