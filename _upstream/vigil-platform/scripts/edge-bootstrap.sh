#!/usr/bin/env bash
# ============================================================
# Vigil Platform — ติดตั้ง edge ใหม่ครบทุกอย่างจากเครื่องเปล่า (Linux Mint 22 / Ubuntu 24.04 + openssh)
# @author Prakasit Rochanavipart (Dojo-mAn)
# @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
# @license Proprietary
# ------------------------------------------------------------
# ไฟล์เดียวจบ: รวมส่วนเครื่องมือผู้ดูแลของ setup-new-machine.sh (Claude Code · tmux · bashrc · SSH เข้าไซต์อื่น)
# เป็นข้อ 11 แบบเลือกได้ — ไม่ต้องรันไฟล์แยก
#
# ทำตามแบบ edge ที่รันจริงตอนนี้ (ตรวจกับ nrw/bma 2026-10-08):
#   Node 22 (NodeSource → /usr/bin/node) · pm2 + pm2-logrotate · Mosquitto 2.1 จาก PPA (systemd mask
#   รันใต้ pm2 ตาม ecosystem.edge.config.js) · cloudflared เป็น systemd อ่าน /etc/cloudflared/token ·
#   repo ~/vigil-platform ผ่าน git@github.com · cameras-config.json ที่ root ของ repo
#
# วิธีใช้ (บนเครื่อง edge ใหม่ ล็อกอินเป็น user ของ edge ไม่ใช่ root):
#   scp scripts/edge-bootstrap.sh <user>@<edge-ip>:~/     # repo ยังไม่มีบนเครื่องใหม่
#   bash ~/edge-bootstrap.sh              # ถามทีละข้อ สรุปให้ยืนยัน แล้วค่อยลงมือ
#   bash ~/edge-bootstrap.sh --dry-run    # แสดงคำสั่งทั้งหมด ไม่ทำจริง
#
# รันซ้ำได้ — ขั้นที่ทำแล้วจะข้าม · src/.env ที่มีอยู่แล้วจะถามก่อนเขียนทับ (สำรองไว้เสมอ)
# ความลับ (รหัส bridge / กุญแจ / token) รับแบบไม่แสดงบนจอ เขียนลงไฟล์ผ่าน stdin เท่านั้น
#   ไม่ผ่าน argv (ps มองเห็น) และไม่พิมพ์ออกมา
#
# สิ่งที่สคริปต์ทำแทนไม่ได้ (ทำบน central / Cloudflare ก่อน — สคริปต์จะพิมพ์รายการให้ตอนท้าย):
#   node scripts/provision-site.js <code> "<ชื่อ>"   ← ได้รหัส bridge (แสดงครั้งเดียว)
#   Zero Trust: tunnel + Public Hostname <code>.dojojin.tech → localhost:3003 (+ ssh<code> แบบ SSH)
# ============================================================
set -euo pipefail

DRY=0
exec 3<&0   # คำตอบทุกข้ออ่านจาก stdin ตัวจริง (fd 3) — put() ถูกเรียกพร้อม heredoc เป็น stdin
TS=$(date +%Y%m%d-%H%M%S)
[[ ${1:-} == --dry-run ]] && DRY=1

REPO_URL='git@github.com:dojojin/vigil-platform.git'
REPO="$HOME/vigil-platform"
KNOWN_SITES='hkt hdy vss rmutr-v nrw bma-edge'
# กุญแจสาธารณะของ vigil-central (deploy ทุกไซต์ ssh มาจากเครื่องนี้) — public key ไม่ใช่ความลับ
CENTRAL_PUBKEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIXOo3mXdlPGYk7mlcjU0rjmSprTu603mYjkee01DCJ3 vigilcentral-deploy'

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_dim=$'\e[2m'; c_b=$'\e[1m'; c_0=$'\e[0m'
step() { printf '\n%s━━ %s%s\n' "$c_b" "$*" "$c_0"; }
ok()   { printf '  %s✔%s %s\n' "$c_ok" "$c_0" "$*"; }
warn() { printf '  %s!%s %s\n' "$c_warn" "$c_0" "$*"; }
die()  { printf '%s⛔ %s%s\n' "$c_err" "$*" "$c_0" >&2; exit 1; }
run()  { if ((DRY)); then printf '  %s$ %s%s\n' "$c_dim" "$*" "$c_0"; else eval "$@"; fi; }
ask()  { local p=$1 d=${2:-} v; read -r -u 3 -p "  $p${d:+ [$d]}: " v; printf '%s' "${v:-$d}"; }
confirm() { local v; read -r -u 3 -p "  $1 [${2:-y}/n]: " v; v=${v:-${2:-y}}; [[ $v =~ ^[Yy] ]]; }
secret() {  # อ่านความลับเข้าตัวแปรชื่อ $1 โดยไม่แสดงบนจอ · ว่าง = ถามซ้ำ
  local name=$1 prompt=$2 v=''
  while [[ -z $v ]]; do read -r -u 3 -s -p "  $prompt: " v; echo; [[ -z $v ]] && warn 'ว่างไม่ได้'; done
  printf -v "$name" '%s' "$v"
}

# เขียนไฟล์จาก stdin · $2 = mode
#   ไม่มีไฟล์ → เขียน · ตรงกับของ central → ข้าม
#   ต่าง → แสดงส่วนต่างแล้วถาม (ค่าเริ่มต้น = ไม่ทับ — อาจเป็นของที่ปรับแต่งเองบนเครื่องนี้) · ทับ = สำรองก่อน
put() {
  local dst=$1 mode=${2:-644} tmp nd; tmp=$(mktemp); cat > "$tmp"
  if ((DRY)); then
    local st='ใหม่'
    [[ -f $dst ]] && { cmp -s "$tmp" "$dst" && st='ตรงอยู่แล้ว — ข้าม' || st='ต่างจากของ central — จะแสดงส่วนต่างแล้วถามก่อนทับ'; }
    printf '  %s$ (เขียน %s · mode %s · %s บรรทัด · %s)%s\n' "$c_dim" "$dst" "$mode" "$(wc -l < "$tmp")" "$st" "$c_0"
    rm -f "$tmp"; return
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ -f $dst ]]; then
    if cmp -s "$tmp" "$dst"; then ok "$dst ตรงอยู่แล้ว"; rm -f "$tmp"; chmod "$mode" "$dst"; return; fi
    warn "$dst ต่างจากของ central   (- = ของเดิมบนเครื่องนี้ · + = ของ central)"
    diff -u --label 'เดิม' --label 'central' "$dst" "$tmp" | sed -n '3,42p' | sed 's/^/      /' || true
    nd=$(diff "$dst" "$tmp" | grep -c '^[<>]' || true)
    ((nd > 40)) && echo "      … (ต่างกันทั้งหมด $nd บรรทัด — ดูเต็มด้วย diff หลังจบ)"
    if ! confirm "เขียนทับด้วยของ central (ของเดิมสำรองเป็น .bak-$TS)" n; then ok "คงไฟล์เดิมไว้: $dst"; rm -f "$tmp"; return; fi
    cp -p "$dst" "$dst.bak-$TS"; warn "สำรอง $dst → $dst.bak-$TS"
  fi
  install -m "$mode" "$tmp" "$dst"; rm -f "$tmp"; ok "เขียน $dst"
}
declare -A SEL=()
on() { [[ -n ${SEL[$1]:-} ]]; }

# ── 0. ตรวจเครื่อง ───────────────────────────────────────────
step '0. ตรวจเครื่อง'
[[ $EUID -ne 0 ]] || die 'อย่ารันด้วย root — ล็อกอินเป็น user ของ edge แล้วรัน (สคริปต์จะ sudo เองตามจังหวะ)'
. /etc/os-release
[[ ${UBUNTU_CODENAME:-$VERSION_CODENAME} == noble ]] || warn "ไม่ใช่ Ubuntu 24.04 base (${PRETTY_NAME}) — ทดสอบไว้กับ Mint 22 / Ubuntu noble เท่านั้น"
ok "$PRETTY_NAME · user $(id -un) · $(nproc) cores · $(free -g | awk '/Mem/{print $2}') GB RAM · ดิสก์ว่าง $(df -h "$HOME" | awk 'NR==2{print $4}')"
((DRY)) || sudo -v || die 'ต้องใช้ sudo ได้'

# ── 1. ถามข้อมูลไซต์ ─────────────────────────────────────────
step '1. ข้อมูลไซต์'
while :; do
  SITE=$(ask 'site code (a-z 0-9 - เช่น bkk1, cmx2)')
  [[ $SITE =~ ^[a-z0-9-]+$ ]] || { warn 'ใช้ได้แค่ a-z 0-9 และ -'; continue; }
  if [[ " $KNOWN_SITES " == *" $SITE "* ]]; then warn "\"$SITE\" มีอยู่แล้ว ($KNOWN_SITES) — ถ้าตั้งใจแทนเครื่องเดิมให้ยืนยัน"; confirm 'ใช้ชื่อนี้ต่อ' n || continue; fi
  break
done
SITE_NAME=$(ask 'ชื่อไซต์ (แสดงบน dashboard)' "$SITE")
NEW_HOST=$(ask 'hostname ของเครื่อง' "${SITE}-edge")

mapfile -t IPS < <(ip -4 -br addr | awk '$1!="lo" && $1!~/^(docker|br-|veth|tailscale)/ {split($3,a,"/"); print a[1]" ("$1")"}')
((${#IPS[@]})) || die 'ไม่พบ IPv4 บน interface ใดเลย — เสียบสาย LAN ก่อน'
echo '  IP บนเครื่องนี้:'; for i in "${!IPS[@]}"; do echo "    $((i+1))) ${IPS[$i]}"; done
while :; do
  n=$(ask 'เลือก IP ฝั่ง LAN กล้อง (เลขข้อ)' 1)
  [[ $n =~ ^[0-9]+$ ]] && (( n >= 1 && n <= ${#IPS[@]} )) && break
  warn "ตอบเป็นเลข 1–${#IPS[@]}"
done
LAN_IP=${IPS[$((n-1))]%% *}

HAS_BOSCH=0; HAS_HIKFACE=0; HAS_DAHUA=0; IS_HCP=0
confirm 'มีกล้อง Bosch ส่ง MQTT เข้าเครื่องนี้ไหม' n && HAS_BOSCH=1
confirm 'มีกล้อง Hikvision ส่งใบหน้าตรงเข้าเครื่องนี้ (พอร์ต 3010) ไหม' n && HAS_HIKFACE=1
confirm 'มีกล้อง Dahua ไหม' n && HAS_DAHUA=1
confirm 'ไซต์นี้ต่อ HikCentral Professional (HCP) ไหม' n && IS_HCP=1
FACE_ALLOW=''
((HAS_HIKFACE)) && FACE_ALLOW=$(ask 'IP กล้องใบหน้า Hik ที่ push เข้ามา (คั่นด้วย , )')
# FACE_PUSH_HOST: Hik ต้องการ IP เปล่า · Bosch ต้องการ IP:1883 (ขัดกันเอง — ดูหมายเหตุใน edge/env.template)
FACE_HOST=$LAN_IP; ((HAS_BOSCH && !HAS_HIKFACE)) && FACE_HOST="$LAN_IP:1883"
# บังคับรหัสบน LAN: กล้อง Bosch ยังไม่มีบัญชี broker จนกว่าจะกด "ส่งค่า MQTT" จาก dashboard
# ⇒ ไซต์ที่มี Bosch เริ่มแบบไม่บังคับก่อน (เหมือน E1) แล้วเปิดทีหลัง · ไม่มี Bosch = เปิดเลย (เหมือน nrw)
REQUIRE_AUTH=true; ((HAS_BOSCH)) && REQUIRE_AUTH=false

echo
echo '  ความลับ — พิมพ์แล้วไม่แสดงบนจอ:'
secret BRIDGE_PW   "รหัส bridge ของ edge-$SITE (จาก provision-site.js หรือ Settings › Sites บน central)"
secret CAM_KEY     'CAMERA_SECRET_KEY (คัดลอกจาก src/.env ของ central — ห้ามสร้างใหม่)'
secret SNAP_SECRET 'SNAPSHOT_PROXY_SECRET (คัดลอกจาก central — ห้ามสร้างใหม่)'
BL_KEY=''
((IS_HCP)) && secret BL_KEY 'BLACKLIST_SECRET_KEY (คัดลอกจาก central)'
secret TUNNEL_TOKEN 'Cloudflare tunnel token ของไซต์นี้ (Zero Trust › Networks › Tunnels)'
TS_KEY=''
if confirm 'ติดตั้ง Tailscale ด้วยไหม (ทางสำรองเข้าเครื่อง — edge ทุกตัวมี)' y; then
  read -r -u 3 -s -p '  Tailscale auth key ที่ผูก tag (ว่าง = ติดตั้งอย่างเดียว login เองทีหลัง): ' TS_KEY; echo
  DO_TS=1
else DO_TS=0; fi

echo
step 'เครื่องมือผู้ดูแลบนเครื่องนี้ (จาก setup-new-machine.sh)'
ADM=(claude  'Claude Code (native installer)'                                          y
     config  'Claude config: settings.json + statusline.sh'                            y
     tmux    '~/.tmux.conf (prefix Ctrl-a · แถบสถานะของ Claude)'                       y
     bashrc  '~/.bashrc: alias / fixterm / aptup (เพิ่มเป็นบล็อก ไม่ทับทั้งไฟล์)'       y
     ssh     'SSH: ~/.ssh/config.d/sites.conf เข้า central + edge 6 ไซต์ (+ service token)' n
     skills  'Skill ของผู้ใช้จากเครื่องหลัก (rsync จาก vigil-central — ต้องมี ssh ผ่านก่อน)' n
     sshtest 'ทดสอบ SSH เข้า edge ทั้ง 6 ไซต์'                                          n)
for ((i=0; i<${#ADM[@]}; i+=3)); do confirm "${ADM[i+1]}" "${ADM[i+2]}" && SEL[${ADM[i]}]=1; done
CF_ID=''; CF_SECRET=''
if on ssh && confirm 'ใส่ Cloudflare service token ตอนนี้ (ไม่ใส่ = ssh เข้า edge อื่นไม่ได้จนกว่าจะสร้างไฟล์เอง)' y; then
  read -r -u 3 -p '  Client ID (ลงท้าย .access): ' CF_ID
  read -r -s -u 3 -p '  Client Secret (ไม่แสดงบนจอ): ' CF_SECRET; echo
  [[ -n $CF_ID && -n $CF_SECRET ]] || { warn 'ว่าง — ข้ามการสร้างไฟล์ token'; CF_ID=''; CF_SECRET=''; }
fi

step 'สรุปก่อนลงมือ'
cat <<EOF
  site code            $SITE   (ชื่อ: $SITE_NAME)
  hostname             $NEW_HOST
  LAN IP               $LAN_IP
  Bosch MQTT / Hik face / Dahua / HCP   $HAS_BOSCH / $HAS_HIKFACE / $HAS_DAHUA / $IS_HCP
  FACE_PUSH_HOST       $FACE_HOST
  FACE_PUSH_ALLOW      ${FACE_ALLOW:-(ไม่ตั้ง)}
  EDGE_MQTT_REQUIRE_AUTH $REQUIRE_AUTH
  BRIDGE_USERNAME      edge-$SITE
  ความลับ              รับครบแล้ว (ไม่แสดง)
  Tailscale            $([[ $DO_TS == 1 ]] && echo "ติดตั้ง${TS_KEY:+ + login ด้วย auth key}" || echo ข้าม)
  เครื่องมือผู้ดูแล    $(echo ${!SEL[@]})
EOF
confirm 'ถูกต้อง เริ่มติดตั้ง' y || die 'ยกเลิก — ยังไม่ได้แตะอะไรในเครื่อง'

# ── 2. ระบบพื้นฐาน + กันเครื่องหลับ ───────────────────────────
step '2. ระบบพื้นฐาน'
run sudo hostnamectl set-hostname "$NEW_HOST"
run sudo apt-get update -q
run sudo apt-get install -y -q git curl jq ca-certificates gnupg software-properties-common openssh-server openssl tmux rsync net-tools python3-pip
run sudo systemctl enable --now ssh
# Mint เป็น desktop: เครื่องหลับ = ไซต์ดับ (REF_edge-install.md "Desktop-distro footguns")
run sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
if command -v gsettings >/dev/null && [[ -n ${DBUS_SESSION_BUS_ADDRESS:-} ]]; then
  run "gsettings set org.cinnamon.desktop.screensaver lock-enabled false || true"
  run "gsettings set org.cinnamon.settings-daemon.plugins.power sleep-inactive-ac-timeout 0 || true"
else
  warn 'ไม่มี desktop session — ปิดล็อกจอ/หลับเองจากหน้าจอเครื่อง (System Settings › Power) ทีหลัง'
fi
warn 'Update Manager: ปิด "รีสตาร์ทอัตโนมัติ" เองจากหน้าจอ (ตั้งผ่าน ssh ไม่ได้)'

# ── 3. Node 22 + pm2 ───────────────────────────────────────
step '3. Node.js 22 + pm2'
if command -v node >/dev/null && [[ $(node -v) == v22* ]] && [[ $(command -v node) == /usr/bin/node ]]; then
  ok "node $(node -v) อยู่แล้ว"
else
  # ecosystem.edge.config.js ใช้ interpreter /usr/bin/node ⇒ ต้องเป็น node ของระบบ (NodeSource) ไม่ใช่ nvm
  run "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  run sudo apt-get install -y -q nodejs
fi
command -v pm2 >/dev/null && ok "pm2 อยู่แล้ว" || run sudo npm install -g pm2

# ── 4. Mosquitto (PPA · รันใต้ pm2 ไม่ใช่ systemd) ───────────
step '4. Mosquitto'
if dpkg -s mosquitto >/dev/null 2>&1; then ok "mosquitto $(dpkg-query -W -f='${Version}' mosquitto) อยู่แล้ว"
else
  # mask ก่อนติดตั้ง — ไม่งั้น service ของแพ็กเกจจับพอร์ต 1883 ก่อน pm2 (ลำดับเดียวกับที่ทำจริงทุกไซต์)
  run sudo systemctl mask mosquitto.service
  run sudo add-apt-repository -y ppa:mosquitto-dev/mosquitto-ppa
  run sudo apt-get update -q
  run sudo apt-get install -y -q mosquitto mosquitto-clients
fi
run sudo systemctl mask mosquitto.service

# ── 5. cloudflared (systemd · token อยู่ในไฟล์ ไม่อยู่ใน unit) ─
step '5. cloudflared'
if ! command -v cloudflared >/dev/null; then
  run "curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null"
  run "echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null"
  run sudo apt-get update -q
  run sudo apt-get install -y -q cloudflared
else ok "cloudflared อยู่แล้ว"; fi
run sudo install -d -m 755 /etc/cloudflared
if ((DRY)); then printf '  %s$ (token → /etc/cloudflared/token ผ่าน stdin · mode 600 root)%s\n' "$c_dim" "$c_0"
else printf '%s' "$TUNNEL_TOKEN" | sudo install -m 600 -o root -g root /dev/stdin /etc/cloudflared/token; fi
run "sudo tee /etc/systemd/system/cloudflared.service >/dev/null <<'UNIT'
[Unit]
Description=Cloudflare Tunnel client
After=network-online.target
Wants=network-online.target

[Service]
TimeoutStartSec=15
Type=notify
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token-file /etc/cloudflared/token
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
UNIT"
run sudo systemctl daemon-reload
run sudo systemctl enable --now cloudflared
run sudo systemctl restart cloudflared

# ── 6. Tailscale (ถ้าเลือก) ────────────────────────────────
if [[ $DO_TS == 1 ]]; then
  step '6. Tailscale'
  command -v tailscale >/dev/null && ok 'tailscale อยู่แล้ว' || run "curl -fsSL https://tailscale.com/install.sh | sh"
  run sudo systemctl enable --now tailscaled
  if [[ -n $TS_KEY ]]; then
    if ((DRY)); then printf '  %s$ sudo tailscale up --auth-key=file:<ไฟล์ชั่วคราว 600>%s\n' "$c_dim" "$c_0"
    else
      tsk=$(mktemp); chmod 600 "$tsk"; printf '%s' "$TS_KEY" > "$tsk"
      sudo tailscale up --auth-key="file:$tsk" --hostname="$NEW_HOST" || warn 'tailscale up ไม่ผ่าน — login เองทีหลังด้วย sudo tailscale up'
      rm -f "$tsk"
    fi
  else warn 'ยังไม่ได้ login — รัน "sudo tailscale up" แล้วใส่ tag ของ edge จาก admin console'; fi
fi

# ── 7. SSH: ให้ central เข้าได้ + กุญแจสำหรับดึงโค้ดจาก GitHub ──
step '7. SSH + GitHub'
run install -d -m 700 "$HOME/.ssh"
if grep -qF "${CENTRAL_PUBKEY#* }" "$HOME/.ssh/authorized_keys" 2>/dev/null; then ok 'กุญแจ central อยู่ใน authorized_keys แล้ว'
else run "printf '%s\n' '$CENTRAL_PUBKEY' >> '$HOME/.ssh/authorized_keys'"; run chmod 600 "$HOME/.ssh/authorized_keys"; fi
[[ -f $HOME/.ssh/id_ed25519 ]] || run "ssh-keygen -t ed25519 -N '' -C '${NEW_HOST}-$(date +%Y)' -f '$HOME/.ssh/id_ed25519' -q"
run "ssh-keyscan -t ed25519 github.com 2>/dev/null >> '$HOME/.ssh/known_hosts'"
run "ssh-keyscan -t ed25519 -p 443 ssh.github.com 2>/dev/null >> '$HOME/.ssh/known_hosts'"
# ทดสอบทาง 22 ก่อน · ไม่ผ่านเพราะต่อไม่ถึง (ไม่ใช่เพราะกุญแจ) ⇒ ลอง 443 แล้วตั้ง ~/.ssh/config ให้เอง
# (เผื่อไซต์ที่ firewall บล็อกพอร์ต 22 ขาออก แบบ FortiGate ที่ hkt — GOTCHAS #132)
# ⚠️ ssh -T git@github.com จบด้วย exit 1 แม้ login สำเร็จ (GitHub ไม่ให้ shell) — ห้ามต่อท่อเข้า grep ใต้ pipefail
#    ฉบับแรกเขียน "until ssh ... | grep -q" แล้ววนไม่จบทั้งที่กุญแจถูก (เจอจริงที่ bma 2026-10-08)
gh_try() { timeout 20 ssh -o BatchMode=yes -o ConnectTimeout=10 "$@" -T git@github.com 2>&1 || true; }
if ((!DRY)); then
  while :; do
    out=$(gh_try)
    grep -q 'successfully authenticated' <<<"$out" && break
    if ! grep -q 'Permission denied' <<<"$out"; then
      out443=$(timeout 20 ssh -o BatchMode=yes -o ConnectTimeout=10 -p 443 -T git@ssh.github.com 2>&1 || true)
      if grep -qE 'successfully authenticated|Permission denied' <<<"$out443"; then
        warn 'พอร์ต 22 ไป GitHub ถูกบล็อก แต่ 443 ผ่าน — ตั้ง ~/.ssh/config ให้ github.com ใช้ ssh.github.com:443'
        grep -q '^Host github.com$' "$HOME/.ssh/config" 2>/dev/null || printf '\nHost github.com\n  HostName ssh.github.com\n  Port 443\n  User git\n' >> "$HOME/.ssh/config"
        chmod 600 "$HOME/.ssh/config"
        continue
      fi
    fi
    echo
    warn "ยังดึงโค้ดจาก GitHub ไม่ได้ — ssh ตอบว่า: $(tail -1 <<<"$out")"
    if grep -q 'Permission denied' <<<"$out"; then
      warn 'ต่อถึง GitHub แล้วแต่กุญแจไม่ผ่าน — เพิ่มกุญแจนี้เป็น Deploy key (Read-only) ของ repo dojojin/vigil-platform:'
      echo "    $(cat "$HOME/.ssh/id_ed25519.pub")"
      echo '    GitHub › dojojin/vigil-platform › Settings › Deploy keys › Add deploy key'
    else
      warn 'ต่อไม่ถึง GitHub ทั้งพอร์ต 22 และ 443 — ตรวจเน็ต/DNS/firewall: ssh -vT git@github.com'
    fi
    read -r -u 3 -p '  แก้แล้วกด Enter เพื่อลองใหม่ (Ctrl-C = ยกเลิก) '
  done
fi
((DRY)) && warn '(dry-run ข้ามการทดสอบ GitHub)' || ok 'GitHub ต่อได้'

# ── 8. โค้ด + dependency ─────────────────────────────────────
step '8. โค้ด'
if [[ -d $REPO/.git ]]; then run "git -C '$REPO' pull --ff-only"; else run git clone "$REPO_URL" "$REPO"; fi
run "cd '$REPO/src' && npm ci --no-audit --no-fund || (cd '$REPO/src' && npm install --no-audit --no-fund)"

# ── 9. src/.env + cameras-config.json ───────────────────────
step '9. src/.env'
ENV_FILE="$REPO/src/.env"
WRITE_ENV=1
if [[ -f $ENV_FILE ]]; then
  if confirm "มี src/.env อยู่แล้ว — สำรองแล้วเขียนใหม่" n; then run cp -p "$ENV_FILE" "$ENV_FILE.bak-bootstrap-$(date +%Y%m%d-%H%M%S)"
  else WRITE_ENV=0; ok 'ใช้ src/.env เดิม'; fi
fi
if ((WRITE_ENV)); then
  gen() { openssl rand -hex 32; }
  if ((DRY)); then printf '  %s$ (เขียน %s · mode 600 · ค่าความลับไม่แสดง)%s\n' "$c_dim" "$ENV_FILE" "$c_0"
  else
    ( umask 077; cat > "$ENV_FILE" <<EOF
# ============================================================
# Vigil Platform — EDGE .env · site $SITE ($SITE_NAME)
# สร้างโดย scripts/edge-bootstrap.sh $(date '+%Y-%m-%d %H:%M') — NEVER commit (gitignored)
# โครงสร้างตาม edge/env.template · ความลับที่ต้องตรงกับ central: CAMERA_SECRET_KEY,
# SNAPSHOT_PROXY_SECRET, BLACKLIST_SECRET_KEY · ที่เหลือสร้างใหม่ต่อเครื่อง
# ============================================================
EDGE_MODE=1
EDGE_SITE_ID=$SITE
EDGE_SITE_CODE=$SITE
BRIDGE_BROKER_URL=wss://dashboard.dojojin.tech/mqtt
BRIDGE_USERNAME=edge-$SITE
BRIDGE_PASSWORD=$BRIDGE_PW
# token อยู่ที่ /etc/cloudflared/token (systemd) — ไม่ใส่ซ้ำในไฟล์นี้

# ── broker ภายใน (Mosquitto ใต้ pm2) ──
EDGE_BROKER=mosquitto
EDGE_MQTT_REQUIRE_AUTH=$REQUIRE_AUTH
MQTT_BROKER_URL=mqtt://127.0.0.1:1883
EDGE_MQTT_BROKER=mqtt://127.0.0.1:1883
MQTT_CLIENT_ID=vigil-edge
MQTT_SUBSCRIBER_USER=dashboard-subscriber
MQTT_SUBSCRIBER_PASSWORD=$(gen)

# ── DB — edge ไม่มี Postgres (placeholder) ──
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=vigil_platform
DB_USER=vigil_sql
DB_PASSWORD=unused_on_edge

EDGE_IMAGE_RETENTION_DAYS=7
LPR_RECEIVER_PORT=3003
FACE_PUSH_BIND=0.0.0.0
FACE_PUSH_PORT=3010
API_PORT=3000
REPORT_WORKER_PORT=3001
ALERT_WORKER_PORT=3002

SESSION_SECRET=$(gen)
INTERNAL_API_SECRET=$(gen)
CAMERA_SECRET_KEY=$CAM_KEY
SNAPSHOT_PROXY_SECRET=$SNAP_SECRET
${BL_KEY:+BLACKLIST_SECRET_KEY=$BL_KEY}

LPR_PUSH_HOST=$LAN_IP
FACE_PUSH_HOST=$FACE_HOST
${FACE_ALLOW:+FACE_PUSH_ALLOW=$FACE_ALLOW}
EOF
    )
    ok "เขียน $ENV_FILE (600) แล้ว"
  fi
fi
[[ -f $REPO/cameras-config.json ]] && ok 'cameras-config.json มีแล้ว' || run "printf '{ \"cameras\": [] }\n' > '$REPO/cameras-config.json'"

# ── 10. Mosquitto config + pm2 ──────────────────────────────
step '10. เริ่ม service'
# render ต้องมาก่อน pm2 start — สร้าง passwd/acl ให้บัญชี loopback ก่อน password_file มีผล
run "bash '$REPO/scripts/edge-render-mosquitto-conf.sh' '$LAN_IP'"
run "cd '$REPO' && pm2 start ecosystem.edge.config.js"
run "pm2 delete cloudflared >/dev/null 2>&1 || true"          # systemd เป็นเจ้าของ tunnel (ข้อ 5)
run "pm2 stop dahua >/dev/null 2>&1 || true"                  # ยังไม่มีกล้อง = crash-loop (GOTCHAS #100)
((IS_HCP)) || run "pm2 stop hcp-face-matches >/dev/null 2>&1 || true"
if ((!DRY)) && pm2 describe pm2-logrotate >/dev/null 2>&1; then ok 'pm2-logrotate อยู่แล้ว'
else
  run pm2 install pm2-logrotate
  run pm2 set pm2-logrotate:max_size 10M
  run pm2 set pm2-logrotate:retain 30
fi
run pm2 save
run "sudo env PATH=\"\$PATH:/usr/bin\" pm2 startup systemd -u '$(id -un)' --hp '$HOME' >/dev/null"

# ── 11. เครื่องมือผู้ดูแล (เลือกไว้ตอนต้น) ────────────────────
step '11. เครื่องมือผู้ดูแล'
if ((${#SEL[@]} == 0)); then ok 'ไม่ได้เลือก — ข้าม'; fi
# ── Claude Code ─────────────────────────────────────────────
if on claude; then
  step 'Claude Code'
  if command -v claude >/dev/null || [[ -x $HOME/.local/bin/claude ]]; then ok "มีแล้ว ($("${HOME}/.local/bin/claude" --version 2>/dev/null || claude --version 2>/dev/null | head -1))"
  else run "curl -fsSL https://claude.ai/install.sh | bash"; fi
  warn 'หลังติดตั้ง: รัน "claude" หนึ่งครั้งเพื่อ login (ทำแทนไม่ได้)'
fi

# ── Claude config ───────────────────────────────────────────
if on config; then
  step 'Claude config'
  put "$HOME/.claude/settings.json" 644 <<'__SETUP_EOF__'
{
  "model": "opus[1m]",
  "statusLine": {
    "type": "command",
    "command": "$HOME/.claude/statusline.sh"
  },
  "enabledPlugins": {
    "boxbox@boxbox-marketplace": true,
    "codex@openai-codex": true,
    "frontend-design@claude-code-plugins": true,
    "ponytail@ponytail": true,
    "superpowers@superpowers-marketplace": true,
    "frontend-design@claude-plugins-official": true
  },
  "extraKnownMarketplaces": {
    "boxbox-marketplace": {
      "source": {
        "source": "git",
        "url": "https://github.com/aiunlocked1412/boxbox.git"
      }
    },
    "openai-codex": {
      "source": {
        "source": "github",
        "repo": "openai/codex-plugin-cc"
      }
    },
    "claude-code-plugins": {
      "source": {
        "source": "github",
        "repo": "anthropics/claude-code"
      }
    },
    "ponytail": {
      "source": {
        "source": "github",
        "repo": "DietrichGebert/ponytail"
      }
    },
    "superpowers-marketplace": {
      "source": {
        "source": "github",
        "repo": "obra/superpowers-marketplace"
      }
    }
  },
  "advisorModel": "opus",
  "tui": "fullscreen",
  "skipDangerousModePermissionPrompt": true,
  "theme": "dark-daltonized",
  "editorMode": "normal",
  "remoteControlAtStartup": true,
  "crossSessionInbound": "accept",
  "agentPushNotifEnabled": true,
  "inputNeededNotifEnabled": true
}
__SETUP_EOF__
  put "$HOME/.claude/statusline.sh" 755 <<'__SETUP_EOF__'
#!/bin/bash

# Claude Code statusLine script.
#
# IMPORTANT: Claude Code pipes a JSON object to this script on stdin every tick.
# tmux's #(...) does NOT pipe that JSON — it just captures stdout. So when tmux
# runs this script directly, stdin is empty and every JSON-derived field comes
# back blank (only `hostname` survives). That is why the tmux bar showed only the
# hostname and no progress bars.
#
# Fix: when Claude Code runs us (JSON present) we build the line AND cache it to a
# file. When stdin is empty (tmux), we just print the cached line.

CACHE_FILE="${TMPDIR:-/tmp}/claude_statusline.txt"

# Read whatever is on stdin (empty when called from tmux).
input=$(cat)

# --- tmux path: no JSON -> serve the last cached line and exit ---
if [ -z "$input" ]; then
  cat "$CACHE_FILE" 2>/dev/null
  exit 0
fi

# --- Claude Code path: we have JSON ---

# Repo (owner/name) if Claude Code provides it.
repo=$(echo "$input" | jq -r '.workspace.repo | if . then .owner + "/" + .name else empty end' 2>/dev/null)

# Fallback: derive "repo/branch" from git in the current working directory.
if [ -z "$repo" ]; then
  cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty' 2>/dev/null)
  if [ -n "$cwd" ] && git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    name=$(basename "$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)")
    branch=$(git -C "$cwd" branch --show-current 2>/dev/null)
    repo="${name}${branch:+/$branch}"
  fi
fi

# Rate limits (Pro/Max subscribers only; empty when logged in via API key).
five_h=$(echo "$input"  | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null)
seven_d=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty' 2>/dev/null)

draw_progress_bar() {
  local pct=$1
  local label=$2
  local width=8
  pct=${pct%.*}                       # strip decimals (42.5 -> 42)
  [ -z "$pct" ] && pct=0
  local filled=$((pct * width / 100))
  [ $filled -gt $width ] && filled=$width
  local bar=""
  for ((i=0; i<filled; i++)); do bar="${bar}█"; done
  for ((i=filled; i<width; i++)); do bar="${bar}░"; done
  printf "%s[%s]%3d%%" "$label" "$bar" "$pct"
}

output="$(hostname)"
[ -n "$repo" ] && output="${output} · ${repo}"

if [ -n "$five_h" ] || [ -n "$seven_d" ]; then
  output="${output} │"
  [ -n "$five_h" ]  && output="${output} $(draw_progress_bar "$five_h" "5h")"
  [ -n "$seven_d" ] && output="${output} $(draw_progress_bar "$seven_d" "7d")"
fi

# Print for Claude Code's own status line...
echo "$output"
# ...and cache it so tmux (which has no JSON) can show the same thing.
printf '%s' "$output" > "$CACHE_FILE"
__SETUP_EOF__
  warn 'plugin ใน settings.json Claude Code จะ clone ให้เองตอนเปิดครั้งแรก'
fi

# ── tmux ────────────────────────────────────────────────────
if on tmux; then
  step 'tmux'
  put "$HOME/.tmux.conf" 644 <<'__SETUP_EOF__'
set -g prefix C-a
set -g mouse on
setw -g mode-keys vi
set -g base-index 1
set -g status-right-length 200

# อ่านบรรทัดที่ Claude Code cache ไว้โดยตรง (เร็ว ไม่ต้องรัน jq/git ทุก 5 วิ)
# ถ้ายังไม่มี session ของ Claude Code ที่กำลังรัน จะว่างไว้เฉย ๆ
set -g status-right '#(cat ${TMPDIR:-/tmp}/claude_statusline.txt 2>/dev/null)'
set -g status-interval 5

bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c "#{pane_current_path}"
__SETUP_EOF__
  ((DRY)) || { [[ -n ${TMUX:-} ]] && tmux source-file "$HOME/.tmux.conf" && ok 'reload tmux แล้ว'; } || true
fi

# ── bashrc (บล็อกระหว่างเครื่องหมาย) ────────────────────────
if on bashrc; then
  step '~/.bashrc'
  BEGIN='# >>> workstation dotfiles >>>'; END='# <<< workstation dotfiles <<<'
  OLD_BEGIN='# >>> vigil dotfiles (setup-new-machine.sh) >>>'; OLD_END='# <<< vigil dotfiles <<<'   # ฉบับก่อน — แทนที่ให้ด้วย
  block=$(cat <<'__SETUP_EOF__'
alias fixterm="stty sane; printf '\033[?1000l\033[?1002l\033[?1003l\033[?1004l\033[?1006l\033[?1015l\033[?2004l'; clear"
export PATH="$HOME/.local/bin:$PATH"

alias python="python3"
alias pip="pip3"

# Node.js ผ่าน nvm (ถ้าติดตั้งไว้)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# ==================== Homebrew Aliases ====================
# เครื่องนี้ยังไม่มี Homebrew/Linuxbrew — alias จะทำงานก็ต่อเมื่อติดตั้ง brew แล้ว
if command -v brew >/dev/null 2>&1; then
  # อัพเดทและอัพเกรด Homebrew + ล้างขยะเบา ๆ
  alias brewup='brew update && brew upgrade && brew upgrade --cask --greedy && brew cleanup -s'
  # ถอน package + ล้างให้สะอาดที่สุด (แนะนำใช้ตัวนี้)
  alias brewpurge='brew uninstall --force "$@" && brew autoremove && brew cleanup -s --prune=all'
  # ถอน Cask (แอป GUI) + ล้างไฟล์ขยะทั้งหมด
  alias brewzap='brew uninstall --cask --zap "$@" && brew autoremove && brew cleanup -s --prune=all'
  # อัพเกรดเฉพาะ Cask
  alias brewcup='brew upgrade --cask'
  # ตรวจสอบสิ่งที่เหลือและสามารถลบได้
  alias brewleaves='brew leaves'
  alias brewcheck='brew autoremove --dry-run && brew cleanup -s --dry-run'
  # ล้างทุกอย่างแบบหนัก (ใช้เมื่อต้องการเคลียร์จริงจัง)
  alias brewcleanall='brew autoremove && brew cleanup -s --prune=all'
fi

# ==================== apt equivalents (Linux Mint) ====================
alias aptup='sudo apt update && sudo apt full-upgrade -y && sudo apt autoremove -y && sudo apt clean'
alias aptcheck='apt list --upgradable'

alias ipcheck='ifconfig | grep "inet " | grep -Fv 127.0.0.1 | awk '"'"'{print $2}'"'"''

_reset_mouse() { printf '\e[?1000l\e[?1002l\e[?1003l\e[?1004l\e[?1006l\e[?1015l\e[?2004l' 2>/dev/null; }
_reset_mouse
PROMPT_COMMAND="_reset_mouse${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
__SETUP_EOF__
)
  # ส่วนของ ~/.bashrc ที่อยู่นอกบล็อกของสคริปต์
  outside() { awk -v b="$BEGIN" -v e="$END" -v b0="$OLD_BEGIN" -v e0="$OLD_END" '$0==b||$0==b0{skip=1} !skip{print} $0==e||$0==e0{skip=0}' "$HOME/.bashrc" 2>/dev/null; }
  # เคยใส่ชุดนี้ด้วยมือ (ไม่มีเครื่องหมายของสคริปต์ เช่นบน vigil-central) ⇒ เพิ่มบล็อกอีกจะได้ alias ซ้ำ
  if grep -qE '^alias fixterm=' <<<"$(outside)"; then   # ไม่ต่อท่อเข้า grep -q ใต้ pipefail
    warn '~/.bashrc มีชุดนี้อยู่แล้วแบบใส่ด้วยมือ (นอกบล็อกของสคริปต์) — เพิ่มอีกจะได้ alias ซ้ำ'
    if ((DRY)) || ! confirm 'ยังจะเพิ่มบล็อกอยู่ไหม' n; then ok 'ข้าม ~/.bashrc'; block=''; fi
  elif cmp -s <(sed -n "/^$BEGIN\$/,/^$END\$/p" "$HOME/.bashrc" 2>/dev/null | sed '1d;$d') <(printf '%s\n' "$block"); then
    ok '~/.bashrc มีบล็อกนี้ตรงอยู่แล้ว'; block=''
  fi
  if [[ -z $block ]]; then :
  elif ((DRY)); then printf '  %s$ (เพิ่ม/แทนบล็อก workstation dotfiles ใน ~/.bashrc · %s บรรทัด)%s\n' "$c_dim" "$(printf '%s\n' "$block" | wc -l)" "$c_0"
  else
    touch "$HOME/.bashrc"; cp -p "$HOME/.bashrc" "$HOME/.bashrc.bak-$TS"
    awk -v b="$BEGIN" -v e="$END" -v b0="$OLD_BEGIN" -v e0="$OLD_END" '$0==b||$0==b0{skip=1} !skip{print} $0==e||$0==e0{skip=0}' "$HOME/.bashrc.bak-$TS" > "$HOME/.bashrc"
    printf '\n%s\n%s\n%s\n' "$BEGIN" "$block" "$END" >> "$HOME/.bashrc"
    ok "เพิ่มบล็อกใน ~/.bashrc แล้ว (สำรอง ~/.bashrc.bak-$TS) — เปิด terminal ใหม่หรือ source ~/.bashrc"
  fi
fi

# ── SSH (เข้าไซต์อื่น) ─────────────────────────────────────────────────────
if on ssh; then
  step 'SSH'
  run install -d -m 700 "$HOME/.ssh"
  if [[ -f $HOME/.ssh/id_ed25519 ]]; then ok 'มีกุญแจ ~/.ssh/id_ed25519 แล้ว'
  else run "ssh-keygen -t ed25519 -N '' -C \"$(hostname)-$(date +%Y)\" -f \"$HOME/.ssh/id_ed25519\" -q"; fi
  run install -d -m 700 "$HOME/.ssh/config.d"
  put "$HOME/.ssh/config.d/sites.conf" 600 <<'__SETUP_EOF__'
# Linux: ไม่ได้ติดตั้ง 1Password จึงไม่ใช้ IdentityAgent ของ macOS
# ถ้าติดตั้ง 1Password + เปิด SSH agent ทีหลัง ให้แทน IdentityFile ด้านล่างด้วย:
#   IdentityAgent ~/.1password/agent.sock
Host *
  IdentityFile ~/.ssh/id_ed25519

# เซิร์ฟเวอร์กลาง — ใช้ browser auth ของ Cloudflare Access (ไม่ใช้ service token)
Host vigil-central
  HostName vigil.dojojin.tech
  User vigil-central
  ProxyCommand cloudflared access ssh --hostname %h

# edge 6 ไซต์ — ใช้ service token จาก ~/.cloudflared/vigil-service-token.env
Host sshhkt
  HostName sshhkt.dojojin.tech
  User phuket-edge
  ProxyCommand bash -c 'source ~/.cloudflared/vigil-service-token.env && exec cloudflared access ssh --hostname %h'
  StrictHostKeyChecking no

Host sshhdy
  HostName sshhdy.dojojin.tech
  User hdy-edge
  ProxyCommand bash -c 'source ~/.cloudflared/vigil-service-token.env && exec cloudflared access ssh --hostname %h'
  StrictHostKeyChecking no

Host sshvss
  HostName sshvss.dojojin.tech
  User vss2
  ProxyCommand bash -c 'source ~/.cloudflared/vigil-service-token.env && exec cloudflared access ssh --hostname %h'
  StrictHostKeyChecking no

Host sshvss3
  HostName sshvss3.dojojin.tech
  User vss3
  ProxyCommand bash -c 'source ~/.cloudflared/vigil-service-token.env && exec cloudflared access ssh --hostname %h'
  StrictHostKeyChecking no

Host sshnrw
  HostName sshnrw.dojojin.tech
  User nrw-edge
  ProxyCommand bash -c 'source ~/.cloudflared/vigil-service-token.env && exec cloudflared access ssh --hostname %h'
  StrictHostKeyChecking no

Host sshbma
  HostName sshbma.dojojin.tech
  User bma
  ProxyCommand bash -c 'source ~/.cloudflared/vigil-service-token.env && exec cloudflared access ssh --hostname %h'
  StrictHostKeyChecking no

# เครื่องส่วนตัว — ใช้ browser auth
Host laptop-cf
  HostName ssh.dojojin.tech
  User kiseki
  ProxyCommand cloudflared access ssh --hostname %h
__SETUP_EOF__
  # ssh อ่าน Include ต้องอยู่ก่อน Host ใด ๆ — เติมบนสุดของ ~/.ssh/config ครั้งเดียว (ไม่แตะบล็อก github.com ของข้อ 7)
  if ((!DRY)) && ! grep -qxF 'Include config.d/*.conf' "$HOME/.ssh/config" 2>/dev/null; then
    touch "$HOME/.ssh/config"; chmod 600 "$HOME/.ssh/config"
    { printf 'Include config.d/*.conf\n\n'; cat "$HOME/.ssh/config"; } > "$HOME/.ssh/config.new" && mv "$HOME/.ssh/config.new" "$HOME/.ssh/config" && chmod 600 "$HOME/.ssh/config"
    ok 'เพิ่ม Include config.d/*.conf ใน ~/.ssh/config'
  fi
  if [[ -n $CF_ID ]]; then
    if ((DRY)); then printf '  %s$ (เขียน ~/.cloudflared/vigil-service-token.env · mode 600 · ค่าไม่แสดง)%s\n' "$c_dim" "$c_0"
    else
      install -d -m 700 "$HOME/.cloudflared"
      [[ -f $HOME/.cloudflared/vigil-service-token.env ]] && cp -p "$HOME/.cloudflared/vigil-service-token.env" "$HOME/.cloudflared/vigil-service-token.env.bak-$TS"
      ( umask 077; printf "export TUNNEL_SERVICE_TOKEN_ID='%s'\nexport TUNNEL_SERVICE_TOKEN_SECRET='%s'\n" "$CF_ID" "$CF_SECRET" > "$HOME/.cloudflared/vigil-service-token.env" )
      ok 'เขียน ~/.cloudflared/vigil-service-token.env (600)'
    fi
  else warn 'ไม่มี service token — ssh sshhkt/sshhdy/sshbma/... จะ error จนกว่าจะสร้าง ~/.cloudflared/vigil-service-token.env (ดูข้อ 4a ในเอกสาร)'; fi
  echo
  warn 'กุญแจนี้ยังเข้าเซิร์ฟเวอร์ไม่ได้ — ให้เครื่องที่เข้าได้อยู่แล้วเพิ่มบรรทัดนี้ลง authorized_keys ทั้ง 7 เครื่อง = central + edge 6 (เอกสารข้อ 4b):'
  ((DRY)) && echo '    (dry-run: ยังไม่ได้สร้างกุญแจ)' || echo "    $(cat "$HOME/.ssh/id_ed25519.pub")"
fi

# ── Skills ของผู้ใช้จากเครื่องหลัก (vigil-central) ────────────────────────────────
if on skills; then
  step 'Skill ของผู้ใช้'
  if ((DRY)); then printf '  %s$ rsync -a --exclude synced vigil-central:.claude/skills/ ~/.claude/skills/%s\n' "$c_dim" "$c_0"
  elif ssh -o ConnectTimeout=20 vigil-central true 2>/dev/null; then
    rsync -a --exclude synced vigil-central:.claude/skills/ "$HOME/.claude/skills/" && ok "คัดลอกแล้ว: $(ls "$HOME/.claude/skills" | tr '\n' ' ')"
    [[ -f $HOME/.claude/skills/vss-email/assets/signature.png ]] || warn 'ไม่มี vss-email/assets/signature.png — คัดลอกเอง'
  else warn 'ssh vigil-central ไม่ได้ (ต้อง login Cloudflare Access ผ่าน browser ก่อน และกุญแจต้องอยู่ใน authorized_keys) — ข้าม'; fi
fi

# ── ทดสอบ SSH ───────────────────────────────────────────────
if on sshtest; then
  step 'ทดสอบ SSH เข้า edge ทั้ง 6 ไซต์'
  for H in sshhkt sshhdy sshvss sshvss3 sshnrw sshbma; do
    if ((DRY)); then printf '  %s$ ssh %s hostname%s\n' "$c_dim" "$H" "$c_0"; continue; fi
    r=$(timeout 30 ssh -o BatchMode=yes -o ConnectTimeout=15 "$H" 'echo OK $(hostname)' 2>&1 | tail -1) || true
    [[ $r == OK* ]] && ok "$H  $r" || warn "$H  ${r:-ไม่ตอบ}"
  done
fi


# ── 12. ตรวจ ───────────────────────────────────────────────
step '12. ตรวจผล'
if ((!DRY)); then
  sleep 5
  curl -fsS http://127.0.0.1:3003/healthz >/dev/null && ok 'lpr-receiver ตอบ :3003' || warn 'lpr-receiver ยังไม่ตอบ :3003 — pm2 logs lpr-receiver'
  systemctl is-active --quiet cloudflared && ok 'cloudflared (systemd) active' || warn 'cloudflared ไม่ active — journalctl -u cloudflared -n 50'
  echo '  รอ edge-bridge ต่อ central (สูงสุด 90 วิ)…'
  for _ in $(seq 18); do
    # เก็บใส่ตัวแปรก่อน — "| grep -q" ใต้ pipefail ล้มได้แม้เจอ (grep ปิดท่อก่อน pm2 เขียนจบ = SIGPIPE)
    lg=$(pm2 logs edge-bridge --nostream --lines 50 2>/dev/null || true)
    if grep -q 'remote=up' <<<"$lg"; then ok 'edge-bridge: remote=up'; BR=1; break; fi; sleep 5
  done
  [[ ${BR:-0} == 1 ]] || warn 'edge-bridge ยังไม่ขึ้น remote=up — ถ้าเห็น "Not authorized" ตรวจรหัส bridge / provision-site.js บน central'
  pm2 list
fi

step 'ที่ต้องทำต่อ (นอกเครื่องนี้)'
cat <<EOF
  1) ถ้ายังไม่ได้ทำ — บน central:  node scripts/provision-site.js $SITE "$SITE_NAME"
  2) Zero Trust › Tunnels › (tunnel ของไซต์) › Public Hostname:
       $SITE.dojojin.tech  → HTTP  localhost:3003      (LPR/face push · ห้าม :3000)
       ssh$SITE.dojojin.tech → SSH  localhost:22       (+ เพิ่ม hostname นี้เข้า Access app "vigil")
  3) บน central:  เพิ่ม Host ssh$SITE ใน ~/.ssh/config (แบบ sshnrw) แล้ว  ssh ssh$SITE hostname
  3b) เพิ่ม Host ssh$SITE ลงตาราง SSH ใน setup-new-machine.sh / SetupNewMachine.md ด้วย (รายการ host ฝังอยู่ในสองไฟล์นั้น)
  4) dashboard › Health: การ์ด "Edge — $SITE" ต้องขึ้นภายใน ~1 นาที
  5) เพิ่มกล้องของไซต์ใน dashboard → cameras-config.json บนเครื่องนี้จะเติมเอง
     แล้วถ้ามี Dahua:  pm2 start dahua && pm2 save
$( ((HAS_BOSCH)) && printf '%s\n' "  6) Bosch: กด \"ส่งค่า MQTT\" ของกล้องแต่ละตัวใน dashboard (กล้องจะรีบูต) → ครบทุกตัวแล้วเปิดบังคับรหัส:" \
   "       node scripts/edge-set-env.js EDGE_MQTT_REQUIRE_AUTH=true && bash scripts/edge-render-mosquitto-conf.sh $LAN_IP --reload" )
  ทดสอบภายนอก:  curl -s https://$SITE.dojojin.tech/healthz
EOF
((DRY)) && warn 'นี่คือ --dry-run — ยังไม่ได้ติดตั้งอะไร'
ok 'เสร็จ'
