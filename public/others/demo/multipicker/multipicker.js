// ============================================================
// Vigil Platform — MultiPicker (reusable multi-select component) · DEMO
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Checkbox-dropdown multi-select backed by a hidden <select multiple> (source of
// truth → form-compatible). Declarative: any `.mp[data-mp]` wrapping a hidden
// <select multiple> is upgraded by MultiPicker.initAll().
//
// Reuse contract (prod port keeps this surface):
//   <div class="mp" data-mp-unit="กล้อง" data-mp-placeholder="ทั้งหมด" data-mp-search="ค้นหากล้อง...">
//     <select id="lprFilterCam" multiple>...</select>
//   </div>
//   MultiPicker.initAll();                 // upgrade all in DOM
//   MultiPicker.values('lprFilterCam');    // -> string[]  (read in your param builder)
//   root.addEventListener('mp:change', e => { /* e.detail = {id, values} */ });
(function () {
  'use strict';
  const MP = {};
  let _seq = 0;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const CARET = '<svg class="mp-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16" y2="16"/></svg>';

  // search box shows once a list is big enough that scrolling would be a chore.
  // Set low so nearly every picker is type-to-filter (avoids long scrolls).
  const SEARCH_THRESHOLD = 5;

  function build(root) {
    const sel = root.querySelector('select[multiple]');
    if (!sel || root._mpBuilt) return;
    root._mpBuilt = true;
    sel.style.display = 'none';
    sel.setAttribute('aria-hidden', 'true');

    const id = sel.id || ('mp' + (++_seq));
    const unit = root.dataset.mpUnit || 'รายการ';
    const placeholder = root.dataset.mpPlaceholder || 'ทั้งหมด';
    const searchPh = root.dataset.mpSearch || 'ค้นหา...';
    const opts = [...sel.options];
    const showSearch = opts.length >= SEARCH_THRESHOLD;
    // single-mode (data-mp-mode="single"): radio-style — one value, closes on pick,
    // no select-all/clear. Hidden <select multiple> stays (so 0 selected = "ทั้งหมด"
    // works uniformly); JS just enforces one selection. Keeps search + theme.
    const single = root.dataset.mpMode === 'single';
    if (single) root.classList.add('mp-single');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'mp-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `<span class="mp-summary"></span>${CARET}`;

    const pop = document.createElement('div');
    pop.className = 'mp-pop';
    pop.setAttribute('role', 'listbox');
    pop.innerHTML = `
      <div class="mp-sheet-head"><span class="mp-sheet-title">${esc(root.dataset.mpLabel || placeholder)}</span><button type="button" class="mp-done">เสร็จ</button></div>
      ${showSearch ? `<div class="mp-search">${SEARCH_SVG}<input type="text" class="mp-search-input" placeholder="${esc(searchPh)}" autocomplete="off"></div>` : ''}
      ${single ? '' : '<div class="mp-actions"><button type="button" class="mp-all">เลือกทั้งหมด</button><button type="button" class="mp-clear">ล้าง</button><span class="mp-count"></span></div>'}
      <div class="mp-list">${opts.map(o => `<label class="mp-row" data-val="${esc(o.value)}"><input type="checkbox" ${o.selected ? 'checked' : ''}><span class="mp-box"><svg class="mp-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span class="mp-row-lbl">${esc(o.textContent)}</span></label>`).join('')}<div class="mp-empty" hidden>ไม่พบรายการที่ค้นหา</div></div>`;

    const backdrop = document.createElement('div');
    backdrop.className = 'mp-backdrop';

    root.append(trigger, pop, backdrop);

    const summaryEl = trigger.querySelector('.mp-summary');
    const countEl = pop.querySelector('.mp-count');
    const listEl = pop.querySelector('.mp-list');
    const searchInput = pop.querySelector('.mp-search-input');

    function selectedOpts() { return [...sel.selectedOptions]; }
    function syncOption(val, on) { const o = opts.find(x => x.value === val); if (o) o.selected = on; }
    function visibleRows() { return [...listEl.querySelectorAll('.mp-row')].filter(r => r.style.display !== 'none'); }

    function updateSummary() {
      const s = selectedOpts();
      summaryEl.textContent = !s.length ? placeholder : (s.length === 1 ? s[0].textContent.trim() : `${s.length} ${unit}`);
      trigger.classList.toggle('mp-has', s.length > 0);
      if (countEl) countEl.textContent = s.length ? `${s.length} ${unit}` : '';
    }
    function emit() {
      updateSummary();
      root.dispatchEvent(new CustomEvent('mp:change', { bubbles: true, detail: { id, values: selectedOpts().map(o => o.value) } }));
    }
    function setOpen(open) {
      root.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (open && searchInput) setTimeout(() => searchInput.focus(), 30);
    }
    root._mpClose = () => setOpen(false);

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !root.classList.contains('open');
      closeAll();
      setOpen(willOpen);
    });
    pop.addEventListener('click', (e) => e.stopPropagation());
    backdrop.addEventListener('click', () => setOpen(false));
    pop.querySelector('.mp-done').addEventListener('click', () => setOpen(false));

    listEl.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type=checkbox]');
      if (!cb) return;
      const val = cb.closest('.mp-row').dataset.val;
      if (single) {
        // enforce one selection; clicking the selected one again clears (→ ทั้งหมด)
        opts.forEach(o => o.selected = (o.value === val) && cb.checked);
        listEl.querySelectorAll('input[type=checkbox]').forEach(x => { if (x !== cb) x.checked = false; });
        emit();
        if (cb.checked) setOpen(false);   // pick closes; clearing stays open
      } else {
        syncOption(val, cb.checked);
        emit();
      }
    });
    const allBtn = pop.querySelector('.mp-all');
    if (allBtn) allBtn.addEventListener('click', () => {
      visibleRows().forEach(r => { r.querySelector('input').checked = true; syncOption(r.dataset.val, true); });
      emit();
    });
    const clearBtn = pop.querySelector('.mp-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      opts.forEach(o => o.selected = false);
      listEl.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
      emit();
    });
    if (searchInput) {
      const emptyEl = listEl.querySelector('.mp-empty');
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        let shown = 0;
        listEl.querySelectorAll('.mp-row').forEach(r => {
          const hit = r.textContent.toLowerCase().includes(q);
          r.style.display = hit ? '' : 'none';
          if (hit) shown++;
        });
        if (emptyEl) emptyEl.hidden = shown > 0;
      });
    }

    updateSummary();
  }

  function closeAll() {
    document.querySelectorAll('.mp.open').forEach(r => r._mpClose && r._mpClose());
  }
  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  MP.initAll = (scope) => (scope || document).querySelectorAll('.mp').forEach(build);
  MP.values = (id) => { const s = document.getElementById(id); return s ? [...s.selectedOptions].map(o => o.value) : []; };
  window.MultiPicker = MP;
})();
