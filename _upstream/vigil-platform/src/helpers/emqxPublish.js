// ============================================================
// Vigil Platform — Helper: EMQX one-shot publish
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Publish a single message to the central broker (same login+publish path
// publishSiteConfig uses for the config push). Used for the NVR scan request
// central→edge — the edge-bridge relays projects/{site}/_config/* down to the
// edge's local broker, so the edge-config-agent receives it.
//
// Name and signature kept unchanged (6 call sites: routes/cameras.js,
// routes/storage.js, routes/health.js, routes/cameras-probe.js) — the body now
// delegates to helpers/brokerAdmin.js, which picks EMQX HTTP or Mosquitto MQTT
// by BROKER_KIND. In emqx mode the HTTP request is byte-identical to before
// this file was rewired (see src/helpers/brokerAdmin.js _emqxPublish).
// ------------------------------------------------------------
'use strict';

const brokerAdmin = require('./brokerAdmin');

module.exports = async function emqxPublish(topic, payloadObj, { qos = 1, retain = false } = {}) {
  return brokerAdmin.publish(topic, payloadObj, { qos, retain });
};
