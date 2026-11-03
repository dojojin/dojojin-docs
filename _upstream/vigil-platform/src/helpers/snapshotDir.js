// ============================================================
// Vigil Platform — Snapshot directory resolver (single source of truth)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// This line used to live in ten modules. Two of them honoured SNAPSHOT_DIR,
// eight hardcoded <repo>/snapshots — and because every one of them runs in its
// own process, nothing could ever surface the disagreement. Setting the env var
// to move snapshots onto a dedicated disk would have moved the *reader*
// (bridge's storage metrics) without moving the *writers*: Health goes green on
// a disk nobody writes to while the root filesystem quietly fills. GOTCHAS #131.
//
// A FUNCTION, not a resolved constant, on purpose. Callers require this at the
// top of the file but must not read env until dotenv has run, and dotenv's
// position varies per entry point (edge-config-agent had the old const *above*
// its dotenv call — see the same trap already documented in dahua-cgi.js:69).
// Calling at assignment time keeps resolution under the caller's control; a
// module-level constant here would freeze whatever env existed at first require,
// wherever in the graph that happened to be.
'use strict';

const path = require('path');

// __dirname is src/helpers → '../..' is the repo root. Every former call site
// resolved to exactly this path, so with SNAPSHOT_DIR unset (the case on all
// four machines today) the switch is a no-op by construction.
function snapshotDir() {
  return process.env.SNAPSHOT_DIR
    ? path.resolve(process.env.SNAPSHOT_DIR)
    : path.join(__dirname, '..', '..', 'snapshots');
}

module.exports = { snapshotDir };
