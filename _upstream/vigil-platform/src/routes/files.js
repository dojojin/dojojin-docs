// ============================================================
// Vigil Platform — Routes: Public File Host
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Admin-only file upload + management for sharing documents/images
// with customers via signed, expiring URLs. Files stored in files/;
// metadata in public_files table.
'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { sniffUploadType } = require('../helpers/uploadMagic');
const { sanitizeUploadedHtml } = require('../helpers/htmlSanitize');
const { signedImageUrl } = require('../helpers/signedImage');
const { getSystemSetting } = require('../helpers/getSystemSetting');
const routeError = require('../helpers/routeError');
const { uaInfo } = require('../helpers/uaInfo');
const filePreview = require('../helpers/filePreview');
const { assertImageBuffer } = require('../helpers/imageMagic');
const { normalizeTarget } = require('../helpers/externalLink');
const env = require('../config');

const FILES_DIR = path.join(__dirname, '..', '..', 'files');

// ลิงก์สั้น (migration 266): /pub/fil/<8 ตัว a-z0-9> บนโดเมนไฟล์ · Cloudflare ปล่อยเข้าเฉพาะ pub/fil/*
const CODE_ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHA[crypto.randomInt(CODE_ALPHA.length)]).join('');
const shortUrl = (code) => {
  const base = env.str('FILES_PUBLIC_URL') || env.str('DASHBOARD_PUBLIC_URL');
  return base && code ? `${base.replace(/\/+$/, '')}/pub/fil/${code}` : null;
};
async function createLink(pool, fileId, label, by) {
  for (let i = 0; i < 5; i++) {   // ชนกัน (36^8 ≈ 2.8 ล้านล้าน) แทบไม่มีทาง — ลองใหม่ไม่กี่ครั้งพอ
    try {
      const { rows } = await pool.query(
        `INSERT INTO public_file_links (code, file_id, label, created_by) VALUES ($1,$2,$3,$4)
         RETURNING id, code, label, created_by, created_at, revoked_at`,
        [newCode(), fileId, label || null, by || null]);
      return rows[0];
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  throw new Error('could not allocate a short code');
}

// ภาพพรีวิว HTML อัตโนมัติ — เขียนเป็น <stored>.og.png ข้างไฟล์จริง แล้วผูกที่ public_files.og_image
async function makeHtmlPreview(pool, row) {
  const png = await filePreview.screenshotHtml(path.join(FILES_DIR, row.stored_name), row.allow_scripts === true);
  const name = row.stored_name.replace(/\.html$/, '') + '.og.png';
  fs.writeFileSync(path.join(FILES_DIR, name), png);
  await pool.query('UPDATE public_files SET og_image = $2 WHERE id = $1', [row.id, name]);
  return name;
}

// วันหมดอายุของไฟล์/ลิงก์ใหม่ — ส่งมา 1–3650 วันใช้ตามนั้น · ไม่ส่ง = file_retention_days (ปริยาย 90)
async function expiryFrom(pool, days) {
  const n = Number(days);
  const d = Number.isFinite(n) && n >= 1 && n <= 3650 ? n
    : (Number(await getSystemSetting(pool, 'file_retention_days')) || 90);
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000);
}

// แถวลิงก์ภายนอก (migration 287) ไม่มีไฟล์บนดิสก์ — แทนที่/เวอร์ชัน/อัปภาพพรีวิว ใช้ไม่ได้
const LINK_ROW = { error: 'not available for external links' };

module.exports = function filesRoutes(app, pool, auth) {
  // Ensure FILES_DIR exists
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const audit = (req, action, details) => pool.query(
    `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
    [req.user?.id || null, req.user?.username || 'unknown', action, JSON.stringify(details)]).catch(() => {});

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
  });

  // POST /api/files — Admin upload a file
  // auth.requireAdmin ไม่ใช่การเช็ค req.user.role เองในตัว handler — สองวิธีนี้จะ
  // ค่อย ๆ เลื่อนออกจากกัน (คลาสบั๊ก "flag drift" ที่ audit SEC เจอซ้ำ) และวางไว้
  // หน้า multer ด้วย เพื่อให้คนที่ไม่ใช่แอดมินโดนปฏิเสธก่อนที่ 25MB จะถูกอ่านเข้า RAM
  // multer ส่ง LIMIT_FILE_SIZE เข้า next() เมื่อไฟล์เกินเพดาน ถ้าไม่ดักตรงนี้
  // error handler ปริยายของ Express จะตอบหน้า HTML 500 ไม่ใช่ JSON ที่หน้าเว็บอ่านออก
  const uploadOne = (req, res, next) => upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'ไฟล์ใหญ่เกิน 25 MB' });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });

  app.post('/api/files', auth.requireAdmin, uploadOne, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required (field name: "file")' });

    // busboy (ใต้ multer) ถอดชื่อไฟล์จาก multipart เป็น latin-1 ชื่อไทยที่เก็บลง DB
    // จึงกลายเป็น mojibake การดาวน์โหลด "ผ่าน" ได้เพราะเข้ารหัสกลับสมมาตร ความผิด
    // พลาดเลยไปโผล่ตอนอ่านรายการไฟล์แทน (ทำซ้ำแล้ว 2026-08-24)
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    try {
      // Sniff file type by magic bytes
      let fileType;
      try {
        fileType = sniffUploadType(req.file.buffer, originalName);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }

      // HTML is the one type here the browser renders and runs at our own
      // URL (see routes/media-files.js) — sniffUploadType only confirmed
      // "this looks like HTML", not "this is safe". Sanitize here, once, so
      // the sha256/bytes stored below describe what actually gets served —
      // never re-sanitize per request, and never serve the raw upload.
      //
      // ยกเว้นเมื่อแอดมินติ๊ก "อนุญาตให้รันสคริปต์" (migration 265, เจ้าของสั่ง 2026-10-17) — หน้าที่มี
      // ฟังก์ชันต้องเก็บสคริปต์ไว้ · การกันย้ายไปอยู่ที่ CSP ตอนเสิร์ฟ (sandbox allow-scripts แต่ไม่มี
      // allow-same-origin · connect-src/form-action 'none') ดู routes/media-files.js · ใช้ได้กับ HTML เท่านั้น
      const allowScripts = fileType.ext === 'html' && ['true', '1', 'on'].includes(String(req.body.allow_scripts || ''));
      const storedBuffer = fileType.ext === 'html' && !allowScripts
        ? Buffer.from(sanitizeUploadedHtml(req.file.buffer), 'utf8')
        : req.file.buffer;

      // Generate unique stored name (UUID + extension, never from upload filename)
      const storedName = `${crypto.randomUUID()}.${fileType.ext}`;
      const filePath = path.join(FILES_DIR, storedName);

      // Verify stored path doesn't escape FILES_DIR (path traversal protection)
      if (!filePath.startsWith(FILES_DIR)) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Calculate SHA256 — of storedBuffer (the sanitized bytes for HTML),
      // not the raw upload, so this hash always matches what's on disk
      const sha256 = crypto.createHash('sha256').update(storedBuffer).digest('hex');

      // Determine expiry from request or system setting
      const expiresAt = await expiryFrom(pool, req.body.expires_days);

      // Write file to disk
      fs.writeFileSync(filePath, storedBuffer);

      // Insert into database
      const result = await pool.query(
        `INSERT INTO public_files
         (stored_name, original_name, mime, bytes, sha256, uploaded_by, expires_at, note, allow_scripts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, stored_name, original_name, mime, bytes, sha256, uploaded_at, expires_at, allow_scripts`,
        [
          storedName,
          originalName,
          fileType.mime,
          storedBuffer.length,
          sha256,
          req.user?.username || 'admin',
          expiresAt,
          req.body.note || null,
          allowScripts
        ]
      );

      const row = result.rows[0];
      const link = await createLink(pool, row.id, null, req.user?.username || 'admin');
      // HTML → ถ่ายภาพพรีวิวเบื้องหลัง (~2–5 วิ) ไม่ให้การอัปรอ · ล้ม = ไม่มีภาพ แอดมินกดสร้างใหม่/อัปเองได้
      if (row.mime === 'text/html') {
        makeHtmlPreview(pool, { id: row.id, stored_name: row.stored_name, allow_scripts: row.allow_scripts })
          .catch((e) => console.warn('[files] auto preview:', e.message));
      }

      // Audit log
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [
          req.user?.id || null,
          req.user?.username || 'unknown',
          'public_file_uploaded',
          JSON.stringify({
            file_id: row.id,
            original_name: row.original_name,
            mime: row.mime,
            bytes: row.bytes,
            expires_at: row.expires_at,
            allow_scripts: row.allow_scripts
          })
        ]
      ).catch(() => {});

      // Generate signed URL with TTL until expiry
      const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      const signedUrl = signedImageUrl(storedName, ttlSeconds, 'fil');

      res.json({
        ok: true,
        file: {
          id: row.id,
          stored_name: row.stored_name,
          original_name: row.original_name,
          mime: row.mime,
          bytes: row.bytes,
          sha256: row.sha256,
          uploaded_at: row.uploaded_at,
          expires_at: row.expires_at,
          allow_scripts: row.allow_scripts
        },
        url: signedUrl,
        short_url: shortUrl(link.code)
      });
    } catch (err) {
      routeError(res, err, 'POST /api/files');
    }
  });

  // POST /api/files/link — ลิงก์สั้นไปไฟล์ภายนอก (Google Drive / OneDrive · migration 287) { url, name?, note?, expiry_days? }
  // ไม่มีไฟล์บนดิสก์ · ลิงก์สั้น/บันทึกการกด/วันหมดอายุ/ลิงก์ต่อผู้รับ ใช้กลไกเดียวกับไฟล์อัปโหลด
  app.post('/api/files/link', auth.requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const t = normalizeTarget(b.url);
      if (!t.ok) return res.status(400).json({ error: t.error });
      const u = new URL(t.url);
      const tail = u.pathname.split('/').filter((s) => s && !/^(view|edit|preview)$/.test(s)).pop();
      const name = String(b.name || '').trim().slice(0, 200) || `${t.host}${tail ? '/' + tail : ''}`.slice(0, 200);
      const by = req.user?.username || 'admin';
      const expiresAt = await expiryFrom(pool, b.expiry_days ?? b.expires_days);
      const { rows } = await pool.query(
        `INSERT INTO public_files (target_url, original_name, uploaded_by, expires_at, note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, target_url, original_name, mime, bytes, uploaded_at, expires_at`,
        [t.url, name, by, expiresAt, String(b.note || '').trim().slice(0, 500) || null]);
      const row = rows[0];
      const link = await createLink(pool, row.id, null, by);
      await audit(req, 'public_file_link_target_created', { file_id: row.id, original_name: row.original_name, target_url: row.target_url, expires_at: row.expires_at });
      res.json({ ok: true, file: { ...row, kind: 'link', provider: t.provider }, url: null, short_url: shortUrl(link.code) });
    } catch (err) { routeError(res, err, 'POST /api/files/link'); }
  });

  // PATCH /api/files/:id/target — เปลี่ยนปลายทางของลิงก์ภายนอก (ตรวจ allowlist ใหม่ · ลิงก์สั้นเดิมไปที่ใหม่ทันที)
  app.patch('/api/files/:id/target', auth.requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
      const t = normalizeTarget((req.body || {}).url);
      if (!t.ok) return res.status(400).json({ error: t.error });
      const { rows } = await pool.query(
        `UPDATE public_files f SET target_url = $2 FROM (SELECT target_url FROM public_files WHERE id = $1) old
          WHERE f.id = $1 AND f.target_url IS NOT NULL AND f.revoked_at IS NULL
          RETURNING f.target_url, old.target_url AS before`, [id, t.url]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      await audit(req, 'public_file_target_changed', { file_id: id, before: rows[0].before, after: rows[0].target_url });
      res.json({ ok: true, target_url: rows[0].target_url, provider: t.provider });
    } catch (err) { routeError(res, err, 'PATCH /api/files/:id/target'); }
  });

  // GET /api/files — Admin list all files (with fresh signed URLs)
  // requireAdmin ไม่ใช่แค่ session — requireAdminForWrites กันเฉพาะ non-GET
  // ถ้าไม่ใส่ตรงนี้ ผู้ใช้ทั่วไปที่ล็อกอินแล้วจะอ่านรายชื่อไฟล์ ชื่อไฟล์เดิม และ note ได้หมด
  app.get('/api/files', auth.requireAdmin, async (req, res) => {

    try {
      const result = await pool.query(
        `SELECT id, stored_name, original_name, mime, bytes, sha256, uploaded_by,
                uploaded_at, expires_at, revoked_at, note, allow_scripts, version, target_url,
                (SELECT l.code FROM public_file_links l WHERE l.file_id = f.id AND l.revoked_at IS NULL
                  ORDER BY l.id LIMIT 1) AS short_code,
                (SELECT count(*) FROM public_file_clicks c WHERE c.file_id = f.id AND c.status = 200)::int AS clicks,
                (SELECT max(clicked_at) FROM public_file_clicks c WHERE c.file_id = f.id) AS last_click_at
         FROM public_files f
         ORDER BY uploaded_at DESC`,
        []
      );

      const files = result.rows.map(row => {
        // Generate fresh signed URL if not revoked and not expired
        let url = null;
        if (!row.target_url && !row.revoked_at && row.expires_at && row.expires_at > new Date()) {
          const ttlSeconds = Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000);
          url = signedImageUrl(row.stored_name, ttlSeconds, 'fil');
        }

        return {
          id: row.id,
          stored_name: row.stored_name,
          original_name: row.original_name,
          mime: row.mime,
          bytes: row.bytes,
          sha256: row.sha256,
          uploaded_by: row.uploaded_by,
          uploaded_at: row.uploaded_at,
          expires_at: row.expires_at,
          revoked_at: row.revoked_at,
          note: row.note,
          allow_scripts: row.allow_scripts,
          version: row.version,
          kind: row.target_url ? 'link' : 'file',
          target_url: row.target_url,
          short_url: (!row.revoked_at && row.expires_at > new Date()) ? shortUrl(row.short_code) : null,
          clicks: row.clicks,
          last_click_at: row.last_click_at,
          url
        };
      });

      res.json({ ok: true, files });
    } catch (err) {
      routeError(res, err, 'GET /api/files');
    }
  });

  // GET /api/files/:id/clicks — รายละเอียดการกดเปิดรายไฟล์ (admin เท่านั้น: IP + UA = ข้อมูลส่วนบุคคล)
  // requireAdmin ต้องใส่เอง — requireAdminForWrites กันแค่ non-GET
  // แยกโปรแกรม/เบราว์เซอร์/OS ตอนอ่านจาก UA ดิบ (helpers/uaInfo.js) · ตัดตัวดึงพรีวิว/บอทออกจากยอด แต่ยังแสดงแยก
  app.get('/api/files/:id/clicks', auth.requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
      const f = await pool.query(
        `SELECT id, original_name, mime, bytes, uploaded_by, uploaded_at, expires_at, revoked_at, note, allow_scripts, version,
                target_url, og_title, og_description, (og_image IS NOT NULL) AS has_preview
           FROM public_files WHERE id = $1`, [id]);
      if (!f.rows[0]) return res.status(404).json({ error: 'not found' });
      const links = (await pool.query(
        `SELECT l.id, l.code, l.label, l.created_by, l.created_at, l.revoked_at,
                count(c.id) FILTER (WHERE c.status = 200)::int AS clicks, max(c.clicked_at) AS last_click_at
           FROM public_file_links l LEFT JOIN public_file_clicks c ON c.link_id = l.id
          WHERE l.file_id = $1 GROUP BY l.id ORDER BY l.id`, [id])).rows
        .map((l) => ({ ...l, short_url: shortUrl(l.code) }));
      const { rows } = await pool.query(
        `SELECT c.id, c.clicked_at, c.via, c.status, c.ip, c.country, c.user_agent, c.referer, c.link_id, l.label AS link_label
           FROM public_file_clicks c LEFT JOIN public_file_links l ON l.id = c.link_id
          WHERE c.file_id = $1 ORDER BY c.clicked_at DESC LIMIT 5000`, [id]);
      const clicks = rows.map((r) => ({ ...r, ...uaInfo(r.user_agent) }));
      const human = clicks.filter((c) => !c.bot && c.status === 200);
      const tally = (key) => Object.entries(human.reduce((m, c) => { const k = c[key] || 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {}))
        .sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
      const days = {};
      for (const c of human) {
        const d = new Date(c.clicked_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
        days[d] = (days[d] || 0) + 1;
      }
      const versions = (await pool.query(
        `SELECT version, bytes, replaced_by, replaced_at FROM public_file_versions WHERE file_id = $1 ORDER BY version DESC`, [id])).rows;
      res.json({
        file: f.rows[0],
        links,
        versions,
        summary: {
          opens: human.length,
          visitors: new Set(human.map((c) => `${c.ip}|${c.user_agent}`)).size,
          bots: clicks.filter((c) => c.bot).length,
          gone: clicks.filter((c) => c.status === 410).length,
          first_at: human.length ? human[human.length - 1].clicked_at : null,
          last_at: human.length ? human[0].clicked_at : null,
        },
        by_app: tally('app'), by_browser: tally('browser'), by_os: tally('os'), by_device: tally('device'),
        by_country: tally('country'),
        per_day: Object.entries(days).sort().map(([day, n]) => ({ day, n })),
        recent: clicks.slice(0, 200),
        capped: rows.length >= 5000,
      });
    } catch (err) { routeError(res, err, 'GET /api/files/:id/clicks'); }
  });

  // PATCH /api/files/:id/meta — ชื่อ/คำอธิบายที่จะขึ้นในพรีวิวตอนโพสต์ลง Social (ว่าง = ใช้ชื่อไฟล์/หมายเหตุ)
  app.patch('/api/files/:id/meta', auth.requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
      const b = req.body || {};
      const t = 'og_title' in b ? (String(b.og_title || '').trim().slice(0, 200) || null) : undefined;
      const d = 'og_description' in b ? (String(b.og_description || '').trim().slice(0, 500) || null) : undefined;
      const { rows } = await pool.query(
        `UPDATE public_files SET og_title = CASE WHEN $2 THEN $3 ELSE og_title END,
                                 og_description = CASE WHEN $4 THEN $5 ELSE og_description END
          WHERE id = $1 RETURNING id, og_title, og_description`, [id, t !== undefined, t ?? null, d !== undefined, d ?? null]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true, ...rows[0] });
    } catch (err) { routeError(res, err, 'PATCH /api/files/:id/meta'); }
  });

  // POST /api/files/:id/preview — อัปภาพพรีวิวเอง (PNG/JPG/WebP) → ครอปเป็น 1200×630
  // POST /api/files/:id/preview?auto=1 — ถ่ายใหม่จากหน้า HTML (เฉพาะไฟล์ HTML)
  const previewUpload = (req, res, next) => (req.query.auto === '1' ? next() : uploadOne(req, res, next));
  app.post('/api/files/:id/preview', auth.requireAdmin, previewUpload, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
      const { rows } = await pool.query(
        'SELECT id, stored_name, mime, allow_scripts, og_image FROM public_files WHERE id = $1 AND revoked_at IS NULL', [id]);
      const row = rows[0];
      if (!row) return res.status(404).json({ error: 'not found' });
      if (!row.stored_name) return res.status(400).json(LINK_ROW);
      let name;
      if (req.query.auto === '1') {
        if (row.mime !== 'text/html') return res.status(400).json({ error: 'auto preview is for HTML files only' });
        name = await makeHtmlPreview(pool, row);
      } else {
        if (!req.file) return res.status(400).json({ error: 'image required (field name: "file")' });
        try { assertImageBuffer(req.file.buffer); } catch (e) { return res.status(400).json({ error: e.message }); }
        const png = await filePreview.normalizeImage(req.file.buffer);
        name = row.stored_name.replace(/\.[a-z]+$/, '') + '.og.png';
        fs.writeFileSync(path.join(FILES_DIR, name), png);
        await pool.query('UPDATE public_files SET og_image = $2 WHERE id = $1', [id, name]);
      }
      res.json({ ok: true, og_image: name });
    } catch (err) { routeError(res, err, 'POST /api/files/:id/preview'); }
  });

  // GET /api/files/:id/preview.png — ให้หน้าแดชบอร์ดแสดงภาพพรีวิว (ผ่าน session ของแอดมิน)
  app.get('/api/files/:id/preview.png', auth.requireAdmin, async (req, res) => {
    const { rows } = await pool.query('SELECT og_image FROM public_files WHERE id = $1', [Number(req.params.id) || 0]);
    const f = rows[0]?.og_image && path.join(FILES_DIR, rows[0].og_image);
    if (!f || !f.startsWith(FILES_DIR) || !fs.existsSync(f)) return res.status(404).end();
    res.setHeader('Cache-Control', 'private, no-cache');
    res.type('png').send(fs.readFileSync(f));
  });

  // ── แทนที่เนื้อหา (migration 267) ─────────────────────────────────────
  // stored_name ไม่เปลี่ยน ⇒ ลิงก์สั้นทุกอัน + ลิงก์ลงชื่อเดิมได้เนื้อหาใหม่ทันที (เสิร์ฟ private, no-cache)
  // เนื้อหาเดิมย้ายไป <uuid>.v<N>.<ext> ไว้ย้อนคืน · version+1 แบบ atomic ใน UPDATE กันสองคนแทนที่พร้อมกันชนเลข
  const KEEP_VERSIONS = 10;   // ponytail: นับตามจำนวน ไม่ใช่ขนาด — 25 MB × 10 = เพดาน 250 MB ต่อไฟล์
  const archName = (stored, v) => stored.replace(/\.([a-z]+)$/, `.v${v}.$1`);
  async function swapContent(id, buffer, allowScripts, by) {
    const { rows } = await pool.query(
      `UPDATE public_files SET version = version + 1 WHERE id = $1 AND revoked_at IS NULL AND stored_name IS NOT NULL
       RETURNING id, stored_name, mime, bytes, sha256, allow_scripts, version - 1 AS old_version`, [id]);
    const cur = rows[0];
    if (!cur) return null;
    const live = path.join(FILES_DIR, cur.stored_name);
    const arch = archName(cur.stored_name, cur.old_version);
    // เขียนไฟล์ใหม่ลง .tmp ก่อนแล้ว rename — คนที่กำลังเปิดอยู่ไม่มีวันได้ไฟล์ครึ่ง ๆ
    fs.writeFileSync(live + '.tmp', buffer);
    fs.copyFileSync(live, path.join(FILES_DIR, arch));
    fs.renameSync(live + '.tmp', live);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    await pool.query(
      `INSERT INTO public_file_versions (file_id, version, stored_name, bytes, sha256, allow_scripts, replaced_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, cur.old_version, arch, cur.bytes, cur.sha256, cur.allow_scripts, by]);
    await pool.query('UPDATE public_files SET bytes = $2, sha256 = $3, allow_scripts = $4 WHERE id = $1',
      [id, buffer.length, sha256, allowScripts]);
    const old = (await pool.query(
      `DELETE FROM public_file_versions WHERE file_id = $1 AND id NOT IN
         (SELECT id FROM public_file_versions WHERE file_id = $1 ORDER BY version DESC LIMIT ${KEEP_VERSIONS})
       RETURNING stored_name`, [id])).rows;
    for (const o of old) fs.rm(path.join(FILES_DIR, o.stored_name), { force: true }, () => {});
    return { ...cur, version: cur.old_version + 1, bytes: buffer.length, sha256, allow_scripts: allowScripts };
  }

  // POST /api/files/:id/replace — อัปเวอร์ชันใหม่ทับ (ชนิดไฟล์ต้องเหมือนเดิม เพราะนามสกุลอยู่ในลิงก์)
  // allow_scripts ไม่ส่ง = คงค่าเดิม · refresh_preview=1 = ถ่ายภาพพรีวิว HTML ใหม่ (ไม่ส่ง = ไม่ทับภาพที่อัปเอง)
  app.post('/api/files/:id/replace', auth.requireAdmin, uploadOne, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
      if (!req.file) return res.status(400).json({ error: 'file required (field name: "file")' });
      const { rows } = await pool.query(
        'SELECT stored_name, mime, sha256, allow_scripts FROM public_files WHERE id = $1 AND revoked_at IS NULL', [id]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      if (!rows[0].stored_name) return res.status(400).json(LINK_ROW);
      const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      let type;
      try { type = sniffUploadType(req.file.buffer, name); } catch (e) { return res.status(400).json({ error: e.message }); }
      if (type.mime !== rows[0].mime) return res.status(400).json({ error: `ต้องเป็นไฟล์ชนิดเดิม (${rows[0].mime})` });
      const allowScripts = type.ext === 'html' && ('allow_scripts' in (req.body || {})
        ? ['true', '1', 'on'].includes(String(req.body.allow_scripts)) : rows[0].allow_scripts === true);
      const buf = type.ext === 'html' && !allowScripts ? Buffer.from(sanitizeUploadedHtml(req.file.buffer), 'utf8') : req.file.buffer;
      const r = await swapContent(id, buf, allowScripts, req.user?.username || 'admin');
      if (!r) return res.status(404).json({ error: 'not found' });
      if (r.mime === 'text/html' && ['true', '1', 'on'].includes(String(req.body.refresh_preview || ''))) {
        makeHtmlPreview(pool, r).catch((e) => console.warn('[files] replace preview:', e.message));
      }
      await audit(req, 'public_file_replaced', { file_id: id, uploaded_name: name, version: r.version,
        before: { sha256: rows[0].sha256, allow_scripts: rows[0].allow_scripts }, after: { bytes: r.bytes, sha256: r.sha256, allow_scripts: r.allow_scripts } });
      res.json({ ok: true, version: r.version, bytes: r.bytes, sha256: r.sha256 });
    } catch (err) { routeError(res, err, 'POST /api/files/:id/replace'); }
  });

  // POST /api/files/:id/versions/:v/restore — ย้อนกลับไปเวอร์ชันเก่า (เนื้อหาปัจจุบันถูกเก็บเป็นเวอร์ชันใหม่ ย้อนกลับมาได้อีก)
  app.post('/api/files/:id/versions/:v/restore', auth.requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id), v = Number(req.params.v);
      if (!Number.isInteger(id) || !Number.isInteger(v)) return res.status(400).json({ error: 'invalid id' });
      const cur = (await pool.query('SELECT stored_name FROM public_files WHERE id = $1', [id])).rows[0];
      if (cur && !cur.stored_name) return res.status(400).json(LINK_ROW);
      const { rows } = await pool.query(
        'SELECT stored_name, allow_scripts FROM public_file_versions WHERE file_id = $1 AND version = $2', [id, v]);
      const p = rows[0] && path.join(FILES_DIR, rows[0].stored_name);
      if (!p || !p.startsWith(FILES_DIR) || !fs.existsSync(p)) return res.status(404).json({ error: 'version not found' });
      const r = await swapContent(id, fs.readFileSync(p), rows[0].allow_scripts, req.user?.username || 'admin');
      if (!r) return res.status(404).json({ error: 'not found' });
      await audit(req, 'public_file_version_restored', { file_id: id, restored_version: v, now_version: r.version });
      res.json({ ok: true, version: r.version });
    } catch (err) { routeError(res, err, 'POST /api/files/:id/versions/:v/restore'); }
  });

  // PATCH /api/files/:id/expiry — แก้วันหมดอายุทีหลัง { expires_at: ISO } · ต้องเป็นอนาคต ไม่เกิน 10 ปี
  // ใช้ได้กับไฟล์ที่ยังไม่ถูกเพิกถอน — ไฟล์ที่หมดอายุแล้วแต่งานกวาด (jobs/retention.js) ยังไม่มาลบ ต่ออายุได้
  // ลิงก์สั้นตามวันใหม่ทันที · ลิงก์ลงชื่อแบบยาวที่แจกไปแล้วมีวันหมดอายุของตัวเองฝังอยู่ (exp=) ไม่ยืดตาม
  app.patch('/api/files/:id/expiry', auth.requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const at = new Date((req.body || {}).expires_at);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
      if (isNaN(at) || at <= new Date() || at > new Date(Date.now() + 3650 * 86400000)) {
        return res.status(400).json({ error: 'expires_at ต้องเป็นวันในอนาคต ไม่เกิน 10 ปี' });
      }
      const { rows } = await pool.query(
        `UPDATE public_files f SET expires_at = $2 FROM (SELECT expires_at FROM public_files WHERE id = $1) old
          WHERE f.id = $1 AND f.revoked_at IS NULL RETURNING f.expires_at, old.expires_at AS before`, [id, at]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      await audit(req, 'public_file_expiry_changed', { file_id: id, before: rows[0].before, after: rows[0].expires_at });
      res.json({ ok: true, expires_at: rows[0].expires_at });
    } catch (err) { routeError(res, err, 'PATCH /api/files/:id/expiry'); }
  });

  // POST /api/files/:id/links — ลิงก์แยกต่อผู้รับ (ทางเดียวที่รู้ได้จริงว่า "ใคร" เปิด)
  app.post('/api/files/:id/links', auth.requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const label = String((req.body || {}).label || '').trim().slice(0, 120);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
      if (!label) return res.status(400).json({ error: 'label required' });
      const f = await pool.query('SELECT 1 FROM public_files WHERE id = $1 AND revoked_at IS NULL', [id]);
      if (!f.rowCount) return res.status(404).json({ error: 'not found' });
      const link = await createLink(pool, id, label, req.user?.username || 'admin');
      await pool.query(`INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown', 'public_file_link_created',
         JSON.stringify({ file_id: id, link_id: link.id, label })]).catch(() => {});
      res.json({ ok: true, link: { ...link, short_url: shortUrl(link.code) } });
    } catch (err) { routeError(res, err, 'POST /api/files/:id/links'); }
  });

  // DELETE /api/files/links/:linkId — ปิดลิงก์เดียว (ไฟล์และลิงก์อื่นยังใช้ได้)
  app.delete('/api/files/links/:linkId', auth.requireAdmin, async (req, res) => {
    try {
      const linkId = Number(req.params.linkId);
      if (!Number.isInteger(linkId)) return res.status(400).json({ error: 'invalid id' });
      const { rows } = await pool.query(
        `UPDATE public_file_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id, file_id, label`, [linkId]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      await pool.query(`INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown', 'public_file_link_revoked', JSON.stringify(rows[0])]).catch(() => {});
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/files/links/:linkId'); }
  });

  // DELETE /api/files/:id — Admin revoke a file
  app.delete('/api/files/:id', auth.requireAdmin, async (req, res) => {

    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

      const result = await pool.query(
        `UPDATE public_files
         SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING id, stored_name, original_name, og_image`,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: 'file not found or already revoked' });
      }

      const row = result.rows[0];

      // ภาพพรีวิวลบตามไฟล์ (ลิงก์สั้นทุกอันของไฟล์นี้ตอบ 410 จาก revoked_at ของไฟล์อยู่แล้ว)
      if (row.og_image) { const p = path.join(FILES_DIR, row.og_image); if (p.startsWith(FILES_DIR)) fs.rm(p, { force: true }, () => {}); }

      // สำเนาเวอร์ชันเก่า (migration 267) ลบตาม — แถวยังอยู่เพื่อ audit
      const { rows: vers } = await pool.query('SELECT stored_name FROM public_file_versions WHERE file_id = $1', [id]);
      for (const v of vers) fs.rm(path.join(FILES_DIR, v.stored_name), { force: true }, () => {});

      // Try to unlink the file from disk (ignore if not found) · แถวลิงก์ภายนอกไม่มีไฟล์
      const filePath = row.stored_name ? path.join(FILES_DIR, row.stored_name) : null;
      try {
        if (filePath && filePath.startsWith(FILES_DIR)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        if (e.code !== 'ENOENT') {
          console.warn(`[files] unlink ${filePath}:`, e.message);
        }
      }

      // Audit log
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [
          req.user?.id || null,
          req.user?.username || 'unknown',
          'public_file_revoked',
          JSON.stringify({
            file_id: row.id,
            original_name: row.original_name,
            stored_name: row.stored_name
          })
        ]
      ).catch(() => {});

      res.json({ ok: true });
    } catch (err) {
      routeError(res, err, 'DELETE /api/files/:id');
    }
  });
};
