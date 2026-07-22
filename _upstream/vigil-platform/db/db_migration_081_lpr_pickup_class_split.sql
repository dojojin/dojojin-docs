-- Migration 081: split "Pickup" out of "Truck" for anprAlarm events
-- Migration 080 mapped Hikvision's pickupTruck vehicle_type into the same
-- object_class="Truck" as the generic truck type, so a "รถกระบะ" (pickup)
-- mapping rule couldn't be distinguished from "รถบรรทุก" (truck) - and pickups
-- are the larger share (17,735 vs 4,996 rows, confirmed 2026-07-06). Added a
-- dedicated "Pickup" object_class (ingest-side: lpr-core.js's
-- VEHICLE_TYPE_TO_CLASS). Idempotent: only touches rows still tagged Truck
-- whose underlying vehicle_type is actually pickupTruck.

UPDATE events e
   SET object_class = 'Pickup'
  FROM license_plates lp
 WHERE lp.event_id = e.id
   AND e.event_type = 'anprAlarm'
   AND e.object_class = 'Truck'
   AND lp.vehicle_type = 'pickupTruck';
