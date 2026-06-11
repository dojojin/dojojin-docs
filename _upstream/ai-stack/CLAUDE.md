# CLAUDE.md — ai-stack (Local LLM + AI Agent Infrastructure)

> **Project context handoff document for AI assistants (Claude Code, future chat sessions, etc.)**
> Owner: Prakasit Rochanavipart (dojojin) · Machine: Nobara Linux 43 / KDE Wayland laptop
> Hardware: Ryzen 7 5800H (8c/16t) · RTX 3060 Laptop **6 GB VRAM** · 35 GB RAM · 784 GB free
>
> **What this repo is:** infrastructure-as-code for a self-hosted Local LLM stack
> (Ollama) plus an AI agent (OpenClaw) — install scripts, service configs, and the
> rules/docs that govern them. The plan is delivered in phases A→D (see [ROADMAP.md](ROADMAP.md)).
>
> **Governance:** decision rules + documentation rules are adapted from `vigil-platform`
> (the owner's other repo). Living Docs system — see
> [docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md).

---

## 🧭 Working Agreement (ข้อตกลงการทำงาน — บังคับทุกครั้ง)

> กฎเหล่านี้ใช้กับ **ทุกคำสั่ง** ไม่ใช่เฉพาะงานใหญ่ — และ override พฤติกรรม default.
> ปรับมาจาก vigil-platform ให้เข้ากับบริบท "infra/ops บนเครื่องเดียว" ของ repo นี้.

### 1. Investigate-first — แยก Fact ออกจาก Opinion ให้ชัด

เมื่อได้รับคำสั่ง ทำตามลำดับนี้ก่อนลงมือเปลี่ยนระบบ:

1. **ตรวจสอบ** — อ่านสถานะจริง: `systemctl --user status`, `ollama list`, `docker ps`, ไฟล์ config จริง
2. **หาความจริง** — ยืนยันจาก source (เวอร์ชัน, log, VRAM ที่ว่างจริง) อย่าเดา
3. **ประมวลผล + วิเคราะห์**
4. **นำเสนอ แบ่ง 2 ส่วนชัดเจน:**
   - **🔵 Fact** — สิ่งที่ตรวจสอบแล้วจริง อ้างอิงได้ (คำสั่ง / output / decision #)
   - **🟡 Opinion** — ข้อดี/ข้อเสีย + แผนที่เสนอ + ความเห็น
5. **รอเจ้าของไฟเขียว** — ไม่ลงมือจนกว่าจะอนุมัติ

**ข้อยกเว้น:** คำสั่งที่เป็นไฟเขียวในตัว ("ทำเลย" / "จัดการเลย" / "ต่อเลย" / อนุมัติแผน) =
ตัดสินใจแล้ว → ลงมือได้ทันที. แต่ผลลัพธ์ยังต้องรายงานแยก Fact/Opinion เสมอ.

### 2. Plan-before-mutate — งานที่แตะระบบ/บริการ/ดิสก์

ก่อนทำสิ่งที่ **เปลี่ยนสถานะเครื่อง** (ติดตั้ง package, สร้าง/แก้ systemd service,
เปิด network port, ดึงโมเดลขนาดใหญ่, แก้ docker volume) ต้อง:

- บอกล่วงหน้าว่าจะแตะอะไร, ใช้ดิสก์/VRAM เท่าไหร่, rollback ยังไง
- **idempotent เสมอ** — สคริปต์ทุกตัวรันซ้ำได้ไม่พัง (เช็คก่อนติดตั้ง, `--reinstall` เฉพาะเมื่อสั่ง)
- งานที่ต้อง `sudo` → เครื่องนี้ **ต้องใส่รหัส** (ดู Notes #4) ห้าม assume รันได้เงียบ ๆ

### 3. Verify-after — ลงเสร็จต้องพิสูจน์ว่าใช้งานได้จริง

"เขียนสคริปต์เสร็จ" ≠ "เสร็จ". หลังติดตั้ง/แก้ ต้องรัน smoke test จริงแล้วรายงานผล:

- ลง Ollama → `ollama run <model> "พิมพ์ทดสอบ"` ได้คำตอบจริง
- ลง service → `systemctl --user is-active` = `active` + ดู log ไม่มี error
- เปิด port → `curl` เข้าจริงได้ response
- **ยังไม่ verify = งานยังไม่เสร็จ** ห้ามรายงานว่าเสร็จ

---

## 🤖 Model Assignment (เมื่อทำงาน *กับ repo นี้* ด้วย Claude Code)

> Guidance สำหรับเลือก `/model` — ไม่เกี่ยวกับโมเดล Ollama ที่ repo นี้ติดตั้ง
> (อันนั้นดู [docs/LOGIC_model-selection.md](docs/LOGIC_model-selection.md)).

| งาน | Model | ตัวอย่าง |
|---|---|---|
| ออกแบบสถาปัตยกรรม stack / แก้ปัญหาข้ามชั้น | `opus` | วาง topology Ollama↔WebUI↔OpenClaw, debug service ที่พังเป็นลูกโซ่, เลือก quant/offload |
| เขียน/แก้สคริปต์ติดตั้งตาม pattern เดิม | `sonnet` | เพิ่ม phase script, แก้ compose, เพิ่ม model ใน Modelfile |
| เอกสาร / commit msg / สรุป session | `haiku` | อัปเดต docs, README, CHANGELOG |
| ค้น/อ่าน/grep | `haiku` | หา config, ไล่ log |

```
/model opus     # architecture / cross-layer debug / VRAM-offload decisions
/model sonnet   # implement scripts / configs ตาม pattern
/model haiku    # docs / search / cleanup
```

---

## 🎯 Project Purpose

Local-first AI สำหรับงานของเจ้าของ 3 ด้าน — **Dev · เขียน/แปล/คอนเทนต์ · ธุรกิจ/ทั่วไป** —
โดยเน้น **ความเป็นส่วนตัว/ออฟไลน์** และ **ผู้ช่วยเขียนโค้ดที่ไม่เสียค่า API**.

3 ชั้นใช้ Ollama ตัวเดียวเป็นสมองร่วม:
- **Ollama** — engine รันโมเดล (GPU NVIDIA)
- **Open WebUI** — หน้าแชตแบบ ChatGPT (เขียน/แปล/คอนเทนต์)
- **Continue.dev** — ผู้ช่วยโค้ดใน VS Code/JetBrains (autocomplete + chat in-editor)
- **OpenClaw** — AI agent สั่งงานทั้งเครื่อง/มือถือ (สมองแบบ hybrid: cloud API งานหนัก + Ollama งานลับ)

ข้อจำกัดหลัก = **VRAM 6 GB** → ทุกการเลือกโมเดลอยู่ใต้ข้อจำกัดนี้ (ดู LOGIC_model-selection).

---

## 📚 Documentation Map

> Living Docs active (adapted from github.com/Diew/living-docs).
> Registry ทางการ = [docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md).
> **งานจัดการเอกสาร / scope ไม่ชัด → เปิดไฟล์ governance ก่อน.**

| File | Role | What's inside |
|---|---|---|
| [README.md](README.md) | Public overview | repo คืออะไร, quick start, โครงสร้าง |
| [ROADMAP.md](ROADMAP.md) | `REFACTOR_TODO` | **แผน Phase A–D** + ขั้นตอน + งานในอนาคต |
| [DECISIONS.md](DECISIONS.md) | `LOGIC_` index | Decision index (one-line + เหตุผล) — อย่า second-guess |
| [GOTCHAS.md](GOTCHAS.md) | `INCIDENT_` | ปัญหาที่เคยเจอจริง (IPv6, VRAM OOM ฯลฯ) + วิธีแก้ |
| [CHANGELOG.md](CHANGELOG.md) | Completed log | งานที่ทำเสร็จแล้ว เรียงตามวัน |
| [docs/ARCH_stack-overview.md](docs/ARCH_stack-overview.md) | `ARCH_` | สถาปัตยกรรม: 4 ชั้นต่อกันยังไง, port, data flow |
| [docs/LOGIC_model-selection.md](docs/LOGIC_model-selection.md) | `LOGIC_` | เลือกโมเดลตามงาน + ตรรกะ VRAM 6 GB / offload |
| [docs/GUIDE_conventions.md](docs/GUIDE_conventions.md) | `GUIDE_` | มาตรฐานเขียนสคริปต์/config + commit + naming |
| [docs/REF_commands.md](docs/REF_commands.md) | `REF_` | คำสั่ง ops ประจำวัน (ollama / docker / systemd) |
| [docs/REF_cloudflare-tunnel.md](docs/REF_cloudflare-tunnel.md) | `REF_` | expose `ai.dojojin.tech` ผ่าน tunnel เดิม + Cloudflare Access |
| [docs/REF_1password.md](docs/REF_1password.md) | `REF_` | secrets ที่เก็บใน 1Password + วิธี restore บนเครื่องใหม่ |
| **[docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md)** | **Registry** | **registry · naming · canonical ownership · maintenance** |

### Task → Load (quick reference)

| Task | Load |
|---|---|
| งานทั่วไป | `CLAUDE.md` only |
| ติดตั้ง/รัน phase | + `ROADMAP.md` + `scripts/` ที่เกี่ยว |
| เลือก/เพิ่มโมเดล | + `docs/LOGIC_model-selection.md` |
| สถาปัตยกรรม / port / data flow | + `docs/ARCH_stack-overview.md` |
| เขียนสคริปต์ใหม่ | + `docs/GUIDE_conventions.md` |
| Debug / ของพัง | + `GOTCHAS.md` + `docs/REF_commands.md` |
| คำสั่งรันประจำวัน | + `docs/REF_commands.md` |
| Expose ออกเน็ต / `ai.dojojin.tech` | + `docs/REF_cloudflare-tunnel.md` |
| จัดการเอกสาร / scope ไม่ชัด | `docs/ARCH_documentation-governance.md` |

**Memory pointer:** `~/.claude/projects/-home-kiseki/memory/MEMORY.md` เก็บ feedback/preference ข้ามเซสชัน
(machine profile, IPv6-force-IPv4, rclone Google Drive).

---

## 🤖 Notes for AI Assistants

1. **เจ้าของเป็น technical + pragmatic** — โชว์โค้ด/คำสั่งที่รันได้ก่อน อธิบายทีหลัง. ใช้ตาราง. ไม่ต้องอธิบายพื้นฐาน.

2. **ภาษา:** เจ้าของพิมพ์ไทย ศัพท์เทคนิคอังกฤษ → ตอบไทย + โค้ด/keyword อังกฤษ. ถ้าไม่ชัด ถาม **ทีละคำถามเดียว**.

3. **🔵 Fact / 🟡 Opinion** — แยกทุกครั้งที่นำเสนอผลตรวจสอบ (Working Agreement #1).

4. **`sudo` ต้องใส่รหัสบนเครื่องนี้** — รันเงียบ ๆ ไม่ได้. ทางเลือก: ให้เจ้าของรันใน Konsole เอง, หรือ
   `echo "$PW" | sudo -S -p ''` ด้วยรหัสที่ให้มาในเซสชัน. **ห้าม persist รหัส sudo ลง memory.**

5. **IPv6 ใช้ไม่ได้ → บังคับ IPv4** — เครื่องนี้มี IPv6 แต่ไม่มี route ออก. เครื่องมือ network ที่ลอง IPv6
   ก่อนจะค้าง. rclone ใช้ `--bind 0.0.0.0`; ระวังจุดนี้กับ OpenClaw / curl / ดึงโมเดล. (GOTCHAS #1)

6. **VRAM 6 GB คือเพดาน** — โมเดล >6 GB ต้อง offload ลง RAM (ช้าลงมาก). อย่าแนะนำโมเดล 27B+ ให้รัน interactive.
   ดู `docs/LOGIC_model-selection.md` ก่อนเสนอโมเดลใหม่. (decision #5)

7. **OpenClaw = สิทธิ์สูง ต้องระวัง** — รันเชลล์/อ่านไฟล์/ส่งข้อความแทนเจ้าของได้จริง.
   default ให้ **จำกัดสิทธิ์ + ไม่เปิดช่องแชตสาธารณะแบบไม่มี allowlist**. งาน agent หนักใช้ cloud API,
   งานลับ/ออฟไลน์ชี้ไป Ollama local (hybrid brain — decision #7).

8. **สคริปต์ต้อง idempotent** — รันซ้ำไม่พัง. เช็คก่อนติดตั้งทุกครั้ง (Working Agreement #2).

9. **Commits:** ไม่ใส่ `Co-Authored-By` trailer (เจ้าของต้องการ sole authorship). **ห้าม push เองโดยไม่สั่ง.**

10. **มี cloudflared tunnel อยู่แล้วบน host** (`cloudflared-dojojin.service`, repo `dojojin-site`) —
    expose ออกเน็ตด้วยการ **เพิ่ม ingress rule ใน tunnel เดิม** (`ai.dojojin.tech → :3000`) อย่าเปิด
    container ซ้ำ (tunnel ชนกัน → 502). DNS + Cloudflare Access มีแล้ว. (GOTCHAS #2, decision #12–#13,
    `docs/REF_cloudflare-tunnel.md`)

---

<sub>End of CLAUDE.md · ai-stack · Living Docs governance adapted from vigil-platform · Init 2026-06-01</sub>
