-- ============================================================
-- Vigil Platform — migration 107: blacklist auto-sync schedule + push options
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- Importing was manual only: somebody had to remember to press "นำเข้าเลย".
-- A watch list that is only as fresh as the last time an operator thought
-- about it is a watch list that quietly goes stale, and nothing on the page
-- says how stale it is.
--
-- Pull side (auto import):
--   pull_interval_hours   0 = off (the default — nothing starts running on its
--                         own because this migration ran)
--   last_auto_pull_at     stamped when a run STARTS, not when it finishes. A
--                         GuruSquare import takes 75-190s measured; stamping at
--                         the end would let a slow run re-trigger itself.
--
-- Push side (writing our corrections back into someone else's system):
--   push_types            which data types may be transmitted, empty = none.
--                         Separate from data_types: importing face+lpr and
--                         pushing back only face is a legitimate setup.
--   push_mode             'merge'   — add/update ours into theirs
--                         'replace' — make theirs match ours, DELETING remote
--                         rows we do not have. Column and gates exist; the
--                         transmitter refuses replace until it has been tested
--                         against a real DSS Pro in a scheduled window, because
--                         a fake server can prove the request is well-formed
--                         and cannot prove which rows a police system deletes.
--   push_auto_enabled     opt-in, and separate from push_enabled: being allowed
--                         to push at all, and pushing unattended on a timer,
--                         are two different decisions.
--
-- Changing push_mode revokes push_enabled (see the trigger below) so the
-- operator must re-accept the warning for the mode they are actually switching
-- to. Consent to merge is not consent to replace.
-- ============================================================

ALTER TABLE blacklist.sources
  ADD COLUMN IF NOT EXISTS pull_interval_hours integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_auto_pull_at   timestamptz,
  ADD COLUMN IF NOT EXISTS push_types          text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS push_mode           text        NOT NULL DEFAULT 'merge',
  ADD COLUMN IF NOT EXISTS push_auto_enabled   boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_interval_hours integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_auto_push_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_auto_push_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sources_push_mode_chk') THEN
    ALTER TABLE blacklist.sources
      ADD CONSTRAINT sources_push_mode_chk CHECK (push_mode IN ('merge','replace'));
  END IF;
END $$;

-- Enforced in the database, not only in the route: push_enabled is the gate
-- that says "an operator read the warning and accepted it". If the mode changes
-- underneath that acceptance, the acceptance no longer describes what would
-- happen, so it is withdrawn here rather than trusting every future caller to
-- remember. Same reason the check is a trigger and not application code — a
-- direct UPDATE from psql during an incident must not be able to turn merge
-- consent into replace consent.
CREATE OR REPLACE FUNCTION blacklist.revoke_push_consent_on_mode_change()
RETURNS trigger AS $$
BEGIN
  IF NEW.push_mode IS DISTINCT FROM OLD.push_mode THEN
    NEW.push_enabled      := FALSE;
    NEW.push_auto_enabled := FALSE;
    NEW.push_confirmed_at := NULL;
    NEW.push_confirmed_by := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_revoke_push_consent ON blacklist.sources;
CREATE TRIGGER trg_revoke_push_consent
  BEFORE UPDATE ON blacklist.sources
  FOR EACH ROW EXECUTE FUNCTION blacklist.revoke_push_consent_on_mode_change();

COMMENT ON COLUMN blacklist.sources.pull_interval_hours IS
  'รอบการนำเข้าอัตโนมัติ (ชั่วโมง) — 0 = ปิด';
COMMENT ON COLUMN blacklist.sources.push_mode IS
  'merge = เพิ่ม/แก้ไขที่ต้นทาง · replace = ทำให้ต้นทางเหมือนของเราทุกประการ (ลบของต้นทางที่เราไม่มี)';
COMMENT ON COLUMN blacklist.sources.push_types IS
  'ชนิดข้อมูลที่อนุญาตให้ส่งกลับต้นทาง — ว่าง = ไม่ส่งอะไรเลย';
