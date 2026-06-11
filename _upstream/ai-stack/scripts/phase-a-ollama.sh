#!/usr/bin/env bash
# ai-stack — Phase A: Ollama + โมเดลหลัก
# ดู ROADMAP.md → Phase A
set -euo pipefail
source "$(dirname "$0")/lib.sh"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

log_step "Phase A — Ollama + โมเดลหลัก"

# 1) ติดตั้ง Ollama (idempotent)
if have_cmd ollama; then
  log_ok "Ollama มีแล้ว: $(ollama --version 2>/dev/null | head -1)"
else
  log_step "ติดตั้ง Ollama (official script, IPv4)"
  need_sudo
  # official installer; curl4 บังคับ IPv4 กัน IPv6 ค้าง (GOTCHAS #1)
  curl4 https://ollama.com/install.sh | sh
  have_cmd ollama || die "ติดตั้ง Ollama ไม่สำเร็จ"
  log_ok "ติดตั้ง Ollama เสร็จ"
fi

# 2) service ทำงาน
if systemctl is-active --quiet ollama 2>/dev/null; then
  log_ok "service ollama: active"
else
  log_step "เปิด service ollama"
  need_sudo
  sudo systemctl enable --now ollama
fi

# 3) รอ API ขึ้น
log_step "รอ Ollama API (${OLLAMA_HOST_DEFAULT}) ..."
for _ in $(seq 1 20); do ollama_up && break; sleep 1; done
ollama_up || die "Ollama API ไม่ตอบที่ ${OLLAMA_HOST_DEFAULT}"
log_ok "Ollama API ตอบแล้ว"

# 4) เช็ค GPU ที่ Ollama เห็น
if journalctl -u ollama --no-pager 2>/dev/null | grep -qi 'library=cuda'; then
  log_ok "Ollama เห็น GPU (cuda)"
else
  log_warn "ไม่เห็น 'library=cuda' ใน log — อาจรันบน CPU ล้วน ตรวจ nvidia driver"
fi

# 5) ดึงโมเดลชุดเริ่มต้น (decision #6) — idempotent
ollama_pull_if_missing "qwen2.5-coder:7b"   # โค้ด-chat หลัก
ollama_pull_if_missing "qwen2.5-coder:3b"   # autocomplete
ollama_pull_if_missing "qwen2.5:7b"         # เขียน/แปล/คอนเทนต์

# 6) (ออปชัน) โมเดลแปลไทย ChindaMT ถ้ามีไฟล์ gguf อยู่ข้าง Modelfile
MF="$REPO_DIR/models/ChindaMT-4B.Modelfile"
if [ -f "$MF" ]; then
  gguf=$(grep -E '^FROM ' "$MF" | awk '{print $2}')
  if [ -f "$REPO_DIR/models/$(basename "$gguf")" ] || [ -f "$gguf" ]; then
    if ollama list | awk '{print $1}' | grep -qx 'chinda-mt:latest'; then
      log_ok "โมเดล chinda-mt มีแล้ว ข้าม"
    else
      log_step "สร้างโมเดลแปลไทย chinda-mt จาก Modelfile"
      ( cd "$REPO_DIR/models" && ollama create chinda-mt -f "$(basename "$MF")" )
    fi
  else
    log_warn "ข้าม chinda-mt — ไม่พบไฟล์ gguf ($gguf). วาง .gguf ใน models/ แล้วรันซ้ำ"
  fi
fi

# 7) Verify (Working Agreement #3)
echo
log_step "Verify"
ollama list
log_step "ทดสอบ inference จริง:"
ollama run qwen2.5-coder:7b "เขียนฟังก์ชัน fizzbuzz ใน Python สั้น ๆ" || log_warn "inference ทดสอบไม่ผ่าน"
echo
log_ok "Phase A เสร็จ — ไปต่อ Phase B (./scripts/phase-b-webui-continue.sh)"
