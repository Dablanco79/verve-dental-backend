import { useState, type SubmitEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { BarcodeFormat } from "../types/inventory.js";
import { canManageProducts } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

const BARCODE_FORMAT_OPTIONS: Array<{ value: BarcodeFormat; label: string }> = [
  { value: "ean13", label: "EAN-13" },
  { value: "gs1", label: "GS1" },
  { value: "code128", label: "Code 128" },
  { value: "qr", label: "QR" },
  { value: "data_matrix", label: "Data Matrix" },
];

function dollarsToCents(value: string): number | null {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

export function AddProductPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("box");
  const [defaultUnitCost, setDefaultUnitCost] = useState("");
  const [barcodeValue, setBarcodeValue] = useState("");
  const [barcodeFormat, setBarcodeFormat] = useState<BarcodeFormat>("ean13");
  const [initialQuantity, setInitialQuantity] = useState("0");
  const [reorderPoint, setReorderPoint] = useState("5");
  const [supplierPreference, setSupplierPreference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!user) {
    return null;
  }

  if (!canManageProducts(user.role)) {
    return <Navigate to="/inventory" replace />;
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!user) {
      return;
    }

    setError(null);

    const defaultUnitCostCents = dollarsToCents(defaultUnitCost);
    const parsedInitialQuantity = Number(initialQuantity);
    const parsedReorderPoint = Number(reorderPoint);

    if (defaultUnitCostCents === null) {
      setError("Enter a valid default unit cost.");
      return;
    }

    if (!Number.isInteger(parsedInitialQuantity) || parsedInitialQuantity < 0) {
      setError("Initial quantity must be a non-negative whole number.");
      return;
    }

    if (!Number.isInteger(parsedReorderPoint) || parsedReorderPoint < 0) {
      setError("Reorder point must be a non-negative whole number.");
      return;
    }

    setIsSubmitting(true);

    try {
      await apiClient.createProduct(user.homeClinicId, {
        sku: sku.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim(),
        unitOfMeasure: unitOfMeasure.trim(),
        defaultUnitCostCents,
        barcodeValue: barcodeValue.trim(),
        barcodeFormat,
        initialQuantity: parsedInitialQuantity,
        reorderPoint: parsedReorderPoint,
        supplierPreference: supplierPreference.trim() || undefined,
      });

      void navigate("/inventory");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create product";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Add new product</h2>
            <p className="inventory-page__subtitle">
              Create a master catalog item, barcode mapping, and clinic stock row for{" "}
              {user.homeClinicName}.
            </p>
          </div>
          <Link to="/inventory" className="link-button">
            Back to inventory
          </Link>
        </div>

        <form className="product-form" onSubmit={(event) => void handleSubmit(event)}>
          <fieldset className="product-form__section">
            <legend>Product details</legend>
            <div className="product-form__grid">
              <label>
                SKU
                <input
                  value={sku}
                  onChange={(event) => {
                    setSku(event.target.value);
                  }}
                  placeholder="VRV-ANE-001"
                  required
                />
              </label>
              <label>
                Product name
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  required
                />
              </label>
              <label className="product-form__full">
                Description
                <input
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                />
              </label>
              <label>
                Category
                <input
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                  }}
                  placeholder="PPE"
                  required
                />
              </label>
              <label>
                Unit of measure
                <input
                  value={unitOfMeasure}
                  onChange={(event) => {
                    setUnitOfMeasure(event.target.value);
                  }}
                  placeholder="box"
                  required
                />
              </label>
              <label>
                Default unit cost (AUD)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={defaultUnitCost}
                  onChange={(event) => {
                    setDefaultUnitCost(event.target.value);
                  }}
                  required
                />
              </label>
              <label>
                Supplier preference
                <input
                  value={supplierPreference}
                  onChange={(event) => {
                    setSupplierPreference(event.target.value);
                  }}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="product-form__section">
            <legend>Barcode</legend>
            <div className="product-form__grid">
              <label>
                Barcode value
                <input
                  value={barcodeValue}
                  onChange={(event) => {
                    setBarcodeValue(event.target.value);
                  }}
                  placeholder="9301234567899"
                  required
                />
              </label>
              <label>
                Barcode format
                <select
                  value={barcodeFormat}
                  onChange={(event) => {
                    setBarcodeFormat(event.target.value as BarcodeFormat);
                  }}
                >
                  {BARCODE_FORMAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="product-form__section">
            <legend>Clinic stock</legend>
            <div className="product-form__grid">
              <label>
                Initial quantity on hand
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={initialQuantity}
                  onChange={(event) => {
                    setInitialQuantity(event.target.value);
                  }}
                  required
                />
              </label>
              <label>
                Reorder point
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={reorderPoint}
                  onChange={(event) => {
                    setReorderPoint(event.target.value);
                  }}
                  required
                />
              </label>
            </div>
          </fieldset>

          <div className="product-form__actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create product"}
            </button>
          </div>
        </form>

        {error ? <p className="status-card__error">{error}</p> : null}
      </section>
    </AppShell>
  );
}
