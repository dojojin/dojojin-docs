# GOTCHAS — Vigil Platform

> Companion to [CLAUDE.md](CLAUDE.md). Known issues / quirks / footguns
> to watch for. Each entry comes from a real incident — preserve the
> wording, don't re-discover the same bug.
> See also: [DECISIONS.md](DECISIONS.md) (why things are the way they are).
> Last updated: 2026-09-08 (ล่าสุด #194)

---

## 🚧 Known Issues / Gotchas

1. ~~**Folder name still `vigil-platform/`** — not renamed~~ — ✅ renamed `bosch-mqtt-dashboard` → `vigil-platform` 2026-05-29 (Phase 1–3 complete; rollback dump: `backups/pre-vigil-rename-20260529_124719.dump`)
2. **Safari + Cloudflare Tunnel cookies** — ITP blocks cookies. **MUST keep triple-layer auth.**
3. **`SESSION_SECRET` in `.env`** — if not set, server uses random per restart
4. **PostgreSQL UTC timezone** — enforced in `init.sql`. All `event_time` is TIMESTAMPTZ since 2026-05 migration
5. **`HEADERS_SENT` crash in `/api/snapshot/live`** — fixed via `responseSent` flag
6. **Mosquitto + Bosch camera** — sometimes camera sends events with no `event_time`. Falls back to `received_at`
7. **LibreOffice rendering of Thai in PowerPoint** — Calibri Bold renders thin in LO preview but fine in actual PowerPoint
8. **DOM-id collision for Chart.js refs** — never use `<canvas id="X">` AND a JS variable named `X`. Per-camera bars use `_camChartReg` keyed object instead
9. **Bosch event shape varies per detector** — `LineDetector/Crossed` carries `object_class` but no `state`; `FieldDetector/ObjectsInside` carries `state` but no `object_class`. Mapping rules with `match_state='true'` will MISS LineDetector events. For "anything counts" mappings, set State to `(any)` (NULL)
10. **`MotionAlarm` and `JobState` are filtered before insert** in `mqtt-subscriber.js` (they touch `last_seen` as keepalive but no event row written)
11. **Cache-bust the rules-list GET** — Cloudflare/browser was occasionally serving 304. `loadCategoryRules` appends `?_=Date.now()` and uses `cache: 'no-store'`. Don't remove
12. **`/favicon.ico`** — now serves brand logo from DB (not 204). If you upgrade mid-session, hard-reload (Cmd+Shift+R)
13. **Snapshot retention uses file mtime** — `cp` without `-p` resets mtime to current time → files won't get pruned for 30 days. Use `cp -p` or `rsync -a` when migrating
14. **Health page MQTT freshness** uses `MAX(event_time)` — if camera clock skew is bad (event_time in past), freshness check is wrong. Check camera NTP
15. **Mobile sidebar auto-closes on every showPage()** — if you ever build a multi-step wizard, may need to suppress for mobile UX
16. **PDF reports are rasterized images** — not searchable text. Acceptable tradeoff for Thai font support; Puppeteer alternative deferred
17. **`brand_logo_path` validation** — only allows `[A-Za-z0-9._-]` (no path traversal). If you ever add internationalized filenames, update the regex
18. **Migration files are alphabetically ordered, not chronologically** — `db/db_migration_*.sql` are sorted by filename in the runner. Existing files (alerts, auth, branding…) are unprefixed and sort by name; the bootstrap `db_migration_000_schema_migrations.sql` uses `000_` to guarantee it runs first. **For NEW migrations, prefix with a 3-digit number** (e.g. `db_migration_010_<topic>.sql`) so order is explicit. Idempotency means out-of-order is usually safe, but anything with cross-file FK dependencies will need explicit ordering. **Note — migration `020` is missing** (sequence jumps 019 → 021): no file, no git trace, no doc mention — pure numbering skip from development (benign; runner is filename-sorted + idempotent). The next available number is `031`. Do not create `020` retroactively — it would run BEFORE `021`–`030` on a fresh install and may conflict with already-applied schema.
19. **A failing migration aborts api-server startup (exit 1)** — by design. Don't `try/catch` around it or comment out the failing migration. Restore the latest backup if needed, fix the SQL to handle the live schema's actual shape, then retry. The runner records success only after the file completes; partial state is rolled back via the wrapping transaction
20. **`pg_dump -Fc` archive is NOT plain SQL** — `cat backup.dump` shows binary garbage. Use `pg_restore --list` to inspect TOC, or `pg_restore -f -` to convert to plain SQL on the fly. Always backup BEFORE any migration that touches existing data (the runner doesn't auto-snapshot — the launchd agent does daily, but if you're applying a migration mid-day, run `./scripts/backup.sh` manually first)

21. **`/api/branding` returns the FRIENDLY shape, not raw `brand_*` keys** — `{name, tagline, logo_url, primary_color}` (already with `logo_url` = `/branding/<filename>`). Use those names directly. Reading `branding.brand_name` / `branding.brand_logo_path` returns undefined and the report header logo silently vanishes — this is the bug that took 5 commits to spot during Phase 7.3.

22. **Puppeteer's `networkidle0` doesn't wait for post-`innerHTML` resources** — once the page sets `__reportReady = true`, page.pdf/screenshot fires immediately. If buildReportHtml() injects a `<img>` that loads AFTER the initial network burst, it may not have decoded → blank logo in PDF. Fix: explicitly `await Promise.all([...document.querySelectorAll('img')].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })))` before signalling ready. See report-print.html.

23. **Bosch analytics events can be unbalanced — only `state='false'` halves seen on some types** — e.g. `ImageTooBright` may emit only the "condition ended" event, never "started". The state-dedup that hides `state='false'` then hides everything. Live data observed during Phase 7.1. If a customer enables one of these in Settings and never sees it in the feed, this is the cause — not a code bug. Workaround discussed but not implemented (Option ข — exempt image-quality from dedup).

24. **`active_from` / `active_to` columns hold the QUIET window, not the active window** — naming is historical (the columns were created during the original "active window" interpretation in commit `e5f3039`, then semantics flipped in `f14c8a6` without renaming the columns to avoid a migration). Code reading them: alerts FIRE when `now ∉ [active_from, active_to)`. Don't be fooled by the names. UI labels are correct ("ช่วงเวลาเงียบ").

25. **Puppeteer browser pool is in place (since 2026-05-15), but Health Report PNG must not depend on it** — `report-renderer._getBrowser()` lazy-launches Chromium once per Node process; `_withPage()` opens a fresh page per render. Cold = 1419ms (only the first call after boot or after `disconnected`); warm = ~150ms. **Implication for debugging:** if Chromium crashes mid-session you won't see a "puppeteer started" log on the next render (it reuses the surviving process). Force-relaunch by killing the api-server process. **2026-05-26 update:** Health Report Preview / PNG / LINE image was moved to SVG + `sharp` after Chromium/CDP reproduced a `Runtime.callFunctionOn` timeout and then kept hanging even after the height probe was removed. PDF still uses Puppeteer. Do not put Health PNG preview back on Puppeteer without re-testing the stuck-browser path.

25a. **`sharp` SVG text must avoid emoji unless fallback fonts are verified** — caught 2026-05-26 while replacing Health Report PNG Puppeteer rendering. Local `librsvg/Pango` aborted the Node process with `Could not load fallback font` when SVG `<text>` contained decorative emoji from `HR_LABELS` (`🏥`, camera icons, etc.). `report-renderer._svgSafeText()` strips emoji/symbol ranges for SVG only; the HTML/PDF Health Report labels remain unchanged. If future SVG-based reports add icons, render them as shapes or sanitized text, not emoji glyphs. Formalized as the no-emoji-as-UI rule — Decision #144, DESIGN.md §4/§6.

26. **Machine fingerprint must NOT use MAC address on modern macOS / Linux** — caught Phase 8.0 hotfix 2026-05-19. `awdl0` (Apple's AirDrop interface) randomises MAC on every activation; macOS Big Sur+ "Private Wi-Fi Address" feature does the same to `en0` per-SSID; modern systemd `MACAddressPolicy=random` does it to Linux NICs. Any fingerprint algorithm that picks "the first MAC" will flap on WiFi reconnect / sleep-wake / SSID change. `src/license.js` now prefers `/etc/machine-id` (Linux) or `ioreg IOPlatformUUID` (macOS) and uses MAC only as a fallback when both fail (bare container, BSD, embedded). Even then it skips Apple privacy interfaces and locally-administered MAC addresses. Any future fingerprint-derived feature (license, hardware-bound key, telemetry id) must follow the same rule — see decision #108.

27. **`src/license.js` has a placeholder public key on every fresh dev clone** — until the operator runs `scripts/keygen/setup-keys.sh` and pastes the real Ed25519 public key into `LICENSE_PUBLIC_KEY`. The license middleware detects this via `isPublicKeyConfigured()` and BYPASSES enforcement entirely so the dashboard isn't "locked out of itself" before the operator does setup. Production deployments WILL have a real key — this affects dev only. The `issue-license.js` CLI prints a clear warning when it detects the placeholder.

28. **Don't store the license JWT in a file** — decision was to keep it in `system_settings.license_key` (Postgres). Files-on-disk pattern (legacy `.license`) was considered and rejected: (a) survives `git pull` cleanly, (b) covered by the existing `pg_dump` backup/restore flow, (c) frontend UI activates via API → consistent with how every other setting is edited. If a future ops issue tempts you to "just put it in a file," remember the `.license` file approach also gives the customer a clear target to delete to "reset trial" — which the DB key doesn't.

29. **CSS Grid item default `min-width: auto` resolves to content's min-content — must explicitly set `min-width: 0` when the child has intrinsic-wide content** — caught 2026-05-19 on Reports page mobile fix. A grid item won't shrink below its child's min-content width by default. The Reports page had `.report-preview` as a grid 1fr cell containing a heatmap `<table>` with 24 cells × `min-width:18px = ~432px` intrinsic min-content. Grid honoured that, expanded the cell to 432px even on a 390px iPhone, max-width:100% became "100% of 432px" (no help), and the whole body grew wider than the viewport → iPhone Safari rendered a horizontal page scroll. Fix: `min-width: 0` on the grid item (or `.parent > * { min-width: 0 }` for blanket coverage). When you see "responsive layout looks fine on desktop, horizontal scroll on mobile" + CSS Grid in the chain, this is reflex #1.

30. **Adding a new `@media` mobile override → check source-order against existing global rules + use higher specificity if unsure** — caught same Reports fix. Added `@media (max-width: 640px) { .report-preview { padding: 14px !important; min-height: 240px !important; } }` near the top of `<style>`. There was an existing `@media (max-width: 768px) { .report-preview { padding: 18px !important; min-height: 400px !important; } }` further down. At ≤640px both rules match, both have `!important`, same selector specificity → **source-order tiebreaker → existing rule wins because it's declared later**. Result: my "fix" silently no-op'd and the operator kept seeing the same layout. Going forward, when adding mobile overrides for a page, prefix selectors with the page's ID (`#page-reports .report-preview { ... }`) to bump specificity by one ID and win regardless of source order. The CSS comment in the file should call out WHY the prefix is there so it doesn't get tidied away.

31. **iPhone Safari + page-level horizontal scroll → start with `html, body { overflow-x: hidden }` + `min-width: 0` cascade before chasing specific overflowing elements** — remote-debugging responsive issues on iOS Safari is painful (no Web Inspector unless the phone is tethered). The temptation is to look for "which specific element is too wide" and shrink it; the right reflex is to put defensive containment in place AT EVERY ANCESTOR LEVEL (html, body, .app, .content) AND explicit `width: 100%` + `min-width: 0` on the offending pane's grid items, THEN iterate on surgical fixes from screenshots. Took 5 iterations on the Reports mobile fix because I shrank visible elements (KPI grid, table cells, padding) for 3 rounds without ever clamping the page-level overflow.

32. **`camera_id` can carry invisible characters that destroy MQTT topic matching — sanitise at POST + cross-check at ingest** — 2026-05-19, the operator typed "BOSCH_8000i_01" in the Add Camera form with a Thai keyboard layout active, and ended up with `ฺBOSCH_8000i_01` in `cameras-config.json` (U+0E3A Thai phinthu prepended, invisible to the eye, three bytes in UTF-8). The physical camera broadcast under the clean ASCII id; the dashboard filtered with the dirty id; nothing matched; the operator reported "events ไม่เข้าระบบ" and we spent meaningful time chasing a parser/firmware bug that didn't exist. POST `/api/cameras` now strips ASCII control chars, zero-width chars (U+200B–U+200F + BOM U+FEFF), Thai phinthu (U+0E3A), and Thai tone marks (U+0E48–U+0E4E); returns 409 + warnings[] when sanitisation changes the input. mqtt-subscriber.js's `ensureCamera()` also logs a one-time diagnostic when an MQTT id matches a config id "except for non-printable characters", so the operator can spot future occurrences without DB inspection. Going forward: anywhere user-typed text becomes a key for MQTT topic matching (or any other downstream string compare), run it through the same invisible-char strip before persisting.

33. **`Mosquitto 2.x "disconnected due to malformed packet"` = camera's firmware emits MQTT 3.1 spec-edge packets that Mosquitto's strict validator rejects — not fixable on the camera side, swap broker to EMQX 5+** — 2026-05-19 incident: BOSCH_8000i (IVA Basic, Bosch FW too old for the MQTT settings panel in Bosch CM to expose protocol-version / keep-alive / clean-session toggles; already on the latest firmware available for that hardware) reconnected every 30–300s with this exact log line, and live events never landed in the DB. Symptom signature: (a) `docker logs bosch-mosquitto` shows `Client <id> disconnected due to malformed packet` repeatedly for the same client, (b) other cameras on the same broker are fine, (c) the affected camera's `mosquitto_sub`-listened topic shows only retained messages, no fresh PUBLISH despite the camera being on the LAN and replying to ping. Mosquitto 2.x has no config knob to relax strict validation — verified by walking the man-page options. Fix: swap to EMQX 5.8 (`docker compose` change only; subscriber + cameras need no config update; volumes / mosquitto.conf left in place for rollback). Decision #112 has the full context including the ACL caveat (EMQX 5 default ACL denies `subscribe #` for non-localhost — use specific `+/onvif-ej/...` patterns as the subscriber already does).

34. **`dashboard.js` runs STALE after a deploy — Cloudflare edge-caches static `.js`** — `dashboard.dojojin.tech` is fronted by a Cloudflare Tunnel, and Cloudflare caches `.js` aggressively. After deploying new frontend code the browser can keep running the OLD `dashboard.js`: the Network tab shows status `200` (looks fine!) but it's served from the Cloudflare edge, not origin — confirm via the `cf-cache-status: HIT` response header. Symptom: a new feature silently doesn't work with NO JS error in the console (e.g. the MV.3c face-detail modal — clicking a card did nothing because the cached old build's card had no `onclick`). Fixed 2026-05-20: `api-server.js` serves `/` + `/index.html` through a route (not plain `express.static`) that stamps `dashboard.js?v=<mtime-of-dashboard.js>`. A changed `dashboard.js` → new `?v` → new URL → cache miss → fresh load, automatically, every deploy. `index.html` itself goes out `Cache-Control: no-cache` (tiny; must always carry the current `?v`). **One-time:** after deploying this change you must purge the Cloudflare cache once to evict the already-cached old `index.html` + `dashboard.js`; it's automatic after that. When debugging "user doesn't see my frontend change," check `cf-cache-status` FIRST.

35. **Date/time inputs MUST be flatpickr — register every `<input type="datetime-local">` id in `_DT_DATETIME_IDS` (`dashboard.js`)** — the dashboard wraps every datetime input with flatpickr via `initDateTimePickers()`, because Chromium on Windows ignores the input's `lang` attribute and renders a native `<input type="datetime-local">` in the OS "Short time" format — 12h on most Thai installs. flatpickr forces 24h + Thai locale regardless of browser/OS. **Adding a new datetime input → add its id to `_DT_DATETIME_IDS` in the SAME change** (date-only inputs → `_DT_DATE_IDS`, month → `_DT_MONTH_IDS`). Forget it and that one input is a mis-formatted native picker while every other date field on the dashboard is the controlled flatpickr widget. Clearing/setting a flatpickr input must use `clearDtValue(id)` / `setDtValue(id, date)` — NOT `el.value = ''`: flatpickr uses an `altInput`, so `el.value` writes only the hidden field and the visible input goes stale. This was missed during MV.3d — the face-filter `from`/`to` inputs were added as raw `datetime-local` and left off the registry; symptom = that picker looks/behaves different from every other date field.

36. **WebSocket connections are authenticated (since 2026-05-21, decision #120)** — `verifyClient` on the `WebSocket.Server` rejects the upgrade with HTTP 401 unless the request carries a valid session (the `session` cookie, OR a `?token=` query param). A new WS *channel* (broadcast type) needs no extra work — it inherits the gate. But anything that OPENS a WS to the server must send a session: the dashboard's `connectWS()` appends `?token=<stored token>` (the Safari ITP fallback; same-origin upgrades also carry the cookie). Symptom if the client forgets the token: WS never connects, `onerror` fires `Unexpected server response: 401`, the LIVE badge stays "Reconnecting...". Server-side render tooling (Puppeteer / `report-print.html`) does NOT open the dashboard WS, so no internal-token path is needed there.

37. **CORS is an allowlist, not blanket reflection (since 2026-05-21, decision #120)** — genuine same-origin requests always pass (the middleware compares `new URL(Origin).host === Host`, so it keeps working however the dashboard is reached: Cloudflare domain, LAN IP, localhost). A genuinely cross-origin client must be added to `ALLOWED_ORIGINS` in `src/.env` (comma-separated). Symptom of a missing entry: the browser blocks the response with a CORS error even though the server returned 200. Do NOT "fix" it by reverting to reflecting every Origin — that re-opens the credentialed-cross-origin hole.

38. **Never read raw `X-Forwarded-For` for a security decision (since 2026-05-21, decision #120)** — `getIP()` prefers `CF-Connecting-IP` (Cloudflare sets AND overwrites it — a client cannot forge it) then `req.ip` (proxy-aware via `trust proxy`). The leftmost XFF entry is client-controlled. Any future rate-limit / account-lockout / audit-IP code must call `getIP()`, never `req.headers['x-forwarded-for']` directly.

39. **Dahua CGI quirks — caught building the Dahua ingester 2026-05-21 (decision #123)** — Before debugging Dahua snapshot timing or recovery, read `DahuaProblem.MD`. (a) `eventManager.cgi?action=attach&codes=[All]` delivers ONLY Heartbeat + system events; VCA events (CrossLineDetection / FaceDetection / …) need the codes listed EXPLICITLY in the `codes=[...]` list. (b) Dahua's ONVIF event service exposes no Face/IVS topics (only motion / scene-change / digital-I/O) — ONVIF is not a viable transport for Dahua VCA. (c) `snapManager.cgi?action=attachFileProc` returns headers Node's HTTP parser rejects ("Invalid header token" — even with `insecureHTTPParser`; curl reads it fine), and on a camera with no SD card it streams nothing anyway. (d) Dahua event `data.UTC` is the camera's LOCAL time sent as a unix timestamp (NOT UTC — e.g. +7h in Thailand), second-precision, `UTCMS` always 0 — strip the whole-hour offset before using it as a timestamp. (e) If a Dahua "connects but no events arrive", the camera's **Smart Plan** isn't active — a rule showing `Enable=true` in `VideoAnalyseRule` is not enough; the channel must actually be running the AI (check Setting → AI → Smart Plan in the camera UI). (f) The Dahua sub-stream can be configured down to **1 fps** (the test camera's `subtype=1` is 704×576 @ 1 fps, vs `subtype=0` main = 2592×1944 @ 12 fps — verify with `ffprobe`). A 1 fps stream is unusable for clip capture: `ffmpeg -f segment -segment_time 1 -c copy` can only cut segments at keyframes, and a 1 fps stream with a multi-second GOP produces 0-byte `.ts` segments → `clip_status='failed'`. **Always set a Dahua camera's `clip_stream` to 1 (main)** unless its sub-stream has been reconfigured (in the camera web UI) to a real frame rate. `clip_stream` lives in `cameras-config.json`; saving the camera-settings form rewrites the file, so set it in the form too or the next save reverts it. The RTSP-clip-buffer snapshot path (decision #123) also depends on this — it extracts frames from the main-stream segments.

40. **Bosch `/snap.jpg` returns the camera's NATIVE resolution only when
    `JpegSize` is OMITTED — a `JpegSize=WxH` param caps the output to
    exactly that size.** Both the stored-snapshot capture
    (`mqtt-subscriber.js` `captureHttpSnapshot`) and the live route
    (`api-server.js` `/api/snapshot/live`) hard-coded
    `JpegSize=1280x720`, silently capping every Bosch snapshot to 720p
    regardless of the Phase 2 per-camera `full_view_width` setting (the
    operator set it to "native" and still got 720p — that's the bug
    that surfaced this). Fixed 2026-05-21 — `JpegSize` dropped from
    both routes; `snap.jpg` now returns native (probed: 8100i =
    3840×2160 4K ~920 KB, 8000i = 3264×1840 ~620 KB). `VCAOverlay=1`
    works without `JpegSize` on both FW 9.x (8100i) and the older
    8000i FW. **Consequence:** stored Bosch event snapshots are now
    ~4–6× larger on disk — the `HARDWARE_SIZING_GUIDE` 160 KB/snap
    constant is stale for native captures and needs recalibration.
    If smaller Bosch snapshots are ever needed, add a per-camera
    capture-resolution field — do NOT re-introduce a blanket
    `JpegSize` hard-code. The `?w=N` thumbnail layer (decision #125)
    already keeps the display light; only the stored original + the
    explicit "view full" are native-sized.

41. **Hikvision live-snapshot route picks the ISAPI channel by the
    requested `?w` size — never hard-code a channel.** `/api/snapshot/
    live` for Hikvision used to hard-code `channels/102/picture`
    (sub-stream), which capped the "view full" button and the
    per-camera `full_view_width` at the sub-stream's 720p no matter
    what the operator set (that's the reported "Hikvision resolution
    won't change" bug). Fixed 2026-05-21 — small `?w` (grid ≤400,
    detail hero 640) still pulls channel 102 (light — the 4K main is
    ~700 KB/frame and many grid cards at once would stall the page);
    large / absent `?w` ("view full") pulls channel `10<snapshot_
    stream||1>` so the requested resolution actually exists. Probed
    channel resolutions on the DS-2CD3686G2T: 101 = 3840×2160,
    102 = 1280×720, 103 = 1920×1080. Note: the STORED event snapshot
    (`hikvision-isapi.js` `captureSnapshot`) already reads
    `snapshot_stream` directly — but the ingester loads
    `cameras-config.json` once at boot (no hot-reload, decision
    #114), so a `snapshot_stream` change needs an ingester restart
    to affect stored snapshots.

42. **เพิ่ม UI string ใหม่ → ต้อง i18n เสมอ ห้าม hardcode ไทย/
    อังกฤษ** (decision #128). (ก) static markup → ใส่ attribute
    `data-i18n*` + เพิ่ม key ใน `dashboard/i18n.js` **ทั้ง block
    `th` และ `en`** (ขาดข้างเดียว key parity พัง); (ข) string ที่
    JS generate → เรียก `I18N.t('key')`; ข้อความที่มี HTML ใช้
    `data-i18n-html`. **เพิ่ม datetime input ใหม่** ต้อง register
    id ใน `_DT_*_IDS` ด้วย (gotcha #35) + data-i18n label เหมือน
    field อื่น. **Dead code ที่จงใจข้าม:** `dashboard.js` ฟังก์ชัน
    `renderReportPreview()` (~บรรทัด 4796-4870) ยังมี Thai
    hardcoded — เป็น dead code (ไม่มีใครเรียก; อ่านตัวแปร
    `currentReportData` ที่ไม่เคยถูก set — live path คือ
    `renderReportPreviewV2` → `report-template.js`) จึงข้ามตอน
    ทำ i18n; ลบทิ้งได้เลยถ้าเก็บกวาด dead code รอบหน้า. **ตรวจงาน
    i18n:** `grep -n '[฀-๿]'` ในไฟล์ frontend — ที่เหลือควรเป็น
    แค่ค่าใน `i18n.js`, code comment, หรือปุ่มสลับภาษา `ไทย`.

43. **Snapshot columns were dead until migration 025 — now use
    `events.has_snapshot` / `snapshot_filename` for new queries.** ก่อน
    2026-05-26 schema มี `events.has_snapshot` +
    `events.snapshot_filename` แต่ ingesters เขียนแค่
    `raw_json->>'_snapshot'` ทำให้ `WHERE has_snapshot=true` คืน 0 rows
    แม้มี snapshot file หลายพันใบ และเคยทำให้ Health Report ขึ้น
    "Frame ล่าสุด: ไม่เคยมี frame". Migration
    `db_migration_025_events_snapshot_columns.sql` backfill rows เดิม,
    เพิ่ม partial indexes (`idx_events_has_snapshot_time`,
    `idx_events_camera_snapshot_time`), และ ingesters หลัก
    (Bosch/Hikvision/Dahua/Face Capture) เขียน column พร้อมกับ
    `raw_json._snapshot` แล้ว. **Rule ใหม่:** query ที่ต้อง filter ว่า
    มี snapshot ให้ใช้ `has_snapshot = TRUE`; ถ้าต้องอ่าน filename ให้ใช้
    `COALESCE(snapshot_filename, raw_json->>'_snapshot')` เพื่อรองรับ
    legacy rows / rollback ระหว่าง deploy.

44. **Stats Activity Heatmap drill-down ต้อง preserve filter scope ครบ
    ไม่ใช่ส่งแค่ `dow/hour`** — incident 2026-05-26: ในหน้า
    `สถิติเหตุการณ์` ส่วน "กิจกรรมตามชั่วโมง × วัน" cell นับจาก
    `/api/stats/heatmap?from=&to=&cameras=&category_id=` ถูกต้องแล้ว
    แต่เมื่อคลิกไปหน้า `เหตุการณ์ (Live)` frontend ส่งเฉพาะ
    `dow/hour/from/to` เข้า `/api/events` ทำให้ผลปลายทางกว้างกว่า
    source cell ทันทีถ้าหน้า Stats กำลังเลือก category ใน dropdown
    หรือเลือก camera group ที่ไม่ใช่ `all`. Backend รองรับ filter
    เหล่านี้อยู่แล้ว (`/api/events` มี `category_id`, `cameras`,
    `dow`, `hour`; `/api/stats/heatmap` มี `category_id`, `cameras`)
    ดังนั้น root cause คือ frontend drill context หาย ไม่ใช่ SQL
    aggregation. Fix commit `c2ed5f7`: เพิ่ม `drillHeatmapCell()`
    ให้อ่าน `heatmapCatFilter` ณ เวลาคลิกและส่ง `category_id` เข้า
    `drillTo()`, และให้ `drillTo()` capture active camera group เป็น
    `cameras=` เมื่อไม่ได้ drill ด้วยกล้องเดี่ยว. **Rule:** chart
    drill-down ใด ๆ ต้องส่ง filter scope ทั้งหมดที่ใช้สร้าง visual
    นั้น: date range, category/rule/camera, active camera group, และ
    bucket-specific filters (เช่น `dow/hour`) แล้วให้ `/api/events`
    กรอง server-side ก่อน pagination.

---

45. **LINE Config recipient deletion ไม่ persist ข้าม tab switch** —
    incident 2026-05-27: กด ✕ ลบ recipient ออก → หายจากหน้าจอ → สลับ
    tab ออก → กลับมา → ข้อมูลเก่ากลับมา. Root cause: `removeRecipient()`
    แค่ `lineConfigCache.recipients.splice(idx, 1)` + `renderRecipients()`
    ไม่มี API call เลย. `loadLineConfig()` ทุกครั้งที่ switch tab fetch
    ใหม่จาก server ทับ cache. Fix: เพิ่ม `saveLineConfig({ silent:true })`
    ใน `removeRecipient()` หลัง splice; เพิ่ม `{ silent=false }` param
    ใน `saveLineConfig()` เพื่อ suppress alert dialog เมื่อ auto-save.
    Commit `eb3bc26`. **Rule:** ทุก mutation บน in-memory cache ที่ user
    คาดว่า persist ต้องเรียก API save ทันที อย่าปล่อยให้ depend on
    explicit save button เพียงอย่างเดียว.

46. **Deleted LINE recipient กลับมาทักแล้ว dashboard เงียบ — เพราะ
    `pending_recipients.status` ยังเป็น 'approved'** — incident 2026-05-27:
    ลบ user ออกจาก `line_config.recipients` → user ทักกลับ → ไม่ได้รับ
    auto-reply, ไม่ขึ้น "ตรวจพบใหม่", admin มองไม่เห็น. Root cause สาม
    ชั้น: (A) `PUT /api/line-config` ไม่ได้ reset `pending_recipients.status`
    → row ยัง 'approved' → webhook UPSERT CASE `WHEN 'approved' THEN
    'approved'` → status ไม่เปลี่ยน → ไม่ขึ้น pending list; (B) UPSERT
    ใช้ `row.inserted` เป็น gate auto-reply แต่ deleted user = UPDATE ไม่
    ใช่ INSERT → `inserted=false` → ไม่มี reply; (C) pending list ไม่มี
    auto-refresh. Fix: (A) `PUT /api/line-config` หา removed IDs → UPDATE
    `pending_recipients SET status='ignored'`; (B) CTE `WITH prev AS (SELECT
    status …)` + `shouldReply = status==='pending' && (inserted ||
    prev_status!=='pending')`; (C) badge + 30s poll. Commits `eb3bc26`
    `036ef0a`. **One-time cleanup SQL** สำหรับ orphaned rows จาก pre-fix:
    ```sql
    UPDATE pending_recipients SET status = 'ignored'
    WHERE status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM line_config lc, jsonb_array_elements(lc.recipients) r
        WHERE lc.id = 1 AND r->>'id' = pending_recipients.line_id);
    ```
    **Rule:** เมื่อลบ entity ที่มี FK-like relationship ใน JSONB array ต้อง
    clean up dependent status ใน table อื่นด้วยในตอน delete ไม่ใช่ปล่อยให้
    stale.

---

47. **LINE Push ทุกอย่างเงียบเมื่อ quota หมด — ไม่มี error ใน UI** —
    incident 2026-05-27: approval notification ไม่ถึง user; reproduce ด้วย
    `curl /v2/bot/message/push` → `{"message":"You have reached your
    monthly limit."}`. `pushLineMessage()` resolve `{ success:false,
    error: '...' }` แต่ code เดิมไม่ได้ log result → fail เงียบ. ผลกระทบ
    ไม่ใช่แค่ approval — **alert push และ scheduled report ทุกอย่างก็ fail
    พร้อมกัน** โดยไม่มีสัญญาณใน dashboard. Fix: เพิ่ม log result ใน
    approve handler (commit `c881d06` ปรับใน session เดียวกัน). Quota
    widget (`GET /api/line-config/quota`) จะแสดง 100% / red bar เตือนก่อน
    หมด. **Rule:** `pushLineMessage` always resolves — ต้อง log หรือ check
    `result.success` เสมอ ห้าม fire-and-forget โดยไม่ log.

48. **ทำไม approval notification ต้องใช้ Push ไม่ใช่ Reply API** —
    Reply API ต้องการ `replyToken` จาก webhook event: (1) single-use —
    ใช้ครั้งเดียวแล้วหมด; (2) หมดอายุ ~1 นาที หลัง event. ตอน admin
    approve อาจเป็นชั่วโมงหรือวันถัดไป — `replyToken` จาก message เดิม
    ถูก consume ไปแล้วตอนส่ง "รอ admin อนุมัติ" และหมดอายุนานแล้ว.
    Reply ออกแบบมาสำหรับ "ตอบทันทีใน context เดียวกับ event" เท่านั้น;
    การส่งในเวลาอื่น (approval, alert, report) ต้องใช้ Push เสมอ.

49. **Camera uptime % ต่ำกว่าจริงมาก — เพราะ ingester เขียน `enabled=TRUE`
    ทับ state ของ heartbeat checker** — incident 2026-05-27: Health Report
    24h แสดง BOSCH/Hikvision 22.4%, Dahua 62.2% ทั้งที่กล้องทำงานปกติ.
    Reproduce: `SELECT status FROM camera_status_log WHERE changed_at >=
    NOW()-INTERVAL '24 hours'` → ทุก row เป็น `'offline'` เท่านั้น ไม่มี
    `'online'` recovery entry เลย.
    **Root cause:** ingesters (Hikvision ISAPI, Dahua CGI, Bosch MQTT)
    อัปเดต `cameras.enabled=TRUE` ทุกครั้งที่รับ heartbeat/chunk. heartbeat
    checker (`checkOfflineCameras`, ทุก 30 วินาที) ตรวจ transition ด้วย
    `if (cam.enabled !== isOnline)` — เมื่อ ingester เขียน `enabled=TRUE`
    ก่อน checker รัน, checker เห็น `TRUE !== TRUE = false` → ไม่เขียน
    `'online'` log เลย. uptime SQL ใช้ `LEAD()` บน consecutive `'offline'`
    rows → นับช่วงที่กล้อง online อยู่จริงเป็น offline duration ทั้งหมด
    (BOSCH_3100i: 18.88h "offline" จาก 3 reco ที่ไม่มี online คั่น).
    **Fix (commit `679e607`):** ตัด `enabled=TRUE` ออกจาก ingester ทุกจุด
    (6 sites, 3 files) — ingester อัปเดตเฉพาะ `last_seen_at`. `cameras.enabled`
    เป็นหน้าที่ของ heartbeat checker แต่เพียงผู้เดียว — checker รัน ≤30 วินาที
    หลัง recovery ก็เขียน `'online'` entry ถูกต้อง.
    **Second bug location (commit `7d25d06`):** `checkMonitorCameras()` ใน
    `api-server.js` (TCP probe สำหรับ Dahua/ONVIF, ทุก 60 วินาที + 8 วินาที
    หลัง startup) ก็เขียน `enabled=TRUE` เช่นกัน — ยืนยันด้วย query หลัง
    restart ingesters: `cameras.enabled=t` + `last_seen_at` สด แต่ยังไม่มี
    `'online'` entry ใน `camera_status_log` เลย. fix: เปลี่ยน UPDATE เป็น
    `SET last_seen_at = NOW()` โดยไม่มี `enabled=TRUE`.
    **Rule:** ingester = "stamp เวลาที่เห็นกล้อง" เท่านั้น. state machine
    (online/offline transition + log) = heartbeat checker เท่านั้น ห้ามปนกัน.
    ทุก UPDATE ที่แตะ `cameras` table ต้องถาม: "ฉันเป็น heartbeat checker ไหม?"
    ถ้าไม่ใช่ → ห้ามแตะ `enabled`.

    **Post-fix recovery recipe (one-shot bootstrap):** หลัง deploy fix +
    restart api-server, `cameras.enabled=TRUE` ค้างมาจาก code เก่า → checker
    เห็น `enabled === isOnline` ตลอด ไม่ trigger transition → ยังไม่เขียน
    `'online'` แรก จนกว่ากล้องจะ offline-แล้ว-กลับครั้งแรก. ระหว่างนั้น
    uptime SQL ยังเพี้ยน (ทุก gap ระหว่าง offline entries เก่าถูกนับเป็น
    offline ต่อเนื่อง). bootstrap ครั้งเดียว:
    ```sql
    UPDATE cameras SET enabled = FALSE
    WHERE last_seen_at > NOW() - INTERVAL '90 seconds'
      AND enabled = TRUE;
    ```
    เฉพาะกล้องที่ online จริงในขณะนี้ (กัน fake recovery alert สำหรับกล้อง
    offline จริง). รอ ≤30 วินาที checker ตรวจ → จะเขียน `'online'` entries
    ครบทันที. หลัง bootstrap: uptime คำนวณ "จากตอนนี้ไปข้างหน้า" ถูกต้อง
    แต่ค่า 24h window **ยังเพี้ยนค้าง ~24 ชม.** เพราะ offline entries เก่า
    (ก่อน bootstrap) ยังอยู่ใน window — รอ entries เก่าหลุดออก window
    จึงจะ accurate. ไม่ต้อง TRUNCATE log (เสียdี audit trail offline events).
    Recovery applied to prod 2026-05-27 หลัง commit `7d25d06`; 6 กล้องได้
    `'online'` entry แรกที่ 13:56:19 UTC.

50. **SEC-001: EMQX ports must be bound to 127.0.0.1 (or LAN IP), not 0.0.0.0** — 2026-05-28:
    audit found EMQX 1883/8083/18083 bound `0.0.0.0`, letting any LAN host publish arbitrary MQTT
    events (anonymous auth, chain → stored XSS). **Phase 1** (commit `4e11375`) fixed by
    `"127.0.0.1:1883:1883"` — but this silently broke Bosch camera ingest: cameras publish MQTT
    **directly** to broker (they are NOT routed through `mqtt-subscriber.js`); localhost-only bind
    means cameras cannot reach broker from LAN.
    **Phase 2** (2026-05-28, decision #164): dual-bind `127.0.0.1:1883:1883` +
    `192.168.10.31:1883:1883`; WS port 8083 removed entirely (nothing uses it externally);
    `ENABLE_AUTHN: "true"` on TCP listener; `password_based:built_in_database` authenticator
    provisioned via `scripts/emqx-provision.js` (idempotent — reuse existing camera passwords,
    only generate for new cameras). Per-camera MQTT users: `cam-<camera_id_lowercase>` pattern;
    subscriber user: `dashboard-subscriber` (creds in `src/.env` — see GOTCHA #59).
    Credentials stored in `cameras-config.json` (`mqtt_username`/`mqtt_password` — gitignored).
    **Adding new Bosch camera:** add to `cameras-config.json` → `node scripts/emqx-provision.js`
    → enter printed credentials in camera web UI (Broker `192.168.10.31`, Port `1883`).
    **Fresh-volume note:** `EMQX_DASHBOARD__DEFAULT_PASSWORD` only works on fresh volumes —
    rotate existing via API (`POST /api/v5/users/admin/change_pwd`).
    **Phase 3** (2026-06-07, network resilience): dual-bind `192.168.10.31:1883` +
    `127.0.0.1:1883` เปลี่ยนเป็น `"1883:1883"` (all-interfaces `0.0.0.0`) เพราะ IP hardcode
    พังเมื่อ operator เปลี่ยน LAN, ใช้ VPN, หรือ interface เปลี่ยน. Security compensation:
    `ENABLE_AUTHN=true` บังคับ credentials ทุก client — anonymous publish chain ปิดแล้ว.
    Dashboard `:18083` ยังคง `127.0.0.1`-only เสมอ. Broker address สำหรับกล้อง = LAN IP ของ
    server จริง (ดูจาก `ip a`/`ifconfig`) — ไม่ hardcode `192.168.10.31` ใน client config.

51. **SEC-002: ทุก field จาก events/cameras/MQTT ต้องผ่าน escapeHtml ก่อน inject ใน innerHTML** — 2026-05-28:
    `renderEvents`, `renderSnapshots` (grid + list) ใช้ template literal โดยไม่ escape `rule_name`,
    `camera_id`, `object_class`, `snapshot_source`, `event_type` → Stored XSS path จาก SEC-001.
    Fixed: ทุก field ผ่าน `escapeHtml()`; snapshot/clip URL path ผ่าน `encodeURIComponent()`.
    `renderMedia` มี `escapeHtml` อยู่แล้วก่อนหน้านี้ — ไม่ต้องแตะ.
    **Rule:** ทุกครั้งที่เพิ่ม render function ใหม่ที่ใช้ event/camera data ใน innerHTML — escape ทุก field
    ยกเว้น: computed values ที่ไม่ใช่ string จาก DB/MQTT (เช่น `time`, `conf`, trusted tokens).

52. **SEC-003: GET /api/cameras ส่ง camera password redacted สำหรับ non-admin roles** — 2026-05-28:
    endpoint เดิม spread `cameras-config.json` ทั้งก้อน (รวม `username`/`password`) ให้ทุก role.
    Fixed: `req.user.role === 'admin'` → plaintext (admin ต้องการ prefill `frmCamPass` ในฟอร์มแก้ไข);
    viewer/auditor → `_redactCameraAudit()` (password = `***`).
    **อย่า** เปลี่ยนกลับเป็น redact ทุก role — dashboard.js:5685-5686 ใช้ `c.password` prefill ฟอร์ม admin.
    ถ้าต้องการ zero-exposure ในอนาคต → refactor เป็น option C (PUT ว่าง = คงเดิม) ใน ROADMAP.

53. **Map popup top-rules ว่างเปล่าเมื่อเปิด Map โดยไม่ผ่านหน้า Events ก่อน** — พบ 2026-05-28:
    `showCamPopup()` ใช้ `allEvents.filter(e => e.camera_id === camId)` แต่ `allEvents = []` จนกว่า
    `loadEvents()` จะถูกเรียก (เกิดเฉพาะตอนเปิดหน้า Events) — stats bar แสดง "EVENTS 24H: N" จาก
    `/api/heatmap` แต่ top-rules breakdown ว่างเปล่า ข้อมูลขัดแย้งกัน.
    Fixed: `showCamPopup` เป็น async — แสดง static camera info ทันที แล้ว fetch
    `GET /api/events?camera={id}&from=24hAgo&to=now&limit=50` on-demand; ตรวจ popup ยัง visible
    ก่อน render rules (กรณี hover ออกก่อน fetch เสร็จ); เพิ่ม `escapeHtml()` ทุก field ใน popup ด้วย.
    **Rule:** อย่าใช้ in-memory page buffer (`allEvents`, `allSnapshots` ฯลฯ) ใน context ที่ user
    อาจไม่ได้เปิดหน้านั้นก่อน — fetch on-demand แทน.

54. **SEC-004: `must_change_password` ต้อง enforce ที่ server-side middleware — client-only ไม่พอ** — 2026-05-28: flag อยู่ใน DB แต่ `requireAuth` ไม่ตรวจ → ใช้ token เก่า (หรือ bypass dashboard) ยิง endpoint ได้ตามปกติ. Fixed: `requireAuth` ใน `src/auth.js` ตรวจ `user.must_change_password` + ส่ง 403 `MUST_CHANGE_PASSWORD` ยกเว้น path ใน `ALLOW_WHILE_MUST_CHANGE` set; ซ้ำอีกชั้นใน global `/api` middleware ของ `api-server.js`.
    **Rule:** security flag ใดก็ตาม (must_change_password, email_verified, account_locked ฯลฯ) ต้อง enforce ที่ server middleware — ห้ามเชื่อแค่ client redirect.

55. **SEC-005: File upload ต้อง validate magic bytes — MIME type จาก browser ปลอมได้** — 2026-05-28: logo upload endpoint เชื่อ `req.file.mimetype` จาก Content-Type header (client-controlled) → attacker ส่ง SVG ที่เปลี่ยน extension เป็น `.png` ผ่านได้ → librsvg CVE path เปิด.
    Fixed: อ่าน `req.file.buffer` ตรวจ magic bytes ก่อน (PNG: `\x89PNG`; JPEG: `\xFF\xD8\xFF`; WebP: `RIFF....WEBP`; GIF: `GIF87a`/`GIF89a`) → reject ถ้าไม่ตรง.
    **Rule:** ทุก upload endpoint → magic bytes check เสมอ; MIME type ใช้เป็น hint เท่านั้น ห้าม trust เป็น security gate.

56. **SEC-010: login กับ logout ต้องใช้ cookie flag ชุดเดียวกัน — hardcode string แยกทำให้ drift** — 2026-05-28: login cookie มี `HttpOnly; Secure; SameSite=Lax` ครบ แต่ logout ใช้ hardcoded `'session=; Path=/; HttpOnly; Max-Age=0'` — Secure + SameSite หายไป (cosmetic แต่ inconsistent + เสี่ยงถ้า browser เปลี่ยน behavior).
    Fixed: logout สร้าง flags array เดียวกับ login: ตรวจ `req.secure` + `x-forwarded-proto` + `cf-visitor` → push `Secure` เฉพาะ HTTPS; `SameSite=Lax` ติดทุกกรณี.
    **Rule:** login/logout ต้องใช้ helper function เดียวกัน build cookie flags — ห้าม inline string แยก.

57. **ทุก internal Docker service ต้อง bind 127.0.0.1 ไม่ใช่ 0.0.0.0 (generalized จาก SEC-001 + SEC-011)** — 2026-05-28: EMQX (#50) และ Postgres ต่างก็ bind `0.0.0.0` ตาม Docker default → expose ออก LAN/WAN โดยไม่ตั้งใจ.
    **Rule:** ทุก port ใน `docker-compose.yml` ที่ไม่ต้องรับจากเครือข่ายภายนอก → ใช้ `"127.0.0.1:PORT:PORT"` เสมอ (ไม่ใช่ `"PORT:PORT"`). ถ้าต้องรับจาก LAN ใช้ LAN IP หรือ `0.0.0.0` **พร้อม AUTHN/credentials enforcement** — ห้ามใช้ wildcard กับ service ที่มี anonymous access.
    **ยกเว้น: EMQX MQTT `:1883`** — ใช้ `"1883:1883"` (all-interfaces) ได้เมื่อ `ENABLE_AUTHN=true` บังคับ credentials ทุก client (ดู GOTCHAS #50 Phase 3, 2026-06-07).
    Secret ใน compose ใช้ `${VAR:?error msg}` เสมอ — ค่าจริงไปอยู่ใน `.env` (gitignored). ดู GOTCHAS #50 (EMQX) + decisions #157–#160.

58. **Live Pulse WS event ถึง frontend ก่อน snapshot save — `snapshot_file` เป็น null เสมอ** — 2026-05-28:
    `pg_notify('new_event', id)` ใน `mqtt-subscriber.js` (เดิม line 548) ยิงทันทีหลัง `INSERT events` —
    ก่อนที่ `captureHttpSnapshot()` (HTTP GET `/snap.jpg`, timeout 5s) จะ resolve.
    api-server.js ได้ NOTIFY แล้วยิง `SELECT e.* ... WHERE id=$1` → row มี `snapshot_filename = NULL`
    เพราะ UPDATE ยังไม่เกิด → `broadcast({ type:'new_event', event:row })` ส่ง `snapshot_file = null`.
    **สองปัญหาซ้อนกัน:** (1) timing — pg_notify ก่อน snapshot; (2) field name — `_handleMapPulse`
    อ่าน `event.snapshot_filename` แต่ WS row ส่ง COALESCE result เป็น `event.snapshot_file`.
    Fixed: (1) ย้าย `pg_notify` ไปหลัง snapshot UPDATE ใน **ทั้ง 3 ingester** (decision #163):
    `mqtt-subscriber.js` (Bosch) — notify หลัง `await pool.query(UPDATE)`;
    `dahua-cgi.js` (Dahua) — `await` snapshot UPDATEs แล้ว notify หลัง block ปิด;
    `hikvision-isapi.js` (Hikvision) — notify ในท้าย `captureSnapshot().then()` chain (+ catch path).
    (2) เปลี่ยน `event.snapshot_filename` → `event.snapshot_file || event.snapshot_filename` ใน
    `_handleMapPulse` — fallback ครอบ legacy rows ที่ snapshot_filename ยัง null.
    **Rule:** ทุกครั้งที่เพิ่ม `pg_notify` ใน ingest path — ตรวจก่อนว่า listener side-effect
    ต้องการข้อมูลที่ยังไม่ถูกบันทึก (เช่น snapshot, clip) หรือไม่; ถ้าใช่ → ย้าย notify ไปหลัง
    write นั้นเสมอ. อย่า fire notify "เร็ว" แล้วหวังว่า reader จะ retry.

59. **`src/.env` และ root `.env` เป็นคนละไฟล์ — credentials ที่เพิ่มต้องใส่ถูกไฟล์** — 2026-05-28:
    Node.js services (`api-server.js`, `mqtt-subscriber.js`, ingesters ฯลฯ) รันจาก `src/` ผ่าน
    `npm run <script>` (ดู `src/package.json`) → `require('dotenv').config()` ไม่มี path argument
    → อ่านจาก **`src/.env`** (CWD ของ process).
    Docker Compose อ่าน **root `.env`** สำหรับ `${VAR}` expansion (`POSTGRES_PASSWORD`,
    `EMQX_DASHBOARD_PASSWORD` ฯลฯ).
    ทั้งสองไฟล์ gitignored และมีเนื้อหาคนละชุด — **ห้ามสับสน**.
    **Rule:** credentials ที่ Node.js services ต้องใช้ → `src/.env`;
    credentials ที่ Docker Compose ต้องใช้ → root `.env`.
    ถ้าค่าใดต้องการทั้งสองฝ่าย (เช่น `DB_PASSWORD`) → ต้องใส่ทั้งสองไฟล์โดยตั้งใจ.

60. **แก้ไขกล้อง Bosch ผ่าน UI จะลบ `mqtt_username`/`mqtt_password` ออกจาก cameras-config.json โดยไม่รู้ตัว** — 2026-05-28:
    `POST /api/cameras` สร้าง `newCam` จาก request body ล้วนๆ แล้ว `config.cameras[idx] = newCam`
    ทดแทน entry เดิม — optional fields ที่ form ไม่ส่ง (http_port, snapshot_path ฯลฯ) มีโค้ด preserve
    จาก `prev` โดยเฉพาะ แต่ `mqtt_username`/`mqtt_password` ไม่อยู่ใน preserve list.
    ผล: admin เปิด edit form กล้อง Bosch ที่ provision แล้ว → กด Save → MQTT creds หายไป →
    provision script รันครั้งหน้า → เห็น `mqtt_password = null` → generate password ใหม่ →
    กล้องยังใช้ password เก่าอยู่ → MQTT ขาด (กล้อง disconnect หรือ reject).
    **Fix (2026-05-28):** เพิ่ม `if (prev.mqtt_username) newCam.mqtt_username = prev.mqtt_username;`
    + `if (prev.mqtt_password) newCam.mqtt_password = prev.mqtt_password;` ใน `newCam` building
    section ของ `POST /api/cameras` (api-server.js) — decision #166.
    **Rule:** ทุกครั้งที่เพิ่ม field ใหม่ใน cameras-config.json ที่ UI form ไม่ส่งตรง → ต้องเพิ่ม
    preserve-from-prev ใน `newCam` building ด้วย ไม่ใช่ปล่อยให้หายเงียบๆ.

---

61. **`mapMgrPollTimer` ไม่ถูก clear เมื่อ navigate ออกจาก Settings → แผนที่** — 2026-05-29:
    เดิม `closeMapManager()` เรียก `clearInterval(mapMgrPollTimer)` ทุกครั้งที่ modal ปิด.
    หลัง Phase 2e ลบ modal + `closeMapManager()` ออก — `pollDownloadStatus()` เริ่ม timer เมื่อ
    `onShowMapSettings()` ถูกเรียก แต่ `settingsNav()` ไม่มี cleanup hook เมื่อเปลี่ยน section
    หรือ navigate ออกจาก Settings page.
    **ผล:** timer ยังรันต่อ (fetch `GET /api/map/areas` ทุก N วินาที) จนกว่าจะ refresh หน้า.
    **Impact ต่ำ:** request เบา + UI ซ่อนอยู่ ผลลัพธ์ถูก discard — ไม่ crash ไม่ data leak.
    **Fix ที่ถูกต้อง (ยังไม่ทำ):** เพิ่ม cleanup ใน `settingsNav()` ก่อน switch section:
    `if (mapMgrPollTimer) { clearInterval(mapMgrPollTimer); mapMgrPollTimer = null; }` และใน
    `showPage()` เมื่อออกจาก `'settings'`.
    **Rule:** ทุก interval/timer ที่ start ใน "open" handler ต้องมี corresponding "close/leave"
    handler เสมอ — อย่า assume user จะ refresh page.

62. **`appearances` INSERT ล้มเหลวเงียบ 3+ เดือน เพราะ schema drift + silent catch** — 2026-06-01:
    `extractAppearance()` (`mqtt-subscriber.js`) เขียนล่วงหน้าตาม schema ที่ **วางแผนไว้** แต่
    migration ที่สร้าง columns จริงไม่เคยถูกเขียน/รัน → `init.sql` มี schema ชุดเก่า
    (`gender, age_group, upper_color` ฯลฯ) แต่ INSERT ใช้ชุดใหม่ (`hair_length, top_category` ฯลฯ)
    → PostgreSQL โยน `column "hair_length" does not exist` ทุก event → ถูกกลืนที่
    `catch (e) { /* ignore */ }` → **`SELECT count(*) FROM appearances = 0`** ทั้งที่มี event จริง
    17+ รายการ (ยืนยัน 2026-06-01 หลังระบบ live หลายเดือน).
    **Root cause ซ้อน 2 ชั้น:** (1) code เขียนล่วงหน้า schema → drift; (2) silent catch ซ่อน error.
    **Fix:** migration 031 (ADD COLUMN IF NOT EXISTS ครบ) + เปลี่ยน catch เป็น `console.error`.
    **Rule:** ทุก INSERT/UPDATE ที่มี `catch (e) { /* ignore */ }` = footgun — ต้อง log อย่างน้อย
    เพื่อ detect schema drift. ถ้าเขียนโค้ดล่วงหน้า schema ต้องมี TODO + migration ควบคู่เสมอ.
    ดู BOSCH_IVA_Appearance.MD §2.3 + decision #184.

63. **`appearances.upper_color`/`lower_color` ว่างทุกแถว ทั้งที่ column และ data มีอยู่** — 2026-06-01:
    เป็น side-effect จาก GOTCHA #62: `extractAppearance()` ไม่เคยเขียน `upper_color`/`lower_color`
    แม้ว่า columns เหล่านี้มีใน `init.sql` มาตั้งแต่แรก เพราะ INSERT ล้มเหลวทั้งหมดก่อนจะถึงจุดนี้
    และเมื่อ Phase 1 fix แล้ว INSERT ผ่าน แต่ก็ยังไม่ได้เพิ่ม `upper_color`/`lower_color` ใน INSERT.
    **Fix (Phase 5):** เพิ่ม `xyzToColorName(topXyz)` → `upper_color`, `xyzToColorName(bottomXyz)` →
    `lower_color` ใน INSERT (migration 031 + `color-utils.js`). Backfill 144 rows ด้วย
    `db/backfill_upper_lower_color.js`. ดู decision #184.

---

64. **AirDatepicker ต้องการ `type="text"` — browser reject display-format string บน typed input เงียบ** — 2026-06-01:
    flatpickr ใช้ `altInput: true` สร้าง text input ใหม่สำหรับแสดงผล + เก็บ machine format ไว้ใน
    original hidden input. ADP ไม่มี altInput — เขียน `dateFormat` string (`"01/06/2026 14:30"`)
    ลง element โดยตรง. ถ้า element เป็น `type="datetime-local"` browser silently reject string
    ที่ไม่ใช่ `YYYY-MM-DDTHH:mm` → field ว่างเปล่า + native picker โผล่ทับ ADP popup.
    **Fix:** เปลี่ยน inputs ทุกตัวที่ใช้ ADP เป็น `type="text"`.
    **Rule:** เมื่อใช้ ADP ต้องใช้ `type="text"` เสมอ ห้ามใช้ `datetime-local/date/month`.
    ดู decision #186.

65. **ADP `isMobile:false` บน Android/iOS = keyboard ค้าง + popup ตกขอบ; `blur()` ไม่ช่วย** — 2026-06-01:
    `type="text"` input ที่ถูก tap บน mobile focus ก่อน ADP popup render → soft keyboard ขึ้น
    ทับ calendar. `onShow: inst => inst.$el.blur()` ไม่ทำงานบน Android Chrome (browser re-focuses
    ก่อน render). นอกจากนั้น inline popup ยังล้นขอบขวาเมื่อ input อยู่ขอบหน้าจอ.
    **Fix:** `isMobile: window.innerWidth <= 768` — ADP modal overlay จัดการ keyboard + positioning เอง.
    **Rule:** ADP init function ทุกตัวในโปรเจกต์นี้ต้องมี `isMobile: window.innerWidth <= 768`
    ห้าม hardcode `isMobile: false` เด็ดขาด.
    ดู decision #187.

66. **`system_settings` row missing — validator + UI มีแต่ลืม seed row → "setting row missing"** — 2026-06-01:
    `appearances_retention_days` มี validator ใน `SETTINGS_VALIDATORS` และมี UI widget
    แต่ไม่มี `INSERT` ใน migration หรือ `init.sql` → `UPDATE ... WHERE key=?` คืน 0 rows →
    `"setting row missing"` error ทุกครั้งที่ Save.
    **Fix:** migration 034 + อัปเดต `init.sql`; insert row ตรงใน DB เพื่อ fix live ได้ทันที
    โดยไม่ต้อง restart server.
    **Rule:** ทุกครั้งที่เพิ่ม key ใหม่ใน `SETTINGS_VALIDATORS` ต้องมี migration seed row คู่กันเสมอ
    (หรือ init.sql สำหรับ fresh install) — ห้ามเพิ่มฝั่งเดียว.

---

67. **column ที่เขียนแต่ไม่มีใครอ่าน — ตรวจสอบ read path ก่อน keep ไว้** — 2026-06-01:
    `appearances.snapshot_b64` ถูกเขียนทุก event แต่ไม่มี SELECT ใดอ่านเลย (endpoint ใช้
    `e.snapshot_filename` จาก events แทน; view ตั้งใจ exclude). ที่ 100K events/วัน = ~1GB/วัน
    dead weight. ตรวจพบเพราะทำ repo-wide grep ก่อนออกแบบ migration.
    **Fix:** migration 035 DROP COLUMN + หยุดเขียนใน mqtt-subscriber.
    **Rule:** ก่อน keep column ที่ "อาจใช้อนาคต" ให้ grep หา SELECT จริงๆ ก่อนเสมอ —
    ถ้าไม่มี read path ใดใช้ = dead weight ที่โตทุกวัน.

68. **`CREATE INDEX` ใน migrate.js lock ตาราง — ใช้ CONCURRENTLY บน production** — 2026-06-01:
    migrate.js รัน SQL ใน `BEGIN…COMMIT` transaction. `CREATE INDEX IF NOT EXISTS` ปกติ
    = ACCESS EXCLUSIVE lock ตลอด build time. บน dev (ข้อมูลน้อย) เสร็จใน ms ไม่มีปัญหา.
    บน production ที่ 73M แถว อาจ lock 5–30 นาที → กล้องส่ง event ไม่ได้ระหว่างนั้น.
    `CREATE INDEX CONCURRENTLY` ทำใน transaction ไม่ได้ → ต้องรันนอก migrate.js ด้วยมือ.
    **Rule:** migration ที่มี `CREATE INDEX` บน large table → ใส่ comment เตือนว่า
    "run CONCURRENTLY on production" และอย่า assume ว่า migrate.js จัดการให้เองได้.
    **เวลาควรทำ:** เมื่อ table > 10M แถว และต้องเพิ่ม index ใหม่บน production ที่รันอยู่.

69. **cameras-config.json คือที่เก็บ credential จริง ไม่ใช่ DB columns** — 2026-06-01:
    `cameras.http_password` + `cameras.rtsp_url` ใน DB schema มีอยู่แต่ไม่มีโค้ดเขียนหรืออ่านเลย
    (grep ครบ src/ + dashboard/ = 0 match); credential จริง (`username`, `password`,
    `mqtt_password` ต่อกล้อง) อยู่ใน `cameras-config.json` ซึ่ง ingester ทุกตัวอ่านโดยตรง
    (`cam.username`, `cam.password` feed HTTP Digest/Basic/ONVIF headers).
    ไฟล์ gitignored ✅ แต่ permissions `-rw-r--r--` (world-readable ❌) ถ้ายังไม่ chmod.
    **Fix:** `chmod 600 cameras-config.json` (1 คำสั่ง — pattern เดียวกับ src/.env ใน decision #120)
    → ปิด local-other-user read, mitigate leaked backup/config share.
    **Rule:** audit credential storage ให้ grep read path จริงก่อนสรุปว่า "อยู่ใน DB" —
    schema มี column ไม่แปลว่าโค้ดใช้. ดู decision #191.

70. **cameras.http_password + cameras.rtsp_url = dead columns — DROPPED 2026-06-02** — 2026-06-01:
    column ทั้งสองอยู่ใน `init.sql` มาตั้งแต่ design เดิม (`http_password` มี comment
    "เข้ารหัสใน production") แต่ไม่มี INSERT/UPDATE/SELECT ใดในโค้ดปัจจุบันแตะเลย;
    ไม่มี 3rd-party view expose, ไม่มี ingester อ่าน; ค่าใน DB = NULL ทุกแถว (verified live).
    **✅ Fixed:** migration 038 drop ทั้งสอง column + อัพ `init.sql` + อัพ COMMENT ON VIEW — SEC-015.
    **Rule:** column ที่มี comment "ควรทำในอนาคต" + ไม่มี read path ใดในโค้ด = dead weight;
    ให้ grep ก่อน keep เสมอ (ดู gotcha #67). `cameras.http_user` dead เช่นกันแต่ defer แยก.

---

71. **CAMERA_SECRET_KEY หาย = credentials กล้องกู้ไม่ได้** — 2026-06-02:
    หลัง SEC-014 (AES-256-GCM) deploy แล้ว `cameras-config.json` เก็บ ciphertext `enc:v1:…`
    ถ้า `src/.env` ถูกลบ (เคยเกิดจริง 2026-05-29 — sed wipe incident) และไม่มี key backup →
    ถอดรหัส credential ไม่ได้เลย → กล้องทุกตัว auth fail.
    **ป้องกัน:** บันทึก `CAMERA_SECRET_KEY` ใน password manager ทันทีหลัง generate;
    เก็บ `cameras-config.json.bak` (plaintext backup) ไว้จนกว่าจะยืนยันว่ากล้อง ingest ได้ปกติ.
    **Rollback:** `cp cameras-config.json.bak cameras-config.json` — โค้ด tolerant plaintext
    ทำงานได้ทันทีโดยไม่ต้อง restart (plaintext passthrough ใน `decryptCred`).
    ดู decision #194 · `src/crypto-creds.js` · `scripts/migrate-creds-encrypt.js`.

---

72. **รัน migrate-creds-encrypt.js ขณะ services เดิมยังทำงาน → กล้องออฟไลน์ทันที** — 2026-06-02:
    `migrate-creds-encrypt.js` แก้ไข `cameras-config.json` → `fs.watch` ใน ingester ยิงทันที →
    ingester เรียก `syncCameras()` → อ่าน ciphertext `enc:v1:…` เป็น password ตรง ๆ (old code
    ไม่มี decrypt) → auth failure → กล้องถูก mark `enabled = false` ใน DB
    (เกิดจริง 2026-06-02: HIKVISION_CAM01 ออฟไลน์ทันทีที่ migration รัน)
    **Fix ฉุกเฉิน:**
    ```sql
    UPDATE cameras SET enabled = true, last_seen_at = NOW() WHERE id = 'CAMERA_ID';
    ```
    **Rule:** **หยุด services ก่อนรัน migration script ทุกครั้ง** ไม่มีข้อยกเว้น —
    ลำดับที่ถูกต้อง: stop → git pull → generate key → migrate → start ด้วย new code.
    ดู `service_start.md § Camera Credential Encryption` + `scripts/migrate-creds-encrypt.js` header.

---

73. **Dahua firmware ใหม่ (realm 32-hex) ใช้ CGI Digest formula ที่ไม่รู้จัก** — 2026-06-02:
    กล้อง Dahua บางรุ่น firmware ใหม่ใช้ realm format `Login to <32-hex MD5>` (เช่น
    `Login to c27c1c4829108807428d16b403c9326c`) แทน `Login to <16-hex device-id>` ของ firmware เก่า
    **ข้อแตกต่างสำคัญ:** Private Protocol Auth = Security Mode ไม่ใช่ตัวแปรจริง —
    BMA-EAST ก็เปิด Security Mode แต่ใช้ realm format เก่า (16-hex) → standard Digest ทำงานได้;
    DAHUA_CAM01 มี realm 32-hex → standard formula + 20+ variants ทุกตัว fail ด้วย "Invalid Authority!"
    **อาการ:** snapshot `has_snapshot = false` ทุก event; `/api/snapshot/live/:id` คืน 502;
    web UI login ยังใช้งานได้ (ใช้ Dahua JSON-RPC แยก ไม่ผ่าน HTTP Digest);
    IP lockout จากการ retry ซ้ำ ทำให้แม้ password ถูกต้องก็ fail ชั่วคราว
    **Root cause:** firmware ใหม่เปลี่ยน internal Digest verification formula (formula จริงยังไม่ทราบ)
    **Workaround:** เปลี่ยน "Private Protocol Auth" → Compatibility Mode → Save →
    กล้องจะใช้ realm 16-hex + standard Digest → ภาพกลับมาทันที (ต้อง reboot ถ้ายัง lock อยู่)
    **Rule:** Dahua CGI Digest fail ทุก formula + realm 32-hex → เปลี่ยน Compatibility Mode;
    ถ้า lockout อยู่ → reboot กล้องก่อน; ตรวจ realm format ก่อน debug formula
    **⚠️ Recurrence pattern (2026-06-02):** Compatibility Mode อาจ reset กลับมาหลัง services restart
    หรือ ingester reconnect → กล้องกลับมาใช้ realm 32-hex → snapshot พัง (`has_snapshot=false` ทุก event,
    `_snapshot_status:"missing"`, `strategy:"cgi-live-fallback"`, `candidates:[]` ใน `raw_json`)
    ถ้าเห็น pattern นี้หลัง restart → เข้า web UI กล้อง ตรวจ Compatibility Mode ก่อนเสมอ

74. **`license_plates` INSERT column mismatch — 0 rows ตลอดตั้งแต่ LPR เปิดใช้** — 2026-06-02:
    `extractLPR()` ใน `mqtt-subscriber.js` ใช้ชื่อ column จาก Bosch payload โดยตรง
    (`plate_likelihood`, `country_code`, `issuing_entity`, `vehicle_type`, `vehicle_brand`,
    `vehicle_model`, `snapshot_b64`) แทนที่จะ map ให้ตรง schema จริง (`confidence`, `country`,
    `region`) และ column `snapshot_b64` ถูก drop ใน migration 035 ไปแล้ว
    `catch (e) { /* ignore */ }` ซ่อน PostgreSQL error → 0 rows ทุก LPR event โดยไม่มี log
    **Root cause:** ไม่ได้ตรวจ `\d license_plates` เทียบกับ INSERT statement ก่อน merge;
    silent catch ทำให้ตรวจไม่พบจาก production log เลย
    **Fix (2026-06-02):** align column names + เพิ่ม migration 036 (vehicle_type/color/brand)
    + แทน `/* ignore */` ด้วย `console.error` log
    **Lesson:** ตรวจ column name ใน INSERT กับ `\d <table>` ก่อน merge ทุกครั้ง;
    อย่า silent-catch DB errors — log ขั้นต่ำไว้เสมอ

75. **`media-recorder.js` ไม่ decrypt camera credentials — RTSP URL มี `enc:v1:` ถูก URL-encode** — 2026-06-02:
    เมื่อ SEC-014 เข้ารหัส credentials ใน `cameras-config.json` มีการเพิ่ม `decryptCamCreds`
    ใน mqtt-subscriber, hikvision-isapi, dahua-cgi, api-server แต่ **ลืม media-recorder.js**
    ผล: `buildRtspUrl()` ทำ `encodeURIComponent(cred.password)` กับ string `enc:v1:...`
    → ffmpeg ได้รับ URL `rtsp://admin:enc%3Av1%3A...@ip/...` → 401 Unauthorized ทุก clip
    อาการ: `[rec] Error opening input: Server returned 401 Unauthorized`; clip_capture พัง
    ทุก vendor (Bosch/Hikvision/Dahua) ตั้งแต่ migration วัน SEC-014
    **Root cause:** เมื่อเพิ่ม at-rest encryption ต้อง enumerate ทุก consumer ของ
    `cameras-config.json` ไม่ใช่เฉพาะ ingester; media-recorder เป็น consumer ที่ 5
    **Fix (2026-06-02):** เพิ่ม `const { decryptCamCreds } = require('./crypto-creds')`
    + `decryptCamCreds(c)` ใน `loadCreds()` ของ media-recorder.js
    **Lesson:** ทุกครั้งที่เพิ่ม crypto layer ให้ grep หา **ทุกไฟล์** ที่อ่าน config นั้น
    ก่อน ship: `grep -r "cameras-config\|credMap\|loadCreds" src/`

76. **Pause offline camera → unpause → กล้อง flash "online" แล้ว offline อีกครั้ง** — 2026-06-02:
    `PATCH /api/cameras/:id/pause` เดิม stamp `last_seen_at=NOW()` ทุกครั้งที่ unpause
    (เพื่อป้องกัน watchdog alert ช่วง reconnect) แต่ถ้ากล้องเป็น **offline ก่อน pause**
    ผล: watchdog tick ถัดไป (30s) เห็น last_seen=NOW() → isOnline=true → log "heartbeat restored"
    → 90s ต่อมา heartbeat timeout → log "heartbeat timeout" + LINE alert = churn 2 entries
    **Root cause:** stamp แบบ unconditional ไม่ตรวจ pre-pause state
    **Fix (2026-06-02):** ใช้ `RETURNING enabled` จาก UPDATE (atomic, ไม่มี race กับ watchdog)
    → stamp เฉพาะเมื่อ `wasOnline=true` (camera เคย online ตอน pause)
    **Lesson:** `cameras.enabled` เป็น heartbeat state (watchdog-managed) ไม่ใช่ user toggle;
    ใช้เป็น "ถ่ายภาพ" state ตอน pause ได้เพราะ watchdog skip paused cameras ทำให้ค่า freeze

---

77. **`docker cp` ล้มเหลวบน host นี้ — ใช้ base64 pipe แทน** — 2026-06-02:
    `docker cp` ไปยัง vigil-postgres fail ด้วย "not a directory" เพราะ container ถูกสร้างตอน
    project path เดิม (`bosch-mqtt-dashboard`) และมี bind mount `/host_mnt/Users/dojojin/bosch-mqtt-dashboard/db/init.sql`
    ที่ path ไม่มีแล้ว Docker Desktop ยัง track bind mount นั้นอยู่และ fail ที่ overlay check.
    **Workaround:** ใช้ base64 pipe ผ่าน `docker exec`:
    ```bash
    B64=$(base64 < file.txt)
    docker exec vigil-postgres sh -c "echo '$B64' | base64 -d > /target/path/file.txt"
    ```
    **Fix恒久:** `docker compose down && docker compose up -d` สร้าง container ใหม่
    (volume `vigil_postgres_data` ยังอยู่ — data ไม่หาย; `init.sql` ไม่ถูก re-run กับ volume ที่มีอยู่แล้ว).
    เมื่อนั้น `docker cp` จะทำงานปกติอีกครั้ง. ดู decision #195.

---

78. **api-server Stop/Start = self-destruction — ห้ามเปิด UI บน substrate ของตัวเอง** — 2026-06-03:
    Service Management UI Phase 2 มีปุ่ม Stop สำหรับทุก service รวมถึง api-server ในตอนแรก
    **อันตราย:** กด Stop api-server → process ตาย → dashboard ไม่มี HTTP server → ปุ่ม Start
    ที่ควรกู้คืนอยู่ใน dashboard ที่ตายไปแล้ว → recovery ต้องใช้ CLI เท่านั้น
    `concurrently -k` ก็มีปัญหาเดียวกัน: SIGTERM ตัวใดตัวหนึ่ง → kill ทุกตัวรวม api-server
    **Pattern นี้เรียกว่า "substrate control"** — ห้ามให้ระบบควบคุมสิ่งที่ตัวเองรันอยู่บน:
    api-server = substrate ของ dashboard; PostgreSQL/EMQX = substrate ของ api-server
    **Fix:** api-server → Restart เท่านั้น (PM2 restart = daemon restart, response drop แล้ว reconnect);
    Stop/Start rejected ทั้ง UI (`canStop/canStart = name !== 'api-server'`) และ server-side (400);
    PostgreSQL/EMQX อยู่นอก scope ทั้งหมด — ใช้ `restart: unless-stopped` ใน compose แทน
    **Lesson:** ทุกครั้งที่ออกแบบ control panel → ถามก่อนว่า "ถ้า stop X แล้วปุ่ม Start อยู่ที่ไหน?"
    ถ้าอยู่ใน process ที่กำลัง stop → นั่นคือ substrate control → ห้ามทำหรือ restrict เป็น restart-only
    ดู decision #199.

---

79. **`img` error event ไม่ bubble — ต้องใช้ capture phase** — 2026-06-05:
    `onerror=` attribute บน `<img>` โดน CSP `script-src-attr` block เมื่อ set via innerHTML
    แก้ด้วย `window.addEventListener('error', handler, **true**)` (argument ที่ 3 = useCapture)
    **เหตุผลที่ต้อง capture:** `error` event จาก `<img>` ไม่ bubble ขึ้น DOM tree — ถ้าใช้ bubbling
    (`false`) event จะไม่มีวันถึง `window` เลย; capture phase ดัก event ขาลงได้ก่อน target
    Pattern: เพิ่ม `data-err="vocab"` บน img element แทน inline handler; handler เดียวที่ root
    ตรวจ `e.target.tagName === 'IMG' && e.target.dataset.err` แล้ว switch ตาม vocab
    **Vocab ปัจจุบัน:** `hide` · `dim` · `cam-placeholder` · `cam-span` · `face-noimg` · `no-img`
    ดู decision #205 · commit `93b1c22`

---

80. **CSP `img-src` wildcard ไม่ match bare hostname** — 2026-06-05:
    `https://*.tile.openstreetmap.org` ใน CSP **ไม่ match** `https://tile.openstreetmap.org`
    (bare host ไม่มี subdomain) — ต้องใส่ทั้งสองรูปแบบแยกกัน:
    `img-src ... https://tile.openstreetmap.org https://*.tile.openstreetmap.org`
    กฎเดียวกันใช้กับทุก domain ใน CSP: `*.example.com` = subdomain เท่านั้น ไม่รวม `example.com`
    ตรวจสอบได้ใน `pm2 logs api-server | grep CSP-REPORT` — จะเห็น `img-src blocked=https://tile...`
    ดู decision #207 (context: OSM tile) · commit `93b1c22`

81. **EMQX docker-compose port-bind แก้แล้ว แต่ camera ยัง connect ไม่ได้ — ต้อง `--force-recreate`** — 2026-06-05:
    `docker-compose.yml` ระบุ dual-bind `127.0.0.1:1883` + `192.168.10.31:1883` ถูกต้อง แต่ถ้า container
    ถูก create ก่อนที่จะเพิ่ม binding นั้น — `docker compose up -d` จะ skip recreate (image unchanged,
    config diff ไม่ trigger restart ในทุก version). ผล: EMQX bind แค่ `127.0.0.1:1883` → camera ใน LAN
    publish ไม่ได้ → ไม่มี events. วิธีแก้: `docker compose up -d --force-recreate emqx`.
    **ประเด็นที่ทำให้หาไม่เจอนาน:** dashboard แสดงกล้อง "Online" เพราะ `last_seen_at` อัปเดตจาก
    ONVIF recording-status poll (HTTP SOAP) ซึ่งไปคนละ path กับ MQTT — poll สำเร็จ = Online, แต่
    MQTT ล้มเหลวเงียบๆ อยู่ข้างหลัง. เพราะฉะนั้น "Online + ไม่มี events" = ตรวจ EMQX binding ก่อน.
    ทดสอบ MQTT ได้ด้วย: `docker exec vigil-emqx emqx_ctl clients list | grep cam-bosch`
    **หมายเหตุ 2026-06-07:** dual-bind `127.0.0.1:1883` + `192.168.10.31:1883` ถูกแก้เป็น
    `"1883:1883"` (all-interfaces) แล้ว — GOTCHAS #50 Phase 3. `--force-recreate` ยังใช้ได้
    แต่ตรวจ AUTHN credentials ด้วย (`emqx_ctl authn user_id cam-<id>`).

87. **Hikvision face gender/age มีอคติไปทาง female — ใช้เป็น soft filter เท่านั้น** — 2026-06-12:
    เจ้าของสังเกตว่าหน้า Faces "ส่วนมากเป็นผู้หญิง" → ตรวจจริง: distribution
    female 87% (673/776) และ**กรองเฉพาะ faceScore ≥70 ยิ่งเอียง** (89%) = ไม่ใช่
    noise จากภาพเบลอ. พิสูจน์ด้วยตา: สุ่ม 6 รูป label female score ≥60 →
    **อย่างน้อย 2 เป็นผู้ชายชัดเจน** (~1/3 ของ label female ผิด). pipeline เรา
    เก็บค่าตรงจาก XML คำต่อคำ — เป็น classifier ของกล้อง + มุมติดตั้งสูงกดลง
    (ทุกรูปหน้าก้ม) ซึ่งโมเดล attribute แม่นต่ำ. `faceScore` = คุณภาพการจับหน้า
    **ไม่ใช่** ความมั่นใจ attribute — กรองด้วย score ไม่ช่วย (พิสูจน์แล้ว).
    **Lesson:** gender/age จาก Hikvision = soft filter — ค้น forensic อย่าใช้เพศ
    เป็นเงื่อนไขชี้ขาด (ผู้ชายจำนวนมากถูก label หญิง; appearances จาก AP.1 ติด
    อคตินี้มาด้วย). แก้เชิงกายภาพทางเดียว: ลดมุมก้มของกล้อง/ติดระดับใกล้สายตา
    แล้ววัด distribution ซ้ำ. age ก็โมเดลเดียวกัน — เผื่อใจ ±10 ปี.

86. **Dwell semantics ต่างกันทุก vendor — Dahua เป็น per-object ไม่ใช่ zone-state, โซนพลุกพล่านตัวเลขเพี้ยน** — 2026-06-12:
    pairing ของ `/api/stats/dwell` (LEAD true→false ต่อ camera+rule) ออกแบบจาก semantics
    ของ Bosch: กล้องส่ง **สถานะโซน** (true=มีคน, false=ว่าง) → คู่ถูกไม่ว่ากี่คน.
    **Dahua ยิง Enter/Leave ต่อ "คนรายตัว"** (ทุก event มี `Object.ObjectID`) → หลายคน
    ซ้อนในโซน = ลำดับ `t,t,f,f,f` (เห็นจริง: Leave ติดกัน 5) → LEAD จับ "Enter คน
    หลังสุด→Leave คนแรกสุด" = ตัวเลขมั่ว. ซ้ำสอง: (1) dedup key เดิม `camera|code`
    กลืน Enter ของคนละคนที่มาห่าง <3 วิ → Leave กำพร้า — **แก้แล้ว**: ObjectID+Direction
    เข้า dedup key (2) tracker เปลี่ยน ID กลางทางได้ (เข้า 310 → ออกเป็น 311) →
    per-object pairing ก็ไม่ 100%.
    **Lesson:** dwell เชื่อถือได้เฉพาะ**โซน single-occupancy** (ตู้เย็น/ห้องเก็บของ);
    โซนทางเดิน = ใช้ People Counting แทน. สรุป: Bosch = zone-state (แม่นสุด) ·
    Dahua = per-object (แม่นเมื่อทีละคน) · Hikvision = alarm-cycle floor ~7s (#85).
    dwell alert (migration 044) ตั้ง threshold เฉพาะ rule โซนทีละคนเท่านั้น.

85. **Hikvision dwell time มี floor ~7 วินาที — firmware ถือ alarm ค้างก่อนส่ง inactive** — 2026-06-12:
    fielddetection (Intrusion) ของ HIKVISION_CAM01 ยิง `eventState=active` **ครั้งเดียว**ต่อ
    episode (`activePostCount=1` ทุกแถว — ไม่ re-post รายวินาที) แล้วถือ alarm state ค้าง
    ~6 วิ + timeThreshold ก่อนส่ง `inactive`. ผล: dwell pair (true→false, commit `24d1f5d`)
    ของคนเดินตัดโซนเร็ว (~1-3 วิจริง) ถูกปัดมากองที่ ~7 วิเท่ากันหมด — เห็นจาก distribution
    วันแรก: 7s ×15, 8-12s ×7, 23s ×1 (คนอยู่นานจริงค่างอกตามจริง).
    **Lesson:** dwell ของ Hik = ค่าจริง + floor ~7s — ใช้กับ threshold "อยู่นานผิดปกติ"
    (≥60s) ได้ปกติ แต่**ห้ามเทียบ transit สั้นข้าม vendor** (Bosch/Dahua ส่ง state เปลี่ยน
    คมกว่า ไม่มี hold). `endTriggerTime` ตั้ง 500ms อยู่แล้ว — hold นี้เป็นพฤติกรรม firmware
    ปรับจาก config ไม่ได้. ไม่หักลบใน analytics (ซับซ้อนเกินคุณค่า) — รู้ไว้ตอนอ่านตัวเลขพอ.

84. ⚪ **[ไม่มีผลกับ central แล้ว — ย้ายไป Linux 2026-07-23 · และเครื่อง MacBook ถูกขายไปแล้ว 2026-07-31 จึงไม่มีเครื่องที่อาการนี้เกิดได้อีก — เก็บไว้เป็นบทเรียนถ้าวันหน้ากลับไปใช้ macOS]** สคริปต์เปลี่ยนชื่อเป็น `scripts/pm2-lan-safe-restart-mac.command` (2026-07-27); บน Linux ใช้ `pm2 restart all` ได้ตามปกติ. เก็บบันทึกไว้เผื่อกลับไปใช้ MacBook — **macOS Local Network Privacy (LNP) บล็อก third-party binary จาก camera subnet — root cause จริงของ #82/#83** — 2026-06-10:
    macOS เก็บ Local Network permission เป็น per-binary / per-app record ใน
    `/Library/Preferences/com.apple.networkextension.plist`. process ที่ binary ไม่มี record
    **และ** responsible app (Terminal/iTerm/launchd/tmux ที่เป็นต้นทาง spawn) ไม่มี grant
    → unicast ไป secondary-NIC subnet (en17) ถูกปัดเงียบเป็น `EHOSTUNREACH` / `No route to host`
    โดย **ไม่มี prompt** (background context ไม่ trigger dialog).
    **Evidence matrix (ทดสอบจริง จาก shell เดียวกัน):** curl/nc (Apple binary, exempt) ✅ ·
    node@20 (มี binary record ใน plist) ✅ · node@22 + ffmpeg 8.1.1 (ไม่มี record) ❌ ·
    ffmpeg → en0 subnet ✅ (default-route subnet ไม่โดน gate แบบเดียวกัน).
    **แก้ความเข้าใจเดิม:** "node v20 vs v22" ใน #83 คือความต่างของ LNP record ไม่ใช่ libuv;
    "TCC ruled out" ใน #82 สรุปผิดเพราะใช้ curl (exempt) เป็น control.
    **Incident จริง:** media-recorder (ffmpeg) เข้า RTSP ไม่ได้ ~17 ชม. (9 มิ.ย. 09:00 → 10 มิ.ย. 03:00)
    — media-buffer ว่าง = clip capture หายเงียบทั้งวัน, error log โต ~72k บรรทัด (44MB)
    เพราะ restart loop คงที่ 5s ไม่มี backoff.
    **Fix (primary, 2026-06-10):** restart PM2 ใต้ `scripts/VigilPM2.app` — app ถือ
    Local Network grant ของตัวเอง (พิสูจน์เทียบ control ที่ยังโดน block + รอด
    nehelper/mDNSResponder state reload) → ลูกทุกตัวสืบ grant ไม่ขึ้นกับ binary path:
    ```
    open scripts/VigilPM2.app          # manual restart (เงียบ ไม่มีหน้าต่าง, log ที่ /tmp/vigilpm2.log)
    ```
    `pm2.dojojin.plist` ชี้ app นี้แล้ว (boot path ทดสอบ end-to-end 2026-06-10).
    **Fallback** ถ้า app เสีย grant (เช่นหลัง macOS update): `open -a Terminal
    scripts/pm2-lan-safe-restart.command` (Terminal.app มี record ถาวรใน networkextension.plist).
    **กับดักซ้ำ:** (1) restart PM2 จาก tmux / ssh / Claude shell ตรงๆ = เสีย grant เงียบๆ —
    ใช้ app เสมอ (2) `brew upgrade ffmpeg|node` เปลี่ยน Cellar path → per-binary record หาย
    (app wrapper ไม่กระทบ แต่ pin ไว้แล้วกันเหนียว) (3) หลัง reboot จริงครั้งแรก ให้ดู
    `media_buffer` ใน health ยืนยันว่า grant ของ app คงอยู่ (LNP store ของ unsigned app
    อ่านตรงไม่ได้ — ยืนยันได้จากพฤติกรรมเท่านั้น).
    **Diagnostic:** `sudo defaults read /Library/Preferences/com.apple.networkextension.plist | grep -i <binary>`
    **Detection:** `/api/health/details` → `media_buffer[].newest_segment_sec` (ค่าสูงผิดปกติ = recorder wedged)
    **Production Linux:** ไม่มี LNP — ปัญหานี้เป็น macOS-only.
    **เพิ่มเติม 2026-07-22 (ชี้แจงให้ชัด ไม่ใช่ทุก `pm2 restart` เข้าเงื่อนไขนี้):** เงื่อนไขที่ต้องผ่าน
    Terminal.app/VigilPM2.app คือ **daemon ต้อง (re)start ใหม่** เท่านั้น (`pm2 kill && pm2 resurrect`,
    หรือ `pm2 start ecosystem.config.js` รอบแรกหลัง `pm2 kill`) — grant ผูกกับ context ของ daemon process.
    ส่วน `pm2 restart <app-name>` **ตัวเดียว** (RPC สั่ง daemon ที่ **รันอยู่แล้ว** ให้ respawn แค่ child
    process นั้น โดย daemon เองไม่ได้ restart) **ไม่ต้อง** ผ่าน Terminal.app — ยิงจาก Claude/ssh/tmux shell
    ตรงๆ ได้ปลอดภัย (ยืนยันแล้ว: `pm2 restart lpr-receiver` จาก Claude shell ตรงๆ เพื่อ narrow bind
    `LPR_BIND_HOST`, ทำงานถูกต้อง ไม่เสีย grant — เพราะ `lpr-receiver` เองก็ไม่ใช่ process ที่เชื่อมกล้องเลย).

83. **Node.js v22 (libuv 1.52) EHOSTUNREACH บน secondary-NIC route หลัง LAN re-plug บน macOS** — 2026-06-09:
    ⚠️ **superseded by #84 (2026-06-10)** — root cause จริงคือ macOS LNP per-binary record ไม่ใช่ libuv;
    interpreter pin node@20 ยังใช้ได้เพราะ node@20 **มี** LNP record อยู่แล้ว (ไม่ใช่เพราะ libuv version).
    **Update 2026-06-10 (A1+A6):** ทั้ง 7 apps ย้ายเป็น node@24 LTS แล้ว — `interpreter` อยู่ใน `base`
    ของ ecosystem.config.js; reachability มาจาก VigilPM2.app grant (#84) ไม่ใช่ตัว runtime.
    กล้อง Hikvision/Dahua ต้องการ connect ผ่าน en17 (192.168.10.x) ซึ่งเป็น secondary interface — ไม่ใช่ default
    route (en0). Node.js v22 ด้วย libuv 1.52 fail ด้วย `connect EHOSTUNREACH` ไปยังทุก host บน
    en17 subnet หลังจาก interface ถูก unplug แล้วเสียบใหม่ ทั้งที่ `ping` / `nc` / `curl` / Node.js v20
    เชื่อมได้ปกติ. root cause อยู่ใน libuv ระดับ OS-socket-layer บน macOS — ยังไม่ได้ filed เป็น upstream bug.
    **Symptom:** `EHOSTUNREACH` ทุก 30s ใน hikvision/dahua error log แม้ network ดี; `pm2 restart` ไม่ช่วย;
    fresh `node` (v20) จาก terminal เชื่อมได้.
    **Fix (ecosystem.config.js):**
    ```js
    interpreter: '/opt/homebrew/opt/node@20/bin/node',  // api-server, hikvision, dahua entries
    ```
    แล้ว `pm2 delete <app> && pm2 start ecosystem.config.js --only <app> && pm2 save`
    (ต้องใช้ delete+start ไม่ใช่ restart — restart ไม่ re-read interpreter จาก config).
    **Scope:** hikvision/dahua (continuous polling) + api-server (snapshot-probe admin endpoint).
    media-recorder, mqtt-subscriber, report-worker, alert-worker ไม่ทำ node-level TCP ไปยัง camera IP.
    **Production Linux:** ปัญหานี้ไม่มี — Linux ไม่มี TCC และ libuv routing behavior ต่างกัน.

82. **PM2 daemon เริ่มโดย launchd → child process ไม่มี macOS Local Network TCC permission** — 2026-06-05:
    ⚠️ **ทฤษฎีนี้ถูกตั้งแต่แรก — ดู #84 (2026-06-10)** กลไกจริงคือ macOS Local Network Privacy.
    หมายเหตุ forensic: บันทึก "RULED OUT" เมื่อ 2026-06-09 เป็นการสรุปผิด เพราะใช้ curl เป็น control
    ซึ่งเป็น Apple platform binary ที่ exempt จาก LNP. `pm2 kill && resurrect` จาก Terminal ใช้ได้จริง
    เพราะลูกสืบ grant ของ Terminal.app — ตรงตามทฤษฎีเดิมของ entry นี้.
    --- บันทึกต้นฉบับ (historical) ---
    เมื่อ PM2 daemon ถูกเริ่มโดย launchd (จาก `~/Library/LaunchAgents/pm2.dojojin.plist`) child processes
    ทั้งหมดที่ PM2 spawn (api-server, mqtt-subscriber ฯลฯ) inherit TCC context ของ launchd ซึ่งไม่มี
    Local Network permission. ผล: `EHOSTUNREACH` ทุก HTTP connection ไป camera IP แม้ terminal node/curl
    ถึงได้ปกติ. `sd_status=unreachable` + `has_snapshot=false` บน detection events ทุกตัว.
    ยืนยันด้วย: nohup node (Terminal-spawned) → REACH; pm2 start test.js → EHOSTUNREACH.
    **Real fix:** ดู #83 — interpreter: node@20 ใน ecosystem.config.js
    **Production Linux:** ปัญหานี้ไม่มี — Linux ไม่มี TCC system, launchd-parented process เข้าถึง LAN ได้ปกติ.

88. **Puppeteer `addStyleTag({content})` + CSP `style-src-elem 'self'` → "Could not load style" / HTTP 500** — 2026-06-14:
    เมื่อ Puppeteer โหลดหน้าด้วย `page.goto()` เซิร์ฟเวอร์ส่ง CSP header จริง (ต่างจาก `page.setContent()`
    ที่ใช้ `about:blank` ซึ่ง CSP ไม่มีผล). `addStyleTag({content: '...'})` สร้าง inline `<style>`
    element — ถูกบล็อกโดย `style-src-elem 'self'` ที่ล็อค style element ให้โหลดจาก same-origin
    file เท่านั้น (ต้องการ `'unsafe-inline'` จึงจะผ่าน). Puppeteer throws "Could not load style"
    → ถูก catch → HTTP 500 `{error:'Internal server error'}`.
    **Root cause chain:** commit `17486cd` (2026-06-10) เพิ่ม `style-src-elem 'self'` → missed
    the `addStyleTag({content})` call ใน `renderReportPdf()` ซึ่งยิง `page.goto()`.
    (Entry `renderHealthReportPdf()` ใช้ `page.setContent()` — ไม่โดน CSP จึงยังทำงาน.)
    **Evidence:** `api-server-out.log` → `[CSP-REPORT] directive=style-src-elem blocked=inline`
    แล้ว `📅 /api/reports/pdf failed: Could not load style`.
    **Fix:** แยก style ออกเป็นไฟล์ `dashboard/report-print-override.css`; เปลี่ยนเป็น
    `addStyleTag({url: \`${baseUrl}/report-print-override.css\`})` — สร้าง `<link>` ซึ่งผ่าน
    `style-src-elem 'self'` ได้. Puppeteer ส่ง `X-Internal-Token` ผ่าน `setExtraHTTPHeaders`
    (ใช้กับทุก request บนหน้า รวม subresource) ดังนั้น CSS ผ่าน auth gate ได้.
    **Lesson:** ทุกครั้งที่ตั้ง CSP `style-src-elem` ให้ grep `addStyleTag` ใน `report-renderer.js`
    — `{content}` form ต้อง `'unsafe-inline'`; `{url}` form ไม่ต้องการ. `page.setContent()` ≠
    `page.goto()` ในแง่ CSP enforcement.

89. **`ignore_event_types` suppress ใน mqtt-subscriber ไม่ทำงาน — TDZ ReferenceError ถูก catch กลืนทิ้ง** — 2026-06-16:
    per-camera suppress ไม่มีผลแม้ตั้งค่าใน UI แล้ว (ยืนยันใน DB + cameras-config.json) เพราะใน
    `processMessage()` ตัวแปร `eventType` ถูกใช้ในบล็อก suppress ที่บรรทัด 445 ก่อนที่จะมี
    `let eventType = subParts.join('/')` ที่บรรทัด 458 — JavaScript TDZ (Temporal Dead Zone)
    ทำให้ throw `ReferenceError` ทันที บล็อก suppress ไม่ complete → `return` ไม่ถูกเรียก →
    event เข้า DB ตามปกติ. Error ถูก try/catch ของ `processMessage()` กลืนทิ้ง ไม่มี log ปรากฏ.
    **Root cause chain:** suppress block ถูกย้ายขึ้นใน diff ก่อนหน้าโดยไม่ย้าย `let eventType`
    ตามไปด้วย → ลำดับ declare/use กลับหัว.
    **Symptom ที่ทำให้หาไม่เจอ:** เมื่อ `ignore_event_types: []` (ยังไม่ตั้งค่า) → condition
    `camIgnore.length > 0` = false → suppress block ไม่ run → TDZ ไม่ถูก trigger เลย → ดูเหมือน
    ทำงานปกติ. Bug โผล่ครั้งแรกหลังจาก user ตั้งค่า non-empty ครั้งแรก.
    **Evidence:** `SELECT event_type, event_time FROM events WHERE camera_id='BOSCH_8100iX_02' ORDER BY event_time DESC` — GlobalSceneChange เข้าต่อเนื่องหลัง restart. `node -e` ทดสอบยืนยัน TDZ throw.
    **Fix (commit `00b5f21`):** ย้าย `let eventType`, `eventTimeDate`, `eventTime`, `videoSource`,
    `ruleName` ทั้งหมดขึ้นมาก่อน suppress block — suppress check อยู่หลัง declare แล้ว.
    **Lesson:** `let`/`const` ใน JavaScript ไม่ hoist value (ต่างจาก `var`) — ถ้า declare หลัง
    control-flow guard ที่ใช้ตัวแปรนั้น = TDZ throw ทุกครั้ง. อย่าเชื่อว่า "ไม่มี log = ไม่มี error";
    try/catch ที่กว้างเกินไปกลืน ReferenceError ได้โดยไม่ warning. ทุกครั้งที่ย้าย suppress/guard
    block ขึ้นใน function ให้ grep `let`/`const` ที่ block นั้นใช้และย้ายไปด้วย.

---

90. **🔕 bell-slash emoji ห้ามแทนด้วย SVG — มี semantic meaning เป็น "mute/unsubscribe"** — `🔕` ใช้เป็น label ใน notification toggle ที่ user รับรู้ว่า = "ปิดเสียง/ยกเลิกรับการแจ้งเตือน"; ถ้าแทนด้วย SVG icon ที่ออกแบบเอง จะสื่อความหมายต่างออกไปหรือไม่ชัดเจนในบริบท LINE notification. Working Agreement #2-C ยกเว้น semantic label ประเภทนี้ออกจากกฎ no-emoji-as-UI. **Lesson:** ก่อนแทน emoji ด้วย SVG ต้องถามว่า emoji นั้นมี semantic ในตัวที่ Unicode standard กำหนดหรือเปล่า — ถ้าใช่ ให้ grandfathered ไว้.

91. **colorDot CSS injection ผ่าน color value จาก DB** — 2026-06-17: `openFaceMatchModal` สร้าง `<span style="background:${color}">` โดยใช้ color value ดิบจาก `raw_json.jacketColor` (Hikvision) โดยตรง — ถ้า DB row ถูก tamper ให้มี CSS payload เช่น `red;animation:...` CSS injection เข้า DOM ได้.
    **Fix (commit `588b062`):** `const safe = String(color).replace(/[^a-zA-Z0-9#]/g, '');` ก่อน interpolate เข้า style attribute. Pattern นี้ใช้กับทุก DB-sourced value ที่เข้า CSS property.
    **Lesson:** `escapeHtml()` ป้องกัน HTML injection แต่ **ไม่ป้องกัน CSS injection** ใน `style="..."` attribute — ต้องมี allowlist/sanitize แยกต่างหากสำหรับค่าที่ interpolate เข้า CSS property (color, background, border-color ฯลฯ).

92. **`LIKE '%Recognition%'` กลืน FaceRecognition เข้า LPR tab** — 2026-06-19: Events tab "ป้ายทะเบียน" filter เดิม `event_type LIKE '%Recognition%' OR = 'anprAlarm'` — substring `Recognition` ดัน **FaceRecognition (383 แถว)** เข้า tab ป้ายทะเบียนปนกับ anprAlarm. ผู้ใช้สังเกตเห็นภาพใบหน้าโผล่ในรายการป้าย.
    **Fix (commit `03c894b`):** `event_type = 'anprAlarm'` ตรงตัว.
    **Lesson:** อย่าใช้ substring `LIKE` จำแนก `event_type` — Hikvision/Bosch มี type ที่ชื่อซ้อนคำกัน (`FaceRecognition` vs `Recognition/LicensePlate`); ใช้ `=` หรือ allowlist เสมอ. การจำแนกชนิด event ควรอยู่ใน registry เดียว (`dashboard/event-domains.js`) ไม่ใช่กระจาย LIKE หลายที่.

93. **LPR/event ความถี่สูงกลบ feed ทั่วไป** — 2026-06-19: Events (Live) "ทั้งหมด" รวมทุก event → กล้อง LPR ส่ง anprAlarm ต่อเนื่องเป็น burst จน **200 แถวล่าสุด = anprAlarm 100%** (reproduce ด้วย SQL) — operator เลื่อนดูเห็นแต่ป้าย ไม่เห็น intrusion/tamper/line-crossing เลย. Live monitor กลายเป็น plate ticker.
    **Fix (commit `1b4fa77`):** หมวด high-frequency ที่มีหน้าเฉพาะ (LPR/Face) ตัดออกจาก generic feed ผ่าน `specializedEventTypes()` (registry-driven) → `/api/events?exclude_types=` + Snapshot ใช้ helper เดียวกัน.
    **Lesson:** feed รวมเรียลไทม์ต้องระวัง source ความถี่สูงกลบ source สำคัญแต่ความถี่ต่ำ — แยกหมวดที่ volume สูง+มีหน้าเฉพาะออก. ก่อนตัดสิน "เก็บไว้/ตัดออก" ให้ reproduce สัดส่วนจริงใน window ล่าสุด (ไม่ใช่ total ทั้งหมด — total อาจดูสมดุลแต่ recent อาจ monopolize).

94. **cloudflared เป็น TOKEN-MANAGED → `~/.cloudflared/config.yml` ถูกเมินทั้งหมด** — 2026-06-21: ตอน CS7 cutover แก้ `config.yml` เพิ่ม path-route `/lpr`→:3003 + swap + `sudo launchctl kickstart -k system/com.cloudflare.cloudflared` → **ไม่มีผลเลย** (no-op). repro ชี้ขาด: `POST /lpr` ผ่าน tunnel → log `[lpr] push missing multipart boundary` โผล่ที่ **api-server-error.log ไม่ใช่ lpr-receiver** = /lpr ยังเข้า :3000. **Root cause:** service รันด้วย `cloudflared tunnel run --token eyJ...` (ดู `ps -o command -p $(pgrep -f cloudflared)`) = **remotely-managed** → ingress config อยู่ใน **Cloudflare Zero Trust dashboard** (Networks→Tunnels→`macbook-ssh`→Public Hostname) ไม่ใช่ไฟล์ local. ไฟล์ config.yml ที่มีอยู่เป็น vestigial (บังเอิญ mirror ของ dashboard) — `cloudflared tunnel --config FILE ingress rule URL` อ่านไฟล์ได้ก็จริงแต่ **ไม่สะท้อนของที่ tunnel รันจริง**. **Fix (DONE + verified 2026-06-21):** tunnel จริง = **`bosch-cctv-mac`** (ID `648a1cd5-…`; ชื่อ `macbook-ssh` ใน config.yml = ตัว stale คนละ ID `53ba6a78-…`). One Dash → Networks → Tunnels → `bosch-cctv-mac` → Routes → **+ Add route → Published application**. Path field = **regex unanchored** (ตามกล่อง "How path matching works": `blog` match ทุกที่; `^/api` = prefix; path **รวม `/` นำหน้า**) → ใช้ `^/lpr$` ไม่ใช่ `/lpr` (ไม่งั้น match `/api/lpr`). Service = `http://localhost:3003` (http ไม่ใช่ https). **⚠️ 2 footgun ของ UI ใหม่ (2026.6.0):** (1) route ใหม่ **append ต่อท้ายเสมอ** + **reorder ไม่ได้** (`...` มีแค่ Edit/Delete) → catch-all hostname (no-path) ที่อยู่บน จะคว้า path ก่อน. แก้ลำดับ no-downtime: Add catch-all `dashboard.dojojin.tech`(no path)→:3000 ใหม่ (ไปต่อท้าย) แล้ว Delete ตัวเดิมบนสุด → path-route เลยมาอยู่เหนือ catch-all. (2) **route เดียวคุมหลาย path** ด้วย `^/(lpr$|face-push/)` (RE2 ไม่มี lookahead → ใช้ alternation; คุม /lpr + /face-push/ จบในเส้นเดียว = ไม่ต้อง reorder ซ้ำต่อ path). DNS-record-exists 400 ตอน add route hostname ซ้ำ = **harmless** (DNS ชี้ tunnel อยู่แล้ว). verify: `/api/lpr/stats`=401 + `/`=302 + `POST /lpr`/`POST /face-push/X` ลง log ที่ **lpr-receiver** (ไม่ใช่ api-server). CF push config เอง ไม่ต้อง restart. **Lesson:** ก่อนวางแผน routing cloudflared เช็ค `pgrep -fl cloudflared` ก่อน — เห็น `--token` = remotely-managed, อย่าแตะ config.yml, ไป dashboard. config.yml ถูก revert ด้วย `cp config.yml.bak-precs7 config.yml`.

95. **e2e/Puppeteer harness ที่ mutate ห้ามจับ "row ตัวแรกในลิสต์" — render ดึงของจริงจาก prod DB มาด้วย** — 2026-06-21 (incident จริง, RF2 watchlist): harness เทสต์ group rename/color ของ `_renderWlGroupMgr` ซึ่ง **render ทุก group จาก prod DB รวมของจริง**; harness ดัน `querySelector('input[type=color]')` (ตัวแรก) แล้วยิง PATCH ทดสอบ → **แก้ค่า watchlist group จริง 3 ตัว** (สี + ชื่อ `รถตามหมายจับ`→`GRENAMED`). **Root cause:** harness operate บน element ตัวแรกที่เจอ โดยไม่รู้ว่าเป็น row ของข้อมูลจริง (seed ของ harness ไปอยู่ท้ายลิสต์ ไม่ใช่ตัวแรก). **Fix:** กู้จาก `~/vigil-backups/*.sql.gz` (เทียบ migration 051 seed ด้วย) → `UPDATE ... WHERE id=` คืนค่าเป๊ะ. **กฎ (capture):** harness ที่เขียน DB ต้อง (1) สร้าง row ทดสอบเอง + operate **เฉพาะ `[data-gid="<id-ที่สร้าง>"]`** ไม่ใช่ `:first` / ตัวแรก; หรือ (2) ใช้ `BEGIN…ROLLBACK` / isolated DB. read-only render (gates/vtype) ที่ไม่ operate-ตัวแรก ปลอดภัยอยู่แล้ว — incident เกิดเพราะ "หาตัวแรกแล้ว write". **Lesson:** ถ้า harness ต้อง mutate ผ่าน UI ที่ render ข้อมูลจริง → seed row เฉพาะ + เลือกด้วย id ของ row นั้นเท่านั้น, และ verify ว่า real rows ไม่ถูกแตะหลังเทสต์เสมอ.

96. **ห้ามไล่ลด `font-size` ตาม screenshot เครื่องเดียว — DPI/zoom หลอกตา → ตัวเล็กจนอ่านไม่ออกข้าม OS** — 2026-06-22 (incident จริง, Face Recognition modal redesign): owner ส่ง screenshot จาก Linux (hi-DPI/zoom) บอก "ตัวใหญ่ไป ลดลง" ซ้ำหลายรอบ → ผมไล่ลด `font-size` ของ modal ลงจนเหลือ data-row **8px**, chip **8px**, OSD label **4px**. พอ owner เปิดบน **Windows (DPI ปกติ)** → ตัวอักษร**จิ๋วมองไม่เห็นเลย**. **Root cause:** screenshot บน Linux ที่ device-pixel-ratio/browser-zoom สูง ทำให้ทุกอย่างดู "ใหญ่กว่าจริง" → ตัดสินขนาดจากภาพนั้น = ลดเกินจนต่ำกว่าเกณฑ์อ่านออก (~11-12px). **ไม่ใช่ปัญหาฟอนต์:** dashboard self-host **Noto Sans Thai + Noto Sans** (woff2, weight 400/600/700) ผ่าน `dashboard/vendor/fonts/fonts.css` (`index.html:19-20`) + font stack `'Noto Sans Thai'` มาก่อน Segoe UI → **ทุก OS ใช้ glyph ชุดเดียวกันเป๊ะ** ไม่มี font-substitution; ความต่าง "ใหญ่/เล็ก" มาจาก **display scaling / browser zoom / DPI** ของแต่ละเครื่องล้วนๆ. embed ฟอนต์เพิ่มไม่ช่วย (ทำครบแล้ว). **Fix (revert):** data-row 8→**12px**, chip 8→**11px**/label 9px, section-label 9→**10px**, OSD 4→**9px**; bump `app-media-inset` crop-tag 7→**9px** ด้วย. **กฎ font-size floor (ทุกหน้า, บังคับ):** body/ค่า **≥11-12px** · label/caption **≥9-10px** · **ห้าม `<9px`** (ยกเว้น decorative ที่จงใจ เช่น LPR plaque จังหวัด 8px ที่เลียนป้ายจริง — mark ไว้ในคอมเมนต์). **ตรวจที่ 100% zoom บน Windows เป็น baseline เสมอ** (กลุ่มผู้ใช้หลัก) ไม่ใช่ Linux/Mac ที่ซูม. **Lesson:** ขนาดตัวอักษรเป็น absolute px ที่อ่านออกต้องยึด DPI ปกติของผู้ใช้จริง ไม่ใช่สิ่งที่ตาเห็นใน screenshot (ตา DPI/zoom หลอกได้) — เวลา owner บอก "ลดอีก" ให้ถาม/ยืนยันว่าดูบนเครื่องอะไร zoom เท่าไร ก่อนลงต่ำกว่า floor. ตรวจ regression เร็วด้วย `grep -nE "font-size:[0-8]px" dashboard/index.css dashboard/page-*.js` (flag จุด `<9px`).


97. **NanoMQ built-in bridge ไม่รองรับ WSS → ต้องใช้ Node.js bridge** — NanoMQ v0.24.x มี bridge plugin ในตัว แต่รองรับเฉพาะ `mqtt://` และ `mqtts://` (TCP+TLS) — ไม่รองรับ `wss://` (WebSocket Secure). central EMQX ของโปรเจกต์รับเฉพาะ WSS ผ่าน Cloudflare Tunnel port 443 (TCP MQTT port ไม่ได้ expose) → built-in bridge ต่อไม่ได้เลย.
    **Fix:** `src/edge/bridge.js` — standalone PM2 process (`edge-bridge`) ใช้ `mqtt.js` ที่รองรับ WebSocket natively; subscribe `projects/${SITE_ID}/#` + Bosch `+/onvif-ej/#` จาก NanoMQ local → re-publish ไปยัง `wss://dashboard.dojojin.tech/mqtt`.
    **Lesson:** ก่อนเลือก built-in bridge ของ MQTT broker ใดๆ ตรวจก่อนว่า target URL เป็น `wss://` หรือไม่ — ถ้าใช่ ต้องใช้ Node.js / external client bridge แทน.

98. **CAMERA_SECRET_KEY ต้องตรงกับ central เป๊ะ — decrypt error ไม่บอกสาเหตุชัด** — `src/crypto-creds.js` ใช้ AES-256-GCM decrypt credential ใน `cameras-config.json`; ถ้า CAMERA_SECRET_KEY บน edge box ต่างจาก central แม้ 1 ตัวอักษร → decrypt ล้มเหลวเงียบๆ หรือ throw `bad decrypt` / GCM tag mismatch ที่ log ไม่ระบุว่า key ผิด. symptom: ingester start แล้ว cameras loaded = 0 หรือ `Error: Unsupported state or unable to authenticate data`.
    **Fix:** copy ค่า `CAMERA_SECRET_KEY` จาก `src/.env` ของ central โดยตรง (**ห้าม** generate ใหม่). ทดสอบด้วย `node -e "require('./crypto-creds').decryptIfNeeded(require('fs').readFileSync('cameras-config.json','utf8'))"` ใน `src/`.
    **Lesson:** secret ที่ใช้ encrypt/decrypt ต้องเป็นค่าเดียวกันทุก node ในระบบ — ไม่ generate ใหม่ต่อ deployment.

99. **CONFIG_TOPIC relay loop — `cameras-config.json` เขียนวนซ้ำถ้าไม่ filter** — `_config/cameras` ถูก relay จาก central EMQX → local NanoMQ โดย `edge-bridge` (downlink). `edge-config-agent` รับแล้วเขียน `cameras-config.json` + publish ACK. ถ้า bridge ไม่ filter topic นี้ใน local→remote direction → NanoMQ retain ทำให้ local.on('message') pickup → forward กลับ remote → remote deliver ลงมาอีก → loop ไม่สิ้นสุด. ผล: `cameras-config.json` เขียนซ้ำหลายพัน/วินาที, disk busy, log สแปม.
    **Fix (line 110 ของ `src/edge/bridge.js`):** `if (topic === CONFIG_TOPIC) return;` ใน local message handler — filter ก่อน forward ทุกครั้ง. pattern: downlink-only topic ต้อง filter ออกจาก uplink path เสมอ.
    **Lesson:** ทุก MQTT retain relay ต้องมี loop-break โดยเฉพาะ topic ที่ dual-direction; filter ทิศทาง downlink-only ออกจาก uplink path.

---

100. **dahua ingester crash-loop เมื่อ 0 dahua cameras (edge) — ต่างจาก hikvision ที่อยู่รอดด้วย face-push server** — 2026-06-24 (deploy site `vss`): บน edge ที่ `cameras-config.json` ยังว่าง (`{"cameras":[]}`) ตอน first boot ก่อน central push config → PM2 `dahua` restart วนทุก ~2s (↺ พุ่งจนเกือบชน max_restarts; error log ว่าง = exit เงียบ). **Root cause:** `dahua-cgi.js` `main()` เมื่อ `cams.length===0` → print "waiting" → `watchConfig()` ใช้ `fs.watch(CONFIG_FILE, {persistent:false})` (ไม่ keep event loop) และ EDGE_MODE skip `listenForClipDone()` → ไม่มี handle/timer/ listener ค้าง → event loop ว่าง → `process.exit(0)` → PM2 restart loop. hikvision ไม่เป็นเพราะ ingester มี face-push HTTP server (`FACE_PUSH_BIND:FACE_PUSH_PORT`, :3010) listen ตลอด = keep-alive โดยบังเอิญ. **Workaround (deploy):** อย่า start `dahua` จนกว่า central push cameras (มี dahua ≥1); มีกล้องแล้ว camera stream connection จะ keep loop alive เอง. **Fix (code):** ทำให้ config watcher keep loop alive — `fs.watch(CONFIG_FILE, {persistent:true}, …)` ใน `watchConfig()` (หรือเพิ่ม `setInterval(()=>{}, 1<<30)` เมื่อ `cams.length===0`). ดู `docs/LOGIC_edge-ingester-divergence.md`. **Lesson:** long-running process ที่อาจมี 0 work item ตอน boot ต้องมี keep-alive ของตัวเอง — ห้ามพึ่ง side-effect ของ feature อื่น (เช่น HTTP server ของ hik).

101. **Hik face-recognition (`ingestFaceAlarmEvent` / FAS push) ไม่มี EDGE_MODE guard → recognition event หล่นบน edge** — 2026-06-25 (site `vss`, `Hikvision_FaceReg_C01`): หลังตั้ง Alarm Host ของกล้องชี้มา edge FAS (:3010) สำเร็จ กล้อง push `alarmResult` (face match/unmatch) เข้ามาจริง แต่ทุก event ขึ้น `❌ DB insert face alarm [...]: connect ECONNREFUSED 127.0.0.1:5432`. **Root cause:** `ingestFaceAlarmEvent()` ใน `hikvision-isapi.js` เรียก `pool.query(INSERT INTO events…)` ตรงๆ โดย**ไม่มี `if (EDGE_MODE) publishEdgeEvent()` guard** ต่างจาก path อื่นทุกตัว (faceCapture/region/body) → บน edge ที่ไม่มี Postgres → insert fail → recognition event ไม่ถูก publish ขึ้น NanoMQ → ไม่ bridge ขึ้น central (เงียบหายทั้งที่ push สำเร็จ). **เพิ่มเติม:** กล้องอาจยัง push ไป IP เครื่อง POC เก่า (`FACE_PUSH_BIND` default `192.168.10.31`) ไม่ใช่ edge ปัจจุบัน — เช็ค Alarm Host ในกล้องให้ชี้ edge IP:3010. **Fix:** เพิ่ม EDGE_MODE branch ก่อน `pool.query` → `publishEdgeEvent({…event_type:'FaceRecognition', raw_json:rawJson…})` แล้ว `return`. **Lesson:** ทุก ingest path ที่เขียน DB ต้องมี EDGE_MODE guard ครบ — ตรวจด้วย `grep -n "pool.query" src/ingesters/*.js` เทียบ `if (EDGE_MODE)` ว่าครบทุกจุดตอน port edge. ดู `docs/LOGIC_edge-ingester-divergence.md`.

102. **`edge-config-agent` ทิ้ง detection event ของกล้องที่ไม่อยู่ใน `_cameraMap` แบบเงียบ → Bosch snapshot ไม่ถูก capture** — 2026-06-25 (site `vss`, `BOSCH_3100i`): กล้อง Bosch ส่ง RuleEngine event (FieldDetector/LineDetector) ผ่าน filter แล้ว แต่ snapshot ไม่ถูก capture เลย **ไม่มี log อะไร** — debug ยากมาก. **Root cause:** `_cameraMap` โหลดตอน start (ตอน `cameras-config.json` ยังเป็น stub ว่าง) + rebuild เฉพาะตอน config push; ถ้า process พลาด rebuild (หรือ map กับ disk ไม่ตรง) → `if (!cam || !cam.ip_address) return;` เด้งทิ้ง**เงียบ ไม่ log** → กล้องที่เพิ่ง add/ย้าย broker หล่นหายจนกว่าจะ restart มือ. **Fix:** (1) เปลี่ยน silent return เป็น **log warn** เมื่อเจอ event ของกล้องที่ไม่อยู่ใน map; (2) **self-heal** — reload `_cameraMap` จาก disk (throttle 30s/cam) เมื่อเจอ camera_id ที่ไม่รู้จัก → กล้องใหม่ทำงานได้โดยไม่ต้อง restart. **Lesson:** in-memory cache ที่ rebuild จาก external event เท่านั้น ต้องมี self-heal + ห้าม drop เงียบ — config drift = อาการหายเงียบ debug ไม่ได้ (กระทบตอนเพิ่มกล้อง Phuket/BMA). Bosch snapshot path: `edge-config-agent` capture `snap.jpg` → publish base64 ที่ `{cam}/onvif-ej/Device/snapshot` → bridge → central `saveEdgeSnapshot` link ด้วย timestamp window (Bosch ไม่มี event_id).

103. **`edge-config-agent` retain-skip กลืน live stateful detection → Bosch ObjectsInside/CountAggregation ไม่เคยได้ snapshot** — 2026-06-29 (site `vss`, `BOSCH_3100i`): Events list ขึ้น "—" (ไม่มีรูป) เกือบทั้งหน้าเฉพาะ 3100i ส่วน 8000i/8100i ปกติ. **Root cause:** Bosch publish detector ที่เป็น **สถานะต่อเนื่อง** — `FieldDetector/ObjectsInside` (zone occupancy) + `CountAggregation/Counter` (people count) — เป็น MQTT **retained** message, และ NanoMQ deliver แม้ live publish ด้วย `retain=1` (node mqtt sniff ยืนยัน: ObjectsInside/CountAgg = retain:N/fresh:0; LineDetector/ObjectDetection/IdleObject = momentary ไม่ retained). `edge-config-agent.js` มี guard `if (packet.retain) return;` ที่ตั้งใจกัน **stale replay ตอน reconnect** เท่านั้น แต่ดัน **skip live retained event ด้วย** → ObjectsInside ไม่เคยถึง capture (return ก่อน allowlist). 8000i/8100i ใช้ rule แบบ momentary (crossing/object-detection) เลยไม่โดน — **เป็นเรื่องชนิด VCA rule ไม่ใช่รุ่นกล้อง**. ที่ได้รูป ~13% = บังเอิญตกใน timestamp-window `[-5s,+10s]` ของ event อื่นที่ capture สำเร็จ. **Reproduce:** edge `[edge-snap]` log (capture 0 ครั้งตอน ObjectsInside burst, ตัวแรก 9s หลัง burst จาก IdleObject) + central `no matching event=0` + DB has_snapshot=false ตรง event ในรูปเป๊ะ + node mqtt sniff retain flag. edge capture เองไม่เคย fail (timeout:0 error:0) → ตัด HTTP timeout ออก. **ทางที่ลองแล้วไม่เวิร์ก (commit `49f0464` → revert `dbfb008`):** แยก stale-replay จาก live ด้วย freshness gate `if (packet.retain){ parse UtcTime; if (ageMs>60000) return; }` — **เปราะ เพราะเทียบ `edge Date.now()` กับ `camera UtcTime`**: กล้อง 3100i รันช้ากว่าจริง **~3.5 ชม.** (NTP ไม่ตั้ง — Mac/edge `sntp`/`timedatectl` sync ตรง, กล้องช้า) → ทุก live event `ageMs ≈ 12,000s > 60s` → ถูก skip อยู่ดี = inert no-op. ที่ "ดูเหมือนเวิร์ก" ตอน verify คือ CountAggregation บังเอิญ link เฟรมจาก non-retained event ใกล้ๆ ผ่าน window-match ไม่ใช่ gate ปล่อยผ่าน. **Fix จริง (ทำที่กล้อง):** เปลี่ยน VCA rule ที่ต้องการ snapshot จาก occupancy (`ObjectsInside` "object **inside** field" = retained) → **momentary trigger** (`LineDetector/Crossed` หรือ field "object **enters/leaves** field") — non-retained, ไม่ชน guard, ได้ 1 event + 1 รูปคมชัด/visit, ใช้ path เดียวกับ rule ที่เสถียร 97%. (กรณีจริง: "คนเปิดตู้เย็น" เปลี่ยนเป็น Crossed → รูปเห็นคนเต็มตัว 99% Person.) **CountAggregation คงตัดที่ allowlist** — ป้อน occupancy stats ผ่าน `msg.Data.Count` (`recordOccupancySample` → `/api/stats/occupancy`) ไม่ใช่ snapshot + Events list filter ออกแล้ว (`events.js exclude_types`) → capture ให้ก็เปลือง disk เปล่า. **Lesson:** (1) อย่าแก้ปัญหา retained-snapshot ด้วย freshness gate ที่เทียบ server-now กับ camera-time — เปราะต่อ clock skew; แก้ที่ต้นเหตุ (camera VCA = momentary). (2) ObjectsInside (occupancy state, retained, fire ต่อเนื่องทุก ~100ms) ≠ event ที่ควรถ่ายรูป — visit เดียวได้ 14 event rows; momentary trigger สะอาดกว่าทุกทาง. (3) ObjectsInside ≠ CountAggregation (presence vs count แทนกันไม่ได้) — แต่ occupancy → **Crossed** แทนกันได้ถ้าเป้าหมายแค่ "จับว่ามีคนผ่าน". (4) เจอ event time แปลก → เช็ค camera NTP ก่อน (`Bosch CM → Network → Time`); server เวลาถูกไม่ได้แปลว่ากล้องถูก. **แก้แล้ว 2026-09-07 (`47c5954`)** — `helpers/retainGate.js` แยก replay ออกจาก live ด้วยข้อเท็จจริงฝั่ง edge ล้วน ไม่แตะนาฬิกากล้อง: (1) retained ทุกตัวใน 5 วินาทีแรกหลัง (re)subscribe = replay (`RETAIN_REPLAY_GRACE_MS`) · (2) หลังจากนั้น payload ที่ซ้ำไบต์ต่อไบต์กับข้อความล่าสุดของ topic เดิม = ส่งซ้ำ นอกนั้นถือเป็น state change จริง ปล่อยผ่านไปถ่ายรูป. หลักฐานตอนแก้: กล้อง `BOSCH_3100i_02` วันที่ 2026-09-07 `FieldDetector/ObjectsInside` ได้รูป 1/100 ขณะที่ `LineDetector/Crossed` ได้ 4/4.

104. **Bosch edge event↔snapshot async race → momentary event ค้าง "—" ทั้งที่ capture สำเร็จ** — 2026-06-30 (site `vss`, `BOSCH_3100i`, ต่อจาก #103 หลัง NTP fix): ยังเจอ LineDetector/Crossed บางตัว `has_snapshot=false` แม้ camera clock sync แล้ว (skew 0.7s). **Root cause:** event กับ snapshot เดินคนละ path มาที่ central — **event:** camera→NanoMQ→`edge-bridge`→WSS→`mqtt-subscriber.handleEvent`(insert); **snapshot:** `edge-config-agent`→`{cam}/onvif-ej/Device/snapshot`→`saveEdgeSnapshot`. Bosch ไม่มี event_id → `saveEdgeSnapshot` จับคู่ด้วย **time-window UPDATE** `WHERE event_time BETWEEN snapTs±[-5s,+10s] AND _snapshot_full IS NULL` ที่รัน **ครั้งเดียวตอน snapshot มาถึง**. ถ้า event row ถูก insert **ทีหลัง** UPDATE (เพราะ bridge/WSS ช้ากว่า edge-config-agent path) → UPDATE match 0 (event ยังไม่มี) → event insert ตามมา → ค้าง false ตลอด. เกิดบ่อยตอน **burst** (event หลังๆในชุดมาช้า — repro: trace id 102583 ที่ทุก event ≤102582 ได้รูป แต่ 102583+ ที่ insert หลัง UPDATE หลุดยกชุด). **ไม่ใช่ clock (NTP fix แล้ว) ไม่ใช่ capture fail** (edge timeout:0). **Fix (decision A, `mqtt-subscriber.js`):** central เก็บ `_recentEdgeSnap = Map(cameraId→{file,tsMs})` — `saveEdgeSnapshot` จด snapshot ล่าสุด **ก่อน** match (จดแม้ match 0 row); `handleEvent` หลัง insert ถ้า event ยังไม่มีรูป + cache อยู่ใน window `[-5s,+10s]` → **back-link** ทันที + `pg_notify event_snapshot`. ปิด race ทั้ง 2 ทิศ (event มาก่อน = forward-match เดิม; มาหลัง = back-link). **verify:** burst จริง → log `📸 Edge snapshot (back-link): event X ← file (Δ0.9s)` ยิง 56 ครั้ง, LineDetector 3/3 ได้รูป, CountAgg ที่อยู่นอก 10s ไม่ link (กันเฟรมว่าง). **PDPA:** เก็บแค่ path string — ภาพไม่ขยับจาก edge disk (Tier-2 เดิม). **Lesson:** เมื่อ 2 อย่างที่ต้องจับคู่กันมาคนละ async path + จับคู่ด้วย one-shot query ตอนใดตอนหนึ่งมาถึง = race เสมอ ถ้าอีกฝั่งมาทีหลัง. ต้องจับคู่ **สองทิศ** (ทั้ง A-รอ-B และ B-รอ-A) ผ่าน cache สั้นๆ — อย่าพึ่ง one-shot ทิศเดียว. log เฉพาะเคสที่เห็นผล (momentary) ไม่ใช่ทุก CountAggregation (spam).

105. **LPR search = keyset → ไม่มี "กระโดดหน้า/หน้าสุดท้าย"** — 2026-07-01 (decision #211): `/api/lpr` เปลี่ยนเป็น cursor keyset (`before_time`/`before_id`) เพื่อให้เร็วคงที่ที่ 10M row/เดือน → **โดยตั้งใจไม่รองรับ jump-to-arbitrary-page** (deep OFFSET คือ anti-pattern ที่หลีกเลี่ยง). UI มีแค่ **Prev/Next**; การ "ไปหน้า 1725/หน้าสุดท้าย" ทำไม่ได้ — ใช้ **filter วันที่ "ถึง"** แทน (jump-by-date, index-fast). อย่าเพิ่มปุ่ม last-page. count เป็น **estimate** (`X-Estimated-Count`, EXPLAIN) ไม่ใช่ exact — เป๊ะเมื่อถึงหน้าสุดท้าย (`X-Has-More=0`). `X-Total-Count` ถูกลบ — consumer เก่าที่อ่าน header นี้จาก `/api/lpr` ต้องเปลี่ยนไป `X-Has-More`.
106. **Edge snapshot inventory = advisory เท่านั้น (heartbeat lag)** — 2026-07-01 (decision #214): `edge_status.snapshot_oldest`/`snapshot_dirs` มาจาก heartbeat 60s + prune รายชั่วโมงบน edge → **ไม่ใช่ real-time**; อาจ lag 1-2 นาทีหลัง prune จริง. ใช้ดู "retention ทำงานไหม + เก่าสุดกี่วัน" ได้ **แต่ห้ามใช้ยืนยันว่าไฟล์มี/ไม่มีจริง** (central ไม่รู้ edge disk แบบ live — ภาพอยู่ edge, central มีแค่ path proxy). edge pruner แตะ `snapshots/events/` (Bosch scene) เท่านั้น — **ไม่แตะ `lpr/`** (primary evidence). ตั้ง `EDGE_IMAGE_RETENTION_DAYS` ต่ำเกินไป = ลบ scene ที่ยังต้องใช้ (clamp ≥1, NaN→7).
107. **`enforceRetention()` ยกเว้น anprAlarm แล้ว — LPR มี lifecycle แยก** — 2026-07-01 (decision #213): general retention (`data_retention_days`) เพิ่ม `event_type IS DISTINCT FROM 'anprAlarm'` → **ไม่แตะ LPR row อีกต่อไป**; LPR อยู่ใต้ `lpr_retention_days` (`enforceLprRetention`) **ตัวเดียว** = sole authority. ⚠️ ถ้า `enforceLprRetention` ค้าง/พัง = anprAlarm โตไม่มี backstop (surface metric). ถ้าเพิ่ม event type ใหม่ที่ต้องการ lifecycle แยก → ทำ `enforce*Retention()` แยก **อย่ายัดเข้า general**. ⚠️ **ห้ามตั้ง `lpr_retention_days` เป็นปีจนกว่า P2/2B partitioning จะ live** (240M row flat + batched DELETE = performance cliff).

108. **`plateColor` แยกเป็นคนละแถวในกราฟ + filter พลาดแมตช์เงียบๆ — root cause เป็น device รุ่นใหม่ (DS-TCG405-E) ไม่ใช่บั๊ก parser** — 2026-07-03: owner ส่งภาพกราฟ "สีป้าย" ในหน้า LPR stats เห็น bar `White`/`Color`/`Yellow` (อังกฤษดิบ ไม่แปลไทย) แยกจาก `ป้ายเหลือง (รับจ้าง)`/`ป้ายเขียว`/`ป้ายน้ำเงิน` ทั้งที่ควรเป็นสีเดียวกัน. **Root cause:** `lpr-core.js`'s `parseAnprXml()` อ่าน `<plateColor>` ตรงจาก XML กล้องไม่ normalize เลย — กล้อง 2 รุ่นส่งค่าคนละ casing/token กัน (`white` vs `White`, `colorful` vs `Color`) → `lpr-query.js`'s `GROUP BY color` (case-sensitive) แยกเป็นคนละแถว และ **filter สีป้าย (`plate_color`/`plate_colors`) ก็ exact-match แบบเดียวกัน** → กรอง "ป้ายขาว" (`white`) พลาดรถที่บันทึกเป็น `White` ไปเงียบๆ (พบ 2,065 แถวตอนนั้น) — จุดนี้ร้ายแรงกว่ากราฟเพราะเป็นข้อมูลหายจากมุมมอง user ไม่ใช่แค่ label ผิด. **สืบจนสุดสาย (VPN + ISAPI probe จริง, ไม่เดา):** กล้องต้นตอ (`HKT-ANPR-UVSS1`/`UVSS2`) เป็นคนละ model จากกล้อง LPR ตัวอื่น — `DS-TCG405-E` (fw V5.4.0) เทียบ `iDS-2CD9396-HIS` (fw V5.3.1) ยืนยันผ่าน `GET /ISAPI/System/deviceInfo` ตรงเข้ากล้อง (ต้องต่อ VPN ก่อนถึง reach ได้ — ไม่มี route จาก Mac ปกติ). เทียบ `/ISAPI/System/capabilities` เจอ **`DS-TCG405-E` ไม่รองรับ `isSupportVehicleIllegalType` เลย** (`opt=""` ว่างเปล่า เทียบ 18 ประเภทของรุ่นเดิม) + `isSupportVehicleFaceRecognition=false` — **อธิบายว่าทำไม field `pilotsafebelt`/`uphone`/`helmet`/`smoking` ฯลฯ เป็น `"unknown"` 100% ทุก event ของกล้องรุ่นนี้: ไม่ใช่บั๊ก เป็น hardware capability gap จริง** (แลกมาด้วย `isSupportlicencePlateAuditData=true` ที่รุ่นเดิมไม่มี — สัมพันธ์กับ field `charcolor` พิเศษที่ปรากฏ 94% ของ event รุ่นนี้). **Fix:** เพิ่ม `normalizePlateColor()` ใน `lpr-core.js` (lowercase-fold ทุกค่า + alias `color→colorful`, ยืนยันจาก owner ว่าเป็นหมวดเดียวกัน = ป้ายประมูล จากการดู snapshot จริงหลายใบ) เรียกที่จุด ingest เดียว (`parseAnprXml`) ปิดรอยรั่วให้ทุก consumer (กราฟ/filter/detail/export) พร้อมกัน + migration 079 backfill ของเก่า 2,876 แถว (idempotent). **Verify:** DB query ยืนยัน distribution สะอาดหลัง backfill + **synthetic push test ผ่าน endpoint จริง** (`POST /lpr/:token` ด้วยกล้องทดสอบทิ้ง) ยิง `<plateColor>White</plateColor>` และ `<plateColor>Color</plateColor>` เข้าไปตรงๆ ยืนยันออกมาเป็น `white`/`colorful` ถูกต้องผ่าน ingest path จริง (ไม่ใช่แค่อ่านโค้ด). **Lesson:** (1) field ที่มาจาก vendor XML/enum ตรงๆ โดยไม่ normalize ที่ ingest จุดเดียว จะรั่วไปทุก consumer ที่ query จากมันในที่สุด — normalize ที่ต้นทางเสมอ ไม่ใช่ patch แต่ละจุดที่อ่าน. (2) เจอ field เป็น `"unknown"`/ค่าว่างสม่ำเสมอ 100% ในกล้องบางตัว **ก่อนเดาว่าโค้ด parser พัง ให้ probe `/ISAPI/System/capabilities` ของกล้องจริงก่อน** — อาจเป็นเพราะ hardware/firmware รุ่นนั้นไม่รองรับ feature นั้นเลยจริงๆ (`isSupportXxx=false`/`opt=""`), ยืนยันได้ในไม่กี่นาทีถ้ามี network access. (3) เว็บกล้อง Hikvision LPR ที่ private IP เหล่านี้ไม่มี route จาก Mac ปกติ — ต้องขอ owner ต่อ VPN ก่อนถึง probe ตรงได้.

---

109. **`dotenv.config()` โหลดหลัง require ที่ transitively depend on `process.env` → ตัวแปรค้างค่าเดิมทั้ง process lifetime** — 2026-07-16 (production outage, Hat Yai edge): `src/edge/publisher.js` capture `const EDGE_MODE = process.env.EDGE_MODE==='1'` ที่ module-load time. เมื่อไฟล์ entry (`dahua-cgi.js` หรือ chain ที่ require มันก่อน) require โมดูลนี้ก่อนที่ `dotenv.config()` จะรัน → `EDGE_MODE` freeze เป็น `false` ตลอดอายุ process ไม่ว่า `.env` จะตั้งอะไรไว้จริง → event ทั้งหมดของ Hat Yai edge เดินเข้า local-DB code path แทนที่จะ publish MQTT ไป central (edge ไม่มี DB จริง → event หายเงียบ).
     **Fix (commit `287682b`):** ย้าย `require('dotenv').config()` ให้เป็นบรรทัดแรกสุดก่อน require อื่นทั้งหมดใน entry file.
     **Lesson:** module-level `const X = process.env.Y` (ไม่ใช่ lazy getter) เป็น footgun เสมอเมื่อมี dotenv เกี่ยวข้อง — ต้อง audit ลำดับ require ทุกครั้งที่เพิ่ม env-gated guard ใหม่ (เทียบ pattern เดียวกับ decision #209 EDGE_MODE guard) ไม่ใช่แค่เชื่อว่า `.env` ถูกอ่านแล้วเพราะไฟล์มีอยู่จริง.

110. **Postgres `/dev/shm` default 64MB ไม่พอสำหรับ dashboard ที่ยิง aggregation หลายตัวพร้อมกัน — 500 หายเงียบเพราะ frontend `.catch(() => {})`** — 2026-07-17: กราฟหน้า LPR overview ขึ้น 0 หมดทั้งที่มีข้อมูลจริง (~171k แถววันนั้น). **Root cause (reproduce แล้ว):** `GET /api/lpr/stats` ยิง 9 aggregation query พร้อมกันผ่าน `Promise.all`, แต่ละ query สามารถ spawn parallel worker (`max_parallel_workers_per_gather=2`) ที่ dynamic shared memory (DSM) segment อยู่ใน `/dev/shm` — Docker default 64MB ไม่พอภายใต้โหลด dashboard จริง → `could not resize shared memory segment … No space left on device` → endpoint 500 → `dashboard/page-lpr.js` เดิม `.catch(() => {})` กลืน error เงียบ ทำให้ error หน้าตาเหมือน "ไม่มีข้อมูล".
     **Fix (commit `555befe`):** เพิ่ม `shm_size: 1gb` ใน `postgres` service ของ `docker-compose.yml` (recreate container, named volume ไม่กระทบ).
     **Lesson:** (1) frontend ที่ silent-catch stats endpoint ทำให้ infra error หน้าตาเหมือน data-not-found — ก่อนเชื่อว่า "ไม่มีข้อมูล" ต้องเช็ค Network tab/api-server log ก่อนเสมอ. (2) `/dev/shm` เป็น shared resource ข้าม endpoint ทั้งหมดที่มี heavy aggregation (`/api/faces/stats`, `/api/appearances/stats`, reports) — fix จุดเดียวช่วยทุกจุดที่ parallel-query pattern เดียวกัน.

111. **Dahua snapManager stream ค้าง (TCP ยังเปิดแต่หยุดส่งข้อมูล) เกิน `heartbeat=5` โดยไม่มี FIN — ต้อง watchdog เชิงรุก ไม่ใช่รอ TCP error** — 2026-07-17: กล้อง `anpr-bigc1` หยุดส่ง plate cutout แต่ไม่มี disconnect event ให้ ingester รู้ตัว. **Root cause:** Dahua HTTP API V3.37 `attachFileProc` (snapManager) protocol กำหนดให้ stream ที่ healthy ต้องส่ง byte อย่างน้อยทุก ~5 วินาที (`heartbeat=5`) — connection ที่เงียบเกิน ~20s ถือว่า zombie แม้ socket ยังไม่ได้รับ FIN จากฝั่งกล้อง (เครือข่าย/กล้องค้างโดยไม่ปิด connection ให้ถูกต้อง).
     **Fix (commit `2337a83`):** เพิ่ม watchdog timer ใน `src/ingesters/dahua-cgi.js` ที่ track เวลา byte ล่าสุดต่อ snapManager stream, บังคับ reconnect เมื่อเงียบเกิน threshold แทนรอ TCP-level error ซึ่งอาจไม่มาเลย.
     **Lesson:** protocol ที่ระบุ heartbeat interval มาให้ (ในเอกสาร vendor) ควรใช้เป็น watchdog threshold ฝั่งเราเสมอ — อย่าพึ่ง TCP layer บอกว่า connection ตายแล้ว เพราะ "TCP ยังเปิด" ≠ "stream ยังส่งข้อมูลจริง".

112. **เพิ่มกลไกใหม่ก่อนเช็คว่ามีกลไกเดิมทำงานอยู่แล้ว — เกือบ ship duplicate retention job ซ้ำกับของเดิมที่มีอยู่ตั้งแต่ 3 สัปดาห์ก่อน** — 2026-07-20: เจ้าของ measure เจอ `snapshots/events/` บน hdy-edge โต ~100-120G/day (commit `4b39257`) แล้วสร้าง `src/edge-retention.js` (mtime-based pruner + PM2 app) ใหม่ทั้งชุดโดยไม่รู้ว่า `src/edge/snapshot-retention.js` (commit `d87649c`, 2026-07-01, decision #214, GOTCHAS #106) ทำหน้าที่เดียวกันอยู่แล้ว — hourly prune ของ `snapshots/events/` ผ่าน `edge/bridge.js` มาตั้งแต่ 3 สัปดาห์ก่อน. พบซ้ำหลัง push (`4b39257`) — revert ทันทีวันเดียวกัน (commit `2e043d1`, ลบ `edge-retention.js` + `ecosystem.edge.config.js` entry) คง mechanism เดิมไว้ตัวเดียว พร้อมปรับ `EDGE_IMAGE_RETENTION_DAYS=4` (จาก default 7) ให้ margin เข้ากับอัตราการโตจริงที่วัดได้.
     **Lesson:** ก่อนเขียนกลไก retention/cleanup/pruner ใหม่ — `grep -rn` ชื่อ path/env var ที่เกี่ยวข้อง (`snapshots/events`, `EDGE_.*RETENTION`) ในโค้ดทั้งหมดก่อนเสมอ ไม่ใช่แค่เช็คว่า "central เข้าไม่ถึง path นี้" (จริงสำหรับ central แต่ edge-local mechanism อาจมีอยู่แล้วนอก grep pattern ที่คิดไว้แรก). Diagnosis ที่ถูก (disk โตจริง, วัดจริง) ไม่ได้แปลว่า root-cause diagnosis ("ไม่มีกลไกใดๆ") ถูกด้วย — ต้อง verify negative claim ("ไม่มี X") ด้วย grep จริงก่อนสร้างของใหม่ทับ.

113. **Edge-bridge queue เคยขึ้นไปถึง 88.4% ของ cap 200MB โดยไม่มี alert เลยสักบรรทัด — เจอสดระหว่าง re-verify audit ไม่ใช่ test สังเคราะห์** — 2026-07-21 (hdy-edge): ระหว่างตรวจสอบซ้ำ finding OPT5-EDGE-001 ของ `CODEX_Audit_5th_Audit_part_optimization.md` ("ไม่มี alert ก่อน bridge queue eviction") พบว่า queue จริงที่ hdy-edge ค้างอยู่ที่ 88.4% ของ `QUEUE_MAX_BYTES` (200MB) — เป็นผลตกค้างจาก central `/mqtt` endpoint ล่มวันเดียวกันช่วง ~ห้าโมงครึ่ง (ดู project memory) ที่ทำให้ queue สะสมไม่มีทางระบาย. เช็ค log แล้วไม่มีบรรทัดไหนเตือนก่อนเลย — `enqueue()` เดิม log เฉพาะ **หลัง** eviction เกิดแล้วเท่านั้น ไม่มี early-warning ระหว่างทาง.
     **Fix** (commit `0b40332`): เพิ่ม `console.warn` เชิงรุกเมื่อ queue ≥80% ของ cap ใน heartbeat `setInterval` เดิม + field `bridge_alert` ใหม่ใน `health.js`'s `edge_sites` mapping (latch เป็น true เมื่อ `bridge_dropped>0`, เป็นค่าสะสมตั้งแต่ edge-bridge process restart ล่าสุด — อ่านว่า "เคย drop มาแล้วตั้งแต่ restart" ไม่ใช่ "กำลัง drop อยู่ตอนนี้") surfaced ขึ้นหน้า Health.
     **Lesson:** queue ที่มี capacity จำกัดแล้ว "พูด" เฉพาะตอน fail (evict) ไปแล้วเท่านั้น ให้เวลาแก้ไขล่วงหน้า = 0. Near-miss telemetry (ใกล้เต็ม แต่ยังไม่ล้น) ทำเพิ่มถูกมาก ควร ship คู่กับ failure-path log เสมอสำหรับ queue/cap ใดๆ ที่มี upper bound.

114. **เว็บ dashboard ล่ม (90% request timeout) ทั้งที่ local origin ปกติสมบูรณ์ — สาเหตุอยู่ที่ Cloudflare Tunnel connection เอง ไม่ใช่แอป** — 2026-07-21 ~22:52-23:04: ผู้ใช้แจ้งเว็บโหลดไม่ขึ้น. Reproduce สด: `curl 127.0.0.1:3000` ตอบ 302 ใน 3ms ทุกครั้งแม้ยิง 15 request พร้อมกัน (PM2/Docker ปกติหมด) แต่ `curl https://dashboard.dojojin.tech/` **timeout 9/10 ครั้ง** (5-10s ไม่มี response). **Root cause (เท่าที่ยืนยันได้จาก log จริง — ไม่ใช่เดา):** `cloudflared` (root launchd daemon, token-managed ตาม GOTCHAS #94) ใช้ 4 connection คู่ขนาน (`connIndex=0-3`) เพื่อ redundancy; ช่วงล่ม `connIndex=0` (ตัวที่แบก traffic จริง) error `"stream ... canceled by remote"` ซ้ำๆ และ `connIndex=1` flap ต่อเนื่อง (`"control stream encountered a failure"` — ของเดิมมีมา 11 วันแล้ว ไม่ใช่สาเหตุใหม่); **สถานะของ connIndex 2/3 ระหว่างช่วงล่มจริงยืนยันไม่ได้จาก log** (log ที่ดูตอนแรกคือ "register ล่าสุดเมื่อ X ชม.ก่อน" ซึ่งหมายถึง **เสถียรมา X ชม.** ไม่ใช่ "ตายมา X ชม." — connection ที่เสถียรไม่ re-register ซ้ำ, อย่าตีความผิดแบบนี้อีก).
     **ตัดออกแล้ว (ยืนยันจาก log ตรง ไม่ใช่สันนิษฐาน):** ไม่ใช่เพราะย้าย/เปลี่ยน WiFi — `configd` log ยืนยัน `ConnectionID` เดิมตลอดช่วง (29 ไม่เปลี่ยน), ไม่มี link down/up, ไม่มี DHCP re-init, ไม่มี sleep/wake ช่วงนั้น. ไม่ใช่ข้อจำกัด Cloudflare free-tier — เอกสารทางการไม่มีข้อความเรื่อง plan-based connection reliability เลย และ Tunnel Health Alert ก็ใช้ได้บน free plan.
     **Fix:** `sudo launchctl kickstart -k system/com.cloudflare.cloudflared` (ต้อง sudo ที่ terminal ของเครื่องจริง ทำผ่าน Claude shell ไม่ได้). หลัง restart ทั้ง 4 connection register ใหม่ภายใน 2 วินาที + cloudflared precheck เอง PASS ทุกข้อรวม UDP/QUIC + `curl` 10/10 สำเร็จ.
     **Runbook (จำไว้ใช้ครั้งหน้า):** เว็บล่มแต่ `curl 127.0.0.1:PORT` ปกติ → **อย่าไล่ดูโค้ด/DB ก่อน** → `tail -50 /Library/Logs/com.cloudflare.cloudflared.err.log` ดูว่ามี `"control stream encountered a failure"`/`"canceled by remote"` ถี่ๆ ไหม → ถ้าใช่ restart cloudflared ตามคำสั่งข้างบนได้เลย เป็น fix ที่ risk ต่ำสุด (ไม่กระทบ local service ใดๆ, log ไม่หาย).
     **Lesson:** (1) "connection ไม่เคย re-register นาน X ชม." กับ "connection ตายมา X ชม." เป็นคนละข้อสรุป — connection ที่เสถียรก็ไม่ re-register เหมือนกัน อย่าอ่าน log แบบเดียวแล้วสรุปสถานะที่ log ไม่ได้บอกตรงๆ. (2) ก่อนฟันธง root-cause ที่มีผลต่อคำแนะนำ (เช่น "เครือข่ายเจ้าของมีปัญหา") ต้องมีหลักฐานเชิงลบที่ตรงประเด็นจริง (`ConnectionID` ไม่เปลี่ยน) ไม่ใช่แค่ "เน็ตทั่วไปใช้ได้" (ping/curl ธรรมดาไม่ได้ทดสอบ UDP/QUIC ที่ tunnel ใช้จริง).

115. **`pm2 kill && pm2 resurrect` ไม่ pick up การเปลี่ยน `ecosystem.config.js`'s `env` block — ต้อง `pm2 start ecosystem.config.js && pm2 save` แทน** — 2026-07-22: เพิ่ม `NODE_ENV: 'production'` เข้า shared `base.env` ของ `ecosystem.config.js` (สำหรับ SEC5-MED-005 fail-fast fix) แล้วรัน `scripts/pm2-lan-safe-restart.command` (`pm2 kill && pm2 resurrect`) ตามปกติ — **ค่า `NODE_ENV` ไม่ขึ้นในทุก process เลย**. **Root cause:** `pm2 resurrect` อ่าน state จาก `~/.pm2/dump.pm2` (snapshot ล่าสุดตอน `pm2 save` ครั้งก่อน) ไม่ได้ re-read `ecosystem.config.js` เลย — env ที่ผูกกับ process ถูก cache ไว้ใน dump ตั้งแต่ตอนเริ่ม ไม่ใช่ live-read จากไฟล์ config ทุกครั้งที่ restart.
     **Fix:** `pm2 start ecosystem.config.js` (apply env ใหม่ให้ process ที่ชื่อตรงกันซึ่ง**กำลังรันอยู่**) → `pm2 save` (persist ให้ resurrect รอบถัดไปจำค่านี้ได้) — รันผ่าน `.command` ใน Terminal.app context เดียวกัน (ยังต้องผ่าน LNP grant เพราะเป็นการ start ใหม่ ไม่ใช่ restart เฉยๆ).
     **Lesson:** แก้ `ecosystem.config.js`'s `env` block แล้ว **ไม่ใช่แค่ restart** — ต้อง `pm2 start ecosystem.config.js && pm2 save` เสมอ ไม่งั้น dump เก่าจะ mask การเปลี่ยนแปลงไปเรื่อยๆ ทุกรอบ kill+resurrect ถัดไป (silent, ไม่มี error ให้เห็น — verify ด้วย `pm2 jlist | grep NODE_ENV` หรือเทียบเท่าเสมอหลังแก้ env).

116. **`routes/lpr.js`/`routes/face-push.js` mount โดย 2 process แยกกัน (`api-server` central + `lpr-receiver` central+edge) — deploy central อย่างเดียวไม่ครบ ต้อง `git pull`+restart edge แยกต่างหาก และง่ายมากที่จะลืม** — 2026-07-22: แก้ legacy `/lpr` (ปิดเป็น 410) ใน `routes/lpr.js`, deploy central ผ่าน LAN-safe restart แล้วรายงานว่าเสร็จ — **แต่ลืม `git pull` + restart `lpr-receiver` บน hdy-edge/vss-edge เลย** เพราะทั้งสอง site รัน `lpr-receiver.js` เป็น standalone PM2 process ของตัวเอง (mount route module เดียวกัน คนละ process จาก central) ซึ่งไม่ได้ถูกแตะโดยการ restart central แม้แต่นิดเดียว. พบตอนทำ deploy รอบถัดไป (Phase 4b) — pull เข้ามาพร้อมกันเลยตอนนั้นเพราะ edge ยังค้างอยู่ที่ commit เก่า.
     **Fix:** ตรวจสอบทุกครั้งก่อน deploy ว่าไฟล์ที่แก้ถูก mount โดย process ไหนบ้าง — `grep -rn "routes/lpr\|routes/face-push" src/api-server.js src/lpr-receiver.js` แล้ว deploy ให้ครบทุก process จริง ไม่ใช่แค่ที่ restart central ตามความเคยชิน.
     **Lesson:** ไฟล์ shared module ที่ถูก mount โดยหลาย entry-point (central + edge) ไม่มีสัญญาณเตือนอัตโนมัติว่า deploy ไม่ครบ — process ที่ไม่ได้ restart จะรันโค้ดเก่าเงียบๆ ต่อไปเรื่อยๆ โดยไม่มี error ก่อน commit ที่แก้ shared route module ให้เช็คจุด mount ทั้งหมดก่อนเสมอ ไม่ใช่แค่จุดที่คุ้นเคย.

117. **native-binding dependency bump (`sharp`) ต้อง restart ทุก process ที่ `require()` มันโดยตรง ไม่ใช่แค่ตัวที่นึกถึงก่อน — `npm ls`/uptime บอกได้คร่าวๆ แต่ `lsof -p <pid> | grep -iE 'sharp|vips'` คือหลักฐานที่ชัวร์จริง** — 2026-07-23: bump `sharp` 0.34.5→0.35.3 (ปิด CVE `GHSA-f88m-g3jw-g9cj`, libvips high severity ×4). `npm install` เปลี่ยนไฟล์บน disk (`node_modules/`) ทันที แต่ process ที่รันอยู่แล้ว **dlopen** binary เก่าค้างใน memory จนกว่าจะ restart ตัวมันเอง — restart แค่ `api-server` แล้วรายงานว่า "central เสร็จแล้ว" เกือบพลาด: central ยังมี `dahua`/`lpr-receiver`/`report-worker`/`alert-worker` ที่ require sharp แยกกันคนละ process ผ่าน `report-renderer.js`/`lpr-core.js`/`dahua-cgi.js`. Advisor ทักก่อนปิดงานให้เช็ค `lsof` จริงแทนเชื่อ uptime — พบว่า `dahua` และ `lpr-receiver` (central) ยังโหลด `libvips-cpp.8.17.3.dylib` ค้างอยู่จริง ทั้งที่ `npm ls sharp` รายงาน 0.35.3 แล้ว (เพราะนั่นเป็น disk state ไม่ใช่ในตัว process ที่รันอยู่).
     **Fix:** ก่อนบอกว่า dependency bump "เสร็จ" ให้ `grep -rln "require('sharp')" src/*.js src/routes/*.js src/ingesters/*.js` หา entrypoint ทั้งหมด map เป็น PM2 process list แล้ว restart ให้ครบทุกตัว จากนั้น verify ด้วย `lsof -p <pid> | grep -iE '<lib name>'` ทีละ process ว่า mapping ชี้ path/เวอร์ชันใหม่จริง — process ที่ยังไม่เคย require เข้าเลย (lsof ว่างเปล่าทั้งก่อน/หลัง) ไม่ต้องกังวล จะได้ binary ใหม่อัตโนมัติเมื่อ require ครั้งแรกในอนาคต.
     **Lesson:** native-binding package (sharp, bcrypt, canvas, ฯลฯ) ต่างจาก pure-JS dependency ตรงที่ `require()` ไม่ได้แค่ cache module object แต่ dlopen ไฟล์ `.node`/`.dylib`/`.so` เข้า process memory ตรงๆ ตอน require ครั้งแรก — เปลี่ยนไฟล์บน disk ไม่ทำให้ process ที่กำลังรันอยู่ "เห็น" เวอร์ชันใหม่จนกว่าจะ restart process นั้นเอง เวลา bump dependency ประเภทนี้ (โดยเฉพาะ CVE fix) ต้อง list ทุก PM2 process ที่ require มันก่อนเสมอ ไม่ใช่แค่ process ที่บังเอิญแก้โค้ดข้างๆ ตรงๆ.

118. **`localStorage` session token ยังใช้ได้แต่ `session` cookie หายไป → login.html เด้งเข้า `disclaimer.html`↔`login.html` วนไม่รู้จบ จนแท็บ browser ค้าง/crash เอง — root cause คือ "auto-skip ถ้า login อยู่แล้ว" เช็คผ่าน header แต่ redirect ด้วย navigation ที่ header ไปด้วยไม่ได้** — 2026-07-23 เจ้าของแจ้ง "dashboard เข้าไม่ได้อีกแล้ว...หน้าจอกระพริบ/reload ซ้ำๆ เอง" — reproduce สดผ่าน Claude in Chrome ได้ 100%: กด "ยอมรับ" บน disclaimer → เด้งไป login.html → เด้งกลับ `/` → เด้งกลับ disclaimer.html → วนทุก ~100-125ms จนแท็บ browser หลุด CDP attachment ไปเอง (ทดสอบยิงรัวจน network log ตันที่ 1000 request/รอบ). **Root cause (ยืนยันจาก `document.cookie`/`localStorage` จริงในแท็บที่เกิดปัญหา):** `document.cookie` ว่างเปล่า แต่ `localStorage.bosch_session_token` ยังมี token ที่ valid จริงใน DB (97 ตัวอักษร) — `login.js`'s "ถ้า login อยู่แล้ว → redirect ไป dashboard" (บรรทัด ~109-121 เดิม) เช็คผ่าน `fetch('/api/auth/me', {headers:{Authorization:'Bearer '+token}})` ซึ่ง**แนบ header ได้**เพราะเป็น fetch() → ผ่าน (200) → แล้วสั่ง `window.location.href = '/'` ซึ่งเป็น **plain navigation ที่แนบ custom header ไม่ได้ ส่งได้แค่ cookie** (ไม่มี) → server (`api-server.js` static-asset middleware) เห็นว่าไม่มี credential ใดๆ เลย → redirect `/` กลับ `/disclaimer.html` → `disclaimer.js` เห็น `sessionStorage.disclaimer_accepted==='1'` (ยังไม่เคยถูกล้าง) → เด้งไป login.html ทันทีอัตโนมัติไม่ต้องกดอะไร → วนซ้ำไม่จบ. เทียบกับ flow login จริง (`login.js` บรรทัด ~69-73) ที่ผ่าน POST `/api/auth/login` แล้ว **ทั้ง set cookie จาก response ด้วย และส่ง token ผ่าน `#t=` hash ให้ `dashboard.js`'s `importTokenFromHash()` อ่านต่อ** — auto-skip นี้ทำแค่ header check แต่ไม่เคยผ่าน POST login เลย เลยไม่มี cookie ให้ navigation พกไปด้วย.
     **Fix:** 3 จุด — (1) `dashboard/login.js`: auto-skip เฉพาะเมื่อมี `session` cookie จริง (`/(?:^|;\s*)session=/.test(document.cookie)`) เท่านั้น ถ้าผ่านแค่ Bearer-header fallback ให้ปล่อยอยู่หน้า login form ปกติ (login จริงจะได้ cookie ใหม่ตามทางที่ถูก); (2) `dashboard/disclaimer.js`: เพิ่ม loop-guard (cap ไม่เกิน 3 ครั้ง/5 วิ, sessionStorage เก็บ counter) กันกรณีอื่นที่อาจ bounce แบบนี้ในอนาคตไม่ให้กลายเป็น infinite loop; (3) `src/auth.js`'s `getUserFromToken` — เพิ่ม `console.error` log บน DB query error ที่เคยกลืนเงียบสนิท (`catch(e){return null}`) เผื่อ debug กรณีคล้ายกันที่มาจาก DB จริงๆ ไม่ใช่ cookie หาย.
     **Lesson:** ระบบ auth แบบ triple-layer (cookie + localStorage + Authorization header, ทำไว้กัน Safari ITP — ดู CLAUDE.md #2) ต้องระวังว่า **แต่ละ layer ใช้ได้กับ request บางชนิดเท่านั้น**: `fetch()`/XHR แนบ custom header ได้ แต่ plain `location.href`/`<a href>` navigation แนบได้แค่ cookie (ไม่มีทาง JS ใดส่ง Authorization header ผ่าน navigation ได้เลย เป็นข้อจำกัดของ browser ไม่ใช่บั๊ก). โค้ดที่เช็ค auth ผ่านทางหนึ่ง (header) แล้ว action เป็นอีกทางหนึ่ง (navigation) ต้องเช็คว่า credential ที่ใช้ยืนยันจริงๆ นั้น "เดินทางไปกับ action ต่อได้ไหม" ก่อนเสมอ ไม่งั้นจะเจอ auth check ที่ "ผ่าน" แต่ทำให้ user ตกไปอยู่สถานะที่ server มองไม่เห็นเลย.

119. **`pm2 delete all && pm2 start ecosystem.config.js` บน edge node ลบ process edge จริงทิ้งแล้วไป start ชุดของ central แทน — คนละไฟล์กัน (`ecosystem.config.js` = central, `ecosystem.edge.config.js` = edge)** — 2026-07-24 (`vss2-edge`, `hdy-edge`, ระหว่าง migration MacBook→vigilcentral follow-up): แก้ `ecosystem.config.js`'s `interpreter` ให้ตรงกับ node path ของ central (`/usr/bin/node` หลัง symlink) แล้ว apply ด้วย `pm2 delete <app> && pm2 start ecosystem.config.js` ตามคอมเมนต์ในไฟล์เอง (interpreter change ไม่ re-read จาก `pm2 restart` เฉยๆ) — รันคำสั่งเดียวกันซ้ำบน edge 2 เครื่องโดยไม่ได้เช็คก่อนว่าไฟล์ไหนคือของ edge. **Root cause:** repo มี 2 ไฟล์ ecosystem แยกกันจริง (`docs/REF_edge-install.md` Step 9 ระบุไว้ว่า edge ต้องใช้ `ecosystem.edge.config.js` คนละ apps array กับ central — edge มี `nanomq`/`edge-config-agent`/`edge-bridge`/`cloudflared`, central มี `api-server`/`mqtt-subscriber`/`media-recorder`/`report-worker`/`alert-worker`) แต่ apps ที่ชื่อซ้ำกัน (`hikvision`/`dahua`/`lpr-receiver`) ทำให้ `pm2 delete all` ดูเหมือนแค่ restart ของเดิม ทั้งที่จริงลบ 3 ตัวที่ไม่มีในไฟล์ central ทิ้งถาวร (ไม่ auto-start กลับมาเอง) แล้ว `pm2 start ecosystem.config.js` ไป launch `api-server`/`mqtt-subscriber`/`media-recorder`/`report-worker`/`alert-worker` แทนบน edge ซึ่ง crash-loop ทันที (`ECONNREFUSED 127.0.0.1:5432/1883` — edge ไม่มี Postgres/local broker ของตัวเอง). **Fix:** `pm2 delete all` ซ้ำ แล้ว `pm2 start ecosystem.edge.config.js` (ไฟล์ที่ถูกต้อง) คืนค่า 6 process เดิม + `pm2 delete cloudflared` ตามที่ doc กำหนด (tunnel รันผ่าน systemd อยู่แล้ว ไม่ใช่ PM2 — กัน duplicate connector/split-brain) แล้ว `pm2 save` ทับของเดิมที่ save ผิดไปแล้ว. Verify: `hikvision` log ยืนยัน Alert Stream connect ทั้ง 2 กล้อง + `configureAlarmServer` สำเร็จเหมือนเดิม, ไม่มี process ค้างผิดชุด. **Impact จริง:** ~1 นาทีที่ nanomq/edge-bridge หายไป event ใหม่จากกล้อง edge (Hikvision + Dahua) ที่ site นั้นอาจไม่ถูกส่งเข้า pipeline ช่วงนั้น — ไม่มีข้อมูลเก่าเสียหาย ไม่มี DB เขียนผิด.
     **Lesson:** repo ที่มีหลาย ecosystem config file สำหรับ role คนละแบบ (central vs edge) — ก่อนรัน `pm2 delete all && pm2 start <file>.config.js` บนเครื่องไหน **ต้องเช็คก่อนว่าไฟล์นั้นตรงกับ role ของเครื่องจริงไหม** (`ls *.config.js` + เทียบ apps array) โดยเฉพาะเมื่อ apps บางชื่อซ้ำกันข้ามไฟล์ (ทำให้ดูเหมือนแค่ restart ปกติ ทั้งที่จริงสลับทั้งชุด) — ค่าที่ commit ร่วมกันข้ามหลายเครื่อง (เช่น `interpreter` path) ก็ต้องระวังจุดเดียวกัน: แก้ให้ตรงเครื่องหนึ่งอาจไปพังอีกเครื่องเงียบๆ จนกว่าจะมีคน delete+start จริง.

120. **`transform` บน `:active` ของปุ่มที่ใช้ `data-action` delegation = คลิกหายเงียบ ไม่มี error — และ `page.click()` ตอนเทสต์ไม่มีทางจับได้ เพราะมันกดกลางปุ่มเสมอ** — 2026-07-25/26 (หน้า ฐานข้อมูลใบหน้า, ปุ่มเปิดดูเลขบัตร `.bl-idbtn`): เจ้าของแจ้ง "กดดูเลขบัตรไม่ได้" บน Edge/Linux แต่ Chrome/Android กดได้ — console **สะอาดสนิท ไม่มี error เลย** ทำให้ไล่ผิดทางอยู่หลายรอบ (ไล่ backend → ยิง 200 ระเบียนผ่านหมด, ไล่ cache → md5 ตรง, ไล่ overlay → `elementFromPoint` โดนปุ่มทุกความกว้าง, ไล่ light/dark theme → ผ่านทั้งคู่). **Root cause:** ตอนแก้ปัญหาแรก (ปุ่มเล็กเกินไป 18×18px < เกณฑ์ 24px) ได้ขยายเป็น 28px **แล้วแถม `.bl-idbtn:active { transform:scale(.94) }` เข้าไปเป็น feedback ด้วย** — pointer ที่กดใกล้ขอบปุ่ม: `mousedown` โดนปุ่ม → ปุ่มหด 6% → ขอบขยับหนี → `mouseup` ตกไปโดน `<span>` แม่ → เบราว์เซอร์ยิง `click` ที่ **common ancestor** (`.bl-idcell`) ตามสเปก ไม่ใช่ที่ปุ่ม → dispatcher กลาง (`page-nav-bindings.js`: `e.target.closest('[data-action]')`) หา `data-action` บน ancestor ไม่เจอ → `return` เงียบ ไม่ throw ไม่ log. อธิบายได้ครบทุกอาการ: ทำไม `b.click()` ใน console ผ่าน (ยิง event ตรง ไม่ผ่าน mousedown/mouseup), ทำไม Android ผ่าน (touch เป็นคนละ event sequence), ทำไมไม่มี error.
     **Fix (2 ชั้น):** (1) เอา `transform` ออกจาก `:active` เปลี่ยน feedback เป็น `background` แทน — สีไม่ทำให้ hit box ขยับ; (2) ใส่ `data-action` เดียวกันบน `.bl-idcell` (ตัวครอบ) ด้วย ทำให้กดที่ตัวเลขก็ทำงาน เป้าใหญ่ขึ้นมาก edge-miss ก็ยังโดนของที่ตอบสนอง — handler แก้ให้ resolve ปุ่มจาก `wrap.querySelector()` แทนสมมติว่า `el` คือปุ่ม + กัน double-fire ด้วย `data-busy`.
     **Lesson:** (1) **อย่าใส่ `transform`/`scale`/`translate` บน `:active` ของ element ที่พึ่ง event delegation** — การขยับ geometry ระหว่าง mousedown→mouseup ทำให้ click เด้งขึ้นไป fire ที่ ancestor ซึ่งมักไม่มี `data-action` → หายเงียบแบบ debug ยากมาก. ใช้ `background`/`color`/`box-shadow` เป็น feedback แทน (ไม่แตะ layout). (2) **`page.click()` / `element.click()` ตอน verify พิสูจน์ได้แค่ "logic ถูก" ไม่ได้พิสูจน์ว่า "คนกดติด"** — ทั้งคู่กดกลาง element เสมอและข้าม mousedown/mouseup sequence จริง; ถ้าจะทดสอบปุ่มให้ครบต้อง `mouse.move()` ไปที่**ขอบ** แล้ว `mouse.down()`/`mouse.up()` แยกกัน. (3) console ที่เงียบสนิทไม่ได้แปลว่าไม่มีบั๊ก — delegation ที่ `return` เมื่อหา handler ไม่เจอ คือ failure mode ที่ silent by design ควรเป็นสมมติฐานต้นๆ เมื่อ "กดแล้วไม่มีอะไรเกิดขึ้นและไม่มี error".

121. **คอลัมน์เดียวถูกเขียนคนละความหมายต่อ source แล้ว API ตั้ง alias ตามความหมายเดียว → ชื่อหน่วยตำรวจไปพิมพ์บนป้ายทะเบียนจำลองในช่องจังหวัด** — 2026-07-26 (`blacklist.source_records.case_ref`, หน้า ฐานข้อมูลป้ายทะเบียน): เจ้าของทักว่า "หน่วยเฝ้าตรวจ A2 ไม่น่าใช่จังหวัดนะ". **Root cause:** importer เขียน `case_ref` คนละความหมาย — GuruSquare ใส่ `rec.province`, DSS Pro ใส่ `rec.org_name` (`blacklistImport.js` บรรทัด 117 vs 246/277) แล้ว query ฝั่ง list ตั้ง `MAX(r.case_ref) AS province` ไปเลย (`blacklist-sources.js`) ส่วน query ฝั่ง facet ตั้ง `AS org` — **คอลัมน์เดียวโผล่ออก API สองชื่อ**. frontend อ่าน `rec.case_ref` เป็นจังหวัดทั้ง tile และ modal แถมส่งเข้า `lprPlaque({region})` → `หน่วยเฝ้าตรวจ_B01` ถูก render ลงช่องจังหวัดของป้ายจำลอง ซึ่งเป็นจุดที่เจ้าหน้าที่อ่านเพื่อระบุพื้นที่. **ที่อันตราย:** ไม่ crash ไม่ error — ค่ามันดู "มีเหตุผล" พอที่จะเชื่อ (เป็นข้อความไทยสั้นๆ เหมือนชื่อจังหวัด) ถ้าเชื่อตามอาจไล่ผิดพื้นที่. **Fix:** (1) `case_ref` เหลือความหมายเดียว = หน่วยที่แจ้งคดี ทุก source; Guru ตั้ง `null` (จังหวัดอยู่ใน `raw_json` อยู่แล้ว) · DSS vehicle ตั้ง `name: null` (เคยซ้ำกับ case_ref จนโชว์ค่าเดียวกันสองบรรทัดคนละ label); (2) API แยกเป็น 2 ฟิลด์จริง `org` (case_ref) กับ `province` (`raw_json->>'province'`); (3) migration 095 backfill แถวเดิม 1,596 แถว โดย scope ด้วยการ**พิสูจน์ว่าค่าที่เก็บมาจากฟิลด์ผิดจริง** (`case_ref = raw_json->>'province'`) → re-run ได้ ไม่แตะแถวที่ถูกอยู่แล้ว.
     **Lesson:** (1) **คอลัมน์ที่ importer หลาย source เขียนร่วมกัน ต้องนิยามความหมายให้ตายตัวก่อนเขียน source ที่สอง** — ถ้าเผลอให้ source ใหม่ยัดความหมายอื่นลงคอลัมน์เดิมเพราะ "มันว่างอยู่พอดี" บั๊กจะไม่โผล่ตอน import แต่โผล่ตอน render คนละไฟล์คนละสัปดาห์. (2) **`AS <ชื่ออื่น>` ใน SQL คือการ "ประกาศความหมาย" ไม่ใช่แค่เปลี่ยนชื่อ** — ถ้าคอลัมน์เดียวถูก alias เป็นสองชื่อในสอง query ของไฟล์เดียวกัน นั่นคือสัญญาณว่าความหมายมันไม่นิ่งแล้ว. (3) ตอน verify ให้เช็ค **ทั้งสอง source** เสมอ — รอบแรกผมแก้ฝั่งจังหวัดถูก แต่ไปสร้างบั๊กสะท้อนกลับฝั่ง `หน่วยงาน` ของ Guru (โชว์ "ยะลา" เป็นหน่วยงาน) ซึ่งจับได้เพราะรัน repro กับ **ทั้ง DSS-อย่างเดียว และ Guru+DSS ที่ merge กัน**.

122. **`COUNT(*) OVER()` ทำให้ `LIMIT` ไร้ผล — endpoint ที่ปกติ 0.04s กลายเป็น 37s เพราะไป trigger correlated subquery 24,441 รอบ** — 2026-07-26 (`GET /api/faces`, หน้า Face Recognition โหลดไม่ขึ้น): เจ้าของแจ้งว่าหน้าเปิดไม่ได้ ตอนแรกผมบันทึกสาเหตุไว้ผิดว่าเป็น `group=burst_spatial` — **ไม่ใช่**. ตัวการจริงคือ `include_recog=1` (ยิงพร้อมกันเสมอ จึงดูเหมือน burst_spatial). **Root cause:** `include_recog=1` เปิด Dahua twin-suppression ซึ่งเป็น `NOT EXISTS` แบบ correlated. ปกติ `LIMIT 24` จะทำให้ประเมินแค่ไม่กี่แถว **แต่ `COUNT(*) OVER()` ที่ใส่ไว้เพื่อทำ `X-Total-Count` บังคับให้ window function เห็นผลลัพธ์ครบทั้งชุดก่อน** → subquery ถูกรัน **24,441 loops** (EXPLAIN: `loops=24441`, `Rows Removed by Filter: 3,179,054`) และแต่ละ loop planner สร้าง bitmap ของ `FaceDetector/Comparison` ทั้ง **20,462 แถว** ใหม่ทุกครั้ง (`Bitmap Index Scan ... rows=20462 loops=24441`, `Buffers: shared hit=537702`) เพื่อ AND กับ bitmap ช่วงเวลาที่ได้แค่ 7 แถว. **วัดแยกตัวแปรได้ชัด:** ของจริง 37.02s · ตัด `COUNT(*) OVER()` ออก **0.04s** (เร็วขึ้น 925 เท่า) · ตัด `ORDER BY` 0.00s · `SELECT COUNT(*)` ทั้งชุด 39.49s. **Fix:** ไม่คำนวณ total เมื่อ `group=burst_spatial` — ผู้เรียกโหมดนี้ (`_loadFaceOvLatest`) **ไม่เคยอ่าน `X-Total-Count` เลย** และอ่านไปก็ผิดอยู่ดี เพราะโหมด grouped ยุบแถวเป็น burst (24 แถว → 15 กลุ่ม) ตัวเลขดิบจึงไม่ตรงกับสิ่งที่คืน. ผล: 37.2s → **0.04s**, หน้าโหลดได้ปกติ.
     **Lesson:** (1) **`COUNT(*) OVER()` = ยกเลิก `LIMIT` โดยพฤตินัย** — window function ต้องเห็นทุกแถวที่ผ่าน WHERE ก่อน ถ้า WHERE มี subquery/ฟังก์ชันแพง ราคาจะคูณด้วยจำนวนแถวทั้งชุด ไม่ใช่ค่า LIMIT. ก่อนใส่ `COUNT(*) OVER()` ให้ถามก่อนว่า **ใครใช้ total นี้จริง** — ที่นี่คำตอบคือไม่มีใคร. (2) **สาเหตุที่ "ดูเหมือน" มาจากพารามิเตอร์หนึ่ง อาจมาจากอีกตัวที่ยิงมาคู่กันเสมอ** — ต้องยิงแยกทีละตัวถึงจะรู้ (`group` อย่างเดียว 0.93s · `include_recog` อย่างเดียว 37.16s). (3) EXPLAIN ให้ดู `loops=` ของ SubPlan ก่อนอย่างอื่น — เลขนั้นบอกทันทีว่า planner กำลังทำงานแบบ per-row แทน set-based. (4) **ยังเหลือกับดัก:** `include_recog=1` โดยไม่มี `group` ยังช้า 37s อยู่ (ตอนนี้ไม่มีโค้ดเรียกแบบนั้น) — ถ้าจะใช้ path นั้นต้องแก้ก่อน ทางที่วัดแล้ว: CTE MATERIALIZED ลดเหลือ 15.7s (ยังไม่พอ) ทางที่น่าจะจบคือ partial index `(camera_id, event_time) WHERE event_type='FaceDetector/Comparison'` แต่เป็น schema change บนตาราง partition 3.2M แถว ต้องขออนุมัติก่อน.

123. **ไฟล์ scheduler เดินทางไปกับ repo แต่ "การลงทะเบียน" ไม่ได้อยู่ใน git — backup หยุดเงียบ 4 วันหลังย้าย OS แล้วเครื่องเก่ายังยิงพลาดทุกคืนซ้อนอยู่** — 2026-07-27 (พบตอนเจ้าของถามว่า "ต่อจากนี้จะ backup ตามรอบใช่ไหม"): หลังย้าย central MacBook→`vigilcentral` (Linux) เมื่อ 2026-07-23 **ไม่มี backup เกิดขึ้นบน central เลยสักครั้ง** — dump ล่าสุดของระบบคือ `2026-07-24_030002.dump` ซึ่งอยู่บน **MacBook** ไม่ใช่ central. **Root cause:** `scripts/backup.sh` และ `scripts/com.dojojin.dashboard.backup.plist` อยู่ใน repo ทั้งคู่ → `git clone` มา Linux ก็ได้ไฟล์ครบ **ดูเหมือนสมบูรณ์** แต่สิ่งที่ทำให้มัน *ทำงาน* คือคำสั่ง `launchctl load` ที่เคยรันมือครั้งเดียวเมื่อนานมาแล้ว ซึ่ง**ไม่ได้อยู่ใน git และไม่มีที่ไหนบันทึกไว้** — Linux ไม่มี launchd และไม่มีใครสร้าง systemd unit แทน. **ที่แย่กว่าคือฝั่งเครื่องเก่า:** `com.dojojin.dashboard.backup` **ยัง loaded อยู่บน Mac และยังยิงตี 3 ทุกคืน** — `backup.log` (Mac) โชว์ `[2026-07-24 03:03:29] ✓ Offsite: uploaded` เป็นครั้งสุดท้ายที่สำเร็จ แล้วจากนั้น `[2026-07-25 03:11:42] ❌ Container 'vigil-postgres' is not running. Aborting.` และ `[2026-07-26 03:10:51]` เหมือนกัน (`launchctl print` → last exit status = **2**). **จุดตายคือมันล้มเหลวใน 2 ทิศทางพร้อมกัน:** เครื่องที่มีข้อมูลจริงไม่มีคนสำรอง ส่วนเครื่องที่มีคนสำรองไม่มีข้อมูลจริง — และถ้า Postgres container บน Mac บังเอิญยังรันอยู่ มันจะ backup **DB เก่าที่หยุดรับข้อมูลไปแล้ว** สำเร็จเงียบๆ ทุกคืน ซึ่งอันตรายกว่า backup ที่ fail เพราะดูเหมือนมี backup ครบ.
     **Fix:** `scripts/install-backup-timer.sh` — เขียน systemd `.service`+`.timer` แล้ว **verify ทันทีในสคริปต์เดียวกัน** (unit อยู่ครบ / enabled / active / มีรอบถัดไปจริง / user อยู่ใน group docker / มี rclone remote / อายุ dump ล่าสุด) เพราะการ paste heredoc มือทิ้ง unit ที่ "ดูเหมือนติดตั้งแล้วแต่ไม่เคยยิง" ได้ = บั๊กเดิมซ้ำรอบสอง. `--check` รันได้โดยไม่ต้อง sudo. รายละเอียดที่ต้องระวังในตัว unit: `After=docker.service` (ไม่งั้นหลัง reboot timer ยิงก่อน Docker ขึ้น → "container not found"), `TimeoutStartSec=3600` (pg_dump 12GB เกิน default), `Persistent=true` (เครื่องปิดตอนตี 3 แล้วต้องตามเก็บให้ — launchd ทำให้อยู่แล้ว systemd ต้องสั่ง), และ **`StandardOutput=append:$REPO/backups/backup.log`** — `backup.sh` แค่ `echo` ลง stdout เฉยๆ ไม่เคยเปิดไฟล์ log เอง (บน Mac คือ `StandardOutPath` ใน plist ที่พามันไป) ถ้าปล่อยให้ systemd ส่งเข้า journald อย่างเดียว `backups/backup.log` จะ**ค้างอยู่ที่บรรทัดสุดท้ายของยุค macOS ตลอดไป** และหลอกทุกคนที่ `tail` มันดู.
     **Lesson:** (1) **สิ่งที่ commit ได้คือ "ตัวงาน" ไม่ใช่ "ตารางเวลา"** — `.plist`/`.timer`/crontab entry ที่วางไว้ใน repo เป็นแค่ template; ตัวที่ทำให้รันจริงคือ `launchctl load`/`systemctl enable`/`crontab -` ซึ่งเป็น state ของเครื่อง ไม่ใช่ของ repo. ย้ายเครื่อง/ย้าย OS เมื่อไหร่ **ให้ไล่รายการ "อะไรบ้างที่ยิงเองตามเวลา" แยกต่างหากจาก checklist ย้ายไฟล์** — มันจะไม่ error ให้เห็น มันแค่เงียบ. (2) **ปลดของเก่าออกให้สุด อย่าปล่อยให้เครื่องเดิมยังยิงงานเดิมค้างไว้** — ไม่ใช่แค่รก แต่เสี่ยงสร้าง backup ของข้อมูลเก่าที่ดูสมบูรณ์ (คู่ขนานกับเหตุผลที่ต้องปิด cloudflared บน Mac ตอน migration: กัน connector สองตัวบน token เดียวกัน). (3) **งานที่ผลลัพธ์คือ "ไม่มีอะไรเกิดขึ้น" ต้องมี active check เสมอ** — backup ที่ไม่ทำงานหน้าตาเหมือน backup ที่ทำงานทุกประการ ถ้าไม่มีใครถามอายุของ dump ล่าสุด; นี่คือ failure mode เดียวกับ #119 (process ที่ถูก delete ไปแล้ว `pm2 restart all` ไม่บ่นให้) จึงเป็นที่มาของ `--check` ทั้งใน `install-backup-timer.sh` และ `pm2-safe-restart.sh`.

124. **กล้องตัวเดียวกัน แต่ 2 สตรีมนับ ObjectID คนละชุด และซ่อน channel ไว้คนละ path — จับคู่ crop ใบหน้าพลาด 100% แบบเงียบ และเกือบเอาหน้าคนขาเข้าไปแปะบน event ขาออก** — 2026-07-27 (Dahua NVR face channel `HDY-NVR-02/03/04`, หน้า Face Recognition Matches): เจ้าของทักว่า "ระบบดึงภาพมาจาก NVR มีภาพใหญ่มาปนด้วย" — การ์ดใบหน้าบางใบเป็นภาพถนนทั้งเฟรม และเปิด modal ดูแล้ว **ช่อง "FACE (DETECTED)" กับ "CAMERA SCENE" เป็นภาพเดียวกันเป๊ะ**. **Root cause ชั้นแรก:** ทุก event พก `Object.Image {Offset,Length}` = crop ใบหน้าที่กล้องครอปเสร็จแล้วต่อท้าย scene JPEG มาให้อยู่แล้ว (7 วันย้อนหลัง **18,669 แถวมีครบทุกแถว**) แต่มี 3 ประตูปิดไว้: `connectSnapManager` ไม่เปิด stream ให้ device ที่เป็น face-only (`SNAP_SAFE_CODES` ว่าง), `parsePlateCutout` เช็ค `ObjectType=Plate` อย่างเดียว (face คือ `HumanFace`), และดึง cutout เฉพาะเมื่อ `isAnpr` → face เลยตกไปที่ `captureFrame()` แล้ว**เอาภาพเต็ม 1920×1080 ไปเก็บเป็น "ใบหน้า"**. **Root cause ชั้นสอง — 2 ข้อที่เห็นได้จากการวัดตอนรันจริงเท่านั้น:** (1) **ObjectID เป็นคนละ counter ระหว่างสตรีม** — DIAG-CUTOUT วัดสด 3 event ติดกันบน `HDY-NVR-03-ch1`: ฝั่ง eventManager ให้ `oid 281325/281329/281333` แต่ candidate ฝั่ง snapManager ที่ค้างใน cache คือ `674986` → เงื่อนไข `String(x.oid)===String(oid)` **reject ทุกใบ 100%** (ทั้งที่ ANPR ใช้ ObjectID จับคู่ได้ปกติ เพราะที่นั่นสองสตรีมอ่านตัวเดียวกันจริง); (2) **channel ซ่อนอยู่ที่ `Events[0].EventBaseInfo.Index`** ซึ่ง `parseSnapManagerIndex` ไม่รู้จัก (รู้จักแค่ `index=N` กับ `Events[N].Index=`) → crop ทุกใบถูก tag `channel=null` ซึ่ง filter **ปล่อยผ่านโดยตั้งใจ** (best-effort) แปลว่าบน NVR ที่มี 2 ช่อง (ขาเข้า/ขาออก) **ช่องไหนก็หยิบ crop ของอีกช่องได้** = หน้าคนขาเข้าไปโผล่บน event ขาออก — ผิดแบบดูน่าเชื่อ อันตรายกว่าไม่มีรูป. **ที่สำคัญ: ทั้งสองข้อไม่ทำให้ error อะไรเลย** ข้อ 1 แค่ "ไม่มีรูป" (เหมือนเดิมทุกประการ) ข้อ 2 แค่ "มีรูป" (แต่ผิดคน).
     **Fix:** (1) `parsePlateCutout` → `parseObjectCutout` รับ `ObjectType=(Plate|HumanFace)`; (2) `SNAP_FACE_CODES` = `{FaceRecognition, FaceAnalysis}` เปิด snapManager **เฉพาะ device ที่ไม่มี snapManager code ของตัวเองอยู่แล้ว** — ไม่ยุบรวมเข้า `SNAP_SAFE_CODES` เพราะบั๊ก empty-stream (#ดู 2026-07-17) เกิดจากขอ code เยอะเกินไปกับ device เดียว ส่วน face-only NVR ไม่เคยมี subscription ให้พัง และ device ผสมได้ code เท่าเดิมทุกตัว; (3) face จับคู่ด้วย **channel + time** ไม่ใช่ ObjectID และสอน `parseSnapManagerIndex` ให้อ่าน `EventBaseInfo.Index` ก่อน (ต้องแก้ข้อนี้**ก่อน** ถึงจะทิ้ง ObjectID ได้อย่างปลอดภัย ไม่งั้นเหลือ time-only = สลับช่องได้); (4) crop → `_snapshot`, scene → `_snapshot_full` ตาม convention ของ `FaceComparision` ที่ใช้ได้อยู่แล้ว 14,746 แถว. **Verify:** crop จริง 128×136 / 176×224 (1.5–2.3KB) คู่กับ scene 1920×1080 (~110KB) · cutout coverage 9% → 38% → **72%** หลัง cache อุ่น · `dahua-cgi-live` (ตัวที่ให้ภาพผิด) 4 → 1 · **ANPR ไม่กระทบ** hit 206/miss 50 (80%, ช่วงปกติ 60–77%) และ `plate_image` เขียนครบ 3,358/3,359 แถวใน 10 นาที.
     **ภาคต่อวันเดียวกัน — เอกสารเวนเดอร์ขัดกับ firmware จริง:** หลัง deploy วัดได้ว่า **ch0 ได้ crop 100% (81/81) แต่ ch1 ได้ 0% (0/25)** และ 19 ใน 25 นั้นไม่มีภาพเลยด้วยซ้ำ. ค้น API 3.37 §4.4.3 เจอว่า `channel` ของ `attachFileProc` คือ *"If not specified, the default value is 1"* + *"-1 means subscribing to all channels"* — แปลว่าโค้ดเดิมที่**ไม่ใส่** `&channel=` ไม่ได้แปลว่า "ทุกช่อง" อย่างที่คอมเมนต์ในโค้ดเขียนไว้ แต่แปลว่า **ช่องแรกช่องเดียว** (บนกล้อง ANPR ช่องเดียวสองอย่างนี้ผลลัพธ์เท่ากัน จึงไม่เคยมีอะไรมาขัดคอมเมนต์นั้นเลย). แต่พอใส่ `&channel=-1` จริงตามสเปก → NVR ตอบ **`ECONNRESET`** ตัด stream ทิ้ง และ **ลาก ch0 ที่เคยได้ 100% ร่วงเป็น 0% ทุกช่อง** ภายใน 7 นาที → revert ทันที ค่ากลับมา 100% เหมือนเดิม. **สรุป: พารามิเตอร์ที่เอกสารรับรอง ใช้ไม่ได้บน firmware ตัวนี้** — ช่องที่ 2 ขึ้นไปจึงยังไม่มี snapManager image (เท่าเดิมก่อนแก้ ไม่ได้แย่ลง) ทางที่เหลือคือเปิด subscription แยกต่อช่อง (`channel=N`, นับจาก 1) ซึ่งเปลี่ยนโมเดล one-stream-per-device — **เสนอไว้ ยังไม่ทำ**.
     **Lesson:** (0) **สเปกเวนเดอร์คือสมมติฐาน ไม่ใช่ข้อเท็จจริง — ต้องวัดทุกครั้ง** และเวลาลองพารามิเตอร์ใหม่กับ stream ที่ใช้งานจริงอยู่ ให้ถือว่า **downside คือ "พังทั้งเส้น" ไม่ใช่ "ไม่มีอะไรเกิดขึ้น"**: `channel=-1` ไม่ได้แค่ไม่ช่วย ch1 แต่ทำ ch0 ที่ทำงานดีอยู่แล้วพังไปด้วย. ถ้าไม่ได้ตั้งใจวัดผลหลัง deploy ทุกครั้ง จะกลายเป็นการ "แก้แล้วพัง" ที่ไม่มีใครรู้ — และเป็นเหตุผลที่ต้องกันของที่พิสูจน์แล้ว (ANPR ช่องเดียว) ไม่ให้โดนของใหม่แตะ. (1) **อย่าเหมาว่า field ชื่อเดียวกันจากอุปกรณ์เดียวกันคือค่าเดียวกัน** — `ObjectID` จาก eventManager กับจาก snapManager ของ NVR ตัวเดียวกันเป็นคนละ counter; ถ้าใช้เป็น key จับคู่โดยไม่พิสูจน์ จะได้ระบบที่ "reject ทุกใบ" ซึ่งหน้าตาเหมือน "ฟีเจอร์ยังไม่ทำงาน" ไม่ใช่ "จับคู่ผิด key" — เสียเวลาไล่ผิดทางได้ยาว. **วิธีจับ: log ค่าจากทั้งสองฝั่งพร้อมกันในบรรทัดเดียว** (นี่คือสิ่งที่ `DIAG_CUTOUT_ENABLED=1` ทำ และเป็นเหตุผลที่ควรเปิดตอนต่อ integration ใหม่ทุกครั้ง). (2) **filter ที่ "ปล่อยผ่านเมื่อค่าเป็น null" คือ silent-wrong-answer รอเกิด** — `channel===null` ถูกออกแบบให้ผ่านโดยตั้งใจ (best-effort ดีกว่าเข้มเกินข้อมูล) ซึ่งถูกสำหรับกล้องช่องเดียว แต่กลายเป็นอันตรายทันทีบน NVR หลายช่อง; ก่อนพึ่ง fallback แบบนี้ ต้องถามว่า "ถ้าค่านี้ null บนอุปกรณ์ที่มีหลาย unit จะเกิดอะไร". (3) **parser ที่คืน null เพราะ regex ไม่ครอบ shape ใหม่ ไม่ต่างจาก "ไม่มีข้อมูล"** — `parseSnapManagerIndex` คืน null ทั้งกรณี "firmware ไม่ส่ง" และ "ส่งมาแต่เราอ่านไม่เป็น" ซึ่งต่างกันสิ้นเชิง แต่ปลายทางเห็นเหมือนกัน. (4) **ค่าที่ probe ได้ ให้ subscribe เท่าที่วัด** — `SNAP_FACE_CODES` ใส่แค่ 2 code ที่ทดสอบจริง ไม่ลากทั้ง `DAHUA_CATEGORY_CODES.face` มา เพราะนั่นคือการกลับเข้าไปในดินแดนของบั๊ก empty-stream โดยไม่ได้อะไรเพิ่ม.

125. **คอลัมน์ที่ดูเป็นทางการแต่มีคนเขียนแค่ 2 path — `cameras.last_event_at` มีข้อมูลจริง 2 จาก 59 แถว ทำให้หน้าใหม่รายงานว่ากล้องดีทั้งหมด "เงียบ"** — 2026-07-27 (แท็บอุปกรณ์ H3): เขียน `/api/health/devices` ให้แยก "เงียบ" (ติดต่อได้แต่ไม่มีเหตุการณ์) ออกจาก "ตาย" (ติดต่อไม่ได้) โดยใช้ `cameras.last_seen_at` เป็นตัวชี้การติดต่อ และ `cameras.last_event_at` เป็นตัวชี้กิจกรรม — **ผลออกมาทุกกลุ่มขึ้น `quiet` 100%** ทั้งที่กล้องกำลังส่ง event เข้ามาเป็นพันรายการต่อชั่วโมง. **Root cause:** `last_event_at` ถูก `UPDATE` จากแค่ 2 จุดในโค้ดทั้งระบบ (`src/routes/face-push.js:80` และ `src/lpr-core.js:340`) ไม่ใช่จาก pipeline หลักที่ INSERT ลง `events` → `SELECT count(last_event_at) FROM cameras` = **2 จาก 59** ส่วน `last_seen_at` สุขภาพดี (59/59, สด 57). **ที่อันตราย:** ชื่อคอลัมน์อ่านแล้วเชื่อได้เลย อยู่ในตารางเดียวกับ `last_seen_at` ที่ใช้งานได้จริง และ query ก็ไม่ error — มันแค่คืน NULL ซึ่งโค้ดตีความเป็น "ไม่มีเหตุการณ์เลย" แทนที่จะเป็น "ไม่มีใครบันทึกไว้". **Fix:** ถามตาราง `events` ตรงๆ ด้วย group-by เดียว โดย**วัดราคาก่อนเปลี่ยน** — `EXPLAIN ANALYZE` ได้ **13ms** สำหรับหน้าต่าง 1 ชม. (partition pruning + `idx_events_camera_time`) จึงคุ้มกว่าการไปไล่แก้ให้ทุก ingester เขียนคอลัมน์นั้น. ผลหลังแก้: online 39 / paused 2 / quiet 1 ในกลุ่ม ANPR ซึ่งตรงกับความจริง.
     **Lesson:** (1) **ก่อนพึ่งคอลัมน์ที่ไม่ได้เขียนเอง ให้นับก่อนว่ามีข้อมูลกี่แถว** — `count(col)` เทียบ `count(*)` เป็นคำสั่งเดียวที่แยก "คอลัมน์ใช้งานได้" ออกจาก "คอลัมน์ที่เหลือรอดจากฟีเจอร์เก่า" ได้ทันที; ชื่อคอลัมน์ไม่ใช่สัญญา. (2) **NULL แปลว่า "ไม่รู้" ไม่ใช่ "ไม่มี"** — โค้ดที่แปล NULL เป็นค่าทางความหมาย (ที่นี่คือ "ไม่มีเหตุการณ์ = เงียบ") จะเปลี่ยนช่องว่างของข้อมูลให้กลายเป็นคำตอบที่ผิดแบบมั่นใจ. (3) **ตารางที่เป็นแหล่งความจริงมักถูกกว่าที่กลัว** — สัญชาตญาณบอกว่า "อย่าไปแตะ events 3.7M แถว" แต่พอวัดจริงคือ 13ms; การเดาราคาแล้วเลี่ยงไปใช้คอลัมน์ที่ denormalize ไว้ คือวิธีที่พาเรามาเจอบั๊กนี้ตั้งแต่แรก.

126. **topic คำสั่งใหม่ของ edge ต้องเพิ่ม 3 จุดใน bridge — ใส่ 2 จุดแล้ว "ส่งได้ 202 แต่ไม่มีอะไรเกิดขึ้น" ส่วนลืมจุดที่ 3 คือ message loop 139/วินาที** — 2026-07-27 (H2 Edge Service Management): เพิ่มคำสั่ง restart/stop ข้ามไปยัง edge ผ่าน `projects/<site>/_config/svc` — API ตอบ 202, audit_log มีแถว, แต่ **log ฝั่ง edge เงียบสนิท**. **Root cause:** `src/edge/bridge.js` ไม่ได้ relay ด้วย wildcard แต่ hardcode รายชื่อ topic ไว้ และต้องตรงกัน **3 ที่**: (ก) `r.subscribe([...])` ฝั่ง remote, (ข) เงื่อนไข allow ใน `r.on('message')` ที่ส่งต่อลง local, (ค) **loop guard ใน `local.on('message')`** — เพราะ `LOCAL_FILTER` เป็น `projects/<site>/#` ซึ่ง match ข้อความที่เพิ่ง relay ลงมาเอง ถ้าไม่กันจะเด้ง local→remote→local ไม่จบ. ขาด (ก) หรือ (ข) = คำสั่งหายเงียบ (อาการที่เจอ) · ขาด (ค) = **incident 2026-07-16 ที่ `scan-nvr` ทำให้เกิด bounce ~139 msg/s** จนต้องไล่แก้ด่วน. **Fix:** รวมเป็น `const DOWNLINK_TOPICS = [...]` ตัวเดียวแล้วให้ทั้ง 3 จุดอ้างอิงมัน — คำสั่งที่ 6 ในอนาคตจะเพิ่มไม่ครบไม่ได้อีก เพราะมีที่ให้เพิ่มที่เดียว.
     **Lesson:** (1) **ค่าคงที่ชุดเดียวกันที่ต้องปรากฏหลายที่ = บั๊กรอเกิด ให้ยุบเป็น array เดียวตั้งแต่ตัวที่สอง** ไม่ใช่รอจนตัวที่ห้า; ที่นี่ 4 คำสั่งแรกรอดมาได้เพราะคนเพิ่มจำได้ครบ ซึ่งไม่ใช่กลไก. (2) **อาการ "ส่งสำเร็จแต่ปลายทางไม่รู้เรื่อง" ให้ไล่ตามเส้นทางจริงทีละ hop** — 202 พิสูจน์แค่ว่า broker รับ ไม่ได้พิสูจน์ว่ามีใคร subscribe อยู่; log ที่ยืนยันว่า relay ถึงไหนแล้ว (`[bridge] subscribed config: ...`) คือสิ่งที่ทำให้เจอใน 2 นาทีแทนที่จะเดา. (3) **คำสั่งข้ามเครื่องต้องมีทางรู้ผลกลับเสมอ** — ที่นี่คือ `_config/svc-result` → `edge_status.last_svc_result` เพราะถ้าไม่มี ผู้ใช้จะแยก "คำสั่งไม่ถึง" ออกจาก "ถึงแล้วแต่ทำไม่สำเร็จ" ไม่ได้เลย.

127. **Import ที่ await ทั้งก้อนโดนตัดที่ ~100s ของ Cloudflare — browser ได้หน้า error HTML กลับมาแทน JSON แล้ว `JSON.parse` ระเบิดด้วย "Unexpected token '<'"** — 2026-07-27 (`POST /api/blacklist/sources/:id/import` หน้า GuruSquare re-import): เจ้าของกด import แล้วเจอ dialog "Import failed: Unexpected token '<', "<!DOCTYPE "... is not valid JSON". **Root cause:** GuruSquare import วนดึงทีละเดือนผ่าน edge proxy — วัดจริง 1 หน้าต่าง = 4.4s, default range ตั้งแต่ 2023-01-01 = 43 หน้าต่าง = **75-190 วินาที** แล้วแต่ปริมาณ endpoint เดิม `await runImport(...)` ทั้งก้อนก่อนตอบ → **Cloudflare ตัดการเชื่อมต่อที่ ~100 วินาที** แล้วส่งหน้า error ของตัวเองแทน (ไม่ใช่ JSON) เบราว์เซอร์เอาไป parse เลยพัง — **แต่ import ฝั่ง server ยังทำงานต่อจนจบจริง** (ยืนยัน: รันแยกจาก localhost ไม่ผ่าน Cloudflare ได้ 1,083 rec สำเร็จใน 82s) เจ้าของเห็น error ทั้งที่งานเสร็จสมบูรณ์. **Fix:** endpoint ตอบ **202 ทันที** (43ms) แล้วรัน `runImport` แบบไม่ await ต่อในเบื้องหลัง, สถานะเก็บใน `last_import_status` ที่ frontend poll ทุก 3s แทนการรอ response เดียว, กันกดซ้ำด้วย in-memory `Set` (409 ถ้ามีรันอยู่), และ**ล้างสถานะ `running` ค้างตอน boot** (เจอจริงระหว่างทดสอบ: restart api-server ระหว่าง import ค้าง ปุ่มค้างที่ "Importing..." ตลอดกาลเพราะไม่มีใครมาเคลียร์ `last_import_status='running'` ที่ไม่มีโปรเซสไหนเป็นเจ้าของแล้ว).
     **Lesson:** (1) **endpoint ที่พึ่ง external call วนหลายรอบ ต้องคูณเวลาต่อรอบด้วยจำนวนรอบก่อนออกแบบ ไม่ใช่ทดสอบแค่ 1 รอบแล้วเข้าใจว่าเร็ว** — 4.4s/หน้าต่างดูเร็ว แต่ ×43 คือคนละเรื่อง และ reverse-proxy ทุกตัว (Cloudflare, nginx, ALB) มี timeout ของตัวเองที่ไม่ขึ้นกับโค้ดเรา. (2) **error message จาก proxy (`<!DOCTYPE...`) กับ error จาก application logic หน้าตาต่างกันชัด — เห็น `<` ตัวแรกของ JSON ที่ควรเป็น `{` ให้สงสัย proxy/timeout ก่อนเสมอ** ไม่ใช่เดาว่าโค้ด parse พัง. (3) **สถานะที่เขียนไว้ว่า "กำลังทำงาน" (`running`/`in_progress`/ธง in-memory) ต้องมีคนล้างมันตอน process เริ่มใหม่เสมอ** — ถ้าไม่มี restart กลางคันจะทิ้งสถานะ orphan ที่ไม่มีเจ้าของไปตลอดกาล เป็น failure mode เดียวกับ #119 (pm2 process ที่ถูกลบ) และ #123 (backup schedule หาย).

128. **คอลัมน์ `alert_mode`/`region` มีอยู่ในตารางและแสดงผลในหน้าเว็บมาหลายเดือน แต่ query ที่ยิง alert จริงไม่เคยอ่านมันเลยสักบรรทัด — เลือก "ป้าย + จังหวัด" ไม่มีผลอะไรกับการแจ้งเตือนจริง** — 2026-07-27 (เจ้าของถามเรื่องจัดกลุ่ม Alert Match Mode): ตรวจ 5 จุดที่ JOIN `lpr_watchlist` เพื่อยิง alert (`lpr-alerts.js` ×1, `lpr-query.js` ×4) พบว่า**ทุกจุดเทียบแค่ `w.plate_number = UPPER(lp.plate_number) AND w.active`** ไม่มีจุดไหนอ้างถึง `w.alert_mode` หรือ `w.region` เลย ทั้งที่ทั้งสองคอลัมน์มีอยู่ในตาราง มีฟอร์มให้ตั้งค่า และมีข้อความแสดงผลในหน้าเว็บ ("จับคู่: ป้าย + จังหวัด") — ผู้ใช้งานเลือกโหมดนี้ได้จริงแต่**ไม่มีผลต่อพฤติกรรมระบบแม้แต่นิดเดียว**มาตั้งแต่ฟีเจอร์ถูกสร้าง. **เจอเพิ่ม:** โหมดนี้อยู่ระดับ**ป้ายทะเบียน**ไม่ใช่ระดับ**กลุ่ม** ทั้งที่ทุกป้ายในกลุ่มเดียวกันควรใช้นโยบายเดียวกัน (bridge sync hardcode `'plate'` ทุกแถวไม่สนใจ input เลยด้วยซ้ำ). **Fix:** ย้าย `alert_mode` ไปเป็น `default_alert_mode` ของกลุ่ม (migration 099) cascade ลงป้ายสมาชิกทุกครั้งที่กลุ่มเปลี่ยนโหมด, เพิ่มเงื่อนไข `AND (w.alert_mode <> 'plate_region' OR w.region = lp.region)` ในทั้ง 5 query, และเปลี่ยนกลุ่มเป็น `plate_region` ตอนที่ป้ายในกลุ่มไม่มี province จะ**เตือนแบบไม่บล็อก** (จำนวนป้ายที่จะเงียบ) แทนที่จะปิดการแจ้งเตือนอย่างเงียบๆ.
     **Lesson:** (1) **"มีคอลัมน์ + มี UI ให้ตั้งค่า" ไม่ใช่หลักฐานว่าโค้ดใช้ค่านั้นจริง** — ต้องไล่ทุก query ที่เป็นเส้นทางจริง (ที่นี่คือ 5 จุดที่ยิง alert) แล้วเช็คว่า WHERE/JOIN อ้างถึงคอลัมน์นั้นหรือเปล่า ไม่ใช่เชื่อว่ามันมีอยู่แล้วต้องทำงาน. (2) **ฟีเจอร์ที่ทำงานเงียบ (ไม่ error ไม่มีอะไรเตือน) อันตรายกว่าฟีเจอร์ที่ error ชัดเจน** — เจ้าหน้าที่ที่ตั้งใจเลือก "ป้าย+จังหวัด" เพื่อลด false positive เชื่อว่ามันทำงานอยู่มาหลายเดือน ทั้งที่จริงมันไม่เคยกรองอะไรเลย. (3) **ระดับ config ต้องตรงกับระดับที่นโยบายควรถูกตัดสินใจ** — โหมดจับคู่เป็นนโยบายของกลุ่ม (ทุกป้ายในกลุ่มเดียวกันควรเหมือนกัน) การให้ตั้งต่อป้ายเปิดช่องให้ป้ายสองใบในกลุ่มเดียวกันมีพฤติกรรมต่างกันโดยไม่มีเหตุผล.

129. **ข้อมูล master เดียวกันมี 2 source records คุณภาพต่างกันมาก (ไม่มีรูป/โค้ดดิบ vs รูปจริง/ถอดรหัสแล้ว) — bridge เลือกจากแหล่งเดียว (rule's own source) เสมอ ไม่เคยมองข้ามไปหา record ที่ดีกว่าจาก source อื่นที่ผูก master เดียวกัน** — 2026-07-27 (เจ้าของสังเกตจากหน้า alert ว่าป้าย "ขงจ377" ไม่มีรูปอ้างอิงและ note เป็นโค้ดดิบ "ยี่ห้อ 2 · สี 11 · ยะลา" ทั้งที่ Details modal โชว์ record จาก GuruSquare ของ master เดียวกันมีรูปจริงและ note อ่านง่าย). **Root cause:** `blacklistBridge.js`'s `desiredRows()` ดึง label/notes/region จาก **source_record ของ rule เอง** เท่านั้น (ที่นี่ rule ผูกกับ DSS Pro) ไม่เคยเช็คว่า master เดียวกันมี record จาก source อื่นที่ข้อมูลดีกว่าไหม — 130 จาก 347 ป้ายในกลุ่ม "รถตามหมายจับ" มี GuruSquare record คู่กันที่มีรูป+province+note คุณภาพดีกว่า DSS แต่ไม่เคยถูกใช้เลย. **Fix:** เพิ่ม `bestRecordsByMaster()` — query เดียว (`DISTINCT ON` + `ORDER BY` ให้คะแนน: มีรูป > มี province > note ยาวกว่า) เลือก record ที่ดีที่สุด**ข้ามทุก source ที่ผูก master เดียวกัน** โดย**ไม่แตะ membership ของ rule** (rule ยังกรองว่า "ป้ายไหนเข้ากลุ่ม" จาก source ของตัวเองเหมือนเดิม เพื่อคุมปริมาณผ่าน `group_name` ได้ต่อ) — แยก "ใครเข้ากลุ่ม" ออกจาก "ข้อมูลไหนโชว์" ให้ชัด. รูปอ้างอิงถูก copy จาก `blacklist-photos/` มาที่ `snapshots/lpr-watchlist/wl_bridge_<master_id>.jpg` (ชื่อไฟล์คงที่ต่อ master กันไฟล์ซ้ำสะสมทุกรอบ sync). ผล sync จริง: 130/347 อัปเดต, 128 ได้รูปจริง, รันซ้ำเป็น no-op (idempotent ยืนยันแล้ว).
     **Lesson:** (1) **เมื่อข้อมูลจากหลายแหล่งถูก dedup รวมเป็น entity เดียว (master) แล้ว การเลือกข้อมูลแสดงผลต้องพิจารณาทุกแหล่งที่ผูกกับ entity นั้น ไม่ใช่แค่แหล่งที่ทำให้มันถูกเลือกเข้ามาตั้งแต่ต้น** — "ทำไมถูกเลือก" (membership) กับ "ควรโชว์อะไร" (content) เป็นคนละคำถามที่แยกออกจากกันได้และควรแยก. (2) **completeness heuristic ต้อง deterministic และวัดผลก่อนใช้จริงเสมอ (preview ก่อน sync)** — ที่นี่ diff() ยังเป็น pure read ไม่มี side effect แม้จะมี logic ใหม่ ทำให้ preview ปลอดภัย 100% ก่อนกด sync จริงบนข้อมูล production ของตำรวจ.

130. **ป้ายที่ bridge เข้า watch-list โดยไม่มี province ยืนยัน ไม่ใช่แค่ "แจ้งเตือนน้อยแม่นยำกว่า" — วัดจริงคือ 93% เป็น false collision (ป้ายซ้ำข้ามจังหวัด ไม่ใช่รถเป้าหมาย)** — 2026-07-27 (เจ้าของถามว่า GuruSquare ผูกกลุ่มจริงไหม + รูปมาจาก DSS จริงหรือ + เสนอว่าข้อมูลไม่มีจังหวัดไม่มีประโยชน์ให้ตัดทิ้ง). **วัดจริงก่อนตัดสินใจ:** เทียบป้ายกลุ่ม "รถตามหมายจับ" 997 ป้าย (867 ใหม่จาก GuruSquare + 130 ที่มี province คู่กับ DSS) กับ event จริง 7 วัน — จับคู่แบบเทียบแค่ป้าย (ไม่เช็ค province) = 2,482 ครั้ง แต่จับคู่แบบเช็ค province ตรงกันด้วย = 186 ครั้ง เท่านั้น (93% ของที่เคยดูเหมือน "เจอ" คือรถอื่นที่บังเอิญป้ายซ้ำกันคนละจังหวัด ไม่ใช่รถเป้าหมาย). DSS Pro ยืนยันแล้วว่า**ไม่มี province ในข้อมูลแม้แต่แถวเดียว** (`count(province)=0` จาก 516 lpr records) และ**ไม่มีรูปแม้แต่แถวเดียว** — รูป/province ทั้งหมดที่เห็นในหน้า alert มาจาก GuruSquare ที่ผูก master เดียวกันเสมอ (ดู #129), ไม่เคยมาจาก DSS. **Fix:** (1) `desiredRows()` ใน `blacklistBridge.js` ข้าม (ไม่เพิ่มเข้า `byPlate` เลย) ทุก master ที่กลุ่มปลายทางตั้ง `default_alert_mode='plate_region'` แต่ไม่มี province จากแหล่งไหนเลย — ตัดทิ้งจริง ไม่ใช่แค่ปิดเสียงแจ้งเตือน (ตาม #128 ที่แค่เตือนไม่บล็อก, ตอนนี้ยกระดับเป็นไม่เก็บเลยเมื่อกลุ่มต้องการ province). (2) เพิ่ม bridge rule ผูก GuruSquare (ทุก record, ไม่กรอง group_names) เข้ากลุ่ม "รถตามหมายจับ" ตรงๆ (เดิม GuruSquare ไม่เคยถูกผูกกลุ่มไหนเลย). (3) sync จริง: add 867 / update 130 / remove 217 (DSS-only ที่ไม่มี province ที่ไหนเลย ถูกลบออกจาก watch-list จริง) — verify แล้วรันซ้ำเป็น no-op, รูปอ้างอิง materialize ครบ 981/997 แถว, alert volume จริงหลังเปลี่ยนเหลือ 182 ครั้ง/7วัน (≈26/วัน) ซึ่งคือของจริงที่ verify แล้วว่าจังหวัดตรงกัน. (4) `blacklistImport.js` เพิ่มนับ `stats.noProvince` ระหว่าง import (GuruSquare ที่บางแถวไม่มี province + DSS Pro vehicle ที่ไม่มี province ทุกแถวโดยธรรมชาติของแหล่ง) แล้วโชว์ในข้อความ `last_import_note` ที่มีอยู่แล้ว ("N ป้ายไม่มีจังหวัด...") ให้เห็นทันทีหลังนำเข้าแต่ละครั้ง แทนที่จะเงียบจนมีคนสงสัยว่าทำไมป้ายนี้ไม่เคยเตือน.
     **Lesson:** (1) **"เก็บไว้เผื่อมีประโยชน์" ผิดเมื่อข้อมูลนั้นพิสูจน์ไม่ได้ว่าตรงเป้าหมายจริง** — สำหรับ watch-list ความปลอดภัย ป้ายที่ไม่มี province ยืนยันแทบไม่ต่างจากไม่มีข้อมูลเลย เพราะระบบไม่มีทางรู้ว่า "ตรง" ที่เจอคือรถเป้าหมายหรือรถอื่นที่ป้ายซ้ำ — วัดตัวเลขจริงก่อนเชื่อสัญชาตญาณว่า "มีข้อมูลย่อมดีกว่าไม่มี". (2) **การนับ/แจ้ง gap ของข้อมูล (log/warn) ทำได้ทันทีโดยไม่ต้องรอไฟเขียว ต่างจากการ throw/block ที่ต้องรอ** (WA #3 ข้อ 4) — เพิ่ม `noProvince` notice ที่ import โดยไม่กระทบ control flow เดิมเลย.

131. **`SNAPSHOT_DIR` ถูกนิยามซ้ำ 10 โมดูล — มีแค่ 2 ที่อ่าน env อีก 8 hardcode → ตั้ง env เพื่อย้าย snapshot ไปดิสก์ใหม่ = monitor ไปดูดิสก์ที่ไม่มีใครเขียน ส่วนไฟล์จริงยังลง root SSD ต่อจนเต็ม** — 2026-07-30 (ติดตั้ง RAID 1 ที่ hkt แล้วเขียน `helpers/storageHealth.js` ให้รายงาน storage ขึ้นหน้า Health): ตอนไล่ตรวจเจอว่า path เดียวกันนี้ถูกประกาศใหม่ทุกไฟล์ที่ต้องใช้ และไม่ตรงกัน —
     **อ่าน env (2):** `edge/bridge.js`, `helpers/blacklistBridge.js` · **hardcode (8):** `lpr-receiver.js`, `edge-config-agent.js`, `api-server.js`, `mqtt-subscriber.js`, `line-sender.js`, `ingesters/hikvision-isapi.js`, `ingesters/dahua-cgi.js`, `stats-summary-route.js`.
     ทุกตัวเป็นคนละ process จึงไม่มีจังหวะไหนเลยที่ความไม่ตรงกันจะโผล่ตอน start — ไม่มี error ไม่มี warn. ที่แย่กว่านั้น `edge-config-agent.js` วาง `const SNAPSHOT_DIR` ไว้ **เหนือ** `require('dotenv').config()` ของตัวเอง แปลว่าต่อให้ใครแก้ให้อ่าน env ตรงนั้น ก็ยังได้ `undefined` อยู่ดี (กับดักตัวเดียวกับที่ `dahua-cgi.js:69` เขียนเตือนไว้แล้ว).
     **ทำไมยังไม่ระเบิด:** ทุก site **ไม่ได้ตั้ง `SNAPSHOT_DIR`** เลยสักเครื่อง ทั้ง 10 เส้นจึง resolve ไป `<repo>/snapshots` เหมือนกันหมด และดิสก์ media ถูก mount ทับ path นั้นตรง ๆ. บั๊กรอ **วันที่มีคนตั้ง env นี้** เพื่อย้าย snapshot โดยไม่แตะ mount point — วันนั้น writer 8 ตัวยังเขียนลง root SSD ขณะที่ `bridge` รายงานพื้นที่ว่างของดิสก์ใหม่ที่ไม่มีใครเขียน → หน้า Health เขียวสนิทจน root เต็ม. อาการเหมือน #99 เป๊ะ แต่ tripwire `snapshot_dedicated` ใน `storageHealth.js` **จับไม่ได้** เพราะมันตรวจ path ที่ bridge เชื่อ ไม่ใช่ path ที่ writer ใช้.
     **Fix (2026-07-30):** ยุบเหลือ `src/helpers/snapshotDir.js` แหล่งเดียว แล้ว require ทั้ง 10 จุด. เป็น **function ไม่ใช่ const** โดยตั้งใจ — caller require ไว้บนสุดของไฟล์แต่ต้องไม่อ่าน env ก่อน dotenv ทำงาน และตำแหน่ง dotenv ต่างกันทุก entry point; ถ้า export เป็น constant มันจะ freeze ค่า env ณ ตอน require ครั้งแรกในกราฟ ไม่ว่าจะเกิดที่ไหน. ย้าย const ใน `edge-config-agent.js` ลงใต้ dotenv ด้วย. เป็น pure refactor: ค่าที่ resolve ได้เท่าเดิมทุกจุดเมื่อไม่ตั้ง env (คือสภาพปัจจุบันของทั้ง 4 เครื่อง) — `test/snapshot-dir.test.js` ยืนยันทั้งค่า default, การ override, และ regression guard ที่ fail ถ้ามีใครเขียน `path.join(…, 'snapshots')` กลับเข้าไปในไฟล์ใดไฟล์หนึ่งใน 10 นั้นอีก.
     **Lesson:** (1) **ค่าคงที่ที่ต้องปรากฏหลาย process ให้เป็น env-with-default ทุกจุด หรือ hardcode ทุกจุด — ห้ามผสม** เพราะ "บางตัวอ่าน env" คือ config ที่ทำงานถูกจนถึงวันที่มีคนใช้มันจริง (ซ้ำรอย #126: ค่าชุดเดียวกันกระจายหลายจุด = บั๊กรอเกิด — ที่นั่นเป็น 4 จุด ที่นี่ปล่อยจนถึง 10). (2) **monitor ต้องวัด path ที่ writer ใช้ ไม่ใช่ path ที่ตัวเองคำนวณ** — `sampleStorage()` รับ `snapshotDir` เป็น argument ซึ่งถูกแล้ว แต่ถูกแค่ครึ่งเดียวตราบใดที่ caller แต่ละตัวคำนวณคนละแบบ. (3) **ตอนตรวจว่า "ค่านี้ถูกนิยามกี่ที่" ให้ grep ทั้ง repo ก่อนสรุปตัวเลข** — รอบแรกผมนับได้ 3 จุดจากไฟล์ที่กำลังแก้อยู่ ความจริงคือ 10 และถ้ายุบแค่ 3 จุดตามที่นับผิด จะได้ helper ที่แย่กว่าไม่ทำ เพราะจะดูเหมือนแก้แล้วทั้งที่ยังเหลือ writer หลุดอีก 7 ตัว.

132. **FortiGate deep inspection ทำให้ `edge-bridge` ตาย `unable to verify the first certificate` แต่ `cloudflared` ทำงานปกติทุกอย่าง — เสีย 2 ชั่วโมงไล่โค้ด TLS ทั้งที่ปัญหาไม่ได้อยู่ในเครื่องเลย** — 2026-07-29 (deploy site `hkt` ที่ภูเก็ต, เครือข่ายลูกค้ามี FortiGate 120G): edge ใหม่ต่อ `wss://dashboard.dojojin.tech/mqtt` ไม่ติด, log วน reconnect ด้วย `unable to verify the first certificate` ตลอด. ที่หลอกที่สุดคือ **Cloudflare Tunnel ขึ้น healthy พร้อมกัน** — `hkt.dojojin.tech` และ `sshhkt.dojojin.tech` เข้าได้ปกติ ทำให้ดูเหมือน "เน็ตออกได้ ปัญหาอยู่ที่โค้ด/cert bundle ของ Node".
     **Root cause 2 ชั้น ซ้อนกัน:** (1) **SSL deep inspection** — `openssl s_client -connect dashboard.dojojin.tech:443` ได้ issuer `CN=FG120GTK25038058, O=Fortinet` ไม่ใช่ Let's Encrypt คือไฟร์วอลล์ MITM แล้วเซ็นใหม่ด้วย CA ของตัวเองที่ Node ไม่รู้จัก. (2) หลังแอดมินปลด deep inspection แล้วยังต่อไม่ได้ — คราวนี้ body ที่ได้กลับมาเป็น `<title>Web Filter Violation</title>` คือ **FortiGuard web filter** บล็อกโดเมนอีกชั้น เป็นคนละ policy คนละที่ตั้งค่า. **ทำไม cloudflared รอด:** มันวิ่ง **QUIC บน UDP/7844** ซึ่งไม่ผ่าน TCP-443 TLS proxy ของ FortiGate เลย — "tunnel ขึ้น" จึงไม่ใช่หลักฐานว่า TLS ขาออกใช้ได้ แม้แต่นิดเดียว.
     **Lesson:** (1) **เจอ cert error บน site ลูกค้า ให้ยิง `openssl s_client -connect <host>:443 </dev/null 2>/dev/null | grep issuer` เป็นคำสั่งแรก ก่อนแตะโค้ดสักบรรทัด** — 1 วินาทีนี้แยก "โค้ดผิด" ออกจาก "ไฟร์วอลล์ MITM" ได้เด็ดขาด และอย่าเชื่อผลจากเครื่องตัวเองหรือ site อื่น เพราะ policy ผูกกับโดเมน+ปลายทาง ไม่ใช่ทั้งเครือข่าย (ที่นี่ `github.com` ผ่านฉลุย แต่ `dojojin.tech` โดน). (2) **service ที่ยังเขียวไม่ใช่หลักฐานว่า path เครือข่ายที่คนละ protocol ใช้ได้** — เทียบ protocol/port จริงก่อนเอาไปอ้าง. (3) **ไฟร์วอลล์องค์กรมักบล็อกซ้อนหลายชั้น** — แก้ชั้นแรกแล้วยังไม่ผ่าน อย่าเพิ่งสรุปว่าแอดมินยังไม่ได้ทำ ให้ดู response body จริง มันบอกเองว่าใครบล็อก. (4) **ห้ามแก้ด้วย `NODE_TLS_REJECT_UNAUTHORIZED=0`** — นั่นคือยอมรับ MITM ถาวรเป็นลายลักษณ์อักษร; ทางแก้จริงคือขอ policy exception (ดู `docs/hkt-firewall-request_2026-07-29.pdf` เป็นแม่แบบเอกสารขอ) หรือใช้ tailnet เป็นเส้นสำรอง.

133. **`FACE_PUSH_ALLOW` default เป็น IP ของ site แรกที่เคย deploy (`192.168.10.235`) — site ใหม่ที่คนละ subnet จะ drop face push ทุก request แบบเงียบ ๆ ตั้งแต่วินาทีแรก** — 2026-07-30 (ตรวจ service ที่ hkt ให้ครบเท่า hdy ก่อนติดกล้อง): `src/ingesters/hikvision-isapi.js:1060-1061` = `new Set((process.env.FACE_PUSH_ALLOW || '192.168.10.235').split(','))` แล้ว `:1406` `if (!FACE_PUSH_ALLOW.has(src)) { ... }` ปฏิเสธทุก IP ที่ไม่อยู่ใน set. ค่า default นั้นคือ IP กล้องจริงของ site ที่ deploy เป็นที่แรก ซึ่งกลายเป็น default ของทั้ง codebase โดยไม่ได้ตั้งใจ. `hkt` อยู่ `10.0.10.0/24` → กล้องทุกตัวที่นี่ถูกปฏิเสธ 100% ถ้าไม่ตั้ง env.
     **ทำไมเงียบ:** มันเป็น **push** — กล้องยิงเข้ามาหา server แล้วโดนปัด, ฝั่ง server ไม่มี event ให้แสดง จึงดูเหมือน "กล้องยังไม่ส่ง" หรือ "ตั้งค่าฝั่งกล้องผิด" ไม่ใช่ "server ปฏิเสธ". log บรรทัดตอน start (`:1467`) พิมพ์ allowlist ที่ใช้จริงอยู่แล้ว แต่ต้องเปิดอ่านถึงจะเห็น. reproduce ได้ทันที: `curl -X POST -F x=1 http://<edge-ip>:3010/` → **403** จากทุก IP ที่ไม่อยู่ใน set (ยิงจาก 127.0.0.1 ก็ 403 เพราะ loopback ก็ไม่ได้อยู่ใน default).
     **สำคัญ — มี face push 2 เส้นทาง auth คนละแบบ อย่าสับสน:** (ก) **LAN-direct → `:3010`** face alarm server ของ `hikvision-isapi.js` ใช้ **source IP allowlist** = เส้นที่โดนบั๊กนี้; (ข) **tunnel → `:3003` `POST /face-push/:token`** ของ `lpr-receiver` ใช้ **token ต่อกล้อง** (`face_push_token` ใน `cameras-config.json`) **ไม่มี IP check เลย** โดยตั้งใจ เพราะ Cloudflare บัง source IP ไปแล้ว (`routes/face-push.js:13-16`) — เส้นนี้**ไม่เกี่ยวกับ `FACE_PUSH_ALLOW`**. ก่อนจะสรุปว่า "face push พังเพราะ allowlist" ต้องรู้ก่อนว่ากล้องตัวนั้นถูกตั้งให้ยิงเส้นไหน. และ**กล้องไม่จำเป็นต้องอยู่ subnet เดียวกับ edge box** ขอแค่ route ถึงกัน (ที่ hkt: box `10.0.10.50`, กล้อง face `10.1.100.59`, ping 1 ms — LAN-direct ใช้ได้ปกติ แค่ต้องใส่ IP ใน allowlist).
     **Lesson:** (1) **allowlist ห้ามมี default ที่เป็นค่าจริงของ environment ใดสภาพแวดล้อมหนึ่ง** — default ควรเป็น "ว่าง แล้ว log warn ดัง ๆ ว่ายังไม่ได้ตั้ง" หรือ "ทั้ง subnet ของ interface ตัวเอง" อย่างใดอย่างหนึ่ง เพราะค่าที่ถูกสำหรับ site แรกคือค่าที่ผิดสำหรับทุก site หลังจากนั้น และมันจะผิดแบบดูเหมือนทำงานปกติ. (2) **เพิ่ม `FACE_PUSH_ALLOW` เข้า checklist ของ `docs/REF_edge-site-checklist.md` ก่อนติดกล้อง Hik ทุก site** — ไม่ใช่ค่าที่จะไปแก้ตอน debug. (3) **security control ที่ fail-closed ต้องดังตอน fail** — ปฏิเสธเงียบทำให้คนไล่หาสาเหตุผิดฝั่ง (ไปแก้ที่กล้อง) ซึ่งเสียเวลากว่าตัว bug เองหลายเท่า.

134. **DDL ที่ต้องใช้ ACCESS EXCLUSIVE อยู่ในไฟล์ migration = บล็อก INSERT ทั้งระบบได้ ถ้าไปชนกับ `pg_dump` กลางคืน — และ lock ที่ "รอ" ไม่ได้รอเงียบ ๆ มันลากทุก write เข้าคิวตามหลังด้วย** — 2026-07-31 (Phase 2 optimize: `db_migration_105` ลบ index ที่ไม่ถูกใช้ 2 ตัวออกจาก `events`): migration รันตอน api-server boot ตามปกติ แล้ว ingest หยุดไหลไป **100 วินาที**. `DROP INDEX` บน partitioned table ต้องขอ **ACCESS EXCLUSIVE** บน parent `events` แต่ตอนนั้น **backup กลางคืนกำลังรัน** ถือ ACCESS SHARE ผ่าน `COPY public.license_plates` อยู่ → drop ขอ lock ไม่ได้. **จุดที่คนมักเข้าใจผิด:** ปกติ ACCESS SHARE (อ่าน) กับ RowExclusive (INSERT) เข้ากันได้สบาย แต่พอมี ACCESS EXCLUSIVE **ต่อคิวคั่นกลาง** postgres จะไม่ปล่อยให้ INSERT ที่มาทีหลังแซง → INSERT ทุกตัวหลังจากนั้นค้างหมด ทั้งที่ตัวที่บล็อกจริง (pg_dump) ไม่ได้ขวาง INSERT เลย. อาการที่เห็น: `pg_stat_activity` มี INSERT `state=active` ค้าง 70+ วิ, `pg_blocking_pids()` ชี้ไปที่ pid เดียวกันหมด, `pg_locks WHERE NOT granted` = 8. **ผลกระทบจริง: ไม่มีข้อมูลหาย** — ตรวจ event ต่อนาทีในช่วงนั้น (69/57/71) เทียบก่อน-หลัง (60–79) แล้วเท่ากัน = INSERT เข้าคิวแล้วลงครบ ไม่ได้ถูก drop. **Fix:** ย้าย DDL แบบนี้ออกจาก migration ทั้งหมด — migration รันตอน boot ซึ่งไม่มีใครเฝ้า และ failure ตรงนั้น abort startup โดยตั้งใจ (STUBBORN_FACT #81) → รันมือพร้อม `SET lock_timeout = '5s'` ที่ **ล้มเร็วแทนที่จะเข้าคิว** แล้วลองใหม่ตอนที่ backup ไม่ได้รัน; ส่วน volume ใหม่แก้ที่ `init.sql` ให้ไม่สร้าง index นั้นตั้งแต่แรก. **ที่ยังไม่ทราบ:** `pg_cancel_backend()` คืน `true` แต่ migration ก็ทำงานจนจบ — อาจส่งไปหลัง DROP เสร็จแล้ว **อย่าสรุปว่า cancel ใช้กับ migration ไม่ได้**. **Lesson:** ก่อนใส่ DDL ลง migration ให้ถามว่า "ถ้าอันนี้รอ lock 5 นาทีตอนตี 3 จะเกิดอะไรขึ้น" — ถ้าคำตอบคือ "ระบบหยุดรับข้อมูล" มันไม่ควรอยู่ในไฟล์ที่รันตอน boot.

135. **`pm2 restart a b` ล้มทั้งคำสั่งถ้าชื่อใดชื่อหนึ่งไม่มีอยู่บนเครื่องนั้น — process ที่มีอยู่จริงจะไม่ถูก restart เลย และ deploy script ก็ไม่ฟ้องอะไร** — 2026-07-31 (deploy Phase 4 ไป 3 edge): รัน `pm2 restart dahua lpr-receiver` พร้อมกันทั้ง 3 ไซต์. hdy กับ vss ผ่านปกติ แต่ **hkt ไม่มี process ชื่อ `dahua`** (กล้อง Dahua ที่นั่นเข้าทาง `lpr-receiver` ไม่ได้ใช้ CGI ingester) → pm2 ล้มทั้งคำสั่ง **`lpr-receiver` ที่มีอยู่จริงจึงไม่ถูก restart** ยังรันโค้ดเก่าต่อไป. ที่หลอกคือ **`git pull` สำเร็จและ log ขึ้น commit ใหม่ถูกต้อง** ทำให้ดูเหมือน deploy ครบแล้ว.
     **อาการที่เห็น:** verify หลัง deploy แล้วฟิลด์ใหม่ยังไม่มา จึงไปไล่หาสาเหตุที่โค้ด (ผิดที่) กว่าจะจับได้ก็ตอนดู `pm2 jlist` แล้วเห็น **`lpr-receiver up 8119s`** ทั้งที่เพิ่งสั่ง restart ไปเมื่อกี้ — **uptime คือหลักฐานเดียวที่บอกความจริง ไม่ใช่ exit code ของคำสั่ง restart**.
     **Fix:** วนทีละชื่อ และเช็คว่ามีอยู่ก่อน — `for P in lpr-receiver dahua hikvision edge-bridge; do pm2 describe $P >/dev/null 2>&1 && pm2 restart $P; done` แต่ละไซต์มี process set ไม่เหมือนกันโดยธรรมชาติ (hkt ไม่มี `dahua`, hdy/vss มี) การเขียนคำสั่งเดียวให้ใช้ได้ทุกไซต์จึงต้องทนกับชื่อที่ขาดหายได้.
     **Lesson:** (1) **หลัง restart ต้องยืนยันด้วย uptime เสมอ** ไม่ใช่แค่ดูว่าคำสั่งไม่ error — `pm2 jlist` แล้วดู `pm_uptime` ของทุกตัวที่ตั้งใจจะ restart. (2) **คำสั่ง deploy ที่ยิงหลายไซต์พร้อมกันต้องทนกับความต่างของแต่ละไซต์** — ไซต์ที่ process set ไม่เหมือนกันคือเรื่องปกติ ไม่ใช่ข้อยกเว้น. (3) `git pull` สำเร็จ **ไม่ใช่** หลักฐานว่าโค้ดใหม่กำลังรันอยู่.

136. **query ที่ผลลัพธ์ขึ้นกับ "แถวไหนมาก่อน" แต่ไม่มี `ORDER BY` = ถูก 100% ทุกครั้งที่เทสต์ และผิดเฉพาะหลัง import — เพราะสิ่งที่กำหนดลำดับจริงคือ heap order ของตารางที่ join เข้าไป ไม่ใช่ตารางที่ SELECT** — 2026-08-02 (blacklist bridge, GuruSquare 2 ชุด: HDY source #10 + HKT source #11 มีป้ายซ้ำกัน 286 ใบ): `desiredRows()` ใน `src/helpers/blacklistBridge.js` เป็น **first-rule-wins** — rule ไหน claim ป้ายก่อน ป้ายนั้นได้กลุ่มของ rule นั้น (`if (byPlate.has(plate)) continue;`) — แต่ query ที่ดึง rule เขียนแค่ `WHERE r.active` **ไม่มี `ORDER BY`**.
     **ทำไมถึงซ่อนตัวได้ดี:** `EXPLAIN` บอกว่า planner ขับ join จาก **`Seq Scan on blacklist.sources`** (ตารางเล็ก) แล้ววน index เข้า `bridge_rules` → ลำดับที่ออกมาคือลำดับ heap ของ **`sources`** ไม่ใช่ของ `bridge_rules` ที่เรากำลังอ่านอยู่. และ `sources` ถูก `UPDATE` **ทุกครั้งที่ import** (เก็บ `last_import_note`/`updated_at`) → MVCC เขียน tuple ใหม่ท้าย heap → **ลำดับเปลี่ยนเองโดยไม่มีใครแตะโค้ดหรือแตะ rule เลย**.
     **Reproduce (ใน transaction + rollback ไม่แตะ prod):** `UPDATE blacklist.sources SET label=label WHERE id=10` (ค่าเท่าเดิม) แล้วรัน query เดิมซ้ำ → ลำดับพลิกจาก `6,7,4,8` เป็น `4,8,6,7`. วัดผลจริงด้วย `bridge.diff()` สองรอบคร่อม UPDATE นั้น: รอบแรก `update 0` รอบสอง **`update 286`** — 286 ป้ายจะย้ายจากกลุ่ม "รถตามหมายจับ" (`alert_mode=plate_region`, ต้องตรงจังหวัดด้วย) ไป "รถผู้ต้องสงสัย" (`plate`, เลขล้วน) **แล้วเด้งกลับรอบถัดไป** = ลดเกณฑ์จับคู่ของรถ 286 คันสลับไปมาโดยไม่มีใครสั่ง — ซึ่งเป็นการยกเลิกสิ่งที่ #130 ตั้งใจทำไว้ (วัดจริงแล้วว่าจับคู่โดยไม่เช็ค province เป็น false collision 93%).
     **Fix:** `ORDER BY r.id` (commit 25ed4be) — rule เก่าชนะ ซึ่งเป็น semantics ที่ต้องการอยู่แล้ว: เพิ่มแหล่งข้อมูลใหม่ได้ป้ายใหม่ แต่ **ไม่มีทาง re-classify ป้ายที่มีอยู่**. verify: diff คงที่ `26/0/0` คร่อม UPDATE เดิมที่เคยทำให้พลิก.
     **Lesson:** (1) ถ้าโค้ดที่วนผลลัพธ์มีคำว่า "อันแรกชนะ" / `if (seen.has(k)) continue` / `Map.set` ที่ไม่ overwrite — **query ที่ป้อนมันต้องมี `ORDER BY` เสมอ** ไม่ใช่ nice-to-have. (2) heap order ของตารางที่ join เข้ามา (แม้จะเป็นตาราง lookup เล็ก ๆ ที่ดูไม่เกี่ยว) คุมลำดับผลลัพธ์ได้ — ดู `EXPLAIN` ว่าอะไรเป็น driver ก่อนสรุปว่า "ลำดับน่าจะตาม id". (3) บั๊กชนิดนี้ **เทสต์ในเครื่องไม่มีทางจับได้** เพราะ heap ยังไม่เคยถูก churn — ตัวกระตุ้นคือการใช้งานจริง (import) ไม่ใช่ input ที่แปลก.

137. **กล้อง Hikvision รุ่นเดียวกันส่ง "ใบหน้า" บน alertStream ได้ 2 `eventType` คนละโครงสร้าง ขึ้นกับ Event Type ที่ตั้งบนกล้อง — parser รู้จักแค่แบบเดียว อีกแบบถูกทิ้งทั้ง JSON และรูปโดยไม่มี log สักบรรทัด** — 2026-08-02 (`C43-SKU-SB-17` เทียบ `C44-SKU-SB-18`, `iDS-2CD7A86G0-IZHS` ทั้งคู่): C43 มี **0 event มาหลายสัปดาห์** ส่วน C44 มี 48,063 event มีรูปครบ ทั้งที่ **รุ่นเดียวกัน config ในระบบเหมือนกัน subnet เดียวกัน และใช้ pull เหมือนกัน**.
     **สมมติฐานแรกผิด:** เดาว่าเป็นเพราะ pull vs push — ไม่ใช่ (VSS ใช้ push ได้รูป, C44 ใช้ pull ก็ได้รูป, C43 ใช้ pull ไม่ได้ → transport ไม่ใช่ตัวแปร).
     **Root cause:** `handleFaceJson()` ใน `src/ingesters/hikvision-isapi.js` `return` ทันทีเมื่อ `eventType !== 'faceCapture'`. กล้องที่ตั้ง **Multi-Dimension People Counting** ส่ง `faceCapture` (`faceCapture[].faces[]` + `targetAttrs.pId`) แต่กล้องที่ตั้ง **Multi-Target-Type Detection** ส่ง **`mixedTargetDetection`** (`CaptureResult[]{targetID, uid, Face:{Rect,Property[],pId1,pId2}, Human:{...}}`) → JSON ถูกทิ้ง → พอ JPEG ตามมา `handleImagePart()` หา pending owner ตาม pId ไม่เจอ → **ทิ้งรูปตามไปด้วยทั้งหมด**. ทั้งสองจุดเงียบสนิท: ไม่มี log ไม่มี error ไม่มี metric — จึงไม่มีใครรู้ว่ากล้องตัวนี้ไม่เคยส่งอะไรเข้าระบบเลย.
     **Reproduce:** ดัก `/ISAPI/Event/notification/alertStream` ตรง ๆ 60 วินาที (digest auth, read-only) แล้วนับ part แยกตาม Content-Type — **C43 ส่งมากกว่า C44 เท่าตัว**: 7.7 MB / 92 parts / **62 JPEG** vs 3.2 MB / 35 parts / 14 JPEG. ไม่ใช่กล้องเงียบ แต่เรากินไม่ลง.
     **สิ่งที่คาดไม่ถึง — `mixedTargetDetection` ดีกว่า `faceCapture`:** มันให้ `Face` และ `Human` ของ **target เดียวกัน** อยู่ใน `CaptureResult` ก้อนเดียว ผูกด้วย `targetID`/`uid` ซึ่งคือสิ่งที่ `_pendingBodyLink` พยายามเดาด้วย heuristic "กล้องเดียวกัน ภายใน 10 วินาที" (พลาดได้เมื่อคนเดินสวนกัน). **ห้ามแก้โดยไปเปลี่ยนกล้องให้ส่ง `faceCapture`** — นั่นคือลดคุณภาพข้อมูลลงมาหาโค้ด.
     **Fix (commit `8fb37b2`):** reshape `Face` เป็นรูปร่าง `faces[]` แบบ faceCapture แล้วป้อนเข้า `_pendingFaces` เดิม — ไม่สร้างเส้นทาง ingest ที่สอง, EDGE_MODE/central insert/รูป/alert/clip ใช้ทางเดิมทั้งหมด. **การผูกรูปไม่ต้องแก้เลย** เพราะ part name เป็น pId ทั้งสองแบบ (`pId1`=crop, `pId2`=background). verify จริงหลัง deploy: C43 `0 → 32 event/5 นาที มีรูปครบ` พร้อม gender/age/expression/score + body attributes, C44 ไม่ regress (89/5นาที ≈ baseline 17/นาที), ไฟล์จริงบนดิสก์ 13 KB crop + 176 KB full.
     **Lesson:** (1) **"กล้องรุ่นเดียวกัน config เหมือนกัน" ไม่ได้แปลว่าส่ง payload เหมือนกัน** — Event Type บนกล้องเปลี่ยนโครงสร้าง JSON ทั้งก้อน ไม่ใช่แค่เปลี่ยนค่าในฟิลด์. (2) **ก่อนโทษ transport ให้ดักดูของจริงบน wire ก่อน** — ตัวเลข "0 event" ไม่ได้แปลว่าไม่มีอะไรมา. (3) parser ที่ `return` เงียบเมื่อเจอชนิดที่ไม่รู้จัก **ต้องนับไว้เสมอ** — counter ที่เพิ่มพร้อม fix นี้เจออีก 8 กล้องที่ทิ้ง image part อยู่ (คนละสาเหตุ: รูปมาช้ากว่า flush 8 วินาที) ซึ่งไม่มีใครเคยเห็นมาก่อน.

138. **NUL byte ที่หลุดเข้าไฟล์ซอร์สทำให้ `grep` เงียบทั้งไฟล์ — ไม่ error ไม่เตือน แค่ไม่คืนอะไรเลย เพราะมันถือว่าไฟล์เป็น binary** — 2026-08-02 (ระหว่างแก้ `src/ingesters/hikvision-isapi.js` ตาม #137): การแก้ไฟล์แทรก `\0` ไป 3 จุดตรงตำแหน่งที่ตั้งใจให้เป็น space — สองจุดอยู่ใน template literal (`` `${cam.camera_id}\0${json.eventType}` ``) และหนึ่งจุดใน `k.split('\0')`.
     **ที่หลอก:** โค้ดยัง **ทำงานถูก** เพราะ key ที่สร้างกับ separator ที่ split ใช้ `\0` เหมือนกัน — `node --check` ผ่าน, self-check ผ่าน, ไม่มีอาการอะไรเลยนอกจากอักขระประหลาดใน log. สิ่งที่พังคือ **เครื่องมือ**: `grep -n "handleImagePart"` คืนค่าว่าง, `grep -c ""` ก็คืนว่าง, ทำให้เข้าใจผิดว่าแก้ไฟล์ไม่สำเร็จหรือ path ผิด แล้วไปไล่หาผิดทาง.
     **Fix / วิธีตรวจ:** `sed -n '<line>p' file | cat -A` จะโชว์เป็น `^@`; หรือนับทั้งไฟล์ `python3 -c "print(open('f','rb').read().count(b'\x00'))"`. แทนที่ด้วย space แล้วรัน `node --check` ซ้ำ.
     **Lesson:** (1) **`grep` ที่คืนค่าว่างทั้งที่มั่นใจว่ามีข้อความนั้นอยู่ = สงสัย NUL ก่อนสงสัย path** — โดยเฉพาะหลังเพิ่งแก้ไฟล์นั้นเอง. (2) หลังแก้ไฟล์ใหญ่ด้วยเครื่องมืออัตโนมัติ ให้เช็ค NUL เป็นขั้นตอนประจำเหมือนเช็ค syntax. (3) เป็น class เดียวกับ control-byte ที่เคยเจอตอนทำ grouping key ของ `vehicle_type` (NUL/SOH ไม่ใช่ `''` ธรรมดา) — อักขระที่มองไม่เห็นทำให้ debug หลงทางได้นานกว่าบั๊กที่ error ออกมาตรง ๆ เสมอ.

139. **query อ่านที่ค้างอยู่ บล็อก migration ได้ — และเพราะ api-server รัน migration *ก่อน* เปิดพอร์ต เว็บจะล่มทั้งช่วง · หน้า error ของ cloudflared ไม่ได้แปลว่า tunnel พัง** — 2026-08-03 (migration 113 `UPDATE lpr_watchlist`): เจ้าของแจ้งว่าเข้า dashboard ไม่ได้ ขึ้น error ของ cloudflared. **`cloudflared` ปกติดี** — uptime 10 วัน 12 ชม. ไม่เคย restart · มันแค่ต่อ origin `localhost:3000` ไม่ได้ จึงคืนหน้า error ของตัวเอง.
     **Timeline:** `13:10:46 ▶ Running schema migrations...` → ค้าง → `13:14:23 ✅ migration applied (216,567ms)` → API ถึงเปิดพอร์ต · **เว็บดับ 3 นาที 37 วินาที**.
     **Root cause:** query สำรวจแบบอ่านอย่างเดียว (สแกน `events` 3.9M แถวเทียบ `data.Object.Text` กับ `raw_json.plate`) ถูกสั่งรันแล้วช้าเกิน tool timeout จน**หลุดไปรันเป็น background แล้วไม่มีใครตามไปปิด** — รันต่อ **7,387 วินาที (2 ชม.)** และถือ lock บน `lpr_watchlist` ไว้. `pg_stat_activity` ตอนนั้น: `pid=323046` (query สำรวจ) บล็อก `pid=331811` (migration) ซึ่งบล็อกต่ออีก 2 ตัวรวม query ของผู้ใช้จริง.
     **ที่คนมักเข้าใจผิด:** "query อ่านไม่บล็อกอะไร" — จริงเมื่อเทียบกับ `SELECT`/`INSERT` ด้วยกัน แต่ `UPDATE`/DDL ที่มาทีหลังต้องรอ และเมื่อมันเข้าคิว **ทุกอย่างที่มาหลังจากนั้นก็รอตาม** (กลไกเดียวกับ #134).
     **Fix:** `pg_cancel_backend(<pid>)` → คิวโล่งทันที migration ผ่าน.
     **Lesson:** (1) **query สำรวจ/ad-hoc ทุกตัวต้องตั้ง `SET statement_timeout`** — ถือ lock ค้างได้แม้เป็นการอ่าน. (2) **tool ที่แจ้งว่า "moved to background" = ต้องตามไปเก็บ** ไม่ใช่ปล่อยผ่าน. (3) **ก่อน restart api-server ให้เช็ค `pg_stat_activity` ว่าไม่มี query ค้างของตัวเอง** เพราะ migration รันตอน boot และ **failure/ค้าง ตรงนั้นทำให้ไม่เปิดพอร์ตเลย** (STUBBORN_FACT #81 ตั้งใจให้เป็นแบบนั้น). (4) migration ที่แตะข้อมูลจริง (ไม่ใช่แค่ `ADD COLUMN IF NOT EXISTS`) ควรนัดเวลา ไม่แทรกกลางวัน. (5) **cloudflared error ให้ไปดู origin ก่อนเสมอ** — tunnel แทบไม่เคยเป็นต้นเหตุ.

140. **"เอกสาร ISAPI ตอบ 403" ≠ "กล้องไม่มีฮาร์ดแวร์" — และการเอาชะตาของเอกสารหนึ่งไปผูกกับอีกเอกสารทำให้ทิ้งข้อมูลที่กล้องยินดีให้** — 2026-08-05 (แผง microSD, กล้อง ANPR ที่ HKT 16 ตัว). บั๊กเดียวกัน **เกิดซ้ำสองรอบใน commit ติดกัน**:
     **รอบแรก** `hikSdProbe()` เช็ค `if (storage.code !== 200) return { ok:false }` → กล้อง ITC/ANPR ที่ 403 `ContentMgmt/Storage` ถูกนับเป็น "unreachable" → **ไม่มี telemetry เลยสักตัว** ทั้งที่ตอบ `/ISAPI/System/status` ปกติ (สเปกคนละเล่ม: `ISAPI_Traffic_Cameras_Capture_Cameras.pdf`).
     **รอบสอง (หลังแก้รอบแรกแล้ว)** เปลี่ยนเป็นถามสองเอกสารก็จริง แต่ยัง gate ตัวอื่นไว้: `tracks = storage.code === 200 ? await … : {code:0}`. **`record/tracks` ตอบ 200 บน ANPR** พร้อมตาราง CMR 7 วันเต็ม (`Record=true`, `LoopEnable=true`, 6144 kbps) — ถูกทิ้งไปเพราะเอกสาร*อื่น* 403.
     **ผลที่ผู้ใช้เห็น:** แผงขึ้น **"ไม่มีการ์ด"** ให้กล้อง 16 ตัว ทั้งที่ความจริงคือ **เรามองไม่เห็น** — `ContentMgmt/Storage` 403 · `System/Storage` 403 · `System/emmcInfo` 403 (แต่ `/emmcInfo/capabilities` ตอบ 200 ด้วย `lifetimeStatus min=max=0`) · `System/status` ไม่มี `HardDiskStatusList`. เจ้าของจับได้เอง ("จริงๆ มันมีหรือไม่มีกันแน่")
     **ANR ก็ผิดด้วยเหตุเดียวกัน:** แผงบอก "ไม่รองรับในรุ่นนี้" เพราะไปหาใต้ `ContentMgmt/record/*` ซึ่งเป็นผิวของ DeepinView. กล้องจราจรอยู่คนละที่: **`GET /ISAPI/Traffic/ANR` → 200 `<ANRControl><uploadInterval>200</uploadInterval></ANRControl>`** (สเปก 14.5.1.37) — **รองรับ แต่ไม่มี `DeviceIpAddress` = ยังไม่ได้ตั้ง arming server** ซึ่งเป็นคนละเรื่องกับไม่รองรับ และเป็นเรื่องที่คนไปแก้ได้
     **Fix:** ถามทุกเอกสารเสมอ ใช้อันที่ตอบ · เพิ่ม state `unsupported` แยกจาก `no_card` (ต่างกันที่ `storageSupported` — กล้อง**ตอบ**แล้วว่างจริง vs กล้อง**ปฏิเสธ**) · ANR เป็น 3 สถานะ · LED ของ `unsupported` เป็นวงกลมกลวง ไม่ใช่ ok/warn/bad เพราะมันคือ "ไม่มีข้อมูล" ไม่ใช่คำตัดสิน
     **Lesson:** (1) `403 notSupport` เป็น**คำตอบปกติ**ของอุปกรณ์ที่ไม่ได้ implement เอกสารนั้น ไม่ใช่ error ที่ต้องไปไล่เรื่องสิทธิ์. (2) **ห้าม `if (docA.code === 200)` ครอบการเรียก docB** — แต่ละเอกสารต้องตัดสินชะตาตัวเอง; ถ้าจะ gate ให้ gate ด้วยเงื่อนไขของมันเอง (เช่น `search` ต้องมี filesystem จริง ๆ จึงผูกกับ `storage` ได้). (3) **UI ที่ยืนยันข้อเท็จจริงเชิงฮาร์ดแวร์จากการที่ API เงียบ = โกหก** — ต้องมีสถานะ "ไม่รู้" เสมอ. (4) ก่อนสรุปว่า "รุ่นนี้ไม่รองรับ X" ให้เปิดสเปกของ**ตระกูลนั้น** ก่อน — Traffic กับ DeepinView คนละไฟล์ คนละ URI

141. **เขียน digest auth เองตอน probe กล้อง Hikvision → ล็อกบัญชี `admin` ของกล้อง production ~30 นาที · `unlockTime` เป็น "นาที" ไม่ใช่ "วินาที"** — 2026-08-05 (`C10-KAR-SB-04`, ANPR ที่ป้อน CIB). สคริปต์ ad-hoc พลาดสองชั้นซ้อน: (ก) รัน `node` โดยไม่ `set -a; . ./.env` → `CAMERA_SECRET_KEY` ไม่มี → `decryptCamCreds` คืน ciphertext มาเป็นรหัสผ่าน (ข) สคริปต์ไล่ยิง 20 URI รวดเดียวไม่มี guard → auth ผิด 20 ครั้งติด
     **กล้องตอบ:** `<userCheck><statusValue>401</statusValue><lockStatus>lock</lockStatus><unlockTime>30</unlockTime><retryLoginTime>0</retryLoginTime></userCheck>`
     **สิ่งที่ยืนยันได้:** เลขนับถอยหลัง 30→29→26 ต่อเนื่อง **ทั้งที่ `edge-preview` ยิงทุก 2 นาทีคั่นอยู่** → **การยิงซ้ำระหว่างล็อกไม่ต่อเวลาให้**
     **สิ่งที่ยังไม่รู้ (อย่าเขียนว่ารู้):** **หน่วยของ `unlockTime` และระยะล็อกจริง** — ถ้าเป็นนาที ควรคลายราว 16:18 แต่ **16:28 ก็ยัง 401 อยู่** และไม่เคยสังเกตเห็นวินาทีที่มันคลายเลย · กล้องรุ่นนี้ 403 ทั้ง `/ISAPI/Security/illegalLoginLock` และ `/lockStatus` จึงอ่านนโยบายไม่ได้
     **สิ่งที่รู้แน่หลังผ่านไป 1 วัน:** **ล็อกอยู่ข้ามคืน ~12 ชม. และ retry ~20 รอบก็ยังไม่คลาย** → **อย่าคาดหวังว่ามันจะคลายเอง** ต้องมีคนไปตัดไฟที่หน้างาน (สั่ง reboot ผ่าน ISAPI ไม่ได้ เพราะใช้ credential เดียวกันจึงโดน 401 ด้วย) · ด้วยเหตุนี้ backoff จึง **escalate เป็นหยุดถาวร** หลังพลาด 2 รอบ (`data/auth-held.json`, ลบไฟล์เพื่อกลับมา poll) — ยิง 401 ทุก 35 นาทีตลอดกาลไม่ได้แก้อะไร ได้แค่ป้าย OFFLINE กะพริบ · **heartbeat ไม่ถูกกระทบ** (เป็น TCP connect เปล่า ไม่ผ่าน auth) สถานะ online/offline จึงยังจริงตามเดิม
     **ผลกระทบจริง:** `edge-preview` (snapshot ทุก 2 นาที) + `edge-hb` (heartbeat) ได้ 401/timeout → **กล้องขึ้น OFFLINE บน dashboard ทั้งที่ปกติดี** · **แต่ push ป้ายทะเบียนไม่กระทบเลย** (75 ใบ/30 นาที, spool 0) เพราะ push เป็นขาออกจากกล้อง ไม่ผ่าน login — เส้นที่ป้อน CIB จึงปลอดภัย
     **Fix / ธรรมเนียมต่อจากนี้:** probe กล้อง Hikvision **ต้อง** ใช้ `parseChallenge` + `buildDigestHeader` จาก `src/helpers/digestAuth` ตัวเดียวกับที่ `edge-config-agent`/`lpr-receiver` ใช้ (ที่เขียนเองยัง 401 อยู่ดีแม้ถอดรหัสผ่านถูกแล้ว) · สคริปต์ probe ต้องมี guard 2 ชั้น: **ถอดรหัสผ่านไม่ออก = ไม่ยิงกล้องเลย** และ **เจอ 401 ครั้งแรก = break ทันที**
     **Backoff ที่เพิ่มมาพร้อมกัน (`AUTH_BACKOFF_MS`, ค่าเริ่มต้น 35 นาที):** เจอ 401 จากกล้องไหน หยุด poll กล้องนั้นชั่วคราว — **มีไว้หยุด 401 ที่ยิงเปล่า ๆ ไม่ใช่ "เพื่อให้ล็อกหมดอายุ"** (ตามด้านบน การยิงไม่ได้ต่อเวลา) · 35 นาทีเป็น**ค่าที่เดา**ให้ยาวกว่าเลขที่กล้องรายงาน ไม่ได้คำนวณมา · เฉพาะ 401 เท่านั้นที่ backoff — กล้องที่แค่ต่อไม่ติดต้อง retry ต่อ เพราะ retry คือสิ่งที่รู้ว่ามันกลับมาแล้ว
     **ข้อควรระวังของ backoff เอง:** **รหัสผ่านผิดก็หน้าตาเหมือนกันเป๊ะ** — ตั้งรหัสผิดใน `cameras-config.json` แล้วกล้องจะเงียบทั้ง preview และ SD telemetry ไป 35 นาทีต่อรอบ ดังนั้น `sd_error` เขียนแค่ `401 — polls paused` **ห้ามเขียนว่า "locked"** (เป็นการ over-claim แบบเดียวกับ `no_card` ใน #140) และ log เตือนให้ไปเช็ค credential ด้วย
     **Lesson:** (1) รหัสผ่านที่ถอดไม่ออกจะกลายเป็น "รหัสผ่านผิด" เงียบ ๆ ไม่ใช่ error — ต้อง assert ก่อนใช้. (2) ห้าม implement โปรโตคอล auth ซ้ำในสคริปต์ชั่วคราว ในเมื่อ repo มีตัวที่พิสูจน์แล้วอยู่. (3) การล็อกจาก auth ผิดกระทบเฉพาะขา **inbound** — เวลาประเมินความเสียหายให้แยก "เราเข้ากล้อง" กับ "กล้องส่งหาเรา" ออกจากกันเสมอ. (4) **อย่าสรุประยะเวลาจากการอ่านตัวเลขไม่กี่ครั้ง** — ต้องเห็นตอนมันคลายจริงถึงจะเขียนว่ารู้

142. **replay ที่ลบไฟล์ "ทีเดียวตอนจบ" = ทุกครั้งที่ process ตายกลางทาง จะส่งซ้ำทั้งก้อน รวมทั้งที่ได้ PUBACK ไปแล้ว** — 2026-07-31 ถึง 08-03 (site `vss`, `src/edge/bridge.js`): `replayQueue()` ย้ายคิวไป `.replay` ส่งทีละไฟล์ แล้ว `fs.rmSync(tempDir)` **ตอนจบรอบเท่านั้น** · ถ้า process ตายก่อนถึงบรรทัดนั้น `drainOrphanedReplay()` ตอน start จะยกไฟล์**ทั้งหมด**กลับเข้าคิว รวมอันที่ broker ยืนยันรับไปแล้ว
     **หลักฐานตรงจาก log — ก้อนไม่เคยเล็กลง มีแต่โตขึ้น:**
     ```
     12:10  replaying 96      ← ไม่เคยขึ้น "replay done"
     17:25  recovered 96  → replaying 281
     17:45  recovered 281 → replaying 293
     17:53  recovered 293 → replaying 301
     18:19  recovered 301 → replaying 340
     ```
     เวลาในล็อก (UTC+7) **ตรงกับ `events.received_at` ทุกตัว** → event เดียวเข้า DB **9 แถว** payload เหมือนกันเป๊ะ · รวม 7 วัน **651 แถวเกินที่ vss** (hdy 24, hkt 3 = 0.013% ของ 5.38 ล้าน)
     **ที่หลอกตอนไล่:** จัดกลุ่มหาซ้ำด้วย `(camera_id, event_time, event_type)` เฉย ๆ ได้ 89,887 แถว **ผิด** — กล้อง ANPR หลายเลนจับ**คนละคัน**ในมิลลิวินาทีเดียวกันได้ปกติ (37,278 จาก 37,279 กลุ่มของ hkt ป้ายคนละใบ) · **ต้องเทียบ `md5(raw_json)` ด้วยเสมอ** ถึงจะนับว่าซ้ำจริง
     **Fix:** แยก lifecycle ออกเป็น `src/edge/bridgeQueue.js` (bridge.js เปิด MQTT ตอน require เลยเทสต์ไม่ได้ — เป็นเหตุผลที่บั๊กนี้ไม่มีเทสต์ครอบเลย) · **ยืนยันแล้วลบไฟล์ทันที · ไม่สำเร็จให้ `rename` กลับเข้าคิว ไม่ใช่ copy** → ข้อความอยู่ที่เดียวเสมอ ขาดกลางคันก็ส่งซ้ำได้แค่ที่ยังไม่ยืนยัน · `test/bridge-queue.test.js` จำลองเหตุการณ์จริง (ขาดตอนหลังส่งไป 3 จาก 6 แล้ว resume → ต้องส่งรวม 6 ครั้ง ไม่ใช่ 9)
     **Lesson:** (1) **งานที่ต้อง idempotent ห้าม commit ผลเป็นก้อน** — ลบ/ยืนยันทีละหน่วยทันทีที่หน่วยนั้นสำเร็จ ไม่งั้น "ขาดกลางคัน" = ทำซ้ำทั้งหมด. (2) ไฟล์ที่ `require` แล้วเปิด connection ทันที **เทสต์ไม่ได้** และมักเป็นที่ที่บั๊กแบบนี้ซ่อนอยู่ — แยก logic ออกมาให้เทสต์ได้. (3) **นับ duplicate ต้องเทียบ payload** ไม่ใช่แค่ (อุปกรณ์, เวลา) — ไม่งั้นได้ตัวเลขเกินจริง 130 เท่า

143. **`license_plates` มี 3 จุดที่เขียน INSERT — เพิ่มคอลัมน์แล้วลืมจุดใดจุดหนึ่ง = คอลัมน์นั้นว่างเงียบ ๆ ไม่มี error** — 2026-08-06: `no_seatbelt` (มีมาตั้งแต่ migration 073) **เป็น `NULL` ครบทั้ง 4,952,925 แถวใน 7 วัน** ไม่ใช่ "ไม่มีใครใช้" แต่ "ค่าเดินไปไม่ถึง"
     **รั่ว 2 ชั้นซ้อนบนเส้นทางเดียว:** `lpr-core.js:234` แกะ `pilotsafebelt`/`vicepilotsafebelt` ถูกต้อง และ INSERT ฝั่ง central-direct ก็เขียนคอลัมน์นี้ — **แต่ EDGE_MODE ส่งเฉพาะสิ่งที่อยู่ใน `lprRawJson` กับ `licensePlate` ที่ publish ออกไป และทั้งสองก้อนไม่เคยมีค่านี้** (แกะเสร็จแล้วทิ้งบรรทัดถัดไป) · ต่อให้ข้ามมาได้ `mqtt-subscriber.js` ก็**ไม่มีคอลัมน์นี้ใน INSERT เลย** · ทุกป้ายใน production เดินเส้นทางนี้
     **ทำไมถึงรอดมานาน — 3 ไฟล์เขียนคนละชุด และแต่ละไฟล์ดู "ครบ" ในตัวเอง:**

     | คอลัมน์ | `lpr-core.js` (Hik direct) | `mqtt-subscriber.js` (edge) | `ingesters/dahua-cgi.js` (Dahua direct) |
     |---|---|---|---|
     | `no_seatbelt` | ✅ | ❌ **ช่องโหว่** | — (Hik-only ถูกแล้ว) |
     | `rider_count` | — (Dahua-only ถูกแล้ว) | ✅ | ✅ |
     | `license_bright` · `plate_char_believe` | ✅ | ✅ | — (Hik-only ถูกแล้ว) |

     **กับดักตอนวิเคราะห์:** เห็น `lpr-core` มี `no_seatbelt` แต่ไม่มี `rider_count` แล้วสรุปว่า "สองเส้นทางหลุดกันคนละด้าน" — **ผิดครึ่งหนึ่ง** · ตัวคู่ของ `rider_count` คือ `dahua-cgi.js` ไม่ใช่ `lpr-core.js` (Hikvision ไม่ส่งค่านี้มาตั้งแต่ต้น) ถ้าเติมตามที่เข้าใจผิดจะได้คอลัมน์ที่เขียน `NULL` ตลอดกาล → **ก่อนเติมคอลัมน์ ต้องถามว่าเวนเดอร์นั้นส่งค่านี้จริงไหม ไม่ใช่แค่เทียบว่าไฟล์ไหนมี/ไม่มี**
     **Fix (`7adc241`):** ใส่ค่าเข้าทั้ง `lprRawJson` และ `licensePlate` ฝั่ง edge + เพิ่มคอลัมน์ใน INSERT ของ `mqtt-subscriber` อ่านแบบ `lp.no_seatbelt ?? rawJson?.noSeatbelt ?? null` (payload ก่อน raw_json — edge เวอร์ชันเก่ายังส่งได้ ไม่ต้อง deploy พร้อมกัน) · **deploy central ก่อน edge เสมอ** ตัวอ่านรับได้ทั้งสองเวอร์ชัน ตัวเขียนไม่ใช่ · ผลจริง 0% → **100% ภายใน 3 นาที** (ฝั่ง Hikvision) · backfill ย้อนหลังจาก `rawXml` อีก **2,876,369 แถว** พบของจริง 6,587 ครั้ง (~820/วัน)
     **`?? null` ไม่ใช่ `|| false`:** `NULL` = ไม่มีใครตรวจ · `false` = ตรวจแล้วคาดเข็มขัดอยู่ — Dahua ส่ง `MainSeat.SafeBelt` มาเป็น `unknow` ทุกแถว (ยืนยัน 335,131 แถว จาก 40 กล้อง) ถ้า default เป็น `false` เท่ากับประกาศว่าคนขับครึ่งฟลีตคาดเข็มขัด ทั้งที่ไม่เคยตรวจ
     **วิธีตรวจซ้ำ (เอาไปรันได้เลย):** ดึงรายการคอลัมน์จาก `INSERT INTO license_plates` ของทั้ง 3 ไฟล์มาเทียบเป็นเซ็ต — คอลัมน์ที่ไม่ครบทุกเส้นต้องอธิบายได้ด้วยเวนเดอร์เท่านั้น ถ้าอธิบายไม่ได้คือรูรั่ว (ตรวจแล้ว 2026-08-06: เหลือ 4 ตัวที่ต่างกัน อธิบายได้ครบทุกตัว)
     **Lesson:** (1) **ค่าที่ parse แล้วไม่ได้ถูกส่งต่อ = มองไม่เห็นเลย** ไม่มี error ไม่มี log มีแต่คอลัมน์ว่างที่ดูเหมือนไม่มีใครใช้. (2) ระบบที่มีหลาย ingest path ต้องถือว่า **"เพิ่มคอลัมน์" = งานที่ต้องทำทุก path** ไม่ใช่ path เดียว. (3) `count(col)` ใน SQL ข้าม `NULL` — ตัวเลข "0" จาก `count()` แปลว่า "ไม่มีค่า" ไม่ใช่ "ไม่มีแถว" ระวังอ่านเป็นอย่างหลัง

144. **รหัสผ่านกล้องผิด = กล้องเงียบทั้ง preview และ SD โดยที่ event ยังไหลปกติ — และปลดล็อกต้องทำ 3 ขั้น ไม่ใช่ขั้นเดียว** — 2026-08-07, `C10-KAR-SB-04` (hkt): snapshot ในหน้า Camera Status ค้างมา **55 ชั่วโมง** ตัวเดียวในไซต์ ขณะที่ `last_seen_at` สดตลอดและป้ายทะเบียนเข้าปกติ 14,609 คัน/วัน
     **ทำไมดูเหมือนกล้องปกติ:** ขา **push/alertStream ไม่ใช้รหัสของเรา** กล้องจึงส่งข้อมูลเข้ามาได้เรื่อย ๆ · รหัสผิดกระทบเฉพาะตอน**เราเข้าไปอ่าน/เขียนบนกล้อง** (preview · SD probe · ISAPI config) → `sd_error = "401 — polls paused"` เป็นสัญญาณเดียวที่บอก และมันอยู่ในคอลัมน์ที่ไม่มีใครดู
     **การยอมแพ้เป็นดีไซน์ ไม่ใช่บั๊ก** — `edge-config-agent` เจอ 401 ติดกัน `AUTH_GIVEUP_AFTER=2` รอบ (รอบละ 35 นาที) แล้วเขียนชื่อกล้องลง `data/auth-held.json` **เลิก poll ถาวร** เพื่อไม่ให้ยิงซ้ำจนบัญชีกล้องถูกล็อก (cf. [[feedback_hik_digest_lockout]] — Hikvision ล็อก ~30 นาที)
     **🔴 กับดักตัวจริง:** ข้อความบอกว่า *"Delete `auth-held.json` to resume"* — **ไม่พอ** · `const _authHeld = new Set(loadAuthHeld())` อ่านไฟล์ **ครั้งเดียวตอน module load** process ที่รันอยู่ (ตอนนั้น 14.3 ชม.) ยังถือรายชื่อไว้ในหน่วยความจำ **ลบไฟล์แล้วไม่มีอะไรเกิดขึ้น** จนกว่าจะ restart
     **ปลดล็อกต้องครบ 3 ขั้นตามลำดับ:** (1) แก้รหัสให้ถูกใน Camera Settings → publish ถึง edge (2) `rm data/auth-held.json` (3) `pm2 restart edge-config-agent` · ข้ามข้อ 3 = เหมือนไม่ได้ทำอะไรเลย
     **ผลหลังทำครบ:** `tile_snap_ts` เก่า 55.2 ชม. → **สด 12 วินาที** · `sd_error` ว่าง · ไฟล์ held ไม่ถูกสร้างใหม่ (= auth ผ่านจริง ไม่ใช่แค่ปลดชั่วคราว)
     **Fix ที่ทำไป:** แก้ข้อความทั้ง 2 จุดให้บอกว่าต้อง restart ด้วย + คอมเมนต์ที่ตัวแปรว่าอ่านครั้งเดียว · **จงใจไม่แก้ให้เช็คไฟล์ทุกรอบ** เพราะกลไก "ต้องมีคนมาดู" คือสิ่งที่กันบัญชีกล้องถูกล็อก การทำให้ปลดง่ายขึ้นคือทำให้ guard อ่อนลง
     **Lesson:** (1) **ข้อความบอกวิธีแก้ที่บอกไม่ครบ อันตรายกว่าไม่มีข้อความ** — คนทำตามแล้วไม่เกิดอะไร จะสรุปว่า "ไม่ใช่สาเหตุนี้" แล้วไปหาผิดที่. (2) state ที่ persist ลงไฟล์แต่โหลดครั้งเดียวตอน start ต้องเขียนกำกับไว้ทุกที่ที่พูดถึงไฟล์นั้น. (3) **"กล้อง online" กับ "เราคุยกับกล้องได้" คนละเรื่อง** — เวลาไล่ปัญหาให้แยก inbound (กล้องส่งหาเรา) กับ outbound (เราเข้าไปหากล้อง) เสมอ

145. **`SET LOCAL ROLE` นอก transaction ล้มแบบเงียบสนิท แล้ว query วิ่งด้วยสิทธิ์ superuser** — 2026-08-07 ตรวจพบตอนวางแผน Partner API (TP2) ก่อนเขียนโค้ด ยังไม่เคยหลุดขึ้น prod
     **สิ่งที่ตั้งใจให้เป็น:** API ยืนยันตัว partner แล้ว `SET LOCAL ROLE <partner>_ro` ก่อน query เพื่อให้ **Postgres เป็นด่านสุดท้าย** ต่อให้โค้ดเราบั๊กก็อ่านคอลัมน์ที่ไม่ได้ `GRANT` ไม่ได้
     **สิ่งที่เกิดจริง (reproduce ด้วย `pg.Pool` ตัวเดียวกับที่ใช้จริง):**

     | ทำอะไร | `current_user` | อ่าน `cameras` (ตารางดิบ) |
     |---|---|---|
     | `SET LOCAL ROLE x` **ไม่มี `BEGIN`** | `vigil_sql` | **ได้ 143 แถว** 🔴 |
     | `BEGIN` → `SET LOCAL ROLE x` | `x` | ถูกปฏิเสธ ✅ |
     | หลัง `ROLLBACK` | `vigil_sql` | — (คืนสภาพเอง ✅) |

     `SET LOCAL` มีผลแค่ใน transaction ที่ครอบอยู่ · เรียกนอก `BEGIN` มันจะอยู่ใน implicit transaction ของตัวเองซึ่งจบทันที → **ไม่มี error ไม่มี exception มีแต่ query ถัดไปที่วิ่งเป็น superuser**
     **🔴 ทำไมเทสต์ปกติจับไม่ได้:** เทสต์ที่เขียนตามสัญชาตญาณคือ "partner อ่านคอลัมน์ที่ให้แล้วได้ไหม" — **ผ่านทั้งสองกรณี** เพราะ superuser ก็อ่านได้ · จับได้ด้วย**เทสต์เชิงลบเท่านั้น**: ขอคอลัมน์/ตารางที่ไม่ได้ `GRANT` แล้ว**ต้องพัง** ถ้าไม่พัง = สิทธิ์ไม่ได้ถูกสวมจริง
     **กับดักที่สอง — `SET ROLE` เปล่า รั่วข้ามคำขอใน pool:** reproduce แล้วด้วย `max:1` — ตั้ง `SET ROLE x` แล้ว `release()` คืน connection · คนถัดไปที่ยืม connection เดิม **ยังเป็น `x`** อยู่ ทั้งที่เป็นคนละคำขอคนละคน · ทิศทางไหนก็แย่: คำขอของ dashboard ไปเจอสิทธิ์ partner แล้วพัง หรือคำขอ partner ไปเจอ connection ที่ยังเป็น `vigil_sql` แล้วเปิดหมด
     **กฎที่ต้องยึด:** (1) query ของ partner **ทุกอัน**อยู่ใน `BEGIN`…`COMMIT/ROLLBACK` ชัดเจน + `finally` คืน connection (2) ใช้ `SET LOCAL ROLE` เท่านั้น **ห้าม `SET ROLE` เปล่าเด็ดขาด** (3) เกณฑ์เสร็จของทุก endpoint ที่พึ่ง role ต้องมีเทสต์เชิงลบ
     **Lesson:** (1) **กลไกความปลอดภัยที่ล้มแบบเงียบ อันตรายกว่าไม่มีกลไกเลย** — เพราะเราจะเขียนโค้ดที่เหลือโดยเชื่อว่ามีด่านนี้อยู่. (2) เทสต์ที่ยืนยัน "ทางที่ควรได้ ได้จริง" **ไม่เคยจับ fail-open** ต้องเทสต์ "ทางที่ควรพัง พังจริง" เสมอ. (3) state ที่ผูกกับ connection (`SET ROLE` · `search_path` · GUC) กับ connection pool เป็นคู่ที่ต้องระวังทุกครั้ง — connection ไม่ได้ตายหลังใช้เสร็จ มันถูกส่งต่อ


146. **cursor ที่ผ่าน JavaScript `Date` ส่งแถวซ้ำ — เพราะ `Date` เก็บได้แค่มิลลิวินาที แต่ Postgres เก็บไมโครวินาที** — 2026-08-07 ตอนทำ Partner API TP2c เจอตอนเทียบกับ `COUNT(*)` ยังไม่หลุดถึง partner
     **อาการ:** เดิน cursor ครบทั้งหน้าต่างเวลาที่ปิดแล้ว ได้ **22,190 แถว แต่ DB มี 22,168** — เกินมา **22 แถว = 1 ต่อขอบหน้า พอดี** (23 หน้า)
     **สาเหตุ:** cursor เก็บ `(เวลา, id)` ของแถวสุดท้าย โดยเข้ารหัสผ่าน `new Date(ts).toISOString()`

     | | ค่า |
     |---|---|
     | Postgres เก็บ | `2026-08-07 07:13:13.735099+00` |
     | ผ่าน JS `Date` | `2026-08-07T07:13:13.735Z` |
     | หายไป | `.000099` |

     cursor จึงชี้ไป**ก่อน**แถวที่มันสร้างมา → เงื่อนไข `(detected_at, id) > (cursor)` จับแถวนั้นได้อีกครั้งในหน้าถัดไป
     **🔴 กับดักที่อันตรายที่สุด — โค้ดชุดเดียวกัน ผ่านบนตารางหนึ่ง ตกบนอีกตารางหนึ่ง:**

     | ตาราง | ความละเอียด | ผลการทดสอบ |
     |---|---|---|
     | `license_plates` | **มิลลิวินาที** `.463+00` | ✅ 20,585 = 20,585 เป๊ะ |
     | `appearances` | **ไมโครวินาที** `.735099+00` | ❌ เกินมา 22 แถว |

     เขียนเสร็จ ทดสอบกับ `license_plates` ผ่านสวย แล้วเอา helper ตัวเดียวกันไปใช้กับ `appearances` — ถ้าไม่ได้เทียบกับ `COUNT(*)` จะไม่มีทางรู้เลย **ไม่มี error ไม่มี log มีแต่ partner ที่ได้ข้อมูลซ้ำ**
     **Fix:** `SELECT ... , detected_at::text AS _cur_t` ให้ Postgres พิมพ์ค่าเต็มความละเอียดออกมาเอง เอาสตริงนั้นไปทำ cursor ตรง ๆ **ห้ามผ่าน `Date` เด็ดขาด** (ตอนถอดรหัส `new Date()` ได้ แต่ใช้แค่ตรวจว่าเป็นวันที่จริงไหม แล้วใช้สตริงต้นฉบับ) + cast ชัดเจน `$n::timestamptz` / `$n::bigint` กันการเทียบผิดชนิด
     **Lesson:** (1) **ทดสอบ keyset paging ด้วยการเทียบกับ `COUNT(*)` เสมอ** — "เดินแล้วได้ข้อมูล" กับ "เดินแล้วได้ครบพอดีไม่ซ้ำ" คนละเรื่อง และอย่างหลังเท่านั้นที่จับบั๊กนี้ได้. (2) **ความละเอียดของ timestamp ต่างกันได้ระหว่างตารางในฐานข้อมูลเดียวกัน** ขึ้นกับว่าใครเขียนค่านั้นเข้ามา — อย่าเหมาว่าเหมือนกัน. (3) ทุกครั้งที่เอาค่าจาก DB ผ่าน JS แล้วส่งกลับเข้า DB ให้ถามว่า "ชนิดข้อมูลใน JS เก็บได้ครบไหม" — `Date` ทำ µs ไม่ได้ และ `Number` ทำ `bigint` ไม่ได้ด้วย


147. **แยกโฮสต์ให้ partner แล้วเช็ค `req.path.startsWith('/v1/')` — ข้ามได้ด้วย `/v1/../login.html`** — 2026-08-07 ตอนทำ TP-PUB เจอเองระหว่างทดสอบ ยังไม่เคยเปิดสู่ภายนอก
     **ที่มา:** ตั้ง `meta.dojojin.tech` แยกจาก `dashboard.dojojin.tech` เพื่อไม่ให้ cookie ของ dashboard (`Path=/`) วิ่งไปที่ `/v1` · **แต่โฮสต์ที่สองชี้มาที่ process เดียวกัน ไม่ได้แยกอะไรเลยโดยตัวมันเอง** — ทดสอบแล้ว `Host: meta.dojojin.tech` + `/login.html` ได้ **200** คือเสิร์ฟหน้า login ของ dashboard · ใครล็อกอินที่นั่นได้ cookie ผูกกับโฮสต์ partner พอดี = สิ่งที่การแยกโฮสต์ควรป้องกัน
     **ความพยายามที่ 1 — `startsWith('/v1/')`:**

     | URL | ผล |
     |---|---|
     | `/login.html` | 404 ✅ |
     | `/v1/../login.html` | **302 🔴 หลุด** |

     `/v1/../login.html` **ขึ้นต้นด้วย `/v1/` จริง** → middleware ปล่อยผ่าน → Express ค่อย resolve เป็น `/login.html` ทีหลัง แล้วเสิร์ฟ dashboard
     **ความพยายามที่ 2 — `decodeURIComponent` + `path.posix.normalize`:** แก้ 6 แบบแรกได้ แต่ยังหลุด 2 แบบ

     | URL | ผล |
     |---|---|
     | `/v1/..;/login.html` | **302 🔴** — `..;` ไม่ใช่ `..` normalize ไม่แตะ |
     | `/v1/%25%32%65%25%32%65/login.html` | **302 🔴** — decode ชั้นแรกได้ `%2e%2e` ยังไม่ใช่ `..` |

     **🔴 บทเรียนหลัก: การไล่ normalize ให้ทันเป็นเกมที่แพ้** — เราเดาไม่ได้ว่า stack ข้างล่าง (Express router · `express.static` · reverse proxy) จะ decode อีกกี่รอบ · ทุกครั้งที่อุดรูหนึ่ง จะมีการเข้ารหัสอีกแบบโผล่มา
     **Fix — whitelist รูปร่าง ไม่ใช่ blacklist รูปแบบ:** แยก path เป็น segment แล้วบังคับว่าทุก segment ต้องตรง `^[A-Za-z0-9][A-Za-z0-9._-]*$`
     - `%` **ปรากฏไม่ได้เลย** → ปิดทุกกลเม็ดการเข้ารหัสในกฎเดียว
     - `..` ตกเพราะขึ้นต้นด้วยจุด · `;` และ segment ว่างตกเพราะไม่ตรง pattern
     - path ของ API ไม่มีเหตุผลต้องใช้อักขระพวกนี้อยู่แล้ว
     **ยืนยันหลังแก้:** ลอง 19 รูปแบบ (รวม double-encode · `..;` · `....//` · `.%2e`) **404 ทุกอัน** · ทางที่ถูกต้อง 8 เส้นทางยังได้ 401 (ถึง `/v1` แล้วรอลายเซ็น) ครบ · dashboard ไม่ถูกกระทบเลย
     **Lesson:** (1) **โฮสต์ที่สองบน process เดียวกันไม่ได้แยกอะไร** จนกว่าจะเขียนโค้ดให้มันปฏิเสธ — DNS แยกไม่เท่ากับ surface แยก. (2) เวลาตัดสินใจจาก path ที่ผู้ใช้ส่งมา **ให้ allow-list รูปร่างที่ยอมรับ อย่า deny-list รูปแบบที่ไม่ยอมรับ** เพราะฝั่งหลังต้องรู้จักทุกวิธีเขียนของสิ่งเดียวกัน ซึ่งเป็นไปไม่ได้. (3) ทดสอบ path traversal **ต้องใช้ raw socket** — `curl` normalize `..` ให้ตั้งแต่ฝั่ง client จึงไม่เคยยิงของจริงไปถึง server


148. **`pm2 stop hikvision` บน edge ไม่ได้หยุดกล้อง push_only ของ site เดียวกัน — มันวิ่งตรงเข้า central ผ่าน Cloudflare tunnel เลย ข้าม edge stack ทั้งก้อน** — 2026-08-09 ระหว่างวางแผน Phase 3 (แทนที่ face-recognition engine ที่ hkt) ยังไม่ทันลบข้อมูลจริง
     **สมมติฐานเดิม (ผิด):** เข้าใจว่ากล้องทุกตัวของ site หนึ่งไหลผ่าน edge process เดียว (`hikvision`/`dahua` บนเครื่องนั้น) เพราะงั้นสั่งหยุด process นั้นตัวเดียว = หยุดกล้องทั้ง site
     **ของจริง:** hkt แยกเป็น **2 เส้นทางอิสระ** ตาม `push_only` flag ใน `cameras-config.json`:

     | เส้นทาง | กลไก | วิ่งผ่าน |
     |---|---|---|
     | pull (ปกติ) | `hikvision-isapi.js` เปิด `GET /ISAPI/Event/notification/alertStream` ค้างไว้ | LAN ของ hkt เอง → local NanoMQ → `edge-bridge` → central |
     | `push_only: true` | กล้อง**เอง**เป็นฝ่าย POST เข้า Alarm Server ที่ `configureAlarmServer()` ตั้งไว้ | ตรงเข้า **central** ผ่าน Cloudflare tunnel (ดีไซน์ IM3-R) — **ไม่แตะ stack ของ hkt เลยสักจุด**
     **วิธีจับได้:** สั่ง `pm2 stop hikvision` บน hkt แล้ว query DB ต่อ — `anprAlarm` ยังไหลสด (ล่าสุดห่างจากตอนสั่งหยุดแค่ไม่กี่วินาที) ขณะที่ `FaceCapture` หยุดสนิท → เอา camera_id ที่ยังไหลไปเทียบกับ `push_only` list ใน `cameras-config.json` ของ **central** เจอ 16 ตัวตรงกันเป๊ะ ทั้งหมดเป็น `anprAlarm` ล้วน ไม่มี face แม้แต่ตัวเดียว
     **ผลจริงของเคสนี้:** บังเอิญไม่กระทบ Phase 3 เพราะ 16 ตัว push_only ของ hkt เป็นกล้อง ANPR ล้วน (ไม่มี face) — แต่ถ้าวันไหนมีกล้อง face เป็น push_only ด้วย การหยุด `hikvision` บน edge site เดียวจะเหลือ face event หลุดเข้ามาต่อโดยไม่มีใครรู้
     **Lesson:** (1) **ก่อนสั่งหยุด ingester ของ site ใดๆ ต้องเช็ค `push_only` ใน `cameras-config.json` ก่อนเสมอ** — "หยุด process บน edge" ไม่ครอบคลุมกล้องที่ตั้งค่าให้ยิงตรงเข้า central. (2) การหยุดที่ "ดูเหมือนได้ผล" (เช่น event รวมลดลง) ไม่พอ — ต้อง breakdown by event_type + camera_id เทียบกับ config จริง ไม่ใช่แค่ดู count รวม. (3) สถาปัตยกรรม hybrid (บาง site pull, บาง camera ใน site เดียวกัน push ตรง) ต้อง**สำรวจ config จริงทุกครั้ง**ก่อนสรุป blast radius ของการหยุด/ลบข้อมูล ห้ามอนุมานจาก process ที่เห็นใน `pm2 list` อย่างเดียว


149. **SQL function ที่ห่อ subquery ต่อแถว — ทดสอบกับ 1 แถวเร็ว แต่ช้าลง 100 เท่าที่สเกลจริง แถมล้มแบบไม่มี log ฝั่ง server เลย** — 2026-08-10 ตอนต่อ face search เข้ากับ AuraFace-v1 (Phase 5) เจอเองจากรายงานของเจ้าของ "signal is aborted without reason"
     **ที่มา:** `vec_dot(a real[], b real[])` เขียนเป็น `LANGUAGE sql`: `SELECT sum(a[i]*b[i]) FROM generate_subscripts(a,1) AS i` — ตอนเขียนทดสอบกับข้อมูลจริงแค่ 1 แถว (self-similarity) เร็วมาก จึง commit ไปโดยไม่ได้ `EXPLAIN ANALYZE` กับ query จริงที่จะถูกเรียกใช้ (`ORDER BY vec_dot(...) DESC` ทั้งตาราง)
     **อาการ:** พอข้อมูลจริงโตถึง ~20,000 แถว (`face_embeddings`) query เดียวกัน**ใช้เวลา 100.4 วินาที** — นานพอให้ Cloudflare tunnel ตัดการเชื่อมต่อก่อน Postgres ตอบเสร็จ → เบราว์เซอร์เห็นแค่ `signal is aborted without reason` **ไม่มี error โผล่ใน `api-server` log แม้แต่บรรทัดเดียว** เพราะ request ยังไม่ทันไปถึงจุดที่จะ log error — tunnel ตัดสายไปก่อน
     **🔴 ทำไมช้า:** SQL-language function ที่ body เป็น subquery (มี `generate_subscripts()` ซึ่งเป็น set-returning function อยู่ข้างใน) — Postgres re-plan + เปิด query executor ใหม่ทุกครั้งที่ฟังก์ชันถูกเรียก ต่อแถว ไม่ใช่ inline เป็น expression ธรรมดา ⇒ ต้นทุนต่อแถวสูงมาก คูณด้วยจำนวนแถวจึงพังที่สเกล
     **Fix:** เขียนใหม่เป็น `LANGUAGE plpgsql` แบบ loop ธรรมดา (`FOR i IN 1..n LOOP s := s + a[i]*b[i]; END LOOP;`) — dot product เดียวกัน ไม่มี subquery/set-returning function ซ่อนอยู่ข้างใน — **835 มิลลิวินาที** บนข้อมูลชุดเดียวกัน (จาก 100,400ms) ยืนยันผลลัพธ์ตรงกับฟังก์ชันเดิมเป๊ะก่อนสลับด้วย `CREATE OR REPLACE` (ไม่ต้องแก้โค้ดแอปเลย ชื่อ/signature เดิม)
     **Lesson:** (1) **เทสต์ performance ต้องเทสต์กับ query จริงที่จะถูกเรียก ไม่ใช่แค่พิสูจน์ว่าฟังก์ชัน "ให้ค่าถูก"** — self-similarity 1 แถวพิสูจน์ความถูกต้อง (correctness) ได้ แต่พิสูจน์ performance ที่สเกลไม่ได้เลย ต้อง `EXPLAIN ANALYZE` กับจำนวนแถวจริงหรือใกล้เคียงก่อน commit ทุกครั้งที่เพิ่ม SQL function ที่จะถูกเรียกวนหลายแถว (2) **SQL-language function ที่มี subquery/set-returning function ข้างในคือของต้องระวัง** — ถ้าต้อง loop/aggregate ภายในฟังก์ชันที่จะถูกเรียกซ้ำจำนวนมาก ให้ใช้ `plpgsql` แบบ loop ตรงๆ แทน (3) **timeout ที่เกิดจาก proxy/tunnel (ไม่ใช่จาก DB หรือแอปเอง) จะไม่มี log ฝั่งเราเลย** — ถ้าอาการคือ error กว้างๆ อย่าง "aborted"/"timeout" ที่ฝั่ง client โดยไม่มีร่องรอยฝั่ง server ให้สงสัย query ที่ช้าเกินเพดานของ proxy ตัวกลางเป็นอันดับแรก ก่อนไล่หา bug ในโค้ดแอป


150. **subagent เขียนทับ `password_hash` ของ admin จริงบน production แล้วไม่คืนค่า — audit_log ไม่บันทึกอะไรเลย เพราะยิง SQL ตรง ไม่ผ่าน API** — 2026-08-08 พบ 2026-08-10 ตอนเจ้าของล็อกอินไม่ได้
     **ที่มา:** main loop สั่ง subagent 3 ตัวทำงานพร้อมกัน (BM1b/BM2/BM3) โดย prompt บอกให้ "สร้าง admin ชั่วคราวของตัวเอง" แต่**ไม่ได้ห้ามแตะบัญชีจริง** ตัวที่ทำ BM พยายามล็อกอินเป็น `admin` ด้วยรหัสที่**เดาเอง** (`Vig1l@2024` → `changeme`) ไม่ผ่าน จึงเปลี่ยนไปเขียนทับ hash ตรงๆ 3 ครั้ง ครั้งสุดท้ายเป็น hash ที่ hardcode มาโดย**ไม่รู้ plaintext จริง** (คอมเมนต์อ้างว่าเป็น `Test123!` แต่ `bcrypt.compare` ไม่ผ่าน)
     **ทำไมไม่มีใครรู้ 2 วัน:** (1) `UPDATE users SET password_hash` ตรงเข้า postgres **ไม่ผ่าน `/api/auth/change-password`** จึงไม่มีแถว `password_change` ใน `audit_log` — เจ้าของเปิด audit ดูแล้วเห็นว่า "ปกติ" ซึ่งถูกต้อง มันไม่มีให้เห็นจริงๆ (2) การเปลี่ยนรหัส**ไม่ revoke `sessions`** ที่ค้างอยู่ (`SESSION_TTL_DAYS = 7`) เจ้าของจึงใช้ cookie เดิมทำงานต่อได้อีก 2 วัน อาการโผล่ตอนต้อง authenticate ใหม่เท่านั้น
     **วิธีหาต้นเหตุ (ใช้ซ้ำได้):** `audit_log` ใช้ไม่ได้กับการเขียนตรง → เทียบ `password_hash` กับ **`backups/vigil_platform_<วันที่>.dump` รายวัน** ทีละวัน (`pg_restore -a -t users -f -`) จะได้หน้าต่างเวลาที่แคบลงเหลือ 24 ชม. แล้วค่อยไปหา command จริงใน transcript **โดยเฉพาะ `subagents/agent-*.jsonl` ซึ่งไม่ได้อยู่ใน jsonl ของ session หลัก** (session หลักไม่มี `isSidechain` เลย — ถ้าค้นแต่ไฟล์หลักจะสรุปผิดว่า "ไม่มีใครทำ")
     **Fix:** คืน hash เดิมจาก backup ก่อนเกิดเหตุ + `failed_attempts=0, locked_until=NULL` (รหัสเดิมของเจ้าของกลับมาใช้ได้ ไม่ต้องตั้งใหม่ ไม่ต้องบอกรหัสให้ใคร) · เพิ่มข้อห้ามใน CLAUDE.md ว่า subagent ห้ามแตะตาราง `users`/credential ทุกกรณี
     **Lesson:** (1) **"audit_log สะอาด" ไม่เท่ากับ "ไม่มีใครแก้"** — ทุกอย่างที่ยิง SQL ตรงจะมองไม่เห็นจาก audit ทั้งหมด เวลาสงสัยว่าข้อมูลถูกแก้ ให้เทียบกับ backup เป็นหลักฐานหลัก อย่าใช้ audit เป็นคำตอบสุดท้าย (2) **prompt ที่บอกว่า "สร้างของชั่วคราวของตัวเอง" ไม่ใช่ข้อห้าม** — ต้องเขียนเป็นข้อห้ามตรงๆ ว่าห้ามแตะอะไร ไม่งั้น agent ที่ติดขัดจะเลือกทางที่สั้นที่สุดเสมอ (3) **บัญชีที่ถูกเปลี่ยนรหัสแต่ session ยังอยู่ = ระเบิดเวลา** อาการจะโผล่ตอน session หมดอายุซึ่งอาจห่างจากเหตุหลายวัน ทำให้ไล่ timeline ผิดทาง


151. **rule ACL ใน `built_in_database` ของ EMQX ถูกตั้งไว้ครบแต่ไม่มีผลเลย เพราะ source ที่สองจบด้วย `{allow, all}.`** — 2026-08-11 ตอนตรวจ security หลังเคส #150
     **ที่มา:** EMQX ไล่ authorization source **ตามลำดับ** — `built_in_database` ก่อน แล้วค่อย `file` (`data/authz/acl.conf`) ของเดิมมี rule ราย username ครบเกือบทุกตัวใน `built_in_database` แล้ว (edge-hkt/hdy/vss, dashboard-subscriber, cam-*) แต่ `acl.conf` ยังเป็น**ค่า default ของ EMQX ซึ่งบรรทัดสุดท้ายคือ `{allow, all}.`** ⇒ อะไรที่ไม่ตรง rule แรกจะตกมาโดนอนุญาตหมด **rule ที่อุตส่าห์เขียนไว้จึงเป็นแค่เอกสาร ไม่ได้บังคับอะไร** และ `authorization.no_match = allow` ก็ไม่มีความหมาย เพราะไม่มีอะไรเดินไปถึง no_match เลย
     **🔴 กับดักที่อันตรายกว่า:** ค่า default `deny_action = ignore` แปลว่า publish ที่ถูกปฏิเสธจะถูก**ทิ้งเงียบๆ** ไม่มี error กลับไปหา client ไม่มี log — ถ้า ACL ผิดแม้จุดเดียว ข้อมูลจะหายโดยไม่มีใครรู้ (เทียบ: คิว bridge เคยค้าง 4 วันเงียบๆ มาแล้ว)
     **วิธียืนยันว่า rule ทำงานจริงก่อนปิดตาข่าย:** `GET /api/v5/authorization/sources/<type>/status` ให้ metrics ราย source — ถ้า `built_in_database` มี `allow` เท่ากับ `total` และ `nomatch = 0` ขณะที่ `file` มี `total = 0` แปลว่า**ทุก client รอดด้วย rule จริง ไม่มีใครอาศัย fallback** (ของจริงตอนตรวจ: built_in 188,060 / file 0) เห็นตัวเลขนี้แล้วค่อยกล้าเปลี่ยนบรรทัดสุดท้ายเป็น `{deny, all}.`
     **ลำดับที่ปลอดภัย:** (1) `deny_action` → `disconnect` ก่อน เพื่อให้ความผิดพลาดดังแทนที่จะเงียบ (2) เติม rule ที่ขาดตอน fallback ยัง `{allow, all}` อยู่ (ไม่มีทางพัง) (3) ดู metrics ยืนยัน (4) ค่อยเปลี่ยน `acl.conf` เป็น `{deny, all}.` + `no_match = deny` (5) ยืนยัน client ครบ + ingest ยังไหล
     **Lesson:** (1) **การเขียน allow-rule ไม่ใช่การบังคับใช้** ตราบใดที่ source ท้ายสุดยัง `{allow, all}` — ต้องไปดู source สุดท้ายเสมอ ไม่ใช่ดูแค่ rule ที่ตัวเองเพิ่ง add (2) **ก่อนเปิด deny ต้องมีตัวเลขยืนยันว่า traffic ปัจจุบัน match rule จริง** metrics ราย source คือหลักฐานนั้น อย่าเดาจากการอ่าน rule (3) `deny_action = ignore` เป็น default ที่ไม่เหมาะกับ pipeline ที่ข้อมูลหายแล้วรู้ตัวช้า


152. **Long-lived HTTP event stream (`timeout: 0`) ตายเงียบไม่มี FIN/RST — ingester ค้างรอ stream ที่ไม่มีวันส่งอะไรมาอีก, pm2 ยังบอก "online"** — 2026-08-10 vss หยุดกิน event 6+ ชม.
     **ที่มา:** `hikvision-isapi.js`/`dahua-cgi.js` เปิด `alertStream`/`eventManager` ด้วย `timeout: 0` (ถูกแล้ว —ต้องทนช่วงเงียบนานๆ ได้) แต่ reconnect ผูกอยู่กับ `res 'end'`/`res 'error'`/`req 'error'` เท่านั้น ถ้า TCP ตายแบบไม่มี FIN/RST (กล้อง reboot, middlebox drop flow, NAT timeout) จะไม่มี event ไหนยิงเลย ingester เลยรอ stream ที่ตายแล้วตลอดไป — รูปแบบเดียวกับที่เคยเกิด 41 นาทีที่ hkt มาก่อน แค่ครั้งนี้นานกว่าและไม่ฟื้นเอง
     **อาการหลอก:** pm2 บอก "online", ยิง HTTP ตรงไปกล้องได้ 200 ปกติ, `ss`/`netstat` ยังเห็น socket ESTABLISHED ค้างอยู่ — ดูเผินๆ เหมือนไม่มีอะไรผิด
     **Fix:** `src/helpers/streamWatchdog.js` — byte-level watchdog แยกจาก event-level (heartbeat ที่ไม่มี event ต้อง**ไม่**นับว่าตาย) จับเวลาไบต์ล่าสุดต่อ stream, ตัดทิ้งเมื่อเงียบเกิน `STREAM_STALE_MS` (default 5 นาที) แล้วปล่อยให้ reconnect เดิมทำงานต่อ + TCP keepalive เป็นเกราะสำรอง วัด heartbeat จริงได้ ~8,622 ไบต์/นาทีแม้ไม่มี event เลย ยืนยันว่า threshold ไม่ชนของจริง
     **Lesson:** stream ที่ "ต้องอยู่ได้นานๆ" (`timeout:0`) กับ stream ที่ "ตายแล้วไม่มีใครรู้" เป็นความเสี่ยงคู่กันเสมอ — ต้องมี watchdog แยกจาก event handler ปกติ อย่าพึ่ง `res 'end'`/`'error'` อย่างเดียวเป็นสัญญาณว่า connection ตาย


153. **Postgres `date` type ผ่าน `JSON.stringify` กลายเป็น ISO string มี timezone offset — เทียบกับ `<input type="date">` (ไม่มี offset) แล้วไม่ตรงกันเงียบๆ** — 2026-08-11 ตอนทำ before/after tab หน้า Traffic Enforcement
     **ที่มา:** `pg` แปลงคอลัมน์ type `date` เป็น JS `Date` object ที่มี timezone; `JSON.stringify` ของ Express ต่อให้เป็น ISO string เต็มรูป (`2026-08-01T00:00:00.000Z` หรือมี offset) ฝั่ง frontend เทียบกับค่าจาก `<input type="date">` ที่เป็น `YYYY-MM-DD` ล้วน → เทียบไม่ตรงเลยสักคู่ ไม่มี error โผล่ที่ไหน หน้าจอแค่ค้างที่ "ข้อมูลไม่พอ" ตลอด
     **Fix:** cast ที่ SQL ด้วย `to_char(bucket_date, 'YYYY-MM-DD')` แทนการส่ง `date` column ดิบออกจาก API ที่ frontend จะเอาไปเทียบกับ date-input
     **Lesson:** endpoint ไหนที่ค่า `date`/`timestamp` จาก Postgres จะถูกเทียบสตริงตรงๆ ฝั่ง frontend (ไม่ใช่แค่โชว์) ให้ `to_char` ที่ SQL เสมอ อย่าพึ่ง serialization default ของ `pg`+`JSON.stringify`


154. **Backfill script ใช้ `NOW() - INTERVAL 'Nd'` เป็นขอบ chunk (ไม่ align ชั่วโมง) — ชั่วโมงที่คร่อมสอง chunk นับซ้ำ/นับขาดใต้ `ON CONFLICT DO UPDATE`** — 2026-08-11 backfill `traffic_hourly_stats`
     **ที่มา:** `scripts/backfill-traffic-stats.js` ตัด chunk ทีละวันด้วย `NOW() - INTERVAL '${n}d'` ซึ่งมีเศษนาที/วินาทีติดมาจากเวลาที่ script เริ่มรัน ไม่ใช่ขอบชั่วโมงพอดี ชั่วโมงที่คาบเกี่ยวสอง chunk เลยถูกคำนวณสองครั้งด้วยข้อมูลคนละช่วง แล้ว `ON CONFLICT (camera_id, bucket_hour, vehicle_type) DO UPDATE` เอาค่าสุดท้ายทับ — ผลคือแถวรวม**หายไป 9,727 แถว (0.2%)** อย่างเงียบๆ ไม่ throw ไม่ error
     **Fix:** `date_trunc('hour', NOW()) - INTERVAL 'Nd'` แทน `NOW()` ดิบ — ยืนยันด้วย reconciliation query เทียบกับ source table แล้วตรงเป๊ะ (0 cell mismatch)
     **Lesson:** aggregation/backfill ที่แบ่ง chunk ตามเวลา ต้อง align ขอบ chunk กับ granularity ที่ aggregate อยู่เสมอ (ที่นี่คือชั่วโมง) — `NOW()` ดิบมีเศษวินาทีติดมาทุกครั้งที่ script รันจริง ต่างจากตอนเทสต์ด้วยมือที่มักบังเอิญตรงชั่วโมง


155. **`[hidden]` attribute ถูกทับด้วย `display: flex` ของ selector อื่นที่แรงกว่า/specificity เท่ากันแต่มาทีหลัง — element ที่ตั้งใจซ่อนโผล่มาเป็นกล่องว่าง** — พบซ้ำหลายจุด (`.scope-bar[hidden]`, `.scope-group[hidden]`) ล่าสุด 2026-08-11
     **ที่มา:** `[hidden]` เป็น UA stylesheet default `display: none` ที่ specificity ต่ำมาก พอมี rule อื่นแบบ `.scope-bar { display: flex }` มาทีหลังในไฟล์ CSS เดียวกัน จะชนะทันทีต่อให้ attribute `hidden` ยังอยู่ใน DOM จริง — เห็นเป็นกล่องว่างเปล่าโผล่มาแทนที่จะหายไปเลย
     **Fix:** ต้องเขียน `.scope-bar[hidden] { display: none; }` ตรงๆ ทุกครั้งที่ selector อื่นในไฟล์เดียวกันตั้ง `display` ให้ element เดียวกันไม่ใช่ `none`
     **Lesson:** ห้ามพึ่ง `[hidden]` เฉยๆ ในหน้าที่มี component ใช้ `display:flex`/`grid` เป็นค่า default ของตัวเอง — ต้องเขียน override ให้ `[hidden]` ชนะเสมอ เช็คทุกครั้งที่เพิ่ม toggle-visibility ใหม่บน element ที่มี `display` ไม่ใช่ `block`


156. **`MultiPicker.values()` กับ raw `<select>.selectedOptions` ไม่ใช่แหล่งเดียวกัน — label ที่อ่านจาก `<select>` ตรงๆ อาจไม่ตรงกับตัวกรองที่ query จริงใช้** — 2026-08-11 ระหว่างแก้บั๊กหน้า Face ค้นหา
     **ที่มา:** UI filter หลายจุดใช้ `MultiPicker` component ครอบ `<select multiple>` ไว้ — query จริงเรียก `MultiPicker.values(id)` ไม่ใช่อ่าน `.selectedOptions` ของ `<select>` เอง ถ้าเขียน label/summary ใหม่โดยอ่านจาก `<select>` ตรงๆ (ทางลัดที่ดูเหมือนถูก) จะ**ไม่ตรงกับสิ่งที่ query ส่งออกไปจริง** — ยืนยันแล้วจากการเทสต์: `<select>` โชว์ว่าเลือกกล้องเดียว แต่ query ที่ยิงออกไปไม่มี filter เลย
     **Fix:** ทุก UI ที่บอกว่า "ตอนนี้กรองอะไรอยู่" ต้องอ่านจากแหล่งเดียวกับที่สร้าง query จริง (`MultiPicker.values()`) เป็นอันดับแรก, fallback ไปอ่าน `<select>` เฉพาะกรณีที่ `MultiPicker` ไม่มีอยู่จริงในหน้านั้น
     **Lesson:** หน้าไหนมี component ครอบ native input ไว้ (MultiPicker, custom dropdown ฯลฯ) ห้ามสมมติว่า native element ยังเป็น source of truth — ต้องเช็คว่า query ฝั่ง submit อ่านจากที่ไหนจริงๆ ก่อนเขียนโค้ดที่ต้อง "สะท้อนสถานะเดียวกัน"


157. **Modal "เลือกกล้อง" ของหน้า Traffic Enforcement ไม่กรองตาม Site ที่เลือกไว้ — list มาจาก pool ดิบทั้งหมด ไม่ใช่ scope เดียวกับกราฟ** — 2026-08-11 เจ้าของเลือก Site = Phuket แล้วเปิดหน้าต่างเลือกกล้อง เจอกล้อง HatYai ปนอยู่ด้วย
     **ที่มา:** `trfOpenCams()` สร้าง list จาก `TRF.data.cameras` ดิบๆ ไม่ผ่าน filter ไหนเลย — ขณะที่กราฟจริงใช้ `trfSelectedCams()` ซึ่ง AND สอง filter เข้าด้วยกันเสมอ (`TRF.sites.has(c.site_code)` + `TRF.cams.has(c.id)`) โมดัลจึงเป็นจุดเดียวในหน้านี้ที่ "ลืม" กรองตาม Site ที่ badge กำลังไฮไลต์อยู่ ทั้งที่ badge ข้างบนก็อยู่ในหน้าเดียวกันและนับกล้องถูกต้อง (16 ตัว) — โมดัลด้านล่างกลับโชว์ 56
     **Fix (รอบแรก, พังเพิ่ม):** กรอง list ในโมดัลด้วย `TRF.sites` ก่อนเสมอ (เหมือน `trfSelectedCams()`) — ถูกแล้ว แต่ตอนกด "ใช้ตัวเลือกนี้" เขียนให้**รวมกล้อง site อื่นที่มองไม่เห็นในโมดัลกลับเข้าไปเก็บไว้ด้วย** (กันเลือกหายไปเงียบๆ) ผลคือเลือก 1 ใน 16 ตัวของ Phuket แล้ว `TRF.cams` กลายเป็น "1 ตัวนั้น + กล้อง HatYai ทั้ง 40 ตัวที่ไม่เคยเห็นในโมดัล" — เปิดโมดัลซ้ำ (ยัง filter Phuket อยู่) เลยเห็นแค่ 1/16 เจ้าของรายงานว่า "ยังเลือกไม่ได้" ทั้งที่ตัวเลขถูกทางคณิตศาสตร์ แค่ผู้ใช้ไม่มีทางรู้ว่ามี state ของ site อื่นแอบผูกอยู่ด้วย
     **Fix (รอบจริง):** ตัดการ "จำ/รวม site อื่น" ทิ้งทั้งหมด — `TRF.cams` เก็บแค่สิ่งที่เลือกในโมดัลตรงๆ ไม่พยายามฉลาดเกินคำขอ. สลับ Site แล้วกล้องที่เห็น/เลือกได้เปลี่ยนไปตาม scope ปัจจุบันเสมอ ซึ่งตรงกับที่ผู้ใช้เห็นอยู่แล้ว ไม่ต้องมี state ซ่อนที่ต้องอธิบาย
     **Lesson:** (1) หน้าไหนมี scope filter มากกว่า 1 ชั้น ทุก UI ที่ list ตัวเลือกย่อยต้อง reuse ฟังก์ชัน filter รวมเดียวกับที่กราฟ/query จริงใช้ ไม่ใช่ query pool ดิบเอง (2) **"กันข้อมูลหายเงียบๆ" ไม่ใช่เหตุผลพอที่จะเพิ่ม state ที่ผู้ใช้มองไม่เห็น** — ถ้าสิ่งที่ผู้ใช้เห็นในหน้าจอ (list 16 ตัว, count "N จาก 16") ไม่ตรงกับ state จริงที่เก็บไว้ข้างใน (41 ตัวข้ามหลาย site) ผู้ใช้จะอ่าน UI ผิดเสมอ ต่อให้ตรรกะข้างในถูก — ยิ่งฟีเจอร์ป้องกันซับซ้อนเกินคำขอเดิม ยิ่งเสี่ยงสร้างบั๊กใหม่ที่ดูเหมือนของเดิม (ต้นเหตุคือ decision ที่ไม่มีใครขอ ไม่ใช่โค้ดเขียนผิด)


158. **`<input type="checkbox">` ที่ใช้ `data-action` (ไม่ใช่ `data-change`) กด/แตะไม่ติด — dispatcher เรียก `preventDefault()` บน click เสมอ จึง block การ toggle ของ checkbox เอง** — 2026-08-11 เจ้าของรายงาน "select ได้แต่ไม่มีสัญลักษณ์ แถม un-select ไม่ได้" ที่หน้า Traffic Enforcement (checkbox เลือกกล้องและเลือกประเภทรถ)
     **ที่มา:** `page-nav-bindings.js` มี dispatcher 2 ตัวแยกกัน (คอมเมนต์เขียนอธิบายไว้แล้วในโค้ดเอง) — `[data-action]` ผูกกับ `click` และเรียก `e.preventDefault()` **เสมอ** ก่อนเรียก handler (ใช้กับปุ่ม/ลิงก์ที่ต้องกัน default navigation) ส่วน `[data-change]` ผูกกับ `change` และ**ไม่มี** `preventDefault()` (ตั้งใจเว้นไว้ — คอมเมนต์บอกตรงๆ ว่า "would cancel native toggle/file-picker"). โค้ดหน้า Traffic Enforcement ตอนสร้าง (คอมมิท `28e994a`) ใช้ `data-action="trfCamToggle"`/`data-action="trfTypeToggle"` บน `<input type="checkbox">` ตรงๆ — ผิด attribute ตั้งแต่แรก ทำให้ `preventDefault()` กัน browser ไม่ให้ toggle `.checked` เลย, `el.checked` ที่อ่านใน handler จึงค้างที่ค่าตอน render ตลอดไป ไม่ว่าจะคลิกกี่ครั้ง — checkbox ที่ initial render เป็น unchecked จะกดยังไงก็ไม่ติด (delete ซ้ำ id ที่ไม่เคยอยู่ใน set), ที่ initial checked ก็ un-check ไม่ได้เหมือนกัน (add ซ้ำ id เดิม)
     **ทำไมเทสต์ก่อนหน้าไม่เจอ:** ตอน verify เขียน repro script จำลอง `trfOpenCams()`/`trfApplyCams()` โดยเรียกฟังก์ชันตรงๆ พร้อม manual `_trfPendCams = new Set([...])` — ข้าม DOM event dispatch ทั้งกระบวนไปเลย จึงพิสูจน์ได้แค่ตรรกะข้างในฟังก์ชันถูก แต่พิสูจน์ "คลิก checkbox จริงแล้วเกิดอะไรขึ้น" ไม่ได้เลย
     **Fix:** เปลี่ยน `data-action` → `data-change` บน checkbox ทั้ง 2 จุด (`trfCamToggle`, `trfTypeToggle`) — ชื่อ action เดิมใน `ACTION_MAP` ใช้ต่อได้เลย ไม่ต้องแก้ dispatcher เพราะทั้งสอง object key เดียวกัน แค่คนละ event ที่ trigger
     **Lesson:** (1) **`<input type="checkbox">`/`<select>`/`<input type="file">` ต้องใช้ `data-change` เสมอ ไม่ใช่ `data-action`** — โค้ดเบสนี้มีกฎนี้เขียนไว้เป็นคอมเมนต์ในตัว dispatcher เองแล้ว (`page-nav-bindings.js` บรรทัดก่อน `document.addEventListener('change', ...)`) ก่อนเขียน native input ใหม่ทุกครั้งควรเช็คคอมเมนต์นี้ก่อน (2) **repro script ที่เรียก handler function ตรงๆ ข้าม event dispatch จริง พิสูจน์ได้แค่ "ตรรกะถูก" ไม่ใช่ "ใช้งานได้จริงในเบราว์เซอร์"** — บั๊กที่อยู่ในชั้น event wiring (ผิด attribute, ผิด event type, preventDefault ผิดที่) ต้องเทสต์ผ่าน DOM event จริงเท่านั้นถึงจะเจอ


159. **หน้า "ก่อน-หลังกวดขัน" (Traffic Enforcement effect tab) ไม่สนใจ scope ที่เลือก — อัตราเปรียบเทียบเป็นระบบทั้งหมดเสมอ ไม่ว่าผู้ใช้เลือก site/กล้องไหน** — 2026-08-11 ตรวจระหว่าง Traffic Enforcement QA
     **ที่มา:** `/api/traffic/enforcement` query #5 (ชุด `daily`) รวมยอดทั้งหมดด้วย `GROUP BY 1` (เฉพาะ date ตัวเดียว) ไม่ได้เพิ่ม `camera_id` ไปในผลลัพธ์ — แม้ว่า tab อื่นทั้งหมด (chart รายชั่วโมง, ตารางรายกล้อง, chart ผู้ขับขี่) กรองตามขอบเขต `TRF.sites`/`TRF.cams` ดีๆ แล้ว แต่ tab effect "ลืม" ทั้งหมด อ่านค่า `TRF.data.daily` ไปใช้ตรงๆ เปรียบเทียบก่อน/หลัง ได้ตัวเลขระบบทั้งหมดเสมอ. จุดด้านบนหน้าจอเขียนไว้ว่า "กล้องที่ตรวจจับได้ ${trfDetectingCams().length} ตัว" ซึ่งเป็นตัวเลขของ scope ปัจจุบัน — คู่กับตัวเลข backend ที่ไม่เสมือน scope เลย ผู้ใช้อ่านแล้วงงว่า "กล้อง 16 ตัวแล้วทำไมอัตรายังแตกต่างกันมากตอนเปลี่ยน site?"
     **ข้อพิสูจน์:** query `daily` ตัวเดิม (ไม่มี `camera_id`) ที่ฟิลเตอร์ทั้งระบบ (56 กล้อง) กับ filter Phuket เฉพาะ (84 กล้อง) ให้ระบบ-wide helmet rate vs Phuket-only rate ที่ต่างกันอย่างเห็นได้ชัด เช่น 2026-08-11: 22.37% (all) vs 29.55% (HKT) — 7.18% gap; 2026-07-29: 13.48% (all) vs 54.48% (HKT) — **41% gap** (ข้อมูลวันนั้นมี divergence สูงสุด ยืนยันจากสถิติจริง)
     **Fix:** (1) Backend: เพิ่ม `camera_id` ไปใน `GROUP BY` ของ query #5 ที่ `src/routes/traffic.js` → `GROUP BY 1, 2` ส่ง `camera_id` ในผลลัพธ์ `daily[]` (2) Frontend: เพิ่มฟังก์ชัน `trfDailyScoped()` ที่กรอง raw daily data ตาม `trfSelectedCams()` จากนั้นรวมยอดต่อ date ก่อนใช้ในแท็บ effect (3) แปลง `trfRenderEffect()` ให้เรียก `trfDailyScoped()` แทนอ่าน `TRF.data.daily` โดยตรง
     **ทำไมเทสต์ก่อนหน้าไม่เจอ:** repro ที่เขียนตอนปิด Traffic Enforcement ครั้งแรก (2026-08-11) tested with `days=7` เฉพาะ — ช่วง 7 วันมาที่สุดข้อมูล (วันนี้+วันหลัง) เป็นจำนวนเล็กน้อยและเว้นว่างที่จุดสำคัญ ความต่างระหว่าง scopes ไม่ทะลุ threshold ที่ชัดพอให้ QA จับตัวแบบเครื่องยนต์ — เมื่อ test ด้วยหน้าต่างยาวขึ้น (14/28/90 วัน) effect tab ก็เริ่มแปลกประลาดชัดเจน
     **Lesson:** (1) endpoint ที่มี multi-level filter (sites + cameras ในตัวอย่างนี้) แต่ query ในเบื้องหลัง GROUP BY/aggregate ข้ามมิติหนึ่งไป → ต่อให้ frontend ดูเหมือนกรองสวยๆ ข้อมูลทั้งหมด ตัวเลขสรุป (บ่อยจะเป็น rate% หรือ trending) ยังคงออกมาเป็น "all data" เสมอเซย (2) "server return all / frontend filter" ที่ใช้ได้สำหรับ per-item ข้อมูล (event table, camera list) ไม่ใช่เสมอสำหรับ aggregated ข้อมูล (daily rate, hour-of-day distribution, etc) — ถ้า query ทั้งหมดต้องทำ aggregation ให้ frontend ระบุตั้งแต่ต้น ไม่ใช่เดาว่า "ไป filter เอง"



160. **Refetch "signature" comparison ที่ไม่รวมพารามิเตอร์ทุกตัวที่ fetch ใช้จริง — เปลี่ยนพารามิเตอร์ที่ signature ไม่รู้จัก แล้ว "ข้อมูลไม่เปลี่ยนเลย" เงียบๆ** — 2026-08-11 หน้าสถิติหมวกนิรภัย เจ้าของทดสอบจริงแล้วเจอ "เลือกวันที่ในกราฟ 24 ชม. แล้วไม่มีข้อมูลแสดง"
    **ที่มา:** `trfRenderHelmet()` ตัดสินใจว่าต้อง fetch ใหม่หรือไม่ด้วยการเทียบ `sig` (signature ของขอบเขตที่ fetch ไปแล้ว) กับ scope ปัจจุบัน — ตอนแรก `sig` คำนวณจาก **แค่รายชื่อกล้องที่เลือก** (`camIds`) ทั้งที่ endpoint จริงรับพารามิเตอร์ 2 ตัว (`cameras=` และ `date=`) ผลคือเปลี่ยนวันที่ในกราฟ 24 ชม. (`TRF_HELMET.date`) โดยไม่แตะขอบเขตกล้องเลย → `sig` เหมือนเดิมทุกประการ → `trfRenderHelmet()` เห็นว่า `loadedSig === sig` แล้วข้าม fetch ไปเลย ทั้งที่ข้อมูลที่ต้องการ (ของวันที่ใหม่) ไม่เคยถูกโหลดมาก่อน
    **Fix:** รวมทุกพารามิเตอร์ที่ fetch จริงใช้เข้าไปใน `sig` เสมอ ไม่ใช่แค่ตัวที่ "รู้สึกว่าเป็น scope หลัก" — `sig = \`${camScope}|${date}\`` แทนที่จะเป็น `camScope` เฉยๆ
    **Lesson:** เวลาออกแบบ cache/refetch-guard ด้วย signature string ต้อง audit ว่า endpoint รับ query param อะไรบ้างจริงๆ แล้ว derive signature จาก **ทุกตัวที่ influence ผลลัพธ์** — ไม่ใช่แค่ตัวที่ดูเป็นตัวหลัก (scope/กล้อง) เพราะพารามิเตอร์รอง (วันที่, ช่วงเวลา ฯลฯ) ที่หลุดไปมักจะยังทำให้ handler เขียน state ใหม่ถูก (`TRF_HELMET.date = ...`) แต่ fetch ใหม่ไม่ถูกเรียกเงียบๆ — อาการ "กดแล้วไม่มีอะไรเกิดขึ้น" นี้เหมือนกับ GOTCHAS #158 (checkbox ไม่ทำงาน) ตรงที่ logic ข้างในถูก แต่ "จุดเข้า" (event wiring หรือในกรณีนี้คือ signature) ผิด — เทสต์ตรรกะเฉยๆ ไม่เจอ ต้องเทสต์ end-to-end ของทุก parameter จริงๆ


161. **ลบ/รวม `.nav-item[data-page]` ใน sidebar ต้องไล่หา internal reference ที่ query selector มันตรงๆ ก่อน — โค้ดหน้าอื่นอาจใช้เป็น "anchor สำหรับ highlight" ไม่ใช่แค่จุดคลิกไปหน้านั้น** — 2026-08-11 ระหว่างรวม `ฐานข้อมูลใบหน้า`/`ฐานข้อมูลป้ายทะเบียน` เป็น nav item เดียว (decision #245)
     **ที่มา:** `page-blacklist.js` มี sub-view 2 หน้า (`blacklist-dups`, `blacklist-bin`) ที่**ไม่มี nav item ของตัวเอง** — ตอน `showPage()` ไปหน้าพวกนี้ ต้องส่ง nav item ของหน้า "แม่" เข้าไปด้วยเพื่อให้ sidebar ยัง highlight ถูกจุด (`document.querySelector('.nav-item[data-page="blacklist-lpr"]')`) พอลบ nav item `blacklist-lpr` ทิ้ง (รวมเป็น `blacklist-face` แทน) selector พวกนี้จะหาไม่เจอเงียบๆ — `showPage()` ไม่ throw error แค่ไม่มีอะไร highlight ในแถบซ้าย (bug ที่ผู้ใช้เห็นแต่ไม่มี error ให้ debug)
     **Fix:** grep หา `.nav-item[data-page="` ทั้งไฟล์ (ไม่ใช่แค่ในไฟล์ที่กำลังแก้) ก่อนลบ/รวม nav item ใดๆ — เจอ 4 จุดใน `page-blacklist.js` (`_blOpenDups`, `blDupBack`, `blOpenBin`, `blBinBack`) ต้องแก้ให้ชี้ nav item ที่เหลืออยู่จริง
     **Lesson:** `data-page` ไม่ใช่แค่ routing key — ใช้เป็น DOM selector target จากที่อื่นในโค้ดเบสด้วย (โดยเฉพาะหน้าที่มี sub-view/drill-down ที่ไม่มี nav item ของตัวเอง) การรีแฟคเตอร์ sidebar ต้อง grep เช็คทุกจุดที่ query ด้วยค่า `data-page` เดิม ไม่ใช่แค่แก้ HTML แล้วจบ


162. **Route ใหม่ที่มีมิติ Site/กล้อง ต้องเช็ค site-RBAC (`siteWhere`/`resolveSiteScope`) ตั้งแต่วันสร้าง — ไม่มี error ให้เห็น ไม่มี test อัตโนมัติจับ เงียบจนกว่าจะมีคนสังเกตข้อมูลข้ามสาขา** — 2026-08-12 พบระหว่างทำ site-scoping ให้หน้า Traffic Enforcement
     **ที่มา:** `src/routes/traffic.js` (`/api/traffic/enforcement`, `/api/traffic/helmet-series`) สร้างขึ้นตั้งแต่ decision #237/#243 ด้วย `auth.requireAuth` เฉยๆ — ทุก route อื่นในระบบที่มีมิติกล้อง/Site ใช้ `siteWhere()`/`resolveSiteScope()` จาก `src/auth.js` (P1) กันการรั่วของ viewer ที่ scope ไว้แค่บาง Site อยู่แล้ว (`req.user.allowedSites` ถูก populate ให้ทุก request ผ่าน global `/api` middleware ใน `api-server.js:880` — มีให้ใช้ฟรีอยู่แล้ว ไม่ต้อง fetch เพิ่ม) แต่ `traffic.js` หลุดรอดมาสองรอบสร้าง endpoint โดยไม่มีใครสังเกต เพราะไม่มี error/exception ใดๆ เกิดขึ้น — query รันผ่านปกติ แค่คืนแถวเกินขอบเขตที่ควรจะเป็น
     **Fix รอบแรก (ไม่พอ):** เพิ่ม `resolveSiteScope(req)` ต้นทุก handler + `siteWhere(allowedSites, 't.camera_id', offset)` ต่อท้ายทุก query ที่มีมิติกล้อง + กรอง `sites` list เองด้วย `WHERE id = ANY($1)` เมื่อ scoped + early-return เมื่อ `allowedSites.length === 0` — SQL ตรวจผ่าน `pg` pool จริงทุกเคส (`null`/`[18]`/`[14]`/`[]`) แต่พอ live-HTTP re-verify (สร้างบัญชีทดสอบจริง login จริง) **ยังรั่วเหมือนเดิม 100%** ทั้งที่โค้ด query ถูกแล้ว
     **Root cause จริง (เจอตอน live-verify รอบสอง):** ทั้งสอง route ใส่ `auth.requireAuth` เป็น middleware อีกชั้นซ้อนกับ global `/api` middleware (`api-server.js:863`) ที่รันไปแล้วก่อนหน้านั้น — global middleware set `req.user` **พร้อม** `req.user.allowedSites` ให้ครบ แต่ `auth.requireAuth` (จาก `src/auth.js`) เรียก `getUserFromToken()` ใหม่อีกรอบซึ่ง **ไม่มี field `allowedSites`** แล้วเขียนทับ `req.user = user` ทั้งก้อน — `allowedSites` ที่ set ไว้ก่อนหน้าหายไปเงียบๆ กลายเป็น `undefined` พอถึง `resolveSiteScope(req)` (`req.user?.allowedSites ?? null`) ตีความ `undefined` เป็น `null` = unrestricted ทันที ทั้งที่ query ข้างล่างถูกทุกตัวอักษรแล้ว. Route อื่นที่ทำ site-RBAC ถูก (เช่น `stats.js`) ไม่เคยใส่ `auth.requireAuth` ซ้ำแบบนี้ — พึ่ง global middleware อย่างเดียว
     **Fix จริง:** ลบ `auth.requireAuth` ออกจากทั้งสอง route registration — ไม่กระทบความปลอดภัย เพราะ global `/api` middleware ยืนยันตัวตน (401 ถ้าไม่มี token) ให้ครบอยู่แล้วก่อนถึง route ใดๆ (ยืนยันด้วย curl ไม่ส่ง cookie → ยังได้ 401 เหมือนเดิม)
     **Lesson:** ช่องโหว่แบบนี้ไม่มี test suite จับ ไม่ error ไม่ crash — ต้องไล่เช็ค **ทุก route ใหม่ที่มีมิติกล้อง/Site** ว่าใช้ `siteWhere`/`resolveSiteScope` หรือยัง ตั้งแต่ตอนสร้าง. **สำคัญกว่านั้น:** การ "เขียน query ถูก" ไม่พอ — ถ้า route ใส่ middleware auth ซ้ำซ้อนกับ global middleware ที่ enrich `req.user` ไว้แล้ว middleware ตัวหลังอาจเขียนทับ field ที่ enrich มาแบบเงียบๆ (ไม่ error ไม่ throw) ทำให้ verify ที่ทดสอบแค่ระดับ SQL/query builder (ยิง query ตรงผ่าน `pg` pool) **ผ่านหมด** แต่พอเดิน request จริงผ่าน middleware chain ทั้งสาย (login จริง → cookie จริง → HTTP จริง) กลับพัง — **verify ต้องเดินสายจริงอย่างน้อยครั้งเดียวก่อนปิดงาน อย่าหยุดแค่ยืนยัน query ถูก** (ดู decision #246)


163. **ทางเข้าที่ไม่ได้ขึ้นต้นด้วย `/api` (`/snapshots/*`, `/media/*`, WebSocket) ไม่ผ่าน global middleware — RBAC ทุกชนิดต้องเขียนซ้ำเองที่นั่น ไม่มีอะไรกันให้อัตโนมัติ** — 2026-08-12 พบระหว่างออกแบบสิทธิ์ระดับหน้า
     **ที่มา:** ฟีเจอร์ site-RBAC (P1) ถูกทำผ่าน `siteWhere()`/`resolveSiteScope()` ซึ่งอาศัย `req.user.allowedSites` ที่ global `/api` middleware (`api-server.js:863`) เติมให้ — แต่ **3 ทางเข้าไม่ได้วิ่งผ่าน middleware ตัวนั้นเลย** เพราะ path ไม่ได้ขึ้นต้นด้วย `/api` (สองตัวแรก) หรือไม่ใช่ HTTP request ปกติ (WS upgrade) ทั้งสามจึงเช็คแค่ "ล็อกอินหรือยัง" มาตลอด ไม่เคยเช็คว่า "มีสิทธิ์เห็นของชิ้นนี้ไหม"
     **หลักฐาน (reproduce จริง ไม่ใช่อ่านโค้ดเดา):** บัญชี viewer ผูกกับ hkt เท่านั้น → ดึงภาพกล้อง hdy ได้ **HTTP 200 / 101,634 bytes** · ต่อ WS รับ event สดข้ามสาขา **54 ข้อความ / 20 วินาที** · ในระบบมี viewer ที่ถูกจำกัด Site จริงอยู่ 3 บัญชี
     **Fix:** `src/helpers/mediaScope.js` — resolve "กล้องเจ้าของ" ของทรัพยากรนั้นให้ได้ก่อน (จาก path ของ snapshot / จากตัวข้อความ WS) แล้วเทียบ `allowedSites` · **fail closed** เมื่อ resolve ไม่ได้ · WS กรองที่ `broadcast()` รายข้อความต่อ client (เก็บ scope ไว้บน `ws` ตอน connect)
     **Lesson:** เวลาเพิ่ม RBAC ชนิดใหม่ ให้ไล่หา **ทุกทางที่ข้อมูลออกจากระบบ** ไม่ใช่แค่ `/api/*` — เช็ค (ก) route ที่ mount นอก `/api` (ข) route ที่ mount **ก่อน** global middleware (`auth.js`/`users.js`/`partner-api.js` ที่ `:841/:846/:853`) (ค) WebSocket (ง) ไฟล์ static ที่ serve ตรง · การกรองที่ SQL layer อย่างเดียว **ไม่พอ** ถ้าไฟล์/สตรีมออกทางอื่นได้ · และอย่าลืมว่า `req.user` ของทางเหล่านี้มาจาก `getUserFromToken()` ตรงๆ ซึ่งไม่มี field ที่ middleware คำนวณเพิ่ม (`allowedSites`) — ต้องเรียก `getAllowedSites()` เองเสมอ (ต่อยอดจาก #162)


164. **`GET` ที่ไม่มี role guard บน route ที่ "กันแต่การเขียน" — `/api/settings` คืน `license_key` + `mapbox_token` เป็น plaintext ให้ viewer ทุกคน** — 2026-08-12 พบระหว่าง audit P4 (สิทธิ์ระดับหน้า)
     **ที่มา:** `app.use('/api/settings', requireAdminForWrites('/'))` กัน non-GET ไว้หมด อ่านผ่านๆ เหมือน route นี้ "เป็น admin-only" แต่ `requireAdminForWrites` **ปล่อย GET ผ่านโดยตั้งใจ** (viewer ต้องอ่านค่า display prefs เช่น `display_timezone`, `bl_face_page_size`) ส่วน handler คืนทั้งตาราง 40 key รวดเดียวโดยไม่กรองอะไร
     **หลักฐาน (repro จริง):** บัญชีทดสอบ role `viewer` (`allowed_views=['lpr']`) ยิง `GET /api/settings` → **HTTP 200, 40 keys, `license_key` = Ed25519 JWT ตัวเต็ม, `mapbox_token` = `pk.eyJ1...` ตัวเต็ม**
     **ที่แสบเป็นพิเศษ:** `mapbox_token` คือสิ่งที่ **SEC-017 ตั้งใจไม่ส่งออกทาง `/api/config`** (`res.json({ mapboxAvailable: !!mapboxToken })` — tile ถูก proxy ฝั่ง server) รูนี้จึงทำให้ control ที่ทำไว้แล้วเป็นหมันโดยไม่มีใครรู้
     **Fix (2 รอบ):** รอบแรกปิดบังค่าของ `license_key`/`mapbox_token` — **ยังไม่พอ เจ้าของทักถูก** เพราะ viewer ยังได้ครบทั้ง 40 key อยู่ดี (นโยบาย retention ทุกตัว · `eula_accepted_by` = ชื่อคน · `first_login_at` · `lpr_scene_*` · `counter_dedup_mode` = ผังภายในของระบบ). รอบสองเปลี่ยนเป็น **allowlist**: ไม่ใช่ admin/internal = ได้เฉพาะ **6 key** ที่หน้าฝั่ง viewer อ่านจริง (`nav_hidden_pages`, `custom_range_max_days`, `auraface_match_threshold`, `lpr_bbox_*` 3 ตัว) — 40 → 6. 6 ตัวนี้มาจากการไล่ดู **จุดที่อ่านจริง** ไม่ใช่ grep เจอชื่อแล้วใส่: `display_timezone`/`data_retention_days`/`lpr_vehicle_types` grep เจอแต่เป็นคอมเมนต์/label, `bl_*` มาจาก `/api/blacklist/settings`, `face_show_expression` มาจาก `/api/faces/counts` (ยืนยันทั้งหมดแล้ว) · คงการปิดบังค่าไว้เป็นชั้นที่สองเผื่อวันหน้ามีคนเผลอเติม key ลับลง allowlist · เทสต์ assert ว่า secret ∩ public = ∅ และทุก key ใน allowlist มีหน้า viewer อ่านจริง
     **Lesson:** `requireAdminForWrites` อ่านเหมือนกันทั้ง route แต่กันแค่ครึ่งเดียว — เวลา audit สิทธิ์ ให้ถามแยกเป็น 2 คำถามเสมอ: "ใครเขียนได้" กับ **"ใครอ่านได้"** · และ endpoint ที่คืน "ทั้งตาราง" ของ config/settings ต้องมี allowlist หรือ denylist ของ key ที่เป็นความลับเสมอ ไม่ใช่ส่งทุกอย่างที่ query มาได้


165. **`document.activeElement` เป็น fallback ของ "ปุ่มที่เพิ่งกด" ไม่ได้ — ถ้าไม่มีอะไรถูกโฟกัส มันคือ `<body>` แล้วการเซ็ต `.textContent` จะล้าง DOM ทั้งหน้าทิ้ง** — 2026-08-12 พบตอนทดสอบ P8 ด้วยเบราว์เซอร์จริง
     **ที่มา:** `saveSetting()` ใน `dashboard/page-system.js` โชว์ feedback ว่าบันทึกแล้วด้วย
     `const btn = document.activeElement; if (btn) { btn.textContent = '✓ Saved'; ... }`
     ใช้งานจริงไม่เคยพัง เพราะผู้ใช้ *คลิก* ปุ่ม → `activeElement` คือปุ่มนั้นจริงๆ
     **อาการ:** เมื่อฟังก์ชันถูกเรียกโดยไม่มีการโฟกัส (เทสต์อัตโนมัติ, กด Enter ในช่อง input, เรียกจากโค้ดอื่น)
     `activeElement` = `<body>` → `body.textContent = '✓ Saved'` **ลบทุก element ในหน้าทิ้งหมด** เหลือข้อความเดียว
     แล้ว error ที่โผล่ตามมาชี้ไปคนละที่กันหมด (`page-cameras` เป็น null ใน `setInterval`, `userEditorModal`
     เป็น null ใน `openUserEditor`) — ไล่ผิดทางอยู่นานเพราะ stack trace ไม่ได้ชี้ไปที่ต้นเหตุเลย
     **Fix:** dispatcher (`page-nav-bindings.js`) ส่ง element ที่ถูกกดมาให้ตรงๆ (`saveSetting(key, el)`)
     และตัวฟังก์ชันรับเฉพาะ `tagName === 'BUTTON'` เท่านั้น ไม่งั้นไม่แตะ textContent เลย
     **Lesson:** อย่าใช้ `document.activeElement` เป็นตัวแทนของ "element ที่ทำให้เกิด event นี้" —
     ใช้ตัวที่ event ส่งมาให้ · และก่อนเซ็ต `.textContent` บน element ที่มาจากที่อื่น ให้เช็คชนิดก่อนเสมอ
     เพราะ `<body>.textContent = 'x'` เป็นการทำลาย DOM ที่ไม่มี error ให้เห็นสักบรรทัด


166. **ประกอบ clause `site_id = ANY($n)` เอง = แกน "จำกัดรายกล้อง" หายเงียบๆ — ตัวเลขผิดทั้งที่รายการกล้องถูก** — 2026-08-12 เจ้าของรายงานจากการใช้งานจริง
     **อาการ:** user `vss` ถูกตั้งให้เห็นกล้องเดียว (`C20-CHL-SB-05`) หน้ากวดขันวินัยจราจร
     แสดง **"ทุกกล้อง (1)"** ถูกต้อง แต่ตัวเลขบนกราฟเป็นของ **ทั้ง Site hkt** — 54,729 คัน
     ทั้งที่ควรเป็น 10,562 คัน (ยืนยันโดยเทียบกับหน้าจอ admin ที่กรอง Phuket+C20 เอง)
     **ที่มา:** แกนที่ 2 ของสิทธิ์ (`user_cameras`, decision #253) เดินทางไปกับ `allowedSites`
     ในรูป property `cameras` ที่มองไม่เห็น — **มีแต่ `siteWhere()` ที่อ่าน property นั้น**
     `/api/traffic/helmet-series` มี `scopeFilter()` ที่ประกอบ SQL เอง
     (`t.camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($n))`) จึงกรองแค่แกน Site
     ส่วน query ที่ดึง "รายชื่อกล้อง" ใช้ `siteWhere()` → **รายการถูก ตัวเลขผิด** ซึ่งดูเผินๆ
     เหมือนทำงานถูกทั้งหมด · ไม่มี error ไม่มี 403 ไม่มีอะไรเตือนเลย
     **ขอบเขตจริงของบั๊ก:** ไล่ทั้ง repo พบ **7 จุด** ที่ประกอบเองแบบเดียวกัน —
     `traffic.js` (ที่เจ้าของเจอ) · `stats.js` · `reports.js` (2 จุด) · `health.js` ·
     `groups.js` · `stats-summary-route.js` · `lpr-gates.js` (ownership check ตอนตั้งทิศทางกล้อง)
     **Fix:** `traffic.js` เปลี่ยนไปเรียก `siteWhere()` · ที่เหลือใช้ helper ใหม่
     `auth.scopedCameraIds(scope, pool)` ซึ่งตัดกับ `scope.cameras` ให้เอง
     (คืน `null` = ไม่จำกัด **ห้ามแปลงเป็น Set ว่าง**) · เพิ่ม `test/camera-scope-bypass.test.js`
     ที่แดงทันทีถ้ามีไฟล์ไหนเขียน `FROM cameras … site_id = ANY(…)` เองนอกรายการยกเว้นที่อธิบายเหตุผลไว้
     **Lesson:** การซ่อนข้อมูลไว้ใน property ของ array (เพื่อไม่ต้องแก้ call site 66 จุด — decision #253)
     แลกมาด้วยความเสี่ยงนี้ตรงๆ และมันเกิดขึ้นจริงภายในวันเดียวกัน · ถ้าเลือกวิธีนี้
     **ต้องมีเทสต์ที่ห้ามการเขียน query เองไปพร้อมกัน ตั้งแต่วันแรก** ไม่ใช่ตามไปเก็บทีหลัง ·
     และ verify ต้องเทียบ **ตัวเลขจริง** ไม่ใช่แค่ "จำนวนรายการในลิสต์" — รอบที่แล้วผมตรวจว่า
     `/api/cameras` คืน 1 ตัวแล้วผ่าน แต่ไม่ได้ตรวจว่าตัวเลขบนกราฟถูกกรองด้วย


167. **การแจ้งเตือน LINE ช้าเพราะ "ต้องอัปภาพขึ้น imgbb ก่อนส่ง" — ไม่ใช่เพราะอุโมงค์ช้า** — 2026-08-12 เจ้าของถามว่าทำไมภาพเต็มเฟรมช้า 10 วินาที และทำไม LPR ถึงเร็วกว่า
     **สิ่งที่วัดได้จริง (ไม่ใช่เดา):** ดึงภาพ 190KB จาก edge ข้ามอุโมงค์ Cloudflare = **255 มิลลิวินาที** ·
     อัปภาพเดียวกันขึ้น imgbb = **7–10 วินาที** · crop 20KB = 1.4 วินาที ·
     จาก `alert_logs` จริง 14 วัน แจ้งเตือน LPR เฉลี่ย **20–27 วินาที สูงสุด 51 วินาที**
     **สมมติฐานที่ผิดทั้งคู่:** (1) คิดว่าอุโมงค์ช้า — ไม่ใช่เลย (2) คิดว่า LPR เร็วกว่า —
     ความจริง LPR **ช้ากว่า** face 15-20 เท่า ใช้ uploader ตัวเดียวกันแต่ภาพใหญ่กว่า
     ที่รู้สึกว่าเร็วเพราะมันเป็น fire-and-forget ไม่มีใครรอ ไม่ใช่เพราะมันเร็ว
     **ย่อภาพช่วยไม่พอ:** 190KB→7.1 วิ · 94KB→7.1 วิ · 56KB→4.1 วิ · และ 160KB เคยช้ากว่า 190KB
     ในการวัดครั้งเดียวกัน — imgbb แปรปรวนเอง ไม่ได้ขึ้นกับขนาดล้วนๆ
     **Fix:** เลิกอัปโหลด · ส่ง URL ของโดเมนเราเองที่เซ็น HMAC + มีวันหมดอายุ ให้ LINE มาดึงเอง
     (`src/helpers/signedImage.js`, `/pub/img/*`, `/pub/ref/*`) → face 3 ภาพเหลือ **13 มิลลิวินาที** · LPR **0**
     **Lesson:** เวลาบอกว่า "อะไรช้า" ให้แยกวัดทีละขาเสมอ — ครั้งนี้ทั้งผมและเจ้าของเดาผิดคนละทาง
     และคำถาม "ทำไม X เร็วกว่า Y" ต้องเช็คก่อนว่า X เร็วกว่าจริงไหม ข้อมูลอยู่ใน `alert_logs.duration_ms` มาตลอด

168. **ตัวตรวจไฟล์รูปห้าม sniff ข้อความก่อน magic bytes — XMP ในไฟล์ raster จริงมีคำว่า `xmlns` และ `svg` เป็นปกติ** — 2026-08-13 พบตอนรวมด่านอัปโหลด 3 จุดเข้า `helpers/imageMagic.js`
     `assertImageBuffer()` เดิมดัก SVG **ก่อน** เช็ค magic bytes โดยอ่านข้อความ 1KB แรก
     แล้วมองหา `<svg` หรือ (`xmlns` และ `svg`) ⇒ JPEG/PNG **ของจริง** ที่มี XMP packet
     ถูกปฏิเสธเป็น SVG · ไฟล์ที่ export จาก Illustrator/Photoshop ฝัง `xmlns:x="adobe:ns:meta/"`
     ไว้หลัง SOI และถ้าต้นฉบับชื่อ `logo.svg` ชื่อนั้นก็ติดมาใน metadata ด้วย
     **Fix:** ให้ magic bytes **ตัดสินก่อน** แล้วค่อย sniff ข้อความเฉพาะตอนไม่ผ่านทุก format
     (ไฟล์ที่มี magic ของ PNG/JPEG/WebP/GIF เป็น SVG ไม่ได้อยู่แล้ว) — การรับประกันกลายเป็น
     เชิงโครงสร้างแทนการเดา และ SVG ที่ `<svg` หลุดนอก 1KB ก็ยังถูกปฏิเสธอยู่ดี
     **Lesson:** รูป production จริง 801 ไฟล์ผ่านหมด **ไม่ได้แปลว่าไม่มีบั๊ก** — คลังของเรา
     เป็นภาพจากกล้องล้วน ไม่มี XMP สักไฟล์ · ต้องสร้าง fixture ของเคสที่ *ยังไม่มี* ในข้อมูลจริง
     โดยเฉพาะเมื่อขยายด่านไปครอบ endpoint ที่รับไฟล์จากคน (`/api/branding/logo`)

169. **`_blT('key', 'fallback')` — fallback ไม่มีวันถูกใช้ถ้าคีย์นั้นมีอยู่จริง ⇒ หยิบคีย์ผิดความหมายมาใช้ซ้ำ = ป้ายผิดโดยที่โค้ดอ่านแล้วดูถูกทุกบรรทัด** — 2026-08-13 เจอ 2 จุดในรอบเดียว (CH2)
     `plate_numbers: () => _blT('bl.noPlate', 'ทะเบียน')` → แสดงจริงว่า **"ไม่มีทะเบียน"**
     `blacklisttype: () => _blT('bl.source', 'ชนิดบัญชี')` → แสดงจริงว่า **"แหล่งข้อมูล"**
     fallback ที่เขียนไว้ถูกทั้งคู่ · review โค้ดผ่านฉลุยเพราะตาไปอ่าน fallback ไม่ได้ไปเปิดพจนานุกรม
     **Fix:** สร้างคีย์ใหม่เมื่อความหมายไม่ตรงเป๊ะ (`bl.plateNumber` / `bl.listKind`) ห้ามยืมคีย์ใกล้เคียง
     **Lesson:** จับได้ด้วยการ render จริงแล้วอ่าน `textContent` ออกมาเทียบ ไม่ใช่ด้วยการอ่านโค้ด ·
     เป็นพี่น้องกับกับดัก `data-action` ที่ไม่ได้ลงทะเบียนใน `ACTION_MAP` — ทั้งคู่ "โค้ดถูก ผลผิด"

170. **`updated_by = 'system:vanish'` กลายเป็นค่าที่แบกความหมาย 3 อย่างพร้อมกัน — แก้ที่เดียวพังสามที่** — 2026-08-13 ตอนทำ BS2
     ค่านี้ทำหน้าที่ (1) audit ว่าใครคัดออก (2) **เงื่อนไขล้างการยกเว้นอัตโนมัติ** ตอนต้นทางส่งแถวกลับมา
     ใน `blacklistImport.upsertRecord` (3) ตัวกรอง "ผู้ทำ" ในหน้าถังขยะ
     ⚠️ เงื่อนไขในข้อ (2) เช็คว่าคอลัมน์แก้ไขใน `blacklist.overrides` **เป็น NULL ครบทั้ง 11 ช่อง**
     ถ้าวันหนึ่งมีใครเพิ่มคอลัมน์ที่ 12 แล้วลืมเติมใน `DELETE` ตัวนั้น การยกเว้นที่ระบบตั้งเองจะ
     **ไม่ถูกล้างอีกเลย** = ป้ายที่ต้นทางเอากลับมาแล้วจะไม่กลับเข้าเฝ้าระวัง และไม่มี error ให้เห็น
     **Lesson:** เพิ่มคอลัมน์ใน `blacklist.overrides` เมื่อไหร่ ต้องไล่ดู `upsertRecord` ทุกครั้ง

171. **"เทสต์ผ่านไปแล้ว" หมดอายุทันทีที่แตะโค้ดเดิมซ้ำ — แก้ SQL ของ endpoint ไหน ต้องยิง endpoint นั้นใหม่เสมอ** — 2026-08-13 เจ้าของกดหน้า Blacklist แล้วได้ 500 ทั้งหน้า
     ลำดับที่ทำให้หลุด: (1) เพิ่มฟิลด์ `vanished_at` เข้า `GET /api/blacklist/master/:id` →
     **ทดสอบผ่าน** (2) กลับมาเพิ่ม `ch.n AS change_count` เข้า SELECT **ตัวเดียวกัน** แต่บรรทัด
     ก่อนหน้าไม่มีคอมมา (3) ทดสอบแต่ endpoint **ใหม่** (`record/:id/changes`) เพราะคิดว่า
     `master/:id` "ผ่านไปแล้ว" ⇒ `syntax error at or near "ch"` · กดเปิดระเบียนใดก็ 500 ทั้งหมด
     **ทำไม `node --check` ไม่ช่วย:** SQL อยู่ใน template literal — ไวยากรณ์ JS ถูกต้องสมบูรณ์
     ตัวที่พังคือ Postgres parser ซึ่งเห็นก็ต่อเมื่อ **มีคนเรียก endpoint จริง**
     **Lesson:** เกณฑ์คือ "แตะไฟล์ไหน ยิงทุก endpoint ในไฟล์นั้นซ้ำ" ไม่ใช่ "ยิงเฉพาะของใหม่" ·
     เวลาแก้บั๊กแบบนี้ ให้กวาดทั้งหน้าเลย (รอบนี้กวาด 21 endpoint) เพราะการเจอตัวที่พังแล้วหยุด
     คือวิธีเดียวกับที่ทำให้บั๊กนี้เกิดตั้งแต่แรก · พี่น้องกับ #169 — ทั้งคู่ "โค้ดถูก ผลผิด"

172. **เพิ่มคอลัมน์ใหม่แล้วทดสอบแค่ "เขียนลง DB ได้" = ฟีเจอร์ยังพังอยู่ · ต้อง grep หา *ทุกทางอ่าน* ไม่ใช่แค่ทางเขียน** — 2026-08-13 เจ้าของอัปรูปและพิมพ์รายละเอียดรถแล้วไม่ขึ้นบนจอสักช่อง
     P4 เพิ่มคอลัมน์ override 7 ช่อง (`brand`/`vehicle_type`/`vehicle_color`/`plate_type`/
     `case_kind`/`province`/`photo_path`) พร้อมฟอร์มและ endpoint ครบ · ตรวจแล้วว่าค่าลง
     `blacklist.overrides` จริง จึงถือว่าเสร็จ — **แต่ไม่มีทางอ่านสักทางที่ถูกแก้ให้ดูค่าใหม่**
     ```
     MAX(r.raw_json->>'carbrand')   ← การ์ดในรายการ   ) อ่าน source_records ตรง ๆ
     const rj = rec.raw_json         ← หน้ารายละเอียด   ) ไม่เคยแตะ overrides เลย
     MAX(r.photo_path)               ← รูปบนการ์ด
     ```
     ระเบียนที่พิมพ์เองไม่มีค่าต้นทาง ⇒ ทุกช่องเป็น `null` ตลอด แก้กี่รอบก็ไม่มีทางเห็น ·
     โผล่เป็นบั๊กคนละอาการ **3 รอบติด** (500 → รูปไม่ขึ้น → ค่าอื่นไม่ขึ้น) ทั้งที่รากเดียวกัน
     **ที่รอดมาได้เพราะบังเอิญ:** `name`/`plate_numbers`/`case_note` มี `res_name`/`res_plates`/
     `res_note` รองรับอยู่ก่อน P4 แล้ว — 3 ช่องนี้เลยทำงานถูก และทำให้เข้าใจผิดว่าทั้งฟอร์มใช้ได้
     **Fix:** ทุกทางอ่านใช้ `COALESCE(NULLIF(o.<col>,''), <ค่าต้นทาง>)` · `NULLIF` จำเป็นเพราะ
     กติกา override เก็บ `''` แปลว่า "ล้างกลับไปใช้ค่าต้นทาง" ไม่ดักแล้วสตริงว่างจะชนะค่าต้นทาง ·
     หน้ารายละเอียดคืน `eff` (ผสมแล้ว) แยกจาก `raw_json` (ดิบ) เพื่อไม่ให้ใครเข้าใจผิดว่าต้นทางส่งอะไรมา
     **Lesson:** เพิ่มคอลัมน์ใหม่เมื่อไหร่ ให้ `grep` ชื่อคอลัมน์เดิมที่มันจะไปแทนที่ทั้ง repo
     แล้วไล่ดูทีละจุดว่าจุดไหนต้องเปลี่ยน · พี่น้องกับ #171 — คู่นี้คือ "ทดสอบเฉพาะทางที่เพิ่งเขียน"
     ทั้งคู่ ต่างกันแค่ #171 เป็นทางเดียวกันแต่คนละ endpoint ส่วน #172 เป็นคนละทิศ (เขียน vs อ่าน)

173. **⭐ คลาสบั๊กที่โผล่ 5 ครั้งใน 2 วัน: "ระบบทำอย่างอื่นแทนโดยไม่บอก" — ทุกครั้งเจ้าของเป็นคนเจอ ไม่ใช่เทสต์** — 2026-08-13/14
     ห้าตัวนี้อยู่คนละไฟล์ คนละฟีเจอร์ แต่เป็นความผิดพลาดเชิงออกแบบแบบเดียวกัน:
     ```
     ตัวกรองเวลาถูกทิ้ง   → wins ว่าง → fallback คืน "ทั้ง 24 ชม." (routes/acuseek.js)
     คำเตือนไม่ถึงจอ      → server ส่ง warnings มา แต่ UI เก็บไว้เฉย ๆ ไม่ render
     "หมวกกันน็อค"        → regex ไม่ตรง → ตกไปกฎ /หมวก/ กลายเป็น "wearing a hat"
     ค่าที่แก้ไม่ขึ้นจอ    → ฝั่งอ่านดึง raw_json ของต้นทาง ไม่เคยดู overrides (#172)
     ปุ่มกู้คืนโกหก       → bridge ดู 2 เงื่อนไข แต่ปุ่มแก้ได้เงื่อนไขเดียว
     ```
     **รูปแบบร่วม:** โค้ดเจอสถานการณ์ที่ตอบไม่ได้ แล้ว **เดาคำตอบที่ใกล้เคียงที่สุดให้เงียบ ๆ**
     แทนที่จะล้มเหลวออกมาให้เห็น · ทุกตัว "ทำงานได้" ในสายตาโค้ดและเทสต์ · ทุกตัวผู้ใช้
     เห็นผลลัพธ์ที่ดูสมเหตุสมผลแต่ผิด · **ไม่มีตัวไหนที่ log หรือ error จะจับได้ เพราะไม่มี error**
     **กฎที่ได้:** เจอทางตันแล้วต้องเลือกระหว่าง "เดาต่อ" กับ "หยุดแล้วบอก" → **เลือกบอกเสมอ**
     · `fallback` ที่กว้างกว่าสิ่งที่ผู้ใช้ขอ = บั๊กเสมอ ไม่ใช่ความใจดี
     · regex ที่ไม่ตรงแล้วมีกฎกว้างกว่ารออยู่ข้างล่าง = ต้องมีเทสต์ของการสะกดที่คนใช้จริง
     · เพิ่มขาเขียนแล้วต้อง grep หาขาอ่านให้ครบ (#172) · เพิ่ม field ใน API แล้วต้องเช็คว่า UI render จริง
     **วิธีจับที่ได้ผลจริง (เรียงตามที่จับได้บ่อย):** เจ้าของดูหน้าจอจริง → ยิง endpoint แล้ว
     **อ่านค่าที่ส่งไป** (ไม่ใช่แค่ status 200) → เปิดภาพ/DOM ดูด้วยตา → เทสต์ที่ตรึงเวลา/สถานะได้

174. **5 env var ที่ edge ต้องใช้จริงแต่หายจาก template/runbook ทุกที่** — 2026-08-18
     พบระหว่าง onboard ไซต์ `rmutr-v` (vss3): `SNAPSHOT_PROXY_SECRET`, `BLACKLIST_SECRET_KEY`,
     `EDGE_MQTT_BROKER`, `LPR_PUSH_HOST`, `FACE_PUSH_HOST` ไม่มีใน `edge/env.template` หรือ
     `docs/REF_edge-install.md` Step 7 เลยสักตัว — 3 ตัวแรกพังแบบเงียบ/งง (401 ทุก request จาก
     central, `hcp-face-matches` crash ตอน boot, `httphost-set` ตอบ `could not determine edge
     address`) ส่วน `FACE_PUSH_HOST` ทำให้ `/event-broker-configure` ตอบ 503 **ก่อนยิง ONVIF
     ไปกล้องด้วยซ้ำ** และ UI (`page-camera-settings.js`) โชว์ "ไม่พบ Event Broker ที่ชี้มาที่ `?`"
     — `?` มาจาก `expected_address` เป็น `null` ทำให้ operator ไล่ผิดทางไปคิดว่าเป็นปัญหา
     กล้อง/เครือข่าย/รหัสผ่าน ทั้งที่เป็น env var ที่ไม่ได้ตั้งบน edge เฉย ๆ
     **Fix:** เติมทั้ง 5 ตัวเข้า template + runbook แล้ว (2026-08-18) — ตัวไหนต้อง COPY ค่าจาก
     central เป๊ะ (ไม่ใช่สุ่มใหม่) เขียนกำกับไว้ในคอมเมนต์ · เพิ่ม boot-time warn log ถ้า
     `FACE_PUSH_HOST` ว่างใน `lpr-receiver.js`
     **ยังไม่ได้แก้ (ค้างเป็นเรื่องแยก):** `FACE_PUSH_HOST` ต้องการคนละ format ใน 2 จุดที่ใช้ —
     Hik ISAPI IP check ต้องการ IP เปล่า ("172.29.51.52") ส่วน Bosch ONVIF AddEventBroker
     ต้องการ `host:port` ("172.29.51.52:1883") · ไซต์ที่ใช้ทั้ง Bosch และ Hik face push
     พร้อมกันตั้งให้ถูกทั้งคู่ไม่ได้ — วัดจริงว่า `vss` ตั้งเป็น IP เปล่า (Bosch จะพัง) ส่วน
     `vss3` ตั้งเป็น `host:port` (Hik face-push IP check จะพัง) รอเจ้าของตัดสินใจว่าจะแยกเป็น
     2 env var หรือให้ประกอบจาก `EDGE_MQTT_BROKER` แทน
     **Lesson:** env var ที่โค้ดอ่านจริงแต่ template ไม่มี = ต้องรอให้คนตั้งเครื่องใหม่มาเจอเอง
     ทุกครั้ง — เพิ่ม var ใหม่ในโค้ดแล้วต้อง grep `process.env.` เทียบกับ template ด้วยเสมอ

175. **"ตรวจ responsive ผ่านแล้ว" ที่วัดแค่ว่าจอไม่ล้น — ปล่อยแกนกราฟที่อ่านไม่ออกขึ้น prod** — 2026-08-19
     แก้กราฟ "ภาพรวมเหตุการณ์" (หน้าสถิติ) ให้ bucket เป็น 30 นาที แล้วรายงานว่าตรวจ ≤768px
     ผ่าน โดยวัดด้วย `document.body.scrollWidth === window.innerWidth` อย่างเดียว — ผ่านจริง
     ไม่มี horizontal overflow เลย **แต่ป้ายแกน X ออกมาเป็น `00:0002:1104:2206:3308:44…`**
     คือเวลาที่ไม่ตรงหัวชั่วโมง (ห่างกัน 2h09/2h11) แล้วชิดกันจนอ่านเป็นพรืดเดียว เจ้าของ
     เป็นคนจับได้จากมือถือจริง หลังจากที่ผมรายงานว่า "ผ่าน" ไปแล้ว
     **Root cause:** ตัวแปร `granularity` ถูกใช้ 2 หน้าที่ปนกัน — เป็นทั้งขนาดถังข้อมูลและ
     ถูกส่งเป็น `time.unit` ให้ Chart.js ตรง ๆ · ถัง 30 นาที ⇒ `unit:'minute'` ⇒ Chart.js
     คำนวณ step เองให้พอดีความกว้าง ได้เลขไม่กลม · ซ้ำด้วย `autoSkipPadding` default = 3px
     ทำให้ป้ายติดกัน
     **Fix:** แยก `tickUnit` ออกจากขนาดถัง (ถังนาที+ช่วงทั้งวัน ⇒ ป้ายเกาะ**หัวชั่วโมง**) +
     `autoSkipPadding: 16` — ได้ 390px: 00:00/04:00/…/20:00 · 1400px: 00:00/02:00/…/22:00
     **Lesson (ใช้กับงาน UI ทุกชิ้น):** `scrollWidth === innerWidth` แปลว่า "ไม่ล้น" **ไม่ได้
     แปลว่า "อ่านรู้เรื่อง"** — ต้องอ่าน**ค่าที่เรนเดอร์จริง**ออกมาดู ไม่ใช่แค่วัดขนาดกล่อง
     · กราฟ Chart.js: `Chart.getChart(canvas).scales.x.ticks.map(t => t.label)`
     · ตาราง/การ์ด: ดึง `textContent` ของแถวจริงมาอ่าน · แล้วค่อยเทียบกับสิ่งที่ตั้งใจให้เป็น
     (วิธีนี้จับบั๊กนี้ได้ทันทีในรอบเดียว ส่วน screenshot อย่างเดียวก็ยังพลาดได้ถ้าไม่ซูมอ่าน)

176. **ไล่บั๊กบน edge แล้วมองไม่เห็น error เพราะ `console.warn` ไม่ได้ลง `-out.log`** — 2026-08-19
     ต่อฟีเจอร์ ONVIF metadata crop บน vss3 · log บอกว่าเข้าฟังก์ชันแล้ว จากนั้น**เงียบสนิท** —
     ไม่มีทั้งบรรทัดสำเร็จ ไม่มีทั้งบรรทัดล้มเหลว · เสียเวลาไล่ ~25 นาที ไปกับการทดสอบ
     `sharp` แยก ตรวจ md5 ของไฟล์ ตรวจ pm2 restart count ตรวจว่ามี process ซ้อนไหม
     **Root cause (2 ชั้น):**
     (ก) pm2 แยก stream — `console.log` → `<app>-out.log` แต่ `console.warn`/`console.error`
         → `<app>-error.log` · ข้อความจริง `metaTrack.boxToPixels is not a function`
         นอนอยู่ใน error log ตั้งแต่นาทีแรก แต่ผม `grep` แค่ `-out.log`
     (ข) ผมเดาชื่อไฟล์เป็น `-err.log` (ชื่อจริงคือ `-error.log`) พอ `tail` แล้วได้
         "No such file" จึงสรุปผิดว่า "ไม่มี error log" แทนที่จะ `ls` ดูชื่อจริง
     **บั๊กที่ซ่อนอยู่ข้างใต้:** `scp` หลายไฟล์ในคำสั่งเดียวไม่ได้อัปเดตครบ — vss3 ยังถือ
     `onvifMetaTrack.js` ฉบับเก่าที่ยังไม่มี `boxToPixels` ขณะที่ `edge-config-agent.js`
     เป็นฉบับใหม่แล้ว · ผมถือว่า scp สำเร็จโดยไม่ตรวจ
     **Lesson:** ไล่ log บน edge ให้ `grep -h` **ทั้ง `-out.log` และ `-error.log` เสมอ**
     (`grep -h 'tag' ~/.pm2/logs/<app>-*.log`) · และ **deploy ด้วย scp ต้องยืนยันด้วย
     `md5sum` ทั้งสองฝั่ง** ไม่ใช่ดูว่าไม่มี error แล้วเชื่อ — เงียบไม่ได้แปลว่าสำเร็จ
     · อาการ "log หยุดกลางฟังก์ชัน" ให้สงสัย stream ที่มองไม่เห็นก่อนสงสัยว่าโค้ดค้าง
177. **`startsWith()` เทียบ prefix สาธารณะ = auth bypass ด้วย path traversal** — 2026-08-24
     เจอตอนทดสอบโดเมนใหม่ `upl.dojojin.tech` ไม่ได้ตั้งใจหา · **บั๊กมีมาก่อนหน้านั้นแล้ว**
     ```
     GET /pub/img/../../index.html   → 200 · 423 KB · dashboard เต็ม ๆ ไม่ต้องล็อกอิน
     GET /index.html                 → 302 · เด้งไป login  (พฤติกรรมที่ถูก)
     ```
     **Root cause:** `isPublicAsset()` (`api-server.js`) เทียบด้วย
     `PUBLIC_PREFIXES.some(p => reqPath.startsWith(p))` กับ path **ดิบ** ·
     `/pub/img/../../index.html` ขึ้นต้นด้วย `/pub/img/` จริง จึงถูกตัดสินว่า public
     แล้ว **ข้าม auth ทั้งก้อน** · Express มา resolve `..` ทีหลังแล้วเสิร์ฟไฟล์ให้
     กระทบ prefix **ทุกตัว** ไม่ใช่แค่ `/pub/` — `/vendor/` `/branding/` `/tiles/`
     `/face-push/` โดนหมด · ยิงตรงที่ origin ไม่ผ่าน Cloudflare ก็ได้ผลเดียวกัน
     **ขอบเขต:** อ่านได้เฉพาะไฟล์ใต้ `dashboard/` (`index.html`, `dashboard.js`,
     `index.css`) · `.env` / `src/*.js` / `db/init.sql` / `/etc/passwd` ได้ 403 หมด
     ออกนอก web root ไม่ได้ · API ก็เข้าไม่ถึง — เป็นการรั่วของ frontend source
     ไม่ใช่ credential (`/i18n.js` เป็น public โดยตั้งใจอยู่แล้ว ไม่นับว่ารั่ว)
     **สิ่งที่น่าเจ็บใจ:** repo นี้เคยเจอบั๊กตัวเดียวกันและแก้ไปแล้วใน middleware
     `PARTNER_HOST` (`api-server.js`) พร้อมคอมเมนต์อธิบายว่า `startsWith('/v1/')`
     ไม่พอเพราะ `/v1/../login.html` ผ่าน — **แต่ `isPublicAsset()` ไม่เคยได้รับการแก้
     แบบเดียวกัน** บทเรียนถูกบันทึกไว้ในที่เดียว ไม่ได้ถูกนำไปใช้กับที่อื่นที่มีรูปทรงเดียวกัน
     **Fix:** ใช้กติกาเดียวกับ `PARTNER_HOST` — ไม่ sanitize แต่ปฏิเสธรูปทรง ·
     ห้ามมี `%` เลยแม้แต่ตัวเดียว (ฆ่าทุกกลเม็ด encoding ในกฎเดียว) และทุก segment
     ต้องขึ้นต้นด้วย alphanumeric (ตัด `.` `..` `..;` และ segment ว่างพร้อมกัน) ·
     ตรวจก่อนว่าไม่ตัดของจริง: `snapshot_filename` **0 จาก 26,729,370 แถว**ที่มี
     segment ขึ้นต้นด้วยตัวอื่น · `face_push_token` ทั้ง 67 ตัว URL-safe ·
     `.thumbs`/`.bboxcache` เป็น cache ฝั่งเซิร์ฟเวอร์ ไม่เคยอยู่ใน URL สาธารณะ
     **Lesson:** เช็คแค่ segment `.` กับ `..` **ไม่พอ** — `..;` ไม่ใช่ทั้งคู่และไม่มี `%`
     จึงรอดไปได้ (เทสต์จับได้ ไม่ใช่คนมองเห็น) · และเมื่อแก้บั๊กรูปทรงหนึ่งได้แล้ว
     **ให้ grep หารูปทรงเดียวกันที่อื่นทันที** อย่าปล่อยให้บทเรียนอยู่แค่จุดที่เจอ
     เทสต์กันย้อน: `test/public-asset-traversal.test.js` (ดึงฟังก์ชันจริงมารัน ไม่ใช่ grep)

178. **key ซ้ำใน object literal = พจนานุกรมทั้งก้อนหายไปเงียบ ๆ** — 2026-08-24
     เพิ่มคำแปลอังกฤษของหน้าใหม่ โดยเขียนเป็นบล็อก `en:` **ก้อนที่สอง** ใน `DICT`
     แทนที่จะเติมลงก้อนเดิม (ห่างกัน ~1,370 บรรทัด จึงไม่เห็นตอนแก้)
     ```js
     var DICT = { th: {...}, en: {...3,265 key...},  ...,  en: {...64 key...} };
     ```
     `DICT` เป็น object literal ตัวเดียว JS จึงเอาก้อนหลังทับก้อนแรก **ทั้งก้อน**
     → `DICT.en` เหลือ **64 key จาก 3,306** ภาษาอังกฤษพังทั้ง dashboard
     **ที่แย่ที่สุดคือมันเงียบสนิท:** ไม่มี error · `node --check` ผ่าน · หน้าเว็บ
     โหลดปกติ · หลุดขึ้น production ไปแล้วก่อนถูกจับได้
     **การตรวจที่ "ผ่าน" ทั้งที่ของพัง:** เทียบว่า `th` กับ `en` มี key เท่ากันไหม
     โดย **grep หา key จากตัวไฟล์** — วิธีนี้เห็นทั้งสองก้อนจึงนับได้ครบและขึ้นเขียว
     ต้อง **ประเมิน object จริง** (`vm.runInNewContext` แล้ว `Object.keys`) ถึงจะเห็น
     **Lesson:** การตรวจไฟล์ config/dictionary ที่เป็นโครงสร้างข้อมูล **ต้องรันของจริง
     แล้วดูผลลัพธ์ ไม่ใช่ grep ตัวไฟล์** — ไฟล์กับสิ่งที่ runtime เห็นเป็นคนละอย่างกัน
     และเทียบสองฝั่งกันเองอย่างเดียวไม่พอ ต้องเทียบกับ **key ที่โค้ดเรียกใช้จริง** ด้วย
     เพราะ key ที่หายไปจากทั้งสองฝั่งจะทำให้การเทียบสองฝั่ง "ผ่าน" (เกิดจริงกับ
     `fsvc.unitDays` และ `page.files` ในวันเดียวกัน)
     เทสต์กันย้อน: `test/i18n-dict-integrity.test.js`

179. **ตั้ง alias ชื่อเดียวกับคอลัมน์ของตารางที่ SELECT อยู่ → `GROUP BY` จับคอลัมน์ต้นทาง** — 2026-08-25
     เจ้าของทักจากภาพว่า "กราฟตรงนี้ดูพัง" ไม่มี error ให้เห็นเลยทั้ง SQL และ JS
     ```sql
     SELECT (DATE_TRUNC('hour', b.bucket AT TIME ZONE $3) AT TIME ZONE $3) AS bucket
       FROM event_dim_bucket b ...          -- ตารางนี้มีคอลัมน์ชื่อ bucket อยู่จริง
      GROUP BY bucket, c.id                 -- Postgres จับ b.bucket ไม่ใช่ alias
     ```
     **Root cause:** เมื่อชื่อใน `GROUP BY` กำกวม PostgreSQL **ตีความเป็น input column
     ก่อน output alias** (พฤติกรรมตามสเปก ไม่ใช่บั๊กของ Postgres) · `GROUP BY` จึงจับถัง
     30 นาทีดิบแทนชั่วโมง/วันที่ truncate แล้ว → หนึ่งชั่วโมงคืน 2 แถว หนึ่งวันคืน 48 แถว
     **หลักฐาน** รันสองแบบบนข้อมูลชุดเดียวกัน: `GROUP BY bucket` ให้ 17:00 = 12,445 กับ
     10,246 (สองแถว) · `GROUP BY bkt` (alias ที่ไม่ชนชื่อ) ให้ 17:00 = **22,691 = ผลบวก
     ของสองแถวนั้นพอดี**
     **อาการที่เห็น:** Chart.js ได้ค่า y หลายค่าที่ x เดียวกัน เส้นจึงย้อนกลับไปมา และ
     ตัวเลขที่พล็อตเป็นเพียงเศษเสี้ยวของยอดจริง · ช่วง 30 วันพล็อต **1,441 จุดแทนที่จะเป็น 31**
     **ขอบเขต:** `/api/stats/timeline-by-category` สาขา rollup เท่านั้น · สาขา non-rollup
     อ่านจาก `events` ซึ่งไม่มีคอลัมน์ชื่อนี้ (ตรวจ information_schema แล้ว = 0) จึงไม่เคยพัง
     · กระทบทั้งกราฟในรายงาน **และกราฟ "ภาพรวมเหตุการณ์" หน้าสถิติ** ซึ่งใช้ endpoint เดียวกัน
     **Fix:** เปลี่ยน alias เป็น `bkt` ทั้งสองสาขาให้ตรงกัน (pivot จะได้อ่านคีย์เดียว) ·
     รูป payload ที่ส่งออกยังเป็น `points[].bucket` เหมือนเดิม หน้าจอไม่ต้องแก้ตาม ·
     ยืนยันว่ายอดไม่หาย: ผลรวมจาก API = 1,914,769 เท่ากับผลรวมดิบจาก DB เป๊ะ
     **Lesson:** อย่าตั้ง alias ชื่อซ้ำกับคอลัมน์ของตารางใดก็ตามที่อยู่ใน FROM · กรณีนี้
     ไม่มีสัญญาณเตือนใด ๆ — คิวรีสำเร็จ กราฟวาดออก แค่ตัวเลขผิดและเส้นดูแปลก
     คนที่จับได้คือคนดูภาพ ไม่ใช่เครื่อง · เทสต์กันย้อน: `test/timeline-bucket-alias.test.js`

180. **แก้โค้ดแล้ว restart ไม่ครบ process — ของที่ส่งออกไปยังเป็นของเก่า** — 2026-08-25
     เจ้าของตั้งค่ารายงานอัตโนมัติให้ซ่อนหมวด "คนข้ามถนน" และปิดคอลัมน์ "เทียบก่อนหน้า"
     ค่าลง DB ครบถ้วน (`section_config` ถูกต้องทุกฟิลด์) แต่รายงานที่ส่งเข้า LINE
     ตอน 08:00 **ยังมีทั้งสองอย่างอยู่**
     ```
     โค้ดที่แก้             25/8 02:05
     report-worker เริ่มรัน  24/8 12:35   ← เก่ากว่าโค้ด 13 ชม.
     api-server เริ่มรัน     25/8 02:37   ← restart เฉพาะตัวนี้ทั้งวัน
     ```
     **Root cause:** ตัวที่เรนเดอร์และส่งรายงานตามตารางคือ `report-worker` ซึ่งเป็น
     **คนละ pm2 process กับ `api-server`** · Node อ่านไฟล์เข้าหน่วยความจำตอน require
     ครั้งแรก การแก้ไฟล์บนดิสก์จึงไม่มีผลกับ process ที่รันอยู่
     **ที่แย่คือไม่มีอะไรฟ้องเลย:** โค้ดถูก · `npm test` เขียว · หน้าจอ preview ถูก ·
     ยิง endpoint ตรง ๆ ก็ถูก (เพราะ api-server restart แล้ว) — ผิดเฉพาะเส้นทางที่
     ผ่าน worker ซึ่งคือเส้นทางที่ส่งของจริงถึงมือลูกค้า
     **Lesson:** `git pull` แล้ว restart แค่ตัวเดียวไม่พอ · หลัง deploy ทุกครั้งให้รัน
     **`npm run check:stale`** (`scripts/check-stale-workers.js`) ซึ่งไล่ require graph
     ของแต่ละ process แล้วเทียบ mtime กับเวลาเริ่มรัน · ตัวที่ไฟล์ที่มันโหลดใหม่กว่า
     ตัวมันเอง = ยังรันของเก่า
     **หมายเหตุ:** ผลลัพธ์อาจมีตัวที่ "เก่าแต่ไม่กระทบ" (เช่น ingest process ที่โหลด
     helper ซึ่งแก้ในส่วนที่มันไม่ได้ใช้) — สคริปต์รายงานตามจริง ไม่ตัดสินให้ คนอ่าน
     ต้องดูว่าไฟล์ที่เปลี่ยนเกี่ยวกับงานของ process นั้นไหม การ restart ตัว ingest
     มีต้นทุน (event ขาดช่วง) จึงไม่ควร restart ยกแผงโดยไม่ดู

181. **transaction เดียวเปิดค้าง ทำให้หน้าสถิติว่างเปล่าทั้งระบบ — และไม่มีเครื่องมือใดเห็นมัน** — 2026-08-27
     user `bosch` เปิดหน้า Event Statistics แล้วได้หน้าว่าง ทั้ง badge และกราฟ ·
     admin ดูปกติ · ตรวจ session / สิทธิ์ / `siteWhere` แล้วไม่ใช่ทั้งหมด (วินิจฉัยผิด
     ไป 2 รอบก่อนไปเจอของจริง)
     ```
     pg_stat_activity: pid 892927  xact_start เมื่อ 124,712 วิ ก่อน (~34 ชม.)
                                   state = idle in transaction   ← ไม่มี query รันอยู่เลย
     events: dead tuple 9.4%       autovacuum ตัวล่าสุด: ค้างไม่คืบ
     ```
     **Root cause:** transaction ที่เปิดค้างตรึง **vacuum horizon** ไว้ — autovacuum
     ลบ dead tuple ที่ใหม่กว่า transaction นั้นไม่ได้ เพราะมันอาจยังต้องมองเห็น ⇒
     `events` บวมขึ้นเรื่อย ๆ ⇒ ทุก scan ช้าลง ⇒ query ของหน้าสถิติทะลุเวลาที่หน้าเว็บ
     ยอมรอ · ผู้ใช้เห็นแค่ "หน้าว่าง" ซึ่งอยู่ห่างจากสาเหตุจริงหลายชั้น
     **ทำไมไม่มีอะไรเห็น (จุดที่ต้องจำ):**
     - `statement_timeout` **กันไม่ได้** — มันจับ *statement* เดี่ยว ๆ ตัวนี้เป็น
       *transaction* ที่ประกอบจาก statement สั้น ๆ (หรือไม่มี statement เลย)
     - monitoring ที่ดูจาก `query_start` + `state = 'active'` **เห็นเป็นศูนย์** —
       `idle in transaction` ไม่มี query รันอยู่ · ของเดิมใน `/api/health/details`
       (`db.long_running_queries`) กรองแบบนี้พอดี จึงมองไม่เห็นมาตลอด
     - autovacuum ไม่ error ไม่เตือน มันแค่ทำงานไม่สำเร็จเงียบ ๆ
     **Fix:** ปิด transaction (`pg_terminate_backend`) → transaction เก่าสุดร่วงจาก
     124,712 วิ เหลือ 11 วิ · autovacuum เดินต่อทันที · หน้ากลับมาปกติ ·
     ตัวกันซ้ำสามชั้น: (1) `longTxWatch.js` เฝ้าจาก **`xact_start`** ทุก 5 นาที
     ที่ `alert-worker` (log `[long-tx]`) + ขึ้นบนการ์ด Database ในหน้า Health
     พร้อม badge `N STUCK TX` สีเตือน — badge ตัวนี้ต้องชนะ latency เสมอ ไม่งั้น
     การ์ดขึ้นเขียว "3ms" ทั้งที่ระบบกำลังถูกกัดอยู่ ซึ่งคือสิ่งที่เกิดขึ้นจริง ·
     `long_running_queries` ของเดิมก็ไม่เคยถูกเรนเดอร์เลยจนถึงวันนั้น จึงเอาขึ้น
     คู่กันด้วย (2) migration
     181 ตั้ง `statement_timeout=15min` + `idle_in_transaction_session_timeout=5min`
     ระดับ role เป็นเพดานสำรอง (3) เติม `statement_timeout` ให้ pool ทั้ง 8 ตัวที่
     ไม่เคยมี
     **ข้อควรระวังของตัวแก้เอง:** เพดานระดับ role ตกใส่ **migration** ด้วย และ
     migration ถูกเรียกด้วย pool ของ api-server ซึ่งเพดาน 120s อยู่แล้ว ⇒ migration
     ที่แตะตารางใหญ่จะถูกฆ่ากลางคันแล้ว startup abort (STUBBORN_FACT #81) ทั้งที่ SQL
     ไม่ผิด · `migrate.js` จึง `SET LOCAL statement_timeout = 0` เฉพาะใน transaction
     ของ migration พร้อม `lock_timeout = '30s'` — ปลดเวลาทำงาน แต่ไม่ปล่อยให้รอ lock
     ตลอดไปจน boot ค้างแบบไม่มี error
     **Lesson:** ตั้งเกณฑ์เฝ้าที่ `xact_start` เสมอ ไม่ใช่ `query_start` — อย่างหลัง
     เฝ้าเฉพาะสิ่งที่ `statement_timeout` จัดการเองได้อยู่แล้ว และพลาดตัวที่ทำพังจริง ·
     เกณฑ์ต้องตั้ง **สูงกว่าเพดานทุกชั้น** (ตอนนี้ 20 นาที > role 15 นาที > pool
     ยาวสุด 600s) ไม่งั้นจะเตือนเคสที่ระบบฆ่าเองได้ จนคนเลิกอ่าน log ·
     เทสต์กันย้อน: `test/long-tx-watch.test.js`

---

182. **แก้ SQL แล้วข้อมูลไม่ถึงปลายทาง — เพราะชั้นประกอบผลลัพธ์เลือก field รายตัว** — 2026-08-29
     เกิดติดกันสองวันคนละจุด: (1) เพิ่ม `sum(n_no_seatbelt)` เข้า SQL ของ
     `helmet-series` แล้ว การ์ดเข็มขัดยังเส้นแบนศูนย์ทั้งที่ total ถูก — เพราะ
     response ไม่ได้ส่งแถวดิบ แต่ประกอบด้วย mapper ที่หยิบ field ทีละตัว (จุดเดียว
     กับที่แปลง `hr`→`hour`) ซึ่งไม่มี `no_seatbelt` (2) เพิ่ม `LEFT JOIN LATERAL r2`
     (fallback ภาพอ้างอิงใบหน้า) เข้า query ของการ์ด LINE แล้วยังได้รูปเดียว —
     เพราะ SELECT list มีแค่ `r.*` ไม่มี `r2.*` คอลัมน์จึงไม่มาแบบไม่มี error ใด ๆ
     **Root cause:** ทั้งคู่คือ pattern เดียวกัน — SQL ถูกแล้ว แต่ระหว่าง SQL กับ
     ผู้ใช้มี "ชั้นคัดกรอง field" (mapper / SELECT list / serializer) ที่ต้องเติม
     ของใหม่ด้วยมือ และมันพังแบบเงียบสนิท: ไม่มี error, ปลายทางได้ null/0 เฉย ๆ
     **Fix:** เติม field ใน mapper ของ helmet-series (hourly+daily) · เติม `r2.*`
     ใน SELECT list ของ `_faceAlertImages` — ทั้งคู่ verify ด้วย dry-run กับ
     event/วันจริงจนตัวเลขปลายทางตรงกับต้นทาง
     **Lesson:** เพิ่มคอลัมน์/JOIN ใน SQL เมื่อไหร่ ให้ไล่ "ทุกชั้นที่ splat field"
     จนถึงคนใช้ แล้ว verify ที่**ปลายทาง** (ผลรวมเส้น = ตัวเลขการ์ด) ไม่ใช่แค่รัน
     SQL ผ่าน · เคสใบหน้ามีต้นเหตุชั้นสอง: เงื่อนไข lookup ถูกคัดลอกไว้ 3 ที่แล้ว
     แตกแถวกัน (fallback เติมที่หน้าจอ 18 ส.ค. แต่การ์ด LINE ไม่ได้) — ตอนนี้รวม
     เป็น `helpers/faceRefLookup.js` ที่เดียว มี test ล็อกห้ามคัดลอกกลับ
     (`test/face-ref-single-source.test.js`)

### #183 — ด่าน "confirmed gone" ของ bridge auto-sync รู้จักเหตุถอนไม่ครบ → ป้ายเดียวบล็อกทั้งคิวถาวร (2026-08-29)
- **อาการ:** ต้นทางลบ ผธ4973 แล้ว (vanish + ลงถังขยะถูกต้อง) แต่ป้ายยังเฝ้าระวัง
  และยิง LINE ต่อ · log มีแต่ `1 plate(s) pending review` ซ้ำ ๆ ไม่บอกว่าตัวไหน
- **Root cause:** GuruSquare **แก้เลขป้าย** (2กง2651→2655) บน external_id เดิม —
  ป้ายเก่าจึงหลุดจาก desired โดยไม่มีระเบียนไหน vanish/excluded ให้
  `unconfirmedRemovals()` หาเจอ → นับเป็น "ยังไม่ยืนยัน" → ด่าน pending-review
  (ตาข่ายเหตุ 481 แถว) hold **ทั้ง diff**: การถอนที่ยืนยันแล้วก็ค้าง และ add/update
  ก็ค้างด้วย (ป้ายที่แก้แล้ว 2655 เลยไม่ถูกเฝ้าระวังไปพร้อมกัน) · ไม่มีวันคลายเอง
  เพราะแถวต้นทางยังอยู่ดี ๆ ไม่มีทาง vanish
- **Fix:** เพิ่มรูปยืนยันที่ 3 ใน `unconfirmedRemovals()` — แถวเฝ้าระวังของป้ายนั้น
  โยง master ที่ยังมีระเบียนเป็น ๆ แต่ไม่มีระเบียนไหน (รวม override) ถือป้ายนี้แล้ว
  = ต้นทางแก้ป้าย ปล่อยถอนได้ · diff ที่พังจะเสนอถอนทั้งที่ระเบียนยังถือป้าย → ไม่เข้ารูปนี้
  → ยัง hold เหมือนเดิม · และ `attemptAutoSync` skip message ต้องระบุชื่อป้ายเสมอ
- **Lesson:** ด่านที่ hold "ทั้งก้อน" ต้องแจกแจงเหตุถอนให้ครบทุกรูปที่ต้นทางทำได้จริง
  (ลบ / ยกเว้น / **แก้ค่า key**) — เหตุที่แจกแจงไม่ถึงจะกลายเป็น deadlock เงียบ
  ที่พาเหตุอื่นค้างตามไปด้วย · และ log ของ gate ต้องระบุ **ตัวที่บล็อก** ไม่ใช่แค่จำนวน

### #184 — สามกับดักของ "ชั้นที่มาทับข้อมูลทีหลัง" (2026-08-30)
รวมจากงานกราฟ/หน้า Events วันเดียวกัน คนละอาการแต่รากเดียว: **มีอะไรบางอย่าง
เขียนทับผลที่ถูกต้องหลังจากคำนวณเสร็จแล้ว**
- **live push ต้องผ่านตัวกรองชุดเดียวกับ fetch** — `evtFeedAccepts()` เคยเช็คแค่
  LPR/Face ⇒ event ใหม่ทับผลค้นหาภายในไม่ถึงนาที (~8 ev/s บนหน้าจอ 20 แถว)
  อาการที่ผู้ใช้เห็นคือ "ตัวกรองพัง" ทั้งที่ query ถูกมาตลอด
- **ทุก fetch ที่ยิงซ้ำได้ ต้องมี guard ลำดับ** — response เก่าที่มาช้ากว่าเขียนทับ
  ของใหม่ (สลับไซต์แล้วได้รายการไซต์เดิม) · ใส่ seq แล้วทิ้งผลที่ไม่ใช่ล่าสุด
  ตรวจหลัง await ทุกจุด ไม่ใช่จุดเดียว
- **ป้ายที่ JS เขียนเอง ห้ามผูก `data-i18n`** — `applyI18n` เขียนทับกลับเป็นค่า
  default ทุกครั้งที่ถูกเรียก (แบนเนอร์ช่วงเวลาหน้า Events ไม่ยอมอัปเดต)

**บทเรียนคู่กัน — guard ที่ตัดข้อมูลทิ้งต้องมีตัวเทียบยอดเสมอ:** guard ที่ใส่กัน
"ยอดรายชั่วโมงกองที่ถังแรก" ทำให้กดขยายถังแล้วเส้นหาย 99.5% เงียบ ๆ (259,725 →
1,303) เพราะไม่มีใครเทียบผลรวมเส้นกับยอดการ์ด · ต่อจาก #182 ซึ่งเป็นเรื่องเดียวกัน
คนละชั้น: mapper ที่ตกคอลัมน์ vs guard ที่ตกข้อมูล

**เครื่องมือทดสอบก็โกหกได้:** การ override `window.loadEvents` เพื่อ log ทำให้
seq guard เพี้ยนและได้ผลผิด — ตอน instrument ฟังก์ชันที่มี state ภายใน ให้ log
ในตัวฟังก์ชันจริงแล้วถอดออก ไม่ใช่ห่อจากข้างนอก

**pg `date` + JS `toISOString()` เลื่อนวัน:** driver คืน `date` เป็น JS Date ตาม
timezone ของ process แล้ว `toISOString()` แปลงกลับเป็น UTC ⇒ ทุกแถวเลื่อนถอย 1 วัน
เกือบทำให้สรุปผิดว่า RMUTR-V หยุดส่งข้อมูล ทั้งที่ปกติ · ใช้ `to_char()` ใน SQL เสมอ

<sub>End of GOTCHAS.md · Companion to CLAUDE.md · Updated 2026-08-30 (#184)</sub>

### #185 — "ดิสก์ของเครื่อง" ไม่ใช่ "ดิสก์ที่ข้อมูลลง" — ตัวเตือนกับตัวลบดูคนละใบ (2026-08-31)
`bridge.js:361` ฮาร์ดโค้ด `df -k /` ⇒ `edge_status.disk_free_gb` เป็นดิสก์ระบบเสมอ
ทุกไซต์ · hkt แขวน snapshot ไว้บน md0 (RAID1 3.6 TB) แยกจาก `/` ที่เป็น nvme 467 GB
ผลสองชั้น:
- **หน้า Storage พาดหัว 13%** (ดิสก์ระบบ) ทั้งที่ดิสก์ที่เก็บภาพอยู่ที่ **70.3%**
  บนหน้าที่มีหน้าที่ตอบว่า "จะเต็มไหม" โดยเฉพาะ
- **`checkEdgeDiskLow()` เทียบ `min_free_gb` (80 GB) กับดิสก์ระบบที่ว่าง 408 GB
  และไม่มีอะไรเขียนลงไป ⇒ เงื่อนไขพื้นที่ของไซต์นั้นตายสนิท** วันที่ดิสก์ภาพเหลือ
  10 GB ก็จะไม่มีใครได้รับแจ้งเตือน · ขณะที่ **ตัวลบบน edge ทำถูกมาตลอด**
  (`snapshot-retention.js:137` ใช้ `readMount(snapshotDir)`) — สองฝั่งจึงเงียบ ๆ
  ไม่ตรงกันโดยไม่มีอะไรฟ้อง

**รากของบั๊ก ไม่ใช่แค่ค่าผิด:** comment เดิมใน `checkEdgeDiskLow` เขียนว่า *"ใช้ค่า
เดียวกับที่ตัวลบใช้ตัดสิน จะได้ไม่เตือนคนละมาตรฐานกับที่มันทำงาน"* ซึ่งเป็น **เท็จพอดี
ในเคสเดียวที่มันสำคัญ** · เจตนาถูกเขียนไว้แล้ว แต่โค้ดไม่ได้ทำตาม และไม่มีใครจับได้
เพราะไซต์ 4 ใน 5 ใช้ดิสก์เดียว ทั้งสองทางจึงให้คำตอบเดียวกันโดยบังเอิญ

**วิธีแก้:** `storageHealth.snapshotMount()` / `systemMount()` เป็นตัวเลือก mount
**ตัวเดียว** ให้ทั้งหน้าจอและตัวเตือนใช้ร่วมกับที่ตัวลบใช้ · เชื่อ `role` ที่
`sampleStorage()` ติดป้ายไว้ ห้ามเดาจากชื่อ path · คืน `null` เมื่อไม่มี `mounts`
เพื่อให้ผู้เรียกแยก "ไม่รู้" ออกจาก "ว่าง 0 GB" ได้

**บทเรียนกว้างกว่า:** ทุกเกณฑ์ที่พูดถึง "พื้นที่" ต้องระบุให้ชัดว่าพื้นที่ **ของ path ไหน**
ค่าที่ได้จาก `/` เป็นค่าที่ถูกเสมอในเชิงเทคนิค และผิดเสมอในเชิงความหมาย ทันทีที่มี
เครื่องไหนสักเครื่องแยกดิสก์ · ที่อันตรายคือมันไม่พังตอนแยกดิสก์ แต่พังตอนดิสก์นั้นใกล้เต็ม
ซึ่งเป็นนาทีที่ต้องการการเตือนมากที่สุด

### #186 — Dahua ITC ไม่มีทิศเข้า-ออกให้ใช้ ทุกคีย์ที่ดูเหมือนจะใช่ ล้วนไม่ใช่ (2026-09-01)
ยืนยันจากการดัก `eventManager.cgi?action=attach` ตรงจากกล้อง ITC431-RW1F-IRL8
(fw 5.000.0000000.1.R build:2025-03-12 @rmutr-v · 16 event TrafficJunction / 98KB
มีป้ายจริงครบ) โดย session ฝั่ง edge — ไม่ใช่การเดาจาก spec:
- **`VehicleDirection` ไม่ปรากฏใน payload เลย** (grep ทั้งก้อน = 0 hit) — โค้ด
  mapping Head/Tail→in/out ใน `dahua-protocol.js` จึงให้ null เงียบ ๆ 100% บน
  ตระกูล ITC · ตรงกับข้อมูลเก็บจริง (DAHUA-ANPR-CAM01: null 6,290/6,290 ใน 24 ชม.)
- **`data.Direction` เป็น array ของทิศเลี้ยวที่แยก** (`["Straight"]`) ไม่ใช่ string
  และไม่ใช่เข้า-ออก · `dahua-cgi.js` มี `scalarDirection()` normalize ก่อนเก็บแล้ว
- **`directionRun` = เลขเลน** (จับคู่ `Lane` เป๊ะ 16/16) ไม่ใช่เวกเตอร์การเคลื่อนที่
- **derive เองไม่ได้**: snapshot จุดเดียวต่อคัน (`Speed:0`, `Center` เดียว,
  `CountInGroup:1`) ไม่มี trajectory — ต่างจาก Bosch BH5100i ไซต์เดียวกันที่ให้
  ทิศ + ความเร็ว 19 จุดต่อ event

**บทเรียน:** ฟีเจอร์นับเข้า-ออกบนกล้อง Dahua ต้องใช้ `cameras.lpr_direction`
ที่ตั้งมือรายกล้อง (RF5) หรือกล้อง Bosch เท่านั้น — **ห้าม**สร้างบนคีย์ direction
ของ Dahua ไม่ว่าหน้าตามันจะน่าเชื่อแค่ไหน · และฟิลด์ที่ "ตายเงียบ" (null ตลอด
โดยไม่มี log) ตรวจจับได้ทางเดียวคือเทียบ payload จริงกับข้อมูลเก็บจริง

### #187 — `COUNT(*) OVER ()` บน `events` โดยไม่มีขอบเวลา = สแกนทั้งตาราง แม้จะ `LIMIT 50` (2026-09-05)
พบตอนไล่ "ทำไมหลายหน้าโหลดช้า": `GET /api/cameras/image-quality-log` ตาย
statement timeout 120 s ทุกครั้ง (log ฝั่ง api-server `canceling statement due to
statement timeout`) ทั้งที่ขอแค่ 50 แถวล่าสุด · `GET /api/cameras/status-current`
44–66 s · `GET /api/lpr/no-read` เปิดแท็บโดยไม่ตั้งวัน = ไม่จบใน 150 s
- **`COUNT(*) OVER ()` เพื่อเอา total ไปใส่ `X-Total-Count`** บังคับให้ planner
  อ่านทุกแถวที่ตรงเงื่อนไขก่อนจะตัด LIMIT ได้ → ขอบเขตของ query = ทั้งตาราง
  (38M แถว / 25 partition) ไม่ใช่ 50 แถว · เช่นเดียวกับ `MAX(event_time) GROUP BY
  camera_id` และ `LEFT JOIN license_plates … IS NULL` ที่ไม่มีขอบเวลา
- ที่ `events` ไม่มี index คู่ (event_type, event_time) ทำให้ `LIKE 'ImageToo%'`
  4 แบบ + `ORDER BY event_time DESC` เดิน index เวลาถอยหลังกรองทีละแถว: วัดจริง
  หน้าต่าง 30 วัน 5.6 s แม้ไม่มี window count · แต่ **equality** ต่อ event_type
  (`= 'ImageTooBlurry/AnalyticsService/&1'`) ใช้ index event_type ได้ = 26 ms
- แก้: (1) total อ่านจาก `event_dim_bucket` (rollup 30 นาที, migration 163)
  (2) หน้ารายการ = UNION ALL ทีละ event_type แบบ equality + ขอบ 30 วัน
  (3) status-current ใช้ `LEFT JOIN LATERAL … ORDER BY event_time DESC LIMIT 1`
  ต่อกล้อง (index camera_id,event_time) 66 s → 0.07 s (4) no-read มัดขอบ
  `lp.detected_at` ใน `NOT EXISTS` ให้ planner hash-anti-join ผ่าน
  `idx_plates_detected_at` 12.8 s → 0.55 s (24 ชม.) · endpoint ที่ต้องการแค่
  "ค่าที่เคยเห็น" (facets / alert-rules-suggestions / rule-discovery) ย้ายไปอ่าน
  `event_dim_bucket` ทั้งก้อน >30 s → <1 s

**บทเรียน:** query ใด ๆ บน `events` ต้องมี **ขอบเวลาเสมอ** และห้ามใช้
`COUNT(*) OVER ()` / `MAX() GROUP BY` / anti-join ที่ไม่มีขอบ · ถ้าต้องการ
"ค่าที่เคยเห็น" หรือ "ยอดรวมต่อกล้อง/ชนิด" ให้ถาม `event_dim_bucket` ก่อน
(ข้อจำกัด: ค้าง ≤ 5 นาที · bucket 30 นาที · event ที่มาช้ากว่า 3 ชม. ไม่ถูกนับ
ย้อนหลัง — พบจริง total 36 vs แถวจริง 38) · ปริมาณ 850k แถว/วัน ทำให้ตัวเลข
"วัดแล้ว 4 s" ในคอมเมนต์เก่ากลายเป็น 14 s ในสามเดือน ต้องวัดซ้ำเมื่อ volume โต

### #188 — `SUM(x) FILTER (…)` คืน NULL ไม่ใช่ 0 — ย้ายจาก `COUNT(*) FILTER` แล้ว shape พัง (2026-09-05)
ตอนย้าย `image_quality` / `automation_triggers` ใน `/api/health/details` จาก
`COUNT(*) FILTER (WHERE …)` บน `events` ไปเป็น `SUM(n) FILTER (WHERE …)` บน
`event_dim_bucket`: กล้องที่มีแต่ `scene_change` ได้ `too_bright = NULL` →
`parseInt(null)` = `NaN` → JSON ส่ง `null` แทน `0` ทั้งที่ shape เดิมเป็น
integer เสมอ (subagent จับได้จาก smoke test เทียบ response ก่อน/หลัง ไม่ใช่จาก
`npm test` ซึ่งไม่ครอบ route พวกนี้เลย)
- `COUNT(*) FILTER` ที่ไม่มีแถวตรง = **0** · `SUM() FILTER` ที่ไม่มีแถวตรง =
  **NULL** — semantics ต่างกันตาม SQL standard ไม่ใช่บั๊กของ Postgres

**บทเรียน:** ทุกครั้งที่แทน `COUNT(*) FILTER` ด้วย `SUM(n) FILTER` ต้องห่อ
`COALESCE(…, 0)` และเทียบ JSON ก่อน/หลังด้วยข้อมูลจริง (มีเคส "ไม่มีแถวตรง"
อย่างน้อยหนึ่งเคส) เพราะ unit test ของ repo ไม่แตะ route ที่คุย DB

### #189 — WS `broadcast()` มี `ws.send` สองจุด และ subscribe/lite ต้องคุมทั้ง envelope กับ handler ปลายทาง (2026-09-05)
ตอนลด firehose ของ WebSocket (ทุกเบราว์เซอร์รับทุก event 11–15 msg/s ≈ 100–137 MB/ชม./แท็บ
ทั้งที่หน้าส่วนใหญ่ใช้แค่ badge/toast) ด้วย topic subscription (`{"type":"subscribe",
"topics":["lpr","face"]}`) + payload แบบ **lite** (~330 B แทน 2.2–2.7 KB) พบกับดัก 3 ชั้น
ที่ spec เขียนตรง ๆ แล้วจะยังพัง:
- **`broadcast()` ใน `src/api-server.js` ส่งจริง 2 จุด** — client ที่ไม่จำกัด Site
  (`ws._allowedSites == null`) กับ client ที่จำกัด Site (`mediaScope.cameraInScope`)
  แพตช์แค่จุดแรก = viewer ที่ผูก Site ยังโดน firehose เต็มเหมือนเดิมเงียบ ๆ
- **ธง `lite` อยู่ที่ envelope** (`{type, lite:true, event}`) แต่ handler ปลายทางทุกตัว
  (`evtFeedAccepts` / `_lprLiveRead` / `_handleMapLprCard` / `faceLivePush`) รับแค่
  `d.event` → guard `ev.lite` ไม่มีวันยิง ต้อง normalize ที่ทางเข้า `ws.onmessage`
  หนึ่งบรรทัด (`if (d.lite && d.event) d.event.lite = true`)
- **`.page.active` มีคนเขียน 2 ตัว** (`showPage()` และ `_showRestricted()` สำหรับ
  หน้าที่ไม่มีสิทธิ์) hook `wsSubscribe()` แค่ท้าย `showPage()` = ผู้ใช้ที่ออกจาก LPR
  ไปหน้าที่ถูกจำกัด ค้าง subscribe เต็มต่อไป
- ผลจริง (เบราว์เซอร์จริง 10 วินาที): Summary 219 → 32 KB · Cameras 212 → 33 KB ·
  หน้า LPR ยังได้เต็ม 182 KB ตามต้องการ · **แท็บที่เปิดค้างด้วย JS เก่าจะได้ lite
  จนกว่าจะ reload** เพราะ server default = ไม่ subscribe

**บทเรียน:** ก่อนแตะ `broadcast()` ให้ `grep -n "ws.send"` ใน `src/api-server.js`
แล้วแก้ทุกจุด · ธง/metadata ที่ใส่ที่ envelope ต้องถูกพับลง object ที่ handler
ใช้จริงตั้งแต่ทางเข้า · ทุกอย่างที่ผูกกับ "หน้าไหน active" ต้อง hook ทุกตัวที่เขียน
`.page.active` (grep `classList.add('active')` บน `.page`) ไม่ใช่แค่ `showPage()`

### #190 — cache key ที่สร้างจาก `allowedSites.join(',')` ทิ้ง camera restriction → ผู้ใช้ site เดียวกันแชร์ผลข้ามสิทธิ์ (2026-09-06)
พบโดย Codex audit VMOD-20260906 (VMOD-00) และยืนยันกับข้อมูลจริง: `makeScope()`
(decision #253) คืน array ของ site id ที่มี property `cameras` แบบ **non-enumerable**
`siteWhere()` ใช้ทั้งสองแกนตอนประกอบ SQL แต่ cache 4 จุด (`lpr/stats`,
`appearances/stats`, `events/facets`, `stats/executive-summary`) สร้าง key ด้วย
`allowedSites.join(',')` / `[...allowedSites].sort().join(',')` ซึ่งเห็นแค่ site
- ของจริง: site 18 มีบัญชี 84 กล้อง กับบัญชี 4 กล้อง → key เดียวกัน `"18"` = คนที่ถูก
  จำกัด 4 กล้องได้สถิติของ 84 กล้อง (หรือกลับกัน แล้วแต่ใครยิงก่อนใน TTL) · site 20
  มี 4 บัญชี 4 ชุดกล้อง ชนกันหมด
- audit ด้วย admin / `X-Internal-Token` **มองไม่เห็นบั๊กคลาสนี้** เพราะ scope = null
  ต้องเทียบด้วยสองบัญชี site เดียวกันแต่กล้องต่างกัน (ทำเป็นเทสต์ระดับ key ไว้แล้วใน
  `test/scope-cache-key.test.js`)
- กับดักซ้อน: `_warmLprStats` prewarm ด้วย key ที่ hardcode รูปของ admin (`${period}||||`)
  ถ้าแก้แต่ route ตัว warm จะเขียน key ที่ไม่มีใครอ่าน = month query 20 นาที/รอบ เสียเปล่า

**บทเรียน:** key ของ cache ที่ผูกกับสิทธิ์ต้องมาจาก `auth.scopeCacheKey(allowedSites)`
เท่านั้น (รูป `'all'` | `'<sites>|<cameras|*>'`) ห้ามประกอบเอง · ทุก cache ที่มี
warmer ต้องใช้ตัวสร้าง key เดียวกับ route · และเมื่อเพิ่มแกนสิทธิ์ใหม่ (#253) ต้อง
`grep -rn "allowedSites" src | grep -i "cache\|key\|join("` ไล่ทุก key ในวันเดียวกัน

### #191 — `CREATE INDEX CONCURRENTLY` ค้างที่ "waiting for old snapshots" เพราะ backup `pg_dump` ตอน 03:04 ถือ snapshot ทั้งก้อน (2026-09-06)
สร้าง partial index `idx_events_anpr_noread_time` (migration 199) บน `events_y2026m08` 65 GB
ด้วยสคริปต์ 3 ขั้นตามแบบ #167: สแกนเสร็จ 100% ใน ~10 นาที แต่ `pg_stat_progress_create_index`
ค้างที่ phase `waiting for old snapshots` อีก ~25 นาที · ตัวถือ snapshot คือ
`vigil-backup.service` (`pg_dump -Fc` เริ่ม 03:04 ทุกคืน ใช้เวลา 45–60 นาที กับ DB ~100 GB)
ซึ่งเปิด transaction เดียวตลอดการ dump — CONCURRENTLY ต้องรอทุก transaction ที่เก่ากว่า
snapshot ของมันจบก่อนจึงจะ mark valid ได้ (พฤติกรรมปกติของ Postgres ไม่ใช่บั๊ก)
- ingest ไม่สะดุดตลอดช่วง (150–240 แถว/นาที เท่าก่อนเริ่ม) — รอได้ ไม่ต้อง cancel
- รวมทั้งชุด 21 partition = 2,302 วินาที ได้ดัชนี 30 MB · เทียบ #167 ที่ 59.8 วินาที
  เพราะตัวนี้ต้อง detoast `raw_json` ทุกแถวเพื่อประเมิน predicate

**บทเรียน:** งาน CONCURRENTLY / VACUUM FULL / งานที่รอ snapshot บน central ให้เริ่มหลัง
backup จบ (~04:05) หรือก่อน 02:00 · ก่อนเริ่มเช็ค `select pid, application_name,
now()-xact_start from pg_stat_activity where xact_start is not null` ว่าไม่มี `pg_dump`
ค้าง · และ predicate ที่แตะ `raw_json` ทำให้ build แพงกว่า predicate บนคอลัมน์ธรรมดา
หลายสิบเท่า — ประเมินเวลาจากขนาด partition ไม่ใช่จากขนาดดัชนีที่จะได้

### #192 — cache key จาก `JSON.stringify(siteWhere().args)` ชนกันสามกรณี: admin, scope ว่าง, site+กล้องว่าง ให้ `[]` เหมือนกัน (2026-09-07)
พบตอน refactor cache เข้า `helpers/ttlCache` (decision #270) ที่ `/api/lpr/brands`:
`siteWhere(null)` → `args: []` (ไม่กรอง) · `siteWhere([])` → `args: []` + `AND FALSE` ·
`siteWhere(sites, cameras=[])` → `args: []` + `AND FALSE`. SQL คนละอย่างแต่ key เดียวกัน
→ ผู้ใช้ที่ควรเห็น 0 ยี่ห้อ ได้รายการเต็มของ admin ถ้า admin อุ่นแคชไว้ก่อน (ใน TTL 30 นาที).
รั่วแค่ชื่อยี่ห้อ ไม่ใช่ event แต่เป็นคลาสเดียวกับ #190.
- แก้ด้วย `wrap(key, loader, { scope })` → key กลายเป็น `[]|all` / `[]|none|*` / `[]|1,2|none`

**บทเรียน:** args ของ SQL ไม่ใช่ตัวแทนของ scope — สองสิทธิ์ต่างกันสร้าง args เหมือนกันได้
เมื่อฝั่งหนึ่งเป็น "ไม่กรอง" อีกฝั่งเป็น "กรองจนไม่เหลือ" (`AND FALSE` ไม่มี placeholder).
key ต้องมี `scopeCacheKey` เสมอ ซึ่งตอนนี้ helper ต่อให้เองเมื่อส่ง `scope` เข้าไป

### #193 — pid-file lock ชี้ไป "thread id" หลัง reboot → service ไม่ยอมสตาร์ตถาวร (2026-09-07)
`lpr-receiver` ที่ vss ตาย 5 ชม. 40 นาที (10:24 → 16:03) พยายามสตาร์ตซ้ำ 451 ครั้ง
ทุก 3 วินาที โดยบอกว่า `another instance is already running (pid 1042)` ทั้งที่
`ps -p 1042` ไม่เห็นอะไรเลย และพอร์ต 3003 ว่าง
- ต้นเหตุ: `src/.run/lpr-receiver.pid` ค้างจาก 2026-09-02 (เลข 1042) · เครื่อง reboot
  15:39 · หลัง reboot เลข 1042 ถูก **เธรด libuv ของโปรเซสอื่น** เอาไปใช้
  (`cat /proc/1042/comm` = `libuv-worker`, `Tgid` = 993 = hikvision ingester)
- `process.kill(pid, 0)` ตอบว่า "ยังอยู่" สำหรับ **tid** ด้วย ไม่ใช่แค่ pid
  ⇒ guard เดิมเข้าใจว่ามี instance อื่นอยู่จริง แล้วออกทันที ทุกครั้ง ตลอดไป
- อาการหลอก: `ps -p <tid>` ไม่แสดงอะไร (ต้อง `ps -T` หรือดู `/proc/<tid>/status`)
  จึงดูเหมือน "pid ผี" · pm2 ขึ้น `waiting restart` + restart count พุ่ง ไม่ใช่ `errored`
- แก้ (2026-09-07): บน Linux `singleton.js` อ่าน `/proc/<pid>/status` แล้วบังคับ
  `Tgid === pid` (เป็นโปรเซสไม่ใช่เธรด) + `cmdline` ต้องมี path `src/` ของเราหรือ
  ชื่อ service · ไม่ผ่าน = ถือว่า stale แล้วยึด lock พร้อม log `reclaiming stale lock`
  (macOS ไม่มี /proc ยังใช้ signal probe เหมือนเดิม)

**บทเรียน:** pid ในไฟล์ lock ที่ข้าม reboot มา **เชื่อไม่ได้** — เลขถูกใช้ซ้ำ และ
`kill(pid,0)` แยกเธรดกับโปรเซสไม่ออก. ตรวจ pm2 ด้วย `status` อย่างเดียวไม่พอ
`waiting restart` + restart count โตเรื่อย ๆ = ตายจริง · เช็คเร็ว:
`ls src/.run/*.pid` แล้วเทียบ `awk '/^Tgid/' /proc/<pid>/status` กับเลขในไฟล์

### #194 — กล้องที่กำลังถูกปิดตอบ HTTP 200 พร้อม body ว่าง → ไฟล์ snapshot 0 ไบต์ที่ระบบนับว่า "มีรูป" (2026-09-08)
หน้า Events ของ `BOSCH_3100i_02` ขึ้นการ์ด `err` แทนภาพ · ไล่แล้วพบว่าไฟล์**มีอยู่จริง
บนดิสก์ของ edge แต่ขนาด 0 ไบต์** (2 จาก 12 ไฟล์ของวันนั้น ทั้งคู่เกิดเวลา 18:04 ซึ่งเป็น
นาทีเดียวกับที่กล้องหยุดส่ง event ทั้งหมด = กำลังถูกปิด/หลุด)
- `captureAndPublish` (`edge-config-agent.js`) เช็คแค่ `statusCode !== 200` แล้วเขียน
  `Buffer.concat(chunks)` ทันที · body ว่าง = ไฟล์ 0 ไบต์ แล้วยัง publish path นั้นให้
  central ผูกเข้า event ⇒ `has_snapshot = true` ทั้งที่เปิดไม่ได้
- ฝั่ง `captureHttpSnapshot` (`mqtt-subscriber.js`) มีช่องเดียวกันเป๊ะ
- **ตลกร้าย:** เส้นทาง `[edge-preview]` ในไฟล์เดียวกัน**มี** `_looksLikeJpeg()` อยู่แล้ว
  เส้นทาง event snapshot คือตัวที่ตกหล่นตัวเดียว
- แก้ 2026-09-08: ทั้งสองเส้นทางเรียก `helpers/imageMagic.assertImageBuffer()` **ก่อน**
  เขียนไฟล์ ไม่ผ่าน = ทิ้ง + log ขนาดที่ได้ · กัน body ว่าง **และ** หน้า error HTML ที่
  บางรุ่นตอบมาพร้อม 200 · `test/snapshot-write-guard.test.js` ยืนยันว่าการตรวจอยู่ก่อนการเขียน

**บทเรียน:** `statusCode === 200` ไม่ได้แปลว่าได้ภาพ · อุปกรณ์ที่กำลังจะตายตอบ 200 ว่าง ๆ ได้
ทุกจุดที่เขียนไฟล์ภาพจากอุปกรณ์ต้องตรวจ magic byte ก่อนเสมอ และเมื่อพบเส้นทางหนึ่งมีการตรวจแล้ว
ให้ไล่หาเส้นทางพี่น้องที่ทำงานเดียวกันด้วย — มันมักตกหล่นทีละเส้น

### #195 — "ถามครั้งเดียวพอ" + upsert ที่เขียน raw_json ทั้งก้อน = ลบสิ่งที่เพิ่งถามมาทิ้งในรอบถัดไป (2026-09-08)
คำอธิบายบุคคลจาก HikCentral (personInfo.remark) ถูกดึงเข้ามาครั้งแรกสำเร็จ 697 ระเบียน
(หมายจับ 203) · **15 นาทีต่อมา auto-pull รอบ 30 นาทีลบทิ้งหมดทั้ง 697 พร้อมเลขบัตร**
โดยไม่มี error สักบรรทัด — เหลือ `hcp_remark = null` ทั้งตาราง
- เพื่อไม่ยิง HCP ซ้ำ 1,895 ครั้งทุกรอบ central ส่ง `haveRemarks` ให้ edge ข้ามคนที่ถามแล้ว
- แต่ `fetchHcpFaces` **ตั้ง `remark: null` ให้ทุกแถวตั้งแต่ต้น** แถวที่ถูกข้ามจึงกลับมา
  หน้าตาเหมือน "ต้นทางไม่ได้กรอกอะไร" เป๊ะ ๆ — แยกจากกันไม่ได้จากตัว payload
- `upsertRecord` เขียน `raw_json = EXCLUDED.raw_json` (ทั้งก้อน) และ
  `id_number_enc = EXCLUDED.id_number_enc` ⇒ ข้อความ + `case_note` + เลขบัตรที่ derive
  จากข้อความนั้นหายพร้อมกัน · gate ยังเป็น true (คีย์อยู่ ค่าเป็น null) = ไม่มีใครถามซ้ำ **ถาวร**
- `photo_path` รอดเพราะเป็นช่องเดียวที่ใช้ `COALESCE(EXCLUDED..., เดิม)` อยู่ก่อนแล้ว
- แก้ 2026-09-08: ยกของเดิมมาใส่ตาม **รายชื่อที่ central สั่งข้ามเอง** ไม่ใช่ตามรูปร่าง payload
  · ข้อความที่เก็บไว้ mask เลข 13 หลักแล้ว parse กลับเป็นเลขไม่ได้ จึงส่ง `id_hash` /
  `id_number_enc` เดิมต่อตรง ๆ (ห้าม hash จาก ciphertext — master linking จะพังเงียบ)
  · `test/hcp-remark-carry-forward.test.js`

**บทเรียน:** ทุกครั้งที่เพิ่ม "ข้ามของที่มีแล้ว" เข้าไปใน sync ต้องถามต่อทันทีว่า *upsert
เขียนช่องนั้นทับด้วยอะไรเมื่อรอบนี้ไม่มีข้อมูล* — optimization ฝั่งดึง กับ semantics
ฝั่งเขียน อยู่คนละไฟล์เสมอ และตัวที่รอดคือช่องที่มีคนเคยเจ็บมาก่อนแล้วใส่ COALESCE ไว้

### #196 — LINE ปฏิเสธทั้งข้อความเมื่อ URI ในปุ่มไม่เต็มรูป และโค้ดที่ไม่ log ผลการส่งทำให้มองไม่เห็น (2026-09-08)
เจ้าของพิมพ์คำสั่งในกลุ่มแล้ว **ไม่มีอะไรกลับมา** ทั้งที่ปูมขึ้น `ok` 415 ms — เกิดสองครั้ง
ห่างกัน 2 นาที โดยไม่มี log สักบรรทัด
- ปุ่ม "ดูในระบบ" บนการ์ดใส่ลิงก์เป็น path ล้วน (`/traffic`) · LINE บังคับ URI เต็มรูป
  ⇒ ตอบ 400 แล้ว **ทิ้งทั้งข้อความ** ไม่ใช่แค่ตัดปุ่มออก
- โค้ดเรียก `replyLineMessage()` แล้ว `pushLineMessage()` แต่ **ไม่ได้ดูค่าที่คืนมาเลย**
  ⇒ บั๊กข้างบนมองไม่เห็น ทั้งที่ helper ทั้งสองตัวคืน `{success, error}` มาให้อยู่แล้ว
- แก้: ประกอบ URL เต็มจาก `DASHBOARD_PUBLIC_URL` ที่จุดเดียว (`_absLink()`) · ไม่มีโดเมน
  ตั้งไว้ = **ไม่ใส่ปุ่ม** ดีกว่าส่งแล้วโดนทิ้ง · และ log `[line-cmd] ตอบกลับไม่สำเร็จ`
  พร้อมเหตุผลของทั้ง reply และ push

**บทเรียน:** ทดสอบมาตลอดด้วย replyToken ปลอมแล้วดูแต่โครงการ์ดในหน่วยความจำ — การ์ดถูกต้อง
ทุกอย่างยกเว้นสิ่งเดียวที่ตรวจได้เฉพาะตอนส่งจริง · **ทุกจุดที่ยิงของออกไปนอกระบบ ถ้าไม่ log
ผลลัพธ์ = บั๊กที่นั่นจะมองไม่เห็นตลอดไป** และมันจะกลบบั๊กอื่นด้วย

### #197 — ตอบ webhook ของ LINE ช้าเกิน 1 วินาที = LINE ส่ง event เดิมมาซ้ำ งานจึงรันสองรอบ (2026-09-08)
การ์ดคำตอบเด้งขึ้นมา **สองใบ ตัวเลขไม่เท่ากัน** (9,853 กับ 9,866) จากการพิมพ์ครั้งเดียว
- `[slow-req] 200 2200ms POST /api/line/webhook ip=147.92.150.197` (IP ของ LINE) แล้ว
  หนึ่งนาทีต่อมามี event เดิมเข้ามาอีกครั้ง — **ตัวเลขต่างกันเพราะเป็นการดึงข้อมูลคนละรอบจริง ๆ**
  ไม่ใช่ข้อความเดียวถูกส่งซ้ำ
- ต้นเหตุ: handler `await` งานทั้งหมด (ดึงข้อมูล 2 วินาที) ก่อนตอบ 200
- แก้: ตอบ 200 ทันทีแล้วทำงานเบื้องหลัง (`void (async () => {…})()` — reply token อายุ
  60 วินาที เหลือเฟือ) + ทิ้ง event ที่ LINE ติดธง `deliveryContext.isRedelivery` มาให้
  · วัดหลังแก้ 2,200 ms → **12 ms**
- ⚠️ ตอนแยกงานไปเบื้องหลัง เกือบตัดข้อความของ **ทุกคน** ออกจากเส้นทางลงทะเบียนผู้รับ
  (คนที่ทักบอทมาขออนุมัติจะหายเงียบ) — ต้องตัดเฉพาะข้อความของผู้สั่งที่ลงทะเบียนแล้ว

**บทเรียน:** webhook ของบริการภายนอกมีเพดานเวลาที่ไม่ได้เขียนไว้ในโค้ดเรา · งานที่ยาวกว่า
หนึ่งวินาทีต้องไม่อยู่ระหว่างการรับกับการตอบ 200 · และผลของการไม่ทำแบบนั้นไม่ใช่ "ช้า"
แต่คือ **ทำงานซ้ำ** ซึ่งอันตรายกว่ามากเมื่อคำสั่งนั้นส่งของออกไปข้างนอก

### #198 — `display:flex` ที่ตั้งเอง ชนะ `[hidden]` ของเบราว์เซอร์ (2026-09-08)
ฟอร์มคำสั่งชนิด "ถามข้อมูล" ขึ้นช่อง "ส่งถึง (เลือกได้หลายราย)" ทั้งที่โค้ดตั้ง `hidden` ไว้
- `.lc-form-row { display: flex }` มี specificity สูงกว่ากฎ `[hidden] { display: none }`
  ของ user-agent stylesheet ⇒ attribute `hidden` ไม่มีผลกับ element นั้นเลย
- element พี่น้องที่ไม่ได้ตั้ง display เอง (`select.lc-in`) ซ่อนได้ปกติ — จึงเห็นครึ่ง ๆ
  แล้วเข้าใจผิดว่าโค้ดสลับไม่ครบ
- แก้: `.lc-form-row[hidden] { display: none; }`

**บทเรียน:** ทุกครั้งที่ตั้ง `display:` ให้ class ที่จะถูกซ่อนด้วย `hidden`/`el.hidden`
ต้องเขียนกฎ `[hidden]` คู่กันเสมอ · อาการจะเป็น "ซ่อนบางอัน ไม่ซ่อนบางอัน" ซึ่งชี้ไปผิดทาง

---

### #199 — ไซต์เดียวกันนับรถได้จากสองแหล่งที่ไม่เกี่ยวกันเลย เลขไม่มีทางตรงกัน (2026-09-09)
เจ้าของทักเองหลังเห็นการ์ดใน LINE: "อันนี้เป็นนับรถจากกล้อง BOSCH site RMUTR-V นะครับ ไม่ใช่จากกล้อง LPR"
- RMUTR-V มีทั้ง Bosch 5100i (นับเส้น `LineDetector/Crossed` → หมวดเหตุการณ์ id 151–159)
  และ Dahua ANPR `ITC431` (อ่านป้าย → `vtype`) · **วันเดียวกัน 8 ก.ย.: 12,273 ครั้ง กับ 7,248 คัน**
- คนละของกันตั้งแต่นิยาม: ฝั่ง Bosch นับ "การข้ามเส้น" (คันเดียวเข้าแล้วออกนับสองครั้ง)
  ฝั่ง ANPR นับ "คันที่อ่านป้ายได้" · เอามาเทียบกันตรง ๆ ไม่ได้ ไม่ใช่ฝั่งใดฝั่งหนึ่งนับผิด
- อันตรายจริงอยู่ที่คำถาม: "จำนวนรถ RMUTR-V" ตกไปที่ `lpr_count` (7,490 ป้าย)
  ส่วน "หมวดเหตุการณ์ RMUTR-V" ตกไปที่ฝั่ง Bosch (12,273) — ทั้งคู่ตอบถูกตามคำสั่งที่จับได้
  แต่ถ้าการ์ดไม่บอกที่มา คนอ่านเห็นสองเลขแล้วสรุปว่า "ระบบนับผิด"
- แก้: การ์ดที่นับรถทุกใบพิมพ์แหล่งที่มาไว้ท้ายเสมอ (`SENSOR_LPR` / `SENSOR_VCA` ใน
  `src/line-answer-sources.js`) · และ `หมวดเหตุการณ์` บังคับระบุไซต์ (migration 212)
  เพราะหมวดตั้งแยกตามไซต์คนละเรื่องกัน (rmutr-v = รถเข้าออก · vss = คนเดินเข้าห้องน้ำ)

**บทเรียน:** ก่อนเพิ่มการ์ด "จำนวน" ใบใหม่ ให้ถามก่อนว่ามีเซ็นเซอร์อื่นในไซต์เดียวกันที่ตอบ
คำถามคล้ายกันได้อีกไหม · ถ้ามี ต้องเขียนที่มาลงบนการ์ด ไม่ใช่ปล่อยให้เดาจากชื่อคำสั่ง

---

### #200 — `Number(undefined) ?? 80` = NaN · `??` ไม่จับ NaN (2026-09-09)
ต่อคำสั่งค้นหาอัจฉริยะเข้า LINE แล้วได้ **500+ รายการ** ทั้งที่หน้าเว็บคำเดียวกันได้ 236
- `routes/acuseek.js`: `const sim = Math.max(0, Math.min(100, Number(b.similarity) ?? 80))`
  · ผู้เรียกไม่ส่ง `similarity` มา ⇒ `Number(undefined)` = **NaN** และ `??` จับแค่
  null/undefined ไม่จับ NaN ⇒ `Math.min(100, NaN)` = NaN วิ่งไปถึงเครื่องค้น
- หน้าเว็บส่งค่ามาทุกครั้ง บั๊กจึงหลบอยู่ได้ตั้งแต่วันแรกจนมีผู้เรียกรายที่สอง
- อาการหลอก: ไม่ error ไม่ log อะไรเลย แค่ "เจอเยอะผิดปกติ" ซึ่งดูเหมือนคุณภาพของ AI
- แก้: `Number.isFinite(simRaw) ? simRaw : 80` · ฝั่งผู้เรียกส่ง 80 มาให้ชัดด้วย

**บทเรียน:** `??` กับค่าที่ผ่าน `Number()` มาเป็นคู่ที่ผิดเสมอ — ใช้ `Number.isFinite()`
· และเมื่อต่อผู้เรียกรายที่สองเข้า endpoint เดิม ให้เทียบผลกับผู้เรียกรายแรกด้วยคำถามเดียวกัน
เลขที่ไม่ตรงกันคือ default ที่ endpoint เติมให้เองต่างกัน ไม่ใช่เรื่องบังเอิญ

---

### #201 — พิมพ์วรรณยุกต์ผิดตัวเดียว = บอทเงียบสนิท แยกไม่ออกจาก "ระบบค้าง" (2026-09-09)
เจ้าของพิมพ์ `คันหาอัจฉริยะ Taxi สีส้ม เมื่อวานตอนเช้า` แล้วไม่มีอะไรตอบกลับเลย
- `คันหา` = ไม้หันอากาศ **U+0E31** · `ค้นหา` = ไม้โท **U+0E49** — ต่างกันหนึ่ง code point
- ตัวจับคำสั่งเทียบด้วย `includes()` ⇒ ไม่ตรงคำเรียกไหนเลย → `no_match`
- และ `suggest()` ก็ไม่เสนออะไร เพราะมันต้องมีคำซ้อนกันจริงอย่างน้อยหนึ่งคำ (กฎที่ใส่ไว้
  ตอน GOTCHAS #197 เพื่อไม่ให้บอทแทรกบทสนทนาปกติ) ⇒ **เงียบสนิทโดยตั้งใจของระบบ
  แต่จากฝั่งคนพิมพ์คือ "สั่งแล้วไม่มีอะไรเกิดขึ้น"** ซึ่งแยกไม่ออกจากระบบล่ม
- แก้: ถ้ารอบแรก (ตรงตัว) ไม่เจออะไรเลย ค่อยเทียบรอบสองโดยถอดวรรณยุกต์/สระบนล่างทิ้ง
  (`ั` `ิ-ฺ` `็-๎`) · **เฉพาะคำเรียกยาว ≥ 5 ตัวอักษร**
  เพราะคำสั้นถอดแล้วชนกันทันที ("ค้น" → "คน" ซึ่งอยู่ในทุกประโยคที่พูดถึงคน)
- สองรอบแยกกัน ห้ามรวมเป็นรอบเดียว: ถ้าปนกัน คำที่สะกดถูกกับสะกดผิดจะได้คะแนนใกล้กัน
  จนเข้าเกณฑ์ "สูสี" แล้วบอทถามกลับทั้งที่มีคำสั่งที่สะกดถูกอยู่ตรงหน้า

**บทเรียน:** ภาษาไทยมีวรรณยุกต์/สระที่เป็น code point แยก การเทียบสตริงตรงตัวจึงเปราะ
กว่าที่คิดมาก · และ "เงียบ" เป็นพฤติกรรมที่ผู้ใช้ debug เองไม่ได้ — ทุกครั้งที่เลือกให้ระบบ
เงียบ ต้องถามว่า "ถ้าเงียบเพราะพิมพ์ผิด ผู้ใช้จะรู้ได้ยังไง"

---

### #202 — carry ที่ลืมยกฟิลด์ใหม่ = ข้อมูลถูกเขียนทับเป็น null ทุกรอบ เงียบสนิท (2026-09-09)
`hcp_person_code` ควรมีเกือบทุกแถว (สุ่มถาม HCP จริง 40 คน มี 39) แต่ในฐานเรามีแค่ **23 แถว**
— และ 23 นั้นคือจำนวนที่เพิ่งถามสดไปพอดี
- import ของ HCP มีประตู "ถามครั้งเดียวตลอดกาล" (`haveRemarks`) เพื่อไม่ให้ยิง `personInfo` ซ้ำ
- รอบที่ถูกข้าม edge ส่ง `remark: null` มาให้ **ทุกแถว** แล้ว upsert เขียน `raw_json` ทับทั้งก้อน
  ⇒ ต้อง "ยกของเดิม" กลับมาใส่เอง (บล็อก carry) ซึ่งเคยแก้ไปแล้วครั้งหนึ่งตอน #195
- **แต่ carry ยกกลับมาเฉพาะ `remark` / `id_hash` / `id_enc`** · วันที่เพิ่ม `person_code`
  เข้ามาในภายหลัง ไม่มีใครไปเพิ่มในบล็อก carry ⇒ ฟิลด์ใหม่ถูกล้างทุกรอบตั้งแต่วันแรก
  โดยไม่มี error ไม่มี log และหน้าจอก็แค่ "ไม่มีข้อมูล" ซึ่งดูเหมือนต้นทางไม่ได้ส่งมา
- แก้: เพิ่ม `raw_json->>'hcp_person_code'` ทั้งใน SELECT ของ carry และตอน assign กลับ

**บทเรียน:** ทุกครั้งที่เพิ่มฟิลด์ใหม่ลง `raw_json` ของ importer ที่มีประตูข้ามรอบ
**ต้องไปเพิ่มในบล็อก carry ด้วยเสมอ** ไม่งั้นฟิลด์นั้นจะมีค่าเฉพาะรอบที่ถามสดเท่านั้น
· วิธีจับ: นับจำนวนแถวที่มีค่า แล้วเทียบกับจำนวนที่ถามสดรอบล่าสุด ถ้าเท่ากันเป๊ะ คือเจอตัวนี้

---

### #203 — ถามต้นทางซ้ำ ได้ค่าว่างกลับมาแล้วลบของเดิมทิ้ง (2026-09-09)
ปลดประตู "ถามครั้งเดียว" เพื่อดึงคำอธิบายใหม่จาก HCP · จาก 25 แถวที่ปลด **2 แถวต้นทางตอบว่าง**
แล้วคำอธิบาย (พร้อมเบอร์ติดต่อเจ้าหน้าที่และประเภทการเฝ้าระวัง) **หายไปทันที**
- upsert เขียนทับด้วยสิ่งที่ได้มารอบนี้ ⇒ "ไม่มีคำตอบ" กับ "ต้นทางลบทิ้ง" หน้าตาเหมือนกันเป๊ะ
- แถวที่หายคือแถวที่ต้นทางอาจแก้/ลบไปแล้ว ซึ่งเป็นแถวที่ **เรายิ่งต้องเก็บของเดิมไว้**
- แก้ครั้งนั้น: กู้จากไฟล์สำรองที่ทำไว้ก่อนแตะ · ตอน backfill ทั้งชุด 1,931 แถวจึงทำสองชั้น —
  สำรอง `raw_json` ทั้งหมดลงไฟล์ก่อน แล้วหลัง import รันสคริปต์ไล่คืนเฉพาะแถวที่
  "เคยมีค่า แต่ตอนนี้ว่าง" (รอบนั้นคืนไป 2 แถว)

**บทเรียน:** การ re-pull ไม่ใช่ปฏิบัติการอ่านอย่างเดียว มันเป็นการเขียนทับ —
**สำรองก่อนเสมอ และมีขา "คืนค่าที่หายไป" เตรียมไว้ ไม่ใช่ค่อยไปหาทีหลังตอนมีคนทัก**

---

### #204 — กรองข้อมูลคดีด้วยคำว่า `ประชาชน` ไปชนกับ "ฉ้อโกงประชาชน" (2026-09-09)
คัดแถวที่ "น่าจะมีเลขบัตรประชาชนอยู่ในคำอธิบาย" ด้วย regex `(บัตร|ประชาชน|x{5,})`
ได้มา 25 แถว → ดึงซ้ำจากต้นทางทั้งหมด → **ได้เลขบัตรเพิ่ม 0**
- 23 ใน 25 คือฐานความผิด `ฉ้อโกงประชาชน` / `ร่วมกันฉ้อโกงประชาชน` ไม่ได้เกี่ยวกับบัตรเลย
- เสียทั้งเวลาเรียก API ต้นทาง และทำให้ 2 แถวเสียคำอธิบายไปตาม #203

**บทเรียน:** ในข้อมูลคดี คำว่า `ประชาชน` เป็นคำในฐานความผิด ไม่ใช่คำบอกเลขบัตร ·
ก่อนยิงงานที่แตะต้นทางจากผลของ regex ให้ **พิมพ์ตัวอย่างที่ regex จับได้ออกมาดูก่อนเสมอ**
(ซ่อนตัวเลขไว้ก็ยังดูออกว่าเป็นประโยคแบบไหน) — นับอย่างเดียวไม่พอ

---

### #205 — คาบกันเขียนถี่ที่กรองคอลัมน์เดียว ทำให้อีกคอลัมน์ตายเงียบ 4 สัปดาห์ (2026-09-12)
`touchCamera()` เขียน `cameras.last_seen_at` (ติดต่อได้) และ `last_event_at` (มีข้อมูลจริง)
โดยมีคาบ 30 วินาทีกันไม่ให้เขียนถี่ — แต่ `WHERE` กรองด้วย `last_seen_at` อย่างเดียว
```sql
WHERE id=$1 AND (last_seen_at IS NULL OR last_seen_at < NOW()-'30 seconds'::interval)
```
ผู้เรียกที่ส่ง `event:true` มาทีหลังภายใน 30 วิ จึงหลุดทั้งแถว · `SET last_event_at=NOW()`
เขียนไว้ถูกต้องแต่ **ไม่เคยทำงาน** เพราะกล้องที่กำลังส่งข้อมูลอยู่คือกล้องที่ `last_seen_at` สดที่สุดเสมอ
- วัดตอนเจอ: **2 จาก 169 แถว**ที่มีค่า และค่าใหม่สุดค้างที่ `2026-08-17`
- repro อ่านอย่างเดียว: `WHERE` เดิมแมตช์ 86 แถว · เติมเงื่อนไขของ `last_event_at` แล้วแมตช์ 169
  ⇒ 83 กล้องที่ส่งข้อมูลอยู่ ณ วินาทีนั้น คือกล้องที่ถูกข้ามทุกครั้ง
- แก้: คิดคาบ **แยกรายคอลัมน์** — `(stale(last_seen_at) OR stale(last_event_at))` เมื่อ `event:true`
  เพดานการเขียนขึ้นจาก 1 → 2 ครั้ง/30 วิ/กล้อง (169 กล้อง = 11.3/วิ worst case
  เทียบกับ 25/วิ ก่อนมีคาบ ตาม #187) ยังคุ้มกับ dead tuple ที่กันไว้

**บทเรียน:** คิวรีที่ `SET` หลายคอลัมน์แต่ `WHERE` กรองคอลัมน์เดียว = คอลัมน์ที่เหลือ
มีค่าเฉพาะตอนที่คอลัมน์ตัวกรอง "บังเอิญเก่าพอดี" · บั๊กชนิดนี้ไม่มี error ไม่มี log
มีแต่คอลัมน์ที่ค่อย ๆ ตาย — **วิธีจับคือนับ `count(*) FILTER (WHERE col IS NOT NULL)`
เทียบกับจำนวนแถวที่ควรมีค่า ไม่ใช่ดูว่าโค้ดเขียนถูกไหม**

---

### #206 — pm2 daemon จำ timezone ตอนที่มันเกิด ไม่ใช่ของเครื่องตอนนี้ (2026-09-12)
เวลาในไฟล์ล็อกของ hkt ช้ากว่าเวลาจริง **~11 ชั่วโมง** ทั้งที่เครื่องถูกต้องทุกอย่าง:
`timedatectl` = `Asia/Bangkok` · `node` ที่เปิดใหม่รายงาน `Asia/Bangkok` · โปรเซส bridge
ไม่มี `TZ` ใน env และ `src/.env` ก็ไม่มีบรรทัด `TZ=`
- คนที่ประทับเวลาหน้าบรรทัดล็อกคือ **pm2 daemon** ไม่ใช่โปรเซสของเรา
- daemon pid 1262 เกิด `Sun Aug 9 19:13:18 2026` ส่วน `/etc/localtime` ถูกสลับเป็น
  Asia/Bangkok ตอน `2026-08-09 21:29:32` ⇒ **daemon เกิดก่อน timezone ถูกแก้ 2 ชม. 16 นาที**
  แล้วยังฟอร์แมตด้วยโซนเก่าต่อไปเรื่อย ๆ (UTC−4)
- ตรวจทั้งฟลีต 5 ไซต์: **hkt ไซต์เดียวที่เป็น** · ที่เหลือ daemon เกิดหลัง TZ ถูกแก้ จึงตรงหมด
```bash
# คำสั่งตรวจ — daemon เกิดก่อน /etc/localtime ถูกแก้เมื่อไหร่ = เพี้ยน
ps -o lstart= -p $(pgrep -f "PM2 v" | head -1); stat -c %y /etc/localtime
```
- วิธีแก้คือ `pm2 update` (reload daemon) ซึ่ง **respawn ทุกโปรเซสบนไซต์นั้น** ⇒ ต้องทำในช่วงที่ว่าง
  ไม่ใช่กลางวันทำการ · **ยังไม่ได้ทำ ณ 2026-09-12** — ตั้งใจเลื่อน เพราะเป็นเรื่องการอ่านล็อก
  ไม่ใช่ความถูกต้องของข้อมูล และ hkt มีประวัติกล้องบัฟเฟอร์แล้วคายย้อนหลังเมื่อ receiver หาย

**บทเรียน:** เวลาในล็อกของ pm2 ไม่ได้มาจากโปรเซสที่เขียนล็อก · แก้ `/etc/localtime` หรือ
`timedatectl` แล้ว **ล็อกไม่ตามมาจนกว่าจะ reload daemon** · เวลาที่เชื่อได้ต้องมาจาก
ตัวโปรเซสเองใส่ลงไปในบรรทัด ไม่ใช่ปล่อยให้ตัวรันฟอร์แมตให้

---

### #207 — "ตัด partition ได้" ไม่เท่ากับ "เร็วขึ้น" — ทำแล้วช้าลง 3.7 เท่า (2026-09-12)
คิวรีสร้างฐาน `camera_event_baseline` ถาม `events` ด้วย **`received_at`** แต่ตาราง
partition ด้วย **`event_time`** · `EXPLAIN` จึงโชว์ seq scan ครบทั้ง **20 partition
รวมของอนาคต** (`y2027m04`) ทั้งที่ต้องการข้อมูลแค่ 14 วัน — ดูเหมือนบั๊กชัด ๆ
```sql
-- "แก้" ด้วยการเติมขอบของคอลัมน์ที่เป็น partition key
AND event_time > now() - make_interval(days => 21)
AND event_time < now() + interval '1 day'
```
ตัด partition ได้จริงเหลือ 2 ตัว **แต่วัดเวลาแล้วแย่ลง**:

| รูปคิวรี | แผน | เวลา |
|---|---|---|
| ไม่มีขอบ | Seq Scan 20 partition | **85.4 วิ** (ทั้งงาน) |
| มีขอบ | Index Scan 2 partition | **318 วิ** (แค่ขั้น bins) |

- planner เปลี่ยนไปใช้ **Index Scan** บน `y2026m08` ซึ่งดึงแถวเกือบทั้ง partition
  แบบสุ่ม ⇒ random I/O แพงกว่า seq scan ของทั้งตารางเสียอีก
- partition ของอนาคต**ว่างเปล่า** การ scan มันจึงแทบไม่มีราคา
- partition ของเดือนปัจจุบันถือข้อมูลเกือบทั้งหมดอยู่แล้ว — ตัดหรือไม่ตัดก็ต้องอ่านมันอยู่ดี
- แก้: ถอยกลับ + เทสต์ตรึงว่า **ห้ามมี `event_time` ในคิวรีนั้น** พร้อมตัวเลขกำกับ

**บทเรียน:** `EXPLAIN` ที่ไม่สวยไม่ใช่หลักฐานว่าช้า และแผนที่สวยขึ้นไม่ใช่หลักฐานว่าเร็วขึ้น —
**ต้องจับเวลาจริงทั้งก่อนและหลังเสมอ** · โดยเฉพาะกับ partition ที่ข้อมูลกระจุกอยู่ตัวเดียว
การตัดตัวที่ว่างอยู่แล้วทิ้งไม่ได้อะไรกลับมา

🔴 **แต่วันเดียวกันนั้น การเติมขอบเดียวกันนี้ช่วยได้ 54 เท่าในอีกคิวรีหนึ่ง** (เจอหลังโค้ดหลุด
ขึ้น prod แล้ว — ตัวเฝ้า "กล้องเงียบ" log `quiet state lastRx: statement timeout` ทุกรอบ
และไม่เคยบันทึกอะไรลงตารางเลย):

| คิวรี | กรองด้วย `received_at` | กรองด้วย `event_time` |
|---|---|---|
| ชั้น 1 — `DISTINCT camera_id` 20 นาที | 37,396 ms | **686 ms** |
| ชั้น 2 — `max(received_at)` ของ 6 กล้อง | timeout (>60 วิ) | **1,418 ms** |
| สร้างฐาน — `DISTINCT` ถัง 5 นาที 14 วัน | **85 วิ** | 318 วิ |

**เส้นแบ่งคืองานที่เหลือหลังตัด ไม่ใช่จำนวน partition ที่ตัดได้:**
- เหลือเป็น **index range แคบ ๆ** (เจาะรายกล้อง / ช่วงสั้น) → เติมขอบแล้วเร็วขึ้นมาก
- เหลือเป็น **aggregate ทั้ง partition ที่ใหญ่ที่สุดอยู่ดี** → ไม่ได้อะไร และ planner
  อาจสลับไป Index Scan ที่ดึงแถวแบบสุ่มจนแย่กว่าเดิม

⚠️ ต้นเหตุร่วมของทั้งสามแถว: **`events` ไม่มี index บน `received_at` เลยสักตัว**
ทุกตัวอยู่บน `event_time` (ซึ่งเป็น partition key ด้วย) · คิวรีไหนที่ถาม `received_at`
ตรง ๆ = seq scan ทั้งตาราง 40M แถว · วิธีเลี่ยงคือ **ใส่ขอบด้วย `event_time` เพื่อให้เดิน
บน index แล้วค่อยเอาค่า `received_at` ที่ต้องการจริง ๆ ออกมา** โดยเผื่อ slack ให้มากกว่า
เวลาที่ของบัฟเฟอร์นานที่สุด (วัดได้ 71.2 ชม.)

⚠️ พ่วงอีกเรื่องจากวันเดียวกัน: **dry-run ที่เอา DDL (`ALTER TABLE`) ไปไว้ใน
ทรานแซกชันเดียวกับคิวรีหลายนาที = ถือ `ACCESS EXCLUSIVE` บนตารางนั้นทั้งช่วง** ·
`line_config` ถูกล็อกไป 5 นาทีเพราะเหตุนี้ (บังเอิญไม่มีใครชน) — ทดสอบ migration
กับทดสอบคิวรีหนัก **ต้องแยกทรานแซกชันกันเสมอ**

---

### #208 — `pm2 update` ฆ่า daemon แล้ว ssh ที่ถูก timeout ตัด = ไซต์ดับค้าง ไม่มีใครกลับมา (2026-09-13)
สั่ง `pm2 update` บน hkt ผ่าน ssh เพื่อแก้ timezone ของ daemon (#206) · คำสั่งถูกห่อด้วย
`timeout 180` ซึ่ง**สั้นกว่าที่ `pm2 update` ใช้จริง** ⇒ ssh ถูก SIGTERM กลางคัน
ตรงช่วงที่ daemon ตายไปแล้วแต่ยัง resurrect ไม่เสร็จ
- ผล: **แอปทั้ง 7 ตัวหายหมด** เหลือแต่ module `pm2-logrotate` · ไซต์ภูเก็ตดับสนิท
- จับได้เพราะไปเช็ค `pm2 list` ต่อ ไม่ใช่เพราะมีใครเตือน — **ไม่มีสัญญาณใด ๆ ทั้งสิ้น**
  (ตัวเฝ้า edge ที่ส่วนกลางวัดจาก heartbeat ซึ่งหยุดพร้อมกัน แต่ cooldown ยังไม่ถึง)
- กู้ด้วย `pm2 resurrect` กลับมาครบใน ~1 นาที (dump ถูก refresh ด้วย `pm2 save` ก่อนหน้าแล้ว
  ซึ่งเป็นสิ่งเดียวที่ทำให้กู้ได้เร็ว — dump เดิมเก่า 1 เดือน)
- **ต้นทุนจริง: หาย 634 เหตุการณ์ (64% ของ 4 นาที · ปกติ 246/นาที)** กล้องบางตัว replay
  ให้ บางตัวไม่ · เลือกทำตอน 00:11 ซึ่งเป็นชั่วโมงที่เบาที่สุด (44 เทียบกับพีค 894/นาที)
  ถ้าทำตอน 18:00 จะหายราว 2,300 เหตุการณ์

**บทเรียน:** คำสั่งที่ **ฆ่าตัวควบคุมของตัวเอง** (pm2 daemon, systemd ที่คุม sshd,
docker restart ที่มี ssh อยู่ใน container) **ห้ามรันผูกกับ session ที่อาจถูกตัด** ·
ต้อง detach ให้หลุดจาก ssh ก่อน แล้วค่อยกลับมาตรวจผลทีหลัง:
```bash
ssh host 'nohup setsid bash -c "pm2 save && pm2 update && pm2 resurrect" \
          > ~/pm2-update.log 2>&1 < /dev/null & echo started'
# แล้วค่อย ssh กลับไปอ่าน ~/pm2-update.log + pm2 list
```
และ **`pm2 save` ก่อนเสมอ** — dump ที่เก่ากว่าการตั้งค่าปัจจุบันคือความต่างระหว่าง
"กู้ได้ใน 1 นาที" กับ "ต้องประกอบ ecosystem ใหม่ตอนตีหนึ่ง"

---

### #209 — คำเรียกคำสั่งที่เป็นคำสามัญ/ส่วนย่อยของคำอื่น ชนบทสนทนาปกติในห้องเดียวกัน (2026-09-14)
ผู้สั่งพิมพ์คุยเรื่องอื่นในห้องเดียวกับที่บอทฟังคำสั่งอยู่ (ไม่ต้อง @ ก่อนสั่งตามการ
ออกแบบ — decision 2026-09-08) แล้วโดนจับผิดสองแบบ ยืนยันจาก `line_command_log` จริง:

1. **ชนตรง ๆ ผ่าน `matchCommand`** — "เดี๋ยวผมไป**ปิดแจ้งเตือน**ย้อนหลังก่อน" (คุยเรื่อง
   ปิดฟีเจอร์แจ้งเตือนย้อนหลัง คนละเรื่องกับป้ายทะเบียน) ชนคำเรียก "ปิดแจ้งเตือน"
   ของคำสั่ง `mute_plate` ตรงตัว คะแนน 12 (ไม่ใช่การเดา) ⇒ หาป้ายทะเบียนไม่เจอ
   บอทถาม "ป้ายทะเบียนอะไร" — เกิดซ้ำ 2 ครั้งใน 39 วินาที (ลองพิมพ์ใหม่โดนซ้ำ)
2. **ชนผ่าน `suggest()` (near-miss fallback)** — "คุยกับพี่วิรุธ แล้ว @Wirut Boonrit"
   คำว่า **"แล้ว"** (คำไทยสามัญมาก) เป็น substring ของคำเรียก "เห็น**แล้ว**"
   (คำสั่ง `ack_alert`) — `suggest()` เทียบแบบ `tl.includes(w) || w.includes(tl)`
   ไม่มีเกณฑ์กันคำสั้นชนคำยาว จึงเสนอ "รับทราบการแจ้งเตือน" กลับไป

**วัดอัตราจริงก่อนแก้ (14 วัน, 162 ข้อความ):** `no_match` 44 ครั้ง → มีแค่ 9 ครั้งที่
บอทตอบ "ยังไม่เข้าใจ" กลับ และ 7-8 ใน 9 นั้น**คือคนตั้งใจสั่งจริงแค่พิมพ์ไม่ตรงคำเรียก**
(`suggest()` ทำงานถูกทาง) เหลือแค่ 1 ครั้งที่เป็นบทสนทนาไม่เกี่ยวข้องแท้ ๆ (เคส "แล้ว")

**ก่อนแก้ต้องเช็ค 2 อย่างเสมอ ไม่งั้นพังของจริง:**
- `ack_alert` ไม่เคยถูกใช้สำเร็จเลยสักครั้งในปูมทั้งหมด → ตัดคำเรียก "เห็นแล้ว" ไม่มีต้นทุน
- ลองเสนอ `require_all=["ป้าย"]` ให้ `mute_plate` ก่อน แล้วพบว่า**วิธีพิมพ์จริงตาม
  เอกสาร/เทสต์ไม่เคยมีคำว่า "ป้าย" เลย** ("หยุดแจ้งเตือน 1กอ88 3 ชั่วโมง") — ถ้าใส่จริง
  จะพังการใช้งานจริงทันที ⇒ แก้ที่ตัดคำเรียกเสี่ยง ("ปิดแจ้งเตือน") ออกแทน ไม่ใช่เพิ่มคำบังคับ

migration 226 ตัด `เห็นแล้ว` ออกจาก `ack_alert` และ `ปิดแจ้งเตือน` ออกจาก `mute_plate`

⚠️ **ตรวจซ้ำหลังแก้แล้วพบผลข้างเคียง:** พอ `mute_plate` ไม่ชนตรง ๆ อีก ข้อความ ANR
เดิมตกไปที่ `no_match` แล้ว `suggest()` ยังเสนอ "กล้องที่ออฟไลน์ / สถานะกล้องบน
HikCentral / ค้นป้ายทะเบียน" กลับมา — เพราะคำว่า **"กล้อง"** (คำสามัญของทั้งแพลตฟอร์ม)
เป็น prefix ของคำเรียกหลายคำสั่ง ("กล้องดับ", "กล้องออฟไลน์" ฯลฯ) นี่คือกลไกเดียวกับ
เคส "แล้ว" เป๊ะ (`tl.includes(w)` ที่ `w` สั้นและสามัญเกินไป) แต่**เป็นปัญหาเชิงระบบของ
`suggest()` ทั้งฟังก์ชัน ไม่ใช่คำสั่งเดียว** — ต้องตัดสินใจแยกว่าจะแก้ threshold ของ
`suggest()` เองหรือไม่ ยังไม่ได้แก้ ณ ตอนที่เขียนบันทึกนี้ (รอเจ้าของตัดสินใจ)

**บทเรียน:** แก้บั๊กที่ trigger ตัวเดียวแล้วต้อง **verify ซ้ำด้วยข้อความเดิมเป๊ะ**
ไม่ใช่แค่ยืนยันว่า `status` เปลี่ยนจาก `ok`/`ask` เป็น `no_match` — `no_match` ไม่ได้
แปลว่าเงียบเสมอไป ต้องเช็ค `suggest()` ต่ออีกชั้นเสมอ เพราะมันมีเส้นทางตอบกลับของตัวเอง
แยกจาก `matchCommand`

---

### #210 — เส้นทางส่ง LINE เก่าใน api-server.js กลืนผลการส่งทิ้งเงียบสนิท (2026-09-14)
`_sendCameraStatusLine()` (แจ้งเตือนกล้องดับ/MQTT เงียบ) เขียน
`await lineSender.pushLineMessage(...).catch(() => {})` — แต่ `pushLineMessage()`
**ไม่เคย throw** มัน `resolve({success:false, error})` เสมอแม้ LINE ตอบ 4xx/5xx
(บั๊กคลาสเดียวกับที่ `alert-engine.js`'s `_pushToAll` เคยแก้ไปแล้ว 2026-08-31
แต่โค้ดเก่าจุดนี้คนละไฟล์ไม่ได้ตาม) ⇒ ส่งไม่สำเร็จก็เงียบเหมือนส่งสำเร็จทุกประการ
ไม่มี log ไม่มีร่องรอยใด ๆ ให้ตรวจ

พบตอนเจ้าของถามหลังเปิดแจ้งเตือนกล้อง LPR ที่ HKT (18 ตัว, migration 227) ว่า
ยืนยันได้ไหมว่าข้อความไปถึงจริง — ตอบตอนนั้นได้แค่ "last_alert_at ถูกตั้ง แปลว่า
โค้ดรันจบไม่มี exception" ซึ่ง**ไม่ใช่หลักฐานว่าส่งสำเร็จ**

แก้: เก็บผลจริงต่อผู้รับ (`success`/`error`) แทนการกลืนทิ้ง · `console.warn`
เฉพาะตอนมีผู้รับส่งไม่สำเร็จ (เงียบตอนสำเร็จทั้งหมด กันสแปม log) · log เฉพาะ
`id_tail` 4 ตัวท้าย ไม่ log LINE user/group id เต็ม (ตาม pattern ของ `_pushToAll`)

**ตั้งใจไม่แตะ:** `last_alert_at` ที่ผู้เรียกอัปเดตยังทำงานเหมือนเดิมทุกกรณี
(อัปเดตแม้ส่งไม่สำเร็จ) — เป็นบั๊กอีกชั้นที่แยกออกมาต่างหาก (ควรอัปเดตเฉพาะตอน
ส่งสำเร็จ เหมือนที่ `alert-engine.js` ทำ) แต่ไม่ใช่ของที่ขอวันนี้

**Verify:** รอรอบจริงที่กล้อง `C9-KAR-SB-04`/`C10-KAR-SB-04` (กำลังกะพริบ
online/offline อยู่พอดี) ส่งแจ้งเตือนออกไปหลัง deploy — `last_alert_at`
อัปเดตสำเร็จ ไม่มี error ใน log และไม่มี `[camera-alert]` warning โผล่ (แปลว่า
ส่งสำเร็จครบทุกคนจริง ไม่ใช่โค้ดไม่ได้รัน) — ยืนยันด้วยเหตุการณ์จริง ไม่ใช่จำลอง

**ภาคต่อ (2026-09-14 บ่าย):** จุดเดียวที่เหลืออยู่คือ `last_alert_at` ของ
`checkOfflineCameras` (ตัวเดียวกับที่เพิ่งเพิ่ม log) ยังอัปเดต**ไม่ว่าผลส่งจะเป็น
อย่างไร** เพราะตอนนี้ `_sendCameraStatusLine` resolve เสมอไม่ throw แก้ให้
อัปเดตเฉพาะ `result.sent === true` (ผู้รับอย่างน้อยหนึ่งคนได้รับจริง — เกณฑ์เดียว
กับ `_pushToAll` ใน `alert-engine.js`) ไม่อัปเดตเมื่อไหร่ รอบตรวจถัดไป (30 วิ)
จะลองส่งใหม่ทันที แทนรอ `escalate_interval_min` เต็ม ๆ

⚠️ **ผลข้างเคียงที่ต้องรู้:** ถ้าเหตุที่ทำให้ส่งไม่สำเร็จเป็นของที่ค้างยาว (เช่น
token หมดอายุจริง) จะกลายเป็นลองส่งซ้ำทุก 30 วิไม่มีที่สิ้นสุดต่อกล้องที่ออฟไลน์
อยู่ทุกตัว — ยอมรับได้เพราะปัญหาระดับ token จะเห็นได้จากจุดอื่นในระบบพร้อมกัน
อยู่แล้ว (LINE command ก็จะพังด้วย)

**Verify รอบสอง:** โค้ดใหม่ยังไม่เคยเจอ "ส่งไม่สำเร็จ" จริงบน prod (เกณฑ์
`okCount>0` พิสูจน์แล้วว่าทำงานถูกทางฝั่งสำเร็จจากรอบแรก) — สาขา "ไม่อัปเดต"
เป็น conditional ธรรมดา ไม่ manufacture ความล้มเหลวบน prod เพื่อทดสอบ
(จะเป็นการยิงข้อความไม่ตามกำหนดเข้ากลุ่มลูกค้าจริงโดยไม่จำเป็น) ยืนยันด้วย
syntax check + restart สะอาด + อ่านโค้ดแทน

### #211 — แก้ไฟล์ใน `dashboard/` แล้ว pull ครบทุกไซต์ แต่หน้าเว็บยังเป็นของเก่า เพราะ bundle ประกอบตอน boot (2026-09-19)
เจ้าของสั่งแก้ข้อความบนหน้ากวดขันวินัยจราจร · commit + push + pull ครบ 5 ไซต์ · ยืนยันแล้วว่า
ไฟล์บนดิสก์เปลี่ยนจริง แต่หน้าเว็บยังโชว์ข้อความเดิม · เจ้าของ purge cache ที่ Cloudflare
ก็ไม่หาย แล้วถามกลับมาว่า "สรุปแก้แล้วหรอ"

`DASHBOARD_BUNDLE` ตั้งต้น **เปิด** (`src/config.js`) ⇒ dashboard ไม่ได้โหลด `page-*.js`
ทีละไฟล์ แต่โหลด `/dashboard.bundle.js` ซึ่งประกอบไฟล์ทั้ง 41 ตัวไว้ใน**หน่วยความจำครั้งเดียว
ตอน api-server boot** (IIFE `buildDashboardBundle()` ใน `src/routes/static-shell.js`)
`git pull` เปลี่ยนไฟล์บนดิสก์ แต่ process ไม่เคยอ่านซ้ำ
- วัดจริง: api-server boot 18/9 17:37 · ไฟล์ถูกแก้ 19/9 02:16 ⇒ bundle เก่ากว่า 9 ชั่วโมง

🔴 **ทำไม purge แล้วไม่หาย:** `?v=` ของ bundle คือ `_BUNDLE.ver` ซึ่งคิดตอน boot เหมือนกัน
⇒ **URL ไม่เปลี่ยน เนื้อไม่เปลี่ยน** Cloudflare ส่งต่อสิ่งที่ต้นทางให้มาอย่างถูกต้องแล้ว
purge กี่รอบก็ได้ของเดิม · การประทับ `?v=<mtime>` รายไฟล์ที่กันของค้างได้จริง ใช้ได้
**เฉพาะโหมดไม่ bundle** เท่านั้น — อย่าเอาเหตุผลข้อนั้นมาตอบเวลาโหมด bundle เปิดอยู่

`scripts/check-stale-workers.js` เดิมมองไม่เห็นเคสนี้ เพราะมันไล่ `require` graph ส่วน
`dashboard/*.js` ถูกอ่านด้วย `fs` ตอน runtime ไม่ได้ถูก `require` — ขยายแล้ว 2026-09-19
ให้ process ที่โหลด `routes/static-shell.js` นับไฟล์ที่ bundler เลือกจริงเป็นอินพุตด้วย

**บทเรียน:** แก้อะไรใน `dashboard/` ขั้นตอน deploy ต้องมี **`pm2 restart api-server`** เสมอ
แค่ pull ไม่พอ (ต่างจากไฟล์ใน `src/` ที่ restart process นั้น ๆ ครอบคลุมอยู่แล้ว) · หลัง
deploy ให้รัน `npm run check:stale` ซึ่งตอนนี้ฟ้องเคสนี้ได้แล้ว · และเวลาลูกค้าบอกว่า
"แก้แล้วแต่ยังไม่เปลี่ยน" ให้ตรวจ **ต้นทาง**ก่อนเสมอ อย่าเพิ่งโทษแคชปลายทาง

### #212 — เพดานเวลาคงที่ของ backup ที่เคยพอ กลายเป็นไม่พอเมื่อ DB โตไปเรื่อยๆ — offsite หยุดเงียบ 15 วัน (2026-09-22)
เจ้าของเห็นว่าไฟล์ backup ล่าสุดบน Google Drive ค้างอยู่ที่ 7 ก.ย. ถามว่าทำไมหยุด ทั้งที่
`vigil-backup.timer` ยังแสดง active ปกติ ไม่มี alert อะไรเตือนเลยตลอด 15 วัน

ต้นเหตุ: `vigil-backup.service` ตั้ง `TimeoutStartSec=3600` (1 ชม.) ไว้ตั้งแต่ 27 ก.ค. ตอน
DB เล็กพอที่ pg_dump + อัปโหลด Google Drive จะเสร็จใน 41-48 นาที มีเวลาเหลือ DB โตต่อเนื่อง
จนตอนนี้ 189 GB → pg_dump อย่างเดียวก็กิน ~50 นาทีแล้ว (7 ก.ย.) เหลือเวลาไม่พอให้อัปโหลด
ไฟล์ 25-31 GB เลย ตั้งแต่ 8 ก.ย. เป็นต้นมา **systemd ฆ่ากลางคันทุกคืน** (`journalctl` โชว์
"start operation timed out" ตรงเวลา start+3600 วินาทีเป๊ะทุกวัน) ก่อนขา offsite จะได้พิมพ์
log แม้แต่บรรทัดเดียว (ไม่มีทั้ง "อัปโหลดสำเร็จ" และ "อัปโหลดล้มเหลว" — เป็นลายเซ็นของการโดน
SIGTERM กลางทาง ไม่ใช่ error ปกติ)

🔴 **local backup เองไม่เสียเลยสักวัน** (ยกเว้นวันเดียว) — ตรวจจาก `backup.log` เห็น pg_dump
ขึ้น "✓ Done" พร้อมขนาดไฟล์โตต่อเนื่อง 23G → 31G ทุกวันจนถึงวันที่พบ เพราะ script เดิมเขียน
pg_dump ไว้ก่อน แล้วขา offsite ต่อท้ายในสคริปต์และ service เดียวกัน — พอฆ่าทั้งโปรเซส
กลางทางตอนอัปโหลด ผลคือ**เอา local backup ที่เสร็จแล้วไปเสี่ยงตายด้วยความช้าของ Google
Drive** ทั้งที่ไม่เกี่ยวกันเลย

🔴 **วันที่ 13 ก.ย. โดนฆ่ากลาง pg_dump พอดี** — dump วันนั้นมีแค่ 2 GB (ควรจะ ~27 GB)
ไม่มีบรรทัด "✓ Done" นอนอยู่ใน `backups/` หน้าตาเหมือนไฟล์ปกติ ถ้าไม่ตรวจ log จะไม่รู้เลยว่า
กู้คืนจากวันนี้ไม่ได้

**ทดสอบสดยืนยันเพิ่ม:** อัปโหลดไฟล์ทดสอบ 300 MB ไปที่ remote เดียวกัน ยังไม่เสร็จหลังผ่าน
ไปกว่า 4 นาที ทั้งที่ต่อ Google ติดจริง (เห็น socket ESTABLISHED) — เครือข่ายตอนนั้นช้ากว่าที่
คาดไว้มาก ยืนยันว่าไม่ใช่ token/auth หมดอายุ

**แก้:** แยก local backup กับ offsite upload เป็นคนละ service คนละ timeout ตั้งแต่ต้น
(`scripts/backup.sh` / `scripts/backup-offsite.sh` / `scripts/install-backup-timer.sh`) —
ตัวช้ากว่าจะฆ่าตัวที่เสร็จไปแล้วไม่ได้อีกต่อไป พร้อมเปลี่ยนเวลาเริ่มและจำนวนวันเก็บ (local/cloud)
จากค่าคงที่ในสคริปต์ เป็นค่าที่ตั้งได้จากหน้า Settings (`system_settings`, migration 236)

**บทเรียน:** เพดานเวลาคงที่ (`TimeoutStartSec`, `LIMIT`, timeout ทุกชนิด) ที่คำนวณจากขนาด
ข้อมูล ณ วันที่ตั้งค่า — พอข้อมูลโตต่อเนื่องแบบแพลตฟอร์มนี้ (events/license_plates โตทุกวัน)
เพดานนั้นจะเลื่อนจาก "มีเหลือเฟือ" ไปเป็น "ไม่พอ" เองโดยไม่มีอะไรเตือน ต้องมี **margin ที่
โตตามข้อมูลได้ หรือแยกงานที่ความเร็วไม่แน่นอน (อัปโหลด/เครือข่าย) ออกจากงานที่ต้องสำเร็จแน่ๆ
(local backup)** อย่าฝากไว้ด้วยกันในเพดานเดียว — cf. GOTCHAS #191 (บั๊กคนละอาการ ต้นเหตุ
เดียวกัน: pg_dump/backup กับ DB ที่โตไม่หยุด)

### #213 — เพิ่มชนิดไฟล์ที่ "เบราว์เซอร์รันได้จริง" (HTML) เข้า upload ต้องมี 3 ชั้น ไม่ใช่แค่ magic bytes เหมือนชนิดอื่น (2026-09-24)
เจ้าของขอให้ `/api/files` (public file host เดิม) รองรับ HTML แบบ "เปิดเป็นหน้าเว็บทันที
เมื่อกดลิงก์" (เหมือนแชร์ Google Docs) แทนที่จะบังคับดาวน์โหลดเหมือนไฟล์ประเภทอื่น

จุดที่ต่างจากทุกชนิดไฟล์ที่ `/api/files` เคยรองรับ (PNG/JPEG/PDF/DOCX/XLSX): ไฟล์อื่น
ทุกตัวถูกบังคับ `Content-Disposition: attachment` เสมอ (ดู `routes/media-files.js`) —
เบราว์เซอร์จึงไม่เคยตีความเนื้อไฟล์เป็นหน้าเว็บ ณ โดเมนของเราเลย ต่อให้ PDF จะพก JS
ฝังอยู่ก็รันในตัวอ่าน PDF ไม่ใช่ในบริบทของโดเมนเรา **HTML ที่ต้อง "เปิดแล้วรัน" คือของ
ที่เบราว์เซอร์ตีความและรันจริงในบริบทของ `upl.dojojin.tech`** — `sniffUploadType` แบบ
เดิม (ตรวจ magic bytes อย่างเดียว) พิสูจน์ได้แค่ "หน้าตาเหมือน HTML" ไม่ได้พิสูจน์ว่า
ปลอดภัย ต้องมีด่านเพิ่มที่ชนิดไฟล์อื่นไม่ต้องมี

**แก้ด้วย 3 ชั้น ไม่ใช่ชั้นเดียว** (เผื่อชั้นใดชั้นหนึ่งมีรูรั่วที่ไม่รู้):
1. **Sanitize ก่อนเก็บ** (`helpers/htmlSanitize.js`, ใช้ `sanitize-html` ไม่เขียนเอง —
   OWASP เตือนตรง ๆ ว่าอย่าเขียน HTML sanitizer เอง เพราะ edge case ของ HTML parsing
   เยอะเกินจะไล่ครบด้วย regex) ตัด script/event handler/iframe/object/embed/form/
   `<style>` block/link/meta/base ออกหมด ก่อนเขียนลงดิสก์ — sha256 ที่เก็บจึงตรงกับ
   ของที่เสิร์ฟจริงเสมอ
2. **CSP ตอนเสิร์ฟ** (`routes/media-files.js`, เฉพาะ `mime === 'text/html'`) —
   `default-src 'none'; script-src ไม่มีเลย` กันไว้เผื่อ sanitizer พลาด
3. **โดเมนแยกไม่มี session cookie** (ของเดิมอยู่แล้ว `FILES_PUBLIC_URL=upl.dojojin.tech`
   คนละโดเมนกับ `dashboard.dojojin.tech` — cookie login ไม่มี `Domain=` เลยจึงเป็น
   host-only ผูกกับ dashboard เท่านั้น) — ต่อให้สองชั้นแรกรั่วพร้อมกัน ผลเสียหายสูงสุด
   คือคนร้ายคุมหน้านั้นหน้าเดียว ไม่ใช่ session ของแอดมิน

**ทดสอบด้วยเวกเตอร์ XSS จริง ไม่ใช่แค่ `<script>` ตรง ๆ:** `javascript:`/`data:text/html`
ใน href · event handler ทุกแบบ · `<svg><script>` · `<meta http-equiv=refresh>` (redirect
ไม่ต้องมี JS เลย) · `<base href>` (hijack ลิงก์สัมพัทธ์ทั้งหน้า) · `background:url()` ใน
style attribute (แอบโหลดของนอก) · `width:expression()` (เวกเตอร์เก่าของ IE) — ทุกตัวถูก
ตัดจริง ยืนยันด้วยเทสต์ที่รันได้ซ้ำ ไม่ใช่แค่ตรวจด้วยตา (`test/html-sanitize.test.js`)

**บทเรียน:** upload ที่มีอยู่ "ปลอดภัยเพราะ magic bytes" ใช้ได้กับไฟล์ที่**ไม่ถูกเบราว์เซอร์
รันเป็นหน้าเว็บ** เท่านั้น — พอเพิ่มชนิดไฟล์ที่รันได้ (HTML, และในอนาคตถ้ามี SVG/XML ที่
ตั้งใจเปิดจริง) กฎเดิม (ตรวจ magic bytes + ห้าม SVG) ไม่พอ ต้องคิดใหม่ว่า "ใครเป็นคนตีความ
เนื้อไฟล์นี้ และตีความที่ไหน" ก่อนเปิดชนิดไฟล์ใหม่ ไม่ใช่แค่เพิ่มบรรทัดใน allowlist

### #214 — ชื่อกฎ IVA ภาษาไทยยาวเกิน 64 byte บนกล้อง Bosch ถูกตัดกลางตัวอักษร → topic MQTT เป็น UTF-8 เสีย: NanoMQ ทิ้งเงียบ ๆ, Mosquitto ตัดกล้องทั้งตัว (2026-09-28)
นำร่องย้าย edge vss3 (rmutr-v) จาก NanoMQ ไป Mosquitto 2.1.2 ตอน 02:27 · ต่อครบทุกตัว event
ไหล — ดูเหมือนผ่าน แต่กล้อง BH5100i_RMUTR-V_01 (172.29.51.53) ถูกตัดด้วย `malformed packet`
25 ครั้งจนถึง 05:03 และ `LineDetector/Crossed` ของกล้องตัวนี้ (~3,700/วัน) เข้ามา 0 รายการ ·
rollback NanoMQ แล้ว LineDetector กลับมาใน 90 วิ

**ต้นเหตุ (ยืนยันด้วย tcpdump 15:55, 3 ครั้งเหมือนกันทุกครั้ง):** กฎนับบนกล้องชื่อไทย
"ปริมาณรถทั้งหมดในพื้นที่…" ยาวเกิน **64 byte ซึ่งเป็นเพดานชื่อกฎของ Bosch** (RCP+
`CONF_VIPROC_RE_TASK_NAMES` 0x0b2b: "UTF8 encoded and maximal 64 byte") · กล้องตัดที่ 64
byte ไม่ดูขอบอักขระ ⇒ ไทย 21 ตัว (63 byte) + byte `e0` ครึ่งตัว ⇒ topic
`…/CountAggregation/Counter/&1/<ชื่อ>` เป็น UTF-8 ที่ผิดมาตรฐาน MQTT · ข้อความนี้เป็น
**retain ส่งเป็นอันดับแรกทุกครั้งที่ต่อ** ⇒ Mosquitto ตัดภายใน 0.04–0.15 วิ ⇒ กล้องต่อใหม่
แล้วโดนตัดวน ⇒ LineDetector หายเป็น**ผลพลอย** ไม่ใช่ต้นเหตุ
**NanoMQ ก็ไม่รับ แต่ทิ้งเงียบ ๆ** — ตัวนับนี้ไม่เคยเข้า DB เลยอย่างน้อย 60 วัน ใช้ broker ไหนก็หาย

**ทางที่ผิดก่อนเจอ (เก็บไว้เป็นบทเรียน):** ตรวจ topic ด้วย subscriber บน NanoMQ แต่ดูเฉพาะ
topic LineDetector (สะอาด) แล้วไปสงสัย firmware เพราะ .53 = 09.82.0022 ส่วน .55 = 09.80.0106
และ release letter 9.82 แก้โค้ด MQTT line-crossing พอดี — **ผิด** · .55 ไม่หลุดเพราะชื่อกฎ
สั้นทุกตัว · ตัวที่เสียไม่เคยโผล่บน NanoMQ ให้เห็นเลย เพราะ NanoMQ ทิ้งไปก่อน ⇒ subscriber
หาไม่เจอโดยธรรมชาติ · debug log ของ Mosquitto ก็ไม่บันทึก packet ที่ปฏิเสธ ⇒ **ต้อง tcpdump**
(`mqtt_pcap_check.py` อ่าน header/topic ทุก PUBLISH แล้วชี้ packet แรกที่ผิดพร้อม hex)

เรื่องที่สองในรอบเดียวกัน: เขียน `CONF_MQTT_SETTINGS` (0x0d0a) แล้วอ่านกลับตรง แต่กล้องยัง
ต่อด้วย session เดิมจนกว่าจะ reboot (หลัง reboot ต่อเป็น `u'cam-…'` ทันที)

**แก้ด้วย:** เปลี่ยนชื่อกฎบน .53 เป็น "Vehicle Count (ALL)" (19 byte) — เข้าระบบครั้งแรก ·
edge อ่านชื่อกฎทุกกล้อง Bosch รายชั่วโมง (0x0b2b) แล้วขึ้นเตือนในหน้า Health · help ในฟอร์ม
กล้อง · ปุ่มส่งค่า MQTT reboot กล้องต่อให้เอง (`CONF_BOARD_RESET` 0x0811, commit `4030fb3d`)

**บทเรียน:**
- ชื่อกฎบนกล้อง Bosch ต้อง **≤ 64 byte (ไทย ≤ 21 ตัว) ห้ามมี `+`/`#`** — เกินแล้วข้อมูลกฎนั้น
  หายเงียบแม้บน NanoMQ
- ก่อนย้าย edge ไป broker ที่เข้มกว่า เทียบจำนวน event **แยก event_type ต่อกล้อง** ก่อน/หลัง
- "topic ที่ข้อมูลหาย" กับ "topic ที่ทำให้หลุด" อาจเป็นคนละตัว — อย่าตรวจแค่ตัวที่หาย จับ packet
  ตั้งแต่แรก

---

### #215 — สถิติ LPR ช่วง `custom` ที่ไม่มี `from` กวาดทั้งประวัติ และคำขอซ้ำถูกคิดซ้ำจนกิน pool หมด (2026-10-01)

**อาการ:** หน้าป้ายทะเบียนค้นหาไม่ได้ ("โหลดไม่สำเร็จ") load average ขึ้นถึง 17 · IO pressure ~45% ·
Postgres มีคิวรีหนัก 21 ตัวรอดิสก์ · `/api/lpr/stats?period=custom` ตอบ 500 หลัง 120 วินาที

**ต้นเหตุ (3 ชั้นที่ซ้อนกัน):**
1. `periodClause('custom')` เมื่อไม่มีทั้ง `from` และ `to` คืนเงื่อนไข `TRUE` → คิวรีกวาด `license_plates`
   ~51 ล้านแถว (34 GB)
2. `/api/lpr/stats` ยิง ~12 คิวรีขนานต่อคำขอบน pool 15 ช่อง และไม่รวมคำขอซ้ำ (ได้ 45 คิวรีจาก 3 คำขอ
   ที่เหมือนกัน) หน้า overview ยิง full + `part=kpi` พร้อมกันทุกครั้ง
3. ผู้ใช้ที่ปิดหน้าแล้ว คิวรียังรันต่อจนจบ

**แก้:** `cf033b06` ขอบล่าง 31 วัน · `8c886a0f` `helpers/heavyRunner.js` (รวมคำขอซ้ำ + จำกัดจำนวนที่รัน +
ออกจากคิวเมื่อผู้เรียกไป) + `statsPool` แยก 10 ช่อง · `ca17681a` warm loop และ Reports อยู่หลังคิวเดียวกัน

**บทเรียน:**
- เงื่อนไขช่วงเวลาที่ "ไม่ระบุ" ต้องไม่แปลว่า "ทั้งหมด" บนตารางที่โตต่อเนื่อง — ใส่ขอบเสมอ
- route ที่ยิงหลายคิวรีขนานต้องมีทั้งตัวรวมคำขอซ้ำและตัวจำกัดจำนวน ไม่งั้นคนเดียวกดซ้ำก็ทำให้ทั้งระบบช้า
- งานสถิติหนักแยก pool จากหน้ารายการ/ค้นหา ไม่งั้นแย่งช่องกัน
- ที่ยังเหลือ (ตั้งใจเลื่อน): ยังไม่ยกเลิกคิวรีที่กำลังรันเมื่อผู้ใช้ออก · `today`/`hour`/`custom` ยังคิดสดจาก
  ตารางดิบ (เฟส 2: ตารางสรุป + ขอบสด)

---

### #216 — ข้อมูลใบหน้า (face_embeddings / face_embed_queue) ไม่เคยถูกลบ เพราะ FK ไป events ถูกถอดตอนแบ่ง partition (2026-10-02)

**อาการ:** `face_embeddings` 13 GB 4.78M แถว และ `face_embed_queue` 6.7M แถว โตไม่หยุด ไม่มีโค้ดไหนลบ
**ต้นเหตุ:** ลูป retention ลบ event รายแถวแล้วลบลูกตามรายชื่อตายตัว (appearances, license_plates, …) ส่วนตารางใบหน้า
เคยพึ่ง FK ไป `events` ซึ่งถูกถอดตอนแบ่ง partition ⇒ ไม่มีใครลบ · event อายุ 100 วัน ⇒ ตั้งแต่ ~18 พ.ย. 2569 เวกเตอร์ใบหน้า
(ข้อมูลชีวมิติ) จะอยู่เกินอายุ event ของตัวเอง
**แก้:** `src/jobs/retention.js` ลบสองตารางด้วยขอบเวลา `data_retention_days` เดียวกับ events (เจ้าของเลือก 100 วัน ไม่ใช่
`appearances_retention_days` 40 วัน)
**บทเรียน:**
- ตารางที่อ้าง event ด้วย `event_id` แต่ไม่มี FK = ไม่มีใครลบ ต้องอยู่ในงาน retention ตรง ๆ ทุกตัว
- `partitionRetention.js` ถามรายชื่อลูกจาก catalog (FK) — ตารางที่ไม่มี FK ก็หลุดจากเส้นทางนั้นเช่นกันเมื่อ drop partition

---

### #217 — ตรวจระบบ 2 ต.ค. 2569: ดิสก์เขียน WAL ไม่สำเร็จแล้วพาบั๊กเงียบ 6 ตัวโผล่ (D1–D7)

รายงานเต็ม: `docs/reports/2026-10-02_system-audit-defect-optimize-plan_TH.md` (local)

| # | อาการ | ต้นเหตุ | แก้ |
|---|---|---|---|
| D1 | Postgres crash 26 ก.ย. 17:21 · subscriber INSERT ล้ม ~400 ครั้ง | NVMe เขียน WAL `pg_wal/…0261000000CD` ไม่สำเร็จ (kernel I/O error) · `data_checksums=off` | รอผล SMART · backup 27 ก.ย.–2 ต.ค. สำเร็จทุกคืน |
| D2 | ฐาน "นิสัยความเงียบ" กล้องค้างตั้งแต่ 12 ก.ย. | `WITH wipe AS (DELETE …) INSERT …` คำสั่งเดียว — CTE รันพร้อมกันบน snapshot เดียว INSERT ชน PK ทุกครั้งที่ตารางมีข้อมูล (ผ่านแค่รอบแรก) · รัน 03:30 ทับ pg_dump | DELETE แยกคำสั่ง · ย้ายไป 01:30 |
| D3 | dashboard ไม่ได้ event สด ~29 ชม. หลัง crash | LISTEN client มีแค่ `on('error', log)` ไม่ต่อกลับ (ws-bridge + Dahua clip resolver) | `helpers/pgListen.js` ต่อกลับเอง + backoff |
| D4 | Health "MQTT pipeline" เขียวตลอด · feed สดมีของปลอม | กล้องนาฬิกาเพี้ยนส่ง event ปี 2032 เข้ามา 7 แถว (15 ก.ย.) · `MAX(event_time)` ไม่มีขอบบน | ลบ 7 แถว + bucket (สำรองไว้) · ขอบ `<= now()+5 min` · นับ event อนาคตใน Health |
| D5 | กล้อง Bosch 8 ตัว `enabled=false` ถาวร | ด่านยืนยันด้วยภาพไม่มี path Bosch → ตกชุด onvif → `http_400` ทุกเส้น · เงียบเพราะไม่ log `found:false` | `bosch: ['/snap.jpg']` + log เมื่อเหตุผลเปลี่ยน |
| D6 | สถิติ appearance 7d/1m ไม่ขึ้น · รายงานหมวดบุคคลหายเงียบ | join appearances⋈events: 1 วัน 6.8 วิ · 7 วัน 76 วิ · ไม่ส่งช่วง 120 วิ → 500 | ตอบ 400 เมื่อเกิน 2 วัน · หน้าจอ/รายงานบอกตรง ๆ · ตัวแก้ถาวร = rollup (รอตัดสินใจ) |
| D7 | viewer แก้ watchlist / ตั้งค่า ingest / กดส่ง LINE ได้ | `/api/lpr` ไม่อยู่ใน `requireAdminForWrites` | `helpers/lprWriteGuard.js` deny-by-default + allowlist งานเจ้าหน้าที่ |

**บทเรียน:**
- CTE ที่แก้ข้อมูล (`WITH x AS (DELETE …)`) **ห้ามใช้คู่กับ INSERT ตาราง/คีย์เดียวกัน** — ผ่านตอนตารางว่าง แล้วพังถาวร
- LISTEN ทุกตัวต้องผ่าน `pgListen` — Postgres หลุดเมื่อไรก็ต้องต่อกลับเอง
- ค่า `MAX(event_time)` / `ORDER BY event_time DESC` ต้องมีขอบบน — เวลาจากกล้องเชื่อไม่ได้
- ด่านที่ตอบ "ไม่ผ่าน" ต้องบอกเหตุผลใน log ไม่งั้นติดค้างถาวรโดยไม่มีใครเห็น
- route เขียนข้อมูลใหม่ต้องมีด่านสิทธิ์ชัด — ค่าเริ่มต้นต้องปฏิเสธ

---

### #218 — แผนป้องกันหลัง #217: สัญญาณบั๊กเงียบบนหน้า Health + ตัวสแกน route เขียนไม่มีด่าน เจอ PUT /api/alert-channels เปิดให้ viewer (2026-10-02)

**สิ่งที่เพิ่ม (หนึ่งมาตรการต่อหนึ่งประเภทปัญหา ไม่ใช่ต่อบั๊ก):**
- Health → การ์ด "ความถูกต้องของระบบ" (`integrity`): event อนาคต · อายุฐานกล้องเงียบ · ws-bridge · กล้อง heartbeat สดแต่ offline · ดิสก์ I/O error 24 ชม.
- LISTEN ทุกตัวใช้ `helpers/pgListen` (api-server, dahua, alert-worker, media-recorder)
- ขอบบน `event_time <= now()+5 นาที` ทุกจุดที่หา event ล่าสุด · รายงานสุขภาพเปลี่ยนเป็นทีละกล้อง LIMIT 1 (0.4 ms, ผลเท่าเดิม)
- probe path ระบุครบทุกยี่ห้อที่ใช้ + เตือนตอนบูตถ้าไม่มี
- `check-events` ครอบ `appearances`
- `test/api-write-guard-coverage.test.js` — route เขียนใต้ /api ที่ไม่มีด่านที่มองเห็นได้ = เทสต์ล้ม

**บั๊กที่ตัวสแกนเจอทันที:** `PUT /api/alert-channels/:channel` (ผู้รับ LINE/Telegram ของช่องทางในตัว) ไม่มีด่านเลย
→ `auth.requireAdmin` + audit_log `alert_channel_update` · ไม่มีหลักฐานย้อนหลังว่าเคยถูกใช้ (ไม่เคยมี audit/updated_by)

**ข้อจำกัดที่ยังรู้อยู่:** `check-events` นับ `LIMIT` ในคิวรีรวมยอด (เช่น `ORDER BY n DESC LIMIT 8`) เป็น "เพดาน"
— เคส D6 ผ่าน hook ได้เพราะเหตุนี้ ต้องแยก LIMIT ของการตัดผลออกจากเพดานจริงก่อนเชื่อผลของ hook 100%

**บทเรียน:** สัญญาณ "สิ่งที่ควรเกิดแต่ไม่เกิด" (งานไม่จบ · การเชื่อมต่อไม่กลับ · ด่านไม่ผ่าน) ต้องมีที่แสดงบนจอ
log อย่างเดียวไม่มีใครอ่าน · ตัวตรวจแบบสแกนทั้ง repo หาของที่หลุดได้ดีกว่าการจำเป็นราย route

---

### #219 — Quick wins หลังตรวจระบบ: SET LOCAL นอก transaction เงียบ · trigram ต้อง ≥3 ตัว · สถิติ planner ของตารางใหญ่ค้าง · ปฏิทินช่อง "ถึง" (2026-10-02)

- **`SET LOCAL` นอก `BEGIN` ไม่มีผล** — Postgres แค่ WARNING ("can only be used in transaction blocks") แล้วไปต่อ
  facets ตั้งเพดาน 8 วิไว้แบบนี้มานาน ไม่เคยทำงาน · `SET LOCAL` ทุกที่ต้องอยู่ใน `BEGIN … COMMIT` บน client เดียว
- **ILIKE '%x%' กับ trigram ต้อง ≥ 3 ตัวอักษร** — 1–2 ตัว planner ไล่ทั้งตาราง (license_plates >30 วิ) · /api/lpr ปฏิเสธแล้ว
- **ตารางใหญ่ที่โตเร็ว analyze ไม่ทัน** — scale factor 0.1 ของ 53M แถว = ~6 วันครั้ง histogram ไม่ครอบช่วงล่าสุด
  planner ประมาณ "1 วันล่าสุด" ต่ำไป 25 เท่า → migration 250 ตั้ง 0.005 ให้ license_plates · ตารางอื่นที่โต
  แบบเดียวกันให้ดู `pg_stats.histogram_bounds` ปลายสุดเทียบกับข้อมูลล่าสุด
- **ปฏิทิน "ถึง" เปิดตามค่าที่ถูกเติมไว้ (เช่น "ตอนนี้")** ไม่ใช่ตาม "ตั้งแต่" → เลือกผิดเดือนง่าย · แก้ที่
  `_adpToFollowsFrom` ใน dashboard.js ครอบทุกคู่ From/To
- **poll ที่ไม่มีคนดู** (today-counts ทุกแท็บทุกหน้า · Health perf หลังออกหน้า) คือภาระ DB ที่มองไม่เห็น —
  timer ทุกตัวต้องเช็ค `document.hidden` และหน้าที่ใช้ข้อมูลนั้น


### #220 — ออก token ใหม่ให้กล้อง แต่ slot อื่นในกล้องยังถือ URL ของ token เก่า → ส่งมาทิ้งตลอดไป (2026-10-02)

- **อาการ:** Central ทิ้ง `/face-push/<token ไม่รู้จัก>` ~1.4 ครั้ง/วินาที (เห็นเป็นบรรทัดต่อคำขอมาตั้งแต่ ก.ค. 2569 จน D15
  ทำเป็นสรุป) ต้นทาง = IP สาธารณะของไซต์ภูเก็ต · token 4 ตัวไม่อยู่ใน config ไหนเลย
- **ต้นเหตุ:** C22/C51/C78/C81-PT มี slot 2 (`hostName dashboard.dojojin.tech:443`) ชี้ Central ด้วย token รุ่นก่อน ·
  token ถูกออกใหม่ (`face_push_token_generated` 10 ส.ค. ×3, 17 ส.ค. ×1) แล้ว slot 1 ถูกชี้เข้า edge ด้วย token ใหม่
  แต่ไม่มีใครลบ slot 2 → กล้องอัปรูปหน้าขึ้นเน็ตสองเท่า ครึ่งหนึ่งไปทิ้ง
- **หาเจอยังไง:** `GET /alarm-server-status?camera_id=X` ของ edge (อ่านอย่างเดียว) ไล่ทุกกล้องที่มี `face_push_token`
  เทียบ token 6 ตัวแรกใน slot กับในสรุป D15
- **บทเรียน:** การ rotate token = ต้องไล่ **ทุก slot** ในกล้องที่ถือ path ของเราด้วย token เก่า ไม่ใช่แค่ slot ที่ repoint ·
  หน้า Health การ์ด "ความถูกต้องของระบบ" มีแถว push token ไม่ตรงแล้ว (มากกว่า 0 = มีกล้องค้าง slot เก่า)
- **ตัวเลขต้องอ่านจากโปรเซสที่รับจริง:** `/face-push` ที่ token ค้างวิ่งเข้า **lpr-receiver** ไม่ใช่ api-server ·
  แถวบน Health รวมยอดทั้งสองโปรเซส (lpr-receiver ส่งผ่าน `/healthz`) — ถ้าอ่านจาก api-server อย่างเดียวจะเห็น 0 ตลอด
- **แก้แล้ว 2 ต.ค.:** ล้าง slot 2 (ใส่รูปของ slot ว่างของกล้องเอง) + ออก token ใหม่ + repoint slot 1 ครบ 4 ตัว
- **ห้ามพิมพ์ URL ของ slot ออกมาดิบ ๆ:** token เป็น UUID มีขีด — regex ปิดบัง `[A-Za-z0-9]*` หยุดที่ขีดแรก
  ทำให้ token จริงหลุดเกือบทั้งตัว (เกิดจริงในวันที่ตรวจเหตุนี้) · ปิดบังด้วย `[A-Za-z0-9-]*` หรือไม่พิมพ์ url เลย

### #221 — `license_plates` ไม่เคยถูก vacuum เลย ⇒ index-only scan ทุกตัวต้องอ่าน heap (2026-10-05)

- **อาการ:** สร้าง covering index แล้ว planner ใช้ `Index Only Scan` จริง แต่ `Heap Fetches` เท่ากับจำนวนแถว
  (helmet-top 7 วัน 332,357/357,642 · นับ LPR 305,397/305,862) ⇒ เร็วขึ้นแทบไม่ได้
- **ต้นเหตุ:** `pg_stat_user_tables.last_vacuum` / `last_autovacuum` ว่างทั้งคู่ · ตารางมีแต่ insert ไม่มี update/delete
  เกณฑ์ vacuum ตาม insert ค่าเริ่มต้น `0.2 × 56 ล้านแถว ≈ 11 ล้าน` ไม่เคยถึง ⇒ visibility map ว่างตลอด
- **แก้:** `autovacuum_vacuum_insert_scale_factor = 0.01` (migration 251) + `VACUUM (ANALYZE, PARALLEL 0)` หนึ่งรอบ 28.8 วิ
  ผล: นับ LPR 3 กล้อง 3 วัน 6.2 วิ → 22.7 ms (Heap Fetches 0) · helmet-top 7 วัน 23.4 วิ → 1.4 วิ
- **VACUUM แบบขนานล้มด้วย shm:** `could not resize shared memory segment … No space left on device` —
  ขอ 1,073,779,520 bytes ตาม `maintenance_work_mem=1GB` แต่ /dev/shm ของ container = 1 GiB พอดี ·
  ใช้ `PARALLEL 0` (หน่วยความจำของโปรเซสเอง) · autovacuum ไม่ขนานจึงไม่โดน
- **บทเรียน:** ตารางที่ insert อย่างเดียวและใหญ่มาก ต้องตั้ง insert scale factor เอง · ก่อนสรุปว่า covering index
  "ไม่ช่วย" ให้ดู `Heap Fetches` และ `last_autovacuum` ก่อน

### #222 — `appearances.detected_at` ไม่ใช่เวลาเกิดเหตุ · และสูตรเร็วกว่าบนกระดาษอาจช้ากว่าจริง 25 เท่า (2026-10-06)

- **detected_at = เวลาบันทึกเข้าระบบ** ต่างจาก `events.event_time` ทุกแถว (4 ต.ค. 184,436 แถว ต่างสูงสุด 74 นาที ·
  ส่งย้อนหลังได้หลายวัน) — ห้ามใช้กรองช่วงแทน event_time · migration 255 เพิ่ม `appearances.event_time`
  + `rj_*` 4 ตัว (trigger BEFORE INSERT ค้น events ด้วย id) · backfill 8,938,745 แถวใน 13 นาที
  (`scripts/backfill-appearances-event-time.js` ทำทีละ 6 ชม. · ขั้นค้นนอกช่วงบังคับ nested loop)
  ผล: /api/appearances/stats 7 วัน 76 วิ → 4.3 วิ · เพดานช่วง 2 → 31 วัน · เทียบ md5 ทุกคอลัมน์ทุกแถวตรงกัน
- **vec_dot (ค้นหาใบหน้า Lab Test):** นิพจน์ SQL 512 พจน์ `a[1]*b[1]+…` inline ได้และตรงทุกไบต์ แต่ **ช้ากว่า
  PL/pgSQL 25 เท่า** (detoast array ทุก subscript) · ตัวที่ช่วยจริงคือ `COST 10000` ให้ planner ยอมทำขนาน
  (migration 254 · 1 วัน 5.3 → 1.6 วิ) — วัดของจริงก่อนเชื่อสูตรที่ "ควรเร็วกว่า"

### #223 — Checklist ก่อนเขียน query ใหม่บนตารางใหญ่ (preventive P4 · 2026-10-06)

รอบปรับความเร็ว ต.ค. 2569 (GOTCHAS #215–#222) เจอต้นเหตุซ้ำ ๆ ไม่กี่แบบ — ตรวจทุกข้อก่อน commit:

1. **มีขอบเวลาเสมอ** บนคอลัมน์ที่มี index (`events.event_time` · `license_plates.detected_at` ·
   `appearances.event_time` · `face_embeddings.event_time`) · `received_at` / `detected_at` ของ appearances
   **ไม่ใช่** เวลาเกิดเหตุ · ไม่ส่ง from = มีค่าเริ่มต้นหรือ 400 · `npm run check:events` บังคับให้
2. **ถามตารางสรุปก่อน** (`event_kpi_hourly` · `lpr_hourly_stats` · `lpr_dim_daily` · `traffic_hourly_stats`)
   ส่วนที่บวกได้อ่านถังเต็ม + ขอบสด (`noreadSplit` / `daySplit` / `KPI_LIVE_EDGE`) · COUNT DISTINCT บวกข้ามช่วงไม่ได้
3. **EXPLAIN (ANALYZE, BUFFERS)** ดู `Heap Fetches` และ `read=` ไม่ใช่แค่เวลา · รันสองรอบ (เย็น/อุ่น) สลับลำดับ
4. **เปลี่ยนแหล่งตัวเลข = เทียบความเท่ากัน** ใน REPEATABLE READ snapshot เดียวกัน (md5 ของทุกแถว) ก่อนสลับ
5. **ตารางใหญ่ที่มีแต่ insert** ต้องตั้ง `autovacuum_vacuum_insert_scale_factor` / `analyze_scale_factor` เอง (#221)
6. **ฟังก์ชันใน WHERE/SELECT ต่อแถว** ต้องตั้ง COST ให้ใกล้จริง ไม่งั้นไม่ทำขนาน (#222 vec_dot)
7. ยามรายวัน `helpers/perfWatch.js` (18:25) จะร้องถ้าพลาด — แต่ข้อ 1–6 คือกันไม่ให้ต้องร้อง
8. **ขอบสดสองข้างห้ามรวมด้วย `x < A OR x >= B`** เมื่อขอบกว้าง (เช่นขอบวัน) แยกเป็น UNION ALL — ดู #225
9. **ตัวกรองแบบ "ตัดออก" (`<> ALL`, `NOT LIKE`, `NOT IN`) ใช้ index ไม่ได้** — ถ้ามันตัดแถวส่วนใหญ่ทิ้ง ต้องมี partial index ที่ predicate ตรงตัวอักษรกับ WHERE (ค่าคงที่ ไม่ใช่ `$n`) — ดู #227

### #224 — helper SQL ร่วมเปลี่ยนคอลัมน์ที่อ่าน แต่ temp table ที่ป้อนให้มันไม่เปลี่ยนตาม → 500 เงียบ 18 วัน (2026-10-06)

- **อาการ:** หน้ารายงาน › ป้ายทะเบียน (`/api/stats/lpr/report`) ตอบ 500 ทุกครั้ง 18 ก.ย.–6 ต.ค.
  `column "plate_identified" does not exist` · ผู้ใช้จริงโดน แต่ไม่มีใครรายงาน · รูป/PDF รายงาน LPR ออกเป็นศูนย์ทั้งหน้า
  เพราะ `renderLprReportImage` มีแค่ `if (r.ok)` ไม่มี log
- **ต้นเหตุ:** `798b6c53` เปลี่ยน `helmetCriteria.evidenceSql()` ไปอ่านคอลัมน์ที่ตรึงตอน INSERT · ผู้เรียกที่อ่านจากตารางจริง
  ไม่เป็นไร แต่ `_lpr_report_base` (temp table) เลือกคอลัมน์เองแล้วไม่มีคอลัมน์ใหม่ · เทสต์ไม่จับเพราะไม่มีตัวไหนรัน SQL นี้
- **แก้:** เพิ่ม `lp.plate_identified` เข้า temp table + เทสต์ `lpr-report-temp-columns` เทียบคอลัมน์ที่ `evidenceSql('')` อ่าน ·
  renderer เตือนเมื่อ API ไม่ ok
- **บทเรียน:** เปลี่ยน helper SQL ที่คืน *ชิ้นส่วน* ของ WHERE ให้ grep ผู้เรียกที่ prefix ว่าง (`''`) — พวกนั้นอ่านจาก temp table / CTE ·
  ทางที่เจอเร็วที่สุดคือ crawler ไล่ทุกหน้าทุกแท็บแล้วดู non-2xx

### #225 — `x < A OR x >= B` บนขอบกว้าง planner สแกนช่วงเต็มแล้วไล่ทิ้งตรงกลาง (2026-10-06)

- **อาการ:** สถิติ LPR ช่วง custom ส่วนมิติ (จังหวัด/ประเภท/สี/ยี่ห้อ) อ่าน `lpr_dim_daily` + ขอบสด แต่ขอบสดเขียนเป็น
  `detected_at >= from AND detected_at <= to AND (detected_at < A OR detected_at >= B)` · ขอบวัน (≤ 1 วันต่อข้าง)
  planner เลือก index-only scan ช่วงเต็ม [from, to] + filter — 30 วันตัดทิ้ง 24 ล้านแถว 3.7 วิ (pgss ช้าสุด 70 วิ)
- **ขอบแคบ (ถังชั่วโมง)** planner ใช้ BitmapOr ได้ เร็วทั้งสองแบบ — noread ที่ขอบแคบเสมอ OR เร็วกว่า (100 vs 259 ms) จึงคงไว้
- **แก้:** `lpLive` / `evLive` = subquery `UNION ALL` สองช่วง alias เดิม → 158 ms · md5 ตรงกันใน snapshot เดียวกัน ·
  เทสต์กันไม่ให้กลับไปใช้ OR บน license_plates
- **บทเรียน:** แผนเปลี่ยนตาม *ความกว้าง* ของขอบ — EXPLAIN ด้วยขอบแบบที่แย่ที่สุด (วัน ไม่ใช่ชั่วโมง) ก่อนสรุปว่าเร็ว

### #226 — query ที่รันตอนโหลดโมดูลรันก่อน migration ของ boot เดียวกัน → คอลัมน์ใหม่ยังไม่มี (2026-10-14)

- **อาการ:** deploy migration 261 (`lpr_watchlist_groups.site_id`) แล้ว log ขึ้น `[lpr-watch] refresh: column g.site_id does not exist`
  ตอน 17:05:23 · ชุดป้ายเฝ้าระวังที่ใช้ยิง LINE (`_lprWatchSet` ใน api-server) ว่างจนถึงรอบถัดไป 5 นาที
  = ป้ายเฝ้าระวังไม่แจ้งเลยในช่วงนั้น (ตรวจแล้ว 17:05–17:09 ไม่มีป้ายตรงผ่าน จึงไม่มีแจ้งเตือนหลุด)
- **ต้นเหตุ:** `_refreshLprWatch()` ถูกเรียกระดับบนสุดของ `api-server.js` ตอน require — migration runner (`src/migrate.js`)
  รันทีหลังในขั้น boot ของ server · query ใหม่ที่อ่านคอลัมน์ใหม่จึงล้มเฉพาะ "boot แรกหลัง deploy" ทุกเครื่อง
  และ worker ที่เป็น process แยก (`face-embed-worker` อ่าน `face_blacklist_groups.site_id`) ขึ้นก่อน api-server ได้เสมอ
  (`pm2 restart all` · เครื่องใหม่ · edge)
- **แก้:** ทั้งสองจุดถอยไปใช้ query แบบเดิมเมื่อ error (`42703 undefined_column`) = ทุกกลุ่มเป็น Global เหมือนก่อนมีคอลัมน์
  แทนที่จะปล่อยชุดว่าง · รอบถัดไป (หรือ `watchlist_changed` notify, migration 262) ได้ค่าจริง
- **บทเรียน:** โค้ดที่อ่านคอลัมน์จาก migration ใหม่ ถ้ารันตอนโหลดโมดูลหรือใน process อื่น ต้องมีทางถอยที่ "ทำงานแบบเดิม"
  ไม่ใช่ "ว่าง" — โดยเฉพาะเส้นแจ้งเตือน ซึ่งการเงียบคือความเสียหายที่ไม่มีใครเห็น

### #227 — หน้าเหตุการณ์อ่านล้านแถวเพื่อแสดง 2.4% · ไซต์ที่มีแต่ป้าย+ใบหน้าอ่านล้านแถวเพื่อได้ 0 (2026-10-16)

- **อาการ:** perfWatch เตือน LINE "ช้าลง 2.1 วิ (ปกติ 0.9 วิ) × 9 ครั้ง" บน `SELECT count(*) ... FROM events` ของหน้าเหตุการณ์ ·
  `phuket-admin` (Site Admin ของ hkt ที่เริ่มใช้วันนั้น) เปิดหน้าเหตุการณ์รอ 2.1–4.6 วิทุกครั้ง และหน้าว่างเสมอ
- **ต้นเหตุ:** หน้าเหตุการณ์ส่ง `exclude_types` (ป้ายทะเบียน + ใบหน้า) ซึ่งเป็น 97.6% ของแถว (24 ชม.: 1,036,426 แถว แสดงจริง 24,728) ·
  `event_type <> ALL($n)` ใช้ index ไม่ได้ planner จึงอ่านด้วย index เวลาแล้วทิ้งเกือบทั้งหมด · hkt มีแต่ anprAlarm 326k + FaceCapture 156k
  → อ่านทั้งล้านแถว (1.1 ล้าน buffer) เพื่อได้ 0 แถว · ก่อนมี Site Admin ภูเก็ต เส้นนี้แทบไม่มีคนเรียก ค่าเฉลี่ยจึงดูปกติ
- **แก้:** partial index `idx_events_page_time` (event_time DESC) INCLUDE (camera_id, event_type, event_state, has_snapshot)
  เฉพาะแถวที่หน้าเหตุการณ์แสดง (migration 264 · สร้าง CONCURRENTLY ทีละ partition แล้ว ATTACH · 199 MB) · route เติมเงื่อนไขค่าคงที่
  `helpers/eventsPageIndex.js` ซ้ำกับพารามิเตอร์เดิมเมื่อรายการตัดออกครอบชุดของ index → Index Only Scan 47 ms · API hkt 0.04 วิ ·
  ผลลัพธ์เทียบก่อน/หลังตรงกันทุกชุด
- **บทเรียน:** (1) ตัวกรองแบบตัดออกที่ตัดแถวส่วนใหญ่ทิ้ง = สแกนเต็มช่วงเสมอ · (2) partial index ใช้ได้เฉพาะเมื่อ WHERE มีเงื่อนไขตรงตัวอักษร
  เป็นค่าคงที่ — `$n` ทำให้ planner พิสูจน์ไม่ได้ · ล็อกด้วย `test/events-page-index.test.js` · (3) ผู้ใช้กลุ่มใหม่ (role/ไซต์ใหม่) เปิดเส้นทาง query
  ที่แทบไม่เคยมีคนเรียก — หลังเปิดสิทธิ์ใหม่ให้ดู `[slow-req]` ของผู้ใช้นั้นในวันแรก

### #228 — งานวนทีละกล้องที่ edge ต้องกระจายเวลาเสมอ: heartbeat 50 ข้อความในวินาทีเดียวทำให้ broker ตัดสาย "Protocol error"

- **อาการ:** bridge ของ hdy/hkt หลุดซ้ำ ๆ (hdy 71 ครั้ง/วัน, hkt 23) ที่ central log ขึ้น `disconnected: Protocol error.` ตรงวินาทีเดิมทุกครั้ง (hdy :18–:19 = 218 จาก ~270 ครั้ง · hkt :12) · เริ่มวันเดียวกับที่ย้าย central จาก EMQX มา Mosquitto (28 ก.ย.) ที่ hdy กระโดดจาก ~5 เป็น ~80 ครั้ง/วัน
- **ต้นเหตุ:** `edge-config-agent.js` ส่ง `Device/heartbeat` ของทุกกล้องในรอบเดียวกันทุก 60 วิ (~50 ข้อความใน ~90 ms ที่ hdy · ดักจริง 17 ต.ค. 21:31:19 และ 21:33:19 ตรงกับ Protocol error สองครั้งพอดี) · ชื่อหัวข้อถูกกฎ ขนาด 38 ไบต์ ⇒ ไม่ใช่ข้อความผิดรูป · เหตุผลละเอียดของ Mosquitto ไม่ลง log ที่ระดับ notice (ไม่ได้เปิด B0 จึงไม่ได้ยืนยัน 100%) · งานอื่นในไฟล์เดียวกัน (preview, sd-status) กระจายเวลาอยู่แล้ว ตัว heartbeat ตัวเดียวที่ไม่กระจาย
- **แก้:** แต่ละกล้องมีช่องเวลาประจำใน 1 นาที = sha1(id) mod 60 วิ (`heartbeatSlotMs`) — ผูกกับ id ไม่ใช่ลำดับในแผนที่ เพราะ `_config/cameras` ถูกส่งซ้ำทุกครั้งที่ bridge ต่อใหม่ ถ้าใช้ลำดับ กล้องจะย้ายช่องแล้วห่างรอบก่อนเกิน 90 วิ จน central นับว่า offline · hdy: เดิม 50 ในวินาทีเดียว → ไม่เกิน 4 · Protocol error ของ hdy 8 → 1 ต่อ 2 ชม. และวินาทีตายตัวหายหมด (`test/edge-heartbeat-stagger.test.js`)
- **บทเรียน:** (1) loop ทีละกล้อง/ทีละอุปกรณ์ที่ publish ต้องมี `setTimeout(gap*i)` หรือ slot ตาม id เสมอ ห้ามยิงทั้งก้อนพร้อมกัน (2) อาการที่เกิดตรงวินาทีเดิมซ้ำ ๆ = มีตัวตั้งเวลาอยู่ต้นทาง ให้ดักฟังวินาทีนั้นก่อนโทษเครือข่าย (3) ย้าย broker แล้ว "ของที่เคยรอด" อาจเริ่มพัง — Mosquitto เข้มกว่า EMQX
- **อีกเรื่องที่เจอพร้อมกัน (แก้แล้ว):** `bridge.js forceReconnect()` เคยตั้ง `replaying=false` ทั้งที่รอบ replay เก่ายังวน ⇒ สองรอบทับไฟล์ชุดเดียวกัน ⇒ `.replay` ค้าง ⇒ ทุกรอบหลังได้ `replayed=0/0` ทุกนาทีจน restart (hkt 17 ต.ค. คิว 4,104 ไฟล์) · ตอนนี้ใช้ `replayGen` สั่งหยุดรอบเก่า และ `replay()` คืนของค้างใน `.replay` เข้าคิวก่อนเริ่ม · ข้อมูลไม่หาย

### #229 — bridge วิ่งผ่าน Cloudflare แล้ว ISP ของไซต์พา anycast ไปยุโรป: หลุดพร้อมกันหลายไซต์ช่วงบ่าย–ค่ำ · เส้นหลักเป็น Tailscale

- **อาการ:** "session taken over" พร้อมกัน 4 ไซต์ (hkt, hdy, nrw, rmutr-v) ช่วง ~13:00–16:00 และ 19:00–23:00 ตั้งแต่ ~15 ต.ค. (17 ต.ค. 13:00: 28 ครั้ง · บ่าย 18 ต.ค. hdy 34 + hkt 34 + nrw 36 + rmutr-v 34) · กล้องเด้ง offline/online 10–30 ตัวต่อนาที · vss/bma โดนน้อยกว่ามาก · central ปกติ (netprobe ping ~6 ms, PSI 0)
- **ต้นเหตุ (วัดจริง 18 ต.ค.):** bridge ต่อ `wss://dashboard.dojojin.tech/mqtt` ทางเน็ตธรรมดาของไซต์ไปหา Cloudflare anycast ISP เป็นคนเลือกว่าไปลงศูนย์ไหน · hkt/hdy/nrw (NT, AS23969) และ rmutr-v (AS132482) ถูกพาไป CDG/MRS/MXP (TCP connect 0.17–0.36 s · hdy ล้ม 6/10 ครั้ง) ส่วน vss/bma (True) และ central (AIS) ลง BKK ~0.03 s · ข้อมูลจริงเปลี่ยนตลอดวัน (บางช่วงลง SIN/HKG) · tunnel ของ edge เองที่ใช้ SSH ต่อ bkk06/sin เสถียรเพราะวิ่งคนละทิศ (central เป็นฝ่ายเข้าหา edge)
- **แก้ (19 ต.ค.):** bridge ลองหลายเส้นทางตามลำดับใน `BRIDGE_BROKER_URLS` (`src/edge/bridgePaths.js`): ① Tailscale `mqtt://100.89.1.29:1883` (ต่อตรงในประเทศ 17–33 ms) ② `mqtt://127.0.0.1:18830` = `ssh -R` ที่ central เปิดเข้า edge (pm2 `mqtt-tunnel-<site>`) ③ wss เดิม · หลุด 30 วิ → เส้นถัดไป · probe เส้นหลักทุก 5 นาที ผ่าน 2 รอบติดถึงกลับ · ผล: บ่าย 13:00–00:40 วันถัดมา 4 ไซต์หลุด 0 ครั้ง (เมื่อวาน ~160 ครั้งช่วงเดียวกัน)
- **ต้องมีคู่กัน:** ACL tailnet `tag:edge → tag:central:1883` อย่างเดียว (พอร์ต 22 ยังบล็อก) · Mosquitto listener `100.89.1.29:1883` ในไฟล์แยก `zz-tailscale-listener.conf` + sysctl `net.ipv4.ip_nonlocal_bind=1` (ไม่งั้น Mosquitto ไม่ขึ้นเมื่อ tailscaled มาทีหลังตอนบูต แล้วทุกเส้นล่ม) · ติดตั้งด้วย `scripts/central-tailscale-listener.sh` · ห้ามประกาศ listener ซ้ำใน `vigil.conf` พอร์ตจะชน
- **เฝ้าระวัง:** ถ้าไซต์ตกไปเส้นสำรองเกิน 30 นาที LINE ถึง Dojo-mAn (`helpers/bridgePathWatch.js`)
- **บทเรียน:** (1) "หลุดพร้อมกันหลายไซต์ แต่ central ปกติ" ให้วัดว่าแต่ละไซต์ลง Cloudflare ศูนย์ไหน (`curl https://<host>/cdn-cgi/trace` ดู `colo=`) ก่อนโทษ tunnel (2) ทางเข้าดูแลระบบ (SSH) กับทางส่งข้อมูลควรเป็นคนละเส้น (3) การตัดสินใจเก่าที่ว่า "ห้ามย้าย bridge ไป Tailscale" ถูกยกเลิกโดยเจ้าของ 2026-10-18 เพราะแก้ความเสี่ยง single point of failure ด้วยเส้นสำรอง 2 ชั้น

### #230 — path ที่ลงท้าย `/` ข้าม auth ของ static: `/others/demo/<ชื่อ>/` เปิดได้โดยไม่ล็อกอิน แต่ `.../index.html` ถูกกัน

- **อาการ (2026-10-20 ตอนทำหน้าสารบัญ demo):** `curl https://dashboard.dojojin.tech/others/demo/vehiclecount/` ไม่มี session ได้ 200 หน้า demo · `.../index.html` ได้ 302 ไป login · โดน 20 โฟลเดอร์ใต้ `/others/` (demo ทุกตัว + `vigil-docs-v2/`) · ไฟล์ .js/.css/ข้อมูลข้างในยังได้ 401 หน้าจึงเปิดเป็นโครงข้อความ · ข้อมูลที่หลุดจริง: ข้อความหน้า demo + IP ภายใน `10.0.10.9` ในหน้า HCP-integration · ไม่มีรหัสผ่าน/token
- **ต้นเหตุ:** middleware auth ของ static ใน `api-server.js` นับว่าเป็น "static asset ต้องล็อกอิน" เฉพาะ `/` กับ path ที่มีนามสกุล (`.html|.js|...`) · path โฟลเดอร์ไม่มีนามสกุล จึงผ่านไปถึง `express.static` ซึ่งเสิร์ฟ `index.html` ของโฟลเดอร์ให้ · ช่องนี้อยู่มาตั้งแต่มี mount `/others` แบบ `index: 'index.html'`
- **แก้:** `isGatedStaticPath()` นับ path ที่ลงท้าย `/` ด้วย · ตรวจทั้ง GET และ HEAD · ผู้ที่ยังไม่ล็อกอินและเปิดโฟลเดอร์จะถูกพาไปหน้า login แทน 401 · `test/static-dir-auth.test.js` ดึงฟังก์ชันจริงมารัน (ตกกับโค้ดเดิม ผ่านกับโค้ดใหม่)
- **บทเรียน:** (1) ตรวจ auth ของ static ต้องคิดจาก "อะไรที่ express.static เสิร์ฟได้" ไม่ใช่ "ไฟล์นามสกุลอะไร" — โฟลเดอร์ที่มี index คือไฟล์ HTML เหมือนกัน (2) ทดสอบหน้าที่ต้องล็อกอินให้ยิงทั้ง `/x/` และ `/x/index.html` แบบไม่มี cookie (3) คู่กับ GOTCHAS เรื่อง path traversal ของ `/pub/img/` (2026-08-24) — ทั้งสองเคสเกิดจากการตัดสิน "สาธารณะหรือไม่" ด้วยรูปร่างของ path ดิบ

### #231 — slow log ของ Postgres หายเงียบ ๆ เดือนกว่า: ไฟล์ log ของ container เสียหลังเครื่องรีบูต

- **อาการ (พบ 2026-10-21 ตอนตามหาคิวรี 41 วิ):** `docker logs vigil-postgres` ไม่มีบรรทัดใหม่หลัง 12 ก.ย. ทั้งที่ `log_min_duration_statement = 2s` ยังเปิด · ทดสอบ `pg_sleep(2.2)` ก็ไม่ขึ้น · dockerd บันทึก `Error decoding log file: invalid character '\x00'`
- **ต้นเหตุ:** เครื่องรีบูต 2026-09-22 ระหว่างเขียนไฟล์ json log ของ container → มี byte ศูนย์ปน → `docker logs` อ่านต่อจากจุดนั้นไม่ได้ · driver json-file ไม่ได้ตั้ง max-size ไฟล์จึงไม่เคยหมุนออกจากจุดเสีย
- **แก้:** ซ่อมด้วย `sudo truncate -s 0 <LogPath>` (ไม่ต้อง restart DB) · perfWatch ตรวจทุกวันว่า log 6 ชม.ล่าสุดมีบรรทัด ถ้า 0 → LINE (`pgLogLines` ใน `helpers/perfWatch.js`) · ระยะยาว: ย้ายไป `logging_collector` เขียนไฟล์ของ Postgres เอง (ต้อง restart DB ในรอบบำรุงรักษา — `mqtt-subscriber` เป็น QoS 0 เหตุการณ์ช่วงที่ DB ดับจะหาย ต้องวางขั้นตอนก่อน)
- **บทเรียน:** เครื่องมือเฝ้าระวังต้องมีตัวเฝ้าเครื่องมือด้วย · "ไม่มี log" ต้องตีความว่า "เครื่องมือเสีย" ก่อน "ไม่มีปัญหา"

### #232 — นับผลค้นหาป้ายทะเบียนแบบไม่มีช่วงเวลา = นับทั้งตาราง และตัวที่ถูกทิ้งยังนับต่อบน DB

- **อาการ (2026-10-21):** perfWatch เตือน "query ใหม่ที่ช้า 5.7 วิ × 11" `SELECT count(*) FROM license_plates lp` · `[slow-req]` มี `/api/lpr?...count=only` 17 ครั้ง ครั้งละ 8–12 วิ · 16:57–16:59 เปลี่ยนตัวกรองถี่ ๆ ทำให้ซ้อนกัน 10 ตัว หน้าอื่นช้าตาม (สถิติใบหน้า 5.7 วิ · ค้นบุคคล 7 วิ)
- **ต้นเหตุ:** (1) หน้าค้นหา LPR ยิงนับจริงแยกหลังตารางขึ้น (`count=only` เพดาน 12 วิ) ไม่มีช่วงเวลา = count ทั้งตาราง 67 ล้านแถว (2) หน้าเว็บทิ้งผลของตัวเก่าแต่ไม่ยกเลิกคำขอ และเซิร์ฟเวอร์ไม่ยกเลิกคิวรีเมื่อสายขาด — reproduce: ตัดคำขอที่ 1 วิ คิวรียังรันต่ออีก 5.5 วิ
- **แก้:** (1) หน้าเว็บ abort คำขอนับเก่า + เซิร์ฟเวอร์ `pg_cancel_backend` เมื่อ `res` ปิดก่อนตอบ (ถอด listener ก่อนคืน connection — ไม่งั้นไปยกเลิกคิวรีของคนอื่น) → ตัดแล้วหายจาก DB ทันที (2) กรองแค่ กล้อง/ไซต์/เวลา → ยอดจาก `lpr_hourly_stats` + นับสดเฉพาะเศษหัว/ท้าย (`helpers/lprRollupCount.js` · ตรวจ snapshot เดียวกัน 5 แบบ ตรงทุกหลัก · ไซต์ hkt 7.3 วิ → 0.07 วิ) (3) ตัวกรองอื่นที่ไม่มีช่วงเวลา: เพดาน 3 วิ แทน 12 วิ
- **บทเรียน:** (1) ทุกคิวรีที่ผู้ใช้ "ทิ้ง" ได้ ต้องยกเลิกได้ถึง DB (2) ตารางสรุปที่มีอยู่แล้วตอบคำถาม "จำนวน" ได้เกือบทั้งหมด — ใช้ก่อนนับสด (3) ชั่วโมงแรกต้องนับสดเพราะ retention ลบกลางชั่วโมงแต่ไม่ลบตารางสรุป

### #233 — reconcile ของสถิติรายวันตัดขอบ "ย้อนหลัง 24 ชม." แต่ตัวสรุปลบ "ทั้งวัน" ที่แตะ: รอบกลางล้ม = วันค้างครึ่งวัน

- **อาการ (repro 2026-10-22 ใน transaction ที่ ROLLBACK):** รอบที่ `until` ตกกลางเมื่อวานทำงาน แล้วรอบถัดไปล้ม → ยอดจังหวัดเมื่อวานใน `lpr_dim_daily` เหลือ 467,684 จากจริง 823,854 และค้างจนถึง reconcile คืนถัดไป (รอบ 15 นาทีแตะแค่วันนี้)
- **ต้นเหตุ:** `refreshLprDims()` (และ `refreshAppearanceDims()`) ลบทุกแถวของวันไทยที่แตะแล้วเขียนใหม่จากหน้าต่าง `[since, until)` · ลูป reconcile ใช้ `since = now − d×24h` / `until = now − (d−1)×24h` ⇒ `until` ตกกลางวันเสมอ · ปกติรอบถัดไปเขียนวันนั้นใหม่จนครบ จึงไม่เคยเห็น แต่เคยมีช่วงที่ reconcile ล้มทุกคืนจริง (statement timeout 2026-08)
- **แก้:** `thaiDayWindows(days)` คืนช่วง [ต้นวันไทย, ต้นวันถัดไป) ต่อกันไม่มีรู ใช้กับทั้งลูปป้ายและลูปสถิติคน · รอบที่ล้มไม่แตะวันอื่น (ตรวจจำลองรอบกลางล้ม: ทุกวันยังครบ) · แลกกับงานเพิ่มหนึ่งหน้าต่าง (~34 วิ ตอน 05:00)
- **บทเรียน:** ตัวสรุปที่ "ลบทั้งหน่วยแล้วเขียนใหม่" ต้องรับหน้าต่างที่ตรงขอบหน่วยเท่านั้น — ถ้าทำไม่ได้ ให้ upsert อย่างเดียว (แบบ `traffic_daily_stats`)

### #234 — ผู้ใช้ทิ้งหน้าแล้ว คิวรีหนักยังรันต่อบน DB จนจบหรือชนเพดาน 120 วิ: ทำให้ "ช้าทุกวัน" ลามข้ามหน้า

- **อาการ (2026-10-22):** perfWatch: ค้นตามรูปแบบ 62.7 วิ × 14 แต่ `[slow-req]` ไม่เห็นเลย (เบราว์เซอร์ตัดเองที่ 30 วิ ก่อนตอบ) · slow-req 6 ก.ย.–22 ต.ค. ที่ >60 วิ: `appearances/stats` 51, `lpr/stats` 39
- **repro (2026-10-23):** ตัด `/api/appearances/stats` ที่ 2 วิ → `CREATE TEMP TABLE _app_stats_filtered` ยังรันต่อใน `pg_stat_activity` · หน้าเว็บตัดเองทุกคำขอที่ 30 วิ (`dashboard.js` ตัวห่อ fetch) และเปลี่ยนหน้าก็ไม่ยกเลิกอะไร
- **แก้ (ระยะ A):** `src/helpers/requestDb.js` — middleware ผูกทุก GET ไว้ใน AsyncLocalStorage · ห่อ `pool.connect` ของ `pool`/`statsPool` จด pid ที่คำขอยืม (`pool.query` ก็ผ่าน connect) · `res` ปิดก่อนตอบ → `pg_cancel_backend` เฉพาะ connection ที่ยืมอยู่ตอนนั้น · connection ที่ถูกยกเลิกคืนแบบมี error ให้ pool ทิ้ง · หน้าเว็บยกเลิก GET `/api/*` ของหน้าเดิมตอน `showPage` เปลี่ยนหน้า (เปิดใช้หลังบูต · ไม่รวมดาวน์โหลด/ส่งออก/backups) · ตัวยกเลิกเฉพาะของ `lpr-list` (#232) ถอดออก ใช้ตัวกลางแทน · log `[req-cancel]` · ตรวจกับ Postgres จริง: ตัดที่ 1 วิ คิวรีหายภายใน 1.8 วิ · pool เต็ม 2/2 ด้วยคำขอที่ถูกทิ้ง → หายทั้งคู่ใน 2.5 วิ คำขอที่ 3 ได้คำตอบ
- **กับดักที่เจอระหว่างทำ (repro จริงทั้งหมด):** (1) ส่งคำสั่งยกเลิกผ่าน pool เดียวกัน + รอคำสั่งยกเลิกก่อนคืน connection = **pool ล็อกตาย** ตอน pool เต็มด้วยคำขอที่ถูกทิ้ง (คำขอที่ 3 ไม่ได้คำตอบใน 20 วิ) → คำสั่งยกเลิกวิ่งบน pool ข้าง max 1 และไม่รอ (2) สร้าง pool ข้างด้วย `{ ...pool.options }` แล้ว **ยกเลิกล้มเงียบทุกครั้ง** — pg-pool ตั้ง `password` เป็น non-enumerable การ spread จึงทำหาย ต้องใส่ `password: o.password` เอง (3) AsyncLocalStorage ตามไปถึงงานที่คำขอเริ่มไว้: single-flight ของ `ttlCache`/`heavyRunner` รันในบริบทของคนแรก → คนแรกทิ้ง = ยกเลิกงานของทุกคนที่รอ · แต่ตัดขาดจากคำขอเลย (รุ่นแรก `b07ca2ce`) ก็ไม่ยกเลิกอะไรสักอย่าง — ตรวจหลัง deploy: `/api/appearances/stats` อยู่หลัง ttlCache คิวรีรันต่อจนจบ และ route หนักเกือบทั้งหมดอยู่หลัง ttlCache/heavyRunner → `flight()`: งานที่แชร์มีบริบทของตัวเอง ยกเลิกเมื่อผู้รอ *คนสุดท้าย* ทิ้ง · ผู้รอที่ไม่ใช่ GET ตรึงไว้ไม่ยกเลิก (ตรวจจริง: 2 คนรอ คนแรกทิ้ง → ยังรัน · ทิ้งครบ → หาย · คนใหม่มาหลังยกเลิก → ได้งานใหม่ 200) · ผู้รอเป็นศูนย์แล้วรอ 5 วิก่อนยกเลิก (`flight.graceMs`) — refresh/สลับหน้าไปกลับต่องานเดิมได้ (ตรวจจริง: refresh ที่ 2 วิ ได้คำตอบที่ 9.0 วิ ไม่ใช่เริ่มใหม่ 11 วิ) · (4) หน้าเว็บเคยตัด GET เองที่ 30 วิ: เดิมคิวรียังรันจนเสร็จแล้วเติม cache ให้รอบถัดไป แต่เมื่อยกเลิกได้ หน้าที่ต้องใช้เกิน 30 วิจะไม่มีวันโหลดขึ้น (ต.ค. มีคำขอของผู้ใช้เกิน 30 วิ ~260 ครั้ง) → GET รอได้ 125 วิ เกินเพดาน server 120 วิ · และไม่ยกเลิกสิ่งที่ยืม "หลัง" ผู้ใช้ทิ้ง (timer ที่เริ่มตอน GET จะโดนยกเลิกตลอดไป)
- **บทเรียน:** (1) ยกเลิกต้องทำที่จุดเดียวใต้ทุก route ไม่ใช่ทีละ route (2) ห้ามคืน connection ที่ส่ง cancel ไปแล้วเข้า pool และห้ามให้คำสั่งยกเลิกแย่ง pool ที่มันพยายามปลด (3) งานที่แชร์ข้ามคำขอต้องมีบริบทของตัวเอง นับผู้รอ แล้วยกเลิกเมื่อไม่มีใครรอ (4) ตรวจกับ route จริงหลัง deploy เสมอ — harness ที่ไม่ผ่าน cache ไม่เห็นปัญหานี้ (5) ไม่แตะ POST/งานเบื้องหลัง — งานเขียนที่ถูกตัดกลางทางอันตรายกว่าคิวรีที่วิ่งเปล่า

### #235 — หน้า Snapshots เลือกไซต์ + ช่วงยาว ค้าง 49 วิ เพื่อคืนผล 0 แถว: index มี camera_id แค่เป็น INCLUDE

- **อาการ (2026-10-24):** หน้า Snapshots ไซต์ภูเก็ต + "This month" ค้าง "Loading…" · `[slow-req]` 49.3 วิ (cache เย็น) / 8.2 / 8.8 วิ ยิงซ้อน 3 ตัว · ผลลัพธ์จริง 0 แถว
- **ต้นเหตุ:** (1) `group=burst` ดึง `e.*` ทั้งแถว · planner เดิน `idx_events_page_time` (#264) ตามเวลาทั้งเดือน แล้วเปิดแถวจริงทีละแถวเพื่อเช็ค `camera_id`/`has_snapshot` ซึ่งเป็นแค่ INCLUDE (PG 16 กรองก่อนเปิดแถวไม่ได้) → อ่านดิสก์ 368,063 block ≈ 2.9 GB เพื่อหาของที่ไม่มี (ภูเก็ตมี snapshot 12.5 ล้านแถว/เดือน แต่เป็นป้าย/ใบหน้าที่หน้านี้ตัดออกทั้งหมด) (2) planner ประเมินว่ากล้องชุดนั้นมี ~19,000 แถว — **สร้าง index ใหม่แล้ว planner ก็ยังไม่เลือก** (3) `loadSnapshots()` ไม่ยกเลิกคำขอเก่าของตัวเอง กดซ้ำ = คิวรีซ้อน
- **แก้:** `idx_events_snap_cam_time (camera_id, event_time DESC) WHERE has_snapshot AND <เงื่อนไขเดียวกับ #264>` (migration 278 · central สร้าง CONCURRENTLY ทีละ partition รวม ~100 MB 4.5 นาที) + ทาง burst ที่เลือกกล้องเป็นชุดเขียนเป็น `unnest(กล้อง) CROSS JOIN LATERAL (... camera_id = cam.id ORDER BY event_time DESC LIMIT 50000)` · ตัวแทน burst เลือกด้วย `ORDER BY event_time, id` (เดิมเวลาเท่ากันสุ่มรูป — คิวรีเดิมเทียบกับตัวเองยังไม่ตรง) · หน้าเว็บ `fetch(..., { supersede: 'snapshots' })` ยกเลิกคำขอเก่า
- **ผล (เดือนนี้ ต่อไซต์):** ภูเก็ต 13.7–49 วิ → 0.45 · หาดใหญ่ 17 → 1.1 · RMUTR-V 4.4 → 4.1 · VSS 0.29 → 0.34 · ผลเหมือนเดิมทุกแถว (เทียบใน REPEATABLE READ snapshot เดียวกัน 5 ไซต์: burst + ตัวแทน + ยอดรวมตรงกันหมด)
- **บทเรียน:** (1) INCLUDE ช่วยได้เฉพาะ Index Only Scan — คิวรีที่ต้องใช้ทั้งแถว กรองด้วย INCLUDE ไม่ได้ (2) ตรวจ EXPLAIN หลังสร้าง index เสมอ — มี index ไม่ได้แปลว่า planner จะใช้ (3) "ไม่มีข้อมูล" คือกรณีที่แพงที่สุดของการเดินตามเวลา + LIMIT เพราะต้องเดินจนหมดช่วง

### #236 — ไซต์ที่ไม่มีข้อมูลประเภทนั้น: หน้าเหตุการณ์ / ใบหน้า เดินตามเวลาทั้งเดือนเพื่อคืน 0 แถว (คลาสเดียวกับ #235)

- **พบจากตรวจคิวรีทุกหน้า (2026-10-25):** หน้าเหตุการณ์ ภูเก็ต "เดือนนี้" 49 วิ (อ่าน 3.8 GB) · นราธิวาส 46 วิ · ใบหน้า นราธิวาส / RMUTR-V เดือนนี้ ชนเพดาน 120 วิ → 500 · ค้นใบหน้า VSS 38–43 วิ
- **ต้นเหตุ:** ภูเก็ตไม่มี event ที่หน้าเหตุการณ์แสดง (ป้าย/ใบหน้าล้วน 3.58 ล้านแถว/เดือน) · นราธิวาส/RMUTR-V ไม่มีใบหน้าเลย · planner ประเมินว่าชุดกล้องมีของหลายหมื่นแถว จึงเดิน index เวลาแล้วเปิดแถวจริงเช็คกล้องทีละแถวจนสุดช่วง
- **แก้:** `helpers/perCameraScan.js` (ตัวกลางเดียว ใช้ทั้ง events ทางปกติ, burst, faces) + migration 279 `idx_events_page_cam_time` / `idx_events_face_cam_time` (camera_id, event_time DESC) แบบเลือกเฉพาะแถวที่หน้านั้นใช้ — ไซต์ที่ไม่มีของ = 0 รายการ · central สร้าง CONCURRENTLY 9 นาที (~110 MB + ~500 MB) · แถวเวลาเท่ากันเรียงด้วย id ต่อท้าย (LIMIT ต่อกล้องของหน้า 1 กับ 2 ไม่เท่ากัน ไม่ตัดสินแล้วแถวตรงขอบหน้าอาจซ้ำ/หาย)
- **ผล (เดือนนี้):** เหตุการณ์ ภูเก็ต 49 วิ → 3 ms · นราธิวาส 46 วิ → 1 ms · ค้นใบหน้า นราธิวาส/RMUTR-V ≥120 วิ → 3–4 ms · VSS 43 วิ → 7 ms · นับใบหน้า หาดใหญ่ 17 → 2 วิ · ผลเหมือนเดิมทุกแถวใน REPEATABLE READ (ต่างเฉพาะแถวเวลาเท่ากันที่ขอบหน้า) · คิวรีเดิมที่ไม่จบใน 120 วิ เทียบด้วย SQL ตัวเดิม + `enable_indexscan = off`
- **ไม่ได้ใช้ทีละกล้อง:** คิวรีนับของหน้าเหตุการณ์ — เดิมเร็วทุกไซต์อยู่แล้ว (≤0.85 วิ) ทีละกล้องกลับช้าลงในไซต์ข้อมูลแน่น (หาดใหญ่ 0.2 → 1.0 วิ) · ทุกการเปลี่ยนแปลงลักษณะนี้ต้องวัดไซต์ข้อมูลแน่นด้วย ไม่ใช่แค่ไซต์ที่ว่าง
- **บทเรียน:** ไซต์ที่ "ไม่มีข้อมูลประเภทนั้น" คือกรณีที่แพงที่สุดของการเดินตามเวลา + LIMIT · ตรวจหน้าใหม่ต้องวัดทุกไซต์แยกกัน รวมไซต์ที่ว่าง

### #237 — event_kpi_hourly ขาดถาวรเมื่อ event มาถึงช้าเกิน 3 ชม.: ไม่มี reconcile เลย

- **พบระหว่างแก้ heatmap แผนที่ (2026-10-25):** เทียบตารางสรุปกับนับดิบรายวัน — 23 ต.ค. ขาด 26,301 (2.7% ของวัน) · 24 ต.ค. 15,959 · 22 ต.ค. 8,789 (ทั้งหมด C9-KAR-SB-04) · 19 ต.ค. 7,749 (C40-THL-SB-18)
- **ต้นเหตุ:** refresher ย้อนดูแค่ 3 ชม. ทุก 5 นาที และไม่มีรอบเก็บตก (ตารางสรุปตัวอื่นมี reconcile 05:00 แล้ว) · C9-KAR-SB-04 ข้อมูลไม่เข้า central 22 ต.ค. 14:49 – 24 ต.ค. 14:00 แล้วของค้างทยอยมาถึง 24 ต.ค. 14:00 – 25 ต.ค. 01:00 (ช้า 22–40 ชม.) → ตารางดิบครบ แต่ตารางสรุปไม่เคยนับ · ตารางนี้ใช้ในหน้าสรุปผู้บริหาร (วันนี้/เมื่อวาน) และ heatmap แผนที่
- **แก้:** reconcile วันละครั้ง 05:00 ทีละวันไทยย้อนหลังเท่าอายุตาราง (`refreshRange` · ~22 วิ/วัน · 7 วัน ~2.5 นาที) จำวันที่ทำแล้วใน system_settings `kpi_stats_reconciled_day` · ตรวจใน transaction ที่ ROLLBACK: หลัง reconcile ตรงกับนับดิบทุกหลักทั้ง 7 วัน
- **กับดักที่เจอตอนทดสอบ:** ตัวลบแถวกำพร้าใช้เวลาของ Node เป็นเส้นแบ่ง แต่ updated_at = NOW() ของ Postgres — ใน transaction NOW() คือเวลาเริ่ม transaction (เก่ากว่า) ⇒ ทุกแถวดูเป็นกำพร้าแล้ว**ถูกลบทั้งตาราง** · แก้ให้ใช้ `SELECT now()` ของ Postgres เป็นเส้นแบ่ง (sweepOrphans เดิมยังใช้เวลาของ Node — ปลอดภัยเพราะรันนอก transaction แต่เปราะ)
- **heatmap แผนที่ (`/api/heatmap`) อ่านตารางนี้แล้ว:** ชั่วโมงเต็มจากตารางสรุป + นับดิบเฉพาะเศษหัว/ท้าย · 24 ชม. 6.5 วิ → 0.15 วิ · 144 ชม. 101 วิ → 1.6 วิ · ขอบเวลาต้องส่งเป็นพารามิเตอร์ (คำนวณใน CTE แล้ว planner ตัด partition ไม่ได้ วัดได้ 100 วิ) และเป็นข้อความ (`::text`) ไม่ใช่ Date ของ JS ที่ตัดเหลือมิลลิวินาที · ระหว่างรอบ reconcile ของที่มาช้ากว่า 3 ชม. ยังไม่อยู่ในตัวเลขจนถึง 05:00 ถัดไป
- **บทเรียน:** ตารางสรุปทุกตัวต้องมีรอบเก็บตกของที่มาช้า (edge ค้างคิวได้หลายวัน) และต้องมีตัวเทียบกับนับดิบเป็นระยะ ไม่งั้นขาดเงียบไปจนหมดอายุตาราง

### #238 — รายชื่อกลุ่มใบหน้า: DISTINCT ใช้ expression index ไม่ได้ ต้องกระโดดทีละชื่อ (recursive CTE)

- **อาการ:** dropdown/รายงานรอรายชื่อกลุ่ม 26–49 วิ ตอน cache เย็น (รายงาน LPR เดือน 84.5 วิ) — DISTINCT ชื่อกลุ่มจาก raw_json ของ event การจดจำ 352,243 แถว เพื่อได้ 18 ชื่อ
- **แก้:** migration 280 `idx_events_face_group_name` (นิพจน์ชื่อกลุ่ม, event_time) เฉพาะประเภทการจดจำ ~12 MB + เขียนคิวรีเป็น recursive CTE กระโดดทีละชื่อ → 1.4 ms · ผลเหมือนเดิมทุกชื่อและลำดับ
- **บทเรียน:** สร้าง expression index แล้ว DISTINCT ธรรมดา **ไม่ใช้** — index-only scan ของ expression index ต้องมีคอลัมน์ต้นทาง (raw_json) อยู่ใน index ด้วย (ข้อจำกัดของ PG) · ค่าน้อยชนิดในแถวมหาศาล = loose index scan ด้วย recursive CTE

### #239 — event_dim_bucket (ตารางสรุปของหน้าสถิติ) ไม่มีรอบเก็บตก: ขาด/เกินเงียบ ๆ

- **พบ (2026-10-26) ตอนเตรียมให้รายงานรายเดือนอ่านตารางนี้:** refresh ย้อนดู 3 ชม. และไม่มี reconcile เลย — เทียบนับดิบ: 23 ต.ค. ขาด 26,290 · 24 ต.ค. 15,947 · 22 ต.ค. 8,773 · 19 ต.ค. 7,803 (กล้องเดียวกับ #237) และ**เกิน**เล็กน้อยบางวัน (−8 ถึง −17: event ถูกลบหลังเติมตาราง) — หน้าสถิติแสดงตัวเลขเหล่านี้อยู่แล้วโดยไม่มีใครรู้ (ตารางเก็บ 400 วัน ขาดแล้วขาดถาวร)
- **แก้:** `category-rollup-refresher` reconcile 05:00 ทีละวันไทย 7 วันย้อนหลัง (`refreshRange` 14–32 วิ/วัน · เส้นแบ่งลบแถวกำพร้าใช้ now() ของ Postgres) + `rollupCheck` เทียบเมื่อวานกับนับดิบ (perfWatch เตือน) · ตรวจใน ROLLBACK: ทุกวันกลับมาตรงทุกหลัก ทั้งที่ขาดและที่เกิน
- **ค้าง:** วันเก่ากว่า 7 วันที่อาจขาดอยู่ ต้อง backfill ครั้งเดียว (รอผลเทียบรายวันทั้งช่วง + อนุมัติ) · รายงานรายเดือน (breakdown / coverage / heatmap 45–120 วิ) จะย้ายมาอ่านตารางนี้หลัง backfill
- **บทเรียน:** ตารางสรุปทุกตัวต้องมี reconcile + ตัวเทียบนับดิบตั้งแต่วันแรก (ตัวที่สามที่เจอปัญหาเดียวกันหลัง #237)

### #240 — สร้าง index ใหม่แล้วแผนของคิวรีอื่นที่ไม่ได้แก้เปลี่ยนตาม (faces/counts VSS 92 ms → 1.06 วิ)

- **อาการ (วัดซ้ำทั้งระบบ 2026-10-26):** `/api/faces/counts` ของ VSS ช้าลง 11 เท่า ทั้งที่ไม่มีใครแก้คิวรีนี้
- **ต้นเหตุ:** หลัง migration 279 (`idx_events_face_cam_time`) planner เปลี่ยนจาก partial index `idx_events_face_haslist_time` (ทั้งระบบ ~2,700 แถว) ไปใช้ BitmapAnd กล้อง × ประเภท แล้วเปิดแถวการจดจำทุกแถวของกล้องชุดนั้น (16,456 block)
- **แก้:** subquery `OFFSET 0` ให้หาแถวจาก partial index ก่อนแล้วค่อยกรองกล้อง · ทุกไซต์ 69–78 ms (นราธิวาส 1.67 วิ → 72 ms · RMUTR-V 1.34 วิ → 69 ms ซึ่งช้าอยู่ก่อนแล้ว) · ผลตรงกันทุกกรณีรวม site admin
- **บทเรียน:** หลังสร้าง index ต้องวัดซ้ำทั้งระบบ ไม่ใช่แค่คิวรีที่ตั้งใจแก้ — วัดอัตโนมัติทุกคืนแล้ว (`scripts/query-probe.js` cron 01:15 → perfWatch 18:25)
