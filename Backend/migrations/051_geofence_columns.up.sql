-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 051: Soft Geofence — Clinic Coordinates + Timesheet Location Logs
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds:
--   clinics.latitude  / clinics.longitude   — WGS84 decimal degrees.
--     NULL until an admin sets coordinates for the clinic.
--     Used as the geofence centre for Clock In / Clock Out proximity checks.
--
--   timesheet_entries.clock_in_location  — JSONB attendance location record.
--   timesheet_entries.clock_out_location — JSONB attendance location record.
--     NULL for historical entries and when the user denies location permission
--     and the client sends no payload.  Both columns share the same JSON shape:
--
--     {
--       "lat":             <number>          WGS84 latitude of the device
--       "lng":             <number>          WGS84 longitude of the device
--       "accuracyMetres":  <number|null>     browser-reported GPS accuracy
--       "targetClinicId":  <uuid string>     clinic used as the geofence centre
--       "distanceMetres":  <number|null>     Haversine result; null if no GPS
--       "withinRange":     <bool|null>       ≤ 100 m; null if no GPS
--       "locationState":   <string>          "within"|"outside"|"denied"|"unavailable"
--     }
--
-- These columns are nullable so the migration is fully additive and never
-- touches existing rows.  No default is set — old entries simply remain NULL,
-- which the application treats as "location not recorded (historical entry)".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS clock_in_location  JSONB,
  ADD COLUMN IF NOT EXISTS clock_out_location JSONB;
