#!/usr/bin/env bash
# deploy.sh — build + เผยแพร่ขึ้น docs.dojojin.tech
# ใช้: bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

WEBROOT="${WEBROOT:-/var/www/dojojin-docs}"
NGINX_USER="${NGINX_USER:-nginx}"

echo "==> build"
npm run docs:build

echo "==> publish docs/.vitepress/dist/ -> $WEBROOT (ต้องใช้ sudo)"
sudo rsync -a --delete docs/.vitepress/dist/ "$WEBROOT/"
sudo chown -R "$NGINX_USER:$NGINX_USER" "$WEBROOT" 2>/dev/null || true

echo "==> verify"
echo -n "  nginx local -> "
curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "Host: docs.dojojin.tech" http://127.0.0.1:80/
echo -n "  https://docs.dojojin.tech/ -> "
curl -sI https://docs.dojojin.tech/ | head -1
echo -n "  title: "
curl -s https://docs.dojojin.tech/ | grep -o '<title>[^<]*</title>' | head -1
echo "เสร็จ — docs.dojojin.tech อัปเดตแล้ว ✓"
