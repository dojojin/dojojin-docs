// ============================================================
// Vigil Platform — Tests: helpers/gsAlarmPoll.js
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// GuruSquare's `/alert` feed is the HKT blacklist ALARM path (migration 237,
// docs on gsAlarmPoll.js). pollGsAlarms() never opens its own db connection —
// it takes `db` as a parameter — specifically so it can be exercised here
// against a fake db (no real Postgres needed) instead of only being provable
// against a live one.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toGsLocal, parseGsTime, alarmWindow, pollGsAlarms } = require('../src/helpers/gsAlarmPoll');

describe('gsAlarmPoll.toGsLocal / parseGsTime', () => {
  it('round-trips both timestamp formats regardless of process.env.TZ', () => {
    const origTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const d = new Date('2026-09-24T01:26:29Z'); // = 08:26:29 Asia/Bangkok
      assert.equal(toGsLocal(d), '2026-09-24T08:26:29');
      assert.equal(parseGsTime('2026-09-24T08:26:29').getTime(), d.getTime());
      assert.equal(parseGsTime('2026-09-24 08:26:29').getTime(), d.getTime());
    } finally {
      if (origTz === undefined) delete process.env.TZ; else process.env.TZ = origTz;
    }
  });

  it('garbage input returns null instead of an invalid Date', () => {
    assert.equal(parseGsTime('not-a-date'), null);
    assert.equal(parseGsTime(''), null);
    assert.equal(parseGsTime(null), null);
    assert.equal(parseGsTime(undefined), null);
    assert.equal(parseGsTime('2026-13-40 99:99:99'), null); // rolls over silently in Date.UTC — must be rejected
  });
});

describe('gsAlarmPoll.alarmWindow', () => {
  const now = new Date('2026-09-24T10:00:00Z');

  it('null lastAlarmTime falls back to now-60min', () => {
    const w = alarmWindow({ lastAlarmTime: null, now });
    assert.equal(w.from.getTime(), now.getTime() - 60 * 60 * 1000);
    assert.equal(w.to.getTime(), now.getTime() + 5 * 60 * 1000);
  });

  it('a recent lastAlarmTime uses the -10min rule', () => {
    const last = new Date(now.getTime() - 5 * 60 * 1000);
    const w = alarmWindow({ lastAlarmTime: last, now });
    assert.equal(w.from.getTime(), last.getTime() - 10 * 60 * 1000);
  });

  it('an old lastAlarmTime is floored at now-60min, not left to grow unbounded', () => {
    const last = new Date(now.getTime() - 5 * 60 * 60 * 1000); // 5h ago
    const w = alarmWindow({ lastAlarmTime: last, now });
    assert.equal(w.from.getTime(), now.getTime() - 60 * 60 * 1000);
  });
});

describe('gsAlarmPoll.pollGsAlarms', () => {
  const source = { id: 11, site_code: 'hkt' };
  const cfg = { host: '10.0.10.24', port: 13000, apiKey: 'k' };

  // Fake `db` — a pool/client stand-in whose query() is dispatched on SQL
  // substrings, per the spec for this test file. Records every call so tests
  // can assert what did (or didn't) happen.
  function makeDb({ dupExtIds = new Set(), oursMatchRow = null } = {}) {
    const calls = [];
    return {
      calls,
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('max(alarm_time)')) return { rows: [{ t: null }] };
        if (sql.includes('SELECT 1 FROM blacklist.gs_alarms')) {
          return { rows: dupExtIds.has(params[1]) ? [{ '?column?': 1 }] : [] };
        }
        if (sql.includes('FROM events e')) {
          return { rows: oursMatchRow ? [oursMatchRow] : [] };
        }
        if (sql.includes('INSERT INTO blacklist.gs_alarms')) {
          return { rows: [{ id: 1, source_id: params[0], ext_id: params[1], plate: params[3] }] };
        }
        if (sql.includes('UPDATE blacklist.sources')) return { rows: [] };
        throw new Error(`unexpected sql in fake db: ${sql.slice(0, 80)}`);
      },
    };
  }

  it('(a) an old edge that ignores kind=alert throws the guard error and stores nothing', async () => {
    const db = makeDb();
    // Old edge code: dispatches on `source` only, ignores `kind`, answers the
    // roster shape (no `kind` field at all).
    const fetchEdge = async () => ({ ok: true, dataType: 'lpr', count: 0, records: [] });

    await assert.rejects(
      () => pollGsAlarms(db, source, cfg, { fetchEdge }),
      /kind=alert/);
    assert.ok(!db.calls.some((c) => c.sql.includes('INSERT INTO blacklist.gs_alarms')),
      'guard must fire before any row is written');
  });

  it('(b) a duplicate ext_id is skipped without ever calling the lprresult fallback', async () => {
    const db = makeDb({ dupExtIds: new Set([981]) });
    let fetchCalls = 0;
    const fetchEdge = async (site, body) => {
      fetchCalls++;
      assert.equal(site, 'hkt');
      assert.equal(body.kind, 'alert');
      return {
        ok: true, kind: 'alert', count: 1,
        records: [{ external_id: 981, timestamp: '2026-09-24T08:26:29', plate_number: '1กฐ1140' }],
      };
    };

    const r = await pollGsAlarms(db, source, cfg, { fetchEdge });
    assert.equal(r.fetched, 1);
    assert.equal(r.skippedDup, 1);
    assert.equal(r.inserted.length, 0);
    assert.equal(fetchCalls, 1, 'a duplicate must never trigger the lprresult fallback call');
  });

  it('(c) no ours-match calls the fallback with the right plate/window; a throwing fallback still inserts the alarm', async () => {
    const db = makeDb({ oursMatchRow: null });
    const fetchCalls = [];
    const savedPhotos = [];
    const fetchEdge = async (site, body) => {
      fetchCalls.push(body);
      if (body.kind === 'alert') {
        return {
          ok: true, kind: 'alert', count: 1,
          records: [{ external_id: 982, timestamp: '2026-09-24T09:00:00', plate_number: '2กข5555' }],
        };
      }
      if (body.kind === 'lprresult') {
        assert.equal(body.plate, '2กข5555');
        assert.equal(body.from, '2026-09-24T08:58:30'); // t - 90s
        assert.equal(body.to, '2026-09-24T09:00:10');   // t + 10s
        throw new Error('edge timeout');
      }
      throw new Error(`unexpected kind: ${body.kind}`);
    };

    const r = await pollGsAlarms(db, source, cfg, {
      fetchEdge,
      savePhotoFn: (...args) => { savedPhotos.push(args); return null; },
      // no-op — the LINE hook (gsAlarmLine.sendGsAlarm) has its own test file;
      // exercising the real default here would hit this fake db with queries
      // it doesn't recognize (harmless — sendGsAlarm never throws — but noisy).
      notify: async () => {},
    });

    assert.equal(fetchCalls.length, 2, 'alert fetch + one lprresult fallback attempt');
    assert.equal(fetchCalls[1].kind, 'lprresult');
    assert.equal(r.inserted.length, 1, 'a failed fallback must not drop the alarm');
    assert.equal(r.bad, 0);

    const insertCall = db.calls.find((c) => c.sql.includes('INSERT INTO blacklist.gs_alarms'));
    assert.ok(insertCall);
    const rawJson = JSON.parse(insertCall.params[18]);
    assert.match(rawJson.match_error, /edge timeout/);
    assert.equal(insertCall.params[16], null, 'capture_source stays null when nothing matched');
  });
});
