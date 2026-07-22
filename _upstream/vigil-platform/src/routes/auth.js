// ============================================================
// Vigil Platform — Routes: Authentication
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');
const license    = require('../license');

module.exports = function authRoutes(app, pool, { auth, getIP, getSessionToken }) {

  // Rate limit map (in-memory, simple)
  const loginAttemptsByIP = new Map();
  function checkRateLimit(ip) {
    const now = Date.now();
    const arr = (loginAttemptsByIP.get(ip) || []).filter(t => now - t < 60000);
    loginAttemptsByIP.set(ip, arr);
    return arr.length < 10; // max 10 attempts per minute per IP
  }
  function recordAttempt(ip) {
    const arr = loginAttemptsByIP.get(ip) || [];
    arr.push(Date.now());
    loginAttemptsByIP.set(ip, arr);
  }
  // Prune stale per-IP buckets every 5 min so a flood of distinct client IPs
  // can't grow this Map without bound (memory-exhaustion guard).
  setInterval(() => {
    const now = Date.now();
    for (const [ip, arr] of loginAttemptsByIP) {
      const fresh = arr.filter(t => now - t < 60000);
      if (fresh.length) loginAttemptsByIP.set(ip, fresh);
      else loginAttemptsByIP.delete(ip);
    }
  }, 5 * 60 * 1000);

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      const ip = getIP(req);
      const ua = req.headers['user-agent'] || '';

      if (!username || !password) {
        return res.status(400).json({ error: 'Username + password required' });
      }
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: 'Too many attempts. Try again in 1 minute.' });
      }
      recordAttempt(ip);

      const result = await auth.login(username, password, ip, ua);
      if (!result.success) return res.status(401).json({ error: result.error });

      // Phase 8.0 — kick the trial clock on the first successful login.
      // Idempotent: subsequent logins don't reset it. Failures here are
      // non-fatal (worst case the trial starts on the next login attempt).
      license.recordFirstLogin(pool).catch(() => {});

      // Set cookie — Safari-friendly + HTTPS-aware (Cloudflare Tunnel)
      // Cloudflare ส่ง x-forwarded-proto: https + cf-visitor header
      const xfp = req.headers['x-forwarded-proto'];
      const cfVisitor = req.headers['cf-visitor'];  // {"scheme":"https"}
      const isHttps = req.secure
                    || xfp === 'https'
                    || (cfVisitor && cfVisitor.includes('https'));

      console.log(`🔐 LOGIN | host=${req.headers.host} | xfp=${xfp} | cf-visitor=${cfVisitor} | isHttps=${isHttps}`);

      const cookieParts = [
        `session=${encodeURIComponent(result.token)}`,
        'Path=/',
        'HttpOnly',
        `Max-Age=${7 * 24 * 60 * 60}`,  // 7 days
      ];
      if (isHttps) {
        cookieParts.push('Secure');
        cookieParts.push('SameSite=Lax');
      } else {
        cookieParts.push('SameSite=Lax');
      }
      res.setHeader('Set-Cookie', cookieParts.join('; '));

      // ส่ง token ใน response body ด้วย — สำหรับ Safari ITP fallback
      // Frontend จะเก็บใน localStorage + ส่งผ่าน Authorization header
      res.json({
        success: true,
        user: result.user,
        token: result.token
      });
    } catch (e) { routeError(res, e, 'POST /api/auth/login'); }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = getSessionToken(req);
      if (token) await auth.logout(token, getIP(req), req.headers['user-agent']);
      // SEC-010: match flags with login cookie — Secure only over HTTPS, SameSite always
      const xfp = req.headers['x-forwarded-proto'];
      const cfv = req.headers['cf-visitor'];
      const isHttps = req.secure || xfp === 'https' || (cfv && cfv.includes('https'));
      const flags = ['session=', 'Path=/', 'HttpOnly', 'Max-Age=0', 'SameSite=Lax'];
      if (isHttps) flags.push('Secure');
      res.setHeader('Set-Cookie', flags.join('; '));
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'POST /api/auth/logout'); }
  });

  // Get current user info (สำหรับ frontend check login state)
  app.get('/api/auth/me', async (req, res) => {
    try {
      const token = getSessionToken(req);
      if (!token) {
        // Debug: note the miss WITHOUT dumping the raw Cookie header — that
        // header can carry session/other cookie values and must not land in logs.
        const hasCookieHeader = !!req.headers.cookie;
        console.log(`🔐 /api/auth/me — NO TOKEN | UA: ${(req.headers['user-agent'] || '').slice(0, 50)} | cookie present: ${hasCookieHeader}`);
        return res.status(401).json({ error: 'Not authenticated', hasCookieHeader });
      }
      const user = await auth.getUserFromToken(token);
      if (!user) return res.status(401).json({ error: 'Invalid session' });
      res.json({ user });
    } catch (e) { routeError(res, e, 'GET /api/auth/me'); }
  });

  // Change own password
  app.post('/api/auth/change-password', auth.requireAuth, async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body;
      await auth.changeOwnPassword(req.user.id, oldPassword, newPassword);
      res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Get my active sessions
  app.get('/api/auth/sessions', auth.requireAuth, async (req, res) => {
    try {
      const sessions = await auth.getActiveSessions(req.user.id);
      // Mark current session
      res.json(sessions.map(s => ({
        ...s,
        id: s.id.slice(0, 8) + '...',  // hide full ID
        is_current: s.id === req.user.session_id,
      })));
    } catch (e) { routeError(res, e, 'GET /api/auth/sessions'); }
  });

  app.post('/api/auth/sessions/:id/revoke', auth.requireAuth, async (req, res) => {
    try {
      // Find full session ID by prefix (เพราะ frontend เห็นแค่ 8 ตัวแรก)
      const prefix = req.params.id.replace('...', '');
      const { rows } = await pool.query(
        'SELECT id FROM sessions WHERE user_id = $1 AND id LIKE $2',
        [req.user.id, prefix + '%']
      );
      if (!rows[0]) return res.status(404).json({ error: 'Session not found' });
      await auth.revokeSession(rows[0].id, req.user);
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'POST /api/auth/sessions/:id/revoke'); }
  });

};
