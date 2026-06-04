# REF_troubleshooting — Troubleshooting & Camera Lifecycle

> Extracted from SKILL.md §8 (Common troubleshooting) and §9 (Camera lifecycle).
> For SQL snippets → REF_operator-sql.md
> For category mapping recipes → SKILL.md §3
> Last updated: 2026-05-24 · v1.5.0

---

## Event & Category Issues

### §8.1 — "My new category shows 0 — but events exist"

Almost always one of:
- **State filter mismatch.** Rule has `match_state='true'` but events are `LineDetector/Crossed` (state is NULL). Change State to `(any)`.
- **rule_name typo.** Use the autocomplete dropdown — pulls real values from events table.
- **event_type typo.** Looking for `CrossingLine` but Bosch publishes `LineDetector/Crossed`.
- **object_class column is empty for that event_type.** FieldDetector events don't carry object_class — filtering by `Person` excludes all of them.

Verify what the rule should match:
```sql
SELECT rule_name, event_type, object_class, state, COUNT(*)
  FROM events
 WHERE event_time >= NOW() - INTERVAL '24 hours'
 GROUP BY rule_name, event_type, object_class, state
 ORDER BY 5 DESC LIMIT 30;
```

### §8.2 — "Comparison shows ▲ 9000% — that can't be right"

Baseline (previous window) was tiny (1–3 events). Stats v2 replaces this with `▲ +N events` when `prev_count < 5`. If still wrong: window too short, or mapping rule was just changed (previous window was empty → should now read `↑ NEW`).

### §8.3 — "Daily/Weekly/Monthly view is empty"

Confirm `system_settings.display_timezone` is valid IANA TZ (not "GMT+7"):
```sql
SELECT value FROM system_settings WHERE key='display_timezone';
```
Stats page presets use calendar boundaries (midnight onward, Monday onward, day 1 onward) — not rolling windows. For rolling 24h, use Custom range.

### §8.4 — "Mapping rule not appearing in the list after Add"

Hard reload first (`Cmd+Shift+R`). The rules-list GET is cache-busted (`?_=Date.now()`, `cache:'no-store'`). Check browser console for `[Rule Add]` and `[Rules]` log lines.

---

## Camera & MQTT Issues

### §8.5 — "All cameras say offline but they're online"

1. Subnet: Mac must be on `192.168.10.x`. Check `ifconfig | grep 192.168.10`.
2. Subscriber stopped: `pgrep -f mqtt-subscriber` — if blank, run `pm2 restart mqtt-subscriber` (or `./scripts/services.sh start`).
3. MotionAlarm-only traffic: filtered before insert but DOES update `last_seen` (keepalive). Cameras stay online but `events` rows don't accumulate.
4. ONVIF poller: also touches `last_seen` every 30s. If both MQTT and ONVIF are silent, camera really is unreachable.

### §8.8 — "Browser tab favicon doesn't show uploaded logo"

Three things must align:
1. `system_settings.brand_logo_path` is non-empty.
2. File exists under `branding/` — check `ls branding/`.
3. Hard-reload the browser (`Cmd+Shift+R`) to clear the favicon cache if you upgraded mid-session.

```bash
curl -sI http://localhost:3000/favicon.ico | head -3
# expect: HTTP/1.1 200 OK + Content-Type: image/png
```

### §8.11 — "Mobile layout broken on iPad in landscape"

The `≤768px` breakpoint catches iPhone + iPad portrait. iPad landscape (1024px+) uses desktop layout. Modify the `@media (max-width: 768px)` block in `index.html` if a wider tablet breakpoint is needed.

### §8.9 — "Health page shows MQTT stale even though events flowing"

`mqtt_pipeline.status` is computed from `MAX(event_time)`. If camera clock skew is bad (event_time in past), freshness check is wrong. Check camera NTP.

### §8.13 — "Camera is in the config but events don't appear"

**First suspect: invisible characters in `camera_id`.**
```sql
-- Check for non-ASCII bytes
SELECT camera_id, length(camera_id) AS chars, octet_length(camera_id) AS bytes
  FROM cameras WHERE camera_id ~ '[^[:ascii:]]';

-- See what camera_id the camera actually publishes under
SELECT camera_id, COUNT(*) FROM events
 WHERE received_at > NOW() - INTERVAL '1 hour'
 GROUP BY camera_id ORDER BY 1;
```
Watch subscriber log for: `⚠️ MQTT id "X" matches config id "Y" except for non-printable characters`.

Other causes:
1. MQTT topic prefix mismatch in Bosch CM.
2. Camera not calibrated for IVA Basic (but events still flow with `object_class=NULL`).
3. Camera publishing only metric events (`CountAggregation/Counter`) — filtered from Events Live feed.
4. Broker rejecting camera's MQTT packets — see §8.14.

### §8.14 — "Events from some cameras but not others — old-firmware Bosch silent"

**Diagnostic:**
```bash
# Post-2026-05-19 (EMQX) — this should be EMPTY:
docker logs vigil-emqx 2>&1 | grep -i malformed | tail

# Listen for live PUBLISH (-R suppresses retained):
docker run --rm --network host eclipse-mosquitto:2.0 \
  mosquitto_sub -h localhost -t 'BOSCH_8000i/#' -W 30 -R -F '[%I] %t'
```

Root cause: older Bosch firmware emits MQTT 3.1 packets that Mosquitto 2.x's strict validator rejects. Fix: swap to EMQX 5.8. See LOGIC_camera-ingesters.md #112.

### §8.15 — "Camera misses some events — object crossed the line but nothing appeared"

**Controlled walk test:**
```bash
# 1. Start raw MQTT capture:
docker run --rm --network host --name walktest eclipse-mosquitto:2.0 \
  mosquitto_sub -h localhost -t 'BOSCH_8000i/onvif-ej/RuleEngine/#' \
  -F '[%I] retain=%r | %t'

# 2. Walk across the line N times (count out loud).
# 3. Stop capture (Ctrl+C).
# 4. Count DB rows for the same window:
docker exec vigil-postgres psql -U vigil_sql -d vigil_platform -c "
  SELECT COUNT(*) FROM events
   WHERE camera_id='BOSCH_8000i' AND event_type LIKE 'LineDetector%'
     AND received_at > NOW() - INTERVAL '5 minutes';"
```

Interpret: walked=8 / MQTT=3 / DB=3 → **camera missed (layer 1 problem, not dashboard)**. walked=8 / MQTT=8 / DB=3 → **pipeline dropped events (escalate to dev)**.

Camera-side fixes (Bosch CM → VCA): Camera Calibration + Object Calibration, direction=Both, move line away from frame edge, lower min object size, raise tracker sensitivity.

### §8.16 — "GlobalSceneChange keeps coming but I disabled it in Bosch CM"

Two different systems share a similar name:
- **VCA "Global Scene Change"** — IVA detector inside VCA/rule config. Publishes under `RuleEngine/…`.
- **VideoSource "GlobalSceneChange/AnalyticsService"** — device-level ONVIF AnalyticsService. Publishes under `VideoSource/…`.

Disabling in Bosch CM only disables the VCA one. To confirm:
```sql
SELECT event_category, event_type, COUNT(*)
  FROM events
 WHERE camera_id='BOSCH_8100i' AND event_type LIKE 'GlobalSceneChange%'
 GROUP BY 1,2;
-- event_category = 'VideoSource' → device AnalyticsService (NOT the VCA toggle)
```

Mostly IR/lighting false-positives — clusters at dusk and through the night. Fix: disable in Settings → uncheck GlobalSceneChange in 📷 Camera Analytics Events.

---

## LINE Alert Issues

### §8.6 — "LINE alert arrives but it's text-only (no image)"

Check in order:
- `line_config.imgbb_api_key` is empty.
- imgbb upload failed — search subscriber log for `🔔 imgbb upload failed`.
- Snapshot capture failed — search for `📷 MQTT/HTTP snapshot save error`.
- `alert_rules.send_snapshot=false` for the rule that fired (intentional).

```sql
SELECT id, rule_name, status,
       substring(message_text FROM 1 FOR 80) AS msg,
       substring(error_message FROM 1 FOR 80) AS err
  FROM alert_logs WHERE sent_at > NOW() - INTERVAL '1 hour'
  ORDER BY id DESC LIMIT 10;
```

### §8.7 — "LINE alerts not arriving — `status='failed'` with `monthly limit`"

Read LINE API quota directly:
```bash
TOKEN=$(docker exec vigil-postgres psql -U vigil_sql -d vigil_platform -t -A \
  -c "SELECT channel_access_token FROM line_config WHERE id=1;")
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.line.me/v2/bot/message/quota
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.line.me/v2/bot/message/quota/consumption
```

Mitigations:
1. Upgrade Light Plan (~600 THB/mo → 5,000 msgs/mo).
2. Each alert/report is already 1 LINE message (Flex bubble). If seeing 2×, restart api-server + mqtt-subscriber.
3. Bump `alert_rules.cooldown_seconds`, or widen quiet window (REMEMBER: `active_from`/`active_to` hold the QUIET range, not active — GOTCHAS #24).

---

## Storage & Retention Issues

### §8.10 — "Snapshot disk filling up — retention not working"

```sql
SELECT value FROM system_settings WHERE key='snapshot_retention_days';
```
Job runs 90s after server start, then every 24h. Verify by tailing api log: `🧹 Snapshot retention: deleted X/Y files older than N days`.
File mtime is the cutoff — NOT filename timestamp. `cp` without `-p` resets mtime to now → files won't get pruned for 30 days.

### §8.12 — "Clip ends before the object finishes crossing the line"

**Root cause (Phase 6.1.11):** Bosch FW 9.80.106 stamps `LineDetector/Crossed` events with the *track's appearance time*, not the crossing moment — often 5–10s in the past. Camera clock also drifts vs host. The original recorder anchored the clip window to `msg.UtcTime`, so the window pointed several seconds off from the actual ffmpeg segments on disk.

**Fix:** anchor to `received_at_ms = Date.now()` at MQTT receive time, which matches ffmpeg's `-strftime '1'` segment filenames exactly.

**Load-bearing contract — do NOT break:**
1. `mqtt-subscriber.js` and `media-recorder.js` MUST run on the same clock domain (same host → same `Date.now()`). If ever split across machines, NTP-sync both.
2. ffmpeg segmenter MUST keep `-strftime '1'` (Unix-seconds filenames). Switching to PTS-based or sequence-based naming breaks the window math.
3. The NOTIFY payload MUST include `received_at_ms`. If a subscriber version skips the field, the recorder logs `⚠️ NOTIFY payload missing received_at_ms` and falls back to the old broken anchor — catch this in logs immediately.

**What's expected behaviour, not a bug:**
- Bosch 2s GOP forces segment boundaries to keyframes → expect ~1s loss at each clip end.
- MQTT delivery latency (~100ms LAN) shifts the action moment ~100ms into the clip.
- Want more? Bump `clip_pre_sec` / `clip_post_sec` per camera — the window math is correct, the extra seconds land where you want them.

### §8.18 — "Event-listing pages must be realtime (no manual refresh)"

**This is a non-negotiable project rule set by owner.** Any page that lists events — เหตุการณ์ (Live), Snapshot, Media, ภาพใบหน้า — MUST surface a new event the moment it arrives, with NO page refresh required.

**Mechanism — WebSocket push:**
`mqtt-subscriber` / Hikvision / Dahua ingesters raise a Postgres `NOTIFY` → api-server's `listenClient` picks it up, queries the row, `broadcast()`s a typed WS message → `dashboard.js` `ws.onmessage` routes it:

| WS type | Pages that react |
|---|---|
| `new_event` | Live feed prepends · Camera page bumps counts · Snapshot page reloads page 1 (delayed ~2.5s — snapshot captured shortly AFTER INSERT) |
| `new_face` | ภาพใบหน้า reloads gallery + demographic summary |
| `clip_done` | Media page reloads · Snapshot page refreshes clip badges |

**When adding a new event-listing page:** wire its live-refresh into `ws.onmessage` in the SAME change as the page itself. A page that needs F5 to see new events is a bug.

---

## Puppeteer / Reports Issues

### §8.19 — "Health Report กด Preview แล้ว 500 / ค้าง"

ตั้งแต่ 2026-05-26 Health Report PNG preview ไม่ควรใช้ Puppeteer แล้ว:
```bash
grep -n "sharp(Buffer.from(svg))" src/report-renderer.js
```
ถ้า endpoint ยังล้ม ให้แยกเช็ค data endpoint ก่อน (`/api/health/details`, `/api/health/report-data/cameras`, `/api/health/report-data/alerts`). ถ้า data endpoint ผ่านแต่ preview ล้ม ให้ดู `sharp`/SVG renderer และอย่าแก้โดยย้ายกลับไป `page.screenshot()`; เคย reproduce แล้วว่า Chromium/CDP ค้างจน preview 500. SVG text ต้องผ่าน `_svgSafeText()` เพื่อกัน `librsvg/Pango` crash จาก emoji fallback font.

### §8.20 — "Health Report sections ขึ้น '⚠️ โหลดไม่สำเร็จ'"

`/api/health/details` ใช้ `auth.requireAdminOrAuditor`. ตั้งแต่ commit `ac13f15` middleware นี้ honor `req.internal===true` แล้ว ถ้า regress:
```bash
grep "req.internal === true" src/auth.js
# ต้องเห็น 3 จุด: requireAuth, requireAdmin, requireAdminOrAuditor
```

### §8.21 — "Frame ล่าสุด: ไม่เคยมี frame"

ตั้งแต่ migration 025 ระบบใช้ `events.has_snapshot` สำหรับ snapshot filter. ตรวจ:
```sql
SELECT camera_id, COUNT(*) AS frames, MAX(event_time) AS last_frame
FROM events WHERE has_snapshot = TRUE
GROUP BY camera_id;
```
ถ้า query นี้คืนข้อมูลแต่ report ขึ้น "ไม่เคยมี frame" → bug regress ใน health report query.

---

## UI Issues

### §8.17 — "A date field looks different / shows 12-hour time"

Every datetime input must use flatpickr. If one looks different, its `<input>` id was not registered. Check `_DT_DATETIME_IDS`, `_DT_DATE_IDS`, `_DT_MONTH_IDS` arrays in `dashboard.js`. Clear/set via `clearDtValue(id)` / `setDtValue(id, date)` — never `el.value = ''`.

### §8.19 — "CORS error" or "LIVE badge stuck on Reconnecting…"

**CORS:** reach the dashboard the normal way (Cloudflare domain, LAN IP, localhost) = same-origin = always passes. If a separate app needs cross-origin access, add to `ALLOWED_ORIGINS` in `src/.env`.
**WebSocket auth:** if LIVE badge shows "Reconnecting…" AND browser console shows `401` → session expired. Reload / log in again.

### §8.22 — "Camera offline alert ส่ง LINE ทุก 60 นาที — ไม่หยุด"

Default `escalate_interval_min=60`. Settings → 📷 Cameras → edit camera → ☑ "แจ้งครั้งเดียว (ไม่แจ้งซ้ำ)" (`escalate_once`) → save.

---

## Camera Lifecycle

### Add a camera

Use `⚙️ ตั้งค่ากล้อง` in sidebar (admin). Vendor-adaptive form — pick vendor first.

| Vendor | Ingest | Notes |
|---|---|---|
| **Bosch** | MQTT (`mqtt-subscriber`) | Original path |
| **Hikvision** | ISAPI (`hikvision-isapi.js` — restart to pick up new cameras) | Smart Events + Face Capture |
| **Dahua** | CGI (`dahua-cgi.js` — restart to pick up new cameras) | Smart Plan must be active in camera UI |
| **ONVIF** | none — monitor-only | Live view + online status only; no events/alerts/clips |

### Remove a camera

`DELETE /api/cameras/:id` — removes from JSON config + camera groups, cascades delete through `events`, `appearances`, `license_plates`, `cameras` table.

### Replace failed camera with same model

**REUSE the existing `camera_id`.** Don't add a parallel entry — fragments historical events and silences alert rules.
1. Reconfigure Bosch CM on replacement: Topic prefix = SAME camera_id.
2. Update only changed fields in cameras-config.json (IP, credentials).
3. No DB cleanup, no alert-rule updates needed.

### When you DO need a service restart

- Editing `src/.env`
- Editing any `.js` source file
- Adding a new Hikvision or Dahua camera (ingesters load config once at boot)
