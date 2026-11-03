// ============================================================
// Vigil Platform — Tests: snapshot directory resolver
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// GOTCHAS #131: ten modules each defined this path, two honoured SNAPSHOT_DIR
// and eight did not. The consolidation is only safe if the shared resolver
// returns the *same* path the eight hardcoded — otherwise every existing site
// silently starts writing somewhere new on the next deploy.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { snapshotDir } = require('../src/helpers/snapshotDir');

const REPO = path.join(__dirname, '..');

describe('snapshotDir', () => {
  it('defaults to <repo>/snapshots — the path all ten call sites used before', () => {
    delete process.env.SNAPSHOT_DIR;
    assert.equal(snapshotDir(), path.join(REPO, 'snapshots'));
  });

  it('honours SNAPSHOT_DIR — the whole point of the consolidation', () => {
    process.env.SNAPSHOT_DIR = '/mnt/media/snaps';
    assert.equal(snapshotDir(), '/mnt/media/snaps');
    delete process.env.SNAPSHOT_DIR;
  });

  it('resolves a relative override to absolute, so every site reports one canonical path', () => {
    process.env.SNAPSHOT_DIR = 'snaps';
    assert.equal(snapshotDir(), path.resolve('snaps'));
    delete process.env.SNAPSHOT_DIR;
  });

  it('ignores an empty SNAPSHOT_DIR rather than resolving to cwd', () => {
    process.env.SNAPSHOT_DIR = '';
    assert.equal(snapshotDir(), path.join(REPO, 'snapshots'));
    delete process.env.SNAPSHOT_DIR;
  });

  it('resolves per call, not once at require — dotenv runs after the require in every entry point', () => {
    delete process.env.SNAPSHOT_DIR;
    const before = snapshotDir();
    process.env.SNAPSHOT_DIR = '/mnt/late';           // as if dotenv loaded it just now
    assert.notEqual(snapshotDir(), before);
    delete process.env.SNAPSHOT_DIR;
  });

  // The regression that actually costs money: someone reintroduces a local
  // path.join(..., 'snapshots') and one writer drifts off the shared disk again.
  it('is the only module holding a literal snapshots path', () => {
    const files = [
      'src/edge/bridge.js', 'src/helpers/blacklistBridge.js', 'src/lpr-receiver.js',
      'src/api-server.js', 'src/mqtt-subscriber.js', 'src/line-sender.js',
      'src/ingesters/hikvision-isapi.js', 'src/ingesters/dahua-cgi.js',
      'src/stats-summary-route.js', 'src/edge-config-agent.js',
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(REPO, f), 'utf8');
      assert.ok(!/path\.join\([^)]*['"]snapshots['"]\s*\)/.test(src),
        `${f} builds its own snapshots path again — require helpers/snapshotDir instead (GOTCHAS #131)`);
    }
  });
});
