import { useState } from "react";

import type { ProductCreationData, SupplierInvoiceLine } from "../../types/supplier.js";

// ── Static reference data ─────────────────────────────────────────────────────

const CATEGORIES = [
  "Dental Supplies",
  "Medical Supplies",
  "Consumables",
  "Medications",
  "Hygiene Products",
  "PPE",
  "Equipment",
  "Laboratory",
  "Imported Catalogue",
  "Other",
];

const UNITS = [
  "unit",
  "each",
  "box",
  "pack",
  "bottle",
  "tube",
  "vial",
  "pair",
  "roll",
  "sheet",
  "bag",
  "tray",
];

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  line: SupplierInvoiceLine;
  /** Pre-populated when the user is editing a previously saved decision. */
  initialData?: ProductCreationData | null;
  isSaving: boolean;
  onSave: (data: ProductCreationData) => void;
  onClose: () => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ProductCreationReviewModal({
  line,
  initialData,
  isSaving,
  onSave,
  onClose,
}: Props) {
  const [productName, setProductName] = useState(
    initialData?.productName ?? (line.ocrDescription ?? "").trim(),
  );
  const [category, setCategory] = useState(initialData?.category ?? "Dental Supplies");
  const [supplierSku, setSupplierSku] = useState(
    initialData?.supplierSku ?? (line.ocrSku ?? ""),
  );
  const [stockUnit, setStockUnit] = useState(initialData?.stockUnit ?? "unit");
  const [receivingUnit, setReceivingUnit] = useState(initialData?.receivingUnit ?? "unit");
  const [unitsPerReceivingUnit, setUnitsPerReceivingUnit] = useState(
    String(initialData?.unitsPerReceivingUnit ?? 1),
  );
  const [unitCostDollars, setUnitCostDollars] = useState(
    ((initialData?.unitCostCents ?? line.unitPriceCents) / 100).toFixed(2),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): void {
    e.preventDefault();
    setValidationError(null);

    const trimmedName = productName.trim();
    if (!trimmedName) {
      setValidationError("Product name is required.");
      return;
    }

    const trimmedCategory = category.trim();
    if (!trimmedCategory) {
      setValidationError("Category is required.");
      return;
    }

    const upru = parseInt(unitsPerReceivingUnit, 10);
    if (!Number.isInteger(upru) || upru < 1) {
      setValidationError("Units per receiving unit must be a positive whole number.");
      return;
    }

    const costRaw = parseFloat(unitCostDollars);
    if (isNaN(costRaw) || costRaw < 0) {
      setValidationError("Unit cost must be a non-negative number.");
      return;
    }

    const data: ProductCreationData = {
      productName: trimmedName,
      category: trimmedCategory,
      supplierSku: supplierSku.trim() || null,
      stockUnit: stockUnit.trim() || "unit",
      receivingUnit: receivingUnit.trim() || "unit",
      unitsPerReceivingUnit: upru,
      unitCostCents: Math.round(costRaw * 100),
    };

    onSave(data);
  }

  return (
    <div
      className="supplier-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-create-modal-title"
    >
      <div className="supplier-modal supplier-modal--wide">
        <div className="supplier-modal__header">
          <h2 className="supplier-modal__title" id="product-create-modal-title">
            Review New Product
          </h2>
          <button
            type="button"
            className="supplier-modal__close"
            onClick={onClose}
            aria-label="Close"
            disabled={isSaving}
          >
            ×
          </button>
        </div>

        <p className="supplier-modal__desc">
          Review the pre-filled product details before creating. This product will be added
          to the catalogue and clinic inventory when the invoice is confirmed. No stock will
          be added until receiving.
        </p>

        {validationError ? (
          <p className="status-card__error" role="alert">
            {validationError}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} noValidate>
          <div className="supplier-form__row">
            <label className="supplier-form__label" htmlFor="pcrm-product-name">
              Product Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="pcrm-product-name"
              type="text"
              className="supplier-form__input"
              value={productName}
              onChange={(e) => { setProductName(e.target.value); }}
              maxLength={255}
              required
              disabled={isSaving}
              autoFocus
            />
          </div>

          <div className="supplier-form__row">
            <label className="supplier-form__label" htmlFor="pcrm-category">
              Category <span aria-hidden="true">*</span>
            </label>
            <select
              id="pcrm-category"
              className="supplier-form__input"
              value={category}
              onChange={(e) => { setCategory(e.target.value); }}
              disabled={isSaving}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="supplier-form__row">
            <label className="supplier-form__label" htmlFor="pcrm-supplier-sku">
              Supplier SKU
            </label>
            <input
              id="pcrm-supplier-sku"
              type="text"
              className="supplier-form__input"
              value={supplierSku}
              onChange={(e) => { setSupplierSku(e.target.value); }}
              maxLength={128}
              disabled={isSaving}
            />
          </div>

          <div className="supplier-form__row supplier-form__row--inline">
            <div>
              <label className="supplier-form__label" htmlFor="pcrm-stock-unit">
                Stock Unit <span aria-hidden="true">*</span>
              </label>
              <select
                id="pcrm-stock-unit"
                className="supplier-form__input"
                value={stockUnit}
                onChange={(e) => { setStockUnit(e.target.value); }}
                disabled={isSaving}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="supplier-form__label" htmlFor="pcrm-receiving-unit">
                Receiving Unit <span aria-hidden="true">*</span>
              </label>
              <select
                id="pcrm-receiving-unit"
                className="supplier-form__input"
                value={receivingUnit}
                onChange={(e) => { setReceivingUnit(e.target.value); }}
                disabled={isSaving}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="supplier-form__label" htmlFor="pcrm-upru">
                Units per Receiving Unit <span aria-hidden="true">*</span>
              </label>
              <input
                id="pcrm-upru"
                type="number"
                className="supplier-form__input"
                value={unitsPerReceivingUnit}
                onChange={(e) => { setUnitsPerReceivingUnit(e.target.value); }}
                min="1"
                step="1"
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="supplier-form__row">
            <label className="supplier-form__label" htmlFor="pcrm-unit-cost">
              Unit Cost (AUD) <span aria-hidden="true">*</span>
            </label>
            <input
              id="pcrm-unit-cost"
              type="number"
              className="supplier-form__input"
              value={unitCostDollars}
              onChange={(e) => { setUnitCostDollars(e.target.value); }}
              min="0"
              step="0.01"
              disabled={isSaving}
            />
            {line.unitPriceCents === 0 ? (
              <p className="supplier-form__hint">
                This is a zero-price / free item. Unit cost will be $0.00 unless corrected.
              </p>
            ) : null}
          </div>

          <div className="supplier-form__actions">
            <button
              type="submit"
              className="supplier-form__submit"
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : "Save and Mark Ready to Create"}
            </button>
            <button
              type="button"
              className="supplier-form__cancel"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
