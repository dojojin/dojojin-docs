-- ============================================================
-- Migration 199: ดัชนีบางส่วนสำหรับแท็บ "ไม่ทราบทะเบียน" ในหน้า LPR
-- ------------------------------------------------------------
-- ปัญหา: GET /api/lpr/no-read (src/routes/lpr-query.js) นิยาม "ไม่ทราบทะเบียน"
--   ว่าเป็น event ชนิด anprAlarm ที่ไม่มีแถวคู่ใน license_plates จึงต้องใช้
--   NOT EXISTS ⇒ hash anti-join ทับ license_plates 5.6 ล้านแถวทุกครั้ง
--     หน้าต่าง 24 ชม.  count 0.55 วินาที
--     หน้าต่าง 7 วัน   count ≈ 38 วินาที   ← ปุ่มลัด "สัปดาห์/เดือน" บน UI ใช้ไม่ได้จริง
--
-- ทางแก้: เซตนั้นเท่ากับ "แถว anprAlarm ที่ raw_json->>'plate' ว่าง" พอดี
--   วัดจริง 2026-09-06 บน central (นับสองทาง ไม่ใช่แค่จำนวนเท่ากัน):
--     24 ชม.  19,637 = 19,637  · ต่างกัน 0 แถวทั้งสองทิศ
--     7 วัน  156,201 = 156,201 · ต่างกัน 0 แถวทั้งสองทิศ
--   ⇒ route เปลี่ยนไปใช้ predicate ตัวนี้ตรง ๆ ซึ่ง "index ได้" (anti-join index ไม่ได้)
--
-- ⚠️ ข้อความ predicate ต้องตรงกันเป๊ะ 3 ที่ (Postgres จับคู่ partial index จาก
--    expression tree — เขียนต่างกันเมื่อไหร่ planner เลิกใช้ดัชนีนี้เงียบ ๆ):
--      1) ไฟล์นี้
--      2) scripts/create-face-blacklist-index.js → INDEXES.anpr_noread.pred
--      3) src/routes/lpr-query.js → /api/lpr/no-read (มี alias e. นำหน้า ซึ่งไม่ต่างกัน)
--
-- ⚠️ ทำไมไฟล์นี้ไม่มี CONCURRENTLY (เหตุผลเดียวกับ migration 157/167):
--   migrate.js ห่อทุก migration ด้วย BEGIN/COMMIT (src/migrate.js:79-87)
--   แต่ CREATE INDEX CONCURRENTLY รันใน transaction block ไม่ได้ → error
--   ⇒ ไฟล์นี้สำหรับ "ติดตั้งใหม่" ที่ตารางยังเล็ก สร้างเสร็จในไม่กี่มิลลิวินาที
--
-- ⚠️ และ events เป็น partitioned table — CREATE INDEX CONCURRENTLY บน parent
--   ทำไม่ได้เลยแม้อยู่นอก transaction (Postgres 16: "cannot create index on
--   partitioned table concurrently") ⇒ บน production ที่ตารางใหญ่แล้วต้อง
--   **รันสคริปต์ก่อน** (3 ขั้น: ลูกทีละตัว → แม่แบบ ON ONLY → ATTACH):
--
--     set -a; . ./src/.env; set +a
--     node scripts/create-face-blacklist-index.js --index=anpr_noread --dry-run
--     node scripts/create-face-blacklist-index.js --index=anpr_noread
--
--   ทำแล้ว migration นี้จะกลายเป็น no-op บน production เพราะ IF NOT EXISTS
--
-- ⚠️ เกณฑ์ว่างานเสร็จคือ indisvalid = true ไม่ใช่ "สร้างครบทุกพาร์ทิชัน" — แม่แบบจะยัง
--    invalid อยู่จนกว่าจะ ATTACH ครบ และ planner ไม่ใช้ดัชนีที่ invalid
--      SELECT indisvalid FROM pg_index
--       WHERE indexrelid = 'idx_events_anpr_noread_time'::regclass;
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_anpr_noread_time
  ON events (event_time DESC, id DESC)
  WHERE event_type = 'anprAlarm' AND COALESCE(raw_json->>'plate','') = '';

COMMENT ON INDEX idx_events_anpr_noread_time IS
  'แท็บไม่ทราบทะเบียนหน้า LPR — แทน anti-join license_plates 5.6 ล้านแถว (migration 199)';
