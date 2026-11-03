-- ============================================================
-- Vigil Platform — Migration 266: ลิงก์สั้น + บันทึกการกดเปิดไฟล์ (upl.dojojin.tech)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เจ้าของสั่ง 2026-10-17: ลิงก์สั้น + ดูว่าใครกด กดด้วยโปรแกรมอะไร รายละเอียดรายไฟล์
-- • ลิงก์อยู่ในตารางของตัวเอง (ไฟล์หนึ่งมีได้หลายลิงก์) — ทำ "ลิงก์ต่อผู้รับ" ได้ = ทางเดียวที่รู้ได้จริงว่า
--   ใครเปิด เพราะ upl. ไม่มี session (โดยตั้งใจ) จึงรู้แค่ IP · ประเทศ · user agent
-- • รูปแบบลิงก์: /pub/fil/<code 8 ตัว a-z0-9> — Cloudflare ปล่อยเข้า origin เฉพาะ pub/fil/* (ตรวจ 17 ต.ค.: /s/ ตอบ 404
--   จาก Cloudflare เอง) · regex ต้องตรงกันสองที่: api-server.js (FILES_HOST) + routes/media-files.js
-- • เก็บ user agent ดิบ แยกโปรแกรม/เบราว์เซอร์/OS ตอนอ่าน (helpers/uaInfo.js) แก้ตัวแยกได้โดยไม่เสียประวัติ
-- • ภาพพรีวิวตอนโพสต์ลง Social (Open Graph): public_files.og_title / og_description / og_image (ชื่อไฟล์ภาพ 1200×630
--   ใน files/) · เสิร์ฟที่ /pub/fil/<code>.png · ไฟล์ HTML สร้างภาพอัตโนมัติด้วย headless Chrome (helpers/filePreview.js)
-- • PDPA: IP + UA เป็นข้อมูลส่วนบุคคล — อ่านได้เฉพาะ admin · ลบเกิน 180 วัน (auth.cleanupExpired)
-- ============================================================

CREATE TABLE IF NOT EXISTS public_file_links (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  file_id     INT NOT NULL REFERENCES public_files(id) ON DELETE CASCADE,
  label       TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_public_file_links_file ON public_file_links (file_id);

CREATE TABLE IF NOT EXISTS public_file_clicks (
  id          BIGSERIAL PRIMARY KEY,
  file_id     INT NOT NULL REFERENCES public_files(id) ON DELETE CASCADE,
  link_id     INT REFERENCES public_file_links(id) ON DELETE SET NULL,
  via         TEXT NOT NULL,          -- 'short' | 'signed'
  status      SMALLINT NOT NULL,      -- 200 · 410 (เพิกถอน/หมดอายุ)
  clicked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  country     TEXT,
  user_agent  TEXT,
  referer     TEXT
);
CREATE INDEX IF NOT EXISTS idx_public_file_clicks_file_time ON public_file_clicks (file_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_file_clicks_time ON public_file_clicks (clicked_at);

-- ไฟล์เดิมทุกไฟล์ได้ลิงก์สั้นหนึ่งอัน (ตารางเล็ก หลักสิบแถว) · md5 = ตัวอักษร 0-9a-f อยู่ในชุด [a-z0-9]
INSERT INTO public_file_links (code, file_id, created_by)
SELECT substr(md5(random()::text || f.id::text || clock_timestamp()::text), 1, 8), f.id, 'migration'
  FROM public_files f
 WHERE NOT EXISTS (SELECT 1 FROM public_file_links l WHERE l.file_id = f.id);

ALTER TABLE public_files ADD COLUMN IF NOT EXISTS og_title TEXT;
ALTER TABLE public_files ADD COLUMN IF NOT EXISTS og_description TEXT;
ALTER TABLE public_files ADD COLUMN IF NOT EXISTS og_image TEXT;
