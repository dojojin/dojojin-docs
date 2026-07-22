-- Migration 080: backfill events.object_class for anprAlarm from license_plates.vehicle_type
-- object_class was never written for LPR events (lpr-core.js's INSERT INTO events
-- omitted it entirely), so any event_category_rules mapping rule filtering by
-- Object Class silently counted 0 forever (found 2026-07-06 — a "รถบัสทั้งหมด"
-- category rule with object_class=Bus never matched a single anprAlarm row).
-- Real vehicle-type data already existed in license_plates.vehicle_type, just
-- under Hikvision's own vocabulary (largeBus/twoWheelVehicle/...) instead of
-- the Car/Truck/Bus/... vocabulary the mapping-rule UI + Events page facet use.
-- Backfills existing rows to match the ingest-side fix (lpr-core.js's
-- VEHICLE_TYPE_TO_CLASS). Idempotent: only touches rows still NULL.

UPDATE events e
   SET object_class = CASE lp.vehicle_type
         WHEN 'largeBus'          THEN 'Bus'
         WHEN 'truck'             THEN 'Truck'
         WHEN 'pickupTruck'       THEN 'Truck'
         WHEN 'van'               THEN 'Van'
         WHEN 'twoWheelVehicle'   THEN 'Motorcycle'
         WHEN 'threeWheelVehicle' THEN 'Motorcycle'
         WHEN 'SUVMPV'            THEN 'Car'
         WHEN 'vehicle'           THEN 'Vehicle'
         WHEN 'buggy'             THEN 'Vehicle'
         WHEN 'pedestrian'        THEN 'Pedestrian'
         ELSE NULL
       END
  FROM license_plates lp
 WHERE lp.event_id = e.id
   AND e.event_type = 'anprAlarm'
   AND e.object_class IS NULL
   AND lp.vehicle_type IS NOT NULL;
