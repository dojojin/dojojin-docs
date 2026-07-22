# Camera Status — Multi-Site Architecture Plan
**Date:** 2026-06-21  
**Status:** Design / Pre-implementation  
**Demo:** `public/others/demo/site/index.html`

---

## 1. Context & Goal

ระบบปัจจุบันไม่มี concept "Site" — มีแค่ `camera_groups` เดียว (global).  
เป้าหมาย: แยก 3 Site (BMA, ภูเก็ต, Main Site) โดยที่  
- User แต่ละ Site เห็นเฉพาะกล้องของตัวเอง  
- Super Admin / Admin เห็นได้ทุก Site พร้อมกัน  
- กล้องแต่ละตัวสังกัด Site หนึ่ง + Group ย่อยของ Site นั้น  

---

## 2. DB Schema — สิ่งที่ต้องเพิ่ม

### New table: `sites`
```sql
CREATE TABLE IF NOT EXISTS sites (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,  -- 'main' | 'bma' | 'phuket'
  name        VARCHAR(100) NOT NULL,        -- 'Main Site' | 'BMA' | 'ภูเก็ต'
  color       VARCHAR(7) DEFAULT '#5B8DEF', -- hex for UI dot
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO sites (code, name, color) VALUES
  ('main',   'Main Site', '#5b8def'),
  ('bma',    'BMA',       '#22c55e'),
  ('phuket', 'ภูเก็ต',   '#f59e0b')
ON CONFLICT (code) DO NOTHING;
```

### Alter: `cameras` + `camera_groups`
```sql
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS site_id INT REFERENCES sites(id) ON DELETE SET NULL;
ALTER TABLE camera_groups ADD COLUMN IF NOT EXISTS site_id INT REFERENCES sites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cameras_site ON cameras(site_id);
```

### New table: `user_sites` (join table — ถ้า user มีได้หลาย Site)
```sql
CREATE TABLE IF NOT EXISTS user_sites (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, site_id)
);
```
> ถ้า user มี Site เดียว → ใส่ `site_id` column ตรงใน `users` ได้เลย (simpler)  
> เลือก join table เพราะรองรับ expansion ในอนาคต (multi-site viewer)

---

## 3. Auth / RBAC — Role ที่ต้องการ

| Role | เห็น Site | สิทธิ์ |
|---|---|---|
| `super_admin` | ทุก Site | ทำได้ทุกอย่าง |
| `admin` | ทุก Site | ทำได้ทุกอย่าง (แต่แก้ไม่ได้ user ระดับ super_admin) |
| `site_admin` | Site ตัวเอง | จัดการ camera/group ในซร Site |
| `viewer` | Site ตัวเอง | อ่านอย่างเดียว |

ปัจจุบันระบบมี role แค่ `admin` / `viewer` — ต้องเพิ่ม `site_admin` + `super_admin`  
หรือใช้ flag `is_super: boolean` ใน users แทน role ใหม่ถ้าต้องการเร็ว

---

## 4. API — ส่วนที่ต้องแก้

| Endpoint | การเปลี่ยนแปลง |
|---|---|
| `GET /api/cameras` | filter by `site_id` ตาม user.site_ids (unless super_admin) |
| `GET /api/camera-groups` | filter by `site_id` เช่นกัน |
| `GET /api/sites` | **ใหม่** — list sites ที่ user เข้าถึงได้ |
| `GET /api/cameras/stats` | aggregate per site_id |

> Middleware แนะนำ: `requireSiteAccess(site_id)` — inject site filter ก่อน query

---

## 5. Frontend

### Camera Status Page (ปัจจุบัน → แก้ไข)
ดู demo: `public/others/demo/site/index.html`

**ส่วนที่ต้องเพิ่มใน production:**
- Site tabs (ดึงจาก `/api/sites`)
- Summary badges (Online/Offline/Maintenance per site)
- Card: breadcrumb `Site › Group`
- Card: Preview ปรับตาม camera type (IVA/LPR/Face)
- Pagination 10/page (รองรับ 3,000 กล้อง = max 300 หน้า)
- Group filter ปรับตาม site ที่เลือก

### Navigation (global)
- ถ้า super_admin: site switcher ใน nav bar
- ถ้า site_admin/viewer: ไม่ต้อง — เห็น site เดียวโดย default

---

## 6. Migration Plan

```
Migration 052: สร้าง sites table + seed 3 sites
Migration 053: ALTER cameras + camera_groups เพิ่ม site_id
Migration 054: สร้าง user_sites table
Migration 055: Data migration — map กล้องเดิมเข้า Main Site (site_id=1)
```

---

## 7. Camera Type (สำหรับ Preview ใน card)

ขณะนี้ DB ไม่มี column `type` ตรงๆ — type ถูก infer จาก vendor + topic pattern  
แนะนำ: เพิ่ม column `cam_role VARCHAR(20) DEFAULT 'standard'` ใน cameras  
values: `'standard'` (IVA/Event) | `'lpr'` | `'face'`  

```sql
-- Migration 056 (optional — สามารถ infer ได้ถ้าไม่ต้องการ schema เพิ่ม)
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS cam_role VARCHAR(20) DEFAULT 'standard';
```

Preview ตาม type:
- **standard**: Events today + People count
- **lpr**: Vehicles today + เข้า/ออก
- **face**: Faces today + Known/Unknown + Watchlist hit

---

## 8. Phases แนะนำ

| Phase | งาน | Priority |
|---|---|---|
| **MS-1** | Migration 052-053: sites table + FK บน cameras | High |
| **MS-2** | Migration 054-055: user_sites + data map | High |
| **MS-3** | API: filter by site_id + `/api/sites` endpoint | High |
| **MS-4** | Frontend: site tabs + breadcrumb + group filter | High |
| **MS-5** | RBAC: `site_admin` role + middleware | Medium |
| **MS-6** | Migration 056: `cam_role` column | Medium |
| **MS-7** | Card Preview ปรับตาม `cam_role` (LPR/Face) | Medium |
| **MS-8** | Navigation global site switcher (super_admin) | Low |

---

## 9. Open Questions (ก่อน MS-1)

1. Users เดิมทั้งหมด → assign ให้ Main Site หรือให้ admin เลือกเอง?
2. กล้องที่ยัง `site_id = NULL` → treat as "ไม่ได้จัดกลุ่ม" หรือ fallback Main Site?
3. ต้องการ `site_admin` role จริงหรือแค่ flag `site_id` ใน users table ก่อน?
