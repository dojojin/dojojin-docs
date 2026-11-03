// ============================================================
// Vigil Platform — Signed public image links (LINE alert images)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ทำไมต้องมี: การแจ้งเตือนทุกใบต้อง "อัปภาพขึ้น imgbb ก่อน" แล้วส่ง URL ของ imgbb
// ให้ LINE · วัดจริง 2026-08-12: crop 20KB ใช้ 1.4 วิ · ภาพเต็มเฟรม 190KB ใช้ 7-10 วิ ·
// แจ้งเตือน LPR จริงเฉลี่ย 20-27 วิ (สูงสุด 51) — ทั้งหมดเป็นเวลาที่รอ imgbb
// ส่วนการดึงภาพจาก edge ข้ามอุโมงค์ใช้แค่ 255 มิลลิวินาที ไม่ใช่คอขวดเลย
//
// วิธีแก้: ไม่อัปโหลดเลย · ส่ง URL ของโดเมนเราเองที่ **เซ็นชื่อและมีวันหมดอายุ**
// แล้วให้ LINE มาดึงเองตอนจะแสดงผล — เวลาที่เพิ่มต่อการแจ้งเตือนเหลือ ~0
//
// ── ความปลอดภัย (คิดมาแล้ว ไม่ใช่เผลอเปิด) ────────────────────────────────
// • URL เดาไม่ได้ — ลายเซ็น HMAC-SHA256 ของ (path + วันหมดอายุ) ด้วย
//   SNAPSHOT_PROXY_SECRET ที่ใช้อยู่แล้ว · แก้ path หรือยืดอายุเอง = ลายเซ็นไม่ผ่าน
// • หมดอายุจริง — เกินเวลาแล้วตอบ 410 ไม่ใช่ 200
// • เทียบลายเซ็นด้วย timingSafeEqual กัน timing attack
// • ระดับความเสี่ยง **ไม่ได้แย่ลงกว่าเดิม**: ทุกวันนี้ภาพเดียวกันถูกอัปขึ้น imgbb
//   ซึ่งใครถือลิงก์ก็เปิดได้เหมือนกัน ต่างกันที่ของเดิมไปอยู่โฮสต์ต่างประเทศ 48 ชม.
//   ส่วนอันนี้อยู่บนเครื่องเรา และเราสั่งให้หมดอายุเมื่อไหร่ก็ได้

'use strict';

const crypto = require('crypto');
const env = require('../config');

function _secret() {
  return env.str('SNAPSHOT_PROXY_SECRET');
}

/** ลายเซ็นของ (path, วันหมดอายุ) — ผูกกับทั้งสองค่า แก้ค่าใดค่าหนึ่งก็ใช้ไม่ได้ */
function sign(file, exp) {
  return crypto.createHmac('sha256', _secret())
    .update(`${file}|${exp}`)
    .digest('base64url')
    .slice(0, 43);
}

/**
 * สร้างลิงก์สาธารณะให้ LINE มาดึงภาพ
 * คืน null เมื่อยังไม่ได้ตั้งค่า (ผู้เรียกจะตกกลับไปใช้ imgbb เอง)
 *
 * kind = 'img' → ไฟล์ใต้ SNAPSHOT_DIR (ภาพจากกล้อง, ภาพอ้างอิงป้ายทะเบียน)
 * kind = 'ref' → ไฟล์ใต้ PHOTO_DIR (ภาพอ้างอิงใบหน้าจากบัญชีดำ — คนละโฟลเดอร์กัน)
 * kind = 'rpt' → ไฟล์ใต้ REPORTS_DIR (PNG รายงานที่เรนเดอร์ด้วย Puppeteer)
 * kind = 'fil' → ไฟล์ใต้ FILES_DIR (เอกสาร/ภาพอัปโหลดโดยแอดมิน)
 * ลายเซ็นผูกกับ kind ด้วย จึงเอาลิงก์ของโฟลเดอร์หนึ่งไปอ่านอีกโฟลเดอร์ไม่ได้
 */
// ── ตัวระบุ "รุ่นของเนื้อไฟล์" สำหรับใส่ใน URL ────────────────
//
// ปัญหาที่แก้ (เจ้าของแจ้ง 2026-08-25): ต้นทางแก้รูปอ้างอิงของป้ายทะเบียนแล้ว
// ระบบเราซิงค์มาถูกต้องทุกชั้น (ตรวจแล้ว 31/31 md5 ตรงกัน) แต่บนหน้าจอยังเป็นรูปเก่า
// เพราะชื่อไฟล์ผูกกับ id ของรายการ ไม่ได้ผูกกับเนื้อรูป · เนื้อเปลี่ยนแต่ path เท่าเดิม
// และเราตอบ `Cache-Control: immutable, max-age=86400` เบราว์เซอร์จึงมีสิทธิ์ใช้ของเก่า
// ได้ถึง 24 ชม. โดยไม่ถามเซิร์ฟเวอร์เลย — ซึ่งถูกต้องตามที่เราสัญญาไว้ใน header
//
// วิธีแก้: ใส่ hash ของ "เนื้อไฟล์" ลงใน URL · เนื้อเปลี่ยน = URL คนละอัน = ทุกตัวที่
// cache ตาม URL ถูกบังคับให้โหลดใหม่เอง (เบราว์เซอร์ · CDN ของ LINE ตอนดึงครั้งใหม่ ·
// Puppeteer ตอนเรนเดอร์ PDF/PNG) โดยไม่ต้องไล่แก้ทีละที่ และยังคง immutable ไว้ได้
// เพราะตอนนี้ URL "แทนเนื้อหา" จริง ๆ ตามความหมายของ header
//
// ⚠️ ไม่รวมอยู่ในลายเซ็น — ตั้งใจ เพื่อให้ลิงก์ที่ mint ไปแล้ว (อยู่ในข้อความ LINE
// เก่า ๆ) ยังใช้ได้ และฝั่ง verify ไม่ต้องแก้อะไรเลย · `v` เป็นแค่ตัวหักล้าง cache
//
// mtime ใช้แทน hash ไม่ได้ (blacklistImport.savePhoto เขียนทับทุกรอบ mtime จึงขยับ
// ทั้งที่เนื้อเหมือนเดิม — วัดแล้ว 2026-08-22) แต่ใช้เป็น "กุญแจแคช" ได้: stat ถูกกว่า
// อ่านทั้งไฟล์มาก และถ้า mtime/ขนาดขยับโดยเนื้อไม่เปลี่ยน เราจะ hash ใหม่แล้วได้ค่าเดิม
// URL จึงไม่เปลี่ยน ซึ่งเป็นพฤติกรรมที่ถูกต้อง
const fs = require('fs');
const path = require('path');

const _verCache = new Map();

function _baseDirFor(kind) {
  const H = __dirname;                       // src/helpers
  if (kind === 'img') return require('./snapshotDir').snapshotDir();
  if (kind === 'ref') return path.join(H, '..', '..', 'blacklist-photos');
  if (kind === 'rpt') return path.join(H, '..', '..', 'reports');
  if (kind === 'fil') return path.join(H, '..', '..', 'files');
  return null;
}

// คืน hash สั้น ๆ ของเนื้อไฟล์ · หาไฟล์ไม่เจอ = คืน null แล้วไม่ใส่ v ลง URL
// (ภาพบางใบอยู่ที่ edge ไม่ได้อยู่บนเครื่องนี้ — ต้องไม่พังและต้องไม่ทำให้ช้า)
function contentVersion(file, kind) {
  const base = _baseDirFor(kind);
  if (!base || !file) return null;
  const abs = path.join(base, String(file).replace(/^\/+/, ''));
  if (!abs.startsWith(base)) return null;
  try {
    const st = fs.statSync(abs);
    const hit = _verCache.get(abs);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.ver;
    const ver = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 10);
    if (_verCache.size > 2000) _verCache.clear();
    _verCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, ver });
    return ver;
  } catch { return null; }
}

// ── ภาพที่ไม่ได้อยู่บนดิสก์ (ค้นหาอัจฉริยะ) ────────────────────────
//
// ภาพของ AcuSeek เป็น URL ภายในของเครื่องค้นที่ภูเก็ต ไม่ใช่ไฟล์ในโฟลเดอร์เรา
//   http://10.0.10.12:6120/isapiHikStor?id=...&len=...&token=...&PoolID=...
//
// 🔴 URL นั้นมี `token=` ของเครื่องเก็บภาพอยู่ในตัว ⇒ **ห้ามเอาไปวางใน URL สาธารณะ
//    แบบอ่านออก** (base64 = อ่านออก) เพราะข้อความ LINE เดินทางผ่านเซิร์ฟเวอร์ของ LINE
//    และค้างอยู่ในเครื่องของทุกคนในห้อง ⇒ ปิดผนึกด้วย AES-256-GCM ด้วยกุญแจที่ได้จาก
//    SNAPSHOT_PROXY_SECRET · ฝั่งเปิดผนึกยังต้องตรวจรูปแบบ URL ซ้ำอีกชั้นเสมอ (กัน SSRF
//    ถ้ากุญแจหลุด) และลายเซ็น+วันหมดอายุยังทำงานเหมือน kind อื่นทุกประการ
const _key = () => crypto.createHash('sha256').update(_secret()).digest();

/** ปิดผนึก URL ภายในให้กลายเป็นก้อนที่อ่านไม่ออกและปลอมไม่ได้ */
function sealUrl(url) {
  if (!_secret() || !url) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', _key(), iv);
  const enc = Buffer.concat([c.update(String(url), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

/** เปิดผนึกกลับ — คืน null ถ้าก้อนถูกแก้ หรือกุญแจไม่ตรง */
function openUrl(blob) {
  try {
    const raw = Buffer.from(String(blob || ''), 'base64url');
    if (raw.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', _key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { return null; }
}

function signedImageUrl(file, ttlSec, kind = 'img') {
  // FILES_PUBLIC_URL = separate host for files (https://upl.dojojin.tech), with fallback to dashboard.
  // Reason: files will eventually be served from a different hostname that does NOT carry the session
  // cookie (reducing XSS surface), but that tunnel doesn't exist yet. Fall back to dashboard host so
  // the feature works today; when the upload hostname is ready, swap FILES_PUBLIC_URL.
  const base = (kind === 'fil')
    ? (env.str('FILES_PUBLIC_URL') || env.str('DASHBOARD_PUBLIC_URL'))
    : env.str('DASHBOARD_PUBLIC_URL');
  if (!base || !_secret() || !file) return null;
  if (!['img', 'ref', 'rpt', 'fil', 'seek'].includes(kind)) return null;
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSec) || 172800);
  const f = String(file).replace(/^\/+/, '');
  const ver = contentVersion(f, kind);
  return `${base.replace(/\/+$/, '')}/pub/${kind}/${f.split('/').map(encodeURIComponent).join('/')}` +
         `?exp=${exp}&sig=${sign(`${kind}:${f}`, exp)}${ver ? `&v=${ver}` : ''}`;
}

/**
 * ตรวจลายเซ็น — คืน { ok } หรือ { ok:false, status, reason }
 * แยก 410 (หมดอายุ) ออกจาก 403 (ลายเซ็นผิด) เพื่อให้ debug ได้ว่าเป็นคนละเรื่องกัน
 */
function verifySignedRequest(file, exp, sig, kind = 'img') {
  if (!_secret()) return { ok: false, status: 503, reason: 'ยังไม่ได้ตั้ง SNAPSHOT_PROXY_SECRET' };
  if (!['img', 'ref', 'rpt', 'fil', 'seek'].includes(kind)) {
    return { ok: false, status: 400, reason: 'invalid kind' };
  }
  const e = Number(exp);
  if (!Number.isFinite(e) || !sig) return { ok: false, status: 403, reason: 'พารามิเตอร์ไม่ครบ' };
  if (e * 1000 < Date.now()) return { ok: false, status: 410, reason: 'ลิงก์หมดอายุ' };
  const want = sign(`${kind}:${String(file).replace(/^\/+/, '')}`, e);
  const a = Buffer.from(String(sig));
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 403, reason: 'ลายเซ็นไม่ถูกต้อง' };
  }
  return { ok: true };
}


// ── ทางสำรอง: ตรวจก่อนว่าลิงก์ของเราใช้ได้จริง ─────────────────────────────
//
// เดิมมีทางสำรองกรณีเดียว — signedImageUrl() คืน null เพราะ env ไม่ได้ตั้ง
// อีก 3 กรณีหลุดหมด แล้ว LINE จะได้ลิงก์เสีย การ์ดขึ้นรูปว่าง ไม่มี log อะไรเลย:
//   403 = SNAPSHOT_PROXY_SECRET ไม่ตรงกันข้ามเครื่อง (หมุนกุญแจไม่ครบ 4 เครื่อง)
//   404 = ไฟล์ไม่อยู่ทั้ง central และ edge / ถูกลบตาม retention
//   502 = edge ไม่ตอบ
//
// ยิงเช็คที่ 127.0.0.1 ไม่ผ่าน Cloudflare — วัดจริง 2026-08-13: localhost ~91ms
// (ผ่าน Cloudflare 43-452ms แพงเกินจะทำต่อการแจ้งเตือน) · 404 ตอบกลับใน 197ms
//
// ⚠️ กฎสำคัญ: **timeout ไม่นับว่าพัง** — /pub/img มีทางไปดึงจาก edge ซึ่งกินได้ถึง
// 8 วินาที ถ้าตีความว่า "ช้า = พัง" ภาพจาก edge ทุกใบจะถูกโยนไป imgbb ทั้งที่ของเรา
// ใช้ได้ · เอาไปแค่ error ที่ตอบกลับมาชัดเจนเท่านั้น (LINE มีเวลารอของตัวเองอยู่แล้ว)
const PREFLIGHT_MS = 1500;

function _localUrl(url) {
  const base = env.str('DASHBOARD_PUBLIC_URL');
  if (!base || !url.startsWith(base)) return null;
  return url.replace(base.replace(/\/+$/, ''), `http://127.0.0.1:${env.int('PORT')}`);
}

/**
 * คืน URL เดิมถ้าใช้ได้ · คืน null พร้อมเหตุผลถ้าเสีย (ผู้เรียกตกไป imgbb)
 * คืน { url, reason } เสมอ เพื่อให้ผู้เรียกบันทึกได้ว่าทำไมถึงเปลี่ยนทาง
 */
async function preflight(url) {
  const local = _localUrl(url);
  if (!local) return { url, reason: null };   // ไม่ใช่ลิงก์ของเรา — ไม่ต้องตรวจ
  try {
    const r = await fetch(local, { method: 'HEAD', signal: AbortSignal.timeout(PREFLIGHT_MS) });
    if (r.ok) return { url, reason: null };
    return { url: null, reason: `http_${r.status}` };
  } catch (e) {
    // timeout / ECONNREFUSED — ตอบไม่ได้ว่าพังจริงไหม จึงใช้ลิงก์เราต่อ แต่บอกให้รู้
    console.warn('[signedImage] preflight ไม่สรุป:', e?.name || e?.message);
    return { url, reason: null };
  }
}

/** signedImageUrl + preflight ในตัวเดียว — ใช้แทน signedImageUrl ในเส้นทางส่งจริง */
async function usableSignedUrl(file, ttlSec, kind = 'img') {
  const url = signedImageUrl(file, ttlSec, kind);
  if (!url) return { url: null, reason: 'not_configured' };
  return preflight(url);
}

// อายุลิงก์เซ็นชื่อจาก system_settings.signed_image_expire_hours (1..720 ชม.)
// ค่านอกช่วง/ไม่ใช่ตัวเลข → fallback 48 ชม. — ตัวเดียวใช้ทั้ง alert-engine, lprLineAlert
// และ report-worker (2026-09-07: เดิม report-worker hardcode 172800 สองจุดและไม่อ่าน setting)
function ttlSecFromHours(value, fallbackSec = 172800) {
  const h = parseInt(value, 10);
  return (Number.isFinite(h) && h >= 1 && h <= 720) ? h * 3600 : fallbackSec;
}

module.exports = {
  sealUrl,
  openUrl,
  ttlSecFromHours,
  contentVersion, signedImageUrl, verifySignedRequest, sign, usableSignedUrl, preflight };
