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
