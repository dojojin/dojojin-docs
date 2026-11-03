-- ============================================================
-- Migration 219: คำสั่ง "สถานะกล้องบน HikCentral (HCP)"
-- ------------------------------------------------------------
-- เจ้าของสั่ง 2026-09-09: "สรุปสถานะ กล้องบน HCP รายงานเฉพาะกล้องที่ดับมาหน่อย"
--
-- คนละชุดกับคำสั่ง "กล้องออฟไลน์" ของเราโดยตั้งใจ:
--   camera_offline     = ดูจาก last_seen_at ของ event ที่ไหลเข้าระบบเรา
--   hcp_camera_status  = สิ่งที่ HCP มองเห็น (รวมกล้องที่ HCP ดูแลอยู่ตัวเดียว)
-- สองเลขไม่มีทางเท่ากันและไม่ควรเท่า ⇒ ต้องเป็นคนละคำสั่ง และการ์ดเขียนที่มาไว้เสมอ
--
-- ⚠️ endpoint เป็น requireAdmin และเป็นภูเก็ตที่เดียว — บัญชีที่ผูกไว้ไม่ใช่ admin
-- จะได้คำตอบว่าไม่มีสิทธิ์ ซึ่งถูกต้องแล้ว ไม่ใช่ให้เลี่ยงด้วย X-Internal-Token
--
-- คำว่า "สถานะกล้อง" เป็นคำเรียกของ camera_offline ด้วย ⇒ กัน hcp ออกจากตัวนั้น
-- ไม่งั้นสองคำสั่งคะแนนสูสีแล้วบอทถามกลับทุกครั้งที่พิมพ์คำว่า HCP
-- ============================================================

INSERT INTO line_commands
  (key, label, source_key, triggers, require_all, exclude, fixed_params, slots, required_slots, reply_title)
VALUES
  ('hcp_camera_status', 'สถานะกล้องบน HikCentral', 'hcp_camera_status',
   '["hcp","hikcentral","กล้องบน hcp","สถานะกล้อง hcp","กล้อง hcp"]'::jsonb,
   '[]'::jsonb, '[]'::jsonb,
   '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'สถานะกล้องบน HikCentral')
ON CONFLICT (key) DO NOTHING;

UPDATE line_commands SET exclude = exclude::jsonb || '["hcp","hikcentral"]'::jsonb,
       updated_at = now()
 WHERE key = 'camera_offline';
