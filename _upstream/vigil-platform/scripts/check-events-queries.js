#!/usr/bin/env node
// ============================================================
// Vigil Platform — กันคิวรี events/license_plates ที่ไม่มีขอบเวลา / ไม่มี scope
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ทำไม: `events` 40 ล้านแถว (partition รายเดือน) · คิวรีที่ลืมขอบเวลาไม่ error
// มันแค่ช้าลงเรื่อย ๆ ตามข้อมูลที่โต แล้วไปโผล่เป็น "หน้าเว็บช้า" อีกหลายเดือนถัดมา
// เคสจริง: /api/alert-rules-suggestions (30 วันบน events, 2026-09-05) และ
// /api/face-matches/groups (ไม่มีขอบเลย 14.5 วิ, 2026-09-07)
// และคิวรีที่ลืม siteWhere ก็ไม่ error เหมือนกัน — มันแค่คืนข้อมูลของ site อื่น
//
// ตรวจเฉพาะ handler ที่ **ผู้ใช้ทั่วไป (viewer) เข้าถึงได้** ใน src/routes/ :
//   - ต้องมีขอบเวลา (event_time / detected_at / bucket / interval) หรือคอมเมนต์
//     `// unbounded:` อธิบายว่าทำไมไม่ต้องมี
//   - ต้องมี siteWhere/scopedCameraIds หรือคอมเมนต์ `// unscoped:` อธิบายว่าทำไม
// handler ที่ requireAdmin/requireAdminOrAuditor ไม่ตรวจ (คนละความเสี่ยง —
// แอดมินเห็นทุก site อยู่แล้ว และเป็นคนกดเอง ไม่ใช่ polling ของหน้าจอ)
//
// รัน: npm run check:events
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'src', 'routes');

// appearances เพิ่ม 2026-10-02 (GOTCHAS #217 · D6: /api/appearances/stats ไม่มีขอบเวลา → 120 วิ)
// face_embeddings / face_embed_queue เพิ่ม 2026-10-06 (preventive P4 · 15 GB / 7 ล้านแถว — ไม่มีขอบเวลา = สแกนทั้งตาราง)
const TABLE_RE   = /FROM\s+(events|license_plates|appearances|face_embeddings|face_embed_queue)\b/i;
// ขอบเวลาที่ผูกกับ `if (from)` = ไม่มีขอบเมื่อผู้เรียกไม่ส่ง from มา
// (เจอจริง 2026-09-08: /api/stats/kpi ใช้เวลา 35 วินาที เพราะ `?period=today`
//  ไม่ใช่พารามิเตอร์ที่ handler รู้จัก จึงกลายเป็นคิวรีทั้งตาราง)
const COND_TIME_RE = /if\s*\(\s*(from|to)\s*\)[^\n]*event_time/;
const HAS_DEFAULT_RE = /parseRange\(|from\s*(\|\||\?\?)|const\s+from\s*=/;
// handler ที่มีเพดานของตัวเองอยู่แล้ว (LIMIT / statement_timeout / count cap) ไม่ถือว่าเสี่ยง
// — วัดจริง 2026-09-08: /api/events 0.05 วิ · /api/lpr 0.23 วิ · /api/faces/counts 1.1 วิ
// แม้ไม่ส่งช่วงเวลา ต่างจาก /api/stats/kpi ที่ไม่มีเพดานอะไรเลย จึงกิน 35 วินาที
const GUARDED_RE = /LIMIT\s|statement_timeout|COUNT_CAP|TIMEOUT_MS/i;
const TIME_RE    = /event_time|detected_at|\bbucket\b|INTERVAL\s+'|interval '/i;
const SCOPE_RE   = /siteWhere\(|scopedCameraIds\(|allowedSites/;
const ADMIN_RE   = /requireAdmin(OrAuditor)?\b/;
const OK_TIME_RE = /\/\/\s*unbounded:/;
const OK_SCOPE_RE= /\/\/\s*unscoped:|ponytail:\s*(deliberately\s+)?unscoped/;

/** คืน [{ file, line, route, missing[] }] */
function scan() {
  const out = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.js'))) {
    const rel = path.join('src/routes', f);
    const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
    let start = -1, header = '';
    for (let i = 0; i <= lines.length; i++) {
      const isRoute = i < lines.length && /app\.(get|post|patch|put|delete)\(/.test(lines[i]);
      // helper ที่ประกาศคั่นระหว่าง route ไม่ใช่ส่วนหนึ่งของ route ก่อนหน้า —
      // ถ้าไม่ตัดตรงนี้ `if (from)` ใน `_facePeriodClause` จะถูกนับเป็นของ
      // /api/faces/counts ทั้งที่ handler นั้นไม่ได้เรียกมันด้วยซ้ำ (2026-09-08)
      const isHelper = i < lines.length && /^ {0,4}(async )?function\s/.test(lines[i]);
      if (isRoute || isHelper || i === lines.length) {
        if (start >= 0) {
          const body = lines.slice(start, i).join('\n');
          if (TABLE_RE.test(body) && !ADMIN_RE.test(header)) {
            const missing = [];
            if (!TIME_RE.test(body)  && !OK_TIME_RE.test(body))  missing.push('ขอบเวลา (event_time/detected_at) — หรือใส่คอมเมนต์ `// unbounded: เหตุผล`');
            else if (COND_TIME_RE.test(body) && !HAS_DEFAULT_RE.test(body)
                     && !GUARDED_RE.test(body) && !OK_TIME_RE.test(body))
              missing.push('ค่าเริ่มต้นของช่วงเวลา — ขอบผูกกับ `if (from)` ผู้เรียกที่ไม่ส่ง from จะได้คิวรีทั้งตาราง (ใช้ parseRange หรือใส่ `// unbounded:`)');
            if (!SCOPE_RE.test(body) && !OK_SCOPE_RE.test(body)) missing.push('siteWhere/scope — หรือใส่คอมเมนต์ `// unscoped: เหตุผล`');
            if (missing.length) {
              out.push({ file: rel, line: start + 1, route: header.trim().slice(0, 80), missing });
            }
          }
        }
        start = isRoute ? i : -1;              // helper = ไม่มี handler ที่กำลังนับอยู่
        header = isRoute ? lines[i] : '';
      }
    }
  }
  return out;
}

if (require.main === module) {
  const bad = scan();
  if (!bad.length) {
    console.log('[check-events] ✅ ทุก handler ที่ viewer เข้าถึงได้และแตะ events/license_plates/appearances/face_embeddings มีขอบเวลา + scope (หรือระบุเหตุผลไว้)');
    process.exit(0);
  }
  console.error(`[check-events] ❌ ${bad.length} handler ที่ต้องแก้:`);
  for (const b of bad) {
    console.error(`   ${b.file}:${b.line}  ${b.route}`);
    for (const m of b.missing) console.error(`      ขาด ${m}`);
  }
  process.exit(1);
}

module.exports = { scan };
