// ============================================================
// Vigil Platform — Routes: LPR Gates (RF4)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Operator-defined entry/exit points. A gate maps a camera's lanes to a
// direction (in/out/none); plate events can then be split by direction and
// filtered by gate. CRUD only — consumption (direction stats/chart) is RF5.
// Protected by the app-level session auth (same as lpr-watchlist).
// ============================================================
'use strict';

const VALID_DIR = new Set(['in', 'out', 'none']);

// Normalise rules → { "<lane>": "in"|"out"|"none" }. Drops unknown directions
// (defensive — never store a value the UI/aggregation can't interpret).
function sanitizeRules(rules) {
  const out = {};
  if (rules && typeof rules === 'object' && !Array.isArray(rules)) {
    for (const [lane, dir] of Object.entries(rules)) {
      const ln = String(lane).trim();
      if (ln && VALID_DIR.has(dir)) out[ln] = dir;
    }
  }
  return out;
}

module.exports = function lprGatesRoutes(app, pool) {
  app.get('/api/lpr/gates', async (req, res) => {
    try {
      const r = await pool.query('SELECT id, name, camera_id, rules FROM lpr_gates ORDER BY created_at');
      res.json(r.rows);
    } catch (e) {
      console.error('[lpr-gates] GET:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/lpr/gates', async (req, res) => {
    const { name, camera_id, rules } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const id = 'gate' + Date.now().toString(36);
    try {
      const r = await pool.query(
        'INSERT INTO lpr_gates (id, name, camera_id, rules) VALUES ($1,$2,$3,$4) RETURNING id, name, camera_id, rules',
        [id, String(name).trim(), camera_id ? String(camera_id).trim() : null, JSON.stringify(sanitizeRules(rules))]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) {
      console.error('[lpr-gates] POST:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Partial update — only the provided fields change (name / camera_id / rules).
  app.patch('/api/lpr/gates/:id', async (req, res) => {
    const { name, camera_id, rules } = req.body || {};
    const sets = [], vals = [];
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'name required' });
      vals.push(String(name).trim()); sets.push(`name = $${vals.length}`);
    }
    if (camera_id !== undefined) { vals.push(camera_id ? String(camera_id).trim() : null); sets.push(`camera_id = $${vals.length}`); }
    if (rules !== undefined)     { vals.push(JSON.stringify(sanitizeRules(rules)));        sets.push(`rules = $${vals.length}::jsonb`); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    vals.push(req.params.id);
    try {
      const r = await pool.query(
        `UPDATE lpr_gates SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, name, camera_id, rules`,
        vals
      );
      if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
      res.json(r.rows[0]);
    } catch (e) {
      console.error('[lpr-gates] PATCH:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.delete('/api/lpr/gates/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM lpr_gates WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[lpr-gates] DELETE:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── Vehicle-type display config (RF4) ───────────────────────────
  // { "<code>": { on: bool, label: string } } stored as JSON in system_settings.
  // Toggles which vehicle_type values show in the LPR donut/filter + a label
  // override. The known code set + default labels live in the frontend; here we
  // just store/return the override map (sanitised).
  app.get('/api/lpr/vehicle-types', async (req, res) => {
    try {
      const r = await pool.query("SELECT value FROM system_settings WHERE key = 'lpr_vehicle_types'");
      let cfg = {};
      try { cfg = r.rows[0] && r.rows[0].value ? JSON.parse(r.rows[0].value) : {}; } catch { cfg = {}; }
      res.json(cfg);
    } catch (e) {
      console.error('[lpr-gates] GET vehicle-types:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── Scene-image downscale config (RF-IMG) ───────────────────────
  // Caps the stored LPR SCENE resolution/quality (resize happens at ingest in
  // lpr-core.js; the plate crop is untouched). lpr-core caches these for 60s, so
  // a save here takes up to a minute to apply at ingest.
  app.get('/api/lpr/scene-image', async (req, res) => {
    try {
      const r = await pool.query(
        "SELECT key, value FROM system_settings WHERE key IN ('lpr_scene_resolution','lpr_scene_quality')");
      const m = Object.fromEntries(r.rows.map(x => [x.key, x.value]));
      res.json({
        resolution: m.lpr_scene_resolution || '1080p',
        quality: parseInt(m.lpr_scene_quality, 10) || 80,
      });
    } catch (e) {
      console.error('[lpr-gates] GET scene-image:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.put('/api/lpr/scene-image', async (req, res) => {
    const body = req.body || {};
    const RES = ['720p', '1080p', '1440p'];
    const resolution = RES.includes(body.resolution) ? body.resolution : '1080p';
    let quality = parseInt(body.quality, 10);
    if (!(quality >= 60 && quality <= 95)) quality = 80;
    try {
      await pool.query(
        `INSERT INTO system_settings (key, value) VALUES
           ('lpr_scene_resolution', $1), ('lpr_scene_quality', $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [resolution, String(quality)]);
      res.json({ resolution, quality });
    } catch (e) {
      console.error('[lpr-gates] PUT scene-image:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ── Per-camera LPR direction (RF5) ──────────────────────────────
  // Sets cameras.lpr_direction = 'in' | 'out' | null (none). The overview
  // direction chart groups events by this. Scoped: caller passes an LPR camera_id.
  app.put('/api/lpr/camera-direction', async (req, res) => {
    const id = String(req.body.camera_id || '').trim();
    const d  = req.body.direction;
    const dir = (d === 'in' || d === 'out') ? d : null;  // anything else → none
    if (!id) return res.status(400).json({ error: 'camera_id_required' });
    try {
      if (req.user?.isSiteScoped) {
        const chk = await pool.query(
          'SELECT 1 FROM cameras WHERE id = $1 AND site_id = ANY($2)',
          [id, req.user.allowedSites]);
        if (!chk.rowCount) return res.status(403).json({ error: 'forbidden' });
      }
      const r = await pool.query(
        'UPDATE cameras SET lpr_direction = $1 WHERE id = $2 RETURNING id, lpr_direction',
        [dir, id]);
      if (!r.rowCount) return res.status(404).json({ error: 'camera_not_found' });
      res.json({ camera_id: r.rows[0].id, direction: r.rows[0].lpr_direction });
    } catch (e) {
      console.error('[lpr-gates] PUT camera-direction:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.put('/api/lpr/vehicle-types', async (req, res) => {
    const body = req.body || {};
    const cfg = {};
    for (const [code, v] of Object.entries(body)) {
      const c = String(code).trim();
      if (!c || !v || typeof v !== 'object') continue;
      const out = {};
      if (v.on !== undefined)    out.on = !!v.on;
      if (v.label !== undefined) out.label = String(v.label).trim();
      cfg[c] = out;
    }
    try {
      await pool.query(
        "INSERT INTO system_settings (key, value) VALUES ('lpr_vehicle_types', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [JSON.stringify(cfg)]
      );
      res.json(cfg);
    } catch (e) {
      console.error('[lpr-gates] PUT vehicle-types:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });
};

module.exports.sanitizeRules = sanitizeRules;
