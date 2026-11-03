// ============================================================
// Vigil Platform — ONVIF WS-Security Header Helper
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Shared by edge-config-agent.js (SD-status/recording-summary probes) and
// lpr-receiver.js (Bosch Event Broker / MQTT status probes) — both speak
// ONVIF SOAP to Bosch cameras on the edge's LAN using the same UsernameToken
// PasswordDigest scheme. Extracted so the digest logic lives in one place.

'use strict';

const crypto = require('crypto');

function buildOnvifSecurityHeader(username, password) {
  const nonceBuf = crypto.randomBytes(16);
  const nonceB64 = nonceBuf.toString('base64');
  const created = new Date().toISOString().replace(/\.\d+Z$/, '.000Z');
  const digestBuf = crypto.createHash('sha1')
    .update(Buffer.concat([nonceBuf, Buffer.from(created, 'utf8'), Buffer.from(password, 'utf8')]))
    .digest();
  const digestB64 = digestBuf.toString('base64');
  return `<wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${username}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digestB64}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security>`;
}

module.exports = { buildOnvifSecurityHeader };
