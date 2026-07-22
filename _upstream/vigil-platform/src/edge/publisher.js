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

const BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const EDGE_MODE  = process.env.EDGE_MODE === '1' || process.env.EDGE_MODE === 'true';
const SITE_ID    = process.env.EDGE_SITE_ID || 'edge';

let _client = null;

// Lazy singleton — connect on first publish. mqtt.js buffers outgoing
// messages while offline and flushes on (re)connect.
function client() {
  if (_client) return _client;
  const clientId = `${process.env.MQTT_CLIENT_ID || 'vigil-edge'}-${process.pid}`;
  _client = mqtt.connect(BROKER_URL, {
    clientId,
    clean: true,
    reconnectPeriod: 2000,
    connectTimeout: 10_000,
    username: process.env.MQTT_SUBSCRIBER_USER || undefined,
    password: process.env.MQTT_SUBSCRIBER_PASSWORD || undefined,
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
  // QoS 1 — at-least-once to survive bridge/broker hiccups.
  client().publish(topic, JSON.stringify(payload), { qos: 1, retain: false }, (err) => {
    if (err) console.error(`  ❌ edge publish [${topic}]:`, err.message);
  });
  return correlation;
}

module.exports = { EDGE_MODE, publishEdgeEvent, newCorrId };
