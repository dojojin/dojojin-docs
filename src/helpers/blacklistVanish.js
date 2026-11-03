// ============================================================
// Vigil Platform — BS1 · แถวที่ต้นทางไม่ส่งมาแล้ว
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// **BS1 ทำเครื่องหมายอย่างเดียว ไม่ทำอะไรกับข้อมูลเลย** — ไม่ลบ ไม่ตัดออกจาก master
// ไม่ถอนจาก lpr_watchlist · การกระทำอยู่ที่ BS2 ซึ่งยังไม่ได้เขียนและต้องขอไฟเขียวแยก
//
// เหตุผลที่แยกกัน: การเข้าใจผิดว่า "ต้นทางลบ" ทั้งที่จริงคือ "ต้นทางล่ม" แล้วถอน
// ป้ายออกจากการเฝ้าระวัง = รถที่ตำรวจตามอยู่หลุดออกจากระบบโดยไม่มีใครรู้
// จึงต้องมีรอบที่ "เห็นตัวเลขก่อน แล้วค่อยตัดสินใจ"
//
// ด่านกันความผิดพลาด 4 ชั้น (ทุกชั้นมาจาก §BS ของสเปก):
//   1. รอบนั้นต้อง `status === 'ok'` — `partial`/`error` คือหน้าตาของ "ต้นทางล่ม"
//   2. รอบนั้นต้องเป็น **การกวาดทั้งชุด** (fullSweep) — import ที่ระบุช่วงวันที่เอง
//      กวาดไม่ครบอยู่แล้ว ทุกแถวนอกช่วงจะดูเหมือนหายทั้งที่ยังอยู่
//   3. ป้ายที่ยังอยู่ภายใต้ `external_id` ใหม่ = ต้นทาง **เปลี่ยนเลขแถว ไม่ใช่ลบ**
//      — เช็คได้เฉพาะแถวที่มี `plate_hash` (LPR) เท่านั้น
//   4. หายเกินเพดาน % = หยุด ไม่ทำเครื่องหมายเลย แล้วให้คนดู
//
// เดิม (จนถึง 2026-08-19) จำกัดแค่ data_type='lpr' — เหตุผลตอนนั้นคือด่าน 3 ไม่มี
// อะไรมาทำหน้าที่แทน plate_hash ให้ face เลย เปิดไปคนอาจถูกกวาดลงถังขยะเพราะ HCP
// แค่เปลี่ยนเลข ไม่ใช่ลบจริง เจ้าของสั่งเปิดหลังตรวจโค้ด normalizeHcpFace() แล้ว
// พบว่า external_id ของ HCP (`face:{group}:{indexCode}`) คือ indexCode ตัวบุคคล
// จริงที่คงที่ข้ามคลัง (วัดจริง: indexCode 1474-1482 อยู่ทั้ง BLACKLIST CTL และ
// BLACKLIST KML พร้อมกัน) ไม่ใช่เลขตำแหน่งแบบที่ LPR เคยมีปัญหา — ด่าน 4 (เพดาน %)
// ยังเป็นตาข่ายนิรภัยสุดท้ายเหมือนเดิมถ้าวันหนึ่งสมมติฐานนี้ผิด
// ============================================================
'use strict';

const VANISH_PCT_LIMIT = 20;   // หายเกินหนึ่งในห้าของทั้งแหล่ง = ผิดปกติ ให้คนตัดสิน

// runStart = เวลาที่เริ่มรอบ import (ไม่ใช่เวลาที่จบ) — แถวที่ถูกแตะระหว่างรอบจะมี
// last_seen_at ใหม่กว่าค่านี้เสมอ
// approveOverLimit — ทางออกสำหรับกรณีที่ต้นทาง "ลบจริงเป็นก้อนใหญ่"
//
// ด่าน 4 (เพดาน %) ตั้งใจให้หยุดแล้วรอคน เพราะแยกไม่ออกเองว่า "ต้นทางลบจริง"
// กับ "ต้นทางล่ม/ดึงมาไม่ครบ" ต่างกันยังไง — แต่พอเจอของจริงที่ลบเยอะจริง
// ก็ต้องมีทางให้คนบอกว่า "ตรวจแล้ว ลบจริง เดินต่อได้" โดยไม่ต้องไปลดเพดานถาวร
// ซึ่งเท่ากับถอดตาข่ายนิรภัยออกให้ทุกรอบในอนาคต
//
// เงื่อนไข: ต้องส่ง actor มาด้วยเสมอ — การอนุมัติที่ไม่รู้ว่าใครอนุมัติ ไม่ใช่การอนุมัติ
// ร่องรอยลงทั้งใน vanish_reason (เห็นบนหน้าจอต่อแถว) และ audit_log (ตรวจย้อนหลังได้)
//
// ใช้จริงครั้งแรก 2026-08-19: GuruSquare (HKT) ลดจาก 332 เหลือ 29 รายการ (หาย 91.3%)
// ยืนยันว่าเป็นการลบจริงด้วยการเทียบกับ HCP ซึ่งเป็นคนละระบบคนละทางดึง แล้วเหลือ 29
// เท่ากันและตรงกัน 27 ป้าย
async function scanVanished(pool, source, { dataType, runStart, fullSweep, status, actor, approveOverLimit = false } = {}) {
  const skip = (why) => ({ scanned: false, why });

  if (dataType !== 'lpr' && dataType !== 'face') return skip(`ไม่รองรับ data_type "${dataType}"`);
  if (status !== 'ok') return skip(`รอบนี้จบด้วยสถานะ "${status}" — แยกไม่ได้ว่าต้นทางลบหรือต้นทางล่ม`);
  if (!fullSweep) return skip('รอบนี้ไม่ได้กวาดทั้งชุด (ระบุช่วงเวลาเอง/ดึงไม่ครบหน้า)');
  if (!runStart) return skip('ไม่มีเวลาเริ่มรอบ');

  // แถวที่รอบนี้ไม่ได้แตะ · NULL = ยังไม่เคยถูกกวาดด้วยกลไกนี้เลย ข้ามไปเสมอ
  const { rows: missing } = await pool.query(`
    SELECT id, external_id, plate_hash, plate_numbers, name, last_seen_at
      FROM blacklist.source_records
     WHERE source_id = $1 AND data_type = $2
       AND vanished_at IS NULL
       AND last_seen_at IS NOT NULL
       AND last_seen_at < $3`,
    [source.id, dataType, runStart]);

  const { rows: [{ total }] } = await pool.query(
    `SELECT count(*)::int AS total FROM blacklist.source_records
      WHERE source_id = $1 AND data_type = $2`, [source.id, dataType]);

  if (!missing.length) return { scanned: true, total, missing: 0, marked: 0, renumbered: 0, held: false };

  // ด่าน 3 — ป้ายเดียวกันโผล่ในรอบนี้ภายใต้ external_id คนละอัน = เขาเปลี่ยนเลขแถว
  // เงื่อนไขสำคัญคือ **แถวอื่น** (id <> ตัวมันเอง) และ **เห็นในรอบนี้** (>= runStart)
  // ถ้าถามแค่ "plate_hash นี้มีอยู่ในแหล่งนี้ไหม" คำตอบคือมีเสมอ — ตัวมันเอง
  // face ไม่มี plate_hash เลย (เป็น NULL เสมอ) — ด่านนี้จึงเป็น no-op สำหรับ face
  // โดยตั้งใจ: ทุกแถว face ที่หายไหลตรงเข้า candidates ทันที ด่าน 4 (เพดาน %)
  // คือตาข่ายนิรภัยเดียวที่เหลือ (ดูเหตุผลที่หัวไฟล์)
  const hashes = missing.map((m) => m.plate_hash).filter(Boolean);
  const renumbered = new Set();
  if (hashes.length) {
    const { rows } = await pool.query(`
      SELECT DISTINCT plate_hash FROM blacklist.source_records
       WHERE source_id = $1 AND data_type = $2
         AND plate_hash = ANY($3)
         AND last_seen_at >= $4
         AND id <> ALL($5)`,
      [source.id, dataType, hashes, runStart, missing.map((m) => m.id)]);
    rows.forEach((r) => renumbered.add(r.plate_hash));
  }

  const candidates = missing.filter((m) => !m.plate_hash || !renumbered.has(m.plate_hash));
  const pct = total ? Math.round((candidates.length / total) * 1000) / 10 : 0;

  // ด่าน 4 — หายเยอะผิดปกติ: ไม่ทำเครื่องหมายสักแถว รายงานอย่างเดียว
  // ข้ามได้เฉพาะเมื่อมีคนอนุมัติมาโดยระบุชื่อ (ดูหัวฟังก์ชัน)
  const overLimit = pct > VANISH_PCT_LIMIT;
  const approved  = overLimit && approveOverLimit === true && !!actor;
  if (overLimit && !approved) {
    return { scanned: true, total, missing: missing.length, renumbered: renumbered.size,
             marked: 0, held: true, pct, limit_pct: VANISH_PCT_LIMIT,
             needs_approval: approveOverLimit === true && !actor ? 'ต้องระบุ actor ด้วย' : undefined,
             sample: candidates.slice(0, 10).map((c) => c.plate_numbers?.[0] || c.external_id) };
  }

  const reason = `ต้นทางลบรายการนี้ไปแล้ว เมื่อ ${new Date(runStart).toISOString()}`
    + (approved ? ` · เกินเพดาน ${VANISH_PCT_LIMIT}% (หาย ${pct}%) — อนุมัติโดย ${actor}` : '');
  let marked = 0;
  if (candidates.length) {
    // BS2 — ทำเครื่องหมาย **และ** ย้ายลงถังขยะต้องเกิดพร้อมกันหรือไม่เกิดเลย
    //
    // `desiredRows()` ตัดสินจาก `overrides.excluded` อย่างเดียว (ดู blacklistBridge)
    // ⇒ ถ้าเขียนเครื่องหมายสำเร็จแต่เขียนถังขยะพลาด ป้ายที่ต้นทางลบไปแล้วจะยัง
    // เฝ้าระวังต่อโดยไม่มีใครรู้ · ผูกไว้ใน transaction เดียวเพื่อให้รอบ import
    // ถัดไปได้ลองใหม่ทั้งคู่ แทนที่จะค้างครึ่ง ๆ กลาง ๆ อย่างถาวร
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ids = candidates.map((c) => c.id);
      const { rowCount } = await client.query(
        `UPDATE blacklist.source_records SET vanished_at = NOW(), vanish_reason = $2
          WHERE id = ANY($1) AND vanished_at IS NULL`, [ids, reason]);
      marked = rowCount;
      // `updated_by = 'system:vanish'` คือเครื่องหมายว่า **ระบบ** เป็นคนคัดออก ไม่ใช่คน
      // — ตอนต้นทางส่งแถวกลับมา blacklistImport จะล้างเฉพาะอันที่ระบบเขียนไว้เอง
      // ห้ามทับการยกเว้นที่คนตั้งใจตั้งไว้ (ON CONFLICT จึงมี WHERE กำกับ)
      await client.query(`
        INSERT INTO blacklist.overrides (source_id, external_id, excluded, exclude_reason, updated_by, updated_at)
        SELECT r.source_id, r.external_id, TRUE, $2, 'system:vanish', NOW()
          FROM blacklist.source_records r WHERE r.id = ANY($1)
        ON CONFLICT (source_id, external_id) DO UPDATE
           SET excluded = TRUE, exclude_reason = $2, updated_by = 'system:vanish', updated_at = NOW()
         WHERE blacklist.overrides.excluded = FALSE`, [ids, reason]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  await pool.query(
    `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
    [null, actor || 'system', 'blacklist_vanish_scan',
     JSON.stringify({ source_id: source.id, source_type: source.source_type, data_type: dataType,
                      total, missing: missing.length, renumbered: renumbered.size, marked, pct,
                      // อนุมัติข้ามเพดานต้องเห็นใน audit เสมอ — ไม่งั้นการกวาดก้อนใหญ่
                      // จะดูเหมือนรอบปกติเวลามีคนมาไล่ดูย้อนหลัง
                      ...(approved ? { approved_over_limit: true, limit_pct: VANISH_PCT_LIMIT } : {}),
                      plates: candidates.slice(0, 50).map((c) => c.plate_numbers?.[0] || c.external_id) })]
  ).catch(() => { /* audit ต้องไม่ทำให้ import ที่สำเร็จแล้วกลายเป็นล้มเหลว */ });

  return { scanned: true, total, missing: missing.length, renumbered: renumbered.size,
           marked, held: false, pct,
           plates: candidates.slice(0, 20).map((c) => c.plate_numbers?.[0] || c.external_id) };
}

module.exports = { scanVanished, VANISH_PCT_LIMIT };
