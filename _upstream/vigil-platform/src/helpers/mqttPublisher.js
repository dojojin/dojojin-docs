// ============================================================
// Vigil Platform — Helper: mqttPublisher (single long-lived MQTT client)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// One MQTT connection Central keeps open to publish retained site config /
// one-shot commands — used by brokerAdmin.js's mosquitto backend in place of
// EMQX's HTTP /publish (plan §1 item 2, §4). Connects with MQTT_PUBLISHER_*
// (a Central-only account — see BROKER_KIND=mosquitto docs in src/config.js).
//
// Does NOT let mqtt.js queue a publish while disconnected: a caller like
// reboot-device / storage-purge / delete-media that gets an error back must
// actually have failed, not be sitting in an internal queue to land minutes
// later on reconnect (a silent behavior change from today's HTTP path, which
// fails fast the same way). publish() rejects immediately if not connected.
//
// require('mqtt') is lazy (inside connect()) so BROKER_KIND=emqx never loads
// or connects this module's dependency at all.
// ============================================================
'use strict';

const env = require('../config');

let _client = null;
let _connectPromise = null;

function _connect() {
  if (_connectPromise) return _connectPromise;
  const user = env.str('MQTT_PUBLISHER_USER');
  const pass = env.str('MQTT_PUBLISHER_PASSWORD');
  if (!user || !pass) return Promise.reject(new Error('MQTT_PUBLISHER_USER/PASSWORD not set'));
  const mqtt = require('mqtt');
  const client = mqtt.connect(env.str('MQTT_BROKER_URL'), {
    username: user, password: pass, clean: true,
    clientId: `vigil-central-pub-${process.pid}`,
    reconnectPeriod: 2000, connectTimeout: 8000,
  });
  client.on('error', (e) => console.warn('[mqttPublisher] error:', e.message));
  _client = client;
  _connectPromise = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('mqttPublisher connect timeout')), 8000);
    client.once('connect', () => { clearTimeout(to); resolve(client); });
    client.once('error', (e) => { clearTimeout(to); reject(e); });
  });
  _connectPromise.catch(() => { _connectPromise = null; }); // allow retry on next call
  return _connectPromise;
}

/** publishRaw(topic, payload, {qos=1, retain=false}) — payload sent as-is (string/Buffer).
 * A zero-length retained payload is how MQTT clears a retained topic. */
async function publishRaw(topic, payload, { qos = 1, retain = false } = {}) {
  const client = await _connect();
  if (!client.connected) throw new Error('mqttPublisher not connected — refusing to queue publish');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mqttPublisher publish ack timeout')), 8000);
    client.publish(topic, payload, { qos, retain }, (err) => {
      clearTimeout(timer);
      if (err) return reject(err);
      resolve();
    });
  });
}

/** publish(topic, obj, {qos=1, retain=false}) — resolves on PUBACK for qos 1. */
async function publish(topic, obj, opts) {
  return publishRaw(topic, JSON.stringify(obj), opts);
}

module.exports = { publish, publishRaw };
