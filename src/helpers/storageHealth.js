// ============================================================
// Vigil Platform — Storage health sampler (mounts / mdraid)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Answers two questions the plain disk metric in hostMetrics.js cannot:
//
//   1. "Are snapshots landing on the disk we meant?" — the media array is
//      mounted with `nofail` so the box still boots when it fails to assemble.
//      That is deliberate (an unattended site must stay reachable) but it means
//      a failed mount is SILENT: the app keeps writing, straight onto the root
//      SSD, until / fills. `snapshot_dedicated` is the tripwire.
//
//   2. "Is the mirror still a mirror?" — RAID 1 with one dead disk behaves
//      exactly like a healthy one. Nothing surfaces until the second disk goes
//      and the footage is gone. `degraded` is the only early warning there is.
//
// Sites without a dedicated media disk (or without mdraid at all) are normal,
// not broken: `raid` comes back [] and `snapshot_dedicated` false. Only a site
// that HAD a dedicated array and lost it is worth an alert, and central knows
// which is which from its own history.
//
// Pure: reads the OS, returns a plain object, touches no DB and no network.
// Every field is nullable on purpose — this rides the bridge heartbeat, and a
// heartbeat carrying no metrics still keeps the site from being marked down.
// The reverse — a sampler that throws and kills the heartbeat — is useless.
'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// null means "could not tell" (no findmnt, macOS, permission) — deliberately
// distinct from a real filesystem name, so central never renders a guess.
function readFstype(dev) {
  try {
    const out = execFileSync('findmnt', ['-n', '-o', 'FSTYPE', '--source', dev],
      { encoding: 'utf8', timeout: 3000 });
    return out.trim().split('\n')[0] || null;
  } catch { return null; }
}

// `df -P` is the POSIX output format: one line per filesystem, six fields, no
// wrapping. Positional parsing is safe because no device or mount point we ship
// contains a space; anything exotic returns null rather than a wrong number.
function readMount(target, role) {
  try {
    const out = execFileSync('df', ['-kP', target], { encoding: 'utf8', timeout: 4000 });
    const line = out.trim().split('\n')[1];
    if (!line) return null;
    const p = line.trim().split(/\s+/);
    const total = parseInt(p[1], 10);
    const avail = parseInt(p[3], 10);
    if (!Number.isFinite(total) || !Number.isFinite(avail) || total <= 0) return null;
    return {
      role,                                   // 'system' | 'media'
      path:     target,
      dev:      p[0] || null,
      mount:    p[5] || null,
      fstype:   readFstype(p[0]),
      total_gb: +(total / 1048576).toFixed(1),
      free_gb:  +(avail / 1048576).toFixed(1),
      used_pct: +(((total - avail) / total) * 100).toFixed(1),
    };
  } catch { return null; }
}

// /proc/mdstat, per array. Returns [] on a Linux box with no arrays, and null
// when the file cannot be read at all (non-Linux central) — central should
// render those two differently: "no RAID" vs "unknown".
// `mdstatText` is only for tests: a degraded array is the one state that must
// never be misparsed, and it cannot be reproduced on a healthy box.
function readRaid(mdstatText) {
  let txt = mdstatText;
  if (txt == null) {
    try { txt = fs.readFileSync('/proc/mdstat', 'utf8'); }
    catch { return null; }
  }

  try {
    const arrays = [];
    // An array is a header line at column 0 plus its indented continuation
    // lines; split on "newline followed by a non-space" to keep them together.
    for (const block of txt.split(/\n(?=\S)/)) {
      const head = block.match(/^(md\d+)\s*:\s*(\S+)\s+(raid\d+|linear|faulty)\s+(.*)$/m);
      if (!head) continue;
      const [, dev, state, level, membersRaw] = head;

      // e.g. "sdb1[1] sda1[0](F)" — (F) failed, (S) spare.
      const members = (membersRaw.match(/\S+\[\d+\](?:\([A-Z]\))?/g) || []).map((tok) => {
        const m = tok.match(/^(.+?)\[(\d+)\](?:\(([A-Z])\))?$/);
        if (!m) return { name: tok, role: null, failed: null, spare: null };
        return { name: m[1], role: +m[2], failed: m[3] === 'F', spare: m[3] === 'S' };
      });

      const size  = block.match(/^\s+(\d+)\s+blocks/m);
      // "[2/2] [UU]" — configured devices / working devices, then a flag per slot.
      const stat  = block.match(/\[(\d+)\/(\d+)\]\s+\[([U_]+)\]/);
      const sync  = block.match(/\b(resync|recovery|reshape|check)\s*=\s*([\d.]+)%/);
      const eta   = block.match(/finish=([\d.]+)min/);

      arrays.push({
        dev,
        level,
        state,                                          // 'active' | 'inactive' | …
        size_gb:         size ? +(Number(size[1]) / 1048576).toFixed(1) : null,
        devices_total:   stat ? +stat[1] : null,
        devices_active:  stat ? +stat[2] : null,
        flags:           stat ? stat[3] : null,         // 'UU' healthy · 'U_' one gone
        degraded:        stat ? stat[3].includes('_') : null,
        sync_action:     sync ? sync[1] : null,         // null when idle
        sync_pct:        sync ? +sync[2] : null,
        sync_eta_min:    eta  ? +eta[1]  : null,
        members,
      });
    }
    return arrays;
  } catch { return null; }
}

// snapshotDir is passed in rather than read from env here: bridge.js already
// resolves it (env override, else <repo>/snapshots) and the sampler must report
// on the path the writers actually use, not re-derive its own answer.
function sampleStorage(snapshotDir) {
  // Callers build this with path.join(__dirname, '..', …), so it arrives full of
  // '..' segments. Central compares and displays this string — resolve it once
  // here so every site reports one canonical absolute path.
  const dir = snapshotDir ? path.resolve(snapshotDir) : null;

  const system = readMount('/', 'system');
  const media  = dir ? readMount(dir, 'media') : null;

  // Same device => snapshots are NOT on their own disk. On a site that never
  // had one this is simply the layout; on a site that does, it means the media
  // mount is missing and writes are silently going to the root filesystem.
  const dedicated = (system && media) ? (media.dev !== system.dev) : null;

  const mounts = [system];
  if (media && dedicated) mounts.push(media);

  return {
    snapshot_dir:       dir,
    snapshot_dedicated: dedicated,
    mounts:             mounts.filter(Boolean),
    raid:               readRaid(),
  };
}

// ดิสก์ที่ "ภาพลงจริง" — ไม่ใช่ดิสก์ระบบเสมอไป
//
// เหตุ 2026-08-31: hkt แขวน snapshot ไว้บน md0 (RAID1 3.6 TB) แยกจาก / ที่เป็น
// nvme 467 GB · หน้า Storage พาดหัวด้วยดิสก์ระบบจึงขึ้น 13% ทั้งที่ดิสก์ที่เก็บภาพ
// อยู่ที่ 70.3% · หนักกว่านั้นคือ checkEdgeDiskLow() เทียบ min_free_gb กับดิสก์ระบบ
// ซึ่งไม่มีอะไรเขียนลงไป จึงไม่มีวันต่ำกว่าเกณฑ์ = เงื่อนไขพื้นที่ของไซต์นั้นตายสนิท
// ขณะที่ตัวลบบน edge (snapshot-retention.js:137 readMount(dir)) ดูดิสก์ที่ถูกอยู่แล้ว
//
// ฟังก์ชันนี้จึงมีไว้ให้ "ตัวเตือน" กับ "ตัวแสดงผล" ใช้ตัวเดียวกับที่ตัวลบใช้ ไม่ใช่
// ให้แต่ละที่ไปหยิบ mount เอาเอง แล้วค่อย ๆ เลื่อนออกจากกันเงียบ ๆ
//
// คืน null เมื่อไม่มี mounts เลย (edge ที่ยังไม่เคยส่ง storage_json) — ผู้เรียกต้อง
// แยก "ไม่รู้" ออกจาก "ว่าง 0 GB" เอง อย่าให้ตกเป็น 0
function snapshotMount(storage) {
  const mounts = storage && Array.isArray(storage.mounts) ? storage.mounts : [];
  if (!mounts.length) return null;
  // เชื่อ role ที่ sampleStorage ติดป้ายไว้ ไม่เดาจากชื่อ path
  return mounts.find(m => m.role === 'media') || mounts.find(m => m.role === 'system') || mounts[0];
}

function systemMount(storage) {
  const mounts = storage && Array.isArray(storage.mounts) ? storage.mounts : [];
  return mounts.find(m => m.role === 'system') || null;
}

module.exports = { sampleStorage, readRaid, readMount, snapshotMount, systemMount };
