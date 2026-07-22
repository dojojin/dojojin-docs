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

module.exports = { parseChallenge, buildDigestHeader };
