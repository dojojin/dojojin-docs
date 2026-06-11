# DECISIONS — ai-stack

> **Index file** — การตัดสินใจหลักของ stack นี้ (สรุปบรรทัดเดียว + เหตุผลสั้น).
> rationale ยาว → ไฟล์ที่ระบุ. อย่า second-guess การตัดสินใจที่ลงไว้แล้ว.
> Companion: CLAUDE.md · GOTCHAS.md · docs/LOGIC_model-selection.md
> Last updated: 2026-06-01

---

## Decision Index

### Stack & Runtime
- **#1** ใช้ **Ollama** เป็น engine รันโมเดล (ไม่ใช่ llama.cpp ดิบ / LM Studio) → ติดตั้งง่าย, ตรวจ GPU เอง, มี systemd service, ต่อ Open WebUI/Continue/OpenClaw ได้หมดด้วย API เดียว
- **#2** บังคับ **IPv4** ทุกเครื่องมือ network → เครื่องนี้ IPv6 ไม่มี route ออก (GOTCHAS #1). `STUBBORN_FACT`
- **#3** Open WebUI รันผ่าน **Docker compose** ที่ port `3000` ต่อ Ollama host `11434` ด้วย `host.docker.internal` → แยก lifecycle ออกจาก host, อัปเดตง่าย
- **#4** สคริปต์ติดตั้งทุกตัว **idempotent** (เช็คก่อนทำ รันซ้ำไม่พัง) → เครื่องเดียว ทำซ้ำบ่อย. `STUBBORN_FACT`

### Model Selection (→ docs/LOGIC_model-selection.md)
- **#5** **VRAM 6 GB = เพดานแข็ง**. daily-driver ≤8B Q4 (fit GPU เกือบเต็ม); >6 GB ใช้ offload เฉพาะงานไม่ interactive; ห้าม 27B+ interactive. `STUBBORN_FACT`
- **#6** โมเดลเริ่มต้น: `qwen2.5-coder:7b` (โค้ด-chat) + `qwen2.5-coder:3b` (autocomplete) + `qwen2.5:7b` (เขียน/แปล) → ตระกูล Qwen2.5 เก่งโค้ด + รองรับหลายภาษา (ไทยใช้ได้) + ขนาดพอดี 6 GB
- **#6a** งานแปลไทย-อังกฤษเฉพาะทาง เก็บ Modelfile `ChindaMT-4B` (iApp) ไว้เป็นออปชัน → โมเดลแปลไทยโดยเฉพาะ (ย้ายมาจากของเดิมในโฟลเดอร์ก่อน init)

### OpenClaw (Agent)
- **#7** OpenClaw ใช้สมองแบบ **hybrid**: cloud API (เช่น Claude) สำหรับงาน agent หนัก/หลายขั้น, Ollama local สำหรับงานลับ/ออฟไลน์ → 6 GB ทำ agent ซับซ้อนได้จำกัด แต่งานลับต้องไม่ออกเครื่อง. `STUBBORN_FACT`
- **#8** OpenClaw รัน **สิทธิ์จำกัด + allowlist เท่านั้น** ไม่เปิดช่องแชตสาธารณะแบบเปิด → agent รันเชลล์/อ่านไฟล์แทนเราได้ = ความเสี่ยงสูง. `STUBBORN_FACT`
- **#9** ทำเป็นเฟส C→D (local-only ก่อน แล้วค่อยต่อ cloud + แชต) → ลองแบบปลอดภัยก่อนเปิดออกเน็ต

### Infra / Ops
- **#10** **ห้ามเปิด cloudflared container** ใน compose นี้ → host มี `cloudflared-dojojin.service` อยู่แล้ว, เปิดซ้ำ = tunnel split-brain 502 (GOTCHAS #2). `STUBBORN_FACT`
- **#11** Governance เอกสารแบบ **Living Docs** (prefix ARCH_/LOGIC_/GUIDE_/REF_/INCIDENT_) ปรับจาก vigil-platform → เจ้าของคุ้นระบบนี้อยู่แล้ว, ขยายต่อง่าย → docs/ARCH_documentation-governance.md

### Networking / Expose
- **#12** Expose Open WebUI ที่ **`ai.dojojin.tech`** โดย **เพิ่ม ingress rule ใน tunnel เดิม** (`cloudflared-dojojin.service`, ID `f6684909…`) ชี้ `http://127.0.0.1:3000` → **ไม่สร้าง tunnel ใหม่ / ไม่เปิด container** (กัน split-brain 502 — GOTCHAS #2). DNS + Cloudflare Access มีอยู่แล้ว → เหลือแค่ ingress + restart. → docs/REF_cloudflare-tunnel.md. `STUBBORN_FACT`
- **#13** การเข้าถึง `ai.dojojin.tech` กันด้วย **Cloudflare Access (Zero Trust)** ที่เปิดอยู่แล้ว (เฉพาะอีเมลเจ้าของ) + Open WebUI `ENABLE_SIGNUP=false` เป็นชั้นสอง → LLM/agent ไม่โดนคนนอกเข้าถึง

---

*ai-stack DECISIONS index · init 2026-06-01*
