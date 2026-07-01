import { Link } from "react-router-dom";

import type { InventoryItem } from "../../types/inventory.js";
import {
  formatInventoryCurrency,
  getInventoryBarcode,
  getInventoryStockUnit,
  getInventoryStockStatus,
  getInventorySupplierDisplay,
} from "../../utils/inventoryDisplay.js";

type InventoryTableProps = {
  items: InventoryItem[];
  allItemsCount?: number;
  hasActiveFilters?: boolean;
  productDetailHrefForItem?: (item: InventoryItem) => string | undefined;
  purchaseOrderHrefForItem?: (item: InventoryItem) => string;
};

function compareItems(a: InventoryItem, b: InventoryItem): number {
  const aOut = a.quantityOnHand === 0;
  const bOut = b.quantityOnHand === 0;
  if (aOut !== bOut) {
    return aOut ? -1 : 1;
  }

  if (a.isBelowReorderPoint !== b.isBelowReorderPoint) {
    return a.isBelowReorderPoint ? -1 : 1;
  }

  return a.name.localeCompare(b.name);
}

export function InventoryTable({
  items,
  allItemsCount = items.length,
  hasActiveFilters = false,
  productDetailHrefForItem,
  purchaseOrderHrefForItem,
}: InventoryTableProps) {
  const sortedItems = [...items].sort(compareItems);
  const lowStockCount = items.filter((item) => item.isBelowReorderPoint).length;
  const outOfStockCount = items.filter((item) => item.quantityOnHand === 0).length;
  const showPurchaseActions = Boolean(purchaseOrderHrefForItem);

  if (items.length === 0) {
    if (allItemsCount === 0) {
      return (
        <div className="inventory-empty">
          <p>No products have been added yet.</p>
          <Link to="/inventory/products/new" className="button-link">
            Add Product
          </Link>
        </div>
      );
    }

    if (hasActiveFilters) {
      return <p className="inventory-empty">No products match your search.</p>;
    }

    return <p className="inventory-empty">No products have been added yet.</p>;
  }

  return (
    <div className="inventory-table-wrap">
      <div className="inventory-summary">
        <span>
          {items.length} of {allItemsCount} products shown
        </span>
        {outOfStockCount > 0 ? (
          <span className="inventory-summary__alert">
            {outOfStockCount} out of stock
          </span>
        ) : null}
        {lowStockCount > 0 ? (
          <span className="inventory-summary__alert">
            {lowStockCount} low stock
          </span>
        ) : outOfStockCount === 0 ? (
          <span className="inventory-summary__ok">All stock levels healthy</span>
        ) : null}
      </div>

      <table className="inventory-table">
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">SKU</th>
            <th scope="col">Barcode</th>
            <th scope="col">Supplier</th>
            <th scope="col">Category</th>
            <th scope="col">Current Quantity</th>
            <th scope="col">Reorder</th>
            <th scope="col">Unit cost</th>
            <th scope="col">Status</th>
            {showPurchaseActions ? <th scope="col">Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item) => {
            const purchaseHref = purchaseOrderHrefForItem?.(item);
            const detailHref = productDetailHrefForItem?.(item);
            const stockStatus = getInventoryStockStatus(item);
            return (
              <tr
                key={item.id}
                className={
                  item.quantityOnHand === 0
                    ? "inventory-table__row--out"
                    : item.isBelowReorderPoint
                      ? "inventory-table__row--low"
                      : undefined
                }
              >
                <td>
                  {detailHref ? (
                    <Link to={detailHref} className="inventory-table__name inventory-table__name-link">
                      {item.name}
                    </Link>
                  ) : (
                    <span className="inventory-table__name">{item.name}</span>
                  )}
                  <span className="inventory-table__meta">{getInventoryStockUnit(item)}</span>
                </td>
                <td>
                  <code>{item.masterSku}</code>
                </td>
                <td>
                  <code>{getInventoryBarcode(item)}</code>
                </td>
                <td>{getInventorySupplierDisplay(item)}</td>
                <td>{item.category}</td>
                <td className="inventory-table__numeric">{item.quantityOnHand}</td>
                <td className="inventory-table__numeric">{item.reorderPoint}</td>
                <td className="inventory-table__numeric">{formatInventoryCurrency(item.unitCostCents)}</td>
                <td>
                  <span className={stockStatus.className}>{stockStatus.label}</span>
                </td>
                {showPurchaseActions ? (
                  <td>
                    {purchaseHref && item.isBelowReorderPoint ? (
                      <Link to={purchaseHref} className="link-button">
                        Review PO
                        <span className="visually-hidden"> for {item.name}</span>
                      </Link>
                    ) : (
                      <span className="inventory-table__meta">No action</span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
