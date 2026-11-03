// ============================================================
// Vigil Platform — Central env config
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ทำไมต้องมี: env 130 ตัวถูกอ่านกระจาย 313 จุดใน src/ แต่ละจุดพก default ของตัวเอง
// (SNAPSHOT_PROXY_DOMAIN พิมพ์ 'dojojin.tech' ซ้ำ 14 จุด · REPORT_WORKER_PORT พิมพ์
// '3001' ซ้ำ 3 จุด · DB_* ซ้ำ 12 ไฟล์) ⇒ แก้ default ที่เดียวไม่พอ และไม่มีใครรู้ว่า
// มี env อะไรอยู่บ้าง (135 ตัวไม่เคยอยู่ใน .env.example)
//
// ไฟล์นี้คือ "ทะเบียนกลาง" ตัวเดียว: default อยู่ที่เดียว · coercion เหมือนกันหมด ·
// ชื่อที่ไม่ได้ลงทะเบียน = throw (บั๊กของโปรแกรมเมอร์ ไม่ใช่ของ deployment) และ
// scripts/check-env.js (pre-commit) บล็อกไม่ให้ env ใหม่หลุดเข้ามาโดยไม่ลงทะเบียน
//
// กฎที่ต้องรู้ 3 ข้อ:
//  1) อ่าน process.env "ตอนเรียก" ไม่ใช่ snapshot ตอน require — api-server ตั้ง
//     APP_NAME หลัง require และเทสต์ตั้ง env หลัง require เช่นกัน
//  2) ค่าว่าง ('') นับเป็น "ไม่ได้ตั้ง" → คืน default — ตรงกับสำนวน `env || default`
//     ที่ใช้อยู่เดิมแทบทุกจุด
//  3) dotenv ถูกเรียกที่นี่เป็นบรรทัดแรกด้วย path ตรง (src/.env) — entry file เดิม
//     ยังเรียกของตัวเองอยู่ได้ (idempotent, dotenv ไม่ override ค่าที่มีแล้ว) แต่โค้ดใหม่
//     ให้ require ไฟล์นี้แทน · กันเคส "const อ่าน env ก่อน dotenv ทำงาน"
//     (hazard ที่บันทึกไว้ที่ edge-config-agent.js:38-39)
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

// type: str | int | bool | list   (list = คั่นคอมมา, trim, ตัดตัวว่างทิ้ง)
// def : ค่าที่ call site เดิมใช้ — ท้ายบรรทัดคือที่มา (file:line)
// min/max ใส่เฉพาะที่ call site เดิมบังคับไว้จริง
const DEFS = {
  ACUSEEK_HOST:                 { type: 'str',  def: '10.0.10.12', doc: 'AcuSeek server host' },                        // helpers/acuseek.js:22
  ACUSEEK_MAP_FRESH_MS:         { type: 'int',  def: 3600000, doc: 'อายุ cache ตาราง camera→AcuSeek (ms)' },            // routes/acuseek.js:31
  ACUSEEK_PORT:                 { type: 'int',  def: 80, doc: 'AcuSeek server port' },                                  // helpers/acuseek.js:23
  ALERT_WORKER_PORT:            { type: 'int',  def: 3002, doc: 'พอร์ต /health ของ alert-worker (loopback)' },          // alert-worker.js:26
  ALLOWED_ORIGINS:              { type: 'list', def: '', doc: 'origin เพิ่มเติมที่ยอมให้เรียก API (คั่นคอมมา)' },        // api-server.js:124
  API_PORT:                     { type: 'int',  def: 3000, doc: 'พอร์ต api-server' },                                   // api-server.js:2888
  APP_COUNT_CAP:                { type: 'int',  def: 10000, doc: 'เพดานการนับผลลัพธ์ /api/appearances' },               // routes/appearances.js:26
  APP_NAME:                     { type: 'str',  def: undefined, doc: 'ชื่อโปรเซส — ตั้งเองตอน boot ไม่ต้องใส่ใน .env' }, // api-server.js:24 (เขียนตอน runtime)
  AURAFACE_MATCH_THRESHOLD:     { type: 'str',  def: '0.60', doc: 'เกณฑ์ cosine ของ AuraFace (parseFloat ที่ call site)' }, // face-embed-worker.js:55
  AUTH_BACKOFF_MS:              { type: 'int',  def: 2100000, doc: 'หน่วงหลังกล้องปฏิเสธ auth (ms) — กัน lockout' },     // edge-config-agent.js:1185
  BIND_HOST:                    { type: 'str',  def: '127.0.0.1', doc: 'ที่อยู่ที่ api-server bind' },                   // api-server.js:2902
  BLACKLIST_AUTO_SYNC:          { type: 'bool', def: true, doc: 'ซิงก์ blacklist source อัตโนมัติ' },                    // routes/blacklist-sources-import.js:580
  BLACKLIST_PUSH_LIVE:          { type: 'bool', def: false, doc: 'push blacklist เข้ากล้องจริง (ไม่ใช่ dry-run)' },       // helpers/blacklistPush.js:224
  BLACKLIST_SECRET_KEY:         { type: 'str',  def: undefined, doc: 'AES-256-GCM key ของ PII ใน blacklist' },           // helpers/blacklist-crypto.js:23
  BRIDGE_BROKER_URL:            { type: 'str',  def: 'wss://dashboard.dojojin.tech/mqtt', doc: 'broker ปลายทางของ edge bridge' }, // edge/bridge.js:45
  BRIDGE_BROKER_URLS:           { type: 'str',  def: undefined, doc: 'หลายเส้นทาง คั่นด้วย , เรียงตามลำดับ (Tailscale, SSH -R :18830, wss) · ไม่ตั้ง = ใช้ BRIDGE_BROKER_URL เส้นเดียว' }, // edge/bridgePaths.js
  BRIDGE_PASSWORD:              { type: 'str',  def: undefined, doc: 'รหัสผ่าน bridge → broker กลาง (BROKER_KIND ใดก็ได้)' }, // edge/bridge.js:99
  BRIDGE_USERNAME:              { type: 'str',  def: undefined, doc: 'ผู้ใช้ bridge → broker กลาง (BROKER_KIND ใดก็ได้)' }, // edge/bridge.js:98
  BROKER_KIND:                  { type: 'str',  def: 'emqx', doc: "broker กลางที่ใช้จริง: 'emqx' หรือ 'mosquitto' — ดู src/helpers/brokerAdmin.js" }, // helpers/brokerAdmin.js
  CAMERA_BASELINE_DAYS:         { type: 'int',  def: 14, doc: 'ย้อนหลังกี่วันในการหา "นิสัยความเงียบ" ของกล้อง' },        // alert-engine.js:1050
  CAMERA_BASELINE_HOUR:         { type: 'int',  def: 1, doc: 'ชั่วโมงที่คำนวณฐานกล้องใหม่ (วิ่ง :30 ของชั่วโมงนี้)' },     // alert-worker.js:122
  CAMERA_SECRET_KEY:            { type: 'str',  def: undefined, doc: 'AES-256-GCM key ของ credential กล้อง' },           // crypto-creds.js:31
  CAMERA_TOUCH_EVERY_SEC:       { type: 'int',  def: 30, doc: 'ถี่สุดในการอัปเดต last_seen ของกล้อง (วินาที)' },          // helpers/touchCamera.js:30
  CARTO_API_KEY:                { type: 'str',  def: '', doc: 'CARTO key (fallback เมื่อไม่มีใน system_settings)' },      // api-server.js:2063
  CAT_ROLLUP_FIRST_RUN_MS:      { type: 'int',  def: 90000, doc: 'หน่วงรอบแรกของ category rollup (ms)' },                // category-rollup-refresher.js:30
  CAT_ROLLUP_LOOKBACK_HOURS:    { type: 'int',  def: 3, doc: 'ช่วงย้อนหลังที่ rollup คำนวณซ้ำ (ชม.)' },                   // category-rollup-refresher.js:31
  CAT_ROLLUP_RECONCILE_HOUR:    { type: 'int',  def: 5, doc: 'ชั่วโมง (0-23) ที่ category rollup เก็บตก 7 วันย้อนหลัง' }, // category-rollup-refresher.js
  CAT_ROLLUP_REFRESH_MS:        { type: 'int',  def: 300000, doc: 'คาบ refresh category rollup (ms)' },                  // category-rollup-refresher.js:28
  CAT_ROLLUP_RETENTION_DAYS:    { type: 'int',  def: 400, doc: 'อายุแถว category rollup (วัน)' },                        // category-rollup-refresher.js:34
  APP_ROLLUP_FIRST_RUN_MS:      { type: 'int',  def: 240000, doc: 'หน่วงรอบแรกของ appearance rollup (ms) — หลัง LPR warm 180s ก่อนกวาด retention 300s' }, // appearance-rollup-refresher.js
  APP_ROLLUP_LOOKBACK_HOURS:    { type: 'int',  def: 3, doc: 'ช่วงย้อนหลังที่ appearance rollup คำนวณซ้ำ (ชม.)' },        // appearance-rollup-refresher.js
  APP_ROLLUP_RECONCILE_HOUR:    { type: 'int',  def: 5, doc: 'ชั่วโมง (0-23 เวลาไทย) ที่ appearance rollup เก็บตก 7 วันย้อนหลัง' }, // appearance-rollup-refresher.js
  APP_ROLLUP_REFRESH_MS:        { type: 'int',  def: 300000, doc: 'คาบ refresh appearance rollup (ms)' },               // appearance-rollup-refresher.js
  APP_ROLLUP_RETENTION_DAYS:    { type: 'int',  def: 45, doc: 'อายุแถว appearance rollup (วัน) — หน้าสถิติเลือกได้ 31 วัน · ดิบเก็บ 40' }, // appearance-rollup-refresher.js
  DASHBOARD_BUNDLE:             { type: 'bool', def: true, doc: 'รวม js ของ dashboard เป็นไฟล์เดียวตอน boot' },          // api-server.js:631
  DASHBOARD_PUBLIC_URL:         { type: 'str',  def: '', doc: 'URL สาธารณะของ dashboard (ใช้ทำลิงก์ภาพเซ็นชื่อ)' },      // line-sender.js:940
  DB_HOST:                      { type: 'str',  def: undefined, doc: 'Postgres host' },                                 // api-server.js:92
  DB_NAME:                      { type: 'str',  def: undefined, doc: 'Postgres database' },                             // api-server.js:94
  DB_PASSWORD:                  { type: 'str',  def: undefined, doc: 'Postgres password' },                             // api-server.js:96
  DB_PORT:                      { type: 'int',  def: undefined, doc: 'Postgres port' },                                 // api-server.js:93
  DB_USER:                      { type: 'str',  def: undefined, doc: 'Postgres user' },                                 // api-server.js:95
  DEBUG_MQTT:                   { type: 'bool', def: false, doc: 'log payload ดิบของ MQTT' },                            // mqtt-subscriber.js:541
  DIAG_CUTOUT_ENABLED:          { type: 'bool', def: false, doc: 'เก็บ diag ของการ crop ป้าย (Dahua)' },                 // ingesters/dahua-cgi.js:913
  DIAG_SNAP_SUPPLY_ENABLED:     { type: 'bool', def: false, doc: 'เก็บ diag ของแหล่งภาพ snapshot (Dahua)' },             // ingesters/dahua-cgi.js:931
  EDGE_BROKER:                  { type: 'str',  def: 'nanomq', doc: "broker ที่ pm2 รันบน edge เครื่องนี้: 'nanomq' (default) หรือ 'mosquitto' (E1 pilot) — อ่านโดย ecosystem.edge.config.js ตอนเลือก app · edge-config-agent.js ก็อ่านค่านี้เองตอน sync password_file/acl_file (E2, มีแค่ Mosquitto เท่านั้นที่ต้องเขียน)" }, // ecosystem.edge.config.js, edge-config-agent.js
  EDGE_CAMERA_BROKER_URL:       { type: 'str',  def: undefined, doc: 'broker (LAN IP) ที่จะสั่งให้กล้อง Bosch ต่อ ตอนกด "ส่งค่า MQTT เข้ากล้อง" — ไม่ตั้ง = คงที่อยู่เดิมในกล้อง (tag 1 ของ CONF_MQTT_SETTINGS)' }, // helpers/boschRcp.js pushMqttSettings
  EDGE_HEARTBEAT_STALE_SEC:     { type: 'int',  def: 180, doc: 'ไม่ได้ยิน heartbeat เกินนี้ = edge หลุด (วินาที)' },      // routes/health.js:641
  EDGE_IMAGE_RETENTION_DAYS:    { type: 'int',  def: undefined, doc: 'อายุภาพบน edge (วัน) — ไม่ตั้ง = ใช้ policy/7' },   // edge/bridge.js:42
  EDGE_MAX_PAYLOAD_BYTES:       { type: 'int',  def: 900000, doc: 'เพดานขนาดข้อความที่ edge publish ได้' },              // edge/publisher.js:26
  EDGE_MODE:                    { type: 'bool', def: false, doc: 'โหมด edge — publish ขึ้น MQTT แทนเขียน DB' },          // edge/publisher.js:22
  EDGE_MQTT_BROKER:             { type: 'str',  def: 'mqtt://localhost:1883', doc: 'broker ท้องถิ่นของ edge agent' },    // edge-config-agent.js:123
  EDGE_MQTT_REQUIRE_AUTH:       { type: 'bool', def: false, doc: 'LAN listener ของ Mosquitto บน edge บังคับ username/password — เปิดหลังกล้องทุกตัวต่อด้วย user แล้วเท่านั้น' }, // scripts/edge-render-mosquitto-conf.sh
  EDGE_OVERSIZED_DIR:           { type: 'str',  def: undefined, doc: 'โฟลเดอร์เก็บข้อความที่ใหญ่เกิน (default = data/oversized)' }, // edge/publisher.js:34
  EDGE_OVERSIZED_KEEP:          { type: 'int',  def: 50, doc: 'จำนวนไฟล์ oversized ที่เก็บไว้' },                        // edge/publisher.js:36
  EDGE_PRUNE_STALE_MS:          { type: 'int',  def: 10800000, doc: 'อายุ state ของ edge ที่ alert-engine ตัดทิ้ง (ms)' }, // alert-engine.js:567
  EDGE_SITE_CODE:               { type: 'str',  def: undefined, doc: 'รหัสไซต์ของ edge-config-agent' },                  // edge-config-agent.js:43
  EDGE_SITE_ID:                 { type: 'str',  def: 'edge', doc: 'site id ที่ใช้ประกอบ MQTT topic ของ edge' },          // edge/publisher.js:55
  EMQX_DASHBOARD_PASSWORD:      { type: 'str',  def: undefined, doc: 'รหัสผ่าน admin ของ EMQX dashboard API (ใช้เมื่อ BROKER_KIND=emqx เท่านั้น)' }, // helpers/emqxPublish.js:17
  EVENTS_COUNT_CAP:             { type: 'int',  def: 10000, doc: 'เพดานการนับผลลัพธ์ /api/events' },                     // routes/events.js:49
  FACETS_QUERY_TIMEOUT_MS:      { type: 'int',  def: 8000, doc: 'timeout ของ query facet' },                             // routes/events.js:381
  FACETS_WINDOW_DAYS:           { type: 'int',  def: 1, doc: 'ช่วงเวลาที่ facet ย้อนดู (วัน)' },                          // routes/events.js:426
  FACE_COUNT_ONLY_TIMEOUT_MS:   { type: 'int',  def: 12000, doc: 'timeout ของ query นับใบหน้าอย่างเดียว' },              // routes/faces.js:51
  FACE_COUNT_TIMEOUT_MS:        { type: 'int',  def: 500, doc: 'timeout ของการนับใบหน้าพร้อมผลลัพธ์' },                  // routes/faces.js:48
  FACE_MATCH_COUNT_TIMEOUT_MS:  { type: 'int',  def: 500, doc: 'timeout ของการนับ face match' },                         // routes/faces.js:838
  FACE_PUSH_ALLOW:              { type: 'list', def: '192.168.10.235', doc: 'IP กล้องที่ยอมให้ push ใบหน้าเข้ามา' },     // ingesters/hikvision-isapi.js:1313
  FACE_PUSH_BIND:               { type: 'str',  def: '192.168.10.31', doc: 'ที่อยู่ที่ face-push server bind' },          // ingesters/hikvision-isapi.js:1309
  FACE_PUSH_HOST:               { type: 'str',  def: '', doc: 'host ที่บอกกล้องให้ push มา (ว่าง = ไม่ตั้งค่าให้กล้อง)' }, // ingesters/hikvision-isapi.js:1318
  FACE_PUSH_PORT:               { type: 'int',  def: 3010, doc: 'พอร์ต face-push server' },                              // ingesters/hikvision-isapi.js:1310
  FACE_ROSTER_TTL_MS:           { type: 'int',  def: 60000, doc: 'อายุ cache ของ face roster' },                         // face-embed-worker.js:96
  FAS_MAX_BODY_BYTES:           { type: 'int',  def: 10485760, doc: 'เพดาน body ของ Alarm Server (bytes)' },             // ingesters/hikvision-isapi.js:1316
  FILES_HOST:                   { type: 'str',  def: '', doc: 'hostname เฉพาะสำหรับเสิร์ฟไฟล์ (ว่าง = ปิด)' },            // api-server.js:212
  FILES_PUBLIC_URL:             { type: 'str',  def: '', doc: 'URL สาธารณะของโฮสต์ไฟล์ (fallback ไป DASHBOARD_PUBLIC_URL)' }, // helpers/signedImage.js:109
  FR_PORT:                      { type: 'int',  def: 8791, doc: 'พอร์ตของ face engine (loopback)' },                     // lpr-receiver.js:649
  HCP_ACCOUNT_ID:               { type: 'str',  def: '38051848', doc: 'account id ของ HikCentral' },                     // hcp-client.js:30
  HCP_CAMERA_MAP:               { type: 'str',  def: undefined, doc: 'ไฟล์ map กล้อง HCP (default = src/hcp-camera-map.json)' }, // lpr-receiver.js:815
  HCP_DEVICES_FRESH_MS:         { type: 'int',  def: 60000, doc: 'อายุ cache รายการอุปกรณ์ HCP' },                       // routes/hcp.js:39
  HCP_HOST:                     { type: 'str',  def: '10.0.10.9', doc: 'HikCentral host' },                              // hcp-client.js:28
  HCP_LIVE_LOOKBACK_MIN:        { type: 'int',  def: 15, min: 1, doc: 'ช่วงย้อนหลังที่ดึง face match สด (นาที)' },        // ingesters/hcp-face-matches.js:440
  HCP_LIVE_POLL_SEC:            { type: 'int',  def: 60, min: 15, doc: 'คาบ poll face match สด (วินาที)' },              // ingesters/hcp-face-matches.js:439
  HCP_OPTIONAL:                 { type: 'list', def: '', doc: 'ความสามารถเสริมของ HCP ที่เปิด (คั่นคอมมา)' },            // helpers/hcpOptional.js:77
  HCP_PORT:                     { type: 'int',  def: 8443, doc: 'HikCentral port' },                                     // hcp-client.js:29
  HCP_SECRET_KEY_ENC:           { type: 'str',  def: undefined, doc: 'HCP app secret (เข้ารหัสไว้)' },                    // hcp-client.js:31
  INTERNAL_API_SECRET:          { type: 'str',  def: undefined, doc: 'token ภายใน api-server ↔ worker (X-Internal-Token)' }, // api-server.js:488
  KPI_STATS_FIRST_RUN_MS:       { type: 'int',  def: 45000, doc: 'หน่วงรอบแรกของ kpi refresher (ms)' },                  // kpi-stats-refresher.js:26
  KPI_STATS_LOOKBACK_HOURS:     { type: 'int',  def: 3, doc: 'ช่วงย้อนหลังที่ kpi คำนวณซ้ำ (ชม.)' },                      // kpi-stats-refresher.js:27
  KPI_STATS_RECONCILE_HOUR:     { type: 'int',  def: 5, doc: 'ชั่วโมง (0-23) ที่ kpi reconcile ย้อนหลังเท่าอายุตาราง' },  // kpi-stats-refresher.js
  KPI_STATS_REFRESH_MS:         { type: 'int',  def: 300000, doc: 'คาบ refresh kpi (ms)' },                              // kpi-stats-refresher.js:23
  KPI_STATS_RETENTION_DAYS:     { type: 'int',  def: 7, doc: 'อายุแถว kpi (วัน)' },                                      // kpi-stats-refresher.js:29
  LINE_FACE_FULL_FRAME:         { type: 'bool', def: false, doc: 'ส่งภาพเต็มเฟรมแทน crop ในแจ้งเตือนใบหน้า' },            // line-sender.js:915
  LONG_TX_ALERT_MIN:            { type: 'str',  def: '20 minutes', doc: 'อายุ transaction ที่ถือว่านานผิดปกติ (interval)' }, // helpers/longTxWatch.js:25
  LPR_BIND_HOST:                { type: 'str',  def: '0.0.0.0', doc: 'ที่อยู่ที่ lpr-receiver bind' },                    // lpr-receiver.js:924
  LPR_DIAG_CAMS:                { type: 'list', def: '', doc: 'กล้องที่เก็บ XML ดิบไว้ debug' },                          // lpr-core.js:225
  LPR_DIAG_DIR:                 { type: 'str',  def: undefined, doc: 'โฟลเดอร์เก็บ diag LPR (default = data/lpr-diag)' }, // lpr-core.js:226
  LPR_DIAG_EVERY_SEC:           { type: 'int',  def: 30, doc: 'เก็บ diag 1 ใบต่อกล้องต่อกี่วินาที' },                     // lpr-core.js:230
  LPR_DIAG_MAX_MB:              { type: 'int',  def: 500, doc: 'เพดานพื้นที่ diag LPR (MB)' },                           // lpr-core.js:231
  LPR_DIAG_WATCH:               { type: 'list', def: 'vehileSubLogoRecog,vehileModel', doc: 'ฟิลด์ที่เจอแล้วเก็บทันที (สะกดตามกล้อง)' }, // lpr-core.js:233
  LPR_FACE_DIR:                 { type: 'str',  def: null, doc: 'โฟลเดอร์เก็บภาพที่ classify ไม่ออก (null = ปิด)' },      // lpr-core.js:241
  LPR_FACE_MAX_MB:              { type: 'int',  def: 4000, doc: 'เพดานพื้นที่ภาพ face ของ LPR (MB)' },                   // lpr-core.js:242
  LPR_FACE_VEHICLE:             { type: 'str',  def: null, doc: 'เก็บเฉพาะรถชนิดนี้ (null = ทุกชนิด)' },                  // lpr-core.js:246
  LPR_PUSH_HOST:                { type: 'str',  def: undefined, doc: 'IP ที่บอกกล้อง ANPR ให้ push มา (ไม่ตั้ง = ใช้ localAddress)' }, // lpr-receiver.js:379
  LPR_RECEIVER_PORT:            { type: 'int',  def: 3003, doc: 'พอร์ต lpr-receiver' },                                  // lpr-receiver.js:45
  LPR_SCENE_CAMS:               { type: 'list', def: '', doc: 'กล้องที่เก็บภาพ scene เต็มเฟรมไว้ debug' },                // lpr-core.js:250
  LPR_SCENE_EVERY_SEC:          { type: 'int',  def: 60, doc: 'เก็บ scene 1 ใบต่อกล้องต่อกี่วินาที' },                    // lpr-core.js:251
  LPR_STATS_QUEUE_WAIT_MS:      { type: 'int',  def: 45000, doc: 'รอคิวสถิติ LPR หนักได้นานสุดกี่ ms ก่อนตอบ 503 busy' },   // routes/lpr-query.js
  LPR_WARM_FIRST_RUN_MS:        { type: 'int',  def: 180000, doc: 'หน่วงรอบแรกของการอุ่น cache LPR (ms)' },              // routes/lpr-query.js:1043
  LPR_WARM_MONTH_EVERY_MS:      { type: 'int',  def: 3600000, doc: 'คาบอุ่น cache LPR ช่วงเดือน (ms)' },                 // routes/lpr-query.js:1001
  LPR_WARM_WEEK_EVERY_MS:       { type: 'int',  def: 1800000, doc: 'คาบอุ่น cache LPR ช่วงสัปดาห์ (ms)' },               // routes/lpr-query.js:1006
  MAPBOX_TOKEN:                 { type: 'str',  def: '', doc: 'Mapbox token (fallback เมื่อไม่มีใน system_settings)' },   // routes/map.js:172
  META_CROP_MINPX:              { type: 'int',  def: 40, doc: 'ขนาดต่ำสุดของกรอบวัตถุที่ยอม crop (px)' },                 // edge-config-agent.js:162
  META_CROP_PAD:                { type: 'str',  def: '0.12', doc: 'ระยะเผื่อรอบกรอบวัตถุ (สัดส่วน, parseFloat ที่ call site)' }, // edge-config-agent.js:161
  META_SNAP_LAG_MS:             { type: 'int',  def: 0, doc: 'ชดเชยเวลาต่างระหว่าง metadata กับ snapshot (ms)' },         // edge-config-agent.js:182
  MQTT_BROKER_URL:              { type: 'str',  def: 'mqtt://127.0.0.1:1883', doc: 'broker ที่ publisher/bridge ต่อ (Central เองต่อ loopback ตัวนี้เมื่อ BROKER_KIND=mosquitto)' }, // edge/publisher.js:21
  MQTT_CAMERA_BROKER_HOST:      { type: 'str',  def: null, doc: 'LAN IP ของ broker ที่กล้องต่อเข้ามา (แสดงใน UI)' },      // routes/cameras.js:950
  MQTT_CLIENT_ID:               { type: 'str',  def: 'vigil-edge', doc: 'client id ฐานของ edge publisher' },             // edge/publisher.js:63
  MQTT_PROVISIONER_PASSWORD:    { type: 'str',  def: undefined, doc: 'รหัสผ่านบัญชี provisioner (สิทธิ์เฉพาะ $CONTROL/dynamic-security/# — BROKER_KIND=mosquitto เท่านั้น)' }, // helpers/brokerAdmin.js
  MQTT_PROVISIONER_USER:        { type: 'str',  def: undefined, doc: 'ผู้ใช้บัญชี provisioner ของ Mosquitto dynamic security (BROKER_KIND=mosquitto เท่านั้น)' }, // helpers/brokerAdmin.js
  MQTT_PUBLISHER_PASSWORD:      { type: 'str',  def: undefined, doc: 'รหัสผ่านบัญชี Central ที่ publish retained config ผ่าน MQTT (BROKER_KIND=mosquitto เท่านั้น)' }, // helpers/mqttPublisher.js
  MQTT_PUBLISHER_USER:          { type: 'str',  def: undefined, doc: 'ผู้ใช้บัญชี Central ที่ publish retained config ผ่าน MQTT (BROKER_KIND=mosquitto เท่านั้น)' }, // helpers/mqttPublisher.js
  MQTT_SUBSCRIBER_PASSWORD:     { type: 'str',  def: undefined, doc: 'รหัสผ่าน MQTT ของ subscriber/publisher' },          // edge/publisher.js:70
  MQTT_SUBSCRIBER_USER:         { type: 'str',  def: undefined, doc: 'ผู้ใช้ MQTT ของ subscriber/publisher' },            // edge/publisher.js:69
  NODE_ENV:                     { type: 'str',  def: undefined, doc: "'production' = บังคับกฎเข้มบางข้อ" },               // api-server.js:490
  NOREAD_CHECK_INTERVAL_MS:     { type: 'int',  def: 0, doc: 'override คาบยามตรวจ no-read (0 = ตามตารางปกติ)' },         // helpers/noreadCheck.js:131
  HELMET_METRIC_CHECK_INTERVAL_MS: { type: 'int', def: 0, doc: 'override คาบยามตรวจตัวเลขพร้อมข้อมูลทะเบียน (0 = ตามตารางปกติ)' }, // helpers/helmetMetricCheck.js
  PARTNER_HOST:                 { type: 'str',  def: '', doc: 'hostname เฉพาะของ partner API (ว่าง = ปิด)' },             // api-server.js:161
  PORT:                         { type: 'int',  def: 3000, doc: 'พอร์ตที่ยิงกลับหาตัวเองผ่าน loopback' },                 // helpers/signedImage.js:161
  PREVIEW_INTERVAL_MS:          { type: 'int',  def: 120000, doc: 'คาบส่งภาพ preview ของ edge agent (ms)' },             // edge-config-agent.js:1336
  PUBLIC_ORIGIN:                { type: 'str',  def: undefined, doc: 'origin สาธารณะ (ไม่ตั้ง = เดาจาก Host header)' },   // api-server.js:189
  RETAIN_REPLAY_GRACE_MS:       { type: 'int',  def: 5000, doc: 'ทิ้ง retained MQTT ทุกตัวในกี่ ms แรกหลัง (re)connect ของ edge agent' }, // edge-config-agent.js (retain gate)
  REPORT_BROWSER_IDLE_MS:       { type: 'int',  def: 300000, doc: 'ปิด Chromium เมื่อว่างเกินนี้ (ms)' },                 // report-renderer.js:224
  REPORT_RENDER_VIA_WORKER:     { type: 'bool', def: true, doc: 'เรนเดอร์รายงานผ่าน report-worker' },                    // helpers/renderViaWorker.js:43
  REPORT_WORKER_PORT:           { type: 'int',  def: 3001, doc: 'พอร์ต /render ของ report-worker (loopback)' },          // report-worker.js:72
  SD_POLL_INTERVAL_MS:          { type: 'int',  def: 3600000, doc: 'คาบอ่านสถานะ microSD ของกล้อง (ms)' },               // edge-config-agent.js:912
  SESSION_SECRET:               { type: 'str',  def: undefined, doc: 'HMAC key ของ session token' },                     // api-server.js:355
  SLOW_REQ_LOG_MS:              { type: 'int',  def: 2000, doc: 'log request ที่ช้ากว่านี้ (ms)' },                       // api-server.js:243
  SNAPSHOT_DIR:                 { type: 'str',  def: undefined, doc: 'โฟลเดอร์ snapshot (ไม่ตั้ง = ค่าในโค้ด)' },         // helpers/snapshotDir.js:29
  SNAPSHOT_PROXY_DOMAIN:        { type: 'str',  def: 'dojojin.tech', doc: 'โดเมนฐานของ edge proxy' },                    // api-server.js:1053
  SNAPSHOT_PROXY_SECRET:        { type: 'str',  def: '', doc: 'Bearer/HMAC key ของ edge proxy + ลิงก์ภาพเซ็นชื่อ' },      // helpers/signedImage.js:30
  SNAPSHOT_PROXY_URL:           { type: 'str',  def: undefined, doc: 'URL proxy ตรง (ใช้เมื่อไม่มี site code)' },         // api-server.js:1054
  SNAPSHOT_PUBLISHER_PASSWORD:  { type: 'str',  def: undefined, doc: 'รหัสผ่าน MQTT ของ ingester ที่ publish snapshot' }, // ingesters/hikvision-isapi.js:63
  SNAPSHOT_PUBLISHER_USER:      { type: 'str',  def: undefined, doc: 'ผู้ใช้ MQTT ของ ingester ที่ publish snapshot' },   // ingesters/hikvision-isapi.js:62
  SNAP_COOLDOWN_MS:             { type: 'int',  def: 3000, doc: 'เว้นระยะระหว่างการดึง snapshot ซ้ำ (ms)' },             // edge-config-agent.js:139
  SNAP_REFETCH_MIN_MS:          { type: 'int',  def: 1000, doc: 'ระยะต่ำสุดก่อนดึง snapshot ใหม่ (ms)' },                 // edge-config-agent.js:587
  STREAM_STALE_MS:              { type: 'int',  def: 300000, doc: 'สตรีมเงียบเกินนี้ = ตาย (ms)' },                      // helpers/streamWatchdog.js:28
  SUDO_USER:                    { type: 'str',  def: undefined, doc: 'ผู้ใช้ที่รัน sudo (ใช้แค่ทำ audit log ของ CLI)' },   // partner-admin.js:143
  TRAFFIC_STATS_FIRST_RUN_MS:   { type: 'int',  def: 135000, doc: 'หน่วงรอบแรกของ traffic refresher (ms)' },             // traffic-stats-refresher.js:26
  TRAFFIC_STATS_LOOKBACK_HOURS: { type: 'int',  def: 3, doc: 'ช่วงย้อนหลังที่ traffic คำนวณซ้ำ (ชม.)' },                  // traffic-stats-refresher.js:27
  TRAFFIC_STATS_RECONCILE_HOUR: { type: 'int',  def: 5, doc: 'ชั่วโมง (0-23) ที่ traffic reconcile ย้อนหลัง' },           // traffic-stats-refresher.js:54
  TRAFFIC_STATS_RECONCILE_HOURS:{ type: 'int',  def: 168, doc: 'traffic reconcile ย้อนหลังกี่ชั่วโมง' },                  // traffic-stats-refresher.js:39
  TRAFFIC_STATS_REFRESH_MS:     { type: 'int',  def: 900000, doc: 'คาบ refresh traffic (ms)' },                          // traffic-stats-refresher.js:24
  TRAFFIC_STATS_RETENTION_DAYS: { type: 'int',  def: 120, doc: 'อายุแถว traffic (วัน)' },                                // traffic-stats-refresher.js:28
  USER:                         { type: 'str',  def: undefined, doc: 'ผู้ใช้ระบบ (ใช้แค่ทำ audit log ของ CLI)' },         // partner-admin.js:143
  VCA_RULES_POLL_INTERVAL_MS:   { type: 'int',  def: 3600000, doc: 'คาบตรวจชื่อกฎ (IVA task) เกิน 64 byte ของกล้อง (ms)' }, // edge-config-agent.js
};

const SECRET_RE = /SECRET|PASSWORD|TOKEN|KEY|PASS/;
const isSecret = (name) => DEFS[name].secret === true || SECRET_RE.test(name);

const _warned = new Set();
function warnOnce(name, msg) {
  if (_warned.has(name)) return;
  _warned.add(name);
  console.warn(`[config] ${name}: ${msg}`);
}

function spec(name) {
  const d = DEFS[name];
  if (!d) throw new Error(`config: env "${name}" ไม่ได้ลงทะเบียนใน src/config.js DEFS`);
  return d;
}

/** ค่าดิบจาก environment — '' นับเป็นไม่ได้ตั้ง (ตรงกับสำนวน `env || default` เดิม) */
function raw(name) {
  spec(name);
  const v = process.env[name];
  return (v === undefined || v === '') ? undefined : v;
}

function str(name) {
  const v = raw(name);
  return v === undefined ? spec(name).def : v;
}

function int(name) {
  const d = spec(name);
  const v = raw(name);
  if (v === undefined) return d.def;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) { warnOnce(name, `"${v}" ไม่ใช่ตัวเลข — ใช้ค่า default ${d.def}`); return d.def; }
  if (d.min != null && n < d.min) { warnOnce(name, `${n} ต่ำกว่าขั้นต่ำ ${d.min} — ใช้ ${d.min}`); return d.min; }
  if (d.max != null && n > d.max) { warnOnce(name, `${n} สูงกว่าเพดาน ${d.max} — ใช้ ${d.max}`); return d.max; }
  return n;
}

const TRUE  = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off']);
function bool(name) {
  const d = spec(name);
  const v = raw(name);
  if (v === undefined) return d.def;
  const s = String(v).trim().toLowerCase();
  if (TRUE.has(s)) return true;
  if (FALSE.has(s)) return false;
  warnOnce(name, `"${v}" ไม่ใช่ค่า boolean — ใช้ค่า default ${d.def}`);
  return d.def;
}

function list(name) {
  return String(str(name) || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** ชุด config ของ pg Pool/Client — เหมือนกันทั้ง 16 จุดที่เคยพิมพ์ซ้ำ */
function db() {
  return {
    host:     str('DB_HOST'),
    port:     int('DB_PORT'),
    database: str('DB_NAME'),
    user:     str('DB_USER'),
    password: str('DB_PASSWORD'),
  };
}

const READ = { str, int, bool, list };

/** [{ name, value, source, masked }] — ค่า secret ถูกปิดบัง ใช้ log ตอน boot ได้ */
function summary() {
  return Object.keys(DEFS).map((name) => {
    const value = READ[DEFS[name].type](name);
    const masked = isSecret(name) && value !== undefined && value !== null && value !== '';
    return { name, value: masked ? '***' : value, source: raw(name) === undefined ? 'default' : 'env', masked };
  });
}

const names = () => Object.keys(DEFS);

module.exports = { DEFS, str, int, bool, list, db, summary, names, isSecret };
