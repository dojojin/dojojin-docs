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
| #208 | **LPR plate "unknown" แสดงเป็น "อ่านไม่ออก" (no-read) ไม่ใช่ "ไม่ทราบ"** — กล้องส่ง `plate='unknown'` เมื่อ OCR ป้ายไม่สำเร็จ (46 แถว = 6.9% ของ anprAlarm; ยังมี vehicleType/color/brand ครบ). เลือกคำ **"อ่านไม่ออก"** เพราะ: (1) ตรงกับ ANPR **no-read** concept มาตรฐาน; (2) เป็น KPI วัดสุขภาพกล้องได้ (no-read rate สูง = มุม/แสง/โฟกัสมีปัญหา); (3) plate = **primary identifier** ที่อ่านล้มเหลว ≠ attribute ที่ไม่รู้ค่า (จังหวัด/สีป้าย = "ไม่ทราบ") → แยกคำ = แม่นยำขึ้น ไม่ใช่ inconsistency; (4) actionable. **Rejected:** "ไม่ทราบ" (เสียความแม่นยำที่ identifier เพื่อความเรียบ — ไม่คุ้ม), "ไม่มีป้าย" (over-assert; แยกไม่ได้ว่าไม่มีจริงหรืออ่านไม่ออก). ทำใน Phase F (LPR port) — helper เดียวใน `lpr-plaque.js`. **⟳ REVISED 2026-06-30 → "ไม่ระบุ":** ตอนค้นหาจริงเจอกำแพงการ์ด "อ่านไม่ออก" 4,461 ใบ → อ่านเหมือนระบบ "อ่านพลาดรัวๆ" (ภาพลักษณ์แย่ต่อเจ้าหน้าที่ที่มาตรวจ). เปลี่ยนเป็น **"ไม่ระบุ"** (เป็นกลาง/ทางการ) ทุกที่ — card/plaque + KPI + filter + report, th+en=**"Unspecified"** (i18n `lpr.noRead/kpiNoRead/hasPlateNo` + `rpt.noRead`). เหตุผล #208 เดิม (health-KPI) ไม่เสีย เพราะ ops อ่านจาก **จำนวน** ไม่ได้พึ่งคำ. owner-approved | `docs/superpowers/plans/2026-06-18-lpr-receiver.md` (Phase F) · 2026-06-19 · rev 2026-06-30 |


| #209 | **Edge node architecture — EDGE_MODE guard pattern (VIGIL-ARCH-003)** — edge box (N150/Ubuntu) รัน ingester เดียวกันกับ central แต่ guard ด้วย `EDGE_MODE=1` ใน `.env`; ingester skip DB insert + publish pre-normalized row ไปยัง local NanoMQ แทน (ผ่าน `publishEdgeEvent()` ใน `src/edge/publisher.js`); NanoMQ bridge ขึ้น central EMQX ผ่าน WSS (`src/edge/bridge.js`); pattern เลือก **additive guard** ไม่ใช่ fork เพราะ (a) ไม่ duplicate ingester logic, (b) vendor ใหม่เพิ่ม guard เดียว, (c) test path เดียวกัน; images ไม่ผ่าน MQTT (เฉพาะ `_preview_ref` filename) — ป้องกัน 256MB packet storm; GOTCHAS #97–#99 | `src/edge/publisher.js` · `src/edge/bridge.js` · `docs/REF_edge-install.md` · `docs/LOGIC_edge-ingester-divergence.md` |
| #210 | **`src/edge/` directory สำหรับ edge-only runtime** — แยก `bridge.js` + `publisher.js` ออกจาก `src/helpers/` ลงใน `src/edge/` เพื่อให้ชัดว่า edge-only ไม่ใช่ shared utility; `helpers/` = central utilities เท่านั้น; ingesters require `'../edge/publisher'` (relative path); เหตุผล: ลด confusion ตอน onboard + ป้องกันการ import edge runtime ใน central deploy โดยไม่ตั้งใจ (central ไม่มี `EDGE_MODE=1` → guard block ไม่ทำงาน แต่ module load ยังเกิด) | `src/edge/` · `ecosystem.edge.config.js` |
| #211 | **LPR search = keyset pagination (P1)** — `/api/lpr` เปลี่ยนจาก `OFFSET + exact COUNT(*)` (ทั้งคู่ O(N) → ช้าตาม N, เป้า ~10M row/เดือน) เป็น **cursor keyset**: params `before_time`/`before_id` → `WHERE (event_time,id) < (cursor)`, `ORDER BY event_time DESC, id DESC`, `LIMIT+1`→`X-Has-More`; estimate นับผ่าน `EXPLAIN` (`count=est` → `X-Estimated-Count`) แทน exact COUNT; **ลบ `X-Total-Count`**. index `idx_events_time_id` (migration 071). **Trade-off:** เสีย jump-to-arbitrary-page → UI เป็น Prev/Next + jump-by-date (filter "ถึง"). `OFFSET` ยังรองรับ latest-grid/CSV. GOTCHAS #105 | `db/db_migration_071_lpr_keyset_index.sql` · `src/routes/lpr-query.js` · `dashboard/page-lpr.js` |
| #212 | **rawXml time-retention (class D)** — `enforceRawXmlRetention()` strip `raw_json - 'rawXml'` จาก events เก่ากว่า `rawxml_retention_days` (default 90, migration 074) batched daily; rawXml = ~90% ของ events table แต่ debug-only. field ที่ใช้จริง (plateType/region/plateColor/seatbelt/helmet/…) parse เป็น **top-level key/column ตั้งแต่ ingest** แล้ว → strip เสียแค่ `plateCharBelieve`/`licenseBright` ที่ยังไม่ใช้. หน้าต่างเวลา = safety net ให้ columnize analytic ที่เพิ่งเปิดก่อน rawXml หมดอายุ. ผู้อ่าน runtime ตัวเดียว = modal seatbelt remark → degrade graceful | `src/api-server.js` · `db/db_migration_074_rawxml_retention_setting.sql` |
| #213 | **anprAlarm decouple จาก general retention (class E)** — `enforceRetention()` เพิ่ม `event_type IS DISTINCT FROM 'anprAlarm'` → LPR row อยู่ใต้ `lpr_retention_days` ตัวเดียว (`enforceLprRetention` sole authority) เพื่อให้ slim plate-log อยู่ยาวกว่า general events ได้. **Mechanism only** — ค่ายังคง 30 (no-op วันนี้); **การตั้งเป็นปี GATED on P2/2B partitioning** (240M row บนตาราง flat + batched DELETE = ปัญหาที่ partitioning ตั้งใจเลี่ยง). GOTCHAS #107 | `src/api-server.js` (`enforceRetention`) |
| #214 | **Edge snapshot retention — edge-bridge เป็น pruner** — edge (N150) ไม่มี api-server → ไม่มี retention → disk เต็ม. `src/edge/snapshot-retention.js` (ใหม่): hourly async **dir-age drop** date-dir ใต้ `snapshots/events/` เท่านั้น (guards: date-regex, ไม่ walk root, refuse unset/'/'', UTC cutoff, NaN→default), env `EDGE_IMAGE_RETENTION_DAYS` (default 7); ไม่แตะ `lpr/` (primary evidence). inventory (oldest date + dir count) เข้า heartbeat → `edge_status.snapshot_oldest/snapshot_dirs` (migration 072, COALESCE กัน NULL clobber) → แสดงการ์ด Edge หน้า Health. **P2/2A** parallel: `license_plates.no_seatbelt` column (migration 073) แทน filter LIKE rawXml. GOTCHAS #106 | `src/edge/snapshot-retention.js` · `src/edge/bridge.js` · `db/db_migration_072_edge_snapshot_status.sql` · `db/db_migration_073_lpr_no_seatbelt_column.sql` |
| #215 | **`plateColor` normalize ที่ ingest จุดเดียว, ไม่ patch ทีละ query** — กล้อง LPR ต่างรุ่น (`DS-TCG405-E` vs `iDS-2CD9396-HIS`, ยืนยันผ่าน ISAPI probe จริง) ส่ง `<plateColor>` คนละ casing/token (`White` vs `white`, `Color` vs `colorful`) → แยกเป็นคนละแถวในกราฟ + **filter สีป้ายพลาดแมตช์เงียบๆ** (exact-match เดิม). เลือก normalize ที่ `lpr-core.js`'s `parseAnprXml()` (ingest choke point เดียว) แทนแก้ query 3 จุดใน `lpr-query.js` แยกกัน — ปิดรอยรั่วให้ทุก consumer (กราฟ/filter/detail/export) พร้อมกันครั้งเดียว ไม่ต้องพึ่งให้คนอ่านโค้ดจำ pattern ซ้ำทุกจุดที่ query ในอนาคต. `Color→colorful` (alias เดียว, ยืนยันจาก owner ว่าเป็นหมวดเดียวกัน = ป้ายประมูล จากการดู snapshot จริง) ที่เหลือ lowercase-fold ล้วน. Migration 079 backfill 2,876 แถวเก่า (idempotent). GOTCHAS #108 | `src/lpr-core.js` · `db/db_migration_079_normalize_plate_color.sql` |

---

| #216 | **Multi-site RBAC — `getAllowedSites()` + `siteWhere()` เป็น standard resolver ทุก endpoint ที่มี site scope** — แทนที่จะให้แต่ละ route เขียน site-filter SQL เอง ใช้ `getAllowedSites(user, pool)` (คืนรายชื่อ site ที่ user เข้าถึงได้ ตาม `user_sites`) + `siteWhere(allowedSites, camCol, offset)` (คืน SQL fragment `AND camCol IN (...)` พร้อม parameterized placeholder) จาก `src/auth.js` เดียวกันทุกจุด — เลือก **shared resolver function ไม่ใช่ RLS (Row Level Security)** เพราะ deploy model เดิมเป็น single Postgres role ต่อ app process (RLS ต้องรื้อ connection/role model) และง่ายกว่าที่จะ audit เป็นจุดเดียว (`grep siteWhere`) แทนต้อง review policy definition กระจายในหลาย schema object. Rollout 2026-07-02–03 ครอบ 49 call site / 9 route file (Events/Snapshot/Media/Face/Appearance/LPR/Stats/Reports/Alerts/Groups/Sites/Map). **Trade-off ที่ยอมรับ:** fail-open ถ้า route ใหม่ลืมเรียก `siteWhere()` (ไม่มี default-deny กลาง) — ต่างจาก RLS ที่ fail-closed โดย DB เอง; Tier-2 RLS ยังอยู่ ROADMAP เป็น defense-in-depth เพิ่มเติม ไม่ใช่ blocker ของ pattern นี้ | `src/auth.js` (`getAllowedSites`/`siteWhere`) · docs `8d27f40` · CHANGELOG 2026-07-02–06 |
| #217 | **Dahua multi-channel NVR — 1 eventManager+snapManager ต่อ NVR (ไม่ใช่ต่อ channel), route ผ่าน `index=N`** — NVR ตัวเดียวมีหลาย channel (กล้องย่อยหลายตัวต่อ 1 physical device) แต่ Dahua HTTP API ส่ง event stream รวมทุก channel มาในบรรทัดเดียวกันพร้อม field `index=N` (0-based) บอกว่ามาจาก channel ไหน — เลือก group connection ตาม `device_id` (หรือ `ip:port:user` เมื่อไม่มี device_id) ให้ config entry ที่ share connection identity ใช้ eventManager + snapManager stream เดียวร่วมกัน แทนเปิด 1 คู่ต่อ channel (ซึ่งจะเปิด connection ซ้ำไปยัง NVR ตัวเดียวกันหลายรอบโดยไม่จำเป็น + เสี่ยงชนกับ concurrent-session limit ของ NVR). เพิ่ม per-channel `capture_categories` เป็น two-stage filter: device subscription = union ของทุก channel ที่ต้องการ, แล้ว post-filter เป็นรายเหตุการณ์ตาม channel ที่ subscribe จริง. Live-verify กับ `DHI-NVR5216-16P-I/L` จริง (HDY site, 2 channel) ยืนยัน 1 event stream + 1 snap stream เท่านั้น (ไม่ใช่ 2 คู่) พร้อม routing/`object_class` ถูกต้องจาก event จริง | `src/ingesters/dahua-cgi.js` · `docs/superpowers/plans/2026-07-15-dahua-nvr-multichannel.md` |
| #218 | **Dahua NVR-stored face crop/scene ผ่าน RPC2 session แทน `captureFrame()` สด สำหรับ `FaceComparision`** — NVR เก็บ face crop (`ObjPath`) + scene เต็ม (`OriPath`) ไว้ในเครื่องอยู่แล้วทุก event `FaceComparision` — ใช้ของที่มีอยู่แล้วแทนสั่งกล้อง capture frame สดผ่าน `captureFrame()` ซึ่งวัดจริงพบ success ceiling เหลือ ~50-63% เมื่อ NVR โหลด AI สูง (เวลา capture ค้างหลายนาที). Mechanism (`/IntelliStorage/mnt/<file>:<len>.jpg` ตรงด้วย `WebClientSessionID` cookie จาก RPC2 login, **ไม่ใช่** `/RPC_Loadfile` prefix ซึ่งค้าง) ground-truth จาก DevTools network capture ของ NVR web UI เอง ไม่ใช่เดาจาก vendor doc. `src/ingesters/dahua-rpc.js` ใหม่: session cache + keepAlive + re-login-once-on-401, `fetchStoredFile()` คืน `Buffer|null` เสมอ (**ไม่ throw** — ingestion ต้องไม่พังเพราะ fetch เสริมล้มเหลว), `captureFrame()` เหลือเป็น fallback สำหรับ event ที่ไม่มี stored path | `src/ingesters/dahua-rpc.js` · `src/ingesters/dahua-cgi.js` (EDGE_MODE branch) |
| #220 | **CODEX audit 5th (optimization) — ปิดครบ 10/10 finding ที่เหลือจาก decision #219 ภายในรอบเดียว (2026-07-22), รวม CEN-005 = "วัดแล้วไม่ทำ" ไม่ใช่ "ยังไม่ทำ"** — ต่อจาก #219 (triage 3 กลุ่ม) เจ้าของไฟเขียวให้ไล่ทำกลุ่ม A+B ทีละ finding ตาม WA (audit ก่อน + reproduce/verify หลัง ทุกจุด): **CEN-002** (LPR image retention fast-path — dir-age `rm -rf` ทั้งวันแทน per-file stat/unlink เมื่อทั้งวันหมดอายุแน่นอน, mirror `edge/snapshot-retention.js`), **CEN-003** (partition `events` — รัน**จริงบน production**หลัง rehearse 2 รอบบน restored backup เจอ+แก้ FK drift 3 ตัวที่ script เดิมไม่รู้จัก ก่อนรันจริง; downtime วัดจริง ~90.7s ไม่ใช่ตัวเลข "3-15s" เดิมที่ยังไม่เคยวัดที่ scale จริง), **CEN-004** (`/api/lpr/stats` temp-table + TTL cache), **CEN-006** (edge-proxy thumbnail in-memory cache, ไม่แตะ "ไม่เก็บสำเนาที่ central" ของ PDPA), **EDGE-002** (SD-status poll stagger — เฉพาะ Bosch onvif poll, ไม่ใช่ global limiter เต็มรูปแบบตามที่ audit ขอ — เหลือเป็น partial), **EDGE-003** (NanoMQ packet size 256MB→4MB deploy แล้ว 2 site; HTTP body limit **ตั้งใจไม่ทำ** เพราะตัวเลขที่วัดได้เป็น post-resize ไม่ใช่ pre-resize เสี่ยง reject ไฟล์กล้องจริง), **EDGE-004** (เปลี่ยนจาก "recurring cron" ตามที่ audit เสนอ เป็น **"trigger-on-Save"** ตามที่เจ้าของเสนอเอง — เจอบั๊กจริงตอน live-test (`WHERE camera_id=` ผิด ต้องเป็น `WHERE id=`) แก้ก่อน commit), **EDGE-005** (delete-media command channel ใหม่ ผูกกับ `keepData` flag เดิม, reject-then-use validation กัน `..`/`.`/malformed camera_id, exact-match กัน prefix collision เช่น "CAM1" ลบ "CAM10" — live-test synthetic camera_id บน hdy-edge จริงยืนยัน exact-match ทำงาน). **CEN-005 ปิดด้วยหลักฐานว่า "ไม่ใช่ปัญหาจริงที่ scale นี้"** — `EXPLAIN ANALYZE` จริงพบว่า OFFSET-depth ไม่ใช่คอขวด (page 1 ≈ page ลึกสุด ทั้ง LPR no-read และ appearances) ตัวกิน cost จริงคือ join plan (`Seq Scan` บน `license_plates`) กับ `COUNT(*) OVER()` — keyset pagination จะเสีย jump-to-page UI ของจริงโดยไม่ได้อะไรกลับมา จึงตัดสินใจ**ไม่ implement** และปิด finding ด้วยตัวเลขวัดจริงแทน (เจอ id-tie-break correctness bug เล็กระหว่างตรวจ แก้ไปด้วย). **เหลือจริง 2 ใน 12: CEN-007 + EDGE-002 ครึ่งหลัง** (query-concurrency limiter / global fetch-probe limiter) — ยังไม่มี incident บ่งชี้ว่าเร่งด่วน, รอดูตัวเลขต่อ (คงอยู่กลุ่ม C ของ #219 เดิม). Commits: `8f46ca6` `a9c9680` `195d743` (CEN-003 script+fix), `aa3a3da` (id tie-break), `afe9e28` (CEN-002), `bfe9e9f` `1ac1275` (EDGE-004), `e30de83` (EDGE-005) | `CODEX/CODEX_Audit_5th_Audit_part_optimization.md` · `db/MANUAL_partition_events_option_a.sql` · `src/lpr-retention.js` · `src/camera-media-delete.js` · `src/edge-config-agent.js` · `src/edge/bridge.js` · `src/routes/cameras.js` · `src/mqtt-subscriber.js` · CHANGELOG 2026-07-22 · ROADMAP |
| #219 | **CODEX audit 5th (optimization) — triage แบบ narrow-scope-first ไม่ใช่ไล่ทำให้ครบ checklist** — ตรวจสอบซ้ำอิสระทั้ง 12 finding (OPT5-CEN-001–007, OPT5-EDGE-001–005) เทียบกับ source จริง (2 Explore agent + เช็คตรงเอง) 2026-07-21, ยืนยัน accurate ทั้งหมด (พบ 2 จุดที่ audit underclaim: CEN-007 นับ pool connection ต่ำกว่าจริง 20 vs ตัวจริง 33 max ข้าม PM2 worker ทั้งหมด; EDGE-001 ความรุนแรงจริงมากกว่าที่ระบุ — เจอ near-miss สดระหว่าง audit ที่ queue ขึ้นไป 88.4% ของ cap 200MB โดยไม่มี alert เลย, GOTCHAS #113). Ship เฉพาะ 2 ใน 12 (`0b40332`): CEN-001 (health endpoint cache/timing) + EDGE-001 (bridge queue alerting) — ทั้งคู่เป็น observable-only change (cache/log/warn, ไม่แตะ control-flow, ไม่ต้องตัดสินใจเรื่อง schema/config). **ตั้งใจ defer ที่เหลือ 10 ข้อ** โดยแบ่งตาม "ระดับการตัดสินใจ" แทนที่จะมองเป็น backlog เดียว: (a) ทำได้ทีหลัง แยกรอบ — CEN-002/004/005, EDGE-002 (retention dir-age, stats materialize, cursor pagination, fetch/probe concurrency); (b) **ต้องให้เจ้าของตัดสินใจก่อน ห้ามลงมือเอง** — CEN-003 partitioning (audit เองก็บอกว่าต้อง rehearse บน restored backup + downtime window ก่อน), CEN-006 thumbnail cache ที่ central (ปัจจุบัน "ไม่เก็บสำเนาที่ central" เป็นการตัดสินใจ PDPA ที่ตั้งใจไว้ ไม่ใช่ oversight), EDGE-003 (แก้ NanoMQ ต้อง bounce broker = ต้องมี maintenance window), EDGE-004/005 (เปิด MQTT command channel ใหม่ โดยเฉพาะ delete-media ที่เป็นคำสั่ง **ลบไฟล์จริงจากระยะไกล** — งานระดับ security-design ตาม Model Assignment Rules ไม่ใช่งาน mechanical); (c) รอดูตัวเลขจริงก่อน — CEN-007 pool tuning. **Rejected:** "ทำให้ครบทุกข้อ" รอบเดียว — เท่ากับตัดสินใจ PDPA scope เอง, จองเวลา downtime DB เอง, และเปิด destructive command channel เองโดยเจ้าของไม่ได้อยู่ในลูป ซึ่งไม่เคยเป็น pattern ของงาน P1/P2 finding ใดในโปรเจกต์นี้มาก่อน. รายละเอียด backlog แบบแบ่งกลุ่ม → ROADMAP ("CODEX Audit 5th — optimization backlog") | `CODEX/CODEX_Audit_5th_Audit_part_optimization.md` · `src/routes/health.js` · `src/edge/bridge.js` · GOTCHAS #113 |

---

<sub>End of DECISIONS.md (index) · Companion to CLAUDE.md · Updated 2026-07-22 (decisions #152–#220)</sub>
