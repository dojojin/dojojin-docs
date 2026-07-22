// ============================================================
// Vigil Platform — LPR downstream forwarder (with disk spool/retry)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// CS7 — the LPR camera has ONE push slot. When we hold it, our forward is the
// downstream partner's (CIB, a government system) ONLY feed — so a transient CIB
// blip must not silently lose a plate. This wraps the old fire-and-forget POST
// with a disk spool: a failed delivery is written to spoolDir and a drain timer
// retries it until it lands or ages out. Scope is deliberately the FORWARD only
// (advisor #3) — the local DB write is not spooled (postgres is a separate
// process that survives api-server/receiver restarts; DB-down is a whole-platform
// outage, out of scope).
//
// ponytail: flat-dir spool, one .bin + one .json per failed push. Fine for a
// single low-rate LPR camera. If we ever hold many high-rate slots, shard by day
// or move to a real queue — until then a directory is the lazy correct tool.
// ============================================================
'use strict';

const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const https  = require('https');
const crypto = require('crypto');

function _rm(p) { try { fs.unlinkSync(p); } catch { /* already gone */ } }

function createForwarder({ defaultUrl = null, spoolDir = null, label = 'lpr',
                           drainMs = 15000, maxAgeMs = 3600000, timeoutMs = 10000 } = {}) {
  let _default = defaultUrl;
  if (spoolDir) { try { fs.mkdirSync(spoolDir, { recursive: true }); } catch (e) { console.error(`[${label}] spool mkdir: ${e.message}`); } }

  // POST rawBody to dest. cb(null) on a 2xx; cb(err) on connection error,
  // timeout, or non-2xx (so a CIB 5xx also spools, not just a dropped socket).
  function _post(rawBody, contentType, dest, cb) {
    let u; try { u = new URL(dest); } catch { return cb(new Error(`bad url "${dest}"`)); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return cb(new Error(`bad scheme ${u.protocol}`));
    const mod = u.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (e) => { if (!settled) { settled = true; cb(e); } };
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: (u.pathname || '/') + (u.search || ''),
      method: 'POST',
      headers: { 'Content-Type': contentType || 'multipart/form-data', 'Content-Length': rawBody.length },
    }, (res) => {
      res.resume(); // drain so the socket frees
      res.on('end', () => done(res.statusCode >= 200 && res.statusCode < 300 ? null : new Error(`HTTP ${res.statusCode}`)));
    });
    req.on('error', (e) => done(e));
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.write(rawBody);
    req.end();
  }

  function _spool(rawBody, contentType, dest) {
    if (!spoolDir) return;
    const id = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(path.join(spoolDir, id + '.bin'), rawBody);
      fs.writeFileSync(path.join(spoolDir, id + '.json'), JSON.stringify({ dest, contentType, ts: Date.now() }));
    } catch (e) { console.error(`[${label}] spool write: ${e.message}`); }
  }

  // Fire-and-forget from the caller's view; failures land in the spool.
  function forward(rawBody, contentType, targetUrl) {
    const dest = targetUrl || _default;
    if (!dest) return; // decision B: no explicit target → do not forward
    _post(rawBody, contentType, dest, (err) => {
      if (err) {
        console.error(`[${label}] forward failed (${dest}): ${err.message} — spooling`);
        _spool(rawBody, contentType, dest);
      }
    });
  }

  // Retry everything currently spooled. Successful items are deleted; expired
  // items are dropped LOUDLY (no silent data loss); failures stay for next tick.
  function _drainOnce() {
    if (!spoolDir) return;
    let metas; try { metas = fs.readdirSync(spoolDir).filter(f => f.endsWith('.json')); } catch { return; }
    for (const mf of metas) {
      const id      = mf.slice(0, -5);
      const metaP   = path.join(spoolDir, mf);
      const binP    = path.join(spoolDir, id + '.bin');
      let meta, body;
      try { meta = JSON.parse(fs.readFileSync(metaP, 'utf8')); body = fs.readFileSync(binP); }
      catch { _rm(metaP); _rm(binP); continue; } // half-written / unreadable pair → drop
      if (Date.now() - (meta.ts || 0) > maxAgeMs) {
        console.warn(`[${label}] spool expired (>${Math.round(maxAgeMs / 60000)}m) — dropping ${id} dest=${meta.dest}`);
        _rm(metaP); _rm(binP); continue;
      }
      _post(body, meta.contentType, meta.dest, (err) => {
        if (!err) { _rm(metaP); _rm(binP); console.log(`[${label}] spool drained ${id} → ${meta.dest}`); }
        // err → leave on disk, retry next tick
      });
    }
  }

  let _timer = null;
  if (spoolDir && drainMs > 0) { _timer = setInterval(_drainOnce, drainMs); _timer.unref && _timer.unref(); }

  return {
    forward,
    setDefault: (u) => { _default = u; },
    _drainOnce, _spool,
    stop: () => { if (_timer) clearInterval(_timer); },
  };
}

module.exports = { createForwarder };

// ------------------------------------------------------------
// Self-check (node src/lpr-forward.js) — proves: a failed POST spools, a drain
// against a live 200 endpoint clears the spool, and an aged item is dropped.
// ------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');
  const os = require('os');
  (async () => {
    const spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lprspool-'));
    const fwd = createForwarder({ spoolDir, label: 'test', drainMs: 0, maxAgeMs: 60000 });

    // 1) forward to a dead port → spools one pair
    fwd.forward(Buffer.from('PAYLOAD'), 'text/plain', 'http://127.0.0.1:1/x');
    await new Promise(r => setTimeout(r, 200));
    let files = fs.readdirSync(spoolDir);
    assert.strictEqual(files.filter(f => f.endsWith('.bin')).length, 1, 'failed forward spooled');

    // 2) stand up a 200 server, point a spooled item at it, drain → spool empties
    let got = null;
    const srv = http.createServer((req, res) => {
      const chunks = []; req.on('data', c => chunks.push(c));
      req.on('end', () => { got = Buffer.concat(chunks).toString(); res.statusCode = 200; res.end('OK'); });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    // rewrite the spooled meta to target the live server
    const mf = fs.readdirSync(spoolDir).find(f => f.endsWith('.json'));
    const meta = JSON.parse(fs.readFileSync(path.join(spoolDir, mf), 'utf8'));
    meta.dest = `http://127.0.0.1:${port}/recv`;
    fs.writeFileSync(path.join(spoolDir, mf), JSON.stringify(meta));
    fwd._drainOnce();
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(got, 'PAYLOAD', 'drained body delivered');
    assert.strictEqual(fs.readdirSync(spoolDir).length, 0, 'spool cleared after success');

    // 3) expiry: write a pair whose ts is already older than maxAgeMs → drained = dropped
    const oldId = 'old_0000';
    fs.writeFileSync(path.join(spoolDir, oldId + '.bin'), Buffer.from('OLD'));
    fs.writeFileSync(path.join(spoolDir, oldId + '.json'),
      JSON.stringify({ dest: 'http://127.0.0.1:1/x', contentType: 'text/plain', ts: Date.now() - 120000 }));
    fwd._drainOnce();
    assert.strictEqual(fs.readdirSync(spoolDir).length, 0, 'expired spool dropped');

    srv.close();
    fs.rmSync(spoolDir, { recursive: true, force: true });
    console.log('lpr-forward self-check OK');
  })().catch(e => { console.error(e); process.exit(1); });
}
