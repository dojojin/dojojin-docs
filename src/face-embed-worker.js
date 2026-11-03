// ============================================================
// Vigil Platform — Face Embedding Worker (Phase 1, AuraFace-v1)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ⚠️ (Internal Test Only) — AuraFace-v1's detection component ยืนยันแล้วว่า
// MD5 ตรงกับ InsightFace antelopev2 เป๊ะ (non-commercial) ดู
// docs/REF_face-recognition.md §14-15 ก่อนพิจารณาใช้งานจริง
//
// ดึงคิวจาก face_embed_queue (enqueue โดย ingester ตอนสร้าง events แถวใหม่ —
// ไม่ embed สด ๆ ใน hot path ของ ingest ตามคำแนะนำ audit: 350-500 event/นาที
// ห้ามมีอะไรมาหน่วง) เรียก edge ผ่าน /face-engine-embed (ตัวเดียวกับที่ FR-P4
// ใช้ค้นหา) เก็บผลใน face_embeddings แล้วเทียบกับ face_blacklist แบบ brute-force
// dot product (normed_embedding ยาว 1 หน่วยอยู่แล้ว = cosine ตรงๆ ไม่ต้องหารขนาด)
//
// ถ้าคล้ายเกิน threshold → pg_notify('alert_event', ...) ซ้ำ ให้ alert-engine.js
// ที่ alert-worker.js ฟังอยู่แล้วมาประมวลผลเอง (ใช้ matchRule/cooldown/ส่ง LINE
// ของเดิมทั้งหมด ไม่เขียนโค้ดแจ้งเตือนใหม่) — rule_name แยกจาก HCP
// ('AuraFace Blacklist Match' ไม่ใช่ 'Face Recognition Match') กัน alert rule
// สองระบบชนกัน · alert_rule ที่จะ match ได้ถูกสร้างไว้แบบ enabled=false เสมอ
// (migration 130) เปิดเองทีหลังเป็นการตัดสินใจแยกต่างหาก
//
// Threshold calibrated 2026-08-10 จากคู่ภาพจริงที่เจ้าของยืนยันเอง 39 คู่
// (11 คนเดียวกัน / 28 คนละคน) — คนเดียวกันคะแนน 0.465-0.821, คนละคนคะแนน
// 0.445-0.512 ⇒ มี overlap จริงในช่วง 0.465-0.512 ไม่มีเกณฑ์เดียวแยกถูก 100%
// · 0.52 คือจุดที่ false positive = 0/28 ในชุดที่ทดสอบ จับคู่ถูกได้ 9/11 (82%)
//
// ค่าที่ใช้จริงตอนนี้ตั้งเป็น **60%** ตามคำสั่งเจ้าของ (2026-08-10, สูงกว่าจุด
// calibrate ตั้งใจให้ conservative ขึ้น) ปรับได้จากแท็บ Lab Test โดยไม่ต้อง
// restart — เก็บใน system_settings.auraface_match_threshold (migration 135),
// getSystemSetting() cache 60s/process ดู _getThreshold() ด้านล่าง
// ============================================================
'use strict';

require('dotenv').config({ quiet: true });
const env = require('./config');
require('./singleton')('face-embed-worker');

const { Pool } = require('pg');
const { edgeCall } = require('./helpers/edgeCall');
const { getSystemSetting } = require('./helpers/getSystemSetting');

const MODEL          = 'auraface-v1';
const SITE           = 'hkt';
const POLL_MS        = 5000;
const BATCH          = 20;
const MAX_ATTEMPTS   = 3;
// Lab Test tab (Settings›AuraFace-v1) writes system_settings.auraface_match_threshold
// as an integer % — getSystemSetting caches it 60s/process so a UI change here
// takes up to a minute to reach this worker, not a restart. Falls back to the
// env var (0-1 float, legacy) then a hardcoded 60% if neither is set.
async function _getThreshold() {
  const pct = await getSystemSetting(pool, 'auraface_match_threshold');
  if (pct != null) return parseInt(pct, 10) / 100;
  return parseFloat(process.env.AURAFACE_MATCH_THRESHOLD || '0.60');
}

// connectionTimeoutMillis/query_timeout: without these a transient DB blip
// can leave pool.query() hanging forever instead of rejecting — reproduced
// 2026-08-10 (ECONNREFUSED logged once inside a tick(), then total silence
// for 14 minutes: the process stayed "online" per pm2, but the next
// pool.query() in tick() never resolved or rejected, so it never reached
// the per-row try/catch, the loop, or the setTimeout that reschedules
// tick() — the worker just stopped forever with nothing left to log).
const pool =   // 🔴 ไม่มี statement_timeout = query ค้างได้ไม่จำกัด · เจอจริง 2026-08-27:
  // query หนึ่งค้าง 34 ชั่วโมง ทำให้ autovacuum เก็บ dead tuple ไม่ได้ ตาราง events
  // บวมจนทั้งระบบช้า และหน้าสถิติว่างเปล่า · มีแค่ api-server ที่ตั้งค่านี้ไว้
  // เทียบ embedding กับ face_blacklist 1,696 แถวต่อใบ
new Pool({
  options: '-c statement_timeout=120000',
  ...env.db(),
  max: 3,
  application_name: 'face-embed-worker',
  connectionTimeoutMillis: 10000, query_timeout: 20000,
});
pool.on('error', (e) => console.error('[face-embed-worker] pool error:', e.message));

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ── โรสเตอร์ในหน่วยความจำ ────────────────────────────────────────────────
// วัดจาก pg_stat_statements ของจริง 2026-08-27 (9 ชั่วโมง): คิวรีนี้ถูกยิง
// 75,502 ครั้ง รวม 6,501 วินาที = อันดับ 2 ของทั้งระบบ (≈ 20% ของหนึ่งคอร์
// ตลอดเวลา) เพราะมันดึง **ทั้งโรสเตอร์พร้อม vector** ใหม่ทุกใบหน้าที่เข้ามา
//
// แต่โรสเตอร์แทบไม่เปลี่ยน: 1,696 แถว · 3.4 MB · แก้ไขล่าสุดเมื่อ 17 วันก่อน
// การถามซ้ำ 2.3 ครั้งต่อวินาทีจึงเป็นการจ่ายค่าเดิมซ้ำโดยไม่ได้อะไรใหม่
//
// TTL 60 วินาที = การเพิ่มคนเข้าโรสเตอร์มีผลช้าสุด 1 นาที ซึ่งรับได้เพราะการ
// เพิ่มเป็นงานที่คนกดเอง ไม่ใช่เหตุการณ์เรียลไทม์
// ponytail: TTL ล้วน ๆ พอสำหรับตอนนี้ · ถ้าวันหนึ่งต้องการให้มีผลทันที
// ค่อยเปลี่ยนเป็น LISTEN/NOTIFY ตอนโรสเตอร์ถูกแก้ ไม่ต้องรื้อตรงนี้
const ROSTER_TTL_MS = parseInt(process.env.FACE_ROSTER_TTL_MS || '60000', 10);
let _roster = { at: 0, rows: [], camSite: new Map() };
// migration 262 — โรสเตอร์/กลุ่มใบหน้าเปลี่ยน → ล้าง TTL ให้รอบถัดไปโหลดใหม่ทันที (เดิมรอสูงสุด 60 วินาที)
// ฟังไม่ได้/หลุด = ยังมี TTL เดิมรองรับ
require('./helpers/pgListen').listenForever({
  label: 'face-roster',
  channels: ['watchlist_changed'],
  onNotification: (msg) => { if (/^face_blacklist/.test(msg.payload)) _roster.at = 0; },
  makeClient: () => new (require('pg').Client)({ ...env.db() }),
});

async function loadRoster() {
  if (Date.now() - _roster.at < ROSTER_TTL_MS) return _roster.rows;
  const t0 = Date.now();
  // worker อาจขึ้นก่อน api-server รัน migration 261 (deploy ใหม่ / pm2 restart all) — คอลัมน์ g.site_id
  // ยังไม่มีแล้ว query ล้มทั้งก้อน = ไม่จับคู่ใบหน้าเลย · ถอยไปแบบเดิม (ทุกกลุ่ม = Global) จนคอลัมน์มา
  // (เหตุเดียวกับ _refreshLprWatch ใน api-server 2026-10-14)
  const q = (siteCol) => pool.query(
    `SELECT fb.id, fb.label, fb.embedding, fb.notify_line, g.notify_line AS group_notify_line,
            ${siteCol} AS group_site_id,
            fb.ref_image, fb.notes AS bl_notes, sr.photo_path,
            sr.name AS ref_name, sr.case_ref, sr.case_note, sr.updated_at AS ref_updated
       FROM face_blacklist fb
       LEFT JOIN face_blacklist_groups g ON g.id = fb.group_id
       LEFT JOIN blacklist.source_records sr ON sr.id::text = fb.enrolled_ref
      WHERE fb.site_id=$1 AND fb.active=true AND fb.model_name=$2`,
    [SITE, MODEL]);
  let rows;
  try { ({ rows } = await q('g.site_id')); }
  catch (e) {
    if (e.code !== '42703') throw e;   // undefined_column เท่านั้น
    console.warn('[face-embed-worker] ยังไม่มี face_blacklist_groups.site_id (migration 261) — ใช้แบบ Global ไปก่อน');
    ({ rows } = await q('NULL::int'));
  }
  // กลุ่มเฉพาะ Site (migration 261) จับคู่เฉพาะกล้องของ Site นั้น — โหลดแผนที่กล้อง→Site มาพร้อมโรสเตอร์
  // (170 แถว รอบเดียวกับ TTL) แทนการถามทีละ event
  const cams = await pool.query('SELECT id, site_id FROM cameras');
  _roster = { at: Date.now(), rows, camSite: new Map(cams.rows.map((c) => [c.id, c.site_id])) };
  // ให้เห็นว่ามันโหลดจริงและใช้เวลาเท่าไร — ถ้าวันหนึ่งโรสเตอร์โตจนช้า จะได้รู้
  // จากบรรทัดนี้ ไม่ใช่จากผู้ใช้บ่นว่าแจ้งเตือนช้า
  console.log(`[face-embed-worker] โหลดโรสเตอร์ ${rows.length} รายการ (${Date.now() - t0}ms) · TTL ${ROSTER_TTL_MS / 1000}s`);
  return rows;
}

async function checkBlacklist(embedding, cameraId) {
  const rows = await loadRoster();
  const camSite = _roster.camSite.get(cameraId) ?? null;
  let best = null;
  for (const r of rows) {
    if (r.group_site_id != null && r.group_site_id !== camSite) continue;   // กลุ่มของ Site อื่น
    const sim = dot(embedding, r.embedding);
    if (!best || sim > best.sim) {
      best = { id: r.id, label: r.label, sim, notifyLine: r.notify_line, groupNotifyLine: r.group_notify_line,
               refPath: r.photo_path || r.ref_image || null,
               // ข้อมูลโรสเตอร์สำหรับตารางบนการ์ด — ตัวประกอบการ์ดค้นเองไม่เจอ
               // เพราะมันค้นจาก raw_json ของ HCP ซึ่ง AuraFace ไม่มี
               refInfo: { ref_name: r.ref_name, case_ref: r.case_ref, case_note: r.case_note,
                          ref_updated: r.ref_updated, bl_notes: r.bl_notes } };
    }
  }
  return best;
}

async function notifyMatch(row, match) {
  const { rows } = await pool.query(
    `SELECT e.camera_id, e.snapshot_filename, e.likelihood, c.name AS camera_name, c.location_label
       FROM events e LEFT JOIN cameras c ON c.id = e.camera_id WHERE e.id = $1`,
    [row.event_id]);
  const e = rows[0];
  if (!e) return; // event ถูกลบไปแล้วระหว่างทาง (เช่น Phase 3 ในอนาคต) — ข้ามเงียบๆ
  // Group notify_line is a master switch (mirrors lpr_watchlist_groups.notify_line
  // — off by default, only ever flipped from the group panel): a group set to
  // off suppresses LINE even if the row's own toggle is on. No group = only the
  // row's own toggle matters. The hit is always recorded below regardless —
  // "we found this person" stays useful even for a muted group (e.g. testing).
  const shouldNotify = match.notifyLine && match.groupNotifyLine !== false;
  if (shouldNotify) {
    await pool.query(`SELECT pg_notify('alert_event', $1)`, [JSON.stringify({
      event_id: row.event_id, camera_id: e.camera_id, camera_name: e.camera_name || e.camera_id,
      location: e.location_label, rule_name: 'AuraFace Blacklist Match', list_type: 'blackList',
      event_time: row.event_time, snapshot_filename: e.snapshot_filename, likelihood: e.likelihood,
      person_name: match.label,
      // หัวเรื่องของการ์ด — ต้องบอกว่า "ระบบไหนเป็นคนเตือน" ไม่ใช่ชื่อกลุ่มในโรสเตอร์
      // ไม่งั้นการ์ดของ AuraFace จะหน้าตาเหมือนของ HCP จนแยกไม่ออก (เจ้าของสั่ง 2026-08-13)
      watchlist: 'LabTest Alarm',
      similarity_pct: (match.sim * 100).toFixed(1) + '%',
      // ภาพอ้างอิงสำหรับการ์ดแบบเทียบภาพ — ตัวประกอบการ์ดค้นเองไม่เจอ เพราะมันค้นจาก
      // raw_json ของ HCP ซึ่ง AuraFace ไม่มี (line-sender._faceAlertImages)
      ref_path: match.refPath || null,
      ref_info: match.refInfo || null,
    })]);
  }
  // Durable record for the (Internal Test Only) hits page — pg_notify above is
  // fire-and-forget for LINE and leaves nothing queryable afterward. Deliberately
  // its own table rather than events.raw_json: the Face Recognition feed
  // (faces.js) hard-filters event_type IN ('FaceRecognition','FaceDetector/
  // Comparison'), but our source events are 'FaceCapture' — widening that shared
  // filter would touch ~8 query sites used by production HCP matching for a
  // pipeline that's explicitly internal-test-only (owner decision, 2026-08-10).
  await pool.query(
    `INSERT INTO face_blacklist_hits (event_id, event_time, camera_id, camera_name, blacklist_id, label, similarity, snapshot_filename)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [row.event_id, row.event_time, e.camera_id, e.camera_name || e.camera_id, match.id, match.label, match.sim, e.snapshot_filename]);
  console.log(`[face-embed-worker] blacklist match: event=${row.event_id} label=${match.label} sim=${match.sim.toFixed(3)}`);
}

async function processOne(row) {
  const r = await edgeCall(SITE, '/face-engine-embed', { rel_path: row.rel_path }, 20000);

  // ok:false บน HTTP 200 = /embed ทำงานปกติแต่ตรวจไม่พบใบหน้าในภาพนั้นจริงๆ (เจอจริง
  // ตอนทดสอบ — ภาพจริงมีเคสแบบนี้ปกติ) เป็นผลลัพธ์ถาวร ไม่ใช่ error ชั่วคราว
  // ห้ามลองซ้ำ (เหมือน "misses" ใน build_index.py ของ pilot เดิม — บทเรียนเดียวกัน)
  if (r.code === 200 && r.body.ok === false) {
    await pool.query(
      `UPDATE face_embed_queue SET status='done', last_error=$1, processed_at=now() WHERE id=$2`,
      [r.body.error || 'no_face', row.id]);
    return;
  }

  if (r.code !== 200 || !r.body.ok) {
    const err = (r.body && r.body.error) || `http_${r.code}`;
    const attempts = row.attempts + 1;
    await pool.query(
      // ::text ทั้งสองจุดที่ใช้ $3 — ห้ามตัดออกข้างใดข้างหนึ่ง: `status` เป็น
      // varchar(20) ส่วน `$3='failed'` อนุมานเป็น text ⇒ Postgres ปฏิเสธทั้ง
      // statement ด้วย "inconsistent types deduced for parameter $3" (เจอจริง
      // 273 ครั้งใน error log ถึง 2026-09-04 = แถวที่ยิงไม่สำเร็จไม่เคยถูกนับ
      // attempts เลย จึงวนลองใหม่ไม่รู้จบ) · ยืนยันด้วย PREPARE ของจริง 2026-09-06:
      // cast แค่ในวงเล็บ CASE ยัง error เหมือนเดิม ต้อง cast ที่ `status=$3::text` ด้วย
      `UPDATE face_embed_queue SET attempts=$1, last_error=$2,
         status=$3::text, processed_at=CASE WHEN $3::text='failed' THEN now() ELSE processed_at END
       WHERE id=$4`,
      [attempts, err, attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', row.id]);
    return;
  }

  const embedding = r.body.embedding;
  await pool.query(
    `INSERT INTO face_embeddings (event_id, event_time, model_name, dim, embedding, camera_id)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (event_id, model_name) DO NOTHING`,
    [row.event_id, row.event_time, MODEL, r.body.dim, embedding, row.camera_id]);
  await pool.query(`UPDATE face_embed_queue SET status='done', processed_at=now() WHERE id=$1`, [row.id]);

  const match = await checkBlacklist(embedding, row.camera_id);
  if (match && match.sim >= await _getThreshold()) await notifyMatch(row, match);
}

async function tick() {
  let full = false;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM face_embed_queue WHERE status='pending' AND attempts < $1 ORDER BY id LIMIT $2`,
      [MAX_ATTEMPTS, BATCH]);
    full = rows.length === BATCH;
    for (const row of rows) {
      try { await processOne(row); }
      catch (e) { console.error(`[face-embed-worker] row ${row.id} error:`, e.message); }
    }
  } catch (e) {
    console.error('[face-embed-worker] tick error:', e.message);
  }
  // A full batch means the queue very likely still has more waiting — re-poll
  // right away instead of sitting out POLL_MS idle. Measured 2026-08-10: this
  // idle wait was ~25% of total wall-clock during backlog (batch of 20 takes
  // ~14.6s to process, then waits a flat 5s regardless of queue depth). An
  // empty or partial batch means the queue actually drained, so the normal
  // POLL_MS applies — this is a backoff, not a busy-loop.
  setTimeout(tick, full ? 50 : POLL_MS);
}

_getThreshold().then((t) => {
  console.log(`[face-embed-worker] เริ่มทำงาน · model=${MODEL} · poll ทุก ${POLL_MS}ms · threshold=${t} (ตั้งได้จากแท็บ Lab Test, cache 60s)`);
  tick();
});
