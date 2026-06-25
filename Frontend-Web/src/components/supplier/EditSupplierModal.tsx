import { useState } from "react";

import { createApiClient } from "../../api/client.js";
import { loadConfig } from "../../config/index.js";
import type { Supplier, UpdateSupplierRequest } from "../../types/supplier.js";

const apiClient = createApiClient(loadConfig());

type EditSupplierModalProps = {
  supplier: Supplier;
  onClose: () => void;
  onSaved: (updated: Supplier) => void;
};

export function EditSupplierModal({ supplier, onClose, onSaved }: EditSupplierModalProps) {
  const [supplierName, setSupplierName] = useState(supplier.supplierName);
  const [supplierCode, setSupplierCode] = useState(supplier.supplierCode ?? "");
  const [contactName, setContactName] = useState(supplier.contactName ?? "");
  const [email, setEmail] = useState(supplier.email ?? "");
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [website, setWebsite] = useState(supplier.website ?? "");
  const [notes, setNotes] = useState(supplier.notes ?? "");
  const [active, setActive] = useState(supplier.active);
  // Sprint 4C metadata
  const [legalName, setLegalName] = useState(supplier.legalName ?? "");
  const [tradingName, setTradingName] = useState(supplier.tradingName ?? "");
  const [supplierCategory, setSupplierCategory] = useState(supplier.supplierCategory ?? "");
  const [countryCode, setCountryCode] = useState(supplier.countryCode);
  const [currencyCode, setCurrencyCode] = useState(supplier.currencyCode);
  const [verified, setVerified] = useState(supplier.verified);
  const [catalogueAvailable, setCatalogueAvailable] = useState(supplier.catalogueAvailable);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    const trimmedName = supplierName.trim();
    if (!trimmedName) {
      setError("Supplier name is required.");
      return;
    }

    const trimmedCountry = countryCode.trim();
    if (trimmedCountry && trimmedCountry.length !== 2) {
      setError("Country code must be exactly 2 characters (e.g. AU).");
      return;
    }

    const trimmedCurrency = currencyCode.trim();
    if (trimmedCurrency && trimmedCurrency.length !== 3) {
      setError("Currency code must be exactly 3 characters (e.g. AUD).");
      return;
    }

    const body: UpdateSupplierRequest = {
      supplierName: trimmedName,
      supplierCode: supplierCode.trim() || null,
      contactName: contactName.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      website: website.trim() || null,
      notes: notes.trim() || null,
      active,
      legalName: legalName.trim() || null,
      tradingName: tradingName.trim() || null,
      supplierCategory: supplierCategory.trim() || null,
      countryCode: trimmedCountry || "AU",
      currencyCode: trimmedCurrency || "AUD",
      verified,
      catalogueAvailable,
    };

    setSubmitting(true);
    try {
      const updated = await apiClient.updateSupplier(supplier.id, body);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="supplier-modal-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-supplier-modal-title"
    >
      <div className="supplier-modal">
        <div className="supplier-modal__header">
          <h2 className="supplier-modal__title" id="edit-supplier-modal-title">
            Edit Supplier
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
              Supplier Name <span className="supplier-form__required">*</span>
            </span>
            <input
              type="text"
              className="supplier-form__control"
              value={supplierName}
              onChange={(e) => {
                setSupplierName(e.target.value);
              }}
              maxLength={200}
              disabled={submitting}
              autoFocus
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Supplier Code</span>
            <input
              type="text"
              className="supplier-form__control"
              value={supplierCode}
              onChange={(e) => {
                setSupplierCode(e.target.value);
              }}
              maxLength={50}
              placeholder="e.g. DCO"
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Contact Name</span>
            <input
              type="text"
              className="supplier-form__control"
              value={contactName}
              onChange={(e) => {
                setContactName(e.target.value);
              }}
              maxLength={200}
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Email</span>
            <input
              type="email"
              className="supplier-form__control"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Phone</span>
            <input
              type="text"
              className="supplier-form__control"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
              }}
              maxLength={50}
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Website</span>
            <input
              type="url"
              className="supplier-form__control"
              value={website}
              onChange={(e) => {
                setWebsite(e.target.value);
              }}
              placeholder="https://..."
              disabled={submitting}
            />
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

          <label className="supplier-form__field">
            <span className="supplier-form__label">Legal Name</span>
            <input
              type="text"
              className="supplier-form__control"
              value={legalName}
              onChange={(e) => {
                setLegalName(e.target.value);
              }}
              maxLength={500}
              placeholder="Registered business name"
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Trading Name</span>
            <input
              type="text"
              className="supplier-form__control"
              value={tradingName}
              onChange={(e) => {
                setTradingName(e.target.value);
              }}
              maxLength={500}
              placeholder="Public-facing name (if different)"
              disabled={submitting}
            />
          </label>

          <label className="supplier-form__field">
            <span className="supplier-form__label">Supplier Category</span>
            <input
              type="text"
              className="supplier-form__control"
              value={supplierCategory}
              onChange={(e) => {
                setSupplierCategory(e.target.value);
              }}
              maxLength={200}
              placeholder="e.g. Dental Supplies, Lab Equipment"
              disabled={submitting}
            />
          </label>

          <div className="supplier-form__row">
            <label className="supplier-form__field">
              <span className="supplier-form__label">Country Code</span>
              <input
                type="text"
                className="supplier-form__control"
                value={countryCode}
                onChange={(e) => {
                  setCountryCode(e.target.value.toUpperCase());
                }}
                maxLength={2}
                placeholder="AU"
                disabled={submitting}
              />
            </label>

            <label className="supplier-form__field">
              <span className="supplier-form__label">Currency</span>
              <input
                type="text"
                className="supplier-form__control"
                value={currencyCode}
                onChange={(e) => {
                  setCurrencyCode(e.target.value.toUpperCase());
                }}
                maxLength={3}
                placeholder="AUD"
                disabled={submitting}
              />
            </label>
          </div>

          <label className="supplier-form__checkbox-field">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => {
                setVerified(e.target.checked);
              }}
              disabled={submitting}
            />
            <span className="supplier-form__checkbox-label">Verified supplier</span>
          </label>

          <label className="supplier-form__checkbox-field">
            <input
              type="checkbox"
              checked={catalogueAvailable}
              onChange={(e) => {
                setCatalogueAvailable(e.target.checked);
              }}
              disabled={submitting}
            />
            <span className="supplier-form__checkbox-label">Digital catalogue available</span>
          </label>

          <label className="supplier-form__checkbox-field">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => {
                setActive(e.target.checked);
              }}
              disabled={submitting}
            />
            <span className="supplier-form__checkbox-label">Active</span>
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
            <button
              type="submit"
              className="supplier-form__submit"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
