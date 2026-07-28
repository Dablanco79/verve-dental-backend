import type { InventoryItem } from "../types/inventory.js";

export type InventoryStockStatus = {
  label: "Healthy" | "Low Stock" | "Out of Stock";
  className: string;
};

export function formatInventoryCurrency(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

export function getInventoryBarcode(item: InventoryItem): string {
  return item.barcodeValue ?? item.primaryBarcode ?? item.masterSku;
}

export function getInventoryStockUnit(item: InventoryItem): string {
  return item.stockUnit ?? item.unitOfMeasure;
}

export function getInventoryReceivingUnit(item: InventoryItem): string {
  return item.receivingUnit ?? getInventoryStockUnit(item);
}

export function getInventoryUnitsPerReceivingUnit(item: InventoryItem): number {
  return item.unitsPerReceivingUnit ?? 1;
}

export function getInventorySupplierName(item: InventoryItem): string {
  return item.preferredSupplierName ?? item.supplierPreference ?? "";
}

export function getInventorySupplierDisplay(item: InventoryItem): string {
  return getInventorySupplierName(item) || "No preferred supplier assigned.";
}

export function getInventoryStockStatus(item: InventoryItem): InventoryStockStatus {
  if (item.quantityOnHand === 0) {
    return { label: "Out of Stock", className: "inventory-badge inventory-badge--out" };
  }

  if (item.isBelowReorderPoint) {
    return { label: "Low Stock", className: "inventory-badge inventory-badge--low" };
  }

  return { label: "Healthy", className: "inventory-badge inventory-badge--ok" };
}

/**
 * Returns true when a product is out of stock AND has a reorder point of zero.
 *
 * This is a distinct operational condition from a "normal" out-of-stock:
 *   quantityOnHand = 0 + reorderPoint = 0
 *   → isBelowReorderPoint = false (0 < 0 is false)
 *   → The item never enters the Low Stock purchasing queue
 *   → Staff see "Out of Stock" with no actionable next step
 *
 * When this returns true, the UI should present:
 *   - "Out of Stock — Reorder level not configured"
 *   - An actionable link to set the reorder level
 *   - An optional path to create an order manually
 */
export function getInventoryZeroReorderWarning(item: InventoryItem): boolean {
  return item.quantityOnHand === 0 && item.reorderPoint === 0;
}
