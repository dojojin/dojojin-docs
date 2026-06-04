# SKILL.md — DojoJin Tech Dashboard Operations

> Operator's core playbook: mental model, mapping recipes, branding,
> health check overview, and feature summaries.
>
> **Troubleshooting steps** → `docs/REF_troubleshooting.md`
> **SQL snippets + service commands** → `docs/REF_operator-sql.md`
> **Design rationale** → `docs/LOGIC_*.md` files
>
> Last updated: 2026-05-26 · v1.5.0

---

## Table of Contents

1. [Mental model](#1-mental-model)
2. [Bosch IVA event shape](#2-bosch-iva-event-shape)
3. [Mapping rule recipes](#3-mapping-rule-recipes)
4. [System Settings reference](#4-system-settings-reference)
5. [White-label branding](#5-white-label-branding)
6. [Health Check page](#6-health-check-page)
7. [Reports overview](#7-reports-overview)
8. [Language / i18n](#8-language--i18n-thai--english)
9. [Camera Offline Alerts (Ph.1)](#9-camera-offline-alerts-ph1)
10. [Report History (Ph.2)](#10-report-history-ph2)
11. [System Health Report (Ph.3)](#11-system-health-report-ph3)
12. [Auditor role](#12-auditor-role-read-only)
13. [License notes (Phase 8)](#13-license-operator-notes-phase-8)
14. [Dahua snapshot notes](#14-dahua-snapshot-notes)

---

## 1. Mental model

```
┌─────────┐         ┌──────────────────────┐         ┌──────────────────────┐
│ Cameras │ ──────► │  events (raw rows)   │ ──join─►│  event_categories    │
└─────────┘  MQTT   │  rule_name, type,    │  rules  │  (display grouping)  │
                    │  state, object_class │         └──────────────────────┘
                    └──────────────────────┘
```

- **Events** are immutable raw observations.
- **Categories** are display labels (created by admin).
- **Mapping rules** decide which raw events feed into which categories.
- A single event can be in **many categories** (all-match).
- Category counts are **always recomputed at query time** — edit a mapping → effect is immediate, retroactive.

### Event pipeline — 3 layers

```
┌────────────┐   ┌──────────┐   ┌──────────────────────────────┐
│ 1. CAMERA  │──►│ 2.BROKER │──►│ 3. DASHBOARD                 │
│ (IVA/VCA)  │   │  (EMQX)  │   │ subscriber → DB → API → UI   │
└────────────┘   └──────────┘   └──────────────────────────────┘
  decides what    pure transport   can DROP (IGNORED_EVENT_TYPES)
  to detect &     — never adds,    or HIDE (analytics_event_display)
  fire as event   drops, or edits  but cannot INVENT what camera missed
```

**Golden rule for debugging:** raw MQTT count vs DB count. If equal, the problem is the camera (layer 1). See `docs/REF_troubleshooting.md §8.15`.

### Stats drill-down sanity check

When a Stats visual links to `เหตุการณ์ (Live)`, compare the source endpoint
and target endpoint scopes, not only the visible label.

| Source visual | Source API | Target must include |
|---|---|---|
| Activity Heatmap | `/api/stats/heatmap` | `from`, `to`, `cameras`, `category_id`, `dow`, `hour` |
| Category KPI / pie | `/api/stats/categories` | `from`, `to`, `cameras`, `category_id` |
| Per-camera bars | `/api/stats/per-camera-counts` | `from`, `to`, `camera`, class/category constraints |
| Top Rules | `/api/stats/top-rules` | `from`, `to`, `cameras`, `rule_name` |

If the numbers differ, first inspect the actual `/api/events?...` query string.
The Events page paginates server-side, so all drill filters must reach
`/api/events` before `LIMIT/OFFSET`. See GOTCHAS #44.

---

## 2. Bosch IVA event shape

| `event_type` | `object_class` | `state` | What it represents |
|---|---|---|---|
| `LineDetector/Crossed` | `Person` (etc.) | `''` / NULL | One row = one crossing event |
| `FieldDetector/ObjectsInside` | NULL | `'true'`/`'false'` | Enter / leave a watched area |
| `ObjectTrack/Aggregation` | `Person` (etc.) | NULL | Tracker aggregation — fires multiple times |
| `VideoSource/GlobalSceneChange` | NULL | `'true'`/`'false'` | Scene change (lighting, big motion) |
| `MotionAlarm` | — | — | **Filtered out** before insert |
| `RecordingConfig/JobState` | — | — | **Filtered out** before insert |

**Key:** `state` only populated for FieldDetector / SceneChange. LineDetector rows have `state = NULL` → mapping rule with `match_state='true'` will miss them entirely.

---

## 3. Mapping rule recipes

`(any)` = NULL in UI = wildcard matches anything.

### 3.1 — Count every person who crosses any line (any camera)

| Field | Value |
|---|---|
| Camera | `* (any)` |
| Rule Name | `(blank = any)` |
| Event Type | `LineDetector/Crossed` |
| Object Class | `Person` |
| State | `(any)` |

### 3.2 — Count people entering a forbidden area (enter only)

| Field | Value |
|---|---|
| Camera | `(any)` |
| Rule Name | `ห้ามคนเข้า` *(your IVA rule name)* |
| Event Type | `FieldDetector/ObjectsInside` |
| Object Class | `(any)` |
| State | `true (enter)` |

Use `State = true` — counts once when they enter, not twice.

### 3.3 — Catch-all "Alerts" category (any rule firing)

| Field | Value |
|---|---|
| Camera | `(any)` |
| Rule Name | `(blank = any)` |
| Event Type | `(blank = any)` |
| Object Class | `(any)` |
| State | `(any)` |

### 3.4 — Vehicle counter (any class)

Add one rule per class to the Vehicle Counting category:

```
event_type=LineDetector/Crossed, object_class=Car,        state=(any)
event_type=LineDetector/Crossed, object_class=Truck,      state=(any)
event_type=LineDetector/Crossed, object_class=Bus,        state=(any)
event_type=LineDetector/Crossed, object_class=Motorcycle, state=(any)
event_type=LineDetector/Crossed, object_class=Bicycle,    state=(any)
event_type=LineDetector/Crossed, object_class=Van,        state=(any)
event_type=LineDetector/Crossed, object_class=Vehicle,    state=(any)
```

### 3.5 — Camera-specific rule

| Field | Value |
|---|---|
| Camera | `BoschCam1` |
| Rule Name | `WrongWay` |
| Event Type | `(any)` |
| State | `true (enter)` |

---

## 4. System Settings reference

→ Full reference with SQL edit commands: `docs/REF_operator-sql.md`

Quick lookup of keys:

| Key | Default | Effect |
|---|---|---|
| `data_retention_days` | `365` | Daily DELETE of old events |
| `snapshot_retention_days` | `30` | Daily file unlink of old snapshots |
| `display_timezone` | `Asia/Bangkok` | Day-boundary alignment for all stats |
| `brand_name` | `DojoJin Tech Dashboard` | Product name everywhere |
| `brand_primary_color` | `#5b8def` | CSS `--accent` color |
| `analytics_event_display` | `ImageTooBright,ImageTooBlurry,ImageTooDark,GlobalSceneChange` | Which automation events shown in Stats/feed |

---

## 5. White-label branding

### Where the brand appears

| Location | What's branded |
|---|---|
| Sidebar header | logo + name + tagline |
| Browser tab favicon | logo |
| Login / Disclaimer page | logo + product name |
| PDF Reports | logo + name in header |
| CSS `--accent` | primary color across all UI |

### How to set it

Settings → ⚙️ System → 🎨 Branding (admin only):
- Upload logo (PNG/JPG/WebP/SVG, max 5MB) → auto-resize 256×256 PNG
- Edit name + tagline + accent color

```bash
# API — upload logo
curl -F "logo=@logo.png" -H "Cookie: <session>" \
  http://localhost:3000/api/branding/logo

# Public read (no auth needed)
curl http://localhost:3000/api/branding
# → {name, tagline, logo_url, primary_color}  ← use THESE names, not brand_* keys
```

> Footer `© DojoJin Tech` is **hardcoded** — only the product name on the left is editable.

---

## 6. Health Check page

Sidebar → **💓 Health Check** (admin only). Auto-refreshes every 15s.

| Card | Shows |
|---|---|
| 🗄️ Database | Postgres latency, total events, 1h/24h event rate |
| 📡 MQTT Pipeline | Last event timestamp, age, status (`healthy`/`idle`/`stale`) |
| 📷 Cameras | online/offline counts (heartbeat <90s) |
| 💾 Storage | Snapshot file count + size, disk free/total |
| ⚙️ Service Processes | Per-service instance count — `1x` OK / `0x` down / `>1` ⛔ DUPLICATE |
| ⚙️ API Server | Process uptime, RSS memory, WebSocket clients |
| 🖥️ Host | Hostname, platform, RAM, load avg |

Status thresholds: MQTT stale >1hr, memory >85%, disk >90%.

```bash
curl -H "Cookie: <session>" http://localhost:3000/api/health/details | jq
```

---

## 7. Reports overview

Reports tab → 5 types: **Daily / Weekly / Monthly / Custom / 🏥 Health**

| Type | Range |
|---|---|
| Daily | 00:00–23:59 of selected date (display_timezone) |
| Weekly | Monday 00:00 – Sunday 23:59 |
| Monthly | First to last day of month |
| Custom | from+to, capped by `custom_range_max_days` |
| 🏥 Health | 24h/7d/30d/custom — see §11 |

**Scheduled delivery (Phase 7.3):** Settings → 🔔 LINE → 📅 ตั้งค่าส่งอัตโนมัติ. Each schedule generates PNG → LINE via imgbb. `send_day_of_week` gates weekly; `send_days_of_month` gates monthly. Every fire logged to `report_history` — see §10. LINE delivery rules live in `docs/LOGIC_line-notifications.md`.

**Analytics report export:** click 📥 ดาวน์โหลด PDF → Puppeteer renders A4 PDF (Thai fonts, text selectable).

---

## 8. Language / i18n (Thai / English)

Dashboard เป็น 2 ภาษา — engine: `dashboard/i18n.js` (vanilla, ไม่มี dep). Thai = source, English = translation layer.

**สลับภาษา:** ปุ่ม `ไทย / EN` ในเมนูผู้ใช้, login, disclaimer → เก็บใน `localStorage.dashboard_lang` → reload หนึ่งครั้ง.

**เพิ่ม string ใหม่:**
1. เพิ่ม key ใน `dashboard/i18n.js` — **ทั้ง `th` และ `en` block** (ขาดข้างเดียว = fallback เงียบ)
2. Static markup → `data-i18n` / `data-i18n-html` / `data-i18n-ph` / `data-i18n-title`
3. JS dynamic → `I18N.t('key', fallback)`
4. datetime input ใหม่ → register id ใน `_DT_*_IDS` ด้วย (GOTCHAS #35)

**ตรวจ string หลุด:**
```bash
grep -rn '[฀-๿]' dashboard/index.html dashboard/dashboard.js | grep -v 'data-i18n'
```

**รายงาน export:** analytics report = ไทยเสมอ (Puppeteer context ใหม่ไม่รู้ภาษา). Health report = ตามภาษาที่เลือก (`HR_LABELS.{th,en}` dict ใน `report-renderer.js`).

---

## 9. Camera Offline Alerts (Ph.1)

LINE แจ้งเตือนเมื่อกล้องหายจาก heartbeat — config ระดับต่อกล้อง. Detailed delivery/recipient behavior lives in `docs/LOGIC_line-notifications.md`.

Settings → ⚙️ ตั้งค่ากล้อง → edit camera → ส่วน "การแจ้งเตือนเมื่อกล้องออฟไลน์":

| field | default | หมายเหตุ |
|---|---|---|
| `enabled` | false | เปิด/ปิด alert ต่อกล้อง |
| `notify_after_sec` | 300 | offline เกินกี่วินาทีถึงแจ้งครั้งแรก |
| `escalate_interval_min` | 60 | เตือนซ้ำทุกกี่นาที (ถ้ายัง offline) |
| `escalate_once` | false | ☑ "แจ้งครั้งเดียว" — ซ่อน interval field |
| `quiet_from` / `quiet_to` | NULL | quiet hours (HH:MM) |

Status Log: Settings → ⚙️ ตั้งค่ากล้อง → แท็บ "📋 Status Log" → ทุก online↔offline transition 90 วันล่าสุด.

Recovery alert ส่งครั้งเดียวเมื่อกล้องกลับมา online (timestamp + offline duration).

---

## 10. Report History (Ph.2)

ทุกครั้งที่รายงานถูกส่ง (อัตโนมัติ + manual) บันทึกใน `report_history` table.

**เข้าถึง:** Settings → 🔔 LINE → แท็บ "📜 ประวัติรายงาน" → paginated table.

| ปุ่ม | งาน |
|---|---|
| ▶ Run Now | fire schedule นั้นทันที (async — ผลโผล่ใน history เมื่อเสร็จ) |
| ⬇ PNG | download image file |
| ⬇ Export CSV | 200 row ล่าสุด |

**Retention:** rows 90 วัน, PNG files 30 วัน.

---

## 11. System Health Report (Ph.3)

Reports tab → dropdown → **🏥 รายงานสุขภาพระบบ**

4 toggleable sections: cameras, alerts, storage, system.

| ปุ่ม | งาน |
|---|---|
| 👁 ดู Preview | render PNG inline |
| 📄 ดาวน์โหลด PDF | A4 + page numbers (Puppeteer) |
| 📥 ดาวน์โหลด PNG | 720px-wide (LINE-friendly) |
| 📤 ส่งเข้า LINE ทันที | admin — ส่งหา recipients ที่เลือก, log ลง report_history |

Range picker: 24h / 7d / 30d / custom.

Offline camera row แสดง: `📅 เพิ่มเข้าระบบ` + `💓 Heartbeat ล่าสุด` + `🖼 Frame ล่าสุด` (จาก `events.has_snapshot` / `snapshot_filename`; `raw_json->>'_snapshot'` ยังเป็น legacy fallback)

Warning banners: offline >50%, disk >85%, RAM >85%.

---

## 12. Auditor role (read-only)

`auditor` — ดูได้ทุกหน้า แต่ POST/PUT/DELETE/PATCH ถูก block server-side ด้วย 403 `read_only`.

สร้าง: Settings → 👤 ผู้ใช้งาน → "+ เพิ่มผู้ใช้" → role = `auditor`.

Auditor เห็น: ทุกหน้ารวม Settings, Health Check, Audit Log, Report History.
Auditor ไม่สามารถ: เปลี่ยน config, settings, ลบ/เพิ่มข้อมูลใดๆ.

Camera Audit Log core (migration 024):
- `audit_log.target_camera_id` ใช้ filter เหตุการณ์ตามกล้อง
- บันทึก add/edit/delete camera, offline-alert settings, และ group assignment/removal
- details ของ camera audit redact `username` / `password`
- UI: History → Audit Log → filter ตาม Action + Camera

---

## 13. License operator notes (Phase 8)

ดูสถานะ: Settings → 🔐 License.

| status | ผลกระทบ |
|---|---|
| `ACTIVE` | ทำงานปกติ |
| `WARN_30D` / `WARN_7D` | banner เตือนสีเหลือง |
| `GRACE` | read-only 7 วัน + banner แดง |
| `EXPIRED` / `TRIAL_EXPIRED` | hard read-only |
| `INVALID` | writes blocked |

**Activate:** Settings → 🔐 License → paste JWT → save → verify ภายใน 60 วินาที (cache).

**Force re-check:** restart api-server หรือกด "🔄 Refresh license".

> License JWT เก็บใน `system_settings.license_key` (DB) — ไม่ใช่ไฟล์. ดู `docs/LOGIC_license.md` สำหรับ rationale เต็ม.

---

## 14. Dahua snapshot notes

Dahua VCA events ใช้ `src/ingesters/dahua-cgi.js` ผ่าน eventManager CGI.
Snapshot ของ Dahua ไม่พึ่ง `snapshot.cgi` เป็นหลัก เพราะช้าและมักพลาดคนเดินเร็ว.

Current snapshot flow:

1. ใช้ `snapManager` event JPEG ถ้ากล้องส่งให้
2. ถ้าไม่มี ใช้ RTSP rolling buffer burst scoring รอบ server receive time
3. ถ้า first pass เป็น `low_confidence` / `missing` / `failed` หรือยังเขียน status ไม่ทันตอน `clip_done`, clip resolver จะ retry แล้วเลือกภาพจาก `media/<eventId>.mp4`
4. Single RTSP fallback และ live CGI fallback ถือเป็น `low_confidence` เพื่อให้ clip resolver แก้ต่อได้

ตรวจผล:

```sql
SELECT
  id,
  camera_id,
  event_time AT TIME ZONE 'Asia/Bangkok' AS local_time,
  raw_json->>'_snapshot_source' AS source,
  raw_json->>'_snapshot_status' AS status,
  raw_json->'_snapshot_debug'->>'confidence' AS confidence
FROM events
WHERE camera_id IN ('DAHUA_CAM01', 'BMA-EAST_DAHUA_CAM01')
ORDER BY event_time DESC
LIMIT 20;
```

ถ้า `BMA-EAST_DAHUA_CAM01` พลาดภาพอีก ให้ดู `DahuaProblem.MD` ก่อนแก้ code.
สถานะที่ควรเห็นบ่อยหลัง fix: `dahua-clip-resolver / ok` หรือ
`dahua-rtsp-buffer-best / ok`. `missing` มักหมายถึง clip/buffer failed.

---

<sub>**SKILL.md** v1.5.0 — slim core · Detailed content in `docs/REF_*` · DojoJin Tech Dashboard · Updated 2026-05-24</sub>
