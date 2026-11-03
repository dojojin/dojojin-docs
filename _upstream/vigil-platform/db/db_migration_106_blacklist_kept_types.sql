-- ============================================================
-- Vigil Platform — migration 106: blacklist source retained types
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- Deselecting a data type on an import connection left its records behind with
-- nothing to say so. Found live on 2026-07-31: source #2 "Dahua DSS Pro — Site
-- HDY" is set to {face} only, yet still holds 516 lpr records — 32% of the
-- entire plate roster — and they were still listed to operators and still
-- matched alerts, because the roster query filters on the record's own
-- data_type and never asks whether the owning source still imports that type.
--
-- kept_types is the operator's explicit answer to "you removed LPR, what about
-- the 516 records already imported?". A type listed here stays visible even
-- though it is no longer imported. Anything neither imported nor kept is
-- hidden — which is what makes today's orphans disappear without deleting a
-- single row, and makes them reappear the moment the type is re-selected.
--
-- Hiding rather than deleting is the default on purpose: this is watch-list
-- data with potential evidentiary weight, and the reversible choice belongs in
-- the default path. Deletion stays available but is a deliberate act.
-- ============================================================

ALTER TABLE blacklist.sources
  ADD COLUMN IF NOT EXISTS kept_types text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN blacklist.sources.kept_types IS
  'ชนิดข้อมูลที่เลิกนำเข้าแล้วแต่ผู้ใช้เลือกให้แสดงต่อ — ชนิดที่ไม่อยู่ทั้งใน data_types และ kept_types จะถูกซ่อน (ไม่ได้ลบ)';
