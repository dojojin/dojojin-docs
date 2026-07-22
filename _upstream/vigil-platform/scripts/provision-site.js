#!/usr/bin/env node
// ============================================================
// Vigil Platform — Site Provisioner (CLI)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Add a multi-site Site + its edge MQTT bridge identity in one command.
//   node scripts/provision-site.js <code> [name]
// e.g.  node scripts/provision-site.js vss "VSS"
//
// Wraps src/site-provision.js (shared with the future Settings › Sites endpoint).
// Run from project root, with the EMQX container up. Prints the edge config to
// paste into the edge NanoMQ bridge — the password is shown ONCE.
// ============================================================
'use strict';

const path = require('path');
// src/.env carries the app env (DB_* + EMQX_DASHBOARD_PASSWORD)
require(path.join(__dirname, '..', 'src', 'node_modules', 'dotenv'))
  .config({ path: path.join(__dirname, '..', 'src', '.env') });
const { Pool } = require(path.join(__dirname, '..', 'src', 'node_modules', 'pg'));
const { provisionSite, emqxLogin } = require(path.join(__dirname, '..', 'src', 'site-provision'));

(async () => {
  const code = String(process.argv[2] || '').trim().toLowerCase();
  const name = process.argv[3] || code;
  if (!code || !/^[a-z0-9-]+$/.test(code)) {
    console.error('Usage: node scripts/provision-site.js <code> [name]   (code: a-z 0-9 -)');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    max: 2, application_name: 'provision-site',
  });

  try {
    const token = await emqxLogin(process.env.EMQX_DASHBOARD_PASSWORD);
    const out = await provisionSite(pool, token, { code, name });

    console.log(`\n✅ Site "${out.site.code}" (id ${out.site.id}) provisioned · EMQX user ${out.userAction}`);
    console.log('\n── Edge NanoMQ bridge config (วางที่ฝั่ง edge) ──────────────');
    console.log('  broker    :', out.brokerUrl);
    console.log('  username  :', out.mqtt.username);
    console.log('  password  :', out.mqtt.password, '  ← เก็บเดี๋ยวนี้ (โชว์ครั้งเดียว)');
    console.log('  topic     :', out.topicPrefix + '#', '  (edge publish ใต้ prefix นี้)');
    console.log('  keepalive : 30-60s   (กัน Cloudflare WS idle ~100s ตัด)');
    console.log('────────────────────────────────────────────────────────────\n');
  } catch (e) {
    console.error('\n❌', e.message, '\n');
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
