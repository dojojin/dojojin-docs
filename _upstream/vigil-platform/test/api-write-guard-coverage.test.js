// Vigil Platform — ทุก route เขียน (POST/PUT/PATCH/DELETE) ใต้ /api ต้องมีด่านสิทธิ์ที่มองเห็นได้ (GOTCHAS #217)
// ด่านที่นับ: requireAdmin/requireAdminOrAuditor/require… ใน argument · prefix ที่ api-server ครอบด้วย
// requireAdminForWrites หรือ lprWriteGuard · เช็ค role ใน 12 บรรทัดแรกของ handler ·
// หรือคอมเมนต์ `// write-guard: เหตุผล` ภายใน 3 บรรทัด (ตั้งใจให้ไม่มีด่าน เช่น login/webhook/ack)
// เหตุจริง: /api/lpr และ PUT /api/alert-channels/:channel เขียนได้โดย viewer มานาน ไม่มีอะไรจับได้
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

test('every /api write route has a visible permission check', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src/api-server.js'), 'utf8');
  const prefixes = [...api.matchAll(/app\.use\('(\/api\/[^']+)',\s*requireAdminForWrites\('\/'\)\)/g)].map((m) => m[1]);
  if (/app\.use\('\/api\/lpr', require\('\.\/helpers\/lprWriteGuard'\)/.test(api)) prefixes.push('/api/lpr');
  const bad = [];
  const dir = path.join(ROOT, 'src/routes');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const L = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    L.forEach((l, i) => {
      const m = l.match(/app\.(post|put|patch|delete)\(\s*['`](\/api\/[^'`]+)['`]\s*,(.*)/);
      if (!m) return;
      const [, meth, p, rest] = m;
      const ok = /require(Admin|AdminOrAuditor|Role|Auth)\b|auth\.require/.test(rest)
        || prefixes.some((x) => p === x || p.startsWith(x + '/'))
        || /role\s*!==?\s*'admin'|\.role\s*===?\s*'admin'|isAdmin\(/.test(L.slice(i, i + 12).join('\n'))
        || /\/\/\s*write-guard:/.test(L.slice(Math.max(0, i - 3), i + 3).join('\n'));
      if (!ok) bad.push(`${meth.toUpperCase()} ${p} (src/routes/${f}:${i + 1})`);
    });
  }
  assert.deepEqual(bad, [], 'write routes with no permission check:\n' + bad.join('\n'));
});
