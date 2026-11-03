// ============================================================
// Vigil Platform — Partner API (/v1) — Phase TP1c
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Everything an external partner can reach. Mounted at /v1 and NOT under
// /api, because /api carries three session-auth middlewares
// (api-server.js:799, :874, :889) and a partner has no session — they sign
// each request with AK/SK instead (helpers/hcpVerify.js).
//
// Two layers, and the split is the whole design:
//
//   1. WHO — this file. Looks up the app_key, checks the signature, rejects
//      replays, writes the audit row.
//   2. WHAT — Postgres. Every partner query runs as their own database role,
//      so a bug here cannot hand out a column that role was never granted.
//
// Layer 2 only holds if the role is actually worn, and SET LOCAL ROLE fails
// open and silently when it is not inside a transaction (GOTCHAS #145). So
// route handlers are not given the pool at all — they get req.partnerQuery(),
// which is the only path to the database and always opens a transaction. The
// safe way is the only way rather than the documented way.
// ============================================================
'use strict';

const { verifyRequest, createNonceStore } = require('../helpers/hcpVerify');
const { decryptCred } = require('../crypto-creds');
const { ENDPOINTS, resolveColumns } = require('../helpers/partnerSchema');
const { createTtlCache } = require('../helpers/ttlCache');
const { buildSpec, readableColumns } = require('../openapi-gen');
const { asPartnerRole } = require('../helpers/asPartnerRole');

// The column lists come from partnerSchema so the generated spec and the SQL
// cannot describe different things. Reading them here rather than repeating
// them is the whole reason that file exists.
const ep = (id) => ENDPOINTS.find((e) => e.id === id);

module.exports = (app, pool) => {
  const nonceStore = createNonceStore();

  // Inside app.use('/v1', …) Express strips the mount prefix from req.path, so
  // it reads '/healthz' where the caller signed '/v1/healthz'. Signing that
  // rebuilds a different string and every correct signature is rejected as a
  // wrong one — which was exactly the first symptom this file produced. Use
  // the path the request actually carried, and use the same one in the audit
  // log so a rejection can be matched to what the partner sent.
  const fullPath = (req) => (req.baseUrl || '') + req.path;

  // Audit rows are written after the response has gone out. A partner should
  // not wait on our logging, and a logging failure must not turn a served
  // request into a 500 — hence the swallowed catch, which is the one place
  // that is the right call rather than laziness.
  const logRequest = (row) => {
    pool.query(
      `INSERT INTO api_request_log (consumer_id, app_key, ip, method, path, status, reason, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.consumerId || null, row.appKey || null, row.ip || null, row.method,
       row.path, row.status, row.reason || null, row.durationMs]
    ).catch((e) => console.warn('[partner-api] audit write failed:', e.message));
  };

  // RFC 7807. A partner integrating against us reads these; "error: 'bad'" in
  // a bare JSON body tells them nothing about which field to fix.
  const problem = (res, req, status, title, detail) => {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = process.env.PUBLIC_ORIGIN || `${proto}://${req.headers.host}`;
    return res.status(status).type('application/problem+json').json({
      type: `${baseUrl}/v1/errors/${title}`,
      title, status, detail,
    });
  };

  const REASON_DETAIL = {
    'missing-headers': 'X-Ca-Key, X-Ca-Nonce, X-Ca-Timestamp and X-Ca-Signature are all required.',
    'stale-timestamp': 'X-Ca-Timestamp is more than 5 minutes from server time. Check the clock on the calling host.',
    'nonce-replay': 'This X-Ca-Nonce has already been used. Generate a new one per request.',
    'bad-signature': 'Signature did not match. Verify the string-to-sign layout and the secret.',
    'repeated-query-param': 'A query parameter was supplied more than once, which cannot be signed unambiguously.',
    'non-ascii-query': 'A query parameter contains non-ASCII characters, which cannot be signed unambiguously. Transliterate or omit it.',
    'unknown-key': 'X-Ca-Key is not recognised.',
    'inactive': 'This consumer has been deactivated.',
    'expired': 'These credentials have passed their expiry date. Contact the operator to extend them.',
    'rate-limited': 'Too many requests for this consumer. See the Retry-After header.',
    'query-too-slow': 'The query exceeded the time limit and was stopped.',
  };

  // ---------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------
  // Fixed window per consumer, same shape as the CSP reporter's limiter in
  // src/routes/users.js:79. A fixed window lets a caller send up to 2× the
  // limit across a window boundary; that is a known and accepted property here,
  // because this exists to stop a runaway poll loop, not to meter billing.
  //
  // In memory, which is correct only while api-server is a single fork_mode
  // process — verified via pm2 jlist. Under cluster_mode the effective limit
  // silently becomes rate × workers. Same caveat as the nonce store, and for
  // the same reason.
  const rateMap = new Map();   // consumer id -> [count, windowStart]

  function rateCheck(consumer, now = Date.now()) {
    const limit = consumer.rate_per_min || 60;
    const [count, start] = rateMap.get(consumer.id) || [0, now];
    const fresh = now - start >= 60_000;
    const next = fresh ? 1 : count + 1;
    rateMap.set(consumer.id, [next, fresh ? now : start]);
    if (next > limit) {
      // Seconds until the window resets, rounded up — telling a caller to
      // retry in 0 invites them straight back into the wall.
      return { ok: false, retryAfter: Math.max(1, Math.ceil((60_000 - (now - start)) / 1000)) };
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------
  const authenticate = async (req, res, next) => {
    const started = Date.now();
    const ip = (req.headers['cf-connecting-ip'] || '').trim() || req.ip || '';
    const appKey = req.headers['x-ca-key'];

    const reject = (status, reason, consumerId) => {
      logRequest({ consumerId, appKey, ip, method: req.method, path: fullPath(req),
        status, reason, durationMs: Date.now() - started });
      return problem(res, req, status, reason, REASON_DETAIL[reason] || '');
    };

    if (!appKey) return reject(401, 'missing-headers');

    let consumer;
    try {
      const { rows } = await pool.query(
        `SELECT id, slug, label, app_secret_enc, db_role, active, rate_per_min,
                site_codes, max_lookback_days, expires_at
           FROM api_consumers WHERE app_key = $1`, [appKey]);
      consumer = rows[0];
    } catch (e) {
      console.error('[partner-api] consumer lookup failed:', e.message);
      return reject(500, 'lookup-failed');
    }

    // Same shape of reply for an unknown key and an inactive one — both are
    // "no", and distinguishing them tells a prober which keys exist. The
    // audit row keeps the real reason for us.
    if (!consumer) return reject(401, 'unknown-key');
    if (!consumer.active) return reject(401, 'inactive', consumer.id);
    // Checked here rather than by a nightly sweep: a sweep leaves a window
    // between the deadline and the next run, and stops enforcing anything at
    // all if it stops running. A timestamp comparison has neither problem.
    if (consumer.expires_at && new Date(consumer.expires_at) <= new Date()) {
      return reject(401, 'expired', consumer.id);
    }

    // The secret never crosses the wire — the partner signs with it, we
    // recompute with our copy. That copy is encrypted at rest, so it has to be
    // decrypted here to be usable (migration 119 explains why hashing is not
    // an option for HMAC).
    const secret = decryptCred(consumer.app_secret_enc);
    // decryptCred returns the input unchanged when CAMERA_SECRET_KEY is unset
    // — a deliberate passthrough that let camera configs migrate gradually. For
    // a partner secret that would mean verifying against ciphertext and
    // refusing every correctly-signed request, so catch it here and say so
    // rather than emitting a stream of bad-signature that looks like the
    // partner's bug.
    if (!secret || secret.startsWith('enc:v1:')) {
      console.error('[partner-api] cannot decrypt app_secret — is CAMERA_SECRET_KEY set?');
      return reject(500, 'secret-undecryptable', consumer.id);
    }

    const v = verifyRequest({
      method: req.method,
      path: fullPath(req),
      query: req.query,
      body: req.rawBody ? req.rawBody.toString('utf8') : undefined,
      headers: req.headers,
      appSecret: secret,
      nonceStore,
    });
    if (!v.ok) return reject(v.status, v.reason, consumer.id);

    // Counted after the signature check, not before: an unsigned flood must
    // not be able to exhaust a real partner's allowance, and only a caller who
    // proved they hold the secret is spending that partner's quota.
    const rl = rateCheck(consumer);
    if (!rl.ok) {
      res.setHeader('Retry-After', rl.retryAfter);
      return reject(429, 'rate-limited', consumer.id);
    }

    req.partner = consumer;

    // Finish the audit row once the response is actually out, so the status
    // and duration are the real ones rather than what we intended.
    res.on('finish', () => logRequest({
      consumerId: consumer.id, appKey, ip, method: req.method, path: fullPath(req),
      status: res.statusCode, durationMs: Date.now() - started,
    }));

    pool.query('UPDATE api_consumers SET last_seen_at = NOW() WHERE id = $1', [consumer.id])
      .catch(() => {});

    next();
  };

  // ---------------------------------------------------------------
  // The only way to the database
  // ---------------------------------------------------------------
  // Wraps every partner query in an explicit transaction and wears their role
  // for its duration — helpers/asPartnerRole.js, the one copy shared with the
  // admin preview (merged 2026-10-22; read GOTCHAS #145 before changing it):
  //
  //   - without BEGIN, SET LOCAL ROLE is a silent no-op and the query runs as
  //     the superuser this pool connects with, reading everything;
  //   - a bare SET ROLE would survive release() and leak onto whoever borrows
  //     the connection next;
  //   - the role name is validated (SET ROLE takes an identifier, not a
  //     parameter) and current_user is asserted before any data is read;
  //   - a 5 s statement_timeout bounds every query, whatever it turns out to be.
  //     The feeds run in 3-7 ms and an exact plate lookup in 0.2 ms, but a
  //     partial plate search is inherently unbounded (measured 488,802 buffers,
  //     ~3.8 GB, 14.6 s cold) — bounding each shape individually is whack-a-mole.
  const partnerQuery = (dbRole) => (sql, params) => asPartnerRole(pool, dbRole, sql, params);

  const withPartnerDb = (req, res, next) => {
    req.partnerQuery = partnerQuery(req.partner.db_role);
    next();
  };

  app.use('/v1', authenticate, withPartnerDb);

  // ระยะ 2 ขั้น 1 — เลือกเฉพาะคอลัมน์ที่ role ของ partner ถือสิทธิ์จริง (admin pool อ่าน catalogue เพราะ role ของเขา
  // introspect ตัวเองไม่ได้) · แคช 10 วิ: แอดมินแก้สิทธิ์แล้วมีผลภายในนั้น ส่วนตัวกันจริงยังเป็น Postgres (42501 → 403)
  // คืน null = ขาดคอลัมน์บังคับ (id/เวลา/camera_id/plate_number) → ผู้เรียกตอบ 403
  const _grantCache = createTtlCache({ name: 'partner:granted-cols', ttlMs: 10 * 1000 });
  async function grantedCols(req, e) {
    const readable = await _grantCache.wrap(`${req.partner.db_role}|${e.view}`, async () => {
      const client = await pool.connect();
      try { return (await readableColumns(client, req.partner.db_role, e.view)).map((r) => r.column_name); }
      finally { client.release(); }
    });
    const r = resolveColumns(e, readable);
    return r.missingRequired.length ? null : r.cols.join(', ');
  }
  const notPermitted = (res, req) => problem(res, req, 403, 'not-permitted',
    'This consumer is not granted the data this endpoint returns. Contact the operator.');

  // A denial from Postgres is a provisioning mistake on our side, not a fault,
  // and 500 tells a partner to retry something that will never succeed. Answer
  // 403 so they stop and call us — without naming the column, which would hand
  // out the schema they were specifically not granted.
  const queryFailed = (res, req, e, label) => {
    console.error(`[partner-api] ${label} failed:`, e.message);
    if (e.code === '42501') {
      return notPermitted(res, req);
    }
    // 57014 = statement_timeout. Actionable for the caller, unlike a bare 500:
    // the request was too broad, and narrowing it will work.
    if (e.code === '57014') {
      return problem(res, req, 503, 'query-too-slow',
        'The query took too long and was stopped. Narrow the time window, or use an exact plate match.');
    }
    problem(res, req, 500, 'query-failed', 'The request could not be completed.');
  };

  // ---------------------------------------------------------------
  // Paging
  // ---------------------------------------------------------------
  // รูปแบบ cursor เป็นสัญญาแล้ว (CP3) → อยู่ที่ helpers/partnerCursor.js พร้อมเทสต์
  const { encodeCursor, decodeCursor } = require('../helpers/partnerCursor');

  const PAGE_MAX = 1000, PAGE_DEFAULT = 100;

  /**
   * Validates the parameters every listing endpoint shares. Returns a string
   * on failure so the caller can answer with it — a thrown error here would
   * become a 500 for what is squarely the caller's mistake.
   */
  function parseListParams(req, { requireSince = true, from = 'query' } = {}) {
    // POST endpoints read the body instead: a Thai plate cannot be signed in a
    // query string (decision #227), and the body is signed over raw bytes.
    const q = (from === 'body' ? req.body : req.query) || {};
    const out = {};

    for (const [name, val] of [['since', q.since], ['until', q.until]]) {
      if (val === undefined) continue;
      const d = new Date(val);
      if (isNaN(d)) return { error: `${name} is not a valid ISO 8601 timestamp` };
      out[name] = d.toISOString();
    }
    if (requireSince && !out.since) return { error: 'since is required' };
    if (out.since && out.until && out.until <= out.since) {
      return { error: 'until must be later than since' };
    }

    // A partner's window is a contract term, so it is enforced rather than
    // documented. Without this, "since=1970" quietly becomes a full table scan
    // of everything we have ever recorded.
    const lookback = req.partner.max_lookback_days;
    if (lookback && out.since) {
      const floor = new Date(Date.now() - lookback * 86400000).toISOString();
      if (out.since < floor) {
        return { error: `since is older than this consumer's ${lookback}-day window (earliest: ${floor})` };
      }
    }

    if (q.pageSize !== undefined) {
      // A JSON body may send a number where a query string always sends text,
      // so both have to parse the same way here.
      const n = Number(q.pageSize);
      if (!Number.isInteger(n) || n < 1 || n > PAGE_MAX) {
        return { error: `pageSize must be an integer between 1 and ${PAGE_MAX}` };
      }
      out.pageSize = n;
    } else out.pageSize = PAGE_DEFAULT;

    if (q.cursor !== undefined) {
      const c = decodeCursor(q.cursor);
      if (!c) return { error: 'cursor is not one this API issued' };
      out.cursor = c;
    }

    if (q.cameraId !== undefined) {
      if (typeof q.cameraId !== 'string') return { error: 'cameraId must be a string' };
      out.cameraId = q.cameraId;
    }
    return out;
  }

  /**
   * Camera ids this consumer is allowed to see, or null for "all of them".
   *
   * Resolved through the ADMIN pool, not the partner role: sites is our own
   * configuration and is deliberately in none of the eleven public views.
   *
   * Row scoping lives here, in application code, and that is a real difference
   * from column access — a bug in this function leaks another site's rows,
   * whereas a bug in a query cannot produce a column Postgres never granted.
   * Making rows equally enforced means row-level security policies keyed to the
   * partner role; noted in migration 120 as the upgrade path rather than
   * pretended at.
   */
  const scopeCache = createTtlCache({ name: 'partner:scope', ttlMs: 60_000 });   // slug -> ids
  async function allowedCameraIds(partner) {
    // NULL means unscoped. An EMPTY array does not — it means a scope was set
    // and matches nothing, so it must resolve to "no cameras" rather than
    // falling through to "all cameras". partner-admin writes NULL for the
    // unscoped case so this is unreachable today, but an empty scope reading as
    // unrestricted is the wrong way for that mistake to fail.
    if (partner.site_codes === null || partner.site_codes === undefined) return null;
    if (!partner.site_codes.length) return [];
    return scopeCache.wrap(partner.slug, async () => {
      const { rows } = await pool.query(
        `SELECT c.id FROM cameras c JOIN sites s ON s.id = c.site_id WHERE s.code = ANY($1)`,
        [partner.site_codes]);
      return rows.map((r) => r.id);
    });
  }

  // ---------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------

  // Authenticated on purpose. An unauthenticated health check here would be a
  // free oracle telling anyone the endpoint exists and is up; the partner's
  // own monitoring needs to prove it can sign anyway, which is the thing worth
  // monitoring.
  app.get('/v1/healthz', async (req, res) => {
    try {
      // Round-trips through the partner's own role, so this also proves the
      // role exists and is assumable — the failure mode migration 118 was
      // written for.
      const { rows } = await req.partnerQuery('SELECT NOW() AS server_time');
      res.json({
        ok: true,
        consumer: req.partner.slug,
        label: req.partner.label,
        dbRole: req.partner.db_role,
        serverTime: rows[0].server_time,
      });
    } catch (e) {
      console.error('[partner-api] healthz failed:', e.message);
      problem(res, req, 503, 'db-role-unavailable', e.message);
    }
  });

  // ---------------------------------------------------------------
  // GET /v1/cameras — reference data
  // ---------------------------------------------------------------
  // Columns are listed rather than SELECT *. Postgres is the ceiling and
  // migration 120 already narrowed the view, but naming them means a column
  // added to the view later does not start flowing to partners because nobody
  // thought about the endpoint. Two independent decisions, both required.

  // รายการอ้างอิงต่อกล้อง (ไม่มีมิติเวลา) — /v1/cameras key = id · /v1/enforcement/cameras key = camera_id (S2)
  async function refList(req, res, endpoint) {
    const e = ep(endpoint);
    const key = e.keyColumn || 'id';
    // No time window here: this is a small reference table, not a feed.
    const p = parseListParams(req, { requireSince: false });
    if (p.error) return problem(res, req, 400, 'invalid-parameter', p.error);

    try {
      const COLS = await grantedCols(req, e);
      if (!COLS) return notPermitted(res, req);
      const allowed = await allowedCameraIds(req.partner);
      const where = [], args = [];
      if (allowed) { args.push(allowed); where.push(`${key} = ANY($${args.length})`); }
      if (p.cameraId) { args.push(p.cameraId); where.push(`${key} = $${args.length}`); }
      // Cameras page by id alone — there is no meaningful time ordering for a
      // reference list, and 143 rows will not exhaust one page anyway.
      if (p.cursor) { args.push(p.cursor.i); where.push(`${key} > $${args.length}`); }
      args.push(p.pageSize + 1);   // one extra: presence of it means "more"

      const { rows } = await req.partnerQuery(
        `SELECT ${COLS} FROM ${e.view}
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY ${key} LIMIT $${args.length}`, args);

      const more = rows.length > p.pageSize;
      const data = more ? rows.slice(0, p.pageSize) : rows;
      res.json({
        data,
        nextCursor: more ? encodeCursor(0, data[data.length - 1][key]) : null,
        pageSize: p.pageSize,
      });
    } catch (err) {
      queryFailed(res, req, err, e.path);
    }
  }
  app.get('/v1/cameras', (req, res) => refList(req, res, 'listCameras'));
  app.get('/v1/enforcement/cameras', (req, res) => refList(req, res, 'enforcementCameras'));

  // ---------------------------------------------------------------
  // Feed endpoints
  // ---------------------------------------------------------------
  // FC2 — ขอเก่ากว่าที่เรามีจริง ต้องได้ 400 ไม่ใช่ 200 ที่ว่างเปล่า
  // ---------------------------------------------------------------
  // ก่อนหน้านี้ partner ที่ไม่ได้ตั้ง max_lookback_days (ค่าเริ่มต้นคือไม่ตั้ง)
  // ขอ since=2026-01-01 บน /v1/face/events จะได้ 200 พร้อม data ว่าง ตั้งแต่วันที่
  // 41 ย้อนขึ้นไป โดยไม่มีอะไรบอกว่าทำไม — เป็นความเงียบชนิดเดียวกับที่ HCP ตอบ
  // 200 ให้ทั้ง code 64/68/8 แล้วทำให้แยกไม่ออกว่าผิดตรงไหน (เสียเวลาไปทั้งวัน
  // 2026-08-08)
  //
  // เพดานจริงมาจากข้อมูลที่มีอยู่ ไม่ใช่ค่า retention ที่ตั้งไว้ — สองอย่างนี้ไม่เท่ากัน
  // (LPR ตั้ง 365 แต่มีจริง 35 วัน เพราะระบบยังใหม่) และตัวที่ partner เจอคือของจริง
  //
  // แคช 5 นาที (getSystemSetting ใช้ 60 วินาที — ตรงนี้ยาวกว่าได้เพราะวันเก่าสุด
  // ขยับวันละครั้งตอน pruner วิ่ง ไม่ใช่ค่าที่คนแก้แล้วอยากเห็นผลทันที) · min()
  // วัดได้ 0.4 ms ก็จริง แต่ยิงทุก request ที่ rate 60/นาที ต่อ partner ก็ไม่มีเหตุผล
  // ให้ทำ · ใช้ pool ของ admin ไม่ใช่ role ของ partner เพราะต้องการวันเก่าสุดของ
  // ทั้งระบบ ไม่ใช่ของ scope เขา
  const _histCache = createTtlCache({ name: 'partner:oldest-available', ttlMs: 5 * 60 * 1000 });
  async function oldestAvailable(view, timeCol) {
    // try/catch อยู่ **ใน** loader เพื่อให้ null ถูกแคชด้วย — ปล่อยให้ throw
    // = ยิงวิวใหม่ทุก request ตอน role ของ partner อ่านไม่ได้
    return _histCache.wrap(view, async () => {
      try {
        const { rows } = await pool.query(`SELECT min(${timeCol}) AS m FROM ${view}`);
        return rows[0] && rows[0].m ? new Date(rows[0].m) : null;
      } catch (e) {
        // อ่านไม่ได้ = ไม่บล็อก ปล่อยผ่านดีกว่าปฏิเสธคำขอที่ถูกต้อง
        console.warn(`[partner-api] oldestAvailable(${view}) failed:`, e.message);
        return null;
      }
    });
  }

  // คืนข้อความ error ถ้า since เก่ากว่าที่มีจริง · คืน null ถ้าผ่าน
  async function tooOld(since, view, timeCol) {
    if (!since) return null;
    const oldest = await oldestAvailable(view, timeCol);
    if (!oldest) return null;
    // เผื่อ 1 วัน — ขอบเขตขยับตลอดเวลาเพราะ pruner ทำงานอยู่ การปฏิเสธคำขอที่
    // ห่างจากขอบไม่กี่ชั่วโมงจะกลายเป็นความรำคาญมากกว่าความช่วยเหลือ
    const floor = new Date(oldest.getTime() - 86400000);
    if (new Date(since) >= floor) return null;
    return `since is older than the data we hold. The earliest ${view.replace(/^v_|_public$/g, '')} `
      + `row available right now is ${oldest.toISOString()}. `
      + `Asking for anything before that returns nothing — this is a 400 rather than an empty page `
      + `so you can tell "no data in range" from "range is outside what we keep".`;
  }

  // ---------------------------------------------------------------
  // The two listings differ only in table, columns and time column, so the
  // walk itself is written once. Getting keyset paging subtly wrong in two
  // places independently is the failure this avoids — and it is the kind of
  // wrong that shows up as a partner quietly missing rows, not as an error.
  async function feed(req, res, { view, endpoint, timeCol, label }) {
    // key ของแถว: id สำหรับข้อมูลรายแถว · camera_id สำหรับแถวสรุป (S1) · เวลาเป็น date สำหรับสถิติรายวัน (วันตามเวลาไทย)
    const e = ep(endpoint);
    const key = e.keyColumn || 'id';
    const keyCast = key === 'id' ? 'bigint' : 'text';
    const isDay = e.timeType === 'date';
    const tParam = (n) => isDay ? `($${n}::timestamptz AT TIME ZONE 'Asia/Bangkok')::date` : `$${n}`;
    const p = parseListParams(req);
    if (p.error) return problem(res, req, 400, 'invalid-parameter', p.error);
    const old = await tooOld(p.since, view, timeCol);
    if (old) return problem(res, req, 400, 'since-too-old', old);

    try {
      const cols = await grantedCols(req, e);
      if (!cols) return notPermitted(res, req);
      const allowed = await allowedCameraIds(req.partner);
      const where = [], args = [];

      args.push(p.since); where.push(`${timeCol} >= ${tParam(args.length)}`);
      if (p.until) { args.push(p.until); where.push(`${timeCol} < ${tParam(args.length)}`); }
      if (allowed) { args.push(allowed); where.push(`camera_id = ANY($${args.length})`); }
      if (p.cameraId) { args.push(p.cameraId); where.push(`camera_id = $${args.length}`); }

      // The row comparison is what makes this exact. Splitting it into
      // "time > x OR (time = x AND id > y)" is the same thing written in a way
      // that is easy to get wrong, and it stops the planner using the index as
      // cleanly. Timestamps here are millisecond precision with at most three
      // rows sharing one (measured over an hour of live traffic), so the id
      // only ever breaks a tiny tie.
      if (p.cursor) {
        args.push(p.cursor.t); args.push(p.cursor.i);
        // Cast both sides explicitly. Left to inference, a text parameter next
        // to a bigint column is a comparison waiting to be resolved the wrong
        // way, and the symptom would again be silently wrong paging.
        where.push(`(${timeCol}, ${key}) > ($${args.length - 1}::${isDay ? 'date' : 'timestamptz'}, $${args.length}::${keyCast})`);
        // ขอบล่างแบบธรรมดาคู่กัน — ให้ planner ใช้ index ของเวลาเริ่มจาก cursor แทนการไล่จาก since (วัด 49 → 23 ms บนแถวสรุป)
        where.push(`${timeCol} >= $${args.length - 1}::${isDay ? 'date' : 'timestamptz'}`);
      }
      args.push(p.pageSize + 1);

      // _cur_t carries the timestamp at full precision, as Postgres prints it.
      // It is the cursor input and is removed before the row goes out — a
      // partner should not see two spellings of the same field.
      const { rows } = await req.partnerQuery(
        `SELECT ${cols}, ${timeCol}::text AS _cur_t FROM ${view}
          WHERE ${where.join(' AND ')}
          ORDER BY ${timeCol}, ${key} LIMIT $${args.length}`, args);

      const more = rows.length > p.pageSize;
      const data = more ? rows.slice(0, p.pageSize) : rows;
      const last = data[data.length - 1];
      const nextCursor = more ? encodeCursor(last._cur_t, last[key]) : null;
      // date ของ Postgres ผ่าน node-pg กลายเป็น Date เที่ยงคืนเวลาเครื่อง → JSON ออกมาเป็น "2026-10-18T17:00:00Z"
      // ซึ่งอ่านแล้วได้วันผิด (เจอตอน AUDIT S1) · ใช้ข้อความที่ Postgres พิมพ์เอง 'YYYY-MM-DD' แทน
      for (const r of data) { if (isDay) r[timeCol] = r._cur_t; delete r._cur_t; }

      res.json({
        data,
        // Null when the caller has caught up. They should re-poll with the
        // same cursor they last received rather than re-deriving one from
        // `since`, which would replay the tail on every poll.
        nextCursor,
        pageSize: p.pageSize,
      });
    } catch (e) {
      queryFailed(res, req, e, label);
    }
  }

  // Named columns again, for the reason given above refList: the view is
  // the ceiling, this is the deliberate choice of what to send.

  app.get('/v1/lpr/events', (req, res) => feed(req, res, {
    view: 'v_license_plates_public', endpoint: 'listLprEvents',
    timeCol: 'detected_at', label: '/v1/lpr/events',
  }));

  // "face" in the route name, appearances in the table: a row here is whatever
  // the camera described about a detected object, which is a person most of
  // the time (288,997 of 290,867 over two days) and occasionally a vehicle.
  // object_class says which, and the columns that do not apply are null rather
  // than absent.

  app.get('/v1/face/events', (req, res) => feed(req, res, {
    view: 'v_appearances_public', endpoint: 'listFaceEvents',
    timeCol: 'detected_at', label: '/v1/face/events',
  }));

  // สถิติ (S1 · migration 270) — แถวสรุปต่อกล้องต่อชั่วโมง/วัน · เดินหน้าด้วย feed() ตัวเดียวกัน key = camera_id
  // Traffic Enforcement (S2 · migration 271) ใช้ทางเดียวกัน · เขียนทีละบรรทัด (ไม่วนลูป) ให้ check-api-reference เห็นทุก route
  const statFeed = (endpoint) => (req, res) => {
    const e = ep(endpoint);
    return feed(req, res, { view: e.view, endpoint, timeCol: e.timeColumn, label: e.path });
  };
  app.get('/v1/stats/vehicles/hourly', statFeed('statsVehiclesHourly'));
  app.get('/v1/stats/lpr/hourly', statFeed('statsLprHourly'));
  app.get('/v1/stats/lpr/daily', statFeed('statsLprDaily'));
  app.get('/v1/stats/person/daily', statFeed('statsPersonDaily'));
  app.get('/v1/enforcement/hourly', statFeed('enforcementHourly'));
  app.get('/v1/enforcement/daily', statFeed('enforcementDaily'));

  // ---------------------------------------------------------------
  // POST /v1/lpr/search — look up a plate
  // ---------------------------------------------------------------
  // POST for a read, which is unusual and is not a stylistic choice. 90.2% of
  // the plates we hold contain Thai characters (4,502,050 of 4,993,900 over
  // seven days), and non-ASCII cannot be signed in a query string: it travels
  // percent-encoded and arrives decoded, and two encoders that are both
  // correct produce different strings to sign. A JSON body is signed via
  // Content-MD5 over the raw bytes, so the encoding question never arises.
  // HikCentral's own API reads by POST for the same reason. Decision #227.
  app.post('/v1/lpr/search', async (req, res) => {
    const b = req.body || {};
    const plate = typeof b.plate === 'string' ? b.plate.trim() : '';
    if (!plate) return problem(res, req, 400, 'invalid-parameter', 'plate is required');
    if (plate.length > 32) return problem(res, req, 400, 'invalid-parameter', 'plate is too long to be a plate');

    // since is optional here — finding a plate across the whole retained window
    // is the point of the endpoint, unlike the feeds where it bounds a walk.
    const p = parseListParams(req, { requireSince: false, from: 'body' });
    if (p.error) return problem(res, req, 400, 'invalid-parameter', p.error);
    const old = await tooOld(p.since, 'v_license_plates_public', 'detected_at');
    if (old) return problem(res, req, 400, 'since-too-old', old);

    try {
      const LPR_COLS = await grantedCols(req, ep('searchLpr'));
      if (!LPR_COLS) return notPermitted(res, req);
      const allowed = await allowedCameraIds(req.partner);
      const where = [], args = [];

      // Exact unless asked otherwise, which is the reverse of the dashboard's
      // default and deliberate. "Have you seen this plate" is the question a
      // partner has, and it costs 28 buffers. Partial match is a browsing
      // feature that costs four to five orders of magnitude more.
      const partial = b.exact === false;

      if (!partial) {
        // Same normalisation the dashboard applies (lpr-query.js:101): a plate
        // read off a camera never contains spaces, and a human typing one
        // usually does.
        args.push(plate.replace(/\s+/g, ''));
        where.push(`plate_number = $${args.length}`);
      } else {
        // Two characters is the worst case measured — too short for the
        // trigram index to discriminate, so it matches enormously and then has
        // to sort: 488,802 buffers. Three or more is not cheap either, hence
        // the required window below and the statement_timeout above.
        if (plate.length < 3) {
          return problem(res, req, 400, 'invalid-parameter',
            'A partial search needs at least 3 characters. Use exact search for a full plate.');
        }
        args.push(`%${plate}%`);
        where.push(`plate_number ILIKE $${args.length}`);
      }

      if (partial && !p.since && !req.partner.max_lookback_days) {
        return problem(res, req, 400, 'invalid-parameter',
          'A partial search requires "since". An exact search does not.');
      }

      if (p.since) { args.push(p.since); where.push(`detected_at >= $${args.length}::timestamptz`); }
      else if (req.partner.max_lookback_days) {
        // No since given, but this consumer has a window — apply it rather
        // than quietly searching further back than their contract allows.
        args.push(new Date(Date.now() - req.partner.max_lookback_days * 86400000).toISOString());
        where.push(`detected_at >= $${args.length}::timestamptz`);
      }
      if (p.until) { args.push(p.until); where.push(`detected_at < $${args.length}::timestamptz`); }
      if (allowed) { args.push(allowed); where.push(`camera_id = ANY($${args.length})`); }
      if (p.cameraId) { args.push(p.cameraId); where.push(`camera_id = $${args.length}`); }
      if (p.cursor) {
        args.push(p.cursor.t); args.push(p.cursor.i);
        where.push(`(detected_at, id) > ($${args.length - 1}::timestamptz, $${args.length}::bigint)`);
      }
      args.push(p.pageSize + 1);

      const { rows } = await req.partnerQuery(
        `SELECT ${LPR_COLS}, detected_at::text AS _cur_t FROM v_license_plates_public
          WHERE ${where.join(' AND ')}
          ORDER BY detected_at, id LIMIT $${args.length}`, args);

      const more = rows.length > p.pageSize;
      const data = more ? rows.slice(0, p.pageSize) : rows;
      const nextCursor = more ? encodeCursor(data[data.length - 1]._cur_t, data[data.length - 1].id) : null;
      for (const r of data) delete r._cur_t;

      res.json({ data, nextCursor, pageSize: p.pageSize, query: { plate, exact: !partial } });
    } catch (e) {
      queryFailed(res, req, e, '/v1/lpr/search');
    }
  });

  // ---------------------------------------------------------------
  // GET /v1/openapi.json — the contract, generated per consumer
  // ---------------------------------------------------------------
  // Reads catalogues, not partner data, so it uses the admin pool rather than
  // req.partnerQuery: a partner's role cannot introspect its own grants, and
  // asking it to would return an empty document instead of an honest one.
  app.get('/v1/openapi.json', async (req, res) => {
    const client = await pool.connect();
    try {
      // Behind Cloudflare the request's own host is the public one; falling
      // back to the configured origin keeps the document usable when called
      // over localhost during setup.
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const baseUrl = process.env.PUBLIC_ORIGIN || `${proto}://${req.headers.host}`;
      res.type('application/json').send(
        JSON.stringify(await buildSpec(client, req.partner, baseUrl), null, 2));
    } catch (e) {
      console.error('[partner-api] /v1/openapi.json failed:', e.message);
      problem(res, req, 500, 'spec-generation-failed', 'The specification could not be generated.');
    } finally {
      client.release();
    }
  });

  // Anything under /v1 that is not a route above. Placed last so it cannot
  // shadow a real route, and it still runs behind authenticate — an unsigned
  // request gets 401, not a map of what exists.
  app.use('/v1', (req, res) =>
    problem(res, req, 404, 'not-found', `No such endpoint: ${req.method} ${fullPath(req)}`));

  console.log('[partner-api] /v1 mounted (AK/SK auth, per-request SET LOCAL ROLE)');
};
