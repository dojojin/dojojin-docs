# CRITICAL Findings

> ⚠️ ระดับความรุนแรง: **CRITICAL** — chain attack สร้าง full compromise ได้
> ดูสารบัญ: [CLAUDE_Audit.MD](../../CLAUDE_Audit.MD)
>
> **SEC-001 Status: ✅ Phase 1 fixed (2026-05-28)** — ports bound to localhost, dashboard password rotated.
> Phase 2 (ENABLE_AUTHN) pending camera credential provisioning. Commits: `4e11375`

---

## SEC-001 · MQTT broker อนุญาตให้ publish โดยไม่ต้อง auth

### 🔵 Fact

`docker-compose.yml:33-50` ตั้งค่า EMQX broker เปิด anonymous publish/subscribe:

```yaml
environment:
  EMQX_LISTENERS__TCP__DEFAULT__ENABLE_AUTHN: "false"
  EMQX_LISTENERS__WS__DEFAULT__ENABLE_AUTHN: "false"
ports:
  - "1883:1883"     # bound to host 0.0.0.0:1883 by default
  - "18083:18083"   # EMQX Dashboard UI (default creds admin/public)
```

Comment ในไฟล์ยอมรับเอง: "Listener authn off → anonymous like the previous Mosquitto config"

### 🟡 Impact

- **ใครก็ตามที่เข้าถึงพอร์ต 1883 ได้** (LAN segment, Docker bridge, internet ถ้า expose port) สามารถ publish payload ใดๆ บน topic `<anything>/onvif-ej/RuleEngine/...`
- `mqtt-subscriber.js:413-543` อ่าน `camera_id` จาก topic.split('/')[0], `rule_name` จาก `msg.Source.Rule`, `object_class` จาก `msg.Data.Object.Appearance.Class.Type`, แล้ว INSERT เข้า DB
- เนื้อหา attacker-controlled นี้ถูก render บน dashboard โดยไม่ผ่าน escapeHtml → ดู [SEC-002](02_high.md#sec-002) (stored XSS) ที่ chain มาจากนี่
- EMQX Dashboard UI ที่พอร์ต 18083 ใช้ default creds `admin/public`

### ✅ Live verification

```bash
$ lsof -iTCP:1883 -sTCP:LISTEN
com.docke 2960 dojojin  IPv6  TCP *:ibm-mqisdp (LISTEN)        # ← *: = 0.0.0.0
$ lsof -iTCP:18083 -sTCP:LISTEN
com.docke 2960 dojojin  IPv6  TCP *:18083 (LISTEN)

$ curl -s -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"public"}' \
  http://localhost:18083/api/v5/login
{"version":"5.8.6","token":"eyJhbGc...","license":{"edition":"ce"}}    # ← 200 + valid JWT
```

⏸ **ไม่ได้ลอง publish จริง** (`mosquitto_pub`) เพราะจะ pollute prod event pipeline + อาจ trigger LINE alert. Code path ใน `mqtt-subscriber.js:366-371` (wildcard subscribe `+/onvif-ej/...`) ครอบ broker ที่เพิ่ง confirmed ว่าเปิด anonymous บน 0.0.0.0:1883

### 🛠 Fix (P0-C)

#### Phase 1 — bind localhost (ทำได้เลย, ไม่กระทบ Bosch publisher)

**ไฟล์:** `docker-compose.yml` (line 36-46)

**Old:**
```yaml
    ports:
      - "1883:1883"
      - "8083:8083"
      - "18083:18083"
    environment:
      EMQX_LISTENERS__TCP__DEFAULT__ENABLE_AUTHN: "false"
      EMQX_LISTENERS__WS__DEFAULT__ENABLE_AUTHN: "false"
      EMQX_NODE__NAME: "emqx@127.0.0.1"
      EMQX_CLUSTER__DISCOVERY_STRATEGY: "manual"
```

**New:**
```yaml
    ports:
      - "127.0.0.1:1883:1883"   # localhost only — ingester อยู่ host เดียวกัน
      - "127.0.0.1:8083:8083"   # WS — เปิดเฉพาะถ้ามี client ใช้จริง
      - "127.0.0.1:18083:18083" # Dashboard UI — ห้าม expose
    environment:
      EMQX_LISTENERS__TCP__DEFAULT__ENABLE_AUTHN: "false"  # Phase 2 → "true"
      EMQX_LISTENERS__WS__DEFAULT__ENABLE_AUTHN: "false"
      EMQX_NODE__NAME: "emqx@127.0.0.1"
      EMQX_CLUSTER__DISCOVERY_STRATEGY: "manual"
      # SEC-001: เปลี่ยน EMQX dashboard default password ตอน restart
      EMQX_DASHBOARD__DEFAULT_PASSWORD: "${EMQX_DASHBOARD_PASSWORD:?must be set}"
```

#### Phase 2 — เปิด AUTHN (รอจัดการ Bosch firmware ก่อน)

```yaml
EMQX_LISTENERS__TCP__DEFAULT__ENABLE_AUTHN: "true"
# + ตั้ง user + ACL ใน EMQX dashboard / API ก่อน restart
```

**ระวัง (Working Agreement #3):** การเปิด AUTHN จะตัด Bosch publisher ทันทีถ้ายังไม่ได้ตั้ง credentials ในกล้อง → **ทำ Phase 1 ก่อน** + รอตั้ง MQTT user ในกล้องแต่ละตัวก่อน Phase 2

ตอน restart docker-compose:
1. สร้าง `.env` (gitignored) มี `EMQX_DASHBOARD_PASSWORD=<random>` ใหม่
2. หรือ login EMQX dashboard ครั้งแรกแล้วเปลี่ยนใน UI

### ✓ Verify-after

```bash
$ lsof -iTCP:1883 -sTCP:LISTEN   # ต้อง bind 127.0.0.1, ไม่ใช่ *
$ curl -s -X POST http://<lan-ip>:18083/api/v5/login -d '{"username":"admin","password":"public"}'
# ต้อง connection refused / timeout (port ไม่เปิดบน LAN interface)
$ curl -s -X POST http://localhost:18083/api/v5/login -d '{"username":"admin","password":"public"}'
# ต้อง 401 หลังเปลี่ยน password แล้ว
```
