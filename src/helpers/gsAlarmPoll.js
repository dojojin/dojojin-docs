// ============================================================
// Vigil Platform — GuruSquare (HKT) real-time alarm poller
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Polls GuruSquare's `/alert` feed (via the edge proxy — central cannot reach
// the HKT LAN directly) for new blacklist hits, tries to attach one of OUR
// camera reads as a real capture photo (falling back to GuruSquare's own
// `/lprresult` read log when we don't have one), and stores each alarm once
// in blacklist.gs_alarms (migration 237).
//
// `db` is anything with `.query()` — a pool or a client — deliberately NOT
// something this file opens itself, so a test can wrap a whole run in
// BEGIN/ROLLBACK. LINE notification is a later step; see the TODO below.
'use strict';

const { edgeFetch, savePhoto } = require('./blacklistImport');

// ---------- GuruSquare timestamp <-> Asia/Bangkok (UTC+7, no DST) ----------
// Done arithmetically so it never depends on the process time zone (TZ).
const _GS_TS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/;

function toGsLocal(date) {
  const shifted = new Date(date.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}T`
       + `${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`;
}

function parseGsTime(str) {
  const m = String(str || '').trim().match(_GS_TS_RE);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(utcMs);
  // Date.UTC silently rolls over an out-of-range field (e.g. month 13) into
  // the next unit — reject anything that doesn't round-trip exactly.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d
      || check.getUTCHours() !== h || check.getUTCMinutes() !== mi || check.getUTCSeconds() !== s) {
    return null;
  }
  return new Date(utcMs - 7 * 3600 * 1000);
}

// from = max(lastAlarmTime - 10min, now - 60min); to = now + 5min.
// The 60-min floor exists so enabling this for the first time (or recovering
// from a long outage) never floods a LINE group with a backlog of old alarms.
function alarmWindow({ lastAlarmTime, now }) {
  const floor = new Date(now.getTime() - 60 * 60 * 1000);
  let from = floor;
  if (lastAlarmTime) {
    const candidate = new Date(lastAlarmTime.getTime() - 10 * 60 * 1000);
    if (candidate.getTime() > floor.getTime()) from = candidate;
  }
  const to = new Date(now.getTime() + 5 * 60 * 1000);
  return { from, to };
}

async function pollGsAlarms(db, source, cfg, opts = {}) {
  const { fetchEdge = edgeFetch, now = new Date(), savePhotoFn = savePhoto,
          notify = (row) => require('./gsAlarmLine').sendGsAlarm({
            pool: db, lineSender: require('../line-sender'), alarm: row,
          }) } = opts;
  const sourceId = source.id;
  const site = source.site_code;

  const stats = { fetched: 0, skippedDup: 0, bad: 0, matchedOurs: 0, matchedLprresult: 0 };
  const inserted = [];
  let maxExtId = 0;

  try {
    const { rows: lastRows } = await db.query(
      'SELECT max(alarm_time) AS t FROM blacklist.gs_alarms WHERE source_id = $1', [sourceId]);
    const lastAlarmTime = lastRows[0] && lastRows[0].t ? new Date(lastRows[0].t) : null;
    const win = alarmWindow({ lastAlarmTime, now });

    const resp = await fetchEdge(site, {
      source: 'gurusquare', kind: 'alert',
      config: { host: cfg.host, port: cfg.port, apiKey: cfg.apiKey },
      from: toGsLocal(win.from), to: toGsLocal(win.to), withPhotos: true,
    }, 60000);

    // An edge still running the old code ignores `kind` and answers the
    // roster shape instead — that must never be mistaken for alarms.
    if (!resp || resp.kind !== 'alert') {
      throw new Error('edge ยังเป็นโค้ดเก่า (ไม่รู้จัก kind=alert) — ต้อง pull + restart lpr-receiver บน edge ก่อน');
    }

    const records = (resp.records || []).slice().sort((a, b) => a.external_id - b.external_id);
    stats.fetched = records.length;

    for (const rec of records) {
      maxExtId = Math.max(maxExtId, rec.external_id);

      // Duplicate check FIRST — no photo/matching work for a row we already have.
      const dup = await db.query(
        'SELECT 1 FROM blacklist.gs_alarms WHERE source_id = $1 AND ext_id = $2', [sourceId, rec.external_id]);
      if (dup.rows[0]) { stats.skippedDup++; continue; }

      const t = parseGsTime(rec.timestamp);
      if (!t) { stats.bad++; continue; }

      let captureSource = null, capturePhotoPath = null, cameraName = null, cameraIp = null,
          matchedEventId = null, matchedEventTime = null, matchError = null;

      const ours = await db.query(`
        SELECT e.id AS event_id, e.event_time, c.name AS camera_name, c.ip_address AS camera_ip
          FROM events e
          JOIN license_plates lp ON lp.event_id = e.id
          JOIN cameras c ON c.id = e.camera_id
          JOIN sites s ON s.id = c.site_id
         WHERE e.event_type = 'anprAlarm'
           AND s.code = $1
           AND e.event_time BETWEEN $2::timestamptz - interval '90 seconds' AND $2::timestamptz + interval '10 seconds'
           AND upper(replace(lp.plate_number, ' ', '')) = upper(replace($3, ' ', ''))
         ORDER BY abs(extract(epoch FROM (e.event_time - $2::timestamptz)))
         LIMIT 1`,
        [site, t.toISOString(), rec.plate_number]);

      if (ours.rows[0]) {
        captureSource = 'ours';
        matchedEventId = ours.rows[0].event_id;
        matchedEventTime = ours.rows[0].event_time;
        cameraName = ours.rows[0].camera_name;
        cameraIp = ours.rows[0].camera_ip;
        stats.matchedOurs++;
      } else {
        // A failed fallback must NOT drop the alarm — store it with camera
        // fields null and the error noted, not lost.
        try {
          const fb = await fetchEdge(site, {
            source: 'gurusquare', kind: 'lprresult',
            config: { host: cfg.host, port: cfg.port, apiKey: cfg.apiKey },
            from: toGsLocal(new Date(t.getTime() - 90000)),
            to: toGsLocal(new Date(t.getTime() + 10000)),
            plate: rec.plate_number,
          }, 60000);
          if (fb && fb.best) {
            captureSource = 'lprresult';
            cameraName = fb.best.cctv_name || null;
            cameraIp = fb.best.ipaddress || null;
            if (fb.best.photo_b64) capturePhotoPath = savePhotoFn(sourceId, `alarm_${rec.external_id}_cap`, fb.best.photo_b64);
            stats.matchedLprresult++;
          }
        } catch (e) {
          matchError = e.message;
        }
      }

      const refPhotoPath = rec.photo_b64 ? savePhotoFn(sourceId, `alarm_${rec.external_id}`, rec.photo_b64) : null;
      const rawJson = { ...rec };
      delete rawJson.photo_b64;
      if (matchError) rawJson.match_error = matchError;

      const ins = await db.query(`
        INSERT INTO blacklist.gs_alarms
          (source_id, ext_id, alarm_time, plate, province, cartype, carcolor, carbrand, platetype,
           owner, detail, ref_photo_path, matched_event_id, matched_event_time, camera_name, camera_ip,
           capture_source, capture_photo_path, raw_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (source_id, ext_id) DO NOTHING
        RETURNING *`,
        [sourceId, rec.external_id, t.toISOString(), rec.plate_number, rec.province, rec.cartype,
         rec.carcolor, rec.carbrand, rec.platetype, rec.owner, rec.owner_detail, refPhotoPath,
         matchedEventId, matchedEventTime, cameraName, cameraIp, captureSource, capturePhotoPath,
         JSON.stringify(rawJson)]);
      if (ins.rows[0]) {
        inserted.push(ins.rows[0]);
        // LINE alert per row, sequentially (not Promise.all — GuruSquare alarms
        // arrive in a trickle, not a burst, and sequential keeps cooldown/hourly
        // claims from racing each other within the same poll). A send failure
        // must never lose the row or break the rest of the poll — sendGsAlarm()
        // already never throws, but this still catches in case a future notify
        // override does.
        try { await notify(ins.rows[0]); }
        catch (e) { console.error('[gs-alarm-poll] LINE notify failed:', e.message); }
      }
    }

    const note = `รับ ${inserted.length} ใหม่ · จับคู่กล้องเรา ${stats.matchedOurs} · จาก lprresult ${stats.matchedLprresult}`;
    await db.query(
      `UPDATE blacklist.sources SET alarm_last_poll_at = NOW(),
              alarm_last_id = GREATEST(COALESCE(alarm_last_id, 0), $2), alarm_last_note = $3
        WHERE id = $1`,
      [sourceId, maxExtId, note]);

    return { inserted, fetched: stats.fetched, skippedDup: stats.skippedDup, bad: stats.bad };
  } catch (e) {
    await db.query(
      `UPDATE blacklist.sources SET alarm_last_poll_at = NOW(),
              alarm_last_id = GREATEST(COALESCE(alarm_last_id, 0), $2), alarm_last_note = $3
        WHERE id = $1`,
      [sourceId, maxExtId, e.message]).catch(() => {});
    throw e;
  }
}

module.exports = { toGsLocal, parseGsTime, alarmWindow, pollGsAlarms };
