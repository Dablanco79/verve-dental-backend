/**
 * Supplier Contract frontend types — Sprint 4F.
 *
 * These types mirror the backend domain types and are used by the API client
 * and any future UI components.  No pages or navigation changes in this sprint.
 *
 * Contracts are informational only — no purchasing behaviour changes.
 */

export type SupplierContractStatus = "active" | "expired" | "draft" | "terminated";

export type SupplierContract = {
  id: string;
  supplierRelationshipId: string;
  contractName: string;
  contractNumber: string | null;
  status: SupplierContractStatus;
  /** ISO date-time string */
  startDate: string;
  /** ISO date-time string */
  endDate: string;
  renewalNoticeDays: number;
  paymentTerms: string;
  freightTerms: string | null;
  minimumOrderValueCents: number | null;
  rebateDescription: string | null;
  estimatedAnnualCommitmentCents: number | null;
  annualSpendTargetCents: number | null;
  contractDocumentStorageKey: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSupplierContractRequest = {
  contractName: string;
  contractNumber?: string | null;
  status?: SupplierContractStatus;
  /** ISO date string, e.g. "2026-01-01" */
  startDate: string;
  /** ISO date string, e.g. "2026-12-31" */
  endDate: string;
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

export type UpdateSupplierContractRequest = {
  contractName?: string;
  contractNumber?: string | null;
  status?: SupplierContractStatus;
  startDate?: string;
  endDate?: string;
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

export type ListSupplierContractsParams = {
  status?: SupplierContractStatus;
};
