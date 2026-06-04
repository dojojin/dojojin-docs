# 🖥️ DojoJin Tech Dashboard — Hardware Sizing Guide

คู่มือการเลือก Hardware สำหรับ DojoJin Tech CCTV Dashboard — multi-vendor (Bosch / Hikvision / Dahua / ONVIF)
รองรับกล้องตั้งแต่ **100 ถึง 3,000 ตัว**

> **Last calibrated:** 2026-05-21 — broker เปลี่ยนจาก Mosquitto 2.0 → **EMQX 5.8** ทุก tier (decision #112 — Mosquitto 2.x strict validator reject MQTT 3.1 packets ของ Bosch firmware เก่า). เพิ่มหัวข้อ **🚀 Software-side Scale-up** ท้ายเอกสาร. Phase 6.1 constants (RTSP buffer + clip) ยังคงเดิม

---

## 📌 Document Status

This is the **canonical live doc** for hardware sizing, capacity planning, and high-level commercial TCO.

| Item | Status |
|---|---|
| Canonical markdown | `HARDWARE_SIZING_GUIDE.md` |
| Supersedes | `docs/HARDWARE_SIZING_GUIDE.md`, `docs/cost/HARDWARE_SIZING_GUIDE.md`, `docs/cost/COST_BREAKDOWN_DETAILED.md` |
| Calculator artifact | `docs/cost/Cost_Calculator.xlsx` |
| Owns | G1-G5 hardware specs, resource constants, capacity calculations, clip sizing, software scale-up plan, high-level TCO |
| Must not own | Feature implementation logic, operator SQL, troubleshooting recipes, detailed worksheet formulas |

When assumptions change, update this guide first. Use the spreadsheet only as the calculation artifact behind commercial estimates.

---

## 📐 Calculation Method (วิธีคำนวณ)

### 🎯 Constants (วัดจาก production v1.2)

| ตัวแปร | ค่า | ที่มา |
|--------|----:|-------|
| **B_event** = bytes per event ใน Postgres | **~850 B** | วัดจริง: `pg_total_relation_size('events') / row_count` (table 620 B + indexes 207 B + 5% bloat) |
| **B_snap** = ขนาด snapshot เฉลี่ย | **~160 KB** | วัดจริง: 410 MB ÷ 2,665 ไฟล์ (Bosch ONVIF JPEG 1080p) |
| **R_snap** = % event ที่มี snapshot | **~80%** | events ที่ผ่าน filter (MotionAlarm/JobState/Aggregation โดน drop ก่อน insert/capture) |
| **P_factor** = peak / average ratio | **5×** | business-hour burst (8:00-18:00) |
| **Net_event** = MQTT payload เฉลี่ย | **~3 KB** | event JSON (post-stripLargeStrings) |
| **🆕 B_clip** = ขนาด pre-alarm clip เฉลี่ย | **~3.5 MB** | วัดจริง: 1080p H.264 × 15s × ~2 Mbps (Stream 2 / `?inst=2`) |
| **🆕 R_clip** = % event ที่ได้ clip | **30-100%** | ขึ้นกับ % กล้องที่เปิด `enable_clip_capture` (default: opt-in per camera) |
| **🆕 Net_rtsp** = bandwidth ต่อกล้อง (Stream 2) | **~2 Mbps** | Continuous 24/7 ขณะ `enable_clip_capture=true`. Stream 1 (4K) จะ ~9 Mbps |
| **🆕 RAM_ffmpeg** = RAM per ffmpeg subprocess | **~80 MB** | 1 instance ต่อกล้องที่เปิด clip capture (`-c copy`) |
| **🆕 CPU_ffmpeg** = CPU per ffmpeg subprocess | **~3-5%** ของ 1 core | 1080p `-c copy` (no re-encode) |
| **🆕 B_buffer** = rolling buffer per camera (transient) | **~7.5 MB** | 30s × 2 Mbps in `media-buffer/<cam>/` |

### 🎯 Event Rate Scenarios

ปริมาณ event ต่อกล้องต่อวันขึ้นอยู่กับ **deployment type**:

| Scenario | events/cam/day | ใช้ที่ไหน |
|----------|---------------:|-----------|
| 🟢 **Light** | 50 | Office lobby, meeting room, server room (low traffic) |
| 🟡 **Standard** *(default)* | 200 | Retail, parking, general security, school corridor |
| 🔴 **Heavy** | 1,000 | Perimeter intrusion, traffic, transit hub, factory floor |

> Sizing ในเอกสารนี้ใช้ **Standard** เป็น base และ **Heavy ×5** เป็น headroom

### 🎯 Formula

```
EventsPerDay     = Cameras × EventsPerCamPerDay
EventsPerSec_avg = EventsPerDay / 86400
EventsPerSec_pk  = EventsPerSec_avg × 5

DBSize_year     = EventsPerDay × 365 × 850 B
SnapshotSize_30 = EventsPerDay × 0.8 × 30 × 160 KB
MqttNetworkPeak = EventsPerSec_pk × 3 KB × 8 bits = bps  (event metadata only)

# 🆕 Phase 6.1 — Pre-alarm video clip
N_clip_cams      = Cameras × ClipEnabledRatio       (e.g. 30% = 0.30)
ClipsPerDay      = N_clip_cams × EventsPerCamPerDay × 0.7   (skip Aggregation)
ClipStorage_30   = ClipsPerDay × 30 × B_clip                = bytes

# 🆕 Continuous RTSP pull — runs 24/7 PER clip-enabled camera
RtspNetwork_in   = N_clip_cams × Net_rtsp           = bps   (LAN inbound, server-side)
ffmpeg_RAM       = N_clip_cams × RAM_ffmpeg         = bytes
ffmpeg_CPU_cores = N_clip_cams × CPU_ffmpeg / 100   = cores
RollingBuffer    = N_clip_cams × B_buffer           = bytes (transient on disk)
```

---

## 🆕 Phase 6.1 — Pre-alarm Video Clip Sizing Impact

> **TL;DR:** Clip storage **~24× ใหญ่กว่า snapshot** สำหรับ event เดียวกัน + **ต้อง pull RTSP ตลอด 24/7** ขณะ camera เปิด clip capture. **Selective enabling** สำคัญมาก — เปิดเฉพาะ "high-priority" cameras (perimeter, entrance, parking exit)

### Recommended `enable_clip_capture` strategy

| Camera role | Recommended | เหตุผล |
|---|---|---|
| 🚨 Perimeter / fence intrusion | ✅ Enable | เก็บ pre-alarm สำคัญสำหรับ forensic |
| 🚪 Entrance / lobby / reception | ✅ Enable | ดูว่าใครเข้ามาและพฤติกรรมก่อนถึงจุด trigger |
| 🚗 Parking entrance/exit + LP read | ✅ Enable | จับรถก่อน plate scan |
| 📹 General CCTV monitoring | ❌ Disable | snapshot อย่างเดียวพอ — ลด disk + bandwidth |
| 🪑 Indoor general (corridor, meeting) | ❌ Disable | snapshot อย่างเดียวพอ |
| 🔄 Rare-event area (storage, IT room) | ❌ Disable | snapshot อย่างเดียวพอ |

> **Default per camera:** `enable_clip_capture=false` (opt-in). Operator เปิดเองตามนโยบาย site

### Per-clip-enabled camera resource cost

| ทรัพยากร | ต่อกล้อง (1080p Stream 2) | x100 cams | x500 cams |
|---|---:|---:|---:|
| Network in (LAN) | ~2 Mbps | ~200 Mbps | **~1 Gbps** |
| ffmpeg CPU | ~3-5% ของ 1 core | 3-5 cores | 15-25 cores |
| ffmpeg RAM | ~80 MB | ~8 GB | ~40 GB |
| Rolling buffer disk | ~7.5 MB transient | ~750 MB | ~3.75 GB |
| Clip storage 30d (200 ev/day) | **~16 GB** | ~1.6 TB | ~8 TB |

### Trade-off matrix — % of cams with clip capture

Standard 200 events/cam/day × 30-day retention:

| Cams (G1=100) | 0% clips | 25% clips | 50% clips | 100% clips |
|---|---|---|---|---|
| Network in | trivial | 50 Mbps | 100 Mbps | 200 Mbps |
| Disk (clips 30d) | 0 GB | 400 GB | 800 GB | **1.6 TB** ⚠️ |
| ffmpeg CPU cores | 0 | ~1 | ~2 | ~5 |
| ffmpeg RAM | 0 | 2 GB | 4 GB | 8 GB |

| Cams (G3=1000) | 0% clips | 25% clips | 50% clips | 100% clips |
|---|---|---|---|---|
| Network in | trivial | **500 Mbps** | **1 Gbps** ⚠️ | **2 Gbps** ⚠️⚠️ |
| Disk (clips 30d) | 0 GB | 4 TB | 8 TB | **16 TB** ⚠️ |
| ffmpeg CPU cores | 0 | ~12 | ~25 | ~50 ⚠️ |
| ffmpeg RAM | 0 | 20 GB | 40 GB | 80 GB |

> ⚠️ **For G3+ ที่อยาก 100% clip capture** ต้อง 10GbE switch + 16+ TB disk + 50+ cores. Hardware ด้านล่างใน G1-G5 ออกแบบให้รองรับ **default 30% clip ratio** — ถ้าจะ 100% ต้อง upgrade

### 🎯 Sizing เลือก stream

| Stream | Resolution | Bitrate | Use case |
|---|---|---:|---|
| Stream 1 (`?inst=1`) | 4K UHD 3840×2160 | ~9 Mbps | ดูใน UI live เท่านั้น (ไม่ pull เพื่อ clip) |
| **Stream 2 (`?inst=2`) ⭐** | **1080p 1920×1080** | **~2 Mbps** | **Default สำหรับ clip capture — 4-5× เบากว่า** |
| Stream 3 (`?inst=3`) | 720p 1280×720 | ~1 Mbps | Optional — bandwidth ต่ำมาก แต่ภาพไม่สวยถ้า zoom |

> ระบบใช้ Stream 2 เป็น default ตั้งแต่ Phase 6.1.9. ตัวเลขในตารางทั้งหมดใช้ Stream 2

---

## 📊 Capacity Calculations (Standard 200 ev/cam/day)

> **Snapshot + DB scenario** ที่ทุก camera พบ (clip ไม่นับใน table นี้ — แยกด้านบน). RTSP network = **0 ถ้าไม่เปิด clip**

| Group | Cameras | Events/Day | Avg EPS | Peak EPS | DB/Year | Snapshot 30d | MQTT Network Peak |
|-------|--------:|-----------:|--------:|---------:|--------:|-------------:|-------------:|
| **G1** STARTER | ≤100 | 20,000 | 0.23 | 1.2 | **6 GB** | **77 GB** | **0.5 Mbps** |
| **G2** STANDARD | 500 | 100,000 | 1.2 | 6 | **30 GB** | **384 GB** | **2.5 Mbps** |
| **G3** PRO | 1,000 | 200,000 | 2.3 | 12 | **60 GB** | **768 GB** | **5 Mbps** |
| **G4** ENTERPRISE | 2,000 | 400,000 | 4.6 | 23 | **120 GB** | **1.5 TB** | **10 Mbps** |
| **G5** DATACENTER | 3,000 | 600,000 | 6.9 | 35 | **180 GB** | **2.3 TB** | **15 Mbps** |

### 🔴 Heavy scenario (×5 multiplier — perimeter/traffic)

| Group | Events/Day | Peak EPS | DB/Year | Snapshot 30d |
|-------|-----------:|---------:|--------:|-------------:|
| G1 (100) | 100,000 | 6 | 30 GB | 384 GB |
| G3 (1K)  | 1,000,000 | 60 | 300 GB | 3.8 TB |
| G5 (3K)  | 3,000,000 | 175 | 920 GB | 11.5 TB |

> **Hardware ที่แนะนำด้านล่างออกแบบให้รองรับ heavy scenario + 30% clip capture** ได้สบาย ๆ

---

## 🏷️ Deployment Profiles (A / B / C)

> เพิ่ม 2026-05-29 — Decision #182.
> **G-tier (G1–G5) = จำนวนกล้อง** (axis แนวตั้ง)
> **Profile (A/B/C) = ชุด feature ที่เปิดใช้** (axis แนวนอน)
> สองมิตินี้เป็นอิสระจากกัน — เลือกได้อิสระ

| Feature | **A — Insights** | **B — +Snapshot** | **C — Full** |
|---|:---:|:---:|:---:|
| Dashboard / Map / Stats | ✅ | ✅ | ✅ |
| Live view (RTSP direct จากกล้อง) | ✅ | ✅ | ✅ |
| LINE alert | ✅ | ✅ | ✅ |
| Snapshot เก็บไว้ใน disk | ❌ | ✅ | ✅ |
| Pre-alarm video clip | ❌ | ❌ | ✅ |
| ffmpeg / RTSP pull 24/7 | ❌ | ❌ | ✅ |
| MinIO / object storage | ❌ | เล็ก | ใหญ่ |
| **Driver หลัก** | DB write + stats query | + disk I/O snapshot | + network + CPU ffmpeg |

> **LINE ใน Profile A:** ทำงานแบบ **capture → send → discard** — ถ่ายภาพ ณ เวลา event → ส่ง LINE → ลบทิ้ง ไม่เก็บ disk
> Event history ใน dashboard จะไม่มีรูปประกอบ — acceptable สำหรับ use case "แจ้งเตือน / สถิติเท่านั้น"

### เลือก Profile ไหน?

| Use Case | Profile |
|---|:---:|
| นับคนเข้า-ออก, สถิติ traffic, People Count, แจ้งเตือน LINE เท่านั้น | **A** |
| ดู event ย้อนหลัง + ภาพประกอบ แต่ไม่ต้องการ video | **B** |
| Forensic / pre-alarm video / insurance / court evidence / ต้องการ video clip ก่อน event | **C** |
| Face Recognition *(planned — Profile D, pgvector + GPU)* | **C + GPU** |

---

## 📊 Quick-Select Matrix (Camera Count × Profile)

> **Hardware cost = ค่า hardware เท่านั้น** ไม่รวม SW / implementation / MA
> G-tier ที่ไม่แสดงในตาราง (G2/G4) → ดูรายละเอียดใน section ด้านล่าง
> Profile C ที่ทุก tier = spec เดิมใน G1–G5 sections

| กล้อง | **Profile A — Insights** | **Profile B — +Snapshot** | **Profile C — Full** |
|------:|---|---|---|
| **≤100** | 1 server · i5/16 GB/256 GB NVMe · **~20–30K THB** | 1 server · i5/16 GB/256 GB NVMe + 1 TB SSD · **~25–40K THB** | 1 server (G1 spec) · **35–50K THB** |
| **1,000** | 2 servers · 32+64 GB / 1 TB NVMe · **~200–300K THB** | 2 servers · 32+64 GB / 1 TB+2 TB NVMe · **~250–380K THB** | 2-3 servers (G3 spec) · **600–800K THB** |
| **3,000** | 2 servers · 32+128 GB / 2×2 TB NVMe RAID 1 · **~300–500K THB** | 2-3 servers · 32+128 GB / 2×2 TB+4 TB · **~400–650K THB** | ~30 nodes (G5 spec) · **9–12M THB** |

> ⚠️ **Profile C ที่ 3,000 กล้อง แพงกว่า Profile A ถึง ~18–24×** เพราะต้องการ MinIO ×8 + K8s ×8 + media-recorder tier + 100 GbE network
> Profile A/B ที่ 3,000 กล้อง ไม่ต้องการ Kubernetes, MinIO, Kafka, ffmpeg, edge aggregator — ใช้ Docker Compose 2 เครื่องได้

### Profile A — Specs ย่อ (stats-only)

| กล้อง | Architecture | CPU | RAM | Storage | Network |
|------:|---|---|---|---|---|
| **≤100** | 1 server all-in-one | Intel Core i5-13500 (14C) | 16 GB | 256 GB NVMe OS+DB | 1 Gbps |
| **1,000** | App + DB แยก | Xeon E-2486 (8C/16T) each | 32 GB + 64 GB | 500 GB + 2×1 TB NVMe RAID 1 | 1 Gbps |
| **3,000** | App + DB แยก | Xeon Silver 4416+ (20C) each | 32 GB + 128 GB | 500 GB + 2×2 TB NVMe RAID 1 | 1 Gbps |

### Profile B — Delta จาก A (เพิ่ม snapshot storage เท่านั้น)

| กล้อง | Snapshot 30d | เพิ่ม disk | เพิ่มราคา HW |
|------:|---:|---|---:|
| **≤100** | ~80 GB | +1 TB SATA SSD | ~5,000 THB |
| **1,000** | ~768 GB | +2 TB SSD บน DB server | ~20,000 THB |
| **3,000** | ~2.3 TB | +4 TB SSD บน storage server | ~40,000 THB |

---

## 🎯 Group 1 — STARTER (≤100 cameras)

**Use cases:** บ้านขนาดใหญ่, สำนักงานขนาดเล็ก, โรงเรียนเล็ก, ร้านค้าเดี่ยว
**Architecture:** Single all-in-one server
**Phase 6.1 assumption:** 30% clip-enabled cameras (~30 cams pull RTSP 24/7)

```
┌──────────────────────────────────────┐
│  1× Server (Bare Metal / VM / NUC)    │
│  ├─ EMQX 5.8 broker (Docker)          │
│  ├─ PostgreSQL 16 (Docker)            │
│  ├─ Node.js: subscriber + api         │
│  ├─ Node.js: media-recorder 🆕        │
│  ├─ ffmpeg × ~30 (clip-enabled cams)  │
│  ├─ Cloudflared tunnel                │
│  ├─ Snapshot storage (local SSD)      │
│  └─ Clip storage 🆕 (separate volume) │
└──────────────────────────────────────┘
```

### 💻 Recommended Hardware

| Component | Specification | หมายเหตุ |
|---|---|---|
| **CPU** | Intel Core i5-13500 (14C/20T) หรือ AMD Ryzen 5 7600 | 6+ core, headroom สำหรับ ffmpeg ×30 |
| **RAM** | **24 GB** DDR4/DDR5 (เดิม 16 GB) | +5 GB สำหรับ 30 ffmpeg subprocesses + Node.js + DB |
| **Boot/OS** | 256 GB NVMe | ไม่ต้อง RAID |
| **DB Volume** | 500 GB NVMe (Samsung 980 Pro หรือ Crucial P3 Plus) | DB+WAL+indexes |
| **Snapshot Volume** | 1 TB SATA SSD | 30d retention = ~80 GB |
| **🆕 Clip Volume** | **2 TB SATA SSD หรือ HDD** | 30d × 30% cams × 200 ev × 3.5 MB ≈ ~500 GB |
| **🆕 Buffer Volume** | (อยู่บน Boot/OS NVMe) | Rolling buffer transient ~225 MB total |
| **Network** | **1 Gbps Ethernet** (full-duplex) | RTSP pull 30 cams × 2 Mbps = ~60 Mbps in (เดิม 0.5 Mbps trivial) |
| **Form Factor** | NUC / Mini PC / 1U server | Beelink SER, Intel NUC, Dell R250 |

### 🔧 Software Tuning

```ini
# EMQX 5.8 — emqx.conf (HOCON) หรือ env vars ใน docker-compose
listeners.tcp.default.max_connections = 5000
# anonymous mode (match prior Mosquitto allow_anonymous):
#   EMQX_LISTENERS__TCP__DEFAULT__ENABLE_AUTHN=false
# EMQX persist sessions/retained-messages ให้เองโดย default

# postgresql.conf
shared_buffers       = 4GB     # 25% of RAM
effective_cache_size = 12GB    # 75% of RAM
work_mem             = 32MB
max_connections      = 50
```

### 💰 Cost (Thailand 2026)

| Item | Price (THB) |
|------|------------:|
| Hardware (Mini PC class) | 35,000-50,000 |
| Setup + tuning | 15,000 |
| **Total upfront** | **50,000-65,000** |
| Annual MA | ดูสูตร [MA & SLA Tiers](#-ma--sla-tiers) — 12% × (HW+SW+Impl) |
| **5-year TCO** | ขึ้นกับ SW cost + MA tier — ดู Commercial TCO Summary |

---

## 🎯 Group 2 — STANDARD (100-500 cameras)

**Use cases:** Office building, retail mall, hotel, hospital small, university campus (single building)
**Architecture:** Single server (split DB volume) — ไม่ต้องแยก server แยก process ก็พอ

```
┌────────────────────────────────────────┐
│  1× Server (1U/2U Rack)                 │
│  ├─ EMQX 5.8 broker (Docker)            │
│  ├─ PostgreSQL 16 (Docker)              │
│  ├─ Node.js subscriber                  │
│  ├─ Node.js API + WebSocket             │
│  └─ Snapshot volume (separate disk)     │
└────────────────────────────────────────┘
       ↓ 1 Gbps LAN
   [Cameras + Cloudflared]
```

### 💻 Recommended Hardware

> **Phase 6.1 assumption:** 30% clip-enabled cameras (~150 cams pull RTSP 24/7)

| Component | Specification |
|---|---|
| **CPU** | Intel Xeon E-2486 (8C/16T, 3.5GHz) หรือ AMD EPYC 4344P (8C/16T) |
| **RAM** | **48 GB** DDR4 ECC (เดิม 32 GB) — +12 GB สำหรับ ~150 ffmpeg + media-recorder |
| **Boot** | 2× 256 GB NVMe RAID 1 |
| **DB Volume** | 2× 1 TB NVMe RAID 1 (DB+WAL) |
| **Snapshot Volume** | 4 TB SATA SSD หรือ NVMe (เก็บได้ 90-180 วัน) |
| **🆕 Clip Volume** | **8 TB NVMe หรือ SSD** | 30d × 30% × 500 cams × 200 ev × 3.5 MB ≈ ~3 TB |
| **Network** | **2× 1 Gbps (bond/LACP)** หรือ **1× 10 GbE** | RTSP pull 150 cams × 2 Mbps = ~300 Mbps in |
| **Form Factor** | Dell R250/R350, HPE DL325, Lenovo SR250 |

### 🔧 Software Tuning

```ini
# EMQX 5.8
listeners.tcp.default.max_connections = 10000
mqtt.max_mqueue_len = 10000   # per-session queue (แทน Mosquitto max_queued_messages)

# PostgreSQL
shared_buffers       = 8GB
effective_cache_size = 24GB
work_mem             = 64MB
maintenance_work_mem = 1GB
max_connections      = 100
checkpoint_timeout   = 15min
wal_buffers          = 32MB
```

```javascript
// Node.js (PM2 cluster mode — Phase 2 roadmap)
// ecosystem.config.js
{ apps: [
  { name: 'subscriber', script: 'mqtt-subscriber.js', instances: 1, exec_mode: 'fork' },
  { name: 'api',        script: 'api-server.js',     instances: 2, exec_mode: 'cluster' },
]}
```

### 💰 Cost (Thailand 2026)

| Item | Price (THB) |
|------|------------:|
| Hardware (1U server) | 150,000-200,000 |
| Setup + tuning | 30,000 |
| **Total upfront** | **180,000-230,000** |
| Annual MA | ดูสูตร [MA & SLA Tiers](#-ma--sla-tiers) — 12% × (HW+SW+Impl) |
| **5-year TCO** | ขึ้นกับ SW cost + MA tier — ดู Commercial TCO Summary |

---

## 🎯 Group 3 — PROFESSIONAL (500-1,000 cameras)

**Use cases:** Large enterprise, multi-building campus, mid-size mall, factory plant
**Architecture:** App server + DB server แยก + optional read replica

```
┌──────────────────────┐    ┌──────────────────────┐
│ App Server (1×)       │    │ DB Server (1×)        │
│ ├─ EMQX 5.8 broker    │◄──►│ └─ PostgreSQL 16      │
│ ├─ Node.js subscriber │    │     + TimescaleDB ext │
│ ├─ Node.js API ×2     │    │     (events hypertbl) │
│ └─ pgbouncer          │    │                       │
└──────┬───────────────┘    └──────────────────────┘
       │                              ▲
       └──────────────────────────────┘
                  ↓
       ┌──────────────────────┐
       │ NAS / Snapshot Store │ (NFS or local)
       └──────────────────────┘
```

### 💻 Recommended Hardware

> **Phase 6.1 assumption:** 30% clip-enabled cameras (~300 cams pull RTSP 24/7 = ~600 Mbps). Consider **dedicated Media Recorder server** if pushing toward 100% clip ratio (= 2 Gbps in)

#### App Server
| Component | Specification |
|---|---|
| **CPU** | Intel Xeon Silver 4416+ (20C/40T) — เดิม 4314 — +cores สำหรับ ffmpeg ×300 |
| **RAM** | **96 GB** DDR4 ECC (เดิม 64 GB) — +32 GB สำหรับ ffmpeg subprocesses |
| **Boot** | 2× 480 GB NVMe RAID 1 |
| **Snapshot** | 8 TB NVMe หรือ NFS mount |
| **🆕 Clip Volume** | **16 TB NVMe RAID 10 หรือ NFS** | 30d × 30% × 1000 cams × 200 ev × 3.5 MB ≈ ~6 TB |
| **Network** | **2× 10 Gbps SFP+ (LACP)** | RTSP pull ~600 Mbps + LAN/Internet headroom |

#### DB Server
| Component | Specification |
|---|---|
| **CPU** | Intel Xeon Silver 4314 (16C/32T) |
| **RAM** | **128 GB** DDR4 ECC |
| **Boot** | 2× 480 GB NVMe RAID 1 |
| **Data** | 4× 2 TB NVMe RAID 10 (DB+WAL) |
| **Network** | 2× 10 Gbps SFP+ |

### 🔧 Software Tuning

- **PostgreSQL + TimescaleDB extension** — สำหรับ events เป็น hypertable, อัตโนมัติ partition ตามเดือน
- **PgBouncer** ระหว่าง app ↔ DB (pool_mode=transaction, pool_size=25)
- **EMQX data dir on NVMe** (avoid HDD)
- **Multiple subscribers** หาก peak EPS > 50 — round-robin via topic prefix
- **Stats v2 caching** — Redis 6 GB เก็บ category aggregations 60s

```sql
-- TimescaleDB setup
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('events', 'event_time',
  chunk_time_interval => INTERVAL '1 month',
  migrate_data => TRUE);

-- Compression on chunks > 30 days
ALTER TABLE events SET (timescaledb.compress);
SELECT add_compression_policy('events', INTERVAL '30 days');
```

### 💰 Cost (Thailand 2026)

| Item | Price (THB) |
|------|------------:|
| 2× Server hardware | 600,000-800,000 |
| Network (2× 10G switch) | 80,000 |
| Setup + tuning + HA | 120,000 |
| **Total upfront** | **800,000-1,000,000** |
| Annual MA | ดูสูตร [MA & SLA Tiers](#-ma--sla-tiers) — 12% × (HW+SW+Impl) |
| **5-year TCO** | ขึ้นกับ SW cost + MA tier — ดู Commercial TCO Summary |

---

## 🎯 Group 4 — ENTERPRISE (1,000-2,000 cameras)

**Use cases:** Multi-site enterprise, city sub-zone, large hospital network, prison, airport terminal
**Architecture:** HA cluster — DB replication + app load balancer + S3-compatible object storage

```
                ┌──────────────┐
                │ Load Balancer│ (HAProxy / Nginx)
                └──────┬───────┘
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ App Node 1   │ │ App Node 2   │ │ MQTT Cluster │
│ (api+sub)    │ │ (api+sub)    │ │ EMQX × 2     │
└──────┬───────┘ └──────┬───────┘ └──────────────┘
       │                │
       ▼                ▼
┌────────────────────────────────────┐
│ PostgreSQL Cluster (Patroni HA)     │
│ Master + Sync Replica + Async Async │
│ + TimescaleDB + PgBouncer           │
└──────────────────┬─────────────────┘
                   ▼
       ┌──────────────────────┐
       │ MinIO (4-node erasure) │
       │ Snapshot object store  │
       └──────────────────────┘
```

### 💻 Recommended Hardware

> **Phase 6.1 assumption:** 30% clip-enabled cameras (~600 cams pull RTSP × 2 Mbps = ~1.2 Gbps total). For 100% clip ratio = ~4 Gbps → split media-recorder onto its own dedicated server tier (see "🆕 Dedicated Media Recorder tier" below)

#### 🆕 Dedicated Media Recorder Servers (×2-4 active, sharded by camera_id)
| Component | Spec (each) |
|---|---|
| CPU | Intel Xeon Silver 4416+ (20C/40T) — for ffmpeg ×~150 per node |
| RAM | 32 GB ECC |
| Boot | 2× 480 GB NVMe RAID 1 |
| **Clip Volume** | **20 TB NVMe RAID 10 หรือ NFS to MinIO** |
| Network | **2× 25 Gbps SFP28** (RTSP pull-heavy) |

#### App Servers (×2 active-active) — no longer hosts ffmpeg
| Component | Spec (each) |
|---|---|
| CPU | Intel Xeon Gold 6338 (32C/64T) |
| RAM | 128 GB ECC |
| Boot | 2× 480 GB NVMe RAID 1 |
| Network | 2× 25 Gbps SFP28 |

#### MQTT Cluster (EMQX, ×2)
| Component | Spec (each) |
|---|---|
| CPU | Intel Xeon Silver 4416+ (20C/40T) |
| RAM | 64 GB |
| Storage | 2× 480 GB NVMe RAID 1 |
| Network | 2× 25 Gbps |

#### PostgreSQL HA Cluster (×3 — Patroni)
| Component | Spec (each) |
|---|---|
| CPU | Intel Xeon Gold 6338 (32C/64T) |
| RAM | 256 GB ECC |
| Storage | 6× 2 TB NVMe RAID 10 |
| Network | 2× 25 Gbps |

#### MinIO Object Storage (×4 nodes)
| Component | Spec (each) |
|---|---|
| CPU | Intel Xeon Silver 4416 (20C/40T) |
| RAM | 64 GB |
| Storage | 8× 16 TB SATA HDD (Erasure Coding 4+2) |
| Network | 2× 25 Gbps |

### 🔧 Software Stack

- **Kubernetes** (optional but recommended) — auto-scale, rolling deploy
- **EMQX 5** — MQTT 5.0, native clustering, JWT auth
- **Patroni + etcd** — PostgreSQL HA with auto-failover
- **TimescaleDB + Citus** (optional sharding ถ้า DB > 500 GB)
- **MinIO** — S3-compatible object storage
- **Redis Cluster** — session + Stats v2 cache
- **Prometheus + Grafana + Loki** — observability

### 💰 Cost (Thailand 2026)

| Item | Price (THB) |
|------|------------:|
| Server hardware (~11 nodes) | 2,400,000-3,200,000 |
| Network (25G switches + cables) | 500,000 |
| Setup + tuning + HA + DR | 400,000 |
| **Total upfront** | **3,300,000-4,100,000** |
| Annual MA | ดูสูตร [MA & SLA Tiers](#-ma--sla-tiers) — 12% × (HW+SW+Impl) |
| **5-year TCO** | ขึ้นกับ SW cost + MA tier — ดู Commercial TCO Summary |

---

## 🎯 Group 5 — DATACENTER (2,000-3,000 cameras)

**Use cases:** City-wide surveillance, national infrastructure, port, airport (full), prison system
**Architecture:** Multi-zone edge aggregation + central cloud-native cluster

```
┌─────────────────────────────────────────────────────────┐
│ Zone A (1000)  │ Zone B (1000) │ Zone C (1000)           │
│ Edge Aggregator│ Edge Aggregator│ Edge Aggregator         │
│ • EMQX         │ • EMQX         │ • EMQX                  │
│ • Local cache  │ • Local cache  │ • Local cache           │
└─────┬──────────┴───────┬────────┴──────────┬─────────────┘
      │ MQTT bridge (TLS, WAN)                │
      └────────────────────┬─────────────────┘
                           ▼
              ┌─────────────────────────┐
              │ Central K8s Cluster      │
              │ (Multi-AZ)               │
              │ • EMQX cluster ×3        │
              │ • App pods (HPA 3-12)    │
              │ • Postgres + Citus       │
              │   sharded (×4 workers)   │
              │ • MinIO (×8, 4+4 EC)     │
              │ • Kafka 3-broker         │
              │   (event stream buffer)  │
              │ • Redis Sentinel ×3      │
              └─────────────────────────┘
```

### 💻 Recommended Hardware (Central)

#### K8s Workers (×8 nodes)
| Component | Spec (each) |
|---|---|
| CPU | Xeon Platinum 8470 (52C/104T) |
| RAM | 384 GB ECC |
| Storage | 2× 1.92 TB NVMe RAID 1 (local) |
| Network | 2× 100 Gbps QSFP28 |

#### EMQX Cluster (×3)
| Component | Spec (each) |
|---|---|
| CPU | Xeon Gold 6444Y (16C/32T, 3.6GHz) |
| RAM | 128 GB |
| Storage | 4× 1 TB NVMe RAID 10 |
| Network | 2× 100 Gbps |

#### PostgreSQL + Citus (×5: 1 coord + 4 worker)
| Component | Spec (each) |
|---|---|
| CPU | Xeon Platinum 8470 (52C/104T) |
| RAM | 512 GB ECC |
| Storage | 8× 4 TB NVMe RAID 10 |
| Network | 2× 100 Gbps |

#### MinIO Cluster (×8 nodes, 4+4 EC)
| Component | Spec (each) |
|---|---|
| CPU | Xeon Gold 6438Y+ (32C/64T) |
| RAM | 128 GB |
| Storage | 12× 22 TB Enterprise HDD |
| Network | 2× 100 Gbps |

#### Edge Aggregators (×3 zones)
| Component | Spec (each) |
|---|---|
| CPU | Xeon Silver 4416+ (20C/40T) |
| RAM | 64 GB |
| Storage | 2× 1 TB NVMe + 8× 4 TB HDD |
| Network | 2× 25 Gbps |

#### Kafka Brokers (×3)
| Component | Spec (each) |
|---|---|
| CPU | Xeon Gold 6444Y (16C/32T) |
| RAM | 128 GB |
| Storage | 8× 2 TB NVMe RAID 10 |
| Network | 2× 100 Gbps |

### 🔧 Additional Stack

- **Apache Kafka** — buffer ระหว่าง MQTT → Subscriber (กัน burst หาย)
- **PostgreSQL + Citus** — horizontal sharding ตาม `camera_id` hash
- **Cilium** — eBPF-based networking + NetworkPolicy
- **Istio** (optional) — mTLS service mesh
- **Velero** — DR backup (RPO ≤ 1h, RTO ≤ 4h)
- **24/7 SOC** — Prometheus + Grafana + PagerDuty + on-call rotation
- **WAF** — Cloudflare Enterprise / AWS WAF

### 💰 Cost (Thailand 2026)

| Item | Price (THB) |
|------|------------:|
| Server hardware (~30 nodes + edge) | 9,000,000-12,000,000 |
| Network (100G switches + 25G ToR) | 1,500,000 |
| Setup + tuning + DR + multi-zone | 1,200,000 |
| **Total upfront** | **11,700,000-14,700,000** |
| Annual MA | ดูสูตร [MA & SLA Tiers](#-ma--sla-tiers) — 12% × (HW+SW+Impl) |
| **5-year TCO** | ขึ้นกับ SW cost + MA tier — ดู Commercial TCO Summary |
| **Cloud equivalent (AWS/Azure)** | ~150,000-200,000 THB/month |

---

## 📋 Summary Comparison

> **Storage row** = DB (1yr) + Snapshot (30d) + **Clip (30d @ 30% cams)**. Network row = **continuous RTSP pull** (clip-enabled cams only). Both grow linearly if you bump the clip ratio above 30%

| Group | Cams | Servers | Storage (Snap+Clip) | RTSP Net (30%) | Upfront (THB) | Annual MA | 5-yr TCO |
|-------|-----:|--------:|--------------------:|--------------:|--------------:|----------:|---------:|
| **G1** STARTER | ≤100 | 1 | ~600 GB | ~60 Mbps | 60K-80K | 12K-16K | ~140K |
| **G2** STANDARD | 500 | 1-2 | ~3.5 TB | ~300 Mbps | 200K-260K | 40K-52K | ~480K |
| **G3** PRO | 1K | 2-3 | ~7 TB | ~600 Mbps | 900K-1.1M | 270K-330K | ~2.4M |
| **G4** ENTERPRISE | 2K | ~11 | ~15 TB | ~1.2 Gbps | 3.5M-4.3M | 1.4M-1.7M | ~10.5M |
| **G5** DATACENTER | 3K | ~32+ | ~25 TB | ~1.8 Gbps | 12.3M-15.5M | 4.7M-5.8M | ~38M |

> Tier sizes assume 30% of cams have `enable_clip_capture=true`. **All-cams clip = 3-4× the storage and network** of the table above

---

## 🎚️ Scaling Triggers (เมื่อไหร่ควรอัพเกรด)

### 🔴 Vertical Scale (เพิ่ม spec server เดิม)
- CPU sustained > **70%** เกิน 1 ชม.
- RAM usage > **80%** ติดต่อกัน
- Disk IOPS saturated (read/write queue > 10)
- API p95 response > **500 ms**

### 🟡 Horizontal Scale (เพิ่ม node)
- MQTT broker connections > **80%** capacity
- DB connection pool exhausted บ่อยขึ้น
- Subscriber backlog (กรณีรับ event ไม่ทัน)
- Single-server bandwidth > **70%** of NIC

### 🟢 Architecture Shift (เปลี่ยน group)
| จาก → ถึง | Trigger |
|----------|---------|
| G1 → G2 | กล้อง > 100 หรือ DB > 50 GB หรือ snapshot > 200 GB |
| G2 → G3 | กล้อง > 500 หรือ peak EPS > 30 หรือ ต้องการ 99.9% uptime |
| G3 → G4 | กล้อง > 1,500 หรือ ต้องการ HA + auto-scale + multi-site |
| G4 → G5 | ต้อง multi-zone, edge processing, > 100M events/year |

---

## 🛡️ Security & Reliability Add-ons (G3+)

- **Network segmentation** — VLAN แยก camera / server / management
- **TLS encryption** — MQTT broker (port 8883) + DB connections (sslmode=require)
- **DDoS protection** — Cloudflare (already used) / AWS Shield (ถ้า public)
- **Backup strategy:**
  - Daily DB snapshot (`pg_basebackup` หรือ `pg_dump`)
  - Weekly full backup → offsite (S3, Backblaze B2)
  - Snapshot lifecycle policy (auto-tier old snapshots ไป S3 IA/Glacier)
- **Disaster Recovery:**
  - **G3:** RPO ≤ 4h, RTO ≤ 8h
  - **G4-G5:** RPO ≤ 1h, RTO ≤ 4h (synchronous replica + Patroni auto-failover)

---

## 💡 Cloud-native Alternative (G3-G5)

หากไม่ต้องการลงทุน hardware เอง — รัน on cloud (cost ประมาณ /เดือน):

| Cloud | Service Stack | G3 (1K cams) | G4 (2K cams) | G5 (3K cams) |
|-------|---------------|-------------:|-------------:|-------------:|
| **AWS** | EKS + RDS Postgres + S3 + MSK + ALB + CloudFront | ~70K | ~140K | ~220K |
| **Azure** | AKS + Azure DB for Postgres + Blob + Event Hubs + Front Door | ~75K | ~150K | ~230K |
| **GCP** | GKE + Cloud SQL + GCS + Pub/Sub + Cloud LB | ~65K | ~130K | ~200K |
| **DigitalOcean** | Managed K8s + Managed PG + Spaces + LB | ~35K | ~75K | ~120K |

> **PDPA note:** สำหรับ Thailand customer หลายรายต้องเก็บข้อมูลในไทย — เลือก AWS Bangkok region (ap-southeast-7) หรือ on-prem Thailand DC

---

## 💰 Cost Framework — 4 Layer Model

> แยก 4 layer ออกก่อนคำนวณทุกครั้ง — ห้ามปนกัน

| Layer | ลักษณะ | ขึ้นกับอะไร | จ่ายเมื่อไหร่ |
|---|---|---|---|
| **Hardware (CapEx)** | เครื่อง disk network จริง | G-tier × Profile (ดู Quick-Select Matrix) | ครั้งเดียว |
| **Software** | Platform license + per-project customization (white-label, vendor integration, reports) | ตาม quotation โครงการ — เป็น proprietary R&D amortized + project variable | ครั้งเดียว |
| **Implementation / Man-hours** | Install, config, tune, test, training, handover doc | Profile + G-tier (ด้านล่าง) | ครั้งเดียว |
| **MA (recurring)** | Support, patch, update, SLA | **12% × (HW + SW + Impl)** ต่อปี — ดู tier ด้านล่าง | ทุกปี |

> **MA base = ต้นทุน one-time ทั้งหมด (HW + SW + Impl)** — recurring ops ที่ลูกค้าได้รับคือสิ่งที่ MA ครอบคลุม ไม่ใช่ส่วนหนึ่งของ base

### Implementation Man-hours Estimate

> อัตรา ~7,500 THB/day รวม install, config, tune, test, training, handover doc

| Profile | ≤100 cams | 1,000 cams | 3,000 cams |
|---|---:|---:|---:|
| **A — Insights** | ~37,500 (5d) | ~112,500 (15d) | ~300,000 (40d) |
| **B — +Snapshot** | ~52,500 (7d) | ~150,000 (20d) | ~450,000 (60d) |
| **C — Full** | ~90,000 (12d) → G1 | ~300,000 (40d) → G3 | ~1,500,000 (200d) → G5 |

> Profile C ที่ G5 สูงเพราะ 30-node multi-zone: K8s build, Patroni, MinIO cluster, Kafka, camera integration 3,000 ตัว, UAT, training หลายทีม

---

## 📋 MA & SLA Tiers

### สูตร MA

```
MA (ต่อปี) = rate × (HW + SW + Implementation)
```

### Tier Options

| Tier | Rate | Response Time | Update Cycle | On-site | รายละเอียด |
|---|---:|---|---|---|---|
| **Bronze** *(default)* | **12%** | Business hours 9–18 จ–ศ | Quarterly | — | Hotfix + quarterly patch, email/chat support |
| **Silver** | **18%** | Extended 8–20 จ–ส | Monthly | 1 ครั้ง/ปี | + monthly security patch, annual health check visit |
| **Gold** | **25%** | 24/7 | On-demand | Quarterly | + dedicated contact, quarterly site review, SLA uptime 99.5% |

### ตัวอย่างคำนวณ — G1 Profile B (100 กล้อง + snapshot)

| Item | THB |
|---|---:|
| Hardware | 35,000 |
| Software | 120,000 *(ตัวเลขเสนอ — ปรับตาม quotation)* |
| Man-hours | 52,500 (7d) |
| **Total Base** | **207,500** |
| **MA Bronze 12%/yr** | **24,900** |
| **MA Silver 18%/yr** | **37,350** |
| **MA Gold 25%/yr** | **51,875** |

---

## 💰 Commercial TCO Summary

> **Updated 2026-05-29** — MA model: **12% × (HW+SW+Impl)** Bronze default · Hidden costs ปรับให้ realistic · Profile C (Full) baseline
> SW cost เป็นค่าเสนอ — ให้แทนด้วยตัวเลข quotation จริงก่อน sync ลง `docs/cost/Cost_Calculator.xlsx`

### Base Costs (one-time, Profile C)

| Tier | Hardware | Software† | Man-hours | **Total Base** |
|---|---:|---:|---:|---:|
| G1 | 80,000 | 150,000 | 90,000 | **320,000** |
| G2 | 240,000 | 300,000 | 150,000 | **690,000** |
| G3 | 1,200,000 | 600,000 | 300,000 | **2,100,000** |
| G4 | 3,500,000 | 1,200,000 | 600,000 | **5,300,000** |
| G5 | 12,000,000 | 2,000,000 | 1,500,000 | **15,500,000** |

> †Software = platform license + per-project customization — ตัวเลขเป็นค่าเสนอ ให้ปรับตาม quotation จริง

### MA ต่อปี — ทุก SLA Tier

| Tier | Total Base | **Bronze 12%** | Silver 18% | Gold 25% |
|---|---:|---:|---:|---:|
| G1 | 320,000 | **38,400** | 57,600 | 80,000 |
| G2 | 690,000 | **82,800** | 124,200 | 172,500 |
| G3 | 2,100,000 | **252,000** | 378,000 | 525,000 |
| G4 | 5,300,000 | **636,000** | 954,000 | 1,325,000 |
| G5 | 15,500,000 | **1,860,000** | 2,790,000 | 3,875,000 |

### Hidden Cost Assumptions (revised)

> เดิม hidden สูงมาก (G5=18.6M/yr) เพราะ over-estimated — ปรับใหม่ให้ตรงกับ actual operating cost

| Tier | Hidden/yr | รายละเอียด |
|---|---:|---|
| G1 | 50,000 | Power ~9K + ISP ~2K + staff ops 5d ~38K |
| G2 | 100,000 | Power ~18K + ISP ~5K + staff ops 10d ~75K |
| G3 | 250,000 | Power ~35K + network ~20K + staff ops 2d/mo ~180K |
| G4 | 800,000 | Power ~130K + network ~100K + ops staff 1 คน ~570K |
| G5 | 4,000,000 | Power ~660K + DC ~600K + network ~200K + ops staff 2 คน ~2,160K + misc ~380K |

### Year 1 — Total Investment (Bronze default)

| Tier | Hardware | Software | Man-hours | MA Bronze | Hidden | **Total Y1** |
|---|---:|---:|---:|---:|---:|---:|
| G1 | 80,000 | 150,000 | 90,000 | 38,400 | 50,000 | **408,400** |
| G2 | 240,000 | 300,000 | 150,000 | 82,800 | 100,000 | **872,800** |
| G3 | 1,200,000 | 600,000 | 300,000 | 252,000 | 250,000 | **2,602,000** |
| G4 | 3,500,000 | 1,200,000 | 600,000 | 636,000 | 800,000 | **6,736,000** |
| G5 | 12,000,000 | 2,000,000 | 1,500,000 | 1,860,000 | 4,000,000 | **21,360,000** |

### Year 2-5 — Recurring per Year (Bronze)

| Tier | MA Bronze | Hidden | HW refresh* | **Annual Total** |
|---|---:|---:|---:|---:|
| G1 | 38,400 | 50,000 | 16,000 | **104,400** |
| G2 | 82,800 | 100,000 | 48,000 | **230,800** |
| G3 | 252,000 | 250,000 | 240,000 | **742,000** |
| G4 | 636,000 | 800,000 | 700,000 | **2,136,000** |
| G5 | 1,860,000 | 4,000,000 | 2,400,000 | **8,260,000** |

> *HW refresh = 20% of HW CapEx / yr (5-year lifecycle)

### 5-Year TCO

| Tier | Year 1 | Year 2-5 (×4) | **5-Year Total** | **Cost/cam/yr** |
|---|---:|---:|---:|---:|
| G1 | 408,400 | 417,600 | **826,000** | **1,652** |
| G2 | 872,800 | 923,200 | **1,796,000** | **718** |
| G3 | 2,602,000 | 2,968,000 | **5,570,000** | **1,114** |
| G4 | 6,736,000 | 8,544,000 | **15,280,000** | **1,528** |
| G5 | 21,360,000 | 33,040,000 | **54,400,000** | **3,627** |

---

### 💼 Suggested Sale Price — Contract Options

> **~35% gross margin** ทุก tier ทุก length · ราคาไม่รวม VAT · HW เป็นกรรมสิทธิ์ของลูกค้า
> สัญญายาว = per-cam/yr ถูกลง — ใช้เป็น incentive ให้ลูกค้า commit ยาว

#### ราคาต่อสัญญา (THB)

| Tier | Cams | **1 ปี** | **2 ปี** | **3 ปี** | **5 ปี** | Margin |
|---|---:|---:|---:|---:|---:|---:|
| G1 | 100 | **630,000** | **790,000** | **950,000** | **1,300,000** | ~35% |
| G2 | 500 | **1,350,000** | **1,700,000** | **2,100,000** | **2,800,000** | ~35% |
| G3 | 1,000 | **4,000,000** | **5,200,000** | **6,300,000** | **8,600,000** | ~35% |
| G4 | 2,000 | **10,400,000** | **13,700,000** | **17,000,000** | **23,500,000** | ~35% |
| G5 | 3,000 | **33,000,000** | **46,000,000** | **58,000,000** | **84,000,000** | ~35% |

#### Per-Camera / Per-Year (สำหรับเซลล์ใช้เปรียบเทียบ)

| Tier | Cams | 1 ปี | 2 ปี | 3 ปี | **5 ปี** |
|---|---:|---:|---:|---:|---:|
| G1 | 100 | 6,300 | 3,950 | 3,167 | **2,600** |
| G2 | 500 | 2,700 | 1,700 | 1,400 | **1,120** |
| G3 | 1,000 | 4,000 | 2,600 | 2,100 | **1,720** |
| G4 | 2,000 | 5,200 | 3,425 | 2,833 | **2,350** |
| G5 | 3,000 | 11,000 | 7,667 | 6,444 | **5,600** |

> **Sales tip:** เปรียบเทียบ G2 5ปี = **1,120 บาท/กล้อง/ปี** — ถูกกว่าค่า LINE Business ต่อปีสำหรับ 500 กล้อง และได้ทั้ง analytics + dashboard + alerts ครบ

---

### 📦 ราคา Turnkey vs แยก CapEx

> **ราคาทุกตารางด้านบน = Turnkey (ครบทุกอย่าง: HW + SW + Impl + MA + Hidden)**
> ใช้สำหรับ pre-sales / budgeting และโปรเจกต์ที่ DojoJin จัดหา hardware ให้ครบ

สำหรับ G3+ ที่ลูกค้า **ซื้อ hardware เอง** (hardware = ทรัพย์สินลูกค้า ไม่ใช่ค่าบริการ)
ให้แตกใบเสนอราคาออกเป็น 2 ส่วนดังนี้:

| ส่วน | รายการ | ใครเป็นเจ้าของ |
|---|---|---|
| **CapEx (ลูกค้าจัดซื้อเอง)** | Hardware (server, disk, switch, rack, UPS) | ลูกค้า |
| **Platform Fee (จ่าย DojoJin)** | SW license + Man-hours + MA ตามสัญญา | DojoJin deliver |

#### Platform Fee — สัญญา 5 ปี (excl. HW, Hidden, HW refresh)

> = SW + Man-hours + (MA Bronze × 5) — ราคาที่ DojoJin เรียกเก็บจริง
> Hidden และ HW refresh เป็น operating cost ของลูกค้าเอง (ไฟฟ้า, staff, ประกัน)

| Tier | SW | Man-hours | MA ×5yr | **Platform Fee (cost)** | **Platform Fee (sale ~35%)** |
|---|---:|---:|---:|---:|---:|
| G1 | 150,000 | 90,000 | 192,000 | 432,000 | **665,000** |
| G2 | 300,000 | 150,000 | 414,000 | 864,000 | **1,330,000** |
| G3 | 600,000 | 300,000 | 1,260,000 | 2,160,000 | **3,325,000** |
| G4 | 1,200,000 | 600,000 | 3,180,000 | 4,980,000 | **7,660,000** |
| G5 | 2,000,000 | 1,500,000 | 9,300,000 | 12,800,000 | **19,700,000** |

> ลูกค้าจ่าย Platform Fee ให้ DojoJin + ซื้อ HW เอง → total จ่ายจริงอาจต่างจาก Turnkey price
> ขึ้นกับ hardware ที่ลูกค้าเลือก (spec ต่ำกว่า = ถูกกว่า แต่ยังรัน platform ได้)

---

## 🛠️ Real-world Performance Notes (จาก v1.1 production)

ตัวเลขที่ควรรู้สำหรับ tune system:

### PostgreSQL
- `events` table มี GIN index บน `raw_json` (jsonb) — เพิ่ม index size ~33%
- Stats v2 queries ใช้ `EXISTS (... event_categories WHERE c.kind=?)` pattern — ต้องมี index บน `(category_id, kind)` ใน `event_category_rules`
- Daily retention job (`enforceRetention`) — DELETE batch อาจทำให้ table bloat → ใช้ `pg_repack` ทุกเดือน

### EMQX (broker)
- เปลี่ยนจาก Mosquitto 2.0 → **EMQX 5.8** (2026-05-19, decision #112) — Mosquitto 2.x strict validator reject MQTT 3.1 packets ของ Bosch firmware เก่า (8000i IVA Basic ไป 0 → 4 events/2min หลัง swap)
- EMQX ports: MQTT `:1883`, WS `:8083`, dashboard `:18083` (default `admin/public` — เปลี่ยนใน production)
- per-session queue ปรับที่ `mqtt.max_mqueue_len` (default พอสำหรับ G1-G2; เพิ่มเป็น 10000 ที่ G3+)
- EMQX clustering เป็น native — G4/G5 ใช้ 3-node cluster แทน broker เดี่ยว
- EMQX default file-ACL deny `subscribe #` สำหรับ non-localhost — subscriber ใช้ pattern เฉพาะ (`+/onvif-ej/...`) จึงผ่าน

### Node.js
- API server บนเครื่อง dev (M1 Mac, 16GB) ใช้ ~120 MB RSS idle, ~250 MB peak
- Subscriber ใช้ ~80 MB RSS
- รวมเดิน 8GB RAM ก็เหลือเฟือสำหรับ G1

### Snapshot disk growth
- Bosch FLEXIDOME 8100i → ~155 KB/JPEG (1080p, IR mode lower)
- 80% ของ events ใน `events` table มี snapshot file (MotionAlarm/JobState filtered ก่อน)
- Default retention 30 days = ~80 GB/100 cams ที่ standard rate

---

## 🔬 Worked Example: ลูกค้าจริง — Office Building 250 cams

**Profile:**
- Bangkok office building, 25 ชั้น
- 250 cameras (lobby + parking + corridor + lift)
- Standard activity (200 ev/cam/day)
- Retention: events 365d, snapshot 30d, **clip 30d**
- **Phase 6.1 plan:** เปิด clip บนกล้องที่สำคัญเท่านั้น — lobby (5) + parking entry/exit (4) + perimeter (10) + lift entrance (16) = **35 cams (14%)**
- Budget: 250K THB

**คำนวณ:**

*Events + DB (เดิม):*
- Events/day: 250 × 200 = 50,000 events/day
- Peak EPS: 50,000 / 86400 × 5 = **~3 EPS** (เบามาก)
- DB/year: 50,000 × 365 × 850 B ≈ **15 GB/year**
- Snapshot: 50,000 × 0.8 × 30 × 160 KB ≈ **190 GB**

*🆕 Phase 6.1 — Clip + RTSP overhead:*
- Clip-enabled cams: **35**
- Clips/day: 35 × 200 × 0.7 (skip Aggregation) = ~4,900 clips/day
- Clip storage 30d: 4,900 × 30 × 3.5 MB ≈ **515 GB**
- RTSP network in (24/7): 35 × 2 Mbps = **70 Mbps** (ปลอดภัยบน 1 GbE)
- ffmpeg subprocess: 35 × 80 MB = **2.8 GB RAM**
- ffmpeg CPU: 35 × 4% = **~1.4 cores**

**Total storage requirement:**
- Snapshot 30d: 190 GB
- Clip 30d: 515 GB
- DB 1yr: 15 GB (หรือ ~45 GB ถ้าเก็บ 3 ปี)
- **รวม ~720 GB → 2 TB SSD เผื่อ headroom**

**แนะนำ:** Group 2 (1U server) — Xeon E-2486, **48 GB RAM**, 2× 1 TB NVMe (DB) + 2 TB SSD (Snapshot+Clip), 1 GbE → upfront ~210K, MA 42K/yr

> ถ้าลูกค้าตัดสินใจเปิด clip ทั้ง 250 cams = ~3.7 TB clips + 500 Mbps RTSP → ต้อง upgrade ไป G3 (2-server) แทน

---

## 🚀 Software-side Scale-up — Plan (2026-05-21)

Hardware sizing ด้านบนตอบ "เครื่องพอไหม" — section นี้ตอบ "โค้ดพอไหม". ที่ ≤100 กล้อง
สถาปัตยกรรมปัจจุบัน (api-server เดี่ยว + ingester 1 process ต่อ vendor) ทำงานสบาย แต่ที่
500–3,000 กล้องจะเจอ bottleneck — เรียงตามลำดับที่จะเจอจริง:

### Backend

| # | Bottleneck | อาการเมื่อ scale | แผนแก้ |
|---|-----------|------------------|--------|
| B1 | **MQTT broker** | — | ✅ แก้แล้ว — EMQX 5.8 (decision #112) รองรับ 100k+ connections + native clustering |
| B2 | **`events` table โตเป็นร้อยล้านแถว** | query ช้า, retention `DELETE` ล็อกนาน, table bloat | partition `events` BY RANGE (`event_time`) รายเดือน — TimescaleDB hypertable หรือ native declarative partitioning; retention = DROP partition (instant, ไม่ bloat) |
| B3 | **pg connection pool** | `pool` default max=10 — traffic สูง + หลาย ingester แล้วคิว | เพิ่ม pool max → 20–50 + PgBouncer (transaction mode) ที่ G3+ |
| B4 | **Ingester = single Node process ต่อ vendor** | 1 event loop รับ MQTT/ISAPI ของกล้องทุกตัว — ที่ 500+ กล้อง CPU 1 core ตัน | แตก ingester เป็นหลาย worker, shard กล้องด้วย topic-prefix / camera-id hash (plugin architecture — roadmap Path B Phase 4) |
| B5 | **api-server เดี่ยว** | จุดล้มเดียว; `executive-summary` ยิง 13 query/refresh | (ก) cache exec-summary 30–60s; (ข) รัน api-server 2 ตัวหลัง load balancer (session อยู่ใน DB แล้ว — แต่ WS ต้อง sticky); (ค) เพิ่ม API rate-limit |
| B6 | **Snapshot/clip = ไฟล์ในโฟลเดอร์เดียว** | `snapshots/` ล้านไฟล์/โฟลเดอร์ → `readdir` ช้า, retention scan O(n) | shard เป็น `snapshots/YYYY-MM-DD/`; ย้าย clip ไป object store (MinIO/S3) ที่ G4+ |
| B7 | **media-recorder = 1 ffmpeg ต่อกล้อง** | CPU/RAM/network คงที่ต่อกล้อง (~80MB + 2Mbps) | แยก media-recorder เป็น tier ของตัวเองที่ G3+ (hardware guide ครอบคลุมแล้ว) |

### Frontend (UI)

| # | Bottleneck | อาการเมื่อ scale | แผนแก้ |
|---|-----------|------------------|--------|
| F1 | **Camera grid render กล้องทุกตัว** | 3,000 การ์ด = 3,000 DOM node + 3,000 live-snapshot request → browser ค้าง | (ก) virtualize/paginate grid; (ข) lazy-load snapshot เฉพาะการ์ดที่มองเห็น (IntersectionObserver); (ค) บังคับ filter ก่อน render เมื่อกล้องเยอะ |
| F2 | **Camera settings list + Faces gallery** | render ทุกแถว/ทุกใบหน้า | ใส่ `renderPagination()` helper ที่มีอยู่แล้ว เมื่อจำนวนเกิน ~200 |
| F3 | **Map markers** | 3,000 marker บน OpenLayers กระตุก | ใช้ `ol.source.Cluster` รวม marker ที่ zoom ต่ำ |
| F4 | **WebSocket flood** | ทุก event broadcast ไปทุก client — busy site = หลายร้อย msg/วินาที | (ก) toast throttle ทำแล้ว; (ข) ถ้าจำเป็น เพิ่ม server-side per-client filter (subscribe เฉพาะ page/กล้องที่เปิดอยู่) |
| F5 | **Events Live / Snapshot / Media** | — | ✅ server-side pagination แล้ว (20/หน้า) |

### ลำดับงาน (เมื่อมี pilot จริง)
1. **B2** (partition `events`) + **B6** (shard snapshot dir) — ทำก่อนตอน DB ยังเล็กจะง่ายสุด
2. **F1** (virtualize camera grid) — เจอเร็วสุดฝั่ง UI (รู้สึกได้ที่ ~150+ กล้อง)
3. **B4** (ingester sharding) — ทำพร้อม plugin refactor (roadmap Path B Phase 4)
4. **B5** (api-server HA) + **B3** (PgBouncer) — เมื่อก้าวเข้า G3+ / ต้องการ HA

> ทั้งหมดนี้เป็น **แผน** — ยังไม่ลงโค้ดในรอบนี้ (รอ pilot จริงเพื่อ calibrate ก่อน — หลักการเดียวกับ roadmap Path B "wait for a real signal")

---

## 📖 Appendix — Quick Lookup

### "ลูกค้าผม X กล้อง ใช้สเปคไหน?"

> สเปคด้านล่างสมมติ **30% ของกล้องเปิด clip capture** (Phase 6.1 default recommended). ถ้า 100% clip capture ให้ดู column ขวาสุด

| กล้อง | Group | สเปคย่อ (30% clip) | Upfront 30% | Upfront 100% clip |
|------:|-------|---------|------------:|------------:|
| 50 | G1 | Mini PC: i5 / **24GB** / 500GB NVMe + 2TB SSD | 60K | 70K |
| 100 | G1 | NUC class: i5 / **24GB** / 500GB NVMe + 2TB SSD | 70K | 90K |
| 250 | G2 | 1U: Xeon E / **48GB** / 2× 1TB NVMe + 2TB SSD | 210K | 280K (4TB clip) |
| 500 | G2 | 1U: Xeon E / **48GB** / 2× 1TB NVMe + 8TB SSD | 260K | 350K |
| 750 | G3 | 2 servers: app+DB, **96GB**+128GB, 16TB clip | 950K | 1.3M (32TB clip) |
| 1,000 | G3 | 2 servers: app+DB, **96GB**+128GB, 16TB clip | 1.1M | 1.5M |
| 1,500 | G4 | HA cluster: 11 nodes, **+16TB clip storage** | 3.7M | 4.5M |
| 2,000 | G4 | HA cluster, bigger clip storage (~25TB) | 4.3M | 5.5M |
| 3,000 | G5 | Multi-zone + Citus + **dedicated media-recorder tier** | 12.5M | 16M |

> 💡 **Most customers ใช้ 20-40% clip ratio** (perimeter + entrance + LP) → use 30% column. **100% clip = surveillance video archive product** (different market — usually NVR territory, not Dashboard)

### "ลูกค้าจะเปิด clip กี่กล้อง" — quick decision tree

```
ลูกค้าต้องการ pre-alarm video สำหรับ:
├─ Forensic / police case file → enable on perimeter + entrance (~10-20%)
├─ Insurance claim evidence → enable on parking + reception (~15-30%)
├─ Operations review (HR / safety) → enable on selected risk areas (~20-40%)
├─ Court evidence (high-stakes) → enable on critical assets (~5-15%)
└─ "เผื่อไว้" (no specific use case) → ไม่แนะนำ — ใช้ snapshot อย่างเดียวคุ้มกว่า
```

---

<sub>Document v3.2 (canonical hardware sizing + high-level TCO, 2026-05-26) · DojoJin Tech Dashboard v1.5
Owner: Prakasit Rochanavipart · prakasit@dojojin.tech</sub>
