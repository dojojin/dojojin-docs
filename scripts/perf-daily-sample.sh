#!/usr/bin/env bash
# ============================================================
# Vigil Platform — daily performance sample (cron)
# @author Prakasit Rochanavipart (Dojo-mAn)
# @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
# @license Proprietary
# ------------------------------------------------------------
# Collects the numbers a human would otherwise have to remember to collect at
# the right moment. Two modes, two cron entries:
#
#   reset   (08:03)  archive pg_stat_statements, then reset it so the evening
#                    sample covers one working day rather than all of history
#   sample  (18:12)  run the API baseline and dump the day's slowest queries
#
# Why 18:00 and not "when it's busy": measured over 23-29 Jul, 18:00 carries
# 24,780 events/hr at only 4.8% day-to-day variation — the most repeatable hour
# there is. 07:00 is just as busy but swings 37.6% (morning ramp), so a 20%
# improvement measured there is indistinguishable from noise. Full reasoning in
# docs/superpowers/plans/2026-07-30-performance-optimization.md section 1.6.
#
# Note the regex: [[:space:]] rather than \s. Inside a double-quoted bash
# string a written \\s reaches node as \s, which JavaScript then reads as a
# plain "s" — so regexp_replace(query,'\s+',...) silently becomes "replace runs
# of the letter s with a space", and every query in the report comes out as
# "appearance  a JOIN event  e" and "raw_j on". It looked like terminal
# corruption for a while. POSIX classes need no backslash and cannot be eaten.
#
# The machine collects; a human (or Claude) reads perf-samples/ later. Nothing
# here interprets or acts — that separation is deliberate, because an unattended
# job that draws conclusions is a job nobody checks.
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/perf-samples"
# cron gets a bare PATH and node lives under nvm, so it must be addressed
# absolutely or every run dies with "node: not found" and nobody notices.
NODE="${PERF_NODE:-/home/vigil-central/.nvm/versions/node/v22.23.1/bin/node}"
MODE="${1:-sample}"
STAMP="$(date '+%Y-%m-%d')"
NOW="$(date '+%Y-%m-%d %H:%M:%S')"

mkdir -p "$OUT"
[ -x "$NODE" ] || { echo "$NOW  ไม่พบ node ที่ $NODE" >> "$OUT/cron.log"; exit 1; }

# Dump the top statements by total time. Kept in one place so both modes format
# it identically and the files stay diffable across days.
# ตั้งชื่อ connection (application_name perf_sample) — เดิมขึ้นเป็น [unknown] แล้ว perfWatch นับเป็นคิวรีสำรวจด้วยมือ (27 ต.ค.)
dump_statements() {
  cd "$ROOT/src" || return 1
  "$NODE" -e "
    require('dotenv').config({ quiet: true });
    const { Pool } = require('pg');
    const pool = new Pool({ host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, application_name: 'perf_sample',
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    pool.query(\`SELECT calls, total_exec_time::numeric(12,0) total_ms,
                       mean_exec_time::numeric(10,1) mean_ms,
                       (100*total_exec_time/NULLIF(sum(total_exec_time) OVER (),0))::numeric(5,1) pct,
                       left(regexp_replace(query,'[[:space:]]+',' ','g'),110) q
                  FROM pg_stat_statements
                 WHERE query NOT ILIKE '%pg_stat_statements%'
                 ORDER BY total_exec_time DESC LIMIT 15\`)
      .then(r => {
        console.log('pct   | calls | mean_ms | total_ms | query');
        r.rows.forEach(x => console.log([x.pct+'%', x.calls, x.mean_ms, x.total_ms, x.q].join(' | ')));
        process.exit(0);
      })
      .catch(e => { console.log('pg_stat_statements อ่านไม่ได้: ' + e.message); process.exit(0); });
  "
}

case "$MODE" in
  reset)
    F="$OUT/${STAMP}_0803_overnight.txt"
    {
      echo "# pg_stat_statements สะสมก่อน reset — $NOW"
      echo "# (ช่วงกลางคืน + ที่ค้างจากก่อนหน้า · เก็บไว้ไม่ให้หายตอน reset)"
      echo
      dump_statements
    } > "$F" 2>&1
    cd "$ROOT/src" && "$NODE" -e "
      require('dotenv').config({ quiet: true });
      const { Pool } = require('pg');
      const pool = new Pool({ host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, application_name: 'perf_sample',
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
      pool.query('SELECT pg_stat_statements_reset()').then(() => process.exit(0)).catch(() => process.exit(1));
    " && echo "$NOW  reset ok → $(basename "$F")" >> "$OUT/cron.log" \
      || echo "$NOW  reset ล้มเหลว" >> "$OUT/cron.log"
    ;;

  sample)
    F="$OUT/${STAMP}_1812.txt"
    {
      echo "# ตัวอย่างประจำวัน — $NOW"
      echo "# วัดช่วง 18:00 เพราะเป็นชั่วโมงที่โหลดสูงและผันผวนน้อยที่สุด (CV 4.8%)"
      echo
      echo "## API latency (รันสองรอบ ใช้รอบที่สอง — รอบแรก cache เย็น)"
      FIRST="$("$ROOT/scripts/perf-baseline.sh" 2>&1)"
      "$ROOT/scripts/perf-baseline.sh" 2>&1
      echo
      # รอบแรก = cache เย็น = สิ่งที่ผู้ใช้เจอจริงตอน cache หมด · /api/lpr/stats?range=7d ไม่มี period ⇒ ได้ "วันนี้"
      echo "## หน้า LPR วันนี้ — รอบแรก (cache เย็น)"
      printf '%s\n' "$FIRST" | grep -a 'lpr/stats' || echo "(ไม่พบบรรทัด lpr/stats ในรอบแรก)"
      echo
      echo "## query ที่กินเวลารวมมากสุดของวัน (นับตั้งแต่ reset 08:03)"
      dump_statements
      echo
      echo "## ปริมาณงานวันนี้"
      cd "$ROOT/src" && "$NODE" -e "
        require('dotenv').config({ quiet: true });
        const { Pool } = require('pg');
        const pool = new Pool({ host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, application_name: 'perf_sample',
          user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
        (async () => {
          const q = async (s) => (await pool.query(s)).rows[0];
          const a = await q(\"SELECT count(*)::int n, count(DISTINCT camera_id)::int cams FROM events WHERE event_time > date_trunc('day', NOW() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'\");
          const b = await q(\"SELECT pg_size_pretty(pg_database_size(current_database())) sz\");
          const c = await q(\"SELECT n_dead_tup::bigint d, n_live_tup::bigint l FROM pg_stat_user_tables WHERE relname='events_y'||to_char(NOW(),'YYYY')||'m'||to_char(NOW(),'MM')\");
          console.log('events วันนี้ถึงตอนนี้: ' + a.n.toLocaleString() + '   กล้องที่ส่ง: ' + a.cams);
          console.log('ขนาดฐานข้อมูล: ' + b.sz);
          if (c) console.log('dead tuples partition เดือนนี้: ' + Number(c.d).toLocaleString() + ' / ' + Number(c.l).toLocaleString());
          process.exit(0);
        })().catch(e => { console.log('อ่านสถิติไม่ได้: ' + e.message); process.exit(0); });
      "
    } > "$F" 2>&1
    echo "$NOW  sample ok → $(basename "$F")" >> "$OUT/cron.log"
    ;;

  *)
    echo "ใช้: $0 [reset|sample]"; exit 2 ;;
esac
