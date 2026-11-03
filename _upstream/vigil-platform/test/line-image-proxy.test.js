// ============================================================
// Vigil Platform — Tests: per-site snapshot proxy + imgbb expiry
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// uploadToImgbb read a single SNAPSHOT_PROXY_URL — pointed at VSS — so every
// alert from Phuket or Hat Yai found no file and fell back to text, silently,
// because that fallback is a legitimate outcome and nothing distinguished it
// from "this event genuinely has no snapshot". api-server's /snapshots route had
// resolved this per camera for as long as edge sites have existed; this path was
// the one that never got the memo.
//
// These tests pin the two things that would be silent again if they broke: the
// URL a given site resolves to, and that the expiry actually reaches imgbb
// within the range imgbb accepts.
// ============================================================
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const lineSender = require('../src/line-sender');
const { edgeProxyBaseUrl } = require('../src/helpers/edgeProxyBaseUrl');

describe('_clampExpire — imgbb rejects the upload outright if this is out of range', () => {
  const { _clampExpire, IMGBB_EXPIRE_DEFAULT_SEC } = lineSender;

  it('passes a sane value through', () => {
    assert.equal(_clampExpire(24 * 3600), 86400);
  });

  it('falls back to the platform default when unset or unparseable', () => {
    assert.equal(_clampExpire(undefined), IMGBB_EXPIRE_DEFAULT_SEC);
    assert.equal(_clampExpire(null), IMGBB_EXPIRE_DEFAULT_SEC);
    assert.equal(_clampExpire('ทุกวัน'), IMGBB_EXPIRE_DEFAULT_SEC);
  });

  it('clamps rather than passing a value imgbb would reject', () => {
    assert.equal(_clampExpire(1), 60, 'below imgbb minimum');
    assert.equal(_clampExpire(99999999), 15552000, 'above imgbb 180-day maximum');
  });

  it('keeps the platform default at 48h so non-LPR alerts are unchanged', () => {
    assert.equal(IMGBB_EXPIRE_DEFAULT_SEC, 172800);
  });
});

describe('uploadToImgbb — which host the image is fetched from', () => {
  const calls = [];
  let realFetch, realProxyUrl;

  before(() => {
    realFetch = global.fetch;
    realProxyUrl = process.env.SNAPSHOT_PROXY_URL;
    process.env.SNAPSHOT_PROXY_URL = 'https://vss.example.test';
    process.env.SNAPSHOT_PROXY_SECRET = 'test-secret';
    process.env.SNAPSHOT_PROXY_DOMAIN = 'example.test';
    // Fail every fetch: this asserts the URL that was asked for, and stopping
    // before the body keeps the test off the network and away from imgbb.
    global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: false, status: 404 }; };
  });
  after(() => {
    global.fetch = realFetch;
    if (realProxyUrl === undefined) delete process.env.SNAPSHOT_PROXY_URL;
    else process.env.SNAPSHOT_PROXY_URL = realProxyUrl;
  });

  // A path that cannot exist on this machine, so the disk branch is skipped and
  // the proxy branch is the one under test.
  const MISSING = 'events/2026-08-04/hdy-anpr-r52/1000/no-such-file.jpg';

  it('fetches a Hat Yai image from the Hat Yai edge, not from VSS', async () => {
    calls.length = 0;
    await lineSender.uploadToImgbb(MISSING, 'key', { siteCode: 'hdy' });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith('https://hdy.example.test/snapshots/'), calls[0].url);
    assert.ok(!calls[0].url.includes('vss.'), 'must not fall back to the single old URL');
  });

  it('sends a different site to a different host — no cross-site fetch', async () => {
    calls.length = 0;
    await lineSender.uploadToImgbb(MISSING, 'key', { siteCode: 'hkt' });
    assert.ok(calls[0].url.startsWith('https://hkt.example.test/snapshots/'), calls[0].url);
    assert.equal(calls[0].url, edgeProxyBaseUrl('hkt', 'example.test') + '/snapshots/' + MISSING);
  });

  it('still uses the old single URL when no site is known', async () => {
    calls.length = 0;
    await lineSender.uploadToImgbb(MISSING, 'key', {});
    assert.ok(calls[0].url.startsWith('https://vss.example.test/snapshots/'), calls[0].url);
  });

  it('carries the shared bearer, or the edge answers 401', async () => {
    calls.length = 0;
    await lineSender.uploadToImgbb(MISSING, 'key', { siteCode: 'hdy' });
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer test-secret');
  });

  it('returns null rather than throwing when the edge has no such file', async () => {
    assert.equal(await lineSender.uploadToImgbb(MISSING, 'key', { siteCode: 'hdy' }), null);
  });

  it('does nothing at all without a filename or an imgbb key', async () => {
    calls.length = 0;
    assert.equal(await lineSender.uploadToImgbb(null, 'key', { siteCode: 'hdy' }), null);
    assert.equal(await lineSender.uploadToImgbb(MISSING, null, { siteCode: 'hdy' }), null);
    assert.equal(calls.length, 0, 'and reaches no network at all');
  });
});
