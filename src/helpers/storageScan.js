// ============================================================
// Vigil Platform — Storage Scanner Helper
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Recursively scan a directory and accumulate stats: bytes, files, oldest mtime.
 * Respects time budget and stops with partial=true if exceeded.
 * A missing directory is not an error — returns zero stats.
 * Silently skips unreadable files; does not follow symlinks.
 *
 * @param {string} dir - directory to scan
 * @param {object} opts - {budgetMs: 120000} time budget in milliseconds
 * @returns {Promise<{bytes, files, oldestMs, partial, scanMs}>}
 */
async function scanCategory(dir, { budgetMs = 120000 } = {}) {
  const startTime = Date.now();
  let bytes = 0;
  let bytesDisk = 0;
  let files = 0;
  let oldestMs = null;
  let partial = false;
  let entriesChecked = 0;

  // If directory doesn't exist, return zero stats
  if (!fs.existsSync(dir)) {
    return { bytes: 0, bytesDisk: 0, files: 0, oldestMs: null, partial: false, scanMs: 0 };
  }

  async function walk(dirPath) {
    // Check time budget every 500 entries
    if (entriesChecked % 500 === 0) {
      const elapsed = Date.now() - startTime;
      if (elapsed > budgetMs) {
        partial = true;
        return; // stop walking
      }
    }

    let entries;
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      // Skip unreadable directories
      return;
    }

    for (const dirent of entries) {
      entriesChecked++;

      // Check time budget every so often
      if (entriesChecked % 500 === 0) {
        const elapsed = Date.now() - startTime;
        if (elapsed > budgetMs) {
          partial = true;
          return;
        }
      }

      const fullPath = path.join(dirPath, dirent.name);

      try {
        // Skip symlinks
        if (dirent.isSymbolicLink()) {
          continue;
        }

        if (dirent.isDirectory()) {
          await walk(fullPath);
        } else if (dirent.isFile()) {
          files++;
          try {
            const st = await fs.promises.stat(fullPath);
            bytes += st.size;
            // ไฟล์เล็กนับล้านใบปัดขึ้นเป็นบล็อกละ 4 KB — snapshots/events มี 112,958 ไฟล์
            // apparent 230 MB แต่กินดิสก์จริง 488 MB (2.1 เท่า) หน้าที่บอกว่า "ดิสก์หายไปไหน"
            // ต้องรายงานบล็อกที่ถูกจับจอง ไม่ใช่ผลรวมขนาดไฟล์ · st.blocks เป็นหน่วย 512 ไบต์
            // ตาม POSIX เสมอ ไม่ขึ้นกับ block size ของ filesystem (วัดเทียบ du -s ต่าง 1.3%
            // ส่วนต่างคือ dir entry เองที่เราไม่ได้นับ)
            bytesDisk += st.blocks * 512;
            const mtime = st.mtimeMs;
            if (oldestMs === null || mtime < oldestMs) {
              oldestMs = mtime;
            }
          } catch (err) {
            // Skip unreadable files but count them
          }
        }
      } catch (err) {
        // Silently skip files/dirs that can't be stat'd
      }

      // Final budget check after processing this entry
      if (entriesChecked % 500 === 0) {
        const elapsed = Date.now() - startTime;
        if (elapsed > budgetMs) {
          partial = true;
          return;
        }
      }
    }
  }

  await walk(dir);

  const scanMs = Date.now() - startTime;
  return {
    bytes,
    bytesDisk,
    files,
    oldestMs,
    partial,
    scanMs,
  };
}

/**
 * Scan all storage categories in parallel with a shared time budget.
 * Categories: events, lpr, lpr-watchlist, face-blacklist, root-flat, blacklist-photos, reports, public-files
 *
 * @param {object} opts - {budgetMs: 120000, SNAPSHOT_DIR, REPORTS_DIR, PHOTO_DIR, FILES_DIR}
 * @returns {Promise<Array>} array of {category, bytes, files, oldestMs, partial, scanMs}
 */
async function scanAll({ budgetMs = 120000, SNAPSHOT_DIR, REPORTS_DIR, PHOTO_DIR, FILES_DIR } = {}) {
  const startTime = Date.now();

  // Define all categories and their paths
  const categories = [
    { name: 'events', dir: path.join(SNAPSHOT_DIR, 'events') },
    { name: 'lpr', dir: path.join(SNAPSHOT_DIR, 'lpr') },
    { name: 'lpr-watchlist', dir: path.join(SNAPSHOT_DIR, 'lpr-watchlist') },
    { name: 'face-blacklist', dir: path.join(SNAPSHOT_DIR, 'face-blacklist') },
    { name: 'blacklist-photos', dir: PHOTO_DIR },
    { name: 'reports', dir: REPORTS_DIR },
    { name: 'public-files', dir: FILES_DIR },
    // root-flat = files directly in SNAPSHOT_DIR (not recursing into subdirs)
  ];

  // Scan each category in parallel, tracking elapsed time
  const results = await Promise.all(
    categories.map(async (cat) => {
      const elapsed = Date.now() - startTime;
      const remainingBudget = Math.max(1000, budgetMs - elapsed); // at least 1 sec per scan
      const result = await scanCategory(cat.dir, { budgetMs: remainingBudget });
      return {
        category: cat.name,
        bytes: result.bytes,
        bytesDisk: result.bytesDisk,
        files: result.files,
        oldestMs: result.oldestMs,
        partial: result.partial,
        scanMs: result.scanMs,
      };
    })
  );

  // Scan root-flat separately (files directly in SNAPSHOT_DIR, not subdirs)
  const elapsed = Date.now() - startTime;
  const remainingBudget = Math.max(1000, budgetMs - elapsed);
  let rootFlatStats = { bytes: 0, files: 0, oldestMs: null, partial: false, scanMs: 0 };

  try {
    const rootStartTime = Date.now();
    const entries = await fs.promises.readdir(SNAPSHOT_DIR, { withFileTypes: true });
    let rootBytes = 0;
    let rootBytesDisk = 0;
    let rootFiles = 0;
    let rootOldestMs = null;

    for (const dirent of entries) {
      if (Date.now() - rootStartTime > remainingBudget) {
        rootFlatStats.partial = true;
        break;
      }

      // Only count files directly in root (not subdirs)
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) {
        rootFiles++;
        const fullPath = path.join(SNAPSHOT_DIR, dirent.name);
        try {
          const st = await fs.promises.stat(fullPath);
          rootBytes += st.size;
          rootBytesDisk += st.blocks * 512;
          const mtime = st.mtimeMs;
          if (rootOldestMs === null || mtime < rootOldestMs) {
            rootOldestMs = mtime;
          }
        } catch (err) {
          // skip
        }
      }
    }

    rootFlatStats = {
      bytes: rootBytes,
      bytesDisk: rootBytesDisk,
      files: rootFiles,
      oldestMs: rootOldestMs,
      partial: rootFlatStats.partial,
      scanMs: Date.now() - rootStartTime,
    };
  } catch (err) {
    rootFlatStats = { bytes: 0, files: 0, oldestMs: null, partial: false, scanMs: 0 };
  }

  results.push({
    category: 'root-flat',
    bytes: rootFlatStats.bytes,
    bytesDisk: rootFlatStats.bytesDisk,
    files: rootFlatStats.files,
    oldestMs: rootFlatStats.oldestMs,
    partial: rootFlatStats.partial,
    scanMs: rootFlatStats.scanMs,
  });

  return results;
}

/**
 * Get disk usage stats for the filesystem holding a given path.
 * Uses fs.statfs if available (Node.js 13.5+), falls back to df on error.
 *
 * @param {string} dirPath - path to check (any path on the target filesystem)
 * @returns {Promise<{total_bytes, used_bytes, available_bytes, method}>}
 */
async function getDiskUsage(dirPath = '/') {
  // Try fs.statfs first (Node 13.5+)
  if (fs.promises.statfs) {
    try {
      const stats = await fs.promises.statfs(dirPath);
      // bsize = block size, blocks = total blocks, bavail = available blocks
      const totalBytes = stats.blocks * stats.bsize;
      const availableBytes = stats.bavail * stats.bsize;
      const usedBytes = totalBytes - availableBytes;
      return {
        total_bytes: totalBytes,
        used_bytes: usedBytes,
        available_bytes: availableBytes,
        method: 'statfs',
      };
    } catch (err) {
      // Fall through to df
    }
  }

  // Fall back to df
  try {
    const { stdout } = await execAsync(`df -kP "${dirPath}" | tail -1`);
    const parts = stdout.trim().split(/\s+/);
    if (parts.length >= 3) {
      const totalKb = parseInt(parts[1], 10);
      const usedKb = parseInt(parts[2], 10);
      const totalBytes = totalKb * 1024;
      const usedBytes = usedKb * 1024;
      const availableBytes = totalBytes - usedBytes;
      return {
        total_bytes: totalBytes,
        used_bytes: usedBytes,
        available_bytes: availableBytes,
        method: 'df',
      };
    }
  } catch (err) {
    // Silently fail
  }

  // If all else fails, return nulls
  return {
    total_bytes: null,
    used_bytes: null,
    available_bytes: null,
    method: 'failed',
  };
}

// ── นับ orphan ของภาพเหตุการณ์ ──────────────────────────────
// ทิศทางสำคัญ: ส่งชื่อไฟล์เข้า Postgres แล้วให้ DB anti-join ไม่ใช่โหลดชื่อไฟล์
// จาก DB มาเทียบใน JS — ช่วง 10 วันมี event 9.9 ล้านแถว ชื่อไฟล์รวม 764 MB
// โหลดเข้า Set ใน V8 กินหลาย GB ส่วนฝั่งไฟล์มีแค่ 112k แถว ส่งขึ้นไปถูกกว่ามาก
//
// ไม่มี index บน events.snapshot_filename จึงเป็น full scan — เดิมข้าม 25 partition
// วัดจริง ~42 วินาทีต่อรอบ (2026-08-24) และ 77-85 วินาทีใน slow log (2026-09-06)
// ไม่ใส่ index ให้เพราะเป็น index ใหญ่บนตาราง 26 ล้านแถว ต้องตัดสินใจแยก
// แทนที่ด้วยการล้อมกรอบเวลาแทน — ดู ORPHAN_DAY_RE ข้างล่าง
//
// เดินทรีแบบ async (fs.promises) ไม่ใช่ sync — โค้ดเดิมบล็อก event loop ของ
// api-server ตลอดการเดิน 158k ไฟล์ · รูปแบบเดียวกับ scanCategory() ในไฟล์นี้
const ORPHAN_DAY_RE = /^events[/\\](\d{4}-\d{2}-\d{2})[/\\]/;

async function countEventOrphans(pool, snapshotDir, { budgetMs = 180000 } = {}) {
  const t0 = Date.now();
  const dir = path.join(snapshotDir, 'events');
  if (!fs.existsSync(dir)) return { orphans: 0, orphanBytesDisk: 0, checked: 0, scanMs: 0 };

  // เก็บ path + ขนาดบล็อก ไว้ตอบว่าลบแล้วได้พื้นที่คืนเท่าไร
  const rows = [];
  async function walk(d) {
    if (Date.now() - t0 > budgetMs) return;
    let entries;
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        try {
          const st = await fs.promises.stat(full);
          rows.push([path.relative(snapshotDir, full), st.blocks * 512]);
        } catch { /* ไฟล์หายไประหว่างเดิน ไม่นับ */ }
      }
    }
  }
  await walk(dir);
  if (!rows.length) return { orphans: 0, orphanBytesDisk: 0, checked: 0, scanMs: Date.now() - t0 };

  // ── ล้อมกรอบ anti-join ด้วยเวลา เพื่อให้ partition pruning ทำงาน ────────────
  // path คือ events/<YYYY-MM-DD>/<cam>/<slot>/<file> โดย <YYYY-MM-DD> มาจาก
  // snapshot-path.js:19 → `new Date(tsMs).toISOString()` = **UTC ของเวลารับเข้า**
  // (tsMs = Date.now() ที่ mqtt-subscriber.js:166/256/1830) ส่วน events.event_time
  // คือเวลาของเหตุการณ์ที่กล้องส่งมา — คนละนาฬิกา จึงต้องเผื่อ
  //
  // วัดจริง 2026-09-06 บน 13,387,233 แถวที่มี snapshot_filename:
  //   min(event_time - received_at) = -19:22:24 · max = +00:00:53 · p99.9 = +3.2s
  //   แถวที่เพี้ยนเกิน 1 วัน = 0
  // เผื่อ −1 วัน / +2 วันจึงครอบ tail ที่วัดได้ (เหลือ margin ~4.6 ชม.ฝั่งลบ)
  // ⚠️ ถ้า skew โตเกิน 24 ชม. (edge replay ค้างนาน ๆ นาฬิกากล้องเพี้ยน) ไฟล์นั้น
  //    จะถูกนับเป็น orphan ทั้งที่มีเจ้าของ — ตัวเลขบนหน้าจอเฟ้อ ไม่มีการลบเกิดขึ้น
  //    (routes/storage.js:256 ยังไม่เปิดให้ลบ orphan) แก้โดยขยายตัวเลขสองตัวนี้
  // path ที่หน้าตาไม่ตรงรูปแบบแม้แถวเดียว = กลับไป join แบบไม่ล้อมกรอบ
  // ดีกว่ารายงาน orphan ปลอมของ layout เก่าที่เราไม่รู้จัก
  let minDay = null, maxDay = null, bounded = true;
  for (const [f] of rows) {
    const m = ORPHAN_DAY_RE.exec(f);
    if (!m) {
      // เงียบไม่ได้ — ไฟล์แปลกปลอมใบเดียวปิดการล้อมกรอบทั้งรอบ กลับไปสแกนทุก partition
      console.warn(`💾 orphan: path ไม่ตรงรูปแบบ events/<YYYY-MM-DD>/… (${f}) — ข้ามการล้อมกรอบเวลา รอบนี้สแกนทุก partition`);
      bounded = false;
      break;
    }
    if (minDay === null || m[1] < minDay) minDay = m[1];
    if (maxDay === null || m[1] > maxDay) maxDay = m[1];
  }
  // ── ปัดออกถึงขอบเดือน ──────────────────────────────────────────────────────
  // partition ของ events เป็นรายเดือน · ถ้าล้อมกรอบแบบระบุวัน planner จะเห็นว่า
  // หน้าต่างกินแค่ 26% ของ events_y2026m08 แล้วเลือก Index Scan บน
  // events_y2026m08_event_time_idx — วัดจริง 2026-09-06 ได้ 229 วินาที (แย่กว่าเดิม
  // 83 วินาที) เพราะ correlation 0.9886 ยังไม่พอ ต้องอ่านสุ่ม 2.9 ล้านหน้าจากดิสก์
  // ปัดขอบทั้งสองด้านออกไปถึงต้นเดือน = partition ที่รอดถูกกินทั้งใบ planner จึงกลับไป
  // Seq Scan · ปัดออกไม่เคยเพิ่มจำนวน partition ที่ถูกสแกน (ขอบใหม่อยู่ในเดือนเดิม
  // ของขอบเก่าเสมอ) และหน้าต่างที่กว้างขึ้น = ปลอดภัยขึ้นเรื่อง orphan ปลอม
  const bounded0 = bounded ? [new Date(Date.parse(`${minDay}T00:00:00Z`) - 86400000),
                              new Date(Date.parse(`${maxDay}T00:00:00Z`) + 2 * 86400000)] : null;
  const bounds = bounded0
    ? [new Date(Date.UTC(bounded0[0].getUTCFullYear(), bounded0[0].getUTCMonth(), 1)),
       new Date(Date.UTC(bounded0[1].getUTCFullYear(), bounded0[1].getUTCMonth() + 1, 1))]
    : [];
  // อยู่ใน ON ไม่ใช่ WHERE — LEFT JOIN + `WHERE e.id IS NULL` ต้องยังหา orphan เจอ
  const joinWindow = bounded ? 'AND e.event_time >= $1 AND e.event_time < $2' : '';

  const client = await pool.connect();
  try {
    // BEGIN ต้องมาก่อน CREATE TEMP ... ON COMMIT DROP ไม่งั้น CREATE วิ่งใน implicit
    // transaction ของตัวเองแล้วตารางถูก drop ทันทีที่ commit → "relation does not exist"
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE _orph(f text, b bigint) ON COMMIT DROP');
    const B = 2000;
    for (let i = 0; i < rows.length; i += B) {
      const chunk = rows.slice(i, i + B);
      const vals = chunk.map((_, k) => `($${k * 2 + 1},$${k * 2 + 2})`).join(',');
      await client.query(`INSERT INTO _orph(f,b) VALUES ${vals}`, chunk.flat());
    }
    // ตาราง temp ไม่มี stats — planner เดา 253,080 แถวแล้วเลือก hash ฝั่ง events
    // (13 ล้านแถว 64 batch สาด temp ลงดิสก์ 1.4 GB) แทนที่จะ hash ฝั่ง _orph
    // (158k แถว 1 batch 18 MB) · ANALYZE ใช้ ~130 ms คืนมาเป็นสิบวินาที
    await client.query('ANALYZE _orph');
    const { rows: agg } = await client.query(
      `SELECT count(*) AS orphans, coalesce(sum(o.b),0) AS bytes
         FROM _orph o LEFT JOIN events e ON e.snapshot_filename = o.f ${joinWindow}
        WHERE e.id IS NULL`,
      bounds
    );
    await client.query('COMMIT');
    return {
      orphans: Number(agg[0].orphans),
      orphanBytesDisk: Number(agg[0].bytes),
      checked: rows.length,
      scanMs: Date.now() - t0,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  countEventOrphans,
  scanCategory,
  scanAll,
  getDiskUsage,
};