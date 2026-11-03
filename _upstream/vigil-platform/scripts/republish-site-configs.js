#!/usr/bin/env node
// ============================================================
// Vigil Platform — Republish retained camera config to every site
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ใช้หลังเปลี่ยน broker: retained config อยู่ใน broker ตัวเก่า ตัวใหม่ยังว่าง ⇒ ส่ง config
// กล้องของทุกไซต์ใหม่ (retention ส่งเองตอน api-server boot 45 วินาทีอยู่แล้ว)
//
//   node scripts/republish-site-configs.js
// ============================================================
'use strict';
const path = require('path');
const env = require('../src/config');
const { Pool } = require('../src/node_modules/pg');
const publishSiteConfig = require('../src/helpers/publishSiteConfig');

(async () => {
  const cfg = require(path.join(__dirname, '..', 'cameras-config.json'));
  const cameras = Array.isArray(cfg) ? cfg : (cfg.cameras || []);
  const pool = new Pool({ ...env.db(), max: 2 });
  let ok = 0, fail = 0;
  try {
    const { rows } = await pool.query(
      'SELECT DISTINCT s.id, s.code FROM sites s JOIN cameras c ON c.site_id = s.id ORDER BY s.code');
    for (const s of rows) {
      try { await publishSiteConfig(s.id, cameras, pool); ok++; console.log(`  ✓ ${s.code}`); }
      catch (e) { fail++; console.log(`  ✗ ${s.code}: ${e.message}`); }
    }
  } finally { await pool.end(); }
  console.log(`ส่ง config ใหม่ ${ok} ไซต์ · ไม่สำเร็จ ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
