// ============================================================
// Vigil Platform — HTTP Digest Auth Helper
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// RFC 2617 Digest auth (qop=auth, MD5).
// Shared by cameras.js, hikvision-isapi.js, dahua-cgi.js.
// ============================================================
'use strict';

const crypto = require('crypto');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function parseChallenge(header) {
  const out = {};
  for (const m of header.replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,]*))/g))
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

function buildDigestHeader(user, pass, method, uri, challenge, nc = '00000001') {
  const cnonce = crypto.randomBytes(8).toString('hex');
  const qop = challenge.qop ? challenge.qop.split(',')[0].trim() : null;
  const ha1 = md5(`${user}:${challenge.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${challenge.realm}", `
        + `nonce="${challenge.nonce}", uri="${uri}", response="${response}"`;
  if (challenge.opaque) h += `, opaque="${challenge.opaque}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return h;
}

// Vendor-specific endpoint that actually enforces auth on GET, used to test
// whether a set of credentials is accepted. Root ("/") is not usable for this
// on some Hikvision firmware — it 200s unconditionally regardless of auth.
const AUTH_CHECK_PATH = {
  hikvision: '/ISAPI/System/deviceInfo',
  dahua: '/cgi-bin/magicBox.cgi?action=getSystemInfo',
  // RCP+ read of CONF_MQTT_SETTINGS — read-only, and anonymous gets 401 (probed
  // on a DINION 5100i 2026-09-28), so a 2xx here means the stored service
  // credential really works
  bosch: '/rcp.xml?command=0x0d0a&type=P_OCTET&direction=READ&num=1',
};

// Probes <user>/<pass> against <path>: tries unauthenticated first, then
// retries with Digest or Basic per the WWW-Authenticate challenge (mirrors
// _probeHttpImage in routes/cameras.js). Resolves 'ok' (2xx after auth),
// 'failed' (still 401), or 'unknown' (network error/timeout).
function probeAuth(host, port, path, user, pass, timeout = 4000) {
  const http = require('http');
  return new Promise((resolve) => {
    const attempt = (authHeader) => {
      const headers = authHeader ? { Authorization: authHeader } : {};
      const r = http.get({ host, port, path, headers, timeout }, (pr) => {
        pr.resume();
        if (pr.statusCode === 401 && !authHeader) {
          const wa = pr.headers['www-authenticate'] || '';
          if (/digest/i.test(wa)) return attempt(buildDigestHeader(user, pass, 'GET', path, parseChallenge(wa)));
          if (/basic/i.test(wa)) return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
          return resolve('failed');
        }
        resolve(pr.statusCode === 401 ? 'failed' : 'ok');
      });
      r.on('error', () => resolve('unknown'));
      r.on('timeout', () => { r.destroy(); resolve('unknown'); });
    };
    attempt(null);
  });
}

module.exports = { parseChallenge, buildDigestHeader, probeAuth, AUTH_CHECK_PATH };
