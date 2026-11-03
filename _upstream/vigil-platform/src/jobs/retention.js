// ============================================================
// Vigil Platform — Retention sweeps (daily)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const path = require('path');
const fs   = require('fs');
const { frozenScope, eachCameraBatch, camClause } = require('../helpers/retentionScope');
const { safeCamDir } = require('../snapshot-path');

// ============================================================
// Retention enforcement (daily)
// ============================================================
// start() is called from api-server.js at exactly the point the timers used to
// be declared, so the staggered boot schedule below is unchanged. Nothing runs
// at require time. No symbols go back to api-server — every sweep and the batch
// size they share now live here.
module.exports.start = function startRetention(deps) {
  const {
    pool, getSystemSetting, retentionBeat,
    SNAPSHOT_DIR, THUMBS_DIR, BBOX_CACHE_DIR, MEDIA_DIR, REPORTS_DIR, FILES_DIR,
  } = deps;

  // Delete rows in batches to avoid a long-running table lock at high volume.
  // Uses id-IN-subquery pattern so each batch is its own short transaction.
  const _RETENTION_BATCH = 10_000;
  async function _batchDelete(sql, params, label) {
    let total = 0, count;
    do {
      const res = await pool.query(sql, params);
      count = res.rowCount;
      total += count;
      if (count > 0) await new Promise(r => setTimeout(r, 100)); // yield between batches
    } while (count === _RETENTION_BATCH);
    if (total > 0) console.log(`🧹 Retention: deleted ${total} ${label}`);
    return total;
  }

  async function enforceRetention() {
    try {
      const _drv = await getSystemSetting(pool, 'data_retention_days');
      const days = Math.min(730, Math.max(1, parseInt(_drv || '365', 10)));
      const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
      // 🧊 ไซต์ปิดปรับปรุง (sites.status <> 'active') = ห้ามลบข้อมูลของมัน · อ่านก่อนลบแถวแรก
      // อ่านไม่ได้ = โยนลง catch ล่างสุด → รอบนี้ไม่ลบอะไรเลย (fail closed)
      // อ่านครั้งเดียวต่อรอบ — ไซต์ที่ถูกแช่แข็ง "ระหว่าง" รอบที่กำลังวิ่ง จะมีผลรอบถัดไป
      const { frozenCams, liveCams } = await frozenScope(pool);
      const frozen = frozenCams.length > 0;
      // Explicit child-delete before events — all 5 children (appearances, license_plates,
      // face_event_notes, face_event_acks, lpr_alert_acks) lose their FK cascade
      // (dropped in MANUAL_partition_events_option_a.sql; required for partitioned parent).
      async function _deleteEventsAndChildren(ids) {
        await pool.query(`DELETE FROM appearances       WHERE event_id = ANY($1::bigint[])`, [ids]);
        // No-op after the anprAlarm exclusion (non-LPR events have no plates) —
        // kept defensively in case a non-anpr event ever carries a plate row.
        await pool.query(`DELETE FROM license_plates    WHERE event_id = ANY($1::bigint[])`, [ids]);
        await pool.query(`DELETE FROM face_event_notes  WHERE event_id = ANY($1::bigint[])`, [ids]);
        await pool.query(`DELETE FROM face_event_acks   WHERE event_id = ANY($1::bigint[])`, [ids]);
        await pool.query(`DELETE FROM lpr_alert_acks    WHERE event_id = ANY($1::bigint[])`, [ids]);
        const _del = await pool.query(`DELETE FROM events WHERE id = ANY($1::bigint[])`, [ids]);
        return _del.rowCount;
      }
      let _totalEventsDeleted = 0, _evBatch;
      if (frozen) {
        // โหมดรายกล้อง (ดู eachCameraBatch) — เฉพาะกล้องของไซต์ active/ไม่มีไซต์ + แถว camera_id NULL
        // 🟡 ยอมรับ: event ของ camera_id ที่ไม่มีในตาราง cameras (orphan) ไม่ถูกลบตลอดช่วงที่มีไซต์แช่แข็ง
        //    (ไม่รู้ว่าเป็นของไซต์ไหน) — กลับมาลบเองเมื่อไม่มีไซต์แช่แข็งแล้ว
        _totalEventsDeleted = await eachCameraBatch(liveCams, {
          batch: _RETENTION_BATCH,
          select: async (cam) => {
            const [w, p] = camClause(cam, [cutoff, _RETENTION_BATCH]);
            const r = await pool.query(
              `SELECT id FROM events WHERE ${w} AND event_time < $1 AND event_type IS DISTINCT FROM 'anprAlarm'
                 ORDER BY event_time LIMIT $2`, p);
            return r.rows.map(x => x.id);
          },
          apply: _deleteEventsAndChildren,
        });
      } else do {
        // Class-E decouple: anprAlarm (LPR) is EXCLUDED from general retention — it
        // has its own window (lpr_retention_days, enforceLprRetention) so the slim
        // plate log can outlive general events. IS DISTINCT FROM also deletes
        // NULL-type rows. ⚠️ enforceLprRetention is now the SOLE authority for LPR
        // rows — if it stalls, anprAlarm has no general backstop (surface a metric).
        const _ids = await pool.query(
          `SELECT id FROM events WHERE event_time < $1 AND event_type IS DISTINCT FROM 'anprAlarm'
             ORDER BY event_time LIMIT $2`,
          [cutoff, _RETENTION_BATCH]
        );
        _evBatch = _ids.rowCount;
        if (_evBatch === 0) break;
        const ids = _ids.rows.map(r => r.id);
        _totalEventsDeleted += await _deleteEventsAndChildren(ids);
        if (_evBatch === _RETENTION_BATCH) await new Promise(r => setTimeout(r, 100));
      } while (_evBatch === _RETENTION_BATCH);
      if (_totalEventsDeleted > 0)
        console.log(`🧹 Retention: deleted ${_totalEventsDeleted} events older than ${days} days`);
      // 🔴 เวกเตอร์ใบหน้า (biometric) + คิวของมัน ไม่มี FK ไปที่ events แล้ว (ถูกถอดตอนแบ่ง partition)
      // ลูปข้างบนจึงลบไม่ถึง และไม่มีที่ไหนลบเลย (ตรวจ 2026-10-02: face_embeddings 13 GB 4.78M แถว
      // · face_embed_queue 6.7M แถว) ⇒ ลบด้วยขอบเวลาเดียวกับ events ใบหน้าไม่ใช่ anprAlarm จึงใช้ cutoff นี้
      // queue ไม่มีดัชนี event_time → เดินตาม pkey (แถวเข้าเรียงเวลา ของเก่าอยู่หัวตาราง)
      // 🧊 แช่แข็ง: กรองกล้องของไซต์แช่แข็งออกตรง ๆ (ไม่ทำรายกล้อง) — ไซต์ edge แทบไม่มีแถวใบหน้า
      // ถ้าวันหนึ่งไซต์แช่แข็งถือแถวใบหน้าเก่าเป็นก้อนใหญ่ ทุก batch จะไล่ข้ามหัวก้อนนั้นซ้ำ → ค่อยเปลี่ยนเป็นรายกล้อง
      // 🟡 แถว camera_id NULL ยังถูกลบ (คอลัมน์ denormalize ตั้งแต่ migration 131 — แถวเก่ากว่านั้นอาจเป็นของไซต์แช่แข็ง)
      if (frozen) {
        await _batchDelete(
          `DELETE FROM face_embeddings WHERE id IN (
             SELECT id FROM face_embeddings WHERE event_time < $1
                AND (camera_id IS NULL OR camera_id <> ALL($3::text[])) LIMIT $2)`,
          [cutoff, _RETENTION_BATCH, frozenCams], `face embeddings older than ${days} days`);
        await _batchDelete(
          `DELETE FROM face_embed_queue WHERE id IN (
             SELECT id FROM face_embed_queue WHERE event_time < $1
                AND (camera_id IS NULL OR camera_id <> ALL($3::text[])) ORDER BY id LIMIT $2)`,
          [cutoff, _RETENTION_BATCH, frozenCams], `face embed queue rows older than ${days} days`);
      } else {
      await _batchDelete(
        `DELETE FROM face_embeddings WHERE id IN (
           SELECT id FROM face_embeddings WHERE event_time < $1 LIMIT $2)`,
        [cutoff, _RETENTION_BATCH], `face embeddings older than ${days} days`);
      await _batchDelete(
        `DELETE FROM face_embed_queue WHERE id IN (
           SELECT id FROM face_embed_queue WHERE event_time < $1 ORDER BY id LIMIT $2)`,
        [cutoff, _RETENTION_BATCH], `face embed queue rows older than ${days} days`);
      }
      // appearances — optional separate retention (partial anonymisation: keep event, drop biometrics)
      // Capped at data_retention_days so it can never be LONGER than the event retention.
      const _arv = await getSystemSetting(pool, 'appearances_retention_days');
      if (_arv && frozen) {
        const arDays = Math.min(days, Math.max(1, parseInt(_arv, 10)));
        const arCutoff = new Date(Date.now() - arDays * 86400 * 1000).toISOString();
        // 🧊 รายกล้องเฉพาะกล้องที่ยังเปิด — คงรูป JOIN events เดิม (ขอบเวลาจาก e.event_time
        // เพราะ appearances.event_time ของแถวเก่าอาจยังเป็น NULL) ใช้ idx_appearances_camera นำ
        // ไม่มีรอบ camera_id NULL: คอลัมน์ denormalize — NULL ไม่ได้แปลว่าไม่ใช่ของไซต์แช่แข็ง (ลบน้อยไว้ก่อน)
        for (const cam of liveCams) {
          await _batchDelete(
            `DELETE FROM appearances WHERE id IN (
               SELECT a.id FROM appearances a
               JOIN events e ON e.id = a.event_id
               WHERE a.camera_id = $3 AND e.event_time < $1 LIMIT $2
             )`,
            [arCutoff, _RETENTION_BATCH, cam],
            `appearance rows older than ${arDays} days (${cam})`
          );
        }
      } else if (_arv) {
        const arDays = Math.min(days, Math.max(1, parseInt(_arv, 10)));
        const arCutoff = new Date(Date.now() - arDays * 86400 * 1000).toISOString();
        await _batchDelete(
          `DELETE FROM appearances WHERE id IN (
             SELECT a.id FROM appearances a
             JOIN events e ON e.id = a.event_id
             WHERE e.event_time < $1 LIMIT $2
           )`,
          [arCutoff, _RETENTION_BATCH],
          `appearance rows older than ${arDays} days`
        );
      }
      // camera_status_log fixed at 90-day retention (Ph.1, decision #134)
      const logCutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
      await pool.query(`DELETE FROM camera_status_log WHERE changed_at < $1`, [logCutoff]);
      // report_history rows — 90-day retention (Ph.2)
      const rhCutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
      const rhDel = await pool.query(`DELETE FROM report_history WHERE created_at < $1`, [rhCutoff]);
      if (rhDel.rowCount > 0) console.log(`🧹 Retention: deleted ${rhDel.rowCount} report_history rows`);
      // LINE pending recipients — keep abandoned self-service requests for 30d.
      const pendingCutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      const prDel = await pool.query(
        `DELETE FROM pending_recipients WHERE status = 'pending' AND first_seen_at < $1`,
        [pendingCutoff]
      ).catch(() => ({ rowCount: 0 }));
      if (prDel.rowCount > 0) console.log(`🧹 Retention: deleted ${prDel.rowCount} pending LINE recipient(s)`);
      // ปูมคำสั่งผ่าน LINE — 90 วัน · คำถามที่ค้าง — 1 วัน
      // ทั้งสองตารางเขียนทุกครั้งที่มีคนพิมพ์ในกลุ่มที่บอทอยู่ (รวมข้อความที่ไม่ใช่คำสั่ง
      // ซึ่งลง `denied`) ⇒ โตเรื่อย ๆ โดยไม่มีเพดาน ถ้าไม่มีใครกวาด
      // คำถามค้างมีอายุจริงแค่ 2 นาที (ตัวรันเช็คเองอยู่แล้ว) แถวที่เหลือคือขยะล้วน
      try {
        const lcDel = await pool.query(
          `DELETE FROM line_command_log WHERE at < now() - interval '90 days'`);
        if (lcDel.rowCount > 0) console.log(`🧹 Retention: ลบปูมคำสั่ง LINE ${lcDel.rowCount} แถว`);
        const askDel = await pool.query(
          `DELETE FROM line_pending_asks WHERE asked_at < now() - interval '1 day'`);
        if (askDel.rowCount > 0) console.log(`🧹 Retention: ลบคำถามค้างของบอท ${askDel.rowCount} แถว`);
      } catch (e) { console.warn('🧹 line command retention error:', e.message); }
      // report PNG files — 30-day retention (Ph.2)
      try {
        // migration 177 — เดิมตายตัว 30 วัน ค่าเริ่มต้นยังเป็น 30 คนที่ไม่แตะอะไรจึงได้เหมือนเดิม
        const _rrd = parseInt(await getSystemSetting(pool, 'report_retention_days') || '30', 10);
        const reportDays = (Number.isFinite(_rrd) && _rrd >= 1 && _rrd <= 365) ? _rrd : 30;
        const pngCutoff = Date.now() - reportDays * 86400 * 1000;
        const reportFiles = await fs.promises.readdir(REPORTS_DIR).catch(() => []);
        let pngDeleted = 0, pngFreed = 0;
        for (const fname of reportFiles) {
          if (!fname.toLowerCase().endsWith('.png')) continue;
          const full = path.join(REPORTS_DIR, fname);
          const st = await fs.promises.stat(full).catch(() => null);
          if (st && st.mtimeMs < pngCutoff) {
            pngFreed += st.size;
            await fs.promises.unlink(full).catch(() => {});
            pngDeleted++;
          }
        }
        if (pngDeleted > 0) {
          const mb = (pngFreed / (1024 * 1024)).toFixed(1);
          console.log(`🧹 Report PNG retention: deleted ${pngDeleted} files older than ${reportDays} days (~${mb} MB freed)`);
        }
      } catch {}
      // ไฟล์ที่หมดอายุใน public_files — /pub/fil ตอบ 410 ให้แล้วก็จริง แต่ไบต์ยังนอนอยู่บน
      // ดิสก์ตลอดไป ซึ่งคือปัญหาเดียวกับที่งานชุดนี้ตั้งต้นมาแก้ (รูปของ rule ที่ลบไปแล้ว
      // ไม่เคยถูกกวาด) การเพิ่มโฟลเดอร์ใหม่ที่ไม่มีใครกวาดคือการสร้างปัญหาเดิมซ้ำ
      // แถวยังอยู่เพื่อ audit — ลบเฉพาะไบต์ แล้วประทับ revoked_at กันกวาดซ้ำ
      try {
        const { rows: expired } = await pool.query(
          `SELECT id, stored_name FROM public_files
            WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at < now()
              AND stored_name IS NOT NULL`);   // ลิงก์ภายนอก (migration 287) ไม่มีไฟล์ให้กวาด · ไม่ประทับ revoked_at = ยังต่ออายุได้
        let filesDeleted = 0, filesFreed = 0;
        for (const r of expired) {
          const full = path.join(FILES_DIR, r.stored_name);
          if (!full.startsWith(FILES_DIR)) continue;
          const st = await fs.promises.stat(full).catch(() => null);
          if (st) { filesFreed += st.size; await fs.promises.unlink(full).catch(() => {}); }
          // สำเนาเวอร์ชันเก่าจากการแทนที่ไฟล์ (migration 267) ไปพร้อมไฟล์หลัก
          const { rows: vers } = await pool.query('SELECT stored_name FROM public_file_versions WHERE file_id = $1', [r.id]);
          for (const v of vers) await fs.promises.unlink(path.join(FILES_DIR, v.stored_name)).catch(() => {});
          await pool.query(`UPDATE public_files SET revoked_at = now() WHERE id = $1`, [r.id]);
          filesDeleted++;
        }
        if (filesDeleted > 0) {
          console.log(`🧹 Public files: ลบ ${filesDeleted} ไฟล์ที่หมดอายุ ` +
            `(~${(filesFreed / (1024 * 1024)).toFixed(1)} MB)`);
        }
      } catch (e) { console.warn('🧹 public_files retention error:', e.message); }
      // สรุปรอบใหญ่หนึ่งบรรทัด — แต่ละตารางย่อยยังเงียบตอนไม่มีงานเหมือนเดิม
      // (มีสิบกว่าตาราง ถ้าให้รายงานทุกตัวจะได้ log รกวันละหลายสิบบรรทัดจนไม่มี
      // ใครอ่าน) สิ่งที่ต้องแยกออกให้ได้คือ "รอบนี้ได้รันไหม" ไม่ใช่ตารางไหนว่าง
      retentionBeat.beat('events', _totalEventsDeleted, `เก็บ ${days} วัน`);
    } catch (err) {
      retentionBeat.beatFail('events', err);
    }
  }
  // ── Boot schedule (staggered 2026-09-06) ────────────────────────────────────
  // Measured right after `pm2 restart api-server`: inside the first 60s the DB was
  // running the LPR warm loop (`_lpr_pp` temp tables 3s ×2, `plate_region` 6.5–8s),
  // the category/kpi/traffic rollup ticks, helmet criteria AND the first health
  // poll — all at once. Every page was slow for ~1 min after each deploy.
  // One job at a time now: helmet 3s · kpi 45s · cat-rollup 90s · traffic 135s ·
  // LPR warm 180s (each overridable via <PREFIX>_FIRST_RUN_MS), then the daily
  // retention sweeps below, 30s apart, only once the refreshers are done:
  //   events 300s · snapshot 330s · lpr 360s · clip 390s · rawXml 420s ·
  //   apiLog 450s · partition 480s
  // NOTE: file order below is not schedule order — partition (480s) is declared
  // above rawXml (420s). The 24h setInterval periods are unchanged throughout.
  // Run 300s after start, then once every 24h
  setTimeout(enforceRetention, 300 * 1000);
  setInterval(enforceRetention, 24 * 60 * 60 * 1000);

  async function enforceSnapshotRetention() {
    try {
      const _srv = await getSystemSetting(pool, 'snapshot_retention_days');
      const days = Math.min(365, Math.max(1, parseInt(_srv || '30', 10)));
      const cutoffMs = Date.now() - days * 86400 * 1000;
      let scanned = 0, deleted = 0, freedBytes = 0;
      // 🧊 ไซต์ปิดปรับปรุง — ข้ามไฟล์ของกล้องไซต์นั้น · อ่านไม่ได้ = โยน → catch → รอบนี้ไม่ลบอะไร
      // ชื่อโฟลเดอร์กล้องได้จาก safeCamDir ตัวเดียวกับตอนเขียน (snapshot-path.js)
      // ไฟล์แบนที่ราก: ผู้เขียนปัจจุบันมีแค่ face-push (`${camId}_...`) → ข้ามตาม prefix
      // (prefix ชนกล้องอื่น = เก็บไฟล์เกิน ซึ่งเป็นทิศที่ปลอดภัย) · ไฟล์ legacy ชื่อแบบอื่นไม่รู้เจ้าของ ลบตามเดิม
      const { frozenCams } = await frozenScope(pool);
      const frozenDirs = new Set(frozenCams.map(safeCamDir));
      const frozenPrefixes = [...new Set([...frozenCams, ...frozenDirs])].map(c => c + '_');
      // Flat root files (legacy + non-LPR ingesters not yet migrated)
      const entries = await fs.promises.readdir(SNAPSHOT_DIR, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const lower = ent.name.toLowerCase();
        if (!lower.endsWith('.jpg') && !lower.endsWith('.jpeg') && !lower.endsWith('.png')) continue;
        if (frozenPrefixes.length && frozenPrefixes.some(p => ent.name.startsWith(p))) continue;
        scanned++;
        const full = path.join(SNAPSHOT_DIR, ent.name);
        try {
          const st = await fs.promises.stat(full);
          if (st.mtimeMs < cutoffMs) { freedBytes += st.size; await fs.promises.unlink(full); deleted++; }
        } catch {}
      }
      // Structured subdirs: events/ and face/ (same recursive logic as lpr-retention)
      for (const cat of ['events', 'face']) {
        const catDir = path.join(SNAPSHOT_DIR, cat);
        const dateDirs = await fs.promises.readdir(catDir, { withFileTypes: true }).catch(() => []);
        for (const dd of dateDirs) {
          if (!dd.isDirectory()) continue;
          const dateDir = path.join(catDir, dd.name);
          const camDirs = await fs.promises.readdir(dateDir, { withFileTypes: true }).catch(() => []);
          for (const cd of camDirs) {
            if (!cd.isDirectory()) continue;
            if (frozenDirs.has(cd.name)) continue;   // 🧊 กล้องของไซต์ปิดปรับปรุง
            const camDir = path.join(dateDir, cd.name);
            const slotDirs = await fs.promises.readdir(camDir, { withFileTypes: true }).catch(() => []);
            for (const sd of slotDirs) {
              if (!sd.isDirectory()) continue;
              const slotDir = path.join(camDir, sd.name);
              for (const f of await fs.promises.readdir(slotDir).catch(() => [])) {
                const full = path.join(slotDir, f);
                const st = await fs.promises.stat(full).catch(() => null);
                if (st && st.isFile() && st.mtimeMs < cutoffMs) {
                  freedBytes += st.size; await fs.promises.unlink(full).catch(() => {}); deleted++;
                }
              }
              const left = await fs.promises.readdir(slotDir).catch(() => ['_']);
              if (left.length === 0) await fs.promises.rmdir(slotDir).catch(() => {});
            }
            const left = await fs.promises.readdir(camDir).catch(() => ['_']);
            if (left.length === 0) await fs.promises.rmdir(camDir).catch(() => {});
          }
          const left = await fs.promises.readdir(dateDir).catch(() => ['_']);
          if (left.length === 0) await fs.promises.rmdir(dateDir).catch(() => {});
        }
      }
      if (deleted > 0) {
        const mb = (freedBytes / (1024 * 1024)).toFixed(1);
        console.log(`🧹 Snapshot retention: deleted ${deleted}/${scanned} flat + structured files older than ${days} days (~${mb} MB freed)`);
      }
      // Prune thumbnails by mtime — same cutoff as originals (works with both flat and subdir originals)
      try {
        for (const wdir of await fs.promises.readdir(THUMBS_DIR).catch(() => [])) {
          const wpath = path.join(THUMBS_DIR, wdir);
          for (const tf of await fs.promises.readdir(wpath).catch(() => [])) {
            const tfull = path.join(wpath, tf);
            const st = await fs.promises.stat(tfull).catch(() => null);
            if (st && st.mtimeMs < cutoffMs) await fs.promises.unlink(tfull).catch(() => {});
          }
        }
      } catch {}
      // migration 117 — prune the bbox-burned cache the same way (flat dir, no
      // width subfolder since there's only one variant per source file).
      try {
        for (const bf of await fs.promises.readdir(BBOX_CACHE_DIR).catch(() => [])) {
          const bfull = path.join(BBOX_CACHE_DIR, bf);
          const st = await fs.promises.stat(bfull).catch(() => null);
          if (st && st.mtimeMs < cutoffMs) await fs.promises.unlink(bfull).catch(() => {});
        }
      } catch {}
    } catch (err) {
      console.warn('🧹 Snapshot retention error:', err.message);
    }
  }
  setTimeout(enforceSnapshotRetention, 330 * 1000);
  setInterval(enforceSnapshotRetention, 24 * 60 * 60 * 1000);

  // 🧹 RF4 — LPR retention: prune anprAlarm rows (lpr_retention_days, def 30) +
  // snapshots/lpr/ images (lpr_image_retention_days, def 7). Own try/catch so a
  // failure can't abort the other retention passes. (general enforceSnapshotRetention
  // skips subdirs → snapshots/lpr/ would otherwise never be pruned.)
  const { enforceLprRetention } = require('../lpr-retention');
  async function _runLprRetention() {
    try {
      const metaDays  = await getSystemSetting(pool, 'lpr_retention_days');
      const imageDays = await getSystemSetting(pool, 'lpr_image_retention_days');
      const r = await enforceLprRetention({ pool, snapshotDir: SNAPSHOT_DIR, metaDays, imageDays, batch: _RETENTION_BATCH });
      if (r.rowsDeleted > 0)  console.log(`🧹 LPR retention: deleted ${r.rowsDeleted} anprAlarm rows older than ${r.metaDays} days`);
      if (r.filesDeleted > 0 || r.dirsRemoved > 0)
        console.log(`🧹 LPR retention: deleted ${r.filesDeleted} image files + ${r.dirsRemoved} whole expired date-dir(s) older than ${r.imageDays} days (~${(r.bytesFreed/1048576).toFixed(1)} MB freed from per-file path)`);
    } catch (err) {
      console.warn('🧹 LPR retention error:', err.message);
    }
  }
  setTimeout(_runLprRetention, 360 * 1000);
  setInterval(_runLprRetention, 24 * 60 * 60 * 1000);

  // 🎬 Phase 6.1.2 — Clip retention (delete old MP4 from media/ by mtime)
  // 🧊 ไม่กรองไซต์ปิดปรับปรุงโดยตั้งใจ: clip บน central อัดโดย media-recorder.js เท่านั้น ซึ่งเลือกเฉพาะกล้อง
  // site_id NULL หรือไซต์ 'main' (และเป็นที่เดียวที่เขียน events.clip_file) · 'main' เปลี่ยนสถานะไม่ได้
  // (PUT /api/sites/:id/status ปฏิเสธ) ⇒ ไซต์ edge ที่แช่แข็งไม่มี clip บน central ให้ลบหรือเคลียร์
  // ถ้าวันหนึ่ง recorder อัดกล้องของไซต์อื่น ต้องกลับมาข้าม clip ของกล้องแช่แข็งที่นี่
  async function enforceClipRetention() {
    try {
      const _crv = await getSystemSetting(pool, 'clip_retention_days');
      const days = Math.min(90, Math.max(1, parseInt(_crv || '30', 10)));
      const cutoffMs = Date.now() - days * 86400 * 1000;
      let scanned = 0, deleted = 0, freedBytes = 0;
      const entries = await fs.promises.readdir(MEDIA_DIR, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const lower = ent.name.toLowerCase();
        if (!lower.endsWith('.mp4') && !lower.endsWith('.webm')) continue;
        scanned++;
        const full = path.join(MEDIA_DIR, ent.name);
        try {
          const st = await fs.promises.stat(full);
          if (st.mtimeMs < cutoffMs) {
            freedBytes += st.size;
            await fs.promises.unlink(full);
            deleted++;
          }
        } catch {}
      }
      if (deleted > 0) {
        const mb = (freedBytes / (1024 * 1024)).toFixed(1);
        console.log(`🎬 Clip retention: deleted ${deleted}/${scanned} files older than ${days} days (~${mb} MB freed)`);
      }

      // The loop above only touches disk — without this, events.clip_file /
      // clip_status keep pointing at a file that no longer exists forever,
      // so anything reading from the DB (not the filesystem) never notices
      // the clip is gone. Clear the reference for any event past the same
      // cutoff, regardless of whether its file still exists.
      const cutoffIso = new Date(cutoffMs).toISOString();
      let cleared = 0, n;
      do {
        const ids = await pool.query(
          `SELECT id FROM events WHERE event_time < $1 AND clip_file IS NOT NULL
             ORDER BY event_time LIMIT $2`,
          [cutoffIso, _RETENTION_BATCH]);
        n = ids.rowCount;
        if (n === 0) break;
        const arr = ids.rows.map(r => r.id);
        const upd = await pool.query(
          `UPDATE events SET clip_file = NULL, clip_status = NULL WHERE id = ANY($1::bigint[])`, [arr]);
        cleared += upd.rowCount;
        if (n === _RETENTION_BATCH) await new Promise(r => setTimeout(r, 100));
      } while (n === _RETENTION_BATCH);
      if (cleared > 0) console.log(`🎬 Clip retention: cleared ${cleared} stale clip_file reference(s) in DB`);
    } catch (err) {
      console.warn('🎬 Clip retention error:', err.message);
    }
  }
  setTimeout(enforceClipRetention, 390 * 1000);
  setInterval(enforceClipRetention, 24 * 60 * 60 * 1000);

  // 🧹 Class-D retention — strip the raw Hik ANPR XML slice from OLD events while
  // keeping the row + parsed columns. rawXml is ~90% of the events table but is
  // debug/re-parse-only; the used field (seatbelt) is a column since migration 073,
  // so the filter/modal don't need it long-term. The time window is a safety net:
  // a newly-enabled camera analytic has `rawxml_retention_days` to be noticed and
  // columnised before its data ages out. Only reader is the modal remark, which
  // degrades gracefully (no remark on stripped rows — >window old = no image anyway).
  // KEEP-SET, re-measured 2026-07-31 (the older note here overstated the risk):
  // plateType is at the top level of raw_json (45,196/45,196 rows checked) and
  // tailandStateID becomes license_plates.region at ingest — both survive expiry.
  // plateCharBelieve and licenseBright were the only genuinely rawXml-only fields
  // and are columns as of migration 108, so nothing is lost on expiry any more.
  // Note the space case is small either way: Hikvision ANPR is 5.9% of the stored
  // bytes, so stripping all of its rawXml is worth ~3.9% of the events table. The
  // 90% is Dahua's raw_json.data (see pruneDahuaData in dahua-protocol.js).
  async function enforceRawXmlRetention() {
    try {
      const _rrv = await getSystemSetting(pool, 'rawxml_retention_days');
      const days = Math.min(365, Math.max(7, parseInt(_rrv || '90', 10)));  // default 90, clamp 7..365
      const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
      let total = 0, n;
      // ponytail: `- 'rawXml'` rewrites the whole row (MVCC dead tuple). Fine now;
      // at ~333k/day aging past cutoff, add a partial index
      //   ON events(event_time) WHERE raw_json ? 'rawXml'  (shrinks as rows strip).
      // 🧊 การตัด rawXml คือการเขียนทับแถว — ไซต์ปิดปรับปรุงห้ามถูกแก้ด้วย · อ่านไม่ได้ = โยน → ไม่แตะอะไร
      // มีไซต์แช่แข็ง → รายกล้องเฉพาะกล้องที่ยังเปิด + แถว camera_id NULL (เหตุผลเดียวกับ enforceRetention)
      const { frozenCams, liveCams } = await frozenScope(pool);
      if (frozenCams.length) {
        total = await eachCameraBatch(liveCams, {
          batch: _RETENTION_BATCH,
          select: async (cam) => {
            const [w, p] = camClause(cam, [cutoff, _RETENTION_BATCH]);
            const r = await pool.query(
              `SELECT id FROM events WHERE ${w} AND event_time < $1 AND raw_json ? 'rawXml'
                 ORDER BY event_time LIMIT $2`, p);
            return r.rows.map(x => x.id);
          },
          apply: async (arr) => (await pool.query(
            `UPDATE events SET raw_json = raw_json - 'rawXml' WHERE id = ANY($1::bigint[])`, [arr])).rowCount,
        });
      } else do {
        const ids = await pool.query(
          `SELECT id FROM events WHERE event_time < $1 AND raw_json ? 'rawXml'
             ORDER BY event_time LIMIT $2`,
          [cutoff, _RETENTION_BATCH]);
        n = ids.rowCount;
        if (n === 0) break;
        const arr = ids.rows.map(r => r.id);
        const upd = await pool.query(
          `UPDATE events SET raw_json = raw_json - 'rawXml' WHERE id = ANY($1::bigint[])`, [arr]);
        total += upd.rowCount;
        if (n === _RETENTION_BATCH) await new Promise(r => setTimeout(r, 100));
      } while (n === _RETENTION_BATCH);
      // เต้นทุกครั้งแม้ total = 0 — ไม่งั้น "รันแล้วไม่มีงาน" กับ "ไม่เคยรัน" เงียบเหมือนกัน
      retentionBeat.beat('rawXml', total, `เก่ากว่า ${days} วัน`);
    } catch (err) {
      retentionBeat.beatFail('rawXml', err);
    }
  }
  // 🗄️ Phase 5 — partition lifecycle. Reports what it WOULD drop until
  // system_settings.partition_drop_enabled is 'true'; see helpers/
  // partitionRetention.js for why dropping is opt-in and why the row-DELETE in
  // enforceRetention above cannot simply be replaced by it today.
  const { enforcePartitionRetention } = require('../helpers/partitionRetention');
  setTimeout(() => enforcePartitionRetention(pool), 480 * 1000);
  setInterval(() => enforcePartitionRetention(pool), 24 * 60 * 60 * 1000);

  setTimeout(enforceRawXmlRetention, 420 * 1000);
  setInterval(enforceRawXmlRetention, 24 * 60 * 60 * 1000);

  // 🔑 TP2 — partner API request log. One row per /v1 call, including the
  // rejected ones, which are the rows worth keeping: "who tried what and was
  // turned away" is the audit trail. Deleted oldest-first in batches like the
  // passes above, so a first run against a large backlog does not hold one long
  // transaction.
  async function enforceApiLogRetention() {
    try {
      const _v = await getSystemSetting(pool, 'api_log_retention_days');
      const days = Math.min(365, Math.max(7, parseInt(_v || '90', 10)));
      const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
      let total = 0, n;
      do {
        // DELETE ... WHERE id IN (SELECT ... LIMIT) rather than a plain
        // `WHERE at < cutoff`: the same batching every other pass here uses, and
        // the reason is the same — one statement deleting millions of rows locks
        // and bloats where a hundred small ones do not.
        const del = await pool.query(
          `DELETE FROM api_request_log WHERE id IN (
             SELECT id FROM api_request_log WHERE at < $1 ORDER BY at LIMIT $2)`,
          [cutoff, _RETENTION_BATCH]);
        n = del.rowCount;
        total += n;
        if (n === _RETENTION_BATCH) await new Promise(r => setTimeout(r, 100));
      } while (n === _RETENTION_BATCH);
      retentionBeat.beat('api_log', total, `เก่ากว่า ${days} วัน`);
    } catch (err) {
      retentionBeat.beatFail('api_log', err);
    }
  }
  setTimeout(enforceApiLogRetention, 450 * 1000);
  setInterval(enforceApiLogRetention, 24 * 60 * 60 * 1000);
};
