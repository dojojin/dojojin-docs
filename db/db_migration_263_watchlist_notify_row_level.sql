-- ============================================================
-- Vigil Platform — Migration 263: trigger ของ watchlist_changed เป็นระดับแถว
-- ------------------------------------------------------------
-- 262 ใช้ FOR EACH STATEMENT ซึ่งยิง "ทุกคำสั่ง" แม้ไม่มีแถวเปลี่ยน — mqtt-subscriber รัน
-- `UPDATE face_blacklist SET hcp_person_id ... WHERE label = $2 AND hcp_person_id IS DISTINCT FROM $1`
-- ทุกเหตุการณ์ใบหน้าของ HCP ที่มีชื่อ (ส่วนใหญ่ 0 แถว) → face worker โหลดโรสเตอร์ใหม่ทุกครั้งโดยเปล่าประโยชน์
-- FOR EACH ROW ยิงเฉพาะเมื่อมีแถวเปลี่ยนจริง · Postgres รวม NOTIFY ที่ channel+payload ซ้ำกันใน transaction
-- เดียวเหลือครั้งเดียว ⇒ bridge sync หลายร้อยแถวยังแจ้งครั้งเดียวเหมือนเดิม
-- TRUNCATE ต้องเป็นระดับ statement (ROW ไม่รองรับ) จึงแยกเป็น trigger ที่สอง
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
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_truncated ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_changed AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION notify_watchlist_changed()', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_truncated AFTER TRUNCATE ON %I
                    FOR EACH STATEMENT EXECUTE FUNCTION notify_watchlist_changed()', t, t);
  END LOOP;
END $$;
