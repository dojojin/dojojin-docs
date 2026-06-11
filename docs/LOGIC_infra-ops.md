# LOGIC_infra-ops — Infrastructure, Migrations, Ops & Settings

> Extracted from DECISIONS.md. Canonical source for schema migrations,
> backup/restore, service lifecycle, duplicate process prevention,
> settings workspace consolidation, and scale-up planning.
> Parent index: DECISIONS.md
> Last updated: 2026-06-08 · v1.5.0

---

## Schema Migrations (#3, #80–#84)

**#3 — Single-file `init.sql` (idempotent) is canonical fresh-install only**
One file creates all tables on a truly fresh volume. Idempotent (`IF NOT EXISTS`) so it can be re-run safely. However it only runs automatically once via `docker-entrypoint-initdb.d`. For schema evolution on existing volumes, always write a migration file — see #80.

**#80 — `docker-entrypoint-initdb.d/init.sql` runs ONLY ONCE per volume**
Editing `init.sql` after first boot is invisible to the live DB. Fix: `src/migrate.js` runs at api-server boot, scans `db/db_migration_*.sql`, runs files not yet recorded in `schema_migrations` table inside transactions. Going forward: never edit `init.sql` for new schema — write `db_migration_<NNN>_<topic>.sql` instead (idempotent).

> STUBBORN_FACT: Never edit `init.sql` to evolve existing schema. Write a new migration file. Decision #80.

**#81 — Migration runner is fail-fast**
If any migration errors, api-server exits 1 before `server.listen`. Do NOT `try/catch` or comment out a failing migration. Operator response: restore latest backup, fix SQL, retry.

> STUBBORN_FACT: A failing migration aborts api-server startup by design. GOTCHAS #19.

**#82 — `db_migration_timestamptz.sql` rewritten to be schema-drift-tolerant**
Uses `DO $$ ... LOOP ... information_schema.columns ... EXECUTE format()` — only converts columns that still exist AND are still `timestamp without time zone`. Hard-coded column names rot when schema evolves.

**#83 — Backup = `pg_dump -Fc -Z 6` daily at 03:00 via launchd**
Custom format (not plain SQL): smaller, supports parallel restore, `pg_restore --list` lets you inspect TOC. Local retention 14 days. Off-host copy (rsync/rclone) deferred — set up per customer deployment.
`pg_dump -Fc` archive is NOT plain SQL — `cat backup.dump` shows binary garbage. Use `pg_restore --list` to inspect, or `pg_restore -f -` to convert to plain SQL.

> STUBBORN_FACT: `pg_dump -Fc` is binary. Never `cat` it. GOTCHAS #20.

**#84 — Three-layer disaster recovery contract**
1. Routine schema bump → migration runner handles transparently, no data loss.
2. Bad migration / API regression → restore yesterday's `.dump`, fix code, redeploy.
3. Volume corruption → `down -v` + `up -d` (init.sql runs fresh) + `restore.sh <latest>.dump`.

---

## Service Lifecycle & Duplicate Prevention (#124)

**#124 — Three guards against a service running twice**
Symptom: ad-hoc `pkill` + `node x.js &` sequence left orphan `dahua-cgi.js` running alongside the one `start:all` owns. Every Dahua event got INSERTed twice.

Three layers:
1. **`src/singleton.js`** — PID-file lock. Each long-running process calls `require('./singleton')('<name>')` right after dotenv. Writes `src/.run/<name>.pid`. Live PID holder → new copy logs error + `exit(1)`. Stale locks self-heal via `process.kill(pid, 0)` liveness probe.
2. **PM2 + `ecosystem.config.js`** (primary, since 2026-06-03) — 7 workers managed by PM2 (api-server, mqtt-subscriber, media-recorder, hikvision, dahua, alert-worker, report-worker). `scripts/services.sh` เป็น PM2 thin-wrapper. Use `pm2 start/stop/restart <name>` หรือ `./scripts/services.sh`.
3. **Health Check page** — `/api/health/details` reports per-service instance count. "⚙️ Service Processes" card shows `1x` OK / `0x` down / `>1` DUPLICATE in red.

> STUBBORN_FACT: Use PM2 (`scripts/services.sh` / `pm2` commands) for all start/stop. Never hand-`pkill` or `node x.js &`. GOTCHAS #33 adjacent.

How to apply: any NEW long-running entrypoint → add `require('./singleton')('<name>')` after dotenv AND an entry to `ecosystem.config.js` AND the `svc` list in api-server health block.

---

## Retention & Storage (#39–#40, #66)

**#39 — `snapshot_retention_days` is a separate setting from `data_retention_days`**
Clips are ~100× bigger than events; snapshots are ~160× bigger than raw event rows. Each gets its own retention knob so the operator can tune independently without affecting the other.

**Data retention:** `data_retention_days` (default 365, 1..730) — daily background DELETE of old `events` rows.
**Snapshot retention:** `snapshot_retention_days` (default 30, 1..365) — daily file-system unlink of `/snapshots/*.jpg` by mtime (not filename timestamp). `cp` without `-p` resets mtime — use `cp -p` or `rsync -a` when migrating.
**Clip retention:** `clip_retention_days` (default 30, max 90) — daily mtime-based prune of `/media/*.mp4`.

> STUBBORN_FACT: Snapshot retention uses file mtime. `cp` without `-p` resets mtime to now → files won't get pruned for 30 days. GOTCHAS #13.

---

## Camera Status Counting (#72)

**#72 — "Today's Events" count is server-side, TZ-aware — not client-filtered**
Was previously filtering the 300-row `allEvents` cache on the client → severe undercount on busy days (hard cap at 300). New endpoint `/api/stats/today-counts` does TZ-aware `date_trunc('day', NOW() AT TIME ZONE display_timezone)` and returns `{total, cameras: {<cam_id>: {total, persons, vehicles, last_event}}, tz}`. Frontend fetches on Camera page nav + every 60s + WS `new_event` increments locally for live feel.

---

## Settings Workspace (#126)

**#126 — All admin/config UI consolidated into one "⚙️ การตั้งค่า" Settings Workspace**
`#page-settings` — left `.settings-rail` + right `.settings-content`. `settingsNav(key, el, opts)` switches section + runs that section's data loader.
10 rail sections: cameras, system, groups, users, categories, license, audit, sessions, backup, alerts.
Mobile (≤768px): drill-down pattern — level 1 = rail list, tap section adds `.sw-detail` (rail hidden, content shown), `settingsBack()` returns.
Migration was staged — all element IDs preserved so existing JS render/load code was unchanged.

How to apply: a new settings area = add `.srail-item` + `#set-<key>` section + a loader branch in `settingsNav`. Do NOT add new admin modals or topbar/dropdown entries.

---

## Camera Groups & Map (#47–#49)

**#47 — Multi-provider maps: CartoDB + Mapbox**
**#48 — Tile cache on disk** — works offline, customer owns data.
**#49 — OpenLayers over Leaflet** — better tile management + heatmap performance.

---

## Deployment (#50–#53)

**#50 — Cloudflare Tunnel over reverse proxy** — no port forwarding, free DDoS protection, easy HTTPS.
**#51 — Docker for DB + MQTT only** — Node.js runs directly on macOS for easier debugging.
**#52 — No nginx in front** — Express serves static files.
**#53 — Proprietary license, not open source** — customer pays per deployment. Source code ownership is kept by DojoJin Tech. White-label support means single codebase resold to multiple customers under their own branding.

**#34 (GOTCHAS) — `dashboard.js` runs STALE after deploy — Cloudflare edge-caches static `.js`**
`api-server.js` serves `/` + `/index.html` through a route that stamps `dashboard.js?v=<mtime-of-dashboard.js>`. Changed `dashboard.js` → new `?v` → cache miss. `index.html` goes out `Cache-Control: no-cache`. After deploying this change, purge Cloudflare cache once to evict old `index.html`.

---

## Scale-up Plan (#122)

**#122 — Scale-up is documented, not coded** — wait for pilot to calibrate. Plan in `HARDWARE_SIZING_GUIDE.md` → "🚀 Software-side Scale-up". Work order when triggered:

| Priority | Bottleneck | Action |
|---|---|---|
| 1 | `events` table → hundreds of millions of rows | Partition BY RANGE (event_time) monthly — TimescaleDB or native declarative |
| 2 | Camera grid rendering 3,000 cards | Virtualize + lazy-load snapshots via IntersectionObserver |
| 3 | Ingester = single Node process per vendor | Shard by topic-prefix / camera-id hash |
| 4 | api-server single instance | api-server HA behind load balancer (session in DB already) |
| 5 | Snapshot dir one folder | Shard to `snapshots/YYYY-MM-DD/` |

---

## Branding (#33–#38)

**#33 — Logo auto-resized 256×256 PNG via `sharp(fit:'inside')`** — preserves aspect ratio.
**#34 — Public `/api/branding` endpoint** — login/disclaimer fetch pre-auth.
**#35 — `/favicon.ico` reads `brand_logo_path` from DB** — serves 200+image/png or 204 if empty.
**#37 — Single accent color** (`--accent` CSS var) — no full theme system.
**#38 — Footer `© DojoJin Tech` is LOCKED** — only product name on left is editable.

> STUBBORN_FACT: `/api/branding` returns `{name, tagline, logo_url, primary_color}` — NOT raw `brand_*` keys. GOTCHAS #21.

---

## Related files
- `src/migrate.js` — schema migration runner
- `scripts/backup.sh` + `scripts/restore.sh` — backup/restore
- `scripts/services.sh` — service lifecycle control
- `src/singleton.js` — PID-file lock
- `db/db_migration_000_schema_migrations.sql` — tracking table bootstrap
- `HARDWARE_SIZING_GUIDE.md` — full scale-up plan
- GOTCHAS #13 (snapshot mtime), #19 (migration fail-fast), #20 (pg_dump binary)
