// ============================================================
// Vigil Platform — Tests: edge/mosquitto.conf.template
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// E1a (docs/reports/2026-09-27_mosquitto-migration-plan.md §9), extended for
// §11 (E2 auth: listener_allow_anonymous per listener + global
// password_file/acl_file). Static checks on the template itself — the
// render script has its own coverage via a real run in
// scripts/edge-render-mosquitto-conf.sh (manually verified against
// mosquitto --test-config, see PR notes; not re-run here because it needs a
// real `mosquitto` binary, which CI doesn't carry).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const TEMPLATE_PATH = path.join(__dirname, '..', 'edge', 'mosquitto.conf.template');
const raw = fs.readFileSync(TEMPLATE_PATH, 'utf8');

function rendered(lanIp = '172.29.51.52', home = '/home/vss3', lanAnon = 'true') {
  return raw.replace(/<LAN_IP>/g, lanIp).replace(/<HOME>/g, home).replace(/<LAN_ANON>/g, lanAnon);
}

// Slices out just the block for one listener, so an assertion about
// "which value belongs to which listener" can't be fooled by counting.
function listenerBlock(out, listenerLine) {
  const start = out.indexOf(listenerLine);
  assert.ok(start >= 0, `listener line not found: ${listenerLine}`);
  const next = out.indexOf('\nlistener ', start + 1);
  return out.slice(start, next === -1 ? out.indexOf('\n\n', start) : next);
}

describe('edge/mosquitto.conf.template', () => {
  test('has exactly the three known placeholders', () => {
    assert.match(raw, /<LAN_IP>/);
    assert.match(raw, /<HOME>/);
    assert.match(raw, /<LAN_ANON>/);
  });

  test('rendering replaces every placeholder — none left over', () => {
    const out = rendered();
    assert.ok(!/<[A-Z_]+>/.test(out), `placeholder left unreplaced: ${(out.match(/<[A-Z_]+>/) || [''])[0]}`);
  });

  test('does not open a websocket (8083) or HTTP admin (8081) listener', () => {
    assert.ok(!/\b8083\b/.test(raw), 'template must not open the websocket port');
    assert.ok(!/\b8081\b/.test(raw), 'template must not open the HTTP admin port');
  });

  test('persistence lives under the rendered HOME, not a package default path', () => {
    const out = rendered('172.29.51.52', '/home/vss3');
    assert.match(out, /^persistence_location \/home\/vss3\/\.local\/mosquitto\/$/m);
    assert.ok(!/persistence_location \/var\/lib\/mosquitto/.test(out));
  });

  test('no pid_file directive (pm2 runs it in the foreground)', () => {
    assert.ok(!/^\s*pid_file\b/m.test(raw));
  });

  test('logs to stdout, not a package-owned log file', () => {
    assert.match(raw, /^log_dest stdout$/m);
    assert.ok(!/^log_dest file\b/m.test(raw));
  });

  test('no deprecated per_listener_settings — listener_allow_anonymous per listener instead', () => {
    assert.ok(!/^\s*per_listener_settings\b/m.test(raw), 'per_listener_settings is deprecated in 2.1, removed in 3.0');
    assert.ok(!/^\s*allow_anonymous\b/m.test(raw), 'must use listener_allow_anonymous, not the bare directive');
  });

  test('both listeners bind to 1883, on 127.0.0.1 and <LAN_IP>', () => {
    const out = rendered('172.29.51.52', '/home/vss3');
    assert.match(out, /^listener 1883 127\.0\.0\.1$/m);
    assert.match(out, /^listener 1883 172\.29\.51\.52$/m);
  });

  test('loopback listener is always anonymous, regardless of <LAN_ANON>', () => {
    for (const lanAnon of ['true', 'false']) {
      const out = rendered('172.29.51.52', '/home/vss3', lanAnon);
      const block = listenerBlock(out, 'listener 1883 127.0.0.1');
      assert.match(block, /^listener_allow_anonymous true$/m, `loopback must stay anonymous even when LAN_ANON=${lanAnon}`);
    }
  });

  test('LAN listener anonymity follows the rendered <LAN_ANON> value independently of loopback', () => {
    for (const lanAnon of ['true', 'false']) {
      const out = rendered('172.29.51.52', '/home/vss3', lanAnon);
      const block = listenerBlock(out, 'listener 1883 172.29.51.52');
      assert.match(block, new RegExp(`^listener_allow_anonymous ${lanAnon}$`, 'm'));
    }
  });

  test('password_file / acl_file are global (not inside a listener block), pointing under <HOME>/.config/vigil', () => {
    const out = rendered('172.29.51.52', '/home/vss3');
    assert.match(out, /^password_file \/home\/vss3\/\.config\/vigil\/mosquitto\.passwd$/m);
    assert.match(out, /^acl_file \/home\/vss3\/\.config\/vigil\/mosquitto\.acl$/m);
    // global = outside both listener blocks
    const lanBlock = listenerBlock(out, 'listener 1883 172.29.51.52');
    assert.ok(!lanBlock.includes('password_file'), 'password_file must be global, not nested under the LAN listener');
  });

  test('queue limits present (guards edge-bridge replay through short outages)', () => {
    assert.match(raw, /^max_queued_messages 10000$/m);
    assert.match(raw, /^max_inflight_messages 100$/m);
  });

  test('no bridge block — bridging is the edge-bridge pm2 process, not Mosquitto built-in bridging', () => {
    assert.ok(!/^\s*connection\s+\S/m.test(raw));
    assert.ok(!/^\s*address\s+\S/m.test(raw));
  });
});
