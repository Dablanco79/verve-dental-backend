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
