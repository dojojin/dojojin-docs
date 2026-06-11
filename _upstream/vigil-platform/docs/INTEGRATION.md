# Executive Summary — Integration Guide

> สำหรับเอา Executive Summary page เข้าระบบ `dashboard.dojojin.tech` ที่มีอยู่
> Last updated: 2026-06-08

---

## 📦 สิ่งที่ได้

| ไฟล์ | ใส่ที่ไหน | หน้าที่ |
|---|---|---|
| `executive-summary.html` | reference / preview standalone | ดูได้เลย ไม่ต้องต่อ backend |
| `stats-summary-route.js` | `src/stats-summary-route.js` | Backend endpoint module |
| `INTEGRATION.md` | (this file) | คู่มือ integrate |

---

## 🚀 Quick Start

### 1) ทดสอบ standalone ก่อน

```bash
cd ~/vigil-platform
cp ~/Downloads/executive-summary.html dashboard/exec-summary.html
# เปิด browser
open http://localhost:3000/exec-summary.html
```

> หน้าจะโชว์ mock data ทันที (มุมขวาบนจะมีจุดแดง = "API unreachable — showing mock data")
> ถ้าทำ Step 2 เสร็จแล้ว จุดจะหายไป (กลายเป็นเขียว)

### 2) เพิ่ม backend endpoint (5 บรรทัด)

```bash
cp ~/Downloads/stats-summary-route.js src/stats-summary-route.js
```

แก้ `src/api-server.js` ใส่ 3 บรรทัดนี้ **หลัง** ที่มีการ define `app`, `pool`, `requireAuth` ครบแล้ว แต่ **ก่อน** `app.listen(...)`:

```javascript
// === Executive Summary route =====================================
const { registerStatsSummaryRoute } = require('./stats-summary-route');
registerStatsSummaryRoute(app, pool, requireAuth, {
  snapshotsPath: path.join(__dirname, '..', 'snapshots'),
  version: 'v1.2.0',
  versionDate: '2026-05-07',
  isMqttConnected: () => mqttClient && mqttClient.connected,  // ปรับชื่อตัวแปร MQTT ให้ตรง
  startedAt: Date.now()
});
```

> **⚠️ ปรับให้ตรงโค้ดเดิม:**
> - `requireAuth` — middleware ชื่อจริงในโค้ดอาจเป็น `authMiddleware`, `requireSession`, ฯลฯ
> - `mqttClient` — ถ้า MQTT subscribe อยู่คนละ process (`mqtt-subscriber.js`) ใช้ `() => true` ไปก่อน แล้วทำ status endpoint แยกทีหลัง

Restart API:
```bash
cd src && npm run api
# ทดสอบ
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/stats/summary | jq
```

---

## 🔧 Integrate เข้า dashboard เดิม (เป็น page หนึ่งใน 8 page)

ระบบเดิมมี 7 page (Camera Status, Live Events, Snapshots, Map, Statistics, Reports, Alerts)
ตัวเลือก:
- **A:** เพิ่มเป็น page ที่ 8 ชื่อ "Executive Summary" (default page)
- **B:** **แทน** "Camera Status" เดิม เพราะ Executive Summary ครอบคลุมกว่า

ผมแนะนำ **A** (เพิ่มใหม่) เพื่อไม่ break user habit

### Step A1 — Add HTML section to `dashboard/index.html`

หา section element อื่นเป็น reference เช่น:
```html
<section id="page-cameras" class="page">...</section>
```

เพิ่ม section ใหม่ก่อน section อื่นๆ:
```html
<section id="page-summary" class="page active">
  <!-- คัดลอกจาก <main class="main">...</main> ใน executive-summary.html -->
  <!-- เริ่มจาก <div class="header"> ไปจนถึง <div class="panel cam-bar-panel">...</div> -->
</section>
```

### Step A2 — Move `<style>` block

ตัด `<style>...</style>` ทั้งก้อนจาก `executive-summary.html` ใส่ใน `dashboard/index.html` `<head>` หรือแยกเป็น `dashboard/exec-summary.css` แล้ว `<link>` เข้ามา

> **⚠️ สำคัญ:** scope CSS ป้องกันชนกับ style เดิม โดยใส่ wrapper class:
> ```css
> #page-summary .kpi-card { ... }   /* ทุก rule นำหน้าด้วย #page-summary */
> ```
> หรือใช้ `:where()` เพื่อ specificity = 0:
> ```css
> :where(#page-summary) .kpi-card { ... }
> ```

### Step A3 — Add nav link ใน sidebar เดิม

หา nav block ของ dashboard.js หรือ index.html เพิ่ม:
```html
<a class="nav-item" data-page="summary">
  <svg>...</svg>
  Executive
</a>
```

### Step A4 — Wire ใน `dashboard.js`

ตัด `<script>...</script>` ทั้ง IIFE จาก `executive-summary.html` แล้วใส่เข้า `dashboard.js`:

```javascript
// ที่ใต้สุดของ dashboard.js หรือใน section "Pages"
// ============================================================
// Executive Summary Page
// ============================================================
(function() {
  // ... ทุกอย่างใน IIFE จาก executive-summary.html
  // แก้ getToken() ให้ใช้ helper ของ dashboard.js เดิม
  // แก้ authedFetch() เปลี่ยนเป็น window.apiFetch() ถ้ามี
})();
```

แล้วใน page router เดิม:
```javascript
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');

  // เพิ่มบรรทัดนี้:
  if (name === 'summary') {
    window.executiveSummary?.start();
    window.executiveSummary?.reload();
  } else {
    window.executiveSummary?.stop();   // หยุด polling เมื่อ user ออกจาก page
  }
}
```

---

## 📡 API Response Schema (สำหรับเข้าใจ data flow)

```jsonc
{
  "timestamp": "2026-05-11T08:32:45.000Z",
  "kpis": {
    "total_events":  { "value": 12456, "change_pct": 12.5, "trend": "up" },
    "alerts":        { "value": 1234,  "change_pct": 8.2,  "trend": "up" },
    "traffic":       { "value": 4567,  "change_pct": 15.3, "trend": "up" },
    "people":        { "value": 7889,  "change_pct": 11.7, "trend": "up" },
    "system_health": { "status": "Excellent", "uptime_seconds": 1318800 }
  },
  "events_24h":    [{ "hour": "...", "count": 450 }, ...],   // 24 รายการ
  "breakdown":     [{ "class": "Person", "count": 3421 }, ...],
  "top_cameras":   [{ "camera_id": "BoschCam1", "camera_name": "BoschCam1", "count": 1234 }, ...],
  "recent_events": [{ "id": 1, "event_time": "...", "camera_id": "BoschCam1", ... }, ...],
  "cameras": {
    "total": 256, "online": 238, "offline": 12, "recording": 206, "motion": 18,
    "locations": [{ "camera_id": "BoschCam1", "lat": 13.7563, "lon": 100.5018, "event_count": 1234, "online": true }, ...]
  },
  "system": {
    "mqtt_connected": true, "db_connected": true,
    "storage_used_bytes": 2696093528064, "storage_total_bytes": 4398046511104,
    "snapshot_count": 14557, "snapshot_size_bytes": 135141851136,
    "uptime_seconds": 1318800, "version": "v1.2.0", "version_date": "2026-05-07"
  }
}
```

---

## 📱 Mobile Responsive Breakdown

ตามที่บอกไว้ว่า page อื่น mobile responsive แล้ว — Executive Summary ทำเหมือนกัน:

| Breakpoint | Layout |
|---|---|
| ≥ 1280px | KPIs 5 cols · Mid/Bot 3 cols (เต็มจอ) |
| 1024-1280 | KPIs 3 cols · Mid/Bot 2 cols (live events ลงล่าง) |
| 768-1024 | Sidebar เป็น **drawer** (hamburger button) · Mid/Bot 1 col |
| < 768 | KPIs 2 cols · System Health ขึ้นแถวเต็มขวาง · **Bottom nav 5 tab** · Map 280px |
| < 480 | Padding ลด · Font ลด · Sparkline ซ่อน · Header subtitle ซ่อน |

### Touch targets
- ปุ่มทุกอันมี hit area ≥ 38×38px (รวม `.icon-btn`, `.bottom-nav-item`)
- Drawer มี backdrop เพื่อ tap-to-close
- `env(safe-area-inset-bottom)` รองรับ iPhone notch

### พฤติกรรมพิเศษบนมือถือ
- `.user-info` (Admin/Online text) ซ่อน เหลือแค่ avatar
- `.kpi-sparkline` ซ่อน (ประหยัดเนื้อที่)
- `.header-title p` (subtitle) ซ่อนใน < 480px
- Bottom nav 5 tab: Live · Events · Map · Stats · Alerts (badge)

---

## 🧪 Test Checklist

### Backend
- [ ] `curl /api/stats/summary` คืน 401 ถ้าไม่มี token
- [ ] `curl -H "Authorization: Bearer $TOKEN" /api/stats/summary` คืน JSON ครบ schema
- [ ] เปิด PostgreSQL log ดูว่า query ทำงานในรอบเดียว (Promise.all parallel)
- [ ] ตอบใน < 500ms (G1 ขนาด 200 กล้อง)
- [ ] ตรวจ `storage_used_bytes` ตรงกับ `df -h /` จริง
- [ ] กล้องที่ `lat IS NULL` ถูก filter ออกจาก `locations` (ไม่ throw)

### Frontend
- [ ] เปิด standalone — refresh dot สีแดง (mock data) ก่อน backend up
- [ ] หลัง backend up — refresh dot หาย (กลายเป็นเขียวจางๆ)
- [ ] ปิด browser tab → กลับมา → reload ทันที (visibilitychange)
- [ ] รอ 30 วินาทีโดยไม่กดอะไร → ค่า update เอง
- [ ] Resize window จาก desktop → mobile → bottom nav โผล่ · sidebar หาย
- [ ] กด hamburger → sidebar เลื่อนเข้า + backdrop คลุม · tap backdrop → ปิด
- [ ] map heatmap renders + auto-fit ตาม camera extent
- [ ] Live events thumbnails โหลด snapshot จริงด้วย Bearer token

### Auth
- [ ] Token หมดอายุ → API คืน 401 → page ไป redirect login (ถ้า dashboard.js handle)
- [ ] localStorage `dojojin_token` ใส่ใน `Authorization: Bearer` header ทุก request

---

## ⚠️ Known Pitfalls

1. **CSS specificity ชนกับ dashboard เดิม**
   `dashboard/index.html` อาจมี `.panel`, `.kpi-card` อยู่แล้ว — scope ด้วย `#page-summary` หรือเปลี่ยนชื่อเป็น `.es-panel`, `.es-kpi-card`

2. **OpenLayers เวอร์ชันไม่ตรงกับ dashboard เดิม**
   ระบบเดิมใช้ OpenLayers 9 — ใน HTML ผมก็ใช้ 9.2.4 ตรงกัน ไม่ต้องโหลดซ้ำถ้า integrate

3. **Chart.js global config ชนกัน**
   ผมใส่ `Chart.defaults.color = '#8093ad'` เป็น global — ถ้า page อื่นต้องการสีอื่นต้องใช้ `options` per-chart แทน

4. **`requireAuth` middleware**
   ถ้าระบบเดิมใช้ global auth middleware (`app.use(authMiddleware)` ก่อน routes) ก็ไม่ต้องส่ง requireAuth — ส่ง `(req, res, next) => next()` ไปก็ได้

5. **MQTT connected status**
   `mqtt-subscriber.js` รันคนละ process — `api-server.js` ไม่รู้ status ของ MQTT จริง 2 ทางออก:
   - (เร็ว) hard-code `() => true`
   - (ถูกต้อง) เพิ่ม table `system_status` ให้ subscriber update heartbeat ทุก 30s · api อ่านมา check

6. **Storage path resolution**
   `df -k snapshots/` บางทีคืน relative path → ใช้ `path.resolve(snapshotsPath)` ก่อนส่งให้ execSync

7. **Snapshot live URL CORS**
   `<img src="/api/snapshot/live/..." />` ต้องการ Bearer header — บน web ถ้า cookie auth ทำงาน OK · แต่บน mobile (Safari ITP) อาจต้อง preload เป็น blob URL (ดู mobile app CLAUDE.md)

---

## 🎯 Next Steps แนะนำ

หลังจาก integrate เสร็จ ค่อยทำ:

1. **System status endpoint แยก** — `/api/system/health` คืน MQTT/DB/disk จริงจาก subscriber → api shared state
2. **WebSocket push** สำหรับ KPI live update (แทน 30s polling) — แต่ polling ก็ OK สำหรับ Executive Summary (ไม่ใช่ critical path)
3. **PDF export ของ Executive Summary** — jsPDF + html2canvas (มีใน stack แล้ว) → "Daily Executive Report"
4. **Filter by time range** — pulldown "Today / This Week / This Month" → endpoint รับ `?period=week`
5. **Drill-down on KPI click** — กด "Alerts" card → navigate ไป Alerts page filter date=today

---

<sub>End of INTEGRATION.md · Generated for Vigil Platform v1.0.0+</sub>
