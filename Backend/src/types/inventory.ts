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
  unitOfMeasure: string;
  defaultUnitCostCents: number;
  isActive: boolean;
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

export type ClinicInventoryItemView = ClinicInventoryItem & {
  masterSku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  unitCostCents: number;
  isBelowReorderPoint: boolean;
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
