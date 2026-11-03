// ============================================================
// Vigil Platform — View Registry (per-user view authorization)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แหล่งความจริงเดียวของ "หน้า/แท็บ" ที่จำกัดสิทธิ์ต่อ user ได้ (decision #250)
// ใช้ 3 ที่:
//   1. server allowlist (P4) — `routesFor()` แปลง view ที่ user ได้รับ → route ที่ยิงได้
//   2. admin UI (P8)         — checkbox tree ของหน้า/แท็บ + dropdown หน้าแรก
//   3. client guard (P7)     — ดึงผ่าน `GET /api/views` (ไม่ส่ง `routes`/`entries` ออกไป)
//
// ── กฎที่ห้ามลืม ────────────────────────────────────────────
// • `enforceable: true` = แท็บนี้กินข้อมูลจาก endpoint ที่ไม่มีแท็บอื่นในหน้าเดียวกันใช้
//   → ตัดสิทธิ์ที่ server ได้จริง
//   `enforceable: false` = แท็บใช้ endpoint ร่วมกับแท็บอื่น → **ซ่อนได้แค่หน้าจอ**
//   ห้ามเดาค่านี้เอง — `test/view-registry.test.js` คำนวณจาก endpoint ที่แท็บเรียกจริง
//   แล้ว assert ว่าตรงกับที่ประกาศไว้ (ค่าที่ประกาศผิด = เทสต์แดง)
// • `entries` = ชื่อฟังก์ชันฝั่ง dashboard ที่ทำงานตอนเปิดหน้า/แท็บนั้น — เทสต์ใช้เดินกราฟ
//   เรียกฟังก์ชันเพื่อหา endpoint จริง ห้ามลบทิ้งเพราะ "ดูเหมือนไม่ได้ใช้"
// • `routes` เทียบแบบ **ตรงทีละ segment เท่านั้น** ผ่าน `matches()` — ไม่ใช่ prefix
//   (`:p` = 1 segment ใดก็ได้) `/api/cameras` จึงไม่แจก `/api/cameras/status-log` ให้ใคร
//   P4 เป็น default-deny → pattern ที่พิมพ์ผิดจะกลายเป็น 403 เงียบๆ บนฟีเจอร์ที่ควรใช้ได้
//   เทสต์จึงเทียบทุก route กับ route ที่ express ลงทะเบียนไว้จริงด้วย

'use strict';

// route ที่ทุกคน "ที่ล็อกอินแล้ว" ต้องยิงได้เสมอ ไม่งั้นแม้แต่หน้าที่ตัวเองมีสิทธิ์ก็ใช้ไม่ได้
// (ทั้งหมดถูกกรองด้วย site-RBAC / user_cameras อยู่แล้ว จึงไม่ได้เปิดข้อมูลข้าม Site)
const CORE_ROUTES = [
  '/api/views',                  // ตัว registry เอง — ถ้าไม่อยู่ใน CORE user ที่ถูกจำกัดจะไม่มีเมนูเลย
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/change-password',
  '/api/branding',
  '/api/eula',
  '/api/eula/status',
  '/api/eula/accept',
  '/api/sites',                  // scope bar ทุกหน้า (กรองตาม allowedSites แล้ว)
  '/api/cameras',                // camera picker แทบทุกหน้า (กรองตาม site + user_cameras)
  '/api/groups',                 // แถบกลุ่มกล้อง (`renderGroupBars`) วาดใหม่ทุกครั้งที่เปลี่ยนหน้า
                                 // — ไม่อยู่ใน CORE = ทุกหน้าของ user ที่ถูกจำกัดจะโดน 403
                                 // (การเขียนยังกันด้วย requireAdminForWrites เหมือนเดิม)
  '/api/license/status',         // แถบเตือนไลเซนส์บน header
  '/api/settings',               // bootstrap อ่าน `nav_hidden_pages` ก่อนวาดเมนู ทุก session
                                 // — ผู้ที่ไม่ใช่ admin ได้แค่ 6 key ที่เป็น display preference
                                 // (GOTCHAS #164 · `PUBLIC_SETTING_KEYS` ใน routes/settings.js)
];

// showPage() แปลงชื่อเก่าเป็นชื่อใหม่ก่อนใช้ — client guard ต้อง resolve ก่อนเช็คสิทธิ์
const PAGE_ALIASES = { alerts: 'history' };

// หมายเหตุ: `#page-faces` มีอยู่ใน index.html แต่ไม่มี nav item และไม่มี showPage('faces')
// ที่ไหนเลย (dashboard.js:1117-1119 เขียนไว้ชัด) → ไม่ลงทะเบียน = เข้าไม่ได้อยู่แล้ว

const VIEWS = [
  {
    key: 'summary', label: 'สรุปภาพรวม', i18n: 'nav.summary',
    entries: ['loadSummary'],
    // `/api/stats/kpi` ไม่มีหน้าไหนบนแดชบอร์ดเรียก — ผู้ใช้จริงคือแอปมือถือ (vigil-mobile)
    // ก่อนหน้านี้ไม่ได้อยู่ใน view ไหนเลย ⇒ บัญชี viewer ที่ถูกจำกัดยิงแล้วได้ 403 เงียบ ๆ
    // ผูกไว้กับ "สรุปภาพรวม" และ "สถิติ" เพราะเป็นตัวเลข KPI ชุดเดียวกับสองหน้านั้น
    routes: ['/api/stats/executive-summary', '/api/stats/kpi'],
  },
  {
    key: 'stats', label: 'สถิติ', i18n: 'nav.stats',
    entries: ['loadStats'],
    // (stats redesign 2026-08) ชุด endpoint ของหน้าใหม่ — occupancy/insights ชุดเดิมถูกถอด
    routes: [
      '/api/settings',
      '/api/stats/categories', '/api/stats/timeline-by-category',
      '/api/stats/vehicle-cards', '/api/stats/pattern-heatmap', '/api/stats/dwell',
      '/api/stats/vehicle-classes', '/api/stats/kpi',
      '/api/traffic/enforcement', '/api/traffic/helmet-series',
      '/api/lpr/alerts',
    ],
  },
  {
    key: 'reports', label: 'รายงาน', i18n: 'nav.reports',
    entries: ['initReportsRedesign', 'onReportTypeChange', 'initReportCategoryFilter'],
    routes: [
      '/api/categories', '/api/line-config',
      '/api/appearances/stats', '/api/blacklist/photo/:p/:p',
      '/api/health/report/pdf', '/api/health/report/preview', '/api/health/report/send-now',
      '/api/report-history', '/api/report-history/:p/image', '/api/report-history/stats',
      '/api/report-schedules', '/api/report-schedules/:p', '/api/report-schedules/:p/run',
      '/api/reports/pdf', '/api/reports/image', '/api/reports/daily', '/api/reports/weekly',
      '/api/reports/face/image', '/api/reports/face/pdf',
      '/api/reports/lpr/image', '/api/reports/lpr/pdf',
      '/api/stats/breakdown-v2', '/api/stats/categories', '/api/stats/event-coverage',
      '/api/stats/evidence', '/api/stats/face/report', '/api/stats/heatmap',
      '/api/stats/lpr/report', '/api/stats/per-camera-counts', '/api/stats/quiet-cameras',
      '/api/stats/timeline-by-category', '/api/stats/top-rules',
      '/snapshots/**',
    ],
  },
  {
    key: 'cameras', label: 'สถานะกล้อง', i18n: 'nav.cameras',
    entries: ['loadCameras', 'refreshTodayCounts'],
    routes: [
      '/api/cameras/reorder', '/api/events', '/api/lpr/stats', '/api/stats/today-counts',
      '/api/snapshot/live/:p',
      '/api/license/activate', '/api/license/deactivate',
    ],
  },
  {
    key: 'events', label: 'เหตุการณ์ (Live)', i18n: 'nav.events',
    entries: ['populateEventFilters', 'loadEvents', 'syncEventsSpecializedBox'],
    routes: ['/api/categories', '/api/events', '/api/events/facets', '/snapshots/**'],
  },
  {
    key: 'snapshots', label: 'Snapshot', i18n: 'nav.snapshots',
    entries: ['populateSnapFilters', 'loadSnapshots'],
    routes: [
      '/api/categories', '/api/events', '/api/events/:p/appearance', '/api/events/:p/dwell',
      '/api/events/facets',
      // ⚠️ `/snapshots/*` และ `/media/*` ไม่ได้ขึ้นต้นด้วย `/api` → **ไม่ผ่าน middleware ของ `/api`**
      // (GOTCHAS #163) ประกาศไว้ที่นี่เพื่อให้ P4 เอาไปเช็คในตัว handler ทั้งสองเอง
      // ตอนนี้ทั้งคู่ยังกันด้วย site-RBAC อย่างเดียว (decision #248) ไม่ได้กันตาม view
      '/snapshots/**', '/media/:p',
    ],
  },
  {
    key: 'media', label: 'Media', i18n: 'nav.media',
    entries: ['populateMediaFilters', 'loadMedia'],
    routes: ['/api/events', '/api/events/facets', '/api/categories', '/media/:p'],
  },
  {
    // key เดิมไว้ตามเดิม — ถูกเก็บใน users.allowed_views และเป็น id ของ DOM ด้วย
    // เปลี่ยนแค่ชื่อที่ผู้ใช้เห็น (2026-08-12 เพิ่มแท็บค้นหาอัจฉริยะเป็นแท็บแรก)
    key: 'hcp-face-search', label: 'ค้นหาอัจฉริยะ', i18n: 'nav.hcpFaceSearch',
    entries: ['ssxInit'],
    tabs: [
      // แท็บนี้มี endpoint ของตัวเองครบ ไม่ปนกับแท็บใบหน้า → กันได้จริงที่ server
      { key: 'smart', label: 'ค้นหาอัจฉริยะ', i18n: 'ssx.tabSmart', entry: 'ssxInit', enforceable: true,
        routes: ['/api/acuseek/vocab', '/api/acuseek/cameras', '/api/acuseek/search',
                 '/api/acuseek/status', '/api/acuseek/picture', '/api/acuseek/queries'] },
      { key: 'face', label: 'ค้นใบหน้าด้วยรูป', i18n: 'ssx.tabFace', entry: 'hfsInit', enforceable: true,
        routes: ['/api/hcp/cameras', '/api/hcp/engine-stats', '/api/hcp/face-search',
                 '/api/hcp/nearby', '/api/hcp/picture', '/api/events/:p/appearance', '/snapshots/**'] },
    ],
  },
  {
    key: 'face-matches', label: 'Face Recognition', i18n: 'nav.faceMatches',
    entries: ['_loadFaceCounts', '_switchFaceTab'],
    // ทุกแท็บใช้ /api/faces + /api/face-matches ร่วมกัน → กันได้แค่หน้าจอทั้งชุด
    routes: [
      '/api/faces', '/api/faces/counts', '/api/faces/stats', '/api/faces/summary',
      '/api/face-matches', '/api/face-matches/:p/ack', '/api/face-matches/:p/note',
      // ส่งการแจ้งเตือนซ้ำด้วยตนเอง — ปุ่มในโมดัลรายละเอียดการจับคู่ใบหน้า
      '/api/face-matches/:p/notify-telegram',
      '/api/events/:p/appearance', '/api/blacklist/photo/:p/:p',
      '/snapshots/**',
    ],
    tabs: [
      { key: 'overview', label: 'ภาพรวม',        i18n: 'face.tabOverview', entry: 'faceLoadOverview', enforceable: false, routes: [] },
      { key: 'live',     label: 'สด', i18n: 'face.tabLive',            entry: '_loadFaceLive',    enforceable: false, routes: [] },
      { key: 'recog',    label: 'จดจำใบหน้า', i18n: 'face.tabRecog',    entry: 'loadFaceMatches',  enforceable: false, routes: [] },
      { key: 'search',   label: 'ใบหน้าทั้งหมด', i18n: 'face.tabSearch', entry: '_loadFaceTab',     enforceable: false, routes: [] },
      { key: 'lab', i18n: 'face.tabLab',      label: 'AuraFace',      entry: 'afbInit',          enforceable: false,
        routes: [
          '/api/settings',
          '/api/face-blacklist', '/api/face-blacklist/groups', '/api/face-blacklist/groups/:p',
          '/api/face-blacklist/hits', '/api/face-blacklist/hits/:p',
          '/api/face-blacklist/roster', '/api/face-blacklist/roster/:p',
          '/api/face-blacklist/roster/:p/active', '/api/face-blacklist/roster/upload',
          // สะพานโยงกฎฝั่งใบหน้า — ตกหล่นแบบเดียวกับฝั่งป้ายทะเบียน (a588697)
          // ผู้ใช้ที่ได้สิทธิ์หน้านี้โดน 403 ทั้ง 6 endpoint (วัดจริง 2026-08-21)
          '/api/face-blacklist/bridge/rules', '/api/face-blacklist/bridge/rules/:p',
          '/api/face-blacklist/bridge/preview', '/api/face-blacklist/bridge/sync',
        ] },
    ],
  },
  {
    key: 'hcp-events', label: 'เหตุการณ์จาก HCP', i18n: 'nav.hcpEvents',
    entries: ['heInit'],
    routes: ['/api/hcp/events', '/api/hcp/picture'],
  },
  {
    key: 'appearance', label: 'ค้นหาบุคคล', i18n: 'nav.appearance',
    entries: ['_initAppCamDropdown', 'setAppRange'],
    // 2 แท็บ (ภาพรวม/ค้นหา) เป็นแค่ show-hide ไม่มี endpoint ของตัวเอง → ไม่ลงทะเบียนเป็นแท็บ
    routes: [
      '/api/appearances/search', '/api/appearances/similar-timeline',
      '/api/appearances/stats', '/api/appearances/timeline', '/api/events', '/snapshots/**',
    ],
  },
  {
    key: 'lpr', label: 'ป้ายทะเบียน', i18n: 'nav.lpr',
    entries: ['_lprInitPage'],
    // 5 แท็บใช้ /api/lpr* ร่วมกันหมด → แท็บทั้งชุดกันได้แค่หน้าจอ
    routes: [
      '/api/settings', '/api/line-config', '/api/blacklist/master/:p',
      '/api/lpr', '/api/lpr/alerts', '/api/lpr/alerts/:p/ack', '/api/lpr/alerts/count',
      // ส่งการแจ้งเตือนซ้ำด้วยตนเอง — ปุ่มในหน้า LPR และคำสั่ง "ส่งให้ตำรวจ" ใน LINE
      // ใช้เส้นทางเดียวกัน (ทดสอบด้วยบัญชี admin จึงไม่เห็นว่าขาด — viewer จะโดน 403)
      '/api/lpr/alerts/:p/notify', '/api/lpr/alerts/:p/notify-telegram',
      // Events Alarm (GuruSquare) — G3, แยกแท็บจาก alerts เพราะเกณฑ์จับคู่คนละแบบ
      '/api/lpr/gs-alarms', '/api/lpr/gs-alarms/meta', '/api/lpr/gs-alarms/:p/photo/:p',
      '/api/lpr/gs-alarms/:p/notify', '/api/lpr/gs-alarms/:p/notify-telegram',
      '/api/lpr/brands', '/api/lpr/mismatch/:p/dismiss', '/api/lpr/no-read',
      // Reject รายป้ายของ demo รถบรรทุกช่วงห้าม — อ่านได้ทุกคนที่เห็นหน้า LPR · เขียนเฉพาะ admin/site_admin (เช็คใน route)
      '/api/lpr/truck-ban/rejections', '/api/lpr/truck-ban/rejections/:p', '/api/lpr/truck-ban/daily', '/api/lpr/truck-ban/buckets',
      // อันดับ/KPI · ภาพรายป้าย · PDF ของ demo เดียวกัน (2026-11-02) — อ่านอย่างเดียว
      '/api/lpr/truck-ban/ranking', '/api/lpr/truck-ban/plate/:p',
      '/api/lpr/truck-ban/report.pdf', '/api/lpr/truck-ban/report-table.pdf',
      '/api/lpr/plate-history', '/api/lpr/stats', '/api/lpr/vehicle-types',
      '/api/lpr/watchlist', '/api/lpr/watchlist/:p', '/api/lpr/watchlist/bulk-delete',
      // ปิด/เปิดเสียงรายป้ายชั่วคราว — คำสั่งใน LINE เรียกในนามบัญชีที่ผูกไว้
      // ถ้าไม่ประกาศ บัญชี viewer ที่ได้สิทธิ์หน้า LPR จะโดน 403 ใส่ตัวเอง
      '/api/lpr/watchlist/:p/mute',
      '/api/lpr/watchlist/groups', '/api/lpr/watchlist/groups/:p', '/api/lpr/watchlist/image',
      '/snapshots/**',
    ],
    tabs: [
      { key: 'overview',  label: 'ภาพรวม',          i18n: 'lpr.tabOverview', entry: 'lprLoadOverview',   enforceable: false, routes: [] },
      { key: 'search',    label: 'ค้นหา', i18n: 'lpr.tabSearch',           entry: 'loadLpr',           enforceable: false, routes: [] },
      { key: 'alerts',    label: 'การแจ้งเตือน', i18n: 'lpr.tabAlerts',    entry: 'loadLprAlerts',     enforceable: false, routes: [] },
      { key: 'gsalarm',   label: 'Events Alarm', i18n: 'lpr.tabGsAlarm',  entry: 'loadLprGsAlarms',   enforceable: false, routes: [] },
      { key: 'watchlist', label: 'เฝ้าระวัง', i18n: 'lpr.tabWatchlist',       entry: '_renderWatchlistRO', enforceable: false, routes: [] },
      { key: 'noread',    label: 'ไม่ทราบทะเบียน', i18n: 'lpr.tabNoRead',  entry: 'loadLprNoRead',     enforceable: false, routes: [] },
    ],
  },
  {
    key: 'traffic', label: 'กวดขันวินัยจราจร', i18n: 'nav.traffic',
    entries: ['loadTraffic'],
    routes: ['/api/traffic/enforcement'],
    tabs: [
      { key: 'volume',    label: 'ปริมาณรถ', i18n: 'trf.tabVolume',        entry: 'trfRenderVolume',    enforceable: false, routes: [] },
      { key: 'violation', label: 'วินัยจราจร', i18n: 'trf.tabViolation',      entry: 'trfRenderViolation', enforceable: false, routes: [] },
      { key: 'effect',    label: 'ก่อน-หลังกวดขัน', i18n: 'trf.tabEffect', entry: 'trfRenderEffect',    enforceable: false, routes: [] },
      { key: 'deploy',    label: 'จุดที่ควรตั้งด่าน', i18n: 'trf.tabDeploy', entry: 'trfRenderDeploy',  enforceable: false, routes: [] },
      // แท็บเดียวในหน้านี้ที่มี endpoint ของตัวเอง → กันที่ server ได้จริง (เคสสมชายในสเปก)
      { key: 'helmet',    label: 'สถิติหมวกนิรภัย', i18n: 'trf.tabHelmet', entry: 'trfRenderHelmet',    enforceable: true,
        routes: ['/api/traffic/helmet-series', '/api/traffic/export-page.pdf'] },
      // อันดับป้ายที่ไม่สวมหมวก — มี endpoint ของตัวเองเช่นกัน จึงกันที่ server ได้จริง
      // (ข้อมูลระดับป้ายทะเบียนรายคัน อ่อนไหวกว่ายอดรวม → ต้องกันจริง ไม่ใช่ซ่อนแท็บเฉย ๆ)
      { key: 'topHelmet', i18n: 'trf.tabTopHelmet', label: 'อันดับไม่สวมหมวกนิรภัย', entry: 'trfRenderTopHelmet', enforceable: true,
        // '/**' ด้วย เพราะ matcher เทียบจำนวน segment แบบตรงตัว — ถ้ามีแค่ path เปล่า
        // ปุ่มออกรายงาน (helmet-top/report.pdf, /report-table.pdf) และหน้าต่าง
        // รายละเอียดป้าย (/plate) จะโดน 403 ทั้งที่ผู้ใช้ได้สิทธิ์แท็บนี้แล้ว
        // '/snapshots/**' จำเป็นเพราะหน้าต่างรายละเอียดแสดงภาพหลักฐาน — ถ้าไม่ให้
        // จะเปิดหน้าต่างได้แต่ภาพขึ้นว่า "ถูกลบแล้ว" ทั้งที่ไฟล์อยู่ครบ (เจอจริง 2026-08-16)
        // ไม่ได้เปิดกว้าง: api-server ยังเช็ค Site/กล้องของผู้ใช้กับภาพทุกใบอยู่แล้ว
        // (mediaScope.snapshotInScope) เหมือนที่หน้า lpr/faces ทำมาก่อน
        routes: ['/api/traffic/helmet-top', '/api/traffic/helmet-top/**', '/api/traffic/export-page.pdf', '/snapshots/**'] },
      { key: 'report', i18n: 'trf.tabReport',    label: 'รายงาน',          entry: 'trfRenderReport',    enforceable: false, routes: [] },
      { key: 'settings',  label: 'ตั้งค่า', i18n: 'trf.tabSettings',         entry: 'trfRenderSettings',  enforceable: false, routes: [] },
    ],
  },
  {
    key: 'blacklist-face', label: 'ฐานข้อมูล — ใบหน้า', i18n: 'nav.blacklist',
    entries: ['_blInitPage'],
    routes: [
      '/api/blacklist/master', '/api/blacklist/master/:p', '/api/blacklist/master/:p/reveal-id',
      '/api/blacklist/photo/:p/:p', '/api/blacklist/quality', '/api/blacklist/record/:p',
      '/api/blacklist/record/:p/override', '/api/blacklist/removed', '/api/blacklist/settings',
      '/api/blacklist/sources', '/api/blacklist/stats',
      '/api/blacklist/manual/face', '/api/blacklist/manual/lpr', '/api/lpr/watchlist/groups',
      // สะพานโยงกฎ (BS3) — ตกหล่นตอนเพิ่มฟีเจอร์ ทำให้ผู้ใช้ที่ได้สิทธิ์เฉพาะหน้านี้
      // โดน 403 ตั้งแต่เปิดหน้า เพราะ _blBridgePendingCheck() ยิง GET /rules ทันที
      // ใส่ครบทั้ง 6 endpoint ไม่ใช่เฉพาะตัวที่เทสต์จับได้ — ปุ่มแก้/ลบ/preview/sync
      // ใช้ path ที่มี ${id} ต่อท้าย ซึ่งตัวไล่กราฟมองไม่เห็น แต่ 403 จริงเหมือนกัน
      '/api/blacklist/bridge/rules', '/api/blacklist/bridge/rules/:p',
      '/api/blacklist/bridge/preview', '/api/blacklist/bridge/sync',
    ],
  },
  { key: 'blacklist-lpr',  label: 'ฐานข้อมูล — ป้ายทะเบียน', parent: 'blacklist-face',
    entries: [], routes: ['/api/blacklist/master', '/api/blacklist/master/:p', '/api/lpr/watchlist/groups'] },
  { key: 'blacklist-dups', label: 'ฐานข้อมูล — รายการซ้ำ', parent: 'blacklist-face',
    entries: [], routes: ['/api/blacklist/duplicates', '/api/blacklist/duplicates/remove'] },
  { key: 'blacklist-bin',  label: 'ฐานข้อมูล — ถังขยะ', parent: 'blacklist-face',
    entries: [], routes: ['/api/blacklist/removed', '/api/blacklist/record/:p'] },
  {
    key: 'map', label: 'แผนที่', i18n: 'nav.map',
    entries: ['refreshMap', 'renderMapSiteFilter'],
    routes: [
      '/api/config', '/api/events', '/api/heatmap', '/api/lpr',
      // occupancy สด (WS occupancy_update) ย้ายสังกัดจากหน้า stats มาที่จอสดตัวจริง
      // ตามแผน BI 2026-08 — Live Pulse บนแผนที่คือผู้ใช้ข้อมูลชุดนี้รายถัดไปของข้อมูลชุดนี้
      '/api/stats/occupancy',
      '/api/map/tiles/mapbox/:p/:p/:p/:p',   // :style/:z/:x/:y.png
      '/snapshots/**',
    ],
  },
  {
    key: 'history', label: 'ประวัติและบันทึก', i18n: 'nav.history',
    entries: ['historyNav'],
    // 5 ราง ต่างคนต่าง endpoint → กันที่ server ได้จริงทุกราง (audit log ก็ตัดออกได้จริง)
    routes: ['/api/categories'],
    tabs: [
      { key: 'alerts',        label: 'ประวัติแจ้งเตือน', i18n: 'hist.tabAlerts', entry: 'loadAlertLogs', enforceable: true,
        routes: ['/api/alert-logs', '/api/alert-logs/stats'] },
      { key: 'reports',       label: 'ประวัติรายงาน', i18n: 'hist.tabReports',   entry: 'loadReportHistory', enforceable: true,
        routes: ['/api/report-history', '/api/report-history/:p/image', '/api/report-history/stats'] },
      { key: 'camera-status', label: 'สถานะกล้องย้อนหลัง', i18n: 'hist.tabCameraStatus', entry: 'setCameraStatusTab', enforceable: true,
        routes: ['/api/cameras/status-current', '/api/cameras/status-log', '/api/cameras/image-quality-log'] },
      { key: 'audit',         label: 'Audit Log', i18n: 'hist.tabAudit',       entry: 'loadAuditLog', enforceable: true,
        routes: ['/api/audit-log'] },
      { key: 'sessions', i18n: 'hist.tabSessions',      label: 'Sessions',        entry: 'loadSessions', enforceable: true,
        routes: ['/api/auth/sessions', '/api/auth/sessions/:p/revoke'] },
    ],
  },
  {
    key: 'health', label: 'Health Check', i18n: 'nav.health', adminOnly: true,
    entries: ['loadHealth'],
    routes: ['/api/health/details', '/api/services/:p/:p', '/api/edge/:p/services/:p/:p',
             '/api/cameras/:p/reboot', '/api/cameras/test-connection',
             '/api/devices/nvr/:p/reboot', '/api/lpr/spool/clear',
             '/api/blacklist/sources/test-connection'],
    tabs: [
      { key: 'overview', label: 'ภาพรวม',        i18n: 'hlth.tabOverview', entry: null, enforceable: false, routes: [] },
      { key: 'services', label: 'บริการ',        i18n: 'hlth.tabServices', entry: null, enforceable: false, routes: [] },
      { key: 'devices',  label: 'อุปกรณ์',       i18n: 'hlth.tabDevices',  entry: 'startDevRefresh',  enforceable: true,
        routes: ['/api/health/devices'] },
      { key: 'perf',     label: 'ประสิทธิภาพ',   i18n: 'hlth.tabPerf',     entry: 'startPerfRefresh', enforceable: true,
        routes: ['/api/metrics/device', '/api/metrics/host', '/api/metrics/sources'] },
      { key: 'storage',  label: 'จัดเก็บ',       i18n: 'hlth.tabStorage',  entry: null, enforceable: false, routes: [] },
      { key: 'server',   label: 'เซิร์ฟเวอร์',   i18n: 'hlth.tabServer',   entry: null, enforceable: false, routes: [] },
      { key: 'hcp',      label: 'อุปกรณ์จาก HCP', i18n: 'hlth.tabHcp',     entry: 'loadHcpDevices',  enforceable: true,
        routes: ['/api/hcp/devices'] },
      { key: 'relay',    label: 'Relay',          i18n: 'hlth.tabRelay',    entry: 'loadRelay',       enforceable: true,
        routes: ['/api/health/relay', '/api/health/relay/report.pdf'] },
    ],
  },
  {
    // หน้าตั้งค่าเป็น admin-only อยู่แล้ว (requireAdmin ทุก route) — ลงทะเบียนไว้ให้ checkbox tree
    // ครบ แต่ไม่แตกแท็บย่อย 15 ราง เพราะ user ที่ถูกจำกัดไม่ควรได้หน้านี้ตั้งแต่ต้น
    key: 'settings', label: 'การตั้งค่า', i18n: 'nav.settings', adminOnly: true,
    entries: ['settingsNav'],
    routes: [
      '/api/settings', '/api/settings/:p', '/api/sites/:p', '/api/sites/:p/provision-edge',
      // คำสั่งผ่าน LINE (แท็บใน Settings › LINE) — ทั้งหมด admin เท่านั้นที่ฝั่ง route อยู่แล้ว
      // แต่ต้องประกาศที่นี่ด้วย ไม่งั้นบัญชีที่ถูกจำกัดแล้วได้สิทธิ์หน้า settings จะโดน 403 ใส่ตัวเอง
      '/api/line/commands', '/api/line/commands/:p', '/api/line/commands/test',
      '/api/line/command-sources', '/api/line/command-log',
      '/api/line/operators', '/api/line/operators/:p', '/api/line/operator-scope/:p',
      '/api/line/operators/:p/telegram-allow-in',
      '/api/line/known-senders', '/api/line/command-actions',
      '/api/sites/:p/push-config', '/api/sites/:p/retention',
      '/api/branding/logo', '/api/categories', '/api/categories/:p', '/api/categories/:p/rules',
      '/api/categories/backup', '/api/categories/restore',
      '/api/category-rules/:p', '/api/events/facets',
      '/api/cameras/:p', '/api/cameras/:p/push-mqtt', '/api/camera-offline-alerts/:p', '/api/groups', '/api/groups/:p',
      '/api/users', '/api/users/:p', '/api/users/:p/reset-password', '/api/users/:p/sites',
      '/api/audit-log', '/api/auth/sessions', '/api/auth/sessions/:p/revoke',
      '/api/backups', '/api/backups/:p', '/api/backups/run',
      '/api/integrations', '/api/integrations/:p/endpoint-usage', '/api/integrations/:p/openapi',
      '/api/alert-rules', '/api/alert-rules/:p', '/api/alert-rules-suggestions',
      // แท็บ "ช่องทางแจ้งเตือน" ที่แยกออกมาจาก Rules ใน 39b5085 — endpoint ถูกเพิ่ม
      // แต่ allowlist ไม่ได้ตามไปด้วย ทำให้เทสต์ view-registry แดงค้างมาตั้งแต่วันนั้น
      '/api/alert-channels', '/api/alert-channels/:p', '/api/alert-channels/:p/test',
      '/api/line-config', '/api/line-config/qr', '/api/line-config/quota',
      '/api/line-config/quota-alert', '/api/line-config/test',
      '/api/line/blocked', '/api/line/blocked/:p/unblock', '/api/line/pending',
      '/api/line/pending/:p/approve', '/api/line/pending/:p/block', '/api/line/pending/:p/ignore',
      // Telegram สำรอง LINE (T1) — เหตุผลเดียวกับกลุ่ม LINE ด้านบน
      '/api/telegram-config', '/api/telegram-config/test', '/api/telegram-config/qr',
      '/api/telegram/pending', '/api/telegram/pending/:p/approve',
      '/api/telegram/pending/:p/ignore', '/api/telegram/pending/:p/block',
      '/api/lpr/camera-direction', '/api/lpr/gates', '/api/lpr/gates/:p', '/api/lpr/scene-image',
      '/api/lpr/vehicle-types',
      '/api/map/areas', '/api/map/areas/:p', '/api/map/cache', '/api/map/cancel',
      '/api/map/download', '/api/map/estimate', '/api/map/progress', '/api/settings/map',
      '/api/map/tiles/mapbox/:p/:p/:p/:p',
      '/api/config', '/api/license', '/api/license/activate', '/api/license/deactivate',
      '/api/blacklist/settings', '/api/blacklist/sources', '/api/blacklist/sources/:p',
      '/api/blacklist/stats',
    ],
  },
];

// ข้อความ WS แต่ละชนิดเป็นข้อมูลของหน้าไหน — เทียบเป็น "route ตัวแทน" แล้วยืมกลไก
// allowlist เดิมมาตัดสิน (ไม่ต้องดูแล mapping ชนิด→view แยกอีกชุด)
// ชนิดที่ไม่อยู่ในตารางนี้ = ไม่ส่งให้ผู้ใช้ที่ถูกจำกัด (fail closed) — ชนิดใหม่ที่ใครเพิ่ม
// วันหน้าจึงไม่หลุดเงียบๆ แต่ก็จะ "เงียบหาย" สำหรับผู้ใช้กลุ่มนั้น จึงมีเทสต์เทียบกับ
// ชนิดที่ `broadcast()` ส่งจริงใน src/ ให้เห็นตอนเพิ่มชนิดใหม่
const WS_TYPE_ROUTE = {
  new_event:        '/api/events',
  event_snapshot:   '/api/events',
  clip_done:        '/api/events',
  new_face:         '/api/faces',
  occupancy_update: '/api/stats/occupancy',
};

const _byKey = new Map();
for (const v of VIEWS) {
  _byKey.set(v.key, v);
  for (const t of v.tabs || []) _byKey.set(`${v.key}:${t.key}`, { ...t, key: `${v.key}:${t.key}`, page: v.key });
}

/**
 * เทียบ request path กับ pattern ใน registry — **ตรงทีละ segment ห้าม prefix**
 *
 * เหตุผลที่ห้าม `startsWith`: `/api/cameras` อยู่ใน CORE_ROUTES (ทุกคนต้องได้ camera picker)
 * ถ้าเทียบแบบ prefix มันจะแจก `/api/cameras/status-log` ให้ทุกคนไปด้วย → แท็บ
 * `history:camera-status` ที่ประกาศว่า `enforceable: true` จะกลายเป็นของหลอกทันที
 * (แอดมินคิดว่ากันที่ server ได้ แต่จริงๆ ไม่กัน = failure mode ที่เจ้าของกลัวที่สุด)
 *
 * `:p` = ตรงกับ 1 segment ใดก็ได้ (ไม่กิน `/`) · จำนวน segment ต้องเท่ากันเป๊ะ
 * `/**` ท้าย pattern = กินที่เหลือทั้งหมด (อย่างน้อย 1 segment) — ใช้กับ `/snapshots/**`
 * ที่ path จริงลึกไม่คงที่ (`events/<date>/<cam>/<slot>/<file>` vs `preview/<cam>.jpg`)
 */
function matches(pattern, reqPath) {
  const b0 = String(reqPath).split('?')[0].split('/');
  if (pattern.endsWith('/**')) {
    const head = pattern.slice(0, -3).split('/');
    if (b0.length <= head.length) return false;
    return head.every((seg, i) => seg === ':p' ? !!b0[i] : seg === b0[i]);
  }
  const a = pattern.split('/'), b = b0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === ':p') { if (!b[i]) return false; continue; }
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** path นี้อยู่ในชุด pattern ที่อนุญาตไหม (ใช้ใน P4 middleware) */
function pathAllowed(patterns, reqPath) {
  return patterns.some(p => matches(p, reqPath));
}

function get(key) { return _byKey.get(key) || null; }
function isValidKey(key) { return _byKey.has(key); }
function allKeys() { return [..._byKey.keys()]; }
function resolvePage(name) { return PAGE_ALIASES[name] || name; }

/**
 * route ที่ user ซึ่งได้รับ view ชุดนี้ยิงได้ (ยังไม่รวม CORE_ROUTES)
 * - ได้ทั้งหน้า  → route ของหน้า + ของทุกแท็บ
 * - ได้เฉพาะแท็บ enforceable → route ของแท็บนั้นอย่างเดียว (boundary จริง)
 * - ได้เฉพาะแท็บ ui-only     → ต้องได้ route ของหน้าด้วย ไม่งั้นแท็บโหลดไม่ขึ้น
 *                              (= เหตุผลที่มันกันได้แค่หน้าจอ ต้องบอกแอดมินตรงๆ)
 */
function routesFor(keys) {
  const out = new Set(CORE_ROUTES);
  for (const key of keys || []) {
    const v = _byKey.get(key);
    if (!v) continue;
    if (!key.includes(':')) {
      for (const r of v.routes || []) out.add(r);
      for (const t of v.tabs || []) for (const r of t.routes || []) out.add(r);
    } else {
      for (const r of v.routes || []) out.add(r);
      if (!v.enforceable) for (const r of (_byKey.get(v.page)?.routes || [])) out.add(r);
    }
  }
  return [...out];
}

/** รูปที่ส่งให้ client — ตัด routes/entries ออก ไม่ประกาศ allowlist ให้โลกรู้ */
function clientRegistry() {
  return VIEWS.map(v => ({
    key: v.key, label: v.label, i18n: v.i18n || null,
    parent: v.parent || null, adminOnly: !!v.adminOnly,
    tabs: (v.tabs || []).map(t => ({
      key: `${v.key}:${t.key}`, label: t.label, i18n: t.i18n || null, enforceable: !!t.enforceable,
    })),
  }));
}

module.exports = {
  VIEWS, CORE_ROUTES, PAGE_ALIASES, WS_TYPE_ROUTE,
  get, isValidKey, allKeys, resolvePage, routesFor, clientRegistry,
  matches, pathAllowed,
};
