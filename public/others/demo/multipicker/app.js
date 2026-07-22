// Demo init (external — /others CSP is script-src 'self', inline <script> is blocked).
(function () {
  'use strict';
  MultiPicker.initAll();

  const out = document.getElementById('readout');
  function refresh() {
    const data = {
      cameras: MultiPicker.values('fCam'),
      provinces: MultiPicker.values('fProv'),
      vehicleTypes: MultiPicker.values('fType'),
      mainCamera_single: MultiPicker.values('fCamSingle'),
      sortBy_single: MultiPicker.values('fSort'),
    };
    // empty array = "ทั้งหมด" (no filter) — same convention as the single-select '' = all
    if (out) out.textContent = JSON.stringify(data, null, 2);
  }
  document.addEventListener('mp:change', refresh);
  refresh();

  // Mobile preview = force-mobile class (a real iframe is blocked by /others'
  // frame-ancestors 'none'). Mirrors the @media bottom-sheet at phone width.
  const btn = document.getElementById('mobBtn'), cap = document.getElementById('mobCap');
  if (btn) btn.addEventListener('click', () => {
    const on = document.body.classList.toggle('force-mobile');
    btn.classList.toggle('on', on);
    if (cap) cap.hidden = !on;
    document.querySelectorAll('.mp.open').forEach(r => r._mpClose && r._mpClose());
  });
})();
