#!/usr/bin/env bash
# ============================================================
# Vigil Platform — install the DB backup schedule (Linux/systemd)
# @author Prakasit Rochanavipart (Dojo-mAn)
# @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
# @license Proprietary
# ------------------------------------------------------------
# WHY THIS EXISTS
# Daily backups ran on the MacBook via launchd
# (scripts/com.dojojin.dashboard.backup.plist). The .plist travelled with the
# repo to Linux, but the registration — `launchctl load` — lives outside git, on
# the Mac. So the file was present, looked complete, and nothing ran it:
# backups stopped silently on 2026-07-23 and nobody noticed for four days.
#
# This installs the systemd equivalent, then VERIFIES it. Run it instead of
# pasting the units by hand — a half-pasted heredoc leaves a unit that looks
# installed and never fires, which is the same silent failure again.
#
# 🔴 2026-09-22 — now installs TWO independent schedules, not one (GOTCHAS
# #212). Local backup and the Google Drive upload used to share a single
# service and a single TimeoutStartSec. As the DB grew, dump+upload together
# grew past that fixed ceiling and systemd killed the WHOLE thing mid-upload
# every night for 15 days — even on nights the local dump above it had
# already finished fine. They are now split so a slow/hung upload can never
# again take a working local backup down with it:
#   vigil-backup.service/.timer          — local pg_dump only
#   vigil-backup-offsite.service/.timer  — Google Drive upload only, runs
#                                            after local backup, independent timeout
# Both timers fire every 5/10 minutes and each script decides for itself
# whether it's actually due (self-scheduling against system_settings —
# backup_schedule_time / backup_local_retain_days / backup_cloud_retain_days,
# editable on the Settings page) — same reason the app layer already does
# this for its own periodic checks (src/helpers/helmetMetricCheck.js). This
# is also *why* neither unit hardcodes a clock time or a retention day count
# any more: those live in the database now, not in a unit file, so changing
# them from the Settings page takes effect on the next tick with no root
# access and no systemctl reload needed.
#
# Usage:
#   sudo ./scripts/install-backup-timer.sh              # install + verify
#   sudo ./scripts/install-backup-timer.sh --with-rclone  # also apt-install rclone
#   sudo ./scripts/install-backup-timer.sh --test         # install, then run both once now
#        ./scripts/install-backup-timer.sh --check        # verify only, no sudo needed
#
# Idempotent: re-running rewrites the units with the same content and re-verifies.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="$(stat -c%U "$REPO")"
BACKUP_SH="$REPO/scripts/backup.sh"
OFFSITE_SH="$REPO/scripts/backup-offsite.sh"
SVC=/etc/systemd/system/vigil-backup.service
TMR=/etc/systemd/system/vigil-backup.timer
OSVC=/etc/systemd/system/vigil-backup-offsite.service
OTMR=/etc/systemd/system/vigil-backup-offsite.timer

WITH_RCLONE=0; RUN_TEST=0; CHECK_ONLY=0
for a in "$@"; do
  case "$a" in
    --with-rclone) WITH_RCLONE=1 ;;
    --test)        RUN_TEST=1 ;;
    --check)       CHECK_ONLY=1 ;;
    -h|--help)     sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "⛔ unknown option: $a" >&2; exit 2 ;;
  esac
done

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }

# ── verify: the only thing that proves the schedule is real ─────────────
verify() {
  local fail=0
  echo "── ตรวจสอบ ─────────────────────────────────────────"

  if [[ -f $SVC && -f $TMR && -f $OSVC && -f $OTMR ]]; then ok "unit files อยู่ครบทั้ง 4 ไฟล์ (local + offsite)"; else bad "unit files ไม่ครบ"; fail=1; fi

  for t in vigil-backup.timer vigil-backup-offsite.timer; do
    if systemctl is-enabled "$t" &>/dev/null; then ok "$t enabled (จะกลับมาเองหลัง reboot)"
    else bad "$t ยังไม่ enabled"; fail=1; fi
    if systemctl is-active "$t" &>/dev/null; then ok "$t active"
    else bad "$t ยังไม่ active"; fail=1; fi
  done

  local next
  next="$(systemctl list-timers --all 2>/dev/null | awk '/vigil-backup/{print}')"
  [[ -n $next ]] && { ok "รอบถัดไป:"; echo "$next" | sed 's/^/      /'; } || { bad "systemd ไม่ได้ตั้งรอบถัดไป"; fail=1; }

  # A backup this user cannot take is not a backup. systemd starts a fresh
  # session so the docker group applies there even when the current shell
  # (joined to the group after login) still lacks it.
  if id -nG "$RUN_USER" | tr ' ' '\n' | grep -qx docker; then
    ok "user '$RUN_USER' อยู่ใน group docker"
  else
    bad "user '$RUN_USER' ไม่ได้อยู่ใน group docker → backup.sh จะหา container ไม่เจอ"
    echo "      แก้: sudo usermod -aG docker $RUN_USER   (แล้ว logout/login)"
    fail=1
  fi

  if command -v rclone &>/dev/null; then
    if rclone listremotes 2>/dev/null | grep -q .; then
      ok "rclone + remote พร้อม → offsite ทำงาน"
    else
      warn "rclone ติดตั้งแล้วแต่ยังไม่มี remote → offsite จะถูกข้าม (backup อยู่บนเครื่องเดียว)"
    fi
  else
    warn "ไม่มี rclone → offsite จะถูกข้าม (backup อยู่บนเครื่องเดียว)"
    echo "      แก้: sudo $0 --with-rclone   แล้วตั้ง remote 'gdrive-crypt' ตาม service_start.md"
  fi

  # Legacy dumps from before the platform rename (bosch_cctv_*,
  # pre-vigil-rename-*) never match backup.sh's prune glob
  # (vigil_platform_*.dump) and will sit there for ever. Surface them rather
  # than letting the disk fill with files nobody remembers.
  # Only speak up when it is actually worth acting on. Warning about 3 MB
  # trains people to ignore the warnings that matter.
  local legacy legacy_bytes
  legacy="$(find "$REPO/backups" -maxdepth 1 -name '*.dump' ! -name 'vigil_platform_*.dump' 2>/dev/null | wc -l)"
  legacy_bytes="$(find "$REPO/backups" -maxdepth 1 -name '*.dump' ! -name 'vigil_platform_*.dump' -printf '%s\n' 2>/dev/null | awk '{t+=$1} END{print t+0}')"
  if (( legacy > 0 && legacy_bytes > 500*1024*1024 )); then
    warn "dump เก่าก่อนเปลี่ยนชื่อระบบ ${legacy} ไฟล์ ($(numfmt --to=iec "$legacy_bytes")) — prune ไม่แตะ ต้องลบเอง"
    echo "      ดู: ls $REPO/backups/*.dump | grep -v vigil_platform_"
  fi

  local last
  last="$(ls -t "$REPO"/backups/vigil_platform_*.dump 2>/dev/null | head -1 || true)"
  if [[ -n $last ]]; then
    local age=$(( ( $(date +%s) - $(stat -c%Y "$last") ) / 86400 ))
    if (( age <= 1 )); then ok "local dump ล่าสุด: $(basename "$last") (${age} วันที่แล้ว)"
    else warn "local dump ล่าสุดเก่า ${age} วัน — $(basename "$last")"; fi
  else warn "ยังไม่มี local dump ใน $REPO/backups/"; fi

  echo "────────────────────────────────────────────────────"
  return $fail
}

if (( CHECK_ONLY )); then verify; exit $?; fi

[[ $EUID -eq 0 ]] || { echo "⛔ ต้องรันด้วย sudo — ลอง: sudo $0 $*" >&2; exit 1; }

# ── preconditions: fail here, not silently at the next scheduled tick ───
echo "── ตรวจก่อนติดตั้ง ─────────────────────────────────"
[[ -x $BACKUP_SH ]]   || { bad "ไม่พบ/รันไม่ได้: $BACKUP_SH"; exit 1; }
[[ -x $OFFSITE_SH ]]  || { bad "ไม่พบ/รันไม่ได้: $OFFSITE_SH"; exit 1; }
ok "backup.sh พร้อม: $BACKUP_SH"
ok "backup-offsite.sh พร้อม: $OFFSITE_SH"
id "$RUN_USER" &>/dev/null || { bad "ไม่มี user '$RUN_USER'"; exit 1; }
ok "จะรันในนาม user: $RUN_USER"
systemctl list-unit-files 2>/dev/null | grep -q '^docker\.service' \
  && ok "พบ docker.service (จะตั้ง After= ให้)" \
  || warn "ไม่พบ docker.service — ข้าม After= (ตรวจเองว่า Docker ขึ้นก่อนเวลาที่ตั้งไว้)"
echo

if (( WITH_RCLONE )) && ! command -v rclone &>/dev/null; then
  echo "── ติดตั้ง rclone จาก apt ──────────────────────────"
  # apt, not `curl https://rclone.org/install.sh | bash` — a package from the
  # distro is signed and auditable; piping a remote script into root is not.
  apt-get update -qq && apt-get install -y rclone
  ok "rclone $(rclone version 2>/dev/null | head -1)"
  echo
fi

echo "── เขียน unit files ───────────────────────────────"

# local backup — 5-min tick, script decides if it's due against
# system_settings.backup_schedule_time. Generous timeout (2h): the dump
# alone is measured at ~50 min and growing with the DB, this just needs
# real headroom, not the tight ceiling that started this whole incident.
cat > "$SVC" <<EOF
[Unit]
Description=Vigil Platform DB backup (local, self-scheduling)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$REPO
ExecStart=$BACKUP_SH
TimeoutStartSec=7200
Nice=10
IOSchedulingClass=idle
# backup.sh only echoes to stdout — it never opens a log file. On the Mac,
# launchd's StandardOutPath pointed that at backups/backup.log. systemd would
# otherwise send it to journald alone, leaving backup.log frozen and quietly
# lying to anyone who tails it.
StandardOutput=append:$REPO/backups/backup.log
StandardError=append:$REPO/backups/backup.log
EOF
ok "$SVC"

cat > "$TMR" <<'EOF'
[Unit]
Description=Vigil Platform DB backup — check every 5 min, run when backup_schedule_time says so

[Timer]
OnCalendar=*:0/5
Persistent=true
RandomizedDelaySec=20

[Install]
WantedBy=timers.target
EOF
ok "$TMR"

# offsite upload — separate unit, separate (effectively unbounded) timeout.
# It only ever starts after backup.sh has marked local backup done for the
# day, so a slow or stalled upload has nothing left to endanger.
cat > "$OSVC" <<EOF
[Unit]
Description=Vigil Platform DB backup (Google Drive offsite, self-scheduling)
After=docker.service vigil-backup.service
Wants=docker.service

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$REPO
ExecStart=$OFFSITE_SH
# No fixed ceiling — this must never be the thing that kills itself over a
# slow upload again. If it's ever stuck for real, the next day's tick still
# tries again once local backup completes; nothing else depends on it.
TimeoutStartSec=0
Nice=15
IOSchedulingClass=idle
StandardOutput=append:$REPO/backups/backup.log
StandardError=append:$REPO/backups/backup.log
EOF
ok "$OSVC"

cat > "$OTMR" <<'EOF'
[Unit]
Description=Vigil Platform DB backup — offsite upload, checked every 10 min

[Timer]
OnCalendar=*:0/10
Persistent=true
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
EOF
ok "$OTMR"
echo

systemctl daemon-reload
systemctl enable --now vigil-backup.timer vigil-backup-offsite.timer >/dev/null
ok "daemon-reload + enable --now (ทั้งสอง timer)"
echo

if (( RUN_TEST )); then
  echo "── ทดสอบรันทันที (ไม่ต้องรอรอบถัดไป) ──────────────"
  echo "  local backup: บังคับรันด้วย --force ข้ามเงื่อนไขเวลา/วันซ้ำ"
  if "$BACKUP_SH" --force; then ok "local backup รันจบ"
  else bad "local backup ล้มเหลว — ดู: journalctl -u vigil-backup -n 50 --no-pager"; fi
  echo "  offsite upload: บังคับรันด้วย --force"
  if "$OFFSITE_SH" --force; then ok "offsite upload รันจบ (หรือรอ/ข้ามตามเงื่อนไข rclone)"
  else bad "offsite upload ล้มเหลว — ดู: journalctl -u vigil-backup-offsite -n 50 --no-pager"; fi
  echo "  --- backup.log 5 บรรทัดล่าสุด ---"
  tail -5 "$REPO/backups/backup.log" 2>/dev/null | sed 's/^/    /' || echo "    (ไม่มี log)"
  echo
fi

verify
echo
echo "คำสั่งที่ใช้บ่อย:"
echo "  systemctl list-timers | grep vigil                   # รอบถัดไปเมื่อไหร่"
echo "  sudo systemctl start vigil-backup.service             # สั่ง local backup เดี๋ยวนี้ (ไม่ผ่านเงื่อนไขเวลา)"
echo "  sudo systemctl start vigil-backup-offsite.service      # สั่ง offsite upload เดี๋ยวนี้"
echo "  journalctl -u vigil-backup -n 50 --no-pager           # ดู log local backup"
echo "  journalctl -u vigil-backup-offsite -n 50 --no-pager   # ดู log offsite upload"
echo "  $0 --check                                            # ตรวจสถานะ (ไม่ต้อง sudo)"
echo "  ตั้งเวลา/จำนวนวันเก็บ backup ได้ที่หน้า Settings > System (ไม่ต้องแก้ไฟล์นี้ซ้ำ)"
