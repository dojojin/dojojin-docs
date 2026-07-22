# ARCH_documentation-governance — Vigil Platform

> **Doc Registry & Governance** — Single source of truth for documentation
> management. Every file, what it owns, what it must NOT contain, and when
> to load it.
>
> Living Docs system adapted from: https://github.com/Diew/living-docs
> Last updated: 2026-06-15 · v1.8.0

---

## Registry Table

Every file that an agent should know about. If a file is NOT here, it does not exist for the agent.

| File | Living Docs Role | Owns | Must NOT contain | Load when |
|---|---|---|---|---|
| `CLAUDE.md` | Entry point (`agent.md` equivalent) | Session rules, model assignment, working agreement, doc map | Detailed implementation, full decision rationale, SQL snippets | Every session — read first |
| `AGENTS.md` | Codex overlay | Codex-specific operating rules, validation checklists | Rules already in CLAUDE.md | Codex sessions only |
| `ARCHITECTURE.md` | `ARCH_` — System map | Runtime topology, component boundaries, data flow, schema groups, source-of-truth boundaries, architecture invariants, link map | Secrets, owner/customer data, command cookbook, SQL snippets, commercial pricing, feature rationale, troubleshooting | Architecture questions, onboarding, component-boundary questions |
| `DECISIONS.md` | `LOGIC_` — **Index only** | Decision index #1–#147 with one-line summary + link to LOGIC/canonical file | Full decision rationale (→ LOGIC files / DESIGN.md / CLAUDE.md), SQL snippets, operator recipes | Quick lookup of decision number; then follow link |
| `DESIGN.md` | `GUIDE_` — UI design system | Design tokens (tri-layer), type scale, spacing, elevation, icon/SVG system, Chart/Map/Report theming, component patterns, no-emoji rule; rationale for #142–#145 | Feature behavior (→ LOGIC files), operator SQL, secrets, exact runtime values that belong in code | Any UI/CSS/layout/new-page work, report PNG styling, icon work |
| `docs/LOGIC_auth-security.md` | `LOGIC_` | Auth, sessions, RBAC, security audit (#6–#11, #56–#61, #120, #127, #129, #130, #140) | LINE behavior details (→ LOGIC_line-notifications.md), operator SQL, troubleshooting steps | Security/auth work, user management, CORS/WS issues |
| `docs/LOGIC_line-notifications.md` | `LOGIC_` | LINE alerts, imgbb delivery, recipients, webhook onboarding, camera offline LINE alerts, scheduled report delivery boundaries (#12–#14, #90–#91) | Report rendering internals, camera ingestion internals, operator SQL | LINE/alerts work, recipient onboarding, LINE webhook, imgbb/quota changes |
| `docs/LOGIC_stats-reports.md` | `LOGIC_` | Stats v2, Reports, Puppeteer, scheduled delivery config, Health Report (#15–#32, #85, #92–#94, #98–#99, #131–#133, #136–#139, #148) | LINE delivery details (→ LOGIC_line-notifications.md), camera-specific logic, operator SQL | Stats page, Reports page, Puppeteer rendering |
| `docs/LOGIC_camera-ingesters.md` | `LOGIC_` | Bosch MQTT, Hikvision ISAPI, Dahua CGI, ONVIF, clip capture, camera lifecycle (#40–#41, #62–#71, #77–#79, #86, #89, #96, #109–#116, #121, #123, #125) | LINE behavior details (→ LOGIC_line-notifications.md), Face Capture specifics (→ LOGIC_face-capture.md), license logic | Camera ingester work, multi-vendor, clip capture, snapshot display |
| `docs/LOGIC_dahua-ingester.md` | `LOGIC_` | Dahua CGI ingester ครบวงจร — transport, event map, snapshot waterfall 5 ระดับ, pure modules (dahua-protocol/dahua-snapshot-selector), test coverage 48 tests, incident log 9 เหตุการณ์, constants reference | Bosch/Hikvision logic (→ LOGIC_camera-ingesters.md), LINE delivery (→ LOGIC_line-notifications.md) | Dahua snapshot, scan fallback, CGI quirks, segment guard, digest fail |
| `docs/LOGIC_hikvision-ingester.md` | `LOGIC_` | Hikvision ISAPI ingester ครบวงจร — transport, multipart parser, event map, Face Capture pipeline, body appearance normalization, People Counting, dwell detection, incident log 12 เหตุการณ์ | Bosch/Dahua logic (→ LOGIC_camera-ingesters.md), Face Capture architecture (→ LOGIC_face-capture.md) | Hikvision body appearance, face capture, color dot, FAS, people counting |
| `DahuaProblem.MD` | `INCIDENT_` / live problem log | Dahua snapshot timing findings, live test results, clip resolver recovery plan, manufacturer API notes | General camera architecture, non-Dahua ingester rules | Dahua snapshot timing, Dahua CGI recovery, `DAHUA_CAM01`, `BMA-EAST_DAHUA_CAM01` |
| `docs/LOGIC_face-capture.md` | `LOGIC_` | Face Capture multipart parsing, gallery page, PDPA boundary (#117–#119) | Generic camera ingester logic | Face Capture work, gallery page, Dahua face boundary |
| `docs/LOGIC_map-features.md` | `LOGIC_` | Map page architecture (OpenLayers), improvement backlog, Option B multi-group overlay (#155), Live Pulse Toast-on-map T2 (#156), map bug history | Camera ingester logic (→ LOGIC_camera-ingesters.md), design tokens (→ DESIGN.md) | Map page work, OpenLayers, camera grouping overlay, Live Pulse |
| `docs/LOGIC_license.md` | `LOGIC_` | Ed25519 JWT license, trial/grace, machine fingerprint, EULA (#100–#108) | Auth/session logic (→ LOGIC_auth-security.md) | License system work, keygen, EULA |
| `docs/LOGIC_infra-ops.md` | `LOGIC_` | Migrations, backup/restore, service lifecycle, branding, deployment, settings workspace (#33–#38, #47–#52, #80–#84, #122, #124, #126) | Feature behavior, operator SQL | Migration work, backup/restore, deployment, settings UI |
| `GOTCHAS.md` | `INCIDENT_` | Known failures #1–#43 — what broke, root cause, fix, lesson | Design rationale (→ LOGIC files), operator recipes (→ REF files) | Debugging; before touching any system touched by a prior incident |
| `docs/REF_troubleshooting.md` | `REF_` | Troubleshooting §8.1–§8.22, camera lifecycle add/remove/replace | SQL snippets (→ REF_operator-sql.md), design rationale (→ LOGIC files) | Debugging, camera management ops |
| `docs/REF_operator-sql.md` | `REF_` | Daily-ops SQL snippets, system settings reference, service control commands, npm scripts | Troubleshooting steps (→ REF_troubleshooting.md) | SQL queries, service start/stop, settings lookup |
| `SKILL.md` | `REF_` — Core operator playbook | Mental model (§1), Bosch event shape (§2), mapping recipes (§3), branding (§5), health check (§6), reports overview (§7), i18n (§12), Ph.1–Ph.3 overviews (§13–§15), auditor role (§16), license notes (§17) | Detailed troubleshooting (→ REF_troubleshooting.md), SQL snippets (→ REF_operator-sql.md) | First-time operator orientation, mapping recipes, branding setup |
| `SKILL-TH.md` | `REF_` — Operator playbook (Thai) | Same content as SKILL.md — Thai prose with English technical terms preserved + `>` remark explanations for each concept (PM2, MQTT, RTSP, JWT, Docker, etc.) | Any content not in SKILL.md — add to SKILL.md first, then mirror here | Thai-speaking operator orientation; Thai-language reference for all operator tasks |
| `ROADMAP.md` | `REFACTOR_TODO` equivalent | Pending work, operational Ph.1–Ph.6, strategic direction, future versions | Completed work (→ CHANGELOG.md), design rationale (→ LOGIC files) | Planning sessions, next-task selection |
| `CHANGELOG.md` | Completed work log | Shipped features by version, recent updates timeline | Pending work (→ ROADMAP.md), design rationale (→ LOGIC files) | Onboarding; "what shipped when" questions |
| `HARDWARE_SIZING_GUIDE.md` | `REF_` — Infrastructure sizing | Hardware specs G1–G5, capacity calculations, clip sizing, deployment profiles (A/B/C), MA & SLA tier model, software scale-up plan, high-level TCO | Feature behavior, code patterns, operator SQL, detailed worksheet formulas | Pre-sales, architecture sizing, hardware decisions |
| `docs/cost/Cost_Calculator.xlsx` | Artifact | Spreadsheet calculator backing commercial TCO assumptions | Live prose, architecture rules, canonical TCO summary | Recalculating commercial estimates; update `HARDWARE_SIZING_GUIDE.md` summary after changes |
| `service_start.md` | `REF_` — Daily ops | Start/stop/restart commands, Docker health checks, backup/restore commands | Code architecture, design decisions | Daily service management, incident recovery |
| `docs/REF_database-schema.md` | `REF_` — DB reference | Full schema (all tables/columns/indexes), PostgreSQL user & role overview, security/impact analysis, example queries | Migration rationale (→ LOGIC_infra-ops.md), operator SQL recipes (→ REF_operator-sql.md), 3rd-party setup steps (→ REF_third-party-integration.md) | DBA onboarding, schema lookup, security review of DB access |
| `docs/REF_third-party-integration.md` | `REF_` — 3rd-party integration | View catalog (`v_*_public`), ops setup (CREATE USER + GRANT role + pg_hba + docker bind + SSL + audit), 3rd-party connection guide, query do/don't, PDPA & DPA, change policy, decommissioning | Full base-table column list (→ REF_database-schema.md) | Onboarding a new 3rd-party partner, migration 027 rollout, PDPA review of partner access, schema change comms |
| `docs/REF_api-reference.md` | `REF_` — REST API reference | All REST API endpoints (126 routes across 22 groups) — auth levels, request params, response shapes, WebSocket protocol, service management rules | Feature behavior (→ LOGIC files), SQL snippets (→ REF_operator-sql.md), DB schema detail (→ REF_database-schema.md) | API endpoint work, mobile app development (vigil-mobile), third-party REST integration |
| `docs/REF_face-recognition.md` | `REF_` — Face Recognition plan | Architecture options (A/B/C), recommended approach (InsightFace server-side), DB schema (`known_persons`, `face_recognition_results`, pgvector), Python service code, hardware sizing, Mac dev setup, CPU→GPU migration path, PDPA considerations, implementation phases FR.1–FR.4 | Camera ingester internals (→ LOGIC_camera-ingesters.md), Face Capture parsing (→ LOGIC_face-capture.md) | Planning / starting any Face Recognition work |
| `docs/LOGIC_nlq-search.md` | `LOGIC_` — NLQ feature spec | Natural Language Query to structured JSON filter; Unified Forensic Search page concept; Phase 0–2 plan; Claude Haiku API adapter code; Ollama + Typhoon2 local adapter code; known gaps (multi-camera appearances, LPR endpoint missing); cost comparison | Camera ingester logic (→ LOGIC_camera-ingesters.md), DB schema (→ REF_database-schema.md) | Any work on NLQ / Forensic Search / AI query parsing |
| `docs/REF_vms-playback.md` | `REF_` — VMS playback integration plan | On-demand RTSP proxy architecture; Qognify SGS REST API v7.2 adapter code; provider interface contract (vendor-neutral); camera mapping via cameras-config.json; JPEG frame fallback + HLS proxy paths; Phase 0–5 implementation plan; critical traps (XML body, auth encoding, RTSP TTL, self-signed certs) | Camera ingester logic (→ LOGIC_camera-ingesters.md), DB schema (→ REF_database-schema.md) | Any work on VMS playback / Qognify SGS / on-demand video retrieval |
| `docs/REF_edge-install.md` | `REF_` — Edge node install guide | Complete install guide สำหรับ N150/Linux Mint 22 — Ubuntu 24.04 base (VIGIL-ARCH-003 Site Edge) — NanoMQ v0.24.14-3, cloudflared, Node.js PM2 setup, camera config (Bosch MQTT / Hik ISAPI / Dahua CGI), EDGE_MODE pattern table, WSL2 vs pure Linux comparison, troubleshooting 8 gotchas | Edge runtime files (→ `src/edge/`), camera ingesters (→ LOGIC_camera-ingesters.md) | Setting up a new edge deployment; N150 install; WSL2 PoC reproduction |
| `docs/REF_edge-site-checklist.md` | `REF_` — Per-site deploy runbook | Condensed parameterized checklist to deploy a new edge site (per-site variables table, central/cloudflare/edge steps, start order, verification) | Deep narrative (→ `REF_edge-install.md`), camera ingester internals | Executing a new edge site deploy (Phuket, BMA, re-run vss) |
| `docs/LOGIC_edge-ingester-divergence.md` | `LOGIC_` — Edge ingester contract | Intentional divergence between edge and central ingesters — EDGE_MODE guard pattern, pre-normalized row shape, image-never-over-MQTT contract, `src/edge/` directory structure; ห้าม rewrite edge ingesters กลับไปใช้ central shape | Central ingester logic (→ LOGIC_camera-ingesters.md), install guide (→ REF_edge-install.md) | Edge ingester work; porting vendor ใหม่ไปยัง EDGE_MODE; เปรียบ central vs edge ingest |
| `docs/LOGIC_edge-camera-ui.md` | `LOGIC_` — Edge camera UI design | Design rationale for managing edge-site cameras from central dashboard (no SSH/hand-edit JSON) — provision engine, per-site EMQX ACL, audit+RBAC, config relay. **Status: DESIGN (not built)** | Edge ingester runtime (→ LOGIC_edge-ingester-divergence.md), auth/RBAC (→ LOGIC_auth-security.md) | Planning edge camera management UI (not yet implemented) |
| `README.md` | Public overview | User-facing install guide, feature list, architecture overview (high level) | Internal gotchas, design decisions | Customer-facing questions; fresh install reference |
| `public/others/vigil-docs-v2/` (16 HTML + nav.js + styles.css) | `PUBLIC_DOCS` — customer/operator-facing | Operator-readable explanations: purpose, capabilities, components, security findings, bugs, architecture decisions, mobile app, LINE, maps, scale-up, Appearances, REST API overview. Nav shared via `nav.js` (single source). | Internal GOTCHAS numbers, SQL snippets, raw implementation detail, secrets | Updating customer-facing docs; content audit after feature change (see "vigil-docs-v2 update trigger" in Maintenance Rules) |
| `dev-docs/` (6 HTML + nav.js + styles.css) | `GUIDE_` — Developer portal (owner-only) | Navigation index linking to all .md docs; how-to-by-hand recipes: add REST route, add migration, add i18n string, add dashboard page (updated for S5 split — page-*.js pattern), safe service restart (LNP trap). No content duplicated from .md files — links out only. | Customer/operator content (→ vigil-docs-v2), full feature rationale (→ LOGIC files), SQL snippets (→ REF_operator-sql.md) | Developer needs to work without AI assistance; onboarding self-reference for codebase navigation |
| `docs/ARCH_documentation-governance.md` | Registry (this file) | File registry, task→load mapping, STUBBORN_FACT index, naming convention, maintenance rules | Any feature logic, operator recipes, design decisions | Doc management tasks; adding new files; scope unclear |

---

## Task → Load Mapping

| Task | Files to load |
|---|---|
| General technical work | `CLAUDE.md` only |
| Architecture / system design / component boundaries | + `ARCHITECTURE.md` |
| Infrastructure / ops design | + `docs/LOGIC_infra-ops.md` |
| DB schema changes / migration | + `ARCHITECTURE.md` + `docs/LOGIC_infra-ops.md` |
| Feature: Stats / Reports / Puppeteer | + `docs/LOGIC_stats-reports.md` + relevant GOTCHAS |
| Feature: LINE / alerts / recipient onboarding | + `docs/LOGIC_line-notifications.md` + `docs/REF_troubleshooting.md` if debugging |
| Feature: Camera / Multi-vendor / Clip | + `docs/LOGIC_camera-ingesters.md` + relevant GOTCHAS |
| Feature: Map page / OpenLayers / camera grouping / Live Pulse | + `docs/LOGIC_map-features.md` + GOTCHAS #53 |
| Feature: Dahua snapshot timing / recovery | + `DahuaProblem.MD` + `docs/LOGIC_camera-ingesters.md` + GOTCHAS #39 |
| Feature: Face Capture / Gallery | + `docs/LOGIC_face-capture.md` + `docs/LOGIC_camera-ingesters.md` |
| Feature: Face Recognition (planned) | + `docs/REF_face-recognition.md` + `docs/LOGIC_face-capture.md` |
| Feature: NLQ / Forensic Search / AI query | + `docs/LOGIC_nlq-search.md` |
| Feature: VMS Playback / Qognify SGS / on-demand video | + `docs/REF_vms-playback.md` |
| Feature: License / EULA | + `docs/LOGIC_license.md` |
| Security / auth / RBAC | + `docs/LOGIC_auth-security.md` + GOTCHAS #36–#38 |
| UI / design / responsive / i18n | + `DESIGN.md` + DECISIONS.md #128, #142–#145 + GOTCHAS #29–#31, #35, #42 |
| Design system / tokens / icons / theming | + `DESIGN.md` (canonical) |
| Debugging / incident | + `GOTCHAS.md` + `docs/REF_troubleshooting.md` |
| SQL / service ops | + `docs/REF_operator-sql.md` |
| Settings / branding / deployment | + `docs/LOGIC_infra-ops.md` |
| Hardware sizing / pre-sales | + `HARDWARE_SIZING_GUIDE.md`; use `docs/cost/Cost_Calculator.xlsx` only for recalculation |
| Service start/stop/recovery | + `service_start.md` |
| Planning / next feature | + `ROADMAP.md` |
| "What shipped when" | + `CHANGELOG.md` |
| Mapping recipe / operator orientation (English) | + `SKILL.md` |
| Mapping recipe / operator orientation (Thai) | + `SKILL-TH.md` |
| 3rd party partner onboarding / DB integration rollout | + `docs/REF_third-party-integration.md` (+ `docs/REF_database-schema.md` for column-level lookup) |
| DBA onboarding / schema lookup / DB security review | + `docs/REF_database-schema.md` |
| API endpoint work / mobile app (vigil-mobile) / REST integration | + `docs/REF_api-reference.md` |
| Deploying a NEW edge site (execute) | + `docs/REF_edge-site-checklist.md` (+ `docs/REF_edge-install.md` for detail) |
| Adding / moving docs | `docs/ARCH_documentation-governance.md` (this file) |
| Scope unclear | `docs/ARCH_documentation-governance.md` first |
| Updating customer-facing vigil-docs-v2 | `public/others/vigil-docs-v2/` — see "vigil-docs-v2 update trigger" in Maintenance Rules |
| Working without AI / codebase navigation / hand-editing | `dev-docs/` — open via `file://dev-docs/index.html` |

---

## Canonical Ownership

One file owns each rule. No rule should appear in full in more than one file. Link — do not copy.

| Rule Area | Canonical File |
|---|---|
| Session rules, model assignment, working agreement | `CLAUDE.md` |
| Codex behavior | `AGENTS.md` |
| System map, component boundaries, schema group summary | `ARCHITECTURE.md` |
| UI design system — tokens, icons, component patterns, no-emoji | `DESIGN.md` |
| Auth, security, RBAC decisions | `docs/LOGIC_auth-security.md` |
| LINE alerts, recipients, imgbb, webhook onboarding | `docs/LOGIC_line-notifications.md` |
| Stats, reports, Puppeteer decisions | `docs/LOGIC_stats-reports.md` |
| Camera ingester, clip capture, lifecycle decisions | `docs/LOGIC_camera-ingesters.md` |
| Map page — OpenLayers, grouping overlay, Live Pulse, map bug history | `docs/LOGIC_map-features.md` |
| NLQ feature spec, Forensic Search page, AI query adapters | `docs/LOGIC_nlq-search.md` |
| VMS playback integration — Qognify SGS adapter, on-demand proxy, phases | `docs/REF_vms-playback.md` |
| Dahua snapshot timing live findings and recovery plan | `DahuaProblem.MD` |
| Face Capture decisions | `docs/LOGIC_face-capture.md` |
| License, EULA decisions | `docs/LOGIC_license.md` |
| Migrations, backup, ops, branding decisions | `docs/LOGIC_infra-ops.md` |
| Known failures, real incidents, footguns | `GOTCHAS.md` |
| Troubleshooting steps, camera lifecycle ops | `docs/REF_troubleshooting.md` |
| SQL snippets, service commands, settings reference | `docs/REF_operator-sql.md` |
| REST API endpoint reference — all routes, auth levels, params, response shapes, WebSocket | `docs/REF_api-reference.md` |
| Mapping recipes, operator orientation (English) | `SKILL.md` |
| Mapping recipes, operator orientation (Thai) | `SKILL-TH.md` |
| Pending work, strategic direction | `ROADMAP.md` |
| Completed features timeline | `CHANGELOG.md` |
| Hardware sizing constants and high-level TCO | `HARDWARE_SIZING_GUIDE.md` |
| TCO spreadsheet calculations | `docs/cost/Cost_Calculator.xlsx` |
| Developer portal — codebase navigation index + hand-edit recipes (owner-only) | `dev-docs/` |
| Per-site edge deploy execution checklist | `docs/REF_edge-site-checklist.md` |
| Doc registry | `docs/ARCH_documentation-governance.md` |

---

## STUBBORN_FACT Index

Critical decisions that must never be reversed without explicit owner approval.

### Auth & Sessions
> `STUBBORN_FACT`: Triple-layer auth (Cookie + localStorage + URL hash) must never be simplified to cookie-only — Safari ITP forces all three. Decision #8, GOTCHAS #2.

> `STUBBORN_FACT`: No ORM — raw SQL via `pg`. Decision #5.

> `STUBBORN_FACT`: Auditor-role write blocking is server-side (global middleware), not UI-only. Decision #127.

> `STUBBORN_FACT`: `auth.requireAuth/Admin/AdminOrAuditor` must honor `req.internal===true` for internal Puppeteer calls. Decision #140.

### Frontend
> `STUBBORN_FACT`: Vanilla JS — no React/Vue/Svelte. Decision #1.

### UI & Realtime
> `STUBBORN_FACT`: Every event-listing page (Live, Snapshot, Media, ภาพใบหน้า) MUST surface new events in realtime via WebSocket — no F5 required. Owner-set non-negotiable rule. REF_troubleshooting.md §8.18.

> `STUBBORN_FACT`: Every datetime input must use flatpickr and be registered in `_DT_*_IDS`. Never bare `<input type="datetime-local">`. GOTCHAS #35.

> `STUBBORN_FACT`: Never embed `JSON.stringify(obj)` inside `onclick='...'` — any `'` in a field silently breaks it. Use id → Map lookup. GOTCHAS #32, Decision #132.

> `STUBBORN_FACT`: CSS Grid children with wide content need explicit `min-width: 0` — causes horizontal scroll on mobile otherwise. GOTCHAS #29.

> `STUBBORN_FACT`: Every new UI string must be added to both `th` AND `en` blocks in `dashboard/i18n.js`. GOTCHAS #42, Decision #128.

### UI Design System
> `STUBBORN_FACT`: "Material Design" = หลักการ + tokens เท่านั้น — never pull Material Web Components / any UI framework. Reinforces Decision #1. Decision #142, DESIGN.md.

> `STUBBORN_FACT`: Icons are self-hosted inline SVG sprite using `currentColor` — never an icon webfont or CDN asset (self-host + PDPA). Decision #143, DESIGN.md §4.

> `STUBBORN_FACT`: No emoji as UI in user-facing surfaces — use SVG. **Health Report PNG renders via SVG + `sharp` (librsvg/Pango) which ABORTS on missing emoji fallback fonts — emoji in that SVG template is a hard render-breaking bug, not a style issue** (GOTCHAS #25a, fix `report-renderer._svgSafeText()`). Dashboard DOM emoji = consistency preference. Existing dashboard uses emoji widely (sidebar/buttons) — grandfathered, replaced opportunistically, never swept. Carve-out: LINE alert messages, docs. Decision #144, DESIGN.md §4/§6.

> `STUBBORN_FACT`: Design tokens are a tri-layer single source (CSS custom properties + JS palette module + Puppeteer inject) — never hardcode colors per surface, or dashboard/chart/report drift. Text/status tokens must pass WCAG AA. Decision #145, DESIGN.md §1.

### Database
> `STUBBORN_FACT`: Never edit `init.sql` to evolve existing schema — write a new `db_migration_<NNN>_<topic>.sql`. Decision #80.

> `STUBBORN_FACT`: A failing migration aborts api-server startup (exit 1) by design. Do NOT `try/catch` it. GOTCHAS #19, Decision #81.

> `STUBBORN_FACT`: snapshot filters use `events.has_snapshot` and filenames use `COALESCE(snapshot_filename, raw_json->>'_snapshot')`; migration 025 backfilled the old raw_json-only rows. GOTCHAS #43, Decision #139.

> `STUBBORN_FACT`: `cameras-config.json` is the source of truth for camera list. The `cameras` DB table is runtime state only. Decision #86.

> `STUBBORN_FACT`: `pg_dump -Fc` is binary — never `cat` it. GOTCHAS #20.

### Camera / MQTT
> `STUBBORN_FACT`: `alert_rules.active_from` / `active_to` hold the QUIET window (not active window). Alerts fire when `now ∉ [from, to)`. UI label is "🔕 ช่วงเวลาเงียบ". Column naming is historical — DO NOT rename or flip semantics again. GOTCHAS #24, Decision #90.

> `STUBBORN_FACT`: LINE recipients discovered by webhook require admin approval before becoming active recipients. Do not auto-add senders directly to `line_config.recipients`. LOGIC_line-notifications.md.

> `STUBBORN_FACT`: LINE alert/report images use one Flex message object per recipient to control quota. Do not split text+image into two messages unless explicitly accepted. LOGIC_line-notifications.md.

> `STUBBORN_FACT`: Machine fingerprint must prefer OS UUID (`/etc/machine-id` / `IOPlatformUUID`) over MAC address. Modern macOS/Linux randomises MAC. GOTCHAS #26, Decision #108.

> `STUBBORN_FACT`: `VCAOverlay=1` on Bosch `snap.jpg` is case-sensitive all-caps. GOTCHAS (Decision #68).

> `STUBBORN_FACT`: Mosquitto 2.x cannot be configured to accept old-firmware Bosch MQTT 3.1 packets — the fix is EMQX. GOTCHAS #33, Decision #112.

> `STUBBORN_FACT`: Dahua FaceDetection must NOT route to the face gallery — detection-only, no reliable crop. GOTCHAS #39, Decision #123.

> `STUBBORN_FACT`: Use `services.sh` for all start/stop. Never hand-`pkill` or `node x.js &` — creates orphan processes and duplicate event ingestion. Decision #124.

> `STUBBORN_FACT`: Clip window is anchored to `received_at_ms` (MQTT receive time on the subscriber), NOT to `msg.UtcTime` (camera's event timestamp, drifts 5–10s). The NOTIFY payload must always carry `received_at_ms`. REF_troubleshooting.md §8.12, Decision #72 adjacent.

### Branding / Reports
> `STUBBORN_FACT`: `/api/branding` returns `{name, tagline, logo_url, primary_color}` — NOT raw `brand_*` keys. GOTCHAS #21.

> `STUBBORN_FACT`: Footer `© DojoJin Tech` is locked in all templates. Decision #38.

> `STUBBORN_FACT`: `report-template.js` is the ONLY place that builds analytics report HTML. Never create a parallel template. Decision #92.

> `STUBBORN_FACT`: Puppeteer `networkidle0` does not wait for post-innerHTML image decoding — await all `<img>` before signalling `__reportReady`. GOTCHAS #22.

### Security
> `STUBBORN_FACT`: Never read raw `X-Forwarded-For` for security decisions — use `getIP()` which prefers `CF-Connecting-IP`. GOTCHAS #38, Decision #120.

> `STUBBORN_FACT`: CORS is an allowlist, not blanket reflection. Add to `ALLOWED_ORIGINS` in `.env`. GOTCHAS #37, Decision #120.

> `STUBBORN_FACT`: WebSocket connections require valid session — `verifyClient` gate is non-negotiable. Every new WS channel inherits it automatically. GOTCHAS #36, Decision #120.

> `STUBBORN_FACT`: Never use `express.json()` as body parser for HMAC-signed webhook routes — use `express.raw()`. Decision #129.

### License
> `STUBBORN_FACT`: License JWT stored in `system_settings.license_key` (DB), not a `.license` file. GOTCHAS #28.

> `STUBBORN_FACT`: Private key loss = must re-issue ALL customer licenses. Never commit private key. GOTCHAS #27.

### Map Page
> `STUBBORN_FACT`: `/api/heatmap` has no group filter param — group filtering is client-side only. Do not add server-side group param until Option B client-side proves insufficient. Decision #155, LOGIC_map-features.md.

> `STUBBORN_FACT`: Toast-on-map (Live Pulse) debounce is per `camera_id`, not global — global debounce would suppress CAM-B because CAM-A just fired. Decision #156, LOGIC_map-features.md.

---

## Naming Convention

| Prefix | Role | Example |
|---|---|---|
| `ARCH_` | Structure — system design, data flow | `ARCH_documentation-governance.md` |
| `LOGIC_` | Behavior — feature algorithms, business rules | `LOGIC_auth-security.md` |
| `GUIDE_` | Standards — how we write code | (future: `GUIDE_developer.md`) |
| `REF_` | Facts — lookup tables, constants, SQL | `REF_operator-sql.md` |
| `INCIDENT_` | History — post-mortems | (future: `INCIDENT_mqtt-broker-swap.md`) |
| `REFACTOR_TODO` | Work plans — task lists | (future: split from ROADMAP.md) |

**Fixed names (must not rename):**

| File | Why locked |
|---|---|
| `CLAUDE.md` | Claude Code reads this filename by convention |
| `AGENTS.md` | Codex reads this filename by convention |
| `README.md` | GitHub/npm convention |

---

## File Size Status

| File | Lines (approx.) | Status | Action |
|---|---|---|---|
| `DECISIONS.md` | ~150 (index only) | ✅ Healthy | Was 1,400 → split into LOGIC files |
| `SKILL.md` | ~400 (core only) | ✅ Healthy | Troubleshooting + SQL extracted to REF files |
| `SKILL-TH.md` | ~400 | ✅ Healthy | New 2026-06-07; Thai-language mirror of SKILL.md — update both whenever SKILL.md changes |
| `ARCHITECTURE.md` | ~220 | ✅ Healthy | System map only; command/detail moved to LOGIC/REF docs |
| `DESIGN.md` | ~240 | ✅ Healthy | New 2026-05-27; UI design system canonical (GUIDE_) |
| `docs/LOGIC_line-notifications.md` | ~250 | ✅ Healthy | Canonical LINE subsystem doc |
| `docs/LOGIC_camera-ingesters.md` | ~250 | ✅ Healthy | — |
| `docs/LOGIC_stats-reports.md` | ~220 | ✅ Healthy | — |
| `docs/LOGIC_auth-security.md` | ~180 | ✅ Healthy | — |
| `docs/LOGIC_infra-ops.md` | ~200 | ✅ Healthy | — |
| `docs/LOGIC_license.md` | ~150 | ✅ Healthy | — |
| `docs/LOGIC_face-capture.md` | ~130 | ✅ Healthy | — |
| `DahuaProblem.MD` | ~470 | ⚠️ Watch | Live incident log; split if it becomes stable long-term reference |
| `docs/REF_troubleshooting.md` | ~280 | ✅ Healthy | — |
| `docs/REF_operator-sql.md` | ~250 | ✅ Healthy | — |
| `docs/REF_database-schema.md` | ~350 | ✅ Healthy | New 2026-05-27; full schema + impact analysis (3rd-party setup moved to REF_third-party-integration.md) |
| `docs/REF_third-party-integration.md` | ~450 | ✅ Healthy | New 2026-05-27; companion to migration 027 |
| `docs/REF_api-reference.md` | ~1510 | ✅ Healthy | New 2026-06-07; comprehensive 22-section REST API reference; intentionally structured — split only if a section becomes a standalone concern |
| `GOTCHAS.md` | ~400 | ⚠️ Watch | Each entry self-contained — OK for now |
| `CHANGELOG.md` | ~500 | ✅ Acceptable | Append-only log, not a rule source |
| `HARDWARE_SIZING_GUIDE.md` | ~850 | ⚠️ Watch | Single canonical pre-sales doc; split only if one section becomes active implementation work |

**Size rule:** when a file exceeds 300 lines with multiple distinct concern types, split. Trigger = a task touches only one section but must load the whole file.

---

## Maintenance Rules

### Adding a new doc
1. Pick prefix from naming convention table.
2. Create file in `docs/` (or project root if fixed-name).
3. Register it in this file (registry + task→load + canonical ownership) **before use**.
4. If content came from splitting an existing file: update cross-references in source.

### Moving content between files
1. Copy to destination → verify complete → delete from source → update cross-references.
2. Never leave a rule orphaned with no canonical owner.

### Hardware sizing docs
1. Keep `HARDWARE_SIZING_GUIDE.md` as the only canonical hardware sizing markdown.
2. Do not recreate duplicate sizing guides under `docs/` or `docs/cost/`.
3. Keep `docs/cost/Cost_Calculator.xlsx` as an artifact only; sync any changed TCO summary back to `HARDWARE_SIZING_GUIDE.md`.

### vigil-docs-v2 language style (บังคับทุกครั้งที่อัพเดท)

เอกสารทุกหน้าใน `vigil-docs-v2` ต้องเป็น **ภาษาไทยเป็นหลัก** ตามกฎด้านล่าง:

| ส่วน | กฎ |
|---|---|
| Headings / body text / table / list | **แปลเป็นไทย** — อธิบายให้เข้าใจง่าย |
| Technical terms (MQTT, JWT, API, Docker, PM2, Redis, WebSocket, EMQX, ONVIF, RBAC, TLS, PDPA ฯลฯ) | **คงไว้เป็นอังกฤษ** — เพิ่มคำอธิบายไทยสั้นๆ ถ้าคำนั้นซับซ้อน |
| Code block / file path / command | **ไม่แปล** |
| HTML structure / class / attribute | **ไม่แตะ** |

**ตัวอย่าง heading ที่ถูก:**
```html
<h2>ภาพรวมระบบ (Architecture Overview)</h2>
<h3>ฐานข้อมูล (Database)</h3>
```

**เมื่ออัพเดทหน้าใดก็ตาม** ให้ตรวจสอบว่า content ใหม่ยังเป็น Thai-first — ห้ามใส่ English-only paragraph ใน body text ใหม่

### vigil-docs-v2 update trigger

`public/others/vigil-docs-v2/` contains customer/operator-facing HTML. Cross-check against authoritative sources when the relevant feature changes:

| vigil-docs-v2 page | Authoritative source(s) | Update when |
|---|---|---|
| `04-components.html` | `ARCHITECTURE.md`, `HARDWARE_SIZING_GUIDE.md` | New vendor, new service, RBAC role added |
| `05-security.html` | `docs/REF_security-checklist.md` | New SEC-xxx finding or fix |
| `06-bugs-fixed.html` | `GOTCHAS.md`, `CHANGELOG.md` | Major bug class resolved |
| `07-competitive.html` | `DECISIONS.md` | Major stack decision reversed or added |
| `10-maps-api.html` | `docs/LOGIC_map-features.md` | Map library change, new tile provider |
| `12-scale-up.html` | `HARDWARE_SIZING_GUIDE.md` | G-tier camera ranges or server spec change |
| `14-appearances.html` | `db/init.sql` (appearances table), `src/api-server.js` `/api/appearances/*` | appearances schema or API change |
| `15-api-overview.html` | `docs/REF_api-reference.md` · `src/routes/` · `src/api-server.js` | New API group added, auth flow changes, WebSocket protocol changes |
| `nav.js` (all 16 pages) | This file listing | Any page added, renamed, or removed |

**To add a page:** edit `nav.js` NAV_ITEMS array only — all 15 pages pick it up automatically.

### dev-docs update trigger

`dev-docs/` contains navigation index and hand-edit recipes. Index links to .md files and does not duplicate content — low rot risk. Recipes are the only prose that needs maintenance:

| dev-docs page | Update when |
|---|---|
| `index.html` (file map) | New src/ module added, file renamed/deleted, new major script added |
| `add-route.html` | Factory pattern changes, new auth middleware added, `routeError` helper changes |
| `add-migration.html` | Migration runner behavior changes, next-number convention changes |
| `add-i18n.html` | I18N.t API changes, new attribute patterns added |
| `add-dashboard-page.html` | Token system changes (DESIGN.md), new icon system, fetch pattern changes |
| `restart-services.html` | New PM2 workers added, LNP workaround changes (GOTCHAS #84) |

**Note:** `dev-docs/` is not routed by api-server — open via `file://dev-docs/index.html` from repo root. No deployment needed.

### Doc update trigger
Update docs **on explicit human request**, not automatically after every task:
- **Sync**: Update the file that owns the changed logic.
- **Register**: Add new files to this registry.
- **Enforce**: Move rules to their correct owner if misplaced. Delete duplicates.

---

## Future Doc Candidates

| Planned file | Would own | Trigger |
|---|---|---|
| `docs/GUIDE_developer.md` | Code style, migration authoring, JS patterns, copyright header format | When onboarding a new developer |
| `docs/REF_event-types.md` | All known event_type values per vendor, object_class hierarchy | When mapping rules get complex |
| `docs/STANDARDS_api.md` | API response shapes, error formats, pagination headers | When adding new endpoints |
| `docs/LOGIC_alert-engine.md` | Alert rule matching detail, cooldown, quiet hours algorithm | When touching alert-engine.js significantly |

---

*v1.8.0 — 2026-06-15 · Vigil Platform · Living Docs adapted from github.com/Diew/living-docs*
