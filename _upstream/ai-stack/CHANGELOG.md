# CHANGELOG — ai-stack

> งานที่ทำเสร็จแล้ว เรียงตามวัน (ล่าสุดอยู่บน). งานค้าง → [ROADMAP.md](ROADMAP.md).

---

## 2026-06-09 — Web Search (SearXNG) + Open WebUI tuning

เปิดให้ Open WebUI ค้นข้อมูลสด/สรุปข่าวประจำวันได้ (ดูเต็ม: `docs/REF_websearch-searxng.md`, GOTCHAS #15–#19).

### SearXNG (self-host)
- ติดตั้งเป็น **podman quadlet** `/etc/containers/systemd/searxng.container` (ไม่มี docker บน Bazzite)
- network `ai-stack` (สร้างใหม่) — openwebui + searxng คุยกันด้วยชื่อ container; openwebui ต่อ Ollama ผ่าน `host.containers.internal`
- config `/var/lib/searxng/settings.yml`: เปิด `formats: [html, json]` (จำเป็นสำหรับ Open WebUI)

### Open WebUI config
- Embedding: engine=ollama, model=**bge-m3** (แก้ typo `ิbge-m3`→`bge-m3` ที่ทำ embed พัง)
- Web Search: engine=searxng, query URL=`http://searxng:8080/search?q=<query>`
- **searxng_language=`all`** (เดิม `th,en` ทำ SearXNG ตอบ 400 ทุก query — GOTCHAS #15)
- **bypass_web_loader=on + bypass_embedding_and_retrieval=on** — ฉีดผลค้นตรง ๆ (retrieval เดิมได้ 0 chunk; เร็วขึ้นมากด้วย — GOTCHAS #16,#17)
- result_count=5

### quadlet env (openwebui)
- **`WEBUI_SECRET_KEY` pinned** — เดิมไม่ persist ทำให้ restart=logout 401 ทุกครั้ง (GOTCHAS #18)
- **`TASK_MODEL=qwen2.5-coder:3b`** — query/title generation ใช้โมเดลเล็ก ไม่ thinking (เดิม default ไป qwen3 thinking ~26s — GOTCHAS #19)

### วิธีใช้
ใช้โมเดล **direct** (`qwen3:4b`) ไม่ใช่ Model Router (pipe ไม่รับ web-search context) + เปิด 🌐 + เติม `/no_think`.

---

## 2026-06-09 — Migrate ไปเครื่องใหม่ (Bazzite) + ปรับชุดโมเดล

ย้าย ai-stack มาเครื่องใหม่ **Bazzite/Kinoite** (immutable Fedora, KDE) — ฮาร์ดแวร์เดิม (RTX 3060 Laptop 6 GB / 35 GB RAM). กู้จาก backup แล้ว deploy ใหม่.

### Bazzite adaptations (ต่างจาก Nobara เดิม)
- **Ollama**: official installer สร้าง systemd unit ไม่ได้ (เขียน `/usr/share/ollama` ไม่ได้ — /usr อ่านอย่างเดียว). แก้: เขียน `/etc/systemd/system/ollama.service` เอง — รันเป็น user `ollama`, `OLLAMA_MODELS=/var/lib/ollama/models`, `HOME=/var/lib/ollama`, `OLLAMA_HOST=0.0.0.0:11434` (ให้ container เข้าถึงได้). GPU CUDA ทำงานปกติ.
- **Open WebUI**: ไม่มี docker บน Bazzite → รันด้วย **podman quadlet** `/etc/containers/systemd/openwebui.container` (system service `openwebui.service`) แทน docker-compose. `PublishPort=127.0.0.1:3000:8080`, ต่อ Ollama ผ่าน `host.containers.internal:11434` (หรือ `host.docker.internal` ก็ได้), data ที่ `/var/lib/openwebui`.
- nginx/cloudflared/`dojojin.tech`+`docs.dojojin.tech`+`ai.dojojin.tech` กู้ครบ (ดู repo `dojojin-site`).

### ปรับชุดโมเดล
- **แทนที่** `qwen2.5:7b` → **`qwen3:4b`** (ทั่วไป/ไทย) — รุ่นใหม่กว่า, มี thinking mode, 119 ภาษา, fit GPU 100% (~2.5 GB), เร็วกว่า. ลบ `qwen2.5:7b` ทิ้ง.
- **แทนที่** embedding `nomic-embed-text` → **`bge-m3`** (1.2 GB, 1024-dim, multilingual — ดีกับไทยมากใน RAG). ลบ `nomic-embed-text` ทิ้ง. **ต้องตั้งใน** Open WebUI → Settings → Documents → Embedding Model → bge-m3 (มิติเปลี่ยน 768→1024 → ถ้าเคย embed เอกสารต้อง re-embed).
- **เพิ่ม** `deepseek-r1:7b` (reasoning/คณิต/ตรรกะ, ~5.1 GB → 91% GPU/9% CPU offload, ตึงนิดบน 6 GB).
- คงไว้: `qwen2.5-coder:7b` (โค้ด), `qwen2.5-coder:3b` (autocomplete), `gemma3:4b` (multimodal).
- **โมเดลรวมตอนนี้ (6 ตัว):** qwen3:4b · qwen2.5-coder:7b · qwen2.5-coder:3b · gemma3:4b · deepseek-r1:7b · bge-m3.

### Model Router (`config/openwebui-model-router.py`) v1.0.0 → v1.2.0
- ทั่วไป/ไทย: `qwen2.5:7b` → **`qwen3:4b`**
- **เพิ่ม route ใหม่:** คำนวณ/ตรรกะ (นิพจน์เลข, `คำนวณ/สมการ/พิสูจน์/ตรรกะ`, `solve/prove/calculate/equation/math`...) → **`deepseek-r1:7b`** (อยู่หลังเช็คโค้ด ก่อน default)
- เพิ่มหมายเหตุ: `bge-m3` เป็น embedding ไม่ route ที่นี่ (ตั้งใน RAG settings)
- หมายเหตุ: ถ้า paste router เข้า Open WebUI ไปแล้ว ต้องวาง code ใหม่ใน Admin Panel → Functions ให้ตรงเวอร์ชันนี้

---

## 2026-06-03 — Maintenance: โมเดล / อัปเดต / Secrets / SSH remote

### โมเดล
- เพิ่ม `gemma3:4b` (3.3 GB) — multimodal รองรับรูปภาพใน Open WebUI
- อัปเดต Open WebUI **v0.9.5 → v0.9.6** (`docker compose pull && up -d`)

### โมเดลเพิ่มเติม + เครื่องมือใหม่
- เพิ่ม `nomic-embed-text` (274 MB) — embedding model สำหรับ RAG ใน Open WebUI
  - ตั้งใน Settings → Documents → Embedding Model → nomic-embed-text
- สร้าง **Model Router** Pipe (`config/openwebui-model-router.py`):
  - มีรูปภาพ → `gemma3:4b`
  - โค้ด/debug → `qwen2.5-coder:7b`
  - ทั่วไป/ไทย → `qwen2.5:7b`
  - วิธีเพิ่ม: Admin Panel → Functions → ➕ → paste code → Save

### Mobile Access
- ยืนยันแนวทาง mobile access ของ stack นี้ (ดู ARCH_stack-overview.md):
  - **ตอนนี้:** browser → `ai.dojojin.tech` (Open WebUI, Cloudflare Access)
  - **Native apps (ต้อง expose Ollama API):** Enchanted (iOS), ChatterUI (Android), AnythingLLM
  - **Phase D:** Telegram — สั่งงาน agent จากมือถือโดยไม่ต้องเปิด browser

### 1Password CLI
- ติดตั้ง `1password-cli` v2.34.0 ผ่าน official RPM repo
- เก็บ secrets ครบใน vault **Personal** tag `ai-stack`:
  - `ai-stack sudo` (Login)
  - `ai-stack OpenClaw Gateway Token` (Password)
  - `ai-stack Cloudflare Tunnel Credentials (f6684909)` (Document — JSON file)
  - `ai-stack SSH Private Key / Public Key` (Document — key files)
- วิธี restore บนเครื่องใหม่: ดู `docs/REF_1password.md`

### SSH remote (Windows → ai-stack)
- ยืนยัน tunnel `ssh.dojojin.tech → :22` active + sshd running
- Windows SSH config ที่ถูกต้อง: `Host ai-stack` + `ProxyCommand cloudflared access ssh --hostname %h`
- พบปัญหา host key เปลี่ยน + config ชื่อ Host ไม่ตรง (GOTCHAS #11–#14)

---

## 2026-06-01 — Phase D: Telegram (งานค้าง 🔄)

**ทำแล้ว:**
- สมัคร admin Open WebUI สำเร็จ (หลังแก้ GOTCHAS #10 — ENABLE_SIGNUP)
- Open WebUI เห็นโมเดลครบ 3 ตัว + Arena Model พร้อมใช้
- วางแผน Telegram integration แล้ว: รอ Bot Token + User ID จากผู้ใช้

**งานค้าง (รอมาทำต่อ):**
- [ ] รับ Telegram Bot Token จาก @BotFather
- [ ] รับ Telegram User ID จาก @userinfobot
- [ ] ตั้งค่า OpenClaw: เปิด Telegram channel + ownerAllowFrom
- [ ] expose webhook ผ่าน tunnel (หรือ polling mode)
- [ ] verify: ส่ง message ใน Telegram → agent ตอบกลับ

**Postpone ไว้ก่อน:**
- Claude API key (hybrid brain)
- LINE channel
- Gmail/Calendar OAuth
- Skills (Dev/เขียน/ธุรกิจ)
- NemoClaw safety layer

---

## 2026-06-01 — Phase C: OpenClaw local brain ✅

- ติดตั้ง `openclaw@latest` ผ่าน npm (Node 22.22.0, IPv4-first)
- config `~/.openclaw/openclaw.json`: gateway bind=loopback, provider=ollama/127.0.0.1:11434, channels ปิดทั้งหมด
- exec-approvals: security=allowlist, askFallback=deny (ถามก่อนรัน command)
- ปิด memorySearch (ไม่มี OpenAI key — ใช้ local เท่านั้น)
- ติดตั้ง `openclaw-gateway.service` (systemd user) + `loginctl enable-linger`
- gateway HTTP 200 ที่ `http://127.0.0.1:18789/` ✓
- models เห็น 3 ตัว: `qwen2.5-coder:7b` (default), `:3b`, `qwen2.5:7b` — local=yes ทั้งหมด
- Advisor verify: bind=loopback ✓, channels=none ✓, inference ผ่าน Ollama ✓
- warnings ที่รอ Phase D: `commands.ownerAllowFrom` (ต้องการ channel ID) + secrets migration

---

## 2026-06-01 — Phase B+: Expose ai.dojojin.tech ✅

- เพิ่ม ingress rule `ai.dojojin.tech → http://127.0.0.1:3000` ใน `~/.cloudflared/config-host.yml` (ก่อน catch-all 404)
- สำรอง config ก่อนแก้ (`.bak-20260601-210441`)
- restart `cloudflared-dojojin.service` สำเร็จ
- Verify: `dojojin.tech` ยัง HTTP 200 ✓, `ai.dojojin.tech` ได้ HTTP 302 (Cloudflare Access login) ✓ ไม่ใช่ 404/502
- แก้ bug: flag `--config` ใน `cloudflared tunnel ingress validate/rule` ผิดตำแหน่ง → แก้เป็น `cloudflared --config FILE tunnel ingress ...`

---

## 2026-06-01 — Phase B: Open WebUI + Continue.dev ✅

- ดึง image `ghcr.io/open-webui/open-webui:main` + รัน container port `3000→8080`
- HTTP 200 ที่ `http://localhost:3000` ✓
- วาง Continue config → `~/.continue/config.json` (chat=qwen2.5-coder:7b, autocomplete=:3b)
- **แก้ปัญหา Ollama bind:** Ollama default bind `127.0.0.1` → container เข้าไม่ได้
  - เพิ่ม `/etc/systemd/system/ollama.service.d/override.conf` → `OLLAMA_HOST=0.0.0.0:11434`
  - restart ollama → container→Ollama ต่อได้ (`host.docker.internal:11434`) ✓
- Advisor verify: WebUI healthy, container เห็น 3 โมเดล ✓
- ขั้นตอน manual ที่เหลือ: สมัคร admin ที่ `http://localhost:3000` + ติดตั้ง Continue extension ใน VS Code

---

## 2026-06-01 — Phase A: Ollama + โมเดลหลัก ✅

- ติดตั้ง Ollama (official script, IPv4) — `/usr/local/bin/ollama`
- เปิด systemd service `ollama` (active, ฟังที่ `127.0.0.1:11434`)
- ดึงโมเดลชุดเริ่มต้น (decision #6):
  - `qwen2.5-coder:7b` — 4.7 GB (code-chat หลัก)
  - `qwen2.5-coder:3b` — 1.9 GB (autocomplete)
  - `qwen2.5:7b` — 4.7 GB (เขียน/แปล/คอนเทนต์)
- Verify ผ่าน: inference test (fizzbuzz Python) + แปลไทย ตอบถูกต้องทั้งคู่
- VRAM: 5031 MiB / 6144 MiB ขณะโหลด qwen2.5:7b — รัน sequential 1 โมเดลต่อครั้ง (Ollama จัดการเอง)
- Advisor ตรวจทาน: ✓ ทุกข้อ พร้อมไป Phase B

---

## 2026-06-01 — Phase 0: Preflight ผ่าน

- รัน `scripts/00-preflight.sh` ครั้งแรก — ผ่านทุกข้อ ✓
  - GPU: RTX 3060 Laptop 6144 MiB ✓
  - ดิสก์ว่าง: 784 GB ✓ (threshold ≥30 GB)
  - RAM: 35 GB ✓
  - เน็ต IPv4: ✓ (curl4 บังคับ -4 ตาม GOTCHAS #1)
  - Docker: 29.5.2 ✓
- Advisor ตรวจทานสคริปต์: lib.sh idempotent ✓, IPv4 enforcement ✓, sudo warning ✓
- พร้อมรัน Phase A (`scripts/phase-a-ollama.sh`)

---

## 2026-06-01 — Repo init

- เคลียร์ไฟล์เดิม (สำรองไว้ `.backup-pre-init-20260601/`: docker-compose Open WebUI + Modelfile ChindaMT)
- วางโครงสร้าง Living Docs governance ปรับจาก `vigil-platform` (decision rules + documentation rules)
- เขียน CLAUDE.md (entry point: working agreement, model assignment, doc map)
- วางแผน Phase A–D ใน ROADMAP.md + สคริปต์ติดตั้งใน `scripts/` (เตรียมไว้ ยังไม่รัน)
- เก็บ config: `compose/docker-compose.yml` (Open WebUI), `models/ChindaMT-4B.Modelfile`, `config/continue-config.json`
- เพิ่ม Phase B+ : expose `ai.dojojin.tech` ผ่าน tunnel เดิม — `scripts/phase-b-expose-cloudflare.sh` + `docs/REF_cloudflare-tunnel.md` (ตรวจแล้ว: DNS + Cloudflare Access มีอยู่แล้ว, เหลือแค่ ingress rule)

> ยังไม่ได้ติดตั้งจริง — เฟส A–D + B+ สถานะ ⬜ ทั้งหมด (เขียนโค้ด/เอกสารเตรียมไว้).

---

*ai-stack CHANGELOG*
