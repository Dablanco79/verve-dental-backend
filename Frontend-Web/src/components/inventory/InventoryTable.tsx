import type { InventoryItem } from "../../types/inventory.js";

type InventoryTableProps = {
  items: InventoryItem[];
};

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function compareItems(a: InventoryItem, b: InventoryItem): number {
  if (a.isBelowReorderPoint !== b.isBelowReorderPoint) {
    return a.isBelowReorderPoint ? -1 : 1;
  }

  return a.name.localeCompare(b.name);
}

export function InventoryTable({ items }: InventoryTableProps) {
  const sortedItems = [...items].sort(compareItems);
  const lowStockCount = items.filter((item) => item.isBelowReorderPoint).length;

  if (items.length === 0) {
    return <p className="inventory-empty">No inventory items found for this clinic.</p>;
  }

  return (
    <div className="inventory-table-wrap">
      <div className="inventory-summary">
        <span>{items.length} products tracked</span>
        {lowStockCount > 0 ? (
          <span className="inventory-summary__alert">
            {lowStockCount} below reorder point
          </span>
        ) : (
          <span className="inventory-summary__ok">All stock levels healthy</span>
        )}
      </div>

      <table className="inventory-table">
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">SKU</th>
            <th scope="col">Category</th>
            <th scope="col">On hand</th>
            <th scope="col">Reorder</th>
            <th scope="col">Unit cost</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item) => (
            <tr
              key={item.id}
              className={item.isBelowReorderPoint ? "inventory-table__row--low" : undefined}
            >
              <td>
                <span className="inventory-table__name">{item.name}</span>
                <span className="inventory-table__meta">{item.unitOfMeasure}</span>
              </td>
              <td>
                <code>{item.masterSku}</code>
              </td>
              <td>{item.category}</td>
              <td className="inventory-table__numeric">{item.quantityOnHand}</td>
              <td className="inventory-table__numeric">{item.reorderPoint}</td>
              <td className="inventory-table__numeric">{formatCurrency(item.unitCostCents)}</td>
              <td>
                {item.isBelowReorderPoint ? (
                  <span className="inventory-badge inventory-badge--low">Low stock</span>
                ) : (
                  <span className="inventory-badge inventory-badge--ok">OK</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
