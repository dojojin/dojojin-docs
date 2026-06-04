# Passed Categories (หมวดที่ตรวจแล้วผ่าน)

> ✅ ไม่พบช่องโหว่ในหมวดเหล่านี้ — บันทึกไว้เพื่อ traceability ของการตรวจ
> ดูสารบัญ: [CLAUDE_Audit.MD](../../CLAUDE_Audit.MD)

---

## ✅ SQL injection sweep

ทุก SQL ใช้ parameterized `$N` placeholder. ที่ใช้ template-literal interpolation มีเฉพาะ:

- `METRIC_EVENT_TYPE_PATTERN` (const string `'%Aggregation%'`)
- `today/yesterday` SQL fragments (server-built, ใช้ `$1` ตัวจริงสำหรับ tz param) — `stats-summary-route.js:93-94`
- `updates.join(', ')` ใน UPDATE statement builders — ทุก fragment เป็น `column = $N` ที่ server-controlled
- `where.join(' AND ')` — เหมือนกัน

**ไม่พบ string concat กับ req.body / req.query / req.params ใน SQL string ใดเลย**

ตรวจไฟล์: api-server.js, auth.js, stats-summary-route.js, mqtt-subscriber.js, media-recorder.js, ingesters/hikvision-isapi.js, ingesters/dahua-cgi.js

---

## ✅ Path traversal & file serving

ทุก route ที่ serve file มี **regex validation** + **fixed base directory** + `path.join`:

- `/snapshots/:filename` → `^[A-Za-z0-9._-]+\.(jpg|jpeg|png)$` (api-server.js:340)
- `/media/:filename` → `^[A-Za-z0-9._-]+\.(mp4|webm)$` (api-server.js:394)
- `/tiles/:provider/:style/:z/:x/:y.png` → ทุก segment regex'd (`^[a-z_]+$` / `^\d+$`) (api-server.js:2730)
- `/api/backups/:filename` → `^vigil_platform_[0-9_-]+\.dump$` (api-server.js:4873)
- `/favicon.ico` → `^[A-Za-z0-9._-]+$` (api-server.js:259)

ไม่พบ user-input ไหลเข้า `fs.write*` / `fs.unlink*` ที่ไหน

---

## ✅ Command injection / spawn

ทุก spawn ใช้ array args (ไม่ใช่ shell string):

- ffmpeg: `spawn('ffmpeg', [array])` (media-recorder.js:169, dahua-cgi.js:220)
- ffprobe: same (media-recorder.js:191)
- backup: `execFile('bash', [script])` (api-server.js:4890)
- git rev-parse: hardcoded (api-server.js:5563)
- `pgrep -f "${pat}"` — `pat` มาจาก hardcoded array (api-server.js:5101-5104), ไม่ใช่ user input

ไม่พบ `exec()` หรือ shell-format spawn ที่รับ user-controlled args

---

## ✅ License verification (Ed25519 JWT)

`license.js:144-162` — ใช้ `jose.jwtVerify` พร้อม explicit `algorithms: ['EdDSA']` → ป้องกัน `alg: none` / RS↔HS confusion

Machine fingerprint binding ก็ทำได้รัดกุม:
- Linux machine-id (priority 1)
- macOS IOPlatformUUID (priority 2)
- MAC เป็น last-resort + filter Private MAC ที่ rotate (`_isLocallyAdministeredMac`)
- CPU model + arch เป็น extra entropy

---

## ✅ PDPA / data exposure

- Snapshots/Media require auth (PDPA-aware) — api-server.js:333-377, 387-405
- Audit log silently rotate 90 วัน — auth.js:67
- `getActiveSessions` mask session ID (8 chars only) — api-server.js:533
- Third-party DB views (`v_*_public`) ใช้ NOLOGIN role + GRANT แค่ SELECT — `db/db_migration_027_third_party_views.sql`
- Cookie raw value ไม่ถูก dump ใน log (api-server.js:508 — log แค่ `hasCookieHeader` boolean)
- LINE config GET mask token เหลือ `••••••••` + 12 chars ท้าย (api-server.js:2779-2790)

---

## ✅ Auth core (login, session, RBAC)

### Password / Session

- bcrypt rounds=10 (auth.js:73)
- HMAC SHA-256 signed sessions, constant-time compare (auth.js:97-101)
- Session token truncate hmac to 32 hex (128-bit) — still secure

### Rate-limit / Lockout

- Login rate-limit: 10/min/IP global (api-server.js:413-417)
- Per-user lockout: 5 fail / 15 min (auth.js:21-22)
- Map cleanup setInterval (api-server.js:426-433) — memory bounded

### IP / Proxy

- IP from CF-Connecting-IP (anti-XFF-spoof) + trust proxy 'loopback' (api-server.js:30, 150-155)

### Internal token

- Random per boot (line 208) + `timingSafeEqual` (line 213) — ปลอดภัยจาก timing attack

### WS / CORS

- WS verifyClient gate ก่อน upgrade complete (api-server.js:39-55) — PDPA-aware
- CORS allowlist + same-origin check + ALLOWED_ORIGINS env (api-server.js:86-104)

### RBAC

- `requireAdminForWrites` ครอบ resources สำคัญ (api-server.js:646-654):
  - /cameras, /groups, /alert-rules, /line-config, /map, /categories, /category-rules, /settings, /report-schedules
- `requireAdminOrAuditor` แยกสำหรับ read-only audit role

### Note (limitations)

- `must_change_password` enforce แค่ฝั่ง client → ดู [SEC-004](03_medium.md#sec-004)
- /api/cameras GET ไม่ filter password → ดู [SEC-003](02_high.md#sec-003)

---

## ✅ Static asset auth gate

`api-server.js:219-245` — middleware ก่อน static serve:
- Whitelist `PUBLIC_HTML_FILES` (login.html, disclaimer.html) + `PUBLIC_PATHS` (/api/auth/login, /api/branding, /api/eula) + `PUBLIC_PREFIXES` (/vendor/, /branding/, /tiles/, /others/)
- Unauthed HTML นาวิเกชั่น → redirect /disclaimer.html
- Internal token bypass (สำหรับ Puppeteer renderer)
- Bad/expired token → ล้าง cookie ก่อน redirect

ไม่มี path ที่ leak code ออกไปโดยไม่ผ่าน gate
