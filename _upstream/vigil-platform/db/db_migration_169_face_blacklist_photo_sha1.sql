-- ============================================================
-- Migration 169: ลายนิ้วมือของรูปต้นทางบนแถวใบหน้าที่มาจาก bridge
-- ------------------------------------------------------------
-- ปัญหา (ฝาแฝดของฝั่ง LPR ที่แก้ไปแล้วใน 3a6411f):
--   diffFace() เทียบแค่ label / notes / group_id / notify_line — ไม่เทียบรูป
--   (คอมเมนต์เดิมเขียนไว้ตรง ๆ ว่า "ref_image is NOT compared here")
--   ถ้าต้นทางแก้รูป (placeholder → รูปจริง) จะไม่มี field ไหนขยับเลย ⇒ diff ว่าง
--   ⇒ attemptAutoFaceSync() คืน "nothing to sync" ตั้งแต่ก่อนถึง syncFace()
--   ⇒ ทั้ง embedding และรูปที่โชว์ ค้างเป็นของเก่าไปเรื่อย ๆ
--
-- ทำไมต้องเป็น hash ไม่ใช่ mtime:
--   savePhoto() (blacklistImport.js:93) เขียนไฟล์ทับทุกรอบ import โดยไม่เทียบเนื้อ
--   ทั้ง mtime และ source_records.updated_at จึงขยับพร้อมกันทุกแถวทุกรอบ
--   วัดจริง 2026-08-22 — ไฟล์ต้นทางกับสำเนา md5 เดียวกันเป๊ะ แต่ mtime ห่างกัน 3 ชม.
--
-- ทำไมไม่ยกลูป embed ขึ้นมาไว้ก่อน early-return แบบที่ฝั่ง LPR ทำ:
--   ลูปฝั่ง LPR เป็นแค่ copyFileSync แต่ลูปฝั่งนี้เรียก embedPhoto() = ยิง HTTP
--   ไป edge หนึ่งครั้งต่อหนึ่งแถว การยกขึ้นมา = ยิง N ครั้งทุกรอบ import
--   ⇒ ใส่ลายนิ้วมือเข้าไปใน diff แทน ให้ "รูปเปลี่ยน" กลายเป็น update ตามปกติ
--
-- ผลพลอยได้: syncFace() เดิม embed **ทุกแถวที่ต้องการ** ทุกครั้งที่ sync (เพราะ
--   ตรวจจับการเปลี่ยนรูปไม่ได้) พอ diff มองเห็นรูปแล้ว จึงแคบลงเหลือเฉพาะ
--   add ∪ update — sync ที่แก้แค่ป้ายชื่อ ไม่ต้องยิง embed ทั้งชุดอีกต่อไป
--
-- ⚠️ แถวที่มีอยู่ก่อน column นี้จะได้ NULL ⇒ sync รอบแรกหลัง deploy จะถือว่า
--    "เปลี่ยน" แล้ว embed ใหม่หนึ่งรอบเพื่อเติมค่า (backfill ที่ตั้งใจ)
--    ตอนเขียน migration นี้ face_blacklist WHERE origin='blacklist_bridge' = 0 แถว
--
-- ⚠️ ค่านี้เขียนต่อเมื่อ embed สำเร็จเท่านั้น (COALESCE เหมือน embedding/ref_image)
--    ถ้าเขียนตอน embed พัง แถวจะอ้างว่ามีรูปใหม่แต่ถือ vector เก่า แล้วจะไม่มี
--    รอบไหน retry อีกเลย — เงียบและถาวร
-- ============================================================

ALTER TABLE face_blacklist ADD COLUMN IF NOT EXISTS photo_sha1 text;

COMMENT ON COLUMN face_blacklist.photo_sha1 IS
  'sha1 ของไฟล์รูปต้นทาง — ตัวเดียวที่บอกได้ว่าต้นทางแก้รูป (migration 169)';
