# LOGIC_line-notifications — LINE Notifications & Recipient Onboarding

> Canonical source for LINE notification behavior: alert delivery, imgbb
> image hosting, recipients, self-service onboarding, camera offline alerts,
> scheduled report delivery, and webhook security boundaries.
> Parent index: DECISIONS.md
> Last updated: 2026-06-08 · v1.5.0

---

## Current Status

LINE is a subsystem, not a single feature. It currently covers:

- Event alerts from Bosch MQTT, Hikvision ISAPI, and Dahua CGI ingesters.
- Per-camera offline/recovery alerts from heartbeat state.
- Scheduled analytics and health reports as LINE image messages.
- Manual Health Report "Send to LINE Now".
- Self-service recipient discovery via LINE webhook with admin approval.

Implementation status as of 2026-05-26:

- Core alert engine: shipped.
- Scheduled report delivery to LINE: shipped.
- Report history: shipped.
- Camera offline/recovery LINE alerts: shipped.
- Recipient onboarding Phase A: shipped.
- Recipient onboarding Phase B/C: pending.

---

## Data Model

| Table | Purpose |
|---|---|
| `line_config` | Single-row LINE settings: token, optional secret, imgbb key, enabled flag, recipient roster |
| `alert_rules` | Event alert matching: cameras, rule names, recipient subset, cooldown, quiet hours, snapshot flag, template |
| `alert_logs` | One row per alert attempt/skip; keeps rule/event snapshots after rule deletion |
| `pending_recipients` | Webhook-discovered users/groups/rooms waiting for admin approval |
| `camera_offline_alerts` | Per-camera offline/recovery LINE config and server-maintained state |
| `camera_status_log` | Online/offline transition history |
| `report_schedules` | Scheduled report delivery settings and last-run state |
| `report_history` | Scheduled/manual report send history and PNG archive metadata |

Recipient format in `line_config.recipients`:

```json
[
  { "type": "user", "id": "U...", "name": "Admin", "enabled": true },
  { "type": "group", "id": "C...", "name": "Security Team", "enabled": true }
]
```

`type` can be `user`, `group`, or `room`. LINE Messaging API sends only to opaque IDs (`U...`, `C...`, `R...`), not `@displayname`.

---

## Event Alert Flow

**#12 — imgbb for image hosting**
LINE cannot push local files directly; image-based alerts/reports must use a public HTTPS image URL. This system uses imgbb as the image host.

**#13 — In-memory cooldown cache / rule state**
Cooldown uses `alert_rules.last_triggered_at` and the in-memory rule cache. Cache refresh is frequent enough for admin rule edits without making every event query all config tables from scratch.

**#14 — Per-rule recipient filter**
Each alert rule can target a subset of `line_config.recipients`; empty `recipient_ids` means all enabled recipients.

1. Ingester inserts an event into `events`.
2. Ingester calls `alertEngine.onEvent()` with camera metadata, `rule_name`, event time, and optional snapshot filename.
3. `alert-engine.js` refreshes cached `alert_rules`, `line_config`, and `display_timezone`.
4. Each enabled rule is matched by `camera_ids` and `rule_names`; empty arrays mean "all".
5. Quiet hours are checked before cooldown.
6. Cooldown is checked using `last_triggered_at` and `cooldown_seconds`.
7. Recipients resolve from `line_config.recipients`; rule-level `recipient_ids` narrows the target list.
8. `line-sender.js` formats the message, optionally uploads the snapshot to imgbb, and pushes one LINE message object per recipient.
9. The result is logged to `alert_logs`.

Alert log statuses:

- `success`
- `failed`
- `cooldown_skip`
- `quiet_hours_skip`
- `no_recipients`
- `disabled`

**#90 — Per-rule quiet hours = SILENT window, NOT "active" window**
`alert_rules.active_from` / `active_to` are historical column names. Their current meaning is a quiet window: when `now ∈ [from, to)` in `display_timezone`, the rule is silenced and logged as `quiet_hours_skip`. NULL means no quiet window. Identical from/to means no quiet window. Cross-midnight windows are supported.

> STUBBORN_FACT: `alert_rules.active_from` / `active_to` hold the QUIET window, not an active window. Alerts fire when `now ∉ [from, to)`. Cross-midnight windows are supported. See GOTCHAS #24 and Decision #90.

---

## Message & Quota Strategy

LINE quota is counted by message objects in the `messages[]` array. Alert and report delivery therefore use a single Flex message object whenever an image is attached:

- Alert with snapshot: one Flex bubble containing image + text.
- Alert without snapshot: one text message.
- Report image: one Flex bubble containing report preview + caption.

**Quota summary by message type:**

| กรณี | API | นับ quota? |
|---|---|---|
| Webhook auto-reply (register / re-register) | Reply | ❌ ฟรี |
| Approval notification (admin approve) | Push | ✅ ~1/approval |
| Alert push | Push | ✅ 1/recipient/alert |
| Scheduled report | Push | ✅ 1/recipient/schedule |
| Health report send-now | Push | ✅ 1/recipient |

> STUBBORN_FACT: Do not split text and image into two LINE messages for the same alert/report unless the owner explicitly accepts the quota cost.

---

## Image Hosting

LINE Messaging API cannot directly upload arbitrary local image files as part of a push. The system uploads images to imgbb first, then sends the public URL in a LINE Flex/image message.

Current implementation:

- Snapshot file path: `snapshots/<filename>` → base64 → imgbb → Flex alert.
- Report PNG buffer: Puppeteer screenshot buffer → imgbb → Flex report.
- imgbb expiration in code is `172800` seconds (48 hours).
- If imgbb upload fails, event alerts fall back to text-only; report sends fail because the image is the delivery vehicle.

> STUBBORN_FACT: Scheduled reports go to LINE as IMAGE only. LINE has no file/document push type suitable for PDF delivery. See Decision #91.

---

## Camera Offline Alerts

Camera offline alerts are per-camera and use heartbeat state, not event volume.

Flow:

1. `checkOfflineCameras()` compares `cameras.last_seen_at` against `OFFLINE_THRESHOLD_SEC`.
2. Online/offline transitions are written to `camera_status_log`.
3. If the camera remains offline beyond `notify_after_sec`, LINE alert can fire.
4. Repeat behavior is controlled by `escalate_interval_min` unless `escalate_once=true`.
5. Quiet hours use `quiet_from` / `quiet_to`.
6. Recipients come from per-camera `recipient_ids`; blank means all enabled recipients.
7. Recovery alert fires once if an offline alert had been sent and the camera comes back online.

This path sends plain text via `pushLineMessage()`; it does not use imgbb.

---

## Report Delivery

**#91 — Scheduled reports go to LINE as IMAGE only — no PDF on LINE**
LINE Messaging API has no file/document message type suitable for direct PDF delivery. The supported workflow is scheduler/manual action -> Puppeteer PNG render -> imgbb upload -> LINE Flex push.

Scheduled reports reuse the same LINE recipient roster:

- `report_schedules.recipients` is a CSV of LINE recipient IDs.
- Empty CSV means all enabled recipients in `line_config.recipients`.
- Daily/weekly/monthly analytics reports render PNG via Puppeteer.
- Health reports render via `renderHealthReportImage()`.
- Every attempt is recorded in `report_history`.
- Manual Health Report send uses `POST /api/health/report/send-now` and logs with `schedule_id=NULL`.

See `docs/LOGIC_stats-reports.md` for report range, renderer, Puppeteer, and health-section decisions.

---

## Recipient Self-service Onboarding

Goal: avoid asking end users to manually know/copy LINE `userId` or `groupId`.

Implemented Phase A–D:

1. End user adds/messages the LINE OA, or the bot joins a group.
2. LINE calls `POST /api/line/webhook`.
3. Webhook verifies `X-Line-Signature` when `channel_secret` exists.
4. For `message`, `follow`, or `join` events, source ID is extracted.
5. If token is configured, the server calls LINE Profile API or Group Summary.
6. Row is upserted into `pending_recipients` via CTE that captures `prev_status` before update.
7. `shouldReply = status==='pending' && (inserted || prev_status!=='pending')` — fires auto-reply for new users AND deleted users who re-register, but NOT for already-pending or approved users.
8. Admin approves, ignores, or **blocks** in Settings > LINE Config > "ตรวจพบใหม่".
9. Approve promotes the ID into `line_config.recipients`, marks pending row `approved`, then **pushes an approval notification** to the user async (th+en, Push API, ~1 quota per approval). Error is logged as warning only — does not block the approve response.
10. When admin deletes a recipient via `PUT /api/line-config`, server resets their `pending_recipients.status` from `'approved'` → `'ignored'` so they re-appear if they message again.

**`pending_recipients` status lifecycle:**

| Status | Meaning | Next state on message |
|---|---|---|
| `pending` | Waiting for admin approval | stays `pending` (no repeat reply) |
| `approved` | Admin approved; ID is in `line_config.recipients` | stays `approved` |
| `ignored` | Admin ignored (soft); or deleted from recipients | → `pending` + auto-reply |
| `blocked` | Admin blocked (hard); permanently silenced | stays `blocked` (no reply, no pending) |

Phase status:

| Phase | Status | Scope |
|---|---|---|
| Phase A | Done | Migration 023, webhook store-and-suggest, Profile API / Group Summary, admin approve/ignore UI, auto-reply, pending retention |
| Phase B | Done (2026-05-27, `8b359b6`) | QR code render, OA `basicId` setting, step-by-step onboarding guide, migration 026 |
| Phase C | Done (2026-05-27) | `leave`/`unfollow` webhook events disable recipient + mark pending as ignored |
| Phase D | Done (2026-05-27, `b0adf0e`) | Block list — migration 028 adds `'blocked'` status; POST block/unblock endpoints; Blocked List UI; webhook CASE prevents status change for blocked IDs; decision #149 |

> STUBBORN_FACT: New LINE recipients require admin approval. Do not auto-add webhook senders directly to `line_config.recipients`.

> STUBBORN_FACT (GOTCHAS #46): ถ้า deploy ก่อน Phase D แล้วมี recipients ถูกลบออกไปแล้ว ให้รัน one-time cleanup SQL เพื่อ reset orphaned 'approved' rows — ดู GOTCHAS #46 สำหรับ query.

---

## Webhook Security

`/api/line/webhook` is public by necessity, but signed by LINE.

- Raw body must be preserved for HMAC-SHA256 verification.
- Signature header: `x-line-signature`.
- Secret source: `line_config.channel_secret`.
- If `channel_secret` is unset, verification is skipped for backward compatibility.
- The route returns 200 on handler errors after logging, to avoid LINE retry storms.

> STUBBORN_FACT: Never use `express.json()` alone for HMAC-signed webhook routes. Verification must use raw bytes. See Decision #129.

---

## Pending Work

- ~~Add QR code / OA `basicId` onboarding guide in Settings > LINE Config.~~ — done Phase B (2026-05-27, commit `8b359b6`)
- Decide whether production setup should require `channel_secret` before enabling webhook recipient discovery.
- ~~Add explicit `leave` handling if customers use group recipients heavily.~~ — done Phase C (2026-05-27): `leave`/`unfollow` events disable recipient in `line_config.recipients`.
- ~~Add an operator-facing LINE quota panel.~~ — done 2026-05-27 (commit `8def7a7`): `GET /api/line-config/quota` proxies LINE `/v2/bot/message/quota` + `/v2/bot/message/quota/consumption`; UI shows progress bar + used/limit counter in LINE Config panel. Note: Reply API ไม่นับ quota — แค่ Push.
- ~~Fix Health Report alert cooldown summary to count `cooldown_skip`, not `cooldown`.~~ — fixed 2026-05-27 (`GET /api/health/report-data/alerts` query)
- ~~Block list for permanent-ignore recipients.~~ — done Phase D (2026-05-27, commit `b0adf0e`): migration 028, 4 endpoints, block/unblock UI, webhook CASE guard.

---

## Related Files

- `src/alert-engine.js` — rule matching, cooldown, quiet hours, alert logging
- `src/line-sender.js` — LINE push/reply APIs, imgbb upload, Flex message builders
- `src/api-server.js` — LINE config routes, pending recipient routes, webhook, report scheduler, offline checker
- `src/mqtt-subscriber.js` — Bosch alert hook
- `src/ingesters/hikvision-isapi.js` — Hikvision alert hook
- `src/ingesters/dahua-cgi.js` — Dahua alert hook
- `db/db_migration_alerts.sql` — base LINE config/rules/logs tables
- `db/db_migration_012_alert_quiet_hours.sql` — quiet-hour columns
- `db/db_migration_018_camera_offline_alerts.sql` — offline alerts + status log
- `db/db_migration_019_escalate_once.sql` — no-repeat offline alerts
- `db/db_migration_021_report_history.sql` — report history
- `db/db_migration_023_pending_recipients.sql` — self-service onboarding
- `dashboard/index.html`, `dashboard/dashboard.js`, `dashboard/i18n.js` — LINE config, rules, recipients, logs UI
- `docs/REF_troubleshooting.md` — operational LINE troubleshooting
