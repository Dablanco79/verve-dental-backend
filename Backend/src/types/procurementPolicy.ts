/**
 * Procurement Policy domain types — Sprint 4E.
 *
 * A ProcurementPolicy stores the decision framework that future purchasing
 * intelligence will use to evaluate supplier choices for a clinic.
 *
 * SCOPE
 * ─────
 * A policy is either:
 *   • General        — applies to ALL products sourced via a supplier relationship
 *                      (master_catalog_item_id IS NULL)
 *   • Product-specific — applies to a single master catalog item
 *                        (master_catalog_item_id IS NOT NULL)
 *
 * PRIORITY MODEL
 * ──────────────
 * priority = 1 is the highest priority (preferred).
 * Higher numbers indicate lower priority (fallback, tertiary, …).
 * Only ONE preferred supplier (preferred_supplier = true) is allowed per active
 * (clinic_id, master_catalog_item_id) combination.
 *
 * FUTURE AI COMPATIBILITY
 * ────────────────────────
 * preferred_supplier, allow_fallback, fallback_priority,
 * price_difference_threshold_percent, and reorder_strategy are all present
 * so that future recommendation engines can evaluate them without schema changes.
 * No purchasing automation is implemented in this sprint.
 */

// ─── Status ───────────────────────────────────────────────────────────────────

export const PROCUREMENT_POLICY_STATUSES = ["active", "inactive"] as const;
export type ProcurementPolicyStatus =
  (typeof PROCUREMENT_POLICY_STATUSES)[number];

// ─── Reorder strategy ─────────────────────────────────────────────────────────

export const REORDER_STRATEGIES = [
  "standard",
  "economic_order_quantity",
  "just_in_time",
  "custom",
] as const;
export type ReorderStrategy = (typeof REORDER_STRATEGIES)[number];

// ─── Domain type ──────────────────────────────────────────────────────────────

export type ProcurementPolicy = {
  id: string;
  /** References clinics.id — tenant anchor. */
  clinicId: string;
  /** References supplier_relationships.id — the operational supplier connection. */
  supplierRelationshipId: string;
  /** NULL = general policy; NOT NULL = product-specific policy. */
  masterCatalogItemId: string | null;
  policyName: string;
  policyStatus: ProcurementPolicyStatus;
  /** 1 = highest priority (preferred). Higher number = lower priority. */
  priority: number;
  /** True when this policy's supplier is the preferred choice for clinic/product. */
  preferredSupplier: boolean;
  /** When true, the decision engine may fall back to lower-priority suppliers. */
  allowFallback: boolean;
  /** Fallback position in priority order. Must be > priority when set. */
  fallbackPriority: number | null;
  minimumOrderQuantity: number | null;
  /** Preferred day of week for placing orders (e.g. 'monday'). */
  preferredOrderDay: string | null;
  /** Preferred day of week for receiving deliveries (e.g. 'thursday'). */
  preferredDeliveryDay: string | null;
  /**
   * Maximum acceptable price difference vs preferred supplier (0–100 %).
   * Triggers approval flow when exceeded.
   */
  priceDifferenceThresholdPercent: number | null;
  approvalRequired: boolean;
  reorderStrategy: ReorderStrategy;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── Input types ──────────────────────────────────────────────────────────────

export type CreateProcurementPolicyInput = {
  supplierRelationshipId: string;
  masterCatalogItemId?: string | null;
  policyName: string;
  policyStatus?: ProcurementPolicyStatus;
  priority: number;
  preferredSupplier?: boolean;
  allowFallback?: boolean;
  fallbackPriority?: number | null;
  minimumOrderQuantity?: number | null;
  preferredOrderDay?: string | null;
  preferredDeliveryDay?: string | null;
  priceDifferenceThresholdPercent?: number | null;
  approvalRequired?: boolean;
  reorderStrategy?: ReorderStrategy;
  notes?: string | null;
};

export type UpdateProcurementPolicyInput = {
  policyName?: string;
  policyStatus?: ProcurementPolicyStatus;
  priority?: number;
  preferredSupplier?: boolean;
  allowFallback?: boolean;
  fallbackPriority?: number | null;
  minimumOrderQuantity?: number | null;
  preferredOrderDay?: string | null;
  preferredDeliveryDay?: string | null;
  priceDifferenceThresholdPercent?: number | null;
  approvalRequired?: boolean;
  reorderStrategy?: ReorderStrategy;
  notes?: string | null;
};
