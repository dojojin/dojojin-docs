# REF_operator-sql — Daily-ops SQL & System Settings Reference

> Extracted from SKILL.md §4 (System Settings), §10 (Daily-ops SQL snippets),
> §11 (Service control), §13–§16 (Ph.1–Ph.3 + Auditor ops).
> For troubleshooting steps → REF_troubleshooting.md
> For category mapping recipes → SKILL.md §3
> Last updated: 2026-06-08 · v1.5.0

---

## System Settings Reference

All settings live in `system_settings` (key/value, validated server-side).
Edit via UI: Settings → ⚙️ System (admin only), or via SQL below.

| Key | Default | Range / Allowed | Effect |
|---|---|---|---|
| `data_retention_days` | `365` | `1..730` | Daily background DELETE of old events rows |
| `snapshot_retention_days` | `30` | `1..365` | Daily file-system unlink of `/snapshots/*.jpg` by mtime |
| `display_timezone` | `Asia/Bangkok` | Any IANA TZ | Day-boundary alignment for timeline buckets |
| `comparison_mode` | `rolling` | `rolling \| calendar` | KPI comparison window (only `rolling` wired today) |
| `counter_dedup_mode` | `state` | `state \| object_window \| none` | Reserved; only `state` honoured currently |
| `custom_range_max_days` | `365` | `1..730` | Cap on Custom date-range modal in Stats |
| `brand_name` | `Vigil Platform` | 1..100 chars | Product name in sidebar/login/disclaimer/PDF |
| `brand_tagline` | `CCTV Analytics Suite` | ≤200 chars | Subtitle under brand name |
| `brand_logo_path` | `''` | `[A-Za-z0-9._-]+` or empty | File under `/branding/` — auto-resized 256×256 PNG |
| `brand_primary_color` | `#5b8def` | `#RRGGBB` | Single accent color (CSS `--accent`) |
| `analytics_event_display` | `ImageTooBright,ImageTooBlurry,ImageTooDark,GlobalSceneChange` | CSV of analytics keys | Which camera-automation event types shown in Stats/Events feed |

```sql
-- Quick read all settings
SELECT key, value FROM system_settings ORDER BY key;

-- Edit a setting
UPDATE system_settings SET value = '730' WHERE key = 'data_retention_days';
UPDATE system_settings SET value = '90'  WHERE key = 'snapshot_retention_days';
```

Server caches `display_timezone` for 60s — changes propagate within a minute.

### `analytics_event_display` valid keys

| Key | Default | Covers |
|---|---|---|
| `ImageTooBright` / `ImageTooBlurry` / `ImageTooDark` | ON | Image-quality diagnostics |
| `GlobalSceneChange` | ON | Scene-change / tamper hint |
| `Trigger/DigitalInput` | OFF | All digital input ports (folds &Input_1, &Input_2, FW 6-7.x IP-suffix variants) |
| `Trigger/Relay` | OFF | All relay/output ports |

---

## Daily-ops SQL Snippets

Run from the Mac:
```bash
docker exec -it vigil-postgres psql -U vigil_sql -d vigil_platform -c "..."
```

### Recent events (last 1h)
```sql
SELECT event_time, camera_id, event_type, rule_name, object_class, state
  FROM events
 WHERE event_time >= NOW() - INTERVAL '1 hour'
 ORDER BY event_time DESC LIMIT 50;
```

### Top rule_names today
```sql
SELECT rule_name, COUNT(*) AS n
  FROM events
 WHERE event_time >= NOW() - INTERVAL '24 hours'
   AND rule_name IS NOT NULL AND rule_name <> ''
 GROUP BY rule_name ORDER BY n DESC LIMIT 20;
```

### Per-category 24h count (matches what the dashboard shows)
```sql
SELECT c.name,
  COALESCE((SELECT COUNT(DISTINCT e.id) FROM events e
            JOIN event_category_rules r ON r.category_id = c.id
                 AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
                 AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
                 AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
                 AND (r.object_class IS NULL OR r.object_class = e.object_class)
                 AND (r.match_state  IS NULL OR r.match_state  = e.state)
            WHERE e.event_time >= NOW() - INTERVAL '24 hours'), 0) AS cnt
  FROM event_categories c ORDER BY c.sort_order, c.id;
```

### Active sessions
```sql
SELECT u.username, u.role, s.ip_address, s.last_used_at, s.expires_at
  FROM sessions s JOIN users u ON s.user_id = u.id
 WHERE s.expires_at > NOW() AND NOT s.revoked
 ORDER BY s.last_used_at DESC NULLS LAST;
```

### Manually purge events older than retention
```sql
DELETE FROM events
 WHERE event_time < NOW() - (
   (SELECT value FROM system_settings WHERE key='data_retention_days')::int
 ) * INTERVAL '1 day';
```

### Quick brand check
```sql
SELECT key, value FROM system_settings WHERE key LIKE 'brand_%';
```

### Health snapshot via SQL
```sql
SELECT
  (SELECT COUNT(*) FROM events) AS total_events,
  (SELECT COUNT(*) FROM events WHERE event_time > NOW() - INTERVAL '1 hour') AS events_1h,
  (SELECT MAX(event_time) FROM events) AS last_event,
  (SELECT COUNT(*) FROM cameras WHERE last_seen > NOW() - INTERVAL '90 seconds') AS cams_online,
  (SELECT COUNT(*) FROM cameras) AS cams_total,
  pg_size_pretty(pg_database_size('vigil_platform')) AS db_size;
```

### Distinct values for autocomplete (rule_name + event_type)
```sql
SELECT DISTINCT rule_name AS v FROM events
 WHERE rule_name IS NOT NULL AND rule_name <> '' ORDER BY v;

SELECT DISTINCT event_type AS v FROM events
 WHERE event_type IS NOT NULL ORDER BY v;
```

### Inspect categories + mapping rules
```sql
-- All categories
SELECT id, name, kind, is_builtin, sort_order
  FROM event_categories ORDER BY sort_order, id;

-- Mapping rules (NULL = wildcard)
SELECT r.id, c.name AS category, r.camera_id, r.rule_name,
       r.event_type, r.object_class, r.match_state, r.priority
  FROM event_category_rules r
  JOIN event_categories c ON c.id = r.category_id
 ORDER BY c.sort_order, r.priority DESC, r.id;
```

### Inspect scheduled reports
```sql
SELECT id, report_type, image_layout, send_time, enabled,
       last_run_at, last_status, last_error
  FROM report_schedules ORDER BY id;
```

### Report history (last 7 days)
```sql
SELECT status, COUNT(*), MIN(created_at) AS oldest, MAX(created_at) AS newest
  FROM report_history GROUP BY status;

SELECT created_at, report_type, error_message
  FROM report_history
 WHERE status != 'success' AND created_at > NOW() - INTERVAL '7 days'
 ORDER BY created_at DESC;
```

### Quiet-hours config on alert rules
```sql
-- active_from/active_to hold the QUIET window (not the active window — GOTCHAS #24)
SELECT id, name, enabled,
       active_from AS quiet_from, active_to AS quiet_to
  FROM alert_rules
 WHERE active_from IS NOT NULL OR active_to IS NOT NULL;
```

### Alert log status breakdown (last 24h)
```sql
SELECT status, COUNT(*)
  FROM alert_logs
 WHERE sent_at > NOW() - INTERVAL '24 hours'
 GROUP BY status ORDER BY 2 DESC;
-- status values: success | failed | cooldown_skip | quiet_hours_skip | no_recipients | disabled
```

### Camera offline status log
```sql
SELECT camera_id,
       MAX(changed_at) FILTER (WHERE status='offline') AS last_offline,
       MAX(changed_at) FILTER (WHERE status='online')  AS last_online
  FROM camera_status_log
 GROUP BY camera_id ORDER BY 2 DESC NULLS LAST;
```

### Snapshot check
```sql
SELECT camera_id, COUNT(*) AS frames, MAX(event_time) AS last_frame
  FROM events
 WHERE has_snapshot = TRUE
 GROUP BY camera_id;
```

### Migrations applied
```sql
SELECT filename, applied_at, duration_ms
  FROM schema_migrations ORDER BY filename;
```

### Truncate events but keep schema (dev only)
```sql
TRUNCATE appearances, license_plates, events CASCADE;
```

---

## Service Control

### Recommended — services.sh (กัน orphan process)
```bash
cd ~/vigil-platform
./scripts/services.sh start      # เปิดทั้ง stack
./scripts/services.sh stop       # ปิดทุก process ของโปรเจกต์
./scripts/services.sh restart    # ปิดให้สะอาด → เปิดใหม่
./scripts/services.sh status     # นับ instance + เตือนถ้าซ้ำซ้อน
```

> ⚠️ อย่า `pkill` แยกตัว หรือ `node x.js &` เอง — เคยทำให้เหลือ orphan process → event เข้าซ้ำสองเท่า

### Process management — PM2
```bash
cd ~/vigil-platform
./scripts/services.sh start    # start all workers (pm2 start ecosystem.config.js)
./scripts/services.sh stop     # stop all workers
./scripts/services.sh restart  # rolling restart
./scripts/services.sh status   # pm2 status
pm2 logs <name> --lines 50     # tail logs for a specific worker
```

### Fallback — individual npm scripts
```bash
cd ~/vigil-platform/src
npm run migrate      # migrations only (no api start)
npm run backup       # manual pg_dump → backups/*.dump
```

### npm scripts reference

| Command | ใช้ทำอะไร |
|---|---|
| `npm run api` | API server (auto-migrate ก่อน listen) |
| `npm run subscriber` | MQTT subscriber เท่านั้น |
| `npm run media-recorder` | RTSP rolling buffer เท่านั้น |
| `npm run hikvision` | Hikvision ISAPI ingester เท่านั้น |
| `npm run dahua` | Dahua CGI ingester เท่านั้น |
| `npm run simulator` | Synthetic event generator (dev/test) |
| `npm run migrate` | Run pending migrations only |
| `npm run backup` | pg_dump → `backups/*.dump` |
| `npm run restore <file>` | Restore from dump (interactive confirm) |
| `./scripts/services.sh start` | start all workers via PM2 (แนะนำ) |
| `pm2 start ecosystem.config.js` | เหมือนกัน — PM2 โดยตรง |

### Check Docker services
```bash
docker compose ps
# คาดหวัง: vigil-postgres + vigil-emqx สถานะ "Up"

# EMQX clients connected
docker exec vigil-emqx emqx ctl clients list

# EMQX active subscriptions
docker exec vigil-emqx emqx ctl subscriptions list

# Watch live traffic (specific pattern — '#' is ACL-denied)
docker run --rm --network host eclipse-mosquitto:2.0 \
  mosquitto_sub -h localhost -t '+/onvif-ej/#' -W 30 -F '[%I] %t'

# EMQX web dashboard — password set via EMQX_DASHBOARD_PASSWORD in .env
# (not 'admin/public' — that default is overridden at container start)
open http://localhost:18083
```

### Cloudflare Tunnel
```bash
# Status
ps aux | grep cloudflared | grep -v grep
# Should show ONE root-owned process

# Restart root service
sudo launchctl kickstart -k system/com.cloudflare.cloudflared
```

---

## Camera Offline Alerts — Quick SQL

```sql
-- เปิด alert ให้ทุกกล้อง (one-time bulk)
UPDATE camera_offline_alerts SET enabled = true;

-- ดู config ต่อกล้อง
SELECT c.id AS camera_id,
       a.enabled, a.notify_after_sec, a.escalate_interval_min,
       a.escalate_once, a.quiet_from, a.quiet_to
  FROM cameras c
  LEFT JOIN camera_offline_alerts a ON a.camera_id = c.id
 ORDER BY c.id;
```

---

## Auditor Role — Quick Reference

```sql
-- สร้าง auditor user ผ่าน SQL (ถ้า UI ไม่พร้อม)
INSERT INTO users (username, password_hash, role, force_password_change)
VALUES ('auditor1', '<bcrypt_hash>', 'auditor', false);

-- ดู users ทั้งหมด
SELECT username, role, created_at, last_login_at FROM users ORDER BY username;
```

Auditor เห็นทุกหน้า (รวม admin pages) แต่ POST/PUT/DELETE/PATCH ทุกอันถูก block server-side ด้วย 403 `read_only`. ดู LOGIC_auth-security.md #127 สำหรับ rationale เต็ม.

---

## Backup & Restore

```bash
# Manual backup
./scripts/backup.sh
# → backups/vigil_platform_<timestamp>.dump

# Restore (interactive, requires 'yes')
./scripts/restore.sh backups/vigil_platform_2026-05-09_030000.dump

# Inspect backup TOC (ไม่ใช่ plain SQL — อย่า cat)
pg_restore --list backups/vigil_platform_<ts>.dump | head -40

# Install daily auto-backup (one-time)
cp scripts/com.dojojin.dashboard.backup.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.dojojin.dashboard.backup.plist
```
