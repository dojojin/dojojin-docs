// ============================================================
// Vigil Platform — สร้าง "ชุดดัชนีบางส่วน" บน events (partitioned)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ชื่อไฟล์เป็นมรดกจากดัชนีตัวแรก (face blacklist) แต่ตอนนี้สคริปต์นี้ดูแล
// "ชุดดัชนีบางส่วนทั้งหมดบน events" ไม่ใช่แค่ของหน้าใบหน้า — ดู INDEXES ด้านล่าง
// (ห้ามเปลี่ยนชื่อไฟล์: migration 167/199 และ runbook อ้างชื่อนี้อยู่)
//
// รันครั้งเดียวบนเครื่องที่ตาราง events ใหญ่แล้ว (production) — migration คู่กัน
// (167 = blacklist · 168 = hits · 199 = anpr_noread) ทำงานเฉพาะกับ "ติดตั้งใหม่"
// ที่ตารางยังเล็ก ดูเหตุผลในไฟล์เหล่านั้น
//
//   set -a; . ./src/.env; set +a
//   node scripts/create-face-blacklist-index.js                       # สร้างทุกตัว
//   node scripts/create-face-blacklist-index.js --index=hits          # เฉพาะตัวที่ต้องการ
//   node scripts/create-face-blacklist-index.js --index=anpr_noread   # แท็บ "ไม่ทราบทะเบียน"
//   node scripts/create-face-blacklist-index.js --dry-run             # ดูแผนเฉย ๆ
//
// ⚠️ CREATE INDEX CONCURRENTLY บน partitioned parent ทำไม่ได้ (Postgres 16 ยังไม่รองรับ
//    — ERROR: cannot create index on partitioned table "events" concurrently)
//    จึงต้องทำ 3 ขั้น: สร้างบนลูกทีละตัว → สร้างแม่แบบ ON ONLY → ATTACH ทีละตัว
//
// ⚠️ ทำไมพาร์ทิชันว่างถึงใช้ CONCURRENTLY ไม่คุ้ม: วัดจริง 2026-08-21 บน m06 (19 MB)
//    non-concurrent 27ms · concurrent 45,127ms ⇒ overhead คงที่ของ CONCURRENTLY
//    ≈ 45 วินาทีต่อพาร์ทิชัน โดยไม่เกี่ยวกับขนาดข้อมูล (เป็นการรอ snapshot ของ
//    transaction ที่เปิดอยู่) · 22 พาร์ทิชันว่างจึงใช้แบบธรรมดา ล็อกไม่ถึง 30ms ต่อตัว
//    และไม่มี event เขียนเข้าเดือนที่ผ่านไปแล้ว/ยังไม่มาถึงอยู่แล้ว

// node_modules อยู่ใต้ src/ ไม่ใช่ราก — สคริปต์อื่นใน scripts/ ก็ resolve แบบนี้
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
require(path.join(SRC, 'node_modules', 'dotenv')).config({ path: path.join(SRC, '.env'), quiet: true });
const { Pool } = require(path.join(SRC, 'node_modules', 'pg'));

// ชุดดัชนีที่สคริปต์นี้ดูแล — เพิ่มตัวใหม่ที่นี่ที่เดียว ขั้นตอนการสร้างใช้ร่วมกัน
const RECOG = `event_type IN ('FaceRecognition','FaceDetector/Comparison')`;
const LIST  = `COALESCE(raw_json->>'listType', raw_json->>'list_type', raw_json->>'hcp_list_type')`;
const INDEXES = {
  // แถบ "บุคคลเฝ้าระวัง" หน้าภาพรวม — ?list_type=blackList
  blacklist: {
    name: 'idx_events_face_blacklist_time',
    pred: `${RECOG} AND ${LIST} = 'blackList'`,
  },
  // แท็บ "จดจำใบหน้า" — ?hits_only=1 (มี listType อะไรก็ได้)
  // ครอบชุด blackList ด้วยโดยปริยาย แต่ตัว blacklist เล็กกว่าและเจาะจงกว่า
  // ปล่อยให้ planner เลือกเองว่าจะใช้ตัวไหนกับ query ไหน
  hits: {
    name: 'idx_events_face_haslist_time',
    pred: `${RECOG} AND ${LIST} IS NOT NULL`,
  },
  // แท็บ "ไม่ทราบทะเบียน" หน้า LPR — GET /api/lpr/no-read (src/routes/lpr-query.js)
  // นิยามเดิมคือ anprAlarm ที่ไม่มีแถวใน license_plates ⇒ anti-join 5.6 ล้านแถว
  // (7 วัน ≈ 38 วินาที) · วัดจริง 2026-09-06 ว่าเซตนั้นเท่ากับ plate ว่างเป๊ะ:
  //   24 ชม. 19,637 = 19,637 · 7 วัน 156,201 = 156,201 (ต่างกัน 0 ทั้งสองทาง)
  // predicate ต้องตรงกับที่ route ใช้ (modulo alias e.) และ migration 199 เป๊ะ ๆ
  // ไม่งั้น planner จะไม่เลือกดัชนีนี้
  anpr_noread: {
    name: 'idx_events_anpr_noread_time',
    pred: `event_type = 'anprAlarm' AND COALESCE(raw_json->>'plate','') = ''`,
  },
  // Hikvision รายงาน "อ่านไม่ออก" คนละแบบกับ Dahua: มันส่ง `plate = "unknown"` มา
  // (และสร้างแถวใน license_plates ด้วย) ส่วน Dahua ไม่ส่งฟิลด์ป้ายมาเลย
  // ⇒ นิยาม "อ่านป้ายไม่ได้" ที่แท้จริงคือสองรูปรวมกัน · แยกเป็นสองดัชนีบางส่วน
  // แทนที่จะแก้ predicate ของตัวเดิมให้เป็น IN (...) เพราะ (ก) ไม่ต้องรื้อดัชนีที่มีอยู่
  // (ข) planner ต่อ BitmapOr ให้เองได้ (ค) ตัวนี้เล็กมาก — 86,299 แถวในพาร์ทิชันเดือนนี้
  // วัดจริง 2026-09-08: predicate รวมแบบไม่มีดัชนีตัวนี้ = 2.4 วิ (24 ชม.) / 20.8 วิ (7 วัน)
  anpr_unknown: {
    name: 'idx_events_anpr_unknown_time',
    pred: `event_type = 'anprAlarm' AND raw_json->>'plate' = 'unknown'`,
  },
};
const COLS = '(event_time DESC, id DESC)';
const DRY = process.argv.includes('--dry-run');
const WHICH = (process.argv.find(a => a.startsWith('--index=')) || '').split('=')[1] || 'all';

// พาร์ทิชันที่ "ยังรับ event อยู่หรือมีข้อมูลมาก" ใช้ CONCURRENTLY · ที่เหลือใช้ธรรมดา
// เกณฑ์: มีแถวจริง (n_live_tup > 0) — วัดจากสถิติของ Postgres ไม่ใช่รายชื่อ hardcode
// เพราะเดือนถัดไปพาร์ทิชันจะย้ายกลุ่มเอง
const LIVE_MIN_TUPLES = 1;

const log = (...a) => console.log(...a);

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, max: 2,
    application_name: 'face-bl-index',
    // ห้ามให้ CONCURRENTLY โดนตัดกลางคัน — จะทิ้ง index สถานะ INVALID ไว้
    options: '-c statement_timeout=0',
  });

  const parts = (await pool.query(`
    SELECT c.relname AS name,
           COALESCE(s.n_live_tup, 0)::bigint AS live,
           pg_total_relation_size(c.oid)     AS bytes
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class p    ON p.oid = i.inhparent
      LEFT JOIN pg_stat_user_tables s ON s.relname = c.relname
     WHERE p.relname = 'events'
     ORDER BY pg_total_relation_size(c.oid) DESC`)).rows;

  const big   = parts.filter(p => Number(p.live) >= LIVE_MIN_TUPLES);
  const empty = parts.filter(p => Number(p.live) <  LIVE_MIN_TUPLES);
  log(`พาร์ทิชันทั้งหมด ${parts.length} · มีข้อมูล ${big.length} (ใช้ CONCURRENTLY) · ว่าง ${empty.length} (ใช้แบบธรรมดา)`);
  big.forEach(p => log(`   · ${p.name.padEnd(16)} ${(Number(p.bytes) / 1073741824).toFixed(2)} GB`));
  if (DRY) { log('\n--dry-run: ไม่ได้ลงมืออะไร'); await pool.end(); return; }

  const t0 = Date.now();
  const want = WHICH === 'all' ? Object.keys(INDEXES) : [WHICH];
  for (const key of want) {
    const def = INDEXES[key];
    if (!def) { log(`🔴 ไม่รู้จักดัชนี "${key}" — มีให้เลือก: ${Object.keys(INDEXES).join(', ')}, all`); process.exit(1); }
    log(`\n── ${def.name} ──`);
    await buildOne(pool, def, parts, big, empty);
  }
  log(`\nรวมทั้งหมด ${((Date.now() - t0) / 1000).toFixed(1)} วินาที`);
  await pool.end();
}

async function buildOne(pool, def, parts, big, empty) {
  const IDX = def.name, PRED = def.pred;
  const idxOf = (p) => `${IDX}_${p.replace(/^events_/, '')}`;
  const t0 = Date.now();

  // ── ขั้น 1: ดัชนีบนลูกทีละตัว ─────────────────────────────
  for (const p of [...big, ...empty]) {
    const child = idxOf(p.name);
    // ⚠️ CONCURRENTLY ที่ล้มกลางคัน (deadlock/timeout) ทิ้ง index สถานะ INVALID ไว้
    //    ต้องลบทิ้งก่อนลองใหม่ ไม่งั้น CREATE รอบหน้าจะเจอชื่อซ้ำแล้วข้ามไปเฉย ๆ
    //    โดยที่ดัชนีนั้นใช้งานไม่ได้จริง (เจอจริง 2026-08-21 ตอนสร้างตัวที่ 2)
    const st = (await pool.query(
      `SELECT i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname = $1`, [child])).rows[0];
    if (st && !st.indisvalid) {
      log(`   🧹 ${child} ค้างสถานะ INVALID — ลบทิ้งก่อน`);
      await pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${child}`);
    } else if (st) { log(`   ⏭  ${child} มีอยู่แล้ว`); continue; }

    const conc = Number(p.live) >= LIVE_MIN_TUPLES;
    // deadlock เกิดได้เมื่อ CONCURRENTLY ไปชนกับ transaction ของ ingest ที่กำลังเขียน
    // พาร์ทิชันเดือนปัจจุบัน — เป็นเรื่องชั่วคราว ลองใหม่ผ่านเกือบทุกครั้ง
    for (let attempt = 1; ; attempt++) {
      const t = Date.now();
      try {
        // ⚠️ CONCURRENTLY ห้ามอยู่ใน transaction — pool.query ตัวเดียวไม่มี BEGIN จึงใช้ได้
        await pool.query(
          `CREATE INDEX ${conc ? 'CONCURRENTLY ' : ''}${child} ON ${p.name} ${COLS} WHERE ${PRED}`);
        log(`   ✅ ${child.padEnd(46)} ${conc ? 'CONCURRENTLY' : 'ธรรมดา'} ${Date.now() - t}ms`);
        break;
      } catch (e) {
        if (!/deadlock/i.test(e.message) || attempt >= 4) throw e;
        log(`   ⏳ ${child} — deadlock ลองใหม่ (${attempt}/3)`);
        await pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${child}`).catch(() => {});
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  // ── ขั้น 2: แม่แบบบน parent (ON ONLY = ไม่แตะข้อมูล แต่ล็อก ACCESS EXCLUSIVE ตอนขอ)
  // ⚠️ lock_timeout กันคิว: ถ้าไปติดหลัง query ยาว (เคยเจอ query รายเดือน 5 นาที)
  //    ทุก reader/writer จะกองรอหลังคำขอล็อกของเรา · ล้มเร็วดีกว่าสร้างคิว
  if (!(await pool.query('SELECT to_regclass($1) AS r', [IDX])).rows[0].r) {
    await withLockTimeout(pool, `CREATE INDEX ${IDX} ON ONLY events ${COLS} WHERE ${PRED}`, 'สร้างแม่แบบ ON ONLY');
  } else log(`   ⏭  ${IDX} (แม่แบบ) มีอยู่แล้ว`);

  // ── ขั้น 3: ATTACH ทุกลูก — parent จะ valid ก็ต่อเมื่อครบทุกตัว ───
  for (const p of parts) {
    const child = idxOf(p.name);
    const attached = (await pool.query(
      `SELECT 1 FROM pg_inherits WHERE inhrelid = $1::regclass AND inhparent = $2::regclass`,
      [child, IDX])).rows.length;
    if (attached) { log(`   ⏭  ${child} attach แล้ว`); continue; }
    await withLockTimeout(pool, `ALTER INDEX ${IDX} ATTACH PARTITION ${child}`, `attach ${p.name}`);
  }

  // ── ตรวจรับงาน: indisvalid = true เท่านั้นที่ planner จะใช้ ─────
  const ok = (await pool.query(
    `SELECT indisvalid FROM pg_index WHERE indexrelid = $1::regclass`, [IDX])).rows[0];
  const size = (await pool.query(
    `SELECT pg_size_pretty(sum(pg_total_relation_size(c.oid))) AS s FROM pg_class c
      WHERE c.relname = $1 OR c.relname LIKE $2`, [IDX, IDX + '\\_%'])).rows[0].s;
  log(`   เสร็จใน ${((Date.now() - t0) / 1000).toFixed(1)} วินาที · ขนาดรวม ${size}`);
  log(ok && ok.indisvalid
    ? '   ✅ แม่แบบ indisvalid = true — planner ใช้ดัชนีนี้ได้แล้ว'
    : '   🔴 indisvalid = false — ยังมีพาร์ทิชันที่ยังไม่ attach ดัชนีจะไม่ถูกใช้');
  if (!(ok && ok.indisvalid)) process.exit(1);
}

// ล็อกเร็ว ล้มเร็ว แล้วลองใหม่ — ดีกว่าปล่อยให้คิวยาว
async function withLockTimeout(pool, sql, label, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    const c = await pool.connect();
    try {
      await c.query("SET lock_timeout = '3s'");
      const t = Date.now();
      await c.query(sql);
      log(`   ✅ ${label} (${Date.now() - t}ms)`);
      return;
    } catch (e) {
      if (!/lock timeout|deadlock/i.test(e.message) || i === tries) throw e;
      log(`   ⏳ ${label} — ล็อกไม่ว่าง ลองใหม่ (${i}/${tries})`);
      await new Promise(r => setTimeout(r, 4000));
    } finally { c.release(); }
  }
}

main().catch(e => { console.error('🔴 ล้มเหลว:', e.message); process.exit(1); });
