// ============================================================
// Vigil Platform — Tests: helpers/gsAlarmLine.js
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// sendGsAlarm() never opens its own db connection or calls the real LINE
// sender — both are parameters — so this exercises it against a fake pool
// (dispatched on SQL substring, same style as gs-alarm-poll.test.js) and a
// stub lineSender. No real Postgres, no real LINE push, no filesystem writes
// (copyFn stubs the photo-copy path).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sendGsAlarm } = require('../src/helpers/gsAlarmLine');
const { pollGsAlarms } = require('../src/helpers/gsAlarmPoll');

function baseAlarm(over = {}) {
  return {
    id: 1, ext_id: 981, source_id: 11, plate: '1กฐ1140',
    alarm_time: new Date().toISOString(),
    province: 'ภูเก็ต', cartype: 'Motorcycle', carcolor: 'Blue', carbrand: 'Honda',
    platetype: 'normal-white-black', owner: 'สภ.กะรน', detail: 'คดีลักทรัพย์',
    ref_photo_path: null, matched_event_id: null, matched_event_time: null,
    camera_name: 'ทางเข้าตลาด', camera_ip: '10.0.10.5',
    capture_source: null, capture_photo_path: null,
    ...over,
  };
}

// Fake pool — dispatched on SQL substring. `cfg` and `chan` are configurable;
// everything else defaults to "found nothing" so a test only has to spell out
// what it cares about. Records every call for assertions.
function makePool({ cfg, chan = null, cooldownRemain = 0, hourlySent = 0, mutedUntil = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM line_config WHERE id = 1')) return { rows: [cfg] };
      if (sql.includes('FROM alert_rules WHERE channel')) return { rows: chan ? [chan] : [] };
      if (sql.includes('FROM lpr_alert_cooldown')) return { rows: [{ remain: cooldownRemain }] };
      if (sql.includes('FROM lpr_alert_hourly')) return { rows: [{ sent: hourlySent }] };
      if (sql.includes('FROM lpr_plate_mutes')) return { rows: mutedUntil ? [{ muted_until: mutedUntil }] : [] };
      if (sql.includes('FROM events WHERE id')) return { rows: [] };
      if (sql.includes('FROM license_plates WHERE event_id')) return { rows: [] };
      if (sql.includes('FROM blacklist.sources')) return { rows: [{ name: 'ภูเก็ต' }] };
      if (sql.includes('FROM lpr_watchlist')) return { rows: [] };
      if (sql.includes('INSERT INTO lpr_alert_cooldown')) return { rows: [] };
      if (sql.includes('INSERT INTO lpr_alert_hourly')) return { rows: [] };
      if (sql.includes('INSERT INTO alert_logs')) return { rows: [] };
      if (sql.includes('UPDATE blacklist.gs_alarms')) return { rows: [] };
      throw new Error(`unexpected sql in fake pool: ${sql.slice(0, 80)}`);
    },
  };
}

function makeLineSender(impl) {
  const calls = [];
  return {
    calls,
    sendAlert: async (opts) => {
      calls.push(opts);
      return impl ? impl(opts) : { sentCount: opts.recipients.length, imageSource: null, recipientsLog: [] };
    },
  };
}

describe('sendGsAlarm — channel gating', () => {
  it('no alert_rules row = channel_disabled, LINE never called', async () => {
    const pool = makePool({ cfg: { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', enabled: true }] }, chan: null });
    const lineSender = makeLineSender();
    const out = await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });
    assert.equal(out.status, 'channel_disabled');
    assert.equal(lineSender.calls.length, 0);
  });
});

describe('sendGsAlarm — recipients', () => {
  const cfg = {
    enabled: true, channel_access_token: 'tok', recipients: [
      { id: 'U1', name: 'Owner', enabled: true },
      { id: 'C2', name: 'Someone else', enabled: true },
    ],
  };
  const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'] };

  it('rule.recipient_ids picks exactly the configured recipient', async () => {
    const pool = makePool({ cfg, chan });
    const lineSender = makeLineSender();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });
    assert.equal(lineSender.calls.length, 1);
    assert.deepEqual(lineSender.calls[0].recipients.map(r => r.id), ['U1']);
  });

  it('recipientIds override with an unknown id drops that id', async () => {
    const pool = makePool({ cfg, chan });
    const lineSender = makeLineSender();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm(), recipientIds: ['U1', 'nope'] });
    assert.equal(lineSender.calls.length, 1);
    assert.deepEqual(lineSender.calls[0].recipients.map(r => r.id), ['U1']);
  });

  it('recipientIds override ignores rule.recipient_ids entirely', async () => {
    const pool = makePool({ cfg, chan });
    const lineSender = makeLineSender();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm(), recipientIds: ['C2'] });
    assert.deepEqual(lineSender.calls[0].recipients.map(r => r.id), ['C2']);
  });
});

describe('sendGsAlarm — cooldown', () => {
  const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', enabled: true }] };
  const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'] };

  it('cooldown remaining -> cooldown_skip, LINE not called', async () => {
    const pool = makePool({ cfg, chan, cooldownRemain: 120 });
    const lineSender = makeLineSender();
    const out = await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });
    assert.equal(out.status, 'cooldown_skip');
    assert.equal(lineSender.calls.length, 0);
  });

  it('force:true bypasses cooldown', async () => {
    const pool = makePool({ cfg, chan, cooldownRemain: 120 });
    const lineSender = makeLineSender();
    const out = await sendGsAlarm({ pool, lineSender, alarm: baseAlarm(), force: true });
    assert.equal(out.status, 'sent');
    assert.equal(lineSender.calls.length, 1);
    // ป้ายทดสอบต้องขึ้นต้นข้อความ — ผู้รับต้องแยกออกว่าไม่ใช่เหตุการณ์ใหม่
    assert.match(lineSender.calls[0].rule.message_template, /ทดสอบระบบ/);
  });
});

describe('sendGsAlarm — image resolution', () => {
  const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', enabled: true }] };
  const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'] };

  it('lprresult capture copies the capture photo and builds a synthetic event', async () => {
    const pool = makePool({ cfg, chan });
    const lineSender = makeLineSender();
    const copied = [];
    const alarm = baseAlarm({
      capture_source: 'lprresult', capture_photo_path: '11/alarm_981_cap.jpg',
      ref_photo_path: '11/alarm_981.jpg',
    });
    await sendGsAlarm({
      pool, lineSender, alarm,
      copyFn: (src, destRel) => copied.push({ src, destRel }),
    });
    assert.equal(lineSender.calls.length, 1);
    const sentEvent = lineSender.calls[0].event;
    assert.equal(sentEvent.id, null, 'synthetic event carries no real event id');
    assert.equal(sentEvent.snapshot_filename, 'lpr-watchlist/gs_alarm_981_cap.jpg');
    // both the capture photo and the reference photo get copied (no refImage on lpr_watchlist)
    assert.ok(copied.some(c => c.src === '11/alarm_981_cap.jpg' && c.destRel === 'lpr-watchlist/gs_alarm_981_cap.jpg'));
    assert.ok(copied.some(c => c.src === '11/alarm_981.jpg' && c.destRel === 'lpr-watchlist/gs_alarm_981.jpg'));
    assert.equal(lineSender.calls[0].rule.lprMeta.refImage, 'lpr-watchlist/gs_alarm_981.jpg');
  });

  it('no capture at all -> synthetic event with a null snapshot, still sends (no image, not a crash)', async () => {
    const pool = makePool({ cfg, chan });
    const lineSender = makeLineSender();
    const alarm = baseAlarm({ capture_source: null, capture_photo_path: null, ref_photo_path: null });
    const out = await sendGsAlarm({ pool, lineSender, alarm });
    assert.equal(out.status, 'sent');
    assert.equal(lineSender.calls[0].event.snapshot_filename, null);
  });
});

describe('sendGsAlarm — dry run', () => {
  it('reports the decision without writing cooldown/hourly/alert_logs or calling LINE', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', enabled: true }] };
    const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'] };
    const pool = makePool({ cfg, chan });
    const lineSender = makeLineSender();
    const out = await sendGsAlarm({ pool, lineSender, alarm: baseAlarm(), dryRun: true });
    assert.equal(out.dryRun, true);
    assert.equal(out.wouldSend, true);
    assert.equal(lineSender.calls.length, 0);
    assert.ok(!pool.calls.some(c => c.sql.includes('INSERT INTO lpr_alert_cooldown')));
    assert.ok(!pool.calls.some(c => c.sql.includes('INSERT INTO alert_logs')));
  });
});

describe('gsAlarmPoll <-> sendGsAlarm wiring', () => {
  it('notify is called once per inserted row, and a throwing notify does not escape pollGsAlarms', async () => {
    const source = { id: 11, site_code: 'hkt' };
    const cfg = { host: '10.0.10.24', port: 13000, apiKey: 'k' };
    const calls = [];
    const db = {
      async query(sql, params) {
        if (sql.includes('max(alarm_time)')) return { rows: [{ t: null }] };
        if (sql.includes('SELECT 1 FROM blacklist.gs_alarms')) return { rows: [] };
        if (sql.includes('FROM events e')) return { rows: [] };
        if (sql.includes('INSERT INTO blacklist.gs_alarms')) {
          return { rows: [{ id: 1, source_id: params[0], ext_id: params[1], plate: params[3] }] };
        }
        if (sql.includes('UPDATE blacklist.sources')) return { rows: [] };
        throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
      },
    };
    const fetchEdge = async (site, body) => {
      if (body.kind === 'alert') {
        return {
          ok: true, kind: 'alert', count: 1,
          records: [{ external_id: 981, timestamp: '2026-09-24T08:26:29', plate_number: '1กฐ1140' }],
        };
      }
      throw new Error(`unexpected kind: ${body.kind}`);
    };
    const notify = async (row) => { calls.push(row); throw new Error('boom — should not escape'); };

    const r = await pollGsAlarms(db, source, cfg, { fetchEdge, notify });
    assert.equal(r.inserted.length, 1);
    assert.equal(calls.length, 1, 'notify called once for the one inserted row');
    assert.equal(calls[0].ext_id, 981);
  });
});
