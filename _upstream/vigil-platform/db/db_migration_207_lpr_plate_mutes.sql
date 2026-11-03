-- ============================================================
-- Migration 207: หยุดแจ้งเตือนรายป้าย "ชั่วคราว" (มีวันหมดอายุเสมอ)
-- ------------------------------------------------------------
-- ของเดิมมีแต่ `lpr_watchlist.notify_line` ซึ่งเป็น เปิด/ปิด ถาวร — ปิดแล้วไม่มีอะไร
-- เตือนให้เปิดกลับ ป้ายนั้นจึงเงียบไปตลอดกาลโดยไม่มีใครรู้ · การ์ดในกลุ่มเป็นรถหาย
-- พร้อมเบอร์ พ.ต.ท. การปิดเสียงถาวรจากในแชทคือ failure mode ที่ต้องออกแบบไม่ให้เกิด
-- ⇒ คำสั่งใน LINE ปิดได้แบบมีวันหมดอายุเท่านั้น · ถาวรทำได้เฉพาะในแดชบอร์ดที่มีชื่อคนกด
--
-- 🔴 ทำไมเป็นตารางแยก ไม่ใช่คอลัมน์ใน lpr_watchlist:
--    แถวของ lpr_watchlist ที่มาจากโรสเตอร์ (origin='blacklist_bridge') ถูก **ลบและ
--    ใส่กลับ** ได้เมื่อต้นทางถอดป้ายออกแล้วเพิ่มใหม่ · bridge ใส่กลับด้วย
--    INSERT ... ON CONFLICT DO NOTHING ⇒ ค่าที่อยู่บนแถวนั้นหายเงียบ ๆ
--    เป็นคลาสเดียวกับ GOTCHAS #195 เป๊ะ ๆ (ของที่ derive มาหายพร้อมแถว)
--    ตารางแยกอยู่รอดทุกกรณี และคีย์เป็นตัวป้ายเอง ไม่ใช่ id ของแถว
-- ============================================================

CREATE TABLE IF NOT EXISTS lpr_plate_mutes (
  plate_number text PRIMARY KEY,
  muted_until  timestamptz NOT NULL,
  muted_by     text,                 -- ชื่อผู้ใช้ที่สั่ง (จากบัญชีที่ผูกกับผู้สั่งใน LINE)
  source       text NOT NULL DEFAULT 'line',   -- line | dashboard
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lpr_plate_mutes_until ON lpr_plate_mutes (muted_until);
