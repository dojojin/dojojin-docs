// ============================================================
// Vigil Platform — test: UI ปิดปรับปรุงไซต์ (S2b · migration 285)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// source-level: ตรวจว่าปุ่ม/ป้าย/endpoint/คีย์ i18n ยังอยู่ครบ และ edge ที่ปิดปรับปรุง
// ไม่ถูกทาสีเป็น "ขาดการติดต่อ" (backend เงียบแจ้งเตือนไว้แล้ว หน้าจอต้องไม่ขัดกัน)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rd = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const SYS = rd('dashboard', 'page-system.js');
const HLTH = rd('dashboard', 'page-health.js');
const ROUTE = rd('src', 'routes', 'health.js');
const I18N = rd('dashboard', 'i18n.js');
const BIND = rd('dashboard', 'page-nav-bindings.js');

const KEYS = ['sys.maintChip', 'sys.maintBtn', 'sys.maintEndBtn', 'sys.maintNotePh', 'sys.maintConsequence',
  'sys.maintConfirm', 'sys.maintEndConfirm', 'sys.maintPaused', 'sys.maintResumed', 'sys.maintNoChange',
  'sys.maintFailed', 'sys.maintBy', 'hlth.edgeMaintenance'];

describe('page-system.js — site maintenance', () => {
  it('PUTs /api/sites/:id/status', () => {
    assert.match(SYS, /\/api\/sites\/\$\{id\}\/status/);
    assert.match(SYS, /method: 'PUT'/);
  });
  it('uses every maintenance i18n key', () => {
    for (const k of KEYS.filter(k => k.startsWith('sys.'))) assert.ok(SYS.includes(`'${k}'`), `page-system.js ไม่ได้ใช้ ${k}`);
  });
  it('every key exists in both th and en blocks', () => {
    for (const k of KEYS) assert.equal(I18N.split(`'${k}':`).length - 1, 2, `${k} ต้องมี 2 ที่ (th+en)`);
  });
  it('no inline handlers; buttons wired through data-action + bindings', () => {
    assert.doesNotMatch(SYS, /onclick\s*=/i);
    for (const a of ['siteMaintenance', 'confirmSiteMaintenance', 'cancelSiteMaintenance']) {
      assert.ok(SYS.includes(`data-action="${a}"`), `ไม่มีปุ่ม ${a}`);
      assert.match(BIND, new RegExp(`${a}:\\s+\\(`), `ไม่ได้ bind ${a}`);
    }
  });
  it('note capped at 500 and main site gets no button', () => {
    assert.match(SYS, /maxlength="500"/);
    assert.match(SYS, /s\.code !== 'main' && !isArch\s*\n?\s*\? `<button[^`]*siteMaintenance/);
  });
});

const ARCH_KEYS = ['sys.archivedChip', 'sys.archiveBtn', 'sys.unarchiveBtn', 'sys.archiveConfirm', 'sys.unarchiveConfirm',
  'sys.edgeRevoked', 'sys.needsEdgeProvision', 'sys.provisionEdgeBtn', 'sys.provisionEdgeConfirm', 'hlth.edgeArchived'];

describe('page-system.js — site archive (S4)', () => {
  it('every archive key exists in both th and en blocks', () => {
    for (const k of ARCH_KEYS) assert.equal(I18N.split(`'${k}':`).length - 1, 2, `${k} ต้องมี 2 ที่ (th+en)`);
  });
  it('uses the archive keys in page-system.js / page-health.js', () => {
    for (const k of ARCH_KEYS.filter(k => k.startsWith('sys.'))) assert.ok(SYS.includes(`'${k}'`), `page-system.js ไม่ได้ใช้ ${k}`);
    assert.ok(HLTH.includes("'hlth.edgeArchived'"));
  });
  it('archive/unarchive wired via data-action + bindings, no inline handlers', () => {
    for (const a of ['siteArchive', 'siteUnarchive']) {
      assert.ok(SYS.includes(`data-action="${a}"`), `ไม่มีปุ่ม ${a}`);
      assert.match(BIND, new RegExp(`${a}:\\s+\\(`), `ไม่ได้ bind ${a}`);
    }
    assert.doesNotMatch(SYS, /onclick\s*=/i);
  });
  it('archive button only for maintenance sites (not active, not main); unarchive only for archived', () => {
    assert.match(SYS, /s\.code === 'main' \? ''[\s\S]*?isArch \? `<button[^`]*siteUnarchive[\s\S]*?s\.status === 'maintenance' \? `<button[^`]*siteArchive/);
  });
  it('archive + unarchive confirm() then PUT archived/active; result shows warning and provision hint', () => {
    assert.match(SYS, /function siteArchive\(el\)[\s\S]*?confirm\([\s\S]*?_putSiteStatus\(el\.dataset\.id, \{ status: 'archived' \}\)/);
    assert.match(SYS, /function siteUnarchive\(el\)[\s\S]*?confirm\([\s\S]*?_putSiteStatus\(el\.dataset\.id, \{ status: 'active' \}\)/);
    assert.match(SYS, /j\.warning/);
    assert.match(SYS, /j\.needs_edge_provision/);
  });
  it('chip uses neutral --text-secondary for archived (no raw colours)', () => {
    assert.match(SYS, /isArch \? 'var\(--text-secondary\)' : 'var\(--warn\)'/);
  });
  it('provisionSiteEdge asks confirm() before POST; button relabelled', () => {
    const f = SYS.slice(SYS.indexOf('async function provisionSiteEdge'));
    assert.ok(f.indexOf('confirm(') > 0 && f.indexOf('confirm(') < f.indexOf('provision-edge'));
    assert.match(SYS, /data-action="provisionSiteEdge"[^>]*>\$\{escapeHtml\(I18N\.t\('sys\.provisionEdgeBtn'/);
    assert.doesNotMatch(SYS, /Edge ↗/);
  });
  it('health edge badge shows archived label', () => {
    assert.match(HLTH, /es\.status === 'archived' \? I18N\.t\('hlth\.edgeArchived'/);
  });
});

describe('health edge status', () => {
  it('health.js joins sites status onto edge_status (default active)', () => {
    assert.match(ROUTE, /LEFT JOIN sites st ON st\.code = es\.site_id/);
    assert.match(ROUTE, /COALESCE\(st\.status, 'active'\)/);
    assert.match(ROUTE, /status:\s+r\.site_status/);
  });
  it('page-health.js checks status before stale when picking the edge badge', () => {
    const i = HLTH.indexOf("es.status !== 'active'");
    const j = HLTH.indexOf("_healthBadge(es.stale ? 'warn' : 'ok'");
    assert.ok(i > 0 && j > i, 'ต้องเช็ก status ก่อนใช้ stale');
    assert.match(HLTH, /inMaint\s*\n?\s*\? _healthBadge\('idle'/);
  });
});
