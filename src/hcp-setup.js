#!/usr/bin/env node
// ============================================================
// Vigil Platform — HCP Setup Utility (HC0)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// Run on the hkt edge node to:
// 1. Verify HCP connectivity
// 2. Fetch HCP camera list
// 3. Match with our camera_id values
// 4. Populate hcp_camera_map table
//
// Usage (from edge):
//   cd ~/vigil-platform/src
//   set -a && . ./.env && set +a
//   node hcp-setup.js [--populate] [--verify]
//
// Arguments:
//   --populate    Actually insert rows into hcp_camera_map
//   --verify      Verify existing mappings (dry-run default)
//

'use strict';

const hcpClient = require('./hcp-client');
// src/db.js ไม่มีอยู่จริงในโปรเจกต์นี้ — ทุกตัวสร้าง Pool เองจาก env (ดู partner-admin.js)
const { Pool } = require('pg');
const env = require('./config');
const dbPool = new Pool({ ...env.db() });

const argv = process.argv.slice(2);
const args = new Set(argv);
const shouldPopulate = args.has('--populate');
const shouldVerify = args.has('--verify');
const flagVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
// --dump <ไฟล์>  รันบน edge hkt (ที่เดียวที่ถึง HCP)
// --from <ไฟล์>  รันบน central (ที่เดียวที่มี Postgres)
const writeDump = flagVal('--dump');
const dumpFile = flagVal('--from');
const exportMap = flagVal('--export-map');   // เขียนแมป index→camera_id ให้ edge
// ประกาศตรงนี้ ไม่ใช่ท้ายไฟล์ — IIFE ด้านล่างเริ่มทำงานทันที ถ้า const อยู่ใต้มัน
// จะติด TDZ แล้วตายตั้งแต่บรรทัดแรกที่ใช้
const fs = require('fs');
const dumped = dumpFile ? JSON.parse(fs.readFileSync(dumpFile, 'utf8')) : null;

if (!shouldPopulate && !shouldVerify) {
  console.log('ℹ️  Running in dry-run mode. Use --populate to write mappings.');
}

// ── Main flow ──────────────────────────────────────────────
(async () => {
  try {
    // --export-map เดี่ยว ๆ = อ่านแมปจากฐานข้อมูลไปเขียนไฟล์ให้ edge เท่านั้น
    // ไม่ต้องต่อ HCP (central ต่อไม่ได้อยู่แล้ว) และไม่ต้องจับคู่ใหม่
    if (exportMap && !dumpFile && !shouldPopulate) {
      const { rows } = await dbPool.query(
        `SELECT hcp_index, camera_id FROM hcp_camera_map WHERE site_id = 'hkt'`);
      const out = {};
      rows.forEach((r) => { out[r.hcp_index] = r.camera_id; });
      fs.writeFileSync(exportMap, JSON.stringify(out));
      console.log(`🗺️  เขียนแมป ${rows.length} รายการ ลง ${exportMap} — ก๊อปไปวางที่ src/ ของ edge`);
      process.exit(0);
    }

    console.log('🔧 HC0 Setup: HCP Camera Mapping\n');

    // Step 1: Verify HCP connectivity — ข้ามเมื่อใช้ --from เพราะรันบน central
    // ซึ่งไปไม่ถึง 10.0.10.9 อยู่แล้ว และไม่ต้องใช้ HCP อีกในโหมดนั้น
    if (!dumpFile) {
      console.log('1️⃣  Verifying HCP connectivity...');
      await hcpClient.init();
      const versionResp = await hcpClient.getVersion();
      if (versionResp.statusCode !== 200) {
        throw new Error(`HCP version check failed: code ${versionResp.statusCode}`);
      }
      console.log(`   ✅ HCP reachable: ${JSON.stringify(versionResp.body).slice(0, 100)}`);
    } else {
      console.log(`1️⃣  โหมด --from : ใช้ข้อมูลจาก ${dumpFile} ไม่ต่อ HCP`);
    }

    // Step 2: Fetch HCP cameras
    console.log('\n2️⃣  Fetching HCP camera list...');
    // --dump ให้รันบน edge (ที่เดียวที่ถึง HCP) แล้วเอาไฟล์มาให้ --from บน central
    // (ที่เดียวที่มี Postgres) · การแยกนี้ไม่ใช่ความยุ่งยากที่คิดขึ้นเอง — central
    // ping 10.0.10.9 ไม่ติด และ edge ไม่มีฐานข้อมูล
    const hcpCameras = dumpFile ? dumped.cameras : await _fetchHcpCameras();
    console.log(`   📷 Found ${hcpCameras.length} cameras from HCP`);
    if (hcpCameras.length === 0) {
      throw new Error('No cameras found in HCP');
    }
    hcpCameras.slice(0, 3).forEach(cam => {
      console.log(`      - ${cam.hcp_index}: ${cam.hcp_name}`);
    });
    if (hcpCameras.length > 3) console.log(`      ... and ${hcpCameras.length - 3} more`);

    // Step 3: Fetch our cameras
    console.log('\n3️⃣  Fetching our camera list...');
    const ourCameras = await _fetchOurCameras();
    console.log(`   📷 Found ${ourCameras.length} cameras in our database`);
    ourCameras.slice(0, 3).forEach(cam => {
      console.log(`      - ${cam.id}: ${cam.name}`);
    });
    if (ourCameras.length > 3) console.log(`      ... and ${ourCameras.length - 3} more`);

    // Step 4: Match cameras — เทียบด้วย (โซนจาก IP ของ NVR) + (เลข C จากชื่อ)
    // ต้องดึงรายการอุปกรณ์มาก่อน เพราะ IP อยู่ที่เครื่องบันทึก ไม่ได้อยู่ที่กล้อง
    console.log('\n4️⃣  Matching cameras by (zone from IP) + (C number)...');
    const devIpByIndex = dumpFile ? dumped.devices : await _fetchDeviceIps();
    console.log(`   🖧  ${Object.keys(devIpByIndex).length} encode devices`);
    const mappings = _matchCameras(hcpCameras, ourCameras, devIpByIndex);
    console.log(`   ✅ matched 1:1        ${mappings.matched.length}/${ourCameras.length} ของเรา`);
    console.log(`   ⚠️  ambiguous          ${mappings.ambiguous.length}`);
    console.log(`   ❌ ของเราไม่มีคู่      ${mappings.ourUnmatched.length}`);
    console.log(`   ·  กล้อง HCP ที่ไม่ได้ใช้ ${mappings.unmatched.length} (ปกติ — HCP ถือทั้งจังหวัด)`);
    mappings.ambiguous.forEach((a) =>
      console.log(`      กำกวม ${a.id} → ${a.candidates.map((c) => c.hcp_index + ':' + c.hcp_name).join(' / ')}`));
    mappings.ourUnmatched.forEach((u) => console.log(`      ไม่มีคู่ ${u.id} (${u.ip_address}) — ${u.why}`));

    if (mappings.unmatched.length > 0) {
      console.log(`\n   Unmatched HCP cameras (manual mapping may be needed):`);
      mappings.unmatched.slice(0, 5).forEach(cam => {
        console.log(`      - ${cam.hcp_index}: ${cam.hcp_name}`);
      });
      if (mappings.unmatched.length > 5) {
        console.log(`      ... and ${mappings.unmatched.length - 5} more`);
      }
    }

    if (mappings.ourUnmatched.length > 0) {
      console.log(`\n   Our cameras with no HCP match:`);
      mappings.ourUnmatched.slice(0, 5).forEach(cam => {
        console.log(`      - ${cam.id}: ${cam.name}`);
      });
      if (mappings.ourUnmatched.length > 5) {
        console.log(`      ... and ${mappings.ourUnmatched.length - 5} more`);
      }
    }

    if (writeDump) {
      const payload = { cameras: hcpCameras, devices: await _fetchDeviceIps() };
      fs.writeFileSync(writeDump, JSON.stringify(payload));
      console.log(`\n   💾 เขียน ${hcpCameras.length} กล้อง + ${Object.keys(payload.devices).length} อุปกรณ์ ลง ${writeDump}`);
      console.log('   เอาไฟล์นี้ไปรันต่อบน central ด้วย --from <ไฟล์> --populate');
      process.exit(0);
    }

    // Step 5: Populate or verify
    if (shouldPopulate) {
      console.log('\n5️⃣  🚀 Populating hcp_camera_map...');
      const result = await _populateMap(mappings.matched);
      console.log(`   ✅ Inserted ${result.inserted} mappings`);
      console.log(`   ⚠️  Skipped ${result.skipped} (already exists)`);
    } else if (shouldVerify) {
      console.log('\n5️⃣  Verifying existing mappings...');
      const existing = await dbPool.query(
        'SELECT COUNT(*) as cnt FROM hcp_camera_map WHERE site_id = $1',
        ['hkt']
      );
      console.log(`   Existing mappings for hkt: ${existing.rows[0].cnt}`);
    } else {
      console.log('\n5️⃣  Dry-run mode: no changes made. Use --populate to write.');
    }

    // ไฟล์แมปสำหรับ edge — ingester ต้องรู้ camera_id ตอน "เขียนไฟล์รูป" ไม่ใช่แค่
    // ตอน insert เพราะเส้นทางที่ central ใช้ proxy รูปคือ face/<วันที่>/<camera_id>/<slot>/
    // (api-server อ่าน camera_id จาก segment ที่ 3 เพื่อหาว่าเป็นของ edge ไหน)
    // edge ไม่มี Postgres จึงต้องหิ้วไฟล์ไป — เล็กและเปลี่ยนไม่บ่อย
    if (exportMap) {
      const { rows } = await dbPool.query(
        `SELECT hcp_index, camera_id FROM hcp_camera_map WHERE site_id = 'hkt'`);
      const out = {};
      rows.forEach((r) => { out[r.hcp_index] = r.camera_id; });
      fs.writeFileSync(exportMap, JSON.stringify(out));
      console.log(`   🗺️  เขียนแมป ${rows.length} รายการ ลง ${exportMap} — ก๊อปไปที่ edge`);
    }

    console.log('\n✅ HC0 setup complete.\n');
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
})();

// ── Helpers ────────────────────────────────────────────────

const PAGE = 500;


/**
 * Fetch camera list from HCP
 * Handles pagination if needed
 */
async function _fetchHcpCameras() {
  const cameras = [];
  let pageNo = 1;

  for (;;) {
    const resp = await hcpClient.queryCameras(pageNo, PAGE);
    // code มาเป็น "0" (สตริง) ไม่ใช่ 0 — เทียบแบบ !== 0 จะโยนทุกครั้งแม้สำเร็จ
    if (resp.statusCode !== 200 || String(resp.body.code) !== '0') {
      throw new Error(`HCP query failed: code=${resp.body.code} ${resp.body.msg || ''}`);
    }
    // รายการอยู่ที่ data.list และยอดรวมอยู่ที่ data.total — ไม่ใช่ที่ราก
    const d = resp.body.data || {};
    const list = d.list || [];
    list.forEach((cam) => {
      cameras.push({
        hcp_index: cam.cameraIndexCode,
        hcp_name: cam.cameraName || cam.name || '',
        dev: cam.encodeDevIndexCode,
      });
    });
    if (!list.length || cameras.length >= (d.total || 0)) break;
    pageNo++;
  }

  return cameras;
}

/**
 * IP ของ encode device ต่อ index — กล้องพก encodeDevIndexCode มา แต่ IP อยู่ที่นี่
 */
async function _fetchDeviceIps() {
  const resp = await hcpClient.queryEncodeDevices(1, 500);
  const list = (resp.body && resp.body.data && resp.body.data.list) || [];
  const out = {};
  list.forEach((d) => { out[d.encodeDevIndexCode] = d.encodeDevIp; });
  return out;
}

/**
 * Fetch our camera list from the database
 */
async function _fetchOurCameras() {
  // hkt เท่านั้น — HCP ที่เราต่อคือของภูเก็ต เข้าทาง hkt edge (ขอบเขตที่เจ้าของกำหนด)
  const result = await dbPool.query(
    `SELECT c.id, c.name, c.ip_address
       FROM cameras c JOIN sites s ON s.id = c.site_id
      WHERE s.code = 'hkt' ORDER BY c.id`
  );
  return result.rows;
}

/**
 * จับคู่กล้อง HCP กับกล้องของเรา
 *
 * ชื่อกล้องสองฝั่ง "ไม่ตรงกันจริง" (เจ้าของยืนยัน 2026-08-08) — ของเราเป็น
 * `C57-PT-SB-23` ของ HCP เป็น `PT-23-C57-ริมชายหาด จุดที่ 3-FACE` เรียงคนละแบบ
 * และบางตัวตั้งชื่อไม่เข้าแบบเลย จับด้วยชื่อล้วนจึงเดาไม่ได้
 *
 * IP เป็นตัวยืนยัน แต่ **ไม่ใช่โดยตรง**: `encodeDeviceList` คืน IP ของ *เครื่อง
 * บันทึก* ไม่ใช่ของกล้อง — NVR อยู่ 10.<โซน>.10.x ส่วนกล้องเราอยู่ 10.<โซน>.100.x
 * เทียบ IP ตรง ๆ จึงได้ 0 คู่ (ลองแล้ว) · แต่ octet ที่สองคือรหัสโซน และตรงกัน
 * ทั้งสองฝั่ง: NVR ชื่อ Patong1/2 = 10.4.10.x ↔ กล้อง PT ของเรา = 10.4.100.x
 *
 * คีย์จึงเป็น (โซนจาก IP) + (เลข C จากชื่อ) — สองแหล่งอิสระ ไม่ใช่ชื่ออย่างเดียว
 * เลข C อย่างเดียวใช้ไม่ได้: hkt มี 29 จาก 84 ตัวที่เลขซ้ำกันข้ามโซน
 * (C9 มีทั้ง KAR, TCC และ PT) · เลข C ต้อง normalize เป็นตัวเลขก่อนเทียบ
 * เพราะ HCP เติมศูนย์หน้า (`C02`) ส่วนเราไม่เติม (`C2-...`)
 *
 * ผลที่วัดได้ 2026-08-08: ตรง 1:1 = 83 / 84 · กำกวม 0 · เหลือ 1 ตัว
 * (`C4-TCC-SB-02`) ที่ HCP ตั้งชื่อช่องนั้นว่า `TCC-02-C03-...-LPR` ไม่มี C04 เลย
 * — ปล่อยไม่แมป ดีกว่าเดา เพราะแมปผิด = แจ้งเตือนผิดกล้อง ซึ่งมีคนเอาไปใช้จริง
 */
const _zone = (ip) => (ip || '').split('.')[1] || null;
const _cnum = (name) => {
  const m = String(name || '').match(/C(\d+)/);
  return m ? String(parseInt(m[1], 10)) : null;
};

function _matchCameras(hcpCameras, ourCameras, devIpByIndex) {
  const key = (zone, c) => `${zone}/C${c}`;

  // ฝั่ง HCP: กล้องที่รู้ทั้งโซนและเลข C เท่านั้นจึงเข้าตะกร้า
  const buckets = new Map();
  const hcpSkipped = [];
  for (const cam of hcpCameras) {
    const zone = _zone(devIpByIndex[cam.dev]);
    const c = _cnum(cam.hcp_name);
    if (!zone || !c) { hcpSkipped.push(cam); continue; }
    const k = key(zone, c);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(cam);
  }

  const matched = [], ambiguous = [], ourUnmatched = [];
  for (const our of ourCameras) {
    const c = _cnum(our.id);
    const zone = _zone(our.ip_address);
    if (!c || !zone) { ourUnmatched.push({ ...our, why: 'id หรือ ip ไม่เข้าแบบ' }); continue; }
    const hits = buckets.get(key(zone, c)) || [];
    if (hits.length === 1) {
      matched.push({ hcp_index: hits[0].hcp_index, camera_id: our.id, hcp_name: hits[0].hcp_name });
    } else if (hits.length > 1) {
      // กำกวม = ปล่อยไว้ ไม่เลือกให้ · เลือกผิดแล้วไม่มีใครรู้
      ambiguous.push({ ...our, candidates: hits });
    } else {
      ourUnmatched.push({ ...our, why: `ไม่มีคู่ที่ ${key(zone, c)}` });
    }
  }

  const used = new Set(matched.map((m) => String(m.hcp_index)));
  const unmatched = hcpCameras.filter((c) => !used.has(String(c.hcp_index)));
  return { matched, ambiguous, unmatched, ourUnmatched, hcpSkipped };
}

/**
 * Populate hcp_camera_map table (with --populate flag)
 */
async function _populateMap(mappings) {
  let inserted = 0;
  let skipped = 0;

  for (const map of mappings) {
    try {
      const result = await dbPool.query(
        `INSERT INTO hcp_camera_map (site_id, hcp_index, camera_id, hcp_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (site_id, hcp_index) DO NOTHING`,
        ['hkt', map.hcp_index, map.camera_id, map.hcp_name]
      );
      if (result.rowCount > 0) inserted++;
      else skipped++;
    } catch (err) {
      console.warn(`   ⚠️  Failed to insert mapping ${map.hcp_index}: ${err.message}`);
    }
  }

  return { inserted, skipped };
}

module.exports = { _fetchHcpCameras, _fetchOurCameras, _matchCameras, _zone, _cnum };
