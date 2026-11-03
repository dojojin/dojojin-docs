#!/bin/bash
# ============================================================
# Vigil Platform — Postgres Backup (on-premise)
# ============================================================
# Creates a custom-format pg_dump (-Fc) of vigil_platform into
# ./backups/vigil_platform_<timestamp>.dump and prunes dumps older than
# `backup_local_retain_days` (system_settings, default 7) — local only.
#
# 🔴 2026-09-22 — split from the old single-script design (RCA: offsite
# backup silently stopped for 15 days, 8-22 ก.ย. 2026, see GOTCHAS #212).
# The Google Drive upload used to live at the bottom of THIS script, inside
# one systemd service with one TimeoutStartSec. As the DB grew, dump+upload
# together grew past that fixed ceiling and systemd killed the whole process
# mid-upload every night — even though the local dump above had already
# finished successfully. The offsite leg is now scripts/backup-offsite.sh,
# its own systemd unit, its own timeout, triggered independently. A slow or
# hung upload can never again kill a working local backup.
#
# Self-scheduling: the systemd timer fires every 5 minutes (not once at
# 03:00) — this script decides for itself whether it's actually due, reading
# `backup_schedule_time` (system_settings, default "03:00") each tick. Same
# reason the app layer does this (src/helpers/helmetMetricCheck.js,
# noreadCheck.js) — it's the only way to make the trigger time configurable
# from the Settings page without granting the web app write access to
# /etc/systemd/system (a much bigger privilege than a settings row).
#
# Use restore.sh to roll back.
#
# Run from anywhere:  ./scripts/backup.sh              # self-scheduling (only backs up if due)
#                      ./scripts/backup.sh --force      # ignore the schedule, run now
#                      ./scripts/backup.sh --dry-run    # print what would happen, do nothing
# Cron / systemd:      scripts/install-backup-timer.sh
# ============================================================

set -euo pipefail

# Resolve repo root (script may be run from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
CONTAINER="${CONTAINER:-vigil-postgres}"
DB_NAME="${DB_NAME:-vigil_platform}"
DB_USER="${DB_USER:-vigil_sql}"
STATE_FILE="$BACKUP_DIR/.last_local_run_date"

FORCE=0; DRY_RUN=0
for a in "$@"; do
  case "$a" in
    --force)   FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date '+%F %T')] $1"; }

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  log "❌ Container '${CONTAINER}' is not running. Aborting."
  [[ $DRY_RUN -eq 1 ]] && exit 0 || exit 2
fi

# ── read configurable settings from system_settings, falling back to a
#    sane default if the row is missing or the DB read fails for any reason
#    (a broken settings read must never block the backup it's supposed to
#    schedule) ─────────────────────────────────────────────────────────
_setting() {
  local key="$1" default="$2" val
  val="$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc \
    "SELECT value FROM system_settings WHERE key='${key}'" 2>/dev/null | tr -d '[:space:]')" || val=""
  [[ -n "$val" ]] && echo "$val" || echo "$default"
}

RETAIN_DAYS="${RETAIN_DAYS:-$(_setting backup_local_retain_days 7)}"
SCHEDULE_TIME="${SCHEDULE_TIME:-$(_setting backup_schedule_time 03:00)}"

# ── self-scheduling: only proceed if it's the configured time (±5 min, the
#    timer's own tick granularity) and we haven't already backed up today.
#    Comparing HH:MM as zero-padded strings, not epoch math — a same-day
#    string compare is enough and avoids timezone arithmetic entirely. ────
TODAY="$(date +%F)"
NOW_HM="$(date +%H:%M)"
ALREADY_DONE=0
[[ -f "$STATE_FILE" && "$(cat "$STATE_FILE" 2>/dev/null)" == "$TODAY" ]] && ALREADY_DONE=1

# window = [scheduled time, scheduled time + 5 min) so a 5-min timer tick
# never straddles two windows and never misses the one it should catch
_hm_to_min() { local h=${1%%:*} m=${1##*:}; echo $((10#$h * 60 + 10#$m)); }
SCHED_MIN=$(_hm_to_min "$SCHEDULE_TIME")
NOW_MIN=$(_hm_to_min "$NOW_HM")
IN_WINDOW=0
(( NOW_MIN >= SCHED_MIN && NOW_MIN < SCHED_MIN + 5 )) && IN_WINDOW=1

if [[ $DRY_RUN -eq 1 ]]; then
  echo "backup_local_retain_days = $RETAIN_DAYS"
  echo "backup_schedule_time     = $SCHEDULE_TIME"
  echo "now                      = $NOW_HM ($TODAY)"
  echo "already ran today        = $([[ $ALREADY_DONE -eq 1 ]] && echo yes || echo no)"
  echo "in scheduled window      = $([[ $IN_WINDOW -eq 1 ]] && echo yes || echo no)"
  echo "would run now            = $([[ $FORCE -eq 1 || ($IN_WINDOW -eq 1 && $ALREADY_DONE -eq 0) ]] && echo yes || echo no)"
  exit 0
fi

if [[ $FORCE -eq 0 ]]; then
  if [[ $ALREADY_DONE -eq 1 ]]; then
    exit 0   # already backed up today — silent, this is normal on most of the day's 288 ticks
  fi
  if [[ $IN_WINDOW -eq 0 ]]; then
    exit 0   # not our window yet — silent
  fi
fi

TS=$(date +%Y-%m-%d_%H%M%S)
OUT="$BACKUP_DIR/vigil_platform_${TS}.dump"

log "▶ pg_dump (-Fc -Z 6) → ${OUT}"
# -Fc = custom (compressed, parallelizable on restore)
# -Z 6 = zlib level 6 (good size/CPU tradeoff)
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" -Fc -Z 6 "${DB_NAME}" > "${OUT}"

SIZE=$(du -h "${OUT}" | awk '{print $1}')
log "✓ Done. Size: ${SIZE}"
echo "$TODAY" > "$STATE_FILE"

# Retention prune (local, on-premise) — RETAIN_DAYS above, configurable via
# system_settings.backup_local_retain_days (Settings page)
PRUNED=$(find "${BACKUP_DIR}" -maxdepth 1 -name 'vigil_platform_*.dump' -mtime "+${RETAIN_DAYS}" -print -delete | wc -l | tr -d ' ')
log "✓ Pruned ${PRUNED} local dump(s) older than ${RETAIN_DAYS} day(s)"
