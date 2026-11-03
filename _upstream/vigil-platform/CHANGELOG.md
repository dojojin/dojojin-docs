# CHANGELOG — Vigil Platform

> Companion to [CLAUDE.md](CLAUDE.md). Records completed work by
> version / phase. For pending work see [ROADMAP.md](ROADMAP.md);
> for design rationale see [DECISIONS.md](DECISIONS.md).
> Last updated: 2026-09-10 (สัดส่วนประเภทเหตุการณ์นับเป็นจำนวนรถ · ตั้งชื่อหัวข้อรายงานเองได้) · ก่อนหน้า: 2026-09-08 (คำสั่งผ่าน LINE) · ก่อนหน้า: 2026-09-07 (env registry, ttlCache helper) · previous: 2026-09-06 (performance program: query shape, caching, WebSocket, diagnostics) · Current version: **v1.5.4** (tag `v1.5.4` = commit after `07ebe6d`; first git tag in the repo)

---

## 📰 Recent Updates Timeline (reverse chronological)

> **v1.5.4 — 2026-09-06 · performance & security hardening.** Everything between `ea4b64d` (2026-09-03) and `07ebe6d` (2026-09-06): the performance program (query shape, caching, WebSocket, diagnostics, indexes, boot, render isolation, bundle), the scope-aware cache key fix (GOTCHAS #190), the rawXml IP/MAC scrub (security backlog S1), the face-embed-worker `$3` fix, and migrations 198–199. Detailed entries: the two 2026-09-03 → 09-06 items below.

- **2026-10-02 — Quick wins ระบบช้า** (GOTCHAS #219): หยุด poll ที่ไม่มีคนดู · quiet-cameras 5.7 วิ→4 ms · facets ประเภทรถ 15–95 วิ→<1 วิ · cache หน้าสรุปตอบทันที · analyze license_plates ทุก ~8 ชม. · ปฏิทินช่อง "ถึง" เปิดเดือนเดียวกับ "ตั้งแต่" · ค้นป้าย <3 ตัวถูกปฏิเสธ · หน้าจอบอก "โหลดไม่สำเร็จ" แทน "ไม่พบ" · log token ผิดเป็นสรุปพร้อมต้นทาง.
- **2026-10-02 — แผนป้องกันหลังตรวจระบบ** (GOTCHAS #218): หน้า Health มีการ์ด "ความถูกต้องของระบบ" · LISTEN ทุกตัวต่อกลับเอง · ขอบเวลาอนาคตครบทุกจุด · เทสต์จับ route เขียนที่ไม่มีด่าน → พบและปิด `PUT /api/alert-channels` ที่ viewer แก้ผู้รับแจ้งเตือนได้ (บันทึก audit แล้ว).
- **2026-10-02 — แก้ D1–D7 จากการตรวจระบบรอบใหม่** (GOTCHAS #217): ฐานกล้องเงียบกลับมาคำนวณได้ (ค้างตั้งแต่ 12 ก.ย.) · LISTEN ต่อกลับเองเมื่อ Postgres หลุด · ตัดผลของ event เวลาอนาคตออกจาก Health/feed · ด่านยืนยันกล้อง Bosch · สถิติ appearance จำกัด 2 วันพร้อมข้อความชัด · `/api/lpr` เขียนได้เฉพาะ admin (ยกเว้น ack/ส่งต่อ/หยุดแจ้งเตือน).
- **2026-10-02 — Optimize ระยะ 1** · rollup ป้ายอ่านไม่ออกเลิกล้นดิสก์ (~1.2 GB/วัน → 0, ตัวเลขเท่าเดิม) · ข้อมูลใบหน้า (face_embeddings/face_embed_queue) ถูกลบตามอายุ event 100 วันแล้ว เดิมไม่มีใครลบเลย (GOTCHAS #216).
- **2026-10-01 — หน้าป้ายทะเบียนค้นหาไม่ได้เพราะสถิติหนักรุมกัน** (GOTCHAS #215). `period=custom` ไม่มี `from` กวาดทั้งประวัติ 51 ล้านแถว · คำขอเดียวกันถูกคิดซ้ำ · 12 คิวรีขนานต่อคำขอแย่ง pool 15 ช่อง. แก้เป็นสามคอมมิต: ขอบล่าง 31 วัน · คิว+รวมคำขอซ้ำ+`statsPool` แยก (503 busy เมื่อรอเกิน 45 วินาที) · warm loop และ Reports อยู่หลังคิวเดียวกัน. ตัวเลขที่ตอบกลับเหมือนเดิม ยกเว้น custom ที่ไม่มี from.
- **2026-09-10 — โดนัท "สัดส่วนประเภทเหตุการณ์" นับเป็นจำนวนรถ ไม่ใช่จำนวนครั้งที่ผ่านเส้น** (decision #288). RMUTR-V ตั้งหมวดเป็นคู่ (IN)/(OUT) และโดนัทยุบสองทิศเป็นชิ้นเดียวด้วยการบวก ⇒ รถคันเดียวถูกนับสองครั้ง ทั้งที่ชิ้นนั้นเขียนว่า "รถยนต์". ยุบแล้วหารด้วยจำนวนหมวดที่ยุบเข้าด้วยกัน — คู่ IN/OUT ปกติได้หารสอง ส่วนหมวดที่มีทิศเดียวไม่ถูกแตะ. ที่ RMUTR-V 8–9 ก.ย. รถยนต์เปลี่ยนจาก 7,015 เป็น 3,508 และจักรยานยนต์จาก 16,073 เป็น 8,037 (สัดส่วนในวงเท่าเดิม 30.3% / 69.5%) — สองทิศต่างกันไม่ถึง 2% จึงยืนยันได้ว่าเป็นรถชุดเดียวกัน. **แก้จุดนี้จุดเดียวตามที่เจ้าของเลือก** การ์ด "ยานพาหนะ" ตาราง "รายละเอียดตามหมวดหมู่" และ "จำนวนตามกล้อง" ยังนับครั้งที่ผ่านเส้นเหมือนเดิม. ไซต์อื่นไม่ถูกแตะเลยเพราะขอบเขตผูกกับชื่อหมวด และ RMUTR-V เป็นไซต์เดียวที่ตั้งชื่อแบบนี้
- **2026-09-10 — ตั้งชื่อหัวข้อในรายงานเองได้** (decision #287, migration 224). เจ้าของแก้ชื่อหัวข้อทั้ง 9 ตัวได้จากรายการติ๊กในหน้า "สร้างรายงาน" และหน้า "รายงานอัตโนมัติ" — คลิกดินสอท้ายแถว พิมพ์ชื่อใหม่ Enter · ลบให้ว่าง = กลับไปใช้ชื่อเดิม. ชื่อที่ตั้งเป็น **ค่ากลางทั้งระบบ** ใช้กับทั้งตัวอย่างบนหน้าจอ ไฟล์ PDF/PNG ที่กดโหลดเอง และรายงานที่ส่งเข้า LINE ตามเวลา เพราะทั้งสามทางวาดด้วย `dashboard/report-template.js` ตัวเดียวกัน (Puppeteer โหลด `/report-print.html` ซึ่งอ่านค่านี้ก่อนเริ่มวาด). หัวข้อ "ภาพรวมเหตุการณ์ {label}" ยังเก็บคำต่อท้ายตามความละเอียดของกราฟ (ตามชั่วโมง/วัน/สัปดาห์) ได้ถ้าคงตัว `{label}` ไว้ในชื่อใหม่. ค่าเดียวไม่แยกไทย/อังกฤษ — ตั้งแล้วเห็นคำเดียวกันทั้งสองภาษา ส่วนหัวข้อที่ไม่ได้ตั้งยังสลับภาษาตามปกติ. เขียนได้เฉพาะ admin
- **2026-09-08 — สั่งงานระบบด้วยการพิมพ์ในแชท LINE** (decision #281–#284, GOTCHAS #196–#198, migrations 201–210). เจ้าหน้าที่พิมพ์ประโยคไทยปกติในกลุ่มที่บอทอยู่ แล้วได้การ์ดคำตอบกลับมา — "ขอทราบยอดคนไม่สวมหมวกนิรภัย ภูเก็ต ชั่วโมงที่แล้ว" · "ขอป้ายทะเบียนที่ฝ่าฝืน เยอะที่สุดมา 3 ป้าย" · "ขอรูปรถป้าย 1กอ88 วันนี้ทั้งหมด" · "ส่งให้ตำรวจ 1กอ88". **หลักคิดเดียวที่ทั้งฟีเจอร์ยึด: คำสั่งใน LINE = ยิง endpoint เดิมของระบบ ในนามของผู้ใช้จริงคนหนึ่ง** ⇒ ขอบเขตไซต์ สิทธิ์ระดับหน้า การกันเขียนของ auditor และ audit_log มาครบโดยไม่ต้องสร้างระบบสิทธิ์ที่สอง และตัวเลขตรงกับหน้าจอเสมอเพราะเป็นคิวรีตัวเดียวกันจริง ๆ. 13 คำสั่ง — ถาม 9 (ยอดไม่สวมหมวก · อันดับป้าย · ฝ่าฝืน · ยอดอ่านป้าย · รถเฝ้าระวัง · ค้นป้าย · กล้องออฟไลน์ · จำนวนรถแยกประเภท · ขอรูปรถ) ทำ 4 (ส่งให้ตำรวจ · รับทราบ · หยุดแจ้งเตือน · เปิดกลับ) — ทั้งหมดตั้งคำเรียกเองได้จากหน้าตั้งค่า (Settings › LINE / การแจ้งเตือน › คำสั่งผ่าน LINE) พร้อมช่องทดลองสั่งที่ไม่ส่งอะไรเข้า LINE จริง. คนที่ไม่ได้ลงทะเบียนเป็นผู้สั่ง บอทเงียบสนิทและลงปูมไว้ · ไม่ต้อง @ บอทก่อนสั่ง · ข้อมูลที่ตอบถูกจำกัดตามบัญชีที่ผูกไว้ (บัญชีที่เห็น 4 กล้องในภูเก็ตได้ยอดของ 4 กล้องนั้น พร้อมป้ายกำกับ "4 จาก 86 กล้อง"). **สามบั๊กที่เห็นได้เฉพาะตอนยิงเข้า LINE จริง** และเทสต์ในเครื่องจับไม่ได้เลย: ปุ่มใส่ลิงก์เป็น path ล้วนทำให้ LINE ทิ้งทั้งข้อความ · โค้ดไม่ log ผลการส่งจึงมองไม่เห็น · ตอบ webhook ช้า 2,200 ms ทำให้ LINE ส่ง event ซ้ำและคำสั่งรันสองรอบ (แก้เป็นตอบ 200 ทันทีแล้วทำงานเบื้องหลัง 12 ms + ทิ้ง event ที่ติดธง isRedelivery). ดูเอกสารเต็มที่ [`docs/LOGIC_line-commands.md`](docs/LOGIC_line-commands.md)
- **2026-09-08 — Unread plates are counted once, the same way, for both camera vendors** (decision #280). The tab and the KPI card each saw only one vendor's way of reporting a failed read, so over the same day the tab showed none at Phuket and the card showed none at HatYai, where 18,790 vehicles went unread. One definition now covers both, the rollup carries it so the week and month views do not scan the events table, and the plate total means plates actually read rather than rows in the plate table. Verified after backfilling 35 days: read plus unread equals vehicles seen, within 0.08 per cent left over from edge data that arrives late and is reconciled nightly.
- **2026-09-08 — The rollup jobs have one owner, a status, and a way to run them by hand** (decision #279, closes Codex VMOD-05). Four refreshers were started from four separate lines in the API server with no way to see when each last ran or whether it had been failing quietly. They now start from `src/jobs/rollups.js`, report per-job state in `/api/health/details`, take a Postgres advisory lock so a restart overlap cannot give a job two owners, and can be triggered individually by an admin through `POST /api/jobs/:name/run`. The refreshers' tick functions now return the outcome of a cycle instead of swallowing errors, which is what makes a failure visible at all. Their SQL is untouched.
- **2026-09-08 — A statistics endpoint that counted the whole table** (decision #278). `/api/stats/kpi` took 35.3 seconds on every call because its time window was only applied when the caller passed `from`, and `period` is not a parameter it understands, so the request counted all forty million rows across every partition. Four handlers now take their window from the range parser that already sits in the same file: one day by default, `range=1h|1d|7d|30d` to change it, explicit `from`/`to` unchanged. The same call is now 0.44 seconds. While checking them, `/api/stats/timeseries-rules` turned out to have been answering 500 the whole time: its GROUP BY bound to the real `rule_name` column rather than the aliased expression beside it.
- **2026-09-07 — The last hand-rolled caches and env reads moved to their shared helpers** (decisions #270, #271, #274). Five caches outside the route layer now use `ttlCache`: the helmet top-list, the AcuSeek channel map, the two 30-second camera lookups on the MQTT ingest path, and the licence state, which gains single-flight. Three kept their own code on purpose, because a rate-limit ledger cannot survive eviction and the alert engine's timer refresh writes five globals that thirty synchronous readers depend on. Fifteen more files stopped reading `process.env` directly, so all 52 variables they use resolve through the registry with one default each. `/api/health/details` now reports fifteen caches with hit, miss and in-flight counters.
- **2026-09-07 — One place decides how large a snapshot is requested** (decision #273). The width in each image URL was written out at twenty-four call sites across eleven files, so the modal asked for 640 pixels while its box was locked to 236 and two places asked for widths the server does not recognise. An unrecognised width is treated as no width at all and the full file is sent: map pins and the executive summary card were each pulling a 741 KB frame to draw a thumbnail, where the smallest valid size is 4 KB. `SNAP_W` now names the sizes by role and every call site uses it.
- **2026-09-07 — Zone-occupancy rules finally get their snapshots** (GOTCHAS #103). Bosch publishes a zone-occupancy detector as a retained MQTT message and the local broker keeps that flag on live delivery, so the edge agent's replay guard threw every live one away: on the bin-test camera, one image per hundred events against four out of four for a line-crossing rule. A June attempt to tell the two apart by comparing the camera's timestamp to edge time failed on a camera clock running three and a half hours behind. The guard now uses only edge-local facts: retained messages in the first five seconds after subscribing are the broker's replay, and after that a payload byte-identical to the previous one on the same topic is a repeat.
- **2026-09-07 — Face group names stopped scanning every partition, and a guard so the next one cannot** (decision #272). The filter dropdown's group list ran an unbounded DISTINCT over `events` from two places, the groups route and every face report render: 14.5 s cold, now 0.25 s cold and 3 ms warm from one cached, 90-day-bounded query. Ninety days was measured to return the same ten names as the all-time query. `npm run check:events` (pre-commit) now fails any viewer-reachable handler that reads `events` or `license_plates` without a time bound and a site scope, unless the handler says in a comment why it does not need them; the ten existing cases are annotated. It also surfaced that `/api/faces/summary` takes 44 s with no date range and 17.6 s over seven days, which needs an index decision and is not fixed here.
- **2026-09-07 — Single-instance lock no longer mistakes a thread for a process** (GOTCHAS #193). At the vss edge the LPR receiver was down for 5 hours 40 minutes across 451 restart attempts, refusing to start because its pid file, left over from before a reboot, named a number that now belonged to a libuv worker thread of another service. `process.kill(pid, 0)`, the old liveness probe, answers "alive" for a thread id. On Linux the guard now reads /proc and requires the pid to be a process (Tgid equal to the pid) whose command line is one of ours; anything else is treated as a stale lock and reclaimed, with a log line saying so.
- **2026-09-07 — Central env registry** (decision #271). Every environment variable the code reads is now declared once in `src/config.js` with its type, default and a one-line doc, instead of 130 names carrying their own default at 313 call sites. The 16 database pool configurations became `env.db()`, and the proxy domain that was typed out at 14 places has one home. `npm run check:env` (also a pre-commit hook) fails when code reads a variable that is not registered, which is what let 135 of them stay undocumented. On boot `api-server` prints how many values came from the environment and how many fell back to defaults, naming only the non-secret ones.
- **2026-09-07 — One TTL cache helper for the route layer** (decision #270, GOTCHAS #192). Eleven hand-rolled `Map`+TTL caches in nine files became `helpers/ttlCache` with the same TTL and size limits as before. What changed in behaviour: concurrent misses now share one load (five simultaneous cold `executive-summary` calls = one 1.1 s query instead of five), the scope component of a key is composed by the helper rather than by each caller, and `/api/health/details` reports hit/miss/inflight/stale counters per cache. The migration surfaced a pre-existing key collision in `/api/lpr/brands` (admin and empty-scope users shared `"[]"`), fixed by the same `scope` option.
- **2026-09-03 → 09-06 — Performance program: the dashboard was slow because of query *shape*, not because of missing hardware** (GOTCHAS #187–#191, migrations 198–199, Codex audit VMOD-20260906)
  - **Diagnostics first, because the previous audit had to re-measure every endpoint by hand.** `api-server` kept no request-duration log at all, so one middleware now warns `[slow-req] <status> <ms> <method> <url>` at or over `SLOW_REQ_LOG_MS` (default 2000), with `token=`/`sig=` redacted and the URL capped at 200 chars — log only, never touching control flow. Postgres `log_min_duration_statement` is 2 s alongside it (`ALTER SYSTEM`, persisted in `postgresql.auto.conf` on the data volume). The first line the middleware produced after deploy was `GET /api/health/details 42160 ms`, which is how the biggest single item on this list was found rather than guessed (`0199b8b`, recipe in `af4b12b`)
  - **Query shape — `/api/health/details` was counting 40.5 million rows three times.** Cold after a restart that cost 40.5 s, and the counts kept running inside Postgres after the route's own 2 s timeout had already given up. `total` now sums `pg_class.reltuples` across the partitions (−0.02% against exact), `face`/`lpr` sum the 30-minute rollup in one scan (−0.006% / −0.35%); the 1 h and 24 h counts stay exact. Cold 42 s → 1.5 s, the counts part 0.22 s. The response carries `events.totals_approx` and the Health card shows the three values with a leading ≈, because a number that is 0.02% off should say so rather than pretend (`0e32082` `a8008a1` `101c97e`)
  - **Query shape — the endpoints with no time bound at all.** `status-current` computed `MAX(event_time) GROUP BY camera_id` over the whole events table (44–66 s) and became a `LEFT JOIN LATERAL … LIMIT 1` per camera on the `(camera_id, event_time)` index: 0.07 s, identical results for all 169 cameras. `image-quality-log` had no window and used `COUNT(*) OVER ()` for the total, so a 50-row page visited every matching row ever and hit the 120 s statement timeout — now a 30-day window, one equality branch per `event_type` (`UNION ALL`), total from `event_dim_bucket`: 0.1–0.3 s (`fe9c4bb`)
  - **Query shape — three endpoints moved onto the rollup that already held their answer.** `/api/alert-rules-suggestions`, `/api/events/facets` and `/api/categories/rule-discovery` ran `DISTINCT`/`LATERAL` scans over `events` filtered by `rule_name` or `event_type`, neither of which has a supporting index — at ~850k rows/day that meant >30 s (statement timeout), 3.6–10 s and 6–14 s. `event_dim_bucket` already carries every `rule_name`/`event_type`/`object_class`/`vehicle_type` per camera: 0.09 s / 0.22 s / 0.13 s cold, parity checked against `events` over a 1-day window (24/24, 17/17, 10/10). Rule discovery also stopped capping at 2,000 events per camera, so its counts are real 7-day sums and new combinations appear ≤5 min late (`f43e5d7`). The same move fixed the 24 h image-quality and trigger aggregations that the Health page polls every 15 s: 3.6 s + 0.5 s → 16 ms + 5 ms (`5c9c31f`) — and `SUM() FILTER` returns NULL where `COUNT(*) FILTER` returned 0, so every column had to be COALESCEd to keep the integer shape (GOTCHAS #188)
  - **Query shape — the Events page counted the whole day to show twenty rows.** `GET /api/events` still carried `COUNT(*) OVER ()` in the rows query, so the default 24 h window plus the exclude-types list made Postgres visit all 20,167 matching rows: 855 ms warm, 4.4 s cold, 4.3–4.7 s for real users in the `[slow-req]` log. The rows query now returns just the page (11 ms) and the count is bounded by `EVENTS_COUNT_CAP` (default 10,000, 276 ms); `X-Total-Capped: 1` tells the client the number is a floor and the Events/Snapshots/Media labels render it as "10,000+". Exact below the cap (1,567 = 1,567 verified for one camera), and the header is in `exposedHeaders` so a cross-origin client cannot mistake the floor for the total (`6bac369`)
  - **Query shape — the LPR no-read tab, in two steps.** Opening it without a date range ran an unbounded `LEFT JOIN license_plates … IS NULL` over every `anprAlarm` row, with several copies observed running past two minutes. First the server defaulted `from` to now−24 h and turned the anti-join into a `NOT EXISTS` bounded on `lp.detected_at` (±1 h), which lets the planner hash-anti-join through `idx_plates_detected_at` instead of probing per row: 24 h count 12.8 s → 0.55 s, first page 6.7 ms, same 19,651 rows both ways (`dfd44ea`). A week and a month were still ~38 s, so the second step replaced the anti-join with a predicate: on the live data "no `license_plates` row" is *exactly* `COALESCE(raw_json->>'plate','') = ''` (24 h 19,637 = 19,637; 7 d 156,187 = 156,187, zero mismatches either way), served by a partial index. 24 h 0.18 s, 7 d 1.7 s cold / 0.03 s warm, 30 d 0.21 s (`548677e`, migration 199)
  - **That equivalence is now checked rather than assumed.** Nothing guarded the predicate the whole tab depends on, so a helper compares both definitions over the last 24 h every Sunday 04:30 Asia/Bangkok — after the nightly backup — logs ok/MISMATCH, stores the result in `system_settings.lpr_noread_check` and exposes it as `lpr.noread_check` in `/api/health/details`. First real run: 17,959 = 17,959, mismatch 0, 11.9 s. 10 unit tests on the scheduler math and the compare logic (`eec4c4f`)
  - **Query shape — three more that were paying for rows nobody read.** `/api/lpr/brands` grouped all 31.8M `license_plates` rows (5.5 s cold for a real user) and now sums `lpr_dim_daily`: 34 ms, same 420 brands, counts within 0.07% (today's not-yet-rolled-up reads). `/api/hcp/events` is bound by the HTTP round-trip to the hkt edge (5.7 s), so a 30 s in-memory cache keyed by query string + scope with stale-on-error absorbs the page's re-queries (`X-Cache` header). The `/api/snapshot/live/:id` scene fallback for an NVR channel with no `_snapshot_full` event walked the `event_time` index across all 38M rows — ~38 s per tile request, hogging pool connections and stalling every other page — first bounded to 7 days with a 10-minute negative cache (`ea4b64d`), then to 24 h with a 60-minute negative cache once it was clear every NVR channel has a scene within 14 h: 4.2 s → 41 ms for hdy-anpr1 (`a0c647d`)
  - **Caching — a cache key that did not carry the whole scope, which was a correctness bug wearing a performance costume.** Four in-memory caches (lpr/stats, appearances/stats, events/facets, executive-summary) keyed entries by `allowedSites.join(',')`, but `makeScope()` carries the `user_cameras` restriction as a non-enumerable `.cameras` property that `siteWhere()` applies in SQL and `join()` never sees. Two users on the same site with different camera lists shared one entry — real data, not theory: site 18 has an 84-camera account and a 4-camera account, site 20 has four accounts with four different camera sets. `auth.scopeCacheKey()` is now the only way to build such a key, the LPR warm loop uses it too (otherwise it pre-warmed a key no request ever reads), 9 key-level tests. Found by the Codex audit as VMOD-00 and confirmed against the live `users` table (`2808e63` `aa75d5a`, GOTCHAS #190)
  - **Caching — static assets were revalidating 62 of 88 files on every repeat load.** `index.html` already rewrote local asset URLs with `?v=<mtime>`, but the static mount answered `public, max-age=0`, so each of those files paid the ~180 ms Cloudflare floor again; vendor files were never stamped at all (the regex rejected dots in `ol-9.2.4.js`) and login/disclaimer assets were not stamped either. Now every js/css referenced from index/login/disclaimer is stamped; stamped URLs are `private, max-age=31536000, immutable`, unstamped `private, max-age=3600`, HTML stays `no-cache` (GOTCHAS #34), and the internal Puppeteer renderer gets `no-cache` so a report can never render an old template. `private` is what keeps Cloudflare from edge-caching auth-gated files. Repeat load: 76 of 86 files from browser cache, was 26 of 88 (`2ed4289`)
  - **Bundle — the first load after a deploy still fetched 47 scripts one at a time.** At boot `api-server` concatenates the longest contiguous run of local page scripts from `index.html` (39 files, 1,996 KB, version = sha1 of the content), parse-checks it with `vm.Script`, and serves it as `/dashboard.bundle.js?v=<ver>`, auth-gated like the other scripts. `theme-init.js`, `i18n.js`, `province-names.js`, the vendor files and `dashboard.js` keep their own tags because of load-order constraints. First load 108–114 requests → 70, 47 script requests → 9, 3.8–4.5 s → 3.3 s on localhost, 0 JS errors across 20 pages. Known behaviour change, accepted by the owner rather than hidden: 11 files carry a top-level `'use strict'` that concatenation cannot preserve (the `;` separator closes the directive prologue), so those files run in sloppy mode inside the bundle. `DASHBOARD_BUNDLE=0` or any build failure serves the unbundled page (`f8f4615`)
  - **WebSocket — every browser was receiving every event in full, whether or not the page rendered it.** 11–15 msg/s, 200–270 KB per 10 s, about 100–137 MB/hour/tab, while most pages only need events for badges and toasts. The client now subscribes to the heavy topics it actually renders (lpr on the LPR page, the map with the LPR overlay, Events with specialized types; face on face/appearance/map/blacklist pages) and everyone else gets a ~330 B lite variant. Both `ws.send` sites in `broadcast()` are covered — there are two, which is exactly the kind of thing that makes a "simple" change leak (GOTCHAS #189). The Cameras page now rewrites its cards at most once a second and the Events feed re-renders at most every 300 ms. Measured per 10 s: Summary 219 → 32 KB, Cameras 212 → 33, Events 200 → 32; the LPR page keeps the full stream. Tabs still running the old `dashboard.js` receive lite events until they reload (`9363229`)
  - **Indexes — one dropped, one added.** `idx_lpr_plate_type` had 0 index scans in 19 days against 406 MB and no query filtering or ordering by `plate_type`; dropped on central with `DROP INDEX CONCURRENTLY`, carried to other volumes by migration 198 as a plain `DROP INDEX IF EXISTS` (3 ms at boot) (`104e0a9`). `idx_events_anpr_noread_time` was built with the existing 3-step partition script: 21 partitions, 30 MB, 2,302 s of which ~25 minutes was spent waiting for the nightly `pg_dump` snapshot — `CREATE INDEX CONCURRENTLY` blocks behind it (GOTCHAS #191). Ingest was unaffected throughout (`548677e`, migration 199)
  - **Boot — everything the restart kicked off arrived at once.** The kpi/category/traffic rollups, the LPR stats warm loop and seven retention jobs all started within the first three minutes and the Postgres slow log showed them stacking (temp-table builds 3 s ×2, plate_region 6–8 s, plus the first health poll). First runs are now spread — kpi 45 s, category 90 s, traffic 135 s, LPR warm 180 s, retention 300–480 s, each overridable via `<NAME>_FIRST_RUN_MS` — with periods unchanged. `health.js` also stopped blocking the event loop on `execFileSync('pm2')` (async `execFile`, same timeout) and `_cached()` now stores the pending promise so concurrent misses run the loader once, evicting a rejected load so the next call retries. Verified after a restart: no statement over 2 s in the first two minutes (`7a2c6a7` `585cc3c`)
  - **Boot — and the nightly reconcile was colliding with the backup.** The 7-day traffic reconcile ran at 03:00 Asia/Bangkok, inside the 03:04–~04:05 `pg_dump` window, where its per-day `INSERT INTO lpr_hourly_stats` took 95.3 / 48.5 / 25.9 s instead of the ~24 s it was sized for — brushing the 120 s pool statement timeout that used to make it fail every night. A restart at 03:48 re-ran the whole thing because the reconciled-day marker lived only in memory (second burst 59.6 / 43.0 / 25.5 s). Default `RECONCILE_HOUR` is now 5 and the marker is persisted in `system_settings.traffic_stats_reconciled_day`, loaded at start. 4 tests drive the once-per-day logic against a fixed clock (`fc7cb31`)
  - **Render isolation — Chromium now runs under `report-worker` only.** The shared Puppeteer browser stayed alive for the life of the process after the first render, holding ~700 MB RSS on a 15.6 GB host that had 1 GB of swap in use; a timer closes it after `REPORT_BROWSER_IDLE_MS` (default 5 min) of idleness, disarmed once the render slot is acquired and re-armed on release so it cannot fire mid-render. The same commit fixes a latent leak where the disconnect/catch handlers nulled `_browserPromise` by truthiness, so a late disconnect from an old browser could drop the reference to a freshly launched one and leave it unowned (`47d6528`). The 8 manual PDF/PNG download routes then moved off `api-server` entirely: `report-worker` gained `POST /render` (loopback, `X-Internal-Token`, an allowlist of 6 renderer exports, 2 MB body limit) and `api-server` calls it via `src/helpers/renderViaWorker.js` with a 120 s timeout and in-process fallback on refusal/timeout/non-2xx. Verified live — 401 without the token, 400 for a disallowed fn or an oversized body, and a real 475,267-byte daily PDF rendered in the worker. `REPORT_RENDER_VIA_WORKER=0` forces in-process (`bddbcd9`, Codex VMOD-03)
  - **Storage — two walks that blocked the event loop while they ran.** `countEventOrphans` used `readdirSync`/`statSync` over `snapshots/events` inside `api-server` (event-loop lag 289 ms warm, 1.85 s cold) and then `LEFT JOIN`ed `events` on `snapshot_filename` across every partition — 6 runs per 24 h, max 85 s, 1.4 GB of temp spill. The walk is async now (max lag 19 ms), the join is bounded by the file-path dates rounded out to month edges so only the live partitions are scanned (21 → 2), and `_orph` is ANALYZEd so the hash side is the 158k-file list rather than 13.4M events: same 123,336 orphans / 611,086,336 bytes in 65.7 s against 69.4 s, and the gap widens with every month of partitions the old join kept re-reading. Path dates are receive-time UTC, so the margin is −1 day / +2 days (skew against `event_time` p99.9 = 3.2 s, max −19 h, none over a day) (`bddbcd9`, Codex VMOD-02). `planPurge`/`executePurge` had the same problem on both `api-server` and the edge-config-agent and are now async over `fs.promises` with identical return shapes and the same `confirmFiles` safety check; the edge agent wraps its purge topic in an async IIFE with try/catch inside so a rejection cannot surface as an unhandled rejection under pm2. 5 tests on a temp directory (`15fe325`)
  - Deployed to central and all 5 edge sites. The two diagnostics are permanent, which is the part that outlives the individual fixes: the next "the dashboard is slow" starts from a log line, not from re-measuring every endpoint
- **2026-09-03 → 09-06 — Report customisation, per-site category backup, and three small fixes** (same window, not part of the performance program)
  - **Reports became configurable rather than one fixed layout:** an optional per-day time window on the report stats endpoints (`59e66b7`) carried through to the schedule form and a calendar-month monthly range (`213c931`), a "summary" report type with donut percentage labels and the time-window UI (`40d0f8e`), and per-section toggles so a report shows only the sections that were asked for (`ab70ad8`). Analytics-only fields are hidden on the summary type, and the month label is the real month (`080d4ce`)
  - **New charts on the report:** last-7-days and month-to-date bar charts (`00acb35`), those daily bars split by category (`2f86ad6`), each category's share in the category table (`91efd2a`), and IN/OUT merged in the share donut with the category table paired to its own donut (`a09e3bd`)
  - **Scheduled reports were failing to render at all** and were fixed in the same batch (`889fa5f`)
  - **Per-site backup and restore of event categories** (`5c12f0b`), and opt-in toggles for license-plate and face rules in rule discovery, so those rule families are included only when asked for (`d9d4d81`)
  - **Stats page fixes:** the per-site vehicle breakdown was always empty (`525a566`), and cards became unselectable once a group was collapsed (`628cbe4`)
  - **Camera MAC address on the Relay page and its PDF** (`a72b418`)
- **2026-08-24 — Our own file host, so documents stop going through outside services** (decisions #257–#258, migration 179)
  - `POST /api/files` accepts png/jpg/pdf/docx/xlsx up to 25 MB, admin only, and returns a signed expiring link. Files are stored under `files/` with a UUID name we generate; the uploaded name is kept in `public_files` for display and for the download filename, never to build a path
  - Type is decided by magic bytes, not the extension and not the browser's Content-Type. SVG is refused outright rather than merely unsupported
  - `docx`/`xlsx` are both zip containers, so the magic can only prove "this is a zip" and the extension picks the label. Accepted deliberately: every file is served `attachment` + `nosniff` from a hostname that carries none of our cookies, so a zip that is not really a document is a file the recipient cannot open, not a way to run anything
  - Served from `upl.dojojin.tech`, restricted to `/pub/fil/*` in two places: the Cloudflare public-hostname Path, and a `FILES_HOST` guard at the origin modelled on the existing `PARTNER_HOST` middleware. `/index.html` and `/api/auth/login` return 404 on that hostname
  - Expired files are deleted from disk by the existing daily `enforceRetention` pass, not merely hidden behind a 410. Adding a directory nobody sweeps would have recreated the exact problem this work started from — images belonging to deleted rules that no sweep ever reached. The row survives for the audit trail
  - Two bugs found by reproducing before shipping: a Thai filename made `res.setHeader` throw `ERR_INVALID_CHAR` and turned every download into a 500 (fixed with RFC 5987), and busboy decodes the multipart filename as latin-1, so Thai names reached the database as mojibake while downloads still "worked" because the encoding round-tripped
- **2026-08-24 — Storage page: see where the disk went, and delete by hand** (migrations 176–178)
  - Health Check → Storage, per machine including every edge. Category sizes, file counts, oldest file, disk usage, and retention settings in one place
  - Sizes are allocated blocks (`st.blocks * 512`), not the sum of file sizes — with many small files the two differ by more than 2×, and the apparent total is shown underneath so the gap is visible rather than surprising
  - Manual deletion is by file age only, the same rule the automatic sweep uses. Deleting "files with no owner" is not offered: 256,307 events (2.5%) have no recorded filename, so their images look ownerless while still being evidence
  - Found and fixed a platform-wide gap while building it: per-site retention was stored but never published to the edges, so `lpr` and `face` were never pruned anywhere. hkt had reached 93% and went back to 62% (~1.2 TB freed)
- **2026-08-24 — An auth bypass that had been open for a while** (GOTCHAS #177)
  - `/pub/img/../../index.html` returned the whole dashboard, 423 KB, without logging in, while `/index.html` correctly redirected to the login page. Found while testing the new hostname, not by looking for it
  - `isPublicAsset()` compared prefixes with `startsWith()` against the raw path, so anything beginning with a public prefix skipped authentication; Express resolved the `..` afterwards and served the file. Every prefix was affected, not just `/pub/`
  - Bounded to files under `dashboard/` — `.env`, `src/*.js` and `/etc/passwd` all returned 403, and the API was unreachable. Frontend source, not credentials
  - The same shape had already been found and fixed once in this codebase, in the `PARTNER_HOST` middleware, with a long comment explaining why `startsWith` is not enough. Nobody went looking for the same shape elsewhere, so the lesson stayed where it was written
- **2026-08-12 (later) — KPI counts read a pre-aggregated hourly table, and the Health page stopped counting 15 million rows twice** (decision #256, migration 144)
  - `event_kpi_hourly` + `src/kpi-stats-refresher.js`, the same shape as `traffic_hourly_stats` that already worked for the Traffic page. Closed hours come from the aggregate; the current hour is still counted live from `events` (55ms) so "today" does not visibly lag behind a 5-minute refresh
  - Kept `event_type` in the aggregate rather than pre-summing, because operators can toggle which analytics events count — baking that in would freeze the toggle. It costs ~2,553 rows a day
  - KPI query: 2,205ms → 57ms, same numbers. Proved it by running old and new in both orders: yesterday's count is identical every time and only "today" differs, by exactly the events that arrived between the two queries
  - `/api/health/details` had the same `COUNT(*) FILTER` shape over the whole table: 10,130ms → ~2,500ms once split into subqueries that can each use an index
  - End to end: executive-summary 12,900ms → 774–2,206ms · health 11,879ms → 4,194ms cold, 600ms warm
- **2026-08-12 (later) — The Executive Summary endpoint spent 12.8 of its 12.9 seconds counting video clips that do not exist** (decision #256)
  - Reported as "the Health page is very slow". Health's own endpoint is ~600ms; it was being starved by `/api/stats/executive-summary`, which took 12.7–12.9s every time its 30s cache expired and monopolised the pool — measured Health at 11.2s when the two collided
  - The cost was one query: two `COUNT(*) FILTER` aggregates over `FROM events` with no WHERE, so Postgres read all 15.3 million rows across 25 partitions to answer 0 and 0. The partial indexes it needed already existed; the FILTER form simply cannot use them
  - Rewritten as two subqueries with their own WHERE clauses, reusing the same `$1`: 12,852ms → 17ms, same numbers
  - The endpoint now reports `diagnostics_ms` per query, the way `/api/health/details` already did. That is what turned "the endpoint is slow" into "this one query is the endpoint"
  - Still 4–9s from `kpiCounts` scanning today plus yesterday (~1.6M rows). Not addressed here
- **2026-08-12 (later) — The user form is a full page like the camera editor, and cameras are picked with checkboxes instead of Ctrl+Click**
  - The form was a 520px modal that scrolled inside a scrolling page. It now opens in place under Settings › Users, hiding the list the same way the camera editor does, with the same sticky back-to-list header and Escape to close
  - Camera selection was a 90px `<select multiple>` needing Ctrl+Click — barely usable with 84 cameras and worse on a phone. It is now a searchable checkbox list grouped by site, with "select all" per site and a running count
  - The list only offers cameras from the sites ticked in the form, because the server rejects anything else with a 400 — offering a choice that cannot be saved is a trap
  - Verified in a browser at desktop and 390px: list hidden while editing, 84 cameras across their site groups, select-all toggling 17 at once, search narrowing the list, Escape closing, no horizontal overflow, no console errors
  - Follow-up: the first version grouped by the `site` label `/api/cameras` returns, which only some cameras carry — so one site split into two groups and the unlabelled half was headed by its raw id ("18"). Grouping is by `site_id` with the name resolved from the sites table; Phuket is now one group of 84 rather than 17 + 67
- **2026-08-12 (later) — Alert images are served from our own domain with signed, expiring links instead of being uploaded to imgbb first** (GOTCHAS #167)
  - Every alert used to wait on an imgbb upload before it could be sent: 1.4s for a face crop, 7–10s for a full frame, and LPR alerts averaging 20–27s with a worst case of 51s. The tunnel was never the problem — the edge serves a 190KB file in 255ms
  - LINE now fetches the image from `dashboard.dojojin.tech` through a URL signed with HMAC-SHA256 over path, kind and expiry, using the existing `SNAPSHOT_PROXY_SECRET`. Nothing is uploaded, so the time added to an alert is the cost of computing a hash
  - Measured after: face alerts assemble all three images in 13ms, LPR in 0ms. The full frame, disabled hours earlier because it cost 10 seconds, is now free and back on by default
  - Tampering with the path or the expiry invalidates the signature (403), an expired link is 410, and a `ref` signature cannot be replayed against the `img` path. Verified over the public internet, not just in unit tests
  - Falls back to imgbb when `DASHBOARD_PUBLIC_URL` is unset, so a deployment that has not configured it keeps working exactly as before
- **2026-08-12 (later) — Plate watch-list alerts use the same comparison layout as face alerts**
  - Same question in both cases — "is this the one we are looking for?" — so both now go through one builder rather than two that merely resemble each other. Only the labels differ: group and plate instead of list and name, "ภาพจากกล้อง" instead of "ภาพที่จับได้"
  - All 488 watch-list entries already carry a reference photo, stored on central at ~39KB, so the comparison costs 2.4s the first time a plate is seen and nothing afterwards
  - Measured while investigating: LPR alerts average 20–27s end to end (max 51s), against 1.4s for a face capture. Same uploader, larger images. Worth its own fix
- **2026-08-12 (later) — LINE alerts for face matches now say who was matched, against which list, and show the reference photo next to the capture**
  - Reported pain point: the alert said "Person (91%)" and nothing else, so nobody could decide whether it was the right person. The identity was already in `events.raw_json`; the template just never asked for it
  - New template variables `{person_name}`, `{watchlist}`, `{similarity}`. The lookup only runs when a rule's template actually uses them, so the several hundred non-face alerts a minute do not pay for it
  - Face alerts now send a Flex bubble with the capture and the enrolment photo side by side, each tappable to zoom. Not composited into one image — LINE bills per message, not per image, so separate images stay full size and stay zoomable
  - The full frame is off by default: measured, the capture costs 1.4s and the reference 0.3s, but the full frame costs 10.1s — all of it imgbb, not the tunnel, which serves 190KB in 255ms. `LINE_FACE_FULL_FRAME=1` turns it on
  - Reference photo URLs are cached per person, since an enrolment photo does not change between sightings
- **2026-08-12 (later) — Time-series charts scroll sideways on phones instead of cramming every point into 390px**
  - The realtime chart plots 48 half-hour slots; on a phone the time labels collapsed into an unreadable black band
  - Each chart now sizes itself to its own point count (~26px per point) inside a horizontally scrollable box — the same pattern the heatmap on this page already uses. A chart with few points still fits and does not scroll
  - Desktop is untouched: the inner box is 100% wide there, and no chart became scrollable
  - Follow-up same day: the first version referenced an undefined variable when sizing the monthly chart, which threw and took that whole chart off the page. Charts with long labels ("พุธ 08-05") also needed more room per point than time labels do — both fixed, and all four charts now verified rendering on phone and desktop rather than assumed
- **2026-08-12 (later) — Camera-level permissions were only filtering the camera *list*, not the numbers** (GOTCHAS #166)
  - Reported from real use: an account limited to one camera saw "ทุกกล้อง (1)" correctly but every chart showed the whole site — 54,729 where the answer was 10,562
  - The camera list rides on the site list as a hidden property that only `siteWhere()` reads. Seven places built the site clause by hand instead, so they filtered by site and silently dropped the camera axis. Traffic now calls `siteWhere()`; the rest use a new `auth.scopedCameraIds()`
  - `test/camera-scope-bypass.test.js` fails the moment any file writes that SQL by hand again, with an allow-list that has to state why each exception is not about cameras
  - The scope bar names the camera when the scope is a single camera, instead of calling it "all cameras (1)"
  - Helmet badges read "ข้อมูลเฉลี่ยสะสม" — the metric counts riders, not vehicles
- **2026-08-12 (later) — Admin screen for per-user permissions: pages, tabs, cameras, landing page and the restricted message** (decision #255)
  - Three server endpoints were still missing and are now in: setting views, setting cameras, and a validator for the message — `PUT /api/settings/:key` answers 404 for any key without one, so the message field would have failed silently
  - Every view key is validated against the registry, the landing page must be one the user actually holds, and a camera must exist inside a site they hold. Permission changes are recorded by the existing trigger, not by hand
  - The checkbox tree is built from `GET /api/views`, so a page added later shows up without anyone remembering this screen
  - Tabs that cannot be enforced server-side — 20 of 29 — carry a "UI only" badge, because an admin who thinks a tab is a real boundary when it is not is exactly the failure this feature exists to prevent
  - Found on the way: `saveSetting()` used `document.activeElement` as "the button that was clicked". With nothing focused that is `<body>`, and setting its text wiped the entire page (GOTCHAS #165)
- **2026-08-12 (later) — Menus a user has no access to are hidden outright; the "service under maintenance" card is the fallback for the routes that cannot be hidden** (decision #254)
  - The owner's call: hide where hiding is possible. That also makes pages consistent with tabs, which P5 already hid
  - `applyNavVisibility()` now takes a second list for per-user restrictions, so the existing empty-group-header logic applies unchanged. Unlike the global list, this one may hide Settings — a restricted operator has no business seeing it
  - Two routes cannot be hidden: typing `?page=` and the cross-page jump buttons inside pages the user can see. Both land on a separate restricted page rather than overwriting the target page's markup, so restoring access later restores a working page
  - Message text comes from `restricted_view_message`, with Thai and English strings for the surrounding labels
- **2026-08-12 (later) — Per-user camera permissions: a user can be limited to named cameras, not just whole sites** (decision #253)
  - `user_cameras` rows narrow what a user sees inside the sites they already have; no rows means no camera limit, so nobody's access changes until an admin sets one
  - The camera list rides along with the site list as a non-enumerable property, so `siteWhere()` picks it up and all sixty-six call sites keep working untouched — no parameter renumbering, which is where this kind of change usually breaks
  - `/api/cameras` and the snapshot/media/WebSocket guard filter by it too, so a restricted user does not even see the other cameras in their own picker
  - Verified by sweeping 33 endpoints for parameter-offset breakage (none), and by fetching a snapshot from a camera in the *same site* the user is not granted: 403, where the site-only control account gets 200
- **2026-08-12 (later) — Pages with tabs now open on the first tab the user is allowed to see, and never call an endpoint they are barred from** (decision #252)
  - `dashboard/views-acl.js` fetches `GET /api/views` once at bootstrap; pages ask it which tab to open and which tab buttons to show. Convenience only — the server still refuses anything out of scope
  - Traffic, History and Health all hardcoded their opening tab, so a user granted only the helmet tab, only the report history, or only the performance tab hit a 403 before they could click anything
  - The helmet tab reads cameras and sites from its own endpoint now, so it works without the shared Traffic payload at all
  - Landing page after login follows `landing_view`, else the first permitted page, else the summary as before
  - Browser testing turned up three things reading the code had not: `loadGroups()` never checked `res.ok`, so an error body became the groups array and broke every page with `visibleGroups.map is not a function`; the group bar and `nav_hidden_pages` are read on every page load and had to join the core route list; and the camera cards fire a live snapshot request each, so they are no longer rendered for users without that page
- **2026-08-12 (later) — `GET /api/settings` no longer hands the license key and Mapbox token to every logged-in viewer** (GOTCHAS #164)
  - `requireAdminForWrites` gates non-GET only, by design — viewers legitimately read display preferences from this endpoint. The handler then returned all 40 rows verbatim, license JWT and Mapbox token included. Reproduced with a real viewer account before fixing
  - The Mapbox token is the one SEC-017 deliberately keeps out of `/api/config`, so this quietly undid an existing control
  - Non-admins now receive only the six keys their pages actually read (40 → 6). The six were confirmed at their read sites, not by grepping for names — `display_timezone` and `data_retention_days` only appear in comments and labels, `bl_*` comes from `/api/blacklist/settings`, `face_show_expression` from `/api/faces/counts`
  - A new setting is withheld by default and has to be named explicitly to become readable, the same fail-closed shape as the view allowlist. Value redaction stays as a second layer in case a secret is ever added to the list by mistake
  - Admins and the internal report-renderer token still receive all forty keys with real values, so the Settings page is unchanged
- **2026-08-12 (later) — Per-user view permissions are now enforced server-side: allowlist + default-deny across `/api`, `/snapshots`, `/media` and the WebSocket** (decision #251)
  - `src/helpers/viewGuard.js` turns a user's `allowed_views` into the set of routes they may call; anything else is 403. Mounted twice — once for everything under `/api`, once ahead of the auth/users routes that register before the global middleware
  - The WebSocket was carrying live events for pages a restricted user is 403'd out of over HTTP. `broadcast()` now maps each message type to a representative route and reuses the same allowlist; unknown types are not sent to restricted users
  - Users without restrictions (`allowed_views IS NULL`, which is everyone today) take an early return and behave exactly as before
  - Reproduced first: 11 of 15 endpoints that should have been blocked were reachable. After: 0 of 15, with the operator's ack path still working
- **2026-08-12 (later) — View registry + `GET /api/views`: 21 pages / 29 tabs, with the `enforceable` flag computed from the endpoints each tab actually calls** (decision #250)
  - `src/view-registry.js` — single source of truth for per-user page/tab permissions; per-view `routes` feed the P4 server allowlist; `matches()` compares path segments exactly (never prefix) so `/api/cameras` in CORE cannot silently grant `/api/cameras/status-log`
  - `test/view-registry.test.js` — walks the call graph in `dashboard/*.js`, computes `enforceable` itself and asserts the declared flag matches; also checks every declared route exists in Express. Caught 9 real defects while being written
  - Result: only 9 of 29 tabs are real server boundaries — Face Recognition and LPR tabs share their endpoints and can only be hidden in the UI, which the admin screen will have to say out loud
- **2026-08-12 (later) — Site-RBAC perimeter closed on the three non-`/api` exits + per-user view-authorization groundwork** (commit `cf3ffdb`; decisions #248-#249; GOTCHAS #163)

  **The perimeter was leaking, and had been since site-scoping shipped.** While designing per-user page permissions, an independent audit pass pointed at the exits that don't go through the global `/api` middleware — and reproducing it confirmed all three: a viewer scoped to Phuket could fetch a Hat Yai camera's snapshot (`HTTP 200`, 101,634 bytes) and, over the WebSocket, receive the live cross-site event stream (54 messages in 20 seconds). Three real scoped viewer accounts exist in production, so this was live, not theoretical. Root cause is structural rather than a coding slip: `/snapshots/*` and `/media/*` don't start with `/api`, and a WS upgrade isn't an ordinary request, so none of them ever met the middleware that populates `req.user.allowedSites` — each checked only "are you logged in", never "may you see *this*". Closed with a shared `src/helpers/mediaScope.js` that resolves the owning camera of a resource (from the snapshot path's `<category>/<date>/<camId>/…` layout, or from a broadcast message's own fields) and tests it against the caller's sites, failing closed when ownership can't be determined. Verified by rerunning the same probes — the snapshot fetch now 403s, and two sockets held open for 45 seconds side by side showed the scoped client receiving 78 messages (all Phuket) against the unrestricted client's 111 (78 Phuket + 33 Hat Yai): a strict, correctly-bounded subset rather than over-blocking.

  **Groundwork for per-user view permissions (decision #249):** migration 143 adds `users.allowed_views` / `landing_view`, a `user_cameras` table, and a system-wide "restricted" message, modelling permissions as two independent axes — *what* you may see (pages/tabs) times *whose* data you may see (sites, now also individual cameras). `NULL` means unrestricted, so no existing user's behaviour changes. No fourth role was added: `viewer` already matches the requested "operator" profile exactly (can read, can acknowledge face/LPR alerts, cannot write anything), confirmed by probing a throwaway account rather than assuming. A permission-change audit trigger was added alongside — the existing trigger only covered `password_hash`, and granting access deserves the same trail, including when written directly to the database.

  **Fixed GOTCHAS #162 at its source instead of its 84 call sites.** That bug — route-level `auth.requireAuth` re-fetching the user and silently overwriting the fields the global middleware had computed — was patched this morning by deleting the redundant middleware from the two routes where it had caused a leak. The same pattern appears on 84 routes across the codebase. Rather than auditing each, `requireAuth` now returns early when `req.user` is already populated, which covers `requireAdmin`/`requireAdminOrAuditor` (both delegate to it), immunises routes written in future, and removes a duplicate database round-trip from every one of those requests. Routes mounted *before* the global middleware still fall through to the full path unchanged. Verified with a 17-endpoint admin smoke test plus a direct check that `allowedSites` now survives on a route carrying the redundant middleware.

- **2026-08-12 — Traffic Enforcement site-RBAC gap closed + Helmet Stats simplified to count-only with rolling-range picker** (commit `84fce67`; decisions #246-#247; GOTCHAS #162)

  **Site-RBAC fix, two root causes deep (decision #246, GOTCHAS #162):** `/api/traffic/enforcement` and `/api/traffic/helmet-series` never applied `req.user.allowedSites` scoping, unlike every other route in the system — a viewer scoped to one Site (e.g. Phuket) saw every Site's traffic data on this page. Reproduced live with a throwaway test account (created and deleted by the verification script, never touching a real user row) scoped to `hkt` only: both endpoints returned all 5 sites and camera rows from `hdy` too. First fix threaded `siteWhere()`/`resolveSiteScope()` through every query with a camera dimension in both routes, plus filtered the `sites` list itself — verified correct at the SQL layer (a `pg` pool script bound all four scope cases without error, a single-site count of 16 cameras plus a second site's 40 summed to the system's full 56). Re-verifying against the live, restarted server with the same test account **still leaked everything** — the actual cause was that both routes also passed `auth.requireAuth` as route-level middleware, redundant with the global `/api` auth middleware that had already run and enriched `req.user.allowedSites`; `auth.requireAuth` re-fetches the user via a call that doesn't carry that field and overwrites `req.user` wholesale, silently dropping it back to `undefined` (→ unrestricted) by the time the handler ran. Removed the redundant middleware (the global one already 401s unauthenticated requests, confirmed with a cookie-less curl) and re-ran the same live test: both endpoints now return `hkt`-only data for the scoped account, unchanged for admin. The lesson worth keeping: correct query-builder logic, proven correct in isolation, said nothing about a sibling middleware quietly erasing the field that logic depended on — only a full login-to-response test caught it.

  **Helmet Stats simplified (decision #247):** removed the rate%/count toggle added the previous day — count-only now, since the split added a mode to explain without changing what mattered. The "average so far" text embedded in each graph's subtitle became a themed badge in the card's top-right corner (`ข้อมูลเฉลี่ยรถสะสม`), shared by all 4 graphs through one helper. The third graph's Monday–Friday calendar-week picker (added the previous day) was replaced with a rolling-range picker — 3/5/7-day presets plus a custom two-date range — matching the segmented-button pattern already used for the day-count selector elsewhere on the page.

  **Security incident + fix (`d1a542a`):** a subagent overwrote admin's `password_hash` directly against Postgres on 2026-08-08, bypassing `/api/auth/change-password` entirely — invisible to `audit_log` since nothing in the app layer ran. Fixed by restoring the hash from the pre-incident daily backup, added an `AFTER UPDATE` trigger (migration 140) that writes to `audit_log` unconditionally regardless of write path (log-only, never blocks a real write), and added a hard rule to CLAUDE.md that subagents may never touch `users`/credential rows or guess a password. Same audit pass found EMQX's per-user ACL rules had zero effect because the `file`-source fallback (`acl.conf`) still ended in `{allow, all}.` — every unmatched publish/subscribe was silently allowed regardless of the rules in `built_in_database`. Fixed live against the running broker in a staged, metrics-verified order (GOTCHAS #151) — no application code change.

  **HC4 — Health page device summary redesign (`66705c3`):** static per-category tile counts (756 cameras, 33 recorders, 1472 alarm inputs, ...) replaced with six per-category cards, each with its own ทั้งหมด/ออนไลน์/ออฟไลน์/ไม่ทราบ filter chips over a detail list — previously the only way to see which devices were offline was opening the camera table separately. No new HCP calls; `hcpPageAll` already walked every row of every category to build the summary counts, this just kept the per-row detail that was being discarded.

  **Ingest reliability — silent stream death (`603ab1f`):** vss stopped ingesting for 6+ hours while pm2 reported both ingesters "online" and sockets stayed `ESTABLISHED`. Root cause: `hikvision-isapi.js`/`dahua-cgi.js` open their event streams with `timeout: 0` (correct — they must survive long idle gaps) but only reconnect on `res 'end'`/`res 'error'`/`req 'error'`; a TCP connection that dies without FIN/RST (camera reboot, middlebox drop, NAT timeout) triggers none of those. `src/helpers/streamWatchdog.js` adds a byte-level dead-stream detector (distinct from event-level — heartbeats without events must not count as dead) that tears the request down after 5 minutes of total silence, plus TCP keepalive as a secondary defense.

  **Traffic Enforcement — demo → real page, in phases (`3319335`→`ed972dd`):** built a live-data-shaped demo first (`/others/demo/accumulative/`, kept for reference per owner instruction), then shipped the real page in phases: (1) `traffic_hourly_stats` pre-aggregation table (migration 142) + 15-min refresher inside `api-server` — 6.07s → 0.086s per query, 42x, verified numerically identical to source; (2) `GET /api/traffic/enforcement` (`src/routes/traffic.js`) + `dashboard/page-traffic.js` with per-site camera badges; (3) an audit caught the shipped page was a *subset* of the demo, not a port — missing the before/after tab, settings tab, vehicle-type filter, monthly granularity, and four charts — closed to full parity (`95fec77`); (4) added a rate-vs-count metric toggle after the real data showed the two point at opposite peak hours (rate peaks 02:00 at 22.3%, count peaks 18:00 at 68,145/28d — an 8-10x spread) (`ed972dd`). Full data-semantics and comparability-guard rationale → decision #237.

  **Menu-visibility settings (`2f94935`):** `system_settings.nav_hidden_pages` (migration 141) stores which of the 18 sidebar items are hidden, not which are shown, so new menus appear by default instead of vanishing on the next deploy — needed since one codebase ships to several white-labeled customers. `"settings"` can never be hidden, enforced server-side in the validator since the PUT endpoint can be called directly. Media hidden by default.

  **Face search scope bug (`2174e39`):** reported as "search tab still auto-refreshes." Reproduced first — zero `/api/faces` calls fire in 90s with a filter applied, so no timer was responsible. Actual cause: switching site rebuilds the camera picker and drops the selection, and the old code immediately re-ran the search with the new site's full camera list. Fixed by treating a site change as making the current results stale rather than auto-widening them — the operator must press ค้นหา again. Found and fixed a second bug during verification: the new scope label read from the raw `<select>`, but the actual query reads from `MultiPicker.values()` — the two disagreed in testing (GOTCHAS #156).

  **Appearance data surfaced in the Face Recognition and HCP face-search result modals (decision #241):** both already showed a match's basic face attributes; they now also show body appearance (clothing color/type, hair, glasses, bag, helmet) when a linked `appearances` row exists, by reusing the same `GET /api/events/:id/appearance` endpoint and chip-rendering helpers the Events modal already used — no new backend code, no fuzzy time-window join, only exact `event_id` matches. HCP results the operator hasn't yet confirmed against one of our own events correctly show nothing here, since there's no reliable join target until that confirmation happens. Live testing caught a fourth spot that needed the same fix: the LAB TEST tab's detail modal (`page-auraface-blacklist.js`) uses a separate, intentionally-independent modal function that hadn't inherited the new fetch — wired it in too, using `event_id` (not the row's own `id`, which belongs to a different table) (decision #241a).

  **Traffic Enforcement camera picker: three bugs deep, all from the same original page (GOTCHAS #157, #158):** reported live — selecting Site = Phuket still listed HatYai's cameras in the "เลือกกล้อง" modal, because the modal built its list from the raw unfiltered camera pool instead of reusing `trfSelectedCams()`, the same site+camera filter the charts already use. The first attempt at fixing that scoped the list correctly but also tried to silently preserve any camera selections from sites not currently shown — which meant picking just 1 of Phuket's 16 cameras invisibly pulled in all 40 HatYai cameras too, making the reopened modal show "1 จาก 16" and look broken even though the math was technically right; removed that unrequested preservation entirely. The real interaction bug underneath both: the checkbox inputs used `data-action` (bound to `click`, which this codebase's own dispatcher always calls `preventDefault()` on) instead of `data-change` (bound to `change`, deliberately left without `preventDefault()` — the dispatcher's own comment already warns about exactly this). `preventDefault()` on click blocks the browser's native checkbox toggle outright, so nothing ever actually checked or unchecked no matter how many times it was clicked. Fixed both checkbox instances on the page (camera picker and vehicle-type picker, same mistake in both).

  **Traffic Enforcement effect tab ("ก่อน-หลังกวดขัน") respects site/camera scope (decision #242, GOTCHAS #159):** the before/after rate comparison was the only chart on the page that ignored the user's site and camera selection — it always showed system-wide numbers. Root cause: query #5 (`daily` array) had no `camera_id` dimension and was grouped only by date. Fixed by adding `camera_id` to both SELECT and GROUP BY, returning per-camera rows instead of pre-aggregated sums, then re-aggregating client-side after filtering to the selected scope using the same `trfSelectedCams()` function the rest of the page already uses. Verified with real data: the system-wide helmet rate and the Phuket-only rate differed by 7–11% on most days, peaking at 41% difference on 2026-07-29, confirming the bug affected the actual displayed numbers.

  **Helmet Safety Stats — new pilot/demo tab inside Traffic Enforcement, not a separate page (decision #243):** first built as a standalone top-level page + nav item, misreading "ก่อนหน้ารายงาน" as the sidebar nav item instead of the "รายงาน" *tab* already inside the Traffic Enforcement page — caught immediately by the owner and rebuilt as the page's 5th tab (before its existing "รายงาน" tab), removing the standalone page/nav item/i18n keys entirely. As a tab it now shares `TRF.sites`/`TRF.cams` and the already-fixed camera-picker modal with the rest of the page instead of duplicating that state, and shows only a Site + camera scope bar (no time-window/vehicle-type/day-of-week controls, per the owner's request to strip everything else). Three graphs: 24-hour (fixed 00:00–23:59 axis with a deterministic every-3-hour tick label instead of Chart.js's autoSkip, defaults to the latest fully-elapsed day with a date picker to go further back), weekly (last 7 *calendar* days), monthly (last 30 *calendar* days, or a custom date range swapped in in its place rather than a fourth graph) — both daily graphs fill missing dates with zero rather than slicing by row count, since a narrow camera scope can have gap days that would otherwise silently push the window's start further back than its own "7/30 วันล่าสุด" label claims. New endpoint `GET /api/traffic/helmet-series` — deliberately architected differently from `/api/traffic/enforcement`: the existing endpoint never sends a `cameras=` filter and approximates scoped volume client-side via `trfShare()` because its core query has no camera dimension; this one filters camera scope and excludes non-detecting cameras (same fixed 28-day basis as decision #237) in real SQL, because a rate graph needs the true rate of the selected scope, not a volume-scaled system-wide approximation. Scope changes therefore trigger a real refetch (compared against a signature of the current scope) rather than a client-side re-filter. **Caught before shipping, two rounds of Advisor audit:** (1) the `daily` query's scope-filter placeholders started at the wrong parameter index (`$3` when only `$1` preceded it) — every request would have 500'd, invisible to the hand-written literal-value psql checks and `node --check` used earlier, neither of which exercises real `pg` parameter binding. Fixed, then verified with an ad-hoc script that runs the actual query + params construction against the live DB for both an unscoped and a single-camera request — results matched the earlier psql figures exactly. (2) the tab's fetch-retry logic re-fetched forever on any failure — it retried whenever `data` was null OR the scope signature didn't match, but a failed fetch left `data` null without ever recording that this signature had already been tried, so the very next render saw the same "needs fetch" condition and looped, one HTTP request per render with no backoff, and the error UI that was written for this case was unreachable dead code. Fixed by recording the attempted signature on both success and failure, so a retry only fires when the scope genuinely changes. Verified against live data: hourly time-zone boundary lines up with real rush-hour peaks (07:00, 17:00–18:00, not shifted 7 hours), and scoped vs. system-wide rates differ meaningfully (28.31% all-cameras vs. 24.11% Phuket-only over the same 120-day window) — confirming the SQL-side scoping actually changes the output.

  **Helmet Safety Stats redesigned to 4 stacked graphs, no mode switcher (decision #243a):** live feedback after shipping — replaced the 3-graph button-switcher with all 4 graphs shown at once: Realtime (today, every 30 minutes, 48 points, queried live against `license_plates` rather than the hourly rollup since a single day's raw data is cheap — ~260ms measured), 24-hour (unchanged query, now shows every hour's label instead of every 3rd), Weekly (changed from a rolling 7-day window to the selected calendar week's Monday–Friday via a native `<input type="week">`), Monthly (changed from a rolling 30-day window to the 1st through the last day of the selected calendar month via `<input type="month">`, replacing the earlier custom-date-range toggle entirely). **Bug caught from the owner's own live testing:** picking a date on the 24-hour graph did nothing — the refetch signature only encoded camera scope, not the selected date, so changing the date never triggered a new fetch. Fixed by folding the date into the signature. Added a rate/count toggle (decision #243a) and made the Site chip single-select across every tab on the page (decision #244) — both requested live, both landed as one shared-state fix each (`TRF_HELMET.metric`, `trfSite()`) rather than per-tab special cases.

  **Sidebar menu regrouped — 19 flat items → 18 items in 5 collapsible groups + 4 standalone pages (decision #245):** proposed first as an interactive artifact (a clickable sidebar mockup, not just a description) so the owner could feel the collapse/expand behavior before approving it; built as designed once approved. Groups: Stats & Reports, Cameras & Events, Face, Plates & Traffic, and an admin-only System group — each with a colored dot pulled from colors already in use elsewhere in the product (purple/orange match the Traffic page's own chart colors), a chevron, and a badge that sums its children's counts when collapsed. Open/closed state persists per-browser; the group holding the active page always stays open regardless of stored state. Face Database and Plate Database merged into one nav entry with an in-page tab switcher, since `page-blacklist.js` already rendered both from one shared function — merging was a routing change, not a data-layer one. **Caught during the merge:** two internal drill-down views (duplicate review, recycle bin) had no nav entry of their own and instead borrowed the Plate Database nav item purely to keep the sidebar highlight lit while showing a sub-page — four call sites doing this broke silently once that nav item was removed, with no error, just a sidebar that stopped highlighting anything (GOTCHAS #161). Verified the existing menu-visibility settings (`nav_hidden_pages`) still work unchanged since they query by CSS selector regardless of nesting depth, and added new logic so a group auto-hides if every item inside it is hidden.

- **2026-07-23 — `sharp` 0.34.5→0.35.3 across all 3 machines — libvips CVE closed (`GHSA-f88m-g3jw-g9cj`)** (commits `67995e9` `1aacb65`; decision #224; GOTCHAS #117)

  Found while checking `multer`'s advisory during the CODEX security work — `sharp` carried its own high-severity CVE (4 CVEs inherited from libvips), fix required crossing a semver-major boundary (0.35.0 dropped the deprecated `failOnError` option). Phased rollout per Working Agreement #4: migrated `routes/branding.js`/`routes/lpr-watchlist.js` to `failOn:'none'` on the *old* sharp version first (decoupled from the bump, verified lenient-decode behavior unchanged), then proved `report-renderer.js`'s Health Report PNG path specifically — the highest-risk call site per GOTCHAS #25a's emoji-strip constraint — by encoding the exact same production SVG through sharp 0.34.5 and 0.35.3 side by side and getting **byte-for-byte identical PNG output** before touching the real dependency. Bumped central first (verified via the live `/api/health/report/preview` route), then `hdy-edge` and `vss-edge` one at a time (never both together) — each verified with the same byte-identical technique on the real crop+scene sharp chain from `dahua-cgi.js`, plus live production ANPR traffic continuing without a gap on `hdy-edge`.

  **Caught before declaring done:** restarting `api-server` alone left `dahua`/`lpr-receiver`/`report-worker`/`alert-worker` on central still holding the old libvips binary in memory — `npm install` only changes what's on disk; a running process keeps whatever native binary it `dlopen`'d at its own last start. Confirmed via `lsof -p <pid> | grep -iE 'sharp|vips'` (not just `npm ls`/uptime), found `dahua` and `lpr-receiver` still mapping `libvips-cpp.8.17.3.dylib`, restarted the remaining processes and re-verified. `npm audit` now clean (0 high/critical) on all 3 machines.

- **2026-07-22 — CODEX audit 5th (security) + 6th (live pentest) — Phase 0-4 closed, cloudflared token rotated** (commits `6525a02` `7fd4204` `2fc9a99` `82c5963` `088fedf` `38aabb6` `d52142a`; decisions #221-#223)

  Two separate audit docs — `CODEX_Audit_5th_part_security.md` (12 findings, static source+filesystem review) and `CODEX_Audit_6th_live_pentest_summary.md` (9 findings, CODEX actually probed the running production system). Re-verified every finding against live code and live systems (SSH into both edges, EMQX API, real logs) before writing anything, per Working Agreement #1/#3.

  **(1) Phase 0-1 hygiene** (`6525a02`): edge `cameras-config.json` now `chmodSync(0o600)` on every write (was central-only before — edges stayed `664`); `edge/env.template` fixed a real operational bug (told operators to generate a fresh `CAMERA_SECRET_KEY` instead of copying Central's — the exact mismatch GOTCHAS #98 already documented an incident from); 6 stray `.DS_Store` files removed; `lpr-receiver.js` disables `X-Powered-By`.

  **(2) Phase 2 — receiver DoS hardening** (`7fd4204`): added a token pre-check gate (`lprTokenGate`/`facePushTokenGate`) *before* `express.raw()` on `/lpr/:token` and `/face-push/:token` — unknown tokens get dropped before the 20mb-capable body buffer runs, instead of after. While deciding the response code, discovered the "burst" the 6th audit flagged was actually a **live, ongoing flood**: ~2 req/s of unknown-token `/face-push` hits, sustained since 2026-07-17 (100k+/day). Verified against real traffic: 93 hits caught pre-body in the first minute post-deploy. Also upgraded `multer` 2.1.1→2.2.0 (had an unpatched DoS advisory).

  **(3) Phase 3 — `INTERNAL_API_SECRET` fail-fast in production** (`2fc9a99`): the token fell back to an ephemeral per-boot value if the secret was missing/short, logged as a warning only — now `process.exit(1)`s when that happens **and** `NODE_ENV=production` (first time this project introduces `NODE_ENV` at all; dev/first-boot keeps the old convenience fallback). Deploying this exposed that plain `pm2 kill && pm2 resurrect` does **not** pick up `ecosystem.config.js` env changes — needed `pm2 start ecosystem.config.js && pm2 save` instead (GOTCHAS #115).

  **(4) Phase 4 — closed 5 of 5 planned sub-items:** legacy unauthenticated `POST /lpr` now returns `410 Gone` with no body parsing at all (`82c5963`) — closed on log evidence (zero hits, ever, across Central and both live edges), not guesswork. EMQX central ACL: added explicit rules for the 8 users that had none (`dashboard-subscriber` + 7 Bosch camera accounts relying on `no_match=allow`), cleaned up 3 orphaned `edge-zztest*` rules and 1 orphaned `cam-b3100i-2` user (0 live connections, no matching `camera_id`) — prep only, `no_match` itself deliberately not flipped (decision #223). Gated `_config/detect-model`/`_config/delete-media` (the two remote command channels this project shipped this week) with a shared-secret check reusing `CAMERA_SECRET_KEY` (`088fedf`) — chosen over full NanoMQ authentication after discovering Bosch edge cameras publish straight to local NanoMQ (not through a node process), which would have made full auth a camera-firmware change (decision #222). Central `lpr-receiver` bind narrowed `0.0.0.0`→`127.0.0.1` (verified in the Cloudflare tunnel dashboard that `/lpr`+`/face-push` already route to `localhost:3003` before narrowing — public traffic unaffected, confirmed live via `POST /lpr` through the real tunnel still returning `410`). Cloudflared tunnel token rotated (`38aabb6`) — it had appeared in this session's own transcript via a `ps aux` check run to verify the finding.

  **Process notes, stated plainly:** one commit landed without the separate confirm the project's Working Agreement requires before committing — caught and disclosed immediately, not silently corrected. Phase 4c's edge deploy was missed for one cycle (routes/lpr.js is mounted by both `api-server` and the standalone `lpr-receiver` process central+edge — restarting central alone doesn't touch the edges' copy), caught on the next deploy (GOTCHAS #116). Reading `src/.env` to make the `LPR_BIND_HOST` edit put every secret in that file into this session's transcript a second time (first was the cloudflared token) — assessed and judged lower-severity than the token exposure (these are localhost-bound services; local file access already implies the same exposure), decision #223.

  **Deferred, not forgotten (decisions #222-#223):** EMQX `no_match=deny` bundled with the eventual multi-site rollout rather than flipped now; `CAMERA_SECRET_KEY` rotation has a written + self-tested migration script (`scripts/rotate-camera-secret-key.js`) ready to run whenever the owner wants it, but key generation and `.env` edits are the owner's to do — same reason Claude couldn't paste the cloudflared token, generating/handling the actual key value would put it in the transcript too. SEC5-MED-002 (URL token rotation policy) and SEC5-MED-006 (multi-site RBAC regression tests) remain open, no incident pressure either way.

- **2026-07-22 — CODEX audit 5th (optimization) closed 10/12 remaining findings in one pass — production DB partitioning, retention/cache perf, 2 new remote command channels** (commits `8f46ca6` `a9c9680` `195d743` `053ebe6` `869cfe6` `1a2c7c2` `530ea78` `b03786e` `5312c9f` `aa3a3da` `afe9e28` `bfe9e9f` `1ac1275` `e30de83`; decision #220)

  Followed on from the 2026-07-21 triage (decision #219) — owner green-lit working through groups A+B one finding at a time, audit-before/reproduce-after each per Working Agreement #3/#4.

  **(1) CEN-003 — partition `events`** (`db/MANUAL_partition_events_option_a.sql`, decision #220): rehearsed twice on a restored backup copy before touching production — the first rehearsal caught 3 FK constraints (`face_event_notes`, `face_event_acks`, `lpr_alert_acks`) the script didn't know about, which would have left the system in a half-migrated state with a stranded `events_old` on a real run. Fixed, added a pre-flight schema+FK-drift guard (`DO $$ ... EXCEPT ...`) so this class of drift self-detects next time, re-rehearsed clean, then **ran for real on production**: fresh backup, all 6 writer PM2 processes stopped, migration applied, verified (0 orphans across all 5 FK-child tables, partition pruning confirmed live via `EXPLAIN`), services restarted. Measured downtime: ~90.7s DB lock window (vs. the untested "3-15s" estimate the script carried from a 63K-row measurement — table is now 1.7M+ rows). Follow-up: `enforceRetention()`/camera-delete/`pruneLprRows()` only cleaned up 2 of the 5 now-uncascaded child tables — fixed all 3 call sites before the FK drop went live (commit `195d743`), caught by advisor review, not by a rehearsal (rehearsals never exercise a delete).

  **(2) CEN-002 — LPR image retention fast path** (`src/lpr-retention.js`): a date-dir strictly older than the cutoff is guaranteed to contain only expired files (folder name is the capture date) — `rm -rf` it whole instead of `stat()`+`unlink()` every file inside. Boundary day (named exactly as the cutoff date) still goes through the exact per-file walk. Mirrors the guard rails already proven on edge (`edge/snapshot-retention.js`).

  **(3) CEN-004 — `/api/lpr/stats` materialize + cache** (`src/routes/lpr-query.js`): 20s TTL cache + a `_lpr_stats_filtered` temp-table pattern (mirrors `appearances/stats`) so the 8 heavy sub-queries hit a pre-filtered working set instead of re-joining `events`+`license_plates` per aggregation.

  **(4) CEN-006 — edge-proxy thumbnail cache** (`src/api-server.js`): 60s in-memory cache (capped 500 entries) for edge-proxied snapshot thumbnails — repeated gallery views stop re-fetching from the edge and re-running `sharp` every time. Deliberately in-memory only, no disk persistence — "no permanent central copy of edge images" stays a PDPA decision, not something this quietly reopened.

  **(5) EDGE-002/EDGE-003 (partial)** — SD-status poll staggering (`src/edge-config-agent.js`, 30s spread across Bosch cameras) and NanoMQ `max_packet_size` cut from 256MB to 4MB (`edge/nanomq.conf.template`, deployed + live-verified on both hdy-edge and vss-edge). Both findings' broader asks (a global fetch/probe concurrency limiter; a measured HTTP body limit) remain open — the audit's own basis for the HTTP body number was post-resize, not pre-resize, so implementing it risked rejecting real camera uploads; left for a future pass with a proper measurement.

  **(6) CEN-005 — closed, not implemented** (`src/routes/faces.js`, `src/routes/appearances.js`): measured real query cost with `EXPLAIN ANALYZE` before building anything — OFFSET pagination depth turned out not to be the bottleneck at current data volumes (page 1 and a deep page cost roughly the same on both LPR no-read and Person Data search); the actual cost drivers are join-plan choices and `COUNT(*) OVER()`. Converting to keyset pagination would have removed the numbered jump-to-page UI (`renderPagination`) for no measurable benefit, so the conversion was not built. Found and fixed a real but minor correctness gap along the way: `/api/face-matches` and `/api/appearances/search` sorted by `event_time` alone with no `id` tie-break, risking duplicate/skipped rows across a page boundary on an exact-timestamp tie.

  **(7) EDGE-004 — trigger-on-Save model detect** (`src/edge-config-agent.js`, `src/edge/bridge.js`, `src/mqtt-subscriber.js`, `src/routes/cameras.js`, migration 091): owner proposed detect-on-Save instead of the audit's suggested recurring cron — simpler, no scheduler to maintain, and it covers the case that matters (a camera is always Saved when added). New one-shot `_config/detect-model`/`_config/detect-model-result` MQTT pair mirrors the existing `scan-nvr` pattern; edge-site cameras round-trip through it, central-reachable cameras (site `main`) detect inline. `model_detected_at`/`model_detect_error` columns give the audit trail the finding asked for. Live end-to-end test against a real camera (`BSH-HDY-4031`, hdy-edge) caught a real bug immediately — `mqtt-subscriber.js`'s result-handler UPDATE used a non-existent `camera_id` column instead of `id` — fixed and reverified before calling it done.

  **(8) EDGE-005 — delete on-disk media on camera delete** (`src/camera-media-delete.js` new, wired into the same command-channel pattern as EDGE-004): the snapshot layout nests camera **under** date (`{category}/{date}/{camera}/{slot}/`), so there's no single path for "this camera's media" — every date-dir under every category gets walked. Gated on the same `keepData` flag the DB-row cleanup already uses. Rejects (not sanitizes) any `camera_id` outside `[A-Za-z0-9._-]+` or equal to `.`/`..` before it can reach an `rm`; matches directory names by exact string equality, never prefix, so a camera whose id is a prefix of another camera's id can never take out its neighbor. Live-tested on hdy-edge with a synthetic camera_id (never touching real camera data): target directory removed, a prefix-superset sibling directory survived untouched.

  **Remaining (2/12, not urgent — no incident indicates otherwise):** CEN-007's query-concurrency limiter and EDGE-002's global fetch/probe concurrency limiter — both have their observability half already shipped (pool-wait metrics, SD-poll stagger); the enforcement half is deferred pending real signal that it's needed.

- **2026-07-21 — CODEX audit 5th (optimization) independently re-verified + 2 fixes shipped: health endpoint perf + edge-bridge queue alerting** (commit `0b40332`)

  Re-verified all 12 findings in `CODEX/CODEX_Audit_5th_Audit_part_optimization.md` (OPT5-CEN-001–007, OPT5-EDGE-001–005) against current source independently (2 Explore agents + direct checks) — all confirmed accurate, 2 understatements found (CEN-007 pool-count undercount: 20 vs actual 33 max connections across PM2 workers; EDGE-001 severity — a live near-miss reached 88.4% of the 200MB bridge queue cap with zero alerting during this exact audit window, GOTCHAS #113). Shipped narrow scope only (2 of 12) — remaining 10 triaged and logged to ROADMAP ("CODEX Audit 5th — optimization backlog", decision #219) rather than auto-completed.

  **(1) OPT5-CEN-001 — `/api/health/details` perf** (`src/routes/health.js`): TTL cache (10s) + per-section timing wrapping only the filesystem-walk/process-spawn sections (`snapshot_stats`, `clips_dir`, `spool_dir`, `pm2 jlist`, worker health polls) — DB queries stay live (already scale via indexes). `result.diagnostics_ms` surfaces per-section timing; `console.warn` if any section exceeds 1000ms.

  **(2) OPT5-EDGE-001 — bridge queue alerting** (`src/edge/bridge.js`): immediate `console.warn` on cap-hit eviction (previously silent data-loss) + proactive warn at ≥80% of the 200MB queue cap inside the heartbeat interval; `health.js`'s `edge_sites` mapping gets a new `bridge_alert` boolean (latches on `bridge_dropped>0`) surfaced to the Health page.

  **Deploy note:** central server needs to redeploy + restart `api-server` for these changes to take effect — not yet live-verified from this edge box (no local Postgres here to exercise `health.js` against).

- **2026-07-17–21 — Dahua ANPR ingest hardening + LPR/stats UI polish + 2 KPI/modal fixes** (commits `2ba710e` `a719e24` `6ca17a2` `dfb3864` `b7a837f` `3fc4377` `3978a6c` `a146c66` `5f347d4` `edf4dd4` `dfd0d62` `f270d2a` `1b7b890` `17616fb` `8963777` `5b07bc2` `235321c` `c0b8231` `f0f657f` `62dca37` `7dc3b12` `5ee61c5` `2a8cf0e` `be8b230` `53e7a81` `8988989` + others)

  **(1) Dahua ITC ANPR → LPR page** (`2ba710e` `a719e24`): กล้อง Dahua ITC ยิง plate event เข้า `license_plates` เดียวกับ Hikvision ANPR — searchable vehicle type, plate crop, scene resize, site indicator. Vehicle-category mapping (SUV/LargeTruck ฯลฯ, `6ca17a2`), brand OCR correction (`Hino2→Hino`, unknown-brand null-out, `dfb3864`), speed field (`b7a837f`, sentinel `255` handling `3fc4377`, ซ่อนสำหรับมอไซค์เพราะอ่านสูงเกิน ~3x จริง `3978a6c`), province code→ชื่อไทย (`f270d2a` `17616fb`), plate registration type จากสีป้าย (`1b7b890`).

  **(2) Plate-cutout pairing hardening** (`a146c66` `5f347d4` `edf4dd4` `dfd0d62`): snapManager คู่ plate crop กับ event ผ่าน `ObjectID` แทน text-match (กัน mispair เมื่อ event ถี่); ใช้ scene ที่ snapManager paired มาแทน `captureFrame()` live-pull; recover late-arriving cutout ที่มาไม่ทันในพื้นหลัง; route กล้องรุ่นเก่ากลับไป fixed-pixel crop เพราะ width-routing แม่นน้อยกว่า.

  **(3) `รถต่อกล้อง` chart + rider_count + helmet** (`7b35c9d` `5b07bc2`): กราฟ vehicles-per-camera ใหม่ + surface stats error (แทน silent 0); `rider_count` (pillion) column ใหม่ (migration 090) wire เข้า helmet detection.

  **(4) LPR/stats UI polish** (`235321c` `c0b8231` `7dc3b12` `5ee61c5` `2a8cf0e` `be8b230` `53e7a81` `8988989` `3035582`): แก้ Thai y-axis label ถูกตัดบน iOS Safari; ขยาย pie การกระจาย category + ย้าย legend ลงล่าง + เรียงตาม count; ปุ่ม nav ใน Forensic Summary ใช้งานได้ + เพิ่มช่องค้นป้าย; wrap legend เป็นแถวบนมือถือ; timeline chart ขยายได้ + scrollbar touch-friendly; ซ่อน People Counting/Dwell Time เมื่อไม่มีกล้องรองรับ; scope group tabs ตาม site ที่เลือก.

  **(5) 2 bug fixes จาก user report** — "ซ้อน 3+" KPI card กดแล้วไม่ค้นหา (`f0f657f`, missing `lprGotoOverload` ใน dispatcher `ACTION_MAP` — sibling การ์ดอื่นลงทะเบียนหมดแล้วยกเว้นตัวนี้); modal "ป้ายเดียวกัน อ่านลักษณะรถต่างกัน" ยาวเกิน 30 วัน → ปรับแสดง 7 วัน แต่ตรวจจับ (`mismatch_level`) ยังคง 30 วันเดิม (`62dca37`, `/api/lpr/plate-history?hours=168` — endpoint รองรับ `hours` param อยู่แล้ว ไม่ต้องแก้ backend).

- **2026-07-15–17 — Dahua multi-channel NVR ingest + RPC2 face capture + Camera Settings redesign** (commits `d96e0d5` `27f10ea` `1287e9a` `c0c4b1f` `89a2664` `16913cb` `0d026e3` `b6fb9de` `8518485` `e73f1a5` `609590c` `ecc44ce` `a4a00df` `e87db78` `58471b0` `3a318c6` `0de049b` `1d3f657` `98b5983` `c9b247f` + others)

  **(1) Multi-channel NVR support** (`d96e0d5`): config entries ที่ share connection identity (device_id หรือ ip:port:user) รวมเป็น **1 eventManager + 1 snapManager** ต่อ NVR แทน 1 คู่ต่อ channel — route ผ่าน `index=N` (0-based) ในบรรทัด event; per-channel `capture_categories` allow-list (face/anpr/vehicle/nonmotor/person/rule) เป็น two-stage filter (device subscription = union, post-filter ต่อ channel). Live-verify กับ `DHI-NVR5216-16P-I/L` จริงที่ HDY: 2 channel = 1 event stream + 1 snap stream ยืนยันแล้ว. `media-recorder.js` RTSP channel มาจาก `nvr_channel` (เดิม hardcode=1). Foundation Phase 3 (`e73f1a5` DB columns, `609590c` scan-over-MQTT, `ecc44ce` scan-and-add UI, `e87db78` opt-in channel + camera-type selector) + CSV bulk-import onboarding (`0de049b` `1d3f657` `98b5983`).

  **(2) Dahua face → appearances + RPC2 NVR-stored crop** (`1287e9a` `c0c4b1f` `16913cb` `0d026e3` `b6fb9de` `8518485`): face attribute events (glass/beard/hat/emotion) เข้า `appearances` table + `FaceComparision` similarity/blacklist. NVR เก็บ face crop (`ObjPath`) + scene เต็ม (`OriPath`) ไว้แล้วทุก `FaceComparision` event — ดึงผ่าน RPC2 session (`src/ingesters/dahua-rpc.js` ใหม่: challenge/MD5 login, session cache + re-login-on-401) เร็วกว่า `captureFrame()` สด (วัดจริง success ceiling เดิม ~50-63% ใต้ AI load สูง) — mechanism ยืนยันจาก DevTools network capture ของ NVR web UI เอง (`/IntelliStorage/mnt/<file>:<len>.jpg` ตรงด้วย session cookie ไม่ต้อง `/RPC_Loadfile`). `captureFrame()` เหลือเป็น fallback.

  **(3) Camera Settings redesign** (`3a318c6` `58471b0` + others): Material-tonal redesign แยก column Site ชัดเจน; แก้ false-positive duplicate-IP warning ที่ทำ multi-channel NVR edit พัง.

- **2026-07-06–13 — LPR object_class split + Person Data merge + reports category chart** (commits `ba8782d` `bea596e` `214a424` `6081240` `cefa801` `700a264` `5475078` `377e1f8` `d11a484` + others)

  **(1) LPR object_class ปรับ granularity**: populate `events.object_class` จาก `vehicle_type` สำหรับ `anprAlarm` (`ba8782d`), wildcard match_state query-level (`bea596e`), แยก **Pickup** ออกจาก generic Truck class (`214a424`).

  **(2) Person Data**: merge FaceRecognition เข้า appearances tab + filter mask/hat (`6081240`).

  **(3) Reports**: scope preview/PDF ตาม site ที่เลือก + แก้ pill "ทั้งหมด" ค้าง (`cefa801`); เพิ่ม category breakdown chart ใน analytics report (`700a264`).

  **(4) Edge**: TCP probe ก่อน publish heartbeat กัน false-online เมื่อ port เปิดแต่ service ไม่ตอบจริง (`5475078`, GOTCHAS #109 area).

  **(5) LPR retention UI**: เพิ่มหน้า Settings›LPR retention settings + แก้ edge-proxy 404 passthrough (`377e1f8` `d11a484`).

- **2026-07-02–06 — Multi-site RBAC scoping rollout (P1-P5, D1-D3) + site-pill filters** (49 call sites, 9 route files — commits `edbe4e2` `94198fc` `255f2bb` `49ee80a` `20c6018` `f76cb59` `7ceb3fc` `7aa25c3` `a906eb0` `5ce5c4f` `97d4588` `12dd48a` `ccbd8c5` `8b09ae4` `6119c03` `d0f5b32` `536d4e7` `0633c93` `024b656` + docs `8d27f40` + others)

  `getAllowedSites(user, pool)` + `siteWhere(allowedSites, camCol, offset)` (`src/auth.js`) rollout ครบทุก endpoint cluster ที่มี site scope: Events/Snapshot/Media/Face/Appearance (`7ceb3fc`)/LPR (`7aa25c3`)/Stats (`024b656`)/Reports/Alerts/Groups/Sites/Map — เดิม plan ค้างใน ROADMAP แต่โค้ดจริงเสร็จแล้ว (audit `8d27f40` 2026-07-03 พบ 49 call sites ใน 9 ไฟล์). แก้ data-leak: executive-summary ไม่ scope ตาม site (`94198fc`), exec-summary แสดง edge disk ของ central แทนของ site ตัวเอง (`255f2bb`), alert-logs อ่านข้าม site (`49ee80a`). Edge sync: re-prefix Bosch MQTT topic ด้วย site + warn mismatch (`ccbd8c5`), DB-backed pause check + sync delete ไปยัง edge config (`8b09ae4`), reject cross-site `camera_id` mismatch แทน warn-only (`d0f5b32`), authenticate `_snapMqtt` แทน anonymous (`0633c93`). D1-D3 ปิดหมด (D1 moot จาก role gate เดิม, D2 fail-closed ตรงกับ `auth.js`, D3 ยืนยันผ่าน `lpr-gates.js`). decision candidate: site-RBAC resolver pattern.

- **2026-07-01 — LPR scale (keyset search) + class-based retention + edge snapshot pruner** (commits `1c638b5` `d87649c` `d4e2ba5` `b2741cc` `d5fc975` `39552ee` + docs `3327d4c` `4f999df` `828e9b4` `7a6ff0a`)

  **(1) P1 keyset pagination** (`1c638b5`, migration 071 `idx_events_time_id`): `/api/lpr` เปลี่ยนจาก `OFFSET + exact COUNT(*)` (O(N)) เป็น cursor keyset (`before_time`/`before_id`, `X-Has-More`, estimate `X-Estimated-Count` ผ่าน EXPLAIN, ลบ `X-Total-Count`) → เร็วคงที่ทุกหน้าที่ ~10M row/เดือน. UI: Prev/Next + jump-by-date (ไม่มี jump-to-page). decision #211, GOTCHAS #105.

  **(2) Edge snapshot retention + inventory** (`d87649c` migration 072, `d4e2ba5`): edge (N150) ไม่มี api-server → `src/edge/snapshot-retention.js` ใหม่ ให้ edge-bridge prune `snapshots/events/` รายชั่วโมง (guards, `EDGE_IMAGE_RETENTION_DAYS`=7, ไม่แตะ `lpr/`) + รายงาน inventory (oldest date + dir count) ใน heartbeat → `edge_status.snapshot_oldest/dirs` → แสดงการ์ด Edge หน้า Health. decision #214, GOTCHAS #106.

  **(3) Class-based retention** — (D) `enforceRawXmlRetention()` strip `raw_json-'rawXml'` >`rawxml_retention_days`=90 (`d5fc975`, migration 074) — decision #212; (E) `enforceRetention()` exclude anprAlarm → LPR อยู่ใต้ `lpr_retention_days` เดี่ยว (`39552ee`, mechanism only, number-flip gated on partitioning) — decision #213, GOTCHAS #107. แผนเต็ม: `docs/superpowers/plans/2026-07-01-retention-architecture.md`.

  **(4) P2/2A seatbelt column** (`b2741cc`, migration 073): parse `pilot/vicepilotsafebelt` → `license_plates.no_seatbelt` (partial index) แทน filter LIKE rawXml → unblock class-D.

  **(5) LPR charts + filters + forward-test** (earlier commits `f99a359` `56ad8a5` `147c9ee` `a4eaa17` `11df1ca` `93eb10d` `13aeea7`): plate-color + brand Top-10 charts (`/api/lpr/stats` += pcolor/brand); filters brand (`/api/lpr/brands`)/vehicle-color(10)/pedestrian/seatbelt/9 plate-colors + เบตง; `POST /api/cameras/lpr-forward-test` (save+test). **Deferred:** driver face capture (`7a6ff0a`) · F rollup/legal-hold (YAGNI).

- **2026-06-25 — Health page + Edge monitoring EM1-EM6 + LPR advanced features** (commits `5894cf9` `abc0a6a` `6b22cc2` `c2b0bae` `5b6d9cb` `caa781f` `f10a630` `00433cf` + others)

  **(1) Health page improvements** (commits `5894cf9` `abc0a6a`):
  - `lpr-receiver` เพิ่มเข้า Service Management card ใน Health page
  - Cameras/Image Quality/Automation cards รวมเป็น card เดียว (ลด noise)
  - lpr-receiver healthz port `3003` รวมใน `/api/health/details`

  **(2) Edge monitoring EM1–EM6** (commits `6b22cc2` `c2b0bae`) — VSS N150 health ใน Health page:
  - `db/db_migration_067_edge_status.sql` — ตาราง `edge_status` (site_id PK, pm2_json, disk, bridge stats)
  - `src/edge/bridge.js` (EM1): publish heartbeat ทุก 60s → `projects/vss/_edge/heartbeat` (pm2 jlist + df + bridge stats)
  - `src/mqtt-subscriber.js` (EM3): intercept `_edge/heartbeat` ก่อน processMessage; `recordEdgeHeartbeat()` upsert edge_status; ⚠️ topic ต้อง read raw (ก่อน `_stripSitePrefix`)
  - `src/routes/health.js` (EM4): `result.edge_sites[]` — stale flag, stale_sec, disk, bridge, pm2 services per site; `EDGE_HEARTBEAT_STALE_SEC=180`
  - `dashboard/page-health.js` (EM5): "Edge — VSS" card (Live/Stale badge + service rows + disk/bridge stats)
  - `src/alert-worker.js` (EM6): LINE alert เมื่อ last_seen_at stale > 180s
  - IM5 Ph.2 (site-down correlation) → **deferred** (EM6 ปิด full-site-down แล้ว; per-camera alerts ทุกตัว enabled=FALSE)

  **(3) Bosch Tier-2 snapshots** (commits `5b6d9cb` `caa781f`):
  - `src/edge/edge-config-agent.js`: snapshot capture บน edge → publish base64 via MQTT + disk path
  - `src/mqtt-subscriber.js`: `handleEdgeEvent()` — reroute edge events; Bosch snapshot COALESCE preserves edge-captured image
  - snapshot proxy เสริมสำหรับ Tier-2 (on-demand fetch จาก edge cache)

  **(4) Hikvision face ref image forwarding** (commit `f10a630` + others):
  - HKT01/02 face push ส่ง `faceLibImage` (FD library ref photo) พร้อม alarm
  - `src/edge/edge-config-agent.js`: forward `preview_ref`/`full` ref images ไปยัง central
  - face match modal แสดง FD Library photo ใน ref panel

  **(5) LPR advanced features** (multiple commits):
  - **No-helmet KPI card + filter** — `vehicle_type=no_helmet` parse + KPI card ใน LPR overview
  - **Phone-use analytics** — parse phone-use event_state; analytics tile ใน overview
  - **Pillion-passenger card tag + filter** — `vehicle_type=pillion_passenger`; tag บน plate card + filter
  - **Operator dismiss (plate-swap suspects)** — `lpr_mismatch_dismissals` (migration 064) + province column + dismiss modal + ack button
  - **KPI drill-down UX** — quick-date chips + duplicate-plate click-through + KPI period sync
  - **Camera-type dropdown** — event-driven activity tiles ใน camera grid (commits `557db77`)
  - **Sites management UI** — `GET/POST/PUT/DELETE /api/sites`; provision-edge button `POST /api/sites/:id/push-config` (commit `d3bb0ce`)

  **(6) Bug fixes**:
  - `FieldDetector` leave events ที่มี snapshot (Dahua via edge) ไม่ถูก filter ออกอีกต่อไป (commit `00433cf`; fix: `AND has_snapshot = FALSE` เพิ่มใน WHERE)
  - Bosch snapshot COALESCE — preserves MQTT-body crop ใน `snapshot_filename`

- **2026-06-24–25 — Edge pipeline hardening + docs** (commits `a00f62d` `0db4f37` `3a7fd94` `5d5a696` `d7df861`)

  Follow-up fixes หลัง edge port + vss live deploy (2026-06-24):

  - **Phase A** (`edge-config-agent.js`) — เพิ่ม `LineDetector` / `FieldDetector` ใน topic filter (BOSCH_3100i ส่ง event ประเภทนี้นอกจาก `ObjectDetection`)
  - **Phase B MQTT snapshot transport** — `hikvision-isapi.js` + `dahua-cgi.js` เปลี่ยนจาก save-to-local เป็น publish snapshot base64 ผ่าน MQTT พร้อม `event_id`; `mqtt-subscriber.js` เพิ่ม branch `if (msg.event_id)` → `UPDATE events WHERE id = $event_id` (direct, แม่นยำ 100%) แทน timestamp-window Bosch path เดิม — แก้ "Central bugs identified" ที่ระบุใน commit `74d3c6a`
  - **ITC/ANPR probe** (`docs/LOGIC_hikvision-ingester.md` §15) — XML fields 7 กลุ่ม 34 fields จาก `HIK-V_LPR01`, ค่าจริงใน DB 76,333 events, rear-facing camera note
  - **Edge deploy docs** (`docs/REF_edge-site-checklist.md` ใหม่; `REF_edge-install.md` 9 จุดแก้ confirmed on hardware: NanoMQ `.deb`, cloudflared apt, dashboard-managed tunnel warning, systemd vs PM2, dahua start order, BRIDGE_PASSWORD source, parameterize user, clone URL `Diew→dojojin`)
  - **GOTCHAS #100** — dahua crash-loop with 0 cameras on edge boot; fix: `fs.watch persistent:true` ใน `watchConfig()`

- **2026-06-23–24 — Site Edge Node (VIGIL-ARCH-003) ported to main** (commit `74d3c6a`)

  Edge deployment ครบวงจร: ingester เดิม (hikvision-isapi, dahua-cgi, lpr-core, face-push) รัน
  บน edge box ด้วย `EDGE_MODE=1` — skip DB insert, publish pre-normalized row ไปยัง NanoMQ local
  แทน; bridge ส่งขึ้น central EMQX ผ่าน WSS. Verified live บน WSL2 (vss edge box); 3,700+ messages
  forwarded ก่อน context ที่ session นี้บันทึก:

  **(1) EDGE_MODE guard pattern (DECISIONS #209)**
  - `src/edge/publisher.js` — lazy MQTT client singleton; `publishEdgeEvent()` publish pre-normalized event JSON ไปยัง `projects/${SITE_ID}/${camera_id}/onvif-ej/${cat}/${type}`; export `EDGE_MODE` flag
  - `src/edge/bridge.js` — standalone PM2 process; forward `projects/${SITE_ID}/#` + Bosch `+/onvif-ej/#` จาก NanoMQ → central EMQX WSS; relay `_config/cameras` downlink + CONFIG_TOPIC loop-break (GOTCHAS #99); heartbeat 60s
  - 4 ingesters แก้ additive: `if (EDGE_MODE) { publishEdgeEvent(); return; }` ก่อน DB insert ทุกจุด — central path ไม่กระทบ

  **(2) Operator templates + PM2 config**
  - `ecosystem.edge.config.js` (root) — 7 PM2 apps: nanomq, hikvision, dahua, lpr-receiver, edge-config-agent, edge-bridge, cloudflared
  - `edge/env.template`, `edge/nanomq.conf.template` — template สำหรับ N150/Ubuntu deploy
  - `scripts/edge-cloudflared.sh`, `config/cloudflared.yml` — cloudflared wrapper + ingress config

  **(3) Docs**
  - `docs/REF_edge-install.md` (711+ lines) — install guide ครบสำหรับ N150/Ubuntu Server 24.04; NanoMQ v0.24.14-3, Node v22, PM2; WSL2 vs pure Linux comparison + 8-item gotcha table
  - `docs/LOGIC_edge-ingester-divergence.md` — contract edge vs central (EDGE_MODE pattern, image-never-over-MQTT, pre-normalized row shape)

  **Central bugs identified at port time → ✅ fixed in follow-up commits (2026-06-24–25):**
  - `$1` type cast ใน edge-snapshot SQL → fixed `941b8d5` (`jsonb_build_object(..., $1::text, ...)`)
  - `no matching event for ts=...` → fixed `3a7fd94` (event_id direct UPDATE path ใน `mqtt-subscriber.js`)

- **2026-06-19–23 — Camera Settings + Face redesign + LPR Gallery + Multi-site + MultiPicker** (many commits)

  **(1) Camera Settings redesign CS3–CS7:**
  - **CS3** (commit `719c4ed` 2026-06-20): paginated camera list 25/page + search + vendor/status/location filters; `_filterPaginate()`/`_camDistinctLocations()` + `renderPagination`/`pgGo`
  - **CS4** (commit `6d620f4` 2026-06-21): full-page editor; `#set-cameras.cam-editing` view-swap; pill nav scrollspy; Esc/back; mobile overflow fix
  - **CS5** (commit `6cccec7` 2026-06-21): Pull/Push radios = VIEW of `frmCamPushOnly`; `_syncIngestRadios()`/`_setIngestRec()` advisory-only; Hik=choice, Bosch/Dahua=info
  - **CS7 / IM7** (commit `f213cca` 2026-06-21): `src/lpr-core.js` + `src/lpr-forward.js` + `src/lpr-receiver.js` standalone (PM2 id 8, port 3003); disk spool/retry; CF tunnel route `^/(lpr$|face-push/)` → :3003. Verified 14/14 synthetic e2e (cross-process pg_notify ✓)

  **(2) LPR Gallery Phase F-R (RF1–RF5 + RF-IMG + RF-Alert):**
  - **RF1–RF4** (2026-06-21): read-only gallery tab + Settings›LPR (retention/gate/vtype/watchlist mgmt + drag-drop); migration backfill lpr_gates
  - **RF-Alert** (commits `f9252ed`+`f2082b8` 2026-06-23): `lpr_alert_acks` (migration 060) + alert tab + ack modal; `GET /api/lpr/alerts` + `/count` + `POST /:id/ack`
  - **RF5** (commit `3e49b60` 2026-06-23): `cameras.lpr_direction` (migration 063) + direction chart + assignment UI; `PUT /api/lpr/camera-direction`
  - **RF-IMG** (commit `a96ee28` 2026-06-23): `resizeScene` 1080p/q80 ใน lpr-core (ingest); 2 settings ใน Settings›LPR (max_resolution/quality); ~600KB/image from live camera
  - **MultiPicker rollout** (2026-06-23): LPR 5 filters (region/type/color/plate-color/lane) ใช้ multi-select dropdown

  **(3) Multi-site DB Tier 1** (migrations 052–056, 062–063, 2026-06-21-22):
  - `sites` table (052), `cameras.site_id` FK (053), `user_sites` (054), backfill VSS (055), `cameras.cam_role` (056), `cameras.lpr_direction` (062-063)
  - `/api/cameras` scoped by user_sites (fail-open); site dropdown ใน camera editor; cam_role field
  - Push-only camera grace period 30 min (commit `60b301a`)

  **(4) Face Page Redesign FP1–FP6** — ✅ ALL LIVE 2026-06-22:
  - **FP1–FP3** (commits `c5eb368` `338a355` `92614d4` + `bade691` demo parity): 4-tab (ภาพรวม/แจ้งเตือน/ค้นหา/ตั้งค่า) + `GET /api/faces/stats` + modal rework (crop↔FD ref + Body Appearance + deleted→avatar)
  - **FP4** (migration 057 `face_event_notes`): `GET/POST /api/face-matches/:id/note`; operator note free-text ใน modal
  - **FP5** (commit `fea95e8`, migration 058 `face_event_acks`): blacklist ack; unacked badge; `GET /api/faces/counts` + `unacked_watch`
  - **FP6** (commit `0c4ad8a`, migration 059 `face_settings`): `face_similarity_min`(80) + `face_show_expression`(1); threshold query-time (reversible); Settings›ระบบใบหน้า

  **(5) Camera Status demo parity** (commits `35ee205` `a806d80` 2026-06-22):
  - OSD overlay (ts + cam-id pill on preview); summary chip bar (รวม/ออนไลน์/ออฟไลน์/Maintenance)
  - RBAC fail-open `/api/cameras` scoped by user_sites; `recording_data_from` → SD box
  - Client-side resolution (`img.naturalWidth`; cache `_camResCache`); Face tile counts
  - Deep-link `cameraViewEvents()` role-aware (lpr/face/standard) — implemented (not stub)

  **(6) Person Data redesign BP1–BP3** (commit `bd5a969` 2026-06-22):
  - Peak-by-hour + peak-by-camera charts; color swatch picker; search-by-example
  - Face cross-link (event time/camera → face page); avatar from metadata (within retention 30d)

  **(7) MultiPicker component** (2026-06-23):
  - Multi/single-select dropdown แทน native `<select>` ทุก filter bar; `data-mp-mode` dev flag; CSP-safe (no inline)
  - Demo: `public/others/demo/multipicker/`; deployed to LPR 5 filters

  **(8) Site provisioning** (commits `a5d9d9d` `55ff04d` `d3bb0ce` 2026-06-23-24):
  - Site CRUD: `GET/POST/PUT/DELETE /api/sites`
  - Provision-edge button: onboard site's MQTT bridge from UI (`POST /api/sites/:id/push-config` + EC1+EC2 edge-config-agent)
  - `scripts/provision-edge.js` CLI + `src/routes/sites.js`

  **(9) IM3-R ✅ LIVE 2026-06-23 (on-site Phuket)**:
  - HKT01 + HKT02 face push active via Cloudflare tunnel `POST /face-push/:token`
  - FAS multi-slot (HCP slot 1 + Vigil slot 2) — ไม่ต้องเลือก
  - v1 = ingest-only; LINE alert / body-appearance = v2 future

  **(10) IM4 — auto-detect ingest method** (commit `3640f1e` 2026-06-19):
  - Test Connection (Hikvision) + unreachable → nudge suggest `push_only`
  - suggest-only (ไม่ auto-tick — guard transient TCP blip)

- **2026-06-18–19 — LPR/ANPR system + Events/Snapshot/Faces reorganization** (commits `00fbd41` `acc8f1a` `03c894b` `37531a4` `0ed18b5` `1b4fa77` `608e0a6`)

  **(1) LPR/ANPR pipeline** — Hikvision ITCCAM ANPR cameras push plates over HTTP:
  - `src/routes/lpr.js` — ANPR HTTP push receiver (ingest + image save under `snapshots/lpr/YYYY-MM-DD/`); 78-province map (`tailandStateID`→ชื่อ); 3s dedup
  - `src/routes/lpr-query.js` — `GET /api/lpr` (search: q/camera/region/from/to + X-Total-Count) + `GET /api/lpr/stats` (KPI: today total/unique/top brand)
  - `src/routes/lpr-watchlist.js` — `GET/POST/PATCH/DELETE /api/lpr/watchlist` (migration **050** `lpr_watchlist`)
  - `dashboard/page-lpr.js` — ป้ายทะเบียน gallery: latest/search/watchlist tabs; 579-entry vehicle-brand map; DLT plate plaque
  - `dashboard/lpr-plaque.js` — shared synthetic plate plaque (DLT background colors; motorcycle 2-line); single source for Events feed + LPR page
  - redesign demo (approved) at `/others/demo/` — overview KPI+charts, 77-province filter, เฝ้าระวัง watchlist groups, lane→gate config, detail modal. Port → production = **Phase F** (see `docs/superpowers/plans/2026-06-18-lpr-receiver.md`)

  **(1b) Phase F1 — demo → production port** (2026-06-19): `page-lpr.js` rewrite to 3-tab redesign (ภาพรวม/ค้นหา/เฝ้าระวัง), period-aware KPIs + hourly/province/vtype charts, search filters (vehicle_type/color, plate_color, lane, no-read), watchlist groups/alert-mode/ref-image/notify (migration **051** `lpr_watchlist_groups` + `lpr_watchlist` cols; image upload sharp 400×400 + magic-bytes), no-read "อ่านไม่ออก" + unknown→"ไม่ทราบ" (DECISION #208), AirDatepicker pickers. **Fixes found in review:** CSP `script-src 'self'` blocks inline handlers → converted to `data-action`/`data-change`/`data-input`/`data-err` dispatcher (ACTION_MAP in `page-nav-bindings.js`); TZ boundary — app forces `SET TIME ZONE 'UTC'` so period windows use `::date::timestamp AT TIME ZONE 'Asia/Bangkok'`; AirDatepicker `position:'bottom right'` to keep popup in viewport. Card plaque → container-query sizing + 2px DLT frame. Re-architecture (read-only tab + Settings›LPR config + retention) = **Phase F-R** (ROADMAP).

  **(2) Events/Snapshot — category separation** — LPR/Face are their own pages → out of the generic feeds:
  - `dashboard/event-domains.js` — single classifier `eventDomain(ev)` (event_type → domain/render/badge) replaces scattered hardcoded checks; `specializedEventTypes()` drives feed exclusion → a new domain = one registry entry
  - Events "ทั้งหมด" + Snapshot exclude `anprAlarm,FaceRecognition,FaceCapture` via `/api/events?exclude_types=` (high-frequency plates were burying other logs — recent 200 feed rows = 100% anprAlarm)
  - Events feed declutter: removed ป้ายทะเบียน tab + CONF/SRC columns (only 7.7%/17.1% populated); หมวด column shows domain badge; LPR rows surface plate number in name
  - `anprAlarm` display name → "ข้อมูลป้ายทะเบียน" / "ANPR" (`etl.anprAlarm`, DECISIONS via EVENT_TYPE_LABELS)

  **(3) Faces page (ค้นหาบุคคล) — 3 category tabs** — 2 tabs → 3:
  - **ภาพใบหน้า** (FaceCapture) / **พบในระบบ** (FaceRecognition matched) / **ไม่พบในระบบ** (FaceRecognition, no listType) + live count badges
  - `GET /api/faces/counts` (capture/match/miss in one query); `/api/face-matches?misses_only=1`
  - listType label `blackList` → "เฝ้าระวัง" / "Watchlist" (consistent with LPR); removed obsolete "รวมที่ไม่จับคู่ได้" toggle

  **(4) No-read decision (#208)** — camera probes unreadable-plate vehicles as `anprAlarm` `plate='unknown'` (6.9%, attributes intact) → display as **"อ่านไม่ออก"** (ANPR no-read = camera-health KPI), not "ไม่ทราบ". Implement in Phase F.

  *(Same-day, separately documented: ANPR receiver `00fbd41`; Hikvision FAS P1 hardening `7e1b088`; Stats forensic Sprints A–E `324f06e`…`27b3218`.)*

- **2026-06-17–18 — Dahua ingester: test harness + segment guard fix + smart scan fallback** (commits `1aeb94d` `8689855` `8fc5078` `0731ca6`)

  4 commits ปรับปรุง `dahua-cgi.js` ทั้งด้านความถูกต้องของ snapshot และความสามารถ test ได้:

  **(1) `1aeb94d` — extract parser → `dahua-protocol.js` + test fixtures**
  - แยก `DAHUA_EVENT_MAP`, `parseDahuaEventText`, `parseSnapManagerCode`, `extractObjectClass` ออกจาก dahua-cgi.js เป็น pure module (ไม่มี I/O / DB)
  - เพิ่ม `test/fixtures/dahua/` (7 fixtures) + `test/dahua-parser.test.js` (21 tests)
  - regression net พร้อมก่อนแตะ snapshot logic

  **(2) `8689855` — fix: mtime fallback สำหรับ segment close detection**
  - root cause ของ `candidates=0` ใน event 103109 (DAHUA_CAM01, 17 มิ.ย. 12:59): guard เดิมต้องการ segment ใหม่กว่าอยู่ใน buffer — ถ้า segment ล่าสุดเป็นตัวที่ต้องการพอดี → ทุก candidate ถูก skip
  - แก้: OR mtime fallback — ถ้า ffmpeg ไม่ได้เขียน segment นั้นมา >2 วินาที (`SEGMENT_CLOSE_AGE_MS = 2000`) ถือว่าปิดแล้ว อ่านได้

  **(3) `8fc5078` — refactor: extract snapshot scoring → `dahua-snapshot-selector.js`**
  - ย้าย `scoreFrameForObject`, `scoreFrameMotion`, `chooseBestSnapshotCandidate`, `eventBoundingBox`, `eventBoxEdgeRisk`, `frameRoi` + 5 constants ออกเป็น pure module (dep เดียวคือ `sharp`)
  - เพิ่ม `test/dahua-snapshot-selector.test.js` (21 tests) รวม discriminating image-level tests (noisy > flat, diff > same)
  - zero behavior change; total suite 85/85 pass

  **(4) `0731ca6` — feat: smart scan fallback (`dahua-rtsp-buffer-scan`)**
  - เพิ่ม level ที่ 3 ในระหว่าง burst → dumb-single: เมื่อ burst คืน 0 candidates, scan ±30 วินาที (สูงสุด 5 segments), score แต่ละตัวผ่าน `scoreFrameForObject`, คืน frame ที่ดีที่สุด
  - `selectScanSegments()` (pure helper ใน selector) + `SCAN_WINDOW_SEC=30` / `SCAN_MAX_SEGS=5`
  - source label: `dahua-rtsp-buffer-scan` / `low_confidence` → clip-resolver upgrade ทำงานตามปกติ
  - เพิ่ม 6 unit tests; total suite 27/27 pass

  **Test coverage รวม:** 48 tests (21 parser + 27 selector); `dahua-cgi.js` ลด ~170 ลบ. (−16%)

- **2026-06-15 — docs: accuracy pass — README, SKILL, SKILL-TH, ARCHITECTURE** (commits `b82a97c` `e3cf83b`)

  อัปเดต 4 ไฟล์ให้ตรงกับ codebase จริง:
  - `README.md`: Node.js 18+ → 22 LTS; `dashboard/` section สะท้อน S5 split (19 page-*.js, core ~1,379 lines); `routes/` แสดง 19 modules ครบ (S4); `src/` เพิ่ม push-sender / crypto-creds / color-utils / singleton; db/ migration list ย่อเป็น 011–013 … 045 (47 files); Documentation Index เพิ่มแถว dev-docs/
  - `SKILL.md` / `SKILL-TH.md`: date 2026-06-08 → 2026-06-15; §8 grep command ครอบ `dashboard/page-*.js` ด้วย
  - `ARCHITECTURE.md`: `dashboard/` row 21 → 19 page-*.js (verified via `ls`); File Ownership เพิ่มแถว dev-docs/ portal; date อัปเดต

- **2026-06-15 — docs(dev-portal): file-navigator + api-routes pages + ARCHITECTURE.md gap-fill** (commit `e35d007`)

  เพิ่มสองหน้าใหม่ใน `dev-docs/` และอุด gap ใน ARCHITECTURE.md:
  - `dev-docs/file-navigator.html` — สารบัญไฟล์ทุกไฟล์ใน project; CSS architecture diagram (3-col grid: Ingestion / Server Core / Workers+Frontend); role badges (server/worker/lib/route/ui/infra/dev); ครอบ src/*.js, routes/, helpers/, ingesters/, dashboard/*.js, db/, scripts/, root configs
  - `dev-docs/api-routes.html` — REST routes 139 routes จัดตาม 20 module groups; METHOD badges (GET/POST/PUT/PATCH/DELETE สีต่างกัน) + auth-level badges; note ว่า REF_api-reference.md ยังแสดง 126 routes (outdated)
  - `ARCHITECTURE.md` Runtime Components: เพิ่ม 9 rows ที่หายไป — `push-sender.js`, `crypto-creds.js`, `color-utils.js`, `constants.js`, `singleton.js`, `migrate.js`, `stats-summary-route.js`, `simulator.js`; อัปเดต `auth.js` + `license.js` + `report-renderer.js` ให้ละเอียดขึ้น; dashboard row 27 files (S5 ✅); db row 47 files/045

- **2026-06-15 — refactor(dashboard): S5/MAINT-FE-001 dashboard.js split — CAMPAIGN COMPLETE** (19 page files, commits `dd35f68`→`e90877e`)

  dashboard.js peak **~10,500 ลบ.** → **1,379 ลบ.** (−9,121 ลบ., −87%); 19 page files สร้างใหม่ใน `dashboard/`

  | ไฟล์ใหม่ | Lines | Section ที่ย้ายออก | Commit |
  |---|---|---|---|
  | `page-appearance.js` | 618 | Appearance Search | `dd35f68` |
  | `page-reports.js` | 770 | Reports + History | `236ef27` |
  | `page-alerts.js` | 693 | Alerts / LINE Notification | `1d98f3c` |
  | `page-stats.js` | 1,483 | Stats / Analytics / Charts | `43da0f7` |
  | `page-map.js` | 770 | Map + OpenLayers | `92baf8a` |
  | `page-events.js` | 289 | Events feed | `27ef402` |
  | `page-cameras.js` | 756 | Camera list + EMQX provisioning | `bb3bacd` |
  | `page-camera-settings.js` | 1,066 | Camera settings modal | `7254960` |
  | `page-face-gallery.js` | 233 | Face gallery | `8bf203b` |
  | `page-snapshots.js` | 479 | Snapshots + Overlay | `ba91e89` |
  | `page-media.js` | 164 | Media / Clip viewer | `3249116` |
  | `page-map-settings.js` | 357 | Map cache manager + Settings › Map | `a1d61b3` |
  | `page-branding.js` | 81 | Brand logo/name/color | `298b34f` |
  | `page-user-mgmt.js` | 398 | User manager + Audit log + Sessions | `298b34f` |
  | `page-categories.js` | 303 | Category + Rule manager | `cbf1698` |
  | `page-system.js` | 218 | System settings + Analytics events | `a7b7951` |
  | `page-health.js` | 257 | Health check page | `3324210` |
  | `page-executive-summary.js` | 486 | Executive summary / SMB briefing | `b7bbedf` |
  | `page-nav-bindings.js` | 473 | Nav chrome + static + dynamic handlers | `e90877e` |

  **Pattern — Option A (classic script, no-build):**
  - Load order: `page-*.js` ก่อน `dashboard.js` ใน `index.html`
  - Global scope แชร์ผ่าน window — `let/const` top-level ย้ายตามไฟล์, ไม่ redeclare ข้ามไฟล์
  - Cross-file calls resolve at call-time (ปลอดภัยเพราะ page-*.js load ก่อน `dashboard.js`)
  - Verify gate: `node --check` ทุก step + browser verify ปิดท้าย
  - dashboard.js ที่เหลือ = core globals + pagination + WS + group mgmt + bootstrapApp (~1,379 ลบ.)

- **2026-06-14 — refactor(routes): route split ชุดที่ 13–16 — map, line, health, reports** (commits `60ab7d2` `97e8c8e` `e81399e` `90b831f`) **← S4 CAMPAIGN COMPLETE**

  api-server.js peak 7,156 ลบ. → **1,893 ลบ.** (−5,263 ลบ., −73%); 19/19 route files done; faces 2 routes hold รอ FR module

  - `src/routes/map.js` (new, 486 lines) — 10 routes: map areas/polygons CRUD + download/cancel + tiles proxy + `/api/settings/mapbox`; `mapDownloadState` + helpers ใน factory closure; path `path.join(__dirname, '../..', 'map-cache')`
  - `src/routes/line.js` (new, 377 lines) — 12 routes: line-config CRUD + test + pending/blocked/webhook + `/api/line-config/quota`
  - `src/routes/health.js` (new, 629 lines) — 7 routes: `/api/health/details` + `/api/health/report` + `/api/health/report/:id` + `/api/services`; `_dirSize()` local helper; `getBrandForReport` รับจาก dep (ยังอยู่ใน api-server.js)
  - `src/routes/reports.js` (new, 193 lines) — 6 routes: `/api/report-history/stats` + `/api/report-history` + `/api/report-history/:id/image` + `/api/reports/pdf` + `/api/reports/daily` + `/api/reports/weekly`; `PORT` + `REPORT_TYPES` + `REPORT_TITLE_TH` เป็น local const

- **2026-06-14 — refactor(routes): route split ชุดที่ 6–12 — ops, auth, license, events, appearances, cameras, stats** (commits `7f352de` `1205361` `a084038` `cd54b64` `daff4bf` `21fe1f3`)

  api-server.js peak 7,156 ลบ. → 3,480 ลบ. (−51%) ณ จุดนี้; extracted ~3,808 ลบ. รวม 12 commits; 15/19 route files done

  - `src/routes/ops.js` (new) — push register/unregister + alert-logs + backups (8 routes); −148 ลบ.
  - `src/routes/auth.js` (new) — login/logout/me/change-password/sessions (6 routes); −151 ลบ.
  - `src/routes/license.js` (new) — machine-id/status/activate/deactivate (4 routes); −79 ลบ.
  - `src/routes/events.js` + `src/routes/appearances.js` (new) — events list/facets/dwell + appearances stats/search/timeline (8 routes); −599 ลบ.
  - `src/routes/cameras.js` (new) — cameras CRUD + offline-alerts + live-snapshot + /api/config (15 routes); −1,187 ลบ. (largest single split)
  - `src/routes/stats.js` (new) — stats/occupancy/heatmap/dwell/people-counting/categories/timeline ครบ (20 routes); `_occupancy` Map ส่งผ่าน by reference; local state (`_todayCountsCache`, `parseRange`, `pickTruncUnit`) ย้ายเข้าโมดูล; −811 ลบ.

- **2026-06-14 — refactor(routes): route split ชุดที่ 5 — report-schedules** (commit `7160e68`)

  **Report Schedules route split:**
  - `src/routes/report-schedules.js` (new, ~170 lines) — 5 routes: `GET/POST/PUT/DELETE /api/report-schedules` + `POST /api/report-schedules/:id/run`; factory `reportSchedulesRoutes(app, pool, { WORKER_PORT, INTERNAL_API_TOKEN })`
  - helpers ย้ายเข้าโมดูล: `normalizeHealthSections`, `normalizeSendDayOfWeek`, `normalizeSendDaysOfMonth`, `HEALTH_SECTION_KEYS` — ทั้งหมดเป็น local-only ใน block เดิม
  - `REPORT_TYPES` คงไว้ใน api-server.js (ยังใช้ใน `/api/reports/pdf`); narrow scope — `/api/report-history/*` + `/api/reports/pdf` + health report routes ไม่แตะ (ป้องกัน PORT TDZ trap ที่ `const PORT` line 6185)
  - api-server.js: -184 lines

- **2026-06-14 — refactor(routes): route split ชุดที่ 2–4 — groups, settings, users, alert-rules** (commits `23fc063` `0e19dc7` `3caa6b1`)

  **Groups + Settings split (commit `23fc063`):**
  - `src/routes/groups.js` (new) — 3 routes: `GET/POST/DELETE /api/groups`; factory `groupsRoutes(app, { auth, getIP, loadGroups, saveGroups, logCameraAudit })`; file-based JSON, no pool
  - `src/routes/settings.js` (new) — 3 routes: `GET /api/settings`, `PUT /api/settings/map`, `PUT /api/settings/:key`; factory `settingsRoutes(app, pool, { ... })`; `PUT /api/settings/map` ลำดับก่อน wildcard route (ป้องกัน Express ตีความ 'map' เป็น `:key`)
  - api-server.js: -124 lines

  **Users + Audit-log + CSP-report split (commit `0e19dc7`):**
  - `src/routes/users.js` (new) — 7 routes: `GET/POST/PUT/DELETE /api/users`, `POST /api/users/:id/reset-password`, `GET /api/audit-log`, `POST /api/csp-report`; factory `usersRoutes(app, { auth, getIP })`
  - `require()` วางก่อน global auth middleware line 676 — intentional: user mgmt ต้องใช้ได้แม้ license หมดอายุ/write-blocked
  - `_cspRateMap` (rate-limiter Map) ย้ายเข้า factory; `express.json()` สำหรับ csp-report require ภายใน
  - api-server.js: -111 lines

  **Alert-rules + normalizeTimeOfDay helper split (commit `3caa6b1`):**
  - `src/routes/alert-rules.js` (new) — 5 routes: `GET/POST/PUT/DELETE /api/alert-rules` + `GET /api/alert-rules-suggestions`; factory `alertRulesRoutes(app, pool)`; Bosch tampering synthetic names คง verbatim; `pg_notify('alert_rules_changed', '')` คงทุก write path
  - `src/helpers/normalizeTimeOfDay.js` (new) — extract shared helper (เดิม inline ใน alert-rules block); ยังใช้ใน camera offline-alerts (line 2121/2122) + report-schedules (line 3610/3646) ผ่าน require
  - api-server.js: -127 lines (3 ins / 127 del)

- **2026-06-13 — perf(settings) + refactor(routes): P2 system_settings cache + branding/EULA route split** (commits `a8f4304` `926962c`)

  **P2 — `system_settings` cache (commit `a8f4304`):**
  - สร้าง `src/helpers/getSystemSetting.js` — Map cache TTL 60 วินาที, 3 exports: `getSystemSetting(pool, key)`, `getSystemSettings(pool, keys[])` (multi-key single query), `invalidateSystemSetting(key)`
  - migrate 13 call sites ใน api-server.js (display_timezone, analytics_event_display, brand_*, retention days, mapbox_token, eula, notifications ฯลฯ) จาก raw `pool.query(WHERE key=)` → helper
  - เพิ่ม `invalidateSystemSetting()` ทุก write path (4 จุด); fork-mode single-process → ไม่ต้องการ Redis/pg_notify cross-process
  - ลด seq_scans บน `system_settings` ~80%

  **Branding + EULA route split (commit `926962c`):**
  - `src/routes/branding.js` (new, 81 lines) — 3 routes: `GET /api/branding`, `POST /api/branding/logo`, `DELETE /api/branding/logo`; factory signature `brandingRoutes(app, pool, brandingDir)`; multer ย้ายเข้า factory; SEC-005 magic-bytes check คง verbatim
  - `src/routes/eula.js` (new, 70 lines) — 3 routes: `GET /api/eula`, `GET /api/eula/status`, `POST /api/eula/accept`; `EULA_PATHS`/`_eulaCache`/`getEulaContent` ย้ายเข้าโมดูล; path ปรับสำหรับ `src/routes/` (`../../docs/`)
  - api-server.js: -124 lines (EULA block 55 lines + branding block 69 lines); `const sharp` (thumbnail) + `publicApiPaths` ไม่กระทบ

- **2026-06-07 — docs(api-ref): เพิ่ม REF_api-reference.md — full REST API reference** (commits `ef2f844` `a9a20be` `fbb3548` `98e876d` `fef8816` `48ff98d` `09ef3d2`) — จัดทำ API reference ฉบับแรกของโปรเจกต์ + ลงทะเบียนใน doc registry ครบทุกจุด:
  - `docs/REF_api-reference.md` (new, ~1510 lines) — ครอบคลุม **126 routes ใน 22 groups** ได้แก่ Auth, Users, Cameras, Events, Snapshots, Media, Appearances, LPR, Stats, Executive Summary, LINE config/alerts/recipients, Report schedules/history, Settings (validated keys + ranges ทุกตัว), Face Capture, Categories, System/Branding, Health & Services (service management rules), WebSocket protocol
  - Notable: `GET /api/events` — ระบุ query params ทุกตัว (17 params รวม `camera`, `cameras`, `cls`, `object_classes`, `category_id`, `hasSnapshot`, `hasClip`, `dow`, `hour` ฯลฯ); `PUT /api/settings/:key` — ตาราง validated keys + exact ranges (`data_retention_days` 1–730, `clip_retention_days` 1–90, `brand_primary_color` `#RRGGBB` ฯลฯ)
  - Notable: Service Management — api-server stop/start blocked (400 `api_server_stop_start_disallowed`); alert-worker + report-worker ไม่อยู่ใน `_SVC_NAMES` (status-only)
  - Notable: WebSocket — auth flow, message shape, `type` enum ครบ (`new_event`, `alert_fired`, `camera_status`, `push_token`, `health_update`)
  - ลงทะเบียนใน `CLAUDE.md` (Documentation Map + Task→Load), `ARCHITECTURE.md` (File Ownership), `docs/ARCH_documentation-governance.md` (Registry + Task→Load + Canonical Ownership + File Size Status)

- **2026-06-07 — docs(skill): แปล SKILL.md เป็น English-only + สร้าง SKILL-TH.md (Thai version)** (commits `be36834` `d052dfd` `fbb3548` `98e876d` `09ef3d2`) — สร้าง bilingual operator playbook set:
  - `SKILL.md` — แปล §6–§16 จาก Thai → English-only (faithful translation ไม่เปลี่ยนเนื้อหา); แก้ stale ref: GOTCHAS #35 ("MUST be flatpickr") → GOTCHAS #64/#65 (AirDatepicker, ตาม DECISIONS #186)
  - `SKILL-TH.md` (new) — Thai-language version: prose ภาษาไทย + English technical terms คงไว้ + `> **TERM** = คำอธิบายไทย` remark หลังทุก concept ที่ซับซ้อน (PM2, MQTT, RTSP, CGI, JWT, LTS, EOL, Docker container, burst scoring, clip resolver, heartbeat, async, i18n, vanilla JS ฯลฯ)
  - ลงทะเบียนใน `CLAUDE.md` (Documentation Map), `ARCHITECTURE.md` (File Ownership), `docs/ARCH_documentation-governance.md` (Registry + Task→Load + Canonical Ownership + File Size Status)

- **2026-06-07 — docs: full AI-reference doc accuracy audit (Phase 1–3)** (commits `ba146ab` `8fc8a95` `fa6319a`) — ตรวจสอบและแก้ไข reference docs ทั้งหมดให้ตรงกับ code จริง แบ่ง 3 phase ตาม priority:

  **Phase 1 — High (ARCHITECTURE.md, HARDWARE_SIZING_GUIDE.md):**
  - `ARCHITECTURE.md`: Node.js 18+ → 22 LTS (v22.22.3); EMQX 5.8 → 5.8.9 พร้อม port/AUTHN note; เพิ่ม `alert-worker.js` + `report-worker.js` rows; ลบ "report scheduler" จาก api-server role; แก้ mqtt-subscriber "alert hook" → `pg_notify` dispatch; Data flow step 4: `alertEngine.onEvent()` → `pg_notify('alert_event')`; DB map 20 → 21 tables (เพิ่ม `push_tokens`); date 2026-05-27 → 2026-06-07
  - `HARDWARE_SIZING_GUIDE.md`: B_snap ~160 KB → ~640 KB (GOTCHAS #40, JpegSize param removed 2026-05-21); cascaded recalculation ทุกจุด (formula, G1 Snapshot Volume ~80 GB → ~307 GB, Worked Example snapshot 190 GB → 768 GB, total 720 GB → 1.3 TB, SSD rec 2 TB → 4 TB); G1 diagram "subscriber + api" → "7 workers (PM2)"; EMQX AUTHN comment แก้ historical→production; EMQX ports ลบ WS :8083

  **Phase 2 — Medium (GOTCHAS.md, DECISIONS.md, microservice_plan.md):**
  - `GOTCHAS.md` #50: Phase 3 note — dual-bind → `0.0.0.0:1883` + AUTHN (network resilience 2026-06-07); Broker address แก้จาก hardcode `192.168.10.31` → LAN IP จริงของ server
  - `GOTCHAS.md` #57: wildcard rule เพิ่ม EMQX `:1883` exception (allowed เมื่อ AUTHN enforced)
  - `GOTCHAS.md` #81: note dual-bind replaced 2026-06-07
  - `DECISIONS.md` header/footer: v1.5.1 → v1.5.3; #152 Phase 2 ✅ + Phase 3 (0.0.0.0); #160 เพิ่ม EMQX exception
  - `microservice_plan.md`: Phase 3 ✅ DONE — checklist อัปเดต (alert_event ไม่ใช่ new_event, HTTP ไม่ใช่ job queue); process table + IPC section เพิ่ม 2 workers; timeline updated

  **Phase 3 — Low (ROADMAP.md, LOGIC_camera-ingesters.md, REF_database-schema.md, LOGIC_infra-ops.md, REF_operator-sql.md):**
  - `ROADMAP.md`: PM2 5 workers → 7 workers; ecosystem 5 apps → 7 apps; Node 20 → Node 22 (test harness S1 note)
  - `LOGIC_camera-ingesters.md` #112: EMQX ports ลบ WS :8083; AUTHN + password env var
  - `REF_database-schema.md`: เพิ่ม migration history 028–040 (13 entries); footer v1.5.3 / 2026-06-07
  - `LOGIC_infra-ops.md` #124: layer 2 services.sh → PM2 + ecosystem.config.js (7 workers); STUBBORN_FACT + How to apply อัปเดต
  - `REF_operator-sql.md`: EMQX dashboard comment "admin/public" → `EMQX_DASHBOARD_PASSWORD` env var

- **2026-06-07 — docs(codex): 3rd-tier system audit + technical + commercial AI reviews** (commits `5150d55` `92a83f2` `7a5209f` `a8c2497` `d2ba6cd`) — เพิ่มเอกสาร audit/review 3 ชุด ก่อน Phase 1-3 accuracy pass:

  **`CODEX_AUDIT_3rdTier.md`** (commit `5150d55`, 1044 lines) — Security/Performance/Sustainability audit หลัง 2nd-tier remediation เสร็จ:
  - 6 concerns หลัก: (1) CDN JS trust (`cdn.jsdelivr.net` + bearer token ใน browser storage); (2) EMQX MQTT all-interface exposure (accepted risk — AUTHN enforced); (3) analytics query bottleneck (`events` table growth); (4) health endpoint I/O heavy (media/snapshot scan + PM2 shell); (5) api-server.js + dashboard.js ขนาดใหญ่; (6) test coverage ยังเป็น unit-level เท่านั้น (route/auth/CSP/migration smoke tests = next tier)
  - Overall: materially stronger than prior rounds — largest risks from 2nd-tier mostly closed; remaining concerns = production hardening + scale

  **`public/others/codex/commercial_system_review_2026-06-07.html/.md`** (commits `92a83f2` `7a5209f`, ~1280 lines) — Commercial positioning review:
  - Vigil = on-prem security ops layer ไม่ใช่ enterprise VMS replacement (vs Genetec/Milestone/Axis/HikCentral/Dahua DSS)
  - Strongest at: LINE-first alerting, Thai/English ops workflows, on-prem event+media ownership, multi-vendor ingestion, camera health monitoring
  - Target gap: enterprise video search + failover + mobile app + integrations ยังเป็น differentiator gap

  **`public/others/codex/coding/technical_engineering_review_2026-06-07.html/.md`** (commits `a8c2497` `d2ba6cd`, ~960 lines) — Technical engineering review:
  - ผล: system beyond prototype maturity — practical single-host architecture, PM2 isolation, raw SQL, auth-gated media, RBAC, disciplined migrations, operational docs, initial test coverage
  - Main risk: large core files (api-server.js, dashboard.js) — route-order/auth/i18n/UI regression harder to control
  - Conclusion: "does not need a rewrite — needs stronger guardrails around an already-working architecture"

- **2026-06-07 — docs(vigil-docs-v2): sync index.html to v1.5.3** (commit `4c98326`) — อัปเดต Live Docs index:
  - Title/hero/footer: v1.5.1 → v1.5.3
  - Timeline table: เพิ่ม v1.5.2 (report-worker crash isolation) + v1.5.3 (alert-worker/CSP/perf/CVE audit)
  - KPI: DB tables 20→21, DB Migrations 30+→40+
  - Doc status: 05-security.html date 2026-06-04→2026-06-07

- **2026-06-07 — docs(skill): SKILL.md full audit pass** (commit `86be848`) — ตรวจสอบ SKILL.md เทียบ source จริงครบทุกจุด:
  - **§4 System Settings**: เพิ่ม 8 keys ที่หายไป แบ่ง 4 กลุ่ม — Data retention (`clip_retention_days`, `appearances_retention_days`); Stats/display (`counter_dedup_mode`, `comparison_mode`, `custom_range_max_days`); Branding (`brand_tagline`, `brand_logo_path`); Map (`mapbox_token`)
  - **§5 White-label**: ระบุ key names ตรงๆ ใน how-to section
  - **§6 Health Check**: (1) Service Processes card แก้ description จาก pgrep-count เป็น PM2 status/uptime/↺restart/buttons พร้อม note 5 controllable vs 7 shown; (2) เพิ่ม 2 cards ใหม่: Camera Image Quality (24h) + Camera Automation Triggers (24h); (3) Storage card เพิ่ม clips + retention days; (4) API Server เพิ่ม Node version + Heap; (5) Status thresholds แยก warn/err ชัด (MQTT idle 5m-1h/stale >1h; memory >70%/>85%; disk >75%/>90%)
  - **§16 Runtime Stack**: เพิ่ม `pm2 save`, `scripts/services.sh` wrapper, `npm test` command + path

- **2026-06-07 — CVE audit round 4 + runtime stack upgrade** (commit `bb157ab`) — npm audit 0 vulnerabilities; อัปเกรด runtime stack ทั้งหมด:
  - **Node.js 20 → 22 LTS** (v22.22.3): Node 20 EOL 2026-04-30 → ย้ายก่อน EOL; `brew link --overwrite node@22`; `~/.zshrc` + `pm2.dojojin.plist` PATH อัปเดต; PM2 dump ล้าง + restart จาก `ecosystem.config.js`; `sharp` rebuild บน Node 22 (`npm rebuild sharp`); ยืนยันด้วย `lsof` (api-server pid ใช้ node@22 Cellar binary)
  - **EMQX 5.8.6 → 5.8.9** (pinned): image tag เปลี่ยนจาก `5.8` (floating) → `5.8.9` (pinned) ใน `docker-compose.yml`
  - **PostgreSQL 16.14** (verified): `SELECT version()` ยืนยัน 16.14 = latest 16.x; ไม่ต้องเปลี่ยน image
  - **pg 8.20.0 → 8.21.0**, **ws 8.20.1 → 8.21.0** (DoS fix CVE-2024-37890): `src/package.json` อัปเดต; `npm install` รัน fresh lock
  - **Puppeteer 24.43.1 → 25.1.0** / Chrome 148 → 149.0.7827.53: `src/package.json`; `npm install` ดึง `~/.cache/puppeteer/chrome/linux-149.0.7827.53` อัตโนมัติ
  - **EMQX port binding resilience** (SEC-001 Phase 2 update): เปลี่ยนจาก `192.168.10.31:1883:1883` → `1883:1883` (0.0.0.0); EMQX start ได้ทุก network interface (camera LAN / home LAN / VPN / hotspot); security เทียบเท่าเดิมผ่าน EMQX AUTHN (credentials บังคับทุก client); port 18083 ยัง `127.0.0.1:18083:18083` (localhost-only ไม่เปลี่ยน)

- **2026-06-07 — docs sync: security / SKILL.md / audit status** (commits `73fc373` `6217d8f` `5480000` `e8f94aa` `3fc2841` `281db3f`) — อัปเดตเอกสารตามสถานะจริงหลัง CVE audit round 4:
  - `73fc373` `05-security.html`: เพิ่มรอบ audit ที่ 4 (2026-06-07) ใน timeline table; section ใหม่ "CVE / Dependency Audit" พร้อมตาราง npm packages, runtime stack, EMQX network resilience card, EOL tracking; OWASP A6 badge `b-amber` → `b-green`; การป้องกัน CVE 4 แถวใหม่ (Node EOL, ws DoS, Docker images, Puppeteer/Chrome)
  - `6217d8f` `SKILL.md`: เวอร์ชัน v1.5.0 → v1.5.3; เพิ่ม §15 Camera Pause (ตาราง behavior MQTT/snapshot/alerts/heartbeat/feed/audit log); เพิ่ม §16 Runtime Stack Reference (ตาราง versions + PM2 commands + Docker commands + CVE audit link); Service Processes row อัปเดต "(7 workers: api-server, mqtt-subscriber, media-recorder, hikvision, dahua, report-worker, alert-worker)"
  - `5480000` `CODEX_AUDIT_2ndTier.md`: อัปเดต finding statuses หลัง audit round 4
  - `e8f94aa` `3fc2841` `281db3f`: docs minor — vigil-docs-v2 sync v1.5.3, vendor-comparison Bosch alert path, README footer

- **2026-06-06 — S4: route split — categories & mapping-rules → `src/routes/categories.js`** (commit `b8122a8`) — ย้าย 7 routes ออกจาก `api-server.js` (−111 lines) ตาม factory pattern `module.exports = function(app, pool) {}`:
  - GET/POST `/api/categories`, PUT/DELETE `/api/categories/:id`, GET/POST `/api/categories/:id/rules`, DELETE `/api/category-rules/:id`
  - `require('./routes/categories')(app, pool)` ใน api-server.js; auth สืบทอดจาก global `app.use('/api', ...)` gate อัตโนมัติ
  - smoke-tested: 401 (no token) / 200 (GET list) / 404 (wrong id) / 403 (builtin delete) ✓

- **2026-06-06 — S3: worker /health HTTP endpoints** (commit `c7e306f`) — loopback health endpoints สำหรับ monitoring:
  - alert-worker: `GET http://127.0.0.1:3002/health` → ok, uptime, pid, memory, db.latency, listener.connected
  - report-worker: `GET http://127.0.0.1:3001/health` → ok, uptime, pid, memory, db.latency, scheduler.last_check_at
  - api-server `/api/health/details` aggregate ทั้งสอง worker ใน response

- **2026-06-06 — S2: `events` table partition plan + migration script + retention fix** (commit `b8f6557`):
  - `db/MANUAL_partition_events_option_a.sql` (Option A: drop FK → monthly partitions 2026-01 → 2027-12 + DEFAULT catch) — MANUAL_ prefix, ไม่ auto-run; รันเมื่อ table ถึง ~500K rows
  - แก้ `enforceRetention()` ใน api-server.js: explicit DELETE appearances + license_plates ก่อน DELETE events — ป้องกัน FK violation หลัง partition migration
  - schema blockers verify จาก PG 16.13 จริง (rolled-back): composite PK บังคับ, FK single-column reject หลัง partition

- **2026-06-06 — S1: test harness (43 tests, node:test)** (commit `778b114`) — zero devDependency test runner ใช้ `node:test` + `node:assert/strict` (built-in Node 20):
  - `test/color-utils.test.js` (17 tests) — xyzToColorName achromatic/chromatic/edge cases ยืนยันจาก live DB
  - `test/crypto-creds.test.js` (11 tests) — AES-256-GCM round-trip + prefix guard + wrong-key rejection
  - `test/helpers.test.js` (3 tests) — routeError: 500 response format + no-leak guard
  - `test/alert-engine.test.js` (12 tests) — matchRule (8 tests) + isInCooldown (4 tests); values ยืนยันจาก source code จริง
  - `npm test` → `node --test test/*.test.js`

- **2026-06-06 — P4: Puppeteer render queue** (commit `71c9392`) — เพิ่ม `_renderTail` promise-chain mutex ใน `report-renderer.js:162`:
  - serialize renders 1 at a time — `_withPage()` await ticket ก่อนรัน, `release()` เมื่อ page closed
  - ป้องกัน concurrent render race condition (preventive hardening สำหรับ single-tenant prod)

- **2026-06-06 — P3b: drop `idx_events_type_trgm` (migration 040)** — ลบ GIN trigram index ที่ 1 scan ตลอดชีวิต:
  - EXPLAIN ANALYZE ยืนยัน: planner ใช้ Bitmap Index Scan สำหรับ `LIKE '%Recognition%'` แต่คืน 0 rows — ไม่มี LPR events ใน dataset; write cost บน hot INSERT path ไม่ได้รับ read benefit ใดเลย
  - migration 040 `DROP INDEX IF EXISTS idx_events_type_trgm` (idempotent); `pg_trgm` extension คงไว้ (partition migration ใช้)
  - LPR tab query ยังทำงานถูกต้อง — fallback seq_scan บน 63K rows, 42MB table

- **2026-06-06 — P3: drop `idx_events_raw_gin` (migration 039)** (commit `9df3731`) — ลบ GIN index ที่ 0 scans ตลอดชีวิต:
  - migration 039 `DROP INDEX IF EXISTS idx_events_raw_gin` (idempotent)

- **2026-06-06 — P1: ตั้ง `pool.max` + `application_name` ทุก worker** (commit `3be5bbb`) — ป้องกัน connection exhaustion + ระบุ process ใน `pg_stat_activity`:
  - api-server: `max:15`; alert-worker: `max:3`; report-worker: `max:3`; media-recorder: `max:2`; mqtt-subscriber: `max:5`; hikvision-isapi: `max:3`; dahua-cgi: `max:3` → รวม **34 connections**
  - `application_name` ครบทุก 7 worker; `max_connections=100`; headroom **~63** connections (หลัง superuser reserve 3)

- **2026-06-06 — alert-worker: isolate LINE/push alerts from MQTT ingestion (v1.5.3)** (commit `79abb51`) — แยก alert-engine ออกจาก mqtt-subscriber เป็น PM2 process ต่างหาก ป้องกัน LINE/push failure กระทบ ingestion หรือ web API:
  - `src/alert-worker.js` (new) — LISTEN บน 2 pg_notify channels: `alert_event` (payload จาก mqtt-subscriber → `alertEngine.onEvent()`) + `alert_rules_changed` (invalidate cache); dedicated `pg.Client` สำหรับ LISTEN + pool แยกสำหรับ alert-engine queries; singleton guard + reconnect loop (5s)
  - `src/mqtt-subscriber.js` — ลบ `alertEngine` require + `alertEngine.init()` + `alertEngine.onEvent()` ออกทั้งหมด; แทนด้วย `pg_notify('alert_event', payload)` ใน `if (ruleName)` guard (async, ไม่ block ingestion)
  - `src/api-server.js` — ลบ `alertEngine` require; แทน `invalidateCache()` 6 จุด → `pg_notify('alert_rules_changed','')` (PUT line-config, approve recipient, POST/PUT/DELETE alert-rules, LINE webhook leave/unfollow)
  - `ecosystem.config.js` — เพิ่ม worker ที่ 7 (`alert-worker`, `restart_delay: 3000`)
  - **Verified E2E**: MQTT จริง `BOSCH_8000i/LineDetector/Crossed` → mqtt-subscriber → `pg_notify` → alert-worker → `alert_logs` (delta=1, `status=no_recipients`, no double-fire)

- **2026-06-06 — report-worker: scheduler crash isolation + on-demand Run Now proxy (v1.5.2)** (commits `1b2dc94` `27b4a23` `85da151` `209d009`) — แยก scheduled-report loop ออกจาก api-server เป็น PM2 process ต่างหาก + เพิ่ม HTTP endpoint สำหรับ on-demand run:
  - **Step 1 (`1b2dc94`)**: `INTERNAL_API_TOKEN` → อ่านจาก env `INTERNAL_API_SECRET` (shared secret ระหว่าง api-server ↔ report-worker)
  - **Step 2 (`27b4a23`)**: สร้าง `src/report-worker.js` — PM2 process ที่รับ scheduler loop (60s tick) ออกจาก api-server; crash isolation: ถ้า Chrome/Puppeteer crash ใน worker → PM2 restart เฉพาะ worker; api-server ยังออนไลน์; แก้ bug `rangeLabel` scope + dangling `runScheduledReport()` call ที่ค้างใน api-server
  - **Step 3 (`85da151`)**: report-worker เปิด HTTP server บน `127.0.0.1:REPORT_WORKER_PORT` (default 3001, loopback-only); `POST /run/:id` — validate `X-Internal-Token` (length guard + timingSafeEqual), ตอบ 200 `{ok:true}` ทันที แล้ว `runScheduledReport` fire-and-forget; api-server `POST /api/report-schedules/:id/run` proxy ไปหา worker แทน 501 stub; ECONNREFUSED/timeout → 503 graceful; `REPORT_WORKER_PORT` เพิ่มใน `.env.example`
  - **UI (`209d009`)**: เพิ่ม `showToast` หลัง Run Now สำเร็จ ("กำลังสร้างรายงาน…") + แทน `alert()` ด้วย toast เมื่อ error; i18n keys `rh.runQueued` / `rh.runQueuedSub` (th+en)
  - **PM2 + launchd**: `ecosystem.config.js` เพิ่ม report-worker entry; `pm2 startup` launchd ติดตั้ง + verify หลัง reboot จริง (2026-06-06) ทุก 6 process online

- **2026-06-05 — SEC-2T-002 Pre-Phase-5 gate complete: zero inline scripts + handlers across all dashboard HTML** (decisions #203–#207, commit `93b1c22`) — งาน CSP migration ที่เริ่มตั้งแต่ 2026-06-04 เสร็จสมบูรณ์ใน 4 phases:
  - **Phase 2 (reporter + /others enforce, commits `959c52c` `0661b31` `21fe8c8`)**: เพิ่ม `/api/csp-report` endpoint + `Content-Security-Policy-Report-Only` header บน dashboard routes เพื่อดู violation log จริง; enforce CSP สำหรับ `/others/*` (non-dashboard routes ที่ไม่มี inline script) ทันที
  - **Phase 3 (164 static handlers, commit `fa84855`)**: migrate `onclick=` ทุกตัวที่อยู่ใน static HTML (sidebar, nav, modal triggers ฯลฯ) → `_bindStaticHandlers()` pattern ใน `dashboard.js`; แก้ selector regression `_updateHealthSendBtnLabel` (commit `df8e461`)
  - **Phase 4 Batches 1–8 (commits `117f3fb`→`165e933`)**: migrate 189 handlers ที่เหลือในส่วน dynamic — สร้าง **global dispatcher** (`document.addEventListener('click', fn)` + `ACTION_MAP` keyed by `data-action`) สำหรับ handlers ใน innerHTML template literals (pagination, groups, Events, Snapshots, Media, CamDetail, Stats, Reports, Cameras, LINE); รองรับทั้ง `click` และ non-click events (`change`, `input`, `keyup`, `keydown`) ใน dispatcher เดียว
  - **Pre-Phase-5 gate (commit `93b1c22`)**: (1) Externalize 4 inline `<script>` blocks → `theme-init.js` / `login.js` / `disclaimer.js` / `report-print.js`; (2) migrate 28 `on*=` ที่เหลือใน `index.html` + login + disclaimer + i18n string → `_bindStaticHandlers` + `addEventListener`; (3) replace 9 `onerror=` ใน JS template literals → `data-err=` vocab + `window.addEventListener('error', fn, true)` capture listener; (4) patch CSP policy gaps: `cdn.jsdelivr.net` (script+style), `cloudflareinsights.com` (script+connect), `tile.openstreetmap.org` + `*.tile.openstreetmap.org` (img-src ต้องใส่ทั้ง bare+wildcard), `worker-src blob:` (OL web workers)
  - **ตัวเลขรวม**: ~353 `onclick=` + 28 `on*=` อื่น + 9 `onerror=` = **390 inline handlers** ออกทั้งหมด; 4 inline `<script>` blocks externalized; grep source สะอาด 100%
  - **Phase 5 พร้อม**: เปลี่ยน `Content-Security-Policy-Report-Only` → `Content-Security-Policy` ใน `api-server.js` 1 บรรทัดเพื่อ enforce จริง

- **2026-06-05 — Platform UI rename: "DojoJin Tech Dashboard" → "Vigil Platform"** (commits `56dafd2` `39954ae`) — เปลี่ยน product display name ใน docs, dashboard title, i18n strings, และ login page title; repo + folder + DB ชื่อ `vigil-platform` อยู่แล้วตั้งแต่ 2026-05-29 — นี่คือ UI/display text ที่เหลือ

- **2026-06-05 — EULA: English version + per-lang routing + cache fix** (commit `ab179fa`) — เพิ่ม `docs/EULA-en.md` (English EULA); `GET /api/eula` ส่ง lang param → serve ภาษาที่ตรง; `disclaimer.html` EULA viewer routing ถูกต้องตาม `I18N.lang()`; แก้ cache ที่ cache เวอร์ชัน TH ค้างเมื่อสลับภาษา

- **2026-06-05 — Fix: AirDatepicker default locale is Russian** (commit `75000f5`) — เพิ่ม `locale: en` option ให้ datepicker ทุก instance ใน English mode; ก่อนหน้านี้ปฏิทินแสดงชื่อเดือน/วันเป็น Cyrillic เมื่อใช้ภาษา EN

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

---

### 2026-06-17

- **Route split: faces.js — S4 ✅ COMPLETE** (commit `f0ad8d2`) — `/api/faces`, `/api/faces/summary`, `/api/face-matches` + `_buildFaceFilter` ย้ายออกจาก `api-server.js` → `src/routes/faces.js` (api-server.js: 1944→1816 ลบ., −128). S4 route split campaign ✅ ครบทุก **20 modules** แล้ว.

- **Hikvision Body Appearance ingestion** (commits `3cb95d6`, `37422f5`, `6c38c85`) — Hikvision FaceReg camera ส่ง second HTTP push `mixedTargetDetection` ~2s หลัง FaceRecognition alarm พร้อม body appearance JSON + `humanImage` JPEG:
  - `parseFaceAlarmMultipart` แยก `bodyJson` จาก `alarmJson` ได้แล้ว
  - `_pendingBodyLink` Map เชื่อม FaceRecognition `event_id` → body push ผ่าน 10s TTL (keyed by `camera_id`); `525dd75` เพิ่ม cleanup on TTL expiry
  - `ingestBodyAppearance` → INSERT INTO `appearances` (upper_color/lower_color/top_category/bottom_category/bag_category/gender/glasses/attributes) + JSONB patch บน `events.raw_json` (jacketColor/trousersColor/jacketType/trousersType/direction/hairStyle) + บันทึก `humanImage` → `snapshots/`
  - Normalize Hikvision body field names → BOSCH canonical format เพื่อให้ Appearance page แสดง color dot ถูกต้อง; `5f52263` + `fe7a412` fix color dot ใน chips + appearances search

- **Face Capture merged → All Faces tab** (commit `43f0828`) — Face Recognition page ได้ tab bar "Matches / All Faces":
  - All Faces tab โหลด `/api/faces` พร้อม filter ครบ (gender/age/expression/glass/mask/hat/from-to); commit `528b677` เพิ่ม camera + body appearance filters
  - Face sidebar nav item ซ่อนแล้ว — face ทั้งหมดอยู่ใน Face Recognition page
  - `#page-faces` HTML ยังคงอยู่ใน DOM เป็น rollback guard (unreachable via nav)

- **Body appearance in match detail modal** (commit `6a4c98f`) — แสดง `humanImage` + color swatches (top/bottom) + jacket/trousers type + direction เมื่อ `mixedTargetDetection` data พร้อม

- **Person Data (Appearance) page — 3 new charts + mask/hat tiles** (commit `f21f2bd`) — `/api/appearances/stats` เพิ่ม 3 parallel queries (age_group, expression, direction) + accessories counts (mask/hat); page แสดง Chart.js bar charts: สัดส่วนช่วงอายุ, อารมณ์, ทิศทางการเดิน; Mask/Hat gauge tiles

- **Face Recognition UI polish & fixes** (commits `d05b922`, `bc533f6`, `1219ab0`, `82d0b17`, `7bfd965`, `b5074b8`, `bebf14d`, `588b062`):
  - Hits-only toggle ("รวมที่ไม่จับคู่ได้" pill) — default แสดงเฉพาะ matched faces
  - LINE alert ส่ง `backgroundImage` (full scene) แทน face crop
  - Face Recognition Detail modal: full frame + clip ฝั่งซ้าย; crop + table + ref + body chips ฝั่งขวา
  - clickable All Faces cards → Face Detail modal
  - Bosch-style body chips + body image layout ใน modal
  - nav badges (unread count) + WS auto-refresh บน FaceRecognition event type
  - sanitize colorDot CSS: `replace(/[^a-zA-Z0-9#]/g, '')` — ป้องกัน CSS injection ผ่าน color value จาก DB (GOTCHAS #91)

- **migration 047** (`alert_list_types`) — `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS list_types text[] DEFAULT NULL` — กฎ alert กรองเฉพาะ `listType` ที่ระบุ (เช่น blackList เท่านั้น); `NULL` = pass ทุก list type; alert rule editor UI รองรับ multi-select

<sub>End of CHANGELOG.md · Companion to CLAUDE.md · Updated 2026-07-21</sub>
