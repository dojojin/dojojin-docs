#!/usr/bin/env bash
# ============================================================
# Vigil Platform — เปิด listener MQTT บน IP Tailscale ของ central (P0 ของเส้นทาง bridge 2026-10-18)
# @author Prakasit Rochanavipart (Dojo-mAn)
# @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
# @license Proprietary
# ------------------------------------------------------------
# ใช้:  sudo bash scripts/central-tailscale-listener.sh
# รันซ้ำได้ · รันบนเครื่องอื่นจะหยุดทันที · ถ้า Mosquitto ขึ้นไม่ได้หลังแก้ จะถอดไฟล์ listener แล้วขึ้นใหม่ให้เอง
#
# ทำ 2 อย่าง:
#   1. net.ipv4.ip_nonlocal_bind = 1 — ให้ Mosquitto bind IP นี้ได้แม้ tailscaled ยังไม่ขึ้นตอนบูต
#      (ไม่มีข้อนี้ = Mosquitto start ไม่ขึ้นทั้งตัว แล้วพาทุกเส้นทางล่มไปด้วย)
#   2. /etc/mosquitto/conf.d/zz-tailscale-listener.conf — listener 1883 บน 100.89.1.29
# ACL ของ tailnet (tag:edge → tag:central:1883) ตั้งใน Tailscale admin แยกต่างหาก
# ============================================================
set -euo pipefail

TS_IP=100.89.1.29
SYSCTL_FILE=/etc/sysctl.d/99-vigil-nonlocal-bind.conf
LISTENER_FILE=/etc/mosquitto/conf.d/zz-tailscale-listener.conf

[ "$(hostname)" = vigilcentral ] || { echo "หยุด: เครื่องนี้คือ $(hostname) ไม่ใช่ vigilcentral"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "หยุด: ต้องรันด้วย sudo"; exit 1; }
if grep -qsE "^\s*listener\s+1883\s+$TS_IP" /etc/mosquitto/conf.d/*.conf --exclude="$(basename "$LISTENER_FILE")"; then
  echo "หยุด: มี listener $TS_IP:1883 อยู่ในไฟล์อื่นแล้ว — ประกาศซ้ำจะทำให้พอร์ตชน"; exit 1
fi

echo "1/3 sysctl ip_nonlocal_bind"
echo 'net.ipv4.ip_nonlocal_bind = 1' > "$SYSCTL_FILE"
sysctl -q -p "$SYSCTL_FILE"
sysctl net.ipv4.ip_nonlocal_bind

echo "2/3 listener $TS_IP:1883"
printf 'listener 1883 %s\nprotocol mqtt\n' "$TS_IP" > "$LISTENER_FILE"

echo "3/3 restart mosquitto (ทุก bridge หลุดไม่กี่วินาทีแล้วต่อกลับเอง)"
systemctl restart mosquitto || true   # ล้มเหลวต้องไปถึงขั้นถอยคืนข้างล่าง ไม่ใช่ออกเพราะ set -e
sleep 3
if systemctl is-active --quiet mosquitto && ss -lnt | grep -q "$TS_IP:1883"; then
  echo "สำเร็จ ✅ $(ss -lnt | grep -E "(127.0.0.1|$TS_IP):1883 " | awk '{print $4}' | tr '\n' ' ')"
else
  echo "ล้มเหลว ❌ — ถอด $LISTENER_FILE แล้วขึ้น Mosquitto แบบเดิม"
  rm -f "$LISTENER_FILE"
  systemctl restart mosquitto || true
  sleep 2
  systemctl is-active mosquitto
  journalctl -u mosquitto -n 15 --no-pager
  exit 1
fi
