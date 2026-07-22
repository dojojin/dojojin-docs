// ============================================================
// Vigil Platform — Routes: License
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const license    = require('../license');

module.exports = function licenseRoutes(app, pool, { getCurrentLicenseState, invalidateLicenseStateCache }) {

  // GET /api/license/machine-id — lightweight, just the fingerprint.
  // Used by the UI to display the ID even before activation.
  app.get('/api/license/machine-id', async (req, res) => {
    res.json({ machine_id: license.getMachineFingerprint() });
  });

  // GET /api/license/status — full state, plus license payload if active.
  // The UI calls this on Settings → 🔐 License open + every 30s while open.
  app.get('/api/license/status', async (req, res) => {
    try {
      const state = await getCurrentLicenseState();
      const out = { mode: state.mode, machine_id: state.machine_id };
      if (state.payload) {
        out.license_info = {
          customer:     state.payload.customer    || null,
          customer_id:  state.payload.customer_id || null,
          tier:         state.payload.tier        || null,
          max_cameras:  state.payload.max_cameras || null,
          features:     state.payload.features    || [],
          issued_at:    state.payload.iat ? new Date(state.payload.iat * 1000).toISOString() : null,
          expires_at:   state.payload.exp ? new Date(state.payload.exp * 1000).toISOString() : null,
          days_left:    state.days_left ?? null,
        };
      }
      if (state.mode === 'TRIAL') {
        out.trial = { started_at: state.trial_started_at, days_left: state.trial_days_left };
      }
      if (state.mode === 'GRACE') {
        out.grace = { days_over: state.days_over, grace_left: state.grace_left };
      }
      if (state.mode === 'EXPIRED') {
        out.expired = { days_over: state.days_over };
      }
      if (state.mode === 'INVALID') {
        out.invalid = { reason: state.reason };
        if (state.current_machine_id) out.invalid.current_machine_id = state.current_machine_id;
      }
      res.json(out);
    } catch (e) { routeError(res, e, 'GET /api/license/status'); }
  });

  // POST /api/license/activate — { key } → verify + save.
  // Returns the new state on success. Same enforcement on failure (the
  // stale stored key is left untouched on a bad input).
  app.post('/api/license/activate', async (req, res) => {
    try {
      const key = String(req.body?.key || '').trim();
      if (!key) return res.status(400).json({ error: 'license key required' });
      const result = await license.verifyLicense(key);
      if (!result.valid) {
        return res.status(400).json({
          error: 'invalid_license',
          reason: result.error,
          current_machine_id: result.current_machine_id || license.getMachineFingerprint(),
        });
      }
      await license.saveLicenseKey(pool, key);
      invalidateLicenseStateCache();
      const state = await getCurrentLicenseState();
      res.json({ success: true, mode: state.mode, payload: state.payload });
    } catch (e) { routeError(res, e, 'POST /api/license/activate'); }
  });

  // POST /api/license/deactivate — clear the stored key. Admin only.
  // Useful for testing + transferring license to another machine (the
  // operator runs deactivate on the old machine before issuing a new key
  // for the new machine_id).
  app.post('/api/license/deactivate', async (req, res) => {
    try {
      await license.saveLicenseKey(pool, '');
      invalidateLicenseStateCache();
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'POST /api/license/deactivate'); }
  });

};
