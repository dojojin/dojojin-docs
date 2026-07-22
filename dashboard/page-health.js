// ============================================================
// Vigil Platform — Health Check Page
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ============================================================
// 💓 Health Check page
// ============================================================
let _healthTimer = null;

function startHealthAutoRefresh() {
  if (_healthTimer) return;
  _healthTimer = setInterval(loadHealth, 15000);
}
function stopHealthAutoRefresh() {
  if (_healthTimer) { clearInterval(_healthTimer); _healthTimer = null; }
}

function _healthBadge(level, label) {
  const c = level === 'ok' ? token('--status-ok') : level === 'warn' ? token('--warn')
          : level === 'idle' ? token('--text-secondary') : token('--status-bad');
  return `<span style="display:inline-block;padding:2px 8px;background:${c}26;color:${c};border-radius:99px;font-size:10px;font-weight:700">${escapeHtml(label)}</span>`;
}

function _healthCard(title, badge, rows) {
  const body = rows.map(([k, v]) => {
    // null v = section divider header
    if (v === null) return `<div style="margin:8px 0 4px;font-size:9px;font-weight:700;color:var(--text-secondary);letter-spacing:0.8px;text-transform:uppercase;border-top:1px solid var(--border-hairline);padding-top:6px">${escapeHtml(k)}</div>`;
    return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dashed var(--border-hairline);font-size:11px">
      <span style="color:var(--text-secondary)">${escapeHtml(k)}</span>
      <span style="color:var(--text-primary);font-weight:600;text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</span>
    </div>`;
  }).join('');
  return `
    <div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:10px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700">${escapeHtml(title)}</div>
        ${badge}
      </div>
      ${body}
    </div>`;
}

function _svcCard(svcs) {
  const anyDown = svcs.some(s => s.status !== 'online');
  const overallBadge = _healthBadge(anyDown ? 'warn' : 'ok', anyDown ? 'CHECK' : 'OK');
  const btnBase = `padding:2px 8px;font-size:10px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid`;
  const rows = svcs.map(s => {
    const lvl = s.status === 'online' ? 'ok' : s.status === 'errored' ? 'err' : 'warn';
    const badge = _healthBadge(lvl, s.status.toUpperCase());
    const uptime = s.uptime_ms != null ? _humanSec(Math.round(s.uptime_ms / 1000)) : '—';
    const restartNote = s.restarts > 0 ? ` <span style="color:var(--warn);font-size:9px">(↺${s.restarts})</span>` : '';
    const svcName = escapeHtml(s.name);
    // api-server stop = dashboard bricks with no UI recovery → restrict to Restart only.
    // Q1: Stop must reach crash-looping states (errored / "waiting restart" / launching),
    // not just online — else a crash-loop can't be halted from the UI (had to use pm2 CLI).
    // Backend (health.js POST /api/services) gates stop by allowlist + api-server only,
    // never by status, so every non-stopped service is safely stoppable. Each state still
    // renders Restart + exactly one of Stop/Start (button count unchanged → no reflow).
    const canStop  = s.name !== 'api-server' && s.status !== 'stopped';
    const canStart = s.name !== 'api-server' && s.status === 'stopped';
    const restartBtn = `<button class="admin-only" data-action="svcAction" data-svc="${svcName}" data-svc-cmd="restart" style="${btnBase} var(--accent);color:var(--accent);background:transparent" title="${I18N.t('hlth.svcRestart')}">${I18N.t('hlth.svcRestart')}</button>`;
    const stopBtn   = canStop  ? `<button class="admin-only" data-action="svcAction" data-svc="${svcName}" data-svc-cmd="stop"    style="${btnBase} var(--warn);color:var(--warn);background:transparent"   title="${I18N.t('hlth.svcStop')}">${I18N.t('hlth.svcStop')}</button>` : '';
    const startBtn  = canStart ? `<button class="admin-only" data-action="svcAction" data-svc="${svcName}" data-svc-cmd="start"   style="${btnBase} var(--status-ok);color:var(--status-ok);background:transparent" title="${I18N.t('hlth.svcStart')}">${I18N.t('hlth.svcStart')}</button>` : '';
    // Left col: name + uptime sub-line; right col: badge + buttons.
    // Uptime moved to left col so right col stays ≤180px — fits 280px card.
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 0;border-bottom:1px dashed var(--border-hairline)">
      <div style="min-width:0;flex:1;overflow:hidden">
        <div style="font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${svcName}${restartNote}</div>
        <div style="font-size:9px;color:var(--text-secondary)">${uptime}</div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        ${badge}${restartBtn}${stopBtn}${startBtn}
      </div>
    </div>`;
  }).join('');
  return `
    <div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:10px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700">${I18N.t('hlth.svcTitle')}</div>
        ${overallBadge}
      </div>
      ${rows || `<div style="font-size:11px;color:var(--text-secondary)">—</div>`}
    </div>`;
}

window._svcAction = async function(name, action) {
  if (action === 'stop') {
    if (!confirm(I18N.t('hlth.svcStopConfirm').replace('{name}', name))) return;
  } else if (action === 'restart' && name === 'api-server') {
    if (!confirm(I18N.t('hlth.svcApiRestartWarn'))) return;
  }
  const grid = document.getElementById('healthGrid');
  try {
    const r = await fetch(`${API}/api/services/${encodeURIComponent(name)}/${encodeURIComponent(action)}`, {
      method: 'POST', credentials: 'include',
    });
    const data = await r.json().catch(() => ({}));
    if (data.expect_reconnect) {
      if (grid) grid.insertAdjacentHTML('afterbegin',
        `<div id="_svcRestartBanner" style="grid-column:1/-1;padding:10px 14px;background:${token('--warn')}26;color:var(--warn);border-radius:8px;font-size:12px;font-weight:600">${I18N.t('hlth.svcRestarting')}</div>`);
      _pollApiServerRecovery();
      return;
    }
    if (!r.ok) { alert(data.error || `Error ${r.status}`); return; }
    setTimeout(loadHealth, 1500);
  } catch (e) {
    if (name === 'api-server') { _pollApiServerRecovery(); return; }
    console.error('svcAction error', e);
  }
};

function _pollApiServerRecovery() {
  let tries = 0;
  const MAX = 30;
  const t = setInterval(async () => {
    tries++;
    try {
      const r = await fetch(`${API}/api/health/details`, { cache: 'no-store', credentials: 'include' });
      if (r.ok) {
        clearInterval(t);
        const banner = document.getElementById('_svcRestartBanner');
        if (banner) banner.remove();
        loadHealth();
      }
    } catch {}
    if (tries >= MAX) { clearInterval(t); loadHealth(); }
  }, 1000);
}

function _humanSec(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 60) return n + 's';
  if (n < 3600) return Math.floor(n / 60) + 'm ' + (n % 60) + 's';
  if (n < 86400) return Math.floor(n / 3600) + 'h ' + Math.floor((n % 3600) / 60) + 'm';
  return Math.floor(n / 86400) + 'd ' + Math.floor((n % 86400) / 3600) + 'h';
}

window._clearSpool = async function(el) {
  const n = parseInt(el.dataset.spoolCount, 10) || 0;
  const msg = I18N.t('hlth.clearSpoolConfirm').replace('{n}', n);
  if (!confirm(msg)) return;
  try {
    const r = await fetch(`${API}/api/lpr/spool/clear`, { method: 'DELETE', credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    loadHealth();
  } catch (e) { alert('Error: ' + e.message); }
};

async function loadHealth() {
  const grid = document.getElementById('healthGrid');
  if (!grid) return;
  try {
    const res = await fetch(`${API}/api/health/details`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const h = await res.json();

    const dbBadge = h.db.ok
      ? _healthBadge('ok', `${h.db.latency_ms}ms`)
      : _healthBadge('err', 'DOWN');
    const mqttLevel = h.mqtt_pipeline.status === 'healthy' ? 'ok'
                    : h.mqtt_pipeline.status === 'idle'    ? 'warn'
                    : h.mqtt_pipeline.status === 'stale'   ? 'err'  : 'warn';
    const memUsedMb = h.server.total_mem_mb - h.server.free_mem_mb;
    const memPct = h.server.total_mem_mb ? Math.round(memUsedMb / h.server.total_mem_mb * 100) : 0;
    // Host badge keys off CPU load-per-core, NOT RAM: macOS os.freemem() reports
    // ~99% used on a healthy box (purgeable/cached pages aren't counted), so a
    // RAM-gated badge would be permanently red. "Used %" stays an info row only.
    const loadRatio = h.server.cpu_count ? h.server.load_avg_1m / h.server.cpu_count : null;
    const hostLevel = loadRatio == null ? 'ok' : loadRatio > 2 ? 'err' : loadRatio > 1 ? 'warn' : 'ok';
    const diskPct = (h.storage.disk_total_gb && h.storage.disk_free_gb != null)
      ? Math.round((1 - h.storage.disk_free_gb / h.storage.disk_total_gb) * 100) : null;
    const diskLevel    = diskPct == null ? 'warn' : diskPct > 90 ? 'err' : diskPct > 75 ? 'warn' : 'ok';
    const storageLevel = (h.storage.spool_files ?? 0) > 0 ? 'warn' : diskLevel;

    const cards = [];

    cards.push(_healthCard('Database (PostgreSQL)', dbBadge, [
      [I18N.t('hlth.rowStatus'), h.db.ok ? '✓ Connected' : '✗ ' + (h.db.error || 'unreachable')],
      ['Latency', h.db.latency_ms != null ? h.db.latency_ms + ' ms' : '—'],
      ['Total events', h.events.total.toLocaleString()],
      ['  · Face (all time)', (h.events.face_total ?? 0).toLocaleString()],
      ['  · LPR (all time)', (h.events.lpr_total ?? 0).toLocaleString()],
    ]));

    cards.push(_healthCard('MQTT Pipeline', _healthBadge(mqttLevel, h.mqtt_pipeline.status.toUpperCase()), [
      ['Last event', h.mqtt_pipeline.last_event_at ? new Date(h.mqtt_pipeline.last_event_at).toLocaleString('th-TH', {hour12:false}) : I18N.t('hlth.noEvent')],
      ['Age', _humanSec(h.mqtt_pipeline.age_sec)],
      ['Events / hr (1h)', h.events.last_hour.toLocaleString()],
      ['Events / day (24h)', h.events.last_24h.toLocaleString()],
      [I18N.t('hlth.rowDesc'),
        h.mqtt_pipeline.status === 'healthy' ? I18N.t('hlth.mqttHealthy') :
        h.mqtt_pipeline.status === 'idle'    ? I18N.t('hlth.mqttIdle') :
        h.mqtt_pipeline.status === 'stale'   ? I18N.t('hlth.mqttStale') :
        I18N.t('hlth.mqttNone')],
    ]));

    // Alert delivery (LINE) — the platform's core output. Grey/idle = no alerts
    // in 24h (quiet OR broken — last-sent row disambiguates), warn = LINE pushes
    // failing, green = delivering. Counts come from alert_logs.
    const al = h.alerts;
    const alLevel = !al ? 'idle' : al.failed > 0 ? 'warn' : al.success > 0 ? 'ok' : 'idle';
    const alLabel = !al ? 'n/a' : al.failed > 0 ? `${al.failed} failed` : al.success > 0 ? `${al.success} sent` : 'idle';
    cards.push(_healthCard('Alerts (LINE · 24h)', _healthBadge(alLevel, alLabel), [
      ['Sent OK', al ? al.success.toLocaleString() : '—'],
      ['Failed', al ? (al.failed > 0 ? `<span style="color:var(--warn)">${al.failed.toLocaleString()}</span>` : '0') : '—'],
      ['Cooldown skip', al ? al.cooldown.toLocaleString() : '—'],
      ['Last sent', al && al.last_sent_at ? new Date(al.last_sent_at).toLocaleString('th-TH', {hour12:false}) : I18N.t('hlth.noEvent')],
    ]));

    // Merged camera card: Status + Image Quality + Automation Triggers
    const iq = h.image_quality || [];
    const iqTotal = iq.reduce((s, c) =>
      s + c.too_bright + c.too_blurry + c.too_dark + c.scene_change, 0);
    const at = h.automation_triggers || [];
    const atTotal = at.reduce((s, c) => s + c.digital_input + c.relay, 0);
    const camCardLevel = (h.cameras.offline > 0 || iqTotal > 20) ? 'warn' : 'ok';
    cards.push(_healthCard('Cameras', _healthBadge(camCardLevel, `${h.cameras.online}/${h.cameras.total} online`), [
      ['Status', null],
      ['Total', h.cameras.total],
      ['Online (heartbeat <90s)', h.cameras.online],
      ['Offline / unknown', h.cameras.offline],
      ['Image Quality (24h)', null],
      ...(iq.length === 0
        ? [[I18N.t('hlth.rowStatus'), I18N.t('hlth.iqNoIssues')]]
        : [['', I18N.t('hlth.iqLegend')],
           ...iq.map(c => [c.camera_id, `Bright:${c.too_bright} Blur:${c.too_blurry} Dark:${c.too_dark} Scene:${c.scene_change}`])]),
      ['Automation Triggers (24h)', null],
      ...(at.length === 0
        ? [[I18N.t('hlth.rowStatus'), I18N.t('hlth.atNoSignal')]]
        : [['', 'Digital Input / Relay'],
           ...at.map(c => [c.camera_id, `DI:${c.digital_input}  Relay:${c.relay}  · ${c.last_trigger_at ? new Date(c.last_trigger_at).toLocaleTimeString('th-TH', {hour12:false}) : '—'}`])]),
    ]));

    // Service Management — PM2-backed status + Restart/Stop/Start per service.
    cards.push(_svcCard(h.services || []));

    cards.push(_healthCard('Storage', _healthBadge(storageLevel, diskPct != null ? diskPct + '% used' : 'unknown'), [
      ['Snapshot files (total)', h.storage.snapshots_files.toLocaleString()],
      ['Snapshot size (total)', h.storage.snapshots_mb + ' MB'],
      ['  · Face crop', `${(h.storage.face_crop_files ?? 0).toLocaleString()} files · ${h.storage.face_crop_mb ?? 0} MB`],
      ['  · Face full frame', `${(h.storage.face_full_files ?? 0).toLocaleString()} files · ${h.storage.face_full_mb ?? 0} MB`],
      ['  · LPR plate', `${(h.storage.lpr_plate_files ?? 0).toLocaleString()} files · ${h.storage.lpr_plate_mb ?? 0} MB`],
      ['  · LPR scene', `${(h.storage.lpr_scene_files ?? 0).toLocaleString()} files · ${h.storage.lpr_scene_mb ?? 0} MB`],
      ['  · General events', `${(h.storage.other_files ?? 0).toLocaleString()} files · ${h.storage.other_mb ?? 0} MB`],
      ['LPR forward spool', (() => {
        const n = h.storage.spool_files ?? 0;
        const clrBtn = n > 0
          ? ` <button class="admin-only" data-action="clearSpool" data-spool-count="${n}" style="margin-left:6px;padding:1px 6px;font-size:9px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid var(--warn);color:var(--warn);background:transparent">${I18N.t('hlth.clearSpool')}</button>`
          : '';
        return n > 0
          ? `<span style="color:var(--warn)">${n} ${I18N.t('hlth.spoolItems')}</span>${clrBtn}`
          : I18N.t('hlth.spoolEmpty');
      })()],
      ['Clip files', (h.storage.clips_files ?? 0).toLocaleString()],
      ['Clip size', (h.storage.clips_mb ?? 0) + ' MB'],
      ['Clips (24h)', (h.storage.clips_today ?? 0).toLocaleString()],
      ['Oldest clip', h.storage.clips_oldest_at ? new Date(h.storage.clips_oldest_at).toLocaleDateString('th-TH') : '—'],
      ['Disk free', h.storage.disk_free_gb != null  ? h.storage.disk_free_gb + ' GB'  : '—'],
      ['Disk total', h.storage.disk_total_gb != null ? h.storage.disk_total_gb + ' GB' : '—'],
    ]));

    cards.push(_healthCard('API Server', _healthBadge('ok', _humanSec(h.server.uptime_sec)), [
      ['Process uptime', _humanSec(h.server.uptime_sec)],
      ['Node version', h.server.node_version],
      ['PID', h.server.pid],
      ['RSS memory', h.server.memory_rss_mb + ' MB'],
      ['Heap used', h.server.memory_heap_mb + ' MB'],
      ['WebSocket clients', h.websocket.clients],
    ]));

    cards.push(_healthCard('Host', _healthBadge(hostLevel, `load ${h.server.load_avg_1m}`), [
      ['Hostname', h.server.hostname],
      ['Platform', h.server.platform],
      ['CPU cores', h.server.cpu_count ?? '—'],
      ['Load avg (1m)', loadRatio != null ? `${h.server.load_avg_1m} (${Math.round(loadRatio * 100)}% of ${h.server.cpu_count})` : h.server.load_avg_1m],
      ['Total RAM', h.server.total_mem_mb + ' MB'],
      ['Free RAM', h.server.free_mem_mb + ' MB'],
      ['Used', memPct + '%'],
    ]));

    // EM5 — Edge site cards (one per row in edge_status; empty if no heartbeat yet)
    for (const es of (h.edge_sites || [])) {
      const edgeLevel = es.stale ? 'warn' : 'ok';
      const badgeLabel = es.stale
        ? I18N.t('hlth.edgeStale') + ' ' + Math.round(es.stale_sec / 60) + 'm'
        : I18N.t('hlth.edgeLive');
      const svcRows = (es.services || []).map(s => [
        s.name,
        s.status + (s.restarts > 0 ? ` (↻${s.restarts})` : ''),
      ]);
      const diskStr = (es.disk_free_gb !== null && es.disk_total_gb !== null)
        ? `${es.disk_free_gb} / ${es.disk_total_gb} GB`
        : '—';
      // Snapshot inventory (oldest date-dir + count) — shows whether edge prune
      // is working: oldest should stay within the retention window.
      const snapStr = es.snapshot_oldest
        ? `${new Date(es.snapshot_oldest).toLocaleDateString('th-TH')} · ${es.snapshot_dirs} ${I18N.t('hlth.edgeDays','วัน')}`
        : '—';
      cards.push(_healthCard(
        `Edge — ${es.site_id.toUpperCase()}`,
        _healthBadge(edgeLevel, badgeLabel),
        [
          [I18N.t('hlth.edgeLastSeen'), es.last_seen_at ? new Date(es.last_seen_at).toLocaleTimeString('th-TH') : '—'],
          [I18N.t('hlth.edgeDisk'),     diskStr],
          [I18N.t('hlth.edgeSnapshots'), snapStr],
          ['Bridge remote',              es.bridge_remote || '—'],
          ['Bridge local',               es.bridge_local  || '—'],
          ['Forwarded / Dropped',        es.bridge_forwarded !== null ? `${es.bridge_forwarded} / ${es.bridge_dropped}` : '—'],
          [I18N.t('hlth.edgeServices'),  null],
          ...svcRows,
        ]
      ));
    }

    grid.innerHTML = cards.join('');
    const t = document.getElementById('healthLastUpdate');
    if (t) t.textContent = I18N.t('hlth.lastUpdate') + new Date(h.timestamp).toLocaleTimeString('th-TH', {hour12:false});
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:20px;background:var(--surface-elevated);border:1px solid var(--status-bad);border-radius:10px;color:var(--status-bad);font-size:12px">${escapeHtml(I18N.t('hlth.loadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}
