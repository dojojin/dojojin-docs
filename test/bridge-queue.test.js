// ============================================================
// Vigil Platform — Tests: edge bridge disk queue
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// The first test here is the vss incident of 2026-07-31, reduced: a replay that
// is interrupted after some messages are confirmed, then resumed. The old code
// re-sent the confirmed ones on every resume — five rounds, 651 duplicate rows,
// one event delivered nine times. These pin that a confirmed message is gone
// for good and an unconfirmed one is kept exactly once.
// ============================================================
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { drainOrphanedReplay, replay, tempDirFor } = require('../src/edge/bridgeQueue');

let root, queueDir;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-'));
  queueDir = path.join(root, 'bridge-queue');
  fs.mkdirSync(queueDir, { recursive: true });
});
afterEach(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

// Filenames are timestamp-ordered in production; zero-padded here so sort() is
// the same order they were written in.
function seed(n, prefix = 'm') {
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(queueDir, `${String(i).padStart(4, '0')}-${prefix}.json`),
      JSON.stringify({ topic: `t/${prefix}${i}`, payload: Buffer.from(`body-${prefix}${i}`).toString('base64') }));
  }
}
const queued = () => fs.readdirSync(queueDir).sort();

describe('bridge queue replay', () => {
  it('delivers every message once and leaves nothing behind', async () => {
    seed(5);
    const seen = [];
    const r = await replay(queueDir, async (topic, buf) => { seen.push([topic, buf.toString()]); return true; });
    assert.deepEqual({ ...r }, { sent: 5, requeued: 0, total: 5, timedOut: 0 });
    assert.equal(queued().length, 0);
    assert.equal(fs.existsSync(tempDirFor(queueDir)), false, 'replay dir removed when fully drained');
    assert.deepEqual([...seen.map(x => x[0])], ['t/m0', 't/m1', 't/m2', 't/m3', 't/m4']);
    assert.equal(seen[0][1], 'body-m0', 'payload survives the base64 round trip');
  });

  // The regression. Interrupt mid-batch, recover, resume — and count how many
  // times the broker was handed each message across the whole episode.
  it('never re-sends a message the broker already confirmed', async () => {
    seed(6);
    const delivered = [];
    // The broker stops confirming after three, the way the link went at vss.
    // replay() treats that as unsent rather than throwing, so the run finishes;
    // what matters is the state it leaves on disk.
    const r1 = await replay(queueDir, async (topic) => {
      if (delivered.length >= 3) return false;
      delivered.push(topic);
      return true;
    });
    assert.equal(r1.sent, 3, 'three were confirmed');
    assert.equal(r1.requeued, 3, 'and exactly the other three are pending — not all six');
    assert.equal(queued().length, 3);

    // Startup recovery, then resume.
    drainOrphanedReplay(queueDir);
    const r2 = await replay(queueDir, async (topic) => { delivered.push(topic); return true; });
    assert.equal(r2.sent, 3, 'the resume sends only what was left');
    assert.equal(delivered.length, 6, 'six messages, six deliveries — no duplicates');
    assert.equal(new Set(delivered).size, 6);
    assert.equal(queued().length, 0);
  });

  it('keeps an unconfirmed message exactly once, in one place', async () => {
    seed(3);
    const r = await replay(queueDir, async (topic) => topic !== 't/m1');   // middle one refuses
    assert.deepEqual({ ...r }, { sent: 2, requeued: 1, total: 3, timedOut: 0 });
    assert.deepEqual([...queued()], ['0001-m.json'], 'the failed one is back in the queue');
    assert.equal(fs.existsSync(tempDirFor(queueDir)), false, 'and not also left in the replay dir');
  });

  it('does not sweep messages that arrive mid-replay into the current batch', async () => {
    seed(2);
    let extra = false;
    await replay(queueDir, async (topic) => {
      if (!extra) { extra = true; seed(1, 'late'); }   // a new event lands while draining
      return true;
    });
    assert.deepEqual([...queued()], ['0000-late.json'], 'the new arrival waits for the next run');
  });

  it('drops a corrupt file rather than blocking every future replay', async () => {
    seed(2);
    fs.writeFileSync(path.join(queueDir, '9999-bad.json'), 'not json at all');
    const r = await replay(queueDir, async () => true);
    assert.equal(r.sent, 2);
    assert.equal(queued().length, 0, 'the unreadable file cannot wedge the queue');
  });

  it('recovers an orphaned replay dir and reports how many', () => {
    const tempDir = tempDirFor(queueDir);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, '0001-m.json'), '{}');
    fs.writeFileSync(path.join(tempDir, '0002-m.json'), '{}');
    assert.equal(drainOrphanedReplay(queueDir), 2);
    assert.deepEqual([...queued()], ['0001-m.json', '0002-m.json']);
    assert.equal(fs.existsSync(tempDir), false);
    assert.equal(drainOrphanedReplay(queueDir), 0, 'nothing to recover on a normal start');
  });

  // The second vss bug, and the worse one: mqtt.js calls the publish callback
  // only on PUBACK, so a socket that dies mid-flight never settles the promise.
  // The batch stalls forever, the caller's in-progress guard never clears, and
  // no replay runs again — four days and 835 undelivered messages at vss with
  // nothing in the log after "replaying 348".
  it('gives up on a publish that never answers, and finishes the batch', async () => {
    seed(3);
    const started = [];
    const r = await replay(queueDir, (topic) => {
      started.push(topic);
      if (topic === 't/m1') return new Promise(() => {});   // never settles
      return Promise.resolve(true);
    }, { timeoutMs: 60 });
    assert.equal(started.length, 3, 'the hung message does not stop the ones after it');
    assert.equal(r.sent, 2);
    assert.equal(r.timedOut, 1);
    assert.deepEqual([...queued()], ['0001-m.json'], 'and it is kept for the next attempt');
  });

  // hkt / hdy 2026-10-17: a .replay dir left behind by an earlier run made the
  // queue→.replay rename fail, so every replay after it returned 0/0 ("replaying
  // 4104 queued msgs" → "replay done replayed=0/0" once a minute) until a restart.
  it('does not stall at 0/0 when an earlier run left files in the replay dir', async () => {
    seed(2, 'new');
    const tempDir = tempDirFor(queueDir);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, '0000-old.json'),
      JSON.stringify({ topic: 't/old', payload: Buffer.from('old').toString('base64') }));
    const seen = [];
    const r = await replay(queueDir, async (topic) => { seen.push(topic); return true; });
    assert.deepEqual(seen.sort(), ['t/new0', 't/new1', 't/old']);
    assert.equal(r.sent, 3);
    assert.deepEqual([...queued()], []);
    assert.equal(fs.existsSync(tempDir), false);
  });

  // forceReconnect() used to clear the in-progress flag while the old loop kept
  // running; the next connect started a second replay over the same files.
  // shouldStop lets the caller end the old run: what it has not tried goes back.
  it('stops early when asked and returns the untried messages to the queue', async () => {
    seed(4);
    let n = 0;
    const r = await replay(queueDir, async () => { n++; return true; }, { shouldStop: () => n >= 2 });
    assert.equal(r.sent, 2);
    assert.equal(r.stopped, 2);
    assert.deepEqual([...queued()], ['0002-m.json', '0003-m.json']);
    assert.equal(fs.existsSync(tempDirFor(queueDir)), false);
  });

  it('handles an empty or missing queue without throwing', async () => {
    assert.deepEqual({ ...(await replay(queueDir, async () => true)) }, { sent: 0, requeued: 0, total: 0, timedOut: 0 });
    fs.rmSync(queueDir, { recursive: true, force: true });
    assert.deepEqual({ ...(await replay(queueDir, async () => true)) }, { sent: 0, requeued: 0, total: 0, timedOut: 0 });
  });
});
