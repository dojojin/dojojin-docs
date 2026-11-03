-- ============================================================
-- Migration 168: ดัชนีบางส่วนสำหรับแท็บ "จดจำใบหน้า" (?hits_only=1)
-- ------------------------------------------------------------
-- ต่อจาก migration 167 ซึ่งครอบเฉพาะ list_type=blackList — แท็บจดจำใบหน้ากรองกว้างกว่า
-- (listType อะไรก็ได้ ขอแค่ไม่ NULL) จึงไม่เข้า predicate ของตัวนั้น
--
-- ปัญหา (วัดผ่าน API จริง 2026-08-21):
--     GET /api/face-matches?hits_only=1&limit=60  →  120 วินาที (ชน statement_timeout)
--
-- มีสองต้นทุนซ้อนกัน แก้คนละทาง:
--   1) COUNT(*) OVER() ในตัว query หลัก — บังคับประเมิน SELECT list ทั้งหมด (รวม
--      correlated subquery ref_photo) ครบทุกแถวก่อน LIMIT · แก้โดยแยกการนับออกมา
--      เป็น query ของตัวเอง (ดู routes/faces.js) ⇒ ?limit=60 จาก 120 วิ. เหลือ 0.075 วิ.
--   2) การหาแถวที่ listType IS NOT NULL ต้องอ่าน heap ทีละแถวเพราะอยู่ใน jsonb
--      ⇒ ดัชนีนี้ · วัดเฉพาะ query หลัก: 12.8 วินาที → 1.27 วินาที
--
-- ผลรวมหลังแก้ทั้งสองทาง:
--     ?limit=60          120 วิ. → 0.075 วิ.
--     ?hits_only=1       120 วิ. → 2.03 วิ.
--     ?misses_only=1     120 วิ. → 5.23 วิ.
--     ?list_type=blackList        0.14 วิ. (ใช้ดัชนีของ migration 167)
--   ขนาดดัชนีรวมทุกพาร์ทิชัน 280 kB
--
-- ดัชนีนี้ครอบชุดของ migration 167 โดยปริยาย (blackList ⊂ NOT NULL) แต่ตัวนั้นเล็กกว่า
-- และเจาะจงกว่า — ปล่อยให้ planner เลือกเองว่าจะใช้ตัวไหนกับ query ไหน
--
-- ⚠️ วิธีสร้างบน production เหมือน migration 167 ทุกประการ (events เป็น partitioned
--    table · CONCURRENTLY บน parent ทำไม่ได้) — สคริปต์ตัวเดียวกันดูแลทั้งสองดัชนี:
--      set -a; . ./src/.env; set +a
--      node scripts/create-face-blacklist-index.js --index=hits
--    ทำแล้วบน central 2026-08-21 — 60.4 วินาที · ingest ไม่สะดุด (2,705 แถว/3 นาที)
--
-- ⚠️ รอบแรกชน deadlock ตอนสร้างบน events_y2026m08 (พาร์ทิชันเดือนปัจจุบันที่ ingest
--    กำลังเขียนอยู่) แล้วทิ้งดัชนีสถานะ INVALID ไว้ — สคริปต์ตรวจและลบทิ้งก่อนลองใหม่
--    ให้แล้ว แต่ถ้าทำมือต้องระวังจุดนี้: ดัชนี INVALID มีชื่ออยู่จริงแต่ planner ไม่ใช้
--      SELECT c.relname, i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
--       WHERE c.relname LIKE 'idx_events_face_haslist%' AND NOT i.indisvalid;
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_face_haslist_time
  ON events (event_time DESC, id DESC)
  WHERE event_type IN ('FaceRecognition','FaceDetector/Comparison')
    AND COALESCE(raw_json->>'listType', raw_json->>'list_type', raw_json->>'hcp_list_type') IS NOT NULL;

COMMENT ON INDEX idx_events_face_haslist_time IS
  'แท็บจดจำใบหน้า hits_only — query หลัก 12.8 วิ. เหลือ 1.27 วิ. (migration 168)';
