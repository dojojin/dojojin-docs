#!/usr/bin/env node
// ============================================================
// Vigil Platform — ตรวจ/สร้างสารบัญ route ให้ REF_api-reference.md
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เอกสาร API เคยมีตัวเลข route ขัดกันเอง 3 ค่า (CLAUDE.md 126 · footer 135 · โค้ดจริง 294)
// เพราะไม่มีใครเขียนไว้ว่า "นับอะไรบ้าง" และไม่มีอะไรตรวจให้ · สคริปต์นี้คือคำตอบเดียวของทั้งสองอย่าง
//
//   node scripts/check-api-reference.js          → สรุป + บอกว่า route ไหนยังไม่มีในเอกสาร
//   node scripts/check-api-reference.js --list    → พิมพ์ตารางภาคผนวก A (markdown) ออกมาทั้งก้อน
//   node scripts/check-api-reference.js --count   → พิมพ์จำนวน route อย่างเดียว (ใช้ใน CI/hook)
//
// ขอบเขต: process ของ api-server เท่านั้น — `src/lpr-receiver.js` เป็นคนละ service คนละพอร์ต
// จึงไม่นับ (ถ้าวันหนึ่งย้ายมารวมกัน ต้องมาแก้ SKIP ที่นี่)

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SKIP = new Set(['lpr-receiver.js']);
const DOC = path.join(ROOT, 'docs', 'REF_api-reference.md');

// หมวดของภาคผนวก — อิงโครงเรื่องของเอกสาร ไม่ใช่ prefix ดิบ
// (จัดตาม prefix ตรงๆ จะได้ 51 หมวดซึ่งเป็น artifact ไม่ใช่สารบัญที่คนอ่านรู้เรื่อง)
const SECTIONS = [
  ['Auth & Session',        p => p.startsWith('/api/auth')],
  ['Users & Permissions',   p => /^\/api\/(users|views|audit-log|csp-report)/.test(p)],
  ['Cameras & Snapshots',   p => /^\/api\/(cameras|camera-offline-alerts|snapshot|config|groups)/.test(p) || /^\/(snapshots|media)/.test(p)],
  ['Events & Categories',   p => /^\/api\/(events|categories|category-rules|heatmap)/.test(p)],
  ['Faces',                 p => /^\/api\/(faces|face-matches|face-push)/.test(p)],
  ['Face Blacklist (AuraFace)', p => p.startsWith('/api/face-blacklist')],
  ['Blacklist Sources & Master', p => p.startsWith('/api/blacklist')],
  ['LPR',                   p => p.startsWith('/api/lpr')],
  ['Traffic Enforcement',   p => p.startsWith('/api/traffic')],
  ['Appearances',           p => p.startsWith('/api/appearances')],
  ['Statistics',            p => p.startsWith('/api/stats')],
  ['Reports',               p => /^\/api\/(reports|report-schedules|report-history)/.test(p)],
  ['LINE & Alerts',         p => /^\/api\/(line|line-config|telegram|telegram-config|alert-rules|alert-rules-suggestions|alert-logs|push)/.test(p)],
  ['Sites & Map',           p => /^\/api\/(sites|map|tiles)/.test(p)],
  ['Health, Metrics & Ops', p => /^\/api\/(health|metrics|services|devices|edge|backups)/.test(p)],
  ['HCP (HikCentral)',      p => p.startsWith('/api/hcp')],
  ['Integrations',          p => p.startsWith('/api/integrations')],
  ['Settings, Branding, License & EULA', p => /^\/api\/(settings|branding|license|eula)/.test(p)],
  ['Partner API (/v1)',     p => p.startsWith('/v1')],
  ['Camera push receivers & tiles (no /api prefix)', () => true],
];

function sourceFiles() {
  return [
    ...fs.readdirSync(SRC).filter(f => f.endsWith('.js')).map(f => path.join(SRC, f)),
    ...fs.readdirSync(path.join(SRC, 'routes')).map(f => path.join(SRC, 'routes', f)),
  ].filter(f => !SKIP.has(path.basename(f)));
}

function collect() {
  const server = fs.readFileSync(path.join(SRC, 'api-server.js'), 'utf8');
  // prefix ที่ requireAdminForWrites กันการเขียนไว้ — ต้องอ่านจากโค้ดจริง ไม่ใช่ hardcode
  const writeGated = [...server.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*requireAdminForWrites/g)].map(m => m[1]);
  const globalIdx = server.indexOf("app.use('/api', async (req, res, next)");
  const aboveGlobal = new Set();
  for (const m of server.matchAll(/require\('\.\/routes\/([a-z-]+)'\)\(/g)) {
    if (m.index < globalIdx) aboveGlobal.add(m[1] + '.js');
  }

  const rows = [];
  for (const f of sourceFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    const base = path.basename(f);
    for (const m of src.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]\s*(,[^\n]*)?/g)) {
      const method = m[1].toUpperCase(), p = m[2], tail = m[3] || '';
      if (p === '/favicon.ico') continue;
      let auth;
      if (/requireAdminOrAuditor/.test(tail)) auth = 'admin+auditor';
      else if (/requireAdmin\b/.test(tail)) auth = 'admin';
      else if (p.startsWith('/v1')) auth = 'partner AK/SK';
      else if (/^\/(lpr|face-push)\/:token$/.test(p)) auth = 'per-camera token (in path)';
      else if (method !== 'GET' && writeGated.some(pre => p.startsWith(pre))) auth = 'admin (write-gate)';
      else if (aboveGlobal.has(base) && /login|logout|me$/.test(p)) auth = 'public/session';
      else auth = 'session';
      rows.push({ method, p, auth, file: base });
    }
  }
  return { rows, writeGated, aboveGlobal: [...aboveGlobal] };
}

function bucket(rows) {
  const out = SECTIONS.map(([name]) => ({ name, rows: [] }));
  for (const r of rows) {
    for (let i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i][1](r.p)) { out[i].rows.push(r); break; }
    }
  }
  return out.filter(b => b.rows.length);
}

function markdown(rows) {
  let out = '';
  for (const b of bucket(rows)) {
    b.rows.sort((a, c) => (a.p === c.p ? a.method.localeCompare(c.method) : a.p.localeCompare(c.p)));
    out += `\n### ${b.name} (${b.rows.length})\n\n| Method | Path | Auth | Source |\n|---|---|---|---|\n`;
    for (const r of b.rows) out += `| ${r.method} | \`${r.p}\` | ${r.auth} | \`${r.file}\` |\n`;
  }
  return out;
}

const { rows, writeGated, aboveGlobal } = collect();

if (process.argv.includes('--count')) { console.log(rows.length); process.exit(0); }
if (process.argv.includes('--list'))  { process.stdout.write(markdown(rows)); process.exit(0); }

// โหมด default — ตรวจว่าเอกสารตามโค้ดทันไหม
const doc = fs.readFileSync(DOC, 'utf8');
const norm = r => r.replace(/:[A-Za-z0-9_]+/g, ':p').replace(/\*\w+/g, ':p').replace(/\/+$/, '');
const inAppendix = new Set();
for (const m of doc.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)`/gm)) inAppendix.add(norm(m[1] + ' ' + m[2]));
const inProse = new Set();
for (const m of doc.matchAll(/^###\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/gm)) inProse.add(norm(m[1] + ' ' + m[2]));

const missingAppendix = rows.filter(r => !inAppendix.has(norm(r.method + ' ' + r.p)));
const missingProse = rows.filter(r => !inProse.has(norm(r.method + ' ' + r.p)));
const footer = (doc.match(/\*\*(\d+) routes\*\*/) || [])[1];

console.log(`route ใน process ของ api-server : ${rows.length}`);
console.log(`ตัวเลขที่เขียนไว้ท้ายเอกสาร      : ${footer || '(ไม่พบ)'} ${String(footer) === String(rows.length) ? '✅ ตรง' : '🔴 ไม่ตรง'}`);
console.log(`อยู่ในภาคผนวก A                 : ${rows.length - missingAppendix.length}/${rows.length} ` +
            `${missingAppendix.length ? '🔴 ขาด ' + missingAppendix.length : '✅ ครบ'}`);
console.log(`มีคำอธิบายละเอียด (หมวด 1–25)   : ${rows.length - missingProse.length}/${rows.length} (ที่เหลือมีเฉพาะสารบัญ)`);
console.log(`prefix ที่กันการเขียน            : ${writeGated.length}`);
console.log(`mount เหนือ middleware กลาง      : ${aboveGlobal.join(', ')}`);
if (missingAppendix.length) {
  console.log('\nยังไม่มีในภาคผนวก:');
  for (const r of missingAppendix.slice(0, 40)) console.log(`   ${r.method} ${r.p}  [${r.file}]`);
  process.exitCode = 1;
}
