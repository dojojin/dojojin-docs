#!/usr/bin/env bash
# ai-stack — Preflight: เช็คความพร้อมเครื่องก่อนติดตั้งเฟสใด ๆ
# ดู ROADMAP.md
set -euo pipefail
source "$(dirname "$0")/lib.sh"

log_step "Preflight — ตรวจความพร้อมเครื่อง"
fail=0

# 1) GPU / NVIDIA driver
if have_cmd nvidia-smi && nvidia-smi >/dev/null 2>&1; then
  vram=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1)
  gpu=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
  log_ok "GPU: $gpu (VRAM ${vram} MiB)"
  if [ "${vram:-0}" -lt 5000 ]; then
    log_warn "VRAM < 5 GB — เลือกโมเดลเล็กลง (ดู docs/LOGIC_model-selection.md)"
  fi
else
  log_err "ไม่พบ nvidia-smi / GPU ใช้ไม่ได้ — ติดตั้ง NVIDIA driver ก่อน"
  fail=1
fi

# 2) ดิสก์ (โมเดลกินเยอะ) — ต้องการ ≥ 30 GB ที่ home
avail=$(free_gb_on "$HOME")
if [ "${avail:-0}" -ge 30 ]; then
  log_ok "ดิสก์ว่างที่ \$HOME: ${avail} GB"
else
  log_warn "ดิสก์ว่าง ${avail:-?} GB (<30 GB) — โมเดลหลายตัวอาจไม่พอ"
fi

# 3) RAM
ram=$(free -g | awk '/^Mem:/{print $2}')
log_ok "RAM: ${ram} GB"

# 4) เน็ตออกได้ (บังคับ IPv4 — GOTCHAS #1)
if curl4 -o /dev/null --max-time 10 https://ollama.com >/dev/null 2>&1; then
  log_ok "เน็ตออกได้ (IPv4)"
else
  log_warn "ดึง https://ollama.com ไม่ได้ใน 10s — เช็คเน็ต / IPv6 (GOTCHAS #1)"
fi

# 5) docker (เฟส B)
if have_cmd docker; then
  log_ok "docker: $(docker --version 2>/dev/null | head -1)"
else
  log_warn "ยังไม่มี docker — จำเป็นตอน Phase B (Open WebUI)"
fi

echo
if [ "$fail" -eq 0 ]; then
  log_ok "Preflight ผ่าน — พร้อมรัน phase-a-ollama.sh"
else
  die "Preflight ไม่ผ่าน — แก้รายการ ✗ ด้านบนก่อน"
fi
