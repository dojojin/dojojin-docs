-- ============================================================
-- Vigil Platform — Migration 262: แจ้งทันทีเมื่อรายการเฝ้าระวังเปลี่ยน (pg_notify 'watchlist_changed')
-- ------------------------------------------------------------
-- เดิม: api-server อ่านรายการป้ายใหม่ทุก 5 นาที · face-embed-worker ทุก 60 วินาที · แคชสถิติตาม TTL
-- → เปลี่ยนกลุ่มเป็น "เฉพาะ Site" แล้ว LINE ยังยิงข้ามไซต์ได้อีกถึง 5 นาที (เจ้าของขอให้เร็วขึ้น 2026-10-14)
-- trigger ระดับ STATEMENT (ไม่ใช่ ROW) — bridge sync เขียนหลายร้อยแถวก็แจ้งครั้งเดียวต่อคำสั่ง
-- ครอบทุกทางที่เขียน (หน้าเว็บ · bridge · LINE command · psql) ไม่ต้องจำใส่ notify ในโค้ดทุกจุด
-- payload = ชื่อตาราง ให้ผู้ฟังเลือกเฉพาะที่เกี่ยว · ผู้ฟังหลุด = กลับไปใช้รอบเวลาเดิม ไม่มีอะไรพัง
-- idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS
-- ============================================================

CREATE OR REPLACE FUNCTION notify_watchlist_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('watchlist_changed', TG_TABLE_NAME);
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lpr_watchlist', 'lpr_watchlist_groups', 'face_blacklist', 'face_blacklist_groups'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_changed ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I
                    FOR EACH STATEMENT EXECUTE FUNCTION notify_watchlist_changed()', t, t);
  END LOOP;
END $$;
