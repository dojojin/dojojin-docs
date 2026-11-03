// ============================================================
// Vigil Platform — Audit trail ของการตั้งค่า (ใครตั้ง · ใครเปลี่ยน · เปลี่ยนอะไร)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// เจ้าของขอ 2026-10-14 ตอนเปิดให้ Site Admin ตั้งกฎแจ้งเตือน/ตารางรายงาน/รายการเฝ้าระวังเอง:
// "ต้องมี audit logs ให้รู้ว่าใครเป็นคนเซ็ต เป็นคนเปลี่ยน" — ใช้กับทุก role ไม่ใช่แค่ site_admin
// เก็บเฉพาะช่องที่เปลี่ยน (before/after) · ช่องที่เป็นความลับเก็บแค่ว่า "เปลี่ยน" ไม่เก็บค่า
// ไม่เคยโยน error — audit ล้มต้องไม่ทำให้การบันทึกที่สำเร็จแล้วกลายเป็นล้มเหลว

const SECRET_RE = /pass|token|secret|_enc$/i;
const SKIP = new Set(['updated_at', 'created_at']);

const mask = (k, v) => (SECRET_RE.test(k) && v != null && v !== '' ? '***' : v);

function changedFields(before, after) {
  const out = {};
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (SKIP.has(k)) continue;
    const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    out[k] = SECRET_RE.test(k) ? { changed: true } : { before: a ?? null, after: b ?? null };
  }
  return out;
}
const snapshotOf = (row) => Object.fromEntries(Object.entries(row || {}).filter(([k]) => !SKIP.has(k)).map(([k, v]) => [k, mask(k, v)]));

/**
 * @param {object} req      express req (ใช้ user / ip / user-agent)
 * @param {string} action   เช่น 'alert_rule_update'
 * @param {object} o        { before, after, target, extra } — มีทั้งคู่ = แก้ไข · after อย่างเดียว = สร้าง · before อย่างเดียว = ลบ
 */
async function auditChange(req, action, { before = null, after = null, target = null, extra = {} } = {}) {
  try {
    const details = { actor_role: req.user?.role || null, ...(target != null ? { target } : {}), ...extra };
    if (before && after) {
      details.changed = changedFields(before, after);
      if (!Object.keys(details.changed).length) return;      // บันทึกค่าเดิมซ้ำ ไม่นับเป็นการเปลี่ยน
    } else if (after) details.created = snapshotOf(after);
    else if (before) details.deleted = snapshotOf(before);
    const ip = (req.headers?.['cf-connecting-ip'] || '').trim() || req.ip || null;
    await require('../auth').logAudit(req.user?.id || null, req.user?.username || 'system', action,
      null, null, ip, req.headers?.['user-agent'] || null, details);
  } catch (e) { console.warn('[audit]', action, e.message); }
}

module.exports = { auditChange, changedFields };
