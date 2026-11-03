-- ============================================================
-- Migration 201: คำสั่งผ่าน LINE — ใครสั่งได้ · คำสั่งอะไรบ้าง · ปูมการใช้
-- ------------------------------------------------------------
-- หลักคิด (ออกแบบไว้ 2026-09-08): คำสั่งใน LINE = ยิง endpoint เดิมของระบบ
-- **ในนามของผู้ใช้จริงคนหนึ่ง** ⇒ ขอบเขตไซต์ · สิทธิ์ระดับหน้า · การกันเขียนของ
-- auditor · audit_log ได้มาทั้งชุดโดยไม่ต้องสร้างระบบสิทธิ์ที่สอง
--
-- ยืนยันแล้วว่าทำได้จริง: 2026-09-08 19:01 LINE ส่ง `source.userId` มาให้เมื่อพิมพ์
-- ในกลุ่ม (log `[webhook-shape] src=group hasUserId=true`) ⇒ แยกออกว่าใครสั่ง
--
-- ⚠️ `line_commands.source_key` ต้องตรงกับคีย์ในทะเบียน `src/line-answer-sources.js`
--    ซึ่งอยู่ใน **โค้ด ไม่ใช่ DB** โดยตั้งใจ — ถ้าเก็บ URL ไว้ใน DB ให้คนตั้งเอง
--    มันจะกลายเป็นช่องยิง request ภายใน (เหตุผลเดียวกับ view-registry.js)
-- ============================================================

-- ── ใครสั่งได้ ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_operators (
  line_user_id  text PRIMARY KEY,                                   -- U… จาก source.userId
  display_name  text,
  -- บัญชีที่ยืมสิทธิ์มาใช้ตอนรันคำสั่ง · ลบบัญชี = ผู้สั่งใช้งานไม่ได้ทันที (SET NULL
  -- แล้วตัวรันปฏิเสธ) ไม่ใช่กลายเป็นไม่จำกัดสิทธิ์
  user_id       integer REFERENCES users(id) ON DELETE SET NULL,
  enabled       boolean NOT NULL DEFAULT true,
  -- NULL = สั่งได้ทุกห้องที่บอทอยู่ · array ของ id ห้อง = เฉพาะห้องที่ระบุ
  -- (กลุ่มที่มีคนนอกองค์กรอยู่ ไม่ควรถามข้อมูลบุคคลได้)
  allow_in      jsonb,
  note          text,
  added_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

-- ── คำสั่งที่เจ้าของนิยามเอง ───────────────────────────────────
CREATE TABLE IF NOT EXISTS line_commands (
  id            bigserial PRIMARY KEY,
  key           text UNIQUE NOT NULL,
  label         text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  source_key    text NOT NULL,
  -- คำที่ใช้เรียก · คำยาวมีน้ำหนักกว่าคำสั้นตอนให้คะแนน ("หมวกนิรภัย" ชนะ "หมวก")
  triggers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  require_all   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ต้องมีครบ ไม่งั้นไม่นับ
  exclude       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- มีคำนี้ = ไม่ใช่คำสั่งนี้
  fixed_params  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- ค่าตายตัวของคำสั่งนี้
  slots         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ช่องที่ให้ดึงจากประโยค
  reply_title   text,
  min_role      text NOT NULL DEFAULT 'viewer',
  cooldown_sec  integer NOT NULL DEFAULT 10,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── ปูมการใช้ ────────────────────────────────────────────────
-- ตอบให้ได้ว่า "ใครสั่งอะไร จับได้เป็นคำสั่งไหน ตีความช่วงเวลาเป็นอะไร ได้อะไรกลับ"
-- แถว status='no_match' คือวัตถุดิบที่เจ้าของเอาไปเพิ่มคำเรียกในหน้าตั้งค่า
CREATE TABLE IF NOT EXISTS line_command_log (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  line_user_id  text,
  operator_name text,
  source_type   text,
  source_id     text,
  text_in       text,
  matched_key   text,
  match_score   numeric,
  slots         jsonb,
  status        text NOT NULL,   -- ok|no_match|ambiguous|denied|rate_limited|error
  http_status   integer,
  rows_out      integer,
  ms            integer,
  error         text
);

CREATE INDEX IF NOT EXISTS idx_line_cmd_log_at     ON line_command_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_line_cmd_log_status ON line_command_log (status, at DESC);

-- ── คำสั่งตั้งต้น 4 ตัว (P2) ────────────────────────────────────
-- ON CONFLICT DO NOTHING: เจ้าของแก้คำเรียกเองแล้ว migration ที่รันซ้ำต้องไม่ทับ
INSERT INTO line_commands (key, label, source_key, triggers, require_all, exclude, fixed_params, slots, reply_title)
VALUES
  ('helmet_count', 'ยอดผู้ไม่สวมหมวกนิรภัย', 'helmet_count',
   '["ไม่สวมหมวก","ไม่ใส่หมวก","หมวกนิรภัย","หมวกกันน็อค","helmet"]'::jsonb,
   '[]'::jsonb, '["ป้าย","อันดับ","มากสุด","เยอะสุด","บ่อย"]'::jsonb,
   '{}'::jsonb, '["period","site"]'::jsonb, 'ผู้ไม่สวมหมวกนิรภัย'),

  ('helmet_top', 'อันดับป้ายที่ไม่สวมหมวกนิรภัย', 'helmet_top',
   '["ไม่สวมหมวก","หมวกนิรภัย","หมวกกันน็อค","helmet"]'::jsonb,
   '["ป้าย"]'::jsonb, '[]'::jsonb,
   '{}'::jsonb, '["period","limit","site"]'::jsonb, 'ป้ายที่ไม่สวมหมวกนิรภัยบ่อยที่สุด'),

  ('violation_top', 'อันดับป้ายที่ฝ่าฝืน', 'violation_top',
   '["ฝ่าฝืน","กระทำผิด","ทำผิด","violation"]'::jsonb,
   '[]'::jsonb, '[]'::jsonb,
   '{}'::jsonb, '["period","limit","site"]'::jsonb, 'ป้ายที่ฝ่าฝืนมากที่สุด'),

  ('lpr_count', 'ยอดอ่านป้ายทะเบียน', 'lpr_count',
   '["อ่านป้าย","ยอดรถ","จำนวนรถ","ทะเบียนที่อ่านได้","อ่านไม่ได้"]'::jsonb,
   '[]'::jsonb, '["ฝ่าฝืน","หมวก","อันดับ"]'::jsonb,
   '{}'::jsonb, '["period","site"]'::jsonb, 'ยอดอ่านป้ายทะเบียน')
ON CONFLICT (key) DO NOTHING;
