# TotalSummaryAudit — Vigil Platform

> **รวม Security / System Audit ทุกครั้งตั้งแต่เริ่มโปรเจกต์ → 2026-06-10** (v1.5.0 → v1.5.3)
> แหล่งข้อมูล: `CLAUDE_Audit.MD` + `docs/audit/01-05` · `docs/REF_security-checklist.md` ·
> `CODEX_AUDIT_2ndTier.md` · `CODEX_AUDIT_3rdTier.md` · `CHANGELOG.md` (CVE audit rounds) ·
> `AuditSummary_2026.06.10.md` · GOTCHAS #25, #36-#38, #50-#59, #69-#71, #82-#84
> Updated: 2026-06-10

---

## 1. Timeline การ Audit ทั้งหมด

| รอบ | วันที่ | Auditor | Scope | ผล |
|---|---|---|---|---|
| 1. Security Audit ครั้งแรก | 2026-05-27/28 | Claude Sonnet 4.6 | Static + runtime, 12 หมวด | 11 findings (SEC-001–011): 1 CRITICAL, 2 HIGH, 4 MEDIUM, 4 LOW — **ปิดครบใน 1 วัน** |
| 2. Follow-up (secrets sprawl + at-rest) | 2026-05-28 → 06-02 | Claude | Secrets inventory + camera creds | SEC-012–017 — **ปิดครบ 2026-06-02** |
| 3. CODEX 2nd Tier | 2026-06-03/05 | Codex (GPT) | Cross-check หลังรอบ 1-2 | SEC-2T-001–008 (1 High, 5 Med, 5 Low) — ปิด/ตัดสินใจครบ verified 2026-06-06 |
| 4. CVE / Dependency Audit round 4 | 2026-06-07 | Claude | npm audit + runtime stack EOL | **0 vulnerabilities** + อัป Node 22, EMQX 5.8.9 pinned, pg/ws/puppeteer |
| 5. CODEX 3rd Tier | 2026-06-07 | Codex | Security + Perf + Sustainability หลัง remediation | SEC-3T-001–007 + 3 positive controls — ส่วนใหญ่ accepted/deferred/guarded |
| 6. System Audit ×2 + Incident | 2026-06-09/10 | Claude (Sonnet → Fable 5) | ทั้งระบบ + incident response | A1–A7, S-NEW1-2, B-NEW1-3, GOTCHAS #84 — **ปิดครบ** (ดู `AuditSummary_2026.06.10.md`) |

---

## 2. รอบ 1 — SEC-001 ถึง SEC-013 (2026-05-27/28) — ✅ ปิดครบ

| ID | ระดับ | ปัญหา | การแก้ไข |
|---|---|---|---|
| SEC-001 | 🔴 CRITICAL | MQTT broker เปิด anonymous + bind ทุก interface → chain: anonymous publish → stored XSS → session hijack | Phase 1: bind `127.0.0.1:1883` + rotate password; Phase 2 (06-07): เปิด `1883:1883` คืนโดยบังคับ EMQX AUTHN bcrypt ทุก client |
| SEC-002 | 🟠 HIGH | Stored XSS — MQTT/DB field ลง innerHTML ตรง | `escapeHtml()` ทุก field + `encodeURIComponent()` ทุก URL path |
| SEC-003 | 🟠 HIGH | Camera credentials รั่วใน GET response ให้ non-admin | Redact password เมื่อ role ≠ admin |
| SEC-004 | 🟡 MEDIUM | `must_change_password` bypass ได้ฝั่ง server | Enforce ที่ `requireAuth` middleware + path allowlist |
| SEC-005 | 🟡 MEDIUM | File upload เช็คแค่ MIME type | Magic bytes check (PNG/JPEG/WebP/GIF) + ห้าม SVG (librsvg CVE) |
| SEC-006 | 🟡 MEDIUM | ไม่มี CSP / HSTS | CSP (Report-Only → enforce) + HSTS conditional |
| SEC-007 | 🟡 MEDIUM | `qs` dependency CVE | Upgrade qs ≥ 6.13.1 |
| SEC-008 | 🟢 LOW | SSRF ผ่าน snapshot probe endpoint | `_isPrivateIp()` audit-log guard (non-blocking — on-prem ต้อง probe LAN ได้) |
| SEC-009 | 🟢 LOW | `.env` มีบรรทัด paste ผิด | แก้ไฟล์ |
| SEC-010 | 🟢 LOW | Cookie flags login/logout ไม่ตรงกัน | Flag builder เดียวกัน (Secure-on-HTTPS, SameSite=Lax, HttpOnly) |
| SEC-011 | 🟢 LOW | Postgres expose 0.0.0.0 | `127.0.0.1:5432` + rotate password |
| SEC-012 | follow-up | Secrets sprawl — audit แบบ code-path พลาด `src/.env` | Secrets Inventory checklist + pre-commit hook scan token signatures (DECISIONS #170) |
| SEC-013 | follow-up | `cameras-config.json` world-readable | `chmod 600` (GOTCHAS #69) |

**หมวดที่ตรวจผ่านตั้งแต่รอบแรก:** SQL injection (parameterized ทั้งหมด) · Path traversal · Command injection (`execFile`/spawn array, ไม่มี shell string) · License Ed25519 JWT · PDPA/logging · Static auth-gate

## 3. รอบ 2 — SEC-014 ถึง SEC-017 (ปิด 2026-06-02) — ✅ ปิดครบ

| ID | ปัญหา | การแก้ไข |
|---|---|---|
| SEC-014 | Camera credentials plaintext at-rest | **AES-256-GCM** (`enc:v1:`) decrypt-at-load/encrypt-at-save + migration script (DECISIONS #194) |
| SEC-015 | Dead columns เก็บ credentials (`http_password`, `rtsp_url`) | `DROP COLUMN` migration 038 (verify NULL ก่อน) |
| SEC-016 | Postgres ไม่มี TLS | `ssl=on` TLSv1.3 zero-downtime + setup script; `hostssl` enforcement deferred จนกว่าจะเปิด remote port |
| SEC-017 | Mapbox token หลุดถึง browser | Tile proxy auth-gated (`/api/map/tiles/...`); `/api/config` ส่งแค่ `mapboxAvailable` |

## 4. รอบ 3 — CODEX 2nd Tier: SEC-2T-001 ถึง 008 (2026-06-03/05) — ✅ ปิด/ตัดสินใจครบ

| ID | ระดับ | ปัญหา | ผลลัพธ์ |
|---|---|---|---|
| SEC-2T-001 | High | หน้า embed CDN (EmailJS/Materialize) + `/others` public | ลบ 4 ไฟล์ + auth-gate `/others` default-deny (`654f74d`) |
| SEC-2T-002 | Med | Inline `onclick=`/`<script>` ขวาง CSP จริง | ลบ inline ทั้งหมด — zero inline scripts (`93b1c22`) |
| SEC-2T-003 | Med | `api-server.js` god-file 6,600+ บรรทัด | Planned — S4 route split เริ่มแล้ว (`b8122a8`) |
| SEC-2T-004 | Med | Error response รั่ว stack trace | `routeError()` helper ครอบ ~100 catch blocks (`63285f2`, `f002669`) |
| SEC-2T-005 | Med | Role drift — viewer อ่าน `/api/line-config` ได้ | Enforce role policy (`fdc50a4`) |
| SEC-2T-006 | Low | ไม่รู้ว่า creds ตัวไหนยังไม่เข้ารหัส | Health warn เมื่อพบ camera ไม่มี `enc:v1:` (`0a1e33d`) |
| SEC-2T-007 | Low | `express.static` เสิร์ฟ dotfiles ได้ | `dotfiles: 'deny'` ทุก mount (`c04ee5a`) |
| SEC-2T-008 | Low | `/tiles/` public | **Won't fix** — public by design, documented (`458db17`) |

## 5. CVE / Dependency Audits (4 รอบ, ล่าสุด 2026-06-07 + runtime 2026-06-10)

| CVE / EOL | Component | การแก้ไข | เมื่อ |
|---|---|---|---|
| qs prototype-pollution class | `qs` < 6.13.1 | upgrade ≥ 6.13.1 (SEC-007) | 05-28 |
| **CVE-2024-37890** (DoS) | `ws` 8.20.1 | upgrade → 8.21.0 | 06-07 |
| Node 20 EOL (2026-04-30) | Node.js runtime | 20 → **22 LTS** (06-07) → **24 LTS v24.16.0 ทุก worker** (`ee29c82`) | 06-07 → **06-10** |
| Floating image tag | EMQX `5.8` | pin `5.8.9` ใน docker-compose | 06-07 |
| Chrome security rollup | Puppeteer 24 / Chrome 148 | → Puppeteer 25.1.0 / Chrome 149 | 06-07 |
| librsvg CVE class | SVG upload | ห้ามรับ SVG upload + `_svgSafeText()` strip (GOTCHAS #25a) | 05-26/28 |
| `pg` maintenance | pg 8.20 | → 8.21.0 | 06-07 |
| **สถานะปัจจุบัน** | `npm audit` (prod deps) | **0 vulnerabilities** (ตรวจซ้ำ 2026-06-10) | 06-10 |

## 6. รอบ 5 — CODEX 3rd Tier: SEC-3T (2026-06-07) — สถานะปัจจุบัน

| ID | ระดับ | ประเด็น | สถานะ |
|---|---|---|---|
| SEC-3T-001 | High | Dashboard โหลด third-party JS (cdn.jsdelivr) ขณะ bearer token อยู่ใน browser storage — supply-chain risk | **✅ Done 2026-06-10** — OL/Chart.js/adapter vendored เข้า `dashboard/vendor/` + ลบ jsdelivr ออกจาก CSP ทั้งสอง block |
| SEC-3T-002 | Med | EMQX 1883 bind ทุก interface | **Accepted/Guarded** — by design (กล้องหลาย LAN), AUTHN bcrypt บังคับ |
| SEC-3T-003 | Med | `/tiles/` public เปิดเผยโครงสร้าง map | **Accepted** — ตาม SEC-2T-008 |
| SEC-3T-004 | Med | Internal token bypass = high-trust path | **Guarded** — timingSafeEqual + env secret (`1b2dc94`) |
| SEC-3T-005 | Med-Low | CSP ยังอนุญาต jsdelivr ใน `/others` + inline styles | **✅ Done 2026-06-10** — jsdelivr ออกหมด + inline `<style>` ทุก block extract เป็นไฟล์ + `style-src-elem 'self'` enforce (attr คงไว้โดยตั้งใจ — 790 จุดใน JS templates) |
| SEC-3T-006 | Med-Low | Camera cred encryption มี plaintext fallback เมื่อไม่มี `CAMERA_SECRET_KEY` | **Deferred/Guarded** — tolerant deploy by design + health warn (SEC-2T-006) |
| SEC-3T-007 | Low | Bearer session 7 วัน | **Deferred** — UX trade-off, มี revoke + audit log |
| SEC-3T-P01–P03 | Positive | Auth-gated static/media · admin ops ใช้ allowlist+`execFile` · branding upload ครบ (role/size/MIME/magic/sharp normalize) | บันทึกเป็น positive controls |

## 7. รอบ 6 — System Audit ×2 + Incident (2026-06-09/10) — ✅ ปิดครบ

> รายละเอียดเต็ม: `AuditSummary_2026.06.10.md` · commits `bbdd1b2` → `a909c04`

| ID | ระดับ | ปัญหา | การแก้ไข |
|---|---|---|---|
| GOTCHAS #84 | 🔴 | **Incident**: clip recording ล่มเงียบ 17 ชม. — macOS Local Network Privacy บล็อก binary ไร้ record (ffmpeg/node@22) จาก camera subnet; วินิจฉัยเดิม #82/#83 ผิด/ไม่ครบ | `VigilPM2.app` ถือ LN grant ให้ทั้ง PM2 tree (พิสูจน์เทียบ control) + boot path ผ่าน plist + Terminal fallback + `brew pin` |
| S-NEW1 | 🔴 | api-server bind `0.0.0.0:3000` — LAN ยิง API ข้าม Cloudflare Access | bind `127.0.0.1` + `BIND_HOST` override (`8d3c65a`) |
| B-NEW2 | 🔴 | RTSP password plaintext ใน log หลายหมื่นบรรทัด + ไฟล์ rotated ค้าง | `redactCreds()` + purge log เก่า — scan ซ้ำ = 0 ไฟล์มี creds |
| A6+A1 | 🟠 | node@20 EOL + interpreter drift + mqtt-subscriber latent camera HTTP | **node@24 LTS ทุก 7 apps** ผ่าน `base.interpreter` + repro 2 ชั้น (`ee29c82`) |
| A4 | 🟠 | Backup อยู่ disk เดียวกับ DB + Time Machine พัง | Offsite → Google Drive ผ่าน **rclone crypt** (client-side encrypt, scope drive.file, retention 30 วัน) + round-trip verify + รหัสใน 1Password (`60a0a70`) |
| S-NEW2 | 🟠 | `.env` perms 644 | `chmod 600` |
| B-NEW1 | 🟠 | Recorder spawn ffmpeg ให้กล้อง disabled → crash-loop | `enabled = TRUE` filter |
| B-NEW3 | 🟠 | ffmpeg restart ไม่มี backoff → log flood 72k บรรทัด | Exponential backoff 5s→60s |
| A2 | 🟠 | ไม่มี log rotation | pm2-logrotate 10M/14/compress |
| — | 🟠 | ไม่มี detection เมื่อ recorder wedge | `media_buffer[].newest_segment_sec` ใน `/api/health/details` |
| A5 | 🟡 | Error log บรรทัดว่าง | fallback `err.message \|\| err.code \|\| err` |
| A3 | 🟠 | Disk 93% | purge ข้อมูล พ.ค. ตามคำสั่ง owner (~13GB) → ว่าง 58GB |
| — | 🟡 | RTSP creds ใน `ps` args | **Accepted risk** — single-user machine, documented |

## 8. OWASP Top 10 (2021) Mapping

| OWASP | Findings ที่เกี่ยว | สถานะรวม |
|---|---|---|
| A01 Broken Access Control | SEC-003, SEC-004, SEC-2T-001, SEC-2T-005, SEC-2T-007, S-NEW1 | ✅ ปิดครบ |
| A02 Cryptographic Failures | SEC-013, SEC-014, SEC-015, SEC-016, S-NEW2, B-NEW2, A4 (backup crypt) | ✅ ปิดครบ (PG `hostssl` deferred จนเปิด remote) |
| A03 Injection (XSS/SQL/Cmd) | SEC-002 (stored XSS) · SQL = parameterized ผ่าน · Command = `execFile` ผ่าน | ✅ ปิดครบ |
| A04 Insecure Design | SEC-2T-003 god-file (S4 split เริ่มแล้ว) · watchdog crash-loop ถูกถอนก่อน ship | 🔶 in progress (planned) |
| A05 Security Misconfiguration | SEC-001, SEC-006, SEC-009, SEC-011, SEC-2T-002, docker port wildcard (GOTCHAS #57), SEC-3T-005 (CSP) | ✅ ปิดครบ |
| A06 Vulnerable & Outdated Components | SEC-007 qs · CVE-2024-37890 ws · Node EOL 20→22→24 · EMQX pin · Puppeteer/Chrome · librsvg SVG ban · npm audit = 0 | ✅ current |
| A07 Identification & Auth Failures | Triple-layer auth (Safari ITP) · bcrypt + lockout · HMAC-signed session · SEC-010 cookie flags · SEC-3T-007 (7-day session, deferred) | ✅ แข็งแรง |
| A08 Software & Data Integrity | Pre-commit secret-scan hook (#170) · `brew pin` · SEC-3T-001 third-party CDN JS **✅ vendored 2026-06-10** | ✅ ปิดครบ |
| A09 Logging & Monitoring Failures | audit_log ครบ · A5 blank errors · B-NEW2 secrets-in-logs · A2 rotation · media_buffer detection · SEC-2T-004 error format | ✅ ปิดครบ |
| A10 SSRF | SEC-008 — `_isPrivateIp()` log guard (blocking พร้อมเปิดสำหรับ cloud SKU) | ✅ mitigated ตาม deployment model |

## 9. ภาพรวมสถานะปัจจุบัน (2026-06-10)

**ปิดแล้วสะสม:** SEC-001–017 (17) · SEC-2T ทั้งหมด (8 — 1 won't-fix documented) · CVE 4 รอบ (npm audit 0) · System audit A1–A7 + S-NEW + B-NEW + incident (13) = **45+ findings closed**

**ที่ยังเปิด/ตามแผน:**

| รายการ | สถานะ | แผน |
|---|---|---|
| ~~SEC-3T-001 + 3T-005~~ | ✅ done 2026-06-10 | vendored JS + style-src-elem enforce |
| SEC-2T-003 — god-file split | In progress | S4 route split ต่อเนื่อง |
| SEC-3T-006/007 — cred plaintext fallback / session 7 วัน | Deferred | ตาม deployment จริง |
| PG `hostssl` enforcement | Deferred | เมื่อเปิด remote DB port |
| VigilPM2.app grant หลัง reboot จริง | เช็คครั้งเดียว | reboot ถัดไป |
| Time Machine destination (Code 17) | ฝั่ง owner | — |

---

<sub>TotalSummaryAudit · Vigil Platform v1.5.3 · 2026-06-10 · companions: CLAUDE_Audit.MD, CODEX_AUDIT_2ndTier.md, CODEX_AUDIT_3rdTier.md, AuditSummary_2026.06.10.md, docs/REF_security-checklist.md</sub>
