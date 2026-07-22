-- ============================================================
-- Vigil Platform — Migration 059: face system settings (FACE-UI FP6)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- ============================================================
-- Seeds the KV rows so PUT /api/settings/:key (UPDATE-only) can edit them and
-- GET returns them. Data-only insert (no schema change) — boot-safe, idempotent.
--   face_similarity_min  — % below which a recognition is treated as "ไม่พบ" (miss),
--                          applied at QUERY time (reversible; history unchanged).
--   face_show_expression — '1'/'0' UI toggle: hide expression chart + chips when '0'.
INSERT INTO system_settings (key, value, description) VALUES
  ('face_similarity_min',  '80', 'Face recognition min similarity % (below = treated as miss at query time)'),
  ('face_show_expression', '1',  'Show face expression/emotion chart + chips (1=on, 0=off)')
ON CONFLICT (key) DO NOTHING;
