// ============================================================
// Vigil Platform — Camera Model Detection
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// detectModel(cam) — best-effort read of a camera's model string over the
// network, by vendor. Read-only (no config change). Runs on the LAN that can
// reach the camera (i.e. the edge), so it is used by scripts/fill-model.js.
//   Dahua       → magicBox.cgi?action=getSystemInfo  (digest)   → deviceType=…
//   Hikvision   → ISAPI /System/deviceInfo           (digest)   → <model>
//   Bosch/ONVIF → ONVIF GetDeviceInformation         (WS-Sec)   → <tds:Model>
// Returns { model, firmware, serial, hardware } or null (unreachable/unknown).
// `cam` is a cameras-config.json entry; pass its DECRYPTED password in `pass`.
'use strict';
const http = require('http');
const crypto = require('crypto');

const md5 = s => crypto.createHash('md5').update(s).digest('hex');

// --- HTTP digest GET (Dahua/Hik CGI) --------------------------------------
function digestGet(host, user, pass, path, timeout = 8000) {
  return new Promise(res => {
    const opts = { host, port: 80, path, method: 'GET', timeout };
    const send = hdrs => {
      const r = http.request({ ...opts, headers: hdrs || {} }, resp => {
        if (resp.statusCode === 401 && !hdrs) {
          const h = resp.headers['www-authenticate'] || ''; resp.resume();
          const g = k => (h.match(new RegExp(k + '="?([^",]+)')) || [])[1];
          const realm = g('realm'), nonce = g('nonce'), qop = g('qop'), opaque = g('opaque');
          const nc = '00000001', cnonce = crypto.randomBytes(8).toString('hex');
          const ha1 = md5(user + ':' + realm + ':' + pass), ha2 = md5('GET:' + path);
          const rh = qop ? md5(ha1 + ':' + nonce + ':' + nc + ':' + cnonce + ':' + qop + ':' + ha2)
                         : md5(ha1 + ':' + nonce + ':' + ha2);
          let auth = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${path}", response="${rh}"`;
          if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
          if (opaque) auth += `, opaque="${opaque}"`;
          send({ Authorization: auth });
          return;
        }
        let b = ''; resp.on('data', d => b += d); resp.on('end', () => res({ code: resp.statusCode, body: b }));
      });
      r.on('error', () => res({ code: 0, body: '' }));
      r.on('timeout', () => { r.destroy(); res({ code: 0, body: '' }); });
      r.end();
    };
    send();
  });
}

// --- ONVIF GetDeviceInformation (WS-Security UsernameToken digest) ---------
function onvifSecurity(username, password) {
  const nonceBuf = crypto.randomBytes(16), nonceB64 = nonceBuf.toString('base64');
  const created = new Date().toISOString().replace(/\.\d+Z$/, '.000Z');
  const digestB64 = crypto.createHash('sha1')
    .update(Buffer.concat([nonceBuf, Buffer.from(created, 'utf8'), Buffer.from(password, 'utf8')])).digest().toString('base64');
  return `<wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${username}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digestB64}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security>`;
}
function onvifGetDeviceInfo(host, user, pass, timeout = 8000) {
  return new Promise(res => {
    const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><s:Header>${onvifSecurity(user, pass)}</s:Header><s:Body><tds:GetDeviceInformation/></s:Body></s:Envelope>`;
    const req = http.request({
      method: 'POST', hostname: host, port: 80, path: '/onvif/device_service',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, timeout,
    }, r => {
      const ch = []; r.on('data', c => ch.push(c));
      r.on('end', () => {
        const xml = Buffer.concat(ch).toString('utf8');
        const g = t => (xml.match(new RegExp('<[^>]*' + t + '>([^<]+)')) || [])[1];
        res(r.statusCode === 200
          ? { model: g('Model'), firmware: g('FirmwareVersion'), serial: g('SerialNumber'), hardware: g('HardwareId') }
          : null);
      });
    });
    req.on('error', () => res(null));
    req.on('timeout', () => { req.destroy(); res(null); });
    req.write(body); req.end();
  });
}

// --- vendor dispatch ------------------------------------------------------
async function detectModel(cam, pass) {
  const host = cam.ip_address; if (!host) return null;
  const user = cam.username || 'admin';
  const v = String(cam.vendor || '').toLowerCase();
  try {
    if (v.includes('dahua')) {
      const r = await digestGet(host, user, pass, '/cgi-bin/magicBox.cgi?action=getSystemInfo');
      if (r.code !== 200) return null;
      const kv = k => (r.body.match(new RegExp(k + '=([^\\r\\n]+)')) || [])[1];
      const model = kv('deviceType'); if (!model) return null;
      // getSystemInfo's own "hardwareVersion" is the BOARD revision (e.g. "1.00"
      // for every unit of a model) — not the flashed firmware. The real
      // software/firmware string (API doc 4.6.14, matches the camera's own
      // Web UI "Version" tab "Software Version") is a separate call.
      const fwR = await digestGet(host, user, pass, '/cgi-bin/magicBox.cgi?action=getSoftwareVersion');
      const firmware = (fwR.code === 200 ? (fwR.body.match(/version=([^\r\n]+)/) || [])[1] : null);
      return { model: model.trim(), firmware: (firmware || '').trim() || null, serial: (kv('serialNumber') || '').trim() || null, hardware: null };
    }
    if (v.includes('hik')) {
      const r = await digestGet(host, user, pass, '/ISAPI/System/deviceInfo');
      if (r.code !== 200) return null;
      const g = t => (r.body.match(new RegExp('<' + t + '>([^<]+)')) || [])[1];
      const model = g('model'); if (!model) return null;
      return { model: model.trim(), firmware: (g('firmwareVersion') || '').trim() || null, serial: (g('serialNumber') || '').trim() || null, hardware: null };
    }
    // onvif / bosch (and unknown → ONVIF is the universal fallback)
    return await onvifGetDeviceInfo(host, user, pass);
  } catch { return null; }
}

module.exports = { detectModel };
