# ROADMAP — ai-stack

> แผนสร้าง Local LLM + AI agent stack บนเครื่อง Nobara (Ryzen 7 5800H · RTX 3060 6 GB · 35 GB RAM).
> ทำเป็น 4 เฟส A→D ทีละขั้น — แต่ละเฟสมีสคริปต์ของตัวเองใน `scripts/`.
> สถานะ ณ init (2026-06-01): **ยังไม่เริ่มติดตั้ง** — repo นี้คือแผน + โค้ดที่เตรียมไว้.

---

## ภาพรวม 4 เฟส

| เฟส | เป้าหมาย | สคริปต์ | สถานะ |
|---|---|---|---|
| **0** | Preflight — เช็ค GPU / ดิสก์ / เน็ต / Docker | `scripts/00-preflight.sh` | ✅ ผ่าน (2026-06-01) |
| **A** | Ollama + โมเดลหลัก → มี LLM ออฟไลน์ใช้ทันที | `scripts/phase-a-ollama.sh` | ✅ ผ่าน (2026-06-01) |
| **B** | Open WebUI + Continue.dev → หน้าแชต + ผู้ช่วยโค้ด | `scripts/phase-b-webui-continue.sh` | ✅ ผ่าน (2026-06-01) |
| **B+** | Expose `ai.dojojin.tech` ผ่าน tunnel เดิม (+ Cloudflare Access) | `scripts/phase-b-expose-cloudflare.sh` | ✅ ผ่าน (2026-06-01) |
| **C** | OpenClaw ต่อ Ollama (local) → agent ออฟไลน์ลองเล่น | `scripts/phase-c-openclaw.sh` | ✅ ผ่าน (2026-06-01) |
| **D** | OpenClaw + cloud API + แชต (LINE/Telegram) + skill ธุรกิจ | (manual config) | 🔄 Telegram เท่านั้น (ที่เหลือ postpone) |

> รันทุกเฟสด้วย `scripts/00-preflight.sh` ก่อนเสมอ (เช็ค GPU/ดิสก์/เน็ต).

---

## Phase A — Ollama + โมเดลหลัก

**เป้าหมาย:** มี LLM รันในเครื่อง ใช้งานได้จาก command line ทันที.

**ขั้นตอน:**
1. `scripts/00-preflight.sh` — ยืนยัน NVIDIA driver + `nvidia-smi` ทำงาน, ดิสก์ว่าง ≥ 30 GB, เน็ตออกได้ (IPv4)
2. `scripts/phase-a-ollama.sh` ทำ:
   - ติดตั้ง Ollama (official script) ถ้ายังไม่มี — idempotent
   - เปิด systemd service `ollama` (ฟังที่ `127.0.0.1:11434`)
   - ยืนยัน Ollama เห็น GPU (`ollama ps` / log `library=cuda`)
   - `ollama pull` โมเดลชุดเริ่มต้น:
     - `qwen2.5-coder:7b` — ผู้ช่วยโค้ดตัวหลัก (~4.7 GB)
     - `qwen2.5-coder:3b` — autocomplete ในエディเตอร์ (~2 GB)
     - `qwen2.5:7b` — เขียน/แปล/คอนเทนต์ทั่วไป
   - (ออปชัน) สร้างโมเดลแปลไทย `chinda-mt` จาก `models/ChindaMT-4B.Modelfile` ถ้ามีไฟล์ `.gguf`

**Verify (Working Agreement #3):**
```bash
ollama list                                   # เห็นโมเดลครบ
ollama run qwen2.5-coder:7b "เขียน fizzbuzz Python"   # ได้คำตอบจริง
```

**Rollback:** `sudo systemctl disable --now ollama` + `rm -rf ~/.ollama` (ลบโมเดลทั้งหมด).

---

## Phase B — Open WebUI + Continue.dev

**เป้าหมาย:** หน้าแชตแบบ ChatGPT (เขียน/แปล) + ผู้ช่วยโค้ดในエディเตอร์ (ฟรี ออฟไลน์).

**ขั้นตอน:**
1. `scripts/phase-b-webui-continue.sh` ทำ:
   - รัน Open WebUI ผ่าน `compose/docker-compose.yml` (ที่ port `3000` → ต่อ Ollama `11434`)
   - ตรวจ Docker + `host.docker.internal` ชี้กลับ host ถูก
   - วาง `config/continue-config.json` ไปที่ `~/.continue/config.json` (ถ้ายังไม่มี — ไม่ทับของเดิม)
2. ติดตั้ง extension **Continue** ใน VS Code / JetBrains เอง (manual — เป็น GUI)

**Verify:**
```bash
docker compose -f compose/docker-compose.yml ps   # openwebui = running
curl -fsS http://localhost:3000 >/dev/null && echo "WebUI ok"
```
- เปิด `http://localhost:3000` ในเบราว์เซอร์ → สมัคร admin → เห็นโมเดลจาก Ollama → แชตได้
- ในเอดิเตอร์: Continue เห็นโมเดล `qwen2.5-coder` → autocomplete + chat ทำงาน

**หมายเหตุ:** Continue config ใช้ `qwen2.5-coder:3b` เป็น autocomplete (เร็ว) + `:7b` เป็น chat model.

---

## Phase B+ — Expose `ai.dojojin.tech` (Cloudflare Tunnel)

**เป้าหมาย:** เปิด Open WebUI ออกเน็ตที่ `ai.dojojin.tech` ผ่าน tunnel ที่มีอยู่แล้ว — ทำหลัง Phase B.

**สถานะที่ตรวจแล้ว (2026-06-01):** DNS ✅ + Cloudflare Access ✅ มีอยู่แล้ว — เหลือแค่เพิ่ม ingress rule.

**ขั้นตอน:** `scripts/phase-b-expose-cloudflare.sh` (idempotent):
1. สำรอง + แทรก ingress `ai.dojojin.tech → http://127.0.0.1:3000` ก่อน catch-all 404 ใน `~/.cloudflared/config-host.yml`
2. `cloudflared tunnel ingress validate` (กัน config พังแล้ว `dojojin.tech` ล่มตาม)
3. `sudo systemctl restart cloudflared-dojojin.service` (กระทบ dojojin.tech ~1-2 วิ)

**Verify:** `curl -4 -sI https://dojojin.tech` ยัง 200 + เปิด `ai.dojojin.tech` ผ่าน Access → เจอ Open WebUI (ไม่ใช่ 404/502).

**กฎเหล็ก:** ใช้ tunnel เดิม — **ห้าม**สร้างใหม่/เปิด container (GOTCHAS #2). รายละเอียด: `docs/REF_cloudflare-tunnel.md`.

> **Cross-repo:** canonical config อยู่ที่ `dojojin-site/deploy/cloudflared-config-host.yml` — sync ingress บรรทัดเดียวกันที่นั่นถ้าต้องการถาวร.

---

## Phase C — OpenClaw (local brain)

**เป้าหมาย:** ลอง AI agent แบบปลอดภัยก่อน — ใช้ Ollama เป็นสมอง, ไม่ต่อแชตภายนอก, สิทธิ์จำกัด.

**ขั้นตอน:**
1. `scripts/phase-c-openclaw.sh` ทำ:
   - ติดตั้ง OpenClaw (ตามวิธี official — Node/Bun หรือ container)
   - ตั้ง provider ชี้ไป Ollama local (`http://127.0.0.1:11434`) + โมเดล `qwen2.5:7b`
   - เปิดเฉพาะ WebChat / local channel ก่อน — **ยังไม่ต่อ LINE/Telegram**
   - จำกัดสิทธิ์: ปิด skill ที่รันเชลล์อันตราย/ลบไฟล์ จนกว่าจะมั่นใจ
2. ลองสั่งงานเบา ๆ ผ่าน WebChat: สรุปไฟล์, แปลข้อความ, ถามโค้ด

**Verify:** สั่ง agent ทำงาน 1 อย่างที่ตรวจผลได้ (เช่น "อ่านไฟล์ X แล้วสรุป 3 บรรทัด") แล้วได้ผลจริง.

**⚠️ ความปลอดภัย:** OpenClaw รันเชลล์/อ่านไฟล์แทนเราได้ — ดู STUBBORN_FACT (governance) + Notes #7 ใน CLAUDE.md.

---

## Phase D — OpenClaw เต็มรูปแบบ (hybrid brain + แชต)

**เป้าหมาย:** agent ใช้งานจริง สั่งจากมือถือได้.

**ขั้นตอน (manual config เป็นหลัก เพราะมี secret/OAuth):**
1. เพิ่ม **cloud API key** (เช่น Claude) เป็นสมองสำหรับงานหนัก/หลายขั้น — งานลับยังชี้ Ollama local (hybrid)
2. ต่อช่องแชต **LINE / Telegram** + ตั้ง **allowlist** ผู้ใช้ที่สั่งงานได้ (กันคนนอกสั่ง)
3. ตั้ง skill ตามงาน 3 ด้าน:
   - Dev: รัน test/git/build จากมือถือ, อ่าน log → เสนอ fix
   - เขียน/แปล: ร่างเมล, แปลเอกสาร, สรุปไฟล์ยาว, สรุปข่าวสายงานส่ง LINE ทุกเช้า
   - ธุรกิจ: ต่อ Gmail/Calendar → จัดตาราง, ร่างเมล, เตือนนัด
4. (พิจารณา) NVIDIA NemoClaw เป็นชั้นความปลอดภัยคุมพฤติกรรม agent

**Verify:** สั่งงานจาก LINE/Telegram จริง 1 งานต่อด้าน แล้วได้ผล + คนนอก allowlist สั่งไม่ได้.

---

## งานในอนาคต (backlog)

- [ ] เพิ่มโมเดล embedding (`nomic-embed-text`) สำหรับ RAG/ค้นเอกสารส่วนตัว
- [ ] ลองโมเดลโค้ด 14B (offload) เทียบคุณภาพ vs ความเร็วบนเครื่องนี้ → log ใน DECISIONS
- [ ] Persona/prompt library ใน Open WebUI (แปล/สรุป/เขียน) → `docs/REF_openwebui-prompts.md`
- [ ] Native mobile app (Enchanted/ChatterUI) → expose Ollama API ผ่าน tunnel + auth
- [ ] Model Router ปรับ logic ให้แม่นขึ้น (classifier model แทน keyword)
- [ ] เอกสาร skill ของ OpenClaw → `docs/LOGIC_openclaw-skills.md`
- [ ] auto-start ทุกเฟสตอน boot (systemd) + health check รวม

---

*ai-stack ROADMAP · init 2026-06-01*
