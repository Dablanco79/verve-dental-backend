import { useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

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

type FieldErrors = Partial<{
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  defaultUnitCost: string;
  barcodeValue: string;
  initialQuantity: string;
  reorderPoint: string;
}>;

/** True when the string contains a decimal point followed by more than two digits. */
function hasMoreThanTwoDecimalPlaces(value: string): boolean {
  const digits = /\.(\d+)$/.exec(value)?.[1];
  return digits !== undefined && digits.length > 2;
}

function dollarsToCents(value: string): number | null {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  // Safe to round here — callers must validate precision before invoking.
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!user) {
    return null;
  }

  // Render an explicit Access Denied panel instead of a silent redirect so
  // staff members receive actionable feedback.
  if (!canManageProducts(user.role)) {
    return (
      <AppShell>
        <section className="status-card">
          <h2>Access Denied</h2>
          <p className="status-card__error">
            You do not have permission to add products. Only practice managers
            and administrators can create inventory items.
          </p>
          <Link to="/inventory" className="link-button">
            Back to inventory
          </Link>
        </section>
      </AppShell>
    );
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!user) {
      return;
    }

    // Clear stale API errors at the very start of every attempt, even when
    // client-side validation is about to fail.
    setApiError(null);

    // --- Field-level validation (accumulate all errors so the user sees
    //     every issue in a single submission attempt) ---
    const errors: FieldErrors = {};

    if (!sku.trim()) {
      errors.sku = "SKU is required.";
    }
    if (!name.trim()) {
      errors.name = "Product name is required.";
    }
    if (!category.trim()) {
      errors.category = "Category is required.";
    }
    if (!unitOfMeasure.trim()) {
      errors.unitOfMeasure = "Unit of measure is required.";
    }
    if (!barcodeValue.trim()) {
      errors.barcodeValue = "Barcode value is required.";
    }

    // Compute once so the result can be reused in the API payload below
    // without a second conversion (which would require a non-null assertion).
    const defaultUnitCostCents = dollarsToCents(defaultUnitCost);
    if (hasMoreThanTwoDecimalPlaces(defaultUnitCost)) {
      errors.defaultUnitCost = "Unit cost can only have up to two decimal places.";
    } else if (defaultUnitCostCents === null) {
      errors.defaultUnitCost = "Enter a valid unit cost (e.g. 12.99).";
    }

    const parsedInitialQuantity = Number(initialQuantity);
    if (!Number.isInteger(parsedInitialQuantity) || parsedInitialQuantity < 0) {
      errors.initialQuantity = "Initial quantity must be a non-negative whole number.";
    }

    const parsedReorderPoint = Number(reorderPoint);
    if (!Number.isInteger(parsedReorderPoint) || parsedReorderPoint < 0) {
      errors.reorderPoint = "Reorder point must be a non-negative whole number.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});

    // TypeScript narrowing: both cost failure paths above add an error and
    // return, so defaultUnitCostCents is always non-null here. The explicit
    // null check replaces the forbidden ! operator.
    if (defaultUnitCostCents === null) {
      setFieldErrors({ defaultUnitCost: "Enter a valid unit cost (e.g. 12.99)." });
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
      setApiError(message);
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

              <div className="product-form__field">
                <label>
                  SKU
                  <input
                    value={sku}
                    onChange={(event) => { setSku(event.target.value); }}
                    placeholder="VRV-ANE-001"
                    aria-invalid={fieldErrors.sku ? true : undefined}
                    required
                  />
                </label>
                {fieldErrors.sku ? (
                  <p className="product-form__field-error" role="alert">{fieldErrors.sku}</p>
                ) : null}
              </div>

              <div className="product-form__field">
                <label>
                  Product name
                  <input
                    value={name}
                    onChange={(event) => { setName(event.target.value); }}
                    aria-invalid={fieldErrors.name ? true : undefined}
                    required
                  />
                </label>
                {fieldErrors.name ? (
                  <p className="product-form__field-error" role="alert">{fieldErrors.name}</p>
                ) : null}
              </div>

              <div className="product-form__field product-form__full">
                <label>
                  Description
                  <input
                    value={description}
                    onChange={(event) => { setDescription(event.target.value); }}
                  />
                </label>
              </div>

              <div className="product-form__field">
                <label>
                  Category
                  <input
                    value={category}
                    onChange={(event) => { setCategory(event.target.value); }}
                    placeholder="PPE"
                    aria-invalid={fieldErrors.category ? true : undefined}
                    required
                  />
                </label>
                {fieldErrors.category ? (
                  <p className="product-form__field-error" role="alert">{fieldErrors.category}</p>
                ) : null}
              </div>

              <div className="product-form__field">
                <label>
                  Unit of measure
                  <input
                    value={unitOfMeasure}
                    onChange={(event) => { setUnitOfMeasure(event.target.value); }}
                    placeholder="box"
                    aria-invalid={fieldErrors.unitOfMeasure ? true : undefined}
                    required
                  />
                </label>
                {fieldErrors.unitOfMeasure ? (
                  <p className="product-form__field-error" role="alert">{fieldErrors.unitOfMeasure}</p>
                ) : null}
              </div>

              <div className="product-form__field">
                <label>
                  Default unit cost (AUD)
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={defaultUnitCost}
                    onChange={(event) => { setDefaultUnitCost(event.target.value); }}
                    aria-invalid={fieldErrors.defaultUnitCost ? true : undefined}
                    required
                  />
                </label>
                {fieldErrors.defaultUnitCost ? (
                  <p className="product-form__field-error" role="alert">{fieldErrors.defaultUnitCost}</p>
                ) : null}
              </div>

              <div className="product-form__field">
                <label>
                  Supplier preference
                  <input
                    value={supplierPreference}
                    onChange={(event) => { setSupplierPreference(event.target.value); }}
                  />
                </label>
              </div>

            </div>
          </fieldset>

          <fieldset className="product-form__section">
            <legend>Barcode</legend>
            <div className="product-form__grid">

              <div className="product-form__field">
                <label>
                  Barcode value
                  <input
                    value={barcodeValue}
                    onChange={(event) => { setBarcodeValue(event.target.value); }}
                    placeholder="9301234567899"
                    aria-invalid={fieldErrors.barcodeValue ? true : undefined}
                    required
                  />
                </label>
                {fieldErrors.barcodeValue ? (
                  <p className="product-form__field-error" role="alert">{fieldErrors.barcodeValue}</p>
                ) : null}
              </div>

              <div className="product-form__field">
                <label>
                  Barcode format
                  <select
                    value={barcodeFormat}
                    onChange={(event) => { setBarcodeFormat(event.target.value as BarcodeFormat); }}
                  >
                    {BARCODE_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

            </div>
          </fieldset>

          <fieldset className="product-form__section">
            <legend>Clinic stock</legend>
            <div className="product-form__grid">

              <div className="product-form__field">
                <label>
                  Initial quantity on hand
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={initialQuantity}
                    onChange={(event) => { setInitialQuantity(event.target.value); }}
                    aria-invalid={fieldErrors.initialQuantity ? true : undefined}
                    required
                  />
                </label>
                {fieldErrors.initialQuantity ? (
                  <p className="product-form__field-error" role="alert">{fieldErrors.initialQuantity}</p>
                ) : null}
              </div>

              <div className="product-form__field">
                <label>
                  Reorder point
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={reorderPoint}
                    onChange={(event) => { setReorderPoint(event.target.value); }}
                    aria-invalid={fieldErrors.reorderPoint ? true : undefined}
                    required
                  />
                </label>
                {fieldErrors.reorderPoint ? (
                  <p className="product-form__field-error" role="alert">{fieldErrors.reorderPoint}</p>
                ) : null}
              </div>

            </div>
          </fieldset>

          <div className="product-form__actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create product"}
            </button>
          </div>
        </form>

        {apiError ? <p className="status-card__error">{apiError}</p> : null}
      </section>
    </AppShell>
  );
}
