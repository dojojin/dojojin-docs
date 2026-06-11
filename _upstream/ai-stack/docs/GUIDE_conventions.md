# GUIDE_conventions — ai-stack

> มาตรฐานการเขียนสคริปต์/config ใน repo นี้.
> โหลดเมื่อ: เขียนสคริปต์/ไฟล์ใหม่.

---

## Shell scripts

ทุกสคริปต์ใน `scripts/`:

1. **Shebang + strict mode + source lib:**
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   source "$(dirname "$0")/lib.sh"
   ```
2. **Idempotent เสมอ** (decision #4) — เช็คก่อนทำทุกครั้ง:
   ```bash
   if have_cmd ollama; then log_ok "ollama มีแล้ว ข้าม"; else install_ollama; fi
   ```
3. **บังคับ IPv4** ทุกการเรียกเน็ต (GOTCHAS #1) — ใช้ `curl -4`, rclone `--bind 0.0.0.0`
4. **ไม่ assume sudo เงียบ** — ถ้าต้อง root ให้แจ้งผู้ใช้ก่อน (เครื่องนี้ sudo ต้องใส่รหัส)
5. **`log_*` แทน `echo` ดิบ** — ใช้ helper จาก `lib.sh` (`log_step / log_ok / log_warn / log_err`)
6. **ทุกสคริปต์จบด้วย "Verify"** — พิมพ์คำสั่งตรวจผล หรือรันให้เลย (Working Agreement #3)
7. **อย่าใช้ `pkill -f` pattern กว้าง** (GOTCHAS #3) — ใช้ `pkill -x` หรือ kill ทีละ PID

## Naming

| สิ่งของ | รูปแบบ | ตัวอย่าง |
|---|---|---|
| phase script | `phase-<letter>-<topic>.sh` | `phase-a-ollama.sh` |
| helper | `lib.sh` | — |
| Modelfile | `<Name>.Modelfile` | `ChindaMT-4B.Modelfile` |
| docs | `<PREFIX>_<topic>.md` | `LOGIC_model-selection.md` |

## Config files

- เก็บใน `config/` (เช่น Continue), `compose/` (docker), `models/` (Modelfile)
- สคริปต์ที่ install config → **ไม่ทับของเดิม** ถ้ามีอยู่ (backup ก่อน หรือข้าม + แจ้ง)
- ค่า secret/token → **ห้าม** commit. ใช้ `.env` (gitignored) + `.env.example` เป็นแม่แบบ

## Commits

- ข้อความ commit: สรุปสั้น ภาษาไทยได้, ขึ้นต้นด้วย scope เช่น `phase-a: ...`, `docs: ...`
- **ไม่ใส่** `Co-Authored-By` trailer (เจ้าของต้องการ sole authorship)
- **ห้าม push** เองโดยไม่ได้รับคำสั่ง

## Docs

- ทำตาม Living Docs governance (`docs/ARCH_documentation-governance.md`)
- ไฟล์ใหม่ → ลงทะเบียนใน registry **ก่อนใช้**
- หนึ่งไฟล์ = หนึ่งเจ้าของกฎ, link อย่า copy
- ไฟล์เกิน ~300 บรรทัด + หลายเรื่อง → แยก

---

*ai-stack · GUIDE_conventions · init 2026-06-01*
