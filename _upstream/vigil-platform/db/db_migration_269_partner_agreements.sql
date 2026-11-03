-- ============================================================
-- Vigil Platform — Migration 269: ทะเบียนข้อตกลงข้อมูลของ partner (เหตุผล / ฐานทางกฎหมาย / DPA / ผู้อนุมัติ / ครบทบทวน)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ระยะ 2 ของ OpenAPI (แนวทาง "ให้ตามความจำเป็น") — เรากำหนดชุดข้อมูลให้ partner เอง จึงต้องมีที่บันทึกว่า
-- "ให้เพราะอะไร ใครอนุมัติ ถึงเมื่อไร" ไม่งั้นตอน partner ขอเพิ่มหรือถูกตรวจสอบจะไม่มีอะไรอ้างอิง
-- เก็บเป็นเวอร์ชัน (แถวใหม่ทุกครั้งที่บันทึก ไม่แก้ทับ) พร้อมภาพสิทธิ์คอลัมน์ ณ ตอนนั้น
-- partner ไม่เห็นตารางนี้ (ไม่มี GRANT ให้ role ใดนอกจาก owner)
--
-- และถอนสิทธิ์ SELECT ทั้ง view ที่ค้างอยู่กับกลุ่ม third_party_readonly (ไม่มีสมาชิกแล้วตั้งแต่ migration 268)
-- กันกรณีมีคนเพิ่มสมาชิกกลุ่มนี้ในอนาคตแล้วได้ทุกคอลัมน์รวมที่จะเพิ่มทีหลัง
-- ============================================================

CREATE TABLE IF NOT EXISTS api_consumer_agreements (
  id           BIGSERIAL PRIMARY KEY,
  consumer_id  BIGINT NOT NULL REFERENCES api_consumers(id) ON DELETE CASCADE,
  version      INT    NOT NULL,
  purpose      TEXT   NOT NULL,
  legal_basis  TEXT   NOT NULL,
  dpa_ref      TEXT,
  approved_by  TEXT   NOT NULL,
  valid_until  DATE,
  review_due   DATE   NOT NULL,
  grants       JSONB  NOT NULL DEFAULT '{}'::jsonb,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consumer_id, version)
);
CREATE INDEX IF NOT EXISTS idx_api_agreements_review ON api_consumer_agreements (review_due);

DO $$
DECLARE v text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'third_party_readonly') THEN
    FOR v IN SELECT DISTINCT table_name FROM information_schema.role_table_grants WHERE grantee = 'third_party_readonly' AND table_schema = 'public' LOOP
      EXECUTE format('REVOKE ALL ON %I FROM third_party_readonly', v);
    END LOOP;
  END IF;
END $$;
