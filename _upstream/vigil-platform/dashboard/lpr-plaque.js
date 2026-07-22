// ============================================================
// Vigil Platform — Shared LPR Plate Plaque Renderer
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Synthetic plate plaque (no real crop) used on grids/feeds where uniform,
// theme-consistent plates read better than varied camera crops.
// Plate background colors follow กรมขนส่งทางบก (DLT) — these are real-world
// fixed values (like a physical plate), intentionally NOT theme tokens.
// Single source for: Events feed, LPR page. Modal/detail may pass big+showProv.
(function () {
  // DLT plate background → {bg, ink, border}
  function plateColorStyle(pc) {
    switch (String(pc || '').toLowerCase()) {
      case 'white':  return { bg: '#f3f4ef', ink: '#16181d', border: '' }; // ส่วนบุคคล
      case 'yellow': return { bg: '#f2c200', ink: '#16181d', border: '' }; // รับจ้าง
      case 'green':  return { bg: '#1f7a3d', ink: '#ffffff', border: '' }; // บริการ
      case 'red':    return { bg: '#e2231a', ink: '#111111', border: '#111111' }; // ป้ายแดง (รถใหม่/ป้ายทดลอง): พื้นแดง ตัว+กรอบดำ
      // ป้ายน้ำเงิน/ดำ/ส้ม/ประมูล — สีโดยประมาณ (ปรับให้ตรง DLT เป๊ะได้ภายหลัง)
      case 'blue':   return { bg: '#1565c0', ink: '#ffffff', border: '' }; // ป้ายน้ำเงิน
      case 'black':  return { bg: '#1a1a1a', ink: '#ffffff', border: '' }; // ป้ายดำ
      case 'orange': return { bg: '#e67e00', ink: '#16181d', border: '' }; // ป้ายส้ม (รถแทรกเตอร์/เกษตร)
      case 'colorful': return { bg: 'linear-gradient(135deg,#e53935,#fb8c00,#fdd835,#43a047,#1e88e5)', ink: '#ffffff', border: '' }; // ป้ายประมูล/กราฟิก
      default:       return { bg: '#3a3f4b', ink: '#cfd3dc', border: '' }; // unknown / null
    }
  }
  // Motorcycle/3-wheel plates are square 2-line; others wide single-line.
  function isMoto(vt) { return vt === 'twoWheelVehicle' || vt === 'threeWheelVehicle'; }

  // Thai plate = [optional 1-2 leading digits][Thai/Latin letters][trailing number].
  // The leading digit is part of the prefix, NOT the number:
  //   "7กธ5746" → prefix "7กธ", number "5746"   (was wrongly "กธ" / "75746")
  //   "1กก1234" → "1กก" / "1234"   ·   "กธ5746" → "กธ" / "5746"
  function parsePlate(plate) {
    const p = String(plate || '').trim();
    const m = p.match(/^(\d{0,2})\s*([฀-๿A-Za-z]+)\s*(\d+)$/);
    if (m) {
      const prefix = (m[1] || '') + m[2];
      return { prefix, number: m[3], letters: m[2], digits: m[3] };
    }
    const letters = (p.match(/[฀-๿A-Za-z]+/g) || []).join(' ');
    const digits  = (p.match(/[0-9]+/g) || []).join('');
    return { prefix: letters, number: digits, letters, digits };
  }

  // No-read: camera OCR failed → plate stored as 'unknown' (or empty). DECISION #208
  // (revised 2026-06-30): display "ไม่ระบุ" — a wall of "อ่านไม่ออก" cards read like
  // the system was failing repeatedly (poor look for inspecting officials). "ไม่ระบุ"
  // is neutral/professional; the no-read COUNT still serves as the camera-health KPI.
  function isNoRead(plate) {
    const p = String(plate || '').trim().toLowerCase();
    return !p || p === 'unknown';
  }
  function noReadText() {
    return (typeof I18N !== 'undefined' && I18N.t) ? I18N.t('lpr.noRead', 'ไม่ระบุ') : 'ไม่ระบุ';
  }
  // Single source for displaying a plate string anywhere (card, modal, feed, plaque).
  function plateLabel(plate) { return isNoRead(plate) ? noReadText() : String(plate); }

  // lprPlaque(plate, { vehicleType, plateColor, region, big, showProv }) → HTML string
  function plaque(plate, opts) {
    opts = opts || {};
    if (isNoRead(plate)) {
      const moto = isMoto(opts.vehicleType);
      const cls = `lpr-plaque noread${moto ? ' moto' : ''}${opts.feed ? ' feed' : ''}${opts.big ? ' big' : ''}`;
      return `<span class="${cls}">${noReadText()}</span>`;
    }
    const { prefix, number } = parsePlate(plate);
    const s = plateColorStyle(opts.plateColor);
    const brd = s.border ? `;border-color:${s.border};border-width:2px` : '';
    const sty = `background:${s.bg};color:${s.ink}${brd}`;
    const moto = isMoto(opts.vehicleType);
    const withProv = !!(opts.showProv && opts.region && opts.region !== 'ไม่ทราบ');
    const cls = `lpr-plaque${moto ? ' moto' : ''}${opts.feed ? ' feed' : ''}${opts.big ? ' big' : ''}${withProv ? ' withprov' : ''}`;
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (x => x);
    const prov = withProv ? `<span class="pl-prov-name">${esc(opts.region)}</span>` : '';
    // Real Thai motorcycle plate stacks: prefix (top) / province (middle) / number (bottom)
    if (moto)
      return `<span class="${cls}" style="${sty}"><span class="pl-prov">${esc(prefix)}</span>${prov}<span class="pl-num">${esc(number)}</span></span>`;
    return withProv
      ? `<span class="${cls}" style="${sty}"><span class="pl-mark">${esc(prefix)} ${esc(number)}</span>${prov}</span>`
      : `<span class="${cls}" style="${sty}">${esc(prefix)} ${esc(number)}</span>`;
  }

  // Vehicle silhouette (stroke = currentColor) by vehicle_type — the full-scene
  // fallback when a snapshot image is unavailable (retention-pruned or missing).
  // Single source so demo + prod can't drift.
  const VEH_SVG = {
    car:    '<path d="M12 28l4-9a4 4 0 0 1 4-2h20a4 4 0 0 1 3 2l5 9"/><path d="M8 28h6m8 0h12m8 0h6"/><path d="M20 17l-2 7M38 17l2 7"/><circle cx="18" cy="28" r="4"/><circle cx="44" cy="28" r="4"/>',
    moto:   '<circle cx="14" cy="27" r="6"/><circle cx="48" cy="27" r="6"/><path d="M14 27l9-9h7M20 18h10l6 9M30 18l4-4h6"/>',
    tuk:    '<path d="M16 26v-9a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v9"/><path d="M13 18h36"/><circle cx="22" cy="29" r="3.5"/><circle cx="40" cy="29" r="3.5"/>',
    van:    '<path d="M8 26V16a2 2 0 0 1 2-2h26l10 9v3"/><path d="M36 14v9h10"/><path d="M8 26h6m8 0h12m8 0h4"/><circle cx="18" cy="27" r="4"/><circle cx="42" cy="27" r="4"/>',
    pickup: '<path d="M7 26l3-8a2 2 0 0 1 2-1h11l3 6h27v4"/><path d="M26 17v6"/><path d="M7 26h6m8 0h16m8 0h6"/><circle cx="17" cy="27" r="4"/><circle cx="45" cy="27" r="4"/>',
    truck:  '<path d="M6 25V13h22v12M28 25V9h20a3 3 0 0 1 3 3v13"/><path d="M28 14h23"/><path d="M6 25h6m8 0h18m8 0h5"/><circle cx="15" cy="28" r="3.5"/><circle cx="44" cy="28" r="3.5"/>',
    bus:    '<path d="M9 27V14a3 3 0 0 1 3-3h36a3 3 0 0 1 3 3v13"/><path d="M9 19h42M21 11v8M33 11v8"/><circle cx="18" cy="29" r="3"/><circle cx="42" cy="29" r="3"/>',
    person: '<circle cx="32" cy="11" r="5"/><path d="M32 16v13M32 29l-7 9M32 29l7 9M23 22h18"/>',
  };
  function vehKind(vt) {
    if (vt === 'twoWheelVehicle')   return 'moto';
    if (vt === 'threeWheelVehicle') return 'tuk';
    if (vt === 'van')               return 'van';
    if (vt === 'pickupTruck')       return 'pickup';
    if (vt === 'truck')             return 'truck';
    if (vt === 'largeBus')          return 'bus';
    if (vt === 'pedestrian')        return 'person';
    return 'car'; // vehicle / SUVMPV / buggy / unknown
  }
  function vehicleSvg(vehicleType) {
    return `<svg class="lpr-veh" viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VEH_SVG[vehKind(vehicleType)] || VEH_SVG.car}</svg>`;
  }

  window.lprPlaque    = plaque;
  window.lprIsMoto    = isMoto;
  window.lprIsNoRead  = isNoRead;
  window.lprPlateLabel = plateLabel;
  window.lprVehicleSvg = vehicleSvg;
})();
