// ============================================================
// DojoJin Tech Dashboard — Authentication Module
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Features:
// - Password hashing (bcrypt)
// - Session management (signed cookies)
// - Express middleware (requireAuth / requireAdmin)
// - Audit logging
// - Rate limiting (brute force protection)
// ============================================================

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SESSION_TTL_DAYS = 7;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

let pool = null;
let sessionSecret = null;

// ── Init ────────────────────────────────────────────────────
function init(pgPool, secret) {
  pool = pgPool;
  // ใช้ secret จาก env หรือ generate ใหม่ถ้าไม่มี
  sessionSecret = secret || crypto.randomBytes(32).toString('hex');
  if (!secret) {
    console.warn('🔐 SESSION_SECRET not set in .env — using random (sessions will reset on restart)');
  }
  ensureDefaultAdmin();
  // Cleanup expired sessions ทุก 1 ชั่วโมง
  setInterval(cleanupExpired, 60 * 60 * 1000);
}

// ── Default admin (สร้าง admin/changeme ครั้งแรก) ────────────
async function ensureDefaultAdmin() {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(rows[0].count) === 0) {
      const hash = await bcrypt.hash('changeme', 10);
      await pool.query(
        `INSERT INTO users (username, full_name, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, 'admin', true)`,
        ['admin', 'Default Admin', hash]
      );
      console.log('');
      console.log('╔══════════════════════════════════════════════════╗');
      console.log('║  🔐 DEFAULT ADMIN CREATED                        ║');
      console.log('║  Username: admin                                 ║');
      console.log('║  Password: changeme                              ║');
      console.log('║  ⚠️  CHANGE PASSWORD IMMEDIATELY AFTER LOGIN     ║');
      console.log('╚══════════════════════════════════════════════════╝');
      console.log('');
    }
  } catch (e) { console.error('🔐 ensureDefaultAdmin:', e.message); }
}

// ── Cleanup ─────────────────────────────────────────────────
async function cleanupExpired() {
  try {
    await pool.query('DELETE FROM sessions WHERE expires_at < NOW() OR revoked = true');
    await pool.query("DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '90 days'");
  } catch (e) { /* ignore */ }
}

// ── Password ────────────────────────────────────────────────
async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  try { return await bcrypt.compare(plain, hash); }
  catch { return false; }
}

// ── Session token (HMAC signed) ─────────────────────────────
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function signToken(sessionId) {
  const hmac = crypto.createHmac('sha256', sessionSecret).update(sessionId).digest('hex');
  return `${sessionId}.${hmac.slice(0, 32)}`;  // truncate hmac for shorter cookie
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [sessionId, sig] = parts;
  const expected = crypto.createHmac('sha256', sessionSecret).update(sessionId).digest('hex').slice(0, 32);
  // Constant-time compare
  if (sig.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0 ? sessionId : null;
}

// ── Login ───────────────────────────────────────────────────
async function login(username, password, ipAddress, userAgent) {
  // Find user
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  const user = rows[0];

  if (!user || !user.enabled) {
    await logAudit(null, username, 'login_failed', null, null, ipAddress, userAgent, { reason: 'user_not_found_or_disabled' });
    return { success: false, error: 'Username หรือ password ไม่ถูกต้อง' };
  }

  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minLeft = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
    await logAudit(user.id, username, 'login_locked', null, null, ipAddress, userAgent, { minutes_left: minLeft });
    return { success: false, error: `บัญชีถูกล็อค กรุณารอ ${minLeft} นาที` };
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const newAttempts = (user.failed_attempts || 0) + 1;
    let lockedUntil = null;
    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    }
    await pool.query(
      'UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
      [newAttempts, lockedUntil, user.id]
    );
    await logAudit(user.id, username, 'login_failed', null, null, ipAddress, userAgent, { attempts: newAttempts });
    return {
      success: false,
      error: lockedUntil
        ? `Login ผิด ${MAX_FAILED_ATTEMPTS} ครั้ง — บัญชีถูกล็อค ${LOCKOUT_MINUTES} นาที`
        : `Username หรือ password ไม่ถูกต้อง (เหลือ ${MAX_FAILED_ATTEMPTS - newAttempts} ครั้ง)`
    };
  }

  // Login success — create session
  await pool.query(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW(), last_login_ip = $1 WHERE id = $2',
    [ipAddress, user.id]
  );

  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, user.id, ipAddress, userAgent, expiresAt]
  );

  await logAudit(user.id, username, 'login_success', null, null, ipAddress, userAgent, {});

  return {
    success: true,
    token: signToken(sessionId),
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      must_change_password: user.must_change_password,
    }
  };
}

// ── Logout ──────────────────────────────────────────────────
async function logout(token, ipAddress, userAgent) {
  const sessionId = verifyToken(token);
  if (!sessionId) return { success: true };
  try {
    const { rows } = await pool.query(
      'SELECT s.user_id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1',
      [sessionId]
    );
    if (rows[0]) {
      await logAudit(rows[0].user_id, rows[0].username, 'logout', null, null, ipAddress, userAgent, {});
    }
    await pool.query('UPDATE sessions SET revoked = true WHERE id = $1', [sessionId]);
  } catch {}
  return { success: true };
}

// ── Validate session (สำหรับ middleware) ────────────────────
async function getUserFromToken(token) {
  const sessionId = verifyToken(token);
  if (!sessionId) return null;

  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.email, u.full_name, u.role, u.enabled,
             u.must_change_password,
             s.expires_at, s.id AS session_id
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.revoked = false
    `, [sessionId]);
    const row = rows[0];
    if (!row || !row.enabled) return null;
    if (new Date(row.expires_at) < new Date()) return null;

    // Update last_used_at (async, ไม่รอ)
    pool.query('UPDATE sessions SET last_used_at = NOW() WHERE id = $1', [sessionId]).catch(() => {});

    return {
      id: row.id,
      username: row.username,
      email: row.email,
      full_name: row.full_name,
      role: row.role,
      must_change_password: row.must_change_password,
      session_id: row.session_id,
    };
  } catch (e) { return null; }
}

// ── Express middleware ──────────────────────────────────────

// SEC-004: paths ที่ user ที่ยังไม่เปลี่ยน default password ยังเข้าได้
const ALLOW_WHILE_MUST_CHANGE = new Set([
  '/api/auth/logout',
  '/api/auth/change-password',
  '/api/auth/me',
]);

function requireAuth(req, res, next) {
  // Internal service calls (report-renderer, scheduler) — the global /api
  // middleware has already validated X-Internal-Token and set req.internal.
  // Skip the session check so server-internal HTTP calls don't 401.
  if (req.internal === true) return next();

  const token = (req.cookies && req.cookies.session) || extractBearer(req);
  if (!token) return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });

  getUserFromToken(token).then(user => {
    if (!user) return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
    // SEC-004: block API calls จาก user ที่ยังไม่เปลี่ยน default password
    // ยกเว้นเฉพาะ logout / change-password / me เท่านั้น
    if (user.must_change_password && !ALLOW_WHILE_MUST_CHANGE.has(req.path)) {
      return res.status(403).json({ error: 'Must change password before using the API', code: 'MUST_CHANGE_PASSWORD' });
    }
    req.user = user;
    next();
  }).catch(() => res.status(500).json({ error: 'Auth error' }));
}

function requireAdmin(req, res, next) {
  if (req.internal === true) return next();
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
    next();
  });
}

// For admin-only GET/view endpoints that the read-only Auditor role
// also needs to see (Health, Users list, Audit Log, Backup list).
// Writes stay on requireAdmin — and the global auditor write-block
// rejects any non-GET from an auditor regardless.
function requireAdminOrAuditor(req, res, next) {
  if (req.internal === true) return next();
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'auditor') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    next();
  });
}

function extractBearer(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// ── Audit log ───────────────────────────────────────────────
async function logAudit(userId, username, action, targetUserId, targetUsername, ipAddress, userAgent, details, targetCameraId) {
  try {
    await pool.query(
      `INSERT INTO audit_log
         (user_id, username, action, target_user_id, target_username, target_camera_id, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [userId, username, action, targetUserId, targetUsername, targetCameraId || null, ipAddress, userAgent, JSON.stringify(details || {})]
    );
  } catch (e) { /* ignore */ }
}

// ── User CRUD (admin only) ──────────────────────────────────
async function listUsers() {
  const { rows } = await pool.query(`
    SELECT id, username, email, full_name, role, enabled,
           last_login_at, last_login_ip, failed_attempts, locked_until,
           must_change_password, created_at
    FROM users ORDER BY id
  `);
  return rows;
}

async function createUser({ username, password, email, full_name, role }, createdBy) {
  if (!username || !password) throw new Error('username + password required');
  if (!['admin', 'viewer', 'auditor'].includes(role)) throw new Error('role must be admin, viewer or auditor');
  const hash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, email, full_name, role, created_by, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id, username, role`,
    [username, hash, email || null, full_name || null, role, createdBy?.id || null]
  );
  await logAudit(createdBy?.id, createdBy?.username, 'user_create', rows[0].id, username, null, null, { role });
  return rows[0];
}

async function updateUser(id, updates, actor) {
  const allowedFields = ['email', 'full_name', 'role', 'enabled'];
  const sets = [];
  const values = [];
  let idx = 1;
  for (const f of allowedFields) {
    if (updates[f] !== undefined) {
      if (f === 'role' && !['admin', 'viewer', 'auditor'].includes(updates[f])) {
        throw new Error('role must be admin, viewer or auditor');
      }
      sets.push(`${f} = $${idx++}`);
      values.push(updates[f]);
    }
  }
  if (!sets.length) return null;
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, username, role, enabled`,
    values
  );
  if (rows[0]) {
    await logAudit(actor?.id, actor?.username, 'user_update', id, rows[0].username, null, null, updates);
  }
  return rows[0];
}

async function resetPassword(id, newPassword, actor) {
  if (!newPassword || newPassword.length < 8) throw new Error('Password ต้องอย่างน้อย 8 ตัวอักษร');
  const hash = await hashPassword(newPassword);
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $1, must_change_password = true,
       failed_attempts = 0, locked_until = NULL
     WHERE id = $2 RETURNING username`,
    [hash, id]
  );
  if (rows[0]) {
    // Revoke all sessions ของ user นี้ — ต้อง login ใหม่
    await pool.query('UPDATE sessions SET revoked = true WHERE user_id = $1', [id]);
    await logAudit(actor?.id, actor?.username, 'password_reset', id, rows[0].username, null, null, {});
  }
  return { success: true };
}

async function changeOwnPassword(userId, oldPassword, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error('Password ใหม่ต้องอย่างน้อย 8 ตัวอักษร');
  const { rows } = await pool.query('SELECT password_hash, username FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new Error('User not found');
  const valid = await verifyPassword(oldPassword, rows[0].password_hash);
  if (!valid) throw new Error('Password เดิมไม่ถูกต้อง');
  const hash = await hashPassword(newPassword);
  await pool.query(
    `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2`,
    [hash, userId]
  );
  await logAudit(userId, rows[0].username, 'password_change', userId, rows[0].username, null, null, {});
  return { success: true };
}

async function deleteUser(id, actor) {
  if (id === actor?.id) throw new Error('ลบบัญชีตัวเองไม่ได้');
  const { rows } = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
  if (!rows[0]) return { success: false };
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  await logAudit(actor?.id, actor?.username, 'user_delete', id, rows[0].username, null, null, {});
  return { success: true };
}

async function getAuditLog({ limit = 100, userId, action, targetCameraId } = {}) {
  const where = [];
  const values = [];
  let idx = 1;
  if (userId) { where.push(`user_id = $${idx++}`); values.push(userId); }
  if (action) { where.push(`action = $${idx++}`); values.push(action); }
  if (targetCameraId) { where.push(`target_camera_id = $${idx++}`); values.push(targetCameraId); }
  const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT $${idx}`;
  values.push(limit);
  const { rows } = await pool.query(sql, values);
  return rows;
}

async function getActiveSessions(userId) {
  const { rows } = await pool.query(`
    SELECT id, ip_address, user_agent, created_at, last_used_at, expires_at
    FROM sessions WHERE user_id = $1 AND revoked = false AND expires_at > NOW()
    ORDER BY last_used_at DESC
  `, [userId]);
  return rows;
}

async function revokeSession(sessionId, actor) {
  await pool.query('UPDATE sessions SET revoked = true WHERE id = $1', [sessionId]);
  await logAudit(actor?.id, actor?.username, 'session_revoke', null, null, null, null, { session_id: sessionId.slice(0, 8) });
  return { success: true };
}

module.exports = {
  init,
  login,
  logout,
  getUserFromToken,
  requireAuth,
  requireAdmin,
  requireAdminOrAuditor,
  hashPassword,
  verifyPassword,
  // User mgmt
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  changeOwnPassword,
  deleteUser,
  // Audit + sessions
  getAuditLog,
  getActiveSessions,
  revokeSession,
  logAudit,
};
