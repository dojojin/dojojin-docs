# แผนย้าย Vigil Platform: MacBook → vigilcentral

> สถานะ: **PLAN ONLY — ยังไม่ execute** (รอ green light ตาม CLAUDE.md Working
> Agreement #4). เขียนไว้ให้เดินตามได้แบบ runbook ตอน cutover จริง (มีขั้นที่
> ต้อง sudo บนเครื่อง vigilcentral — เป็นมือเจ้าของ ไม่ใช่ Claude).
>
> ปลายทาง: ย้าย stack ทั้งหมด (Docker/Postgres/EMQX, PM2 apps ทั้ง 9 ตัว,
> Cloudflare Tunnel `vigil-platform` ทั้ง 4 routes) จาก MacBook ไปเครื่อง
> `vigilcentral` (ssh `vigil-central@vigilcentral.local`, LAN เดียวกัน
> `192.168.31.x`, ~3ms latency). Data ต้องอยู่ครบ. Downtime งบ ≤ 1 ชม.

## Fact อ้างอิง (ยืนยันแล้วจากเครื่องจริง)

- Tunnel `vigil-platform` (เดิมชื่อ `bosch-cctv-mac`, id
  `648a1cd5-b030-4fec-ab24-090272f2aa6d`) เป็น **token-based** — routing
  config อยู่ฝั่ง Cloudflare control plane ไม่ใช่ local `config.yml`. ตอนนี้
  active replica = 1 ตัว (`Dojo-mAns-MacBook-Pro.local`). Dashboard รองรับ
  หลาย replica พร้อมกัน (ปุ่ม "Add a replica") → HA load-balance ข้าม
  connector ถ้าเปิดสองตัวพร้อมกัน (ดู "ข้อควรระวัง" ด้านล่าง).
- 4 published routes บน tunnel นี้ — **ยืนยันจาก Cloudflare "Published
  application routes" tab แล้ว (Phase 0, ไม่ใช่ infer อีกต่อไป):**
  | # | Hostname | Path | Service |
  |---|---|---|---|
  | 1 | `ssh-mac.dojojin.tech` | `*` | `ssh://localhost:22` |
  | 2 | `dashboard.dojojin.tech` | `^/(lpr$\|face-push/)` | `http://localhost:3003` |
  | 3 | `dashboard.dojojin.tech` | `/mqtt` | `http://localhost:8083` |
  | 4 | `dashboard.dojojin.tech` | `*` (catch-all) | `http://localhost:3000` |

  **แก้ inference เดิม:** route #2 (lpr/face-push) ชี้ไปพอร์ต **3003 ไม่ใช่
  3000** — ตรงกับ PM2 process `lpr-receiver` (เป็นโปรเซสแยกจาก
  `api-server`, ตามที่ memory IM7 บันทึกไว้). เพราะ `lpr-receiver` เป็นหนึ่ง
  ใน 9 PM2 apps ที่จะย้ายอยู่แล้ว → ไม่ต้องทำอะไรเพิ่ม แค่ให้แน่ใจว่า
  service ยัง bind พอร์ต 3003 บน vigilcentral เหมือนเดิม. Catch-all-route
  (#4, `*` → `:3000`) ครอบคลุมทั้ง Overview/Dashboard ปกติ — คนละ path จาก
  #2 ที่เจาะจงเฉพาะ `/lpr` กับ `/face-push/` เท่านั้น.
- PM2: 9 apps (`pm2-logrotate`, `api-server`, `mqtt-subscriber`,
  `media-recorder`, `hikvision`, `dahua`, `report-worker`, `alert-worker`,
  `lpr-receiver`), interpreter pinned
  `/opt/homebrew/opt/node@24/bin/node` (Mac-only path, arm64).
- Docker Compose: `postgres:16-alpine` (`shm_size: 1gb`, volume
  `vigil_postgres_data` = **9.06 GB**), `emqx/emqx:5.8.9` (volumes
  `vigil_emqx_data` = 1.23 MB, `vigil_emqx_log` = 0 B).
- EMQX auth **ผูกกับแอป**: `src/site-provision.js` เรียก EMQX Management
  API (`localhost:18083/api/v5`) ตอน provision site ใหม่ เพื่อสร้าง
  `edge-<code>` user (bcrypt) + authz rule ผ่าน `built_in_database` source —
  ข้อมูลนี้ **persist อยู่ใน volume `vigil_emqx_data`** ไม่ใช่ provision
  ใหม่ทุก boot. **password เป็น one-time reveal ตอน provision เท่านั้น
  (genPassword() สุ่มแล้วโชว์ครั้งเดียว ไม่ได้เก็บ plaintext ไว้ที่ไหนอีก)**
  → ถ้า volume หายหรือ copy ไม่สำเร็จ **กู้ password เดิมคืนไม่ได้เลย**
  ต้อง re-provision ทุกไซต์ + แจก password ใหม่ให้ edge ทุกตัวไปตั้งค่าใหม่
  (ของงานใหญ่ ไม่อยากทำถ้าไม่จำเป็น) → **ต้อง copy volume ให้สำเร็จ** เป็น
  priority สูงใน cutover.
- `MQTT_CAMERA_BROKER_HOST=192.168.10.31` ไม่ตรงกับ IP เครื่องไหนเลย
  (Mac ปัจจุบัน `192.168.31.193` / `198.19.254.2`, vigilcentral
  `192.168.31.251`). **Phase 0 ตรวจเพิ่ม:** ไม่มี ARP entry, ไม่มี route,
  ping timeout 100% จาก Mac ตอนนี้ — แปลว่า subnet `192.168.10.x` **ไม่ได้
  ต่ออยู่กับเครื่องนี้เลย** ปัจจุบัน (คนละ VLAN/switch ที่ไม่ได้เสียบอยู่
  ตอนนี้ หรือเป็นค่าเก่าที่เลิกใช้แล้ว). `src/site-provision.js` ยืนยันว่า
  edge ใหม่ๆ ทุกไซต์ตั้ง `brokerUrl` default เป็น
  `wss://dashboard.dojojin.tech/mqtt` (ผ่าน tunnel) อยู่แล้ว ไม่ใช้ IP ตรง
  — แต่ **ยืนยันไม่ได้ 100% จากโค้ด/เครื่องนี้ว่ามีกล้อง Bosch local ตัวไหน
  ที่ตั้งค่า MQTT publish ไปที่ `192.168.10.31:1883` ตรงๆ อยู่หรือเปล่า**
  (ค่านี้เป็นแค่ค่าที่ frontend เอาไปโชว์ตอน setup กล้องใหม่ — ไม่ได้บอกว่า
  กล้องเก่าตั้งไว้ยังไง) → **ต้องถามเจ้าของ** ว่ามีกล้อง Bosch ตัวไหนอยู่ใน
  network segment นี้จริงไหม ก่อนสรุปว่าข้ามได้เลยไม่ต้อง repoint.
- vigilcentral: มี Node v22.23.1 ผ่าน NVM (แต่ไม่อยู่บน default PATH ของ
  non-login shell), **ไม่มี** Docker, ไม่มี PM2, `sudo` ต้องใส่ password
  (ไม่มี passwordless), GitHub SSH host-key verification **fail**
  (`git clone` จะไม่ผ่านจนกว่าจะแก้).
- Network: same-LAN, ping avg ~3.3ms, scp 10MB test file ใช้ 0.432 วินาที
  (เร็วพอสำหรับ 9GB dump ภายในงบ 1 ชม. อย่างมีระยะปลอดภัยเยอะ).
- `.env` มี key: `EMQX_DASHBOARD_PASSWORD`, `MQTT_CAMERA_BROKER_HOST`,
  `MQTT_SUBSCRIBER_PASSWORD`, `MQTT_SUBSCRIBER_USER`, `POSTGRES_PASSWORD`,
  `SESSION_SECRET` (permission 600) — **ต้อง copy ค่าเดิมทั้งหมด** โดยเฉพาะ
  `SESSION_SECRET` ถ้าเปลี่ยนค่า user ทุกคนจะโดน force logout.

## ⚠️ ข้อควรระวังที่กำหนดลำดับขั้นตอน

1. **Split-brain**: tunnel เดียวกัน token เดียวกัน ถ้าเปิด `cloudflared` บน
   vigilcentral ขณะที่ตัวบน Mac ยังรันอยู่ → Cloudflare จะ load-balance
   traffic ข้ามสอง stack ที่มี DB คนละชุด (เขียนสลับกันได้) ต้อง **หยุด Mac
   connector ก่อนเสมอ** แล้วยืนยัน 0 replica ใน Cloudflare dashboard ก่อน
   เปิดตัวใหม่บน vigilcentral. ระหว่างช่วงนี้ `ssh-mac.dojojin.tech` จะใช้
   ไม่ได้ชั่วคราว (มี local/LAN SSH สำรองอยู่แล้ว ไม่กระทบ).
2. **Postgres ข้าม arch (arm64→x86_64)**: ห้าม copy raw volume/data
   directory ตรงๆ — ใช้ **logical dump** (`pg_dump` custom-format →
   `pg_restore`) เท่านั้น.
3. **`node_modules` ห้าม copy** ข้าม arch — ต้อง `npm ci` ใหม่บนเครื่อง
   ปลายทาง (native deps เช่น `sharp` compile เฉพาะ arch).
4. sudo steps ทั้งหมดบน vigilcentral (ติดตั้ง Docker, ตั้ง systemd service,
   เปิด firewall ถ้ามี) เป็น**มือเจ้าของ** — Claude รันแบบไม่ interactive
   ไม่ได้.

## Phase 0 — Pre-flight verify (ไม่มี downtime) — ✅ DONE 2026-07-23

- [x] เปิด Cloudflare Zero Trust → tunnel `vigil-platform` → tab **Published
      application routes** → confirm target service จริงของทั้ง 4 route
      (ดูตารางด้านบน — พบว่า route lpr/face-push ชี้พอร์ต 3003 ไม่ใช่ 3000
      ตามที่เคย infer ผิด)
- [x] เช็คว่า `MQTT_CAMERA_BROKER_HOST=192.168.10.31` reachable จาก Mac
      ปัจจุบันไหม → **ไม่ reachable** (ARP ว่าง, ไม่มี route, ping timeout)
      — ยังสรุปไม่ได้ว่ามีกล้อง Bosch local ผูกกับ IP นี้จริงหรือเปล่า
      **ต้องถามเจ้าของ** (ดู "คำถามค้าง" ท้ายไฟล์)
- [x] อ่าน `src/site-provision.js` เต็มไฟล์ — ยืนยันแล้วว่า EMQX password
      เป็น one-time reveal ไม่มี fallback กู้คืน ถ้า volume หาย =
      ต้อง re-provision ทุกไซต์ใหม่ทั้งหมด (ดูรายละเอียดใน Fact ด้านบน)

## Phase 1 — เตรียม vigilcentral (ไม่มี downtime, Mac ยังรันอยู่) — ✅ DONE 2026-07-24

- [x] ติดตั้ง Docker Engine + Compose — เจ้าของรันเอง (sudo password ส่งมา
      ในแชท, Claude ปฏิเสธใช้ตามกฎ ไม่ handle password แม้ได้รับอนุญาต).
      **แก้ package name ระหว่างทาง:** `docker-compose-plugin` (ชื่อจาก
      Docker's official repo) ไม่มีใน apt repo ของ Linux Mint 22.3/Ubuntu
      Noble — ใช้ `docker-compose-v2` แทน (v2.40.3). `docker.io` = v29.1.3.
      `usermod -aG docker` + re-login ทำงาน ใช้ `docker`/`docker compose`
      แบบไม่ต้อง sudo ได้แล้ว
- [x] `cloudflared` — **มีอยู่แล้ว** บน vigilcentral (`~/.local/bin/cloudflared`,
      v2026.7.3, ใหม่กว่าที่ Mac ใช้ด้วยซ้ำ) ไม่ต้องติดตั้ง
- [x] ติดตั้ง PM2 global สำเร็จ (v7.0.3, ผ่าน NVM node ไม่ต้อง sudo)
- [x] rsync repo จาก Mac → `/home/vigil-central/vigil-platform/` สำเร็จ
      (93 วินาที, exclude node_modules/.git/snapshots)
- [x] scp `.env` สำเร็จ, permission 600 คงเดิม
- [x] แก้ `ecosystem.config.js` interpreter path — **แก้เฉพาะไฟล์บน
      vigilcentral เท่านั้น** (ไม่แตะ repo บน Mac เพราะ PM2 บน Mac ยังรัน
      จริงอยู่) → `/home/vigil-central/.nvm/versions/node/v22.23.1/bin/node`
      (pin ตรง path แบบเดียวกับที่ Mac pin Homebrew path — ต้อง reconcile
      กลับเข้า repo จริงใน Phase 4 หลัง cutover สำเร็จ)
- [x] `npm ci` ใน `src/` (root `package.json` ว่างเปล่า — deps จริงอยู่ใน
      `src/package.json`) สำเร็จ 191 packages/13.5s; verify `sharp` โหลดได้
      จริง (`sharp 0.35.3`, x86_64 native build ผ่าน)
- [x] `shm_size: 1gb` — **มีอยู่แล้ว** ใน `docker-compose.yml` ที่ rsync มา
      (commit เดิมจาก Mac ครอบคลุมอยู่แล้ว) ไม่ต้องแก้เพิ่ม
- [x] `docker compose up -d` สำเร็จ — `vigil-postgres` = healthy + accepting
      connections, `vigil-emqx` = up, dashboard `localhost:18083` ตอบ 200
      (ทั้งคู่ volume ว่างเปล่า ยังไม่ restore data — ตามแผน Phase 2/3)

## Phase 2 — Dry-run — ✅ DONE 2026-07-24 (จับเวลาจริงแล้ว)

- [x] `pg_dump` (custom format, ในคอนเทนเนอร์) — **2m05s**, ได้ไฟล์ 1.1GB
      (compressed จาก 9GB raw)
- [x] scp โอนไป vigilcentral — **13s** (LAN เร็วตามคาด)
- [x] **เจอปัญหาระหว่างทาง + แก้แล้ว:** `pg_restore` รอบแรก fail รัว ๆ
      (conflict ทุก table/function/index) — สาเหตุ: `docker compose up`
      ตอน Phase 1 ทำให้ Postgres auto-run `init.sql` ไปแล้วครั้งเดียวตอน
      container เพิ่งสร้าง (fresh volume) → DB ไม่ได้ว่างเปล่าจริงตอน
      restore, แถม `init.sql` เป็น schema ฐาน**เก่ากว่า**ของจริง (ขาด
      คอลัมน์ที่มาจาก migration ทีหลัง เช่น `site_id`/`device_id` บน
      `cameras`) → ตรงตามกฎ CLAUDE.md ข้อ 5 (init.sql ไม่ใช่ living schema).
      **แก้โดย** `DROP DATABASE vigil_platform; CREATE DATABASE
      vigil_platform OWNER vigil_sql;` ก่อน restore (pg_dump custom format
      มี schema เต็มอยู่แล้วในตัว ไม่ต้องพึ่ง init.sql เลย)
- [x] `pg_restore` รอบสอง (DB ว่างจริง) — **4m59s**, **ไม่มี error เลย**
- [x] Verify row count เทียบ Mac vs vigilcentral: `users`/`cameras` ตรงเป๊ะ
      (6/58), `events`/`license_plates`/`appearances` ต่างกันเล็กน้อย
      (~0.03%) — **เป็นเรื่องปกติ** เพราะ ingestion ยังรันสดบน M:ac
      ระหว่าง dry-run ~7 นาทีนี้ ไม่ใช่ปัญหาข้อมูลหาย (ยืนยันว่า Phase 3
      ต้องหยุด ingestion ก่อน dump รอบจริงเสมอ ตามแผนเดิม)
- [x] rsync `snapshots/` (352MB) รอบแรก — **20s**

**สรุปเวลาที่วัดได้จริง (ส่วน DB): 2m05s + 13s + 4m59s ≈ 7m20s** — เหลือ
พื้นที่เผื่อในงบ 1 ชม. เยอะมาก (รวม PM2 stop/start + verify + tunnel swing
ก็ยังห่างไกลจาก 1 ชม.)

## Phase 3 — Cutover — ✅ DONE 2026-07-24 (ดูสรุปผลจริงท้ายไฟล์)

### แผนเดิม (อ้างอิง):

1. หยุด ingestion + PM2 ทั้ง 9 ตัวบน Mac (`pm2 stop all`)
2. `pg_dump` รอบสุดท้าย → โอน → `pg_restore` เข้า vigilcentral (ทับของ
   Phase 2 dry-run)
3. rsync `snapshots/` แบบ incremental (delta เท่านั้น เร็วกว่า)
4. copy volume `vigil_emqx_data` จาก Mac → vigilcentral (เก็บ edge
   credential เดิมทั้งหมด ไม่ re-provision)
5. เปิด PM2 ทั้ง 9 ตัวบน vigilcentral, verify: `curl localhost:3000`,
   EMQX `:8083` ตอบ, นับแถว DB เทียบกับต้นทาง (spot-check)
6. **Tunnel swing** (ตามข้อควรระวัง #1):
   a. หยุด `cloudflared` บน Mac (unload launchd plist)
   b. ยืนยัน Cloudflare dashboard เหลือ 0 active replica
   c. รัน `cloudflared tunnel run --token <เดิม>` บน vigilcentral
   d. ยืนยัน 1 active replica = vigilcentral
7. End-to-end verify ผ่าน `dashboard.dojojin.tech` จริง (login, LPR page,
   health) + ทดสอบ edge หนึ่งตัว reconnect/publish ผ่าน `wss://.../mqtt`
   เพื่อยืนยันว่า EMQX auth ที่ copy มาใช้งานได้จริง

### สิ่งที่เกิดขึ้นจริง (deviation จากแผน)

- **เจ้าของรัน `sudo launchctl unload .../cloudflared.plist` บน Mac
  เร็วกว่าที่วางแผนไว้** — แผนเดิมคือเตรียม vigilcentral ให้พร้อม 100%
  ก่อนแล้วค่อยขอให้ unload เป็นขั้นสุดท้าย (ลด gap ให้สั้นที่สุด) แต่
  เจ้าของ unload ไปก่อนที่ vigilcentral จะพร้อม → tunnel ไม่มี active
  replica เลยช่วงหนึ่ง (`dashboard.dojojin.tech` unreachable จริง) จนกว่า
  ผมจะเตรียม vigilcentral เสร็จแล้วเปิด connector ใหม่ — **ผลคือ downtime
  จริงยาวกว่าที่ตั้งใจเล็กน้อย แต่ยังสั้นมาก** (ดูตัวเลขด้านล่าง)
- **เจอ bug เล็กน้อยระหว่างทาง:** รอบ restore จริง ลืม `docker cp` ไฟล์
  dump เข้า container ก่อน (ทำถูกใน dry-run แต่พลาดตอนรีบ) — error
  `could not open input file` แก้ทันทีด้วย `docker cp` แล้ว retry
  (เสียเวลาเพิ่ม ~10 วินาที ไม่กระทบอะไร)
- ลำดับจริงที่ทำ: `pm2 stop all` (Mac) → `docker compose stop emqx` (Mac,
  quiesce ก่อน tar) → tar `vigil_emqx_data` (78KB) → `pg_dump` final
  (1m52s, 1.1GB) → scp ทั้งคู่ไป vigilcentral → restore EMQX volume (stop
  → wipe → untar → start) + `DROP`/`CREATE DATABASE` + `pg_restore`
  (4m59s, ไม่มี error) → verify row count **ตรงเป๊ะ 100%** ทุกตาราง (ต่าง
  จาก dry-run ที่ต่างกัน ~0.03% เพราะรอบนี้ ingestion หยุดสนิทแล้วทั้งคู่)
  → rsync snapshots incremental (2.8s) → `pm2 start ecosystem.config.js`
  บน vigilcentral (8 apps online, restart count = 0 ทุกตัว) → verify local
  (`:3000`→302, `:3003`→404 expected, `:8083`→404 expected — ทั้งหมดคือ
  "ไม่ 502" แปลว่า service ตอบจริง) → mqtt-subscriber connect เข้า EMQX
  ที่ restore มาสำเร็จ (log ยืนยัน subscribe topics ปกติ — proof ว่า EMQX
  credential migration ถูกต้อง) → เปิด `cloudflared tunnel run --token
  <เดิม>` บน vigilcentral (nohup, 4 tunnel connections ขึ้น, ดึง ingress
  config ตรงกับ 4 routes ที่ verify ไว้ใน Phase 0 เป๊ะ) → ยืนยัน Mac ไม่มี
  process cloudflared เหลือแล้ว (connector เดียว = vigilcentral) →
  end-to-end ผ่าน `https://dashboard.dojojin.tech/` จริง — โหลด HTML
  disclaimer page สมบูรณ์, `final_status=200`

**สรุป: cutover สำเร็จ ข้อมูลครบ 100% (row count ตรงเป๊ะ), downtime อยู่ใน
งบ 1 ชม. อย่างสบาย (ส่วนที่วัดได้จริงในมือผม ~10-12 นาที ไม่รวม gap ก่อน
เจ้าของแจ้งว่า unload แล้ว) ไม่มี rollback เกิดขึ้น**

## Phase 4 — Post-migration — ✅ DONE 2026-07-24 (ยกเว้น 1 ข้อนอก scope)

- [x] `pm2 save` เสร็จก่อน (ไม่ต้อง sudo) แล้วเจ้าของรัน
      `pm2 startup systemd -u vigil-central --hp /home/vigil-central` เอง
      (sudo) → `pm2-vigil-central.service` **enabled** จริง (verify ผ่าน
      `systemctl is-enabled`) จะ resurrect เองตอน reboot จริง — status
      "inactive" ตอนนี้ปกติ เพราะ PM2 apps รันมาจากที่ผม start เองไว้ก่อน
      ไม่ผ่าน systemd (ยังไม่มี reboot จริงเกิดขึ้น)
- [x] Mac ไม่ได้ลบอะไรเลย ยังเป็น hot standby ได้ (Docker/PM2/repo ยังอยู่
      ครบ, แค่ cloudflared connector หยุดไปเพราะ unload plist ตอน cutover)
- [x] แก้ git access — เจ้าของเพิ่ม deploy key บน GitHub, verify
      `ssh -T git@github.com` สำเร็จ ("Hi dojojin!") → `git init` +
      `git remote add origin` + `git fetch` + `git reset origin/main`
      (แบบ mixed reset ไม่แตะ working tree) บน vigilcentral **โดยไม่ทับ**
      `ecosystem.config.js` ที่ปรับ interpreter path เฉพาะเครื่องนี้ไว้
      (verify แล้ว path ยังถูกต้องหลัง reset)
      **พบข้อมูลเพิ่มเติม (ไม่เกี่ยวกับ migration โดยตรง):** origin/main
      บน GitHub ยังไม่มี commit `fc5db05` (i18n fix) เพราะยังไม่เคย push —
      รวมกับงาน Overview/Executive-Summary redesign ที่ค้าง uncommitted
      อยู่ก่อนหน้าเซสชันนี้แล้ว → `git status` บน vigilcentral เลยโชว์ไฟล์
      เดิมๆ เหล่านี้เป็น "modified" (เทียบกับ origin/main ที่เก่ากว่า) —
      **ไม่ใช่ปัญหาจากการย้ายเครื่อง** เป็น pending decision เดิมของ
      เจ้าของเรื่อง push/commit ที่ยังไม่ได้ตัดสินใจ (แยกเรื่องจากงานนี้)
- [x] Rename route `ssh-mac.dojojin.tech` → `vigil.dojojin.tech` (SSH เข้า
      vigilcentral) + สร้าง tunnel `macbook-ssh` ใหม่ (ตัวเก่าโดนลบออกจาก
      accountไปแล้วจริง — เจอตอน debug retry loop) ผูก `ssh-mac.dojojin.tech`
      กลับมาที่ Mac ผ่าน user-level LaunchAgent (ไม่ใช้ sudo) — ดูรายละเอียด
      เต็มในบท "SSH route split" ท้ายไฟล์

## Post-migration hardening — ✅ DONE 2026-07-24 (audit ตาม WA#4 หลัง advisor ชี้จุดพลาด)

Advisor ตรวจ Phase 4 อีกรอบ เจอ 2 durability gap ที่ Phase 4 เดิมพลาดไป
(ทั้งคู่เป็น "reboot-triggered, invisible จนกว่าจะ reboot จริง"):

1. **[vigilcentral] cloudflared ไม่มี boot persistence** — ตอน cutover เปิด
   ด้วย `nohup ... & disown` รอด SSH หลุดได้แต่รอด reboot ไม่ได้ **แก้แล้ว:**
   เจ้าของรัน `sudo cloudflared service install <token>` → สร้าง
   `cloudflared.service` (systemd, root-owned, PID แยกจาก nohup เดิม)
   verify: `systemctl is-enabled cloudflared` → enabled, `active (running)`,
   precheck ผ่านหมด แล้ว kill process nohup ตัวเก่าทิ้ง (PID เดิม 21719,
   ต้อง `kill -9` เพราะ `kill` เฉยๆ ไม่ตาย) ยืนยันเหลือ connector เดียว
2. **[Mac] root LaunchDaemon เก่ายังมี `RunAtLoad=true`** — `launchctl
   unload` ตอน cutover ไม่ถาวร, reboot Mac เมื่อไหร่จะรันขึ้นมาเองกลายเป็น
   connector ตัวที่ 2 ของ vigil-platform บน token เดียวกัน = split-brain
   ที่ทั้ง cutover พยายามเลี่ยง **แก้แล้ว:** เจ้าของรัน `sudo launchctl
   bootout` + `sudo mv .../com.cloudflare.cloudflared.plist
   .../com.cloudflare.cloudflared.plist.disabled` (ย้ายเก็บไว้ ไม่ลบ —
   ใช้ตอน rollback แค่ mv กลับ+load) verify: `ls /Library/LaunchDaemons/`
   เหลือแค่ `.plist.disabled`, `launchctl list` ไม่มี cloudflared ของ
   vigil-platform เหลือ, ไม่มี root cloudflared process รันอยู่

**Audit หลังแก้ (reproduce จริง):**
- `curl https://dashboard.dojojin.tech/` → 200 ปกติ
- Cloudflare dashboard → Connectors "Showing 1 - 1", hostname `vigilcentral`,
  platform `linux_amd64`, status **Connected** — connector เดียวจริง
- Mac `vigil-emqx` container ที่ค้าง `Exited (137)` จากตอน tar volume →
  `docker compose up -d emqx` กลับมา Up ปกติ (rollback-ready เต็มรูปแบบ)

**ยังไม่ทำ (ไม่บล็อก แต่ advisor แนะนำ):** reboot-test vigilcentral จริง
เพื่อยืนยัน boot-persistence ทั้งชุด (Docker+PM2 systemd+cloudflared
systemd) — เป็น acceptance test ตัวเดียวที่พิสูจน์ได้จริงว่ารอด reboot
ได้จริง ไม่ใช่แค่ "enabled" บนกระดาษ; เลื่อนไว้เพราะเป็น action ที่มี
downtime สั้นๆ จริง ต้องขอ green light แยกก่อนทำ

## BIOS AC Power Recovery — ✅ DONE 2026-07-24 (durability gap ตัวที่ 3)

เจ้าของถามว่าถ้าไฟดับแล้วไฟมา vigilcentral จะเปิดเองไหม (ไม่มีคนไปกด
power) — เช็คแล้วพบว่านี่คือช่องโหว่จริง แยกจาก 2 ข้อบนไปเลย (เป็นชั้น
**ก่อน OS boot** ด้วยซ้ำ: ถ้า BIOS ไม่สั่งเปิดเครื่อง ทุกอย่างที่แก้ไว้ข้าง
บน — Docker/PM2 systemd/cloudflared systemd — ก็ไม่มีโอกาสได้ทำงานเลย)

**เครื่อง:** Dell Precision 3660 (BIOS Dell 2.22.0) ไม่มี IPMI/BMC (มีเฉพาะ
PowerEdge server ไม่ใช่ Precision workstation) → เช็ค/แก้ค่าผ่าน remote
ปกติไม่ได้ ต้องใช้ Dell BIOS token interface

**วิธีที่ใช้ (ไม่ต้องเพิ่ม repo ของ Dell เอง):** ติดตั้ง `smbios-utils`
(package มาตรฐานจาก **Ubuntu universe repo**, โหลด 130KB/ติดตั้งจริง
599KB, เป็นแค่ CLI tool ไม่มี background service — จาก open-source
`libsmbios` project) ใช้ `/usr/sbin/smbios-token-ctl` (ต้อง sudo อ่าน/
เขียน SMBIOS table โดยตรง) เจอ 3 token คู่กันสำหรับ AC Power Recovery
Mode: `0x00a1`=Off, `0x00a2`=Last state, `0x00a3`=On

**พบว่าตั้งเป็น "Off" อยู่จริง** (`0x00a1` active=true ตอนแรก) — ถ้าไฟดับ
เครื่องจะดับค้าง ต้องมีคนไปกดปุ่มเอง **แก้แล้ว:** `sudo
smbios-token-ctl --activate --token-id=0x00a3` → verify ซ้ำด้วย
`--is-active` ครบทั้ง 3 token: `0x00a1=false`, `0x00a2=false`,
`0x00a3=true` ยืนยันสำเร็จ มีผลทันทีไม่ต้อง reboot

## Rollback

ตราบใดที่ยังไม่ลบอะไรบน Mac: หยุด vigilcentral connector → reload Mac
cloudflared plist → `pm2 start all` บน Mac → เช็ค 1 replica = Mac กลับมา
ตามเดิม ข้อมูลที่เขียนเข้า vigilcentral ระหว่างนั้น (ถ้ามี) จะต้อง sync
ย้อนกลับ (Postgres) — เป็นเหตุผลที่ Phase 3 ควร**หยุด ingestion ทั้งหมด
ก่อน** ไม่ทำ delta-sync แบบวิ่งขนาน.

## คำถามค้าง — ✅ ตอบแล้ว 2026-07-23

- **`MQTT_CAMERA_BROKER_HOST=192.168.10.31`** — เจ้าของยืนยัน **ไม่มี**
  กล้อง Bosch ตัวไหน publish ไปที่ IP นี้ตรงๆ (ทุกตัวคุยผ่าน tunnel
  `wss://dashboard.dojojin.tech/mqtt` หมดแล้ว) → **ข้ามเรื่อง repoint
  กล้องได้เลย ไม่ต้องทำอะไรเพิ่มใน Phase 3** ค่า env นี้ copy ไปเฉยๆ
  ตามปกติ (ไม่มีผลต่อ downtime/cutover)
