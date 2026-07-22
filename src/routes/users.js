// ============================================================
// Vigil Platform — Routes: User Management + Audit Log
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const express = require('express');
const routeError = require('../helpers/routeError');

module.exports = function usersRoutes(app, { auth, getIP }) {

  app.get('/api/users', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const users = await auth.listUsers();
      res.json(users);
    } catch (e) { routeError(res, e, 'GET /api/users'); }
  });

  app.post('/api/users', auth.requireAdmin, async (req, res) => {
    try {
      const user = await auth.createUser(req.body, req.user);
      res.json(user);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.put('/api/users/:id', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = await auth.updateUser(id, req.body, req.user);
      res.json(user);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/users/:id/reset-password', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { newPassword } = req.body;
      await auth.resetPassword(id, newPassword, req.user);
      res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/users/:id', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await auth.deleteUser(id, req.user);
      res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // PUT /api/users/:id/sites — replace entire site assignment list (admin only)
  app.put('/api/users/:id/sites', auth.requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const siteIds = (Array.isArray(req.body.site_ids) ? req.body.site_ids : [])
        .map(Number).filter(n => Number.isFinite(n) && n > 0);
      await auth.setUserSites(userId, siteIds);
      res.json({ user_id: userId, site_ids: siteIds });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // GET /api/audit-log
  app.get('/api/audit-log', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const { limit = 200, userId, action, targetCameraId } = req.query;
      const logs = await auth.getAuditLog({
        limit: parseInt(limit),
        userId: userId ? parseInt(userId) : null,
        action: action || null,
        targetCameraId: targetCameraId || null,
      });
      res.json(logs);
    } catch (e) { routeError(res, e, 'GET /api/audit-log'); }
  });

  // POST /api/csp-report — public, no auth; rate-limited 20 req/min per IP
  const _cspRateMap = new Map();
  app.post('/api/csp-report',
    express.json({ type: ['application/json', 'application/csp-report'], limit: '4kb' }),
    (req, res) => {
      const ip = getIP(req);
      const now = Date.now();
      const [cnt, win] = _cspRateMap.get(ip) || [0, now];
      const newCnt = now - win > 60_000 ? 1 : cnt + 1;
      _cspRateMap.set(ip, [newCnt, now - win > 60_000 ? now : win]);
      if (newCnt > 20) return res.sendStatus(429);
      const r = (req.body || {})['csp-report'] || req.body || {};
      const dir = r['violated-directive'] || r['effective-directive'] || '?';
      const blocked = r['blocked-uri'] || '?';
      const src = r['source-file'] ? `${r['source-file']}:${r['line-number'] || 0}` : '?';
      console.warn(`[CSP-REPORT] directive=${dir} blocked=${blocked} source=${src}`);
      res.sendStatus(204);
    }
  );
};
