// ============================================================
// Vigil Platform — Query audit: replay (ยิง endpoint จริงทีละกรณี + ภาพ pg_stat_statements ก่อน/หลัง)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ยิง endpoint จริงที่ localhost ทีละกรณี (internal token = admin ไม่จำกัดไซต์) · วัดเวลา end-to-end
// ใช้: node replay.js cases.json out.jsonl   ·   cases: [{id, path, query:{...}}]
// ปลอดภัย: ทีละคำขอ · หยุดรอเมื่อมีคิวรีของผู้ใช้จริงค้าง/โหลดเครื่องสูง · หยุดทั้งหมดเมื่อเลยเวลา STOP_AT (ค่าเริ่ม 05:00)
const P = require('path').join(__dirname, '..', '..', 'src') + '/';
const env = require(P + 'config'); const { Pool } = require(P + 'node_modules/pg'); const fs = require('fs'); const os = require('os');
const [, , casesFile, outFile] = process.argv;
const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const mon = new Pool({ ...env.db(), max: 1, options: '-c pg_stat_statements.track=none -c application_name=zz_qaudit_mon' });
const BASE = `http://127.0.0.1:${env.int('API_PORT')}`;
const TOKEN = env.str('INTERNAL_API_SECRET');
const STOP_AT = process.env.STOP_AT || '05:00';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hhmm = () => new Date().toTimeString().slice(0, 5);
async function busy() {
  const { rows: [r] } = await mon.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name = 'api-server' AND state = 'active' AND now() - query_start > interval '3 seconds'`);
  return r.n > 0 || os.loadavg()[0] > 12;
}
// ภาพ pg_stat_statements ก่อน/หลังคำขอ — เห็นทุกคิวรีที่ route ยิง (รวมตัวที่ไม่ถึง 2 วิของ slow log)
async function snap() {
  const { rows } = await mon.query(`SELECT queryid::text id, calls, total_exec_time t, shared_blks_read r, temp_blks_written tw, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) q
                                      FROM pg_stat_statements WHERE userid = (SELECT usesysid FROM pg_user WHERE usename = current_user)`);
  return new Map(rows.map((x) => [x.id, x]));
}
function diff(a, b) {
  const out = [];
  for (const [id, y] of b) { const x = a.get(id) || { calls: 0, t: 0, r: 0, tw: 0 }; const dc = y.calls - x.calls; if (dc > 0) out.push({ calls: dc, ms: Math.round(y.t - x.t), read: y.r - x.r, temp: y.tw - x.tw, q: y.q }); }
  return out.sort((p, q) => q.ms - p.ms).slice(0, 12);
}
async function hit(path, query) {
  const s0 = await snap();
  const qs = new URLSearchParams(query).toString();
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 130000);
  const t0 = Date.now(), at = new Date().toISOString();
  try {
    const r = await fetch(`${BASE}${path}${qs ? '?' + qs : ''}`, { headers: { 'X-Internal-Token': TOKEN }, signal: ac.signal });
    const body = await r.text();
    const res = { at, ms: Date.now() - t0, end: new Date().toISOString(), status: r.status, bytes: body.length, total: r.headers.get('x-total-count') };
    await wait(300); res.sql = diff(s0, await snap());
    return res;
  } catch (e) { return { at, ms: Date.now() - t0, end: new Date().toISOString(), status: e.name }; }
  finally { clearTimeout(timer); }
}
// รอบ warm: เลื่อน from/to ไป 1 วิ = key ของ cache แอปไม่ตรง แต่หน้าข้อมูลใน DB อุ่นแล้ว · ความยาวช่วงเท่าเดิม
const shiftTo = (q) => { if (!q.to) return null; const s1 = (v) => { const d = new Date(v); return isNaN(d) ? v : new Date(d.getTime() + 1000).toISOString(); };
  return { ...q, to: s1(q.to), ...(q.from ? { from: s1(q.from) } : {}) }; };
(async () => {
  const out = fs.createWriteStream(outFile, { flags: 'a' });
  for (const c of cases) {
    if (hhmm() >= STOP_AT && hhmm() < '12:00') { console.log('STOP_AT reached'); break; }
    let w = 0; while (await busy()) { if (w++ % 6 === 0) console.log(hhmm(), 'busy, waiting'); await wait(5000); }
    const a = await hit(c.path, c.query || {});
    const q2 = shiftTo(c.query || {});
    const b = q2 ? (await wait(500), await hit(c.path, q2)) : null;
    const rec = { id: c.id, path: c.path, query: c.query, cold: a, warm: b };
    out.write(JSON.stringify(rec) + '\n');
    console.log(hhmm(), c.id, `cold ${a.status} ${a.ms}ms`, b ? `warm ${b.status} ${b.ms}ms` : '');
    await wait(1000);
  }
  out.end(); await mon.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
