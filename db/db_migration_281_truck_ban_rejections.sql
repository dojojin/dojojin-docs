-- ============================================================
-- Vigil Platform — migration 281: truck-ban plate rejections
-- เจ้าหน้าที่กด Reject ป้ายในหน้า "รถบรรทุกวิ่งในช่วงห้าม" = ไม่ต้องแจ้งป้ายนี้อีก (เจ้าของสั่ง 2026-10-26)
-- ใช้กับรถที่ไม่อยู่ในข้อห้าม เช่น รถบรรทุกเล็ก/หกล้อ (≤2 เพลา) หรือรถที่ได้รับอนุญาต — ระบบแยกจำนวนเพลาเองไม่ได้
-- รายป้าย ไม่ผูกวัน (ซ่อนทั้งย้อนหลังและต่อไป) · ใครกด/เมื่อไร/เหตุผล · คืนสถานะได้ (DELETE แถว)
-- แบบเดียวกับ lpr_mismatch_dismissals (migration 064) · ตารางเล็ก ไม่มี backfill · Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS truck_ban_rejections (
  plate_number    TEXT PRIMARY KEY,
  reason          TEXT,
  rejected_by     TEXT,
  rejected_by_id  INTEGER,
  rejected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
