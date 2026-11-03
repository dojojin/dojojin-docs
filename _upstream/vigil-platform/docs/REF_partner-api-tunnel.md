<!-- ============================================================ -->
<!-- Vigil Platform — เปิด Partner API สู่ภายนอก (TP-PUB)        -->
<!-- @author Prakasit Rochanavipart (Dojo-mAn)                   -->
<!-- @copyright (c) 2025-2026 All Rights Reserved.               -->
<!-- @license Proprietary                                         -->
<!-- ============================================================ -->

# เปิด Partner API สู่ภายนอก — `meta.dojojin.tech`

> สร้าง 2026-08-07 · ฝั่งเซิร์ฟเวอร์พร้อมแล้ว **เหลือขั้นตอนใน Cloudflare ที่ต้องทำด้วยมือ**
> เหตุผลของชื่อโดเมน + สถาปัตยกรรม → [`SPEC_partner-api_2026-08-07.md`](SPEC_partner-api_2026-08-07.md)

---

## 0. ทำไมต้องทำด้วยมือ

tunnel ของเครื่องนี้เป็นแบบ **remotely-managed** — รันด้วย
`cloudflared tunnel run --token-file /etc/cloudflared/token` ซึ่งแปลว่า
**route ทั้งหมดเก็บอยู่ที่ Cloudflare ไม่ใช่ไฟล์บนเครื่อง**

- ไม่มี `~/.cloudflared/cert.pem` → สั่ง `cloudflared tunnel route dns` ไม่ได้
- ไม่มี Cloudflare API token ใน `.env`
- `/etc/cloudflared/` ต้อง sudo

→ **การเพิ่ม hostname ต้องทำใน Cloudflare dashboard เท่านั้น**

---

## 1. สิ่งที่ทำเสร็จแล้วฝั่งเรา

| | สถานะ |
|---|---|
| `PARTNER_HOST=meta.dojojin.tech` ใน `src/.env` | ✅ |
| `PUBLIC_ORIGIN=https://meta.dojojin.tech` | ✅ — OpenAPI ที่ generate ชี้โดเมนนี้ |
| middleware จำกัดโฮสต์นี้ให้เสิร์ฟเฉพาะ `/v1/*` | ✅ ทดสอบ bypass 19 แบบ ปฏิเสธหมด |
| dashboard ไม่ถูกกระทบ | ✅ |

**สำคัญ — โฮสต์ที่สองไม่ได้แยกอะไรโดยตัวมันเอง** ถ้าไม่มี middleware ตัวนี้
`meta.dojojin.tech/login.html` จะเสิร์ฟหน้า login ของ dashboard และ cookie
จะผูกกับโฮสต์ partner (GOTCHAS #147) — ตอนนี้ปิดแล้ว

---

## 2. ขั้นตอนใน Cloudflare (คุณทำ)

### 2.1 เพิ่ม Public Hostname

**Zero Trust → Networks → Tunnels → เลือก tunnel ของ vigilcentral → Public Hostname → Add**

| ช่อง | ค่า |
|---|---|
| Subdomain | `meta` |
| Domain | `dojojin.tech` |
| Path | *(เว้นว่าง)* |
| Type | `HTTP` |
| URL | `localhost:3000` |

> **Path เว้นว่าง** ไม่ใช่ `/v1` — เพราะ Cloudflare จะตัด prefix ออกก่อนส่งมา
> ทำให้ `req.path` กลายเป็น `/healthz` แทน `/v1/healthz` แล้ว**ลายเซ็นจะไม่ตรงทุกอัน**
> (เป็นบั๊กแบบเดียวกับที่เจอตอน TP1c) · การจำกัดให้เหลือแค่ `/v1` ทำที่ฝั่งเราแล้ว

### 2.2 ตรวจว่าไม่มี route อื่นหลุดตาม

ในหน้า Public Hostname เดิม **ต้องมี `meta.dojojin.tech` แถวเดียว**
ถ้ามี wildcard (`*.dojojin.tech`) อยู่ก่อนแล้ว ให้ตรวจว่า `meta` อยู่**เหนือ**กว่า
ไม่งั้น wildcard จะกินไปก่อน

### 2.3 (แนะนำ) ตั้ง WAF / rate limit แยก

โฮสต์นี้แยกจาก dashboard แล้ว จึงตั้งกฎเฉพาะได้:
- rate limit ระดับ Cloudflare (ชั้นที่สองนอกเหนือจาก 60/นาที ของเรา)
- ปิด country ที่ไม่ควรมี partner อยู่
- **ห้ามเปิด Cloudflare Access (Zero Trust login)** บนโฮสต์นี้ — partner เป็น
  server-to-server ไม่มีเบราว์เซอร์มากดยืนยันตัวตน

---

## 3. ตรวจหลังเปิด — รันจากเครื่องนอกวง

```bash
# 3.1 ต้องได้ 401 (ถึงเราแล้ว รอลายเซ็น)
curl -s -o /dev/null -w '%{http_code}\n' https://meta.dojojin.tech/v1/healthz

# 3.2 ต้องได้ 404 ทุกอัน — dashboard ต้องไม่โผล่บนโฮสต์นี้
for p in / /login.html /api/branding /others/ ; do
  echo -n "$p → "; curl -s -o /dev/null -w '%{http_code}\n' "https://meta.dojojin.tech$p"
done

# 3.3 dashboard เดิมต้องยังปกติ
curl -s -o /dev/null -w '%{http_code}\n' https://dashboard.dojojin.tech/login.html   # 200
```

**ถ้า 3.2 ได้อย่างอื่นที่ไม่ใช่ 404 → หยุด** แล้วเช็คว่า `PARTNER_HOST` ตรงกับ
hostname ที่ตั้งใน Cloudflare เป๊ะ (ตัวพิมพ์เล็กทั้งหมด ไม่มี port)

**ทดสอบด้วยลายเซ็นจริง** — ใช้ตัวเซ็นที่เรามีอยู่แล้ว:

```bash
cd ~/vigil-platform && set -a && . ./src/.env && set +a
node src/partner-admin.js create <slug> "<ชื่อ>" --days 90
# แล้วให้ partner เรียก https://meta.dojojin.tech/v1/healthz
# 200 = เซ็นถูก + role ใช้ได้จริง
```

---

## 4. ถ้าต้องถอยกลับ

ลบ Public Hostname ใน Cloudflare → `meta.dojojin.tech` หยุดตอบทันที
ไม่ต้องแตะเซิร์ฟเวอร์ · `PARTNER_HOST` ที่ค้างอยู่ไม่มีผลอะไรถ้าไม่มีใครส่ง Host นั้นมา

ถ้าต้องปิด partner รายเดียวไม่ใช่ทั้งช่องทาง:
```bash
node src/partner-admin.js revoke <slug>    # มีผลทันที คำขอถัดไปได้ 401
```

---

## 5. ที่ยังไม่ได้ทำ

- [ ] **DPA / ข้อตกลงแบ่งปันข้อมูล** — เจ้าของตัดสิน 2026-08-07 ว่าเปิดให้ CIB ก่อน
      ทำ form ทีหลัง · ดู §7 ของ [`REF_third-party-integration.md`](REF_third-party-integration.md)
- [ ] **`X-RateLimit-*` header** — ให้ partner รู้โควตาคงเหลือโดยไม่ต้องชน 429
- [ ] **webhooks (TP6)** — push ให้ partner แทนที่จะให้เขา poll · รอ CIB นิ่งก่อน
