# REF_cloudflare-tunnel — ai-stack

> วิธี expose Open WebUI ออกเน็ตที่ **`ai.dojojin.tech`** ผ่าน Cloudflare Tunnel ที่ **มีอยู่แล้ว**.
> โหลดเมื่อ: เปิด/แก้การ expose ออกเน็ต, debug tunnel/Access.
> Script: `scripts/phase-b-expose-cloudflare.sh` · decision #12 · GOTCHAS #2

---

## สถานะ ณ ปัจจุบัน (ตรวจสอบ 2026-06-01)

| สิ่ง | สถานะ | รายละเอียด |
|---|---|---|
| Tunnel | ✅ มีแล้ว | `cloudflared-dojojin.service` (host systemd), ID `f6684909-…`, config `~/.cloudflared/config-host.yml` |
| DNS `ai.dojojin.tech` | ✅ มีแล้ว | proxied เข้า Cloudflare |
| Cloudflare Access | ✅ เปิดอยู่ | เข้า `ai.dojojin.tech` เด้งไป `dojojin.cloudflareaccess.com` login ก่อนเสมอ (กันคนนอก) |
| Ingress rule ใน tunnel | ❌ ยังไม่มี | ต้องเพิ่มเอง → ปัจจุบันผ่าน Access แล้วจะเจอ 404 |

**สรุป:** เหลือแค่เพิ่ม **ingress rule บรรทัดเดียว** → ชี้ `ai.dojojin.tech` ไป Open WebUI.

---

## หลักการ (สำคัญ — STUBBORN_FACT)

- ใช้ **tunnel เดิมตัวเดียว** ที่เสิร์ฟ `dojojin.tech` อยู่ — แค่เพิ่ม hostname ใน ingress
- **ห้าม** สร้าง tunnel ใหม่ และ **ห้าม** เปิด cloudflared container ใน compose
  → tunnel ID เดียวกันรัน 2 ที่ = split-brain → 502 เป็นช่วง ๆ (GOTCHAS #2, decision #10)
- ไฟล์ที่ service ใช้จริง = `~/.cloudflared/config-host.yml`
  (ใช้ `127.0.0.1`, **ไม่ใช่** `host.docker.internal`)

---

## ingress rule ที่ต้องเพิ่ม

แทรก **ก่อน** catch-all `http_status:404` ใน `~/.cloudflared/config-host.yml`:

```yaml
  - hostname: ai.dojojin.tech
    service: http://127.0.0.1:3000     # Open WebUI (Phase B)
```

หลังแก้:
```yaml
ingress:
  - hostname: dojojin.tech
    service: http://127.0.0.1:80
  - hostname: www.dojojin.tech
    service: http://127.0.0.1:80
  - hostname: ssh.dojojin.tech
    service: ssh://127.0.0.1:22
  - hostname: ai.dojojin.tech          # ← เพิ่ม
    service: http://127.0.0.1:3000      # ←
  - service: http_status:404
```

---

## ลำดับการทำ (อัตโนมัติด้วยสคริปต์)

```bash
# ต้องมี Open WebUI ที่ :3000 ก่อน (Phase B) ไม่งั้น 502
./scripts/phase-b-expose-cloudflare.sh
```

สคริปต์ทำ (idempotent):
1. สำรอง `config-host.yml` → `.bak-<timestamp>`
2. แทรก ingress `ai.dojojin.tech` ก่อน catch-all (ข้ามถ้ามีแล้ว)
3. `cloudflared tunnel ingress validate` — กัน config พังแล้ว dojojin.tech ล่มตาม
4. `sudo systemctl restart cloudflared-dojojin.service` (กระทบ dojojin.tech ~1-2 วิ)
5. Verify

---

## Verify

```bash
curl -4 -sI https://dojojin.tech | head -1                 # ยัง 200 (ไม่พังของเดิม)
cloudflared tunnel ingress rule --config ~/.cloudflared/config-host.yml https://ai.dojojin.tech
# เบราว์เซอร์: ai.dojojin.tech -> Cloudflare Access login -> Open WebUI
```

| เจอ | แปลว่า |
|---|---|
| Access login page | ปกติ — Access กันหน้าอยู่ |
| 404 หลัง login | ingress ยังไม่เพิ่ม / ยังไม่ restart |
| 502 หลัง login | Open WebUI (:3000) ไม่รัน → รัน Phase B |
| เจอหน้า Open WebUI | ✅ สำเร็จ |

---

## Cross-repo sync (สำคัญ)

`~/.cloudflared/config-host.yml` ถูกติดตั้งมาจาก canonical ใน repo **`dojojin-site`**:
`dojojin-site/deploy/cloudflared-config-host.yml` (ติดตั้งด้วย `deploy/install-tunnel.sh`).

> ถ้าต้องการให้ถาวร (กันเครื่องลงใหม่แล้วหาย) → เพิ่ม ingress บรรทัดเดียวกันที่
> `dojojin-site/deploy/cloudflared-config-host.yml` แล้ว commit ใน repo นั้นด้วย (คนละ repo).
> ai-stack แก้ที่ไฟล์ live เพื่อใช้งานทันที; dojojin-site เก็บ source of truth ระยะยาว.

---

## ความปลอดภัย

- **Cloudflare Access เปิดอยู่แล้ว** → เฉพาะ identity ที่อนุญาต (อีเมลเจ้าของ) เข้าได้ — เหมาะมากสำหรับ Open WebUI/LLM
- ตรวจ policy ของ `ai.dojojin.tech` ใน Cloudflare Zero Trust dashboard ว่าจำกัดอีเมลถูกคน
- Open WebUI ตั้ง `ENABLE_SIGNUP=false` อยู่แล้ว (สมัครครั้งแรก=admin แล้วล็อก) เป็นชั้นที่สอง

---

*ai-stack · REF_cloudflare-tunnel · init 2026-06-01*
