# ROADMAP — Vigil Platform

> Companion to [CLAUDE.md](CLAUDE.md). Pending work + strategic
> directions. For shipped work see [CHANGELOG.md](CHANGELOG.md);
> for design rationale see [DECISIONS.md](DECISIONS.md).
> Last updated: 2026-07-22

---

## 🔜 Pending / Roadmap

### CODEX Audit 5th (optimization) — ✅ 10/12 shipped, 2 remain (decision #220, 2026-07-22)

> เต็ม: [`CODEX/CODEX_Audit_5th_Audit_part_optimization.md`](CODEX/CODEX_Audit_5th_Audit_part_optimization.md) — 12 finding. **Shipped 10/12** (2026-07-21–22, commits `0b40332` `8f46ca6` `a9c9680` `195d743` `053ebe6` `869cfe6` `1a2c7c2` `530ea78` `b03786e` `5312c9f` `aa3a3da` `afe9e28` `bfe9e9f` `1ac1275` `e30de83`): CEN-001–006, EDGE-001, EDGE-003 (NanoMQ half), EDGE-004, EDGE-005. **CEN-005 closed as measured-not-needed** — real `EXPLAIN ANALYZE` showed OFFSET depth isn't the bottleneck at current scale (join plan / `COUNT(*) OVER()` is); keyset would have cost the jump-to-page UI for zero perf gain, so it wasn't implemented. Full narrative → decision #220.

- [ ] **เหลือ 2 finding — รอดูตัวเลขจริงก่อน ไม่เร่งด่วน (ไม่มี incident บ่งชี้):**
  - **CEN-007 (ครึ่งหลัง)** — pool wait metrics ✅ มีแล้ว (`health.js` `waiting_peak`); ยังไม่มี query-concurrency limiter จำกัด report/stats หนักๆ พร้อมกัน
  - **EDGE-002 (ครึ่งหลัง)** — SD-status probe stagger ✅ มีแล้ว (เฉพาะ Bosch onvif poll); ยังไม่มี global concurrency limiter ครอบ `_fetchJpeg`/heartbeat/preview/scan ทั้งหมด + per-camera cooldown + probe/timeout counter ใน heartbeat

### CODEX Audit 5th (security) + 6th (live pentest) — ✅ triaged + most items closed 2026-07-22

> เต็ม: [`CODEX/CODEX_Audit_5th_part_security.md`](CODEX/CODEX_Audit_5th_part_security.md) (§7 = verification log ต่อ finding) · [`CODEX/CODEX_Audit_6th_live_pentest_summary.md`](CODEX/CODEX_Audit_6th_live_pentest_summary.md) (§9 = verification log). Re-verified ทุกข้อกับโค้ด+ระบบจริง (ไม่ใช่แค่อ่าน static) แล้วปิด Phase 0-4c/4d + cloudflared token rotate ในรอบเดียว — commits `6525a02` `7fd4204` `2fc9a99` `82c5963` `088fedf` + tunnel token rotate (Cloudflare dashboard, ไม่มี commit).

- ✅ ปิดแล้ว: HIGH-001 (central+edge chmod), MED-003 (env.template doc), LOW-001 (.DS_Store), LIVE-LOW-001 (x-powered-by), LIVE-MED-004 (stale deps — verified already fixed by `3995f29`), HIGH-002/LIVE-HIGH-003 (legacy `/lpr` → 410), LIVE-HIGH-001 (token pre-check ก่อน body parse — เจอ flood จริงที่กำลังยิงอยู่ตอนแก้), LIVE-HIGH-002 (multer upgrade), LIVE-MED-001 (central `lpr-receiver` bind → 127.0.0.1, ยืนยัน cloudflared route ผ่าน dashboard จริงก่อนแคบ), LIVE-MED-003 (cloudflared token rotate)
- ⚠️ Mitigated บางส่วน: HIGH-003 (NanoMQ edge ยัง anonymous — แต่ guard เฉพาะ `_config/detect-model`/`delete-media` ด้วย `CAMERA_SECRET_KEY` shared-secret แล้ว ปิดช่องทำลายข้อมูลที่อันตรายสุด)
- **[ ] Deferred ตั้งใจ (ไม่ใช่ backlog ที่ลืม):**
  - **HIGH-004** (EMQX central `no_match=deny`) — ผูกกับรอบ multi-site rollout (ต้อง inventory ทุก site รวม topic ใหม่ `_config/detect-model`/`delete-media` ก่อน flip); prep เสร็จแล้ว (10 user มี ACL rule ครบ, orphan cleanup แล้ว) แค่ยังไม่ flip
  - **MED-002** (URL token rotation/log) — design gap ระยะยาว ไม่มี incident รองรับ
  - **MED-006** (multi-site RBAC regression test) — แยกเป็นงาน test-coverage
  - **`CAMERA_SECRET_KEY` rotation** — key เข้ารหัส `cameras-config.json` หลุดเข้า Claude session transcript (2026-07-22, ตอนแก้ `LPR_BIND_HOST`) แต่**ประเมินแล้วไม่ร้ายแรง**: ต้องมีทั้ง key + ไฟล์ ciphertext พร้อมกันถึงใช้ประโยชน์ได้ — คนที่เข้าถึงไฟล์ได้ระดับนั้นอ่าน `src/.env` เอาค่า key ตรงๆ ได้อยู่แล้ว (คนละ threat model กับ cloudflared token ที่เป็น bearer token ใช้จากอินเทอร์เน็ตได้ทันที). Migration script เขียน+self-test เสร็จพร้อมใช้แล้ว: [`scripts/rotate-camera-secret-key.js`](scripts/rotate-camera-secret-key.js) (`SELF_TEST=1 node scripts/rotate-camera-secret-key.js` verify ได้ทุกเมื่อ) — เมื่อจะทำจริง: เจ้าของ gen key + รัน migration script + แก้ `.env` 3 เครื่องเอง (Claude ทำแทนไม่ได้ เพราะต้องเห็นค่า key ถึงจะเขียนได้ — จะกลายเป็นหลุดซ้ำ), Claude ช่วย restart/verify ส่วนที่ไม่ต้องเห็น key ได้

**Route-split backlog (พบระหว่าง doc-sync audit, 2026-07-22 — วิเคราะห์เฉยๆ ยังไม่แตะโค้ด):**
- `src/routes/cameras.js` โตเป็น **1877 บรรทัด** ทิ้งห่างไฟล์ route อื่นชัดเจน (อันดับ 2 คือ `stats.js` 1143 บรรทัด) จากการเพิ่ม EDGE-004/EDGE-005 command-channel logic + FK-child delete compensation + EMQX credential provisioning function เข้าไปในเซสชันนี้
- Pattern **"if site≠main: `emqxPublish()` else: เรียกฟังก์ชันตรง"** ซ้ำกัน **3 จุด** ในไฟล์เดียวกัน (`detect-model`, `scan-nvr`, `delete-media`) — ตัวถอดเป็น `src/helpers/edgeCommand.js` ได้ชัดเจนสุด (`dispatchEdgeCommand(siteCode, topic, payload, inlineFallbackFn)`) ลดโค้ดซ้ำ + จุดเดียวถ้าต้องแก้ pattern นี้ในอนาคต (เช่นตอนเพิ่ม `secret` field ก็ต้องแก้ 2 ใน 3 จุดแยกกัน)
- ยังไม่ถึงจุดที่ต้อง split เป็นหลายไฟล์ (เช่น `cameras.js` + `cameras-edge-commands.js`) — เสนอแค่ helper extraction ก่อน ประเมินใหม่อีกทีถ้าไฟล์โตต่อ

### Per-Site Access Control (Site-Scoped Viewer) — ✅ P1-P5 + D1-D3 VERIFIED DONE 2026-07-03 (code-audit, not just doc)
> เป้า: user แยกไซต์ (VSS/BMA/Phuket) = **viewer ที่ act ได้ (ack+comment face & LPR) แต่ตั้งค่าไม่ได้** และเห็น/act เฉพาะ site ตัวเอง. **ไม่ต้อง role ใหม่** — `viewer` + `user_sites` (migration 054). role/write-block layer เสร็จแล้ว (config admin-gated ครบ).
- [x] **P1** site resolver — `req.user.allowedSites` set ทุก request (`api-server.js:615`) + `siteWhere()` helper (`auth.js:441-443`)
- [x] **P2** read enforcement — `siteWhere()` เรียกใช้จริง **49 จุด** ข้าม 9 ไฟล์ (faces/lpr-query/lpr-alerts/events/stats/appearances/reports/ops/stats-summary-route)
- [x] **P3** act enforcement — `POST /api/face-matches/:id/ack` และ `POST /api/lpr/alerts/:id/ack` เช็ค `req.user.isSiteScoped` + verify target camera's site ก่อนเขียน (403 ถ้าไม่อยู่ใน allowed sites)
- [x] **P4** config-block — ยืนยันแล้วว่า admin-gated ครบ (manual verify; ยังไม่มี automated regression test — minor, ไม่ใช่ security gap)
- [x] **P5** admin UI — `PUT /api/users/:id/sites` (`routes/users.js:54`) + Settings›Users มี site multi-select ต่อ viewer แล้ว (`page-user-mgmt.js:253-303`)
- [x] **D1 (health scope)** — moot: `GET /api/health/details` gate ด้วย `requireAdminOrAuditor` อยู่แล้ว → viewer เข้าไม่ถึง endpoint นี้เลยไม่ว่า site scope จะเป็นอะไร
- [x] **D2 (fail-open policy)** — decided+implemented: fail-closed. `siteWhere(null)`=ALL (admin/auditor sentinel), `siteWhere([])`=`AND FALSE` (viewer ไม่มี `user_sites` row = เห็นศูนย์)
- [x] **D3 (global data read)** — confirmed: `GET /api/lpr/gates` ไม่มี role gate → viewer อ่าน reference list (watchlist/gates/vehicle-types) ได้ตามที่ตั้งใจ, เฉพาะ hits/events ที่ scope ตาม site
> แผนเต็ม+endpoint audit เดิม: [`docs/superpowers/plans/2026-07-02-site-rbac.md`](docs/superpowers/plans/2026-07-02-site-rbac.md) (เขียนตอนวางแผน — โค้ดตามทันหมดแล้วเมื่อเช็ค 2026-07-03) · related `project_multisite_camera_sites` (RLS Tier-2 ยัง deferred — app-layer พิสูจน์ตัวแล้ว, defense-in-depth ทำทีหลังได้)
- **↳ Per-Site Event Categories + Stats dashboard** — 📋 PLANNED 2026-07-02 (**for Sonnet**, depends on site-RBAC P1). Stats page (สถิติเหตุการณ์) + จัดการหมวดหมู่ Event กลายเป็น per-site: `event_categories` += `site_id` (unique per site); dashboard เดียวกันทุก site ต่างที่ category; "ทั้งหมด" = union ของทุก site (multi-site users). 🔴 **BLOCKER invariant:** rule `camera_id IS NULL` = cross-site wildcard → ต้อง constrain `e.camera_id IN (cameras ของ site)` ทุก subquery เสมอ (`site_id` แค่คุมว่าโชว์ card ไหน). Phases SC0-SC6 + coding how-to + leak-test: [`docs/superpowers/plans/2026-07-02-site-event-categories.md`](docs/superpowers/plans/2026-07-02-site-event-categories.md)

### LPR System Settings + เฝ้าระวัง re-architecture (Phase F-R) — ✅ RF1-RF4 DONE 2026-06-21 (RF5 deferred)

> เจ้าของสั่ง: แท็บ "เฝ้าระวัง" หน้า LPR = **แสดงผลอย่างเดียว**; ส่วนตั้งค่าทั้งหมดย้ายไป
> **การตั้งค่า > การตั้งค่าระบบ LPR**. แผนเต็ม + เหตุผล: [`docs/superpowers/plans/2026-06-18-lpr-receiver.md`](docs/superpowers/plans/2026-06-18-lpr-receiver.md) (§ Phase F-R).
> แบ่ง Phase ตามเส้น "ต้อง restart PM2 ไหม" — frontend block ก่อน แล้ว backend.

- [x] ~~**RF1**~~ — done 2026-06-21 (commit `4191628`). gallery `#lprTabWatchlist` → read-only: `_renderWatchlistRO` (chips `lprWlRoBar` + cards `lprWlRoList`, ไม่มีฟอร์ม/toggle/delete) + hint ชี้ไป Settings.
- [x] ~~**RF2**~~ — done 2026-06-21 (commit `4191628`). ย้าย watchlist mgmt (ฟอร์ม+group bar+editable list, **คง id เดิม** reuse functions) → Settings › ระบบ LPR (`#set-lpr` card); + **group manager** (rename/สี/ลบ/เพิ่ม) ใหม่; backend `PATCH /api/lpr/watchlist/groups/:id`. ⚠️ incident: harness แก้ groups จริง → กู้แล้ว (GOTCHAS #95).
- [x] ~~**RF3**~~ — done 2026-06-21 (commit `af4cda2`). watchlist ref-image = drag&drop zone `#wlDrop` (drop+click, instant preview, clear) → existing sharp 400×400 endpoint. drag listeners ใน `_bindStaticHandlers` (addEventListener, CSP) + ACTION_MAP `wlDropClear`.
- [x] ~~**RF4**~~ — config (3 ส่วนครบ 2026-06-21):
  - [x] ~~**LPR retention**~~ — done 2026-06-21 (commit `aed4428`). **decoupled 2 setting:** `lpr_image_retention_days`=7 (รูป `snapshots/lpr/` — PII+disk) + `lpr_retention_days`=30 (rows anprAlarm+license_plates). `src/lpr-retention.js` (`enforceLprRetention`: per-file mtime+rmdir empty date-dir, เว้น `lpr-watchlist/` sibling; batched row delete; image capped ≤ meta) + api-server `_runLprRetention` schedule 120s/daily + 2 validator + `db_migration_lpr_retention.sql` (idempotent). verified e2e 11/11. **+ UI fallback** (รูปถูกลบ → plaque/vehicle-vector ใน gallery modal, commit `5859dc2`). **apply ตอน api-server restart** (no-op จนกว่า LPR cutover). ⚠️ gap เดิม `enforceSnapshotRetention` ข้าม subdir = สาเหตุ `snapshots/lpr/` ไม่เคยถูกลบ — ปิดแล้ว
  - [x] ~~**จุดเข้า-ออก (gate) — config**~~ — done 2026-06-21 (commit `7b8e99d`). อยู่ใน **Settings › ระบบ LPR** (`data-sec=lpr` + `#set-lpr` + `loadLprSettings`, `page-lpr-settings.js`). table `lpr_gates` (id/name/camera_id/rules JSONB) + `routes/lpr-gates.js` CRUD (verified 10/10) + UI lane→เข้า/ออก/ไม่นับ (CSP data-action). **consumption (filter by gate + direction stats) = RF5/increment ถัดไป** ยังไม่ wire. migration apply ตอน restart
  - [x] ~~**ประเภทรถที่แสดงผล**~~ — done 2026-06-21 (commit `5b839a2`). card ใน Settings›LPR: toggle visibility + label override ต่อ vehicle_type → เก็บ JSON `lpr_vehicle_types` (system_settings) + GET/PUT `/api/lpr/vehicle-types`; page-lpr.js `_lprVType` ใช้ label override + donut/filter ซ่อน `on:false`. verified e2e 8/8
- [x] ~~**RF5 + Tier-1**~~ — ✅ done 2026-06-23 (commit `3e49b60`), **verified กับ data สด 2026-07-03**. per-camera direction: `cameras.lpr_direction` (in/out, migration 063) + `/api/lpr/stats` direction agg (join `c.id=e.camera_id`, BKK hour เท่า hourly) + `PUT /api/lpr/camera-direction` + chart `lprChDir` (in/out / fallback "ผ่าน") + assignment UI Settings›LPR (scope cam_role='lpr'). **ไม่ infer** ทิศ (operator-set). `lpr_gates` (per-lane) = latent advanced ไม่แตะ. **Verify:** ตั้ง `HKT-ANPR-UVSS1 = 'เข้า'` ผ่าน UI จริง → เช็ค DB confirm → กราฟ "ทิศทางรายชั่วโมง" ขึ้นเส้น "ขาเข้า" (`--status-ok`) พร้อมตัวเลขจริงตามชั่วโมง ถูกต้อง.
- [x] ~~**RF-IMG**~~ — done 2026-06-23 (commit `a96ee28`, live). ย่อ scene ตอน ingest ใน `lpr-core.js` (`resizeScene`: `sharp().rotate().resize(W,H,{fit:inside,withoutEnlargement}).jpeg({quality})`, default **1080p/q80**, cache settings 60s, resize-fail→เก็บต้นฉบับ ไม่ทิ้งรูป; **plate ไม่แตะ**). resize อยู่ใน lpr-core → ทำงานใน **lpr-receiver** (ingest path จริง). settings GET/PUT `/api/lpr/scene-image` (routes/lpr-gates.js) + migration 061 seed `lpr_scene_resolution`/`lpr_scene_quality` + UI Settings›LPR card. self-check 4096×2160→1920×1013 (noise worst-case −94%). 🟡 −% จริง + lock default รอ sample กล้องสด (LPR data ยังไม่ไหล). forward→CIB moot (กล้องชี้ CIB ตรง ISAPI repoint).
- [x] ~~**RF-ALERT**~~ — done 2026-06-23 (commits `f9252ed` backend + `f2082b8` frontend, main). `GET /api/lpr/alerts` = anprAlarm ⨝ active watchlist + LEFT JOIN `lpr_alert_acks` (migration 060) paginate server-side; `/count` (today+unacked); `POST /:id/ack` (mirror FP5). Frontend: alarm strip overview + tab "การแจ้งเตือน" (badge/period/group/search/pager 15) + alert modal (captured↔reference side-by-side + ack+log). 🟡 เหลือ: browser-check ด้วย data จริง (LPR ยังไม่ไหล) + LINE push (LPR ส่ง `new_event` ไม่ใช่ `alert_event` → ยังไม่เข้า alert-engine) + reference-image upload UI.
- [ ] **LPR Scale — Search + File Storage** — 📋 **PLANNED 2026-07-01** (do before full deploy, ~10M rec/เดือน = 120M/ปี). ปัจจุบัน: unpartitioned + `OFFSET` + exact `COUNT(*)` (ช้าตาม N) + scene JPG 317KB×ล้าน = disk driver. แผน 3 เฟส: **P0 now** (86k = ยังไหว ไม่ต้องทำ) → **P1 ก่อน cutover**: keyset/cursor pagination แทน OFFSET (เลิก jump-to-page → "โหลดเพิ่ม") + ตัด exact count (ใช้ estimate) + default bounded window + retention prune แบบ drop-dir-by-age → **P2 full scale**: monthly RANGE partition บน `event_time` (retention=DROP PARTITION) + parse fields ที่ filter จริงเป็น indexed column (เลิก LIKE rawXml) + parse used-fields→column (rawXml trim = HOLD, keep-set ยังไม่นิ่ง). **Storage:** prod=Linux → disk เป็น sizing (740GB@7d ลง server ได้, sharding date/cam/4h-slot พอแล้ว—verified worst 10.5k/dir, XFS/ext4 รับได้); Postgres partition host-independent รันบน Linux ปกติ; object-storage = optional ops win ไม่ใช่ prerequisite. แผนเต็ม+projection: [`docs/superpowers/plans/2026-07-01-lpr-scale-search-storage.md`](docs/superpowers/plans/2026-07-01-lpr-scale-search-storage.md)
- [ ] **Retention Architecture (prod)** — 📋 **PLANNED 2026-07-01**. Retention split by **data class × location** (edge/central) แทน retention เดียว. 6 class (A-edge Bosch scene / A-central LPR / B clips / C biometric / D rawXml / E plate-log slim / F aggregate) + legal-hold mechanism. **✅ DONE:** A-edge pruner+inventory `d87649c` + Health `d4e2ba5` · **P2/2A** seatbelt→column `b2741cc` · **D** rawXml time-retention (strip >90d) `d5fc975` · **E** decouple mechanism (exclude anprAlarm จาก general retention) `39552ee` (⚠️ number คง 30 — **flip เป็นปี gated on P2/2B**). **⏸️ DEFERRED (YAGNI 2026-07-01):** **F** rollup (ไม่มี consumer อ่าน trend) + **legal-hold flag** (ไม่มี trigger set — watchlist/acks ว่าง) — add when consumer/trigger exists. **NEXT = P2/2B partitioning** (draft พร้อม, gate ของ E number-flip). Do-not: split-drop unknown fields ตอน ingest (per-camera/time ไม่นิ่ง). แผนเต็ม: [`docs/superpowers/plans/2026-07-01-retention-architecture.md`](docs/superpowers/plans/2026-07-01-retention-architecture.md)
- [ ] **Driver Face Capture (Hik Face Picture Matting)** — ⏸️ **DEFERRED 2026-07-01**. Hik ANPR อัปรูปหน้าคนขับเป็น multipart part `pilotPicture.jpg` จริง (verified live HKT-ANPR-02) แต่ ingest **drop ทิ้ง** (`lpr-core.js` `classifyImage()` รู้จักแค่ scene/plate → part อื่น=unknown ไม่ save) = ไม่มีรูปหน้าในระบบ (PDPA-safe by default). จูนกล้อง (Medium/ratio3/contrast50/Face-Close-up✓) → รูปโต 1.5KB→4.5–10.8KB คมขึ้น 3–7× แต่**หน้ายังไม่เห็น** เพราะกระจกเปียกสะท้อนฟ้า (ฝน) + มุมกล้องสูง = optical limit แก้ที่ matting ไม่ได้. **Resume เมื่อ:** อากาศดี + กล้อง/มุมที่เห็นคนขับชัด. **Build (gated on quality+PDPA):** `classifyImage` add `pilotpicture`→face, save `lpr_face_*.jpg` + `face_image` column (migration), modal face box + access-control, retention สั้นกว่า scene. recipe re-probe + แผนเต็ม: [`docs/superpowers/plans/2026-07-01-driver-face-capture-DEFERRED.md`](docs/superpowers/plans/2026-07-01-driver-face-capture-DEFERRED.md)
- [ ] **Camera Delete — Edge Media Cleanup** — 📋 **PLANNED 2026-07-16**. `DELETE /api/cameras/:id` (แม้เลือก "ลบข้อมูลทั้งหมด") ลบแค่ DB row (cameras/events/appearances/license_plates) — **ไม่เคยลบไฟล์ภาพจริงเลย**, ไม่มี code path ไหนเรียก `unlink`/`fs.rm` ในเส้นนี้. สำหรับกล้อง EDGE_MODE ไฟล์อยู่บน **edge disk** (คนละเครื่องจาก central api-server) และไม่มีช่องทาง command จาก central→edge สำหรับ "ลบไฟล์" เลย (มีแค่ config-push `_config/cameras`, ทางเดียว) — เจอ orphaned files ค้าง 2 ครั้งจริงในสนาม (`hdy-nvr1-ch0/ch1` 112M, `HDY-NVR-04-ch0` + preview 2 ไฟล์) ต้องลบมือทุกครั้ง. **แผน:** reuse pattern `_config/scan-nvr`/`scan-result` (request/reply ผ่าน MQTT ที่มีอยู่แล้ว) เพิ่ม `_config/delete-media` (**retain:false** — ต่างจาก config-push ที่ retain:true เพราะเป็น one-shot action ไม่ใช่ state ถ้า retain แล้ว camera_id ถูกใช้ซ้ำจะโดนลบไฟล์ผิดคน) + `_config/delete-media-result`. Edge (`edge-config-agent.js`) subscribe ใหม่ → sanitize camera_id ด้วย regex เดียวกับ `snapPath()` (กัน path traversal) → ลบ **2 shape** ที่ต้อง handle ทั้งคู่ (เจอจริงตอนสำรวจ): nested `{events,face,lpr}/{date}/{camId}/{slot}/` + flat `preview/{camId}.jpg`. Central (`cameras.js` DELETE) publish command นี้เมื่อ `keep_data` ไม่ใช่ 1 (fire-and-forget แบบ `publishSiteConfig`) + ลบ `SNAPSHOT_DIR` ของตัวเองสำหรับกล้อง Bosch/direct-pull (ไฟล์อยู่ central เครื่องเดียวกัน ไม่ต้องผ่าน MQTT). **Known limitation:** edge offline ตอนสั่ง = คำสั่งหาย (ไม่ retain/queue) — ยอมรับได้ (disk hygiene ไม่ใช่ data integrity). **Test:** pure function คำนวณ path ที่ต้องลบ (เหมือน `snapPath`) + unit test sanitize + เคส exact-match (ห้าม `ch0` ไปโดน `ch01` โดย prefix match ผิด). **ขนาดงาน:** ~ไฟล์ใหม่ 2 + แก้ 2 ไฟล์เดิม + test, พอๆ กับ nvr_channel-fix + delete-modal ที่ทำไปวันเดียวกันรวมกัน. **เกิดจาก:** incident ลบกล้อง `hdy-nvr1`/`HDY-NVR-04` 2026-07-16 (แก้ manual ไปก่อน, ยังไม่ automate)
- [ ] **Auto Model Detect — Recurring, not One-Time** — 📋 **PLANNED 2026-07-20**. `scripts/fill-model.js` ถูกออกแบบเป็น "one-time" script โดยตั้งใจ (comment ในไฟล์ระบุชัด) — รันครั้งเดียวตอน feature นี้ merge (2026-07-17) fill ได้ 43/58 ตัว ณ ตอนนั้น. **gap ที่พบจริง:** กล้อง 4 ตัว (`hdy-anpr-bangfab1/2`, `hdy-motor-bangfab1/2`) ถูกสร้างใน DB เวลาไล่เลี่ยกับตอน feature merge (`created_at` 2026-07-17 04:30 UTC, ก่อน commit feature 23:55 +07 ในวันเดียวกัน) แต่ไม่ติดในรอบ fill ครั้งนั้น (เพราะ script อ่านจาก `cameras-config.json` ของ **edge ณ ขณะรัน** ไม่ใช่ query DB กลาง — ถ้า edge ยังไม่ sync คอนฟิกที่เพิ่ง publish จาก central มา กล้องใหม่จะหลุดจากรอบนั้นไปเลย) → ต้องรันมือซ้ำ (สังเกตพบ + แก้ 2026-07-20, live-verified 4/4). เพราะเป็น one-time ไม่มี cron/trigger รันซ้ำ **กล้องใหม่ทุกตัวที่เพิ่มหลังจากนี้จะไม่มี model/firmware/serial จนกว่าจะมีคนนึกได้มารันมือ** (`hdy-motor-r52` ก็อยู่ใน batch เดียวกันแต่ probe "no model" — สาเหตุต่างกัน กล้องไม่ตอบสนอง ต้องเช็คแยก). **แผน:** เปลี่ยนจาก one-time เป็น recurring — ตัวเลือก (a) hook เข้า flow ตอนเพิ่มกล้องใหม่ผ่าน UI (`POST /api/cameras`) ยิง `detectModel()` ทันทีถ้ากล้องอยู่ใน network เดียวกับ central (Bosch/direct-pull) หรือ queue ให้ edge รันตอน sync ถัดไป (Dahua/Hik ผ่าน edge) หรือ (b) cron รายสัปดาห์บน edge (เหมือน `fill-model.js` เดิม แต่ auto, ข้ามเฉพาะกล้องที่มี model อยู่แล้ว = idempotent) แล้ว POST ผลกลับ central endpoint ใหม่ (`PATCH /api/cameras/:id/model-detect` หรือคล้ายกัน). **เลือก (b) น่าจะง่ายกว่า** — ไม่ต้องแก้ create-camera flow, ทำงานได้ทั้ง Dahua/Hik/Bosch ผ่าน `detectModel()` เดิม, edge cron เดียวครอบคลุมกล้องใหม่ทุกตัวในไซต์นั้นอัตโนมัติ. **ขนาดงาน:** เล็ก — reuse `detectModel()`/`fill-model.js` เกือบทั้งหมด, เพิ่มแค่ cron scheduler (edge) + endpoint รับผล (central, POST-only เหมือน current manual apply) + skip-if-already-filled guard.

### Ingester Method — push vs pull (Phase IM, started 2026-06-19)

> ปัญหาเดิม: Hikvision ingester pull `alertStream` กับ **ทุก** กล้องรวม push-only/remote
> → `connect ETIMEDOUT` retry-spam ทุก ~80s. push-only (FAS/ANPR) ส่ง event มาเองอยู่แล้ว
> + remote site ดึงเข้าไม่ถึง (NAT/VPN). กล้องที่ flip ได้ใช้ `push_only` boolean ใน
> `cameras-config.json` (ingester อ่านผ่าน `fs.watch`→`syncCameras()`, ไม่ต้อง restart).

- [x] ~~**IM1** — ingester honor `push_only`~~ — done 2026-06-19 (commit `7660379`). `loadHikvisionCameras()` กรอง `.filter(c => !c.push_only)`; `main()` log กล้องที่ข้าม. Verified live: LPR (10.11.100.4) = 0 ETIMEDOUT หลัง restart; remote pull cam (HKT01) ยัง timeout ตามจริง.
- [x] ~~**IM2** — ingest-method UI~~ — done 2026-06-19 (commit `af09889`). Checkbox "รับเฉพาะ Push" ในฟอร์มกล้อง (Hikvision-gated) → persist `push_only` ลง config (body-wins-else-preserve, ปิด latent wipe bug). `!prev` sync branch เคลียร์ `_destroyed` → flip push→pull reconnect ได้ไม่ต้อง restart. Storage = boolean (ไม่ทำ enum — auto = IM4).
- [x] ~~**IM3**~~ — cross-site face push receiver (FAS LAN path): **code done** 2026-06-19 (commit `5a2ff8b`) — FAS receiver resolve push_only cam จาก config (`_matchPushCam`), boot guard `require.main===module`, test 5 เคส. **↳ SUPERSEDED by IM3-R (LIVE 2026-06-23):** cross-site ใช้ Cloudflare tunnel `/face-push/:token` แทน FAS LAN — device-side HKT01 (Alarm Server→IP:3010) moot, ไม่ต้องทำ. bind/allowlist ใน code ไม่แตะ (GOTCHAS #57)
- [x] ~~**IM4** — auto-detect ingest method~~ — done 2026-06-19 (commit `3640f1e`). Test Connection (Hikvision) + unreachable → นัดจ์ suggest `push_only` (one-directional, hik+!reachable+unchecked เท่านั้น; ไม่นัดจ์ตอน reachable/auth-fail; เคลียร์ตอนสลับ vendor). **suggest-only โดยตั้งใจ** (ไม่ auto-tick): test-connection เป็น TCP-reachability proxy → blip ชั่วคราวจะหยุด pull กล้องที่ใช้งานได้แบบเงียบ ๆ. **upgrade ที่เป็นไปได้ (ยังไม่ทำ):** auto-set checkbox + reversible note — รับ footgun เงียบนั้นแลกความสะดวก. pure frontend.
- [~] **IM5** — site-link health (แยก "link down" จาก "camera down"). design = ติดป้าย "ไซต์" แบบ explicit — **ห้าม**เดาจาก subnet/ping gateway (กฎ ห้ามเดา network).
  - [x] ~~**IM5 Phase 1 — site label foundation**~~ — done 2026-06-21 (commit `e41b9f3`). เพิ่ม field `site` ต่อกล้อง (เลือก field แยกแทน reuse group เพราะ camera-groups = vendor-based BOSCH/HIK/DAHUA → ชน map grouping). `cameras.js` persist body-wins-else-preserve (all vendors, empty=clear); GET /api/cameras คืนอัตโนมัติ (config spread); editor UI input "ไซต์ (Site)" + hint + i18n th/en. **owed:** owner ตั้งค่า site ต่อกล้องผ่าน UI (HKT01+HKT02=ไซต์เดียวกัน; LPR/office แยก) + live-check input save→reopen.
  - [ ] **IM5 Phase 2 — detector** *(deferred 2026-06-25)* — correlation: กล้องในไซต์เดียวกัน ≥2 ตัว offline พร้อมกัน → mark "site down" 1 เหตุการณ์ (suppress รายตัว). **สถานะ:** EM6 (alert-worker) ปิด full-site-down scenario แล้วผ่าน `edge_status.last_seen_at` stale → LINE alert; partial-failure (กล้องบางตัวใน site) ยังไม่เคยเกิดในสนาม + `camera_offline_alerts` ทุกตัว enabled=FALSE → ยังไม่มีของจริงให้ verify. **trigger:** เปิด per-camera offline-alert จริง + ≥2 remote cam/ไซต์ online + เห็น false-alert storm จริง. reachability-probe ใช้ไม่ได้กับ push_only (server เข้าไม่ถึงโดยตั้งใจ). backend

#### 🔵 Network finding (2026-06-19) — ทำไม VPN หลุดแต่ LPR push ทะลุมาได้ + ที่อยู่ที่ remote ยิงถึง

> **ไล่ path LPR แล้ว (verify ด้วย curl สด):**
> `กล้อง → HTTPS:443 dashboard.dojojin.tech/lpr → Cloudflare edge (SIN) → cloudflared tunnel → localhost:3000/lpr`.
> `POST /lpr` คืน **HTTP 200**, `GET /lpr` คืน **404 จาก app เรา** (route POST-only) = request ทะลุถึง api-server จริง; header ไม่มี CF Access → **เปิด public ไม่มี auth**.
>
> - api-server bind **`127.0.0.1` loopback เท่านั้น** (api-server.js:1411, `BIND_HOST` default; ไม่ override ใน `.env`) → camera ยิง `192.168.10.31:3000` ตรงไม่ได้ ต้องเข้าทาง tunnel.
> - tunnel config `~/.cloudflared/config.yml`: `dashboard.dojojin.tech → http://localhost:3000` (มี config เดียว).
> - **เหตุผล VPN-down ไม่กระทบ LPR:** push = ขาออก (camera → public internet → Cloudflare) ไม่พึ่ง VPN; pull = ขาเข้า (server → private IP กล้องผ่าน VPN/route) ← อันนี้ที่หลุด. LPR pull ก็ ETIMEDOUT เหมือน HKT01 (ก่อน IM1) — ต่างกันแค่ LPR **push** อยู่.
> - **HKT01 ปัจจุบัน:** push face ไป **HCP** (Hikvision VMS) ที่ `202.124.201.105:10001`, URL = UUID `/v2/019e49f5-...` (UUID = capability token ใน path). FAS server เรา (`192.168.10.31:3010`) **LAN-only ไม่ได้อยู่หลัง tunnel** → Phuket ยิงไม่ถึง.

- [x] ~~**IM3-R**~~ — ✅ **LIVE 2026-06-23 (on-site Phuket)**. HKT01+HKT02 face push ผ่าน Cloudflare tunnel `POST /face-push/:token` HTTPS:443 ทำงานจริง; multi-slot (HCP slot1 + Vigil slot2) — ไม่ต้องเลือก. v1 = ingest-only (event+images+notify; ไม่มี alerting/HCP relay). code: commit `9575318`; `src/helpers/face-multipart.js` (shared). **v2 (ยังไม่ทำ):** LINE alert, HCP relay, token-set UI, body-appearance. แผนเดิม:
  1. route ใหม่บน api-server (เช่น `POST /face-push/:token`) — **token ใน path เป็น secret** (อย่าเปิดโล่งแบบ `/lpr`; cf. pattern UUID ของ HCP). parse multipart เดิม (ย้าย/แชร์ `parseFaceAlarmMultipart` + `ingestFaceAlarmEvent`/`ingestBodyAppearance` จาก hikvision-isapi.js — ปัจจุบันอยู่ในตัว ingester).
  2. resolve กล้องด้วย **token → camera_id** (ไม่พึ่ง source IP เพราะผ่าน Cloudflare = source เป็น CF edge/loopback). `_matchPushCam` (IM3) อาจ reuse บางส่วนแต่ตัวคีย์เปลี่ยนจาก IP→token.
  3. ไม่แตะ FAS LAN เดิม (กล้อง local .235 ยังใช้ FAS:3010 ได้) — IM3-R เป็น path เพิ่มสำหรับ cross-site.
  4. **on-site Phuket (ห้ามเดา — verify จริง):** (a) firmware HKT01 รองรับ Alarm Server **ตัวที่ 2** ไหม (อย่าทับของ HCP) — ปุ่ม +Add มี แต่บางรุ่นยิงปลายทางเดียว; (b) ตั้ง Destination = `dashboard.dojojin.tech` Port `443` Protocol `HTTPS` URL `/face-push/<token>`; (c) กด Test ในกล้อง + ดู api-server log ว่า event เข้า.
  - **ทำผ่าน Advisor-led cycle (PLAN→EXECUTE→AUDIT→STOP→COMMIT).** ออกแบบ token store + Access bypass สำหรับ path นี้ = security review (CLAUDE.md #17 + GOTCHAS #57).

#### Resilience / Process Isolation (พบ 2026-06-20 จากอาการ hikvision crash-loop ↺2800+ ที่บ้าน)
- [x] ~~**IM6 — FAS bind ต้อง degrade ไม่ crash**~~ ✅ done 2026-06-20 (commit `7fee413`). เพิ่ม `srv.on('error')` ก่อน `srv.listen` ใน `startFaceAlarmServer()` → EADDRNOTAVAIL/EADDRINUSE log warning แล้วไปต่อ (face push DISABLED, ingester ทำงานต่อให้ pull cams + sync). **Verified live:** restart count คงที่ (เลิกไต่จาก ↺3690), status online, uptime ไต่ขึ้น, log แสดง `[FAS] ... DISABLED, ingester continues` แทน EADDRNOTAVAIL throw. หมายเหตุ: degrade message ขึ้นซ้ำทุก sync cycle (~94s) — log noise เล็กน้อย; guard "เคย fail แล้วไม่ลองซ้ำ" ยกไปทำตอน IM7.
- [~] **IM7 — แยก `hikvision-receiver` เป็น process ของตัวเอง** — **CORE DONE = CS7** (commit `f213cca`): `/lpr` + `/face-push` ย้ายไป `lpr-receiver` standalone (PM2 id 8, port 3003) แล้ว — isolate crash/load จาก api-server core ✅. **🔲 เหลือ:** รวม **FAS LAN :3010** (`startFaceAlarmServer()` ยังอยู่ใน `hikvision-isapi.js:979`) เข้ามาที่ receiver เดียว — ตอนนี้ Hikvision push ยัง split 2 ที่ (FAS LAN 3010 ใน ingester + tunnel /lpr,/face-push ใน lpr-receiver). `dahua-receiver` = future (Dahua = `eventManager.cgi?action=attach` **pull** ยืนยันจากโค้ด — ไม่ push). ⚠️ ระวัง tunnel reachability. ทำผ่าน Advisor-led cycle

### Camera Settings UX redesign + LPR Forwarding (Phase CS, planned 2026-06-20 · design CONFIRMED)

> **บริบท:** หน้า Settings › Cameras บวม — ฟอร์มแก้กล้อง (~30 field/5 section) + list render-all อยู่ scroll เดียว = ใช้งานจริงไม่ได้ที่ระดับ 1,000–3,000 กล้อง (เป้า `HARDWARE_SIZING_GUIDE`). + ต้องเพิ่ม per-camera **LPR forward** (CIB) ที่ scale หลายกล้อง.
> **DESIGN ที่ confirm = demo `public/others/demo/camerasettings.html` (v7)** — reproduce ด้วย Puppeteer แล้ว (pagination 25/หน้า → DOM 616 node vs render-all 13,269; render 9–14ms ที่ 1k–3k). ยึด DESIGN.md token เท่านั้น · ≤768px first · reuse pattern เดิม (backdrop/drawer, `--surface-overlay`, `.tab`, vendor-conditional render).
> **i18n บังคับ (gotcha #42):** ทุก string ใหม่ลง **ทั้ง `th` และ `en` ใน `dashboard/i18n.js`** + ใช้ `data-i18n` ห้าม hardcode. คำให้ standard (เช่น "Data Forwarding / Endpoint URL", "Ingest method", "Pull/Push").
> **save semantics (confirmed):** **save-all ปุ่มเดียว** (full-page scroll เดียว ไม่ซ่อน field = ไม่ลืมกด); backend เบื้องหลังคง 2 PUT เดิม (camera PUT + offline-alert PUT) ได้ — แต่ UX = ปุ่มเดียว.

**Pre / hygiene**
- [x] ~~**CS0**~~ — done 2026-06-20 (พร้อม CS1, commit `7b642c2`). revert temp probe ใน `lpr.js` แล้ว (ไม่เผลอ commit). [memory `project_lpr_cimb_forward`]

**Backend unblockers (อิสระจาก redesign — ship ได้เลย)**
- [x] ~~**CS1 — ทาง A: push receiver honor `paused`**~~ done 2026-06-20 (commit `7b642c2`, deployed). `/lpr`: paused → forward + return (ข้าม ingest); `/face-push`: paused → return. verified live (wipe loop: paused LPR → events คง 0). CS0 (revert temp probe) done พร้อมกัน.
- [x] ~~**CS2 — Forward config-driven (hikvision-scoped) — decision B (opt-in)**~~ code done 2026-06-20 (รอ commit+restart). `forwardToPhuket(body,ct,targetUrl)` parse URL (http/https, port default) + **default-off**: ไม่ forward เว้นแต่กล้องมี `cam.lpr_forward_url` (หรือ admin ตั้ง `system_settings.lpr_forward_default` = optional global, default null). URL พัง → skip+log (ไม่ throw). `cameras.js` persist `lpr_forward_url` hikvision-scoped (body-wins-else-preserve). `HIK-V_LPR01.lpr_forward_url` = CIB ตั้ง explicit ใน config. **decision B (PDPA)**: กล้องใหม่ไม่ auto-forward → ไม่มี sentinel disable (ไม่ตั้ง URL = ไม่ forward). **⚠️ ผลข้างเคียง:** ถ้า HIK-V_LPR01 match mac/ip พลาด (drift) → CIB ขาดฟีดเงียบ (ไม่มี catch-all fallback แล้ว). verified: repro read 4 เคส (no-URL/cam-URL/malformed/unidentified) + write 3 เคส (set/preserve/non-hik). 🟡 SSRF validate + UI → CS6.

**⚠️ Data wipe (re-surface — owner เลือก: ทั้งหมด + backup ก่อน)** — MacBook ใกล้เต็ม: backup DB (pg_dump **นอก repo**) → clear ~38GB (`snapshots/`+`media/`) + truncate events/license_plates/appearances → restructure storage → start ทีละ source. **ตัดสินก่อน CS3–CS6** ว่าต้องมาก่อนไหม (disk วิกฤต = CS1+wipe ก่อน).

**UI — list (frontend, `page-camera-settings.js` `renderAdminCameras` + `index.html` toolbar)**
- [x] ~~**CS3 — Pagination + search + filters**~~ — done 2026-06-20 (commit `719c4ed`). paginate 25/หน้า (client-side) + search + filter vendor/status/location; `_filterPaginate()`/`_camDistinctLocations()` + reuse `renderPagination`/`pgGo`. i18n th+en.

**UI — editor (frontend, biggest; relocate ของเดิม ห้าม rebuild logic)**
- [x] ~~**CS4 — Editor = full-page overlay + section nav (scrollspy)**~~ — done 2026-06-21 (commit `6d620f4`). full-page editor; `#set-cameras.cam-editing` view-swap; horizontal pill nav scrollspy; Esc/back; mobile overflow fix (`.settings-content width:100%`). i18n th+en.
- [x] ~~**CS5 — Ingest method UX**~~ — done 2026-06-21 (commit `6cccec7`). Pull/Push radios = VIEW of canonical `#frmCamPushOnly`; `_syncIngestRadios()`/`_setIngestRec()` advisory-only. Hik=choice, Bosch/Dahua=info, ONVIF=hidden. i18n th+en.
- [x] ~~**CS6 — Data Forwarding section (Hikvision-only)**~~ — done (verified 2026-06-23). `frmFwdSection` ใน Camera Settings: Endpoint URL (`frmCamFwdUrl`→`lpr_forward_url`) + desc (`cs.fwdDesc`) + **PDPA note** (`cs.fwdPdpa`, PII egress + audit) + nav pill. render เฉพาะ `vendor==='hikvision'` (`page-camera-settings.js:499`). on/off = เว้นว่าง=ปิด (แทน toggle แยก — เทียบเท่า, hint ชัด). backend `_validateForwardUrl` SSRF guard (http/https only, private-IP flag, empty=off) → `lpr_forward_url_invalid`; เปลี่ยน URL ลง audit_log. i18n th+en ครบ 7 keys. validator self-check 6/6.

- [x] ~~**CS7** = IM7~~ — done 2026-06-21 (commit `f213cca`). lpr-receiver standalone process (PM2 id 8, port 3003) + `src/lpr-core.js`/`lpr-forward.js`/`lpr-receiver.js` + disk spool/retry + CF tunnel route `^/(lpr$|face-push/)` → :3003. ✅ receiver core→DB→notify→forward verified 14/14 synthetic e2e.

**ลำดับแนะนำ:** CS0 → CS1 → CS2 → [data-wipe?] → **CS3** (list, value สูง risk ต่ำ) → **CS4** (editor, ก้อนใหญ่) → CS5 → CS6. แต่ละ UI phase: i18n th+en + ตรวจ ≤768px + token-only ก่อน commit.

### Reports Redesign (Phase R) — ✅ R1-R5 VERIFIED DEPLOYED 2026-07-03 (code-audit, not just doc)

> หน้า Reports ออกแบบใหม่ครบใน demo `public/others/demo/report/` (`?v=r8`) เมื่อ 2026-06-22
> **แล้วขึ้น production จริงระหว่าง 2026-06-26–28** ผ่าน commit ชุด `a6e305d`→`3c0d9f0`
> (เช็คแล้วว่าไม่ใช่โค้ดเก่าที่คล้ายกันโดยบังเอิญ — วันที่ commit หลัง demo และข้อความ commit
> ระบุ R1-R5 ตรงตัว). ROADMAP เดิม checklist ไม่เคยถูกติ๊ก ทั้งที่โค้ดตามทันหมดแล้ว.

- [x] **R1** — `/api/stats/face/report` (`src/routes/faces.js:255`) + `/api/stats/lpr/report` (`src/routes/lpr-query.js:470`) exist and are live-called from `dashboard/page-reports.js`
- [x] **R2** — Reports page tabbed shell (`tabFace`/`tabLpr` + others, `page-reports.js:1050-1053`) consuming R1 — commit `a6e305d` "redesign Reports page — 6-tab layout matching demo" (2026-06-26)
- [x] **R3** — `report-renderer.js` face/LPR templates confirmed: `renderFaceReportImage`/`Pdf` (:992,:1005), `renderLprReportImage`/`Pdf`/`_renderLprReportSvg` (:1047-1192)
- [x] **R4** — `db_migration_068_report_family.sql` + scheduler dispatch — commit `6b6b431` "R4 — report_family axis + face/LPR schedule dispatch" (2026-06-26)
- [x] **R5** — commit `0924eed` "R5 multi-site scope bar + face/LPR site filtering" (2026-06-27); confirmed `siteWhere()`/`allowedSites` used throughout `src/routes/reports.js` + `src/routes/stats.js`, `GET /api/sites` exists (`src/routes/sites.js:27`). MS-1..MS-8 gate was cleared by the [[project_multisite_camera_sites]] work (migrations 052-056,062-063) before this shipped.
- ค้าง (owner ปรับเอง): frame รถเฝ้าระวัง (LPR watch card) detail · ภาพ captured+ref จริง
- Follow-on commits after R1-R5 also shipped: B1/B2 multi-domain analytics (face/person/lpr), C1-C3 PDF parity, D1-D3+H1-H3 bug patches, person-report redesign (`81a4588`) — all confirmed live per [[project_reports_domain_plan]]/[[project_person_data_redesign]] memory, verified 2026-07-02.
> เดิม: [`docs/superpowers/plans/2026-06-22-reports-redesign-prod.md`](docs/superpowers/plans/2026-06-22-reports-redesign-prod.md) (เขียนตอนวางแผน — โค้ดตามทันหมดแล้วเมื่อเช็ค 2026-07-03)

### Face Page Redesign (FACE-UI, FP1–FP6) — ✅ ALL PHASES LIVE 2026-06-22

> หน้า **ข้อมูลใบหน้า** ออกแบบใหม่ใน demo `public/others/demo/face/` (`?v=f7`, commits
> `693409c`→`b4c97f6`): 4 แท็บ (ภาพรวม/แจ้งเตือนบุคคล/ค้นหา/ตั้งค่า) theme เดียวกับ LPR.
> **ตัดแท็บเฝ้าระวังออก** — face = read-only ฝั่งเรา (FDLib อยู่ที่กล้อง, ไม่มีตาราง face-watchlist).
> modal: crop ↔ FD ref คู่กัน + ฉากเต็ม thumbnail + Body Appearance (vocab จริง) + operator note +
> **ภาพถูกลบ→avatar จาก metadata**. **แผน deploy เต็ม:** [`docs/superpowers/plans/2026-06-22-face-page-redesign-prod.md`](docs/superpowers/plans/2026-06-22-face-page-redesign-prod.md).

- [x] ~~**FP1**~~ — done 2026-06-22 (commit `c5eb368`). 4-tab structure + capture→ค้นหา / match+miss→แจ้งเตือนบุคคล; CSP+i18n+responsive.
- [x] ~~**FP2**~~ — done 2026-06-22 (commit `338a355`). แท็บภาพรวม + `GET /api/faces/stats` (peak period-adaptive + gender/age/expression).
- [x] ~~**FP3**~~ — done 2026-06-22 (commit `92614d4`). modal rework: crop↔FD ref pair + Body Appearance + deleted-image→avatar from metadata; `recog-feed`/`ov-top`/`f-card` demo parity (commit `bade691`).
- [x] ~~**FP4**~~ — done 2026-06-22 (commit `64f6207`, migration 057 `face_event_notes`). `POST/GET /api/face-matches/:id/note`; operator note free-text in modal.
- [x] ~~**FP5**~~ — done 2026-06-22 (commit `fea95e8`, migration 058 `face_event_acks`). blacklist ack; unacked badge on เฝ้าระวัง segment; `GET /api/faces/counts` + `unacked_watch`.
- [x] ~~**FP6**~~ — done 2026-06-22 (commit `0c4ad8a`, migration 059 `face_settings`). `face_similarity_min`(80) + `face_show_expression`(1) seeded; threshold applied query-time (reversible); tab 4→3; Settings›ระบบใบหน้า.

### Person Data Redesign (BODY-UI, BP1–BP4) — ✅ BP1-3 VERIFIED DEPLOYED 2026-07-03 (BP4 optional, not started)

> หน้า **ข้อมูลบุคคล** (body appearance) ออกแบบใหม่ใน demo `public/others/demo/body/` (`?v=b1`,
> commit `ebbbd2d`) แล้วขึ้น production จริงใน `dashboard/page-appearance.js` — commit `bd5a969`
> "deploy body appearance redesign" (2026-06-26). Confirmed live: peak/by-camera chart + KPI
> aggregate (`page-appearance.js:818-885`), color swatch bar (`:778`). theme เดียวกับ Face:
> 2 แท็บ (ภาพรวม/ค้นหา); คง engine forensic เดิม (timeline/ตามคนนี้/map). **แผนเดิม:**
> [`docs/superpowers/plans/2026-06-22-person-data-redesign-prod.md`](docs/superpowers/plans/2026-06-22-person-data-redesign-prod.md) (โค้ดตามทันหมดแล้ว ยกเว้น BP4).

- [x] **BP1** — extend `GET /api/appearances/stats`: peak (period-adaptive) + by-camera + KPI aggregate. done + runtime reproduced 2026-06-22
- [x] **BP2** — แท็บภาพรวม re-skin + KPI/peak/by-camera + forensic collapsible (consume BP1). done 2026-06-22
- [x] **BP3** — แท็บค้นหา re-skin + color swatch picker + search-by-example + Face time/camera cross-link + modal fallback จาก metadata (อิง retention setting จริง). done + runtime reproduced 2026-06-22
- [ ] **BP4** *(optional)* — ทิศทาง→เข้า/ออก ต่อกล้อง (reuse LPR gate). restart
- endpoint `/api/appearances/*` มีครบแล้ว → เบากว่า FACE-UI (restart ~1–2 ครั้ง)

### Operational Roadmap Ph.1-Ph.6 (approved 2026-05-23, decisions #134-#135)

- [x] ~~**Ph.1 Camera offline alert + Status Log**~~ — done 2026-05-23 (commits `8bd275a`, `ea9e869`, `+escalate_once`). Migration 018: `camera_status_log` + `camera_offline_alerts`. `checkOfflineCameras()` extended: logs transitions, fires LINE on offline + recovery, escalation, quiet hours, per-camera recipient CSV. Endpoints GET/PUT `/api/camera-offline-alerts/:id` + GET `/api/cameras/status-log`. Settings › Cameras sub-tabs (📷 Cameras | 📋 Status Log); offline alert config in camera edit form. 22 `co.*` i18n keys. Decision #134. **Follow-up (migration 019, same day):** added `escalate_once` BOOLEAN — checkbox "แจ้งครั้งเดียว (ไม่แจ้งซ้ำ)" hides the repeat-interval field. Logic: `if (!lastAlertAt || (!escalate_once && sinceLastAlert >= escalateMs))`. Reason: user feedback — "0 นาที" was being coerced to 60 by `|| 60` fallback (Math.max(1, ...) clamp anyway), so a real "no-repeat" required a separate flag.
- [x] ~~**Ph.2 Report History**~~ — done 2026-05-24 (migration 021: `report_history`). `runScheduledReport()` logs every attempt (success + failed + skipped). `POST /api/report-schedules/:id/run` manual "run now". `GET /api/report-history` (paginated) + `GET /api/report-history/:id/image` (stream PNG). Retention: rows 90d + PNG files 30d (extended `enforceRetention()`). UI: new "📜 ประวัติรายงาน" sub-tab in Settings › LINE/การแจ้งเตือน + Export CSV. 16 `rh.*` i18n keys (th+en).
- [x] ~~**Ph.3 System Health Report**~~ — done 2026-05-24 (migration 022). New report type `'health'` in `report_schedules` + `health_sections` JSONB column. `renderHealthReportImage()` + `renderHealthReportPdf()` (A4 + page numbers via `displayHeaderFooter`) in `report-renderer.js` share the same `renderHealthReportHtml()` template; server-side i18n via `HR_LABELS.{th,en}`. **4 toggleable sections** (events dropped after user feedback — overlapped with analytics report): cameras, alerts, storage, system. Cameras section: online → minimal row, offline → `created_at` + `last_seen_at` heartbeat + last frame from snapshot metadata (now `has_snapshot` after migration 025; see gotcha #43). Warning banners (offline >50% / disk >85% / RAM >85%). Range picker 24h/7d/30d/custom — applies to uptime % + alert counts. Reports page: 👁 Preview · 📄 PDF · 📥 PNG · 📤 Send to LINE Now (admin, recipient checklist + counter). 5 endpoints: `/api/health/report-data/{cameras,alerts}`, `/api/health/report/{preview,pdf}`, `POST /api/health/report/send-now` (admin, logs to `report_history` with `schedule_id=NULL`). Scheduler day-of-week gate extended to cover `'health'`. `auth.requireAuth/Admin/AdminOrAuditor` patched to bypass when `req.internal===true`. 23 `hr.*` i18n keys.
- [ ] **Ph.4 Event Management** — ack/assign/comment on events; `event_actions` table; audit trail
- [ ] **Ph.5 SOP + Claude AI suggestion** — per-rule SOP templates; Haiku generates draft on alert; operator approves before saving; NOT automation
- [x] ~~**Ph.6 Logs & History consolidated menu**~~ — done 2026-05-24. Added "📋 ประวัติและบันทึก" sidebar section using the rail+content pattern. Consolidates alert logs, report history, camera status log, audit log, and sessions. Report history / camera status / audit remain `admin-only`; sessions and alert logs remain available from the consolidated page.
  **Carry-ins from Ph.3 (added 2026-05-24):**
  1. ~~**Camera Audit Log core**~~ — done 2026-05-26 (migration 024, commit `d08aeae`). Added `audit_log.target_camera_id` + index, camera lifecycle/config hooks (add/edit/delete camera, offline-alert settings, group assignment/removal), redacted camera credentials in details, and added camera filter to the Audit Log UI. Remaining optional polish: CSV export for filtered audit rows.
  2. ~~**events schema cleanup — formerly-dead `has_snapshot` + `snapshot_filename` columns**~~ — done 2026-05-26 (migration 025). Chose option **(b)**: backfilled existing rows from `raw_json->>'_snapshot'`, patched Bosch/Hikvision/Dahua/Face Capture ingesters to update `snapshot_filename` + `has_snapshot=true`, and added partial indexes for snapshot filters. New query rule: use `has_snapshot = TRUE`; read filename via `COALESCE(snapshot_filename, raw_json->>'_snapshot')`.

### LINE Recipient Self-service Onboarding (Phase A done 2026-05-25; polish pending)

Canonical behavior and shipped implementation details live in [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md). ROADMAP keeps only remaining work.

**Phased implementation:**
- [x] **Phase A** (MVP) — migration 023 + webhook store pending + Profile API / Group Summary + UI section "🔍 ตรวจพบใหม่" + approve / ignore + webhook auto-reply.
- [x] ~~**Phase B**~~ (UX polish) — done 2026-05-27 (migration 026, commit `8b359b6`). `oa_basic_id` column + `GET /api/line-config/qr` PNG endpoint; OA Basic ID input in Settings › LINE Config; collapsible 4-step onboarding guide with QR code; 18 i18n keys (th+en); `qrcode` ^1.5.4 added.
- [x] ~~**Phase C**~~ (group lifecycle polish) — done 2026-05-27. `leave` (group/room) and `unfollow` (user) webhook events now disable the matching recipient in `line_config.recipients` (set `enabled: false`) and mark any pending row as `ignored`. Transaction-safe; real recipients unaffected if ID not found.
- [x] ~~**Phase D**~~ (block list + recipient lifecycle hardening) — done 2026-05-27 (migration 028, commits `eb3bc26` `8def7a7` `036ef0a` `b0adf0e`). auto-save on delete; `PUT /api/line-config` resets deleted recipients to `'ignored'`; CTE-based webhook UPSERT captures `prev_status` to fix auto-reply for deleted users who re-register; `'blocked'` status (permanent hard-ignore, never re-appears); block/unblock endpoints + UI; LINE push quota widget (`GET /api/line-config/quota`); pending badge + 30s auto-poll; one-time cleanup SQL for orphaned pre-fix `'approved'` rows (GOTCHAS #46).

### Modular Refactor + Security Hardening — Master Plan (2026-06-03)

> แผนเต็มอยู่ใน [`microservice_plan.md`](microservice_plan.md) — ไฟล์นี้เก็บ status summary

**Phase 0 — ทำได้ทันที, ขนานกัน** *(ไม่รอ refactor)*
- [x] ~~`SEC-2T-003`~~ — commit `src/package-lock.json` + ใช้ `npm ci` (done 2026-06-03)
- [x] ~~`OPS-2T-001`~~ — ลบ `npm run start:all` ทุกจุด → PM2/services.sh (done 2026-06-03)
- [x] ~~`SEC-2T-007`~~ — ลบ `.DS_Store` ทุกจุด + `dotfiles: 'deny'` ใน 3 static mounts (done 2026-06-03)
- [x] ~~`SEC-2T-006`~~ — health warning plaintext creds ใน `/api/health/details` (done 2026-06-03)

**Phase 1 — Origin Isolation** *(ก่อน refactor เสมอ)*
- [x] ~~`SEC-2T-001` (partial)~~ — ลบ `index.html`, `partners.html`, `reference-projects.html`, `vss_v1.html` (2026-06-03); CDN risk ของ EmailJS + Materialize หายแล้ว
- [x] ~~`SEC-2T-001` (remaining)~~ — `boxbox-th.html` + `boxbox-en.html` **ลบแล้ว** ✅ (2026-06-05); Cytoscape CDN risk หมดไปพร้อมกับไฟล์
- [x] ~~`SEC-2T-002`~~ — **✅ DONE 2026-06-05** (commit `93b1c22` + Phase 5): `/others/*` CSP enforced — no `unsafe-inline` script-src; dashboard CSP enforced (`Content-Security-Policy`) — zero inline scripts/handlers

**Phase 2 — Route Module Split** *(= Microservice Phase A, opportunistic)*
- [x] ~~สร้าง `src/helpers/routeError.js` ก่อน (SEC-2T-004)~~ — ✅ DONE 2026-06-05; wired 5 routes (api/users, auth/sessions, eula/status, line-config, line-config/quota)
- [x] ~~Extract route groups เมื่อแตะแต่ละ subsystem → `src/routes/`~~ — ✅ **DONE** — 19 ไฟล์ครบ (2026-06-14; faces 2 routes hold รอ FR module)
  - **สถานะ api-server.js (อัปเดต 2026-06-14):** peak 7,156 ลบ. (`fdbb14d` 2026-06-13) → ปัจจุบัน **1,893 ลบ.** (−5,263 ลบ., −73%); extracted by splitting ~5,395 ลบ. (ส่วนต่าง ~132 ลบ. = features ที่เพิ่มระหว่าง campaign)
  - **✅ Done — 19 ไฟล์ / ~135 routes:**
    - `routes/categories.js` (7) — `b8122a8`
    - `routes/branding.js` (3) — `926962c`
    - `routes/eula.js` (3) — `926962c`
    - `routes/groups.js` (3) — `23fc063`
    - `routes/settings.js` (3) — `23fc063`
    - `routes/users.js` (7 incl. audit-log + csp-report) — `0e19dc7`
    - `routes/alert-rules.js` (5 incl. suggestions) — `3caa6b1`
    - `routes/report-schedules.js` (5 incl. /run proxy) — `7160e68`
    - `routes/ops.js` (8 — backups + alert-logs + push) — `7f352de`
    - `routes/auth.js` (6) — `1205361`
    - `routes/license.js` (4) — `a084038`
    - `routes/events.js` (4) + `routes/appearances.js` (4) — `cd54b64`
    - `routes/cameras.js` (15) — `daff4bf`
    - `routes/stats.js` (20 — stats + occupancy + heatmap) — `21fe1f3`
    - `routes/map.js` (10 — map areas/download + tiles proxy) — `60ab7d2`
    - `routes/line.js` (12 — line-config + pending/blocked/webhook) — `97e8c8e`
    - `routes/health.js` (7 — health details/report + /api/services) — `e81399e`
    - `routes/reports.js` (6 — report-history + pdf/daily/weekly) — `90b831f`
  - **🔲 Hold:**
    - *(faces 2 routes — รอ Face Recognition module FR.1–FR.4 ค่อย merge ใน `routes/faces.js`)*
  - helpers ที่ extract ได้แล้ว: `helpers/routeError.js`, `helpers/getSystemSetting.js`, `helpers/normalizeTimeOfDay.js`
- [x] ~~`SEC-2T-008` (tiles auth-gate)~~ — **✅ WON'T FIX / public by design** (2026-06-05): `/tiles/` ให้ผ่าน PUBLIC_PREFIXES; กระเบื้องเป็น PNG เฉย, overlay ของกล้องถูก gate ที่ `/api/cameras`; ค่าใช้จ่ายถ้า gate = getUserFromToken DB query × 100+ tiles/view; fingerprint risk (tile set เปิดเผยพื้นที่ monitor) — ยอมรับเพราะ weak recon; สอดคล้องกับ SEC-2T-001 (JS = gate, PNG = ไม่ gate)
- [x] ~~Merge `SEC-2T-005` (line-config role) ระหว่างทาง~~ — ✅ DONE 2026-06-05 (commit `fdc50a4`)

**Phase 3 — Extract Heavy Workers** *(= Microservice Phase B, หลัง Phase 2 stable)*
- [x] ~~`alert-worker` (alert-engine + line-sender + push-sender) ผ่าน pg_notify~~ — ✅ DONE 2026-06-06 (commit `79abb51`): alert-engine ย้ายออกจาก mqtt-subscriber → standalone PM2 process; LISTEN `alert_event` + `alert_rules_changed`; E2E verified (real MQTT → pg_notify → alert_logs delta=1)
- [x] ~~`report-worker` (report-renderer) ผ่าน job queue table~~ — ✅ DONE 2026-06-06 (commits `27b4a23` `85da151`): scheduler loop ย้ายออกจาก api-server → standalone PM2 process; HTTP endpoint `127.0.0.1:3001/run/:id` สำหรับ on-demand run; api-server proxy + 503 fallback; launchd autostart verified

**Phase 4 — API Gateway** *(optional, เฉพาะถ้า multi-host จริง)*

---

### NLQ — Natural Language Query + Unified Forensic Search (PLANNED)

> Spec: [`docs/LOGIC_nlq-search.md`](docs/LOGIC_nlq-search.md) — อ่านก่อนเริ่มทุกครั้ง

**แนวคิด:** operator พิมพ์ภาษาไทยธรรมชาติ → LLM แปลงเป็น JSON filter → query ผ่าน
endpoint เดิม. LLM ไม่แตะ SQL โดยตรง.

**Two-path strategy:**
- POC: Claude Haiku API (`@anthropic-ai/sdk`, `claude-haiku-4-5`) — เร็ว, ~$0.001/query
- Production: Ollama + Typhoon2 local — On-Prem, PDPA-safe, ตรง USP

**Backend ready:**
- ✅ `GET /api/appearances/search` (`api-server.js:4821`) — มีแล้ว; **ต้องเพิ่ม `camera_ids[]` (Phase 0)**
- ✅ `GET /api/events` (`api-server.js:2526`) — ครอบทุกกล้อง
- ✅ LPR plate search endpoint — `GET /api/lpr` (`routes/lpr-query.js:41`) search + KPI + 6 MultiPicker filters (region/type/color/plate-color/lane/camera); + `/api/lpr/plate-history`, `/api/lpr/stats` (done 2026-06-23)

**Prerequisites ก่อนเริ่ม:**
1. รัน coverage query (§2 ใน spec) บน production — รู้ว่า appearances data พร้อมแค่ไหน
2. Phase 0: เพิ่ม `camera_ids[]` ให้ `/api/appearances/search`

**Phases:**
- [ ] **Phase 0** — Multi-camera appearances (เพิ่ม `camera_ids[]`)
- [ ] **Phase 1** — `POST /api/nlq/parse` + LLM adapter (API path ก่อน)
- [ ] **Phase 2** — Location resolver (text → camera_ids fuzzy match)
- [ ] **Phase 3** — LPR plate search endpoint + หน้า Unified Forensic Search UI
- [ ] **Phase 4** — Switch to local Ollama + Typhoon2 (production)

---

### VMS Playback — On-demand Video Retrieval (PLANNED)

> Spec: [`docs/REF_vms-playback.md`](docs/REF_vms-playback.md) — อ่านก่อนเริ่มทุกครั้ง
> Primary model: **on-demand proxy** — vigil stores no video; fetches RTSP URL just-in-time from VMS when operator requests playback.

**แนวคิด:** แทนที่จะเก็บวิดีโอใน vigil server เอง operator เปิดดู playback ผ่าน VMS เดิมของลูกค้า
ลดค่า storage ได้ ~100% (เฉพาะ video) vigil ทำหน้าที่เป็น proxy เท่านั้น

**Target VMS (Qognify SGS REST API v7.2):**
- Qognify VMS, SeeTec, Coda Video, HxGN dC3 Video — ใช้ SGS API ชุดเดียวกัน
- ต้องเปิด SGS (Server Gateway Service) module ใน VMS ก่อน

**Critical traps (จาก PDF review):**
- Responses เป็น XML เสมอ — ต้อง check `<a:ErrorCode>` ใน body, ไม่ใช่ HTTP status
- Auth: Base64 encode แล้ว URL-encode อีกชั้น (`+/=` เป็น URL-special)
- RTSP URL มีอายุ 60 วินาที, single-use — request just-in-time เท่านั้น
- HTTPS บังคับ; self-signed cert พบบ่อย → ต้องรองรับ `rejectUnauthorized: false`
- ต้องติดตั้ง Qognify Transcoding Service
- RTSP ใช้ port แยก (ปกติ 9100 — verify กับ admin ก่อน)
- Browser ไม่เล่น RTSP โดยตรง → ต้อง ffmpeg proxy → HLS/fMP4 (Phase 3)

**Phases:**
- [ ] **Phase 0** — Prerequisites & Connectivity (verify SGS installed, create API user, map entityIDs, check RTSP port, add `npm install fast-xml-parser`)
- [ ] **Phase 1** — SGS Adapter Module (`src/services/qognify-sgs-adapter.js` + provider interface `src/services/vms-playback-provider.js`; smoke test connect/getCameraList/getArchiveRanges)
- [ ] **Phase 2** — JPEG Frame Fallback Path (`/api/vms/frame/:id?t=<ms>&w=<px>`; no ffmpeg needed; stepwise frame navigation in UI)
- [ ] **Phase 3** — RTSP → HLS Proxy Path (ffmpeg required; `hls.js` self-hosted; 4 vigil endpoints: `/api/vms/cameras`, `/api/vms/archive-ranges/:id`, `/api/vms/playback/:id`, `/api/vms/frame/:id`)
- [ ] **Phase 4** — Settings & Operator UI (SGS credentials in Settings page; camera VMS mapping; test connection button; env vars: `SGS_HOST`, `SGS_PORT`, `SGS_USERNAME`, `SGS_PASSWORD`, `SGS_REJECT_UNAUTHORIZED`)
- [ ] **Phase 5** *(optional)* — Event-triggered Clip Pull (operator clicks event → auto-seek to ±30s window in VMS)

**Prerequisites ก่อนเริ่ม Phase 1:**
1. Verify SGS module installed บน Qognify VMS server + Transcoding Service active
2. Create dedicated API user (ไม่ใช้ admin account)
3. Map entityIDs ของกล้องแต่ละตัวใน VMS (จาก `GET /api/service/cameras`)
4. Confirm RTSP port (9100 หรือค่าอื่น)
5. `npm install fast-xml-parser` ใน `src/`

---

### High priority (next session candidates)
- [x] ~~**PM2 production setup**~~ — done 2026-06-03 (DECISIONS #198 #199). concurrently replaced; 7 workers autostart (alert-worker + report-worker added 2026-06-06); boot plist installed; Service Management UI shipped.
- [x] ~~**License key system**~~ — done Phase 8.0 + 8.1 (2026-05-19); see decisions #100–#108 and "Phase 8 — License MVP + EULA" Completed Features
- [ ] **Source-code protection** (Phase A: obfuscation + Node SEA binary) — design captured in "🔐 Strategic direction" roadmap section below; deferred until after first 1–2 customer pilots
- [x] ~~**Full platform rename**~~ `bosch-mqtt-dashboard/` → `vigil-platform/` — done 2026-05-29. Phase 1: file edits 26 files (commit `175cfab`); Phase 2A: DB+Docker migration — pg_dump → vigil-postgres fresh init → pg_restore (7 cameras / 51,322 events verified); Phase 2B: folder mv + GitHub rename + git remote + services start + launchd backup reloaded; Phase 3: grep clean (carve-outs intact), all services up. Rollback dump: `backups/pre-vigil-rename-20260529_124719.dump`.

### System Audit 2026-06-10 — Action items + Incident record

> Audit 2 รอบในวันเดียว: รอบแรก (A1-A7) หลังแก้ EHOSTUNREACH รอบสอง (Fable 5,
> ลึกกว่า) **เจอ incident กำลัง active**: clip recording ล่มเงียบ ~17 ชม. →
> นำไปสู่ root cause จริงของ #82/#83 ทั้งหมด = **macOS Local Network Privacy**
> (**GOTCHAS #84** คือ entry หลัก). สุขภาพระบบส่วนอื่นดี: 7 workers stable,
> DB 55MB/71k events healthy, npm audit 0 vuln, EMQX bcrypt auth,
> retention ครบทุกชั้น, dead index = 0, backup dump รายวันทำงาน.

**✅ เสร็จแล้ว (commits: `bbdd1b2`→`8d3c65a`, 2026-06-10):**
- [x] **Incident clip-recording** — แก้ + verify (54 segments/นาที, error 0 บรรทัด);
      root cause = LNP per-binary record; fix = PM2 ใต้ Terminal.app (GOTCHAS #84)
- [x] **Preventive ชุดใหญ่** (commit `50c1710`): media-recorder กรอง `enabled=TRUE` /
      ffmpeg backoff 5s→60s / `redactCreds()` กัน password รั่วลง log
      (+ 2026-06-10: purge log เก่า rotated ที่มี RTSP password plaintext ค้าง —
      ตรวจซ้ำทั้ง `~/.pm2/logs/` แล้วไม่เหลือไฟล์ที่มี creds) /
      `media_buffer[].newest_segment_sec` ใน `/api/health/details` (detect wedge) /
      `scripts/pm2-lan-safe-restart.command` / GOTCHAS #84 / service_start.md
- [x] **1-A boot path** — `pm2.dojojin.plist` ใหม่ = `open -a Terminal <script>`
      (ทดสอบ end-to-end: launchd → Terminal → resurrect → ffmpeg ได้ grant;
      plist เดิม backup ที่ `/tmp/pm2.dojojin.plist.bak`; **โบนัส:** plist เดิมมี
      PATH node@22 นำหน้า = ต้นตอ daemon resolve v22 — หายไปพร้อมกัน)
- [x] **brew pin node@20 + ffmpeg** — กัน upgrade เปลี่ยน Cellar path → LNP record หาย
- [x] **A2 pm2-logrotate** (10M / retain 14 / compress)
- [x] **A5 error logging** — `alert-engine.js` + `mqtt-subscriber.js` ไม่ log บรรทัดว่างอีก
      (commit `ec5cb9a`) + ลบ media-buffer dir เก่า 5 ตัว (รวม typo `ฺBOSCH_8000i_01`)
- [x] **A7 verify health endpoint** — minted temp session: `cameras.list` 7 ตัว +
      `media_buffer[]` ทำงานจริง (ลบ session ทิ้งแล้ว)
- [x] **S-NEW1 bind 127.0.0.1** (commit `8d3c65a`) — ปิด LAN ยิง API ตรงข้าม
      Cloudflare Access; `BIND_HOST` override ใน .env.example; verify: LAN refused,
      tunnel ปกติ (Vigil Mobile ไม่ยิง LAN ตรง — ยืนยันแล้ว)

**✅ A4 — Backup offsite (Tier 1) — done 2026-06-10:**
- [x] rclone → Google Drive (`gdrive:` scope drive.file, บัญชี 5TB) + **crypt layer**
      (`gdrive-crypt` — ชื่อไฟล์+เนื้อหาเข้ารหัสฝั่ง client, CRYPT_PASSWORD/SALT
      อยู่กับ owner ใน password manager — ขาดรหัส = restore เครื่องใหม่ไม่ได้)
      · `backup.sh` ต่อท้าย: upload dump วันนี้ + config bundle (.env, cameras-config,
      camera-groups, config/, branding/, licenses-issued/, plists ×2) → `dumps/` + `config/`
      retention ฝั่ง Drive 30 วัน · rclone fail = warn ไม่ล้ม local backup
      · verified: upload จริง + raw Drive เป็น ciphertext + round-trip checksum ตรง 100%
      · Tier 3 (snapshots/media ~320MB/วัน) ตัดสินใจไม่ขึ้น Drive — retention ในตัวพอ
- [ ] (ค้างจาก A4 เดิม) **Time Machine destination พัง** (Code 17) — ฝั่งเจ้าของซ่อม/เปลี่ยน disk

**🔜 ค้างอยู่:**
- [x] ~~**A1 + A6 — runtime เดียว node@24 LTS ครบ 7 apps**~~ — done 2026-06-10
      (ทำคู่กันหลัง 1-B เปิดทาง): `interpreter` ย้ายเข้า `base` ใน ecosystem.config.js =
      `/opt/homebrew/opt/node@24/bin/node` (v24.16.0) ทุกตัว · repro 2 ชั้นก่อนอัป:
      node@24 จาก tmux → EHOSTUNREACH (control), ใต้ PM2/app grant → HTTP 200 ·
      verify หลังอัป: กล้องครบ, buffer 55 seg/นาที, api 401 ปกติ, dump.pm2 full path ·
      `brew pin node@24` (unpin node@20 — เก็บไว้เป็น fallback ยังไม่ uninstall) ·
      VigilPM2.app PATH → node@24 · **ปิดทั้ง EOL (A6) + mqtt-subscriber latent
      Bosch HTTP (A1) + interpreter drift ในคราวเดียว**
- [~] **A3 — Disk เต็ม** — ฝั่ง project ทำแล้ว 2026-06-10: purge ข้อมูล พ.ค. ทั้งหมด
      ตามคำสั่งเจ้าของ (events 53,367 แถว + snapshots 8,911 ไฟล์/2.6GB + clips 4,181
      ไฟล์/9.8GB + reports 32 ไฟล์ + thumbs) → คืน ~13GB, disk เหลือ 58GB (~87%);
      DB rows กู้ได้จาก dump 2026-06-10 03:14, ไฟล์สื่อกู้ไม่ได้ —
      ตัวกินหลักที่เหลือ: `~/Library` 209GB + `~/Parallels` 35GB (ฝั่งเจ้าของ)
- [x] ~~**1-B — Wrapper app ถาวร**~~ — done 2026-06-10: `scripts/VigilPM2.app`
      (LSUIElement, multicast+Bonjour trigger, log /tmp/vigilpm2.log) ถือ LN grant เอง —
      พิสูจน์เทียบ control (tmux ยังโดน block) + รอด nehelper/mDNSResponder reload;
      `pm2.dojojin.plist` ชี้ app แล้ว boot path ทดสอบ end-to-end.
      **เหลือเช็คครั้งเดียว:** หลัง reboot จริงครั้งถัดไป ดู `media_buffer` ใน health
      ว่า grant คงอยู่ (LNP store ของ unsigned app อ่านตรงไม่ได้)
- [x] ~~**S-NEW2 — `chmod 600 .env`**~~ — done 2026-06-10 (`-rw-------`); ทุก service
      รันเป็น user `dojojin` (เจ้าของไฟล์) จึงไม่กระทบการอ่านตอน boot
- [x] ~~**LINE alert เมื่อ `media_buffer` stale > 5 นาที**~~ — done 2026-06-10:
      `checkStaleRecorders()` ใน api-server (รอบ 60s) — mirror `recorderNeeded()`,
      ข้ามกล้อง offline/paused (กัน LINE สองเด้ง), boot grace 3 นาที, alert ครั้งเดียว
      ต่อ episode + recovery, เคารพ enabled/quiet hours ของ camera alert เดิม;
      repro จริง: stop recorder → 🟠 ที่ 325s, start → 🟢 ใน 5s (duration ถูกต้อง)

### Data Enrichment จากกล้องที่มีอยู่ (plan 2026-06-10)

> ที่มา: investigation payload 3100i + เทียบเอกสาร Bosch "IVA Pro Integration Support"
> (ยืนยัน: Direction/geometry ไม่มาทาง MQTT ของ Bosch โดย design; Duration ไม่มี field
> — Loitering เป็น trigger; Dahua ส่ง Direction+BoundingBox มาแล้วแต่ยังไม่ใช้)

- [ ] **Ph.0 — Config กล้อง (ฝั่งเจ้าของ, ศูนย์โค้ด):** rule แยกทิศบน 3100i (วิธีทางการ
      ของ Bosch) · เสียบ BOSCH_8100i กลับ (Appearance เต็มชุดไหลทันที) · เปิด Appearance
      ใน 8000i config ~~← ผิด: 8000i (CPP7.3) ไม่รองรับ ดู AP.2~~ · (เลือกได้) เพิ่ม task Crowd/Start-stop บน 3100i
- [x] ~~**Ph.1 — Dwell time จากคู่ `IsInside` true→false**~~ — done 2026-06-10:
      `GET /api/stats/dwell` (summary + episodes) — window-function pairing บน
      `event_state`, ตัดคู่ห่าง >24 ชม.; verified ข้อมูลจริง: "คนเปิดตู้เย็น" 50 ครั้ง/3วัน
      เฉลี่ย 2s สูงสุด 21s. **Follow-up:** Stats UI card ✅ done 2026-06-10
      (card "เวลาอยู่ในโซน" หน้า Statistics — ตาราง per camera+rule, group filter
      ฝั่ง client) · alert "อยู่นานผิดปกติ" ✅ done 2026-06-11 (migration 044:
      `alert_rules.dwell_threshold_sec` — ตั้งแล้ว rule เปลี่ยนเป็น dwell mode:
      alert-worker เช็ค open episode ทุก 60s, ยิง LINE ระหว่างคนยังอยู่,
      cooldown = ระยะเตือนซ้ำ, `{duration}` ใช้ใน template ได้; reuse
      recipients/quiet-hours/log เดิมทั้งหมด). ⚠️ caveat ที่รู้: open episode
      อาจ stale ได้ถ้ากล้องพลาดขาออก (เห็นจริง 2026-06-11 ดึก: true ค้าง 3.8 ชม.
      หลังเลิกงาน) — cooldown กัน spam, operator ดู {duration} ผิดปกติ = เช็คกล้อง
      (หมายเหตุ: Dahua ยังไม่มีคู่ — ส่งแต่ enter, รอ Ph.2)
- [x] ~~**Ph.2 — Dahua Direction + BoundingBox**~~ — done 2026-06-10:
      พบ bug แฝง — dahua-cgi hardcode `event_state='true'` ทุก event ทั้งที่กล้องส่ง
      Enter(541)/Leave(318) → map Enter→true, Leave→false (convention เดียวกับ Bosch;
      Leave จะถูกซ่อนจาก Events list แบบเดียวกับ Bosch leave) · modal เพิ่ม field
      "ทิศทาง" (เข้าโซน/ออกจากโซน, i18n ครบ) · BoundingBox อยู่ใน raw_json อยู่แล้ว
      (overlay บน snapshot ✅ done 2026-06-10: `attachSnapOverlay()` วาด BBox +
      DetectRegion polygon บน event modal + faceRect บน Face modal ของ Hikvision —
      SVG normalized 0–1, contain-aware) · verified live: คนเดินผ่านจริง →
      `/api/stats/dwell` ได้ Dahua pairs ทันที (Intrusion Detection 64s/69s สองกล้อง)
      · **Hikvision Smart Events ✅ live 2026-06-11**: เปิด Intrusion+Line Crossing
      บนกล้องจริง → `detectionRegions` เข้าครบ (points grid 0–1000 + targetRect 0–1
      ของตัวคนที่ trigger) → overlay ต่อเข้า `attachSnapOverlay()` แล้ว (zone toggle
      คุม polygon/เส้น, bbox toggle คุม targetRect) · gotcha ที่เจอ: UI กล้องต้อง
      กด Save ใน Rule tab ให้ rule `enabled=true` จริง — เปิดสวิตช์ใหญ่อย่างเดียว
      event ไม่ยิง (ตรวจผ่าน `/ISAPI/Smart/FieldDetection/1`)
- [x] ~~**Ph.3 — ColorCluster ครบ 2-3 สี + weight**~~ — done 2026-06-10: migration 042
      `color_clusters JSONB` [{xyz,name,weight}] เรียง weight (cap 4) · search สองสี
      ผ่าน JSONB containment (`upper_color=Black&lower_color=White` = ทั้งคู่ต้องอยู่ใน
      clusters; ไม่ cross upper/lower ของแถวกล้อง Pro) · chips โชว์ ≤3 สีพร้อมสี่เหลี่ยมสี ·
      verified live: แถวจริง Black 43%/Brown 19%/White 11% — ค้นดำ+ขาวเจอ, ดำ+แดงว่าง
- [ ] **Ph.4 — ONVIF RTSP metadata ingester (Bosch geometry)** — ⏸ defer รอ signal
      ลูกค้า (ingester ใหม่ทั้งตัว; Ph.2 ให้ geometry จาก Dahua ฟรีก่อนแล้ว)

**Appearance unification (สำรวจ 2026-06-12)** — coverage จริง 7 วัน: 8100iX_02
197 rows เต็มชุด Pro (เพศ+เสื้อผ้า+สี) · 3100i 208 rows โทนสีอย่างเดียว (non-Pro) ·
**Hikvision 0 rows** (เพศ/อายุ/แว่น/หมวก/mask/อารมณ์ติดอยู่ใน raw_json/หน้า Faces
เท่านั้น) · 8000i 0 (ยังไม่เปิดบนกล้อง) · Dahua 0 (กล้องส่งสีเป็นศูนย์):
- [x] ~~**AP.1 — Hikvision FaceCapture → appearances**~~ — done 2026-06-12:
      ingest live (เพศ normalize เป็น Male/Female + แว่น รวม sunglasses; **hat จงใจ
      ไม่ map** — helmet ของ Bosch คือหมวกนิรภัย คนละความหมาย) + backfill 776 แถว ·
      verified: search gender=Female ได้ Hik 59 + Bosch 141, glasses=true ได้
      Hik 124 + Bosch 49 — ครอบข้าม vendor แล้ว
- [x] ~~**AP.2 — เปิด Appearance บน BOSCH_8000i**~~ — ❌ **ตกไป 2026-06-12: กล้อง
      ไม่รองรับ** (verify: ONVIF probe = FLEXIDOME IP starlight 8000i FW 7.93 =
      CPP7.3; เอกสาร Bosch: IVA Pro Appearance ต้องการ CPP13 FW8.47+/CPP14 FW9.40+
      เฉพาะรุ่น 8100i/5100i/DINION 7100i/5100i — CPP7.3 อัป firmware ข้ามสายไม่ได้)
      · โบนัส: 3100i = DINION 3100i CPP14 แต่เอกสารระบุ "ยกเว้น 3000 series" →
      Appearance เต็มไม่ได้เช่นกัน (ตรงกับที่ส่งแค่ Class+Color) · note เดิมใน Ph.0
      ที่ว่า "เปิด Appearance ใน 8000i config" = ข้อมูลผิด แก้แล้ว
- [x] ~~**AP.3 — เปิด Object Attribute extraction บน Dahua**~~ — ❌ **ตกไป
      2026-06-12: รุ่นที่มีไม่รองรับสีเสื้อ** (verify ด้วย CGI probe จริง):
      BMA-EAST = DH-IPC-HFW2241S-S (2-series) ไม่มี attribute config ใดๆ ·
      DAHUA_CAM01 = IPC-HFW5541E-ZE (AI 5-series) มีเฉพาะ **face** features
      (FaceDetection rule + Age/Sex/Glasses/Emotion เปิดอยู่) — ไม่มี
      HumanTrait/clothing color ใน VideoAnalyseRule ทั้งชุด → MainColor=0 คือ
      ขีดจำกัดรุ่น · ไม่เปิดรับ Dahua FaceDetection แทน: ขัด decision #117
      (demographics ไม่น่าเชื่อถือ) ซึ่ง GOTCHAS #87 สนับสนุนเพิ่ม ·
      ผลพลอยได้: dahua-cgi มี unmapped-code log-once แล้ว (เหมือนฝั่ง Hik)
- [x] ~~**AP.4 — color_clusters สำหรับแถว Pro**~~ — done 2026-06-12: clusters ติด
      ป้าย `part` ('top'/'bottom') กัน cross กับกติกา upper/lower ของ Ph.3 · search
      containment แยกตาม part · แก้ bug แฝง ColorCluster array → null · backfill
      654 แถวเก่า · verified: Blue/Black row — upper=Blue ✓, upper=Black ✗ (no
      cross), lower=Black ✓, non-Pro 181 แถวค้นได้เหมือนเดิม
- [x] ~~**AP.5 — Forensic timeline**~~ — ✅ DONE 2026-06-12 (5a/5b/5c ครบ; endpoints `GET /api/appearances/timeline` + `/similar-timeline` ยืนยันใน `routes/appearances.js:375,415`). แผนละเอียด 2026-06-12 (ฐานพร้อม: appearances
      ครอบ 3 แหล่งหลัง AP.1/AP.4; กล้องมี lat/long; ผูกกับ NLQ Phase 3):
      - [x] ~~**AP.5a — Timeline จาก filter (MVP)**~~ — done 2026-06-12:
            `GET /api/appearances/timeline` (filter builder ใช้ร่วมกับ search,
            group กล้องเดิมห่าง ≤180s เป็น segment, cap 2000 rows) + ปุ่ม
            "เส้นเวลา" ในหน้า Appearance Search → เส้นเวลาแนวตั้ง วัน/เวลา/
            กล้อง/location/thumb/chips + disclaimer · PDPA: จำกัด admin/auditor
            (403) + ลง audit_log 'forensic_timeline' ทุกครั้ง · verified:
            เสื้อดำวันนี้ 157 rows → 91 segments ข้ามกล้อง
      - [x] ~~**AP.5b — "ตามคนนี้"**~~ — done 2026-06-12:
            `GET /api/appearances/similar-timeline?event_id=` — similarity จาก
            weight pool ของ attribute ที่ anchor มีจริง (สีบน/ล่าง 3, โทน 4,
            หมวดเสื้อ 1, แว่น 1, เพศ 0.5 ตาม #87; "เทียบไม่ได้"≠"ไม่ตรง" —
            ตัดออกจาก pool ทำให้ cross-fidelity Pro↔3100i ผ่าน threshold ได้
            สองทิศ) · ปุ่ม "ตามคนนี้" บน card ค้นหา + ทุก segment ของ timeline ·
            แสดง ~score% ต่อ segment · PDPA gate + audit 'forensic_follow' ·
            verified: anchor ชายเบจ/น้ำเงิน 86003 → 76 rows/27 segments รวม
            ข้าม vendor ไป Hikvision 2 segments; unit 8 เคสรวม #87 gender-mismatch
      - [x] ~~**AP.5c — เส้นทางบนแผนที่**~~ — done 2026-06-12: ปุ่ม "แสดงเส้นทาง
            บนแผนที่" ใน timeline → สลับหน้า Map วาด polyline เส้นประ + จุดเรียง
            หมายเลขพร้อมช่วงเวลา (ยุบ segment กล้องเดิมติดกัน, ข้ามกล้องไร้พิกัด
            พร้อมแจ้ง) + fit extent + ปุ่มล้างเส้นทางบน toolbar · verified logic
            กับข้อมูลจริง: 91 segments → 49 จุดสลับกล้อง
      - ข้อจำกัดติดประกาศใน UI: เป็น **attribute matching ไม่ใช่ระบุตัวตน**
        (สองคนเสื้อเหมือนกันปนได้) — ออกแบบให้เสียบ Face Recognition/pgvector
        (REF_face-recognition.md) ภายหลังได้
      - **PDPA:** จำกัด role admin/auditor + ลง audit_log ทุกครั้งที่ใช้
      - ลำดับแนะนำ: 5a → 5c → 5b

**Hikvision People Counting (2026-06-12)** — ingest ✅ done (commit `cb64976`);
⚠️ **หยุดไหล 2026-06-12 เย็น**: เจ้าของเปิด Face Capture กลับ — กล้องรุ่นนี้เปิดคู่
People Counting ไม่ได้ (memory กล้องไม่พอ) → เลือก Face; PC.1 card คงอยู่
(แสดงข้อมูลช่วงที่เคยเปิด) พร้อมใช้ทันทีถ้าสลับกลับ:
กล้อง push enter/exit ทุก 15 นาที → เก็บเป็น `CountAggregation/PeopleCounting`
(ซ่อนจาก Events list อัตโนมัติผ่าน filter ตระกูล Aggregation เดิม; กัน duplicate
retransmission ด้วย window_start) · verified ค่าจริง enter=1 จากการเดินผ่านเส้น:
- [x] ~~**PC.1 — กราฟ traffic เข้า-ออก บนหน้า Stats**~~ — done 2026-06-12
      (commit `e81e8d3`): card "คนเข้า-ออก" bar chart enter/exit, bucket อัตโนมัติ
      15m/1h/1d, group filter ได้, badge ยอดรวม; verified ข้อมูลเที่ยงวันแรก 32/19
- [ ] **PC.2** (ตัวเลือก) — สรุปลง Health/Executive report รายวัน (คนเข้าร้านวันนี้
      X คน) เมื่อ PC.1 เสถียร

### Phase 7 follow-ups (audited 2026-05-15)
- [x] ~~**Puppeteer browser pool**~~ — done 2026-05-15 (commit `36475d2`). Module-level `_getBrowser()` launches Chromium once, `_withPage()` opens a fresh page per render and closes it on exit. `disconnected` event triggers transparent relaunch on next call. `SIGINT`/`SIGTERM` close the pool cleanly. Verified: render 1=1419ms (cold), 2=159ms, 3=152ms — **~9× faster warm**. See decision #95.
- [x] ~~**WS new_event via Postgres LISTEN/NOTIFY**~~ — done 2026-05-15 (commit `1ffba23`). mqtt-subscriber now `pg_notify('new_event', <id>)` after INSERT; api-server's existing `listenClient` picked up a second channel, queries the row by id, applies the same occupancy feed + `isMetricEventType`/`isHiddenAnalyticsEvent` filters, then broadcasts. The `setInterval(..., 1000)` poll + `lastEventId` watermark are gone. End-to-end smoke verified (insert → NOTIFY → WS row delivered). See decision #96.
- [x] ~~**`src/package.json` slim-down**~~ — done 2026-05-15 (commit `a0f5b07`). 149 declared deps → 10 real direct deps: `bcryptjs, cors, dotenv, express, mqtt, multer, pg, puppeteer, sharp, ws` (+ devDep: `concurrently`). Verified clean `npm install` (235 packages → 0 vulns), all 5 entrypoints parse, full stack boots, LISTEN/NOTIFY re-verified post-strip. See decision #97.
- [ ] **PDF auto-delivery to email** — currently LINE-only (decision #91). SMTP path (generic config, not SendGrid-locked) is the natural follow-up for customers without LINE.

### Phase 5c — ✅ Reports Auto-delivery (done in Phase 7.3)
- [x] ~~Schedule daily/weekly/monthly report~~ — `report_schedules` table + scheduler loop
- [x] ~~Send to LINE~~ — image (compact / full) via imgbb + push (LINE has no file type)
- [x] ~~UI to configure schedule + recipients~~ — modal on Reports page
- [ ] ~~SMTP email~~ — see Phase 7 follow-ups above (deliberately not done in 7.3)
- [x] ~~Auto-store report history with browsable list~~ — done Ph.2 (migration 021): `report_history`, Settings › LINE "📜 ประวัติรายงาน", PNG download, CSV export, 90d row retention / 30d PNG retention

### Future versions (per Roadmap slide)
- **v1.4** *(milestone passed — current: v1.5.3)*: Push notifications ✅ (`push-sender.js`, `push_tokens`, Expo Push API — shipped); Mobile App (vigil-mobile — push infra ✅, UX phases 1–6 pending); Biometric login ❌ deferred
- **v1.5 (current — v1.5.3):** AI Anomaly detection ❌, Person re-identification ❌, Search by image ❌ — deferred to future phase
- **v2.0:** Multi-tenant SaaS, Tenant isolation, Cross-site analytics
- **v2.1:** Predictive analytics, BI dashboard, API marketplace

### Design System Migration — 6-Phase Plan (#173)

> **Approved 2026-05-28 · decision #173.** ไฟเขียว Q1/Q2/Q3 ทั้งหมด.
> ทำ incremental ไม่ใช่ big-bang. ทุก phase ship แยกได้ · rollback ปลอดภัย.
> Convention หลัง Phase 0: **new code ใช้ semantic token เท่านั้น** ห้ามแตะ `--bg/--panel` ตรงๆ.
> Legacy + semantic coexist เป็น alias ตลอด migration.
> ห้ามแตะ `src/report-renderer.js` SVG template (GOTCHAS #25a — librsvg abort).

- [x] ~~**Phase 0 — Foundation**~~ — done (verified 2026-05-29, ROADMAP stale). semantic token alias block (`--surface-base/elevated/overlay`, `--text-primary/secondary`, `--status-ok/bad`, `--border-hairline`, `--accent-muted`, `--warn`) ใน `:root`; `--bg-card`+`--card2` declared; JetBrains Mono/Sarabun purged; `dashboard/icons.svg` (18 symbols); `dashboard/design-tokens.js` (`token()` + `clearTokenCache()`); DESIGN.md 0 TODO.

- [x] ~~**Phase 0.5 — Visual Restraint**~~ — done (verified 2026-05-29). ทุก target ถูก apply ก่อนหน้านี้แล้ว: `.logo-icon`/`.user-avatar` → solid `var(--accent)`; `--accent-muted` defined; `.btn-primary:hover` ใช้ `--accent-muted`; `.src-mqtt` → `var(--accent)`; `--accent2`/`--purple`/`--cyan` ไม่มีใน `:root`

- [x] ~~**Phase 1 — Security Morning Briefing**~~ — done 2026-05-29. Layout 5 tier (Status Strip/Attention/Activity 24H/Site Map+Hotspots/Footer), default page, semantic tokens, i18n `smb.*` keys (th+en), dead `--es-*` CSS purged.

- [x] ~~**Phase 2 — Component CSS Classes**~~ — done (verified 2026-05-29, ROADMAP stale). `.field-hint` / `.text-dim` / `.row-action` / `.card-flush` / `.stack-sm/md/lg` ครบใน `index.html` บรรทัด 1172–1181; บางส่วน apply แล้วใน HTML.

- [ ] **Phase 3 — Opportunistic Migration** *(ongoing, ไม่มี deadline)*
  - ทุก PR feature/bug หลัง Phase 2: ใช้ semantic token + class จาก Phase 2 + SVG icon ใหม่
  - หน้าที่ "แตะแล้ว" → เก็บกวาด token + inline style ในส่วนนั้น
  - ❌ ห้าม sweep หน้าที่ไม่ได้แตะ · ห้ามแตะ emoji `🔕` (#90) · ห้ามแตะ Health Report SVG template

- [x] ~~**Phase 4 — Chart/Map Token Wiring**~~ — done 2026-05-29. ~20 hex replaced: OpenLayers cluster fill/stroke, chart axis ticks, stats colorize, trend arrows, per-camera bar, category chip fallback, health badge. Categorical palette arrays (COLORS[], group picker) intentionally kept. Static analysis only — runtime verify recommended.

- [x] ~~**Phase 5 — Sidebar SVG**~~ — ✅ done, **ไม่มี backlog จริง** (2026-07-03 ถอนคำแก้ก่อนหน้าในวันเดียวกัน — เช็คผิดไฟล์). ทุก `href="#icon-*"` resolve จาก **inline sprite ใน `dashboard/index.html`** (`<div style="display:none"><svg>...</svg></div>`, comment บอกไว้ตรงๆ ว่า "inline so `<use>` works without CORS") — ไม่ใช่จาก `dashboard/icons.svg`. เช็คจริงผ่าน browser DOM (`getElementById` ต่อทุก id ที่ใช้ใน `dashboard/*.js`+`index.html`): **ครบทั้ง 44 symbol ที่ต้องใช้ ไม่มี blank**. `dashboard/icons.svg` (31 symbols, นับได้เดิม 14/20 "ขาด") เป็นไฟล์ orphaned — grep ทั้ง repo ไม่มีที่ไหน `<link>`/`fetch`/`<object>` เรียกมันเลย เป็น "Phase 0 skeleton" ที่ถูกแทนที่ด้วย inline sprite ตอน Phase 5 แล้วไม่มีใครลบไฟล์ทิ้ง — เก็บไว้เป็น dead reference ก็ได้ หรือลบทิ้งก็ได้ (ไม่กระทบ production ทั้งคู่).
  > **บั๊กใหม่ที่เจอระหว่างตรวจ (แยกเรื่อง ไม่ใช่ icon backlog):** 3 ปุ่มบน Map (STREETS/CARTO/ONLINE — `togStyle`/`togProvider`/`togSource`) ไอคอนหายจริงในหน้าเว็บ (ยืนยันผ่าน DOM: `querySelector('svg')` คืน null) — root cause คือ `page-map.js:214,225,243` เซ็ต `btn.textContent = ...` ตอน toggle (และตอน sync ค่าจาก localStorage ตอนโหลดหน้าด้วย) ซึ่งลบ child `<svg>` ทิ้งทั้งก้อน ไม่ใช่ symbol หาย. ยังไม่แก้ — รอ confirm.

- [x] ~~**Phase 6 — Polish**~~ — done 2026-05-29 (most items). Health card titles stripped (8 cards), automation/image-quality data rows, map toggle buttons (STREETS/LIGHT/CARTO/MAPBOX/ONLINE/OFFLINE), Settings Save → icon-save SVG, user role chips text, camera group ALL tab, Stats 📊→icon-stats SVG, report schedule ✏️/🗑️→SVG/⏳→…, i18n values (rep./hr./rh./rs./bk./mapMgr.*), language switcher, "All categories" option. Remaining carve-outs: LINE alert template, EULA/license modals (DESIGN.md §4). Audit log actionIcons map deferred (needs SVG sprite expansion → separate session).

### Executive Summary → Security Morning Briefing (#172)

- [x] ~~**Redesign Executive Summary → "Security Morning Briefing" (หน้าหลัก)**~~ — decision #172. Done 2026-05-29. ออกแบบใหม่ทั้งหมดสำหรับ persona = **Security Manager** (เช้ามาดูภาพรวม, ไม่ใช่ executive ที่ดู PDF report); ตอบ 3 คำถามใน 3 วินาที: (1) ระบบโอเคไหม? (2) มีอะไรต้องทำต่อไหม? (3) activity ผิดปกติไหม?

  **Layout (top → bottom = actionable → informational):**
  1. **Status Strip** — `N/total cams online · MQTT live · XX% disk · up Xd` (green/amber/red)
  2. **Attention (2-col)** — alerts 4h ล่าสุดที่มี `rule_name` + snapshot thumbnail / Offline cameras พร้อม duration (`last_seen_at`)
  3. **Activity 24H** — bar chart events/hour + Today vs Yesterday KPIs (`Events +12% ↑ · Alerts −34% ↓`)
  4. **Site Map** (ขนาดเล็ก + heatmap) + **Top Hotspots** (top 5 cameras)
  5. **Footer** — `version · uptime · snap count · clip count · backup status`

  **ตัดออก:** Traffic KPI, People KPI, Live Events feed 8 รายการ (→ Events page), Donut Event Breakdown (→ Stats page)

  **Technical changes:**
  - เปลี่ยนเป็น **default page** (ย้าย `active` class จาก `#page-cameras` → `#page-summary`)
  - เลิก `--es-*` token namespace → ใช้ main tokens (`--panel`, `--accent`, etc.)
  - เปลี่ยน fonts: ลบ `'JetBrains Mono'` / `'Sarabun'` → ใช้ `'Noto Sans Thai'` + `monospace` system fallback
  - Attention list: ใช้ `recent_events` filter `rule_name IS NOT NULL` + 4h window (ไม่ต้องรอ `acknowledged` column — Phase 2 ค่อยเพิ่ม)
  - API `/api/stats/executive-summary`: ไม่ต้องแก้ (ข้อมูลครบแล้ว — frontend แค่ไม่ render Traffic/People)

  **Phase 2 (optional, หลัง pilot):** เพิ่ม `acknowledged BOOLEAN` ใน `events` table → Attention list กรองเฉพาะ unacked; ปุ่ม Acknowledge (admin only)

### ~~Camera Pause / Maintenance Mode~~ ✅ done 2026-06-02
- [x] **Camera Pause (per-camera maintenance flag)**
  **Use case:** ย้าย Server / กล้องไป Maintenance โดยไม่ต้องการให้ระบบ connect หรือแจ้งเตือน offline
  **Scope ที่ตัดสินใจแล้ว (2026-06-02):** per-camera เท่านั้น (ไม่ทำ group-level); resume = manual เท่านั้น (ไม่มี auto-expire)

  **แผนการ implement (จาก Advisor review):**

  **1. Storage — dual-write เหมือน credential pattern**
  - `cameras.paused BOOLEAN DEFAULT FALSE` — migration 037 (idempotent)
  - `cameras-config.json` เพิ่ม `"paused": false` ต่อกล้อง (ingesters อ่านจาก config file, GOTCHAS #69)
  - API `PATCH /api/cameras/:id/pause` → toggle + write ทั้ง 2 ที่พร้อมกัน

  **2. Skip ทั้ง 5 จุด (ต้องครบ ขาดจุดใดจุดหนึ่ง feature พัง)**

  | จุด | ไฟล์ | งานที่ต้องทำ |
  |---|---|---|
  | Bosch MQTT | `mqtt-subscriber.js:processMessage` | early-return ถ้า `cameraMap[id].paused`; skip `touchCamera` ด้วย (ไม่อัป last_seen → Watchdog เห็นเป็น stale แต่ก็ skip paused) |
  | Hikvision poll | `hikvision-isapi.js` | skip camera ใน poll loop ถ้า `paused` |
  | Dahua poll | `dahua-cgi.js` | skip camera ใน poll loop ถ้า `paused` |
  | Watchdog | `api-server.js:6334` | `if (cam.paused) continue;` ก่อน transition check — ไม่ mark offline, ไม่ยิง LINE alert |
  | Status query | `api-server.js:1292+1309` | paused beats online/offline: `if (paused) status = 'paused'` ก่อน heartbeat check |

  **⚠️ กับดักสำคัญ:** `cameras.enabled` ≠ user toggle — Watchdog เขียนทับ `enabled` ทุก cycle (api-server.js:6334); **ห้ามใช้ `enabled=false` เป็น PAUSE** หรือ Watchdog จะ fight กลับ

  **3. Snapshot endpoint**
  - `/api/snapshot/live/:id` → ถ้า paused return `{paused:true, status:503}` ทันที แทน 502 failed fetch

  **4. Uptime % — exclude paused span**
  - log `'paused'` / `'resumed'` ลง `camera_status_log` เหมือน online/offline
  - uptime query (`api-server.js:5778`) — exclude ช่วงที่ status = 'paused' จาก denominator ไม่ให้นับเป็น downtime

  **5. UI**
  - ปุ่ม PAUSE ใน camera list (SVG pause icon — ไม่ใช่ emoji per CLAUDE.md #16; เพิ่ม `icon-pause` ใน sprite ถ้ายังไม่มี)
  - Badge: สีเทา `--text-secondary` / `--surface-elevated` ข้อความ "PAUSE"
  - Camera status page: หน้าจอมืด + overlay "อยู่ระหว่างการบำรุงรักษา" แทน live feed
  - i18n th+en ครบ (GOTCHAS #42)
  - responsive ≤768px (WA#2-B)
  **Implemented (commits `cefdab8`+):** migration 037 `cameras.paused`, PATCH endpoint dual-write,
  5 skip touch-points, `camera_status_log` constraint extended, `badge-paused` + `icon-pause` SVG,
  dark-screen overlay, `cam.maintenance` i18n. Bugs fixed post-ship: GOTCHAS #75 (media-recorder
  decrypt), #76 (offline-camera unpause churn via `RETURNING enabled` atomic gate).

### Service Management UI (PM2-gated — Start/Stop/Restart per service)
- [x] ~~**Phase 1: PM2 setup**~~ — done 2026-06-03 (DECISIONS #198)
  - ✅ `ecosystem.config.js` สร้างแล้ว (root; 7 apps; cwd:src/; autorestart; min_uptime:10s)
  - ✅ `scripts/services.sh` ปรับเป็น PM2 thin-wrapper (start/stop/restart/status/logs)
  - ✅ Live cutover เสร็จ: PM2 v7.0.1 installed; 7/7 online (incl. alert-worker, report-worker 2026-06-06); `pm2 save` done; ↺=0 ทุกตัว
  - ✅ `pm2 startup` — `pm2.dojojin.plist` installed ใน `~/Library/LaunchAgents/`; autostart on boot

- [x] ~~**Phase 2: Service Management UI**~~ — done 2026-06-03 (DECISIONS #199)
  - ✅ Health Check page → card "Service Management" — PM2 status badge + uptime + ↺ restarts
  - ✅ Restart/Stop/Start per-service; api-server = Restart-only (Stop/Start = self-destruction guard)
  - ✅ admin-only (CSS + server-side `requireAdmin`); audit_log ทุก attempt
  - ✅ `execFile` array args (ป้องกัน injection); server-side allowlist enum
  - ✅ api-server restart → reconnect banner + poll recovery 30s
  - ✅ PostgreSQL/EMQX/cloudflared: ออกนอก scope (self-heal via `restart:unless-stopped`; docker socket = root-eq)
  - ✅ Browser verify passed: Health card renders, Restart hikvision OK, audit_log row confirmed, responsive ≤768px OK

- [x] **Follow-ups / gaps (พบ 2026-06-20):** — ✅ Q1 + Q4 ปิดครบ
  - [x] ~~**Stop ไม่โผล่ตอน crash-loop** (Q1)~~ — ✅ **DONE** (commit `ec90931`, 2026-06-26, ตรวจโค้ดยืนยัน 2026-07-03): `page-health.js:62` `canStop = name!=='api-server' && status!=='stopped'` — ครอบทุก non-stopped status (errored/waiting restart/launching/online) แล้ว, ไม่ใช่ allowlist เฉพาะ online/launching แบบเดิม
  - [x] ~~**alert-worker / report-worker Stop เด้ง 400** (Q4)~~ — ✅ **DONE** (verify 2026-06-26): `health.js:20` `_SVC_NAMES` = {api-server, mqtt-subscriber, media-recorder, hikvision, dahua, **alert-worker, report-worker, lpr-receiver**} — allowlist sync ครบแล้ว, backend ไม่ reject 400 อีก
  - **Q3 (ยืนยัน by-design, no action):** api-server stop/start ถูกห้ามไว้ (`health.js:312`) เพราะ stop = brick UI เอง — ถูกต้องแล้ว (ตอกย้ำเหตุผล IM7 ต้องแยก receiver)

### Performance & Sustainability Optimization (audit 2026-06-06)

> ตรวจสอบจาก `pg_stat_user_tables`, pool config จริง, และ file analysis — ทุก item มี Fact รองรับ

**Performance — ลำดับ impact สูง → ต่ำ**

- [x] ~~**P1 — ตั้ง `max:` บน pg Pool ทุก worker**~~ — **DONE 2026-06-06** (commit `3be5bbb`)
  - api-server: `max:15`; alert-worker: `max:3`; report-worker: `max:3`; media-recorder: `max:2`; mqtt-subscriber: `max:5`; hikvision-isapi: `max:3`; dahua-cgi: `max:3` → รวม **34 connections**
  - `application_name` ครบทุก 7 worker — ระบุตัวเองใน `pg_stat_activity`
  - `max_connections=100`; headroom **~63** connections (หลัง superuser reserve 3)

- [x] ~~**P2 — Cache `system_settings` ใน api-server**~~ — **DONE 2026-06-13** (commit `a8f4304`)
  - สร้าง `src/helpers/getSystemSetting.js` — Map cache TTL 60s, 3 exports: `getSystemSetting`, `getSystemSettings` (multi-key single query), `invalidateSystemSetting`
  - migrate 13 call sites ใน api-server.js จาก raw `pool.query` → helper; เพิ่ม `invalidateSystemSetting()` ทุก write path (4 จุด)
  - ลด seq_scans บน `system_settings` ได้ ~80%; fork-mode single-instance → ไม่ต้องใช้ Redis/pg_notify cross-process

- [x] ~~**P3 — Drop `idx_events_raw_gin` (GIN, 0 scans)**~~ — **DONE 2026-06-06** (commit `9df3731`, migration 039)
  - `idx_events_raw_gin` ลบแล้ว ✓; ไม่มี endpoint JSONB full-text search
- [x] ~~**P3b — Drop `idx_events_type_trgm` (trigram, 1 scan)**~~ — **DONE 2026-06-06** (migration 040)
  - idx_scan=1 ตลอดชีวิต; `LIKE '%Recognition%'` (LPR tab) คืน 0 rows — ไม่มี LPR events ใน dataset
  - partition migration (`MANUAL_partition_events_option_a.sql`) recreates index บน `events_new` อัตโนมัติ

- [x] ~~**P4 — Puppeteer render queue**~~ — **DONE 2026-06-06** (commit `71c9392`)
  - `_renderTail` promise-chain mutex ใน `report-renderer.js:162` — serialize renders 1 at a time
  - `_withPage()` await ticket ก่อนรัน, `release()` เมื่อ page closed (ป้องกัน concurrent render race)

**Sustainability — medium/long term**

- [x] **S1 — Test harness (node:test runner)** ⭐ *ความเสี่ยงสูงที่สุด* — **DONE 2026-06-06** (commit `778b114`)
  - 43 tests ใน 4 ไฟล์: `color-utils`, `crypto-creds`, `helpers/routeError`, `alert-engine` (matchRule + isInCooldown)
  - Zero devDependency: ใช้ `node:test` + `node:assert/strict` ที่ built-in ใน Node 22
  - ทุก test value ยืนยันจาก live DB / source code จริง ไม่ใช้ magic number

- [ ] **S2 — `events` table partitioning** *(แผน+script DONE commit `b8f6557`; migration รอ trigger ~500K rows)*
  - **สถานะปัจจุบัน (2026-06-06):** 63,102 rows (~53K พ.ค. / ~10K มิ.ย.), 42 MB (`pg_total_relation_size`: heap 27 MB + 8 indexes) — ยังปลอดภัย
  - **Growth rate:** ~50K rows/เดือน (ปัจจุบัน); 1.8M rows/year ที่ 100 cameras
  - **Trigger point:** วางแผนรัน migration ก่อน table ถึง **~500K rows** (~9 เดือนที่ rate ปัจจุบัน) — ไม่เร่งด่วน แต่ต้องออกแบบไว้ก่อนถึง

  **🔵 Fact — blockers ที่ verify จากจริง PG 16.13 (rolled-back transactions, 2026-06-06):**

  1. **Composite PK บังคับ** — `PARTITION BY RANGE(event_time)` ทำให้ PK ต้องรวม partition key:
     ```
     ERROR: unique constraint on partitioned table must include all partitioning columns
     DETAIL: PRIMARY KEY constraint on table "_test_events" lacks column "event_time"
     ```
     → PK จะต้องเปลี่ยนเป็น `PRIMARY KEY (id, event_time)`

  2. **FK บน `id` อย่างเดียว reject** — หลัง PK กลายเป็น composite, FK ที่อ้างแค่ `id` ล้มเลว:
     ```
     ERROR: there is no unique constraint matching given keys for referenced table "_pe"
     ```
     → ผลกระทบกับ:
     - `appearances.event_id BIGINT REFERENCES events(id) ON DELETE CASCADE`
     - `license_plates.event_id BIGINT REFERENCES events(id) ON DELETE CASCADE`

  3. **Retention cascade dependency** — `api-server.js:6155` ใช้ `ON DELETE CASCADE` เพื่อ clean `appearances` และ `license_plates` อัตโนมัติ; ถ้า FK หลุด retention จะต้องแก้ด้วย

  **🟡 Opinion — สองตัวเลือก:**

  **Option A — Drop FK ชั่วคราว แล้ว partition `events` อย่างเดียว**
  - Drop FK บน appearances + license_plates
  - แปลง events เป็น partitioned table (pg_partman หรือ manual monthly partitions)
  - Retention ต้องเพิ่ม explicit `DELETE FROM appearances WHERE event_id = ANY(deleted_ids)` แทน cascade
  - ✅ ทำได้ใน 1 migration file; ✅ appearances/license_plates ยังเป็น plain heap
  - ⚠️ สูญ referential integrity; ⚠️ retention code ต้องแก้ด้วย (2 DELETE ก่อน 1 event DELETE)

  **Option B — เก็บ FK ไว้โดยเพิ่ม `event_time` ใน child tables (ไม่ต้อง partition children)**
  - เพิ่มคอลัมน์ `event_time` ใน appearances + license_plates (denormalize)
  - เปลี่ยน FK เป็น composite: `FOREIGN KEY (event_id, event_time) REFERENCES events(id, event_time)`
  - PG 12+ รองรับ FK จาก plain heap table → partitioned parent โดยตรง — ไม่จำเป็นต้อง partition children ด้วย
  - ✅ referential integrity ยังครบ; ✅ `ON DELETE CASCADE` ยังทำงาน; ✅ retention code ไม่ต้องแก้
  - ⚠️ INSERT appearances/license_plates ต้องส่ง event_time ด้วยทุกครั้ง; ⚠️ migration ใหญ่กว่า Option A

  **คำแนะนำ:** เริ่มด้วย Option A — appearances + license_plates ยังเล็ก (FK drop = safe); แก้ retention code ไม่ซับซ้อน; Option B เหมาะเมื่อ appearances โตถึงระดับที่ต้องการ partition scan เองด้วย

  **Migration script พร้อมแล้ว:** `db/MANUAL_partition_events_option_a.sql` (Option A, MANUAL_ prefix — ไม่ auto-run; commit `b8f6557`)

  **ขั้นตอนจริงเมื่อถึง trigger point:**
  1. **PostgreSQL ไม่มี in-place `ALTER TABLE ... PARTITION BY`** — ต้อง:
     - สร้าง `events_new` เป็น partitioned parent (+ monthly child partitions)
     - Copy rows: `INSERT INTO events_new SELECT * FROM events`
     - Swap: rename `events` → `events_old`, rename `events_new` → `events`
     - Drop `events_old` หลังยืนยัน — นี่คือ data migration ไม่ใช่แค่ DDL
  2. ~~ถ้าเลือก Option A: แก้ `src/api-server.js` retention ให้ explicit delete appearances/license_plates ก่อน event delete~~ — **✅ แก้แล้วใน commit `b8f6557`** (`enforceRetention()` explicit-deletes appearances + license_plates ก่อน events แล้ว)
  3. ถ้าเลือก Option B: เพิ่ม `event_time` column ใน appearances + license_plates + เปลี่ยน FK เป็น composite
  4. ทดสอบ retention flow บน staging + ตรวจ row count ก่อน/หลัง swap
  5. **ห้ามรัน migration นี้โดยไม่ `pg_dump` ก่อน** — copy-and-swap window = ความเสี่ยงสูงสุด

- [x] **S3 — Worker /health HTTP endpoints** — **DONE 2026-06-06** (commit `c7e306f`)
  - alert-worker: `GET /health` บน port 3002 (loopback) — ok, uptime, pid, memory, db.latency, listener.connected
  - report-worker: `GET /health` บน port 3001 — ok, uptime, pid, memory, db.latency, scheduler.last_check_at
  - api-server: `/api/health/details` aggregate workers จากทั้งสอง port แล้ว

- [x] **S4 — Route split (MAINT-2T-001)** — **✅ COMPLETE 2026-06-14** (19/19 ไฟล์, faces 2 routes hold รอ FR module)
  - api-server.js peak 7,156 ลบ. → **1,893 ลบ.** (−5,263 ลบ., −73%)
  - ดูรายละเอียดครบใน CHANGELOG.md รายการ 2026-06-14

- [x] **S5 — dashboard.js split (MAINT-FE-001)** — **✅ FULLY COMPLETE 2026-06-15** (19 page files)
  - dashboard.js peak ~10,500 ลบ. → **1,379 ลบ.** (−9,121 ลบ., −87%)
  - `dashboard/page-appearance.js` (618 ลบ.) — `dd35f68`
  - `dashboard/page-reports.js` (770 ลบ.) — `236ef27`
  - `dashboard/page-alerts.js` (693 ลบ.) — `1d98f3c`
  - `dashboard/page-stats.js` (1,483 ลบ.) — `43da0f7`
  - `dashboard/page-map.js` (770 ลบ.) — `92baf8a`
  - `dashboard/page-events.js` (289 ลบ.) — `27ef402`
  - `dashboard/page-cameras.js` (756 ลบ.) — `bb3bacd`
  - `dashboard/page-camera-settings.js` (1,066 ลบ.) — `7254960`
  - `dashboard/page-face-gallery.js` (233 ลบ.) — `8bf203b`
  - `dashboard/page-snapshots.js` (479 ลบ.) — `ba91e89`
  - `dashboard/page-media.js` (164 ลบ.) — `3249116`
  - `dashboard/page-map-settings.js` (357 ลบ.) — `a1d61b3`
  - `dashboard/page-branding.js` (81 ลบ.) — `298b34f`
  - `dashboard/page-user-mgmt.js` (398 ลบ.) — `298b34f`
  - `dashboard/page-categories.js` (303 ลบ.) — `cbf1698`
  - `dashboard/page-system.js` (218 ลบ.) — `a7b7951`
  - `dashboard/page-health.js` (257 ลบ.) — `3324210`
  - `dashboard/page-executive-summary.js` (486 ลบ.) — `b7bbedf`
  - `dashboard/page-nav-bindings.js` (473 ลบ.) — `e90877e`
  - dashboard.js ที่เหลือ = core globals + pagination + WS + group mgmt + bootstrapApp

---

### Nice-to-have
- [ ] **UI design-system migration (opportunistic)** — `DESIGN.md` ปักธงไว้ว่า dashboard เดิม hardcode CSS + ใช้ emoji เป็น UI แพร่หลาย (sidebar/sub-tabs/buttons). ทยอยแทนด้วย design tokens + SVG icon sprite **เฉพาะตอนแตะจุดนั้น** — ห้าม big-bang sweep. ตัวเลือกแยก (deferred, decision #142): full palette re-theme / visual overhaul เป็นงานก้อนใหญ่ของมันเอง ทำเมื่อ design tokens เสถียรแล้ว
- [ ] PostgreSQL connection pool tuning for >1000 cameras — ดู P1/S2 ใน Performance & Sustainability section ด้านบน
- [x] ~~Backup automation (currently manual `pg_dump`)~~ — done in Phase 6.1.10 (daily launchd → `backups/*.dump`, 14-day retention)
- [ ] Off-host backup copy (rclone → R2/B2) — deferred; set up per customer deployment
- [ ] Alert escalation (if not acknowledged in N minutes → escalate)
- [ ] Webhook output (HTTP POST to customer's system in addition to LINE)
- [ ] **Face Recognition** — InsightFace server-side Python microservice + pgvector; plan + schema อยู่ใน [`docs/REF_face-recognition.md`](docs/REF_face-recognition.md); dev เริ่มบน Mac ได้เลย (CPU/MPS); migrate NVIDIA GPU = เปลี่ยน env var เดียว
- [x] ~~**Camera grouping → maps filter (Option B: multi-group color overlay)**~~ — done 2026-05-28 (commits `e37ef58` `a06b33f`). Legend panel overlay (top-left; horizontal wrap ≤768px), group-color stroke on markers + clusters, `hiddenGroupIds` toggle → clear+repopulate via `refreshMap()`, stats bar + heatmap filter to visible groups only, ungrouped cameras always shown. decision #155 · [docs/LOGIC_map-features.md § B](docs/LOGIC_map-features.md)
- [x] ~~**Live Pulse — Toast-on-map (T2: toggle + per-camera debounce)**~~ — done 2026-05-28 (commit `c118ea4`). Per-camera debounce 15s default (5/15/30/60s picker), bump mode "+N more", max 6 concurrent cards (evict oldest), card flip below marker when near top 20% viewport, fade 5s, snapshot thumbnail `?w=80`, `localStorage` persist, clear on page leave. decision #156 · [docs/LOGIC_map-features.md § C](docs/LOGIC_map-features.md)
- [x] ~~**Wall Mode toggle — full-screen video wall display**~~ — done 2026-05-28 (commit `d0049b6`).
- [x] ~~**FIT button — recenter map to visible cameras**~~ — done 2026-05-28 (commit `cdf427c`). `recenterMap()` fits view to `_camRawSrc.getExtent()` (visible cameras only per `hiddenGroupIds`). SVG crosshair button ใน map toolbar. CSS class `body.map-wall-mode` ซ่อน sidebar/topbar ขยาย map 100vh, WALL/EXIT WALL buttons, Fullscreen API, `localStorage` persist. decision #161 · [docs/LOGIC_map-features.md § I](docs/LOGIC_map-features.md)
- [ ] Audit Log CSV export — filter-aware export for user/camera/action audit rows
- [x] ~~**Convert "ดาวน์โหลด PDF" — html2canvas+jsPDF cleanup**~~ — done commit `2d9ba48`; CDN scripts removed from index.html.

---

## 🏢 Strategic direction — Multi-Site (Edge ↔ Cloud)  [PLAN 2026-06-22]

> ลูกค้าหลาย Site (BMA / ภูเก็ต / Main · **200 กล้อง/site = ตัวเลขเผื่อ** ไม่ใช่ของจริงช่วงแรก) อยู่คนละ network →
> กระจาย ingest ไป **edge แต่ละ site**, รวม dashboard/DB ที่ **cloud**.
> **ออกแบบเต็ม (13 section · diagram + cost + install runbook + POC):** `public/others/demo/multi-site/index.html` (commit `05f048e`)
> **DB/app-tenancy plan:** `docs/superpowers/specs/2026-06-21-camera-status-multisite-design.md` (MS-1..MS-8 — gate R5)
> เกี่ยวข้อง: IM3-R (cross-site push) · RF5 (`lpr_direction`) · camera-status demo (`public/others/demo/site/`)

**สถาปัตยกรรม (decisions ที่ตกผลึก):**
- **Central = Bangmod.Cloud 3 VMs** — `vigil-edge-01` (Public IP + WireGuard + nginx = gateway) · `vigil-core-01` (Node api + EMQX + Rule) · `vigil-db-01` (PG16 + **RLS**). OPEX ~5,517฿/ด (VM+Storage จากภาพ; ยังไม่รวม Dev Tools). Public IP **ฟรีในแพ็กเกจ** (Bangmod confirm). ⚠ `vigil-edge-01` (cloud gw) ≠ Site Edge (N150)
- **Transport = WireGuard** (site edge dial-out → Public IP ของ vigil-edge-01) → **ไม่ต้อง tunnel บน cloud**. core/db = private net. firewall edge-01: `51820/udp` + `443` + SSH จำกัด
- **Site Edge = N150** (4C/16GB/512GB) **dual-NIC**: onboard=กล้อง (isolated) · USB=WAN+WireGuard (WAN ฝั่ง USB ปลอดภัยเพราะ ANR buffer). `edge.config.json` toggle ingester **ต่อ vendor + capability** (Hik Smart/Face/ANPR แยก). **nanoMQ รันเฉพาะมี Bosch**
- **Transfer mode ต่อ type:** LPR=metadata-only (plaque เรนเดอร์จาก text) · Face=thumbnail · full-res เก็บที่ edge, pull on-demand. on-site ดูรูป local ผ่าน **Caddy** (`bma/phuket.dojojin.tech` → LAN IP + wildcard cert; **media local · data ยังผ่าน cloud**). **ANR** = store-and-forward (ลิงก์ล่ม→buffer→backfill)
- **Config flow: central → edge (pull ผ่าน WireGuard)** — central UI → central DB (+`site_id`) → edge pull → `cameras-config.json` → `fs.watch` hot-reload. *config ลง · event ขึ้น · WireGuard เส้นเดียว*. reuse `page-camera-settings.js` + `cameras-config.json`

**Rollout (Phase 0 POC → Phase 1 Deploy):**
- **Phase 0 POC บน macOS** (central หลัง NAT → **Cloudflare Tunnel/Tailscale · ยังไม่ใช้ WireGuard** · `bma.dojojin.tech` ผ่าน `/etc/hosts` + Caddy `tls internal`): 0a same-LAN (กล้องไม่กี่ตัว) → 0b remote → 0c ready · งบ $0
- **Phase 1 Deploy Bangmod.Cloud** (WireGuard + Public IP) = **re-point edge endpoint** (Mac → vigil-edge-01); software edge เดิม

**DB prep:**
- **Tier 1** ✅ DONE 2026-06-21 (migrations 052–056, 062–063): `sites` table + `cameras.site_id` FK + `user_sites` + `cameras.cam_role` + `cameras.lpr_direction` — applied; backfill VSS (migration 055). ปลดล็อก camera-status + RF5. `/api/cameras` scoped by user_sites (fail-open: 0 rows = ทุก site).
- **Tier 2** ❌ pending: **RLS policy** + ขยาย `users.role` (เดิม CHECK admin/viewer/auditor). **⚠️ เหตุผล defer เดิมเป็นเท็จแล้ว (แก้ 2026-07-05)** — เคยเขียนว่า "กล้องทุกตัวอยู่ main site 100% ปัจจุบัน" แต่เช็ค DB จริงพบ **main=11 + vss=6 กล้อง (2 site จริงแล้ว)** และมี user scoped จริง 3 คน (`vss`/`phuket`/`service`) ที่พึ่ง `siteWhere()` (`src/auth.js`) เป็นกำแพงกั้นชั้นเดียว — ไม่มี DB-level enforcement เลย (`pg_tables.rowsecurity` = 0 ทุกตาราง, ยืนยัน 2026-07-05). ความเสี่ยง = route ใหม่ในอนาคตที่ลืมเรียก `siteWhere()` จะรั่วข้าม site ทันทีไม่มีเซฟตี้เน็ต. **ทำไมยังไม่ทำ (เหตุผลทางเทคนิคจริง ไม่ใช่ผัดวันประกันพรุ่ง):** (1) RLS ต้องมีกลไกบอก DB ว่า request เป็นของ site ไหนต่อ query (`SET LOCAL` ต้น transaction) แต่ระบบใช้ connection pool เดียว/role เดียวทุก request — ต้องรื้อ connection handling; (2) `users.role` CHECK ต้องขยายให้ DB role แยกได้ (admin/auditor ต้อง `BYPASSRLS`); (3) ต้องเขียน policy ครบทุกตารางที่มี `camera_id`/`site_id` — เสี่ยง silently หัก query ที่ไม่คาดคิดถ้าพลาด. จัดอยู่กลุ่ม "Security & auth" ใน Model Assignment (CLAUDE.md) — ต้องวางแผนละเอียด ไม่ใช่ retrofit เร็วๆ.

**Cost buckets (แยก 3 ก้อน):** OPEX cloud (Bangmod รายเดือน) · CAPEX edge (N150 ×2 site ครั้งเดียว · 🟡 ราคา probe จริง) · Internet line ราย-site (True capped 100GB / Fiber). **30Mbps พอ · กำแพงคือ quota** (LPR-heavy → Fiber; metadata-only ช่วยให้ capped พอ)

**Open decisions (gate ก่อน MS-1):**
1. **Staging fork** *(กำหนด scope migration ทั้งหมด)*: single-site interim (cam_role ก่อน) vs full multi-site
2. App-layer บน WireGuard: HTTP forwarder (A, แนะนำ) vs MQTT bridge → EMQX (B)
3. `site_id`+RLS vs `site` free-text (IM5) — แทนที่/อยู่ร่วม? · camera creds key mgmt (AES `CAMERA_SECRET_KEY`)
4. Public ingress: Cloudflare หน้า dashboard (CDN/DDoS) หรือ nginx+Public IP ตรง

> **Docs governance:** `vigil-docs-v2` + `dev-docs` **ยังไม่ต้อง update** — ทั้งคู่อธิบาย "ของที่ ship แล้ว"; plan นี้ยังไม่ implement. trigger ตอน ship จริง: `04-components.html`/`12-scale-up.html` (vigil-docs-v2) · `index.html`/`restart-services.html` (dev-docs) เมื่อมี edge module/PM2 worker/RBAC role จริง

---

## 🌐 Strategic direction — Multi-vendor (Hikvision / Dahua / generic ONVIF)

> **STATUS UPDATE 2026-05-20 — STARTED.** A real Hikvision camera arrived
> on the LAN (the "signal" the section below said to wait for), so an
> MVP shipped: `src/ingesters/hikvision-isapi.js` ingests Hikvision Smart
> Events via the ISAPI Alert Stream — see decision #114 + "Multi-vendor —
> Hikvision ISAPI ingester" under Completed Features. The text below is
> kept as the original strategy/rationale; note the phase order was
> reordered (Hikvision shipped before generic ONVIF) because that's the
> hardware in hand. Generic ONVIF is still the right broader-ROI next
> step (Phase MV.2).

**Decision discussed 2026-05-16.** Two paths were
considered when looking at expanding beyond Bosch:

**Path A (rejected for now): Deep Bosch — replace Bosch Configuration Manager**
Build our own RCP+ / IVA-XML editor inside the dashboard so customers don't
need to install Bosch CM. Estimated 6-10 weeks; the IVA rule editor alone is
~3-6 weeks of canvas-drawing UI work. Skipped because (a) Bosch CM already
works, customers tolerate it, and (b) the value proposition is narrower
than going multi-vendor.

**Path B (chosen direction): Broad — support multiple camera vendors via a
plugin architecture, leveraging common standards instead of going deep on
any one vendor.**

### Why this is the right bet

- Thai market: Hikvision + Dahua dwarf Bosch in unit count. Today the
  dashboard literally cannot sell into those sites.
- ONVIF Profile M is implemented by Bosch, Axis, newer Hikvision, Vivotek,
  Uniview, TIANDY — one generic ingester covers ~70-80% of cameras in
  one go.
- Vendor-specific HTTP Alarm Push (Hikvision ISAPI, Dahua CGI) handles
  older firmware that has ONVIF S/T but not M.
- Reduces Bosch lock-in: if Bosch changes the MQTT spec, the dashboard
  doesn't break — just the Bosch plugin needs touching.

### Target architecture (plugin pattern)

```
src/ingesters/
  bosch-mqtt.js          ← refactor of current mqtt-subscriber.js logic
  onvif-pullpoint.js     ← new: WS-Notification / PullPoint subscription
  hikvision-alarm.js     ← new: HTTP listener for ISAPI alarm POST
  dahua-alarm.js         ← new: HTTP listener for Dahua alarm POST

Common normalized event shape (matches today's `events` row):
  { camera_id, vendor, event_time, event_type, rule_name,
    object_class, event_state, snapshot, raw_json }
```

- `cameras-config.json` adds `vendor: 'bosch' | 'onvif' | 'hikvision' | 'dahua'`
- Ingesters are auto-loaded based on the union of vendors in config
- `events` table: a new `vendor` column is nice-to-have but optional;
  raw_json can carry vendor-specific fields without schema change
- alert-engine, LINE sender, stats, reports, dashboard UI: **unchanged**
- Snapshot logic in api-server's `/api/snapshot/live/:id` switches on
  vendor for the right HTTP path / auth scheme

### Phased plan (~6-8 weeks total when triggered)

1. **Phase 1 (2-3 weeks) — Generic ONVIF Profile M ingester.** Pull-point
   subscription, vendor-agnostic event metadata, snapshot via ONVIF
   MediaUri. Best ROI: one implementation covers many vendors.
2. **Phase 2 (1-2 weeks) — Hikvision HTTP Alarm Push.** Open an inbound
   HTTP endpoint the camera POSTs to, parse Hikvision's XML/JSON, and
   integrate ISAPI for snapshot + basic config.
3. **Phase 3 (1-2 weeks) — Dahua HTTP Alarm Push + CGI.** Mirror of
   Phase 2 for Dahua's protocol.
4. **Phase 4 (1 week) — Refactor Bosch MQTT into a plugin.** Existing
   subscriber code moves into `ingesters/bosch-mqtt.js` behind the
   common interface; everything else stays put.

### Do NOT start yet — wait for a real signal

This work only makes sense when there's market pull. Defer until at
least one of:

- A customer pipeline deal explicitly requires Hikvision / Dahua support.
- A pilot customer flags "we have mixed-vendor sites" as a blocker.
- Bosch announces a pricing change that lowers Bosch's share of pipeline.

Higher-priority items that should land first:
- License key system (blocker for actual selling)
- PM2 production setup (operational must-have)
- At least 2-3 real customer pilots (real data > theoretical roadmap)

### Pre-work that can happen anytime (low effort, high payoff later)

- Add a `vendor` column / field to `cameras-config.json` (default `'bosch'`)
  so existing data is forward-compatible.
- When refactoring `mqtt-subscriber.js` for anything else, take the
  opportunity to extract the Bosch-specific bits behind a single
  `processBoschEvent(payload)` function — that's most of Phase 4
  pre-built for free.
- Source the **RCP+ Programmer's Manual** (Bosch partner NDA) and the
  **Hikvision ISAPI doc** (public) into a `docs/vendor-protocols/`
  folder so they're ready when work starts.

---

## 🔐 Strategic direction — License system + source-code protection

**Status update 2026-05-19:** License system (the "trust the JWT"
half) is **✅ DONE** — Phase 8.0 + 8.1 shipped on this date; see
decisions #100–#108 and the "Phase 8 — License MVP + EULA"
section under Completed Features. The text below stays here as
historical context for the decisions made; the open item is now just
**source-code protection** (obfuscation + binary bundling), which is
deliberately deferred until after the first 1–2 customer pilots so the
binary build pipeline is shaped by real ops feedback.

### Threat model (be honest about scope)

- ❌ "Lock 100%" is impossible for any self-hosted JavaScript app — the
  customer is root on their own server.
- ✅ "Raise the bar" — make stealing the code more expensive than buying
  a license, and lean on legal recourse for the rest.

Threats addressed:
- **Casual copy** (engineer takes the codebase home) → obfuscation + binary
- **Customer non-renewal** (MA expires, customer keeps running) → license expiry + grace + legal
- **Customer-to-customer sharing** → license machine binding (Phase 2)
- **Competitor reverse engineering** → only legal recourse + (Phase 3) native critical code
- **Black-hat redistribution** → accepted residual; legal teeth + audit

### License system — chosen design

**Signed JWT, offline-first, Ed25519** (not RSA-2048: tiny keys, fast verify,
no padding gotchas).

```
~/vigil-platform/.license                    ← customer drops this file
                              │
                              ▼
  api-server boot → verify with embedded public key → cache decoded payload
                              │
                              ▼
  Enforcement points:
   - POST /api/cameras → reject if active count >= max_cameras
   - Topbar / Sidebar → show "Licensed to X · Tier · NN days left"
   - Daily job → recompute expiry; trigger warning banner at 30/7 days
   - Past expiry + 7-day grace → read-only mode (no create/edit/delete)
```

License payload (JWT body):
```json
{
  "customer":     "Acme Building",
  "customer_id":  "ACM001",
  "tier":         "STANDARD",
  "max_cameras":  500,
  "features":     ["line_alerts", "scheduled_reports", "reports"],
  "issued_at":    "2026-05-18",
  "expires_at":   "2027-05-18",
  "version":      1
}
```

Crypto choices + tooling:
- **Algorithm**: EdDSA / Ed25519 (32-byte private key, 32-byte public key,
  64-byte signature; fast verify; no padding/mode footguns)
- **Format**: JWT (RFC 7519) — standard, debuggable, future-proof
- **Library**: `jose` npm package (modern, supports Ed25519; not
  `jsonwebtoken` — that library only added EdDSA recently and the API
  is bumpier)
- **Key generation** (one-time, by us):
  ```bash
  openssl genpkey -algorithm ed25519 -out license-private.pem
  openssl pkey -in license-private.pem -pubout -out license-public.pem
  ```
- **Private key storage**: 1Password Business / cloud KMS — NEVER in repo.
  Loss = re-issue every customer license; leak = ALL licenses are forgeable.
- **Public key**: hardcoded constant in api-server.js, ships with the binary.

Per-customer issue flow:
```bash
node scripts/issue-license.js \
  --customer "Acme Building" --customer-id ACM001 \
  --tier STANDARD --max-cameras 500 \
  --expires 2027-05-18 \
  --features line_alerts,scheduled_reports,reports \
  --out licenses-issued/acme.license
# → email file to customer → they place at ~/vigil-platform/.license
```

### License — phased plan

| Phase | Scope | Effort |
|---|---|---|
| **MVP**     | JWT verify, camera-count enforce, topbar badge, issue-license CLI, expiry banner | **3-4 d** |
| **Phase 2** | Grace mode (read-only after expiry+7d), feature gating per tier, renewal flow | +2 d |
| **Phase 3** | Machine fingerprint binding (cpu_id + hostname + mac), online activation, audit log | +3 d |

### Source-code protection — layered approach

| Layer | What | Effort | Effect |
|---|---|---|---|
| 1 — Legal | Strong EULA (anti-reverse clause, penalty figures, "loaned not transferred"), Thai pwl. คอมพิวเตอร์ + Copyright Act + signed contract | 1d + lawyer fee | PRIMARY (legal recourse) |
| 2 — Obfuscation | esbuild + javascript-obfuscator on `src/*.js` + `dashboard/dashboard.js` (mangle names, strip comments, basic dead-code) | 1d setup | Stops casual code reading; ~80% of theft |
| 3 — Single binary | Node SEA (Single Executable App, Node 21+) or `@yao-pkg/pkg` — bundle everything into one opaque executable | 2-3d | Customer never sees `.js` files; ~95% of casual theft |
| 4 — License binding | License pinned to {customer_id, hostname, machine_uuid}; tampering or copying to another machine = invalid | covered by License Phase 2 | Stops customer-to-customer sharing |
| 5 — Native critical code | Rust/C++ Node addon (.node binary) for license verify + critical algorithms | 5-10d | Stops competitor reverse engineering |
| 6 — Server-side core | Move core logic to our cloud → customer becomes thin client | architecture change | NOT recommended (defeats on-premise USP) |

Deliberately NOT recommended:
- Hardware dongles (logistics nightmare, customer experience awful)
- V8 bytecode (`bytenode`) — brittle to V8 version, debug hell, easily reversed
- Heavy string encryption / control-flow obfuscation — hurts performance, not worth

Recommended bundle for v1 launch (pre-customer):
- Layer 1 (legal) — non-negotiable
- Layer 2 (obfuscation) — cheap win
- Layer 3 (binary) — high ROI
- Layer 4 (covered by license Phase 2)

Defer to post-pilot: Layer 5. Don't touch: Layer 6.

### Deployment models — affects protection ceiling

- **(A) "Toss the binary over the fence"** — customer self-installs the binary +
  config + docker-compose. We never SSH in. Maximum customer control but
  customer sees ALL files (still opaque, but they can poke around).
- **(B) "Managed install"** — we SSH in once to install. Files owned by a
  service account the customer doesn't have shell on. Customer admins via the
  web UI only. **(B) is the better protection model** but heavier ops burden.
  Recommend (B) for first 2-3 customers; (A) once we have a polished installer.

### Pre-work that can happen anytime (no commitment to launch)

- Add `licenses-issued/` to `.gitignore` so future issued licenses don't leak.
- Add `*-private.pem` to global `.gitignore` and macOS Time Machine excludes.
- Pick which features will be tier-gated and write a table (no code yet).
- Draft EULA in Thai+English so it's ready when the first customer signs.

---

---

## DB Scale — Deferred Items (2026-06-01)

วิเคราะห์แล้วว่าไม่ควรทำตอนนี้ — บันทึกไว้เพื่อไม่ต้องวิเคราะห์ซ้ำ

### daily_stats pre-aggregation table
**ปัญหาที่แก้:** query กราฟสถิติช่วงยาว (30–90 วัน) ต้องนับแสนถึงล้านแถวใน `events`
แม้มี index → ช้า 1–15s ที่ 73M แถว

**วิธี:** ตาราง `daily_stats(stat_date, camera_id, event_count, ...)` + background job
รันทุกคืน → query กราฟอ่านแค่ 90 แถว (แทน 9M)

**เงื่อนไขที่ควรทำ:**
- stats query ใน dashboard ช้าจนผู้ใช้สังเกตได้จริง (> 2–3s)
- ปริมาณข้อมูลเกิน ~10M events

**เหตุที่ defer:** ตอนนี้มี 57K events + 30s TTL cache ครอบ → ยังไม่มีปัญหาจริง
งานที่ต้องทำ: schema design + background job + query routing + stale-data handling
= effort ไม่คุ้มกับปัญหาที่ยังไม่เกิด

### CREATE INDEX CONCURRENTLY บน production
**ปัญหาที่แก้:** `CREATE INDEX` ปกติ lock ตาราง 5–30 นาทีที่ 73M แถว
→ กล้องส่ง event ไม่ได้ระหว่างสร้าง

**วิธี:** รัน `CREATE INDEX CONCURRENTLY` ด้วยมือ 1 ครั้ง นอก migrate.js
(ทำใน transaction ไม่ได้)

**เงื่อนไขที่ควรทำ:** production table > 10M แถว + ต้องเพิ่ม index ใหม่

**เหตุที่ defer:** dev DB 57K แถว — index build เสร็จใน ms; ไม่ควร automate
หรือใส่ Settings UI (DBA operation ไม่ใช่ operator operation)

**Command เมื่อถึงเวลา:**
```bash
docker exec vigil-postgres psql -U vigil_sql -d vigil_platform -c "
  CREATE INDEX CONCURRENTLY idx_appearances_camera_detected
  ON appearances(camera_id, detected_at DESC);
"
```

### ~~license_plates INSERT silent failure (bug แยก)~~ ✅ done 2026-06-02
**ปัญหา:** `mqtt-subscriber.js` INSERT ใช้ column names ชุดเก่า (`plate_likelihood`,
`country_code`, `vehicle_brand` ฯลฯ) แต่ live DB schema เป็นชุดใหม่ (`confidence`,
`country`, `region`, `bbox_*`) → INSERT ล้มเหลวเงียบทุกครั้งที่มี LPR event

**Fixed (commit `cefdab8`):** align column names + migration 036 เพิ่ม
`vehicle_type/color/brand` สำหรับ multi-vendor ANPR (Hikvision/Dahua/cloud) +
แทน silent catch ด้วย `console.error` + `v_license_plates_public` view ยืนยัน
explicit column list ไม่รั่วข้อมูลใหม่ออก partner (PDPA safe). GOTCHAS #74.

---

## 🔐 Security — Deferred Items (2026-06-01)

> วิเคราะห์แล้วว่าต้องทำแต่ยังไม่ถึงเวลา / ต้องรอข้อมูลเพิ่ม — บันทึกไว้เพื่อไม่ต้องวิเคราะห์ซ้ำ
> Full checklist: `docs/REF_security-checklist.md` (SEC-014–SEC-017)

### ✅ SEC-013 — chmod 600 cameras-config.json
**Done 2026-06-05:** `-rw-------` verified — `cameras-config.json` มี permissions 600 แล้ว; อ่านได้เฉพาะ owner.
ดู DECISIONS #191 · GOTCHAS #69

---

### ✅ SEC-014 — Camera credential at-rest encryption
**Done 2026-06-05:** `src/crypto-creds.js` — AES-256-GCM, `enc:v1:` prefix, key จาก `CAMERA_SECRET_KEY` ใน `src/.env`.
ทุก 4 ingesters ใช้ `decryptCamCreds()` ก่อนสร้าง auth header:
- `mqtt-subscriber.js` (line 33, 57)
- `src/ingesters/hikvision-isapi.js` (line 31, 592)
- `src/ingesters/dahua-cgi.js` (line 53, 1160)
- `src/media-recorder.js` (line 33, 57)
- `api-server.js` (line 188) import `encryptCamCreds` — encrypt on save

**ข้อจำกัดที่รับรู้:** host compromise → attacker ได้ key+ciphertext ทั้งคู่ → Tier 3 (external secret store) ถ้าต้องการป้องกัน host compromise จริง
ดู DECISIONS #192

---

### ✅ SEC-015 — Drop dead columns cameras.http_password + cameras.rtsp_url
**Done 2026-06-02:** migration 038 (`db_migration_038_drop_dead_camera_columns.sql`) — NULL verified (0 rows), dry-run passed, `init.sql` updated.
`cameras.http_user` ยังอยู่ (deferred — dead แต่ไม่ใน scope SEC-015).
ดู DECISIONS #193 · GOTCHAS #70

---

### ✅ SEC-016 — PostgreSQL SSL
**Done 2026-06-02:** `ssl=on` (TLSv1.3) — self-signed cert generated in data volume; zero-downtime
via `ALTER SYSTEM` + `pg_reload_conf()`; `scripts/postgres-ssl-setup.sh` (idempotent, run after fresh volume).
Local apps unbroken. **Remaining:** `hostssl` enforcement in `pg_hba.conf` (scoped to partner subnet)
ต้องทำเมื่อเปิด remote port — ดู `docs/REF_third-party-integration.md` §3.6.
ดู DECISIONS #195

### ✅ SEC-017 — Mapbox token server-side proxy
**Done 2026-06-02:** `GET /api/map/tiles/mapbox/:style/:z/:x/:y.png` proxy (auth-gated, cache-first reusing
`MAP_CACHE_DIR/mapbox/`); `/api/config` returns `mapboxAvailable` only — raw token never sent to browser;
`dashboard.js` builds proxy URLs (not direct Mapbox API); settings form no longer prefills token.
**Alternative considered (not taken):** Mapbox URL restriction in account (zero code, but token still visible to authed users).
ดู DECISIONS #197

---

<sub>End of ROADMAP.md · Companion to CLAUDE.md · Updated 2026-06-26</sub>
