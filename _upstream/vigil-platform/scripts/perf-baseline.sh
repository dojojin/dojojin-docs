#!/usr/bin/env bash
# ============================================================
# Vigil Platform — API latency baseline
# @author Prakasit Rochanavipart (Dojo-mAn)
# @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
# @license Proprietary
# ------------------------------------------------------------
# Times the endpoints that the 2026-07-30 optimization plan is measured
# against, so "before/after" for each phase is one command instead of a
# hand-assembled table.
#
# Runs against the LOCAL api-server (127.0.0.1:3000) — going through the
# Cloudflare tunnel would measure the tunnel, not the query.
#
# Auth: creates a throwaway admin, uses it, deletes it on exit (including on
# Ctrl-C). The password is generated per run, kept in a 0600 temp file, and
# never printed or committed. It is NOT a fixture account — nothing is left
# behind to be found later.
#
#   ./scripts/perf-baseline.sh                 # print the table
#   ./scripts/perf-baseline.sh > before.txt    # keep a baseline to diff against
#
# WHEN you run this decides what the numbers mean, and "busy" is not the same
# as "comparable". Measured over 23-29 Jul: 18:00 carries 24,780 events/hr with
# only 4.8% day-to-day variation — the best hour to compare a before against an
# after. 07:00 is nearly as busy (25,600) but swings 37.6%, because it is the
# morning ramp and people leave home at slightly different times each day; a
# 20% "improvement" measured there is indistinguishable from noise. 14:00 is
# the second-best window at 5.3%.
# A run at 3am flatters everything: load there is 1/14th of peak.
# Run it twice and use the second: the first pass after a restart reads a cold
# cache, and /api/lpr/stats (60s TTL) and /api/health/details (35s TTL) serve
# cached responses, so back-to-back hits on those measure the cache, not the query.
# Avoid 03:01-03:15 entirely — the nightly pg_dump runs then.
# Full rules: docs/superpowers/plans/2026-07-30-performance-optimization.md section 1.6
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="${PERF_API:-http://127.0.0.1:3000}"
USER_NAME="zz_perf_$$"
TMP="$(mktemp -d)"
chmod 700 "$TMP"

cleanup() {
  node -e "
    require('dotenv').config();
    const { Pool } = require('pg');
    const pool = new Pool({ host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    // Delete by pattern, not just this run PID: a killed run leaves its user
    // behind, and users.email is UNIQUE, so one orphan then blocks every later
    // run with a misleading could-not-create-user message.
    // NOTE: everything inside this node -e lives in a double-quoted bash string,
    // so no double quotes anywhere below, not even in a comment. One in a
    // comment silently truncated this whole block and cleanup stopped running.
    pool.query('DELETE FROM users WHERE username LIKE \$1', ['zz_perf_%']).then(() => process.exit(0)).catch(() => process.exit(0));
  " >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

cd "$ROOT/src" || { echo "ไม่พบ $ROOT/src"; exit 1; }
openssl rand -hex 16 > "$TMP/pw"
chmod 600 "$TMP/pw"

node -e "
  require('dotenv').config();
  const { Pool } = require('pg'); const fs = require('fs');
  const pool = new Pool({ host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const auth = require('./auth');
  auth.init(pool, process.env.JWT_SECRET || process.env.SESSION_SECRET || 'x');
  auth.createUser({ username: '$USER_NAME', password: fs.readFileSync('$TMP/pw', 'utf8').trim(),
                    email: '$USER_NAME@local', full_name: 'perf baseline (temporary)', role: 'admin' },
                  { id: 1, username: 'system' })
    // createUser sets must_change_password, and that flag makes every API call
    // 403 before it reaches a route — the timings would all be meaningless.
    .then(() => pool.query(\"UPDATE users SET must_change_password = false WHERE username = '$USER_NAME'\"))
    .then(() => process.exit(0))
    .catch(e => { console.error(e.message); process.exit(1); });
" >/dev/null 2>&1 || { echo "สร้าง user ชั่วคราวไม่สำเร็จ"; exit 1; }

TOKEN="$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER_NAME\",\"password\":\"$(cat "$TMP/pw")\"}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).token||'')}catch{}})")"

if [ -z "$TOKEN" ]; then
  echo "ล็อกอินไม่สำเร็จ — ถ้าเพิ่งรันไปเมื่อกี้ ให้รอ 1 นาที (rate limit ต่อ IP) แล้วลองใหม่"
  exit 1
fi

# The endpoints the plan tracks. Keep this list stable — changing it makes old
# baselines incomparable, which is the whole point of saving them.
ENDPOINTS=(
  "/api/events?limit=50"
  "/api/lpr?limit=50"
  "/api/lpr/stats?range=7d"
  "/api/lpr/alerts?limit=15"
  "/api/faces?limit=50"
  "/api/appearances/search?limit=50"
  # มีช่วงเวลาตั้งแต่ 2026-10-02 — เดิมไม่ส่งช่วง = สแกนทั้งประวัติ 120 วิ แล้ว 500 ทุกรอบ (GOTCHAS #217)
  "/api/appearances/stats?from=$(date -u -d '-24 hours' +%Y-%m-%dT%H:%M:%SZ)"
  "/api/cameras"
  "/api/health/details"
)

echo "Vigil API baseline — $(date '+%F %T')  ($API)"
printf '%-34s %6s  %10s  %s\n' "endpoint" "http" "วินาที" "ขนาด"
printf '%s\n' "----------------------------------------------------------------------"
for u in "${ENDPOINTS[@]}"; do
  read -r code secs size < <(curl -s -o /dev/null --max-time 180 \
    -H "Authorization: Bearer $TOKEN" -w '%{http_code} %{time_total} %{size_download}' "$API$u")
  printf '%-34s %6s  %9ss  %s\n' "$u" "$code" "$secs" \
    "$(numfmt --to=iec --suffix=B "${size:-0}" 2>/dev/null || echo "${size}B")"
done
