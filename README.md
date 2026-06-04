# Vigil Mobile

> React Native companion app สำหรับ [Vigil Platform](https://dashboard.dojojin.tech)
> CCTV Analytics Platform — Multi-vendor (Bosch · Hikvision · Dahua) + Real-time WebSocket + Push Notifications

[![Platform](https://img.shields.io/badge/platform-iOS%20%2B%20Android-lightgrey.svg)]()
[![RN](https://img.shields.io/badge/React%20Native-0.81-blue.svg)]()
[![Expo](https://img.shields.io/badge/Expo%20SDK-54-black.svg)]()
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)]()
[![UI Score](https://img.shields.io/badge/UI%2FUX-90%2F100-success.svg)]()

---

## Overview

Mobile app ที่เชื่อมต่อกับ `api-server.js` backend โดยตรง — ข้อมูลเดียวกันกับ web dashboard แต่ optimized สำหรับ security ops ใช้งานขณะเดินทาง: ดูกล้อง, snapshot real-time, events, สถิติ, แผนที่, และรับ push notifications

**Platform:** iOS + Android
**Framework:** React Native 0.81 + Expo SDK 54 + Expo Router v6 + TypeScript strict
**State:** Zustand v5
**Backend:** Vigil Platform API (Cloudflare Tunnel หรือ custom server URL)
**GitHub:** `github.com/dojojin/vigil-mobile`

---

## Feature Status

### ✅ Done — ครบทุก Tab + Foundation

| Feature | iOS | Android | หมายเหตุ |
|---------|-----|---------|----------|
| **Auth** — Bearer token + expo-secure-store | ✅ | ✅ | iOS Keychain / Android Keystore |
| **Login screen** | ✅ | ✅ | Thai/English UI |
| **Auth gate** — hydrate → `/api/auth/me` → redirect อัตโนมัติ | ✅ | ✅ | |
| **Custom Server URL** — white-label multi-deployment | ✅ | ✅ | Login screen ⚙️ → URL setup → SecureStore |
| **Biometric login** — Face ID / ลายนิ้วมือ | ✅ | ✅ | background→active re-auth; ป้องกัน loop (GOTCHAS #5) |
| **WebSocket real-time** — singleton, backoff reconnect, AppState aware | ✅ | ✅ | `wsStore.ts` |
| **i18n Thai / English** — reactive language switch | ✅ | ✅ | Phase 4 |
| **iPad / Tablet** — two-pane split layout (Camera tab) | ✅ | ✅ | Phase 5 |

#### 📷 Cameras Tab
| Feature | iOS | Android |
|---------|-----|---------|
| KPI row (online/offline/recording/today's events) | ✅ | ✅ |
| GroupFilter pills | ✅ | ✅ |
| Search bar | ✅ | ✅ |
| Status filter chips (All / Alert / Offline / Online) | ✅ | ✅ |
| Density toggle — List / Grid / Spacious | ✅ | ✅ |
| Priority sort: alert > offline > online | ✅ | ✅ |
| Live snapshot via `expo-image` + Bearer (lazy, offline skip) | ✅ | ✅ |
| Online/Offline status + REC badge + alert count badge | ✅ | ✅ |
| Camera Detail screen (`/camera/[id]`) — snapshot fullscreen + stats + events timeline | ✅ | ✅ |
| Camera scale 100–3,000 ตัว (FlatList windowing, per-card token hoist) | ✅ | ✅ |

#### 🔔 Alerts Tab
| Feature | iOS | Android |
|---------|-----|---------|
| Real-time event feed (wsStore.recentEvents) | ✅ | ✅ |
| WsStatusChip (connected/disconnected/reconnecting) | ✅ | ✅ |

#### 📋 Events Tab
| Feature | iOS | Android |
|---------|-----|---------|
| Paginated event list (`/api/events`) | ✅ | ✅ |
| 4-segment filter (All / Snapshot / Clip / Face) | ✅ | ✅ |
| Search | ✅ | ✅ |
| List ⇄ Grid toggle | ✅ | ✅ |
| Inline thumbnail | ✅ | ✅ |
| EventDetailModal — snapshot + meta + video playback (expo-video) | ✅ | ✅ |
| Face tab — `useFaces` + FaceDetailModal + save image to album | ✅ | ✅ (dev build) |

#### 📊 Stats Tab
| Feature | iOS | Android |
|---------|-----|---------|
| Category-based KPI cards | ✅ | ✅ |
| MultiLineChart — react-native-svg, tap tooltip + crosshair, tappable legend | ✅ | ✅ |
| Vendor filter + range picker (วันนี้ / 7d / 30d) | ✅ | ✅ |

#### 🗺️ Map Tab
| Feature | iOS | Android |
|---------|-----|---------|
| WebView + MapLibre GL JS + CartoDB tile (force light) | ✅ | ✅ |
| Pin online (green) / offline (red) + event count badge | ✅ | ✅ |
| แตะ pin → native bottom sheet + live snapshot | ✅ | ✅ |
| Floating refresh button | ✅ | ✅ |

#### 📱 Push Notifications + Settings
| Feature | iOS | Android |
|---------|-----|---------|
| Expo Push Token registration/unregistration | ✅ | ✅ (dev build) |
| Per-rule `push_user_ids` dispatch (alert-engine.onEvent) | ✅ | ✅ |
| 3-layer filter: rule push_user_ids → 20s cooldown → device sub-toggle | ✅ | ✅ |
| Alert / Face sub-toggles (notify_alert / notify_face) | ✅ | ✅ |
| tap-to-navigate from notification | ✅ | ✅ |
| Settings screen — push toggles + theme (auto/light/dark) + logout | ✅ | ✅ |

### 🔧 Pending

| Feature | หมายเหตุ |
|---------|----------|
| EAS projectId + FCM + APNs credentials | ต้องทำใน dev build ก่อน production |
| Notification Groups (D2) | Postponed — per-user + role shortcut พอแล้ว |

---

## Architecture

```
Vigil Mobile (iOS + Android)
       │
       ├── REST: Axios + Bearer Token (expo-secure-store)
       │         cameras · events · stats · faces · push register
       │
       └── WebSocket ?token=<bearer>
                 real-time: new_event · clip_done
       │
       ▼
Custom Server URL (SecureStore) หรือ default:
https://dashboard.dojojin.tech (Cloudflare Tunnel)
       │
       ▼
api-server.js :3000 (Express + WebSocket + pg LISTEN/NOTIFY)
       │
       ├── PostgreSQL 16 · EMQX MQTT
       └── push-sender.js → Expo Push API → APNs / FCM
```

---

## Project Structure

```
vigil-mobile/
├── app/
│   ├── _layout.tsx                  # Root layout + Auth gate + Biometric + WS lifecycle
│   ├── (auth)/
│   │   ├── login.tsx                # Login screen + Custom URL setup
│   │   └── server-setup.tsx         # URL config modal
│   └── (tabs)/
│       ├── _layout.tsx              # Bottom tab bar (5 tabs)
│       ├── index.tsx                # Cameras ✅
│       ├── alerts.tsx               # Alerts ✅
│       ├── events.tsx               # Events + Face ✅
│       ├── map.tsx                  # Map ✅
│       ├── stats.tsx                # Stats ✅
│       └── settings.tsx             # Push + Theme + Logout ✅
├── app/
│   └── camera/[id].tsx              # Camera Detail screen ✅
├── src/
│   ├── api/
│   │   └── client.ts                # Axios + Bearer interceptor + server URL resolver
│   ├── hooks/
│   │   ├── useCameras.ts            # REST + 3min poll + WS delta merge
│   │   ├── useEvents.ts             # Paginated events
│   │   └── useFaces.ts             # Face capture feed
│   ├── store/
│   │   ├── authStore.ts             # Zustand — login/logout/hydrate
│   │   ├── wsStore.ts               # WS singleton + recentEvents + eventDeltas
│   │   └── themeStore.ts            # Theme mode persist
│   ├── components/
│   │   ├── CameraCard.tsx           # Grid/List/Spacious card + snapshot
│   │   ├── CameraSearchBar.tsx      # Search input
│   │   ├── StatusFilterChips.tsx    # All/Alert/Offline/Online chips
│   │   ├── GroupFilter.tsx          # Horizontal pill filter
│   │   ├── KPICard.tsx              # Metric card
│   │   ├── MultiLineChart.tsx       # react-native-svg line chart
│   │   └── WsStatusChip.tsx         # WS connection status badge
│   ├── lib/
│   │   └── push.ts                  # Expo Push Token registration (IS_EXPO_GO guard)
│   ├── theme/
│   │   └── index.ts                 # Dark/light tokens, TYPE scale, useGridColumns
│   ├── types/index.ts               # Camera, Event, User, VigilEvent, …
│   └── constants/index.ts           # API_BASE_URL resolver, WS_URL, STORAGE_KEYS
├── docs/
│   ├── ARCH_documentation-governance.md
│   └── GUIDE_eas-deployment.md      # EAS build + APNs/FCM credentials + dev-build verify
├── app.json                         # newArchEnabled: true (Android required)
├── .npmrc                           # legacy-peer-deps=true (ห้ามลบ)
├── CLAUDE.md                        # AI assistant context
├── GOTCHAS.md                       # Known issues (#1–#11)
├── PATTERNS.md                      # 12 reusable code patterns
├── PHASE_SAMPLES.md                 # Starter code per phase
└── ROADMAP.md                       # Phase ordering + UI assessment + pending
```

---

## Getting Started

```bash
git clone https://github.com/dojojin/vigil-mobile.git
cd vigil-mobile

npm install          # .npmrc จัดการ legacy-peer-deps อัตโนมัติ
npx expo start --clear

# iOS Simulator
npx expo start --ios --clear

# Android Emulator
npx expo start --android --clear

# Physical device — สแกน QR ด้วย Expo Go (Camera app บน iPhone)
```

Login ด้วย credential เดียวกับ vigil-platform (admin / รหัสผ่านที่ตั้งไว้)
หรือกด ⚙️ บน login screen เพื่อตั้ง server URL ของ deployment ตัวเอง

---

## Key Technical Decisions

**Bearer Token แทน Cookie**
Web dashboard ใช้ HttpOnly cookie + triple-layer Safari ITP workaround.
Mobile ใช้ `Authorization: Bearer` — backend รองรับอยู่แล้วใน `getSessionToken(req)`.
Token เก็บใน `expo-secure-store` (iOS Keychain / Android Keystore).

**WebSocket auth ผ่าน `?token=` URL param**
WebSocket upgrade ใน React Native ไม่รองรับ custom header — backend รองรับ `?token=` query param อยู่แล้ว (Safari ITP fallback เดิม).

**expo-image แทน RN Image**
React Native `Image` ไม่รองรับ custom headers บน Android — `expo-image` รองรับทั้งสอง platform + built-in caching.

**MapLibre ผ่าน WebView แทน native map SDK**
ไม่ผ่าน Google/Apple tile server — ใช้ CartoDB tile เดียวกับ web dashboard. ไม่ต้องมี billing account / API key.

**Push: alert-engine.onEvent ไม่ใช่ ws-bridge**
คุมต้นทางด้วย alert_rules + quiet hours + push_user_ids เดียวกับ LINE dispatch.
Face push คงที่ ws-bridge (face ไม่ผ่าน alert-engine).

---

## Owner

**Prakasit Rochanavipart (Dojo-mAn)** — DojoJin Tech
Bangkok, Thailand

<sub>Vigil Mobile · v1.0.0 · 2026-06-01 · Phase 1–6 Complete · UI/UX ~90/100</sub>
