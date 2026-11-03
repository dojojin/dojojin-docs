// ============================================================
// Vigil Platform — Storage Overview Page
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

let _storageScanning = false;


function formatPct(num, denom) {
  const n = Number(num), d = Number(denom);
  if (!Number.isFinite(d) || d <= 0) return '—';
  return `${Math.round(n / d * 100)}%`;
}

function formatTime(date) {
  if (!date) return '—';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffHours / 24);

  if (diffMs < 90 * 60000) {
    // "0 ชม.ที่แล้ว" อ่านไม่รู้เรื่อง — ต่ำกว่าชั่วโมงครึ่งบอกเป็นนาที
    const mins = Math.max(1, Math.round(diffMs / 60000));
    return I18N.t('stor.relTimeMin').replace('{n}', mins);
  } else if (diffHours < 24) {
    return I18N.t('stor.relTime1h').replace('{n}', diffHours);
  } else if (diffDays < 30) {
    return I18N.t('stor.relTime1d').replace('{n}', diffDays);
  } else {
    return d.toLocaleDateString((I18N.getLang?.() || 'th') === 'th' ? 'th-TH' : 'en-GB');
  }
}

async function loadStorageStats() {
  const main = document.getElementById('storageMain');
  const subbar = document.getElementById('storageSubbar');

  try {
    const res = await fetch(`${API}/api/storage`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const stats = data.stats || [];
    const retention = data.retention || {};
    const machines = data.machines || [];

    // Group stats by machine
    const byMachine = {};
    for (const row of stats) {
      if (!byMachine[row.machine]) byMachine[row.machine] = [];
      byMachine[row.machine].push(row);
    }

    // Map categories to retention settings
    // สองชนิดที่ต่างกันโดยเจตนา ไม่ใช่ช่องว่างที่ลืมเติม (ยืนยัน 2026-08-24):
    //   expendable = ภาพเหตุการณ์ที่หมดอายุได้ → มี retention ตามเวลา
    //   reference  = รูปอ้างอิงที่ยังใช้จับคู่อยู่ → ห้ามลบตามเวลา
    //                lpr-retention.js:132 เขียนว่า "sibling lpr-watchlist/ is NEVER
    //                touched (OPT5-CEN-002)" และมี assertion กันไว้ · enforceSnapshotRetention
    //                เดินแค่ ['events','face'] · ของสองกองนี้จึงต้องใช้ orphan cleanup
    //                (เฟส 3) ไม่ใช่ตั้งอายุ
    const catRetention = {
      'events':           { kind: 'expendable', files: retention.snapshot_retention_days,  links: retention.signed_image_expire_hours },
      'lpr':              { kind: 'expendable', files: retention.lpr_image_retention_days, links: retention.lpr_line_image_expire_hours },
      'face-blacklist':   { kind: 'expendable', files: retention.snapshot_retention_days,  links: retention.signed_image_expire_hours },
      'root-flat':        { kind: 'expendable', files: retention.snapshot_retention_days,  links: retention.signed_image_expire_hours },
      'reports':          { kind: 'expendable', files: retention.report_retention_days,    links: retention.signed_image_expire_hours },
      'lpr-watchlist':    { kind: 'reference',  files: null, links: retention.signed_image_expire_hours },
      'blacklist-photos': { kind: 'reference',  files: null, links: retention.signed_image_expire_hours },
    };

    // การ์ดดิสก์ — แถบสัดส่วนอ่านง่ายกว่าตัวเลข 4 บรรทัด โดยเฉพาะตอนใกล้เต็ม
    // สีมาจาก --status-* ไม่ใช่ hex และมีตัวเลขกำกับเสมอ ไม่สื่อด้วยสีอย่างเดียว (a11y §7)
    // ถัดจากแถบคือแถวที่ย้ายมาจากแท็บเซิร์ฟเวอร์ (2026-08-31, decision ใน DECISIONS.md)
    const currentMachine = machines.find(m => m.code === _storMachine);
    const GB = 1024 ** 3;
    let diskHtml = '';
    if (currentMachine && currentMachine.disk_total_gb != null) {
      const total = Number(currentMachine.disk_total_gb) || 0;
      const free  = Number(currentMachine.disk_free_gb) || 0;
      const used  = Math.max(0, total - free);
      const pct   = total > 0 ? Math.round(used / total * 100) : 0;
      const tone  = pct >= 90 ? '--status-bad' : pct >= 75 ? '--warn' : '--status-ok';

      // พาดหัวคือดิสก์ที่ภาพลงจริง · hkt แขวน snapshot ไว้บน RAID แยก ถ้าพาดหัวด้วย
      // ดิสก์ระบบจะขึ้น 13% ทั้งที่ดิสก์ที่เก็บภาพอยู่ที่ 70% (backend เลือกให้แล้ว)
      const roleLabel = currentMachine.disk_role === 'media'
        ? I18N.t('stor.diskMediaLabel') : I18N.t('stor.diskSystemLabel');
      const pathHint = currentMachine.disk_path
        ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:2px;word-break:break-all">${escapeHtml(currentMachine.disk_path)}</div>` : '';

      // ดิสก์ใบอื่นบนเครื่องเดียวกัน — ไม่ซ่อน เพราะดิสก์ระบบเต็มก็พังเหมือนกัน
      const others = (currentMachine.mounts || []).filter(m => m.mount !== currentMachine.disk_path);
      const othersHtml = others.map(m => {
        const p2 = Math.round(Number(m.used_pct) || 0);
        const t2 = p2 >= 90 ? '--status-bad' : p2 >= 75 ? '--warn' : '--status-ok';
        const lbl = m.role === 'media' ? I18N.t('stor.diskMediaLabel') : I18N.t('stor.diskSystemLabel');
        return `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border-hairline)">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
              <span style="color:var(--text-secondary)">${escapeHtml(lbl)}</span>
              <span style="color:var(${t2});font-weight:600">${p2}%</span>
            </div>
            <div class="stor-bar"><div class="stor-bar-fill" style="width:${Math.min(100, p2)}%;background:var(${t2})"></div></div>
            <div class="stor-disk-meta"><span>${escapeHtml(m.mount || '')}</span><span>${escapeHtml(I18N.t('stor.diskFree'))} ${formatBytes((Number(m.free_gb) || 0) * GB)}</span></div>
          </div>`;
      }).join('');

      diskHtml = `
        <section class="stor-card">
          <h3 class="stor-card-h">${escapeHtml(I18N.t('stor.diskSummary'))} · ${escapeHtml(roleLabel)}</h3>
          <div class="stor-disk-num">
            <strong style="color:var(${tone})">${pct}%</strong>
            <span>${escapeHtml(I18N.t('stor.diskFree'))} ${formatBytes(free * GB)}</span>
          </div>
          <div class="stor-bar"><div class="stor-bar-fill" style="width:${Math.min(100, pct)}%;background:var(${tone})"></div></div>
          <div class="stor-disk-meta">
            <span>${escapeHtml(I18N.t('stor.diskUsed'))} ${formatBytes(used * GB)}</span>
            <span>${escapeHtml(I18N.t('stor.diskTotal'))} ${formatBytes(total * GB)}</span>
          </div>
          ${pathHint}
          ${othersHtml}
        </section>`;
    }

    // แถวที่ย้ายมาจากการ์ด Storage ของแท็บเซิร์ฟเวอร์ · เป็นการ์ดที่สองใต้แถบดิสก์
    // ใช้ _healthCard() ตัวเดียวกับหน้า Health เพื่อให้ tuple ของ _storageHealthRows()
    // เสียบเข้าได้ตรง ๆ ไม่ต้องแปลงรูป (page-health.js โหลดก่อนไฟล์นี้ที่ index.html)
    let extraHtml = '';
    if (currentMachine) {
      const rows = [];
      if (currentMachine.is_central) {
        const spoolN = currentMachine.spool_files || 0;
        const clrBtn = spoolN > 0
          ? ` <button class="admin-only" data-action="clearSpool" data-spool-count="${spoolN}" style="margin-left:6px;padding:1px 6px;font-size:9px;font-weight:600;border-radius:4px;cursor:pointer;border:1px solid var(--warn);color:var(--warn);background:transparent">${escapeHtml(I18N.t('hlth.clearSpool'))}</button>`
          : '';
        rows.push([I18N.t('stor.spoolRow'), spoolN > 0
          ? `<span style="color:var(--warn)">${spoolN} ${escapeHtml(I18N.t('hlth.spoolItems'))}</span>${clrBtn}`
          : escapeHtml(I18N.t('hlth.spoolEmpty'))]);
        rows.push([I18N.t('stor.clipFiles'), (currentMachine.clips_files ?? 0).toLocaleString()]);
        rows.push([I18N.t('stor.clipSize'),  (currentMachine.clips_mb ?? 0) + ' MB']);
        rows.push([I18N.t('stor.clips24h'),  (currentMachine.clips_today ?? 0).toLocaleString()]);
        rows.push([I18N.t('stor.clipOldest'), currentMachine.clips_oldest_at
          ? new Date(currentMachine.clips_oldest_at).toLocaleDateString('th-TH') : '\u2014']);
      } else {
        rows.push([I18N.t('hlth.edgeSnapshots'), currentMachine.snapshot_oldest
          ? `${new Date(currentMachine.snapshot_oldest).toLocaleDateString('th-TH')} \u00b7 ${currentMachine.snapshot_dirs ?? '?'} ${escapeHtml(I18N.t('hlth.edgeDays'))}`
          : '\u2014']);
      }
      if (currentMachine.storage_health) {
        rows.push([I18N.t('hlth.diskRaidHeader'), null]);
        rows.push(..._storageHealthRows(currentMachine.storage_health));
      }
      if (rows.length) extraHtml = _healthCard(I18N.t('stor.detailTitle'), '', rows);
    }

    // ถ้าเครื่องที่เลือกไม่มีข้อมูล (ยังไม่เคยวัด) ให้แสดงตารางว่างพร้อมข้อความ
    // ไม่ตกกลับไป central เงียบ ๆ ซึ่งจะทำให้คนอ่านตัวเลขของอีกเครื่องโดยไม่รู้ตัว
    const machineData = byMachine[_storMachine] || [];
    const rows = machineData.map(row => {
      const cat = row.category;
      const ret = catRetention[cat] || {};
      const fileRetentionDays = ret.files ? parseInt(ret.files, 10) : null;
      const linkRetentionHours = ret.links ? parseInt(ret.links, 10) : null;

      // Check for clock conflict: link TTL > file retention
      let warningHtml = '';
      if (ret.kind === 'reference') {
        warningHtml = `<div style="color:var(--text-secondary);font-size:10px;margin-top:4px">${escapeHtml(I18N.t('stor.refNoTtl'))}</div>`;
      } else if (fileRetentionDays != null && linkRetentionHours != null) {
        const fileTtlHours = fileRetentionDays * 24;
        if (linkRetentionHours > fileTtlHours) {
          const msg = I18N.t('stor.clockConflict')
            .replace('{cat}', cat)
            .replace('{linkHours}', linkRetentionHours)
            .replace('{fileDays}', fileRetentionDays);
          warningHtml = `<div style="background:${token('--warn')}26;color:var(--warn);padding:4px 6px;border-radius:4px;font-size:10px;margin-top:4px">${escapeHtml(msg)}</div>`;
        }
      }

      const partial = row.partial ? ` <span style="color:var(--warn);font-size:10px">${I18N.t('stor.partial')}</span>` : '';
      const oldestAtStr = row.oldest_at ? new Date(row.oldest_at).toLocaleDateString((I18N.getLang?.() || 'th') === 'th' ? 'th-TH' : 'en-GB') : '—';
      const measuredAt = formatTime(row.measured_at);

      return `<tr>
        <td class="name">${escapeHtml(cat)}</td>
        <td><strong>${formatBytes(row.bytes_disk)}</strong>${partial}
            <div style="font-size:10px;color:var(--text-secondary)">${I18N.t('stor.apparent')} ${formatBytes(row.bytes)}</div></td>
        <td>${Number(row.files).toLocaleString()}</td>
        <td class="num">${row.orphans == null ? '<span style="color:var(--text-secondary)">—</span>'
          : `<strong>${Number(row.orphans).toLocaleString()}</strong>
             <div style="font-size:10px;color:var(--text-secondary)">${formatBytes(row.orphans_bytes_disk)}</div>`}</td>
        <td>${oldestAtStr}</td>
        <td class="meta">${escapeHtml(measuredAt)}</td>
        <td>${warningHtml}</td>
      </tr>`;
    }).join('');

    const table = `<section class="stor-card stor-table-wrap">
      <table class="stor-table" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr>
            <th class="">${I18N.t('stor.colCategory')}</th>
            <th class="">${I18N.t('stor.colBytes')}</th>
            <th class="">${I18N.t('stor.colFiles')}</th>
            <th class="num">${I18N.t('stor.colOrphan')}</th>
            <th class="">${I18N.t('stor.colOldest')}</th>
            <th class="">${I18N.t('stor.colMeasured')}</th>
            <th class="">${I18N.t('stor.colWarning')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>`;

    // สองคอลัมน์บนจอกว้าง: ซ้าย = สถานะ+การกระทำ · ขวา = การตั้งค่า
    // ตารางอยู่เต็มความกว้างด้านล่างเพราะมี 7 คอลัมน์ บีบลงครึ่งจอแล้วอ่านไม่ได้
    main.innerHTML =
      _storRenderMachineBar(machines) +
      `<div class="stor-cols">
         <div class="stor-col">${diskHtml}${extraHtml}${_storRenderPurgePanel()}</div>
         <div class="stor-col">${_storMachine === 'central' ? _storRenderRetentionPanel(retention) : _storRenderEdgeNote()}</div>
       </div>` +
      (machineData.length ? table
        : `<section class="stor-card"><div class="stor-empty">${escapeHtml(I18N.t('stor.neverMeasured'))}</div></section>`);
  } catch (e) {
    main.innerHTML = `<div style="color:var(--status-bad);padding:20px">${escapeHtml(I18N.t('stor.loadFailed'))} ${escapeHtml(e.message)}</div>`;
  }
}

async function startStorageScan() {
  if (_storageScanning) {
    alert(I18N.t('stor.scanRunning'));
    return;
  }

  const subbar = document.getElementById('storageSubbar');
  const btn = subbar.querySelector('[data-action="storScan"]');

  _storageScanning = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = I18N.t('stor.scanning');
  }

  try {
    const res = await fetch(`${API}/api/storage/scan`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine: _storMachine }),
    });

    if (res.status === 409) {
      alert(I18N.t('stor.scanAlreadyRunning'));
      _storageScanning = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = I18N.t('stor.scanBtn');
      }
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Scan is running in background; show message
    _storRenderSubbar(`<span style="color:var(--text-secondary);font-size:11px;margin-left:8px">${escapeHtml(I18N.t('stor.scanInProgress'))}</span>`);
    const running = document.querySelector('#storageSubbar [data-action="storScan"]');
    if (running) { running.disabled = true; running.textContent = I18N.t('stor.scanning'); }

    // Poll for completion
    let completed = false;
    let polls = 0;
    const maxPolls = 120; // 2 minutes with 1-second polls
    while (polls < maxPolls && !completed) {
      await new Promise(r => setTimeout(r, 1000));
      polls++;
      try {
        const checkRes = await fetch(`${API}/api/storage`, { credentials: 'include', cache: 'no-store' });
        if (checkRes.ok) {
          const data = await checkRes.json();
          const latestMeasured = data.stats?.[0]?.measured_at;
          const now = new Date();
          const isRecent = latestMeasured && (now - new Date(latestMeasured)) < 10000; // within 10 sec
          if (isRecent) {
            completed = true;
          }
        }
      } catch {}
    }

    // Reload the stats display
    loadStorageStats();

  } catch (e) {
    alert(I18N.t('stor.scanFailed') + e.message);
  } finally {
    _storageScanning = false;
    // ปุ่มต้องกลับมาเสมอ — ก่อนหน้านี้ subbar ถูกแทนด้วย "วัดเสร็จแล้ว" ค้างไว้
    // ทำให้กดวัดใหม่ได้ครั้งเดียวต่อการเปิดหน้า ต้อง reload ทั้งหน้าถึงจะกดได้อีก
    // (btn ตัวเดิมถูกทิ้งไปแล้วตอนเขียน innerHTML ทับ จึงต้องสร้างใหม่ ไม่ใช่แก้ของเดิม)
    _storRenderSubbar();
  }
}

// สร้างแถบปุ่มใหม่ — ใช้ทั้งตอน init และตอนสแกนจบ ให้ปุ่มกลับมาเสมอ
function _storRenderSubbar(statusHtml) {
  const subbar = document.getElementById('storageSubbar');
  if (!subbar) return;
  subbar.innerHTML =
    `<button class="btn btn-secondary admin-only" data-action="storScan">${escapeHtml(I18N.t('stor.scanBtn'))}</button>` +
    (statusHtml || '');
}


// ── แผงตั้งอายุ ─────────────────────────────────────────────
// รวมทุกค่ามาที่เดียว เพราะเดิมกระจายอยู่ 5 ที่ (บางตัวในหน้า LPR บางตัวไม่มีหน้าจอเลย)
// และเป็นที่เดียวที่เห็นนาฬิกาสองเรือนคู่กัน: อายุไฟล์ (ไฟล์หายเมื่อไหร่) กับ
// อายุลิงก์ (LINE ดึงรูปได้อีกนานเท่าไหร่) — ไฟล์ชนะเสมอ ลิงก์ที่ยาวกว่าไฟล์คือรูปเสีย
const _STOR_FIELDS = [
  { key: 'snapshot_retention_days',     unit: 'days',  min: 1, max: 365 },
  { key: 'lpr_image_retention_days',    unit: 'days',  min: 1, max: 730 },
  { key: 'report_retention_days',       unit: 'days',  min: 1, max: 365 },
  { key: 'signed_image_expire_hours',   unit: 'hours', min: 1, max: 720 },
  { key: 'lpr_line_image_expire_hours', unit: 'hours', min: 1, max: 720 },
];

function _storRenderRetentionPanel(retention) {
  const rows = _STOR_FIELDS.map(f => {
    const label = I18N.t('stor.set.' + f.key);
    const unit  = I18N.t(f.unit === 'days' ? 'stor.unitDays' : 'stor.unitHours');
    return `<div class="stor-field">
      <label for="stor_${f.key}">${escapeHtml(label)}</label>
      <input id="stor_${f.key}" class="form-input storRetInput" type="number"
             min="${f.min}" max="${f.max}" value="${escapeHtml(String(retention[f.key] ?? ''))}"
             data-key="${f.key}" data-min="${f.min}" data-max="${f.max}">
      <span class="stor-unit">${escapeHtml(unit)}</span>
    </div>`;
  }).join('');
  return `<section class="stor-card">
    <h3 class="stor-card-h">${escapeHtml(I18N.t('stor.setTitle'))}</h3>
    <p class="stor-note">${escapeHtml(I18N.t('stor.setHint'))}</p>
    <div class="stor-fields">${rows}</div>
    <div class="stor-actions">
      <button class="btn btn-primary admin-only" data-action="storSaveRet">${escapeHtml(I18N.t('stor.setSave'))}</button>
      <span id="storRetMsg" class="stor-msg"></span>
    </div>
  </section>`;
}

async function storSaveRetention() {
  const msg = document.getElementById('storRetMsg');
  const inputs = [...document.querySelectorAll('.storRetInput')];
  // ตรวจทุกช่องก่อนเขียนช่องแรก — เขียนไปครึ่งทางแล้วเจอค่าผิดคือสภาพที่แย่กว่าไม่เขียนเลย
  for (const el of inputs) {
    const n = parseInt(el.value, 10);
    const min = Number(el.dataset.min), max = Number(el.dataset.max);
    if (!Number.isFinite(n) || n < min || n > max) {
      if (msg) { msg.style.color = 'var(--status-bad)';
        msg.textContent = I18N.t('stor.setRange').replace('{f}', I18N.t('stor.set.' + el.dataset.key)).replace('{min}', min).replace('{max}', max); }
      el.focus();
      return;
    }
  }
  try {
    for (const el of inputs) {
      const r = await fetch(`${API}/api/settings/${encodeURIComponent(el.dataset.key)}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: String(parseInt(el.value, 10)) }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(`${el.dataset.key}: ${j.error || 'HTTP ' + r.status}`);
      }
    }
    // โหลดใหม่ก่อน แล้วค่อยเขียนข้อความ — loadStorageStats() เขียน main.innerHTML ทับ
    // ซึ่งทำลาย #storRetMsg ไปด้วย เขียนก่อนโหลดจึงหายทันทีโดยไม่มีใครเห็น
    await loadStorageStats();
    const msg2 = document.getElementById('storRetMsg');
    if (msg2) { msg2.style.color = 'var(--status-ok)'; msg2.textContent = I18N.t('stor.setSaved'); }
  } catch (e) {
    if (msg) { msg.style.color = 'var(--status-bad)'; msg.textContent = I18N.t('stor.setFailed') + e.message; }
  }
}


// ── ลบด้วยมือตามอายุ ────────────────────────────────────────
// dry-run บังคับก่อนเสมอ แล้วต้องยืนยันด้วยจำนวนที่เห็นจาก dry-run
// ยังไม่มีปุ่มลบ orphan โดยตั้งใจ — ช่วง 10 วันมี event 2.5% ที่ไม่ได้บันทึกชื่อไฟล์
// ไฟล์ของมันหน้าตาเหมือน orphan ทั้งที่เป็นหลักฐาน ต้องมีด่านสองก่อน
let _storPurgePlan = null;
// เครื่องที่กำลังดู — 'central' หรือ site code · เก็บไว้ระดับโมดูลเพราะทั้งตาราง
// ปุ่มวัดใหม่ และแผงลบ ต้องอ้างเครื่องเดียวกัน ไม่ใช่แต่ละอันอ่านจาก DOM เอง
let _storMachine = 'central';

function _storRenderMachineBar(machines) {
  // Sort: central first, then alphabetically
  const sorted = [...machines].sort((a, b) => {
    if (a.code === 'central') return -1;
    if (b.code === 'central') return 1;
    return a.code.localeCompare(b.code);
  });
  // เครื่องที่กำลังเลือกอยู่ต้องมี pill เสมอ แม้จะหลุดจากรายการ (เช่นเพิ่งถูกลบออก)
  // ไม่งั้นจะไม่มีปุ่มไหน active และผู้ใช้กดกลับไม่ได้
  if (!sorted.some(m => m.code === _storMachine)) sorted.push({ code: _storMachine });
  const pills = sorted.map(m => {
    const active = m.code === _storMachine;
    const label = m.code === 'central' ? I18N.t('stor.central') : m.code.toUpperCase();
    return `<button class="site-tag${active ? ' active' : ''}" data-action="storMachine" data-machine="${escapeHtml(m.code)}">${escapeHtml(label)}</button>`;
  }).join('');
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${pills}</div>`;
}

// คอลัมน์ขวาของ edge ไม่มีแผงตั้งค่า (setting อยู่ที่ central) — บอกว่าทำไม
// ดีกว่าปล่อยว่างให้คนเดาว่าโหลดไม่ขึ้น
function _storRenderEdgeNote() {
  return `<section class="stor-card">
    <h3 class="stor-card-h">${escapeHtml(I18N.t('stor.setTitle'))}</h3>
    <p class="stor-note">${escapeHtml(I18N.t('stor.edgeSettingNote'))}</p>
  </section>`;
}

function _storRenderPurgePanel() {
  return `<section class="stor-card">
    <h3 class="stor-card-h">${escapeHtml(I18N.t('stor.purgeTitle'))}</h3>
    <p class="stor-note">${escapeHtml(I18N.t('stor.purgeHint'))}</p>
    <div class="stor-purge-row">
      <select class="form-input" id="storPurgeCat">
        <option value="events">${escapeHtml(I18N.t('stor.cat.events'))}</option>
        <option value="lpr">${escapeHtml(I18N.t('stor.cat.lpr'))}</option>
      </select>
      <label for="storPurgeDays">${escapeHtml(I18N.t('stor.purgeOlder'))}</label>
      <input class="form-input" id="storPurgeDays" type="number" min="1" max="3650" value="30">
      <span class="stor-unit">${escapeHtml(I18N.t('stor.unitDays'))}</span>
      <button class="btn btn-secondary admin-only" data-action="storDryRun">${escapeHtml(I18N.t('stor.purgeDryRun'))}</button>
    </div>
    <div id="storPurgeResult" class="stor-purge-result"></div>
  </section>`;
}

async function storPurgeDryRun() {
  const box = document.getElementById('storPurgeResult');
  const cat = document.getElementById('storPurgeCat')?.value;
  const days = parseInt(document.getElementById('storPurgeDays')?.value, 10);
  _storPurgePlan = null;
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    if (box) box.innerHTML = `<span style="color:var(--status-bad)">${escapeHtml(I18N.t('stor.purgeDaysRange'))}</span>`;
    return;
  }
  if (box) box.textContent = I18N.t('stor.purgeChecking');
  try {
    const r = await fetch(`${API}/api/storage/purge`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine: _storMachine, category: cat, days, dryRun: true }),
    });
    let j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    // edge ตอบเป็น reqId แล้วผลจริงมาทาง MQTT ต้องรอ ไม่ใช่ได้คำตอบทันทีเหมือน central
    if (j.queued && j.reqId) j = await _storAwaitPurge(j.reqId, box);
    if (!j || j.error) throw new Error((j && j.error) || 'edge ไม่ตอบ');
    if (!j.files) {
      if (box) box.innerHTML = `<span style="color:var(--text-secondary)">${escapeHtml(I18N.t('stor.purgeNothing'))}</span>`;
      return;
    }
    _storPurgePlan = { category: cat, days, files: j.files };
    const sample = (j.sample || []).map(f => `<div style="font-family:monospace;font-size:10px;color:var(--text-secondary)">${escapeHtml(f)}</div>`).join('');
    if (box) box.innerHTML =
      `<div style="color:var(--warn);font-weight:600">${escapeHtml(I18N.t('stor.purgeFound')
          .replace('{n}', Number(j.files).toLocaleString()).replace('{size}', formatBytes(j.bytesDisk)))}</div>
       ${sample}
       <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
         <button class="btn admin-only" data-action="storPurgeGo"
                 class="stor-danger-btn">${escapeHtml(I18N.t('stor.purgeConfirm'))}</button>
         <span style="font-size:11px;color:var(--status-bad)">${escapeHtml(I18N.t('stor.purgeIrreversible'))}</span>
       </div>`;
  } catch (e) {
    if (box) box.innerHTML = `<span style="color:var(--status-bad)">${escapeHtml(I18N.t('stor.purgeFailed') + e.message)}</span>`;
  }
}

// รอผลจาก edge — ไม่รอเกิน 60 วินาที แล้วบอกตรง ๆ ว่าไม่ตอบ ไม่ค้างเงียบ
async function _storAwaitPurge(reqId, box) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    if (box) box.textContent = I18N.t('stor.purgeWaitEdge').replace('{s}', (i + 1) * 2);
    try {
      const r = await fetch(`${API}/api/storage/purge/${encodeURIComponent(reqId)}`, { credentials: 'include', cache: 'no-store' });
      if (r.status === 404) continue;
      const j = await r.json();
      if (j.status === 'pending') continue;
      return j;
    } catch { /* ลองรอบถัดไป */ }
  }
  return { error: I18N.t('stor.purgeEdgeTimeout') };
}

async function storPurgeExecute() {
  const box = document.getElementById('storPurgeResult');
  if (!_storPurgePlan) return;
  const p = _storPurgePlan;
  // ยืนยันด้วยข้อความที่บอกจำนวนจริง ไม่ใช่ "แน่ใจหรือไม่" ลอย ๆ
  if (!confirm(I18N.t('stor.purgeConfirmMsg').replace('{n}', p.files).replace('{d}', p.days))) return;
  _storPurgePlan = null;                       // ใช้ได้ครั้งเดียว กันกดซ้ำ
  if (box) box.textContent = I18N.t('stor.purgeRunning');
  try {
    const r = await fetch(`${API}/api/storage/purge`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine: _storMachine, category: p.category, days: p.days, dryRun: false, confirmFiles: p.files }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    await loadStorageStats();
    const box2 = document.getElementById('storPurgeResult');
    if (box2) box2.innerHTML = `<span style="color:var(--status-ok)">${escapeHtml(I18N.t('stor.purgeDone')
      .replace('{n}', Number(j.deleted).toLocaleString()).replace('{size}', formatBytes(j.bytesDisk)))}</span>`;
  } catch (e) {
    const box2 = document.getElementById('storPurgeResult');
    if (box2) box2.innerHTML = `<span style="color:var(--status-bad)">${escapeHtml(I18N.t('stor.purgeFailed') + e.message)}</span>`;
  }
}

function initStoragePage() {
  const subbar = document.getElementById('storageSubbar');
  if (!subbar) return;

  // ใช้คลาส admin-only แบบเดียวกับปุ่มอื่นทั้งระบบ (page-health.js:111 เป็นต้น)
  // ไม่มีตัวแปร _isAdmin ในฝั่งหน้าจอ การซ่อนตามสิทธิ์ทำผ่านคลาสนี้
  _storRenderSubbar();

  // ผูกที่ container ไม่ใช่ที่ปุ่ม — เนื้อในถูก render ใหม่ทุกครั้งที่โหลดข้อมูล
  // ผูกทีละปุ่มจะหลุดทันทีที่ innerHTML ถูกเขียนทับ
  subbar.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="storScan"]')) startStorageScan();
  });
  const main = document.getElementById('storageMain');
  if (main) main.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="storSaveRet"]')) storSaveRetention();
    if (e.target.closest('[data-action="storDryRun"]'))  storPurgeDryRun();
    if (e.target.closest('[data-action="storPurgeGo"]')) storPurgeExecute();
    const mb = e.target.closest('[data-action="storMachine"]');
    if (mb) { _storMachine = mb.dataset.machine; _storPurgePlan = null; loadStorageStats(); }
  });

  // Load stats on init
  loadStorageStats();
}

// showPage() ใน dashboard.js เรียก initStoragePage() ตรง ๆ ตาม convention ของหน้าอื่น
// (if (name === 'reports') initReportsRedesign(); ฯลฯ) — ไม่มีระบบ hook อัตโนมัติ
let _storInited = false;
function initStoragePageOnce() {
  if (!_storInited) { _storInited = true; initStoragePage(); }
  else loadStorageStats();
}
