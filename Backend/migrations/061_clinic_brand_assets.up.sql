CREATE TABLE IF NOT EXISTS clinic_brand_assets (
  clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  image_data bytea NOT NULL,
  mime_type text NOT NULL
    CONSTRAINT clinic_brand_assets_mime_type_check
      CHECK (mime_type IN ('image/png', 'image/jpeg')),
  sha256_checksum char(64) NOT NULL
    CONSTRAINT clinic_brand_assets_sha256_check
      CHECK (sha256_checksum ~ '^[0-9a-f]{64}$'),
  width integer NOT NULL
    CONSTRAINT clinic_brand_assets_width_check
      CHECK (width > 0 AND width <= 1600),
  height integer NOT NULL
    CONSTRAINT clinic_brand_assets_height_check
      CHECK (height > 0 AND height <= 1600),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT clinic_brand_assets_size_check
    CHECK (octet_length(image_data) <= 524288)
);

ALTER TABLE clinic_brand_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_brand_assets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_clinic_brand_assets_tenant ON clinic_brand_assets;
CREATE POLICY rls_clinic_brand_assets_tenant
  ON clinic_brand_assets
  FOR ALL
  USING (clinic_id = app_current_clinic_id())
  WITH CHECK (clinic_id = app_current_clinic_id());
