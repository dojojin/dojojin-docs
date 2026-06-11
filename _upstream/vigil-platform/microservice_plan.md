# Master Plan — Modular Refactor + Security Hardening

> สถานะ: **Phase 0 + 1 + 3 (workers) ✅ DONE · Phase 2/4 Deferred** · อัปเดต: 2026-06-07
> ที่มา: codebase analysis + advisor review + CODEX_AUDIT_2ndTier.md + verify จาก code จริง 2026-06-04
> SEC-2T-001 decision: **ลบ** `index.html`, `partners.html`, `reference-projects.html`, `vss_v1.html` (ไม่ได้ใช้แล้ว) — CDN risk หายไปด้วย; `boxbox-*.html` auth-gated แล้ว (Option C)

---

## แผนการดำเนินการ (Execution Plan)

> แต่ละ task มี checklist พร้อมทำ ทำตามลำดับ Phase แต่ใน Phase เดียวกันทำขนานได้

### Phase 0 — ✅ DONE ทั้งหมด (verified 2026-06-04)

#### 0a — Commit `src/package-lock.json` ✅
- [x] `.gitignore` ใช้ negation `!src/package-lock.json` (ไม่ใช่ลบบรรทัด — cleanersolution)
- [x] `git ls-files src/package-lock.json` คืนผล = tracked ใน repo แล้ว
- [x] `README.md` ใช้ `npm ci` (บรรทัด 315)

#### 0b — Update PM2 docs ✅
- [x] ค้นหา `npm run start:all` และ `start:full` ทุกจุด → แทนด้วย `./scripts/services.sh` / `pm2 start ecosystem.config.js` (done 2026-06-03)
- [x] เพิ่มโน้ต "PM2 migration complete — `npm run start:all` เป็น no-op แล้ว" (done 2026-06-03)
- [x] verify `service_start.md` ไม่มี `npm run start` เหลือ (verified 2026-06-04)

#### 0c — ลบ `.DS_Store` + hardening ✅
- [x] ลบ `.DS_Store` ทุกจุด (find ไม่เจอไฟล์ใน working tree)
- [x] `.gitignore` มี `.DS_Store` และ `.DS_Store?` แล้ว
- [x] `/others` static mount (`src/api-server.js` บรรทัด 314) มี `dotfiles: 'deny'` แล้ว

#### 0d — Crypto plaintext-cred guard ✅
- [x] `encryptCred()` บรรทัด 49: `console.warn('[crypto-creds] CAMERA_SECRET_KEY not set — storing credential as plaintext')`
- [x] Health endpoint (`/api/health/details`) scan ทุก camera + warn + คืน `plaintext_creds[]` ใน response (บรรทัด ~5837–5849)

---

### Phase 1 — Origin Isolation ✅ DONE (2026-06-05)

#### Phase 1a — SEC-2T-001: แก้ /others origin risk ✅ DONE (verified 2026-06-04)

**เลือก Option C** — auth-gate `/others` ทั้งหมด (ไม่มีไฟล์ใดต้องการ public)
**Optional future hardening:** ย้ายไป subdomain `docs.dojojin.tech` (comment ใน code แล้ว)

| ไฟล์ | CDN | สถานะ |
|---|---|---|
| ~~`index.html`~~ | EmailJS | ✅ ลบแล้ว |
| ~~`vss_v1.html`~~ | Materialize CSS+JS | ✅ ลบแล้ว |
| ~~`partners.html`~~ | ไม่มี | ✅ ลบแล้ว |
| ~~`reference-projects.html`~~ | ไม่มี | ✅ ลบแล้ว |
| ~~`boxbox-th.html`~~, ~~`boxbox-en.html`~~ | Cytoscape + Dagre (jsdelivr) | ✅ ลบแล้ว (2026-06-05) |

**Code ที่ยืนยัน (src/api-server.js):**
```javascript
const OTHERS_PUBLIC = new Set([]);        // ไม่มี exception
const OTHERS_PUBLIC_PREFIXES = [];        // ไม่มี prefix ที่ public
// SEC-2T-001 — /others fully auth-gated pending migration to docs.dojojin.tech subdomain
```
- [x] ตัดสินใจ: ไม่มีไฟล์ใน `/others` ที่ต้องการ public
- [x] `/others` ถูกนำออกจาก `PUBLIC_PREFIXES` แล้ว
- [x] `OTHERS_PUBLIC = new Set([])` — default-deny ทุกไฟล์

#### Phase 1b — SEC-2T-002: CSP enforce — ✅ DONE (2026-06-05)

- [x] แยก CSP header: `/others/*` → `Content-Security-Policy` (enforced); dashboard → `Content-Security-Policy` (enforced — Phase 5 ✅)
- [x] ลบ `unsafe-inline` จาก `/others` script-src → boxbox DATA block ย้ายเป็น external JSON แล้ว; "No inline scripts remain" (api-server.js line ~124)
- [x] เปลี่ยน dashboard เป็น `Content-Security-Policy` (enforce) — Phase 5 ✅ 2026-06-05 (commit `5532915`)
- [x] test ว่าไม่มี console CSP violation บน dashboard หลัง enforce ✅

---

### Phase 2 — Route Module Split (= Microservice Phase A)

**ใช้ opportunistic extraction** — extract เมื่อแตะ subsystem นั้น ไม่ใช่ one-shot

**โครงสร้างเป้าหมาย:**
```
src/
  api-server.js          ← bootstrap + middleware stack เท่านั้น
  routes/
    auth.routes.js
    cameras.routes.js
    events.routes.js
    stats.routes.js
    reports.routes.js    ← + SEC-2T-005 line-config role ตรงนี้
    alerts.routes.js
    map.routes.js        ← + SEC-2T-008 tiles auth decision ตรงนี้
    health.routes.js
    license.routes.js
  helpers/
    routeError.js        ← SEC-2T-004 สร้างก่อนเลย ใช้ทุก module
```

**Steps (ทำตามลำดับ):**
- [x] ~~สร้าง `src/helpers/routeError.js` ก่อน (SEC-2T-004)~~ — ✅ DONE 2026-06-05
- [ ] เริ่มจาก route group ที่มี bug หรือ feature ที่ต้องแตะอยู่แล้ว
- [ ] smoke test หลัง extract แต่ละ module (ไม่ batch ทั้งหมด)
- [ ] ตัดสินใจ `GET /api/line-config` role policy (SEC-2T-005) เมื่อแตะ alerts/reports routes
- [x] ~~ตัดสินใจ `/tiles/` auth-gate (SEC-2T-008)~~ — ✅ WON'T FIX / public by design (2026-06-05)

**เงื่อนไข gate:**
- [ ] Phase 0 ครบทุก task
- [ ] Phase 1a เสร็จ (origin risk ปิดแล้ว)
- [ ] ตกลง `routeError()` interface ก่อนเขียน

---

### Phase 3 — Extract Heavy Workers ✅ DONE (workers shipped 2026-06-06, different arch)

**หมายเหตุ:** implementation เบี่ยงจากแผนเดิม — alert-worker ใช้ `LISTEN alert_event`
(ไม่ใช่ `new_event`); report-worker ใช้ HTTP endpoint แทน job queue table

- [x] ✅ สร้าง `src/alert-worker.js` — LISTEN `alert_event` + `alert_rules_changed` (2026-06-06)
- [x] ✅ สร้าง `src/report-worker.js` — HTTP endpoint `127.0.0.1:3001/run/:id` (2026-06-06)
- [x] ✅ เพิ่ม 2 entries ใน `ecosystem.config.js` (7 workers verified 2026-06-06)
- [x] ✅ ลบ `require('./alert-engine')` ออกจาก api-server (done)
- [x] ✅ verify PM2 restart ทั้ง 7 process — launchd verified after reboot 2026-06-06
- [ ] `require('./report-renderer')` ยังอยู่ใน api-server (lines 4081/5854/5883/5915) — deferred
- ~~ออกแบบ job queue schema (`report_jobs` table)~~ → approach เปลี่ยน: HTTP trigger แทน
- ~~DB migration checklist สำหรับ job queue~~ → ไม่มี job queue table (ไม่ต้องทำ)

---

### Phase 4 — API Gateway (Optional)

ทำเมื่อ: multi-host deployment จำเป็นจริง + Phase 2+3 stable แล้ว

---

## สภาพปัจจุบัน (Fact)

### Process ที่มีอยู่แล้ว (PM2)

| Process | ไฟล์ | บรรทัด |
|---|---|---|
| `api-server` | `src/api-server.js` | 6,615 |
| `mqtt-subscriber` | `src/mqtt-subscriber.js` | 784 |
| `media-recorder` | `src/media-recorder.js` | 504 |
| `hikvision` | `src/ingesters/hikvision-isapi.js` | — |
| `dahua` | `src/ingesters/dahua-cgi.js` | — |
| `alert-worker` | `src/alert-worker.js` | — (Phase 3 ✅ 2026-06-06) |
| `report-worker` | `src/report-worker.js` | — (Phase 3 ✅ 2026-06-06) |

### Inter-process Communication: PostgreSQL LISTEN/NOTIFY (decoupled แล้ว)

- `mqtt-subscriber.js:609` → `pg_notify('new_event', id)` หลัง INSERT
- `mqtt-subscriber.js:661` → `pg_notify('event_for_clip', id)` → media-recorder
- `mqtt-subscriber.js` → `pg_notify('alert_event', payload)` → alert-worker (Phase 3 ✅)
- `api-server.js:976` → `LISTEN new_event` + `LISTEN clip_done` → WebSocket broadcast
- `api-server.js` → HTTP `POST 127.0.0.1:3001/run/:id` → report-worker (Phase 3 ✅)

ไม่มี shared memory หรือ HTTP call ระหว่าง process

### ปัญหาหลักที่แท้จริง: God-file

`api-server.js` (6,615 บรรทัด) รวม 100+ route และ lazy-require module ใน process เดียว:
`alert-engine` · `line-sender` · `push-sender` · `report-renderer`

Route domains: `/api/auth` · `/api/cameras` · `/api/events` · `/api/stats` · `/api/map` · `/api/alerts` · `/api/reports` · `/api/license` · `/api/settings` · `/api/health`

### Shared State (coupling ที่แท้จริง)

- **PostgreSQL** — ทุก process อ่าน/เขียน schema เดียวกัน
- **Filesystem** — `cameras-config.json`, `camera-groups.json`, `snapshots/`, `media/`, `media-buffer/`

### Deployment Model

**1 host per customer** — PM2 + launchd + Cloudflare Tunnel
(`HARDWARE_SIZING_GUIDE.md` G1–G5 = ขนาด box ไม่ใช่ cluster)

---

## ข้อสรุปสำคัญ

**ระบบอยู่ในสภาพ 5-process SOA อยู่แล้ว** — "Monolith" ที่เหลือคือ code organization ใน `api-server.js` ไม่ใช่ process boundary

**Full Microservices ไม่แนะนำ** เพราะ single-host per customer → ไม่มีประโยชน์จาก scale แยก; แยก DB = distributed transaction โดยไม่จำเป็น

**ที่แนะนำ: Modular Monolith + Security Hardening คู่กัน** — MAINT-2T-001 จาก audit เป็นหลักฐานอิสระที่ corroborate แนวทางเดิม

---

## แผนแบบ Phase (เรียงตามความสำคัญจริง)

> หลักการจัดเรียง: **อิสระจาก refactor → ทำก่อนเสมอ; ผูกกับ routes → merge เข้า Phase 2**
> Phase 2–4 ยังขึ้นอยู่กับคำถามที่ยังไม่ตอบ: **"ทำ Microservice เพราะอะไร?"**

---

### Phase 0 — ✅ DONE ทั้งหมด (verified 2026-06-04)
**ความเสี่ยง: ต่ำมาก | ไม่ต้องรอ Phase อื่น | แต่ละรายการแตะไฟล์คนละตัว**

| # | รายการ | ไฟล์ | Audit ID | สถานะ |
|---|---|---|---|---|
| 0a | Commit `src/package-lock.json` + เปลี่ยน deploy เป็น `npm ci` | `src/package-lock.json`, deploy script | SEC-2T-003 | ✅ |
| 0b | Update README.md + service_start.md ให้ใช้ PM2 อย่างเดียว ตัด `npm run start:all` | `README.md`, `service_start.md` | OPS-2T-001 | ✅ |
| 0c | ลบ `.DS_Store` + เพิ่มใน `.gitignore` + set `dotfiles: 'deny'` ใน express.static | `.gitignore`, `src/api-server.js` | SEC-2T-007 | ✅ |
| 0d | เพิ่ม health warning ถ้า credential ยังเป็น plaintext เมื่อ `CAMERA_SECRET_KEY` missing | `src/crypto-creds.js` | SEC-2T-006 | ✅ |

---

### Phase 1 — Origin Isolation ✅ DONE (2026-06-05)
**ความเสี่ยง: กลาง | ต้องตัดสินใจก่อน | ทำก่อน Phase 2 เสมอ**

SEC-2T-001 และ SEC-2T-002 ต้องทำตามลำดับนี้ — **002 ตาม 001 ไม่ใช่ตาม refactor**

#### Phase 1a — SEC-2T-001: แก้ `/others` origin isolation ✅ DONE (verified 2026-06-04)

**ปัญหา:** `/others/*.html` เป็น public + โหลด CDN scripts + same-origin กับ dashboard
→ JavaScript บน `/others` อ่าน `localStorage` ได้ → session token รั่วได้

**ตัดสินใจ: Option C** — auth-gate `/others` ทั้งหมด (ไม่มีไฟล์ใดต้องการ public)
**Optional future:** ย้ายไป subdomain `docs.dojojin.tech` (defense-in-depth เพิ่มเติม)

| ตัวเลือก | วิธี | สถานะ |
|---|---|---|
| A | ย้าย `/others` ไปคนละ domain | ⏳ Optional future hardening |
| B | ลบ third-party CDN → self-host | — |
| C | Auth-gate `/others` ทั้งหมด | ✅ Done |

- [x] **ตัดสินใจตัวเลือก C** — `OTHERS_PUBLIC = new Set([])` + `/others` นำออกจาก `PUBLIC_PREFIXES`
- [x] `boxbox-th.html` + `boxbox-en.html` ลบแล้ว (2026-06-05) — Cytoscape CDN risk eliminated

#### Phase 1b — SEC-2T-002: CSP enforce — ✅ DONE (2026-06-05)

`/others/*` + dashboard → ทั้งคู่ `Content-Security-Policy` enforced แล้ว (Phase 5 ✅ 2026-06-05)
Dashboard: zero inline scripts/handlers; `Content-Security-Policy` enforce (commit `5532915`)

- [x] แยก CSP header per route (`src/api-server.js` บรรทัด ~115)
- [x] dashboard enforce → Phase 5 ✅ 2026-06-05 (commit `5532915`)

---

### Phase 2 — Route Module Split + Security Merges (= Microservice Phase A)
**ความเสี่ยง: ต่ำ | ทำหลัง Phase 0 + 1 เสร็จ**

> **MAINT-2T-001 จาก audit = Phase นี้พอดี** — audit แนะนำ "extract route groups when actively touching" ซึ่ง corroborate แผนเดิม

แยก route handlers ออกจาก `api-server.js` เป็น route modules
**ไม่เปลี่ยน process boundary** — refactor pure code organization

```
src/
  api-server.js          ← bootstrap + middleware stack (~500 บรรทัด)
  routes/
    auth.routes.js       ← + SEC-2T-005 (line-config role policy)
    cameras.routes.js
    events.routes.js
    stats.routes.js
    reports.routes.js
    alerts.routes.js
    map.routes.js        ← SEC-2T-008 ตัดสินใจแล้ว: public by design
    health.routes.js
    license.routes.js
  helpers/
    routeError.js        ← SEC-2T-004 (build ตั้งแต่ต้น ไม่ใช่ patch ทีหลัง)
```

**Security items ที่ merge เข้าระหว่าง Phase นี้:**

| Audit ID | รายการ | Merge เข้า module ไหน |
|---|---|---|
| SEC-2T-004 | `routeError()` helper — log server, generic code ให้ client | `helpers/routeError.js` → ใช้ทุก route |
| SEC-2T-005 | ตัดสินใจ role policy ของ `GET /api/line-config` | `routes/alerts.routes.js` |
| ~~SEC-2T-008~~ | ~~ตัดสินใจ auth-gate `/tiles/`~~ | ✅ WON'T FIX — public by design (2026-06-05) |

**เงื่อนไขก่อนเริ่ม Phase 2:**
- [x] Phase 0 ครบ (verified 2026-06-04)
- [x] Phase 1a ตัดสินใจแล้ว — Option C: fully auth-gated (verified 2026-06-04)
- [ ] ตกลง naming convention (`auth.routes.js` vs `authRouter.js`)
- [x] ~~ออกแบบ `routeError(res, err, context)` interface~~ — ✅ format B: `{ error: 'Internal server error', code: 'ERR_INTERNAL' }`

**จุดตัดสินใจสำคัญ — ยังเปิดอยู่:**

| แนวทาง | ความหมาย | ข้อดี | ข้อเสีย |
|---|---|---|---|
| **Opportunistic** (audit + CLAUDE.md) | extract เฉพาะเมื่อแตะ subsystem นั้น | ความเสี่ยงต่ำ, rollback ง่าย | ใช้เวลานาน, ไม่เสร็จพร้อมกัน |
| **One-shot mechanical** (Phase A เดิม) | split 6,615 → ~500 บรรทัดครั้งเดียว | เสร็จเร็ว, consistent | risk regression สูง, ขัด CLAUDE.md culture |

→ CLAUDE.md (Working Agreement) และ audit ต่างก็บอก "ห้าม big-bang refactor; opportunistic เท่านั้น"
→ **ถ้าไม่มีเหตุผลเร่งด่วน แนะนำ opportunistic**

---

### Phase 3 — Extract Heavy Workers (= Microservice Phase B)
**ความเสี่ยง: กลาง | ทำหลัง Phase 2 stable**

แยก `alert-engine + line-sender + push-sender` และ `report-renderer` ออกเป็น process แยก
สื่อสารผ่าน `pg_notify` pattern ที่มีอยู่แล้ว

| Worker | วิธี decouple | PM2 entry ใหม่ | สถานะ |
|---|---|---|---|
| `alert-engine` + `line-sender` + `push-sender` | LISTEN `alert_event` + `alert_rules_changed` | `alert-worker` | ✅ DONE 2026-06-06 |
| `report-renderer` | HTTP endpoint `127.0.0.1:3001/run/:id` | `report-worker` | ✅ DONE 2026-06-06 |

**Security merge:**
- DB-2T-001 — เพิ่ม migration checklist item: "large table index → `CREATE INDEX CONCURRENTLY`" เมื่อออกแบบ job queue schema

**เงื่อนไขก่อนเริ่ม Phase 3:**
- [ ] Phase 2 เสร็จและ stable (2–4 สัปดาห์ run production ก่อน)
- [ ] ออกแบบ job queue schema สำหรับ report worker
- [ ] ตัดสินใจว่า alert worker ต้องการ HTTP response กลับหรือไม่

---

### Phase 4 — API Gateway (= Microservice Phase C)
**ความเสี่ยง: สูง | Optional — ทำเฉพาะถ้า multi-host จริง**

Add nginx หรือ lightweight gateway ข้างหน้า

**ทำเมื่อ:**
- มี customer ที่ต้อง scale service แยก
- Phase 2 + 3 stable แล้ว
- มีเหตุผล deployment ที่ชัดเจน

**ไม่ต้องทำถ้า:** เหตุผลหลักแค่ "ไฟล์ใหญ่เกินไป" — Phase 2 แก้ได้แล้ว

---

## ภาพรวม Timeline

```
Phase 0  ✅ DONE (2026-06-04)
Phase 1a ✅ DONE (2026-06-04) — Option C: fully auth-gated
Phase 1b ✅ DONE (2026-06-05) — /others + dashboard both enforced; unsafe-inline script-src removed
Phase 2  ⏳ Gate เปิดแล้ว — opportunistic เมื่อแตะ route นั้น
Phase 3  ✅ DONE (2026-06-06) — workers shipped; `report-renderer` ยังใน api-server (deferred)
Phase 4  ⏳ Optional — ทำเมื่อมี multi-host จริง
```

---

## สิ่งที่ต้องตัดสินใจก่อนเริ่ม

1. ~~**SEC-2T-001 `/others`**: ย้าย domain / self-host / auth-gate?~~ → ✅ **Option C** (auth-gate ทั้งหมด)
2. ~~**Phase 2 scope**: opportunistic extraction หรือ one-shot mechanical split?~~ → ✅ **Opportunistic** (CLAUDE.md + audit ยืนยัน)
3. **เหตุผลหลักของ Microservice**: ไฟล์ใหญ่ / fault isolation / scale แยก / multi-host?  
   → กำหนดว่า Phase 3 และ 4 จำเป็นจริงหรือไม่ (ยังเปิดอยู่)
4. **Phase 2 naming**: route modules ใช้ชื่อ file แบบไหน? (`auth.routes.js` vs `authRouter.js`)
5. ~~**`routeError()` interface**: response error code format เป็นอะไร?~~ → ✅ format B confirmed + implemented

---

## สิ่งที่ audit ยืนยันว่าดีแล้ว (ไม่ต้องแตะ)

Auth gate `/api`, media/snapshot auth, WebSocket verifyClient, LINE webhook signature, Docker localhost-bind, magic-byte upload validation, Service Management allowlist, AES-256-GCM camera credentials, map tile bounds validation, backup audit log

---

*ที่มา: `src/api-server.js`, `ecosystem.config.js`, LISTEN/NOTIFY analysis, `CODEX_AUDIT_2ndTier.md`, advisor review*
