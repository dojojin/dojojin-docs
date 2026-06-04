# Product Review: Vigil Platform

วันที่จัดทำ: 2026-06-03
ผู้จัดทำ: Codex
ขอบเขต: วิเคราะห์ระบบโดยรวมจากเอกสาร, โค้ด, runtime state และเทียบกับระบบ CCTV/VMS/physical security platform ในตลาด

## Executive Summary

Vigil Platform มีจุดแข็งชัดในฐานะ **on-prem CCTV analytics / security operations platform สำหรับตลาดไทย** โดยเฉพาะ LINE alert, Thai/English workflow, health/reporting, audit, PDPA/data ownership, white-label และ multi-vendor event ingestion

ข้อสรุปเชิง product positioning คือระบบนี้ควรวางตัวเป็น:

> Security Operations Add-on / Analytics Layer ที่ทำให้กล้องหรือ VMS เดิมฉลาดขึ้นและใช้งานจริงใน operation ไทยได้ดีขึ้น

ไม่ควรวางตัวเป็น:

> Full enterprise VMS replacement เพื่อชน Genetec, Milestone, Axis, Hanwha, HikCentral หรือ Dahua DSS แบบตรงๆ

เหตุผลคือ Vigil แข็งมากใน event-to-action workflow แต่ยังไม่ครบเท่า VMS enterprise ใน recording, timeline playback, evidence workflow, storage/failover, deep device management, access control และ ecosystem integration

## Verified Facts

ข้อมูลส่วนนี้ยืนยันจาก repo/runtime ณ วันที่ตรวจสอบ

| Area | Fact |
|---|---|
| Runtime topology | กล้อง Bosch/Hikvision/Dahua/ONVIF ส่งข้อมูลเข้า ingesters/media-recorder, PostgreSQL, Express/WebSocket, Vanilla JS dashboard และ Cloudflare Tunnel |
| Process state | PM2 services 5 ตัว online: `api-server`, `mqtt-subscriber`, `media-recorder`, `hikvision`, `dahua` |
| Docker state | `vigil-postgres` และ `vigil-emqx` running; EMQX bind localhost และ LAN IP ตาม security decision |
| Live data | DB มี `7 cameras`, `61,649 events`, `356 alert_logs`, `24 report_history`, `261 camera_status_log` |
| Schema maturity | มี migration applied 40 ไฟล์ และมี schema domains หลายชุด เช่น events, users/sessions/audit, alerts, reports, camera health, appearance/LPR |
| API surface | `src/api-server.js` มีประมาณ 132 Express routes |
| Architecture constraints | Frontend เป็น Vanilla JS, backend ใช้ raw SQL ผ่าน `pg`, media/snapshots auth-gated, Safari auth เป็น triple-layer |
| Product lifecycle | มี `DECISIONS.md` ถึง decision #199 และ `GOTCHAS.md` ถึง gotcha #78 แปลว่ามี incident-driven hardening จริง |
| Operations | เปลี่ยน process manager เป็น PM2 ผ่าน `scripts/services.sh`; `npm run start:all` ถูก disable แล้ว |
| Commercial posture | มี proprietary license, Ed25519 JWT license system, Thai EULA, white-label branding และ hardware sizing guide |

## Current Product Shape

ระบบปัจจุบันมีลักษณะเป็น platform มากกว่า dashboard ธรรมดา เพราะมี loop ครบ:

1. Camera event ingestion
2. Event normalization ลง shared `events` table
3. Snapshot/clip handling
4. WebSocket real-time UI
5. LINE alert with rule matching, cooldown, quiet hours, recipient filtering
6. Scheduled analytics/health reports
7. Report history
8. Camera health/offline alerts
9. Audit log and session/user management
10. License/EULA gate
11. Backup/migration/retention operations

## Strengths

### 1. Market Fit สำหรับไทยชัดมาก

Vigil ออกแบบเข้ากับวิธีทำงานของลูกค้าไทยมากกว่าระบบ VMS นอกหลายตัว:

- LINE เป็นช่องทาง alert หลัก ไม่ใช่ afterthought
- มี recipient onboarding ผ่าน webhook/QR/admin approval
- มี Thai/English UI และ report
- มี quiet hours, cooldown, quota visibility
- มี EULA/PDPA/legal disclaimer สำหรับบริบทไทย

ผลคือ value proposition ชัดสำหรับลูกค้าที่มี VMS หรือกล้องอยู่แล้ว แต่ทีมหน้างานยังพลาด event เพราะ alert/workflow ไม่ตอบโจทย์

### 2. On-prem และ PDPA/Data Ownership

ระบบเก็บ event, snapshot, media และ credential ภายใน site เป็นหลัก เหมาะกับลูกค้าที่ไม่ต้องการส่ง video หรือ metadata ขึ้น cloud vendor

จุดนี้ต่างจาก cloud-first platforms เช่น Verkada หรือ Avigilon Alta ที่ UX/cloud management ดีมาก แต่มี lock-in และ data governance model คนละแบบ

### 3. Multi-vendor Event Ingestion ที่มีของจริง

รองรับหลาย vendor แบบไม่ใช่แค่ logo:

- Bosch MQTT / ONVIF Profile M
- Hikvision ISAPI Alert Stream + Face Capture
- Dahua CGI VCA event stream
- ONVIF monitor-only
- RTSP clip capture through `media-recorder`

ใน docs/gotchas มี vendor quirks จริง เช่น Dahua timestamp/digest/smart plan, Hikvision channel selection, Bosch snapshot native resolution, EMQX replacement for Mosquitto

### 4. Alert Workflow ครบกว่าระบบทั่วไปในตลาดไทย

LINE subsystem เป็นระบบย่อยเต็มตัว:

- Per-rule camera/rule matching
- Cooldown
- Quiet hours
- Recipient subset
- Snapshot to imgbb fallback
- Alert logs
- Quota panel
- Pending recipients
- Block list
- Camera offline/recovery alert
- Scheduled report delivery

นี่เป็นจุดที่ VMS enterprise หลายตัวต้องพึ่ง plugin/integration เพิ่ม

### 5. Reporting และ Health Monitoring ดีเกินระดับ Dashboard ทั่วไป

ระบบมี:

- Analytics reports
- Scheduled LINE reports
- Health report
- Report history
- PNG/PDF paths
- Branding
- Camera uptime/offline sections
- Storage/system warnings

สำหรับทีม security/facility นี่เป็น operational value สูงกว่าการมีแค่ live view กับ event list

### 6. Operational Maturity

สิ่งที่ดี:

- PM2 process management
- Service Management UI
- Dockerized PostgreSQL/EMQX
- Fail-fast migrations
- Daily backup scripts
- Retention jobs
- Health page
- Camera status logs
- Audit logs
- Security decisions documented

นี่ทำให้ระบบเข้าใกล้ production product มากกว่า prototype

### 7. White-label และ Commercialization Foundation

มีองค์ประกอบที่ product สำหรับขายต่อควรมี:

- Brand logo/name/accent
- License tiers
- EULA
- Hardware sizing guide
- Backup/restore
- Thai/English
- Roadmap and decision logs

### 8. Engineering Memory ดีมาก

`DECISIONS.md`, `GOTCHAS.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `SKILL.md` ทำให้ project มี memory และลดการแก้ซ้ำผิดทาง

นี่เป็นข้อได้เปรียบด้าน maintainability แม้ codebase จะยังมีจุดใหญ่และซับซ้อน

## Weaknesses and Risks

### 1. ยังไม่ใช่ Full VMS

Vigil มี clip/snapshot และ live view แต่ยังไม่เทียบ enterprise VMS ในเรื่อง:

- Long-term continuous recording management
- Timeline playback UX
- Multi-camera synchronized playback
- Evidence export package
- Redaction workflow
- Storage failover
- Camera firmware/config management
- PTZ control depth
- Operator client maturity
- Access control/intrusion modules

ดังนั้นถ้าลูกค้าต้องการ replace VMS ทั้งหมด ต้องระวังการขายเกิน scope

### 2. Scale Proof ยังจำกัด

เอกสาร sizing รองรับ 100-3,000 cameras แต่ runtime ที่ตรวจได้คือ 7 cameras และ 61,649 events

ก่อนขาย G2/G3+ ควรทำ:

- synthetic camera/event simulator
- 100/500/1,000 camera load test
- EPS burst test
- WebSocket fanout test
- DB query latency benchmark
- snapshot/clip throughput benchmark
- restore drill from backup

### 3. Maintenance Burden สูงจาก Vendor Quirks

ระบบ ingest จากหลาย vendor มีมูลค่า แต่มีค่า maintenance:

- firmware behavior เปลี่ยนได้
- digest/auth quirks เปลี่ยนได้
- payload shape เปลี่ยนได้
- stream/snapshot timing race เกิดได้
- camera config และ runtime DB state แยกกัน ต้องระวัง drift

ถ้าจะ scale ทีม ต้องมี test fixtures และ replay payload library

### 4. Codebase Complexity

`api-server.js` มี route จำนวนมากและรับหลาย responsibility:

- auth
- cameras
- events
- stats
- reports
- line
- health
- map
- settings
- backup
- service management

ยังใช้งานได้ แต่เมื่อ feature เพิ่มขึ้นควรแยก route modules แบบ incremental ไม่ใช่ rewrite

### 5. Automated Test/CI ยังไม่ชัด

จาก `src/package.json` ยังไม่เห็น test script ชัดเจน มี syntax/runtime validation manual เป็นหลัก

สำหรับ product ขายลูกค้า ควรเพิ่ม:

- route contract tests
- migration tests on fresh + existing schema
- auth/security regression tests
- alert-engine tests
- LINE webhook signature tests
- ingester payload replay tests
- smoke test script หลัง deploy

### 6. Enterprise Integrations ยังไม่ครบ

ตลาด enterprise คาดหวัง:

- AD/LDAP/SSO
- SIEM/syslog/webhook outbound
- SMTP/email
- access control integration
- incident case management
- escalation/acknowledgement workflow
- API marketplace/integration docs
- multi-site/multi-tenant management

หลายอย่างอยู่ใน roadmap หรือยังไม่เริ่ม

### 7. Documentation Drift บางจุด

ตัวอย่าง: `service_start.md` ยังมีคำสั่งรุ่นเก่า `npm run start:all` แม้ decision ล่าสุด #198-#199 ระบุว่าใช้ PM2 และ `start:all` ถูกเปลี่ยนเป็นข้อความ error แล้ว

ควรมี docs lint/checklist สำหรับ operational docs สำคัญก่อนส่งลูกค้า

## Market Comparison

### Genetec Security Center

Genetec เป็น unified physical security platform ระดับ enterprise รวม video, access control, intrusion, analytics, cloud/hybrid options และ ecosystem ใหญ่

Genetec เด่นกว่า:

- Unified security suite
- Access/intrusion/security operations ecosystem
- Enterprise support and scale
- Federation/multi-site maturity
- Compliance-heavy deployments

Vigil เด่นกว่า:

- Thai/LINE workflow
- Custom on-prem control
- Lower complexity for targeted analytics/alert/report use case
- White-label/source ownership
- Faster custom feature delivery

### Milestone XProtect

Milestone เป็น open-platform VMS ระดับโลก มี ecosystem ใหญ่และ trusted customer base สูง

Milestone เด่นกว่า:

- VMS core maturity
- Device support breadth
- Client/playback/export ecosystem
- Marketplace/integration ecosystem
- Enterprise storage/recording workflows

Vigil เด่นกว่า:

- LINE-first alert/report workflow
- Thai operations layer
- Lightweight customization
- On-prem customer-specific analytics and reporting

### Axis Camera Station Pro

Axis เด่นมากถ้าลูกค้าใช้ Axis ecosystem:

- Recording/playback/search/export
- Incident report
- Redaction
- System health
- Access control integration
- Axis-optimized management

Vigil เด่นกว่า:

- Multi-vendor event normalization for Bosch/Hikvision/Dahua
- LINE recipient/admin workflow
- Custom report and health workflow
- Vendor-neutral operations layer

### HikCentral / Dahua DSS / Hanwha WAVE

ระบบ vendor VMS เหล่านี้เด่นเรื่อง device integration, layout, recording, playback, access/device ecosystem และ support จากเจ้าของกล้อง

Vigil เด่นกว่า:

- ไม่ lock-in vendor เดียว
- ปรับ workflow ให้เข้ากับลูกค้าไทยได้เร็ว
- ใช้ LINE/report/audit/health เป็นแกน product
- เหมาะเป็น overlay บนกล้องหลายยี่ห้อ

### Verkada / Avigilon Alta

Cloud/hybrid cloud platforms เด่นเรื่อง UX, remote management, mobile/cloud operations, auto update และ hardware/cloud integration

Vigil เด่นกว่า:

- On-prem data ownership
- ใช้กล้องเดิมได้มากกว่า
- ไม่ผูกกับ hardware/cloud vendor
- ปรับแต่ง source/product ได้
- เหมาะกับ site ที่กังวล PDPA หรือไม่อยากส่งข้อมูลขึ้น cloud

## Competitive Positioning

### Best Positioning

> On-prem Security Operations Platform for Thailand: multi-vendor camera analytics, LINE alerting, health/reporting, audit, and white-label deployment

### Avoid Positioning

> Full VMS replacement for enterprise recording/playback

### Best Sales Entry Points

- ลูกค้ามี VMS/NVR เดิม แต่ alert ไม่ดี
- ลูกค้าอยากได้ LINE notification จาก Bosch/Hikvision/Dahua
- ลูกค้าอยากได้ daily/weekly/monthly security report อัตโนมัติ
- ลูกค้ากังวล cloud/PDPA/data ownership
- ลูกค้ามีกล้องหลายยี่ห้อและอยาก normalize event
- SI/installer อยาก white-label solution

## Scorecard

| Category | Score | Rationale |
|---|---:|---|
| Thai operations fit | 9/10 | LINE, Thai UI/report, workflow หน้างานชัดเจน |
| Event analytics platform | 8/10 | Multi-vendor normalize + stats/report ดี |
| VMS core recording/playback | 5/10 | มี clip/snapshot แต่ยังไม่ใช่ full VMS |
| Security/compliance posture | 7/10 | Auth/audit/media-gating/credential encryption ดี แต่ควรมี security automation/test เพิ่ม |
| Enterprise scale proof | 5/10 | มี sizing plan แต่ต้อง load test จริง |
| Maintainability | 6/10 | Docs ดีมาก แต่ code monolith บางส่วนใหญ่ |
| Commercialization | 7/10 | License/EULA/white-label/sizing มีแล้ว แต่ installer/update/support path ต้องแข็งขึ้น |
| Market differentiation | 8/10 | LINE-first + on-prem + Thai + source ownership แตกต่างชัด |

## Recommended Roadmap Priorities

### Priority 1: Strengthen Current Winning Position

1. Event Management: ack/assign/comment
2. SOP per alert rule
3. Alert escalation if unacknowledged
4. Webhook outbound and SMTP
5. Report/evidence export package
6. Operator mobile workflow alignment with Vigil Mobile

### Priority 2: Production Hardening

1. Automated smoke test script
2. Migration test on fresh and existing DB
3. API contract tests for critical routes
4. Ingester payload replay tests
5. Security regression tests
6. Off-host backup copy and restore drill
7. Documentation drift cleanup

### Priority 3: Scale Proof

1. Camera/event simulator
2. 100/500/1,000 camera benchmark
3. WebSocket fanout benchmark
4. PostgreSQL index/query audit on large event table
5. Clip capture capacity test at 25/50/100 percent cameras
6. PM2/service failure recovery drill

### Priority 4: Enterprise Features

1. SSO/AD/LDAP
2. Multi-site management
3. Tenant isolation if SaaS path opens
4. SIEM/syslog integration
5. Access control integration
6. Formal API docs and partner integration guide

## Business Implication

Vigil Platform มีโอกาสชนะสูงใน niche ที่ชัด:

- Industrial sites
- Office buildings
- Retail
- Schools
- Thai security operations teams
- Existing CCTV deployments that need smarter alerts/reports

แต่ควร avoid การขายแบบ replace ทุกอย่างใน site ที่มี enterprise VMS หนักๆ อยู่แล้ว เพราะจะถูก benchmark กับ feature set ที่ไม่ใช่จุดแข็งของ Vigil

กลยุทธ์ที่เหมาะที่สุดคือ land-and-expand:

1. เริ่มจาก LINE alerts + health/report overlay
2. เชื่อมกล้อง/VMS เดิมโดยไม่ disrupt recording workflow
3. ทำให้ทีมใช้งานทุกวันผ่าน LINE/report/dashboard
4. ค่อยขยายไป event management, SOP, mobile, multi-site

## Final Assessment

Vigil Platform เป็นระบบที่ “ดีและมีตลาด” โดยเฉพาะถ้าขายด้วย positioning ที่ถูกต้อง

จุดที่แข็งที่สุดไม่ใช่การเป็น VMS แต่คือการแปลง video analytics event ให้กลายเป็น actionable security operations workflow สำหรับลูกค้าไทย

ถ้าต้องสรุปในประโยคเดียว:

> Vigil ควรเป็นชั้น intelligence/workflow/reporting ที่นั่งบนกล้องและ VMS เดิม ไม่ใช่พยายามเป็น VMS enterprise ทั้งก้อนในระยะสั้น

## Sources Reviewed

### Internal Sources

- `AGENTS.md`
- `CODEX_SESSION_START.md`
- `CLAUDE.md`
- `ARCHITECTURE.md`
- `DECISIONS.md`
- `GOTCHAS.md`
- `ROADMAP.md`
- `SKILL.md`
- `service_start.md`
- `README.md`
- `CHANGELOG.md`
- `HARDWARE_SIZING_GUIDE.md`
- `docs/LOGIC_auth-security.md`
- `docs/LOGIC_camera-ingesters.md`
- `docs/LOGIC_line-notifications.md`
- `src/package.json`
- `src/api-server.js`
- `db/init.sql`
- `db/db_migration_*.sql`
- Runtime checks: PM2 status, Docker status, PostgreSQL counts

### External Market References

- Milestone XProtect product overview: https://www.milestonesys.com/products/software/overview/
- Genetec Security Center: https://www.genetec.com/products/unified-security/security-center
- Axis Camera Station Pro: https://www.axis.com/en-us/products/axis-camera-station-pro
- Avigilon Alta: https://www.avigilon.com/alta
- Verkada Command: https://www.verkada.com/en-US/command/
- Hanwha WAVE VMS: https://hanwhavisionamerica.com/wisenet-wave-vms/wisenet-wave-vms-features/
- Dahua DSS Professional: https://www.dahuasecurity.com/products/software/software-products/dss-professional
