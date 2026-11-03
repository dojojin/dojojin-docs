-- ============================================================
-- Migration: HCP person id on face_blacklist
-- Lets HCP-sourced blacklist face-match events resolve a reference
-- snapshot via face_blacklist -> enrolled_ref -> face_embeddings.event_id
-- -> events.raw_json->>'_snapshot' (matched by HCP person id).
-- Idempotent.
-- ============================================================

ALTER TABLE face_blacklist
  ADD COLUMN IF NOT EXISTS hcp_person_id TEXT;
CREATE INDEX IF NOT EXISTS idx_face_blacklist_hcp_person_id ON face_blacklist(hcp_person_id);
