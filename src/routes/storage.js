// ============================================================
// Vigil Platform — Storage Routes
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// อ่านอย่างเดียวโดยตั้งใจ (2026-08-24) — ไม่มีปุ่มลบในเฟสนี้ เพราะไม่ควรมีปุ่มลบ
// ก่อนที่คนจะเห็นว่าตัวเองกำลังจะลบอะไร การลบด้วยมืออยู่เฟสถัดไป
//
// ตัวเลขถูกเก็บไว้ในตาราง ไม่ได้คำนวณตอนเปิดหน้า เพราะเดินทรีของ hkt ใช้เวลา
// เกิน 100 วินาที (`du` timeout ตอนสำรวจ 2026-08-24) หน้าจอจึงอ่านค่าที่วัดไว้
// แล้วบอกตรง ๆ ว่าวัดเมื่อไหร่
'use strict';


const { scanAll, getDiskUsage, countEventOrphans } = require('../helpers/storageScan');
const { getSystemSetting } = require('../helpers/getSystemSetting');
const { spoolStats, clipsStats } = require('../helpers/storageStats');
const { snapshotMount, systemMount } = require('../helpers/storageHealth');
const storagePurge  = require('../helpers/storagePurge');
const purgeRegistry = require('../helpers/purgeRegistry');
const { frozenScope } = require('../helpers/retentionScope');
const { safeCamDir }  = require('../snapshot-path');
const emqxPublish   = require('../helpers/emqxPublish');
const crypto        = require('crypto');

const SCAN_BUDGET_MS = 120000;

module.exports = function storageRoutes(app, pool, { SNAPSHOT_DIR, REPORTS_DIR, PHOTO_DIR, FILES_DIR, MEDIA_DIR }) {
  // กันรอบซ้อน — ทั้งปุ่ม "วัดใหม่" และรอบอัตโนมัติเคารพธงเดียวกัน ไม่ใช่แยกกันคุม
  let _scanRunning = false;

  const RETENTION_KEYS = [
    'snapshot_retention_days',
    'lpr_image_retention_days',
    'report_retention_days',
    'signed_image_expire_hours',
    'lpr_line_image_expire_hours',
  ];
  // คีย์ที่หน้าจอแก้ได้ — ทุกตัวใน RETENTION_KEYS แก้ได้แล้วหลัง migration 177
  // (report_retention_days เคยเป็นเลขตายตัวในโค้ด จึงเคยต้องส่งธง fixed มาบอกหน้าจอ)

  // เดิมโค้ดสแกน+บันทึกถูกก๊อปไว้ 3 ที่ (ปุ่ม / รอบแรกหลัง boot / รอบรายวัน)
  // ตรรกะเดียวกันอยู่สามที่คือของที่เลื่อนออกจากกันได้เงียบ ๆ จึงรวมเป็นตัวเดียว
  async function runScan(reason) {
    if (_scanRunning) return { skipped: 'scan already running' };
    _scanRunning = true;
    const t0 = Date.now();
    try {
      const results = await scanAll({ budgetMs: SCAN_BUDGET_MS, SNAPSHOT_DIR, REPORTS_DIR, PHOTO_DIR, FILES_DIR });
      const disk = await getDiskUsage(SNAPSHOT_DIR);
      for (const r of results) {
        await pool.query(
          `INSERT INTO storage_stats
             (machine, category, bytes, bytes_disk, files, oldest_at, partial, disk_total, disk_used, scan_ms, measured_at)
           VALUES ('central',$1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (machine, category) DO UPDATE SET
             bytes = $2, bytes_disk = $3, files = $4, oldest_at = $5, partial = $6,
             disk_total = $7, disk_used = $8, scan_ms = $9, measured_at = NOW()`,
          [r.category, r.bytes, r.bytesDisk, r.files,
           r.oldestMs ? new Date(r.oldestMs) : null, r.partial,
           disk.total_bytes, disk.used_bytes, r.scanMs]
        );
      }
      // นับ orphan แยกขาเพราะแพงกว่ารอบวัดขนาด ~50 เท่า (42s เทียบ 825ms) รอบวัดขนาด
      // ต้องได้ตัวเลขลง DB ก่อน ไม่ให้การนับ orphan ที่ล้มลากรอบวัดขนาดตกไปด้วย
      try {
        const o = await countEventOrphans(pool, SNAPSHOT_DIR);
        await pool.query(
          `UPDATE storage_stats SET orphans=$1, orphans_bytes_disk=$2, orphans_at=NOW()
             WHERE machine='central' AND category='events'`,
          [o.orphans, o.orphanBytesDisk]
        );
        console.log(`💾 orphan (events): ${o.orphans} จาก ${o.checked} ไฟล์ ใช้เวลา ${Math.round(o.scanMs / 1000)}s`);
      } catch (e) {
        console.error('💾 นับ orphan ไม่สำเร็จ:', e.message);
      }
      const elapsed = Date.now() - t0;
      console.log(`💾 storage scan (${reason}): ${results.length} หมวด ใช้เวลา ${Math.round(elapsed / 1000)}s` +
                  (results.some(r => r.partial) ? ' · มีหมวดที่วัดไม่จบ (partial)' : ''));
      return { results, elapsedMs: elapsed };
    } catch (e) {
      console.error(`💾 storage scan (${reason}) ล้มเหลว:`, e.message);
      return { error: e.message };
    } finally {
      _scanRunning = false;
    }
  }

  // ตรวจว่าชื่อเครื่องที่ขอมามีอยู่จริง — ไม่ยิงคำสั่งไปยัง topic ที่ผู้ใช้พิมพ์มาเอง
  async function resolveMachine(machine) {
    if (!machine || machine === 'central') return { central: true };
    const { rows } = await pool.query('SELECT code FROM sites WHERE code = $1', [String(machine)]);
    if (!rows.length) return { error: 'ไม่รู้จักเครื่องนี้' };
    return { siteCode: rows[0].code };
  }

  // GET /api/storage — อ่านค่าที่วัดไว้ ไม่วัดสด
  app.get('/api/storage', async (req, res) => {
    // unscoped: สถิติพื้นที่จัดเก็บของทั้งระบบ ไม่ใช่ข้อมูลเหตุการณ์รายไซต์
    try {
      const { rows } = await pool.query(
        `SELECT machine, category, bytes, bytes_disk, files, oldest_at, partial,
                orphans, orphans_bytes_disk, orphans_at,
                disk_total, disk_used, scan_ms, measured_at
           FROM storage_stats ORDER BY machine, category`
      );
      const retention = {};
      for (const k of RETENTION_KEYS) retention[k] = await getSystemSetting(pool, k);

      // EM6 — Build machines[] from edge_status, union with storage_stats machines
      // so NRW (heartbeating but never scanned) still shows a pill.
      // central is built locally; edges are from edge_status.
      const machines = [];

      // Central — reuse cached stats from health.js to avoid duplicate walks
      const st = await require('../helpers/storageHealth').sampleStorage(SNAPSHOT_DIR);
      const storageHealth = rows.find(r => r.machine === 'central' && r.category === 'events');

      // Spool and clips stats — use shared cached helpers (same as health.js)
      // MEDIA_DIR (= <root>/media, api-server.js:1170) ไม่ใช่ media-buffer ซึ่งเป็น
      // ring buffer ดิบของ recorder คนละกองกัน · ต้องเป็น dir เดียวกับที่ health.js
      // ใช้ ไม่งั้นเลข "คลิป" ของสองหน้าจะไม่ตรงกัน
      const spoolData = await spoolStats(SNAPSHOT_DIR);
      const clipsData = await clipsStats(MEDIA_DIR);

      // Clips DB stats (events with clips, not file counts)
      let clipsToday = 0, clipsOldestAt = null;
      try {
        const r = await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE event_time > NOW() - INTERVAL '24 hours') AS today,
            MIN(event_time) AS oldest
            FROM events WHERE clip_file IS NOT NULL AND clip_status = 'done'`);
        if (r.rows[0]) {
          clipsToday = parseInt(r.rows[0].today, 10) || 0;
          clipsOldestAt = r.rows[0].oldest ? new Date(r.rows[0].oldest).toISOString() : null;
        }
      } catch {}

      // ดิสก์ที่พาดหัว = ดิสก์ที่ภาพลงจริง ไม่ใช่ดิสก์ระบบ (ดู storageHealth.snapshotMount)
      const snapMnt = snapshotMount(st);
      machines.push({
        code: 'central',
        is_central: true,
        last_seen_at: new Date().toISOString(),
        stale: false,
        // ห้าม round — แถบดิสก์เดิมแสดง "337.57 GB" ผ่าน formatBytes()
        disk_free_gb: snapMnt ? snapMnt.free_gb : null,
        disk_total_gb: snapMnt ? snapMnt.total_gb : null,
        disk_role: snapMnt ? snapMnt.role : null,
        disk_path: snapMnt ? snapMnt.mount : null,
        snapshot_dedicated: st?.snapshot_dedicated ?? null,
        mounts: st?.mounts || [],
        snapshot_oldest: storageHealth?.oldest_at || null,
        snapshot_dirs: null,  // Central has no date-dir count; use null rather than file count
        storage_health: st,
        spool_files: spoolData.spool_files,
        spool_mb: spoolData.spool_mb,
        clips_files: clipsData.clips_files,
        clips_mb: clipsData.clips_mb,
        clips_today: clipsToday,
        clips_oldest_at: clipsOldestAt,
      });

      // Edges + union with storage_stats
      const EDGE_STALE_SEC = parseInt(process.env.EDGE_HEARTBEAT_STALE_SEC || '180', 10);
      const edgeRows = await pool.query(`
        SELECT site_id, last_seen_at, disk_free_gb, disk_total_gb,
               snapshot_oldest, snapshot_dirs, storage_json, inventory_json,
               extract(epoch from (now() - last_seen_at)) AS stale_sec
        FROM edge_status
        ORDER BY site_id
      `);

      const storageMachines = new Set(rows.map(r => r.machine).filter(m => m !== 'central'));
      const edgeProcessed = new Set();

      for (const r of edgeRows.rows) {
        edgeProcessed.add(r.site_id);
        const inv = r.inventory_json || {};
        const dates = new Set();
        let oldest = null;
        for (const f of Object.values(inv)) {
          ((f && f.dates) || []).forEach(d => dates.add(d));
          if (f && f.oldest && (!oldest || f.oldest < oldest)) oldest = f.oldest;
        }
        // edge_status.disk_* คือ `df /` เสมอ (bridge.js:361 ฮาร์ดโค้ดไว้) ซึ่งเป็นดิสก์
        // ระบบ · ไซต์ที่แขวน snapshot ไว้คนละดิสก์ (hkt) ต้องพาดหัวด้วยดิสก์ที่เก็บภาพ
        // ไม่งั้นหน้าที่มีหน้าที่ตอบ "จะเต็มไหม" จะรายงานดิสก์ที่ไม่มีอะไรเขียนลงไป
        const sMnt = snapshotMount(r.storage_json);
        machines.push({
          code: r.site_id,
          is_central: false,
          last_seen_at: r.last_seen_at,
          stale: r.stale_sec > EDGE_STALE_SEC,
          disk_free_gb: sMnt ? sMnt.free_gb : r.disk_free_gb,
          disk_total_gb: sMnt ? sMnt.total_gb : r.disk_total_gb,
          disk_role: sMnt ? sMnt.role : null,
          disk_path: sMnt ? sMnt.mount : null,
          snapshot_dedicated: r.storage_json?.snapshot_dedicated ?? null,
          mounts: r.storage_json?.mounts || [],
          snapshot_oldest: oldest || r.snapshot_oldest,
          snapshot_dirs: dates.size || r.snapshot_dirs,
          storage_health: r.storage_json || null,
        });
      }

      // Union with storage_stats machines (decommissioned edges with historical data)
      for (const machine of storageMachines) {
        if (!edgeProcessed.has(machine)) {
          machines.push({
            code: machine,
            is_central: false,
            last_seen_at: null,
            stale: true,
            disk_free_gb: null,
            disk_total_gb: null,
            disk_role: null,
            disk_path: null,
            snapshot_dedicated: null,
            mounts: [],
            snapshot_oldest: null,
            snapshot_dirs: null,
            storage_health: null,
          });
        }
      }

      res.json({ stats: rows, retention, scanning: _scanRunning, machines });
    } catch (e) {
      console.error('[storage] GET /api/storage ล้มเหลว:', e.message);
      res.status(500).json({ error: 'อ่านสถิติพื้นที่จัดเก็บไม่สำเร็จ' });
    }
  });

  // POST /api/storage/scan — admin เท่านั้น (requireAdminForWrites ครอบไว้ที่ api-server)
  // ตอบทันทีแล้วให้สแกนวิ่งเบื้องหลัง เพราะรอบเต็มกินเวลาเป็นนาที
  app.post('/api/storage/scan', async (req, res) => {
    const m = await resolveMachine(req.body && req.body.machine);
    if (m.error) return res.status(400).json({ error: m.error });
    if (m.siteCode) {
      // edge วัดเอง แล้วส่งผลกลับมาทาง _config/storage-scan-result → mqtt-subscriber
      // ไม่ต้องมี secret เพราะเป็นคำสั่งอ่านอย่างเดียว ไม่เปลี่ยนอะไรบนเครื่องปลายทาง
      await emqxPublish(`projects/${m.siteCode}/_config/storage-scan`, { at: Date.now() });
      return res.json({ started: true, machine: m.siteCode, note: 'edge วัดเองแล้วส่งผลกลับ — กด refresh อีกครั้งในราว 1-2 นาที' });
    }
    if (_scanRunning) return res.status(409).json({ error: 'มีรอบสแกนกำลังทำงานอยู่' });
    res.json({ started: true, machine: 'central' });
    runScan('manual');
  });


  // ── ลบตามอายุ ─────────────────────────────────────────────
  // ตรรกะจริงอยู่ใน helpers/storagePurge.js ตัวเดียว ใช้ร่วมกับ edge-config-agent
  // งานทำลายไม่ควรมีสองสำเนา ถ้าแยกกันเขียน กติกาความปลอดภัยจะเลื่อนออกจากกันเงียบ ๆ
  //
  // 🔴 ยังไม่เปิดให้ลบ orphan โดยตั้งใจ: ช่วง 10 วันมี event 256,307 แถว (2.5%) ที่
  // snapshot_filename เป็น NULL — เหตุการณ์เกิดจริงแต่ไม่ได้บันทึกชื่อไฟล์ ไฟล์ของมัน
  // หน้าตาเหมือนไม่มีเจ้าของทั้งที่เป็นหลักฐาน ต้องมีด่านสองเทียบกล้อง+เวลาก่อน
  app.post('/api/storage/purge', async (req, res) => {
    try {
      const category = String(req.body.category || '');
      const days = parseInt(req.body.days, 10);
      const dryRun = req.body.dryRun !== false;   // ต้องส่ง false มาชัด ๆ ถึงจะลบจริง

      const m = await resolveMachine(req.body.machine);
      if (m.error) return res.status(400).json({ error: m.error });
      // 🧊 ไซต์ปิดปรับปรุง = ห้ามล้างข้อมูล · อ่านสถานะไม่ได้ = โยน → 500 ไม่ลบอะไร (fail closed)
      const frozen = await frozenScope(pool);
      if (m.siteCode && frozen.frozenSiteCodes.includes(m.siteCode)) {
        return res.status(409).json({ error: 'ไซต์นี้ปิดปรับปรุงอยู่ — ห้ามล้างข้อมูล' });
      }
      // central: ลบไฟล์ภาพเท่านั้น (ไม่มีการลบแถว DB ที่นี่) → ข้ามโฟลเดอร์กล้องของไซต์ปิดปรับปรุงตั้งแต่ขั้นวางแผน
      const skipCamDirs = frozen.frozenCams.length ? new Set(frozen.frozenCams.map(safeCamDir)) : undefined;
      if (m.siteCode) {
        // คำสั่งทำลายข้ามเครือข่าย — ตรวจหมวด/วันที่ฝั่งนี้ก่อนด้วย ไม่พึ่ง edge อย่างเดียว
        // (defence in depth: edge ตรวจซ้ำอีกชั้นด้วย helper ตัวเดียวกัน)
        if (!storagePurge.isPurgeable(category)) return res.status(400).json({ error: 'หมวดนี้ลบด้วยมือไม่ได้' });
        if (!Number.isFinite(days) || days < 1 || days > 3650) return res.status(400).json({ error: 'days ต้องอยู่ระหว่าง 1 ถึง 3650' });
        const reqId = crypto.randomUUID();
        purgeRegistry.register(reqId);
        await emqxPublish(`projects/${m.siteCode}/_config/storage-purge`, {
          reqId, category, days, dryRun,
          confirmFiles: dryRun ? undefined : Number(req.body.confirmFiles),
          secret: process.env.CAMERA_SECRET_KEY,
        });
        return res.json({ queued: true, reqId, machine: m.siteCode });
      }

      if (dryRun) {
        const plan = await storagePurge.planPurge(SNAPSHOT_DIR, category, days, skipCamDirs);
        if (plan.rejected) return res.status(400).json({ error: plan.rejected });
        return res.json({ dryRun: true, files: plan.files, bytesDisk: plan.bytesDisk, sample: plan.sample });
      }

      const r = await storagePurge.executePurge(SNAPSHOT_DIR, category, days, req.body.confirmFiles, skipCamDirs);
      if (r.rejected === 'confirm mismatch') {
        return res.status(409).json({ error: 'จำนวนไฟล์เปลี่ยนไปจากตอน dry-run กรุณาตรวจใหม่', expected: r.expected, actual: r.actual });
      }
      if (r.rejected) return res.status(400).json({ error: r.rejected });
      console.warn(`💾 storage purge: ${category} เก่ากว่า ${days} วัน — ลบ ${r.deleted}/${r.files} ไฟล์ คืน ${Math.round(r.bytesDisk / 1048576)} MB`);
      res.json({ dryRun: false, files: r.files, deleted: r.deleted, bytesDisk: r.bytesDisk });
    } catch (e) {
      console.error('[storage] purge ล้มเหลว:', e.message);
      res.status(500).json({ error: 'ลบไม่สำเร็จ: ' + e.message });
    }
  });

  // GET /api/storage/purge/:reqId — อ่านผลคำสั่งลบบน edge
  // อ่านแล้วทิ้ง (take) เพราะผลของคำสั่งทำลายใช้ได้ครั้งเดียว กันคนถือ reqId เดิม
  // มายืนยันซ้ำจากตัวเลขที่อ่านไปแล้ว
  app.get('/api/storage/purge/:reqId', (req, res) => {
    const e = purgeRegistry.get(String(req.params.reqId));
    if (!e) return res.status(404).json({ error: 'ไม่พบคำสั่งนี้ หรือหมดอายุแล้ว' });
    if (e.status === 'pending') return res.json({ status: 'pending' });
    const done = purgeRegistry.take(String(req.params.reqId));
    res.json({ status: done.status, ...(done.data || {}), error: done.error || null });
  });

  // ไม่สแกนทันทีตอน boot — api-server restart บ่อย ยิงทุก boot จะกลายเป็นสแกนรัวโดยไม่ตั้งใจ
  setTimeout(() => runScan('boot'), 15 * 60 * 1000).unref?.();
  setInterval(() => runScan('daily'), 24 * 60 * 60 * 1000).unref?.();
};
