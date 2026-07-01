import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { BarcodeFormat, CreateProductRequest, InventoryItem } from "../types/inventory.js";
import type { Supplier } from "../types/supplier.js";
import { getInventoryBarcode } from "../utils/inventoryDisplay.js";
import { canManageInventory, canManageProducts } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

type ReceivingLine = {
  item: InventoryItem;
  quantity: string;
};

type CreateProductValues = {
  name: string;
  category: string;
  unitOfMeasure: string;
  minimumStock: string;
};

type CreateProductErrors = Partial<Record<keyof CreateProductValues, string>>;

function todayLocalDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

function inferBarcodeFormat(value: string): BarcodeFormat {
  return /^\d{13}$/.test(value) ? "ean13" : "code128";
}

function findItemByBarcodeOrSku(items: InventoryItem[], lookupValue: string): InventoryItem | null {
  const lookup = lookupValue.trim().toLowerCase();
  if (!lookup) return null;

  return (
    items.find((item) => {
      const barcode = getInventoryBarcode(item).toLowerCase();
      return (
        barcode === lookup ||
        item.masterSku.toLowerCase() === lookup ||
        item.name.toLowerCase() === lookup
      );
    }) ?? null
  );
}

function buildReceivingReason(values: {
  supplierName: string;
  reference: string;
  receivedDate: string;
  notes: string;
}): string {
  const parts = [
    "Stock received",
    `Supplier: ${values.supplierName}`,
    `Received date: ${values.receivedDate}`,
    values.reference.trim() ? `Reference: ${values.reference.trim()}` : null,
    values.notes.trim() ? `Notes: ${values.notes.trim()}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.join(" | ");
}

export function InventoryReceivingPage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";
  const requestIdRef = useRef({ id: 0 });

  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayLocalDate);
  const [notes, setNotes] = useState("");

  const [barcodeValue, setBarcodeValue] = useState("");
  const [barcodeQuantity, setBarcodeQuantity] = useState("1");
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productQuantity, setProductQuantity] = useState("1");
  const [lineItems, setLineItems] = useState<ReceivingLine[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const [createProductValues, setCreateProductValues] = useState<CreateProductValues>({
    name: "",
    category: "General",
    unitOfMeasure: "unit",
    minimumStock: "0",
  });
  const [createProductErrors, setCreateProductErrors] = useState<CreateProductErrors>({});
  const [createProductError, setCreateProductError] = useState<string | null>(null);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);

  const canReceive = user ? canManageInventory(user.role) : false;
  const canCreateProducts = user ? canManageProducts(user.role) : false;
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.active).sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
    [suppliers],
  );
  const selectedSupplier = activeSuppliers.find((supplier) => supplier.id === supplierId) ?? null;
  const matchedBarcodeItem = findItemByBarcodeOrSku(inventoryItems, barcodeValue);
  const hasUnknownBarcode = barcodeValue.trim().length > 0 && !matchedBarcodeItem;

  const filteredProducts = useMemo(() => {
    const lookup = productSearch.trim().toLowerCase();
    if (!lookup) return inventoryItems.slice(0, 8);

    return inventoryItems
      .filter((item) => {
        const barcode = getInventoryBarcode(item).toLowerCase();
        return (
          item.name.toLowerCase().includes(lookup) ||
          item.masterSku.toLowerCase().includes(lookup) ||
          barcode.includes(lookup) ||
          item.category.toLowerCase().includes(lookup)
        );
      })
      .slice(0, 8);
  }, [inventoryItems, productSearch]);

  const loadReceivingData = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    if (!selectedClinicId || isAllClinicsScope) {
      setInventoryItems([]);
      setSuppliers([]);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current.id;
    setIsLoading(true);
    setLoadError(null);

    try {
      const [inventory, supplierList] = await Promise.all([
        apiClient.listInventory(selectedClinicId),
        apiClient.listSuppliers({ active: true }),
      ]);

      if (requestId === requestIdRef.current.id) {
        setInventoryItems(inventory);
        setSuppliers(supplierList);
      }
    } catch (err: unknown) {
      if (requestId === requestIdRef.current.id) {
        setLoadError(err instanceof Error ? err.message : "Product lookup failed. Please try again.");
      }
    } finally {
      if (requestId === requestIdRef.current.id) {
        setIsLoading(false);
      }
    }
  }, [isAllClinicsScope, selectedClinicId, user]);

  useEffect(() => {
    void loadReceivingData();
    const tracker = requestIdRef.current;
    return () => {
      tracker.id++;
    };
  }, [loadReceivingData]);

  if (!user) return null;

  if (!canReceive) {
    return <Navigate to="/inventory" replace />;
  }

  if (isAllClinicsScope) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to receive stock</h2>
          <p>
            Receiving is clinic-specific. Choose a real clinic from Clinic scope before
            adding delivered stock to inventory.
          </p>
        </section>
      </AppShell>
    );
  }

  function updateCreateProductField<K extends keyof CreateProductValues>(
    field: K,
    value: CreateProductValues[K],
  ): void {
    setCreateProductValues((current) => ({ ...current, [field]: value }));
    setCreateProductErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)),
    );
    setCreateProductError(null);
  }

  function resetCreateProduct(): void {
    setCreateProductValues({
      name: "",
      category: "General",
      unitOfMeasure: "unit",
      minimumStock: "0",
    });
    setCreateProductErrors({});
    setCreateProductError(null);
  }

  function addLine(item: InventoryItem, quantityValue: string): void {
    const quantity = Number(quantityValue);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setFormError("Quantity must be a positive whole number.");
      return;
    }

    setLineItems((current) => {
      const existing = current.find((line) => line.item.id === item.id);
      if (!existing) {
        return [...current, { item, quantity: String(quantity) }];
      }

      return current.map((line) =>
        line.item.id === item.id
          ? { ...line, quantity: String(Number(line.quantity) + quantity) }
          : line,
      );
    });
    setFormError(null);
  }

  function handleAddBarcodeItem(): void {
    setBarcodeError(null);
    if (!barcodeValue.trim()) {
      setBarcodeError("Enter a barcode or SKU.");
      return;
    }
    if (!matchedBarcodeItem) {
      setBarcodeError("Product lookup failed. Create the product before receiving it.");
      return;
    }

    addLine(matchedBarcodeItem, barcodeQuantity);
    setBarcodeValue("");
    setBarcodeQuantity("1");
  }

  function validateCreateProduct(): CreateProductErrors {
    const errors: CreateProductErrors = {};
    const minimumStock = Number(createProductValues.minimumStock);

    if (!createProductValues.name.trim()) {
      errors.name = "Product name is required.";
    }
    if (!createProductValues.category.trim()) {
      errors.category = "Category is required.";
    }
    if (!createProductValues.unitOfMeasure.trim()) {
      errors.unitOfMeasure = "Unit of measure is required.";
    }
    if (!Number.isInteger(minimumStock) || minimumStock < 0) {
      errors.minimumStock = "Minimum stock must be zero or a positive whole number.";
    }

    return errors;
  }

  async function handleCreateProduct(): Promise<void> {
    if (!selectedClinicId || !selectedSupplier) return;

    if (!canCreateProducts) {
      setCreateProductError("You do not have permission to create products.");
      return;
    }

    const errors = validateCreateProduct();
    if (Object.keys(errors).length > 0) {
      setCreateProductErrors(errors);
      return;
    }

    setCreateProductErrors({});
    setCreateProductError(null);
    setIsCreatingProduct(true);

    try {
      const barcode = barcodeValue.trim();
      const request: CreateProductRequest = {
        sku: barcode,
        name: createProductValues.name.trim(),
        category: createProductValues.category.trim(),
        unitOfMeasure: createProductValues.unitOfMeasure.trim(),
        defaultUnitCostCents: 0,
        barcodeValue: barcode,
        barcodeFormat: inferBarcodeFormat(barcode),
        initialQuantity: 0,
        reorderPoint: Number(createProductValues.minimumStock),
        supplierId: selectedSupplier.id,
      };
      const response = await apiClient.createProduct(selectedClinicId, request);
      setInventoryItems((current) => [response.clinicItem, ...current]);
      setBarcodeValue(response.clinicItem.masterSku);
      resetCreateProduct();
    } catch (err: unknown) {
      setCreateProductError(err instanceof Error ? err.message : "Unable to create product.");
    } finally {
      setIsCreatingProduct(false);
    }
  }

  function updateLineQuantity(itemId: string, quantity: string): void {
    setLineItems((current) =>
      current.map((line) => (line.item.id === itemId ? { ...line, quantity } : line)),
    );
  }

  function removeLine(itemId: string): void {
    setLineItems((current) => current.filter((line) => line.item.id !== itemId));
  }

  async function handleFinishReceiving(): Promise<void> {
    setFinishError(null);

    if (!selectedSupplier || !selectedClinicId) {
      setFinishError("Supplier is required.");
      return;
    }
    if (lineItems.length === 0) {
      setFinishError("Add at least one received item before finishing.");
      return;
    }

    const invalidLine = lineItems.find((line) => {
      const quantity = Number(line.quantity);
      return !Number.isInteger(quantity) || quantity <= 0;
    });
    if (invalidLine) {
      setFinishError("All received quantities must be positive whole numbers.");
      return;
    }

    setIsFinishing(true);
    try {
      const reason = buildReceivingReason({
        supplierName: selectedSupplier.supplierName,
        reference,
        receivedDate,
        notes,
      });

      for (const line of lineItems) {
        await apiClient.adjustInventory(selectedClinicId, {
          itemId: line.item.id,
          quantityDelta: Number(line.quantity),
          reason,
        });
      }

      setIsComplete(true);
    } catch (err: unknown) {
      setFinishError(err instanceof Error ? err.message : "Stock update failed. Please try again.");
    } finally {
      setIsFinishing(false);
    }
  }

  function resetReceiving(): void {
    setSupplierId("");
    setReference("");
    setReceivedDate(todayLocalDate());
    setNotes("");
    setBarcodeValue("");
    setBarcodeQuantity("1");
    setProductSearch("");
    setProductQuantity("1");
    setLineItems([]);
    setFormError(null);
    setFinishError(null);
    setIsComplete(false);
    void loadReceivingData();
  }

  if (isComplete) {
    return (
      <AppShell>
        <section className="status-card receiving-page receiving-page--success">
          <h2>Stock received successfully.</h2>
          <p className="inventory-page__subtitle">
            Inventory quantities have been increased and adjustment records were created.
          </p>
          <div className="inventory-page__actions">
            <button type="button" className="button-link" onClick={resetReceiving}>
              Receive another delivery
            </button>
            <Link to="/inventory" className="link-button">
              Back to Inventory
            </Link>
          </div>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="status-card receiving-page">
        <div className="status-card__header">
          <div>
            <h2>Receive Stock</h2>
            <p className="inventory-page__subtitle">
              {selectedClinic?.name ?? user.homeClinicName} — add delivered stock to inventory.
            </p>
          </div>
          <Link to="/inventory" className="link-button">
            Back to Inventory
          </Link>
        </div>

        {isLoading ? <p className="loading-message">Loading receiving workspace...</p> : null}
        {loadError ? (
          <p className="status-card__error" role="alert">
            {loadError}
          </p>
        ) : null}

        {!isLoading && !loadError && activeSuppliers.length === 0 ? (
          <div className="billing-empty" role="status">
            <p className="billing-empty__title">No suppliers have been created yet.</p>
            <p className="billing-empty__hint">
              Please create a supplier before receiving stock.
            </p>
            <Link to="/suppliers" className="button-link">
              Create supplier
            </Link>
          </div>
        ) : null}

        {!isLoading && !loadError && activeSuppliers.length > 0 ? (
          <>
            <fieldset className="product-form__section receiving-page__header-fields">
              <legend>Receiving session</legend>
              <div className="product-form__grid">
                <label className="product-form__field">
                  Supplier *
                  <select
                    value={supplierId}
                    onChange={(event) => {
                      setSupplierId(event.target.value);
                      setFinishError(null);
                    }}
                    required
                  >
                    <option value="">Select supplier...</option>
                    {activeSuppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.supplierName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="product-form__field">
                  Invoice/reference number
                  <input
                    value={reference}
                    onChange={(event) => {
                      setReference(event.target.value);
                    }}
                    placeholder="e.g. INV-1024"
                  />
                </label>
                <label className="product-form__field">
                  Received date
                  <input
                    type="date"
                    value={receivedDate}
                    onChange={(event) => {
                      setReceivedDate(event.target.value);
                    }}
                  />
                </label>
                <label className="product-form__field product-form__full">
                  Notes
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(event) => {
                      setNotes(event.target.value);
                    }}
                    placeholder="Delivery condition, missing items, or other context"
                  />
                </label>
              </div>
            </fieldset>

            <section className="receiving-page__add-grid" aria-label="Add received items">
              <div className="receiving-page__panel">
                <h3>Add by barcode</h3>
                <p className="inventory-page__subtitle">
                  Scan with a USB/Bluetooth scanner or type the barcode manually.
                </p>
                <div className="scan-form__row">
                  <label className="scan-form__field scan-form__field--grow">
                    Barcode
                    <input
                      value={barcodeValue}
                      onChange={(event) => {
                        setBarcodeValue(event.target.value);
                        setBarcodeError(null);
                        setCreateProductError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && matchedBarcodeItem) {
                          event.preventDefault();
                          handleAddBarcodeItem();
                        }
                      }}
                      placeholder="Scan or enter barcode/SKU"
                      autoComplete="off"
                    />
                  </label>
                  <label className="scan-form__field scan-form__field--narrow">
                    Quantity received
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={barcodeQuantity}
                      onChange={(event) => {
                        setBarcodeQuantity(event.target.value);
                      }}
                    />
                  </label>
                </div>

                {matchedBarcodeItem ? (
                  <section className="scan-product-card" aria-label="Product found">
                    <div>
                      <p className="scan-product-card__eyebrow">Product found</p>
                      <h3>{matchedBarcodeItem.name}</h3>
                    </div>
                    <dl className="scan-product-card__details">
                      <div>
                        <dt>SKU</dt>
                        <dd>{matchedBarcodeItem.masterSku}</dd>
                      </div>
                      <div>
                        <dt>Barcode</dt>
                        <dd>{getInventoryBarcode(matchedBarcodeItem)}</dd>
                      </div>
                      <div>
                        <dt>Current quantity</dt>
                        <dd>
                          {matchedBarcodeItem.quantityOnHand} {matchedBarcodeItem.unitOfMeasure}
                        </dd>
                      </div>
                    </dl>
                    <button type="button" className="button-link" onClick={handleAddBarcodeItem}>
                      Add received item
                    </button>
                  </section>
                ) : null}

                {hasUnknownBarcode ? (
                  <div className="inventory-receiving-callout" role="status">
                    <h3>Unknown barcode</h3>
                    <p>This barcode is not linked to an existing product.</p>
                    {selectedSupplier && canCreateProducts ? (
                      <div className="receiving-create-product">
                        <h4>Create Product</h4>
                        <label className="scan-form__field">
                          Product Name *
                          <input
                            value={createProductValues.name}
                            onChange={(event) => {
                              updateCreateProductField("name", event.target.value);
                            }}
                          />
                          {createProductErrors.name ? (
                            <span className="product-form__field-error" role="alert">
                              {createProductErrors.name}
                            </span>
                          ) : null}
                        </label>
                        <div className="scan-create-modal__grid">
                          <label className="scan-form__field">
                            Category
                            <input
                              value={createProductValues.category}
                              onChange={(event) => {
                                updateCreateProductField("category", event.target.value);
                              }}
                            />
                            {createProductErrors.category ? (
                              <span className="product-form__field-error" role="alert">
                                {createProductErrors.category}
                              </span>
                            ) : null}
                          </label>
                          <label className="scan-form__field">
                            Unit of Measure
                            <input
                              value={createProductValues.unitOfMeasure}
                              onChange={(event) => {
                                updateCreateProductField("unitOfMeasure", event.target.value);
                              }}
                            />
                            {createProductErrors.unitOfMeasure ? (
                              <span className="product-form__field-error" role="alert">
                                {createProductErrors.unitOfMeasure}
                              </span>
                            ) : null}
                          </label>
                          <label className="scan-form__field">
                            Minimum Stock
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={createProductValues.minimumStock}
                              onChange={(event) => {
                                updateCreateProductField("minimumStock", event.target.value);
                              }}
                            />
                            {createProductErrors.minimumStock ? (
                              <span className="product-form__field-error" role="alert">
                                {createProductErrors.minimumStock}
                              </span>
                            ) : null}
                          </label>
                        </div>
                        {createProductError ? (
                          <p className="status-card__error" role="alert">
                            {createProductError}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          className="button-link"
                          onClick={() => {
                            void handleCreateProduct();
                          }}
                          disabled={isCreatingProduct}
                        >
                          {isCreatingProduct ? "Creating..." : "Create Product"}
                        </button>
                      </div>
                    ) : (
                      <p className="inventory-page__subtitle">
                        Select a supplier before creating this product.
                      </p>
                    )}
                  </div>
                ) : null}

                {barcodeError ? (
                  <p className="status-card__error" role="alert">
                    {barcodeError}
                  </p>
                ) : null}
              </div>

              <div className="receiving-page__panel">
                <h3>Add by product search</h3>
                <label className="scan-form__field">
                  Product search/select
                  <input
                    type="search"
                    value={productSearch}
                    onChange={(event) => {
                      setProductSearch(event.target.value);
                    }}
                    placeholder="Search name, SKU, barcode, or category"
                  />
                </label>
                <label className="scan-form__field scan-form__field--narrow">
                  Quantity received
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={productQuantity}
                    onChange={(event) => {
                      setProductQuantity(event.target.value);
                    }}
                  />
                </label>
                <div className="adj-selector__list" role="listbox" aria-label="Product search results">
                  {filteredProducts.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="adj-selector__item"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        addLine(item, productQuantity);
                      }}
                    >
                      <span className="adj-selector__item-name">{item.name}</span>
                      <span className="adj-selector__item-meta">
                        <span className="adj-selector__sku">{item.masterSku}</span>
                        <span>{getInventoryBarcode(item)}</span>
                      </span>
                      <span className="adj-selector__stock">
                        <strong>{item.quantityOnHand}</strong> {item.unitOfMeasure}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {formError ? (
              <p className="status-card__error" role="alert">
                {formError}
              </p>
            ) : null}

            <section className="receiving-page__lines">
              <h3>Receiving line items</h3>
              {lineItems.length === 0 ? (
                <p className="inventory-page__subtitle">No received items added yet.</p>
              ) : (
                <div className="inventory-table__scroll">
                  <table className="inventory-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th>Supplier</th>
                        <th>Quantity received</th>
                        <th>Current quantity</th>
                        <th>New quantity preview</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((line) => {
                        const quantity = Number(line.quantity);
                        const preview = Number.isFinite(quantity)
                          ? line.item.quantityOnHand + quantity
                          : line.item.quantityOnHand;
                        return (
                          <tr key={line.item.id}>
                            <td>{line.item.name}</td>
                            <td>{line.item.masterSku}</td>
                            <td>{selectedSupplier?.supplierName ?? "Select supplier"}</td>
                            <td>
                              <input
                                className="receiving-page__line-quantity"
                                aria-label={`Quantity received for ${line.item.name}`}
                                type="number"
                                min={1}
                                step={1}
                                value={line.quantity}
                                onChange={(event) => {
                                  updateLineQuantity(line.item.id, event.target.value);
                                }}
                              />
                            </td>
                            <td>{line.item.quantityOnHand} {line.item.unitOfMeasure}</td>
                            <td>{preview} {line.item.unitOfMeasure}</td>
                            <td>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => {
                                  removeLine(line.item.id);
                                }}
                              >
                                Remove
                                <span className="visually-hidden"> {line.item.name}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {finishError ? (
              <p className="status-card__error" role="alert">
                {finishError}
              </p>
            ) : null}

            <div className="inventory-page__actions receiving-page__finish">
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  void handleFinishReceiving();
                }}
                disabled={isFinishing}
              >
                {isFinishing ? "Finishing..." : "Finish receiving"}
              </button>
              <Link to="/inventory" className="link-button">
                Back to Inventory
              </Link>
            </div>
          </>
        ) : null}
      </section>
    </AppShell>
  );
}
