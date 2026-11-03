// ============================================================
// Vigil Platform — Edge bridge: disk queue lifecycle
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Split out of bridge.js so it can be tested: that file opens MQTT connections
// at require time, which meant the one piece of logic that decides whether an
// event is delivered once or nine times had no test at all.
//
// It had a bug worth the split. replay() used to read the whole batch, publish
// each message, and delete the directory in one go at the end. Any restart part
// way through left every file on disk — including the ones already confirmed by
// PUBACK — and startup recovery put all of them back in the queue. At Phuket's
// vss site on 2026-07-31 that ran five times in a row and the batch never
// shrank:
//
//   12:10  replaying 96      (no "replay done" — process died)
//   17:25  recovered 96  →  replaying 281
//   17:45  recovered 281 →  replaying 293
//   17:53  recovered 293 →  replaying 301
//   18:19  recovered 301 →  replaying 340
//
// 651 duplicate rows reached the database, one event arriving nine times, and
// the delivery timestamps in events matched those log lines to the second.
//
// So: a message leaves the disk the instant it is confirmed, and a message that
// fails moves back to the queue rather than being copied there. Either way it
// exists in exactly one place at all times, and an interruption can only ever
// re-send what was genuinely unconfirmed.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const tempDirFor = (queueDir) => queueDir + '.replay';

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

/**
 * Move anything left in the replay directory by an interrupted run back into
 * the queue. Called once at startup — with per-file unlink below, whatever is
 * still here is exactly the set that was never confirmed.
 */
function drainOrphanedReplay(queueDir) {
  const tempDir = tempDirFor(queueDir);
  let files;
  try { files = fs.readdirSync(tempDir); } catch { return 0; }
  if (!files.length) { try { fs.rmdirSync(tempDir); } catch {} return 0; }
  ensureDir(queueDir);
  let moved = 0;
  for (const f of files) {
    try { fs.renameSync(path.join(tempDir, f), path.join(queueDir, f)); moved++; } catch {}
  }
  try { fs.rmdirSync(tempDir); } catch {}
  return moved;
}

/**
 * Publish every queued message once.
 *
 * @param queueDir  directory holding one JSON file per pending message
 * @param publish   async (topic, buf) => boolean — true once the broker has
 *                  confirmed it. Anything falsy (or a throw) counts as unsent.
 * @param opts.timeoutMs  give up waiting for a confirmation after this long.
 *
 * The timeout is not a nicety. mqtt.js only calls the publish callback on
 * PUBACK, and if the socket dies mid-flight that callback never fires at all —
 * the await never settles, the caller's in-progress guard never clears, and no
 * replay ever runs again. vss sat like that from 2026-08-01 to 08-05: four days,
 * 835 messages on disk, not one delivery attempt, and nothing in the log after
 * the "replaying 348" line to say so.
 *
 * @returns {{sent:number, requeued:number, total:number, timedOut:number}}
 */
async function replay(queueDir, publish, { timeoutMs = 20_000, shouldStop = () => false } = {}) {
  const none = { sent: 0, requeued: 0, total: 0, timedOut: 0 };
  // ของที่รอบก่อนทิ้งค้างใน .replay ต้องกลับเข้าคิวก่อน — ไม่งั้น rename ด้านล่างล้มแล้วคืน 0/0 ทุกนาที
  // จน restart (hkt/hdy 2026-10-17) · ปลอดภัยเพราะ bridge.js รันได้ทีละรอบ (replaying + shouldStop)
  drainOrphanedReplay(queueDir);
  let files;
  try { files = fs.readdirSync(queueDir).sort(); } catch { return none; }
  if (!files.length) return none;

  const tempDir = tempDirFor(queueDir);
  // Rename the whole directory aside so messages arriving mid-replay land in a
  // fresh queue and are not swept into this batch.
  try { fs.renameSync(queueDir, tempDir); } catch { return none; }
  ensureDir(queueDir);

  let sent = 0, requeued = 0, timedOut = 0, stopped = 0;
  for (const f of files) {
    const src = path.join(tempDir, f);
    if (shouldStop()) {
      try { fs.renameSync(src, path.join(queueDir, f)); stopped++; } catch {}
      continue;
    }
    let msg;
    try {
      const { topic, payload } = JSON.parse(fs.readFileSync(src, 'utf8'));
      msg = { topic, buf: Buffer.from(payload, 'base64') };
    } catch {
      // Unreadable file: dropping it is the only option that terminates, and
      // keeping it would make every future replay fail on the same file.
      try { fs.unlinkSync(src); } catch {}
      continue;
    }
    let ok = false, timer;
    try {
      ok = await Promise.race([
        publish(msg.topic, msg.buf),
        new Promise((r) => { timer = setTimeout(() => r('timeout'), timeoutMs); }),
      ]);
    } catch { ok = false; }
    clearTimeout(timer);
    if (ok === 'timeout') { timedOut++; ok = false; }
    if (ok) {
      // The whole point. Confirmed means gone, immediately — not at the end of
      // a batch that might not have an end.
      try { fs.unlinkSync(src); } catch {}
      sent++;
    } else {
      // Moved, not copied: the message must never exist in two places.
      try { fs.renameSync(src, path.join(queueDir, f)); requeued++; } catch {}
    }
  }
  try { fs.rmdirSync(tempDir); } catch {}   // only succeeds when genuinely empty
  return { sent, requeued, total: files.length, timedOut, ...(stopped ? { stopped } : {}) };
}

module.exports = { drainOrphanedReplay, replay, tempDirFor };
