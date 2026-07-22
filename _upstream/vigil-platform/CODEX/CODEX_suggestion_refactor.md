# CODEX_suggestion_refactor.md — Route Module Refactor Suggestions

Date: 2026-06-16
Scope: `src/routes/cameras.js`, `src/routes/stats.js`, `src/routes/health.js`

## Summary

ไฟล์ `cameras.js`, `stats.js`, และ `health.js` ยังใหญ่เพราะแต่ละไฟล์ไม่ได้ทำแค่ route binding แต่รวมหลาย responsibility เช่น request parsing, validation, SQL, business logic, external service calls, response shaping, และ operational diagnostics

ข้อเสนอหลักคือไม่ควร “ซอยไฟล์เพื่อลดจำนวนบรรทัด” แต่ควรแยกตาม responsibility boundary เพื่อให้:

- อ่านและ review ง่ายขึ้น
- test logic สำคัญแยกจาก Express ได้
- ลด blast radius เวลาแก้ vendor behavior, stats query, หรือ health diagnostics
- ทำ security/performance review ง่ายขึ้น
- ลดโอกาส regression จาก route module ที่รวม concern หลายชั้น

หลักที่ควรรักษา:

- ไม่เปลี่ยน behavior พร้อม refactor ถ้าไม่จำเป็น
- ไม่เพิ่ม framework, ORM, repository abstraction หนัก ๆ หรือ class hierarchy ที่ไม่เข้ากับ codebase
- ใช้ helper/service function style ตาม pattern เดิม
- ย้ายทีละ slice และ commit แยก
- validate ด้วย `node --check`, unit tests, และ endpoint smoke ที่เกี่ยวข้อง

---

## 1. `src/routes/cameras.js`

### Current shape

`cameras.js` ใหญ่เพราะรวมหลาย domain ไว้ในไฟล์เดียว:

- list cameras และ merge `cameras-config.json` กับ DB runtime state
- add/edit camera
- license camera limit
- sanitize `camera_id`
- audit diff/redaction
- EMQX provisioning
- test connection
- live snapshot preview
- Hikvision digest auth snapshot
- Bosch/Dahua/ONVIF snapshot handling
- camera status log
- offline alert config

### Suggested split

#### `src/services/camera-config-service.js`

รับผิดชอบ:

- load/save camera config
- normalize camera object
- merge camera config กับ DB runtime state
- validate duplicate `camera_id`
- validate duplicate IP
- prepare role-based camera response

Expected benefit:

- route ไม่ต้องรู้รายละเอียด config JSON มากเกินไป
- เพิ่ม unit tests สำหรับ merge/validation ได้ง่าย
- ลด risk เวลาแก้ schema/response ของ camera list

#### `src/services/camera-probe-service.js`

รับผิดชอบ:

- TCP probe
- HTTP image probe
- test connection
- private IP warning logic
- timeout handling
- camera network error normalization

Expected benefit:

- network probe logic แยกจาก camera CRUD
- test connection endpoint อ่านง่ายขึ้น
- security review ง่ายขึ้น เพราะ external network calls อยู่จุดเดียว

#### `src/services/camera-snapshot-service.js`

รับผิดชอบ:

- live snapshot URL/stream selection
- Bosch `/snap.jpg`
- Hikvision ISAPI digest snapshot
- Dahua snapshot
- JPEG magic byte validation
- max byte cap
- resize path / thumbnail behavior

Expected benefit:

- vendor snapshot behavior แยกจาก route CRUD
- ลดโอกาสแก้ Hikvision/Dahua แล้วกระทบ camera save
- รองรับ future vendor ได้ง่ายขึ้น

#### `src/services/emqx-provision-service.js`

รับผิดชอบ:

- login EMQX dashboard API
- create/update built-in auth user
- generate MQTT username/password
- return provisioning result
- normalize EMQX errors

Expected benefit:

- EMQX trust boundary ชัดขึ้น
- เพิ่ม smoke/unit test ด้วย mocked fetch ได้ง่าย
- route save camera สั้นลงมาก

#### `src/helpers/camera-audit.js`

รับผิดชอบ:

- redact camera object for audit
- diff before/after
- format audit details

Expected benefit:

- ลด duplication ของ redaction/diff logic
- ลด risk credential leak ใน audit/details

### Target shape

หลัง refactor, `routes/cameras.js` ควรเหลือเป็น HTTP glue เป็นหลัก:

```js
app.get('/api/cameras', async (req, res) => {
  const result = await cameraConfigService.listCameras({
    userRole: req.user.role,
  });
  res.json(result);
});

app.post('/api/cameras', async (req, res) => {
  const result = await cameraConfigService.saveCamera({
    body: req.body,
    user: req.user,
  });
  res.json(result);
});
```

### Suggested target size

`cameras.js` อาจลดจากประมาณ 1,186 lines เหลือราว 450-650 lines ได้โดยไม่เปลี่ยน behavior

### Caution

ควรทำ `cameras.js` หลัง `health.js` และ `stats.js` เพราะ blast radius สูงกว่า:

- แตะ camera config JSON
- แตะ EMQX auth provisioning
- แตะ vendor snapshot/probe behavior
- แตะ license camera cap
- แตะ audit log และ credential redaction

---

## 2. `src/routes/stats.js`

### Current shape

`stats.js` ใหญ่เพราะเป็น query-heavy domain:

- categories
- breakdown
- heatmap
- per-camera counts
- density
- top rules
- dwell
- occupancy/live people
- chart data transformation
- date/camera/category filter parsing

### Suggested split

#### `src/services/stats/filter-builder.js`

รับผิดชอบ:

- parse `from`, `to`, `cameras`, `category_id`, `camera_id`
- validate date range
- build shared WHERE clause
- manage params array / placeholder index
- keep source visual scope and drill-down scope consistent

Expected benefit:

- ลด bug ประเภท visual นับด้วย scope หนึ่ง แต่ drill-down ไปอีก scope
- เป็น single source สำหรับ stats filters
- unit test ได้ง่ายและคุ้มที่สุด

#### `src/services/stats/category-stats.js`

รับผิดชอบ:

- category counts
- event category rule matching
- category summary
- category-specific SQL fragments

#### `src/services/stats/time-series-stats.js`

รับผิดชอบ:

- heatmap
- density
- hourly/daily buckets
- `date_bin()` style queries
- time bucket formatting

#### `src/services/stats/camera-stats.js`

รับผิดชอบ:

- per-camera counts
- camera group filter
- online/offline derived stats
- camera-level summaries

#### `src/services/stats/dwell-stats.js`

รับผิดชอบ:

- dwell pairing true/false
- dwell episodes
- dwell summary
- threshold-related query logic

#### `src/services/stats/rule-stats.js`

รับผิดชอบ:

- top rules
- rule firing summaries
- alert-related rollups

### Target shape

`routes/stats.js` ควรเหลือ route mapping + input handoff:

```js
app.get('/api/stats/heatmap', async (req, res) => {
  const filters = buildStatsFilters(req.query);
  const data = await timeSeriesStats.getHeatmap(pool, filters);
  res.json(data);
});
```

### Suggested target size

`stats.js` อาจลดเหลือประมาณ 250-400 lines โดยย้าย SQL/query families ไป services

### Caution

ห้าม duplicate filter logic ในแต่ละ service เพราะจะย้อนกลับไปเจอปัญหา scope drift

Rules:

- `filter-builder` ต้องเป็น single source
- ทุก visual drill-down ต้องส่ง filter scope เดียวกับ source endpoint
- SQL behavior ไม่ควรเปลี่ยนใน commit แรกของ refactor
- ถ้าจะแก้ performance ให้ทำ commit แยกหลัง extract แล้ว

---

## 3. `src/routes/health.js`

### Current shape

`health.js` รวมหลายเรื่อง:

- `/api/health/details`
- service control start/stop/restart
- PM2 status
- storage directory size
- media buffer freshness
- plaintext camera credential warning
- health report data
- health report preview/pdf/png
- send Health Report to LINE
- alert report data

### Suggested split

#### `src/services/health/health-details-service.js`

รับผิดชอบ:

- build `/api/health/details`
- DB status
- camera freshness
- media buffer status
- disk/storage status
- PM2 process list
- security warnings
- degraded section result

ควรเพิ่มใน service นี้:

- cache TTL 5-15 วินาทีสำหรับ expensive sections
- per-section timeout
- `diagnostics_ms`
- warning log เมื่อ section ช้า
- partial failure handling แทน fail ทั้ง response

Expected benefit:

- ปิด debt เรื่อง health endpoint หนักต่อ request
- ทำ performance guard ได้ตรงจุด
- test cache/timeout ได้โดยไม่ต้อง boot route ทั้งหมด

#### `src/services/health/service-control-service.js`

รับผิดชอบ:

- allowlist service names
- allowlist actions
- reject dangerous actions เช่น stop `api-server`
- call `pm2`
- audit log action
- normalize PM2 command errors

Expected benefit:

- service control เป็น security-sensitive path ที่ review ง่ายขึ้น
- ลดการปะปนกับ report/health data

#### `src/services/health/health-report-service.js`

รับผิดชอบ:

- report-data/cameras
- report-data/alerts
- preview/pdf/png
- send-now LINE
- range parsing
- sections parsing
- language parsing
- report history logging

Expected benefit:

- แก้ Health Report โดยไม่แตะ service control
- report renderer integration ชัดขึ้น
- เพิ่ม smoke test ของ internal token/report path ได้ง่าย

### Target shape

`routes/health.js` ควรเหลือ HTTP glue:

```js
app.get('/api/health/details', auth.requireAdminOrAuditor, async (req, res) => {
  res.json(await healthDetailsService.getDetails());
});

app.post('/api/services/:name/:action', auth.requireAdmin, async (req, res) => {
  res.json(await serviceControlService.run({
    params: req.params,
    user: req.user,
  }));
});
```

### Suggested target size

`health.js` อาจลดเหลือประมาณ 180-300 lines ได้ และทำให้ `/api/health/details` optimization ชัดขึ้น

### Why health should go first

ควรเริ่มจาก `health.js` เพราะ:

- blast radius ต่ำกว่า `cameras.js`
- ช่วยแก้ debt จาก audit รอบ 4 โดยตรง
- แยก service control ออกจาก report/render path ได้ทันที
- test response shape และ degraded behavior ได้ง่าย

---

## Recommended Execution Order

1. `health.js`
   - extract `health-details-service`
   - add diagnostics timing without behavior change
   - then add cache/timeout in separate commit

2. `stats.js`
   - extract `filter-builder`
   - add unit tests for filters
   - extract query family services one by one

3. `cameras.js`
   - extract EMQX provisioning first
   - extract camera audit helpers
   - extract probe/snapshot helpers
   - extract config service last after route behavior is stable

เหตุผล:

- `health.js` ได้ประโยชน์เร็วและ risk ต่ำ
- `stats.js` ได้ benefit จาก shared filter tests
- `cameras.js` สำคัญและเสี่ยงสุด จึงควรทำหลังมี pattern extraction ที่นิ่งแล้ว

---

## Validation Checklist Per Slice

สำหรับทุก slice:

```bash
node --check src/routes/health.js
node --check src/routes/stats.js
node --check src/routes/cameras.js
node --test test/*.test.js
```

เลือกเฉพาะไฟล์ที่แตะจริง

สำหรับ health:

- ยิง `/api/health/details` ก่อน/หลัง refactor แล้วเทียบ response shape
- ตรวจ service control allowlist ยังเหมือนเดิม
- ตรวจ Health Report preview/pdf/png path ถ้าแตะ report service

สำหรับ stats:

- เทียบ response ของ endpoint เดิมกับหลัง refactor
- ตรวจ drill-down query string ยัง preserve scope
- เพิ่ม unit test ให้ `filter-builder`

สำหรับ cameras:

- ตรวจ add/edit/list camera response shape
- ตรวจ viewer/auditor ยังถูก redact credentials
- ตรวจ admin ยังเห็นค่าที่ต้อง prefill ตาม behavior เดิม
- ตรวจ EMQX provision path ด้วย mocked fetch หรือ deployment smoke
- ตรวจ snapshot preview path เฉพาะ vendor ที่แตะ

---

## Commit Plan

แนะนำ commit เล็กและอ่านง่าย:

```text
refactor(health): extract health details service
refactor(health): isolate service control logic
refactor(health): extract health report service
refactor(stats): extract shared filter builder
test(stats): cover shared stats filter builder
refactor(stats): extract time-series stats queries
refactor(cameras): extract EMQX provisioning service
refactor(cameras): extract camera audit helpers
refactor(cameras): extract snapshot probe helpers
```

---

## What Not To Do

- ไม่ควรแตกไฟล์เล็กจำนวนมากใน commit เดียว
- ไม่ควรเปลี่ยน route behavior พร้อม refactor
- ไม่ควรเปลี่ยน SQL logic ระหว่างย้ายไฟล์ ถ้าไม่จำเป็น
- ไม่ควรสร้าง abstraction generic เช่น `BaseService`, ORM-style repository, หรือ class hierarchy หนัก ๆ
- ไม่ควรย้ายทุกอย่างไป class หาก codebase ปัจจุบันใช้ function/helper pattern
- ไม่ควรทำ big-bang refactor ทั้ง 3 ไฟล์พร้อมกัน

---

## Final Recommendation

ควรลดขนาดทั้ง 3 ไฟล์ แต่ลดด้วยการแยก responsibility ไม่ใช่ลดเพื่อให้ line count สวย

ลำดับที่เหมาะสมที่สุด:

1. `health.js` — เพราะช่วยปิด audit debt เรื่อง `/api/health/details`
2. `stats.js` — เพราะ shared filter builder จะลด regression ของ stats/drill-down
3. `cameras.js` — เพราะใหญ่และสำคัญที่สุด แต่ blast radius สูง ต้องทำทีละ slice

แนวทางนี้เข้ากับ codebase ปัจจุบันที่สุด: small patches, helper/service functions, raw SQL retained, Express route behavior unchanged, และ validation ชัดเจนหลังแต่ละขั้น
