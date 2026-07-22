// ============================================================
// Vigil Platform — Routes: LPR Watchlist
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const fs     = require('fs');
const path   = require('path');
const multer = require('multer');
const sharp  = require('sharp');

const VALID_MODES = new Set(['plate', 'plate_region']);

module.exports = function lprWatchlistRoutes(app, pool, { SNAPSHOT_DIR }) {
  // Reference images live in a snapshots subdir → auth-gated via /snapshots/ +
  // skipped by retention (it only scans top-level files). PDPA: plate = personal data.
  const refDir = path.join(SNAPSHOT_DIR, 'lpr-watchlist');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  // ── Groups ──────────────────────────────────────────────────────
  app.get('/api/lpr/watchlist/groups', async (req, res) => {
    try {
      const r = await pool.query('SELECT id, name, color FROM lpr_watchlist_groups ORDER BY created_at');
      res.json(r.rows);
    } catch (e) {
      console.error('[lpr-watchlist] GET groups:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/lpr/watchlist/groups', async (req, res) => {
    const { name, color } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const id = 'g' + Date.now().toString(36);
    try {
      const r = await pool.query(
        'INSERT INTO lpr_watchlist_groups (id, name, color) VALUES ($1,$2,$3) RETURNING id, name, color',
        [id, String(name).trim(), (color || '#5b8def').trim()]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) {
      console.error('[lpr-watchlist] POST groups:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // RF2 — rename / recolor a group (partial)
  app.patch('/api/lpr/watchlist/groups/:id', async (req, res) => {
    const { name, color } = req.body || {};
    const sets = [], vals = [];
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'name required' });
      vals.push(String(name).trim()); sets.push(`name = $${vals.length}`);
    }
    if (color !== undefined) { vals.push(String(color || '#5b8def').trim()); sets.push(`color = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    vals.push(req.params.id);
    try {
      const r = await pool.query(
        `UPDATE lpr_watchlist_groups SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, name, color`,
        vals
      );
      if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
      res.json(r.rows[0]);
    } catch (e) {
      console.error('[lpr-watchlist] PATCH groups:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.delete('/api/lpr/watchlist/groups/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM lpr_watchlist_groups WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[lpr-watchlist] DELETE groups:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── Reference image upload ──────────────────────────────────────
  // Returns { filename } to store in lpr_watchlist.ref_image. Magic-byte
  // validated (Content-Type is spoofable) — GOTCHAS #50-57 / SEC-005.
  app.post('/api/lpr/watchlist/image', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'image file required (field: "image")' });
    const buf = req.file.buffer;
    const isPng  = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    const isJpeg = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    const isWebP = buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    if (!isPng && !isJpeg && !isWebP) return res.status(415).json({ error: 'invalid image magic bytes' });
    try {
      fs.mkdirSync(refDir, { recursive: true });
      const outName = `wl_${Date.now()}.jpg`;
      await sharp(buf, { failOnError: false })
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(path.join(refDir, outName));
      res.json({ filename: `lpr-watchlist/${outName}` });
    } catch (e) {
      console.error('[lpr-watchlist] image upload:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── Entries ─────────────────────────────────────────────────────
  app.get('/api/lpr/watchlist', async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT plate_number, label, notes, active, created_at,
                group_id, alert_mode, region, ref_image, notify_line
           FROM lpr_watchlist ORDER BY created_at DESC`
      );
      res.json(r.rows);
    } catch (e) {
      console.error('[lpr-watchlist] GET:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/lpr/watchlist', async (req, res) => {
    const { plate_number, label, notes, group_id, alert_mode, region, ref_image, notify_line } = req.body || {};
    if (!plate_number || typeof plate_number !== 'string' || !plate_number.trim()) {
      return res.status(400).json({ error: 'plate_number required' });
    }
    const plate = plate_number.trim().toUpperCase();
    const mode  = VALID_MODES.has(alert_mode) ? alert_mode : 'plate';
    try {
      const r = await pool.query(
        `INSERT INTO lpr_watchlist
           (plate_number, label, notes, active, group_id, alert_mode, region, ref_image, notify_line)
         VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8)
         ON CONFLICT (plate_number) DO UPDATE
           SET label = EXCLUDED.label, notes = EXCLUDED.notes, active = TRUE,
               group_id = EXCLUDED.group_id, alert_mode = EXCLUDED.alert_mode,
               region = EXCLUDED.region, ref_image = EXCLUDED.ref_image,
               notify_line = EXCLUDED.notify_line
         RETURNING *`,
        [plate, (label || '').trim() || null, (notes || '').trim() || null,
         group_id || null, mode, (region || '').trim() || null,
         ref_image || null, notify_line !== false]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) {
      console.error('[lpr-watchlist] POST:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.patch('/api/lpr/watchlist/:plate', async (req, res) => {
    const plate = (req.params.plate || '').toUpperCase();
    const { active } = req.body || {};
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'active (boolean) required' });
    try {
      const r = await pool.query(
        'UPDATE lpr_watchlist SET active = $1 WHERE plate_number = $2 RETURNING *',
        [active, plate]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      res.json(r.rows[0]);
    } catch (e) {
      console.error('[lpr-watchlist] PATCH:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.delete('/api/lpr/watchlist/:plate', async (req, res) => {
    const plate = (req.params.plate || '').toUpperCase();
    try {
      await pool.query('DELETE FROM lpr_watchlist WHERE plate_number = $1', [plate]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[lpr-watchlist] DELETE:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });
};
