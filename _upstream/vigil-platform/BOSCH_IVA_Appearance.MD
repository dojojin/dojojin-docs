# Bosch IVA Pro Appearance — แผนพัฒนาให้รองรับ (Development Plan)

Last updated: 2026-06-01 (rev 2 — code-review pass: เพิ่ม §2.4 object_class/confidence gap + immediate 3rd-party impact)
Owner: Prakasit Rochanavipart (Dojo-mAn)
Status: **PLANNED** — รอไฟเขียวเริ่ม Phase 1

> เอกสารนี้เป็นแผนพัฒนาให้ `vigil-platform` รองรับ **Bosch IVA Pro Appearance**
> (appearance-based forensic search: เพศ / สี-ชนิดเสื้อผ้า / ผม / แว่น / กระเป๋า /
> หมวก) ครบ pipeline ตั้งแต่ ingest → store → search → UI.
> เขียนตาม Working Agreement #1 (Fact/Opinion แยกกัน) + #3 (Reproduce-before-fix).

---

## 1. สรุปสั้น (TL;DR)

โค้ด **ออกแบบมารองรับแล้ว** และ metadata **มาถึงระบบจริงแล้ว** — แต่ปัจจุบัน
**เก็บลงฐานข้อมูลไม่ได้เลย (0 แถว)** เพราะ schema ของตาราง `appearances`
ไม่ตรงกับคอลัมน์ที่ `extractAppearance()` พยายาม `INSERT` และ error ถูกกลืน
เงียบ ๆ ด้วย `catch (e) { /* ignore */ }`.

แผนนี้แก้เป็น Phase: ซ่อม storage (Ph.1) → เลิกกลืน error + verify (Ph.2) →
backfill ของเดิม (Ph.3) → forensic search API/UI (Ph.4) → color naming + 3rd-party
view + PDPA (Ph.5).

---

## 2. 🔵 Fact — สิ่งที่ตรวจสอบแล้ว (2026-06-01)

### 2.1 Pipeline ที่มีอยู่
- ระบบ ingest Bosch ผ่าน **MQTT (ONVIF Profile M)** ที่ `src/mqtt-subscriber.js`
- เมื่อ event เป็น `category === 'RuleEngine'` และมี `Appearance.HumanFace` หรือ
  `Appearance.HumanBody` → เรียก `extractAppearance()` (`src/mqtt-subscriber.js:607-608`)
- `extractAppearance()` (`src/mqtt-subscriber.js:712-736`) อ่าน field ตรงกับ
  attribute ของ IVA Pro Appearance:

  | IVA Pro Appearance | อ่านจาก ONVIF Profile M |
  |---|---|
  | gender | `HumanFace.Gender` |
  | hair length / color | `HumanFace.Hair.Length` / `.Color.ColorCluster.Color` |
  | เสื้อ (ชนิด + สี) | `HumanBody.Clothing.Tops.Category` / `.Color` |
  | กางเกง (ชนิด + สี) | `HumanBody.Clothing.Bottoms.Category` / `.Color` |
  | แว่นตา | `HumanFace.Accessory.Opticals.Wear` |
  | กระเป๋า / เป้ | `HumanBody.Belonging.Bag.Category` |
  | หมวก / หมวกนิรภัย | `HumanFace.Accessory.Helmet.Wear` / `.Subtype` |
  | object crop (base64) | `Appearance.Image` (FW 9.x) — `:481-491` |

### 2.2 ข้อมูลมาถึงจริง
- live DB `vigil_platform`: มี **17 events** ที่ `raw_json` มี `HumanBody`/`HumanFace`
  (จากทั้งหมด 54,275 events)
- ตัวอย่าง `raw_json` ของจริง (event ล่าสุด, กล้อง `BOSCH_8100i`):
  ```json
  "Appearance": {
    "Class": { "Type": { "#text": "Person", "@Likelihood": 0.99 } },
    "HumanBody": {
      "Clothing": {
        "Tops":    { "Category": "ShortSleeve", "Color": { "ColorCluster": { "Color": { "@X": 0,   "@Y": 0,   "@Z": 255 } } } },
        "Bottoms": { "Category": "Trousers",    "Color": { "ColorCluster": { "Color": { "@X": 166, "@Y": 166, "@Z": 166 } } } }
      }
    },
    "HumanFace": {
      "Hair":   { "Length": "Short", "Color": { "ColorCluster": { "Color": { "@X": 0, "@Y": 0, "@Z": 0 } } } },
      "Gender": "Male"
    }
  }
  ```
- ✅ parser อ่านได้ถูกต้อง: `Gender=Male`, `Tops.Category=ShortSleeve`,
  `Bottoms.Category=Trousers`, `Hair.Length=Short`
- 📝 หมายเหตุ: event นี้ **ไม่มี** `Accessory` (แว่น/หมวก), `Belonging.Bag`, หรือ
  `Appearance.Image` base64 — field เหล่านี้ optional. snapshot มาทาง
  `_snapshot_source: "http"` (สอดคล้องกับ `docs/LOGIC_camera-ingesters.md:63` —
  FW gap ระหว่าง IVA Pro/Basic เรื่อง inline crop)

### 2.3 🔴 จุดที่พัง — storage schema ไม่ตรงกับโค้ด
- `extractAppearance()` `INSERT` ลงคอลัมน์:
  `gender, hair_length, hair_color_xyz, top_category, top_color_xyz,
  bottom_category, bottom_color_xyz, glasses, bag_category, helmet_wear,
  helmet_subtype, vest_style, snapshot_b64`
- ตาราง `appearances` จริง (`\d appearances` บน `vigil-postgres`) มีแค่:
  `gender, age_group, upper_color, lower_color, vehicle_type, vehicle_color,
  confidence, attributes, detected_at`
- **ตรงกันแค่คอลัมน์เดียว = `gender`** ที่เหลือ **ไม่มีอยู่จริง**
- ไม่มี `ALTER TABLE appearances` ที่ไหนใน `db/` (init.sql:154 นิยาม schema ชุดเก่า,
  view `v_appearances_public` ใน `db_migration_027_third_party_views.sql:64-71`
  ยังอ้างคอลัมน์ชุดเก่า)
- ผล: `INSERT` โยน error `column "hair_length" of relation "appearances" does
  not exist` → ถูกกลืนที่ `src/mqtt-subscriber.js:735` `catch (e) { /* ignore */ }`
- **`SELECT count(*) FROM appearances` = 0** ทั้งที่มี 17 events ที่ควรเขียนได้

### 2.4 🔴 จุดที่ตรวจพบเพิ่มเติม — `object_class` และ `confidence` ไม่ถูก populate

จากการ cross-check INSERT statement กับ column list ของตาราง (code-review 2026-06-01):

**`object_class` (VARCHAR(30) — มีใน table, ไม่มีใน INSERT):**
- `extractAppearance()` ได้รับ parameter แค่ `appearance` object (= `obj.Appearance`) —
  ไม่ได้รับ class string
- payload จริงมี `Appearance.Class.Type.#text = "Person"` ที่ caller (`mqtt-subscriber.js:607`)
  อ่านได้ แต่ไม่ได้ส่งผ่านไปให้ function
- ผล: `object_class = NULL` ทุกแถว → `v_appearances_public` (migration 027:65) SELECT
  column นี้ **อยู่แล้ว และ live อยู่แล้วตอนนี้** → ทันทีที่ Phase 1 ปลดบล็อก INSERT สำเร็จ
  3rd-party จะเห็น `object_class = NULL` ทุกแถว (filter บน column นี้จะคืน 0 แถวเสมอ)
  — **immediate impact ไม่ใช่แค่ future risk**

**`confidence` (REAL — มีใน table, ไม่มีใน INSERT):**
- payload จริงมี `Appearance.Class.Type.@Likelihood = 0.99` (ยืนยันจาก event sample §2.2)
- `extractAppearance()` ไม่อ่าน field นี้เลย
- ผล: `confidence = NULL` ทุกแถว → `v_appearances_public` expose ไว้อยู่แล้ว (live)
  + Phase 4 search UI แสดง confidence score ไม่ได้

**การแก้ (additive — เพิ่มใน Phase 1 ได้เลย ไม่ต้องรอ Phase 5):**
```js
// เพิ่ม parameter ใน function signature:
async function extractAppearance(eventId, cameraId, objectId, appearance, snapshot) {
  // appearance.Class?.Type?.['#text']  → object_class
  // appearance.Class?.Type?.['@Likelihood'] → confidence
}
// เรียกที่ :608 ส่ง appearance ครบอยู่แล้ว — ไม่ต้องเปลี่ยน caller
```

### 2.5 ฝั่งใช้งาน (consume)
- `appearances` ถูกอ้างใน `src/api-server.js` แค่ `DELETE FROM appearances WHERE
  camera_id = $1` ตอนลบกล้อง (`:1999`)
- **ยังไม่มี** forensic search API / UI ที่ query ตารางนี้
- `v_appearances_public` (migration 027:64) expose `object_class` ให้ 3rd-party
  แต่จะ NULL ทั้งหมดจนกว่าจะแก้ตาม §2.5

---

## 3. 🟡 Opinion — การประเมิน

- **"รองรับไหม?" → รองรับเชิงออกแบบ แต่ปัจจุบันใช้งานไม่ได้** — กล้อง/FW ส่งถูก,
  parser อ่านถูก, ตกที่ storage layer ล้วน ๆ
- น่าจะเป็นกรณี `extractAppearance()` ถูกเขียน "ล่วงหน้า" ตาม schema ที่วางแผนไว้
  แต่ migration เพิ่มคอลัมน์ไม่เคยถูกเขียน/รัน → schema กับโค้ด drift กัน
- **Root cause ที่ทำให้บั๊กซ่อนนาน = silent `catch`** — เข้าข่าย footgun ที่ควร
  capture ตาม Working Agreement #3 (GOTCHAS.md convention)
- ความเสี่ยงต่ำในการแก้: เป็นการ "เพิ่มคอลัมน์" (additive) ไม่กระทบ data เดิม

---

## 4. แผนงานแบบ Phase

### Phase 1 — ซ่อม storage schema (ปลดบล็อกหลัก) 🔴  critical
**เป้า:** ให้ `extractAppearance()` เขียนสำเร็จ.
**วิธี:** เพิ่มคอลัมน์ที่ขาดผ่าน migration idempotent ไฟล์ใหม่
`db/db_migration_031_appearance_attrs.sql` (migrate.js สแกน `db_migration_*.sql`
อัตโนมัติตอน api-server boot — `src/migrate.js:34,55`).

```sql
-- ============================================================
-- DojoJin Tech Dashboard — Migration 031: IVA Pro Appearance attributes
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- ซ่อม schema drift: extractAppearance() (src/mqtt-subscriber.js:712) INSERT
-- ลงคอลัมน์ที่ init.sql ไม่เคยสร้าง → INSERT ล้มเหลวเงียบ (0 rows ทั้งที่ data มาถึง).
-- idempotent: ADD COLUMN IF NOT EXISTS
-- ดู BOSCH_IVA_Appearance.MD §2.3

ALTER TABLE appearances ADD COLUMN IF NOT EXISTS hair_length      VARCHAR(20);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS hair_color_xyz   VARCHAR(30);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS top_category     VARCHAR(40);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS top_color_xyz    VARCHAR(30);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS bottom_category  VARCHAR(40);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS bottom_color_xyz VARCHAR(30);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS glasses          BOOLEAN;
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS bag_category     VARCHAR(40);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS helmet_wear      BOOLEAN;
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS helmet_subtype   VARCHAR(40);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS vest_style       VARCHAR(40);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS snapshot_b64     TEXT;
-- เพิ่มจาก code-review (§2.5): object_class + confidence ไม่เคยถูก INSERT
-- object_class มีใน table แต่ extractAppearance() ไม่ได้รับ parameter
-- ในส่วน Node code ต้องเพิ่ม INSERT ด้วย (ดู Phase 1 todo list ด้านล่าง)

-- index สำหรับ forensic search ที่ใช้บ่อย (Phase 4)
CREATE INDEX IF NOT EXISTS idx_appearances_top_category    ON appearances(top_category);
CREATE INDEX IF NOT EXISTS idx_appearances_bottom_category ON appearances(bottom_category);
CREATE INDEX IF NOT EXISTS idx_appearances_gender          ON appearances(gender);
```

> **เพิ่ม columns ใน `db/init.sql` ด้วยไหม?** ควร — ตาม CLAUDE.md #5: migration เข้าถึง
> volume เดิม, ส่วน init.sql ให้ fresh install มี schema ตรงกัน. แก้ block
> `CREATE TABLE appearances` (init.sql:154) ให้มีคอลัมน์ชุดใหม่ครบ. คอลัมน์เก่า
> (`age_group, upper_color, lower_color, vehicle_*`) **เก็บไว้** — ใช้ใน Phase 5
> (human-readable color / vehicle) + view 3rd-party ยังอ้างถึง.

**Phase 1 — Todo list (ครบชุด หลัง code-review):**
- [ ] สร้าง `db/db_migration_031_appearance_attrs.sql` (migration เพิ่ม columns)
- [ ] แก้ `db/init.sql` block `CREATE TABLE appearances` ให้รวม columns ใหม่ครบ
- [ ] แก้ `extractAppearance()` (`mqtt-subscriber.js:712`) — เพิ่ม `object_class` + `confidence`
  เข้า INSERT (ข้อมูลอยู่ใน `appearance.Class.Type` ที่ caller ส่งมาแล้ว ไม่ต้องเปลี่ยน signature)
- [ ] แก้ `extractAppearance()` — เปลี่ยน `catch (e) { /* ignore */ }` → `console.error(...)` (Phase 2 รวมได้)

**Verify (Working Agreement #3):**
```bash
docker exec vigil-postgres psql -U vigil_sql -d vigil_platform -c "\d appearances"
# รอ event ใหม่เข้ามา แล้ว:
docker exec vigil-postgres psql -U vigil_sql -d vigil_platform \
  -c "SELECT id, gender, top_category, bottom_category, hair_length FROM appearances ORDER BY id DESC LIMIT 5;"
# คาดหวัง: count > 0, ค่า ShortSleeve/Trousers/Male/Short โผล่จริง
```

---

### Phase 2 — เลิกกลืน error + observability 🟡 ต้องไฟเขียว
**เป้า:** กัน schema drift หลุดเงียบอีก. แก้ที่ `src/mqtt-subscriber.js:735`.
> **หมายเหตุ (code-review):** Phase 2 ทำพร้อม Phase 1 ได้ในครั้งเดียว — แตะไฟล์เดียวกัน
> (`mqtt-subscriber.js`) อยู่แล้ว. ถ้าไฟเขียว Phase 1 = ไฟเขียว Phase 2 ได้เลย.
> Working Agreement #3: นี่แตะ control flow ใน MQTT ingest → **เสนอ รอไฟเขียว**.
> เลือกแบบ **log-only ไม่ throw** เพื่อไม่ให้ event flow หลักล้มเพราะ appearance พัง.

```js
async function extractAppearance(eventId, cameraId, objectId, appearance, snapshot) {
  try {
    // ... (เหมือนเดิม) ...
    await pool.query(/* INSERT ... */);
  } catch (e) {
    // เดิม: { /* ignore */ } ← กลืน schema drift เงียบ (ดู BOSCH_IVA_Appearance.MD §2.3)
    console.error(`📊 [${cameraId}] extractAppearance failed (event ${eventId}): ${e.message}`);
  }
}
```
- เสนอเพิ่มบรรทัด `GOTCHAS.md` ใหม่ (incident-based): "appearances INSERT ล้มเหลว
  เงียบเพราะ schema drift — fix = migration 031 + log ใน catch"

---

### Phase 3 — Backfill 17 events ที่มาก่อนการแก้ 🟢 optional
**เป้า:** กู้ appearance ของ event เดิมที่หลุดไปจาก `raw_json` (lossless อยู่แล้ว).
**วิธี:** one-off SQL ดึงจาก `raw_json` (path: `Data.Object.Object.Appearance`).

```sql
-- one-off backfill (idempotent ด้วย NOT EXISTS) — รันมือครั้งเดียว ไม่ใช่ migration
INSERT INTO appearances (event_id, camera_id, object_id, gender, hair_length,
  top_category, bottom_category)
SELECT e.id, e.camera_id,
  (e.raw_json#>>'{Data,Object,Object,@ObjectId}'),
  (e.raw_json#>>'{Data,Object,Object,Appearance,HumanFace,Gender}'),
  (e.raw_json#>>'{Data,Object,Object,Appearance,HumanFace,Hair,Length}'),
  (e.raw_json#>>'{Data,Object,Object,Appearance,HumanBody,Clothing,Tops,Category}'),
  (e.raw_json#>>'{Data,Object,Object,Appearance,HumanBody,Clothing,Bottoms,Category}')
FROM events e
WHERE (e.raw_json::text ILIKE '%HumanBody%' OR e.raw_json::text ILIKE '%HumanFace%')
  AND NOT EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = e.id);
```
> color_xyz ของ backfill เว้นว่างได้ (nested ColorCluster แกะใน SQL ยุ่ง) — หรือ
> เขียน backfill ใน Node ใช้ logic เดียวกับ `extractAppearance()` เพื่อให้ผลตรงกัน
> (แนะนำแบบหลังถ้าต้องการสีครบ).

---

### Phase 4 — Forensic Search API + UI 🔵 feature ใหม่
**เป้า:** ค้นคนจากรูปลักษณ์ ("ชายเสื้อแขนสั้นสีน้ำเงิน กางเกงขายาว")
- **API:** เพิ่ม `GET /api/appearances/search` ใน `src/api-server.js` —
  filter ด้วย `gender, top_category, bottom_category, hair_length, glasses,
  bag_category, helmet_wear`, ช่วงเวลา, `camera_id`; JOIN `events` เอา
  `event_time` + `snapshot_filename`; แบ่งหน้า (`LIMIT/OFFSET`).
  ```js
  // sketch — ตาม pattern endpoint เดิม (auth middleware + parametrized query)
  app.get('/api/appearances/search', requireAuth, async (req, res) => {
    const { gender, top, bottom, from, to, camera_id, limit = 50, offset = 0 } = req.query;
    const where = [], args = [];
    if (gender)    { args.push(gender);    where.push(`a.gender = $${args.length}`); }
    if (top)       { args.push(top);       where.push(`a.top_category = $${args.length}`); }
    if (bottom)    { args.push(bottom);    where.push(`a.bottom_category = $${args.length}`); }
    if (camera_id) { args.push(camera_id); where.push(`a.camera_id = $${args.length}`); }
    if (from)      { args.push(from);      where.push(`e.event_time >= $${args.length}`); }
    if (to)        { args.push(to);        where.push(`e.event_time <= $${args.length}`); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    args.push(Math.min(+limit, 200), +offset);
    const { rows } = await pool.query(
      `SELECT a.*, e.event_time, e.snapshot_filename
         FROM appearances a JOIN events e ON e.id = a.event_id
         ${clause} ORDER BY e.event_time DESC
         LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
    res.json({ results: rows });
  });
  ```
- **UI:** หน้า/แท็บใหม่ใน `dashboard/` (Vanilla JS — CLAUDE.md #1) — ฟอร์ม filter +
  grid ผลลัพธ์ (thumbnail จาก `snapshot_filename` + chip attributes).
  ยึด DESIGN.md (token / SVG icon ห้าม emoji), responsive ≤768px, i18n th+en ครบ.

---

### Phase 5 — Color naming + 3rd-party view + PDPA 🟢 polish
- **map สี XYZ → ชื่อสี** ที่คนอ่านรู้เรื่อง (เติม `upper_color`/`lower_color`
  ที่มีอยู่แล้ว) — XYZ ใน payload คือ RGB-like (เช่น Tops `@X=0,@Y=0,@Z=255` = น้ำเงิน).
  ทำ helper `xyzToColorName()` แล้วเขียนลงทั้งคอลัมน์ดิบ + ชื่อสี.
- **อัปเดต `v_appearances_public`** (`db_migration_027_third_party_views.sql:64`)
  ให้รวมคอลัมน์ใหม่ — ⚠️ appearance = personal data: ต้องมี Data Sharing
  Agreement ก่อน grant role (ดู `docs/REF_third-party-integration.md`, PDPA).
- พิจารณา retention/anonymize ของ appearance ตาม PDPA.

---

## 5. ลำดับความสำคัญ & ขึ้นต่อกัน

| Phase | Priority | ขึ้นกับ | ความเสี่ยง | effort | หมายเหตุ (rev 2) |
|---|---|---|---|---|---|
| 1 schema migration + fix INSERT | 🔴 ต้องทำก่อน | — | ต่ำ (additive) | ~45 นาที | รวม object_class + confidence (§2.5) |
| 2 log catch | 🟡 รวมกับ Ph.1 ได้เลย | — | ต่ำ (log-only) | ~15 นาที | แตะไฟล์เดียวกัน |
| 3 backfill | 🟢 optional | Ph.1 | ต่ำ (NOT EXISTS) | ~30 นาที–1 ชม. | color_xyz backfill ด้วย Node แนะนำ |
| 4 search API+UI | 🔵 feature | Ph.1 | กลาง | ~3–5 วัน | — |
| 5 color/view/PDPA | 🟢 polish | Ph.1,4 | กลาง (PDPA) | ~2–3 วัน | update v_appearances_public ด้วย |

**MVP ใช้งานได้จริง = Phase 1 + 2 (รวมเป็น PR เดียว)** (ปลดบล็อกให้ data เริ่มเก็บ ครบ field รวม class/confidence).
**คุณค่าต่อผู้ใช้ = Phase 4** (ค้นหาได้จริง).

---

## 6. ข้อเสนอแนะ (Recommendations)

1. **เริ่ม Phase 1 + 2 ทันที รวมเป็น PR เดียว** — additive, ความเสี่ยงต่ำ, ปลดบล็อก
   ให้ data ที่มาถึงอยู่แล้วเริ่มถูกเก็บ **ครบ field** (รวม object_class + confidence
   จาก §2.5). ทุกชั่วโมงที่ไม่แก้ = appearance event ใหม่หายถาวร
   (ไม่ได้เก็บใน `appearances`; raw_json ยังอยู่จึง backfill ได้แต่ลำบาก).
2. **ตัดสินใจเรื่อง schema canonical** — ปัจจุบันมี 2 ชุดความคิด (init.sql ชุดเก่า
   `upper_color/lower_color/vehicle_*` กับโค้ดชุดใหม่ `top_*/hair_*`). เสนอ:
   เก็บทั้งคู่ — ชุดใหม่ = ค่าดิบจากกล้อง, ชุดเก่า = human-readable (เติมใน Ph.5).
   บันทึกเหตุผลใน `DECISIONS.md`.
3. **ยืนยันฝั่งกล้อง/Config Manager** — IVA Pro Appearance ต้องการกล้อง Bosch
   FW ≥ 9.40 + license `MVC-IVA-APC` + Config Manager ≥ 7.74 (เครื่อง owner เป็น
   CM 7.77.89 ✅). กล้อง `BOSCH_8100i` ในระบบส่ง attribute มาแล้ว → ฝั่ง device
   พร้อม. ตรวจกล้องตัวอื่นว่าเปิด/มี license ครบไหมถ้าต้องการครอบคลุมทุกตัว.
4. **เพิ่ม GOTCHAS.md** บันทึก silent-catch + schema drift กันซ้ำ.

---

## 7. ไฟล์ที่เกี่ยวข้อง

- `src/mqtt-subscriber.js` — `extractAppearance()` (`:712`), เรียกที่ (`:607-608`),
  parse `Appearance.Image` (`:481-491`), silent catch (`:735`)
- `db/init.sql` — `CREATE TABLE appearances` (`:154`)
- `db/db_migration_027_third_party_views.sql` — `v_appearances_public` (`:64-71`)
- `db/db_migration_031_appearance_attrs.sql` — **(จะสร้างใน Phase 1)**
- `src/api-server.js` — `DELETE appearances` (`:1999`), จุดเพิ่ม search API (Ph.4)
- `docs/LOGIC_camera-ingesters.md` — IVA Pro/Basic FW gap (`:63`)
- `docs/REF_third-party-integration.md` — PDPA + view policy (Ph.5)

---

<sub>BOSCH_IVA_Appearance.MD · DojoJin Tech / Vigil Platform · 2026-06-01</sub>
