export const BARCODE_FORMATS = [
  "gs1",
  "ean13",
  "code128",
  "qr",
  "data_matrix",
] as const;

export type BarcodeFormat = (typeof BARCODE_FORMATS)[number];

export const ADJUSTMENT_TYPES = [
  "scan_deduct",
  "manual_adjust",
  "receive",
  "transfer_in",
  "transfer_out",
] as const;

export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const SCAN_MODES = ["deduct", "receive"] as const;

export type ScanMode = (typeof SCAN_MODES)[number];

export const DRAFT_PO_STATUSES = ["draft", "submitted"] as const;

export type DraftPoStatus = (typeof DRAFT_PO_STATUSES)[number];

export type MasterCatalogItem = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  stockUnit: string;
  receivingUnit: string;
  unitsPerReceivingUnit: number;
  /** Legacy API alias retained while scan/forecast surfaces migrate to stockUnit. */
  unitOfMeasure: string;
  defaultUnitCostCents: number;
  isActive: boolean;
  /** Curated Master Product Library metadata (Master Product Library Import Foundation). */
  subcategory: string | null;
  brand: string | null;
  variantAttributes: string | null;
  notes: string | null;
  /**
   * Free-text lifecycle status (e.g. "active", "inactive", "discontinued").
   * isActive is derived from `status === "active"` at write time.
   */
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BarcodeMapping = {
  id: string;
  masterCatalogItemId: string;
  barcodeValue: string;
  barcodeFormat: BarcodeFormat;
  isPrimary: boolean;
  createdAt: Date;
};

export type ClinicInventoryItem = {
  id: string;
  clinicId: string;
  masterCatalogItemId: string;
  quantityOnHand: number;
  reorderPoint: number;
  unitCostOverrideCents: number | null;
  supplierPreference: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductSupplier = {
  id: string;
  clinicId: string;
  productId: string;
  supplierId: string;
  supplierName: string | null;
  supplierSku: string | null;
  supplierBarcode: string | null;
  unitCostCents: number | null;
  packSize: number | null;
  isPreferred: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ClinicInventoryItemView = ClinicInventoryItem & {
  masterSku: string;
  name: string;
  category: string;
  stockUnit: string;
  receivingUnit: string;
  unitsPerReceivingUnit: number;
  /** Legacy API alias retained while scan/forecast surfaces migrate to stockUnit. */
  unitOfMeasure: string;
  unitCostCents: number;
  isBelowReorderPoint: boolean;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
};

export type InventoryAdjustment = {
  id: string;
  clinicId: string;
  clinicInventoryItemId: string;
  masterCatalogItemId: string;
  adjustmentType: AdjustmentType;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  performedByUserId: string;
  performedByEmail: string;
  referenceId: string | null;
  createdAt: Date;
};

export type DraftPurchaseOrder = {
  id: string;
  clinicId: string;
  status: DraftPoStatus;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DraftPoLine = {
  id: string;
  draftPurchaseOrderId: string;
  masterCatalogItemId: string;
  clinicInventoryItemId: string;
  quantity: number;
  reason: string;
  createdAt: Date;
};

// ── Pagination page types ─────────────────────────────────────────────────────

export type InventoryPage = {
  items: ClinicInventoryItemView[];
  total: number;
  limit: number;
  offset: number;
};

export type AdjustmentsPage = {
  items: InventoryAdjustment[];
  total: number;
  limit: number;
  offset: number;
};
