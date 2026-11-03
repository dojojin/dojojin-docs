// ============================================================
// Vigil Platform — Edge Camera Broker URL Validator
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// migration 248 — edge_status.camera_broker_url arrives over the edge
// heartbeat (payload from outside the process, mqtt-subscriber.js
// recordEdgeHeartbeat) so it must be validated before it ever reaches a
// query, not just trusted because it parsed as JSON.

const CAMERA_BROKER_URL_RE = /^mqtts?:\/\/[A-Za-z0-9.\-]+(:\d{1,5})?$/;

/**
 * @param {*} url  candidate camera_broker_url from an edge heartbeat
 * @returns {string|null} the url if it's a valid mqtt(s):// host[:port], else null
 */
function validCameraBrokerUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > 200) return null;
  return CAMERA_BROKER_URL_RE.test(url) ? url : null;
}

/**
 * @param {string} url  a value already passed by validCameraBrokerUrl
 * @returns {string|null} hostname, or null if somehow still unparseable
 */
function brokerHostname(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

module.exports = { validCameraBrokerUrl, brokerHostname, CAMERA_BROKER_URL_RE };
