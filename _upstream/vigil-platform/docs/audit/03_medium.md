# MEDIUM Findings

> ⚠️ ระดับความรุนแรง: **MEDIUM** — ต้องมี condition เพิ่มเติม หรือ defense-in-depth gap
> ดูสารบัญ: [CLAUDE_Audit.MD](../../CLAUDE_Audit.MD)

---

## SEC-004 · `must_change_password` enforce แค่ฝั่ง client (server ไม่ block) ✅ แก้แล้ว (2026-05-28)

### 🔵 Fact

`auth.js:41-49` สร้าง default admin `admin/changeme` พร้อม `must_change_password = true`

ฝั่ง dashboard บังคับเปลี่ยนรหัสที่:
- `dashboard.js:6869` ตรวจหลัง login
- `dashboard.js:6919-6920` ห้ามปิด modal

แต่**ฝั่ง server**: `auth.js:225-261` (requireAuth/requireAdmin/requireAdminOrAuditor) **ไม่ได้ check `must_change_password`** — user ที่มี flag นี้อยู่ ยังเรียก /api/* endpoints ใดก็ได้ตามปกติ

### 🟡 Impact

- Attacker เดารหัส `admin/changeme` ได้ → POST /api/auth/login → ได้ session token
- ข้าม UI ทั้งหมด — ยิง API ตรงๆ ได้ทันที (admin role) → ดู camera passwords, ดึง audit log, สร้าง user ใหม่, modify license config
- Mitigated โดย rate-limit 10/min/IP (api-server.js:413-417) + per-user lockout 5-fail/15min (auth.js:21-22) — แต่ "changeme" เป็น default well-known string

### ✅ Verification (code-path)

`requireAuth` / `requireAdmin` / global `/api` middleware ทั้งสาม path ไม่มี `must_change_password` check ใดเลย — confirmed by grep

### 🛠 Fix (P1-A)

#### Patch 1 — `src/auth.js` line ~225-239 (requireAuth)

**Old:**
```javascript
function requireAuth(req, res, next) {
  if (req.internal === true) return next();
  const token = (req.cookies && req.cookies.session) || extractBearer(req);
  if (!token) return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  getUserFromToken(token).then(user => {
    if (!user) return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
    req.user = user;
    next();
  }).catch(() => res.status(500).json({ error: 'Auth error' }));
}
```

**New:**
```javascript
// Endpoint ที่ user with must_change_password ยังต้องเข้าได้
const ALLOW_WHILE_MUST_CHANGE = new Set([
  '/api/auth/logout',
  '/api/auth/change-password',
  '/api/auth/me',
]);

function requireAuth(req, res, next) {
  if (req.internal === true) return next();
  const token = (req.cookies && req.cookies.session) || extractBearer(req);
  if (!token) return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  getUserFromToken(token).then(user => {
    if (!user) return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
    // SEC-004: user ที่ยังไม่เปลี่ยน password เริ่มแรก → block API ทั้งหมดยกเว้น
    // logout + change-password (ฟอร์มในหน้า dashboard จะแสดง modal บังคับเปลี่ยน)
    if (user.must_change_password && !ALLOW_WHILE_MUST_CHANGE.has(req.path)) {
      return res.status(403).json({
        error: 'Must change password before using the API',
        code: 'MUST_CHANGE_PASSWORD'
      });
    }
    req.user = user;
    next();
  }).catch(() => res.status(500).json({ error: 'Auth error' }));
}
```

#### Patch 2 — `src/auth.js` line ~199-220 (getUserFromToken)

เพิ่ม `must_change_password` ใน SELECT + return:

**Old:**
```javascript
const { rows } = await pool.query(`
  SELECT u.id, u.username, u.email, u.full_name, u.role, u.enabled,
         s.expires_at, s.id AS session_id
  ...
return {
  id: row.id, username: row.username, ...,
  session_id: row.session_id,
};
```

**New:**
```javascript
const { rows } = await pool.query(`
  SELECT u.id, u.username, u.email, u.full_name, u.role, u.enabled,
         u.must_change_password,
         s.expires_at, s.id AS session_id
  ...
return {
  id: row.id, username: row.username, email: row.email,
  full_name: row.full_name, role: row.role,
  must_change_password: row.must_change_password,
  session_id: row.session_id,
};
```

#### Patch 3 — Global /api middleware (`api-server.js:618-631`)

```javascript
app.use('/api', async (req, res, next) => {
  const publicApiPaths = ['/auth/login', '/auth/logout', '/auth/me', '/line/webhook', '/branding', '/eula'];
  if (publicApiPaths.includes(req.path)) return next();
  if (isValidInternalToken(req)) { req.internal = true; return next(); }
  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  const user = await auth.getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
  // SEC-004: บังคับใน global gate ด้วย (สำหรับ endpoint ที่ไม่ได้ใช้ requireAuth/requireAdmin)
  if (user.must_change_password &&
      !['/auth/logout', '/auth/change-password'].includes(req.path)) {
    return res.status(403).json({ error: 'Must change password', code: 'MUST_CHANGE_PASSWORD' });
  }
  req.user = user;
  next();
});
```

### ✓ Verify-after

1. Login เป็น default admin (`admin/changeme`) → curl /api/cameras → ต้องได้ 403 MUST_CHANGE_PASSWORD
2. curl /api/auth/change-password → ผ่าน (เปลี่ยน password ได้)
3. หลังเปลี่ยน password → /api/cameras ผ่านปกติ
4. ทดสอบ frontend flow — login → ต้องโดน modal บังคับเปลี่ยน → เปลี่ยนเสร็จ → ใช้งานปกติ

### ✅ Fix applied (2026-05-28)

**3 patches ใน 2 ไฟล์:**

1. **`src/auth.js` — `getUserFromToken`**: เพิ่ม `u.must_change_password` ใน SELECT + return object → field ถูกส่งต่อให้ middleware ทุกชั้น
2. **`src/auth.js` — `requireAuth`**: เพิ่ม `ALLOW_WHILE_MUST_CHANGE` Set + check → block endpoint ที่ใช้ `requireAuth` ยกเว้น logout/change-password/me
3. **`src/api-server.js` — global `/api` middleware (line 618)**: เพิ่ม check เดียวกัน → block ทุก API ที่ไม่ได้ใช้ `requireAuth` โดยตรง

**ผล:** `admin/changeme` ที่ยังไม่เปลี่ยน password → เรียก API ใดก็ได้แค่ login/logout/me/change-password เท่านั้น — bypass UI ไม่ได้อีกแล้ว

**Runtime verify:** ต้องรัน `npm run api` ใหม่หลัง deploy เพื่อให้ code ใหม่โหลด (static syntax check ผ่านแล้ว)

---

## SEC-005 · Logo upload รับ SVG → librsvg/Pango processing risk ✅ แก้แล้ว (2026-05-28)

### 🔵 Fact

`api-server.js:4806-4833` (POST /api/branding/logo):

```javascript
if (!/^image\/(png|jpe?g|webp|svg\+xml|gif)$/.test(mime)) {
  return res.status(415).json({ error: 'unsupported image type' });
}
// ...
await sharp(req.file.buffer, { failOnError: false })
  .resize(256, 256, { fit: 'inside', withoutEnlargement: false })
  .png({ compressionLevel: 9 })
  .toFile(outPath);
```

- MIME check ตาม content-type จาก multer (client-controlled สำหรับ Content-Type header)
- ไม่เช็ค magic bytes
- รับ SVG (`image/svg+xml`) → sharp ใช้ librsvg parse → librsvg มี history ของ CVE (XXE, infinite loop ในบาง release)
- `failOnError: false` ทำให้ภาพเสียก็ไม่ throw

### 🟡 Impact

- Admin only (line 4809) — trust boundary มีอยู่
- แต่ถ้า admin session ถูก hijack (SEC-002), upload SVG ที่ trigger CVE ของ libvips/librsvg → potential RCE/DoS
- Output เป็น PNG ที่ raster แล้ว → resulting file ปลอดภัย แต่ processing phase เสี่ยง

### 🛠 Fix (P2-C)

**ไฟล์:** `src/api-server.js` (line ~4811-4814)

**Old:**
```javascript
const mime = (req.file.mimetype || '').toLowerCase();
if (!/^image\/(png|jpe?g|webp|svg\+xml|gif)$/.test(mime)) {
  return res.status(415).json({ error: 'unsupported image type' });
}
```

**New:**
```javascript
// SEC-005: SVG ถูกตัดออกเพราะ librsvg parse step มี CVE history.
// Magic-byte check ป้องกัน multer mimetype สับเปลี่ยนผิด.
const mime = (req.file.mimetype || '').toLowerCase();
if (!/^image\/(png|jpe?g|webp|gif)$/.test(mime)) {
  return res.status(415).json({ error: 'unsupported image type (svg removed for safety)' });
}
const buf = req.file.buffer;
const isPng  = buf.length > 8  && buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47;
const isJpeg = buf.length > 3  && buf[0]===0xFF && buf[1]===0xD8 && buf[2]===0xFF;
const isWebP = buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
const isGif  = buf.length > 6  && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a');
if (!isPng && !isJpeg && !isWebP && !isGif) {
  return res.status(415).json({ error: 'invalid image magic bytes' });
}
```

### ✓ Verify-after

1. Upload PNG/JPG ปกติ → ผ่าน
2. Upload SVG → 415
3. Upload `.png` ที่จริงๆ เป็น HTML inside (rename file extension) → 415 magic bytes ไม่ตรง

### ✅ Fix applied (2026-05-28)

**1 patch ใน `src/api-server.js` (POST /api/branding/logo):**
- ตัด `svg\+xml` ออกจาก MIME allowlist — SVG ไม่รับอีกแล้ว
- เพิ่ม magic bytes check 4 format (PNG/JPEG/WebP/GIF) ก่อนส่งให้ sharp
- ผลลัพธ์: MIME spoofing ผ่าน Content-Type header ไม่ได้อีก — ต้องเป็น binary จริง

**Runtime verify ผ่านแล้ว (2026-05-28):**
- ✅ Valid PNG → 200 ok
- ✅ SVG + `image/svg+xml` MIME → 415 "unsupported image type"
- ✅ HTML content + `image/png` MIME → 415 "invalid image magic bytes"

---

## SEC-006 · ไม่มี Content-Security-Policy (CSP) ✅ แก้แล้ว (2026-05-28)

### 🔵 Fact

`api-server.js:105-116` ตั้ง:
- `X-Content-Type-Options: nosniff` ✅
- `X-Frame-Options: DENY` ✅
- `Referrer-Policy: same-origin` ✅
- `CSP intentionally deferred` (comment ในโค้ดยอมรับ)

ไม่มี `Content-Security-Policy` หรือ `Strict-Transport-Security` (HSTS) header

### 🟡 Impact

- CSP คือ defense-in-depth ที่จะ block stored XSS (SEC-002) แม้ escapeHtml ตกหล่น
- HSTS — Cloudflare เป็นคนเสริมให้ (Tunnel terminate HTTPS) แต่ถ้า direct HTTP access bypass CF → MITM ได้

### 🛠 Fix (P2-A) — CSP Report-Only mode ก่อน

**ไฟล์:** `src/api-server.js` (line ~110-116)

**Old:**
```javascript
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
```

**New:**
```javascript
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // SEC-006: CSP Report-Only — เก็บ violation ก่อน rollout เป็น enforce
  const host = req.headers.host || '';
  res.setHeader('Content-Security-Policy-Report-Only',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' wss://" + host + " ws://" + host + " https://api.mapbox.com https://api.imgbb.com; " +
    "frame-ancestors 'none'"
  );
  // HSTS — only when actually serving HTTPS (Cloudflare Tunnel)
  if (req.secure || req.headers['cf-visitor']?.includes('https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
```

### ✓ Verify-after

1. โหลด dashboard ปกติ — ต้องทำงานครบทุกหน้า (เพราะเป็น Report-Only)
2. DevTools → Console → ดู CSP violation messages — เก็บไว้พิจารณา
3. หลัง 1-2 สัปดาห์ ค่อยเปลี่ยน header เป็น `Content-Security-Policy` (ตัด `-Report-Only`) + tighten `script-src` ออก `'unsafe-inline'` (ต้องแปลง inline script เป็น external file หรือ nonce ก่อน)

### ✅ Fix applied (2026-05-28)

**1 patch ใน `src/api-server.js` (security headers middleware):**
- เพิ่ม `Content-Security-Policy-Report-Only` header — Report-Only ก่อน ไม่ block อะไร
- `script-src` รวม `cdn.jsdelivr.net` (OpenLayers, Chart.js ที่ index.html load อยู่จริง)
- `img-src` รวม `*.basemaps.cartocdn.com` + `api.mapbox.com` (map tiles)
- `connect-src` รวม `wss://` + `ws://` (WebSocket) + `api.mapbox.com` + `api.imgbb.com`
- เพิ่ม `Strict-Transport-Security` header เฉพาะเมื่อ request ผ่าน HTTPS (ตรวจ `cf-visitor` header จาก Cloudflare Tunnel)

**Audit spec adjustment:** เพิ่ม `cdn.jsdelivr.net` ใน `script-src` และ `*.basemaps.cartocdn.com` ใน `img-src` จาก audit spec เดิม เนื่องจากตรวจ `index.html` จริงพบ CDN dependencies เหล่านี้

**Runtime verify:** ต้อง restart server + DevTools Network tab ดู response headers

---

## SEC-007 · npm audit — `qs` 6.11.1-6.15.1 DoS ✅ แก้แล้ว (2026-05-28)

### 🔵 Fact

```
qs  6.11.1 - 6.15.1
Severity: moderate
qs has a remotely triggerable DoS: qs.stringify crashes with TypeError on
null/undefined entries in comma-format arrays when encodeValuesOnly is set
GHSA-q8mj-m7cp-5q26
```

### ✅ Live verification

```bash
$ cat src/node_modules/qs/package.json | grep version
"version": "6.15.1"
```

อยู่ในช่วง vulnerable confirmed

### 🟡 Impact

DoS เท่านั้น (crash on stringify) — ไม่ใช่ RCE/info-leak. Trigger ต้องการ comma-format array + encodeValuesOnly — Express ไม่ได้เปิด encodeValuesOnly โดย default

### 🛠 Fix (P2-B)

```bash
cd src
npm audit fix
# ถ้ามี breaking change → npm update qs ก่อน
```

### ✓ Verify-after

```bash
$ npm audit --omit=dev   # ต้องเป็น "found 0 vulnerabilities"
$ npm run api            # ตรวจว่า api-server ยัง start ได้
```

### ✅ Fix applied (2026-05-28)

```bash
cd src && npm audit fix
# qs 6.15.1 → 6.15.2 (patch release, no breaking change)
```

**Runtime verify ผ่านแล้ว:**
```
found 0 vulnerabilities
```
