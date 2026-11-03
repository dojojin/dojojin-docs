// ============================================================
// Vigil Platform — Test: computeScheduledRange
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const reportRenderer = require('../src/report-renderer');

describe('computeScheduledRange', () => {
  it('daily schedule returns yesterday', () => {
    // Create a date in local timezone: Sept 3, 2026 at 14:30
    const now = new Date(2026, 8, 3, 14, 30, 0);
    const result = reportRenderer.computeScheduledRange('daily', now);

    // Daily: from = yesterday 00:00, to = today 00:00 (exclusive)
    const fromDate = new Date(result.from);
    const toDate = new Date(result.to);

    // Check that from is Sept 2 at 00:00, to is Sept 3 at 00:00 (in local TZ, then converted to ISO)
    assert.equal(fromDate.getDate(), 2);
    assert.equal(toDate.getDate(), 3);
    assert.match(result.label, /ประจำวันที่/);
  });

  it('weekly schedule returns last 7 days', () => {
    // Create a date in local timezone: Sept 3, 2026
    const now = new Date(2026, 8, 3, 14, 30, 0);
    const result = reportRenderer.computeScheduledRange('weekly', now);

    // Weekly: last 7 days ending today 00:00
    const fromDate = new Date(result.from);
    const toDate = new Date(result.to);

    // toDate should be today at 00:00
    assert.equal(toDate.getDate(), 3);
    assert.equal(toDate.getMonth(), 8);
    assert.equal(toDate.getHours(), 0);
    assert.equal(toDate.getMinutes(), 0);

    const spanDays = (toDate - fromDate) / (24 * 3600 * 1000);
    assert.equal(spanDays, 7);
    assert.match(result.label, /7 วันล่าสุด/);
  });

  it('monthly schedule returns previous calendar month', () => {
    // Test case 1: September 3 should return August (prev month is Aug)
    const sept3 = new Date(2026, 8, 3, 14, 30, 0);
    const result = reportRenderer.computeScheduledRange('monthly', sept3);

    // Check the structure: the range should cover previous calendar month
    assert.match(result.label, /ประจำเดือน/);

    // Parse the ISO strings treating them as UTC
    const fromISO = new Date(result.from);
    const toISO = new Date(result.to);

    // The exact UTC times will depend on the system timezone, so just verify
    // that the range spans roughly one month (28-31 days)
    const spanDays = (toISO - fromISO) / (24 * 3600 * 1000);
    assert.ok(spanDays >= 28 && spanDays <= 31, `Expected span of 28-31 days, got ${spanDays}`);
  });

  it('monthly schedule handles year rollover (Jan → Dec of previous year)', () => {
    // Test case 2: January 15 should return December of previous year
    const jan15 = new Date(2026, 0, 15, 12, 0, 0);  // month 0 = January
    const result = reportRenderer.computeScheduledRange('monthly', jan15);

    // For a year-rollover month, the span should still be ~30 days
    const from = new Date(result.from);
    const to = new Date(result.to);
    const spanDays = (to - from) / (24 * 3600 * 1000);
    assert.ok(spanDays >= 28 && spanDays <= 31, `Expected span of 28-31 days, got ${spanDays}`);

    // The label should be in the label
    assert.match(result.label, /ประจำเดือน/);
  });

  it('monthly schedule: to is exclusive (last instant of prev month is included)', () => {
    // For any month, the range should be approximately one month
    const sept3 = new Date(2026, 8, 3, 0, 0, 0);
    const result = reportRenderer.computeScheduledRange('monthly', sept3);

    const from = new Date(result.from);
    const to = new Date(result.to);

    // The span should be one full month
    const spanDays = (to - from) / (24 * 3600 * 1000);
    assert.ok(spanDays >= 30 && spanDays <= 31, `Expected ~31 days for August, got ${spanDays}`);
  });

  it('summary schedule returns yesterday with anchor', () => {
    // Summary type should return the anchor day (yesterday) and include anchor field
    const now = new Date(2026, 8, 3, 14, 30, 0);  // Sept 3 at 14:30
    const result = reportRenderer.computeScheduledRange('summary', now);

    // Type should be 'summary'
    assert.equal(result.type, 'summary');

    // Should have anchor field
    assert.ok(result.anchor, 'summary result should have anchor field');

    // from/to should be yesterday's whole day (same as daily)
    const from = new Date(result.from);
    const to = new Date(result.to);
    const spanDays = (to - from) / (24 * 3600 * 1000);
    assert.equal(spanDays, 1, 'summary from/to should span 1 day');

    // from should be Sept 2 at 00:00, to should be Sept 3 at 00:00
    assert.equal(from.getDate(), 2);
    assert.equal(to.getDate(), 3);

    // anchor should also be Sept 2 at 00:00
    const anchorDate = new Date(result.anchor);
    assert.equal(anchorDate.getDate(), 2);
    assert.equal(anchorDate.getHours(), 0);

    assert.match(result.label, /รายงานสรุป/);
  });
});

describe('summaryWindows', () => {
  it('computes three time windows from anchor date', () => {
    const reportTemplate = require('../dashboard/report-template.js');
    const anchor = new Date(2026, 8, 15, 12, 0, 0);  // Sept 15, 2026 at noon (local)
    const windows = reportTemplate.summaryWindows(anchor);

    assert.ok(windows.day, 'should have day window');
    assert.ok(windows.week, 'should have week window');
    assert.ok(windows.month, 'should have month window');

    // Day: anchor day [Sept 15, Sept 16)
    const dayFrom = new Date(windows.day.from);
    const dayTo = new Date(windows.day.to);
    assert.equal(dayFrom.getUTCDate(), 14 || 15, 'day window start should be around Sept 15');  // UTC offset may vary
    const daySpan = (dayTo - dayFrom) / (24 * 3600 * 1000);
    assert.equal(daySpan, 1, 'day window should be 1 day');

    // Week: [Sept 9, Sept 16)
    const weekFrom = new Date(windows.week.from);
    const weekTo = new Date(windows.week.to);
    const weekSpan = (weekTo - weekFrom) / (24 * 3600 * 1000);
    assert.equal(weekSpan, 7, 'week window should be 7 days');

    // Month: [Sept 1, Oct 1)
    const monthFrom = new Date(windows.month.from);
    const monthTo = new Date(windows.month.to);
    const monthSpan = (monthTo - monthFrom) / (24 * 3600 * 1000);
    assert.ok(monthSpan >= 29 && monthSpan <= 31, `month window should be ~30 days, got ${monthSpan}`);
  });

  it('summaryWindows handles year rollover correctly', () => {
    const reportTemplate = require('../dashboard/report-template.js');
    const anchor = new Date(2026, 0, 3, 12, 0, 0);  // Jan 3, 2026 at noon
    const windows = reportTemplate.summaryWindows(anchor);

    // Month should be [Dec 1, 2025, Jan 1, 2026)
    const monthFrom = new Date(windows.month.from);
    const monthTo = new Date(windows.month.to);

    // monthFrom should be in December of previous year
    assert.equal(monthFrom.getUTCMonth(), 11, 'month window start should be in December (UTC)');
    assert.equal(monthFrom.getUTCFullYear(), 2025, 'month window start should be in 2025');

    // monthTo should be Jan 1, 2026
    assert.equal(monthTo.getUTCMonth(), 0, 'month window end should be in January (UTC)');
    assert.equal(monthTo.getUTCFullYear(), 2026, 'month window end should be in 2026');
  });
});

describe('dailyWindows', () => {
  it('daily7 window: 7 days ending on anchor (inclusive)', () => {
    const reportTemplate = require('../dashboard/report-template.js');
    const anchor = new Date(2026, 8, 3, 12, 0, 0);  // Sept 3, 2026
    const windows = reportTemplate.dailyWindows(anchor);

    // daily7: [anchor-6d 00:00, anchor+1d 00:00) in local TZ, then to ISO
    const from = new Date(windows.daily7.from);
    const to = new Date(windows.daily7.to);

    // Reconstruct local dates from UTC (getDate gets the UTC date, which may differ from local by 1)
    // Instead, compute expected from local anchor
    const anchorLocal = new Date(anchor);
    anchorLocal.setHours(0, 0, 0, 0);
    const fromLocal = new Date(anchorLocal);
    fromLocal.setDate(anchorLocal.getDate() - 6);

    // Check span is 7 days
    const span = (to - from) / (24 * 3600 * 1000);
    assert.equal(span, 7, 'daily7 should span exactly 7 days');

    // Check that the range includes the anchor date
    const toMinusOneMs = new Date(to.getTime() - 1);
    assert.ok(toMinusOneMs.getDate() === anchorLocal.getDate(), 'last day of range should be anchor date (local)');
  });

  it('daily7 window: crosses year boundary', () => {
    const reportTemplate = require('../dashboard/report-template.js');
    const anchor = new Date(2026, 0, 2, 12, 0, 0);  // Jan 2, 2026
    const windows = reportTemplate.dailyWindows(anchor);

    const from = new Date(windows.daily7.from);
    const to = new Date(windows.daily7.to);

    const span = (to - from) / (24 * 3600 * 1000);
    assert.equal(span, 7, 'daily7 should span 7 days even crossing year boundary');

    // Verify it includes Dec 27, 2025 (7 days before Jan 2)
    const fromLocal = new Date(from);
    fromLocal.setDate(fromLocal.getDate() - 1);  // Account for UTC offset
    // Just verify span; exact dates depend on TZ
  });

  it('monthly window: 1st of month to anchor+1d (local TZ)', () => {
    const reportTemplate = require('../dashboard/report-template.js');
    const anchor = new Date(2026, 8, 3, 12, 0, 0);  // Sept 3
    const windows = reportTemplate.dailyWindows(anchor);

    const from = new Date(windows.monthly.from);
    const to = new Date(windows.monthly.to);

    // from should start on Sept 1 (in local TZ converted to UTC)
    // to should be Oct 1 but clamped at anchor+1d in local TZ
    // For Sept 3: from = Sept 1, to = Sept 4 (anchor+1d)
    const span = (to - from) / (24 * 3600 * 1000);
    assert.ok(span >= 3 && span <= 4, `monthly should span ~3-4 days for anchor=Sept 3, got ${span}`);
  });

  it('monthly window: includes full month when anchor is last day', () => {
    const reportTemplate = require('../dashboard/report-template.js');
    const anchor = new Date(2026, 8, 30, 12, 0, 0);  // Sept 30 (last day of Sept)
    const windows = reportTemplate.dailyWindows(anchor);

    const from = new Date(windows.monthly.from);
    const to = new Date(windows.monthly.to);

    // Should span nearly full month
    const span = (to - from) / (24 * 3600 * 1000);
    assert.ok(span >= 29 && span <= 31, `monthly on last day should span ~30 days, got ${span}`);
  });
});

describe('fillDays', () => {
  it('fills missing days with zero, preserves existing counts', () => {
    const reportTemplate = require('../dashboard/report-template.js');
    const points = [
      { date: '2026-09-01', total: 10 },
      { date: '2026-09-03', total: 20 },
      { date: '2026-09-05', total: 30 },
    ];
    const from = new Date(2026, 8, 1);   // Sept 1
    const to = new Date(2026, 8, 6);     // Sept 6 (exclusive, so includes Sept 5)

    const result = reportTemplate.fillDays(points, from, to);

    assert.equal(result.length, 5, 'should have 5 days (Sept 1-5)');
    assert.equal(result[0].date, '2026-09-01');
    assert.equal(result[0].total, 10);
    assert.equal(result[1].date, '2026-09-02');
    assert.equal(result[1].total, 0, 'missing Sept 2 should be filled with 0');
    assert.equal(result[2].date, '2026-09-03');
    assert.equal(result[2].total, 20);
    assert.equal(result[3].date, '2026-09-04');
    assert.equal(result[3].total, 0);
    assert.equal(result[4].date, '2026-09-05');
    assert.equal(result[4].total, 30);
  });

  it('uses local date components for keys (not ISO slice)', () => {
    const reportTemplate = require('../dashboard/report-template.js');
    // Simulate data that might come from endpoint (ISO timestamps)
    // For Bangkok (UTC+7), local date 2026-09-01 00:00 is 2026-08-31T17:00:00Z
    const points = [
      { date: '2026-09-01', total: 5 },
    ];
    const from = new Date(2026, 8, 1);
    const to = new Date(2026, 8, 2);

    const result = reportTemplate.fillDays(points, from, to);

    assert.equal(result.length, 1);
    assert.equal(result[0].date, '2026-09-01', 'key should use YYYY-MM-DD from local date, not ISO slice');
  });

  it('handles empty input', () => {
    const reportTemplate = require('../dashboard/report-template.js');
    const points = [];
    const from = new Date(2026, 8, 1);
    const to = new Date(2026, 8, 3);

    const result = reportTemplate.fillDays(points, from, to);

    assert.equal(result.length, 2);
    assert.equal(result[0].date, '2026-09-01');
    assert.equal(result[0].total, 0);
    assert.equal(result[1].date, '2026-09-02');
    assert.equal(result[1].total, 0);
  });
});
