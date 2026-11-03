// ============================================================
// Vigil Platform — View authorization guard (allowlist, default-deny)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แกน "เห็นอะไร" ของสิทธิ์ 2 แกน (decision #249) — บังคับที่ server จริง ไม่ใช่ซ่อน UI
// เจ้าของกำหนดภัยคุกคามไว้ชัด: **คนร้ายที่ได้บัญชี operator ไปแล้ว** (ตั้งรหัสง่าย)
// ดังนั้นทุกอย่างที่กันแค่ฝั่งจอไม่นับ — คนที่มี cookie ยิง API ตรงได้อยู่ดี
//
// ── ทำไมเป็น allowlist ไม่ใช่ blocklist ──────────────────────
// route ในระบบมี 291 เส้น การ map ครบทุกเส้นแปลว่า route ที่ใครเพิ่มวันหน้าแล้วลืม map
// จะ **หลุดเงียบๆ** เป็นช่องโหว่ (แบบเดียวกับ GOTCHAS #162) ตรงข้ามกับ allowlist ที่
// route ใหม่ = ถูกปฏิเสธอัตโนมัติจนกว่าจะมีคนตั้งใจเพิ่มเข้า registry — fail closed
//
// ── ขอบเขต ─────────────────────────────────────────────────
// `allowed_views IS NULL` = ไม่จำกัด → next() ทันที ไม่มีค่าใช้จ่ายเพิ่ม (ผู้ใช้เดิมทุกคน
// รวม admin อยู่กลุ่มนี้) · `[]` = ไม่เห็นอะไรเลย แต่ยังได้ CORE_ROUTES เพื่อ logout/
// เปลี่ยนรหัสได้ ไม่งั้นบัญชีจะล็อกตัวเองออกจนแอดมินต้องเข้า DB แก้

'use strict';

const registry = require('../view-registry');

// routesFor() สร้าง array ใหม่ทุกครั้ง — guard นี้รันทุก request จึง cache ตามชุดสิทธิ์
// (ชุดสิทธิ์ต่างกันไม่กี่แบบในระบบจริง) invalidate ไม่ต้องทำ เพราะ key คือเนื้อสิทธิ์เอง
const _cache = new Map();
function allowedRoutes(views) {
  const key = JSON.stringify(views);
  let r = _cache.get(key);
  if (!r) {
    r = registry.routesFor(views);
    if (_cache.size > 200) _cache.clear();
    _cache.set(key, r);
  }
  return r;
}

// ผู้ตรวจสอบ (auditor) ต้องเห็นได้ทุกหน้า แต่แก้อะไรไม่ได้ — นโยบายเจ้าของ 2026-09-08
// (ยืนยันซ้ำกับข้อความบนแบนเนอร์ที่เขียนไว้ตั้งแต่แรกว่า "ดูได้ทุกหน้ารวมการตั้งค่า")
// การกัน "เขียน" อยู่คนละชั้นและยังอยู่ครบ: middleware /api ปฏิเสธทุก method ที่ไม่ใช่
// GET/HEAD/OPTIONS ให้ role นี้ · ที่นี่จึงข้ามเฉพาะแกน "เห็นหน้าไหน"
// ⚠️ ข้ามแค่แกนนี้แกนเดียว — แกน site scope (allowedSites) ยังบังคับตามเดิมทุกประการ
// admin ก็อยู่กลุ่มเดียวกัน — หน้าจอผู้ใช้ซ่อนตัวเลือก "หน้าที่เข้าถึงได้" ให้ทั้งสอง role
// (page-user-mgmt: `show = role === 'viewer'`) แปลว่ารายการที่ค้างอยู่กับบัญชีที่เคยเป็น
// viewer แล้วถูกเลื่อน role **แก้ผ่านหน้าจอไม่ได้อีกเลย** — ของจริงเจอ 1 บัญชี (id 977)
// ที่ยังถือรายการ 30 หน้าจากตอนเป็น viewer จึงเปิดหน้าตั้งค่าไม่ได้ทั้งที่แบนเนอร์บอกว่าได้
// (ไม่ล้างค่าใน DB ทิ้ง — ถ้าวันหน้าลด role กลับเป็น viewer รายการเดิมจะกลับมาใช้ทันที)
const _UNRESTRICTED_ROLES = new Set(['auditor', 'admin']);

function effectiveViews(user) {
  if (user && _UNRESTRICTED_ROLES.has(user.role)) return null;   // null = ไม่จำกัด
  return user ? user.allowed_views : null;
}

function denied(res) {
  // code นี้ให้ client แยกออกจาก 403 แบบอื่น (role/site) เพื่อขึ้นข้อความ
  // `restricted_view_message` ที่แอดมินตั้งไว้ แทน error ดิบ
  return res.status(403).json({
    error: 'This view is not permitted for your account',
    code: 'VIEW_NOT_ALLOWED',
  });
}

/**
 * @param {object} deps - { auth, getSessionToken, isValidInternalToken }
 * ใช้ 2 จุดใน api-server:
 *   1. ก่อน mount route ที่อยู่เหนือ global `/api` middleware (auth/users) — `req.user`
 *      ยังไม่ถูก set จึงต้อง resolve token เอง (route กลุ่มนี้ถูกเรียกไม่บ่อย)
 *   2. หลัง global middleware — `req.user` มีแล้ว ไม่เสีย round-trip เพิ่ม
 */
function viewGuard(deps) {
  const { auth, getSessionToken, isValidInternalToken } = deps;
  return async function viewGuardMiddleware(req, res, next) {
    try {
      // report renderer เรียกเข้ามาด้วย internal token ไม่มี user — ต้องผ่าน
      if (req.internal || (isValidInternalToken && isValidInternalToken(req))) return next();

      let user = req.user;
      if (!user) {
        const token = getSessionToken(req);
        if (!token) return next();              // ยังไม่ล็อกอิน → ให้ auth guard เดิม 401
        user = await auth.getUserFromToken(token);
        if (!user) return next();
      }
      const views = effectiveViews(user);
      if (views == null) return next();         // ไม่จำกัด = พฤติกรรมเดิม 100%
      if (!Array.isArray(views)) return denied(res);

      const p = (req.originalUrl || req.url).split('?')[0];
      return registry.pathAllowed(allowedRoutes(views), p) ? next() : denied(res);
    } catch (e) {
      // fail closed — ตัดสินสิทธิ์ไม่ได้ = ไม่ให้ผ่าน (เส้นทางนี้กระทบเฉพาะ user ที่ถูกจำกัด
      // เพราะ user ปกติออกไปตั้งแต่ `views == null` แล้ว)
      console.error('[viewGuard] ตัดสินสิทธิ์ไม่ได้ ปฏิเสธไว้ก่อน:', e.message);
      return denied(res);
    }
  };
}

/** เช็คตรงๆ สำหรับ handler ที่อยู่นอก `/api` (`/snapshots`, `/media` — GOTCHAS #163) */
function viewAllows(user, reqPath) {
  const views = effectiveViews(user);
  if (views == null) return true;
  if (!Array.isArray(views)) return false;
  return registry.pathAllowed(allowedRoutes(views), String(reqPath).split('?')[0]);
}

module.exports = { viewGuard, viewAllows, effectiveViews };
