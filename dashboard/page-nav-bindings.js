// ============================================================
// Vigil Platform — Nav Bindings
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ============================================================
// Static nav-chrome handler bindings (Phase 2 of onclick= → addEventListener migration)
// Replaces onclick= attrs removed from index.html for the sidebar nav + header chrome.
// Called before bootstrapApp so sidebar/hamburger work even before auth resolves.
// ============================================================
function _bindNavChrome() {
  // Main navigation — event delegation on <nav class="nav">
  document.querySelector('.nav')?.addEventListener('click', function(e) {
    const item = e.target.closest('.nav-item[data-page]');
    if (item) showPage(item.dataset.page, item);
  });

  // Sidebar chrome
  document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebar);
  document.getElementById('hamburgerBtn')?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebarCollapseBtn')?.addEventListener('click', toggleSidebarCollapsed);

  // User menu
  document.getElementById('userMenuBtn')?.addEventListener('click', function(e) { toggleUserDropdown(e); if (typeof _reflectNotifyPrefs === 'function') _reflectNotifyPrefs(); });
  document.getElementById('ddSettings')?.addEventListener('click', function() {
    showPage('settings', document.querySelector('.nav-item[data-page=settings]'));
  });
  document.getElementById('ddChangePw')?.addEventListener('click', openChangePassword);
  document.getElementById('ddAbout')?.addEventListener('click', openAboutModal);
  document.getElementById('ddLangTh')?.addEventListener('click', function() { I18N.setLang('th'); });
  document.getElementById('ddLangEn')?.addEventListener('click', function() { I18N.setLang('en'); });
  document.getElementById('ddThemeDark')?.addEventListener('click', function() { setTheme('dark'); });
  document.getElementById('ddThemeLight')?.addEventListener('click', function() { setTheme('light'); });
  document.getElementById('ddLogout')?.addEventListener('click', doLogout);

  // เมนูที่จัดกลุ่มแล้ว (decision #245) — navGroupToggle เดินผ่าน [data-action]
  // dispatcher กลางอยู่แล้ว (click) ผูกเพิ่มแค่ keydown ให้กด Enter/Space ได้
  // เพราะหัวกลุ่มมี role="button" (nav-item เดิมไม่มี tabindex เลยไม่ต้องทำ
  // ส่วนนี้ — หัวกลุ่มเป็นของใหม่ เลยทำให้ครบตั้งแต่แรก)
  document.querySelector('.nav')?.addEventListener('keydown', function(e) {
    const head = e.target.closest('.nav-group-head');
    if (head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navGroupToggle(head); }
  });
  _navGroupApplyOpen();
}

// ── เมนูที่จัดกลุ่มแล้ว (decision #245) ──────────────────────────────
// เก็บเฉพาะกลุ่มที่ผู้ใช้ "เปิดเอง" ไว้ใน localStorage — กลุ่มที่มีหน้า active
// อยู่เปิดค้างเสมอไม่ว่าจะเคยกดหรือไม่ (คำนวณสด ไม่ persist) ส่วนกลุ่มอื่น
// ปิดเป็นค่าเริ่มต้น (ต่างจาก nav_hidden_pages ที่เก็บ "สิ่งที่ซ่อน" เพราะเรื่องนี้
// เป็นการจำ preference การพับ/ขยาย ไม่ใช่การกันเมนูใหม่หายไปเงียบๆ)
const NAV_GROUPS_LS_KEY = 'vigilNavOpenGroups';
function _navGroupsGetStored() {
  try { return new Set(JSON.parse(localStorage.getItem(NAV_GROUPS_LS_KEY) || '[]')); }
  catch { return new Set(); }
}
function _navGroupsSetStored(set) {
  try { localStorage.setItem(NAV_GROUPS_LS_KEY, JSON.stringify([...set])); } catch {}
}
function _navGroupApplyOpen() {
  const stored = _navGroupsGetStored();
  const activeGroup = document.querySelector('.nav-item.active')?.closest('.nav-group');
  document.querySelectorAll('.nav-group').forEach(g => {
    const open = stored.has(g.dataset.group) || g === activeGroup;
    g.classList.toggle('open', open);
    const head = g.querySelector('.nav-group-head');
    if (head) head.setAttribute('aria-expanded', String(open));
  });
}
// เรียกทุกครั้งที่ showPage() เปลี่ยนหน้า — บังคับให้กลุ่มของหน้า active เปิดอยู่
// เสมอ โดยไม่ไปรบกวนกลุ่มอื่นที่ผู้ใช้เปิด/ปิดไว้เอง
function _navGroupEnsureOpen() {
  const activeGroup = document.querySelector('.nav-item.active')?.closest('.nav-group');
  if (!activeGroup || activeGroup.classList.contains('open')) return;
  activeGroup.classList.add('open');
  activeGroup.querySelector('.nav-group-head')?.setAttribute('aria-expanded', 'true');
}
function navGroupToggle(el) {
  const g = el.closest('.nav-group');
  if (!g) return;
  const id = g.dataset.group;
  const nowOpen = !g.classList.contains('open');
  const stored = _navGroupsGetStored();
  if (nowOpen) stored.add(id); else stored.delete(id);
  _navGroupsSetStored(stored);
  g.classList.toggle('open', nowOpen);
  el.setAttribute('aria-expanded', String(nowOpen));
}
// badge รวมของกลุ่ม — เรียกจาก renderNavBadge() ทุกครั้งที่ badge ลูกเปลี่ยน
// ประมาณค่าจาก textContent ที่ตัด "99+" ไว้แล้ว (พอสำหรับ nav badge ไม่ต้องเป๊ะ)
function _navGroupUpdateBadge(childBadgeEl) {
  const grp = childBadgeEl.closest('.nav-group');
  if (!grp) return;
  const gb = grp.querySelector('.nav-group-badge');
  if (!gb) return;
  const sum = [...grp.querySelectorAll('.nav-badge')].reduce((a, b) => {
    if (!b.classList.contains('show')) return a;
    const n = parseInt(b.textContent, 10);
    return a + (Number.isFinite(n) ? n : 0);
  }, 0);
  if (sum > 0) { gb.textContent = sum > 99 ? '99+' : String(sum); gb.classList.add('show'); }
  else gb.classList.remove('show');
}

function _bindStaticHandlers() {
  // evt defaults to 'click'; checkboxes pass 'change' so keyboard toggling works
  // too, which a click listener alone would miss.
  function bind(id, fn, evt = 'click') { document.getElementById(id)?.addEventListener(evt, fn); }
  function delegate(id, sel, fn) {
    document.getElementById(id)?.addEventListener('click', function(e) {
      const el = e.target.closest(sel);
      if (el && this.contains(el)) fn(e, el);
    });
  }
  function backdropClose(id, fn) {
    document.getElementById(id)?.addEventListener('click', function(e) { if (e.target === this) fn(); });
  }

  // ── Summary ────────────────────────────────────────────────────
  bind('smbHeatToggle',    toggleSummaryHeatmap);
  bind('smbViewallHistory', () => showPage('history', document.querySelector('.nav-item[data-page=history]')));
  bind('smbViewallCameras', () => showPage('cameras', document.querySelector('.nav-item[data-page=cameras]')));

  // ── Events ─────────────────────────────────────────────────────
  bind('evtClearDrillBtn', clearDrillFilter);
  bind('evtSearchBtn',     () => loadEvents(1));
  bind('evtResetBtn',      resetEventFilters);
  bind('evtExportCsvBtn',  exportEventsCsv);
  bind('evtPauseBtn',      toggleEventsPause);
  bind('evtIncludeSpecialized', toggleEventsSpecialized, 'change');
  delegate('evtRangeBanner', 'button[data-range-days]', (e, el) => evtSetRangeDays(parseInt(el.dataset.rangeDays, 10)));
  delegate('evtTabBar', '.tab[data-tab]', (e, el) => setEventTab(el.dataset.tab, el));

  // ── Snapshots ──────────────────────────────────────────────────
  bind('snapSearchBtn', () => loadSnapshots(1));
  bind('snapResetBtn',  resetSnapFilters);
  bind('snapRefreshBtn', () => loadSnapshots(_snapPage));
  bind('snapGroupBurst', toggleSnapGroupBurst, 'change');
  delegate('snapViewBar', '.tab[data-view]', (e, el) => setSnapView(el.dataset.view, el));

  // ── Media ──────────────────────────────────────────────────────
  bind('mediaSearchBtn',  () => loadMedia(1));
  bind('mediaResetBtn',   resetMediaFilters);
  backdropClose('mediaModal', closeMediaModal);
  bind('mediaModalClose', closeMediaModal);

  // ── ค้นหาอัจฉริยะ · โมดัลภาพใหญ่ ───────────────────────────────
  bind('ssxModalClose', () => ssxCloseModal());
  backdropClose('ssxModal', () => ssxCloseModal());

  // ── HC2 · ค้นใบหน้าด้วยรูป ────────────────────────────────────
  // input[type=file] ต้องผูกด้วย change ไม่ใช่ click และ CSP บล็อก inline handler
  document.getElementById('page-hcp-face-search')?.addEventListener('change', function (e) {
    const el = e.target.closest('input[data-input="hfsFile"]');
    if (el) hfsPickFile(el);
  });

  // ── Faces ──────────────────────────────────────────────────────
  bind('faceSearchBtn',  loadFaces);
  bind('faceResetBtn',   resetFaceFilters);
  backdropClose('faceModal', closeFaceModal);
  bind('faceModalClose', closeFaceModal);

  // ── Face Recognition Matches ────────────────────────────────
  // Recog feed quick search (demo parity) — debounced live input
  const _fmSearchEl = document.getElementById('fmatchSearch');
  if (_fmSearchEl) { let _fmT; _fmSearchEl.addEventListener('input', () => { clearTimeout(_fmT); _fmT = setTimeout(() => fmatchSearch(_fmSearchEl.value), 250); }); }
  backdropClose('faceMatchModal', closeFaceMatchModal);
  bind('faceMatchModalClose', closeFaceMatchModal);

  // ── Face Recognition Tabs ────────────────────────────────
  bind('faceTabOverview', () => _switchFaceTab('overview'));
  bind('faceTabLive',     () => _switchFaceTab('live'));
  bind('faceTabRecog',    () => _switchFaceTab('recog'));
  bind('faceTabSearch',   () => _switchFaceTab('search'));
  bind('faceTabLab',      () => _switchFaceTab('lab'));
  bind('afbDetailModalClose', afbCloseDetail);
  bind('faceTabSettings', () => _switchFaceTab('settings'));
  bind('faceSearchBtn2',  _loadFaceTab);
  bind('faceResetBtn2',   resetFaceTab2);

  // ── LPR ────────────────────────────────────────────────────────
  delegate('lprTabBar', '.tab[data-tab]', (e, el) => _switchLprTab(el.dataset.tab));

  // ── Settings › LPR System (tabs + watchlist edit modal) ─────────
  delegate('lprSetTabBar', '.tab[data-tab]', (e, el) => _switchLprSetTab(el.dataset.tab));
  delegate('wlSubTabBar',  'button[data-tab]', (e, el) => _switchWlSetTab(el.dataset.tab));
  delegate('afbRosterSubTabBar', 'button[data-tab]', (e, el) => _afbSwitchRosterTab(el.dataset.tab));
  backdropClose('wlEditModal', wlEditClose);

  // ── Appearance ─────────────────────────────────────────────────
  delegate('appTabBar',   '.tab[data-tab]',       (e, el) => setAppTab(el.dataset.tab, el));
  delegate('appRangeBar', '.per-btn[data-range]', (e, el) => setAppRange(el.dataset.range, el));
  bind('appSearchBtn', () => loadAppearanceSearch(1));

  // ── ช่วงเวลาด่วน (Quick Range) — 4 หน้าใช้ชุดเดียวกันจาก dashboard.js ─────────
  // กดแล้วเติมช่องวันที่ + ค้นหาให้เลย ไม่ต้องกดค้นหาซ้ำ (เจ้าของสั่ง 2026-08-21)
  // หน้า LPR คงปุ่ม "24 ชม." เดิมไว้ด้วย ผู้ใช้เดิมจึงไม่เสียปุ่มที่ใช้ประจำ
  if (typeof initQuickRange === 'function') {
    initQuickRange('appQuickRange',  'appFilterFrom',  'appFilterTo',  () => loadAppearanceSearch(1));
    initQuickRange('faceQuickRange', 'faceFilterFrom', 'faceFilterTo', () => loadFaces());
    // แท็บ "ค้นหา" ของหน้าข้อมูลใบหน้า (page-face-matches) ใช้ช่องคนละชุด ลงท้าย 2
    // — รอบแรกใส่ผิดหน้าไป ใส่ให้ page-faces ซึ่งเป็นหน้าเก่าที่เจ้าของไม่ได้เปิด
    initQuickRange('faceQuickRange2', 'faceFilterFrom2', 'faceFilterTo2', () => _loadFaceTab());
    initQuickRange('snapQuickRange', 'snapFilterFrom', 'snapFilterTo', () => loadSnapshots(1));
    initQuickRange('lprQuickRange',  'lprFilterFrom',  'lprFilterTo',  () => loadLpr(1),
      ['hour', 'h24', 'dawn', 'morning', 'afternoon', 'evening', 'night',
       'yesterday', 'week', 'month']);
  }
  bind('appTimelineBtn', loadAppearanceTimeline);
  bind('appResetBtn',  resetAppearanceFilters);
  bind('appForensicToggle', toggleAppForensic);
  bind('appPersonModalClose', appClosePerson);
  bind('appPersonModal', (e) => { if (e.target.id === 'appPersonModal') appClosePerson(); });
  bind('appModalFollow', () => { if (_appCurrentPerson) { appClosePerson(); loadSimilarTimeline(parseInt(_appCurrentPerson.id, 10)); } });
  bind('appModalExample', () => { if (_appCurrentPerson) appSearchByExample(_appCurrentPerson); });
  bind('appModalFace', () => { if (_appCurrentPerson) appOpenFace(_appCurrentPerson); });
  bind('btnClearRoute', clearTimelineRoute);

  // ── Map ────────────────────────────────────────────────────────
  document.getElementById('selMapPulseDebounce')?.addEventListener('change', function() { setMapPulseDebounce(this.value); });
  bind('mapWallExit',       toggleWallMode);
  bind('togHeat',           function() { toggleMapLayer('heat', this); });
  bind('togCams',           function() { toggleMapLayer('cams', this); });
  bind('btnMapPulse',       toggleMapPulse);
  bind('btnMapFace',        toggleMapFaceOverlay);
  bind('btnMapLpr',         toggleMapLprOverlay);
  bind('btnMapMute',        toggleMapMuteAll);
  bind('mapRecenterBtn',    recenterMap);
  bind('btnMapMore',        toggleMapSecondary);
  bind('togStyle',          toggleMapStyle);
  bind('togProvider',       toggleMapProvider);
  bind('togSource',         toggleMapSource);
  bind('btnWallMode',       toggleWallMode);
  bind('mapDrawerBackdrop', toggleMapDrawer);

  // ── Stats ──────────────────────────────────────────────────────
  // (stats redesign 2026-08) ปุ่มชุดหน้า stats เดิมถูกถอด — หน้าใหม่ผูก event เอง

  // ── Reports ────────────────────────────────────────────────────
  bind('rbLoadBtn',        updateReportPreview);
  bind('rbDownload',       downloadPDF);
  document.getElementById('rbFmtBar')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rfmt]');
    if (b) _rbSetFmt(b.dataset.rfmt);
  });
  // ตัวเลือก "ค่าที่แสดงในสรุปภาพรวม" + "การเรียงลำดับหมวดหมู่" — เรนเดอร์ preview ใหม่ทันที
  if (typeof _rptBindOptionBars === 'function') _rptBindOptionBars();
  bind('hrPreviewBtn',     previewHealthReport);
  bind('hrDownload',       _hrDownloadByFmt);
  bind('hrSendNowBtn',     sendHealthReportNow);
  bind('rptHistRefresh',   loadRptHistory);
  bind('rptHistExportCsv', exportReportHistoryCsv);

  // ── History srail ──────────────────────────────────────────────
  delegate('historySrail', '.srail-item[data-hist]', (e, el) => historyNav(el.dataset.hist, el));
  bind('historyBackBtn', historyBack);
  bind('alRefreshBtn',   loadAlertLogs);
  bind('alClearOldBtn',  clearOldLogs);
  bind('rhExportCsvBtn', exportReportHistoryCsv);
  delegate('cameraStatusTabBar', '.tab[data-camera-status-tab]',
    (e, el) => setCameraStatusTab(el.dataset.cameraStatusTab, el));
  bind('statusLogResetBtn',   resetStatusLogFilters);
  bind('statusLogRefreshBtn', () => loadStatusLog(1));
  bind('imgQualResetBtn',     resetImageQualityFilters);
  bind('imgQualRefreshBtn',   () => loadImageQualityLog(1));
  bind('auditRefreshBtn',     loadAuditLog);
  bind('healthRefreshBtn',    loadHealth);
  delegate('healthTabBar', '.tab[data-tab]',   (e, el) => switchHealthTab(el.dataset.tab));
  delegate('perfRangeBar', '.tab[data-range]', (e, el) => setPerfRange(el.dataset.range, el));

  // ── Settings srail ─────────────────────────────────────────────
  delegate('settingsSrail', '.srail-item[data-sec]', (e, el) => settingsNav(el.dataset.sec, el));
  bind('settingsBackBtn', settingsBack);

  // ── Camera form ────────────────────────────────────────────────
  bind('camSubTabCameras',       function() { camerasSubTab('cameras', this); });
  bind('camSubTabGroups',        function() { camerasSubTab('groups',  this); });
  bind('camSubTabCsv',           function() { camerasSubTab('csv',     this); });
  bind('openCameraFormBtn',      openCameraForm);
  bind('detectModelsBtn',        detectCameraModels);
  bind('openNvrScanBtn',         openNvrScan);
  bind('nvrScanClose',           closeNvrScan);
  bind('nvrScanBtn',             nvrScan);
  bind('nvrCreateBtn',           nvrCreate);
  bind('nvrPassToggle',          toggleNvrPass);
  // CSV bulk import (Phase 2)
  bind('openCsvImportBtn',       function() { camerasSubTab('csv', document.getElementById('camSubTabCsv')); });
  bind('csvDownloadTplBtn',      downloadCsvTemplate);
  bind('csvImportBtn',           csvDoImport);
  document.getElementById('csvFile')?.addEventListener('change', onCsvFile);
  // No backdrop-close: this form holds typed NVR creds — an accidental outside
  // click must not discard it. Close only via the × button.
  bind('frmCamPassToggle',       toggleCamPassVisibility);
  bind('frmTestConnBtn',         testCameraConnection);
  bind('frmFwdTestBtn',          testForwardConnection);
  bind('camUseLocationBtn',      camFormUseMyLocation);
  bind('frmCamProbeBtn',         probeCameraSnapshot);
  bind('frmSnapPreviewBtn',      previewCameraSnapshot);
  bind('saveCamOfflineAlertBtn', saveCameraOfflineAlert);
  bind('mqttCopyUserBtn',        () => copyMqttCreds('user'));
  bind('mqttPassToggleBtn',      toggleMqttPassVisibility);
  bind('mqttCopyPassBtn',        () => copyMqttCreds('pass'));
  bind('mqttRegenBtn',           regenerateMqttPassword);
  bind('mqttCopyRegenPassBtn',   copyMqttRegenPass);
  bind('mqttPushBtn',            pushCameraMqtt);
  bind('frmFacePushGenBtn',      generateFacePushToken);
  bind('frmFacePushCopyBtn',     copyFacePushUrl);
  bind('frmFacePushCheckBtn',    () => checkAlarmServer('face'));
  bind('frmLprPushGenBtn',       generateLprPushToken);
  bind('frmLprPushCopyBtn',      copyLprPushUrl);
  bind('frmLprPushCheckBtn',     () => checkAlarmServer('lpr'));
  bind('frmHhBackupBtn',         httpHostBackup);
  bind('frmHhSetBtn',            httpHostSet);
  bind('frmHhRestoreBtn',        httpHostRestore);
  bind('frmMqttBrokerTestBtn',   checkMqttBroker);
  bind('saveCameraBtn',          saveCamera);
  bind('closeCameraFormBtn',     closeCameraForm);
  bind('camEditBackBtn',         closeCameraForm); // CS4: full-page editor back
  bind('newGroupBtn',            newGroup);
  // CS4: section nav jump + scrollspy (scroller is .content)
  document.getElementById('camEditNav')?.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    e.preventDefault();
    camEditNavJump(a.getAttribute('href').slice(1));
  });
  document.querySelector('.content')?.addEventListener('scroll', camEditScrollSpy, { passive: true });
  document.addEventListener('keydown', (e) => { // CS4: Esc closes the editor (matches demo)
    if (e.key === 'Escape' && document.getElementById('ssxModal')?.style.display === 'flex') ssxCloseModal();
    if (e.key === 'Escape' && document.getElementById('set-cameras')?.classList.contains('cam-editing')) closeCameraForm();
    // ฟอร์มผู้ใช้เป็น full page แล้ว (2026-08-12) — Escape ต้องปิดได้เหมือนกัน
    // ไม่งั้นคนที่ชินกับ modal เดิมจะกด Escape แล้วไม่มีอะไรเกิดขึ้น
    if (e.key === 'Escape' && document.getElementById('set-users')?.classList.contains('user-editing')) closeUserEditor();
    if (e.key === 'Escape' && document.getElementById('appPersonModal')?.style.display === 'flex') appClosePerson();
  });

  // RF3 — watchlist ref-image drag&drop (CSP: addEventListener, not inline ondrop).
  // #wlDrop is static in #set-lpr. Click → hidden file input; drop → _wlUploadFile.
  const wlDrop = document.getElementById('wlDrop');
  if (wlDrop) {
    wlDrop.addEventListener('click', (e) => { if (!e.target.closest('.wl-drop-clear')) document.getElementById('wlImg')?.click(); });
    wlDrop.addEventListener('dragover', (e) => { e.preventDefault(); wlDrop.classList.add('dragover'); });
    wlDrop.addEventListener('dragleave', () => wlDrop.classList.remove('dragover'));
    wlDrop.addEventListener('drop', (e) => {
      e.preventDefault(); wlDrop.classList.remove('dragover');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && typeof _wlUploadFile === 'function') _wlUploadFile(f);
    });
  }

  // Lab Test roster ref-image drag&drop — same pattern as #wlDrop above.
  // #afbDrop is static in #faceTabPanelLab (index.html), so this binding
  // survives afbRenderRoster()'s innerHTML rewrites of the sibling list area.
  const afbDrop = document.getElementById('afbDrop');
  if (afbDrop) {
    afbDrop.addEventListener('click', (e) => { if (!e.target.closest('.wl-drop-clear')) document.getElementById('afbAddImg')?.click(); });
    afbDrop.addEventListener('dragover', (e) => { e.preventDefault(); afbDrop.classList.add('dragover'); });
    afbDrop.addEventListener('dragleave', () => afbDrop.classList.remove('dragover'));
    afbDrop.addEventListener('drop', (e) => {
      e.preventDefault(); afbDrop.classList.remove('dragover');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && typeof _afbUploadFile === 'function') _afbUploadFile(f);
    });
  }

  // ── Users / Categories / Alerts ────────────────────────────────
  bind('openUserEditorBtn',       () => openUserEditor());
  bind('openCategoryEditorBtn',   () => openCategoryEditor());
  bind('catDeleteAllBtn',         () => catDeleteAll());
  bind('alertTabRules',           () => switchAlertTab('rules'));
  bind('alertTabConfig',          () => switchAlertTab('config'));
  bind('alertTabTelegram',        () => switchAlertTab('telegram'));
  bind('alertTabEdge',            () => switchAlertTab('edge'));
  bind('alertTabHcpface',         () => switchAlertTab('hcpface'));
  bind('alertTabAuraface',        () => switchAlertTab('auraface'));
  bind('alertTabLpr',             () => switchAlertTab('lpr'));
  bind('alertTabGsalarm',         () => switchAlertTab('gsalarm'));
  bind('alertTabCommands',        () => switchAlertTab('commands'));
  bind('alertTabTgcommands',      () => switchAlertTab('tgcommands'));
  bind('saveEdgeAlertBtn',        saveEdgeAlert);
  bind('openRuleEditorBtn',       () => openRuleEditor());
  bind('saveLineConfigBtn',       saveLineConfig);
  bind('saveTgConfigBtn',         saveTgConfig);
  bind('tgTestSendBtn',           tgTestSend);
  bind('loadTgPendingBtn',        loadTgPending);
  bind('saveQuotaAlertBtn',       saveQuotaAlertSettings);
  bind('onboardGuideToggle',      toggleOnboardGuide);
  bind('loadPendingRecipientsBtn',loadPendingRecipients);
  bind('loadBlockedRecipientsBtn',loadBlockedRecipients);
  bind('addRecipientBtn',         addRecipient);
  bind('backupRunBtn',            runBackup);
  bind('mapboxTokenToggleBtn',    toggleMapboxTokenVis);
  bind('saveMapboxTokenBtn',      saveMapboxToken);
  bind('cartoKeyToggleBtn',       toggleCartoKeyVis);
  bind('saveCartoKeyBtn',         saveCartoKey);
  bind('mapDownloadStartBtn',     startDownload);
  bind('mapDownloadEstimateBtn',  estimateDownload);
  bind('mapClearCacheBtn',        clearAllCache);

  // ── Modals ─────────────────────────────────────────────────────
  bind('snapModalClose',           closeSnapModal);
  bind('burstModalClose',          closeBurstModal);
  bind('eulaViewerClose',          closeEulaViewer);
  bind('eulaLogoutBtn',            doLogout);
  bind('eulaAcceptBtn',            acceptEula);
  backdropClose('cameraDetailModal', closeCameraDetailModal);
  bind('cameraDetailModalClose',   closeCameraDetailModal);
  bind('ruleEditorModalClose',     closeRuleEditor);
  bind('ruleActiveClearBtn', function() {
    document.getElementById('ruleActiveFrom').value = '';
    document.getElementById('ruleActiveTo').value   = '';
  });
  bind('ruleEditorCancelBtn',      closeRuleEditor);
  bind('saveRuleBtn',              saveRule);
  backdropClose('reportScheduleModal', closeReportScheduleModal);
  bind('reportScheduleModalClose', closeReportScheduleModal);
  bind('saveReportScheduleBtn',    saveReportSchedule);
  bind('newReportScheduleBtn',     resetReportScheduleForm);
  bind('userEditorModalClose',     closeUserEditor);
  bind('userEditorCancelBtn',      closeUserEditor);
  bind('saveUserBtn',              saveUser);
  bind('changePasswordModalClose', closeChangePassword);
  bind('changePasswordCancelBtn',  closeChangePassword);
  bind('submitChangePasswordBtn',  submitChangePassword);
  bind('aboutModalClose',          closeAboutModal);
  bind('aboutEulaLink', function(e) { e.preventDefault(); closeAboutModal(); openEulaViewer(); });
  bind('appCustomModalClose',      closeAppCustomModal);
  bind('appCustomModalCancelBtn',  closeAppCustomModal);
  bind('applyAppCustomRangeBtn',   applyAppCustomRange);
  // (stats redesign 2026-08) custom-range modal ของหน้า stats เดิมถูกถอด
  bind('categoryEditorModalClose', closeCategoryEditor);
  bind('categoryEditorCancelBtn',  closeCategoryEditor);
  bind('saveCategoryBtn',          saveCategory);
  bind('crEditCancelBtn',          _crCancelEdit);
  bind('catDiscReload',            () => loadCatDiscovery(true));
  // checkbox ใช้ change ไม่ใช่ click — bind() ผูก click ให้เท่านั้น
  document.getElementById('catDiscLpr')
    ?.addEventListener('change', (e) => catDiscToggleAuto('lpr', e.target.checked));
  document.getElementById('catDiscFace')
    ?.addEventListener('change', (e) => catDiscToggleAuto('face', e.target.checked));
  bind('categoryRulesModalClose',  closeCategoryRules);
  bind('addCategoryRuleBtn',       addCategoryRule);
  bind('deleteAllCatRulesBtn',     deleteAllCategoryRules);

  // ── Inline handlers removed from index.html (Pre-Phase-5 gate) ─────────
  // Cameras — search + multi-site type/status filters. Any filter change
  // resets to page 1 so the user isn't stranded on an out-of-range page.
  const _camRefilter = () => { _camGridPage = 1; renderCameraGrid(); };
  document.getElementById('camSearch')?.addEventListener('input', _camRefilter);
  document.getElementById('camGroupFilter')?.addEventListener('change', (e) => setActiveGroup(e.target.value || 'all'));
  document.getElementById('camVendorFilter')?.addEventListener('change', _camRefilter);
  document.getElementById('camTypeFilter')?.addEventListener('change', _camRefilter);
  document.getElementById('camStatusFilter')?.addEventListener('change', _camRefilter);
  // (stats redesign 2026-08) select ของหน้า stats เดิมถูกถอด
  // Reports
  document.getElementById('reportType')?.addEventListener('change', onReportTypeChange);
  document.getElementById('hrRangePreset')?.addEventListener('change', _hrToggleCustomRange);
  // History / logs
  document.getElementById('logFilterStatus')?.addEventListener('change', () => loadAlertLogs());
  document.getElementById('statusLogCamFilter')?.addEventListener('change', () => loadStatusLog(1));
  document.getElementById('statusLogStatusFilter')?.addEventListener('change', () => loadStatusLog(1));
  document.getElementById('iqCamFilter')?.addEventListener('change', () => loadImageQualityLog(1));
  document.getElementById('iqTypeFilter')?.addEventListener('change', () => loadImageQualityLog(1));
  document.getElementById('auditFilterAction')?.addEventListener('change', () => loadAuditLog());
  document.getElementById('auditFilterCamera')?.addEventListener('change', () => loadAuditLog());
  // Camera form
  document.getElementById('frmCamId')?.addEventListener('blur', onCamIdBlur);
  document.getElementById('frmCamVendor')?.addEventListener('change', onVendorChange);
  // onVendorChange, not just the two helpers: the Data Forwarding section is now
  // gated on the role as well as the vendor, and switching a camera to/from LPR
  // has to show or hide it without reopening the form.
  document.getElementById('frmCamRole')?.addEventListener('change', onVendorChange);
  // CS5: Pull/Push radios write back to the canonical #frmCamPushOnly checkbox
  ['frmIngestPull', 'frmIngestPush'].forEach(id => document.getElementById(id)?.addEventListener('change', () => {
    const chk = document.getElementById('frmCamPushOnly');
    if (chk) chk.checked = !!document.getElementById('frmIngestPush')?.checked;
    _updatePushUrlVisibility();
  }));
  document.getElementById('frmCamIp')?.addEventListener('blur', onCamIpBlur);
  document.getElementById('frmCamLat')?.addEventListener('input', onCamCoordInput);
  document.getElementById('frmCamLng')?.addEventListener('input', onCamCoordInput);
  document.getElementById('frmCamEnableSnapshot')?.addEventListener('change', updateDahuaSnapNote);
  document.getElementById('frmOfflineEscalateOnce')?.addEventListener('change', toggleEscalateOnce);
  // EULA viewer checkbox
  document.getElementById('eulaAcceptCheck')?.addEventListener('change', function() {
    const b = document.getElementById('eulaAcceptBtn'); if (b) b.disabled = !this.checked;
  });
  // Report schedule type
  document.getElementById('rsType')?.addEventListener('change', _rsToggleTypeFields);
  // Category editor icon
  // Category rule camera filter — MultiPicker fires mp:change on the .mp
  // wrapper, not a native 'change' on the underlying <select>.
  document.getElementById('crCamera')?.addEventListener('change', loadFacets);
}

// ============================================================
// _bindDynamicHandlers — Global dispatcher for data-action elements
// Replaces inline onclick= generated by render functions (Phase 4).
// Add new actions here as each section is migrated.
// ============================================================
function _bindDynamicHandlers() {
  const ACTION_MAP = {
    // ช่องทางแจ้งเตือนประจำระบบ (Settings › LINE › HCP Face / AuraFace / ป้ายทะเบียน)
    achSave: (el) => saveAlertChannel(el.dataset.ch),
    achLprRcpToggle: (el) => achLprRcpToggle(el),
    achTest: (el) => testAlertChannel(el.dataset.ch),

    // เมนูที่จัดกลุ่มแล้ว (decision #245)
    navGroupToggle: (el) => navGroupToggle(el),

    // ป้าย "กล้องยังไม่ส่งข้อมูล" บน topbar → เปิด/ปิด dropdown รายชื่อ
    quietCamToggle: (el, e) => quietCamToggle(e),
    // แถวในรายชื่อ → ไปหน้ากล้อง กรองด้วยชื่อกล้องตัวนั้น
    quietCamGo: (el) => quietCamGo(el),

    // Settings › LINE › คำสั่งผ่าน LINE (page-line-commands.js)
    lcOpAdd:     () => lcOpAdd(),
    lcOpPick:    (el) => lcOpPick(el),
    lcOpToggle:  (el) => lcOpToggle(el),
    lcOpDelete:  (el) => lcOpDelete(el),
    lcOpTgLink:   (el) => lcOpTgLink(el),
    lcOpTgUnlink: (el) => lcOpTgUnlink(el),
    lcCmdNew:    () => lcCmdNew(),
    lcEdKind:    (el) => lcEdKind(el),
    lcCmdEdit:   (el) => lcCmdEdit(el),
    lcCmdSave:   () => lcCmdSave(),
    lcCmdCancel: () => lcCmdCancel(),
    lcCmdToggle: (el) => lcCmdToggle(el),
    lcCmdDelete: (el) => lcCmdDelete(el),
    lcTest:      () => lcTest(),

    // Settings › LINE › คำสั่งผ่าน Telegram (page-line-commands.js — แท็บแยก, ทะเบียนร่วมกับ LINE)
    lctOpRoomsSave: (el) => lctOpRoomsSave(el),
    lctGoToLineOps: () => lctGoToLineOps(),
    lctCmdTgToggle: (el) => lctCmdTgToggle(el),
    lctCmdEdit:     (el) => lctCmdEdit(el),

    // Pagination — reads window._pgHandlers[data-pg] stash set by renderPagination
    pgGo: (el) => {
      const handler = window._pgHandlers?.[el.dataset.pg];
      if (handler) handler(+el.dataset.page);
    },

    // AP.5b — "ตามคนนี้" จาก appearance card/segment
    appFollow: (el) => loadSimilarTimeline(parseInt(el.dataset.eventId, 10)),
    appOpen: (el) => appOpenPerson(parseInt(el.dataset.idx, 10)),
    appExample: (el) => appSearchByExample(parseInt(el.dataset.idx, 10)),
    appFace: (el) => appOpenFace(parseInt(el.dataset.idx, 10)),
    appColorPick: (el) => appPickColor(el.dataset.selectId, el.dataset.color),

    // RF4 — LPR gate config (Settings › LPR). data-action (buttons) +
    // data-input (name) + data-change (camera) all resolve here.
    lprGateAdd:    (el) => lprGateAdd(el),
    lprGateDelete: (el) => lprGateDelete(el),
    lprGateRule:   (el) => lprGateRule(el),
    lprGateName:   (el) => lprGateName(el),
    lprGateCamera: (el) => lprGateCamera(el),
    lprVtypeToggle: (el) => lprVtypeToggle(el),
    lprVtypeLabel:  (el) => lprVtypeLabel(el),
    lprSceneSave:   (el) => lprSceneSave(el),
    lprRetentionSave: (el) => lprRetentionSave(el),
    lprSetDir:      (el) => lprSetDir(el),
    lprDirSearch:      (el) => lprDirSearch(el),
    lprDirUnsetToggle: (el) => lprDirUnsetToggle(el),
    lprDirToggleSite:  (el) => lprDirToggleSite(el),
    setNotifyPref:     (el) => setNotifyPref(el),

    // Snapshots / Media / Events — idx-based routing into module-level arrays
    // _currentSnapEv / _currentMediaEv set on modal open for in-modal actions
    evtSetView:   (el) => evtSetView(el),
    showSnapshot: (el) => {
      const SOURCE = { events: allEvents, snaps: snapshots, app: window._appRows || [], lpr: window._lprRows || [], lprLatest: window._lprLatestRows || [] };
      const arr = SOURCE[el.dataset.source];
      if (arr) showSnapshot(arr[+el.dataset.idx]);
    },
    showMediaClip: (el) => {
      const SOURCE = { snaps: snapshots, media: mediaList };
      const arr = SOURCE[el.dataset.source];
      if (arr) showMediaClip(arr[+el.dataset.idx]);
    },
    expandBurst: (el) => {
      const SOURCE = { snaps: snapshots };
      const arr = SOURCE[el.dataset.source];
      if (arr) expandBurst(arr[+el.dataset.idx]);
    },
    showBurstMember: (el) => {
      const ev = _burstMembers?.[+el.dataset.idx];
      if (ev) { closeBurstModal(); showSnapshot(ev); }
    },
    viewFullSnap: () => {
      const ev = window._currentSnapEv;
      if (!ev?.snapshot_file) return;
      const file = ev.raw_json?._snapshot_full || ev.snapshot_file;
      const cap = camFullViewWidth(ev.camera_id);
      const encoded = file.split('/').map(encodeURIComponent).join('/');
      // A new tab gets no live overlay — whatever marks the object has to be in
      // the pixels. Ask the server to burn it when this event carries geometry
      // and the image we are opening is the full scene the box describes; the
      // server re-checks both, this only avoids a pointless round trip.
      const wantBox = ev.raw_json?._bbox && ev.id
        && file === ev.raw_json?._snapshot_full ? `bbox=1&eid=${ev.id}` : '';
      const qs = [cap ? `w=${cap}` : '', wantBox].filter(Boolean).join('&');
      window.open(`${API}/snapshots/${encoded}${qs ? '?' + qs : ''}`, '_blank');
    },
    closeAndShowClip: () => {
      const ev = window._currentSnapEv;
      closeSnapModal();
      if (ev) showMediaClip(ev);
    },
    showSnapFromMedia: () => {
      const ev = window._currentMediaEv;
      if (ev) showSnapshot(ev);
    },
    openUrl: (el) => window.open(el.dataset.url, '_blank'),

    // Sites (renderSiteTabs — cameras page · Phase A)
    setActiveSite:    (el) => setActiveSite(el.dataset.sid),
    setActiveCamType: (el) => setActiveCamType(el.dataset.type),
    setMapActiveSite: (el) => setMapActiveSite(el.dataset.sid),
    setOpActiveSite:  (el) => setOpActiveSite(el.dataset.sid),
    setFaceActiveSite: (el) => setFaceActiveSite(el.dataset.sid),
    setAppActiveSite:  (el) => setAppActiveSite(el.dataset.sid),
    setLprActiveSite:  (el) => setLprActiveSite(el.dataset.sid),
    camReorderEnter:    () => camReorderEnter(),
    camReorderCancel:   () => camReorderCancel(),
    camReorderSave:     () => camReorderSave(),
    camReorderMoveTop:  (el) => camReorderMove(el.dataset.cid, 'top'),
    camReorderMoveUp:   (el) => camReorderMove(el.dataset.cid, 'up'),
    camReorderMoveDown: (el) => camReorderMove(el.dataset.cid, 'down'),

    // Groups (renderGroupBarHTML + renderGroupList + renderGroupEditor)
    setActiveGroup:   (el) => setActiveGroup(el.dataset.gid),
    openGroupManager: ()   => openGroupManager(),
    editGroup:        (el) => editGroup(el.dataset.gid),
    deleteGroup:      (el) => deleteGroup(el.dataset.gid),
    toggleCamInGroup: (el) => toggleCamInGroup(el.dataset.camId),
    setGrpColor:      (el) => {
      const inp = document.getElementById('grpColor');
      if (inp) inp.value = el.dataset.color;
      el.parentElement.querySelectorAll('[data-action="setGrpColor"]').forEach(b => {
        b.style.boxShadow = b === el ? '0 0 0 2px var(--surface-elevated), 0 0 0 4px var(--accent)' : 'none';
      });
    },
    setGrpSite:       ()   => setGrpSite(),
    selectAllCams:    ()   => selectAllCams(),
    clearAllCams:     ()   => clearAllCams(),
    grpFilterCamList: ()   => _grpFilterCamList(),
    saveGroup:        ()   => saveGroup(),
    cancelEditGroup:  ()   => cancelEditGroup(),

    // Stats / Heatmap / Insights (renderQuietCameras + renderTopRules + heatmap td + renderCategoryKPI)
    goPage:           (el) => showPage(el.dataset.page, document.querySelector(`.nav-item[data-page="${el.dataset.page}"]`)),
    // (stats redesign 2026-08) action ของหน้า stats เดิมถูกถอด — goPage ยังใช้ที่อื่น

    // Categories (renderCategories + _renderIconPresets + loadCategoryRules)
    openCatRules:     (el) => openCategoryRules(+el.dataset.id),
    editCatRule:      (el) => startEditCatRule(el.dataset.ids.split(',').map(Number)),
    catDiscCreate:    (el) => catDiscCreate(+el.dataset.i),
    openCatEditor:    (el) => openCategoryEditor(+el.dataset.id),
    deleteCat:        (el) => deleteCategory(+el.dataset.id),
    deleteCatRule:    (el) => deleteCategoryRule(+el.dataset.id),
    toggleCatRuleGroup: (el) => toggleCatRuleGroup(el.dataset.group),
    deleteCatRuleGroup: (el) => deleteCategoryRuleGroup(el.dataset.ids.split(',').map(Number), +el.dataset.count),
    catBackup:        () => catBackup(),
    catRestore:       () => catRestore(),

    // Reports (renderReportSchedules + loadReportHistoryStats winBtn + loadReportHistory pager)
    openReportScheduleModal: () => openReportScheduleModal(),
    runReportNow:      (el) => runReportNow(+el.dataset.id, el),
    editReportSched:   (el) => editReportSchedule(+el.dataset.id),
    deleteReportSched: (el) => deleteReportSchedule(+el.dataset.id),
    loadRhStats:       (el) => loadReportHistoryStats(el.dataset.window),
    loadReportHistory: (el) => loadReportHistory(+el.dataset.offset),

    // Cameras (renderCameraRows)
    setCamActiveSite: (el) => setCamActiveSite(el.dataset.sid),
    setCamActiveType: (el) => setCamActiveType(el.dataset.type),
    editCamera:       (el) => editCamera(el.dataset.cameraId),
    toggleCamPause:   (el) => toggleCameraPause(el.dataset.cameraId, el.dataset.pauseState === 'true'),
    deleteCamera:     (el) => deleteCamera(el.dataset.cameraId),

    // Status Current pager + filter buttons (onclick only; onchange/onkeydown deferred to non-click batch)
    setStatusPage:    (el) => setStatusCurrentPage(+el.dataset.page),
    resetStatusPage:  ()   => resetStatusCurrentPage(),
    resetStatusFilts: ()   => resetStatusCurrentFilters(),

    // Alert Rules (renderAlertRules)
    toggleRule:       (el) => toggleRule(+el.dataset.id),
    openRuleEditor:   (el) => openRuleEditor(+el.dataset.id),
    deleteRule:       (el) => deleteRule(+el.dataset.id),

    // Backup (B8)
    downloadBackup:       (el)    => downloadBackup(el.dataset.filename),

    // License (B8)
    copyMachineId:        (el, e) => copyMachineId(el.dataset.machineId, e),
    openEulaViewer:       ()      => openEulaViewer(),
    activateLicense:      ()      => activateLicense(),
    deactivateLicense:    ()      => deactivateLicense(),

    // Face Recognition (B8)
    openFaceModal:        (el)    => openFaceModal(+el.dataset.id),
    openFaceMatchModal:   (el)    => openFaceMatchModal(el.dataset.id),
    facePeriod:           (el)    => faceSetPeriod(el.dataset.p),
    saveFaceNote:         (el)    => saveFaceNote(el),
    ackFaceMatch:         (el)    => ackFaceMatch(el),
    faceMatchPage:        (el)    => faceMatchGoPage(el.dataset.pg),
    faceGotoWatch:        ()      => faceGotoWatch(),
    faceApplyPeriod:      ()      => faceApplyPeriod(),
    cameraViewEvents:     (el)    => cameraViewEvents(el),

    // Map legend + Map Manager (B8)
    toggleMapDrawer:      ()      => toggleMapDrawer(),
    legendShowAll:        ()      => _legendShowAll(),
    legendHideAll:        ()      => _legendHideAll(),
    legendCollapse:       ()      => _legendCollapse(),
    cancelDownload:       ()      => cancelDownload(),
    deleteArea:           (el)    => deleteArea(el.dataset.id),

    // Users + Sessions (B8)
    openUserEditor:       (el)    => openUserEditor(+el.dataset.id),
    resetUserPassword:    (el)    => resetUserPassword(+el.dataset.id),
    deleteUserConfirm:    (el)    => deleteUserConfirm(+el.dataset.id),
    revokeSession:        (el)    => revokeSession(el.dataset.id),

    // Brand / Settings (B8)
    clearBrandLogo:       ()      => clearBrandLogo(),
    clearBrandFooterLogo: ()      => clearBrandFooterLogo(),
    saveSetting:          (el)    => saveSetting(el.dataset.key, el),
    saveNavVisibility:    ()      => saveNavVisibility(),

    // หน้าค้นหาอัจฉริยะ (page-smart-search.js)
    ssxTab:           (el) => ssxTab(el),
    ssxSearch:        ()   => ssxSearch(),
    ssxRerun:         ()   => ssxRerun(),
    ssxToggleBlocked: ()   => ssxToggleBlocked(),
    ssxToggleAdv:     ()   => ssxToggleAdv(),
    ssxOpen:          (el) => ssxOpen(el),

    // หน้ากวดขันวินัยจราจร (page-traffic.js)
    trfTab:        (el) => trfTab(el),
    trfDays:       (el) => trfDays(el),
    trfGran:       (el) => trfGran(el),
    trfVolMode:    (el) => trfVolMode(el),
    trfDow:        (el) => trfDow(el),
    trfDowAll:     ()   => trfDowAll(),
    trfSite:       (el) => trfSite(el),
    trfSiteAll:    ()   => trfSiteAll(),
    trfOpenCams:   ()   => trfOpenCams(),
    trfCloseCams:  ()   => trfCloseCams(),
    trfCamToggle:  (el) => trfCamToggle(el),
    trfCamAll:     ()   => trfCamAll(),
    trfCamNone:    ()   => trfCamNone(),
    trfApplyCams:  ()   => trfApplyCams(),
    trfOpenTypes:  ()   => trfOpenTypes(),
    trfTypeToggle: (el) => trfTypeToggle(el),
    trfApplyTypes: ()   => trfApplyTypes(),
    trfEffKind:    (el) => trfEffKind(el),
    trfEffWin:     (el) => trfEffWin(el),
    trfEffDate:    (el) => trfEffDateChange(el),
    trfGroupsReset:()   => trfGroupsReset(),
    trfSaveThresh: ()   => trfSaveThresh(),
    trfMetric:     (el) => trfMetric(el),

    // แท็บ "อันดับไม่สวมหมวกนิรภัย" (page-traffic.js)
    trfTopPeriod:  (el) => trfTopPeriod(el),
    trfTopPlate:   (el) => trfTopPlate(el),
    trfTopMore:    (el) => trfTopMore(el),
    trfTopReport:  ()   => trfTopReport(),
    trfTopTable:   (el) => trfTopTable(el),

    // แท็บ "สถิติหมวกนิรภัย" ภายในหน้ากวดขันวินัยจราจร (page-traffic.js)
    trfHelmetDateChange: (el) => trfHelmetDateChange(el),
    trfHelmetMonthChange:(el) => trfHelmetMonthChange(el),
    trfHelmetRangeDays:  (el) => trfHelmetRangeDays(el),
    trfHelmetRangeFrom:  (el) => trfHelmetRangeFrom(el),
    trfHelmetRangeTo:    (el) => trfHelmetRangeTo(el),
    trfTopFrom:          (el) => trfTopFrom(el),
    trfTopTo:            (el) => trfTopTo(el),
    saveBrandColor:       ()      => saveBrandColor(),
    saveAnalyticsDisplay: ()      => saveAnalyticsDisplay(),

    // Site management (Settings › Sites)
    addSite:        ()   => addSite(),
    retPreview:         (el) => retPreview(el),
    siteRetention:      (el) => siteRetention(el),
    saveSiteRetention:  (el) => saveSiteRetention(el),
    editSite:       (el) => editSite(el),
    saveSiteForm:   ()   => saveSiteForm(),
    deleteSite:     (el) => deleteSite(el),
    moveSite:       (el) => moveSite(el),
    siteMaintenance:        (el) => siteMaintenance(el),
    confirmSiteMaintenance: (el) => confirmSiteMaintenance(el),
    cancelSiteMaintenance:  ()   => cancelSiteMaintenance(),
    siteArchive:            (el) => siteArchive(el),
    siteUnarchive:          (el) => siteUnarchive(el),
    sitePurgeOpen:          (el) => sitePurgeOpen(el),
    sitePurgeConfirm:       (el) => sitePurgeConfirm(el),
    sitePurgeClose:         ()   => sitePurgeClose(),
    sitePurgeInput:         (el) => sitePurgeInput(el),
    provisionSiteEdge:  (el) => provisionSiteEdge(el),
    pushSiteConfig:     (el) => pushSiteConfig(el),
    copySiteEdgeCreds:  ()   => copySiteEdgeCreds(),
    closeSiteEdgeModal: ()   => closeSiteEdgeModal(),
    cancelSiteForm: ()   => cancelSiteForm(),

    // Services (B8)
    svcAction:            (el)    => _svcAction(el.dataset.svc, el.dataset.svcCmd),
    edgeSvcAction:        (el)    => _edgeSvcAction(el.dataset.edgeSite, el.dataset.svc, el.dataset.svcCmd),
    devTest:              (el)    => _devTest(el),
    devReboot:            (el)    => _devReboot(el),
    devRebootNvr:         (el)    => _devRebootNvr(el),
    devProbe:             (el)    => _devProbe(el.dataset.srcId),
    devSetSite:           (el)    => devSetSite(el),
    hcpSetFilter:         (el)    => hcpSetFilter(el),
    relaySetSite:         (el)    => relaySetSite(el),
    ueTogglePw:           (el)    => ueTogglePw(el),
    trfExportPdf:         (el)    => trfExportPdf(el),
    clearSpool:           (el)    => window._clearSpool(el),

    // Summary (B8)
    summaryOpenEvent:     (el)    => summaryOpenEvent(JSON.parse(el.dataset.eventJson)),

    // LINE config (B7)
    pushUsersSelect:           (el) => _pushUsersSelect(el.dataset.pushAction),
    loadAlertStats:            (el) => loadAlertStats(el.dataset.window),
    loadLineQuota:             ()   => loadLineQuota(),
    approvePendingRecipient:   (el) => approvePendingRecipient(el.dataset.lineId),
    ignorePendingRecipient:    (el) => ignorePendingRecipient(el.dataset.lineId),
    blockRecipient:            (el) => blockRecipient(el.dataset.lineId),
    unblockRecipient:          (el) => unblockRecipient(el.dataset.lineId),
    testRecipient:             (el) => testRecipient(el.dataset.id),
    removeRecipient:           (el) => removeRecipient(+el.dataset.idx),
    rcpScopeToggle:            (el) => rcpScopeToggle(el),

    // Telegram config (T1)
    approveTgPending:   (el) => approveTgPending(el.dataset.chatId),
    ignoreTgPending:    (el) => ignoreTgPending(el.dataset.chatId),
    blockTgPending:     (el) => blockTgPending(el.dataset.chatId),
    tgScopeToggle:      (el) => tgScopeToggle(el),
    tgChatFieldToggle:  (el) => tgChatFieldToggle(el),

    // Events nudge link (i18n.js aux.evtNewNudge — was onclick=)
    goEventsPage1:    ()   => loadEvents(1),

    // LPR (Phase F) — overview/search/watchlist. click + change + input + enter
    lprOpenModal:       (el) => _lprOpenModal(el.dataset.src, +el.dataset.idx),
    lprPage:            (el) => loadLpr(+el.dataset.page),
    lprSearch:          ()   => loadLpr(1),
    lprMatchMode:       (el) => lprMatchModeClick(el),
    lprPatternBuilder:  ()   => _lprToggleBuilder(),
    lprReset:           ()   => lprResetSearch(),
    lprExportCsv:       ()   => lprExportCsv(),
    lprGotoMismatch:    ()   => lprGotoMismatch(),
    lprGotoHelmet:      ()   => lprGotoHelmet(),
    lprGotoLocal:       ()   => lprGotoLocal(),
    lprGotoOverload:    ()   => lprGotoOverload(),
    lprQuick24h:        ()   => lprQuick24h(),
    lprQuickWeek:       ()   => lprQuickWeek(),
    lprQuickMonth:      ()   => lprQuickMonth(),
    lprNoReadSearch:    ()   => loadLprNoRead(1),
    lprNoReadReset:     ()   => lprNoReadReset(),
    lprNoReadQuick24h:  ()   => lprNoReadQuick24h(),
    lprNoReadQuickWeek: ()   => lprNoReadQuickWeek(),
    lprNoReadQuickMonth:()   => lprNoReadQuickMonth(),
    lprSearchDebounce:  ()   => _lprSearchDebounce(),
    lprAlertHistOpen:   (el) => lprAlertHistOpen(el),
    lprSearchPlate:     (el) => lprSearchPlate(el),
    lprGotoAlerts:      ()   => lprGotoAlerts(),
    lprAlertPeriod:     (el) => lprAlertSetPeriod(el.dataset.p),
    lprAlertGroup:      (el) => lprAlertSetGroup(el.dataset.g || ''),
    lprOpenAlert:       (el) => lprOpenAlert(+el.dataset.idx),
    lprAckAlertRow:     (el) => lprAckAlertRow(el),
    lprCloseAlert:      ()   => lprCloseAlert(),
    lprAckAlert:        ()   => lprAckAlert(),
    lprNotifyAlert:     ()   => lprNotifyAlert(),
    lprNotifyTelegram:  ()   => lprNotifyTelegram(),
    notifyFaceMatch:    (el) => notifyFaceMatch(el),
    notifyFaceMatchTelegram: (el) => notifyFaceMatchTelegram(el),
    lprAlertSearchDebounce: () => lprAlertSearchDebounce(),
    lprApplyPeriod:     ()   => lprApplyPeriod(),
    lprGsPeriod:        (el) => lprGsSetPeriod(el.dataset.p),
    lprOpenGsAlarm:     (el) => lprOpenGsAlarm(+el.dataset.idx),

    // ── Blacklist reservoir (migration 093) ──
    // Dashboard CSP forbids inline handlers, so every control routes here.
    _blNavTab:          (el) => _blNavTab(el),
    blOpenDetail:       (el) => _blOpenDetail(el.dataset.id, el.dataset.rec),
    blCloseDetail:      ()   => document.getElementById('blDetailModal').classList.add('hidden'),
    blOpenDups:         ()   => _blOpenDups(),
    blPickSource:       (el) => _blPickSource(el.dataset.dt, el.dataset.src),
    blOpenEdit:         (el) => _blOpenEdit(el.dataset.rid),
    blCloseEdit:        ()   => document.getElementById('blEditModal').classList.add('hidden'),
    blRevertField:      (el) => _blRevertField(el.dataset.k),
    blSaveOverride:     ()   => blSaveOverride(),
    blExcludeRecord:    ()   => blExcludeRecord(),
    blRestoreRecord:    ()   => blRestoreRecord(),
    blOpenQualDupName:  ()   => _blOpenQualDupName(),
    blOpenQualBadId:    ()   => _blOpenQualBadId(),
    blCloseQual:        ()   => document.getElementById('blQualModal').classList.add('hidden'),
    blToggleFacePhoto:  ()   => _blToggleFacePhoto(),
    blToggleId:         (el) => _blToggleId(el),
    blSavePageSettings: (el) => blSavePageSettings(el.dataset.dt),
    blDupBack:          ()   => blDupBack(),
    blDupGoPage:        (el) => blDupGoPage(el),
    blDupRemoveRow:     (el) => blDupRemoveRow(el),
    blDupRestoreRow:    (el) => blDupRestoreRow(el),
    blDupRemoveGroup:   (el) => blDupRemoveGroup(el),
    blDupKeepRow:       (el) => blDupKeepRow(el),
    blDupSetFilter:     (el) => blDupSetFilter(el),
    blDetailRemove:     (el) => blDetailRemove(el),
    blOpenBin:          (el) => blOpenBin(el),
    blBinBack:          ()   => blBinBack(),
    blBinSearch:        ()   => blBinSearch(),
    blBinSetKind:       (el) => blBinSetKind(el),
    blBinGoPage:        (el) => blBinGoPage(el),
    blBinRestore:       (el) => blBinRestore(el),
    blBinRestoreAll:    ()   => blBinRestoreAll(),
    blDupToggleRemoved: (el) => blDupToggleRemoved(el),
    blFaceSearch:       ()   => _blApplyFilter('face'),
    blFaceGroupPick:    (el) => _blFaceGroupPick(el.dataset.group),
    blFaceGroupAll:     ()   => _blFaceGroupAll(),
    blLprSearch:        ()   => _blApplyFilter('lpr'),
    blFaceReset:        ()   => _blResetFilter('face'),
    blLprReset:         ()   => _blResetFilter('lpr'),
    blAddSource:        ()   => blAddSource(),
    blCloseSrc:         ()   => document.getElementById('blSrcModal').classList.add('hidden'),
    blOpenChangeHistory:(el) => blOpenChangeHistory(el),
    blCloseChangeHistory:()  => blCloseChangeHistory(),
    blPickType:         (el) => _blOpenSourceForm(el.dataset.type, null),
    blOrphan:          (el) => blOrphanAction(el),
    blBackToTypes:      ()   => _blOpenTypePicker(),
    blToggleType:       (el) => el.classList.toggle('on'),
    blEditSource:       (el) => _blEditSource(el.dataset.id),
    blSaveSource:       ()   => blSaveSource(),
    blTestSource:       ()   => blTestSource(),
    blPickDiscovered:   (el) => blPickDiscovered(el),
    blOpenPush:         (el) => blOpenPush(el.dataset.id),
    blPushToggleType:   (el) => blPushToggleType(el),
    blPushEnable:       ()   => blPushEnable(),
    blPushDisable:      ()   => blPushDisable(),
    blPushApply:        ()   => blPushApply(),
    blOpenBridge:       ()   => blOpenBridge(),
    blmOpen:            ()   => blmOpen(),
    blmClose:           ()   => blmClose(),
    blmSave:            (el) => blmSave(el),
    // ปุ่มแท็บใน modal ประกาศ data-action="blmSwitchTab" แต่ไม่เคยลงทะเบียนที่นี่ —
    // CSP บล็อก inline handler ทุกตัว ปุ่มจึงกดแล้วเงียบ แท็บใบหน้าเปิดไม่ได้เลย
    blmSwitchTab:       (el) => blmSwitchTab(el),
    hfsSearch:          ()   => hfsSearch(),
    heLoad:             ()   => heLoad(),
    heShowPic:          (el) => heShowPic(el),
    hfsView:            (el) => hfsView(el),
    hfsEngine:          (el) => hfsEngine(el),
    afbTab:             (el) => afbTab(el),
    afbOpenDetail:      (el) => afbOpenDetail(el),
    afbOpenRosterDetail:(el) => afbOpenRosterDetail(el),
    afbToggleActive:    (el) => afbToggleActive(el),
    afbToggleRefBlur:   ()   => afbToggleRefBlur(),
    afbGroupAddNew:     ()   => afbGroupAddNew(),
    afbGroupColor:      (el) => afbGroupColor(el),
    afbGroupRename:     (el) => afbGroupRename(el),
    afbGroupNotify:     (el) => afbGroupNotify(el),
    afbGroupSite:       (el) => afbGroupSite(el),
    afbGroupDelete:     (el) => afbGroupDelete(el),
    afbUploadImg:       (el) => afbUploadImg(el),
    afbDropClear:       ()   => afbDropClear(),
    afbRosterAdd:       ()   => afbRosterAdd(),
    afbFilterGroup:     (el) => afbFilterGroup(el),
    afbRosterSearch:    (el) => afbRosterSearch(el),
    afbPageRoster:      (el) => afbPageRoster(el),
    hfsWin:             (el) => hfsWin(el),
    hfsUseOsd:          ()   => hfsUseOsd(),
    hfsResetOsd:        ()   => hfsResetOsd(),
    hfsPickNear:        (el) => hfsPickNear(el),
    hfsOpen:            (el) => hfsOpen(el),
    hfsClose:           ()   => hfsClose(),
    // ปุ่มเลือก/ล้างรูปของฟอร์มเพิ่มด้วยตนเอง — ต้องอยู่ตรงนี้ ไม่งั้นกดแล้วเงียบ
    // (พลาดแบบเดียวกับ blmSwitchTab ด้านบนเป๊ะ: ประกาศ data-action ในหน้า แต่ลืม
    //  ลงทะเบียนที่นี่ ⇒ ฟีเจอร์รูปตายสนิททั้งที่ฝั่ง server พร้อมแล้ว — เจอตอน audit 2026-08-13)
    blmPickPhoto:       ()   => blmPickPhoto(),
    blmClearPhoto:      ()   => blmClearPhoto(),
    blmAnother:         ()   => blmAnother(),
    blmGoBridge:        ()   => blmGoBridge(),
    blCloseBridge:      ()   => document.getElementById('blBridgeModal').classList.add('hidden'),
    blBridgeAddRule:    ()   => blBridgeAddRule(),
    blBridgeToggle:     (el) => blBridgeToggle(el),
    blBridgeDelRule:    (el) => blBridgeDelRule(el),
    blBridgePreview:    ()   => blBridgePreview(),
    blBridgeSync:       ()   => blBridgeSync(),
    blBridgeSrcChange:  ()   => blBridgeSrcChange(),
    blBridgeMapFacet:   (el) => blBridgeMapFacet(el),
    // FB5 — face_blacklist bridge, same shape as blBridge* above
    fbOpenBridge:       ()   => fbOpenBridge(),
    fbCloseBridge:      ()   => document.getElementById('fbBridgeModal').classList.add('hidden'),
    fbBridgeAddRule:    ()   => fbBridgeAddRule(),
    fbBridgeToggle:     (el) => fbBridgeToggle(el),
    fbBridgeDelRule:    (el) => fbBridgeDelRule(el),
    fbBridgePreview:    ()   => fbBridgePreview(),
    fbBridgeSync:       ()   => fbBridgeSync(),
    fbBridgeSrcChange:  ()   => fbBridgeSrcChange(),
    fbBridgeMapFacet:   (el) => fbBridgeMapFacet(el),
    fbToggleType:       (el) => el.classList.toggle('on'),
    faceApplyNew:       ()   => faceApplyNew(),
    faceGotoLive:       ()   => faceGotoLive(),
    faceLiveReload:     ()   => faceLiveReload(),
    faceLiveTogglePause:()   => faceLiveTogglePause(),
    faceLiveToggleMiss: ()   => faceLiveToggleMiss(),
    appApplyNew:        ()   => appApplyNew(),
    blRunImport:        (el) => blRunImport(el.dataset.id),
    blDeleteSource:     (el) => blDeleteSource(el.dataset.id),
    wlAdd:              ()   => _wlAdd(),
    wlUploadImg:        (el) => _wlUploadImg(el),
    wlFilter:           (el) => _wlSetFilter(el.dataset.wg),
    wlFilterRo:         (el) => _wlSetFilterRo(el.dataset.wg),
    wlToggle:           (el) => _wlToggle(el.dataset.plate, el.dataset.active === 'true'),
    wlToggleNotify:     (el) => wlToggleNotify(el),
    wlPurge:            ()   => wlPurge(),
    wlRowDelete:        (el) => wlRowDelete(el),
    wlSearch:           (el) => wlSearch(el),
    wlSearchRo:         (el) => wlSearchRo(el),
    wlOpenDetail:       (el) => wlOpenDetail(el),
    wlOpenDetailRo:     (el) => wlOpenDetailRo(el),
    wlPage:             (el) => _wlSetPage(+el.dataset.page),
    wlPageRo:           (el) => _wlSetPageRo(+el.dataset.page),
    wlEditModalClose:   ()   => wlEditClose(),
    wlEditSave:         ()   => wlEditSave(),
    wlEditToggleActive: ()   => wlEditToggleActive(),
    wlEditDelete:       ()   => wlEditDelete(),
    wlEditUploadImg:    (el) => _wlEditUploadImg(el),
    wlEditDropClear:    ()   => _wlEditResetDrop(),
    wlGroupAddNew:      ()   => wlGroupAddNew(),
    wlGroupRename:      (el) => wlGroupRename(el),
    wlGroupColor:       (el) => wlGroupColor(el),
    wlGroupMode:        (el) => wlGroupMode(el),
    wlGroupSite:        (el) => wlGroupSite(el),
    wlGroupNotify:    (el) => wlGroupNotify(el),
    wlGoLineConfig:   ()   => wlGoLineConfig(),
    wlGroupDelete:      (el) => wlGroupDelete(el),
    wlDropClear:        ()   => _wlResetDrop(),
    lprCloseModal:      ()   => _lprCloseModal(),
    lprModalBack:       ()   => lprModalBack(),
    lprRepeatOpenRow:   (el) => lprRepeatOpenRow(el),
    lprViewFull:        (el) => { if (el.dataset.url) window.open(el.dataset.url, '_blank', 'noopener'); },
    lprMismatchDismiss:  (el) => lprMismatchDismiss(el),
    lprSearchThisPlate:  (el) => lprSearchThisPlate(el),
    lprOpenAlarmList:    ()   => lprOpenAlarmList(),
    lprCloseAlarmList:   ()   => lprCloseAlarmList(),
    lprAlarmListOpen:    (el) => lprAlarmListOpen(el),
    lprMmOpenRow:        (el) => lprMmOpenRow(el),
    lprSaveImg:         (el) => { if (!el.dataset.url) return; const a = document.createElement('a'); a.href = el.dataset.url; a.download = el.dataset.name || 'lpr.jpg'; document.body.appendChild(a); a.click(); a.remove(); },

    // Non-click batch (B6b) — shared map, keyed by data-change / data-input / data-action-enter values
    eulaToggle:       (el) => { document.getElementById('licenseActivateBtn').disabled = !el.checked; },
    toggleMapGroup:   (el) => toggleMapGroup(el.dataset.gid),
    legendSearch:     (el) => _legendSearch(el.value),
    mapSearchInput:   (el) => mapSearchInput(el),
    mapSearchGo:      (el) => mapSearchGo(el),
    updateHrSendBtn:  ()   => _updateHealthSendBtnLabel(),
    updateRecipient:  (el) => updateRecipient(+el.dataset.idx, el.dataset.field, el.checked),
    uploadBrandLogo:       (el) => uploadBrandLogo(el),
    uploadBrandFooterLogo: (el) => uploadBrandFooterLogo(el),
    syncBrandColor:        (el) => { document.getElementById('ss_brand_primary_color').value = el.value; },
    // ย้ายกลุ่มแจ้งเตือนของป้ายจาก Blacklist — เป็น <select> จึงอยู่ในชุด data-change
    // ไม่ใช่ data-action (ที่ผูกกับ click) เหมือนปุ่มข้าง ๆ มันในแบนเนอร์เดียวกัน
    wlChangeGroup:         (el) => wlChangeGroup(el),
    // resetStatusPage already in map (B6) — reused by data-change on select + data-action-enter on input
    lprGsOwner:         (el) => lprGsSetOwner(el),
    lprGsSearchDebounce: ()  => lprGsSearchDebounce(),
  };

  // Any click outside the camera search closes its result list — a dropdown
  // left hanging over the map is worse than the problem it solves.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.map-cam-search') && typeof _mapSearchClose === 'function') {
      const box = document.getElementById('mapCamSearchResults');
      if (box && !box.classList.contains('hidden')) _mapSearchClose();
    }
  });

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const fn = ACTION_MAP[target.dataset.action];
    if (!fn) return;
    e.preventDefault();
    fn(target, e);
  });

  // change — checkboxes, select, file input; no preventDefault (would cancel native toggle/file-picker)
  document.addEventListener('change', (e) => {
    const target = e.target.closest('[data-change]');
    if (!target) return;
    const fn = ACTION_MAP[target.dataset.change];
    if (!fn) return;
    fn(target, e);
  });

  // input — text inputs; no preventDefault
  document.addEventListener('input', (e) => {
    const target = e.target.closest('[data-input]');
    if (!target) return;
    const fn = ACTION_MAP[target.dataset.input];
    if (!fn) return;
    fn(target, e);
  });

  // keydown Enter — data-action-enter avoids double-fire with buttons (which also fire click on Enter)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const target = e.target.closest('[data-action-enter]');
    if (!target) return;
    const fn = ACTION_MAP[target.dataset.actionEnter];
    if (!fn) return;
    fn(target, e);
  });

  // img onerror capture — replaces inline onerror= attrs (CSP script-src-attr blocked those).
  // Capture phase required: 'error' does not bubble from <img>.
  // data-err vocab: hide | dim | cam-placeholder | cam-span | face-noimg | no-img | lpr-noimg | face-swap
  window.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.dataset.err) return;
    const p = img.parentElement;
    switch (img.dataset.err) {
      case 'hide': img.style.display = 'none'; break;
      case 'dim':  img.style.opacity = '0.3'; break;
      case 'cam-placeholder': {
        // The grid fires many preview loads at once through the site tunnel; a
        // single transient hiccup shouldn't leave a permanently black card (the
        // placeholder swap is destructive — the img is gone, only a full grid
        // re-render brings it back). Retry twice with a fresh cache-buster before
        // giving up; a real miss (no tile) still lands on the placeholder.
        const n = (parseInt(img.dataset.retry, 10) || 0);
        if (n < 2) {
          img.dataset.retry = n + 1;
          setTimeout(() => { img.src = img.src.replace(/([?&])t=\d+/, `$1t=${Date.now()}`); }, 1200 * (n + 1));
        } else if (p) {
          // NVR sub-channels have no on-demand still (snapshot.cgi unsupported on
          // these NVRs) — the preview is the event scene, absent until the first
          // detection. Say so instead of the generic "cannot load" error.
          const msg = img.dataset.nvr ? I18N.t('cam.waitDetect') : I18N.t('cam.imgErr');
          p.innerHTML = `<div class="placeholder">${msg}</div>`;
        }
        break;
      }
      case 'cam-span':
        if (p) p.innerHTML = `<span style="color:var(--text-secondary);font-size:13px">${I18N.t('cam.imgErr')}</span>`; break;
      case 'face-noimg':
        if (p) p.innerHTML = `<div class="face-noimg">${escapeHtml(I18N.t('face.noImage'))}</div>`; break;
      case 'no-img':
        if (p) p.innerHTML = '<div class="no-img">err</div>'; break;
      case 'lpr-noimg':
        if (p) p.innerHTML = `<span style="color:var(--text-secondary);font-size:12px">${escapeHtml(I18N.t('lpr.noImage','ไม่มีภาพ'))}</span>`; break;
      case 'face-swap': {  // snapshot file gone → hide img, reveal pre-rendered metadata avatar sibling
        img.style.display = 'none';
        const sib = img.nextElementSibling;
        if (sib) sib.style.display = '';
        break;
      }
    }
  }, true);
}
