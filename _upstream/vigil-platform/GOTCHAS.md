# GOTCHAS — Vigil Platform

> Companion to [CLAUDE.md](CLAUDE.md). Known issues / quirks / footguns
> to watch for. Each entry comes from a real incident — preserve the
> wording, don't re-discover the same bug.
> See also: [DECISIONS.md](DECISIONS.md) (why things are the way they are).
> Last updated: 2026-06-09

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

84. **macOS Local Network Privacy (LNP) บล็อก third-party binary จาก camera subnet — root cause จริงของ #82/#83** — 2026-06-10:
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

103. **`edge-config-agent` retain-skip กลืน live stateful detection → Bosch ObjectsInside/CountAggregation ไม่เคยได้ snapshot** — 2026-06-29 (site `vss`, `BOSCH_3100i`): Events list ขึ้น "—" (ไม่มีรูป) เกือบทั้งหน้าเฉพาะ 3100i ส่วน 8000i/8100i ปกติ. **Root cause:** Bosch publish detector ที่เป็น **สถานะต่อเนื่อง** — `FieldDetector/ObjectsInside` (zone occupancy) + `CountAggregation/Counter` (people count) — เป็น MQTT **retained** message, และ NanoMQ deliver แม้ live publish ด้วย `retain=1` (node mqtt sniff ยืนยัน: ObjectsInside/CountAgg = retain:N/fresh:0; LineDetector/ObjectDetection/IdleObject = momentary ไม่ retained). `edge-config-agent.js` มี guard `if (packet.retain) return;` ที่ตั้งใจกัน **stale replay ตอน reconnect** เท่านั้น แต่ดัน **skip live retained event ด้วย** → ObjectsInside ไม่เคยถึง capture (return ก่อน allowlist). 8000i/8100i ใช้ rule แบบ momentary (crossing/object-detection) เลยไม่โดน — **เป็นเรื่องชนิด VCA rule ไม่ใช่รุ่นกล้อง**. ที่ได้รูป ~13% = บังเอิญตกใน timestamp-window `[-5s,+10s]` ของ event อื่นที่ capture สำเร็จ. **Reproduce:** edge `[edge-snap]` log (capture 0 ครั้งตอน ObjectsInside burst, ตัวแรก 9s หลัง burst จาก IdleObject) + central `no matching event=0` + DB has_snapshot=false ตรง event ในรูปเป๊ะ + node mqtt sniff retain flag. edge capture เองไม่เคย fail (timeout:0 error:0) → ตัด HTTP timeout ออก. **ทางที่ลองแล้วไม่เวิร์ก (commit `49f0464` → revert `dbfb008`):** แยก stale-replay จาก live ด้วย freshness gate `if (packet.retain){ parse UtcTime; if (ageMs>60000) return; }` — **เปราะ เพราะเทียบ `edge Date.now()` กับ `camera UtcTime`**: กล้อง 3100i รันช้ากว่าจริง **~3.5 ชม.** (NTP ไม่ตั้ง — Mac/edge `sntp`/`timedatectl` sync ตรง, กล้องช้า) → ทุก live event `ageMs ≈ 12,000s > 60s` → ถูก skip อยู่ดี = inert no-op. ที่ "ดูเหมือนเวิร์ก" ตอน verify คือ CountAggregation บังเอิญ link เฟรมจาก non-retained event ใกล้ๆ ผ่าน window-match ไม่ใช่ gate ปล่อยผ่าน. **Fix จริง (ทำที่กล้อง):** เปลี่ยน VCA rule ที่ต้องการ snapshot จาก occupancy (`ObjectsInside` "object **inside** field" = retained) → **momentary trigger** (`LineDetector/Crossed` หรือ field "object **enters/leaves** field") — non-retained, ไม่ชน guard, ได้ 1 event + 1 รูปคมชัด/visit, ใช้ path เดียวกับ rule ที่เสถียร 97%. (กรณีจริง: "คนเปิดตู้เย็น" เปลี่ยนเป็น Crossed → รูปเห็นคนเต็มตัว 99% Person.) **CountAggregation คงตัดที่ allowlist** — ป้อน occupancy stats ผ่าน `msg.Data.Count` (`recordOccupancySample` → `/api/stats/occupancy`) ไม่ใช่ snapshot + Events list filter ออกแล้ว (`events.js exclude_types`) → capture ให้ก็เปลือง disk เปล่า. **Lesson:** (1) อย่าแก้ปัญหา retained-snapshot ด้วย freshness gate ที่เทียบ server-now กับ camera-time — เปราะต่อ clock skew; แก้ที่ต้นเหตุ (camera VCA = momentary). (2) ObjectsInside (occupancy state, retained, fire ต่อเนื่องทุก ~100ms) ≠ event ที่ควรถ่ายรูป — visit เดียวได้ 14 event rows; momentary trigger สะอาดกว่าทุกทาง. (3) ObjectsInside ≠ CountAggregation (presence vs count แทนกันไม่ได้) — แต่ occupancy → **Crossed** แทนกันได้ถ้าเป้าหมายแค่ "จับว่ามีคนผ่าน". (4) เจอ event time แปลก → เช็ค camera NTP ก่อน (`Bosch CM → Network → Time`); server เวลาถูกไม่ได้แปลว่ากล้องถูก.

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

---

<sub>End of GOTCHAS.md · Companion to CLAUDE.md · Updated 2026-07-22 (#116)</sub>
