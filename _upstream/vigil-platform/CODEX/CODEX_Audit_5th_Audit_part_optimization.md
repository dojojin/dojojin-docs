# CODEX_Audit_5th_Audit_part_optimization.md — Optimization Audit

Audit date: 2026-07-21  
Auditor: Codex  
Scope: Centralize deployment + Edge Site deployment, focused on smoothness, throughput, latency, storage, operations, and scale readiness.

## 0. Executive Summary

**Fact**

- Current architecture is already a pragmatic modular-monolith/SOA hybrid: Central uses Express + PostgreSQL + EMQX + PM2 workers; Edge uses `EDGE_MODE=1`, local NanoMQ, `edge-bridge`, `edge-config-agent`, and ingesters that publish pre-normalized metadata.
- Several major optimizations are already landed: config mtime cache, PM2 process split, report/alert workers, LPR keyset pagination for `/api/lpr`, `appearances/stats` temp-table + TTL cache, `shm_size: 1gb` for Postgres, rawXml retention, edge snapshot dir-age pruner, and LPR scene resize.
- The next performance wall is not one component; it is the combination of high-volume LPR rows, recursive image storage operations, broad health diagnostics, multi-query dashboard stats, and edge link/store-and-forward behavior.
- `db/MANUAL_partition_events_option_a.sql` exists but is intentionally manual; the live schema is still treated as unpartitioned unless this manual operation has been rehearsed and applied.

**Opinion**

ระบบพร้อมใช้งานจริงใน scale ปัจจุบัน แต่ถ้าจะให้ “ลื่น” เมื่อเพิ่มหลาย site / หลายล้าน LPR ต่อเดือน ควรทำตามลำดับนี้:

1. **ลดงานหนักใน request path**: cache/timeout health, cache stats, ลด exact count/offset ที่เหลือ
2. **ทำ storage/retention ให้เป็น directory/partition based**: central LPR image prune แบบ dir-age, DB partition สำหรับ `events`
3. **เพิ่ม Edge flow control**: concurrency cap, queue alert, packet/body size guard, edge-local thumbnails
4. **เพิ่ม observability ที่บอกก่อน user รู้สึกหน่วง**: section timing, query timing, queue evicted, bridge stale, disk runway

## 1. Evidence Reviewed

- `ARCHITECTURE.md`, `DECISIONS.md`, `GOTCHAS.md`, `ROADMAP.md`, `SKILL.md`, `service_start.md`
- `docker-compose.yml`, `ecosystem.config.js`, `ecosystem.edge.config.js`
- `src/api-server.js`, `src/auth.js`, `src/routes/health.js`, `src/routes/lpr-query.js`, `src/routes/appearances.js`
- `src/edge/bridge.js`, `src/edge-config-agent.js`, `src/edge/publisher.js`, `src/edge/snapshot-retention.js`
- `src/lpr-retention.js`, `src/lpr-core.js`, `src/lpr-receiver.js`
- `docs/superpowers/plans/2026-07-01-lpr-scale-search-storage.md`
- `docs/superpowers/plans/2026-07-01-retention-architecture.md`
- `db/MANUAL_partition_events_option_a.sql`

No secrets, raw customer media, `.env` contents, or camera credential contents were inspected.

## 2. Priority Roadmap

| Priority | Work | Central | Edge | Why |
|---|---|---:|---:|---|
| P0 | Add health/stats timing + cache expensive health sections | Yes | Observed via Central | Removes self-inflicted refresh load |
| P0 | Fix `cameras-config.json` permission to `600` as ops prerequisite | Yes | Yes | Security + avoids noisy audit warnings |
| P1 | Central LPR image retention: dir-age drop for expired date dirs | Yes | Pattern already exists | Avoid millions of `stat()`/`unlink()` operations |
| P1 | Extend keyset/estimate pattern to remaining LPR/face/appearance heavy lists | Yes | N/A | Smooth scrolling/search at depth |
| P1 | Edge fetch/probe concurrency caps | N/A | Yes | Prevent slow NVR/camera from creating socket storms |
| P1 | Bridge queue alerting + disk runway metric | Yes | Yes | Detect site internet failure before data loss |
| P2 | Partition `events` and decide `license_plates` partition strategy | Yes | N/A | Unlock long LPR retention and fast `DROP PARTITION` |
| P2 | Stats materialized-base pattern for `/api/lpr/stats` | Yes | N/A | Avoid 10 parallel scans per dashboard load |
| P2 | Edge-local thumbnail/cache strategy for proxied snapshots | Yes | Yes | Avoid repeated Central→Edge full image fetch |
| P3 | Optional object storage / lifecycle policy for very large single deployments | Yes | Maybe | Ops win after local disk/partitioning are exhausted |

## 3. Findings

### OPT5-CEN-001 — `/api/health/details` is too heavy for auto-refresh scale

**Fact**

- `src/routes/health.js` recursively walks `snapshots/lpr`, `snapshots/events`, and `snapshots/face` via `_snapshotStats()` on each request.
- The same endpoint also runs broad `COUNT(*)` queries, `pm2 jlist`, worker health probes, `statfs`, media-buffer stat scans, spool stats, and edge status reads.
- Health page auto-refresh is documented as frequent, and this endpoint is admin/auditor visible.

**Impact**

เมื่อ snapshot tree โตเป็นล้านไฟล์ health page เองจะกลายเป็น load generator: filesystem I/O, PM2 shell, worker probes, and DB counts all happen in one request path.

**Recommendation**

- Add 5-15s TTL cache for storage/PM2/worker sections.
- Add per-section timing in response, e.g. `diagnostics_ms.storage`, `diagnostics_ms.pm2`.
- Add warning log when a section exceeds threshold.
- Keep the quick DB ping live, but make expensive inventory cached/degraded.
- Prefer edge/retention jobs publishing inventory counters instead of health walking the full tree.

### OPT5-CEN-002 — Central LPR image retention still prunes per file

**Fact**

- `src/lpr-retention.js` recursively walks LPR image directories and uses per-file `stat()` + `unlink()`.
- Edge `src/edge/snapshot-retention.js` already uses a safer dir-age drop for `snapshots/events/YYYY-MM-DD`.
- The LPR scale plan projects millions of files live at 10M records/month.

**Impact**

Daily retention can become slow and I/O-heavy, especially on spinning disks, APFS/dev machines, or small edge-like boxes.

**Recommendation**

- Keep existing function as fallback for mixed/legacy layouts.
- Add fast path for expired whole date directories under `snapshots/lpr/<YYYY-MM-DD>/`.
- Retain guard rails from edge pruner: date regex, never walk root, never touch `lpr-watchlist`.
- For current-day partial expiry, use old per-file path only when necessary.

### OPT5-CEN-003 — Partitioning is the main unlock for long LPR retention

**Fact**

- `db/MANUAL_partition_events_option_a.sql` exists and explains downtime, backup, and monthly partition maintenance.
- `docs/superpowers/plans/2026-07-01-retention-architecture.md` states long `lpr_retention_days` is gated on P2/2B partitioning.
- `enforceRetention()` already decouples `anprAlarm` from general retention; LPR lifecycle is separate.

**Impact**

Without partitioning, multi-year plate logs mean batched deletes over a flat table and growing indexes. Retention remains a recurring workload instead of a metadata operation.

**Recommendation**

- Rehearse partition migration on a restored copy before production.
- Decide `license_plates` partition strategy before running: copied `event_time` partition vs flat table with selective join.
- Add monthly partition creation automation and a health warning when default partition has rows.
- Only after that, raise `lpr_retention_days` beyond 30 days.

### OPT5-CEN-004 — `/api/lpr/stats` still runs many parallel aggregations

**Fact**

- `src/routes/lpr-query.js` `/api/lpr/stats` runs 10 parallel queries in `Promise.all`.
- `appearances/stats` and LPR report endpoint already use a materialized temp base pattern to avoid repeated filtered joins.
- Postgres `/dev/shm` was already increased to `1gb` because parallel aggregations exhausted Docker default shared memory.

**Impact**

The endpoint is fast enough today but can spike CPU/DSM/IO under multiple dashboard clients or wide custom windows.

**Recommendation**

- Apply the same temp-table/materialized-base pattern used by `appearances/stats` and `stats/lpr/report`.
- Add 15-30s TTL cache keyed by period/site/camera filters.
- Add a query duration warning and response `source: "cache" | "fresh"`.
- Keep `Promise.all` only after the filtered working set is materialized.

### OPT5-CEN-005 — Some list endpoints still use exact count + offset

**Fact**

- `/api/lpr` main list has keyset support and `X-Has-More`.
- `/api/lpr/no-read` still does exact `COUNT(*)` and `OFFSET`.
- `face`, `appearance`, status-log, report-history, and LPR alert routes still have `COUNT(*) OVER()` / exact count / offset patterns in several places.

**Impact**

At low volume this is ergonomic. At high volume, “go deeper” pages become slower and exact totals cost more than the data page.

**Recommendation**

- Use keyset where data is naturally newest-first.
- Use estimate or capped totals for large forensic lists.
- Preserve exact count only for small admin/history tables.
- Add endpoint-level threshold rule: if table projected >1M rows, default to cursor and no exact count.

### OPT5-CEN-006 — Edge snapshot proxy fetches can repeat expensive image work

**Fact**

- Central `/snapshots/*` is local-first, then proxy-fetches missing edge images through `SNAPSHOT_PROXY_SECRET`.
- For proxied edge images, thumbnail generation explicitly skips disk cache (`if (proxyBuf) throw new Error('proxy')`).
- This preserves PDPA “no disk copy on central,” but repeated views re-fetch from edge and re-run `sharp`.

**Impact**

Opening the same gallery/modal repeatedly can consume edge upload bandwidth and Central CPU, especially on weak site links.

**Recommendation**

- Keep “no persistent central copy” as default.
- Add edge-side thumbnail endpoint or edge-side thumbnail cache so Central requests smaller images.
- Alternatively add short-lived in-memory Central thumbnail cache with strict size cap and no disk persistence.
- Surface proxy fetch latency and failure count in Health.

### OPT5-CEN-007 — DB pool/concurrency should be tuned as route load grows

**Fact**

- `api-server` pool max is 15; `lpr-receiver` pool max is 5; other PM2 workers also use pools/clients.
- Several endpoints launch many parallel queries from one request.

**Impact**

Under simultaneous dashboards/reports, connection saturation can look like random latency. The pattern is manageable now but needs guardrails before multi-site scale.

**Recommendation**

- Add per-endpoint query timing and pool wait metrics.
- Limit concurrent expensive report/stats renders.
- Consider a small query-concurrency limiter for heavy stats endpoints.
- PgBouncer is optional later; first fix repeated scans and exact counts.

### OPT5-EDGE-001 — Bridge store-and-forward needs alerting, not just counters

**Fact**

- `src/edge/bridge.js` queues offline publishes to `data/bridge-queue` capped at 200MB.
- When cap is exceeded, oldest messages are evicted and `evicted` increments.
- Heartbeat publishes `queued`, `evicted`, `queued_bytes`, and remote/local status.

**Impact**

Data loss can happen silently if nobody watches `evicted` or queue runway.

**Recommendation**

- Add Central Health warning/LINE admin alert when `bridge_dropped/evicted > 0`.
- Add estimated queue runway based on recent bytes/minute.
- Split high-value topics from low-value telemetry if eviction becomes real.
- Consider compression for queued JSON payloads if payload size grows.

### OPT5-EDGE-002 — Edge camera/NVR probes need global concurrency caps

**Fact**

- `edge-config-agent` performs heartbeat TCP probes, preview fetches, SD/storage probes, and scan requests.
- `_fetchJpeg` timeout is 45s for slow NVR channel-title fetches.
- GOTCHAS document a real scan relay loop that caused socket storms before loop-break fixes.

**Impact**

A slow NVR can hold many sockets. Multiple timers and admin scans can overlap, causing local resource pressure on small N150 boxes.

**Recommendation**

- Add a small global concurrency limiter for `_fetchJpeg`, heartbeat probes, preview capture, and scan.
- Add per-camera/NVR cooldown after repeated timeouts.
- Report active probe count and timeout count in edge heartbeat.
- Keep long timeout only for scan path; preview path should fail faster.

### OPT5-EDGE-003 — NanoMQ packet/body limits are larger than current design needs

**Fact**

- Edge docs/template set NanoMQ `max_packet_size = 256MB`.
- Current architecture explicitly says images never cross MQTT; only metadata and filenames are published.
- Public push endpoints use raw body limit `20mb`.

**Impact**

Large packet/body limits widen memory pressure and DoS blast radius, especially on edge hardware.

**Recommendation**

- Reduce NanoMQ max packet size to a measured metadata ceiling plus margin, e.g. 2-8MB unless a real payload needs more.
- Keep LPR/face raw HTTP body limit based on actual camera multipart size, not generic 20MB.
- Add log/metric for rejected oversized body.

### OPT5-EDGE-004 — Recurring model/firmware detection should be automated

**Fact**

- ROADMAP notes `scripts/fill-model.js` is one-time and misses newly added cameras after initial run.
- Suggested approach is recurring edge-side detect and POST/PATCH back to central.

**Impact**

Health/support dashboards degrade because new cameras have missing model/firmware/serial until someone remembers a manual script.

**Recommendation**

- Implement weekly or daily edge cron/PM2 job that detects only missing model fields.
- Send results through a central admin/internal endpoint.
- Include last-detected timestamp and failure reason per camera.

### OPT5-EDGE-005 — Edge media cleanup after camera delete remains planned

**Fact**

- ROADMAP says camera delete removes DB rows but not edge disk media, and Central currently has no delete-media command channel.
- Existing MQTT config channel can carry one-shot edge commands if designed carefully.

**Impact**

Deleted/reconfigured cameras leave orphaned files, wasting disk and confusing evidence review.

**Recommendation**

- Implement `_config/delete-media` as one-shot, non-retained command.
- Use exact path derivation and camera-id sanitization, not prefix matching.
- Return `_config/delete-media-result` for audit/health visibility.

## 4. What To Do First

**Week 1**

1. Add health section timing/cache.
2. Add bridge queue/drop warnings in Central Health.
3. Change central LPR image retention fast path to date-dir drop.
4. Add concurrency limiter to edge fetch/probe paths.

**Week 2**

1. Apply temp-table/cache to `/api/lpr/stats`.
2. Convert `/api/lpr/no-read` and LPR alerts to cursor/estimate where appropriate.
3. Add security/ops hygiene checks: file permissions, `.DS_Store`, internal token presence, EMQX auth state.

**Before Long LPR Retention**

1. Rehearse partition migration on restored backup.
2. Decide `license_plates` partition strategy.
3. Add partition maintenance automation.
4. Only then raise row retention to years.

## 5. Validation Notes

This is a static/source audit plus document review. I did not run load tests, `EXPLAIN ANALYZE` on live data, Docker runtime probes, or authenticated browser profiling in this pass.
