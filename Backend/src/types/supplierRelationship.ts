/**
 * Supplier Relationship domain types — Sprint 4D.
 *
 * A SupplierRelationship is a junction between a global Supplier Master
 * record and a Clinic (operational entity).  It stores clinic-specific
 * commercial information that should NOT live on the global supplier record:
 *
 *   • Account / customer numbers assigned by the supplier to this clinic
 *   • Credit terms and limits negotiated with this clinic
 *   • Preferred ordering and delivery contacts / addresses
 *   • Representative details for the account
 *
 * The Supplier Master remains the single source of truth for:
 *   • Supplier name, ABN, website, logo, capabilities, category
 *   • Global pricing (supplier_catalogue)
 *
 * Future compatibility:
 *   clinic_id is used today because clinics are the operational entity.
 *   If an OperationalEntity abstraction is introduced in a future sprint,
 *   the FK reference can be updated without a data migration — the UUID
 *   column name communicates today's reality without over-engineering.
 */

// ─── Status ───────────────────────────────────────────────────────────────────

export const SUPPLIER_RELATIONSHIP_STATUSES = ["active", "inactive"] as const;

export type SupplierRelationshipStatus =
  (typeof SUPPLIER_RELATIONSHIP_STATUSES)[number];

// ─── Domain type ──────────────────────────────────────────────────────────────

export type SupplierRelationship = {
  id: string;
  /** References suppliers.id (Supplier Master) */
  supplierId: string;
  /** References clinics.id (Operational Entity) */
  clinicId: string;
  /** 'active' = trading; 'inactive' = soft-deactivated. No hard delete. */
  relationshipStatus: SupplierRelationshipStatus;
  /** When true this is the clinic's preferred supplier for a given category. */
  preferredSupplier: boolean;
  /** Supplier-assigned account number for this clinic. */
  accountNumber: string | null;
  /** Supplier-assigned customer number for this clinic. */
  customerNumber: string | null;
  /** e.g. "30 days net", "COD", "EOM +14" */
  creditTerms: string | null;
  /** Approved credit limit in integer cents (AUD). */
  creditLimitCents: number | null;
  /** Email address used for placing orders with this supplier. */
  orderingEmail: string | null;
  /** Physical delivery address for this clinic. */
  deliveryAddress: string | null;
  /** Address to which supplier invoices should be sent. */
  invoiceAddress: string | null;
  /** Name of the supplier's account representative for this clinic. */
  representativeName: string | null;
  /** Email of the supplier's account representative. */
  representativeEmail: string | null;
  /** Phone of the supplier's account representative. */
  representativePhone: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ─── Input types ──────────────────────────────────────────────────────────────

export type CreateSupplierRelationshipInput = {
  supplierId: string;
  relationshipStatus?: SupplierRelationshipStatus;
  preferredSupplier?: boolean;
  accountNumber?: string | null;
  customerNumber?: string | null;
  creditTerms?: string | null;
  creditLimitCents?: number | null;
  orderingEmail?: string | null;
  deliveryAddress?: string | null;
  invoiceAddress?: string | null;
  representativeName?: string | null;
  representativeEmail?: string | null;
  representativePhone?: string | null;
  notes?: string | null;
};

export type UpdateSupplierRelationshipInput = {
  relationshipStatus?: SupplierRelationshipStatus;
  preferredSupplier?: boolean;
  accountNumber?: string | null;
  customerNumber?: string | null;
  creditTerms?: string | null;
  creditLimitCents?: number | null;
  orderingEmail?: string | null;
  deliveryAddress?: string | null;
  invoiceAddress?: string | null;
  representativeName?: string | null;
  representativeEmail?: string | null;
  representativePhone?: string | null;
  notes?: string | null;
};
