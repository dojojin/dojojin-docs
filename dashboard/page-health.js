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
  // กลับเข้าหน้า Health ขณะแท็บ perf/devices ค้างอยู่ — เริ่ม timer ของแท็บนั้นคืน (หยุดไว้ตอนออกจากหน้า)
  // เช็ค timer ก่อน — start*Refresh โหลดทันทีก่อนดู timer ⇒ ถ้า switchHealthTab เริ่มไปแล้ว จะยิง
  // /api/metrics/device (30–60 วิ) ซ้ำสองรอบ
  if (_healthTab === 'perf' && !_perfTimer) startPerfRefresh();
  if (_healthTab === 'devices' && !_devTimer) startDevRefresh();
  if (_healthTimer) return;
  _healthTimer = setInterval(loadHealth, 15000);
}
function stopHealthAutoRefresh() {
  if (_healthTimer) { clearInterval(_healthTimer); _healthTimer = null; }
  // เดิมหยุดเฉพาะตอนสลับแท็บใน Health ⇒ ออกจากหน้าแล้ว /api/metrics/device (30–61 วิ) และ devices ยังยิงต่อ
  // ทุก 60/30 วิ (audit 2026-10-02 · D10)
  stopPerfRefresh();
  stopDevRefresh();
}

function _healthBadge(level, label) {
  const c = level === 'ok' ? token('--status-ok') : level === 'warn' ? token('--warn')
          : level === 'idle' ? token('--text-secondary') : token('--status-bad');
  return `<span style="display:inline-block;padding:2px 8px;background:${c}26;color:${c};border-radius:99px;font-size:10px;font-weight:700">${escapeHtml(label)}</span>`;
}

// GOTCHAS #181 — แถวสำหรับการ์ด Database: transaction ที่เปิดค้าง + query ที่รันนาน
//
// ทำไมถึงต้องขึ้นหน้าจอ: ตอน incident 2026-08-27 ตัวเลขทั้งสองชุดนี้อยู่ใน payload
// ของ /api/health/details อยู่แล้ว แต่ไม่มีที่ยืนบน dashboard เลย คนจึงไม่มีทางรู้
// จนกว่าผู้ใช้จะมาบอกว่าหน้าสถิติว่าง (อาการที่อยู่ห่างจากสาเหตุหลายชั้น)
//
// คืนเป็น array ของ [label, value] ตามรูปที่ _healthCard รับ — value = null คือหัวข้อคั่น
function _dbStuckRows(longTx, longQry) {
  const dim  = (s) => `<span style="color:var(--text-secondary);font-weight:400">${escapeHtml(s)}</span>`;
  const warn = (s) => `<span style="color:var(--warn);font-weight:700">${escapeHtml(s)}</span>`;
  const rows = [];

  if (!longTx.length) {
    rows.push([I18N.t('hlth.longTxHead'), dim(I18N.t('hlth.longTxNone'))]);
  } else {
    rows.push([I18N.t('hlth.longTxHead'), null]);
    // จำกัด 5 แถว — ถ้าค้างพร้อมกันเป็นสิบ การไล่อ่านทุกตัวบนการ์ดไม่ได้ช่วยอะไร
    // ตัวที่เก่าสุดคือตัวที่ตรึง vacuum horizon อยู่ และ SQL เรียง xact_start มาแล้ว
    for (const t of longTx.slice(0, 5)) {
      rows.push([`pid ${t.pid} · ${t.state || '—'}`, warn(_humanSec(t.tx_age_sec))]);
    }
    if (longTx.length > 5) rows.push(['', dim(`+${longTx.length - 5}`)]);
    rows.push([I18N.t('hlth.longTxHint'), dim('')]);
  }

  // query ที่รันนานเป็นคนละอาการ: ตัวนี้ "กำลังทำงานอยู่" ส่วนข้างบนอาจไม่ทำอะไรเลย
  // แต่ยังตรึง vacuum ไว้ · แสดงคู่กันเพื่อให้แยกออกว่ากำลังเจออันไหน
  if (!longQry.length) {
    rows.push([I18N.t('hlth.longQryHead'), dim(I18N.t('hlth.longQryNone'))]);
  } else {
    rows.push([I18N.t('hlth.longQryHead'), null]);
    for (const q of longQry.slice(0, 5)) {
      rows.push([`pid ${q.pid}`, warn(_humanSec(Math.round((q.duration_ms || 0) / 1000)))]);
    }
    if (longQry.length > 5) rows.push(['', dim(`+${longQry.length - 5}`)]);
  }
  return rows;
}

function _healthCard(title, badge, rows) {
  const body = rows.map(([k, v]) => {
    // null v = section divider header
    if (v === null) return `<div style="margin:8px 0 4px;font-size:9px;font-weight:700;color:var(--text-secondary);letter-spacing:0.8px;text-transform:uppercase;border-top:1px solid var(--border-hairline);padding-top:6px">${escapeHtml(k)}</div>`;
    // The value must never be the thing that gets cut. It used to be capped at
    // 60% with ellipsis while the label was unbounded, so a long label — the
    // media mount path, /home/phuket-edge/vigil-platform/snapshots — squeezed the
    // number until "3632/3670 GB free" rendered as "3632/36…", hiding exactly
    // the figure the row exists to show. Now the label wraps and gives way, and
    // the value drops to its own line rather than truncating.
    return `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 10px;padding:5px 0;border-bottom:1px dashed var(--border-hairline);font-size:11px">
      <span style="color:var(--text-secondary);min-width:0;flex:1 1 auto;word-break:break-word">${escapeHtml(k)}</span>
      <span style="color:var(--text-primary);font-weight:600;text-align:right;white-space:nowrap;flex:0 0 auto;margin-left:auto">${v}</span>
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

// Storage/RAID health rows (2026-07-29) — shared between the central Storage
// card and each "Edge — SITE" card, since both now carry the same shape from
// src/helpers/storageHealth.js (mounts + mdraid), central sampled directly,
// edge riding the heartbeat (edge_status.storage_json).
function _storageHealthRows(st) {
  if (!st) return [[I18N.t('hlth.rowStatus'), '—']];
  const rows = [];
  for (const m of (st.mounts || [])) {
    const label = m.role === 'media' ? I18N.t('hlth.diskMedia', 'ดิสก์ Media') : I18N.t('hlth.diskSystem', 'ดิสก์ระบบ');
    const usedColor = m.used_pct > 90 ? 'var(--status-bad)' : m.used_pct > 75 ? 'var(--warn)' : 'var(--text-primary)';
    rows.push([`${label} (${escapeHtml(m.mount || m.path || '')})`,
      `<span style="color:${usedColor}">${m.used_pct}%</span> · ${m.free_gb}/${m.total_gb} GB ${I18N.t('hlth.free','ว่าง')}`]);
  }
  if (st.snapshot_dedicated != null) {
    rows.push([I18N.t('hlth.dedicatedMount', 'Snapshot แยกดิสก์'),
      st.snapshot_dedicated
        ? `<span style="color:var(--status-ok)">✓ ${I18N.t('hlth.yes', 'ใช่')}</span>`
        : I18N.t('hlth.notDedicated', 'ไม่ใช่ — รวมกับดิสก์ระบบ')]);
  }
  for (const r of (st.raid || [])) {
    const badge = r.degraded
      ? `<span style="color:var(--status-bad)">⚠ ${I18N.t('hlth.raidDegraded', 'เสียหาย')} (${escapeHtml(r.flags || '')})</span>`
      : `<span style="color:var(--status-ok)">${I18N.t('hlth.raidHealthy', 'ปกติ')} (${escapeHtml(r.flags || '')})</span>`;
    rows.push([`RAID ${escapeHtml(r.dev)} (${escapeHtml(r.level)})`, badge]);
    if (r.sync_action) {
      rows.push(['  ' + I18N.t('hlth.raidSync', 'กำลัง sync'),
        `${escapeHtml(r.sync_action)} ${r.sync_pct}%${r.sync_eta_min ? ' · ETA ' + r.sync_eta_min + 'min' : ''}`]);
    }
  }
  return rows;
}

// null = no sample yet (site hasn't shipped a heartbeat with this field) — 'idle',
// not 'ok', so a stale/missing sample doesn't read as a clean bill of health.
function _storageHealthLevel(st) {
  if (!st) return 'idle';
  if ((st.raid || []).some(r => r.degraded)) return 'err';
  if ((st.mounts || []).some(m => m.used_pct > 90)) return 'warn';
  return 'ok';
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

// ยอดสะสมที่ backend คำนวณจาก reltuples / rollup — เติม ≈ ให้ผู้ใช้รู้ว่าไม่ใช่ค่านับจริง
function _apxNum(v, approx) {
  return (approx ? '≈' : '') + (v ?? 0).toLocaleString();
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

    // GOTCHAS #181 — ทั้งสองตัวนี้อยู่ใน payload มานานแล้วแต่ไม่เคยมีที่ยืนบนหน้าจอ
    // ตอนที่ transaction ค้าง 34 ชม. ทำหน้าสถิติล่ม ตัวเลขบอกความจริงมีอยู่ครบ
    // แค่ไม่มีใครเห็น · long_running_queries คืน { error } แทน array ได้ตอน pool ตัน
    const longTx  = Array.isArray(h.db.long_transactions) ? h.db.long_transactions : [];
    const longQry = Array.isArray(h.db.long_running_queries) ? h.db.long_running_queries : [];

    // transaction ค้าง = ปัญหาที่ลุกลามช้า ๆ ไปทั้งระบบ ไม่ใช่แค่ DB ช้าตอนนี้
    // จึงให้มันชนะ latency ในการตัดสิน badge — ไม่งั้นการ์ดขึ้นเขียวทั้งที่กำลังพัง
    const dbBadge = !h.db.ok ? _healthBadge('err', 'DOWN')
      : longTx.length      ? _healthBadge('warn', `${longTx.length} STUCK TX`)
      : _healthBadge('ok', `${h.db.latency_ms}ms`);
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

    // Cards are bucketed by tab instead of pushed into one flat list. The
    // grouping is the only change — each card's contents are untouched, so the
    // tab split cannot alter what any of them reports.
    const tabs = { overview: [], services: [], storage: [], server: [] };

    tabs.overview.push(_healthCard('Database (PostgreSQL)', dbBadge, [
      [I18N.t('hlth.rowStatus'), h.db.ok ? '✓ Connected' : '✗ ' + (h.db.error || 'unreachable')],
      ['Latency', h.db.latency_ms != null ? h.db.latency_ms + ' ms' : '—'],
      // ≈ เมื่อ backend บอกว่าเป็นค่าประมาณ (reltuples / event_dim_bucket rollup —
      // ดู src/routes/health.js event_counts). label เป็น literal อยู่แล้ว ไม่ต้องเพิ่ม i18n key
      ['Total events', _apxNum(h.events.total, h.events.totals_approx)],
      ['  · Face (all time)', _apxNum(h.events.face_total, h.events.totals_approx)],
      ['  · LPR (all time)', _apxNum(h.events.lpr_total, h.events.totals_approx)],
      ...(_dbStuckRows(longTx, longQry)),
    ]));

    // ความถูกต้องของระบบ — สัญญาณของบั๊กเงียบที่เจอ 2026-10-02 (GOTCHAS #217) · ค่าว่าง = ยังไม่มีข้อมูล
    const ig = h.integrity;
    if (ig) {
      const stuck = ig.cameras_stuck_offline || [];
      const upt = ig.unknown_push_tokens || {};
      const unknownPush = Object.keys(upt).length ? Object.values(upt).reduce((a, b) => a + b, 0) : null;
      const bad = (ig.future_events > 0) + ig.baseline_stale + (ig.ws_bridge_connected === false) + (stuck.length > 0)
                + (ig.disk_io_errors_24h > 0) + (unknownPush > 0);
      const yes = I18N.t('hlth.intOk', 'ปกติ'), no = I18N.t('hlth.intBad', 'ต้องตรวจ');
      const rows = [
        [I18N.t('hlth.intFuture', 'event เวลาอนาคต'), ig.future_events > 0 ? `${ig.future_events} · ${no}` : '0'],
        [I18N.t('hlth.intBaseline', 'ฐานกล้องเงียบ คำนวณล่าสุด'), ig.baseline_computed_at
          ? new Date(ig.baseline_computed_at).toLocaleString('th-TH', { hour12: false }) + (ig.baseline_stale ? ` · ${no}` : '')
          : no],
        [I18N.t('hlth.intWsBridge', 'ท่อ event สดของหน้าจอ'), ig.ws_bridge_connected === null ? '—' : ig.ws_bridge_connected ? yes : no],
        [I18N.t('hlth.intStuck', 'กล้องมี heartbeat แต่ยังถูกนับ offline'), stuck.length ? `${stuck.length} · ${no}` : '0'],
        [I18N.t('hlth.intDiskIo', 'ดิสก์ I/O error (24 ชม.)'), ig.disk_io_errors_24h == null ? '—'
          : ig.disk_io_errors_24h > 0 ? `${ig.disk_io_errors_24h} · ${no}` : '0'],
        [I18N.t('hlth.intUnknownPush', 'push จากกล้องที่ token ไม่ตรง (10 นาที)'), unknownPush == null ? '—'
          : unknownPush > 0 ? `${unknownPush.toLocaleString()} · ${no}` : '0'],
      ];
      // ชื่อกล้องอยู่ฝั่ง label (ตัดบรรทัดได้) ไม่ใช่ฝั่งค่าที่ห้ามตัด — กันล้นจอมือถือ
      if (stuck.length) rows.push([stuck.join(', '), '']);
      tabs.overview.push(_healthCard(I18N.t('hlth.integrity', 'ความถูกต้องของระบบ'),
        _healthBadge(bad ? 'warn' : 'ok', bad ? no : yes), rows));
    }

    // สุขภาพฐานข้อมูล — ผลยามรายวัน (helpers/perfWatch.js 18:25) · preventive P3 2026-10-06
    const dh = h.db_health;
    if (dh) {
      const yes = I18N.t('hlth.intOk', 'ปกติ'), no = I18N.t('hlth.intBad', 'ต้องตรวจ');
      const stale = dh.stale_tables || [];
      const lowDisk = dh.disk_days_left != null && dh.disk_days_left < 30;
      const slow = dh.slow_req != null && dh.slow_req_limit != null && dh.slow_req > dh.slow_req_limit;
      const bad = (dh.regressions > 0) + (dh.fresh > 0) + (stale.length > 0) + lowDisk + slow;
      const perDay = I18N.t('hlth.perDay', '/วัน'), days = I18N.t('hlth.days', 'วัน');
      const rows = [
        [I18N.t('hlth.dbSize', 'ขนาดฐานข้อมูล'), dh.db_gb == null ? '—'
          : `${dh.db_gb.toLocaleString()} GB` + (dh.growth_gb_per_day != null ? ` · +${dh.growth_gb_per_day} GB${perDay}` : '')],
        [I18N.t('hlth.dbDiskDays', 'ดิสก์พอใช้อีก'), dh.disk_days_left == null ? '—'
          : `~${dh.disk_days_left.toLocaleString()} ${days}` + (lowDisk ? ` · ${no}` : '')],
        [I18N.t('hlth.dbSlowReq', 'คำขอเกิน 2 วิ'), dh.slow_req == null ? '—'
          : `${dh.slow_req.toLocaleString()}` + (slow ? ` · ${no}` : '')],
        [I18N.t('hlth.dbSlowQueries', 'query ช้าลง / query ใหม่ที่ช้า'),
          `${dh.regressions} / ${dh.fresh}` + (dh.regressions || dh.fresh ? ` · ${no}` : '')],
        [I18N.t('hlth.dbStaleTables', 'ตารางที่ไม่ถูก analyze'), stale.length ? `${stale.length} · ${no}` : '0'],
        [I18N.t('hlth.dbUnusedIdx', 'index ใหญ่ที่ไม่ถูกใช้'), `${dh.unused_indexes} · ${dh.unused_index_gb} GB`],
        [I18N.t('hlth.dbCheckedAt', 'ตรวจล่าสุด'), dh.checked_day || '—'],
      ];
      if (stale.length) rows.push([stale.join(', '), '']);
      tabs.overview.push(_healthCard(I18N.t('hlth.dbHealth', 'สุขภาพฐานข้อมูล'),
        _healthBadge(bad ? 'warn' : 'ok', bad ? no : yes), rows));
    }

    tabs.overview.push(_healthCard('MQTT Pipeline', _healthBadge(mqttLevel, h.mqtt_pipeline.status.toUpperCase()), [
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
    tabs.overview.push(_healthCard('Alerts (LINE · 24h)', _healthBadge(alLevel, alLabel), [
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
    tabs.overview.push(_healthCard('Cameras', _healthBadge(camCardLevel, `${h.cameras.online}/${h.cameras.total} online`), [
      ['Status', null],
      ['Total', h.cameras.total],
      ['Online (heartbeat <90s)', h.cameras.online],
      ['Offline / unknown', h.cameras.offline],
      ['Paused', h.cameras.paused || 0],
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
    tabs.services.push(_svcCard(h.services || []));


    tabs.server.push(_healthCard('API Server', _healthBadge('ok', _humanSec(h.server.uptime_sec)), [
      ['Process uptime', _humanSec(h.server.uptime_sec)],
      ['Node version', h.server.node_version],
      ['PID', h.server.pid],
      ['RSS memory', h.server.memory_rss_mb + ' MB'],
      ['Heap used', h.server.memory_heap_mb + ' MB'],
      ['WebSocket clients', h.websocket.clients],
    ]));

    // Host spec data (CPU, RAM, OS)
    const spec = h.server.spec || {};
    tabs.server.push(_healthCard('Host', _healthBadge(hostLevel, `load ${h.server.load_avg_1m}`), [
      ['Hostname', h.server.hostname],
      [I18N.t('hlth.cpuModel'), spec.cpu_model || '—'],
      [I18N.t('hlth.cpuCores'), (spec.cpu_cores ?? h.server.cpu_count ?? '—') + (spec.arch ? ` (${spec.arch})` : '')],
      [I18N.t('hlth.loadAvg'), `${h.server.load_avg_1m} / ${h.server.load_avg_5m ?? '—'} / ${h.server.load_avg_15m ?? '—'}`],
      [I18N.t('hlth.loadPct'), loadRatio != null ? `${Math.round(loadRatio * 100)}%` : '—'],
      [I18N.t('hlth.hostUptime'), h.server.host_uptime_sec != null ? _humanSec(h.server.host_uptime_sec) : '—'],
      ['Total RAM', (spec.mem_total_mb ?? h.server.total_mem_mb ?? 0) + ' MB'],
      [I18N.t('hlth.swap'), spec.swap_total_mb != null ? spec.swap_total_mb + ' MB' : I18N.t('hlth.none')],
      ['Free RAM', h.server.free_mem_mb + ' MB'],
      [I18N.t('hlth.ramUsed'), memPct + '%'],
      [I18N.t('hlth.os'), spec.os_pretty || h.server.platform || '—'],
      [I18N.t('hlth.kernel'), spec.kernel || '—'],
      [I18N.t('hlth.timezone'), spec.timezone || '—'],
    ]));

    // EM5 — Edge site cards (one per row in edge_status; empty if no heartbeat yet)
    // Storage moved to Storage tab (2026-08-31) — this card shows liveness + host spec
    for (const es of (h.edge_sites || [])) {
      // ไซต์ปิดปรับปรุง (sites.status <> 'active') เงียบอยู่โดยตั้งใจ — ไม่ใช่ขาดการติดต่อ
      const inMaint = !!es.status && es.status !== 'active';
      const badgeLabel = es.stale
        ? I18N.t('hlth.edgeStale') + ' ' + Math.round(es.stale_sec / 60) + 'm'
        : I18N.t('hlth.edgeLive');
      const edgeBadge = inMaint
        ? _healthBadge('idle', es.status === 'archived' ? I18N.t('hlth.edgeArchived', 'เก็บถาวร') : I18N.t('hlth.edgeMaintenance', 'ปิดปรับปรุง'))
        : _healthBadge(es.stale ? 'warn' : 'ok', badgeLabel);
      const edgeSpec = es.host_spec || {};
      // Edge info card lives on the Server tab — read-only per-machine status
      // (each edge's liveness + host spec + bridge queue)
      const edgeRows = [
        [I18N.t('hlth.edgeLastSeen'), es.last_seen_at ? new Date(es.last_seen_at).toLocaleTimeString('th-TH') : '—'],
      ];
      if (edgeSpec.cpu_model) edgeRows.push(['CPU', edgeSpec.cpu_model]);
      if (edgeSpec.cpu_cores) edgeRows.push(['CPU cores', edgeSpec.cpu_cores + (edgeSpec.arch ? ` (${edgeSpec.arch})` : '')]);
      if (edgeSpec.mem_total_mb) edgeRows.push(['Total RAM', edgeSpec.mem_total_mb + ' MB']);
      if (edgeSpec.swap_total_mb != null) edgeRows.push(['Swap', edgeSpec.swap_total_mb + ' MB']);
      if (edgeSpec.os_pretty) edgeRows.push(['OS', edgeSpec.os_pretty]);
      if (edgeSpec.kernel) edgeRows.push(['Kernel', edgeSpec.kernel]);
      if (edgeSpec.timezone) edgeRows.push(['Timezone', edgeSpec.timezone]);
      edgeRows.push(['Bridge remote', es.bridge_remote || '—']);
      edgeRows.push(['Bridge local', es.bridge_local || '—']);
      edgeRows.push(['Forwarded / Dropped', es.bridge_forwarded !== null ? `${es.bridge_forwarded} / ${es.bridge_dropped}` : '—']);
      tabs.server.push(_healthCard(
        `Edge — ${es.site_id.toUpperCase()}`,
        edgeBadge,
        edgeRows
      ));
      // Service control stays on the Services tab (2026-07-29 owner call) —
      // Server tab = read-only info, Services tab = anything actionable. Same
      // card, own push, rather than more rows on the info card above: these are
      // buttons that reach across the network into another machine, and
      // burying them under six read-only stats invites a mis-click.
      tabs.services.push(_edgeSvcCard(es));
    }

    grid.innerHTML = tabs.overview.join('');
    _setGrid('healthGridSvc',     tabs.services);
    // Storage tab renders itself from /api/storage — health page pushes nothing to it
    _setGrid('healthGridServer',  tabs.server);
    const t = document.getElementById('healthLastUpdate');
    if (t) t.textContent = I18N.t('hlth.lastUpdate') + new Date(h.timestamp).toLocaleTimeString('th-TH', {hour12:false});
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:20px;background:var(--surface-elevated);border:1px solid var(--status-bad);border-radius:10px;color:var(--status-bad);font-size:12px">${escapeHtml(I18N.t('hlth.loadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

// ============================================================
// Health tabs + Performance charts (H1 / P4, 2026-07-27)
// ============================================================
function _setGrid(id, cards) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = cards.join('');
}

const _HEALTH_PANELS = {
  overview: 'healthGrid',
  services: 'healthGridSvc',
  devices:  'healthGridDevices',
  perf:     'healthGridPerf',
  storage:  'healthGridStorage',
  server:   'healthGridServer',
  hcp:      'healthGridHcp',
  relay:    'healthGridRelay',
};
let _healthTab = 'overview';
// ลำดับที่ใช้เลือก "แท็บแรกที่ผู้ใช้มีสิทธิ์" ตอนเปิดหน้า (dashboard.js showPage)
const HEALTH_TAB_KEYS = Object.keys(_HEALTH_PANELS);

function switchHealthTab(tab) {
  if (!_HEALTH_PANELS[tab]) return;
  _healthTab = tab;
  document.querySelectorAll('#healthTabBar .tab').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`#healthTabBar .tab[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');
  for (const [k, id] of Object.entries(_HEALTH_PANELS)) {
    const el = document.getElementById(id);
    if (el) el.hidden = (k !== tab);
  }
  // Charts are fetched on open, never with the rest of the page — and the
  // polling stops the moment the tab is left, so a dashboard parked on
  // Overview costs nothing extra.
  if (tab === 'perf') startPerfRefresh(); else stopPerfRefresh();
  if (tab === 'devices') startDevRefresh(); else stopDevRefresh();
  // HCP ดึงตอนเปิดแท็บครั้งเดียว ไม่ poll — คำขอหนึ่งครั้งเดินข้าม tunnel ไปนับ
  // อุปกรณ์ 2,400 ตัวที่ภูเก็ต ไม่ใช่ของที่ควรยิงทุก 30 วินาที
  if (tab === 'hcp') loadHcpDevices();
  // Relay ดึงใหม่ทุกครั้งที่เปิดแท็บ — endpoint เบา (~100ms) และหน้านี้มีไว้
  // ยืนยันสถานะสด การแคชจะทำให้ตัวเลข 24 ชม. ค้างโดยไม่มีสัญญาณบอก
  if (tab === 'relay') loadRelay();
  // หน้าจัดการพื้นที่ย้ายมารวมที่แท็บนี้ (2026-08-24) — โหลดตอนเปิดแท็บ ไม่ใช่ตอนเปิดหน้า
  // สแกนล่าสุดเป็นค่าที่เก็บไว้ อ่านเร็ว แต่ไม่มีเหตุให้ยิงถ้าคนไม่ได้เปิดดู
  if (tab === 'storage' && typeof initStoragePageOnce === 'function') initStoragePageOnce();
}

// ── Performance ─────────────────────────────────────────────
let _perfTimer = null;
let _perfHours = 6;
const _perfCharts = {};      // canvas id → Chart, so re-renders replace rather than stack

function startPerfRefresh() {
  loadPerf();
  if (_perfTimer) return;
  // 60s, matching the sample rate. Polling faster cannot show anything new —
  // it would only re-query for rows that are not there yet.
  _perfTimer = setInterval(loadPerf, 60000);
}
function stopPerfRefresh() {
  if (_perfTimer) { clearInterval(_perfTimer); _perfTimer = null; }
}

function setPerfRange(hours, btn) {
  _perfHours = Number(hours) || 6;
  document.querySelectorAll('#perfRangeBar .tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadPerf();
}

// Colours come from the CSS tokens, so the charts follow the theme (and any
// white-label re-theme) instead of hardcoding hex that only suits dark mode.
function _perfPalette() {
  return {
    grid:  token('--border-hairline'),
    text:  token('--text-secondary'),
    accent: token('--accent'),
    ok:    token('--status-ok'),
    warn:  token('--warn'),
    bad:   token('--status-bad'),
  };
}

function _lineChart(canvasId, datasets, opts = {}) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const p = _perfPalette();
  if (_perfCharts[canvasId]) _perfCharts[canvasId].destroy();
  _perfCharts[canvasId] = new Chart(el, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: false,                       // a 60s repaint that slides is just noise
      interaction: { mode: 'index', intersect: false },
      elements: { point: { radius: 0, hitRadius: 8 }, line: { borderWidth: 1.6, tension: 0.25 } },
      scales: {
        x: {
          type: 'time',
          // ⚠️ ตั้งแต่ tooltipFormat อย่างเดียวไม่พอ — `displayFormats` คุมป้ายบนแกน
          // ซึ่งเป็นคนละตัวกับ tooltip · ไม่ตั้ง = Chart.js ใช้ default ของ en-US
          // แบบ 12 ชั่วโมง แล้วแกนจะขึ้น "10AM" / "3:05 p.m." ขัดกับทั้ง dashboard
          // ที่ใช้ th-TH + hour12:false · ต้องใส่ทุก unit ที่ Chart.js อาจเลือกเอง
          // ตามช่วงข้อมูล (เครื่องที่เพิ่งออนไลน์มีข้อมูลไม่ถึงชั่วโมง → unit=minute)
          time: {
            tooltipFormat: 'dd/MM HH:mm',
            displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'dd/MM' },
          },
          grid: { color: p.grid }, ticks: { color: p.text, font: { size: 9 }, maxTicksLimit: 6 },
        },
        y: {
          beginAtZero: true, suggestedMax: opts.max,
          grid: { color: p.grid },
          ticks: { color: p.text, font: { size: 9 }, maxTicksLimit: 5, callback: opts.fmt },
        },
      },
      plugins: {
        legend: { display: datasets.length > 1, labels: { color: p.text, boxWidth: 8, font: { size: 9 } } },
        tooltip: { callbacks: opts.tip ? { label: opts.tip } : undefined },
      },
    },
  });
}

function _perfCard(title, canvasId, sub = '') {
  return `<div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:10px;padding:12px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700">${escapeHtml(title)}</div>
      <div style="font-size:10px;color:var(--text-secondary)">${sub}</div>
    </div>
    <div class="perf-chart-wrap"><canvas id="${canvasId}"></canvas></div>
  </div>`;
}

async function loadPerf() {
  const host = document.getElementById('perfHosts');
  if (!host) return;
  try {
    const srcRes = await fetch(`${API}/api/metrics/sources`, { credentials: 'include' });
    if (!srcRes.ok) throw new Error('HTTP ' + srcRes.status);
    const sources = (await srcRes.json()).sources || [];
    if (!sources.length) {
      host.innerHTML = `<div style="padding:20px;color:var(--text-secondary);font-size:12px">${escapeHtml(I18N.t('hlth.perfNoData', 'ยังไม่มีข้อมูล — เริ่มเก็บทุก 60 วินาที รอสักครู่แล้วรีเฟรช'))}</div>`;
      return;
    }
    const to = new Date();
    const from = new Date(to.getTime() - _perfHours * 3600_000);
    const q = `from=${from.toISOString()}&to=${to.toISOString()}`;
    const series = await Promise.all(sources.map(async s => {
      const r = await fetch(`${API}/api/metrics/host?source=${encodeURIComponent(s.source)}&${q}`,
                            { credentials: 'include' });
      return r.ok ? await r.json() : { source: s.source, series: [] };
    }));

    const meta = document.getElementById('perfMeta');
    if (meta) {
      const b = series[0]?.bucket_sec;
      meta.textContent = `${sources.length} ${I18N.t('hlth.perfMachines', 'เครื่อง')} · `
        + `${I18N.t('hlth.perfBucket', 'ช่วงละ')} ${b >= 3600 ? (b / 3600) + ' ชม.' : (b / 60) + ' นาที'}`;
    }

    // Layout: the three ratio metrics go on ONE chart each so machines can be
    // read against each other — that comparison is the reason for putting them
    // on one screen, and % is the only unit under which a 4-core edge and a
    // 20-core central mean the same thing. Throughput gets a chart per machine
    // because rx and tx are already two lines and stacking three machines on
    // top would be six.
    const colours = [_perfPalette().accent, _perfPalette().ok, _perfPalette().warn, _perfPalette().bad];
    const pct = (v) => v == null ? null : Math.round(v * 10) / 10;
    const cards = [
      _perfCard(I18N.t('hlth.perfCpu', 'CPU'), 'perfCpu', '%'),
      _perfCard(I18N.t('hlth.perfMem', 'หน่วยความจำ'), 'perfMem', '% ' + I18N.t('hlth.perfOfTotal', 'ของทั้งหมด')),
      _perfCard(I18N.t('hlth.perfDisk', 'พื้นที่ดิสก์'), 'perfDisk', '% ' + I18N.t('hlth.perfUsed', 'ที่ใช้ไป')),
      ...series.map(s => _perfCard(
        `${I18N.t('hlth.perfNet', 'เครือข่าย')} — ${s.source.toUpperCase()}`,
        `perfNet_${s.source}`, 'Mbps')),
      _perfCard(I18N.t('hlth.perfTunnel', 'Cloudflare Tunnel'), 'perfTunnel', '% ' + I18N.t('hlth.perfUptime', 'เวลาที่ online')),
      _perfCard(I18N.t('hlth.perfTailscale', 'Tailscale'), 'perfTailscale', '% ' + I18N.t('hlth.perfUptime', 'เวลาที่ online')),
      _perfCard(I18N.t('hlth.perfDevices', 'อุปกรณ์ที่ทำงานหนักสุด'), 'perfDevices',
        I18N.t('hlth.perfEventsPerBucket', 'เหตุการณ์ต่อช่วง')),
    ];
    host.innerHTML = cards.join('');

    const ds = (s, i, pick) => ({
      label: s.source.toUpperCase(),
      borderColor: colours[i % colours.length],
      backgroundColor: 'transparent',
      spanGaps: false,                   // a gap means "not measured" — do not invent a line across it
      data: (s.series || []).map(r => ({ x: new Date(r.t), y: pick(r) })),
    });

    _lineChart('perfCpu', series.map((s, i) => ds(s, i, r => pct(r.cpu_pct))),
      { max: 100, fmt: v => v + '%', tip: c => `${c.dataset.label}: ${c.parsed.y}%` });

    _lineChart('perfMem', series.map((s, i) => ds(s, i,
      r => r.mem_total_mb ? pct(100 * r.mem_used_mb / r.mem_total_mb) : null)),
      { max: 100, fmt: v => v + '%', tip: c => `${c.dataset.label}: ${c.parsed.y}%` });

    _lineChart('perfDisk', series.map((s, i) => ds(s, i,
      r => r.disk_total_gb ? pct(100 * (1 - r.disk_free_gb / r.disk_total_gb)) : null)),
      { max: 100, fmt: v => v + '%', tip: c => `${c.dataset.label}: ${c.parsed.y}%` });

    // Tunnel/Tailscale (2026-07-29) — % of each bucket the machine was up, not
    // a last-value snapshot (see /api/metrics/host's avg()-over-bucket comment).
    // A source with no data at all for either (CLI missing, never sampled) just
    // draws no line — spanGaps:false already handles that, same as Net above.
    _lineChart('perfTunnel', series.map((s, i) => ds(s, i, r => pct(r.tunnel_pct))),
      { max: 100, fmt: v => v + '%', tip: c => `${c.dataset.label}: ${c.parsed.y}%` });

    _lineChart('perfTailscale', series.map((s, i) => ds(s, i, r => pct(r.tailscale_pct))),
      { max: 100, fmt: v => v + '%', tip: c => `${c.dataset.label}: ${c.parsed.y}%` });

    for (const s of series) {
      const p = _perfPalette();
      const toMbps = (bps) => bps == null ? null : Math.round(bps * 8 / 1e6 * 100) / 100;
      _lineChart(`perfNet_${s.source}`, [
        { label: 'in',  borderColor: p.accent, backgroundColor: 'transparent', spanGaps: false,
          data: (s.series || []).map(r => ({ x: new Date(r.t), y: toMbps(r.rx_bps) })) },
        { label: 'out', borderColor: p.warn,   backgroundColor: 'transparent', spanGaps: false,
          data: (s.series || []).map(r => ({ x: new Date(r.t), y: toMbps(r.tx_bps) })) },
      ], { fmt: v => v + 'M', tip: c => `${c.dataset.label}: ${c.parsed.y} Mbps` });
    }

    _renderDiskForecast(series);
    await _loadDeviceActivity(q);
  } catch (e) {
    host.innerHTML = `<div style="padding:20px;color:var(--status-bad);font-size:12px">${escapeHtml(I18N.t('hlth.loadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

// The number that makes the disk graph actionable rather than decorative. Only
// shown when the backend was willing to commit to a slope — it returns null on
// a flat or rising trend rather than projecting a fantasy.
function _renderDiskForecast(series) {
  const warn = series
    .filter(s => s.disk_forecast && s.disk_forecast.days_to_full != null)
    .sort((a, b) => a.disk_forecast.days_to_full - b.disk_forecast.days_to_full);
  const el = document.getElementById('perfDisk');
  if (!warn.length || !el) return;
  const card = el.closest('div[style*="surface-elevated"]');
  if (!card) return;
  const worst = warn[0];
  const d = worst.disk_forecast;
  const level = d.days_to_full < 30 ? '--status-bad' : d.days_to_full < 90 ? '--warn' : '--text-secondary';
  const note = document.createElement('div');
  note.style.cssText = `margin-top:8px;font-size:10px;color:var(${level})`;
  note.textContent = `${worst.source.toUpperCase()}: -${d.gb_per_day} GB/${I18N.t('hlth.perfDay', 'วัน')} · `
    + `${I18N.t('hlth.perfFullIn', 'เต็มในอีก')} ~${d.days_to_full} ${I18N.t('hlth.perfDays', 'วัน')}`;
  card.appendChild(note);
}

// ── Edge service control (H2) ───────────────────────────────
// Mirrors _svcCard, with the differences that matter across a network hop:
// the site id travels with every button, and the last reply from that edge is
// shown, because "did my click reach the other machine" is not obvious here the
// way it is for a local pm2 call.
const _EDGE_SVC_NO_STOP = new Set(['nanomq', 'mosquitto', 'edge-bridge', 'edge-config-agent']);

function _edgeSvcCard(es) {
  const svcs = es.services || [];
  const site = es.site_id;
  const anyDown = svcs.some(s => s.status !== 'online');
  const btnBase = 'padding:2px 8px;font-size:10px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid';
  const rows = svcs.map(s => {
    const lvl = s.status === 'online' ? 'ok' : s.status === 'errored' ? 'err' : 'warn';
    const nm = escapeHtml(s.name);
    const sid = escapeHtml(site);
    const restartNote = s.restarts > 0 ? ` <span style="color:var(--warn);font-size:9px">(↺${s.restarts})</span>` : '';
    const uptime = s.uptime_ms != null ? _humanSec(Math.round(s.uptime_ms / 1000)) : '—';
    // No Stop for the three that carry the command channel — the button is not
    // rendered at all rather than rendered and rejected, so nobody spends an
    // incident wondering why it does nothing. The API refuses them too.
    const canStop  = !_EDGE_SVC_NO_STOP.has(s.name) && s.status !== 'stopped';
    const canStart = !_EDGE_SVC_NO_STOP.has(s.name) && s.status === 'stopped';
    const btn = (cmd, colour, label) =>
      `<button class="admin-only" data-action="edgeSvcAction" data-edge-site="${sid}" data-svc="${nm}" data-svc-cmd="${cmd}" `
      + `style="${btnBase} var(${colour});color:var(${colour});background:transparent" title="${label}">${label}</button>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 0;border-bottom:1px dashed var(--border-hairline)">
      <div style="min-width:0;flex:1;overflow:hidden">
        <div style="font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nm}${restartNote}</div>
        <div style="font-size:9px;color:var(--text-secondary)">${uptime}</div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        ${_healthBadge(lvl, s.status.toUpperCase())}
        ${btn('restart', '--accent', I18N.t('hlth.svcRestart'))}
        ${canStop  ? btn('stop',  '--warn',      I18N.t('hlth.svcStop'))  : ''}
        ${canStart ? btn('start', '--status-ok', I18N.t('hlth.svcStart')) : ''}
      </div>
    </div>`;
  }).join('');

  // Last reply from this edge. Worth its own line because the interesting cases
  // are the ones a 202 cannot tell you about: pm2 failed, or the stop was refused.
  let last = '';
  const r = es.last_svc_result;
  if (r) {
    const okCol = r.ok ? '--status-ok' : '--status-bad';
    const when = r.at ? new Date(r.at).toLocaleTimeString('th-TH', { hour12: false }) : '';
    last = `<div style="margin-top:8px;font-size:10px;color:var(${okCol})">`
      + `${escapeHtml(when)} · ${escapeHtml(r.action || '')} ${escapeHtml(r.name || '')} — `
      + `${r.ok ? I18N.t('hlth.edgeSvcOk', 'สำเร็จ') : escapeHtml(r.error || 'failed')}</div>`;
  }

  return `<div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:10px;padding:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:12px;font-weight:700">${I18N.t('hlth.edgeSvcTitle', 'จัดการบริการ')} — ${escapeHtml(site.toUpperCase())}</div>
      ${_healthBadge(anyDown ? 'warn' : 'ok', anyDown ? 'CHECK' : 'OK')}
    </div>
    ${rows || `<div style="font-size:11px;color:var(--text-secondary)">—</div>`}
    ${last}
  </div>`;
}

window._edgeSvcAction = async function (site, name, action) {
  const label = `${action.toUpperCase()} ${name} @ ${site.toUpperCase()}`;
  // Confirm every action, not just stop. On central a wrong restart is a local
  // blip someone can watch; here it is a process on a remote site that nobody is
  // standing next to, so the cost of a mis-click is higher, not lower.
  if (!confirm(`${I18N.t('hlth.edgeSvcConfirm', 'ยืนยันสั่งงาน edge')}\n\n${label}`)) return;
  try {
    const res = await fetch(`${API}/api/edge/${encodeURIComponent(site)}/services/${encodeURIComponent(name)}/${encodeURIComponent(action)}`,
      { method: 'POST', credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`${I18N.t('hlth.edgeSvcFailed', 'สั่งงานไม่สำเร็จ')}: ${body.error || res.status}`);
      return;
    }
    // 202 means the broker took it, not that it ran. Reload after a beat so the
    // edge's reply — which lands on edge_status within about a second — is on
    // screen; that line is the real answer.
    setTimeout(loadHealth, 2500);
  } catch (e) {
    alert(`${I18N.t('hlth.edgeSvcFailed', 'สั่งงานไม่สำเร็จ')}: ${e.message}`);
  }
};

// ── Devices / Maintenance tab (H3) ──────────────────────────
// Grouped the way maintenance is actually done — by what the device is for,
// with the NVR chassis as its own row rather than as N camera failures.
const _DEV_STATE = {
  online:   ['--status-ok',     'hlth.devOnline'],
  quiet:    ['--text-secondary','hlth.devQuiet'],
  offline:  ['--status-bad',    'hlth.devOffline'],
  paused:   ['--warn',          'hlth.devPaused'],
  disabled: ['--text-secondary','hlth.devDisabled'],
  unknown:  ['--warn',          'hlth.devUnknown'],
};

function _devAge(sec) {
  if (sec == null) return I18N.t('hlth.devNever', 'ไม่เคย');
  return _humanSec(sec);
}

function _devDot(state) {
  const [tok] = _DEV_STATE[state] || _DEV_STATE.unknown;
  return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(${tok});flex:0 0 auto"></span>`;
}

// Cached once, lazily — Health can be opened without ever visiting the
// Cameras page, so page-cameras.js's own _siteById cache can't be relied on
// (it's only populated by loadCameras()). Named _healthSites/_healthSiteById
// (not _sites/_siteById) — those identifiers already belong to page-cameras.js
// and every dashboard *.js loads as a classic script sharing one top-level
// scope, so reusing the name would be a redeclaration error.
let _healthSites = [];
let _healthSiteById = null;
async function _ensureHealthSites() {
  if (_healthSiteById) return _healthSiteById;
  _healthSiteById = {};
  try {
    const r = await fetch(`${API}/api/sites`, { credentials: 'include' });
    if (r.ok) {
      _healthSites = await r.json();
      for (const s of _healthSites) _healthSiteById[s.id] = s;
    }
  } catch { /* no badge beats a wrong one */ }
  return _healthSiteById;
}
function _siteBadge(siteId) {
  const s = _healthSiteById && _healthSiteById[siteId];
  if (!s) return '';
  const dot = s.color ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${escapeHtml(s.color)}"></span>` : '';
  return `<span style="display:inline-flex;align-items:center;gap:3px">${dot}${escapeHtml(s.name)}</span>`;
}

function _devRow(d) {
  const [tok, key] = _DEV_STATE[d.state] || _DEV_STATE.unknown;
  const label = I18N.t(key);
  // Quiet is the state most likely to be misread as a fault, so it says why.
  const title = d.state === 'quiet' ? ` title="${escapeHtml(I18N.t('hlth.devQuietHint'))}"` : '';
  const siteBadge = _siteBadge(d.site_id);
  // Split across 2 lines (site+vendor / model+ip) instead of cramming all 4
  // onto one — the row was reading as too tight with everything on one line.
  const subLine1 = d.vendor || '';
  const subLine2 = [d.model, d.ip].filter(Boolean).join(' · ');
  // Rule (IVA task) name check (Bosch, hourly — see Health API vca_rule_issues).
  // A name cut past Bosch's 64-byte cap makes the MQTT broker drop or
  // disconnect the camera, so this is the one warning that stays visible next
  // to an otherwise-online device.
  const vcaReasonKey = { bad_utf8: 'hlth.vcaReasonBadUtf8', at_limit: 'hlth.vcaReasonAtLimit', wildcard: 'hlth.vcaReasonWildcard', control_char: 'hlth.vcaReasonControlChar' };
  const vcaChip = (Array.isArray(d.vca_rule_issues) && d.vca_rule_issues.length)
    ? (() => {
        const tip = d.vca_rule_issues.map(i => `${i.name || i.id} — ${I18N.t(vcaReasonKey[i.problem] || 'hlth.vcaReasonBadUtf8')}`).join('\n');
        return `<div title="${escapeHtml(tip)}" style="font-size:9px;color:var(--warn);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(I18N.t('hlth.vcaRuleIssue').replace('{n}', d.vca_rule_issues.length))}</div>`;
      })()
    : '';
  const ing = d.ingester;
  // Stream state only exists for Dahua. Everything else shows nothing rather
  // than a dash that could be read as "the stream is down".
  const ingBit = ing
    ? `<span style="font-size:9px;color:var(--text-secondary)">ev:${escapeHtml(ing.event_stream || '—')} · snap:${escapeHtml(ing.snap_stream || '—')}`
      + `${ing.retry_count ? ` · ↺${ing.retry_count}` : ''}${ing.last_error_code ? ` · ${escapeHtml(ing.last_error_code)}` : ''}</span>`
    : '';
  // ip_address is REQUIRED by /api/cameras/test-connection — sending only
  // camera_id returns 400, which the old handler rendered as "reachable: no".
  // A camera that answers in 3ms was being reported as unreachable.
  const testBtn = d.ip
    ? `<button class="admin-only" data-action="devTest" data-dev-id="${escapeHtml(d.id)}" `
      + `data-dev-ip="${escapeHtml(d.ip)}" data-dev-port="${escapeHtml(String(d.port || ''))}" `
      + `data-dev-vendor="${escapeHtml(d.vendor || '')}" data-dev-site="${escapeHtml(String(d.site_id || ''))}" `
      + `style="padding:2px 8px;font-size:10px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid var(--accent);color:var(--accent);background:transparent">`
      + `${I18N.t('hlth.devTest')}</button>`
    : '';
  // Reboot sits apart from Test on purpose: separated by a spacer and in the
  // danger colour, because these two buttons do wildly different things and in
  // a 63-row table the muscle memory is to hit whatever is on the right.
  //
  // NVR rollup rows (d.channels present) go through devRebootNvr + the
  // /api/devices/nvr/:deviceId/reboot endpoint instead of devReboot — d.id
  // there is the shared device_id, not a cameras.id, and confirm-name/warning
  // copy both need to be chassis-aware (every channel goes dark together, and
  // there is no single "camera name" to type — the operator types the
  // device_id itself). See GOTCHAS for the original 404 this replaced.
  const rebootStyle = 'margin-left:10px;padding:2px 8px;font-size:10px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid var(--status-bad);color:var(--status-bad);background:transparent';
  const rebootBtn = (d.vendor === 'dahua' || d.vendor === 'hikvision' || (d.vendor === 'bosch' && !d.channels))
    ? (d.channels
        ? `<button class="admin-only" data-action="devRebootNvr" data-dev-id="${escapeHtml(d.id)}" `
          + `data-dev-channels="${escapeHtml(String(d.channel_count || d.channels.length || 0))}" `
          + `style="${rebootStyle}">${I18N.t('hlth.devReboot', 'รีบูต')}</button>`
        : `<button class="admin-only" data-action="devReboot" data-dev-id="${escapeHtml(d.id)}" `
          + `data-dev-name="${escapeHtml(d.name || d.id)}" `
          + `style="${rebootStyle}">${I18N.t('hlth.devReboot', 'รีบูต')}</button>`)
    : '';
  return `<div class="dev-row"${title}>
    <div style="display:flex;align-items:center;gap:7px;min-width:0">
      ${_devDot(d.state)}
      <div style="min-width:0">
        <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.name || d.id)}</div>
        <div style="font-size:9px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${siteBadge}${siteBadge && subLine1 ? ' · ' : ''}${escapeHtml(subLine1)}</div>
        ${subLine2 ? `<div style="font-size:9px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(subLine2)}</div>` : ''}
        ${vcaChip}
      </div>
    </div>
    <div style="font-size:10px;color:var(${tok});white-space:nowrap">${escapeHtml(label)}${d.channel_count ? ` · ${d.channel_count} ${I18N.t('hlth.devChannels')}` : ''}</div>
    <div style="font-size:9px;color:var(--text-secondary);white-space:nowrap">
      ${I18N.t('hlth.devLastSeen')} ${escapeHtml(_devAge(d.last_seen_sec))}
      ${d.last_event_sec != null ? ` · ${I18N.t('hlth.devLastEvent')} ${escapeHtml(_devAge(d.last_event_sec))}` : ''}
    </div>
    <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end">${ingBit}${testBtn}${rebootBtn}</div>
  </div>`;
}

// Site filter for the Devices tab — mirrors page-cameras.js's site-tabs-bar +
// summary-bar (renderSiteTabs/updateKPIs) pixel-for-pixel: same .gtab/.tc and
// .sum-chip classes, same "All Sites" + per-site counts pattern, reused rather
// than reinvented so the two pages read as one design language.
let _devActiveSite = null; // null = ทุก Site (named distinctly from page-cameras.js's _activeSiteId — both scripts share one global scope)
let _devGroupsRaw = null;  // last-fetched {anpr,face,event,nvr} devices, unfiltered — filtering re-renders without a refetch

function _devSiteTabsBar(allDevices) {
  if (_healthSites.length <= 1) return '';
  const tab = (sid, label, color, active) => {
    const dot = color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${escapeHtml(color)}"></span>` : '';
    const count = sid === '' ? allDevices.length : allDevices.filter(d => d.site_id === sid).length;
    return `<button class="gtab${active ? ' active' : ''}" data-action="devSetSite" data-sid="${sid}">${dot} ${escapeHtml(label)} <span class="tc">${count}</span></button>`;
  };
  return `<div class="site-tabs-bar">${tab('', I18N.t('cam.allSites'), null, _devActiveSite === null)
    + _healthSites.map(s => tab(s.id, s.name, s.color, _devActiveSite === s.id)).join('')}</div>`;
}

function _devSumChips(devices) {
  const online  = devices.filter(d => d.state === 'online').length;
  const offline = devices.filter(d => d.state === 'offline').length;
  const paused  = devices.filter(d => d.state === 'paused').length;
  return `<div class="summary-bar">`
    + `<div class="sum-chip total">${escapeHtml(I18N.t('cam.sumTotal').replace('{n}', devices.length))}</div>`
    + `<div class="sum-chip online"><span class="sdot"></span>${escapeHtml(I18N.t('cam.sumOnline').replace('{n}', online))}</div>`
    + `<div class="sum-chip offline"><span class="sdot"></span>${escapeHtml(I18N.t('cam.sumOffline').replace('{n}', offline))}</div>`
    + (paused ? `<div class="sum-chip paused"><span class="sdot"></span>${escapeHtml(I18N.t('cam.sumMaint').replace('{n}', paused))}</div>` : '')
    + `</div>`;
}

function devSetSite(el) {
  const sid = el.dataset.sid;
  _devActiveSite = sid ? Number(sid) : null;
  _renderDeviceGroups();
}

function _renderDeviceGroups() {
  const el = document.getElementById('healthGridDevices');
  if (!el || !_devGroupsRaw) return;
  const filt = list => _devActiveSite ? list.filter(d => d.site_id === _devActiveSite) : list;
  const { anpr = [], face = [], event = [], nvr = [], integrations = [] } = _devGroupsRaw;
  const allDevices = [...anpr, ...face, ...event, ...nvr];
  el.innerHTML = [
    _devSiteTabsBar(allDevices),
    _devSumChips(filt(allDevices)),
    _devLegendCard(),
    _devGroupCard('hlth.devAnpr',  filt(anpr)),
    _devGroupCard('hlth.devFace',  filt(face)),
    _devGroupCard('hlth.devEvent', filt(event)),
    _devGroupCard('hlth.devNvr',   filt(nvr)),
    _integrationCard(integrations),
  ].join('');
}

function _devGroupCard(titleKey, devices) {
  const counts = devices.reduce((a, d) => (a[d.state] = (a[d.state] || 0) + 1, a), {});
  // Summary in the header so a collapsed glance is still informative — the
  // whole risk of grouping is that a problem hides inside a closed section.
  const chips = Object.entries(counts).map(([st, n]) => {
    const [tok, key] = _DEV_STATE[st] || _DEV_STATE.unknown;
    return `<span style="font-size:9px;color:var(${tok})">${n} ${escapeHtml(I18N.t(key))}</span>`;
  }).join('<span style="color:var(--border-hairline)">·</span>');
  return `<div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:10px;padding:14px;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
      <div style="font-size:12px;font-weight:700">${escapeHtml(I18N.t(titleKey))} <span style="color:var(--text-secondary);font-weight:400">(${devices.length})</span></div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${chips}</div>
    </div>
    ${devices.length ? `<div class="dev-list">${devices.map(_devRow).join('')}</div>` : `<div style="font-size:11px;color:var(--text-secondary)">—</div>`}
  </div>`;
}

function _integrationCard(list) {
  const rows = list.map(i => {
    const stale = i.import_age_sec == null || i.import_age_sec > 86400;
    const ok = i.active && i.last_import_status === 'ok' && !stale;
    const tok = !i.active ? '--text-secondary' : ok ? '--status-ok' : '--warn';
    return `<div class="dev-row">
      <div style="display:flex;align-items:center;gap:7px;min-width:0">
        <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(${tok});flex:0 0 auto"></span>
        <div style="min-width:0">
          <div style="font-size:11px;font-weight:600">${escapeHtml(i.label || i.type)}</div>
          <div style="font-size:9px;color:var(--text-secondary)">${escapeHtml(i.type)}${i.site_code ? ' · ' + escapeHtml(i.site_code) : ''}</div>
        </div>
      </div>
      <div style="font-size:10px;color:var(${tok});white-space:nowrap">${i.active ? escapeHtml(i.last_import_status || '—') : escapeHtml(I18N.t('hlth.devDisabled'))}</div>
      <div style="font-size:9px;color:var(--text-secondary);white-space:nowrap">${I18N.t('hlth.devImport')} ${escapeHtml(_devAge(i.import_age_sec))}</div>
      <div style="display:flex;gap:4px;justify-content:flex-end">
        <button class="admin-only" data-action="devProbe" data-src-id="${i.id}"
          style="padding:2px 8px;font-size:10px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid var(--accent);color:var(--accent);background:transparent">${I18N.t('hlth.devTest')}</button>
      </div>
    </div>`;
  }).join('');
  return `<div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:10px;padding:14px;margin-bottom:12px">
    <div style="font-size:12px;font-weight:700;margin-bottom:8px">${escapeHtml(I18N.t('hlth.devIntegrations'))} <span style="color:var(--text-secondary);font-weight:400">(${list.length})</span></div>
    ${rows || `<div style="font-size:11px;color:var(--text-secondary)">—</div>`}
  </div>`;
}

let _devTimer = null;
function startDevRefresh() { loadDevices(); if (!_devTimer) _devTimer = setInterval(loadDevices, 30000); }
function stopDevRefresh()  { if (_devTimer) { clearInterval(_devTimer); _devTimer = null; } }

async function loadDevices() {
  const el = document.getElementById('healthGridDevices');
  if (!el) return;
  try {
    const [r] = await Promise.all([
      fetch(`${API}/api/health/devices`, { credentials: 'include' }),
      _ensureHealthSites(),
    ]);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const byKey = Object.fromEntries(d.groups.map(g => [g.key, g.devices]));
    _devGroupsRaw = { ...byKey, integrations: d.integrations || [] };
    _renderDeviceGroups();
  } catch (e) {
    el.innerHTML = `<div style="padding:20px;color:var(--status-bad);font-size:12px">${escapeHtml(I18N.t('hlth.loadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

// ── HC4 · อุปกรณ์ที่ HCP ดูแล ────────────────────────────────
// คำถามเดียวที่แท็บนี้ตอบ: **ตัวไหนเราดูแลอยู่ด้วย ตัวไหน HCP ดูแลอยู่ตัวเดียว**
// (ภูเก็ต: HCP เห็นกล้อง 756 ตัว เราแมปไว้ 83) — ที่เหลือคือจุดบอดของเรา
let _hcpDevLoaded = false;

async function loadHcpDevices(force) {
  const el = document.getElementById('healthGridHcp');
  if (!el || (_hcpDevLoaded && !force)) return;
  el.innerHTML = `<div class="hcpdev-note">${escapeHtml(I18N.t('hlth.hcpLoading'))}</div>`;
  try {
    // signal ของตัวเองชนะ timeout กลาง 30 วิใน dashboard.js (`opts.signal || controller.signal`)
    // ครั้งแรกหลัง api-server บูตยังต้องกวาด HCP จริง ซึ่งวัดได้ 9.9–16.0 วิ และแกว่ง —
    // 30 วิจึงเฉียดเกินไป · หลังจากนั้นแคชฝั่ง server ตอบทันที (ดู routes/hcp.js)
    // AbortSignal.timeout ไม่มีใน Safari < 16 — เบราว์เซอร์เก่าตกกลับไปใช้ 30 วิของเดิม
    // ดีกว่าพัง TypeError แล้วขึ้น "ถามไม่สำเร็จ" ทุกครั้งโดยที่ยังไม่ทันได้ยิงอะไรเลย
    const r = await fetch(`${API}/api/hcp/devices`, {
      credentials: 'include',
      ...(typeof AbortSignal?.timeout === 'function' ? { signal: AbortSignal.timeout(60000) } : {}),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    _hcpDevLoaded = true;
    _renderHcpDevices(d);
  } catch (e) {
    el.innerHTML = `<div class="hcpdev-note bad">${escapeHtml(I18N.t('hlth.hcpFailed'))} ${escapeHtml(e.message)}</div>`;
  }
}

// HC4 badges → คลิกดูรายอุปกรณ์ (2026-08-11) — badge เดิมเป็นแค่ตัวเลข กดไม่ได้เลย
// แต่ละหมวดมี state กรอง (ทั้งหมด/ออนไลน์/ออฟไลน์) เป็นของตัวเอง จำไว้ข้าม re-render
// เพื่อให้กดหมวดหนึ่งไม่ล้าง filter ของอีกหมวด
let _hcpDataRaw = null;
let _hcpFilter = {};

// index_code/name/status มาจาก HCP โดยตรงต่อหมวด (ดู helpers/hcpDevices.js) —
// เฉพาะ cameras มี "ours" (แมปกับกล้องของเราไหม) ส่วน alarmInputs/Outputs มี
// dev_name (ชื่อ encoder ที่มันติดอยู่ — central join ให้แล้วใน routes/hcp.js
// เพราะ HCP ตั้งชื่อ alarm point แค่ "A1"/"A2" ไม่มีความหมายเดี่ยวๆ)
const HCP_CATS = [
  { key: 'cameras',            labelKey: 'hlth.hcpCameras',  summaryKey: 'cameras',            rowsKey: 'cameras',            hasOurs: true },
  { key: 'encoders',           labelKey: 'hlth.hcpEncoders', summaryKey: 'encodeDevices',       rowsKey: 'encode_devices' },
  { key: 'recordServers',      labelKey: 'hlth.hcpRecordSrv',summaryKey: 'recordServers',       rowsKey: 'record_servers' },
  { key: 'intelligentServers', labelKey: 'hlth.hcpAiSrv',    summaryKey: 'intelligentServers',  rowsKey: 'intelligent_servers' },
  { key: 'alarmInputs',        labelKey: 'hlth.hcpAlarmIn',  summaryKey: 'alarmInputs',         rowsKey: 'alarm_inputs' },
  { key: 'alarmOutputs',       labelKey: 'hlth.hcpAlarmOut', summaryKey: 'alarmOutputs',        rowsKey: 'alarm_outputs' },
];

// STATUS ฝั่ง edge: 0=unknown 1=online 2=offline — แต่บางเส้นตอบนอกชุดนี้จริง
// (alarmOutputs เจอ -1) ⇒ bucket เป็น unknown เหมือนกัน ไม่ throw (ตรงกับ
// helpers/hcpDevices.js ฝั่ง server)
function _hcpRowState(status) {
  return status === 1 ? 'online' : status === 2 ? 'offline' : 'unknown';
}

function hcpSetFilter(el) {
  _hcpFilter[el.dataset.cat] = el.dataset.state;
  if (_hcpDataRaw) _renderHcpDevices(_hcpDataRaw);
}

function _hcpDevRow(cat, r) {
  const state = _hcpRowState(r.status);
  const tok = state === 'online' ? '--status-ok' : state === 'offline' ? '--status-bad' : '--text-secondary';
  const label = I18N.t(state === 'online' ? 'hlth.hcpOnline' : state === 'offline' ? 'hlth.hcpOffline' : 'hlth.hcpUnknown');
  const sub = [r.ip, r.dev_name].filter(Boolean).join(' · ');
  const oursCell = cat.hasOurs
    ? (r.ours ? escapeHtml(r.ours.camera_id) : `<span style="color:var(--text-secondary)">${escapeHtml(I18N.t('hlth.hcpOnlyTag'))}</span>`)
    : '';
  return `<div class="dev-row">
    <div style="display:flex;align-items:center;gap:7px;min-width:0">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(${tok});flex:0 0 auto"></span>
      <div style="min-width:0">
        <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.name || r.index_code || '')}</div>
        ${sub ? `<div style="font-size:9px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(sub)}</div>` : ''}
      </div>
    </div>
    <div style="font-size:10px;color:var(${tok});white-space:nowrap">${escapeHtml(label)}</div>
    <div style="font-size:9px;color:var(--text-secondary);white-space:nowrap">${escapeHtml(String(r.index_code || ''))}</div>
    <div style="font-size:9px;white-space:nowrap;text-align:right">${oursCell}</div>
  </div>`;
}

function _hcpFilterChip(cat, state, n, active) {
  if (state !== 'all' && !n) return '';
  const cls = state === 'all' ? 'total' : state;
  const labelKey = state === 'all' ? 'hlth.hcpFilterAll'
    : state === 'online' ? 'hlth.hcpOnline' : state === 'offline' ? 'hlth.hcpOffline' : 'hlth.hcpUnknown';
  return `<button type="button" class="sum-chip is-filter ${cls}" data-action="hcpSetFilter" `
    + `data-cat="${cat.key}" data-state="${state}" aria-pressed="${active}">`
    + `${state !== 'all' ? '<span class="sdot"></span>' : ''}${n} ${escapeHtml(I18N.t(labelKey))}</button>`;
}

function _hcpCard(cat, summary, rows) {
  if (!summary || !summary.total) return '';
  const filter = _hcpFilter[cat.key] || 'all';
  const filtered = rows
    .filter((r) => filter === 'all' || _hcpRowState(r.status) === filter)
    // ออฟไลน์ขึ้นก่อนเสมอ — แถวที่ต้องอ่านก่อนเพื่อน ไม่ต้องกดหา
    .sort((a, b) => (_hcpRowState(b.status) === 'offline') - (_hcpRowState(a.status) === 'offline')
      || String(a.name || '').localeCompare(String(b.name || '')));

  const chips = `<div class="summary-bar">`
    + _hcpFilterChip(cat, 'all', summary.total, filter === 'all')
    + _hcpFilterChip(cat, 'online', summary.online, filter === 'online')
    + _hcpFilterChip(cat, 'offline', summary.offline, filter === 'offline')
    + _hcpFilterChip(cat, 'unknown', summary.unknown, filter === 'unknown')
    + `</div>`;

  const body = filtered.length
    ? `<div class="dev-list">${filtered.map((r) => _hcpDevRow(cat, r)).join('')}</div>`
    : `<div style="font-size:11px;color:var(--text-secondary);padding:8px 0">${escapeHtml(I18N.t('hlth.hcpFilterEmpty'))}</div>`;

  return `<div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:10px;padding:14px;margin-bottom:12px">
    <div style="font-size:12px;font-weight:700;margin-bottom:8px">${escapeHtml(I18N.t(cat.labelKey))} <span style="color:var(--text-secondary);font-weight:400">(${summary.total})</span></div>
    ${chips}
    ${body}
  </div>`;
}

function _renderHcpDevices(d) {
  _hcpDataRaw = d;
  const s = d.summary || {};
  const c = d.coverage || {};

  const cards = HCP_CATS.map((cat) => _hcpCard(cat, s[cat.summaryKey], d[cat.rowsKey] || [])).join('');

  // ข้อมูลชุดนี้มาจากแคชฝั่ง server (สถานะอุปกรณ์ ไม่ใช่ real-time) — บอกอายุไว้เสมอ
  // ถ้าดึงใหม่ล้มเงียบ ๆ ตัวเลขนี้จะไต่ขึ้นเรื่อย ๆ ให้เห็นแทนที่จะค้างโดยไม่มีสัญญาณ
  const age = d.fetched_at
    ? ` · ${escapeHtml(I18N.t('hlth.hcpAsOf'))}${new Date(d.fetched_at).toLocaleTimeString('th-TH', { hour12: false })}`
    : '';

  document.getElementById('healthGridHcp').innerHTML = `
    <div class="hcpdev-note">${escapeHtml(I18N.t('hlth.hcpScope'))}${age}</div>
    <div class="hcpdev-cover">
      <b>${c.ours}</b> / ${c.hcp_total} ${escapeHtml(I18N.t('hlth.hcpCoverage'))}
      · <span class="dim">${c.hcp_only} ${escapeHtml(I18N.t('hlth.hcpOnlyCount'))}</span>
      ${c.mapped_missing_in_hcp ? ` · <span class="bad">${c.mapped_missing_in_hcp} ${escapeHtml(I18N.t('hlth.hcpStaleMap'))}</span>` : ''}
    </div>
    ${cards}`;
}

window._devTest = async function (btn) {
  const id = btn.dataset.devId;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = I18N.t('hlth.devTesting');
  try {
    const r = await fetch(`${API}/api/cameras/test-connection`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera_id: id,
        ip_address: btn.dataset.devIp,
        http_port: btn.dataset.devPort ? Number(btn.dataset.devPort) : undefined,
        vendor: btn.dataset.devVendor || undefined,
        site_id: btn.dataset.devSite ? Number(btn.dataset.devSite) : undefined,
      }),
    });
    const b = await r.json().catch(() => ({}));
    // A failed REQUEST and an unreachable CAMERA are different answers and must
    // never be shown as the same one — that is what made a healthy camera read
    // as "reachable: no".
    if (!r.ok) {
      alert(`${id}\n\n${I18N.t('hlth.devTestError', 'ทดสอบไม่สำเร็จ')}: ${b.error || ('HTTP ' + r.status)}`);
      return;
    }
    const authKey = { ok: 'hlth.devTestAuthOk', failed: 'hlth.devTestAuthFailed' }[b.auth_status] || 'hlth.devTestAuthUnknown';
    alert(`${id}\n\n${I18N.t('hlth.devTestReach')}: ${I18N.t(b.reachable ? 'hlth.devTestYes' : 'hlth.devTestNo')}`
      + `\n${I18N.t('hlth.devTestAuth')}: ${I18N.t(authKey)}`
      + (b.latency_ms != null ? `\n${I18N.t('hlth.devTestLatency')}: ${b.latency_ms} ms` : '')
      + (b.via_edge ? `\n${I18N.t('hlth.devTestViaEdge')}` : ''));
  } catch (e) {
    alert(`${id}\n\n${I18N.t('hlth.devTestError', 'ทดสอบไม่สำเร็จ')}: ${e.message}`);
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
};

window._devProbe = async function (sourceId) {
  try {
    const r = await fetch(`${API}/api/blacklist/sources/${sourceId}/test-connection`, {
      method: 'POST', credentials: 'include',
    });
    const b = await r.json().catch(() => ({}));
    alert(b.ok ? `OK\n\n${JSON.stringify(b, null, 2).slice(0, 400)}` : `${b.error || 'failed'}`);
  } catch (e) { alert(e.message); }
};

// Device activity — events per bucket for the busiest cameras. Its own fetch
// because it hits the events table, not metrics_host, and is the one panel here
// that can take a second on a 7-day window.
async function _loadDeviceActivity(q) {
  try {
    const r = await fetch(`${API}/api/metrics/device?${q}`, { credentials: 'include' });
    if (!r.ok) return;
    const d = await r.json();
    const p = _perfPalette();
    // Enough hues to tell eight lines apart; token-derived so a re-theme moves
    // them together instead of leaving a hardcoded rainbow behind.
    const hues = [p.accent, p.ok, p.warn, p.bad, token('--accent-muted'), token('--text-secondary'), p.accent, p.ok];
    _lineChart('perfDevices', (d.series || []).map((s, i) => ({
      label: s.camera_id,
      borderColor: hues[i % hues.length],
      borderDash: i >= 4 ? [4, 3] : undefined,   // second pass repeats hues — dash keeps them distinct
      backgroundColor: 'transparent',
      spanGaps: false,
      data: (s.points || []).map(pt => ({ x: new Date(pt.t), y: pt.events })),
    })), { tip: c => `${c.dataset.label}: ${c.parsed.y}` });
  } catch { /* the host charts are the point of this tab — never fail it for this */ }
}

// Legend for the device states. "Quiet" is a word this page invented, so the
// first thing someone meets on opening the tab should be what it means —
// otherwise a grey dot next to a camera reads as a fault, which is the exact
// misreading the state was added to prevent.
function _devLegendCard() {
  const items = [
    ['online',   'hlth.devLegOnline'],
    ['quiet',    'hlth.devLegQuiet'],
    ['offline',  'hlth.devLegOffline'],
    ['paused',   'hlth.devLegPaused'],
    ['disabled', 'hlth.devLegDisabled'],
  ].map(([state, descKey]) => {
    const [tok, labelKey] = _DEV_STATE[state];
    return `<div class="dev-legend-item">
      ${_devDot(state)}
      <span style="font-size:11px;font-weight:600;color:var(${tok})">${escapeHtml(I18N.t(labelKey))}</span>
      <span style="font-size:10px;color:var(--text-secondary)">${escapeHtml(I18N.t(descKey))}</span>
    </div>`;
  }).join('');
  return `<div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:10px;padding:12px 14px;margin-bottom:12px">
    <div style="font-size:10px;font-weight:700;color:var(--text-secondary);letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px">${escapeHtml(I18N.t('hlth.devLegend'))}</div>
    <div class="dev-legend">${items}</div>
  </div>`;
}

// Shared by _devReboot (single camera) and _devRebootNvr (NVR chassis) — same
// typed-confirmation flow and request/response handling, only the endpoint,
// the name the operator must type, and the warning copy differ.
async function _devRebootRequest(btn, { endpoint, confirmName, warnMsg }) {
  const typed = prompt(`${warnMsg}\n\n${I18N.t('hlth.devRebootType', 'พิมพ์ชื่อกล้องให้ตรงเพื่อยืนยัน')}:\n${confirmName}`);
  if (typed == null) return;
  if (typed.trim() !== confirmName.trim()) {
    alert(I18N.t('hlth.devRebootMismatch', 'ชื่อไม่ตรง — ยกเลิกแล้ว'));
    return;
  }
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '...';
  try {
    const r = await fetch(`${API}${endpoint}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm_name: typed.trim() }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 202) {
      alert(`${confirmName}\n\n${I18N.t('hlth.devRebootFailed', 'สั่งรีบูตไม่สำเร็จ')}: ${b.error || ('HTTP ' + r.status)}`);
      return;
    }
    alert(`${confirmName}\n\n${I18N.t('hlth.devRebootSent', 'ส่งคำสั่งแล้ว — กล้องจะกลับมาใน 60-90 วินาที')}`
      + (b.via === 'edge' ? `\n(via edge ${b.site})` : ''));
    setTimeout(loadDevices, 3000);
  } catch (e) {
    alert(`${confirmName}\n\n${I18N.t('hlth.devRebootFailed', 'สั่งรีบูตไม่สำเร็จ')}: ${e.message}`);
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

window._devReboot = function (btn) {
  const id = btn.dataset.devId;
  const name = btn.dataset.devName || id;
  // Typed confirmation, not an OK dialog. A confirm() next to a Test button in a
  // 63-row table is one mis-aimed click from blinding a gate for 90 seconds;
  // having to type the name makes the wrong row impossible to hit by accident.
  return _devRebootRequest(btn, {
    endpoint: `/api/cameras/${encodeURIComponent(id)}/reboot`,
    confirmName: name,
    warnMsg: I18N.t('hlth.devRebootWarn', 'กล้องจะดับประมาณ 60-90 วินาที และยกเลิกไม่ได้'),
  });
};

// ============================================================
// Relay tab (2026-09-02) — per-camera evidence for downstream relays (today:
// the government CIB feed at hkt). Exists because CIB reported receiving
// "only 6 cameras" while our side was healthy: this table carries the exact
// destination URL (with the receiver's own per-camera UUID for face) next to
// live 24h activity, so both sides can reconcile camera by camera instead of
// arguing totals. Grouped by site — a site picker shows only sites that
// actually relay (owner ask 2026-09-02).
// ============================================================
let _relayData = null;
let _relaySite = null;

async function loadRelay() {
  const el = document.getElementById('healthGridRelay');
  if (!el) return;
  el.innerHTML = `<div class="hcpdev-note">${escapeHtml(I18N.t('hlth.cibLoading'))}</div>`;
  try {
    const r = await fetch(`${API}/api/health/relay`, { credentials: 'include' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    _relayData = d;
    if (!_relaySite || !(d.sites || []).some(s => s.code === _relaySite)) {
      _relaySite = d.sites?.[0]?.code || null;
    }
    _renderRelay();
  } catch (e) {
    el.innerHTML = `<div class="hcpdev-note bad">${escapeHtml(I18N.t('hlth.cibFailed'))} ${escapeHtml(e.message)}</div>`;
  }
}

window.relaySetSite = function (btn) {
  _relaySite = btn.dataset.site;
  if (_relayData) _renderRelay();
};

const _CIB_STATUS = {
  relay:        { key: 'hlth.cibStRelay',  color: 'var(--status-ok)' },
  ingest_only:  { key: 'hlth.cibStIngest', color: 'var(--warn)' },
  unconfigured: { key: 'hlth.cibStNone',   color: 'var(--status-bad)' },
};

// วันที่/เวลาบนแท็บนี้ตามภาษา UI — ฝัง th-TH ตายตัวคือบั๊กเดิมที่ owner แจ้ง (2026-09-02)
function _relayLocale() { return I18N.getLang() === 'en' ? 'en-GB' : 'th-TH'; }

// เก็บในระบบเป็นรูปแบบดิบที่อ่านจากกล้องจริง (ขีดกลาง ตัวเล็ก) — ฟอร์แมตแค่ตอนแสดงผล
// ไม่แตะค่าที่เก็บ กันข้อมูลต้นทางเพี้ยนถ้าวันหลังมีจุดอื่นมาอ่านค่าเดิมไปเทียบ
function _fmtMac(m) {
  return m ? escapeHtml(String(m).toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(.{2})(?=.)/g, '$1:')) : '';
}

function _cibRow(r) {
  const st = _CIB_STATUS[r.status] || _CIB_STATUS.unconfigured;
  const seen = r.last_seen_at ? (Date.now() - new Date(r.last_seen_at).getTime()) / 1000 : Infinity;
  const onlineColor = seen < 120 ? 'var(--status-ok)' : 'var(--status-bad)';
  const lastEv = r.last_event_at
    ? new Date(r.last_event_at).toLocaleString(_relayLocale(), { hour12: false })
    : '-';
  return `<tr>
    <td style="text-align:left;white-space:nowrap">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${onlineColor};margin-right:6px"></span>
      <b>${escapeHtml(r.camera_id)}</b>
      <div style="color:var(--text-secondary);font-size:10px;margin-left:13px">${escapeHtml(r.name || '')}</div>
    </td>
    <td style="white-space:nowrap;font-family:var(--mono,monospace);font-size:10px">${_fmtMac(r.mac) || '<span style="color:var(--text-secondary)">-</span>'}</td>
    <td style="white-space:nowrap"><span style="color:${st.color};font-weight:700">${escapeHtml(I18N.t(st.key))}</span></td>
    <td style="text-align:left;font-family:var(--mono,monospace);font-size:10px;word-break:break-all">${r.dest_url ? escapeHtml(r.dest_url) : '<span style="color:var(--text-secondary)">-</span>'}</td>
    <td style="font-variant-numeric:tabular-nums">${r.events_24h.toLocaleString()}</td>
    <td style="white-space:nowrap;font-size:10px;color:${r.events_24h ? 'inherit' : 'var(--status-bad)'}">${escapeHtml(lastEv)}</td>
  </tr>`;
}

function _cibGroupCard(titleKey, rows) {
  if (!rows.length) return '';
  const head = ['hlth.cibColCamera', 'hlth.cibColMac', 'hlth.cibColStatus', 'hlth.cibColDest', 'hlth.cibCol24h', 'hlth.cibColLast']
    .map(k => `<th style="position:sticky;top:0;background:var(--surface-elevated);text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-hairline);font-size:10px;color:var(--text-secondary)">${escapeHtml(I18N.t(k))}</th>`)
    .join('');
  return `<div style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:10px;padding:14px;margin-bottom:12px">
    <div style="font-size:12px;font-weight:700;margin-bottom:8px">${escapeHtml(I18N.t(titleKey))} <span style="color:var(--text-secondary);font-weight:400">(${rows.length})</span></div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px;text-align:left">
        <thead><tr>${head}</tr></thead>
        <tbody>${rows.map(_cibRow).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

function _renderRelay() {
  const el = document.getElementById('healthGridRelay');
  const sites = _relayData?.sites || [];
  if (!sites.length) {
    el.innerHTML = `<div class="hcpdev-note">${escapeHtml(I18N.t('hlth.relayEmpty'))}</div>`;
    return;
  }
  const site = sites.find(x => x.code === _relaySite) || sites[0];
  const s = site.summary || {};
  const rows = site.rows || [];
  const chip = (label, val, color) => `<span style="margin-right:12px">
    <b style="color:${color || 'inherit'}">${val || 0}</b>
    <span style="color:var(--text-secondary)">${escapeHtml(label)}</span></span>`;
  const gen = _relayData.generated_at
    ? ` · ${new Date(_relayData.generated_at).toLocaleTimeString(_relayLocale(), { hour12: false })}`
    : '';
  // แถบเลือก site — โผล่เฉพาะเมื่อมีมากกว่า 1 site ที่ relay จริง (site ที่ไม่มีถูก
  // ตัดตั้งแต่ endpoint แล้ว)
  const picker = sites.length > 1
    ? `<div class="tabs" style="margin:0 0 12px">${sites.map(x =>
        `<button class="tab${x.code === site.code ? ' active' : ''}" data-site="${escapeHtml(x.code)}" data-action="relaySetSite">${escapeHtml(x.name || x.code)}</button>`).join('')}</div>`
    : '';
  // ปุ่ม PDF เป็น <a> ตรงๆ (ไม่ใช่ fetch/onclick) — CSP อนุญาต navigation ปกติ
  // และเบราว์เซอร์จัดการ inline PDF ให้เอง · ผูก site ที่กำลังดูอยู่เสมอ
  const pdfBtn = `<a class="btn btn-secondary" style="float:right;font-size:11px"
      href="${API}/api/health/relay/report.pdf?site=${encodeURIComponent(site.code)}" target="_blank" rel="noopener">
      <svg aria-hidden="true" width="13" height="13"><use href="#icon-download"/></svg>
      <span>${escapeHtml(I18N.t('hlth.relayPdf'))}</span></a>`;
  el.innerHTML = `
    ${pdfBtn}
    <div class="hcpdev-note">${escapeHtml(I18N.t('hlth.cibScope'))}${gen}</div>
    ${picker}
    <div style="font-size:11px;margin:0 0 12px">
      ${chip(I18N.t('hlth.cibSumTotal'), s.total)}
      ${chip(I18N.t('hlth.cibStRelay'), s.relay, 'var(--status-ok)')}
      ${chip(I18N.t('hlth.cibSumActive'), s.active_24h, 'var(--status-ok)')}
      ${chip(I18N.t('hlth.cibStIngest'), s.ingest_only, 'var(--warn)')}
      ${chip(I18N.t('hlth.cibStNone'), s.unconfigured, 'var(--status-bad)')}
    </div>
    ${_cibGroupCard('hlth.cibFaceGroup', rows.filter(r => r.role === 'face'))}
    ${_cibGroupCard('hlth.cibLprGroup', rows.filter(r => r.role === 'lpr'))}`;
}

// NVR chassis reboot — the operator types the device_id itself (there is no
// single "camera name" for a shared chassis) and the warning names how many
// channels go dark together, since this is a bigger action than the single-
// camera reboot above: every channel on the box, not just one.
window._devRebootNvr = function (btn) {
  const id = btn.dataset.devId;
  const chCount = btn.dataset.devChannels || '?';
  return _devRebootRequest(btn, {
    endpoint: `/api/devices/nvr/${encodeURIComponent(id)}/reboot`,
    confirmName: id,
    warnMsg: I18N.t('hlth.devRebootNvrWarn', 'ตู้นี้จะดับทั้งตู้ {n} channel พร้อมกัน และยกเลิกไม่ได้').replace('{n}', chCount),
  });
};
