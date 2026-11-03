# SPEC — Partner API (Phase TP · B1–B3)

> ร่าง 2026-08-07 · **รออนุมัติก่อนเขียนโค้ด**
> ตัดสินไปแล้ว: **pull เป็นหลัก · push ไม่ทิ้ง เก็บไว้ทำต่อ · รูปแบบเอาแบบ Hikvision HCP / Dahua DSS เป็นต้นแบบ · อธิบายได้ด้วย OpenAPI 3.1**
> สถานะ B0: ✅ role `third_party_readonly` ซ่อมแล้ว (migration 118)

---

## 1. หลักที่ยึด

**สิทธิ์บังคับใช้ที่ Postgres ไม่ใช่ที่โค้ด API** — API ยืนยันตัวตน partner แล้ว `SET LOCAL ROLE <partner>_ro` ก่อน query ทุกครั้ง

```
partner --HTTPS + AK/SK--> API --SET LOCAL ROLE partner_x_ro--> Postgres
                                     └─ โค้ดบั๊กก็อ่านคอลัมน์ที่ไม่ได้ GRANT ไม่ได้
```

เหตุผล: เราเพิ่งเจอกับตัวเองว่าโค้ดที่ดู "ครบ" ในตัวเองยังพลาดได้ (`no_seatbelt` หายไปทั้งเส้นทางโดยไม่มี error) — ด่านที่หลบไม่ได้จึงไม่ควรอยู่ในโค้ดที่เราเขียนเอง

**สิ่งที่จงใจไม่ทำ:** ไม่ให้ partner ต่อ Postgres ตรง — แม้ role จะรองรับ เพราะจะคุม rate/audit/versioning ไม่ได้ · Postgres role เป็น**ด่านหลัง** ไม่ใช่ประตูหน้า

---

## 2. B1 — ตัวตนของ partner

### 2.1 ตาราง `api_consumers`

| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| `id` | bigserial | |
| `slug` | text unique | `partner_a` — ใช้ตั้งชื่อ db role |
| `label` | text | ชื่อที่แสดงในหน้าจอ |
| `app_key` | text unique | ส่งใน `X-Ca-Key` — ไม่ลับ |
| `app_secret_enc` | text | **AES-256-GCM ถอดได้** — HMAC ต้องใช้ค่าจริงคำนวณซ้ำทุก request จึง hash ไม่ได้ (แก้จากร่างแรกที่เขียนว่า `app_secret_hash`) |
| `db_role` | text | `partner_a_ro` — login user ที่ `SET LOCAL ROLE` จะสวม |
| `active` | boolean | ปิดได้ทันทีโดยไม่ต้องลบ |
| `rate_per_min` | int | default 60 |
| `expires_at` | timestamptz | credential หยุดทำงานเมื่อถึงเวลานี้ · NULL = ไม่หมดอายุ · **ตรวจตอนยืนยันตัวตน ไม่ใช่ job รายคืน** (migration 123) |
| `created_at` / `created_by` / `revoked_at` | | audit |

> **แก้จากร่างแรก 2026-08-07:** เคยเขียนว่าเก็บ hash และลืมแล้วต้อง rotate — **ทำไม่ได้** เพราะ HMAC
> ต้องมีค่า secret จริงมาคำนวณลายเซ็นซ้ำทุกครั้ง ถ้าเก็บ hash ก็ตรวจไม่ได้ · จึงเก็บแบบเข้ารหัส
> ถอดได้ และ**อ่านคืนได้** (`node src/partner-admin.js reveal <slug>` หรือปุ่มบนหน้าจอ) โดยมี audit
> ว่าใครดูเมื่อไหร่ · `rotate` สงวนไว้ใช้ตอน secret รั่วจริงเท่านั้น

### 2.2 การยืนยันตัวตน — ตามแบบ HCP Artemis

เรามีตัวเซ็นฝั่ง client อยู่แล้วที่ [`src/helpers/hcpSign.js`](../src/helpers/hcpSign.js) → ฝั่งตรวจใช้ตรรกะเดียวกันกลับด้าน **และเทสต์ข้ามกันได้ด้วยของจริง**

```
X-Ca-Key                 app_key
X-Ca-Nonce               UUID ต่อ request
X-Ca-Timestamp           epoch ms
X-Ca-Signature           HMAC-SHA256(stringToSign, app_secret) → base64
X-Ca-Signature-Headers   x-ca-key,x-ca-nonce,x-ca-timestamp
```

stringToSign — **header ที่ไม่ได้ส่ง ไม่ให้บรรทัดเลย ไม่ใช่บรรทัดว่าง**:
```
METHOD \n Accept \n [Content-MD5 \n] Content-Type \n
<signed headers เรียงชื่อ "name:value\n">
<path + query เรียงชื่อ>
```

> 🔴 **แก้ 2026-08-08 (commit `06c9861`)** — ร่างแรกเขียนว่า "ช่องว่างยังต้องมี newline" ซึ่ง**ผิด**
> Developer Guide V3.0.1 §3.2 หน้า 29: *"if the Accept, Content-MD5, Content-Type, or Date header
> does not exist, \n is not required"* · เราไม่เคยส่ง `Date` และไม่ส่ง `Content-MD5` เมื่อไม่มี body
> จึงต้องไม่มีสองบรรทัดนั้น · **request ที่ไม่มี body มีสามบรรทัดก่อน header block ไม่ใช่ห้า**
> ผลของการเขียนผิด: ยิง HCP จริงได้ `code 68` ทุกครั้ง 96 รูปแบบ กว่าจะเจอ

**กัน replay:** timestamp ต่างจากเวลาเซิร์ฟเวอร์เกิน **5 นาที → 401** · nonce ซ้ำภายในหน้าต่างนั้น → 401 (เก็บใน memory + TTL)

### 2.3 การสร้าง partner (ops)

1. สร้างแถว `api_consumers` → ระบบ gen `app_key` + `app_secret` (แสดงครั้งเดียว)
2. `CREATE ROLE <slug>_ro LOGIN PASSWORD <random>` + `GRANT third_party_readonly TO <slug>_ro`
3. column-scoping ทำใน **TP2** (ยังไม่ทำรอบนี้ — รอบนี้ได้ทั้ง view ตาม role)

> เพิกถอน = `active=false` (ทันที) แล้วค่อย `DROP ROLE` ตอนสะดวก

---

## 3. B2 — API surface

### 3.1 รูปแบบร่วม

| | |
|---|---|
| base | `/v1` |
| อ่านด้วย | **`GET` สำหรับดึงต่อเนื่อง · `POST` สำหรับค้นป้ายทะเบียน** — แยกตามงาน ไม่ใช่ตามรสนิยม (decision #227) |
| เวลา | **ISO 8601 UTC** เท่านั้น |
| แบ่งหน้า | `pageSize` (ชื่อที่ integrator คุ้นจาก DSS/HCP) + **`cursor` แบบ opaque** |
| error | **RFC 7807** `application/problem+json` |
| rate limit | เกิน → `429` + `Retry-After` |

**ทำไมไม่ใช้ `page` แบบ DSS:** ข้อมูลเราเข้าตลอดเวลา (LPR ~700,000/วัน) offset paging จะ**ข้ามหรือซ้ำแถว** ระหว่างที่ partner ไล่หน้า — บทเรียนเดียวกับ keyset search ที่ทำใน LPR ไปแล้ว
`cursor` เข้ารหัสจาก `(event_time, id)` ของแถวสุดท้าย → เดินต่อได้แน่นอนไม่ซ้ำไม่ขาด

### 3.2 Endpoint รอบแรก

**ก · ดึงต่อเนื่อง — `GET` พารามิเตอร์ ASCII ล้วน**

| path | คืนอะไร | view เบื้องหลัง |
|---|---|---|
| `GET /v1/lpr/events` | เหตุการณ์ป้ายทะเบียน | `v_license_plates_public` + `v_events_public` |
| `GET /v1/face/events` | เหตุการณ์ใบหน้า/ร่างกาย | `v_events_public` + `v_appearances_public` |
| `GET /v1/cameras` | รายการกล้อง (ไม่มี credential) | `v_cameras_public` |
| `GET /v1/openapi.json` | spec ของ **partner รายที่เรียก** | generate (JSON — OpenAPI 3.1 รับทั้ง JSON และ YAML) |

parameter ร่วม: `since` (บังคับ) · `until` · `pageSize` (1–1000, default 100) · `cursor` · `cameraId`
**ทุกตัวเป็น ASCII** — ค่าที่มีอักขระนอก ASCII ตอบ `400 non-ascii-query` (ใส่แล้วใน TP1b)

**ข · ค้นเฉพาะเจาะจง — `POST` + JSON body**

| path | คืนอะไร |
|---|---|
| `POST /v1/lpr/search` | ค้นด้วยข้อความป้าย (ไทยได้) · `{ plate, exact?, since?, until?, pageSize?, cursor? }` |
| `POST /v1/face/search` | (เฟสหลัง) |

**ทำไมต้องเป็น `POST`** — วัดจริง 7 วัน: **90.2% ของป้าย (4,502,050 จาก 4,993,900) เป็นอักษรไทย** · อักขระนอก ASCII เซ็นผ่าน query string ไม่ได้ (วิ่งบนสายแบบ percent-encoded แต่ client เซ็นค่า decoded และตัวเข้ารหัสคนละตัวได้สตริงคนละแบบ) · body เซ็นผ่าน `Content-MD5` บนไบต์ดิบ จึงไม่มีปัญหานี้เลย · **HCP Artemis ที่เราใช้เป็นต้นแบบก็ `POST` อ่านทุกตัว** ด้วยเหตุผลเดียวกัน — เหตุผลเต็ม decision #227

```json
{ "data": [ … ], "nextCursor": "eyJ0IjoiMjAyNi0wOC0wN1QwMDowMDowMFoiLCJpIjoxMjM0fQ", "pageSize": 100 }
```
`nextCursor` เป็น `null` เมื่อหมด

### 3.3 สิ่งที่ endpoint **ไม่** ทำ

- ไม่คืนรูปเป็น base64 — คืน **URL ที่หมดอายุ** (ไฟล์อยู่ที่ edge ต้อง proxy · retention รูป LPR 6 วัน ต้องบอก partner ให้ชัด)
- ไม่มี endpoint เขียนอะไรทั้งสิ้นในรอบนี้
- ไม่คืนข้อมูล blacklist/คดี — เป็นคนละเรื่องที่ต้องผ่านการอนุญาตทางกฎหมาย (ตาม ROADMAP Phase TP)

---

## 4. B3 — spec ที่ generate เอง

`GET /v1/openapi.yaml` สร้างจาก **route ที่มีจริง + grant จริงของ partner ที่เรียก** ในเวลาที่เรียก

- `openapi: 3.1.0` · `securitySchemes: { type: apiKey, in: header, name: X-Ca-Key }` พร้อมคำอธิบายวิธีเซ็น
- `info.x-generated-from` บอกว่าอ่าน grant มาเมื่อไหร่
- partner คนละรายเปิดแล้ว **เห็นคนละ schema** ตามสิทธิ์ตัวเอง
- **เงื่อนไขในเทสต์:** spec ต้องผ่าน validator (OpenAPI 3.1 meta-schema) — ถ้าไม่ผ่าน เทสต์แดง

> จุดสำคัญ: `docs/REF_api-reference.md` วันนี้เป็น Markdown ที่คนเขียนเอง — เครื่องอ่านไม่ได้และหลุดจากความจริงได้ · spec ที่ generate หลุดไม่ได้โดยนิยาม

---

## 5. push — ไม่ทิ้ง แต่ยังไม่ทำ

เก็บไว้เป็น **`webhooks`** ของ OpenAPI 3.1 (มีที่ทางในมาตรฐานอยู่แล้ว) เติมทีหลังได้โดยไม่ต้องรื้อ pull

ก่อนทำต้องมี: คิว/retry ต่อ partner · การยืนยันปลายทาง · บทเรียนจาก CIB (`403` ทั้ง 6 ครั้ง — ปลายทางอาจปฏิเสธเราด้วยเหตุที่มองไม่เห็นจากฝั่งเรา)

**อัปเดต 2026-08-08 — ตั้งชื่อว่า Phase PS และคง ROADMAP ไว้ ไม่ให้เลขขั้นปนกับ CP/FC** เพราะ CP/FC
เป็นเอกสาร + guard หนึ่งจุด ส่วน PS เป็นโครงสร้างพื้นฐาน คนละขนาดกันมาก

**มีอยู่แล้ว** — `createForwarder()` (`src/lpr-forward.js`) ทำ spool ลงดิสก์ · drain timer ·
`maxAgeMs` · `timeoutMs` · `maxConcurrent` ครบ
**ยังขาด** — dead-letter · ปลายทางต่อ partner · การ subscribe/unsubscribe · **เพดานที่ประกาศได้**

> **บทเรียนจาก HCP ที่ต้องลอก** — เขาสัญญาได้เพราะเขา **กำหนดเพดาน**: *"cache 500 event นาน 1 วัน"*
> ไม่ใช่ *"เราจะ retry"* · **ถ้าทำ PS ต้องเลือกตัวเลขก่อนเขียนโค้ด** ไม่ใช่เขียนโค้ดแล้วค่อยดูว่าได้เท่าไหร่

**ห้ามสับสนกับ push อีกความหมาย:** `push-enable`/`push-apply` ของ blacklist คือ**เราไปแก้ข้อมูลในระบบต้นทาง** (DSS/Guru) เป็นคนละเรื่องกับ partner ที่มาขอข้อมูล

---

## 6. UI ที่จะต่อเข้ากับหลังบ้านนี้

หน้าตาผ่านการรีวิวแล้ว **ยกดีไซน์ไปใช้ทั้งชุด ไม่ออกแบบใหม่**

| หน้า | demo | หลังบ้านที่ต้องมีก่อน |
|---|---|---|
| **3rd Party Integration** | [`/others/demo/OpenAPI/`](/others/demo/OpenAPI/) | TP1 (ตัวตน) + TP2 (API) — หน้าอ่านสิทธิ์จาก `information_schema` |
| **เพิ่มรายการเฝ้าระวังด้วยมือ** | [`/others/demo/blacklist-manual/`](/others/demo/blacklist-manual/) | BM1 (endpoint เขียน manual entry) |

**สิ่งที่ต้องเปลี่ยนตอนย้ายจาก demo → ของจริง** (วัดจากไฟล์จริง):

| | demo | ของจริง |
|---|---|---|
| ข้อมูล | hardcode `DOMAINS`+`PARTNERS`+`REC_*` บรรทัด 44–183 | เรียก route จริง |
| ส่วน render | **บรรทัด 185–441 (6 ฟังก์ชัน) — ใช้ต่อได้เกือบทั้งหมด** | เหมือนเดิม |
| CSS | 216 + 135 บรรทัด | **ยกไปทั้งไฟล์** |
| ที่อยู่ | `public/others/demo/` | `dashboard/page-*.js` + nav |
| สิทธิ์ | เปิดดูได้ | **admin เท่านั้น** |
| i18n | ไทย hardcode | ต้องเพิ่มทั้ง `th` และ `en` (gotcha #42) |
| ปุ่มแก้ไข | กดได้ | ล็อกไว้ก่อนในเฟสอ่านอย่างเดียว |

---

## 7. แผนลงมือ

> เดิม ROADMAP ใช้ TP1–TP4 (เรียงจาก UI) สเปกนี้เคยใช้ B0–B5 → **ชนกัน** · ต่อจากนี้ใช้ชุดนี้ชุดเดียว ROADMAP ชี้มาที่นี่

### ระดับความเสี่ยง — ใช้ตัดสินว่าต้องดูละเอียดแค่ไหนก่อนอนุมัติ

| | ความหมาย |
|---|---|
| 🟢 | **additive** — สร้างของใหม่ ไม่แตะของเดิม ถอยได้ด้วยการลบ |
| 🟡 | **แตะข้อมูล/คอนฟิกของจริง** — ต้อง verify ก่อนถือว่าเสร็จ |
| 🔴 | **เปิดออกสู่ภายนอก** — ถอยยากเมื่อ partner ถือ credential แล้ว ต้องยืนยันแยก |

---

### Phase TP — Partner API

| ขั้น | งาน | ไฟล์ | เกณฑ์เสร็จ | บล็อกด้วย | คู่ขนานกับ | ⚠️ |
|---|---|---|---|---|---|---|
| **TP0** | ✅ ซ่อม role | `db/db_migration_118_*.sql` | ทดสอบแล้ว 2026-08-07 | — | — | 🟢 |
| **TP1a** | ✅ ตาราง `api_consumers` + `api_request_log` | `db/db_migration_119_api_consumers.sql` | apply แล้ว · re-run สะอาด | — | BM ทั้งสาย | 🟢 |
| **TP1b** | ✅ ตัวตรวจลายเซ็น | `src/helpers/hcpVerify.js` | self-test 20 ข้อผ่าน | TP1a | BM | 🟢 |
| **TP1c** | ✅ middleware + `/v1/healthz` + CLI ops | `src/routes/partner-api.js` · `src/partner-admin.js` · `src/api-server.js` | e2e 19 ข้อผ่านกับ server จริง | TP1b | BM | 🟡 |
| **TP2a** | ✅ `GET /v1/cameras` | `src/routes/partner-api.js` · migration 120 | 19/19 · site scoping 84/143 · view แคบลงตัด IP ออก | TP1c | TP4 · BM | 🟡 |
| **TP2b** | ✅ `GET /v1/lpr/events` + cursor | ↑ | **20,585 = 20,585 เป๊ะ** · ทดสอบขณะข้อมูลไหลเข้า (+194 แถว ของเดิมไม่หาย) | TP2a | TP4 · BM | 🟡 |
| **TP2c** | ✅ `GET /v1/face/events` | ↑ · migration 121 | **22,183 = 22,183 เป๊ะ** (เจอบั๊ก cursor ไมโครวินาที GOTCHAS #146) · index 30,632→88 buffer | TP2b | TP4 · BM | 🟡 |
| **TP2d** | ✅ rate limit + 429 | ↑ | โควตา 5 → ผ่าน 5 แล้ว 429 · `Retry-After: 60` | TP2a | TP4 · BM | 🟢 |
| **TP2-search** | ✅ `POST /v1/lpr/search` | ↑ | 11/11 · ค้นป้ายไทยได้ · แก้ body หลังเซ็น → 401 | TP2b | TP4 · BM | 🟡 |
| **TP3** | ✅ `GET /v1/openapi.json` | `src/openapi-gen.js` · `helpers/partnerSchema.js` | ผ่าน meta-schema 3.1 จริง (พร้อม control 2 ข้อ) · partner 2 ราย → 5 path vs 2 path | TP2c | TP4 · BM | 🟢 |
| **TP4** | ✅ **หน้าเชื่อมต่อภายนอก** (Settings rail) | `routes/integrations.js` · `page-integrations.js` · `index.html` · `i18n.js` · `index.css` | 9/9 · 11 partner · 124 คอลัมน์ · **390px ผ่าน** · admin เท่านั้น | TP1c | TP2/TP3 · BM | 🟢 |
| **TP5** | ✅ แก้ column GRANT + audit | ↑ | 8/8 · ติ๊กแล้วยังไม่มีผล · กดยืนยันแล้ว partner ได้ 403 ทันที · audit บันทึกรายการที่เปลี่ยน | TP4 · TP3 | BM | 🟡 |
| **TP-PUB-a** | ✅ **กันโฮสต์ partner ไม่ให้เสิร์ฟ dashboard** | `src/api-server.js` · `src/.env` | bypass 19 แบบ → 404 หมด · เส้นทางจริง 8 เส้น → 401 ครบ · dashboard ไม่กระทบ (GOTCHAS #147) | — | — | 🟡 |
| **TP-PUB-b** | **เพิ่ม hostname ใน Cloudflare** | Cloudflare Zero Trust (tunnel ใช้ token — ทำบนเครื่องไม่ได้) | เรียกจากนอกได้ · `/`, `/login.html` บนโฮสต์นั้น = 404 | **เจ้าของทำเอง** → [`REF_partner-api-tunnel.md`](REF_partner-api-tunnel.md) | — | 🔴 |
| **TP6** | push / `webhooks` | — | | หลัง CIB นิ่ง | — | 🔴 |

### Phase BM — Manual Blacklist

| ขั้น | งาน | ไฟล์ | เกณฑ์เสร็จ | บล็อกด้วย | ⚠️ |
|---|---|---|---|---|---|
| **BM0** | ✅ source `manual` | `db/db_migration_124_manual_source.sql` | 14/14 · idempotent 3 รอบ · scheduler ไม่หยิบ · bridge ไม่พัง | — | 🟢 |
| **BM1a** | ✅ endpoint เพิ่มป้ายทะเบียน | `src/routes/blacklist-sources.js` | 30/30 · เรียก `upsertRecord()` ของ importer เอง · เพิ่มซ้ำ = แก้ไข · `lpr_watchlist` ไม่ถูกแตะ | BM0 | 🟡 |
| **BM1b** | ✅ endpoint เพิ่มใบหน้า | ↑ | เข้าถึง `master` · status = "ยังไม่เฝ้า" (derived statement, no schema change) · id_number plaintext → upsertRecord() encrypts · checkThaiNationalId validation · audit after COMMIT | BM0 | 🟡 |
| **BM2** | ✅ ต่อหน้า demo เข้าของจริง — ป้ายทะเบียน + ใบหน้า | `dashboard/page-blacklist-manual.js` · `i18n.js` | บันทึกได้จริง · display `partial` flag warning · `overridden` fields already shown · i18n th+en added | BM1b | 🟢 |
| **BM3** | ✅ RBAC + audit | ↑ | requireAdminForWrites('/api/blacklist') gates POST · audit logs after COMMIT (BM1a/BM1b pattern) · non-admin gets 403 | BM2 | 🟡 |

**ตัดสินใจแล้ว 2026-08-08 (เจ้าของ)**
- **admin เท่านั้น** — ได้มาฟรีจาก `app.use('/api/blacklist', requireAdminForWrites('/'))` · BM3 เหลือแค่ audit
- **คนพิมพ์ชนะ roster เรื่องกลุ่ม** (commit `4d611a7`) — `ORDER BY (source_type='manual') DESC, r.id`
  แต่**เฉพาะกลุ่ม** · จังหวัด/หมายเหตุ/รูป ยังแข่งกันตามความครบถ้วน มีรูปมาก่อน
- **BM1a ไม่ sync ให้อัตโนมัติ** — เข้า reservoir แล้วให้เจ้าหน้าที่กดนำไปใช้จากหน้า bridge เหมือน import
  คำตอบของ endpoint ส่ง `also_in` / `overridden` / `will_be` มาให้บอกได้ว่าจะเกิดอะไรขึ้นจริง

**✅ BM2 ปิดครบ 2026-08-08 — แท็บใบหน้าใช้งานได้จริง (ผ่าน 11/11 ที่ 390px)**

ขับหน้าจอจริงด้วย puppeteer: เปิดโมดัล → แท็บป้ายทะเบียนมีฟอร์ม → กดแท็บใบหน้าแล้ว
สลับได้ (336×454) → ช่องกรอกครบ 4 ช่อง → `scrollWidth` = 390 ไม่มี scroll แนวนอน →
เลข checksum ผิดหน้าจอฟ้อง → เลขถูกบันทึกสำเร็จ แสดง **"ยังไม่เฝ้า"** → `blacklist.master`
มีแถวจริง เลขบัตรเป็น `enc:v1:` → ไม่หลุดเข้า `lpr_watchlist` → เก็บกวาดกลับ baseline

**บั๊ก 2 จุดที่รอบแรกมองไม่เห็นเพราะรายงานมาจากการอ่านโค้ด:**

| อาการ | ต้นเหตุ |
|---|---|
| กดแท็บแล้วไม่มีอะไรเกิดขึ้น | `blmSwitchTab` ไม่ได้ลงทะเบียนใน action map ของ `page-nav-bindings.js` · CSP บล็อก inline handler ทุกตัว ปุ่มจึงเงียบสนิท |
| โมดัลขึ้นแค่แถบแท็บกับปุ่ม **ไม่มีฟอร์มเลยสักแท็บ** | `.blm-tab-content{display:none}` ใน `index.css` ซ่อนทั้งสองกล่อง · ตัวที่ active ไม่มี inline style มา override — JS ตั้งใจให้ inline style เป็นตัวซ่อนอยู่แล้ว กฎนี้จึงเกินมา |

> ⚠️ **`offsetParent` ใช้วัดการมองเห็นของ modal ไม่ได้** — modal เป็น `position:fixed`
> ซึ่ง `offsetParent` เป็น `null` เสมอ · ต้องใช้ `getBoundingClientRect()` + computed style
> (การทดสอบรอบแรกของผมเองพลาดตรงนี้ ทำให้กล่าวหาโค้ดผิดไปหนึ่งรอบ)

แก้คำผิดที่เห็นบนภาพด้วย: "ฐานข้อมูลฐานข้อมูล" ซ้ำคำ · หัวข้อ "ทั่วไป" → **"ยังไม่เฝ้าระวัง"**
ให้ตรงกับสิ่งที่กล่องนั้นบอก · และช่องชื่อในแท็บใบหน้าใช้คีย์ `blm.name` ร่วมกับแท็บ
ป้ายทะเบียนซึ่งแปลว่า **"ชื่อผู้ครอบครอง"** (เจ้าของรถ) → แยกเป็น `blm.faceName` = "ชื่อบุคคล"

**สิ่งที่ BM2 ต้องรู้**
- `/api/blacklist/bridge/preview` และ `/sync` ส่งฟิลด์ `partial` มาแล้ว **แต่ยังไม่มีใครแสดง** —
  sync ที่ระบุ `rule_ids` จะไม่ถอนป้ายใด ๆ (เพราะมองไม่เห็นว่ามี rule อื่นถืออยู่ไหม) ต้องบอกผู้ใช้
- ป้ายที่ roster ถืออยู่แล้ว จะถูกทับ**เฉพาะกลุ่ม** — หน้าจอควรแสดง `overridden` ให้เห็นว่าช่องไหนไม่มีผล

> ⚠️ **เลข migration ของ BM0 เคยเป็นการจองล่วงหน้าแล้วถูกแซง** — จองไว้ `120` แต่สาย TP ที่เดิน
> คู่ขนานกันชิงไปใช้ (`120_partner_scope`) กว่าจะรู้ก็ตอน 2026-08-07 ที่เลขเดินถึง 123 · ลงจริงเป็น `124`
> ขั้นที่เหลือถ้าต้องมี migration ให้ `ls db/db_migration_*.sql | tail -1` ก่อนตั้งชื่อไฟล์ทุกครั้ง

---

### Phase CP — นโยบายความเข้ากันได้ของ `/v1` · 📝 วางแผนแล้ว 2026-08-08 ยังไม่เริ่ม

> มาจากการเทียบ API ของเรากับ **HikCentral Professional OpenAPI V3.0.1** หลังต่อ HCP สำเร็จ
> (`docs/vendor/hikvision/HCP_OpenAPI.pdf` — อยู่ใน repo, 771 หน้า)
>
> **ทำก่อน Phase FC เสมอ** — FC คือการ *ประกาศคำสัญญา* (retention, อายุ cursor, พฤติกรรมตอนขาดช่วง)
> CP คือ *กติกาว่าคำสัญญาที่ประกาศแล้วจะเปลี่ยนได้อย่างไร* · ประกาศก่อนมีกติกา = ผูกมัดตัวเองโดยไม่มีทางถอย

| ขั้น | งาน | ไฟล์ | เกณฑ์เสร็จ | บล็อกด้วย | ⚠️ |
|---|---|---|---|---|---|
| **CP1** | ✅ เขียนนโยบาย v1 ลงสเปกที่ partner อ่าน | `src/openapi-gen.js` · `docs/REF_partner-onboarding.md` | **7/7 ผ่าน** — ดึง `/v1/openapi.json` จริงเห็นครบ: ทำได้ใน v1 / ต้องขึ้น v2 / client ต้องทน field ที่ไม่รู้จัก / ถอนคอลัมน์ = 403 ทั้ง endpoint / cursor opaque | — | 🟢 |
| **CP2** | ✅ guard ตอนถอนสิทธิ์คอลัมน์ | `dashboard/page-integrations.js` · `src/routes/integrations.js` | ติ๊กเอาคอลัมน์ออก → เตือนว่า partner รายนี้เรียก endpoint นั้นกี่ครั้งใน 7 วัน และจะได้ 403 ทันที | CP1 | 🟡 |
| **CP3** | ✅ ประกาศ format ของ cursor เป็นส่วนหนึ่งของสัญญา | `src/routes/partner-api.js` · `src/openapi-gen.js` | **ผ่าน** — เจ้าของเลือก **(ข)** 2026-08-08 · cursor มี `v:1` แล้ว · เอกสารระบุ `{v,t,i}` ตรงตามที่โค้ดสร้างจริง · cursor เก่าที่ไม่มี `v` ยังใช้ได้ · `v:2` → `400` ไม่ใช่ตีความมั่ว | CP1 | 🟡 |

**ตารางที่ CP1 ต้องเขียน**

| ทำใน `v1` ได้ | ต้องขึ้น `/v2` |
|---|---|
| เพิ่ม field ใน response | ลบ / เปลี่ยนชื่อ field |
| เพิ่ม query/body param ที่เป็น **optional** | เปลี่ยนชนิดข้อมูล หรือความหมาย |
| เพิ่ม endpoint ใหม่ | เพิ่ม param **บังคับ** |
| | **เปลี่ยนสูตรลายเซ็น** |

- **ข้อที่คนลืมบ่อยที่สุด** — "เพิ่ม field = ไม่ breaking" จริงก็ต่อเมื่อเขียนบอก partner ว่า
  **client ต้องไม่พังเมื่อเจอ field ที่ไม่รู้จัก** ถ้าไม่เขียนไว้ การเพิ่ม field ก็เป็น breaking
- **ถอนสิทธิ์คอลัมน์ = breaking เฉพาะราย** ต้องมีขั้นตอน ไม่ใช่ติ๊กแล้วจบ → นั่นคือ CP2

**ทำไมต้องทำตอนนี้** — 2026-08-08 เปลี่ยนสูตรลายเซ็น **3 commit ติดกัน** (`06c9861` `3c6b2f8` และ
`vigil_client.py`) **ฟรีทั้งหมดเพราะ partner = 0 ราย** · ถ้า CIB ต่ออยู่แล้ว ทั้งสามครั้งจะทำให้เขาพัง
เงียบ ๆ ด้วยอาการ `bad-signature` ตลอดกาล ซึ่งเป็นอาการเดียวกับที่กินเวลาไปทั้งวันกับ HCP

**เหตุผลของ CP3** — `encodeCursor` คือ `base64url(JSON.stringify({t,i}))` **partner ถอดอ่านได้ใน
30 วินาที** ถ้าเขียนในสเปกว่า "opaque" ทั้งที่ถอดได้ ก็เป็นเอกสารที่พูดไม่ตรงกับโค้ด — ความผิดพลาด
คลาสเดียวกับที่ทำให้ `hcpSign.js` ผิดมาตั้งแต่ต้น

**✅ เจ้าของตัดสิน 2026-08-08 = (ข) ประกาศรูปแบบเป็นสัญญา** · สิ่งที่ตามมา:
- เพิ่ม `v:1` เข้าไปใน cursor **ตอนนี้ที่ partner = 0 ราย** — ทำให้ cursor อธิบายตัวเองได้
  และรุ่นถัดไปตรวจจับได้โดยไม่ต้องเดา · ถ้ารอจนมี partner แล้วค่อยเพิ่ม จะเพิ่มไม่ได้ฟรีอีก
- `decodeCursor` ปฏิเสธ `v` ที่ไม่รู้จัก (→ `400`) แทนที่จะตีความมั่ว — กันกรณี deploy ไม่พร้อมกัน
  ทำให้ข้ามแถวเงียบ ๆ · `v` ที่หายไป (cursor ก่อนประกาศสัญญา) ยังรับ ไม่ทำของที่ถืออยู่พังกลางคัน
- **`t` คือเวลาแบบที่ Postgres พิมพ์ออกมา (`2026-08-08 03:52:04.443+00`) ไม่ใช่ RFC 3339** —
  ตั้งใจไม่แปลง เพราะแปลงแล้วเสี่ยงเสียความละเอียดที่ keyset ใช้เทียบ · แต่พอประกาศเป็นสัญญา
  ก็ต้องเขียนเตือนไว้ ไม่งั้น client ภาษาอื่น parse พัง
- **ราคาที่จ่าย:** เปลี่ยนรูปแบบนี้ต้องขึ้น `/v2` แล้ว · เพิ่มฟิลด์ยังทำได้ตามกฎ CP1

**Reproduce ของ CP3 + FC3 — รันจริง 2026-08-08 ผ่าน 24/24** (สร้าง partner ชั่วคราว `cp3probe`
→ ยิง `/v1/lpr/events` จริง → ลบทิ้ง) จุดที่ตรวจ: cursor ถอดได้เป็น `{v:1,t,i}` และ `i` ตรงกับ
แถวสุดท้ายจริง · หน้าถัดไปไม่มี id ซ้ำ · cursor ไม่มี `v` ให้ผลเท่ากับ `v:1` เป๊ะ · `v:2` → `400`
ไม่ใช่ `500` · เอกสารไม่มีคำว่า opaque แล้ว · **cursor ที่ชี้ไปยัง id ที่ไม่มีจริง (จำลองแถวถูก
prune) → `200` เดินต่อได้ ไม่ error** ซึ่งคือพฤติกรรมที่ FC3 ประกาศไว้พอดี

**✅ CP2 ลงมือแล้ว 2026-08-08 · reproduce ผ่าน 7/7 ผ่าน endpoint จริงที่เซ็นลายเซ็น**
`GET /api/integrations/:slug/endpoint-usage` นับจาก `api_request_log` ย้อน 7 วันต่อ path ·
หน้าจอเตือนก่อนถอนคอลัมน์ โดยอ่าน endpoint ที่กระทบจาก `helpers/partnerSchema.js` ตัวเดิม
ไม่สร้าง mapping ชุดที่สอง · ยืนยัน `has_column_privilege = false` ก่อนเรียก แล้วได้ `403
not-permitted` ทั้ง endpoint จริง (ไม่ใช่ field หาย) → คืนสิทธิ์แล้วกลับมา `200 · 100 แถว`
· ตรวจ 390px จริงด้วย puppeteer: `bodyScrollW = 390` ไม่มี scroll แนวนอน

> ⚠️ **บทเรียนของรอบนี้:** รอบแรก subagent รายงานว่า "[2] 403 ✅" ทั้งที่ output ของตัวเอง
> เขียนว่า query สำเร็จ — เพราะทดสอบด้วย SQL ตรง ไม่ได้ยิง endpoint · และทิ้ง partner ค้าง
> 3 ราย + role ค้าง 4 ตัวโดยเข้าใจว่า baseline คือ 3 (จริงคือ 0) · **ผลของ subagent ต้องรันซ้ำเองเสมอ**

**Reproduce ของ CP2 — รันจริงไปแล้ว 2026-08-08 ใช้เป็นเกณฑ์ได้เลย**

```
[1] partner ปกติ                                   → 200 · 100 แถว
[2] REVOKE third_party_readonly ก่อน แล้วถอน site_id → 403 not-permitted   ← ทั้ง endpoint ไม่ใช่แค่ field หาย
[3] คืนสิทธิ์                                      → 200 · 100 แถว
```

> 🔴 **ขั้น [2] ต้องถอด membership ก่อน** ไม่งั้น `REVOKE` รายคอลัมน์ **ไม่มีผลเลย** (membership ชนะ
> column revoke) แล้ว test จะเขียวหลอก — พลาดมาแล้วหนึ่งรอบ 2026-08-08
>
> เหตุที่พังทั้ง endpoint: query เป็น `SELECT ${CAMERA_COLS}` รายการตายตัว → Postgres โยน `42501`
> → `queryFailed()` แปลงเป็น `403 not-permitted`

**ตรวจแล้วว่าถูกกว่าที่คิด** — `ENDPOINTS` ใน `helpers/partnerSchema.js` **เป็นแหล่งเดียวอยู่แล้ว**
ทั้ง SQL และ `openapi-gen` อ่านจากที่นั่น → CP2 ใช้ซ้ำได้ ไม่ต้องทำ mapping ชุดที่สองให้ดริฟต์
และ `api_request_log` เก็บ `path` ต่อ request อยู่แล้ว ไม่ต้องเก็บอะไรเพิ่ม

---

### Phase FC — สัญญาเวลาพัง · 📝 วางแผนแล้ว 2026-08-08 ยังไม่เริ่ม

> ลอกนิสัยการเขียนเอกสารของ HCP ไม่ใช่ลอก endpoint — คู่มือหน้า 365 ระบุพฤติกรรมตอนล้มเหลวไว้ครบ:
> subscribe ซ้ำ dedupe ให้ · partner ล่ม cache 500 event นาน 1 วัน · OpenAPI restart แล้ว push ย้อนให้ ·
> "HCP ล่ม = ไม่รองรับ" บอกตรง ๆ · **การเขียนแบบนี้ไม่มีต้นทุน และเป็นคำถามแรกที่ CIB จะถาม**

| ขั้น | งาน | ไฟล์ | เกณฑ์เสร็จ | บล็อกด้วย | ⚠️ |
|---|---|---|---|---|---|
| **FC1** | ✅ retention จริง **ต่อ endpoint** | `src/helpers/partnerSchema.js` (`retentionKey`) · `src/openapi-gen.js` (`retentionFacts`) | **ผ่าน** — อ่านจาก `system_settings` + `min(timeColumn)` ตอน generate · face 40 วัน · lpr 365 พร้อมคำเตือนว่า**มีจริงน้อยกว่านโยบาย** · cameras ไม่มีท่อนนี้เพราะไม่มีมิติเวลา | CP1 | 🟡 |
| **FC2** | ✅ ขอเก่ากว่าที่มีจริง → `400` ไม่ใช่ `200` ว่าง | `src/routes/partner-api.js` (`tooOld`) | **ผ่าน** — `since=2026-01-01` บน face/events ได้ `400 since-too-old` พร้อมวันเก่าสุดจริง (เดิมได้ 200 ว่าง) · ช่วงปกติยัง 200 · lpr/search ไม่ใส่ since ยังใช้ได้ | FC1 | 🟡 |
| **FC3** | ✅ ประกาศอายุ cursor + พฤติกรรมตอนขาดช่วง | `src/openapi-gen.js` | **ผ่าน** — เอกสารบอกว่า cursor **ไม่หมดอายุ** (ไม่มี state ฝั่งเรา) แต่ข้อมูลหลังมันหายตาม retention · กลับมาช้าแล้วต่อได้เลย **ไม่ error** แต่ข้ามแถวที่ถูกลบไปถาวร · ตรวจได้เองโดยถอด `t` เทียบกับแถวแรกที่ได้ (ทำได้เพราะ CP3 เลือก (ข)) | CP3 | 🟡 |

**ช่องเงียบที่มีอยู่จริงแล้ววันนี้ — วัดเมื่อ 2026-08-08**

```
appearances    เก่าสุด 2026-06-28 = 40 วันพอดี   (appearances_retention_days = 40)
license_plates เก่าสุด 2026-07-03 = 35 วัน       (lpr_retention_days = 365 — ข้อมูลยังไม่ถึง)
api_consumers.max_lookback_days   = ไม่มี DEFAULT → NULL → ไม่จำกัด
```

⇒ partner ขอ `since=2026-01-01` บน `/v1/face/events` จะได้ **`200` + ว่างเปล่า** ตั้งแต่วันที่ 41
ย้อนขึ้นไป **โดยไม่มีอะไรบอกว่าทำไม** — คือความเงียบชนิดเดียวกับที่ HCP ตอบ `200` ให้ทั้ง
`code 64/68/8` แล้วทำให้แยกไม่ออกว่าผิดตรงไหน

⚠️ **retention ที่ตั้งไว้ ≠ ข้อมูลที่มีจริง** — LPR ตั้ง 365 แต่มีจริง 35 วัน เอกสารต้องพูดถึงทั้งสองอย่าง
⚠️ **`max_lookback_days` (ต่อ partner) กับ retention (ทั้งระบบ) เป็นคนละตัว** — ต้องบอกทั้งคู่
ไม่งั้น partner ที่ตั้ง lookback 90 วันจะงงว่าทำไมได้แค่ 40

**ตรวจแล้วว่าไม่ใช่ปัญหา** — `v_appearances_public` และ `v_license_plates_public` **ไม่มีคอลัมน์
path/URL รูปเลย** metadata จึงไม่ค้างชี้ไปหาไฟล์ที่ถูกลบตาม `lpr_image_retention_days = 6`
ตัดข้อกังวลนี้ออกจากแผนได้

**Reproduce ของ FC2** — สร้าง partner ชั่วคราว → `/v1/face/events?since=2026-01-01` →
**ตอนนี้ได้ `200` ว่าง (ยืนยันปัญหา)** → หลังแก้ต้องได้ `400` ที่บอกว่า "ข้อมูลใบหน้าเก็บ 40 วัน
เก่าสุดที่มีคือ 2026-06-28" → ลบ partner ทิ้ง

---

### Phase HC — เชื่อมกับ HikCentral Professional · 📝 วางแผนแล้ว 2026-08-08 ยังไม่เริ่ม

> ต่อ HCP ที่ `https://10.0.10.9:8443` สำเร็จแล้ววันนี้ · **V3.0.1.DZP20260313043.0**
> Integration Partner `vigil-platform` · AK `38051848` · ตัวเซ็นคือ `helpers/hcpSign.js` (แก้ commit `06c9861`)
> **central ไปไม่ถึง `10.0.10.9` ทุกอย่างต้องวิ่งจาก edge hkt** (ping ไม่ได้ TCP ไม่ติด)

**เหตุผลที่ HC1 เร่งด่วนกว่าที่คิดตอนแรก** — วัด 14 วันย้อนหลัง:

| Site | FaceCapture | FaceRecognition (match) | กล้อง |
|---|---|---|---|
| vss | 3,917 | 2,390 | 1 |
| **hkt (ภูเก็ต)** | **738,818** | **0** | **34** |

hkt ตั้งกล้องเป็น `mixedTargetDetection` ไม่ใช่ face recognition (ยืนยัน: 180,182 แถวมี
`srcEventType=mixedTargetDetection` ล้วน — ตรงกับ [[project_hik_mixedtargetdetection]])
⇒ **34 กล้องที่ภูเก็ตจับหน้าได้แต่ไม่เคยเทียบกับใครเลย · HCP คือแหล่งเดียวของ face match ที่นั่น**

> **ขอบเขตที่เจ้าของกำหนด 2026-08-08 — เรียงตามลำดับความสำคัญ** · หน้าจอเลือกขอบเขต:
> [`/others/demo/HCP-integration/scope.html`](/others/demo/HCP-integration/scope.html)
> (แคตตาล็อกเต็ม 231 ความสามารถอยู่ที่ `index.html` ข้าง ๆ)

| ขั้น | งาน | เกณฑ์เสร็จ | บล็อกด้วย | ⚠️ |
|---|---|---|---|---|
| **✅ HC0** | **ฐานร่วม** — `src/hcp-client.js` · เก็บ AK/SK เข้ารหัส · **ตารางแมป `cameraIndexCode` ↔ `camera_id`** | ✅ **Code complete** (commits TBD): hcp-client.js + migration 126 + hcp-setup.js · ⏳ **Awaiting edge test**: verify `/common/v1/version` + camera map population (requires HCP access from hkt) · secret encryption tested ✅ | — | 🟡 |
| **📝 HC1** | **① ผลเปรียบเทียบใบหน้า + แจ้งเตือน LINE** | **Code complete** (commit TBD): src/ingesters/hcp-face-matches.js · ⏳ **Awaiting edge + HCP test**: (1) 1-day backfill with alert rule disabled + verify Face Recognition page renders ✓ (2) create alert rule camera_ids=∅ + rule_name='Face Recognition Match' (3) verify LINE fires on controlled match (4) verify no double-fire with vss · Hazards handled: similarity÷100 ✓ · listType inference ✓ · camera map ✓ | HC0 | 🔴 |
| **HC2** | ✅ **② ค้นหาใบหน้าด้วยรูป** | อัปโหลดรูป → ได้ผลจาก HCP → join กับ `appearances` ของเราด้วย `camera + เวลา ±N` · มี audit ว่าใครค้นด้วยรูปอะไร | HC0 | 🟡 |
| **✅ HC3** | **③ Blacklist ทั้งหมด แยกกลุ่มตาม HCP** (face + lpr) | **ผ่าน 2026-08-08** — 16/16 กลุ่มตรงกับ HCP เป๊ะ (รวม 1,565 ใบหน้า) · รถ 13 คัน · `6ขจ7186` เข้า master 2792 ร่วมกับ GuruSquare · รวมกับของเดิม 7 ใหม่ 6 · Whitelist/VIP ไม่หลุดเข้ามา · นำเข้าซ้ำ = 0 แถวใหม่ | HC0 | 🟡 |
| **✅ HC4** | **④ สถานะอุปกรณ์ → แท็บใหม่ในหน้า Health Check** | **ผ่าน 2026-08-08** — กล้อง 756 (ออนไลน์ 687 / ออฟไลน์ 69) · encodeDevice 33 · recordServer 1 · intelligentServer 4 · alarmInput 1,472 · alarmOutput 138 · **เราดูแล 83 · HCP ดูแลตัวเดียว 673 · แมปค้าง 0** | HC0 | 🟢 |
| **✅ HC5** | **⑤ เหตุการณ์ของ HCP (ยกเว้น LPR/Face) → หน้าใหม่** | **ผ่าน 2026-08-08** — 756 กล้อง → 4 ก้อน · 298 ชนิด · 0 คำขอล้มเหลว · ผลจริง = **0 เหตุการณ์** (7 วันมีแต่หมวด 130 ซึ่งถูกตัดออกตามโจทย์) · หน้าจอบอกขอบเขตที่ค้นเสมอ | HC0 | 🟢 |
| **✅ HC-R** | **รองรับไว้ ปิดสวิตช์** — Ⓐ ป้ายทะเบียนทั้งหมด · Ⓑ เหตุการณ์ทั้งหมด · Ⓒ push subscription · วิดีโอสด/ย้อนหลัง · พื้นที่/บุคคล | **ผ่าน 2026-08-08** — `helpers/hcpOptional.js` · **6/6 ต่อได้จริง** (regions 38 · persons 2 · video URL · subscription view · crossRecords · events รวมหมวดที่ตัด) · ค่าปริยาย **ปิดหมด** · เปิดด้วย `HCP_OPTIONAL=<cap>` ใน .env ของ edge · **subscribe จริงจงใจไม่เขียน** (เป็นการเขียนลง HCP) | HC0 | 🟢 |

**✅ HC1 backfill ผ่านแล้ว 2026-08-08 — เหลือขั้น LINE ขั้นเดียว**

รัน 2026-07-15 หนึ่งวัน โดยยังไม่สร้างกฎแจ้งเตือน · ผล 5/5:
`52 แถวเข้า events` · `แมป camera_id ครบ 52/52 · 25 กล้อง` · `ขึ้นหน้า Face Recognition
เดิมครบโดยไม่แก้ไฟล์หน้าจอสักบรรทัด` · `รูปโหลดผ่าน /snapshots ได้ 10/10 ตัวอย่าง` ·
`รันวันเดิมซ้ำ → 52 เท่าเดิม (dedup ทำงาน)`

**บั๊ก 8 จุดที่เจอตอนรันจริง ทั้งหมดเงียบ ไม่มีอันไหนโยน error:**

| อาการ | ต้นเหตุ |
|---|---|
| ยิง 52 ถึงปลายทาง 0 | `process.exit()` ตัดก่อน MQTT เชื่อมต่อเสร็จ — ไม่มีแม้ log `🔌 edge-publisher` |
| ถึง central แล้วถูกทิ้ง | `faceMatchRecord` คืนข้อมูล**เป็นชั้น** (`cameraInfo.cameraIndexCode`) โค้ดอ่านแบบแบน → ทุกฟิลด์ undefined |
| ช่วงเวลาเลื่อน 7 ชม. | เอาเวลา UTC ไปแปะ `+07:00` ตรง ๆ |
| "ไม่มีข้อมูล" ทั้งที่มี | ไม่เช็ค `body.code` (HCP ตอบ 200 เสมอ) · อ่าน `data` แทน `data.list` · ยอดรวมชื่อ `totalNum` |
| กลุ่มใบหน้าโหลดไม่ได้ | `pageSize:1000` เกินเพดาน → ทุกแถวตกไป blackList เงียบ ๆ |
| รัน 2 รอบได้ 104 แถว | ไม่ได้ส่ง `dedup` — HCP ไม่มี id เสถียร (`recordIndexCode` = -1) ต้องประกอบคีย์เอง |
| LINE ไม่มีทางยิง | ไม่ได้ส่ง `alert` payload เลย |
| รูป 0/52 | endpoint คืน data-URI ที่ `body.raw` แต่โค้ดอ่าน `body.data` · แล้วเก็บผิดรูปแบบ path จน `/snapshots` หาไม่เจอ |

**✅ backfill เต็มช่วงแล้ว 2026-08-08 — 538 แถว ครอบคลุม 3 เดือน**

`2026-05-08 → 2026-08-06` · **แมป `camera_id` ครบ 538/538 · 59 กล้อง · 15 กลุ่ม ·
plaintext PII 0 แถว** · กฎแจ้งเตือนยังปิด ไม่มี LINE ออกสักครั้ง

**สองเรื่องที่ตรวจจนจบ แทนการเดา:**
- **HCP ส่งมา 542 เราเก็บ 538 — ไม่ใช่ข้อมูลหาย** · ดึงช่วง 2026-05-08→06-07 มานับเอง:
  HCP ส่ง **67 แถว แต่คีย์ (faceTime|personId|cameraIndexCode) ไม่ซ้ำมีแค่ 66** — ต้นทาง
  ส่งซ้ำเอง 1 แถว และเราเก็บไว้ 66 พอดี · ทั้งชุด 538 แถวมีคีย์ไม่ซ้ำครบ 538
- **รูปมีแค่ 200/538 เพราะ HCP ลบรูปทิ้งตามอายุ ไม่ใช่บั๊กของเรา**:

  | เดือน | แถว | มีรูป |
  |---|---|---|
  | 2026-05 | 60 | **0** |
  | 2026-06 | 267 | **0** |
  | 2026-07 | 203 | 192 (95%) |
  | 2026-08 | 8 | 8 (100%) |

  ⇒ เพดานอยู่ราว **30-40 วัน** · metadata ย้อนหลังได้ 3 เดือน แต่รูปได้แค่เดือนเศษ
  ⇒ ถ้าจะเก็บรูปไว้เอง ต้อง backfill ให้ทันภายในหน้าต่างนั้น

**กฎแจ้งเตือนสร้างแล้วแบบปิดไว้** (`db_migration_127`, เจ้าของสั่ง 2026-08-08) —
`camera_ids` ว่าง · `rule_names={Face Recognition Match}` · `list_types={blackList}` ·
**`enabled=false` และ `recipient_ids` ว่าง** สองชั้น แปลว่าเปิดสวิตช์อย่างเดียวยังไม่ส่ง
อะไรออกไป ต้องเลือกผู้รับก่อน (ใครควรได้รับแจ้งเตือนจริง = การตัดสินใจของเจ้าของ
ไม่ใช่ค่า default ของ migration) · ตรวจด้วย `matchRule()` ตัวจริงกับ event HCP จริง
ผ่าน 11/11: จะ match ถ้าเปิด · ไม่ match `whiteList` · ไม่ match `Face Capture` ·
**กฎเดิมทั้ง 3 ข้อไม่มีตัวไหน match** (ไม่ยิงซ้ำ) และยังปิดอยู่เหมือนเดิมทุกข้อ

**PII เข้ารหัสที่ central ไม่ใช่ที่ edge** (เจ้าของเลือก 2026-08-08) — `BLACKLIST_SECRET_KEY`
ถูกออกแบบให้เป็นคนละ key กับ `CAMERA_SECRET_KEY` โดยตั้งใจ (spec §4.3) เพื่อให้
camera key รั่วแล้วไม่พลอยเปิด PII · การแจก key ไปทุก edge ที่ต่อ HCP คือการรื้อ
เจตนานั้น จึงให้ edge ส่งค่าดิบมาบน `wss://` (ไม่เขียนลงดิสก์ edge) แล้ว
`mqtt-subscriber` เข้ารหัสก่อนแตะฐานข้อมูล · ฟิลด์ `_plain` ถูกลบทุกกรณี — ล้มเหลว
แล้วยอมเสียข้อมูลดีกว่าเก็บ plaintext · ผลจริง **51/52 แถวเป็น `enc:v1:` · `_plain`
ค้าง 0 · ถอดกลับได้ 3/3** (แถวที่ 52 คือ HCP ไม่ได้ส่ง `personInfo` มาเอง)

**`personCode` เป็นฟิลด์ปนกัน — ห้ามเรียกว่า national ID** วัดจาก **35 คนไม่ซ้ำที่
โผล่ในข้อมูลวันเดียว** (ไม่ใช่การสำรวจทั้งฐาน HCP): 17 คนเป็นเลขบัตรประชาชนไทย
ถูกต้อง (13 หลัก ผ่าน checksum) อีก 18 คนเป็นเลข 7-10 หลักซึ่งไม่ใช่เลขบัตร
> **17/35 คือสัดส่วนของตัวอย่างวันนั้น ไม่ใช่สัดส่วนของทั้งระบบ** — อย่าเอาไป
> อ้างเป็น "ครึ่งหนึ่งของคนในระบบมีเลขบัตร" · สิ่งที่ตัวอย่างนี้พิสูจน์คือ
> **ฟิลด์นี้ปนกันแน่นอน** ซึ่งพอแล้วสำหรับการตัดสินใจ (ปฏิบัติเป็น PII ทั้งคอลัมน์)

⇒ ปฏิบัติเป็น PII ทั้งหมด แต่ห้าม parse ตามรูปแบบเลขบัตร
> ⚠️ ระวังตอนตรวจ: `checkThaiNationalId()` คืน **`{ok, reason}` ไม่ใช่ boolean** —
> เขียน `!!checkThaiNationalId(x)` จะได้ true เสมอ (พลาดมาแล้วรอบหนึ่ง ทำให้เลข 7 หลัก
> ดูเหมือนผ่าน checksum)

**ยังเหลือ:** เลือกผู้รับ LINE + เปิดสวิตช์ + พิสูจน์เด้งจริงจาก match ใหม่

**🔴 HC1 ต้องสร้างกฎแจ้งเตือนใหม่ ไม่ใช่ "ใช้ของเดิมได้เลย"** — ร่างแรกของแผนนี้เขียนว่า
กฎที่มีอยู่จะจับได้เอง **ตรวจแล้วผิด** (2026-08-08):

```
alert_rules ทั้ง 3 ข้อ · enabled = false ทุกข้อ · ทุกข้อระบุ camera_ids ไว้ตัวเดียว
```

`alert-engine.js:69-79` จับคู่ด้วย `camera_ids` (ว่าง = ทุกกล้อง) · `rule_names` (เทียบกับ
`event.rule_name`) · `list_types` ⇒ **ไม่มีกฎไหนทำงานอยู่เลย และต่อให้เปิด ก็ครอบแค่ 1 กล้อง
ไม่ใช่ 61 กล้องของ HCP** · face match จาก HCP จะมี `rule_name = 'Face Recognition Match'`
ซึ่งต้องตรงกับ `rule_names` ของกฎด้วย

**เกณฑ์เสร็จของ HC1 จึงต้องรวม:** สร้างกฎที่ `camera_ids` ว่าง (ทุกกล้อง) +
`list_types = {blackList}` + ผู้รับ LINE → **แล้วเห็น LINE เด้งจริงจาก match ของ HCP**
ปริมาณที่คาด **~4.6 ครั้ง/วัน** (จาก 556 ครั้ง/120 วันที่วัดได้) — ไม่ท่วม
**และต้องตรวจว่าไม่ยิงซ้ำกับสายของ vss**

**✅ HC2 เสร็จและตรวจแล้ว 2026-08-08 — ค้นได้จากหน้าจอจริง**

`POST /api/hcp/face-search` (admin) → edge `POST /hcp-face-search` → HCP · หน้าใหม่
**ค้นใบหน้าด้วยรูป** ในแถบข้าง · ผลรัน: edge 9/10 · central **15/15** · หน้าจอที่ 390px **16/16**
· ภาพยืนยัน: อันดับ 1 = **100%** (รูปเจอตัวเองที่ `C42-SKU-SB-17`) · 100 แถว ·
`ค้นแล้ว 83 กล้อง · ตรงกับข้อมูลเรา 83/100 (±5 นาที)`

**เส้นทางรูป: ไม่ได้เปิดช่องทางใหม่บนเครื่องที่ตั้งอยู่สถานี** — พิสูจน์ก่อนออกแบบว่า
central POST ไป edge ได้อยู่แล้ว (`/blacklist-source-test` ตอบ 400 จากปลายทางจริง)
จึงเพิ่ม route ในเซิร์ฟเวอร์ตัวเดิม (`lpr-receiver.js`) ที่มี bearer gate เดียวกัน

**พารามิเตอร์ `captureSearch` ที่ใช้ได้จริง** (ไล่จาก error ของ gateway ทีละตัว):
`protocolType:0` · `intelligentServerIndexCode` · `targetModelData` · `cameraIndexCodes` ·
`startTime`/`endTime` · `sortType:'similarity'` · **`modelMaxNum`** · **`maxResults`** · `threshold`

| กับดัก | ของจริง |
|---|---|
| **ไม่ส่ง `threshold`** | คืน `numOfMatches = 0` แม้ค้นรูปที่ถ่ายจากกล้องตัวนั้นในช่วงเวลานั้นเอง — อ่านเหมือน "ไม่มีข้อมูล" ทั้งที่พารามิเตอร์ผิด |
| **hardcode server index** | `type 3` = BA server ตอบ `code 10 XML error` · ต้อง lookup `type 1` เอง (hkt มี 2 ตัว: 3 กับ 5) |
| **`similarity`** | endpoint นี้ส่งมาเป็น **0-1 อยู่แล้ว** ต่างจาก `faceMatchRecord` ที่เป็น 0-100 — หารร้อยซ้ำคือบั๊กที่รอเกิด |

**±5 นาที เป็นค่าที่วัดมา ไม่ใช่เดา** — เทียบเวลา HCP กับ `FaceCapture` ของ ingester เราเอง
บนกล้องเดียวกัน: **ใกล้สุด 0.0 วินาที** เฉลี่ย 28.8s จาก 8 คู่ (คนละใบหน้า ไม่ใช่นาฬิกาเพี้ยน)
· เป็นพารามิเตอร์ให้ผู้ใช้ปรับได้ ไม่ใช่ค่าคงที่

**PDPA: บันทึกก่อนค้น ไม่ใช่หลังสำเร็จ** — เก็บ `sha256` ของรูป ไม่ใช่ตัวรูป (ตอบได้ว่าใคร
ค้นด้วยรูปเดียวกันบ้าง โดยไม่สร้างคลังใบหน้าชุดที่สอง) · การค้นที่ error กลางทางก็ถูกบันทึก

> ⚠️ **`bootstrapApp` เป็น async และจบด้วย `showPage('summary')`** — กดเมนูก่อนมันเสร็จ
> จะโดนพากลับหน้าแรก · ไม่ใช่บั๊กของหน้าใหม่ (เฝ้าดู 110 วินาทีหลัง bootstrap เสร็จ หน้าอยู่นิ่ง
> ไม่มี reload) แต่การทดสอบ UI ต้อง `waitForFunction` ให้ถึง `page-summary` ก่อนเสมอ
> — ผมเสียเวลาไปสองรอบกับเรื่องนี้ และเกือบกล่าวหาโค้ดผิด

**ขอบเขตที่ค้นได้จริงแคบกว่า HC1** — `captureSearch` ครอบเฉพาะกล้องที่ Fusion Server
index ไว้ · หน้าจอจึงบอก "ค้นแล้วกี่กล้อง" ทุกครั้ง เพราะ "ไม่เจอ" กับ "ไม่ได้ค้นตรงนั้น"
เป็นคนละเรื่อง

**✅ HC2 ปลดล็อกแล้ว 2026-08-08 — ไม่ต้องขอเอกสารเพิ่ม** ร่างก่อนหน้าเขียนว่าติดเพราะ
แกะ `captureSearch` ไม่ได้ · ทดสอบใหม่แล้วผ่านทั้งเส้น ที่ล้มเพราะ**ส่งพารามิเตอร์ผิดเอง 3 จุด**:

| ผิดยังไง | ที่ถูก |
|---|---|
| ไม่ได้ส่ง `protocolType` ทั้งที่เป็น **Req** | `0` = Intelligent Fusion Server |
| หยิบ intelligent server ตัวแรกในลิสต์ ซึ่งเป็น **BA server (`type 3`)** → `code 10 XML error` | ต้องเป็น **Fusion Server (`type 1`)** · hkt มี `3` = Fusion Server 1 · `5` = Old T4 |
| `sortType: "time"` ตามตัวอย่างในคู่มือ | **เครื่องจริงรับแค่ `"similarity"`** — `code 1: sortType value error, correct is [similarity]` · **ตัวอย่างในคู่มือผิดเอง** |

ผลจริง: `pictureRecognitionModel` → `code 0` คืน `targets[].targetModelData` + `faceRect`
(รูปเดียวมีหลายหน้าได้ เลือกได้ว่าจะค้นหน้าไหน) · `captureSearch` → `code 0`

**🔴 เพดานที่ต่างจาก faceMatchRecord:** `captureSearch` **ค้นได้ครั้งละไม่เกิน 7 วัน**
(`code 2: Time range is more than 7 days`) ไม่ใช่ 31 วัน ⇒ **ค้นย้อน 90 วันต้องยิง 13 รอบ**

**ข้อจำกัดที่ต้องเช็คตอนตั้งค่า:** ต้องมี **Intelligent Fusion Server (`type 1`)** ในไซต์นั้น
ถ้าไม่มี ฟีเจอร์นี้ใช้ไม่ได้เลย — ต่างจาก HC1 ที่ไม่ต้องพึ่ง

**HC4/HC5 ออกแบบหน้าจอเอง** (เจ้าของมอบให้) — HC4 เป็น**แท็บใหม่ในหน้า Health Check เดิม**
ไม่ใช่หน้าใหม่ · HC5 เป็นหน้าใหม่

#### หน้าจอ — ใช้ของเดิม ไม่สร้างใหม่

`page-face-matches.js` + `/api/face-matches` รองรับ vendor ที่สองมาแล้ว (Dahua, 2026-07-15) ด้วยการ
**ขยาย `RECOG_TYPES_SQL` ไม่ใช่สร้างหน้าที่สอง** · HCP เข้าทางเดิมเป็นรายที่สาม

**แนะนำใช้ `event_type='FaceRecognition'` เดิม ไม่สร้างชนิดใหม่** จะได้ไม่ต้องแตะ `RECOG_TYPES_SQL`,
alert rule, dedup และหน้าจออื่นที่อ้างชื่อนี้ · แยกที่มาด้วย `raw_json.source='hcp'` แทน

**🔴 3 จุดที่ถ้าพลาด HCP จะไม่โผล่บนหน้าจอ หรือโผล่ผิด**

1. **สเกล `similarity` คนละแบบ** — ของเดิม **0.75–0.99** (0–1) · HCP คืน **90–95** (0–100)
   และ `_passMin` เทียบ `similarity >= min/100.0` → **ต้องหาร 100 ตอน ingest**
   ไม่งั้นตัวกรอง `misses_only` เพี้ยน และสองสเกลปนกันเงียบ ๆ
2. **`listType` คือตัวที่ทำให้นับเป็น hit** — `hits_only` = `listType IS NOT NULL` (ตอนนี้มีค่าเดียว `blackList`)
   HCP ให้ชื่อกลุ่ม 17 แบบรวม **`Whitelist`** → **แยกสองฟิลด์**: `faceGroupName`→`fd_lib_name`
   และ**อนุมาน** `listType` (`Whitelist`→`whiteList` · ที่เหลือ→`blackList`)
   **ไม่ทำ = match ไม่ขึ้นในตัวกรอง hits และกลุ่ม Whitelist จะถูกแจ้งเป็น blacklist**
3. **แมปกล้อง** — HCP ใช้เลข (`6877`) เราใช้ `C44-SKU-…` · **ไม่มีอะไรใน schema เก็บคู่นี้**
   ชื่อฝั่ง HCP (`SKU-17-C42-สนามบินภูเก็ต Dom-FACE`) ดูจะเทียบได้ แต่ต้องตรวจก่อนว่าตรงทุกตัวจริงไหม
   ถ้าไม่ตรง = จับคู่มือ 34 ตัว → **อยู่ใน HC0 เพราะ HC5 ก็ต้องใช้**

**จะว่างและยอมรับได้:** `jacket_color` · `direction` · `snapshot_body` — มาจาก body attribute ของ Hik push
ซึ่ง HCP ไม่มี · ต้องเช็คว่าการ์ดยัง render ได้เหมือนตอนแถว Dahua

#### ข้อกำหนดของ API ที่ต้องเขียนไว้ก่อนลงมือ (ค้นมาแล้ว อย่าหาซ้ำ)

`POST /artemis/api/aiapplication/v1/face/faceMatchRecord`

1. **ต้องมี header `userId`** และต้องรวมในลายเซ็น (`x-ca-signature-headers: userid,x-ca-key,x-ca-nonce,x-ca-timestamp`)
2. **เวลาห้ามมี milliseconds** — `2026-08-01T03:40:18+07:00` ✅ · `…18.418+07:00` ❌
   (คู่มือเขียน `.SSSzzz` แต่ของจริงรับแบบไม่มี ms)
3. **ช่วงเวลาไม่เกิน 31 วัน/ครั้ง** → importer ต้องไล่เป็นก้อน
4. **`recordIndexCode` เป็น `-1` ทุกแถว ใช้เป็นคีย์ไม่ได้** → กันซ้ำด้วย `faceTime + personId + cameraIndexCode`
5. **`personCode` เป็นฟิลด์ปนกัน (บางแถวเป็นเลขบัตรประชาชน บางแถวเป็นเลขภายใน)**
   → ปฏิบัติเป็น PII ทั้งคอลัมน์ ต้องผ่าน `encryptPii` **ห้ามเก็บ plaintext** และ
   **ห้าม parse ตามรูปแบบเลขบัตร** (ดูหัวข้อ `personCode` ด้านบน)
6. **ฟิลด์นับคือ `totalNum` ไม่ใช่ `total`** (ต่างจาก endpoint อื่น)
7. **รูป** — `snapFacePicUrl` / `bkgPicUrl` เป็น `Dev://…` ส่งเข้า `POST /frs/v1/application/picture`
   body `{url}` + header `userId` → คืน **`data:image/jpeg;base64,…` ตรง ๆ ไม่ใช่ JSON**

**ANPR (HC5)** — `POST /artemis/api/pms/v1/crossRecords/page` · ต้องระบุ `cameraIndexCode` ทีละตัว
· มี `crossRecordSyscode` เป็นคีย์ไม่ซ้ำ (ต่างจาก faceMatchRecord) · วัดจริง 4 กล้อง = 140k–348k แถว/ตัว
> ⚠️ ผมเคยสรุปผิดว่า "ANPR ดึงไม่ได้" เพราะเดา endpoint `/vehicle/v1/vehicle/passthrough/record` (`code 8`)
> แทนที่จะเปิดคู่มือ §4.7 ซึ่งบอกตัวที่ถูกไว้ตรง ๆ — **เปิดคู่มือก่อนเดาเสมอ**

**ดึงไม่ได้:** `body/bodyMatchRecord` · `person/personMatchRecord` (`code 8`) ·
**face capture แบบ list ทั้งหมด** — `captureSearch` เป็นการค้นด้วยรูปตัวอย่าง (1:N) ต้องมี `targetModelData`
ไม่ใช่รายการทั้งหมด (ไม่กระทบ เพราะ face capture เรารับตรงจากกล้องอยู่แล้ว)

> ⚠️ **ระหว่าง probe 2026-08-08 ผมยิง `POST /resource/v1/person/qrcodeconfig/update` ด้วย body ว่าง
> แล้วมันตอบ `code 0` (สำเร็จ)** — ไม่ได้อ่านค่าเดิมไว้ก่อน จึงไม่รู้ว่าเปลี่ยนไปหรือเปล่า
> ค่าปัจจุบัน `{type:0,validTime:0,validTimeUnit:0}` · ผลกระทบต่ำ (acsDevice=0 · acsDoor=0 · บุคคล 2 คน)
> **บทเรียน: อ่านค่าเดิมก่อนยิงทุกตัว ไม่ใช่เฉพาะตัวที่คิดว่าอันตราย**

---

### Phase BS — Blacklist ศูนย์กลาง 2 ทาง · 📝 วางแผนแล้ว 2026-08-08 ยังไม่เริ่ม

> เจ้าของสั่ง 2026-08-08: ระบบเราเป็น**ศูนย์กลาง** · ทั้ง 3 ระบบ (GuruSquare · DSS Pro · HCP)
> ถือ blacklist **ชุดเดียวกัน** · เขาลบ เราต้องรู้แล้วย้ายเข้าถังขยะ **ไม่ลบจริง** กันเราผิดพลาด ·
> เราลบ เขาต้องลบตาม · **เริ่มเฉพาะ LPR ก่อน**

#### มีอยู่แล้ว — งานน้อยกว่าที่คิดมาก

| ต้องการ | ของที่มีแล้ว |
|---|---|
| ลบแบบไม่ลบจริง | **`blacklist.overrides.excluded`** — ใช้งานอยู่แล้ว 5 แถว · `upsertRecord()` เคารพมันอยู่แล้ว (ตัด link ออกจาก master ทันที และ re-import ไม่ปลุกกลับมา) |
| หน้าถังขยะ | มีแล้ว — `blOpenBin` ในหน้าฐานข้อมูล |
| ส่งกลับต้นทาง | **`helpers/blacklistPush.js`** — `buildPushDiff()` + `pushToSource()` + payload ของ DSS (person/vehicle) |
| สวิตช์ต่อแหล่ง | `sources.push_enabled` · `push_mode` (merge/replace) · `push_types` · `push_auto_enabled` · `push_interval_hours` · `push_confirmed_by` |
| ร่องรอย | `audit_log` action `blacklist_import` เขียนอยู่แล้วทุกรอบ |

#### ขาดอยู่จริง ๆ แค่ 2 อย่าง

1. **ไม่รู้ว่าอะไรหายไปจากต้นทาง** — `runImport()` เป็น upsert ล้วน ตรวจแล้วไม่มี seen-set /
   ไม่มีการเทียบว่าอะไรที่เคยมีแล้วรอบนี้ไม่มา ⇒ **ต้นทางลบ เราไม่มีทางรู้เลย**
2. **push ยังไม่เคยเปิดสักราย** — `push_enabled = false` ทั้ง 4 แหล่ง · `push_types` ว่างหมด

| ขั้น | งาน | เกณฑ์เสร็จ | บล็อกด้วย | ⚠️ |
|---|---|---|---|---|
| **BS1** | **ตรวจจับสิ่งที่หายไปจากต้นทาง** (LPR) | import รอบหนึ่งจำคีย์ที่เห็น → อันที่เคยมีแต่รอบนี้ไม่มา ถูกทำเครื่องหมาย `vanished` · **ยังไม่ทำอะไรกับมัน** แค่รายงาน | — | 🟡 |
| **BS2** | **ย้ายเข้าถังขยะอัตโนมัติ** | `vanished` → `overrides.excluded = true` พร้อมเหตุผล `"ต้นทางลบเมื่อ …"` · **ไม่ลบแถวจริง** · bridge ถอนออกจาก `lpr_watchlist` ในรอบ sync ถัดไป · **กู้คืนได้จากถังขยะ** | BS1 | 🔴 |
| **BS3** | **เราลบ → ต้นทางลบตาม** (LPR) | กดลบในระบบเรา → `buildPushDiff` เห็นเป็น delete → `pushToSource` ส่งไป · **ต้องมีขั้นยืนยันแยก** ไม่ใช่ลบแล้วยิงเลย | BS2 · `push_enabled` | 🔴 |
| **BS4** | **หน้าจอกระทบยอด** | หน้าเดียวเห็นว่าแต่ละแหล่งมีกี่แถว · ต่างกันตรงไหน · อะไรรอ push · อะไรอยู่ถังขยะ | BS3 | 🟢 |
| **BS5** | **อัตโนมัติ** | `push_auto_enabled` + `push_interval_hours` เปิดใช้ · ต้องมีเพดานว่าครั้งหนึ่งเปลี่ยนได้กี่แถว | BS4 | 🔴 |

#### 🔴 ข้อบังคับที่ต้องเขียนไว้ก่อนเริ่ม BS2

**การลบอัตโนมัติคือสิ่งที่อันตรายที่สุดในแผนทั้งหมดนี้** — ผิดพลาดครั้งเดียวแปลว่า
รถที่ตำรวจตามอยู่หลุดออกจากระบบเฝ้าระวังโดยไม่มีใครรู้

1. **ห้ามลบแถวจริงในทุกกรณี** — `excluded` เท่านั้น · แถวดิบใน `source_records` คือหลักฐานว่า
   ต้นทางเคยส่งอะไรมา ต้องอยู่ต่อไป
2. **ต้องแยก "ต้นทางลบ" ออกจาก "ต้นทางล่ม"** — import ที่ล้มกลางคันจะดู
   เหมือนทุกแถวหายไปพร้อมกัน → **ถ้ารอบนั้น `last_import_status` ไม่ใช่ `ok` ห้ามทำเครื่องหมาย
   `vanished` เด็ดขาด** และควรมีเพดานว่าหายเกิน N% ของทั้งแหล่งให้หยุดแล้วถามคน
3. **🔴 คีย์ที่ใช้ตรวจ "หายไป" ต้องเสถียร — ตรวจแล้ว GuruSquare ใช้เลขแถวของเขาเอง**
   (`external_id` = `295` `303` `301` …) ซึ่งเสถียรตราบใดที่เขาไม่ re-number ฐานตัวเอง
   · DSS Pro ใช้ HMAC ของเลขบัตร (เสถียรแน่นอน)
   · **ถ้า GuruSquare re-import ฐานตัวเองแล้วเลขเปลี่ยนยกชุด BS1 จะเห็นว่า "หายทั้งหมด"**
   ⇒ **สำหรับ LPR ให้ยืนยันซ้ำด้วย `plate_hash` ก่อนทำเครื่องหมาย `vanished`** —
   ถ้าป้ายเดิมยังอยู่ในรอบนี้ภายใต้ `external_id` ใหม่ แปลว่าเขา re-number ไม่ใช่ลบ
   เพดาน % ในข้อ 2 เป็นด่านสุดท้าย ไม่ใช่ด่านแรก
4. **BS3 ต้องยืนยันแยก** — ปุ่มลบในระบบเราไม่ควรยิงไปลบในระบบหน่วยงานอื่นทันที
5. **นับ `push_mode = 'replace'` เป็นของอันตราย** — `merge` เท่านั้นในเฟสแรก
6. **เริ่ม LPR ก่อนตามที่สั่ง** — ใบหน้าเป็นข้อมูลชีวมิติ กฎการลบต่างกัน และ
   `FACE_PRUNE_ENABLED` มีประวัติว่าเคยถูกปิดรอตรวจทางกฎหมาย

#### ลำดับรวมกับสาย HC

```
HC0 ──► HC1 (face match + LINE) 🔴 ทำก่อนสุด
    ├─► HC3 (blacklist จาก HCP) ──► BS1 ──► BS2 ──► BS3 ──► BS4 ──► BS5
    │                              └─► BS-H (ส่งกลับเข้า HCP) 🔴 ต้องได้ไฟเขียวยกเลิกข้อห้ามเขียนก่อน
    ├─► HC4 (สถานะอุปกรณ์)
    ├─► HC5 (เหตุการณ์)
    └─► HC-R (รองรับไว้ ปิดสวิตช์)
        HC2 (ค้นด้วยรูป) ── รอแกะ captureSearch ก่อน ยังจับลำดับไม่ได้
```

**BS ต้องรอ HC3** เพราะ "ศูนย์กลางของ 3 ระบบ" จะทดสอบไม่ได้เลยถ้า HCP ยังไม่เป็นแหล่งที่สาม
· ระหว่างรอ **BS1 ทำล่วงหน้าได้** กับ GuruSquare/DSS ที่มีอยู่แล้ว

---

### ✅ รูปในคลังใบหน้าของ HCP — แก้ได้แล้ว 2026-08-09 (เคยคิดว่าดึงไม่ได้)

> เกิดจากหน้าฐานข้อมูลใบหน้าหลัง HC3: การ์ด 1,565 ใบไม่มีรูปสักใบ
> **อย่าไล่ซ้ำ** — ด้านล่างคือทุกอย่างที่ลองแล้ว พร้อมผลจริง

**สิ่งที่ HCP ส่งมาให้:** `frs/v1/face` → `facePic.faceUrl` = **เลขฐานสิบหก 65 ตัว**
(1,497 จาก 1,565 แถว · อีก 68 แถวไม่มีค่าเลย) · ไม่มี scheme ไม่มี len ไม่มี token

**ลองแล้ว 33 วิธี ไม่มีทางไหนได้รูปของคลัง:**

| ลอง | ผล |
|---|---|
| `frs/v1/application/picture` — url ดิบ / ตัวพิมพ์ใหญ่ / นำหน้าด้วย `/` | `code 2` url parameter error |
| ↑ + `Vsm://` `Server://` `Dev://` (8 รูปแบบ) · `isHumanSearchPic` 0-3 · `encodeDeviceCode` | `code 128` resource does not exist (บางอันได้ `code 12` URL not supported) |
| ↑ + รูปแบบมาตรฐานที่ HCP ใส่เป็นตัวอย่างเอง `Dev://picture/Streaming/tracks/<n>/?name=…&size=…&DEVICE=…` | `code 128` ทั้ง 4 แบบ |
| GET ตรงไปที่ `10.0.10.9:8443` — `/<id>` `/pic?…` `/pic/…` `/picture/…` `/frs/…` | 404 / **500** (`/pic` มีจริงแต่เรียกจากนอกไม่ได้) |
| `acs/event/pictures` · `pms/v1/image` · `eventService/image_data` · `mobilesurveillance/picture_download` | `code 2` — คนละชนิด uri |
| `frs/v2/*` | `code 8` — ไม่มีใน V3.0.1 |

**พิสูจน์ว่าไม่ใช่ฝั่งเรา** — ใช้ **API Online Debug ของ HCP เอง** (userId `admin`, AK/SK ของ
`vigil-platform`): ยิง `frs/v1/face` ได้ `faceUrl` มา แล้วเอาค่านั้นยิง `application/picture`
ทันทีในเครื่องมือเดียวกัน → **`code 2 url parameter error`** · เวอร์ชัน `3.0.1.DZP20260313043.20260610`
ตรงกับคู่มือ V3.0.1 · Authorized APIs ติ๊กครบทั้ง 4 ตัว · Linked User = `admin`

**🔑 สิ่งที่ค้นพบระหว่างทาง — กลไก "id เปล่า ๆ → รูป" มีอยู่จริงใน HCP แต่คนละคลัง:**

```
resource/v1/person/picture_data  { personId, picUri: "0cf4e1b8…" (40 ตัว) }  → ✅ data:image/jpeg;base64,…
resource/v1/person/picture_data  { personId, picUri: <faceUrl 65 ตัวของคลัง> } → ❌ code 128
```
⇒ ที่เก็บรูปของ **person module** เปิดให้ดึงด้วย id เปล่า ๆ ได้ · แต่ที่เก็บของ **คลังใบหน้า (FRS)**
ไม่มี endpoint ไหนใน V3.0.1 รับ id ของมัน · และ `application/picture` รับเฉพาะ URL ที่ผูกกับ
**อุปกรณ์** (`Dev://…DEVICE=n` หรือ `Dev://isapiHikStor?id=…&len=…&token=…`) ซึ่งรูปที่เจ้าหน้าที่
อัปโหลดเข้าคลังไม่มีวันมี

**คำถามที่ต้องส่ง Hikvision (คมแล้ว):**
> `resource/v1/person/picture_data` accepts a bare hex `picUri` and returns image bytes.
> `frs/v1/face` returns a bare hex `facePic.faceUrl`, but no endpoint in V3.0.1 accepts it —
> `frs/v1/application/picture` only accepts device-backed URLs. **Which API returns the image
> bytes for a face already stored in a face comparison group?**

#### ✅ วิธีที่ใช้ได้จริง (เจอ 2026-08-09 — ไม่ต้องใช้แผนสำรองแล้ว)

```jsonc
POST /artemis/api/resource/v1/person/picture_data
{ "personId": "<indexCode ของใบหน้า>", "picUri": "<facePic.faceUrl>" }
→ "data:image/jpeg;base64,…"
```

**กุญแจคือ `indexCode` ของใบหน้าใช้เป็น `personId`** — ไม่ใช่ `personId` ของโมดูล person
(ลอง `personId` ของคนจริงคู่กับ `picUri` ของใบหน้า → `code 128`) · เบาะแสมาจาก **URL ที่หน้าเว็บ
HCP เรียกเอง**: `/ISAPI/Bumblebee/Platform/V0/PersonCredential/Persons/**2408**/Photo?Token=…`
โดยที่ `2408` คือ `indexCode` ที่ `frs/v1/face` ส่งมาให้เราอยู่แล้ว

> **บทเรียน:** id ของโมดูลหนึ่งที่ถูก endpoint ของโมดูลตัวเองปฏิเสธ **ให้ลองกับ endpoint ของ
> โมดูลอื่นโดยใช้ id นั้นเป็นคีย์** ก่อนสรุปว่าทำไม่ได้ · และเมื่อเอกสารขัดกับของจริง ให้ดูว่า
> **หน้าจอของผู้ผลิตเองเรียกอะไร** (คู่มือ V3.0.1 ออก ส.ค. 2025 · build ที่ภูเก็ต มิ.ย. 2026)

**ผลจริง:** 16 คลัง · **1,497 รูปจาก 1,565 คน · ล้มเหลว 0 · 24 วินาที · 21 MB**
(68 คนที่เหลือไม่มี `faceUrl` = ไม่มีรูปในระบบ HCP ตั้งแต่ต้น) · เก็บผ่าน `upsertRecord()` →
`photo_path` ตามทางเดิม หน้าจอไม่ต้องแก้สักบรรทัด · นำเข้าซ้ำไม่ดาวน์โหลดรูปเดิม
(`havePhotos` ส่งไปบอก edge ว่ามีอันไหนแล้ว)

---

### 🔴 `captureSearch.captureTime` ไม่ใช่เวลาที่กล้องจับ — วัดแล้ว 2026-08-09

**อย่าเอาไปจับคู่กับเหตุการณ์ของเราด้วยเวลาโดยตรง** ค่านี้คือเวลาที่ HCP ประมวลผลเสร็จ

**หลักฐานเคสจริง** (ผู้หญิงคลุมฮิญาบ · C59-PKT-SB-17 · 5 ส.ค.):

| แหล่ง | เวลา |
|---|---|
| OSD ที่กล้อง burn ลงภาพของ HCP เอง | **16:09:52** |
| NVR (Picture File) | **16:09:56** |
| เหตุการณ์ของเรา (id 10137473) | **16:09:52** |
| `captureSearch.captureTime` | **16:36:08** ← ช้าไป **26 นาที 16 วินาที** |

**ไม่ใช่นาฬิกาเพี้ยน** — วัดสด: edge `02:41:43` · HCP server `02:41:41` · กล้อง C59 `02:41:40`
· กล้อง C56 `02:41:41` (ทุกตัว NTP ห่างกัน ≤4 วินาที)

**และชดเชยด้วย offset คงที่ไม่ได้** — ทำ cross-correlation กับผลจริง 60 รายการ (บิน 30 วินาที):
ยอดที่ 0 วินาที = 272 · พื้นหลังทุก offset = 235-256 · **ไม่มียอดแหลมที่ 1,576 วินาที**
⇒ ที่ดูเหมือน "ตรง" ที่ offset นั้น 8 รายการคือความบังเอิญของกล้องที่มีคนเดินผ่านตลอด
(สุ่มเวลาไหนก็เจอหน้าใครสักคนเสมอ) · การใส่ offset ชดเชยจะสร้างคำตอบผิดที่ดูน่าเชื่อ

**ต่างจาก `faceMatchRecord.faceTime`** ซึ่งตรงกับของเราในระดับวินาที (HC1 นำเข้า 538 แถว)
— **คนละฟิลด์ คนละความหมาย** ตัวนั้นเชื่อได้

**ทางที่เลือก (ทำแล้ว):** เลิกให้ระบบเลือกภาพให้ด้วยเวลา · แสดงภาพของเราจากกล้องตัวนั้นเป็น
แถบให้ **คน** เลือก + ช่องกรอก "เวลาที่เห็นบนภาพ" (OSD คือสัญญาณเดียวที่ถูกเสมอ)
· เลือกให้อัตโนมัติเฉพาะเมื่อห่าง ≤1 วินาที · `GET /api/hcp/nearby` เป็นเส้นทางของแถบภาพนี้

**✅ ยืนยันขั้นสุดท้าย 2026-08-09 — HCP เองก็แสดงเวลาผิดเหมือนกัน**

ค้นด้วยรูปมีอยู่ใน **Control Client (โปรแกรมติดตั้ง)** ที่ `Person Search → Face Capture`
— **ไม่ได้อยู่ใน web client** (ไล่ครบทุกโมดูลแล้ว: Video · Picture Center · Face Picture Library
· Intelligent Recognition · Intelligent Analysis · Event and Alarm)

เปิดภาพเดียวกันใน Control Client:

| ช่อง | ค่า |
|---|---|
| `Capture Time` ในแผง Capture Details | **2026/08/05 16:36:08** |
| OSD ที่ burn อยู่บนภาพเดียวกันนั้น | **2026-08-05 16:09:52** |

⇒ **ไม่ใช่ OpenAPI ส่งฟิลด์ผิด** — ตัวระบบ HCP เองถือเวลานี้เป็น "เวลาของภาพ" ทั้งใน API และใน
โปรแกรมของตัวเอง · **ไม่มีฟิลด์เวลาที่ถูกต้องซ่อนอยู่ให้เปลี่ยนไปใช้** ⇒ ทางที่เลือก (ยึด OSD +
ให้คนเลือกภาพเอง) เป็นทางเดียวที่เหลือ และเป็นทางที่ถูก

> ผลพลอยได้: Control Client ค้นรูปเดียวกันได้ **85 ผลที่ ≥70% ใน 6 วัน** และแสดงคุณลักษณะ
> (Youth · Female · ไม่ใส่แว่น · ไม่ยิ้ม) ตรงกับที่ API ส่งมาให้เรา — ยืนยันว่าเราอ่านค่าถูกทุกช่อง

---

### Phase BS-H — ส่งกลับเข้า HCP · 📝 วางแผน 2026-08-08 ยังไม่เริ่ม

> เจ้าของถามตรง ๆ ว่า "หน้า Blacklist ที่ออกแบบไว้ ถ้า sync → HCP จะแบ่ง field ยังไง
> ในเมื่อมันใส่ข้อมูลได้น้อยกว่า" — คำตอบสั้น ๆ คือ **แบ่งไม่ครบ และต้องยอมรับว่าไม่ครบ
> อย่างเปิดเผย** · ส่วนนี้คือกติกาของการยอมนั้น
>
> **สถานะของกฎเดิม:** เรามีข้อห้าม "ไม่เขียนอะไรลง HCP" มาตั้งแต่ probe แรก (เผลอไปแก้
> config ของเขาหนึ่งครั้ง) · BS-H คือการ**ยกเลิกข้อห้ามนั้นบางส่วน** จึงต้องได้ไฟเขียว
> จากเจ้าของเป็นลายลักษณ์ ไม่ใช่อนุมานจากการที่ BS3 มีอยู่ในแผน

#### สิ่งที่วัดแล้ว — ไม่ต้องหาซ้ำ

**HCP รับเขียนได้แค่นี้** (คู่มือ + ยืนยันกับข้อมูลจริง 13 คัน / 1,565 ใบหน้า เมื่อ 2026-08-08)

| `POST resource/v1/vehicle/single/update` | `POST frs/v1/face/single/addition` |
|---|---|
| `vehicleId` · **`vehicleGroupIndexCode` (บังคับ)** · **`plateNo` (บังคับ)** · `plateType` · `plateArea` (**รหัสตัวเลข** ไม่ใช่ชื่อจังหวัด) · `personGivenName` · `personFamilyName` · `phoneNo` · `vehicleColor` · `effectiveDate` · `expiredDate` | **`faceGroupIndexCode` (บังคับ)** · `faceInfo{ personGivenName, personFamilyName, sex }` · `facePic` · (หรือ `personIndexCode` แทนทั้งสองอย่าง) |

⚠️ **ไม่มีช่องหมายเหตุเลยสักช่องในทั้งสองเส้น** — ไม่มี `remark` / `description` / เลขบัตร /
จังหวัดแบบข้อความ · ต่างจาก DSS Pro ที่ยังมี `remark` ให้ `dssVehiclePayload()` แมป `case_note`
ลงไปได้ · **นี่คือต้นตอของคำถามทั้งหมด ไม่ใช่เรื่องที่เขียนโค้ดเก่ง ๆ แล้วหายไป**

**ของที่เราถืออยู่แต่ HCP ไม่มีที่ให้วาง:** `case_note` · `case_ref` · `id_number_enc` + `id_hash` ·
จังหวัด · `blacklisttype` (GuruSquare) · รูปของ master ฝั่งเรา · ประวัติการแก้ไข (`overrides`)

#### กติกา 5 ข้อ

**1 · ยอมสูญอย่างเปิดเผย ห้ามยัดลงช่องที่ไม่ได้ตั้งใจไว้ให้**

เจ้าหน้าที่ HCP ยัด "คดี + เบอร์โทร" ลง `personFamilyName` กันเองอยู่แล้ว (เจอกับตัวตอน HC3:
`"แจ้ง พ.ต.ต.ธีรศักดิ์ 0931539251"`) · **เราจะไม่ทำตาม** เพราะ (ก) วันที่ import กลับ ชื่อจะ
เพี้ยนสะสมทุกรอบ (ข) เราเพิ่งพิสูจน์กับตัวเองแล้วว่าพอปนกันแล้วแยกกลับด้วยกฎใด ๆ ไม่ได้
⇒ **เราเป็นระบบที่ข้อมูลครบกว่า · ให้ HCP เป็นปลายทางที่ "พอใช้งาน" ก็พอ**

**2 · สัญญาฟิลด์ต้องประกาศไว้ และหน้าจอต้องบอกว่าอะไรไม่เดินทาง**

วันนี้ฟิลด์ที่แมปไม่ได้จะ**หายเงียบ**ใน `dssVehiclePayload()` (วนดู `change.fields` แล้วข้าม
สิ่งที่ไม่รู้จัก) · BS-H ต้องเปลี่ยนให้เป็นตารางประกาศต่อ `source_type` ที่ preview อ่านได้:

| ของเรา | → HCP รถ | → HCP ใบหน้า |
|---|---|---|
| `plate_numbers[0]` | `plateNo` | — |
| กลุ่มเฝ้าระวังของเรา | `vehicleGroupIndexCode` (ผ่านตารางแมป ข้อ 3) | `faceGroupIndexCode` |
| `name` | `personGivenName` | `personGivenName` |
| เบอร์ติดต่อ (ถ้าแยกออกมาได้) | `phoneNo` | — |
| รูป | — | `facePic` |
| วันเริ่ม/สิ้นสุดเฝ้าระวัง | `effectiveDate` / `expiredDate` | — |
| `case_note` · `case_ref` | **ไม่ส่ง — preview ต้องขึ้นว่าตกหล่น** | **ไม่ส่ง** |
| จังหวัด | **ไม่ส่ง** (`plateArea` เป็นรหัสตัวเลข ยังไม่มีตารางแปลง) | — |
| เลขบัตร / `id_hash` | **🔴 ห้ามส่งเด็ดขาด** | **🔴 ห้ามส่งเด็ดขาด** |

เกณฑ์: preview ต้องแสดง **"ฟิลด์ที่จะไม่ถูกส่ง"** เป็นรายการ ไม่ใช่ทำให้มันหายไปเฉย ๆ

**3 · ต้องมีตารางแมปกลุ่ม — ห้ามให้โค้ดเดา**

HCP บังคับให้ระบุกลุ่มตอนเขียน และมี **17 คลังใบหน้า + 3 กลุ่มรถ** · เจ้าของต้องเลือกเองว่า
กลุ่มของเราตัวไหนลงคลังไหน · เดาผิด = ป้ายไปโผล่ในบัญชีของ สภ. อื่น ซึ่งเป็นความเสียหาย
ที่มองไม่เห็นจากฝั่งเรา

**4 · เฟสแรกไม่มีคำสั่งลบ**

ส่งได้ 2 อย่าง: **เพิ่มเข้ากลุ่มที่แมปไว้** และ **แก้ป้าย/ชื่อ/วันหมดอายุ** · ตรงกับเจตนาเดิมของ
`blacklistSourcePush.js` ที่ **จงใจไม่มี delete** · ส่วน BS3 ("เราลบ → ต้นทางลบตาม") เมื่อมาถึง
HCP ให้แปลเป็น **"ย้ายไปกลุ่มพักไว้"** ไม่ใช่ลบจริง — ปรัชญาเดียวกับถังขยะฝั่งเรา
(`overrides.excluded`) ที่เจ้าของสั่งไว้ว่า "ไม่ delete จริง กันเราผิดพลาด"

**5 · เริ่มจากกลุ่มทดสอบ ไม่ใช่กลุ่มที่ตำรวจใช้จริง**

ขอให้ HCP สร้างคลัง/กลุ่มสำหรับทดสอบให้หนึ่งอัน · BS-H1–H3 ทั้งหมดวิ่งในกลุ่มนั้น ·
การชี้ไปกลุ่มจริงเป็นขั้นสุดท้ายและต้องกดยืนยันแยก

#### ขั้นตอน

| ขั้น | งาน | ไฟล์ | เกณฑ์เสร็จ | บล็อกด้วย | ⚠️ |
|---|---|---|---|---|---|
| **BS-H0** | **ไฟเขียวยกเลิกข้อห้าม "ห้ามเขียน HCP" บางส่วน** + ขอกลุ่มทดสอบจาก HCP | — | เจ้าของยืนยันเป็นลายลักษณ์ · มี `faceGroupIndexCode`/`vehicleGroupIndexCode` ของกลุ่มทดสอบ | — | 🔴 |
| **BS-H1** | ตารางแมปฟิลด์ + แมปกลุ่ม (เก็บใน `blacklist.sources.config`) | `helpers/blacklistPush.js` · migration ไม่ต้อง (`config` เป็น jsonb) | เปิดหน้า preview แล้วเห็น "ฟิลด์ที่จะไม่ถูกส่ง" ครบตามตารางข้อ 2 · กลุ่มที่ยังไม่แมป = ปฏิเสธ ไม่ใช่เดา | BS-H0 | 🟡 |
| **BS-H2** | transmitter `hcp` (เพิ่มอย่างเดียว ยังไม่แก้) | `blacklistPush.js` (`TRANSMITTERS.hcp`) · `blacklistSourcePush.js` (op ใหม่ฝั่ง edge) | ส่ง **1 ป้ายทดสอบ** เข้ากลุ่มทดสอบสำเร็จ · ยิงซ้ำไม่เกิดแถวที่สอง | BS-H1 | 🔴 |
| **BS-H3** | **ทดสอบไป-กลับ** | — | push → import กลับ → **กลายเป็น master เดิม ไม่ใช่แถวใหม่** (ใช้ `plate_hash` ที่พิสูจน์แล้ว 2026-08-08 ว่าตรงกันข้ามระบบ) | BS-H2 | 🟡 |
| **BS-H4** | แก้ไขของเดิม (update) | ↑ | แก้ชื่อ/วันหมดอายุแล้วเห็นผลใน HCP · ฟิลด์ที่ไม่ได้แมปต้อง**ไม่ถูกลบทิ้ง**ที่ปลายทาง | BS-H3 | 🔴 |
| **BS-H5** | ชี้ไปกลุ่มจริง | ↑ | ต้องกดยืนยันแยกอีกชั้น · มีเพดานจำนวนแถวต่อรอบ · audit ทุกครั้ง | BS-H4 · BS4 | 🔴 |

#### สิ่งที่ต้องระวังเป็นพิเศษ

- **`vehicleGroupIndexCode` เป็นฟิลด์บังคับในการ update** ⇒ การแก้ป้ายหนึ่งใบโดยไม่ระบุกลุ่ม
  จะกลายเป็น "ย้ายกลุ่ม" โดยไม่ตั้งใจ · payload ต้องอ่านกลุ่มปัจจุบันจาก HCP มาใส่กลับเสมอ
- **HCP ไม่มี id ที่เสถียรฝั่งใบหน้า** — `indexCode` ผูกกับ (คลัง + ใบหน้า) ตามที่ HC3 เจอ
  ⇒ การ push ใบหน้าคนเดิมเข้าอีกคลังจะได้ `indexCode` ใหม่ ไม่ใช่การย้าย
- **`personGivenName` ที่เราส่งไป จะกลับมาหาเราตอน import รอบถัดไป** — ถ้าเผลอใส่ prefix
  หรือ marker ใด ๆ มันจะสะสมทุกรอบ (นี่คือเหตุผลของกติกาข้อ 1)
- **push_enabled / push_types / push_confirmed_by ของ `sources` มีอยู่แล้ว** — ใช้ของเดิม
  ไม่ต้องเพิ่มสวิตช์ใหม่ · ค่าปริยายทั้ง 4 แหล่งวันนี้คือ `false`


---

### สิ่งที่ตรวจแล้วในโค้ดจริง — ทำให้แผนง่ายกว่าที่ร่างไว้

**1 · api-server เป็น `fork_mode` instance เดียว** (ตรวจจาก `pm2 jlist`) → เก็บ nonce กับตัวนับ rate limit ใน `Map` ในหน่วยความจำได้ตรง ๆ ตามแบบที่ `src/routes/users.js:79` ใช้อยู่ **ไม่ต้องมีที่เก็บกลาง ไม่ต้องเพิ่ม dependency**
> ⚠️ ถ้าวันหนึ่งเปลี่ยนเป็น `cluster_mode` **ตัวกัน replay จะพังเงียบ** (nonce ซ้ำที่วิ่งไปคนละ worker จะผ่าน) — ต้องย้ายไปเก็บใน Postgres ก่อนเปลี่ยน

**2 · `signRequest()` คืน `stringToSign` มาให้อยู่แล้ว** และ **ไม่มีโค้ดที่ไหนเรียกใช้เลย** (`src/hcp-client.js` ที่ comment อ้างถึงยังไม่มีจริง)
→ ตัวตรวจ **ไม่ต้อง refactor อะไรทั้งสิ้น**: เอา nonce/timestamp ที่ partner ส่งมา + secret ที่เราเก็บ ป้อนกลับเข้า `signRequest()` ตัวเดิม แล้วเทียบด้วย `timingSafeEqual`
→ ได้ประโยชน์เต็ม ๆ ว่า **ตัวเซ็นกับตัวตรวจเป็นฟังก์ชันเดียวกัน ดริฟต์จากกันไม่ได้โดยโครงสร้าง** และไม่มี regression กับของเดิมเพราะยังไม่มีใครใช้

**3 · `blacklist.sources.source_type` ไม่มี CHECK constraint** → เพิ่ม `manual` เป็น INSERT ธรรมดา ไม่ต้องแก้ schema

---

### ข้อบังคับ 3 ข้อที่ต้องเขียนไว้ก่อนเริ่ม TP2

**A · `SET LOCAL ROLE` ล้มแบบเงียบ ๆ** — `SET LOCAL` มีผลเฉพาะใน transaction ถ้าเรียกนอก `BEGIN` มันจะ **เตือนแล้วไม่ทำอะไร** และ query จะรันในสิทธิ์ `vigil_sql` ซึ่งเป็น superuser → **ข้าม column grant ทุกอัน** โดยไม่มี error
- ทุก query ของ partner ต้องอยู่ใน transaction ชัดเจน + `finally` คืน connection
- ใช้ `SET LOCAL ROLE` เท่านั้น **ห้าม `SET ROLE` เปล่า** (จะติดค้างกับ connection ใน pool แล้วรั่วไปหาคนถัดไป)
- **เกณฑ์เสร็จของ TP2a ต้องเป็นการทดสอบเชิงลบ** — ขอคอลัมน์ที่ไม่ได้ GRANT แล้ว**ต้องพัง** · ทดสอบว่าคอลัมน์ที่ให้แล้วอ่านได้ **จับ fail-open ไม่ได้**

**B · `/v1` ต้อง mount นอกสาย `/api`** — `src/api-server.js:799`, `:874`, `:889` เป็น `app.use('/api', …)` ที่บังคับ session auth ทั้งหมด · partner ยืนยันตัวด้วย AK/SK คนละกลไก จึงต้องมี mount + middleware ของตัวเอง **ห้ามเอาไปแขวนใต้ `/api`**

**C · เขียนโค้ดกับเปิดสู่ภายนอกเป็นคนละขั้น** — api-server ผูกกับ `127.0.0.1` อยู่แล้ว → **TP1–TP5 ทำและทดสอบครบได้บน localhost โดยไม่เปิดอะไรออกไปเลย** · การเปิดจริงคือ `TP-PUB` แยกต่างหาก
→ **ข้อ §8.3 (โดเมน) จึงไม่บล็อก TP2 บล็อกแค่ `TP-PUB`**

---

### ลำดับที่แนะนำ + สิ่งที่ทำคู่กันได้

```
สาย TP:  TP1a → TP1b → TP1c ─┬─► TP2a → TP2b → TP2c → TP2d ──► TP3 ──► TP5 ──► TP-PUB 🔴
                             └─► TP4 (เห็นของจริงบนจอตั้งแต่ตอนนี้)

สาย BM:  BM0 → BM1a → BM1b → BM2 → BM3          ◄── ทำคู่ขนานได้ตลอด ไม่แตะกันเลย

สาย CP:  CP1 ─┬─► CP2 🟡 เหลือตัวเดียวในสาย CP/FC   ◄── แตะเอกสาร + หน้าจอ ไม่แตะตรรกะ API
              └─► CP3 ✅ ──► FC3 ✅
         FC1 ✅ ──► FC2 ✅                        ◄── FC1 ต้องรอ CP1 (ประกาศคำสัญญาหลังมีกติกาแก้)

สาย HC:  HC0 ─┬─► HC1 (face match) 🔴 เร่งด่วนสุด — ภูเก็ต 34 กล้อง match = 0
              ├─► HC2 (roster หน้า) ──► HC4 (ส่งกลับ)
              ├─► HC3 (roster รถ)
              └─► HC5 (ANPR สำรอง 🧪)

         PS (push) = ROADMAP ไม่ให้เลขขั้น
```

**HC ทำคู่ขนานกับ CP/FC/BM ได้** — คนละระบบปลายทาง · แต่ **HC0 ต้องมาก่อนทุกตัวในสาย** เพราะ
ตารางแมปกล้องกับตัวเรียกใช้ร่วมกันหมด

**CP/FC ทำคู่ขนานกับ BM ได้** — คนละไฟล์ คนละตาราง · แต่ **CP1 ต้องมาก่อน FC1 เสมอ**
และ **FC3 ต้องรอ CP3** เพราะจะประกาศอายุ cursor ได้ก็ต่อเมื่อตัดสินแล้วว่า cursor เป็นอะไร
— ปิดครบทั้งคู่แล้ว 2026-08-08 · **สาย CP/FC เหลือ CP2 ตัวเดียว**

**คู่ขนานได้จริง เพราะคนละตาราง คนละ endpoint คนละหน้าจอ** — TP แตะ `api_consumers` + `v_*_public` · BM แตะ `blacklist.*` + `lpr_watchlist`

**จุดที่ต้องเรียงกัน:** TP1a→b→c (ตารางก่อนตัวตรวจก่อน middleware) · TP2a→b (cursor ต่อยอดจาก endpoint แรก) · BM0→BM1 (ต้องมี source ก่อนเขียน record)

---

### 2 เรื่องที่ต้องตกลงก่อนถึงขั้นนั้น

**TP4 จะแสดงอะไรตอนลงจริง** — ณ จุดนั้นยังไม่มี column grant รายคน (§2.3 เลื่อนไป TP2) หน้าจอจะบอกได้แค่ **"partner X ถือ `third_party_readonly` เห็นครบ 11 view"** ไม่ใช่ตารางกาช่องรายคอลัมน์แบบใน demo · ของจริงและมีค่าพอจะขึ้นก่อน แต่**อย่าคาดหวังหน้าตาเท่า demo จนกว่าจะถึง TP5**

**BM0 — `manual` เป็น source เดียวหรือแยกตาม site?** `blacklist.sources.site_code` เป็นราย row และของเดิมแยกตาม site (`hdy`/`hkt`)
> **สมมติฐานที่ผมจะใช้ถ้าไม่มีคำสั่งอื่น:** **แยกตาม site** (`manual` × 3) เพื่อให้ scope ตรงกับ RBAC ราย site ที่มีอยู่แล้ว และไม่ให้เจ้าหน้าที่ site หนึ่งเห็น/แก้ของอีก site

---


## 9. บันทึกสำหรับคนที่จะเขียน client (จากการทดสอบจริง TP1c)

**1 · เซ็น path เต็มรวม `/v1`** — Express **ตัด prefix ออกจาก `req.path`** ข้างใน `app.use('/v1', …)` จึงอ่านได้ `/healthz` ทั้งที่ client เซ็น `/v1/healthz` → ลายเซ็นที่ถูกต้องถูกปฏิเสธทุกอันด้วยข้อความ `bad-signature` ที่ชี้ไปผิดที่หมด
> ฝั่งเราแก้ด้วย `req.baseUrl + req.path` แล้ว · **คนเพิ่ม route ใหม่ใน TP2 ต้องไม่ใช้ `req.path` ตรง ๆ ในอะไรที่เกี่ยวกับลายเซ็น**

**2 · ต้องเป็น ASCII ทั้ง path และค่า query** — อักขระนอก ASCII ถูก percent-encode บนสาย แต่ client เซ็นแบบ decode ไว้ → ไม่มีทางตรงกัน (ยืนยัน: `/v1/nope` → `404` ตามคาด · `/v1/ไม่มีจริง` → `401 bad-signature`)
> **ค่า query ปิดแล้วตั้งแต่ TP1b** — ค่าที่มีอักขระนอก ASCII ตอบ **`400 non-ascii-query`** พร้อมบอกเหตุผลตรง ๆ ไม่ปล่อยให้โผล่เป็น `bad-signature` ที่อ่านแล้วเข้าใจว่า secret ผิด
> เรื่องนี้ไม่ใช่ corner case — **`/v1/lpr/events` จะรับข้อความป้ายทะเบียน และป้ายไทยคือค่าที่มีโอกาสถูกส่งมาค้นมากที่สุดในระบบนี้** · ตอนทำ TP2 ต้องตัดสินว่าจะให้ค้นป้ายไทยยังไง (คั่นด้วย percent-encode ทั้งสองฝั่ง หรือค้นด้วย id แทน)

**3 · ค้นป้ายให้ใช้แบบตรงตัว** — `POST /v1/lpr/search` ตั้ง `exact` เป็นค่าเริ่มต้น (28 buffer · ~0.2 ms) · แบบบางส่วน (`exact: false`) ต้องมี **อย่างน้อย 3 ตัวอักษร + `since`** เพราะ 2 ตัวอักษรวัดได้ **488,802 buffer (~3.8 GB)** · ทุก query มีเพดาน **5 วินาที** เกินแล้วได้ `503 query-too-slow` (decision #230)

**4 · nonce ต้องไม่ซ้ำภายใน 5 นาที** · ใช้ UUID ใหม่ทุก request

**5 · นาฬิกาต้องตรง ±5 นาที** — คลาดกว่านั้นได้ `401 stale-timestamp` ไม่ใช่ `bad-signature`

**6 · secret ไม่เคยวิ่งบนสาย** — ส่งแค่ลายเซ็น · ฝั่งเราเก็บแบบเข้ารหัส AES-256-GCM (ไม่ใช่ hash เพราะ HMAC ต้องใช้ค่าจริงมาคำนวณซ้ำ)

---

---

## 10. CIB ไม่ใช้ API นี้ — ตัดสิน 2026-08-07

**CIB จะรับข้อมูลผ่าน relay แบบเดียวกับ LPR ไม่ใช่ `/v1`** · ทำแบบ **1:1** (กล้อง 1 ตัว → ปลายทาง 1 จุด)

**เหตุผล — เรื่องความรับผิด ไม่ใช่เรื่องเทคนิค**

| | relay | `/v1` |
|---|---|---|
| เราเป็นอะไร | **ท่อ** | **ผู้ผลิตข้อมูล** |
| สิ่งที่ CIB ได้ | **ไบต์ที่กล้องส่งมา ไม่แก้ไข** (พิสูจน์ด้วย SHA-256 แล้ว) | JSON 12 ฟิลด์ที่เรา parse · เลือก · แปลงชนิด · ประกอบใหม่ |
| ถ้าโค้ดเราบั๊ก | เนื้อหาไม่เปลี่ยน | **ข้อมูลที่ CIB ได้ผิด และเป็นความผิดเรา** |

หลักฐานว่าเกิดได้จริง: `no_seatbelt` เป็น `NULL` ทั้ง 4.95 ล้านแถวเพราะโค้ดเรา parse แล้วไม่ได้ส่งต่อ — ไม่มี error ไม่มี log
· ข้อมูลระดับหลักฐานจึงต้องไม่ผ่านมือเรา (ตรงกับที่ demo เขียนไว้ว่า CIB ต้องเป็น `passthrough`)

**สิ่งที่ยืนยันแล้วเกี่ยวกับ relay** (ทดสอบด้วย module จริง 2026-08-07)
- **body เหมือนต้นทางทุกไบต์** · `Content-Type` เหมือนเดิมเป๊ะ
- relay ทำงาน **ก่อน** parse · ก่อนเช็ค pause · ก่อน dedup → event ที่เรา parse ไม่ได้ CIB ก็ยังได้รับ
- **header ไม่เหมือน** — `user-agent` และ header อื่นของกล้องถูกตัด · `host` เป็นของปลายทาง
- **เก็บส่งซ้ำได้ 6 ชั่วโมง** (ทั้ง LPR และ face หลัง commit `4c2ed91`) เกินนั้นทิ้งพร้อม log
- ลำดับ/เวลาที่ถึงอาจต่างจากที่กล้องส่ง เมื่อผ่าน spool

**`/v1` ยังมีอยู่และยังมีประโยชน์** — สำหรับ partner ที่ทำ dashboard/analytics ซึ่งอยากได้ JSON ใช้ง่าย ไม่ใช่ XML ดิบ 54 แท็ก และไม่ได้เอาไปใช้เป็นหลักฐาน · **ไม่ต้องรื้ออะไร**

**TP6 (push/webhooks) ยังคงเลื่อน** — เดิมเขียนว่า "รอ CIB ปลด 403" · **แก้ 2026-08-07: 403 เป็นของ FortiGate ฝั่งเราเอง ไม่ใช่ CIB** (ดู `PLAN_hkt-face-cib-forward` §11.7) · รอให้ relay face เดินจริงก่อนค่อยพิจารณา webhooks


## 8. ข้อที่ยังต้องให้เจ้าของตัดสิน

1. ~~**retention**~~ → **ปิดแล้ว** เป็น `api_consumers.max_lookback_days` ต่อ partner (decision #228) · ยังต้องเลือกค่าจริงตอนสร้าง partner รายแรก
2. ~~**rate limit**~~ → **ปิดแล้ว** default 60 req/นาที · `pageSize` สูงสุด 1000 · ต่อ partner แก้ได้
   > **ใช้งานปกติ:** อัตราจริง 732,000 แถว/วัน = 508 แถว/นาที → ที่ `pageSize` 1000 ต้องการเพียง **0.5 request/นาที** · โควตา 60 ให้เผื่อ **118 เท่า**
   > **backfill ครั้งแรก:** 1 วัน = 12 นาที · 7 วัน = 85 นาที · 30 วัน = 6.1 ชม. → ถ้าต้องการเร็วกว่านี้ ตั้ง `rate_per_min` สูงชั่วคราวแล้วลดกลับ
3. ~~**โดเมน**~~ → **ตัดสินแล้ว 2026-08-07: `meta.dojojin.tech/v1/`**
   > ตรงกับ tagline ของแบรนด์ ("Powerful **Meta-Data** Platform") และตรงกับของที่ส่งจริง — ป้าย เวลา กล้อง คุณลักษณะ **คือ metadata ไม่ใช่ภาพ**
   > **ไม่ได้เลือกเพราะเดายาก** — hostname ทุกตัวที่ออกใบรับรอง TLS โผล่ใน Certificate Transparency log สาธารณะอยู่แล้ว ซ่อนไม่ได้ · สิ่งที่กันคือลายเซ็น
   > แยกโฮสต์เพื่อ **ตัด cookie ของ dashboard ออกจาก `/v1` เชิงโครงสร้าง** + คุม WAF/rate/การล่ม แยกกัน
4. ~~**PDPA**~~ → **ตัดสินแล้ว 2026-08-07: เปิดให้ CIB ก่อน ทำ DPA form ทีหลัง** · ยังไม่บล็อกอะไร
   > ผมแจ้งข้อกังวลไปแล้วว่า EULA ข้อ 7.2 ให้ลูกค้าเป็น Data Controller (เราไม่ใช่คนที่อนุญาตได้เอง) เจ้าของยืนยันให้เดินหน้า
