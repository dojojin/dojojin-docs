#!/usr/bin/env node
// ============================================================
// Vigil Platform — วัดคิวรีของหน้าจอทุกคืน (query probe · cron 01:15)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา (ตรวจคิวรีทุกหน้า 2026-10-25/26): ความช้าส่วนใหญ่อยู่ใน "ไซต์ที่ไม่มีข้อมูลประเภทนั้น" และ "ไซต์ข้อมูลแน่น"
// ซึ่งไม่มีใครเปิดดูเป็นประจำ · และ index ใหม่เปลี่ยนแผนของคิวรีที่ไม่ได้ถูกแก้ได้ (faces/counts VSS 92 ms → 1.06 วิ
// หลัง migration 279) — ไม่มีอะไรจับได้จนกว่าจะวัดซ้ำทั้งระบบ
//
// ทุกคืนยิงชุดกรณีเดิม (ทุกไซต์ × endpoint สำคัญ + ตัวรวม) ทีละคำขอที่ localhost ด้วย token ภายใน แล้วเก็บเวลาไว้ใน
// system_settings.query_probe (ย้อนหลัง 14 คืน) · ตัวนี้ "วัด" อย่างเดียว — perfWatch รอบ 18:25 เป็นคนตัดสินและแจ้ง
// (เกินเพดานตายตัว หรือช้ากว่าค่ากลาง 7 คืนของตัวเองเกิน ratio เท่า) แบบเดียวกับ probe LPR 18:12
//
// ข้ามไซต์ที่ปิดแจ้งเตือน Edge ไว้ (line_config.edge_alert.disabled_sites) — เปิดกลับเมื่อไหร่ก็ถูกวัดต่อเอง
//
// ปลอดภัย: GET อย่างเดียว · endpoint ที่ไม่ติดต่อกล้อง/HCP/LINE/Telegram และไม่เขียน audit_log · ทีละคำขอ ·
// หยุดรอเมื่อมีคิวรีของผู้ใช้ค้างเกิน 3 วิ · หยุดทั้งหมดเมื่อถึง QUERY_PROBE_STOP (02:45 — ก่อน backup 03:04)
// คำขอเหล่านี้เป็น user=internal ⇒ perfWatch ไม่นับเป็น "ผู้ใช้ที่รอ" (510dae18)
// ใช้: node scripts/query-probe.js [--dry-run]   (dry-run = พิมพ์รายการกรณี ไม่ยิง)
// ============================================================
'use strict';
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const env = require(path.join(SRC, 'config'));
const { Pool } = require(path.join(SRC, 'node_modules', 'pg'));

const KEY = 'query_probe';
const KEEP_DAYS = 14;
const STOP_AT = process.env.QUERY_PROBE_STOP || '02:45';
const EX = 'anprAlarm,FaceRecognition,FaceCapture,FaceDetector/Recognized,FaceDetector/Comparison';
const SITES_SQL = `SELECT s.code, array_agg(c.id ORDER BY c.id) AS cameras
  FROM sites s JOIN cameras c ON c.site_id = s.id
 WHERE s.status = 'active'  -- ไซต์ maintenance/archived เงียบทุกแจ้งเตือน (sites.status · migration 285)
   AND s.code <> ALL (SELECT jsonb_array_elements_text(COALESCE(
         (SELECT edge_alert->'disabled_sites' FROM line_config WHERE id = 1), '[]'::jsonb)))
 GROUP BY s.code ORDER BY s.code`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bkk = (d = new Date()) => new Date(d.getTime() + 7 * 3600_000);
const hhmm = () => bkk().toISOString().slice(11, 16);

/** ชุดกรณี — สร้างจากไซต์/กล้องจริงทุกครั้ง (ไซต์ใหม่ได้กรณีชุดเดียวกันอัตโนมัติ) · ช่วง "30 วัน" ไม่ใช่ "เดือนนี้" ให้เทียบข้ามคืนได้ */
function buildCases(sites, now = new Date()) {
  const iso = (ms) => new Date(ms).toISOString();
  const NOW = iso(now.getTime()), D30 = iso(now.getTime() - 30 * 864e5), D7 = iso(now.getTime() - 7 * 864e5);
  const dayStart = (() => { const b = bkk(now); b.setUTCHours(0, 0, 0, 0); return iso(b.getTime() - 7 * 3600_000); })();
  const out = [
    ['map-heatmap-24h', '/api/heatmap', { hours: '24' }],
    ['exec-summary', '/api/stats/executive-summary', {}],
    ['today-counts', '/api/stats/today-counts', {}],
    ['face-group-names', '/api/face-matches/groups', {}],
    ['traffic-enforcement-28', '/api/traffic/enforcement', { days: '28' }],
    ['appearances-stats-7d', '/api/appearances/stats', { from: D7, to: NOW }],
    ['stats-categories-7d', '/api/stats/categories', { from: D7, to: NOW }],
    ['events-open', '/api/events', { limit: '20', offset: '0', exclude_types: EX, from: dayStart, to: NOW }],
    ['lpr-stats-today-kpi', '/api/lpr/stats', { period: 'today', part: 'kpi' }],
  ];
  for (const { code, cameras } of sites) {
    const c = { cameras: cameras.join(',') };
    out.push(
      [`events-30d|${code}`, '/api/events', { limit: '20', offset: '0', exclude_types: EX, from: D30, to: NOW, ...c }],
      [`snapshots-30d|${code}`, '/api/events', { hasSnapshot: 'true', group: 'burst', limit: '20', offset: '0', exclude_types: EX, from: D30, to: NOW, ...c }],
      [`faces-search-30d|${code}`, '/api/faces', { limit: '24', offset: '0', include_recog: '1', with_total: '0', from: D30, to: NOW, ...c }],
      [`faces-live|${code}`, '/api/faces', { limit: '60', include_recog: '1', ...c }],
      [`faces-counts|${code}`, '/api/faces/counts', c],
      [`lpr-latest|${code}`, '/api/lpr', { limit: '8', offset: '0', ...c }],
      [`lpr-alerts|${code}`, '/api/lpr/alerts', { limit: '8', ...c }],
      [`lpr-stats-week|${code}`, '/api/lpr/stats', { period: 'week', ...c }],
    );
  }
  return out.map(([id, p, q]) => ({ id, path: p, query: q }));
}

/** เก็บผลคืนนี้ต่อท้ายประวัติ ตัดเหลือ KEEP_DAYS คืน */
function merge(prev, day, results) {
  const history = { ...(prev && prev.history) };
  history[day] = results;
  const days = Object.keys(history).sort().slice(-KEEP_DAYS);
  return { day, ran_at: new Date().toISOString(), history: Object.fromEntries(days.map((d) => [d, history[d]])) };
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const pool = new Pool({ ...env.db(), max: 1, options: '-c pg_stat_statements.track=none -c application_name=query_probe' });
  try {
    // ไซต์ที่ปิดแจ้งเตือน Edge ไว้ (เช่น rmutr-v ยกเครื่องกลับจากไซต์ 28 ต.ค.) ไม่ต้องวัด — ไซต์ offline ทำให้ lpr-latest
    // ต้องย้อนหาไกลขึ้นทุกคืน (2.0 → 4.7 วิ ใน 2 คืน) แล้วเตือนเท็จ · เปิดแจ้งเตือนกลับเมื่อไหร่ก็ถูกวัดต่อเอง
    const { rows } = await pool.query(SITES_SQL);
    const cases = buildCases(rows);
    if (dry) { for (const c of cases) console.log(c.id, c.path); console.log(cases.length, 'cases'); return; }
    const base = `http://127.0.0.1:${env.int('API_PORT')}`;
    const token = env.str('INTERNAL_API_SECRET');
    const busy = async () => (await pool.query(`SELECT count(*)::int n FROM pg_stat_activity
       WHERE application_name = 'api-server' AND state = 'active' AND now() - query_start > interval '3 seconds'`)).rows[0].n > 0;
    const results = {};
    for (const c of cases) {
      if (hhmm() >= STOP_AT && hhmm() < '12:00') { results._stopped_at = c.id; break; }
      for (let i = 0; i < 24 && await busy(); i++) await wait(5000);   // รอคนจริงไม่เกิน 2 นาทีต่อกรณี
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 130_000);
      const t0 = Date.now();
      try {
        const r = await fetch(`${base}${c.path}?${new URLSearchParams(c.query)}`, { headers: { 'X-Internal-Token': token }, signal: ac.signal });
        await r.arrayBuffer();
        results[c.id] = r.status === 200 ? Date.now() - t0 : -r.status;   // ติดลบ = ไม่ใช่ 200 (เช่น -500)
      } catch { results[c.id] = -1; }                                     // -1 = หมดเวลา / ต่อไม่ได้
      finally { clearTimeout(timer); }
      await wait(500);
    }
    const day = bkk().toISOString().slice(0, 10);
    const prev = await pool.query('SELECT value FROM system_settings WHERE key = $1', [KEY]);
    let old = null; try { old = JSON.parse(prev.rows[0]?.value || 'null'); } catch { /* ค่าเสีย = เริ่มใหม่ */ }
    await pool.query(`INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [KEY, JSON.stringify(merge(old, day, results)), 'ผลวัดคิวรีของหน้าจอทุกคืน (scripts/query-probe.js) — perfWatch 18:25 อ่านไปตัดสิน']);
    console.log(`[query-probe] ${day}: ${Object.keys(results).length} กรณี`);
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((e) => { console.error('[query-probe] ล้ม:', e.message); process.exit(1); });
module.exports = { buildCases, merge, KEY, KEEP_DAYS };
