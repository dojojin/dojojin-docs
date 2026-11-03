// ============================================================
// Vigil Platform — Camera reboot (vendor HTTP)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Power-cycles one camera. Shared by central (office LAN) and the edge agent
// (site LANs central cannot route to) so both issue the identical request.
//
// This is the most destructive thing the dashboard can do to a device: the
// camera is blind for 60-90 seconds and nothing here can cancel it once sent.
// The guards that make it safe live at the callers — admin-only, typed
// confirmation, one camera at a time, audit_log — and this module deliberately
// holds none of that policy, so there is exactly one place to read it.
'use strict';

const http = require('http');
const { parseChallenge, buildDigestHeader } = require('./digestAuth');

// Only vendors whose reboot call is documented and whose auth we already speak.
// Bosch goes through RCP+ CONF_BOARD_RESET (boschRcp.rebootBosch, spec p.173)
// rather than a plain HTTP path, so it is dispatched separately below.
const REBOOT = {
  // Dahua HTTP API 3.37 §5.1.5
  dahua:     { method: 'GET', path: '/cgi-bin/magicBox.cgi?action=reboot' },
  // Hikvision ISAPI
  hikvision: { method: 'PUT', path: '/ISAPI/System/reboot' },
};

function supportsReboot(vendor) {
  // no default for a missing vendor here — the NVR route relies on '' being
  // refused; single-camera callers apply the (vendor || 'bosch') convention
  const v = String(vendor || '').toLowerCase();
  return v === 'bosch' || Object.prototype.hasOwnProperty.call(REBOOT, v);
}

// Resolves { ok, status } — never throws, because the caller is usually an MQTT
// handler or an express route that has already replied.
function rebootCamera({ ip_address, http_port, username, password, vendor }, timeoutMs = 8000) {
  if (String(vendor || '').toLowerCase() === 'bosch') {
    return require('./boschRcp').rebootBosch({ ip_address, http_port, username, password });
  }
  return new Promise((resolve) => {
    const spec = REBOOT[String(vendor || '').toLowerCase()];
    if (!spec) return resolve({ ok: false, error: `reboot not supported for vendor '${vendor}'` });
    if (!ip_address) return resolve({ ok: false, error: 'no ip_address' });

    const send = (authHeader, isRetry) => {
      const req = http.request({
        host: ip_address, port: http_port || 80, path: spec.path, method: spec.method,
        headers: authHeader ? { Authorization: authHeader } : {},
        timeout: timeoutMs,
      }, (res) => {
        // One digest round trip, then give up — a second 401 means the stored
        // credential is wrong, not that another nonce would help.
        if (res.statusCode === 401 && !isRetry) {
          const wa = res.headers['www-authenticate'];
          res.resume();
          if (!wa || !/digest/i.test(wa)) return resolve({ ok: false, error: '401 without digest challenge' });
          return send(buildDigestHeader(username, password, spec.method, spec.path, parseChallenge(wa)), true);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').trim().slice(0, 200);
          // A rebooting camera often cuts the socket mid-reply; 2xx OR a clean
          // drop after the request was accepted both count as "it took it".
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ ok: true, status: res.statusCode, body });
          resolve({ ok: false, status: res.statusCode, error: body || `HTTP ${res.statusCode}` });
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', (e) => {
        // ECONNRESET immediately after the command is the camera going down,
        // which is success. Before it, it is a failure. We cannot tell them
        // apart from here, so report it as sent-but-unconfirmed rather than
        // claiming either — the operator watches the state go offline anyway.
        if (e.code === 'ECONNRESET' && isRetry) return resolve({ ok: true, unconfirmed: true, error: e.code });
        resolve({ ok: false, error: e.code || e.message });
      });
      req.end();
    };
    send(null, false);
  });
}

module.exports = { rebootCamera, supportsReboot, REBOOT_VENDORS: [...Object.keys(REBOOT), 'bosch'] };
