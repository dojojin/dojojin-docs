// ============================================================
// Vigil Platform — Routes: System Settings
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');

module.exports = function settingsRoutes(app, pool, { auth, getIP, ANALYTICS_EVENT_KEYS, refreshAnalyticsEnabledSet, invalidateMapboxToken, invalidateSystemSetting }) {

  // GET /api/settings — list all settings
  app.get('/api/settings', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT key, value, description, updated_at FROM system_settings ORDER BY key');
      const obj = {};
      rows.forEach(r => { obj[r.key] = { value: r.value, description: r.description, updated_at: r.updated_at }; });
      res.json(obj);
    } catch (err) { routeError(res, err, 'GET /api/settings'); }
  });

  const SETTINGS_VALIDATORS = {
    data_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('data_retention_days must be 1..730');
      return String(n);
    },
    appearances_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('appearances_retention_days must be 1..730');
      return String(n);
    },
    snapshot_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) throw new Error('snapshot_retention_days must be 1..365');
      return String(n);
    },
    // RF4 — LPR-specific retention. lpr_retention_days = metadata rows (anprAlarm
    // events + license_plates); lpr_image_retention_days = snapshot JPGs (capped
    // ≤ metadata at runtime in lpr-retention.js so an image never outlives its row).
    lpr_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('lpr_retention_days must be 1..730');
      return String(n);
    },
    lpr_image_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('lpr_image_retention_days must be 1..730');
      return String(n);
    },
    clip_retention_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 90) throw new Error('clip_retention_days must be 1..90');
      return String(n);
    },
    custom_range_max_days: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('custom_range_max_days must be 1..730');
      return String(n);
    },
    display_timezone: v => {
      if (typeof v !== 'string' || !v.trim()) throw new Error('display_timezone must be a string');
      try { new Date().toLocaleString('en-US', { timeZone: v }); } catch { throw new Error('invalid timezone'); }
      return v.trim();
    },
    // FACE-UI FP6 — face system settings
    face_similarity_min: v => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 50 || n > 99) throw new Error('face_similarity_min must be 50..99');
      return String(n);
    },
    face_show_expression: v => {
      const s = String(v) === '1' || v === true || v === 'true' ? '1' : '0';
      return s;
    },
    counter_dedup_mode: v => {
      if (!['state', 'object_window', 'none'].includes(v)) throw new Error('counter_dedup_mode must be state|object_window|none');
      return v;
    },
    comparison_mode: v => {
      if (!['rolling', 'calendar'].includes(v)) throw new Error('comparison_mode must be rolling|calendar');
      return v;
    },
    analytics_event_display: v => {
      if (typeof v !== 'string') throw new Error('analytics_event_display must be a CSV string');
      const parts = v.split(',').map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        if (!ANALYTICS_EVENT_KEYS.includes(p)) throw new Error(`unknown analytics event key: ${p}`);
      }
      return ANALYTICS_EVENT_KEYS.filter(k => parts.includes(k)).join(',');
    },
    brand_name: v => {
      if (typeof v !== 'string') throw new Error('brand_name must be a string');
      const s = v.trim();
      if (s.length < 1 || s.length > 100) throw new Error('brand_name must be 1..100 chars');
      return s;
    },
    brand_tagline: v => {
      if (typeof v !== 'string') throw new Error('brand_tagline must be a string');
      const s = v.trim();
      if (s.length > 200) throw new Error('brand_tagline too long (max 200)');
      return s;
    },
    brand_logo_path: v => {
      if (typeof v !== 'string') throw new Error('brand_logo_path must be a string');
      const s = v.trim();
      if (s && !/^[A-Za-z0-9._-]+$/.test(s)) throw new Error('brand_logo_path must be a simple filename');
      return s;
    },
    brand_primary_color: v => {
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v.trim())) throw new Error('brand_primary_color must be #RRGGBB');
      return v.trim().toLowerCase();
    },
  };

  // PUT /api/settings/map — Mapbox token (admin-only; decision #171)
  // Must be before /:key wildcard so Express doesn't treat 'map' as a generic key.
  app.put('/api/settings/map', auth.requireAdmin, async (req, res) => {
    const { mapboxToken } = req.body;
    // pk. = public token; reject sk. (secret) — SEC-003
    if (mapboxToken && !/^pk\.[A-Za-z0-9._-]+$/.test(mapboxToken)) {
      return res.status(400).json({ error: 'invalid_token_format' });
    }
    try {
      await pool.query(
        "INSERT INTO system_settings(key,value) VALUES('mapbox_token',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
        [mapboxToken || '']
      );
      invalidateMapboxToken();
      await auth.logAudit(req.user?.id, req.user?.username, 'map_settings_token_update', null, null, getIP(req), req.headers['user-agent'], { tokenSet: !!(mapboxToken) });
      res.json({ success: true });
    } catch (err) { routeError(res, err, 'PUT /api/settings/map'); }
  });

  // PUT /api/settings/:key — update setting (with validation)
  app.put('/api/settings/:key', async (req, res) => {
    const key = req.params.key;
    const validator = SETTINGS_VALIDATORS[key];
    if (!validator) return res.status(404).json({ error: 'unknown setting key' });
    let value;
    try { value = validator(req.body?.value); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    try {
      const { rows } = await pool.query(
        `UPDATE system_settings SET value=$1 WHERE key=$2 RETURNING *`,
        [value, key]
      );
      if (!rows[0]) return res.status(404).json({ error: 'setting row missing' });
      if (key === 'analytics_event_display') refreshAnalyticsEnabledSet();
      invalidateSystemSetting(key);
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'PUT /api/settings/:key'); }
  });
};
