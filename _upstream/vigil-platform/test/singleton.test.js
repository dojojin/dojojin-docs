// ============================================================
// Vigil Platform — singleton lock: is that pid really our service?
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// GOTCHAS #193: process.kill(pid, 0) says "alive" for a thread id too, so a
// stale pid file surviving a reboot could point at a libuv worker thread of an
// unrelated process and block the service forever.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { procIsOurs } = require('../src/singleton');

const SRC = path.join(__dirname, '..', 'src');

/** fake /proc reader: { '<path>': contents }, anything else throws ENOENT */
const reader = (files) => (f) => {
  if (!(f in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
  return files[f];
};

test('a live process of ours is recognised by its cmdline path', () => {
  const read = reader({
    '/proc/1042/status':  'Name:\tnode\nTgid:\t1042\nPid:\t1042\n',
    '/proc/1042/cmdline': `node\0${SRC}/lpr-receiver.js\0`,
  });
  assert.equal(procIsOurs(1042, 'lpr-receiver', read), true);
});

test('the service name alone is enough when the path is relative', () => {
  const read = reader({
    '/proc/77/status':  'Tgid:\t77\nPid:\t77\n',
    '/proc/77/cmdline': 'node\0ingesters/dahua-cgi.js\0',
  });
  assert.equal(procIsOurs(77, 'dahua-cgi', read), true);
});

test('a THREAD id is not a live instance (the #193 case)', () => {
  // /proc/<tid> exists and is readable, but Tgid names the owning process.
  const read = reader({
    '/proc/1042/status':  'Name:\tlibuv-worker\nTgid:\t993\nPid:\t1042\n',
    '/proc/1042/cmdline': `node\0${SRC}/ingesters/hikvision-isapi.js\0`,
  });
  assert.equal(procIsOurs(1042, 'lpr-receiver', read), false);
});

test('a real process that is not ours does not hold our lock', () => {
  const read = reader({
    '/proc/500/status':  'Tgid:\t500\nPid:\t500\n',
    '/proc/500/cmdline': '/usr/bin/postgres\0-D\0/var/lib/postgresql\0',
  });
  assert.equal(procIsOurs(500, 'lpr-receiver', read), false);
});

test('no /proc entry means the pid is dead', () => {
  assert.equal(procIsOurs(31337, 'lpr-receiver', reader({})), false);
});

test('status without a Tgid line is treated as not ours, not as alive', () => {
  const read = reader({
    '/proc/8/status':  'Name:\tnode\nPid:\t8\n',
    '/proc/8/cmdline': `node\0${SRC}/lpr-receiver.js\0`,
  });
  assert.equal(procIsOurs(8, 'lpr-receiver', read), false);
});

test('the real current process is recognised on linux', { skip: process.platform !== 'linux' }, () => {
  // no injected reader: this reads /proc for real. The test runner's cmdline
  // contains "singleton", which is the name we pass.
  assert.equal(procIsOurs(process.pid, 'singleton'), true);
});
