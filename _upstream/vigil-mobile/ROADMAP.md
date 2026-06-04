# Vigil Mobile — ROADMAP

> อัปเดต 2026-06-01 หลังเสร็จ Phase 1–6 ครบ
> Reference สำหรับ session ใหม่ — เปลี่ยนได้ตามความต้องการ

---

## UI/UX Assessment (2026-06-01)

**คะแนนเชิงประเมิน:** ~90/100 (จาก 80/100 เมื่อ 2026-05-31)
- เทียบเท่า **UniFi Protect** (Ubiquiti) ในด้าน feature
- haptic + skeleton + animation ยกระดับขึ้นมาใกล้ Nest/Ring

**จุดแข็ง (เพิ่มเติม):** i18n th/en reactive, iPad two-pane layout, swipe-to-dismiss, tab transitions

**จุดที่ยังขาด:** app icon badge (dev build), push delivery (dev build)

---

## ✅ Phase 1 — Quick wins / Bug fixes

### 1A. Bug: GroupFilter pill clipped + count = 0 ✅
- **Fix:** ครอบ ScrollView ด้วย View wrapper `paddingVertical: 10`
  (paddingVertical บน ScrollView style ไม่ขยาย frame — ดู GOTCHAS #4)
- **Fix:** เปลี่ยน `allCount` → `cameras.length` (totalCount prop)
- **Files:** `src/components/GroupFilter.tsx`, `app/(tabs)/index.tsx`

### 1B. Pull-to-refresh Stats + Map ✅
- **Fix:** Map → floating refresh button (WebView ไม่รองรับ RefreshControl)
- **Files:** `app/(tabs)/map.tsx`

### 1C. Biometric login (Face ID / ลายนิ้วมือ) ✅
- รองรับทั้ง Face ID + Fingerprint พร้อมกัน (label ผสม auto-detect)
- ป้องกัน loop: เช็คเฉพาะ `background → active` (ดู GOTCHAS #5)
- **Files:** `app/_layout.tsx`, `app/settings.tsx`, `src/constants/index.ts`, `app.json`

---

## ✅ Phase 2 — Foundation features

### 2A. Custom Server URL ✅
- Login screen ⚙️ → modal กรอก URL → ping `/api/auth/me` validate → SecureStore
- axios request interceptor อ่าน SERVER_URL per-request
- wsStore.connect() async → derive WS URL (https→wss) จาก stored URL
- **Fix ตามมา (2A gap):** ส่ง serverUrl ผ่าน props ทุก media URL ใน events, faces, map
- **Files:** `src/constants/index.ts`, `src/api/client.ts`, `src/store/wsStore.ts`,
  `app/(auth)/login.tsx`, `app/(auth)/server-setup.tsx`, `app/(tabs)/events.tsx`, `app/(tabs)/map.tsx`

### 2B. Camera scale (100-3,000 ตัว) ✅
- Search bar + status filter chips (All/Alert/Offline/Online) + density toggle (List/Grid/Spacious)
- Priority sort: alert > offline > online
- CameraCard: hoist token/serverUrl ไปที่ parent (ป้องกัน per-card SecureStore storm)
- cachePolicy `"none"` → `"memory"` สำหรับ list; offline camera ไม่ request snapshot
- FlatList: windowSize=5, removeClippedSubviews, initialNumToRender=10
- **SectionList ถูก drop:** ขัดกับ density toggle → ใช้ flat list + group filter pill แทน
- **Files:** `app/(tabs)/index.tsx`, `src/components/CameraCard.tsx`,
  `src/components/CameraSearchBar.tsx`, `src/components/StatusFilterChips.tsx`

---

## ✅ Phase 3 — Camera Detail screen

### 3. Camera Detail ✅
- Route: `app/camera/[id].tsx` + shared `src/components/CameraDetailContent.tsx`
- Hero: live snapshot 16:9 อัปเดตทุก 5s (cache-bust `?t=tick`, cachePolicy none)
- Quick stats: events today / last seen / last alert
- Activity timeline: 20 events ล่าสุด via `useEvents({ camera: id })`
- กด timeline row → EventDetailModal (fullScreen ป้องกัน iOS modal-over-modal ดู GOTCHAS #7)
- **Backend:** ไม่ต้องเพิ่ม endpoint — ใช้ `GET /api/events?camera=id` ที่มีอยู่แล้ว
- **Files:** `app/camera/[id].tsx`, `src/components/CameraDetailContent.tsx`,
  `src/components/EventDetailModal.tsx` (extracted shared component)

---

## ✅ Phase 4 — Internationalization

### 4. i18n th/en ✅
- `i18n-js` + `expo-localization` + `languageStore` (Zustand, pattern เดียวกับ themeStore)
- `useI18n()` hook — reactive ผ่าน Zustand selector, ส่ง locale explicit ทุก call
  (ไม่ mutate singleton — ดู GOTCHAS #8)
- Settings → Language selector: Auto (device) / ไทย / English
- 180+ keys ครอบทุก screen + components
- Date locale ตาม language: th-TH (พ.ศ.) / en-US (ค.ศ.)
- formatEventType → `useFormatEventType()` hook exported จาก EventDetailModal
- **Files:** `src/i18n/{th,en,index,useI18n}.ts`, `src/store/languageStore.ts`,
  ทุก screen + `src/components/{GroupFilter,CameraSearchBar,StatusFilterChips,EventDetailModal}.tsx`

---

## ✅ Phase 5 — Tablet split-view

### 5. iPad two-pane layout (Camera tab) ✅
- `useIsWide()`: width ≥ 900px (threshold เดียวกับ useGridColumns)
- Wide: left pane 380pt (list compact) + right pane (CameraDetailContent inline)
- Narrow: behavior เดิมทุกอย่าง (router.push modal)
- Tap camera → show inline, tap อีกครั้ง → deselect
- Empty right pane: icon + hint text
- **Scope:** Camera tab เท่านั้น (Settings/other tabs ยังเป็น modal)
- **Files:** `src/theme/index.ts`, `src/components/CameraDetailContent.tsx`,
  `app/camera/[id].tsx`, `app/(tabs)/index.tsx`

---

## ✅ Phase 6 — Polish

### Haptics ✅
- `expo-haptics` — CameraCard tap (Light), biometric/push toggle (Medium),
  save image success/error (Notification), timeline row tap (Light)

### Skeleton loaders ✅
- `SkeletonBox` + `SkeletonCameraCard` + `SkeletonEventRow` + `SkeletonStatCard`
- Camera grid, Events list, Stats screen — แทน ActivityIndicator ทุกจุด

### Tab labels Thai ✅
- กล้อง / เหตุการณ์ / แผนที่ / สถิติ / แจ้งเตือน (reactive ตาม i18n)

### Event detail tap from Camera Detail ✅
- Timeline row กด → EventDetailModal full parity (snapshot + video + save + meta)

### Tab transitions ✅
- `animation: 'shift'` บน Tabs screenOptions (React Navigation v7 built-in — ไม่ต้อง reanimated code)

### Swipe-to-dismiss Alerts ✅
- `ReanimatedSwipeable` (gesture-handler modern API) + `react-native-reanimated` v4
- Swipe left → trash icon → dismiss (session-local, WS feed ไม่มี backend persist)
- `dismissEvent(id)` เพิ่มใน wsStore
- **Setup:** `babel.config.js` + `react-native-worklets` (ดู GOTCHAS #9, #10, #11)

---

## 🔧 Phase 7 — Person Data / ข้อมูลบุคคล (วางแผนแล้ว, ยังไม่เริ่ม)

> Parity กับ vigil-platform "ข้อมูลบุคคล" (commit 6fc2450, 2026-06-01)
> Appearance / PAR data — แอตทริบิวต์ร่างกาย ไม่ใช่ใบหน้า
> Design + plan 2026-06-01 · code samples → PHASE_SAMPLES.md (เพิ่มเมื่อเริ่ม)

### Decision (locked)
- **Navigation:** Tab ที่ 6 "บุคคล" (bottom tab, parity กับ platform top-level nav)
- **Chart approach:** native — bar rows + color swatches + KPI tiles + MultiLineChart เดิม (ไม่ลง chart lib)
- **2-tab structure** ในหน้า: ภาพรวม (overview/stats) + ค้นหา (search) + shared range bar

### Backend (LIVE บน production แล้ว — HTTP 401 ยืนยัน deployed)
| Endpoint | คืนค่า |
|---|---|
| `GET /api/appearances/stats?from&to&camera_id` | gender, top_cat, bottom_cat, upper_color[], lower_color[], hair_color[], hair_length, accessories{}, volume[] |
| `GET /api/appearances/search?gender,top,bottom,hair,glasses,helmet,bag,upper_color,lower_color,camera_id,from,to,limit,offset` | event rows + แอตทริบิวต์ + `X-Total-Count` |
| `GET /api/events/:id/appearance` | รายละเอียดต่อ event |

**Attribute enums:** gender(Male/Female) · top(ShortSleeve/LongSleeve/Sleeveless/Jacket/Coat/Vest) ·
bottom(Trousers/Shorts/Skirt/Dress) · color×12(Black/White/Gray/Blue/Green/Red/Orange/Yellow/Purple/Brown/Beige/Magenta) ·
hair_length(Short/Long/Medium/Bald) · glasses/helmet(bool) · bag(ShoulderBag/Backpack/Briefcase)

### Sub-phases
| Phase | งาน | Effort | Risk |
|---|---|---|---|
| **A1 — Foundation** | types `VigilAppearance`+`AppearanceStats`, `appearanceApi.{stats,search}`, ~40 i18n enum keys (th/en), tab ที่ 6 + range/tab scaffold | 0.5 วัน | ต่ำ |
| **A2 — Overview tab** ⭐ | `AttrBarRow` + `ColorBarRow` + gender donut/bar + accessories tiles + volume (reuse MultiLineChart) + skeleton | 2 วัน | กลาง (9 มิติ) |
| **A3 — Search tab** | filter sheet + results grid (reuse FaceCell) + `useAppearanceSearch` pagination | 1.5 วัน | ต่ำ |
| **A4 — Detail + polish** | `AppearanceDetailModal` (dedicated) + haptics + cross-link | 1 วัน | ต่ำ |

**รวม ~5 วัน** · build A3 ก่อน A2 ได้ถ้าอยาก testable slice เร็ว (reuse สูง/risk ต่ำ)

### Reusable assets (mobile)
SegmentedControl, RangeSelector (stats), FaceCell grid, useEvents pagination,
MultiLineChart (react-native-svg 15.12.1), KPICard, EventDetailModal pattern,
serverUrl/token hoist pattern, i18n enum-key pattern (`eventType.*`)

### Caveat
- ⚠️ endpoints deployed ✓ แต่ **ยัง verify ไม่ได้ว่า `appearances` table มีข้อมูล** (ต้อง token) —
  ถ้า table ว่าง overview จะ blank แม้โค้ดถูก. ต้องยืนยัน PAR pipeline ฝั่ง backend ทำงาน
- Design rationale + ASCII mockups → chat history 2026-06-01 (ย้ายเข้า PHASE_SAMPLES.md เมื่อเริ่ม A1)

---

## ⏳ Dev-build dependencies (รอ EAS build รอบเดียว)

| Feature | โค้ดพร้อม | รอ |
|---|---|---|
| Push delivery verify | ✅ | EAS projectId + FCM + APNs |
| Save image → album Android | ✅ | media-library permission (dev build) |
| Video playback Android | ✅ | expo-video native module |
| App icon badge | ✅ | dev build |

### EAS build → **ดู `docs/GUIDE_eas-deployment.md` สำหรับขั้นตอนเต็ม**
- `eas init` ทำแล้ว — projectId `e6e8e170-...` อยู่ใน `app.json`
- Android permissions (biometric + media) เพิ่มใน `app.json` แล้ว
- เหลือ: eas-cli global, eas.json, APNs (Apple Dev), FCM (Firebase)

---

## Postponed

- **Camera group filter dropdown** (50-100 groups) — vendor pills + status chips พอ
- **Notification Groups** — per-user + role shortcut พอ
- **White-label brand override** — รอ multi-customer ค่อยทำ
- **i18n Phase 5+** (Settings sidebar nav full iPad) — user base tablet น้อย

---

<sub>Updated 2026-06-01 · Phase 1–6 ครบ · Phase 7 (Person Data) วางแผนแล้ว · รอ EAS dev build</sub>
