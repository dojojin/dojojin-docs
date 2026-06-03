---
title: Vigil Platform
description: Self-hosted CCTV analytics platform — multi-vendor event ingestion, real-time monitoring, LINE notifications, and PDPA-compliant data management. On-premise. No vendor lock-in.
---

# Vigil Platform

Vigil Platform is a self-hosted CCTV analytics system built for organizations that need more than a conventional NVR — intelligent alerting, multi-vendor camera consolidation, and full data ownership under a single dashboard.

The name comes from the English word *vigil* — a period of watchful wakefulness. That is what the platform does: monitor every camera around the clock, detect events, notify the right people, and record everything automatically, without requiring a human to watch at all times.

**Current version:** v1.5.1 — production-ready, deployed in live environments.

---

## Who It Is For

Vigil Platform is designed for organizations that already operate CCTV cameras and need analytics, intelligent alerting, and verifiable data governance on top:

| Segment | Typical Scale | Core Need |
|---|---|---|
| Offices, Government, Banking, Healthcare | 100–500 cameras | Unified dashboard, LINE alerts, PDPA compliance |
| Airports, Universities, Convention Centers | 200–1,000 cameras | Multi-vendor consolidation, custom reports, visitor analytics |
| Factories, Warehouses, Industrial | 50–2,000 cameras | Perimeter analytics, long retention, operational intelligence |
| Retail (Malls, Convenience, Outlet) | 30–500 cameras | People counting, traffic analytics, multi-branch |
| Education | 50–500 cameras | Student safety, strict PDPA, budget-constrained |

---

## Core Capabilities

### Multi-Vendor Event Ingestion

Vigil ingests security events from cameras of different manufacturers through a vendor-neutral pipeline. The alert engine, analytics, reporting, and dashboard contain no vendor-specific logic — adding a new camera type requires only a new ingester module.

Supported protocols:

- **Bosch BVMS** — MQTT over ONVIF Profile M; supports IVA Pro and IVA Basic event types (Crossing Line, Object In Field, Loitering, Counting, and more)
- **Hikvision** — ISAPI HTTP alert stream; Smart Events and Face Capture
- **Dahua** — CGI VCA events: Line Crossing, Intrusion, Smart Motion; pre-alarm RTSP clips
- **ONVIF generic** — Monitor-only mode (live snapshot + reachability probe); full event ingestion on the roadmap

### Real-Time Monitoring

Every camera is probed on a heartbeat cycle. Status transitions from online to offline are detected within 90 seconds and trigger notifications.

The **Security Morning Briefing** dashboard gives operators an immediate operational picture:

- Status strip across all cameras
- Attention alerts from the past 4 hours
- 24-hour activity timeline
- Site map with live event overlay
- Top 5 hotspot cameras by event volume

Camera snapshots are delivered via a live proxy with automatic fallback. KPI counts (cameras online, events today, disk usage) are updated server-side with correct timezone handling.

Cameras can be organized into groups by floor, building, or zone. The dashboard supports per-group tab filtering. Every incoming event produces a toast notification visible across all pages, with burst throttling so high-frequency cameras do not flood the interface.

### Event Management and Analytics

Events are stored with full metadata and are searchable, filterable, and paginatable server-side. Filters include camera, rule name, event class, vendor, and date range.

**Stats v2** provides:

- KPI cards by event category
- Distribution breakdown (pie chart)
- Per-camera event timelines
- Activity Heatmap — hours of day versus day of week
- Top rules and quietest cameras
- CSV export
- Click-to-drill-down on any chart element into the raw event list

**Density Over Time** tracks people-count aggregations (from compatible cameras) and displays trends with median smoothing pushed via WebSocket.

Event categories and their icons and colors are configurable by administrators.

### Alerting and Reporting

**LINE Notifications** — Vigil's built-in LINE integration sends alert messages with snapshots directly to individual users or group chats in under 5 seconds from event detection.

**Camera Offline Alerts** — When a camera transitions to offline, a LINE notification is sent with the camera name and how long it has been unreachable. Repeat interval, escalation, and recovery notifications are configurable.

**Analytics Reports** — Four report types (daily, weekly, monthly, custom range) rendered as PDF or PNG. Reports are delivered automatically to LINE on a schedule and retained for 90 days in Report History.

**Health Report** — System-wide status report rendered as a PNG image with five configurable sections: camera uptime summary, event volume, disk usage, alert activity, and image quality assessment (bright/dark/blurry/scene-change per camera over 24 hours). The banner automatically flags when more than 50% of cameras are offline or disk usage exceeds 85%.

### Face Capture (Hikvision)

For Hikvision cameras with Face Capture capability, Vigil captures and stores face crops alongside the full background image. Each face record includes demographic attributes detected by the camera firmware: approximate age range, gender, emotion, and attributes such as mask, glasses, or hat. Images are stored locally on the server — no cloud storage. A filterable gallery and per-face detail modal are available in the dashboard.

### Pre-Alarm Video Clips

A rolling RTSP buffer records continuously from a configurable sub-stream. When an event triggers, the system dumps a clip with a configurable number of seconds before and after the event. Clips are accessible from the event detail view and can be played back in the mobile app. This feature is available for all three supported vendors.

### Map View

Cameras are plotted on a real geographic map using OpenLayers 9. Features include:

- **Multi-group color-coded overlay** — each camera group has its own pin color and ring; groups can be hidden or shown individually
- **Live Pulse** — when an event arrives, a floating card with snapshot and event type appears above the camera's map pin in real time; debounced per camera to avoid clutter
- **Heatmap** — 24-hour event density rendered as a color overlay; click any zone to drill down to the event list
- **Wall Mode** — fullscreen map with sidebar and header hidden, suitable for SOC displays and TV walls
- **Camera popup** — tap any pin to see current status, last-seen time, top event rules in the past 24 hours, and the latest snapshot
- **Offline tile cache** — map tiles can be downloaded in advance for a user-defined bounding box and zoom range; the map functions without internet connectivity, suitable for isolated networks

### Maintenance Mode

Any camera can be placed into Pause / Maintenance Mode while work is performed. While paused:

- The ingester stops processing events for that camera
- LINE offline alerts are suppressed
- The camera card shows a maintenance indicator instead of a live feed
- The pause period is excluded from uptime percentage calculations
- Every pause and resume is written to the audit log with timestamp and operator

### System Health Dashboard

An admin-only page that auto-refreshes every 15 seconds reports: database latency, event rate, MQTT pipeline freshness, camera online/offline counts, snapshot file counts and sizes, disk free/total, process uptime and memory, WebSocket client count, system load average, and image quality per camera.

Service management controls allow administrators to restart individual services without SSH access. All service management actions are written to the audit log.

---

## Key Benefits

**Full data ownership.** All camera events, snapshots, face images, and reports are stored on the customer's own server. No data leaves the premises without explicit configuration.

**No vendor lock-in.** Cameras from multiple manufacturers coexist on a single dashboard. Changing or adding camera hardware does not require replacing the analytics platform.

**One-time licensing model.** Vigil is purchased as a perpetual license (G1 through G5 tiers by camera count) with annual maintenance. There is no per-camera monthly subscription.

**Source code access.** Customers receive the full source code under license. The platform can be customized, extended, or audited internally.

**White-label ready.** Logo, colors, and brand name are configurable per deployment. System integrators and resellers can deliver Vigil under their own brand name.

**Bilingual interface.** The dashboard and reports are fully bilingual (Thai and English) with instant switching.

**Deployment flexibility.** Vigil runs on Docker Compose on customer-owned Linux hardware. A Cloudflare Tunnel is used for remote access without opening inbound firewall ports.

---

## System Architecture

Vigil Platform is organized into four layers:

**Ingestion Layer** — Vendor-specific ingester processes connect to camera systems and translate proprietary event formats into a normalized internal schema. An EMQX 5.8 MQTT broker handles Bosch camera connections and automatically provisions per-camera credentials when a new Bosch camera is added.

**Processing Layer** — A Node.js API server handles authentication, authorization, business logic, alert rule evaluation, and report generation. WebSocket connections push snapshot streams and real-time event notifications to connected browsers and mobile clients.

**Storage Layer** — PostgreSQL 16 stores all events, camera metadata, user accounts, alert rules, LINE configuration, face images, audit logs, and reports.

**Presentation Layer** — A 15-page single-page application built for speed. Pages load in under 2 seconds with server-side pagination and caching.

**Deployment profiles:**

| Profile | Includes |
|---|---|
| A | Event ingestion, statistics, LINE alerts |
| B | Profile A + live snapshots |
| C | Profile B + pre-alarm video clips |

**License tiers by camera count:**

| Tier | Cameras |
|---|---|
| G1 Starter | Up to 100 |
| G2 Standard | Up to 500 |
| G3 Pro | Up to 1,000 |
| G4 Enterprise | Up to 2,000 |
| G5 Datacenter | Up to 3,000 |

**Measured performance (v1.5.0 production):**

- Alert latency from event to LINE push: under 5 seconds
- Dashboard page load: under 2 seconds

---

## Security

Vigil Platform underwent a formal security audit covering the full codebase: backend API, frontend, database, and infrastructure. The audit followed the OWASP Top 10 methodology and included PDPA compliance verification.

**17 security issues were identified and all 17 have been resolved.**

### Authentication and Authorization

- Passwords are hashed with bcrypt. Sessions use HMAC-SHA256 signing with a 7-day token lifetime and a 15-minute idle timeout.
- **Brute-force protection** — five consecutive failed login attempts lock the account for 15 minutes.
- **Triple-layer session handling** — ensures correct behavior on browsers with aggressive third-party cookie restrictions, including Safari ITP.
- **Role-based access control (RBAC)** with three levels: admin (full access), viewer (read-only), auditor (read + export; all write requests are blocked at the server middleware level, not only in the UI).
- **Server-side password-change enforcement** — users flagged with a mandatory password change cannot call any API endpoint until they comply. This is enforced in server middleware.
- All WebSocket connections require JWT authentication on upgrade.

### Data Protection

- Camera credentials are encrypted at rest using AES-256-GCM. The encryption key is stored separately from the configuration file.
- Camera passwords are masked in logs. They are only returned in plaintext to administrator sessions for pre-filling edit forms; viewer and auditor sessions receive redacted values.
- API error responses return generic messages to clients. Full stack traces are written only to server-side logs.
- File uploads are validated against magic bytes (actual file header bytes), not MIME type from the browser. SVG files disguised with an image extension are rejected.
- Map tile API tokens are never exposed to the browser. All tile requests are proxied server-side.

### Network and Protocol Security

- **CORS** is locked to a whitelist of approved domains.
- **MQTT access control** — the EMQX broker requires per-camera credentials. Anonymous connections are disabled.
- **PostgreSQL transport** — TLS 1.3 is enabled on the database server.
- **CSRF** — SameSite cookie policy and token-based validation prevent cross-site request forgery.
- **SQL injection** — all database queries use parameterized statements throughout.
- **XSS** — all event and camera data rendered into HTML is HTML-escaped. Content Security Policy headers with nonce are applied.
- **Path traversal** — strict path validation prevents directory traversal on file-serving endpoints.

### License Integrity

The license system uses Ed25519 asymmetric cryptography. A license key cannot be forged without access to the private signing key. Licenses are bound to the deployment machine and specify a camera-count ceiling enforced at runtime.

### PDPA Compliance

Vigil Platform is designed for compliance with Thailand's Personal Data Protection Act:

- **Data residency** — all personal data is stored on the customer's own server. No cross-border data transfer occurs without explicit customer configuration.
- **Automated data purge** — three background jobs run nightly to delete events, snapshots, and video clips beyond the configured retention period.
- **Consent for LINE notifications** — a LINE user must actively follow the system's official account and be approved by an administrator before receiving any notifications.
- **On-demand deletion of biometric data** — face images can be deleted individually or in bulk through the admin interface.
- **Audit trail** — all user actions that create, modify, or delete data are written to a structured audit log with user ID, action type, resource reference, and timestamp. Active sessions can be reviewed and individually revoked by administrators.

### OWASP Top 10 Coverage

| Category | Status |
|---|---|
| A01 Broken Access Control | Resolved — RBAC middleware on all endpoints |
| A02 Cryptographic Failures | Resolved — Ed25519 license; TLS on all connections |
| A03 Injection | Resolved — parameterized queries throughout |
| A04 Insecure Design | Addressed — PDPA by design; data isolation |
| A05 Security Misconfiguration | Addressed — strict CORS; MQTT ACL |
| A06 Vulnerable Dependencies | Monitored — patched within 7 days of CVE release |
| A07 Authentication Failures | Resolved — 15-minute idle timeout; brute-force lockout |
| A08 Data Integrity Failures | Resolved — magic bytes file validation; Ed25519 license |
| A09 Logging Failures | Improved — structured audit log on all write actions |
| A10 SSRF/XXE | Safe — no user-controlled URLs; JSON-only API |

---

## Integrations

### LINE Notifications

LINE is integrated natively into Vigil Platform. Alerts are sent with snapshot images attached, directly to individual LINE users, group chats, or rooms.

**Alert message content:**
- Snapshot image from the camera at the time of the event
- Camera name and group/zone
- Event type and timestamp
- Name of the alert rule that triggered

**Quiet hours** — each alert rule can have a defined quiet window. The system suppresses LINE messages during that window but continues recording events in the dashboard.

**60-second cooldown** — repeated triggers from the same rule within 60 seconds are consolidated to prevent notification flood.

**Self-service onboarding** — administrators share a QR code. Staff scan it, follow the LINE official account, and request access. The administrator approves in the dashboard. Access is revoked by removing the user from the recipient list.

**Camera offline alerts** — sends a LINE notification when a camera goes offline; sends a recovery notification when it comes back online.

**Scheduled reports** — the Health Report and Analytics Report can be sent automatically to a LINE group on a daily, weekly, or monthly schedule.

---

## Roadmap

The following capabilities are planned for future phases:

- **ONVIF generic event ingestion** — full event processing for cameras not covered by the current vendor-specific ingesters
- **Event workflow** — acknowledge, dismiss, and escalate events from the dashboard
- **Face Recognition AI** — vector-based person re-identification using face embeddings
- **Anomaly detection** — statistical detection of unusual crowd density or prolonged inactivity in a zone
- **Email alerts** — SMTP-based alert delivery as an alternative to LINE
- **Webhook integrations** — outbound webhook delivery to third-party systems
