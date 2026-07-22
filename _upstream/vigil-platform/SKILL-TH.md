# SKILL-TH.md — Vigil Platform (ฉบับภาษาไทย)

> คู่มือปฏิบัติการสำหรับผู้ดูแลระบบ: mental model, สูตรสร้าง mapping rule, branding,
> ภาพรวม Health Check และสรุปฟีเจอร์ต่าง ๆ
>
> ฉบับนี้มีเนื้อหาเดียวกันกับ [SKILL.md](SKILL.md) — อธิบายเป็นภาษาไทย
> ศัพท์เทคนิค / ชื่อฟิลด์ / คำสั่ง คงไว้เป็น English พร้อม remark อธิบาย
>
> **ขั้นตอน troubleshoot** → `docs/REF_troubleshooting.md`
> **SQL + service commands** → `docs/REF_operator-sql.md`
> **เหตุผลการออกแบบ** → `docs/LOGIC_*.md`
>
> Last updated: 2026-06-15 · v1.5.3

---

## สารบัญ

1. [Mental model](#1-mental-model)
2. [รูปแบบ event ของ Bosch IVA](#2-รูปแบบ-event-ของ-bosch-iva)
3. [สูตร mapping rule](#3-สูตร-mapping-rule)
4. [System Settings อ้างอิง](#4-system-settings-อ้างอิง)
5. [White-label branding](#5-white-label-branding)
6. [หน้า Health Check](#6-หน้า-health-check)
7. [ภาพรวม Reports](#7-ภาพรวม-reports)
8. [ภาษา / i18n (ไทย / อังกฤษ)](#8-ภาษา--i18n-ไทย--อังกฤษ)
9. [Camera Offline Alerts (ระยะที่ 1)](#9-camera-offline-alerts-ระยะที่-1)
10. [Report History (ระยะที่ 2)](#10-report-history-ระยะที่-2)
11. [รายงานสุขภาพระบบ (ระยะที่ 3)](#11-รายงานสุขภาพระบบ-ระยะที่-3)
12. [บทบาท Auditor (อ่านอย่างเดียว)](#12-บทบาท-auditor-อ่านอย่างเดียว)
13. [หมายเหตุ License (Phase 8)](#13-หมายเหตุ-license-phase-8)
14. [หมายเหตุ snapshot ของ Dahua](#14-หมายเหตุ-snapshot-ของ-dahua)
15. [Camera Pause (หยุดกล้องชั่วคราว)](#15-camera-pause-หยุดกล้องชั่วคราว)
16. [Runtime Stack อ้างอิง](#16-runtime-stack-อ้างอิง)

---

## 1. Mental model

```
┌─────────┐         ┌──────────────────────┐         ┌──────────────────────┐
│ Cameras │ ──────► │  events (raw rows)   │ ──join─►│  event_categories    │
└─────────┘  MQTT   │  rule_name, type,    │  rules  │  (display grouping)  │
                    │  state, object_class │         └──────────────────────┘
                    └──────────────────────┘
```

- **Events** คือการสังเกตดิบที่เปลี่ยนแปลงย้อนหลังไม่ได้ (immutable raw observations)
- **Categories** คือ label แสดงผล ซึ่ง admin สร้างเอง
- **Mapping rules** กำหนดว่า event ดิบชุดไหนถูกนับเข้า category ใดบ้าง
- event หนึ่งชุดสามารถอยู่ใน **หลาย category พร้อมกัน** (all-match — จับคู่ทุกเงื่อนไขที่ตรง)
- ตัวเลขนับใน category **คำนวณใหม่ทุกครั้งที่ query** — แก้ mapping แล้วผลเปลี่ยนทันที ย้อนหลังด้วย

### Event pipeline — 3 ชั้น

```
┌────────────┐   ┌──────────┐   ┌──────────────────────────────┐
│ 1. CAMERA  │──►│ 2.BROKER │──►│ 3. DASHBOARD                 │
│ (IVA/VCA)  │   │  (EMQX)  │   │ subscriber → DB → API → UI   │
└────────────┘   └──────────┘   └──────────────────────────────┘
  ตัดสินใจว่า     transport ล้วน   สามารถ DROP (IGNORED_EVENT_TYPES)
  จะ detect       ไม่เพิ่ม/ลด/     หรือ HIDE (analytics_event_display)
  อะไรและ fire    แก้ข้อมูล        แต่ไม่สามารถสร้าง event ที่กล้องไม่ได้ยิง
```

> **EMQX** = MQTT broker ที่ทำหน้าที่เป็นท่อส่งข้อมูลระหว่างกล้องกับ dashboard

**หลักทอง debug:** เปรียบจำนวน event ดิบจาก MQTT กับจำนวนใน DB ถ้าเท่ากัน ปัญหาอยู่ที่กล้อง (ชั้น 1) ดู `docs/REF_troubleshooting.md §8.15`

### Sanity check เมื่อเจาะลึกจาก Stats

เมื่อ visual ใน Stats ลิงก์ไปยัง Events (Live) ให้เทียบ scope ของ endpoint ต้นทางกับปลายทาง ไม่ใช่แค่ label ที่เห็น

| Visual ต้นทาง | API ต้นทาง | ปลายทางต้องมีพารามิเตอร์เหล่านี้ |
|---|---|---|
| Activity Heatmap | `/api/stats/heatmap` | `from`, `to`, `cameras`, `category_id`, `dow`, `hour` |
| Category KPI / pie | `/api/stats/categories` | `from`, `to`, `cameras`, `category_id` |
| Per-camera bars (แท่งรายกล้อง) | `/api/stats/per-camera-counts` | `from`, `to`, `camera`, class/category constraints |
| Top Rules | `/api/stats/top-rules` | `from`, `to`, `cameras`, `rule_name` |

ถ้าตัวเลขไม่ตรงกัน ให้ดู query string จริงของ `/api/events?...` ก่อน
หน้า Events แบ่งหน้าฝั่ง server ดังนั้น filter ทุกตัวต้องถึง `/api/events` ก่อน `LIMIT/OFFSET`
ดู GOTCHAS #44

---

## 2. รูปแบบ event ของ Bosch IVA

| `event_type` | `object_class` | `state` | ความหมาย |
|---|---|---|---|
| `LineDetector/Crossed` | `Person` ฯลฯ | `''` / NULL | 1 row = 1 ครั้งที่ข้ามเส้น |
| `FieldDetector/ObjectsInside` | NULL | `'true'`/`'false'` | เข้า (`true`) / ออก (`false`) พื้นที่กำหนด |
| `ObjectTrack/Aggregation` | `Person` ฯลฯ | NULL | Tracker รวมข้อมูล — fire ซ้ำหลายครั้ง |
| `VideoSource/GlobalSceneChange` | NULL | `'true'`/`'false'` | ภาพเปลี่ยนฉับพลัน (แสง / การเคลื่อนไหวมาก) |
| `MotionAlarm` | — | — | **กรอง** ออกก่อน insert |
| `RecordingConfig/JobState` | — | — | **กรอง** ออกก่อน insert |

**จุดสำคัญ:** `state` มีค่าเฉพาะ `FieldDetector` / `SceneChange` เท่านั้น
row ของ `LineDetector` มี `state = NULL` → ถ้าสร้าง mapping rule ที่ระบุ `match_state='true'` จะไม่จับ event กลุ่มนี้เลย

---

## 3. สูตร mapping rule

`(any)` = NULL ใน UI = wildcard จับคู่กับทุกค่า

### 3.1 — นับทุกคนที่ข้ามเส้น (ทุกกล้อง)

| ฟิลด์ | ค่า |
|---|---|
| Camera | `* (any)` |
| Rule Name | `(blank = any)` |
| Event Type | `LineDetector/Crossed` |
| Object Class | `Person` |
| State | `(any)` |

### 3.2 — นับคนที่เข้าพื้นที่หวงห้าม (เฉพาะเข้า)

| ฟิลด์ | ค่า |
|---|---|
| Camera | `(any)` |
| Rule Name | `ห้ามคนเข้า` *(ชื่อ IVA rule ของคุณ — "No Entry")* |
| Event Type | `FieldDetector/ObjectsInside` |
| Object Class | `(any)` |
| State | `true (enter)` |

ใช้ `State = true` — นับครั้งเดียวตอนเข้า ไม่นับซ้ำตอนออก

### 3.3 — Category "Alerts" แบบ catch-all (ทุก rule ที่ fire)

| ฟิลด์ | ค่า |
|---|---|
| Camera | `(any)` |
| Rule Name | `(blank = any)` |
| Event Type | `(blank = any)` |
| Object Class | `(any)` |
| State | `(any)` |

### 3.4 — นับยานพาหนะ (ทุกประเภท)

เพิ่ม rule ทีละ class เข้า category นับยานพาหนะ:

```
event_type=LineDetector/Crossed, object_class=Car,        state=(any)
event_type=LineDetector/Crossed, object_class=Truck,      state=(any)
event_type=LineDetector/Crossed, object_class=Bus,        state=(any)
event_type=LineDetector/Crossed, object_class=Motorcycle, state=(any)
event_type=LineDetector/Crossed, object_class=Bicycle,    state=(any)
event_type=LineDetector/Crossed, object_class=Van,        state=(any)
event_type=LineDetector/Crossed, object_class=Vehicle,    state=(any)
```

### 3.5 — Rule เฉพาะกล้อง

| ฟิลด์ | ค่า |
|---|---|
| Camera | `BoschCam1` |
| Rule Name | `WrongWay` |
| Event Type | `(any)` |
| State | `true (enter)` |

---

## 4. System Settings อ้างอิง

→ อ้างอิงเต็มพร้อมคำสั่ง SQL แก้ค่า: `docs/REF_operator-sql.md`

ค้นหา key อย่างรวดเร็ว:

**การเก็บข้อมูล (Data retention)**

| Key | ค่า default | ผลที่เกิด |
|---|---|---|
| `data_retention_days` | `365` | ลบ event เก่ารายวัน (สูงสุด 730 วัน) |
| `snapshot_retention_days` | `30` | ลบไฟล์ภาพ snapshot เก่ารายวัน (สูงสุด 365 วัน) |
| `clip_retention_days` | `30` | ลบไฟล์วิดีโอ pre-alarm clip เก่ารายวัน (สูงสุด 90 วัน) |
| `appearances_retention_days` | `30` | จำนวนวันที่เก็บ attribute (เพศ/สี/เสื้อผ้า) ก่อน anonymise; ต้องไม่เกิน `data_retention_days` (สูงสุด 730 วัน) |

**Stats / การแสดงผล**

| Key | ค่า default | ผลที่เกิด |
|---|---|---|
| `display_timezone` | `Asia/Bangkok` | กำหนดจุดตัดวัน (day boundary) สำหรับ stats ทั้งหมด |
| `counter_dedup_mode` | `state` | การ dedup ตัวนับคน/ยานพาหนะ — `state` (นับเฉพาะ state=true), `object_window` (window ตาม object ID), `none` (นับทุก row) |
| `comparison_mode` | `rolling` | การเปรียบเทียบช่วงเวลาใน stats — `rolling` (N วันล่าสุด) หรือ `calendar` (เดือนเดียวกันปีที่แล้ว) |
| `custom_range_max_days` | `365` | ช่วงวันสูงสุดที่เลือกได้ใน custom date-range picker |
| `analytics_event_display` | `ImageTooBright,ImageTooBlurry,ImageTooDark,GlobalSceneChange` | CSV ของ event type กล้อง-automation ที่แสดงใน Stats/Events (ชนิดอื่นซ่อนแต่ยังเก็บอยู่ใน DB) |

**Branding (ตราสินค้า)**

| Key | ค่า default | ผลที่เกิด |
|---|---|---|
| `brand_name` | `Vigil Platform` | ชื่อผลิตภัณฑ์ใน sidebar, login, disclaimer, หัว PDF |
| `brand_tagline` | `CCTV Analytics Suite` | คำบรรยายใต้ชื่อ brand |
| `brand_logo_path` | `''` | path ใต้ `/branding/` (เช่น `logo.png`); ว่าง = SVG placeholder เริ่มต้น |
| `brand_primary_color` | `#5b8def` | สี `--accent` (CSS custom property) ทั่ว UI |

> **CSS custom property** = ตัวแปรสีที่กำหนดระดับ root แล้วนำไปใช้ซ้ำทั่วหน้า

**แผนที่ (Map)**

| Key | ค่า default | ผลที่เกิด |
|---|---|---|
| `mapbox_token` | `''` | token สาธารณะ Mapbox (`pk.…`) สำหรับ tile layer รายละเอียดสูง; ว่าง = ใช้ OSM tiles เท่านั้น ตั้งค่าได้ที่ Settings → Map |

---

## 5. White-label branding

### จุดที่แสดง brand

| ตำแหน่ง | สิ่งที่ branded |
|---|---|
| หัว Sidebar | logo + ชื่อ + tagline |
| Favicon แท็บเบราว์เซอร์ | logo |
| หน้า Login / Disclaimer | logo + ชื่อผลิตภัณฑ์ |
| รายงาน PDF | logo + ชื่อในหัวหน้า |
| CSS `--accent` | สีหลักทั่ว UI |

### วิธีตั้งค่า

Settings → ⚙️ System → 🎨 Branding (เฉพาะ admin):
- อัปโหลด logo (PNG/JPG/WebP/SVG สูงสุด 5MB) → ระบบ resize อัตโนมัติเป็น PNG ขนาด 256×256
- แก้ชื่อ (`brand_name`), tagline (`brand_tagline`), สี accent (`brand_primary_color`)

```bash
# API — อัปโหลด logo
curl -F "logo=@logo.png" -H "Cookie: <session>" \
  http://localhost:3000/api/branding/logo

# อ่านค่าสาธารณะ (ไม่ต้อง auth)
curl http://localhost:3000/api/branding
# → {name, tagline, logo_url, primary_color}  ← ใช้ชื่อเหล่านี้ ไม่ใช่ brand_* key
```

> footer `© DojoJin Tech` **hardcode** ไว้ — แก้ได้เฉพาะชื่อผลิตภัณฑ์ฝั่งซ้าย

---

## 6. หน้า Health Check

Sidebar → **💓 Health Check** (เฉพาะ admin) รีเฟรชอัตโนมัติทุก 15 วินาที

| การ์ด | แสดงข้อมูล |
|---|---|
| 🗄️ Database | latency ของ Postgres, จำนวน event ทั้งหมด, อัตรา event ใน 1h/24h |
| 📡 MQTT Pipeline | timestamp event ล่าสุด, อายุ event, สถานะ (`healthy`/`idle`/`stale`) |
| 📷 Cameras | จำนวนกล้อง online/offline (heartbeat ภายใน 90 วินาที) |
| ⚙️ Service Processes | สถานะ PM2 แต่ละ worker (`online`/`stopped`/`errored`); uptime; จำนวน restart `↺N` (สีเหลือง = เคย restart); ปุ่ม **Restart** สำหรับ 5 worker ที่ควบคุมได้ + **Stop/Start** (ยกเว้น api-server); แสดงสถานะ 7 worker แต่มีปุ่มเฉพาะ 5: api-server/mqtt-subscriber/media-recorder/hikvision/dahua (alert-worker + report-worker = แสดงสถานะอย่างเดียว) |
| 📸 Camera Image Quality (24h) | จำนวน event auto-analytics รายกล้อง: `too_bright` / `too_blurry` / `too_dark` / `scene_change` — ยอดสูง = เลนส์สกปรก / focus drift / แสงเปลี่ยน / อาจถูกบัง |
| ⚡ Camera Automation Triggers (24h) | จำนวน Digital Input + Relay event รายกล้อง + เวลา trigger ล่าสุด (event กลุ่มนี้ซ่อนใน Stats ตาม `analytics_event_display` แต่แสดงที่นี่เพื่อยืนยันว่า relay ทำงานวันนี้หรือเปล่า) |
| 💾 Storage | ไฟล์/ขนาด snapshot · ไฟล์/ขนาด/จำนวน-24h/เก่าสุดของ clip · พื้นที่ disk ว่าง/ทั้งหมด · จำนวนวัน retention (events/snapshots/clips) |
| ⚙️ API Server | uptime ของ process, Node version, PID, RSS memory, Heap used, WebSocket clients |
| 🖥️ Host | Hostname, platform, RAM ทั้งหมด/ว่าง, %, load avg (1m) |

> **PM2** = Process Manager 2 ใช้จัดการ Node.js worker ทั้งหมด
> **heartbeat** = สัญญาณ "ฉันยังทำงานอยู่" ที่กล้องส่งมาเป็นระยะ
> **RSS memory** = Resident Set Size — หน่วยความจำ RAM จริงที่ process ใช้อยู่

**เกณฑ์สถานะ (badge color):**

| ค่าที่วัด | warn 🟡 | err 🔴 |
|---|---|---|
| MQTT | `idle` 5 นาที–1 ชั่วโมง | `stale` > 1 ชั่วโมง |
| Memory | > 70% | > 85% |
| Disk | > 75% | > 90% |

```bash
curl -H "Cookie: <session>" http://localhost:3000/api/health/details | jq
```

---

## 7. ภาพรวม Reports

แท็บ Reports → 5 ประเภท: **Daily / Weekly / Monthly / Custom / 🏥 Health**

| ประเภท | ช่วงวันที่ |
|---|---|
| Daily | 00:00–23:59 ของวันที่เลือก (ตาม `display_timezone`) |
| Weekly | จันทร์ 00:00 – อาทิตย์ 23:59 |
| Monthly | วันแรก – วันสุดท้ายของเดือน |
| Custom | from+to จำกัดด้วย `custom_range_max_days` |
| 🏥 Health | 24h/7d/30d/custom — ดู §11 |

**ส่งอัตโนมัติตามตาราง (Phase 7.3):** Settings → 🔔 LINE → Scheduled Delivery
แต่ละ schedule สร้าง PNG → ส่ง LINE ผ่าน imgbb (บริการ host รูปภาพสำหรับ LINE)
`send_day_of_week` กำหนดเงื่อนไขรายสัปดาห์; `send_days_of_month` กำหนดรายเดือน
ทุกครั้งที่ส่งจะ log ลง `report_history` — ดู §10
กฎการส่ง LINE อยู่ใน `docs/LOGIC_line-notifications.md`

**Export รายงาน analytics:** กด Export PDF → Puppeteer render A4 PDF (ฟอนต์ภาษาไทย, ข้อความเลือกได้)

> **Puppeteer** = ไลบรารี Node.js ที่ควบคุม Chrome แบบ headless (ไม่ขึ้นหน้าจอ) เพื่อ render HTML เป็น PDF/PNG

---

## 8. ภาษา / i18n (ไทย / อังกฤษ)

Dashboard รองรับ 2 ภาษา — engine: `dashboard/i18n.js` (vanilla JS ไม่มี dependency)
ภาษาไทย = ต้นทาง (source); ภาษาอังกฤษ = ชั้น translation

> **i18n** = internationalization (การรองรับหลายภาษา)
> **vanilla JS** = JavaScript ล้วน ไม่มี framework เสริม

**สลับภาษา:** กดปุ่ม `ไทย / EN` ในเมนูผู้ใช้, หน้า login, หรือ disclaimer
→ เก็บค่าใน `localStorage.dashboard_lang` → โหลดหน้าใหม่ครั้งเดียว

**เพิ่ม string ใหม่:**
1. เพิ่ม key ใน `dashboard/i18n.js` — **ทั้ง block `th` และ `en`** (ขาดข้างเดียว = fallback เงียบ ไม่มี error)
2. Markup แบบ static → attribute `data-i18n` / `data-i18n-html` / `data-i18n-ph` / `data-i18n-title`
3. JS แบบ dynamic → `I18N.t('key', fallback)`
4. datetime input ใหม่ → ลงทะเบียน id ใน registry `_DT_*_IDS` ด้วย (GOTCHAS #64, #65)

> **`data-i18n` attribute** = attribute พิเศษบน HTML element บอกให้ i18n engine แทนที่ข้อความด้วย key ที่กำหนด

**ตรวจ string ที่ยังเป็นภาษาไทยแต่ไม่ผ่าน i18n:**
```bash
grep -rn '[฀-๿]' dashboard/index.html dashboard/dashboard.js dashboard/page-*.js | grep -v 'data-i18n'
```

**รายงาน export:** analytics report เป็นไทยเสมอ (Puppeteer เปิด context ใหม่ ไม่รู้ภาษาที่เลือก)
Health report ตามภาษาที่ผู้ใช้เลือก (dict `HR_LABELS.{th,en}` ใน `report-renderer.js`)

---

## 9. Camera Offline Alerts (ระยะที่ 1)

แจ้งเตือนผ่าน LINE เมื่อกล้องหายออกจาก heartbeat — ตั้งค่าระดับต่อกล้อง
รายละเอียดการส่งและผู้รับอยู่ใน `docs/LOGIC_line-notifications.md`

Settings → Camera Settings → แก้ไขกล้อง → ส่วน "Camera Offline Alerts":

| ฟิลด์ | ค่า default | หมายเหตุ |
|---|---|---|
| `enabled` | false | เปิด/ปิด alert ต่อกล้อง |
| `notify_after_sec` | 300 | offline กี่วินาทีจึงแจ้งครั้งแรก |
| `escalate_interval_min` | 60 | แจ้งซ้ำทุกกี่นาทีถ้ายัง offline อยู่ |
| `escalate_once` | false | เลือก "แจ้งครั้งเดียว" — ซ่อนช่อง interval |
| `quiet_from` / `quiet_to` | NULL | ช่วงเวลาเงียบ (รูปแบบ HH:MM) |

Status Log: Settings → Camera Settings → แท็บ "Status Log" → ทุก transition online↔offline ย้อนหลัง 90 วัน

แจ้งกู้คืน (recovery alert) ส่งครั้งเดียวเมื่อกล้องกลับมา online พร้อม timestamp และระยะเวลาที่ offline

---

## 10. Report History (ระยะที่ 2)

ทุกครั้งที่ส่งรายงาน (ทั้งอัตโนมัติและ manual) จะบันทึกลง table `report_history`

**เข้าถึง:** Settings → 🔔 LINE → แท็บ Report History → paginated table

| ปุ่ม | การทำงาน |
|---|---|
| ▶ Run Now | fire schedule นั้นทันที (async — ผลโผล่ใน history เมื่อเสร็จ) |
| ⬇ PNG | ดาวน์โหลดไฟล์รูปภาพ |
| ⬇ Export CSV | 200 row ล่าสุด |

> **async** = ทำงานในพื้นหลัง ไม่รอ response ทันที

**Retention:** เก็บ row ไว้ 90 วัน; ไฟล์ PNG ไว้ 30 วัน

---

## 11. รายงานสุขภาพระบบ (ระยะที่ 3)

แท็บ Reports → dropdown → **🏥 System Health Report**

มี 4 ส่วนที่เปิด/ปิดได้: cameras, alerts, storage, system

| ปุ่ม | การทำงาน |
|---|---|
| 👁 Preview | render PNG แสดงในหน้า |
| 📄 Download PDF | A4 + หมายเลขหน้า (ผ่าน Puppeteer) |
| 📥 Download PNG | กว้าง 720px (ขนาดเหมาะกับ LINE) |
| 📤 Send to LINE | admin — ส่งหาผู้รับที่เลือก, log ลง report_history |

ตัวเลือกช่วงเวลา: 24h / 7d / 30d / custom

แถวกล้อง offline แสดง: วันที่เพิ่มเข้าระบบ + timestamp heartbeat ล่าสุด + frame ล่าสุด
(ดึงจาก `events.has_snapshot` / `snapshot_filename`; `raw_json->>'_snapshot'` ยังเป็น legacy fallback)

> **legacy fallback** = วิธีสำรองที่ยังคงไว้เพื่อความเข้ากันได้กับข้อมูลเก่า

Banner เตือน: offline >50%, disk >85%, RAM >85%

---

## 12. บทบาท Auditor (อ่านอย่างเดียว)

`auditor` — ดูได้ทุกหน้า แต่ POST/PUT/DELETE/PATCH ถูก block server-side ด้วย 403 `read_only`

> **403** = HTTP status code "Forbidden" — server ปฏิเสธคำขอเพราะสิทธิ์ไม่เพียงพอ
> **RBAC** = Role-Based Access Control — ระบบกำหนดสิทธิ์ตามบทบาท

สร้าง: Settings → Users → "+ Add User" → role = `auditor`

Auditor มองเห็น: ทุกหน้ารวมถึง Settings, Health Check, Audit Log, Report History
Auditor ทำไม่ได้: เปลี่ยน config, settings, หรือเพิ่ม/ลบข้อมูลใดๆ

Camera Audit Log หลัก (migration 024):
- `audit_log.target_camera_id` ใช้กรอง audit event ตามกล้อง
- บันทึก add/edit/delete กล้อง, การตั้งค่า offline alert, และ group assignment/removal
- รายละเอียด audit กล้องจะ redact `username` / `password` ออก
- UI: History → Audit Log → กรองด้วย Action + Camera

---

## 13. หมายเหตุ License (Phase 8)

ดูสถานะ: Settings → 🔐 License

| สถานะ | ผลกระทบ |
|---|---|
| `ACTIVE` | ทำงานปกติ |
| `WARN_30D` / `WARN_7D` | banner เตือนสีเหลือง |
| `GRACE` | read-only 7 วัน + banner แดง |
| `EXPIRED` / `TRIAL_EXPIRED` | hard read-only (ล็อกการแก้ไขทั้งหมด) |
| `INVALID` | บล็อกการเขียนข้อมูล |

**Activate:** Settings → 🔐 License → วาง JWT → save → ตรวจสอบภายใน 60 วินาที (cached)

**บังคับตรวจใหม่:** restart api-server หรือกด "🔄 Refresh license"

> **JWT** = JSON Web Token — token รูปแบบ JSON ที่เซ็นด้วย cryptographic key ใช้ยืนยันสิทธิ์ license

> License JWT เก็บใน `system_settings.license_key` (DB) — ไม่ใช่ไฟล์ ดู `docs/LOGIC_license.md` สำหรับเหตุผลเต็ม

---

## 14. หมายเหตุ snapshot ของ Dahua

Dahua VCA event ใช้ `src/ingesters/dahua-cgi.js` ผ่าน eventManager CGI
Dahua ไม่พึ่ง `snapshot.cgi` เป็นหลักเพราะช้าและมักพลาดคนที่เดินเร็ว

> **CGI** = Common Gateway Interface — โปรโตคอลเรียก endpoint บนกล้อง Dahua เพื่อดึงข้อมูล/ภาพ
> **RTSP** = Real Time Streaming Protocol — โปรโตคอลสตรีม video จากกล้อง

**Module helper (testable แยกต่างหาก):**
- `src/ingesters/dahua-protocol.js` — parser: `parseDahuaEventText`, `parseSnapManagerCode`, `extractObjectClass`, `DAHUA_EVENT_MAP`
- `src/ingesters/dahua-snapshot-selector.js` — scoring: `scoreFrameForObject`, `scoreFrameMotion`, `chooseBestSnapshotCandidate`, `selectScanSegments` + ค่าคงที่ต่างๆ

waterfall snapshot ปัจจุบัน (เรียงตามลำดับ):

1. **snapManager event JPEG** — JPEG ที่กล้องแนบมาพร้อม event text (`dahua-event-snapshot`)
2. **RTSP buffer burst** — score 11 frame candidate รอบเวลาที่ server รับ event ด้วย motion-diff + ROI detail (`dahua-rtsp-buffer-best`); ตรวจ segment "ปิดแล้ว" ด้วย mtime fallback (`SEGMENT_CLOSE_AGE_MS = 2000`) เพื่อให้ buffer ที่มีน้อย segment ยังหา candidate ได้
3. **RTSP buffer scan** — ถ้า burst ได้ 0 candidates, scan segment ที่ปิดแล้วในช่วง ±30 วินาที (สูงสุด 5 ตัว) score แต่ละตัว เลือก frame ที่ดีที่สุด (`dahua-rtsp-buffer-scan`, `low_confidence`)
4. **Single RTSP fallback** — ดึง frame เดียวที่ timestamp เป้าหมาย ไม่มีการ score (`dahua-rtsp-buffer`, `low_confidence`)
5. **CGI live** — ทางเลือกสุดท้าย ภาพมาช้ากว่าเหตุการณ์เสมอ (`dahua-cgi-live`, `low_confidence`)

> **burst scoring** = การประเมิน frame หลาย frame ในช่วงเวลาสั้นๆ แล้วเลือก frame ที่ดีที่สุด
> **clip resolver** = กระบวนการที่ตรวจสอบและแก้ไขภาพ snapshot จาก clip ที่บันทึกได้

ข้อ 3–5 ทั้งหมดถูก mark เป็น `low_confidence` เพื่อให้ clip resolver upgrade ได้เมื่อ `clip_done` มาถึง

ตรวจสอบผล:

```sql
SELECT
  id,
  camera_id,
  event_time AT TIME ZONE 'Asia/Bangkok' AS local_time,
  raw_json->>'_snapshot_source' AS source,
  raw_json->>'_snapshot_status' AS status,
  raw_json->'_snapshot_debug'->>'confidence' AS confidence,
  raw_json->'_snapshot_debug'->>'strategy' AS strategy
FROM events
WHERE camera_id IN ('DAHUA_CAM01', 'BMA-EAST_DAHUA_CAM01')
ORDER BY event_time DESC
LIMIT 20;
```

สถานะที่ควรเห็น: `dahua-clip-resolver / ok` (ดีสุด), `dahua-rtsp-buffer-best / ok` (burst ได้ผล)
`dahua-rtsp-buffer-scan / low_confidence` = scan fallback ทำงาน (burst ได้ 0 candidates — มักเกิดหลัง camera reconnect)
`missing` = clip + ทุก buffer path ล้มเหลว

ถ้า `BMA-EAST_DAHUA_CAM01` ยังพลาดภาพ ให้อ่าน `DahuaProblem.MD` ก่อนแตะ code

---

## 15. Camera Pause (หยุดกล้องชั่วคราว)

หยุดรับ event และ alert จากกล้องชั่วคราวโดยไม่ลบกล้องออกจากระบบ
เหมาะสำหรับงานซ่อมบำรุงหรือปิดพื้นที่ชั่วคราว

**เปิดใช้:** Settings → Camera Settings → เลือกกล้อง → toggle "Pause"

| พฤติกรรม | รายละเอียด |
|---|---|
| MQTT ingest | `mqtt-subscriber.js` drop event ของกล้องที่ paused (`events` ไม่เพิ่ม row) |
| Snapshot capture | ปิด — ไม่บันทึกภาพ |
| LINE alerts | ปิด — ไม่ส่งทั้ง offline alert และ event alert |
| Heartbeat tracking | ยังทำงาน — กล้องยังนับ online/offline ตามปกติ |
| Dashboard feed | event ใหม่ไม่โผล่ขณะ paused |
| Audit log | บันทึก pause/resume พร้อม timestamp และ admin ที่ดำเนินการ |

> **MQTT ingest** = กระบวนการรับและประมวลผลข้อมูลจาก MQTT broker เข้า database

**Resume:** toggle กลับ — event ที่เกิดขึ้นระหว่าง pause หายถาวร (ไม่มี backfill)

---

## 16. Runtime Stack อ้างอิง

อ้างอิงด่วนสำหรับ ops / troubleshoot — version ณ v1.5.3

| Component | Version | หมายเหตุ |
|---|---|---|
| Node.js | v22.22.3 LTS | EOL เม.ย. 2027; `.zshrc` + launchd plist ชี้ `node@22` |
| PM2 | 7.0.1 | 7 workers; config: `ecosystem.config.js` |
| EMQX | 5.8.9 | Port `0.0.0.0:1883` (AUTHN เปิด); Dashboard `127.0.0.1:18083` |
| PostgreSQL | 16.14 | `127.0.0.1:5432`; data: volume `vigil_postgres_data` |
| Puppeteer | 25.1.0 | Chrome 149.0.7827.22 (bundled, `~/.cache/puppeteer`) |
| npm packages | 278 total | `npm audit`: 0 vulnerabilities (ตรวจสอบ 2026-06-07) |

> **LTS** = Long-Term Support — รุ่นที่ได้รับ patch ด้านความปลอดภัยเป็นเวลานาน
> **EOL** = End of Life — วันสิ้นสุดการสนับสนุนอย่างเป็นทางการ
> **launchd** = ระบบ startup daemon ของ macOS (เทียบเท่า systemd ของ Linux)

**คำสั่ง PM2 ที่ใช้บ่อย:**

```bash
pm2 list                            # ดูสถานะ worker ทั้งหมด
pm2 logs <name> --lines 50          # log ย้อนหลัง
pm2 restart ecosystem.config.js     # rolling restart ทุก worker
pm2 env 0                           # ดู node_version ที่ worker ใช้จริง
pm2 save                            # บันทึกรายการ → launchd ฟื้นคืนเมื่อ reboot
```

**services.sh wrapper** (ครอบ pm2 ผ่าน ecosystem.config.js):

```bash
scripts/services.sh start           # pm2 start ecosystem.config.js
scripts/services.sh restart         # pm2 restart ecosystem.config.js
scripts/services.sh stop            # pm2 stop ecosystem.config.js
```

**npm test** (รันจาก project root `~/vigil-platform`):

```bash
npm test
# → node --test test/*.test.js   (43 tests: color-utils, crypto-creds, helpers, alert-engine)
```

**คำสั่ง Docker ที่ใช้บ่อย:**

```bash
docker ps                           # ดูสถานะ container
docker exec vigil-emqx emqx ctl status    # version + node ของ EMQX
docker exec vigil-postgres psql -U vigil_sql -d vigil_platform -c "SELECT version();"
```

> **Docker container** = สภาพแวดล้อมรัน (runtime environment) ที่แยกออกจาก host แต่ใช้ kernel ร่วมกัน

**CVE Audit ล่าสุด:** 2026-06-07 — 0 confirmed CVE; ดูรายละเอียดใน `public/others/vigil-docs-v2/05-security.html`

> **CVE** = Common Vulnerabilities and Exposures — ฐานข้อมูลช่องโหว่ด้านความปลอดภัยสากล

---

<sub>**SKILL-TH.md** v1.5.3 — ฉบับภาษาไทย · เนื้อหาเดียวกับ [SKILL.md](SKILL.md) · Vigil Platform · Updated 2026-06-15</sub>
