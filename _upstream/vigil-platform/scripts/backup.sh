#!/bin/bash
# ============================================================
# DojoJin Tech Dashboard — Postgres Backup
# ============================================================
# Creates a custom-format pg_dump (-Fc) of vigil_platform into
# ./backups/vigil_platform_<timestamp>.dump and prunes dumps older
# than $RETAIN_DAYS (default 14) — local retention only.
#
# Use restore.sh to roll back.
#
# Run from anywhere:  ./scripts/backup.sh
# Cron / launchd:     scheduled by com.dojojin.dashboard.backup.plist
# ============================================================

set -euo pipefail

# Resolve repo root (script may be run from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
CONTAINER="${CONTAINER:-vigil-postgres}"
DB_NAME="${DB_NAME:-vigil_platform}"
DB_USER="${DB_USER:-vigil_sql}"

mkdir -p "$BACKUP_DIR"

TS=$(date +%Y-%m-%d_%H%M%S)
OUT="$BACKUP_DIR/vigil_platform_${TS}.dump"

# Ensure the container is running before attempting dump
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "[$(date '+%F %T')] ❌ Container '${CONTAINER}' is not running. Aborting." >&2
  exit 2
fi

echo "[$(date '+%F %T')] ▶ pg_dump (-Fc -Z 6) → ${OUT}"
# -Fc = custom (compressed, parallelizable on restore)
# -Z 6 = zlib level 6 (good size/CPU tradeoff)
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" -Fc -Z 6 "${DB_NAME}" > "${OUT}"

SIZE=$(du -h "${OUT}" | awk '{print $1}')
echo "[$(date '+%F %T')] ✓ Done. Size: ${SIZE}"

# Retention prune
PRUNED=$(find "${BACKUP_DIR}" -maxdepth 1 -name 'vigil_platform_*.dump' -mtime "+${RETAIN_DAYS}" -print -delete | wc -l | tr -d ' ')
echo "[$(date '+%F %T')] ✓ Pruned ${PRUNED} dump(s) older than ${RETAIN_DAYS} day(s)"

# ── Offsite: Google Drive ผ่าน rclone crypt (A4, 2026-06-10) ────────────
# Tier 1 เท่านั้น: dump วันนี้ + config bundle (secrets/branding/licenses/plists).
# เข้ารหัสฝั่ง client ด้วย rclone crypt remote "gdrive-crypt" → Drive เห็นแต่ ciphertext.
# Restore เครื่องใหม่ต้องใช้ CRYPT_PASSWORD/CRYPT_SALT (เก็บใน password manager ของ owner).
# rclone ล้มเหลว (offline ฯลฯ) = warn อย่างเดียว — local backup ต้องไม่พังตาม.
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive-crypt}"
OFFSITE_RETAIN_DAYS="${OFFSITE_RETAIN_DAYS:-30}"
RCLONE_BIN="$(command -v rclone || echo /opt/homebrew/bin/rclone)"
if [ -x "$RCLONE_BIN" ] && "$RCLONE_BIN" listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:"; then
  BUNDLE="$BACKUP_DIR/config-snapshot_${TS}.tar.gz"
  tar czf "$BUNDLE" -C "$REPO_ROOT" \
    .env cameras-config.json camera-groups.json config branding licenses-issued \
    -C "$HOME/Library/LaunchAgents" pm2.dojojin.plist com.dojojin.dashboard.backup.plist \
    2>/dev/null || echo "[$(date '+%F %T')] ⚠ config bundle: some paths missing (continuing)"
  if "$RCLONE_BIN" copy "$OUT" "${RCLONE_REMOTE}:dumps/" --drive-chunk-size 64M 2>/dev/null \
     && "$RCLONE_BIN" copy "$BUNDLE" "${RCLONE_REMOTE}:config/" 2>/dev/null; then
    echo "[$(date '+%F %T')] ✓ Offsite: uploaded dump + config bundle → ${RCLONE_REMOTE}"
  else
    echo "[$(date '+%F %T')] ⚠ Offsite upload FAILED — local backup still OK" >&2
  fi
  rm -f "$BUNDLE"
  # Drive-side retention
  "$RCLONE_BIN" delete "${RCLONE_REMOTE}:dumps/"  --min-age "${OFFSITE_RETAIN_DAYS}d" 2>/dev/null || true
  "$RCLONE_BIN" delete "${RCLONE_REMOTE}:config/" --min-age "${OFFSITE_RETAIN_DAYS}d" 2>/dev/null || true
else
  echo "[$(date '+%F %T')] ⚠ rclone/remote '${RCLONE_REMOTE}' not available — skipped offsite" >&2
fi
