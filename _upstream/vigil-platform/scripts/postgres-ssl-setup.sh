#!/usr/bin/env bash
# ============================================================
# DojoJin Tech Dashboard — PostgreSQL SSL Setup (run-once)
# @author Prakasit Rochanavipart (Dojo-mAn)
# @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
# @license Proprietary
# ============================================================
#
# Idempotent: safe to re-run. Skips gen if cert already exists.
# Run after fresh volume creation (vigil_postgres_data).
# SEC-016 — ssl=on prerequisite before opening remote DB connections.
#
# Usage: bash scripts/postgres-ssl-setup.sh
# Requires: docker running, vigil-postgres container healthy

set -euo pipefail

CONTAINER="vigil-postgres"
DATA_DIR="/var/lib/postgresql/data"
PG_USER="vigil_sql"
PG_DB="vigil_platform"

# ── 1. Sanity check ──────────────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: ${CONTAINER} is not running. Start with: docker compose up -d postgres"
  exit 1
fi

# ── 2. Check if cert already exists (idempotent guard) ───────
if docker exec "${CONTAINER}" test -f "${DATA_DIR}/server.crt" 2>/dev/null; then
  echo "INFO: SSL cert already exists in ${CONTAINER}:${DATA_DIR}/server.crt — skipping generation."
else
  echo "INFO: Generating self-signed SSL cert (3650 days)…"

  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT

  # Generate on host (openssl not available in postgres:16-alpine)
  openssl req -new -x509 -days 3650 -nodes \
    -out "${TMPDIR}/server.crt" \
    -keyout "${TMPDIR}/server.key" \
    -subj '/CN=vigil-postgres' 2>/dev/null

  # docker cp is blocked by stale bind mounts on this host — use base64 pipe
  CERT_B64=$(base64 < "${TMPDIR}/server.crt")
  KEY_B64=$(base64 < "${TMPDIR}/server.key")

  docker exec "${CONTAINER}" sh -c "echo '${CERT_B64}' | base64 -d > ${DATA_DIR}/server.crt"
  docker exec "${CONTAINER}" sh -c "echo '${KEY_B64}'  | base64 -d > ${DATA_DIR}/server.key"

  docker exec "${CONTAINER}" sh -c "
    chown 70:70 ${DATA_DIR}/server.crt ${DATA_DIR}/server.key &&
    chmod 644   ${DATA_DIR}/server.crt &&
    chmod 600   ${DATA_DIR}/server.key
  "

  echo "INFO: Cert written and permissions set."
fi

# ── 3. Enable SSL via ALTER SYSTEM + reload (zero-downtime) ──
docker exec "${CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" \
  -c "ALTER SYSTEM SET ssl = on;" \
  -c "ALTER SYSTEM SET ssl_cert_file = 'server.crt';" \
  -c "ALTER SYSTEM SET ssl_key_file  = 'server.key';"

docker exec "${CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" \
  -c "SELECT pg_reload_conf();" > /dev/null

# ── 4. Verify ─────────────────────────────────────────────────
SSL_STATE=$(docker exec "${CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" -tAc "SHOW ssl;")
if [ "${SSL_STATE}" = "on" ]; then
  echo "OK: PostgreSQL SSL is ON."
else
  echo "ERROR: ssl = ${SSL_STATE} after reload — check postgresql.auto.conf and container logs."
  exit 1
fi

# Test SSL connection
SSL_VER=$(docker exec "${CONTAINER}" \
  psql "host=127.0.0.1 port=5432 dbname=${PG_DB} user=${PG_USER} sslmode=require" \
  -tAc "SELECT version FROM pg_stat_ssl WHERE pid = pg_backend_pid();" 2>/dev/null || echo "FAIL")

if [ "${SSL_VER}" = "FAIL" ]; then
  echo "WARN: SSL connection test failed — cert may have permission issues. Check container logs."
else
  echo "OK: SSL connection verified (${SSL_VER})."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SEC-016 complete. SSL is ready."
echo "  Rollback: ALTER SYSTEM SET ssl = off; SELECT pg_reload_conf();"
echo "  Next step (when opening remote access): add hostssl rule in"
echo "  pg_hba.conf scoped to the partner subnet — see docs/REF_third-party-integration.md §3.6"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
