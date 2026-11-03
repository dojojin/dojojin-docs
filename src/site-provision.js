// ============================================================
// Vigil Platform — Site Provisioning (multi-site edge onboarding)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Reusable engine for adding a Site + its edge MQTT bridge identity. Used by
// scripts/provision-site.js (CLI) and Settings › Sites (POST
// /api/sites/:id/provision-edge — so the logic lives in ONE place). One call
// provisions:
//   1. a `sites` row (idempotent upsert by code)
//   2. a broker user  edge-<code>  (password returned ONCE, also stored
//      encrypted in sites.bridge_password_enc — decision #2, 2026-09-27)
//   3. a broker ACL restricting that user to projects/<code>/#
//
// Broker calls go through src/helpers/brokerAdmin.js (BROKER_KIND-aware —
// EMQX REST or Mosquitto dynsec). Each brokerAdmin call logs in / connects on
// its own — this used to share one EMQX token across all three calls
// (1 login); it is now 1 login/connect *per call* (up to 3). Known, accepted
// deviation — a token/connection cache would leak the "one shared call" shape
// back into brokerAdmin.js's per-operation contract, and provisioning a site
// is rare enough that the extra round trips don't matter.
//
// NOTE on isolation: we add the per-site ALLOW rule but DON'T flip the broker's
// default-deny on for every other existing account — true deny-by-default
// isolation is a production hardening step (every existing user needs an
// explicit rule first; see brokerAdmin.js mosquitto setDefaultACLAccess, done
// once at M2 cutover, not per-site here).
// ============================================================
'use strict';

const crypto = require('crypto');
const brokerAdmin = require('./helpers/brokerAdmin');
const { encryptPii } = require('./helpers/blacklist-crypto');

function genPassword() { return crypto.randomBytes(18).toString('base64url'); }

async function upsertSiteRow(pool, { code, name, color }) {
  const r = await pool.query(
    `INSERT INTO sites (code, name, color) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color
     RETURNING id, code, name, color`,
    [code, name || code, color || '#5b8def']);
  return r.rows[0];
}

// ⚠️ ACL ที่สร้างที่นี่ครอบแค่ namespace ของไซต์ (`projects/<code>/#`) ซึ่งพอสำหรับ
// heartbeat / config / event ที่ผ่าน edge-bridge แต่ **ไม่ครอบ ONVIF metadata ของกล้อง Bosch**
// ซึ่ง publish ไปที่ `<camera_id>/onvif-ej/...` (ไม่มี prefix ของไซต์ — ดู GOTCHAS #92)
//
// edge-bridge subscribe `+/onvif-ej/#` ได้โดยไม่ถูกปฏิเสธ ปัญหาจึงไม่โผล่ตอน start
// แต่จะโผล่ตอน **publish** เมื่อกล้องเริ่มส่งจริง และ broker ตั้ง default-deny ⇒ เงียบหาย
//
// เวลาเพิ่มกล้อง Bosch ที่เปิด ONVIF metadata ต้องเติม ACL ต่อกล้องเอง —
// brokerAdmin.addCameraAcl(username, cameraId) มีของจริงพร้อมใช้ (ทั้งสอง
// backend) แต่ยังไม่ถูกเรียกที่นี่ เพราะตอน provision ไซต์ยังไม่มีกล้องสักตัว —
// รายชื่อ camera_id เกิดทีหลังเสมอ · จุดที่ถูกคือตอนเพิ่มกล้อง ไม่ใช่ตอนสร้างไซต์

// Orchestrator — sites row + broker user + ACL. Returns the edge config to
// apply at the edge device (password is plaintext here ONLY — shown once, not
// stored — except the encrypted copy in sites.bridge_password_enc below).
async function provisionSite(pool, { code, name, color, brokerUrl } = {}) {
  if (!/^[a-z0-9-]+$/.test(code)) throw new Error('site code must be [a-z0-9-]');
  const site = await upsertSiteRow(pool, { code, name, color });
  const username = `edge-${code}`;
  const password = genPassword();
  // Encrypt BEFORE any broker side effect (decision #2): if BLACKLIST_SECRET_KEY
  // is missing, encryptPii throws here and NO broker call has happened yet —
  // never leaves a broker holding a password the operator was never shown.
  const passwordEnc = encryptPii(password);
  await brokerAdmin.ensureAuthzSource();
  // ไม่ผูก role ตอนสร้าง: role site-<code> ถูกสร้างใน setSiteAcl ขั้นถัดไป · dynsec ปฏิเสธ
  // createClient ที่อ้าง role ที่ยังไม่มี ("Role not found" — เจอตอนซ้อม 28 ก.ย. 2569)
  const userAction = await brokerAdmin.upsertUser(username, password);
  await brokerAdmin.setSiteAcl(username, code);
  // Best-effort — the broker side already succeeded (creds are usable) even if
  // this write fails; warn instead of throwing so a DB hiccup doesn't strand a
  // freshly-provisioned edge account. Never log the password itself.
  await pool.query(`UPDATE sites SET bridge_password_enc = $2 WHERE id = $1`, [site.id, passwordEnc])
    .catch((e) => console.warn(`[site-provision] failed to store bridge_password_enc for ${code}:`, e.message));
  return {
    site,
    userAction,                                  // 'created' | 'updated'
    mqtt: { username, password },                // password shown ONCE
    topicPrefix: `projects/${code}/`,
    brokerUrl: brokerUrl || 'wss://dashboard.dojojin.tech/mqtt',
  };
}

module.exports = { provisionSite, upsertSiteRow, genPassword };
