// ============================================================
// Vigil Platform — HCP Face Match Ingester (HC1)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// HC1 Ingester: Face match records from HikCentral Professional (HCP).
// Runs on hkt edge (EDGE_MODE=1). Publishes to local NanoMQ bridge → central.
//
// Fetches match results from HCP's `/artemis/api/aiapplication/v1/face/faceMatchRecord`
// and group metadata from `/artemis/api/frs/v1/face/groupList`.
//
// Each match becomes a FaceRecognition event with camera_id left null.
// Central resolves hcp_index → camera_id at insert time via mqtt-subscriber.js,
// using hcp_camera_map table. Unmapped cameras land as NULL camera_id and are logged.
//
// Usage:
//   node hcp-face-matches.js --since 2026-08-01 --until 2026-08-31 [--populate]
//

'use strict';

// Load src/.env when run under PM2 (cwd=src) or directly from src/. dotenv does
// NOT override vars already in the environment, so `EDGE_MODE=1 node ...` and
// `-r dotenv/config` runs keep working. Must precede the publisher require
// below, which reads EDGE_MODE at module-load time.
require('dotenv').config({ quiet: true });

const path = require('path');
const env = require('../config');
const { EDGE_MODE, publishEdgeEvent, newCorrId, closeEdgePublisher } = require('../edge/publisher');
const hcpClient = require('../hcp-client');
const { snapshotDir } = require('../helpers/snapshotDir');
const { hcpTime } = require('../helpers/hcpTime');
const { snapPath } = require('../snapshot-path');
const fs = require('fs').promises;
const crypto = require('crypto');

// Only run in EDGE_MODE (guard applies when executed as a CLI/PM2 app — not when
// the module is required by a unit test for its pure helpers).
if (require.main === module && !EDGE_MODE) {
  console.error('❌ HC1 ingester requires EDGE_MODE=1');
  process.exit(1);
}

const SNAPSHOT_DIR = snapshotDir();

// แมป hcp_index → camera_id · จำเป็นตอน "ตั้งชื่อไฟล์รูป" เท่านั้น — การ insert ยัง
// ให้ central แปลงเหมือนเดิม · เส้นทางรูปต้องมี camera_id จริงอยู่ที่ segment ที่ 3
// ไม่งั้น api-server หาไม่เจอว่ารูปอยู่ edge ไหน แล้วรูปจะ 404 ทั้งที่ไฟล์มีอยู่
// สร้างไฟล์นี้ด้วย: node hcp-setup.js --from <dump> --export-map hcp-camera-map.json
const MAP_FILE = env.str('HCP_CAMERA_MAP') || path.join(__dirname, '..', 'hcp-camera-map.json');
let cameraMap = {};
try {
  cameraMap = JSON.parse(require('fs').readFileSync(MAP_FILE, 'utf8'));
} catch {
  console.warn(`⚠️  ไม่พบไฟล์แมปกล้อง ${MAP_FILE} — รูปจะเก็บใต้ชื่อ hcp index และเปิดดูไม่ได้`);
}
let groupCache = {}; // { groupId: { name, type (blackList/whiteList) } }

// ── จำแนกชนิดกลุ่มใบหน้า ────────────────────────────────────
//
// HCP **ไม่ได้บอกชนิดของกลุ่มมาให้** — ตรวจซ้ำแล้ว 2026-08-19 ด้วยการยิง
// /artemis/api/frs/v1/face/groupList จริงจาก edge hkt: คืนมาแค่ 3 ฟิลด์
// { indexCode, name, description } · ไม่มี type/groupType/libType เลย
// ⇒ ชื่อกลุ่มยังเป็นหลักฐานเดียวที่มีจริง ไม่ใช่เพราะไม่ได้ไปหา
//
// เดิมเขียน regex ซ้ำ 2 ที่ (ตอนโหลดกลุ่ม + ตอนจำแนกรายเหตุการณ์) ซึ่งเป็นแบบ
// ที่แก้ที่เดียวแล้วลืมอีกที่ได้ง่าย จึงรวบมาไว้ที่นี่ที่เดียว
//
// ค่าเริ่มต้นยังเป็น blackList เหมือนเดิม (ชื่อไม่เข้าเกณฑ์ = ถือว่าต้องเฝ้าระวัง)
// เพราะระบบความปลอดภัย "แจ้งเกินดีกว่าพลาด" — เปลี่ยนเป็นเงียบเมื่อไม่แน่ใจ
// แปลว่ากลุ่มที่ตั้งชื่อไม่ตามแบบแผนจะหายไปจากการแจ้งเตือนโดยไม่มีใครรู้
//
// ที่เพิ่มคือ **คำไทย** — ของเดิมจับได้แต่ /white\s*list/i ภาษาอังกฤษ ถ้าวันหนึ่ง
// มีกลุ่มชื่อ "บัญชีขาว" ระบบจะจัดเป็นเฝ้าระวังแล้วยิง LINE ใส่คนที่ไม่ควรถูกแจ้ง
// (ตรวจ 2026-08-19: ตอนนี้ยังไม่มีกลุ่ม whitelist สักกลุ่มใน 18 กลุ่มของภูเก็ต
//  จึงยังไม่เคยระเบิด — แก้ไว้ก่อนที่จะมี)
const WHITELIST_PATTERNS = [
  /white\s*list/i,       // WhiteList, White List, whitelist
  /บัญชีขาว/,             // ที่ UI ของเราเรียก
  /ไวท์\s*ลิสต์/,          // ทับศัพท์
  /รายชื่อขาว/,
];
// ชื่อที่เข้าเกณฑ์ "ตั้งใจให้เป็นบัญชีดำ" — ใช้เตือนเฉพาะกลุ่มที่ไม่เข้าทั้งสองแบบ
const BLACKLIST_PATTERNS = [/black\s*list/i, /บัญชีดำ/, /เฝ้าระวัง/];

// ลำดับสำคัญ: เช็คบัญชีดำ **ก่อน** — ชื่อที่มีทั้งสองคำต้องตกเป็นบัญชีดำ
// เช่น "Blacklist (ไม่ใช่บัญชีขาว)" ถ้าเช็คขาวก่อนจะกลายเป็นบัญชีขาว = เงียบสนิท
// ทั้งที่เป็นกลุ่มเฝ้าระวังจริง (เจอตอน audit 2026-08-19) · หลักคือระบบความปลอดภัย
// ให้ "แจ้งเกินดีกว่าพลาด" ทุกครั้งที่กำกวม
//
// ข้อจำกัดที่ยังเหลือและยอมรับไว้: ชื่อที่เป็นการปฏิเสธล้วน ๆ อย่าง "ไม่ใช่บัญชีขาว"
// (ไม่มีคำว่า blacklist อยู่เลย) ยังถูกจัดเป็นบัญชีขาว — ตรวจแล้วว่าไม่มีชื่อแบบนี้
// ใน 18 กลุ่มจริง และการไล่ตรวจคำปฏิเสธทุกแบบในภาษาไทยไม่คุ้มกับความเสี่ยงที่เพิ่ม
function classifyFaceGroup(name) {
  const nm = String(name || '');
  if (BLACKLIST_PATTERNS.some((re) => re.test(nm))) return 'blackList';
  if (WHITELIST_PATTERNS.some((re) => re.test(nm))) return 'whiteList';
  return 'blackList';
}
// กลุ่มที่ชื่อไม่บอกอะไรเลย = เดาไม่ได้ ต้องให้คนเห็น ไม่ใช่ปล่อยเงียบ
function isAmbiguousGroupName(name) {
  const nm = String(name || '');
  return !WHITELIST_PATTERNS.some((re) => re.test(nm))
      && !BLACKLIST_PATTERNS.some((re) => re.test(nm));
}

// ── Main entry point ────────────────────────────────────────
if (require.main === module) (async () => {
  const args = new Map(process.argv.slice(2)
    .filter(a => a.includes('='))
    .map(a => a.split('=')));

  const isLive = process.argv.includes('--live');
  const since = args.get('--since') || '2026-08-01';
  const until = args.get('--until') || '2026-08-31';
  const shouldInsert = process.argv.includes('--populate');

  // Multi-site guard: HCP lives only at the site that has it (hkt). The edge
  // ecosystem is a single shared file, so hdy/vss would otherwise start this app
  // and crash-loop on HCP init. When no HCP secret is configured:
  //   --live  → idle (setInterval keeps PM2 "online" without a restart storm;
  //             a bare pending promise would NOT hold the event loop open).
  //   one-shot→ clean exit 0 with a clear message (not a confusing decrypt throw).
  if (!env.str('HCP_SECRET_KEY_ENC')) {
    console.log('ℹ️  HCP not configured on this site (no HCP_SECRET_KEY_ENC)');
    if (isLive) {
      console.log('   hcp-face-matches idle (no-op) — shared edge ecosystem, HCP runs only where configured');
      setInterval(() => {}, 1 << 30); // hold the process open, do no work
      return;
    }
    process.exit(0);
  }

  try {
    // Initialize HCP client
    await hcpClient.init();
    console.log('✅ HCP client initialized\n');

    // Load face groups
    await _loadFaceGroups();

    if (isLive) {
      await _runLive();                    // continuous — returns only on SIGINT/SIGTERM
    } else {
      console.log(`🔍 HC1 FaceMatch Ingester: ${since} to ${until}\n`);
      // Fetch and process face matches in 30-day chunks (HCP limit)
      await _processFaceMatches(since, until, shouldInsert);
      // ต้องรอคิว MQTT ว่างก่อน exit — publish เป็น async, exit ทันทีคือทิ้งทั้งหมด
      await closeEdgePublisher();
      console.log('\n✅ HC1 ingestion complete');
      process.exit(0);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    await closeEdgePublisher();
    process.exit(1);
  }
})();

// ── Load face groups (blacklist, whitelist) ────────────────
async function _loadFaceGroups() {
  // โหลดไม่ได้ = ทุกแถวตกไปที่ blackList โดยปริยาย แล้วกฎที่กรอง list_types={blackList}
  // จะยิง LINE ใส่คนใน whitelist ด้วย · ล้มเสียงดังดีกว่าเดินต่อแบบเงียบ ๆ
  const resp = await hcpClient.queryFaceGroups(1, 500);
  // code เป็นสตริง "0" — เทียบกับเลข 0 จะพังทุกครั้งแม้เรียกสำเร็จ
  if (resp.statusCode !== 200 || String(resp.body.code) !== '0') {
    throw new Error(`โหลดกลุ่มใบหน้าไม่ได้: code=${resp.body.code} ${resp.body.msg || ''}`);
  }

  const d = resp.body.data || {};
  const groups = d.list || (Array.isArray(d) ? d : []);
  if (!groups.length) throw new Error('HCP คืนกลุ่มใบหน้ามา 0 กลุ่ม — ผิดปกติ (ที่ภูเก็ตมี 17)');

  const ambiguous = [];
  groups.forEach((g) => {
    // ชื่อกลุ่มคือหลักฐานเดียวที่มี — HCP ไม่ได้บอกชนิดของกลุ่มมาตรง ๆ
    // (ยืนยันซ้ำ 2026-08-19: groupList คืนแค่ indexCode/name/description)
    const nm = String(g.groupName || g.name || '');
    if (isAmbiguousGroupName(nm)) ambiguous.push(nm || `(ไม่มีชื่อ) ${g.indexCode}`);
    groupCache[g.groupId || g.indexCode] = {
      name: nm || `Group ${g.groupId}`,
      type: classifyFaceGroup(nm),
    };
  });
  const wl = Object.values(groupCache).filter((g) => g.type === 'whiteList').length;
  console.log(`📚 โหลดกลุ่มใบหน้า ${groups.length} กลุ่ม (whiteList ${wl} · blackList ${groups.length - wl})`);
  // ชื่อที่ไม่บอกว่าเป็นขาวหรือดำ ถูกนับเป็น "เฝ้าระวัง" โดยปริยาย — ถ้าที่จริง
  // เป็นกลุ่มขาว จะกลายเป็นยิง LINE ใส่คนที่ไม่ควรถูกแจ้ง ต้องให้คนเห็นชื่อพวกนี้
  if (ambiguous.length) {
    console.warn(`⚠️  ${ambiguous.length} กลุ่มที่ชื่อไม่บอกชนิด → ถือเป็น "เฝ้าระวัง" ไว้ก่อน: ${ambiguous.join(' · ')}`);
    console.warn('   ถ้ากลุ่มไหนที่จริงเป็นบัญชีขาว ให้เปลี่ยนชื่อฝั่ง HCP ให้มีคำว่า WhiteList / บัญชีขาว');
  }
  console.log('');
}

// ── Process face matches ───────────────────────────────────
async function _processFaceMatches(sinceStr, untilStr, shouldInsert) {
  const since = new Date(sinceStr);
  const until = new Date(untilStr);

  let current = new Date(since);
  let totalMatches = 0;
  let totalInserted = 0;

  console.log('📡 Fetching face matches from HCP...\n');

  while (current < until) {
    // HCP max is 31 days per request
    const chunkEnd = new Date(current.getTime() + 30 * 24 * 60 * 60 * 1000);
    const realEnd = chunkEnd < until ? chunkEnd : until;

    const startTime = hcpTime(current);
    const endTime = hcpTime(realEnd);

    console.log(`  Chunk: ${current.toISOString().split('T')[0]} → ${realEnd.toISOString().split('T')[0]}`);

    try {
      const matches = await _fetchChunk(startTime, endTime);
      totalMatches += matches.length;

      if (shouldInsert) {
        const inserted = await _processMatches(matches);
        totalInserted += inserted;
      } else {
        console.log(`    Found ${matches.length} matches (dry-run, not inserting)`);
      }
    } catch (err) {
      console.warn(`    ❌ Chunk failed: ${err.message}`);
    }

    current = new Date(realEnd.getTime() + 1000); // skip 1s to avoid overlaps
  }

  console.log(`\n📊 Summary: ${totalMatches} total matches, ${totalInserted} processed`);
}

// ── Fetch one chunk of face matches ────────────────────────
async function _fetchChunk(startTime, endTime) {
  const matches = [];
  let pageNo = 1;

  for (;;) {
    const resp = await hcpClient.queryFaceMatches(startTime, endTime, pageNo, 500);

    // HCP ตอบ HTTP 200 กับทุกผลลัพธ์ — สถานะจริงอยู่ที่ body.code ("2" พารามิเตอร์ผิด,
    // "8" ไม่มีสิทธิ์) · เช็คแค่ statusCode แปลว่าคำขอที่ถูกปฏิเสธจะอ่านออกมาเป็น
    // "ไม่มีข้อมูล" ซึ่งเป็นอาการที่กินเวลาไปแล้วสองรอบวันนี้
    if (resp.statusCode !== 200 || String(resp.body.code) !== '0') {
      throw new Error(`faceMatchRecord code=${resp.body.code} ${resp.body.msg || ''}`);
    }

    // รายการอยู่ที่ data.list และ **ยอดรวมชื่อ totalNum ไม่ใช่ total**
    // อ่าน total จะได้ undefined แล้วสรุปว่า "ไม่มีข้อมูล" ทั้งที่แถวอยู่ในมือแล้ว
    const d = resp.body.data || {};
    const list = d.list || [];
    matches.push(...list);

    if (!list.length || matches.length >= (d.totalNum || 0)) break;
    pageNo++;
  }

  return matches;
}

// ── Process individual matches ────────────────────────────
async function _processMatches(hcpMatches) {
  let inserted = 0;

  for (const match of hcpMatches) {
    try {
      const event = _buildEvent(match);
      if (!event) continue;

      // Fetch images (if available)
      // ใช้ camera_id จริงในเส้นทางรูป — ถ้าแมปไม่เจอก็ใช้ index ไปก่อน แล้วรูปจะ
      // เปิดไม่ได้ ซึ่งเห็นได้ทันทีบนหน้าจอ ต่างจากการเงียบ ๆ แล้วไม่มีรูปเลย
      const camForPath = cameraMap[event.raw_json.hcp_index] || `hcp-${event.raw_json.hcp_index}`;
      const tsMs = new Date(event.event_time).getTime();
      const previewRef = match.snapFacePicUrl ? await _fetchImage(match.snapFacePicUrl, camForPath, tsMs) : null;
      const previewFull = match.bkgPicUrl ? await _fetchImage(match.bkgPicUrl, camForPath, tsMs) : null;

      // Publish to NanoMQ
      publishEdgeEvent({
        vendor: 'hcp',
        event,
        previewRef,
        previewFull,
        previewSource: 'hcp-face',
        // backfill ช่วงเดิมซ้ำต้องไม่เพิ่มแถว — เคยรัน 2 รอบแล้วได้ 52 → 104
        dedup: { field: 'hcp_dedup_key', value: event.raw_json.hcp_dedup_key },
        // ไม่ส่ง alert = alert-engine ไม่เคยเห็นเหตุการณ์นี้ LINE จึงไม่มีทางยิง
        // camera_name ใช้ชื่อฝั่ง HCP ไปก่อน — central เติม camera_id ให้ตอน insert
        // list_type คือฟิลด์ที่กฎกรองด้วย (alert-engine.js:79) ขาดไปคือกฎ
        // list_types={blackList} จะไม่ match อะไรเลย
        alert: {
          camera_name: event.raw_json.hcp_camera_name || event.raw_json.hcp_index,
          location: null,
          rule_name: event.rule_name,
          event_type: event.event_type,
          object_class: event.object_class,
          likelihood: event.likelihood,
          event_time: event.event_time,
          list_type: event.raw_json.list_type,
        },
      });

      inserted++;
    } catch (err) {
      console.warn(`  ⚠️  Could not process match: ${err.message}`);
    }
  }

  console.log(`    Inserted ${inserted}/${hcpMatches.length}`);
  return inserted;
}

// ── Build event object from HCP match ──────────────────────
function _buildEvent(hcpMatch) {
  // faceMatchRecord คืนข้อมูลเป็นชั้น ไม่ใช่แบน — ร่างแรกอ่าน hcpMatch.cameraIndexCode
  // ตรง ๆ จึงได้ undefined ทุกฟิลด์ แล้วทุกเหตุการณ์ถูก central ทิ้งด้วยข้อความ
  // "missing event.camera_id" · โครงจริง:
  //   cameraInfo    { cameraIndexCode, cameraName }
  //   faceGroupInfo { faceGroupIndexCodes, faceGroupName }
  //   personInfo    { personId, personCode, personName }
  //   similarity (0-100) · faceTime
  const cam = hcpMatch.cameraInfo || {};
  const grp = hcpMatch.faceGroupInfo || {};
  const per = hcpMatch.personInfo || {};

  const hcpIndex = cam.cameraIndexCode;
  if (!hcpIndex) return null;   // ไม่มีกล้อง = แมปไม่ได้ ไม่มีประโยชน์จะส่งต่อ

  const groupId = grp.faceGroupIndexCodes;
  const groupName = grp.faceGroupName || (groupCache[groupId] && groupCache[groupId].name) || 'Unknown';
  // ชื่อกลุ่มมากับ record อยู่แล้ว groupCache เป็นตัวสำรองเมื่อ record ไม่ได้ส่งมา
  // ใช้ตัวจำแนกร่วมกับตอนโหลดกลุ่ม — เดิมเป็น regex คนละชุดที่ต้องจำไปแก้ให้ครบเอง
  const listType = classifyFaceGroup(groupName);

  const similarity = (hcpMatch.similarity || 0) / 100;   // HCP 0-100 → ของเรา 0-1

  // personCode คือช่อง "เลขประจำตัว" ที่เจ้าหน้าที่ HCP กรอกเอง จึง **ปนกัน**
  // ตัวอย่างที่วัดจริง = 35 คนไม่ซ้ำ **ที่โผล่ในข้อมูลวันเดียว** (ไม่ใช่ทั้งฐาน HCP):
  // 17 คนเป็นเลขบัตรประชาชนไทยถูกต้อง (13 หลัก ผ่าน checksum) อีก 18 คนเป็นเลข
  // 7-10 หลักซึ่งไม่ใช่เลขบัตร · 17/35 จึงเป็นสัดส่วนของวันนั้น ไม่ใช่ของทั้งระบบ
  // — สิ่งที่มันพิสูจน์คือ "ฟิลด์นี้ปนกันแน่นอน" ซึ่งพอสำหรับการตัดสินใจแล้ว
  // ⇒ ห้ามเรียกฟิลด์นี้ว่า "national ID" และห้าม parse ตามรูปแบบเลขบัตร
  // แต่ต้องปฏิบัติกับมันเป็น PII ทั้งหมด เพราะบางส่วนเป็นเลขบัตรจริง
  //
  // ส่งค่าดิบไปให้ central เข้ารหัสตอน insert แทนที่จะเข้ารหัสตรงนี้ (เจ้าของเลือก
  // 2026-08-08) · BLACKLIST_SECRET_KEY ถูกออกแบบให้เป็นคนละ key กับ CAMERA_SECRET_KEY
  // โดยตั้งใจ (spec §4.3) เพื่อให้ camera key รั่วแล้วไม่พลอยเปิด PII — การเอา key
  // ไปวางบน edge ทุกเครื่องที่ต่อ HCP คือการรื้อเจตนานั้นทิ้ง · ระหว่างทางวิ่งบน
  // wss:// อยู่แล้ว และ edge ไม่เขียนค่านี้ลงดิสก์
  //
  // ชื่อฟิลด์ลงท้าย _plain เพื่อให้เห็นชัดว่ายังไม่เข้ารหัส · central ต้องแปลงแล้ว
  // ลบทิ้งเสมอ ไม่ว่าจะเข้ารหัสสำเร็จหรือไม่

  return {
    camera_id: null,              // central แปลงจาก hcp_index ตอน insert
    event_category: 'RuleEngine',
    event_type: 'FaceRecognition',
    rule_name: 'Face Recognition Match',
    event_time: hcpMatch.faceTime,
    event_state: 'true',
    object_class: 'Person',
    likelihood: similarity,
    raw_json: {
      source: 'hcp',
      hcp_index: hcpIndex,
      hcp_camera_name: cam.cameraName || null,
      hcp_person_code_plain: per.personCode ? String(per.personCode) : null,
      hcp_person_name: per.personName || null,
      hcp_person_id: per.personId || null,
      hcp_group_id: groupId || null,
      hcp_group_name: groupName,
      hcp_list_type: listType,
      hcp_face_time: hcpMatch.faceTime,
      similarity,
      // HCP-provided attributes. gender is the only enum we map reliably
      // (1=male, 2=female, else unknown → null) into the display field the Face
      // pages read; the raw HCP enums are kept under hcp_* for future mapping.
      gender: hcpMatch.gender === 1 ? 'male' : hcpMatch.gender === 2 ? 'female' : null,
      hcp_gender: hcpMatch.gender ?? null,
      hcp_age_group: hcpMatch.ageGroup ?? null,
      hcp_glasses: hcpMatch.glasses ?? null,
      hcp_mask: hcpMatch.wearMaskStatus ?? null,
      list_type: listType,
      // คีย์กันซ้ำ — HCP ไม่มี id ที่เสถียรให้ (recordIndexCode = "-1" ทุกแถว)
      // เวลา+คนที่เจอ+กล้อง คือชุดที่เล็กที่สุดที่ยังแยกเหตุการณ์ออกจากกันได้จริง
      // (live mode ใช้คีย์เดียวกันนี้ผ่าน _dedupKey เพื่อกรอง match ที่เคยส่งแล้วในรอบ)
      hcp_dedup_key: _dedupKey(hcpMatch),
    },
  };
}

// ── Fetch image from HCP and save locally ──────────────────
async function _fetchImage(url, camId, tsMs) {
  if (!url) return null;
  try {
    const resp = await hcpClient.getPicture(url);
    if (resp.statusCode !== 200) {
      console.warn(`    ⚠️  ดึงรูปไม่ได้ (HTTP ${resp.statusCode})`);
      return null;
    }

    // endpoint นี้ไม่ได้ตอบเป็น JSON — มันคืน data URI ตรง ๆ และ client ห่อไว้ที่
    // body.raw · ร่างแรกอ่าน body.data จึงได้ undefined แล้วรายงานว่า "fetch failed"
    // ทุกครั้ง ทั้งที่รูปมาถึงแล้ว (backfill 52 แถวได้รูป 0 แถวเพราะเหตุนี้)
    const payload = resp.body.raw || resp.body.data || '';
    const b64 = String(payload).replace(/^data:image\/[a-z]+;base64,/, '');
    if (!b64) { console.warn('    ⚠️  ตอบกลับไม่มีข้อมูลรูป'); return null; }

    const buffer = Buffer.from(b64, 'base64');
    // JPEG ขึ้นต้นด้วย FF D8 — เช็คไว้กันกรณีตอบเป็นข้อความ error ที่ base64 ผ่านได้
    if (buffer.length < 100 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
      console.warn(`    ⚠️  ข้อมูลที่ได้ไม่ใช่ JPEG (${buffer.length} ไบต์)`);
      return null;
    }

    // รูปแบบเดียวกับ ingester อื่น: face/<วันที่>/<camera_id>/<slot>/<ไฟล์>
    const { dir, relBase } = snapPath(SNAPSHOT_DIR, 'face', camId, tsMs || Date.now());
    const filename = `${crypto.randomUUID()}_${Date.now()}.jpg`;
    await fs.writeFile(path.join(dir, filename), buffer);
    return `${relBase}/${filename}`;
  } catch (err) {
    console.warn(`    ⚠️  ดึงรูปไม่สำเร็จ: ${err.message}`);
    return null;
  }
}

// ── Live mode (continuous poll) ────────────────────────────
// ponytail: fixed lookback window, no persisted cursor. Central dedup
// (mqtt-subscriber INSERT ... WHERE NOT EXISTS on hcp_dedup_key, which runs
// BEFORE the alert_event pg_notify) makes overlapping windows and process
// restarts safe — no duplicate rows and no duplicate LINE. Gaps longer than the
// lookback (edge down > LOOKBACK) must be filled with the one-shot backfill CLI.
const LIVE_POLL_MS     = env.int('HCP_LIVE_POLL_SEC') * 1000;
const LIVE_LOOKBACK_MS = env.int('HCP_LIVE_LOOKBACK_MIN') * 60 * 1000;
const GROUP_RELOAD_MS  = 60 * 60 * 1000; // refresh blacklist/whitelist membership hourly
const _seen = new Map(); // hcp_dedup_key → faceTimeMs (in-process, pruned to lookback)
let _stopping = false;

// Same tuple the stored hcp_dedup_key uses — HCP has no stable record id.
function _dedupKey(m) {
  const cam = m.cameraInfo || {}, per = m.personInfo || {};
  return `${m.faceTime}|${per.personId || '-'}|${cam.cameraIndexCode}`;
}

// Drop seen keys older than the lookback so the Map stays bounded (pure).
function _pruneSeen(seen, nowMs, lookbackMs) {
  const cutoff = nowMs - lookbackMs - 60000;
  for (const [k, t] of seen) if (t < cutoff) seen.delete(k);
  return seen;
}

// Interruptible sleep — wakes early when a stop signal arrives.
function _sleep(ms) {
  return new Promise((res) => {
    const to = setTimeout(() => { clearInterval(iv); res(); }, ms);
    const iv = setInterval(() => { if (_stopping) { clearTimeout(to); clearInterval(iv); res(); } }, 200);
  });
}

async function _liveCycle() {
  const now  = new Date();
  const from = new Date(now.getTime() - LIVE_LOOKBACK_MS);
  const matches = await _fetchChunk(hcpTime(from), hcpTime(now)); // throws on HCP code!=0
  const fresh = matches.filter((m) => {
    if (!m.cameraInfo || !m.cameraInfo.cameraIndexCode) return false; // unmappable → dropped downstream
    const key = _dedupKey(m);
    if (_seen.has(key)) return false;              // already published this session
    _seen.set(key, new Date(m.faceTime).getTime());
    return true;
  });
  const published = fresh.length ? await _processMatches(fresh) : 0;
  // One concise line per cycle (even when empty) = liveness signal for ops.
  console.log(`  [${now.toISOString()}] window=${matches.length} fresh=${fresh.length} published=${published}`);
}

async function _runLive() {
  console.log(`🟢 HC1 live: poll ${LIVE_POLL_MS / 1000}s · lookback ${LIVE_LOOKBACK_MS / 60000}m`);
  process.on('SIGINT',  () => { _stopping = true; });
  process.on('SIGTERM', () => { _stopping = true; });
  let lastGroupReload = Date.now();
  while (!_stopping) {
    const cycleStart = Date.now();
    try {
      if (Date.now() - lastGroupReload > GROUP_RELOAD_MS) { await _loadFaceGroups(); lastGroupReload = Date.now(); }
      await _liveCycle();
    } catch (err) {
      // A transient HCP code!=0 or network blip must NOT crash the loop into a
      // pm2 restart storm (max_restarts eventually gives up) — log and keep going.
      console.warn(`⚠️  live cycle error (continuing): ${err.message}`);
    }
    _pruneSeen(_seen, Date.now(), LIVE_LOOKBACK_MS);
    await _sleep(Math.max(1000, LIVE_POLL_MS - (Date.now() - cycleStart)));
  }
  await closeEdgePublisher();
  console.log('🛑 HC1 live stopped');
  process.exit(0);
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Convert Date to HCP time format
 * Format: "2026-08-01T03:40:18+07:00" (no milliseconds)
 */
// HCP ต้องการเวลาแบบ ISO-8601 **ไม่มีมิลลิวินาที** และมี offset
//
// ของเดิมเอา toISOString() ซึ่งเป็น UTC ไปแปะ '+07:00' ตรง ๆ — ได้สตริงที่หน้าตา
// ถูกแต่ความหมายเลื่อนไป 7 ชั่วโมง (00:00Z กลายเป็น 00:00+07:00 = 17:00Z ของเมื่อวาน)
// ไม่มี error ให้เห็น มีแค่ช่วงเวลาที่ผิดและจำนวนแถวที่ไม่ตรง ซึ่งเดาไม่ออกว่ามาจากอะไร
module.exports = { EDGE_MODE, _dedupKey, _pruneSeen };
