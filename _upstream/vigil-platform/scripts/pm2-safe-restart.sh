#!/usr/bin/env bash
# ============================================================
# Vigil Platform — safe `pm2 restart all` (Linux, central + edge)
# @author Prakasit Rochanavipart (Dojo-mAn)
# @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
# @license Proprietary
# ------------------------------------------------------------
# WHY THIS EXISTS
# `pm2 restart all` is already the safest command — it never reads an ecosystem
# file, so it cannot start central's app set on an edge (GOTCHAS #119). What it
# does NOT do is tell you when something is wrong:
#
#   • a process deleted earlier stays missing, silently — restart all only
#     restarts what is in the list, and prints no hint that the list is short
#   • a process that crash-loops after restart still reports "online" for the
#     moment you look at it
#
# Both failure modes are quiet, which is how the backup schedule went unnoticed
# for days. So this wraps the restart in a before/after comparison and exits
# non-zero when the machine did not come back the way it went in.
#
# Replaces scripts/pm2-lan-safe-restart-mac.command, whose whole purpose was
# macOS Local Network Privacy (GOTCHAS #84) — a thing Linux does not have.
#
# Usage:
#   ./scripts/pm2-safe-restart.sh                # restart all + verify
#   ./scripts/pm2-safe-restart.sh --update-env   # also re-read .env / ecosystem env
#   ./scripts/pm2-safe-restart.sh --check        # verify only, restart nothing
#   ./scripts/pm2-safe-restart.sh api-server     # restart one app (still verified)
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTLE=6          # seconds to let processes boot before the first sample
RECHECK=8         # seconds between the two samples that detect a crash loop

UPDATE_ENV=0; CHECK_ONLY=0; TARGET=all
for a in "$@"; do
  case "$a" in
    --update-env|-a) UPDATE_ENV=1 ;;
    --check)         CHECK_ONLY=1 ;;
    -h|--help)       sed -n '2,30p' "$0"; exit 0 ;;
    -*)              echo "⛔ unknown option: $a" >&2; exit 2 ;;
    *)               TARGET="$a" ;;
  esac
done

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
hr()   { printf '%s\n' "────────────────────────────────────────────────────"; }

command -v pm2 >/dev/null || { echo "⛔ ไม่พบ pm2"; exit 1; }

# name:status:restarts, one per line — the whole state this script reasons about
snapshot() {
  pm2 jlist 2>/dev/null | node -e '
    let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
      try{ JSON.parse(d).forEach(p=>console.log(`${p.name}:${p.pm2_env.status}:${p.pm2_env.restart_time}`)) }catch{}
    })'
}

# Which ecosystem describes THIS machine? Decided by what is running, not by
# hostname — a new site can be added without editing this script.
detect_role() {
  local names; names="$(snapshot | cut -d: -f1)"
  if grep -qx 'api-server' <<<"$names"; then echo central
  elif grep -qx 'edge-bridge' <<<"$names"; then echo edge
  else echo unknown; fi
}

expected_apps() {   # apps the matching ecosystem file declares
  local f
  case "$1" in
    central) f="$REPO/ecosystem.config.js" ;;
    edge)    f="$REPO/ecosystem.edge.config.js" ;;
    *)       return 1 ;;
  esac
  [[ -f $f ]] || return 1
  node -pe "require('$f').apps.map(a=>a.name).join('\n')" 2>/dev/null
}

# A vendor ingester only belongs on a site that has cameras of that vendor. The
# edge ecosystem file is shared by EVERY edge site, so it declares hikvision and
# dahua unconditionally — at a site with no Dahua cameras, "dahua missing from
# pm2" is the CORRECT state, not the GOTCHAS #119 trap. Same shape as the
# cloudflared exception below. Verified 2026-08-19 at HKT: 86 hikvision, 0 dahua.
# Fail closed: if cameras-config.json cannot be read we return -1, not 0, so a
# genuinely missing ingester is still reported rather than silently excused.
vendor_absent() {
  case "$1" in hikvision|dahua) ;; *) return 1 ;; esac
  local n
  n="$(node -pe "try{const c=require('$REPO/cameras-config.json');(c.cameras||[]).filter(x=>String(x.vendor||'').toLowerCase()==='$1').length}catch(e){-1}" 2>/dev/null)"
  [[ $n == 0 ]]
}

ROLE="$(detect_role)"

# Liveness beyond "pm2 says online": something the process must actually answer.
liveness() {
  case "$ROLE" in
    central)
      local code; code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://localhost:3000/ 2>/dev/null)"
      # 302 = redirect to login; any HTTP status means the server is answering.
      [[ -n $code && $code != 000 ]] && ok "api-server ตอบ HTTP $code" || { bad "api-server ไม่ตอบที่ :3000"; return 1; }
      ;;
    edge)
      # Whichever broker this site runs (nanomq or mosquitto, EDGE_BROKER —
      # see ecosystem.edge.config.js) is what every ingester on the site
      # publishes into; if 1883 is not listening the site is collecting
      # nothing, whatever pm2 reports. Port check only — broker-neutral.
      ss -lnt 2>/dev/null | grep -q ':1883 ' && ok "broker ฟังอยู่ที่ :1883" || { bad "ไม่มีอะไรฟังที่ :1883 — edge ไม่รับ event"; return 1; }
      ;;
    *) warn "ไม่รู้ว่าเครื่องนี้เป็น central หรือ edge — ข้าม liveness check" ;;
  esac
}

report_state() {
  local snap="$1" fail=0 miss=()
  local total online errored
  total="$(wc -l <<<"$snap" | tr -d ' ')"
  online="$(grep -c ':online:' <<<"$snap")"
  errored="$(grep -cE ':(errored|stopped|stopping):' <<<"$snap" || true)"

  echo "  role: $ROLE · process $online/$total online"
  (( errored > 0 )) && { bad "มี $errored process ที่ไม่ online:"; grep -E ':(errored|stopped|stopping):' <<<"$snap" | sed 's/^/      /'; fail=1; }

  # Missing apps are the quiet failure: restart all cannot bring back something
  # that was deleted, and says nothing about it.
  local exp; exp="$(expected_apps "$ROLE" || true)"
  if [[ -n $exp ]]; then
    while read -r app; do
      [[ -z $app ]] && continue
      # cloudflared is declared in the edge ecosystem but runs under systemd on
      # the real hosts — absent from pm2 is the CORRECT state (GOTCHAS #119).
      [[ $app == cloudflared ]] && continue
      # No cameras of this vendor at this site → no ingester expected (see above).
      vendor_absent "$app" && continue
      grep -q "^${app}:" <<<"$snap" || miss+=("$app")
    done <<<"$exp"
    if (( ${#miss[@]} > 0 )); then
      bad "app ที่ ecosystem ประกาศไว้แต่ไม่มีใน pm2: ${miss[*]}"
      echo "      restart all เรียกคืนให้ไม่ได้ — ดูวิธีที่ถูกต้องใน service_start.md (กับดัก ecosystem)"
      fail=1
    else
      ok "app ครบตามที่ ecosystem ประกาศ"
    fi
  else
    warn "อ่าน ecosystem ไม่ได้ — ข้ามการเทียบรายชื่อ app"
  fi
  return $fail
}

echo "── ก่อน ─────────────────────────────────────────────"
BEFORE="$(snapshot)"
[[ -z $BEFORE ]] && { bad "pm2 ไม่มี process เลย"; exit 1; }
report_state "$BEFORE" || warn "เครื่องมีปัญหาอยู่ก่อนแล้ว — restart อาจไม่ช่วย"

if (( CHECK_ONLY )); then
  echo; liveness; hr; exit $?
fi

# Long-running work that a restart would abort. pg_dump itself is safe (it runs
# in the Postgres container, not under pm2) but a report being rendered is not.
if systemctl is-active vigil-backup.service &>/dev/null; then
  warn "vigil-backup.service กำลังรันอยู่ — pm2 ไม่ได้แตะ Postgres จึงไม่กระทบ dump"
fi
echo

echo "── restart ─────────────────────────────────────────"
CMD=(pm2 restart "$TARGET")
(( UPDATE_ENV )) && CMD+=(--update-env)
printf '  รัน: %s\n' "${CMD[*]}"
if ! "${CMD[@]}" >/dev/null 2>&1; then
  bad "pm2 restart ล้มเหลว — ดู: pm2 logs --err --lines 50"
  exit 1
fi
ok "สั่ง restart แล้ว · รอ ${SETTLE}s ให้ process ตั้งตัว"
sleep "$SETTLE"
echo

echo "── หลัง ────────────────────────────────────────────"
AFTER="$(snapshot)"
RC=0
report_state "$AFTER" || RC=1

# Crash loop: "online" right after a restart proves nothing — a process that
# dies and is respawned looks online at any single instant. Two samples apart
# catch it, because pm2 bumps restart_time on every respawn.
echo "  ตรวจ crash-loop (เทียบ restart count ห่างกัน ${RECHECK}s)..."
sleep "$RECHECK"
AFTER2="$(snapshot)"
LOOPING=0
while IFS=: read -r n _ r1; do
  r2="$(grep "^${n}:" <<<"$AFTER2" | cut -d: -f3)"
  [[ -n $r2 && $r2 -gt $r1 ]] && { bad "$n restart เพิ่มจาก $r1 → $r2 = กำลัง crash-loop"; LOOPING=1; }
done <<<"$AFTER"
(( LOOPING )) && { echo "      ดูสาเหตุ: pm2 logs <name> --err --lines 50"; RC=1; } || ok "ไม่มี process ไหน crash-loop"

liveness || RC=1
hr
if (( RC == 0 )); then
  echo "  ✅ restart สำเร็จ ระบบกลับมาเหมือนเดิม"
  [[ $ROLE == central ]] && echo "     หมายเหตุ: 30 วินาทีแรกหน้าป้ายทะเบียนยังช้า (api-server กำลังอุ่น cache สถิติ)"
else
  echo "  ❌ ยังไม่เรียบร้อย — อ่านบรรทัด ✗ ด้านบน"
fi
exit $RC
