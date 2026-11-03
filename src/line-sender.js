// ============================================================
// Vigil Platform — LINE Sender Module
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// LINE Messaging API + imgbb upload
// ============================================================

const https = require('https');
const fs = require('fs');
const path = require('path');
const env = require('./config');

const { snapshotDir } = require('./helpers/snapshotDir');
const { watchLabel } = require('./helpers/hcpRemark');
const SNAPSHOT_DIR = snapshotDir();
const { edgeProxyBaseUrl } = require('./helpers/edgeProxyBaseUrl');
// ภาพอ้างอิงของบัญชีดำอยู่บนดิสก์ที่นี่ (ตัวเดียวกับที่ /api/blacklist/photo เสิร์ฟ)
const { PHOTO_DIR } = require('./helpers/blacklistImport');
const { faceAppearanceTh } = require('./helpers/hcpFaceLabels');
const { usableSignedUrl } = require('./helpers/signedImage');
const { mirrorPairSql, fallbackWhereSql } = require('./helpers/faceRefLookup');
const { getSystemSetting } = require('./helpers/getSystemSetting');

// ── Format message text ─────────────────────────────────────
/**
 * ความเชื่อมั่นของ event → เปอร์เซ็นต์ (0-100) · คืน null ถ้าไม่มีค่า
 *
 * ปัญหาที่แก้ (2026-08-13): ระบบมีสองที่ที่ตีความเลขตัวนี้ และตีความไม่ตรงกัน
 *   · formatMessage           คูณ 100 เสมอ → ถือว่าเป็นสเกล 0-1
 *   · belowMinLikelihood      เทียบดิบกับ min_likelihood ที่หน้าจอรับเป็น % (0-100)
 * ผลคือกฎที่ตั้ง "ขั้นต่ำ 60%" จะเทียบ 0.95 < 60 แล้ว **บล็อกทุก event**
 * ทั้งที่กล้องมั่นใจ 95%
 *
 * วัดของจริง 2026-08-13 (15,454 แถวใน 24 ชม.): ทุกแถวอยู่ในช่วง 0.05–1.000
 * ไม่มีแถวไหนเกิน 1 เลย · เกณฑ์ `<= 1 คือสเกล 0-1` จึงตรงกับข้อมูลจริง และเป็น
 * เกณฑ์เดียวกับที่ alert-engine ใช้กับ similarity ของ HCP อยู่แล้ว
 */
function likelihoodPct(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? n * 100 : n;
}

function formatMessage(template, event) {
  const time = new Date(event.event_time || Date.now()).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const lhPct = likelihoodPct(event.likelihood);
  const likelihood = lhPct === null ? '?' : Math.round(lhPct) + '%';
  // ตารางค่า แทนการต่อ .replace() เป็นสาย — ต้องรู้ทีละบรรทัดว่าตัวแปรในบรรทัดนั้น
  // ว่างหมดหรือเปล่า ถึงจะตัดบรรทัดที่เหลือแต่ป้ายกำกับออกได้ (2026-08-13)
  const V = {
    // {camera} = real camera name (camera_name from cameras-config.json),
    // falling back to camera_id only if the name is missing.
    camera: event.camera_name || event.camera_id || 'Unknown',
    // {camera_id} kept available for templates that still want the raw id.
    camera_id: event.camera_id || 'Unknown',
    // {location} = ตำแหน่งติดตั้งกล้อง (location from config); '-' if unset.
    location: event.location || '-',
    rule: event.rule_name || 'Unknown',
    time,
    object_class: event.object_class || 'Unknown',
    likelihood,
    event_type: event.event_type || '',
    // {duration} — dwell alert (migration 044): "อยู่มานานเท่าไหร่แล้ว"
    duration: event.duration_text || '-',
    person_name: event.person_name || '-',
    match_confidence: event.match_confidence || '-',
    // ── ใบหน้า/บัญชีดำ (2026-08-12) — เจ้าของแจ้งว่าแจ้งเตือนเดิมบอกแค่ "Person (91%)"
    //    ตัดสินใจไม่ได้ว่าเป็นใคร อยู่บัญชีไหน · alert-engine เติมค่าให้เมื่อ template ขอ
    watchlist: event.watchlist || '-',
    // similarity ของ HCP มาเป็น 0-1 · engine แปลงเป็น % ให้แล้ว
    similarity: event.similarity_pct || likelihood,
    // ── ป้ายทะเบียน (2026-08-13) — เดิมข้อความ LPR ประกอบตายตัวใน buildAlertText
    //    ค่าทั้งหมดนี้ sendLprAlert อ่านมาอยู่แล้ว แค่ไม่เคยส่งต่อ
    //    ⚠️ ป้ายทะเบียนยังอยู่ใน subtitle ของการ์ดด้วย (buildLprFlexAlert) —
    //    template ที่ไม่ใส่ {plate} จึงไม่ทำให้ป้ายหายไปจากการ์ด
    plate: event.plate || '-',
    region: event.region || '',
    group: event.group_name || '-',
    site: event.site_name || '-',
    vehicle: event.vehicle_desc || '-',
    note: event.note || '-',
    // ── ชุดข้อมูลอ้างอิงจากฐานข้อมูลเฝ้าระวัง — แปลเป็นคำที่อ่านออกแล้วที่
    //    helpers/lprRefLabels · ที่นี่แค่วาง
    //    ว่าง = '' ไม่ใช่ '-' โดยตั้งใจ: บล็อกนี้เป็นข้อมูลเสริม บรรทัดที่โรสเตอร์
    //    ไม่ได้กรอกจะถูกตัดทิ้งทั้งบรรทัดตามกติกาด้านล่าง แทนที่จะขึ้น '-' เรียงกัน
    //    จนดูเหมือนระบบพัง
    ref_vehicle: event.ref_vehicle || '',       // ยี่ห้อ · ประเภท · สี (ชุดรวม)
    ref_brand: event.ref_brand || '',
    ref_type: event.ref_type || '',
    ref_color: event.ref_color || '',
    ref_plate: event.ref_plate || '',           // เลขป้ายตามฐานข้อมูล
    ref_plate_type: event.ref_plate_type || '', // สี/ชนิดป้าย
    ref_province: event.ref_province || '',
    ref_case: event.ref_case || '',
    ref_detail: event.ref_detail || '',
    ref_unit: event.ref_unit || '',
    ref_group: event.ref_group || event.ref_tier || '',
    ref_tier: event.ref_tier || '',
    ref_updated: event.ref_updated || '',
    // ── บัญชีดำใบหน้า (2026-08-26) — สองช่องนี้กรอกครบทั้งโรสเตอร์ แต่ยังไม่เคย
    //    มีทางออกไปถึงข้อความที่คนเขียน template เองเลย
    ref_note: event.ref_note || '',   // case_note — รูปพรรณ/บันทึกของเจ้าหน้าที่
    ref_id: event.ref_id || '',       // external_id — รหัสอ้างอิงกลับไปต้นทาง
  };

  const PH = /\{([a-z_]+)\}/g;
  const out = String(template).split('\n').filter((line) => {
    // บรรทัดที่ "มีตัวแปร และตัวแปรทุกตัวว่าง" = บรรทัดที่เหลือแต่ป้ายกำกับ → ตัดทิ้ง
    // บรรทัดที่ไม่มีตัวแปรเลย (หัวข้อ/เส้นคั่น/บรรทัดว่าง) เก็บไว้เสมอ
    const names = [...line.matchAll(PH)].map(m => m[1]).filter(n => n in V);
    return names.length === 0 || names.some(n => String(V[n]) !== '');
  }).map(line => line.replace(PH, (m, n) => (n in V ? String(V[n]) : m))).join('\n');

  return out.substring(0, 4900); // LINE max 5000 chars (กันเกิน)
}

// ── Upload a base64 image to imgbb ──────────────────────────
// Core used by both the file-based (snapshot) and buffer-based (report
// image) uploaders. expiration=172800 → imgbb auto-deletes after 48h
// (privacy — same as the alert-snapshot path).
// imgbb deletes the image itself after this many seconds. 48h has been the
// hardcoded value for every alert; LPR now overrides it, because a plate photo
// sitting on a third-party host is a different kind of data from a "someone
// walked past the door" frame. imgbb's own accepted range is 60s..180d, so a
// value outside it would make the whole upload fail rather than fall back to a
// default — clamp instead.
const IMGBB_EXPIRE_DEFAULT_SEC = 172800;   // 48h
const IMGBB_EXPIRE_MIN_SEC = 60;
const IMGBB_EXPIRE_MAX_SEC = 15552000;     // 180 days

function _clampExpire(sec) {
  const n = parseInt(sec, 10);
  if (!Number.isFinite(n)) return IMGBB_EXPIRE_DEFAULT_SEC;
  return Math.min(IMGBB_EXPIRE_MAX_SEC, Math.max(IMGBB_EXPIRE_MIN_SEC, n));
}

function _imgbbUpload(imageBase64, imgbbKey, expireSec) {
  return new Promise((resolve) => {
    if (!imgbbKey || !imageBase64) return resolve(null);
    try {
      const postData = `key=${imgbbKey}&image=${encodeURIComponent(imageBase64)}&expiration=${_clampExpire(expireSec)}`;
      const req = https.request({
        hostname: 'api.imgbb.com',
        port: 443,
        path: '/1/upload',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 20000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            if (data.success && data.data?.url) resolve(data.data.url);
            else { console.error('🔔 imgbb upload failed:', data.error?.message); resolve(null); }
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.write(postData);
      req.end();
    } catch { resolve(null); }
  });
}

// ── Upload snapshot file to imgbb ───────────────────────────
// Local-first, then Tier-2 edge proxy (same fetch pattern as api-server:466).
// Which edge holds this camera's images. api-server's /snapshots route has done
// this per camera since edge sites existed; this function was the one image path
// that never got the memo and read a single SNAPSHOT_PROXY_URL instead — pointed
// at VSS. Every alert from Phuket or Hat Yai therefore found no file and fell
// back to text, silently, because the fallback is a legitimate outcome.
//
// Resolved HERE rather than passed in by each caller: there are three callers
// (LPR, and two in alert-engine) and one of them getting it wrong is exactly the
// failure this replaces.
async function _siteCodeForCamera(pool, cameraId) {
  if (!pool || !cameraId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT s.code FROM cameras c JOIN sites s ON s.id = c.site_id WHERE c.id = $1`,
      [cameraId]);
    const code = rows[0]?.code;
    // 'main' is central itself — its files are on local disk, no proxy needed.
    return code && code !== 'main' ? code : null;
  } catch (e) { console.warn('🔔 site lookup for snapshot:', e.message); return null; }
}

async function uploadToImgbb(snapshotFilename, imgbbKey, { siteCode = null, expireSec } = {}) {
  if (!snapshotFilename || !imgbbKey) return null;
  const filePath = path.join(SNAPSHOT_DIR, snapshotFilename);
  let b64;
  if (fs.existsSync(filePath)) {
    try { b64 = fs.readFileSync(filePath, 'base64'); } catch { return null; }
  } else {
    // Per-site tunnel when we know the site; the old single URL otherwise, so a
    // deployment that never had sites keeps working unchanged.
    const u = siteCode
      ? edgeProxyBaseUrl(siteCode, env.str('SNAPSHOT_PROXY_DOMAIN'))
      : env.str('SNAPSHOT_PROXY_URL');
    const s = env.str('SNAPSHOT_PROXY_SECRET');
    if (!u || !s) return null;
    try {
      const up = await fetch(
        `${u}/snapshots/${encodeURIComponent(snapshotFilename).replace(/%2F/g, '/')}`,
        { headers: { Authorization: `Bearer ${s}` }, signal: AbortSignal.timeout(8000) }
      );
      if (!up.ok) { console.warn(`🔔 snapshot ${up.status} from ${siteCode || 'default'} for ${snapshotFilename}`); return null; }
      b64 = Buffer.from(await up.arrayBuffer()).toString('base64');
    } catch (e) { console.warn(`🔔 snapshot fetch (${siteCode || 'default'}):`, e?.message || e); return null; }
  }
  return _imgbbUpload(b64, imgbbKey, expireSec);
}

// ── Upload an in-memory image Buffer to imgbb ───────────────
// Used by the scheduled-report path (Puppeteer renders a PNG buffer —
// never touches disk before upload).
function uploadBufferToImgbb(buffer, imgbbKey) {
  if (!buffer || !buffer.length) return Promise.resolve(null);
  return _imgbbUpload(buffer.toString('base64'), imgbbKey);
}

// ── Push message to LINE ────────────────────────────────────
function pushLineMessage(token, recipientId, messages) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ to: recipientId, messages });

    const req = https.request({
      hostname: 'api.line.me',
      port: 443,
      path: '/v2/bot/message/push',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const request_id = res.headers['x-line-request-id'] || null;
        const http_status = res.statusCode;
        if (res.statusCode === 200) {
          resolve({ success: true, request_id, http_status });
        } else {
          let errMsg = `HTTP ${res.statusCode}`;
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString());
            errMsg = body.message || errMsg;
            if (body.details && body.details.length) {
              errMsg += ': ' + body.details.map(d => d.message).join(', ');
            }
          } catch {}
          resolve({ success: false, error: errMsg, request_id, http_status });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message, request_id: null, http_status: null }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout', request_id: null, http_status: null }); });
    req.write(postData);
    req.end();
  });
}

// ── Reply to a LINE webhook event ───────────────────────────
// replyToken is single-use and short-lived. Used only inside the webhook
// flow to acknowledge self-service registration.
function replyLineMessage(token, replyToken, messages) {
  return new Promise((resolve) => {
    if (!token || !replyToken) return resolve({ success: false, error: 'missing token/replyToken' });
    const postData = JSON.stringify({ replyToken, messages });
    const req = https.request({
      hostname: 'api.line.me',
      port: 443,
      path: '/v2/bot/message/reply',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200) return resolve({ success: true });
        let errMsg = `HTTP ${res.statusCode}`;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          errMsg = body.message || errMsg;
        } catch {}
        resolve({ success: false, error: errMsg });
      });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
    req.write(postData);
    req.end();
  });
}

function _lineGetJson(token, pathName) {
  return new Promise((resolve) => {
    if (!token) return resolve(null);
    const req = https.request({
      hostname: 'api.line.me',
      port: 443,
      path: pathName,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function getLineUserProfile(token, userId) {
  return _lineGetJson(token, `/v2/bot/profile/${encodeURIComponent(userId)}`);
}

function getLineGroupSummary(token, groupId) {
  return _lineGetJson(token, `/v2/bot/group/${encodeURIComponent(groupId)}/summary`);
}

// โปรไฟล์ของ "คนในกลุ่ม" — คนละ endpoint กับ getLineUserProfile ซึ่งใช้ได้เฉพาะคนที่
// แอดบอทเป็นเพื่อนแล้ว · คนที่พิมพ์ในกลุ่มส่วนใหญ่ไม่เคยแอดบอท ⇒ ถ้าไม่มีตัวนี้
// หน้าตั้งค่าจะขึ้นเป็นรหัส 33 ตัวอักษรล้วน ๆ ให้เลือก ซึ่งเลือกไม่ถูก
function getLineGroupMemberProfile(token, groupId, userId) {
  return _lineGetJson(token,
    `/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`);
}

async function getLineQuota(token) {
  const [quota, consumption] = await Promise.all([
    _lineGetJson(token, '/v2/bot/message/quota'),
    _lineGetJson(token, '/v2/bot/message/quota/consumption'),
  ]);
  if (!quota) return null;
  return {
    type: quota.type,           // 'limited' | 'none'
    limit: quota.value ?? null, // null เมื่อ type='none' (unlimited)
    used: consumption?.totalUsage ?? 0,
  };
}

// ── Test connection (สำหรับ Settings tab) ────────────────────
function testConnection(token, recipientId) {
  return pushLineMessage(token, recipientId, [{
    type: 'text',
    text: '✅ Vigil Platform\nLINE notification ทดสอบสำเร็จ!\n\nระบบเชื่อมต่อพร้อมใช้งาน 🎉'
  }]);
}

// ── Build a Flex bubble combining the snapshot image and alert text into a
//    single LINE message object. Replaces the old text-then-image pair that
//    cost 2 messages per alert — LINE bills by `messages[]` length, so a
//    Flex bubble halves the quota cost. Image stays a real image (tap to
//    zoom via the action URI); text stays selectable; altText is shown in
//    the recipient's chat list and notification banner (max 400 chars).
function buildFlexAlert(messageText, imageUrl, event) {
  const firstLine = (messageText.split('\n')[0] || '🚨 แจ้งเตือน').trim();
  const camTag = event.camera_name ? ` · ${event.camera_name}` : '';
  const altText = (firstLine + camTag).substring(0, 400);

  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: imageUrl,
        size: 'full',
        aspectRatio: '16:9',
        aspectMode: 'cover',
        action: { type: 'uri', uri: imageUrl },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: messageText, wrap: true, size: 'md' },
        ],
        paddingAll: 'md',
      },
    },
  };
}
// ── ชิ้นส่วนของการ์ดแจ้งเตือน ────────────────────────────────────────────────
// แยกเป็นตัวช่วยเล็ก ๆ เพราะการ์ดสองใบ (ป้ายทะเบียน / ใบหน้า) ต้องหน้าตาเหมือนกัน
// เป๊ะ ๆ — ถ้าประกอบ JSON ซ้ำสองที่ วันหนึ่งจะเพี้ยนกันเองโดยไม่มีใครสังเกต
const FLEX_ACCENT = '#c92a2a';   // แดงเข้ม — ใช้กับแถบบน ป้ายกลุ่ม และปุ่ม
const FLEX_CHIP_BG = '#fff0f0';

// ป้ายกลุ่ม — ใช้ "ชื่อกลุ่มที่เจ้าหน้าที่ตั้งเอง" ไม่ใช่คำว่า "อันตราย" ที่เราแต่งขึ้น
// เหตุผล: กลุ่มมี "รถทดสอบระบบ" ปนอยู่ด้วย ถ้าทุกใบขึ้นว่าอันตราย คำนั้นจะหมด
// ความหมายภายในสัปดาห์เดียว และการ์ดทดสอบจะดูเหมือนเหตุฉุกเฉิน
function _flexChip(text, accent = FLEX_ACCENT, bg = FLEX_CHIP_BG) {
  return {
    type: 'box', layout: 'baseline', backgroundColor: bg, cornerRadius: '4px',
    paddingAll: '4px', paddingStart: '8px', paddingEnd: '8px',
    contents: [{ type: 'text', text: String(text), size: 'xxs', weight: 'bold', color: accent, flex: 0 }],
  };
}

// หัวข้อส่วน — ตัวเล็กสีเทา + เส้นคั่น แทนการวาด ——— ด้วยตัวอักษร
function _flexSection(title) {
  return {
    type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
    contents: [
      { type: 'text', text: String(title), size: 'xxs', weight: 'bold', color: '#868e96' },
      { type: 'separator', color: '#e9ecef' },
    ],
  };
}

// แถวหัวข้อ/ค่า — flex 4:7 คือคอลัมน์ซ้ายกว้างคงที่พอให้กวาดตาลงมาเจอค่าได้
// ไม่ใช่ตัดตามความยาวคำ
//
// 🔴 ต้องเป็น 'horizontal' ไม่ใช่ 'baseline' ถึงแม้ baseline จะจัดเส้นฐานสวยกว่า:
// baseline ของ LINE **ไม่รองรับ wrap** — ข้อความยาวโดนตัดหายเงียบ ๆ ไม่ใช่ตัดบรรทัด
// ข้อมูลจริงมีแถวที่ยาวเกินหนึ่งบรรทัดแน่ ๆ อย่างน้อยหนึ่งแถวคือ
//   "แจ้งเหตุที่  สภ.ถลาง ร.ต.อ. เกรียงไกร ดาวกระจาย 0909157747"
// ซึ่งลงท้ายด้วย**เบอร์โทรที่เจ้าหน้าที่ต้องกด** — ตัวที่จะหายไปเป็นตัวแรกพอดี
// ตัวอักษรสองคอลัมน์ขนาด xs เท่ากัน จัดชิดบนแล้วแทบไม่ต่างจาก baseline อยู่แล้ว
function _flexRow(label, value, strong = false) {
  if (value == null || String(value).trim() === '') return null;
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'sm',
    contents: [
      { type: 'text', text: String(label), size: 'xs', color: '#adb5bd', flex: 4 },
      { type: 'text', text: String(value), size: 'xs', flex: 7, wrap: true,
        color: strong ? '#212529' : '#343a40', weight: strong ? 'bold' : 'regular' },
    ],
  };
}

// รูปพร้อมคำอธิบายใต้ภาพ
//   fit  = เห็นทั้งภาพ ไม่ตัดขอบ (ใช้กับ crop ป้าย — ขอบคือตัวอักษร ตัดไม่ได้)
//   cover= เติมกรอบเต็มโดยตัดขอบ (ใช้กับใบหน้า/รถทั้งคัน — ขอบไม่ใช่สาระ)
function _flexImg(url, caption, { ratio = '1:1', fit = false, framed = false } = {}) {
  const image = {
    type: 'image', url, size: 'full', aspectRatio: ratio,
    aspectMode: fit ? 'fit' : 'cover', action: { type: 'uri', uri: url },
  };
  const contents = framed
    ? [{ type: 'box', layout: 'vertical', backgroundColor: '#f1f3f5', cornerRadius: '6px',
         paddingAll: 'sm', contents: [image] }]
    : [image];
  if (caption) {
    contents.push({ type: 'text', text: String(caption), size: 'xxs', color: '#8c8c8c',
                    align: 'center', margin: 'xs' });
  }
  return { type: 'box', layout: 'vertical', flex: 1, contents };
}

// ── การ์ดแจ้งเตือน — ใช้ร่วมกันทั้งป้ายทะเบียนและใบหน้า ─────────────────────
//
// ผังที่เจ้าของอนุมัติ 2026-08-26:
//   แถบสีบนสุด · ป้ายกลุ่ม · ชื่อ/เลขทะเบียนตัวใหญ่ · รูปหลัก+คำอธิบาย
//   · รูปคู่เทียบ+คำอธิบาย · ตารางหัวข้อ/ค่าสองบล็อก · ปุ่ม
//
// 🔴 ทำไมรูปไม่อยู่ที่ `hero` อีกแล้ว: hero ของ Flex ถูกวางบนสุดเสมอ สลับกับ body
// ไม่ได้ พอเจ้าของอยากให้ "อ่านก่อนว่าเรื่องอะไร แล้วค่อยเห็นรูป" รูปจึงต้องย้ายลงมา
// อยู่ใน body · hero เหลือไว้เป็นแถบสีบางอย่างเดียว ซึ่งเป็นวิธีเดียวที่จะได้แถบสี
// เต็มขอบโดยไม่ติด padding ของ body
//
// ไม่มี emoji ในตารางโดยตั้งใจ — CLAUDE.md ยกเว้นให้ LINE ใช้ได้ก็จริง แต่เจ้าของ
// ขอให้ "ดูเป็นทางการ ไม่ดูเล่น ๆ" (2026-08-26) จึงจัดคอลัมน์แทนการนำหน้าด้วยไอคอน
//
// meta:
//   chip      ป้ายกลุ่ม (ชื่อกลุ่มเฝ้าระวัง)
//   title     สิ่งที่ต้องเทียบด้วยตา — เลขทะเบียน หรือ ชื่อบุคคล
//   subtitle  บรรทัดรองที่เบากว่า เช่น จังหวัด
//   hero      { url, caption, fit, framed, ratio } รูปหลัก
//   pair      [{ url, caption }, ...] รูปคู่เทียบ
//   below     { url, caption, ratio } รูปเพิ่มใต้คู่เทียบ (การ์ดใบหน้าใช้วางภาพเต็มเฟรม)
//   sections  [{ title, rows: [[label, value, strong?], ...] }]
//   note      ข้อความอิสระ (จาก template ของกฎ) — ต่อท้ายตาราง ถ้ามี
//   accent    สีหลัก
function buildCompareFlexAlert(meta = {}) {
  const accent = meta.accent || FLEX_ACCENT;
  const body = [];

  // หัวการ์ด (ป้ายกลุ่ม / ทะเบียนหรือชื่อ / จังหวัด) จัดกึ่งกลาง ส่วนตารางข้างล่าง
  // ยังชิดซ้ายเหมือนเดิม — คนละหน้าที่กัน: หัวคือ "นี่คือเรื่องอะไร" ที่ต้องอ่านได้
  // ในครึ่งวินาทีตอนการ์ดเด้งขึ้นมา ส่วนตารางคือรายละเอียดที่ต้องกวาดตาลงมาทีละแถว
  // ซึ่งต้องมีขอบซ้ายตรงกันถึงจะกวาดได้
  //
  // 🔴 ป้ายกลุ่มเป็น box ที่มีพื้นหลัง จะจัดกึ่งกลางด้วย align เหมือน text ไม่ได้ —
  // ต้องห่อด้วย box แนวนอนแล้วใช้ justifyContent · และ LINE จะเคารพ justifyContent
  // ก็ต่อเมื่อลูกทุกตัว flex = 0 เท่านั้น ถ้าลืม flex: 0 ป้ายจะยืดเต็มความกว้าง
  // กลายเป็นแถบสีพาดทั้งใบแทนที่จะเป็นป้ายเล็ก ๆ
  if (meta.chip) {
    body.push({
      type: 'box', layout: 'horizontal', justifyContent: 'center',
      contents: [{ ..._flexChip(meta.chip, accent, meta.chipBg), flex: 0 }],
    });
  }
  if (meta.title) {
    body.push({ type: 'text', text: String(meta.title), size: 'xxl', weight: 'bold',
                color: '#212529', wrap: true, align: 'center',
                margin: meta.chip ? 'md' : 'none' });
  }
  if (meta.subtitle) {
    body.push({ type: 'text', text: String(meta.subtitle), size: 'xs', color: '#868e96',
                align: 'center', margin: 'xs' });
  }

  if (meta.hero?.url) {
    body.push({ type: 'box', layout: 'vertical', margin: 'lg',
                contents: [_flexImg(meta.hero.url, meta.hero.caption,
                  { ratio: meta.hero.ratio || '16:9', fit: meta.hero.fit, framed: meta.hero.framed })] });
  }

  const pair = (meta.pair || []).filter((p) => p && p.url);
  if (pair.length) {
    body.push({ type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'lg',
                contents: pair.map((p) => _flexImg(p.url, p.caption)) });
  }

  if (meta.below?.url) {
    body.push({ type: 'box', layout: 'vertical', margin: 'lg',
                contents: [_flexImg(meta.below.url, meta.below.caption,
                  { ratio: meta.below.ratio || '16:9' })] });
  }

  for (const sec of meta.sections || []) {
    const rows = (sec.rows || []).map(([l, v, s]) => _flexRow(l, v, s)).filter(Boolean);
    if (!rows.length) continue;   // บล็อกที่ไม่มีข้อมูลเลย ไม่ต้องขึ้นหัวข้อเปล่า ๆ
    body.push(_flexSection(sec.title));
    body.push(...rows);
  }

  if (meta.note && String(meta.note).trim()) {
    body.push({ type: 'text', text: String(meta.note).trim(), size: 'xs', color: '#495057',
                wrap: true, margin: 'lg' });
  }

  const bubble = {
    type: 'bubble',
    // แถบสีเต็มขอบ — ทำที่ hero เพราะ body มี padding เสมอ จะได้ไม่มีขอบขาวสองข้าง
    hero: { type: 'box', layout: 'vertical', height: '6px', backgroundColor: accent,
            contents: [{ type: 'filler' }] },
    body: { type: 'box', layout: 'vertical', contents: body, paddingAll: 'lg' },
  };
  if (meta.deepLink) {
    bubble.footer = {
      type: 'box', layout: 'vertical', paddingAll: 'lg', paddingTop: 'none',
      contents: [{ type: 'button', style: 'primary', height: 'sm', color: accent,
                   action: { type: 'uri', label: 'เปิดในระบบ', uri: meta.deepLink } }],
    };
  }
  return { type: 'flex', altText: String(meta.altText || 'แจ้งเตือน').substring(0, 400), contents: bubble };
}


// ── การ์ดคำตอบของ "คำสั่งผ่าน LINE" ────────────────────────────────────────
// คนละเรื่องกับการ์ดแจ้งเตือน: อันนั้นระบบเป็นคนเริ่ม อันนี้คนถามแล้วระบบตอบ
// สีจึงเป็นน้ำเงินกลาง ๆ ไม่ใช่แดงเตือนภัย และ **ไม่มี emoji เลย** (เจ้าของสั่ง 2026-09-08)
//
// สิ่งที่ต้องมีเสมอคือบรรทัด "ช่วงเวลาที่ระบบตีความ" — คำถามอย่าง "ชั่วโมงที่แล้ว"
// ตีความได้หลายแบบ ถ้าไม่พิมพ์กลับไปว่าเข้าใจเป็นช่วงไหน คนอ่านจะไม่มีทางรู้ว่าเลขนี้
// ตอบคำถามของเขาจริงหรือเปล่า
const ANSWER_ACCENT = '#1f4e79';

function buildAnswerFlex(card = {}) {
  // ── ชุดรูป: LINE แสดงเป็น carousel เลื่อนข้างได้ สูงสุด 12 ใบ ──────────────
  // เจ้าหน้าที่ต้องเห็นรูปเพื่อยืนยันว่าใช่คันเดียวกัน — ระบบอ่านป้ายผิดได้
  // ใบแรกเป็นสรุป (ป้าย/ช่วงเวลา/จำนวน) เพราะ carousel ไม่มีที่ให้พาดหัวรวม
  if (Array.isArray(card.photos) && card.photos.length) {
    const head = {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', paddingAll: 'lg', spacing: 'sm', contents: [
        { type: 'text', text: String(card.title || 'รูปรถ'), weight: 'bold', size: 'md', wrap: true },
        ...(card.period ? [{ type: 'text', text: String(card.period), size: 'xs', color: '#868e96', wrap: true }] : []),
        { type: 'text', text: `${card.big || card.photos.length} ${card.unit || 'ภาพ'}`,
          size: 'xl', weight: 'bold', color: ANSWER_ACCENT, margin: 'md' },
        ...(card.note ? [{ type: 'text', text: String(card.note), size: 'xs', color: '#495057', wrap: true }] : []),
      ] },
      ...(card.link ? { footer: { type: 'box', layout: 'vertical', paddingAll: 'lg', paddingTop: 'none',
        contents: [{ type: 'button', style: 'primary', height: 'sm', color: ANSWER_ACCENT,
                     action: { type: 'uri', label: 'ดูในระบบ', uri: card.link } }] } } : {}),
    };
    const shots = card.photos.slice(0, 11).map((p) => ({
      type: 'bubble', size: 'kilo',
      hero: { type: 'image', url: p.url, size: 'full', aspectRatio: '16:9', aspectMode: 'cover',
              action: { type: 'uri', uri: p.url } },
      body: { type: 'box', layout: 'vertical', paddingAll: 'md', spacing: 'xs', contents: [
        { type: 'text', text: String(p.title || ''), weight: 'bold', size: 'sm', wrap: true },
        { type: 'text', text: String(p.caption || ''), size: 'xxs', color: '#868e96', wrap: true },
      ] },
    }));
    const alt = [card.title, card.note, `${card.photos.length} ภาพ`].filter(Boolean).join(' · ');
    return { type: 'flex', altText: alt.substring(0, 400),
             contents: { type: 'carousel', contents: [head, ...shots] } };
  }

  const body = [];
  body.push({ type: 'text', text: String(card.title || 'ผลลัพธ์'), size: 'lg', weight: 'bold',
              color: '#212529', wrap: true });
  if (card.period) {
    body.push({ type: 'text', text: String(card.period), size: 'xs', color: '#868e96',
                wrap: true, margin: 'xs' });
  }

  if (card.empty) {
    body.push({ type: 'text', text: String(card.emptyText || 'ไม่พบข้อมูลในช่วงเวลานี้'),
                size: 'sm', color: '#495057', margin: 'lg', wrap: true });
  } else {
    if (card.big) {
      body.push({
        type: 'box', layout: 'baseline', margin: 'lg', spacing: 'sm', justifyContent: 'center',
        contents: [
          { type: 'text', text: String(card.big), size: 'xxl', weight: 'bold', color: ANSWER_ACCENT, flex: 0 },
          ...(card.unit ? [{ type: 'text', text: String(card.unit), size: 'sm', color: '#868e96', flex: 0 }] : []),
        ],
      });
    }
    const rows = Array.isArray(card.rows) ? card.rows.slice(0, 10) : [];
    if (rows.length) {
      body.push({
        type: 'box', layout: 'vertical', margin: 'lg', spacing: 'md',
        // แถวที่สาม (ถ้ามี) = รายละเอียดย่อยของบรรทัดนั้น วางใต้ชื่อเป็นตัวจาง
        // เดิมยัด "เข้า 4,256 ออก 4,323" ต่อท้ายชื่อในช่องเดียวกัน ชื่อเลยตัดบรรทัด
        // แล้วตัวเลขรวมทางขวาลอยไม่ตรงกับชื่อของตัวเอง อ่านยากมาก (เจ้าของทัก 2026-09-09)
        contents: rows.map(([k, v, sub]) => ({
          type: 'box', layout: 'horizontal', spacing: 'md',
          contents: [
            { type: 'box', layout: 'vertical', flex: 6, spacing: 'none', contents: [
              { type: 'text', text: String(k), size: 'sm', color: '#212529', wrap: true },
              ...(sub ? [{ type: 'text', text: String(sub), size: 'xxs', color: '#868e96', wrap: true }] : []),
            ] },
            { type: 'text', text: String(v), size: 'sm', color: '#212529', weight: 'bold',
              flex: 3, align: 'end', gravity: 'top', wrap: true },
          ],
        })),
      });
      // บอกตรง ๆ ว่าถูกตัด — ไม่งั้นคนอ่านนึกว่าเห็นครบแล้ว
      // `rowsTotal` มาจากแหล่งข้อมูลที่รู้ว่าของจริงมีกี่รายการก่อนตัด (ถ้าไม่ส่งมาก็ใช้
      // ความยาวของ rows เอง ซึ่งจะไม่มีทางเกิน 10 เพราะแหล่งตัดมาก่อนแล้ว)
      const total = Number(card.rowsTotal) || (Array.isArray(card.rows) ? card.rows.length : 0);
      if (total > rows.length) {
        body.push({ type: 'text', text: `แสดง ${rows.length} จาก ${total} รายการ`,
                    size: 'xxs', color: '#868e96', margin: 'sm' });
      }
    }
    if (card.note) {
      // คั่นเส้นก่อน — บรรทัดนี้เป็นหมายเหตุท้ายการ์ด ไม่ใช่ข้อมูลอีกบรรทัดหนึ่ง
      // ไม่มีเส้นคั่นมันไปกองต่อจากตัวเลขจนดูเหมือนเป็นรายการสุดท้าย
      if (rows.length) body.push({ type: 'separator', margin: 'lg', color: '#e9ecef' });
      body.push({ type: 'text', text: String(card.note), size: 'xxs', color: '#868e96',
                  wrap: true, margin: 'md' });
    }
  }

  const bubble = {
    type: 'bubble',
    hero: { type: 'box', layout: 'vertical', height: '6px', backgroundColor: ANSWER_ACCENT,
            contents: [{ type: 'filler' }] },
    body: { type: 'box', layout: 'vertical', contents: body, paddingAll: 'lg' },
  };
  if (card.link) {
    bubble.footer = {
      type: 'box', layout: 'vertical', paddingAll: 'lg', paddingTop: 'none',
      contents: [{ type: 'button', style: 'primary', height: 'sm', color: ANSWER_ACCENT,
                   action: { type: 'uri', label: 'ดูในระบบ', uri: card.link } }],
    };
  }
  const alt = [card.title, card.period, card.big && `${card.big}${card.unit || ''}`]
    .filter(Boolean).join(' · ');
  return { type: 'flex', altText: alt.substring(0, 400) || 'ผลลัพธ์', contents: bubble };
}


// ── ใบหน้า ────────────────────────────────────────────────────────────────
// ชื่อบุคคลเป็นพระเอก · คู่ใบหน้า/ภาพอ้างอิงมาก่อน · ภาพเต็มเฟรมลงล่าง
//
// ลำดับรูปกลับด้านจากการ์ดป้ายทะเบียนโดยตั้งใจ: คำถามของการ์ดใบหน้าคือ "ใช่คนนั้นไหม"
// ซึ่งคู่เทียบตอบได้ ส่วนภาพเต็มเฟรมเป็นบริบท — เดิมภาพเต็มเฟรมอยู่บนสุดทั้งที่เป็น
// รูปที่ช่วยตัดสินได้น้อยที่สุด
// ตารางของการ์ดใบหน้า — ชุดเดียวกับฝั่งป้ายทะเบียน (buildAlertSections)
//
// ⚠️ โรสเตอร์กรอกชื่อไว้ซ้ำกันสามช่อง: sr.name · bl.label · sr.case_ref ทั้ง 60 แถว
// (ตรวจ 2026-08-26) วางดิบ ๆ คือชื่อเดียวกันขึ้นสามบรรทัดติดกัน จึงต้องตัดตัวที่ซ้ำ
// กับสิ่งที่ขึ้นเป็นหัวการ์ดไปแล้วออก · ช่องที่โรสเตอร์ไม่เคยกรอกเลย (id_type,
// id_country, bl.notes) ไม่ต้องมีในตาราง — _flexRow ตัดแถวว่างให้อยู่แล้ว
function _faceSections(event, person, group, info) {
  const i = info || {};
  // รูปแบบเดียวกับ {time} ของ formatMessage — ไม่ระบุ 2-digit จะได้ "26/8/2569"
  // ปนกับ "26/08/2569" ของการ์ดป้ายทะเบียนในแชทเดียวกัน
  const t = event.event_time
    ? new Date(event.event_time).toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '';
  const seen = [
    // ชื่อกล้องของเราก่อน (มาจากตาราง cameras) แล้วค่อยตกไปใช้ชื่อฝั่ง HCP
    // ⚠️ ห้ามใช้ค่าที่แต่งเอง — ชื่อกล้องคือสิ่งที่บอกว่า "ไปที่ไหน" ผิดคือส่งคนผิดที่
    ['กล้อง', event.camera_name || i.hcp_camera_name || event.camera_id, true],
    ['จุดตรวจ', [event.location, event.site_name].filter((x) => x && x !== '-').join(' · ')],
    ['เวลา', t],
    // ลักษณะที่ **กล้องเห็น** จึงอยู่บล็อกนี้ ไม่ใช่บล็อกข้อมูลอ้างอิง
    ['ลักษณะ', faceAppearanceTh(i)],
  ].filter(([, v]) => v);

  // ⚠️ ต้องตัดชื่อกลุ่มที่นำหน้าออกก่อนเทียบ ไม่งั้น "ผู้ต้องหาตามหมายจับ สมชาย ใจดี"
  // ในโรสเตอร์จะนับว่าต่างจาก "สมชาย ใจดี" ที่พาดหัว แล้วขึ้นซ้ำอีกบรรทัด
  const refName = _stripDupPrefix(i.ref_name, group);
  const caseRef = _stripDupPrefix(i.case_ref, group);
  // คำอธิบายจาก HCP ที่แยกช่องแล้ว — เรียงแบบเดียวกับการ์ดป้ายทะเบียน
  // (คดี → รายละเอียด → แจ้งเหตุที่) เพื่อให้คนอ่านสองการ์ดในแชทเดียวกันไม่ต้องปรับสายตา
  const hp = i.hcp_parsed || {};
  const contactLine = [hp.contact, hp.phone].filter(Boolean).join(' ');

  const known = [
    // ชื่อในโรสเตอร์ขึ้นเฉพาะตอนต่างจากชื่อที่พาดหัวการ์ด — ตรงกันคือเรื่องปกติ
    ['ชื่อ', _sameText(refName, person) ? '' : refName, true],
    ['รายชื่อจาก', group],
    // ของจริง (face:17:2507) case_ref = "BLACKLIST TCC" = ชื่อกลุ่มเป๊ะ ๆ — ช่อง
    // "คดี" ของโรสเตอร์ชุดนี้ถูกกรอกเป็นชื่อบัญชี ไม่ใช่ชื่อคดี · ขึ้นทั้งสองแถว
    // จะได้ "รายชื่อจาก BLACKLIST TCC / คดี BLACKLIST TCC" ติดกัน
    ['คดี', (_sameText(caseRef, person) || _sameText(caseRef, refName)
             || _sameText(caseRef, group)) ? '' : caseRef, true],
    // ประเภทการเฝ้าระวังมาก่อนทุกช่องของบล็อกนี้ — "มีหมายจับ" แปลว่าจับได้ทันที
    // ซึ่งเป็นคำสั่งคนละอย่างกับ "เฝ้าระวัง/ติดตาม" · ธง 🚨 เฉพาะหมายจับเท่านั้น
    // (LINE เป็นข้อยกเว้นของกฎห้าม emoji — เป็น norm ของแชทไทย, CLAUDE.md #16)
    ['ประเภท', (() => {
      const label = hp.watch_type || watchLabel(hp.watch_level);
      return label ? (hp.watch_level === 'warrant' ? `🚨 ${label}` : label) : '';
    })(), true],
    ['เหตุการณ์', hp.case_title],
    ['เลขคดี', hp.case_no],
    ['ติดต่อ', contactLine],
    // บันทึกดิบขึ้นเฉพาะตอนไม่มีชุดที่แยกช่องแล้ว — ไม่งั้นข้อความเดิมโผล่ซ้ำ
    // ใต้ช่องที่เพิ่งแยกออกมาจากมันเอง (กฎเดียวกับ note ของการ์ดป้ายทะเบียน)
    // ทุกช่องที่แยกออกมาแล้วนับหมด ไม่ใช่แค่สองช่องแรก — ของจริง 335 จาก 697 ระเบียน
    // แยกได้แค่ "ติดต่อ" ทำให้ case_note ถอยไปเป็น "เพศชาย" แล้วโผล่เป็นแถวบันทึก
    // ที่ไม่ได้บอกอะไรเลย ใต้แถวติดต่อที่ถูกต้อง (ครึ่งหนึ่งของการ์ดใบหน้าทั้งหมด)
    ['บันทึก', (hp.watch_type || hp.watch_level || hp.case_title || hp.case_no
                || hp.contact || hp.phone) ? '' : (i.case_note || i.bl_notes)],
    ['ปรับปรุง', i.ref_updated
      ? new Date(i.ref_updated).toLocaleString('th-TH',
          { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })
      : ''],
  ].filter(([, v]) => v);

  const out = [];
  if (seen.length) out.push({ title: 'ข้อมูลจากกล้อง', rows: seen });
  if (known.length) out.push({ title: 'ข้อมูลอ้างอิง · บัญชีดำ', rows: known });
  return out.length ? out : null;
}

function buildFaceFlexAlert(messageText, imgs, event, deepLink, layout = {}) {
  const raw   = event.person_name && event.person_name !== '-' ? String(event.person_name) : null;
  const group = (event.watchlist && event.watchlist !== '-') ? String(event.watchlist) : null;
  const person = _stripDupPrefix(raw, group);
  // พิมพ์ข้อความเองแล้ว = ตั้งใจให้เห็นข้อความนั้น ไม่ใช่ตารางที่เราประกอบ
  // ปล่อยให้อยู่พร้อมกันคือข้อมูลชุดเดียวกันโผล่สองรอบในการ์ดใบเดียว
  const sections = layout.hasCustomText
    ? null
    : (event.sections || _faceSections(event, person, group, imgs.info));
  return buildCompareFlexAlert({
    accent:   event.group_color || undefined,
    chip:     layout.title ?? group,
    title:    layout.subtitle ?? (person || 'ไม่ทราบชื่อ'),
    pair:     [{ url: imgs.face, caption: 'ภาพที่จับได้' }, { url: imgs.ref, caption: 'ภาพอ้างอิง' }],
    below:    imgs.scene ? { url: imgs.scene, caption: 'ภาพเต็มเฟรม' } : null,
    sections,
    // มี sections แล้วไม่ต้องเอาข้อความจาก template มาซ้ำ — แต่กฎที่ยังไม่มีข้อมูล
    // อ้างอิงให้ประกอบตาราง ยังได้ข้อความเดิมเหมือนก่อน ไม่มีใครเสียของ
    note:     sections ? null : messageText,
    altText:  (person ? `พบ ${person}` : 'พบบุคคลในบัญชีดำ')
              + (event.camera_name ? ` · ${event.camera_name}` : ''),
    deepLink,
  });
}

// ── ป้ายทะเบียน ───────────────────────────────────────────────────────────
// เลขทะเบียนเป็นพระเอก · crop ป้ายเป็นรูปหลัก · ภาพจากกล้องคู่กับภาพอ้างอิง
//
// crop ป้ายใช้ fit + กรอบเทา: ขอบของรูปป้ายคือตัวอักษร ตัดไม่ได้ · และ crop มีพื้นหลัง
// ดำเยอะ ถ้าวางบนพื้นขาวตรง ๆ จะดูเหมือนรูปเสีย
//
// ⚠️ imgs.scene คือ "รูปหลัก" ตามที่ _lprAlertImages จัดไว้ (ซึ่งคือ crop ป้ายเมื่อมี)
// ส่วน imgs.face คือภาพเต็มเฟรม — ชื่อคีย์มาจากการ์ดใบหน้าซึ่งเป็นเจ้าของเดิมของ builder
function buildLprFlexAlert(messageText, imgs, meta, deepLink, layout = {}) {
  return buildCompareFlexAlert({
    chip:     layout.title ?? (meta.groupName || null),
    title:    layout.subtitle ?? (meta.plate || null),
    subtitle: meta.region || null,
    hero:     imgs.plateCrop && imgs.scene
                ? { url: imgs.scene, caption: 'ภาพป้ายทะเบียน', fit: true, framed: true } : null,
    pair:     [{ url: imgs.face, caption: 'ภาพจากกล้อง' }, { url: imgs.ref, caption: 'ภาพอ้างอิง' }],
    sections: meta.sections || null,
    note:     meta.sections ? null : messageText,
    altText:  `${meta.groupName || 'เฝ้าระวัง'} · ${meta.plate || ''}`
              + (meta.cameraName ? ` · ${meta.cameraName}` : ''),
    deepLink,
  });
}

// ตัดคำนำหน้าที่ซ้ำกับป้ายกลุ่มออกจากชื่อ — ข้อมูลจริงเก็บชื่อกลุ่มไว้ในชื่อบุคคลด้วย
// (ตรวจบัญชีดำ 60 รายการ: label กับ case_ref ซ้ำกับชื่อกลุ่มแทบทุกแถว) ถ้าไม่ตัด
// การ์ดจะขึ้นข้อความเดียวกันสองบรรทัดติดกัน
// เทียบสองข้อความว่า "ตัวเดียวกัน" ไหม โดยไม่สนช่องว่างซ้ำและตัวพิมพ์
function _sameText(a, b) {
  if (!a || !b) return false;
  const n = (x) => String(x).replace(/\s+/g, ' ').trim().toLowerCase();
  return n(a) === n(b);
}

function _stripDupPrefix(text, prefix) {
  if (!text || !prefix) return text;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const t = norm(text), pfx = norm(prefix);
  if (!pfx || t === pfx) return t;
  return t.toLowerCase().startsWith(pfx.toLowerCase()) ? (norm(t.slice(pfx.length)) || t) : t;
}

// ── ภาพประกอบของ bubble ป้ายทะเบียน ────────────────────────
// ภาพอ้างอิงของรายการเฝ้าระวังอยู่บน central อยู่แล้ว (snapshots/lpr-watchlist/*.jpg
// ~39KB) จึงอัปได้เร็ว · ไม่มีภาพอ้างอิง = คืน null แล้วตกกลับไปใช้ bubble เดิม
// cache URL ต่อไฟล์เหมือนฝั่งใบหน้า — ป้ายทะเบียนคันเดิมถูกจับซ้ำได้บ่อยกว่าคนเสียอีก
//
// ── ผัง (เปลี่ยน 2026-08-25 ตามที่เจ้าของสั่ง ให้เหมือนการ์ดใบหน้า) ──────────
//   hero  = ภาพเต็มเฟรม (16:9)      ← เดิมไม่มี hero
//   ซ้าย  = ภาพ crop เฉพาะป้าย       ← เดิมเป็นภาพเต็มเฟรม
//   ขวา   = ภาพอ้างอิง               ← เหมือนเดิม
//
// เหตุผลที่ผังเดิมเอาภาพเต็มเฟรมไว้ช่องซ้าย (คอมเมนต์เดิมใน lprLineAlert.js) คือ
// "crop ป้ายที่เรนเดอร์ในกรอบ 16:9 ไม่ช่วยอะไร" — ข้อโต้แย้งนั้นหมดไปเมื่อภาพเต็มเฟรม
// ได้กรอบ 16:9 ของตัวเองบน hero แล้ว ช่องซ้ายจึงว่างให้ crop ป้ายใช้ได้พอดี
//
// ไม่มี crop ป้าย (หรือลิงก์ใช้ไม่ได้) → คืนผังเดิมทั้งดุ้น ไม่ใช่การ์ดพัง
async function _lprAlertImages(meta, imgbbKey, expireSec, sceneUrl, signedTtlSec = null, allowImgbb = true) {
  if (!meta?.refImage) return null;
  // crop ป้ายอยู่ใต้ SNAPSHOT_DIR เหมือนกัน (ไฟล์ 1–4KB) → เซ็นลิงก์ได้ ไม่ต้องอัป
  // ยิงขนานกับภาพอ้างอิง ไม่ให้ preflight สองใบต่อคิวกันเพิ่มเวลาแจ้งเตือน
  // ไม่มีทางสำรองไป imgbb โดยตั้งใจ: ไฟล์ของไซต์ edge ไม่ได้อยู่บนดิสก์ central
  // (proxy อ่านข้ามอุโมงค์) การ readFileSync จึงพลาดเสมออยู่แล้ว
  // ⚠️ .catch() ตรงจุดสร้าง ไม่ใช่ตอน await — ทางออกด้านล่างมีสองเส้นที่ return null
  // โดยไม่เคย await ตัวนี้ (ไม่มี imgbbKey / ไฟล์อ้างอิงหาย) ถ้ามันปฏิเสธทีหลังจะกลาย
  // เป็น unhandledRejection ที่ฆ่าโปรเซสกลางการแจ้งเตือน
  const platePromise = (meta.plateImage
    ? usableSignedUrl(meta.plateImage, signedTtlSec ?? expireSec)
    : Promise.resolve({ url: null, reason: null })
  ).catch((e) => ({ url: null, reason: e.message || 'error' }));

  // ผังใหม่ใช้ได้ต่อเมื่อมี crop ป้ายจริง ๆ · ไม่มี = คืนผังเดิม (ภาพเต็มเฟรมอยู่ซ้าย
  // ไม่มี hero) ซึ่งยังเป็นการ์ดที่อ่านรู้เรื่อง ไม่ใช่การ์ดที่ขาดรูป
  const _shape = async (refUrl) => {
    const plate = await platePromise;
    if (plate.reason) console.warn(`🔔 ลิงก์ crop ป้ายใช้ไม่ได้ (${plate.reason}) → ใช้ผังเดิม`);
    // คีย์ scene/face/ref เป็น "ตำแหน่ง" ไม่ใช่ "ชนิดรูป" — buildCompareFlexAlert
    // วาง scene=hero · face=ช่องซ้าย · ref=ช่องขวา (ชื่อมาจากการ์ดใบหน้าซึ่ง hero
    // เป็นภาพเต็มเฟรมพอดี) ฝั่งป้ายทะเบียนวางคนละอย่างจึงอ่านชื่อตามตัวไม่ได้
    //
    // เจ้าของลองของจริงแล้วสั่งสลับ (2026-08-26): เอา crop ป้ายขึ้น hero และให้
    // ภาพเต็มเฟรมลงไปคู่กับภาพอ้างอิง — เหตุผลตรงไปตรงมา ภาพเต็มเฟรมกับภาพอ้างอิง
    // เป็น "รถทั้งคัน" เหมือนกัน วางคู่กันถึงเทียบกันได้ ส่วนป้ายเป็นข้อมูลระบุตัว
    // ควรอยู่บนสุดใหญ่ที่สุด · ก่อนหน้านี้เอาป้ายไปคู่กับภาพรถ ซึ่งเทียบอะไรกันไม่ได้
    return plate.url
      ? { scene: plate.url, face: sceneUrl, ref: refUrl, plateCrop: true, heroFit: true }
      : { scene: null, face: sceneUrl, ref: refUrl, plateCrop: false };
  };

  // ภาพอ้างอิงป้ายทะเบียนอยู่ใต้ SNAPSHOT_DIR → เซ็นลิงก์ได้ ไม่ต้องอัปและไม่ต้อง cache
  // ⚠️ ต้อง preflight ด้วย — เดิมแค่ "สร้าง URL ได้" ก็ return เลย ทางสำรองข้างล่าง
  // จึงไม่มีวันทำงานถ้าลิงก์ตอบ 403/404 (secret ไม่ตรงข้ามเครื่อง / ไฟล์ถูกลบ)
  const signed = await usableSignedUrl(meta.refImage, signedTtlSec ?? expireSec);
  if (signed.url) return _shape(signed.url);
  if (signed.reason) console.warn(`🔔 ลิงก์ภาพอ้างอิงป้ายใช้ไม่ได้ (${signed.reason})`);
  if (!imgbbKey || !allowImgbb) return null;
  const cached = _refUrlCache.get(meta.refImage);
  if (cached && cached.expiresAt > Date.now()) {
    return _shape(cached.url);
  }
  let url = null;
  try {
    const file = path.join(SNAPSHOT_DIR, meta.refImage);
    if (!fs.existsSync(file)) return null;
    url = await _imgbbUpload(fs.readFileSync(file, 'base64'), imgbbKey, expireSec);
  } catch (e) { console.warn('🔔 อัปโหลดภาพอ้างอิงป้ายทะเบียนไม่สำเร็จ:', e.message); return null; }
  if (!url) return null;
  const ttl = (_clampExpire(expireSec) - 600) * 1000;
  _refUrlCache.set(meta.refImage, { url, expiresAt: Date.now() + Math.max(60_000, ttl) });
  if (_refUrlCache.size > 500) _refUrlCache.clear();
  return _shape(url);
}

// ── Main: send alert to all recipients ──────────────────────

// ── ภาพประกอบของ bubble ใบหน้า ─────────────────────────────
// คืน null เมื่อไม่มีภาพอ้างอิง (ไม่มีอะไรให้เทียบ = ใช้ bubble เดิมดีกว่า)
//
// ภาพอ้างอิงของคนคนหนึ่งแทบไม่เปลี่ยน แต่ URL ของ imgbb หมดอายุ — cache URL ไว้
// ในหน่วยความจำของ worker พร้อมวันหมดอายุ ทำให้สภาวะปกติอัปโหลดแค่ 2 ใบต่อการแจ้งเตือน
// (ภาพเต็มเฟรม + ภาพที่จับได้) แทนที่จะเป็น 3
const _refUrlCache = new Map();   // photo_path -> { url, expiresAt }

// ── หา "ใครคือใคร" ของแมตช์ใบหน้าใบนี้ (T2b) ────────────────────────────────
// แยกออกมาจาก _faceAlertImages เดิมเฉย ๆ — query/ลำดับ fallback/การ merge
// เหมือนทุกประการ ไม่ได้แก้ตรรกะ — เพื่อให้ผู้เรียกที่อยาก **path ดิบ** (ไม่ใช่ URL
// ที่เซ็น/อัปแล้ว) เรียกได้โดยไม่ต้องเสีย query ซ้ำ · notifier ฝั่ง Telegram
// (alert-engine.js `_sendTelegramForRule`) ใช้ path ดิบไปเซ็นลิงก์เองแบบเดียวกับ
// ภาพอื่น (sendTelegramLeg) แทนที่จะได้ URL ของ LINE (kind ต่าง host กัน) มาตรง ๆ
// คืน row ที่มี .refKind แปะไว้ ('ref' = PHOTO_DIR, 'img' = SNAPSHOT_DIR ของกล้องเอง)
async function _faceRefInfo(event, pool) {
  if (!pool || !event.event_id) return null;
  let row;
  try {
    const { rows } = await pool.query(
      // LATERAL แทน scalar subquery เดิม — เดิมดึงมาแต่ photo_path แล้วทิ้งคอลัมน์
      // ที่เหลือของแถวเดียวกันไป ทั้งที่คดี/บันทึก/รหัสอ้างอิงคือสิ่งที่คนอ่านการ์ด
      // ต้องรู้ต่อจาก "เป็นใคร" · เงื่อนไขและลำดับการเลือกแถวเหมือนเดิมทุกประการ
      // 🔴 ต้องดึง **ทั้งสองชุด** — HCP ส่งรหัสตัวเลข (hcp_*) ส่วนกล้อง Hikvision
      // ส่งค่าที่อ่านออกเลยและละเอียดกว่ามาก (age/hat/glass/mask/faceExpression)
      // เป็นคนละคีย์กัน ไม่ใช่ชื่อพ้อง · faceAppearanceTh อ่านทั้งคู่อยู่แล้ว
      // ดึงมาไม่ครบ = สาย Hik ตายเงียบ ๆ การ์ดขึ้นแค่ "ชาย" ทั้งที่มีอายุ/แว่น/สีหน้า
      `SELECT e.raw_json->>'_snapshot_full'  AS scene,
              e.raw_json->>'_snapshot_ref'   AS cam_ref,
              e.raw_json->>'hcp_camera_name' AS hcp_camera_name,
              e.raw_json->>'gender'          AS gender,
              e.raw_json->>'hcp_gender'      AS hcp_gender,
              e.raw_json->>'hcp_glasses'     AS hcp_glasses,
              e.raw_json->>'hcp_mask'        AS hcp_mask,
              e.raw_json->>'age'             AS age,
              e.raw_json->>'hat'             AS hat,
              e.raw_json->>'glass'           AS glass,
              e.raw_json->>'mask'            AS mask,
              e.raw_json->>'faceExpression'  AS "faceExpression",
              r.*, r2.*
         FROM events e
         LEFT JOIN LATERAL (
           SELECT sr.photo_path AS ref_path, sr.case_ref, sr.case_note,
                  sr.external_id, sr.name AS ref_name, sr.updated_at AS ref_updated,
                  bl.notes AS bl_notes,
                  -- คำอธิบายจาก HCP ที่แยกช่องไว้แล้ว (decision 2026-09-08) — การ์ด LINE
                  -- คือจุดที่เจ้าหน้าที่เห็นก่อนหน้าจอเสมอ "มีหมายจับ" จึงต้องมาถึงตรงนี้
                  sr.raw_json->'hcp_remark_parsed' AS hcp_parsed
           ${mirrorPairSql('e')}
            LIMIT 1) r ON TRUE
         -- 🔴 fallback เดียวกับหน้า Face Matches (faces.js, 2026-08-18):
         -- face_blacklist เป็น mirror ที่ enroll มือทีละชุด — คนที่ HCP จับคู่ได้เอง
         -- อาจไม่มีแถวใน mirror เลย ทั้งที่ภาพโรสเตอร์อยู่ใน source_records แล้ว
         -- (external_id = 'face:<group>:<person>' เสมอ, source_id=14) · ขาด fallback
         -- ตัวนี้ = การ์ด LINE เหลือรูปเดียวทั้งที่หน้าจอโชว์ภาพอ้างอิงได้ (เจ้าของ
         -- จับได้จากการส่งเอง 2026-08-29 — เคสจริง hcp_person_id 4820)
         LEFT JOIN LATERAL (
           SELECT sr2.photo_path AS fb_ref_path, sr2.case_ref AS fb_case_ref,
                  sr2.case_note AS fb_case_note, sr2.external_id AS fb_external_id,
                  sr2.name AS fb_ref_name, sr2.updated_at AS fb_ref_updated
             FROM blacklist.source_records sr2
            WHERE ${fallbackWhereSql('e', 'sr2')}
            LIMIT 1) r2 ON TRUE
        WHERE e.id = $1`, [event.event_id]);
    row = rows[0];
    // ใช้ fallback เฉพาะเมื่อทางหลัก (face_blacklist) ไม่เจอ — ไม่ทับของที่เจอแล้ว
    if (row && !row.ref_path && row.fb_ref_path) {
      row.ref_path    = row.fb_ref_path;
      row.case_ref    = row.case_ref    ?? row.fb_case_ref;
      row.case_note   = row.case_note   ?? row.fb_case_note;
      row.external_id = row.external_id ?? row.fb_external_id;
      row.ref_name    = row.ref_name    ?? row.fb_ref_name;
      row.ref_updated = row.ref_updated ?? row.fb_ref_updated;
    }
  } catch (e) {
    console.warn('🔔 หาภาพอ้างอิงไม่สำเร็จ:', e.message);
    return null;
  }
  // ── ภาพอ้างอิงมาได้ 3 ทาง เพราะเรามีระบบจดจำใบหน้า 3 ระบบ ────────────────
  // การค้นด้านบนผูกกับ raw_json ของ HCP (hcp_person_id / hcp_person_name) ซึ่ง
  // อีกสองระบบไม่มี ผลคือหาไม่เจอแล้วตกไปใช้ bubble รูปเดียว หน้าตาไม่เหมือนกัน
  //
  //   1. HCP        โรสเตอร์ของเรา (PHOTO_DIR)      ← LATERAL ด้านบน
  //   2. AuraFace   โรสเตอร์ของเรา (PHOTO_DIR)      ← ผู้เรียกส่ง event.ref_path มา
  //   3. กล้อง Hik  FD Library ของกล้องเอง (SNAPSHOT_DIR) ← _snapshot_ref ใน payload
  //
  // 🔴 ข้อ 3 อยู่คนละคลังกับอีกสองข้อ — ลิงก์เซ็นชื่อชนิด 'ref' ชี้ไป PHOTO_DIR
  // ถ้าเอา path ของ SNAPSHOT_DIR ไปเซ็นด้วยชนิดนั้นจะได้ 404 เงียบ ๆ จึงต้องจำไว้
  // ว่าภาพอ้างอิงใบนี้มาจากคลังไหน ไม่ใช่แค่จำ path
  if (row && !row.ref_path && event.ref_path) row.ref_path = event.ref_path;
  // 🔴 ต้องเป็น 'img' ไม่ใช่ null — signedImageUrl ตรวจ kind กับรายชื่อที่รู้จัก
  // (signedImage.js:112) ค่าที่ไม่รู้จักคืน null เงียบ ๆ · และ default parameter ของ JS
  // ทำงานกับ `undefined` เท่านั้น ไม่ทำงานกับ `null` การส่ง null จึงไม่ใช่ "ใช้ค่า
  // เริ่มต้น" แต่คือ "ส่งค่าที่ผิด" · ของจริงพังแบบนี้มาแล้ว 2026-08-27
  let refKind = 'ref';                       // PHOTO_DIR (โรสเตอร์ของเรา)
  if (row && !row.ref_path && row.cam_ref) {
    row.ref_path = row.cam_ref;
    refKind = 'img';                         // SNAPSHOT_DIR (FD Library ของกล้อง)
  }
  // ข้อมูลโรสเตอร์ที่ผู้เรียกรู้อยู่แล้ว (AuraFace อ่านจาก face_blacklist_hits ได้ตรง ๆ
  // แต่ LATERAL ด้านบนหาไม่เจอ) — เติมเฉพาะช่องที่ยังว่าง ไม่ทับของที่ค้นเจอเอง
  if (row && event.ref_info) {
    for (const [k, v] of Object.entries(event.ref_info)) {
      if (v != null && v !== '' && (row[k] == null || row[k] === '')) row[k] = v;
    }
  }
  if (!row || !row.ref_path) return null;   // ไม่มีภาพอ้างอิง → bubble เดิม

  row.refKind = refKind;
  return row;
}

async function _faceAlertImages(event, imgbbKey, expireSec, pool, faceUrl, signedTtlSec = null, allowImgbb = true) {
  const row = await _faceRefInfo(event, pool);
  if (!row) return null;
  const refKind = row.refKind;

  // ⏱️ อัปโหลดสองใบพร้อมกัน — วัดจริงแล้วเรียงกันใช้ ~14.7 วินาทีต่อการแจ้งเตือน
  // (ภาพเต็มเฟรมต้องดึงข้ามอุโมงค์จาก edge ก่อนแล้วค่อยอัป) ซึ่งช้าเกินกว่าจะยอมรับ
  // ในเส้นทางแจ้งเตือน · ทั้งสองใบไม่ขึ้นต่อกัน จึงยิงขนานกันได้ตรงๆ
  const cached = _refUrlCache.get(row.ref_path);
  const cachedRef = (cached && cached.expiresAt > Date.now()) ? cached.url : null;

  // ภาพอ้างอิงใบหน้าอยู่ใน PHOTO_DIR → เซ็นลิงก์ชนิด 'ref' ได้ ไม่ต้องอัปเลย
  // preflight อยู่ในงานเดียวกัน จึงยังยิงขนานกับภาพเต็มเฟรมได้เหมือนเดิม
  const refJob = (async () => {
    const signedRef = await usableSignedUrl(row.ref_path, signedTtlSec ?? expireSec, refKind);
    if (signedRef.url) return { url: signedRef.url, cacheable: false };
    if (signedRef.reason) console.warn(`🔔 ลิงก์ภาพอ้างอิงใบหน้าใช้ไม่ได้ (${signedRef.reason})`);
    if (cachedRef) return { url: cachedRef, cacheable: false };
    try {
      // ทางสำรอง imgbb อ่านจาก PHOTO_DIR — ภาพจาก FD Library ของกล้องไม่ได้อยู่ที่นี่
      if (refKind !== 'ref') return { url: null, cacheable: false };
      const file = path.join(PHOTO_DIR, row.ref_path);
      if (!fs.existsSync(file)) return { url: null, cacheable: false };
      if (!imgbbKey || !allowImgbb) return { url: null, cacheable: false };
      // เฉพาะ URL ที่มาจาก imgbb เท่านั้นที่คุ้มจะ cache — ลิงก์เซ็นชื่อสร้างใหม่ได้ฟรี
      return { url: await _imgbbUpload(fs.readFileSync(file, 'base64'), imgbbKey, expireSec), cacheable: true };
    } catch (e) { console.warn('🔔 อัปโหลดภาพอ้างอิงไม่สำเร็จ:', e.message); return { url: null, cacheable: false }; }
  })();

  // ── ภาพเต็มเฟรม: ปิดไว้เป็นค่าเริ่มต้น เพราะวัดจริงแล้วแพงมาก ─────────────
  //   ภาพที่จับได้ (crop เล็ก)  ~1.4 วิ   ← เดิมส่งอยู่แล้ว
  //   ภาพอ้างอิง (ไฟล์ 9KB ในเครื่อง) ~0.3 วิ
  //   ภาพเต็มเฟรม (ดึงข้ามอุโมงค์จาก edge) **~10.1 วิ**  ← 85% ของเวลาทั้งหมด
  // การแจ้งเตือนช้าไป 10 วินาทีเพื่อภาพประกอบหนึ่งใบไม่คุ้ม ในเมื่อสิ่งที่เจ้าของ
  // ต้องการจริงคือ "เทียบหน้ากับภาพอ้างอิง" ซึ่งได้ครบแล้วโดยแทบไม่เสียเวลาเพิ่ม
  // เปิดได้ด้วย LINE_FACE_FULL_FRAME=1 ถ้ายอมแลกความเร็ว
  // ภาพเต็มเฟรมอยู่ใน SNAPSHOT_DIR → เซ็นลิงก์ได้ ไม่ต้องอัป = ฟรีจริงๆ
  // เหตุผลที่เคยปิดไว้ (10 วินาทีจาก imgbb) หมดไปเมื่อมีลิงก์เซ็นชื่อ จึงเปิดให้เอง
  // ถ้ายังไม่ได้ตั้งค่า ก็กลับไปใช้เงื่อนไขเดิม (ต้องสั่งเปิดด้วย env)
  //
  // ⚠️ ถ้าลิงก์เซ็นชื่อของภาพเต็มเฟรมใช้ไม่ได้ (404/403) **ไม่**ตกไป imgbb เอง —
  // เพราะการอัปภาพเต็มเฟรมคือ 10 วินาทีที่จงใจตัดทิ้งไปแล้ว การ "ซ่อม" ให้อัตโนมัติ
  // จะทำให้แจ้งเตือนใบหน้าทุกใบช้าลง 10 วิ เพื่อภาพประกอบใบเดียว · ต้องสั่งเปิดเอง
  // ด้วย LINE_FACE_FULL_FRAME=1 เหมือนเงื่อนไขเดิมก่อนมีลิงก์เซ็นชื่อ
  const sceneJob = (async () => {
    const signedScene = row.scene ? await usableSignedUrl(row.scene, signedTtlSec ?? expireSec)
                                  : { url: null, reason: null };
    if (signedScene.url) return signedScene.url;
    if (signedScene.reason) console.warn(`🔔 ลิงก์ภาพเต็มเฟรมใช้ไม่ได้ (${signedScene.reason})`);
    const wantScene = env.bool('LINE_FACE_FULL_FRAME');
    if (!(wantScene && row.scene && imgbbKey && allowImgbb)) return null;
    return _siteCodeForCamera(pool, event.camera_id)
      .then(siteCode => uploadToImgbb(row.scene, imgbbKey, { siteCode, expireSec }))
      .catch(() => null);
  })();

  const [ref, sceneUrl] = await Promise.all([refJob, sceneJob]);
  const refUrl = ref?.url || null;
  if (!refUrl) return null;   // ไม่มีภาพอ้างอิง = ไม่มีอะไรให้เทียบ → bubble เดิม

  // 🔴 เดิมบรรทัดนี้อ่าน `signedRef` ซึ่งอยู่คนละ scope (หลุดมาตอนแยก refJob เป็น
  // async IIFE) → ReferenceError ทุกครั้งที่ **หาภาพอ้างอิงเจอ** คือทุกครั้งที่
  // การ์ดแบบเทียบภาพจะถูกสร้าง · ตัวแปรบอกสถานะเดินทางมากับผลลัพธ์แทน
  if (ref.cacheable) {
    // เผื่อเวลาไว้ 10 นาทีก่อนหมดอายุจริง กัน URL ตายกลางทาง
    const ttl = (_clampExpire(expireSec) - 600) * 1000;
    _refUrlCache.set(row.ref_path, { url: refUrl, expiresAt: Date.now() + Math.max(60_000, ttl) });
    if (_refUrlCache.size > 500) _refUrlCache.clear();
  }
  return { scene: sceneUrl, face: faceUrl, ref: refUrl, info: row };
}

// ลิงก์กลับเข้าระบบสำหรับปุ่ม "เปิดในระบบ" — ไม่มี URL สาธารณะตั้งไว้ก็ไม่ต้องมีปุ่ม
function _dashboardEventLink(event, page = 'face-matches') {
  const base = env.str('DASHBOARD_PUBLIC_URL');
  const id = event.event_id || event.id;
  if (!base || !id) return null;
  return `${base.replace(/\/+$/, '')}/?page=${page}&event=${encodeURIComponent(id)}`;
}

// ── Main: send alert to all recipients ──────────────────────
async function sendAlert({ rule, event, recipients, token, imgbbKey, pool = null, imgbbExpireSec,
                           signedTtlSec = null, allowImgbb = true }) {
  const messageText = formatMessage(
    rule.message_template || '🚨 {camera}\n📋 {rule}\n📍 {location}\n⏰ {time}',
    event
  );

  // Upload snapshot first (if enabled + available); the result decides whether
  // we send a Flex bubble (image + text in ONE LINE message) or fall back to
  // plain text. Either way: one message per alert per recipient.
  // ลิงก์เซ็นชื่อจากโดเมนเราเองมาก่อนเสมอ — ไม่ต้องอัปโหลดอะไรเลย ได้ URL ทันที
  // (imgbb กินเวลา 1.4-10 วิ ต่อภาพ · แจ้งเตือน LPR จริงเฉลี่ย 20-27 วิ)
  // ยังไม่ได้ตั้ง DASHBOARD_PUBLIC_URL/SNAPSHOT_PROXY_SECRET → คืน null แล้วตกไปใช้ imgbb เหมือนเดิม
  let imageUrl = null;
  // รูปในการ์ดใบนี้มาจากไหน — เขียนลง alert_logs.image_source (migration 147)
  // เพื่อตอบให้ได้ว่า "ทางสำรองทำงานกี่ครั้ง" ซึ่งเป็นข้อมูลเดียวที่บอกได้ว่าถอด
  // imgbb ทิ้งได้หรือยัง
  let imageSource = null;
  if (rule.send_snapshot && event.snapshot_filename) {
    const signed = await usableSignedUrl(event.snapshot_filename, signedTtlSec ?? imgbbExpireSec);
    imageUrl = signed.url;

    // ถ้าลิงก์สำเร็จ และ bbox enabled → ต่อ query parameter
    if (imageUrl && pool && event.id) {
      try {
        const bboxEnabled = (await getSystemSetting(pool, 'lpr_bbox_full_image_enabled')) === '1';
        if (bboxEnabled) {
          // การแจ้งเตือนคือ "รถ/คนที่ตรงกับบัญชีเฝ้าระวัง" เสมอ ⇒ กรอบต้องเป็นสีแดง
          // เหมือนที่เห็นบนหน้าจอ ไม่ใช่สีน้ำเงินของรถทั่วไป
          // ลายเซ็นครอบแค่ (ชนิด:ชื่อไฟล์, exp) — ต่อ query เพิ่มไม่ทำให้ลายเซ็นพัง
          // (ยืนยันจาก helpers/signedImage.js:56,63)
          imageUrl += `&bbox=1&eid=${event.id}&alarm=1`;
        }
      } catch (e) {
        // อ่าน setting ล้ม ให้ถือว่าปิด ส่งลิงก์ดิบต่อไป
        console.warn('[line-sender] bbox setting lookup failed:', e?.message);
      }
    }

    if (imageUrl) imageSource = 'signed';
    else if (imgbbKey && allowImgbb) {
      const siteCode = await _siteCodeForCamera(pool, event.camera_id);
      imageUrl = await uploadToImgbb(event.snapshot_filename, imgbbKey,
        { siteCode, expireSec: imgbbExpireSec });
      if (imageUrl) imageSource = 'imgbb';
      console.warn(`🔔 ลิงก์รูปของเราใช้ไม่ได้ (${signed.reason}) → ${imageUrl ? 'ใช้ imgbb แทน' : 'ส่งโดยไม่มีรูป'}`);
    } else {
      console.warn(`🔔 ลิงก์รูปของเราใช้ไม่ได้ (${signed.reason}) → ส่งโดยไม่มีรูป` +
                   (allowImgbb ? ' (ไม่ได้ตั้ง imgbb key)' : ' (ปิดทางสำรอง imgbb ไว้)'));
    }
    if (!imageUrl) imageSource = 'none';
  }

  // แจ้งเตือนใบหน้า: ถ้ามีภาพอ้างอิงให้เทียบ ใช้ bubble แบบ 3 ภาพแทน (ระลอก 2)
  // เงื่อนไข = ต้องมีทั้งภาพที่จับได้และภาพอ้างอิง ไม่งั้นไม่มีอะไรให้ "เทียบ"
  // ก็ตกกลับไปใช้ bubble เดิมซึ่งยังทำงานได้ปกติ
  // เงื่อนไข event.person_name สำคัญ: กันไม่ให้การแจ้งเตือน IVA/LPR ที่ไม่เกี่ยวกับ
  // ใบหน้า (ปริมาณมากกว่ามาก) ต้องเสีย query หาภาพอ้างอิงทุกใบเพื่อได้ null
  let faceImgs = null;
  if (imageUrl && rule.send_snapshot && event.person_name && event.person_name !== '-') {
    faceImgs = await _faceAlertImages(event, imgbbKey, imgbbExpireSec, pool, imageUrl, signedTtlSec, allowImgbb);
  }

  // ป้ายทะเบียน: โครงเดียวกับใบหน้า — เทียบภาพจากกล้องกับภาพอ้างอิงของรายการเฝ้าระวัง
  // ผู้เรียก (lprLineAlert) ส่ง lprMeta มาให้เมื่ออยากได้ bubble แบบเทียบภาพ
  let lprImgs = null;
  if (imageUrl && rule.lprMeta?.plate) {
    lprImgs = await _lprAlertImages(rule.lprMeta, imgbbKey, imgbbExpireSec, imageUrl, signedTtlSec, allowImgbb);
  }

  // ปุ่ม "เปิดในระบบ" ปิดได้ต่อกฎ (migration 145) — ค่าเริ่มต้นคือเปิด เหมือนพฤติกรรมเดิม
  const wantLink = rule.show_open_link !== false;
  const linkFor = (page) => (wantLink ? _dashboardEventLink(event, page) : null);
  // หัวเรื่อง/บรรทัดรองใช้ตัวแปรชุดเดียวกับ message_template · ว่าง = ใช้ของเดิม
  const layout = {
    title:    rule.title_template    ? formatMessage(rule.title_template, event)    : undefined,
    subtitle: rule.subtitle_template ? formatMessage(rule.subtitle_template, event) : undefined,
    textPosition: rule.text_position || 'below',
    // ว่าง = ใช้ตารางอัตโนมัติ · พิมพ์เอง = ได้ตามที่พิมพ์ (เจ้าของสั่ง 2026-08-27)
    // ต้องส่งเป็นธงมา เพราะ messageText ถูกเติม default ไปแล้วตอนนี้ ผู้สร้างการ์ด
    // จึงแยกไม่ออกเองว่า "คนพิมพ์" หรือ "ระบบเติมให้"
    hasCustomText: !!(rule.message_template && String(rule.message_template).trim()),
  };

  const messages = faceImgs
    ? [buildFaceFlexAlert(messageText, faceImgs, event, linkFor('face-matches'), layout)]
    : lprImgs
      ? [buildLprFlexAlert(messageText, lprImgs, rule.lprMeta, linkFor('lpr'), layout)]
      : imageUrl
        ? [buildFlexAlert(messageText, imageUrl, event)]
        : [{ type: 'text', text: messageText }];

  // Send to each recipient
  let sentCount = 0;
  let lastError = null;
  const recipientsLog = [];
  for (const recipient of recipients) {
    const result = await pushLineMessage(token, recipient.id, messages);
    if (result.success) {
      sentCount++;
      recipientsLog.push({
        name: recipient.name || null,
        type: recipient.type || null,
        id_tail: recipient.id ? String(recipient.id).slice(-4) : null,
        ok: true,
        error: null,
        line_request_id: result.request_id || null,
      });
    } else {
      lastError = `[${recipient.name || recipient.id}] ${result.error}`;
      console.error('🔔 LINE send fail:', lastError);
      recipientsLog.push({
        name: recipient.name || null,
        type: recipient.type || null,
        id_tail: recipient.id ? String(recipient.id).slice(-4) : null,
        ok: false,
        error: result.error || null,
        line_request_id: result.request_id || null,
      });
    }
  }

  return {
    success: sentCount === recipients.length,
    sentCount,
    totalRecipients: recipients.length,
    error: sentCount < recipients.length ? lastError : null,
    messageText,
    imageSource,   // 'signed' | 'imgbb' | 'none' | null (ไม่ได้ขอให้แนบรูป)
    recipientsLog,
  };
}

// ── Build a Flex bubble for scheduled reports. Same quota-saving trick as
//    buildFlexAlert: caption text + report image collapsed into ONE message
//    object. Mega bubble for the extra width; hero shows a 20:13 preview
//    crop with tap-to-open-full-image (imgbb hosts the original PNG, so the
//    full untouched report opens in LINE's image viewer with pinch-zoom).
function buildFlexReport(caption, imageUrl) {
  const title = (caption || '📊 รายงานสรุป').trim();
  return {
    type: 'flex',
    altText: title.substring(0, 400),
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: imageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
        action: { type: 'uri', uri: imageUrl },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: title, wrap: true, weight: 'bold', size: 'md' },
          { type: 'text', text: 'แตะรูปเพื่อดูรายงานเต็ม', size: 'xs', color: '#888888', margin: 'sm' },
        ],
        paddingAll: 'md',
      },
    },
  };
}

// ── Send a scheduled report image to LINE recipients ───────
// Phase 7.3 commit 3. Since 2026-08-24 the report is rendered to a PNG buffer by
// report-renderer.js. We first try a signed URL on our own domain (no upload needed);
// if that fails or isn't configured, we fall back to imgbb. The flex bubble displays
// a caption + image in one LINE message (was text+image=2 before). LINE's Messaging API
// has no file/document type, so an image is the delivery vehicle.
async function sendReportToLine({ token, imgbbKey, recipients, pngBuffer, caption,
                                   reportFile = null, allowImgbb = true, signedTtlSec = 172800 }) {
  if (!token) return { success: false, error: 'LINE channel access token not configured' };
  if (!recipients || recipients.length === 0) return { success: false, error: 'no recipients' };

  let imageUrl = null;
  let imageSource = null;

  // ลิงก์เซ็นชื่อจากโดเมนเราเองมาก่อนเสมอ — ไฟล์อยู่บนดิสก์แล้ว ไม่ต้องอัปโหลดซ้ำ
  // (แบบเดียวกับการแจ้งเตือน LPR/Face ที่ทำมาตั้งแต่ 2026-08-13)
  if (reportFile) {
    const signed = await usableSignedUrl(reportFile, signedTtlSec, 'rpt');
    if (signed.url) {
      imageUrl = signed.url;
      imageSource = 'signed';
    } else if (signed.reason) {
      // ลิงก์เราใช้ไม่ได้ — บันทึกเหตุผล แล้วลองทางสำรอง
      console.warn(`📅 ลิงก์รายงานของเราใช้ไม่ได้ (${signed.reason}) → ${allowImgbb ? 'ลองใช้ imgbb' : 'ส่งไม่มีรูป'}`);
    }
  }

  // ถ้ายังไม่มี URL ลองทางสำรอง imgbb
  if (!imageUrl && imgbbKey && allowImgbb) {
    imageUrl = await uploadBufferToImgbb(pngBuffer, imgbbKey);
    if (imageUrl) imageSource = 'imgbb';
  }

  // ไม่มีรูปเลย = ไม่ส่ง — รายงานที่ไม่มีภาพไม่มีประโยชน์ และการส่งข้อความเปล่าออกไป
  // คือการส่งแบบใหม่ที่ผู้รับไม่ได้คาดหวัง ให้ล้มเหลวแบบมีเสียงดีกว่า
  if (!imageUrl) return { success: false, error: 'no image url', imageSource: 'none' };

  const messages = [buildFlexReport(caption, imageUrl)];

  let sent = 0;
  let lastError = null;
  for (const recipientId of recipients) {
    const r = await pushLineMessage(token, recipientId, messages);
    if (r.success) sent++;
    else { lastError = r.error; console.error('📅 report→LINE fail:', recipientId, r.error); }
  }
  return {
    success: sent === recipients.length,
    sentCount: sent,
    totalRecipients: recipients.length,
    imageUrl,
    imageSource,   // 'signed' | 'imgbb' | 'none' | null (ไม่ได้ขอให้แนบรูป)
    error: sent < recipients.length ? lastError : null,
  };
}

module.exports = {
  buildAnswerFlex,
  sendAlert,
  buildCompareFlexAlert,
  buildLprFlexAlert,
  buildFaceFlexAlert,   // export เพื่อทดสอบโครง Flex โดยไม่ต้องยิง LINE จริง
  _faceSections,        // export เพื่อทดสอบว่าแถวของการ์ดใบหน้าเรียงเหมือนการ์ดป้ายทะเบียน
  _faceAlertImages,     // export เพื่อ dry-run เส้นทางหาภาพจริง โดยไม่ push เข้า LINE
  _faceRefInfo,         // T2b: alert-engine ใช้ path ดิบสร้างการ์ด Telegram (ดูคอมเมนต์บนฟังก์ชัน)
  _stripDupPrefix,      // T2b: alert-engine ใช้ตัดคำนำหน้าซ้ำก่อนตั้งชื่อการ์ด Telegram เหมือน LINE
  _lprAlertImages,
  formatMessage,   // export เพื่อให้ทดสอบข้อความได้โดยไม่ต้องยิง LINE จริง
  likelihoodPct,   // ใช้ร่วมกับ alert-engine ให้ตีความสเกลตรงกันที่เดียว
  uploadToImgbb,
  _clampExpire,
  IMGBB_EXPIRE_DEFAULT_SEC,
  testConnection,
  pushLineMessage,
  replyLineMessage,
  getLineUserProfile,
  getLineGroupSummary,
  getLineGroupMemberProfile,
  getLineQuota,
  formatMessage,
  uploadBufferToImgbb,
  sendReportToLine,
  _dashboardEventLink,   // export เพื่อให้ notifier ฝั่ง Telegram สร้างลิงก์ "เปิดในระบบ" แบบเดียวกัน
};
