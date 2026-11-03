// Vigil Platform — Site Admin gate: Phuket (site 1) ห้ามแตะของ HDY (site 2) ทุกเส้นที่เปิดให้
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSiteAdminWrite, RULES } = require('../src/helpers/siteAdminGate');

const CAMS = { PK1: 1, PK2: 1, HD1: 2 };
const CATS = { 10: 1, 20: 2 };
const RULES_DB = { 100: 1, 200: 2 };
const SITES = { 1: 'pk', 2: 'hdy', 9: 'main' };
const ARULES = { 1: { camera_ids: ['PK1'], channel: null }, 2: { camera_ids: ['HD1'], channel: null }, 3: { camera_ids: [], channel: null }, 4: { camera_ids: ['PK1'], channel: 'lpr' } };
const SCHED = { 1: 1, 2: 2, 3: null };
const LGROUPS = { gpk: 1, ghd: 2, gglobal: null };
const FGROUPS = { fpk: 1, fhd: 2, fglobal: null };
const PLATES = { 'กข1234': 'gpk', 'กข9999': 'ghd', 'กข5555': 'gglobal', 'กข0000': null };
const PEOPLE = { 1: 'fpk', 2: 'fhd', 3: 'fglobal', 4: null };
const GROUPS = { groups: [
  { id: 'gp', site_id: 1, cameraIds: ['PK1'] },
  { id: 'gh', site_id: 2, cameraIds: ['HD1'] },
  { id: 'gmix', site_id: 1, cameraIds: ['PK1', 'HD1'] },
  { id: 'gnosite', cameraIds: [] },
] };
const pool = { async query(sql, p) {
  if (/FROM cameras WHERE id = \$1/.test(sql)) return { rows: CAMS[p[0]] ? [{ id: p[0], site_id: CAMS[p[0]] }] : [] };
  if (/FROM cameras WHERE id = ANY/.test(sql)) return { rows: p[0].filter((i) => CAMS[i]).map((i) => ({ id: i, site_id: CAMS[i] })) };
  if (/FROM event_categories WHERE id = ANY/.test(sql)) return { rows: p[0].filter((i) => CATS[i]).map((i) => ({ id: i, site_id: CATS[i] })) };
  if (/SELECT code FROM sites WHERE id/.test(sql)) return { rows: SITES[p[0]] ? [{ code: SITES[p[0]] }] : [] };
  if (/SELECT id, code, name FROM sites/.test(sql)) return { rows: Object.entries(SITES).map(([id, code]) => ({ id: Number(id), code, name: code.toUpperCase() })) };
  if (/FROM alert_rules WHERE id/.test(sql)) return { rows: ARULES[p[0]] ? [ARULES[p[0]]] : [] };
  if (/FROM report_schedules WHERE id/.test(sql)) return { rows: SCHED[p[0]] !== undefined ? [{ site_id: SCHED[p[0]] }] : [] };
  if (/FROM event_category_rules/.test(sql)) return { rows: RULES_DB[p[0]] ? [{ site_id: RULES_DB[p[0]] }] : [] };
  if (/FROM lpr_watchlist_groups WHERE id/.test(sql)) return { rows: p[0] in LGROUPS ? [{ site_id: LGROUPS[p[0]] }] : [] };
  if (/FROM face_blacklist_groups WHERE id/.test(sql)) return { rows: p[0] in FGROUPS ? [{ site_id: FGROUPS[p[0]] }] : [] };
  if (/FROM lpr_watchlist WHERE plate_number/.test(sql)) return { rows: p[0] in PLATES ? [{ group_id: PLATES[p[0]] }] : [] };
  if (/FROM face_blacklist WHERE id/.test(sql)) return { rows: p[0] in PEOPLE ? [{ group_id: PEOPLE[p[0]] }] : [] };
  throw new Error('unexpected sql ' + sql);
} };
const deps = { pool, loadGroups: () => GROUPS, loadCameraConfig: () => ({ cameras: [{ camera_id: 'PK1' }, { camera_id: 'ORPHAN' }] }) };
const scope = (sites, cameras) => { const a = [...sites]; Object.defineProperty(a, 'cameras', { value: cameras ?? null }); return a; };
const call = (method, url, body, sites = [1], cams) => {
  const i = url.indexOf('/', 5), base = url.slice(0, url.indexOf('/', i + 1) > 0 ? url.indexOf('/', i + 1) : url.length);
  return checkSiteAdminWrite({ method, baseUrl: base, path: url.slice(base.length) || '/', body, user: { role: 'site_admin', allowedSites: scope(sites, cams) } }, deps);
};
const allowed = async (...a) => (await call(...a)).ok;

test('cameras: own site ok, other site denied, upsert hijack denied', async () => {
  assert.equal(await allowed('POST', '/api/cameras', { camera_id: 'NEW1', site_id: 1 }), true);
  assert.equal(await allowed('POST', '/api/cameras', { camera_id: 'PK1', site_id: 1 }), true);
  assert.equal(await allowed('POST', '/api/cameras', { camera_id: 'NEW1', site_id: 2 }), false, 'site_id ของไซต์อื่น');
  assert.equal(await allowed('POST', '/api/cameras', { camera_id: 'HD1', site_id: 1 }), false, 'ยึดกล้อง HDY ด้วย site_id ตัวเอง');
  assert.equal(await allowed('POST', '/api/cameras', { camera_id: 'HD1​', site_id: 1 }), false, 'อักขระล่องหน');
  assert.equal(await allowed('POST', '/api/cameras', { camera_id: 'NEW1' }), false, 'ไม่ส่ง site_id');
  assert.equal(await allowed('POST', '/api/cameras', { camera_id: 'ORPHAN', site_id: 1 }), false, 'มีใน config แต่ไม่มีใน DB');
  assert.equal(await allowed('DELETE', '/api/cameras/PK1'), true);
  assert.equal(await allowed('DELETE', '/api/cameras/HD1'), false);
  assert.equal(await allowed('DELETE', '/api/cameras/NOPE'), false);
});

test('cameras: per-camera restriction (user_cameras) is honoured', async () => {
  assert.equal(await allowed('DELETE', '/api/cameras/PK2', null, [1], ['PK1']), false);
  assert.equal(await allowed('POST', '/api/cameras', { camera_id: 'NEW1', site_id: 1 }, [1], ['PK1']), false);
});

test('groups', async () => {
  assert.equal(await allowed('POST', '/api/groups', { name: 'x', site_id: 1, cameraIds: ['PK1'] }), true);
  assert.equal(await allowed('POST', '/api/groups', { name: 'x', site_id: 1, cameraIds: ['HD1'] }), false);
  assert.equal(await allowed('POST', '/api/groups', { id: 'gh', name: 'x', site_id: 1, cameraIds: ['PK1'] }), false, 'ทับกลุ่ม HDY');
  assert.equal(await allowed('POST', '/api/groups', { id: 'gmix', name: 'x', site_id: 1, cameraIds: ['PK1'] }), false, 'กลุ่มเดิมมีกล้องไซต์อื่น');
  assert.equal(await allowed('DELETE', '/api/groups/gp'), true);
  assert.equal(await allowed('DELETE', '/api/groups/gh'), false);
  assert.equal(await allowed('DELETE', '/api/groups/gmix'), false);
  assert.equal(await allowed('DELETE', '/api/groups/gnosite'), false);
});

test('categories + rules', async () => {
  assert.equal(await allowed('POST', '/api/categories', { name: 'a', site_id: 1 }), true);
  assert.equal(await allowed('POST', '/api/categories', { name: 'a', site_id: 2 }), false);
  assert.equal(await allowed('PUT', '/api/categories/10'), true);
  assert.equal(await allowed('PUT', '/api/categories/10', { is_locked: false }), false, 'ปลดล็อกหมวด');
  assert.equal(await allowed('PUT', '/api/categories/20'), false);
  assert.equal(await allowed('DELETE', '/api/categories/20'), false);
  assert.equal(await allowed('POST', '/api/categories/20/rules'), false);
  assert.equal(await allowed('POST', '/api/categories/10/rules'), true);
  assert.equal(await allowed('DELETE', '/api/category-rules/200'), false);
  assert.equal(await allowed('DELETE', '/api/category-rules/100'), true);
  assert.equal(await allowed('POST', '/api/categories/bulk-delete', { ids: [10, 20] }), false);
  assert.equal(await allowed('POST', '/api/categories/bulk-delete', { ids: [10] }), true);
  assert.equal(await allowed('POST', '/api/categories/bulk-delete', { ids: [] }), false);
});

test('everything not in RULES is denied (fail closed)', async () => {
  for (const [m, u] of [['POST', '/api/cameras/PK1/push-mqtt'], ['POST', '/api/cameras/PK1/mqtt/regenerate'], ['PATCH', '/api/cameras/reorder'],
    ['PUT', '/api/settings/x'],
    ['POST', '/api/categories/restore'], ['POST', '/api/line-config'], ['DELETE', '/api/alert-logs'], ['POST', '/api/lpr/watchlist']])
    assert.equal(await allowed(m, u, { site_id: 1 }), false, m + ' ' + u);
});

test('no site / unreadable scope = denied', async () => {
  assert.equal(await allowed('DELETE', '/api/cameras/PK1', null, []), false);
  const r = await checkSiteAdminWrite({ method: 'DELETE', baseUrl: '/api/cameras', path: '/PK1', user: { role: 'site_admin' } }, deps);
  assert.equal(r.ok, false);
  const boom = await checkSiteAdminWrite({ method: 'DELETE', baseUrl: '/api/cameras', path: '/PK1', user: { role: 'site_admin', allowedSites: scope([1]) } }, { pool: { query: async () => { throw new Error('db'); } }, loadGroups: () => GROUPS });
  assert.equal(boom.ok, false, 'DB ล้ม = ปฏิเสธ');
});

test('every RULES prefix sits under a requireAdminForWrites mount', () => {
  const api = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/api-server.js'), 'utf8');
  const prefixes = [...api.matchAll(/app\.use\('(\/api\/[^']+)',\s*requireAdminForWrites\('\/'\)\)/g)].map((m) => m[1]);
  // /api/lpr ใช้ lprWriteGuard ซึ่งอ่านผลของ siteAdminGate ผ่าน req.siteAdminWriteOk
  if (/req\.siteAdminWriteOk = g\.ok === true/.test(api) && /siteAdminWriteOk === true/.test(require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/helpers/lprWriteGuard.js'), 'utf8'))) prefixes.push('/api/lpr');
  for (const [, re] of RULES) {
    const src = re.source.replace(/\\\//g, '/').replace(/^\^/, '');
    assert.ok(prefixes.some((p) => src.startsWith(p)), 'ไม่มี middleware ครอบ ' + src);
  }
});

test('LPR watch-list: own-site list editable, global/other-site read-only', async () => {
  assert.equal(await allowed('POST', '/api/lpr/watchlist/groups', { name: 'x', site_id: 1 }), true);
  assert.equal(await allowed('POST', '/api/lpr/watchlist/groups', { name: 'x' }), false, 'สร้างกลุ่ม Global');
  assert.equal(await allowed('POST', '/api/lpr/watchlist/groups', { name: 'x', site_id: 1, notify_line: true }), false, 'notify_line');
  assert.equal(await allowed('PATCH', '/api/lpr/watchlist/groups/gpk', { name: 'y' }), true);
  assert.equal(await allowed('PATCH', '/api/lpr/watchlist/groups/gpk', { site_id: null }), false, 'ทำให้เป็น Global');
  assert.equal(await allowed('PATCH', '/api/lpr/watchlist/groups/gpk', { notify_line: true }), false);
  assert.equal(await allowed('PATCH', '/api/lpr/watchlist/groups/gglobal', { name: 'y' }), false);
  assert.equal(await allowed('DELETE', '/api/lpr/watchlist/groups/ghd'), false);
  assert.equal(await allowed('DELETE', '/api/lpr/watchlist/groups/gpk'), true);
  assert.equal(await allowed('POST', '/api/lpr/watchlist', { plate_number: 'กข 1111', group_id: 'gpk' }), true, 'ป้ายใหม่');
  assert.equal(await allowed('POST', '/api/lpr/watchlist', { plate_number: 'กข 1234', group_id: 'gpk' }), true, 'ป้ายเดิมของตัวเอง');
  assert.equal(await allowed('POST', '/api/lpr/watchlist', { plate_number: 'กข-9999', group_id: 'gpk' }), false, 'ยึดป้ายของ HDY');
  assert.equal(await allowed('POST', '/api/lpr/watchlist', { plate_number: 'กข5555', group_id: 'gpk' }), false, 'ยึดป้ายของ Global');
  assert.equal(await allowed('POST', '/api/lpr/watchlist', { plate_number: 'กข0000', group_id: 'gpk' }), false, 'ป้ายไม่มีกลุ่ม = Global');
  assert.equal(await allowed('POST', '/api/lpr/watchlist', { plate_number: 'กข1111' }), false, 'ไม่ระบุกลุ่ม');
  assert.equal(await allowed('PATCH', '/api/lpr/watchlist/' + encodeURIComponent('กข1234'), { active: false }), true);
  assert.equal(await allowed('PATCH', '/api/lpr/watchlist/' + encodeURIComponent('กข1234'), { group_id: null }), false, 'ย้ายออกเป็น Global');
  assert.equal(await allowed('PATCH', '/api/lpr/watchlist/' + encodeURIComponent('กข9999'), { active: false }), false);
  assert.equal(await allowed('DELETE', '/api/lpr/watchlist/' + encodeURIComponent('กข9999')), false);
  assert.equal(await allowed('DELETE', '/api/lpr/watchlist/' + encodeURIComponent('กข1234')), true);
  assert.equal(await allowed('POST', '/api/lpr/watchlist/bulk-delete', { plates: ['กข1234'] }), false, 'bulk = admin');
  assert.equal(await allowed('POST', '/api/lpr/alert-preview', {}), false);
});

test('face list: own-site group/people only', async () => {
  assert.equal(await allowed('POST', '/api/face-blacklist/groups', { name: 'x', site_id: 1 }), true);
  assert.equal(await allowed('POST', '/api/face-blacklist/groups', { name: 'x', site_id: 2 }), false);
  assert.equal(await allowed('PATCH', '/api/face-blacklist/groups/fhd', { name: 'x' }), false);
  assert.equal(await allowed('DELETE', '/api/face-blacklist/groups/fglobal'), false);
  assert.equal(await allowed('POST', '/api/face-blacklist/roster', { label: 'a', group_id: 'fpk' }), true);
  assert.equal(await allowed('POST', '/api/face-blacklist/roster', { label: 'a', group_id: 'fglobal' }), false);
  assert.equal(await allowed('PUT', '/api/face-blacklist/roster/1', { notes: 'x' }), true);
  assert.equal(await allowed('PUT', '/api/face-blacklist/roster/2', { notes: 'x' }), false);
  assert.equal(await allowed('PUT', '/api/face-blacklist/roster/1/active', { active: false }), true);
  assert.equal(await allowed('PUT', '/api/face-blacklist/roster/4/active', { active: false }), false, 'ไม่มีกลุ่ม = Global');
  assert.equal(await allowed('PUT', '/api/face-blacklist/roster/1', { group_id: 'fhd' }), false);
  assert.equal(await allowed('POST', '/api/face-blacklist/bridge/sync', {}), false);
});

test('cameras: site must have an edge (not main)', async () => {
  assert.equal(await allowed('POST', '/api/cameras', { camera_id: 'NEWM', site_id: 9 }, [1, 9]), false);
  assert.equal(await allowed('POST', '/api/cameras', { camera_id: 'NEWP', site_id: 1 }, [1, 9]), true);
});

test('NVR / CSV / test-connection / detect-models', async () => {
  assert.equal(await allowed('POST', '/api/cameras/scan-nvr', { site_id: 1, ip_address: '10.0.0.1' }), true);
  assert.equal(await allowed('POST', '/api/cameras/scan-nvr', { site_id: 2, ip_address: '10.0.0.1' }), false);
  assert.equal(await allowed('POST', '/api/cameras/scan-nvr', { ip_address: '10.0.0.1' }), false, 'ไม่ระบุไซต์');
  assert.equal(await allowed('POST', '/api/cameras/bulk-create-channels', { site_id: 1, channels: [] }), true);
  assert.equal(await allowed('POST', '/api/cameras/bulk-create-channels', { site_id: 2, channels: [] }), false);
  assert.equal(await allowed('POST', '/api/cameras/bulk-create-channels', { site_id: 1, channels: [{ camera_id: 'HD1', nvr_channel: 1 }] }), false, 'id ของกล้อง HDY ที่มีใน DB');
  assert.equal(await allowed('POST', '/api/cameras/bulk-create-channels', { site_id: 1, channels: [{ camera_id: 'ORPHAN', nvr_channel: 1 }] }), false, 'id ที่มีในไฟล์ config');
  assert.equal(await allowed('POST', '/api/cameras/bulk-import', { cameras: [{ site: 'pk', camera_id: 'HD1' }] }), false, 'CSV ใช้ id กล้อง HDY');
  assert.equal(await allowed('POST', '/api/cameras/bulk-import', { cameras: [{ site: 'pk' }, { site: 'PK' }] }), true);
  const csv = await call('POST', '/api/cameras/bulk-import', { cameras: [{ site: 'pk' }, { site: 'hdy' }, { site: 'nope' }] });
  assert.equal(csv.ok, false); assert.match(csv.reason, /2,3/, 'ทั้งไฟล์ถูกปฏิเสธ พร้อมเลขแถว');
  assert.equal(await allowed('POST', '/api/cameras/bulk-import', { cameras: [{ site: 'main' }] }, [1, 9]), false, 'main ไม่มี edge');
  assert.equal(await allowed('POST', '/api/cameras/test-connection', { camera_id: 'PK1', ip_address: '1.2.3.4' }), true);
  assert.equal(await allowed('POST', '/api/cameras/test-connection', { camera_id: 'HD1', ip_address: '1.2.3.4', site_id: 1 }), false, 'site_id ของตัวเองแต่กล้อง HDY');
  assert.equal(await allowed('POST', '/api/cameras/test-connection', { site_id: 1, ip_address: '1.2.3.4' }), true);
  assert.equal(await allowed('POST', '/api/cameras/test-connection', { site_id: 2, ip_address: '1.2.3.4' }), false);
  assert.equal(await allowed('POST', '/api/cameras/detect-models', {}), true);
  assert.equal(await allowed('POST', '/api/cameras/probe-snapshot', { ip_address: '1.2.3.4' }), false, 'probe จาก central');
});

test('alert rules + report schedules', async () => {
  assert.equal(await allowed('POST', '/api/alert-rules', { name: 'a', camera_ids: ['PK1'] }), true);
  assert.equal(await allowed('POST', '/api/alert-rules', { name: 'a', camera_ids: [] }), false, 'ว่าง = ทุกกล้อง');
  assert.equal(await allowed('POST', '/api/alert-rules', { name: 'a' }), false);
  assert.equal(await allowed('POST', '/api/alert-rules', { name: 'a', camera_ids: ['PK1', 'HD1'] }), false);
  assert.equal(await allowed('PUT', '/api/alert-rules/1', { name: 'b' }), true);
  assert.equal(await allowed('PUT', '/api/alert-rules/1', { camera_ids: ['HD1'] }), false);
  assert.equal(await allowed('PUT', '/api/alert-rules/2', { name: 'b' }), false);
  assert.equal(await allowed('PUT', '/api/alert-rules/3', { name: 'b' }), false, 'กฎทุกกล้อง');
  assert.equal(await allowed('DELETE', '/api/alert-rules/4'), false, 'ช่องทางประจำระบบ');
  assert.equal(await allowed('DELETE', '/api/alert-rules/1'), true);
  assert.equal(await allowed('POST', '/api/report-schedules', { site_id: 1 }), true);
  assert.equal(await allowed('POST', '/api/report-schedules', {}), false, 'ไม่ระบุไซต์ = ทุกไซต์');
  assert.equal(await allowed('PUT', '/api/report-schedules/1', { site_id: 2 }), false);
  assert.equal(await allowed('PUT', '/api/report-schedules/1', { send_time: '07:00' }), true);
  assert.equal(await allowed('POST', '/api/report-schedules/2/run'), false);
  assert.equal(await allowed('DELETE', '/api/report-schedules/3'), false);
  assert.equal(await allowed('POST', '/api/report-schedules/1/run'), true);
});
