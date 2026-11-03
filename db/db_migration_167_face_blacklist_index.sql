-- ============================================================
-- Migration 167: ดัชนีบางส่วนสำหรับแถบ "บุคคลเฝ้าระวัง" ในหน้าข้อมูลใบหน้า
-- ------------------------------------------------------------
-- ปัญหา (วัดผ่านเบราว์เซอร์จริง 2026-08-21 · events 23.9 ล้านแถว / 58 GB / 25 partition):
--     เปิดหน้า "ข้อมูลใบหน้า" แล้วรอ ~14 วินาทีกว่าจะนิ่ง
--     ตัวหนักคือ GET /api/face-matches?list_type=blackList&limit=8 = 11,481ms
--
-- query ขอแค่ 8 แถว แต่ต้องอ่าน buffer 91,103 บล็อก (~700 MB) เพราะ:
--   · เงื่อนไข listType อยู่ใน raw_json (jsonb) ไม่มีดัชนีรองรับ
--   · จึงไล่ Index Scan บน event_type แล้วอ่าน heap มากรอง — ทิ้งแถวไป
--     19,262 (m08) + 16,585 (m07) เพื่อเก็บของจริงเพียง 1,715 แถวทั้งฐาน
--
-- ⚠️ commit 9c7ff56 เขียนไว้ว่าดัชนีนี้ลด buffer เหลือ 59,301 — **ตัวเลขนั้นผิด**
--    (อ่านแผนผิดบรรทัด) ของจริงวัดซ้ำแล้วคือ:
--
--     ก่อน  buffers 91,103 · Execution 75.8ms (warm) · 11,481ms (cold ตอนเปิดหน้า)
--     หลัง  buffers     38 · Execution  0.5ms (warm) ·    239ms (cold ตอนเปิดหน้า)
--     ขนาดดัชนีรวมทุกพาร์ทิชัน 280 kB
--
-- ขอบเขตของการแก้ — ดัชนีนี้ช่วยเฉพาะ query ที่มีเงื่อนไข list_type เท่านั้น
--   · แถบ "บุคคลเฝ้าระวัง" ในหน้าภาพรวม        → เร็วขึ้น
--   · hits_only=1 / misses_only=1 / ไม่ใส่ตัวกรอง → ไม่เข้า predicate ยังช้าเหมือนเดิม
--   นี่คือการแก้แถบเดียว ไม่ใช่การแก้ทั้ง endpoint
--
-- ⚠️ ทำไมไฟล์นี้ไม่มี CONCURRENTLY (เหตุผลเดียวกับ migration 157):
--   migrate.js ห่อทุก migration ด้วย BEGIN/COMMIT (src/migrate.js:79-87)
--   แต่ CREATE INDEX CONCURRENTLY รันใน transaction block ไม่ได้ → error
--   ⇒ ไฟล์นี้สำหรับ "ติดตั้งใหม่" ที่ตารางยังเล็ก สร้างเสร็จในไม่กี่มิลลิวินาที
--
-- ⚠️ และ events เป็น partitioned table — CREATE INDEX CONCURRENTLY บน parent
--   ทำไม่ได้เลยแม้อยู่นอก transaction (Postgres 16: "cannot create index on
--   partitioned table concurrently") ⇒ บน production ที่ตารางใหญ่แล้วต้องใช้
--   สคริปต์ที่ทำ 3 ขั้น (ลูกทีละตัว → แม่แบบ ON ONLY → ATTACH):
--
--     set -a; . ./src/.env; set +a
--     node scripts/create-face-blacklist-index.js --dry-run   # ดูแผนก่อน
--     node scripts/create-face-blacklist-index.js
--
--   ทำแล้วบน central 2026-08-21 — 59.8 วินาที · ingest ไม่สะดุด
--   (นับรายนาทีตลอดช่วง: 1,075–1,260 แถว/นาที สม่ำเสมอ)
--   migration นี้จะกลายเป็น no-op เพราะ IF NOT EXISTS
--
-- ⚠️ เกณฑ์ว่างานเสร็จคือ indisvalid = true ไม่ใช่ "สร้างครบ 25 ตัว" — แม่แบบจะยัง
--    invalid อยู่จนกว่าจะ ATTACH ครบทุกพาร์ทิชัน และ planner ไม่ใช้ดัชนีที่ invalid
--      SELECT indisvalid FROM pg_index
--       WHERE indexrelid = 'idx_events_face_blacklist_time'::regclass;
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_face_blacklist_time
  ON events (event_time DESC, id DESC)
  WHERE event_type IN ('FaceRecognition','FaceDetector/Comparison')
    AND COALESCE(raw_json->>'listType', raw_json->>'list_type', raw_json->>'hcp_list_type') = 'blackList';

COMMENT ON INDEX idx_events_face_blacklist_time IS
  'แถบบุคคลเฝ้าระวังหน้าข้อมูลใบหน้า — 91,103 buffer เหลือ 38 (migration 167)';
