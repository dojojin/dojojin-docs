// Minimal client for the Vigil partner API (/v1). Node 18+, no dependencies.
//
//   export VIGIL_BASE=https://dashboard.example.com VIGIL_KEY=<app key> VIGIL_SECRET=<app secret>
//   node vigil-client.mjs
//
// The secret is read from the environment. Never hard-code it and never log it.
// Signing is described in README.md and at the top of vigil_client.py; this file is the same algorithm.
import { createHash, createHmac, randomUUID } from 'node:crypto';

export class VigilClient {
  constructor(base, key, secret) { Object.assign(this, { base: base.replace(/\/$/, ''), key, secret }); }

  sign(method, path, query, body) {
    const contentMd5 = body ? createHash('md5').update(body).digest('base64') : '';
    const nonce = randomUUID(), ts = String(Date.now());
    const keys = Object.keys(query).sort();
    const signedPath = path + (keys.length ? '?' + keys.map((k) => `${k}=${query[k]}`).join('&') : '');
    const lines = [method, 'application/json', ...(contentMd5 ? [contentMd5] : []), 'application/json'];
    const toSign = `${lines.join('\n')}\nx-ca-key:${this.key}\nx-ca-nonce:${nonce}\nx-ca-timestamp:${ts}\n${signedPath}`;
    const headers = {
      Accept: 'application/json', 'Content-Type': 'application/json',
      'X-Ca-Key': this.key, 'X-Ca-Nonce': nonce, 'X-Ca-Timestamp': ts,
      'X-Ca-Signature': createHmac('sha256', this.secret).update(toSign, 'utf8').digest('base64'),
      'X-Ca-Signature-Headers': 'x-ca-key,x-ca-nonce,x-ca-timestamp',
    };
    if (contentMd5) headers['Content-MD5'] = contentMd5;
    return headers;
  }

  async request(method, path, { query = {}, body } = {}) {
    const q = Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)]));
    for (const [k, v] of Object.entries(q)) if (!/^[\x20-\x7E]*$/.test(v)) throw new Error(`query ${k} is not ASCII; use a POST body`);
    const raw = body === undefined ? '' : JSON.stringify(body);
    const url = this.base + path + (Object.keys(q).length ? '?' + new URLSearchParams(Object.entries(q).sort()) : '');
    const r = await fetch(url, { method, headers: this.sign(method, path, q, raw), body: raw || undefined });
    return { status: r.status, json: await r.json().catch(() => null) };   // errors are RFC 7807 JSON
  }

  // Every row of a paged endpoint. Keep the last nextCursor you saw to resume later.
  async *walk(path, query) {
    let cursor = null;
    do {
      const r = await this.request('GET', path, { query: { ...query, ...(cursor ? { cursor } : {}) } });
      if (r.status !== 200) throw new Error(`${path} -> ${r.status} ${r.json?.title}`);
      yield* r.json.data;
      cursor = r.json.nextCursor;
    } while (cursor);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = new VigilClient(process.env.VIGIL_BASE, process.env.VIGIL_KEY, process.env.VIGIL_SECRET);
  const h = await c.request('GET', '/v1/healthz');
  console.log('healthz:', h.status);
  if (h.status !== 200) { console.log('stop here:', h.json); process.exit(1); }
  // Your own contract: exactly the endpoints and fields granted to you, nothing else.
  const { json: spec } = await c.request('GET', '/v1/openapi.json');
  const feeds = Object.entries(spec.paths)
    .filter(([, ops]) => ops.get?.parameters?.some((x) => x.name === 'since')).map(([p]) => p);
  console.log('your endpoints:', Object.keys(spec.paths).sort().join(' '));
  const since = new Date(Date.now() - 3600e3); since.setUTCMinutes(0, 0, 0);
  for (const path of feeds) {
    let n = 0;
    for await (const _ of c.walk(path, { since: since.toISOString(), pageSize: 500 })) n++;
    console.log(`${path}: ${n} rows in the last hour`);
  }
}
