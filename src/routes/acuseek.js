// ============================================================
// Vigil Platform — ค้นหาอัจฉริยะ (AcuSeek) · ฝั่ง central
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ผู้ใช้พิมพ์ภาษาไทยอิสระ → เราแปลเป็นวลีอังกฤษ → ส่งให้เครื่องค้นที่ภูเก็ตผ่าน edge
//
// ขอบเขต: **hkt เท่านั้น** — เครื่องอยู่ที่ 10.0.10.12 ซึ่ง central ไปไม่ถึง
// (เหมือน HCP ที่ 10.0.10.9) ทุกคำขอจึงวิ่งผ่าน edge เสมอ
//
// 🔴 สองอย่างที่ต้องไม่พลาด และเป็นเหตุผลว่าทำไมไฟล์นี้ไม่ได้เป็นแค่ proxy บาง ๆ
//
// 1. **กรองตามกล้องที่ผู้ใช้เห็นได้** — เครื่องค้นเห็นทั้ง 72 ช่องเสมอ ไม่รู้จัก
//    user_cameras ของเรา ถ้าส่งผลดิบกลับไปเลย ผู้ใช้ที่ถูกจำกัดให้เห็นกล้องเดียว
//    จะเห็นภาพจากทั้งจังหวัด · เป็นบั๊กคลาสเดียวกับ GOTCHAS #166 ที่เพิ่งแก้ไป
//    ⇒ กรอง **ทั้งขาส่ง** (จำกัด channelList) **และขารับ** (ตัดผลที่ไม่ได้รับอนุญาต)
//
// 2. **คำเตือน** ต้องเดินทางไปถึงหน้าจอเสมอ — "คนถือปืน" ได้คะแนน 97 พร้อมภาพ
//    ที่ไม่มีปืน ผู้ใช้จะเชื่อถ้าไม่มีอะไรบอก (ดู helpers/acuseekPhrase.js)
'use strict';

const { edgeCall: _edgeCall } = require('../helpers/edgeCall');
const phrase = require('../helpers/acuseekPhrase');
const signedImage = require('../helpers/signedImage');
const { createTtlCache } = require('../helpers/ttlCache');

const SITE = 'hkt';
const edgeCall = (path, payload, timeoutMs) => _edgeCall(SITE, path, payload, timeoutMs);

// แมป channel → กล้องของเรา · ไล่โซ่ผ่าน NVR ที่ edge แล้ว cache ไว้
// เก่าได้ (หน้างานสลับช่อง NVR ไม่บ่อย) แต่ไม่ควรค้างข้ามวัน
const MAP_FRESH_MS = Number(process.env.ACUSEEK_MAP_FRESH_MS || 60 * 60 * 1000);
const _mapCache = createTtlCache({ name: 'acuseek:channel-map', ttlMs: MAP_FRESH_MS, max: 4 });
const MAP_KEY = 'map';     // ช่องเก็บค่า — เขียนด้วย set() เท่านั้น
const LOAD_KEY = 'load';   // ช่องไว้ single-flight เท่านั้น แทน _mapInflight เดิม
// 🔴 สองช่องแยกกันโดยตั้งใจ ห้ามยุบเป็นช่องเดียว: ระหว่าง wrap กำลังโหลด มันแทน entry
//    เดิมด้วย entry ที่ยังไม่มีค่า ⇒ peek() ของช่องนั้น**บอด** แล้วคำขอที่สองจะตกไป
//    รอโหลด (edgeCall 120 วิ) ทั้งที่แมปเก่ายังใช้ได้ · แยกช่องแล้ว peek(MAP_KEY) เห็น
//    ของเก่าตลอดการรีเฟรช เหมือนพฤติกรรมเดิมที่ _map ค้างไว้ระหว่าง _mapInflight วิ่ง

async function _loadMap(pool) {
  const e = await edgeCall('/acuseek-channels', null, 120000);
  if (e.code !== 200 || !e.body?.ok) throw new Error(e.body?.error || `edge HTTP ${e.code}`);
  const { rows } = await pool.query(
    `SELECT id, name, ip_address, site_id FROM cameras WHERE ip_address IS NOT NULL`);
  const byIp = new Map(rows.map((r) => [r.ip_address, r]));
  const byChannel = new Map();
  for (const ch of e.body.channels || []) {
    const cam = ch.cameraIp ? byIp.get(ch.cameraIp) : null;
    byChannel.set(Number(ch.id), {
      camera_id: cam ? cam.id : null,
      name: cam ? cam.name : (ch.name || null),
      site_id: cam ? cam.site_id : null,
      acuseekName: ch.name || null,
    });
  }
  // `at` ยังต้องมี — /api/acuseek/cameras ตอบ `fetched_at` จากค่านี้ (ถ้าหายไป
  // `new Date(undefined).toISOString()` จะ throw RangeError ทั้ง endpoint)
  return { at: Date.now(), byChannel };
}

// ttlMs:0 = ช่อง load หมดอายุทันทีที่โหลดเสร็จ ใช้เป็นที่กัน request ซ้อนอย่างเดียว
const _refreshMap = (pool) => _mapCache.wrap(LOAD_KEY,
  async () => _mapCache.set(MAP_KEY, await _loadMap(pool)), { ttlMs: 0 });

// stale-while-revalidate: มีของเก่าอยู่ = ตอบทันที แล้วค่อยรีเฟรชเบื้องหลัง
// (wrap อย่างเดียวไม่พอ เพราะมันจะ **รอ** โหลดใหม่เมื่อหมดอายุ) · peek = ค่าล่าสุดไม่สน TTL
function _mapCached(pool) {
  const stale = _mapCache.peek(MAP_KEY);
  if (!stale) return _refreshMap(pool);         // ยังไม่เคยโหลด = ต้องรอ
  if (_mapCache.get(MAP_KEY) === undefined) {   // หมดอายุ → เตะให้โหลดใหม่ แต่ไม่รอ
    _refreshMap(pool).catch((e) => console.error('[acuseek] รีเฟรชแมปช่องไม่สำเร็จ:', e.message));
  }
  return Promise.resolve(stale);
}

// ── สร้างหน้าต่างเวลา ──────────────────────────────────────────────────
// เครื่องรับได้ทีละช่วงเดียว ⇒ "กลางวัน ย้อน 3 วัน" ต้องแตกเป็น 3 งาน
// คุ้มที่จะแตก เพราะวัดแล้วว่ายิงพร้อมกัน 4 งานเครื่องไม่กระเทือน (CPU 8-13%)
// และการซอยทำให้ `totalMatches` ไม่ตัน 500 → ได้จำนวนจริง (39/28 แทน 500+)
//
// ⚠️ ภูเก็ตเป็น UTC+7 เสมอ — คำนวณจาก offset ตรง ๆ ไม่พึ่ง timezone ของ server
const TZ_OFFSET_H = 7;
/**
 * @param days  จำนวนวันย้อนหลัง
 * @param band  ชื่อช่วงสำเร็จรูป (day/night/...) — ใช้เมื่อไม่มี range
 * @param range { fromMin, toMin } ช่วงที่ระบุเอง เป็นนาทีนับจากเที่ยงคืน · มีสิทธิ์ก่อน band
 */
/**
 * @param dayOffset เจาะจง "วันไหน" นับถอยหลังจากวันนี้ (เมื่อวาน = 1) · null = ไม่เจาะจง
 *   ต่างจาก `days` ที่แปลว่า "ย้อนหลังกี่วัน" — เคยรวมเป็นค่าเดียวแล้วผิด
 */
// now ฉีดเข้ามาได้เพื่อให้เทสต์ตรึงเวลาได้ — บั๊กหน้าต่างเวลาของฟีเจอร์นี้ทุกตัว
// ขึ้นกับ "ตอนนี้กี่โมง" ซึ่งเทสต์ที่เรียก Date.now() จริงจะจับไม่ได้เลย
function buildWindows(days, band, range, date, dayOffset, nowMs) {
  const now = nowMs ?? Date.now();
  const midToday = Math.floor((now + TZ_OFFSET_H * 3600e3) / 864e5) * 864e5 - TZ_OFFSET_H * 3600e3;
  // ระบุวันที่ หรือระบุว่าวันไหน = วันเดียว ไม่ใช่ย้อน N วัน
  const anchor = date ? Date.UTC(date.y, date.m - 1, date.d) - TZ_OFFSET_H * 3600e3
    : (dayOffset != null ? midToday - dayOffset * 864e5 : null);
  if (anchor != null) days = 1;
  // ระบุช่วงเองมาก่อนเสมอ — ละเอียดกว่าและเป็นสิ่งที่ผู้ใช้ตั้งใจ
  const mins = range && Number.isFinite(range.fromMin) && Number.isFinite(range.toMin)
    ? { from: range.fromMin / 60, to: range.toMin / 60 }
    : phrase.bandHours(band);
  if (!mins) {
    return anchor != null
      ? [{ start: anchor, end: Math.min(anchor + 864e5, now) }]   // ทั้งวันของวันที่ระบุ
      : [{ start: now - days * 864e5, end: now }];                // ทั้งวัน ย้อน N วัน
  }

  const wins = [];
  let firstBase = anchor != null ? anchor : midToday;
  // 🔴 ช่วงของ "วันนี้" ยังมาไม่ถึง → ต้องถอยไปวันก่อนหน้า ไม่ใช่ข้ามทิ้ง
  //
  // ค้นตอนตี 1 ด้วย "ช่วงเช้า 06–12 ย้อนหลัง 1 วัน": ช่วงเช้าของวันนี้คือ 6 โมงเช้า
  // ที่ยังมาไม่ถึง ⇒ ลูปเดิม `continue` ทิ้งทุกหน้าต่าง แล้วตกไป fallback ที่คืน
  // **ทั้ง 24 ชั่วโมง** ⇒ ผู้ใช้เลือกช่วงเช้าแต่ได้ผลตอนดึกมาเต็มหน้าจอ โดยไม่มี
  // อะไรบอกว่าตัวกรองถูกทิ้ง (เจ้าของเจอเอง 2026-08-14)
  //
  // "ย้อนหลัง 1 วัน + ช่วงเช้า" ควรหมายถึง **ช่วงเช้าล่าสุดที่ผ่านมาแล้ว**
  // ไม่ใช่ช่วงเช้าที่ยังไม่เกิด · ไม่ทำกับวันที่ที่ผู้ใช้ระบุเอง เพราะระบุวันมาแล้ว
  // การเลื่อนวันให้เองคือการตอบคนละคำถามกับที่ถาม
  if (anchor == null && firstBase + mins.from * 3600e3 >= now) firstBase -= 864e5;
  for (let i = 0; i < days; i++) {
    const base = firstBase - i * 864e5;
    const start = base + mins.from * 3600e3;
    // to <= from = ข้ามเที่ยงคืน (กลางคืน 18→6 จบเช้าวันรุ่งขึ้น)
    const end = base + (mins.to <= mins.from ? 24 + mins.to : mins.to) * 3600e3;
    if (start >= now) continue;                   // ช่วงยังมาไม่ถึง (เหลือเฉพาะกรณีระบุวันที่)
    wins.push({ start, end: Math.min(end, now) });
  }
  // ⚠️ ห้าม fallback เป็นทั้งวันเด็ดขาด — ผู้ใช้ขอช่วงแคบแล้วได้ทั้งวันกลับไปคือ
  // การตอบคนละคำถามโดยไม่บอก · ว่างได้ แล้วให้ผู้เรียกบอกผู้ใช้ตรง ๆ
  return wins;
}


module.exports = function acuseekRoutes(app, pool, { auth }) {

  // ── เก็บ log คำค้นที่ผู้ใช้พิมพ์ (fire-and-forget, ไม่หยุดค้นแม้ log ล้ม) ──────
  function logQuery(text, prep, userEnglish, ok, reason, band, days, username) {
    pool.query(
      `INSERT INTO acuseek_queries (text, english, user_english, unknown, dropped, warn_ids, ok, reason, band, days, username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        text,
        prep.english || null,
        userEnglish || false,
        prep.unknown || [],
        JSON.stringify(prep.dropped || []),
        (prep.warnings || []).map((w) => w.id),
        ok,
        reason || null,
        band || null,
        days || null,
        username || null,
      ]
    ).catch((e) => console.error('[acuseek] เก็บ log คำค้นไม่สำเร็จ:', e.message));
  }

  /** ช่องที่ผู้ใช้คนนี้เห็นได้ — null = เห็นได้ทุกช่อง
   *  ⚠️ ต้องใช้ resolveSiteScope(req) เท่านั้น · makeScope() รับ (sites, cameras)
   *  ไม่ใช่ req — ส่ง req เข้าไปได้ scope ว่างเปล่าเงียบ ๆ แล้ว admin เห็น 0 กล้อง
   *  (พลาดมาแล้วตอน reproduce 2026-08-12) */
  async function allowedChannels(req) {
    const scope = auth.resolveSiteScope(req);
    const ids = await auth.scopedCameraIds(scope, pool);
    if (ids === null) return null;                       // ไม่จำกัด
    const m = await _mapCached(pool);
    const out = [];
    for (const [ch, info] of m.byChannel) if (info.camera_id && ids.has(info.camera_id)) out.push(ch);
    return out;
  }

  // GET /api/acuseek/vocab — ตารางคำต้องห้ามให้หน้าจอแสดง (ไม่ต้องแตะเครื่อง)
  app.get('/api/acuseek/vocab', async (req, res) => {
    res.json({ ok: true, blocked: phrase.blockedTable(),
      unsupported: phrase.UNSUPPORTED.map(({ id, th, why, proof }) => ({ id, th, why, proof })) });
  });

  // GET /api/acuseek/cameras — กล้องที่ค้นได้ (หลังกรองสิทธิ์แล้ว)
  app.get('/api/acuseek/cameras', async (req, res) => {
    try {
      const m = await _mapCached(pool);
      const allow = await allowedChannels(req);
      const only = allow === null ? null : new Set(allow);
      const list = [];
      for (const [ch, info] of m.byChannel) {
        if (only && !only.has(ch)) continue;
        list.push({ channel: ch, camera_id: info.camera_id, name: info.name, linked: !!info.camera_id });
      }
      list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
      res.json({ ok: true, cameras: list, total: m.byChannel.size, fetched_at: new Date(m.at).toISOString() });
    } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
  });

  // GET /api/acuseek/picture?u=… — ส่งต่อรูปผลลัพธ์ให้เบราว์เซอร์
  //
  // 🔒 รับเฉพาะรูปแบบเดียว: `http://10.0.10.x:6120/isapiHikStor?...` — URL เดินทางผ่าน
  // เบราว์เซอร์ ถ้าไม่จำกัดจะกลายเป็นช่องยิงเข้าเครือข่ายภายในผ่านเครื่องเรา (SSRF)
  // ตรวจซ้ำที่ edge อีกชั้นด้วย ไม่ปล่อยให้ที่นี่เป็นด่านเดียว
  //
  // แยกจาก /api/hcp/picture โดยตั้งใจ 2 เหตุผล: อันนั้นเป็น requireAdmin (แท็บนี้ต้อง
  // มอบให้ผู้ใช้ทั่วไปได้) และการใช้ route ร่วมกันจะทำให้สองแท็บกันสิทธิ์แยกกันไม่ได้
  const PIC_RE = /^http:\/\/10\.0\.10\.\d{1,3}:6120\/isapiHikStor\?[\w=&.%-]+$/;
  app.get('/api/acuseek/picture', async (req, res) => {
    const u = String(req.query.u || '');
    if (!PIC_RE.test(u)) return res.status(400).json({ error: 'url ไม่อยู่ในรูปแบบที่อนุญาต' });
    try {
      const e = await edgeCall('/hcp-picture', { url: u }, 30000);
      if (e.code !== 200) return res.status(502).json(e.body || { error: `edge HTTP ${e.code}` });
      const raw = Buffer.isBuffer(e.raw) ? e.raw : null;
      if (!raw) return res.status(502).json({ error: 'รูปเสียหายระหว่างทาง' });
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.type('jpeg').send(raw);
    } catch (err) { res.status(502).json({ error: err.message }); }
  });

  // ── GET /pub/seek/:blob — ภาพผลค้นหาสำหรับ LINE ────────────────────────
  //
  // ทำไมต้องมีเส้นนี้ (เจ้าของสั่งเปิด 2026-09-09): ภาพของ AcuSeek ไม่ใช่ไฟล์บนดิสก์
  // ของเรา จึงส่งผ่าน /pub/img/ (ซึ่งอ่านจาก SNAPSHOT_DIR) ไม่ได้ · และ LINE เป็นคนมา
  // ดึงภาพเอง โดยไม่มี session ของเรา จึงใช้ /api/acuseek/picture ก็ไม่ได้
  //
  // ด่านที่วางไว้ (ครบทุกชั้นเหมือน /pub/img + เพิ่มการปิดผนึก):
  //   1. ลายเซ็น HMAC + วันหมดอายุ ผูกกับ `seek:<blob>` — แก้ก้อนหรือยืดอายุเอง = ไม่ผ่าน
  //   2. URL ต้นทางถูก **ปิดผนึกด้วย AES-256-GCM** ไม่ใช่แค่ base64 — เพราะ URL นั้นมี
  //      `token=` ของเครื่องเก็บภาพอยู่ในตัว และข้อความ LINE ค้างอยู่ในเครื่องของทุกคนในห้อง
  //   3. เปิดผนึกแล้ว **ยังต้องผ่าน PIC_RE ซ้ำ** — ถ้ากุญแจหลุด ก็ยังยิงเข้าเครือข่ายภายใน
  //      ที่อื่นไม่ได้ (กัน SSRF) · edge ตรวจซ้ำอีกชั้นเหมือนเดิม
  //   4. ไม่มี session = ไม่มีสิทธิ์ของใครติดมา ⇒ ลิงก์นี้ **ถูก mint ตอนที่ตรวจสิทธิ์แล้ว**
  //      เท่านั้น (ตอนตอบคำสั่งในนามผู้ใช้จริง) และอายุสั้นตาม signed_image_expire_hours
  //      โมเดลความเสี่ยงเท่ากับ /pub/img/ ที่ใช้ส่งภาพแจ้งเตือนอยู่แล้วทุกวัน
  app.get('/pub/seek/:blob', async (req, res) => {
    const blob = String(req.params.blob || '');
    const v = signedImage.verifySignedRequest(blob, req.query.exp, req.query.sig, 'seek');
    if (!v.ok) return res.status(v.status).end();
    const u = signedImage.openUrl(blob);
    if (!u || !PIC_RE.test(u)) return res.status(400).end();
    try {
      const e = await edgeCall('/hcp-picture', { url: u }, 30000);
      const raw = e.code === 200 && Buffer.isBuffer(e.raw) ? e.raw : null;
      if (!raw) return res.status(502).end();
      // ภาพเดิมไม่มีวันเปลี่ยน แต่ลิงก์มีวันหมดอายุ ⇒ แคชได้สั้น ๆ ไม่ต้อง immutable
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.type('jpeg').send(raw);
    } catch { res.status(502).end(); }
  });

  const _rangeLabel = (r) =>
    `${String(Math.floor(r.fromMin / 60)).padStart(2, '0')}:${String(r.fromMin % 60).padStart(2, '0')}`
    + `–${String(Math.floor(r.toMin / 60)).padStart(2, '0')}:${String(r.toMin % 60).padStart(2, '0')}`;

  /** "14:00" → นาทีนับจากเที่ยงคืน · คืน null เมื่อรูปแบบไม่ถูก */
  const _hm = (v) => {
    const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    return (h < 24 && mi < 60) ? h * 60 + mi : null;
  };

  // POST /api/acuseek/search — รับข้อความไทย คืนรายการ taskID (หนึ่งอันต่อหนึ่งหน้าต่าง)
  // write-guard: ค้นหา (POST เพราะ body ใหญ่) ไม่ได้แก้ข้อมูล
  app.post('/api/acuseek/search', async (req, res) => {
    const b = req.body || {};
    const raw = String(b.text || '').slice(0, 200);
    // ผู้ใช้แก้ประโยคอังกฤษเองได้ (หน้าจอโชว์ให้เห็น) — ถ้าส่งมาก็ใช้อันนั้น
    // 🔴 ประโยคที่ผู้ใช้แก้เองต้องผ่านด่าน "เครื่องทำไม่ได้" เหมือนกัน — เดิมส่งแต่ `raw`
    // (ไทย) เข้าไปตรวจ ทำให้คนที่พิมพ์ `a person smoking a cigarette` ลงช่องอังกฤษตรง ๆ
    // ไม่เคยเห็นคำเตือนเลย แล้วได้ผลคะแนน 95 ที่ดูน่าเชื่อแต่ผิด
    const userEnglish = b.english ? String(b.english).slice(0, 384) : null;
    const prep = userEnglish
      ? { ok: true, english: userEnglish, blocked: [],
          warnings: phrase.findUnsupported(raw, userEnglish),
          // ผู้ใช้เขียนอังกฤษเอง = ไม่มีขั้นแปล จึงไม่มีคำตกและไม่มีคำที่ไม่รู้จัก
          time: phrase.parseTime(raw), unknown: [], dropped: [] }
      : phrase.prepare(raw);
    if (!prep.ok) {
      // เก็บ log ก่อนตอบ — เพราะ reason มีค่าแล้ว
      const reason = prep.reason === 'blocked' ? 'blocked' : 'unknown';
      logQuery(raw, prep, !!userEnglish, false, reason,
        b.band, b.days, req.user?.username || null);
      return res.status(400).json({ ok: false, ...prep });
    }

    // คำที่ผู้ใช้พิมพ์ชนะค่าจากฟอร์ม — พิมพ์ "เมื่อวานตอนบ่าย" แล้วต้องได้ตามนั้น
    const days = Math.max(1, Math.min(7, prep.time?.days ?? Number(b.days) ?? 1)) || 1;
    const band = prep.time?.band || (b.band && b.band !== 'all' ? b.band : null);
    // ลำดับสิทธิ์: ช่วงที่พิมพ์มาในข้อความ → ช่วงที่กรอกในฟอร์ม → ช่วงสำเร็จรูป
    const formFrom = _hm(b.from), formTo = _hm(b.to);
    const range = prep.time?.range
      || (formFrom != null && formTo != null && formFrom !== formTo
          ? { fromMin: formFrom, toMin: formTo } : null);
    const wins = buildWindows(days, band, range, prep.time?.date || null,
      prep.time?.dayOffset ?? null);
    // ช่วงที่ขอยังมาไม่ถึงทั้งหมด (เช่น ระบุวันที่ในอนาคต) — บอกตรง ๆ ดีกว่าค้นทั้งวัน
    if (!wins.length) {
      logQuery(raw, prep, !!userEnglish, false, 'futureWindow',
        band, days, req.user?.username || null);
      return res.json({ ok: false, reason: 'futureWindow', english: prep.english,
        warnings: prep.warnings, timeLabel: prep.time?.label || (range ? _rangeLabel(range) : null) });
    }
    const iso = (d) => new Date(d).toISOString().replace('Z', '+00:00');

    try {
      const allow = await allowedChannels(req);
      if (allow !== null && allow.length === 0) {
        logQuery(raw, prep, !!userEnglish, false, 'noCameras',
          band, days, req.user?.username || null);
        return res.json({ ok: false, reason: 'noCameras', english: prep.english, warnings: prep.warnings });
      }
      // ⚠️ `Number(undefined) ?? 80` = NaN — `??` จับแค่ null/undefined ไม่จับ NaN
      // ⇒ ผู้เรียกที่ไม่ส่ง similarity มาเคยได้ NaN ยิงไปถึงเครื่องค้น แล้วได้ผลตันเพดาน
      // (หน้าเว็บส่งมาตลอดจึงไม่เคยเจอ · เจอตอนต่อคำสั่งผ่าน LINE 2026-09-09)
      const simRaw = Number(b.similarity);
      const sim = Math.max(0, Math.min(100, Number.isFinite(simRaw) ? simRaw : 80));
      const subs = await Promise.all(wins.map((w) => edgeCall('/acuseek-search', {
        text: prep.english, startTime: iso(w.start), endTime: iso(w.end),
        similarity: sim, ...(allow ? { channelList: allow } : {}),
      }, 90000).catch((e) => ({ code: 0, body: { ok: false, error: e.message } }))));

      const tasks = [];
      let firstFail = null;
      subs.forEach((e, i) => {
        if (e.code === 200 && e.body?.taskID) tasks.push({ taskID: e.body.taskID, window: wins[i] });
        else if (!firstFail) firstFail = e.body || { error: `edge HTTP ${e.code}` };
      });
      if (!tasks.length) return res.status(502).json({ ok: false, ...(firstFail || {}) });

      // เก็บ log ค้นสำเร็จ
      logQuery(raw, prep, !!userEnglish, true, null,
        band, days, req.user?.username || null);

      res.json({ ok: true, taskIDs: tasks.map((t) => t.taskID), english: prep.english,
        warnings: prep.warnings,
        // 🔴 `unknown`/`dropped` เคยไม่ถูกส่งมาในทางที่ "ค้นสำเร็จ" เลย — ส่งเฉพาะตอน
        // ok=false ที่ spread prep ทั้งก้อน (บรรทัด ~241) ⇒ กล่องเตือน "ระบบยังไม่รู้จัก
        // คำว่า…" ใน page-smart-search.js เป็นโค้ดตายมาตลอดในทางที่มีผลลัพธ์ออกมาจริง
        // ซึ่งเป็นทางเดียวที่คำเตือนสำคัญ (คนกำลังอ่านผลที่ดูน่าเชื่ออยู่)
        // ⚠️ ห้ามตั้งชื่อว่า `dropped` — ฟิลด์นั้นมีเจ้าของแล้วในสายเดียวกัน
        // (`dropped_by_scope` จาก /status = จำนวนผลที่ถูกซ่อนเพราะสิทธิ์กล้อง)
        // หน้าจอเก็บสองอย่างนี้ไว้ในตัวแปรคนละตัว ถ้าชนกันหน้าผลลัพธ์พังทั้งหน้า
        unknown: prep.unknown || [],
        dropped_words: prep.dropped || [],
        // แยกให้ชัดว่าเวลานี้มาจากไหน — ป้ายบนจอเขียนคนละแบบ · บอกว่า "อ่านจากคำที่พิมพ์"
        // ทั้งที่ผู้ใช้กรอกฟอร์มเอง เป็นการบอกสิ่งที่ไม่จริงเรื่องเล็ก ๆ ที่ไม่ควรมี
        timeLabel: prep.time?.label || (range ? _rangeLabel(range) : null),
        date: prep.time?.date || null,
        timeSource: prep.time?.label ? 'typed' : (range ? 'form' : null),
        windows: tasks.map((t) => ({ start: iso(t.window.start), end: iso(t.window.end) })),
        partial: tasks.length < wins.length ? wins.length - tasks.length : 0 });
    } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
  });

  // POST /api/acuseek/status — ถามผลของทุกงาน · รวมให้เป็นชุดเดียว เรียงใหม่→เก่า
  // write-guard: ถามสถานะงานค้นหา ไม่ได้แก้ข้อมูล
  app.post('/api/acuseek/status', async (req, res) => {
    const b = req.body || {};
    const ids = Array.isArray(b.taskIDs) ? b.taskIDs : (b.taskID ? [b.taskID] : []);
    if (!ids.length) return res.status(400).json({ ok: false, error: 'ไม่มี taskID' });
    const per = Math.min(60, Number(b.maxResults) || 30);
    try {
      const rs = await Promise.all(ids.slice(0, 7).map((id) =>
        edgeCall('/acuseek-status', { taskID: String(id), position: 1, maxResults: per }, 90000)
          .catch((e) => ({ code: 0, body: { ok: false, error: e.message } }))));

      const bad = rs.find((e) => e.code !== 200 || !e.body?.ok);
      if (bad && rs.every((e) => e.code !== 200 || !e.body?.ok)) {
        return res.status(502).json({ ok: false, error: bad.body?.error || `edge HTTP ${bad.code}` });
      }
      const good = rs.filter((e) => e.code === 200 && e.body?.ok).map((e) => e.body);
      // ยังไม่เสร็จถ้ามีงานใดงานหนึ่งยังค้น — หน้าจอจะได้ไม่โชว์ผลไม่ครบ
      if (good.some((g) => g.runStatus === 'searching')) {
        const prog = Math.round(good.reduce((a, g) => a + (Number(g.progress) || 0), 0) / good.length);
        return res.json({ ok: true, runStatus: 'searching', progress: prog });
      }

      const m = await _mapCached(pool);
      const allow = await allowedChannels(req);
      const only = allow === null ? null : new Set(allow);

      let dropped = 0, total = 0, saturated = false;
      const results = [];
      for (const g of good) {
        total += Number(g.total) || 0;
        // อิ่มตัวแม้แต่งานเดียว = ยอดรวมเชื่อเป็นตัวเลขเป๊ะไม่ได้ ต้องบอกว่า "หรือมากกว่า"
        if (g.saturated) saturated = true;
        for (const r of g.results || []) {
          // กรองขารับด้วย ไม่พึ่ง channelList อย่างเดียว — งานเก่าที่ยิงไว้ก่อนสิทธิ์เปลี่ยน
          // ยังถูก poll ได้ด้วย taskID เดิม
          if (only && !only.has(Number(r.channelID))) { dropped++; continue; }
          const info = m.byChannel.get(Number(r.channelID)) || {};
          results.push({ ...r, camera_id: info.camera_id || null, camera_name: info.name || null });
        }
      }
      results.sort((a, b2) => String(b2.time || '').localeCompare(String(a.time || '')));
      res.json({ ok: true, runStatus: 'completed', progress: 100, total, saturated,
        results: results.slice(0, per), dropped_by_scope: dropped, windows: good.length });
    } catch (err) { res.status(502).json({ ok: false, error: err.message }); }
  });

  // GET /api/acuseek/queries — admin only, read summary of logged queries
  app.get('/api/acuseek/queries', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    try {
      // รวมคำที่แปลไม่ออก
      const unknownResult = await pool.query(
        `SELECT word, COUNT(*)::int AS n FROM acuseek_queries, LATERAL UNNEST(unknown) AS word
         WHERE word <> '' GROUP BY word ORDER BY n DESC, word LIMIT 100`);
      const unknownWords = unknownResult.rows;

      // รวมคำที่ "อ่านออกแต่ไม่ได้ใช้" — ตัวเลขที่จะใช้ตัดสินใจเรื่องตัวแปลภาษา
      // แยกจาก unknown เพราะสองอย่างนี้แก้คนละวิธี (เติมคำในตาราง vs แก้ตรรกะประกอบ)
      const droppedResult = await pool.query(
        `SELECT d->>'why' AS why, d->>'th' AS th, COUNT(*)::int AS n
           FROM acuseek_queries, LATERAL jsonb_array_elements(dropped) AS d
          GROUP BY 1, 2 ORDER BY n DESC, th LIMIT 100`);

      // ข้อมูล 50 ค้นล่าสุด
      const recentResult = await pool.query(
        `SELECT text, english, unknown, dropped, warn_ids, ok, reason, created_at
         FROM acuseek_queries ORDER BY created_at DESC LIMIT 50`);
      const recent = recentResult.rows.map((r) => ({
        ...r,
        created_at: r.created_at?.toISOString?.() || r.created_at,
      }));

      // ยอดรวม
      const totalResult = await pool.query('SELECT COUNT(*)::int AS cnt FROM acuseek_queries');
      const total = totalResult.rows[0]?.cnt || 0;

      res.json({ ok: true, total, unknown_words: unknownWords,
        dropped_words: droppedResult.rows, recent });
    } catch (err) {
      console.error('[acuseek] GET /api/acuseek/queries error:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });
};

// ส่งออกเพื่อให้เทสต์ตรึงเวลาแล้วตรวจหน้าต่างได้โดยไม่ต้องยกเซิร์ฟเวอร์
module.exports.buildWindows = buildWindows;
