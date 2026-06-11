// ============================================================
// Vigil Platform — Tests: alert-engine (pure functions)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Tests only matchRule + isInCooldown — both are pure (no DB/network).
// init() is NOT called; pool stays null.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { matchRule, isInCooldown } = require('../src/alert-engine');

describe('matchRule', () => {
  describe('camera_ids filter', () => {
    it('empty camera_ids matches any camera', () => {
      const rule  = { camera_ids: [], rule_names: [] };
      const event = { camera_id: 'cam-1', rule_name: 'Motion' };
      assert.equal(matchRule(rule, event), true);
    });

    it('null camera_ids matches any camera', () => {
      const rule  = { camera_ids: null, rule_names: null };
      const event = { camera_id: 'cam-1', rule_name: 'Motion' };
      assert.equal(matchRule(rule, event), true);
    });

    it('camera_ids includes event.camera_id → match', () => {
      const rule  = { camera_ids: ['cam-1', 'cam-2'], rule_names: [] };
      const event = { camera_id: 'cam-1', rule_name: 'Motion' };
      assert.equal(matchRule(rule, event), true);
    });

    it('camera_ids does NOT include event.camera_id → no match', () => {
      const rule  = { camera_ids: ['cam-3'], rule_names: [] };
      const event = { camera_id: 'cam-1', rule_name: 'Motion' };
      assert.equal(matchRule(rule, event), false);
    });
  });

  describe('rule_names filter', () => {
    it('empty rule_names matches any rule name', () => {
      const rule  = { camera_ids: [], rule_names: [] };
      const event = { camera_id: 'cam-1', rule_name: 'Intrusion' };
      assert.equal(matchRule(rule, event), true);
    });

    it('rule_names includes event.rule_name → match', () => {
      const rule  = { camera_ids: [], rule_names: ['Intrusion', 'Motion'] };
      const event = { camera_id: 'cam-1', rule_name: 'Intrusion' };
      assert.equal(matchRule(rule, event), true);
    });

    it('rule_names does NOT include event.rule_name → no match', () => {
      const rule  = { camera_ids: [], rule_names: ['Motion'] };
      const event = { camera_id: 'cam-1', rule_name: 'Intrusion' };
      assert.equal(matchRule(rule, event), false);
    });
  });

  describe('combined filters', () => {
    it('both camera_ids and rule_names must match', () => {
      const rule  = { camera_ids: ['cam-1'], rule_names: ['Motion'] };
      assert.equal(matchRule(rule, { camera_id: 'cam-1', rule_name: 'Motion' }),    true);
      assert.equal(matchRule(rule, { camera_id: 'cam-2', rule_name: 'Motion' }),    false);
      assert.equal(matchRule(rule, { camera_id: 'cam-1', rule_name: 'Intrusion' }), false);
    });
  });
});

describe('isInCooldown', () => {
  it('no last_triggered_at → not in cooldown', () => {
    const rule = { last_triggered_at: null, cooldown_seconds: 60 };
    assert.equal(isInCooldown(rule), false);
  });

  it('triggered 10s ago with 30s cooldown → still in cooldown', () => {
    const rule = {
      last_triggered_at: new Date(Date.now() - 10_000).toISOString(),
      cooldown_seconds: 30,
    };
    assert.equal(isInCooldown(rule), true);
  });

  it('triggered 60s ago with 30s cooldown → cooldown expired', () => {
    const rule = {
      last_triggered_at: new Date(Date.now() - 60_000).toISOString(),
      cooldown_seconds: 30,
    };
    assert.equal(isInCooldown(rule), false);
  });

  it('cooldown_seconds = 0 → never in cooldown', () => {
    const rule = {
      last_triggered_at: new Date(Date.now() - 500).toISOString(),
      cooldown_seconds: 0,
    };
    assert.equal(isInCooldown(rule), false);
  });
});
