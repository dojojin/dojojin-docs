# 🛡️ Vigil Platform

> **ระบบวิเคราะห์และจัดการกล้องวงจรปิดแบบครบวงจร** — แพลตฟอร์มวิเคราะห์ภาพแบบ real-time รองรับกล้อง Bosch, Hikvision, Dahua และ ONVIF ทั่วไป

[![Version](https://img.shields.io/badge/version-1.5.3-blue.svg)]()
[![License](https://img.shields.io/badge/license-Proprietary-red.svg)]()
[![Status](https://img.shields.io/badge/status-Production-green.svg)]()
[![Multi--vendor](https://img.shields.io/badge/Multi--vendor-Bosch%20%C2%B7%20Hikvision%20%C2%B7%20Dahua%20%C2%B7%20ONVIF-success.svg)]()
[![Licensing](https://img.shields.io/badge/Licensing-Ed25519%20JWT-success.svg)]()
[![White--label](https://img.shields.io/badge/White--label-Ready-orange.svg)]()

> ใช้งานจริง (developer): [`https://dashboard.dojojin.tech`](https://dashboard.dojojin.tech)
> 🇬🇧 English: [`README.md`](README.md)

---

## 📋 เกี่ยวกับโปรเจกต์

**Vigil Platform** คือแพลตฟอร์มวิเคราะห์กล้องวงจรปิด multi-vendor ครบวงจร โดย **DojoJin Tech** — รับ event จากกล้อง **Bosch** (MQTT / ONVIF Profile M), **Hikvision** (ISAPI Alert Stream — Smart Events + Face Capture) และ **Dahua** (CGI VCA events — Line Crossing, Intrusion, Smart Motion) พร้อมรองรับกล้อง **ONVIF ทั่วไป** แบบ monitor-only ให้บริการ monitoring แบบ real-time, แจ้งเตือนอัจฉริยะผ่าน LINE, รายงานใส่ branding, วิเคราะห์ใบหน้าเชิงประชากร และ dashboard เชิงปฏิบัติการสำหรับทีม Security Operations · การติดตั้งจริงป้องกันด้วย license Ed25519 ที่ผูกกับเครื่อง

**ทำไมถึงสร้างขึ้นมา:**
- Bosch IVA Pro ตรวจจับ event ได้แต่ vendor cloud ราคาแพง + ล็อกข้อมูล
- ลูกค้าในไทยต้องการ LINE notification — Bosch ไม่รองรับ native
- ต้องการ self-hosted, ปรับแต่งได้, สอดคล้อง PDPA
- ลูกค้าเป็นเจ้าของ source code (ไม่ติด vendor)
- รองรับ white-label — codebase เดียวขายได้หลายลูกค้า

**กลุ่มลูกค้าเป้าหมาย:** อุตสาหกรรม / อาคารสำนักงาน / ค้าปลีก / โรงเรียน (ตลาดไทย 100-3,000 กล้อง)

---

## 🌟 ฟีเจอร์

### 📷 รองรับกล้องหลายยี่ห้อ (Multi-vendor) — **v1.5 (Phase MV)**
Dashboard เดียว รองรับกล้อง 4 ระบบ — เพิ่มผ่านสถาปัตยกรรม ingester ที่สะอาด ทำให้ alert engine, stats, reports และ UI **ไม่ต้องมีโค้ดเฉพาะ vendor เลย**:
- **Bosch** — event ผ่าน MQTT (ONVIF Profile M), IVA Pro / IVA Basic
- **Hikvision** — ISAPI Alert Stream (HTTP multipart/mixed push ค้างยาว): Smart Events (line crossing, intrusion, region entrance) **และ Face Capture**
- **Dahua** — CGI VCA events (Line Crossing, Intrusion, Smart Motion ผ่าน `eventManager.cgi`); คลิป pre-alarm RTSP; ดึง snapshot
- **ONVIF ทั่วไป** — โหมด monitor อย่างเดียว (ดูภาพสด + สถานะออนไลน์ผ่าน TCP-reachability probe)
- **หน้าตั้งค่ากล้องแบบเต็มหน้า** (`⚙️ ตั้งค่ากล้อง`) — ฟอร์ม add/edit ปรับตาม vendor, badge สียี่ห้อ, เลือก RTSP/snapshot stream รายกล้อง, inline validation, Test Connection, Live Snapshot Preview
- **EMQX auto-provisioning** — บันทึกกล้อง Bosch ระบบสร้าง MQTT user รายกล้องอัตโนมัติ; credentials ปรากฏในฟอร์มทันที
- `cameras-config.json` มี field `vendor` เป็น first-class; event ทุก vendor normalize ลง **ตาราง `events` ร่วมกัน**

### 🛡️ Security Morning Briefing — **หน้าหลัก (v1.5)**
หน้าสรุปภาพรวมสำหรับ **Security Manager** ตอบ 3 คำถามใน 3 วินาที:
- **Status Strip** — `N/total กล้องออนไลน์ · MQTT live · XX% disk · up Xd` (เขียว / เหลือง / แดง)
- **Attention** — alerts 4h ล่าสุดที่มี `rule_name` + snapshot thumbnail / กล้องออฟไลน์พร้อม duration
- **Activity 24H** — กราฟแท่ง events/hour + KPI วันนี้ vs เมื่อวาน (`Events +12% ↑ · Alerts −34% ↓`)
- **Site Map** (ขนาดเล็ก + heatmap) + **Top Hotspots** (top 5 กล้องที่มี event มากสุด)
- **Footer** — `version · uptime · snapshot count · clip count · backup status`

### 💓 รายงานสุขภาพระบบ (System Health Report) — **v1.5 (Ph.3)**
รายงานสุขภาพระบบครบวงจรสำหรับทีม Security Operations:
- **5 section ปรับได้**: Camera Status, Camera Uptime, Alerts, Storage, System
- **3 รูปแบบ**: Preview (PNG inline), ดาวน์โหลด PNG, PDF (A4 + เลขหน้า ผ่าน Puppeteer)
- **Send to LINE Now** — admin-gated, checklist ผู้รับรายคน
- Range picker (24h / 7d / 30d / custom) สำหรับ uptime % และจำนวน alert
- Banner เตือนอัตโนมัติ: กล้องออฟไลน์ > 50% / disk > 85% / RAM > 85%
- ตั้งเวลาส่งได้เหมือนรายงาน analytics (day-of-week gate)
- PNG rendering ผ่าน SVG + `sharp` (ไม่ต้องพึ่ง Puppeteer สำหรับ image path)

### 🔔 การแจ้งเตือนกล้องออฟไลน์ — **v1.5 (Ph.1)**
- ตรวจจับการ transition ออฟไลน์ (heartbeat threshold 90 วินาที) และส่ง LINE alert
- checklist ผู้รับ LINE รายกล้อง (เฉพาะผู้รับที่ admin อนุมัติแล้ว)
- ตั้ง repeat interval + escalation ได้; flag `escalate_once` สำหรับแจ้งครั้งเดียว
- รองรับ quiet hours และแจ้งเตือนเมื่อ recovery
- **Status Log** — timeline ของการ online/offline รายกล้อง (`camera_status_log`)

### 📜 History Workspace — **v1.5 (Ph.6)**
Sidebar section "ประวัติและบันทึก" รวมทุก log ไว้ที่เดียว:
- **Alert Logs** — พร้อม summary strip (ส่งสำเร็จ / ล้มเหลว / ข้าม / LINE msgs) + window picker
- **Report History** — บันทึกทุก attempt (schedule + manual); ดาวน์โหลด PNG รายแถว; success-rate breakdown
- **Camera Status Log** — timeline การ transition heartbeat รายกล้อง
- **Audit Log** — ทุก action ของ admin รวมถึงการ add/edit/delete กล้อง, จัดกลุ่ม, เปลี่ยน credential
- **Active Sessions** — ดูและ revoke session ที่กำลังใช้งาน

### 📺 Monitoring แบบเรียลไทม์
- สถานะกล้องแบบ real-time ด้วย heartbeat (offline threshold 90 วินาที)
- Snapshot proxy แบบ live พร้อม fallback หลายแหล่ง (MQTT base64 → HTTP)
- KPI dashboard (กล้องออนไลน์, กำลังบันทึก, events วันนี้ — server-side, รองรับ timezone)
- จัดกลุ่มกล้อง (ชั้น / อาคาร / โซน) พร้อม tab filter
- **Toast + nav badge** เมื่อมี event ใหม่ — เหตุการณ์เด้งแจ้งทุกหน้า (throttle รวม burst เป็น toast เดียว)

### 🎯 ระบบจัดการ Event
- รับ event จาก IVA Pro (Crossing Line, Object In Field, Loitering ฯลฯ)
- Hierarchy ของ object class: `Person` → Face/HumanBody/Pedestrian/…, `Vehicle` → Car/Truck/Bus/Motorbike/Bike
- Pagination ฝั่ง server (20 แถว/หน้า, ไม่มี hard cap)
- Filter ฝั่ง server: ค้นหา + กล้อง + rule + class + tab + ช่วงวันที่

### 🙂 Face Capture — ภาพใบหน้า — **v1.5 (Phase MV.3)**
กล้อง Hikvision Face Capture ป้อนข้อมูลเข้าหน้า **แกลเลอรี "ภาพใบหน้า"** โดยเฉพาะ:
- Parser multipart แบบ binary-safe แยก JSON event + ภาพ crop ใบหน้า + ภาพพื้นหลังเต็มเฟรม
- คุณสมบัติเชิงประชากร: ช่วงอายุ, เพศ, อารมณ์, หน้ากาก / แว่น / หมวก — ป้ายภาษาไทย
- แกลเลอรีกรองได้ + แถบสรุป demographic
- Modal รายละเอียดต่อใบหน้า: ภาพพื้นหลัง + คลิป pre-alarm + ตารางคุณสมบัติ

### 🎥 บันทึกคลิปวิดีโอก่อนเกิดเหตุ — **v1.2.1 (Phase 6.1)**
- RTSP rolling buffer 24/7 ต่อกล้อง (Stream 2 — ~1080p / 2 Mbps)
- Event trigger → dump เป็น MP4 (ตั้ง pre/post seconds ได้); รองรับทั้ง 3 vendor
- Postgres `LISTEN/NOTIFY` แยก MQTT subscriber กับ media recorder (race-free)
- Toggle รายกล้อง: clip / snapshot / VCA overlay

### 🗺️ การแสดงผลบนแผนที่
- ระบบ map หลายผู้ให้บริการ (CartoDB + Mapbox — token เก็บใน DB, hot-reload ทันทีเมื่อบันทึก)
- **Multi-group color-coded overlay** — แต่ละกลุ่มกล้องได้รับสีเฉพาะ; legend panel toggle รายกลุ่ม
- **Live Pulse Toast-on-map** — debounce รายกล้อง (5/15/30/60s), bump mode, max 6 card, thumbnail
- **Wall Mode** — กด WALL ขยาย map เต็มจอ; Fullscreen API + CSS class toggle; จำค่าใน `localStorage`
- **FIT button** — recenter ไปยังกล้องที่มองเห็น
- Heatmap overlay แสดงความหนาแน่น event 24h ล่าสุด
- **Cache แผนที่แบบ offline** พร้อม bbox selector + ตัวจัดการ download หลายพื้นที่
- Map Settings sub-tab — จัดการ Mapbox token, จัดการ tile cache

### 🔔 ระบบแจ้งเตือน LINE
- ตั้งค่าการแจ้งเตือนรายกฎ (เลือกหลายกล้อง + หลาย rule_name)
- รองรับผู้รับหลายคน (User + Group) พร้อม **self-service onboarding** (QR code, OA Basic ID, webhook auto-reply)
- อนุมัติผู้รับ pending, block list, LINE Push Quota widget
- Cooldown (default 60 วินาที) + audit log + 6 สถานะ
- **Quiet hours** รายกฎ; placeholder: `{camera}`, `{location}`, `{camera_id}`, `{rule}`, `{time}`

### 📊 วิเคราะห์ข้อมูล — **Stats v2** + **Density** (v1.3)
- **KPI cards รายหมวด** พร้อมเปรียบเทียบ rolling
- เลือกช่วงวันที่เอง (5 preset ที่ aligned กับ calendar boundaries)
- กราฟภาพรวม event, Distribution pie, กราฟแท่งรายกล้อง
- **Activity Heatmap** — เมทริกซ์ ชั่วโมง × วันของสัปดาห์ พร้อม filter category
- **คนในพื้นที่ — Live** — Bosch CountAggregation + median smoothing 2s → WS push
- **Density Over Time** + **Density Heatmap** (palette สีอำพัน)
- Top Rules / Quiet Cameras + CSV export + Drill-down คลิก
- **Category ปรับแต่งได้** — admin กำหนดเองพร้อม icon/สี

### 📄 รายงาน — **Phase 7.3**
- 4 ประเภท — รายวัน / รายสัปดาห์ / รายเดือน / กำหนดเอง (rolling N วันล่าสุด)
- Template เดียวร่วมกัน (`report-template.js`) — ใช้ทั้ง interactive preview และ Puppeteer print
- **Export PDF** ด้วย Puppeteer (A4 + เลขหน้า); PNG ผ่าน SVG+sharp สำหรับ Health Report
- **ส่งรายงานอัตโนมัติเข้า LINE** — ความถี่ / เวลาส่ง / ผู้รับ / layout (compact หรือ full)
- Header & Footer ตาม brand — ดึง logo + ชื่อ + accent color อัตโนมัติ
- **Report History** — บันทึกทุก attempt; เก็บ row 90 วัน; PNG 30 วัน; CSV export

### 🔕 Quiet Hours ต่อ Rule — **v1.3 (Phase 7.2)**
- ช่วงเวลาเงียบรายกฎ (TIME columns, NULL = ส่งตลอด)
- รองรับ window ข้ามเที่ยงคืน (เช่น 22:00–06:00); คำนวณตาม display timezone

### 💓 หน้า Health Check
หน้า admin-only auto-refresh ทุก 15 วินาที:
- DB latency + จำนวน event + อัตรา 1h/24h
- ความสด MQTT pipeline + จำนวนกล้อง online/offline
- จำนวน snapshot + ขนาด, disk free/total
- Process uptime, RSS/heap memory, WebSocket client, hostname, load avg
- **คุณภาพภาพกล้อง (24h)** — จำนวน bright/dark/blurry/scene-change ต่อกล้อง

### 🧹 Retention ปรับแต่งได้
3 background job รายวัน:
- `data_retention_days` (1–730, default 365) — ลบ events เก่า
- `snapshot_retention_days` (1–365, default 30) — ลบ `/snapshots/*.jpg` เก่า
- `clip_retention_days` (1–90, default 30) — ลบ `/media/*.mp4` เก่า

### 🗃️ Schema Migrations + Backup/Restore — **v1.2.1 (Phase 6.1.10)**
- `src/migrate.js` — รันตอน api-server boot, scan `db/db_migration_*.sql`, apply ที่ยัง pending
- `npm run migrate` — รันแบบ manual (CI / pre-deploy)
- `scripts/backup.sh` — `pg_dump -Fc -Z 6` รายวันผ่าน launchd (03:00), เก็บ 14 วัน
- `scripts/restore.sh` — `pg_restore --clean --if-exists` แบบ interactive
- ⚠️ ห้ามแก้ `init.sql` เพื่อเพิ่ม schema — ให้สร้าง `db/db_migration_<NNN>_<topic>.sql` แทน

### 📱 รองรับมือถือ
- ปุ่ม hamburger + sidebar เลื่อนเข้าออกสำหรับจอ ≤768px
- Stack grid 2 คอลัมน์ (events / reports / modals)
- input รองรับการสัมผัส, modal เต็มจอ, ตาราง horizontal scroll
- ทดสอบทุกหน้าบน iPhone Safari + Android Chrome

### 🔐 ระบบ Authentication
- 3 role: **Admin** (สิทธิ์เต็ม) / **Viewer** (read-only) / **Auditor** (อ่าน + ดู audit)
- รหัสผ่าน bcrypt + session ที่เซ็น HMAC (7 วัน)
- กัน brute force (พลาด 5 ครั้ง → ล็อก 15 นาที + จำกัด 10/นาทีต่อ IP)
- Audit log เก็บ 90 วัน; CRUD user + reset password; จัดการ session + revoke ได้
- บังคับเปลี่ยนรหัสผ่านเมื่อ login ครั้งแรก
- **Triple-layer auth** (Cookie + localStorage + URL hash) เพื่อรองรับ Safari ITP

### 🔑 License & EULA — **v1.5 (Phase 8)**
- **License Ed25519 / JWT ผูกกับเครื่อง** — offline-first, verify ด้วย public key ที่ฝังในโปรแกรม (`jose`)
- ทดลองใช้ 7 วันนับจาก login ครั้งแรก → grace อ่านอย่างเดียว 7 วัน → ล็อก
- บังคับจำนวนกล้องตาม tier (STARTER / STANDARD / PROFESSIONAL / ENTERPRISE / DATACENTER)
- activate ผ่าน UI, แสดง Machine ID, keygen CLI (`scripts/keygen/`)
- **EULA ภาษาไทย** ฉบับทางการ (`docs/EULA-th.md`) พร้อม flow ยอมรับแบบบังคับตอน admin login ครั้งแรก

### ⚖️ Compliance & ด้านกฎหมาย
- หน้า disclaimer ตามกฎหมาย (ยอมรับใหม่ทุก session เบราว์เซอร์)
- ตระหนักรู้ พ.ร.บ.คอมพิวเตอร์ พ.ศ. 2550 + นโยบาย retention สอดคล้อง PDPA
- Activity logging ทุก event ที่เกี่ยวกับ auth (เก็บ 90 วัน)
- Static asset + `/snapshots/*` + `/media/*` ทั้งหมดต้อง auth

---

## ⚡ ฟีเจอร์ที่เพิ่ม Performance

| การ optimize | ก่อน | หลัง | ได้อะไรเพิ่ม |
|---|---|---|---|
| **Puppeteer browser pool** | Launch Chromium ใหม่ทุก render (3–5s) | ใช้ process เดียวร่วมกัน | **เร็วขึ้น ~9 เท่า warm** (1419ms → 159ms) |
| **WS via LISTEN/NOTIFY** | Polling 1 วินาที | Push ผ่าน `pg_notify` | **~86,400 queries/วันหายไป** |
| **Config file mtime cache** | `readFileSync` ทุก request | อ่าน disk เฉพาะเมื่อ mtime เปลี่ยน | ตัด disk block ต่อ request |
| **SD probe parallel** | Serial `for...await` 20 กล้อง = 80s | `Promise.all` batch=5 = 16s | ต่ำกว่า poll interval 30s |
| **30s TTL cache** (`today-counts`, `exec-summary`) | ~15 queries ต่อ poll | Single global slot 30s TTL | ลด DB load หลัก |
| **`pg_trgm` GIN index** on `event_type` | Leading-`%` LIKE ไม่ใช้ index | GIN index รองรับ arbitrary LIKE | ไม่ต้องแก้ query |
| **Strip `package.json`** | Dependencies 149 ตัว | Direct deps 10 ตัว | Install สะอาด, 0 vulns |

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────┐
│      กล้อง Multi-vendor — Bosch · Hikvision · Dahua             │
│  Bosch → MQTT  ·  Hikvision → ISAPI HTTP  ·  Dahua → CGI HTTP  │
└──────────────────┬────────────────────────┬────────────────────┘
                   │ MQTT (ONVIF Profile M) │ RTSP (Stream 2)
                   ▼                        ▼
        ┌──────────────────┐     ┌──────────────────────┐
        │ EMQX 5.8 Broker  │     │  media-recorder.js   │
        │   (Docker)       │     │ Buffer 24/7 รายกล้อง │
        └────────┬─────────┘     └──────────┬────────────┘
                 │                          │ LISTEN clip event
                 ▼                          │
        ┌──────────────────────────┐        │
        │   mqtt-subscriber.js     │────────┘
        │ + ingesters/             │
        │   hikvision-isapi.js     │
        │   dahua-cgi.js           │
        │ - Normalize event        │
        │ - Snapshot capture       │
        │ - pg_notify(new_event)   │
        │ - pg_notify(alert_event) │
        └────────────┬─────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│     PostgreSQL 16 (Docker) — แหล่งข้อมูลกลางแหล่งเดียว          │
│  กล้อง & Event · ระบบ Alert · รายงาน · Auth                    │
│  Stats v2 + Brand · Migrations                                 │
│  20 ตาราง · retention รายวัน 3 ตัว · LISTEN/NOTIFY channels   │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│        api-server.js (Express + WebSocket)                      │
│  - Middleware auth · License enforcement                        │
│  - Run migrations ตอน boot (fail-fast ถ้า error)               │
│  - Bridge WebSocket ผ่าน Postgres LISTEN/NOTIFY                 │
│  + alert-worker (pg_notify alert_event → LINE) isolated PM2    │
│  + report-worker (scheduler + Puppeteer) isolated PM2           │
└──────────────┬────────────────────────────┬────────────────────┘
               │                            │
               ▼                            ▼
    ┌─────────────────┐           ┌──────────────────┐
    │  Web Dashboard  │◄── HTTPS ─┤ Cloudflare Tunnel│
    │   (เบราว์เซอร์)  │           │  (production)    │
    │  15+ หน้า SPA   │           └──────────────────┘
    └─────────────────┘
```

> **กล้องที่ไม่ใช่ Bosch** มี ingester เป็น process ของตัวเอง — เชื่อม *ออก* ไปหากล้อง, normalize event ลงตาราง `events` เดียวกัน, และยิง `pg_notify` channel เดียวกัน — ทำให้ alert engine, WebSocket, stats, reports และ UI เป็น vendor-agnostic ทั้งหมด

**เป้าหมาย latency:** Event จากกล้อง → LINE บนมือถือผู้ใช้ใน **<2 วินาที**

---

## 🚀 เริ่มต้นใช้งาน

### ความต้องการเบื้องต้น
- macOS / Linux ที่มี Docker
- Node.js 18+
- กล้องที่เปิด MQTT / ISAPI / CGI

### ติดตั้ง

```bash
# 1. Clone (private repo)
git clone <repo-url> vigil-platform
cd vigil-platform

# 2. ตั้งค่า environment
cp .env.example .env
nano .env    # ใส่ DB password, SESSION_SECRET, MAPBOX_TOKEN ฯลฯ

# 3. สร้าง SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Start infrastructure
docker compose up -d    # PostgreSQL 16 + EMQX 5.8

# 5. Initialize database
docker exec -i vigil-postgres psql -U vigil_sql -d vigil_platform < db/init.sql

# ตรวจสอบ (ควรเห็น 14+ ตาราง base)
docker exec -it vigil-postgres psql -U vigil_sql -d vigil_platform -c "\dt"

# 6. Install dependencies
cd src && npm ci

# 7. รัน services
cd ~/vigil-platform && pm2 start ecosystem.config.js   # หรือ ./scripts/services.sh start

# 8. เข้าใช้งาน
# → http://localhost:3000
# → Auto-redirect: /disclaimer.html → /login.html → /
# → Admin default: admin / changeme  (บังคับเปลี่ยนรหัสตอน login ครั้งแรก)
```

📘 **สำหรับการใช้งานประจำวัน** (start/stop/health check/troubleshoot) ดู [`service_start.md`](service_start.md)

### 🔄 Upgrade จากเวอร์ชั่นเก่า

```bash
# 1. Backup ก่อน!
./scripts/backup.sh

# 2. Schema migration รันอัตโนมัติตอน api-server boot:
./scripts/services.sh start

# รันแบบ manual (CI / pre-deploy):
cd src && npm run migrate
```

### 💾 Backup / Restore

```bash
# ติดตั้ง daily auto-backup (ทำครั้งเดียว)
cp scripts/com.dojojin.dashboard.backup.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.dojojin.dashboard.backup.plist

# Backup เอง
./scripts/backup.sh

# Restore (interactive, ต้องพิมพ์ 'yes' ยืนยัน)
./scripts/restore.sh backups/vigil_platform_2026-05-29_030000.dump
```

### Deploy production

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create vigil-platform
cloudflared tunnel route dns vigil-platform dashboard.yourdomain.com
cloudflared tunnel run vigil-platform

# หรือติดตั้งเป็น system service (auto-start ตอน reboot):
sudo cloudflared service install <token>
```

---

## 🌐 Browser ที่รองรับ

| Browser | สถานะ | วิธี Auth |
|---------|--------|----------|
| Chrome / Edge | ✅ ครบ | Cookie + Bearer |
| Firefox | ✅ ครบ | Cookie + Bearer |
| Arc | ✅ ครบ | Cookie + Bearer |
| **Safari macOS** | ✅ ครบ | Bearer (cookie ถูก ITP บล็อก) |
| **Safari iOS** | ✅ ครบ | Bearer + URL hash |

**มือถือ (iOS/Android):** ✅ Layout responsive (≤768px) พร้อม hamburger sidebar

---

## 📁 โครงสร้างโปรเจกต์

```
vigil-platform/
├── docker-compose.yml          # PostgreSQL 16 + EMQX 5.8
├── README.md                   # ภาษาอังกฤษ
├── README-TH.md                # ไฟล์นี้ (ภาษาไทย)
├── CLAUDE.md                   # Context สำหรับ AI assistant
├── DESIGN.md                   # Design system — tokens, icons, patterns
├── SKILL.md                    # Playbook สำหรับ operator
├── service_start.md            # คู่มือ start/stop/troubleshoot
├── HARDWARE_SIZING_GUIDE.md    # คู่มือ hardware sizing + TCO หลัก
├── LICENSE                     # Proprietary
│
├── db/
│   ├── init.sql                                      # 14 ตาราง base (fresh install เท่านั้น)
│   ├── db_migration_000_schema_migrations.sql        # Bootstrap migration tracking
│   ├── db_migration_{alerts,auth,branding,...}.sql   # Legacy migrations
│   ├── db_migration_011_analytics_event_display.sql  # Phase 7.1
│   ├── db_migration_012_alert_quiet_hours.sql        # Phase 7.2
│   ├── db_migration_013_report_schedules.sql         # Phase 7.3
│   ├── db_migration_015_report_schedule_send_days.sql # Phase 7.4
│   ├── db_migration_016_license.sql                  # Phase 8 license + EULA
│   ├── db_migration_017_auditor_role.sql             # Auditor role
│   ├── db_migration_018_camera_offline_alerts.sql    # Ph.1 alerts + status log
│   ├── db_migration_019_escalate_once.sql            # Ph.1 escalate_once
│   ├── db_migration_021_report_history.sql           # Ph.2 report history
│   ├── db_migration_022_report_health_type.sql       # Ph.3 health report
│   ├── db_migration_023_pending_recipients.sql       # LINE self-service
│   ├── db_migration_024_camera_audit_log.sql         # Camera audit log
│   ├── db_migration_025_events_snapshot_columns.sql  # Snapshot columns
│   ├── db_migration_026_line_oa_basic_id.sql         # LINE QR code
│   ├── db_migration_027_third_party_views.sql        # Read-only views
│   ├── db_migration_028_blocked_recipients.sql       # LINE block list
│   ├── db_migration_029_map_settings.sql             # Mapbox token in DB
│   └── db_migration_030_trgm_event_type.sql          # pg_trgm GIN index
│
├── scripts/
│   ├── backup.sh                                     # pg_dump -Fc → backups/
│   ├── restore.sh                                    # pg_restore แบบ interactive
│   ├── emqx-provision.js                             # Bulk EMQX provisioner
│   ├── hooks/pre-commit                              # Token leak scanner
│   └── keygen/                                       # License key tools
│
├── backups/                  # ไฟล์ pg_dump (.dump gitignored)
├── snapshots/                # รูป event ที่จับได้ (auto-prune)
├── media/                    # คลิป MP4 รายเหตุการณ์ (auto-prune)
├── media-buffer/             # RTSP segment ชั่วคราว
├── reports/                  # PNG/PDF ที่ scheduler สร้าง (gitignored)
├── branding/                 # logo ลูกค้า (256×256 PNG)
├── public/others/            # HTML สาธารณะ unauth
├── map-cache/{carto,mapbox}/ # Offline tile cache
│
├── cameras-config.json       # แหล่งข้อมูล: รายชื่อกล้อง + lat/lon + IP + vendor
├── camera-groups.json
│
├── dashboard/                # Frontend (serve เป็น static)
│   ├── index.html            # Dashboard SPA หลัก (15+ หน้า)
│   ├── dashboard.js          # Logic UI ทั้งหมด
│   ├── i18n.js               # ระบบ bilingual (ไทย / อังกฤษ)
│   ├── icons.svg             # SVG sprite ที่ host เอง (18 symbols)
│   ├── design-tokens.js      # JS palette + token() helper
│   ├── report-template.js    # Builder HTML รายงานร่วม
│   ├── report-print.html     # Puppeteer print target
│   ├── login.html            # Brand-aware
│   └── disclaimer.html       # Brand-aware
│
└── src/                      # Backend
    ├── package.json          # Direct deps 10 ตัว
    ├── .env                  # (git-ignored)
    ├── api-server.js         # Express + WS + Auth + License (proxy → report-worker)
    ├── alert-worker.js       # PM2 worker — LISTEN alert_event → rule match → LINE/push
    ├── report-worker.js      # PM2 worker — scheduler (60s) + Puppeteer PDF/PNG
    ├── mqtt-subscriber.js    # รับ MQTT จาก Bosch + snapshot + pg_notify alert_event
    ├── ingesters/
    │   ├── hikvision-isapi.js  # Hikvision ISAPI Alert Stream
    │   └── dahua-cgi.js        # Dahua CGI VCA event stream
    ├── routes/
    │   └── categories.js     # Categories & mapping-rules routes
    ├── media-recorder.js     # RTSP rolling buffer 24/7 + dump clip
    ├── migrate.js            # Schema migration runner
    ├── auth.js               # bcrypt + sessions + RBAC
    ├── license.js            # verify license Ed25519/JWT + machine fingerprint
    ├── alert-engine.js       # Rule match + cooldown + quiet hours
    ├── line-sender.js        # LINE Messaging API + imgbb
    ├── report-renderer.js    # Puppeteer (PDF) + SVG+sharp (PNG health report)
    ├── stats-summary-route.js # Security Morning Briefing aggregator
    ├── constants.js          # Shared constants (OFFLINE_THRESHOLD_SEC ฯลฯ)
    └── simulator.js          # Generator MQTT event สังเคราะห์
```

---

## 🛠️ Tech Stack

**Backend (10 direct deps):**
- Node.js 18+ · Express 5 · WebSocket (ws)
- PostgreSQL 16 (Docker, ใช้ `LISTEN/NOTIFY` push)
- **EMQX 5.8** (Docker — ทนกับ MQTT 3.1 packets ของ Bosch firmware เก่า; per-camera auth)
- Ingesters: `mqtt-subscriber.js` (Bosch) · `ingesters/hikvision-isapi.js` · `ingesters/dahua-cgi.js`
- `bcryptjs` · `pg` · `mqtt` · `cors` · `dotenv`
- `sharp` (resize logo + Health Report PNG) · `multer` (upload ไฟล์)
- **`puppeteer`** (render PDF + analytics PNG พร้อม browser pool)
- **`jose`** (verify license JWT แบบ Ed25519)
- Process management: `pm2` (ecosystem.config.js)

**Frontend:**
- Vanilla JavaScript (ไม่ใช้ framework — เร็ว, ไม่มีขั้น build)
- OpenLayers 9 (map) · Chart.js 4 (analytics)
- SVG sprite ที่ host เอง (`icons.svg`) · design token system (`design-tokens.js`)
- ระบบ bilingual ไทย/อังกฤษ (`i18n.js`)

**Integrations:**
- LINE Messaging API (push notification + รายงานตามเวลา)
- imgbb API (host รูป, หมดอายุ 48h)
- Mapbox API (map premium — token เก็บใน DB)
- CartoDB CDN (map free fallback)
- Cloudflare Tunnel (HTTPS gateway)

**Security:**
- bcrypt (cost factor 10) · รหัสผ่านขั้นต่ำ 8 ตัว
- Session ที่เซ็นด้วย HMAC-SHA256 · เปรียบเทียบแบบ constant-time
- HttpOnly + SameSite=Lax cookies
- **WebSocket ต้อง auth** — ปฏิเสธ connection ไม่มี session (PDPA)
- **CORS allowlist** — same-origin + `ALLOWED_ORIGINS` เท่านั้น
- IP จริงอ่านจาก `CF-Connecting-IP` (ไม่เชื่อ X-Forwarded-For)
- Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`
- Pre-commit token leak scanner

---

## 🔐 Credentials Default

หลัง run ครั้งแรก login ด้วย:
```
Username: admin
Password: changeme
```
**⚠️ ระบบจะ FORCE ให้เปลี่ยนรหัสผ่านเมื่อ login ครั้งแรก** ไม่มีทางข้ามขั้นตอนนี้

---

## 🗄️ Schema ฐานข้อมูล (20 ตาราง)

| กลุ่ม | ตาราง | จุดประสงค์ |
|-------|--------|---------|
| 📷 **กล้อง** | `camera_groups`, `cameras`, `camera_status_log`, `camera_offline_alerts` | ทะเบียนอุปกรณ์ + จัดกลุ่ม + config offline alert + log heartbeat |
| 📊 **Events** | `events`, `appearances`, `license_plates` | ข้อมูลตรวจจับ multi-vendor — TIMESTAMPTZ ทั้งหมด |
| 🔔 **Alerts** | `line_config`, `alert_rules`, `alert_logs`, `pending_recipients` | LINE engine — `alert_rules.active_from/to` = ช่วงเงียบ; self-service onboarding |
| 📅 **Reports** | `report_schedules`, `report_history` | ส่ง LINE ตามเวลา + บันทึกทุก attempt |
| 🔐 **Auth** | `users`, `sessions`, `audit_log` | จัดการ user + audit |
| 🏷️ **Stats v2 + Brand** | `event_categories`, `event_category_rules`, `system_settings` | 10+ key รวม `analytics_event_display`, `mapbox_token` |
| 🛠️ **Migrations** | `schema_migrations` | บันทึก migration |

ดู schema เต็มที่ [`db/init.sql`](db/init.sql) และ recipe การ map category + playbook ops ที่ [`SKILL.md`](SKILL.md)

---

## 📚 ดัชนีเอกสาร

| เอกสาร | กลุ่มเป้าหมาย | เนื้อหา |
|-----|----------|----------------|
| [`README.md`](README.md) | ทุกคน | ภาพรวม, ติดตั้ง, architecture (อังกฤษ) |
| [`README-TH.md`](README-TH.md) | ผู้ใช้ไทย | เนื้อหาเดียวกันภาษาไทย |
| [`CLAUDE.md`](CLAUDE.md) | AI assistant / dev ใหม่ | Decision, gotcha, working agreements |
| [`DESIGN.md`](DESIGN.md) | Designer / frontend dev | Design system — tokens, icons, patterns |
| [`SKILL.md`](SKILL.md) | Operator | Recipe การ map, troubleshoot, SQL |
| [`service_start.md`](service_start.md) | Operator | Start/stop รายวัน, health check, recovery |
| [`HARDWARE_SIZING_GUIDE.md`](HARDWARE_SIZING_GUIDE.md) | Pre-sales / สถาปนิก | Spec hardware G1-G5, คำนวณ capacity, TCO |

---

## 💼 ข้อมูลเชิงพาณิชย์

**ระดับราคา** (สอดคล้องกับ `HARDWARE_SIZING_GUIDE.md` G1-G5):
- **STARTER** (≤100 กล้อง): 350K บาท + MA Bronze 80K/ปี
- **STANDARD** (100-500): 650K บาท + MA 130K/ปี
- **PROFESSIONAL** (500-1K): 1.2M บาท + MA 240K/ปี
- **ENTERPRISE** (1K-2K): 2.4M บาท + MA แบบเฉพาะ
- **DATACENTER** (2K-3K): ขอราคา

---

## 📜 ลิขสิทธิ์

```
Copyright © 2025-2026 Prakasit Rochanavipart (Dojo-mAn) / DojoJin Tech
All Rights Reserved.

ซอฟต์แวร์นี้เป็นทรัพย์สินส่วนบุคคลและเป็นความลับ
ห้ามคัดลอก แจกจ่าย แก้ไข หรือใช้งานโดยไม่ได้รับ
อนุญาตเป็นลายลักษณ์อักษรล่วงหน้า
```

ดูเงื่อนไขเต็มที่ [LICENSE](LICENSE) และ [`docs/EULA-th.md`](docs/EULA-th.md)

---

## 👨‍💻 ผู้พัฒนา

**ประกาศิต โรจนวิภาส** *(Dojo-mAn)* — **DojoJin Tech**

- 📧 Email: [prakasit@dojojin.tech](mailto:prakasit@dojojin.tech)
- 🌐 Website: [dojojin.tech](https://dojojin.tech/)
- 🆔 Handle: `@dojojin`

---

## ⚠️ ประกาศเรื่องการรักษาความลับ

Repository นี้มี source code และ configuration ที่เป็นกรรมสิทธิ์ การเข้าถึงจำกัดเฉพาะผู้ที่ได้รับอนุญาต การเปิดเผย คัดลอก หรือแจกจ่ายเนื้อหาโดยไม่ได้รับความยินยอมเป็นลายลักษณ์อักษรชัดเจนเป็นการต้องห้ามและอาจเกิดการดำเนินคดีทางกฎหมาย

---

<sub>**Vigil Platform** v1.5.3 · by DojoJin Tech · สร้างด้วยความใส่ใจในประเทศไทย 🇹🇭 · © 2025-2026</sub>
