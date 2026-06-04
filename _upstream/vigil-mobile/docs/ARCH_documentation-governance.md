# ARCH_documentation-governance — Vigil Mobile

> **Doc Registry & Governance** — Single source of truth for documentation
> management. Living Docs adapted from vigil-platform (smaller, mobile-specific).
> Updated 2026-05-31

---

## Registry Table

ทุกไฟล์ที่ agent ต้องรู้ ถ้าไม่อยู่ใน table นี้ = ไม่มีอยู่จริงสำหรับ agent

| File | Living Docs Role | Owns | Must NOT contain | Load when |
|---|---|---|---|---|
| `CLAUDE.md` | Entry point | Working Agreement, model assignment, architecture overview, feature status, constraints, owner communication | Detailed implementation, full design rationale, pattern code, phase samples | ทุก session — อ่านก่อนเสมอ |
| `README.md` | Public overview | install, feature list, architecture overview, key technical decisions | Working Agreement (→ CLAUDE.md), internal gotchas | First-time onboarding, customer-facing |
| `PATTERNS.md` | `GUIDE_` — Code patterns | 12 patterns ที่ใช้ทั่วโครงการ (Zustand, hook, API, screen, modal, theme, WS, SVG, WebView, save image, push guard) | Phase-specific implementation (→ PHASE_SAMPLES.md), bug history | สร้าง store/hook/screen/component ใหม่ |
| `PHASE_SAMPLES.md` | `GUIDE_` — Phase starter code | Starter code ของทุก phase ใน ROADMAP (1A→6F) — biometric, custom URL, camera scale, detail, i18n, tablet, polish | Generic patterns (→ PATTERNS.md), bug fixes | ขึ้น phase ใหม่ตาม ROADMAP |
| `ROADMAP.md` | `REFACTOR_TODO` | Phase ordering (1→6), UI/UX assessment, design ของแต่ละ phase, postponed items | Completed work, code samples (→ PHASE_SAMPLES.md) | Planning, ลำดับงาน, scope decisions |
| `GOTCHAS.md` | `INCIDENT_` | Known issues + root cause + fix + lesson (#1-#11: Android segments, Expo Go media-library, biometric loop, i18n concurrent render, reanimated v4, Metro cache, GHRootView) | Design rationale (→ PATTERNS.md), workarounds ที่ไม่ใช่ incident-based | Debugging, before touching system ที่มี GOTCHA |
| `docs/GUIDE_eas-deployment.md` | `GUIDE_` — EAS deploy | EAS build + credentials (APNs/FCM) + dev-build verify (push/save/video/badge), projectId, step-by-step | Feature logic (→ PATTERNS.md), bug history (→ GOTCHAS.md) | Dev/prod build, push integration, EAS setup |
| `docs/ARCH_documentation-governance.md` | Registry (this file) | File registry, task→load mapping, naming convention | Feature logic, code patterns | Doc management, adding new files, scope unclear |

---

## Task → Load Mapping

| Task | Files to load |
|---|---|
| General technical work | `CLAUDE.md` only |
| สร้าง store/hook/screen/component ใหม่ | + `PATTERNS.md` |
| ขึ้น phase ตาม ROADMAP (1A→6F) | + `PHASE_SAMPLES.md` + `ROADMAP.md` |
| Planning, next-feature selection | + `ROADMAP.md` |
| Debugging, incident | + `GOTCHAS.md` |
| UI/design/responsive | + `PATTERNS.md` (#6 Theme) + relevant phase sample |
| Push noti / backend integration | + `PATTERNS.md` (#11 push guard) + cross-reference vigil-platform `alert-engine.js` + `push-sender.js` |
| EAS build / dev build / credentials | + `docs/GUIDE_eas-deployment.md` |
| Doc management / scope unclear | `docs/ARCH_documentation-governance.md` (this file) |

---

## Naming Convention (Living Docs roles)

ใช้ prefix ในชื่อไฟล์ใน `docs/` ถ้าเพิ่มใหม่:

| Prefix | ความหมาย | ตัวอย่าง |
|---|---|---|
| `ARCH_` | System architecture / governance | `ARCH_documentation-governance.md` |
| `LOGIC_` | Feature behavior rationale | `LOGIC_auth-flow.md` (ถ้าเพิ่มอนาคต) |
| `GUIDE_` | How-to / patterns / samples | `PATTERNS.md`, `PHASE_SAMPLES.md` |
| `REF_` | Reference / lookup tables | (ยังไม่มี) |
| `INCIDENT_` | Bug history | `GOTCHAS.md` |

ไฟล์ที่อยู่ใน root (CLAUDE.md, README.md, ROADMAP.md) ใช้ชื่อเดิม

---

## Maintenance Rules

1. **เพิ่มไฟล์ใหม่ → ต้องบันทึกใน Registry Table นี้** ก่อนใช้งาน
2. **Cross-reference ใช้ `→`** เพื่อบอก "ดูที่ไฟล์อื่น" (เช่น "Design rationale → PATTERNS.md")
3. **Must NOT contain** = boundary ของไฟล์ ห้ามทำซ้ำเนื้อหาข้าม files
4. **Updated date** ใน footer ทุกไฟล์ — บอกว่าใครแก้ครั้งล่าสุด

---

## Cross-repo reference

| ทำงานเกี่ยวข้องกับ vigil-platform | ไฟล์ใน vigil-platform |
|---|---|
| Backend push hook | `vigil-platform/src/alert-engine.js` + `push-sender.js` |
| API contract | `vigil-platform/src/api-server.js` (grep endpoint) |
| Working Agreement (vigil-platform version) | `vigil-platform/CLAUDE.md` |
| Backend Living Docs | `vigil-platform/docs/ARCH_documentation-governance.md` |

---

<sub>Updated 2026-06-01 · Vigil Mobile Living Docs registry · เพิ่ม GUIDE_eas-deployment.md</sub>
