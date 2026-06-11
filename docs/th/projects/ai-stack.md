---
title: AI Stack (Local LLM)
description: ระบบ AI inference แบบ self-hosted — Ollama, Open WebUI, SearXNG และ Continue.dev รันบนเครื่องตัวเองด้วย consumer GPU ไม่มี cloud subscription ไม่มีข้อมูลออกนอกเครื่อง
---

# AI Stack — ระบบ Local LLM แบบ Self-Hosted

ระบบ AI inference แบบ self-hosted เต็มรูปแบบ รันบน consumer GPU ทั้งหมด — ไม่มี API key, ไม่มีค่าใช้จ่ายรายครั้ง, ไม่มีข้อมูลส่งออกนอก

Stack นี้ใช้ [Ollama](https://ollama.com) เป็น inference engine แล้วประกอบเครื่องมือที่เหมาะกับงานแต่ละอย่างบนนั้น: หน้าแชตแบบ web, ระบบค้นหา web สำหรับคำตอบที่ใช้ข้อมูลสด, ผู้ช่วยเขียนโค้ดในตัว editor โดยตรง และการเลือกโมเดลที่ออกแบบมาให้เหมาะกับเพดาน VRAM 6 GB

---

## ทำไมต้อง Self-Hosted

| ปัจจัย | Cloud API | Stack นี้ |
|---|---|---|
| ความเป็นส่วนตัว | Prompt ออกนอกเครื่อง | Inference ทั้งหมดอยู่บนเครื่อง |
| ค่าใช้จ่าย | Per-token, รายเดือน/รายปี | ซื้อฮาร์ดแวร์ครั้งเดียว ไม่มี API fee |
| ความพร้อมใช้ | ขึ้นกับ uptime ผู้ให้บริการ | ใช้ได้แม้ไม่มีเน็ต |
| ควบคุมโมเดล | ผู้ให้บริการเป็นคนเลือก | ควบคุมได้เต็มที่ |
| ความเร็ว | มี network RTT + queue | GPU ในเครื่อง ไม่มี network hop |

Stack นี้สร้างขึ้นสำหรับใช้งานประจำวันในฐานะ developer tool — แชต, code completion, วิเคราะห์เอกสาร และค้นคว้าด้วยข้อมูลสดจาก web — โดยไม่มีค่าใช้จ่าย subscription รายเดือน

---

## สถาปัตยกรรม

4 services, GPU ตัวเดียว:

```
  ┌──────────────────────────────────────────────────┐
  │              Ollama (host systemd)                │
  │              127.0.0.1:11434                      │
  │         LLM engine · RTX 3060 Laptop 6 GB        │
  └──────┬──────────────────┬────────────────┬───────┘
         │ HTTP /api/*       │                │
         ▼                   ▼                ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  Open WebUI  │  │ Continue.dev │  │  SearXNG     │
  │  :3000       │  │ VS Code /    │  │  :8888 host  │
  │  (container) │  │ JetBrains    │  │  :8080 net   │
  └──────┬───────┘  └──────────────┘  └──────┬───────┘
         │                                    │ ผลค้นหา
         └────────────────────────────────────┘
               snippet → inject เข้า prompt
```

**Ollama** รันบน host เป็น systemd service เพื่อเข้าถึง GPU ได้ตรงโดยไม่ต้องผ่าน container passthrough ทุก component เชื่อมต่อผ่าน `localhost:11434`

**Open WebUI** รันใน [Podman](https://podman.io) container (Quadlet, จัดการผ่าน systemd) ให้ web interface แบบ ChatGPT, จัดการ conversation history, รองรับ RAG document upload, และประสานงาน web search โดยเรียก SearXNG ภายใน

**SearXNG** เป็น metasearch engine แบบ self-hosted เมื่อเปิด web search ใน Open WebUI มันจะค้นหา search engine หลายตัวพร้อมกัน รวบรวมผลลัพธ์ และส่ง snippet เข้า prompt ของ LLM โดยตรง — ไม่ต้องผ่าน embedding หรือ vector retrieval

**Continue.dev** เป็น extension สำหรับ VS Code / JetBrains ต่อตรงกับ Ollama (`127.0.0.1:11434`) และให้ code completion แบบ inline + chat ภายใน editor

---

## โมเดลที่ใช้

การเลือกโมเดลถูกจำกัดด้วยฮาร์ดแวร์: RTX 3060 Laptop ที่มี **VRAM 6 GB** โมเดลต้องพอดีกับ VRAM (weights + KV-cache) ถึงจะรันได้ในความเร็ว interactive หากเกินเพดาน Ollama จะ offload layer ลง RAM ซึ่งทำให้ throughput ลดลงมาก

เพดานที่ใช้ได้จริงสำหรับ interactive: **Q4 weights ≤ ~5.5 GB**

### โมเดลที่ติดตั้งแล้ว

| โมเดล | ขนาด (Q4) | งาน | VRAM fit | หมายเหตุ |
|---|---|---|---|---|
| `qwen2.5-coder:7b` | ~4.7 GB | Code chat, review, generation | ✅ เต็ม GPU | โมเดลโค้ดหลัก — ประสิทธิภาพสูงสุดในระดับ ≤6 GB |
| `qwen2.5-coder:3b` | ~2.0 GB | Autocomplete ใน editor | ✅ เต็ม GPU | เร็วพอสำหรับ keystroke-latency completion |
| `qwen3:4b` | ~2.5 GB | ทั่วไป, ภาษาไทย | ✅ เต็ม GPU | ใหม่กว่า qwen2.5:7b — มี thinking mode, multilingual ดีขึ้น |
| `gemma3:4b` | ~3.3 GB | Multimodal (ภาพ + ข้อความ) | ✅ เต็ม GPU (~2.9 GB) | ใช้โดย model router สำหรับ input รูปภาพ |
| `deepseek-r1:7b` | ~5.1 GB | Reasoning, logic, คณิตศาสตร์ | ⚠️ 91% GPU / 9% CPU | เกินเพดานนิดหน่อย ยอมรับได้สำหรับงาน reasoning ที่ไม่เน้นความเร็ว |
| `bge-m3` | ~1.2 GB | Embedding (RAG, semantic search) | ✅ เต็ม GPU | 1024-dimension multilingual; ใช้กับ Knowledge ใน Open WebUI |

### Model Router

Open WebUI รัน model router pipe ที่เลือก backend model อัตโนมัติตาม message:

- Message มีรูปภาพ → `gemma3:4b`
- Message มี code pattern → `qwen2.5-coder:7b`
- อื่น ๆ → `qwen3:4b`

Task model (สร้างชื่อสนทนา + สร้าง search query) ใช้ `qwen2.5-coder:3b` — เร็ว, ไม่มี thinking mode, VRAM น้อย

### ทำไมเลือก Qwen2.5-Coder

ในระดับ 7B parameter กับ Q4 quantization `qwen2.5-coder` ติด top ของ coding benchmark สำหรับโมเดลที่ fit ใน consumer VRAM รองรับ Fill-In-the-Middle (FIM) ทำให้ใช้ได้ทั้ง autocomplete และ full-context chat variant 3B ใน family เดียวกันให้ tokenizer และ style เดียวกันในความเร็วที่สูงกว่าสำหรับ editor

### ทำไมเลือก Qwen3:4b สำหรับงานทั่วไป

`qwen3:4b` ใหม่กว่า `qwen2.5:7b` และ fit เต็มใน VRAM ที่ Q4 เหลือ headroom สำหรับ context จุดเด่นหลักคือ **thinking mode** (directive `/think`) ที่เปิดการคิดหลายขั้นตอนตามต้องการ พร้อม default เป็น fast single-pass ผ่าน `/no_think` รองรับภาษาไทยได้ดีพอสำหรับงานทั่วไป

### ทำไมเลือก DeepSeek-R1:7b สำหรับ Reasoning

DeepSeek-R1 ใช้ reinforcement learning เพื่อปรับปรุงประสิทธิภาพใน logical reasoning, คณิตศาสตร์ และงานที่มีหลายขั้นตอน variant 7B เกินเพดาน 6 GB เล็กน้อย (offload นิดหน่อย) ซึ่งยอมรับได้ เพราะงาน reasoning ไม่ต้องการความเร็วสูง — คำตอบที่ถูกในเวลา 30 วินาทีมีค่ามากกว่าคำตอบผิดที่เร็วกว่า

---

## ความสามารถหลัก

### แชต Offline

Stack inference ทั้งหมดทำงานได้โดยไม่ต้องต่อเน็ต Ollama serve โมเดลจาก local storage; Open WebUI ให้ interface เหมาะสำหรับวิเคราะห์เอกสารที่ sensitive, ทำงานในสภาพแวดล้อมที่จำกัดการเชื่อมต่อ หรือหลีกเลี่ยงการพึ่งพา cloud API availability

### Web-Augmented Chat (SearXNG)

เมื่อเปิด web search toggle ใน Open WebUI, SearXNG จะค้นหา search engine หลายตัวพร้อมกัน ดึง snippet ผลลัพธ์ และ inject เข้า context window ของ LLM ก่อน generate คำตอบ LLM ได้รับข้อมูลปัจจุบันโดยไม่ต้องอัปเดต knowledge base หรือ fine-tune

**Config ที่ใช้:**
- Bypass web loader: เปิด (ใช้ snippet ไม่โหลดทั้งหน้า)
- Bypass embedding and retrieval: เปิด (inject context ตรง ไม่ผ่าน vector lookup)
- จำนวนผลลัพธ์: 5
- ภาษา: all

### Document Knowledge (RAG)

เอกสารที่อัปโหลดเข้า Knowledge ของ Open WebUI จะถูกตัดเป็น chunk embed ด้วย `bge-m3` และเก็บในฐานข้อมูล vector บนเครื่อง chunk ที่เกี่ยวข้องถูก retrieve ตอน query แล้ว inject เข้า context multilingual embedding space ของ `bge-m3` รองรับเอกสารภาษาไทยและอังกฤษใน index เดียวกัน

### ผู้ช่วยเขียนโค้ด (Continue.dev)

Continue.dev เชื่อม Ollama กับ VS Code และ JetBrains โดยตรง:

- **Tab completion** — `qwen2.5-coder:3b` ให้ completion แบบ single-line และ multi-line ขณะพิมพ์ ใช้ FIM prompting
- **Inline chat** — เลือกโค้ดแล้วถามคำถามหรือขอ refactor; ใช้ `qwen2.5-coder:7b`
- **File context** — Continue แนบไฟล์ที่เปิดอยู่และ codebase directory เข้า prompt ได้

ทุก request จาก editor ไปที่ `127.0.0.1:11434` — ไม่มี traffic ออกนอกเครื่อง

### รูปภาพ (Multimodal)

Model router ของ Open WebUI route message ที่มีรูปภาพไปให้ `gemma3:4b` อัตโนมัติ รองรับ drag-and-drop หรือ paste รูปตรงในช่องแชต ใช้งานได้: อธิบาย diagram, วิเคราะห์ screenshot, อ่านข้อความในรูป (OCR-style)

---

## Remote Access

Stack เข้าถึงได้จากภายนอก LAN ผ่าน Cloudflare Tunnel:

```
Browser / มือถือ → ai.dojojin.tech → Cloudflare Access (ต้อง login)
                                    → Cloudflare Tunnel → Open WebUI :3000
```

**Cloudflare Access** กั้น endpoint — เฉพาะผู้ใช้ที่ยืนยันตัวตนแล้ว (อีเมลเจ้าของ) เข้าถึง interface ได้ ไม่มีการเปิด inbound firewall port — tunnel เป็น outbound-only จาก server

---

## Infrastructure

**ระบบปฏิบัติการ:** Bazzite (Fedora Atomic / immutable Linux, KDE Plasma 6 Wayland)

**GPU:** NVIDIA RTX 3060 Laptop, 6 GB GDDR6

**CPU / RAM:** AMD Ryzen 7 5800H, 35 GB RAM

**Container runtime:** Podman กับ Quadlet (จัดการ container ผ่าน systemd โดยตรง ไม่ใช้ Docker daemon)

| Service | รันแบบ | จัดการโดย |
|---|---|---|
| Ollama | systemd service (host) | `/etc/systemd/system/ollama.service` |
| Open WebUI | Podman container | `/etc/containers/systemd/openwebui.container` |
| SearXNG | Podman container | `/etc/containers/systemd/searxng.container` |
| Continue.dev | VS Code / JetBrains extension | Editor-managed |

ทั้งสอง Podman container อยู่บน internal network `ai-stack` เดียวกัน Open WebUI ต่อ Ollama ผ่าน `host.containers.internal` SearXNG เข้าถึงได้จาก Open WebUI ด้วยชื่อ container ภายใน network

---

## Roadmap

- **Phase C — OpenClaw agent:** AI agent บนเครื่องที่มี tool access (shell, file system, browser) ใช้ Ollama เป็น reasoning backend; รันภายใต้ allowlist จำกัดสิทธิ์
- **Phase D — Telegram integration:** สั่งงาน agent จากมือถือผ่าน Telegram bot; เชื่อม cloud API (Anthropic) เป็น fallback สำหรับงานที่โมเดล local ไม่เพียงพอ
- **ChindaMT-4B:** โมเดลแปลภาษาไทย-อังกฤษเฉพาะทาง; รอไฟล์ `.gguf`
