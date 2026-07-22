// ============================================================
// Vigil Platform — Routes: LPR Query (Gallery API)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { siteWhere } = require('../auth');
const { DAHUA_CATEGORY_TO_HIK_VTYPE, DAHUA_BRAND_FIX, DAHUA_BRAND_UNKNOWN, dahuaRgbaToName } = require('../ingesters/dahua-protocol');
const { xyzToColorName } = require('../color-utils');

// Local "now" in Bangkok (timestamp without tz).
const BKK = `(NOW() AT TIME ZONE 'Asia/Bangkok')`;
// IMPORTANT: api-server forces every connection to SET TIME ZONE 'UTC' (api-server.js:74),
// so a bare `... ::date` boundary would resolve to UTC midnight (= 07:00 Bangkok), dropping
// the first 7h of each local day. Convert the Bangkok-local boundary back to timestamptz with
// `AT TIME ZONE 'Asia/Bangkok'` so day/week/month windows are correct regardless of session TZ.
// NB: ::date::timestamp is required — `date AT TIME ZONE` would cast date→timestamptz
// (wrong direction) and shift the boundary by the session offset.
const BKK_DAY  = `${BKK}::date::timestamp AT TIME ZONE 'Asia/Bangkok'`;

// SQL boolean on e.event_time for a named period. from/to (ISO) used for 'custom'.
// Returns { sql, args } — args are appended positionally by the caller.
function periodClause(period, from, to, startIdx) {
  switch (period) {
    case 'hour':      return { sql: `e.event_time >= NOW() - INTERVAL '1 hour'`, args: [] };
    case 'yesterday': return { sql: `e.event_time >= ${BKK_DAY} - INTERVAL '1 day' AND e.event_time < ${BKK_DAY}`, args: [] };
    case 'week':      return { sql: `e.event_time >= date_trunc('week',  ${BKK}) AT TIME ZONE 'Asia/Bangkok'`, args: [] };
    case 'month':     return { sql: `e.event_time >= date_trunc('month', ${BKK}) AT TIME ZONE 'Asia/Bangkok'`, args: [] };
    case 'custom': {
      // Compute the placeholder index BEFORE push (args.length is the next slot,
      // 0-based → $startIdx, $startIdx+1). Pushing first made it $2/$3 with only
      // 2 args → $1 unbound → "could not determine data type of parameter $1".
      // ::timestamptz cast keeps the bound params typed.
      const conds = [], args = [];
      if (from) { conds.push(`e.event_time >= $${startIdx + args.length}::timestamptz`); args.push(from); }
      if (to)   { conds.push(`e.event_time <= $${startIdx + args.length}::timestamptz`); args.push(to); }
      return { sql: conds.length ? conds.join(' AND ') : 'TRUE', args };
    }
    case 'today':
    default:          return { sql: `e.event_time >= ${BKK_DAY}`, args: [] };
  }
}

module.exports = function lprQueryRoutes(app, pool) {
  // 20s TTL keyed by period+from+to+cameras+site — same approach as
  // appearances/stats (decision #181/#190). CEN-004: multiple dashboard
  // clients were re-running the same 10-query batch on every load.
  let _lprStatsCache = null, _lprStatsCacheAt = 0, _lprStatsCacheKey = '';
  const LPR_STATS_TTL_MS = 20_000;

  // GET /api/lpr — paginated ANPR list with license_plates JOIN
  // Params: q, camera, region, vehicle_color, plate_color, lane, has_plate, from, to
  app.get('/api/lpr', async (req, res) => {
    const { q, camera, region, vehicle_type, vehicle_color, plate_color, lane, has_plate, from, to } = req.query;
    const limit  = Math.min(parseInt(req.query.limit,  10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0,   0);

    const where = [];
    const args  = [];
    const add = (clause, val) => { args.push(val); where.push(clause.replace('$$', `$${args.length}`)); };

    // Default = substring (ILIKE %q%) so "งต499" also surfaces near reads like
    // "งต4990". exact=1 (the "ตรงตัวเป๊ะ" checkbox) switches to an equality match.
    // Plate_number is stored space-less (the plaque renders the gap), so strip any
    // spaces the user typed before comparing — keeps the idx_plates_number index.
    if (q && req.query.exact === '1') add(`lp.plate_number = $$`, q.trim().replace(/\s+/g, ''));
    else if (q)                       add(`lp.plate_number ILIKE $$`, `%${q.trim()}%`);
    if (camera) add(`e.camera_id = $$`, camera);   // legacy single (kept for back-compat)
    // cameras = csv → MultiPicker multi-select (mirror events.js camera_id = ANY)
    if (req.query.cameras) {
      const arr = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length) add(`e.camera_id = ANY($$)`, arr);
    }
    if (region)       add(`lp.region = $$`, region);
    if (vehicle_type) add(`lp.vehicle_type = $$`, vehicle_type);
    if (lane)         add(`e.raw_json->>'laneNo' = $$`, lane);

    if (vehicle_color === 'unknown') where.push(`(lp.vehicle_color = 'unknown' OR lp.vehicle_color IS NULL)`);
    else if (vehicle_color) add(`lp.vehicle_color = $$`, vehicle_color);

    if (plate_color === '__unknown' || plate_color === 'unknown')
      where.push(`(lp.plate_color IS NULL OR lp.plate_color = 'unknown')`);
    else if (plate_color) add(`lp.plate_color = $$`, plate_color);

    // MultiPicker multi-select (csv → ANY). Additive — single params above kept for
    // back-compat. 'unknown'/'__unknown' in the set also matches NULL (mirrors single).
    const csv = (v) => String(v).split(',').map(s => s.trim()).filter(Boolean);
    if (req.query.regions)       { const a = csv(req.query.regions);       if (a.length) add(`lp.region = ANY($$)`, a); }
    if (req.query.vehicle_types) { const a = csv(req.query.vehicle_types); if (a.length) add(`lp.vehicle_type = ANY($$)`, a); }
    if (req.query.lanes)         { const a = csv(req.query.lanes);         if (a.length) add(`e.raw_json->>'laneNo' = ANY($$)`, a); }
    if (req.query.vehicle_colors) {
      const a = csv(req.query.vehicle_colors);
      if (a.length) add(a.includes('unknown') ? `(lp.vehicle_color = ANY($$) OR lp.vehicle_color IS NULL)` : `lp.vehicle_color = ANY($$)`, a);
    }
    if (req.query.plate_colors) {
      // '__unknown' is the UI sentinel for "ไม่ทราบ"; the stored plateColor is 'unknown'.
      // Must translate before = ANY(), or it matches the literal '__unknown' (→ 0 rows).
      const a = csv(req.query.plate_colors).map(s => s === '__unknown' ? 'unknown' : s);
      if (a.length) add(a.includes('unknown') ? `(lp.plate_color = ANY($$) OR lp.plate_color IS NULL)` : `lp.plate_color = ANY($$)`, a);
    }
    // vehicle_brands = Hik numeric brand codes ('1060', '0'=ไม่ทราบ); mapped to names client-side.
    if (req.query.vehicle_brands) { const a = csv(req.query.vehicle_brands); if (a.length) add(`lp.vehicle_brand = ANY($$)`, a); }

    if (has_plate === '1') where.push(`lp.plate_number <> 'unknown'`);
    else if (has_plate === '0') where.push(`lp.plate_number = 'unknown'`);

    if (from) add(`e.event_time >= $$`, from);
    if (to)   add(`e.event_time <= $$`, to);

    // dup filter — local (ป้ายซ้ำ ≥2 = ในพื้นที่) / visitor (ป้ายไม่ซ้ำ =1 = ต่างถิ่น).
    // Counts each plate's appearances within the SAME period (from/to) — mirrors the
    // overview KPI. Subquery's from/to get their own placeholders appended after the
    // main args (limit/offset are added last), so positions stay correct.
    const dup = req.query.dup;
    if (dup === 'local' || dup === 'visitor') {
      where.push(`lp.plate_number <> 'unknown'`);
      let periodSub = '';
      if (from) { args.push(from); periodSub += ` AND e2.event_time >= $${args.length}`; }
      if (to)   { args.push(to);   periodSub += ` AND e2.event_time <= $${args.length}`; }
      where.push(`(SELECT COUNT(*) FROM events e2 JOIN license_plates lp2 ON lp2.event_id = e2.id
                    WHERE lp2.plate_number = lp.plate_number AND lp2.plate_number <> 'unknown'${periodSub}) ${dup === 'local' ? '>= 2' : '= 1'}`);
    }

    // mismatch — สงสัยสวมทะเบียน: ป้ายเดียวกัน vehicle_type ต่าง ≥2 ชนิดในช่วงนี้.
    // Period-scoped subquery (args appended after main args, before limit/offset).
    if (req.query.mismatch === '1') {
      where.push(`lp.plate_number <> 'unknown'`);
      // Same-province only (Approach A): a plate read across provinces is an OCR
      // province misread, not a swap — so the type-variance must be within ONE
      // province, and the row itself must have a real province.
      where.push(`lp.region IS NOT NULL AND lp.region <> '' AND lp.region <> 'ไม่ทราบ'`);
      let periodSub = '';
      if (from) { args.push(from); periodSub += ` AND e3.event_time >= $${args.length}`; }
      if (to)   { args.push(to);   periodSub += ` AND e3.event_time <= $${args.length}`; }
      where.push(`(SELECT COUNT(DISTINCT lp3.vehicle_type) FROM events e3 JOIN license_plates lp3 ON lp3.event_id = e3.id
                    WHERE lp3.plate_number = lp.plate_number AND lp3.region = lp.region AND lp3.vehicle_type IS NOT NULL AND lp3.vehicle_type <> 'unknown'${periodSub}) >= 2`);
      // operator-dismissed plates are no longer suspects → drop from the filter
      where.push(`NOT EXISTS (SELECT 1 FROM lpr_mismatch_dismissals d WHERE d.plate_number = lp.plate_number)`);
    }

    // no-helmet — มอเตอร์ไซค์ไม่ใส่หมวก. Parsed to an indexed column at ingest
    // (migration 085, idx_plates_no_helmet) — was a raw_json->> detoast.
    if (req.query.helmet === 'no') where.push(`lp.no_helmet = true`);
    // pillion passenger — มอเตอร์ไซค์มีคนซ้อนท้าย
    if (req.query.passenger === 'yes') where.push(`e.raw_json->>'nonMotorManned' = 'yes'`);
    // pillion overload — ซ้อนตั้งแต่ 3 คนขึ้นไป (รวมคนขับ). Dahua ITC431-only;
    // parsed to an indexed column at ingest (migration 090, idx_plates_rider_count_3plus).
    if (req.query.passenger === '3plus') where.push(`lp.rider_count >= 3`);
    // seatbelt — ผู้ขับขี่/ผู้โดยสารไม่คาดเข็มขัด. Parsed to an indexed column at
    // ingest (migration 073) — was a rawXml LIKE seq scan. Partial index on the
    // flagged rows; NULL/false read as not-flagged.
    if (req.query.belt === 'no') where.push(`lp.no_seatbelt = true`);

    // Site-RBAC P2
    const swLpr = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', args.length + 1);
    if (swLpr.sql) { where.push(swLpr.sql.replace(/^AND /, '')); args.push(...swLpr.args); }
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // P1 keyset pagination — a cursor (before_time, before_id) seeks the index
    // instead of OFFSET scanning+discarding. Appended ONLY to the page query, not
    // to the estimate (which counts all rows matching the filters). Stable tie-break
    // on id. Legacy `offset` still honoured for the latest-grid / CSV callers (which
    // always pass offset 0), so this is backward-compatible.
    let pageWhere = wc, pageArgs = [...args];
    if (req.query.before_time && req.query.before_id) {
      pageArgs.push(req.query.before_time, req.query.before_id);
      const p1 = pageArgs.length - 1, p2 = pageArgs.length;
      pageWhere = (wc ? wc + ' AND ' : 'WHERE ') + `(e.event_time, e.id) < ($${p1}, $${p2}::bigint)`;
    }
    const fetchLimit = limit + 1;  // +1 row → know hasMore without a COUNT

    try {
      // Estimate total (opt-in via ?count=est) from the planner — no scan. Replaces
      // the exact COUNT(*) that was O(matching rows). Frontend shows exact when it
      // reaches the last page (hasMore=false); otherwise this "≈" figure.
      let estimate = null;
      if (req.query.count === 'est') {
        try {
          const ex = await pool.query(
            `EXPLAIN (FORMAT JSON) SELECT 1 FROM events e JOIN license_plates lp ON lp.event_id = e.id ${wc}`,
            args);
          estimate = ex.rows[0]['QUERY PLAN'][0]['Plan']['Plan Rows'];
        } catch { /* estimate is best-effort */ }
      }

      const rows = await pool.query(
        `SELECT e.id, e.camera_id, e.event_time, e.event_type,
                e.snapshot_filename AS snapshot_file, e.raw_json,
                lp.plate_number, lp.region AS lp_region,
                lp.vehicle_type AS lp_vehicle_type,
                lp.vehicle_color AS lp_vehicle_color,
                lp.vehicle_brand AS lp_vehicle_brand,
                lp.plate_image, lp.confidence
         FROM events e
         JOIN license_plates lp ON lp.event_id = e.id
         ${pageWhere}
         ORDER BY e.event_time DESC, e.id DESC
         LIMIT $${pageArgs.length + 1} OFFSET $${pageArgs.length + 2}`,
        [...pageArgs, fetchLimit, offset]
      );
      const hasMore = rows.rows.length > limit;
      const result = hasMore ? rows.rows.slice(0, limit) : rows.rows;
      // Plate-swap badge enrichment — per-plate over a FIXED 30d window, keyed ONLY
      // on the returned plate-set. Deliberately does NOT reuse the search WHERE:
      // reusing it would mean filtering by vehicle_type collapses each plate to a
      // single type and silently kills swap detection exactly when it matters.
      const plates = [...new Set(result.map(r => r.plate_number).filter(p => p && p !== 'unknown'))];
      if (plates.length) {
        const { rows: mm } = await pool.query(
          // Per (plate, region), then take the province with the most type-variance
          // — cross-province reads (province misread) don't inflate the badge level.
          `WITH pr AS (
             SELECT lp.plate_number,
                    COUNT(DISTINCT lp.vehicle_type)  FILTER (WHERE lp.vehicle_type  IS NOT NULL AND lp.vehicle_type  <> 'unknown') AS nt,
                    COUNT(DISTINCT lp.vehicle_color) FILTER (WHERE lp.vehicle_color IS NOT NULL AND lp.vehicle_color <> 'unknown') AS nc,
                    COUNT(DISTINCT lp.vehicle_brand) FILTER (WHERE lp.vehicle_brand IS NOT NULL AND lp.vehicle_brand <> 'unknown' AND lp.vehicle_brand <> '') AS nb
               FROM events e JOIN license_plates lp ON lp.event_id = e.id
              WHERE lp.plate_number = ANY($1) AND e.event_time >= NOW() - INTERVAL '30 days'
                AND lp.region IS NOT NULL AND lp.region <> '' AND lp.region <> 'ไม่ทราบ'
              GROUP BY lp.plate_number, lp.region
           )
           SELECT DISTINCT ON (plate_number) plate_number, nt, nc, nb
             FROM pr ORDER BY plate_number, nt DESC, (nc + nb) DESC`,
          [plates]
        );
        const lvl = {};
        for (const m of mm) {
          const nt = +m.nt;  // level 0 unless vehicle_type itself differs (>=2)
          lvl[m.plate_number] = nt >= 2 ? 1 + (+m.nc >= 2 ? 1 : 0) + (+m.nb >= 2 ? 1 : 0) : 0;
        }
        // Operator dismissals (per-plate). Keep mismatch_level RAW — the badge/KPI/
        // filter treat dismissed plates as not-suspect, but the modal still shows the
        // comparison + a re-arm button, so we expose dismissed separately.
        const { rows: dis } = await pool.query(
          `SELECT plate_number, dismissed_by, dismissed_at FROM lpr_mismatch_dismissals WHERE plate_number = ANY($1)`,
          [plates]);
        const disMap = {};
        for (const d of dis) disMap[d.plate_number] = d;
        for (const r of result) {
          r.mismatch_level = lvl[r.plate_number] || 0;
          const d = disMap[r.plate_number];
          r.mismatch_dismissed = !!d;
          if (d) { r.mismatch_dismissed_by = d.dismissed_by; r.mismatch_dismissed_at = d.dismissed_at; }
        }
      }
      res.set('X-Has-More', hasMore ? '1' : '0');
      if (estimate != null) res.set('X-Estimated-Count', String(Math.max(0, Math.round(estimate))));
      res.json(result);
    } catch (e) {
      console.error('[lpr-query] GET /api/lpr:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/brands — distinct vehicle-brand codes present in data (+ count) to
  // populate the brand filter. Codes → names resolve client-side via _LPR_BRAND.
  app.get('/api/lpr/brands', async (req, res) => {
    try {
      const swBr = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', 1);
      const { rows } = await pool.query(
        `SELECT lp.vehicle_brand AS brand, COUNT(*)::int AS n
           FROM license_plates lp
           JOIN events e ON e.id = lp.event_id
          WHERE lp.vehicle_brand IS NOT NULL AND lp.vehicle_brand <> '' ${swBr.sql}
          GROUP BY lp.vehicle_brand ORDER BY n DESC`,
        swBr.args
      );
      res.json(rows);
    } catch (e) {
      console.error('[lpr-query] GET /api/lpr/brands:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/plate-history?plate=X — recent reads of one plate for the
  // mismatch comparison modal: surfaces the temporal sequence (รอบก่อน → รอบนี้).
  // Optional params (default = old behaviour, unused by the mismatch caller so
  // it stays byte-identical): region (exact-province match, for the repeat-plate
  // modal — a plate read in another province is an OCR misread, not the same
  // repeat), hours (window, default 720=30d), limit (default 50).
  app.get('/api/lpr/plate-history', async (req, res) => {
    const plate = String(req.query.plate || '').trim();
    if (!plate || plate === 'unknown') return res.json([]);
    const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 720, 1), 720);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 50);
    const region = req.query.region ? String(req.query.region).trim() : null;
    try {
      const args = [plate, hours];
      let regionSql = '';
      if (region) { args.push(region); regionSql = ` AND lp.region = $${args.length}`; }
      const swPh = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', args.length + 1);
      const { rows } = await pool.query(
        `SELECT e.id, e.event_time, e.camera_id,
                e.snapshot_filename AS snapshot_file,
                lp.vehicle_type, lp.vehicle_color, lp.vehicle_brand, lp.plate_image, lp.region
           FROM events e JOIN license_plates lp ON lp.event_id = e.id
          WHERE lp.plate_number = $1 AND e.event_time >= NOW() - make_interval(hours => $2::int)${regionSql} ${swPh.sql}
          ORDER BY e.event_time DESC
          LIMIT ${limit}`,
        [...args, ...swPh.args]
      );
      res.json(rows);
    } catch (e) {
      console.error('[lpr-query] GET /api/lpr/plate-history:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/no-read — ANPR events the camera couldn't read a plate for
  // (no license_plates row). "ไม่ทราบทะเบียน" tab (2026-07-18, precedent: the
  // สภ.หาดใหญ่ LPRMonitor reference system shows these too). Dahua only for
  // now — data.Vehicle still carries category/color/brand even without a
  // plate read; Hikvision drops these events entirely upstream (separate,
  // near-zero-volume gap, not covered here).
  //
  // Deliberately queried straight off `events`, NEVER joined into
  // license_plates: these rows must stay out of every plate-keyed query
  // (mismatch/repeat-history/dup group by plate_number+region — a shared
  // NULL/'unknown' sentinel across 800+/day rows would collapse them into
  // one fake mega-group and corrupt those features).
  app.get('/api/lpr/no-read', async (req, res) => {
    const { from, to } = req.query;
    const limit  = Math.min(parseInt(req.query.limit,  10) || 30, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0,   0);

    const where = [`e.event_type = 'anprAlarm'`, `lp.id IS NULL`];
    const args  = [];
    const add = (clause, val) => { args.push(val); where.push(clause.replace('$$', `$${args.length}`)); };

    if (req.query.cameras) {
      const arr = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length) add(`e.camera_id = ANY($$)`, arr);
    }
    if (from) add(`e.event_time >= $$`, from);
    if (to)   add(`e.event_time <= $$`, to);

    const swNr = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', args.length + 1);
    if (swNr.sql) { where.push(swNr.sql.replace(/^AND /, '')); args.push(...swNr.args); }
    const wc = 'WHERE ' + where.join(' AND ');

    try {
      const { rows: cnt } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM events e LEFT JOIN license_plates lp ON lp.event_id = e.id ${wc}`, args);
      const total = cnt[0]?.n || 0;

      const { rows } = await pool.query(
        `SELECT e.id, e.camera_id, e.event_time,
                e.snapshot_filename AS snapshot_file,
                e.raw_json->'data'->'Vehicle' AS vehicle
           FROM events e LEFT JOIN license_plates lp ON lp.event_id = e.id
           ${wc}
           ORDER BY e.event_time DESC, e.id DESC
           LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, limit, offset]
      );

      const out = rows.map(r => {
        const v = r.vehicle || {};
        const category = v.Category || null;
        const vehicle_type = DAHUA_CATEGORY_TO_HIK_VTYPE[category] || null;
        const rawBrand = (typeof v.Text === 'string' && v.Text.trim()) || null;
        const vehicle_brand = (!rawBrand || DAHUA_BRAND_UNKNOWN.has(rawBrand)) ? null : (DAHUA_BRAND_FIX[rawBrand] || rawBrand);
        const vehicle_color = dahuaRgbaToName(v.MainColor, xyzToColorName);
        const confidence = Number.isFinite(v.Confidence) ? Math.round((v.Confidence / 255) * 100) : null;
        return {
          id: r.id, camera_id: r.camera_id, event_time: r.event_time,
          snapshot_file: r.snapshot_file,
          plate_number: null, lp_region: null,
          lp_vehicle_type: vehicle_type, lp_vehicle_color: vehicle_color,
          lp_vehicle_brand: vehicle_brand, plate_image: null,
          confidence, raw_json: {},
        };
      });
      res.set('X-Total-Count', String(total));
      res.json(out);
    } catch (e) {
      console.error('[lpr-query] GET /api/lpr/no-read:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // POST /api/lpr/mismatch/:plate/dismiss — operator marks a plate's swap-suspect
  // as a false positive (e.g. OCR misread plate/province). DELETE re-arms it.
  // Per-plate, audited (who/when/why). Dismissed plates drop from KPI/badge/filter.
  app.post('/api/lpr/mismatch/:plate/dismiss', async (req, res) => {
    const plate = String(req.params.plate || '').trim();
    if (!plate || plate === 'unknown') return res.status(400).json({ error: 'bad_plate' });
    const reason = (req.body && req.body.reason) ? String(req.body.reason).slice(0, 500) : null;
    try {
      const r = await pool.query(
        `INSERT INTO lpr_mismatch_dismissals (plate_number, dismissed_by, dismissed_by_id, dismissed_at, reason)
              VALUES ($1, $2, $3, now(), $4)
         ON CONFLICT (plate_number) DO UPDATE
              SET dismissed_by = EXCLUDED.dismissed_by, dismissed_by_id = EXCLUDED.dismissed_by_id,
                  dismissed_at = now(), reason = EXCLUDED.reason
         RETURNING dismissed_by, dismissed_at`,
        [plate, req.user?.username || null, req.user?.id || null, reason]);
      res.json({ plate_number: plate, dismissed: true, ...r.rows[0] });
    } catch (e) {
      console.error('[lpr-query] POST mismatch dismiss:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.delete('/api/lpr/mismatch/:plate/dismiss', async (req, res) => {
    const plate = String(req.params.plate || '').trim();
    if (!plate) return res.status(400).json({ error: 'bad_plate' });
    try {
      await pool.query('DELETE FROM lpr_mismatch_dismissals WHERE plate_number = $1', [plate]);
      res.json({ plate_number: plate, dismissed: false });
    } catch (e) {
      console.error('[lpr-query] DELETE mismatch dismiss:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/lpr/stats — period-aware KPIs + chart data (Asia/Bangkok)
  // Params: period (hour|today|yesterday|week|month|custom), from, to
  app.get('/api/lpr/stats', async (req, res) => {
    const period = String(req.query.period || 'today');
    const _allowedStr = req.user?.isSiteScoped ? (req.user.allowedSites || []).join(',') : '';
    const _cacheKey = `${period}|${req.query.from||''}|${req.query.to||''}|${req.query.cameras||''}|${_allowedStr}`;
    const _now = Date.now();
    if (_lprStatsCache && _lprStatsCacheKey === _cacheKey && _now - _lprStatsCacheAt < LPR_STATS_TTL_MS) {
      return res.json(_lprStatsCache);
    }

    const pc = periodClause(period, req.query.from, req.query.to, 1);
    const swSt = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', pc.args.length + 1);
    let stSql = swSt.sql ? `${pc.sql} ${swSt.sql}` : pc.sql;
    const stArgs = [...pc.args, ...swSt.args];
    // In-page site-pill filter (admin/auditor only — allowedSites already
    // narrows viewers). Appended BEFORE `base` is derived so every one of
    // the events-based subqueries below inherits it.
    let camList = null;
    if (req.query.cameras) {
      const a = String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean);
      if (a.length) { camList = a; stArgs.push(a); stSql += ` AND e.camera_id = ANY($${stArgs.length})`; }
    }
    try {
      // CEN-004 part 2/2: materialize the events⋈license_plates filtered set ONCE
      // (mirrors appearances/stats' _app_stats_filtered pattern) instead of every
      // one of the 8 queries below re-scanning+re-filtering events independently.
      // dirCams (cameras-only, never touches events) and perCamera (broader base —
      // events WITHOUT requiring a license_plates row, so it must stay separate or
      // it would silently undercount vehicle detections with no plate read) are the
      // only two that can't fold into this temp table — kept as their original queries.
      const client = await pool.connect();
      let kpi, dup, hourly, province, vtype, direction, dirCams, pcolor, brand, perCamera;
      try {
        await client.query('BEGIN');
        await client.query(
          `CREATE TEMP TABLE _lpr_stats_filtered ON COMMIT DROP AS
             SELECT e.id, e.camera_id, e.event_time, lp.plate_number, lp.region,
                    lp.vehicle_type, lp.plate_color, lp.vehicle_brand, lp.no_helmet, lp.rider_count
               FROM events e JOIN license_plates lp ON lp.event_id = e.id WHERE ${stSql}`,
          stArgs
        );

        [kpi, dup, hourly, province, vtype, direction, dirCams, pcolor, brand, perCamera] = await Promise.all([
          client.query(
            `SELECT COUNT(*) AS total,
                    COUNT(DISTINCT f.plate_number) FILTER (WHERE f.plate_number <> 'unknown') AS unique,
                    COUNT(*) FILTER (WHERE f.plate_number = 'unknown')                         AS noread,
                    COUNT(*) FILTER (WHERE w.plate_number IS NOT NULL)                         AS watch,
                    COUNT(*) FILTER (WHERE f.no_helmet)                                        AS no_helmet,
                    COUNT(*) FILTER (WHERE f.rider_count >= 3)                                 AS overload
               FROM _lpr_stats_filtered f
               LEFT JOIN lpr_watchlist w ON w.plate_number = UPPER(f.plate_number) AND w.active`
          ),
          // Per-plate aggregation over the period → local/visitor + plate-swap suspect.
          //   local (ป้ายซ้ำ ≥2 = รถในพื้นที่) · visitor (ป้ายไม่ซ้ำ =1 = รถต่างถิ่น) · sum = distinct.
          //   mismatch = ป้ายเดียวกันแต่ vehicle_type ต่างกัน ≥2 ชนิด → สงสัยสวมทะเบียน.
          //   (color/brand เพิ่มความเชื่อมั่นของ level — คำนวณราย row ตอน search, ไม่ใช่ KPI รวม)
          client.query(
            // Mismatch is grouped by (plate_number, region): a plate read in two
            // provinces (usually an OCR province misread, not a real swap) no longer
            // inflates the count — a plate is flagged only if SOME single province
            // saw >=2 vehicle types. local/visitor still use the plate's total reads
            // (region-agnostic), so those numbers are unchanged.
            `WITH plate_region AS (
               SELECT f.plate_number, f.region, COUNT(*) AS rc,
                      COUNT(DISTINCT f.vehicle_type) FILTER (
                        WHERE f.vehicle_type IS NOT NULL AND f.vehicle_type <> 'unknown') AS nt
                 FROM _lpr_stats_filtered f
                WHERE f.plate_number <> 'unknown'
                GROUP BY f.plate_number, f.region
             ),
             plate_counts AS (
               SELECT plate_number, SUM(rc) AS c,
                      MAX(nt) FILTER (WHERE region IS NOT NULL AND region <> '' AND region <> 'ไม่ทราบ') AS max_nt
                 FROM plate_region GROUP BY plate_number
             )
             SELECT COUNT(*) FILTER (WHERE c >= 2)  AS local,
                    COUNT(*) FILTER (WHERE c = 1)   AS visitor,
                    COUNT(*) FILTER (WHERE max_nt >= 2 AND plate_number NOT IN (SELECT plate_number FROM lpr_mismatch_dismissals)) AS mismatch
               FROM plate_counts`
          ),
          client.query(
            `SELECT EXTRACT(HOUR FROM event_time AT TIME ZONE 'Asia/Bangkok')::int AS hr, COUNT(*) AS n
               FROM _lpr_stats_filtered GROUP BY hr ORDER BY hr`
          ),
          // Charts show only IDENTIFIED data — exclude unknown/no-read so execs don't
          // read a big "ไม่ทราบ" slice as system failure. Counts stay in DB + searchable;
          // the no-read rate is surfaced honestly in the dedicated KPI instead.
          client.query(
            `SELECT region AS name, COUNT(*) AS n
               FROM _lpr_stats_filtered WHERE region IS NOT NULL AND region <> '' AND region <> 'ไม่ทราบ'
               GROUP BY region ORDER BY n DESC LIMIT 6`
          ),
          client.query(
            `SELECT vehicle_type AS type, COUNT(*) AS n
               FROM _lpr_stats_filtered WHERE vehicle_type IS NOT NULL AND vehicle_type <> '' AND vehicle_type <> 'unknown'
               GROUP BY type ORDER BY n DESC`
          ),
          // RF5 direction — per-camera lpr_direction (join cameras on id=camera_id).
          // Same BKK hour bucket as `hourly` so in/out align with the total line.
          client.query(
            `SELECT EXTRACT(HOUR FROM f.event_time AT TIME ZONE 'Asia/Bangkok')::int AS hr,
                    c.lpr_direction AS dir, COUNT(*) AS n
               FROM _lpr_stats_filtered f
               JOIN cameras c ON c.id = f.camera_id
              WHERE c.lpr_direction IN ('in','out')
              GROUP BY hr, dir`
          ),
          // How many LPR cameras are assigned each way — lets the chart show the
          // demo's 3-state (both / one-side+hint / none→"ผ่าน" total) even with 0 events.
          // Doesn't touch events at all, so the site-pill filter (camList) has to be
          // applied separately here rather than inheriting from stSql/base.
          camList
            ? client.query(`SELECT lpr_direction AS dir, COUNT(*) AS n
                               FROM cameras WHERE lpr_direction IN ('in','out') AND id = ANY($1) GROUP BY dir`, [camList])
            : client.query(`SELECT lpr_direction AS dir, COUNT(*) AS n
                               FROM cameras WHERE lpr_direction IN ('in','out') GROUP BY dir`),
          // Plate color (DLT category) — from lp.plate_color column (#085; was
          // raw_json->>'plateColor', a 3.8s Seq Scan + detoast). Exclude unknown/blank
          // (same identified-only stance as province/vtype charts).
          client.query(
            `SELECT plate_color AS color, COUNT(*) AS n
               FROM _lpr_stats_filtered WHERE plate_color IS NOT NULL
                                          AND plate_color NOT IN ('', 'unknown')
               GROUP BY color ORDER BY n DESC`
          ),
          // Vehicle brand (Hik numeric code) Top 10 — exclude '0'=ไม่ทราบ + blank.
          // Codes → names resolve client-side via _LPR_BRAND.
          client.query(
            `SELECT vehicle_brand AS code, COUNT(*) AS n
               FROM _lpr_stats_filtered WHERE vehicle_brand IS NOT NULL AND vehicle_brand NOT IN ('', '0')
               GROUP BY code ORDER BY n DESC LIMIT 10`
          ),
          // Count per camera (Top 15) — deliberately NOT off the temp table: this
          // counts vehicle detections generally (object_class), including ones with
          // no license_plates row at all, so it must query events directly.
          client.query(
            `SELECT e.camera_id AS cam, COUNT(*) AS n
               FROM events e
              WHERE ${stSql}
                AND (e.object_class IN ('Car','Truck','Vehicle','Bicycle') OR e.event_type = 'anprAlarm')
              GROUP BY e.camera_id ORDER BY n DESC LIMIT 15`,
            stArgs
          ),
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      const dirIn = Array(24).fill(0), dirOut = Array(24).fill(0);
      direction.rows.forEach(r => {
        (r.dir === 'in' ? dirIn : dirOut)[r.hr] = parseInt(r.n, 10);
      });
      const assigned = { in: 0, out: 0 };
      dirCams.rows.forEach(r => { assigned[r.dir] = parseInt(r.n, 10); });
      const hours = Array(24).fill(0);
      hourly.rows.forEach(r => { hours[r.hr] = parseInt(r.n, 10); });
      const result = {
        period,
        total:   parseInt(kpi.rows[0].total,  10),
        unique:  parseInt(kpi.rows[0].unique, 10),
        noread:  parseInt(kpi.rows[0].noread, 10),
        watch:   parseInt(kpi.rows[0].watch,  10),
        no_helmet: parseInt(kpi.rows[0].no_helmet, 10),  // มอเตอร์ไซค์ไม่ใส่หมวก
        overload: parseInt(kpi.rows[0].overload, 10),    // ซ้อนตั้งแต่ 3 คนขึ้นไป
        local:    parseInt(dup.rows[0].local,    10),  // ป้ายซ้ำ ≥2 — รถในพื้นที่
        visitor:  parseInt(dup.rows[0].visitor,  10),  // ป้ายไม่ซ้ำ =1 — รถต่างถิ่น
        mismatch: parseInt(dup.rows[0].mismatch, 10),  // สงสัยสวมทะเบียน (type ต่าง ≥2)
        hourly: hours,
        province: province.rows.map(r => ({ name: r.name, n: parseInt(r.n, 10) })),
        vtype:    vtype.rows.map(r => ({ type: r.type, n: parseInt(r.n, 10) })),
        pcolor:   pcolor.rows.map(r => ({ color: r.color, n: parseInt(r.n, 10) })),
        brand:    brand.rows.map(r => ({ code: r.code, n: parseInt(r.n, 10) })),
        perCamera: perCamera.rows.map(r => ({ camera_id: r.cam, n: parseInt(r.n, 10) })),
        direction: { in: dirIn, out: dirOut, assigned },  // RF5 per-camera direction
      };
      _lprStatsCache = result;
      _lprStatsCacheAt = Date.now();
      _lprStatsCacheKey = _cacheKey;
      res.json(result);
    } catch (e) {
      console.error('[lpr-query] GET /api/lpr/stats:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  function reportBucket(period) {
    if (period === 'week') {
      return {
        key: `EXTRACT(DOW FROM e.event_time AT TIME ZONE 'Asia/Bangkok')::int`,
        labels: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
      };
    }
    if (period === 'month') {
      return {
        key: `EXTRACT(DAY FROM e.event_time AT TIME ZONE 'Asia/Bangkok')::int`,
        labels: Array.from({ length: 31 }, (_, i) => String(i + 1)),
      };
    }
    return {
      key: `EXTRACT(HOUR FROM e.event_time AT TIME ZONE 'Asia/Bangkok')::int`,
      labels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    };
  }

  // R1b — report-specific LPR stats. Read-only endpoint for the redesigned
  // Reports page; keeps /api/lpr/stats contract stable for the LPR page.
  app.get('/api/stats/lpr/report', async (req, res) => {
    const period = String(req.query.period || 'today');
    const pc = periodClause(period, req.query.from, req.query.to, 1);
    // Site-RBAC P2: compute RBAC scope first so group placeholder indices are correct
    const swR = siteWhere(req.user?.allowedSites ?? null, 'e.camera_id', pc.args.length + 1);
    const rPcSql  = swR.sql ? `${pc.sql} ${swR.sql}` : pc.sql;
    const rPcArgs = [...pc.args, ...swR.args];
    const bucket = reportBucket(period);
    const group = String(req.query.group || 'all').trim();
    const groupSql = group && group !== 'all'
      ? ` AND (w.group_id = $${rPcArgs.length + 1} OR wg.name = $${rPcArgs.length + 1})`
      : '';
    const groupArgs = groupSql ? [group] : [];
    const siteId = req.query.site_id ? parseInt(req.query.site_id) : null;
    const baseSiteClause = siteId ? ` AND e.camera_id IN (SELECT id FROM cameras WHERE site_id = $${rPcArgs.length + 1})` : '';
    const baseSiteArgs   = siteId ? [siteId] : [];
    const grpSiteClause  = siteId ? ` AND e.camera_id IN (SELECT id FROM cameras WHERE site_id = $${rPcArgs.length + 1 + groupArgs.length})` : '';
    const grpSiteArgs    = siteId ? [siteId] : [];
    const watchWhere = `${rPcSql} AND w.plate_number IS NOT NULL${groupSql}`;
    // identified/bucket.key against the materialized temp table (no e./lp. aliases there)
    const identifiedTmp = `region IS NOT NULL AND region <> '' AND region <> 'ไม่ทราบ'
                          AND vehicle_type IS NOT NULL AND vehicle_type <> '' AND vehicle_type <> 'unknown'`;
    const bucketKeyTmp = bucket.key.replace(/e\.event_time/g, 'event_time');
    const groupSqlTmp = group && group !== 'all' ? ` AND (group_id = $1 OR wg_name = $1)` : '';
    try {
      const dq = (label, p) => p.catch(err => { err._lprq = label; throw err; });
      // watchHits/groups don't need the base join — fire them on the pool, in
      // parallel with the temp-table build below.
      const watchHitsP = dq('watchHits', pool.query(
        `SELECT e.id, e.event_time, e.camera_id,
                lp.plate_number, lp.region, lp.vehicle_type,
                lp.vehicle_color, lp.vehicle_brand, lp.plate_image,
                e.snapshot_filename AS snapshot_file,
                w.group_id, COALESCE(wg.name, w.group_id, 'Watchlist') AS group_name,
                wg.color AS group_color,
                w.ref_image
           FROM events e
           JOIN license_plates lp ON lp.event_id = e.id
           JOIN lpr_watchlist w ON w.plate_number = UPPER(lp.plate_number) AND w.active
           LEFT JOIN lpr_watchlist_groups wg ON wg.id = w.group_id
          WHERE ${watchWhere}${grpSiteClause}
          ORDER BY e.event_time DESC LIMIT 50`,
        [...rPcArgs, ...groupArgs, ...grpSiteArgs]
      ));
      const groupsP = dq('groups', pool.query(
        `SELECT id, name, color FROM lpr_watchlist_groups ORDER BY created_at`
      ));

      const client = await pool.connect();
      let kpi, peak, province, vtype, direction, dup;
      try {
        await client.query('BEGIN');
        // Materialize the filtered events⋈license_plates join ONCE — kpi/peak/
        // province/vtype/direction/dup were each independently re-running this
        // same join against the ~1M-row events table (17.85s for a monthly
        // window). Now every downstream query reads the small temp table instead.
        await client.query(
          `CREATE TEMP TABLE _lpr_report_base ON COMMIT DROP AS
           SELECT e.id, e.event_time, lp.plate_number, lp.region, lp.vehicle_type,
                  c.lpr_direction, w.group_id, wg.name AS wg_name, w.plate_number AS w_plate,
                  lp.no_helmet
             FROM events e
             JOIN license_plates lp ON lp.event_id = e.id
             LEFT JOIN cameras c ON c.id = e.camera_id
             LEFT JOIN lpr_watchlist w ON w.plate_number = UPPER(lp.plate_number) AND w.active
             LEFT JOIN lpr_watchlist_groups wg ON wg.id = w.group_id
            WHERE ${rPcSql}${baseSiteClause}`,
          [...rPcArgs, ...baseSiteArgs]
        );

        [kpi, peak, province, vtype, direction, dup] = await Promise.all([
          dq('kpi', client.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(DISTINCT plate_number) FILTER (WHERE plate_number <> 'unknown')::int AS unique,
                    COUNT(*) FILTER (WHERE plate_number = 'unknown')::int AS noread,
                    COUNT(*) FILTER (WHERE ${identifiedTmp})::int AS identified,
                    COUNT(*) FILTER (WHERE w_plate IS NOT NULL${groupSqlTmp})::int AS watch,
                    COUNT(*) FILTER (WHERE no_helmet)::int AS no_helmet
               FROM _lpr_report_base`,
            groupArgs
          )),
          dq('peak', client.query(
            `SELECT ${bucketKeyTmp} AS bucket, COUNT(*)::int AS n
               FROM _lpr_report_base
              WHERE ${identifiedTmp}
              GROUP BY bucket ORDER BY bucket`
          )),
          dq('province', client.query(
            `SELECT region AS name, COUNT(*)::int AS n
               FROM _lpr_report_base
              WHERE ${identifiedTmp}
              GROUP BY region ORDER BY n DESC LIMIT 8`
          )),
          dq('vtype', client.query(
            `SELECT vehicle_type AS type, COUNT(*)::int AS n
               FROM _lpr_report_base
              WHERE ${identifiedTmp}
              GROUP BY vehicle_type ORDER BY n DESC LIMIT 8`
          )),
          dq('direction', client.query(
            `SELECT ${bucketKeyTmp} AS bucket, lpr_direction AS dir, COUNT(*)::int AS n
               FROM _lpr_report_base
              WHERE lpr_direction IN ('in','out')
              GROUP BY bucket, dir ORDER BY bucket`
          )),
          // local (ป้ายซ้ำ ≥2 = รถในพื้นที่) / visitor (ป้ายไม่ซ้ำ =1 = รถต่างถิ่น) —
          // per-plate count. DISTINCT id+plate_number first to undo any watchlist
          // fan-out (a plate can match >1 lpr_watchlist row) so counts stay identical
          // to the old clean events⋈license_plates join. Mirrors /api/lpr/stats.
          dq('dup', client.query(
            `WITH plate_counts AS (
               SELECT plate_number, COUNT(*) AS c
                 FROM (SELECT DISTINCT id, plate_number FROM _lpr_report_base WHERE plate_number <> 'unknown') d
                GROUP BY plate_number
             )
             SELECT COUNT(*) FILTER (WHERE c >= 2)::int AS local,
                    COUNT(*) FILTER (WHERE c = 1)::int  AS visitor
               FROM plate_counts`
          )),
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      const watchHits = await watchHitsP;
      const groups = await groupsP;

      const series = (rows, field = 'n') => {
        const values = Array(bucket.labels.length).fill(0);
        rows.forEach(r => {
          const idx = period === 'month' ? parseInt(r.bucket, 10) - 1 : parseInt(r.bucket, 10);
          if (idx >= 0 && idx < values.length) values[idx] = parseInt(r[field], 10) || 0;
        });
        return values;
      };
      const dirIn = Array(bucket.labels.length).fill(0);
      const dirOut = Array(bucket.labels.length).fill(0);
      direction.rows.forEach(r => {
        const idx = period === 'month' ? parseInt(r.bucket, 10) - 1 : parseInt(r.bucket, 10);
        if (idx >= 0 && idx < bucket.labels.length) (r.dir === 'in' ? dirIn : dirOut)[idx] = parseInt(r.n, 10) || 0;
      });
      const peakValues = series(peak.rows);
      const peakMax = Math.max(...peakValues, 0);
      const peakIdx = peakValues.indexOf(peakMax);
      res.json({
        period,
        group,
        kpi: { ...(kpi.rows[0] || { total: 0, unique: 0, noread: 0, identified: 0, watch: 0, no_helmet: 0 }),
               local: dup.rows[0]?.local || 0, visitor: dup.rows[0]?.visitor || 0 },
        peak: { labels: bucket.labels, values: peakValues, max: peakMax, index: peakIdx },
        province: province.rows,
        vehicle_type: vtype.rows,
        direction: { labels: bucket.labels, in: dirIn, out: dirOut },
        watch_hits: watchHits.rows,
        groups: groups.rows,
      });
    } catch (e) {
      // dq() tags each sub-query so the log names the one that failed.
      console.error('[lpr-query] GET /api/stats/lpr/report [' + (e._lprq || '?') + ']:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

};
