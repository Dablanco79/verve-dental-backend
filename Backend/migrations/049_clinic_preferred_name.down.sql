-- Migration 049 (down): Remove preferred_name from clinics
ALTER TABLE clinics
  DROP COLUMN IF EXISTS preferred_name;
