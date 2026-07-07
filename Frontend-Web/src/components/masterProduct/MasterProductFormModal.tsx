import { useState } from "react";

import { createApiClient } from "../../api/client.js";
import { loadConfig } from "../../config/index.js";
import type {
  CreateMasterProductRequest,
  MasterProduct,
  MasterProductStatus,
  UpdateMasterProductRequest,
} from "../../types/masterProduct.js";

const apiClient = createApiClient(loadConfig());

type MasterProductFormModalProps = {
  /** When provided, the modal edits this product. Otherwise it creates a new one. */
  product?: MasterProduct;
  onClose: () => void;
  onSaved: (product: MasterProduct) => void;
};

export function MasterProductFormModal({ product, onClose, onSaved }: MasterProductFormModalProps) {
  const isEditing = product !== undefined;

  const [displayName, setDisplayName] = useState(product?.displayName ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [subcategory, setSubcategory] = useState(product?.subcategory ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [variantAttributes, setVariantAttributes] = useState(product?.variantAttributes ?? "");
  const [stockUnit, setStockUnit] = useState(product?.stockUnit ?? "");
  const [receivingUnit, setReceivingUnit] = useState(product?.receivingUnit ?? "");
  const [status, setStatus] = useState<MasterProductStatus>(product?.status ?? "active");
  const [notes, setNotes] = useState(product?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError("Display name is required.");
      return;
    }

    const trimmedCategory = category.trim();
    if (!trimmedCategory) {
      setError("Category is required.");
      return;
    }

    setSubmitting(true);
    try {
      if (isEditing) {
        const body: UpdateMasterProductRequest = {
          displayName: trimmedName,
          sku: sku.trim() || undefined,
          category: trimmedCategory,
          subcategory: subcategory.trim() || null,
          brand: brand.trim() || null,
          variantAttributes: variantAttributes.trim() || null,
          stockUnit: stockUnit.trim() || undefined,
          receivingUnit: receivingUnit.trim() || undefined,
          status,
          notes: notes.trim() || null,
        };
        const updated = await apiClient.updateMasterProduct(product.id, body);
        onSaved(updated);
      } else {
        const body: CreateMasterProductRequest = {
          displayName: trimmedName,
          sku: sku.trim() || undefined,
          category: trimmedCategory,
          subcategory: subcategory.trim() || null,
          brand: brand.trim() || null,
          variantAttributes: variantAttributes.trim() || null,
          stockUnit: stockUnit.trim() || undefined,
          receivingUnit: receivingUnit.trim() || undefined,
          status,
          notes: notes.trim() || null,
        };
        const created = await apiClient.createMasterProduct(body);
        onSaved(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save master product.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget) onClose();
  }

  const titleId = "master-product-modal-title";

  return (
    <div
      className="supplier-modal-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="supplier-modal">
        <div className="supplier-modal__header">
          <h2 className="supplier-modal__title" id={titleId}>
            {isEditing ? "Edit Master Product" : "Add Master Product"}
          </h2>
          <button
            type="button"
            className="supplier-modal__close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <form
          className="supplier-form"
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <label className="supplier-form__field">
            <span className="supplier-form__label">
              Display Name <span className="supplier-form__required">*</span>
            </span>
            <input
              type="text"
              className="supplier-form__control"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
              }}
              maxLength={255}
              placeholder="e.g. Nitrile Examination Gloves (Medium)"
              disabled={submitting}
              autoFocus
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">
              Category <span className="supplier-form__required">*</span>
            </span>
            <input
              type="text"
              className="supplier-form__control"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
              }}
              maxLength={128}
              placeholder="e.g. PPE"
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">SKU</span>
            <input
              type="text"
              className="supplier-form__control"
              value={sku}
              onChange={(e) => {
                setSku(e.target.value);
              }}
              maxLength={64}
              placeholder="Leave blank to auto-generate"
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Subcategory</span>
            <input
              type="text"
              className="supplier-form__control"
              value={subcategory}
              onChange={(e) => {
                setSubcategory(e.target.value);
              }}
              maxLength={128}
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Brand</span>
            <input
              type="text"
              className="supplier-form__control"
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
              }}
              maxLength={255}
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Variant Attributes</span>
            <input
              type="text"
              className="supplier-form__control"
              value={variantAttributes}
              onChange={(e) => {
                setVariantAttributes(e.target.value);
              }}
              maxLength={2000}
              placeholder="e.g. Size: Medium, Colour: Blue"
              disabled={submitting}
            />
          </label>

          <div className="supplier-form__row">
            <label className="supplier-form__field">
              <span className="supplier-form__label">Stock Unit</span>
              <input
                type="text"
                className="supplier-form__control"
                value={stockUnit}
                onChange={(e) => {
                  setStockUnit(e.target.value);
                }}
                maxLength={32}
                placeholder="Unit"
                disabled={submitting}
              />
            </label>

            <label className="supplier-form__field">
              <span className="supplier-form__label">Receiving Unit</span>
              <input
                type="text"
                className="supplier-form__control"
                value={receivingUnit}
                onChange={(e) => {
                  setReceivingUnit(e.target.value);
                }}
                maxLength={32}
                placeholder="Unit"
                disabled={submitting}
              />
            </label>
          </div>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Status</span>
            <select
              className="supplier-form__control"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as MasterProductStatus);
              }}
              disabled={submitting}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Notes</span>
            <textarea
              className="supplier-form__control supplier-form__textarea"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              maxLength={2000}
              rows={3}
              disabled={submitting}
            />
          </label>

          {error ? (
            <p className="supplier-form__error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="supplier-form__actions">
            <button
              type="button"
              className="supplier-form__cancel"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="supplier-form__submit" disabled={submitting}>
              {submitting
                ? isEditing
                  ? "Saving…"
                  : "Creating…"
                : isEditing
                  ? "Save Changes"
                  : "Create Master Product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
