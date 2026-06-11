# Service Start Manual — Vigil Platform

> วิธีเปิด/ปิด/ตรวจสอบ service ของ Dashboard ในเครื่อง dev (M1 MacBook Pro)
> Last updated: 2026-06-08

---

## 🎯 TL;DR

```bash
# 🟢 แนะนำ — PM2 ผ่าน services.sh (thin wrapper)
cd ~/vigil-platform
./scripts/services.sh start      # pm2 start ecosystem.config.js
./scripts/services.sh stop       # pm2 stop ecosystem.config.js
./scripts/services.sh restart    # pm2 restart ecosystem.config.js
./scripts/services.sh status     # pm2 status

# หรือ PM2 โดยตรง
pm2 start ecosystem.config.js
pm2 list
```

Tunnel (`cloudflared`) มี **root service install** ทำงาน autostart อยู่แล้ว — ไม่ต้องเปิดเอง

> ⚠️ **อย่า `pkill` แยกตัว หรือ `node x.js &` เอง** — การ restart มือเปล่าหลายรอบ
> เคยทำให้เหลือ orphan `dahua-cgi.js` ค้าง → event เข้าซ้ำสองเท่า. ใช้
> `services.sh` เสมอ. ตัว ingester/recorder มี PID-lock (`src/singleton.js`)
> กันรันซ้ำอีกชั้น — instance ที่ 2 จะ log error แล้ว exit เอง. ดูจำนวน
> instance ได้ที่การ์ด "⚙️ Service Processes" ในหน้า Health Check.

---

## 📋 Service ที่ระบบต้องใช้

| Service | วิธีรัน | Autostart on boot? |
|---------|---------|---------------------|
| PostgreSQL 16 | Docker (`docker compose`) | ✓ ผ่าน Docker Desktop |
| EMQX 5.8 (MQTT broker) | Docker (`docker compose`) | ✓ ผ่าน Docker Desktop |
| API Server (Express + WS) | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| MQTT Subscriber | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| Media Recorder | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| Hikvision Ingester | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| Dahua Ingester | PM2 (`ecosystem.config.js`) | ✓ ผ่าน PM2 startup |
| Cloudflared Tunnel | `cloudflared service install` (root) | ✓ ผ่าน macOS launchd |

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

### Snapshot / clip / กล้องบางตัวเข้าไม่ถึงหลัง reboot หรือหลัง restart PM2 (macOS เท่านั้น — GOTCHAS #84)

อาการ: `EHOSTUNREACH` / `No route to host` ไปยัง camera subnet จากบาง process
(ffmpeg ใน media-recorder, node ตัวที่ไม่มี LNP record) ทั้งที่ `curl`/`nc` จากมือถึงปกติ —
media-buffer ว่าง, clip ไม่ถูกบันทึก

สาเหตุ: macOS Local Network Privacy — PM2 daemon ที่ถูก start จาก launchd / tmux / ssh /
Claude shell ไม่มี Local Network grant → ลูกทุกตัวที่ binary ไม่มี record ของตัวเองโดนปัดเงียบ

```bash
# แก้ — restart PM2 ใต้ VigilPM2.app (ถือ Local Network grant) — รันจาก shell ไหนก็ได้:
open scripts/VigilPM2.app              # เงียบ ไม่มีหน้าต่าง · log: /tmp/vigilpm2.log

# fallback ถ้า app ใช้ไม่ได้ (เช่นหลัง macOS update):
open -a Terminal scripts/pm2-lan-safe-restart.command

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

### Concurrently ดับไม่หมด (มี zombie process)

```bash
killall node 2>/dev/null
lsof -ti :3000 | xargs kill -9 2>/dev/null
```

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

### Daily auto-backup (launchd, 03:00 ทุกวัน)

ติดตั้งครั้งเดียว:
```bash
cp scripts/com.dojojin.dashboard.backup.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.dojojin.dashboard.backup.plist

# verify
launchctl list | grep com.dojojin.dashboard.backup
```

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
