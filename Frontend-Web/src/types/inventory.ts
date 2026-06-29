export type BarcodeFormat = "gs1" | "ean13" | "code128" | "qr" | "data_matrix";

export type ScanMode = "deduct" | "receive";

export type InventoryItem = {
  id: string;
  clinicId: string;
  masterCatalogItemId: string;
  masterSku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  quantityOnHand: number;
  reorderPoint: number;
  unitCostCents: number;
  unitCostOverrideCents: number | null;
  supplierPreference: string | null;
  isBelowReorderPoint: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InventoryAdjustment = {
  id: string;
  clinicId: string;
  clinicInventoryItemId: string;
  masterCatalogItemId: string;
  adjustmentType: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  performedByUserId: string;
  performedByEmail: string;
  referenceId: string | null;
  createdAt: string;
};

export type ScanRequest = {
  barcodeValue: string;
  barcodeFormat?: BarcodeFormat;
  quantity?: number;
  mode?: ScanMode;
  reason?: string;
};

export type CreateProductRequest = {
  sku: string;
  name: string;
  description?: string;
  category: string;
  unitOfMeasure: string;
  defaultUnitCostCents: number;
  barcodeValue: string;
  barcodeFormat: BarcodeFormat;
  initialQuantity: number;
  reorderPoint: number;
  unitCostOverrideCents?: number;
  supplierPreference?: string;
};

export type CreateProductResponse = {
  masterItem: {
    id: string;
    sku: string;
    name: string;
  };
  barcodeMapping: {
    barcodeValue: string;
    barcodeFormat: BarcodeFormat;
  };
  clinicItem: InventoryItem;
};

export type PurchaseOrderLine = {
  id: string;
  draftPurchaseOrderId: string;
  masterCatalogItemId: string;
  masterSku: string;
  itemName: string;
  clinicInventoryItemId: string;
  quantity: number;
  reason: string;
  orderStatus: "draft" | "submitted";
  createdAt: string;
  supplierPricing?: Array<{
    supplierProductId: string;
    supplierId: string;
    supplierName: string;
    supplierCode: string | null;
    unitCostCents: number;
    supplierSku: string | null;
  }>;
  estimatedUnitCostCents?: number | null;
  estimatedLineCostCents?: number | null;
};

export type ScanResponse = {
  mode: ScanMode;
  item: InventoryItem;
  adjustment: InventoryAdjustment;
  barcode: {
    detectedFormat: BarcodeFormat;
    lookupKey: string;
    mapping: {
      id: string;
      masterCatalogItemId: string;
      barcodeValue: string;
      barcodeFormat: BarcodeFormat;
      isPrimary: boolean;
    };
  };
  draftPoLineAdded: boolean;
  draftPoLine: {
    id: string;
    draftPurchaseOrderId: string;
    masterCatalogItemId: string;
    clinicInventoryItemId: string;
    quantity: number;
    reason: string;
    createdAt: string;
  } | null;
};

// ── Inventory adjustment reason codes ─────────────────────────────────────────

export const ADJUSTMENT_REASONS = [
  "Opening stock count",
  "Stock received",
  "Stock correction",
  "Damaged stock",
  "Expired stock",
  "Stock count adjustment",
  "Transfer in",
  "Transfer out",
  "Other",
] as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

// ── Manual adjust request / response ─────────────────────────────────────────

export type AdjustInventoryRequest = {
  itemId: string;
  /** Positive = increase, negative = decrease. Must be non-zero. */
  quantityDelta: number;
  reason?: string;
};

export type AdjustInventoryResponse = {
  item: InventoryItem;
  adjustment: InventoryAdjustment;
};

// ── Paginated adjustments ─────────────────────────────────────────────────────

export type AdjustmentsPage = {
  items: InventoryAdjustment[];
  total: number;
  limit: number;
  offset: number;
};

export type AdjustmentsFilters = {
  limit?: number;
  offset?: number;
};
