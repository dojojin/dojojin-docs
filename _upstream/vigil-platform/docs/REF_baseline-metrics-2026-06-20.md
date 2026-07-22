# REF — Baseline Metrics & Capacity Snapshot (ก่อน data wipe 2026-06-20)

> เก็บ **ก่อนล้าง production data** (fresh start 2026-06-20) เพื่อใช้วางแผน capacity/storage/edge ในอนาคต
> และเก็บ catalog ของ "ตัวเลือกค้นหา" (search facet values) ที่จะหายไปเมื่อ truncate.
> ที่มา: วัดจากระบบจริงบน MacBook (single-site, ~9 active cameras, LPR gate ท่าฉัตรไชย 1 ตัวคุมโหลด).
> Role: `REF_` (อ้างอิง — ไม่ใช่ของที่ต้องทำ). คู่กับ [VIGIL-ARCH-003](../public/others/demo/diagram.html).

---

## 1. Search Facet Catalog (ค่าที่ dropdown/filter เคยมี)

> เมื่อ truncate ค่าพวกนี้จะถูกสร้างใหม่จาก data — เก็บไว้เป็น reference ว่าระบบเคยเจอค่าอะไรบ้าง
> (มีประโยชน์ต่อ i18n label, validation, การออกแบบ filter)

### LPR (license_plates / events.raw_json)
| facet | distinct | ค่า |
|---|---|---|
| `vehicle_type` | 10 | SUVMPV, buggy, largeBus, pedestrian, pickupTruck, threeWheelVehicle, truck, twoWheelVehicle, van, vehicle |
| `vehicle_color` | 10 | black, blue, brown, gray, green, purple, red, white, yellow, unknown |
| `plateColor` | 9 | black, blue, colorful, green, orange, red, white, yellow, unknown |
| `laneNo` | 3 | 1, 2, 3 |
| `region` (จังหวัด) | 85 | ครบ 77 จังหวัดไทย + `ไม่ทราบ` + **ID ดิบที่ map ไม่ติด 8 ตัว: 113,114,115,122,134,141,142,144** (data-quality TODO — เพิ่มใน TH_PROVINCE map) |
| `vehicle_brand` (ยี่ห้อ) | 175 โค้ด | **เก็บเป็นโค้ดตัวเลข Hikvision `vehicleLogoRecog`** (ไม่ใช่ชื่อ). map code→ชื่อ อยู่ใน `dashboard/page-lpr.js` (`_lprBrandLabel`, **573 โค้ด** จาก SDK) — เป็น code ไม่ใช่ data → **wipe ไม่กระทบ map** |

**Top ยี่ห้อที่ site นี้เคยอ่านได้จริง (code → ชื่อ, count):**
TOYOTA(4,904) · `0`=ไม่ทราบ(3,442) · HONDA(1,579) · CHEVROLET(1,056) · FOTON(649) · Mitsubishi(623) · FORD(587) · Nissan(524) · Mazda(491) · Isuzu(428) · BENZ(352) · Volkswagen(298) · JEEP(266) · Hyundai(262) · BMW(231) … (รวม 175 โค้ด)

### Events
| facet | distinct | หมายเหตุ |
|---|---|---|
| `event_type` | 18 | (รายการเต็มด้านล่าง) |
| `rule_name` | 20 | Bosch IVA rule names |
| `object_class` | 1 | น้อยมาก (Bosch ส่ง class น้อย) |

**event_type ทั้ง 18:**
`anprAlarm` · `FaceCapture` · `FaceRecognition` · `CountAggregation/Counter` · `CountAggregation/OccupancyCounter` · `CountAggregation/PeopleCounting` · `FieldDetector/IdleObject` · `FieldDetector/ObjectsInside` · `LineDetector/Crossed` · `ObjectDetection/Object` · `GlobalSceneChange/AnalyticsService/&1` · `ImageTooBlurry|Bright|Dark/AnalyticsService/&1` · `TamperDetection` · `Trigger/DigitalInput/&Input_1|2` · `Trigger/Relay/&Output_1`

### Face attributes (events.raw_json — FaceCapture/FaceRecognition)
| facet | distinct ค่า |
|---|---|
| `gender` | female, male |
| `ageGroup` | young, prime, middle, middleAged, old |
| `glass` | no, yes, sunglasses |
| `mask` | no, yes |
| `hat` | no, yes |
| `faceExpression` | angry, disgusted, happy, panic, poker-faced, sad, surprised |
| `listType` | blackList *(เท่าที่เจอ — whiteList ฯลฯ ยังไม่มีข้อมูล)* |

### Body appearance (table `appearances` — Person)
| facet | distinct ค่า |
|---|---|
| `object_class` | Person |
| `gender` | Female, Male |
| `hair_color` | Black, Blonde, Brown, Gray |
| `hair_length` | Long, Short |
| `upper_color` | Beige, Black, Blue, Brown, Gray, Green, Magenta, Mixture, Pink, Purple, White, Yellow |
| `lower_color` | Beige, Black, Blue, Brown, Gray, Green, Magenta, Purple, Unknown, White |
| `glasses` | true, false |

> `appearances` ยังมี column ที่ schema เผื่อไว้แต่**ยังไม่มีข้อมูล** (กล้องรุ่นปัจจุบันไม่ส่ง): `bag_category`, `helmet_wear`, `helmet_subtype`, `vest_style`, `top_category`, `bottom_category` — เก็บไว้รองรับอนาคต

---

## 1b. Mapping tables ที่อยู่ใน "โค้ด" (committed → wipe ไม่กระทบ — บันทึกที่อยู่ไว้)

| mapping | ที่อยู่ | ขนาด |
|---|---|---|
| vehicle_brand code → ชื่อ | `dashboard/page-lpr.js` (`_lprBrandLabel`) | 573 โค้ด (Hikvision SDK) |
| province ID → ชื่อจังหวัด | `src/routes/lpr.js` (`TH_PROVINCE`) | 79 IDs |
| XYZ/sRGB → ชื่อสี | `src/color-utils.js` (`xyzToColorName`) | palette 11 + achromatic 3 |
| enum labels (th/en) | `dashboard/i18n.js` | face.*/lpr.*/cs.* keys |
| event classification | `dashboard/event-domains.js` | domain/render/color |

→ ทั้งหมดเป็น **code** ไม่ใช่ data → ปลอดภัยจาก truncate. ลิสต์ไว้เผื่อหาทีหลัง

## 1c. Color palette calibration (XYZ → ชื่อสี จากกล้องจริง) — ⚠️ DATA ที่จะหายตอน wipe

> `color-utils.js` ใช้ palette ที่บาง XYZ เป็น "estimate". ค่าจริงที่กล้องส่งมา (ใน `appearances.*_xyz`)
> คือ ground-truth สำหรับ tune palette — **เก็บไว้ก่อนลบ** (ลบแล้วต้องรอเก็บใหม่):

| ชื่อสี | XYZ จริงจากกล้อง | vs palette ใน code | n |
|---|---|---|---|
| Blue | 0,0,255 | ตรง ✓ | 1,458 |
| Gray | 166,166,166 | ตรง ✓ | 489+251 |
| Black | 0,0,0 | ตรง ✓ | 428+1,982 |
| Green | 0,176,80 | ตรง ✓ | 164 |
| White | 255,255,255 | ตรง ✓ | 194 |
| Beige | 232,220,202 | ตรง ✓ | 56 |
| Blonde | 184,139,80 | ตรง ✓ | 74 |
| **Brown** | **153,102,51** | **palette เดา 139,69,19 — ไม่ตรง** ⚠️ | 375+1 |
| **Purple** | **153,0,255** | palette เดา 128,0,255 — ต่างนิด | 27 |
| Magenta | 255,0,255 | ตรง ✓ | 10 |
| Yellow | 255,255,0 | ตรง (ยืนยัน estimate) ✓ | 14 |

**Action item (หลัง restructure):** อัป `_PALETTE` ใน color-utils.js — Brown → 153,102,51, Purple → 153,0,255 (ยืนยันจากกล้องจริงแล้ว ไม่ใช่ estimate). Orange/Auburn ยังไม่เคยเห็น (ยังเดาต่อ)

---

## 2. ขนาดรูปจริง ต่อชนิด (วัดจากไฟล์จริง)

| ชนิด | ขนาดเฉลี่ย | resolution | หมายเหตุ |
|---|---|---|---|
| **LPR scene** | **972 KB** | 4096×2192 (8.9MP) | ตัวกินที่หลัก |
| LPR plate (crop) | 1 KB | เล็ก | เพิ่ม file count เท่าตัวแต่ byte ~0 |
| Face full | 375 KB | — | ภาพเต็มตอนจับหน้า |
| Face crop / ref | 46 / 44 KB | — | |
| Body appearance | 89 KB | — | |
| Event/object snap (รวม) | 367 KB | — | Bosch+Hik object |
| **Bosch snap (เฉพาะ)** | **236 KB** | — | วัดจาก BOSCH_* events |

---

## 3. ปริมาณจริง 24 ชม. (โหลด ณ 2026-06-19/20)

| ชนิด | จำนวน/วัน | ขนาด/วัน | % |
|---|---|---|---|
| **LPR scene** | **18,868** | **18.0 GB** | 96% |
| Event/object | 2,671 | 0.50 GB | 2.7% |
| Face (full+crop+ref) | ~890 | 0.20 GB | 1.1% |
| Body + LPR plate | ~17,900 | 0.045 GB | 0.2% |
| **รวม** | **40,390 ไฟล์** | **18.69 GB/วัน** | 100% |

**⭐ LPR busy gate 1 ตัว (ท่าฉัตรไชย): ~18,900 event/วัน = 34,029 ไฟล์/วัน (scene+plate) = 18 GB/วัน**
→ 200 กล้องแบบนี้ = 34,000 × 200 ≈ **6.8M ไฟล์/วัน** (× retention 7 วัน ≈ 48M ไฟล์ → เสี่ยง inode หมด)

### Event rate ต่อวัน แยกชนิด (มี image เว้น metric)
| event_type | ต่อวัน | มี image? |
|---|---|---|
| CountAggregation/Counter | 3,130 | ❌ metric |
| anprAlarm (LPR) | ~18,963 | ✅ |
| ObjectDetection/Object | 288 | ✅ |
| FieldDetector/ObjectsInside | 229 | ✅ |
| LineDetector/Crossed | 215 | ✅ |
| FaceCapture | 126 | ✅ |
| FaceRecognition | 95 | ✅ |
| Bosch (img-events รวม) | ~188/กล้อง/วัน | ✅ (236KB) |

---

## 4. DB & Disk (ณ ก่อน wipe)

| | ขนาด / rows |
|---|---|
| DB total | **102 MB** (เล็กมาก) |
| events | 82 MB · 81,776 rows |
| license_plates | 5.7 MB · 19,378 rows |
| snapshots/ รวม | **24 GB** (lpr 18G + face/event flat 5.2G) |
| media/ (clips) | **14 GB** |
| **ลบไฟล์คืนได้** | **~38 GB** |

→ **ตัวกินดิสก์ = ไฟล์รูป (24GB) + clips (14GB) ไม่ใช่ DB (102MB)**

---

## 5. Resize / CPU (วัดจริงบน Mac M1 Pro — N150 ต้องรัน `scripts/bench-resize.js` เอง)

- **ลด JPEG quality (res เท่าเดิม):** q70 → **−64% ถึง −71%** (972KB→~320KB) · q60 → ~−70%
- **decode ครองเวลา CPU:** decode-only 21ms vs q70 40ms vs downscale 36ms → **q70 ≈ downscale (~11%)**; downscale เร็วกว่านิดด้วยซ้ำ
- **สรุป:** เลือก downscale+q70 (CPU พอกัน, storage ดีกว่า ~10x vs ~3x). ลด CPU จริงต้องลด "จำนวนรูปที่ decode" หรือให้กล้องส่งรูปเล็กตั้งแต่ต้น
- M1 Pro parallel ~83 downscale/วิ · **N150 ยังไม่วัด** (ห้ามใช้เลข Mac)

---

## 6. Storage Projection (Linux usable: 512GB≈440 / 1TB≈870 GB)

| scenario | RAW | + resize ~150KB |
|---|---|---|
| **LPR-only 200 กล้อง** (busy/กลาง/เบา) | ~3 ชม. / ~18 ชม. / ~2.3 วัน (512) | ดีขึ้น ~6-8x |
| LPR-only 200, 1TB | ~6 ชม. / ~1.5 วัน / ~4.6 วัน | |
| **Bosch-only 200 กล้อง** (236KB, ~188/วัน) | 512: ~52 วัน · 1TB: ~103 วัน | ไม่ต้อง resize |

→ **LPR คือตัวปัญหา (รูปใหญ่ 972KB + rate สูง). Bosch สบาย. resize/downscale บังคับเฉพาะ LPR**

---

## 7. Network (Tier 2 — รูปอยู่ที่ site, อัพแค่ metadata)

| scenario | upload ขึ้น cloud |
|---|---|
| 200 busy LPR | ~0.35 Mbps (peak ~0.8) |
| 200 Bosch | ~0.003 Mbps |

→ อัพ cloud **< 1 Mbps แม้กรณีหนักสุด** (metadata ~1KB/event). รูปไม่ขึ้น cloud — fetch on-demand ผ่าน tunnel

---

<sub>เก็บก่อน fresh-start 2026-06-20 · วัดจาก production จริง · ใช้ประกอบ VIGIL-ARCH-003 + แผน storage restructure</sub>
