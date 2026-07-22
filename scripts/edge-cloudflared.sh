#!/bin/bash
# Vigil Platform — edge cloudflared launcher
# Loads src/.env (for TUNNEL_TOKEN) then runs cloudflared with the local
# ingress config. Managed by PM2 (ecosystem.edge.config.js).
set -a
# shellcheck disable=SC1091
source "$(dirname "$0")/../src/.env" 2>/dev/null || true
set +a

exec "${HOME}/.local/bin/cloudflared" \
  tunnel \
  --config "$(dirname "$0")/../config/cloudflared.yml" \
  run \
  --token "${TUNNEL_TOKEN:?TUNNEL_TOKEN not set in src/.env}"
