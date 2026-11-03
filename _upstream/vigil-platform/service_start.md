# Service Start Manual — Vigil Platform

> วิธีเปิด/ปิด/restart/ตรวจสอบ service — **3 เครื่อง**: central + edge 2 site
> Last updated: 2026-09-06

---

## 🖥️ เครื่องในระบบ (ตรวจจากของจริง 2026-07-27)

| เครื่อง | เข้าถึง | OS | ecosystem ที่ใช้ | process | boot unit |
|---|---|---|---|---|---|
| **central** | เครื่องนี้ | Linux Mint 22.3 | `ecosystem.config.js` | **9** | `pm2 startup` (enabled) |
| **HDY edge** | `ssh sshhdy` | Linux Mint 22.3 | `ecosystem.edge.config.js` | **7** | `pm2-hdy-edge.service` |
| **VSS edge** | `ssh sshvss` | Linux Mint 22.3 | `ecosystem.edge.config.js` | **6** | `pm2-vss2.service` |

```
central : api-server mqtt-subscriber media-recorder hikvision dahua report-worker alert-worker face-embed-worker lpr-receiver
HDY     : pm2-logrotate nanomq hikvision dahua lpr-receiver edge-config-agent edge-bridge
VSS     : nanomq hikvision dahua lpr-receiver edge-config-agent edge-bridge
```

**ตัวเลข process คือเครื่องมือตรวจที่ดีที่สุด** — ถ้า `pm2 list` ได้น้อยกว่านี้ แปลว่ามีตัวหายไป (ดู "กับดัก ecosystem" ด้านล่าง)

`ssh sshhdy` / `ssh sshvss` วิ่งผ่าน Cloudflare Access — ถ้า token หมดอายุจะ timeout ที่ banner exchange
ต่ออายุด้วย `cloudflared access login https://sshhdy.dojojin.tech` (ต้องรัน**บนเครื่อง central** แล้วเปิด URL ที่มันพิมพ์ในเบราว์เซอร์ไหนก็ได้)

---

## 🎯 TL;DR — restart

```bash
# ✅ ใช้อันนี้ — restart + ตรวจให้เสร็จในตัว ใช้ได้ทั้ง 3 เครื่อง
./scripts/pm2-safe-restart.sh

./scripts/pm2-safe-restart.sh --update-env   # แก้ .env / env ใน ecosystem แล้ว
./scripts/pm2-safe-restart.sh --check        # ตรวจเฉยๆ ไม่ restart
./scripts/pm2-safe-restart.sh api-server     # restart ตัวเดียว (ยังตรวจให้)
```

สคริปต์ห่อ `pm2 restart all` ไว้ — ตัวคำสั่งเปล่าๆ ก็ปลอดภัยอยู่แล้ว (ไม่อ่าน ecosystem
จึงสตาร์ตชุดผิดเครื่องไม่ได้) **แต่มันไม่บอกเมื่อมีอะไรผิด** สคริปต์เติมส่วนที่ขาด:

| ตรวจอะไร | ทำไม |
|---|---|
| เทียบรายชื่อ app กับ ecosystem ของเครื่องนั้น | `restart all` เรียกคืน process ที่ถูกลบไปแล้วไม่ได้ **และไม่บอก** |
| restart count ห่างกัน 8 วิ | เพิ่ง restart แล้วขึ้น `online` ไม่ได้แปลว่ารอด — crash-loop ก็ online ทุกจังหวะที่มอง |
| liveness จริง | central = `curl :3000` · edge = nanomq ฟัง `:1883` (ถ้าไม่ฟัง = ไซต์ไม่รับ event) |
| แยก central/edge เอง | ดูจาก process ที่รันอยู่ ไม่ใช่ hostname — เพิ่มไซต์ใหม่ไม่ต้องแก้สคริปต์ |

คืน exit code ≠ 0 เมื่อไม่เรียบร้อย — เอาไปต่อกับ monitoring ได้
(`cloudflared` ที่ประกาศใน edge ecosystem ถูกยกเว้น เพราะบนเครื่องจริงรันผ่าน systemd)

> `pm2 restart all --update-env` ยังใช้ตรงๆ ได้ (`-a` ก็ได้) — flag นี้ไม่ได้ list ใน
> `pm2 restart --help` แต่มีใน `pm2 --help` ทดสอบกับ pm2 7.0.3 แล้วใช้ได้จริง

**ทำไม `pm2 restart all` ถึงปลอดภัยกว่า** — มัน **ไม่อ่านไฟล์ ecosystem เลย** restart เฉพาะสิ่งที่อยู่ในลิสต์ตอนนั้น
จึงไม่มีทาง start ชุด app ผิดเครื่อง (กับดัก GOTCHAS #119 เกิดไม่ได้)

**ข้อจำกัดที่ต้องรู้:**
- ไม่อ่าน `interpreter` / `cwd` / `script` ใหม่ — สามตัวนี้ `--update-env` ก็ไม่พอ ต้อง `delete` + `start` (ดูด้านล่าง)
- process ที่หายไปแล้ว **ไม่กลับมา** และไม่มีอะไรเตือน → ต้อง `pm2 list` เทียบจำนวนเอง
- บน central มันหยุดพร้อมกันทั้ง 8 ตัว ระบบดับสั้นๆ ถ้าอยากกระทบน้อยให้ restart ทีละตัว

Tunnel (`cloudflared`) ทำงานผ่าน **systemd** ทั้ง 3 เครื่อง (`active`/`enabled`) — ไม่ต้องเปิดเอง และ **ไม่อยู่ใน PM2**

---

## 🔴 กับดัก ecosystem — อ่านก่อนใช้ `pm2 delete`

**ทั้ง 3 เครื่องมีไฟล์ ecosystem ครบ 2 ไฟล์** และมี app ชื่อซ้ำกัน 3 ตัว (`hikvision` / `dahua` / `lpr-receiver`)
บน edge การรัน `pm2 delete all && pm2 start ecosystem.config.js` จึง**ดูเหมือนแค่ restart** ทั้งที่จริง:
ลบ `nanomq`/`edge-config-agent`/`edge-bridge` ทิ้งถาวร แล้ว start ชุด central ที่ crash-loop ทันที
(edge ไม่มี Postgres/broker ของตัวเอง) — เกิดขึ้นจริงแล้ว 2026-07-24 ทั้ง 2 site, **GOTCHAS #119**

```bash
# ถ้าจำเป็นต้อง delete จริงๆ (เปลี่ยน interpreter / cwd / เพิ่ม-ลด app)
# ── central ──
cd ~/vigil-platform && pm2 delete all && pm2 start ecosystem.config.js && pm2 save

# ── edge (HDY / VSS) ── ไฟล์คนละตัว + ต้องลบ cloudflared ออกจาก PM2
cd ~/vigil-platform && pm2 delete all && pm2 start ecosystem.edge.config.js
pm2 delete cloudflared      # อยู่ใน apps array แต่บนเครื่องจริงรันผ่าน systemd
pm2 save                    # ← ลืมข้อนี้ = reboot แล้วได้ชุดเก่ากลับมา
```

`cloudflared` ต้องลบเพราะถ้าปล่อยให้ PM2 start ด้วยจะได้ tunnel connector 2 ตัว = split-brain

---

## 🔄 ลำดับ restart ที่แนะนำ

```bash
# 1. edge ก่อน — edge-bridge มี store-and-forward queue รองรับช่วง central หาย
ssh sshhdy 'cd ~/vigil-platform && ./scripts/pm2-safe-restart.sh'
ssh sshvss 'cd ~/vigil-platform && ./scripts/pm2-safe-restart.sh'

# 2. central ทีหลัง
cd ~/vigil-platform && ./scripts/pm2-safe-restart.sh

# 3. ตรวจจากภายนอก (สคริปต์ตรวจแค่ในเครื่อง)
curl -s -o /dev/null -w "%{http_code}\n" https://dashboard.dojojin.tech/
```

**สิ่งที่จะเจอหลัง restart central:** api-server เสีย ~33 วิอุ่น cache สถิติ LPR
(month 17.5s + week 13.5s + today 1.8s) ทำงานเบื้องหลังไม่บล็อกใคร แต่ 30 วินาทีแรกถ้าเปิดหน้าป้ายทะเบียนจะยังช้า

> ⚠️ **อย่า `pkill` แยกตัว หรือ `node x.js &` เอง** — การ restart มือเปล่าหลายรอบ
> เคยทำให้เหลือ orphan `dahua-cgi.js` ค้าง → event เข้าซ้ำสองเท่า.
> ตัว ingester/recorder มี PID-lock (`src/singleton.js`) กันรันซ้ำอีกชั้น —
> instance ที่ 2 จะ log error แล้ว exit เอง. ดูจำนวน instance ได้ที่การ์ด
> "⚙️ Service Processes" ในหน้า Health Check.

> ⚠️ **อย่า `pkill` แยกตัว หรือ `node x.js &` เอง** — การ restart มือเปล่าหลายรอบ
> เคยทำให้เหลือ orphan `dahua-cgi.js` ค้าง → event เข้าซ้ำสองเท่า. ใช้
> `services.sh` เสมอ. ตัว ingester/recorder มี PID-lock (`src/singleton.js`)
> กันรันซ้ำอีกชั้น — instance ที่ 2 จะ log error แล้ว exit เอง. ดูจำนวน
> instance ได้ที่การ์ด "⚙️ Service Processes" ในหน้า Health Check.

---

## 📋 Service ที่ระบบต้องใช้

### central

| Service | วิธีรัน | Autostart on boot? |
|---------|---------|---------------------|
| PostgreSQL 16 | Docker (`docker compose`) | ✓ ผ่าน Docker daemon |
| EMQX 5.8 (MQTT broker) | Docker (`docker compose`) | ✓ ผ่าน Docker daemon |
| API Server (Express + WS) | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| MQTT Subscriber | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| Media Recorder | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| Hikvision / Dahua Ingester | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| Report / Alert Worker | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| Face Embed Worker | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup — ระบายคิว `face_embed_queue` ลง `face_embeddings` · **ไม่อยู่ในรายการ 8 service ของหน้า Health Check** จึงไม่มีปุ่ม restart บนหน้าจอ ต้องใช้ `pm2 restart face-embed-worker` |
| LPR Receiver | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| Cloudflared Tunnel | **systemd** (`systemctl status cloudflared`) | ✓ enabled |

> `docker` บน central ต้อง `sudo` — user `vigil-central` ไม่ได้อยู่ใน group `docker`
> (`docker ps` เปล่าๆ จะได้ `permission denied ... /var/run/docker.sock`)

### edge (HDY / VSS)

| Service | วิธีรัน | หมายเหตุ |
|---------|---------|---------|
| NanoMQ (broker ในไซต์) | PM2 (`ecosystem.edge.config.js`) | |
| Hikvision / Dahua Ingester | PM2 (`ecosystem.edge.config.js`) | ชื่อซ้ำกับ central — ระวังสลับไฟล์ |
| LPR Receiver | PM2 (`ecosystem.edge.config.js`) | รับ push จากกล้อง ANPR ในไซต์ |
| Edge Config Agent | PM2 (`ecosystem.edge.config.js`) | ดึง config + credential จาก central |
| Edge Bridge | PM2 (`ecosystem.edge.config.js`) | store-and-forward → central |
| Cloudflared Tunnel | **systemd** | ⚠️ อยู่ใน apps array ด้วย — ห้ามให้ PM2 start |

**edge ไม่มี Postgres และไม่มี EMQX ของตัวเอง** — นี่คือเหตุผลที่ชุด app ของ central ไป crash-loop ทันทีเมื่อสตาร์ตผิดเครื่อง

---

## 🟢 Daily Workflow

### เปิดทุกอย่าง

```bash
cd ~/vigil-platform
pm2 start ecosystem.config.js   # ครั้งแรก
# หรือ
./scripts/services.sh start
```

**ตรวจสถานะ:**

```bash
pm2 list
# ควรเห็น api-server / mqtt-subscriber / media-recorder / hikvision / dahua = online
```

### หยุดทุกอย่าง

```bash
./scripts/services.sh stop   # หรือ pm2 stop ecosystem.config.js
```

### เปิดเว็บ

```
http://localhost:3000          # local
https://dashboard.dojojin.tech # production (ผ่าน tunnel)
```

---

---

### git hook (ครั้งเดียวต่อ clone — ตั้งแต่ 2026-09-07)

```bash
npm run hooks:install     # = git config core.hooksPath scripts/hooks
```

หลังจากนี้ `git commit` จะ (1) สแกน secret ในไฟล์ที่ stage (SEC-012) และ (2) ถ้ามีการแตะ
`src/routes/*.js` / `src/api-server.js` / `src/stats-summary-route.js` / `docs/REF_api-reference.md`
จะรัน `scripts/check-api-reference.js` — ถ้าจำนวน route หรือภาคผนวก A ไม่ตรงกับโค้ด commit จะถูกปฏิเสธ
(แก้ด้วย `npm run check:api -- --list` แล้วอัปเดตเอกสาร) · เหตุผล: ระหว่าง 12 ส.ค.–6 ก.ย. เอกสารตกไป 51 route
เพราะไม่มีอะไรบังคับรัน · ข้าม hook ด้วย `--no-verify` เฉพาะเมื่อเจ้าของอนุมัติ

## 🔍 Health Check

### 1. ตรวจ Docker services

```bash
docker compose ps
# คาดหวัง: vigil-postgres + vigil-emqx สถานะ "Up" ทั้งคู่
```

ถ้าไม่ขึ้น:
```bash
cd ~/vigil-platform
docker compose up -d
```

### 2. ตรวจ Node services (api + subscriber)

```bash
pm2 list
# ควรเห็น api-server / mqtt-subscriber / media-recorder = online, memory > 0
```

### 3. ตรวจ Cloudflare Tunnel

```bash
# Local check
curl -sI http://localhost:3000 | head -3

# Public check (ผ่าน tunnel)
curl -sI https://dashboard.dojojin.tech | head -3
# คาดหวัง: HTTP/2 200 + server: cloudflare
```

### 4. ดู tunnel process

```bash
ps aux | grep cloudflared | grep -v grep
```

ปกติควรเห็น **1 instance** (root) เท่านั้น — ถ้ามีหลายตัว = ซ้ำซ้อน, kill ตัวที่เป็น user ทิ้ง

---

## 🛠️ Troubleshooting

### Port 3000 ถูกใช้ไปแล้ว

```bash
lsof -ti :3000 | xargs kill -9
```

### กล้อง "Online" แต่ไม่มี Events (GOTCHAS #81)

อาการ: dashboard แสดงกล้อง Online แต่ไม่มี events เข้าเลย — เกิดจาก EMQX bind แค่ localhost ไม่ bind LAN IP

```bash
# ตรวจว่า EMQX bind LAN IP ด้วยหรือเปล่า (ต้องเห็น 192.168.x.x:1883)
docker port vigil-emqx

# ตรวจ camera client connections (ถ้าว่าง = camera connect ไม่ได้)
docker exec vigil-emqx emqx ctl clients list | grep cam-bosch

# แก้: force recreate ให้ docker apply port binding ใหม่
docker compose up -d --force-recreate emqx
```

> หมายเหตุ: `last_seen_at` อัปเดตจาก ONVIF poll (คนละ path กับ MQTT) → กล้องแสดง Online ได้แม้ MQTT พัง
> ถ้า "Online + ไม่มี events" → ตรวจ EMQX binding เสมอ

### MQTT subscriber ไม่ได้รับ event

```bash
# ตรวจ EMQX
docker logs vigil-emqx --tail 30

# ดู client connections (camera + subscriber)
docker exec vigil-emqx emqx ctl clients list

# ดู topic subscriptions
docker exec vigil-emqx emqx ctl subscriptions list
```

### ~~Snapshot / clip / กล้องเข้าไม่ถึงหลัง restart PM2~~ — **LEGACY (MacBook เท่านั้น)**

> ⛔ **ไม่ใช้แล้วบน central** — ตั้งแต่ย้ายมา Linux (2026-07-23) ไม่มี macOS Local Network Privacy
> จึงไม่มีอาการนี้ และ **ไม่ต้อง** restart ผ่าน Terminal.app อีกต่อไป — ใช้ `pm2 restart all` ตามปกติ
> สคริปต์เดิมเก็บไว้ที่ `scripts/pm2-lan-safe-restart-mac.command` (เติม `-mac` 2026-07-27 กันหยิบผิดเครื่อง)
> เนื้อหาด้านล่างเก็บไว้เผื่อกลับไปใช้ MacBook

อาการ: `EHOSTUNREACH` / `No route to host` ไปยัง camera subnet จากบาง process
(ffmpeg ใน media-recorder, node ตัวที่ไม่มี LNP record) ทั้งที่ `curl`/`nc` จากมือถึงปกติ —
media-buffer ว่าง, clip ไม่ถูกบันทึก

สาเหตุ: macOS Local Network Privacy — PM2 daemon ที่ถูก start จาก launchd / tmux / ssh /
Claude shell ไม่มี Local Network grant → ลูกทุกตัวที่ binary ไม่มี record ของตัวเองโดนปัดเงียบ

```bash
# แก้ — restart PM2 ใต้ VigilPM2.app (ถือ Local Network grant) — รันจาก shell ไหนก็ได้:
open scripts/VigilPM2.app              # เงียบ ไม่มีหน้าต่าง · log: /tmp/vigilpm2.log

# fallback ถ้า app ใช้ไม่ได้ (เช่นหลัง macOS update):
open -a Terminal scripts/pm2-lan-safe-restart-mac.command

# ตรวจ (รอ ~30 วิ):
find media-buffer -name "*.ts" -mmin -1 | wc -l   # > 0 = recorder กลับมาแล้ว
```

> ⚠️ **ห้าม `pm2 kill && pm2 resurrect` จาก tmux / ssh / Claude Code shell ตรงๆ** — จะเสีย
> Local Network grant เงียบๆ. boot อัตโนมัติผ่าน `pm2.dojojin.plist` → VigilPM2.app แล้ว.
> ดู GOTCHAS #84. Linux production ไม่มีปัญหานี้

### DB connection refused

```bash
docker logs vigil-postgres --tail 20
# ถ้า container down → docker compose up -d
```

### Tunnel ขึ้น 502 / ไม่เข้าถึงจาก domain

```bash
# วิธี 1: restart root service (modern API — macOS Ventura+)
sudo launchctl bootout system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo launchctl list | grep cloudflared   # ตรวจ: PID มีค่า = running

# วิธี 2: kickstart (ยังใช้ได้ถ้า service ยังอยู่ใน session)
sudo launchctl kickstart -k system/com.cloudflare.cloudflared

```

> **plist fix (2026-06-03):** เพิ่ม `NetworkState: true` ใน `KeepAlive` แล้ว —
> cloudflared จะรอ network พร้อมก่อน start หลัง reboot โดยอัตโนมัติ

### หน้าเว็บโหลดช้า — หา query / request ที่ช้าใน 5 นาที (ตั้งค่า 2026-09-05)

Postgres เปิด `log_min_duration_statement = 2s` ถาวรผ่าน `ALTER SYSTEM`
(อยู่ใน `postgresql.auto.conf` บน volume — รอด container restart) และ api-server
พิมพ์ `[slow-req]` ทุก request ที่นานเกิน 2 s (`SLOW_REQ_LOG_MS` ปรับได้)

```bash
# SQL ที่ช้ากว่า 2 s ใน 1 ชม.ล่าสุด (มี user@db + application_name นำหน้า)
docker logs vigil-postgres --since 1h 2>&1 | grep "duration:" | sort -t: -k4 -rn | head

# request ที่ช้ากว่า 2 s ฝั่ง api-server
grep "\[slow-req\]" ~/.pm2/logs/api-server-error.log | tail -20

# GET ที่ผู้ใช้ทิ้งก่อนได้คำตอบ แล้วถูกยกเลิกคิวรีที่ DB (GOTCHAS #234) — route ที่โผล่บ่อย = route ที่ช้าจนคนไม่รอ
# บรรทัดของ route ตรง = "GET /api/x" · ของที่ผ่าน cache = "shared:<ชื่อ cache>" (ช่องที่ 4)
grep "\[req-cancel\]" ~/.pm2/logs/api-server-out.log | awk '{print ($4=="GET" ? $5 : $4)}' | sort | uniq -c | sort -rn | head

# ภาพรวมสะสมตั้งแต่ restart (pg_stat_statements — reset เมื่อ container restart)
docker exec vigil-postgres psql -U vigil_sql -d vigil_platform -c \
  "select round(mean_exec_time) ms, calls, left(query,90) q from pg_stat_statements
    where calls>=3 order by mean_exec_time desc limit 15"
```

ปิดชั่วคราว: `ALTER SYSTEM SET log_min_duration_statement = -1; SELECT pg_reload_conf();`

⚠️ **ถ้าคำสั่ง `docker logs ... grep duration` ว่างทั้งที่มีคำขอช้า** = ไฟล์ log ของ container เสีย ไม่ใช่ "ไม่มี query ช้า"
(เกิดจริง: เครื่องรีบูต 22 ก.ย. 2569 แล้วไฟล์มี `\x00` ปน `docker logs` อ่านไม่ได้หลัง 12 ก.ย. เงียบ ๆ เดือนกว่า · GOTCHAS #231)
ยืนยัน: `journalctl -u docker | grep "Error decoding log file"` · ซ่อมแบบไม่ต้อง restart DB:
`sudo truncate -s 0 "$(docker inspect vigil-postgres --format '{{.LogPath}}')"` (ล้าง log เก่าทิ้ง ของใหม่เขียนต่อได้ทันที) ·
perfWatch ร้อง LINE ให้เองถ้า log เงียบเกิน 6 ชม. (`pg_log_lines_6h`)

### Concurrently ดับไม่หมด (มี zombie process)

```bash
killall node 2>/dev/null
lsof -ti :3000 | xargs kill -9 2>/dev/null
```

---

## 🎛️ env var ปรับจูน (ตรวจค่า default จากโค้ดจริง 2026-09-06)

ทุกตัวมี default ในโค้ดอยู่แล้ว — **ไม่ต้องใส่ใน `.env` ถ้าไม่ได้จะเปลี่ยน** ·
เปลี่ยนแล้วต้อง `pm2 restart` process ที่อ่านค่านั้น (ค่าอ่านตอน require ไม่ใช่ต่อ request)

| ตัวแปร | default | ทำอะไร | เปลี่ยนแล้วเกิดอะไร |
|---|---|---|---|
| `SLOW_REQ_LOG_MS` | `2000` | เกณฑ์ที่ api-server log `[slow-req]` (`src/api-server.js:243`) | ลดลง = เห็น request ช้ามากขึ้นแต่ log รก · เพิ่ม = เงียบขึ้นแต่พลาดของที่เริ่มช้า |
| `DASHBOARD_BUNDLE` | `1` (เปิด) | รวม `page-*.js` 39 ไฟล์เป็น `/dashboard.bundle.js` ก้อนเดียวตอน boot | `0` = เสิร์ฟแยกไฟล์แบบเดิม · ใช้ตอนไล่บั๊ก JS ที่อยากเห็นชื่อไฟล์จริงใน stack trace หรือถ้า bundle มีปัญหา |
| `REPORT_RENDER_VIA_WORKER` | `1` (เปิด) | ปุ่มดาวน์โหลด PDF/PNG ยิงไป report-worker แทนที่จะเปิด Chromium ใน api-server | `0` = กลับไป render ในโปรเซส api-server · api-server จะกิน RAM เพิ่มเป็นร้อย MB ต่อการ render หนึ่งครั้ง |
| `EVENTS_COUNT_CAP` | `10000` | เพดานการนับผลของ `/api/events` (`src/routes/events.js:48`) | เพิ่ม = ตัวเลขจริงขึ้นบ่อยกว่าเดิมแต่ query หนักขึ้นตามสัดส่วน · ชนเพดานเมื่อไหร่หน้าจอขึ้น "10,000+" |
| `REPORT_BROWSER_IDLE_MS` | `300000` (5 นาที) | Chromium ของ report-worker ปิดตัวเองหลังว่างเกินเวลานี้ (`src/report-renderer.js:224`) | ลด = คืน RAM เร็วขึ้นแต่รายงานถัดไปต้องเปิด browser ใหม่ · เพิ่ม = รายงานถี่ ๆ เร็วขึ้นแต่ค้าง RAM ไว้นานกว่า |
| `LPR_WARM_FIRST_RUN_MS` | `180000` (3 นาที) | หน่วงก่อน warm cache สถิติ LPR รอบแรกหลัง boot | ลด = หน้าป้ายทะเบียนพร้อมเร็วขึ้น แต่ไปแย่ง pool ตอน api-server กำลังอุ่น |
| `LPR_WARM_WEEK_EVERY_MS` | `1800000` (30 นาที) | ความถี่ warm ช่วง "สัปดาห์" | เพิ่ม = โหลด DB น้อยลง แต่ตัวเลขเก่ากว่า (TTL ของ cache ขยายตามให้เอง) |
| `LPR_WARM_MONTH_EVERY_MS` | `3600000` (60 นาที) | ความถี่ warm ช่วง "เดือน" | เหมือนข้างบน — ช่วงเดือน query แพงกว่า จึงตั้งห่างกว่า |
| `KPI_STATS_FIRST_RUN_MS` | `45000` | หน่วงก่อน refresh `event_kpi_hourly` รอบแรก (`src/kpi-stats-refresher.js:26`) | ทั้ง 3 ตัวนี้ (45 / 90 / 135 วินาที) คือ **boot stagger** ตั้งใจให้ refresher ไม่ชนกันตอน boot — เปลี่ยนแล้วให้เว้นระยะกันเหมือนเดิม |
| `CAT_ROLLUP_FIRST_RUN_MS` | `90000` | หน่วงก่อน refresh `event_dim_bucket` รอบแรก (`src/category-rollup-refresher.js:30`) | ดูข้างบน |
| `TRAFFIC_STATS_FIRST_RUN_MS` | `135000` | หน่วงก่อน refresh `traffic_hourly_stats` รอบแรก (`src/traffic-stats-refresher.js:26`) | ดูข้างบน |
| `TRAFFIC_STATS_RECONCILE_HOUR` | `5` (05:00) | **ชั่วโมงที่รัน** reconcile รายวันของ traffic stats (`:54`) | ⚠️ **ห้ามย้ายไปชนหน้าต่าง backup 03:04–04:05** — `pg_dump` ถือ snapshot ทั้งก้อน ทำให้งาน DB หนักค้าง (GOTCHAS #191) · **คนละตัวกับ** `TRAFFIC_STATS_RECONCILE_HOURS` (default `168` = ย้อนไปทวนกี่ชั่วโมง ไม่ใช่เวลารัน) |
| `NOREAD_CHECK_INTERVAL_MS` | ไม่ตั้ง = **รายสัปดาห์** (อาทิตย์ 04:30) | **override สำหรับเทสต์เท่านั้น** (`src/helpers/noreadCheck.js:131`) — self-check ว่านิยาม no-read ยังตรงกับ partial index | ตั้งค่า = บังคับให้รันทุก N มิลลิวินาทีและรันทันทีแทนที่จะรอวันอาทิตย์ · **ห้ามตั้งใน production** query กินราว 16 วินาที |

---

## 🧹 Cleanup ครั้งแรก

ถ้าเคยเปิด cloudflared manual ค้างไว้ (เห็น 2 instance ใน `ps aux`):

```bash
# kill instance ของ user เก็บ root service ไว้
ps aux | grep "cloudflared tunnel" | grep -v root | grep -v grep | awk '{print $2}' | xargs kill

# verify เหลือแค่ root instance
ps aux | grep cloudflared | grep -v grep
```

---

## 🗄️ Schema Migrations (ห้าม `down -v` อีกแล้ว)

**ปัญหาเดิม:** `init.sql` ใน `/docker-entrypoint-initdb.d/` รันแค่ **ครั้งเดียว** ตอน volume ว่างใหม่ ๆ — แก้ `init.sql` เพิ่มเติมหลังจากนั้น volume ที่มีอยู่จะไม่รับเลย ต้อง `down -v` (ลบ data) ถึงจะได้ schema ใหม่ → events หายหมด

**ทางแก้ (v1.2.1):** `src/migrate.js` รันอัตโนมัติทุกครั้งที่ `npm run api` เริ่ม — มัน scan `db/db_migration_*.sql` แล้วรันเฉพาะไฟล์ที่ยังไม่ถูก apply (track ใน `schema_migrations` table)

```bash
# Run manually (เช่น ตอน CI หรือ git pull แต่ไม่อยาก restart api)
cd ~/vigil-platform/src && npm run migrate

# Inspect ว่า migration ตัวไหนรันไปแล้ว
docker exec -it vigil-postgres psql -U vigil_sql -d vigil_platform -c "
  SELECT filename, applied_at, duration_ms FROM schema_migrations ORDER BY filename;
"
```

**กฎทอง:**
- 📝 **อย่าแก้ `init.sql` เพื่อเพิ่ม schema ใหม่** — เขียน `db/db_migration_<topic>.sql` แทน (idempotent: `IF NOT EXISTS` / `ON CONFLICT`)
- 🚫 **อย่า `docker compose down -v` เพื่อ apply migration** — runner จัดการให้แล้ว
- ✅ **`init.sql` = canonical schema สำหรับ fresh install** เท่านั้น (รันครั้งเดียวตอน volume ใหม่)
- ⚠️ ถ้า migration fail ตอน api boot → api จะ exit code 1 พร้อม error message → **restore backup ก่อน** แล้วแก้ migration file → retry

---

## 💾 Backup & Restore

### 🔴 Daily auto-backup — **หยุดทำงานตั้งแต่ย้ายมา Linux**

**สถานะจริง 2026-07-27:** dump ตัวล่าสุดคือ `vigil_platform_2026-07-23_030000.dump`
และบรรทัดสุดท้ายใน `backups/backup.log` ชี้ path `/Users/dojojin/...` — แปลว่า
**backup ตัวสุดท้ายรันบน MacBook เครื่องเก่า** ไม่ใช่บน central — ⚠️ **เครื่องนั้นถูกขายไปแล้ว 2026-07-31 ไฟล์ backup ชุดนั้นถือว่าหายถาวร** อย่าไปตามหา ให้ยึด backup ที่รันบน central เท่านั้น

ตัวตั้งเวลาเดิมคือ **launchd ของ macOS** (`scripts/com.dojojin.dashboard.backup.plist`)
ซึ่ง **Linux ไม่รู้จัก** — ตรวจแล้วบน central ไม่มีทั้ง `crontab`, `/etc/cron.d/*`
และ `systemd timer` ของ vigil เลย → **ไม่มีอะไร backup ฐานข้อมูลอยู่**

ตรวจสถานะเองได้ตลอด:
```bash
ls -t ~/vigil-platform/backups/*.dump | head -3
tail -3 ~/vigil-platform/backups/backup.log
```

### ▶️ ติดตั้งครั้งแรก — รันคำสั่งนี้คำสั่งเดียว

```bash
cd ~/vigil-platform
sudo ./scripts/install-backup-timer.sh --with-rclone --test
```

ทำให้ครบในรอบเดียว: เขียน unit → `enable --now` → ลง rclone → สั่ง backup ทดสอบ → **verify**
ถ้าจบด้วย `✗` แม้แต่ข้อเดียว = ยังไม่เรียบร้อย (สคริปต์คืน exit code 1)

### option ทั้งหมด

| คำสั่ง | ใช้เมื่อไหร่ | sudo |
|---|---|---|
| `sudo ./scripts/install-backup-timer.sh --with-rclone --test` | **ติดตั้งครั้งแรก** ← ใช้อันนี้ | ✔ |
| `sudo ./scripts/install-backup-timer.sh` | ติดตั้ง/ซ่อม unit เฉยๆ (มี rclone แล้ว, ไม่อยากรันทดสอบ) | ✔ |
| `sudo ./scripts/install-backup-timer.sh --test` | ติดตั้ง + สั่ง backup ทันที ไม่ต้องรอ 03:00 | ✔ |
| `sudo ./scripts/install-backup-timer.sh --with-rclone` | ติดตั้ง + ลง rclone จาก apt (คืน offsite) | ✔ |
| `./scripts/install-backup-timer.sh --check` | **ตรวจสถานะอย่างเดียว ไม่แตะระบบ** | ✘ |

รันซ้ำได้เสมอ (idempotent) — เขียนทับ unit เดิมด้วยเนื้อหาเดียวกันแล้ว verify ใหม่

### ใช้งานประจำวัน

```bash
./scripts/install-backup-timer.sh --check     # ตรวจว่ายัง backup อยู่ไหม (ไม่ต้อง sudo)
systemctl list-timers | grep vigil            # รอบถัดไปเมื่อไหร่
sudo systemctl start vigil-backup.service     # สั่ง backup เดี๋ยวนี้
journalctl -u vigil-backup -n 50 --no-pager   # ดู log การรัน
tail -5 backups/backup.log                    # log ของ backup.sh เอง
```

> **ทำไมต้องใช้สคริปต์** — วางแบบ heredoc ทีละบล็อกแล้วพลาดกลางทาง จะได้ unit ที่
> *ดูเหมือนติดตั้งแล้วแต่ไม่เคยยิง* ซึ่งคือความล้มเหลวเงียบแบบเดียวกับที่ทำให้
> backup หายไป 4 วัน สคริปต์จบด้วยการ verify เสมอ จึงบอกได้ว่าสำเร็จจริงหรือไม่

สิ่งที่สคริปต์ใส่ให้เกินจากคำสั่งพื้นฐาน:
| | ทำไม |
|---|---|
| `After=docker.service` | reboot แล้ว timer ยิงก่อน Docker พร้อม → `docker ps` ไม่เจอ container → fail เงียบ |
| `TimeoutStartSec=3600` | pg_dump ของ DB 12 GB ใช้เวลาหลายนาที ค่า default จะฆ่างานทิ้ง |
| `Persistent=true` | เครื่องดับตอนตี 3 → รันชดเชยตอนเปิด (launchd เดิมมีพฤติกรรมนี้) |
| `Nice/IOSchedulingClass=idle` | ไม่ให้ pg_dump แย่ง I/O กับ ingest ที่วิ่ง 5.6 event/วิ |
`scripts/backup.sh` เองใช้ได้ปกติบน Linux (เป็น bash + `docker exec`) — ที่ขาดคือตัวตั้งเวลาเท่านั้น
รันมือได้ทันทีด้วย `./scripts/backup.sh`

> `scripts/com.dojojin.dashboard.backup.plist` เก็บไว้เผื่อกลับไปใช้ MacBook — บน Linux ใช้ไม่ได้

ดู log:
```bash
tail -f ~/vigil-platform/backups/backup.log
```

**Offsite (A4, 2026-06-10):** `backup.sh` ส่ง dump + config bundle ขึ้น Google Drive
อัตโนมัติผ่าน rclone crypt remote `gdrive-crypt` (เข้ารหัสฝั่ง client, retention 30 วัน):
```bash
rclone ls gdrive-crypt:          # ดูไฟล์บน Drive (ผ่าน crypt)
rclone copy gdrive-crypt:dumps/<file> ./   # ดึง dump กลับมา restore
```
> ⚠️ restore บนเครื่องใหม่ต้องมี CRYPT_PASSWORD + CRYPT_SALT (อยู่ใน password manager
> ของ owner) ตั้ง remote ใหม่: `rclone config create gdrive drive scope=drive.file`
> แล้ว `rclone config create gdrive-crypt crypt remote=gdrive:vigil-backups password=... password2=...`

### Manual backup

```bash
cd ~/vigil-platform
./scripts/backup.sh              # → backups/vigil_platform_<ts>.dump (custom format, gzip-6)
# หรือ
cd src && npm run backup
```

ตั้งค่า env (optional):
- `BACKUP_DIR` (default: `./backups`)
- `RETAIN_DAYS` (default: 14 — file เก่ากว่า 14 วันโดน prune อัตโนมัติ)

### Restore

```bash
cd ~/vigil-platform
./scripts/restore.sh                                          # interactive — list 10 ตัวล่าสุด
./scripts/restore.sh backups/vigil_platform_2026-05-09_030000.dump  # direct
```

⚠️ Destructive — drops + recreates ทุก object ใน `vigil_platform` (ใช้ `pg_restore --clean --if-exists`).
ก่อน restore ควรหยุด api / subscriber / media-recorder (ตัด concurrent writes ออก):

```bash
./scripts/services.sh stop
./scripts/restore.sh <file>
./scripts/services.sh start
```

### Off-host backup (production)

Daily local dump เก็บได้ 14 วัน — สำหรับ production แนะนำเพิ่ม off-host copy เช่น
- `rsync` ไป NAS ภายในออฟฟิศ
- `rclone` ไป Cloudflare R2 / Backblaze B2 (~$0.005/GB/mo)

ดูแผนเพิ่มเติมที่ `HARDWARE_SIZING_GUIDE.md` → backup section

---

## 🔄 Reset ทั้งระบบ (Nuclear Option — เกือบจะไม่ต้องใช้แล้ว)

> 💡 **ตั้งแต่ v1.2.1 เป็นต้นไป — แทบไม่จำเป็น** ใช้ migration runner + backup/restore แทน
>
> ใช้ตอน: dev ต้องการ wipe ทุกอย่างจริง ๆ, หรือ volume corrupt จน restore กลับไม่ได้

```bash
# ⚠️ Backup ก่อนเสมอ (ถ้ายัง mount ได้)
./scripts/backup.sh

# หยุด PM2 workers
./scripts/services.sh stop

# reset DB + MQTT (ลบ data!)
cd ~/vigil-platform
docker compose down -v
docker compose up -d
# ไม่ต้องรัน init.sql เอง — postgres entrypoint จะ run ให้ตอน volume ใหม่

# start ใหม่ (api boot → migrate runner ทำงานต่อให้ schema ครบ)
./scripts/services.sh start

# ถ้ามี backup ก่อนหน้า → restore data กลับ
cd ~/vigil-platform && ./scripts/restore.sh backups/<file>.dump
```

---

## 📦 npm Scripts ทั้งหมด

| Command | ใช้ทำอะไร |
|---------|----------|
| `npm run api` | รัน API server (auto-migrate ก่อน listen) |
| `npm run subscriber` | รัน MQTT subscriber เท่านั้น |
| `npm run media-recorder` | รัน RTSP rolling buffer เท่านั้น |
| `npm run simulator` | รัน synthetic event generator (dev/test) |
| `npm run migrate` | รัน schema migrations เฉย ๆ (ไม่ start api) |
| `npm run backup` | สร้าง pg_dump backup → `backups/*.dump` |
| `npm run restore <file>` | Restore จาก dump (interactive confirm) |
| `./scripts/services.sh start` | start all workers ผ่าน PM2 (แนะนำ) |
| `pm2 start ecosystem.config.js` | เหมือนกัน — PM2 โดยตรง |

---

## 🔐 Camera Credential Encryption (SEC-014)

### Fresh Install (ลูกค้าใหม่)

```bash
# 1. Generate key (ทำ 1 ครั้ง ต่อ deployment)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. เพิ่มใน src/.env
CAMERA_SECRET_KEY=<ค่าที่ได้>

# ⚠️ บันทึก key ใน password manager ทันที — ถ้าหาย credentials กู้ไม่ได้

# 3. กรอก cameras-config.json ตามปกติ (plaintext)

# 4. Encrypt credentials
node scripts/migrate-creds-encrypt.js

# 5. เริ่ม services ปกติ
cd ~/vigil-platform && ./scripts/services.sh start
```

### Upgrade Site เดิม (มี cameras-config.json แล้ว)

```bash
# 1. Backup ก่อน
cp cameras-config.json cameras-config.json.bak

# 2. git pull

# 3. Generate key + ใส่ src/.env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# เพิ่ม CAMERA_SECRET_KEY=<ค่าที่ได้> ใน src/.env

# ⚠️  หยุด services ก่อน — ต้องทำก่อนรัน migration เสมอ
#     (GOTCHAS #72: old code อ่าน ciphertext เป็น password → auth fail → กล้อง offline)
./scripts/services.sh stop

# 4. Encrypt credentials เดิม (idempotent — รันซ้ำได้ปลอดภัย)
node scripts/migrate-creds-encrypt.js

# 5. Restart services ด้วย new code
./scripts/services.sh start

# 6. ตรวจว่ากล้อง ingest ได้ปกติ (ดู log หรือ Health Check)
```

### Dry-run (ดูก่อนว่าจะ encrypt อะไรบ้าง)

```bash
node scripts/migrate-creds-encrypt.js --dry-run
```

### Rollback (ถ้ามีปัญหา)

```bash
# โค้ดใหม่ tolerant plaintext — restore backup แล้วทำงานได้ทันที ไม่ต้อง restart
cp cameras-config.json.bak cameras-config.json
```

### ตรวจสอบว่า encrypt แล้ว

```bash
# ค่า password และ mqtt_password ต้องขึ้นต้นด้วย "enc:v1:"
node -e "console.log(JSON.parse(require('fs').readFileSync('cameras-config.json')).cameras.map(c=>({id:c.camera_id,pw:c.password?.slice(0,12),mpw:c.mqtt_password?.slice(0,12)})))"
```

---

<sub>End of service_start.md · Vigil Platform · Owner: Prakasit Rochanavipart</sub>
