/**
 * Supplier Contract domain types — Sprint 4F.
 *
 * A SupplierContract is a commercial agreement between a clinic (via its
 * Supplier Relationship) and a supplier.  Contracts are informational only
 * in this sprint — no purchasing behaviour changes.
 *
 * Commercial intelligence model (future):
 *   This schema is designed to evolve into the commercial intelligence layer.
 *   Fields such as estimatedAnnualCommitmentCents, annualSpendTargetCents,
 *   minimumOrderValueCents, rebateDescription and freightTerms are intentionally
 *   stored now so AI contract analysis, renewal reminders, and performance
 *   tracking can be introduced without a schema redesign.
 *
 *   contractDocumentStorageKey represents the currently active contract
 *   document.  Future document versioning may evolve from this field.
 *
 * Business rules:
 *   • Only one ACTIVE contract per Supplier Relationship at any time.
 *   • No hard deletes — expire or terminate only.
 *   • End date must be after start date.
 *   • Renewal notice days must be >= 0.
 *   • Monetary amounts cannot be negative.
 */

// ─── Status ───────────────────────────────────────────────────────────────────

export const SUPPLIER_CONTRACT_STATUSES = [
  "active",
  "expired",
  "draft",
  "terminated",
] as const;

export type SupplierContractStatus =
  (typeof SUPPLIER_CONTRACT_STATUSES)[number];

// ─── Domain type ──────────────────────────────────────────────────────────────

export type SupplierContract = {
  id: string;
  /** References supplier_relationships.id */
  supplierRelationshipId: string;
  /** Human-readable name, e.g. "2026 Supply Agreement" */
  contractName: string;
  /** Supplier-assigned contract number, if provided. Not required to be unique. */
  contractNumber: string | null;
  /** 'active' = current; 'expired' = past end date; 'draft' = not yet in effect;
   *  'terminated' = ended early. No hard delete. */
  status: SupplierContractStatus;
  /** Contract effective start date. */
  startDate: Date;
  /** Contract expiry date. Must be after startDate. */
  endDate: Date;
  /** Days before endDate to notify for renewal. Default 0. */
  renewalNoticeDays: number;
  /** Payment terms, e.g. "30 days net", "COD", "EOM +14". */
  paymentTerms: string;
  /** Freight terms, e.g. "Free over $500". */
  freightTerms: string | null;
  /** Minimum order value in integer cents (AUD). */
  minimumOrderValueCents: number | null;
  /**
   * Narrative description of any volume rebate arrangement.
   * Future: rebate programmes may move to a dedicated rebate_tiers table.
   */
  rebateDescription: string | null;
  /** Estimated total spend commitment over the contract term, in cents. */
  estimatedAnnualCommitmentCents: number | null;
  /** Internal annual spend target against this contract, in cents. */
  annualSpendTargetCents: number | null;
  /**
   * Storage key (e.g. S3 object key) for the current contract document.
   * Future: a contract_documents table may version-control documents without
   * requiring a change to this column.
   */
  contractDocumentStorageKey: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── Input types ──────────────────────────────────────────────────────────────

export type CreateSupplierContractInput = {
  contractName: string;
  contractNumber?: string | null;
  status?: SupplierContractStatus;
  startDate: Date;
  endDate: Date;
  renewalNoticeDays?: number;
  paymentTerms: string;
  freightTerms?: string | null;
  minimumOrderValueCents?: number | null;
  rebateDescription?: string | null;
  estimatedAnnualCommitmentCents?: number | null;
  annualSpendTargetCents?: number | null;
  contractDocumentStorageKey?: string | null;
  notes?: string | null;
};

export type UpdateSupplierContractInput = {
  contractName?: string;
  contractNumber?: string | null;
  status?: SupplierContractStatus;
  startDate?: Date;
  endDate?: Date;
  renewalNoticeDays?: number;
  paymentTerms?: string;
  freightTerms?: string | null;
  minimumOrderValueCents?: number | null;
  rebateDescription?: string | null;
  estimatedAnnualCommitmentCents?: number | null;
  annualSpendTargetCents?: number | null;
  contractDocumentStorageKey?: string | null;
  notes?: string | null;
};
