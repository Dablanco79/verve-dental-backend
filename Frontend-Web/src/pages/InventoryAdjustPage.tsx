import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import {
  ADJUSTMENT_REASONS,
  type AdjustInventoryResponse,
  type AdjustmentReason,
  type InventoryItem,
} from "../types/inventory.js";
import { canManageInventory } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ── Types ─────────────────────────────────────────────────────────────────────

type AdjustmentDirection = "increase" | "decrease";

type FormValues = {
  direction: AdjustmentDirection;
  quantity: string;
  reason: AdjustmentReason | "";
  notes: string;
};

type Step = "select" | "form" | "confirm" | "done";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function buildReasonString(reason: AdjustmentReason | "", notes: string): string {
  const trimmedNotes = notes.trim();
  if (!reason) return trimmedNotes;
  return trimmedNotes ? `${reason} — ${trimmedNotes}` : reason;
}

function validateForm(values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  const qty = parseInt(values.quantity, 10);
  if (!values.quantity.trim() || isNaN(qty) || qty <= 0) {
    errors.quantity = "Quantity must be a positive whole number.";
  }

  if (!values.reason) {
    errors.reason = "Please select a reason for this adjustment.";
  }

  if (values.notes.trim().length > 200) {
    errors.notes = "Notes must be 200 characters or fewer.";
  }

  return errors;
}

// ── Item selector ─────────────────────────────────────────────────────────────

type ItemSelectorProps = {
  items: InventoryItem[];
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (item: InventoryItem) => void;
};

function ItemSelector({ items, search, onSearchChange, onSelect }: ItemSelectorProps) {
  const lower = search.toLowerCase();
  const filtered = items.filter(
    (item) =>
      item.name.toLowerCase().includes(lower) ||
      item.masterSku.toLowerCase().includes(lower) ||
      item.category.toLowerCase().includes(lower),
  );

  return (
    <div className="adj-selector">
      <label htmlFor="adj-item-search" className="adj-selector__label">
        Search items
      </label>
      <input
        id="adj-item-search"
        type="search"
        className="adj-selector__search"
        placeholder="Product name, SKU, or category…"
        value={search}
        onChange={(e) => { onSearchChange(e.target.value); }}
        autoFocus
      />

      {filtered.length === 0 ? (
        <div className="billing-empty">
          <p className="billing-empty__title">No products match your search</p>
          <p className="billing-empty__hint">Try a different name or SKU.</p>
        </div>
      ) : (
        <div className="adj-selector__list" role="listbox" aria-label="Inventory items">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`adj-selector__item${item.isBelowReorderPoint ? " adj-selector__item--low" : ""}`}
              role="option"
              aria-selected={false}
              onClick={() => { onSelect(item); }}
            >
              <span className="adj-selector__item-name">{item.name}</span>
              <span className="adj-selector__item-meta">
                <span className="adj-selector__sku">{item.masterSku}</span>
                <span className="adj-selector__category">{item.category}</span>
              </span>
              <span className="adj-selector__stock">
                <strong>{item.quantityOnHand}</strong>
                {" "}
                {item.unitOfMeasure}
                {item.isBelowReorderPoint ? (
                  <span className="adj-selector__low-badge">Low stock</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Adjustment form ───────────────────────────────────────────────────────────

type AdjustFormProps = {
  item: InventoryItem;
  values: FormValues;
  errors: Record<string, string>;
  onChange: (partial: Partial<FormValues>) => void;
  onBack: () => void;
  onPreview: () => void;
};

function AdjustForm({ item, values, errors, onChange, onBack, onPreview }: AdjustFormProps) {
  const previewQty = parseInt(values.quantity, 10);
  const delta = values.direction === "increase" ? previewQty : -previewQty;
  const resulting = isNaN(previewQty) ? null : item.quantityOnHand + delta;

  return (
    <form
      className="adj-form"
      onSubmit={(e) => {
        e.preventDefault();
        onPreview();
      }}
      noValidate
    >
      <div className="adj-form__selected-item">
        <p className="adj-form__item-label">Adjusting</p>
        <p className="adj-form__item-name">{item.name}</p>
        <p className="adj-form__item-detail">
          {item.masterSku} · {item.category}
          {" · "}
          Current stock: <strong>{item.quantityOnHand} {item.unitOfMeasure}</strong>
        </p>
        {item.unitCostCents > 0 ? (
          <p className="adj-form__item-detail">
            Unit cost: {formatCurrency(item.unitCostOverrideCents ?? item.unitCostCents)}
          </p>
        ) : null}
      </div>

      <fieldset className="adj-form__fieldset">
        <legend className="adj-form__legend">Adjustment type</legend>
        <div className="adj-form__direction-group">
          <label className={`adj-form__direction-option${values.direction === "increase" ? " adj-form__direction-option--active" : ""}`}>
            <input
              type="radio"
              name="direction"
              value="increase"
              checked={values.direction === "increase"}
              onChange={() => { onChange({ direction: "increase" }); }}
            />
            <span>Increase stock</span>
          </label>
          <label className={`adj-form__direction-option${values.direction === "decrease" ? " adj-form__direction-option--active" : ""}`}>
            <input
              type="radio"
              name="direction"
              value="decrease"
              checked={values.direction === "decrease"}
              onChange={() => { onChange({ direction: "decrease" }); }}
            />
            <span>Decrease stock</span>
          </label>
        </div>
      </fieldset>

      <div className="adj-form__field">
        <label htmlFor="adj-quantity" className="adj-form__field-label">
          Quantity <span aria-hidden="true">*</span>
        </label>
        <input
          id="adj-quantity"
          type="number"
          className={`adj-form__field-input${errors.quantity ? " adj-form__field-input--error" : ""}`}
          min="1"
          step="1"
          value={values.quantity}
          onChange={(e) => { onChange({ quantity: e.target.value }); }}
          aria-describedby={errors.quantity ? "adj-quantity-error" : undefined}
          aria-required="true"
        />
        {errors.quantity ? (
          <p id="adj-quantity-error" className="adj-form__field-error" role="alert">
            {errors.quantity}
          </p>
        ) : null}
      </div>

      <div className="adj-form__field">
        <label htmlFor="adj-reason" className="adj-form__field-label">
          Reason <span aria-hidden="true">*</span>
        </label>
        <select
          id="adj-reason"
          className={`adj-form__field-input${errors.reason ? " adj-form__field-input--error" : ""}`}
          value={values.reason}
          onChange={(e) => { onChange({ reason: e.target.value as AdjustmentReason | "" }); }}
          aria-describedby={errors.reason ? "adj-reason-error" : undefined}
          aria-required="true"
        >
          <option value="">Select a reason…</option>
          {ADJUSTMENT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {errors.reason ? (
          <p id="adj-reason-error" className="adj-form__field-error" role="alert">
            {errors.reason}
          </p>
        ) : null}
      </div>

      <div className="adj-form__field">
        <label htmlFor="adj-notes" className="adj-form__field-label">
          Notes <span className="adj-form__optional">(optional)</span>
        </label>
        <textarea
          id="adj-notes"
          className={`adj-form__field-textarea${errors.notes ? " adj-form__field-input--error" : ""}`}
          rows={3}
          maxLength={200}
          placeholder="Additional context, reference numbers, etc."
          value={values.notes}
          onChange={(e) => { onChange({ notes: e.target.value }); }}
          aria-describedby={errors.notes ? "adj-notes-error" : "adj-notes-hint"}
        />
        <p id="adj-notes-hint" className="adj-form__field-hint">
          {values.notes.length}/200 characters
        </p>
        {errors.notes ? (
          <p id="adj-notes-error" className="adj-form__field-error" role="alert">
            {errors.notes}
          </p>
        ) : null}
      </div>

      {values.quantity && !isNaN(previewQty) && previewQty > 0 ? (
        <div className="adj-preview" aria-label="Stock preview">
          <div className="adj-preview__row">
            <span className="adj-preview__label">Current stock</span>
            <span className="adj-preview__value">
              {item.quantityOnHand} {item.unitOfMeasure}
            </span>
          </div>
          <div className="adj-preview__row adj-preview__row--delta">
            <span className="adj-preview__label">Adjustment</span>
            <span className={`adj-preview__value adj-preview__value--${values.direction}`}>
              {values.direction === "increase" ? "+" : "−"}{previewQty} {item.unitOfMeasure}
            </span>
          </div>
          <div className="adj-preview__row adj-preview__row--result">
            <span className="adj-preview__label">Resulting stock</span>
            <span className={`adj-preview__value adj-preview__value--result${resulting !== null && resulting < 0 ? " adj-preview__value--negative" : ""}`}>
              {resulting !== null ? `${String(resulting)} ${item.unitOfMeasure}` : "—"}
            </span>
          </div>
        </div>
      ) : null}

      <div className="adj-form__actions">
        <button type="button" className="link-button" onClick={onBack}>
          ← Back
        </button>
        <button type="submit" className="button-link">
          Review adjustment →
        </button>
      </div>
    </form>
  );
}

// ── Confirmation step ─────────────────────────────────────────────────────────

type ConfirmStepProps = {
  item: InventoryItem;
  values: FormValues;
  isSubmitting: boolean;
  onBack: () => void;
  onConfirm: () => void;
};

function ConfirmStep({ item, values, isSubmitting, onBack, onConfirm }: ConfirmStepProps) {
  const qty = parseInt(values.quantity, 10);
  const delta = values.direction === "increase" ? qty : -qty;
  const resulting = item.quantityOnHand + delta;
  const reasonFull = buildReasonString(values.reason, values.notes);

  return (
    <div className="adj-confirm">
      <h3 className="adj-confirm__heading">Confirm adjustment</h3>
      <p className="adj-confirm__subtitle">
        Review the details below, then confirm to apply the change.
      </p>

      <dl className="adj-confirm__summary">
        <dt>Product</dt>
        <dd>{item.name}</dd>

        <dt>SKU</dt>
        <dd>{item.masterSku}</dd>

        <dt>Category</dt>
        <dd>{item.category}</dd>

        <dt>Current stock</dt>
        <dd>{item.quantityOnHand} {item.unitOfMeasure}</dd>

        <dt>Adjustment</dt>
        <dd className={`adj-confirm__delta adj-confirm__delta--${values.direction}`}>
          {values.direction === "increase" ? "+" : "−"}{qty} {item.unitOfMeasure}
        </dd>

        <dt>Resulting stock</dt>
        <dd className={resulting < 0 ? "adj-confirm__negative" : ""}>
          {resulting} {item.unitOfMeasure}
          {resulting < 0 ? (
            <span className="adj-confirm__warning"> ⚠ This will result in negative stock.</span>
          ) : null}
        </dd>

        <dt>Reason</dt>
        <dd>{reasonFull || "—"}</dd>
      </dl>

      <div className="adj-confirm__actions">
        <button
          type="button"
          className="link-button"
          onClick={onBack}
          disabled={isSubmitting}
        >
          ← Edit
        </button>
        <button
          type="button"
          className="button-link"
          onClick={onConfirm}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Applying…" : "Confirm adjustment"}
        </button>
      </div>
    </div>
  );
}

// ── Success step ──────────────────────────────────────────────────────────────

type DoneStepProps = {
  result: AdjustInventoryResponse;
  onAnotherAdjustment: () => void;
};

function DoneStep({ result, onAnotherAdjustment }: DoneStepProps) {
  const { item, adjustment } = result;
  const isIncrease = adjustment.quantityDelta > 0;
  const absQty = Math.abs(adjustment.quantityDelta);

  return (
    <div className="adj-done">
      <p
        className={`inventory-notice${isIncrease ? " inventory-notice--receive" : ""}`}
        role="status"
      >
        {isIncrease
          ? `+${String(absQty)} ${item.unitOfMeasure} added to ${item.name} — now ${String(item.quantityOnHand)} ${item.unitOfMeasure} on hand.`
          : `−${String(absQty)} ${item.unitOfMeasure} removed from ${item.name} — now ${String(item.quantityOnHand)} ${item.unitOfMeasure} on hand.`}
      </p>

      <dl className="adj-confirm__summary">
        <dt>Product</dt>
        <dd>{item.name}</dd>
        <dt>Stock before</dt>
        <dd>{adjustment.quantityBefore} {item.unitOfMeasure}</dd>
        <dt>Adjustment</dt>
        <dd className={`adj-confirm__delta adj-confirm__delta--${isIncrease ? "increase" : "decrease"}`}>
          {isIncrease ? "+" : ""}{adjustment.quantityDelta} {item.unitOfMeasure}
        </dd>
        <dt>Stock after</dt>
        <dd>{adjustment.quantityAfter} {item.unitOfMeasure}</dd>
        <dt>Reason</dt>
        <dd>{adjustment.reason ?? "—"}</dd>
        <dt>Performed by</dt>
        <dd>{adjustment.performedByEmail}</dd>
        <dt>Time</dt>
        <dd>
          {new Date(adjustment.createdAt).toLocaleString("en-AU", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </dd>
      </dl>

      <div className="adj-done__actions">
        <button type="button" className="button-link" onClick={onAnotherAdjustment}>
          Make another adjustment
        </button>
        <Link to="/inventory/adjustments" className="link-button">
          View adjustment history
        </Link>
        <Link to="/inventory" className="link-button">
          Back to inventory
        </Link>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const EMPTY_FORM: FormValues = {
  direction: "increase",
  quantity: "",
  reason: "",
  notes: "",
};

export function InventoryAdjustPage() {
  const { user } = useAuth();
  const { selectedClinic, selectedDashboardScope } = useSelectedClinic();
  const selectedClinicId = selectedClinic?.id;
  const isAllClinicsScope = selectedDashboardScope?.type === "all_clinics";

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestIdRef = useRef({ id: 0 });

  const [step, setStep] = useState<Step>("select");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<AdjustInventoryResponse | null>(null);

  const loadItems = useCallback(async () => {
    if (!user) {
      setIsLoadingItems(false);
      return;
    }
    if (!selectedClinicId || isAllClinicsScope) {
      setItems([]);
      setIsLoadingItems(false);
      setLoadError(null);
      return;
    }
    const requestId = ++requestIdRef.current.id;
    setIsLoadingItems(true);
    setLoadError(null);
    try {
      const inventory = await apiClient.listInventory(selectedClinicId);
      if (requestId === requestIdRef.current.id) {
        setItems(inventory);
      }
    } catch (err: unknown) {
      if (requestId === requestIdRef.current.id) {
        setLoadError(err instanceof Error ? err.message : "Unable to load inventory");
      }
    } finally {
      if (requestId === requestIdRef.current.id) {
        setIsLoadingItems(false);
      }
    }
  }, [isAllClinicsScope, selectedClinicId, user]);

  useEffect(() => {
    void loadItems();
    const tracker = requestIdRef.current;
    return () => {
      tracker.id++;
    };
  }, [loadItems]);

  if (!user) return null;

  if (!canManageInventory(user.role)) {
    return <Navigate to="/inventory" replace />;
  }

  if (isAllClinicsScope) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to adjust inventory</h2>
          <p>
            Manual stock adjustments are clinic-specific. Choose a real clinic
            from Clinic scope before changing stock on hand.
          </p>
        </section>
      </AppShell>
    );
  }

  function handleSelectItem(item: InventoryItem) {
    setSelectedItem(item);
    setFormValues(EMPTY_FORM);
    setFormErrors({});
    setStep("form");
  }

  function handleFormChange(partial: Partial<FormValues>) {
    setFormValues((prev) => ({ ...prev, ...partial }));
    const changed = new Set(Object.keys(partial) as (keyof FormValues)[]);
    if ([...changed].some((k) => formErrors[k])) {
      setFormErrors((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([k]) => !changed.has(k as keyof FormValues)),
        ),
      );
    }
  }

  function handlePreview() {
    const errors = validateForm(formValues);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setStep("confirm");
  }

  async function handleConfirm() {
    if (!selectedItem || !user || !selectedClinicId) return;

    const qty = parseInt(formValues.quantity, 10);
    const delta = formValues.direction === "increase" ? qty : -qty;
    const reasonFull = buildReasonString(formValues.reason, formValues.notes);

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await apiClient.adjustInventory(selectedClinicId, {
        itemId: selectedItem.id,
        quantityDelta: delta,
        reason: reasonFull || undefined,
      });
      setResult(response);
      setStep("done");
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Unable to apply adjustment. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setStep("select");
    setSelectedItem(null);
    setItemSearch("");
    setFormValues(EMPTY_FORM);
    setFormErrors({});
    setSubmitError(null);
    setResult(null);
  }

  const stepLabels: Record<Step, string> = {
    select: "1. Select product",
    form: "2. Adjustment details",
    confirm: "3. Confirm",
    done: "Done",
  };

  return (
    <AppShell>
      <section className="status-card adj-page">
        <div className="status-card__header">
          <div>
            <h2>Adjust Inventory</h2>
            <p className="inventory-page__subtitle">
              {(selectedClinic?.name ?? user.homeClinicName)} — manual stock adjustment
            </p>
          </div>
          <div className="inventory-page__actions">
            <Link to="/inventory/adjustments" className="link-button">
              Adjustment history
            </Link>
            <Link to="/inventory" className="link-button">
              ← Back to inventory
            </Link>
          </div>
        </div>

        <div className="adj-steps" aria-label="Adjustment steps">
          {(["select", "form", "confirm"] as Step[]).map((s) => (
            <span
              key={s}
              className={`adj-steps__step${step === s ? " adj-steps__step--active" : ""}${
                (step === "form" && s === "select") ||
                (step === "confirm" && (s === "select" || s === "form")) ||
                step === "done"
                  ? " adj-steps__step--done"
                  : ""
              }`}
            >
              {stepLabels[s]}
            </span>
          ))}
        </div>

        {loadError ? (
          <p className="status-card__error" role="alert">
            {loadError}
          </p>
        ) : isLoadingItems && step === "select" ? (
          <p className="loading-message">Loading inventory…</p>
        ) : step === "select" ? (
          <ItemSelector
            items={items}
            search={itemSearch}
            onSearchChange={setItemSearch}
            onSelect={handleSelectItem}
          />
        ) : step === "form" && selectedItem ? (
          <AdjustForm
            item={selectedItem}
            values={formValues}
            errors={formErrors}
            onChange={handleFormChange}
            onBack={() => { setStep("select"); }}
            onPreview={handlePreview}
          />
        ) : step === "confirm" && selectedItem ? (
          <>
            {submitError ? (
              <p className="status-card__error" role="alert">
                {submitError}
              </p>
            ) : null}
            <ConfirmStep
              item={selectedItem}
              values={formValues}
              isSubmitting={isSubmitting}
              onBack={() => { setStep("form"); }}
              onConfirm={() => { void handleConfirm(); }}
            />
          </>
        ) : step === "done" && result ? (
          <DoneStep result={result} onAnotherAdjustment={handleReset} />
        ) : null}
      </section>
    </AppShell>
  );
}
