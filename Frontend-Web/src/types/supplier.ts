export type Supplier = {
  id: string;
  supplierName: string;
  supplierCode: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateSupplierRequest = {
  supplierName: string;
  supplierCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
};

export type UpdateSupplierRequest = {
  supplierName?: string;
  supplierCode?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  active?: boolean;
};

export type SupplierProduct = {
  id: string;
  supplierId: string;
  productId: string;
  supplierSku: string | null;
  supplierDescription: string | null;
  unitCostCents: number;
  unitOfMeasure: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SupplierInvoiceStatus = "pending_review" | "confirmed" | "voided";

export type SupplierInvoice = {
  id: string;
  clinicId: string;
  supplierId: string | null;
  supplierNameRaw: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  status: SupplierInvoiceStatus;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  currency: string;
  ocrProvider: string;
  ocrConfidence: number | null;
  originalFilename: string;
  fileMimeType: string;
  importedByUserId: string;
  importedByEmail: string;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  voidedByUserId: string | null;
  voidedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListSuppliersParams = {
  active?: boolean;
};

export type ListSupplierInvoicesParams = {
  status?: SupplierInvoiceStatus;
  supplierId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

export type SupplierInvoiceLine = {
  id: string;
  invoiceId: string;
  lineNumber: number;
  ocrDescription: string | null;
  ocrSku: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  taxRateBasisPoints: number;
  taxCents: number;
  masterCatalogItemId: string | null;
  supplierCatalogueId: string | null;
  isMatched: boolean;
  matchMethod: "exact_sku" | "name_match" | "manual" | null;
  createdAt: string;
  updatedAt: string;
};

export type UploadAndExtractResult = {
  invoice: SupplierInvoice;
  lines: SupplierInvoiceLine[];
  duplicateFileWarning: {
    existingInvoiceId: string;
    importedAt: string;
  } | null;
  duplicateInvoiceNumberWarning: {
    existingInvoiceId: string;
    existingStatus: SupplierInvoiceStatus;
  } | null;
};

export type ConfirmImportResult = {
  invoice: SupplierInvoice;
  priceUpdates: number;
};

export type UpdateSupplierInvoiceRequest = {
  supplierId?: string | null;
  supplierNameRaw?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
};

export type UpdateSupplierInvoiceLineRequest = {
  ocrDescription?: string;
  ocrSku?: string | null;
  quantity?: number;
  unitPriceCents?: number;
  taxRateBasisPoints?: number;
  masterCatalogItemId?: string | null;
  supplierCatalogueId?: string | null;
  isMatched?: boolean;
  matchMethod?: "exact_sku" | "name_match" | "manual" | null;
};
