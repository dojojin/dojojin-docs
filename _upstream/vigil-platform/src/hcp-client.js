// ============================================================
// Vigil Platform — HikCentral Professional (HCP) Client
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// Client for Hikvision HikCentral Professional (HCP) Artemis API.
// Handles authentication (AK/SK), request signing, and credential management.
//
// Integration Partner credentials:
//   AK: 38051848
//   SK: อยู่ใน env เป็น HCP_SECRET_KEY_ENC (เข้ารหัสแล้ว) — ห้ามเขียนค่าจริงลงไฟล์ใด ๆ
//
// Usage:
//   const hcpClient = require('./hcp-client');
//   await hcpClient.init();
//   const result = await hcpClient.call('POST', '/artemis/api/common/v1/version', {});
//

'use strict';

const https = require('https');
const crypto = require('crypto');
const { signRequest } = require('./helpers/hcpSign');
const { encryptCred, decryptCred } = require('./crypto-creds');
const env = require('./config');

const HCP_HOST = env.str('HCP_HOST');
const HCP_PORT = env.int('HCP_PORT');
const HCP_ACCOUNT_ID = env.str('HCP_ACCOUNT_ID');
const HCP_SECRET_KEY_ENC = env.str('HCP_SECRET_KEY_ENC'); // encrypted form

let secretKey = null;
let httpsAgent = null;

// ── Initialization ──────────────────────────────────────────
async function init() {
  if (secretKey) return; // already initialized

  if (!HCP_SECRET_KEY_ENC) {
    throw new Error('[hcp-client] HCP_SECRET_KEY_ENC not set in env');
  }

  // Decrypt the secret key
  secretKey = decryptCred(HCP_SECRET_KEY_ENC);
  if (!secretKey || secretKey.startsWith('enc:v1:')) {
    throw new Error('[hcp-client] failed to decrypt HCP_SECRET_KEY_ENC (wrong key or corrupt data)');
  }

  // Create HTTPS agent that ignores self-signed cert (HCP uses self-signed)
  httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    maxSockets: 10,
  });

  console.log('[hcp-client] initialized with account', HCP_ACCOUNT_ID);
}

// ── Request signing & execution ─────────────────────────────
async function call(method, path, body = null, extraHeaders = {}) {
  if (!secretKey || !httpsAgent) {
    throw new Error('[hcp-client] not initialized — call init() first');
  }

  // signRequest expects stringified body for hashing
  const bodyStr = body ? JSON.stringify(body) : '';

  // Sign the request using the hcpSign helper
  const { headers: signedHeaders } = signRequest({
    method,
    path,
    body: bodyStr,
    appKey: HCP_ACCOUNT_ID,
    appSecret: secretKey,
  });

  // Merge extra headers (e.g., userId) with signed headers
  const reqHeaders = {
    'User-Agent': 'vigil-platform/1.0',
    ...signedHeaders,
    ...extraHeaders,
  };

  // Make the HTTPS request
  return _makeRequest(method, path, bodyStr, reqHeaders);
}

// ── Private: Raw HTTPS request ──────────────────────────────
function _makeRequest(method, path, bodyStr, headers) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HCP_HOST,
      port: HCP_PORT,
      path: path,
      method: method,
      headers: headers,
      agent: httpsAgent,
      timeout: 30000, // 30 seconds
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        } catch (e) {
          // If response is not JSON, return raw text
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: { raw: data },
          });
        }
      });
    });

    req.on('error', (err) => {
      // Log error without exposing secret key
      console.error('[hcp-client] request error:', err.message);
      reject(new Error(`HCP request failed: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HCP request timeout'));
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ── API endpoint wrappers ───────────────────────────────────

/**
 * Get HCP version (simple connectivity test)
 * POST /artemis/api/common/v1/version
 */
async function getVersion() {
  const result = await call('POST', '/artemis/api/common/v1/version', {}, {});
  return result;
}

/**
 * รายการกล้องทั้งหมดของ HCP
 *
 * `/resource/v1/camera/query` ตอบ "This product version is not supported" บน
 * เครื่องจริง (V3.0.1) — เส้นที่ใช้ได้คือ `/resource/v1/cameras` ซึ่งคืน 756 ตัว
 * ฟิลด์ที่ต้องใช้ต่อคือ cameraIndexCode, cameraName และ **encodeDevIndexCode**
 * (ตัวหลังคือทางเดียวที่จะไปหา IP ได้ เพราะกล้องไม่มี IP ของตัวเองในคำตอบนี้)
 */
async function queryCameras(pageNo = 1, pageSize = 500) {
  return call('POST', '/artemis/api/resource/v1/cameras', { pageNo, pageSize }, {});
}

/** รายการ encode device — ที่เดียวที่มี IP (เป็น IP ของเครื่องบันทึก ไม่ใช่ของกล้อง) */
async function queryEncodeDevices(pageNo = 1, pageSize = 500) {
  return call('POST', '/artemis/api/resource/v1/encodeDevice/encodeDeviceList', { pageNo, pageSize }, {});
}

/**
 * Get face groups (blacklist, whitelist, etc.)
 * POST /artemis/api/frs/v1/face/groupList
 */
// pageSize 1000 ถูกปฏิเสธ ("pageSize parameter error") — เพดานของ gateway ต่ำกว่านั้น
// ใช้ 500 เท่ากับ endpoint อื่นที่พิสูจน์แล้วว่าผ่าน · ถ้าโหลดกลุ่มไม่ได้ การเดา
// blackList/whiteList จะผิดทั้งชุด ซึ่งเงียบกว่าที่ควร
async function queryFaceGroups(pageNo = 1, pageSize = 500) {
  const body = { pageNo, pageSize };
  const result = await call('POST', '/artemis/api/frs/v1/face/groupList', body, {});
  return result;
}

/**
 * Get face match records
 * POST /artemis/api/aiapplication/v1/face/faceMatchRecord
 * NOTE: userId must be signed (added to X-Ca-Signature-Headers)
 */
async function queryFaceMatches(startTime, endTime, pageNo = 1, pageSize = 100) {
  if (!secretKey || !httpsAgent) {
    throw new Error('[hcp-client] not initialized — call init() first');
  }

  // startTime/endTime must be ISO-8601 without milliseconds
  const body = { startTime, endTime, pageNo, pageSize };
  const bodyStr = JSON.stringify(body);
  const path = '/artemis/api/aiapplication/v1/face/faceMatchRecord';

  // Custom signing that includes userId in the signature
  const crypto = require('crypto');
  const nonce = crypto.randomUUID();
  const timestamp = String(Date.now());
  const userId = HCP_ACCOUNT_ID;

  // Build signature manually with userId included
  const accept = 'application/json';
  const contentType = 'application/json';
  const md5 = crypto.createHash('md5').update(bodyStr, 'utf8').digest('base64');

  // userId, x-ca-key, x-ca-nonce, x-ca-timestamp (sorted alphabetically)
  const headerLines = [
    `userid:${userId}`,
    `x-ca-key:${HCP_ACCOUNT_ID}`,
    `x-ca-nonce:${nonce}`,
    `x-ca-timestamp:${timestamp}`,
  ].join('\n') + '\n';

  const stringToSign = [
    'POST',
    accept,
    md5,
    contentType,
    headerLines + path,
  ].join('\n');

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(stringToSign, 'utf8')
    .digest('base64');

  const reqHeaders = {
    'Accept': accept,
    'Content-Type': contentType,
    'Content-MD5': md5,
    'X-Ca-Key': HCP_ACCOUNT_ID,
    'X-Ca-Nonce': nonce,
    'X-Ca-Timestamp': timestamp,
    'X-Ca-Signature': signature,
    'X-Ca-Signature-Headers': 'userid,x-ca-key,x-ca-nonce,x-ca-timestamp',
    'userId': userId,
    'User-Agent': 'vigil-platform/1.0',
  };

  return _makeRequest('POST', path, bodyStr, reqHeaders);
}

/**
 * Get face picture
 * POST /artemis/api/frs/v1/application/picture
 */
async function getPicture(url) {
  // url is something like "Dev://…"
  // Response is base64 image data (not JSON)
  const body = { url };
  const result = await call('POST', '/artemis/api/frs/v1/application/picture', body, {});
  return result;
}


/** intelligent server ทั้งหมด — ต้องเลือก type 1 (Fusion) เอง ห้าม hardcode index */
async function queryIntelligentServers() {
  return call('POST', '/artemis/api/resource/v1/intelligentServer/intelligentServerList', { pageNo: 1, pageSize: 500 }, {});
}

/**
 * รูป → target model สำหรับเอาไปค้นต่อ
 * protocolType 0 = Intelligent Fusion Server · รูปหนึ่งใบมีได้หลายหน้า คืนมาเป็น targets[]
 */
async function pictureRecognitionModel(serverIndex, pictureDataB64) {
  return call('POST', '/artemis/api/frs/v1/application/pictureRecognitionModel',
    { protocolType: 0, intelligentServerIndexCode: String(serverIndex), pictureData: pictureDataB64 }, {});
}

/**
 * ค้นใบหน้าที่กล้องจับได้ ด้วย model ที่ได้จากรูป
 *
 * พารามิเตอร์ที่ "จำเป็นจริง" ไล่มาจากการยิงจริง 2026-08-08 — gateway ฟ้องทีละตัว:
 *   ขาด modelMaxNum → "modelMaxNum value error, range[1, 500]"
 *   ขาด maxResults  → "maxResults range is [1,500]"
 * และ sortType รับแค่ 'similarity' (ตัวอย่างในคู่มือเขียน 'time' ซึ่งใช้ไม่ได้)
 *
 * **threshold ต้องส่งเสมอ** — ค่าปริยายสูงจนคืน numOfMatches = 0 แม้ค้นรูปที่ถ่ายจาก
 * กล้องตัวนั้นในช่วงเวลานั้นเอง · ที่ 0.1 ได้ผลครบ แล้วค่อยกรองด้วย similarity ฝั่งเรา
 *
 * เพดาน: ช่วงเวลา ≤ 7 วันต่อครั้ง · cameraIndexCodes รวมกันไม่เกิน 1024 ตัวอักษร
 * ผลลัพธ์อยู่ที่ data.targets และ **similarity เป็น 0-1 อยู่แล้ว** (ต่างจาก
 * faceMatchRecord ที่เป็น 0-100 — อย่าหารร้อยซ้ำ)
 */
async function captureSearch(serverIndex, targetModelData, cameraIndexCodes, startTime, endTime, opts = {}) {
  return call('POST', '/artemis/api/frs/v1/application/captureSearch', {
    protocolType: 0,
    intelligentServerIndexCode: String(serverIndex),
    targetModelData,
    cameraIndexCodes: String(cameraIndexCodes),
    startTime, endTime,
    sortType: 'similarity',
    modelMaxNum: 100,
    maxResults: opts.maxResults || 100,
    threshold: opts.threshold != null ? opts.threshold : 0.1,
  }, {});
}

module.exports = {
  init,
  call,
  // API wrappers
  getVersion,
  queryCameras,
  queryEncodeDevices,
  queryIntelligentServers,
  pictureRecognitionModel,
  captureSearch,
  queryFaceGroups,
  queryFaceMatches,
  getPicture,
};
