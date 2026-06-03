---
title: Vigil Mobile
description: Native iOS and Android companion app for Vigil Platform — real-time camera monitoring, event feed, statistics, map view, and push notifications with biometric login.
---

# Vigil Mobile

Vigil Mobile is the native companion app for Vigil Platform, available on iOS and Android. It connects directly to any Vigil Platform deployment using the same API and WebSocket endpoints as the web dashboard — there is no separate mobile backend.

The app is built for security operations teams who need access to camera status, real-time events, statistics, and the site map while away from a desk. All data shown in the mobile app is the same live data available in the web dashboard.

**Current status:** Phase 1–6 complete. All primary tabs are fully functional on both platforms.

---

## Capabilities by Tab

### Cameras

The Cameras tab is the primary operations view:

- KPI row showing counts of online cameras, offline cameras, cameras in alert state, and today's total event count
- Group filter pills with horizontal scroll for fast zone switching
- Search bar with status filter chips (All / Alert / Offline / Online)
- Three density layouts: List, Grid, Spacious — switchable without losing scroll position
- **Priority sort order** — alert first, then offline, then online — critical cameras rise to the top automatically
- Live snapshots with lazy loading — snapshots are not fetched for off-screen cards
- Per-camera badges showing online/offline status, recording indicator, and unread alert count
- Camera Detail screen with fullscreen snapshot, per-camera statistics, and an event timeline
- Handles 100 to 3,000 cameras with windowed list rendering

iPad and large-tablet layouts display a two-pane master/detail split view.

### Alerts

The Alerts tab shows a real-time feed of incoming events delivered via WebSocket. A connection status indicator shows whether the WebSocket is connected, reconnecting, or offline.

### Events

The Events tab provides access to the full paginated event history:

- 4-segment filter: All, Snapshot, Clip, Face
- Search and list/grid toggle with inline thumbnails
- Event detail modal showing snapshot, event metadata, and video clip playback (pre-alarm clips where available)
- Face tab with face crop gallery and the option to save images to the device photo album

### Stats

The Stats tab presents event analytics:

- Category-based KPI cards
- Multi-line chart with tap-to-tooltip and crosshair interaction
- Vendor filter and range picker (Today, 7 days, 30 days)
- Tappable chart legend

### Map

The Map tab renders camera positions on a real geographic map:

- Camera pins colored by online (green) / offline (red) status with event count badges
- Tap any pin to open a bottom sheet with the camera's live snapshot
- Floating refresh button

---

## Push Notifications

Vigil Mobile receives push notifications for security events and face detections, delivered to Apple Push Notification service (APNs) on iOS and Firebase Cloud Messaging (FCM) on Android.

**Alert push** — when the Vigil Platform alert engine processes an event that matches an alert rule, it dispatches a push message to the registered devices of users who have that rule enabled, subject to a 20-second cooldown per camera and the same quiet hours configuration used for LINE alerts.

**Face push** — face capture events are dispatched as a separate notification stream, independently of alert rules.

**Three-layer filtering:**
1. Rule-level — the alert rule must have the user listed as a push recipient
2. Cooldown — the same camera cannot trigger another push within 20 seconds
3. Device-level — the user can independently disable alert or face notifications on their specific device

Tapping a notification navigates directly to the relevant event or face detail screen.

---

## Security

**Authentication** — Vigil Mobile uses a Bearer token stored in the device's native secure credential store (iOS Keychain / Android Keystore). The token is never stored in any readable file path.

**Biometric login** — Face ID and fingerprint authentication are supported on both platforms. The app prompts for biometric re-authentication when returning from the background to the foreground.

**Custom server URL** — the server address is configurable from the login screen and stored in the secure store. This enables white-label deployments where multiple organizations use the same app binary pointed at different servers.

**No backend data retention** — Vigil Mobile fetches data directly from the customer's Vigil Platform server. No event data, snapshots, or personal information passes through or is retained by any intermediary service.

**Map tiles** — tile requests are proxied through the Vigil Platform server when a commercial tile provider is configured — the API token is never exposed to the mobile client.

---

## Platform Feature Status

| Feature | iOS | Android |
|---|---|---|
| Authentication (Bearer + secure store) | ✓ | ✓ |
| Custom server URL | ✓ | ✓ |
| Biometric login (Face ID / fingerprint) | ✓ | ✓ |
| Real-time WebSocket feed | ✓ | ✓ |
| Thai / English language switch | ✓ | ✓ |
| iPad / tablet two-pane layout | ✓ | ✓ |
| Dark / light / auto theme | ✓ | ✓ |
| Cameras tab (full) | ✓ | ✓ |
| Alerts tab | ✓ | ✓ |
| Events tab | ✓ | ✓ |
| Stats tab | ✓ | ✓ |
| Map tab | ✓ | ✓ |
| Push notifications (Alert) | ✓ | ✓ |
| Push notifications (Face) | ✓ | ✓ |
