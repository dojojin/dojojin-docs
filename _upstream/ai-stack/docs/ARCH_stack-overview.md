# ARCH_stack-overview — ai-stack

> สถาปัตยกรรม stack: 4 ชั้นต่อกันยังไง, port, data flow.
> โหลดเมื่อ: คำถามสถาปัตยกรรม, port ชนกัน, onboarding.

---

## Topology

```
                         ┌─────────────────────────────┐
                         │   Ollama  (host systemd)     │
                         │   127.0.0.1:11434            │
                         │   engine + GPU (RTX 3060)    │
                         └──────────────┬──────────────┘
                                        │  HTTP API (/api/*)
            ┌───────────────────────────┼───────────────────────────┐
            │                           │                           │
   ┌────────┴─────────┐      ┌──────────┴─────────┐      ┌──────────┴─────────┐
   │ Open WebUI       │      │ Continue.dev       │      │ OpenClaw (agent)   │
   │ Docker :3000     │      │ VS Code/JetBrains  │      │ local/host         │
   │ → host.docker.   │      │ ~/.continue/       │      │ provider=ollama    │
   │   internal:11434 │      │   config.json      │      │ + cloud API (D)    │
   └──────────────────┘      └────────────────────┘      └─────────┬──────────┘
   เขียน/แปล/คอนเทนต์         autocomplete + chat         แชต: WebChat→(D)LINE/TG
```

---

## Port map

| Service | Bind | Port | หมายเหตุ |
|---|---|---|---|
| Ollama | `0.0.0.0` | `11434` | host systemd service. bind 0.0.0.0 เพื่อให้ Docker container เข้าได้ (override.conf) |
| Open WebUI | container → host | `3000` → `8080` | เข้าผ่าน `http://localhost:3000`; ออกเน็ต = `ai.dojojin.tech` |
| OpenClaw gateway | `127.0.0.1` | `18789` | WebChat UI: `http://127.0.0.1:18789/` local-only |

### Expose ออกเน็ต (Cloudflare Tunnel)

```
Internet → ai.dojojin.tech → Cloudflare Access (login) → Tunnel (cloudflared-dojojin.service)
                                                          → ingress: http://127.0.0.1:3000 (Open WebUI)
```

- ใช้ **tunnel เดิมตัวเดียว** กับ `dojojin.tech` — เพิ่มแค่ ingress rule (decision #12, GOTCHAS #2)
- กันหน้าด้วย **Cloudflare Access** (เฉพาะอีเมลเจ้าของ) — decision #13
- รายละเอียด + สคริปต์: [REF_cloudflare-tunnel.md](REF_cloudflare-tunnel.md) · `scripts/phase-b-expose-cloudflare.sh`

> Continue.dev ไม่มี port ของตัวเอง — เป็น extension เรียก Ollama ตรง ๆ.

---

## ทำไม Ollama อยู่บน host (ไม่ใช่ container)

- เข้าถึง GPU NVIDIA ง่ายกว่า (ไม่ต้อง nvidia-container-toolkit)
- เป็น systemd service auto-start บน boot
- Open WebUI (container) ต่อกลับ host ผ่าน `host.docker.internal:host-gateway` (ตั้งใน compose แล้ว)
- Continue / OpenClaw ที่รันบน host ก็เรียก `127.0.0.1:11434` ตรง ๆ

---

## Data flow ตัวอย่าง

**แชตใน Open WebUI:** browser → WebUI container `:3000` → `host.docker.internal:11434` → Ollama → GPU → stream กลับ

**Autocomplete ใน editor:** keystroke → Continue → `127.0.0.1:11434` (โมเดล `qwen2.5-coder:3b`) → suggestion

**Agent ใน OpenClaw (เฟส C):** WebChat → OpenClaw → provider `ollama` `127.0.0.1:11434` → ตัดสินใจ → เรียก skill (เชลล์/ไฟล์ ภายใต้สิทธิ์จำกัด)

---

## ขอบเขต/ความปลอดภัย

- Ollama bind `127.0.0.1` เท่านั้น — ไม่เปิดออก LAN/เน็ต
- Expose ออกเน็ต (ถ้าทำ) ใช้ cloudflared **service บน host** ที่มีอยู่ — **ห้าม**เปิด container ซ้ำ (GOTCHAS #2)
- OpenClaw = จุดเสี่ยงสูงสุด (รันเชลล์ได้) → allowlist + สิทธิ์จำกัด (decision #8)

---

---

## Mobile Access

| วิธี | สถานะ | รายละเอียด |
|---|---|---|
| Browser → `ai.dojojin.tech` | ✅ พร้อมใช้ | Open WebUI บน mobile browser ผ่าน Cloudflare Access |
| Telegram (Phase D) | 🔄 pending | สั่งงาน agent จากมือถือโดยตรง |
| Native apps (Enchanted/ChatterUI) | ⬜ ต้อง expose Ollama | ต้องเพิ่ม ingress `ollama.dojojin.tech → :11434` + auth |

> แนะนำใช้ browser ก่อน — ปลอดภัยกว่าและไม่ต้องตั้งค่าเพิ่ม

---

*ai-stack · ARCH_stack-overview · อัปเดต 2026-06-03*
