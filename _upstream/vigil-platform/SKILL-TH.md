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
> Last updated: 2026-09-06 · v1.5.4

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
17. [File Service](#17-file-service--แฟ้มไฟล์สำหรับส่งลูกค้า)
18. [หน้าจัดการพื้นที่จัดเก็บ](#18-หน้าจัดการพื้นที่จัดเก็บ)
19. [อ่านตัวเลขและค่าเริ่มต้นบนหน้ารายการ](#19-อ่านตัวเลขและค่าเริ่มต้นบนหน้ารายการ)

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

### 2.1 ชื่อ rule (IVA task) — จำกัด 64 byte

กล้อง Bosch เก็บชื่อ IVA task (rule) ได้สูงสุด **64 byte** (UTF-8) และถ้าชื่อ
ยาวเกิน กล้องจะตัดกลางตัวอักษร — ภาษาไทย 1 ตัวอักษรกิน 3 byte จึงชนเพดานนี้ตั้งแต่
ประมาณ 21 ตัวอักษร MQTT topic ของ event ที่ rule นั้นสร้างจะฝังชื่อ rule ไว้ด้วย
(`.../RuleEngine/CountAggregation/Counter/&1/<name>`) ถ้าชื่อถูกตัดจนกลายเป็น
UTF-8 ที่ไม่ถูกต้อง broker จะทิ้งทุก event บน topic นั้นเงียบ ๆ (NanoMQ) หรือตัด
การเชื่อมต่อกล้องทันที ("malformed packet", Mosquitto 2.x) — ชื่อที่มี `+` หรือ
`#` ก็ผิดกฎ MQTT topic segment เหมือนกันและให้ผลแบบเดียวกัน

- **ดูได้ที่ไหน:** Health › Devices — กล้อง Bosch ที่มี rule มีปัญหาจะขึ้นป้าย
  เตือน `ชื่อกฎใช้ไม่ได้ N` / `N rule name(s) unusable` ชี้เมาส์ดูรายละเอียดว่า
  rule ไหนและเพราะอะไร ตรวจทุกชั่วโมง (ทั้ง edge และ central อ่านอย่างเดียว)
- **วิธีแก้:** เปลี่ยนชื่อ task นั้นที่ตัวกล้องเอง (Bosch Configuration Manager
  หรือหน้าเว็บกล้อง) ให้สั้นกว่า 64 byte และไม่มี `+`/`#` — ระบบ Vigil ไม่เปลี่ยน
  ชื่อให้อัตโนมัติ ตรวจจับอย่างเดียว
- มีคำอธิบายสั้น ๆ ที่หน้า Settings › Cameras หมวด MQTT Credentials
  (เฉพาะกล้อง Bosch) ด้วย

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
| 🗄️ Database | latency ของ Postgres, จำนวน event ทั้งหมด, อัตรา event ใน 1h/24h · **ยอดรวมตลอดกาล (ทั้งหมด / Face / LPR) เป็นค่าประมาณ** และขึ้น `≈` นำหน้าเสมอ — `count(*)` เต็มตาราง 40M แถวกินเวลา 40 วินาทีต่อการเปิดหน้าหนึ่งครั้ง ตอนนี้ยอดรวมมาจาก `reltuples` ของ partition ส่วน Face/LPR มาจาก rollup `event_dim_bucket` (คลาดเคลื่อนไม่เกิน ~0.35% จากที่วัดล่าสุด) · ยอด 1 ชม./24 ชม. ยังเป็นค่าจริง · ถ้า**ไม่มี** `≈` แล้วขึ้น 0 แปลว่า query ล้มเหลว ไม่ใช่ว่าไม่มีข้อมูล (decision #263) |
| 📡 MQTT Pipeline | timestamp event ล่าสุด, อายุ event, สถานะ (`healthy`/`idle`/`stale`) |
| 📷 Cameras | จำนวนกล้อง online/offline (heartbeat ภายใน 90 วินาที) |
| ⚙️ Service Processes | สถานะ PM2 แต่ละ worker (`online`/`stopped`/`errored`); uptime; จำนวน restart `↺N` (สีเหลือง = เคย restart) · **ติดตาม 8 service**: api-server, mqtt-subscriber, media-recorder, hikvision, dahua, alert-worker, report-worker, lpr-receiver · ทั้ง 8 ตัวมีปุ่ม **Restart** · อีก 7 ตัวจะขึ้น **Stop** ตอนกำลังรัน หรือ **Start** ตอนหยุดอยู่ — ไม่ขึ้นพร้อมกัน · api-server มีแค่ Restart เพราะสั่ง stop = dashboard ตายโดยไม่มีทางกู้จากหน้าจอ · `face-embed-worker` รันใต้ PM2 เป็นตัวที่ 9 แต่**ไม่อยู่ในรายการนี้** ต้องดูด้วย `pm2 list` · allowlist ของปุ่มกับรายการสถานะเป็นคนละ constant ใน `src/routes/health.js` ต้องตรงกันเสมอ ไม่งั้นปุ่มขึ้นแล้วกดได้ 400 |
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

แท็บ Reports → 6 ประเภท: **Daily / Weekly / Monthly / Summary / Custom / 🏥 Health**
ตั้งเป็นตารางส่งอัตโนมัติได้ 5 ประเภท (`REPORT_TYPES = ['daily','weekly','monthly','summary','health']`)
**Custom ทำได้ด้วยมืออย่างเดียว** — ตารางส่งอัตโนมัติไม่มีที่ให้ระบุ "สองวันที่นี้"

| ประเภท | ช่วงวันที่ |
|---|---|
| Daily | 00:00–23:59 ของวันที่เลือก (ตาม `display_timezone`) |
| Weekly | จันทร์ 00:00 – อาทิตย์ 23:59 |
| Monthly | วันแรก – วันสุดท้ายของเดือน |
| Summary | 3 ช่วงจาก anchor วันเดียวกัน อยู่ในหน้าเดียว: วันที่ anchor · 7 วันที่ลงท้ายด้วย anchor (anchor−6 … anchor) · เดือนปฏิทินทั้งเดือนที่ anchor อยู่ · ถ้าส่งตามตาราง anchor = เมื่อวาน |
| Custom | from+to จำกัดด้วย `custom_range_max_days` |
| 🏥 Health | 24h/7d/30d/custom — ดู §11 |

**ส่งอัตโนมัติตามตาราง (Phase 7.3):** Settings → 🔔 LINE → Scheduled Delivery
แต่ละ schedule สร้าง PNG → ส่ง LINE ผ่าน imgbb (บริการ host รูปภาพสำหรับ LINE)
`send_day_of_week` กำหนดเงื่อนไขรายสัปดาห์; `send_days_of_month` กำหนดรายเดือน
ทุกครั้งที่ส่งจะ log ลง `report_history` — ดู §10
กฎการส่ง LINE อยู่ใน `docs/LOGIC_line-notifications.md`

**"รายเดือน" = เดือนปฏิทินที่แล้ว** (วันที่ 1 ถึงสิ้นเดือน) เปลี่ยนเมื่อ 2026-09-03 ตามที่เจ้าของสั่ง —
รายงานที่ส่งวันที่ 1 กันยายน จึงครอบคลุมสิงหาคมทั้งเดือน ของเดิมเป็น rolling 30 วัน ·
รายงานรายเดือนที่ทำด้วยมือ prefill เป็นเดือนที่แล้วให้ตรงกัน · daily/weekly ยังเป็น
rolling window ที่ลงท้ายวันนี้ 00:00 เหมือนเดิม (decision #269)

**ตัวเลือกของรายงาน** — ตั้งได้ต่อ schedule (`section_config`) หรือจากหน้ารายงานตอน export ด้วยมือ:

| ตัวเลือก | ผล |
|---|---|
| เปิด/ปิดรายบล็อก | ปิด KPI หรือ section ที่ไม่ต้องการได้ · ค่าเริ่มต้นที่บันทึกไว้คือ "แสดงครบ" ตารางเก่าจึงได้รายงานหน้าตาเดิมทุกประการ |
| เปอร์เซ็นต์บนโดนัท | เปิดเป็นค่าเริ่มต้น · ปิดแล้วเหลือแต่จำนวน |
| หน้าต่างเวลาในวัน | `tod_from` / `tod_to` — HH:MM เป็นขั้นละ 30 นาที `from` ต้องมาก่อน `to` ตรวจฝั่ง server · หน้าต่างที่ใช้จะพิมพ์บนหัวรายงาน ไม่งั้นตัวเลขที่ถูกกรองจะอ่านเหมือนยอดทั้งวัน |
| แท่งรายวันแยกตามหมวด | กราฟแท่งรายวันซ้อนตามหมวดหมู่ event แทนที่จะเป็นยอดรวมแท่งเดียว |
| โดนัทหมวดหมู่รวม IN/OUT | โดนัทภาพรวมนับ IN กับ OUT ของหมวดเดียวกันเป็นชิ้นเดียว — ทิศทางไม่ใช่ "ประเภท" และแท่งบาง ๆ 8 ชิ้นอ่านเป็น noise · **ตาราง**หมวดข้าง ๆ ยังแยก IN/OUT อยู่ · ไซต์ที่ไม่ได้ตั้งชื่อกล้องแบบ IN/OUT ได้ผลเท่าเดิมทุกประการ |

**Export รายงาน analytics:** กด Export PDF → Puppeteer render A4 PDF (ฟอนต์ภาษาไทย, ข้อความเลือกได้)
ตั้งแต่ 2026-09-06 การ render เกิด**ใน report-worker** ไม่ใช่ api-server — มี Chromium ชุดเดียวทั้งเครื่องแทนที่จะเป็นสองชุด ·
report-worker ล่มหรือคิวยาว ปุ่มดาวน์โหลดยังทำงาน เพียงแต่ตกกลับไป render ในโปรเซส api-server (รอได้ถึง 120 วินาทีก่อน) ·
`REPORT_RENDER_VIA_WORKER=0` = บังคับกลับไปใช้พฤติกรรมเดิมในโปรเซส

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

อ้างอิงด่วนสำหรับ ops / troubleshoot — version ณ v1.5.4

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

## 17. File Service — แฟ้มไฟล์สำหรับส่งลูกค้า

ที่ฝากไฟล์ของเราเอง สำหรับส่งเอกสาร/รูปให้ลูกค้าโดยไม่ต้องพึ่งบริการภายนอก
ได้ลิงก์ที่มีลายเซ็นและวันหมดอายุ ส่งต่อทางเมล/LINE ได้เลย

**เข้าใช้:** เมนู **ระบบ → แฟ้มไฟล์สำหรับส่งลูกค้า** (แอดมินเท่านั้น)

| หัวข้อ | รายละเอียด |
|---|---|
| ชนิดไฟล์ที่รับ | **png · jpg · pdf · docx · xlsx** เท่านั้น |
| ขนาดสูงสุด | 25 MB ต่อไฟล์ (เกินจะได้ข้อความบอก ไม่ใช่หน้า error) |
| วิธีตรวจไฟล์ | ดู **magic bytes** ของเนื้อไฟล์จริง ไม่เชื่อนามสกุลและไม่เชื่อ Content-Type |
| อายุไฟล์ | ตั้งเองต่อไฟล์ได้ (1–3650 วัน) เว้นว่าง = ใช้ค่ากลาง `file_retention_days` (เริ่มต้น 90) |
| ลิงก์ที่ได้ | `https://upl.dojojin.tech/pub/fil/<uuid>.<นามสกุล>?exp=...&sig=...` |
| เพิกถอน | กด "เพิกถอน" → **ลบไฟล์ออกจากดิสก์ทันที** ลิงก์ที่ส่งไปแล้วใช้ไม่ได้ (410) |
| เมื่อหมดอายุ | รอบกวาดรายวันลบไฟล์ออกจากดิสก์ให้เอง แถวยังอยู่เพื่อ audit |

> **magic bytes** = ไบต์ไม่กี่ตัวแรกของไฟล์ที่บอกชนิดจริงของมัน · ไฟล์ HTML ที่ตั้งชื่อ
> `.jpg` จึงถูกปฏิเสธ เพราะเนื้อในไม่ใช่รูป

**ทำไมถึงใช้โดเมนแยก `upl.dojojin.tech`** — ไฟล์ที่คนอัปขึ้นมาไม่ควรอยู่บนโดเมนเดียวกับ
ที่ถือ session cookie ของ dashboard · โดเมนนี้เปิดเฉพาะ `/pub/fil/*` เท่านั้น เปิด
`/index.html` หรือ `/api/auth/login` บนโดเมนนี้จะได้ **404** ทั้งหมด

**ข้อจำกัดที่ควรรู้:** `docx` กับ `xlsx` เป็นไฟล์ zip เหมือนกัน magic bytes จึงบอกได้แค่
"เป็น zip" ระบบใช้**นามสกุล**เลือกป้ายชื่อระหว่างสองตัวนี้ · ไฟล์ zip ที่ตั้งชื่อ `.docx`
จึงผ่านเข้ามาได้ แต่ไม่เป็นอันตราย เพราะทุกไฟล์ถูกส่งแบบ `attachment` (ดาวน์โหลดอย่างเดียว
ไม่เปิดในเบราว์เซอร์) จากโดเมนที่ไม่มี cookie ของเรา — ปลายทางจะเปิดไม่ขึ้นเท่านั้น

---

## 18. หน้าจัดการพื้นที่จัดเก็บ

ดูว่าพื้นที่หมดไปกับอะไร และลบไฟล์เก่าด้วยมือได้ ครอบคลุมทั้งเครื่องกลางและ edge ทุกไซต์

**เข้าใช้:** **Health Check → แท็บ "จัดเก็บ"** (แอดมินเท่านั้น) — เลือกเครื่องจากปุ่มด้านบน
(`ศูนย์กลาง` / `hdy` / `hkt` / `rmutr-v` / `vss`)

| ส่วน | ใช้ทำอะไร |
|---|---|
| ดิสก์ | % ที่ใช้ไป · เหลือกี่ GB · รวมเท่าไร |
| อายุของข้อมูลแต่ละหมวด | ตั้งอายุไฟล์และอายุลิงก์ ต่อหมวด แล้วกด "บันทึกอายุ" |
| ลบด้วยมือตามอายุ | เลือกหมวด + จำนวนวัน → **"ตรวจก่อนลบ"** ดูจำนวนไฟล์/ขนาดก่อน แล้วค่อยยืนยัน |
| ตารางหมวด | ขนาด · จำนวนไฟล์ · ไฟล์ที่ไม่มีเจ้าของ · ไฟล์เก่าสุด · วัดเมื่อไหร่ |
| ปุ่ม "วัดใหม่" | สั่งวัดพื้นที่ใหม่ทันที (เครื่อง edge สั่งผ่าน MQTT รออาจถึง 60 วินาที) |

> ตัวเลขในตารางมาจาก**รอบวัด** ไม่ใช่ค่าสด — ดูเวลาที่คอลัมน์ "วัดเมื่อ" ประกอบเสมอ
> ขนาดที่แสดงเป็น**พื้นที่ที่ถูกจับจองจริงบนดิสก์** ซึ่งมากกว่าผลรวมขนาดไฟล์ได้ถึงเท่าตัว
> เมื่อมีไฟล์เล็กจำนวนมาก (แสดงขนาดไฟล์รวมไว้เป็นบรรทัดรองให้เทียบ)

**การลบด้วยมือ ลบได้เฉพาะตามอายุไฟล์** ซึ่งเป็นกฎเดียวกับรอบกวาดอัตโนมัติ ·
**ยังไม่เปิดให้ลบ "ไฟล์ที่ไม่มีเจ้าของ"** เพราะ event ราว 2.5% ไม่ได้บันทึกชื่อไฟล์ไว้
รูปของมันจึงหน้าตาเหมือนไม่มีเจ้าของทั้งที่ยังเป็นหลักฐาน

**อายุไฟล์ตั้งที่เครื่องกลางที่เดียว** แล้วส่งต่อไปทุก edge อัตโนมัติผ่าน MQTT ·
เปิดแท็บของ edge จะเห็นค่าแต่แก้ไม่ได้ ให้กลับมาแก้ที่ `ศูนย์กลาง`

---

## 19. อ่านตัวเลขและค่าเริ่มต้นบนหน้ารายการ

พฤติกรรม 2 อย่างที่ดูเหมือนบั๊กแต่ไม่ใช่

### แท็บ "ไม่ทราบทะเบียน" (no-read) ของ LPR เริ่มที่ 24 ชั่วโมงล่าสุด

เปิดแท็บโดยไม่ได้เลือกช่วงเวลา = server บังคับค่าเริ่มต้นย้อนหลัง 24 ชั่วโมง แล้วหน้าจอ
เขียนช่วงนั้นกลับลงช่องวันที่ให้เห็นว่าใช้ช่วงไหนอยู่จริง · ปุ่มลัด **สัปดาห์** และ **เดือน**
กดได้จริงแล้ว เพราะนิยาม no-read คือ `raw_json->>'plate'` ว่าง และมี partial index บนนิยามนั้นตรง ๆ
(migration 199) ช่วงกว้างจึงไม่ตกไปสแกนทั้งตารางอีก · มี self-check รายสัปดาห์คอยทวนว่านิยาม
กับ index ยังตรงกัน ถ้าเบี่ยงจะขึ้นใน log ของ api-server ชื่อ `lpr.noread_check` (decision #265)

### ตัวเลข "10,000+" แปลว่า server หยุดนับ ไม่ใช่ยอดจริง

หน้า Events / Snapshots / Media / Appearances หยุดนับที่ 10,000 (`EVENTS_COUNT_CAP`) ·
ชนเพดานเมื่อไหร่ response จะพก header `X-Total-Capped: 1` และหน้าจอขึ้น **10,000+**
แทนที่จะเอาค่าพื้นไปโชว์เป็นยอดจริง · การพลิกหน้ายังทำได้เกินเพดาน แค่ยอดรวมที่ถูกตัด ·
เหตุที่ต้องตัด: การนับยอดจริงหมายถึงสแกน `events` 40 ล้านแถวแม้จะขอมาแค่ 50 แถว ซึ่งคือ
ต้นเหตุที่หน้าพวกนี้ช้า · กรองให้แคบลง (เลือกกล้อง หรือย่นช่วงเวลา) แล้วตัวเลขจริงจะกลับมา (decision #264)

---
---

<sub>**SKILL-TH.md** v1.5.4 — ฉบับภาษาไทย · เนื้อหาเดียวกับ [SKILL.md](SKILL.md) · Vigil Platform · Updated 2026-09-06</sub>

## 20. คำสั่งผ่าน LINE — ถามระบบจากในกลุ่มแชท

พิมพ์ประโยคไทยปกติในกลุ่มที่บอทอยู่ แล้วได้การ์ดคำตอบกลับมา ไม่ต้องขึ้นต้นด้วยอะไร
และไม่ต้อง @ บอท

**ใครสั่งได้** เฉพาะคนที่อยู่ในรายการ Settings › LINE / การแจ้งเตือน › คำสั่งผ่าน LINE ›
ผู้มีสิทธิ์สั่ง · คนอื่นพิมพ์มาบอทเงียบสนิท (แต่ยังลงบันทึกไว้) · ผู้สั่งแต่ละคนผูกกับบัญชี
ในระบบหนึ่งบัญชี และ **บัญชีนั้นเป็นตัวกำหนดว่าเขาถามอะไรได้** — บัญชีที่เห็น 4 กล้อง
ในภูเก็ตจะได้ยอดของ 4 กล้องนั้น พร้อมป้ายกำกับ "ภูเก็ต (4 จาก 86 กล้อง)" ·
**แนะนำสร้างบัญชี viewer เฉพาะกิจ** ไม่ใช่ผูกกับ admin

**เพิ่มผู้สั่ง** ให้เขาพิมพ์อะไรก็ได้ในกลุ่มที่บอทอยู่หนึ่งครั้ง แล้วเลือกชื่อเขาจาก dropdown
ในแท็บนั้น (รายชื่อมาจากคนที่เคยทักบอทและคนที่เคยพิมพ์ในกลุ่ม พร้อมชื่อโปรไฟล์ LINE)
จากนั้นเลือกบัญชีที่ให้ยืมสิทธิ์

**ถามอะไรได้บ้าง** (13 คำสั่ง แก้คำเรียกเองได้ทุกตัวจากแท็บเดียวกัน)

| ถาม | ตัวอย่าง |
|---|---|
| ยอดคนไม่สวมหมวกนิรภัย | `ขอทราบยอดคนไม่สวมหมวกนิรภัย ภูเก็ต ชั่วโมงที่แล้ว` |
| อันดับป้ายที่ฝ่าฝืน | `ขอป้ายทะเบียนที่ฝ่าฝืน เยอะที่สุดมา 3 ป้าย` |
| ยอดอ่านป้ายได้/ไม่ได้ | `ยอดอ่านป้ายทะเบียนวันนี้` |
| ป้ายเฉพาะจังหวัดหนึ่ง | `สรุปจำนวนป้ายทะเบียน จังหวัดยะลา ที่หาดใหญ่ เมื่อวาน` |
| รถเฝ้าระวังที่เจอ | `วันนี้เจอรถเฝ้าระวังคันไหนบ้าง` |
| ประวัติป้ายหนึ่งป้าย | `ป้าย 1กอ88 เจอที่ไหนบ้าง 7 วัน` |
| รูปรถของป้ายนั้น | `ขอรูปรถป้าย 1กอ88 วันนี้ทั้งหมด` |
| จำนวนรถแยกประเภท (จากกล้องอ่านป้าย) | `ขอจำนวนรถแยกประเภท ภูเก็ต วันนี้` |
| หมวดเหตุการณ์ (จากกล้องวิเคราะห์ภาพ · ต้องระบุไซต์) | `ขอหมวดเหตุการณ์ RMUTR-V วันนี้` |
| เจาะจงหมวดเดียว | `ขอหมวดเหตุการณ์ RMUTR-V เมื่อวาน เฉพาะ รถจักรยานยนต์` |
| รูปจากกล้องวิเคราะห์ภาพ | `ขอรูปรถบรรทุก RMUTR-V เมื่อวาน 18:00-19:00` |
| รูปของวัตถุที่ระบุ | `ขอรูปวัตถุ 121766 เมื่อวาน 18:00-19:00` |
| ค้นหาอัจฉริยะ (ภูเก็ตเท่านั้น) | `ค้นหาอัจฉริยะ คนถือร่ม เมื่อวานตอนบ่ายโมง` |
| ค้นหาใบหน้าตามลักษณะ | `ค้นหาใบหน้า ผู้หญิง ใส่เสื้อสีแดง เมื่อวานตอนเช้า` |
| นับตามชนิดวัตถุ | `สรุปจำนวนรถจักรยานยนต์ เมื่อวานก่อนเที่ยง กล้องฉัตรไชย ทั้งหมด` |
| แจงทุกชนิดในครั้งเดียว | `สรุปชนิดวัตถุ ภูเก็ต เมื่อวาน` |
| สถานะกล้องบน HikCentral | `สรุปสถานะกล้องบน HCP เฉพาะที่ดับ` |
| กล้องที่ออฟไลน์ | `ตอนนี้กล้องดับกี่ตัว` |
| ดูทั้งหมด พร้อมตัวอย่าง | `ช่วยเหลือ` |

ทุกคำสั่งต่อท้ายด้วยช่วงเวลาได้ (`ชั่วโมงที่แล้ว` `วันนี้` `เมื่อวาน` `7 วัน` `เดือนที่แล้ว`
`1 ก.ย.`) ระบุไซต์เป็นชื่อไทย และส่วนใหญ่ระบุกล้องได้ทั้งชื่อและรหัสในวงเล็บ (`กล้อง C20`) ·
ไม่ระบุช่วงเวลา = วันนี้ · **การ์ดพิมพ์ช่วงเวลาและขอบเขตที่ระบบตีความกลับมาเสมอ**
จะได้ค้านได้ทันทีถ้าเข้าใจไม่ตรงกัน

**นับรถมีสองแบบ และเลขไม่มีทางตรงกัน** ไซต์หนึ่งมีกล้องได้ทั้งสองชนิด — RMUTR-V มีครบ:
Bosch นับ "การข้ามเส้น" (คันเดียวเข้าแล้วออก = สองครั้ง) ส่วน Dahua ANPR นับ "คันที่อ่านป้ายได้"
วันที่ 8 ก.ย. วันเดียวกันได้ 12,273 ครั้ง กับ 7,248 คัน · ไม่มีฝั่งไหนนับผิด มันคนละคำถามกัน
⇒ การ์ดที่นับรถทุกใบจึงพิมพ์ไว้ท้ายเสมอว่ามาจากกล้องแบบไหน · ส่วน "หมวดเหตุการณ์" ตั้งแยก
ตามไซต์คนละเรื่องกัน (RMUTR-V นับรถ · VSS นับคนเข้าออกประตู) จึงถามไซต์ก่อนเสมอถ้าบัญชีเห็นหลายไซต์

**ช่วงนาฬิกาใช้ได้แล้ว** — `เมื่อวาน 18:00-19:00` · `8-12 น.` · `ตอน 18 โมง` หั่นคำตอบเหลือ
เฉพาะชั่วโมงนั้น (ก่อนหน้านี้ถูกอ่านเป็นทั้งวันโดยไม่บอก) · ถ้าเป็นช่วงหลายวันแล้วใส่นาฬิกามาด้วย
ระบบยังตอบเป็นทั้งวันและ **เขียนบอกบนการ์ด** ไม่ใช่เงียบ

**เรื่อง "ขอรูปรถคันนี้"** — ขอได้สองแบบ: รถ **ชนิดนั้น** ในช่วงเวลานั้น และ **ทุกเฟรมของ
การวิ่งผ่านรอบนั้น** ผ่านรหัสวัตถุที่อยู่บนหน้ารายละเอียดเหตุการณ์ · ตามรถคันเดิมข้ามวันหรือ
ข้ามกล้อง **ไม่ได้** เพราะรหัสวัตถุเป็นเลข track ที่กล้องรีเซ็ตใหม่ทุกครั้ง และกล้องวิเคราะห์ภาพ
ไม่อ่านป้าย · การค้นด้วยรหัสวัตถุมองได้ทีละ 1 วัน จึงต้องระบุวันมาด้วย

**สั่งค้นหาอัจฉริยะจากในแชท** — `ค้นหาอัจฉริยะ คนถือร่ม เมื่อวานตอนบ่ายโมง` ค้นด้วยเครื่องตัวเดียวกับ
หน้าค้นหาอัจฉริยะ แล้วตอบว่าพบกี่รายการ · กล้องไหนบ้าง · และ **คำอังกฤษที่ส่งให้เครื่องจริง ๆ**
ใช้เวลาราว 25 วินาที คำตอบจึงมาช้ากว่าคำสั่งอื่นเล็กน้อย

สามเรื่องที่ต้องรู้: เครื่องค้นอยู่ที่ **ภูเก็ตที่เดียว** การ์ดจึงเขียน "ภูเก็ต" ไว้เสมอ ·
จำนวนต่อกล้องนับจาก **30 รายการล่าสุด** ที่ดึงมา ไม่ใช่จากทั้งหมด · และการ์ดยกคำเตือนของหน้าเว็บ
มาด้วยทั้งหมด รวมทั้งคำที่ตัวแปลยังไม่รู้จัก · ผลเรียงตาม **ความใกล้เคียง ไม่ใช่ความถูกต้อง**
ต้องเปิดดูภาพในระบบก่อนสรุปทุกครั้ง

บอทจะเด้ง "กำลังค้น…" ให้ก่อน แล้วส่งผลตามมาเมื่อค้นเสร็จ พร้อมภาพสูงสุด 10 ใบ

**สั่งค้นหาใบหน้าจากในแชท** — `ค้นหาใบหน้า ผู้หญิง ใส่เสื้อสีแดง เมื่อวานตอนเช้า` ค้นด้วยตัวกรอง
ชุดเดียวกับแท็บ "ค้นหา" ของหน้าข้อมูลใบหน้า แล้วส่งภาพใบหน้าสูงสุด 10 ใบ พร้อมเวลา · ชื่อกล้อง ·
และสิ่งที่กล้องเห็น (เพศ · ช่วงวัย · หน้ากาก · หมวก · แว่น)

อ่านได้: เพศ · ช่วงอายุ · หน้ากาก · หมวก · แว่นตา (แยกแว่นกันแดด) · อารมณ์ · สีเสื้อ · สีกางเกง ·
ประเภทเสื้อ · **คำปฏิเสธชนะเสมอ** (`ไม่สวมหน้ากาก` กรองตรงข้ามกับ `สวมหน้ากาก`) ·
**สีต้องผูกกับชิ้นเสื้อผ้า** (`เสื้อสีแดง` ใช้ได้ · `สีแดง` ลอย ๆ ระบบไม่เดาให้) ·
การ์ดพิมพ์เงื่อนไขที่ใช้ค้นกลับมาเสมอ จะได้เห็นทันทีถ้าตีความไม่ตรงกัน

**เวลาพูดแบบคนไทยได้แล้วทุกคำสั่ง** — `ตีหนึ่ง` · `บ่ายสองโมง` · `สามทุ่ม` · `เที่ยง` ·
`ตอนเช้า` · `ช่วงบ่าย` · `กลางคืน` · ชั่วโมงที่เจาะจงชนะช่วงของวันเสมอ ·
ข้อควรระวัง: พิมพ์ `ตอนเช้า` ตอนตีสอง = เช้าของ **วันนี้** ซึ่งยังไม่เกิด การ์ดจะบอกให้
ไม่ใช่ตอบศูนย์เฉย ๆ

**เรียกกล้องเป็นกลุ่มได้** — กล้องมักอยู่หลายตัวในสถานที่เดียว พิมพ์ชื่อบางส่วนก็ติด และเติม
`ทั้งหมด` ต่อท้ายเพื่อรวมทุกตัว (`กล้องฉัตรไชย ทั้งหมด` = ครบทั้ง 6 ตัว) · ไม่เติมก็จะถามกลับ
ว่ากล้องไหน และตอบว่า `ทั้งหมด` ได้เหมือนกัน · **การ์ดพิมพ์ขอบเขตที่ใช้เสมอ** รวมถึงคำว่า
"ทุกไซต์ที่ดูได้" เมื่อไม่ได้ระบุไซต์ — คำตอบที่กว้างกว่าที่ตั้งใจจะได้เห็น ไม่ใช่เงียบ

**พิมพ์ `ช่วยเหลือ` ได้รายการครบพร้อมตัวอย่างจริง** แยกเป็น "ถามข้อมูล" กับ "สั่งให้ทำ"
และปิดท้ายด้วยคำเวลา/ขอบเขตที่เติมต่อท้ายได้ · ตัวอย่างแก้ได้ในหน้าตั้งค่าข้าง ๆ แต่ละคำสั่ง
เพิ่มคำสั่งใหม่เมื่อไหร่ ให้เขียนตัวอย่างไว้ด้วย คนอื่นจะได้พิมพ์ตามได้

**สถานะกล้องมีสองชุด ตั้งใจให้ต่างกัน** — `กล้องดับ` นับจากเหตุการณ์ที่ไหลเข้าระบบเรา ส่วน
`สถานะกล้องบน HCP` คือสิ่งที่ HikCentral มองเห็น ซึ่งรวมกล้องที่ HCP ดูแลอยู่ตัวเดียวด้วย
สองเลขไม่ควรเท่ากัน และการ์ดเขียนที่มาไว้ทุกใบ · ฝั่ง HCP เป็นภูเก็ตที่เดียวและต้องเป็นบัญชี admin

**สั่งให้ทำอะไรได้บ้าง**

| ทำ | ตัวอย่าง | หมายเหตุ |
|---|---|---|
| ส่งการแจ้งเตือนให้อีกกลุ่ม | `ส่งให้ตำรวจ 1กอ88` | ถามยืนยันก่อน · ส่งแล้วเรียกคืนไม่ได้ |
| รับทราบ | `รับทราบแจ้งเตือน 1กอ88` | ไม่ต้องยืนยัน |
| หยุดแจ้งเตือนป้ายนั้น | `หยุดแจ้งเตือน 1กอ88 3 ชั่วโมง` | **มีวันหมดอายุเสมอ** ค่าเริ่มต้น 24 ชม. เพดาน 7 วัน |
| เปิดกลับ | `เปิดแจ้งเตือน 1กอ88` | ตอบสถานะจริง เช่น "แต่กลุ่มนั้นถูกปิดเสียงอยู่" |

ปิดถาวรทำได้เฉพาะในแดชบอร์ดโดยตั้งใจ — การ์ดที่ถูกปิดเสียงอาจเป็นรถหายพร้อมเบอร์ตำรวจ
ปิดจากแชทแล้วลืมคือความเสียหายที่ไม่มีใครสังเกต

**เวลาบอทไม่เข้าใจ** ดูแท็บ "บันทึกการใช้งาน" แถวที่ขึ้น "จับไม่ได้" คือประโยคที่ยังไม่มี
คำเรียกรองรับ เพิ่มคำนั้นเข้าไปในคำสั่งได้จากฟอร์มข้าง ๆ · สองคำสั่งแย่งประโยคเดียวกัน
แก้ด้วย "คำที่ต้องมีครบ" ของตัวหนึ่ง และ "คำที่ห้ามมี" ของอีกตัว

รายละเอียดสถาปัตยกรรม ตาราง และปูมเหตุการณ์: `docs/LOGIC_line-commands.md`
