# CODEX_Audit_5th_summary.md — Overall Review & Customer Positioning

Audit date: 2026-07-21  
Auditor: Codex  
Scope: overall product review after optimization and security audit, covering Centralize + Edge Site.

## 0. Overall Assessment

**Fact**

- Vigil Platform is no longer a simple Bosch MQTT dashboard. It is now a production CCTV analytics platform with multi-vendor ingest, LPR, face/body appearance analytics, reports, LINE alerts, health monitoring, PM2 operations, multi-site RBAC, and Edge Site architecture.
- The architecture is suitable for Thailand/on-prem deployments: self-hosted PostgreSQL, local media custody, Cloudflare Tunnel ingress, LINE integration, white-labeling, Thai/English UI, and edge nodes for remote sites.
- The codebase has matured through repeated hardening: auth-gated media, CSP, PM2 workers, route module extraction, edge bridge queue, retention split, camera credential encryption design, and multi-site controls.
- Remaining weaknesses are mostly scale/ops/security-hardening items rather than missing core functionality.

**Opinion**

ภาพรวมควรนำเสนอเป็น “ระบบ Security Operations Platform แบบ on-prem/edge-ready” ไม่ใช่แค่ event dashboard. จุดขายหลักคือ **ควบคุมข้อมูลเอง, รองรับหลายยี่ห้อ, deploy ได้ทั้ง Central และ Edge, แจ้งเตือน LINE, มีรายงาน/health/forensic workflow ครบ**. แต่ก่อนเสนอ site ใหญ่ควรปิด hardening บางจุดให้ชัด: legacy `/lpr`, NanoMQ edge lock-down, DB partitioning, health performance guard, and file-permission checks.

## 1. จุดเด่นที่ควรนำเสนอลูกค้า

### 1.1 On-prem / PDPA-Friendly Data Custody

- ภาพ CCTV, face, LPR, clips เก็บในระบบของลูกค้า ไม่ต้องส่ง vendor cloud โดย default.
- Edge Site ส่ง metadata/filename เข้า Central; image bytes อยู่ที่ edge และดึงผ่าน proxy เมื่อต้องดู.
- Retention แยกตาม data class: general events, LPR, images, rawXml, clips, edge images.

**ข้อความขายที่แนะนำ:**  
“ข้อมูลภาพและเหตุการณ์อยู่ใน infrastructure ของลูกค้า คุม retention ได้ตาม policy และลด vendor lock-in”

### 1.2 Multi-Vendor + Edge Architecture

- รองรับ Bosch MQTT/ONVIF-EJ, Hikvision ISAPI/push, Dahua CGI/RPC, LPR/ANPR push.
- Edge node ช่วยดึงกล้องใน local LAN แล้ว bridge กลับ Central ผ่าน WSS/Cloudflare.
- เหมาะกับหลายสาขา, โรงงาน, อาคาร, retail, school, หรือ site ที่ Central เข้า LAN กล้องไม่ได้.

**ข้อความขายที่แนะนำ:**  
“เพิ่ม site ใหม่ได้โดยติด Edge box ใน LAN กล้อง แล้วรวมเหตุการณ์กลับศูนย์กลางโดยไม่ต้องเปิด inbound port เข้ากล้อง”

### 1.3 Operator Workflow ครบกว่า VMS ทั่วไป

- Dashboard live events, snapshots, map, health, reports, LINE alerts.
- LPR มี watchlist, alert ack, mismatch suspect, no-read view, vehicle attributes.
- Face/body pages มี search, match/miss, appearance filters, timeline/similar search.
- Health page เห็น service status, cameras, storage, edge status, bridge status.

**ข้อความขายที่แนะนำ:**  
“ไม่ใช่แค่ดูภาพย้อนหลัง แต่ช่วย operator ตัดสินใจจาก event, plate, face/body, health, and alerts”

### 1.4 Thai-First Commercial Fit

- LINE alert/scheduled reports เหมาะกับ workflow ไทย.
- Thai/English UI และ report paths รองรับ bilingual operation.
- White-label branding อยู่ใน system settings.

**ข้อความขายที่แนะนำ:**  
“ออกแบบให้เข้ากับงาน security operations ในไทย: LINE, ภาษาไทย, รายงาน, และการปรับแบรนด์”

### 1.5 Production Operations

- PM2 process split ลด blast radius: api, mqtt subscriber, media recorder, ingesters, alert/report workers, lpr receiver.
- Health page มี service control และ visibility.
- Backup/restore/migration docs มีแนวทางชัดเจน.

**ข้อความขายที่แนะนำ:**  
“ระบบไม่ได้เป็น script เดี่ยว แต่มี process management, health monitoring, backup, and controlled deployment workflow”

## 2. จุดด้อย / ความเสี่ยงที่ควรจัดก่อน scale ใหญ่

### 2.1 Scale Readiness ยังมี Gate

- Long LPR retention ยังไม่ควรเปิดเป็นปีจนกว่า `events`/`license_plates` partition strategy จะ live.
- Health endpoint ยังเดิน snapshot tree ใน request path.
- LPR image retention ฝั่ง central ยัง per-file walk.
- บาง list endpoints ยัง exact count/offset.

**ข้อเสนอ:** ทำ P1 optimization ก่อนขาย deployment ระดับหลายล้าน record/month.

### 2.2 Edge Security ต้องทำเป็น Production Profile

- NanoMQ template ยังเป็น POC-friendly: anonymous, `0.0.0.0`, admin/public.
- Edge `.env` template เรื่อง `CAMERA_SECRET_KEY` ต้องแก้ให้ตรง docs.
- Receiver surfaces ต้องมี WAF/rate-limit/source control.

**ข้อเสนอ:** ทำ “Edge Production Hardening Checklist” แยกจาก install guide.

### 2.3 Legacy Compatibility Surface

- `POST /lpr` legacy unauthenticated ยังอยู่เพื่อ backward compatibility.
- URL path tokens ใช้งานได้จริง แต่ต้องมี rotation/log policy.

**ข้อเสนอ:** กำหนด migration deadline ไป `/lpr/:token` ทุกกล้อง.

### 2.4 Test Coverage ยังไม่ครอบ Production Boundary

- มี unit tests หลายส่วน แต่ route/auth/CSP/media/site-scope smoke tests ยังควรเพิ่ม.
- Multi-site RBAC เป็น app-layer; future route อาจลืม `siteWhere()`.

**ข้อเสนอ:** เพิ่ม security smoke suite ก่อน multi-customer shared Central.

## 3. Customer Presentation Strategy

### ควรพูดให้เด่น

1. **Data ownership:** ลูกค้าเป็นเจ้าของข้อมูลและ source/deploy stack.
2. **Multi-site architecture:** Central + Edge ทำให้ขยาย site ได้.
3. **Vendor interoperability:** ไม่ล็อกกับ Bosch/Hik/Dahua เจ้าเดียว.
4. **Actionable alerts:** LINE, watchlist, offline alerts, reports.
5. **Forensic search:** LPR/face/body filters และ timeline.
6. **Operational health:** ดูกล้อง/service/disk/edge ในที่เดียว.

### ควรพูดอย่างระวัง

- Face/gender/age attributes เป็น camera classifier ควรใช้เป็น soft filter ไม่ใช่ identity proof.
- Dwell time ข้าม vendor มี semantics ต่างกัน.
- LPR no-read/unknown เป็น camera/OCR reality; ระบบช่วยแยกและวัดได้.
- Retention ยาวต้องขึ้นกับ sizing + partition + policy.

### ไม่ควรสัญญาเกินจริง

- ห้ามสัญญาว่า AI จับได้ 100%.
- ห้ามสัญญาว่า Edge offline แล้วไม่มีข้อมูลหาย ถ้า queue เต็ม/อินเทอร์เน็ตล่มนานเกิน capacity.
- ห้ามบอกว่า public internet เปิดตรงถึงกล้อง; architecture คือ tunnel/edge bridge ไม่ใช่เปิด camera inbound.

## 4. Recommended Packaging

### Package A — Central Only

เหมาะกับ site เดียวหรือกล้องอยู่ LAN เดียวกับ server.

- Central server + PostgreSQL + EMQX + PM2 workers
- Dashboard + LINE + reports + health
- Direct camera ingest

**ขายง่าย:** install ง่ายกว่า, latency ต่ำ, ops รวมจุดเดียว.

### Package B — Central + Edge Site

เหมาะกับหลายสาขา / remote camera LAN / ลูกค้าที่ไม่อยากเปิด inbound network.

- Central dashboard/database/reporting
- Edge N150/Linux Mint box per site
- Local NanoMQ + ingesters + bridge + cloudflared
- Edge image custody + Central metadata

**ขายง่าย:** ขยาย site ได้, ลด network complexity, เหมาะกับ on-prem PDPA.

### Package C — High-Volume LPR

เหมาะกับ checkpoint/ทางเข้าออก/โรงงานที่รถเยอะ.

- LPR retention tuned
- Dedicated storage sizing
- Partitioned DB
- Watchlist/ack/no-read/mismatch
- Optional long plate-log retention

**ต้องทำก่อนขายจริง:** partitioning + storage/runway monitoring.

## 5. Best Next Engineering Plan

**ก่อน demo ลูกค้าใหญ่**

1. Clean hygiene: `cameras-config.json` permission, `.DS_Store`, edge template fix.
2. Add Health timing/cache.
3. Add Edge Production Hardening Checklist.
4. Add smoke tests for auth/media/CSP/site-scope.

**ก่อน deploy หลาย site**

1. Lock NanoMQ/Edge firewall.
2. Remove legacy `/lpr`.
3. EMQX deny-by-default ACL.
4. Bridge queue alerts and edge disk runway.

**ก่อน LPR volume ใหญ่**

1. Central LPR dir-age retention.
2. Partition `events` and decide `license_plates`.
3. Extend cursor/estimate pagination.
4. Cache/materialize `/api/lpr/stats`.

## 6. Final Positioning

Vigil Platform มีจุดแข็งด้าน practical integration และ on-prem operations ชัดมาก เหมาะกับลูกค้าที่ต้องการระบบ CCTV analytics ที่ปรับแต่งได้เอง ไม่ติด vendor cloud และเชื่อม LINE/workflow ไทยได้จริง.

จุดที่ควรจัดต่อไม่ใช่การ rewrite แต่เป็น hardening แบบ production: scale guard, edge security profile, automated smoke tests, and partition/storage lifecycle. ถ้าปิดชุดนี้ ระบบจะพร้อมนำเสนอเป็น platform สำหรับ multi-site security operations ได้มั่นใจกว่าเดิมมาก.
