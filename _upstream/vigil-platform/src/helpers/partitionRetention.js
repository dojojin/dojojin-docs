// ============================================================
// Vigil Platform — events partition lifecycle (Phase 5)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// enforceRetention() removes expired events with a batched row DELETE. That
// works, but at the real rate — 5.4M events in July 2026 alone, 17 GB in one
// monthly partition — deleting a year-old month means ~5M dead tuples and a
// table that grows before it shrinks. DROP TABLE on the partition is instant,
// creates no dead tuples, and returns the space to the OS immediately.
//
// Three things make this dangerous enough to be report-only by default.
//
// 1. THE CHILDREN LOST THEIR CASCADE. appearances, license_plates,
//    face_event_notes, face_event_acks and lpr_alert_acks had their FK to
//    events dropped when the table was partitioned (required for a partitioned
//    parent — MANUAL_partition_events_option_a.sql). enforceRetention()
//    compensates by deleting children explicitly first. A DROP does not, so
//    this module has to do the same cleanup by hand. face_event_notes,
//    face_event_acks and lpr_alert_acks have NO retention of their own — they
//    would leak orphans silently, forever, starting with the first drop.
//
// 2. TWO RETENTION WINDOWS COVER ONE PARTITION. anprAlarm rows are excluded
//    from data_retention_days and governed by lpr_retention_days instead. A
//    partition holds both kinds, so it may only be dropped once the LONGER of
//    the two has passed. Using data_retention_days alone would delete LPR
//    history that policy says to keep.
//
// 3. IT IS NOT REVERSIBLE. There is no undo and no confirmation prompt behind
//    an unattended job, so dropping is opt-in via the partition_drop_enabled
//    setting. Until it is turned on this module only reports what it WOULD
//    drop, every day, in the log — which is also how the mechanism gets
//    verified long before it is ever allowed to act.
//
// Nothing is due until roughly June 2027 (oldest data: 2026-06). This exists
// now so it is built and watched while the stakes are zero.
// ============================================================
'use strict';

// Partitions are named events_yYYYYmMM. events_default is the catch-all for
// rows outside every declared range and is never a candidate: it has no upper
// bound, so "everything in it is older than X" can never be established.
const beat = require('./retentionBeat');
const { frozenScope } = require('./retentionScope');
const PART_RE = /^events_y(\d{4})m(\d{2})$/;

// license_plates was partitioned on 2026-07-31 and reverted the same day: the
// events⋈license_plates join in /api/lpr/alerts went from 0.02s to 8.6s because
// the two tables partition on different keys (event_time vs detected_at) and
// join on event_id, so no partition-wise join is possible and the planner fell
// back to a merge join over 5.76M rows to find 175 alerts. Do not add it back
// without fixing that query first — see the plan document.
const PARTITIONED_PARENTS = ['events'];

// The partition's exclusive upper bound, i.e. the first instant NOT in it.
// Derived from the name rather than parsed out of relpartbound so a partition
// with a hand-edited bound cannot be mistaken for a clean monthly one — the
// caller cross-checks against the real bound below.
function upperBoundOf(relname) {
  const m = PART_RE.exec(relname);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1));
}

async function getRetentionDays(pool) {
  const { rows } = await pool.query(
    `SELECT key, value FROM system_settings
      WHERE key IN ('data_retention_days','lpr_retention_days','partition_drop_enabled')`);
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const clamp = (v, d) => Math.min(730, Math.max(1, parseInt(v || d, 10) || parseInt(d, 10)));
  const general = clamp(m.data_retention_days, '365');
  const lpr = clamp(m.lpr_retention_days, '365');
  return {
    general, lpr,
    // The longer window wins: one partition holds rows governed by both.
    effective: Math.max(general, lpr),
    enabled: m.partition_drop_enabled === 'true',
  };
}

// Which partitions are entirely older than the effective window.
async function duePartitions(pool) {
  const { effective, ...rest } = await getRetentionDays(pool);
  const cutoff = new Date(Date.now() - effective * 86400 * 1000);
  const { rows } = await pool.query(`
    SELECT c.relname, p.relname AS parent, pg_get_expr(c.relpartbound, c.oid) AS bound,
           pg_total_relation_size(c.oid) AS bytes
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname = ANY($1)
     ORDER BY p.relname, c.relname`, [PARTITIONED_PARENTS]);

  const due = [], kept = [];
  for (const r of rows) {
    const ub = upperBoundOf(r.relname);
    // Skip events_default and anything that is not a clean monthly partition.
    // A DEFAULT partition reports "DEFAULT" as its bound and holds whatever
    // fell outside every range — possibly recent rows.
    if (!ub || !r.bound || /DEFAULT/i.test(r.bound)) { kept.push({ ...r, reason: 'ไม่ใช่ partition รายเดือน' }); continue; }
    // Cross-check the name against the declared bound: the name is what we
    // reason about, so a partition whose real range does not match its name
    // must not be dropped on the strength of the name alone.
    if (!r.bound.includes(ub.toISOString().slice(0, 10))) {
      kept.push({ ...r, reason: 'ชื่อกับขอบเขตจริงไม่ตรงกัน' });
      continue;
    }
    if (ub <= cutoff) due.push({ relname: r.relname, bytes: Number(r.bytes), upper: ub });
    else kept.push({ ...r, reason: 'ยังไม่ครบอายุ' });
  }
  return { due, kept, cutoff, effective, ...rest };
}

// Delete the rows in the child tables that reference this partition, then drop
// it. The children are addressed through a subquery over the partition itself,
// so the set is exactly the partition's contents — never a time range guessed
// from event_id, which is monotonic but carries no such guarantee.
//
// 🔴 ลิสต์นี้เคยเขียนตายตัวและ **ขาดไป 3 ตาราง** (face_blacklist_hits,
// face_embed_queue, face_embeddings) ⇒ DROP TABLE ล้มด้วย "cannot drop table
// ... because other objects depend on it" · พิสูจน์ด้วย repro จริง 2026-08-27
// โดยสร้าง partition ปี 2019 ขึ้นมาแล้วให้กลไกจริงลบ — มันลบไม่ได้
//
// ที่อันตรายคือเส้นทางนี้จะถูกใช้ครั้งแรกอีกราว 10 เดือน (ข้อมูล 66 วัน ·
// retention 365 วัน) ถ้าไม่ทดสอบวันนี้จะไปเจอตอนดิสก์ใกล้เต็ม
//
// จึงเลิกใช้ลิสต์ตายตัว — ถามจาก catalog ว่าใครมี FK ชี้มาที่ partition นี้จริง ๆ
// ลิสต์ที่เขียนด้วยมือจะดริฟต์ซ้ำทันทีที่มีใครเพิ่มตารางลูกใหม่ และจะเงียบอีก
// เหมือนเดิม · ค่าคงที่ด้านล่างเหลือไว้เป็น fallback อย่างเดียว
const CHILD_TABLES = [
  'appearances', 'license_plates', 'face_event_notes', 'face_event_acks', 'lpr_alert_acks',
  'face_blacklist_hits', 'face_embed_queue', 'face_embeddings',
];

/** ตารางที่มี FK ชี้มาที่ partition นี้ — ถามจาก catalog ไม่ใช่จำเอา */
async function referencingTables(pool, relname) {
  const { rows } = await pool.query(
    `SELECT DISTINCT c.relname AS t
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
      WHERE con.contype = 'f' AND con.confrelid = $1::regclass
      ORDER BY 1`, [relname]);
  const found = rows.map(r => r.t).filter(t => /^[a-z_][a-z0-9_]*$/i.test(t));
  // ไม่เจออะไรเลยแปลว่าคำถามผิด ไม่ใช่ว่าไม่มีลูก — ถอยไปใช้ลิสต์เดิมดีกว่าลบไม่ครบ
  return found.length ? found : CHILD_TABLES;
}

async function dropPartition(pool, relname, { batch = 5000 } = {}) {
  if (!PART_RE.test(relname)) throw new Error(`ปฏิเสธชื่อ partition ที่ไม่ถูกรูปแบบ: ${relname}`);
  const removed = {};
  for (const t of await referencingTables(pool, relname)) {
    let total = 0, n;
    do {
      const r = await pool.query(
        `DELETE FROM ${t} WHERE event_id IN (
           SELECT id FROM ${relname} LIMIT $1
         )`, [batch]);
      n = r.rowCount;
      total += n;
      if (n === batch) await new Promise(res => setTimeout(res, 100));   // yield to ingest
    } while (n === batch);
    removed[t] = total;
  }
  // ACCESS EXCLUSIVE, but only on the partition being removed — the parent and
  // the live partition keep taking writes. GOTCHAS #134 is about DDL that
  // blocks ingest; this touches a table nothing has written to for a year.
  // CASCADE จำเป็น ไม่ใช่ความมักง่าย: Postgres กระจาย FK ของตารางแม่ลงไปสร้าง
  // constraint หนึ่งตัวต่อ partition (เช่น face_embeddings_..._fkey26) ตัว
  // constraint นั้นเองขึ้นกับ partition ⇒ DROP ธรรมดาล้มแม้ลบแถวลูกครบแล้ว
  // เพราะเป็น dependency ของ "วัตถุ" ไม่ใช่ของ "ข้อมูล"
  // CASCADE ตรงนี้ทิ้งเฉพาะ constraint ที่ผูกกับ partition นี้ — ไม่แตะตารางลูก
  // (พิสูจน์ใน repro: หลังลบ ตารางลูกทั้งสามยังอยู่ครบพร้อมข้อมูลเดิม)
  await pool.query(`DROP TABLE ${relname} CASCADE`);
  return removed;
}

// autovacuum never ANALYZEs a partitioned PARENT — only its partitions. The
// parent's own statistics are what the planner uses to size a scan across the
// whole set, and without them it plans as if the table were empty. Right after
// license_plates was partitioned that cost /api/stats/lpr/report 59 seconds;
// one ANALYZE brought it back to 4.3. Nobody would have noticed it drifting.
// Cheap (0.6s over 5.3M rows) and it rides the retention tick that already runs
// once a day.
async function analyzeParents(pool) {
  for (const t of PARTITIONED_PARENTS) {
    try { await pool.query(`ANALYZE ${t}`); }
    catch (e) { console.warn(`🗄️  ANALYZE ${t} failed:`, e.message); }
  }
}

async function enforcePartitionRetention(pool) {
  try {
    await analyzeParents(pool);
    const { due, kept, effective, enabled, general, lpr } = await duePartitions(pool);
    // 🔴 ห้าม return เงียบ — งานนี้จะ "ไม่มีอะไรถึงกำหนด" ไปอีกราว 10 เดือน
    // (ข้อมูล 66 วัน · retention 365 วัน) ถ้ามันพังระหว่างนั้นจะไม่มีใครรู้เลย
    // จนถึงวันที่ดิสก์ใกล้เต็ม ซึ่งเป็นเวลาที่แย่ที่สุดที่จะมาแก้
    if (!due.length) {
      beat.beat('partition', 0, `อายุที่ใช้ ${effective} วัน · partition ที่ดูแล ${kept.length} อัน`);
      return { dropped: [], due: [] };
    }

    const list = due.map(d => `${d.relname} (${(d.bytes / 1073741824).toFixed(2)} GB)`).join(', ');
    if (!enabled) {
      // The whole point of reporting rather than acting: this line appears in
      // the log for as long as it takes somebody to read it and decide.
      console.warn(
        `🗄️  partition retention: ${due.length} partition ถึงกำหนดลบแล้ว — ${list}\n` +
        `    (อายุที่ใช้ ${effective} วัน = ค่ามากกว่าระหว่าง data_retention ${general} / lpr_retention ${lpr})\n` +
        `    ยังไม่ลบ เพราะ system_settings.partition_drop_enabled ยังไม่เป็น 'true'`);
      return { dropped: [], due };
    }

    // 🧊 ไซต์ปิดปรับปรุง — partition ที่มีแถวของกล้องไซต์นั้นแม้แถวเดียว ห้าม DROP ทั้งก้อน
    // อ่านเฉพาะตอนจะลบจริง (เส้นทางรายงานอย่างเดียวไม่มี query เพิ่ม) · อ่านไม่ได้ = โยน → catch → ไม่ลบอะไร
    const { frozenCams, frozenSiteCodes } = await frozenScope(pool);
    const dropped = [], held = [];
    for (const d of due) {
      if (frozenCams.length) {
        if (!PART_RE.test(d.relname)) throw new Error(`ปฏิเสธชื่อ partition ที่ไม่ถูกรูปแบบ: ${d.relname}`);
        const hit = await pool.query(`SELECT 1 FROM ${d.relname} WHERE camera_id = ANY($1) LIMIT 1`, [frozenCams]);
        if (hit.rowCount) {
          console.warn(`[partition-retention] ถอย: partition ${d.relname} มีข้อมูลของไซต์ที่ปิดปรับปรุง (${frozenSiteCodes.join(', ')})`);
          held.push({ ...d, reason: 'ไซต์ปิดปรับปรุง', sites: frozenSiteCodes });
          continue;
        }
      }
      const removed = await dropPartition(pool, d.relname);
      dropped.push({ ...d, removed });
      console.log(`🗄️  partition retention: ลบ ${d.relname} (${(d.bytes / 1073741824).toFixed(2)} GB) · ` +
        `ลูกที่ลบไปด้วย ${JSON.stringify(removed)}`);
    }
    return { dropped, due, held };
  } catch (e) {
    beat.beatFail('partition', e);
    return { dropped: [], due: [], error: e.message };
  }
}

module.exports = { upperBoundOf, duePartitions, dropPartition, referencingTables, enforcePartitionRetention, analyzeParents, PART_RE, CHILD_TABLES, PARTITIONED_PARENTS };

// ---------- self-check ----------
// `node src/helpers/partitionRetention.js`. The parts worth guarding are the
// ones that decide whether a year of data is destroyed: the bound arithmetic,
// and that anything not provably a clean expired month is refused.
if (require.main === module) {
  const assert = require('assert');

  assert.deepStrictEqual(upperBoundOf('events_y2026m07'), new Date(Date.UTC(2026, 7, 1)));
  assert.strictEqual(upperBoundOf('license_plates_y2026m07'), null,
    'license_plates เลิก partition แล้ว ต้องไม่ถูกมองว่าเป็น partition');
  assert.strictEqual(upperBoundOf('appearances_y2026m07'), null, 'ตารางที่ไม่ได้อยู่ในรายการต้องถูกปฏิเสธ');
  assert.deepStrictEqual(upperBoundOf('events_y2026m12'), new Date(Date.UTC(2027, 0, 1)),
    'ธันวาคมต้องข้ามไปปีถัดไป');
  assert.strictEqual(upperBoundOf('events_default'), null, 'default ต้องไม่มีขอบเขตบน');
  assert.strictEqual(upperBoundOf('events_y2026m13'), null, 'เดือน 13 ต้องถูกปฏิเสธ');
  assert.strictEqual(upperBoundOf('license_plates'), null);

  const fake = (rows, settings) => ({
    query: async (sql) => {
      if (/system_settings/.test(sql)) return { rows: settings };
      return { rows };
    },
  });
  const S = [{ key: 'data_retention_days', value: '365' }, { key: 'lpr_retention_days', value: '400' }];

  (async () => {
    const rows = [
      { relname: 'events_y2020m01', bound: "FOR VALUES FROM ('2020-01-01 00:00:00+00') TO ('2020-02-01 00:00:00+00')", bytes: '100' },
      { relname: 'events_y2026m07', bound: "FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00')", bytes: '200' },
      { relname: 'events_default', bound: 'DEFAULT', bytes: '300' },
      // name says 2019 but the declared range is 2026 — must never be dropped
      { relname: 'events_y2019m01', bound: "FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00')", bytes: '400' },
    ];
    const r = await duePartitions(fake(rows, S));
    assert.strictEqual(r.effective, 400, 'ต้องใช้ค่าอายุที่มากกว่าระหว่างสองนโยบาย');
    assert.deepStrictEqual(r.due.map(d => d.relname), ['events_y2020m01'],
      'ลบได้เฉพาะเดือนที่หมดอายุจริงและชื่อตรงกับขอบเขต');
    assert.ok(r.kept.some(k => k.relname === 'events_default'), 'default ต้องถูกเก็บไว้เสมอ');
    assert.ok(r.kept.some(k => k.relname === 'events_y2019m01' && /ไม่ตรงกัน/.test(k.reason)),
      'ชื่อไม่ตรงขอบเขต = ปฏิเสธ');

    // A shorter LPR window must not shorten the effective one either way round.
    const r2 = await duePartitions(fake(rows, [{ key: 'data_retention_days', value: '400' }, { key: 'lpr_retention_days', value: '30' }]));
    assert.strictEqual(r2.effective, 400);

    assert.strictEqual((await duePartitions(fake(rows, S))).enabled, false,
      'ไม่มี partition_drop_enabled = ต้องไม่เปิดใช้งาน');
    const r3 = await duePartitions(fake(rows, [...S, { key: 'partition_drop_enabled', value: 'true' }]));
    assert.strictEqual(r3.enabled, true);

    await assert.rejects(() => dropPartition({ query: async () => ({ rowCount: 0 }) }, 'events; DROP TABLE users'),
      /ปฏิเสธชื่อ partition/, 'ชื่อที่ไม่ผ่าน regex ต้องถูกปฏิเสธก่อนแตะฐานข้อมูล');

    console.log('partitionRetention self-check: ผ่านทุก assertion');
  })().catch(e => { console.error(e); process.exit(1); });
}
