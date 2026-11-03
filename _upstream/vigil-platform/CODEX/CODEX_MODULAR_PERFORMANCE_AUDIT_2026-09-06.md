# Vigil Platform — Audit การแยก Monolith เพื่อประสิทธิภาพ

- Audit ID: **VMOD-20260906**
- วันที่: **6 กันยายน 2026**
- ผู้ตรวจ: Codex
- Repository: `/home/vigil-central/vigil-platform`
- Branch: `main`; ฐาน commit ขณะตรวจ: `ea8c70e`
- ขอบเขต: อ่านโครงสร้างและ implementation จริง เทียบ audit เดิม แล้วเสนอ modular boundaries ที่มีเหตุผลด้าน latency, throughput, memory และ contention
- ผลงานรอบนี้: **เอกสารเท่านั้น** ไม่ implement refactor, ไม่ restart, ไม่รัน migration และไม่เปลี่ยน runtime configuration
- ชื่อไฟล์นี้เป็นรายงานใหม่ ไม่ทับหรือเปลี่ยนชื่อ audit CODEX เดิม

## 1. ข้อสรุปหลัก

**แยกได้ และมีหลายส่วนที่ควรแยก แต่การย้ายโค้ดไปอีกไฟล์เพียงอย่างเดียวไม่ทำให้ระบบเร็วขึ้นอย่างมีนัยสำคัญ** เพราะยังใช้ event loop, DB pool, CPU และ disk ชุดเดิม

Vigil เป็น modular monolith ที่แยกหลาย process แล้ว ไม่ใช่ monolith ก้อนเดียวทั้งหมด จุดที่ยังรวมงานมากที่สุดคือ `api-server` ซึ่งรับ HTTP/WebSocket พร้อมงาน storage, image processing, monitoring, retention และเริ่ม refresher หลายตัว ส่วน route บางไฟล์รวม query/cache/background scheduler อยู่ใน factory เดียวกัน

ลำดับที่แนะนำ:

1. **ก่อนขยาย cache: ทำ cache identity ให้ครอบสิทธิ์รายกล้อง** — พบว่า cache keys บางจุดใช้ site IDs แต่ scope จริงมี camera restrictions เพิ่มอยู่ด้วย ต้องไม่ทำ performance optimization ที่นำผลของคนหนึ่งไปให้คนอีก scope
2. **แยก health collection ออกจาก request พร้อมเลิก synchronous subprocess ใน API** — มี `execFileSync('pm2', ...)` ในเส้นทาง health cache miss เป็นจุดบล็อก event loop ที่เห็นชัดจากโค้ด
3. **แยก storage scan/orphan scan ไป maintenance worker** — การตอบ HTTP ก่อนแล้วเรียก async function ต่อยังเป็นงานใน API process และ orphan walk มี synchronous filesystem traversal
4. **นำ on-demand report rendering ออกจาก API ให้ครบ** — scheduled reports มี worker แล้ว แต่หลาย download/render routes ยังเรียก renderer ใน API process
5. **แยก stats query/cache orchestration เป็น module แล้วรวม concurrent cache misses** — ช่วยลดการคำนวณซ้ำจริง โดยเริ่มจาก process เดิมก่อนแยกเป็นบริการ
6. **ย้าย rollup/retention เป็นงานที่มีเจ้าของและ resource budget ชัดเจน** — ได้ isolation แต่ SQL/disk workload ไม่หาย ต้องคุม concurrency และ freshness ด้วย
7. **จัด module สำหรับ image transforms และ Edge queue accounting** — ทำเมื่อมี baseline ยืนยันว่าภาระสองกลุ่มนี้เป็นคอขวดของ workload ที่สนใจ

ไม่เสนอ rewrite frontend, เพิ่ม ORM หรือแยก microservice ทุก route เพราะหลักฐานที่พบชี้ไปที่ **งานซ้ำ, blocking I/O, scheduling และการใช้ resource ร่วมกัน** มากกว่าจำนวนบรรทัดในไฟล์

## 2. วิธีตรวจและระดับความมั่นใจ

### Fact — สิ่งที่ทำจริง

- ตรวจ current working tree ไม่ใช่ดู audit เก่าอย่างเดียว
- อ่านจุดสำคัญของ `api-server`, report renderer/worker/routes, health/storage routes, storage scan/stats helpers, LPR/appearance statistics, rollup refresher, auth scope และ Edge bridge
- เทียบกับ `CODEX_api-refactor_suggestion.md`, `CODEX_suggestion_refactor.md`, `CODEX_Audit_5th_Audit_part_optimization.md` และ `microservice_plan.md`
- ตรวจ branch/upstream และ fetch ก่อนเตรียมเอกสาร: `HEAD...origin/main` เท่ากับ `0 0` ณ จุดตรวจ จึงไม่มี commit เก่าค้างที่จะถูกพ่วง push ในเวลานั้น
- มีไฟล์แก้ค้างก่อนงานนี้: `service_start.md`, `src/api-server.js`, `src/report-renderer.js` และ PDF vendor ที่ยังไม่ tracked หนึ่งไฟล์ เอกสารนี้วิเคราะห์ working tree รวมการแก้ค้างเหล่านั้น แต่ไม่รวมไฟล์เหล่านั้นใน commit รายงาน

### ข้อจำกัด

- **ไม่ได้ทำ runtime performance reproduction หรือ load test** จึงยังไม่มี before/after benchmark ใหม่ และไม่ระบุว่าจะเร็วขึ้นกี่เปอร์เซ็นต์
- ค่าความช้า/RSS/จำนวนแถวใน comments และ audit เก่าเป็น historical measurements ของผู้พัฒนา ไม่ใช่ผลวัดรอบนี้
- ไม่อ่าน `.env`, เนื้อหา camera credentials, customer records หรือภาพบุคคล/ทะเบียนรถ
- ไม่มีการทดลอง restart, queue overflow, export หรือ scan บน production
- “Fact” ใน findings คือ implementation ที่อ่านพบ; “ผลต่อประสิทธิภาพ” เป็นข้ออนุมานที่ต้องพิสูจน์กับ workload ก่อน implement

### ประเภทของการแยก

| ประเภท | สิ่งที่เปลี่ยน | ผลด้านความเร็วที่คาดหวัง |
|---|---|---|
| แยกไฟล์/ฟังก์ชัน | code organization และ dependency boundary | โดยลำพังใกล้เคียงเดิม; ช่วยทดสอบและเปลี่ยนส่วนที่หนักได้ปลอดภัย |
| ลดงานซ้ำ | cache, single-flight, batching, reuse ผลคำนวณ | ลดงานที่ทำจริง จึงมีโอกาสลด DB/CPU/I/O โดยตรง |
| ทำ I/O แบบไม่บล็อก | async subprocess/fs และ stream | ลดเวลาที่ event loop รับงานอื่นไม่ได้; เวลางานเดิมอาจใกล้เคียงเดิม |
| ย้ายไป worker/process | event loop, memory และ pool แยก | ลดผลกระทบต่อ API แต่ CPU/disk/DB รวมยังใช้ร่วมกัน และมีค่า IPC เพิ่ม |
| แยก service/host | deployment และ hardware boundary | ใช้เมื่อมีเหตุผลด้าน capacity/availability จริง; เพิ่ม network, auth และ consistency complexity |

## 3. สภาพ Monolith ปัจจุบัน

| พื้นที่ | สภาพที่พบ | ความหมาย |
|---|---|---|
| `src/api-server.js` | 3,216 บรรทัด; auth/static/media/WS/route wiring/retention/monitoring | เป็นทั้ง composition root และเจ้าของงานที่รันระหว่างให้บริการ |
| `src/routes/` | 39 ไฟล์ | แยกตาม domain แล้ว แต่บาง factory รวม cache, SQL และ timer |
| `src/report-renderer.js` | 2,032 บรรทัด; Chromium pool และ render queue ต่อ process | แยกเป็น module แล้ว แต่การ require จาก API ยังทำงานใน API process |
| `report-worker` / `alert-worker` | เป็น process แยกใน PM2 | ไม่ควรเสนอการแยกครั้งแรกซ้ำ; ตรวจ call paths ที่ยังเหลือใน API |
| Rollup refreshers | มี module แยก แต่ API เรียก `.start(pool)` | module boundary มีแล้ว แต่ execution/resource boundary ยังร่วม API |
| Storage scan | route ตอบก่อน แล้วเรียก `runScan()` ใน process เดิม | “background” ในระดับ HTTP ไม่เท่ากับแยก event loop |
| Frontend | page scripts แยกแล้ว โหลดแบบ classic scripts | แยกไฟล์เพิ่มเฉย ๆ ไม่ลด DOM/JS/network ที่ใช้งานจริง |
| Edge bridge | เป็น process แยกและมี disk queue | จุดปรับคือ algorithm ของ queue bookkeeping ไม่ใช่แยก Edge ใหม่ |

## 4. ตรวจเทียบ Audit เก่า: ส่วนใดทำไปแล้ว

| ข้อเสนอ/สภาพจากเอกสารเดิม | โค้ดปัจจุบันที่ตรวจพบ | ข้อสรุปรอบนี้ |
|---|---|---|
| Extract API policy/jobs/wiring | route split มีแล้ว แต่ API ยังมีหลาย concern | ข้อเสนอเดิมยังมีประโยชน์เชิง maintainability แต่ต้องแยกออกจาก performance claims |
| Health diagnostics ควร cache | มี `_HEALTH_CACHE_TTL_MS = 35_000`, `_cached()` และ section timing | ไม่เสนอ “เพิ่ม cache ครั้งแรก”; เจาะ synchronous PM2 call และ concurrent miss แทน |
| LPR image prune ควรลบตาม date directory | `pruneLprImages()` มี fast path แล้ว | ไม่ย้อนกลับไปอธิบายว่า LPR prune ยัง per-file ทั้งหมด |
| Edge thumbnails ควรมี cache | API มี memory cache TTL 60 วินาที / cap 500 entries | ข้อเสนอใหม่เน้น in-flight dedup, bounded transforms และ byte budget |
| LPR stats ควรใช้ temp table ทั้งชุด | main stats path เปลี่ยนเป็น pool queries + rollups แล้ว; report path บางส่วนยังใช้ temp table | ห้ามนำข้อเสนอ temp-table เดิมมาทับทุก path; ต้องวัดตาม workload |
| Report/alert process isolation | มี worker อยู่แล้ว แต่ manual render routes ยังเรียก renderer | ทำ isolation ให้ครบตามเส้นทางใช้งาน |
| Browser launch ทุกครั้ง | renderer มี browser reuse, serialization และ idle close | อย่าสร้าง browser pool อีกชุดซ้อนหรือเพิ่ม concurrency โดยไม่มี memory budget |
| ลด WebSocket firehose | commit ก่อน audit นี้มี subscription/lite payload แล้ว | รักษาพฤติกรรมล่าสุด; ไม่เสนอว่าไม่มีการลด payload |

หลักฐาน: `src/routes/health.js:76-84`, `src/lpr-retention.js:62-84`, `src/api-server.js:716-744`, `src/routes/lpr-query.js:675-713`, `src/report-renderer.js:213-332`, `dashboard/dashboard.js:1270` และ Git commits `9363229`, `2ed4289`

## 5. ตารางจัดลำดับ Modularization

คำว่า “สูง/กลาง” ในตารางเป็น **โอกาสลดผลกระทบจากกลไกที่พบ** ไม่ใช่คะแนนหรือผล benchmark

| ID | ขอบเขตที่เสนอ | ทำใน process เดิมก่อนได้ไหม | เหตุผลที่อาจเร็วขึ้น | ความเสี่ยง/ข้อแลกเปลี่ยน | ลำดับ |
|---|---|---|---|---|---|
| VMOD-00 | Scope-aware query/cache identity | ได้ | เป็น prerequisite ให้ reuse ผลอย่างถูกต้อง | cache ข้ามสิทธิ์ถ้า key ไม่ครบ | ก่อนทุก cache optimization |
| VMOD-01 | Health collector | ได้: async + single-flight ก่อน | ตัด event-loop blocking และ probe ซ้ำ | freshness/unknown state | 1 |
| VMOD-02 | Storage/orphan scan worker | แยก module ได้ แต่ sync walk ยังบล็อก | เอา traversal/rows accumulation ออกจาก API | disk/DB contention ยังอยู่ | 1 |
| VMOD-03 | Report execution boundary | ควรใช้ worker ที่มีอยู่/ขยาย contract | ลด Chromium/render queue ใน API | export latency, queue starvation, scope | 2 |
| VMOD-04 | Statistics service + query coordinator | ได้ และควรเริ่มแบบนี้ | รวม misses และจำกัด expensive query fan-out | TTL, key identity, consistency | 2 |
| VMOD-05 | Rollup/retention scheduling | ได้ แต่ process isolation ช่วยมากกว่า | แยก pool และกำหนดงานไม่ชนกัน | job ซ้ำ/ตกหล่น, DB locks | 3 |
| VMOD-06 | Image transform pipeline | ได้: bounded queue + dedup ก่อน | ลด fetch/resize ซ้ำและ memory spikes | auth/cache key/timeout/cancellation | 3 |
| VMOD-07 | Edge queue storage/accounting | ได้ภายใน edge-bridge | ลดการ scan คิวทุกครั้งที่ enqueue | accounting drift และ replay correctness | 3 |
| VMOD-08 | WS/policies/camera services/front-end boundaries | ได้ | หลัก ๆ เป็น maintainability | regression ถ้าย้ายลำดับ/เปลี่ยน lifecycle | ตามงานที่แตะ |

## 6. Findings แบบละเอียด

### VMOD-00 — Cache identity ต้องรวม camera scope ก่อนทำ shared caching

**Fact**

- `auth.makeScope()` สร้าง array ของ site IDs แล้วแนบ `cameras` เป็น property แบบ non-enumerable: `src/auth.js:533-537`
- `getAllowedSites()` คืน scope ที่รวม camera restrictions: `src/auth.js:540-553`
- LPR stats key สร้าง `_allowedStr` ด้วย `allowedSites.join(',')`: `src/routes/lpr-query.js:1003-1011`
- Appearance stats key ใช้รูปแบบ site list เดียวกัน และไม่ได้ใส่ camera restrictions property: `src/routes/appearances.js:229-235`
- query จริงใช้ `siteWhere()` ซึ่งรับ scope object ที่มี camera restrictions เพิ่มด้วย

**ข้ออนุมานที่ต้องพิสูจน์**

ผู้ใช้สองคนที่ site IDs เหมือนกันแต่ถูกจำกัดคนละกล้อง สามารถสร้าง cache key เดียวกันได้เมื่อ query parameters อื่นเหมือนกัน นี่เป็นความเสี่ยงต่อความถูกต้องและขอบเขตข้อมูล ไม่ใช่เพียงเรื่อง cache hit ratio; ยังไม่ได้ยิง endpoint จริงด้วยสองบัญชีในรอบนี้

**Modular boundary ที่เสนอ**

`src/services/query-context.js` — ชื่อเสนอใหม่ ไม่ใช่ไฟล์ที่มีอยู่แล้ว:

- สร้าง effective scope หลังผ่าน auth; normalize site/camera lists อย่างมีลำดับคงที่
- แยก unrestricted (`null`) ออกจาก empty/deny (`[]`) อย่างชัดเจน
- รวม filters, time window, timezone, KPI/full shape, rule/criteria version ที่มีผลต่อผลลัพธ์
- คืนทั้ง query arguments และ cache identity จากข้อมูลเดียวกัน ลดการประกอบ key กับ SQL คนละตรรกะ

**เกณฑ์ผ่านก่อนเพิ่ม cache**

ใช้ synthetic users: site เท่ากัน/camera ต่างกัน, unrestricted, deny-all, camera pill subset และเปลี่ยนสิทธิ์ระหว่างใช้งาน ผลต้องไม่ถูก reuse ข้าม scope; test ที่ key level ต้องตามด้วย integration response test

**ผลด้านความเร็ว:** ไม่มีคำรับรองว่าจะเร็วขึ้นจากแก้ key แต่เป็นเงื่อนไขจำเป็นก่อน VMOD-04 หรือ shared cache ใด ๆ

### VMOD-01 — Health collection ยังมี synchronous subprocess ใน request path

**Fact**

- `/api/health/details` เรียก `execFileSync('pm2', ['jlist'], { timeout: 5000 })` ภายใน cache loader: `src/routes/health.js:547-550`
- `_cached()` เก็บ completed value หลัง `await fn()` ไม่ได้เก็บ pending promise: `src/routes/health.js:78-84`
- Health snapshot stats ยังเรียก `_snapshotStats()` ผ่าน cache ใน request path: `src/routes/health.js:488`
- Worker health probes ถูก await ต่อกันใน cached object: `src/routes/health.js:537-540`
- `helpers/storageStats.js` มี shared completed-value cache ของ spool/clips อยู่แล้ว แต่ยังไม่มี in-flight entry ใน helper ที่อ่าน: `src/helpers/storageStats.js:16-25`

**เหตุผลเชิงประสิทธิภาพ**

ขณะ synchronous child process ทำงาน API event loop รอจนคำสั่งจบ แม้จะเกิดเฉพาะ cache miss; timeout 5 วินาทีเป็นเพดานตั้งค่า ไม่ใช่ผลวัดเวลาจริงทุก request ส่วน async loaders ที่ miss พร้อมกันอาจทำงานซ้ำก่อนมี completed value

**เสนอแยก**

`src/services/health-collector.js` ทำ collection/cache/single-flight และคืน snapshot ที่มี `measured_at`, `stale`, `partial`, `error` ต่อ section; `routes/health.js` ประกอบ response และบังคับสิทธิ์

เริ่มด้วย async `execFile` + bounded timeout และ in-flight dedup ใน API ได้ก่อน ถ้ายังมี I/O pressure ค่อยให้ maintenance worker เก็บ expensive inventory ส่วน DB ping/ingest liveness ที่ต้องสดให้สดตาม contract เดิม ไม่ซ่อน outage ด้วย stale success

**เกณฑ์พิสูจน์**

- จำลอง slow PM2 command บนระบบทดสอบ แล้วส่ง lightweight HTTP + WS heartbeat ระหว่าง health miss
- ดู p95/p99 event-loop delay และ latency ของ request อื่น ไม่ดูแค่ health endpoint เร็วขึ้น
- concurrent callers ที่ key เดียวกันเกิด expensive async loader หนึ่งครั้งต่อรอบ
- error/timeout ต้องไม่แปลงเป็นสถานะ healthy และ response schema เดิมยังตรง

### VMOD-02 — Storage scan ตอบ HTTP แล้ว แต่ยังใช้ event loop ของ API

**Fact**

- `runScan()` เป็น closure ใน `routes/storage.js` และใช้ `pool` ที่ inject จาก API: `src/routes/storage.js:28-83`
- `POST /api/storage/scan` ส่ง response แล้วเรียก `runScan('manual')`: `src/routes/storage.js:237-251`
- `runScan()` เรียก `countEventOrphans()`: `src/routes/storage.js:67`
- Orphan helper เดิน directory ด้วย `readdirSync` / `statSync` แล้วสะสม rows array ก่อนเริ่ม DB temp-table comparison: `src/helpers/storageScan.js:294-336`
- `GET /api/storage` อ่านผลใน `storage_stats` อยู่แล้ว ไม่ต้องสร้าง data source ใหม่ทั้งชุด

**เหตุผลเชิงประสิทธิภาพ**

`async function` ไม่ทำให้ synchronous traversal ไปอยู่อีก thread การตอบ started:true เร็วไม่สะท้อนความหน่วงของ request อื่นขณะที่ loop เดินไฟล์หรือ memory โตตาม inventory

**เสนอแยก**

`src/jobs/storage-inventory.js` + maintenance worker ที่รับคำขอ scan และเขียนผลลง `storage_stats` เดิม API รับคำขอ/รายงานสถานะ; แยก inventory scan กับ orphan reconciliation เป็น job คนละชนิด เพราะต้นทุนและ freshness ต่างกัน

**เงื่อนไขสำคัญ**

- คง single active scan ต่อ machine; จาก `_scanRunning` ใน memory เปลี่ยนเป็น ownership ที่ไม่ซ้ำเมื่อ restart/หลาย instance
- ระบุ queued/running/partial/failed/completed และอายุผลลัพธ์; ไม่ใช้ fire-and-forget ที่ไม่มี recovery contract
- จำกัด DB pool และ I/O concurrency ของ worker; ย้าย process ไม่ได้ลด physical disk contention เอง
- อย่าเปิด orphan deletion ตามการย้ายนี้ โค้ดเดิมแยก scan กับ purge และมีเหตุผลที่ไม่ลบ orphan อัตโนมัติ

**เกณฑ์พิสูจน์:** fixture directory ขนาดต่าง ๆ, RSS/heap, API event-loop delay ขณะ scan, จำนวนไฟล์/bytes/partial เท่ากับเดิม และ restart ระหว่าง scan ไม่เกิดเจ้าของซ้ำ

### VMOD-03 — Manual reports ยังเปิด render workload ใน API

**Fact**

- `routes/reports.js` เรียก `report-renderer` และ `renderReportPdf/Image` โดยตรง: `:111`, `:132`, `:194`; face/LPR render paths อยู่ที่ `:304`, `:327`, `:352`, `:374`
- renderer มี `_browserPromise`, `_renderTail`, idle close และ `_withPage()` ต่อ process: `src/report-renderer.js:213-332`
- scheduled report-worker แยกแล้ว และมี `/run/:id` ที่อ่าน report schedule: `src/report-worker.js:530-585`
- renderer เรียก API ภายในเพื่อดึงข้อมูลและเปิด report pages จึงยังพึ่ง API/DB แม้ย้ายไป worker

**เหตุผลเชิงประสิทธิภาพ**

แยกไฟล์ renderer ไปแล้วไม่เท่ากับแยกการทำงาน Manual render ยังใช้ resources ภายใต้ API process และ Chromium ที่มันเปิด ขณะที่ scheduled worker มี browser/queue อีกชุด การมี process แยกช่วย responsiveness และ memory ownership มากกว่ารับประกัน PDF เสร็จเร็วขึ้น

**เสนอแยก**

เพิ่ม **render-only contract** ให้ worker ที่มีอยู่ก่อนพิจารณาสร้าง service ใหม่ API ส่ง validated render job พร้อม effective scope และผลลัพธ์เป็น artifact reference/stream ที่บังคับสิทธิ์เดิม

**ห้ามใช้ `/run/:id` แทน download route ตรง ๆ** เพราะเป็น schedule execution path และอาจส่ง LINE/สร้างประวัติการส่ง การกดดาวน์โหลดต้องไม่มี notification side effect ที่เพิ่มมาโดยไม่ตั้งใจ

**เงื่อนไขสำคัญ**

- คง browser reuse และ serialized/bounded execution เดิม; การรวม queue อาจทำให้ manual download รอนานขึ้น ต้องมี fairness ระหว่าง manual/scheduled jobs
- จำกัด queue depth, job timeout, cancellation และ temporary artifact retention
- Worker ต้องได้รับ validated camera/site scope; internal token ไม่ใช่เหตุผลให้ละเลย user scope
- แยก render กับ delivery ให้ชัด และมี job ID/idempotency เพื่อไม่ส่งรายงานซ้ำเมื่อ retry
- อย่าแทน Health PNG แบบ SVG+sharp ด้วย Chromium โดยไม่มีเหตุผล เพราะเป็นคนละ render path ที่ตั้งใจไว้

**เกณฑ์พิสูจน์:** เปรียบเทียบ API p95 ระหว่าง render, RSS ทั้ง Node+Chromium รวมทุก process, manual/scheduled queue wait, เวลา export และ visual/field parity ของ PDF/PNG

### VMOD-04 — Stats module ที่ลดงานซ้ำจริง: scope-safe cache + single-flight

**Fact**

- LPR มี multi-entry LRU cache cap 24, period-aware TTL และ `generated_at` แล้ว: `src/routes/lpr-query.js:75-101`
- Cache miss request เรียก compute โดยตรงแล้วค่อย set value: `src/routes/lpr-query.js:1001-1040`; ไม่เห็น per-key in-flight map ในเส้นทางนี้
- Warm loop มี `_lprWarmBusy` ป้องกัน warm ซ้อนกัน แต่ไม่ใช่ coordination กับ request miss: `src/routes/lpr-query.js:974-998`
- Appearance stats ยังเป็น completed-result slot เดียวและ key เดียว: `src/routes/appearances.js:232-235`, `:394-396`
- Appearance query materialize filtered rows ลง temp table และ aggregate ผ่าน client เดียวอยู่แล้ว: `:269-301`
- LPR main stats ใช้ pool parallel queries และ rollup ตาม period; report path บางส่วนใช้ temp table คนละ workload

**เหตุผลเชิงประสิทธิภาพ**

ผู้ใช้หลายคนหรือ warm/request ที่ miss key เดียวกันอาจสั่ง query ชุดเดียวกันซ้ำ การแยก query service แล้ว coalesce requests ลดจำนวนงานจริง ส่วนการเพิ่ม pool connections โดยไม่จำกัด fan-out อาจกลับทำให้ DB ช้าลง

**เสนอแยก**

- `src/services/stats-query-service.js`: query execution, result shaping และ resource budget
- `src/services/query-cache.js`: bounded completed entries, pending promises, invalidation และ instrumentation
- `src/services/query-context.js`: effective scope/key ตาม VMOD-00

เริ่มใน API process เดิมเพื่อไม่เพิ่ม network hop และยังรักษา temp-table session affinity การเปลี่ยนเป็น analytics service แยกควรเป็นขั้นถัดไปเมื่อ baseline ยืนยัน need

**Contract ที่ต้องรักษา**

- ปิด VMOD-00 ก่อน; ห้ามแชร์ผลข้าม camera scope
- KPI/full payload, timezone, custom dates, camera filters และ criteria version ต้องอยู่ใน identity ที่เหมาะสม
- ให้ warm และ HTTP ผ่าน coordinator เดียวกัน; rejected promise ต้องถูกนำออก ไม่ cache error เป็น success
- Pending jobs และ memory ต้องมีเพดาน; cap จำนวน entries ไม่ใช่ byte limit เสมอไป
- คง TTL/เกณฑ์หมวกร่วมจาก `helmetCriteria`; อย่ายืด/หด TTL เฉพาะหน้าให้ยอดรวมต่างกันโดยไม่ระบุ freshness
- `Promise.all` บน client เดียวไม่ได้ทำให้ SQL บน connection เดียวขนานกัน อย่าเปลี่ยนทุก query ให้ใช้ pool ถ้า temp table ยังผูกกับ session นั้น

**เกณฑ์พิสูจน์:** ส่ง 10 requests key เดียวพร้อมกันบน DB ทดสอบ ต้องมี compute หนึ่งชุด; สลับ scope/filter ไม่มี cache bleed; วัด DB query count, pool wait, cache hit/miss/coalesced และ p95 ทั้ง cold/warm

### VMOD-05 — Rollup/retention เป็น module แล้ว แต่ scheduling ยังติด API

**Fact**

- API เริ่ม helmet criteria, traffic/KPI/category refreshers ด้วย `pool` เดียวกัน: `src/api-server.js:2228-2235`
- API ตั้ง retention timers หลายกลุ่ม: `:2488-2489`, `:2570-2571`, `:2590-2591`, `:2646-2647`, `:2697-2701`, `:2732-2733`
- แต่ละงานมีช่วงเริ่มหลัง boot หลักสิบวินาทีถึงไม่กี่นาที จึงมีโอกาสทำงานทับช่วง warm-up
- Category refresher มี `_running` ใน module ป้องกันรอบซ้อนเฉพาะ process: `src/category-rollup-refresher.js:34-36`, `:93` เป็นต้นไป
- LPR prune เป็น helper แยกและมี date-dir fast path แล้ว; general/LPR retention ยังมี DB batch deletes ที่ต้องเคารพลำดับ children

**เสนอแยก**

`src/jobs/rollups.js`, `src/jobs/retention.js` และ worker owner ที่มี `start/stop/runOnce/status` ชัดเจน ใช้ DB transaction/lock หรือ ownership mechanism ที่เหมาะกับ job lifecycle เพื่อให้หนึ่ง job มีผู้ทำงานเดียว

**ผลด้านความเร็วและข้อจำกัด**

- แยก pool budget ช่วยไม่ให้ background tasks ยึด API slots ทั้งหมด
- Job staggering ลด burst หลัง boot แต่ไม่ได้ทำให้ SQL แต่ละคำสั่งเร็วขึ้น
- ถ้า DB CPU/disk เป็นคอขวด ย้ายไป worker แล้วรันพร้อมกันมากขึ้นอาจแย่ลง
- ไม่จำเป็นต้องรวม long orphan scan กับ time-sensitive rollup ใน serial queue เดียวจน rollup อดทำงาน; ใช้ job lanes/priority ตามข้อจำกัด resource
- `helmetCriteria` มี process-local cache ที่ query path ใช้ ไม่ควรย้าย `.start()` ออกแล้วปล่อย API ไม่มี criteria ที่อัปเดต ต้องคง local refresh หรือออกแบบ versioned data handoff ให้ชัด
- ย้าย timers ต้องถอดเจ้าของเดิมใน release เดียวกันและมี rollback ที่คืนเจ้าของเดียว ไม่ใช่สอง worker ทำซ้ำ

**เกณฑ์พิสูจน์:** job inventory ไม่มีตัวตกหล่น, active owner = 1, last_success/next_run ดูได้, age ของ rollup อยู่ใน SLA, DB lock/pool wait ไม่เพิ่ม และ retention cutoff/child cleanup ให้ผลเดิมบน fixture

### VMOD-06 — Image pipeline ควรมี dedup และ concurrency budget ก่อนเพิ่ม process

**Fact**

- API มี thumbnail/bbox generation โดย sharp และ Edge fetch/cache อยู่ร่วมกัน: `src/api-server.js:710-817`
- Edge thumbnail cache มี completed buffers, TTL 60 วินาทีและ max 500 entries: `:724-738`
- `jpegResizer()` และ `_burnLprBbox()` เป็น helper ภายในไฟล์เดียวกับ HTTP/security wiring

**เสนอแยก**

`src/services/image-transform-service.js`: authorized source descriptor → transform → cache/artifact โดย route เป็นผู้ยืนยันสิทธิ์ก่อนเข้าถึง cache; ใส่ in-flight dedup ต่อ source+variant และจำกัด transforms/fetches ที่ทำพร้อมกัน

**ข้อควรระวัง**

- Sharp ทำงาน native/asynchronous หลายส่วน ไม่ควรเหมารวมว่าทุก resize บล็อก JavaScript event loop; ให้ดู CPU/native memory/queue ก่อนตัดสินใจ process isolation
- Entry cap ไม่ใช่ byte cap ถ้าขนาดภาพแปรผัน ควรวัดและจำกัด bytes เพิ่มเมื่อจำเป็น
- Key ต้องรวม camera/source identity, width, overlay options และ version ของ source/metadata ที่มีผลต่อภาพ
- รักษา memory-only policy สำหรับ Edge-owned images; ห้ามย้าย cache ลง central disk เงียบ ๆ
- Worker เพิ่ม IPC/serialization/copy cost ของ buffer จึงอาจทำ single-image latency สูงขึ้น

**เกณฑ์พิสูจน์:** concurrent requests ภาพเดียว fetch/transform ครั้งเดียว, auth ก่อน cache hit, output/overlay เท่าเดิม, RSS และ CPU ไม่เกิน budget ภายใต้ gallery burst

### VMOD-07 — Edge queue bookkeeping โตตามจำนวนไฟล์ในคิว

**Fact**

- `queueBytes()` ใช้ `readdirSync` และ `statSync` ทุกไฟล์: `src/edge/bridge.js:136-141`
- `enqueue()` เรียก `queueBytes()` ทุกครั้ง: `:144-146` และเขียนไฟล์ synchronous ที่ `:161`
- เมื่อคิวเต็มอ่านรายการและ sort หา oldest เพิ่มอีก: `:149`
- Queue replay อยู่ใน `bridgeQueue.js` แยกอยู่แล้ว และมี regression tests เรื่อง ack/recovery

**เหตุผลเชิง algorithm**

เมื่อมี N ไฟล์ การนับขนาดหนึ่งครั้งมีงาน metadata ตาม N; ช่วง offline ที่ enqueue ต่อเนื่องและ N โต การสแกนซ้ำอาจสะสมงานใกล้ quadratic ก่อนชน cap ทั้งนี้จำนวนไฟล์/ขนาด payload/อัตราเข้าจริงยังไม่ได้วัด

**เสนอแยก**

`src/edge/queue-store.js`: accounting + enqueue/evict/replay bookkeeping ใช้ counter ที่ reconcile ตอน startup/เป็นระยะ และปรับตาม durable write/delete/rename ที่สำเร็จจริง ลด full inventory scan ต่อข้อความ; คง storage format เดิมก่อนพิจารณา segmented log

**เงื่อนไขสำคัญ:** replay directory ต้องนับ/หักในนิยามเดียวกัน, crash recovery/requeue ไม่ทำ byte counter ผิด, ไม่ ack/drop ก่อน durable boundary, ไม่เปลี่ยน loss/eviction semantics โดยซ่อนอยู่ใน refactor

**เกณฑ์พิสูจน์:** synthetic queue ขนาด 100/1,000/10,000 ไฟล์และขนาด payload ต่างกัน; วัด enqueue p95, metadata operation count, heartbeat delay, restart recovery และผลเทียบจำนวนไฟล์จริง — ทำบน fixture เท่านั้น

### VMOD-08 — ส่วนที่แยกแล้วดูแลง่ายขึ้น แต่ยังไม่ใช่ performance win โดยตรง

| ขอบเขต | Module ที่อาจใช้ | ประโยชน์หลัก | จะเร็วขึ้นเมื่อใด |
|---|---|---|---|
| Static/CSP/auth policy | `server/static-policy`, `server/auth-gate` | ลดความเสี่ยงจากลำดับ middleware และ policy กระจาย | เมื่อแก้ blocking reads/cache ที่วัดแล้ว ไม่ใช่ย้ายชื่อไฟล์ |
| WebSocket listener/dispatch | `realtime/event-bridge`, `realtime/dispatcher` | รวม scope/subscription/lifecycle | เมื่อ batching/backpressure ลดงานจริง; lite payload มีแล้ว |
| Camera config/probe | `services/camera-config`, `services/camera-probe` | จำกัด coupling ระหว่าง JSON/DB/vendor APIs | เมื่อมี probe dedup/cache/concurrency cap ที่ตรงคอขวด |
| Blacklist sources | แยก adapter ตาม vendor + shared sync coordinator | ทดสอบ vendor failures และ mapping ง่ายขึ้น | เมื่อ sync scheduling/lookup work ลดลงจริง |
| Frontend page lifecycle | page init/activate/deactivate และ common utilities | ป้องกัน timer/listener ค้างและ global collisions | เมื่อหยุดงานหน้าที่ไม่ active หรือ lazy-load โดยวัดแล้ว |

การแยก WS ควร inventory ทุก `.send()` และตรวจ auth scope ใหม่ เพราะมี direct camera_status send อยู่นอก broadcast หลัก (`src/api-server.js:3053-3056`); อย่าถือว่าเป็นการย้ายที่ไม่มี security impact

## 7. รูปแบบ Modular ที่เสนอ

ชื่อด้านล่างเป็น **โครงสร้างเป้าหมายสำหรับหารือ** ไม่ใช่สิ่งที่สร้างใน commit นี้:

```text
src/
  api-server.js                   # bootstrap และ lifecycle ที่อ่านเห็นชัด
  server/
    static-policy.js
    auth-gate.js
  realtime/
    event-bridge.js
    dispatcher.js
  services/
    query-context.js              # effective scope + canonical identity
    query-cache.js                # bounded result cache + single-flight
    stats-query-service.js
    health-collector.js
    image-transform-service.js
  jobs/
    storage-inventory.js
    rollups.js
    retention.js
  maintenance-worker.js            # เพิ่มเมื่อ job contract พร้อม
  report-worker.js                 # ขยาย render-only contract จากของเดิม
  routes/                         # auth/context validation → service → response
  edge/
    bridge.js
    bridgeQueue.js                # reuse replay behavior เดิม
    queue-store.js
```

กติกา boundaries:

1. Route รับผิดชอบ HTTP และ effective authorization; service รับ explicit context ไม่อ่าน `req`/`res` ทั้งก้อนโดยไม่จำเป็น
2. Pure helper import ต้องไม่เปิด timer/listener/process โดยอัตโนมัติ; lifecycle ใช้ explicit `start/stop`
3. SQL ที่ต้องใช้ temp table ต้องอยู่ client/transaction เดียวกันจนจบ
4. ทุก worker มี resource budget, job ownership, timeout และ status ที่สังเกตได้
5. ห้ามย้าย query เดิมไป internal endpoint ที่ทำ query ซ้ำอีกชุดโดยไม่จำเป็น
6. ไม่เพิ่ม HTTP hop ระหว่างทุก module; in-process call เป็นค่าเริ่มต้นเมื่อไม่มีเหตุผลให้ isolate
7. อย่าให้ `api-server.js` import กลับจาก worker entrypoint; ทั้งสองใช้ service module ร่วมกัน

## 8. แผนลงมือแบบตรวจสอบผลได้

### Phase A — Baseline และ correctness ก่อน optimize

- Reproduce cache-scope identity ด้วย synthetic users และ integration tests
- เก็บ baseline อย่างน้อย 4 workload: normal browsing, health cache miss burst, manual report + browsing, storage scan + browsing
- แยก cold/warm และระบุ dataset size, camera/site filters, concurrency และ hardware
- เก็บ p50/p95/p99 HTTP, event-loop delay, WS delivery lag, Node/Chromium RSS, pool waiting/active และ DB query duration/count
- เป้าหมายของ phase คือมีข้อมูลตัดสิน ไม่ตั้งตัวเลข speedup ล่วงหน้า

### Phase B — Low-cost wins ใน process เดิม

- VMOD-01: async subprocess + single-flight expensive health loaders
- VMOD-04 หลังปิด VMOD-00: shared query context + per-key request coalescing; appearance bounded multi-entry cache เมื่อ baseline ยืนยัน cache thrash
- แยก behavior-preserving extraction ออกจาก behavior optimization เป็นคนละ patch เพื่อระบุสาเหตุของผลวัดได้

### Phase C — ย้ายงานหนักที่พิสูจน์แล้ว

- VMOD-02: storage/orphan jobs ออกจาก API โดย reuse storage_stats
- VMOD-03: render-only worker contract; คง download semantics และแยก delivery
- VMOD-05: ย้าย timer ownership ทีละกลุ่ม พร้อม dedicated small pool และ staggered schedule

### Phase D — ปรับตาม workload

- VMOD-06 เมื่อ image CPU/memory/fetch ซ้ำเป็นคอขวด
- VMOD-07 เมื่อ offline queue inventory กินเวลา heartbeat/enqueue จริง
- VMOD-08 เมื่อทำ feature/bug ในโดเมนนั้น ไม่ทำ big-bang cleanup

### เกณฑ์รับงานร่วม

| มิติ | ต้องตรวจอะไร |
|---|---|
| Correctness | JSON fields/NULL/zero, counts, scope, date boundaries และ reports ตรงเดิม |
| Performance | เทียบ workload และ cold/warm แบบเดียวกัน ไม่ใช้ latency endpoint เดียวแทนภาพรวม |
| Resources | CPU/RSS/disk/DB connections รวมทั้งระบบ ไม่ใช่แค่ย้ายตัวเลขออกจาก API |
| Reliability | timeout, cancellation, retry, duplicate jobs, restart recovery |
| Security | auth ก่อน cache/artifact, no cross-scope reuse, internal-token scope |
| Operations | มี owner เดียว, last success/queue age, rollback และหยุดงานได้ |
| Rollback | คืน call path/owner เดิมโดยไม่มี timers หรือ delivery ซ้ำ |

## 9. สิ่งที่ไม่ควรทำเพื่อหวังความเร็ว

- ไม่แตกทุก route เป็น microservice หรือเพิ่ม network boundary ทุกฟังก์ชัน
- ไม่เพิ่ม PM2 instances ของ API ก่อนจัด ownership ของ timers, cache, rate/nonce state และ background jobs
- ไม่เพิ่ม pool max เพื่อแก้ slow query โดยไม่ดู DB contention
- ไม่แชร์ cache โดยตัดสิทธิ์รายกล้องออกจาก key
- ไม่ copy SQL/business rules ไปอีก service จนเกิดนิยามยอดหมวกหรือ category ต่างกัน
- ไม่ส่ง download ไป schedule `/run/:id` แล้วทำให้มี LINE delivery เพิ่ม
- ไม่ย้าย sharp ทุก call ไป worker thread โดยถือว่า native async work คือ JS blocking ทั้งหมด
- ไม่ทำ index/migration/partition change แฝงใน modular extraction
- ไม่อ้างความเร็วจากจำนวนบรรทัดที่ลดลง

## 10. หลักฐานอ้างอิงสำคัญ

เลขบรรทัดอิง working tree ณ วันที่ตรวจ ภายใต้ `/home/vigil-central/vigil-platform/`; อาจเลื่อนเมื่อมีการแก้ไขภายหลัง

| หลักฐาน | ตำแหน่ง |
|---|---|
| API composition และ timers | `src/api-server.js:2228-2235`, `:2350-2733`, `:3064-3216` |
| Health blocking command/cache | `src/routes/health.js:76-84`, `:488`, `:537-550` |
| Shared storage cache | `src/helpers/storageStats.js:16-25`, `:45-73` |
| Storage scan owner/trigger | `src/routes/storage.js:28-83`, `:237-251` |
| Orphan sync filesystem loop | `src/helpers/storageScan.js:294-336` |
| Manual report render | `src/routes/reports.js:111-137`, `:194`, `:304-375` |
| Browser pool/serialization/idle close | `src/report-renderer.js:213-332` |
| Schedule worker endpoint | `src/report-worker.js:530-585` |
| Scope representation | `src/auth.js:533-553` |
| LPR cache/warm/queries | `src/routes/lpr-query.js:75-101`, `:675-713`, `:974-1040` |
| Appearance cache/temp table | `src/routes/appearances.js:229-247`, `:269-301`, `:394-396` |
| Shared criteria and TTL | `src/helpers/helmetCriteria.js:74-100`, `:105-150` |
| Category rollup lifecycle | `src/category-rollup-refresher.js:28-36`, `:93` เป็นต้นไป |
| Image pipeline/cache | `src/api-server.js:710-817` |
| Queue metadata scans | `src/edge/bridge.js:136-164` |
| Date-directory LPR pruning | `src/lpr-retention.js:62-84` |
| Direct WS send outside dispatcher | `src/api-server.js:3053-3056` |
| Audit เดิมที่เทียบ | `CODEX/CODEX_api-refactor_suggestion.md`, `CODEX/CODEX_suggestion_refactor.md`, `CODEX/CODEX_Audit_5th_Audit_part_optimization.md`, `microservice_plan.md` |

### Source snapshot ของไฟล์แก้ค้าง

เก็บ SHA-256 เพื่อระบุฐานที่อ่าน ไม่ใช่ข้อมูลลับ และไม่ได้หมายความว่าไฟล์เหล่านี้ถูก commit ในรายงาน:

```text
src/api-server.js
5f0cc55e1f3d1542995cd2e08fa03a2171ab75b68792ffb5f2b263282f9cbce1

src/report-renderer.js
2807939778a581882881749b9af6394bf5b29ed65d8989c8cd38fbaf635ea9dc

service_start.md
3f4aa9ee1bea0fdad50cf1a078bac2a67ca65a4722d2cf2878967fc5c93a32c9
```

## 11. ข้อเสนอเพื่อการตัดสินใจ

หากเลือกเริ่มเพียงหนึ่งชุด ให้ทำ **cache-scope correctness + health blocking removal + baseline** ก่อน เพราะขอบเขตเล็กกว่าแยกบริการใหญ่และให้หลักฐานว่า responsiveness ดีขึ้นจริงหรือไม่ จากนั้นย้าย **storage/orphan scan** และ **manual rendering** ออกจาก API ทีละส่วน

สำหรับสถิติที่ DB เป็นคอขวด ให้เน้น **ลด query ซ้ำและจำกัด workload** ก่อนแยก process การแยก worker เป็นเครื่องมือควบคุมผลกระทบ ไม่ใช่สิ่งทดแทนการปรับ query/cache/rollup ให้เหมาะสม

สถานะข้อเสนอทั้งหมด: **ยังไม่ได้ implement** — commit ของรายงานนี้อนุมัติการบันทึก audit เท่านั้น ไม่ได้เปลี่ยนพฤติกรรมของระบบ

---

## 12. Follow-up (2026-09-06, after implementation)

> หัวข้อนี้ **แทนที่บรรทัดสถานะท้าย §11** ("ยังไม่ได้ implement") ตั้งแต่ 2026-09-06 เป็นต้นไป —
> ข้อเสนอบางส่วนถูก implement, deploy ขึ้น central + edge ทั้ง 5 ไซต์ และ merge เข้า `origin/main` แล้ว

| ID | สถานะ | หลักฐาน |
|---|---|---|
| VMOD-00 | **ทำแล้ว** | `2808e63` + `aa75d5a` — `auth.scopeCacheKey()` เป็นทางเดียวที่สร้าง cache key ของ 4 cache (lpr/stats, appearances/stats, events/facets, executive-summary) + warm loop; **ไม่ใช่แค่ทฤษฎี** — พบ cache bleed ข้ามกล้องจริงที่ site 18 (บัญชี 84 กล้อง กับ 4 กล้อง) และ site 20 (4 บัญชี 4 ชุดกล้อง). GOTCHAS #190, 9 tests |
| VMOD-01 | **ทำแล้ว** | `7a2c6a7` + `585cc3c` — `health.js` เลิก `execFileSync('pm2')` เปลี่ยนเป็น async `execFile` (timeout เดิม) และ `_cached()` เก็บ pending promise = single-flight ต่อ key, load ที่ reject ถูก evict ให้ retry ได้ |
| VMOD-02 | **ทำแล้ว** | `bddbcd9` (6a) — `countEventOrphans` เปลี่ยน walk เป็น async (event-loop lag 289 ms → 19 ms) + anti-join bound ด้วยวันที่จาก path ปัดขอบเดือน (สแกน partition 21 → 2) + `ANALYZE _orph`; ผลเท่าเดิม 123,336 orphans / 611,086,336 bytes ที่ 65.7 s เทียบ 69.4 s |
| VMOD-03 | **ทำแล้ว** | `bddbcd9` (6b) — 8 manual download routes เรียก report-worker `POST /render` (loopback + `X-Internal-Token` + fn allowlist 6 ตัว + body 2 MB) ผ่าน `src/helpers/renderViaWorker.js` (timeout 120 s, fallback in-process); kill switch `REPORT_RENDER_VIA_WORKER=0`. Chromium รันใต้ report-worker เท่านั้นแล้ว |
| VMOD-04 | **ยังไม่ทำ** | ไม่พบหลักฐาน concurrent-miss thrash บน stats path จริง (single-flight ที่ทำไปอยู่ฝั่ง health `_cached()` เท่านั้น) — รอ baseline จาก `[slow-req]` ก่อนตัดสินใจว่าคุ้มไหม |
| VMOD-05 | **ทำบางส่วน** | `7a2c6a7` — stagger first-run ของ rollup/warm/retention (kpi 45 s, category 90 s, traffic 135 s, LPR warm 180 s, retention 300–480 s, override ด้วย `<NAME>_FIRST_RUN_MS`) และ `fc7cb31` — reconcile ย้ายไป 05:00 พร้อม persist marker ใน `system_settings.traffic_stats_reconciled_day`. **ยังไม่แยก worker/pool ต่างหาก** — ยังไม่จำเป็น เพราะการชนกันที่วัดได้หายไปแล้วด้วยการจัดเวลา |
| VMOD-06 | **ยังไม่ทำ** | edge thumbnail cache TTL 60 s / 500 entries ที่มีอยู่ยังพอ; ไม่มีหลักฐาน gallery burst ที่ทำให้ transform ซ้ำเป็นคอขวด |
| VMOD-07 | **ยังไม่ทำ** | คิว bridge ว่างทุกไซต์ตอนตรวจ — เป็นปัญหาเฉพาะตอน offline ยาว ไม่ใช่ภาระของ steady state |
| VMOD-08 | **opportunistic** | ทำเฉพาะตอนแตะจุดนั้นตาม CLAUDE.md Working Agreement #2 — รอบนี้แตะ WS dispatch (`9363229`, GOTCHAS #189: `broadcast()` มี `.send()` 2 จุด) และ static/asset policy (`2ed4289`, `f8f4615`) |

**สองเรื่องที่ audit นี้มองไม่เห็นเพราะเป็น static review ล้วน**

audit ฉบับนี้อ่านโครงสร้างและ implementation จากโค้ด แล้วชี้ไปที่ blocking I/O, งานซ้ำ และ scheduling ซึ่งถูกทุกข้อ — แต่ **latency ที่ผู้ใช้เจอจริงกลับมาจากรูปทรงของ query ที่อ่านโค้ดแล้วไม่เห็นว่าแพง** สองกลุ่ม:

1. **`count(*)` เต็มตารางใน `/api/health/details`** — นับ 40.5M แถวสามครั้ง ทำให้ cold หลัง restart ใช้ **40.5 s** และยังวิ่งต่อใน DB หลัง route timeout 2 s ยอมแพ้ไปแล้ว (`0e32082` + `a8008a1` + `101c97e` → cold 42 s → 1.5 s)
2. **query ที่ไม่มีขอบเขตเวลา** — no-read anti-join, `status-current` (`MAX(event_time) GROUP BY camera_id` ทั้งตาราง 44–66 s), `image-quality-log` (`COUNT(*) OVER ()` ไม่มี time bound จนชน statement timeout 120 s) และ scene fallback ที่เดิน index `event_time` ทั้ง 38M แถว (`dfd44ea`, `fe9c4bb`, `ea4b64d`) — GOTCHAS #187

ทั้งสองกลุ่ม **เจอจาก runtime log เท่านั้น** ไม่ได้เจอจากการอ่านโค้ด: `0199b8b` บอกตรง ๆ ว่า audit 2026-09-05 ต้องไล่วัดทุก endpoint ใหม่เพราะ api-server ไม่เคยเก็บ log ระยะเวลา request เลย และบรรทัดแรกที่ middleware ใหม่พ่นออกมาหลัง deploy คือ `GET /api/health/details 42160 ms` เครื่องมือทั้งสองตัวถาวรแล้ว — `[slow-req]` ที่ ≥ `SLOW_REQ_LOG_MS` (default 2 s) และ Postgres `log_min_duration_statement = 2s` (ALTER SYSTEM, persist ใน `postgresql.auto.conf`) วิธีใช้อยู่ใน `af4b12b`

> บทเรียนสำหรับ audit รอบหน้า: static review ชี้ **โครงสร้าง** ที่ควรแยกได้ดี แต่ชี้ **ตัวที่ช้าที่สุด** ไม่ได้ ต้องมี runtime baseline คู่กันเสมอ (ตรงกับ §8 Phase A ที่ audit นี้เขียนไว้เองว่า baseline ต้องมาก่อน optimize)
