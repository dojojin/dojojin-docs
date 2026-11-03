// ============================================================
// Vigil Platform — retain gate: live retained event vs replay-on-subscribe
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// GOTCHAS #103 — Bosch publishes FieldDetector/ObjectsInside retained, NanoMQ keeps
// the flag on live delivery, and the old blanket skip threw every live one away.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRetainGate } = require('../src/helpers/retainGate');

const T = 'BOSCH_3100i_02/onvif-ej/RuleEngine/FieldDetector/ObjectsInside';
const ev = (utc, inside) => Buffer.from(JSON.stringify({ UtcTime: utc, Data: { IsInside: inside } }));

/** gate with a clock we drive by hand */
function gateAt(graceMs = 5000) {
  let t = 1_000_000;
  const g = createRetainGate({ graceMs, now: () => t });
  return { g, tick: (ms) => { t += ms; }, at: () => t };
}

test('retained messages are dropped before the first connect', () => {
  const { g } = gateAt();
  assert.equal(g.skip(T, ev('2026-09-07T10:00:00Z', 'true')), true);
});

test('the burst right after connect is replay and is dropped', () => {
  const { g, tick } = gateAt(5000);
  g.ready();
  assert.equal(g.skip(T, ev('2026-09-07T10:00:00Z', 'true')), true);
  tick(4999);
  assert.equal(g.skip(T, ev('2026-09-07T10:00:01Z', 'false')), true);
});

test('after the grace window a live retained event passes', () => {
  const { g, tick } = gateAt(5000);
  g.ready();
  tick(5001);
  assert.equal(g.skip(T, ev('2026-09-07T10:00:02Z', 'true')), false);
});

test('the same payload repeated on one topic is replay, a changed one is not', () => {
  const { g, tick } = gateAt(5000);
  g.ready(); tick(6000);
  const first = ev('2026-09-07T10:00:02Z', 'true');
  assert.equal(g.skip(T, first), false);          // live
  assert.equal(g.skip(T, first), true);           // byte-identical → replay
  assert.equal(g.skip(T, ev('2026-09-07T10:00:04Z', 'false')), false);  // next state change
  assert.equal(g.skip(T, ev('2026-09-07T10:00:06Z', 'true')), false);   // and back again
});

test('two cameras do not shadow each other', () => {
  const { g, tick } = gateAt(5000);
  g.ready(); tick(6000);
  const a = 'CAM_A/onvif-ej/RuleEngine/FieldDetector/ObjectsInside';
  const b = 'CAM_B/onvif-ej/RuleEngine/FieldDetector/ObjectsInside';
  const payload = ev('2026-09-07T10:00:02Z', 'true');
  assert.equal(g.skip(a, payload), false);
  assert.equal(g.skip(b, payload), false);   // same bytes, different topic
  assert.equal(g.skip(a, payload), true);
});

test('reconnect re-opens the grace window and forgets old signatures', () => {
  const { g, tick } = gateAt(5000);
  g.ready(); tick(6000);
  const p = ev('2026-09-07T10:00:02Z', 'true');
  assert.equal(g.skip(T, p), false);
  g.ready();                                  // reconnect
  assert.equal(g.skip(T, p), true);           // inside the new grace window
  tick(6000);
  assert.equal(g.skip(T, p), false);          // memory was cleared, treated as live again
});

test('the topic memory is capped', () => {
  const { g, tick } = gateAt(5000);
  const small = createRetainGate({ graceMs: 0, max: 3, now: () => 2_000_000 });
  small.ready();
  for (let i = 0; i < 10; i++) small.skip(`CAM_${i}/x`, ev('t' + i, 'true'));
  assert.equal(small.stats().topics, 3);
  void g; void tick;
});

test('stats count each outcome', () => {
  const { g, tick } = gateAt(5000);
  g.skip(T, ev('a', 'true'));            // before connect
  g.ready();
  g.skip(T, ev('b', 'true'));            // in grace
  tick(6000);
  const p = ev('c', 'true');
  g.skip(T, p);                          // passed
  g.skip(T, p);                          // duplicate
  const s = g.stats();
  assert.equal(s.skippedGrace, 2);
  assert.equal(s.passed, 1);
  assert.equal(s.skippedDuplicate, 1);
});
