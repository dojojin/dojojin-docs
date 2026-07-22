# CODEX Statistic Suggestion

วันที่จัดทำ: 2026-06-18  
Scope: ตรวจสอบ Dashboard, Graph, Statistic Chart, รายงาน และ backend stats endpoints ของ Vigil Platform เพื่อประเมินว่าควรแก้ไข/เพิ่มเติมอะไรให้เหมาะกับผู้ใช้งานและครอบคลุมทุกเหตุการณ์มากขึ้น

> หมายเหตุชื่อไฟล์: ใช้ `Sugesstion` ตามคำสั่งเพื่อให้ path ตรงกับที่ร้องขอ

## Executive Summary

ภาพรวมระบบ Dashboard/Stats ตอนนี้ถือว่า **แข็งแรงกว่าระบบ CCTV dashboard ทั่วไปมาก**:

- มีหน้า Security Morning Briefing สำหรับผู้จัดการดูภาพรวมเร็ว
- มีหน้า Stats ที่แยก Event Overview, Category KPI, Timeline, Breakdown, Activity Heatmap, Quiet Cameras, Top Rules
- มี Crowd/Density path สำหรับ Bosch `CountAggregation/Counter`
- มี Hikvision People Counting enter/exit graph
- มี Dwell Time จาก `FieldDetector/ObjectsInside` true -> false
- มี Appearance/Face forensic pages ที่มีสถิติแยก
- ใช้ Chart.js + token-based colors ในหลายจุด
- backend แยก route แล้วใน `src/routes/stats.js`
- มี query-time category mapping ผ่าน `event_categories` + `event_category_rules`
- มี drill-down ไป Events page ในหลาย chart ตาม decision #23

แต่ถ้าต้องการให้เหมาะกับผู้ใช้งานมากขึ้นและ "ครอบคลุมทุกเหตุการณ์" จริง ควรปรับแนวคิดจาก **หน้า Stats ที่เป็นกราฟรวม** ไปเป็น **Analytics Workspace ที่แยก semantic ของข้อมูลชัดเจน**:

1. **Security Incidents** - เหตุการณ์ที่ต้องตรวจสอบ
2. **Alerts Effectiveness** - แจ้งเตือนสำเร็จ/ล้มเหลว/ถูก cooldown/quiet hours
3. **People & Vehicle Flow** - counter, enter/exit, density, occupancy
4. **Zone Behavior** - dwell, open dwell, long stay, zone clearing
5. **Forensic Attributes** - face, body appearance, clothing, color, age group, direction
6. **License Plate / Vehicle Identity** - LPR, vehicle type/color/brand
7. **Camera Health & Data Quality** - quiet cameras, offline, image quality, recorder stale, snapshot/clip success
8. **Coverage & Configuration Quality** - unmapped event types, categories with zero match, cameras with no rules

จุดที่ควรทำก่อนที่สุด:

- เพิ่ม **Stats Coverage Matrix**: บอกว่า event_type ไหนเข้า chart ไหน, ถูก exclude เพราะอะไร, ยังไม่มี category mapping กี่รายการ
- เพิ่ม **Actionable Insights** แทนการโชว์กราฟอย่างเดียว: "กล้องนี้เงียบ", "rule นี้ spike", "category นี้หยุด", "counter หาย", "snapshot fail"
- แยกคำว่า `events`, `samples`, `people enter`, `people exit`, `occupancy`, `episodes` ให้ชัดในทุก chart
- แก้ technical debt ใน Stats page: client-side dwell filtering, hardcoded chart colors, hardcoded English strings, report-template hardcoded colors/emoji, category icon emoji legacy
- รวม appearance/face/plate summary เข้ากับ Stats ในระดับ summary card + shortcut ไม่ใช่ยัดทุก forensic chart ลงหน้าเดียว

## Files Reviewed

- `docs/LOGIC_stats-reports.md`
- `DESIGN.md`
- `DECISIONS.md`
- `GOTCHAS.md`
- `ROADMAP.md`
- `SKILL.md`
- `ARCHITECTURE.md`
- `src/routes/stats.js`
- `src/stats-summary-route.js`
- `src/routes/events.js`
- `src/routes/appearances.js`
- `src/routes/faces.js`
- `src/api-server.js`
- `dashboard/page-stats.js`
- `dashboard/page-executive-summary.js`
- `dashboard/page-appearance.js`
- `dashboard/page-face-gallery.js`
- `dashboard/page-face-matches.js`
- `dashboard/report-template.js`
- `dashboard/index.html`
- `dashboard/i18n.js`
- `db/init.sql`
- `db/db_migration_categories.sql`

## Fact: Current Stats/Data Model

### Backend stats endpoints

ใน `src/routes/stats.js` มี endpoint หลัก:

- `/api/stats/occupancy`
- `/api/stats/occupancy/sources`
- `/api/stats/occupancy/timeline`
- `/api/stats/occupancy/heatmap`
- `/api/stats/timeline`
- `/api/stats/today-counts`
- `/api/stats/kpi`
- `/api/stats/breakdown`
- `/api/stats/timeseries-rules`
- `/api/heatmap`
- `/api/stats/dwell`
- `/api/stats/people-counting`
- `/api/stats/categories`
- `/api/stats/timeline-v2`
- `/api/stats/per-camera-counts`
- `/api/stats/heatmap`
- `/api/stats/quiet-cameras`
- `/api/stats/top-rules`
- `/api/stats/timeline-by-category`
- `/api/stats/breakdown-v2`

แปลว่า backend มี foundation ดีมาก แต่ยังมี endpoint legacy อยู่หลายตัว เช่น `timeline`, `kpi`, `breakdown`, `timeseries-rules`, `timeline-v2` ที่ต้องระวังไม่ให้ report/dashboard ใช้ data path คนละชุดโดยไม่ตั้งใจ

### Frontend Stats page

ใน `dashboard/page-stats.js` หน้า Stats โหลดข้อมูลหลักด้วย parallel fetch:

- categories
- timeline by category
- breakdown v2
- people per-camera
- vehicle per-camera
- dwell
- Hikvision people-counting
- occupancy live
- occupancy timeline
- occupancy heatmap
- activity heatmap
- quiet cameras
- top rules

จุดแข็งคือมีหลายมุมมองมาก แต่ UX เริ่มมี risk ว่าผู้ใช้จะตีความผิด เพราะ data types ต่างกัน:

- event count = จำนวน event row
- CountAggregation/Counter = sample count หรือ current occupancy
- CountAggregation/PeopleCounting = enter/exit summary window
- dwell = paired episode duration
- appearance stats = detected attributes ไม่ใช่ identity
- face recognition = match event ไม่ใช่ face capture browsing

### Category model

`event_categories` + `event_category_rules` มี all-match semantics:

- 1 event เข้าได้หลาย category
- category คิดที่ query-time ไม่ store ลง event row
- built-in มี `People Counting` และ `Vehicle Counting`
- category kind มี `event`, `people_counter`, `vehicle_counter`

นี่เป็น design ที่ดี เพราะแก้ mapping แล้วย้อนมีผลกับ history ได้ทันที แต่ต้องมี UX ช่วยบอกผู้ใช้ว่า "หมวดหมู่นี้นับจาก mapping rule อะไร" ไม่งั้น user จะไม่เข้าใจว่าทำไมตัวเลขเป็น 0

## จุดดี / จุดเด่น

### 1. Architecture ถูกทาง

ระบบไม่ได้เอาทุกอย่างไปรวมใน query เดียว แต่แยกตาม semantic:

- incidents/events
- counters/occupancy
- dwell episodes
- people-counting enter/exit
- appearance stats
- face pages
- health report

นี่ช่วยลดการ double-count และตรงกับ decision #18 ที่ `CountAggregation` ไม่ควรถูกยัดใน pie/distribution รวม

### 2. Category mapping ยืดหยุ่น

`event_category_rules` ทำให้ user สร้างหมวดหมู่เองได้ เช่น:

- Alerts
- Traffic Events
- Intrusion
- People Counting
- Vehicle Counting
- Camera Tamper

และ rule สามารถ match ด้วย:

- camera_id
- rule_name
- event_type
- object_class
- match_state

จุดนี้ดีมากสำหรับ multi-vendor เพราะ Bosch/Hikvision/Dahua ส่ง event vocabulary ไม่เหมือนกัน

### 3. Drill-down foundation ดี

`/api/events` รองรับ filter หลายแบบ:

- camera/cameras
- category_id
- rule_name/rule_names
- from/to
- object class hierarchy
- dow/hour สำหรับ heatmap drill-down
- snapshot/clip tabs

ทำให้ chart -> events page สามารถตรวจสอบ row จริงได้ ไม่ใช่กราฟลอย ๆ

### 4. มี operational insight แล้ว

Stats ไม่ได้มีแต่กราฟ แต่มี:

- Quiet Cameras
- Top Rules
- Dwell Time
- Activity Heatmap
- Security Morning Briefing

นี่เหมาะกับ security operations เพราะผู้ใช้ไม่ได้อยากดูกราฟสวยอย่างเดียว แต่ต้องรู้ว่า "ต้องทำอะไรต่อ"

### 5. Crowd/Density เริ่มดีมาก

`CountAggregation/Counter` ถูกใช้ถูก semantic:

- live occupancy ใช้ in-memory smoothing 2s median
- historical density ใช้ DB events
- heatmap แยก avg/peak/samples

นี่ถูกต้องกว่าการนับ event row เป็นจำนวนคน

### 6. Hikvision People Counting ถูกแยกเป็น enter/exit

`CountAggregation/PeopleCounting` ไม่ปนกับ live occupancy:

- graph enter/exit
- bucket 15m/1h/1d
- per-camera summary ใน API

นี่ดี เพราะ PeopleCounting window summary มีความหมายต่างจาก Bosch live CountAggregation

### 7. Dwell Time มี data model ที่ระวังแล้ว

`/api/stats/dwell` pairing true -> false ต่อ camera+rule และตัดคู่เกิน 24 ชั่วโมง เป็นแนวทางที่เหมาะกับ zone-state event

เอกสาร GOTCHAS ยังบอกข้อจำกัดชัด:

- Hikvision dwell มี floor ประมาณ 7 วินาที
- Dwell เหมาะกับ single-occupancy zone
- โซนทางเดินควรใช้ People Counting แทน

### 8. Appearance/Face มีเส้นทาง forensic แยก

`/api/appearances/stats`, `/api/appearances/search`, `/api/appearances/timeline`, `/api/faces`, `/api/faces/summary`, `/api/face-matches` แสดงว่า platform ไม่ได้จำกัดที่ event count แต่เริ่มรองรับ forensic workflow แล้ว

## Gap / Debt ที่พบ

### 1. หน้า Stats ยังไม่ได้บอก data semantics ชัดพอ

ปัญหา:

- ผู้ใช้ทั่วไปอาจคิดว่า "People Count by Camera" = จำนวนคนจริง แต่จริง ๆ มาจาก category mapping
- "Density Over Time" = avg/max occupancy จาก samples ไม่ใช่จำนวนคนเข้าออก
- "People In-Out" = Hikvision PeopleCounting window ไม่ใช่ Bosch live counter
- "Dwell" = zone occupied duration ไม่ใช่ object-level person duration

คำแนะนำ:

- เพิ่ม micro-label ในแต่ละ chart:
  - Unit: `events`, `samples`, `people`, `episodes`, `seconds`
  - Source: `events`, `CountAggregation/Counter`, `CountAggregation/PeopleCounting`, `appearances`
  - Scope: current group/date/category
- เพิ่ม tooltip/help popover สั้น ๆ ในหัว chart

### 2. Coverage ยังไม่ครบแบบ visible

ระบบมี event หลายชนิด แต่หน้า Stats ยังไม่บอกว่าอะไรถูกนับ/ไม่ถูกนับ:

- `FaceCapture` ถูกแยกไปหน้า Face
- `CountAggregation/*` ถูก hide จาก incident feed
- automation events บางชนิดถูกซ่อนตาม `analytics_event_display`
- `event_state=false` ของ analytics/FieldDetector ถูกซ่อนจาก feed
- camera health/offline อยู่ Health ไม่ใช่ Stats
- alert delivery อยู่ Alert Logs ไม่ใช่ Stats
- report delivery อยู่ Report History ไม่ใช่ Stats
- license plate มี table แต่ยังไม่เห็น dashboard/stat summary หลักชัดเจน

คำแนะนำ:

- เพิ่ม card ชื่อ **Data Coverage / Event Coverage**
- แสดง:
  - total stored rows
  - rows shown as incidents
  - rows excluded as metric samples
  - rows excluded as automation diagnostics
  - face rows routed to Face page
  - events with no category mapping
  - top unmapped event_type
  - categories with zero matches

### 3. Dwell group filter ยัง client-side

Fact:

- `loadStats()` fetch `/api/stats/dwell?from=&to=` โดยไม่ส่ง multi-camera group
- แล้ว filter ฝั่ง client ด้วย `camIds.includes(r.camera_id)`
- comment ระบุว่า endpoint รับ `camera_id` เดี่ยว

ปัญหา:

- ถ้ามี event เยอะ backend ต้อง aggregate ทุก camera ก่อน แล้ว frontend ค่อยทิ้ง
- drill-down/CSV/summary อาจเสี่ยง scope drift ในอนาคต

คำแนะนำ:

- เพิ่ม `cameras=a,b,c` ให้ `/api/stats/dwell`
- filter server-side เหมือน endpoint stats อื่น

### 4. Period calculation ฝั่ง frontend อาจไม่ตรง `display_timezone`

Fact:

- `getRangeQuery()` ใน `page-stats.js` ใช้ browser local time สร้าง Today/This Week/This Month
- backend stats หลาย endpoint align ด้วย `display_timezone`

ปัญหา:

- ถ้า browser timezone ไม่ใช่ `display_timezone` ตัวเลขอาจคลาด
- report/server summary ใช้ timezone setting แต่ Stats page period label/ISO อาจมาจาก client timezone

คำแนะนำ:

- ให้ backend มี endpoint หรือ helper สำหรับ range preset:
  - `/api/stats/range?preset=today|this_week|this_month|last_24h`
  - คืน `{ from, to, label, tz }`
- หรือให้ frontend โหลด `display_timezone` แล้วสร้าง range ผ่าน library/helper เดียวกัน

### 5. Report template ยังไม่ตาม design system เต็ม

Fact:

- `dashboard/report-template.js` ยังมี hardcoded colors เช่น `#2d3748`, `#5b8def`, `#22c55e`, `#f59e0b`
- ยังมี emoji ใน template เช่น `📷`, `🚗`
- Chart config ใน report ใช้ hardcoded color

ปัญหา:

- ขัดกับ `DESIGN.md` เรื่อง token tri-layer และ no-emoji UI/report
- Report PNG/PDF อาจ look & feel drift จาก dashboard

คำแนะนำ:

- ย้ายสีใน `report-template.js` ไปใช้ token injection หรือ CSS variables
- แทน emoji ด้วย text/SVG-safe marker
- ทำ report chart palette helper เดียวกับ dashboard

### 6. Hardcoded English / i18n debt ใน `page-stats.js`

ตัวอย่างที่พบ:

- `All categories` ใน `populateHeatmapCategoryFilter()`
- `No rule firings in this window`
- `Click to inspect this camera's events`
- `Click to drill down`
- `EVENT TYPE`, `FREQUENCY`, `COUNT`
- `Total Events`, `Alerts`
- `People`, `Vehicles`, `persons`, `vehicles`
- `events`, `avg`, `peak`, `samples`
- comparison strings `NEW`, `STOPPED`, `vs prev`

คำแนะนำ:

- เพิ่ม i18n keys ใน `dashboard/i18n.js` ทั้ง `th` และ `en`
- ใช้ `I18N.t()` ทุก dynamic string
- tooltips/title attributes ก็ต้อง i18n

### 7. Hardcoded colors ใน chart/heatmap ยังมี

ตัวอย่าง:

- `rgba(91,141,239,...)`
- `rgba(245,158,11,...)`
- `#22c55e`
- `#f59e0b`
- `#fff`
- palette fallback `#a855f7`, `#06b6d4`, `#ec4899`, ...

คำแนะนำ:

- ทำ `chartPalette()` helper ที่ derive จาก token
- ให้ heatmap palette สร้างจาก token `--accent` / `--warn` ผ่าน rgba helper
- categorical fallback อาจยังใช้ static palette ได้ แต่ควรเป็น named local helper ไม่กระจายใน render functions

### 8. Category icon ยังเป็น emoji legacy

Fact:

- `event_categories.icon` default เป็น `🚨`
- built-in categories ใช้ `🚶`, `🚗`
- `renderCategoryKPI()` fallback เป็น `🚨`

ปัญหา:

- ขัดกับ no-emoji-as-UI สำหรับ new code
- แต่เป็น legacy ที่ grandfathered ตาม DESIGN.md

คำแนะนำ:

- อย่า sweep ทันที
- เพิ่ม field ใหม่ในอนาคต เช่น `icon_key` หรือ map name -> SVG symbol
- UI ควรรองรับทั้ง `icon` legacy และ `icon_key` ใหม่
- Category editor ควรเสนอ SVG icon choices แทน "พิมพ์ emoji เอง"

### 9. Breakdown table escape ยังไม่ครบ

Fact:

- `renderBreakdown()` ใส่ `${d.name}` โดยไม่ `escapeHtml`
- สีมาจาก `COLORS` แต่ label มาจาก DB/event

คำแนะนำ:

- ทุก DB-sourced string ใน innerHTML ต้องผ่าน `escapeHtml()`
- จุดนี้ควรแก้เป็น P0 ถ้ามีรอบ code implementation

### 10. มี endpoint legacy ที่ควรจัดสถานะ

Endpoint legacy เช่น:

- `/api/stats/timeline`
- `/api/stats/kpi`
- `/api/stats/breakdown`
- `/api/stats/timeseries-rules`
- `/api/stats/timeline-v2`

คำแนะนำ:

- ทำ endpoint inventory:
  - used by dashboard
  - used by reports
  - used by external API
  - deprecated internal
- ใส่ comment หรือ docs ว่าจะคงไว้เพื่อ compatibility หรือย้ายไป v2

## Recommended Product Improvements

### 1. เพิ่ม Stats Overview แบบ "What Needs Attention"

ควรมี section บนสุดของ Stats หรือ Morning Briefing:

- Cameras quiet but online
- Offline cameras
- Recorder stale / clip fail
- Snapshot failure ratio
- Alert delivery failed
- Rules spiking vs previous period
- Categories stopped vs previous period
- Counters silent
- Unmapped event types
- Categories with 0 matched events

รูปแบบควรเป็น action card ไม่ใช่กราฟ:

```text
ต้องตรวจสอบตอนนี้
- HIKVISION_CAM01: PeopleCounting ไม่ส่งข้อมูลมา 38 นาที
- Rule "Intrusion Zone A": เพิ่มขึ้น +240% เทียบช่วงก่อน
- 3 categories ไม่มี event match ใน 7 วัน
- 2 cameras online แต่ไม่มี event 24h
```

### 2. เพิ่ม Event Coverage Matrix

เป้าหมาย: ให้ admin รู้ว่าระบบนับครบหรือยัง

ตารางที่ควรแสดง:

| Dimension | ตัวอย่าง |
|---|---|
| event_type | `LineDetector/Crossed`, `FieldDetector/ObjectsInside`, `CountAggregation/Counter` |
| vendor | Bosch / Hikvision / Dahua |
| stored rows | จำนวนใน DB |
| shown in Events | yes/no |
| counted in Stats overview | yes/no |
| category mapping | category ที่ match |
| chart destination | Event Overview / Density / Dwell / Face / Appearance / Health |
| action | add mapping / open events / hide / review |

ควรมี backend endpoint:

```text
GET /api/stats/event-coverage?from=&to=&cameras=
```

### 3. เพิ่ม Rule Quality Dashboard

ใช้กับ security manager/admin:

- top false-positive rules
- rules with too many alerts
- rules with zero events
- rules with low likelihood events
- rules with repeated cooldown suppression
- rules with no snapshots
- rules without alert rule coverage

แหล่งข้อมูล:

- `events`
- `alert_rules`
- `alert_logs`
- `events.likelihood`
- `snapshot_filename`

### 4. เพิ่ม Alert Effectiveness Analytics

ควรแยกจาก Event Stats เพราะ "event เกิด" กับ "alert ส่งถึงคน" คนละเรื่อง

Chart ที่ควรมี:

- alerts generated
- LINE sent
- LINE failed
- skipped by cooldown
- skipped by quiet hours
- skipped by min_likelihood
- recipients count
- top failed reason
- alert latency

Endpoint ที่อาจใช้/ขยาย:

- `/api/alert-logs/stats`
- `alert_logs`
- `alert_rules`

### 5. เพิ่ม Snapshot/Clip Reliability Analytics

ผู้ใช้ CCTV ต้องรู้ว่ามี event แล้วมีหลักฐานภาพ/คลิปไหม

Metrics:

- event count
- has snapshot %
- has clip %
- clip pending/stale/done/failed
- avg clip delay
- snapshot source by vendor
- cameras with low evidence rate

Chart:

- evidence funnel:

```text
Events -> Snapshot Available -> Clip Available -> Alert Sent
```

### 6. เพิ่ม Forensic Summary บน Stats โดยไม่ซ้ำหน้า Appearance

ไม่ควรย้ายทั้ง Appearance page เข้ามาใน Stats แต่ควรมี summary/shortcut:

- top clothing colors
- top object classes
- face captures count
- face recognition matches count
- unknown faces count
- appearance coverage %
- "Open forensic search" button with same date/group filter

ข้อควรระวัง:

- gender/age group มี classifier bias
- ต้องมี PDPA wording
- ห้ามสื่อว่าเป็น identity เว้นแต่เป็น Face Recognition match จริง

### 7. เพิ่ม License Plate / Vehicle Identity Stats

ถ้าระบบใช้ LPR:

- total plates detected
- unique plates
- repeat vehicles
- top cameras by plate detections
- vehicle type/color/brand distribution
- unmatched/low confidence plates
- plate detection by hour

ควรแยกจาก generic Vehicle Counting เพราะ LPR เป็น identity-like data และมี PDPA implication

### 8. เพิ่ม Camera Automation / Image Quality Panel

จาก `analytics_event_display` และ event types:

- `ImageTooBright`
- `ImageTooBlurry`
- `ImageTooDark`
- `GlobalSceneChange`
- `Trigger/DigitalInput`
- `Trigger/Relay`

ข้อเสนอ:

- หน้า Stats ควรมี panel "Camera Diagnostics" หรือ link ไป Health
- แสดง image quality events ต่อกล้องในช่วงเวลา
- แสดง scene change/tamper spikes
- แสดง trigger I/O counts แยกจาก incidents

### 9. เพิ่ม Comparison Mode ที่เข้าใจง่าย

ปัจจุบันมี rolling previous period แล้ว แต่ user อาจต้องการ:

- today vs yesterday
- this week vs last week
- this month vs last month
- same weekday average
- business hours vs after-hours

คำแนะนำ:

- เพิ่ม selector "Compare with"
  - previous period
  - yesterday
  - same weekday last week
  - no comparison
- แต่ต้องอย่าเพิ่ม complexity บน mobile มากเกินไป

### 10. เพิ่ม Business Hours / Site Hours Filter

สำหรับอาคาร/โรงงาน/โรงเรียน:

- working hours
- after hours
- weekend
- holiday

Stats ที่ควรแยก:

- after-hours intrusions
- after-hours people/vehicle flow
- alerts outside schedule

ต้องมี `system_settings` หรือ site calendar ในอนาคต

## Recommended Technical Improvements

### P0: Safety and correctness

1. Escape DB-sourced strings in `renderBreakdown()`
2. Move hardcoded dynamic English strings in `page-stats.js` to i18n
3. Add `cameras=` support to `/api/stats/dwell`
4. Make Stats preset range align with `display_timezone`
5. Add unit labels/source labels to chart headers
6. Add no-data states that explain missing config, not just "no data"

### P1: Coverage and UX

1. Add `/api/stats/event-coverage`
2. Add "Coverage Matrix" panel
3. Add "What needs attention" insight panel
4. Add "Uncategorized events" chart/card
5. Add "Category mapping health" card
6. Add "Evidence availability" card for snapshot/clip
7. Add shortcuts from Stats to Appearance/Face/LPR pages with same filters

### P2: Performance and maintainability

1. Create shared stats filter builder:
   - range
   - cameras
   - category
   - timezone
   - metric exclusion
   - analytics exclusion
2. Mark legacy stats endpoints as compatibility/deprecated
3. Add query timing logs for slow stats endpoints
4. Add optional 30s cache for expensive coverage endpoints
5. Add partial/generated indexes if real EXPLAIN shows pain:
   - `events(event_time DESC) WHERE event_type LIKE '%Aggregation%'`
   - `events(camera_id, event_time DESC, event_type)`
   - generated column for `raw_json->'Source'->>'Rule'` if occupancy timeline grows

### P3: Reporting parity

1. Bring `dashboard/report-template.js` onto design tokens
2. Remove emoji from report template
3. Ensure report uses same data semantics as Stats page
4. Add Coverage/Insights section to full report layout
5. Add "evidence availability" to reports

## Suggested Dashboard Information Architecture

### Recommended Stats page sections

1. **Attention**
   - system anomalies
   - quiet cameras
   - failed alerts
   - evidence gaps
   - unmapped events

2. **Security Activity**
   - category KPI
   - timeline by category
   - top rules
   - activity heatmap
   - breakdown

3. **People / Vehicle Flow**
   - live occupancy
   - density over time
   - density heatmap
   - people in/out
   - per-camera counts

4. **Zone Behavior**
   - dwell summary
   - long dwell episodes
   - open dwell states
   - single-occupancy warning

5. **Forensics**
   - face capture count
   - face match count
   - appearance summary
   - LPR summary
   - shortcut to forensic pages

6. **Coverage**
   - categories with zero match
   - unmapped event types
   - hidden metric/automation rows
   - cameras without activity

### Why this structure is better

ผู้ใช้ security operations คิดเป็นคำถาม:

- ตอนนี้มีอะไรต้องทำไหม?
- วันนี้เกิดอะไรเยอะผิดปกติ?
- กล้อง/rule ไหนมีปัญหา?
- คน/รถไหลยังไง?
- มีหลักฐานภาพ/คลิปไหม?
- ถ้าต้องสืบย้อนหลังจะไปที่ไหน?
- ระบบนับครบไหม หรือ config หลุด?

โครงสร้างใหม่นี้ตอบคำถามตาม workflow มากกว่าจัดตามชนิด chart

## Chart-Specific Suggestions

### Category KPI strip

Current:

- แสดงทุก category
- คลิก focus Event Overview
- comparison friendly string

Improve:

- แยก badge type:
  - incident
  - counter
  - diagnostic
  - forensic
- เพิ่ม small label ว่า category นี้นับจาก rules กี่ข้อ
- เพิ่ม warning ถ้า category ไม่มี mapping rule
- เพิ่ม warning ถ้า category มี mapping แต่ 0 count ติดต่อกันนาน

### Event Overview timeline

Current:

- one line per category
- focus by KPI chip

Improve:

- toggle `stacked` vs `separate`
- show anomaly marker เมื่อ spike > threshold
- click point -> events with category+bucket
- add "Compare previous period" ghost line เฉพาะ focus category

### Breakdown table

Current:

- top rule/event rows
- bar by count

Improve:

- escape all labels
- add vendor/source badge
- group by rule_name but show event_type secondary
- show snapshot/clip availability per row
- add false-positive tuning shortcut to alert/category rule editor

### Activity Heatmap

Current:

- 7x24 count heatmap
- category filter
- drill-down with dow/hour

Improve:

- add mode: count / alert-only / unique cameras
- add "business hours overlay"
- add "quiet gaps" detection
- i18n tooltip strings
- server returns total/peak instead of frontend recomputing only

### Live Occupancy

Current:

- in-memory smoothed count
- 30s stale decay

Improve:

- show `stale` state clearly
- show camera/rule health: last sample age
- configurable thresholds per area, not hardcoded count >= 2/5
- support group filter if needed

### Density Over Time

Current:

- avg + peak from CountAggregation/Counter

Improve:

- show sample count quality line or badge
- warn when samples are sparse
- allow compare two zones
- mark stale gaps

### People In-Out

Current:

- Hikvision PeopleCounting enter/exit buckets

Improve:

- net flow line: enter - exit
- cumulative occupancy estimate optional
- per-camera table from API `per_camera`
- missing-window detector: expected 15m windows vs actual
- show warning when PeopleCounting disabled because camera selected Face mode

### Dwell Time

Current:

- table summary avg/max/total

Improve:

- top long dwell episodes table
- currently-open dwell state
- histogram of dwell durations
- threshold overlay from alert rule dwell threshold
- warning text: "เหมาะกับ zone ที่มีคนได้ทีละคน"
- server-side `cameras=` filter

### Appearance / Face / Forensics

Current:

- มี pages แยกดีอยู่แล้ว

Improve:

- Stats summary card:
  - face captures
  - face matches
  - body appearance rows
  - top colors
  - top clothing categories
- add "Open Appearance Search with current filters"
- add PDPA note and confidence caveat

### Report charts

Current:

- reports reuse stats endpoints but template still hardcoded color/emoji

Improve:

- tokenized report template
- same unit labels/source labels as dashboard
- include coverage/insights in full report
- do not add parallel template

## Event Coverage Matrix Proposal

Suggested row examples:

| Event family | Stored | Events feed | Stats | Recommended visualization |
|---|---:|---|---|---|
| Bosch IVA Line/Field/Object | yes | yes | Event Overview, Breakdown, Heatmap | Security Activity |
| FieldDetector false-half | yes | hidden | Dwell | Zone Behavior |
| CountAggregation/Counter | yes | hidden | Occupancy/Density | People in Area |
| CountAggregation/PeopleCounting | yes | hidden | People In-Out | Traffic Flow |
| Hikvision FaceCapture | yes | Face channel | Face/Appearance | Forensics |
| FaceRecognition | yes | yes/alert | Face Match stats | Watchlist/Forensics |
| Body Appearance | yes | via linked event | Appearance stats | Forensics |
| License Plate | yes | Events/LPR tab | suggested new LPR stats | Vehicle Identity |
| ImageTooBright/Blurry/Dark | yes | configurable hidden | Health/Diagnostics | Camera Quality |
| Trigger/DigitalInput/Relay | yes | configurable hidden | Health/Automation | I/O Diagnostics |
| Offline/Recorder stale | logs/settings | Health | suggested Stats attention | System Ops |
| Alert delivery | alert_logs | Alert Logs | suggested alert effectiveness | Notification Ops |

## Suggested New Endpoints

### `/api/stats/event-coverage`

Purpose: บอกว่าระบบครอบคลุม event types แค่ไหน

Response idea:

```json
{
  "from": "...",
  "to": "...",
  "totals": {
    "stored": 12345,
    "incident_rows": 2345,
    "metric_rows": 9000,
    "automation_rows": 200,
    "face_rows": 50,
    "uncategorized": 120
  },
  "event_types": [
    {
      "event_type": "LineDetector/Crossed",
      "count": 340,
      "shown_in_events": true,
      "metric": false,
      "automation": false,
      "categories": ["Alerts", "Traffic Events"],
      "recommended_surface": "Security Activity"
    }
  ]
}
```

### `/api/stats/evidence`

Purpose: ตรวจว่ามีภาพ/คลิปประกอบ event แค่ไหน

Metrics:

- events
- has_snapshot
- has_clip_done
- clip_pending
- clip_failed/stale
- by camera
- by vendor
- by event_type

### `/api/stats/insights`

Purpose: รวม insight ที่ actionable

Inputs:

- quiet cameras
- top rules
- category deltas
- alert failures
- snapshot/clip gaps
- counter gaps
- unmapped events

### `/api/stats/ranges`

Purpose: ให้ backend เป็น source of truth ของ period preset ตาม `display_timezone`

## UX Recommendations

### 1. Use "question-first" titles

แทน:

- Event Breakdown
- Activity Heatmap

ควรพิจารณา:

- อะไรเกิดบ่อยที่สุด?
- ช่วงไหนมีกิจกรรมหนาแน่น?
- กล้องไหนเงียบผิดปกติ?
- มีหลักฐานภาพ/คลิปครบไหม?

แต่ควรทำอย่าง restrained และไม่ยาวเกินใน card compact

### 2. Add chart source badges

ตัวอย่าง badge:

- `Unit: events`
- `Source: events`
- `Excludes: CountAggregation`
- `Unit: people`
- `Source: PeopleCounting 15m`
- `Unit: occupancy`
- `Source: CountAggregation/Counter`
- `Unit: episodes`
- `Source: FieldDetector true->false`

### 3. Use progressive disclosure

หน้า Stats ไม่ควรยาวแบบทุกอย่างกองลงมา:

- default: Attention + Security Activity + People Flow
- collapsible: Forensics + Coverage + Diagnostics
- remember last expanded sections in localStorage

### 4. Improve mobile behavior

ปัจจุบันหลายตาราง heatmap ใช้ `min-width:700px` และ horizontal scroll ซึ่งยอมรับได้ แต่ควรเพิ่ม:

- sticky first column for heatmap day labels
- compact legend
- chart section collapse
- top tabs/segmented controls แทน scroll ยาวมาก

### 5. Add "same filter" navigation

ทุก chart/card ควรเปิดหน้าที่เกี่ยวข้องพร้อม filter เดิม:

- Stats -> Events
- Stats -> Appearance
- Stats -> Face
- Stats -> Alert Logs
- Stats -> Health
- Stats -> Reports

## Performance Recommendations

### Current baseline

มี indexes สำคัญใน `init.sql`:

- `idx_events_time`
- `idx_events_camera_time`
- `idx_events_type`
- `idx_events_rule`
- `idx_events_class`
- snapshot partial indexes

และมี cache 30s ใน:

- `/api/stats/today-counts`
- `/api/stats/executive-summary`
- `/api/appearances/stats`

### When to optimize

ยังไม่ควรทำ pre-aggregation จนกว่าจะเห็น query เกิน 2-3s จริงตาม ROADMAP แต่ควรเตรียม:

- slow query log เฉพาะ stats endpoints
- endpoint timing in response headers for admin
- EXPLAIN plan capture script สำหรับ stats heavy queries

### Future pre-aggregation

ถ้า events โตมาก:

- `hourly_event_stats`
- `daily_event_stats`
- `hourly_category_stats`
- `daily_camera_event_stats`
- `counter_bucket_stats`

แต่ต้องระวัง all-match category mapping เพราะ mapping เปลี่ยนแล้วย้อนประวัติได้ ถ้าทำ pre-aggregation ต้องมี rebuild job เมื่อ category rule เปลี่ยน

## Data Governance / PDPA

Stats ที่เกี่ยวกับ appearance/face/license plate ต้องแยกจาก incident stats:

- age/gender/clothing = personal/sensitive inference
- license plate = identifiable vehicle data
- face recognition = identity-related

คำแนะนำ:

- แสดงเฉพาะ summary aggregate บน Stats
- detail drill-down ต้องไป forensic pages ที่มี role/audit log
- ใส่ caveat ว่า attribute matching ไม่ใช่ identity
- รายงาน export ที่มี personal attributes ควรระบุ scope/retention

## Implementation Roadmap

### Sprint A: Fix obvious debt

1. Escape `renderBreakdown()` labels
2. Replace hardcoded dynamic English strings in `page-stats.js`
3. Add i18n keys for Stats tooltips/no-data labels
4. Replace hardcoded PC chart colors with tokens
5. Add `cameras=` to `/api/stats/dwell`
6. Add source/unit badges to existing chart headers

### Sprint B: Coverage and insight

1. Add `/api/stats/event-coverage`
2. Add Coverage Matrix panel
3. Add Uncategorized Events card
4. Add Category Mapping Health card
5. Add Stats attention panel

### Sprint C: Evidence and alert analytics

1. Add `/api/stats/evidence`
2. Add Evidence Availability card
3. Expand Alert Logs stats into Alert Effectiveness section
4. Add failed alert reason chart
5. Add cooldown/quiet-hours skipped chart if logs contain enough data

### Sprint D: Forensics bridge

1. Add compact forensic summary to Stats
2. Add filter-preserving links to Appearance/Face/LPR pages
3. Add LPR stats if license plate data is active
4. Add PDPA/caveat labels

### Sprint E: Report parity

1. Tokenize `report-template.js`
2. Remove emoji from report template
3. Add insight/coverage section to full report
4. Ensure report and dashboard use same data semantics

## Validation Checklist for Future Implementation

### Static checks

```bash
node --check src/routes/stats.js
node --check src/stats-summary-route.js
node --check dashboard/page-stats.js
node --check dashboard/report-template.js
```

### Endpoint checks

```bash
curl -sS -i 'http://127.0.0.1:3000/api/stats/categories?from=...&to=...'
curl -sS -i 'http://127.0.0.1:3000/api/stats/heatmap?from=...&to=...'
curl -sS -i 'http://127.0.0.1:3000/api/stats/dwell?from=...&to=...&cameras=CAM01,CAM02'
```

### UI checks

- Desktop: Stats page loads all chart sections
- Mobile <=768px: no horizontal page scroll except intended table wrappers
- Chart click drill-down preserves filters
- Thai/English switch does not leave English hardcoded strings
- No new emoji UI in changed surfaces
- Colors use tokens or central chart palette helper

### Data correctness checks

- Metric events excluded from incident charts
- CountAggregation still appears in occupancy/density
- PeopleCounting enter/exit not mixed with event count
- Dwell true/false pairing still matches expected episodes
- FaceCapture remains routed to Face page, not incident feed
- Appearance stats are aggregate only unless user enters forensic page
- Alert logs stats count delivery attempts, not event rows

## Final Recommendation

ไม่ควรแก้ด้วยการเพิ่มกราฟสุ่ม ๆ อีกหลายใบ เพราะระบบมีกราฟเยอะอยู่แล้ว สิ่งที่ควรทำคือ:

1. ทำให้ทุก chart มี semantic ชัด
2. เพิ่ม coverage matrix เพื่อยืนยันว่าทุก event ถูกจัดเข้าที่ถูกต้อง
3. เพิ่ม actionable insights ที่บอกผู้ใช้ว่าต้องทำอะไร
4. เชื่อม Stats กับ forensic/health/alert-log pages แบบ filter-preserving
5. ลด debt ด้าน i18n, token, emoji, escapeHtml
6. เตรียม performance instrumentation ก่อนสร้าง pre-aggregation

ถ้าทำตามนี้ Dashboard จะเปลี่ยนจาก "มีกราฟหลายอัน" เป็น "ศูนย์วิเคราะห์สถานการณ์" ที่ตอบคำถามผู้ใช้งาน security operations ได้ครบกว่าเดิมมาก
