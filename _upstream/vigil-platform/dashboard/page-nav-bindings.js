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
}

function _bindStaticHandlers() {
  function bind(id, fn) { document.getElementById(id)?.addEventListener('click', fn); }
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
  delegate('evtTabBar', '.tab[data-tab]', (e, el) => setEventTab(el.dataset.tab, el));

  // ── Snapshots ──────────────────────────────────────────────────
  bind('snapSearchBtn', () => loadSnapshots(1));
  bind('snapResetBtn',  resetSnapFilters);
  delegate('snapViewBar', '.tab[data-view]', (e, el) => setSnapView(el.dataset.view, el));

  // ── Media ──────────────────────────────────────────────────────
  bind('mediaSearchBtn',  () => loadMedia(1));
  bind('mediaResetBtn',   resetMediaFilters);
  backdropClose('mediaModal', closeMediaModal);
  bind('mediaModalClose', closeMediaModal);

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
  bind('faceTabRecog',    () => _switchFaceTab('recog'));
  bind('faceTabSearch',   () => _switchFaceTab('search'));
  bind('faceTabSettings', () => _switchFaceTab('settings'));
  bind('faceSearchBtn2',  _loadFaceTab);
  bind('faceResetBtn2',   resetFaceTab2);

  // ── LPR ────────────────────────────────────────────────────────
  delegate('lprTabBar', '.tab[data-tab]', (e, el) => _switchLprTab(el.dataset.tab));

  // ── Appearance ─────────────────────────────────────────────────
  delegate('appTabBar',   '.tab[data-tab]',       (e, el) => setAppTab(el.dataset.tab, el));
  delegate('appRangeBar', '.per-btn[data-range]', (e, el) => setAppRange(el.dataset.range, el));
  bind('appSearchBtn', () => loadAppearanceSearch(1));
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
  bind('mapRecenterBtn',    recenterMap);
  bind('btnMapMore',        toggleMapSecondary);
  bind('togStyle',          toggleMapStyle);
  bind('togProvider',       toggleMapProvider);
  bind('togSource',         toggleMapSource);
  bind('btnWallMode',       toggleWallMode);
  bind('mapDrawerBackdrop', toggleMapDrawer);

  // ── Stats ──────────────────────────────────────────────────────
  document.getElementById('statsRangeBar')?.addEventListener('click', function(e) {
    const btn = e.target.closest('.per-btn[data-range]');
    if (!btn || !this.contains(btn)) return;
    btn.dataset.range === 'custom' ? openCustomRangeModal() : setStatsRange(btn.dataset.range, btn);
  });
  bind('tlExpandBtn',        toggleTimelineExpand);
  bind('csvBtnTimeline',     () => exportCsv('timeline'));
  bind('csvBtnBreakdown',    () => exportCsv('breakdown'));
  bind('csvBtnKpi',          () => exportCsv('kpi'));
  bind('csvBtnPeople',       () => exportCsv('people'));
  bind('csvBtnVehicle',      () => exportCsv('vehicle'));
  bind('csvBtnHeatmap',      () => exportCsv('heatmap'));
  bind('csvBtnQuietCameras', () => exportCsv('quietCameras'));
  bind('csvBtnTopRules',     () => exportCsv('topRules'));

  // ── Reports ────────────────────────────────────────────────────
  bind('rbLoadBtn',        updateReportPreview);
  bind('rbDownload',       downloadPDF);
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

  // ── Settings srail ─────────────────────────────────────────────
  delegate('settingsSrail', '.srail-item[data-sec]', (e, el) => settingsNav(el.dataset.sec, el));
  bind('settingsBackBtn', settingsBack);

  // ── Camera form ────────────────────────────────────────────────
  bind('camSubTabCameras',       function() { camerasSubTab('cameras', this); });
  bind('camSubTabGroups',        function() { camerasSubTab('groups',  this); });
  bind('camSubTabCsv',           function() { camerasSubTab('csv',     this); });
  bind('openCameraFormBtn',      openCameraForm);
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
  bind('frmFacePushGenBtn',      generateFacePushToken);
  bind('frmFacePushCopyBtn',     copyFacePushUrl);
  bind('frmLprPushGenBtn',       generateLprPushToken);
  bind('frmLprPushCopyBtn',      copyLprPushUrl);
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
    if (e.key === 'Escape' && document.getElementById('set-cameras')?.classList.contains('cam-editing')) closeCameraForm();
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

  // ── Users / Categories / Alerts ────────────────────────────────
  bind('openUserEditorBtn',       () => openUserEditor());
  bind('openCategoryEditorBtn',   () => openCategoryEditor());
  bind('alertTabRules',           () => switchAlertTab('rules'));
  bind('alertTabConfig',          () => switchAlertTab('config'));
  bind('openRuleEditorBtn',       () => openRuleEditor());
  bind('saveLineConfigBtn',       saveLineConfig);
  bind('onboardGuideToggle',      toggleOnboardGuide);
  bind('loadPendingRecipientsBtn',loadPendingRecipients);
  bind('loadBlockedRecipientsBtn',loadBlockedRecipients);
  bind('addRecipientBtn',         addRecipient);
  bind('backupRunBtn',            runBackup);
  bind('mapboxTokenToggleBtn',    toggleMapboxTokenVis);
  bind('saveMapboxTokenBtn',      saveMapboxToken);
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
  bind('customRangeModalClose',    closeCustomRangeModal);
  delegate('crQuickBar', '.btn[data-quick]', (e, el) => crQuick(el.dataset.quick));
  bind('customRangeCancelBtn',     closeCustomRangeModal);
  bind('applyCustomRangeBtn',      applyCustomRange);
  bind('categoryEditorModalClose', closeCategoryEditor);
  bind('categoryEditorCancelBtn',  closeCategoryEditor);
  bind('saveCategoryBtn',          saveCategory);
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
  // Stats selects
  document.getElementById('occTlCamRule')?.addEventListener('change', loadOccupancyTimeline);
  document.getElementById('occHmCamRule')?.addEventListener('change', loadOccupancyHeatmap);
  document.getElementById('heatmapCatFilter')?.addEventListener('change', loadHeatmap);
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
  document.getElementById('frmCamRole')?.addEventListener('change', _updatePushUrlVisibility);
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
  document.getElementById('ceIcon')?.addEventListener('input', syncIconPresets);
  // Category rule camera filter — MultiPicker fires mp:change on the .mp
  // wrapper, not a native 'change' on the underlying <select>.
  document.getElementById('crCamera')?.closest('.mp')?.addEventListener('mp:change', loadFacets);
}

// ============================================================
// _bindDynamicHandlers — Global dispatcher for data-action elements
// Replaces inline onclick= generated by render functions (Phase 4).
// Add new actions here as each section is migrated.
// ============================================================
function _bindDynamicHandlers() {
  const ACTION_MAP = {
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
      window.open(`${API}/snapshots/${encoded}${cap ? '?w=' + cap : ''}`, '_blank');
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
    drillHeatmapCell: (el) => drillHeatmapCell(+el.dataset.d, +el.dataset.h, +el.dataset.v),
    drillToCamera:    (el) => drillTo({ camera: el.dataset.camera, label: el.dataset.label }),
    drillToRule:      (el) => drillTo({ rule_name: el.dataset.ruleName, label: el.dataset.label }),
    setFocusCat:      (el) => setStatsFocusCategory(el.dataset.catId === '' ? null : +el.dataset.catId),

    // Categories (renderCategories + _renderIconPresets + loadCategoryRules)
    openCatRules:     (el) => openCategoryRules(+el.dataset.id),
    openCatEditor:    (el) => openCategoryEditor(+el.dataset.id),
    deleteCat:        (el) => deleteCategory(+el.dataset.id),
    selectIconPreset: (el) => selectIconPreset(el.dataset.preset),
    deleteCatRule:    (el) => deleteCategoryRule(+el.dataset.id),
    toggleCatRuleGroup: (el) => toggleCatRuleGroup(el.dataset.group),
    deleteCatRuleGroup: (el) => deleteCategoryRuleGroup(el.dataset.ids.split(',').map(Number), +el.dataset.count),

    // Reports (renderReportSchedules + loadReportHistoryStats winBtn + loadReportHistory pager)
    openReportScheduleModal: () => openReportScheduleModal(),
    runReportNow:      (el) => runReportNow(+el.dataset.id, el),
    editReportSched:   (el) => editReportSchedule(+el.dataset.id),
    deleteReportSched: (el) => deleteReportSchedule(+el.dataset.id),
    loadRhStats:       (el) => loadReportHistoryStats(el.dataset.window),
    loadReportHistory: (el) => loadReportHistory(+el.dataset.offset),

    // Cameras (renderCameraRows)
    setCamActiveSite: (el) => setCamActiveSite(el.dataset.sid),
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
    faceRecogSeg:         (el)    => _faceRecogSeg(el.dataset.seg),
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
    saveSetting:          (el)    => saveSetting(el.dataset.key),
    saveBrandColor:       ()      => saveBrandColor(),
    saveAnalyticsDisplay: ()      => saveAnalyticsDisplay(),

    // Site management (Settings › Sites)
    addSite:        ()   => addSite(),
    editSite:       (el) => editSite(el),
    saveSiteForm:   ()   => saveSiteForm(),
    deleteSite:     (el) => deleteSite(el),
    provisionSiteEdge:  (el) => provisionSiteEdge(el),
    pushSiteConfig:     (el) => pushSiteConfig(el),
    copySiteEdgeCreds:  ()   => copySiteEdgeCreds(),
    closeSiteEdgeModal: ()   => closeSiteEdgeModal(),
    cancelSiteForm: ()   => cancelSiteForm(),

    // Services (B8)
    svcAction:            (el)    => _svcAction(el.dataset.svc, el.dataset.svcCmd),
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

    // Events nudge link (i18n.js aux.evtNewNudge — was onclick=)
    goEventsPage1:    ()   => loadEvents(1),

    // LPR (Phase F) — overview/search/watchlist. click + change + input + enter
    lprOpenModal:       (el) => _lprOpenModal(el.dataset.src, +el.dataset.idx),
    lprPage:            (el) => loadLpr(+el.dataset.page),
    lprSearch:          ()   => loadLpr(1),
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
    lprGotoAlerts:      ()   => lprGotoAlerts(),
    lprAlertPeriod:     (el) => lprAlertSetPeriod(el.dataset.p),
    lprAlertGroup:      (el) => lprAlertSetGroup(el.dataset.g || ''),
    lprOpenAlert:       (el) => lprOpenAlert(+el.dataset.idx),
    lprAckAlertRow:     (el) => lprAckAlertRow(el),
    lprCloseAlert:      ()   => lprCloseAlert(),
    lprAckAlert:        ()   => lprAckAlert(),
    lprAlertSearchDebounce: () => lprAlertSearchDebounce(),
    lprApplyPeriod:     ()   => lprApplyPeriod(),
    wlAdd:              ()   => _wlAdd(),
    wlUploadImg:        (el) => _wlUploadImg(el),
    wlFilter:           (el) => _wlSetFilter(el.dataset.wg),
    wlFilterRo:         (el) => _wlSetFilterRo(el.dataset.wg),
    wlToggle:           (el) => _wlToggle(el.dataset.plate, el.dataset.active === 'true'),
    wlDelete:           (el) => _wlDelete(el.dataset.plate),
    wlGroupAddNew:      ()   => wlGroupAddNew(),
    wlGroupRename:      (el) => wlGroupRename(el),
    wlGroupColor:       (el) => wlGroupColor(el),
    wlGroupDelete:      (el) => wlGroupDelete(el),
    wlDropClear:        ()   => _wlResetDrop(),
    lprCloseModal:      ()   => _lprCloseModal(),
    lprModalBack:       ()   => lprModalBack(),
    lprRepeatOpenRow:   (el) => lprRepeatOpenRow(el),
    lprViewFull:        (el) => { if (el.dataset.url) window.open(el.dataset.url, '_blank', 'noopener'); },
    lprMismatchDismiss:  (el) => lprMismatchDismiss(el),
    lprSearchThisPlate:  (el) => lprSearchThisPlate(el),
    lprMmOpenRow:        (el) => lprMmOpenRow(el),
    lprSaveImg:         (el) => { if (!el.dataset.url) return; const a = document.createElement('a'); a.href = el.dataset.url; a.download = el.dataset.name || 'lpr.jpg'; document.body.appendChild(a); a.click(); a.remove(); },

    // Non-click batch (B6b) — shared map, keyed by data-change / data-input / data-action-enter values
    eulaToggle:       (el) => { document.getElementById('licenseActivateBtn').disabled = !el.checked; },
    toggleMapGroup:   (el) => toggleMapGroup(el.dataset.gid),
    legendSearch:     (el) => _legendSearch(el.value),
    updateHrSendBtn:  ()   => _updateHealthSendBtnLabel(),
    updateRecipient:  (el) => updateRecipient(+el.dataset.idx, el.dataset.field, el.checked),
    uploadBrandLogo:  (el) => uploadBrandLogo(el),
    syncBrandColor:   (el) => { document.getElementById('ss_brand_primary_color').value = el.value; },
    // resetStatusPage already in map (B6) — reused by data-change on select + data-action-enter on input
  };

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
