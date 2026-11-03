#!/usr/bin/env bash
# ============================================================
# Vigil Platform — render edge/mosquitto.conf.template for this site
# @author Prakasit Rochanavipart (Dojo-mAn)
# @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
# @license Proprietary
# ------------------------------------------------------------
# E1a (docs/reports/2026-09-27_mosquitto-migration-plan.md §9), extended for
# §11 (E2 auth). Fills <LAN_IP> / <HOME> / <LAN_ANON> into
# edge/mosquitto.conf.template and writes the result to
# ~/.config/vigil/mosquitto.conf — the config path ecosystem.edge.config.js's
# `mosquitto` pm2 app runs with.
#
# <LAN_ANON> = false only when EDGE_MQTT_REQUIRE_AUTH=true in src/.env — read
# with grep, not `source` (a stray shell metachar in an unrelated .env line
# must not execute). Missing file / missing key = anonymous (E1 default,
# unchanged behavior).
#
# Also runs scripts/edge-sync-broker-auth.js BEFORE writing the new conf and
# aborts if it fails — the template's global password_file/acl_file must
# never take effect without the loopback service accounts
# (MQTT_SUBSCRIBER_USER / SNAPSHOT_PUBLISHER_USER) already in them. Without
# that, a client sending one of those usernames gets rejected even on the
# anonymous-allowed loopback listener — verified on a throwaway broker:
# password_file is checked for ANY client that sends a username, regardless
# of listener_allow_anonymous.
#
# Refuses to run if LAN_IP is not actually assigned to a local interface —
# a typo'd IP here means the LAN listener never binds and no camera can
# reach it, discovered only at pm2 start time otherwise.
#
# Does NOT start mosquitto. --reload only signals an ALREADY-running one.
#
# Usage:
#   ./scripts/edge-render-mosquitto-conf.sh 172.29.51.52
#   ./scripts/edge-render-mosquitto-conf.sh 172.29.51.52 --reload
set -euo pipefail

LAN_IP=""; RELOAD=0
for a in "$@"; do
  case "$a" in
    --reload) RELOAD=1 ;;
    -*)       echo "⛔ unknown option: $a" >&2; exit 2 ;;
    *)        LAN_IP="$a" ;;
  esac
done
[[ -n $LAN_IP ]] || { echo "usage: $0 <LAN_IP> [--reload]" >&2; exit 2; }

if ! ip -4 -br addr 2>/dev/null | awk '{print $3}' | cut -d/ -f1 | grep -qx "$LAN_IP"; then
  echo "⛔ $LAN_IP ไม่ใช่ IP ของ interface ใดในเครื่องนี้ (ตรวจด้วย: ip -4 -br addr)" >&2
  exit 1
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$REPO/edge/mosquitto.conf.template"
[[ -f $TEMPLATE ]] || { echo "⛔ ไม่พบ $TEMPLATE" >&2; exit 1; }

CONF_DIR="$HOME/.config/vigil"
CONF_FILE="$CONF_DIR/mosquitto.conf"
PERSIST_DIR="$HOME/.local/mosquitto"

mkdir -p "$CONF_DIR" "$PERSIST_DIR"

# EDGE_MQTT_REQUIRE_AUTH → <LAN_ANON>. grep -m1 so a duplicate later line in
# .env never wins; `|| true` so no match (or no file) doesn't trip -e.
REQUIRE_AUTH_RAW="$(grep -m1 -E '^EDGE_MQTT_REQUIRE_AUTH=' "$REPO/src/.env" 2>/dev/null || true)"
REQUIRE_AUTH_VAL="${REQUIRE_AUTH_RAW#EDGE_MQTT_REQUIRE_AUTH=}"
REQUIRE_AUTH_VAL="$(tr -d '\r"'"'" <<<"$REQUIRE_AUTH_VAL" | tr '[:upper:]' '[:lower:]')"
case "$REQUIRE_AUTH_VAL" in
  1|true|yes|on) LAN_ANON=false ;;
  *)             LAN_ANON=true  ;;
esac
if [[ $LAN_ANON == false ]]; then
  echo "โหมด: LAN listener บังคับรหัส (EDGE_MQTT_REQUIRE_AUTH=$REQUIRE_AUTH_VAL) — ต้องมี password_file/acl_file ที่ตรงกล้องทุกตัวแล้ว"
else
  echo "โหมด: LAN listener anonymous (ค่าเริ่มต้น E1 pilot)"
fi

# password_file/acl_file เป็น global directive ตั้งแต่การ render ครั้งนี้ —
# ต้องมีบัญชี local service (MQTT_SUBSCRIBER_USER/SNAPSHOT_PUBLISHER_USER) อยู่
# ในไฟล์ทั้งสองก่อนเสมอ ไม่งั้น loopback หลุดทันทีที่ conf ใหม่มีผล (ดูคอมเมนต์
# ด้านบน) — รันแบบ unconditional ทุกครั้ง (ไม่ใช่แค่ตอนไฟล์ยังไม่มี) เพราะกล้อง/
# local user อาจเปลี่ยนไปแล้วตั้งแต่ครั้งก่อน · ล้มเหลว = ไม่เขียนทับ conf เดิม
if ! node "$REPO/scripts/edge-sync-broker-auth.js"; then
  echo "⛔ edge-sync-broker-auth.js ล้มเหลว — ไม่เขียนทับ $CONF_FILE (กัน mosquitto.passwd ไม่มี local service account หลุดใช้งานจริง)" >&2
  exit 1
fi

# SIGHUP does not load a password_file/acl_file that the RUNNING config never
# had (tested on vss3 2026-09-28: wrong passwords still accepted after HUP) —
# the first deploy of auth files needs a real restart.
NEED_RESTART=0
if [[ -f $CONF_FILE ]] && ! grep -qE '^\s*password_file\s' "$CONF_FILE"; then NEED_RESTART=1; fi

if [[ -f $CONF_FILE ]]; then
  BACKUP="$CONF_FILE.bak-$(date +%Y%m%d%H%M%S)"
  cp "$CONF_FILE" "$BACKUP"
  echo "สำรองของเดิมไว้ที่ $BACKUP"
fi

sed -e "s#<LAN_IP>#${LAN_IP}#g" -e "s#<HOME>#${HOME}#g" -e "s#<LAN_ANON>#${LAN_ANON}#g" \
  "$TEMPLATE" > "$CONF_FILE"
chmod 600 "$CONF_FILE"

echo "เขียนแล้ว: $CONF_FILE"
echo "── config ที่ใช้จริง (ไม่รวมคอมเมนต์) ─────────────────"
grep -vE '^\s*#|^\s*$' "$CONF_FILE"

# Syntax sanity check without binding any port, if this mosquitto build
# supports one (--test-config, present on 2.x builds like the PPA's 2.1.2 —
# older builds may lack it, so only attempt it when --help advertises it).
#
# Bug (found on vss3): --test-config with `persistence true` still SAVES the
# (empty) in-memory db to persistence_location — "Saving in-memory database
# to …/mosquitto.db" — which is a live-config side effect from what is meant
# to be a read-only check. Run the check against a scratch copy with the
# persistence lines stripped instead.
if command -v mosquitto >/dev/null 2>&1 && mosquitto --help 2>&1 | grep -q -- '--test-config'; then
  CHECK_CONF="$(mktemp)"
  trap 'rm -f "$CHECK_CONF"' EXIT
  chmod 600 "$CHECK_CONF"
  grep -vE '^\s*persistence(\s|$)' "$CONF_FILE" > "$CHECK_CONF"
  echo "── ตรวจ syntax (--test-config บนสำเนาไม่มี persistence, ไม่ bind พอร์ต) ───"
  mosquitto -c "$CHECK_CONF" --test-config
else
  echo "── ไม่มี syntax check แบบไม่ bind พอร์ตในเครื่องนี้ (mosquitto --test-config ไม่รองรับ/ไม่พบ) — ข้าม ห้าม start broker เพื่อตรวจ"
fi

if [[ $RELOAD == 1 ]]; then
  echo "── --reload: SIGHUP ให้ mosquitto ที่รันอยู่ (ไม่ restart) ──────────────"
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "ไม่พบ pm2 — ข้าม reload"
  else
    STATUS="$(pm2 jlist 2>/dev/null | node -e '
      let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
        try{ const p=JSON.parse(d).find(x=>x.name==="mosquitto"); console.log(p?p.pm2_env.status:""); }catch{ console.log(""); }
      })' || true)"
    if [[ $STATUS == online && $NEED_RESTART == 1 ]]; then
      echo "⚠️  config ที่รันอยู่ยังไม่มี password_file — SIGHUP จะไม่โหลดไฟล์รหัส/ACL ครั้งแรก"
      echo "   ต้อง restart จริง (กล้องหลุด ~1–2 วิ): pm2 restart mosquitto"
    elif [[ $STATUS == online ]]; then
      pm2 sendSignal SIGHUP mosquitto
      echo "ส่ง SIGHUP ให้ mosquitto แล้ว"
    else
      echo "pm2 process 'mosquitto' ไม่ online (status: '${STATUS:-ไม่พบ}') — ข้าม reload"
    fi
  fi
fi
