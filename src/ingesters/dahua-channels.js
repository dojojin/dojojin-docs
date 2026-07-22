// ============================================================
// Vigil Platform — Dahua NVR channel enumeration (pure parser)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Parses the Dahua config-CGI text for a device's channel inventory. Shared by
// the edge scan handler (edge-config-agent) and the central direct-probe path.
//
//   GET /cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle
//     → table.ChannelTitle[0].Name=Front Gate
//       table.ChannelTitle[1].Name=Lobby
//       ...
//
// ⚠️ VERIFY-PENDING: the exact key layout can differ by NVR model/firmware.
// This targets the documented `table.ChannelTitle[N].Name=` shape; confirm
// against the live HDY NVR (172.17.22.10) output before relying on it, and
// widen the regex if that box returns a different layout.
// ------------------------------------------------------------
'use strict';

// text → [{ channel: <0-based int>, name: <string> }], sorted by channel.
function parseChannelTitles(text) {
  const out = new Map();
  const re = /^table\.ChannelTitle\[(\d+)\]\.Name=(.*)$/;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.trim().match(re);
    if (!m) continue;
    const channel = parseInt(m[1], 10);
    const name = m[2].trim();
    if (Number.isInteger(channel)) out.set(channel, { channel, name: name || `CH${channel + 1}` });
  }
  return [...out.values()].sort((a, b) => a.channel - b.channel);
}

// magicBox getProductDefinition → "...Channel=16..." → integer count (or null)
function parseChannelCount(text) {
  const m = String(text || '').match(/Channel\s*=\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

module.exports = { parseChannelTitles, parseChannelCount };

// ------------------------------------------------------------
// Self-check (node src/ingesters/dahua-channels.js)
// ------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');
  const sample = [
    'table.ChannelTitle[0].Name=Front Gate',
    'table.ChannelTitle[1].Name=Lobby',
    'table.ChannelTitle[10].Name=Car Park',
    'garbage line',
    'table.ChannelTitle[2].Name=',            // empty → CH3 fallback
  ].join('\n');
  const parsed = parseChannelTitles(sample);
  assert.strictEqual(parsed.length, 4, 'four channels parsed');
  assert.deepStrictEqual(parsed[0], { channel: 0, name: 'Front Gate' });
  assert.strictEqual(parsed[2].channel, 2, 'sorted numerically (not lexically)');
  assert.strictEqual(parsed[2].name, 'CH3', 'empty name → CH<n+1> fallback');
  assert.strictEqual(parsed[3].channel, 10, 'channel 10 after 2');
  assert.strictEqual(parseChannelCount('deviceType=NVR\nMaxChannel=16'), 16);
  assert.strictEqual(parseChannelCount('nope'), null);
  console.log('dahua-channels self-check OK');
}
