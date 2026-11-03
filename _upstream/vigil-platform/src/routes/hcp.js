// ============================================================
// Vigil Platform — HCP integration routes (HC2 face search)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ค้นใบหน้าด้วยรูป โดยใช้ HCP เป็นเครื่องค้น แล้วเอาผลมาต่อกับข้อมูลของเราเอง
//
// รูปเดินทาง central → edge เพราะ **central ไปไม่ถึง HCP** (10.0.10.9) · ใช้ทางเดิม
// ที่ blacklist-source-* ใช้อยู่แล้ว (bearer + tunnel) จึงไม่ได้เปิดช่องทางเข้า
// เครื่องที่ตั้งอยู่สถานีเพิ่ม
//
// ขอบเขต: **HKT เท่านั้น** — เราต่อ HCP ผ่าน edge ของภูเก็ต ไซต์อื่นไม่เกี่ยว
// ============================================================
'use strict';

const crypto = require('crypto');
const { checkRange } = require('../helpers/hcpSearchPlan');
const { diffCameraMap } = require('../helpers/hcpCameraMap');
const { edgeCall: _edgeCall } = require('../helpers/edgeCall');
const { createHcpDevicesCache } = require('../helpers/hcpDevicesCache');
const { scopeCacheKey } = require('../auth');
const { createTtlCache } = require('../helpers/ttlCache');

const SITE = 'hkt';

// payload = null → GET (ใช้กับ /hcp-camera-map ที่ไม่มี body)
// ย้าย HTTPS logic จริงไป src/helpers/edgeCall.js แล้ว (2026-08-10) — face-embed-worker.js
// ต้องเรียก edge แบบเดียวกัน ผูก SITE ไว้ที่นี่เพื่อไม่ต้องแก้ 8 จุดที่เรียก edgeCall(...) ด้านล่าง
const edgeCall = (path, payload, timeoutMs) => _edgeCall(SITE, path, payload, timeoutMs);

// รายการอุปกรณ์ HCP (HC4) แคชแบบ stale-while-revalidate — เหตุผลเต็มอยู่ในไฟล์ helper
const hcpDevices = createHcpDevicesCache(
  async () => {
    const e = await edgeCall('/hcp-devices', null, 120000);
    if (e.code !== 200) throw Object.assign(new Error(`edge HTTP ${e.code}`), { body: e.body, code: e.code });
    return e.body;
  },
  { freshMs: Number(process.env.HCP_DEVICES_FRESH_MS || 60_000),
    onError: (e) => console.error('[hcp] ดึงรายการอุปกรณ์ใหม่ไม่สำเร็จ:', e.message) });

module.exports = function hcpRoutes(app, pool, { auth }) {

  // ── FR-P4/Phase 5 · เครื่องค้นใบหน้าของเราเองแทน HCP ──────────────────────
  // buffalo_l pilot (ดัชนีอยู่บน edge, เทียบที่ edge) ถูกลบไปแล้วใน Phase 3
  // (2026-08-10, ล้างข้อมูล face/body ของ hkt ทั้งหมดก่อนเปลี่ยนไปใช้ AuraFace-v1)
  // — ตั้งแต่นั้นดัชนี "ของเราเอง" คือ `face_embeddings` (central, migration 129)
  // ไม่ใช่ .npz shard บน edge อีกต่อไป สถาปัตยกรรมเปลี่ยนตาม: ฝัง (embed) ที่ edge
  // (โมเดลอยู่ที่นั่น) แต่ **เทียบที่ central** (ดัชนีอยู่ที่นั่น) ไม่ใช่ทำทั้งคู่บน edge
  // เหมือนเดิม — ตัวเชื่อมกลับมาที่เหตุการณ์คือ `face_embeddings.event_id` ตรงตัว
  // ทุกผลลัพธ์ย้อนไปหาเหตุการณ์จริงได้ 1:1 เสมอ ไม่ต้องเดาด้วยเวลาเหมือนฝั่ง HCP
  //
  // 🔴 ทำไมค้นจาก `face_embeddings` ตรง ๆ ไม่ join `events` ตั้งแต่ต้น: วัดจริง
  // 2026-08-09 ว่า `count(*) ... JOIN sites WHERE s.code='hkt'` บนตาราง events (13
  // ล้านแถว 25 partition) ใช้เวลา 49 วินาทีไม่จำกัดช่วง และเกิน 2 นาทีแม้จำกัด 7 วัน
  // ⇒ หน้าเว็บ timeout (ดู engine-stats ด้านล่าง เจอเคสเดียวกันมาก่อนแล้ว) — จึง
  // denormalize `camera_id` ลงบน face_embeddings ตรง ๆ (migration 131) เพื่อกรอง
  // ตามกล้อง/เวลาได้โดยไม่ต้องแตะ events เลยจนกว่าจะเหลือผลลัพธ์แค่ top-N ที่จะแสดง
  async function edgeEngineSearch(b, pic, res) {
    try {
      const cams = Array.isArray(b.cameras) ? b.cameras.filter(Boolean) : [];
      const fromMs = Date.parse(b.since), toMs = Date.parse(b.until);

      const emb = await edgeCall('/face-engine-embed-query', { image_b64: pic }, 20000);
      if (emb.code !== 200 || !emb.body?.ok)
        return res.status([400, 503, 504].includes(emb.code) ? emb.code : 502)
                  .json({ error: emb.body?.error || `edge HTTP ${emb.code}` });
      const q = emb.body.embedding;

      const limit = Math.max(1, Math.min(200, Number(b.maxResults) || 40));
      const params = [q];
      // dim=512 กันไว้เผื่ออนาคตมีโมเดลอื่นที่ dim ไม่เท่ากันมาปนในตารางเดียวกัน —
      // vec_dot() วน subscript ของ a แล้วอ่าน b[i] เกินความยาวจะได้ NULL ทำให้แถวนั้น
      // เงียบๆ ไปอยู่ท้ายผลลัพธ์แทนที่จะ error ให้เห็น (dim ยังไม่เคยไม่ตรงจริง ณ ตอนนี้)
      let where = `model_name = 'auraface-v1' AND dim = 512`;
      if (Number.isFinite(fromMs)) { params.push(new Date(fromMs).toISOString()); where += ` AND event_time >= $${params.length}`; }
      if (Number.isFinite(toMs))   { params.push(new Date(toMs).toISOString());   where += ` AND event_time <= $${params.length}`; }
      if (cams.length)             { params.push(cams);                          where += ` AND camera_id = ANY($${params.length})`; }
      params.push(limit);

      // vec_dot ทุกแถวของช่วง (124k แถว/วัน) — ให้ worker ขนาน 4 เฉพาะคำสั่งนี้ (หน้า admin ใช้นาน ๆ ครั้ง)
      // คู่กับ migration 254 (COST 10000) · วัด 30 วัน: worker 2 = 28.8 วิ · 4 = 17.7 วิ (O12)
      // SET LOCAL มีผลเฉพาะใน transaction ของ client ตัวเดียวกัน (GOTCHAS #219)
      const t0 = Date.now();
      const c = await pool.connect();
      let hits;
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL max_parallel_workers_per_gather = 4');
        ({ rows: hits } = await c.query(
          `SELECT event_id, event_time, camera_id, vec_dot(embedding, $1::real[]) AS score
             FROM face_embeddings WHERE ${where}
            ORDER BY score DESC LIMIT $${params.length}`,
          params));
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
      const tookMs = Date.now() - t0;

      const { rows: evs } = hits.length ? await pool.query(
        `SELECT e.id, e.event_time, e.event_type, e.camera_id, e.snapshot_filename,
                c.name AS camera_name,
                e.raw_json->>'_snapshot'      AS snapshot,
                e.raw_json->>'_snapshot_full' AS snapshot_full,
                e.raw_json->>'age'            AS age,
                e.raw_json->>'gender'         AS gender,
                e.raw_json->>'faceExpression' AS expression,
                e.raw_json->>'glass'          AS glass,
                e.raw_json->>'mask'           AS mask,
                e.raw_json->>'hat'            AS hat,
                e.raw_json->>'stayDuration'   AS stay_duration,
                e.raw_json->>'faceScore'      AS face_score
           FROM events e LEFT JOIN cameras c ON c.id = e.camera_id
          WHERE e.id = ANY($1)`,
        [hits.map((h) => h.event_id)]) : { rows: [] };
      const byId = {};
      evs.forEach((e) => { byId[e.id] = e; });

      // เกณฑ์ขั้นต่ำของเครื่องเราวัดจาก AuraFace-v1 โดยตรง (ไม่ใช่ของ buffalo_l เดิม
      // ที่เคยเขียนไว้ตรงนี้ — คนละโมเดล คนละสเกล) วัดจริง 2026-08-09: คู่ภาพที่ไม่ใช่
      // คนเดียวกันขึ้น 0.34-0.41 ยังไม่ได้ calibrate คู่ภาพคนเดียวกันจริง (ดู threshold
      // ของ face-embed-worker.js ที่รอ calibrate เหมือนกัน) — จึงยังไม่แนะนำค่า default
      // จำนวนที่ถูกตัดด้วยเกณฑ์ต้องรายงานกลับไปเสมอ ไม่ตัดเงียบ ไม่งั้น "ไม่เจอ" กับ
      // "เจอแต่ต่ำกว่าเกณฑ์ที่ตั้งไว้เอง" จะหน้าตาเหมือนกันเป๊ะ
      const minScore = Number(b.threshold);
      const results = [];
      let goneEvent = 0, belowThreshold = 0;
      for (const h of hits) {
        if (Number.isFinite(minScore) && Number(h.score) < minScore) { belowThreshold++; continue; }
        const ev = byId[h.event_id];
        if (!ev) { goneEvent++; continue; } // เหตุการณ์ถูกลบไปแล้วระหว่างทาง (หายาก)
        results.push({
          similarity: h.score,
          capture_time: ev.event_time,
          camera_id: ev.camera_id,
          camera_name: ev.camera_name || null,
          hcp_index: null, subpic_url: null, pic_url: null,
          gender: ev.gender, age_group: null, mask: ev.mask, glasses: ev.glass, smile: null,
          ours: ev,
        });
      }

      // ── ความครอบคลุม — นับจาก face_embed_queue (มี status/last_error ต่อแถว
      // อยู่แล้ว) แทนแผนที่ manifest ของ buffalo_l ที่ถูกลบไปพร้อม Phase 3 — เริ่มนับ
      // จริงตั้งแต่ 2026-08-09 (วันที่ Phase 3 ล้างคิวเก่าทิ้ง) ช่วงก่อนหน้านั้นว่างเปล่า
      // โดยดีไซน์ ไม่ใช่ข้อมูลหาย
      const covParams = [];
      let covWhere = 'true';
      if (Number.isFinite(fromMs)) { covParams.push(new Date(fromMs).toISOString()); covWhere += ` AND event_time >= $${covParams.length}`; }
      if (Number.isFinite(toMs))   { covParams.push(new Date(toMs).toISOString());   covWhere += ` AND event_time <= $${covParams.length}`; }
      const { rows: [cov] } = await pool.query(
        `SELECT count(*) AS listed,
                count(*) FILTER (WHERE status = 'done') AS indexed,
                count(DISTINCT event_time::date) AS days
           FROM face_embed_queue WHERE model_name = 'auraface-v1' AND ${covWhere}`,
        covParams);
      const { rows: [{ count: indexedTotal }] } = await pool.query(`SELECT count(*) FROM face_embeddings`);

      return res.json({
        ok: true, engine: 'edge',
        searched: { cameras: cams.length || 'all', took_ms: tookMs },
        coverage: { indexed_in_range: Number(cov.indexed), events_in_range: Number(cov.listed),
                    days_in_range: Number(cov.days), by_day: true,
                    indexed_total: Number(indexedTotal) },
        dropped_no_event: goneEvent, dropped_out_of_range: 0,
        below_threshold: belowThreshold, threshold: Number.isFinite(minScore) ? minScore : null,
        results,
      });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // GET /api/hcp/engine-stats — ดัชนีครอบคลุมแค่ไหน + รายชื่อกล้องของไซต์
  //
  // รายชื่อกล้องมาจากตาราง `cameras` ของไซต์ ไม่ใช่จากตารางแมป HCP — ตัวกรองของ
  // เครื่องเราเทียบกับ `cameras.id` ที่อยู่ในชื่อไฟล์ กล้องที่ไม่ได้แมปกับ HCP ก็ยัง
  // ค้นได้ ถ้าเอารายชื่อจากแมปมาใช้จะกรองไม่เจอโดยไม่มีอะไรฟ้อง
  //
  // Phase 5: เดิมถาม edge (`/face-engine-stats` → buffalo_l manifest บน edge) แต่
  // ดัชนีนั้นถูกลบไปพร้อม Phase 3 แล้ว ตอนนี้นับจาก `face_embed_queue`/`face_embeddings`
  // บน central ตรง ๆ — ไม่ต้องเรียก edge เลย (ตัดจุดที่เคย fail ได้อีกจุดหนึ่งไปด้วย)
  // 🔴 ยังคงห้าม COUNT จาก `events` โดยตรงเหมือนเดิม (49s ไม่จำกัดช่วง / เกิน 2 นาที
  // แม้จำกัด 7 วัน, วัดจริง 2026-08-09) — `face_embed_queue` เป็นตารางเล็กมีดัชนีเอง
  app.get('/api/hcp/engine-stats', auth.requireAdmin, async (req, res) => {
    const { rows: cams } = await pool.query(
      `SELECT c.id, c.name FROM cameras c JOIN sites s ON s.id = c.site_id
        WHERE s.code = $1 ORDER BY c.id`, [SITE]);
    // Coverage denominator counts only rows that CAN still produce a vector.
    // Two classes never can, and both grow forever, so including them made the
    // headline % drift down no matter how healthy the pipeline was (measured
    // 2026-08-10: of a 13,974 gap, 8,926 = 64% was permanently unreachable and
    // only 5,048 was real backlog):
    //   • no_face  — the camera's frame genuinely has no detectable face. Normal
    //     for this workload and varies by camera/lighting (13.7% one day, 3.9%
    //     the next), so it accumulates every single day.
    //   • skipped  — near-duplicate captures deliberately not embedded (same
    //     person still in frame, see mqtt-subscriber.js dedup). Enqueue-side
    //     dedup keeps new ones out of the queue entirely; this only counts the
    //     one-off retroactive backlog cleanup that had already been queued.
    // Both are still reported separately below so the number stays diagnosable
    // — a single percentage can't distinguish "falling behind" from "correctly
    // skipping", and that ambiguity is what made this hard to read.
    const { rows: dayRows } = await pool.query(
      `SELECT event_time::date::text AS day, count(*) AS listed,
              count(*) FILTER (WHERE status = 'done') AS indexed,
              count(*) FILTER (WHERE last_error = 'ตรวจไม่พบใบหน้าในภาพ') AS no_face,
              count(*) FILTER (WHERE last_error = 'dedup_skip_backlog') AS skipped,
              count(*) FILTER (WHERE status = 'pending') AS pending,
              count(*) FILTER (WHERE status = 'failed') AS failed
         FROM face_embed_queue WHERE model_name = 'auraface-v1'
        GROUP BY 1 ORDER BY 1 DESC`);
    const days = {};
    let listedTotal = 0, noFaceTotal = 0, skippedTotal = 0, pendingTotal = 0, failedTotal = 0;
    dayRows.forEach((r) => {
      days[r.day] = { indexed: Number(r.indexed), listed: Number(r.listed),
                      no_face: Number(r.no_face), skipped: Number(r.skipped),
                      pending: Number(r.pending), failed: Number(r.failed) };
      listedTotal  += Number(r.listed);
      noFaceTotal  += Number(r.no_face);
      skippedTotal += Number(r.skipped);
      pendingTotal += Number(r.pending);
      failedTotal  += Number(r.failed);
    });
    const { rows: [{ count: vectors }] } = await pool.query(`SELECT count(*) FROM face_embeddings`);
    res.json({ ok: true, cameras: cams, index: {
      days, vectors: Number(vectors),
      listed_total: listedTotal,
      // what the headline % divides by — excludes the permanently unreachable
      embeddable_total: listedTotal - noFaceTotal - skippedTotal,
      no_face_total: noFaceTotal, skipped_total: skippedTotal,
      pending_total: pendingTotal, failed_total: failedTotal,
    } });
  });

  // POST /api/hcp/face-search
  //   { pictureData: <base64>, since, until, cameras?: [camera_id], threshold?, maxResults?, joinMinutes? }
  app.post('/api/hcp/face-search', auth.requireAdmin, async (req, res) => {
    const b = req.body || {};
    const pic = String(b.pictureData || '').replace(/^data:image\/[a-z]+;base64,/, '');
    if (!pic) return res.status(400).json({ error: 'ต้องแนบรูป' });
    if (!b.since || !b.until) return res.status(400).json({ error: 'ต้องระบุช่วงเวลา' });

    // ตรวจช่วงเวลาก่อนเขียน audit (คำขอที่ผิดรูปไม่ควรทิ้งแถว audit ไว้) — เพดาน
    // ตัวเดียวกับที่ edge ใช้ ไม่ได้เขียนเลขซ้ำไว้สองที่
    //
    // เพดาน 31 วัน/40 คำขอ เป็น**ข้อจำกัดของ HCP** (ยิงทีละหน้าต่าง) ไม่ใช่ของเรา —
    // เครื่องของเราคูณเมทริกซ์ครั้งเดียวจบ ช่วงกว้างแค่ไหนก็ราคาเท่ากัน จึงไม่บังคับ
    if (b.engine !== 'edge') {
      const range = checkRange(b.since, b.until);
      if (range.error) return res.status(400).json(range);
    }

    // ── PDPA: บันทึกก่อนค้น ไม่ใช่หลังสำเร็จ ────────────────────
    // การค้นที่ error ออกกลางทางก็คือการค้นที่เกิดขึ้นแล้ว · เก็บ hash ของรูป
    // ไม่ใช่ตัวรูป — ตอบได้ว่า "ใครค้นด้วยรูปเดียวกันนี้บ้าง" โดยไม่สร้างคลังรูป
    // ใบหน้าชุดที่สองขึ้นมาเอง
    const imgHash = crypto.createHash('sha256').update(pic).digest('hex');
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
      [req.user?.id || null, req.user?.username || 'unknown', 'hcp_face_search',
       // บันทึกด้วยว่าค้นด้วยเครื่องไหน — คำถาม PDPA "ใครค้นอะไร" ต้องตอบได้ว่าค้น
       // จากคลังของ HCP หรือจากภาพของเราเอง ซึ่งเป็นคนละกองข้อมูลกัน
       JSON.stringify({ image_sha256: imgHash, since: b.since, until: b.until,
                        engine: b.engine === 'edge' ? 'edge' : 'hcp',
                        cameras: Array.isArray(b.cameras) ? b.cameras.length : 'all', ip: req.ip })]
    ).catch((e) => console.warn('[hcp-search] audit write failed:', e.message));

    // ── FR-P4 · ค้นด้วยเครื่องของเราเองแทน HCP ────────────────
    // ผลที่ได้เป็นเหตุการณ์ของเราโดยตรง จึงไม่มีปัญหา "เวลาของ HCP ไม่ตรง" และไม่ต้อง
    // เดาว่าภาพไหนคู่กับภาพไหน · ด่าน audit ข้างบนใช้ร่วมกันโดยตั้งใจ — ไม่ว่าจะค้น
    // ด้วยเครื่องไหน PDPA ก็ต้องบันทึกเหมือนกัน
    if (b.engine === 'edge') return edgeEngineSearch(b, pic, res);

    try {
      // camera_id ของเรา → cameraIndexCode ของ HCP · ไม่ระบุ = ทุกตัวที่แมปไว้
      const { rows: map } = await pool.query(
        `SELECT hcp_index, camera_id FROM hcp_camera_map WHERE site_id = $1
          ${Array.isArray(b.cameras) && b.cameras.length ? 'AND camera_id = ANY($2)' : ''}`,
        Array.isArray(b.cameras) && b.cameras.length ? [SITE, b.cameras] : [SITE]);
      if (!map.length) return res.status(400).json({ error: 'ไม่มีกล้องที่แมปกับ HCP ในขอบเขตที่เลือก' });
      const camOf = {};
      map.forEach((m) => { camOf[String(m.hcp_index)] = m.camera_id; });
      // ชื่อกล้องแบบที่คนอ่านออก — หน้า "รายละเอียดใบหน้า" ก็แสดงแบบนี้
      const { rows: camRows } = await pool.query('SELECT id, name FROM cameras');
      const camName = {};
      camRows.forEach((c) => { camName[c.id] = c.name; });

      const edge = await edgeCall('/hcp-face-search', {
        pictureData: pic, since: b.since, until: b.until,
        cameraIndexCodes: map.map((m) => m.hcp_index).join(','),
        threshold: b.threshold, maxResults: b.maxResults, targetIndex: b.targetIndex,
      });
      // 400 ต้องส่งต่อด้วย ไม่งั้นเพดานที่ edge ปฏิเสธพร้อมตัวเลข (total_calls/limit_calls)
      // จะโผล่ที่เบราว์เซอร์เป็น 502 เฉย ๆ — คนใช้เห็นแค่ "ผิดพลาด" ไม่เห็นว่าเกินเท่าไหร่
      // 401 ไม่ส่งต่อโดยตั้งใจ: bearer ผิดคือ config ของเรา ไม่ใช่คำขอของคนใช้
      if (edge.code !== 200)
        return res.status([400, 409, 422].includes(edge.code) ? edge.code : 502).json(edge.body);

      // ── ต่อผลของ HCP เข้ากับของเรา ─────────────────────────
      // จับคู่ด้วย (กล้องเดียวกัน + เวลาใกล้กัน) เพราะไม่มี id ร่วมระหว่างสองระบบ
      // หน้าต่างเป็นพารามิเตอร์ ไม่ใช่ค่าคงที่ที่เดาเอา — ให้คนเรียกวัดแล้วตั้งเอง
      // หน่วยเป็น **วินาที** ไม่ใช่นาที — วัดจากของจริง: กล้องตัวเดียวกันยิงใบหน้าใหม่ทุก
      // 2-15 วินาที ⇒ หน้าต่างระดับนาทีจะหยิบคนที่บังเอิญเดินผ่านใกล้ ๆ กันมาแสดงว่าเป็น
      // คนเดียวกัน · ค่าปริยาย 3 วินาที = มัธยฐานของคู่ที่ตรงกันจริง (วัด 2026-08-09)
      const win = Math.max(1, Math.min(300, Number(b.joinSeconds)
        || (Number(b.joinMinutes) ? Number(b.joinMinutes) * 60 : 3)));
      const results = [];
      for (const t of (edge.body.results || [])) {
        const camId = camOf[String(t.monitorPointIndexCode)] || null;
        let ours = null;
        if (camId && t.captureTime) {
          const { rows } = await pool.query(
            `SELECT id, event_time, event_type, camera_id,
                    raw_json->>'_snapshot'      AS snapshot,
                    raw_json->>'_snapshot_full' AS snapshot_full,
                    raw_json->>'age'            AS age,
                    raw_json->>'gender'         AS gender,
                    raw_json->>'faceExpression' AS expression,
                    raw_json->>'glass'          AS glass,
                    raw_json->>'mask'           AS mask,
                    raw_json->>'hat'            AS hat,
                    raw_json->>'stayDuration'   AS stay_duration,
                    raw_json->>'faceScore'      AS face_score,
                    round(abs(extract(epoch FROM (event_time - $2::timestamptz))))::int AS delta_sec
               FROM events
              WHERE camera_id = $1
                AND event_time BETWEEN $2::timestamptz - ($3 || ' seconds')::interval
                                   AND $2::timestamptz + ($3 || ' seconds')::interval
              ORDER BY abs(extract(epoch FROM (event_time - $2::timestamptz))) LIMIT 1`,
            [camId, t.captureTime, String(win)]);
          ours = rows[0] || null;
        }
        results.push({
          similarity: Number(t.similarity),      // HCP ส่งมาเป็น 0-1 อยู่แล้วที่ endpoint นี้
          capture_time: t.captureTime,
          hcp_index: t.monitorPointIndexCode,
          camera_id: camId,                      // null = กล้องที่ HCP ดูแลแต่เราไม่ได้แมป
          camera_name: camId ? (camName[camId] || null) : null,
          smile: t.smile,
          gender: t.gender, age_group: t.ageGroup, mask: t.mask, glasses: t.glasses,
          // รูปจาก HCP: subpic = ใบหน้าที่ครอปแล้ว · pic = ภาพเต็มจากกล้อง
          // ส่งไปเป็น URL ไม่ใช่ไบต์ — หน้าจอค่อยขอทีละใบตอนเปิด modal
          subpic_url: t.subpicUrl || null, pic_url: t.picUrl || null,
          ours,                                  // null = ช่วงนั้นเราไม่มีเหตุการณ์ของกล้องนั้น
        });
      }

      res.json({
        ok: true,
        faces_in_picture: edge.body.facesInPicture,
        searched: { cameras: map.length, windows: edge.body.windows,
                    calls: edge.body.calls, failed_calls: edge.body.failedCalls },
        join_seconds: win,
        // "ใกล้เคียงตามเวลา" ไม่ใช่ "ยืนยันว่าเป็นคนเดียวกัน" — ชื่อฟิลด์ต้องไม่โกหก
        near_in_time: results.filter((r) => r.ours).length,
        results,
      });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // GET /api/hcp/nearby — ภาพใบหน้าของ "เรา" จากกล้องตัวหนึ่ง รอบเวลาที่กำหนด
  //
  // มีไว้เพราะ `captureSearch.captureTime` ของ HCP **ไม่ใช่เวลาที่กล้องจับ** แต่เป็นเวลา
  // ที่ HCP ประมวลผลเสร็จ — วัดจริง 2026-08-09: ปกติช้าไม่กี่วินาที แต่เคยพบช้าถึง
  // 26 นาที (OSD บนภาพของ HCP เอง + NVR + เหตุการณ์ของเรา ตรงกันที่ 16:09:52
  // ขณะที่ HCP บอก 16:36:08) ⇒ การให้ระบบ "เลือกภาพให้" ด้วยเวลาจึงชี้ผิดคนได้
  // หน้าจอจะเอาผลจากเส้นนี้ไปเรียงให้คนเลือกเอง ซึ่งคนทำได้ดีกว่าเครื่องมาก
  app.get('/api/hcp/nearby', auth.requireAdmin, async (req, res) => {
    const cam = String(req.query.camera_id || '');
    const at = String(req.query.at || '');
    const win = Math.max(5, Math.min(3600, Number(req.query.window) || 60));
    const limit = Math.max(1, Math.min(60, Number(req.query.limit) || 24));
    if (!cam || !at) return res.status(400).json({ error: 'ต้องระบุ camera_id และ at' });
    if (isNaN(new Date(at).getTime())) return res.status(400).json({ error: 'รูปแบบเวลาไม่ถูกต้อง' });
    try {
      const { rows } = await pool.query(
        `SELECT id, event_time, camera_id,
                raw_json->>'_snapshot'      AS snapshot,
                raw_json->>'_snapshot_full' AS snapshot_full,
                raw_json->>'age'            AS age,
                raw_json->>'gender'         AS gender,
                raw_json->>'faceExpression' AS expression,
                raw_json->>'glass'          AS glass,
                raw_json->>'mask'           AS mask,
                raw_json->>'hat'            AS hat,
                raw_json->>'stayDuration'   AS stay_duration,
                raw_json->>'faceScore'      AS face_score,
                round(abs(extract(epoch FROM (event_time - $2::timestamptz))))::int AS delta_sec
           FROM events
          WHERE camera_id = $1
            AND raw_json->>'_snapshot' IS NOT NULL
            AND event_time BETWEEN $2::timestamptz - ($3 || ' seconds')::interval
                               AND $2::timestamptz + ($3 || ' seconds')::interval
          ORDER BY abs(extract(epoch FROM (event_time - $2::timestamptz)))
          LIMIT $4`, [cam, at, String(win), limit]);
      // นับทั้งหมดในหน้าต่าง เพื่อบอกได้ว่าที่แสดงเป็นแค่ส่วนหนึ่ง — ไม่ตัดเงียบ
      const { rows: [{ total }] } = await pool.query(
        `SELECT count(*)::int AS total FROM events
          WHERE camera_id = $1 AND raw_json->>'_snapshot' IS NOT NULL
            AND event_time BETWEEN $2::timestamptz - ($3 || ' seconds')::interval
                               AND $2::timestamptz + ($3 || ' seconds')::interval`,
        [cam, at, String(win)]);
      res.json({ ok: true, camera_id: cam, at, window_seconds: win, total, shown: rows.length, rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/hcp/picture?u=… — ส่งต่อรูปของ HCP ให้เบราว์เซอร์ (central ไปไม่ถึงคลังรูปเอง)
  // ตรวจรูปแบบซ้ำที่นี่ด้วย ไม่ปล่อยให้ edge เป็นด่านเดียว
  const HCP_PIC_RE = /^(?:http:\/\/10\.0\.10\.\d{1,3}:6120\/|Dev:\/\/)isapiHikStor\?[\w=&.%-]+$/;
  app.get('/api/hcp/picture', auth.requireAdmin, async (req, res) => {
    const u = String(req.query.u || '');
    if (!HCP_PIC_RE.test(u)) return res.status(400).json({ error: 'url ไม่อยู่ในรูปแบบที่อนุญาต' });
    try {
      const e = await edgeCall('/hcp-picture', { url: u }, 30000);
      if (e.code !== 200) return res.status(502).json(e.body || { error: `edge HTTP ${e.code}` });
      // edgeCall พยายาม parse JSON — รูปจึงมาถึงเป็นสตริงใน body.error เมื่อ parse ไม่ได้
      const raw = Buffer.isBuffer(e.raw) ? e.raw : null;
      if (!raw) return res.status(502).json({ error: 'รูปเสียหายระหว่างทาง' });
      // รูปหนึ่ง URL = รูปเดิมเสมอ (id อยู่ใน URL) ⇒ จำได้ยาว · เปิดหน้าเดิมซ้ำไม่ต้องดึง ~0.9 MB/ใบ ผ่านอุโมงค์อีก
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.type('jpeg').send(raw);
    } catch (err) { res.status(502).json({ error: err.message }); }
  });

  // GET /api/hcp/devices — HC4 · อุปกรณ์ที่ HCP ดูแล + บอกว่าตัวไหนเราดูแลอยู่ด้วย
  // จุดประสงค์ทั้งหมดของหน้านี้คือ "กล้องที่ HCP เห็นแต่เรามองไม่เห็น" — ตัวเลขรวม
  // อย่างเดียวไม่ตอบคำถามนั้น จึงต้อง join กับ hcp_camera_map เสมอ
  app.get('/api/hcp/devices', auth.requireAdmin, async (req, res) => {
    try {
      // การ join กับ hcp_camera_map ไม่แคช (ราคา ~1ms) — แก้แมปแล้วต้องเห็นผลทันที
      const cached = await hcpDevices.get();
      const e = { body: cached.body };

      const { rows: map } = await pool.query(
        `SELECT m.hcp_index, m.camera_id, c.name
           FROM hcp_camera_map m LEFT JOIN cameras c ON c.id = m.camera_id
          WHERE m.site_id = $1`, [SITE]);
      const ours = {};
      map.forEach((m) => { ours[String(m.hcp_index)] = { camera_id: m.camera_id, name: m.name }; });

      const cameras = (e.body.cameras || []).map((c) => ({ ...c, ours: ours[c.index_code] || null }));
      const mine = cameras.filter((c) => c.ours).length;

      // alarmInputName/alarmOutputName เป็นแค่ "A1" ฯลฯ — ต่อชื่อ encoder ที่มัน
      // ติดอยู่ด้วยให้อ่านออกว่าเป็นตัวไหน ("A1 · HybridSAN") แทนที่จะโชว์ index_code ดิบ
      const encodeDevices = e.body.encodeDevices || [];
      const encoderName = {};
      encodeDevices.forEach((d) => { encoderName[d.index_code] = d.name; });
      const withEncoderLabel = (list) => (list || []).map((r) => ({
        ...r, dev_name: encoderName[r.dev_index_code] || null,
      }));

      res.json({
        ok: true,
        fetched_at: new Date(cached.at).toISOString(),   // หน้าเว็บใช้บอกอายุข้อมูล
        summary: e.body.summary,
        vms: e.body.vms,
        encode_devices: encodeDevices,
        cameras,
        record_servers: e.body.recordServers || [],
        intelligent_servers: e.body.intelligentServers || [],
        alarm_inputs: withEncoderLabel(e.body.alarmInputs),
        alarm_outputs: withEncoderLabel(e.body.alarmOutputs),
        coverage: { hcp_total: cameras.length, ours: mine, hcp_only: cameras.length - mine,
                    // แมปที่ชี้ไปหากล้องซึ่ง HCP ไม่รู้จักแล้ว = แมปค้าง ควรรู้
                    mapped_missing_in_hcp: map.length - mine },
      });
    } catch (err) {
      // ยังคงส่ง body ของ edge ต่อเหมือนเดิมเมื่อมี — ข้อความจาก HCP บอกสาเหตุได้ตรงกว่า
      res.status(502).json(err.body || { error: err.message });
    }
  });

  // เติมแคชล่วงหน้าหลังบูต — คนแรกที่เปิดแท็บจะไม่ใช่คนจ่ายค่ากวาดเต็ม ๆ
  setTimeout(() => hcpDevices.prewarm(), 30_000).unref?.();

  // GET /api/hcp/events — HC5 · เหตุการณ์ของ HCP ที่ไม่ใช่ LPR/ใบหน้า
  // แปลง srcIndex ของ HCP เป็น camera_id ของเราเมื่อแมปไว้ · ที่แปลงไม่ได้คือกล้อง
  // ที่ HCP ดูแลอยู่ตัวเดียว ซึ่งเป็นเหตุผลทั้งหมดที่หน้านี้มีอยู่
  //
  // 🔴 2026-09-06 — วัดจริง 5.7 วินาทีต่อครั้ง และเวลาทั้งหมดอยู่ที่ edgeCall ไม่ใช่ SQL
  // (central → tunnel → edge ภูเก็ต → HCP) · หน้าจอยิงใหม่ทุกครั้งที่กดตัวกรอง ซึ่ง
  // ส่วนใหญ่คือการกดกลับไปกลับมาระหว่างชุดเดิม ⇒ cache สั้น ๆ ตัดรอบเดินทางนั้นทิ้งได้
  // ทั้งก้อน โดยไม่ต้องแตะตัว edge call หรือ timeout ของมันเลย
  // 30 วิ = สั้นพอที่ "เหตุการณ์ล่าสุด" ยังตามทัน แต่ยาวพอครอบการกดตัวกรองรัว ๆ
  // เก็บ payload ที่ประกอบเสร็จแล้ว (join hcp_camera_map + ours) ไม่ใช่ body ดิบของ edge
  const _hcpEventsCache = createTtlCache({ name: 'hcp:events', ttlMs: 30 * 1000, max: 32 });
  app.get('/api/hcp/events', auth.requireAdmin, async (req, res) => {
    const since = req.query.since || null, until = req.query.until || null;
    if (since && until) {
      const range = checkRange(since, until);
      if (range.error) return res.status(400).json(range);
    }
    // scope ยังไม่มีผลกับ route นี้ (requireAdmin + SITE ตายตัว = 'hkt' ไม่มี siteWhere)
    // ใส่ไว้เพื่อไม่ให้ cache นี้กลายเป็นช่องรั่วเงียบ ๆ ถ้าวันหลังมีการ scope เพิ่ม
    const key = req.originalUrl.split('?')[1] || '';
    const scope = req.user?.allowedSites ?? null;
    // คีย์เต็มไว้ "อ่านอย่างเดียว" เพื่อตัดสินหัว X-Cache — การ **เก็บ** ยังผ่าน
    // wrap({ scope }) ที่เดียว คีย์ที่นี่เพี้ยนได้แค่หัว ไม่ทำให้ข้ามสโคป
    const _ek = `${key}|${scopeCacheKey(scope)}`;
    const fresh = _hcpEventsCache.get(_ek);
    if (fresh !== undefined) { res.set('X-Cache', 'HIT'); return res.json(fresh); }
    // ของเก่าที่หมดอายุแล้ว — ถ้า wrap คืนตัวนี้กลับมา แปลว่า loader ล้มแล้วใช้ของเก่า
    const staleCandidate = _hcpEventsCache.peek(_ek);
    try {
      const payload = await _hcpEventsCache.wrap(key, async () => {
        const e = await edgeCall('/hcp-events', {
          since, until, limit: Math.min(2000, Number(req.query.limit) || 1000),
          types: req.query.types ? String(req.query.types).split(',') : undefined,
        }, 180000);
        // 400/409 = คำขอของผู้ใช้เองผิด (ช่วงเวลา) — ตอบตรง ๆ ไม่ใช่เอาของเก่ามากลบ
        // นอกนั้นคือ edge/HCP ล่ม ซึ่งเป็นจังหวะที่ของเก่ามีค่าที่สุด (staleOnError ข้างล่าง)
        if (e.code !== 200) throw Object.assign(new Error('hcp_events_upstream'), { code: e.code, body: e.body, upstream: true });

        const { rows: map } = await pool.query(
          `SELECT hcp_index, camera_id FROM hcp_camera_map WHERE site_id = $1`, [SITE]);
        const camOf = {};
        map.forEach((m) => { camOf[String(m.hcp_index)] = m.camera_id; });
        const rows = (e.body.rows || []).map((r) => ({ ...r, camera_id: camOf[r.src_index] || null }));
        return { ...e.body, rows, ours: rows.filter((r) => r.camera_id).length };
      }, { scope, staleOnError: (err) => !(err.code === 400 || err.code === 409) });
      res.set('X-Cache',
        staleCandidate !== undefined && payload === staleCandidate ? 'STALE' : 'MISS');
      res.json(payload);
    } catch (err) {
      // upstream ตอบ non-200 → เดิมส่ง e.body กลับตรง ๆ · network/timeout → { error }
      if (err.upstream) {
        return res.status([400, 409].includes(err.code) ? err.code : 502).json(err.body);
      }
      res.status(502).json({ error: err.message });
    }
  });

  // กล้องที่ค้นได้จริง — หน้าจอใช้ทำตัวเลือก ไม่ต้องเดาเอง
  // พ่วงผลเทียบกับไฟล์แมปบน edge มาด้วย เพราะไฟล์นั้นก๊อปมือและดริฟต์ได้เงียบ ๆ
  app.get('/api/hcp/cameras', auth.requireAdmin, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT m.hcp_index, m.camera_id, m.hcp_name, c.name
         FROM hcp_camera_map m LEFT JOIN cameras c ON c.id = m.camera_id
        WHERE m.site_id = $1 ORDER BY m.camera_id`, [SITE]);

    let drift = null;
    try {
      const e = await edgeCall('/hcp-camera-map', null, 20000);
      // edge ที่ยังไม่ได้ deploy ตอบ 404 เป็นหน้า HTML ทั้งหน้า — อย่าเอามาแปะเป็น error
      if (e.code !== 200) {
        const m = e.body && typeof e.body.error === 'string' && !/^\s*</.test(e.body.error)
          ? e.body.error : `edge ตอบ HTTP ${e.code}`;
        drift = { error: m.slice(0, 200) };
      }
      else {
        const dbMap = {};
        rows.forEach((r) => { dbMap[String(r.hcp_index)] = r.camera_id; });
        drift = diffCameraMap(dbMap, e.body.map);
      }
    } catch (err) {
      // ต่อ edge ไม่ได้ ≠ ดริฟต์ — บอกว่าเทียบไม่ได้ ไม่ใช่บอกว่าตรงกัน
      drift = { error: err.message };
    }
    res.json({ cameras: rows, drift });
  });
};
