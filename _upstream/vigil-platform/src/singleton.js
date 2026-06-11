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
// - A SIGKILL (kill -9) leaves a stale pid file. Harmless — the live-
//   check below (`process.kill(pid, 0)`) self-heals it on next start.
// ============================================================

const fs = require('fs');
const path = require('path');

const RUN_DIR = path.join(__dirname, '.run');

module.exports = function singleton(name) {
  try { fs.mkdirSync(RUN_DIR, { recursive: true }); } catch { /* ignore */ }
  const pidFile = path.join(RUN_DIR, `${name}.pid`);

  // Is the lock already held by a LIVE process? → refuse to start.
  try {
    const existing = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isFinite(existing) && existing !== process.pid) {
      let alive = false;
      try { process.kill(existing, 0); alive = true; }   // signal 0 — existence probe
      catch (e) { alive = (e.code === 'EPERM'); }        // exists but not signalable by us
      if (alive) {
        console.error(`⛔ [${name}] another instance is already running (pid ${existing}).`);
        console.error(`   This copy will exit. Use scripts/services.sh restart to restart cleanly.`);
        process.exit(1);
      }
      // stale pid file (process is dead) — fall through and reclaim it
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
};
