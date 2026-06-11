#!/usr/bin/env bash
# ai-stack — เปิด Open WebUI ออกเน็ตที่ ai.dojojin.tech ผ่าน tunnel ที่มีอยู่แล้ว
# (ทำหลัง Phase B — ต้องมี Open WebUI ที่ :3000 ก่อน)
# ดู docs/REF_cloudflare-tunnel.md · GOTCHAS #2 · decision #12
#
# หลักการ: เพิ่ม ingress rule บรรทัดเดียวใน tunnel เดิม — ไม่สร้าง tunnel ใหม่/ไม่เปิด container
set -euo pipefail
source "$(dirname "$0")/lib.sh"

CFG="$HOME/.cloudflared/config-host.yml"
HOST_AI="ai.dojojin.tech"
TARGET="http://127.0.0.1:3000"     # Open WebUI (Phase B)
SERVICE="cloudflared-dojojin.service"

log_step "เปิด $HOST_AI -> Open WebUI ($TARGET) ผ่าน tunnel เดิม"

# 0) prerequisite
[ -f "$CFG" ] || die "ไม่พบ $CFG — tunnel ยังไม่ได้ติดตั้ง (ดู dojojin-site/deploy/install-tunnel.sh)"
have_cmd cloudflared || die "ไม่พบ cloudflared"
if ! curl4 -o /dev/null --max-time 3 "$TARGET" >/dev/null 2>&1; then
  log_warn "Open WebUI ที่ $TARGET ยังไม่ตอบ — รัน Phase B ก่อน ไม่งั้นจะ 502 หลังเปิด"
fi

# 1) เพิ่ม ingress rule (idempotent) — แทรกก่อน catch-all http_status:404
if grep -q "$HOST_AI" "$CFG"; then
  log_ok "ingress $HOST_AI มีอยู่แล้วใน config ข้าม"
else
  bak="$CFG.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$CFG" "$bak"
  log_ok "สำรอง config -> $bak"
  tmp="$(mktemp)"
  awk -v h="$HOST_AI" -v s="$TARGET" '
    /http_status:[[:space:]]*404/ && !ins {
      print "  - hostname: " h
      print "    service: " s
      print ""
      ins=1
    }
    { print }
    END { if (!ins) { print "  ERROR: ไม่พบ catch-all 404" > "/dev/stderr"; exit 3 } }
  ' "$bak" > "$tmp" || { rm -f "$tmp"; die "แทรก ingress ไม่สำเร็จ (ไม่พบ catch-all)"; }
  mv "$tmp" "$CFG"
  log_ok "เพิ่ม ingress $HOST_AI -> $TARGET"
fi

# 2) validate config ก่อน restart (กัน config พังแล้ว dojojin.tech ล่มตาม)
log_step "validate config"
cloudflared --config "$CFG" tunnel ingress validate || die "config ไม่ผ่าน validate — ไม่ restart"
log_ok "config ผ่าน"

# 3) restart service (ต้อง sudo) — กระทบ dojojin.tech แวบเดียว
log_warn "restart $SERVICE จะทำให้ dojojin.tech สะดุด ~1-2 วิ"
need_sudo
sudo systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" && log_ok "$SERVICE: active" || die "$SERVICE ไม่ขึ้นหลัง restart"

# 4) Verify
echo
log_step "Verify"
log_step "ตรวจ tunnel ส่ง $HOST_AI ถูกปลายทาง:"
cloudflared --config "$CFG" tunnel ingress rule "https://$HOST_AI" 2>/dev/null || true
echo
cat <<EOF
  - dojojin.tech ยังปกติ:   curl -4 -sI https://dojojin.tech | head -1   (คาดหวัง 200)
  - ai.dojojin.tech:        เปิดในเบราว์เซอร์ -> ผ่าน Cloudflare Access login -> เจอ Open WebUI
    (ไม่ใช่ 404 อีกต่อไป; ถ้า 502 = Open WebUI ยังไม่รัน -> Phase B)

หมายเหตุ sync: canonical config อยู่ใน repo dojojin-site/deploy/cloudflared-config-host.yml
  -> ถ้าจะให้ถาวร อัปเดตบรรทัด ingress เดียวกันที่นั่นด้วย แล้ว commit (คนละ repo)
EOF
log_ok "เสร็จ — ai.dojojin.tech ชี้เข้า Open WebUI (กันด้วย Cloudflare Access อยู่แล้ว)"
