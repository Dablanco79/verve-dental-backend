DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM clinic_brand_assets LIMIT 1) THEN
    RAISE EXCEPTION 'Migration 061 rollback refused: clinic brand assets exist';
  END IF;
END
$$;

DROP TABLE IF EXISTS clinic_brand_assets;
