# DECISIONS — Vigil Platform

> **Index file** — design decisions ย้ายไป `docs/LOGIC_*.md` แล้ว.
> ไฟล์นี้เป็น index + quick-lookup เท่านั้น.
> สำหรับ rationale เต็ม → เปิดไฟล์ LOGIC ที่ระบุ.
>
> Companion to: CLAUDE.md · GOTCHAS.md · ARCHITECTURE.md · DESIGN.md
> Last updated: 2026-06-08 · v1.5.3 (Phase 2 doc sync — #152/#160 EMQX exception)

---

## LOGIC Files (Canonical Sources)

| File | Decisions | Domain |
|---|---|---|
| [docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md) | #6–#11, #56–#61, #120, #127, #129, #130, #140 | Auth, sessions, RBAC, security audit, compliance |
| [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) | #12–#14, #90–#91 | LINE alerts, imgbb, recipients, webhook onboarding, camera offline LINE alerts, scheduled report delivery boundaries |
| [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md) | #15–#32, #85, #92–#94, #98–#99, #131–#133, #136–#139, #141, #148 | Stats v2, Reports, Puppeteer, scheduled delivery config, Health Report |
| [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md) | #40–#41, #62–#71, #77–#79, #86, #89, #96, #109–#116, #121, #123, #125 | Bosch MQTT, Hikvision ISAPI, Dahua CGI, ONVIF, clip capture, camera lifecycle |
| [docs/LOGIC_face-capture.md](docs/LOGIC_face-capture.md) | #117–#119 | Face Capture ingestion, gallery page, PDPA boundary |
| [docs/LOGIC_license.md](docs/LOGIC_license.md) | #100–#108 | Ed25519 JWT license, trial/grace, machine fingerprint, EULA |
| [docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md) | #33–#38, #47–#52, #80–#84, #122, #124, #126 | Migrations, backup/restore, service lifecycle, branding, deployment, settings workspace |

---

## Decision Index (Quick Lookup)

### Architecture (#1–#5)
- **#1** Vanilla JS, no framework → [LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md) (general arch)
- **#2** Self-hosted PostgreSQL over cloud → PDPA compliance + cost
- **#3** Single-file `init.sql` (idempotent, fresh-install only) → [LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)
- **#4** MQTT subscriber as separate process → isolation
- **#5** No ORM — raw SQL via `pg` library

### Auth & Security (#6–#11, #56–#61, #120, #127, #129, #130, #140)
→ **[docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md)**

### LINE Alert System (#12–#14)
→ **[docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md)**

Includes:
- **#12** imgbb for image hosting — LINE doesn't allow direct upload
- **#13** In-memory cooldown cache (60s default)
- **#14** Per-rule recipient filter

### Stats v2 & Reports (#15–#32, #85, #87–#89, #92–#94, #98–#99, #131–#133, #136–#139)
→ **[docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md)**

Includes:
- **#23** Drill-down click (chart → Events page with filter)
- **#24** Quiet Cameras alert (online but no event in 24h)
- **#31** Per-bucket trend bar chart (`animation: false`)
- **#87** Live "People in Area" = CountAggregation + 2s median smoothing
- **#88** Density viz uses Postgres `date_bin()` (PG14+)
- **#90** Per-rule quiet hours = SILENT window ← **STUBBORN_FACT**, see [LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md)
- **#133** Stats page i18n Stage 4 (58 keys, namespace `stats.*`)
- **#141** Stats compact control header + Event Overview focus badges

### White-label Branding (#33–#38)
→ **[docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)**

### Production Hardening (#39–#43, #72)
- **#39** `snapshot_retention_days` (1..365, default 30) → [LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)
- **#40** Snapshot retention by file mtime → [LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)
- **#41** Health Check page is admin-only, 15s auto-refresh
- **#42** Mobile breakpoint `≤768px`
- **#43** Health endpoint hits DB once per request — no caching
- **#72** "Today's Events" count is server-side TZ-aware (not client-filtered 300-row cache) → [LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)

### Operations (#44–#46)
- **#44** `npm run start:all` via `concurrently`
- **#45** `npm run start:full` rolls in cloudflared
- **#46** Cloudflared root service install = production autostart

### Maps (#47–#49)
→ **[docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)**

### Deployment (#50–#52)
→ **[docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)**

### Compliance & Legal (#53–#55)
- **#53** Proprietary license → [LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)
- **#54** Mandatory disclaimer page (Thai legal: Computer Crime Act + PDPA) → [LOGIC_auth-security.md](docs/LOGIC_auth-security.md)
- **#55** Force re-acceptance per browser session → [LOGIC_auth-security.md](docs/LOGIC_auth-security.md)

### Security Audit (#56–#61)
→ **[docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md)**

### Pre-alarm Clip Capture (#62–#79)
→ **[docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md)**

### Phase 6.1.7–8 Pagination (#73–#76)
- **#73** Server-side pagination, 20/page, `X-Total-Count` header, `COUNT(*) OVER ()` window function
- **#74** All Events page filters are server-side
- **#75** Object class hierarchy — `Person` → `[Person, Face, HumanBody, Pedestrian…]`, `Vehicle` → `[Vehicle, Car, Truck…]`
- **#76** Event Live "Pause Live" button — `_evtPaused` flag

### Phase 6.1.9 RTSP resilience (#77–#79)
→ **[docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md)**

### Schema Migrations + Backup (#80–#84)
→ **[docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)**

### Phase 7 — Executive Summary, Density, Quiet Hours, Scheduled Reports (#85–#94)
→ **[docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md)**

### Phase 7 Performance (#95–#97)
→ **[docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md)** (#95 Puppeteer pool, #96 WS via NOTIFY)
- **#97** `src/package.json` stripped 149 → 10 real direct deps

### Phase 7.4 Scheduled Report Day Pickers (#98–#99)
→ **[docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md)**

### License System (#100–#108)
→ **[docs/LOGIC_license.md](docs/LOGIC_license.md)**

### Camera Lifecycle (#109–#111)
→ **[docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md)**

### MQTT Broker Swap (#112)
→ **[docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md)**

### Phase 7.5 Trigger Filter (#113)
→ **[docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md)**

### Multi-vendor Ingesters (#114–#116, #121, #123)
→ **[docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md)**

### Face Capture (#117–#119)
→ **[docs/LOGIC_face-capture.md](docs/LOGIC_face-capture.md)**

### Security Audit 2026-05-21 (#120)
→ **[docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md)**

### Scale-up Plan (#122)
→ **[docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)**

### Dahua CGI Ingester (#123)
→ **[docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md)**

Live Dahua snapshot timing / recovery log:
→ **[DahuaProblem.MD](DahuaProblem.MD)**

### Duplicate Process Prevention (#124)
→ **[docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)**

### Snapshot Display Thumbnails (#125)
→ **[docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md)**

### Settings Workspace (#126)
→ **[docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md)**

### Auditor Role (#127)
→ **[docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md)**

### Bilingual i18n (#128)
- **#128** `dashboard/i18n.js` — vanilla engine. Thai = source, English = translation layer. Every key must exist in both `th` and `en` blocks. `data-i18n` / `data-i18n-html` / `data-i18n-ph` / `data-i18n-title` / `data-i18n-value` attributes. JS dynamic strings via `I18N.t('key')`. Server-side rendered reports use `HR_LABELS.{th,en}` dict pattern.
  > See also: GOTCHAS #42

### Security Fixes 2026-05-23 (#129–#130)
→ **[docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md)**

### Report Schedule Fixes (#131–#133)
→ **[docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md)**

### Operational Roadmap Ph.1–Ph.6 (#134–#135)
- **#134** Six phases approved: Camera offline alert, Report History, Health Report, Event Management, SOP+AI suggestion, Logs consolidated menu.
- **#135** Camera offline detection uses heartbeat `last_seen_at` on `cameras` table (90s threshold). In-memory `_cameraOfflineState = new Map()` tracks `{status, offlineSince, lastAlertAt}` per camera_id.

### System Health Report (#136–#140)
→ **[docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md)**

- **#148** Health Report PNG via SVG + `sharp` (not Puppeteer); emoji-strip `_svgSafeText()` (GOTCHAS #25a) — architectural basis for no-emoji #144. *(renumbered 2026-05-27 from a duplicate `#141`)*

### UI Design System (#142–#145)
→ **[DESIGN.md](DESIGN.md)** (canonical — spec + full rationale)

- **#142** "Material Design" = หลักการ/tokens ไม่ใช่ framework (no Material Web Components) → ชน #1
- **#143** Icons = self-hosted SVG sprite (`currentColor`), ไม่ใช่ icon webfont/CDN → self-host + PDPA
- **#144** No emoji as UI ใน user-facing surface. **Server-side SVG render (Health Report PNG via sharp = #148) = hard constraint** (librsvg/Pango abort, GOTCHAS #25a, fix `_svgSafeText()`); dashboard DOM = preference. dashboard เดิมมี emoji แพร่หลาย → grandfathered/opportunistic. carve-out: LINE / docs
- **#145** Design token **tri-layer single source** (CSS var + JS palette + Puppeteer inject); status/text ผ่าน WCAG AA

### AI Workflow / Working Agreement (#146–#147)
→ **[CLAUDE.md](CLAUDE.md)** (canonical — Working Agreement #3)

- **#146** Reproduce-before-fix → verify-after. unreproduced fix = 🟡 hypothesis ไม่ใช่ 🔵 fact. (เฉพาะงาน bug/behavior — ไม่ใช่ feature/typo)
- **#147** Hybrid guard tier ตอน capture: log/non-throwing → ทำได้เลย; throw/behavior-changing → รอไฟเขียว (เด่นใน MQTT ingest / WS / migration)

### Security Fixes 2026-05-28 (#152–#153)

- **#152** SEC-001 Phase 1: bind EMQX ports (1883/8083/18083) ไปที่ `127.0.0.1` แทน `0.0.0.0` — เหตุผล: anonymous MQTT publish จาก LAN ทำให้ attacker inject payload เข้า DB ได้ (chain → SEC-002 XSS); **Phase 2 ✅ DONE** (2026-05-28): dual-bind + AUTHN enforced (GOTCHAS #50, decision #164); **Phase 3** (2026-06-07): dual-bind → `0.0.0.0:1883` (network resilience — IP hardcode พังเมื่อเปลี่ยน LAN/VPN); WS :8083 disabled; AUTHN = security boundary (GOTCHAS #50 Phase 3)
- **#153** SEC-002: `escapeHtml()` ทุก MQTT/DB-sourced field ใน `renderEvents` + `renderSnapshots` (grid + list); `snapshot_file` URL path → `encodeURIComponent()` — เหตุผล: `rule_name`/`camera_id`/`object_class`/`snapshot_source`/`event_type` เป็น attacker-controlled ผ่าน SEC-001; `renderMedia` มี escapeHtml ครบอยู่แล้วไม่ต้องแตะ
- **#154** SEC-003: `GET /api/cameras` role-based redact — `role === 'admin'` → plaintext (ต้อง prefill `frmCamPass`); viewer/auditor → `_redactCameraAudit()` (`password = '***'`); ฟังก์ชัน `_redactCameraAudit` มีอยู่แล้วแต่ถูกใช้แค่ใน audit log path → ขยายมาใช้ที่ response

### Security Preventive Invariants 2026-05-28 (#157–#160)

> กฎออกแบบป้องกันการพลาดซ้ำ — ดึงจาก SEC-004/005/010/011 audit. ดู checklist: [docs/REF_security-checklist.md](docs/REF_security-checklist.md) + GOTCHAS #54–57.

- **#157** SEC-004: `must_change_password` (และ security flag ชนิดเดียวกัน) ต้อง enforce ที่ server middleware — `requireAuth` + allowlist path; ห้าม rely on client redirect เท่านั้น. เหตุผล: token เก่ายัง valid → client bypass ได้
- **#158** SEC-005: ทุก file upload endpoint ต้อง validate **magic bytes** ก่อน accept — MIME type จาก `Content-Type` header เป็น client-controlled ปลอมได้; magic bytes ใน buffer ปลอมไม่ได้โดยไม่ทำให้ไฟล์ใช้งานไม่ได้. เหตุผล: librsvg CVE path เปิดถ้า SVG ผ่าน MIME-only check
- **#159** SEC-010: login/logout ต้องใช้ **cookie flag builder เดียวกัน** (ตรวจ HTTPS + push Secure/SameSite); hardcode string แยกทำให้ flags drift เมื่อแก้ฝั่งใดฝั่งหนึ่ง. เหตุผล: logout ขาด Secure + SameSite ทั้งที่ login ตั้งครบ
- **#160** SEC-001/011 generalized: ทุก docker internal service ใช้ `"127.0.0.1:PORT:PORT"` ไม่ใช่ `"PORT:PORT"` (0.0.0.0); secret ใน compose ใช้ `${VAR:?msg}` เท่านั้น (ค่าจริงใน gitignored `.env`). เหตุผล: Docker default = bind all interfaces → expose LAN/WAN โดยไม่ตั้งใจ. **ยกเว้น EMQX MQTT :1883** — `"1883:1883"` (all-interfaces) ได้เมื่อ `ENABLE_AUTHN=true` บังคับ credentials ทุก client (decision #152 Phase 3, 2026-06-07)

### Camera Grouping Map Filter + Live Pulse + Legend Scaling (#155–#156, #161–#163)

- **#155** Map grouping → **Option B** (multi-group color-coded overlay, white fill + colored ring, legend toggle, visible-only stats) — full rationale + implementation: [docs/LOGIC_map-features.md § B](docs/LOGIC_map-features.md)
- **#156** Live Pulse → **Toast-on-map T2** (per-camera debounce, on/off toggle, 5s/15s/30s/60s dropdown) — full design + reproduce plan: [docs/LOGIC_map-features.md § C](docs/LOGIC_map-features.md)
- **#161** Wall Mode → **Option 2 + Option 3** (CSS class `body.map-wall-mode` toggle + Fullscreen API) — ทำงานได้ทั้ง kiosk `--kiosk` และ normal browser; Fullscreen API เป็น no-op เมื่อ kiosk ซ่อน browser chrome อยู่แล้ว (silent catch) — commit `d0049b6` · [docs/LOGIC_map-features.md § I](docs/LOGIC_map-features.md)
- **#162** Legend Scaling → **Tier 2 Auto-adapt** (3 modes ตาม N=`groups.length`: compact overlay N<6, scroll+controls N 6–20, drawer overlay N>20) — search filter legend-only (ไม่แตะ `hiddenGroupIds` / `refreshMap()`); drawer = overlay 280px ไม่ใช่ push (ไม่ต้อง `map.updateSize()`); wall mode compact = font-size 9px ไม่ hidden — [docs/LOGIC_map-features.md § J](docs/LOGIC_map-features.md)
- **#163** pg_notify timing → **notify AFTER snapshot save (ทั้ง 3 vendor)** — ย้าย `pg_notify('new_event')` จากทันทีหลัง `INSERT` → หลัง snapshot UPDATE ใน `mqtt-subscriber.js` (Bosch), `dahua-cgi.js` (Dahua await UPDATE), `hikvision-isapi.js` (Hikvision .then() chain); WS event ถึง frontend พร้อม `snapshot_file` แล้วทุก vendor — GOTCHAS #58
- **#168** Map controls responsive → **Option B Primary/Secondary split** — แบ่ง 11 ปุ่มออกเป็น 2 กลุ่ม: primary (HEATMAP/CAMERAS/LIVE/select/FACE/FIT — ใช้บ่อย) + secondary (STREETS/CARTO/ONLINE/MANAGE/WALL — ใช้น้อย); ≤768px: secondary collapse ด้วย SVG chevron toggle (class `.map-sec.open`); ≥769px (desktop+tablet): ทั้ง 2 row แสดงเสมอ; chevron hidden บน desktop ด้วย `.map-more-btn{display:none}`. แก้พร้อมกัน 4 จุดเล็ก: `.map-stats-bar{flex-wrap:wrap}`, popup `max-width:min(240px,85vw)`, legend drawer `max-width:90vw`, `.map-toolbar-sub` hide ≤768px. CSS specificity trap: early @media block ต้องใช้ selector `.map-controls .map-sec` (0,2,0) เพื่อ beat `.map-toggle{display:flex}` (0,1,0) ที่ defined later in source — [LOGIC_map-features.md § K](docs/LOGIC_map-features.md)

### History Workspace Stats Summary (#150–#151)

- **#150** Alert Logs stats strip: window picker (24h/7d/30d) **อิสระจาก** status filter ของตาราง — เหตุผล: user อาจกรองตาราง `failed only` แต่ยังต้องการเห็น summary ภาพรวม; `line_messages_sent = SUM(recipient_count)` เพราะ 1 alert event ส่งถึงหลาย recipient, window `30d` ลาเบล "~quota" ตรงกับ LINE Push Quota reset cycle
- **#151** Report History stats strip: windows 30d/90d/all (ไม่มี 24h/7d) — เหตุผล: volume ต่ำมาก (≤1 report/day/type) → 24h/7d ไม่มีข้อมูลเพียงพอ; by_type breakdown chips (Daily/Weekly/Monthly/Health) ซ่อนเมื่อ count=0 เพื่อลด noise; stats reload เฉพาะ offset=0 ไม่ยิงซ้ำขณะ paginate

---

## Decisions NOT yet moved (small, self-contained)

The following decisions are small enough to live here rather than in a LOGIC file:

| # | Decision | Status |
|---|---|---|
| #1 | Vanilla JS, no framework | Here (1 line, referenced by CLAUDE.md) |
| #2 | Self-hosted PostgreSQL | Here |
| #4 | MQTT subscriber as separate process | Here |
| #5 | No ORM | Here |
| #12–#14 | LINE alert system basics | [LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| #41–#46 | Hardening + ops scripts | Here |
| #73–#76 | Pagination + Events page | Here |
| #97 | package.json strip | Here |
| #128 | i18n engine | Here |
| #134–#135 | Operational roadmap | Here |
| #142–#145 | UI design system | [DESIGN.md](DESIGN.md) (canonical) |
| #146–#147 | Reproduce-first + guard tier | [CLAUDE.md](CLAUDE.md) Working Agreement #3 (canonical) |
| #148 | LINE recipient delete auto-saves immediately | [LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| #149 | LINE block list — 'blocked' status hard-ignores forever, separate from soft 'ignored' | [LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| #150–#151 | History Workspace stats summary strips — window picker design, quota label, type chips | Here (§ above) |
| #152–#154 | Security Fixes 2026-05-28 — SEC-001 EMQX localhost bind, SEC-002 escapeHtml, SEC-003 camera creds redact | Here (§ above) |
| #157–#160 | Security Preventive Invariants 2026-05-28 — must_change_password middleware, magic bytes upload, cookie flag builder, docker port bind rule | Here (§ above) |
| #155 | Camera grouping map filter → Option B (multi-group color-coded overlay, white fill + colored ring, legend toggle, visible-only stats) | [LOGIC_map-features.md § B](docs/LOGIC_map-features.md) |
| #156 | Live Pulse → Toast-on-map T2 (per-camera debounce, toggle, debounce dropdown) | [LOGIC_map-features.md § C](docs/LOGIC_map-features.md) |
| #161 | Wall Mode → Option 2+3 (CSS class toggle + Fullscreen API) for video wall display | [LOGIC_map-features.md § I](docs/LOGIC_map-features.md) |
| #162 | Legend Scaling → Tier 2 Auto-adapt (3-mode: compact/scroll/drawer based on group count) | [LOGIC_map-features.md § J](docs/LOGIC_map-features.md) |
| #163 | pg_notify moved after snapshot save — WS event carries snapshot_file ready | [LOGIC_map-features.md § C Bug Fixes](docs/LOGIC_map-features.md) · GOTCHAS #58 |
| #164 | SEC-001 Phase 2: EMQX per-camera MQTT auth — dual-bind LAN+localhost, ENABLE_AUTHN, per-camera built-in-DB users, provision script | GOTCHAS #50 · CHANGELOG 2026-05-28 |
| #165 | Camera Settings UI redesign — (1) Groups merged as sub-tab; (2) 2-col form layout; (3) OL mini-map click-to-pin in map section | CHANGELOG 2026-05-28 · commit `e6a4976` |
| #167 | Idea 4 — inline validation (dup ID + IP format, warn-only), Test Connection (TCP+HTTP auth, admin-gated), Live Snapshot Preview (server-proxy base64, 600KB cap) | CHANGELOG 2026-05-28 · commit `daea6b2` |
| #166 | SEC-001 Phase 3: EMQX auto-provision on Bosch camera save — Option A (transparent, 5s timeout, idempotent, non-blocking); fix silent mqtt_password erase bug; trust-boundary change compensated by mqtt_provisioned audit event | CHANGELOG 2026-05-28 · commit `9670613` |
| #168 | Map controls responsive — Option B Primary/Secondary split; 4 small fixes (stats-bar wrap, popup max-width, legend drawer max-width, toolbar-sub hide); CSS specificity trap note | [LOGIC_map-features.md § K](docs/LOGIC_map-features.md) · CHANGELOG 2026-05-28 |
| #169 | Camera offline alert — recipients field เปลี่ยนจาก text input เป็น checklist ดึงจาก line_config.recipients (admin-approved only); reuse lineConfigCache + pattern เดียวกับ alert_rules | CHANGELOG 2026-05-28 |
| #170 | Pre-commit token scan hook — lightweight bash script ใน `scripts/hooks/pre-commit`; patterns: Mapbox public/secret, AWS, GitHub PAT, Slack; bypass `--no-verify` สำหรับ false positive; gitignore ป้องกัน commit *ไฟล์* แต่ไม่ป้องกัน token *ภายใน* ไฟล์ที่ tracked — hook ปิด gap นี้ | SEC-012 · GOTCHAS #59 · `scripts/hooks/pre-commit` |
| #171 | **Map Settings sub-tab** — Done 2026-05-29. ย้าย MANAGE (tile manager modal) ออกจาก map toolbar → Settings › แผนที่ (อันดับ 3 ใน rail, หลัง ระบบ); Mapbox token ย้ายจาก `.env` → `system_settings` DB row `mapbox_token` (migration 029); `getMapboxToken()` DB-first + env fallback + module cache; hot-reload หลัง save ไม่ต้อง restart; ปุ่ม OFFLINE disabled เมื่อ `cachedTiles=0`; `PUT /api/settings/map` (requireAdmin, `pk.` validation, audit log, cache invalidate); tile-download endpoints ยังใช้ env (B1 per spec — ถ้า token เปลี่ยนผ่าน UI offline download ต้อง restart); modal `#mapMgrModal` ลบทิ้ง → HTML ย้ายเข้า `#mapMgrPanelContent`; opportunistic semantic token migration ครอบ HTML block ที่แตะ | `docs/LOGIC_map-features.md` § L · migration 029 |
| #173 | Design System Migration — incremental opportunistic (ห้าม big-bang); Q1: ใช้สีปัจจุบันเป็น baseline; Q2: legacy + semantic alias coexist หลายเดือน; Q3: new code หลัง Phase 0 ห้ามใช้ legacy token ตรงๆ; ลำดับ Phase 0 Foundation → **0.5 Visual Restraint** (ลบ gradient UI + glow + extra accent ใน ~30 นาที) → 1 Security Briefing → 2 CSS Classes → 3 Opportunistic → 4 Chart/Map → 5 Sidebar SVG → 6 Polish; ห้ามแตะ `report-renderer.js` SVG template ตลอด migration (GOTCHAS #25a) | [ROADMAP.md § Design System Migration](ROADMAP.md) |
| #172 | Executive Summary → **Security Morning Briefing** redesign — persona เปลี่ยนจาก "executive" เป็น Security Manager (เช้ามาดูภาพรวม ไม่ใช่ผู้บริหารดู PDF); layout 5 tier: Status Strip → Attention list (alerts 4h + offline cams) → Activity 24H + Today vs Yesterday → Site Map + Top Hotspots → footer; ตัด Traffic KPI / People KPI / Donut / Live feed; เปลี่ยนเป็น default page; เลิก `--es-*` namespace → main tokens; เลิก JetBrains Mono/Sarabun → Noto Sans Thai; Phase 2: `acknowledged` column + ปุ่ม Ack (admin) | [ROADMAP.md § Executive Summary → Security Morning Briefing](ROADMAP.md) |
| #174 | **icon-health** เปลี่ยนจาก EKG waveform → Shield — เดิม `icon-health` ใช้ path data เดียวกันทุกจุดกับ `icon-event` (waveform); render แยกไม่ออก; เปลี่ยนเป็น Feather-style shield (`M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z`) ซึ่งสื่อ "ความปลอดภัย/สถานะระบบ" ตรงกับ Health Check page context และไม่ซ้ำกับ icon อื่นใน sprite | `dashboard/index.html:1452` |
| #175 | **Opportunistic emoji cleanup — Event Categories** — UI chrome emoji (🏷️ heading, 🔒 lock note, ✏️ Edit, 🗑️, 🔗 Rules buttons, 💾 save) → SVG sprite / text; เพิ่ม `icon-edit` + `icon-trash` ใน sprite; "Icon (emoji)" free-text input → preset picker 12 chips (🚨⚠️🚶🚗🔥🚦📦👁🔔🚧🛑🎯) + custom fallback; icon field ทำ optional; downstream 11 จุด (filter `<option>`, Chart.js label, event badge) ยังเป็น emoji string เพราะ SVG ใส่ใน plain-text context ไม่ได้ — บันทึกเป็น ROADMAP | commits `4239d86`, CHANGELOG 2026-05-29 |
| #176 | **Boot page sync fix** — `page-summary` มี `active` ใน HTML (ถูกต้องตาม decision #172) แต่ cameras nav-item ยังค้าง `active` จากก่อน #172; `_initDashboard()` ไม่เรียก `showPage()` เลยทำให้ `loadSummary()` ไม่ถูก trigger; fix: ย้าย nav `active` cameras → summary + เพิ่ม explicit `showPage('summary', navEl)` ท้าย `_initDashboard()` | commit `691be75`, CHANGELOG 2026-05-29 |
| #177 | **Opportunistic emoji cleanup — LINE/Alerts (Option A)** — UI chrome emoji ใน heading (🔔→icon-bell), tab (📋→icon-list), save buttons (💾→icon-save), sub-headings, form labels, rule cards, recipient type chips (👥💬👤→text chip GRP/ROOM/USER) → SVG sprite หรือ text; strip จาก i18n th+en (ar.*, ln.*, common.refresh, common.saveBtn); Option B (decorative icons สำหรับ form labels โดยเพิ่ม ~9 sprites ใหม่) ถูก **reject** เพราะขัด restraint principle ใน DESIGN.md — form labels เป็น text ชัดอยู่แล้ว icon เพิ่ม visual noise โดยไม่เพิ่ม information; ยกเว้น: 🔕 Quiet Hours (GOTCHA #90) + LINE template body (LINE norm exemption) | commits `af82820`, CHANGELOG 2026-05-29 |

---

| #178 | **EMQX Regenerate Password** — `POST /api/cameras/:id/mqtt/regenerate` (admin-only); force-rotates MQTT password by stripping existing before provisioning; atomic write to cameras-config.json; audit log `mqtt_regenerated`; returns cleartext password as one-time reveal (intentionally NOT through `_redactCameraResponse` — this is the feature); UI: Regenerate button in Bosch-only MQTT creds section with confirm dialog warning camera will go offline; auto-clear display 60s; `cs.mqttRegen*` i18n keys (th+en) | commit 2026-05-29 |
| #179 | **Config file mtime cache** — `loadCameraConfig` / `loadGroups` / `loadMapAreas` ใน `api-server.js` เปลี่ยนจาก `readFileSync` ทุก call → module-level `{cache, mtime}` pair: อ่าน disk จริงเฉพาะเมื่อ `fs.statSync().mtimeMs` เปลี่ยน; `saveXxx()` reset mtime=0 เพื่อ invalidate ทันที; API sync ไม่เปลี่ยน (caller ไม่ต้อง refactor); eliminates per-request disk block บน `GET /api/groups` + camera handlers + 30s/60s background loops | commits `ba9a64f`, CHANGELOG 2026-05-29 |
| #180 | **Shared constants module** (`src/constants.js`) — `OFFLINE_THRESHOLD_SEC=90`, `METRIC_EVENT_FILTER`, `MQTT_HEALTHY_AGE_SEC=300` เคยนิยามแยกกันใน `api-server.js` และ `stats-summary-route.js` (พร้อม comment "matches api-server.js"); consolidate เป็น single export → import ทั้งคู่; eliminates silent drift risk ถ้า threshold เปลี่ยนฝั่งเดียว | commits `ba9a64f`, CHANGELOG 2026-05-29 |
| #181 | **SD probe parallel + pg_trgm + stats TTL cache** — (A) `pollAllSdStatus` ใน `mqtt-subscriber.js`: serial `for...await` → `Promise.all` batch=5; worst-case 20 cams: 80s→16s (ต่ำกว่า 30s interval แม้ all timeout); (B) migration 030: `CREATE EXTENSION pg_trgm` + `GIN index ON events(event_type gin_trgm_ops)` ให้ `NOT LIKE '%Aggregation%'` ใช้ index ได้ (leading-% pattern bypasses b-tree); regular CREATE INDEX ไม่ใช่ CONCURRENTLY เพราะ migrate.js ใช้ `BEGIN…COMMIT`; (C) 30s TTL cache สำหรับ `today-counts` + `exec-summary` — global slot each (no per-user params); exec-summary win ใหญ่กว่า (~15 queries + dirStats + diskStats) | commits `1d8853b` `75174e2` `b760590`, CHANGELOG 2026-05-29 |

| #183 | **Pricing model — Turnkey vs Platform Fee split** — Sale Price ในเอกสารเป็น Turnkey (HW+SW+Impl+MA+Hidden ครบ); G3+ ที่ลูกค้าซื้อ HW เอง ให้แตก quotation เป็น 2 ส่วน: CapEx (HW — ทรัพย์สินลูกค้า) + Platform Fee (SW+Impl+MA — DojoJin deliver); Hidden + HW refresh เป็น operating cost ฝั่งลูกค้า ไม่อยู่ใน Platform Fee; Platform Fee 5yr ~35% margin: G1=665K, G2=1.33M, G3=3.33M, G4=7.66M, G5=19.7M | `HARDWARE_SIZING_GUIDE.md` |
| #182 | **Deployment Profile axis (A/B/C) + MA model เปลี่ยน** — เพิ่มมิติที่ 2 ใน HARDWARE_SIZING_GUIDE.md: Profile A (Insights-only: stats/map/live/LINE ไม่เก็บ media), B (A + snapshot retention), C (Full = เดิม); LINE alert ใน Profile A ทำได้แบบ capture→send→discard; MA basis เปลี่ยนจาก 20%-of-HW → **12% × (HW+SW+Impl)** ต่อปี; SLA tier Bronze default (12%), Silver (18%), Gold (25%); xlsx ต้องซิงก์ด้วยมือเมื่อ SW cost ต่อ tier ชัดเจน | `HARDWARE_SIZING_GUIDE.md` |

| #184 | **IVA Pro Appearance — dual schema + PDPA handling** — (A) **Dual schema rationale:** `appearances` table มี 2 ชุดคอลัมน์: ชุดเก่า (`upper_color/lower_color/vehicle_*`) = human-readable สำหรับ 3rd-party view + reporting; ชุดใหม่ (`top_category/hair_length/top_color_xyz` ฯลฯ) = raw IVA Pro payload ดิบ. เก็บทั้งสองไว้: ชุดใหม่เข้า DB ตอน ingest, `upper_color`/`lower_color` compute ใน Node ผ่าน `xyzToColorName()` (`src/color-utils.js`) แล้ว INSERT พร้อมกัน. (B) **Color naming:** XYZ payload ของ Bosch = sRGB; ใช้ achromatic-first + Euclidean nearest-neighbor กับ 15-color palette (verified กับ 9 distinct values จาก live DB 2026-06-01). (C) **PDPA — view grant policy:** `v_appearances_public` ขยายจาก 14 → 19 columns (migration 032); **ไม่มี GRANT ใดๆ** ใน migration — grant ต้องทำมือหลังมี Data Sharing Agreement ครอบคลุม gender/top_category/hair_length/glasses/helmet_wear; appearance data = ข้อมูลส่วนบุคคลระดับ sensitive ตาม PDPA. (D) **Retention policy — pending:** ยังไม่กำหนด retention period หรือ anonymize strategy; ต้องตัดสินใจ: กี่วัน? delete vs anonymize? ก่อน go-live multi-tenant. ดู GOTCHAS #62–#63 · BOSCH_IVA_Appearance.MD | `BOSCH_IVA_Appearance.MD` · `db/db_migration_031_appearance_attrs.sql` · `db/db_migration_032_appearances_view.sql` · `src/color-utils.js` |

---

| #185 | **Light Mode opt-in** — เพิ่ม light theme ผ่าน `html[data-theme="light"]` override raw legacy token (`--bg/--panel/--text` ฯลฯ); semantic alias flip อัตโนมัติ (ไม่ต้องรอ migration #173 เสร็จ); default = dark (สถานะเดิม), opt-in ผ่าน toggle ใน user dropdown; persist `localStorage('dashboard_theme')`; FOUC prevention = inline head-script ก่อน stylesheet; toggle ใช้ `location.reload()` mirror pattern lang toggle; Chart.js re-theme อัตโนมัติผ่าน `token()` + reload; **scope ล็อก:** Report PNG = fix brand (ไม่ตาม theme), map tiles = dark คงเดิม, OL text stroke pin เป็น `#0a0e1a`; WCAG AA ยืนยัน green/red/amber บน white surface | `DESIGN.md §10` · `dashboard/index.html` · `dashboard/dashboard.js` |
| #186 | **flatpickr → air-datepicker (B1–B4)** — ย้าย date/time picker ทั้งระบบ (17 inputs, 6 หน้า) จาก flatpickr → AirDatepicker v3.5.3 (มีอยู่แล้วใน vendor); **key decisions:** (1) inputs ทุกตัวต้องเปลี่ยนเป็น `type="text"` (ADP เขียน display format string ลง element โดยตรง — ไม่มี altInput; browser reject non-ISO string บน typed input เงียบ → GOTCHAS #64); (2) `getDtValue(id)` seam function อ่านจาก `selectedDates[0]` ไม่ใช่ `el.value` (ADP display format ≠ machine format); (3) `setDtValue` dual-aware ผ่าน `el._adp` (ADP `.selectDate()`) vs `el._fp` (flatpickr `.setDate()`); (4) flags `el._adpDateOnly` / `el._adpIsMonth` บอก getDtValue ว่าต้อง format แบบไหน; (5) month picker ใช้ `view:'months'` + `minView:'months'` ไม่ต้องการ plugin; (6) flatpickr vendor 6 ไฟล์ลบออก | commits `80ba51b` · GOTCHAS #64 |
| #187 | **ADP isMobile:true บน ≤768px** — `isMobile:false` บน mobile = popup inline → overflow viewport + soft keyboard ปิดไม่ได้ (`blur()` ไม่ทำงานบน Android Chrome); แก้ด้วย `isMobile: window.innerWidth <= 768` — ADP ใช้ modal overlay บน mobile (จัดการ keyboard + positioning เอง); desktop (>768px) ยังใช้ inline popup; ใช้กับ picker init functions ทั้ง 3 ตัว (`initDateTimePickers`, `_initAppDatePickers`, `_initAppCustomPickers`) | commit `03d8f67` · GOTCHAS #65 |
| #188 | **Drop `appearances.snapshot_b64`** — column ถูกเขียนโดย mqtt-subscriber ทุก appearance event แต่ไม่มี API endpoint ใดอ่านเลย (`appearances/search` + `/stats` ใช้ `e.snapshot_filename` จาก events แทน; `v_appearances_public` ตั้งใจ exclude ไว้); ที่ scale 100K detections/วัน column TEXT base64 นี้โตประมาณ ~1GB/วัน เป็น dead weight; ตัดสินใจ drop ทิ้ง (455 existing rows discarded, user confirmed); migration 035; mqtt-subscriber INSERT อัปเดตแล้ว | commit `142b827` · GOTCHAS #67 |
| #189 | **Batch retention DELETE** — `DELETE FROM events WHERE event_time < $cutoff` บนตาราง 73M แถว hold ACCESS EXCLUSIVE lock ตลอด duration (~5–30 นาที) → กล้องส่ง event ไม่ได้; แก้ด้วย `_batchDelete()` helper ลบครั้งละ 10,000 แถว (id-IN-subquery, แต่ละ batch = transaction สั้น, yield 100ms); ใช้กับ events + appearances retention; ตาราง small (status_log, report_history) คงเดิม | commit `b76918c` · GOTCHAS #68 |
| #190 | **Cache `appearances/stats` 30s TTL** — endpoint รัน 8 parallel aggregation queries ทุก page load โดยไม่มี cache เลย (ต่างจาก today-counts + exec-summary ที่มี 30s TTL จาก decision #181); เพิ่ม `_appStatsCache` keyed by `from|to|camera_id`; first load ยัง hit DB, subsequent identical queries ภายใน 30s return cached | commit `b76918c` |

| #191 | **Security session 2026-06-01 — camera credential location corrected** — audit พบว่า `cameras.http_password` + `cameras.rtsp_url` ใน DB ไม่มีโค้ดเขียนหรืออ่านเลย (dead); credential จริงอยู่ใน `cameras-config.json` (plaintext: `username/password/mqtt_password` ต่อกล้อง); ไฟล์ gitignored ✅ แต่ permissions `-rw-r--r--` (world-readable ❌ ก่อน fix); SEC-013: `chmod 600 cameras-config.json` (pattern เดียวกับ src/.env, decision #120) | GOTCHAS #69 · REF_security-checklist.md SEC-013 |
| #192 | **Camera credential at-rest encryption — deferred pending threat-model** — credential ต้องเป็น symmetric (AES-256-GCM) เพราะต้องถอดรหัสใช้จริงที่ runtime (HTTP Digest/Basic/ONVIF); key ใน `src/.env`; ป้องกัน: leaked backup/dump/config share; ไม่ป้องกัน: host-level filesystem read (ต้องการ external secret store); งานที่ต้องแตะ: mqtt-subscriber.js + hikvision-isapi.js + dahua-cgi.js + api-server.js (MQTT regenerate write path) + migration utility encrypt existing values; **เงื่อนไขทำ:** owner ยืนยัน threat model (leaked backup vs host compromise) | ROADMAP security deferred |
| #193 | **Drop dead columns cameras.http_password + cameras.rtsp_url — DONE 2026-06-02** — ไม่มี INSERT/UPDATE/SELECT ใดในโค้ดทั้งหมด (grep src/ + dashboard/ = 0 match); ไม่มี view expose; ค่า DB = NULL ทุกแถว (verified live); migration 038; `init.sql` updated; `cameras.http_user` deferred แยก | GOTCHAS #70 · SEC-015 |

---

| #194 | **Camera credential at-rest encryption (SEC-014)** — AES-256-GCM encrypt `password` + `mqtt_password` ใน `cameras-config.json`; format `enc:v1:<base64(iv∥tag∥ct)>` (self-identifying); decrypt-at-load seam ใน 4 processes (api-server, mqtt-subscriber, hikvision, dahua) → downstream read sites ไม่เปลี่ยน; encrypt-at-save เฉพาะ `saveCameraConfig()` ใน api-server; plaintext passthrough เมื่อไม่มี prefix (tolerant deploy ก่อน migrate); key ใน `src/.env` `CAMERA_SECRET_KEY`; `scripts/migrate-creds-encrypt.js` idempotent one-shot migration; ป้องกัน leaked backup/config share; ไม่ป้องกัน host-level read (acceptable threat model สำหรับ on-prem); **⚠️ ต้องหยุด services ก่อนรัน migration** (GOTCHAS #72) | `src/crypto-creds.js` · GOTCHAS #71 · GOTCHAS #72 |
| #195 | **PostgreSQL SSL enable — SEC-016 (2026-06-02)** — `ssl=on` via `ALTER SYSTEM` + `SELECT pg_reload_conf()` (zero-downtime; GUC context=sighup); self-signed cert 3650d generated on host (openssl not in alpine), written via base64 pipe (docker cp blocked by stale bind mount from rename); cert in `vigil_postgres_data` volume (`server.crt` 644 / `server.key` 600 / owner postgres:70); TLSv1.3 verified via `pg_stat_ssl`; local apps unbroken (connect `127.0.0.1/32 trust` — ssl=on = available, not required); pg_hba NOT changed (`hostssl` enforcement deferred until remote port opens + subnet known); `scripts/postgres-ssl-setup.sh` idempotent run-once for fresh volume | SEC-016 · REF_third-party-integration.md §3.6 |
| #196 | **Camera Pause / Maintenance Mode** — เพิ่ม `cameras.paused BOOLEAN DEFAULT FALSE` (migration 037); ห้ามใช้ `cameras.enabled` เพราะ Watchdog เขียนทับ enabled ทุก cycle; dual-write: DB + cameras-config.json ผ่าน `PATCH /api/cameras/:id/pause`; scope: per-camera เท่านั้น (ไม่มี group-pause), resume = manual only (ไม่มี auto-expire); 5 skip touch-points: mqtt processMessage early-return, Hik/Dahua loadCameras filter(!paused), watchdog continue, status query paused-beats-heartbeat; camera_status_log constraint extend +paused +resumed; unpause: stamp `last_seen_at=NOW()` เฉพาะ `wasOnline=true` (จาก `RETURNING enabled` atomic — ไม่แตะ offline camera); uptime ไม่นับ paused เป็น downtime (SQL counts only `status='offline'`); `icon-pause` SVG + `badge-paused` CSS; i18n th+en; GOTCHAS #76 | migration 037 · commits `d9e025e` · GOTCHAS #75 #76 |
| #197 | **Mapbox tile proxy — SEC-017 (2026-06-02)** — `GET /api/map/tiles/mapbox/:style/:z/:x/:y.png` auth-gated (under `/api` middleware); cache-check first reusing `MAP_CACHE_DIR/mapbox/` (same tree as /api/map/download); on miss: Node https.get → write cache → return PNG; `/api/config` drops `mapboxToken` field, returns `mapboxAvailable: !!token` only; `dashboard.js` proxy URLs instead of direct `api.mapbox.com` with `access_token=`; settings form no longer prefills token; CSP `api.mapbox.com` entries removed (browser no longer hits Mapbox directly) | SEC-017 · DECISIONS #60 |
| #198 | **PM2 — replace concurrently as process manager (2026-06-03)** — ตัดสินใจ pull forward 2026-06-02; implement 2026-06-03: `ecosystem.config.js` ที่ root (5 apps; `cwd: src/`; `NODE_NO_WARNINGS=1`; `min_uptime:10s`; `restart_delay:3000`; `max_restarts:15`); `scripts/services.sh` ปรับเป็น PM2 thin-wrapper (start/stop/restart/status/logs); `singleton.js` compatible กับ PM2 autorestart ไม่ต้องแก้ (liveness-check `process.kill(pid,0)` self-heal stale PID); `concurrently` deprecated; live cutover แยก step รอ confirm; ประโยชน์: autorestart per-service, `pm2 jlist` แทน pgrep (fix api-server 0x bug), api-server restart ตัวเองได้ผ่าน daemon, prerequisite ของ Service Management UI | `ecosystem.config.js` · `scripts/services.sh` · ROADMAP "Service Management UI" section |

| #199 | **Service Management UI — Health page PM2 control panel (2026-06-03)** — ขยาย Health Check page: card "Service Processes" เปลี่ยนจาก pgrep count เป็น PM2 status full (online/stopped/errored + restarts + uptime_ms); เพิ่มปุ่ม Restart/Stop/Start per-service; `GET /api/health/details` ใช้ `execFileSync('pm2',['jlist'])` parse JSON; `POST /api/services/:name/:action` (admin-only; `_SVC_NAMES` + `_SVC_ACTIONS` allowlist; `execFile` array args ป้องกัน injection; audit_log ทุก attempt; **api-server stop/start rejected server-side + UI-hidden** — self-destruction guard: stop api-server = dashboard ตาย ไม่มี recovery ผ่าน UI); api-server restart: `expect_reconnect:true` + `_pollApiServerRecovery()` (1s interval, 30 retries, banner); frontend `_svcCard()`: left col = name+uptime sub-line, right col = badge+buttons (≤180px fit 280px card); `admin-only` class กรอง auditor ออก | `src/api-server.js` · `dashboard/dashboard.js` · `dashboard/i18n.js` · DECISIONS #198 |

---

| #200 | **Modular Monolith over Full Microservices** — ระบบมี 5-process SOA ผ่าน PM2 + pg_notify อยู่แล้ว (mqtt-subscriber, media-recorder, hikvision, dahua แยกแล้ว); inter-process comm = pg_notify ไม่ใช่ shared memory; deployment model = 1 host/customer → ไม่ได้ประโยชน์จาก scale service แยก; "monolith" ที่แท้จริงคือ `api-server.js` god-file 6,615 บรรทัด → แก้ด้วย opportunistic route module extraction (`src/routes/*.routes.js`) ไม่ใช่ process split; full microservices = distributed transaction overhead ไม่จำเป็น + ขัด deployment model; MAINT-2T-001 จาก CODEX audit corroborate แนวทางนี้ | [`microservice_plan.md`](microservice_plan.md) |
| #201 | **Phase ordering: security fixes ก่อน refactor** — security items ที่อิสระจาก route refactor (lockfile, PM2 docs, .DS_Store, cred-guard) ต้องทำก่อนเสมอ ไม่รอ Phase A; SEC-2T-001 (/others origin) + SEC-2T-002 (CSP enforce) ต้องทำก่อน route split เสมอ เพราะ origin isolation เป็น prerequisite ที่แยกอิสระ; SEC-2T-002 ตาม SEC-2T-001 ไม่ใช่ตาม refactor (ถ้า /others ย้าย origin → CSP strict ได้ทันที); ลำดับ: Phase 0 (parallel, immediate) → Phase 1 (origin fix) → Phase 2 (route split + security merges) | [`microservice_plan.md`](microservice_plan.md) · `CODEX_AUDIT_2ndTier.md` |
| #202 | **SEC-2T-001 approach — delete unused + auth-gate remaining** — ตรวจพบ 4 จาก 10 ไฟล์ใน `public/others/` มี CDN third-party; 4 ไฟล์ไม่ได้ใช้แล้ว (`index.html` EmailJS, `vss_v1.html` Materialize, `partners.html`, `reference-projects.html`) → ลบทิ้ง (CDN risk EmailJS + Materialize หายทันที); `boxbox-th/en.html` (Cytoscape CDN) ยังใช้งานอยู่ → auth-gate (ไม่ต้องการ public จริง เป็น diagram เทคนิค); ตัดสินใจไม่ self-host CDN ก่อน เพราะ same-origin localStorage ยังอ่านได้อยู่ดีถ้าไม่ auth-gate; Option B (self-host) แก้ CDN supply chain แต่ไม่แก้ origin isolation | `public/others/` · [`microservice_plan.md`](microservice_plan.md) Phase 1a |
| #203 | **CSP violation reporter เป็น burn-down metric ก่อน migrate** — เพิ่ม `POST /api/csp-report` endpoint + log ทุก directive/blocked/source ลง stderr (pm2 logs) ก่อนทำ migration ใดๆ; ทำให้เห็น ground-truth violation count จาก browser จริง ไม่ใช่แค่ grep source; ใช้ `Content-Security-Policy-Report-Only` header (Report-Only) เพื่อไม่ block ผู้ใช้ระหว่าง migration; ลำดับ: reporter → enforce `/others` (ไม่มี inline) → migrate dashboard ไปเรื่อยๆ จนไม่มี violation | commits `0661b31` `959c52c` · CHANGELOG 2026-06-05 |
| #204 | **Global dispatcher pattern สำหรับ dynamic innerHTML handlers** — handlers ที่อยู่ใน JS template literals (set via innerHTML) ต้องใช้ event delegation ไม่ใช่ direct `addEventListener` เพราะ element ถูก re-create ทุกครั้งที่ render; pattern: `document.addEventListener('click', e => { const action = e.target.closest('[data-action]')?.dataset.action; ACTION_MAP[action]?.(el, e) })` + `ACTION_MAP` object keyed by action name; non-click events (change/input/submit ฯลฯ) ใช้ `data-trigger` + แยก dispatcher ต่างหาก; ข้อดี: handler เป็น pure function ทดสอบได้, permission gate ทำใน 1 จุด (ก่อน dispatch), ไม่ต้องจัดการ re-bind หลัง innerHTML update | `dashboard.js _bindDynamicHandlers` · CHANGELOG 2026-06-05 |
| #205 | **img onerror → data-err + window capture listener** — `onerror=` attribute ใน HTML ที่ set via innerHTML โดน `script-src-attr` block เช่นกัน; ใช้ `window.addEventListener('error', fn, true)` (capture phase — `true` จำเป็นเพราะ `error` event ไม่ bubble จาก `<img>`); เพิ่ม `data-err` vocab บน img element: `hide / dim / cam-placeholder / cam-span / face-noimg / no-img`; handler เดียวที่ root ทำงานให้ทุก img ในทุก dynamic section — ไม่ต้อง re-bind หลัง re-render; pattern นี้ reusable: เพิ่ม vocab ใหม่ใน switch case ได้โดยไม่แตะ template | `dashboard.js _bindDynamicHandlers` · GOTCHAS #79 · CHANGELOG 2026-06-05 |
| #206 | **Externalize inline `<script>` blocks** — `script-src-elem` block inline `<script>` ที่ไม่มี `src=` (ต่างจาก `script-src-attr` ที่ block event handler attribute); fix: ย้าย script content ออกเป็นไฟล์ `.js` แยก + ใช้ `<script src="/file.js">` แทน; 4 ไฟล์ที่ externalize: `theme-init.js` (FOUC guard, ต้องรันก่อน CSS), `login.js`, `disclaimer.js`, `report-print.js` (Puppeteer render target — Chrome headless ก็ respect CSP); ทั้ง 4 ไฟล์ serve ผ่าน `express.static(dashboard/)` ที่มีอยู่แล้ว ไม่ต้องเพิ่ม route | commits `93b1c22` · CHANGELOG 2026-06-05 |
| #207 | **CSP connect-src: allowlist cloudflareinsights.com** — CF analytics beacon (`static.cloudflareinsights.com`) ถูก allowlist ใน `script-src` แล้ว แต่เมื่อ beacon โหลดแล้วมัน POST telemetry ไปยัง `cloudflareinsights.com` (ไม่มี `static.` prefix) ผ่าน fetch — ต้องเพิ่มใน `connect-src` ด้วย; เป็น 3rd-party telemetry POST — platform ใช้ CF Tunnel อยู่แล้ว → เป็น intentional decision ที่รับรู้แล้ว; ถ้า PDPA-sensitive ให้ drop CF analytics module แทนการ restrict | `src/api-server.js` · CHANGELOG 2026-06-05 |

---

<sub>End of DECISIONS.md (index) · Companion to CLAUDE.md · Updated 2026-06-08 (decisions #152–#207)</sub>
