// Vigil Platform — log token ที่ไม่รู้จักเป็นสรุปพร้อมต้นทาง (audit 2026-10-02 · D15)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUnknownTokenLog } = require('../src/helpers/unknownTokenLog');

test('aggregates by source and token prefix, flushes one line', () => {
  const lines = [];
  const l = createUnknownTokenLog('face-push', { flushMs: 60_000, log: (m) => lines.push(m) });
  const req = (ip, token) => ({ headers: { 'cf-connecting-ip': ip }, params: { token } });
  for (let i = 0; i < 5; i++) l.record(req('1.2.3.4', 'abcdef123456'));
  l.record(req('5.6.7.8', 'zzz999000'));
  l.flush(); l.stop();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /dropped 6 request\(s\)/);
  assert.match(lines[0], /1\.2\.3\.4 \(token abcdef…\) ×5 · 5\.6\.7\.8 \(token zzz999…\) ×1/);
  assert.doesNotMatch(lines[0], /abcdef123456/, 'full token never logged');
});

test('both push gates use it instead of a line per request', () => {
  for (const f of ['src/routes/face-push.js', 'src/routes/lpr.js']) {
    const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(s, /createUnknownTokenLog\(/, f);
    assert.doesNotMatch(s, /console\.warn\('\[(face|lpr)-push\] unknown token/, f);
  }
});

test('last window total is exposed for the Health page, and resets to 0', () => {
  const { lastWindows } = require('../src/helpers/unknownTokenLog');
  const l = createUnknownTokenLog('t-health', { flushMs: 60_000, log: () => {} });
  l.record({ headers: {}, params: { token: 'abcdef' }, socket: { remoteAddress: '9.9.9.9' } });
  l.flush();
  assert.equal(lastWindows()['t-health'], 1);
  l.flush(); l.stop();
  assert.equal(lastWindows()['t-health'], 0, 'a quiet window clears the flag');
});
