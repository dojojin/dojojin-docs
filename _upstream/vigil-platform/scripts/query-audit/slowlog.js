// ============================================================
// Vigil Platform — Query audit: slowlog (คิวรีช้าจาก slow log → EXPLAIN แบบ READ ONLY)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ดึงคิวรีช้าจาก slow log ของ Postgres (≥2 วิ · มี SQL + พารามิเตอร์เต็ม) ช่วงที่ replay ยิง → จับคู่กับกรณี → EXPLAIN แบบ READ ONLY
// ใช้: node slowlog.js results.jsonl explain.jsonl [--no-explain]
const P = require('path').join(__dirname, '..', '..', 'src') + '/';
const env = require(P + 'config'); const { Pool } = require(P + 'node_modules/pg'); const fs = require('fs'); const { execFileSync } = require('child_process');
const crypto = require('crypto');
const [, , resFile, outFile, flag] = process.argv;
const results = fs.readFileSync(resFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const wins = [];
for (const r of results) for (const k of ['cold', 'warm']) if (r[k]) wins.push({ id: r.id, kind: k, a: Date.parse(r[k].at), b: Date.parse(r[k].end) + 1500 });
const since = new Date(Math.min(...wins.map((w) => w.a)) - 5000).toISOString();
const all = execFileSync('bash', ['-c', `docker logs vigil-postgres --since '${since}' 2>&1`], { encoding: 'latin1', maxBuffer: 512 * 1024 * 1024 });
const text = Buffer.from(all, 'latin1').toString('utf8');
const HEAD = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+) UTC \[(\d+)\] ([^ ]*) ([^ ]*) (LOG|DETAIL|ERROR|STATEMENT|WARNING|HINT|CONTEXT):\s+(.*)$/;
const recs = []; let cur = null;
for (const line of text.split('\n')) {
  const m = HEAD.exec(line);
  if (m) { cur = { ts: Date.parse(m[1].replace(' ', 'T') + 'Z'), pid: m[2], app: m[4], kind: m[5], body: m[6] }; recs.push(cur); }
  else if (cur && line.startsWith('\t')) cur.body += '\n' + line.slice(1);
}
function parseParams(s) {   // "$1 = 'a', $2 = NULL, ..."
  const out = []; const re = /\$(\d+) = (NULL|'((?:[^']|'')*)')/g; let m;
  while ((m = re.exec(s))) out[Number(m[1]) - 1] = m[2] === 'NULL' ? null : m[3].replace(/''/g, "'");
  return out;
}
const stmts = [];
for (let i = 0; i < recs.length; i++) {
  const r = recs[i]; if (r.kind !== 'LOG') continue;
  const m = /^duration: ([\d.]+) ms {2}(?:execute [^:]*|statement): ([\s\S]*)$/.exec(r.body); if (!m) continue;
  const next = recs[i + 1];
  const params = next && next.kind === 'DETAIL' && next.pid === r.pid && /^parameters: /.test(next.body) ? parseParams(next.body.slice(12)) : [];
  const w = wins.find((x) => r.ts >= x.a && r.ts <= x.b);
  stmts.push({ ts: new Date(r.ts).toISOString(), pid: r.pid, app: r.app, ms: Number(m[1]), sql: m[2].trim(), params, case: w ? w.id : null, kind: w ? w.kind : null });
}
const mine = stmts.filter((s) => s.case && s.app === 'api-server');
console.log('slow statements in window:', stmts.length, '· attributed to cases:', mine.length);
if (flag === '--no-explain') { fs.writeFileSync(outFile, mine.map((s) => JSON.stringify(s)).join('\n') + '\n'); process.exit(0); }

const pool = new Pool({ ...env.db(), max: 1, options: '-c pg_stat_statements.track=none -c application_name=zz_qaudit_explain' });
function walk(n, f, d = 0) { f(n, d); for (const c of n.Plans || []) walk(c, f, d + 1); }
function analyse(plan) {
  const issues = []; let worst = null;
  walk(plan.Plan, (n) => {
    const act = (n['Actual Rows'] || 0) * (n['Actual Loops'] || 1), est = n['Plan Rows'] || 0;
    const rel = n['Relation Name'] || '';
    if (n['Node Type'] === 'Seq Scan' && /^(events|license_plates|appearances|face_|lpr_)/.test(rel)) issues.push(`seq-scan ${rel}`);
    if ((n['Rows Removed by Filter'] || 0) * (n['Actual Loops'] || 1) > 100000) issues.push(`filter-removed ${Math.round((n['Rows Removed by Filter'] * (n['Actual Loops'] || 1)) / 1000)}k on ${n['Node Type']} ${n['Index Name'] || rel}`);
    if (Math.max(act, est) > 1000 && (act + 1) / (est + 1) > 100) issues.push(`underestimate ${est}→${act} ${n['Node Type']} ${n['Index Name'] || rel}`);
    if (Math.max(act, est) > 1000 && (est + 1) / (act + 1) > 100) issues.push(`overestimate ${est}→${act} ${n['Node Type']} ${n['Index Name'] || rel}`);
    if (n['Sort Space Type'] === 'Disk') issues.push(`sort-spill ${n['Sort Space Used']}kB`);
    if (!worst || (n['Actual Total Time'] || 0) > worst.t) worst = { t: n['Actual Total Time'] || 0, node: `${n['Node Type']} ${n['Index Name'] || rel}`.trim() };
  });
  return { exec_ms: Math.round(plan['Execution Time']), read_blocks: plan.Plan['Shared Read Blocks'], hit_blocks: plan.Plan['Shared Hit Blocks'], temp_written: plan.Plan['Temp Written Blocks'], worst_node: worst && worst.node, issues: [...new Set(issues)] };
}
(async () => {
  const out = fs.createWriteStream(outFile);
  const seen = new Set();
  for (const s of mine) {
    if (new Date().toTimeString().slice(0, 5) >= (process.env.STOP_AT || '05:00') && new Date().getHours() < 12) { console.log('STOP_AT reached'); break; }
    const key = crypto.createHash('md5').update(s.sql + JSON.stringify(s.params)).digest('hex');
    if (seen.has(key)) continue; seen.add(key);
    let sql = s.sql, note = null;
    if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) { out.write(JSON.stringify({ ...s, skipped: 'write (background job)' }) + '\n'); continue; }
    const ct = /^\s*CREATE\s+TEMP(?:ORARY)?\s+TABLE\s+\S+(?:\s+ON\s+COMMIT\s+DROP)?\s+AS\s+([\s\S]*)$/i.exec(sql);
    if (ct) { sql = ct[1]; note = 'explained the SELECT inside CREATE TEMP TABLE AS'; }
    const c = await pool.connect();
    try {
      await c.query('BEGIN READ ONLY'); await c.query("SET LOCAL statement_timeout = '90s'");
      const r = await c.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, s.params);
      const plan = r.rows[0]['QUERY PLAN'][0];
      out.write(JSON.stringify({ ...s, note, ...analyse(plan), plan }) + '\n');
      console.log(s.case, s.kind, `${Math.round(s.ms)}ms in prod →`, analyse(plan).exec_ms, 'ms explain');
    } catch (e) {
      let est = null;
      if (/statement timeout/.test(e.message)) {   // ช้าเกิน 90 วิ — เอาแผนที่ planner ตั้งใจใช้ (ไม่รันจริง) มาแทน
        try { await c.query('ROLLBACK'); await c.query('BEGIN READ ONLY'); const r = await c.query('EXPLAIN (FORMAT JSON) ' + sql, s.params); est = r.rows[0]['QUERY PLAN'][0]; } catch {}
      }
      out.write(JSON.stringify({ ...s, note, error: e.message, plan_estimate: est }) + '\n'); console.log(s.case, 'explain error:', e.message.slice(0, 80), est ? '(estimate plan saved)' : '');
    }
    finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
  }
  out.end(); await pool.end();
})();
