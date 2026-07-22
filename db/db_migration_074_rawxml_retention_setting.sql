-- ============================================================
-- Vigil Platform — migration 074: rawXml retention setting (class D)
-- Time window after which the raw Hik ANPR XML slice is stripped from events
-- (row + parsed columns kept). Default 90 days — a safety net: a newly-enabled
-- camera analytic has this long to be noticed + columnised before its rawXml
-- ages out. Enforced by enforceRawXmlRetention() in api-server.js.
-- Idempotent.
-- ============================================================

INSERT INTO system_settings (key, value)
VALUES ('rawxml_retention_days', '90')
ON CONFLICT (key) DO NOTHING;
