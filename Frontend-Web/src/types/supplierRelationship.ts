/**
 * Supplier Relationship frontend types — Sprint 4D.
 *
 * These types mirror the backend domain types and are used by the API client
 * and any future UI components.  No pages or navigation changes in this sprint.
 */

export type SupplierRelationshipStatus = "active" | "inactive";

export type SupplierRelationship = {
  id: string;
  supplierId: string;
  clinicId: string;
  relationshipStatus: SupplierRelationshipStatus;
  preferredSupplier: boolean;
  accountNumber: string | null;
  customerNumber: string | null;
  creditTerms: string | null;
  creditLimitCents: number | null;
  orderingEmail: string | null;
  deliveryAddress: string | null;
  invoiceAddress: string | null;
  representativeName: string | null;
  representativeEmail: string | null;
  representativePhone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSupplierRelationshipRequest = {
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

export type UpdateSupplierRelationshipRequest = {
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

export type ListSupplierRelationshipsParams = {
  status?: SupplierRelationshipStatus;
};
