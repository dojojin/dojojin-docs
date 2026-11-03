// ============================================================
// Vigil Platform — Query audit: compare-routes (route เดิม git HEAD เทียบใหม่ ใน REPEATABLE READ เดียวกัน)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// เทียบ route เดิม (git HEAD) กับใหม่: ให้ handler ทั้งคู่สร้าง SQL จาก req เดียวกัน แล้วรันทุกคู่ใน REPEATABLE READ เดียวกัน
// ใช้: node compare-routes.js cases.json   · case: {id, route:'events'|'faces', path, query}
const P = require('path').join(__dirname, '..', '..', 'src') + '/';
const fs = require('fs'); const { execSync } = require('child_process');
const env = require(P + 'config'); const { Pool } = require(P + 'node_modules/pg');
const real = new Pool({ ...env.db(), max: 2, options: '-c pg_stat_statements.track=none -c application_name=zz_qaudit_compare' });
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OLD = { events: P + 'routes/.qaudit_old_events.js', faces: P + 'routes/.qaudit_old_faces.js' };
for (const k of Object.keys(OLD)) fs.writeFileSync(OLD[k], execSync(`git -C ${P}.. show HEAD:src/routes/${k}.js`));
const cleanup = () => { for (const f of Object.values(OLD)) try { fs.unlinkSync(f); } catch {} };
process.on('exit', cleanup);
function captureHandler(file, route) {
  const seen = [];
  const fake = { rows: [{ n: 0, '?column?': 1 }] };
  const client = { query: async (sql, params) => { if (!/^(BEGIN|COMMIT|ROLLBACK|SET )/.test(sql)) seen.push({ sql, params }); return fake; }, release() {} };
  const pool = { query: async (sql, params) => { if (/event_kpi_hourly|system_settings|face_sim|similarity/i.test(sql)) return real.query(sql, params); seen.push({ sql, params }); return { rows: [] }; }, connect: async () => client };
  delete require.cache[require.resolve(file)];
  let handler; const app = { get: (p, ...h) => { if (p === route) handler = h[h.length - 1]; }, post() {}, put() {}, patch() {}, delete() {}, use() {} };
  return { seen, pool, app, handler: () => handler, setHandler: (h) => { handler = h; } };
}
async function sqlsFor(file, kind, c) {
  const cap = captureHandler(file, c.path);
  const deps = kind === 'events'
    ? { getDisplayTz: async () => 'Asia/Bangkok', getAnalyticsEnabledSet: () => new Set(), METRIC_EVENT_TYPE_PATTERN: '%Aggregation%', ANALYTICS_EVENT_KEYS: [], ANALYTICS_KEY_SQL: 'NULL' }
    : {};
  require(file)(cap.app, cap.pool, deps);
  const res = { set() { return res; }, status() { return res; }, json() { return res; }, setHeader() {} };
  await cap.handler()({ method: 'GET', user: { role: 'admin', allowedSites: null }, query: c.query, path: c.path }, res);
  return cap.seen;
}
(async () => {
  let bad = 0;
  for (const c of cases) {
    const a = await sqlsFor(OLD[c.route], c.route, c), b = await sqlsFor(P + `routes/${c.route}.js`, c.route, c);
    if (a.length !== b.length) { console.log(c.id, 'DIFFERENT number of statements', a.length, b.length); bad++; continue; }
    const cl = await real.connect();
    try {
      await cl.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); await cl.query(`SET LOCAL statement_timeout = '${process.env.CMP_TIMEOUT || '120s'}'`);
      const out = [];
      for (let i = 0; i < a.length; i++) {
        await cl.query('SAVEPOINT s');
        let ra, ta; const t0 = Date.now();
        let oldNote = '';
        try { ra = (await cl.query(a[i].sql, a[i].params)).rows; }
        catch (e) {   // SQL เดิมตัวเดิม แต่ห้ามเดิน index scan ตามเวลา — ความหมายเหมือนเดิมทุกตัวอักษร แค่วิธีหาต่าง
          await cl.query('ROLLBACK TO SAVEPOINT s'); await cl.query('SET LOCAL enable_indexscan = off');
          try { ra = (await cl.query(a[i].sql, a[i].params)).rows; oldNote = '(old ran with enable_indexscan=off)'; }
          catch (e2) { await cl.query('ROLLBACK TO SAVEPOINT s'); out.push(`OLD FAILED twice ${e2.message.slice(0, 40)}`); bad++; await cl.query('RESET enable_indexscan'); continue; }
          await cl.query('RESET enable_indexscan');
        }
        ta = Date.now() - t0;
        await cl.query('SAVEPOINT n');
        const t1 = Date.now(); let rb;
        try { rb = (await cl.query(b[i].sql, b[i].params)).rows; }
        catch (e) { await cl.query('ROLLBACK TO SAVEPOINT n'); out.push(`NEW TOO SLOW (${Date.now() - t1}ms) · old ${ta}ms ${oldNote} — ทั้งคู่ช้า`); bad++; continue; }
        const tb = Date.now() - t1;
        let idx = '';
        if (b[i].sql !== a[i].sql) { const pl = JSON.stringify((await cl.query('EXPLAIN (FORMAT JSON) ' + b[i].sql, b[i].params)).rows[0]['QUERY PLAN']);
          idx = [...new Set([...pl.matchAll(/"Index Name":\s*"([^"]+)"/g)].map((m) => m[1].replace(/_y20\d\dm\d\d$/, '_*')))].join(','); }
        const ka = JSON.stringify(ra), kb = JSON.stringify(rb);
        let same = ka === kb, note = '';
        if (!same) {   // ลำดับต่างได้เฉพาะแถวที่เวลาเท่ากัน — เทียบแบบไม่สนลำดับ
          const sa = ra.map((r) => JSON.stringify(r)).sort().join('\n'), sb = rb.map((r) => JSON.stringify(r)).sort().join('\n');
          if (sa === sb) { same = true; note = '(ลำดับต่างเฉพาะแถวเวลาเท่ากัน)'; }
          else if (ra.length === rb.length && ra.length && ra[0].event_time !== undefined) {   // ต่างเฉพาะแถวที่เวลาเท่ากับขอบหน้า?
            const t = (r) => +new Date(r.event_time); const edge = new Set([t(ra[0]), t(ra[ra.length - 1])]);
            const ia = new Set(ra.map((r) => r.id)), ib = new Set(rb.map((r) => r.id));
            const diff = [...ra.filter((r) => !ib.has(r.id)), ...rb.filter((r) => !ia.has(r.id))];
            if (diff.every((r) => edge.has(t(r)))) { same = true; note = `(ต่าง ${diff.length / 2} แถวที่เวลาเท่ากับขอบหน้า)`; }
          }
        }
        out.push(`${same ? 'SAME' : 'DIFF'} rows=${ra.length}/${rb.length} old ${ta}ms new ${tb}ms ${oldNote} ${note} ${b[i].sql === a[i].sql ? '[sql unchanged]' : '[' + idx + ']'}`);
        if (!same) bad++;
      }
      console.log(c.id.padEnd(34), out.join(' | '));
    } finally { await cl.query('ROLLBACK').catch(() => {}); cl.release(); }
  }
  console.log(bad ? `❌ ${bad} mismatches` : '✅ all identical');
  cleanup(); await real.end(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e.stack); cleanup(); process.exit(2); });
