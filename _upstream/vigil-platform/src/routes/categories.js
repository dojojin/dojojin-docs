// ============================================================
// Vigil Platform — Routes: Event Categories & Mapping Rules
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');

module.exports = function categoriesRoutes(app, pool) {
  // GET /api/categories[?site_id=N] — list with rule counts, optionally filtered by site
  app.get('/api/categories', async (req, res) => {
    try {
      const allowed = req.user?.allowedSites ?? null;
      const siteParam = req.query.site_id ? parseInt(req.query.site_id, 10) : null;
      if (siteParam && allowed !== null && !allowed.includes(siteParam))
        return res.status(403).json({ error: 'forbidden' });
      const activeSites = siteParam ? [siteParam] : allowed;
      const params = [];
      let where = '';
      if (activeSites !== null) { params.push(activeSites); where = 'WHERE c.site_id = ANY($1)'; }
      const { rows } = await pool.query(`
        SELECT c.id, c.name, c.icon, c.color, c.kind, c.is_locked, c.sort_order,
               c.site_id, c.created_at, c.updated_at,
               COUNT(r.id)::int AS rule_count
          FROM event_categories c
          LEFT JOIN event_category_rules r ON r.category_id = c.id
          ${where}
          GROUP BY c.id
          ORDER BY c.sort_order, c.id
      `, params);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/categories'); }
  });

  // POST /api/categories — create user category (site_id required)
  app.post('/api/categories', async (req, res) => {
    const { name, icon, color, sort_order, site_id } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const siteId = site_id ? parseInt(site_id, 10) : null;
    if (!siteId) return res.status(400).json({ error: 'site_id required' });
    const allowed = req.user?.allowedSites ?? null;
    if (allowed !== null && !allowed.includes(siteId))
      return res.status(403).json({ error: 'forbidden' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO event_categories (name, icon, color, kind, sort_order, site_id)
         VALUES ($1, $2, $3, 'event', COALESCE($4, 0), $5)
         RETURNING *`,
        [name.trim(), icon || null, color || '#5b8def', sort_order, siteId]
      );
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'name already exists' });
      routeError(res, err, 'POST /api/categories');
    }
  });

  // PUT /api/categories/:id — update; locked categories block name/icon changes
  app.put('/api/categories/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, icon, color, sort_order, is_locked } = req.body || {};
    try {
      const cur = await pool.query('SELECT * FROM event_categories WHERE id=$1', [id]);
      if (!cur.rows[0]) return res.status(404).json({ error: 'not found' });
      const c = cur.rows[0];
      const newLocked = typeof is_locked === 'boolean' ? is_locked : c.is_locked;
      const newName  = c.is_locked ? c.name : (name?.trim() || c.name);
      const newIcon  = c.is_locked ? c.icon : (icon ?? c.icon);
      const newColor = color ?? c.color;
      const newSort  = sort_order ?? c.sort_order;
      const { rows } = await pool.query(
        `UPDATE event_categories
            SET name=$1, icon=$2, color=$3, sort_order=$4, is_locked=$5
          WHERE id=$6 RETURNING *`,
        [newName, newIcon, newColor, newSort, newLocked, id]
      );
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'name already exists' });
      routeError(res, err, 'PUT /api/categories/:id');
    }
  });

  // DELETE /api/categories/:id — delete (locked categories protected)
  app.delete('/api/categories/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const cur = await pool.query('SELECT is_locked FROM event_categories WHERE id=$1', [id]);
      if (!cur.rows[0]) return res.status(404).json({ error: 'not found' });
      if (cur.rows[0].is_locked) return res.status(403).json({ error: 'locked category cannot be deleted' });
      await pool.query('DELETE FROM event_categories WHERE id=$1', [id]);
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/categories/:id'); }
  });

  // GET /api/categories/:id/rules — list mapping rules for a category
  app.get('/api/categories/:id/rules', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const { rows } = await pool.query(
        `SELECT * FROM event_category_rules WHERE category_id=$1 ORDER BY priority DESC, id`,
        [id]
      );
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/categories/:id/rules'); }
  });

  // POST /api/categories/:id/rules — add a mapping rule
  app.post('/api/categories/:id/rules', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const { camera_id, rule_name, event_type, object_class, vehicle_type, priority } = body;
    const blank = v => (v == null || v === '' ? null : v);
    // match_state: only default to 'true' when the field was OMITTED.
    // An explicit "" or null from the form means the user chose "any" → store NULL.
    const matchState = ('match_state' in body) ? blank(body.match_state) : 'true';
    try {
      const cat = await pool.query('SELECT id, site_id FROM event_categories WHERE id=$1', [id]);
      if (!cat.rows[0]) return res.status(404).json({ error: 'category not found' });
      // Camera must belong to same site as category (if both are set)
      if (blank(camera_id) && cat.rows[0].site_id) {
        const camChk = await pool.query(
          'SELECT 1 FROM cameras WHERE id=$1 AND site_id=$2',
          [blank(camera_id), cat.rows[0].site_id]);
        if (!camChk.rowCount) return res.status(400).json({ error: 'camera_site_mismatch' });
      }
      const { rows } = await pool.query(
        `INSERT INTO event_category_rules
           (category_id, camera_id, rule_name, event_type, object_class, vehicle_type, match_state, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 0))
         RETURNING *`,
        [id, blank(camera_id), blank(rule_name), blank(event_type), blank(object_class),
         blank(vehicle_type), matchState, priority]
      );
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'POST /api/categories/:id/rules'); }
  });

  // DELETE /api/category-rules/:id — remove a mapping rule
  app.delete('/api/category-rules/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      await pool.query('DELETE FROM event_category_rules WHERE id=$1', [id]);
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/category-rules/:id'); }
  });
};
