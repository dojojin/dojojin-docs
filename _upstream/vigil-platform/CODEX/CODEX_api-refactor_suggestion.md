# CODEX_api-refactor_suggestion.md — `api-server.js` Refactor Suggestions

Date: 2026-06-16
Scope: `src/api-server.js`

## Summary

`src/api-server.js` ยังเป็น composition root ขนาดใหญ่ประมาณ 1,893 lines แม้ route split ออกไปแล้ว

ไฟล์นี้ยังใหญ่เพราะรวมหลายกลุ่มงาน:

- Express app setup
- CSP/static middleware
- public/private static path policy
- CORS
- session/auth gate
- WebSocket setup
- internal token validation
- route registration
- shared dependency wiring
- DB migration/bootstrap
- retention jobs
- camera monitor/offline alert logic
- recorder stale monitor
- MQTT freshness monitor
- WebSocket `pg_notify` listener
- startup banner/version info
- graceful shutdown

ข้อเสนอหลักคือ `api-server.js` ยังลดได้อีก แต่ต้องลดแบบระวัง เพราะไฟล์นี้เป็น process lifecycle / composition root ของระบบ

เป้าหมายที่ดีไม่ใช่ทำให้เหลือไฟล์เล็กมาก แต่ให้เหลือเป็นไฟล์ที่อ่านแล้วเห็นว่า server ประกอบจากอะไรบ้าง ส่วน policy, bridge, jobs และ wiring รายละเอียดแยกไป module ชื่อชัดเจน

---

## Guiding Principles

ควรทำ:

- ย้าย infrastructure wiring ออกก่อน business behavior
- ทำทีละ slice และ commit แยก
- รักษา behavior เดิมทุกอย่างใน commit แรกของแต่ละ slice
- ใช้ function/helper style ให้เข้ากับ codebase เดิม
- เพิ่ม smoke/manual validation เฉพาะจุดที่แตะ
- ให้ `api-server.js` หรือ `start-server.js` ยังมองเห็น lifecycle หลักอยู่

ไม่ควรทำ:

- ไม่ควรซ่อน lifecycle ลึกเกินไปจน debug server boot ยาก
- ไม่ควรสร้าง abstraction หนา เช่น `BaseServer`, framework wrapper, class hierarchy
- ไม่ควรเปลี่ยน auth/static/WebSocket behavior พร้อมการย้ายไฟล์
- ไม่ควรย้าย background jobs หลายตัวพร้อมกันใน commit เดียว
- ไม่ควรทำ big-bang refactor ทั้งไฟล์

---

## 1. Extract Static and CSP Policy

### Suggested file

```text
src/server/static-policy.js
```

### Responsibilities

- CSP header builder
- `/others` CSP
- dashboard CSP
- public path allowlist
- public prefix allowlist
- static mount options
- dotfiles deny config
- cache-control rules
- dashboard JS cache-busting helper

### Target shape

```js
function installStaticPolicy(app, deps) {
  app.use('/others', othersCsp, express.static(...));
  app.use('/vendor', express.static(...));
  app.get('/', serveDashboardIndex);
  app.get('/index.html', serveDashboardIndex);
}

function isPublicStaticPath(reqPath) {
  return PUBLIC_PATHS.has(reqPath) ||
    PUBLIC_PREFIXES.some(p => reqPath.startsWith(p));
}
```

### Benefit

- security/static policy อยู่ไฟล์เดียว
- audit CSP/public path ง่ายขึ้น
- ลด noise ใน `api-server.js`
- ลดโอกาสแก้ route แล้วกระทบ static policy

### Caution

ส่วนนี้เกี่ยวกับ security boundary ของ dashboard/static assets ต้องย้ายแบบ copy-exact และเทียบ headers ก่อน/หลัง

---

## 2. Extract API Auth Gate and Internal Token Middleware

### Suggested file

```text
src/server/auth-gate.js
```

### Responsibilities

- `isValidInternalToken(req)`
- `/api` global auth gate
- public API allowlist
- must-change-password allowlist
- helper `requireAdminForWrites(...)`
- write-gate mounting for route groups if practical

### Target shape

```js
function installApiAuthGate(app, deps) {
  app.use('/api', apiAuthGate);
  app.use('/api/cameras', requireAdminForWrites('/'));
  app.use('/api/groups', requireAdminForWrites('/'));
}
```

### Benefit

- auth policy แยกจาก startup/bootstrap noise
- review สิทธิ์ง่ายขึ้น
- public/internal/admin/write allowlists อยู่ที่เดียว
- ลด risk ที่ `api-server.js` เป็นที่รวม policy ยาว ๆ

### Caution

นี่เป็น security-sensitive path ต้องมี checklist หรือ smoke test:

- public endpoints ยัง public เท่าเดิม
- protected endpoints ยัง protected
- internal token path ยังใช้ได้
- viewer/admin/auditor behavior ยังเหมือนเดิม
- `must_change_password` ยัง enforce เหมือนเดิม

---

## 3. Extract WebSocket Server and `pg_notify` Bridge

### Suggested file

```text
src/server/ws-server.js
```

### Responsibilities

- create `WebSocket.Server`
- `verifyClient`
- session token from cookie/query
- connection lifecycle
- broadcast helper
- PostgreSQL `LISTEN new_event`
- reload event row and broadcast
- future heartbeat/ping-pong support if needed

### Target shape

```js
function createWsServer({ server, pool, auth }) {
  const wss = new WebSocket.Server({ server, verifyClient });

  function broadcast(type, payload) {
    // send to authenticated clients
  }

  async function installPgNotifyBridge() {
    // LISTEN new_event and broadcast rows
  }

  return { wss, broadcast, installPgNotifyBridge };
}
```

### Benefit

- realtime path ชัดเจน
- WebSocket auth review ง่ายขึ้น
- `api-server.js` เหลือแค่ `const ws = createWsServer(...)`
- future WS channel เพิ่มได้ใน module เดียว

### Caution

WebSocket auth เป็น gotcha สำคัญ:

- WS without token ต้อง reject
- WS with valid token ต้อง connect
- `new_event` notify ต้อง broadcast event shape เดิม
- snapshot metadata timing ต้องไม่เปลี่ยน

---

## 4. Extract Route Registration

### Suggested file

```text
src/server/register-routes.js
```

### Responsibilities

- require route modules ทั้งหมด
- ส่ง deps ให้แต่ละ route
- register `stats-summary-route.js`
- รวม route dependency map

### Target shape

```js
function registerRoutes(app, pool, deps) {
  require('../routes/cameras')(app, pool, deps);
  require('../routes/stats')(app, pool, deps);
  require('../routes/health')(app, pool, deps);
  require('../stats-summary-route')(app, pool, deps);
}
```

### Benefit

- `api-server.js` ไม่ต้องมี list route ยาว
- route wiring อยู่จุดเดียว
- ตอนเพิ่ม route ใหม่แก้ไฟล์เดียว
- เป็น extraction ที่ risk ต่ำสุด

### Caution

ต้องรักษา registration order เดิม โดยเฉพาะ middleware/static/auth gate ที่ต้องมาก่อน route registration

---

## 5. Extract Background Jobs and Monitors

### Suggested files

เริ่มจากไฟล์เดียวก่อน หรือแยกย่อยถ้า logic ใหญ่:

```text
src/server/background-jobs.js
src/server/retention-jobs.js
src/server/camera-monitor.js
src/server/recorder-monitor.js
src/server/mqtt-health-monitor.js
```

### Responsibilities

- retention cleanup
- snapshot retention
- clip retention
- report PNG retention
- camera offline/recovery monitor
- MQTT freshness monitor
- media recorder stale monitor
- periodic timers
- startup delayed checks

### Benefit

- periodic side effects ไม่ปนกับ HTTP setup
- test logic ได้ง่ายขึ้น
- future shutdown/clear interval ทำง่ายขึ้น
- ลด `api-server.js` ได้เยอะที่สุด

### Caution

นี่เป็นส่วน behavior-sensitive ที่สุด:

- ห้ามเปลี่ยน timer interval โดยไม่ตั้งใจ
- ห้ามเปลี่ยน retention semantics
- ห้ามเปลี่ยน quiet hours / LINE alert behavior
- ห้ามเปลี่ยน stale recorder alert behavior
- ต้อง verify logs และ health indicators หลังย้าย

---

## 6. Introduce App Factory and Server Start Split

### Suggested files

```text
src/server/create-app.js
src/server/start-server.js
```

### Target shape

```js
function createApp(deps) {
  const app = express();
  installStaticPolicy(app, deps);
  installApiAuthGate(app, deps);
  registerRoutes(app, deps.pool, deps);
  return app;
}

async function startServer() {
  await migrate();
  const app = createApp(deps);
  const server = http.createServer(app);
  const ws = createWsServer({ server, pool, auth });
  await ws.installPgNotifyBridge();
  startBackgroundJobs(deps);
  server.listen(...);
}
```

### Benefit

- integration tests ง่ายขึ้น
- test route/static/CSP ได้โดยไม่เปิด PM2
- boot logic แยกจาก app wiring
- เป็น foundation สำหรับ smoke tests

### Caution

เป็น refactor ที่ใหญ่กว่าข้ออื่น ควรทำหลังแยก static/auth/routes/WS แล้ว

---

## Recommended Execution Order

ถ้าเน้นลดขนาดแบบไม่กระทบภาพรวม:

1. `register-routes.js`
   - risk ต่ำสุด
   - ลด noise ทันที

2. `static-policy.js`
   - ได้ประโยชน์ด้าน security review
   - CSP/static policy ชัดขึ้น

3. `auth-gate.js`
   - สำคัญแต่ security-sensitive
   - ควรมี manual smoke checklist อย่างน้อย

4. `ws-server.js`
   - แยก realtime path
   - ต้อง validate WS auth และ broadcast

5. background jobs / monitors
   - ลดได้เยอะสุด
   - behavior-sensitive สูงสุด

6. `create-app.js` / `start-server.js`
   - ทำตอนท้ายเพื่อยกระดับ testability

---

## Expected Size Reduction

ประมาณการจาก `api-server.js` ปัจจุบัน ~1,893 lines:

```text
route registration:        -80 ถึง -140
static/CSP policy:         -180 ถึง -280
auth gate:                 -120 ถึง -220
WebSocket/notify bridge:   -180 ถึง -300
retention/monitors:        -350 ถึง -550
createApp/start split:     ลดไม่มากเสมอ แต่โครงสร้างชัดขึ้น
```

เป้าหมายสมเหตุสมผล:

```text
api-server.js เหลือประมาณ 600-900 lines
```

ไม่ควรตั้งเป้าให้เหลือ 100-200 lines เพราะไฟล์นี้ยังควรเป็น composition root ที่เห็น lifecycle หลักของ process

---

## What Should Remain Visible in the Root

ถึงจะแยก module แล้ว root/start file ควรยังเห็น:

- load env/config
- create DB pool
- run migrations
- create Express app
- create HTTP server
- install WebSocket
- register routes
- start background jobs
- listen port
- graceful shutdown

เหตุผล: ถ้าซ่อน lifecycle ลึกเกินไป เวลา production boot พังจะ debug ยาก

---

## Suggested Commit Plan

```text
refactor(server): extract route registration
refactor(server): extract static policy setup
refactor(server): extract API auth gate
refactor(server): extract websocket server setup
refactor(server): extract retention jobs
refactor(server): extract camera monitors
refactor(server): introduce createApp factory
```

ควรแยก commit ตาม concern และ validate หลังแต่ละ commit

---

## Validation Checklist

### Minimum checks

```bash
node --check src/api-server.js
node --check src/server/register-routes.js
node --test test/*.test.js
```

เลือก `node --check` เฉพาะไฟล์ใหม่ที่เพิ่มจริง

### If touching static/CSP

```bash
curl -i http://localhost:3000/ | grep -i content-security-policy
curl -i http://localhost:3000/others/ | grep -i content-security-policy
```

Expected:

- dashboard ยังมี CSP เดิม
- `/others` ยังมี strict CSP
- `/vendor`, `/branding`, `/tiles` behavior ไม่เปลี่ยน
- dotfiles ยัง denied

### If touching auth gate

Manual smoke:

```text
GET /api/health/details without token -> 401
GET /api/branding without token -> 200
GET /snapshots/some.jpg without token -> 401/403
GET /media/some.mp4 without token -> 401/403
viewer POST /api/cameras -> 403
admin POST /api/cameras -> reaches validation
must_change_password token -> blocked except allowlisted paths
internal token request -> allowed only where intended
```

### If touching WebSocket

Manual smoke:

```text
WS without token -> 401
WS with valid token -> connected
new_event notify -> dashboard receives event
event payload shape unchanged
```

### If touching background jobs

Manual smoke:

```text
retention logs still run at intended interval
camera offline/recovery state still writes camera_status_log
stale recorder alert still respects boot grace, paused/offline skip, quiet hours
MQTT freshness warning still behaves as before
```

---

## Final Recommendation

`api-server.js` ลดได้อีกมากโดยไม่กระทบภาพรวม หากลดด้วยการแยก wiring/infrastructure concern:

1. route registration
2. static/CSP policy
3. auth gate
4. WebSocket bridge
5. background jobs/monitors
6. create app / start server split

ควรทำจาก risk ต่ำไปสูง และหลังแต่ละ slice ต้อง validate behavior ที่เกี่ยวข้อง

เป้าหมายที่ดีคือให้ `api-server.js` หรือ `start-server.js` เป็น lifecycle map ของ process ไม่ใช่ที่รวมรายละเอียดทุก policy และ background job
