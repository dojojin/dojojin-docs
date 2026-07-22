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

const SNAPSHOT_DIR = path.join(__dirname, '..', 'snapshots');

// ── Format message text ─────────────────────────────────────
function formatMessage(template, event) {
  const time = new Date(event.event_time || Date.now()).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const likelihood = event.likelihood
    ? Math.round(parseFloat(event.likelihood) * 100) + '%'
    : '?';
  return template
    // {camera} = real camera name (camera_name from cameras-config.json),
    // falling back to camera_id only if the name is missing.
    .replace(/\{camera\}/g, event.camera_name || event.camera_id || 'Unknown')
    // {camera_id} kept available for templates that still want the raw id.
    .replace(/\{camera_id\}/g, event.camera_id || 'Unknown')
    // {location} = ตำแหน่งติดตั้งกล้อง (location from config); '-' if unset.
    .replace(/\{location\}/g, event.location || '-')
    .replace(/\{rule\}/g, event.rule_name || 'Unknown')
    .replace(/\{time\}/g, time)
    .replace(/\{object_class\}/g, event.object_class || 'Unknown')
    .replace(/\{likelihood\}/g, likelihood)
    .replace(/\{event_type\}/g, event.event_type || '')
    // {duration} — dwell alert (migration 044): "อยู่มานานเท่าไหร่แล้ว"
    .replace(/\{duration\}/g, event.duration_text || '-')
    .replace(/\{person_name\}/g, event.person_name || '-')
    .replace(/\{match_confidence\}/g, event.match_confidence || '-')
    .substring(0, 4900); // LINE max 5000 chars (กันเกิน)
}

// ── Upload a base64 image to imgbb ──────────────────────────
// Core used by both the file-based (snapshot) and buffer-based (report
// image) uploaders. expiration=172800 → imgbb auto-deletes after 48h
// (privacy — same as the alert-snapshot path).
function _imgbbUpload(imageBase64, imgbbKey) {
  return new Promise((resolve) => {
    if (!imgbbKey || !imageBase64) return resolve(null);
    try {
      const postData = `key=${imgbbKey}&image=${encodeURIComponent(imageBase64)}&expiration=172800`;
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
async function uploadToImgbb(snapshotFilename, imgbbKey) {
  if (!snapshotFilename || !imgbbKey) return null;
  const filePath = path.join(SNAPSHOT_DIR, snapshotFilename);
  let b64;
  if (fs.existsSync(filePath)) {
    try { b64 = fs.readFileSync(filePath, 'base64'); } catch { return null; }
  } else {
    const u = process.env.SNAPSHOT_PROXY_URL, s = process.env.SNAPSHOT_PROXY_SECRET;
    if (!u || !s) return null;
    try {
      const up = await fetch(
        `${u}/snapshots/${encodeURIComponent(snapshotFilename).replace(/%2F/g, '/')}`,
        { headers: { Authorization: `Bearer ${s}` }, signal: AbortSignal.timeout(8000) }
      );
      if (!up.ok) return null;
      b64 = Buffer.from(await up.arrayBuffer()).toString('base64');
    } catch { return null; }
  }
  return _imgbbUpload(b64, imgbbKey);
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
        if (res.statusCode === 200) {
          resolve({ success: true });
        } else {
          let errMsg = `HTTP ${res.statusCode}`;
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString());
            errMsg = body.message || errMsg;
            if (body.details && body.details.length) {
              errMsg += ': ' + body.details.map(d => d.message).join(', ');
            }
          } catch {}
          resolve({ success: false, error: errMsg });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
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

// ── Main: send alert to all recipients ──────────────────────
async function sendAlert({ rule, event, recipients, token, imgbbKey }) {
  const messageText = formatMessage(
    rule.message_template || '🚨 {camera}\n📋 {rule}\n📍 {location}\n⏰ {time}',
    event
  );

  // Upload snapshot first (if enabled + available); the result decides whether
  // we send a Flex bubble (image + text in ONE LINE message) or fall back to
  // plain text. Either way: one message per alert per recipient.
  let imageUrl = null;
  if (rule.send_snapshot && imgbbKey && event.snapshot_filename) {
    imageUrl = await uploadToImgbb(event.snapshot_filename, imgbbKey);
  }

  const messages = imageUrl
    ? [buildFlexAlert(messageText, imageUrl, event)]
    : [{ type: 'text', text: messageText }];

  // Send to each recipient
  let sentCount = 0;
  let lastError = null;
  for (const recipient of recipients) {
    const result = await pushLineMessage(token, recipient.id, messages);
    if (result.success) {
      sentCount++;
    } else {
      lastError = `[${recipient.name || recipient.id}] ${result.error}`;
      console.error('🔔 LINE send fail:', lastError);
    }
  }

  return {
    success: sentCount === recipients.length,
    sentCount,
    totalRecipients: recipients.length,
    error: sentCount < recipients.length ? lastError : null,
    messageText,
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
// Phase 7.3 commit 3. The report is rendered to a PNG buffer by
// report-renderer.js, uploaded to imgbb, then pushed as a Flex bubble
// (caption + image in ONE LINE message, was text+image=2). LINE's
// Messaging API has no file/document type, so an image is the delivery
// vehicle; tapping the hero opens the full untouched PNG via imgbb.
async function sendReportToLine({ token, imgbbKey, recipients, pngBuffer, caption }) {
  if (!token) return { success: false, error: 'LINE channel access token not configured' };
  if (!recipients || recipients.length === 0) return { success: false, error: 'no recipients' };

  const imageUrl = await uploadBufferToImgbb(pngBuffer, imgbbKey);
  if (!imageUrl) return { success: false, error: 'imgbb upload failed (check imgbb_api_key)' };

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
    error: sent < recipients.length ? lastError : null,
  };
}

module.exports = {
  sendAlert,
  testConnection,
  pushLineMessage,
  replyLineMessage,
  getLineUserProfile,
  getLineGroupSummary,
  getLineQuota,
  formatMessage,
  uploadBufferToImgbb,
  sendReportToLine,
};
