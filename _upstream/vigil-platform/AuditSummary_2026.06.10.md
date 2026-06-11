# Audit Summary — 2026-06-10

> **Vigil Platform v1.5.3** · System + Security Audit (2 รอบในวันเดียว) + Incident Response
> Auditor: Claude Code (Sonnet 4.6 รอบแรก / Fable 5 รอบสอง) ร่วมกับ owner
> Commits: `bbdd1b2` → `60a0a70` (12 commits, push แล้ว)
> เอกสารอ้างอิงหลัก: GOTCHAS #82–#84 · ROADMAP section "System Audit 2026-06-10"

---

## 1. Incident ที่พบระหว่าง Audit (ตัวจุดประเด็นทั้งหมด)

| หัวข้อ | รายละเอียด |
|---|---|
| อาการ | Clip recording (RTSP rolling buffer) ล่มเงียบ **~17 ชม.** (9 มิ.ย. 09:00 → 10 มิ.ย. 03:00) — `media-buffer/` ว่าง, ffmpeg crash-loop ทุก 5 วิ, error log โต ~72,000 บรรทัด (44MB) |
| Root cause จริง | **macOS Local Network Privacy (LNP)** — per-binary/per-app permission: binary ที่ไม่มี record (ffmpeg, node@22) + spawn จาก context ไม่มี grant (tmux/launchd) → ถูกปัดเงียบ `EHOSTUNREACH` ไป camera subnet (en17) |
| หลักฐานชี้ขาด | Evidence matrix จาก shell เดียวกัน: curl/nc (Apple, exempt) ✅ · node@20 (มี record ใน networkextension.plist) ✅ · node@22 + ffmpeg (ไม่มี record) ❌ · ffmpeg → en0 ✅ |
| แก้ความเข้าใจเดิม | GOTCHAS #83 ("node v22/libuv") = วินิจฉัยผิด · #82 (ทฤษฎี TCC) ถูกมาตลอด — เคย rule out ผิดเพราะใช้ curl (exempt binary) เป็น control · ทั้งหมด supersede ด้วย **#84** |
| การกู้คืน | Restart PM2 ใต้ context ที่มี grant → verify: 54 segments/นาที, error 0 บรรทัด, กล้องครบ 3 ตัว |

---

## 2. Security Findings + การแก้ไข

| ID | ปัญหา | ระดับ | การแก้ไข | Commit | สถานะ |
|---|---|---|---|---|---|
| S-NEW1 | api-server bind `0.0.0.0:3000` — ทั้ง LAN (รวม camera subnet) ยิง API ตรง ข้าม Cloudflare Access ได้ | 🔴 สูง | bind `127.0.0.1` (ยืนยันก่อนว่า Vigil Mobile ผ่าน tunnel เท่านั้น) + `BIND_HOST` override ใน .env.example · verify: LAN refused, tunnel ปกติ | `8d3c65a` | ✅ |
| B-NEW2 | RTSP password รั่วลง log plaintext หลายหมื่นบรรทัด (ffmpeg พิมพ์ URL เต็มลง stderr) | 🔴 สูง | `redactCreds()` ใน media-recorder กรองก่อน log + **purge log rotated เก่าที่มี creds ค้าง** — scan ซ้ำทั้ง `~/.pm2/logs/` = 0 ไฟล์มี creds | `50c1710`, `0b340c0` | ✅ |
| S-NEW2 | `.env` perms 644 (world-readable) — มี SESSION_SECRET + DB creds | 🟠 กลาง | `chmod 600` — ทุก service รันเป็น owner ไม่กระทบ | `fadbec3` (record) | ✅ |
| A6 | node@20 ที่ pin อยู่ **EOL เม.ย. 2026** — ไม่มี security update | 🟠 กลาง | อัปทั้ง 7 apps → **node@24 LTS** (v24.16.0) ผ่าน `base.interpreter` + repro 2 ชั้นก่อนอัป + `brew pin node@24` | `ee29c82` | ✅ |
| A4 | Backup อยู่ disk เดียวกับ DB + Time Machine พัง (Code 17) — single point of failure | 🟠 กลาง | Offsite Tier 1 → Google Drive ผ่าน **rclone crypt** (เข้ารหัสฝั่ง client, scope drive.file, retention 30 วัน) ผูกใน backup.sh · verify round-trip checksum 100% · CRYPT_PASSWORD/SALT เก็บใน 1Password (ทดสอบถอดรหัสจากค่าที่เก็บแล้ว) | `60a0a70` | ✅ |
| A1 | mqtt-subscriber มี camera HTTP (`:154,286` Bosch snap.jpg) บน node v22 ไร้ LNP record — latent จนกล้อง Bosch ถูก re-enable + interpreter drift 4 workers ตาม PATH | 🟠 กลาง | ปิดพ่วงกับ A6 — runtime เดียว node@24 ทุกตัว ใต้ VigilPM2.app grant | `ee29c82` | ✅ |
| — | RTSP creds มองเห็นใน `ps` args (ffmpeg รับ URL เต็ม) | 🟡 ต่ำ | ยอมรับความเสี่ยง — เครื่อง single-user, ffmpeg ไม่มีช่องทางส่ง creds อื่น · บันทึกไว้เป็น known issue | — | 📌 accepted |

## 3. Reliability / Ops Findings + การแก้ไข

| ID | ปัญหา | ระดับ | การแก้ไข | Commit | สถานะ |
|---|---|---|---|---|---|
| #84 | LNP ทำ PM2 tree เสีย camera access เมื่อ restart จาก tmux/ssh/launchd + brew upgrade ทำ record หาย | 🔴 สูง | **VigilPM2.app** (1-B) — app ถือ LN grant เอง ลูกสืบทอดหมด ไม่ขึ้นกับ binary path · พิสูจน์เทียบ control + รอด nehelper/mDNSResponder reload · plist boot path ชี้ app (ทดสอบ end-to-end) · fallback = Terminal script · `brew pin` กันเหนียว | `50c1710`, `80ffb3b`, `ee29c82` | ✅ (เหลือเช็คหลัง reboot จริง 1 ครั้ง) |
| B-NEW1 | media-recorder spawn ffmpeg ให้กล้อง `enabled=false` (BOSCH_8100i ถอดปลั๊ก) → crash-loop ไม่รู้จบ | 🟠 กลาง | เพิ่ม `enabled = TRUE` ใน syncRecorders query (ตรวจแล้วไม่ชน `paused` ซึ่งเป็นคนละ column) | `50c1710` | ✅ |
| B-NEW3 | ffmpeg restart คงที่ 5 วิ ไม่มี backoff → log flood 6,399 บรรทัด/ชม. | 🟠 กลาง | Exponential backoff 5s→60s cap (รันเกิน 60s = reset streak) | `50c1710` | ✅ |
| A2 | ไม่มี log rotation — logs โตไม่จำกัด (61MB) | 🟠 กลาง | pm2-logrotate: max 10M / retain 14 / compress | `50c1710` (record) | ✅ |
| — | ไม่มี detection เมื่อ recorder wedge (incident มองไม่เห็น 17 ชม.) | 🟠 กลาง | `/api/health/details` → `media_buffer[].newest_segment_sec` ต่อกล้อง (dir mtime) · verify ด้วย minted session | `50c1710` | ✅ |
| A5 | Error log บรรทัดว่าง (`❌ MQTT: `, `🔔 ... error: `) — debug ย้อนหลังไม่ได้ | 🟡 ต่ำ | `e.message \|\| e` (alert-engine) / `err.message \|\| err.code \|\| err` (mqtt-subscriber) | `ec5cb9a` | ✅ |
| A7 | health endpoint `cameras.list` code-complete แต่ไม่เคย runtime-verify | 🟡 ต่ำ | Mint temp admin session ใน DB → ยิงจริง → ครบ 7 กล้อง + media_buffer ทำงาน → ลบ session | — | ✅ |
| A3 | Disk 93% เต็ม (เหลือ 33GB) | 🟠 กลาง | ฝั่ง project: purge ข้อมูล พ.ค. ตามคำสั่ง owner (events 53,367 + snapshots 2.6GB + clips 9.8GB + reports 32) → คืน ~13GB เหลือว่าง 58GB · DB rows กู้ได้จาก dump | `b209354` (record) | ✅ (ฝั่ง `~/Library` 209GB รอ owner) |
| — | media-buffer dir เก่าค้าง 5 ตัว (รวม typo สระไทย) | 🟡 ต่ำ | ลบ — recorder mkdirSync เองเมื่อต้องใช้ | `ec5cb9a` (record) | ✅ |

## 4. ตรวจแล้วผ่าน (ไม่มี action)

| รายการ | ผล |
|---|---|
| `npm audit` (production deps) | 0 vulnerabilities |
| EMQX auth | password_based + bcrypt, ไม่มี allow_anonymous; dashboard 18083 + PG 5432 bind localhost |
| PostgreSQL 16.14 | connections 11/100, autovacuum on, dead index = 0, DB 55MB healthy |
| Secrets | SESSION_SECRET 64 chars; `.env`/`cameras-config.json` ไม่อยู่ใน git; cameras-config 600 + `enc:v1:` |
| PM2 | 7 workers, unstable_restarts 0, memory 35-55MB ไม่มี leak |
| Retention | ครบทุกชั้น: events→children, snapshots, thumbs, clips, report PNG (settings-driven) |
| Port 5000/7000/51654 | macOS AirPlay/rapportd — นอก scope project |

## 5. คงเหลือ (ฝั่ง owner ทั้งหมด)

| # | รายการ | เงื่อนไข |
|---|---|---|
| 1 | เช็ค `media_buffer` ใน health หลัง **reboot จริงครั้งถัดไป** | ยืนยัน VigilPM2.app grant ถาวร (LNP store ของ unsigned app อ่านตรงไม่ได้) |
| 2 | Time Machine destination พัง (Code 17) | ซ่อม/เปลี่ยน disk — Tier 1 บน Drive cover ส่วน platform แล้ว |
| 3 | `~/Library` 209GB + Parallels 35GB | ถ้าต้องการพื้นที่เพิ่มจาก 58GB |
| 4 | (optional) LINE alert เมื่อ media_buffer stale > 5 นาที | ต่อยอด detection ผ่าน alert-worker — เสนอค้างไว้ |

---

## 6. บทเรียนสำคัญ (capture ลง GOTCHAS แล้ว)

1. **#84:** macOS LNP เป็น per-binary/per-app — ห้าม restart PM2 จาก tmux/ssh/Claude shell; ใช้ `open scripts/VigilPM2.app` เสมอ; `brew upgrade` node/ffmpeg = record หาย (app wrapper ปิดความเสี่ยงนี้แล้ว)
2. **Control ที่ผิดทำให้ rule out ผิด:** ใช้ curl (Apple binary, LNP-exempt) เป็น control → สรุปว่า "ไม่ใช่ TCC" ทั้งที่ใช่ — บทเรียน: control ต้องอยู่ class เดียวกับตัวที่ fail
3. **Detection ก่อน incident ถัดไป:** recorder ล่ม 17 ชม. โดยไม่มีใครเห็น → ตอนนี้ health endpoint ฟ้องใน 1 นาที

<sub>Audit Summary · Vigil Platform v1.5.3 · 2026-06-10 · companion: GOTCHAS.md #82–#84, ROADMAP.md</sub>
