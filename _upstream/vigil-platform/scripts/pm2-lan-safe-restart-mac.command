#!/bin/zsh
# ============================================================
# Vigil Platform — PM2 LAN-safe restart  [macOS ONLY — LEGACY]
# @author Prakasit Rochanavipart (Dojo-mAn)
# @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
# @license Proprietary
# ------------------------------------------------------------
# ⚠️ LEGACY — kept for the MacBook only. Central moved to Linux
# (vigil-central, Linux Mint 22.3) on 2026-07-23 and Linux has no
# Local Network Privacy, so none of this applies there. On Linux
# just use `pm2 restart all` (see service_start.md).
# Renamed 2026-07-27 with the -mac suffix so nobody reaches for it
# on the wrong host.
# ------------------------------------------------------------
# macOS Local Network Privacy gates third-party binaries (ffmpeg,
# node without a permission record) from reaching the camera subnet
# unless the PM2 daemon's responsible app holds the Local Network
# grant. Terminal.app has that grant — so the daemon must be
# (re)started from inside Terminal.app, never from tmux / ssh /
# launchd / Claude Code shells. See GOTCHAS #84.
#
# Run from anywhere with:   open -a Terminal scripts/pm2-lan-safe-restart-mac.command
# ============================================================
echo "=== PM2 LAN-safe restart (under Terminal.app context) ==="
pm2 kill && pm2 resurrect && sleep 3 && pm2 ls
echo ""
echo "=== done — ปิดหน้าต่างนี้ได้เลย ==="
