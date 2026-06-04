# LOW Findings

> ⚠️ ระดับความรุนแรง: **LOW** — ใช้ประโยชน์ได้แต่ blast radius จำกัดหรือต้องมี condition พิเศษ
> ดูสารบัญ: [CLAUDE_Audit.MD](../../CLAUDE_Audit.MD)
>
> หมายเหตุ: **SEC-011 (Postgres expose) จัดเป็น LOW แต่ fix priority = P1** เพราะ blast radius กว้างถ้า port หลุดออก WAN

---

## SEC-008 · /api/cameras/probe-snapshot → SSRF (admin trust boundary) ✅ แก้แล้ว (2026-05-28)

### 🔵 Fact

`api-server.js:1611-1628` รับ `ip_address` จาก request body → `_probeHttpImage(ip, port, ...)` ยิง HTTP ไปไหนก็ได้

`requireAdminForWrites('/api/cameras')` (line 646) protects POST/PUT/DELETE → admin only

### 🟡 Impact

Admin สามารถ scan LAN/internal services ผ่าน probe endpoint (เช่น `169.254.169.254` cloud metadata). บน on-prem deployment ปกติ admin มี shell access อยู่แล้ว → impact ต่ำ. บน multi-tenant cloud หรือ shared host → MEDIUM

### 🛠 Fix (P3-A) — optional, ขึ้นกับ deployment model

**ไฟล์:** `src/api-server.js` (line ~1611-1628 — probe-snapshot)

```javascript
// SEC-008: บล็อก private/loopback ranges ไม่ให้ใช้ probe-snapshot สแกน LAN
// ปิดความสามารถนี้บน multi-tenant cloud; on-prem พิจารณาไม่บังคับ
function _isPrivateIp(ip) {
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.|::1$|fc[0-9a-f][0-9a-f]:|fe80:)/i.test(ip) ||
         /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);
}
// ถ้าเปิดใช้ blocklist:
// if (_isPrivateIp(ip)) return res.status(400).json({ error: 'private IP not allowed' });
```

**ระวัง:** ระบบนี้ on-prem — admin ใช้ probe-snapshot สแกน LAN เพื่อ discover กล้องในเครือข่ายเดียวกัน — ถ้า enable blocklist จะทำลาย feature นี้

**แนะนำ:** ทำเป็น flag ใน system_settings (`allow_private_ip_probe`, default ON สำหรับ on-prem, OFF สำหรับ cloud SKU)

### ✓ Verify-after

- ถ้า enable blocklist: POST /api/cameras/probe-snapshot ด้วย ip_address=192.168.1.1 → 400
- ปกติ admin discover camera ใน LAN ยังทำงานได้ (ถ้าเก็บ flag เป็น on)

### ✅ Fix applied (2026-05-28)

**On-prem deployment — non-blocking approach (Working Agreement #3 Capture: log/warn ทำได้เลย):**
- เพิ่ม `_isPrivateIp()` utility function ก่อน `_probeHttpImage` — ครอบ RFC-1918 + loopback + link-local
- เพิ่ม `console.warn` ใน probe-snapshot handler เมื่อ IP เป็น private — สร้าง audit trail ใน server log
- **ไม่ block** — on-prem admin ต้อง probe LAN cameras; uncomment rejection line สำหรับ cloud SKU

---

## SEC-009 · `src/.env` มี IMGBB_API_KEY ที่เป็น malformed line ✅ แก้แล้ว (2026-05-28)

### 🔵 Fact

`src/.env:32`:
```
IMGBB_API_KEY=SESSION_SECRET=f66e4f4a4cba20693c63a6a97e30f7ce
```

dotenv parse → `IMGBB_API_KEY` = literal string `"SESSION_SECRET=f66e4f4a4cba20693c63a6a97e30f7ce"` (เกิดจากการคัด-วาง / merge บรรทัดผิด)

`SESSION_SECRET` ถูกตั้งใหม่ที่ line 35 (`SESSION_SECRET=7c29d9c5...`) — dotenv default `override:false` → first occurrence wins. IMGBB_API_KEY ถูก set (มีค่าเป็น garbage) แต่ SESSION_SECRET เพิ่งถูก set ครั้งแรกที่ line 35 → ใช้ได้จริง

### 🟡 Impact

- `IMGBB_API_KEY` value เป็น garbage → imgbb upload fail → `line-sender.js:_imgbbUpload` คืน null → graceful fallback ok
- ไม่มี secret leak (key เก่าหายไป — value เดิมถูกเขียนทับด้วยข้อผิดพลาดการคัดลอก)
- เป็น operational bug ไม่ใช่ security ตรง

### 🛠 Fix (P3-B)

**ไฟล์:** `src/.env` (line 32)

**Old:**
```
IMGBB_API_KEY=SESSION_SECRET=f66e4f4a4cba20693c63a6a97e30f7ce
```

**New (ถ้ายังใช้ imgbb feature):**
```
IMGBB_API_KEY=<key จริงจาก imgbb.com>
```

**หรือถ้าไม่ใช้:**
```
# IMGBB_API_KEY=  # disabled — alert image upload จะส่ง LINE แต่ไม่มี link รูป
```

### ✓ Verify-after

- ส่ง LINE alert พร้อม snapshot → ดู link รูปใน LINE message → ต้องโหลดได้ (ถ้าตั้ง key ใหม่)

### ✅ Fix applied (2026-05-28)

**`src/.env` (gitignored — ไม่ committed):** comment out บรรทัด malformed
```
# SEC-009: บรรทัดข้างบนนี้ malformed (merge ผิดพลาด) — comment ออก
# IMGBB_API_KEY=<your_key_here>
```
imgbb feature fallback gracefully อยู่แล้ว — LINE alert ส่งได้ แค่ไม่มีรูป snapshot ใน message จนกว่าจะใส่ key จริง

---

## SEC-010 · Logout cookie clear ไม่มี Secure / SameSite ✅ แก้แล้ว (2026-05-28)

### 🔵 Fact

`api-server.js:495`:
```javascript
res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
```

vs login (line 467-479) ที่ตั้งครบ HttpOnly + Secure + SameSite=Lax

### 🟡 Impact

Cookie expiration ทำงานได้ปกติ (Max-Age=0). Secure/SameSite ไม่จำเป็นสำหรับ cookie ที่จะถูกลบ. **เป็น cosmetic ไม่ใช่ security gap**

### 🛠 Fix (P3-C) — ใส่ flags ครบให้สอดคล้องกับ login

**ไฟล์:** `src/api-server.js` (line 495)

**Old:**
```javascript
res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
```

**New:**
```javascript
const xfp = req.headers['x-forwarded-proto'];
const cfv = req.headers['cf-visitor'];
const isHttps = req.secure || xfp === 'https' || (cfv && cfv.includes('https'));
const flags = ['session=', 'Path=/', 'HttpOnly', 'Max-Age=0'];
if (isHttps) flags.push('Secure');
flags.push('SameSite=Lax');
res.setHeader('Set-Cookie', flags.join('; '));
```

### ✓ Verify-after

- Logout → DevTools → Application → Cookies → ตรวจว่า session cookie หมดอายุทันที + มี Secure/SameSite flag

### ✅ Fix applied (2026-05-28)

**`src/api-server.js` — logout handler:** เปลี่ยนจาก hardcoded string เป็น flag array เดียวกับ login
- ตรวจ `req.secure` + `x-forwarded-proto` + `cf-visitor` → ใส่ `Secure` เฉพาะเมื่อ HTTPS
- `SameSite=Lax` ติดมาทุกกรณี (ตรงกับ login)

**Runtime verify:** ต้อง restart server + DevTools Application tab ดู cookie flags หลัง logout

---

## SEC-011 · Postgres exposed on host:5432 + weak password `bosch2025` ✅ แก้แล้ว (2026-05-28)

> 🚨 **Fix priority = P1** (ไม่ใช่ P3) — ถึงแม้ severity = LOW (mitigated by network position) แต่ถ้า port forward / Docker network mistake ออก WAN จะกระทบ data ทั้งหมด

### 🔵 Fact

`docker-compose.yml:15-16`:
```yaml
ports:
  - "5432:5432"
```

`docker-compose.yml:14`: `POSTGRES_PASSWORD: bosch2025` (committed in repo!)

### ✅ Live verification

```bash
$ lsof -iTCP:5432 -sTCP:LISTEN
com.docke 2960 dojojin  IPv6  TCP *:postgresql (LISTEN)        # ← bind 0.0.0.0
```

### 🟡 Impact

- ใครเข้าถึงพอร์ต 5432 ได้ + รู้ password (committed → known) → ดูทุก event / snapshot path / camera config / audit log / session token
- บน on-prem private LAN ปกติยอมรับได้ — แต่ถ้า host มี route ออก WAN หรือ container escape → critical

### 🛠 Fix (P1-B) — bind localhost + rotate password

#### Patch 1 — `docker-compose.yml` (line 13-16)

**Old:**
```yaml
    environment:
      POSTGRES_DB: vigil_platform
      POSTGRES_USER: bosch
      POSTGRES_PASSWORD: bosch2025
    ports:
      - "5432:5432"
```

**New:**
```yaml
    environment:
      POSTGRES_DB: vigil_platform
      POSTGRES_USER: bosch
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?must be set in .env}
    ports:
      - "127.0.0.1:5432:5432"   # localhost only — apps ใน host เดียวกัน
```

#### Patch 2 — `.env` (root, gitignored) — เพิ่ม / แก้:

```bash
POSTGRES_PASSWORD=<generate ใหม่ด้วย: openssl rand -base64 32>
```

#### Patch 3 — `src/.env` แก้ DB_PASSWORD ให้ตรงกัน:

```bash
DB_PASSWORD=<ค่าเดียวกับ POSTGRES_PASSWORD ใหม่>
```

**ระวัง — ถ้ามี 3rd party app ดึง v_*_public views ผ่าน TCP จาก LAN** → ต้องตั้ง separate user แบบ `docs/REF_third-party-integration.md` ใช้ pg_hba.conf จำกัด IP + cert auth — อย่าใช้ port forward ตรงๆ

#### ลำดับ rollout (เพื่อไม่ให้ระบบล่ม)

1. `docker compose down`
2. แก้ทั้งสามไฟล์
3. `docker compose up -d`
4. ทดสอบ api-server / mqtt-subscriber / ingesters connect ได้

### ✓ Verify-after

```bash
$ lsof -iTCP:5432 -sTCP:LISTEN   # ต้อง bind 127.0.0.1, ไม่ใช่ *
$ psql -h <lan-ip> -U vigil_sql vigil_platform  # ต้อง connection refused / timeout
$ psql -h localhost -U vigil_sql vigil_platform  # ต้องเข้าได้ด้วย password ใหม่
```

### ✅ Fix applied (2026-05-28)

**3 files แก้ (2 gitignored + 1 committed):**
1. **`docker-compose.yml`** (committed): `"5432:5432"` → `"127.0.0.1:5432:5432"` + password → `${POSTGRES_PASSWORD:?must be set in .env}`
2. **`.env`** (gitignored): เพิ่ม `POSTGRES_PASSWORD=<rotated>`
3. **`src/.env`** (gitignored): `DB_PASSWORD=bosch2025` → rotated value

**ลำดับที่ทำ (safe rollout ไม่ล่ม):**
1. `ALTER USER bosch PASSWORD '<new>'` ผ่าน docker exec — DB ยอมรับ password ใหม่ก่อน
2. อัป .env files ทั้งสอง
3. `docker compose up -d postgres` — recreate container กับ port binding ใหม่

**Runtime verify ผ่านแล้ว:**
```
TCP localhost:postgresql (LISTEN)   ← bind 127.0.0.1 ✅
DB connection OK                     ← password ใหม่ใช้ได้ ✅
```

**⚠️ api-server ต้อง restart** เพื่อ reload `src/.env` กับ password ใหม่ (process เก่ายังมี pool เชื่อมอยู่ แต่ reconnect จะ fail ถ้า pool หมด)
