-- migration 047: add list_types filter to alert_rules
-- Allows a rule to match only specific FaceRecognition list types
-- (e.g. blackList only). NULL = no filter (all list types pass).
ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS list_types text[] DEFAULT NULL;
