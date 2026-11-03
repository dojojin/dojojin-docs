// ============================================================
// Vigil Platform — Routes: Branding (white-label)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const path   = require('path');
const multer = require('multer');
const sharp  = require('sharp');
const routeError = require('../helpers/routeError');
const { assertImageBuffer } = require('../helpers/imageMagic');
const { getSystemSettings, invalidateSystemSetting } = require('../helpers/getSystemSetting');

module.exports = function brandingRoutes(app, pool, brandingDir) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  // GET /api/branding — public (login + disclaimer pages call this without auth)
  app.get('/api/branding', async (req, res) => {
    try {
      const m = await getSystemSettings(pool, ['brand_name', 'brand_tagline', 'brand_logo_path', 'brand_footer_logo_path', 'brand_primary_color']);
      const logoPath = (m.brand_logo_path || '').trim();
      const footerPath = (m.brand_footer_logo_path || '').trim();
      res.json({
        name:          m.brand_name    || 'Vigil Platform',
        tagline:       m.brand_tagline || '',
        logo_url:      logoPath ? `/branding/${logoPath}` : null,
        footer_logo_url: footerPath ? `/branding/${footerPath}` : null,
        primary_color: m.brand_primary_color || '#5b8def',
      });
    } catch (err) { routeError(res, err, 'GET /api/branding'); }
  });

  // POST /api/branding/logo — admin only, multipart "logo"
  // Resizes to 256×256 (fit:'inside', PNG with alpha) and saves to branding/logo.png
  app.post('/api/branding/logo', upload.single('logo'), async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    if (!req.file) return res.status(400).json({ error: 'logo file required (field name: "logo")' });
    // SEC-005: SVG ถูกตัดออก — librsvg (ใช้ใน sharp) มี CVE history (XXE, infinite loop)
    // ใช้ magic bytes แทน MIME เพราะ Content-Type มาจาก client (spoofable) —
    // ด่านจริงอยู่ใน helpers/imageMagic.js (ที่เดียวกับ upload gate อื่นทุกตัว)
    // MIME ที่เช็คก่อนเป็นแค่ด่านหยาบ ไม่ได้ใช้ตัดสินใจแทน magic bytes
    const mime = (req.file.mimetype || '').toLowerCase();
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(mime)) {
      return res.status(415).json({ error: 'unsupported image type' });
    }
    try { assertImageBuffer(req.file.buffer); }
    catch (e) { return res.status(415).json({ error: e.message }); }
    try {
      const outFile = 'logo.png';
      const outPath = path.join(brandingDir, outFile);
      await sharp(req.file.buffer, { failOn: 'none' })
        .resize(256, 256, { fit: 'inside', withoutEnlargement: false })
        .png({ compressionLevel: 9 })
        .toFile(outPath);
      // Update setting (cache-bust handled client-side via timestamp query string)
      await pool.query(
        `UPDATE system_settings SET value = $1 WHERE key = 'brand_logo_path'`,
        [outFile]
      );
      invalidateSystemSetting('brand_logo_path');
      res.json({ ok: true, logo_url: `/branding/${outFile}?v=${Date.now()}` });
    } catch (err) {
      console.error('logo upload:', err);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  // DELETE /api/branding/logo — clear logo (revert to default)
  app.delete('/api/branding/logo', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    try {
      await pool.query(`UPDATE system_settings SET value = '' WHERE key = 'brand_logo_path'`);
      invalidateSystemSetting('brand_logo_path');
      // We keep the file on disk in case someone wants to undo manually; harmless.
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/branding/logo'); }
  });

  // POST /api/branding/footer-logo — admin only, multipart "footer_logo"
  // Resizes to 480px wide (keep aspect ratio, PNG with alpha) and saves to branding/logo-footer.png
  app.post('/api/branding/footer-logo', upload.single('footer_logo'), async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    if (!req.file) return res.status(400).json({ error: 'footer_logo file required (field name: "footer_logo")' });
    const mime = (req.file.mimetype || '').toLowerCase();
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(mime)) {
      return res.status(415).json({ error: 'unsupported image type' });
    }
    try { assertImageBuffer(req.file.buffer); }
    catch (e) { return res.status(415).json({ error: e.message }); }
    try {
      const outFile = 'logo-footer.png';
      const outPath = path.join(brandingDir, outFile);
      await sharp(req.file.buffer, { failOn: 'none' })
        .resize({ width: 480, withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toFile(outPath);
      // Update setting
      await pool.query(
        `UPDATE system_settings SET value = $1 WHERE key = 'brand_footer_logo_path'`,
        [outFile]
      );
      invalidateSystemSetting('brand_footer_logo_path');
      res.json({ ok: true, footer_logo_url: `/branding/${outFile}?v=${Date.now()}` });
    } catch (err) {
      console.error('footer logo upload:', err);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  // DELETE /api/branding/footer-logo — clear footer logo
  app.delete('/api/branding/footer-logo', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    try {
      await pool.query(`UPDATE system_settings SET value = '' WHERE key = 'brand_footer_logo_path'`);
      invalidateSystemSetting('brand_footer_logo_path');
      // We keep the file on disk in case someone wants to undo manually; harmless.
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/branding/footer-logo'); }
  });
};
