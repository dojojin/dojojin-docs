#!/bin/zsh
# ============================================================
# Vigil Platform — PM2 LAN-safe restart
# @author Prakasit Rochanavipart (Dojo-mAn)
# @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
# @license Proprietary
# ------------------------------------------------------------
# macOS Local Network Privacy gates third-party binaries (ffmpeg,
# node without a permission record) from reaching the camera subnet
# unless the PM2 daemon's responsible app holds the Local Network
# grant. Terminal.app has that grant — so the daemon must be
# (re)started from inside Terminal.app, never from tmux / ssh /
# launchd / Claude Code shells. See GOTCHAS #84.
#
# Run from anywhere with:   open -a Terminal scripts/pm2-lan-safe-restart.command
# ============================================================
echo "=== PM2 LAN-safe restart (under Terminal.app context) ==="
pm2 kill && pm2 resurrect && sleep 3 && pm2 ls
echo ""
echo "=== done — ปิดหน้าต่างนี้ได้เลย ==="
