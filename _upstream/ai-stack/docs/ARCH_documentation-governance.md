# ARCH_documentation-governance — ai-stack

> **Doc Registry & Governance** — single source of truth สำหรับการจัดการเอกสารใน repo นี้.
> ทุกไฟล์: มันเป็นเจ้าของอะไร, ห้ามมีอะไร, โหลดเมื่อไหร่.
>
> Living Docs system adapted from: https://github.com/Diew/living-docs
> ปรับจาก `vigil-platform/docs/ARCH_documentation-governance.md` ให้เข้ากับ repo เล็ก (infra/single-owner).
> Init: 2026-06-01

---

## Registry Table

ทุกไฟล์ที่ agent ควรรู้จัก. ถ้าไฟล์ไม่อยู่ในตารางนี้ = ไม่มีอยู่สำหรับ agent.

| File | Living Docs Role | Owns | Must NOT contain | Load when |
|---|---|---|---|---|
| `CLAUDE.md` | Entry point | Session rules, working agreement, model assignment, doc map | รายละเอียดติดตั้งเต็ม ๆ, เหตุผล decision เต็ม, คำสั่ง ops ยาว ๆ | ทุกเซสชัน — อ่านก่อน |
| `README.md` | Public overview | repo คืออะไร, quick start, โครงสร้างโฟลเดอร์ | กฎภายใน, เหตุผล decision, คำสั่ง ops ละเอียด | คำถามภาพรวม, เริ่มใหม่ |
| `ROADMAP.md` | `REFACTOR_TODO` | แผน Phase A–D, ขั้นตอน, งานในอนาคต | งานที่เสร็จแล้ว (→ CHANGELOG), เหตุผลเชิงลึก (→ DECISIONS) | วางแผน, เลือกงานถัดไป |
| `DECISIONS.md` | `LOGIC_` index | Decision index #1–#n (สรุปบรรทัดเดียว + เหตุผลสั้น) | rationale ยาว, คำสั่ง, สเปคโมเดลละเอียด | lookup ว่าตัดสินใจอะไรไว้ |
| `GOTCHAS.md` | `INCIDENT_` | ปัญหาจริงที่เคยเจอ: อาการ / root cause / fix / บทเรียน | เหตุผล design (→ DECISIONS), คำสั่งทั่วไป (→ REF) | debug, ก่อนแตะระบบที่เคยพัง |
| `CHANGELOG.md` | Completed log | งานที่ทำเสร็จ เรียงตามวัน/เวอร์ชัน | งานค้าง (→ ROADMAP), เหตุผล (→ DECISIONS) | "ทำอะไรไปแล้วบ้าง" |
| `docs/ARCH_stack-overview.md` | `ARCH_` | สถาปัตยกรรม 4 ชั้น, port map, data flow, service ↔ service | วิธีติดตั้ง (→ scripts/ROADMAP), เหตุผลเลือกโมเดล (→ LOGIC) | คำถามสถาปัตยกรรม, port ชนกัน, onboarding |
| `docs/LOGIC_model-selection.md` | `LOGIC_` | ตรรกะเลือกโมเดลตามงาน + เพดาน VRAM 6 GB + offload + quant | คำสั่ง `ollama pull` ดิบ ๆ (→ REF), สถาปัตยกรรม (→ ARCH) | เลือก/เพิ่ม/เปลี่ยนโมเดล, ปรับ quant |
| `docs/GUIDE_conventions.md` | `GUIDE_` | มาตรฐานเขียนสคริปต์/config, commit, naming, idempotency | feature logic, ค่า runtime จริง | เขียนสคริปต์/ไฟล์ใหม่ |
| `docs/REF_commands.md` | `REF_` | คำสั่ง ops ประจำวัน (ollama/docker/systemd/curl) | เหตุผล design (→ LOGIC), troubleshooting เชิงลึก | รันงานประจำวัน, จำคำสั่งไม่ได้ |
| `docs/REF_cloudflare-tunnel.md` | `REF_` | expose `ai.dojojin.tech` ผ่าน tunnel เดิม: ingress rule, Access, verify, cross-repo sync | สร้าง tunnel ใหม่/container (ห้าม — GOTCHAS #2), config ของ dojojin-site เต็ม ๆ | เปิด/แก้ expose ออกเน็ต, debug tunnel/Access |
| `docs/ARCH_documentation-governance.md` | Registry (ไฟล์นี้) | registry, naming convention, canonical ownership, maintenance rules | feature logic, คำสั่ง, decision | จัดการเอกสาร, เพิ่มไฟล์, scope ไม่ชัด |

---

## Task → Load Mapping

| Task | Files to load |
|---|---|
| งานทั่วไป | `CLAUDE.md` only |
| ติดตั้ง / รัน phase A–D | + `ROADMAP.md` + `scripts/` ที่เกี่ยว |
| สถาปัตยกรรม / port / data flow | + `docs/ARCH_stack-overview.md` |
| เลือก / เพิ่ม / เปลี่ยนโมเดล | + `docs/LOGIC_model-selection.md` |
| เขียนสคริปต์ / config ใหม่ | + `docs/GUIDE_conventions.md` |
| Debug / ของพัง / incident | + `GOTCHAS.md` + `docs/REF_commands.md` |
| คำสั่งรันประจำวัน | + `docs/REF_commands.md` |
| Expose ออกเน็ต / Cloudflare tunnel / `ai.dojojin.tech` | + `docs/REF_cloudflare-tunnel.md` |
| วางแผน / งานถัดไป | + `ROADMAP.md` |
| "ทำอะไรไปแล้วบ้าง" | + `CHANGELOG.md` |
| เพิ่ม / ย้ายเอกสาร | `docs/ARCH_documentation-governance.md` (ไฟล์นี้) |
| Scope ไม่ชัด | `docs/ARCH_documentation-governance.md` ก่อน |

---

## Canonical Ownership

หนึ่งไฟล์เป็นเจ้าของหนึ่งกฎ. ห้ามให้กฎเดียวกันปรากฏเต็ม ๆ ในหลายไฟล์. **Link — อย่า copy.**

| Rule Area | Canonical File |
|---|---|
| Session rules, working agreement, model assignment | `CLAUDE.md` |
| ภาพรวม repo, quick start | `README.md` |
| แผนงาน, phase, งานในอนาคต | `ROADMAP.md` |
| การตัดสินใจ (index + เหตุผลสั้น) | `DECISIONS.md` |
| ปัญหา/incident จริง + วิธีแก้ | `GOTCHAS.md` |
| สถาปัตยกรรม, topology, port | `docs/ARCH_stack-overview.md` |
| ตรรกะเลือกโมเดล, VRAM/offload | `docs/LOGIC_model-selection.md` |
| มาตรฐานเขียนโค้ด/สคริปต์ | `docs/GUIDE_conventions.md` |
| คำสั่ง ops, snippet | `docs/REF_commands.md` |
| Expose ออกเน็ต, Cloudflare tunnel ingress, Access | `docs/REF_cloudflare-tunnel.md` |
| Doc registry | `docs/ARCH_documentation-governance.md` |

---

## STUBBORN_FACT Index

การตัดสินใจที่ **ห้ามกลับด้านโดยไม่ได้รับอนุมัติจากเจ้าของ**.

> `STUBBORN_FACT`: เครื่องนี้ IPv6 ไม่มี route ออก — เครื่องมือ network ต้องบังคับ IPv4
> (rclone `--bind 0.0.0.0`). GOTCHAS #1, decision #2.

> `STUBBORN_FACT`: VRAM = 6 GB เป็นเพดานแข็ง. โมเดล daily-driver ต้อง fit GPU เกือบเต็มที่ Q4
> (≤8B). โมเดล >6 GB = offload ลง RAM ยอมรับว่าช้า ใช้เฉพาะงานไม่ interactive. decision #5.

> `STUBBORN_FACT`: OpenClaw รันด้วยสิทธิ์จำกัด + ไม่เปิดช่องแชตสาธารณะแบบไม่มี allowlist.
> สมองแบบ hybrid (cloud API งานหนัก / Ollama งานลับ). decision #7.

> `STUBBORN_FACT`: ห้ามเปิด cloudflared container ใน compose ของ repo นี้ — host มี
> `cloudflared-dojojin.service` อยู่แล้ว, tunnel เดียวกันเปิดซ้ำ = split-brain 502. GOTCHAS #2.

> `STUBBORN_FACT`: สคริปต์ติดตั้งทุกตัวต้อง idempotent (เช็คก่อนทำ, รันซ้ำไม่พัง). decision #4.

> `STUBBORN_FACT`: `ai.dojojin.tech` ออกเน็ตด้วยการ **เพิ่ม ingress rule ใน tunnel เดิม**
> (`config-host.yml` → `http://127.0.0.1:3000`) ไม่ใช่สร้าง tunnel/container ใหม่. DNS + Cloudflare
> Access มีอยู่แล้ว. decision #12–#13, REF_cloudflare-tunnel.md.

---

## Naming Convention

| Prefix | Role | Example |
|---|---|---|
| `ARCH_` | Structure — สถาปัตยกรรม, data flow | `ARCH_stack-overview.md` |
| `LOGIC_` | Behavior — ตรรกะ/กฎการเลือก | `LOGIC_model-selection.md` |
| `GUIDE_` | Standards — วิธีเขียนโค้ด/สคริปต์ | `GUIDE_conventions.md` |
| `REF_` | Facts — lookup, คำสั่ง, ตาราง | `REF_commands.md` |
| `INCIDENT_` | History — post-mortem (ถ้า GOTCHAS โตจนต้องแยก) | (future) `INCIDENT_*.md` |
| `REFACTOR_TODO` | Work plan — รายการงาน | `ROADMAP.md` |

**Fixed names (ห้าม rename):**

| File | Why locked |
|---|---|
| `CLAUDE.md` | Claude Code อ่านชื่อนี้ตาม convention |
| `README.md` | GitHub convention |

---

## Maintenance Rules

### เพิ่มเอกสารใหม่
1. เลือก prefix จากตาราง naming convention.
2. สร้างไฟล์ใน `docs/` (หรือ root ถ้าเป็นชื่อ fixed).
3. **ลงทะเบียนในไฟล์นี้** (registry + task→load + canonical ownership) **ก่อนใช้งาน**.
4. ถ้าเนื้อหามาจากการแยกไฟล์เดิม → อัปเดต cross-reference ในไฟล์ต้นทาง.

### ย้ายเนื้อหาระหว่างไฟล์
1. copy ไปปลายทาง → ตรวจครบ → ลบจากต้นทาง → อัปเดต link.
2. ห้ามทิ้งกฎให้ลอยโดยไม่มี canonical owner.

### Doc update trigger
อัปเดตเอกสาร **เมื่อเจ้าของสั่ง** ไม่ใช่อัตโนมัติทุกครั้งหลังทำงาน:
- **Sync** — แก้ไฟล์ที่เป็นเจ้าของ logic ที่เปลี่ยน
- **Register** — เพิ่มไฟล์ใหม่เข้า registry นี้
- **Enforce** — ย้ายกฎที่วางผิดที่ไปไฟล์เจ้าของ, ลบของซ้ำ

### Size rule
ไฟล์เกิน ~300 บรรทัด + มีหลายเรื่องปนกัน → **แยก**.
Trigger = งานแตะแค่ section เดียวแต่ต้องโหลดทั้งไฟล์.

---

## Future Doc Candidates

| Planned file | Would own | Trigger |
|---|---|---|
| `docs/LOGIC_openclaw-skills.md` | skill/agent ที่ตั้งไว้ใน OpenClaw + เหตุผล | เมื่อเริ่มทำ Phase D จริง |
| `docs/REF_openwebui-prompts.md` | prompt/persona สำเร็จรูปใน Open WebUI (แปล/สรุป/เขียน) | เมื่อ prompt library โตขึ้น |
| `docs/INCIDENT_*.md` | post-mortem แยก ถ้า GOTCHAS เกิน 300 บรรทัด | เมื่อ GOTCHAS โตเกิน |

---

*Init 2026-06-01 · ai-stack · Living Docs adapted from github.com/Diew/living-docs (via vigil-platform)*
