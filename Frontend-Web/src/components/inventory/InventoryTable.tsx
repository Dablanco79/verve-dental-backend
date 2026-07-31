import { Link } from "react-router-dom";

import type { InventoryItem } from "../../types/inventory.js";
import {
  formatInventoryCurrency,
  getInventoryBarcode,
  getInventoryStockUnit,
  getInventoryStockStatus,
  getInventorySupplierDisplay,
  getInventoryZeroReorderWarning,
} from "../../utils/inventoryDisplay.js";

type InventoryTableProps = {
  items: InventoryItem[];
  allItemsCount?: number;
  hasActiveFilters?: boolean;
  productDetailHrefForItem?: (item: InventoryItem) => string | undefined;
  productEditHrefForItem?: (item: InventoryItem) => string | undefined;
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
  productEditHrefForItem,
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
            <th scope="col">Purchasing</th>
            <th scope="col">Status</th>
            {showPurchaseActions ? <th scope="col">Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item) => {
            const purchaseHref = purchaseOrderHrefForItem?.(item);
            const detailHref = productDetailHrefForItem?.(item);
            const editHref = productEditHrefForItem?.(item);
            const stockStatus = getInventoryStockStatus(item);
            const zeroReorderWarning = getInventoryZeroReorderWarning(item);
            const inDraft = item.inDraftQuantity ?? 0;
            const onOrder = item.onOrderQuantity ?? 0;
            const activeDocs = item.activePurchasingDocuments ?? [];
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
                <td className="inventory-table__purchasing">
                  {inDraft > 0 ? (
                    <span className="inventory-table__meta inventory-table__meta--warn" data-testid="in-draft-qty">
                      In draft: {String(inDraft)} {item.stockUnit ?? "units"}
                      {activeDocs.filter((d) => d.status === "draft").map((d) => (
                        <span key={d.poId}>
                          {" · "}
                          {d.draftReference ? (
                            <Link to={`/purchasing-drafts/${d.purchasingDraftId ?? ""}`} className="inventory-table__link">
                              {d.draftReference}
                            </Link>
                          ) : (
                            <Link to={`/purchase-orders/${d.poId}`} className="inventory-table__link">
                              {d.poReference ?? d.poId.slice(0, 8)}
                            </Link>
                          )}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {onOrder > 0 ? (
                    <span className="inventory-table__meta" data-testid="on-order-qty">
                      On order: {String(onOrder)} {item.stockUnit ?? "units"}
                      {activeDocs.filter((d) => d.status === "submitted" || d.status === "partially_received").map((d) => (
                        <span key={d.poId}>
                          {" · "}
                          {d.draftReference ? (
                            <Link to={`/purchasing-drafts/${d.purchasingDraftId ?? ""}`} className="inventory-table__link">
                              {d.draftReference}
                            </Link>
                          ) : (
                            <Link to={`/purchase-orders/${d.poId}`} className="inventory-table__link">
                              {d.poReference ?? d.poId.slice(0, 8)}
                            </Link>
                          )}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {inDraft === 0 && onOrder === 0 ? (
                    <span className="inventory-table__meta">—</span>
                  ) : null}
                </td>
                <td>
                  <span className={stockStatus.className}>{stockStatus.label}</span>
                  {zeroReorderWarning ? (
                    <span className="inventory-table__meta inventory-table__meta--warn" data-testid="zero-reorder-warning">
                      {" "}Reorder level not configured
                    </span>
                  ) : null}
                </td>
                {showPurchaseActions ? (
                  <td>
                    {zeroReorderWarning ? (
                      <div className="po-row-actions">
                        {editHref ? (
                          <Link to={editHref} className="link-button" aria-label={`Set reorder level for ${item.name}`}>
                            Set reorder level
                          </Link>
                        ) : detailHref ? (
                          <Link to={detailHref} className="link-button" aria-label={`Set reorder level for ${item.name}`}>
                            Set reorder level
                          </Link>
                        ) : null}
                        {purchaseHref ? (
                          <Link to={purchaseHref} className="link-button" aria-label={`Order ${item.name}`}>
                            Order
                          </Link>
                        ) : null}
                      </div>
                    ) : purchaseHref && item.isBelowReorderPoint ? (
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
