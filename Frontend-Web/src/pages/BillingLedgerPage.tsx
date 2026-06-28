import React, { useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { useBilling } from "../hooks/useBilling.js";
import type { Invoice, InvoiceFilters, InvoiceStatus, PaymentMethod } from "../types/billing.js";
import { canManageBilling } from "../utils/roles.js";

// ── Utility helpers ────────────────────────────────────────────────────────────

function centsToDollars(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function sumCents(invoices: Invoice[], field: keyof Invoice): number {
  return invoices.reduce((acc, inv) => acc + (inv[field] as number), 0);
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partial",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
  cancelled: "Cancelled",
};

function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`billing-badge billing-badge--${status}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Settlement modal ───────────────────────────────────────────────────────────

const B2B_PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Internal Transfer" },
  { value: "other", label: "Bank Wire" },
];

type SettlementModalProps = {
  invoice: Invoice;
  onClose: () => void;
  onSubmit: (invoiceId: string, amountCents: number, method: PaymentMethod, ref: string, notes: string) => Promise<void>;
};

function SettlementModal({ invoice, onClose, onSubmit }: SettlementModalProps) {
  const defaultAmount = invoice.outstandingCents > 0
    ? (invoice.outstandingCents / 100).toFixed(2)
    : (invoice.totalCents / 100).toFixed(2);

  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [amountStr, setAmountStr] = useState(defaultAmount);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldError(null);

    const parsed = parseFloat(amountStr);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setFieldError("Amount must be a positive number.");
      return;
    }
    const amountCents = Math.round(parsed * 100);

    setSubmitting(true);
    try {
      await onSubmit(invoice.id, amountCents, method, reference.trim(), notes.trim());
      onClose();
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : "Settlement failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  const displayRef = invoice.invoiceNumber ?? invoice.id.slice(0, 8).toUpperCase();

  return (
    <div className="billing-modal-overlay" onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-labelledby="settlement-modal-title">
      <div className="billing-modal">
        <div className="billing-modal__header">
          <h2 className="billing-modal__title" id="settlement-modal-title">
            Record Internal Settlement
          </h2>
          <button
            type="button"
            className="billing-modal__close"
            onClick={onClose}
            aria-label="Close settlement modal"
          >
            ×
          </button>
        </div>

        <dl className="billing-modal__invoice-summary">
          <div className="billing-modal__summary-row">
            <dt>Invoice</dt>
            <dd>{displayRef}</dd>
          </div>
          <div className="billing-modal__summary-row">
            <dt>Vendor</dt>
            <dd>{invoice.patientName}</dd>
          </div>
          <div className="billing-modal__summary-row">
            <dt>Total</dt>
            <dd className="billing-modal__summary-amount">{centsToDollars(invoice.totalCents)}</dd>
          </div>
          <div className="billing-modal__summary-row">
            <dt>Outstanding</dt>
            <dd className="billing-modal__summary-amount billing-modal__summary-amount--outstanding">
              {centsToDollars(invoice.outstandingCents)}
            </dd>
          </div>
        </dl>

        <form className="billing-settlement-form" onSubmit={(e) => { void handleSubmit(e); }}>
          <label className="billing-settlement-form__field">
            <span>Payment Method</span>
            <select
              className="billing-settlement-form__control"
              value={method}
              onChange={(e) => { setMethod(e.target.value as PaymentMethod); }}
              disabled={submitting}
            >
              {B2B_PAYMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="billing-settlement-form__field">
            <span>Amount (AUD)</span>
            <div className="billing-settlement-form__amount-wrap">
              <span className="billing-settlement-form__currency">$</span>
              <input
                type="number"
                className="billing-settlement-form__control billing-settlement-form__control--amount"
                value={amountStr}
                onChange={(e) => { setAmountStr(e.target.value); }}
                min="0.01"
                step="0.01"
                placeholder="0.00"
                disabled={submitting}
                required
              />
            </div>
          </label>

          <label className="billing-settlement-form__field">
            <span>
              Reference Number
              <span className="billing-settlement-form__optional"> (optional)</span>
            </span>
            <input
              type="text"
              className="billing-settlement-form__control"
              value={reference}
              onChange={(e) => { setReference(e.target.value); }}
              placeholder="e.g. TT-20260615-001"
              maxLength={120}
              disabled={submitting}
            />
          </label>

          <label className="billing-settlement-form__field">
            <span>
              Notes
              <span className="billing-settlement-form__optional"> (optional)</span>
            </span>
            <textarea
              className="billing-settlement-form__control billing-settlement-form__textarea"
              value={notes}
              onChange={(e) => { setNotes(e.target.value); }}
              placeholder="Internal memo or reconciliation note…"
              rows={3}
              maxLength={500}
              disabled={submitting}
            />
          </label>

          {fieldError ? (
            <p className="billing-settlement-form__error" role="alert">
              {fieldError}
            </p>
          ) : null}

          <div className="billing-settlement-form__actions">
            <button
              type="button"
              className="billing-settlement-form__cancel"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="billing-settlement-form__submit"
              disabled={submitting}
            >
              {submitting ? "Recording…" : "Confirm Settlement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── KPI summary bar ────────────────────────────────────────────────────────────

function BillingKpiBar({ invoices }: { invoices: Invoice[] }) {
  const totalInvoiced = sumCents(invoices, "totalCents");
  const totalPaid = sumCents(invoices, "paidCents");
  const totalOutstanding = sumCents(invoices, "outstandingCents");
  const overdueCount = invoices.filter((inv) => inv.status === "overdue").length;

  return (
    <dl className="billing-kpi-bar">
      <div className="billing-kpi-bar__stat">
        <dt>Total Invoiced</dt>
        <dd>{centsToDollars(totalInvoiced)}</dd>
      </div>
      <div className="billing-kpi-bar__stat">
        <dt>Paid</dt>
        <dd className="billing-kpi-bar__dd--paid">{centsToDollars(totalPaid)}</dd>
      </div>
      <div className="billing-kpi-bar__stat">
        <dt>Outstanding</dt>
        <dd className={totalOutstanding > 0 ? "billing-kpi-bar__dd--outstanding" : undefined}>
          {centsToDollars(totalOutstanding)}
        </dd>
      </div>
      <div className="billing-kpi-bar__stat">
        <dt>Overdue</dt>
        <dd className={overdueCount > 0 ? "billing-kpi-bar__dd--overdue" : undefined}>
          {overdueCount} {overdueCount === 1 ? "invoice" : "invoices"}
        </dd>
      </div>
    </dl>
  );
}

// ── Expense overview table ─────────────────────────────────────────────────────

const SETTLEABLE_STATUSES: InvoiceStatus[] = ["issued", "partially_paid", "overdue"];

type InvoiceTableProps = {
  invoices: Invoice[];
  canSettle: boolean;
  onSettleClick: (invoice: Invoice) => void;
};

function InvoiceTable({ invoices, canSettle, onSettleClick }: InvoiceTableProps) {
  if (invoices.length === 0) {
    return (
      <div className="billing-empty">
        <p className="billing-empty__title">No invoices found</p>
        <p className="billing-empty__hint">Adjust the filters or check back later.</p>
      </div>
    );
  }

  return (
    <div className="billing-table-wrap">
      <table className="billing-table">
        <thead>
          <tr>
            <th className="billing-table__th">Invoice #</th>
            <th className="billing-table__th">Vendor / Description</th>
            <th className="billing-table__th">Status</th>
            <th className="billing-table__th billing-table__th--numeric">Subtotal</th>
            <th className="billing-table__th billing-table__th--numeric">Tax (GST)</th>
            <th className="billing-table__th billing-table__th--numeric">Total</th>
            <th className="billing-table__th billing-table__th--numeric">Outstanding</th>
            <th className="billing-table__th">Due</th>
            {canSettle ? <th className="billing-table__th billing-table__th--action" /> : null}
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const isOverdue = inv.status === "overdue";
            const isSettleable = canSettle && SETTLEABLE_STATUSES.includes(inv.status);
            return (
              <tr
                key={inv.id}
                className={`billing-table__row${isOverdue ? " billing-table__row--overdue" : ""}`}
              >
                <td className="billing-table__td billing-table__td--mono">
                  {inv.invoiceNumber ?? <span className="billing-table__draft-tag">Draft</span>}
                </td>
                <td className="billing-table__td">
                  <span className="billing-table__vendor">{inv.patientName}</span>
                  {inv.notes ? (
                    <span className="billing-table__notes">{inv.notes}</span>
                  ) : null}
                </td>
                <td className="billing-table__td">
                  <StatusBadge status={inv.status} />
                </td>
                <td className="billing-table__td billing-table__td--numeric">
                  {centsToDollars(inv.subtotalCents)}
                </td>
                <td className="billing-table__td billing-table__td--numeric">
                  {centsToDollars(inv.taxCents)}
                </td>
                <td className="billing-table__td billing-table__td--numeric billing-table__td--total">
                  {centsToDollars(inv.totalCents)}
                </td>
                <td
                  className={`billing-table__td billing-table__td--numeric${
                    inv.outstandingCents > 0 ? " billing-table__td--outstanding" : ""
                  }`}
                >
                  {centsToDollars(inv.outstandingCents)}
                </td>
                <td className="billing-table__td">{formatDate(inv.dueAt)}</td>
                {canSettle ? (
                  <td className="billing-table__td billing-table__td--action">
                    {isSettleable ? (
                      <button
                        type="button"
                        className="billing-settle-btn"
                        onClick={() => { onSettleClick(inv); }}
                      >
                        Record Settlement
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="billing-table__footer-row">
            <td colSpan={canSettle ? 3 : 2} className="billing-table__td billing-table__td--footer-label">
              Totals ({invoices.length} {invoices.length === 1 ? "invoice" : "invoices"})
            </td>
            <td className="billing-table__td billing-table__td--numeric billing-table__td--footer">
              {centsToDollars(sumCents(invoices, "subtotalCents"))}
            </td>
            <td className="billing-table__td billing-table__td--numeric billing-table__td--footer">
              {centsToDollars(sumCents(invoices, "taxCents"))}
            </td>
            <td className="billing-table__td billing-table__td--numeric billing-table__td--footer billing-table__td--total">
              {centsToDollars(sumCents(invoices, "totalCents"))}
            </td>
            <td className="billing-table__td billing-table__td--numeric billing-table__td--footer billing-table__td--outstanding">
              {centsToDollars(sumCents(invoices, "outstandingCents"))}
            </td>
            <td colSpan={canSettle ? 2 : 1} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Filters bar ────────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS: { value: InvoiceStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "issued", label: "Issued" },
  { value: "partially_paid", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "void", label: "Void" },
  { value: "cancelled", label: "Cancelled" },
];

type FiltersBarProps = {
  filters: InvoiceFilters;
  onChange: (next: InvoiceFilters) => void;
};

function FiltersBar({ filters, onChange }: FiltersBarProps) {
  return (
    <div className="billing-filters">
      <label className="billing-filters__field">
        <span className="billing-filters__label">Status</span>
        <select
          className="billing-filters__control"
          value={filters.status ?? ""}
          onChange={(e) => {
            onChange({ ...filters, status: e.target.value as InvoiceStatus | "" });
          }}
        >
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="billing-filters__field">
        <span className="billing-filters__label">From</span>
        <input
          type="date"
          className="billing-filters__control"
          value={filters.from ?? ""}
          onChange={(e) => { onChange({ ...filters, from: e.target.value || undefined }); }}
        />
      </label>

      <label className="billing-filters__field">
        <span className="billing-filters__label">To</span>
        <input
          type="date"
          className="billing-filters__control"
          value={filters.to ?? ""}
          onChange={(e) => { onChange({ ...filters, to: e.target.value || undefined }); }}
        />
      </label>

      <button
        type="button"
        className="billing-filters__clear"
        onClick={() => { onChange({}); }}
      >
        Clear
      </button>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function BillingLedgerPage() {
  const { user } = useAuth();
  const { clinicId, clinicName, isAllClinicsScope } = useOperationalClinic();
  const [filters, setFilters] = useState<InvoiceFilters>({});
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);

  const { invoices, isLoading, error, refetch, recordSettlement } = useBilling(
    clinicId,
    filters,
  );

  if (!user) return null;

  if (!canManageBilling(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (isAllClinicsScope) {
    return (
      <AppShell>
        <section className="status-card inventory-receiving-callout" role="status">
          <h2>Select a clinic to view billing</h2>
          <p>
            The billing ledger is clinic-specific. Choose a clinic from the clinic selector to
            view invoices and record settlements.
          </p>
        </section>
      </AppShell>
    );
  }

  const canSettle = canManageBilling(user.role);

  async function handleSettlement(
    invoiceId: string,
    amountCents: number,
    method: PaymentMethod,
    ref: string,
    notes: string,
  ): Promise<void> {
    await recordSettlement(invoiceId, {
      paymentMethod: method,
      amountCents,
      referenceNumber: ref || null,
      notes: notes || null,
      transactionAt: new Date().toISOString(),
    });
  }

  return (
    <AppShell>
      <section className="status-card">
        <div className="status-card__header">
          <div>
            <h2>Internal Billing Ledger</h2>
            <p className="inventory-page__subtitle">
              {clinicName ?? user.homeClinicName} — operational costs, vendor balances &amp; settlements
            </p>
          </div>
          <div className="inventory-page__actions">
            <button
              type="button"
              className="button-link"
              onClick={refetch}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="status-card__error" role="alert">{error}</p>
        ) : isLoading ? (
          <p className="loading-message">Loading invoice ledger…</p>
        ) : (
          <>
            <BillingKpiBar invoices={invoices} />

            <FiltersBar filters={filters} onChange={setFilters} />

            <InvoiceTable
              invoices={invoices}
              canSettle={canSettle}
              onSettleClick={setActiveInvoice}
            />
          </>
        )}
      </section>

      {activeInvoice ? (
        <SettlementModal
          invoice={activeInvoice}
          onClose={() => { setActiveInvoice(null); }}
          onSubmit={handleSettlement}
        />
      ) : null}
    </AppShell>
  );
}
