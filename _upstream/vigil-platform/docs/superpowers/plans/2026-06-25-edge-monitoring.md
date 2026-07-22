# Edge Monitoring Plan — VSS (N150) Health Visibility

**Status:** ✅ CLOSED 2026-06-25  
**IM5 Ph.2 (site-down correlation):** DEFERRED → ROADMAP (EM6 covers full-site-down; partial failure case not yet observed in prod)

**Date:** 2026-06-25  
**Baseline ref:** `abc0a6a` (health page camera merge, latest on main)  
**Scope:** EM1–EM6 — surface edge-box PM2/disk/bridge health into central Health page  
**Author:** Prakasit Rochanavipart (Dojo-mAn)

---

## Problem Statement

Central Health page only polls central Mac PM2 processes. Edge box N150 (VSS site, EDGE_MODE=1) runs 6 PM2 processes (nanomq, hikvision, dahua, lpr-receiver, edge-config-agent, edge-bridge) that are **completely invisible** to the health dashboard. If the edge bridge drops or an ingester crash-loops, nobody knows until cameras go offline.

Current `bridge.js` heartbeat (line 128–132) = `console.log` only — nothing is published over MQTT.

---

## Architecture Constraint

`mqtt-subscriber` and `api-server` are **separate PM2 processes / separate Node.js heaps** — no shared memory. The heartbeat arrives in `mqtt-subscriber` (owns `projects/+/#`), but `/api/health/details` is served by `api-server`. The only shared resource is **PostgreSQL** → `edge_status` table is the cross-process channel (not a luxury choice, it is forced).

---

## Topic + Payload Contract

**Topic:** `projects/<site_id>/_edge/heartbeat`  
e.g. `projects/vss/_edge/heartbeat`

**Payload (JSON, QoS 1, retain: false):**
```json
{
  "ts": 1719000000000,
  "pm2": [
    { "name": "nanomq",           "status": "online", "restarts": 0, "uptime_ms": 3600000 },
    { "name": "hikvision",        "status": "online", "restarts": 2, "uptime_ms": 3540000 },
    { "name": "dahua",            "status": "online", "restarts": 0, "uptime_ms": 3600000 },
    { "name": "lpr-receiver",     "status": "online", "restarts": 0, "uptime_ms": 3600000 },
    { "name": "edge-config-agent","status": "online", "restarts": 0, "uptime_ms": 3600000 },
    { "name": "edge-bridge",      "status": "online", "restarts": 1, "uptime_ms": 3580000 }
  ],
  "disk": { "free_gb": 42.3, "total_gb": 100.0 },
  "bridge": { "forwarded": 1240, "dropped": 0, "remote": "up", "local": "up" }
}
```

**No image binary / base64 — data only.** (hard constraint)  
`retain: false` — retained heartbeat looks live after central restart, which is the same failure the retain-skip logic in `mqtt-subscriber.js:404` guards against.

---

## DB Schema (Option B — explicit columns, queryable for EM6 alert)

**Migration:** `db/db_migration_067_edge_status.sql`

```sql
CREATE TABLE IF NOT EXISTS edge_status (
  site_id          text PRIMARY KEY REFERENCES sites(code),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  disk_free_gb     numeric(6,1),
  disk_total_gb    numeric(6,1),
  bridge_forwarded bigint,
  bridge_dropped   bigint,
  bridge_remote    text,   -- 'up' | 'down'
  bridge_local     text,   -- 'up' | 'down'
  pm2_json         jsonb,  -- array of {name,status,restarts,uptime_ms}
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

`last_seen_at` is the staleness key. `pm2_json` stays jsonb (array, not worth normalizing). Scalar bridge/disk fields are explicit for EM6 alert queries.

---

## Phases

### EM1 — bridge.js: publish MQTT heartbeat (N150 side)

**File:** `src/edge/bridge.js`

Replace existing `setInterval` console-only heartbeat (line 128–132) with one that also publishes to `projects/${SITE_ID}/_edge/heartbeat`:

```js
const { execFileSync } = require('child_process');

setInterval(() => {
  const r = remote.connected ? 'up' : 'down';
  const l = local?.connected  ? 'up' : 'down';
  console.log(`[bridge] heartbeat remote=${r} local=${l} forwarded=${forwarded} dropped=${dropped}`);
  if (!remote.connected) return; // no point publishing if disconnected

  let pm2 = [];
  try {
    const raw = execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 4000 });
    pm2 = JSON.parse(raw).map(p => ({
      name:      p.name,
      status:    p.pm2_env.status,
      restarts:  p.pm2_env.restart_time || 0,
      uptime_ms: p.pm2_env.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
    }));
  } catch (e) { console.warn('[bridge] pm2 jlist failed:', e.message); }

  let disk = null;
  try {
    const df = execFileSync('df', ['-k', '/'], { encoding: 'utf8' });
    const parts = df.trim().split('\n')[1].trim().split(/\s+/);
    const total = parseInt(parts[1], 10);
    const avail = parseInt(parts[3], 10);
    disk = {
      free_gb:  +(avail  / (1024 * 1024)).toFixed(1),
      total_gb: +(total  / (1024 * 1024)).toFixed(1),
    };
  } catch (e) { console.warn('[bridge] df failed:', e.message); }

  const payload = JSON.stringify({
    ts: Date.now(), pm2, disk,
    bridge: { forwarded, dropped, remote: r, local: l },
  });
  remote.publish(
    `projects/${SITE_ID}/_edge/heartbeat`,
    payload,
    { qos: 1, retain: false },
    (err) => { if (err) console.warn('[bridge] heartbeat publish failed:', err.message); }
  );
}, 60_000);
```

**Criterion:** N150 bridge logs "heartbeat" every 60s; central EMQX sees message on `projects/vss/_edge/heartbeat`.

---

### EM2 — DB migration 067

**File:** `db/db_migration_067_edge_status.sql`

```sql
-- Vigil Platform — Migration 067: Edge status table
-- Stores last-seen heartbeat per edge site for Health dashboard.
CREATE TABLE IF NOT EXISTS edge_status (
  site_id          text PRIMARY KEY REFERENCES sites(code),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  disk_free_gb     numeric(6,1),
  disk_total_gb    numeric(6,1),
  bridge_forwarded bigint,
  bridge_dropped   bigint,
  bridge_remote    text,
  bridge_local     text,
  pm2_json         jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

**Criterion:** Migration runs on next api-server start via `migrate.js` without error.

---

### EM3 — mqtt-subscriber.js: intercept + upsert

**File:** `src/mqtt-subscriber.js`

⚠️ **Critical gotcha:** `_stripSitePrefix` (line 430–433) does `slice(2)` and discards the `site_id`. The `_edge/heartbeat` intercept **must read site from the raw topic before stripping**, then short-circuit with `return` before `processMessage` to prevent the payload being treated as a phantom camera event (`cameraId='_edge'` would pollute `last_seen`).

Add inside `client.on('message', ...)` after `_stripSitePrefix`, before `processMessage`:

```js
const stripped = _stripSitePrefix(topic);
if (stripped.startsWith('_config/')) return;
// EM3: intercept edge heartbeat before processMessage
if (stripped.startsWith('_edge/heartbeat')) {
  const siteId = topic.startsWith('projects/') ? topic.split('/')[1] : null;
  if (siteId) await recordEdgeHeartbeat(siteId, msg).catch(e =>
    console.error('[mqtt] edge heartbeat upsert error:', e.message));
  return;
}
await processMessage(stripped, msg);
```

New function `recordEdgeHeartbeat`:

```js
async function recordEdgeHeartbeat(siteId, payload) {
  const { ts, pm2 = [], disk = {}, bridge = {} } = payload;
  await pool.query(`
    INSERT INTO edge_status
      (site_id, last_seen_at, disk_free_gb, disk_total_gb,
       bridge_forwarded, bridge_dropped, bridge_remote, bridge_local, pm2_json, updated_at)
    VALUES ($1, to_timestamp($2::bigint / 1000.0), $3, $4, $5, $6, $7, $8, $9::jsonb, now())
    ON CONFLICT (site_id) DO UPDATE SET
      last_seen_at     = EXCLUDED.last_seen_at,
      disk_free_gb     = EXCLUDED.disk_free_gb,
      disk_total_gb    = EXCLUDED.disk_total_gb,
      bridge_forwarded = EXCLUDED.bridge_forwarded,
      bridge_dropped   = EXCLUDED.bridge_dropped,
      bridge_remote    = EXCLUDED.bridge_remote,
      bridge_local     = EXCLUDED.bridge_local,
      pm2_json         = EXCLUDED.pm2_json,
      updated_at       = now()
  `, [
    siteId,
    ts || Date.now(),
    disk.free_gb  ?? null,
    disk.total_gb ?? null,
    bridge.forwarded ?? null,
    bridge.dropped   ?? null,
    bridge.remote    ?? null,
    bridge.local     ?? null,
    JSON.stringify(pm2),
  ]);
}
```

**Criterion:** After publishing a test heartbeat to central EMQX from Mac, a row exists in `edge_status` table.

---

### EM4 — health.js: expose `result.edge_sites`

**File:** `src/routes/health.js`

After the services block, add:

```js
// EM4 — Edge sites health
result.edge_sites = [];
try {
  const EDGE_STALE_SEC = parseInt(process.env.EDGE_HEARTBEAT_STALE_SEC || '180', 10);
  const rows = await pool.query(`
    SELECT site_id, last_seen_at, disk_free_gb, disk_total_gb,
           bridge_forwarded, bridge_dropped, bridge_remote, bridge_local,
           pm2_json,
           extract(epoch from (now() - last_seen_at)) AS stale_sec
    FROM edge_status
    ORDER BY site_id
  `);
  result.edge_sites = rows.rows.map(r => ({
    site_id:          r.site_id,
    last_seen_at:     r.last_seen_at,
    stale:            r.stale_sec > EDGE_STALE_SEC,
    stale_sec:        Math.round(r.stale_sec),
    disk_free_gb:     r.disk_free_gb,
    disk_total_gb:    r.disk_total_gb,
    bridge_forwarded: r.bridge_forwarded,
    bridge_dropped:   r.bridge_dropped,
    bridge_remote:    r.bridge_remote,
    bridge_local:     r.bridge_local,
    services:         r.pm2_json || [],
  }));
} catch (e) { console.error('[health] edge_sites query failed:', e.message); }
```

Add to `constants.js`: `EDGE_HEARTBEAT_STALE_SEC = 180`

**Criterion:** `GET /api/health/details` returns `edge_sites: [{ site_id: 'vss', stale: false, ... }]`

---

### EM5 — page-health.js + i18n.js: Edge Sites card

**File:** `dashboard/page-health.js`

For each item in `h.edge_sites`, render an "Edge — {site_id.toUpperCase()}" card:

```js
for (const es of (h.edge_sites || [])) {
  const edgeLevel = es.stale ? 'warn' : 'ok';
  const badgeLabel = es.stale
    ? i18n('hlth.edgeStale', `Stale ${Math.round(es.stale_sec / 60)}m`)
    : i18n('hlth.edgeLive', 'Live');
  const svcRows = (es.services || []).map(s => [
    s.name,
    `${s.status}${s.restarts > 0 ? ` (↻${s.restarts})` : ''}`,
  ]);
  const diskStr = (es.disk_free_gb !== null && es.disk_total_gb !== null)
    ? `${es.disk_free_gb} / ${es.disk_total_gb} GB`
    : '—';
  cards.push(_healthCard(`Edge — ${es.site_id.toUpperCase()}`, _healthBadge(edgeLevel, badgeLabel), [
    [i18n('hlth.edgeLastSeen', 'Last seen'),    es.last_seen_at ? new Date(es.last_seen_at).toLocaleTimeString('th-TH') : '—'],
    [i18n('hlth.edgeDisk', 'Disk free/total'),  diskStr],
    ['Bridge remote',    es.bridge_remote || '—'],
    ['Bridge local',     es.bridge_local  || '—'],
    ['Forwarded/Dropped', es.bridge_forwarded !== null ? `${es.bridge_forwarded} / ${es.bridge_dropped}` : '—'],
    [i18n('hlth.edgeServices', 'Services'), null],
    ...svcRows,
  ]));
}
```

**File:** `dashboard/i18n.js` — add 4 keys (TH + EN):

| key | TH | EN |
|-----|----|----|
| `hlth.edgeLive` | `ออนไลน์` | `Live` |
| `hlth.edgeStale` | `ขาดการติดต่อ` | `Stale` |
| `hlth.edgeLastSeen` | `ล่าสุด` | `Last seen` |
| `hlth.edgeDisk` | `พื้นที่ว่าง/รวม` | `Disk free/total` |
| `hlth.edgeServices` | `กระบวนการ` | `Services` |

**Criterion:** Health page shows an "Edge — VSS" card with service list rows and a green "Live" badge.

---

### EM6 — alert-worker: LINE alert on stale (Phase 2, gated)

**File:** `src/alert-worker.js`

**Gated** — implement after EM1–EM5 verified live on N150.

`alert-worker` already has DB access and the LINE/alert dispatch pipeline. Add a cron-like check every 5 minutes that queries `edge_status WHERE last_seen_at < now() - interval 'EDGE_HEARTBEAT_STALE_SEC seconds'` and fires a LINE alert via the existing `sendLineAlert()` pattern.

Mirrors `camera_offline_alerts` pattern — use same rate-limiting / re-alert suppression approach.

---

## Verify Plan (without N150)

After EM2–EM4 are deployed on central:

```bash
# Publish fake heartbeat to central EMQX from Mac
mosquitto_pub \
  -L "mqtts://edge-vss:PASSWORD@dashboard.dojojin.tech:8883" \
  -t "projects/vss/_edge/heartbeat" \
  -m '{"ts":TIMESTAMP,"pm2":[{"name":"edge-bridge","status":"online","restarts":0,"uptime_ms":60000}],"disk":{"free_gb":42.0,"total_gb":100.0},"bridge":{"forwarded":99,"dropped":0,"remote":"up","local":"up"}}' \
  --qos 1
# Then check:
SELECT * FROM edge_status;  -- should have 1 row for 'vss'
# And verify health API:
curl https://dashboard.dojojin.tech/api/health/details | jq .edge_sites
```

EM1 (bridge.js on N150) requires N150 access — deploy during next N150 maintenance window.

---

## Responsive (WA #2-B)

Edge card reuses existing `_healthCard` renderer → responsive for free. Verify ≤768px shows card correctly on Health page before commit.

---

## Files Affected (commit scope)

| Phase | Files | Central/Edge |
|-------|-------|-------------|
| EM1 | `src/edge/bridge.js` | Edge (N150 git pull) |
| EM2 | `db/db_migration_067_edge_status.sql` | Central |
| EM3 | `src/mqtt-subscriber.js` | Central |
| EM4 | `src/routes/health.js`, `src/constants.js` | Central |
| EM5 | `dashboard/page-health.js`, `dashboard/i18n.js` | Central |
| EM6 | `src/alert-worker.js` | Central (gated) |

---

## N150 Reminder (carry-forward)

After EM1 is committed: `ssh N150 → git pull && pm2 restart edge-bridge` during next maintenance window. (Non-urgent — edge processes still ingest normally via NanoMQ even before EM1.)
