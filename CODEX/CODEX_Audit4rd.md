# CODEX_Audit4rd.md — Full-System Audit Round 4

Audit date: 2026-06-16 (Asia/Bangkok workspace date)
Auditor: Codex
Repository: `vigil-platform`

## Scope

Audit รอบนี้ตรวจแบบ full-system จาก repository, runtime wrappers, Docker/PM2 config, security posture, dependency health, route/auth boundaries, frontend static surface, migration/backup posture, docs handoff, และ test coverage.

ข้อจำกัดโดยตั้งใจ:

- ไม่เปิดเผยค่าใน `.env`, camera credentials, LINE token, imgbb key, license key, customer data, snapshots, media, หรือข้อมูลระบุตัวบุคคล
- ไม่แก้ production behavior ในรอบ audit นี้
- ไม่ทดสอบ Docker runtime state แบบเต็ม เพราะ `docker compose ps` ติด permission ที่ Docker socket

## Executive Summary

**Fact**

- ไม่พบ Critical/High security issue ใหม่ใน tracked code จาก static audit รอบนี้
- Risk สูงจาก audit ก่อนหน้าเรื่อง CDN/inline script ใน `/others` และ dashboard CSP ถูกปิดแล้ว: `/others` ใช้ `script-src 'self'`; dashboard อนุญาตเฉพาะ self + Cloudflare Insights ตาม config ปัจจุบัน
- `npm audit --omit=dev` ใน `src/` ผ่าน: `found 0 vulnerabilities`
- JS syntax check ทั้ง `src`, `dashboard`, `scripts`, `test`, `public` ผ่านทั้งหมด
- Unit tests ผ่าน: 43 tests, 0 failed
- PM2 status เห็น service หลัก 7 ตัว online: `api-server`, `mqtt-subscriber`, `media-recorder`, `hikvision`, `dahua`, `alert-worker`, `report-worker`
- Worktree clean ก่อนเริ่ม audit และไม่มี tracked secret file ชัดเจน

**Opinion**

- ระบบแข็งแรงขึ้นกว่ารอบก่อนชัดเจน โดยเฉพาะ origin isolation, PM2 runtime, route split, CSP, dependency hygiene, และ worker separation
- สิ่งที่ยังควรจัดต่อคือ guard/observability และ coverage มากกว่าการแก้ bug ใหญ่: integration smoke tests, health endpoint performance guard, backup temp-secret cleanup, และ UI/i18n/design debt
- Audit รอบก่อนยังไม่ได้ “ปิดหมด” 100%: รายการระดับ security หลักปิดแล้ว แต่ operational debt และ test/observability debt ยังเหลือ

## Prior Audit Closure Status

| Prior area | Status | Evidence / note |
|---|---:|---|
| CDN/static origin risk | Closed | `/others` CSP strict, removed high-risk public legacy pages per `ROADMAP.md`, scan ไม่พบ live CDN script ใน dashboard/public docs path สำคัญ |
| Dashboard CSP hardening | Closed | `src/api-server.js` ตั้ง dashboard CSP; no jsdelivr/CDN allowlist ยกเว้น Cloudflare Insights |
| Route module split | Closed | `ARCHITECTURE.md` ระบุ `src/routes/` 19 files; `api-server.js` เหลือ 1,893 lines |
| PM2 production runtime | Closed | `ecosystem.config.js` + `scripts/services.sh`; `npm run start:all` ไม่ใช่ supervisor ตาม decision #199 |
| Dependency audit / package lock | Closed | `src/package-lock.json` present; `npm audit --omit=dev` = 0 vulnerabilities |
| Tracked secret hygiene | Mostly closed | secret scan เจอ env var names/placeholders เท่านั้น; `.env` และ `src/.env` ignored |
| Runtime Docker status | Not fully validated | `docker compose config --quiet` ผ่าน, แต่ `docker compose ps` ติด Docker socket permission |
| Integration smoke coverage | Open | tests มี 43 unit tests แต่ยังไม่มี smoke สำหรับ auth/CSP/static/media/routes/migrations/workers |
| Health endpoint heavy diagnostics | Open | `/api/health/details` ยังทำ live directory size + PM2 jlist + worker probes ต่อ request |
| `.DS_Store` hygiene | Reopened low | พบ `.DS_Store` ignored ใน workspace; ไม่ tracked แต่สวนกับ cleanup item เดิม |

## Round 4 Findings

### AUD4-MED-001 — Integration Smoke Tests ยังบาง

**Fact**

- `node --test test/*.test.js` ผ่าน 43 tests
- Test set ปัจจุบันยังเป็น unit-level เป็นหลัก
- ไม่พบ smoke test ที่ครอบคลุม route auth matrix, CSP header, protected static media/snapshots, Docker migration boot path, worker health, report-worker proxy, หรือ LINE webhook signature path แบบ end-to-end

**Impact**

Regression ที่กระทบ production boundary อาจหลุดได้แม้ unit test ผ่าน เช่น route เผลอ public, CSP drift, media auth หลุด, worker proxy 503 handling เปลี่ยน, หรือ migration boot fail

**Recommendation**

เพิ่ม smoke suite ขนาดเล็กที่รัน local ได้โดยใช้ temp session/admin token:

- auth matrix: public/login/disclaimer/branding vs protected `/api/*`, `/snapshots/*`, `/media/*`
- CSP: `/`, `/others/*`, dashboard assets
- worker health: `/api/health/details` response shape + service process list
- migrations: dry-run หรือ test DB boot path
- report-worker proxy: on-demand schedule endpoint fallback behavior

### AUD4-MED-002 — `/api/health/details` ยังเป็น endpoint หนักต่อ request

**Fact**

- `src/routes/health.js` ยังรวบรวม live data หลายชั้นใน request path: DB checks, directory size, worker health, PM2 JSON, storage metrics, camera status, report data
- Decision เก่า #43 ระบุ health endpoint hits DB once/request; ปัจจุบันความรับผิดชอบ health ขยายมากกว่า DB check แล้ว
- ยังไม่เห็น cache TTL, timeout budget ต่อ section, หรือ duration metric ต่อ sub-check ใน route นี้

**Impact**

หน้า Health หรือ auto-refresh หลาย client อาจสร้าง I/O pressure โดยไม่ตั้งใจ โดยเฉพาะ snapshots/media directory ใหญ่ขึ้น, PM2 ช้า, หรือ worker endpoint ค้าง

**Recommendation**

เพิ่ม non-breaking guard ก่อน:

- cache 5-15 วินาทีสำหรับ expensive sections
- per-section timeout + degraded status
- log duration warning เมื่อ section เกิน threshold
- metric ใน response เช่น `diagnostics_ms` เพื่อเห็น regression

### AUD4-MED-003 — Backup script สร้าง config bundle ที่มี secret แบบ transient

**Fact**

- `scripts/backup.sh` ทำ local dump และ offsite upload ผ่าน `rclone` crypt remote
- Config bundle รวมไฟล์สำคัญ เช่น `.env`, camera config, branding, license/plist artifacts แล้ว upload ไป crypt remote
- หลัง upload script `rm -f "$BUNDLE"` แต่ถ้า process ถูก interrupt ระหว่าง tar/upload อาจเหลือ tarball ที่มี secret ใน `backups/`

**Impact**

ไม่ใช่ tracked leak และ offsite ถูกเข้ารหัสแล้ว แต่ local interrupted bundle เป็น secret-at-rest เพิ่มเติมที่ควรลด window

**Recommendation**

- สร้าง bundle ใน temp dir ที่ permission 700
- ใช้ `trap cleanup EXIT INT TERM`
- ตั้ง `umask 077` รอบ bundle
- validate ว่า `backups/config-snapshot_*.tar.gz` ไม่ค้างหลัง backup

### AUD4-MED-004 — EMQX `1883` bind all interfaces เป็น accepted risk ที่ต้อง verify เป็น deployment guard

**Fact**

- `docker-compose.yml` bind MQTT `1883:1883` all interfaces
- Decision #152 Phase 3 / #160 ยอมรับ exception นี้เมื่อ EMQX AUTHN enforced
- EMQX dashboard bind localhost-only
- `docker compose config --quiet` ผ่าน

**Impact**

Security boundary ของ MQTT อยู่ที่ EMQX authentication + network firewall ไม่ใช่ localhost bind ถ้า config drift ทำให้ anonymous publish กลับมา จะย้อนรอย incident SEC-001 ได้

**Recommendation**

- เพิ่ม deployment smoke: anonymous publish ต้อง fail, per-camera auth ต้อง pass
- เพิ่ม config assertion ใน health/admin diagnostics ว่า EMQX authn enabled
- document firewall/LAN expectation ต่อ deployment

### AUD4-MED-005 — `INTERNAL_API_SECRET` fallback behavior ควร fail-fast ใน production

**Fact**

- `api-server.js` มี fallback random internal secret เมื่อ env missing/too short พร้อม warning
- `report-worker.js` ต้องใช้ `INTERNAL_API_SECRET` สำหรับ internal calls
- Fallback random ช่วย dev boot ได้ แต่ production misconfig อาจทำให้ internal worker path แตกแบบ runtime

**Impact**

Misconfigured production อาจไม่ล้มตั้งแต่ boot แต่ scheduled/on-demand internal report path fail ภายหลัง

**Recommendation**

- เพิ่ม production-mode fail-fast เมื่อ `NODE_ENV=production` และ secret missing/too short
- หรือเพิ่ม health check warning ที่เห็นชัดสำหรับ internal-token mismatch/missing

### AUD4-LOW-001 — `.DS_Store` กลับมาใน workspace แม้ ignored

**Fact**

- พบ `./.DS_Store`
- `git check-ignore -v` ยืนยันว่า ignored
- ไม่ใช่ tracked file และไม่ใช่ leak ใน repo

**Impact**

Hygiene debt เล็ก แต่สวนกับ roadmap item ที่เคย cleanup `.DS_Store`

**Recommendation**

ลบไฟล์ local นี้และเพิ่ม periodic hygiene check ใน audit script ถ้ามี

### AUD4-LOW-002 — UI/i18n/design debt ยังเหลือหลัง frontend split

**Fact**

- Scan พบ hardcoded Thai/English strings และ emoji UI ใน `dashboard/index.html` และหลาย `dashboard/page-*.js`
- หลายรายการเป็น legacy/grandfathered ตาม `CLAUDE.md` และ `DESIGN.md`
- พบ dynamic text ที่ยังควรย้ายเข้า `I18N.t()` เช่น `All categories`, `No rule firings in this window`, error text บางจุด
- Scan hardcoded colors พบหลายจุดใน dashboard pages, report templates, public docs, และ report renderer; บางส่วนเป็น report/static docs path ที่มีข้อยกเว้นหรือเป็น legacy

**Impact**

ไม่ใช่ security issue แต่เพิ่ม drift จาก decision #128, #144, #145 และทำให้ white-label/i18n consistency ลดลง

**Recommendation**

ทำ opportunistic cleanup เมื่อแตะ page นั้น:

- ย้าย dynamic string เข้า `dashboard/i18n.js` ทั้ง `th`/`en`
- เปลี่ยน UI chrome emoji เป็น SVG sprite เมื่อแก้ component เดิม
- ใช้ semantic tokens ใน new code
- หลีกเลี่ยง big-bang sweep ตาม project rule

### AUD4-LOW-003 — SQL dynamic construction ต้องมี regression checklist ต่อเนื่อง

**Fact**

- Scan template interpolation ใน `src/` พบ dynamic SQL หลายจุด
- จุดที่ตรวจแบบ sampling ส่วนใหญ่ใช้ parameter placeholders, allowlist, constant fragments, หรือ enum-controlled update fields
- ตัวอย่าง accepted patterns: `updates.push("${field} = $n")` จาก allowlist, filter fragments จาก constants, route filters with params array

**Impact**

รูปแบบ raw SQL เป็น decision #5 ของโปรเจกต์และไม่ใช่ปัญหาโดยตัวเอง แต่ถ้า future route เพิ่ม string interpolation จาก request โดยตรงจะเสี่ยง SQL injection ง่าย

**Recommendation**

เพิ่ม checklist ใน review/security smoke:

- request input ต้องเข้าผ่าน `$n` params
- column/order/update field ต้องผ่าน allowlist เท่านั้น
- SQL fragment constants ต้องไม่ประกอบจาก user input

### AUD4-DEFER-001 — Scale plan ของ `events`/partition ยัง deferred

**Fact**

- มี `db/MANUAL_partition_events_option_a.sql`
- ROADMAP ระบุ scale/partition เป็นแผนเมื่อ row volume สูงขึ้น
- Current test/audit รอบนี้ไม่ได้รัน `EXPLAIN` กับ live production data

**Impact**

ไม่ใช่ immediate defect แต่เป็น scale trigger ที่ควร monitor เมื่อ events โตถึง threshold

**Recommendation**

เพิ่ม health warning หรือ admin metric สำหรับ row count/partition threshold และรัน EXPLAIN รอบ performance audit ถัดไป

## Positive Controls Observed

**Security / Auth**

- `/api` มี global auth gate ยกเว้น public allowlist และ internal-token path
- `must_change_password` enforced ฝั่ง server middleware
- WebSocket auth อยู่ใน architecture invariant
- `/snapshots/*`, `/media/*`, dashboard private assets ยังไม่ถูกทำ public โดย default
- `requireAdminForWrites` ถูกใช้กับ route write surfaces สำคัญ
- auditor/admin split มี middleware เฉพาะ
- file/static routes มี dotfile deny pattern ตาม prior hardening

**Frontend / Static**

- Dashboard CSP ไม่อนุญาต arbitrary CDN scripts
- `/others` CSP strict ขึ้น
- Vendor assets หลักอยู่ local `/vendor/`
- Cache-busting สำหรับ dashboard JS ยังอยู่ใน `api-server.js`

**Runtime / Ops**

- PM2 เป็น runtime จริงตาม decision #199
- `scripts/services.sh status` เห็น 7 app online
- `ecosystem.config.js` กำหนด interpreter Node 24 path ชัดเจน
- `pm2-logrotate` online
- Docker compose config parse ผ่าน
- Backup มี offsite crypt layer ผ่าน `rclone` เมื่อ config พร้อม

**Data / Schema**

- Latest numbered migration pattern อยู่ที่ `db/db_migration_045_alert_min_likelihood.sql`
- `schema_migrations` runner เป็น fail-fast by design
- snapshot columns/backfill path มี documented invariant
- raw SQL style ส่วนใหญ่ยังเป็น parameterized/allowlisted

## Validation Performed

| Check | Result |
|---|---:|
| `git status --short` before audit | Clean |
| `git ls-files \| wc -l` | 277 tracked files |
| tracked secret/token grep | No live secret found; placeholders/env var names only |
| ignored env check | `.env` and `src/.env` are ignored |
| `find . -name '.env*'` | Found local ignored env files; not printed |
| `.DS_Store` scan | Found ignored `./.DS_Store` |
| `node --check src/api-server.js` | Pass |
| `node --check src/routes/health.js` | Pass |
| `node --check dashboard/dashboard.js` | Pass |
| all JS syntax check via `find ... node --check` | Pass |
| `node --test test/*.test.js` | Pass, 43 tests |
| `npm audit --omit=dev` in `src/` | Pass, 0 vulnerabilities |
| `docker compose config --quiet` | Pass |
| `docker compose ps` | Not validated: Docker socket permission denied |
| `./scripts/services.sh status` | 7 apps online + `pm2-logrotate` online |
| static CDN/inline handler scan | No new live dashboard CDN dependency found; comments/legacy docs remain |
| template interpolation scan | Reviewed high-risk categories; no direct critical finding from sampling |

## Not Validated

- Live endpoint auth matrix with real browser/session
- Cloudflare public tunnel headers
- Real LINE push/reply/quota path
- Real camera MQTT publish/auth smoke
- Real PostgreSQL `schema_migrations` query via Docker shell
- Real report PDF/PNG rendering paths
- Mobile responsive screenshots
- Full performance `EXPLAIN` on production event volume

## Recommended Next Batch

1. Add integration smoke tests for auth/static/CSP/media/worker paths.
2. Add low-cost cache/timeouts/duration metrics to `/api/health/details`.
3. Harden `scripts/backup.sh` temp config bundle cleanup with `trap` and restrictive permissions.
4. Add EMQX auth deployment smoke: anonymous publish fails, credentialed camera user passes.
5. Add production-visible warning/fail-fast for missing or mismatched `INTERNAL_API_SECRET`.
6. Remove ignored `.DS_Store` from workspace hygiene.
7. Continue opportunistic i18n/token/SVG cleanup only when touching related UI.

## Final Audit Opinion

ระบบอยู่ในสถานะ production-hardened กว่ารอบก่อนมาก และไม่มี finding ใหม่ระดับ Critical/High จากรอบ 4 นี้ รายการที่เหลือเป็น medium operational/test/observability risk และ low UI hygiene debt เป็นหลัก

คำตอบต่อคำถามว่า “Audit รอบก่อนปิดหมดหรือยัง”: ปิดแล้วในแกน security/runtime สำคัญ แต่ยังไม่ปิดหมดในเชิง engineering maturity เพราะ integration smoke coverage, health endpoint guard, backup transient-secret handling, และ UI/i18n debt ยังเปิดอยู่
