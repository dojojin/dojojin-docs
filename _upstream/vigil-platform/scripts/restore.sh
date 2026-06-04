#!/bin/bash
# ============================================================
# DojoJin Tech Dashboard — Postgres Restore
# ============================================================
# Restores a backup.dump into the running vigil-postgres container.
# Uses --clean --if-exists so existing tables get dropped first.
#
# Usage:
#   ./scripts/restore.sh                     # interactive (lists recent dumps)
#   ./scripts/restore.sh path/to/file.dump   # direct
#
# WARNING: destructive. Take a fresh backup first if there is any
# data in the current DB you cannot afford to lose. The script
# will not proceed without explicit 'yes' confirmation.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
CONTAINER="${CONTAINER:-vigil-postgres}"
DB_NAME="${DB_NAME:-vigil_platform}"
DB_USER="${DB_USER:-vigil_sql}"

FILE="${1:-}"

if [[ -z "$FILE" ]]; then
  echo "Available backups (most recent first):"
  ls -lht "$BACKUP_DIR"/vigil_platform_*.dump 2>/dev/null | head -10 || {
    echo "  (none found in $BACKUP_DIR)"
    exit 1
  }
  echo ""
  echo "Usage: $0 <path-to-dump-file>"
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "❌ File not found: $FILE" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "❌ Container '${CONTAINER}' is not running. Start it first:" >&2
  echo "   docker compose up -d" >&2
  exit 2
fi

cat <<EOF
⚠️  DESTRUCTIVE RESTORE
   Source : $FILE
   Target : ${CONTAINER}:${DB_NAME}
   Action : pg_restore --clean --if-exists (drops + recreates all objects)

   Tip: stop api-server + mqtt-subscriber + media-recorder first
        to avoid concurrent writes during restore.
EOF

read -p "Type 'yes' to continue: " ok
[[ "$ok" == "yes" ]] || { echo "Aborted."; exit 1; }

echo "[$(date '+%F %T')] ▶ Restoring..."
docker exec -i "${CONTAINER}" pg_restore -U "${DB_USER}" -d "${DB_NAME}" \
  --clean --if-exists --no-owner --no-privileges < "${FILE}"

echo "[$(date '+%F %T')] ✓ Restore complete."
echo ""
echo "Recommended next steps:"
echo "  1. Verify rowcounts:"
echo "     docker exec -it ${CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c 'SELECT count(*) FROM events;'"
echo "  2. Restart api-server so schema migrations run + caches refresh:"
echo "     ./scripts/services.sh start"
