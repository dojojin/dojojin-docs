// ============================================================
// Vigil Platform — Tests: cameraMqttRegistry (push-mqtt wait mechanism)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// Same register/resolve/get shape as scanRegistry.js/purgeRegistry.js — the
// one addition here is waitFor(), which lets POST /api/cameras/:id/push-mqtt
// await the MQTT round trip inline instead of handing the client a second
// GET to poll. mock.timers drives both setTimeout and Date so the 40s default
// timeout doesn't make this test actually take 40s.
'use strict';

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

// Fresh module per test — a shared module-level Map would let one test's
// register() bleed into another's.
function freshRegistry() {
  const p = require.resolve('../src/helpers/cameraMqttRegistry');
  delete require.cache[p];
  return require(p);
}

describe('cameraMqttRegistry.waitFor', () => {
  it('resolves as soon as resolve() lands, well inside the timeout', async () => {
    const registry = freshRegistry();
    registry.register('r1');
    const p = registry.waitFor('r1', 40_000);
    registry.resolve('r1', { ok: true, camera_id: 'BOSCH_8000i' });
    const e = await p;
    assert.equal(e.status, 'ready');
    assert.equal(e.data.camera_id, 'BOSCH_8000i');
  });

  it('reports an error result distinctly from a timeout', async () => {
    const registry = freshRegistry();
    registry.register('r2');
    const p = registry.waitFor('r2', 40_000);
    registry.resolve('r2', { error: 'not a bosch camera' });
    const e = await p;
    assert.equal(e.status, 'error');
    assert.equal(e.error, 'not a bosch camera');
  });

  it('times out and returns null when no reply lands — not an error', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const registry = freshRegistry();
      registry.register('r3');
      const p = registry.waitFor('r3', 5_000);
      mock.timers.tick(5_001);
      const e = await p;
      assert.equal(e, null, 'timeout must be null, not a fabricated {ok:false}');
    } finally { mock.timers.reset(); }
  });

  it('a late resolve after the wait already timed out is ignored, not a crash', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      const registry = freshRegistry();
      registry.register('r4');
      const p = registry.waitFor('r4', 5_000);
      mock.timers.tick(5_001);
      assert.equal(await p, null);
      // Arrives after the caller gave up — must not throw, and must not
      // resurrect a result nobody is reading anymore.
      assert.doesNotThrow(() => registry.resolve('r4', { ok: true }));
    } finally { mock.timers.reset(); }
  });

  it('get() on an unknown reqId is null, not a throw', () => {
    const registry = freshRegistry();
    assert.equal(registry.get('never-registered'), null);
  });
});
