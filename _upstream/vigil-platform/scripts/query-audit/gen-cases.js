// ============================================================
// Vigil Platform — Query audit: gen-cases (ชุดกรณีทุกหน้า × ทุกไซต์ — ไซต์/กล้องอ่านจาก DB)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ชุดกรณีจากรายการของ subagent · เรียงตามความสำคัญ (route ที่ช้าบ่อยใน [slow-req] ก่อน) · ไม่มี endpoint ที่มี side effect ภายนอก
const P = require('path').join(__dirname, '..', '..', 'src') + '/';
const env = require(P + 'config'); const { Pool } = require(P + 'node_modules/pg');
(async () => {
const pool = new Pool({ ...env.db(), max: 1, options: '-c pg_stat_statements.track=none' });
const { rows: srows } = await pool.query(`SELECT s.id, s.code, array_agg(c.id ORDER BY c.id) AS cameras FROM sites s JOIN cameras c ON c.site_id = s.id GROUP BY s.id, s.code ORDER BY s.code`);
await pool.end();
const sites = Object.fromEntries(srows.map((r) => [r.code, r.cameras]));
const SITE_ID = Object.fromEntries(srows.map((r) => [r.code, r.id]));
const now = new Date(), iso = (d) => new Date(d).toISOString();
const ago = (days) => iso(now - days * 864e5);
const bkkMidnight = (() => { const b = new Date(now.getTime() + 7 * 36e5); b.setUTCHours(0, 0, 0, 0); return iso(b.getTime() - 7 * 36e5); })();
const MONTH = (() => { const b = new Date(now.getTime() + 7 * 36e5); b.setUTCDate(1); b.setUTCHours(0, 0, 0, 0); return iso(b.getTime() - 7 * 36e5); })(), NOW = iso(now);
const EX = 'anprAlarm,FaceRecognition,FaceCapture,FaceDetector/Recognized,FaceDetector/Comparison';
const scopes = [['all', {}], ...Object.entries(sites).map(([k, v]) => [k, { cameras: v.join(',') }])];
const siteIds = [['all', {}], ...Object.entries(SITE_ID).map(([k, v]) => [k, { site_id: String(v) }])];
const cases = [];
const add = (id, path, query = {}) => cases.push({ id, path, query });
const each = (base, path, q, sc = scopes) => { for (const [s, sq] of sc) add(`${base}|${s}`, path, { ...q, ...sq }); };
// --- Tier 1: route ที่ผู้ใช้รอนานที่สุด ---
for (const p of ['today', 'week', 'month']) { each(`lpr-stats-${p}-kpi`, '/api/lpr/stats', { period: p, part: 'kpi' }); each(`lpr-stats-${p}-full`, '/api/lpr/stats', { period: p }); }
each('lpr-stats-custom-month-noplates', '/api/lpr/stats', { period: 'custom', from: MONTH, to: NOW, noplates: '1' });
each('lpr-stats-custom-month-plates', '/api/lpr/stats', { period: 'custom', from: MONTH, to: NOW, part: 'plates' });
for (const [r, from] of [['today', bkkMidnight], ['7d', ago(7)], ['30d', ago(30)]]) each(`appearances-stats-${r}`, '/api/appearances/stats', { from, to: NOW }, siteIds);
each('lpr-latest8', '/api/lpr', { limit: '8', offset: '0' });
each('lpr-search-month', '/api/lpr', { limit: '50', from: MONTH, to: NOW });
each('lpr-search-month-count', '/api/lpr', { limit: '50', from: MONTH, to: NOW, count: 'only' });
each('lpr-search-nofrom-count', '/api/lpr', { limit: '50', count: 'only' });
each('events-open', '/api/events', { limit: '20', offset: '0', exclude_types: EX });
each('events-month', '/api/events', { limit: '20', offset: '0', exclude_types: EX, from: MONTH, to: NOW });
each('snapshots-open', '/api/events', { hasSnapshot: 'true', limit: '20', offset: '0', group: 'burst', exclude_types: EX });
each('snapshots-month', '/api/events', { hasSnapshot: 'true', limit: '20', offset: '0', group: 'burst', exclude_types: EX, from: MONTH, to: NOW });
each('media-open', '/api/events', { hasClip: 'true', limit: '20', offset: '0' });
each('lpr-alerts-strip', '/api/lpr/alerts', { limit: '8' });
each('lpr-alerts-tab', '/api/lpr/alerts', { limit: '15', offset: '0' });
each('lpr-alerts-month', '/api/lpr/alerts', { limit: '15', offset: '0', from: ago(30), to: NOW });
add('lpr-alerts-count', '/api/lpr/alerts/count');
add('lpr-watchlist', '/api/lpr/watchlist'); add('lpr-watchlist-groups', '/api/lpr/watchlist/groups');
each('faces-overview', '/api/faces', { limit: '12', include_recog: '1', group: 'burst_spatial' });
each('faces-live', '/api/faces', { limit: '60', include_recog: '1' });
each('faces-search-month', '/api/faces', { limit: '24', offset: '0', include_recog: '1', with_total: '0', from: MONTH, to: NOW });
each('faces-search-month-count', '/api/faces', { include_recog: '1', from: MONTH, to: NOW, count: 'only' });
add('stats-today-counts', '/api/stats/today-counts');
add('stats-executive-summary', '/api/stats/executive-summary');
// --- Tier 2: หน้าอื่นตอนเปิด / ตัวกรองกว้างสุด ---
each('faces-counts', '/api/faces/counts', {});
for (const p of ['today', 'month']) each(`faces-stats-${p}`, '/api/faces/stats', { period: p });
each('face-matches-strip', '/api/face-matches', { list_type: 'blackList', limit: '8', with_total: '0' });
each('face-matches-tab', '/api/face-matches', { list_type: 'blackList', limit: '10', offset: '0' });
for (const [r, from] of [['today', bkkMidnight], ['30d', ago(30)]]) each(`appearances-search-${r}`, '/api/appearances/search', { from, to: NOW, limit: '20', offset: '0' });
for (const [r, from] of [['today', bkkMidnight], ['week', ago(7)], ['60d', ago(60)]]) {
  each(`stats-categories-${r}`, '/api/stats/categories', { from, to: NOW }, siteIds);
  each(`stats-timeline-${r}`, '/api/stats/timeline-by-category', { from, to: NOW, trunc: r === 'today' ? 'hour' : 'day' }, siteIds);
  each(`stats-vehicle-cards-${r}`, '/api/stats/vehicle-cards', { from, to: NOW, step: r === 'today' ? '3600' : '86400' }, siteIds);
  each(`stats-dwell-${r}`, '/api/stats/dwell', { from, to: NOW }, [['all', {}]]);
}
add('stats-timeline-today-5min', '/api/stats/timeline-by-category', { from: bkkMidnight, to: NOW, trunc: 'minute5' });
each('stats-pattern-heatmap-28', '/api/stats/pattern-heatmap', { days: '28' }, siteIds);
each('lpr-alerts-stats-window', '/api/lpr/alerts', { limit: '200', from: ago(7), to: NOW }, scopes);
for (const d of ['28', '90']) add(`traffic-enforcement-${d}`, '/api/traffic/enforcement', { days: d });
add('traffic-helmet-series', '/api/traffic/helmet-series', {});
for (const p of ['day', 'd7', 'month']) add(`traffic-helmet-top-${p}`, '/api/traffic/helmet-top', { period: p });
for (const p of ['today', 'month']) { add(`report-lpr-${p}`, '/api/stats/lpr/report', { period: p }); add(`report-face-${p}`, '/api/stats/face/report', { period: p }); }
for (const [r, from] of [['day', ago(1)], ['month', MONTH]]) {
  add(`report-breakdown-${r}`, '/api/stats/breakdown-v2', { from, to: NOW }); add(`report-heatmap-${r}`, '/api/stats/heatmap', { from, to: NOW });
  add(`report-event-coverage-${r}`, '/api/stats/event-coverage', { from, to: NOW }); add(`report-evidence-${r}`, '/api/stats/evidence', { from, to: NOW });
}
add('report-quiet-cameras', '/api/stats/quiet-cameras', { since_hours: '168' });
add('lpr-brands', '/api/lpr/brands'); add('lpr-gs-meta', '/api/lpr/gs-alarms/meta'); add('lpr-gs-alarms', '/api/lpr/gs-alarms', { limit: '15', offset: '0' });
each('lpr-noread', '/api/lpr/no-read', { limit: '30', offset: '0' });
add('lpr-plate-history-sample', '/api/lpr/plate-history', { plate: 'กข1234', hours: '168', limit: '50' });
add('map-heatmap-24h', '/api/heatmap', { hours: '24' });
add('events-facets', '/api/events/facets'); add('categories', '/api/categories'); add('cameras', '/api/cameras'); add('cameras-quiet', '/api/cameras/quiet');
add('cameras-status-current', '/api/cameras/status-current'); add('alert-logs', '/api/alert-logs'); add('alert-logs-stats-30d', '/api/alert-logs/stats', { window: '30d' });
add('report-history-stats-all', '/api/report-history/stats', { window: 'all' }); add('report-history', '/api/report-history', { limit: '50', offset: '0' });
add('health-details', '/api/health/details'); add('health-devices', '/api/health/devices'); add('health-relay', '/api/health/relay');
add('metrics-device', '/api/metrics/device'); add('storage', '/api/storage');
for (const t of ['lpr', 'face']) { add(`blacklist-master-${t}`, '/api/blacklist/master', { data_type: t, page: '1', limit: '50' }); add(`blacklist-stats-${t}`, '/api/blacklist/stats', { data_type: t }); }
add('blacklist-duplicates', '/api/blacklist/duplicates', { data_type: 'lpr', page: '1' }); add('blacklist-removed', '/api/blacklist/removed', { page: '1', limit: '50', data_type: 'lpr' });
add('face-blacklist-hits', '/api/face-blacklist/hits', { limit: '100' }); add('files', '/api/files'); add('integrations', '/api/integrations');
add('sites', '/api/sites'); add('groups', '/api/groups'); add('settings', '/api/settings'); add('views', '/api/views');
const out = process.argv[2] || 'cases.json';
require('fs').writeFileSync(out, JSON.stringify(cases, null, 1));
console.log('cases', cases.length, '→', out);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
