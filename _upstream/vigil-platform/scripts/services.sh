#!/usr/bin/env bash
# ============================================================
# DojoJin Tech Dashboard — service control (PM2-backed)
# ------------------------------------------------------------
# Single entry point for start / stop / restart / status.
# Thin wrapper over PM2 — process management is now PM2's job.
#
#   ./scripts/services.sh start     # start all apps via PM2
#   ./scripts/services.sh stop      # stop (keep in PM2 list)
#   ./scripts/services.sh restart   # rolling PM2 restart
#   ./scripts/services.sh status    # pm2 status output
#   ./scripts/services.sh logs      # tail all logs (Ctrl-C to exit)
#
# Pairs with ecosystem.config.js at project root.
# Pairs with src/singleton.js — PID-file lock that stops double-run.
# ============================================================
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ECOSYSTEM="$ROOT/ecosystem.config.js"
SRC="$ROOT/src"

require_pm2() {
  if ! command -v pm2 &>/dev/null; then
    echo "⛔ pm2 not found — run: npm install -g pm2"
    exit 1
  fi
}

start() {
  require_pm2
  echo "▶ starting stack via PM2..."
  pm2 start "$ECOSYSTEM"
}

stop() {
  require_pm2
  echo "■ stopping all services..."
  pm2 stop "$ECOSYSTEM"
  rm -f "$SRC/.run/"*.pid 2>/dev/null
  echo "■ stopped."
}

restart() {
  require_pm2
  echo "↺ restarting all services..."
  pm2 restart "$ECOSYSTEM"
}

status() {
  require_pm2
  pm2 status
}

logs() {
  require_pm2
  pm2 logs
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) restart ;;
  status)  status ;;
  logs)    logs ;;
  *) echo "usage: $0 {start|stop|restart|status|logs}"; exit 1 ;;
esac
