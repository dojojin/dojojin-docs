#!/usr/bin/env bash
# ai-stack — Phase B: Open WebUI + Continue.dev config
# ดู ROADMAP.md → Phase B
set -euo pipefail
source "$(dirname "$0")/lib.sh"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

log_step "Phase B — Open WebUI + Continue.dev"

# 0) ต้องมี Ollama จาก Phase A
ollama_up || die "Ollama ยังไม่ขึ้น — รัน Phase A ก่อน"
require_cmd docker "ติดตั้ง docker ก่อน (Phase B ใช้ container)"

# 1) Open WebUI ผ่าน compose
COMPOSE="$REPO_DIR/compose/docker-compose.yml"
[ -f "$COMPOSE" ] || die "ไม่พบ $COMPOSE"
log_step "เปิด Open WebUI (docker compose)"
docker compose -f "$COMPOSE" up -d

# 2) รอ WebUI ขึ้น
log_step "รอ Open WebUI (http://localhost:3000) ..."
for _ in $(seq 1 30); do
  curl4 -o /dev/null --max-time 3 http://localhost:3000 >/dev/null 2>&1 && break
  sleep 2
done
if curl4 -o /dev/null --max-time 3 http://localhost:3000 >/dev/null 2>&1; then
  log_ok "Open WebUI ขึ้นแล้ว → http://localhost:3000 (สมัคร admin ครั้งแรก)"
else
  log_warn "WebUI ยังไม่ตอบ — ดู: docker compose -f $COMPOSE logs -f openwebui"
fi

# 3) ติดตั้ง Continue config (ไม่ทับของเดิม — GUIDE_conventions)
CONT_SRC="$REPO_DIR/config/continue-config.json"
CONT_DIR="$HOME/.continue"
CONT_DST="$CONT_DIR/config.json"
mkdir -p "$CONT_DIR"
if [ -f "$CONT_DST" ]; then
  log_warn "มี $CONT_DST อยู่แล้ว — ไม่ทับ. เทียบเองได้ที่ $CONT_SRC"
else
  cp "$CONT_SRC" "$CONT_DST"
  log_ok "วาง Continue config → $CONT_DST (autocomplete=qwen2.5-coder:3b, chat=:7b)"
fi

# 4) Verify
echo
log_step "Verify"
docker compose -f "$COMPOSE" ps
cat <<EOF

ขั้นตอน manual ที่เหลือ:
  1. เปิด http://localhost:3000 → สมัคร admin → เลือกโมเดล qwen2.5 → ลองแชต/แปล
  2. ติดตั้ง extension "Continue" ใน VS Code/JetBrains (จาก marketplace)
  3. ใน editor: Continue จะเห็นโมเดลจาก ~/.continue/config.json → ลอง autocomplete + Cmd/Ctrl+L chat
EOF
log_ok "Phase B เสร็จ — ไปต่อ Phase C (./scripts/phase-c-openclaw.sh)"
