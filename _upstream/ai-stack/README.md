# ai-stack

Self-hosted **Local LLM + AI agent** stack สำหรับเครื่อง Nobara Linux (Ryzen 7 5800H · RTX 3060 6 GB · 35 GB RAM).
Infrastructure-as-code: สคริปต์ติดตั้ง + config บริการ + เอกสารกำกับ (Living Docs).

## Stack 4 ชั้น (ใช้ Ollama ตัวเดียวเป็นสมองร่วม)

| ชั้น | คือ | ใช้ทำ |
|---|---|---|
| **Ollama** | engine รันโมเดล (GPU) | สมองกลางของทุกอย่าง |
| **Open WebUI** | หน้าแชตแบบ ChatGPT (`:3000`) | เขียน / แปล / คอนเทนต์ |
| **Continue.dev** | extension VS Code/JetBrains | ผู้ช่วยโค้ด (autocomplete + chat) |
| **OpenClaw** | AI agent | สั่งงานทั้งเครื่อง/มือถือ (hybrid brain) |

## Quick start

```bash
# 0) เช็คความพร้อมเครื่อง (GPU / ดิสก์ / เน็ต)
./scripts/00-preflight.sh

# A) Ollama + โมเดลหลัก
./scripts/phase-a-ollama.sh

# B) Open WebUI + Continue.dev
./scripts/phase-b-webui-continue.sh

# C) OpenClaw (local brain, ปลอดภัยก่อน)
./scripts/phase-c-openclaw.sh

# D) ต่อ cloud API + LINE/Telegram — manual (มี secret/OAuth) ดู ROADMAP.md
```

> ทำทีละเฟส ตรวจผลแต่ละเฟสก่อนไปต่อ (ดู ROADMAP.md → Verify).

## โครงสร้าง

```
ai-stack/
├── CLAUDE.md            # กฎ + working agreement + model assignment + doc map (อ่านก่อน)
├── README.md            # ไฟล์นี้
├── ROADMAP.md           # แผน Phase A–D + ขั้นตอน
├── DECISIONS.md         # การตัดสินใจหลัก (index)
├── GOTCHAS.md           # ปัญหาที่เคยเจอ + วิธีแก้
├── CHANGELOG.md         # งานที่ทำเสร็จ
├── docs/                # Living Docs (ARCH_/LOGIC_/GUIDE_/REF_)
├── scripts/             # สคริปต์ติดตั้งแต่ละเฟส (idempotent)
├── compose/             # docker-compose (Open WebUI)
├── models/              # Modelfile (เช่น ChindaMT แปลไทย)
└── config/              # config (Continue.dev ฯลฯ)
```

## เอกสาร

เริ่มที่ **[CLAUDE.md](CLAUDE.md)** → แล้วดู **[docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md)**
สำหรับ registry เอกสารทั้งหมด. ระบบเอกสารปรับจาก `vigil-platform` (Living Docs).

---

Owner: Prakasit Rochanavipart (dojojin) · init 2026-06-01
