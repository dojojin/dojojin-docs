#!/usr/bin/env bash
# ai-stack — shared helpers. source นี้ในทุก phase script.
# ดู docs/GUIDE_conventions.md

set -euo pipefail

# ---- logging ----
_c_reset=$'\033[0m'; _c_blue=$'\033[34m'; _c_green=$'\033[32m'; _c_yellow=$'\033[33m'; _c_red=$'\033[31m'
log_step() { printf '%s\n' "${_c_blue}==>${_c_reset} $*"; }
log_ok()   { printf '%s\n' "${_c_green}  ✓${_c_reset} $*"; }
log_warn() { printf '%s\n' "${_c_yellow}  ! ${_c_reset} $*"; }
log_err()  { printf '%s\n' "${_c_red}  ✗${_c_reset} $*" >&2; }
die()      { log_err "$*"; exit 1; }

# ---- guards ----
have_cmd() { command -v "$1" >/dev/null 2>&1; }

require_cmd() { have_cmd "$1" || die "ต้องมี '$1' ก่อน — $2"; }

# ---- network: บังคับ IPv4 เสมอ (GOTCHAS #1) ----
# ใช้แทน curl ดิบ
curl4() { curl -4 --fail --silent --show-error --location "$@"; }

# ดึงไฟล์/สคริปต์ผ่าน IPv4
fetch() { curl4 "$@"; }

# ---- sudo: เครื่องนี้ต้องใส่รหัส (machine-nobara-kde memory) ----
# เตือนผู้ใช้ว่าจะมีการขอรหัส ไม่ assume เงียบ
need_sudo() {
  if [ "$(id -u)" -eq 0 ]; then return 0; fi
  log_warn "ขั้นตอนนี้ต้องใช้ sudo — เครื่องนี้จะถามรหัสผ่าน"
  sudo -v || die "sudo ไม่ผ่าน"
}

# ---- ollama helpers ----
OLLAMA_HOST_DEFAULT="127.0.0.1:11434"
ollama_up() { curl4 "http://${OLLAMA_HOST_DEFAULT}/api/tags" >/dev/null 2>&1; }

# pull โมเดลถ้ายังไม่มี (idempotent)
ollama_pull_if_missing() {
  local model="$1"
  if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$model"; then
    log_ok "โมเดล $model มีแล้ว ข้าม"
  else
    log_step "ดึงโมเดล $model ..."
    ollama pull "$model"
    log_ok "ดึง $model เสร็จ"
  fi
}

# ---- disk ----
free_gb_on() { df -BG --output=avail "$1" 2>/dev/null | tail -1 | tr -dc '0-9'; }
