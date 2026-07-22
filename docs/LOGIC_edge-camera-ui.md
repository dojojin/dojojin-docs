// ============================================================
// Vigil Platform — LOGIC_edge-camera-ui
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

# LOGIC_edge-camera-ui — Vigil Platform

> Design rationale — **manage edge-site cameras from the central dashboard**
> (no SSH / no hand-edited JSON / no pm2 restart / with audit + RBAC).
> Builds on the multi-site bridge already shipped (provision engine, EMQX
> per-site ACL, subscriber `projects/+/#` ingest — see [[project_lpr_gallery]]
> / [[project_multisite_camera_sites]]).
> Status: **DESIGN (not built)** · 2026-06-24. Pending work → ROADMAP.

---

## 1. Problem (today)

Adding/editing a camera on a remote edge site is a manual, error-prone chain:

```
SSH เข้า N150 → แก้ cameras-config.json มือ → pm2 restart → กลับมาแก้ central อีกที
```

Failure modes:
- **ทำผิดง่าย** — แก้ JSON มือ (comma/quote/encrypt creds พลาด → ingester ตาย)
- **ไม่มี audit trail** — ใครแก้อะไรเมื่อไหร่ ไม่รู้
- **operator ทำเองไม่ได้** — ต้องมี SSH + รู้ JSON + รู้ pm2 = วิศวกรเท่านั้น
- **drift** — config ที่ edge กับที่ central ไม่ตรงกัน (แก้คนละที่)

## 2. Key insight — กลไกที่มีอยู่แล้ว ใช้ซ้ำได้เกือบหมด

ฝั่ง **central (เครื่องเดียว) ทำงานนี้อยู่แล้ว** — ไม่ต้องประดิษฐ์ใหม่:

| ชิ้นส่วน | มีแล้วที่ไหน |
|---|---|
| **Dual-write** DB + `cameras-config.json` ตอนแก้กล้อง | `routes/cameras.js` (PUT/pause — "Dual-write … fs.watch") |
| **Live-reload** ไม่ต้อง restart | `mqtt-subscriber.js:82-104` `fs.watch` + `loadCameraConfig` (และ ingester อื่น) |
| **Camera Settings UI** (vendor/ip/creds/cam_role/**site_id**/toggles) | `page-camera-settings.js` |
| **RBAC site-scope** (operator เห็นเฉพาะ site ตัวเอง) | `routes/cameras.js:404-408` `user_sites` (admin = all; fail-open) |
| **Audit** ใครแก้กล้อง | `audit_log` (`camera_update` / `camera_pause`) |
| **MQTT bridge** edge↔central + per-site ACL | provision engine + `projects/{site}/#` ( shipped) |
| **Encrypt creds** | `crypto-creds.js` `encryptCamCreds`/`decryptCamCreds` |

→ **สิ่งเดียวที่ขาด** = ส่ง config ไปอัปเดต `cameras-config.json` ของเครื่อง **edge ที่อยู่ไกล (หลัง NAT)**. ที่เหลือ (UI/DB/reload/audit/RBAC) reuse ได้.

## 3. Design — central = source of truth, edge auto-syncs

```
Operator → Dashboard (central)
   │  Camera Settings (เดิม) — เลือก Site = vss
   ▼
PUT /api/cameras  ──►  ① DB cameras (เดิม)
                       ② cameras-config.json ของ central (เดิม)
                       ③ 🆕 publish per-site config → MQTT retained
                          topic: projects/<site>/_config/cameras
                       ④ audit_log (เดิม)
   │ (ผ่าน bridge เดิม — edge subscribe topic นี้)
   ▼
Edge agent  ──►  เขียน cameras-config.json (local) → fs.watch reload (เดิม)
            ──►  publish ack: projects/<site>/_config/ack {version, applied_at}
```

**หลักการ:**
- **central DB = single source of truth** สำหรับกล้องทุก site (มี `site_id` แล้ว)
- **edge's `cameras-config.json` = cache** — ห้ามแก้มือ (แก้แล้วโดน overwrite ตอน push ครั้งหน้า) → ฆ่า drift
- **delivery = MQTT retained** (ไม่ใช่ HTTP/edge-pull) เพราะ:
  - reuse bridge ที่ทำแล้ว · edge อยู่หลัง NAT (ไม่มี inbound port)
  - **retained** = edge ที่เพิ่ง online ได้ config ล่าสุดทันที (sync-on-connect)
  - ไม่ต้อง poll / ไม่ต้องเปิด port ที่ edge

**ทำไมไม่ pm2 restart:** `fs.watch` + `loadCameraConfig` reload เองอยู่แล้ว — edge เขียนไฟล์เสร็จ ingester ก็ใช้ config ใหม่ทันที (เหมือน central วันนี้)

## 4. UI — ต่อยอดจากของเดิม (ไม่สร้างหน้าใหม่)

**Camera Settings (page-camera-settings.js) ทำได้เกือบหมดแล้ว** — มี site dropdown + cam_role + ทุก field. เพิ่ม:

1. **Filter/group ตาม Site** ในหน้า Cameras — operator (RBAC `user_sites`) เห็นเฉพาะ site ตัวเอง · admin เห็นทุก site + filter
2. **Edge status chip** ต่อ site (จากหน้า Sites ที่มี "Edge ↗") — online/offline + "config v5 applied / pending" (จาก ack topic) → operator รู้ว่า edge รับ config แล้วหรือยัง
3. **"Apply to edge" feedback** — บันทึกกล้อง site ที่เป็น edge → toast "ส่งไป edge แล้ว · รอ ack" → เขียวเมื่อ edge ack กลับ
4. กล้อง edge แสดง badge "Edge: <site>" ในการ์ด (แยกจากกล้อง central)

## 5. Enhancements (เสริมจาก design พื้นฐาน)

| # | เสริม | ทำไม |
|---|---|---|
| E1 | **Config version + ack loop** — central stamp `version`; edge ack `{version, applied_at}` → central โชว์ "v5 applied" vs "pending" | ปิด loop — operator มั่นใจว่า edge **ใช้** config จริง ไม่ใช่แค่ส่งไป |
| E2 | **Offline = queued (inherent retained)** — edge offline → retained topic ถือ config ล่าสุด → apply ตอน reconnect; UI โชว์ "รอ edge online" | ไม่ต้องทำ queue เอง |
| E3 | **Rollback** — เก็บ config version history (central) → ปุ่ม "ย้อนเวอร์ชัน" → republish เวอร์ชันเก่า | กู้เร็วเมื่อแก้พลาด |
| E4 | **Creds encryption boundary** — central encrypt creds **per-edge key** ก่อน publish; edge ถือ key ของตัวเอง → decrypt local. central admin เห็น plaintext (เดิม), bridge/EMQX ไม่เห็น | creds ไม่รั่วผ่าน broker |
| E5 | **Conflict rule (documented)** — central wins เสมอ; แก้มือที่ edge = โดนทับ push ครั้งหน้า (UI/doc เตือน) | ฆ่า drift ถาวร |
| E6 | **Dry-run preview** (optional) — diff "ก่อน→หลัง" ก่อน push | กันพลาดบนกล้อง production |
| E7 | **Edge bootstrap** — edge เพิ่ง provision (Sites › Edge ↗) → subscribe `_config/cameras` ทันที → ได้กล้อง site ตัวเองเลย (retained) | onboard ใน 1 จังหวะ |

## 6. Topic / payload contract

```
projects/<site>/_config/cameras   (retain=true, QoS1)
  payload = { version, updated_at, updated_by, cameras: [ <encrypted-cam-config> … ] }
projects/<site>/_config/ack        (edge → central)
  payload = { version, applied_at, ok, error? }
```
- ACL: edge user `edge-<site>` ต้อง subscribe `projects/<site>/_config/cameras` + publish `_config/ack` → เพิ่มใน per-site ACL (provision engine — ปัจจุบัน allow `projects/<site>/#` ครอบอยู่แล้ว ✅)
- central subscribe `projects/+/_config/ack` (เหมือน `projects/+/#` ที่ subscriber ทำแล้ว)

## 7. Phases (implementation)

| Phase | งาน | restart? |
|---|---|---|
| **EC1** | central: publish per-site config → retained topic ตอน PUT/pause กล้องที่ `site_id≠main` (ต่อจาก dual-write เดิม) | api-server |
| **EC2** | edge agent: subscribe `_config/cameras` → เขียน local JSON → reload (มี fs.watch แล้ว) + ack | edge |
| **EC3** | UI: site filter ในหน้า Cameras + edge-status/ack chip (Sites page) | frontend |
| **EC4** | E1 version+ack loop + E3 rollback (config_versions table) | api-server |
| **EC5** | E4 per-edge creds key + E5 conflict doc/warn | both |

**Tier-2 prereq:** `events.site_id` (ยังไม่มี) — เพื่อแยก event ตาม site ตอน ingest (คนละเรื่องกับ config delivery แต่คู่กัน).

## 8. Decisions (ปิดแล้ว 2026-06-24)

1. **Edge runtime thickness** → **Thick edge + central hybrid**
   - Edge (N150) รัน NanoMQ bridge + ingester local → รับจากกล้อง LAN site เอง (ทนเน็ตหลุด)
   - Central ยังรับตรงจากกล้องได้เหมือนวันนี้ (site เล็ก/POC ไม่มี N150 ก็เสียบตรงได้)
   - ผลกระทบ: edge ต้อง decrypt creds local → โยงไป #4

2. **Camera identity** → **Composite `(site_id, camera_id)` — ทำตอน Tier-2**
   - DB unique เปลี่ยนเป็น `(site_id, camera_id)` แทน `camera_id` เดี่ยว → operator ตั้ง `CAM01` ซ้ำข้าม site ได้
   - Topic `projects/<site>/<cam>` นำหน้า namespace ไว้อยู่แล้ว ✅ (ไม่ต้องเปลี่ยน)
   - **defer**: ทำพร้อม `events.site_id` (Tier-2) เพราะแตะ FK หลายจุด ไม่ใช่ blocker EC1

3. **Snapshot locality** → **เก็บที่ edge, ดึง on-demand — defer เลือก stack**
   - รูป scene ไม่ push หมดข้าม tunnel (ลด bandwidth + disk central)
   - Central ถือ metadata + thumbnail (1080p/q80 จาก RF-IMG); ต้นฉบับคมอยู่ edge
   - Stack media (Caddy / MQTT req-resp / HTTP route ใน edge agent) → **defer จนเห็น traffic VSS จริง**
   - "Caddy" = lightweight web server (ตระกูลเดียวกับ nginx) เพื่อเสิร์ฟไฟล์ edge — อาจไม่จำเป็นถ้าใช้ HTTP route ใน agent เอง

4. **E4 key management** → **per-edge key ใน edge `.env` — MVP ข้ามได้**
   - เป้าหมาย: แต่ละ edge มี key ของตัวเอง; central encrypt creds ด้วย key edge ก่อน publish → broker เห็นแค่ ciphertext
   - Rotate: ออก key ใหม่ที่ central → re-encrypt → republish retained config (edge apply เอง)
   - **MVP ข้ามได้**: bridge เป็น WSS + ACL ต่อ site → ความเสี่ยงต่ำพอ; ยก per-edge key ตอน scale หลาย site/ลูกค้า
   - ไม่บล็อก EC1–EC3

---

> เกี่ยวข้อง: [[project_multisite_camera_sites]] (edge arch + DB tiers) · `src/site-provision.js` (provision engine) · `routes/cameras.js` (dual-write+RBAC+audit) · `mqtt-subscriber.js` (fs.watch reload + `projects/+/#` ingest) · DESIGN.md (UI tokens สำหรับ chip/status)
