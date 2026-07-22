# REF_security-checklist.md — Security Touch-Point Checklist

> **ใช้อย่างไร:** เมื่อแตะโค้ดในกลุ่มด้านล่าง → อ่าน checklist ของกลุ่มนั้นก่อนเขียนโค้ด
> Source: audit SEC-001–SEC-011 (2026-05-28) · SEC-012 (2026-05-28) · SEC-2T-001–008 (2026-06-03/05) · ดู GOTCHAS.md #50–#59 + DECISIONS.md #152–#160, #200–#207
> โหลดไฟล์นี้อัตโนมัติเมื่อแตะ: auth / upload / cookie / credential / docker port (CLAUDE.md Note #17)

---

## 🔐 Auth / Middleware / Session

| ต้องเช็ค | Reference |
|---|---|
| Security flag ใหม่ (locked, must_verify ฯลฯ) → enforce ที่ `requireAuth` + allowlist path ด้วย | GOTCHAS #54, DECISIONS #157 |
| Endpoint ใหม่ → ระบุ role ที่อนุญาต (`requireAdmin` / `requireAuth`) | DECISIONS #152 |
| Login cookie → ใช้ flag builder `(Secure เฉพาะ HTTPS, SameSite=Lax, HttpOnly)` | GOTCHAS #56, DECISIONS #159 |
| Logout cookie → ใช้ flag builder **เดียวกัน** กับ login | GOTCHAS #56, DECISIONS #159 |

## 📤 File Upload

| ต้องเช็ค | Reference |
|---|---|
| Upload ใหม่ → อ่าน `req.file.buffer` ตรวจ **magic bytes** ก่อน accept (ไม่ใช่แค่ MIME type) | GOTCHAS #55, DECISIONS #158 |
| ประเภทที่รองรับ: PNG (`\x89PNG`) · JPEG (`\xFF\xD8\xFF`) · WebP (`RIFF....WEBP`) · GIF (`GIF87a/89a`) | GOTCHAS #55 |
| SVG ห้าม accept เป็น upload ทั่วไป (librsvg CVE) | GOTCHAS #25a, DECISIONS #158 |

## 🌐 GET Endpoint ที่คืนข้อมูลจาก DB

| ต้องเช็ค | Reference |
|---|---|
| มี credential / token / secret ใน response ไหม → redact ถ้า role ≠ admin | GOTCHAS #52, DECISIONS #154 |
| ทุก field ที่จะ inject ใน innerHTML → ผ่าน `escapeHtml()` เสมอ | GOTCHAS #51, DECISIONS #153 |
| URL path จาก DB/MQTT → `encodeURIComponent()` | GOTCHAS #51 |

## 🐳 Docker / Infrastructure

| ต้องเช็ค | Reference |
|---|---|
| Port ใหม่ใน compose → `"127.0.0.1:PORT:PORT"` ไม่ใช่ `"PORT:PORT"` | GOTCHAS #57, DECISIONS #160 |
| Secret ใน compose → `${VAR:?must be set}` เท่านั้น — ค่าจริงใน `.env` (gitignored) | GOTCHAS #57, DECISIONS #160 |
| ถ้า service ต้องรับจาก LAN → `"<LAN_IP>:PORT:PORT"` ไม่ใช่ wildcard | GOTCHAS #57 |

## 🔌 MQTT / Event Ingest

| ต้องเช็ค | Reference |
|---|---|
| MQTT auth off → ทุก field ใน payload ถือว่า attacker-controlled | GOTCHAS #50, DECISIONS #152 |
| Stored payload → escapeHtml ก่อน render ทุก field | GOTCHAS #51, DECISIONS #153 |
| Validation ใหม่ที่บล็อก message → รอไฟเขียวก่อน (Working Agreement #3) | CLAUDE.md WA#3 |
| Edge NanoMQ (`allow_anonymous=true`) → **command topic ใหม่ (ไม่ใช่แค่ event ingest) ต้องมี auth ของตัวเอง** ก่อน merge — อย่าพึ่ง broker-level auth ที่ยังไม่มี | SEC5-HIGH-003, DECISIONS #222 |

## 📥 Public Push Receiver (token-in-path, ไม่ใช้ session)

| ต้องเช็ค | Reference |
|---|---|
| Route ใหม่ที่รับ push จากอุปกรณ์ (กล้อง/edge) ผ่าน token ใน path → **เช็ค token ก่อน `express.raw()`/body parser เสมอ** ไม่ใช่หลัง — ป้องกัน DoS จาก unknown-token request ที่กิน memory เปล่าๆ | LIVE-HIGH-001, DECISIONS #221 |
| token ผิด → ตอบโค้ดเดิมที่ device ที่ถูกต้องคาดหวัง (ไม่เปลี่ยนพฤติกรรมสังเกตได้จากภายนอก) เพื่อไม่ทำให้ retry storm | LIVE-HIGH-001 |
| Route legacy ที่ไม่มี token เลย → เช็ค log จริงว่ามี traffic ใช้อยู่ก่อนปิด (อย่าเดา) | SEC5-HIGH-002, GOTCHAS (log-evidence pattern) |
| `express.raw`/`multer` limit ใหม่ → เช็ค `npm audit` ของ dependency นั้นก่อนปักเวอร์ชัน | LIVE-HIGH-002 |

## 🗝️ Secrets Inventory (ตรวจก่อน commit ทุกครั้ง / audit รอบใหม่)

> เหตุผล: audit SEC-001–011 เป็น code-path audit — ตรวจตาม category ที่รู้จัก ไม่ใช่
> secrets-sprawl audit ทำให้พลาด `src/.env` (GOTCHAS #59) ซึ่งมี Mapbox/LINE/DB credentials

| ต้องเช็ค | วิธีตรวจ | Reference |
|---|---|---|
| ระบุทุกไฟล์ที่เก็บ secret | `find . -name "*.env*" -not -path "*/node_modules/*" -not -path "*/.git/*"` | GOTCHAS #59 |
| ทุกไฟล์ secret ต้องอยู่ใน `.gitignore` | `git check-ignore -v <file>` | GOTCHAS #59 |
| ไม่มี literal token ใน git tree | `git grep -E "pk\.eyJ\|sk\.eyJ\|AKIA\|ghp_\|xoxb-"` | SEC-012 |
| โปรเจกต์นี้มี `.env` สองชั้น: `src/.env` (Node.js) + root `.env` (Docker Compose) | ทั้งสองอยู่ใน `.gitignore` บรรทัด 11–14 แล้ว | GOTCHAS #59 |
| credentials ใหม่ → ใส่ถูกไฟล์: Node.js → `src/.env`, Compose var → root `.env` | — | GOTCHAS #59 |
| **pre-commit hook ติดตั้งแล้ว** — scan staged files หา token signature ก่อน commit | ติดตั้ง: `cp scripts/hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit` | DECISIONS #170 |
| **`cameras-config.json`** — เก็บ username/password/mqtt_password ของกล้องทุกตัว (plaintext); gitignored ✅; permissions ต้อง `600` (`chmod 600 cameras-config.json`) | `ls -la cameras-config.json` | GOTCHAS #69 · SEC-013 · DECISIONS #191 |

## 📋 Quick Reference: SEC-001 to SEC-013

### ✅ แก้แล้ว (SEC-001 – SEC-012, audit 2026-05-28)

| ID | หมวด | Fix สรุป | GOTCHAS |
|---|---|---|---|
| SEC-001 | MQTT port bind | `127.0.0.1:1883` + rotate EMQX password | #50, #57 |
| SEC-002 | XSS stored | `escapeHtml()` ทุก MQTT/DB field ใน DOM | #51 |
| SEC-003 | Creds leak | Redact password สำหรับ non-admin GET | #52 |
| SEC-004 | Auth bypass | `must_change_password` enforce ที่ middleware | #54 |
| SEC-005 | File upload | Magic bytes check ก่อน accept | #55 |
| SEC-006 | CSP/headers | CSP Report-Only + HSTS conditional | — |
| SEC-007 | qs CVE | Upgrade qs ≥6.13.1 | — |
| SEC-008 | SSRF probe | `_isPrivateIp()` warn (non-blocking on-prem) | — |
| SEC-009 | .env malformed | Comment out บรรทัด paste ผิด | — |
| SEC-010 | Cookie flags | Login/logout ใช้ flag builder เดียวกัน | #56 |
| SEC-011 | Postgres port | `127.0.0.1:5432` + password rotate | #57 |
| SEC-012 | Secrets sprawl | Secrets Inventory checklist — ระบุทุก .env, ตรวจ gitignore, grep literal token | #59 |
| SEC-013 | Camera config perms | `chmod 600 cameras-config.json` — ปิด world-readable | #69 · DECISIONS #191 |

### ⏳ Open Items (audit 2026-06-01)

| ID | หมวด | สถานะ | วิธีแก้ | Reference |
|---|---|---|---|---|
| SEC-014 | Camera cred at-rest | **✅ Done 2026-06-02** | AES-256-GCM (`enc:v1:` format); decrypt-at-load / encrypt-at-save; plaintext passthrough (tolerant deploy); `scripts/migrate-creds-encrypt.js` | DECISIONS #194 · GOTCHAS #71 |
| SEC-015 | Dead DB columns | **✅ Done 2026-06-02** | `DROP COLUMN cameras.http_password`, `cameras.rtsp_url` — migration 038; NULL verified (0 rows); dry-run passed; `cameras.http_user` still present (deferred) | GOTCHAS #70 · DECISIONS #193 |
| SEC-016 | Postgres SSL | **✅ Done 2026-06-02** | `ssl=on` (TLSv1.3) via `ALTER SYSTEM` + `pg_reload_conf()` (zero-downtime); self-signed cert in data volume; `scripts/postgres-ssl-setup.sh` (idempotent, run after fresh volume); local apps unbroken (`127.0.0.1 trust`); `hostssl` enforcement deferred until remote port opens | DECISIONS #195 · REF_third-party-integration.md §3.6 |
| SEC-017 | Mapbox token proxy | **✅ Done 2026-06-02** | `GET /api/map/tiles/mapbox/:style/:z/:x/:y.png` (auth-gated, cache-first); `/api/config` removes `mapboxToken` field (returns `mapboxAvailable` only); `dashboard.js` uses proxy URLs; zero direct `api.mapbox.com` tile requests from browser; CSP tightened | DECISIONS #197 · DECISIONS #60 |

## 📋 Quick Reference: SEC-2T-001 to SEC-2T-008 (CODEX 2nd Tier Audit, 2026-06-03)

> **ที่มา:** CODEX_AUDIT_2ndTier.md — 11 findings (1 High, 5 Medium, 5 Low); รีวิว 2026-06-03 (decisions #200–#202); fixes 2026-06-05

| ID | หมวด | สถานะ | Fix สรุป | Commit/Reference |
|---|---|---|---|---|
| SEC-2T-001 | CDN / origin isolation | ✅ Done | ลบ 4 ไฟล์ที่ embed EmailJS/Materialize CDN; auth-gate `/others` default-deny; boxbox HTML ลบแล้ว | `654f74d` · decisions #201–#202 |
| SEC-2T-002 | CSP inline scripts | ✅ Done 2026-06-05 | ลบ inline `onclick=` + `<script>` ทั้งหมดใน dashboard HTML (Pre-Phase-5 gate) — zero inline scripts | `93b1c22` · decisions #203–#207 |
| SEC-2T-003 | God-file modularity | Planned | `api-server.js` 6,600+ บรรทัด → modular monolith; S4 route split เริ่มแล้ว (`b8122a8`) | decisions #200 · ROADMAP.md |
| SEC-2T-004 | Error response leak | ✅ Done 2026-06-05 | `routeError()` helper — consistent `{error}` format; ป้องกัน stack trace เปิดเผย; wire ใน ~100 catch blocks | `63285f2` `f002669` |
| SEC-2T-005 | Role policy drift | ✅ Done 2026-06-05 | Enforce viewer-forbidden บน `GET /api/line-config` | `fdc50a4` |
| SEC-2T-006 | Plaintext cred warning | ✅ Done | `/api/health/details` warn เมื่อพบ camera credentials ยังไม่ถูกเข้ารหัส (`enc:v1:` missing) | `0a1e33d` |
| SEC-2T-007 | Dotfiles exposure | ✅ Done | `dotfiles: 'deny'` บน `express.static` ทุก mount — ปิด `.env`/`.git` ผ่าน static path | `c04ee5a` |
| SEC-2T-008 | /tiles/ public access | Won't Fix | `/tiles/` เป็น public static asset by design — documented non-issue | `458db17` |

## 📋 Quick Reference: SEC5 + LIVE (CODEX 5th security + 6th live pentest, 2026-07-21/22)

> **ที่มา:** `CODEX/CODEX_Audit_5th_part_security.md` (12 finding, static review) + `CODEX/CODEX_Audit_6th_live_pentest_summary.md` (9 finding — CODEX รันจริงกับ production ไม่ใช่แค่อ่าน source); re-verify ซ้ำกับโค้ด+ระบบจริง 2026-07-22 (decisions #221–#223)

| ID | หมวด | สถานะ | Fix สรุป | Reference |
|---|---|---|---|---|
| SEC5-HIGH-001 | `cameras-config.json` perm drift | ✅ Done | Central self-heal มีอยู่แล้ว; edge เพิ่ม `chmodSync(0o600)` ทุกครั้งที่เขียนไฟล์ | `6525a02` |
| SEC5-HIGH-002 / LIVE-HIGH-003 | Legacy public `POST /lpr` | ✅ Done | ตอบ `410 Gone` ทันที ไม่ parse body — ปิดด้วยหลักฐาน log 0 hit ตลอดประวัติทุกที่ | `82c5963` |
| SEC5-HIGH-003 | NanoMQ edge anonymous | ⚠️ Mitigated บางส่วน | Broker เอง**ยังเปิด**; guard เฉพาะ `_config/detect-model`/`delete-media` (คำสั่งอันตรายสุด) ด้วย shared secret แทน | `088fedf` · DECISIONS #222 |
| SEC5-HIGH-004 | EMQX central `no_match=allow` | ⏳ Prep แล้ว ยังไม่ flip | 8 user เพิ่ม ACL rule ครบ, cleanup orphan แล้ว — flip ผูกกับ multi-site rollout | DECISIONS #223 |
| SEC5-MED-001 / LIVE-MED-001 | `lpr-receiver` bind + body limit | ✅ Done (bind), body limit คงเดิม | Central bind `127.0.0.1` (ยืนยัน Cloudflare route ก่อนแคบ); body limit ไม่แตะ (เสี่ยง reject ไฟล์กล้องจริง) | `38aabb6` |
| SEC5-MED-002 | URL token rotation/log | ⏳ Deferred | Design gap ระยะยาว ไม่มี incident รองรับ | ROADMAP.md |
| SEC5-MED-003 | `edge/env.template` ผิด | ✅ Done | แก้ให้ copy `CAMERA_SECRET_KEY` จาก central แทน generate ใหม่ | `6525a02` |
| SEC5-MED-004 | `scan-nvr` credential in payload | ⏳ ยังไม่แก้ | scope โตขึ้น (`detect-model` ก็ส่ง credential แบบเดียวกัน) — ยังไม่ guard | — |
| SEC5-MED-005 | `INTERNAL_API_SECRET` fallback | ✅ Done | Fail-fast เมื่อ `NODE_ENV=production`; dev ยัง fallback ได้ | `2fc9a99` · DECISIONS #221 |
| SEC5-MED-006 | Multi-site RBAC regression test | ⏳ Deferred | แยกเป็นงาน test-coverage | ROADMAP.md |
| SEC5-LOW-001 | `.DS_Store` hygiene | ✅ Done | ลบ 6 ไฟล์ | `6525a02` |
| SEC5-LOW-002 | `/tiles/` public | Won't Fix | By design เหมือน SEC-2T-008 | — |
| LIVE-HIGH-001 | Receiver DoS (body parse ก่อน token check) | ✅ Done | Token pre-check gate ก่อน `express.raw()`; เจอ flood จริงกำลังยิงอยู่ระหว่างแก้ (~2 req/s ตั้งแต่ 2026-07-17) | `7fd4204` · DECISIONS #221 |
| LIVE-HIGH-002 | `multer` DoS advisory | ✅ Done | Upgrade 2.1.1→2.2.0 | `7fd4204` |
| LIVE-MED-002 | Unknown-token burst logging | ⏳ ยังไม่แก้ | Log ไม่มี source/rate detail | — |
| LIVE-MED-003 | cloudflared token ใน process args | ✅ Done | Rotate token แล้ว (หลุดเข้า session transcript ระหว่างตรวจ finding นี้เอง) | Cloudflare dashboard, ไม่มี commit |
| LIVE-MED-004 | `concurrently`/`shell-quote` advisory | ✅ Done (verified — แก้ไปแล้วก่อน audit เขียนเสร็จ) | `npm audit` สะอาดจาก `3995f29` | `3995f29` |
| LIVE-LOW-001 | `X-Powered-By` header | ✅ Done | `app.disable('x-powered-by')` ใน `lpr-receiver.js` | `7fd4204` |
| LIVE-PASS-001 | Core auth boundary | ✅ Pass (ไม่ต้องแก้) | `/api`, static, snapshots, media, WS, CORS ผ่าน probe จริงหมด | — |
| — | `sharp` CVE (พบใหม่ระหว่าง multer upgrade) | ⏳ Deferred | Severity high, libvips CVE — ต้อง verify cycle แยกกับ `report-renderer.js` (decision #148) ก่อนอัป | `088fedf` (พบ ไม่ได้แก้) |
| — | `CAMERA_SECRET_KEY` transcript exposure | ⏳ Deferred (script พร้อม) | ประเมิน severity ต่ำกว่า cloudflared token — migration script พร้อมใช้ `scripts/rotate-camera-secret-key.js` | DECISIONS #223 |

รายละเอียดเต็มต่อ finding → `CODEX/CODEX_Audit_5th_part_security.md` §7 และ `CODEX/CODEX_Audit_6th_live_pentest_summary.md` §9 (verification log)

---

<sub>REF_security-checklist.md · Vigil Platform v1.5.3 · Created 2026-05-28 · Updated 2026-07-22</sub>
