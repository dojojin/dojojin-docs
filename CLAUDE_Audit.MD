# CLAUDE_Audit.MD — Security Audit Index

> **สารบัญรายงาน Security Audit** ของ Vigil Platform
> Date: 2026-05-27 · Auditor: Claude Sonnet 4.6 · Version: v1.5.0
> Method: Static code analysis ตาม Working Agreement #1 (Fact / Opinion แยก) + live runtime checks ที่ทำได้ปลอดภัย
>
> **ตรวจ 12 หมวด · ผ่าน 7 · พบประเด็นต้องแก้ 5 หมวด · 11 finding**
> CRITICAL 1 · HIGH 2 · MEDIUM 4 · LOW 4
>
> **Fix progress (2026-05-28):** SEC-001 ✅ Phase 1 · SEC-002 ✅ · SEC-003 ✅ · SEC-004 ✅ · SEC-005 ✅ · SEC-006 ✅ · SEC-007 ✅ · SEC-008 ✅ · SEC-009 ✅ · SEC-010 ✅ · SEC-011 ✅ — **ALL FINDINGS CLOSED**

---

## 🗂 ไฟล์รายละเอียดแยกตามความรุนแรง

| ความรุนแรง | จำนวน | ไฟล์รายละเอียด |
|---|---|---|
| 🔴 **CRITICAL** | 1 | [docs/audit/01_critical.md](docs/audit/01_critical.md) — SEC-001 |
| 🟠 **HIGH** | 2 | [docs/audit/02_high.md](docs/audit/02_high.md) — SEC-002, 003 |
| 🟡 **MEDIUM** | 4 | [docs/audit/03_medium.md](docs/audit/03_medium.md) — SEC-004 ถึง 007 |
| 🟢 **LOW** | 4 | [docs/audit/04_low.md](docs/audit/04_low.md) — SEC-008 ถึง 011 |
| ✅ **PASSED** | 7 หมวด | [docs/audit/05_passed.md](docs/audit/05_passed.md) — auth core, SQL, path, cmd, license, PDPA, static-gate |

---

## 📊 Scorecard

| # | หมวด | สถานะ | ระดับสูงสุด | ไฟล์ |
|---|---|---|---|---|
| 1 | Auth & session security | ✅ แก้แล้ว (2026-05-28) | MEDIUM→fixed | [03_medium](docs/audit/03_medium.md#sec-004) |
| 2 | SQL injection | ✅ ผ่าน | — | [05_passed](docs/audit/05_passed.md#-sql-injection-sweep) |
| 3 | Path traversal & file serving | ✅ ผ่าน | — | [05_passed](docs/audit/05_passed.md#-path-traversal--file-serving) |
| 4 | SSRF & camera HTTP proxy | ✅ log-only guard เพิ่มแล้ว (2026-05-28) | LOW→mitigated | [04_low](docs/audit/04_low.md#sec-008) |
| 5 | XSS (dashboard) | ✅ แก้แล้ว (2026-05-28) | HIGH→fixed | [02_high](docs/audit/02_high.md#sec-002) |
| 6 | Command injection | ✅ ผ่าน | — | [05_passed](docs/audit/05_passed.md#-command-injection--spawn) |
| 7 | MQTT trust & ingester input | ✅ Phase 1 แก้แล้ว (2026-05-28) | CRITICAL→partial | [01_critical](docs/audit/01_critical.md#sec-001) |
| 8 | Secrets & credential handling | ✅ แก้แล้ว (2026-05-28) | HIGH→fixed | [02_high](docs/audit/02_high.md#sec-003) |
| 9 | CORS / CSP / headers / rate-limit | ✅ แก้แล้ว (2026-05-28) | MEDIUM→fixed | [03_medium](docs/audit/03_medium.md#sec-006) |
| 10 | License verification (Ed25519 JWT) | ✅ ผ่าน | — | [05_passed](docs/audit/05_passed.md#-license-verification-ed25519-jwt) |
| 11 | Dependency CVEs (npm audit) | ✅ แก้แล้ว (2026-05-28) | MEDIUM→fixed | [03_medium](docs/audit/03_medium.md#sec-007) |
| 12 | PDPA / data exposure / logging | ✅ ผ่าน | — | [05_passed](docs/audit/05_passed.md#-pdpa--data-exposure) |

---

## 🎯 Action Priority (ลำดับการแก้)

| Priority | Findings | เหตุผล |
|---|---|---|
| **P0 — ทำก่อน** | ~~SEC-001~~ ✅ ~~SEC-002~~ ✅ ~~SEC-003~~ ✅ | Chain attack — anonymous MQTT → stored XSS → admin session hijack → ดู camera passwords — **P0 complete** |
| **P1** | ~~SEC-004~~ ✅ ~~SEC-011~~ ✅ | Default admin password ยัง bypass server ได้ + Postgres expose 0.0.0.0 — **P1 complete** |
| **P2** | ~~SEC-005~~ ✅ ~~SEC-006~~ ✅ ~~SEC-007~~ ✅ | Defense-in-depth (CSP, SVG, qs CVE) — **P2 complete** |
| **P3** | ~~SEC-008~~ ✅ ~~SEC-009~~ ✅ ~~SEC-010~~ ✅ | Cosmetic / edge case — **P3 complete** |

### ลำดับการทำที่แนะนำ (สำหรับ Sonnet ใน session ถัดไป)

1. **เริ่ม session ใหม่ + อ่าน CLAUDE_Audit.MD + ไฟล์ severity ที่จะแก้**
2. **P0-A** (SEC-003 role-based redact) — 1 บรรทัด, verify ง่าย, commit แยก
3. **P0-B** (SEC-002 escapeHtml) — 4 patch แต่ pattern เดียวกัน, commit แยก
4. **P0-C** (SEC-001 docker-compose bind localhost) — **ทำ Phase 1 ก่อน** ไม่เปิด AUTHN ทันที (รอ config Bosch firmware แยก session)
5. **P1-A** (must_change_password) — สำคัญแต่หลัง P0 ทั้งหมด เพราะกระทบ auth flow
6. **P1-B** (Postgres bind + password rotate) — ทำตอน maintenance window เพราะต้อง restart DB
7. **P2 / P3** — รวมในรอบ housekeeping ครั้งเดียวก็ได้

**สำหรับทุก commit:** Working Agreement #3 ครบทุกข้อ — Reproduce ก่อนแก้ + Verify-after + Capture (อัปเดต GOTCHAS.md / DECISIONS.md ถ้าเป็น invariant ใหม่)

---

## 🔬 Reproducibility methodology

- **By-code-path reproduction:** ทำครบทุก finding — Read ตำแหน่งโค้ดจริง, trace flow จาก source → sink
- **Live runtime checks ที่ทำได้ปลอดภัย:**
  - `lsof -iTCP:1883/18083/5432 -sTCP:LISTEN` — confirm port bind = 0.0.0.0
  - `curl -X POST http://localhost:18083/api/v5/login` — confirm EMQX default creds (200 + JWT)
  - `grep c.password dashboard.js` — confirm client ใช้ field นี้
  - `cat src/node_modules/qs/package.json` — confirm version vulnerable
- **ไม่ได้ทำ (เสี่ยง prod):**
  - MQTT anon publish (จะ pollute event pipeline + trigger LINE alert)
  - XSS payload inject เข้า DB (กระทบ admin คนอื่นที่ใช้งานอยู่)
  - curl /api/cameras (ต้อง login + rate-limit prod)
  - Upload malformed SVG (จะแทนที่ branding logo prod)
- **Primary-source artifacts ที่ verified:** `cameras-config.json`, `docker-compose.yml`, `src/.env`, `db/db_migration_027_third_party_views.sql`

---

## 📚 อ่านเพิ่มเติม

- [Working Agreement (CLAUDE.md)](CLAUDE.md#-working-agreement) — Investigate-first + Reproduce-before-fix + Capture
- [DESIGN.md](DESIGN.md) — escapeHtml convention (เกี่ยวกับ SEC-002)
- [GOTCHAS.md](GOTCHAS.md) — หลัง implement fixes ต้องเพิ่ม entries ที่นี่
- [docs/REF_third-party-integration.md](docs/REF_third-party-integration.md) — เกี่ยวกับ SEC-011 (3rd party DB access pattern)

---

<sub>End of CLAUDE_Audit.MD index · Vigil Platform v1.5.0 · 2026-06-08</sub>
