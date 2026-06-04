# CHANGELOG — DojoJin Tech Dashboard

> Companion to [CLAUDE.md](CLAUDE.md). Records completed work by
> version / phase. For pending work see [ROADMAP.md](ROADMAP.md);
> for design rationale see [DECISIONS.md](DECISIONS.md).
> Last updated: 2026-06-03 · Current version: **v1.5.1**

---

## 📰 Recent Updates Timeline (reverse chronological)

- **2026-06-03 — Planning session: Modular Refactor + Security Hardening master plan** (decisions #200–#202) — รีวิว CODEX_AUDIT_2ndTier.md (11 findings: 1 High, 5 Medium, 5 Low) + วิเคราะห์ architecture จริงจาก codebase; สร้าง [`microservice_plan.md`](microservice_plan.md) เป็น master plan รวม refactor + security; อัปเดต [`ROADMAP.md`](ROADMAP.md) พร้อม phase status checkboxes. **Key decisions:** (1) ไม่ทำ full microservices — ระบบเป็น 5-process SOA ผ่าน PM2 + pg_notify อยู่แล้ว; ปัญหาหลักคือ `api-server.js` god-file 6,615 บรรทัด → แก้ด้วย modular monolith (decision #200); (2) Phase ordering: security fixes ที่อิสระจาก refactor ต้องทำก่อน ไม่รอ → Phase 0 (lockfile/docs/DS_Store/cred-guard) + Phase 1 (origin isolation) ก่อน Phase 2 (route split) เสมอ (decision #201); (3) SEC-2T-001 partial fix — ลบ 4 ไฟล์ไม่ได้ใช้ออกจาก `public/others/`: `index.html` (EmailJS CDN), `vss_v1.html` (Materialize CDN), `partners.html`, `reference-projects.html`; CDN risk ของ EmailJS + Materialize หายทันที; `boxbox-th/en.html` (Cytoscape CDN) ยังเหลือ → auth-gate ถัดไป (decision #202). Plan เต็มอยู่ใน `microservice_plan.md`.

- **2026-06-03 — PM2 + Service Management UI (v1.5.1)** (decisions #198–#199) — ดู CHANGELOG ด้านล่าง (v1.5.1 section).

- **2026-05-29 — Platform rename: bosch-mqtt-dashboard → vigil-platform** — 3-phase rename เสร็จสมบูรณ์: Phase 1 file edits 26 files (commit `175cfab`); Phase 2A DB+Docker migration (pg_dump → vigil-postgres init → pg_restore, 7 cameras / 51,322 events verified intact); Phase 2B folder mv + GitHub rename + git remote + services restart + launchd backup plist reloaded; Phase 3 verify (grep clean, carve-outs intact — `vendor:'bosch'` / `bosch/events/#` / `VALID_VENDORS` / `BOSCH_*` camera IDs ไม่ถูกแตะ). Rollback: `backups/pre-vigil-rename-20260529_124719.dump`.

- **2026-05-29 — Performance Optimization Sweep (Phase 1–3)** (decisions #179–#181, commits `ba9a64f`→`b760590`) — ผลการ audit codebase เพื่อหา dead code / hot-path bottleneck / drift risk แล้ว implement ทีละ phase โดยไม่แตะ MQTT ingest / WS / migration blast-zone:
  - **Phase 1** — (1) ลบ `src/test-auth.js` + `src/test-snapshot.js` (dead code, ไม่มี reference ใดๆ −270 lines); (2) in-memory **mtime cache** สำหรับ `loadCameraConfig` / `loadGroups` / `loadMapAreas` — อ่าน disk จริงเฉพาะเมื่อ file mtime เปลี่ยน, `saveXxx()` reset mtime เพื่อ invalidate ทันที (eliminates per-request `readFileSync` บน `GET /api/groups` + camera handlers + background loops); (3) **`src/constants.js`** shared module — ดึง `OFFLINE_THRESHOLD_SEC=90`, `METRIC_EVENT_FILTER`, `MQTT_HEALTHY_AGE_SEC` ออกจากทั้ง `api-server.js` และ `stats-summary-route.js` → single source of truth กัน silent drift; (4) `stopTodayCountsAutoRefresh()` ใน `dashboard.js` — mirror สมมาตรกับ start counterpart + timer pattern อื่นทุกตัว.
  - **Phase 2** — (5) `pollAllSdStatus()` ใน `mqtt-subscriber.js` เปลี่ยนจาก serial `for...await` → batched `Promise.all` (concurrency cap = 5): worst-case 20 กล้อง ลด 80s→16s (ต่ำกว่า 30s poll interval แม้ทุกกล้อง TCP timeout); (6) **migration 030** `pg_trgm` GIN index บน `events.event_type` — `NOT LIKE '%Aggregation%'` (leading wildcard) bypasses b-tree index มาตรฐาน → GIN รองรับ arbitrary LIKE pattern โดยไม่ต้องแก้ query ใดๆ; idempotent (`CREATE EXTENSION + INDEX IF NOT EXISTS`); ใช้ regular CREATE INDEX เพราะ migrate.js รันใน `BEGIN…COMMIT`.
  - **Phase 3** — (7) **30s TTL response cache** สำหรับ `GET /api/stats/today-counts` (module-level `_todayCountsCache`) + `GET /api/stats/executive-summary` (factory-closure `_execCache`) — ทั้ง 2 endpoint ถูก poll ทุก 60s จาก frontend, ไม่มี per-user/group params → single global slot safe; exec-summary เป็น win ใหญ่กว่า (~15 parallel queries + `dirStats` + `diskStats`); (8) **tidy**: `today-counts` tz query เปลี่ยนจาก raw `pool.query` → `getDisplayTz()` (60s cached helper) ให้ consistent กับทุก endpoint อื่น. ⑦ MQTT real broker connection state: **defer** รอ owner confirm failure scenario จริง (current `mqtt_pipeline.status` proxy adequate).

- **2026-05-28 — Settings: Camera offline alert — recipients checklist** (decision #169) — แทนที่ช่อง text input สำหรับ "ผู้รับ LINE" ในส่วน "การแจ้งเตือนเมื่อกล้องออฟไลน์" ด้วย checkbox checklist ที่ดึง user+group จาก `line_config.recipients` (เฉพาะที่ admin approve แล้ว) อัตโนมัติเมื่อเปิด edit form; pre-check ตามค่าที่บันทึกไว้เดิม; reuse `lineConfigCache` เดิม (pattern เดียวกับ alert_rules); แสดง hint เมื่อยังไม่มีผู้รับใน LINE Config; save เป็น comma-separated string ตาม schema `camera_offline_alerts.recipient_ids TEXT` เดิม; ไม่ต้องแก้ migration.

- **2026-05-28 — Map: Mobile Responsive — Primary/Secondary controls split + 4 small fixes** (decision #168) — **(1) Controls split**: แบ่ง 11 ปุ่มเป็น primary row (HEATMAP/CAMERAS/LIVE/debounce-select/FACE/FIT — ใช้บ่อย) + secondary row (STREETS/CARTO/ONLINE/MANAGE/WALL — ใช้น้อย); ≤768px secondary collapse ได้ด้วย SVG chevron button (`.map-more-btn`, aria-expanded); ≥769px ทั้ง 2 row แสดงตลอด; `toggleMapSecondary()` ใน `dashboard.js`; CSS specificity: ใช้ `.map-controls .map-sec` (0,2,0) เพื่อ beat `.map-toggle{display:flex}` (0,1,0) ที่ defined later. **(2) Stats bar**: `flex-wrap:wrap; gap:8px; font-size:14px` ≤768px — กัน overflow. **(3) Popup**: `max-width:min(240px,85vw)` + `min-width:200px` — กัน popup ตัดขอบบนจอเล็ก. **(4) Legend drawer**: `max-width:90vw` — กัน drawer ล้นบน iPhone SE 320px. **(5) Toolbar subtitle**: `.map-toolbar-sub{display:none}` ≤768px — ประหยัดพื้นที่แนวตั้ง (camera count อยู่ใน stats bar ด้านล่างอยู่แล้ว). Verified: Playwright headless iPhone 375px + iPad portrait 768px + iPad landscape 1024px ✅.

- **2026-05-28 — Settings: Idea 4 — Inline Validation + Test Connection + Live Snapshot Preview** (commit `daea6b2`) — **(1) Inline Validation**: warning ใต้ field Camera ID (dup check กับ cameras[] array, add-mode only) + IP Address (format x.x.x.x); trigger on blur ไม่บล็อก save. **(2) Test Connection** `POST /api/cameras/test-connection`: TCP socket 3s timeout → `reachable`+`latency_ms`; HTTP Basic auth test สำหรับ Hikvision/Dahua (`auth_status`); Bosch/ONVIF = `unknown` (ใช้ MQTT/native); SEC-008 log private IP. **(3) Live Snapshot Preview** `POST /api/cameras/snapshot-preview`: ดึง JPEG จากกล้องผ่าน server (Digest+Basic, 8s, 600KB cap), return base64 → thumbnail ใน form; auto-fill snapshot path field ถ้ายังว่าง; responsive max-height 180px. CSS: `.cam-field-warn` (amber), `#frmSnapPreviewImg` (mobile full-width). 10 i18n keys ใหม่. decision #167.

- **2026-05-28 — SEC-001 Phase 3: EMQX auto-provision on camera save** (commit `9670613`) — Option A: เมื่อ admin บันทึกกล้อง Bosch → api-server เรียก EMQX API (localhost:18083) อัตโนมัติ — สร้าง `cam-<id>` user + reuse password เดิมถ้ามีอยู่แล้ว (idempotent), generate ใหม่ถ้าไม่เคย provision; timeout 5s (ไม่บล็อก save ถ้า EMQX down); credentials กลับมาใน response + แสดงใน edit form ทันที พร้อม Copy button; Bosch form ไม่ปิดหลัง save เพื่อให้ copy creds ได้ (non-Bosch ปิดปกติ). Fix silent bug: แก้ไขกล้องผ่าน UI เดิมจะลบ `mqtt_username`/`mqtt_password` ออกจาก cameras-config.json โดยไม่รู้ตัว — แก้แล้วด้วย preserve-from-prev logic. Security: `_redactCameraResponse()` ใหม่ redact `mqtt_password` สำหรับ non-admin GET; `mqtt_provisioned` audit event บันทึก trail สำหรับ trust-boundary change; `mqtt_password` redact ใน audit diff (signal ยังอยู่ใน `mqtt_provisioned.generated_new_password`). CLI script `emqx-provision.js` ยังอยู่สำหรับ bulk/emergency. decision #166.

- **2026-05-28 — Settings: Camera UI redesign** (commit `e6a4976`) — **(1) Camera Groups → Sub-tab**: ย้าย "กลุ่มกล้อง" จาก sidebar item แยกต่างหาก → sub-tab `👥 กลุ่มกล้อง` ใต้หน้า กล้อง (ถัดจาก `📷 กล้อง`); `settingsNav('groups')` ยัง redirect ถูกต้อง ไม่กระทบ `openGroupManager()` จากหน้า Map. **(2) 2-Column Form Layout**: form แก้ไขกล้องเปลี่ยนจาก 5 section แนวตั้ง → 2-col desktop (ซ้าย: ข้อมูล+เชื่อมต่อ / ขวา: แผนที่) + Media/Offline Alert full-width ด้านล่าง; responsive 1-col ≤768px. **(3) Map Preview + Pin**: section "ตำแหน่งบนแผนที่" มี mini-map OL 280px — คลิกปักหมุด → set Lat/Lng อัตโนมัติ; พิมพ์ตัวเลข → recenter+repin; ปุ่ม "ใช้ตำแหน่งปัจจุบัน" (browser geolocation, graceful fallback); default center = กล้องที่มี coord แรก / fallback กรุงเทพฯ; lazy init + destroy ป้องกัน OL memory leak. decisions #165.

- **2026-05-28 — Map: wall mode zoom lock + Live Pulse click fix + vendor pg_notify** — **(1) Wall mode zoom lock** (commit `962cb33`): `refreshMap()` auto-fit (`getView().fit()`) ถูก skip เมื่อ `_mapWallOn === true` — `setInterval` 60s ยัง refresh heatmap/stats/markers ตามปกติแต่ไม่ reset viewport อีกต่อไปใน wall mode. **(2) Live Pulse card pointer-events** (commit `8282c7d`): `.map-pulse-card` มี `pointer-events:none` ใน CSS ทำให้ `addEventListener('click')` ที่เพิ่งเพิ่มไม่ทำงาน — แก้ด้วย `el.style.pointerEvents = 'auto'` ตอนสร้าง card. **(3) Dahua + Hikvision pg_notify timing** (commit `c593b97`): ขยาย fix decision #163 ไปครอบ 3 vendor ครบ — `dahua-cgi.js` ย้าย pg_notify ไปหลัง `await` snapshot UPDATE (RTSP buffer extraction เสร็จ); `hikvision-isapi.js` ย้าย pg_notify เข้าไปใน `captureSnapshot().then()` chain หลัง UPDATE (always fires via catch path ด้วย). ทั้ง 3 vendor ใช้ pattern เดียวกัน: notify AFTER snapshot save. GOTCHAS #58.

- **2026-05-28 — Map: Legend Scaling Tier 2 + Live Pulse fixes** — **(1) Legend Scaling Auto-adapt** (decision #162): `renderMapLegend()` เลือก 3 mode ตาม N = `groups.length` — N<6 = overlay ปัจจุบัน; N 6–20 = scroll (max-height 60vh) + search chip filter (legend-only, ไม่แตะ `hiddenGroupIds`/`refreshMap()`) + hide-all/show-all + collapse toggle; N>20 = Drawer overlay 280px (slide จากซ้าย, ไม่ใช่ push → ไม่ต้อง `map.updateSize()`). Ungrouped chip แสดง "ไม่มีกลุ่ม (N)" display-only (ไม่มี checkbox) auto-hide เมื่อ 0 cameras ไม่มี group. Wall mode: ชื่อกลุ่ม font-size 9px แทน hidden. Helper functions: `_legendSearch`, `_legendHideAll`, `_legendShowAll`, `_legendCollapse`, `toggleMapDrawer`. 7 i18n keys ใหม่ (th+en). **(2) Live Pulse snapshot fixes** (decisions #163, GOTCHAS #58): `pg_notify('new_event')` ย้ายจากทันทีหลัง `INSERT` → หลัง `snapshot UPDATE` ใน `mqtt-subscriber.js` — WS event ถึง frontend พร้อม `snapshot_file` แล้ว ไม่ต้องรอ re-fetch; events ที่ไม่มี snapshot ยิง near-instantly ไม่มี overhead. Field name fix: `event.snapshot_file || event.snapshot_filename` (WS ส่ง COALESCE alias ต่างจาก column name). **(3) Live Pulse card click-through**: คลิก card → `showSnapshot(event)` modal ทันที — ใช้ event object จาก WS (มี `snapshot_file`, `camera_id`, `rule_name` ครบ). **(4) Wall mode compact**: group names แสดงตลอดแต่เล็กลง 9px แทน `display:none`.

- **2026-05-28 — Map: Wall Mode toggle** (commit `d0049b6`) — ปุ่ม WALL ใน map toolbar เปิด/ปิด `body.map-wall-mode` CSS class: ซ่อน sidebar/topbar/toolbar/stats bar + ขยาย map เต็ม `100vh`; EXIT WALL button ลอยมุมบนขวา z-9999; Fullscreen API (`requestFullscreen`) เป็นของแถมสำหรับ non-kiosk workstation; `localStorage('mapWallMode')` persist; `showPage()` restore class อัตโนมัติเมื่อกลับมาหน้า map, ถอด class ทันทีเมื่อออก. decision #161.
- **2026-05-28 — Map: Option B multi-group color overlay + Live Pulse T2** — สองฟีเจอร์ Map page ที่ตัดสินใจไว้ใน decision #155–#156 (2026-05-28). **(1) Option B — Multi-Group Color Overlay** (commits `e37ef58` `a06b33f`): เปลี่ยน `refreshMap()` ให้ loop กล้องทั้งหมดแทน `getActiveGroupCameras()` — filter ผ่าน `hiddenGroupIds`; marker style: fill = online/offline (green/gray), stroke = group color; cluster stroke = group color เมื่อ single-group, neutral `#64748b` เมื่อ mix; legend panel overlay (top-left desktop / horizontal wrap ≤768px) พร้อม checkbox toggle per group; กล้องไม่มี group = แสดงเสมอ stroke `#94a3b8`; stats bar + heatmap filter เฉพาะ visible groups; `grpBarMap` ซ่อนอัตโนมัติเมื่อมี groups (legend แทน). **(2) Live Pulse T2 — Toast-on-Map** (commit `c118ea4`): per-camera debounce (default 15s, dropdown 5/15/30/60s), bump mode "+N more", max 6 concurrent cards (evict oldest by insertion order), card flip ใต้ marker เมื่ออยู่ top 20% viewport, fade 5s หลัง event ล่าสุด, snapshot thumbnail `?w=80` (placeholder SVG เมื่อไม่มีรูป), toggle button (SVG lightning) + debounce select ใน map toolbar, persist `localStorage`, clear cards เมื่อ navigate ออกจาก map. 4 implementation gaps resolved before coding: cluster color strategy, OL Cluster toggle mechanic (clear+repopulate ไม่ใช่ `feature.set`), online/offline indicator, ungrouped cameras handling. decisions #155–#156.

- **2026-05-27 — Ops: camera uptime post-fix bootstrap (prod)** — หลัง deploy commits `679e607` + `7d25d06` พบว่า `cameras.enabled=TRUE` ค้างจาก code เก่า → `checkOfflineCameras` ยังเห็น `enabled === isOnline` ทำให้ไม่ trigger transition (ต้องรอกล้อง offline แล้วกลับ ถึงจะเขียน `'online'` แรก). เลือกวิธี **bootstrap one-shot** (ทางเลือก A จาก 3 ตัวเลือก — ตัดสินใจไม่ TRUNCATE เพื่อรักษา audit trail ของ offline events เดิม): `UPDATE cameras SET enabled=FALSE WHERE last_seen_at > NOW() - INTERVAL '90 seconds' AND enabled = TRUE` (เฉพาะกล้องที่ online จริง เพื่อกัน fake recovery alert สำหรับกล้อง offline จริงเช่น `B3100i_2`). ผลลัพธ์: 6 กล้องได้ `'online'` entry แรกที่ 13:56:19 UTC. **รอผล verify 24h** — uptime 24h window จะยังเพี้ยนค้างจนกว่า offline entries เก่าจะหลุดออก window (~24h, BOSCH/Hikvision 13.6%, BMA-EAST/DAHUA 53.4% ทันทีหลัง bootstrap), หลังจากนั้น accurate 100%. GOTCHAS #49 อัปเดต Recovery Recipe.

- **2026-05-27 — Bug fix: camera uptime % ต่ำกว่าจริงในรายงานสุขภาพระบบ (2 bug locations)** — reproduced: Health Report 24h แสดง BOSCH/Hikvision 22.4%, Dahua 62.2% ทั้งที่กล้องทำงานปกติ. root cause: ingesters (Hikvision ISAPI, Dahua CGI, Bosch MQTT) อัปเดต `cameras.enabled=TRUE` ทุกครั้งที่รับ heartbeat ทำให้ heartbeat checker (`checkOfflineCameras`) เห็น `cam.enabled === isOnline` ตลอด → ไม่เขียน `'online'` recovery entry ลง `camera_status_log` เลย. uptime SQL ใช้ `LEAD()` สะดุด consecutive `'offline'` rows → นับช่วงที่กล้อง online จริงเป็น offline duration. **Bug location 1 (commit `679e607`):** ตัด `enabled=TRUE` ออกจาก ingester 6 จุดใน 3 ไฟล์. **Bug location 2:** `checkMonitorCameras()` ใน `api-server.js` (TCP probe Dahua/ONVIF ทุก 60 วินาที) ก็เขียน `enabled=TRUE` ด้วย — ยืนยันหลัง restart ingesters: ยังไม่มี `'online'` entry เลย; fix: เปลี่ยน UPDATE เป็น `SET last_seen_at = NOW()` เท่านั้น. rule: ทุก UPDATE ที่แตะ `cameras` table ต้องไม่แตะ `enabled` ยกเว้น `checkOfflineCameras`. GOTCHAS #49.

- **2026-05-27 — History Workspace: stats summary strips** — เพิ่ม summary strip แบบ 4-card + window picker บนหน้า **Alert Logs** และ 3-card + window picker + type breakdown chips บนหน้า **Report History** ใน History Workspace. **(1) Alert Logs summary** — `GET /api/alert-logs/stats?window=24h|7d|30d` (SQL FILTER aggregate 1 query): cards = ส่งสำเร็จ / ล้มเหลว / ข้ามทั้งหมด (cooldown+quiet+no-rcpt) / LINE msgs จริง (`SUM(recipient_count)`); window `30d` ลาเบล "~quota" เพื่อเชื่อม LINE Push Quota reset cycle ที่ 30 วัน; window picker อิสระจาก status filter ของตาราง (กรองตาราง failed-only ยังเห็น summary ภาพรวมได้); mobile ≤768px = 2 cols. Commit `f9e0a1c`. **(2) Report History summary** — `GET /api/report-history/stats?window=30d|90d|all` (SQL FILTER aggregate 1 query, window `all` ละ WHERE clause): cards = ส่งสำเร็จ (+ success rate %) / ล้มเหลว / ผู้รับทั้งหมด (`SUM(sent_count)`); type breakdown chips (Daily/Weekly/Monthly/Health) ซ่อนอัตโนมัติเมื่อ count=0; stats reload เฉพาะ page=0 ไม่ยิงซ้ำขณะ paginate; mobile ≤768px = 2 cols. Commit `f62c26e`. i18n: 5 `al.stat*` keys + 4 `rh.stat*` keys ทั้ง th และ en. Decisions #150–#151.

- **2026-05-27 — LINE: approval notification push** — หลัง admin กด "อนุมัติ" ระบบส่ง Push message แจ้ง user ทันที ("✓ อนุมัติแล้ว / Approved") async หลัง response ไม่บล็อก approve flow; error log เป็น warning เงียบ. ใช้ Push API (นับ quota ~1 message ต่อ approval — ยอมรับได้เพราะเกิดไม่บ่อย). Commit `c881d06`.

- **2026-05-27 — LINE Config: bug fixes + quota widget + block list** — ชุดแก้ไขและฟีเจอร์ใหม่สำหรับหน้า Settings › LINE Config ประกอบด้วย: (1) **auto-save on delete** — `removeRecipient()` เดิม mutate แค่ in-memory cache ไม่ save → กลับมา tab ข้อมูลเก่าขึ้นใหม่ แก้ด้วย `saveLineConfig({ silent:true })` หลัง splice; (2) **reset pending on delete** — `PUT /api/line-config` ตอนนี้ตรวจหา `line_id` ที่หายออกจาก recipients แล้ว set `pending_recipients.status = 'ignored'` เพื่อให้ถ้า user ทักกลับจะขึ้น "ตรวจพบใหม่"; (3) **quota widget** — `GET /api/line-config/quota` proxy LINE `/v2/bot/message/quota` + `/v2/bot/message/quota/consumption`; แสดง progress bar สีตาม threshold (green <70% / amber 70–90% / red >90%) บนสุดของ LINE Config panel; (4) **auto-reply fix สำหรับ deleted user** — UPSERT webhook เดิมใช้แค่ `inserted` เป็น gate → deleted user (prev_status='ignored') ทักกลับไม่ได้ reply แก้ด้วย CTE `WITH prev AS (SELECT status …)` + `shouldReply = status==='pending' && (inserted || prev_status!=='pending')`; (5) **pending badge + 30s poll** — badge เลขแดงบน "ตรวจพบใหม่" + `setInterval` 30 วินาทีเมื่ออยู่ tab config; (6) **one-time orphan cleanup** — SQL ล้าง `pending_recipients` row ที่ `status='approved'` แต่ไม่อยู่ใน `line_config.recipients` อีกต่อไป (pre-fix leftovers); (7) **block list** — migration 028 เพิ่ม `'blocked'` ใน CHECK constraint; 4 endpoints ใหม่ (POST block, POST unblock, GET blocked list); webhook UPSERT CASE ป้องกัน 'blocked' เปลี่ยน status; UI: ปุ่ม "บล็อก" ใน pending card + Blocked List section พร้อม badge + ปุ่ม Unblock; 11 i18n keys (th+en). Commits: `eb3bc26` `8def7a7` `036ef0a` `b0adf0e`.

- **2026-05-27 — Docs: design system + UI/reproduce working agreement** — added `DESIGN.md` (`GUIDE_` design system: tri-layer design tokens, self-hosted SVG icon system, no-emoji-as-UI rule, Chart/Map/Report theming, component patterns). `CLAUDE.md` Working Agreement #2 expanded to **UI-design-first** (responsive as subset) and #3 added (**reproduce-before-fix → verify-after → hybrid guard tier**). `DECISIONS.md` indexed #142–#147 (UI design system → DESIGN.md; workflow → CLAUDE.md). `ARCH_documentation-governance.md` → v1.7.0 (registers DESIGN.md, adds UI-design-system STUBBORN_FACTs, fixes stale `#1–#140` index range). `AGENTS.md` + `ARCHITECTURE.md` updated for parity. No code changes. Note: no-emoji rule captures the real 2026-05-26 librsvg/Pango emoji-abort constraint on the SVG Health Report PNG path.

- **2026-05-26 — Health Report preview no longer depends on Puppeteer** — reproduced `/api/health/report/preview` returning 500 after Chromium/CDP stalled on `Runtime.callFunctionOn`, then confirmed a partial `fullPage` removal still left preview stuck in Chrome. `renderHealthReportImage()` now gathers the same health data but renders the PNG via SVG + `sharp`, so Preview / PNG / Health Report LINE image delivery no longer depend on the long-lived Puppeteer browser pool. Decorative emoji are stripped only in the SVG renderer because local `librsvg/Pango` can abort when emoji fallback fonts are missing. Health PDF still uses Puppeteer.
- **2026-05-26 — Events snapshot columns backfilled and activated** — migration 025 backfilled `events.snapshot_filename` / `has_snapshot` from legacy `raw_json._snapshot` metadata (5,819 live snapshot rows, mismatch 0), added partial indexes for snapshot filters, and patched Bosch MQTT, Hikvision ISAPI/Face Capture, and Dahua CGI/clip-resolver paths to keep top-level snapshot columns in sync going forward. Snapshot filters now use `has_snapshot = TRUE`; filename reads use `COALESCE(snapshot_filename, raw_json->>'_snapshot')` for legacy fallback.
- **2026-05-26 — Camera Audit Log core shipped** — migration 024 added `audit_log.target_camera_id` + index. Camera lifecycle/config actions now write audit rows for add/edit/delete camera, offline-alert settings, and group assignment/removal. Audit Log gained a camera filter and redacts camera `username` / `password` in JSON details. Core browse/filter is shipped; CSV export for audit rows remains optional polish.
- **2026-05-26 — Hardware sizing docs consolidated** — kept `HARDWARE_SIZING_GUIDE.md` as the single canonical hardware sizing live doc, merged high-level commercial TCO summary into it, removed duplicate/stale markdown copies under `docs/` and `docs/cost/`, and left `docs/cost/Cost_Calculator.xlsx` as the calculator artifact.
- **2026-05-26 — Architecture live doc slimmed** — rewrote `ARCHITECTURE.md` as a system map only: runtime topology, component boundaries, data flow, schema groups, source-of-truth boundaries, invariants, and canonical doc links. Removed command cookbook, SQL snippets, commercial context, long project tree, and implementation detail from the architecture file; `docs/ARCH_documentation-governance.md` now explicitly prevents those categories from drifting back in.
- **2026-05-27 — Codex audit status recorded** — `CODEX_SUGGESTION.MD` updated with a "Status Update — 2026-05-27" block at the top: 11 of 12 findings closed (10 actioned in this session + Sec-1 LINE webhook + Sec-3 ARCHITECTURE.md credentials already fixed by earlier commits); 1 remaining (Sec-2 Docker port binding) pending an ops/deployment decision. Each closed item links to the resolving commit.
- **2026-05-27 — Codex audit #8 cleanup** — removed duplicate `dashboard_js_production_safe_patch.diff` (root + `dashboard/`, 4,206 bytes each, identical). Patch was never applied (`_cameraRenderQueued` flag absent from `dashboard.js`) and was 16 days stale. Git history retains both copies if the render-scheduler idea is revisited later.
- **2026-05-27 — Codex audit Tier 2 cleanup** — (D) `/others` moved from PUBLIC_PREFIXES to PUBLIC_PATHS as an exact match and `/others/` added as the strict prefix, so future routes like `/othersxxx` can no longer leak through prefix matching. (E) root `package.json` license changed `ISC` → `UNLICENSED` to match the proprietary posture. (F) `service_start.md` updated all Mosquitto references to EMQX 5.8 (service table, health-check expected container name, troubleshooting commands now use `emqx ctl clients list` / `subscriptions list` instead of `mosquitto_pub`).
- **2026-05-27 — Security hardening (Codex audit Tier 1)** — applied 3 production-hardening items: (1) added baseline security headers `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` and disabled `x-powered-by` (CSP intentionally deferred — vanilla SPA has inline scripts/styles needing report-only rollout first); (2) `/api/backups/:filename` now writes an `backup_download` audit row (filename + size_bytes) before streaming; (3) `/api/map/estimate` and `/api/map/download` now share a `validateMapBounds()` helper that rejects out-of-range lat/lng, non-finite numbers, inverted bbox, and zoom outside 0–22, plus `/api/map/download` rejects when total tiles exceed `MAP_TILE_LIMITS.MAX_TILES` (500,000) before kicking off the background job.
- **2026-05-27 — LINE self-service onboarding Phase C** — webhook handler now processes `leave` (group/room removed OA) and `unfollow` (user blocked OA) events: sets `enabled: false` on the matching entry in `line_config.recipients` (transaction-safe) and marks any `pending` row as `ignored`. Alert engine cache invalidated on change.
- **2026-05-27 — Health Report cooldown count fixed** — `GET /api/health/report-data/alerts` was filtering `WHERE status='cooldown'` but `alert-engine.js` writes `'cooldown_skip'`; count was always 0. Fixed to `'cooldown_skip'`.
- **2026-05-27 — LINE self-service onboarding Phase B** — migration 026 adds `oa_basic_id TEXT` to `line_config`. New `GET /api/line-config/qr` endpoint generates 200×200 PNG QR code for the LINE OA friend-add URL (`https://line.me/R/ti/p/@{id}`), auth-protected. Settings › LINE Config gains an "OA Basic ID" input field and a collapsible 4-step onboarding guide with live QR code display (refreshes on save). `qrcode ^1.5.4` added as direct dep. 18 new i18n keys (th+en).
- **2026-05-26 — LINE live docs split out** — added `docs/LOGIC_line-notifications.md` as the canonical LINE subsystem doc covering alert delivery, imgbb/Flex/quota rules, recipients, webhook onboarding, camera offline alerts, scheduled report delivery boundaries, and pending Phase B/C work. Updated documentation governance, decision index, roadmap, architecture, and related LOGIC/SKILL references so LINE details no longer live in the main docs by default.
- **2026-05-26 — LINE recipient onboarding docs reconciled** — `ROADMAP.md` previously still described LINE Recipient Self-service Onboarding as "design only — not started". The code and local DB show Phase A is shipped: migration 023 `pending_recipients`, webhook store-and-suggest, Profile API / Group Summary lookup, admin approve/ignore UI in Settings › LINE Config, webhook auto-reply, and 30-day pending retention. Remaining work is now correctly scoped to QR/basicId onboarding guide and optional group lifecycle cleanup.
- **2026-05-26 — Stats Activity Heatmap drill-down parity fixed** — clicking "กิจกรรมตามชั่วโมง × วัน" now preserves the same scope used by `/api/stats/heatmap`: selected date range, active camera group, selected heatmap category, and the clicked `dow/hour`. The bug was frontend-only: `/api/stats/heatmap` and `/api/events` already supported `category_id` and `cameras`, but the heatmap cell previously forwarded only `dow/hour`, so `เหตุการณ์ (Live)` could show a broader dataset than the selected cell. Fixed in `dashboard/dashboard.js` by adding `drillHeatmapCell()` and letting `drillTo()` carry active group cameras.
- **2026-05-26 — Dahua snapshot resolver race fixed** — `BMA-EAST_DAHUA_CAM01` missed many snapshots even though clips existed because `clip_done` could arrive before first-pass `_snapshot_status` was written. `dahua-cgi.js` now retries clip resolution while status is pending, marks single RTSP/live CGI fallbacks as `low_confidence`, and allows old unreliable fallback rows to be repaired by replaying `clip_done`. Backfilled 2026-05-26 Dahua events: most BMA misses changed to `dahua-clip-resolver / ok`; `DAHUA_CAM01` 09:51 was repaired the same way. See `DahuaProblem.MD`.
- **2026-05-26 — Stats page UX refinement** — sidebar navigation reordered so `สถิติ` / `รายงาน` sit directly after Executive Summary, desktop sidebar can collapse to an icon rail (state persisted in `localStorage`), and the Stats page now has a compact top control area (`กลุ่มกล้อง + ช่วงเวลา + category badges`). The Stats group bar no longer shows `จัดการกลุ่ม` because group editing lives in Settings. Category KPI cards became compact focus badges; `ภาพรวมเหตุการณ์` moved directly below them and now filters its graph/legend/timeline CSV by the selected category badge, including custom categories. Mobile uses horizontal scrolling inside the control strips and avoids page-level horizontal scroll.
- **2026-05-25 — Health Report camera sections split** — "กล้อง + Uptime" split into separate sections: Camera Status (current online/offline summary + concise offline list with Last Seen only) and Camera Uptime (all cameras with uptime %, heartbeat, last event, and last snapshot). Legacy `health_sections=["cameras"]` expands to both new sections for existing schedules. "Frame ล่าสุด" label changed to "Snapshot ล่าสุด" and Last Event added.
- **2026-05-24 — Ph.3 System Health Report DONE** — new `'health'` report type (migration 022) with toggleable sections (cameras + alerts + storage + system). On-demand on the Reports page: 👁 Preview · 📄 PDF (A4 + page numbers) · 📥 PNG · 📤 Send to LINE Now (with per-recipient checklist + counter). Range picker (24h / 7d / 30d / custom). Renderer i18n (`HR_LABELS.{th,en}` in `report-renderer.js` — server-side, doesn't go through `dashboard/i18n.js`). Per-camera detail: online cameras minimal, offline cameras show `created_at` + `last_seen_at` (heartbeat) + latest snapshot metadata with relative-time formatting + duration. Warning banners auto-fire at offline >50%, disk >85%, RAM >85%. Scheduled health reports respect `send_day_of_week`. Two Ph.6 carry-ins later shipped: Camera Audit Log core (migration 024) + events snapshot column cleanup (migration 025).
- **2026-05-24 — Ph.2 Report History DONE** — `report_history` table (migration 021) logs every scheduled and manual send (success / failed / skipped). New "📜 ประวัติรายงาน" sub-tab in Settings › LINE/การแจ้งเตือน, "Run now" button per schedule (POST `/api/report-schedules/:id/run`), download PNG per row, CSV export, retention 90d (rows) / 30d (PNG files).
- **2026-05-23 — Operational roadmap Ph.1-Ph.6 agreed** — six phases approved (Ph.1 Camera offline alert + Status Log, Ph.2 Report History, Ph.3 System Health Report, Ph.4 Event Management, Ph.5 SOP + Claude AI suggestion, Ph.6 Logs & History consolidated menu). Decisions #129–#135.
- **2026-05-23 — Stats page full Thai i18n (Stage 4)** — 58 keys.
- **2026-05-23 — Security + fixes** — LINE webhook X-Line-Signature HMAC-SHA256 verification, heatmap hours clamp, Puppeteer protocolTimeout 30s→120s, schedule edit onclick latent bug (JSON inline → Map lookup).
- **2026-05-22..23 — i18n** — dashboard เป็น 2 ภาษา (ไทย/อังกฤษ) — engine `dashboard/i18n.js` (vanilla, ไม่มี dep) แปลทุกหน้า + modal + login + disclaimer + ตัวรายงาน (report-template.js). Thai = ภาษา source, English = translation layer. Decision #128, gotcha #42.
- **2026-05-21 — Phase MV.5: Dahua CGI event ingester** (`src/ingesters/dahua-cgi.js`) — VCA events (Line Crossing / Intrusion / Smart Motion) via eventManager attach. Dahua Face Detection deliberately NOT ingested — detection-only, not Face Capture, demographics unreliable. Decision #123, gotcha #39.
- **2026-05-21 — Docs** — HARDWARE_SIZING_GUIDE → EMQX + software scale-up plan (decision #122); README + README-TH refreshed to v1.5.0 (multi-vendor / faces / license).
- **2026-05-21 — Phase MV.4: camera settings → full SPA page** (`#page-camera-settings`); vendor set 2 → 4 (Bosch/Hikvision/Dahua/ONVIF) with vendor-adaptive form; ONVIF monitor-only works end-to-end; Dahua event ingester still TODO. Decision #121.
- **2026-05-21 — Security audit** — fixed 6 network-surface issues — unauthenticated WebSocket leaking PDPA data (now verifyClient-gated), DELETE /api/alert-logs authz hole, reflective CORS, XFF spoofing. Decision #120, gotchas #36-38.
- **2026-05-20 — Phase MV.3: Hikvision Face Capture** — ingester multipart parser rewritten binary-safe (JSON event + JPEG face crop → event_type=FaceCapture, decision #117) + new "ภาพใบหน้า" gallery page with age-band / Thai-label display (decision #118).
- **2026-05-20 — Phase MV.1b+MV.2: vendor first-class + per-camera streams** (#115); Hikvision reaches Bosch parity — Smart Events fire LINE alerts (alert-engine) + pre-alarm clips (media-recorder RTSP, verified 1080p). Decision #116.
- **2026-05-20 — Phase MV.1: Multi-vendor STARTED** — Hikvision ISAPI ingester (`src/ingesters/hikvision-isapi.js`) receives Smart Events over the Alert Stream, normalises into the shared events table (vendor-tagged). First non-Bosch camera live. Decision #114.
- **2026-05-20 — Phase 7.5: Trigger/DigitalInput + Trigger/Relay events** now respect analytics_event_display (default OFF). Visibility moved to new "🔌 Camera Automation Triggers (24h)" Health Check card. Decision #113.
- **2026-05-19 — Infra: MQTT broker swapped Mosquitto 2.0 → EMQX 5.8** to unblock BOSCH_8000i IVA Basic (FW too old to expose MQTT toggles) whose MQTT 3.1 packets tripped Mosquitto 2.x's strict spec validator. 8000i went 0 → 4 events/2min after swap. Decision #112, gotcha #33.
- **2026-05-19 — Phase 8.0+8.1: License MVP** (Ed25519/JWT, machine-bound, 7-day trial, 7-day grace, UI activation, keygen CLI) + Thai EULA with formal acceptance flow.
- **2026-05-18 — Phase 7.4: weekly day-of-week + monthly day-of-month pickers** for scheduled report delivery (fixes 7×/30× over-firing).
- **2026-05-15 — Phase 7 perf**: Puppeteer browser pool (9× warm render speedup), WS new_event via Postgres LISTEN/NOTIFY (killed the 1s poll), package.json stripped 149→10 real direct deps.
- **2026-05-11/15 — Phase 7**: Executive Summary SPA, live occupancy + density viz, camera-automation analytics handling, per-rule quiet hours, scheduled LINE reports via Puppeteer.

---

## ✅ Completed Features (v1.2.0)

### Core Dashboard (8 pages)
- Camera Status (KPIs + grid + groups + heartbeat)
- Live Events (real-time WebSocket feed)
- Snapshots (gallery + filter)
- Map (OpenLayers + heatmap + offline cache + multi-provider)
- **Statistics — Stats v2** (categories, custom range, heatmap, drill-down, CSV export)
- **Reports — Phase 5** (Daily/Weekly/Monthly/Custom on Stats v2 + PDF export + branded)
- Alerts (LINE config + rules + logs UI)
- **💓 Health Check (NEW v1.2, admin-only)** — 6 cards, 15s auto-refresh

### Stats v2 (Phase 1-4, 2026-05-06/07)
- 3 new tables (`event_categories`, `event_category_rules`, `system_settings`)
- 9 admin endpoints for CRUD with per-key validators
- Daily retention enforcement
- Admin UI: 🏷️ Manage Categories modal + ⚙️ System Settings modal
- 2 built-in locked categories
- Per-category KPI grid with rolling comparison
- Custom date-range modal + 5 calendar-aligned presets
- Distribution pie (counters excluded), per-camera bars
- Activity Heatmap, Top Rules, Quiet Cameras
- CSV export, Drill-down clicks
- Friendly comparison strings, calendar-boundary presets

### Reports Phase 5 (`c15fc8e`+, 2026-05-07)
- 4 report types reusing Stats v2 endpoints
- Per-bucket trend bar chart
- PDF via html2canvas → jsPDF (multi-page A4)
- Brand-aware header/footer (logo + name + accent + locked copyright)
- Top 10 rules + per-camera bars in PDF

### White-label Branding (`e6acf2b`+, 2026-05-07)
- 4 brand_* settings + multer upload + sharp resize
- Public `/api/branding` for pre-auth pages
- `/favicon.ico` serves uploaded logo
- Propagates: sidebar, browser title, favicon, login, disclaimer, PDF reports

### Production Hardening (`f05c634`, 2026-05-07)
- **Snapshot retention** (1..365 days, default 30, daily mtime-based prune)
- **Health Check page** (admin-only, 6 cards, 15s auto-refresh, full /api/health/details)
- **Mobile responsive** (≤768px breakpoint, hamburger nav, stacked grids, touch-friendly)

### Operations (`89fce32`, 2026-05-07)
- `npm run start:all` (concurrently — api + subscriber + media-recorder)
- `npm run start:full` (+ cloudflared via `$CLOUDFLARED_TOKEN`)
- `service_start.md` operations manual

### Schema migrations + backup/restore (Phase 6.1.10, 2026-05-09)
- `src/migrate.js` — runs at api-server boot, scans `db/db_migration_*.sql`, applies pending in transactions, records to `schema_migrations` table
- `npm run migrate` — manual ad-hoc run (CI / pre-deploy)
- `db_migration_000_schema_migrations.sql` — tracking table bootstrap
- `db_migration_timestamptz.sql` rewritten to be schema-drift tolerant (DO block + information_schema)
- `scripts/backup.sh` — `pg_dump -Fc -Z 6 → backups/*.dump`, retention 14 days
- `scripts/restore.sh` — interactive `pg_restore --clean --if-exists` (requires explicit 'yes')
- `scripts/com.dojojin.dashboard.backup.plist` — launchd agent, daily 03:00
- `npm run backup` / `npm run restore <file>` — convenience wrappers
- ⚠️ Editing `init.sql` to add schema is now banned — write a new `db_migration_*.sql` instead

### Documentation
- README.md (refreshed v1.2)
- SKILL.md (operator's playbook v1.2)
- service_start.md (start/stop/troubleshoot)
- HARDWARE_SIZING_GUIDE.md (v2.0 recalibrated with measured constants 850 B/event, 160 KB/snap; TCO later consolidated here)
- 28-slide customer presentation (.pptx)

### Backend
- MQTT ingestion + filter + snapshot capture
- Heartbeat-based offline detection (90s threshold)
- Alert engine with cooldown + multi-recipient
- Map tile proxy + offline cache (bbox download manager)
- 13 auth endpoints + global API protection middleware
- `/api/branding` (public) + `/api/branding/logo` (admin POST/DELETE)
- `/api/health/details` (admin)
- Daily retention jobs (events + snapshots)

### Auth
- bcrypt + signed sessions (7-day TTL)
- 2 roles (admin/viewer) with UI hiding
- User CRUD + password reset
- Audit log (90-day retention)
- Active session manager + revoke
- Brute force protection (5 fails → 15min lock + 10/min IP)
- Safari ITP triple-layer fallback

### Compliance
- Disclaimer page (Thai legal)
- Force password change on first login
- All admin actions logged

### Deployment
- Cloudflare Tunnel live (`dashboard.dojojin.tech`)
- Domain registered (`dojojin.tech`)
- Default admin auto-created on first start
- Cloudflared root service install (auto-start on boot)

---

## ✅ Completed Features (Phase 7 — v1.3.0, 2026-05-11..15)

### Executive Summary page (SPA merge)
- New "📈 Executive Summary" sidebar nav (default-page candidate)
- Single endpoint `GET /api/stats/executive-summary` aggregates 13 parallel
  queries (KPIs today vs yesterday, 24h timeline, breakdown, top 5 cameras,
  recent events, camera heatmap, MQTT health, storage, image-quality) into
  one round-trip
- Camera map mirrors the main Map page: CARTO Streets locked, marker labels
  via `ol.style.Text`, click popup (id/IP/location/status/24h count/last seen),
  heatmap layer with ON/OFF toggle, focuses on the most-recently-ADDED camera
- KPIs use the full Person/Vehicle hierarchy (not just exact `=`)
- Event Breakdown grouped by `rule_name` (was `object_class` — useless when
  FieldDetector doesn't carry class)
- System Info row trimmed: dropped meaningless "Database: Connected" hard-code;
  version pulled from git at boot; MQTT health based on camera-heartbeat age
  (was event traffic — falsely "disconnected" at night); Media clip stats added
- Top 5 Cameras: filtered to config cameras + alert-portion bar inside each row

### Live occupancy + density viz (Stats page)
- "People in Area — live" KPI grid, smoothed (2s median), WS push on change
- "Density Over Time" line chart (avg + peak), bucket auto-picked from range
- "Density by Hour × Day-of-Week" heatmap (amber palette to distinguish from
  the blue Activity Heatmap)
- All three driven by the same Bosch `CountAggregation/Counter` event stream
  the operator already configures via "คนในพื้นที่ทั้งหมด" rules

### Camera-automation analytics handling (Phase 7.1)
- 8-type toggle in System Settings (`analytics_event_display`): ImageToo*/
  GlobalSceneChange/Trigger I/O — image quality + scene-change default ON,
  digital I/O default OFF
- Thai display labels in feed/reports (`eventTypeLabel`) — was rendering the
  useless "&1" suffix
- "🔍 Camera Image Quality (24h)" card on Health Check page
- State dedup (hide `state='false'` halves) so paired events don't double-count

### Per-rule quiet hours for LINE alerts (Phase 7.2)
- `alert_rules.active_from`/`active_to` (TIME columns; NULL = always fire)
- In quiet window → `alert_logs.status='quiet_hours_skip'` (visible in Logs)
- Crosses-midnight supported · display_timezone-aware · per-rule UI

### Scheduled report delivery to LINE (Phase 7.3)
- `report_schedules` table + scheduler loop (60s tick, once-per-day guard,
  display_tz aware) + admin-gated CRUD + UI modal on Reports page
- Server-side renderer (`report-renderer.js`) via Puppeteer; PDF + PNG paths
  both feed off the SAME `/report-print.html` (which uses the SAME
  `report-template.js` as the interactive Reports page) — one layout, three
  outputs
- Per-schedule `image_layout` ∈ compact|full; compact = 720px phone summary,
  full = the real web report rendered tall
- LINE delivery: imgbb buffer upload + push image to recipients (reuses
  `line-sender.js`). LINE Messaging API has no file type → image only.
- Web "ดาวน์โหลด PDF" rewired to `/api/reports/pdf` (Chromium's real
  paginator → 8mm A4 margins, no mid-element cuts on long reports)
- Rolling weekly/monthly windows (last N days) — not calendar periods

### LINE alert message: real camera name + location
- `{camera}` placeholder now uses `camera_name` from cameras-config.json
  (fallback camera_id). New `{location}` placeholder. `{camera_id}` kept
  for templates that want the raw id.

### Map + Camera Status fixes (early Phase 7)
- "สถานะกล้อง" page no longer paints with empty counts on first load
  (`refreshTodayCounts()` seeded in `_initDashboard` before `loadCameras`)
- Map auto-refreshes every 60s while on the page (was: only on nav)
- Labels clarified: "Events วันนี้ (ตั้งแต่ 00:00)" vs "EVENTS 24H (rolling)"
- Marker text labels on Map (`📷 ชื่อกล้อง (count)`)

### Performance + cleanup (Phase 7 perf, 2026-05-15)
- **Puppeteer browser pool** (`36475d2`) — Chromium launched once per
  api-server process, reused across all PDF/PNG renders; 1419ms cold →
  ~150ms warm (~9×). Transparent relaunch on disconnect; clean shutdown
  on SIGINT/SIGTERM. See decision #95, gotcha #25.
- **WS `new_event` via LISTEN/NOTIFY** (`1ffba23`) — mqtt-subscriber now
  `pg_notify('new_event', <id>)`; api-server's existing `listenClient`
  picked up a second channel; 1s polling loop deleted. ~86400 DB queries/
  day saved per api-server, sub-second WS latency. See decision #96.
- **`src/package.json` strip** (`a0f5b07`) — 149 declared deps →
  10 real direct deps. Clean reinstall: 0 vulns, all 5 entrypoints
  parse, full stack boots, LISTEN/NOTIFY re-verified. See decision #97.

---

## ✅ Completed Features (Phase 7.4 + Phase 8 — v1.4.0, 2026-05-18..19)

### Scheduled report day pickers (Phase 7.4, 2026-05-18)

- Migration 015 — `report_schedules.send_day_of_week` (smallint
  0=Mon..6=Sun) + `send_days_of_month` (CSV with `1..31` or `L` for
  last-day-of-month). Both NULL = legacy "fire every day".
- Scheduler gate (`checkReportSchedules`) compares today in
  `display_timezone` against the column before firing — no more 7×/30×
  over-quota burns. Date helpers `todayDayOfMonthInTz`,
  `todayDayOfWeekInTz`, `isLastDayOfMonthInTz`.
- UI: Thai weekday `<select>` for weekly + chip grid 1–31 +
  "วันสุดท้าย" toggle for monthly; both hidden on `report_type=daily`.
  Schedule list shows a yellow "⚠ ทุกวัน" badge on legacy NULL-gated
  schedules so the operator can spot them.
- Filename cosmetic fix — `reports/*.png` now slice the data-day in
  `display_timezone` (Swedish locale `'sv'`), not in UTC. Old
  filenames stay; new ones generate correctly. Commit `15bee38`.

### License MVP + EULA (Phase 8.0 + 8.1, 2026-05-19)

Full end-to-end license + legal-acceptance flow. Decisions #100–#108
record the design choices.

**Foundation (slice 1, commit `c29d2aa`):**
- Migration 016 — `system_settings.license_key`, `first_login_at`,
  `eula_accepted_at`, `eula_accepted_by`.
- `src/license.js` — Ed25519/JWT verify (via `jose`), machine
  fingerprint (composite hash, prefers IOPlatformUUID/machine-id
  over MAC after Phase 8.0 hotfix), state machine (LICENSED / GRACE
  / EXPIRED / INVALID / TRIAL / TRIAL_EXPIRED / TRIAL_NOT_STARTED).
- `scripts/keygen/setup-keys.sh` — one-time Ed25519 keypair
  generator. Private key lives OUTSIDE the repo at
  `~/Documents/dojojin-keys/`; public key block goes into
  `LICENSE_PUBLIC_KEY` constant in `src/license.js`. Script refuses
  to write into a path inside the repo (safety net).
- `.gitignore` — `*-private.pem`, `licenses-issued/`, `license-
  public.pem` blanket-blocked.

**API + enforcement (slice 2, commit `9eabd20`):**
- `GET /api/license/machine-id`, `GET /api/license/status`,
  `POST /api/license/activate`, `POST /api/license/deactivate`.
- `POST /api/auth/login` hook fires `recordFirstLogin(pool)` on every
  successful login (idempotent — trial clock kicks off from FIRST
  user login, not process boot).
- Global write-blocking middleware after auth: GETs always pass,
  `/auth/*` + `/license/*` + `/line/webhook` always pass; everything
  else requires `LICENSED` / `TRIAL` / `TRIAL_NOT_STARTED`. Pre-
  setup escape: bypassed entirely while `LICENSE_PUBLIC_KEY` is the
  placeholder, so dev clones aren't locked out of themselves.
- `POST /api/cameras` camera-count cap against `payload.max_cameras`
  (cameras-config.json length as source of truth per decision #86).
  Edits to existing cameras always pass; only new additions hit the
  cap. Skipped during trial.

**UI (slice 3, commit `4a9032f`):**
- New sidebar entry `🔐 License` under the User menu.
- `#licenseModal` — Thai-first, branches on state with a coloured
  banner (green/amber/orange/red), license info table when active,
  Machine ID + copy button always, activate textarea + button + a
  "📜 อ่าน EULA" link.
- Auto-popup at boot + every 5 min: triggers on TRIAL_EXPIRED /
  GRACE / EXPIRED / INVALID / TRIAL with ≤1 day. Once per browser
  session (sessionStorage flag) so it doesn't nag.
- Global fetch wrapper detects `403 error: 'license_required'` and
  opens the modal immediately — write attempts during read-only
  mode get an inline recovery path.

**Keygen CLI (slice 4, commit `2c1bce6`):**
- `scripts/keygen/issue-license.js` — vanilla CLI, no extra deps
  (resolves `jose` via fallback to `src/node_modules/`). Validates
  Machine ID format, tier, `--days` (1..3650), private-key file
  presence. Tier defaults: STARTER 100 / STANDARD 500 / PROFESSIONAL
  1000 / ENTERPRISE 2000 / DATACENTER 3000.
- Writes the .license file (chmod 600) + appends to `licenses-
  issued/ledger.csv` (RFC4180 quoting). `--dry-run` mode for sales
  to preview without writing files.
- Sanity warning when `src/license.js` still has the PLACEHOLDER
  public key (the licence signs fine but won't verify on customer
  side until the operator pastes the real public key in).
- `scripts/keygen/README.md` — operator playbook: one-time setup,
  per-customer issuance, renewal, re-issue policy, threat
  reminders.

**Thai EULA + LICENSE update (slice 5, commit `30cf0ba`):**
- `docs/EULA-th.md` — formal 12-section Thai EULA. Penalty clause
  "ไม่น้อยกว่าสิบ (10) เท่าของค่าลิขสิทธิ์ที่ผู้รับสิทธิได้ชำระไป"
  + explicit references to พ.ร.บ.ลิขสิทธิ์ 2537 + พ.ร.บ.
  คอมพิวเตอร์ 2550 + PDPA (customer = Data Controller on self-hosted).
  Sales-policy clauses include 7-day trial, 7-day grace, 2 free
  hardware-change re-issues per license year.
- Root `LICENSE` file gains §6 pointing to `docs/EULA-th.md` as the
  authoritative version; footer now names the governing statutes
  and ≥10× damages floor up front.

**EULA integration (Phase 8.1, commit `0c1d8bd`):**
- `GET /api/eula` (public, no auth) — serves the markdown body so
  the login page can link to it too.
- `GET /api/eula/status`, `POST /api/eula/accept` — admin-only
  acceptance recording.
- `#eulaViewerModal` (read-only, ✕ close) +
  `#eulaAcceptModal` (blocking, no ✕, Logout escape, Accept button
  disabled until checkbox ticked). Markdown rendered by a zero-dep
  ~30-line inline converter scoped to the EULA's actual features
  (headings, bold, blockquote, hr, paragraphs, pass-through `<sub>`).
- `eulaBootGate()` in `_initDashboard`: if not accepted AND user is
  admin → fires the blocking modal. Viewers see the dashboard
  normally (they can't legally bind the deployment).
- `📜 อ่าน EULA` links: in About modal (next to the License row),
  in License modal (next to the Activate header), and as a `<a>`
  next to the EULA-acceptance checkbox in the Activate form.
- Activate button disabled until a per-activation EULA checkbox is
  ticked — reaffirms acceptance on every new key.

**Fingerprint stability hotfix (commit `7bbeaa4`):**
- Caught during soak test before any paid customer. macOS `awdl0`
  (Apple Wireless Direct Link, AirDrop/Continuity) sorts
  alphabetically before `en0`, and its MAC randomises on every
  interface activation. `en0`'s MAC is also randomised by default
  on macOS Big Sur+ ("Private Wi-Fi Address"). Algorithm now
  prefers `/etc/machine-id` (Linux) or `ioreg IOPlatformUUID`
  (macOS) as the STRONG identifier; MAC is included ONLY when
  neither strong source resolved, and even then skips privacy
  interfaces (`awdl|llw|utun|bridge|p2p|anbox|docker|veth|virbr|
  tun|tap`) and locally-administered MACs.

---

## ✅ v1.5.0 (Phase MV.1-5 + 7.5 + i18n + security, 2026-05-20..23)

This version's completed work is captured chronologically in the
**Recent Updates Timeline** above and detailed in the corresponding
`DECISIONS.md` entries:
- Phase 7.5 — Trigger filter (#113)
- Phase MV.1 — Hikvision ISAPI ingester (#114)
- Phase MV.1b — vendor first-class + per-camera streams (#115)
- Phase MV.2 — Hikvision alert-engine + clips + event snapshot (#116)
- Phase MV.3a — Hikvision Face Capture ingest (binary-safe parser) (#117)
- Phase MV.3b — "ภาพใบหน้า" Face gallery page (#118)
- Phase MV.3c — Face background + clip + detail modal (#119)
- Security audit — 6 network-surface fixes (#120)
- Phase MV.4 — Multi-vendor camera-settings SPA page (#121)
- Scale-up doc (#122)
- Phase MV.5 — Dahua CGI event ingester (#123)
- Ops — duplicate / orphan service prevention (#124)
- Snapshot display ?w=N + per-camera view-full cap (#125)
- Settings Workspace consolidated admin UI (#126)
- Auditor role (#127)
- Bilingual i18n Stage 1-3 (#128) + Stage 4 Stats page (#133)
- LINE webhook HMAC-SHA256 (#129)
- Heatmap hours clamp (#130)
- Puppeteer protocolTimeout 30→120s (#131)
- Schedule edit onclick latent bug fix (#132)
- Operational roadmap Ph.1-Ph.6 (#134-#135)
- **Ph.1 Camera Offline Alert + Status Log** — done 2026-05-23 (commits `8bd275a`, `ea9e869`, `dd10c5a`). Migration 018: `camera_status_log` + `camera_offline_alerts`. Migration 019: `escalate_once`. Settings › Cameras sub-tabs (📷 Cameras | 📋 Status Log); offline alert config in camera edit form. 22 `co.*` i18n keys.
- **Ph.2 Report History** — done 2026-05-24 (commit `50117f0`). Migration 021: `report_history` (`schedule_id` FK SET NULL so history survives schedule deletion). `runScheduledReport()` writes a row on every attempt — success + LINE-not-configured + no-recipients + LINE send-failed (extends the existing `record()` helper, never silent). New endpoints: `POST /api/report-schedules/:id/run` (manual fire), `GET /api/report-history` (paginated), `GET /api/report-history/:id/image` (stream PNG from disk). Retention extended: history rows 90d + report PNG files 30d. UI: 📜 ประวัติรายงาน sub-tab in Settings › LINE/การแจ้งเตือน with ⬇ PNG per row + Export CSV; ▶ run-now button per schedule. 16 `rh.*` i18n keys.
- **Ph.3 System Health Report** — done 2026-05-24 (commits `74a8dcf`, `35565f6`, `4adaa94`, `ac13f15`, `29e8b7c`, `6faa791`, `33e6693`). Migration 022: extends `report_schedules.report_type` CHECK to include `'health'` + adds `health_sections` JSONB. `renderHealthReportImage()` + `renderHealthReportPdf()` in `src/report-renderer.js` — both share the same `renderHealthReportHtml()` template, PDF uses A4 paper + page numbers via Puppeteer `displayHeaderFooter`. Renderer i18n via `HR_LABELS.{th,en}` dict (server-side — does NOT go through `dashboard/i18n.js`; see CLAUDE.md note 4). 5 toggleable sections: camera_status, camera_uptime, alerts, storage, system (events dropped after user feedback — overlapped with analytics report). Camera sections are split: status summary lists offline cameras only; uptime section lists every camera with heartbeat, last event, and last snapshot. Warning banners auto-fire when offline > 50% / disk > 85% / RAM > 85%. Range picker (24h / 7d / 30d / custom from-to) — applies to camera uptime % + alert counts; storage/system are point-in-time. On the Reports page: 👁 Preview · 📄 PDF · 📥 PNG · 📤 Send to LINE Now (admin-only, recipient checklist + live counter on the button). Scheduler: health type fires on `send_day_of_week` gate (extended from weekly-only). 5 endpoints added: `GET /api/health/report-data/cameras` (per-camera status + uptime + offline duration + created_at + last_snapshot + last_event), `GET /api/health/report-data/alerts` (range-aware counts), `GET /api/health/report/preview` (PNG inline/download), `GET /api/health/report/pdf` (A4 PDF), `POST /api/health/report/send-now` (admin, LINE blast + report_history insert with `schedule_id=NULL`). `auth.requireAuth/Admin/AdminOrAuditor` patched to bypass when `req.internal===true` so server-internal HTTP calls reach admin-gated endpoints. Gotcha #43 now records migration 025 behavior: snapshot filters use indexed `has_snapshot`, with `raw_json._snapshot` as legacy fallback. 23 `hr.*` i18n keys.
- **Ph.6 carry-in: Camera Audit Log core** — done 2026-05-26 (commit `d08aeae`, migration 024). `audit_log.target_camera_id` + index; camera add/edit/delete, offline-alert config, and group assignment/removal write camera-targeted audit rows. Audit Log UI can filter by camera. Camera credentials are redacted in details. Audit CSV export remains optional polish.
- **Ph.6 carry-in: events snapshot schema cleanup** — done 2026-05-26 (commit `0ece212`, migration 025). Backfilled `events.snapshot_filename` / `has_snapshot` from `raw_json._snapshot`, added partial snapshot indexes, patched Bosch/Hikvision/Dahua/Face Capture ingesters to populate columns going forward, and updated snapshot queries/docs to use indexed columns with raw_json fallback.

### 2026-05-28

- **Security: SEC-001 Phase 1** (commit `4e11375`) — EMQX ports 1883/8083/18083 bound to `127.0.0.1` (was `0.0.0.0`); EMQX dashboard default password rotated; `EMQX_DASHBOARD_PASSWORD` env var documented in `.env.example`. Decision #152.
- **Security: SEC-001 Phase 2 — MQTT per-camera authentication** — Root cause: Phase 1 localhost-only bind silently stopped Bosch cameras from publishing (cameras connect directly to broker, not through subscriber). Fix: dual-bind `127.0.0.1:1883` (subscriber) + `192.168.10.31:1883` (cameras); WS port 8083 removed entirely; `ENABLE_AUTHN: true`; `password_based:built_in_database` authenticator in EMQX. New: `scripts/emqx-provision.js` (idempotent one-shot provisioner — creates subscriber user + per-camera `cam-<id>` users, saves `mqtt_username`/`mqtt_password` to `cameras-config.json`, prints operator table). `src/mqtt-subscriber.js` now authenticates with `MQTT_SUBSCRIBER_USER`/`MQTT_SUBSCRIBER_PASSWORD` from `src/.env`. Decision #164 · GOTCHAS #50 (updated) · #59 (new: src/.env vs root .env).
- **Security: SEC-002** (commit `9956c76`) — Stored XSS path closed: `escapeHtml()` applied to all MQTT/DB-sourced fields (`rule_name`, `camera_id`, `object_class`, `snapshot_source`, `event_type`) in `renderEvents` + `renderSnapshots` (grid + list); `snapshot_file` in URL context → `encodeURIComponent()`. Decision #153.
- **Security: SEC-003** — `GET /api/cameras` now returns redacted `password`/`username` (`***`) for viewer/auditor roles; admin still receives plaintext to support camera-edit form prefill. Reuses existing `_redactCameraAudit()`. Decision #154.

---

### 2026-05-29

- **Map Settings page** (decision #171, migration 029) — Settings › แผนที่ (อันดับ 3 ใน rail, หลัง ระบบ). Mapbox token ย้ายจาก `src/.env` → `system_settings` row `mapbox_token`; `getMapboxToken()` DB-first + env fallback + module-level cache, invalidated on save. `PUT /api/settings/map` (requireAdmin, `pk.` prefix validation, audit log `map_settings_token_update`, cache invalidate). Live map hot-reload หลัง save (ไม่ต้อง restart); tile-download endpoints ยังใช้ env (acceptable B1). ปุ่ม OFFLINE disabled + tooltip เมื่อ `cachedTiles=0`. Tile manager (MANAGE button + `#mapMgrModal`) ย้ายจาก map toolbar modal → `#mapMgrPanelContent` ใน Settings panel; `openMapManager()` / `closeMapManager()` ลบออก. HTML ที่ย้ายได้รับ opportunistic semantic token migration (`--surface-elevated`, `--border-hairline`, `--text-primary`, `--text-secondary`). Responsive: `≤900px` grid stack (preview map สูง 220px, inputs wrap ล่าง); `≤768px` input+button flex-wrap. 10 i18n keys × th+en; `map.noMapboxToken` อัปเดตชี้ไป Settings แทน `.env`. Known concern: `mapMgrPollTimer` ไม่มี cleanup เมื่อ navigate ออก (GOTCHAS #61, impact ต่ำ).
- **icon-health → Shield SVG** (decision #174, commit `f6d43b2`) — `icon-health` เดิม render เหมือน `icon-event` ทุกจุด (EKG waveform path data ซ้ำกัน); เปลี่ยนเป็น Feather-style shield.
- **Opportunistic emoji cleanup — Event Categories** (decision #175, commits `4239d86`) — UI chrome emoji ใน section heading/buttons/modal titles → SVG sprite + text ตาม WA#2-C; เพิ่ม `icon-edit` + `icon-trash` ใน sprite; Icon input เปลี่ยนจาก free-text → preset picker 12 chips + custom fallback; mobile: cat-list-row collapse 3-col (`≤768px`). Downstream emoji ใน filter/chart ยัง pending (plain-text constraint).
- **Boot page sync fix** (decision #176, commit `691be75`) — hard reload แสดง Summary content แต่ nav highlight Cameras (ค้างจากก่อน decision #172); fix: ย้าย `active` nav → summary + เพิ่ม `showPage('summary')` ใน `_initDashboard()`.
- **Opportunistic emoji cleanup — LINE/Alerts** (decision #177, commit `af82820`) — chrome emoji ใน heading/tabs/sub-headings/form labels/rule cards/recipient chips → SVG sprite หรือ text; type chips 👥💬👤 → text badge GRP/ROOM/USER; avatar fallback → icon-user SVG; strip จาก i18n th+en (ar.*, ln.*, common.refresh, common.saveBtn); Option B (decorative form-label icons, ~9 sprites) reject เพราะขัด restraint principle — form labels เป็น text ชัดอยู่แล้ว. ยกเว้น: 🔕 (GOTCHA #90) + LINE template body (LINE norm).

---

---

### 2026-06-01

- **Light Mode opt-in** (decision #185, commit `691e416`) — Dark ยังเป็น default; เพิ่ม Light เป็น opt-in ผ่าน toggle ในหมวด user dropdown (ถัดจาก Language toggle). Persist `localStorage('dashboard_theme')`; FOUC prevention = inline head-script ใน `<head>` ก่อน stylesheet. Toggle ใช้ `location.reload()` (mirror pattern ของ lang toggle) → Chart.js + `token()` re-read tokens ทุกครั้ง. Light palette: `--bg:#f0f4fa`, `--panel:#ffffff`, accent darker (`#3b6fd4`) เพื่อ WCAG AA บน white. Scope: map tiles (CartoDB/Mapbox) + OpenLayers marker stroke + Report PNG ไม่เปลี่ยนตาม theme. `DESIGN.md §10` updated.

- **Bug fix: `appearances_retention_days` save error** (commit `6871630`) — Settings › "จำนวนวันเก็บข้อมูลลักษณะบุคคล" บันทึกไม่ได้ ("setting row missing") เพราะ `system_settings` ขาด seed row ทั้งที่ validator + UI มีครบ. Migration 034 + `init.sql` updated; DB row insert โดยตรงเพื่อ fix live ไม่ต้อง restart. GOTCHAS #66.

- **flatpickr → AirDatepicker (B1–B4)** (decision #186, commits `80ba51b` `ec72e79` `03d8f67`) — ย้าย picker ทั้งระบบ: 17 inputs ใน 6 หน้า (Events/Snapshots/Media/Face/Reports/Health + Custom Range modal + Appearance). B1: `getDtValue()` seam อ่านจาก `selectedDates[0]` (wall-clock string, ไม่ใช่ `toISOString()`); 26 reader rerouted. B2: `initDateTimePickers()` เขียนใหม่ทั้งหมด. B3: month picker `view:'months'` + `minView:'months'` (ไม่ต้อง plugin). B4: flatpickr vendor 6 ไฟล์ลบออก. HTML: 17 inputs เปลี่ยน `type="datetime-local/date/month"` → `type="text"` (GOTCHAS #64). Mobile fix: `isMobile: window.innerWidth <= 768` → ADP modal overlay (keyboard + overflow fix, GOTCHAS #65, decision #187). `DESIGN.md` + `DECISIONS.md` updated.

- **DB performance analysis + 3 targeted fixes** (commits `142b827` `b76918c`) — วิเคราะห์ที่ scale 500 กล้อง / 100K events/วัน (73M แถว max retention):

  **(1) Drop `appearances.snapshot_b64`** (migration 035, decision #188) — column ถูกเขียนแต่ไม่มี endpoint ใดอ่าน (ใช้ `e.snapshot_filename` จาก events แทน); ที่ scale ใหญ่โตประมาณ ~1GB/วัน dead weight. DROP COLUMN + หยุดเขียนใน mqtt-subscriber. GOTCHAS #67.

  **(2) Cache `appearances/stats` 30s TTL** (decision #190) — endpoint รัน 8 parallel aggregation queries ทุก load โดยไม่มี cache (ต่างจาก today-counts/exec-summary); เพิ่ม `_appStatsCache` keyed by from+to+camera_id ตาม pattern decision #181.

  **(3) Batch retention DELETE** (decision #189) — `DELETE FROM events` ล้านแถวครั้งเดียว hold lock นาน; เปลี่ยนเป็น `_batchDelete()` 10K แถว/รอบ + yield 100ms ระหว่าง batch. GOTCHAS #68.

  **สิ่งที่วิเคราะห์แล้ว defer:** `daily_stats` pre-aggregation (ทำเมื่อ stats query ช้าจนสังเกตได้จริง, ไม่ใช่ preventive); `CREATE INDEX CONCURRENTLY` (ทำมือเมื่อ production > 10M แถว, ไม่ควร automate หรือใส่ Settings UI). ดู ROADMAP.

---

### 2026-06-02

- **Camera Pause / Maintenance Mode** (decision #195, migration 037, commits `cefdab8` `d9e025e`) — ปุ่ม "หยุดชั่วคราว" ต่อกล้องใน Settings › กล้อง สำหรับ maintenance โดยไม่ปิดทั้งระบบ:
  - `cameras.paused BOOLEAN DEFAULT FALSE` + partial index `idx_cameras_paused`
  - `PATCH /api/cameras/:id/pause` — dual-write DB + cameras-config.json; audit_log; status_log 'paused'/'resumed'
  - 5 skip touch-points: Bosch MQTT `processMessage` early-return; Hik/Dahua `loadCameras` filter(!paused); watchdog `checkOfflineCameras` continue; status query paused-beats-heartbeat (3 sites: /api/cameras, status-current, health report)
  - `/api/snapshot/live/:id` returns 503 `{paused:true}` แทน attempt
  - Uptime % ไม่นับ paused เป็น downtime (SQL counts only `status='offline'`); camera_status_log constraint extended (+paused, +resumed)
  - `icon-pause` SVG sprite + `badge-paused` CSS; `btn-warning` CSS; dark-screen overlay + maintenance overlay ใน camera detail modal; i18n th+en 5 keys
  - Unpause logic: stamp `last_seen_at=NOW()` เฉพาะเมื่อ `wasOnline=true` ผ่าน `RETURNING enabled` atomic (GOTCHAS #76) — ป้องกัน false online→offline churn สำหรับกล้องที่ offline ก่อน pause

- **SEC-014 miss — media-recorder.js decrypt fix** (commit `d9e025e`, GOTCHAS #75) — `loadCreds()` ไม่ได้ call `decryptCamCreds` → RTSP URL มี `enc:v1:...` URL-encoded → ffmpeg 401 ทุก clip ทุก vendor ตั้งแต่ SEC-014 migration; เพิ่ม `decryptCamCreds` import + apply ใน `loadCreds()`

- **LPR `license_plates` INSERT fix** (migration 036, commit `cefdab8`, GOTCHAS #74) — `extractLPR()` ใช้ column names ชุดเก่า (`plate_likelihood`, `country_code` ฯลฯ) ทำให้ INSERT fail เงียบ → 0 rows ตลอด; align ให้ตรง schema (`confidence`, `country`, `region`); เพิ่ม migration 036 column `vehicle_type/color/brand` สำหรับ multi-vendor ANPR; แทน silent catch ด้วย `console.error`; `v_license_plates_public` view verified explicit column list (ไม่รั่ว partner)

- **PM2 decision** (decision #196) — ตัดสินใจ pull PM2 forward เป็น prerequisite ของ Service Management UI (Start/Stop/Restart per-service); เหตุผล: `concurrently -k` ทำ per-service restart พัง stack; api-server restart ตัวเองไม่ได้ (PM2 daemon แก้); pgrep self-detection bug; scope MVP 5 workers; cloudflared/infra = Phase 2

<sub>End of CHANGELOG.md · Companion to CLAUDE.md · Updated 2026-06-02</sub>
