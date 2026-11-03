// ============================================================
// Vigil Platform — External link allowlist (Google Drive / OneDrive)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ลิงก์สั้นของระบบแชร์ไฟล์ redirect ออกไปได้เฉพาะโฮสต์ในรายการนี้ (migration 287) — กันกลายเป็น open redirect
// ตรวจทั้งตอนบันทึก (routes/files.js) และตอนเสิร์ฟ (routes/media-files.js) · เทียบชื่อโฮสต์ตรงตัว ไม่ใช่ endsWith
'use strict';

const HOSTS = {
  'drive.google.com': 'gdrive',
  'docs.google.com': 'gdrive',
  'onedrive.live.com': 'onedrive',
  '1drv.ms': 'onedrive',
};
const SP_PERSONAL = /^[a-z0-9-]+-my\.sharepoint\.com$/;   // OneDrive for Business — ไม่มีจุดในส่วนหน้า กัน sub.x-my.sharepoint.com
const MAX_LEN = 2048;

function normalizeTarget(input) {
  if (typeof input !== 'string') return { ok: false, error: 'url required' };
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'url required' };
  if (raw.length > MAX_LEN) return { ok: false, error: `url longer than ${MAX_LEN}` };
  let u;
  try { u = new URL(raw); } catch { return { ok: false, error: 'invalid url' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'https only' };
  if (u.username || u.password) return { ok: false, error: 'credentials in url not allowed' };
  if (u.port !== '') return { ok: false, error: 'custom port not allowed' };
  const host = u.hostname;
  const provider = HOSTS[host] || (SP_PERSONAL.test(host) ? 'onedrive' : null);
  if (!provider) return { ok: false, error: 'only Google Drive / OneDrive links are allowed' };
  if (u.href.length > MAX_LEN) return { ok: false, error: `url longer than ${MAX_LEN}` };
  return { ok: true, url: u.href, host, provider };
}

module.exports = { normalizeTarget };
