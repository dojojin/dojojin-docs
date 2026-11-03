// ============================================================
// Vigil Platform — Host performance series (graphs)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Read side of metrics_host. Deliberately NOT part of /api/health/details:
// that endpoint already returns eighteen top-level keys and carries its own
// diagnostics_ms because it has been slow before. Graph data is wanted only
// when the Performance tab is open, so it gets its own route and is fetched
// then — the same lazy-per-tab shape the LPR page settled on.
'use strict';

// Downsampling is chosen from the range, not asked of the caller. The target is
// 300-500 points: enough that a spike is visible, few enough that Chart.js is
// not asked to draw a week of minute samples (10,080 points) into 600 pixels.
// Without this a 30-day view would ship ~43k rows per series per machine.
function bucketFor(fromMs, toMs) {
  const hours = (toMs - fromMs) / 3600_000;
  if (hours <= 6)   return { interval: '1 minute',   sec: 60 };
  if (hours <= 24)  return { interval: '5 minutes',  sec: 300 };
  if (hours <= 24 * 7)  return { interval: '30 minutes', sec: 1800 };
  if (hours <= 24 * 30) return { interval: '2 hours',    sec: 7200 };
  if (hours <= 24 * 90) return { interval: '6 hours',    sec: 21600 };
  // Beyond a quarter the tiers have to keep coarsening or the point count runs
  // away: a year at 6-hour bins is 1,460 points, well past what is readable.
  if (hours <= 24 * 365) return { interval: '1 day',  sec: 86400 };
  return { interval: '2 days', sec: 172800 };
}

// Least-squares slope of free space over the window, turned into days-to-zero.
// Returns null when the disk is flat or growing — no honest number to give.
function diskForecast(rows) {
  const pts = rows
    .filter(r => r.disk_free_gb != null)
    .map(r => ({ x: new Date(r.t).getTime() / 86400_000, y: Number(r.disk_free_gb) }));
  if (pts.length < 10) return null;            // too little history to claim a trend
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  if (den === 0) return null;
  const slope = num / den;                     // GB per day, negative = filling
  if (slope >= -0.01) return null;             // flat or freeing up
  const latest = pts[pts.length - 1].y;
  const days = latest / -slope;
  return { gb_per_day: +(-slope).toFixed(2), days_to_full: Math.round(days) };
}

module.exports = function registerMetricsRoutes(app, pool, { auth, routeError }) {
  // Which machines have ever reported, so the UI can build its selector without
  // hardcoding site ids that change when a site is added.
  app.get('/api/metrics/sources', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT source,
               max(sampled_at)                        AS last_sample_at,
               max(mem_total_mb)                      AS mem_total_mb,
               max(disk_total_gb)                     AS disk_total_gb,
               (max(sampled_at) > now() - interval '5 minutes') AS reporting
        FROM metrics_host
        GROUP BY source ORDER BY (source <> 'central'), source
      `);
      res.json({ sources: rows });
    } catch (e) { routeError(res, e, 'metrics/sources'); }
  });

  // Per-device activity over time.
  //
  // NOT network bytes, and the distinction is deliberate. Byte counters would
  // have to come from the ingesters, and their streams are per DEVICE, not per
  // camera: dahua-cgi holds one eventManager and one snapManager per box
  // (connectDevice / openSnapStream), so on a 2-channel NVR the two channels
  // share a socket and cannot be told apart. Getting even per-device bytes off
  // an edge would need a new MQTT publisher inside an ingester that is running
  // in production on live police sites.
  //
  // What the events table already knows — how much each camera is actually
  // producing — answers the maintenance question ("has this one gone quiet?")
  // without any of that, and reads in 341ms over 7 days thanks to partition
  // pruning (measured, 2026-07-27). Host-level Mbps, which IS real network
  // utilisation, is on the /host series above.
  app.get('/api/metrics/device', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const toMs = req.query.to ? Date.parse(req.query.to) : Date.now();
      const fromMs = req.query.from ? Date.parse(req.query.from) : toMs - 6 * 3600_000;
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
        return res.status(400).json({ error: 'bad range' });
      }
      // Shorter ceiling than the host series: this one scans events, not a
      // purpose-built table, and a 90-day sweep of a 3.7M-row partition set is
      // not something a tab should be able to ask for by accident.
      if (toMs - fromMs > 31 * 86400_000) return res.status(400).json({ error: 'range too long' });

      const bucket = bucketFor(fromMs, toMs);
      const limit = Math.min(12, Math.max(1, parseInt(req.query.top, 10) || 8));
      const ids = String(req.query.ids || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 12);

      // Busiest first when the caller does not name any — an operator opening
      // this cold wants the cameras carrying the load, not the alphabetical top.
      const params = [fromMs / 1000, toMs / 1000];
      let idFilter = '';
      if (ids.length) { params.push(ids); idFilter = 'AND camera_id = ANY($3)'; }
      const { rows } = await pool.query(`
        WITH win AS (
          SELECT camera_id, event_time FROM events
          WHERE event_time >= to_timestamp($1) AND event_time <= to_timestamp($2) ${idFilter}
        ), top AS (
          SELECT camera_id FROM win GROUP BY camera_id ORDER BY count(*) DESC LIMIT ${limit}
        )
        SELECT w.camera_id, date_bin($${params.length + 1}::interval, w.event_time, TIMESTAMPTZ 'epoch') AS t,
               count(*)::int AS events
        FROM win w JOIN top USING (camera_id)
        GROUP BY 1, 2 ORDER BY 1, 2
      `, [...params, bucket.interval]);

      const byCam = new Map();
      for (const r of rows) {
        if (!byCam.has(r.camera_id)) byCam.set(r.camera_id, []);
        byCam.get(r.camera_id).push({ t: r.t, events: r.events });
      }
      res.json({
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        bucket_sec: bucket.sec,
        series: [...byCam.entries()].map(([camera_id, points]) => ({ camera_id, points })),
      });
    } catch (e) { routeError(res, e, 'metrics/device'); }
  });

  app.get('/api/metrics/host', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const source = String(req.query.source || '').trim();
      if (!source) return res.status(400).json({ error: 'source required' });

      const toMs = req.query.to ? Date.parse(req.query.to) : Date.now();
      const fromMs = req.query.from ? Date.parse(req.query.from) : toMs - 6 * 3600_000;
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
        return res.status(400).json({ error: 'bad range' });
      }
      // A caller asking for ten years would otherwise scan the whole table for
      // a graph nobody can read.
      if (toMs - fromMs > 731 * 86400_000) return res.status(400).json({ error: 'range too long' });

      const bucket = bucketFor(fromMs, toMs);
      const { rows } = await pool.query(`
        WITH b AS (
          SELECT date_bin($4::interval, sampled_at, TIMESTAMPTZ 'epoch') AS t,
                 -- Rounded in SQL, not in the browser: avg() returns numeric,
                 -- which node-postgres hands over as a full-precision string
                 -- ("4482.0000000000000000") and bloats every payload.
                 round(avg(cpu_pct)::numeric, 1)::float8     AS cpu_pct,
                 round(avg(load_avg_1m)::numeric, 2)::float8 AS load_avg_1m,
                 round(avg(mem_used_mb))::int                AS mem_used_mb,
                 max(mem_total_mb)  AS mem_total_mb,
                 min(disk_free_gb)  AS disk_free_gb,
                 max(disk_total_gb) AS disk_total_gb,
                 -- Counters are cumulative, so the bucket's last value is the
                 -- one that matters; averaging them would be meaningless.
                 max(net_rx_bytes)  AS rx,
                 max(net_tx_bytes)  AS tx,
                 -- % of the bucket the tunnel/tailnet was up, not a last-value
                 -- snapshot — a bucket that flapped reads as e.g. 60%, not a
                 -- coin flip between 0 and 100 depending on which sample landed last.
                 round(avg(tunnel_up)::numeric    * 100, 0)::float8 AS tunnel_pct,
                 round(avg(tailscale_up)::numeric * 100, 0)::float8 AS tailscale_pct
          FROM metrics_host
          WHERE source = $1 AND sampled_at >= to_timestamp($2) AND sampled_at <= to_timestamp($3)
          GROUP BY 1
        )
        SELECT t, cpu_pct, load_avg_1m, mem_used_mb, mem_total_mb, disk_free_gb, disk_total_gb,
               tunnel_pct, tailscale_pct,
               -- Bytes/sec from the delta against the previous bucket. A negative
               -- delta means the counter reset (reboot) — report null so the line
               -- breaks instead of drawing a spike that never happened.
               CASE WHEN lag(rx) OVER w IS NULL OR rx < lag(rx) OVER w THEN NULL
                    ELSE round(((rx - lag(rx) OVER w) / NULLIF(EXTRACT(EPOCH FROM (t - lag(t) OVER w)), 0))::numeric, 1)::float8
               END AS rx_bps,
               CASE WHEN lag(tx) OVER w IS NULL OR tx < lag(tx) OVER w THEN NULL
                    ELSE round(((tx - lag(tx) OVER w) / NULLIF(EXTRACT(EPOCH FROM (t - lag(t) OVER w)), 0))::numeric, 1)::float8
               END AS tx_bps
        FROM b
        WINDOW w AS (ORDER BY t)
        ORDER BY t
      `, [source, fromMs / 1000, toMs / 1000, bucket.interval]);

      res.json({
        source,
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        bucket_sec: bucket.sec,
        points: rows.length,
        series: rows,
        // Straight-line projection from the observed slope over the window.
        // Crude on purpose — the value is "roughly when do I need to act", and
        // the two disk incidents this platform has had were both of the "nobody
        // was watching the trend" kind, not the "the model was imprecise" kind.
        disk_forecast: diskForecast(rows),
      });
    } catch (e) { routeError(res, e, 'metrics/host'); }
  });

};

module.exports.bucketFor = bucketFor;
module.exports.diskForecast = diskForecast;
