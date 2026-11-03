// ============================================================
// Vigil Platform — Edge Publisher
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Used by edge ingesters (hikvision-isapi.js, dahua-cgi.js, lpr-core.js,
// face-push.js) when EDGE_MODE=1. Instead of writing rows to a local Postgres
// (none on a Site Edge box), each ingester publishes a pre-normalized event row
// to the local NanoMQ broker, which bridges it up to the central EMQX.
//
// IMPORTANT — images NEVER travel over MQTT. Only metadata + a `_preview_ref`
// filename mapping is published; the image bytes stay buffered on local disk.
// See docs/LOGIC_edge-ingester-divergence.md for the full contract.
'use strict';
const mqtt   = require('mqtt');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const env    = require('../config');

const BROKER_URL = env.str('MQTT_BROKER_URL');
const EDGE_MODE  = env.bool('EDGE_MODE');

// เพดานของ central EMQX คือ 1MB (ยืนยันจาก `emqx ctl conf show mqtt`) · ตั้งต่ำกว่านั้น
// ไว้เผื่อ header ของ MQTT เอง และเผื่อ topic ยาว · ปรับได้ผ่าน env ถ้าย้าย broker
const MAX_PAYLOAD_BYTES = env.int('EDGE_MAX_PAYLOAD_BYTES');

// ข้อความที่ถูกด่านขนาดกันไว้ จะถูกเก็บไว้ที่นี่แทนการหายไปเฉย ๆ — ให้เปิดดูได้ว่า
// บั๊กที่ต้นทางคืออะไร · bridge นับไฟล์ในโฟลเดอร์นี้แล้วส่งขึ้น central ทุก 60 วิ
// (edge_status.bridge_dropped) ⇒ เห็นจากส่วนกลางโดยไม่ต้องเปิดล็อกของ edge
// export ออกไปให้ bridge.js ใช้ตัวเดียวกัน — ประกาศ path ซ้ำสองที่คือทางที่มันจะ
// drift แล้วตัวนับกับตัวเขียนมองคนละโฟลเดอร์โดยไม่มีใครรู้ (แบบเดียวกับ SNAPSHOT_DIR
// ใน GOTCHAS #131) · env override มีไว้ให้เทสต์แยกโฟลเดอร์กันได้ด้วย
const OVERSIZED_DIR = env.str('EDGE_OVERSIZED_DIR') || path.join(__dirname, '../../data/oversized');
// เพดานจำนวนไฟล์ — บั๊กที่ยิงรัวต้องไม่กินดิสก์ของ edge จนเต็ม ซึ่งจะหนักกว่าเดิม
const OVERSIZED_KEEP = env.int('EDGE_OVERSIZED_KEEP');

/** เก็บข้อความที่ส่งไม่ได้ลงดิสก์ · ห้าม throw เด็ดขาด — ปัญหาดิสก์ต้องไม่ล้ม ingest */
function _parkOversized(topic, body) {
  try {
    fs.mkdirSync(OVERSIZED_DIR, { recursive: true });
    const safe = topic.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
    fs.writeFileSync(path.join(OVERSIZED_DIR, `${Date.now()}-${safe}.json`), body);
    // เก็บเฉพาะใบล่าสุด — ชื่อไฟล์ขึ้นต้นด้วย epoch จึงเรียงตามเวลาได้ตรง ๆ
    const files = fs.readdirSync(OVERSIZED_DIR).sort();
    for (const f of files.slice(0, Math.max(0, files.length - OVERSIZED_KEEP))) {
      try { fs.unlinkSync(path.join(OVERSIZED_DIR, f)); } catch { /* ไฟล์หายไปเองก็ไม่เป็นไร */ }
    }
    return true;
  } catch (e) {
    console.error('  ⚠️  เก็บข้อความที่ใหญ่เกินไม่สำเร็จ:', e.message);
    return false;
  }
}
const SITE_ID    = env.str('EDGE_SITE_ID');

let _client = null;

// Lazy singleton — connect on first publish. mqtt.js buffers outgoing
// messages while offline and flushes on (re)connect.
function client() {
  if (_client) return _client;
  const clientId = `${env.str('MQTT_CLIENT_ID')}-${process.pid}`;
  _client = mqtt.connect(BROKER_URL, {
    clientId,
    clean: true,
    reconnectPeriod: 2000,
    connectTimeout: 10_000,
    username: env.str('MQTT_SUBSCRIBER_USER'),
    password: env.str('MQTT_SUBSCRIBER_PASSWORD'),
  });
  _client.on('connect', () => console.log(`  🔌 edge-publisher → ${BROKER_URL}`));
  _client.on('error', (e) => console.error('  ❌ edge-publisher MQTT:', e.message || e.code || e));
  return _client;
}

function newCorrId() {
  return crypto.randomUUID();
}

/**
 * Publish a pre-normalized event to local NanoMQ.
 *
 * @param {object} args
 * @param {string} args.vendor       'hikvision' | 'dahua' | 'lpr' | 'face'
 * @param {object} args.event        row matching the events table columns
 * @param {string} [args.corr]       correlation id (default: new uuid)
 * @param {string|null} [args.previewRef]   locally-buffered image filename
 * @param {string|null} [args.previewFull]  optional full-frame filename (face bg)
 * @param {string|null} [args.previewSource] snapshot source tag
 * @param {object|null} [args.appearance]   appearances-table row (face/body attrs)
 * @param {object|null} [args.licensePlate] license_plates-table row (LPR/ANPR)
 * @param {string}  [args.routeCategory]    topic category override
 * @param {object|null} [args.dedup]        { window_start } for NOT EXISTS guard
 * @param {object|null} [args.alert]        alert_event payload
 * @param {object|null} [args.clip]         event_for_clip payload
 * @returns {string} correlation id used
 */
function publishEdgeEvent({
  vendor, event, corr,
  previewRef = null, previewFull = null, previewLib = null, previewSource = null,
  appearance = null, licensePlate = null, routeCategory = null,
  dedup = null, alert = null, clip = null,
}) {
  const correlation = corr || newCorrId();
  const cat   = routeCategory || event.event_category;
  const topic = `projects/${SITE_ID}/${event.camera_id}/onvif-ej/${cat}/${event.event_type}`;
  const payload = {
    _edge: 1,
    _edge_vendor: vendor,
    _edge_corr: correlation,
    _preview_ref: previewRef,
    _preview_full: previewFull,
    _preview_lib: previewLib,
    _preview_source: previewSource,
    appearance,
    license_plate: licensePlate,
    event,
    dedup,
    alert,
    clip,
  };
  const body = JSON.stringify(payload);

  // ── ด่านขนาด — ห้ามข้อความที่ใหญ่เกินเพดานของ broker ออกจากเครื่องนี้ ──────
  // central EMQX ตั้ง max_packet_size = 1MB · ข้อความที่เกินไม่ได้ถูก "ปฏิเสธ"
  // เฉย ๆ แต่ทำให้ broker **ตัดการเชื่อมต่อทิ้ง** ⇒ ทุกครั้งที่คิวหมุนมาถึงใบนั้น
  // ลิงก์ทั้งเส้นล้ม แล้วข้อความดี ๆ ที่อยู่ในชุดเดียวกันก็ร่วงตามไปด้วย
  // (incident จริง 2026-08-14: 7 ใบพิษทำคิวของ vss ตายค้าง 2 สัปดาห์)
  //
  // ยอมทิ้ง 1 ข้อความที่ผิดรูป ดีกว่าปล่อยให้มันฆ่าลิงก์ของอีกหลักหมื่นข้อความ
  // และต้อง log ให้ดังพอที่จะเห็น เพราะการมาถึงบรรทัดนี้ = มีบั๊กที่ต้นทางเสมอ
  // (ภาพต้องอยู่บนดิสก์แล้วส่งแค่ชื่อไฟล์ — ดูหัวไฟล์ข้อ IMPORTANT)
  if (body.length > MAX_PAYLOAD_BYTES) {
    const big = Object.entries(payload)
      .map(([k, v]) => [k, v == null ? 0 : (typeof v === 'string' ? v.length : JSON.stringify(v).length)])
      .sort((a, b) => b[1] - a[1])[0];
    const parked = _parkOversized(topic, body);
    console.error(
      `  🔴 ข้อความใหญ่เกินเพดาน ไม่ส่งขึ้น central — ${(body.length / 1048576).toFixed(2)}MB ` +
      `(เพดาน ${(MAX_PAYLOAD_BYTES / 1048576).toFixed(2)}MB) topic=${topic} ` +
      `ฟิลด์ที่ใหญ่ที่สุด=${big?.[0]} ${(big?.[1] / 1024).toFixed(0)}KB · ` +
      (parked ? `เก็บไว้ที่ data/oversized/ แล้ว · ` : `เก็บลงดิสก์ไม่สำเร็จ · `) +
      `ภาพต้องอยู่บนดิสก์แล้วส่งเฉพาะชื่อไฟล์ (ดู publisher.js หัวข้อ IMPORTANT)`);
    return correlation;
  }

  // QoS 1 — at-least-once to survive bridge/broker hiccups.
  client().publish(topic, body, { qos: 1, retain: false }, (err) => {
    if (err) console.error(`  ❌ edge publish [${topic}]:`, err.message);
  });
  return correlation;
}


/**
 * ส่งสถานะกล้องขึ้น central — คนละเรื่องกับ event จึงแยก topic
 *
 * ใช้ `projects/{site}/_edge/camera-status` ซึ่งอยู่ใต้ prefix เดียวกับ heartbeat
 * ⇒ ทั้ง ACL ของ EMQX (`projects/<site>/#`), LOCAL_FILTER ของ bridge และ subscribe
 * ของ central (`projects/+/#`) ครอบให้อยู่แล้ว **ไม่ต้องแก้ ACL ใด ๆ**
 *
 * QoS 0 โดยตั้งใจ — สถานะเป็นค่าล่าสุดที่ทับของเก่าได้เสมอ ตกหล่นไป 1 ครั้งไม่เสียหาย
 * และไม่ควรไปเบียดคิวของ event ที่เป็น QoS 1 ตอนลิงก์สะดุด
 *
 * @param {string} cameraId
 * @param {object} patch  คอลัมน์ของ ingester_camera_status ที่จะอัปเดต
 */
function publishCameraStatus(cameraId, patch) {
  if (!cameraId || !patch || !Object.keys(patch).length) return;
  const topic = `projects/${SITE_ID}/_edge/camera-status`;
  const body = JSON.stringify({ camera_id: cameraId, patch, at: Date.now() });
  try {
    client().publish(topic, body, { qos: 0, retain: false }, (err) => {
      if (err) console.warn(`  ⚠️  ส่งสถานะกล้องไม่สำเร็จ [${cameraId}]:`, err.message);
    });
  } catch (e) {
    // สถานะเป็นข้อมูลเสริม — ห้ามทำให้ ingester ล้มเด็ดขาด
    console.warn(`  ⚠️  ส่งสถานะกล้องไม่สำเร็จ [${cameraId}]:`, e.message);
  }
}


/**
 * ปิดตัวส่งโดยรอให้ข้อความที่ค้างอยู่ถูกส่งจนหมดก่อน
 *
 * จำเป็นเฉพาะกับ ingester ที่ "รันแล้วจบ" — ตัวที่รันค้างไว้ (lpr-core, hikvision)
 * ไม่เคยเจอปัญหานี้เพราะไม่เคย exit · mqtt.connect() เชื่อมต่อแบบ async ดังนั้น
 * publish() ตามด้วย process.exit() ทันที = ข้อความหายเงียบ ๆ ทั้งหมด ไม่มี error
 * ไม่มี log แม้แต่บรรทัด "🔌 edge-publisher" (ยืนยันแล้วกับ HC1 backfill: ยิง 52
 * ข้อความ ถึงปลายทาง 0)
 *
 * end(false) = ไม่บังคับตัด รอ outgoing queue ว่างก่อน
 */
function closeEdgePublisher(timeoutMs = 15000) {
  if (!_client) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { _client = null; resolve(); };
    const t = setTimeout(() => {
      console.warn('  ⚠️  edge-publisher: ปิดไม่ทันใน ' + timeoutMs + 'ms — อาจมีข้อความค้าง');
      done();
    }, timeoutMs);
    _client.end(false, {}, () => { clearTimeout(t); done(); });
  });
}

module.exports = { EDGE_MODE, publishEdgeEvent, publishCameraStatus, newCorrId, closeEdgePublisher, OVERSIZED_DIR };
