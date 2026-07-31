/**
 * Canonical global product categories — mirrors MASTER_PRODUCT_CATEGORIES on
 * the backend.  Categories are owned by Master Products and inherited by Clinic
 * Inventory Products.
 *
 * Excluded values (must never appear in creation selectors or be persisted):
 *   - "Imported Catalogue" — legacy placeholder, never valid.
 *   - "Uncategorised"      — forces a deliberate user choice on creation.
 *     Historical records carrying "Uncategorised" are display-only; the value
 *     cannot be set by any current creation path.
 *
 * IMPORTANT: This constant is the TypeScript type source only.  UI category
 * selectors MUST fetch from GET /api/v1/master-products/categories (via
 * useCategories) rather than reading this constant directly.  The backend is
 * the single authoritative source.  This constant must NOT be used as a
 * fallback for save/create operations — only for read-only display when the
 * API is unavailable.
 */
export const MASTER_PRODUCT_CATEGORIES = [
  "Consumables",
  "Dental Supplies",
  "Endodontics",
  "Equipment Consumables",
  "Hygiene Products",
  "Laboratory",
  "Medications",
  "Office Supplies",
  "Orthodontics",
  "PPE",
  "Preventive",
  "Prosthodontics",
  "Restorative",
  "Rotary",
  "Sterilisation",
] as const;

export type MasterProductCategory = (typeof MASTER_PRODUCT_CATEGORIES)[number];
