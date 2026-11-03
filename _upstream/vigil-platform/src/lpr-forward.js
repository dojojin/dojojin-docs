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
                           drainMs = 15000, maxAgeMs = 3600000, timeoutMs = 10000,
                           maxConcurrent = 4 } = {}) {
  // Drain never uses the whole budget — one slot stays for live pushes so a big
  // backlog cannot starve the plates arriving right now.
  const drainWorkers = Math.max(1, maxConcurrent - 1);
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

  // ── Outbound pacing ────────────────────────────────────────────────────────
  // ONE budget of concurrent uploads, shared by live pushes and spool retries.
  // Bounding only the retry side was not enough: when the cameras replay a
  // buffered backlog they arrive ~30/s, and forward() used to fire each one the
  // instant it landed, so the burst opened its own pile of 1MB uploads before a
  // single retry ran. With a shared budget the destination sees a steady rate no
  // matter how lumpy the input is — anything over the limit goes to disk and
  // leaves on the next drain tick, which is the behaviour we want anyway:
  // backpressure belongs on our disk, not on the partner's socket.
  let _inFlight = 0;
  // Plates diverted straight to disk because the budget was full, counted since
  // the last drain summary. This branch used to be completely silent, which is
  // what made the hkt backlog so slow to diagnose: no success line, no failure
  // line, just a spool directory quietly growing. Counted rather than logged
  // per item — during a replay burst that would be thousands of lines.
  let _overflow = 0;
  function _postLimited(body, ct, dest, cb) {
    _inFlight++;
    _post(body, ct, dest, (err) => { _inFlight--; cb(err); });
  }

  // Fire-and-forget from the caller's view; anything not sent now lands in the
  // spool. Live traffic keeps one reserved slot (drain uses at most N-1) so a
  // large backlog can never fully starve fresh plates.
  function forward(rawBody, contentType, targetUrl) {
    const dest = targetUrl || _default;
    if (!dest) return; // decision B: no explicit target → do not forward
    if (_inFlight >= maxConcurrent) { _overflow++; _spool(rawBody, contentType, dest); return; }
    _postLimited(rawBody, contentType, dest, (err) => {
      if (err) {
        console.error(`[${label}] forward failed (${dest}): ${err.message} — spooling`);
        _spool(rawBody, contentType, dest);
      }
    });
  }

  // Retry spooled items, AT MOST `drainConcurrency` in flight. Successful items
  // are deleted; expired items are dropped LOUDLY (no silent data loss);
  // failures stay for the next tick.
  //
  // The concurrency cap is the whole point. This used to fire one _post per
  // spooled file per tick with no limit, which was harmless while the spool held
  // a handful of entries. With three ANPR cameras pushing ~1MB frames it opened
  // ~7,000 simultaneous uploads every 15s on what was then a 44 Mbps uplink
  // (measured 74 Mbps as of 2026-08-05 — the link was upgraded, this comment
  // wasn't): every request
  // then blew its 10s timeout, nothing drained, the backlog never shrank, and we
  // were effectively flooding a government endpoint. Sending a few at a time
  // lets each one finish well inside the timeout, so the queue actually empties.
  let _draining = false;
  async function _drainOnce() {
    if (!spoolDir || _draining) return;   // never overlap ticks
    _draining = true;
    try {
      let metas; try { metas = fs.readdirSync(spoolDir).filter(f => f.endsWith('.json')).sort(); } catch { return; }
      if (!metas.length) return;
      let i = 0, sent = 0, expired = 0;
      const worker = async () => {
        while (i < metas.length) {
          const mf = metas[i++];
          const id    = mf.slice(0, -5);
          const metaP = path.join(spoolDir, mf);
          const binP  = path.join(spoolDir, id + '.bin');
          let meta, body;
          try { meta = JSON.parse(fs.readFileSync(metaP, 'utf8')); body = fs.readFileSync(binP); }
          catch { _rm(metaP); _rm(binP); continue; } // half-written / unreadable pair → drop
          if (Date.now() - (meta.ts || 0) > maxAgeMs) {
            console.warn(`[${label}] spool expired (>${Math.round(maxAgeMs / 60000)}m) — dropping ${id} dest=${meta.dest}`);
            _rm(metaP); _rm(binP); expired++; continue;
          }
          const err = await new Promise(res => _postLimited(body, meta.contentType, meta.dest, res));
          if (!err) { _rm(metaP); _rm(binP); sent++; }
          else return;   // destination is unhappy — stop this worker, retry next tick
        }
      };
      await Promise.all(Array.from({ length: drainWorkers }, worker));
      // One line per tick, not per item: at 14k queued items a per-item log
      // buries everything else, but with no line at all the only way to tell the
      // queue is moving is to count files on disk over SSH — which is what this
      // cost us during the hkt backlog.
      if (sent || expired || _overflow) {
        // Best-effort count — the dir can legitimately disappear under us (tests
        // clean up; an operator can wipe the spool). A logging line must never be
        // what takes the forwarder down, and inside an async fn a throw here
        // would surface as an unhandled rejection.
        let left = '?';
        try { left = fs.readdirSync(spoolDir).filter(f => f.endsWith('.json')).length; } catch { /* gone */ }
        // inFlight is logged right after every drain post has settled, so at
        // this instant it should be ~0 (only a live push can be running). A
        // value that stays high pass after pass means a slot is stuck and is
        // NOT coming back — which is the difference between "busy" and "leaking"
        // that overflow= alone cannot tell you: a replay burst legitimately
        // overflows thousands of plates to disk with nothing leaked at all.
        console.log(`[${label}] spool drain: sent=${sent}${expired ? ` expired=${expired}` : ''}`
          + `${_overflow ? ` overflow=${_overflow}` : ''} inFlight=${_inFlight} remaining=${left}`);
        _overflow = 0;
      }
    } finally { _draining = false; }
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

    // 4) pacing: a burst of live forwards must never exceed maxConcurrent
    //    in flight — the whole point of the shared budget. Without it a replayed
    //    backlog opened thousands of simultaneous uploads to the partner.
    const spool2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lprpace-'));
    let cur = 0, peak = 0;
    const slow = http.createServer((req, res) => {
      cur++; peak = Math.max(peak, cur);
      req.resume();
      req.on('end', () => setTimeout(() => { cur--; res.statusCode = 200; res.end('OK'); }, 60));
    });
    await new Promise(r => slow.listen(0, '127.0.0.1', r));
    const paced = createForwarder({ spoolDir: spool2, label: 'pace', drainMs: 0, maxConcurrent: 3 });
    const dest2 = `http://127.0.0.1:${slow.address().port}/x`;
    for (let n = 0; n < 60; n++) paced.forward(Buffer.from('X'.repeat(2048)), 'text/plain', dest2);
    await new Promise(r => setTimeout(r, 400));
    assert.ok(peak <= 3, `live burst respected the budget (peak ${peak} <= 3)`);
    assert.ok(fs.readdirSync(spool2).some(f => f.endsWith('.bin')), 'overflow went to the spool, not the socket');
    paced.stop(); slow.close();
    fs.rmSync(spool2, { recursive: true, force: true });

    srv.close();
    fs.rmSync(spoolDir, { recursive: true, force: true });
    console.log('lpr-forward self-check OK');
  })().catch(e => { console.error(e); process.exit(1); });
}
