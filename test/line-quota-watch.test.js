// ============================================================
// Vigil Platform — Tests: helpers/lineQuotaWatch.js + PUT /api/line-config/quota-alert
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// No real Postgres, no real LINE call — pool and lineSender are both fakes
// dispatched on SQL substring / call args, same style as gs-alarm-line.test.js.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  monthKeyBkk, monthStartBkkUtc, decide, checkQuota,
} = require('../src/helpers/lineQuotaWatch');
const lineRoutes = require('../src/routes/line');

// ── monthKeyBkk across the Bangkok midnight boundary ─────────────────────
describe('monthKeyBkk — Bangkok wall-clock month, not UTC', () => {
  it('23:59 UTC-31-Aug (= 06:59 น. 1 ก.ย. กรุงเทพฯ) is already September', () => {
    // 31 Aug 23:59 UTC + 7h = 1 Sep 06:59 Bangkok
    assert.equal(monthKeyBkk(new Date('2026-08-31T23:59:00Z')), '2026-09');
  });
  it('16:59 UTC-31-Aug (= 23:59 น. 31 ส.ค. กรุงเทพฯ) is still August', () => {
    assert.equal(monthKeyBkk(new Date('2026-08-31T16:59:00Z')), '2026-08');
  });
  it('17:00 UTC-31-Aug (= 00:00 น. 1 ก.ย. กรุงเทพฯ) flips to September', () => {
    assert.equal(monthKeyBkk(new Date('2026-08-31T17:00:00Z')), '2026-09');
  });
  it('monthStartBkkUtc(now) is always <= now and in the same Bangkok month', () => {
    const now = new Date('2026-09-24T10:00:00Z');
    const start = monthStartBkkUtc(now);
    assert.ok(start.getTime() <= now.getTime());
    assert.equal(monthKeyBkk(start), monthKeyBkk(now));
  });
});

// ── decide() matrix ───────────────────────────────────────────────────────
describe('decide — once per month, limit_hit beats below_threshold', () => {
  const month = '2026-09';
  it('disabled → never sends', () => {
    assert.deepEqual(decide({ enabled: false, threshold: 200, remaining: 1, limitHit: { at: new Date() }, state: {}, month }),
      { send: false, reason: null });
  });
  it('already sent this month → no second send even if reason changed', () => {
    assert.deepEqual(decide({ enabled: true, threshold: 200, remaining: 1, limitHit: { at: new Date() }, state: { month }, month }),
      { send: false, reason: null });
  });
  it('limit_hit wins over below_threshold when both true', () => {
    assert.deepEqual(decide({ enabled: true, threshold: 200, remaining: 5, limitHit: { at: new Date() }, state: {}, month }),
      { send: true, reason: 'limit_hit' });
  });
  it('below_threshold alone', () => {
    assert.deepEqual(decide({ enabled: true, threshold: 200, remaining: 5, limitHit: null, state: {}, month }),
      { send: true, reason: 'below_threshold' });
  });
  it('remaining=null (unlimited plan / not connected) never triggers below_threshold', () => {
    assert.deepEqual(decide({ enabled: true, threshold: 200, remaining: null, limitHit: null, state: {}, month }),
      { send: false, reason: null });
  });
  it('remaining above threshold, no limit hit → no send', () => {
    assert.deepEqual(decide({ enabled: true, threshold: 200, remaining: 500, limitHit: null, state: {}, month }),
      { send: false, reason: null });
  });
});

// ── checkQuota() — fake pool dispatched on SQL substring ─────────────────
function makePool({ token = 'tok', recipients = [], settings = {}, alertLogsHit = null, inserted = [] } = {}) {
  const calls = [];
  return {
    calls, inserted,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM line_config WHERE id = 1')) return { rows: [{ channel_access_token: token, recipients }] };
      if (sql.includes('FROM system_settings WHERE key = ANY')) {
        const rows = Object.entries(settings).map(([key, value]) => ({ key, value }));
        return { rows };
      }
      if (sql.includes('FROM system_settings WHERE key = $1')) {
        const v = settings[params[0]];
        return { rows: v === undefined ? [] : [{ value: v }] };
      }
      if (sql.includes('FROM alert_logs') && sql.includes('monthly limit')) {
        return { rows: alertLogsHit ? [alertLogsHit] : [] };
      }
      if (sql.startsWith('INSERT INTO alert_logs')) { inserted.push(params); return { rows: [] }; }
      if (sql.startsWith('INSERT INTO system_settings')) { inserted.push({ upsert: params }); return { rows: [] }; }
      throw new Error(`unexpected sql in fake pool: ${sql.slice(0, 80)}`);
    },
  };
}

function makeLineSender({ quota, pushResults = {} } = {}) {
  const pushed = [];
  return {
    pushed,
    getLineQuota: async () => quota,
    pushLineMessage: async (token, recipientId) => {
      pushed.push(recipientId);
      return pushResults[recipientId] || { success: true };
    },
  };
}

describe('checkQuota — sends only to configured+enabled recipients', () => {
  it('below-threshold: pushes only ids listed in line_quota_alert_recipients', async () => {
    const recipients = [
      { id: 'U1', name: 'Owner', enabled: true },
      { id: 'U2', name: 'Not selected', enabled: true },
      { id: 'U3', name: 'Disabled', enabled: false },
    ];
    const settings = {
      line_quota_alert_enabled: 'true', line_quota_alert_threshold: '200',
      line_quota_alert_recipients: JSON.stringify(['U1', 'U3']), line_quota_alert_state: '{}',
    };
    const pool = makePool({ recipients, settings });
    const lineSender = makeLineSender({ quota: { type: 'limited', limit: 1000, used: 900 } });
    await checkQuota(pool, { lineSender, now: new Date('2026-09-24T10:00:00Z') });
    assert.deepEqual(lineSender.pushed, ['U1']); // U2 not selected, U3 selected but disabled
  });

  it('marks the month when at least one recipient succeeds', async () => {
    const recipients = [{ id: 'U1', name: 'Owner', enabled: true }];
    const settings = {
      line_quota_alert_enabled: 'true', line_quota_alert_threshold: '200',
      line_quota_alert_recipients: JSON.stringify(['U1']), line_quota_alert_state: '{}',
    };
    const pool = makePool({ recipients, settings });
    const lineSender = makeLineSender({ quota: { type: 'limited', limit: 1000, used: 950 } });
    await checkQuota(pool, { lineSender, now: new Date('2026-09-24T10:00:00Z') });
    const stateWrite = pool.inserted.find((c) => c.upsert && c.upsert[0] === 'line_quota_alert_state');
    assert.ok(stateWrite, 'expected line_quota_alert_state to be written');
    const written = JSON.parse(stateWrite.upsert[1]);
    assert.equal(written.month, '2026-09');
    assert.equal(written.reason, 'below_threshold');
  });

  it('does NOT mark the month when every recipient send fails', async () => {
    const recipients = [{ id: 'U1', name: 'Owner', enabled: true }];
    const settings = {
      line_quota_alert_enabled: 'true', line_quota_alert_threshold: '200',
      line_quota_alert_recipients: JSON.stringify(['U1']), line_quota_alert_state: '{}',
    };
    const pool = makePool({ recipients, settings });
    const lineSender = makeLineSender({
      quota: { type: 'limited', limit: 1000, used: 950 },
      pushResults: { U1: { success: false, error: 'HTTP 500' } },
    });
    await checkQuota(pool, { lineSender, now: new Date('2026-09-24T10:00:00Z') });
    const stateWrite = pool.inserted.find((c) => c.upsert && c.upsert[0] === 'line_quota_alert_state');
    assert.equal(stateWrite, undefined, 'must not mark the month on total failure — retry next tick');
    // last-snapshot still recorded, with an alert_error
    const lastWrite = pool.inserted.find((c) => c.upsert && c.upsert[0] === 'line_quota_last');
    assert.ok(lastWrite);
    assert.ok(JSON.parse(lastWrite.upsert[1]).alert_error);
  });

  it('does not send twice in the same month', async () => {
    const recipients = [{ id: 'U1', name: 'Owner', enabled: true }];
    const settings = {
      line_quota_alert_enabled: 'true', line_quota_alert_threshold: '200',
      line_quota_alert_recipients: JSON.stringify(['U1']),
      line_quota_alert_state: JSON.stringify({ month: '2026-09', sent_at: '2026-09-01T00:00:00Z', reason: 'below_threshold', results: [] }),
    };
    const pool = makePool({ recipients, settings });
    const lineSender = makeLineSender({ quota: { type: 'limited', limit: 1000, used: 950 } });
    await checkQuota(pool, { lineSender, now: new Date('2026-09-24T10:00:00Z') });
    assert.deepEqual(lineSender.pushed, [], 'already alerted this month — must not push again');
  });

  it('limit_hit (from alert_logs) fires even when consumption numbers look fine', async () => {
    const recipients = [{ id: 'U1', name: 'Owner', enabled: true }];
    const settings = {
      line_quota_alert_enabled: 'true', line_quota_alert_threshold: '200',
      line_quota_alert_recipients: JSON.stringify(['U1']), line_quota_alert_state: '{}',
    };
    const alertLogsHit = {
      sent_at: new Date('2026-09-24T06:23:00Z'),
      error_message: '[Phuket Eyes Police-VSS] You have reached your monthly limit.',
      recipients_json: [{ name: 'Phuket Eyes Police-VSS', ok: false, error: 'You have reached your monthly limit.' }],
    };
    const pool = makePool({ recipients, settings, alertLogsHit });
    const lineSender = makeLineSender({ quota: { type: 'limited', limit: 17000, used: 15954 } }); // "plenty left" per LINE's own number
    await checkQuota(pool, { lineSender, now: new Date('2026-09-24T10:00:00Z') });
    assert.deepEqual(lineSender.pushed, ['U1']);
    const insertedLog = pool.inserted.find((c) => Array.isArray(c) && c[0] === 'LINE quota');
    assert.ok(insertedLog, 'expected an alert_logs row for the attempt');
    assert.equal(insertedLog[1], 'limit_hit');
  });
});

// ── PUT /api/line-config/quota-alert — validation ─────────────────────────
function makeApp() {
  const handlers = {};
  return {
    app: {
      get: (p, ...fns) => { handlers[`GET ${p}`] = fns[fns.length - 1]; },
      put: (p, ...fns) => { handlers[`PUT ${p}`] = fns[fns.length - 1]; },
      post: (p, ...fns) => { handlers[`POST ${p}`] = fns[fns.length - 1]; },
    },
    handlers,
  };
}
function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.set = () => r;
  return r;
}
function fakeAuth() {
  const passthrough = (req, res, next) => next();
  return { requireAuth: passthrough, requireAdmin: passthrough, requireAdminOrAuditor: passthrough };
}

describe('PUT /api/line-config/quota-alert — validation', () => {
  it('rejects an unknown recipient id (400), never writes settings', async () => {
    const { app, handlers } = makeApp();
    const known = [{ id: 'U1', name: 'Owner' }];
    const written = [];
    const pool = {
      query: async (sql, params) => {
        if (sql.includes('SELECT recipients FROM line_config')) return { rows: [{ recipients: known }] };
        if (sql.startsWith('INSERT INTO system_settings')) { written.push(params); return { rows: [] }; }
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
    lineRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => res.status(500).json({ error: e.message }) });
    const req = { body: { enabled: true, threshold: 200, recipients: ['U1', 'GHOST'] } };
    const res = fakeRes();
    await handlers['PUT /api/line-config/quota-alert'](req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /GHOST/);
    assert.equal(written.length, 0, 'must not write settings when a recipient id is unknown');
  });

  it('accepts known ids and writes the three settings', async () => {
    const { app, handlers } = makeApp();
    const known = [{ id: 'U1', name: 'Owner' }];
    const written = [];
    const pool = {
      query: async (sql, params) => {
        if (sql.includes('SELECT recipients FROM line_config')) return { rows: [{ recipients: known }] };
        if (sql.startsWith('INSERT INTO system_settings')) { written.push(params); return { rows: [] }; }
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
    lineRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => res.status(500).json({ error: e.message }) });
    const req = { body: { enabled: false, threshold: 150, recipients: ['U1'] } };
    const res = fakeRes();
    await handlers['PUT /api/line-config/quota-alert'](req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true });
    assert.equal(written.length, 1);
    assert.deepEqual(written[0], ['false', '150', JSON.stringify(['U1'])]);
  });

  it('rejects a non-integer threshold (400)', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async () => ({ rows: [{ recipients: [] }] }) };
    lineRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => res.status(500).json({ error: e.message }) });
    const req = { body: { enabled: true, threshold: 0, recipients: [] } };
    const res = fakeRes();
    await handlers['PUT /api/line-config/quota-alert'](req, res);
    assert.equal(res.statusCode, 400);
  });
});

// audit 2026-09-24 — ตัวจับเวลาวิ่งทุก 2 นาที ต้องไม่ลง alert_logs ซ้ำทุกรอบ
describe('checkQuota — ไม่ลง log/ไม่ยิงซ้ำทุกรอบ', () => {
  const { checkQuota } = require('../src/helpers/lineQuotaWatch');
  const now = new Date('2026-09-24T07:00:00Z');
  const quota = { type: 'limited', limit: 17000, used: 16900 };

  it('ยังไม่เลือกผู้รับ → ไม่ส่ง และไม่เขียน alert_logs', async () => {
    const pool = makePool({ recipients: [{ id: 'U1', enabled: true }], settings: { line_quota_alert_recipients: '[]' } });
    const ls = makeLineSender({ quota });
    await checkQuota(pool, { lineSender: ls, now });
    assert.equal(ls.pushed.length, 0);
    assert.equal(pool.inserted.filter((x) => Array.isArray(x)).length, 0, 'ห้ามมีแถว alert_logs');
  });

  it('ส่งไม่ผ่านเมื่อ 10 นาทีก่อน → รอบนี้ไม่ยิงซ้ำ', async () => {
    const pool = makePool({
      recipients: [{ id: 'U1', enabled: true }],
      settings: {
        line_quota_alert_recipients: '["U1"]',
        line_quota_last: JSON.stringify({ attempt_at: new Date(now - 10 * 60000).toISOString(), alert_error: 'x' }),
      },
    });
    const ls = makeLineSender({ quota });
    await checkQuota(pool, { lineSender: ls, now });
    assert.equal(ls.pushed.length, 0);
  });

  it('ส่งไม่ผ่านเมื่อ 31 นาทีก่อน → รอบนี้ลองใหม่', async () => {
    const pool = makePool({
      recipients: [{ id: 'U1', enabled: true }],
      settings: {
        line_quota_alert_recipients: '["U1"]',
        line_quota_last: JSON.stringify({ attempt_at: new Date(now - 31 * 60000).toISOString() }),
      },
    });
    const ls = makeLineSender({ quota });
    await checkQuota(pool, { lineSender: ls, now });
    assert.deepEqual(ls.pushed, ['U1']);
  });
});
