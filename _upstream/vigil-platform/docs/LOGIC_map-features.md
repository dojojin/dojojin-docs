// ============================================================
// DojoJin Tech Dashboard — LOGIC_map-features
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

# LOGIC_map-features — DojoJin Tech Dashboard

> Feature logic — หน้าแผนที่ (Map page): OpenLayers, camera grouping
> multi-color overlay, Live Pulse (Toast-on-map), และ improvement backlog.
> Known bugs → GOTCHAS.md · Pending work pointer → ROADMAP.md
>
> Last updated: 2026-05-28 · relates to decisions #155, #156, #161, #168

---

## สิ่งที่มีอยู่แล้ว (Verified 2026-05-28)

### Map page architecture

| ส่วน | ที่ไหน | หมายเหตุ |
|---|---|---|
| `ol.Map` init | `dashboard.js:2733` (`initMap()`) | OpenLayers map object |
| Heatmap layer | `mapLayers._heatLayer` (`ol.layer.Heatmap`) | Heat point per event in 24h |
| Camera marker source | `mapLayers._camRawSrc` (`ol.source.Vector`) | Single source — ต้องเปลี่ยนสำหรับ multi-group |
| Map refresh | `dashboard.js:3007` (`refreshMap()`) | เรียกทุกครั้งที่ group filter เปลี่ยน |
| Popup | `showCamPopup()` | async fetch on-demand (fixed GOTCHAS #53) |
| WS real-time | `dashboard.js:772` (`new_event` branch) | fires per event from broker |
| Corner toast | `dashboard.js:832` (`queueToast()`) | bottom-right notification ที่มีอยู่แล้ว |

### Group filtering (ครบแล้ว — ขาดแค่ UI ใหม่)

- `activeGroupId` (dashboard.js:129) — default `'all'`
- `getActiveGroupCameras()` (dashboard.js:472) — คืน **ทุก camera** เมื่อ `activeGroupId === 'all'`; filtered ตาม group ที่เลือก
- `refreshMap()` เรียก `getActiveGroupCameras()` อยู่แล้ว — **filter logic ครบ 100% ไม่ต้องแตะ**
- `camera_groups.color` (hex) มีใน DB + load ใน `groups[]` array — พร้อมใช้เป็น marker color

### Heatmap API

- `GET /api/heatmap?hours=24` — **ไม่รับ group filter param** — client-side filter เพียงพอ (ไม่แตะ server ในรอบนี้, decision #155)

---

## Improvement Backlog

| ID | Feature | Effort | Status |
|---|---|---|---|
| A | Group switcher chip bar (Option A) | XS | Superseded by B |
| **B** | **Multi-group color-coded overlay** (decision #155) | M | **Done 2026-05-28** |
| **C** | **Live Pulse / Toast-on-map T2** (decision #156) | M | **Done 2026-05-28** |
| D | Time range picker for heatmap (24h / 7d / custom) | S | Backlog |
| E | Click-through marker → Events page filtered by camera | S | Backlog |
| F | Search / jump-to-camera on map | S | Backlog |
| **G** | **FIT button — recenter view to visible cameras** | XS | **Done 2026-05-28** |
| H | Uptime overlay (marker color = online/offline state) | M | Backlog |
| **I** | **Wall Mode toggle — full-screen video wall** (decision #161) | XS | **Done 2026-05-28** |
| **J** | **Legend Scaling — Tier 2 Auto-adapt** | S | **Done 2026-05-28** |
| **K** | **Map controls responsive — Primary/Secondary split** (decision #168) | S | **Done 2026-05-28** |
| **L** | **Map Settings page — token UI + tile manager ใน Settings** (decision #171) | M | **Done 2026-05-29** |

---

## B. Camera Grouping → Multi-Group Color Overlay (decision #155)

**Status:** Done 2026-05-28 — commits `a06b33f` `e37ef58`

### Implementation Plan (7 steps)

1. **`refreshMap()`** — วน loop กล้อง **ทุก camera** (ไม่ใช่ `getActiveGroupCameras()`) — filter `!hiddenGroupIds.has(c.group_id)` ในลูปเดียวกัน — เพิ่ม property `group_color` + `group_id` ใน `ol.Feature` แต่ละตัว
2. **`camMarkerStyle` single marker** — fill = online/offline (`#22c55e` / `#94a3b8`) · stroke = `group_color` (fallback `#94a3b8` ถ้าไม่มี group)
3. **`camMarkerStyle` cluster** — fill ยังเป็น online-mix (`green/amber/gray`) · stroke = group color ถ้า cluster มาจาก group เดียว (`Set(group_ids).size === 1`) else `#64748b` neutral
4. **Legend panel overlay** — chips ชื่อ group + color swatch + checkbox toggle — state: `hiddenGroupIds = new Set()` — toggle → เรียก `refreshMap()` ใหม่ (clear + repopulate `_camRawSrc` ผ่าน flow เดิม — ห้าม mutate source แยกนอก `refreshMap()`)
5. **Stats bar** (ONLINE / OFFLINE / EVENTS 24H) — filter `!hiddenGroupIds.has(c.group_id)` ก่อนคำนวณ (ungrouped = นับเสมอ)
6. **Heatmap heat points** — คำนวณเฉพาะกล้องใน visible groups + ungrouped
7. **Controls ทั้งหมด** — SVG sprite (`currentColor`) ห้าม emoji (decision #143) · ไม่แตะ server `/api/heatmap`

### Decisions (resolved 2026-05-28)

| Gap | Decision |
|---|---|
| Cluster color เมื่อมาจากหลาย group | stroke = group color ถ้า single-group cluster; `#64748b` ถ้า mix |
| Toggle hidden mechanic | clear + repopulate ผ่าน `refreshMap()` (ไม่ใช่ `feature.set('hidden')` — ไม่ทำงานกับ OL Cluster) |
| Online/offline indicator | **fill** = online/offline · **stroke** = group color (ไม่สูญเสีย status indicator) |
| Cameras ที่ไม่มี group (`group_id IS NULL`) | ไม่มี chip ใน legend · **แสดงเสมอ ไม่ซ่อนตาม legend** · stroke fallback = `#94a3b8` |

### Constraints

- WCAG AA: user-picked hex → stroke only ไม่ใช่ solid fill (fill ยึด semantic green/gray)
- Toggle group off → ออกจากทั้ง stats bar + heatmap (ไม่ใช่แค่ dim marker)
- Single source of truth: `refreshMap()` เท่านั้น — ห้าม toggle handler mutate `_camRawSrc` โดยตรง
- SVG-only controls

---

## C. Live Pulse — Toast-on-Map (decision #156)

**Selected: T2** — toggle on/off + debounce per `camera_id`
**เหตุผล:** sites zone < 100 cameras; T1 (toggle only) ยังฟ้าผ่าจาก bursty cam; T3 (global debounce) suppress CAM-B เพราะ CAM-A เพิ่งยิง — per-camera debounce ถูกต้องที่สุด

### Visual Design

```
┌─ map ─────────────────────────────────────────┐
│                     📍 CAM-03                  │
│              ┌─────────────────┐               │
│              │ [thumbnail 80px]│               │
│              │ Cam-03 · Zone B │               │
│              │ Motion detected │               │
│              │ +2 more         │ ← bump mode   │
│              └─────────────────┘               │
│                      ↑ 5px above marker        │
└────────────────────────────────────────────────┘
```

- Card flip: marker ใน top 20% viewport → card วางใต้ marker แทน
- Max 6 concurrent cards — evict oldest (insertion order) เมื่อล้น
- Snapshot thumbnail: `?w=80` (thumbnail layer, decision #125)
- Fade out: 5s หลัง event ล่าสุด (bump รีเซ็ต timer)

### State

```javascript
// ใน dashboard.js scope
const _mapPulseState = new Map();
// camera_id → { el, lastAt, bumpCount, timeoutId }

let _mapPulseOn = JSON.parse(localStorage.getItem('mapLivePulseOn') ?? 'true');
let _mapPulseDebounceMs = parseInt(
  localStorage.getItem('mapLivePulseDebounceMs') || '15000', 10
);
```

### WS Integration (เพิ่มใน dashboard.js:772 `new_event` branch)

```javascript
// AFTER existing queueToast() call — additive, ไม่แทนที่
if (currentPage === 'map' && _mapPulseOn) {
  _handleMapPulse(event);
}
```

**`_handleMapPulse(event)` logic:**

1. Bail ถ้า camera ไม่อยู่ใน visible groups (`hiddenGroupIds` เมื่อ Option B landed; ทุก cam ก่อนนั้น)
2. หา `ol.Feature` สำหรับ `camera_id` → pixel ผ่าน `map.getPixelFromCoordinate(feat.getGeometry().getCoordinates())`
3. ถ้า `_mapPulseState.has(camera_id)` AND `Date.now() - state.lastAt < _mapPulseDebounceMs` → **bump**: เพิ่ม count, update "+N more" text, reset 5s timeout, update `lastAt`
4. ไม่งั้น → สร้าง card ใหม่ `<div class="map-pulse-card">`, inject ใน `#mapContainer`, start timeout, register ใน `_mapPulseState`
5. ถ้า concurrent cards ≥ 6 → remove entry แรกสุดใน Map

**Suppress conditions:**

- `currentPage !== 'map'`
- `!_mapPulseOn`
- ไม่เจอ marker feature สำหรับ `camera_id`
- `#mapPopup` visible AND card จะทับ → skip

### Controls (map toolbar — SVG sprite ทั้งหมด ห้าม emoji)

```html
<!-- toggle -->
<button id="btnMapPulse" title="Live Events on Map"
        aria-pressed="true" class="map-toolbar-btn">
  <svg><!-- lightning bolt --></svg>
</button>

<!-- debounce dropdown -->
<select id="selMapPulseDebounce" class="map-toolbar-select">
  <option value="5000">5s</option>
  <option value="15000" selected>15s</option>
  <option value="30000">30s</option>
  <option value="60000">60s</option>
</select>
```

ทั้งคู่ persist ใน `localStorage` (`mapLivePulseOn`, `mapLivePulseDebounceMs`).

### Snapshot URL pattern

WS `new_event` payload ส่ง `snapshot_filename` (หลัง migration 025):

```javascript
const snapUrl = event.snapshot_filename
  ? `${API}/snapshots/${encodeURIComponent(event.snapshot_filename)}?w=80`
  : null;
// null → แสดง camera icon placeholder (ไม่ใช่ broken <img>)
```

### Bug Fixes — 2026-05-28 (post-spec)

| Bug | Root Cause | Fix |
|---|---|---|
| Live Pulse card ไม่มี snapshot | `_handleMapPulse` อ่าน `event.snapshot_filename` แต่ WS row ส่ง COALESCE result เป็น `snapshot_file` (alias ต่างกัน — api-server.js:963) | เปลี่ยนเป็น `event.snapshot_file \|\| event.snapshot_filename` (GOTCHAS #58) |
| WS event ถึง frontend ก่อน snapshot save | `pg_notify('new_event')` ยิงทันทีหลัง INSERT (line 548) ก่อน HTTP snapshot fetch (อาจใช้เวลา 1–3s) → `snapshot_file = null` เสมอ | ย้าย `pg_notify` ไปหลัง snapshot UPDATE ใน `mqtt-subscriber.js` — events ที่ไม่ต้องการ snapshot ยิง near-instantly, events ที่มี HTTP snapshot ช้า 1–3s (decision #163) |
| คลิก Live Pulse card ไม่มี action | card ไม่มี event handler | เพิ่ม `cursor:pointer` + `addEventListener('click', () => showSnapshot(event))` — เปิด `#snapModal` modal ทุกหน้า |
| Wall mode ซ่อนชื่อกลุ่มทั้งหมด | `body.map-wall-mode .ml-name { display:none }` | เปลี่ยนเป็น `font-size:9px; max-width:72px` — แสดงชื่อย่อแต่ไม่หาย |
| Wall mode zoom out ทุก 60s | `refreshMap()` ใน `setInterval(60s)` เรียก `getView().fit()` ทุกครั้ง แม้ใน wall mode | เพิ่ม `&& !_mapWallOn` guard ใน `refreshMap()` — data refresh ทำงานปกติ, viewport ไม่ขยับ (commit `962cb33`) |
| คลิก Live Pulse card ไม่มี action (pointer-events) | CSS `.map-pulse-card { pointer-events:none }` บล็อก click แม้เพิ่ม addEventListener แล้ว | `el.style.pointerEvents = 'auto'` ตอนสร้าง card (commit `8282c7d`) |
| Live Pulse ไม่มีรูปบน Dahua และ Hikvision | pg_notify ยิงก่อน snapshot ใน dahua-cgi.js + hikvision-isapi.js (ต่างจาก Bosch ที่แก้ไปแล้ว) | ขยาย decision #163 ครอบทั้ง 3 vendor — `dahua-cgi.js` await UPDATE ก่อน notify; `hikvision-isapi.js` notify ใน .then() chain (commit `c593b97`) |
| **Debounce dropdown ไม่มีผล (>5s ทุกค่าเหมือนกัน)** | `_removeMapPulseCard` ลบทั้ง DOM และ state entry ในตัว timer 5s เดียวกัน → bump check เจอ `existing = undefined` เสมอหลัง 5s ผ่าน → configurable window ทำงานไม่ได้ | แยกเป็น 2 timer: `fadeId` (5s, remove DOM เท่านั้น) + `expireId` (debounceMs, delete state); bump branch revive card กลับ DOM ถ้า el ไม่ connected แล้ว (2026-05-29) |
| **New card ปรากฏขณะ camera popup เปิดอยู่ (R7)** | ไม่มี popup suppress condition | เช็ค `popup.classList.contains('hidden')` ก่อนสร้าง card ใหม่ — bump ยังทำงานปกติ; CSS `rgba(13,20,34,0.95)` คง alpha ไว้ (2026-05-29) |

### Reproduce / Verify plan (Working Agreement #3)

**Browser devtools (fast iteration — UI ล้วน, ไม่ต้องใช้ backend):**

```javascript
// Simulate WS message ใน console ขณะอยู่หน้า Map:
ws.onmessage({ data: JSON.stringify({
  type: 'new_event',
  event: {
    camera_id: 'CAM-03',
    camera_name: 'Camera 03',
    rule_name: 'Motion',
    snapshot_filename: null,
    id: 99999
  }
})});
```

**Real MQTT publish (backend proof — ผ่าน ingest path จริง):**

```bash
# EMQX 5 — แทน topic ด้วย topic จริงของกล้อง
mosquitto_pub -h 127.0.0.1 -p 1883 \
  -t "bosch/BOSCH_8000i_01/onvif-ej/event" \
  -m '{"UtcTime":"2026-05-28T12:00:00Z","event_type":"FieldDetector/ObjectsInside","rule_name":"Zone A"}'
```

**Test matrix:**

| ID | Setup | Action | Expected |
|---|---|---|---|
| R1 | toggle=on, debounce=15s | 1 event สำหรับ CAM-A | Card ปรากฏเหนือ marker, fade ~5s |
| R2 | toggle=**off** | 1 event สำหรับ CAM-A | ไม่มี map card; **corner toast ยังทำงาน** |
| R3 | toggle=on, debounce=15s | 3 events สำหรับ CAM-A ภายใน 5s | **1 card** + "+2 more" badge (ไม่ใช่ 3 cards) |
| R4 | toggle=on, debounce=15s | CAM-A event, รอ 20s, CAM-A อีกครั้ง | card ที่ 2 = fresh card ไม่ใช่ bump |
| R5 | toggle=on | CAM-A + CAM-B ภายใน 1s | 2 cards แยกกัน |
| R6 | toggle=on, hide group via legend | event ของ camera ใน hidden group | ไม่มี card |
| R7 | toggle=on, popup เปิดอยู่บน marker เดียวกัน | event สำหรับ marker นั้น | card suppressed |
| R8 | toggle=on, marker ใกล้ขอบบน | event | card flip ใต้ marker (ไม่ clip ออกนอก viewport) |
| R9 | toggle=on, navigate ออกจากหน้า map | event | ไม่มี card; state reset เมื่อกลับมา `showPage('map')` |

**Regression checks หลัง implement:**

- `queueToast()` corner notification ไม่เปลี่ยน (R2 เช็คอยู่แล้ว)
- `showCamPopup()` async fetch ยังทำงาน (GOTCHAS #53)
- Option B group colors + legend ยังทำงานเมื่อ B ลงแล้ว

---

## I. Wall Mode — Video Wall Toggle (decision #161)

**Status:** Done 2026-05-28 — commit `d0049b6`

### What was built

| ส่วน | รายละเอียด |
|---|---|
| CSS class | `body.map-wall-mode` — ซ่อน `.sidebar`, `.topbar`, `.map-toolbar`, `.map-stats-bar`, `.grp-bar`; ขยาย `#map` → `100vh`; `border-radius: 0` |
| WALL button | ปุ่มใน map toolbar (SVG monitor icon) · `active` class เมื่อเปิด · persist `localStorage('mapWallMode')` |
| EXIT WALL button | `position: fixed` มุมบนขวา z-9999 · ปรากฏเฉพาะเมื่อ `body.map-wall-mode` active |
| Fullscreen API | `requestFullscreen()` เมื่อเปิด wall mode · `exitFullscreen()` เมื่อปิด (silent catch) |
| `showPage()` hook | ออกจาก map → `document.body.classList.remove('map-wall-mode')` ทันที (หน้าอื่น layout ปกติ) · กลับมา map → restore class ตาม `_mapWallOn` |
| OL resize | `map.updateSize()` ทุกครั้งหลัง class toggle |

### Design Decision (resolved 2026-05-28)

**Option 2 + Option 3 combined** — เหตุผล:
- Option 2 (CSS class toggle) ทำงานได้ทั้ง kiosk Chrome (`--kiosk`) และ normal browser
- Option 3 (Fullscreen API) เป็นของแถมไม่เสียอะไร — ซ่อน browser chrome บน workstation ทั่วไป
- ถ้า PC รัน `--kiosk` อยู่แล้ว → Fullscreen API ไม่มีผล แต่ก็ไม่ทำให้พัง (silent catch)
- Option 1 (CSS full-bleed ถาวร) = by-product ของ Option 2 เมื่อ wall mode on
- Option 4 (`/?wall=1` route) = overkill สำหรับ single-tenant video wall

### Constraints

- `_mapWallOn` persist ใน `localStorage` → ผู้ปฏิบัติงานไม่ต้อง toggle ทุกครั้งที่ refresh
- navigate ออกจาก map → class ถูกถอดเสมอ (ป้องกัน layout พังบนหน้าอื่น)
- กลับมา map → restore อัตโนมัติใน `showPage()` setTimeout block (หลัง OL init)

---

## J. Legend Scaling — Tier 2 Auto-adapt

**Status:** Done 2026-05-28

### Overview: 3 modes based on N = `groups.length`

N วัด ณ ขณะเรียก `renderMapLegend()` — **ใช้ `groups.length` เสมอ ไม่ใช่จำนวนหลัง search filter** (ป้องกัน mode flip ขณะพิมพ์ค้นหา)

| N | Mode | Behavior |
|---|---|---|
| < 6 | **Overlay (compact)** | overlay ปัจจุบัน — ไม่มี controls เพิ่ม |
| 6–20 | **Overlay (scroll+controls)** | max-height:60vh scroll + search chip filter + hide-all + collapse header |
| > 20 | **Drawer** | trigger button ใน panel area; drawer overlay 280px slide จากซ้าย — **NOT push** (ไม่ต้อง `map.updateSize()`) |

### Architectural constraints

| Constraint | Rule |
|---|---|
| N = source of truth | `groups.length` ณ render entry — ไม่ใช่ `visGroups.length` หลัง filter |
| Search → legend UI only | `_legendSearch()` ห้ามเรียก `refreshMap()` — search เปลี่ยนแค่ว่า chip ไหน render |
| Drawer type | overlay (position:fixed) ไม่ใช่ push → ไม่ต้อง `map.updateSize()` |
| Ungrouped chip | display-only (ไม่มี checkbox) · auto-hide เมื่อ 0 ungrouped cameras บนแผนที่ · ungrouped markers visible เสมอ |
| Wall Mode compact | `body.map-wall-mode .ml-name { display:none }` — swatch only, ไม่มีชื่อ |
| SVG icons | inline SVG ห้าม emoji (decision #143) |
| Token colors | ทุก bg/border ใช้ CSS custom properties (`var(--surface)`, `var(--border)`, `var(--text)`, `var(--dim)`) |

### i18n keys ใหม่ — `dashboard/i18n.js`

เพิ่มใน **th block (~line 99)** และ **en block (~line 717)** ต่อจาก `map.events24hTip`:

```javascript
// th block
'map.legendSearch':   'ค้นหากลุ่ม',
'map.legendHideAll':  'ซ่อนทั้งหมด',
'map.legendShowAll':  'แสดงทั้งหมด',
'map.ungrouped':      'ไม่มีกลุ่ม',
'map.legendGroups':   'กลุ่ม',
'map.legendCollapse': 'ย่อ',
'map.legendExpand':   'ขยาย',

// en block
'map.legendSearch':   'Search groups',
'map.legendHideAll':  'Hide all',
'map.legendShowAll':  'Show all',
'map.ungrouped':      'Ungrouped',
'map.legendGroups':   'Groups',
'map.legendCollapse': 'Collapse',
'map.legendExpand':   'Expand',
```

### CSS ใหม่ — `dashboard/index.html`

เพิ่มใน `<style>` ต่อจาก block `.map-legend-panel` ที่มีอยู่แล้ว:

```css
/* --- Legend: Tier 1 controls (6≤N≤20) --- */
.ml-controls{display:flex;gap:4px;margin-bottom:6px;align-items:center;}
.ml-search{width:100%;padding:3px 6px;background:var(--surface2);border:1px solid var(--border);
  border-radius:4px;color:var(--text);font-size:11px;margin-bottom:6px;box-sizing:border-box;}
.ml-search::placeholder{color:var(--dim);}
.ml-hide-all-btn,.ml-collapse-btn{font-size:10px;padding:2px 6px;background:var(--surface2);
  border:1px solid var(--border);border-radius:3px;color:var(--text);cursor:pointer;}
.ml-collapse-btn{margin-left:auto;}
.ml-chips-wrap.scrollable{max-height:60vh;overflow-y:auto;}
.ml-chips-wrap.collapsed{display:none;}
/* --- Ungrouped chip (display-only) --- */
.ml-chip-ungroup{pointer-events:none;opacity:0.65;font-style:italic;}
/* --- Legend: Tier 2 Drawer (N>20) --- */
.map-legend-drawer{position:fixed;top:0;left:0;width:280px;height:100vh;
  background:var(--surface);border-right:1px solid var(--border);
  z-index:900;transform:translateX(-100%);transition:transform .2s ease;
  overflow-y:auto;padding:12px;box-sizing:border-box;}
.map-legend-drawer.open{transform:translateX(0);}
.map-legend-drawer-backdrop{position:fixed;inset:0;z-index:899;display:none;}
.map-legend-drawer.open+.map-legend-drawer-backdrop{display:block;}
.map-legend-drawer-btn{display:flex;align-items:center;gap:6px;font-size:11px;
  padding:4px 8px;background:var(--surface2);border:1px solid var(--border);
  border-radius:4px;cursor:pointer;color:var(--text);}
/* --- Wall mode compact --- */
body.map-wall-mode .ml-name{display:none;}
body.map-wall-mode .map-legend-panel{gap:3px;}
```

### HTML ใหม่ — `dashboard/index.html` ใน `<div id="mapContainer">`

เพิ่มสองบรรทัดนี้ภายใน `<div id="mapContainer">` (ต่อจาก `#mapLegendPanel` หรือก่อนปิด `</div>`):

```html
<div id="mapLegendDrawer" class="map-legend-drawer"></div>
<div class="map-legend-drawer-backdrop" onclick="toggleMapDrawer()"></div>
```

### `dashboard.js` — ฟังก์ชันที่ต้องแก้

#### 1. `renderMapLegend()` — lines 3110–3129 — full rewrite

```javascript
function renderMapLegend() {
  const el = document.getElementById('mapLegendPanel');
  if (!el) return;
  const grpBar = document.getElementById('grpBarMap');
  if (grpBar) grpBar.style.display = groups.length > 0 ? 'none' : '';

  const N = groups.length;

  // Ungrouped = cameras with coords not in any group
  const groupedCamIds = new Set(groups.flatMap(g => g.cameraIds || []));
  const ungroupedCount = cameras.filter(c => c.latitude && c.longitude && !groupedCamIds.has(c.camera_id)).length;

  if (N === 0 && ungroupedCount === 0) { el.innerHTML = ''; return; }

  // Mode threshold: measure on total N, NOT on search-filtered count
  const mode = N < 6 ? 'compact' : N <= 20 ? 'scroll' : 'drawer';

  const q = (el.dataset.legendQ || '').toLowerCase();
  const collapsed = el.dataset.legendCollapsed === '1';
  const allHidden = N > 0 && groups.every(g => hiddenGroupIds.has(g.id));

  // Search filters chip display only — does NOT affect hiddenGroupIds or refreshMap()
  const visGroups = q ? groups.filter(g => g.name.toLowerCase().includes(q)) : groups;

  const chipsHtml = visGroups.map(g => {
    const hidden = hiddenGroupIds.has(g.id);
    const swatch = g.color || '#94a3b8';
    return `<label class="ml-chip${hidden ? ' ml-chip-off' : ''}">
      <input type="checkbox" ${hidden ? '' : 'checked'} onchange="toggleMapGroup('${g.id}')">
      <span class="ml-swatch" style="background:${swatch}"></span>
      <span class="ml-name">${escapeHtml(g.name)}</span>
    </label>`;
  }).join('');

  const ungroupedChip = ungroupedCount > 0
    ? `<div class="ml-chip ml-chip-ungroup">
        <span class="ml-swatch" style="background:#94a3b8"></span>
        <span class="ml-name">${I18N.t('map.ungrouped')} (${ungroupedCount})</span>
       </div>`
    : '';

  if (mode === 'drawer') {
    // Panel = trigger button only; chips live inside drawer
    el.innerHTML = `<button class="map-legend-drawer-btn" onclick="toggleMapDrawer()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
      ${I18N.t('map.legendGroups')} (${N})
    </button>`;
    const drawer = document.getElementById('mapLegendDrawer');
    if (drawer) {
      drawer.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div class="ml-title">${I18N.t('map.legendGroups')}</div>
          <button onclick="toggleMapDrawer()" style="background:none;border:none;cursor:pointer;color:var(--text);font-size:14px;">&#x2715;</button>
        </div>
        <input class="ml-search" type="search" placeholder="${I18N.t('map.legendSearch')}" value="${escapeHtml(q)}" oninput="_legendSearch(this.value)">
        <div class="ml-controls">
          <button class="ml-hide-all-btn" onclick="${allHidden ? '_legendShowAll()' : '_legendHideAll()'}">${I18N.t(allHidden ? 'map.legendShowAll' : 'map.legendHideAll')}</button>
        </div>
        <div class="ml-chips-wrap scrollable">${chipsHtml}${ungroupedChip}</div>`;
    }
    return;
  }

  // Overlay modes (compact / scroll)
  const showControls = mode === 'scroll';
  el.innerHTML = `
    <div class="ml-title" style="display:flex;align-items:center;justify-content:space-between;">
      <span>Groups</span>
      ${showControls ? `<button class="ml-collapse-btn" onclick="_legendCollapse()">${I18N.t(collapsed ? 'map.legendExpand' : 'map.legendCollapse')}</button>` : ''}
    </div>
    ${showControls ? `<input class="ml-search" type="search" placeholder="${I18N.t('map.legendSearch')}" value="${escapeHtml(q)}" oninput="_legendSearch(this.value)">` : ''}
    ${showControls ? `<div class="ml-controls">
      <button class="ml-hide-all-btn" onclick="${allHidden ? '_legendShowAll()' : '_legendHideAll()'}">${I18N.t(allHidden ? 'map.legendShowAll' : 'map.legendHideAll')}</button>
    </div>` : ''}
    <div class="ml-chips-wrap${mode === 'scroll' ? ' scrollable' : ''}${collapsed ? ' collapsed' : ''}">
      ${chipsHtml}${ungroupedChip}
    </div>`;
}
```

#### 2. New helper functions — เพิ่มต่อจาก `toggleMapGroup()` (after line 3136)

```javascript
function _legendSearch(q) {
  const el = document.getElementById('mapLegendPanel');
  if (el) { el.dataset.legendQ = q; renderMapLegend(); }
  // NO refreshMap() — search is legend-UI-only, does not affect map markers
}

function _legendHideAll() {
  groups.forEach(g => hiddenGroupIds.add(g.id));
  renderMapLegend();
  refreshMap();
}

function _legendShowAll() {
  hiddenGroupIds.clear();
  renderMapLegend();
  refreshMap();
}

function _legendCollapse() {
  const el = document.getElementById('mapLegendPanel');
  if (!el) return;
  el.dataset.legendCollapsed = el.dataset.legendCollapsed === '1' ? '0' : '1';
  renderMapLegend();
}

function toggleMapDrawer() {
  const drawer = document.getElementById('mapLegendDrawer');
  if (!drawer) return;
  const opening = !drawer.classList.contains('open');
  drawer.classList.toggle('open');
  // Re-render drawer content when opening (picks up latest hiddenGroupIds state)
  if (opening) renderMapLegend();
}
```

#### 3. `toggleMapGroup()` (lines 3131–3136) — **ไม่ต้องแก้ไข**

#### 4. `showPage()` / `refreshMap()` — **ไม่ต้องแก้ไข** (ไม่มี drawer state ที่ต้อง restore)

### Verify matrix (Working Agreement #3)

| Test | N | Action | Expected |
|---|---|---|---|
| T1 | 3 | render | Overlay compact, ไม่มี search/controls |
| T2 | 8 | render | Overlay + search bar + hide-all + collapse |
| T3 | 8 | พิมพ์ search | Chips filter — แผนที่ไม่เปลี่ยน (no refreshMap) |
| T4 | 8 | hide-all → show-all | ทุก group hidden → restored; แผนที่ update ทั้งคู่ |
| T5 | 8 | collapse | chips ซ่อน; expand กลับ |
| T6 | 25 | render | Panel = trigger button เท่านั้น, drawer ยังปิด |
| T7 | 25 | click trigger | Drawer slide เข้า 280px; แผนที่ไม่ขยับ |
| T8 | 25 | click backdrop | Drawer ปิด |
| T9 | any | wall mode on | `.ml-name` ซ่อน, swatch เท่านั้น |
| T10 | >0, 0 ungrouped | render | ไม่มี ungrouped chip |
| T11 | >0, M ungrouped | render | ungrouped chip "ไม่มีกลุ่ม (M)", ไม่มี checkbox, แผนที่ไม่เปลี่ยน |

---

## Known Issues / Bugs (Map Page)

| # | อาการ | Status |
|---|---|---|
| GOTCHAS #53 | `showCamPopup` top-rules ว่างเปล่าเมื่อเปิด Map โดยไม่ผ่านหน้า Events ก่อน (ใช้ `allEvents[]` ที่ยังว่าง) | **Fixed 2026-05-28** — async on-demand fetch |

**Rule จาก #53:** อย่าใช้ in-memory page buffer (`allEvents`, `allSnapshots` ฯลฯ) ใน context ที่ user อาจไม่ได้เปิดหน้านั้นก่อน — fetch on-demand แทนเสมอ

---

## K. Map Controls Responsive — Primary/Secondary Split (decision #168)

**Status:** Done 2026-05-28

### Problem

11 ปุ่ม + 1 select ใน `.map-controls` → wrap หลาย row บน iPhone 375px, กินพื้นที่แนวตั้งมากเกินไป ไม่มี hierarchy ชัดเจน

### Solution: Option B — Primary/Secondary rows

| กลุ่ม | ปุ่ม | Visibility |
|---|---|---|
| Primary | HEATMAP, CAMERAS, LIVE, debounce-select, FACE, FIT | แสดงเสมอ |
| Secondary | STREETS, CARTO, ONLINE, MANAGE, WALL | ≥769px แสดงเสมอ; ≤768px collapse |
| Chevron `.map-more-btn` | SVG ▾/▴ toggle | ≤768px เท่านั้น |

### Implementation

- HTML: `.map-toggle-primary` + `.map-toggle.map-sec#mapSecondary` — สอง div ใน `.map-controls`
- JS: `toggleMapSecondary()` — `sec.classList.toggle('open')` + aria-expanded + `.active` class บน chevron
- CSS (desktop ≥769px): ทั้ง 2 row แสดงตลอด; `.map-more-btn { display: none }`
- CSS (mobile ≤768px): `.map-controls .map-sec { display: none }` + `.map-controls .map-sec.open { display: flex }` + chevron `display: inline-flex !important`

### CSS Specificity Trap (สำคัญ)

`.map-sec` ใช้ class `.map-toggle` ด้วย ซึ่ง defined ที่ line 627 ของ `index.html`:

```css
.map-toggle { display: flex; ... }  /* line 627 — หลัง @media block */
```

@media block อยู่ที่ line 351 (ก่อน line 627) — specificity เท่ากัน (0,1,0) → base rule ที่มาทีหลัง **ชนะ** → `.map-sec { display: none }` ใน @media ถูก override

**Fix:** ใช้ selector `.map-controls .map-sec` (specificity 0,2,0) ใน @media block ให้สูงกว่า `.map-toggle` (0,1,0)

### 4 Small Fixes พร้อมกัน

| จุด | Fix | เหตุผล |
|---|---|---|
| `.map-stats-bar` | `flex-wrap:wrap; gap:8px; .ms-val{font-size:14px!important}` @ ≤768px | ป้องกัน overflow; `!important` เพราะ `.ms-val{font-size:16px}` มา later ใน source |
| `.map-popup` | `min-width:200px; max-width:min(240px,85vw)` | กัน popup ตัดขอบจอ |
| `.map-legend-drawer` | `max-width:90vw` | กัน drawer (280px) ล้น iPhone SE 320px |
| `.map-toolbar-sub` | `display:none` @ ≤768px | ประหยัดพื้นที่ (camera count อยู่ใน stats bar ด้านล่าง) |

### Breakpoints

| Viewport | Secondary row | Chevron | map-controls position |
|---|---|---|---|
| ≤768px (phone + iPad portrait) | collapse (toggle) | แสดง | static (ด้านล่าง map) |
| 769–1024px (iPad landscape) | แสดงเสมอ (2 rows) | ซ่อน | absolute overlay |
| >1024px (desktop) | แสดงเสมอ (2 rows) | ซ่อน | absolute overlay |

---

## STUBBORN_FACT

> `STUBBORN_FACT (Map)`: `/api/heatmap` ไม่มี group filter param — group filtering เป็น client-side เท่านั้น อย่าเพิ่ม server-side group param จนกว่า Option B client-side filter จะพิสูจน์แล้วว่าไม่พอ — decision #155.

> `STUBBORN_FACT (Map)`: Toast-on-map (Live Pulse) state เป็น per `camera_id` ไม่ใช่ global — per-camera debounce ป้องกัน CAM-B ถูก suppress เพราะ CAM-A เพิ่งยิง — decision #156. **State entry อยู่ได้นาน `_mapPulseDebounceMs` หลัง event ล่าสุด; DOM element fade ออกหลัง 5s แต่ state ยังอยู่ — ระวังอย่าเอา `_mapPulseState.size` ไป infer "visible cards" (2026-05-29 two-timer fix).**

> `STUBBORN_FACT (Map Responsive)`: @media rules ที่อยู่ **ก่อน** base CSS definitions ใน source order จะแพ้ถ้า specificity เท่ากัน — ต้องใช้ selector ที่ specificity สูงกว่า (เช่น `.map-controls .map-sec` แทน `.map-sec`) หรือ `!important` — decision #168.

---

## L. Map Settings Page (decision #171)

**Status:** Done 2026-05-29 — migration 029, commits in session 2026-05-29

### เหตุผล (Why)

- MANAGE button (tile download/area/clear) เป็น admin config action แต่วางอยู่ใน map toolbar (operational) — ผิดที่
- Mapbox token ตั้งค่าผ่าน `src/.env` → ต้อง ssh + แก้ไฟล์ + restart ทุกครั้ง — white-label ลูกค้าทำเองไม่ได้
- ปุ่ม OFFLINE ควร disabled เมื่อไม่มี cache แทนที่จะเงียบใช้ online อยู่เงียบๆ

### สิ่งที่จะเปลี่ยน (ภาพรวม)

| ตอนนี้ | หลังทำ |
|---|---|
| MANAGE button ใน map secondary toolbar | ย้ายไป **Settings → แผนที่** |
| Mapbox token ใน `src/.env` | เก็บใน `system_settings` DB, แก้ได้จาก UI (admin) |
| ปุ่ม OFFLINE — ใช้ได้เสมอ | **disabled + tooltip** เมื่อ `cachedTiles === 0` |
| ไม่มีหน้า Map Settings | sub-tab ใหม่ใน Settings rail |

---

### Phase 0 — อ่านก่อนแตะโค้ด

ก่อนเขียนอะไรให้ตรวจ 5 จุด:

1. **`db/init.sql`** — หา `system_settings` table schema (key/value หรือ typed columns?)
2. **endpoint เดิมที่ write `system_settings`** (brand name/logo) — grep `system_settings` ใน `api-server.js` → copy pattern นั้นทุกขั้นตอน
3. **`dashboard/index.html:2492`** — Settings page ใช้ `.srail-item` + `settingsNav(key, el)` → map sub-section = `data-sec="map"`, `id="set-map"` ตาม pattern เดิม
4. **`dashboard.js:6346`** — ดู `camerasSubTab()` เป็น reference สำหรับ sub-tab switching pattern ภายใน section (ถ้าจะทำ sub-tab ใน Map Settings)
5. **`src/api-server.js:1242`** — `/api/config` endpoint เดิม (ที่คืน `mapboxToken`) → จะ extend ไม่ใช่เขียนใหม่

**Verify ก่อน Phase 1:** `system_settings` เป็น key/value (`key TEXT PRIMARY KEY, value TEXT`) ไหม — ถ้าใช่ migration เป็น INSERT row; ถ้าเป็น typed schema ต้องออกแบบ migration ใหม่

---

### Phase 1 — Backend

**ไฟล์:** `db/db_migration_<NNN>_map_settings.sql`, `src/api-server.js`

#### 1a. Migration

```sql
-- idempotent — ถ้า row มีอยู่แล้วไม่ทำอะไร
INSERT INTO system_settings (key, value)
VALUES ('mapbox_token', '')
ON CONFLICT (key) DO NOTHING;
```

#### 1b. แก้ `/api/config` (api-server.js:1242)

เดิม:
```javascript
mapboxToken: process.env.MAPBOX_TOKEN || '',
mapboxAvailable: !!process.env.MAPBOX_TOKEN,
```

ใหม่ — อ่าน DB-first, fallback env (cache ใน module-level variable, invalidate เมื่อ save):

```javascript
// module-level (ใกล้ส่วน top ของ api-server.js)
let _cachedMapboxToken = null;
async function getMapboxToken() {
  if (_cachedMapboxToken !== null) return _cachedMapboxToken;
  try {
    const r = await pool.query("SELECT value FROM system_settings WHERE key='mapbox_token'");
    _cachedMapboxToken = r.rows[0]?.value || process.env.MAPBOX_TOKEN || '';
  } catch { _cachedMapboxToken = process.env.MAPBOX_TOKEN || ''; }
  return _cachedMapboxToken;
}

// ใน /api/config handler — เปลี่ยนเป็น async:
const mapboxToken = await getMapboxToken();
// mapboxToken: mapboxToken,
// mapboxAvailable: !!mapboxToken,
```

#### 1c. Endpoint ใหม่ `PUT /api/settings/map` (admin-only)

```javascript
app.put('/api/settings/map', auth.requireAdmin, async (req, res) => {
  const { mapboxToken } = req.body;
  // validate: empty string OK; ถ้าไม่ว่างต้องเป็น pk. เท่านั้น (ห้าม sk.)
  if (mapboxToken && !/^pk\.[A-Za-z0-9._-]+$/.test(mapboxToken)) {
    return res.status(400).json({ error: 'invalid_token_format' });
  }
  await pool.query(
    "INSERT INTO system_settings(key,value) VALUES('mapbox_token',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
    [mapboxToken || '']
  );
  _cachedMapboxToken = null; // invalidate cache
  // SEC-003: ห้ามคืน token กลับมา
  res.json({ success: true });
});
```

**Auth:** `requireAdmin` — pattern เดียวกับ `/api/cameras` write operations
**Validation:** `/^pk\.[A-Za-z0-9._-]+$/` กัน `sk.` secret token หลุดเข้า DB
**Audit log:** เพิ่ม log event `'map_settings_token_update'` (ไม่ log ค่า token — SEC-003)

---

### Phase 2 — Frontend

**ไฟล์:** `dashboard/index.html`, `dashboard/dashboard.js`, `dashboard/i18n.js`

#### 2a. Settings rail — HTML (`index.html:2501` หรือหลัง backup item)

```html
<div class="srail-item" data-sec="map" onclick="settingsNav('map',this)">
  <span>🗺️</span><span data-i18n="set.map">แผนที่</span>
</div>
```

> หมายเหตุ: emoji ใน srail-item เป็น legacy pattern ที่มีอยู่แล้ว — อย่า sweep, ใส่ตามให้ consistent

#### 2b. Settings section — HTML (ต่อจาก `#set-backup`)

```html
<div class="settings-section" id="set-map">
  <!-- ── Section: Mapbox Token ── -->
  <div class="card" style="margin-bottom:16px">
    <h3 class="card-title" data-i18n="set.mapboxTokenTitle">Mapbox Token</h3>
    <p style="font-size:12px;color:var(--dim);margin:0 0 10px" data-i18n="set.mapboxTokenHint">
      ใช้สำหรับแผนที่ละเอียด (POI, ถนนสาย minor) · ฟรี 50,000 tile loads/เดือน
    </p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="password" id="fldMapboxToken" class="form-input"
             placeholder="pk.eyJ1Ij..." style="flex:1;min-width:200px;font-family:monospace">
      <button class="btn btn-secondary" type="button" onclick="toggleMapboxTokenVis()"
              data-i18n="set.showToken">แสดง</button>
      <button class="btn btn-primary" type="button" onclick="saveMapboxToken()"
              data-i18n="set.saveToken">บันทึก</button>
    </div>
    <div id="mapboxTokenMsg" style="font-size:11px;margin-top:6px"></div>
    <a href="https://account.mapbox.com/statistics/" target="_blank" rel="noopener"
       style="font-size:11px;color:var(--accent);display:inline-block;margin-top:8px"
       data-i18n="set.viewMapboxStats">ดูสถิติการใช้งานบน Mapbox →</a>
  </div>

  <!-- ── Section: Offline Tile Manager ── -->
  <div class="card">
    <h3 class="card-title" data-i18n="set.tileManager">จัดการแผนที่ Offline</h3>
    <!-- เนื้อหาจาก #mapMgrModal เดิม ย้ายมาวางตรงนี้ (ไม่ใช่ modal แล้ว) -->
    <!-- โหลด + render ผ่าน loadMapMgrPanel() ตอน settingsNav('map') -->
    <div id="mapMgrPanelContent"></div>
  </div>
</div>
```

#### 2c. JS — ฟังก์ชันที่ต้องเพิ่มใน `dashboard.js`

```javascript
// ── Map Settings ─────────────────────────────────────────────
async function onShowMapSettings() {
  // โหลด token เดิมมาแสดงใน input (อ่านจาก /api/config ที่ load แล้ว)
  const tok = mapLayers._mapboxToken || '';
  const inp = document.getElementById('fldMapboxToken');
  if (inp) inp.value = tok;
  // โหลด tile manager panel (reuse existing mapMgr render functions)
  loadMapMgrPanel();
}

function toggleMapboxTokenVis() {
  const inp = document.getElementById('fldMapboxToken');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  const btn = inp.nextElementSibling; // show/hide button
  if (btn) btn.setAttribute('data-i18n', inp.type === 'password' ? 'set.showToken' : 'set.hideToken');
  I18N.apply(); // re-apply i18n on button
}

async function saveMapboxToken() {
  const inp = document.getElementById('fldMapboxToken');
  const msg = document.getElementById('mapboxTokenMsg');
  if (!inp || !msg) return;
  const val = inp.value.trim();
  msg.textContent = '';
  try {
    const r = await fetch(`${API}/api/settings/map`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapboxToken: val }),
    });
    const j = await r.json();
    if (!r.ok) {
      msg.style.color = 'var(--red)';
      msg.textContent = j.error === 'invalid_token_format'
        ? I18N.t('set.tokenInvalid') : (j.error || 'Error');
      return;
    }
    msg.style.color = 'var(--green)';
    msg.textContent = I18N.t('set.tokenSaved');
    // อัปเดต in-memory token + tile URLs โดยไม่ต้อง reload หน้า
    // (reuse loadMapboxToken() ที่มีอยู่ใน initMap — เรียกซ้ำได้)
    await reloadMapboxTokenFromConfig();
  } catch (e) {
    msg.style.color = 'var(--red)';
    msg.textContent = String(e);
  }
}

async function reloadMapboxTokenFromConfig() {
  // fetch /api/config ใหม่ แล้ว update mapLayers._mapboxToken + tileUrls (copy from initMap:2802)
  try {
    const r = await fetch(`${API}/api/config`);
    const cfg = await r.json();
    mapLayers._mapboxToken = cfg.mapboxToken || '';
    if (cfg.mapboxToken) {
      mapLayers._tileUrls.online.mapbox.streets =
        `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${cfg.mapboxToken}`;
      mapLayers._tileUrls.online.mapbox.light =
        `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}@2x?access_token=${cfg.mapboxToken}`;
    }
  } catch {}
}

function loadMapMgrPanel() {
  // Render tile manager content ใน #mapMgrPanelContent
  // reuse openMapMgr() logic แต่ target เป็น panel แทน modal
  // ดู dashboard.js:4879–4898 สำหรับ openMapMgr() เดิม
  if (!document.getElementById('mapMgrPanelContent')) return;
  initMapMgrPreview(); // เดิมเรียกใน openMapMgr()
  loadMapAreas();      // เดิมเรียกใน openMapMgr()
}
```

> **หมายเหตุสำคัญ:** `openMapMgr()` / `closeMapMgr()` เดิมยังคงอยู่จนกว่าจะ refactor ครบ
> ถ้า UX/UI review ตัดสินใจเปลี่ยน flow — แก้ที่ HTML/JS ตรงนี้เท่านั้น ไม่ต้องแตะ backend

#### 2d. Hook เข้า `settingsNav()` — ดูใน `dashboard.js` หา `settingsNav` function

```javascript
// เพิ่ม case 'map' ใน settingsNav() (หา function นี้ใน dashboard.js):
case 'map':
  onShowMapSettings();
  break;
```

#### 2e. ลบออกจาก map page

- `dashboard.js` — ลบ MANAGE button จาก secondary toolbar (`map-sec` div)
- `index.html` — ลบ `#mapMgrModal` HTML block ทั้งก้อน
- ฟังก์ชัน `openMapMgr()` / `closeMapMgr()` — refactor หลัง UX review ยืนยัน panel approach แล้ว

#### 2f. OFFLINE button — disabled เมื่อไม่มี cache

```javascript
// เพิ่มใน initMap() หรือ showPage('map') หลัง map init:
async function updateOfflineButtonState() {
  try {
    const r = await fetch(`${API}/api/map/areas`);
    const { cachedTiles } = await r.json();
    const btn = document.getElementById('togSource');
    if (!btn) return;
    const hasCache = cachedTiles > 0;
    btn.disabled = !hasCache;
    btn.title = hasCache
      ? I18N.t('map.tipSource')
      : I18N.t('map.offlineDisabledTooltip');
    // ถ้า disabled + currentSource เป็น offline → fallback online
    if (!hasCache && mapLayers._currentSource === 'offline') {
      mapLayers._currentSource = 'online';
      localStorage.setItem('mapSource', 'online');
      updateTileLayer('online', mapLayers._currentProvider);
    }
  } catch {}
}
// เรียกใน showPage('map') และหลัง clearCache() สำเร็จ
```

#### 2g. i18n keys ที่ต้องเพิ่ม — `dashboard/i18n.js`

เพิ่มใน **th block** และ **en block** ทั้งคู่ (GOTCHAS #42):

```javascript
// th
'set.map':                 'แผนที่',
'set.mapboxTokenTitle':    'Mapbox Token',
'set.mapboxTokenHint':     'ใช้สำหรับแผนที่ละเอียด · ฟรี 50,000 tile loads/เดือน',
'set.saveToken':           'บันทึก Token',
'set.showToken':           'แสดง',
'set.hideToken':           'ซ่อน',
'set.tokenSaved':          'บันทึก Token เรียบร้อย',
'set.tokenInvalid':        'Token ไม่ถูกต้อง — ต้องขึ้นต้นด้วย pk.',
'set.viewMapboxStats':     'ดูสถิติการใช้งานบน Mapbox →',
'set.tileManager':         'จัดการแผนที่ Offline',
'map.offlineDisabledTooltip': 'ไม่มี tile cache — ดาวน์โหลดได้ที่ Settings → แผนที่',

// en
'set.map':                 'Map',
'set.mapboxTokenTitle':    'Mapbox Token',
'set.mapboxTokenHint':     'For detailed map tiles · Free 50,000 tile loads/month',
'set.saveToken':           'Save Token',
'set.showToken':           'Show',
'set.hideToken':           'Hide',
'set.tokenSaved':          'Token saved successfully',
'set.tokenInvalid':        'Invalid token — must start with pk.',
'set.viewMapboxStats':     'View usage stats on Mapbox →',
'set.tileManager':         'Offline Tile Manager',
'map.offlineDisabledTooltip': 'No tile cache — download in Settings → Map',
```

> ⚠️ อย่าลืมแก้ key `'map.noMapboxToken'` ที่มีอยู่แล้ว (บรรทัด 100/735) ให้ชี้ไปที่ Settings แทน `.env`:
> `'map.noMapboxToken':'ไม่มี Mapbox token — ตั้งค่าได้ที่ Settings → แผนที่'`

---

### Phase 3 — Verify Matrix (Working Agreement #3)

| R | Setup | Action | Expected |
|---|---|---|---|
| R1 | Admin | บันทึก `pk.eyJ...` ที่ถูกต้อง | Success message · reload map → Mapbox tiles โหลดได้ทันที ไม่ต้อง restart |
| R2 | Admin | บันทึก `sk.foo` หรือ string ไม่มี `pk.` | Error: "Token ไม่ถูกต้อง — ต้องขึ้นต้นด้วย pk." |
| R3 | Admin | บันทึก empty string | Success · map fallback Carto · OFFLINE ปุ่ม disabled ถ้าไม่มี cache |
| R4 | ไม่มี cache | เปิดหน้า Map | ปุ่ม OFFLINE disabled + tooltip ชี้ไป Settings |
| R5 | ไม่มี cache → download ใน Settings | กลับหน้า Map | ปุ่ม OFFLINE enabled |
| R6 | Non-admin | เข้า Settings | ไม่เห็น / เข้าหน้า Map ไม่ได้ |
| R7 | - | pre-commit hook | `git grep pk.eyJ` จับ literal token ใน staged file ยังทำงาน (SEC-012) |

---

### ขอบเขต — สิ่งที่ไม่ทำในรอบนี้

- **ไม่ทำ** Mapbox usage counter — tiles โหลด client-side, server นับไม่ได้
- **ไม่ทำ** default map center/zoom, cache badge บนแผนที่, admin default style (Option C — PR แยก)
- **ไม่ sweep emoji** ใน map toolbar — legacy grandfathered (CLAUDE.md note #16); ถ้าแตะใหม่ใช้ SVG sprite
- **ไม่ encrypt token** — Mapbox `pk.` ออกแบบมาให้ public อยู่แล้ว

### Security checklist (โหลดเมื่อถึง Phase 1)

ก่อนเขียน `PUT /api/settings/map` ให้อ่าน `docs/REF_security-checklist.md` section:
- Auth/Middleware — `requireAdmin` บังคับ
- GET Endpoint — response ห้ามคืน token กลับ (SEC-003)

---

### Implementation Notes (2026-05-29)

**Spec gaps พบระหว่าง implement — แก้แล้ว:**

| Spec บอก | Code จริง | ผล |
|---|---|---|
| `openMapMgr()` | `openMapManager()` | ลบแล้ว ไม่กระทบ |
| `closeMapMgr()` | `closeMapManager()` | ลบแล้ว ไม่กระทบ |
| `loadMapAreas()` | `loadSavedAreas()` + `pollDownloadStatus()` | แก้ใน `loadMapMgrPanel()` |

**Known concerns:**

1. **`getMapboxToken()` ครอบ live map เท่านั้น** — tile-download endpoints (`/api/map/areas`, `/api/map/download`) ยังอ่าน `process.env.MAPBOX_TOKEN` โดยตรง (api-server.js lines 2772, 2878, 2908). ถ้า admin save token ใหม่ผ่าน UI → map page ใช้ได้ทันที แต่ offline tile download ยังใช้ token เก่าจาก env จนกว่าจะ restart. **Decision B1 per spec — acceptable for v1.**

2. **`mapMgrPollTimer` ไม่มี cleanup** — เมื่อ navigate ออกจาก Settings → แผนที่ timer ยังรัน (GOTCHAS #61). Impact ต่ำแต่ควรแก้ใน PR ถัดไป.

3. **Settings rail อันดับ** — แผนที่ อยู่ที่ตำแหน่ง 3 (หลัง ระบบ) ตามการตัดสินใจ 2026-05-29.

---

<sub>End of LOGIC_map-features.md · Updated 2026-05-29 (decisions #155–#156, #161–#163, #168–#171) · L = Done</sub>
