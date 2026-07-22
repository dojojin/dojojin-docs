-- Denormalize vehicle_type onto events (perf: avoids joining license_plates
-- in stats.js just to match Category Rules' vehicle_type — see #088).
-- Backfill is idempotent (AND e.vehicle_type IS NULL) — ~29s one-time on
-- ~900K existing anprAlarm rows, ~0 work on subsequent boots.
ALTER TABLE events ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(30);

UPDATE events e SET vehicle_type = lp.vehicle_type
  FROM license_plates lp
 WHERE lp.event_id = e.id AND lp.vehicle_type IS NOT NULL AND e.vehicle_type IS NULL;
