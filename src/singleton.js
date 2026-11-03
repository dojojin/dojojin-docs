// ============================================================
// Vigil Platform — Single-instance guard
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// A PID-file lock so a background service (ingester / recorder /
// subscriber) cannot run twice. Call `singleton('<name>')` at the top
// of the service — if a LIVE instance already holds src/.run/<name>.pid
// the new copy logs and exits(1).
//
// This is the root-level guard against the "orphan process after
// several restarts" duplicate bug (a duplicate ingester double-inserts
// every event + doubles camera load). api-server does NOT need this —
// its :3000 bind already rejects a second copy.
//
// Notes:
// - Only a synchronous `process.on('exit')` cleanup is registered — it
//   removes the pid file when the process exits for any reason that
//   fires `exit`. We deliberately do NOT add SIGINT/SIGTERM listeners:
//   that would suppress the default "terminate on signal" behaviour for
//   services that don't run their own handler.
// - A SIGKILL (kill -9) leaves a stale pid file. Harmless — the live
//   check below self-heals it on next start.
// - `process.kill(pid, 0)` alone is NOT a good enough liveness probe on
//   Linux: it answers "alive" for a *thread id* too, and Node spawns
//   libuv worker threads whose tids land in the same low range that pids
//   are recycled from after a reboot. A stale pid file from before the
//   reboot then points at a live thread of an unrelated process and the
//   service refuses to start, forever (GOTCHAS #193, seen at vss:
//   lpr-receiver down 5h 40m, 451 restart attempts). On Linux we read
//   /proc instead: `Tgid == pid` proves it is a process rather than a
//   thread, and the cmdline proves it is one of ours rather than whoever
//   inherited the number.
// ============================================================

const fs = require('fs');
const path = require('path');

const RUN_DIR = path.join(__dirname, '.run');

/**
 * Does `pid` name a LIVE process that is one of our services?
 * Linux only — `read` is injectable so the /proc shapes can be tested.
 */
function procIsOurs(pid, name, read = (f) => fs.readFileSync(f, 'utf8')) {
  let status, cmdline;
  try {
    status  = read(`/proc/${pid}/status`);
    cmdline = read(`/proc/${pid}/cmdline`).replace(/\0/g, ' ');
  } catch { return false; }                                   // no such process
  const tgid = (status.match(/^Tgid:\s*(\d+)/m) || [])[1];
  if (tgid === undefined || Number(tgid) !== Number(pid)) return false;   // a thread, not a process
  return cmdline.includes(__dirname) || cmdline.includes(name);
}

function pidIsAlive(pid, name) {
  if (process.platform === 'linux') return procIsOurs(pid, name);
  // macOS / other: no /proc, keep the signal probe (dev machines only)
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

module.exports = singleton;
module.exports.procIsOurs = procIsOurs;   // exported for test/singleton.test.js

function singleton(name) {
  try { fs.mkdirSync(RUN_DIR, { recursive: true }); } catch { /* ignore */ }
  const pidFile = path.join(RUN_DIR, `${name}.pid`);

  // Is the lock already held by a LIVE process? → refuse to start.
  try {
    const existing = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isFinite(existing) && existing !== process.pid) {
      if (pidIsAlive(existing, name)) {
        console.error(`⛔ [${name}] another instance is already running (pid ${existing}).`);
        console.error(`   This copy will exit. Use scripts/services.sh restart to restart cleanly.`);
        process.exit(1);
      }
      // stale pid file — the process is gone, or the number now belongs to a
      // thread / someone else's process. Say so: a silent reclaim after a
      // reboot looks identical to a normal start, which is how #193 hid.
      console.warn(`[${name}] reclaiming stale lock (pid ${existing} is not a live ${name})`);
    }
  } catch { /* no / unreadable pid file — treat as a fresh start */ }

  // Claim the lock.
  try { fs.writeFileSync(pidFile, String(process.pid)); } catch { /* ignore */ }

  // Release on exit (sync — `exit` handlers must be synchronous).
  process.on('exit', () => {
    try {
      if (parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10) === process.pid) {
        fs.unlinkSync(pidFile);
      }
    } catch { /* ignore */ }
  });
}
