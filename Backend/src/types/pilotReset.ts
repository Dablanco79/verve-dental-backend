/**
 * Pilot Reset Utility — shared domain types.
 *
 * These types are used across the repository, service, and controller layers.
 * They do NOT contain any database-specific or HTTP-specific details.
 */

export type PilotResetMode = "operational" | "full_pilot";

export type PilotResetClinic = {
  id: string;
  name: string;
};

/**
 * Counts of rows that WILL BE deleted (or soft-zeroed) by a reset.
 * All counters are zero for modes that do not touch that entity.
 */
export type PilotResetDeleteCounts = {
  purchasingDrafts: number;
  draftPurchaseOrders: number;
  draftPoLines: number;
  stocktakeSessions: number;
  stocktakeLines: number;
  supplierInvoices: number;
  supplierInvoiceLines: number;
  supplierPriceHistory: number;
  /** Full Pilot Reset only — zero in Operational Reset. */
  productSuppliers: number;
  supplierContractPrices: number;
  supplierContracts: number;
  procurementPolicies: number;
  supplierRelationships: number;
  /**
   * clinic_inventory_items rows that CAN be hard-deleted (not referenced by
   * inventory_adjustments, which are append-only and cannot be removed).
   * Full Pilot Reset only.
   */
  clinicInventoryItemsDeleted: number;
  /**
   * clinic_inventory_items rows that CANNOT be hard-deleted because they are
   * referenced by append-only inventory_adjustments.  These are soft-zeroed
   * (quantities reset to 0, configuration cleared) instead.
   * Full Pilot Reset only.
   */
  clinicInventoryItemsSoftZeroed: number;
};

export type PilotResetOrphanCounts = {
  /**
   * Count of master_catalog_items that would be globally unreferenced after a
   * Full Pilot Reset of this clinic.  These are CANDIDATES only — they are NOT
   * automatically deleted.  Manual cleanup via a separate future utility.
   */
  orphanMasterProductCandidates: number;
};

export type ActiveBlocker = {
  type: string;
  message: string;
};

export type PilotResetPreviewResponse = {
  clinic: PilotResetClinic;
  mode: PilotResetMode;
  deleteCounts: PilotResetDeleteCounts;
  orphanCounts: PilotResetOrphanCounts;
  preserved: string[];
  blockers: ActiveBlocker[];
  warnings: string[];
  previewExpiresAt: string;
  previewToken: string;
  /** Exact phrase the user must type to proceed with execution. */
  expectedConfirmationPhrase: string;
};

export type PostResetCheck = {
  name: string;
  passed: boolean;
  detail?: string;
};

export type PilotResetExecuteResponse = {
  clinic: PilotResetClinic;
  mode: PilotResetMode;
  deletedCounts: PilotResetDeleteCounts;
  preserved: string[];
  postResetChecks: PostResetCheck[];
  auditReference: string;
  completedAt: string;
};

/**
 * Nonce data stored in Redis / in-memory Map.
 * NEVER stores MFA codes, tokens, or other secrets.
 */
export type PreviewNonceData = {
  clinicId: string;
  clinicName: string;
  mode: PilotResetMode;
  /** Unix timestamp (ms) when this nonce expires. */
  expiresAt: number;
  used: boolean;
};
