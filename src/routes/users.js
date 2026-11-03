// ============================================================
// Vigil Platform — Routes: User Management + Audit Log
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const express = require('express');
const routeError = require('../helpers/routeError');
const viewRegistry = require('../view-registry');

module.exports = function usersRoutes(app, { auth, getIP, pool }) {

  app.get('/api/users', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const users = await auth.listUsers();
      res.json(users);
    } catch (e) { routeError(res, e, 'GET /api/users'); }
  });

  // ชื่อผู้ใช้/อีเมลซ้ำ — เดิมส่งข้อความดิบของ Postgres ("duplicate key value violates unique constraint
  // users_email_key") ขึ้นจอ · ส่ง code ให้หน้าจอแปลเป็นภาษาของผู้ใช้ (i18n us.errEmailTaken / us.errUsernameTaken)
  const userSaveError = (res, e) => {
    if (e.code === '23505' && /email/.test(e.constraint || '')) return res.status(409).json({ error: 'email already in use', code: 'EMAIL_TAKEN' });
    if (e.code === '23505' && /username/.test(e.constraint || '')) return res.status(409).json({ error: 'username already in use', code: 'USERNAME_TAKEN' });
    return res.status(400).json({ error: e.message });
  };

  app.post('/api/users', auth.requireAdmin, async (req, res) => {
    try {
      const user = await auth.createUser(req.body, req.user);
      res.json(user);
    } catch (e) { userSaveError(res, e); }
  });

  app.put('/api/users/:id', auth.requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = await auth.updateUser(id, req.body, req.user);
      res.json(user);
    } catch (e) { userSaveError(res, e); }
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

  // PUT /api/users/:id/views — สิทธิ์ระดับหน้า/แท็บ + หน้าแรกหลัง login (admin only)
  // (decision #251) `allowed_views: null` = ไม่จำกัด · `[]` = ไม่เห็นอะไรเลย — ต่างกัน
  app.put('/api/users/:id/views', auth.requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      if (!Number.isInteger(userId)) return res.status(400).json({ error: 'bad user id' });

      const raw = req.body?.allowed_views;
      let allowedViews = null;
      if (raw !== null && raw !== undefined) {
        if (!Array.isArray(raw)) return res.status(400).json({ error: 'allowed_views must be an array or null' });
        // ต้อง validate ทุก key กับ registry — ถ้าปล่อยค่าที่ไม่รู้จักผ่าน `routesFor()`
        // จะข้ามมันเงียบๆ แล้วแอดมินจะเข้าใจว่าให้สิทธิ์ไปแล้วทั้งที่ผู้ใช้เข้าไม่ได้จริง
        const bad = raw.filter(k => !viewRegistry.isValidKey(k));
        if (bad.length) return res.status(400).json({ error: `unknown view key: ${bad.join(', ')}` });
        allowedViews = [...new Set(raw)];
      }

      const landing = req.body?.landing_view || null;
      if (landing) {
        if (!viewRegistry.isValidKey(landing)) return res.status(400).json({ error: 'unknown landing_view' });
        // หน้าแรกต้องเป็นหน้าที่ตัวเองเข้าได้ ไม่งั้น login มาแล้วเจอการ์ด "ไม่มีสิทธิ์" ทันที
        if (allowedViews && !_landingCovered(allowedViews, landing)) {
          return res.status(400).json({ error: 'landing_view is not in allowed_views' });
        }
      }
      res.json(await auth.setUserViews(userId, allowedViews, landing));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ได้ทั้งหน้า = ได้ทุกแท็บในหน้านั้น — semantics เดียวกับ ViewsACL.allowed() ฝั่งจอ
  function _landingCovered(allowedViews, landing) {
    if (allowedViews.includes(landing)) return true;
    if (landing.includes(':')) return allowedViews.includes(landing.split(':')[0]);
    return allowedViews.some(k => k.startsWith(landing + ':'));
  }

  // PUT /api/users/:id/camera-mode — ดูพร้อมกันได้กี่กล้อง (migration 180, admin only)
  //
  // แยก endpoint จาก /cameras โดยตั้งใจ — คนละแกน: /cameras คุมว่า *ตัวไหน*
  // อันนี้คุมว่า *กี่ตัวพร้อมกัน* · รวมกันแล้วจะแยกไม่ออกว่าตอนบันทึกกำลังแก้อะไร
  app.put('/api/users/:id/camera-mode', auth.requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      if (!Number.isInteger(userId)) return res.status(400).json({ error: 'bad user id' });
      const mode = req.body?.camera_select_mode;
      // ค่าที่ไม่รู้จักต้องถูกปฏิเสธ ไม่ใช่ตกไปเป็น multi เงียบ ๆ — แอดมินจะคิดว่า
      // ตั้ง single สำเร็จแล้วทั้งที่ยังเปิดกว้างอยู่ (คลาสเดียวกับ CHECK ใน migration)
      if (mode !== 'single' && mode !== 'multi') {
        return res.status(400).json({ error: "camera_select_mode must be 'single' or 'multi'" });
      }
      const { rows } = await pool.query(
        'UPDATE users SET camera_select_mode = $2, updated_at = NOW() WHERE id = $1'
        + ' RETURNING id, username, camera_select_mode', [userId, mode]);
      if (!rows[0]) return res.status(404).json({ error: 'user not found' });
      res.json(rows[0]);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // PUT /api/users/:id/cameras — จำกัดรายกล้อง (decision #253, admin only)
  // ลิสต์ว่าง = ลบข้อจำกัด (เห็นทุกกล้องใน Site ที่มีสิทธิ์) ไม่ใช่ "ไม่เห็นกล้องไหนเลย"
  app.put('/api/users/:id/cameras', auth.requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      if (!Number.isInteger(userId)) return res.status(400).json({ error: 'bad user id' });
      const ids = (Array.isArray(req.body?.camera_ids) ? req.body.camera_ids : [])
        .map(String).filter(Boolean);
      const unique = [...new Set(ids)];

      if (unique.length) {
        // กล้องต้องมีจริง **และ** อยู่ใน Site ที่ user คนนั้นมีสิทธิ์ — ตั้งค่าที่ไม่มีวันมีผล
        // คือกับดักเงียบ (แอดมินติ๊กแล้วคิดว่าให้สิทธิ์ แต่ siteWhere() ตัดทิ้งหมด)
        const target = { id: userId, role: 'viewer' };
        const sites = await auth.getAllowedSites(target, pool);
        const { rows } = await pool.query(
          sites === null
            ? 'SELECT id FROM cameras WHERE id = ANY($1)'
            : 'SELECT id FROM cameras WHERE id = ANY($1) AND site_id = ANY($2)',
          sites === null ? [unique] : [unique, sites]
        );
        const ok = new Set(rows.map(r => r.id));
        const bad = unique.filter(id => !ok.has(id));
        if (bad.length) {
          return res.status(400).json({
            error: `camera not found or outside the user's sites: ${bad.slice(0, 5).join(', ')}`,
          });
        }
      }
      await auth.setUserCameras(userId, unique);
      res.json({ user_id: userId, camera_ids: unique });
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
  // write-guard: public โดยออกแบบ (เบราว์เซอร์รายงาน CSP)
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
