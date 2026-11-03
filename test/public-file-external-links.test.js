// Vigil Platform — ลิงก์สั้นไปไฟล์ภายนอก Google Drive / OneDrive (migration 287)
// route จริง + pool ปลอม · ไม่แตะ DB จริง ไม่ยิงออกเน็ต (redirect ตรวจแค่ header ไม่ตามไป)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('../src/node_modules/express');
const ROOT = path.join(__dirname, '..');

process.env.FILES_PUBLIC_URL = 'https://upl.example.test';

async function listen(app) {
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const req = (method, p, { body, raw, headers = {} } = {}) => new Promise((res, rej) => {
    const data = raw ?? (body === undefined ? null : JSON.stringify(body));
    const rq = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method, agent: false,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } },
    (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b })); });
    rq.on('error', rej); rq.end(data);
  });
  return { req, close: () => { srv.close(); srv.closeAllConnections(); } };
}

// ── admin API (routes/files.js) ──────────────────────────────────────────
async function bootFiles(rowsFor = () => []) {
  const sql = [];
  const pool = { query: async (q, params = []) => {
    const s = String(q).replace(/\s+/g, ' ').trim();
    sql.push({ s, params });
    if (/^SELECT value FROM system_settings/i.test(s)) return { rows: [], rowCount: 0 };
    if (/^INSERT INTO public_files/.test(s)) return { rows: [{ id: 7, target_url: params[0], original_name: params[1], mime: null, bytes: null, uploaded_at: new Date(), expires_at: params[3] }], rowCount: 1 };
    if (/^INSERT INTO public_file_links/.test(s)) return { rows: [{ id: 3, code: params[0], label: null }], rowCount: 1 };
    const rows = rowsFor(s, params);
    return { rows, rowCount: rows.length };
  } };
  const auth = { requireAdmin: (req, res, next) => (req.headers['x-role'] === 'admin'
    ? ((req.user = { id: 9, username: 'tester', role: 'admin' }), next())
    : res.status(403).json({ error: 'Admin role required' })) };
  const app = express();
  app.use(express.json());
  require('../src/routes/files')(app, pool, auth);
  return { sql, ...(await listen(app)) };
}
const admin = { 'x-role': 'admin' };

test('POST /api/files/link: valid Drive URL → link row + short link, same shape as upload', async (t) => {
  const h = await bootFiles(); t.after(h.close);
  const r = await h.req('POST', '/api/files/link', { headers: admin,
    body: { url: 'https://drive.google.com/file/d/1AbC/view?usp=sharing', note: 'สัญญา', expiry_days: 7 } });
  assert.equal(r.status, 200, r.body);
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true);
  assert.match(j.short_url, /^https:\/\/upl\.example\.test\/pub\/fil\/[a-z0-9]{8}$/);
  assert.equal(j.file.kind, 'link');
  assert.equal(j.file.original_name, 'drive.google.com/1AbC');
  const ins = h.sql.find((x) => /^INSERT INTO public_files/.test(x.s));
  assert.equal(ins.params[0], 'https://drive.google.com/file/d/1AbC/view?usp=sharing');
  assert.ok(Math.abs(new Date(ins.params[3]) - Date.now() - 7 * 86400000) < 60000);
  assert.ok(h.sql.some((x) => /INSERT INTO audit_log/.test(x.s) && x.params[2] === 'public_file_link_target_created'));
});

test('POST /api/files/link: blocked host / http / non-admin → nothing inserted', async (t) => {
  const h = await bootFiles(); t.after(h.close);
  for (const url of ['https://drive.google.com.evil.com/x', 'http://drive.google.com/x', 'https://contoso.sharepoint.com/sites/x']) {
    const r = await h.req('POST', '/api/files/link', { headers: admin, body: { url } });
    assert.equal(r.status, 400, url);
    assert.ok(JSON.parse(r.body).error);
  }
  assert.equal((await h.req('POST', '/api/files/link', { body: { url: 'https://drive.google.com/x' } })).status, 403);
  assert.equal(h.sql.filter((x) => /^INSERT/.test(x.s)).length, 0);
});

test('PATCH /api/files/:id/target: re-validated, only link rows, audited', async (t) => {
  const h = await bootFiles((s) => (/^UPDATE public_files f SET target_url/.test(s)
    ? [{ target_url: 'https://1drv.ms/b/s!New', before: 'https://drive.google.com/old' }] : []));
  t.after(h.close);
  assert.equal((await h.req('PATCH', '/api/files/7/target', { headers: admin, body: { url: 'https://evil.com/' } })).status, 400);
  const r = await h.req('PATCH', '/api/files/7/target', { headers: admin, body: { url: 'https://1drv.ms/b/s!New' } });
  assert.equal(r.status, 200, r.body);
  const upd = h.sql.find((x) => /^UPDATE public_files f SET target_url/.test(x.s));
  assert.match(upd.s, /target_url IS NOT NULL AND f\.revoked_at IS NULL/);   // แถวไฟล์ต้องไม่โดนแก้ (ไม่งั้นชน CHECK)
  assert.ok(h.sql.some((x) => /INSERT INTO audit_log/.test(x.s) && x.params[2] === 'public_file_target_changed'));
});

test('GET /api/files: kind + target_url · link rows get no signed url but keep short_url', async (t) => {
  const future = new Date(Date.now() + 86400000);
  const h = await bootFiles((s) => (/FROM public_files f ORDER BY uploaded_at/.test(s) ? [
    { id: 1, stored_name: '6f1c2a3b-1111-4222-8333-944455556666.pdf', original_name: 'a.pdf', mime: 'application/pdf', bytes: 10, expires_at: future, short_code: 'aaaaaaaa', target_url: null },
    { id: 2, stored_name: null, original_name: 'drive', mime: null, bytes: null, expires_at: future, short_code: 'bbbbbbbb', target_url: 'https://drive.google.com/x' },
  ] : []));
  t.after(h.close);
  const r = await h.req('GET', '/api/files', { headers: admin });
  assert.equal(r.status, 200, r.body);
  const [f, l] = JSON.parse(r.body).files;
  assert.equal(f.kind, 'file'); assert.equal(f.target_url, null);
  assert.equal(l.kind, 'link'); assert.equal(l.target_url, 'https://drive.google.com/x');
  assert.equal(l.url, null);
  assert.equal(l.short_url, 'https://upl.example.test/pub/fil/bbbbbbbb');
});

test('link rows: replace / preview upload → 400, DELETE does not touch disk', async (t) => {
  const h = await bootFiles((s) => {
    if (/^SELECT (stored_name|id, stored_name).*FROM public_files WHERE/.test(s)) return [{ id: 2, stored_name: null, mime: null, sha256: null, allow_scripts: false }];
    if (/^UPDATE public_files SET revoked_at/.test(s)) return [{ id: 2, stored_name: null, original_name: 'drive', og_image: null }];
    return [];
  });
  t.after(h.close);
  const b = '----x';
  const raw = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nxx\r\n--${b}--\r\n`;
  const headers = { ...admin, 'content-type': `multipart/form-data; boundary=${b}` };
  for (const p of ['/api/files/2/replace', '/api/files/2/preview']) {
    const r = await h.req('POST', p, { raw, headers });
    assert.equal(r.status, 400, `${p} ${r.body}`);
    assert.match(JSON.parse(r.body).error, /external links/);
  }
  const rv = await h.req('POST', '/api/files/2/versions/1/restore', { headers: admin });
  assert.equal(rv.status, 400, rv.body);
  assert.equal(h.sql.filter((x) => /^UPDATE public_files SET (version|og_image)/.test(x.s)).length, 0);
  const d = await h.req('DELETE', '/api/files/2', { headers: admin });
  assert.equal(d.status, 200, d.body);   // เดิม path.join(FILES_DIR, null) โยน TypeError → 500
});

// ── /pub/fil/<code> (routes/media-files.js) ─────────────────────────────
// app ใหม่ทุกเทสต์ — logClick กันซ้ำ IP+UA+ลิงก์ภายใน 10 วิ ด้วย Map ในตัว factory
async function bootPub(row) {
  const clicks = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vigil-pubfil-'));
  const pool = { query: async (q, params = []) => {
    const s = String(q).replace(/\s+/g, ' ').trim();
    if (/^INSERT INTO public_file_clicks/.test(s)) { clicks.push(params); return { rows: [], rowCount: 1 }; }
    if (/FROM public_file_links l JOIN public_files f/.test(s)) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  } };
  const app = express();
  require('../src/routes/media-files')(app, pool, {
    ROOT_DIR: tmp, SNAPSHOT_DIR: path.join(tmp, 'snap'), BLACKLIST_PHOTO_DIR: path.join(tmp, 'bl'),
    env: require('../src/config'), sharp: null, auth: {}, getSessionToken: () => null, isValidInternalToken: () => false,
    mediaScope: {}, signedImage: require('../src/helpers/signedImage'), viewAllows: () => true,
    edgeProxyBaseUrl: () => null, getSystemSetting: async () => null,
  });
  const h = await listen(app);
  return { clicks, ...h, close: () => { h.close(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}
const linkRow = (over = {}) => ({ id: 2, stored_name: null, original_name: 'สัญญา Q4', mime: null, revoked_at: null,
  expires_at: new Date(Date.now() + 86400000), allow_scripts: false, note: 'ฉบับลงนาม', og_title: null, og_description: null,
  og_image: null, target_url: 'https://drive.google.com/file/d/1AbC/view', link_id: 3, link_revoked_at: null, ...over });
const HUMAN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0';
const tick = () => new Promise((r) => setImmediate(r));

test('human → 302 to destination, no-store + no-referrer, click logged 200', async (t) => {
  const h = await bootPub(linkRow()); t.after(h.close);
  const r = await h.req('GET', '/pub/fil/abcd1234', { headers: { 'user-agent': HUMAN } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, 'https://drive.google.com/file/d/1AbC/view');
  assert.equal(r.headers['cache-control'], 'no-store, private');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  await tick();
  assert.equal(h.clicks.length, 1);
  assert.deepEqual(h.clicks[0].slice(0, 4), [2, 3, 'short', 200]);
});

test('bot (link preview) → og landing 200, never redirected', async (t) => {
  const h = await bootPub(linkRow()); t.after(h.close);
  const r = await h.req('GET', '/pub/fil/abcd1234', { headers: { 'user-agent': 'facebookexternalhit/1.1' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.location, undefined);
  assert.match(r.body, /og:title" content="สัญญา Q4"/);
  assert.doesNotMatch(r.body, /drive\.google\.com/);
});

test('revoked / expired / tampered destination → 410 logged, no redirect', async () => {
  for (const over of [{ revoked_at: new Date() }, { link_revoked_at: new Date() }, { expires_at: new Date(Date.now() - 1000) },
    { target_url: 'https://evil.com/phish' }]) {
    const h = await bootPub(linkRow(over));
    const r = await h.req('GET', '/pub/fil/abcd1234', { headers: { 'user-agent': HUMAN } });
    await tick();
    h.close();
    assert.equal(r.status, 410, JSON.stringify(over));
    assert.equal(r.headers.location, undefined);
    assert.equal(h.clicks.length, 1);
    assert.equal(h.clicks[0][3], 410);
  }
});

test('HEAD gets the redirect but is not counted', async (t) => {
  const h = await bootPub(linkRow()); t.after(h.close);
  const r = await h.req('HEAD', '/pub/fil/abcd1234', { headers: { 'user-agent': HUMAN } });
  assert.equal(r.status, 302);
  await tick();
  assert.equal(h.clicks.length, 0);
});

// ── migration + งานกวาด ──────────────────────────────────────────────────
test('migration 287: idempotent, CHECK exactly-one-of, no UPDATE/backfill', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'db/db_migration_287_public_file_external_links.sql'), 'utf8');
  const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  assert.match(code, /ADD COLUMN IF NOT EXISTS target_url TEXT/);
  for (const c of ['stored_name', 'mime', 'bytes', 'sha256']) assert.match(code, new RegExp(`ALTER COLUMN ${c}\\s+DROP NOT NULL`));
  assert.match(code, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'public_files_kind_chk'\)/);
  assert.match(code, /CHECK \(\(target_url IS NULL\) <> \(stored_name IS NULL\)\)/);
  assert.doesNotMatch(code, /\bUPDATE\b|\bDELETE\b|DROP CONSTRAINT|DROP TABLE/i);
  assert.equal(fs.readdirSync(path.join(ROOT, 'db')).filter((f) => /^db_migration_287_/.test(f)).length, 1);
});

test('retention skips link rows (no file; path.join(null) would abort the whole sweep)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/jobs/retention.js'), 'utf8');
  assert.match(src, /SELECT id, stored_name FROM public_files\s+WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at < now\(\)\s+AND stored_name IS NOT NULL/);
  const fj = fs.readFileSync(path.join(ROOT, 'src/routes/files.js'), 'utf8');
  assert.match(fj, /SET version = version \+ 1 WHERE id = \$1 AND revoked_at IS NULL AND stored_name IS NOT NULL/);
});
