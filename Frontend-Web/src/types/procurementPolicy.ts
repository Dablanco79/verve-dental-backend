/**
 * Procurement Policy frontend types — Sprint 4E.
 *
 * These types mirror the backend domain types and are used by the API client
 * and any future UI components.  No pages or navigation changes in this sprint.
 *
 * A ProcurementPolicy stores the decision framework a future purchasing engine
 * will use to evaluate supplier choices for a clinic.
 */

export type ProcurementPolicyStatus = "active" | "inactive";

export type ReorderStrategy =
  | "standard"
  | "economic_order_quantity"
  | "just_in_time"
  | "custom";

export type ProcurementPolicy = {
  id: string;
  clinicId: string;
  supplierRelationshipId: string;
  /** null = general policy; non-null = product-specific policy */
  masterCatalogItemId: string | null;
  policyName: string;
  policyStatus: ProcurementPolicyStatus;
  /** 1 = highest priority (preferred). Higher number = lower priority. */
  priority: number;
  preferredSupplier: boolean;
  allowFallback: boolean;
  fallbackPriority: number | null;
  minimumOrderQuantity: number | null;
  preferredOrderDay: string | null;
  preferredDeliveryDay: string | null;
  /** 0–100 %. null = no threshold configured. */
  priceDifferenceThresholdPercent: number | null;
  approvalRequired: boolean;
  reorderStrategy: ReorderStrategy;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateProcurementPolicyRequest = {
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

export type UpdateProcurementPolicyRequest = {
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

export type ListProcurementPoliciesParams = {
  status?: ProcurementPolicyStatus;
};
