-- ============================================================
-- Migration 165 — per-camera object trail overlay
-- ============================================================
-- overlay_show_bbox (migration 043) turns on the box around the
-- object. This is its sibling for the path the object took to
-- get there, kept separate on purpose: a box marks WHICH object
-- the event is about, while a trail says where it came from, and
-- an operator may well want one without the other. Sharing one
-- switch would force a choice nobody asked for.
--
-- Default FALSE, unlike overlay_show_bbox which defaults TRUE:
-- the box replaced something the camera used to draw, so leaving
-- it on preserves what people already saw. The trail is new
-- decoration on a scene that currently has none, and adding
-- marks to every camera's images without being asked is not our
-- call to make.
--
-- Only cameras whose events carry a path can draw one — today
-- that is Bosch with meta_crop on, because the geometry comes
-- from the ONVIF metadata track (migration 164). The flag is
-- harmless everywhere else.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS overlay_show_trail BOOLEAN DEFAULT FALSE;

UPDATE cameras SET overlay_show_trail = FALSE WHERE overlay_show_trail IS NULL;
