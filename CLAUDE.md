# CLAUDE.md — Vigil Mobile

> **Project context handoff** สำหรับ Claude Code, future sessions, opus plan
> Owner: Prakasit Rochanavipart (Dojo-mAn) · Last updated: 2026-06-01
> Tech: React Native 0.81 + Expo SDK 54 + Expo Router v6 + Zustand v5 + TypeScript strict
> Repo: `github.com/dojojin/vigil-mobile` · Local: `~/vigil-mobile/`

---

## 📚 Documentation Map

ทุกไฟล์ที่ agent ต้องรู้ ดู `docs/ARCH_documentation-governance.md` สำหรับ registry เต็ม + task→load mapping

| File | Role | Load when |
|---|---|---|
| **`CLAUDE.md`** | Entry point | ทุก session — อ่านก่อน |
| **`README.md`** | Public overview | First-time onboarding |
| **`PATTERNS.md`** | Code patterns (12 patterns) | สร้าง store/hook/screen/component ใหม่ |
| **`PHASE_SAMPLES.md`** | Starter code ทุก phase | ขึ้น phase ตาม ROADMAP |
| **`ROADMAP.md`** | Phase ordering + UI/UX | Planning, ลำดับงาน |
| **`GOTCHAS.md`** | Bug history (#1-#11) | Debugging |
| **`docs/GUIDE_eas-deployment.md`** | EAS build + push + credentials | Dev build, push integration |
| **`docs/ARCH_documentation-governance.md`** | Registry | Doc management, scope unclear |

---

## 🤖 Model Assignment (เลือก model ตามงาน)

> *Guidance* — CLAUDE.md เลือก model จริงไม่ได้. การบังคับใช้อยู่ที่ `.claude/settings.json` (committed) + `/model` picker.

### Default
- **`opusplan`** — Opus วางแผนใน plan mode → สลับ Sonnet ตอน execute อัตโนมัติ
- **Subagent** = `haiku` (env `CLAUDE_CODE_SUBAGENT_MODEL` ใน settings.json)

### Task → Model

| งาน | Model | ตัวอย่าง |
|---|---|---|
| Architecture / state design / cross-cutting | `opus` | wsStore + WS lifecycle, theme override, custom server URL store, biometric flow |
| Complex hook / scaling | `opus` | useEvents pagination + filter, multi-line chart logic |
| Cross-cutting bug / heisenbug | `opus` | Android segments undefined, save-state per face, IS_EXPO_GO guards |
| Feature ตาม pattern เดิม | `sonnet` | เพิ่ม screen ใหม่ตาม PATTERNS.md, modal ใหม่ตาม EventDetailModal |
| Apply phase sample | `sonnet` | ทำตาม PHASE_SAMPLES.md ของ phase นั้น |
| Refactor ในกรอบเดิม | `sonnet` | แยก helper, ปรับ style tokens |
| Docs / commit msg / session summary | `haiku` | README, CLAUDE.md, ROADMAP, commit messages |
| Search / grep / read (subagent) | `haiku` | ตั้งใน settings.json แล้ว |

### Cheat sheet
```
/model opusplan   # default
/model opus       # architecture / state design / cross-cutting bug
/model sonnet     # implement ตาม pattern / phase sample
/model haiku      # docs / search / cleanup
```

### Enforcement
- `.claude/settings.json` (committed) — `model: opusplan` + `CLAUDE_CODE_SUBAGENT_MODEL: haiku`
- `.claude/settings.local.json` (gitignored) — local override (permissions เฉพาะเครื่อง)
- `/model` picker override session-by-session

---

## 🧭 Working Agreement (ข้อตกลงการทำงาน — บังคับทุกครั้ง)

> ปรับมาจาก vigil-platform Working Agreement — ข้อที่ไม่ใช่ web-specific นำมาใช้ตรง,
> ข้อที่ต้องแปลงสำหรับ mobile ระบุไว้ชัดเจน

### 1. Investigate-first — แยก Fact ออกจาก Opinion ให้ชัด

เมื่อได้รับคำสั่ง ทำตามลำดับนี้ทุกครั้งก่อนลงมือแก้โค้ด:

1. **ตรวจสอบ** — อ่านไฟล์ / โครงสร้าง / git ที่เกี่ยวข้องจริง
2. **หาความจริง** — ยืนยันจาก source จริง (โค้ด / API contract / Metro log / Simulator) อย่าเดา
3. **ประมวลผล + วิเคราะห์ผล**
4. **นำเสนอ แบ่ง 2 ส่วนแยกกันชัดเจน:**
   - **🔵 Fact** — สิ่งที่ตรวจสอบแล้วเป็นจริง อ้างอิงได้ (ไฟล์ / บรรทัด / API response จริง)
   - **🟡 Opinion** — ข้อดี / ข้อเสีย + แผนที่เสนอ + ความเห็นเพิ่มเติม
5. **รอเจ้าของตัดสินใจ** — ไม่ลงมือจนกว่าจะได้ไฟเขียว

**ข้อยกเว้น:** ถ้าคำสั่งเป็นไฟเขียวในตัว ("ทำเลย" / "จัดการเลย" / "ต่อเลย") = ลงมือได้ทันที
แต่ผลลัพธ์ยังต้องรายงานแบบแยก Fact / Opinion เสมอ

### 2. UI-first (Mobile-native version)

ก่อนแตะ UI / layout / screen ใหม่ ยึดหลัก 3 ข้อ:

**A. Design tokens — TS theme แทน CSS custom properties**
- สี / ระยะ / ขนาด ดึงจาก `src/constants/index.ts` เสมอ — ห้าม hardcode hex ใน component
- `COLORS` เป็น single source of truth (ขยายเมื่อต้องการ)
- เป้าหมาย white-label: ยังไม่บังคับตอนนี้ แต่ new code ห้ามฝัง brand name / สีตรง
- i18n: ยังไม่มี layer — ทำได้ทั้ง Thai-first แต่ถ้าเพิ่ม string ใหม่ให้ note ไว้ว่าต้องแปลเมื่อทำ i18n

**B. Safe-area + device size แทน breakpoint**
- "≤768px breakpoint" ไม่มีความหมายบน native — ใช้ `useSafeAreaInsets` และ `Dimensions` แทน
- ก่อน commit UI ทุกครั้ง → ตรวจทั้ง iPhone (portrait) และ iPad/landscape ถ้า layout ซับซ้อน
- รายงานผลใน summary (ผ่าน / แก้แล้ว / จุดที่อาจเป็นปัญหา)

**C. ไม่ใช้ emoji เป็น UI (soft preference)**
- ใช้ `@expo/vector-icons` หรือ `react-native-svg` แทน emoji ใน component
- ไม่มี hard constraint เหมือน web (ไม่มี server-side SVG render บน mobile)
- docs / commit message ยกเว้น

### 3. Reproduce-before-fix → Verify-after (เฉพาะงาน bug)

ใช้กับ "แก้บั๊ก / พฤติกรรมไม่ตรงคาด" เท่านั้น — ไม่ใช่ feature ใหม่

1. **Reproduce ก่อนเสมอ** — รันบน Simulator/device จริง + ดู Metro log / RN debugger
   ถ้า reproduce ไม่ได้ → บอกตรงๆ และวิธีแก้ที่เสนอนับเป็น 🟡 Opinion ไม่ใช่ 🔵 Fact
2. **Root cause ไม่ใช่ symptom** — ห้ามเดา เห็นของจริงก่อนแตะโค้ด
3. **Verify-after** — หลังแก้ต้องรันบน device/Simulator จริงซ้ำ
   **type-check ผ่านอย่างเดียวไม่นับว่าเสร็จ**
4. **Capture** — log / warn ที่ไม่เปลี่ยน control flow → ทำได้เลย
   validation ที่เปลี่ยน behavior → เสนอ รอไฟเขียวก่อน

### หมายเหตุ Commit
- **ห้ามใส่ `Co-Authored-By: Claude`** ในทุก commit — เจ้าของต้องการ sole authorship

---

## Commands

```bash
npm install                  # ใช้ .npmrc legacy-peer-deps=true อัตโนมัติ — ห้ามรัน --force
npx expo start --clear       # start Metro + Expo Go QR (clear cache)
npx expo start --ios         # เปิด iOS simulator
npx expo start --android     # เปิด Android emulator
npx tsc --noEmit             # type check ทั้งโปรเจกต์
```

**ไม่มี ESLint, Prettier, Jest setup** — ห้ามแนะนำ `npm test` / `npm run lint` เพราะจะ fail
ตอนติดตั้ง package ใหม่ใช้ `npx expo install <pkg>` (จะ pin version ให้ตรงกับ Expo SDK 54)

### EAS dev/prod build (ดู `docs/GUIDE_eas-deployment.md` เต็ม)
```bash
eas login                                          # Expo account
eas build --profile development --platform all     # dev build ทดสอบ push/save/video/badge
eas credentials --platform ios                     # APNs (ต้อง Apple Developer)
```
projectId ตั้งแล้วใน `app.json` (`e6e8e170-...`) — `eas init` ทำแล้ว

### Backend / API debug
Backend repo: `~/vigil-platform/` (ดู CLAUDE.md ที่นั่น)
URL: `https://dashboard.dojojin.tech` ผ่าน Cloudflare Tunnel

```bash
# ตรวจ API
TOKEN="xxx"
curl -s https://dashboard.dojojin.tech/api/cameras -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# ตรวจ WS (wscat)
wscat -c "wss://dashboard.dojojin.tech?token=$TOKEN"
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | React Native 0.81 + Expo SDK 54 |
| Navigation | Expo Router v6 (file-based, `app/` directory) |
| State | Zustand v5 |
| HTTP | Axios + Bearer token interceptor |
| Token storage | expo-secure-store (iOS Keychain / Android Keystore) |
| Real-time | WebSocket (`wsStore.ts`) — `wss://dashboard.dojojin.tech?token=<token>` |
| Language | TypeScript strict |

---

## Architecture Flow

**App boot → auth gate**
1. `app/_layout.tsx` เรียก `useAuthStore.hydrate()` ตอน mount
2. `hydrate()` (`src/store/authStore.ts:41`) โหลด token+user จาก SecureStore → call `/api/auth/me` ยืนยัน → set `isReady=true`
3. `_layout.tsx` redirect: ไม่มี user → `/(auth)/login`, มี user แต่อยู่ใน `(auth)` → `/(tabs)`

**API auth**
- `src/api/client.ts:19` — axios request interceptor ดึง token จาก SecureStore ใส่ `Authorization: Bearer <token>` ทุก request
- `src/api/client.ts:29-37` — response interceptor จับ 401 เรียก `_onUnauthorized` callback
- `authStore.ts:31` register callback ที่เรียก `logout()` → SecureStore + state ถูกล้าง → auth gate redirect ไป login อัตโนมัติ

**WebSocket (real-time)**
- `src/store/wsStore.ts` — singleton WS manager นอก React tree
- connect ตอน login/hydrate, disconnect ตอน logout (`_layout.tsx`)
- Auth: `?token=<bearer>` ใน URL (backend `verifyClient` ตรวจ query param)
- AppState: ปิด WS เมื่อ background, เปิดใหม่เมื่อ active
- Reconnect: exponential backoff 1s → 2s → 4s → 8s → 16s → 30s
- Messages: `new_event` | `new_face` | `clip_done` | `occupancy_update`
- Zustand state: `status` | `recentEvents` (50 ล่าสุด) | `eventDeltas` (สำหรับ KPI)

**Camera polling**
- `src/hooks/useCameras.ts` poll `/api/cameras` + `/api/camera-groups` ทุก **3 นาที** (WS จัดการ real-time events แล้ว)
- WS `new_event` → บวก `alert_count_today` ทันที via `eventDeltas`
- REST fetch เคลียร์ `eventDeltas` ป้องกัน double-count
- ฟัง `AppState` — หยุด poll เมื่อ background, fetch + restart polling เมื่อ active
- `isOnline()` ใช้ทั้ง `status` field และ `last_seen` (90s threshold)

**Snapshot image**
- `/api/snapshot/live/:cameraId` ต้องการ Bearer header → ส่งผ่าน `Image source.headers` ใน `CameraCard`
- ใช้ `expo-image` (ไม่ใช่ RN `Image`) — รองรับ custom headers ทั้ง iOS + Android

---

## Critical Constraints

ห้ามเปลี่ยนสิ่งเหล่านี้โดยไม่มีเหตุชัด — ทุกข้อมีประวัติ break มาก่อน:

0. **Local path คือ `~/vigil-mobile/`** — (เปลี่ยนจาก `~/dojojin-v2/` — 2026-05-30)
1. **`.npmrc` ต้องมี `legacy-peer-deps=true`** — ลบเมื่อไหร่ `npm install` fail ทันที
2. **`app.json` ต้อง `newArchEnabled: true`** — Expo Go บน Android บังคับ New Architecture, ถ้า `false` Android crash ทันทีตอน boot
3. **`babel.config.js` ต้องมีแค่ `babel-preset-expo`** — ห้ามเพิ่ม reanimated plugin จนกว่าจะ `npx expo install react-native-reanimated` จริง (ใส่ก่อนจะ break Metro)
4. **Camera API response เป็น array ตรงๆ** — `cameraApi.list/groups` (`src/api/client.ts:53,61`) handle ทั้ง `[]` และ `{cameras: []}` ห้ามตัด fallback ออก
5. **Bearer token ไม่ใช่ Cookie** — backend รองรับ `getSessionToken(req)` อยู่แล้ว ห้ามเปลี่ยนกลับเป็น cookie-based
6. **Backend `.env` ต้อง set `SESSION_SECRET`** ตายตัว — ไม่งั้น token invalid ทุกครั้ง backend restart → ทำให้ mobile login loop
7. **WS ใช้ `?token=` ใน URL** — ไม่ใช่ Authorization header (WebSocket upgrade ไม่รองรับ custom header บน React Native)

---

## API Endpoints ที่ใช้จริง

| Method | Endpoint | Response | หมายเหตุ |
|--------|----------|----------|----------|
| POST | `/api/auth/login` | `{success, user, token}` | body: `{username, password}` |
| GET | `/api/auth/me` | `{user}` | verify token (ใช้ใน hydrate) |
| POST | `/api/auth/logout` | `{success}` | best-effort, ล้าง local อยู่ดี |
| GET | `/api/cameras` | `Camera[]` | array ตรงๆ ไม่มี wrapper |
| GET | `/api/camera-groups` | `CameraGroup[]` | array หรือ `{groups:[]}` — client handle ทั้งคู่ |
| GET | `/api/snapshot/live/:cameraId` | image/jpeg | ต้องใส่ Bearer header |
| WS | `wss://…?token=<token>` | JSON messages | `new_event` / `new_face` / `clip_done` / `occupancy_update` |

Type definitions: `src/types/index.ts` (Camera, CameraGroup, CameraStats, User, AuthResponse, VigilEvent)

---

## Feature Status

| Feature | สถานะ | หมายเหตุ |
|---------|-------|----------|
| Auth (login/logout/hydrate) | ✅ | |
| Camera screen + KPI + GroupFilter | ✅ | search + filter chips + density toggle |
| Snapshot (expo-image + Bearer) | ✅ iOS + Android | serverUrl dynamic (Phase 2A) |
| WebSocket real-time | ✅ | wsStore.ts |
| Poll ลด 30s → 3min | ✅ | |
| Alerts screen | ✅ | recentEvents + swipe-to-dismiss |
| Events screen | ✅ | 4-tab + search + detail + video + face + save |
| Map screen | ✅ | WebView MapLibre + CartoDB voyager + live snapshot sheet |
| Stats screen | ✅ | category KPI + multi-line chart + vendor filter |
| Settings + theme + push + language | ✅ | theme auto/light/dark + i18n th/en/auto |
| Camera detail screen | ✅ | modal + live snapshot + timeline + event detail tap |
| Custom server URL | ✅ | Phase 2A — server-setup modal + axios dynamic baseURL |
| Camera scale 100-3000 | ✅ | Phase 2B — search + filter + density + lazy snapshot |
| Biometric login | ✅ | Face ID + Fingerprint dual support |
| i18n th/en | ✅ | Phase 4 — 180+ keys, reactive, date locale |
| Tablet split-view | ✅ | Phase 5 — Camera tab two-pane (iPad ≥900pt) |
| Haptics | ✅ | expo-haptics — tap/toggle/save |
| Skeleton loaders | ✅ | Camera/Events/Stats screens |
| Tab transitions | ✅ | animation: 'shift' (React Navigation v7 built-in) |
| Swipe-to-dismiss Alerts | ✅ | ReanimatedSwipeable — session-local dismiss |
| Person Data (ข้อมูลบุคคล) | 🔧 วางแผนแล้ว | Phase 7 — appearance/PAR, tab ที่ 6, ดู ROADMAP.md |
| Push delivery verify | ⏳ | รอ dev build (EAS + FCM + APNs) |
| Save image Android | ⏳ | รอ dev build — media-library permission |
| Video playback Android | ⏳ | รอ dev build — expo-video native |
| App icon badge | ⏳ | รอ dev build |

→ **ดู `ROADMAP.md` สำหรับ phase ordering + design details**

---

## Owner Communication

- **ภาษา:** ไทยเป็นหลัก, technical terms + code/command เป็น English
- **Style:** structured output + tables, ตอบกระชับ
- **Hardware:** M1 MacBook Pro · iPhone 17 Pro (iOS 26.4) · Android device
- **อย่าแนะนำ React/Vue** — นี่คือ React Native โดยเฉพาะ
