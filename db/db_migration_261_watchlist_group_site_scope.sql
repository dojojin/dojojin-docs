-- ============================================================
-- Vigil Platform — Migration 261: รายการเฝ้าระวังแบบ Global หรือเฉพาะ Site
-- ------------------------------------------------------------
-- ขอบเขตอยู่ที่ "กลุ่ม" — รายการข้างในสืบทอดจากกลุ่ม (ป้ายทะเบียน: lpr_watchlist.group_id ·
-- ใบหน้า: face_blacklist.group_id)
--   site_id IS NULL  = Global — จับคู่กับกล้องทุก Site (พฤติกรรมเดิม 100% ทุกแถวที่มีอยู่)
--   site_id = <id>   = เฉพาะ Site — จับคู่/แจ้งเตือนเฉพาะกล้องของ Site นั้น · Site Admin ของ Site นั้นแก้ได้
-- ⚠️ ไม่เกี่ยวกับ face_blacklist.site_id (VARCHAR 'hkt') ซึ่งเป็น "ไซต์ที่ worker ประมวลผล" มาตั้งแต่ migration 129
-- FK ไม่ใส่ ON DELETE SET NULL โดยตั้งใจ: ลบ Site แล้วรายการเฉพาะ Site จะกลายเป็น Global เงียบ ๆ
-- (แจ้งเตือนทุก Site) — ให้ลบไม่ได้จนกว่าจะย้าย/ลบกลุ่มก่อนดีกว่า
-- ADD COLUMN แบบ nullable ไม่มี default = แก้ metadata อย่างเดียว ไม่ rewrite ตาราง
-- ============================================================

ALTER TABLE lpr_watchlist_groups  ADD COLUMN IF NOT EXISTS site_id INT REFERENCES sites(id);
ALTER TABLE face_blacklist_groups ADD COLUMN IF NOT EXISTS site_id INT REFERENCES sites(id);
