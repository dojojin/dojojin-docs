# แผน P4–P5 — แก้ไขข้อมูล blacklist ได้ครบทุกช่อง + sync กลับไป HCP

> วาง 2026-08-13 · เจ้าของสั่ง: "การเพิ่ม Blacklist และการแก้ไข Field ยังไม่ครบ —
> อยากให้เพิ่มรูปได้ และแก้พวกสีรถ ฯลฯ ได้ทุกส่วน แต่ตอน sync กลับก็ทำเป็น format
> ที่ปลายทางรับได้แทน (เหมือนตอนรับมา)" · และ "หลังทำเสร็จแล้วลบของเก่าด้วย ไม่ให้ซ้ำซ้อนกัน"
>
> เดินตาม WA#4: PLAN (เอกสารนี้) → EXECUTE ทีละ step → AUDIT → STOP → COMMIT
> แต่ละ step ต้องผ่านเกณฑ์ "เสร็จเมื่อ" ก่อนขึ้น step ถัดไป

---

## สถานะตั้งต้น (ตรวจจากโค้ดจริง 2026-08-13 — ไม่ใช่การเดา)

| ชิ้น | สถานะ | อ้างอิง |
|---|---|---|
| คอลัมน์ override 7 ช่อง | ✅ มีแล้ว | `db/db_migration_149_override_fields.sql` |
| `PUT /api/blacklist/record/:id/override` รับ 7 ช่อง | ✅ มีแล้ว | `src/routes/blacklist-sources.js:1571-1577` |
| ตัวอ่านให้ override ชนะค่าดิบ | ✅ commit `3587810` | `blacklistBridge.js` · `lprLineAlert.js` |
| **`GET /api/blacklist/record/:id` คืน 7 ช่อง** | ❌ **ไม่คืนเลย** | `blacklist-sources.js:1532-1541` |
| ฟอร์มแก้ไข | ❌ มี 3 ช่อง (`name` · `plate_numbers` · `case_note`) | `dashboard/page-blacklist.js:2004` |
| ฟอร์มเพิ่มด้วยตนเอง (แท็บ LPR) | ❌ มี 6 ช่อง ไม่มีรูป ไม่มีสี/ยี่ห้อ/ประเภท | `dashboard/page-blacklist-manual.js:121-161` |
| HCP write client | ❌ `hcp-client.js` เป็น read-only ล้วน | `src/hcp-client.js` |

**ของที่มีอยู่แล้วและต้องใช้ซ้ำ (อย่าเขียนใหม่):**
- `savePhoto(sourceId, externalId, b64)` — `src/helpers/blacklistImport.js` เขียนลง `PHOTO_DIR`
- `PHOTO_DIR` = `blacklistImport.js:28` → `/home/vigil-central/vigil-platform/blacklist-photos`
- แบบตรวจ magic bytes ที่ผ่าน audit แล้ว — `src/routes/lpr-watchlist.js` (`POST /api/lpr/watchlist/image`)
- `row()` + `_blCollectOverride()` ใน `page-blacklist.js` — แบบฟอร์ม override ที่ทำงานถูกอยู่แล้ว

**การจับคู่ช่อง → `raw_json` (ยืนยันจาก `blacklistImport.js:132-134`):**
```
brand → carbrand · vehicle_type → cartype · vehicle_color → carcolor
plate_type → platetype · case_kind → owner_detail · province → province
photo_path → source_records.photo_path (ไม่ได้อยู่ใน raw_json)
```

**กติกา override ที่ห้ามทำผิด** (`blacklist-sources.js:1561`):
```js
const pick = (k, oldVal) => (k in b) ? (b[k] === '' ? null : b[k]) : oldVal;
```
ไม่ส่ง field มา = ไม่แตะ · ส่ง `''` หรือ `null` = ล้าง override กลับไปใช้ค่าต้นทาง
⇒ ฟอร์มต้องส่ง `''` เมื่อค่าที่พิมพ์ **เท่ากับค่าต้นทาง** ไม่งั้นทุกช่องจะกลายเป็น override หมด

---

## P4 — แก้ไข/เพิ่มข้อมูลได้ครบทุกช่อง

### Step 4.1 — server: ให้ `GET record/:id` คืนค่าต้นทาง + override ครบ 7 ช่อง
**ไฟล์:** `/home/vigil-central/vigil-platform/src/routes/blacklist-sources.js` (~บรรทัด 1518-1543)

- เพิ่มใน `SELECT`: `o.brand, o.vehicle_type, o.vehicle_color, o.plate_type, o.case_kind, o.province, o.photo_path`
- เพิ่มใน response `source`: อ่านจาก `r.raw_json->>'carbrand'` ฯลฯ ตามตารางจับคู่ด้านบน + `photo_path: r.photo_path`
- เพิ่มใน response `override`: 7 ช่องตรงชื่อคอลัมน์

**เสร็จเมื่อ:** `curl` ระเบียน GuruSquare 1 ใบที่มี `carbrand` จริง แล้ว response มี
`source.brand` ตรงกับ `raw_json.carbrand` และ `override.brand` เป็น `null` (ยังไม่มีใครแก้)

### Step 4.2 — frontend: เพิ่ม 6 ช่องในฟอร์มแก้ไข
**ไฟล์:** `/home/vigil-central/vigil-platform/dashboard/page-blacklist.js`

- ใน `_blOpenEdit()` เพิ่ม `row()` อีก 6 ครั้ง **เฉพาะเมื่อ `isLpr`**: จังหวัด · ยี่ห้อ · ประเภทรถ ·
  สีรถ · ชนิด/สีป้าย · ประเภทคดี (ระเบียนใบหน้าไม่มีช่องรถ)
- ขยาย `_blCollectOverride()` ให้เก็บ 6 ช่องด้วยกติกาเดิม (เท่าต้นทาง → ส่ง `''`)
- ขยาย `_blRevertField()` ให้รู้จักคีย์ใหม่ (ตอนนี้ hardcode เฉพาะ `plate_numbers`)
- i18n: คีย์ใหม่ทุกตัวต้องอยู่ **ทั้ง `th` และ `en`** — ยึด anchor ที่ข้อความไม่ซ้ำสองฝั่ง
  (เคยพลาดมาแล้วในเซสชันนี้: EN block ไปตกในพจนานุกรม th)

**เสร็จเมื่อ:** แก้ยี่ห้อของระเบียนจริง 1 ใบ → กด "ใช้ค่าต้นทาง" แล้วค่ากลับ →
บันทึกโดยไม่แก้อะไร แล้ว `SELECT * FROM blacklist.overrides` **ไม่เกิดแถวใหม่**

### Step 4.3 — server: endpoint อัปโหลดรูป + helper ตรวจ magic bytes ที่ใช้ร่วมกัน
**ไฟล์ใหม่:** `/home/vigil-central/vigil-platform/src/helpers/imageMagic.js`
**ไฟล์แก้:** `/home/vigil-central/vigil-platform/src/routes/blacklist-sources.js`

- `imageMagic.js` — export `assertImageBuffer(buf)` ตรวจ **magic bytes จาก buffer**
  รับ PNG `\x89PNG` · JPEG `\xFF\xD8\xFF` · WebP `RIFF....WEBP` · GIF `GIF87a/89a`
  **ห้ามรับ SVG** (GOTCHAS #25a) · **ห้ามเชื่อ MIME type** (GOTCHAS #55, decision #158)
- `POST /api/blacklist/record/:id/photo` — multer memory storage → `assertImageBuffer` →
  `sharp` ย่อ → `savePhoto(source_id, external_id + '_ov', b64)` → คืน path
  **role:** admin เท่านั้น (decision #152) · ผิดชนิด → `415`
- ใช้ `_ov` ต่อท้าย external_id เพื่อ **ไม่ทับรูปต้นทาง** — ลบ override แล้วรูปเดิมต้องกลับมา

**เสร็จเมื่อ:** อัป PNG จริงผ่าน · อัปไฟล์ `.jpg` ที่ข้างในเป็น text → `415` ·
อัป SVG → `415` · ไฟล์ปรากฏใน `PHOTO_DIR/<source_id>/` และรูปต้นทางยังอยู่ครบ

### Step 4.4 — frontend: ช่องรูปในฟอร์มแก้ไข
**ไฟล์:** `/home/vigil-central/vigil-platform/dashboard/page-blacklist.js`

- แถวรูป: พรีวิวรูปปัจจุบัน (override ถ้ามี ไม่งั้นต้นทาง) + ปุ่มเลือกไฟล์ + ปุ่ม "ใช้รูปต้นทาง"
- อัปโหลดสำเร็จ → เก็บ path ไว้ แล้วส่งไปกับ `PUT .../override` ตอนกดบันทึก
- path จาก DB ที่เอาไปประกอบ URL ต้องผ่าน `encodeURIComponent()` · ทุกค่าที่ยัด `innerHTML` ผ่าน `_blEsc()`

**เสร็จเมื่อ:** เปลี่ยนรูป → การ์ด LINE/modal แสดงรูปใหม่ (bridge อ่าน `COALESCE(o.photo_path, r.photo_path)`
อยู่แล้วจาก `3587810`) → กด "ใช้รูปต้นทาง" → กลับไปรูปเดิม

### Step 4.5 — ฟอร์มเพิ่มด้วยตนเอง: ช่องเดียวกัน + รูป
**ไฟล์:** `dashboard/page-blacklist-manual.js` · `src/routes/blacklist-sources.js` (`POST /api/blacklist/manual/lpr:1129`)

- แท็บ LPR เพิ่ม: ยี่ห้อ · ประเภทรถ · สีรถ · ชนิด/สีป้าย · ประเภทคดี + เลือกรูป
- server เขียนลง `raw_json` ด้วย**ชื่อคีย์เดียวกับต้นทาง** (`carbrand`/`cartype`/…) เพื่อให้
  ตัวอ่านตัวเดียวกันใช้ได้ ไม่ต้องแยกกรณี "ระเบียนพิมพ์เอง"
- รูปส่งเป็น `photo_b64` ในตัว JSON เดิม → `upsertRecord` เรียก `savePhoto` ให้อยู่แล้ว
  **แต่ต้องเรียก `assertImageBuffer()` บน buffer ที่ decode แล้วก่อน** — base64 ไม่ผ่าน multer
  จึงไม่มีใครตรวจให้ ถ้าไม่ตรวจตรงนี้ = ช่องโหว่ upload ที่ไม่มีด่าน

**เสร็จเมื่อ:** เพิ่มป้ายใหม่พร้อมรูป+สี+ยี่ห้อ → ขึ้นในถังกลาง → sync → เข้า `lpr_watchlist` →
การ์ดแจ้งเตือนแสดงค่าที่พิมพ์ครบ · ลบระเบียนทดสอบทิ้งเมื่อจบ

### Step 4.6 — ลบของเก่าที่ซ้ำซ้อน · ✅ ทำแล้ว 2026-08-13

**สิ่งที่ซ้ำจริงไม่ใช่ UI แต่เป็นด่านตรวจไฟล์อัปโหลด** — สำรวจ UI แล้วยืนยันว่าไม่ทับกัน
(`page-blacklist.js` = แก้ · `page-blacklist-manual.js` = เพิ่ม · `page-auraface-blacklist.js` = คนละตาราง)
แต่ Step 4.3 สร้าง `helpers/imageMagic.js` ขึ้นมาเป็น **สำเนาที่ 4** ของการตรวจ magic bytes
ที่ก๊อปกันอยู่แล้ว 3 ที่ (`lpr-watchlist.js` · `branding.js` · `face-blacklist.js` — ตัวหลัง
มี comment เขียนไว้เองว่า "same check as lpr-watchlist.js")

ทำ: ให้ทั้ง 3 ที่เรียก helper ตัวเดียว + ลบ `require` ซ้ำใน `blacklist-sources.js:1168`

**บั๊กที่เจอตอนตรวจ (ของ Step 4.3 เอง):** ตัวดัก SVG ทำงาน **ก่อน** magic bytes และเป็นการ
เดาจากข้อความ 1KB แรก ⇒ JPEG/PNG จริงที่มี XMP metadata (ไฟล์ที่ export จาก Illustrator/
Photoshop — มีทั้ง `xmlns` และชื่อไฟล์เดิม `.svg`) ถูกปฏิเสธเป็น SVG · แก้โดยให้ **magic bytes
ตัดสินก่อน** แล้วค่อย sniff ข้อความเฉพาะตอนที่ไม่ผ่านทุก format (ไฟล์ที่มี magic ของ PNG/JPEG/
WebP/GIF เป็น SVG ไม่ได้อยู่แล้ว) · เพิ่ม fixture regression ทั้ง JPEG+XMP และ PNG+XMP

**ผลข้างเคียงที่ตั้งใจ:** `lpr-watchlist` กับ `face-blacklist` เดิม 415 กับ GIF ตอนนี้รับแล้ว
(helper รับ GIF ตาม `branding.js` ของเดิม)

---

## P5 — sync กลับไป HCP · ⛔ **ยกเลิกหัวข้อนี้ ให้ใช้ Phase BS-H แทน**

**ตรวจพบ 2026-08-13:** แผน P5 ที่เคยร่างไว้ตรงนี้ **ซ้ำกับของที่มีอยู่ก่อนแล้วและอ่อนกว่า** —
`docs/SPEC_partner-api_2026-08-07.md` § **Phase BS-H** (วางไว้ 2026-08-08) ครอบเรื่องเดียวกัน
ครบกว่า และเข้มกว่าในจุดที่สำคัญ ⇒ **ห้ามทำตาม P5 เดิม ให้ยึด BS-H เป็นฉบับจริง**

ที่ P5 เดิมพลาด (เทียบกับ BS-H):

| P5 เดิมเขียนว่า | ความจริงตาม BS-H / โค้ดจริง |
|---|---|
| สร้างตัวสั่ง sync + หน้าจอใหม่ (5.3) | **มีอยู่แล้วทั้งชุด** — `blacklistPush.js` (diff + checksum + dry-run + ปฏิเสธ replace) · `blacklistSourcePush.js` (ฝั่ง edge, named ops) · `sources.push_enabled/push_types/push_confirmed_by` ⇒ P5 เหลือแค่ **transmitter + op ฝั่ง edge + ตารางแมป** |
| เพิ่ม 3 เมธอด รวม `delete` (5.1) | **BS-H4: เฟสแรกไม่มีคำสั่งลบ** — `blacklistSourcePush.js` จงใจไม่มี delete เพื่อให้บั๊กที่หลุดด่านยังลบแถวไม่ได้ · ใส่ delete = ทำลายคุณสมบัตินั้น |
| แมป `vehicleColor` เป็นตัวเลข (5.2) | **ไม่มีตารางรหัสสี** — BS-H สั่งว่าไม่ส่งจังหวัดด้วยเหตุผลเดียวกัน (`plateArea` เป็นรหัสตัวเลข) · memory: HCP **ผิดแบบเงียบ** ⇒ เดารหัส = เขียนข้อมูลผิดเข้าระบบตำรวจโดยไม่มี error |
| ทดสอบ `add` ด้วยป้ายของเราเองได้เลย | **BS-H0 เป็น blocker 🔴** — ต้องได้ไฟเขียว **เป็นลายลักษณ์** ให้ยกเลิกข้อห้าม "ห้ามเขียน HCP" + ต้องขอ **กลุ่มทดสอบ** จาก HCP ก่อน (BS-H5: ชี้กลุ่มจริงเป็นขั้นสุดท้าย ยืนยันแยก) |
| — | **`vehicleGroupIndexCode` บังคับตอน update** ⇒ ถ้าไม่อ่านกลุ่มปัจจุบันมาใส่กลับ การแก้ป้าย 1 ใบจะกลายเป็น **ย้ายกลุ่ม** โดยไม่ตั้งใจ |

### สิ่งเดียวของ P5 ที่ทำไปแล้ว (ไม่ติด BS-H0) · ✅ 2026-08-13

`buildPushDiff()` มองเห็นได้แค่ `name` / `plate_numbers` / `case_note` ⇒ **การแก้ 6 ช่องที่ P4
เพิ่งเปิดให้แก้ (สี ยี่ห้อ ประเภทรถ ชนิดป้าย ประเภทคดี จังหวัด) + รูป จะไม่มีวันไปถึงต้นทางไหนเลย
และแย่กว่านั้นคือ preview ก็ไม่พูดถึง** — คนแก้ไปแล้วแยกไม่ออกว่าส่งไปหรือยัง
แก้: เพิ่มทั้ง 7 ช่องเข้า diff · ส่วน **ช่องไหนจะเดินทางจริงเป็นหน้าที่ของ transmitter**
(`TRANSMITTERS.dss_pro` กรอง payload ที่มีแต่ `id` ออก และรายงาน `unmapped`)
นี่คือฐานที่ **BS-H1 (ตารางประกาศฟิลด์ที่จะไม่ถูกส่ง)** ต้องใช้ — ไม่ใช่ของที่ซ้ำกับ BS-H1

### คำถามที่ต้องให้เจ้าของตอบก่อนเดินต่อ

**"added on ไปเพิ่ม+updated" หมายถึงอะไร?**
- **(ก) update อย่างเดียว** — ส่งเฉพาะ *การแก้ไข* ของระเบียนที่มาจาก HCP อยู่แล้ว
  → ตรงกับกรอบที่มี แต่วันนี้ HCP (source 14) มี override **0 แถว** ⇒ ส่งอะไรไม่ได้เลย
- **(ข) เพิ่มด้วย** — เอาป้ายที่เราพิมพ์เอง (source 12 `manual`) ยัดเข้ากลุ่มรถของ HCP เป็นแถวใหม่
  → เป็นการเขียนข้ามแหล่ง ซึ่งกรอบปัจจุบัน **ไม่รองรับ** (หนึ่งระเบียน = หนึ่งต้นทาง)
  ต้องมีทั้งกลุ่มปลายทางที่เจ้าของเลือกเอง และเครื่องหมายว่าแถวไหนเราสร้าง เพื่อไม่ให้ update
  ไปโดนรถของคนอื่น

---

---

## CH — ประวัติที่ต้นทางแก้ระเบียน (สั่ง 2026-08-13)

**โจทย์เจ้าของ 3 ข้อ · 2 ข้อแรกมีอยู่แล้ว:**

| ข้อ | สถานะ |
|---|---|
| ① ต้นทางลบ → ลบตามแบบกู้คืนได้ ไม่ sync ซ้ำ | ✅ BS1+BS2 (รอบนี้) |
| ② ต้นทางเพิ่ม → เพิ่มตาม | ✅ `runImport` upsert เดิม |
| ③ ต้นทางแก้ → อัพเดทตาม + remark + ประวัติละเอียด | ✅ CH1–CH3 (รอบนี้) |

**กฎ 4 ข้อที่ต้องอยู่ด้วยกัน** — ข้อ 3 คือตัวที่ทำให้ ① กับ ② ไม่ตีกัน:

1. ต้นทางลบ → ย้ายลงถังขยะ ไม่ลบจริง
2. ต้นทางลบแล้วส่งกลับมา → กลับมาเฝ้าระวังเอง
3. **คน**คัดออกเอง → ต้นทางส่งมาอีกก็ไม่ฟื้น (คนชนะเครื่อง — แยกด้วย `updated_by='system:vanish'`)
4. เราไม่ส่งการลบของเรากลับไปหาต้นทาง (BS3 ยังไม่เปิด)

### ทำไมต้องมีตารางแยก (อย่าเผลอใช้ `updated_at`)

`source_records.updated_at` ถูกเขียน `NOW()` **ทุกรอบ import** ไม่ว่าค่าจะเปลี่ยนหรือไม่
(13 ส.ค. ขึ้น 2,672 แถวทั้งที่ต้นทางแทบไม่แก้อะไร) ⇒ `blacklist.record_changes` เป็น
**ที่เดียว**ที่รู้ว่าแก้จริง · ใครสร้าง BS4 อย่าไปนับจาก `updated_at`

### CH1 — เก็บ diff · ✅ `db_migration_151` + `blacklistImport.js`

- จับ diff ด้วย **CTE `prev` ในคิวรีเดียวกับ upsert** (พิสูจน์กับตารางจริงแล้วว่า CTE
  เห็นค่า**ก่อน** update และคืน `null` เมื่อเป็น INSERT ใหม่ล้วน) ⇒ ไม่มี query เพิ่ม
- **deny-list ไม่ใช่ allow-list** (`CHANGE_SKIP_KEYS`) — เนื้อหาจาก vendor ใหม่ควรถูกจับ
  โดยไม่ต้องแก้โค้ดก่อน · ที่ตัดออกคือรหัสอ้างอิง/URL/เวลา ซึ่งถ้าวันหนึ่งมันหมุนทุกรอบดึง
  จะกลายเป็น "การแก้ไข" ปลอมนับพันแถวต่อวัน
- `''` กับ `null` นับว่าเท่ากัน — ไม่งั้นแหล่งที่สลับไปมาสร้างประวัติปลอมทุกรอบ
- `source_time` (ต้นทางบอกว่าแก้เมื่อไหร่ จาก `raw_json.last_update`) แยกจาก
  `detected_at` (เราเห็นเมื่อไหร่) — เจ้าของขอทั้งสองอย่าง

**ปริมาณที่วัดจริง:** GuruSquare 786 แถว ต้นทางแก้ ~10–36 ระเบียน/เดือน ⇒ โตหลักสิบแถว/เดือน

### CH2 — แสดงในกล่องระเบียน · `page-blacklist.js`
`ต้นทางแก้ล่าสุด … · เข้าระบบครั้งแรก … · แก้มาแล้ว N ครั้ง` + กางดูรายการ
(`GET /api/blacklist/record/:id/changes`)

### CH3 — ⭐ เตือนเมื่อต้นทางแก้ช่องที่เรา override ทับ

**ของสำคัญที่สุดในชุดนี้ และเจ้าของไม่ได้ขอ** — `pick()` ทำให้ค่าที่เราแก้ทับชนะตลอดกาล
⇒ ถ้าต้นทางแก้ช่องเดียวกัน**ทีหลัง** ค่าใหม่ของเขาไม่มีวันโผล่ให้ใครเห็น
เกณฑ์ชน = มี override ของช่องนั้น **และ** `detected_at > overrides.updated_at`
(แก้ก่อนหน้าเรา = ของที่เราเห็นตอนแก้อยู่แล้ว ไม่นับ)

### ที่ยังไม่ทำ

- **BS4 หน้ากระทบยอด** — ทำหลัง CH เพราะ BS4 คือการสรุปสิ่งที่ CH1 บันทึก
- **ป้ายอายุข้อมูลต่อแหล่ง** — เจ้าของสั่งพักไว้ 2026-08-13 (DSS Pro ค้าง 18.9 วัน,
  `pull_interval_minutes=0` ⇒ `scanVanished` ที่บังคับ `status='ok'` **ทำงานไม่ได้เชิงโครงสร้าง**
  สำหรับแหล่งนั้น · 957 ระเบียนใบหน้าแช่แข็งโดยไม่มีอะไรบอกบนจอ)

---

## ข้อห้ามที่บังคับกับทุก step (รวมถึง subagent)

- ห้ามแตะ **credential ของจริง**: ห้าม `UPDATE`/`DELETE` แถว `users` ที่ตัวเองไม่ได้สร้าง ·
  ห้ามแตะ `password_hash` ของบัญชีจริง · **ห้ามเดารหัสผ่าน** (เดา = บัญชีโดน lockout
  และ audit trail สกปรก) · ห้ามแตะ EMQX authn/authz, `.env`, license key
- ต้องใช้สิทธิ์ → **สร้างบัญชีชั่วคราวของตัวเอง แล้วลบทิ้งเมื่อจบ** เท่านั้น
- ติดขัดจนไปต่อไม่ได้ = **รายงานกลับ ห้ามแก้ทางลัดเอง**
- ข้อมูล production ที่แตะเพื่อทดสอบ ต้องคืนสถานะเดิมทุกครั้ง และรายงานว่าคืนแล้ว
- ห้าม commit เอง — WA#4 ขั้น STOP: รอเจ้าของ confirm
- ทุกคีย์ i18n ใหม่ต้องอยู่ครบทั้ง `th` และ `en` (gotcha #42)
- UI ทุกชิ้นต้องตรวจ ≤768px ก่อนรายงานว่าเสร็จ (WA#2-B) · ใช้ token ไม่ hardcode สี
