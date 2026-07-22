// ============================================================
// Vigil Platform — Routes: EULA
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const path = require('path');
const fs   = require('fs');
const routeError = require('../helpers/routeError');
const { getSystemSettings, invalidateSystemSetting } = require('../helpers/getSystemSetting');

const EULA_PATHS = {
  th: path.join(__dirname, '..', '..', 'docs', 'EULA-th.md'),
  en: path.join(__dirname, '..', '..', 'docs', 'EULA-en.md'),
};
const _eulaCache = {};
function getEulaContent(lang = 'th') {
  const key = EULA_PATHS[lang] ? lang : 'th';
  if (_eulaCache[key] != null) return _eulaCache[key];
  try { _eulaCache[key] = fs.readFileSync(EULA_PATHS[key], 'utf8'); }
  catch {
    _eulaCache[key] = key === 'en'
      ? '# EULA not found\n\nPlease contact support.'
      : '# EULA ไม่พบ\n\nกรุณาติดต่อทีมงาน';
  }
  return _eulaCache[key];
}

module.exports = function eulaRoutes(app, pool) {
  // GET /api/eula?lang=en → EULA-en.md (fallback to th if missing)
  // GET /api/eula         → EULA-th.md (default)
  // Public — login page + disclaimer page may want to link to it.
  app.get('/api/eula', (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'th';
    res.type('text/markdown; charset=utf-8').send(getEulaContent(lang));
  });

  // Whether the operator has accepted the EULA on this deployment. Public
  // so the frontend can decide whether to show the acceptance modal even
  // before the first admin logs in (the modal fires on login, not on page open).
  app.get('/api/eula/status', async (req, res) => {
    try {
      const s = await getSystemSettings(pool, ['eula_accepted_at', 'eula_accepted_by']);
      res.json({
        accepted:     !!s.eula_accepted_at,
        accepted_at:  s.eula_accepted_at || null,
        accepted_by:  s.eula_accepted_by || null,
      });
    } catch (e) { routeError(res, e, 'GET /api/eula/status'); }
  });

  // Record acceptance. Admin-only — EULA acceptance binds the legal
  // entity that runs the deployment, viewers can't sign on their behalf.
  app.post('/api/eula/accept', async (req, res) => {
    try {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin role required to accept EULA' });
      }
      await pool.query(`UPDATE system_settings SET value=$1 WHERE key='eula_accepted_at'`,
                       [new Date().toISOString()]);
      await pool.query(`UPDATE system_settings SET value=$1 WHERE key='eula_accepted_by'`,
                       [req.user.username || '']);
      invalidateSystemSetting('eula_accepted_at');
      invalidateSystemSetting('eula_accepted_by');
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'POST /api/eula/accept'); }
  });
};
