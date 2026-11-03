#!/bin/bash
# ============================================================
# Vigil Platform — Postgres Backup (offsite: Google Drive via rclone crypt)
# ============================================================
# 🔴 2026-09-22 — split out of scripts/backup.sh (RCA: GOTCHAS #212). This
# used to be the tail end of backup.sh, sharing its systemd unit and its
# TimeoutStartSec. As the DB grew, local dump + upload together grew past
# that fixed 1-hour ceiling and systemd killed the WHOLE process mid-upload
# every night for 15 days straight (8-22 ก.ย. 2026) — the local dump above it
# had already finished fine each time, but got no chance to show that: the
# process died before printing anything past "config bundle" in the log.
#
# This script is now independent: its own systemd unit, its own (generous)
# timeout, triggered on its own schedule. A slow or hung upload can no longer
# take the local backup down with it — by the time this runs, the local dump
# already succeeded or already failed on its own, unrelated to this.
#
# Self-scheduling, same shape as backup.sh: runs off a frequent timer tick
# and decides for itself whether it's due — here, "due" means today's local
# dump finished (backup.sh's own completion marker) and this hasn't already
# uploaded today.
#
# Encrypted client-side via rclone crypt remote "gdrive-crypt" — Drive sees
# only ciphertext. Restore on a new machine needs CRYPT_PASSWORD/CRYPT_SALT
# (owner's password manager). rclone failing (offline, slow, etc.) only
# warns — it must never be treated as the local backup failing; local backup
# already happened by the time this script even starts.
#
# Run from anywhere:  ./scripts/backup-offsite.sh              # self-scheduling
#                      ./scripts/backup-offsite.sh --force      # ignore the "already done" check, run now
#                      ./scripts/backup-offsite.sh --dry-run    # print what would happen, do nothing
# Cron / systemd:      scripts/install-backup-timer.sh
# ============================================================

set -uo pipefail   # not -e: one failed rclone step must not abort retention cleanup below it

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
CONTAINER="${CONTAINER:-vigil-postgres}"
DB_NAME="${DB_NAME:-vigil_platform}"
DB_USER="${DB_USER:-vigil_sql}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive-crypt}"
RCLONE_BIN="$(command -v rclone || echo /opt/homebrew/bin/rclone)"
LOCAL_STATE_FILE="$BACKUP_DIR/.last_local_run_date"
OFFSITE_STATE_FILE="$BACKUP_DIR/.last_offsite_run_date"

FORCE=0; DRY_RUN=0
for a in "$@"; do
  case "$a" in
    --force)   FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

log() { echo "[$(date '+%F %T')] $1"; }

_setting() {
  local key="$1" default="$2" val
  val="$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc \
    "SELECT value FROM system_settings WHERE key='${key}'" 2>/dev/null | tr -d '[:space:]')" || val=""
  [[ -n "$val" ]] && echo "$val" || echo "$default"
}

OFFSITE_RETAIN_DAYS="${OFFSITE_RETAIN_DAYS:-$(_setting backup_cloud_retain_days 3)}"

TODAY="$(date +%F)"
LOCAL_DONE_TODAY=0
[[ -f "$LOCAL_STATE_FILE" && "$(cat "$LOCAL_STATE_FILE" 2>/dev/null)" == "$TODAY" ]] && LOCAL_DONE_TODAY=1
ALREADY_UPLOADED_TODAY=0
[[ -f "$OFFSITE_STATE_FILE" && "$(cat "$OFFSITE_STATE_FILE" 2>/dev/null)" == "$TODAY" ]] && ALREADY_UPLOADED_TODAY=1

RCLONE_READY=0
if [[ -x "$RCLONE_BIN" ]] && "$RCLONE_BIN" listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:"; then
  RCLONE_READY=1
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "backup_cloud_retain_days = $OFFSITE_RETAIN_DAYS"
  echo "local dump done today    = $([[ $LOCAL_DONE_TODAY -eq 1 ]] && echo yes || echo no)"
  echo "already uploaded today   = $([[ $ALREADY_UPLOADED_TODAY -eq 1 ]] && echo yes || echo no)"
  echo "rclone + remote ready    = $([[ $RCLONE_READY -eq 1 ]] && echo yes || echo no)"
  echo "would run now            = $([[ $FORCE -eq 1 || ($LOCAL_DONE_TODAY -eq 1 && $ALREADY_UPLOADED_TODAY -eq 0 && $RCLONE_READY -eq 1) ]] && echo yes || echo no)"
  exit 0
fi

if [[ $RCLONE_READY -eq 0 ]]; then
  exit 0   # not configured on this box — silent, same as the old script's behaviour
fi

if [[ $FORCE -eq 0 ]]; then
  [[ $ALREADY_UPLOADED_TODAY -eq 1 ]] && exit 0   # already done — silent, normal on most ticks
  [[ $LOCAL_DONE_TODAY -eq 0 ]] && exit 0         # local backup hasn't finished (or hasn't started) yet — silent, try again next tick
fi

OUT="$(ls -t "$BACKUP_DIR"/vigil_platform_*.dump 2>/dev/null | head -1)"
if [[ -z "$OUT" ]]; then
  log "⚠ no local dump found — nothing to upload"
  exit 0
fi
TS="$(basename "$OUT" .dump)"; TS="${TS#vigil_platform_}"

BUNDLE="$BACKUP_DIR/config-snapshot_${TS}.tar.gz"
tar czf "$BUNDLE" -C "$REPO_ROOT" \
  .env cameras-config.json camera-groups.json config branding licenses-issued \
  -C "$HOME/Library/LaunchAgents" pm2.dojojin.plist com.dojojin.dashboard.backup.plist \
  2>/dev/null || log "⚠ config bundle: some paths missing (continuing)"

if "$RCLONE_BIN" copy "$OUT" "${RCLONE_REMOTE}:dumps/" --drive-chunk-size 64M 2>/dev/null \
   && "$RCLONE_BIN" copy "$BUNDLE" "${RCLONE_REMOTE}:config/" 2>/dev/null; then
  log "✓ Offsite: uploaded dump + config bundle → ${RCLONE_REMOTE}"
  echo "$TODAY" > "$OFFSITE_STATE_FILE"
else
  log "⚠ Offsite upload FAILED — local backup still OK, will retry next tick"
fi
rm -f "$BUNDLE"

# Drive-side retention — backup_cloud_retain_days (Settings page), default 3.
# --min-age is metadata-only (no data transfer), safe even when upload
# throughput itself is degraded.
"$RCLONE_BIN" delete "${RCLONE_REMOTE}:dumps/"  --min-age "${OFFSITE_RETAIN_DAYS}d" 2>/dev/null || true
"$RCLONE_BIN" delete "${RCLONE_REMOTE}:config/" --min-age "${OFFSITE_RETAIN_DAYS}d" 2>/dev/null || true
log "✓ Cloud retention: pruned anything older than ${OFFSITE_RETAIN_DAYS} day(s)"
