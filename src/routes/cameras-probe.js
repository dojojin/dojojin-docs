// ============================================================
// Vigil Platform — Routes: Cameras (probe / scan / bulk)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แยกออกจาก routes/cameras.js — route ทั้งหมดในไฟล์นี้ยังลงทะเบียนที่ตำแหน่งเดิมเป๊ะ
// (ลำดับการลงทะเบียนคือพฤติกรรม: literal path ต้องมาก่อน pattern `/api/cameras/:id`)
// จึงต้อง export สองตัว เพราะกลุ่มนี้ถูกคั่นกลางด้วยกลุ่ม httpHost ในไฟล์เดิม
'use strict';

const http  = require('http');
const https = require('https');
const net   = require('net');
const routeError = require('../helpers/routeError');
const { parseChallenge, buildDigestHeader, probeAuth, AUTH_CHECK_PATH } = require('../helpers/digestAuth');
const { edgeProxyBaseUrl } = require('../helpers/edgeProxyBaseUrl');
const env = require('../config');
const publishSiteConfig = require('../helpers/publishSiteConfig');
const emqxPublish   = require('../helpers/emqxPublish');
const scanRegistry  = require('../helpers/scanRegistry');
const { getSystemSetting } = require('../helpers/getSystemSetting');
const { parseChannelTitles } = require('../ingesters/dahua-channels');

// กลุ่มที่ 1 — test-connection / alarm-server-status / detect-models / sd-status
// (+ ตัวตั้งเวลาตรวจรุ่นอัตโนมัติ ซึ่งใช้ `_sweepRunning` ตัวเดียวกับ endpoint จึงต้องอยู่ closure เดียวกัน)
function registerConnectivity(app, pool, {
  auth, getIP, loadCameraConfig,
  logCameraAudit: _logCameraAudit,
  resolveSiteCode, triggerModelDetect, _edgeCall, _isPrivateIp,
}) {

  // POST /api/cameras/test-connection — TCP reachability + HTTP auth check.
  // Returns { reachable, auth_status: 'ok'|'failed'|'unknown', latency_ms }.
  // HTTP auth attempted for every vendor with an entry in AUTH_CHECK_PATH
  // (Hikvision / Dahua / Bosch RCP+); ONVIF-only reports auth_status='unknown'.
  app.post('/api/cameras/test-connection', auth.requireAdminOrGatedSiteAdmin, async (req, res) => {
    try {
      const { ip_address, http_port, vendor, camera_id, site_id } = req.body || {};
      let { username, password } = req.body || {};
      const ip = String(ip_address || '').trim();
      if (!ip) return res.status(400).json({ error: 'ip_address required' });
      // Health › Devices sends only camera_id (never a password to the
      // browser) — fill the saved credential so auth is actually tested
      // instead of always reading "unknown". Only when the IP is the camera's
      // own: probeAuth answers a Basic challenge with the password in base64,
      // so a stored secret must never go to an address the caller picked.
      if (camera_id && !username && !password) {
        const saved = (loadCameraConfig()?.cameras || []).find(c => c.camera_id === camera_id);
        if (saved && String(saved.ip_address || '').trim() === ip) {
          username = saved.username; password = saved.password;
        }
      }
      if (_isPrivateIp(ip)) console.warn(`[SEC-008] test-connection targeting ${ip} by ${req.user?.username} (${getIP(req)})`);

      // Proxy through the edge node whenever we can tell which site the camera
      // belongs to — central cannot reach LAN cameras directly. camera_id (an
      // already-saved camera) takes priority; site_id (picked in the form,
      // before save) is the fallback so "test before you commit" still reaches
      // the real edge instead of failing on a doomed direct connect.
      {
        const siteCode = await resolveSiteCode(pool, { camera_id, site_id });
        if (siteCode) {
          const edgeUrl = edgeProxyBaseUrl(siteCode, env.str('SNAPSHOT_PROXY_DOMAIN'));
          const secret  = env.str('SNAPSHOT_PROXY_SECRET');
          if (!secret) return res.status(503).json({ error: 'SNAPSHOT_PROXY_SECRET not configured' });
          const body = JSON.stringify({ ip_address: ip, http_port, vendor, username, password });
          return await new Promise((resolve) => {
            const url = new URL(`${edgeUrl}/test-connection`);
            const opts = {
              hostname: url.hostname, port: 443, path: url.pathname,
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${secret}` },
              timeout: 10000,
            };
            const pr = https.request(opts, (r) => {
              let d = '';
              r.on('data', c => { d += c; });
              r.on('end', () => {
                try { res.status(r.statusCode).json(JSON.parse(d)); } catch { res.status(502).json({ error: 'bad edge response' }); }
                resolve();
              });
            });
            pr.on('error', (e) => { res.status(502).json({ error: e.message }); resolve(); });
            pr.write(body); pr.end();
          });
        }
      }

      // Direct path — new cameras (no id) or no edge site found.
      const port = parseInt(http_port, 10) || 80;
      const v = String(vendor || 'bosch').toLowerCase();
      const start = Date.now();

      const reachable = await new Promise(resolve => {
        const sock = new net.Socket();
        sock.setTimeout(3000);
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('error', () => resolve(false));
        sock.once('timeout', () => { sock.destroy(); resolve(false); });
        sock.connect(port, ip);
      });
      const latency_ms = Date.now() - start;

      if (!reachable) return res.json({ reachable: false, auth_status: 'unknown', latency_ms, via_edge: false });

      // HTTP auth test for vendors that expose an HTTP API
      let auth_status = 'unknown';
      if (AUTH_CHECK_PATH[v] && username && password) {
        auth_status = await probeAuth(ip, port, AUTH_CHECK_PATH[v], username, password);
      }

      res.json({ reachable: true, auth_status, latency_ms, via_edge: false });
    } catch (e) { routeError(res, e, 'POST /api/cameras/test-connection'); }
  });

  // GET /api/cameras/:id/alarm-server-status — proxy to edge lpr-receiver.
  // Edge reads ISAPI httpHosts from the camera and compares vs FACE_PUSH_HOST.
  app.get('/api/cameras/:id/alarm-server-status', auth.requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const siteCode = await resolveSiteCode(pool, { camera_id: id });
      if (!siteCode) return res.status(404).json({ error: 'camera or site not found' });
      const edgeUrl  = edgeProxyBaseUrl(siteCode, env.str('SNAPSHOT_PROXY_DOMAIN'));
      const secret   = env.str('SNAPSHOT_PROXY_SECRET');
      if (!secret) return res.status(503).json({ error: 'SNAPSHOT_PROXY_SECRET not configured' });
      const url = `${edgeUrl}/alarm-server-status?camera_id=${encodeURIComponent(id)}`;
      https.get(url, { headers: { Authorization: `Bearer ${secret}` }, timeout: 8000 }, (pr) => {
        let body = '';
        pr.on('data', d => { body += d; });
        pr.on('end', () => {
          try { res.status(pr.statusCode).json(JSON.parse(body)); }
          catch { res.status(502).json({ error: 'bad edge response' }); }
        });
      }).on('error', (e) => res.status(502).json({ error: e.message }));
    } catch (e) { routeError(res, e, 'GET /api/cameras/:id/alarm-server-status'); }
  });

  // POST /api/cameras/detect-models — probe every camera that has no model yet.
  //
  // Exists because the per-camera hook only fires on create/edit, so any camera
  // added before it existed (or through a path that was missing it) has a null
  // model forever with no way to fill it short of re-saving each one by hand.
  // Reuses triggerModelDetect, so a camera on an edge site is probed by its edge
  // over MQTT and a central-reachable one inline — same as a normal save.
  //
  // แยก "วางแผน" ออกจาก "ยิง" — endpoint ต้องตอบทันทีว่าคิวไว้กี่ตัว แต่ตัวยิงกินเวลาหลายนาที
  // ถ้าปล่อยให้ endpoint query เองอีกชุด ตรรกะคัดกล้องจะอยู่สองที่และเลื่อนออกจากกันได้เงียบ ๆ
  // cameraIds: null = ทุกกล้อง (admin / รอบอัตโนมัติ) · array = เฉพาะกล้องเหล่านั้น (Site Admin —
  // มาจาก auth.scopedCameraIds() จึงเคารพทั้งแกน Site และแกนรายกล้อง)
  async function _planModelDetect(onlyMissing, cameraIds = null) {
    const { rows } = await pool.query(`
      SELECT c.id, c.ip_address, c.http_port, c.site_id
        FROM cameras c
       WHERE c.ip_address IS NOT NULL
         ${onlyMissing ? 'AND c.model IS NULL' : ''}
         AND ($1::text[] IS NULL OR c.id = ANY($1))
       ORDER BY c.site_id, c.id`, [cameraIds]);
    // Credentials live in cameras-config.json, not the DB.
    const cfg = loadCameraConfig();
    const byId = new Map((cfg.cameras || []).map(c => [c.camera_id, c]));
    const candidates = [], skipped = [];
    for (const r of rows) {
      const cam = byId.get(r.id);
      if (!cam || !cam.username || !cam.password) { skipped.push({ id: r.id, reason: 'no credentials in config' }); continue; }
      candidates.push({ r, cam });
    }
    return { candidates, skipped };
  }

  // เว้นจังหวะระหว่างกล้องแต่ละตัว — เดิมวนยิงรวดเดียวไม่มีดีเลย์ ซึ่งกับกล้อง Hik คือความเสี่ยง
  // digest lockout ~30 นาที พอเปลี่ยนมาเรียกทุก 6 ชม. ความเสี่ยงนั้นกลายเป็นของประจำ
  // ธงกันรอบซ้อนอยู่ตรงนี้ ไม่ใช่ที่ตัวตั้งเวลา — ไม่งั้นคนกดปุ่มระหว่างรอบอัตโนมัติกำลังวิ่ง
  // จะเปิดรอบที่สองซ้อนทันที ซึ่งคือ burst ที่ดีเลย์ตั้งใจกันพอดี
  let _sweepRunning = false;
  async function _sweepModelDetect({ onlyMissing = false, gapMs = 2000, plan = null } = {}) {
    if (_sweepRunning) return { started: [], skipped: [], elapsedMs: 0, skippedReason: 'sweep already running' };
    _sweepRunning = true;
    const t0 = Date.now();
    try {
      const { candidates, skipped } = plan || await _planModelDetect(onlyMissing);
      const started = [];
      for (let i = 0; i < candidates.length; i++) {
        const { r, cam } = candidates[i];
        triggerModelDetect({
          camera_id: r.id, ip_address: r.ip_address, http_port: r.http_port || cam.http_port || 80,
          username: cam.username, password: cam.password, vendor: cam.vendor, siteId: r.site_id,
        });
        started.push(r.id);
        if (i < candidates.length - 1) await new Promise(resolve => setTimeout(resolve, gapMs));
      }
      return { started, skipped, elapsedMs: Date.now() - t0 };
    } finally { _sweepRunning = false; }
  }

  // Fire-and-forget by design: the probes are per-camera with their own timeouts
  // and write their own result (model, or model_detect_error). Awaiting dozens of
  // them would hold the request open for minutes and time out the browser, so the
  // response says what was STARTED and the operator refreshes to see results.
  app.post('/api/cameras/detect-models', auth.requireAdminOrGatedSiteAdmin, async (req, res) => {
    try {
      // ตอบ 409 แทนที่จะเงียบ — ผู้กดต้องรู้ว่ารอบอัตโนมัติกำลังวิ่งอยู่ ไม่ใช่คิดว่าตัวเองสั่งไปแล้ว
      if (_sweepRunning) return res.status(409).json({ error: 'a model-detect sweep is already running' });
      const onlyMissing = req.query.all !== '1';
      // วางแผนก่อนตอบ เพื่อให้ตัวเลขในคำตอบเป็นของจริง แล้วส่งแผนเดิมนั้นให้ตัวยิงใช้ต่อ
      // Site Admin ตรวจได้เฉพาะกล้องของไซต์ตัวเอง (ยิงผ่าน edge ของไซต์นั้นตาม resolveSiteCode เดิม)
      const cameraIds = req.user?.role === 'site_admin'
        ? [...(await auth.scopedCameraIds(req.user.allowedSites, pool) || [])] : null;
      const plan = await _planModelDetect(onlyMissing, cameraIds);
      _sweepModelDetect({ onlyMissing, plan })
        .then((r) => {
          if (r.skippedReason) console.warn(`🔍 model-detect (manual): ${r.skippedReason}`);
          else console.log(`🔍 model-detect (manual): ยิง ${r.started.length} ตัว ข้าม ${r.skipped.length} ตัว ใช้เวลา ${Math.round(r.elapsedMs / 1000)}s`);
        })
        .catch((e) => console.error('🔍 model-detect (manual) ล้มเหลว:', e.message));
      await _logCameraAudit(req, 'model_detect_bulk', null, { started: plan.candidates.length, skipped: plan.skipped.length });
      res.json({
        started: plan.candidates.map((c) => c.r.id),
        skipped: plan.skipped,
        note: 'probes run in the background — reload the list in ~30s',
      });
    } catch (e) { routeError(res, e, 'POST /api/cameras/detect-models'); }
  });

  // GET /api/cameras/:id/sd-status — read the camera's own microSD, live.
  //
  // Proxied to the owning edge because that is where the camera credentials
  // live. Bosch cameras already have this via ONVIF; this is the Hikvision half,
  // and the panel has said "Bosch only" since it was written.
  //
  // Read-only, but admin-gated anyway: the reply carries the camera's recording
  // configuration, and the periodic collector (P2) is the path meant for routine
  // use — this one is for a human pressing refresh.
  app.get('/api/cameras/:id/sd-status', auth.requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      const siteCode = await resolveSiteCode(pool, { camera_id: id });
      if (!siteCode) return res.status(404).json({ error: 'no edge site for this camera' });
      const qs = req.query.search === '0' ? '&search=0' : '';
      const r = await _edgeCall(siteCode, `/sd-status?camera_id=${encodeURIComponent(id)}${qs}`);
      if (r.code !== 200 || r.json.ok === false) return res.status(r.code === 200 ? 502 : r.code).json(r.json);
      res.json(r.json);
    } catch (e) { routeError(res, e, 'GET /api/cameras/:id/sd-status'); }
  });

  // ============================================================
  // Scheduled Model Detection (every 6 hours)
  // ============================================================
  // ตรวจรุ่น/firmware ซ้ำทุก 6 ชม. — เดิมตรวจครั้งเดียวตอน Save ค่าจึงค้างอยู่ที่ตอนตั้งกล้อง
  // ครั้งแรก (2026-08-24: 97 จาก 144 ตัวเก่ากว่า 7 วัน) กล้องที่ถูกอัป firmware หลังติดตั้ง
  // จะรายงานเลขเก่าตลอดไป ซึ่งเกือบทำให้เอกสารที่ส่งผู้ผลิตระบุเวอร์ชันผิด
  async function _scheduledModelDetect() {
    const hrs = parseInt(await getSystemSetting(pool, 'model_detect_interval_hours') || '6', 10);
    if (!hrs) return;   // 0 = ปิด
    const r = await _sweepModelDetect({ onlyMissing: false, reason: 'scheduled' });
    if (r.skippedReason) { console.warn(`[model-detect] scheduled: ${r.skippedReason}`); return; }
    console.log(`[model-detect] scheduled: started ${r.started.length} cameras, skipped ${r.skipped.length}, ${Math.round(r.elapsedMs / 1000)}s`);
  }
  // รอบแรกหน่วง 10 นาทีหลัง boot (api-server restart บ่อย ยิงทุก boot จะกลายเป็นยิงรัวโดยไม่ตั้งใจ)
  // แล้วทุก 6 ชม.
  setTimeout(_scheduledModelDetect, 10 * 60 * 1000).unref?.();
  setInterval(_scheduledModelDetect, 6 * 60 * 60 * 1000).unref?.();
}

// กลุ่มที่ 2 — snapshot probe / NVR scan / bulk create-import
function registerProbeAndBulk(app, pool, {
  auth, getIP, loadCameraConfig, saveCameraConfig,
  _isPrivateIp, _validateForwardUrl, _sanitizeCameraId, triggerModelDetect,
}) {

  // ── Snapshot-path auto-detect (Phase MV.4b) ──────────────────
  // Dahua / generic-ONVIF cameras have no single universal snapshot URL.
  // Rather than make the operator hunt for it, probe a list of known
  // candidate paths and return the first that answers with a JPEG. The
  // camera-settings "🔍 ตรวจหาอัตโนมัติ" button calls this; on a miss the
  // operator types the path manually. Digest AND Basic auth are handled.
  const SNAPSHOT_CANDIDATES = {
    dahua: [
      '/cgi-bin/snapshot.cgi?channel=1',
      '/cgi-bin/snapshot.cgi?channel=0',
      '/cgi-bin/snapshot.cgi',
      '/cgi-bin/snapshot.cgi?1',
      '/onvif/snapshot',
    ],
    onvif: [
      '/onvif/snapshot',
      '/onvif-http/snapshot?Profile_1',
      '/snapshot.jpg',
      '/snap.jpg',
      '/image/jpeg.cgi',
      '/jpg/image.jpg',
      '/cgi-bin/snapshot.cgi?channel=1',
      '/axis-cgi/jpg/image.cgi',
      '/ISAPI/Streaming/channels/101/picture',
      '/tmpfs/auto.jpg',
    ],
  };

  // _isPrivateIp + _validateForwardUrl are module-level (SEC-008 / CS6) — see top of file.

  // Fetch <uri> and resolve true only if it answers 200 with a JPEG
  // (Content-Type image/* OR a body starting with the JPEG magic FF D8 —
  // guards against cameras that 200 an HTML error page). Handles the
  // Digest 401 two-step and a Basic fallback. ~5s timeout.
  function _probeHttpImage(host, port, uri, user, pass) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      const attempt = (authHeader) => {
        const headers = {};
        if (authHeader) headers.Authorization = authHeader;
        const r = http.get({ host, port, path: uri, headers, timeout: 5000 }, (pr) => {
          if (pr.statusCode === 401 && !authHeader) {
            const wa = pr.headers['www-authenticate'] || '';
            pr.resume();
            if (/digest/i.test(wa)) return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa)));
            if (/basic/i.test(wa)) return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
            return finish(false);
          }
          if (pr.statusCode !== 200) { pr.resume(); return finish(false); }
          const ct = String(pr.headers['content-type'] || '').toLowerCase();
          let head = Buffer.alloc(0);
          pr.on('data', (c) => {
            head = Buffer.concat([head, c]);
            if (head.length >= 2) {
              const isJpeg = head[0] === 0xFF && head[1] === 0xD8;
              pr.destroy();
              finish(ct.includes('image') || isJpeg);
            }
          });
          pr.on('end', () => finish(ct.includes('image')));
        });
        r.on('error', () => finish(false));
        r.on('timeout', () => { r.destroy(); finish(false); });
      };
      attempt(null);
    });
  }

  // Fetch a snapshot image as base64 with Digest/Basic auth fallback.
  // Returns base64 string or null. Max body read 600 KB.
  function _fetchImageBase64(host, port, uri, user, pass) {
    return new Promise(resolve => {
      let settled = false;
      const finish = v => { if (!settled) { settled = true; resolve(v); } };
      const MAX_BYTES = 600 * 1024;

      const attempt = authHeader => {
        const headers = authHeader ? { Authorization: authHeader } : {};
        const r = http.get({ host, port, path: uri, headers, timeout: 8000 }, pr => {
          if (pr.statusCode === 401 && !authHeader) {
            const wa = pr.headers['www-authenticate'] || '';
            pr.resume();
            if (/digest/i.test(wa)) return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa)));
            if (/basic/i.test(wa)) return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
            return finish(null);
          }
          if (pr.statusCode !== 200) { pr.resume(); return finish(null); }
          const ct = String(pr.headers['content-type'] || '').toLowerCase();
          const chunks = [];
          let total = 0;
          pr.on('data', c => {
            total += c.length;
            if (total > MAX_BYTES) { pr.destroy(); return finish(null); }
            chunks.push(c);
          });
          pr.on('end', () => {
            const buf = Buffer.concat(chunks);
            const isJpeg = buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xD8;
            finish((ct.includes('image') || isJpeg) ? buf.toString('base64') : null);
          });
        });
        r.on('error', () => finish(null));
        r.on('timeout', () => { r.destroy(); finish(null); });
      };
      attempt(null);
    });
  }

  // POST /api/cameras/lpr-forward-test — reachability probe for the LPR data-forward
  // endpoint (e.g. CIB). Sends an EMPTY POST (no PII to a gov endpoint) and reports
  // the raw HTTP status. NOTE: this proves "we can reach it + it answers", NOT that a
  // real ANPR push will be accepted (an empty body may get a different status than a
  // full multipart push). Status alone can't diagnose path-vs-IP — in this system a
  // wrong path AND an IP-block both returned 403 (session 2026-07-01) — so we report
  // the status honestly and don't guess the cause.
  app.post('/api/cameras/lpr-forward-test', auth.requireAdmin, async (req, res) => {
    try {
      const fv = _validateForwardUrl(req.body?.url);
      if (!fv.ok)  return res.status(400).json({ error: fv.error });   // bad scheme / invalid url
      if (!fv.url) return res.status(400).json({ error: 'empty_url' });
      if (fv.isPrivate) console.warn(`[SEC-008] lpr-forward-test → ${fv.url} (private target) by ${req.user?.username} (${getIP(req)})`);
      const u   = new URL(fv.url);
      const mod = u.protocol === 'https:' ? https : http;
      const start = Date.now();
      const result = await new Promise(resolve => {
        const preq = mod.request({
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: (u.pathname || '/') + (u.search || ''),
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': 0 },
        }, r => { r.resume(); r.on('end', () => resolve({ reachable: true, status: r.statusCode })); });
        preq.on('error', e => resolve({ reachable: false, error: e.code || e.message }));
        preq.setTimeout(5000, () => { preq.destroy(); resolve({ reachable: false, error: 'timeout' }); });
        preq.end(); // empty body — probe only
      });
      res.json({ ...result, latency_ms: Date.now() - start });
    } catch (e) { routeError(res, e, 'POST /api/cameras/lpr-forward-test'); }
  });

  // POST /api/cameras/snapshot-preview — fetch a live JPEG and return as
  // base64. Probes candidate paths if snapshot_path is not provided.
  // Body: { vendor, ip_address, http_port, username, password, snapshot_path? }
  // Response: { found, snapshot_path?, image_base64? }
  app.post('/api/cameras/snapshot-preview', auth.requireAdmin, async (req, res) => {
    try {
      const { vendor, ip_address, http_port, username, password, snapshot_path } = req.body || {};
      const ip = String(ip_address || '').trim();
      if (!ip) return res.status(400).json({ error: 'ip_address required' });
      if (_isPrivateIp(ip)) console.warn(`[SEC-008] snapshot-preview targeting ${ip} by ${req.user?.username} (${getIP(req)})`);

      const v = String(vendor || 'onvif').toLowerCase();
      const port = parseInt(http_port, 10) || 80;
      const user = String(username || ''), pass = String(password || '');

      // Use provided path or probe for one
      let pathToUse = String(snapshot_path || '').trim();
      if (!pathToUse) {
        const candidates = SNAPSHOT_CANDIDATES[v] || SNAPSHOT_CANDIDATES.onvif;
        for (const uri of candidates) {
          const ok = await _probeHttpImage(ip, port, uri, user, pass);
          if (ok) { pathToUse = uri; break; }
        }
      }
      if (!pathToUse) return res.json({ found: false });

      const imageBase64 = await _fetchImageBase64(ip, port, pathToUse, user, pass);
      if (!imageBase64) return res.json({ found: false, snapshot_path: pathToUse });

      res.json({ found: true, snapshot_path: pathToUse, image_base64: imageBase64 });
    } catch (e) { routeError(res, e, 'POST /api/cameras/snapshot-preview'); }
  });

  // POST /api/cameras/probe-snapshot — { vendor, ip_address, http_port,
  // username, password } → { found, snapshot_path?, tried[] }. Admin-gated
  // by the requireAdminForWrites('/api/cameras') mount above.
  app.post('/api/cameras/probe-snapshot', async (req, res) => {
    try {
      const { vendor, ip_address, http_port, username, password } = req.body || {};
      const ip = String(ip_address || '').trim();
      if (!ip) return res.status(400).json({ error: 'ip_address required' });
      // SEC-008: log private-IP probes for audit trail (non-blocking — on-prem admin needs LAN access)
      // To enable blocking for cloud/multi-tenant SKU: uncomment the rejection below
      if (_isPrivateIp(ip)) {
        console.warn(`[SEC-008] probe-snapshot targeting private IP ${ip} by user ${req.user?.username} (${getIP(req)})`);
        // return res.status(400).json({ error: 'private IP not allowed' }); // enable for cloud SKU
      }
      const v = String(vendor || 'onvif').toLowerCase();
      const port = parseInt(http_port, 10) || 80;
      const candidates = SNAPSHOT_CANDIDATES[v] || SNAPSHOT_CANDIDATES.onvif;
      const tried = [];
      for (const uri of candidates) {
        const ok = await _probeHttpImage(ip, port, uri, username || '', password || '');
        tried.push(uri);
        if (ok) return res.json({ found: true, snapshot_path: uri, tried });
      }
      res.json({ found: false, tried });
    } catch (e) { routeError(res, e, 'POST /api/cameras/probe-snapshot'); }
  });

  // ── NVR channel scan (Phase 3) ─────────────────────────────────────
  // Fetch a text body (Dahua config CGI) with Digest/Basic auth fallback.
  // Caps the body at 256 KB — a ChannelTitle dump is tiny. Returns text or null.
  function _fetchHttpText(host, port, uri, user, pass) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      const attempt = (authHeader) => {
        const headers = {};
        if (authHeader) headers.Authorization = authHeader;
        const r = http.get({ host, port, path: uri, headers, timeout: 6000 }, (pr) => {
          if (pr.statusCode === 401 && !authHeader) {
            const wa = pr.headers['www-authenticate'] || '';
            pr.resume();
            if (/digest/i.test(wa)) return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa)));
            if (/basic/i.test(wa))  return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
            return finish(null);
          }
          if (pr.statusCode !== 200) { pr.resume(); return finish(null); }
          let body = '', len = 0;
          pr.on('data', (c) => { len += c.length; if (len > 262144) pr.destroy(); else body += c; });
          pr.on('end', () => finish(body));
        });
        r.on('error', () => finish(null));
        r.on('timeout', () => { r.destroy(); finish(null); });
      };
      attempt(null);
    });
  }
  const _CHANNEL_TITLE_URI = '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle';

  // POST /api/cameras/scan-nvr — enumerate an NVR's channels. Central-reachable
  // sites (main/unassigned) probe directly; edge sites round-trip the request
  // over MQTT to the site's edge-config-agent (central can't reach the edge
  // LAN). Body: { ip_address, http_port, username, password, site_id, vendor }.
  app.post('/api/cameras/scan-nvr', async (req, res) => {
    try {
      const { ip_address, http_port, username, password, site_id, vendor } = req.body || {};
      const ip = String(ip_address || '').trim();
      if (!ip) return res.status(400).json({ error: 'ip_address required' });
      if ((vendor || 'dahua').toLowerCase() !== 'dahua') return res.status(400).json({ error: 'NVR scan supports Dahua only' });
      if (_isPrivateIp(ip)) console.warn(`[SEC-008] scan-nvr targeting private IP ${ip} by user ${req.user?.username} (${getIP(req)})`);
      const port = parseInt(http_port, 10) || 80;

      let siteCode = null;
      if (site_id) {
        const { rows } = await pool.query('SELECT code FROM sites WHERE id = $1', [parseInt(site_id, 10)]);
        siteCode = rows[0]?.code || null;
      }
      const isEdge = siteCode && siteCode !== 'main';

      if (!isEdge) {
        const text = await _fetchHttpText(ip, port, _CHANNEL_TITLE_URI, username || '', password || '');
        if (text == null) return res.status(502).json({ error: 'NVR unreachable or auth failed' });
        return res.json({ mode: 'direct', channels: parseChannelTitles(text) });
      }
      // edge site → publish request; client polls GET for the reply
      const scanId = require('crypto').randomUUID();
      scanRegistry.register(scanId);
      await emqxPublish(`projects/${siteCode}/_config/scan-nvr`,
        { scan_id: scanId, ip_address: ip, http_port: port, username: username || '', password: password || '' });
      res.json({ mode: 'edge', scan_id: scanId });
    } catch (e) { routeError(res, e, 'POST /api/cameras/scan-nvr'); }
  });

  // GET /api/cameras/scan-nvr/:scanId — poll for an edge scan reply.
  app.get('/api/cameras/scan-nvr/:scanId', (req, res) => {
    const e = scanRegistry.get(req.params.scanId);
    if (!e) return res.status(404).json({ error: 'unknown or expired scan' });
    if (e.status === 'ready') return res.json({ status: 'ready', channels: e.channels });
    if (e.status === 'error') return res.json({ status: 'error', error: e.error });
    res.json({ status: 'pending' });
  });

  // POST /api/cameras/bulk-create-channels — create one camera per selected NVR
  // channel in a single call. Body: { vendor, ip_address, http_port, username,
  // password, site_id, device_id, channels:[{nvr_channel, camera_id,
  // camera_name, capture_categories[]}] }. Existing camera_ids are skipped, not
  // overwritten. Passwords go into cameras-config.json in plaintext (same as the
  // single-create path); publishSiteConfig encrypts them on the way to the edge.
  const _CAP_CATS = ['face', 'anpr', 'vehicle', 'nonmotor', 'person', 'rule'];
  app.post('/api/cameras/bulk-create-channels', auth.requireAdminOrGatedSiteAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const channels = Array.isArray(b.channels) ? b.channels : [];
      if (!channels.length) return res.status(400).json({ error: 'channels (non-empty array) required' });
      const ip = String(b.ip_address || '').trim();
      if (!ip) return res.status(400).json({ error: 'ip_address required' });
      const siteId  = b.site_id ? (parseInt(b.site_id, 10) || null) : null;
      const port    = parseInt(b.http_port, 10) || 80;
      const deviceId = String(b.device_id || '').trim() || null;

      const config = loadCameraConfig();
      const existing = new Set((config.cameras || []).map(c => c.camera_id));
      const created = [], skipped = [];
      for (const ch of channels) {
        const camId = String(ch.camera_id || '').trim();
        const nvrCh = parseInt(ch.nvr_channel, 10);
        if (!camId || !Number.isInteger(nvrCh)) { skipped.push({ camera_id: camId, reason: 'invalid' }); continue; }
        if (existing.has(camId)) { skipped.push({ camera_id: camId, reason: 'exists' }); continue; }
        const capCats = Array.isArray(ch.capture_categories)
          ? ch.capture_categories.filter(c => _CAP_CATS.includes(c)) : [];
        const camRole = ['standard', 'lpr', 'face'].includes(ch.cam_role) ? ch.cam_role : 'standard';
        const entry = {
          camera_id: camId,
          camera_name: String(ch.camera_name || camId).trim(),
          vendor: 'dahua',
          ip_address: ip,
          http_port: port,
          username: String(b.username || '').trim(),
          password: String(b.password || ''),
          cam_role: camRole,
          nvr_channel: nvrCh,
          ...(capCats.length ? { capture_categories: capCats } : {}),
          ...(deviceId ? { device_id: deviceId } : {}),
        };
        config.cameras.push(entry);
        existing.add(camId);
        await pool.query(
          `INSERT INTO cameras (id, name, ip_address, enabled, site_id, cam_role,
                                 nvr_channel, capture_categories, device_id)
             VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO NOTHING`,
          [camId, entry.camera_name, ip, siteId, camRole, nvrCh, capCats.length ? capCats : null, deviceId]
        ).catch(e => console.warn('[bulk-create] DB insert warn:', e.message));
        created.push(camId);
        // Third insert path, third place this hook has to be repeated — it was
        // missing here, which is why every HDY-NVR-0X-chY row had a null model.
        // For an NVR channel the probe hits the NVR itself, so the model that
        // comes back is the recorder's; that is still the useful answer.
        triggerModelDetect({
          camera_id: camId, ip_address: ip, http_port: port,
          username: entry.username, password: entry.password, vendor: 'dahua', siteId,
        });
      }
      if (created.length) {
        saveCameraConfig(config);
        if (siteId) publishSiteConfig(siteId, config.cameras, pool).catch(e =>
          console.warn('[bulk-create] publishSiteConfig warn:', e.message));
      }
      res.json({ created, skipped });
    } catch (e) { routeError(res, e, 'POST /api/cameras/bulk-create-channels'); }
  });

  // POST /api/cameras/bulk-import — CSV-driven batch create of standalone cameras.
  // Body: { cameras: [{ camera_id, vendor, ip_address, site, camera_name?,
  //   cam_role?, username?, password?, http_port?, capture_categories?(array|';'str),
  //   location?, latitude?, longitude?, nvr_channel?, notes? }, ...] }
  // Partial success: bad rows are SKIPPED with a reason, never fail the batch.
  // 'site' resolves by site code, else site name → site_id. Created cameras are
  // enabled immediately; per affected non-main site we publishSiteConfig so the
  // owning edge picks them up right away. Passwords land plaintext in
  // cameras-config.json (same model as single/bulk create), encrypted on the way
  // to the edge. See docs/superpowers/plans/2026-07-17-bulk-camera-csv-import.md
  app.post('/api/cameras/bulk-import', auth.requireAdminOrGatedSiteAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.cameras) ? req.body.cameras : [];
      if (!rows.length) return res.status(400).json({ error: 'cameras (non-empty array) required' });
      if (rows.length > 500) return res.status(413).json({ error: 'too many rows (max 500)' });
      const VENDORS = ['bosch', 'hikvision', 'dahua', 'onvif'];
      const ROLES   = ['standard', 'face', 'lpr'];
      const IPV4    = /^(\d{1,3}\.){3}\d{1,3}$/;

      // site lookup: code (lowercased) or name → { id, code }
      const { rows: siteRows } = await pool.query('SELECT id, code, name FROM sites');
      const siteByKey = new Map();
      for (const s of siteRows) {
        siteByKey.set(String(s.code).toLowerCase(), { id: s.id, code: s.code });
        siteByKey.set(String(s.name).toLowerCase(), { id: s.id, code: s.code });
      }

      const config = loadCameraConfig();
      const existing = new Set((config.cameras || []).map(c => c.camera_id));
      const created = [], skipped = [], affectedSites = new Set();

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        const rowNo = i + 1;
        const fail = (reason, camera_id) => skipped.push({ row: rowNo, camera_id: camera_id || null, reason });

        const { cleaned: camId } = _sanitizeCameraId(r.camera_id);
        if (camId.startsWith('#')) { fail('example row', camId); continue; }  // template sample — never import
        if (!camId) { fail('missing camera_id'); continue; }
        const vendor = String(r.vendor || '').toLowerCase().trim();
        if (!VENDORS.includes(vendor)) { fail('bad vendor', camId); continue; }
        const ip = String(r.ip_address || '').trim();
        if (!IPV4.test(ip)) { fail('bad ip_address', camId); continue; }
        const site = siteByKey.get(String(r.site || '').toLowerCase().trim());
        if (!site) { fail('unknown site', camId); continue; }
        if (existing.has(camId)) { fail('duplicate camera_id', camId); continue; }

        const camRole = ROLES.includes(String(r.cam_role || '').toLowerCase()) ? String(r.cam_role).toLowerCase() : 'standard';
        let capCats = r.capture_categories;
        if (typeof capCats === 'string') capCats = capCats.split(/[;,]/).map(s => s.trim());
        capCats = Array.isArray(capCats) ? capCats.filter(c => _CAP_CATS.includes(c)) : [];
        const nvrChParsed = parseInt(r.nvr_channel, 10);
        const nvrCh = Number.isInteger(nvrChParsed) ? nvrChParsed : null;

        const entry = {
          camera_id: camId,
          camera_name: String(r.camera_name || camId).trim(),
          vendor,
          ip_address: ip,
          http_port: parseInt(r.http_port, 10) || 80,
          username: String(r.username || '').trim(),
          password: String(r.password || ''),
          cam_role: camRole,
          ...(r.location ? { location: String(r.location).trim() } : {}),
          ...(r.latitude ? { latitude: parseFloat(r.latitude) } : {}),
          ...(r.longitude ? { longitude: parseFloat(r.longitude) } : {}),
          ...(r.notes ? { notes: String(r.notes).trim() } : {}),
          ...(nvrCh != null ? { nvr_channel: nvrCh } : {}),
          ...(capCats.length ? { capture_categories: capCats } : {}),
        };
        config.cameras.push(entry);
        existing.add(camId);
        await pool.query(
          `INSERT INTO cameras (id, name, ip_address, http_port, enabled, site_id, cam_role,
                                location_label, latitude, longitude, nvr_channel, capture_categories)
             VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (id) DO NOTHING`,
          [camId, entry.camera_name, ip, entry.http_port, site.id, camRole,
           entry.location || null, entry.latitude ?? null, entry.longitude ?? null,
           nvrCh, capCats.length ? capCats : null]
        ).catch(e => console.warn('[bulk-import] DB insert warn:', e.message));
        created.push(camId);
        if (site.code !== 'main') affectedSites.add(site.id);
        // Same trigger-on-save model detect as single add/edit (was missing
        // from this path entirely — bulk-imported cameras never got a model).
        triggerModelDetect({
          camera_id: camId, ip_address: ip, http_port: entry.http_port,
          username: entry.username, password: entry.password, vendor, siteId: site.id,
        });
      }

      if (created.length) {
        saveCameraConfig(config);
        for (const sid of affectedSites) {
          publishSiteConfig(sid, config.cameras, pool).catch(e =>
            console.warn('[bulk-import] publishSiteConfig warn:', e.message));
        }
      }
      res.json({ created, skipped });
    } catch (e) { routeError(res, e, 'POST /api/cameras/bulk-import'); }
  });
}

module.exports = { registerConnectivity, registerProbeAndBulk };
