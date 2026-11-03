// ============================================================
// Vigil Platform — Manual watch-list entry (BM2)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// The screen for POST /api/blacklist/manual/lpr (BM1a). Ported from the mockup
// at public/others/demo/blacklist-manual/ — but deliberately NOT field for
// field.
//
// The mockup drew eleven inputs. Six of them have no backend and would have sat
// there doing nothing:
//   label        composed by the bridge, [source_label, case_ref].join(' · ')
//   notify_line  set by the bridge on INSERT only (short-plate muting), and
//                never rewritten, so a form control here would be undone
//   ref_image    materializeBridgePhoto() copies the winning record's photo;
//                BM1a passes photo_b64: null and there is no upload path yet
//   link_person  happens by itself — upsertRecord matches on id_hash then
//                plate_hash
//   active       not a parameter
//   face tab     BM1b exists (POST /api/blacklist/manual/face) but faces have no
//                bridge to a watch mechanism — they stay "ยังไม่เฝ้า" until an
//                operator manually sets up alerts elsewhere
// Shipping them would recreate exactly the silent no-op that ก was written to
// kill. They appear here as a read-only note saying the bridge owns them.
//
// The other half of ก: saving does NOT start watching. BM1a writes to the
// reservoir and leaves applying to the operator, the same as an import. So the
// result panel says what is pending and hands over to the existing
// blOpenBridge() modal rather than growing a second Apply button.
//
// CSP: no inline handlers — everything goes through data-action / ACTION_MAP.
// ============================================================
'use strict';

const _blmT = (k, fb) => (typeof I18N !== 'undefined' && I18N.t) ? I18N.t(k, fb) : fb;
// emoji ใช้เป็น UI ไม่ได้ (WA #2-C) — หน้าตาต่างกันข้าม OS, เปลี่ยนธีมไม่ได้, i18n ไม่ได้
// sprite ยังไม่มี symbol "เตือน" และไม่คุ้มจะเพิ่มเพื่อที่เดียว จึงวาด inline ด้วย currentColor
const _blmWarnIcon = () =>
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
  'style="vertical-align:-2px"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';

const _blmEsc = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s);

let _blmGroups = [];
let _blmCurrentTab = 'lpr';
let _blmPhotoB64 = null;  // Photo base64 storage to survive DOM re-renders (BM2)

function blmOpen() {
  const bg = document.getElementById('blManualModal');
  if (!bg) return;
  bg.classList.remove('hidden');
  _blmCurrentTab = 'lpr';
  _blmPhotoB64 = null;  // Reset photo when opening form
  blmRenderForm();
  // Groups decide the alert policy, so the list has to be the live one — a
  // stale hardcoded set would let an operator pick a group that no longer
  // exists and get a 400 they cannot act on.
  fetch(`${API}/api/lpr/watchlist/groups`, { credentials: 'include' })
    .then((r) => r.json())
    .then((j) => {
      _blmGroups = Array.isArray(j) ? j : (j.groups || []);
      // Re-render WITH whatever is already in the fields. Without this the
      // groups arriving wipe the form: reproduced at 400 ms of latency, an
      // operator who starts typing the moment the modal opens loses the plate,
      // the case number and the note, and gets no hint that it happened.
      blmRenderForm(blmReadForm());
    })
    .catch(() => { /* form still works ungrouped */ });
}

function blmClose() {
  document.getElementById('blManualModal')?.classList.add('hidden');
}

// Current field values, in the shape blmRenderForm() takes back. One reader so
// a field added to the form cannot be preserved on save but dropped on
// re-render, or the other way round.
function blmReadForm() {
  const v = (id) => document.getElementById(id)?.value ?? '';
  if (_blmCurrentTab === 'face') {
    return {
      name: v('blmFaceName'),
      national_id: v('blmNationalId'),
      case_ref: v('blmFaceCaseRef'),
      case_note: v('blmFaceCaseNote'),
      photo_b64: null,  // photo upload not implemented yet
    };
  }
  return {
    plate: v('blmPlate'), province: v('blmProvince'), group_id: v('blmGroup'),
    case_ref: v('blmCaseRef'), name: v('blmName'), case_note: v('blmNote'),
    brand: v('blmBrand'), vehicle_type: v('blmVehicleType'),
    vehicle_color: v('blmVehicleColor'), plate_type: v('blmPlateType'),
    case_kind: v('blmCaseKind'), photo_b64: _blmPhotoB64,
  };
}

function blmRenderForm(keep) {
  const body = document.getElementById('blManualBody');
  if (!body) return;
  const provinces = (typeof _LPR_PROVINCES !== 'undefined' && Array.isArray(_LPR_PROVINCES)) ? _LPR_PROVINCES : [];
  const provLabel = (p) => (typeof provinceLabel === 'function') ? provinceLabel(p) : p;
  const v = keep || {};

  // A plate_region group cannot verify a plate whose province we do not know,
  // and the server refuses that combination. Flagging it on the option itself
  // means the operator learns the rule while choosing, not after being rejected.
  const groupOpts = [`<option value="">${_blmEsc(_blmT('blm.noGroup', '— ไม่ระบุกลุ่ม —'))}</option>`]
    .concat(_blmGroups.map((g) => {
      const needsProv = g.default_alert_mode === 'plate_region';
      const sel = v.group_id === g.id ? ' selected' : '';
      return `<option value="${_blmEsc(g.id)}" data-mode="${_blmEsc(g.default_alert_mode || 'plate')}"${sel}>`
        + `${_blmEsc(g.name || g.id)}${needsProv ? ' · ' + _blmEsc(_blmT('blm.needsProvince', 'ต้องระบุจังหวัด')) : ''}</option>`;
    })).join('');

  const provOpts = [`<option value="">${_blmEsc(_blmT('blm.noProvince', '— ไม่ระบุ —'))}</option>`]
    .concat(provinces.map((p) => `<option value="${_blmEsc(p)}"${v.province === p ? ' selected' : ''}>${_blmEsc(provLabel(p))}</option>`)).join('');

  // Tabs
  const lprTab = _blmCurrentTab === 'lpr' ? ' active' : '';
  const faceTab = _blmCurrentTab === 'face' ? ' active' : '';

  // LPR form
  const lprForm = `
    <div class="blm-grid">
      <div class="blm-field blm-span2">
        <label class="form-label" for="blmPlate">${_blmEsc(_blmT('blm.plate', 'เลขทะเบียน'))} <span class="blm-req">*</span></label>
        <input class="form-input" id="blmPlate" autocomplete="off" value="${_blmEsc(v.plate || '')}"
               placeholder="${_blmEsc(_blmT('blm.platePh', 'เช่น 1กธ4047'))}">
        <div class="blm-hint">${_blmEsc(_blmT('blm.plateHint', 'เว้นวรรคหรือขีดได้ ระบบตัดออกให้เอง · ทะเบียนเดิมที่เพิ่มซ้ำจะเป็นการแก้ไข ไม่ใช่รายการใหม่'))}</div>
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmGroup">${_blmEsc(_blmT('blm.group', 'กลุ่มเฝ้าระวัง'))}</label>
        <select class="form-input" id="blmGroup">${groupOpts}</select>
        <div class="blm-hint">${_blmEsc(_blmT('blm.groupHint', 'กลุ่มเป็นตัวกำหนดรูปแบบการแจ้งเตือน ไม่ได้ตั้งทีละป้าย'))}</div>
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmProvince">${_blmEsc(_blmT('blm.province', 'จังหวัด'))}</label>
        <select class="form-input" id="blmProvince">${provOpts}</select>
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmCaseRef">${_blmEsc(_blmT('blm.caseRef', 'เลขคดี / เลขอ้างอิง'))}</label>
        <input class="form-input" id="blmCaseRef" autocomplete="off" value="${_blmEsc(v.case_ref || '')}">
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmName">${_blmEsc(_blmT('blm.name', 'ชื่อผู้ครอบครอง'))}</label>
        <input class="form-input" id="blmName" autocomplete="off" value="${_blmEsc(v.name || '')}">
      </div>

      <div class="blm-field blm-span2">
        <label class="form-label" for="blmNote">${_blmEsc(_blmT('blm.note', 'หมายเหตุ'))}</label>
        <textarea class="form-input" id="blmNote" rows="3">${_blmEsc(v.case_note || '')}</textarea>
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmBrand">${_blmEsc(_blmT('bl.brand', 'ยี่ห้อ'))}</label>
        <input class="form-input" id="blmBrand" autocomplete="off" value="${_blmEsc(v.brand || '')}">
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmVehicleType">${_blmEsc(_blmT('bl.vehicleType', 'ประเภทรถ'))}</label>
        <input class="form-input" id="blmVehicleType" autocomplete="off" value="${_blmEsc(v.vehicle_type || '')}">
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmVehicleColor">${_blmEsc(_blmT('bl.vehicleColor', 'สีรถ'))}</label>
        <input class="form-input" id="blmVehicleColor" autocomplete="off" value="${_blmEsc(v.vehicle_color || '')}">
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmPlateType">${_blmEsc(_blmT('bl.plateType', 'สีป้าย'))}</label>
        <input class="form-input" id="blmPlateType" autocomplete="off" value="${_blmEsc(v.plate_type || '')}">
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmCaseKind">${_blmEsc(_blmT('bl.caseKind', 'ประเภทคดี'))}</label>
        <input class="form-input" id="blmCaseKind" autocomplete="off" value="${_blmEsc(v.case_kind || '')}">
      </div>

      <div class="blm-field blm-span2">
        <label class="form-label">${_blmEsc(_blmT('bl.photoLabel', 'ภาพ'))}</label>
        <div class="blm-photo-row" style="display:flex;gap:8px;align-items:center">
          <input type="file" id="blmPhotoInput" accept="image/*" style="display:none">
          <button type="button" class="btn btn-ghost btn-sm" data-action="blmPickPhoto">${_blmEsc(_blmT('bl.uploadPhoto', 'เลือกรูป'))}</button>
          ${_blmPhotoB64 ? `<button type="button" class="btn btn-ghost btn-sm" data-action="blmClearPhoto">${_blmEsc(_blmT('bl.revert', 'ใช้ค่าต้นทาง'))}</button><span style="color:var(--text-secondary);font-size:12px">✓ ภาพเลือกแล้ว</span>` : ''}
        </div>
      </div>
    </div>

    <div class="blm-owned">
      <b>${_blmEsc(_blmT('blm.ownedTitle', 'สิ่งที่ระบบกำหนดให้เอง ไม่ต้องกรอก'))}</b>
      <span>${_blmEsc(_blmT('blm.ownedBody', 'ป้ายกำกับตอนแจ้งเตือน · การแจ้งเข้า LINE · ภาพอ้างอิง · การผูกกับตัวตนที่มีอยู่แล้ว — ทั้งหมดมาจากตัวเชื่อม (bridge) ตอนนำไปใช้'))}</span>
    </div>
  `;

  // Face form
  const faceForm = `
    <div class="blm-grid">
      <div class="blm-field">
        <label class="form-label" for="blmFaceName">${_blmEsc(_blmT('blm.faceName', 'ชื่อบุคคล'))} <span class="blm-req">*</span></label>
        <input class="form-input" id="blmFaceName" autocomplete="off" value="${_blmEsc(v.name || '')}">
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmNationalId">${_blmEsc(_blmT('blm.national_id', 'เลขบัตรประชาชน'))} <span class="blm-req">*</span></label>
        <input class="form-input" id="blmNationalId" autocomplete="off" value="${_blmEsc(v.national_id || '')}"
               placeholder="${_blmEsc(_blmT('blm.national_idPh', 'เช่น 1234567890120'))}">
        <div class="blm-hint">${_blmEsc(_blmT('blm.national_idHint', 'บัตรประชาชนไทย 13 หลัก'))}</div>
      </div>

      <div class="blm-field">
        <label class="form-label" for="blmFaceCaseRef">${_blmEsc(_blmT('blm.caseRef', 'เลขคดี / เลขอ้างอิง'))}</label>
        <input class="form-input" id="blmFaceCaseRef" autocomplete="off" value="${_blmEsc(v.case_ref || '')}">
      </div>

      <div class="blm-field blm-span2">
        <label class="form-label" for="blmFaceCaseNote">${_blmEsc(_blmT('blm.note', 'หมายเหตุ'))}</label>
        <textarea class="form-input" id="blmFaceCaseNote" rows="3">${_blmEsc(v.case_note || '')}</textarea>
      </div>
    </div>

    <div class="blm-owned">
      <b>${_blmEsc(_blmT('blm.faceTitle', 'ยังไม่เฝ้าระวัง'))}</b>
      <span>${_blmEsc(_blmT('blm.faceSub', 'บุคคลนี้จะเข้าฐานข้อมูลใบหน้า แต่ยังไม่มีการเฝ้าระวังจริง จนกว่าจะลงทะเบียนใบหน้าเข้าระบบของกล้อง'))}</span>
    </div>
  `;

  body.innerHTML = `
    <div class="blm-tabs">
      <button class="blm-tab${lprTab}" data-action="blmSwitchTab" data-tab="lpr">
        ${_blmEsc(_blmT('blm.tab.lpr', 'ป้ายทะเบียน'))}
      </button>
      <button class="blm-tab${faceTab}" data-action="blmSwitchTab" data-tab="face">
        ${_blmEsc(_blmT('blm.tab.face', 'ใบหน้า'))}
      </button>
    </div>

    <div class="blm-tab-content" id="blmLprContent"${_blmCurrentTab === 'lpr' ? '' : ' style="display:none"'}>
      ${lprForm}
    </div>

    <div class="blm-tab-content" id="blmFaceContent"${_blmCurrentTab === 'face' ? '' : ' style="display:none"'}>
      ${faceForm}
    </div>

    <div class="blm-actions">
      <button class="btn btn-secondary" data-action="blmClose">${_blmEsc(_blmT('common.cancel', 'ยกเลิก'))}</button>
      <button class="btn btn-primary" data-action="blmSave" id="blmSaveBtn">${_blmEsc(_blmT('blm.save', 'บันทึกเข้าฐานข้อมูล'))}</button>
    </div>

    <div id="blmResult"></div>`;
}

async function blmSave(btn) {
  const raw = blmReadForm();
  const payload = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v == null ? '' : String(v).trim()]));

  if (_blmCurrentTab === 'face') {
    if (!payload.name) { blmShowError(_blmT('blm.errNoName', 'ต้องระบุชื่อบุคคล')); return; }
    if (!payload.national_id) { blmShowError(_blmT('blm.errNoNationalId', 'ต้องระบุเลขบัตรประชาชน')); return; }
  } else {
    if (!payload.plate) { blmShowError(_blmT('blm.errNoPlate', 'ต้องระบุเลขทะเบียน')); return; }
  }

  if (btn) btn.disabled = true;
  try {
    const endpoint = _blmCurrentTab === 'face' ? '/api/blacklist/manual/face' : '/api/blacklist/manual/lpr';
    const r = await fetch(`${API}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) { blmShowError(j.error || `HTTP ${r.status}`); return; }
    blmShowResult(j, payload);
  } catch (e) {
    blmShowError(e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function blmShowError(msg) {
  const el = document.getElementById('blmResult');
  if (el) el.innerHTML = `<div class="blm-err">${_blmEsc(msg)}</div>`;
}

// The response is read off the bridge, not echoed from the form, so this can
// say what will actually happen rather than what was typed. Four things the
// operator has to see: the plate is NOT being watched yet, whether the sync
// is partial (won't remove plates held by other rules), another roster may
// outrank some of what they entered, and where to go to finish.
// For faces, the response is simpler — faces have no bridge, so they just
// confirm entry into the reservoir with "ยังไม่เฝ้า".
function blmShowResult(j, sent) {
  const el = document.getElementById('blmResult');
  if (!el) return;

  // Face response — simpler, no bridge
  if (_blmCurrentTab === 'face') {
    el.innerHTML = `
      <div class="blm-ok">
        <b>${_blmEsc(_blmT('blm.savedFaceTitle', 'บันทึกเข้าฐานข้อมูลแล้ว'))}</b>
        <span>${_blmEsc(j.created === false ? _blmT('blm.savedUpd', 'บุคคลนี้มีอยู่แล้ว — ถือเป็นการแก้ไข') : _blmT('blm.savedNew', 'สร้างรายการใหม่'))}</span>
      </div>

      <div class="blm-warn">
        <b>${_blmEsc(_blmT('blm.notWatchedTitle', 'ยังไม่ถูกเฝ้าระวัง'))}</b>
        <span>${_blmEsc(_blmT('blm.faceSub', 'บุคคลนี้จะเข้าฐานข้อมูลใบหน้า แต่ยังไม่มีการเฝ้าระวังจริง จนกว่าจะลงทะเบียนใบหน้าเข้าระบบของกล้อง'))}</span>
        <div class="blm-status">${_blmEsc(_blmT('blm.faceStatus', 'ยังไม่เฝ้า'))}</div>
      </div>

      <div class="blm-actions">
        <button class="btn btn-secondary" data-action="blmAnother">${_blmEsc(_blmT('blm.another', 'เพิ่มบุคคลอื่น'))}</button>
        <button class="btn btn-secondary" data-action="blmClose">${_blmEsc(_blmT('common.close', 'ปิด'))}</button>
      </div>`;
  } else {
    // LPR response — with bridge info
    const w = j.will_be || null;
    const rows = [];
    if (w) {
      const grp = _blmGroups.find((g) => g.id === w.group_id);
      rows.push([_blmT('blm.rGroup', 'กลุ่ม'), grp ? (grp.name || grp.id) : (w.group_id || _blmT('blm.noGroupShort', 'ไม่ระบุ'))]);
      rows.push([_blmT('blm.rRegion', 'จังหวัด'), w.region || '—']);
      rows.push([_blmT('blm.rLabel', 'ป้ายกำกับ'), w.label || '—']);
    }

    const overridden = Array.isArray(j.overridden) ? j.overridden : [];
    const alsoIn = Array.isArray(j.also_in) ? j.also_in : [];
    const partial = !!j.partial;

    el.innerHTML = `
      <div class="blm-ok">
        <b>${_blmEsc(_blmT('blm.savedTitle', 'บันทึกเข้าฐานข้อมูลแล้ว'))}</b>
        <span>${_blmEsc(j.created === false ? _blmT('blm.savedUpd', 'ทะเบียนนี้มีอยู่แล้ว — ถือเป็นการแก้ไข') : _blmT('blm.savedNew', 'สร้างรายการใหม่'))}</span>
      </div>

      <div class="blm-warn">
        <b>${_blmEsc(_blmT('blm.notWatchedTitle', 'ยังไม่ถูกเฝ้าระวัง'))}</b>
        <span>${_blmEsc(_blmT('blm.notWatchedBody', 'รายการเข้าไปรออยู่ในฐานข้อมูลแล้ว แต่จะเริ่มแจ้งเตือนก็ต่อเมื่อกด "ส่งเข้าเฝ้าระวัง" — เหมือนของที่นำเข้ามาทุกประการ'))}</span>
        ${partial ? `<div class="blm-partial"><b>${_blmWarnIcon()} ${_blmEsc(_blmT('blm.partial', 'การส่งจะยังคงรายการจากเซ็ตกฎเก่า'))}</b><br/>${_blmEsc(_blmT('blm.partialWarn', '* รายการจะเข้าไปในฐานข้อมูล แต่อาจไม่ถูกเฝ้าระวังหมดเพราะการตั้งค่ากฎที่เลือกจะเฝ้าเฉพาะส่วนของข้อมูล'))}</div>` : ''}
        <div class="blm-pending">${_blmEsc(_blmT('blm.pending', 'รอนำไปใช้'))}:
          <b>${Number(j.pending?.add || 0)}</b> ${_blmEsc(_blmT('blm.pendAdd', 'เพิ่ม'))} ·
          <b>${Number(j.pending?.update || 0)}</b> ${_blmEsc(_blmT('blm.pendUpd', 'แก้ไข'))}</div>
        <button class="btn btn-primary blm-gobridge" data-action="blmGoBridge">${_blmEsc(_blmT('blm.goBridge', 'ไปหน้าส่งเข้าเฝ้าระวัง'))}</button>
      </div>

      ${alsoIn.length ? `
      <div class="blm-note">
        <b>${_blmEsc(_blmT('blm.alsoInTitle', 'ทะเบียนนี้มีอยู่ในแหล่งอื่นด้วย'))}</b>
        <span>${_blmEsc(alsoIn.join(' · '))}</span>
        ${overridden.length ? `<div class="blm-over">${_blmEsc(_blmT('blm.overridden', 'ช่องที่แหล่งอื่นมีข้อมูลครบกว่า จึงใช้ของแหล่งนั้นแทนที่กรอกไว้'))}: <b>${_blmEsc(overridden.join(' · '))}</b></div>` : ''}
      </div>` : ''}

      ${rows.length ? `
      <div class="blm-willbe">
        <b>${_blmEsc(_blmT('blm.willBe', 'เมื่อนำไปใช้แล้วจะได้แบบนี้'))}</b>
        <table class="blm-table"><tbody>
          ${rows.map(([k, val]) => `<tr><th>${_blmEsc(k)}</th><td>${_blmEsc(val)}</td></tr>`).join('')}
        </tbody></table>
      </div>` : `
      <div class="blm-note"><span>${_blmEsc(_blmT('blm.noChange', 'รายการที่ใช้เฝ้าระวังอยู่ตรงกับข้อมูลนี้แล้ว ไม่มีอะไรต้องนำไปใช้'))}</span></div>`}

      <div class="blm-actions">
        <button class="btn btn-secondary" data-action="blmAnother">${_blmEsc(_blmT('blm.another', 'เพิ่มทะเบียนอื่น'))}</button>
        <button class="btn btn-secondary" data-action="blmClose">${_blmEsc(_blmT('common.close', 'ปิด'))}</button>
      </div>`;
  }

  // The form above stays filled so the operator can see what they submitted
  // next to what came back, but Save is spent — pressing it again would just
  // re-save the same row.
  const save = document.getElementById('blmSaveBtn');
  if (save) save.disabled = true;
}

function blmAnother() {
  blmRenderForm();
}

function blmSwitchTab(btn) {
  const tab = btn?.dataset?.tab;
  if (!tab) return;
  _blmCurrentTab = tab;
  blmRenderForm(blmReadForm());
}

function blmPickPhoto() {
  const input = document.getElementById('blmPhotoInput');
  if (!input) return;
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      // readAsDataURL gives "data:image/...;base64,..." — strip the prefix
      const dataUrl = e.target?.result || '';
      const b64 = dataUrl.replace(/^data:image\/[a-z+]+;base64,/i, '');
      _blmPhotoB64 = b64;
      blmRenderForm(blmReadForm());
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function blmClearPhoto() {
  _blmPhotoB64 = null;
  blmRenderForm(blmReadForm());
}

function blmGoBridge() {
  blmClose();
  if (typeof blOpenBridge === 'function') blOpenBridge();
}
