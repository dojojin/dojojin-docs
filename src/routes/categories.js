// ============================================================
// Vigil Platform — Routes: Event Categories & Mapping Rules
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');

module.exports = function categoriesRoutes(app, pool) {
  // GET /api/categories — list all (with rule counts)
  app.get('/api/categories', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT c.id, c.name, c.icon, c.color, c.kind, c.is_builtin, c.sort_order,
               c.created_at, c.updated_at,
               COUNT(r.id)::int AS rule_count
          FROM event_categories c
          LEFT JOIN event_category_rules r ON r.category_id = c.id
          GROUP BY c.id
          ORDER BY c.sort_order, c.id
      `);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/categories'); }
  });

  // POST /api/categories — create user category
  app.post('/api/categories', async (req, res) => {
    const { name, icon, color, sort_order } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO event_categories (name, icon, color, kind, is_builtin, sort_order)
         VALUES ($1, $2, $3, 'event', false, COALESCE($4, 0))
         RETURNING *`,
        [name.trim(), icon || '🚨', color || '#5b8def', sort_order]
      );
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'name already exists' });
      routeError(res, err, 'POST /api/categories');
    }
  });

  // PUT /api/categories/:id — update (builtin can edit icon/color/sort_order only)
  app.put('/api/categories/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, icon, color, sort_order } = req.body || {};
    try {
      const cur = await pool.query('SELECT * FROM event_categories WHERE id=$1', [id]);
      if (!cur.rows[0]) return res.status(404).json({ error: 'not found' });
      const c = cur.rows[0];
      const newName  = c.is_builtin ? c.name : (name?.trim() || c.name);
      const newIcon  = icon ?? c.icon;
      const newColor = color ?? c.color;
      const newSort  = sort_order ?? c.sort_order;
      const { rows } = await pool.query(
        `UPDATE event_categories
            SET name=$1, icon=$2, color=$3, sort_order=$4
          WHERE id=$5 RETURNING *`,
        [newName, newIcon, newColor, newSort, id]
      );
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'name already exists' });
      routeError(res, err, 'PUT /api/categories/:id');
    }
  });

  // DELETE /api/categories/:id — delete (builtin protected)
  app.delete('/api/categories/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const cur = await pool.query('SELECT is_builtin FROM event_categories WHERE id=$1', [id]);
      if (!cur.rows[0]) return res.status(404).json({ error: 'not found' });
      if (cur.rows[0].is_builtin) return res.status(403).json({ error: 'built-in category cannot be deleted' });
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
    const { camera_id, rule_name, event_type, object_class, priority } = body;
    const blank = v => (v == null || v === '' ? null : v);
    // match_state: only default to 'true' when the field was OMITTED.
    // An explicit "" or null from the form means the user chose "any" → store NULL.
    const matchState = ('match_state' in body) ? blank(body.match_state) : 'true';
    try {
      const cat = await pool.query('SELECT id FROM event_categories WHERE id=$1', [id]);
      if (!cat.rows[0]) return res.status(404).json({ error: 'category not found' });
      const { rows } = await pool.query(
        `INSERT INTO event_category_rules
           (category_id, camera_id, rule_name, event_type, object_class, match_state, priority)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0))
         RETURNING *`,
        [id, blank(camera_id), blank(rule_name), blank(event_type), blank(object_class),
         matchState, priority]
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
