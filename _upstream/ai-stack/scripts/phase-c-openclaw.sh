#!/usr/bin/env bash
# ai-stack — Phase C: OpenClaw (local brain, ปลอดภัยก่อน)
# ดู ROADMAP.md → Phase C · docs.openclaw.ai · github.com/openclaw/openclaw
# ยืนยันแล้ว 2026-06-01: npm install + config Ollama native API
set -euo pipefail
source "$(dirname "$0")/lib.sh"

log_step "Phase C — OpenClaw (local brain)"

# 0) prerequisite
ollama_up || die "Ollama ยังไม่ขึ้น — รัน Phase A ก่อน"
log_ok "Ollama พร้อม (provider ปลายทาง)"
require_cmd node "ต้องมี Node 22.19+ หรือ 24 (ดู nodejs.org)"
require_cmd npm  "ต้องมี npm"
node_major=$(node --version | tr -d 'v' | cut -d. -f1)
[ "$node_major" -ge 22 ] || die "Node ต้องเป็น v22.19+ หรือ 24 (ปัจจุบัน: $(node --version))"
log_ok "Node $(node --version) ✓"

# 1) ติดตั้ง OpenClaw (idempotent)
if have_cmd openclaw; then
  log_ok "openclaw มีแล้ว: $(openclaw --version 2>/dev/null | head -1)"
else
  log_step "ติดตั้ง openclaw@latest ผ่าน npm (IPv4 — GOTCHAS #1)"
  # NODE_OPTIONS บังคับ IPv4 ผ่าน dns.setDefaultResultOrder
  NODE_OPTIONS="--dns-result-order=ipv4first" npm install -g openclaw@latest
  have_cmd openclaw || die "ติดตั้ง openclaw ไม่สำเร็จ"
  log_ok "ติดตั้ง openclaw เสร็จ: $(openclaw --version 2>/dev/null | head -1)"
fi

# 2) วาง config (idempotent — ไม่ทับถ้ามีอยู่แล้ว)
CFG_DIR="$HOME/.openclaw"
CFG="$CFG_DIR/openclaw.json"
EXEC_CFG="$CFG_DIR/exec-approvals.json"
mkdir -p "$CFG_DIR"

if [ -f "$CFG" ]; then
  log_warn "มี $CFG อยู่แล้ว — ไม่ทับ เทียบเองได้ที่ scripts/phase-c-openclaw.sh"
else
  cat > "$CFG" << 'JSONEOF'
{
  "gateway": {
    "port": 18789,
    "bind": "loopback"
  },
  "models": {
    "providers": {
      "ollama": {
        "baseUrl": "http://127.0.0.1:11434",
        "apiKey": "ollama-local",
        "api": "ollama"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "ollama/qwen2.5-coder:7b" }
    }
  },
  "channels": {
    "telegram":  { "enabled": false },
    "discord":   { "enabled": false },
    "slack":     { "enabled": false },
    "whatsapp":  { "enabled": false },
    "imessage":  { "enabled": false },
    "matrix":    { "enabled": false }
  }
}
JSONEOF
  log_ok "วาง $CFG (Ollama provider + channels ปิดทั้งหมด)"
fi

if [ -f "$EXEC_CFG" ]; then
  log_warn "มี $EXEC_CFG อยู่แล้ว — ไม่ทับ"
else
  cat > "$EXEC_CFG" << 'JSONEOF'
{
  "security": "allowlist",
  "ask": "on-miss",
  "askFallback": "deny",
  "strictInlineEval": true
}
JSONEOF
  log_ok "วาง $EXEC_CFG (allowlist mode — ถามก่อนรัน command)"
fi

# 3) ติดตั้ง daemon + เริ่ม (idempotent)
log_step "ติดตั้ง daemon + เริ่ม OpenClaw gateway"
openclaw onboard --install-daemon --non-interactive 2>/dev/null \
  || openclaw daemon start 2>/dev/null \
  || log_warn "onboard/daemon อาจต้องรันด้วยมือ: 'openclaw onboard'"

# 4) Verify
echo
log_step "Verify"
openclaw doctor 2>/dev/null || log_warn "openclaw doctor มีปัญหา — ตรวจ log"
echo
log_ok "WebChat: http://127.0.0.1:18789/"
log_ok "ทดสอบ: openclaw chat \"สรุป README.md 3 บรรทัด\""
log_ok "ตรวจ model: openclaw models list --provider ollama"
echo
log_ok "Phase C เสร็จ — ไปต่อ Phase D (cloud API + LINE/Telegram, manual config)"
