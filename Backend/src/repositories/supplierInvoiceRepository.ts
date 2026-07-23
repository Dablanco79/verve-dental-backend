/**
 * Supplier Invoice Repository — interface + in-memory implementation.
 *
 * The in-memory implementation is used in development (no DATABASE_URL)
 * and in the Jest test suite.  The PostgreSQL implementation lives in
 * supplierInvoiceRepository.postgres.ts.
 */

import { randomUUID } from "node:crypto";

import type {
  AddSupplierInvoiceLineInput,
  CreateSupplierInvoiceInput,
  DuplicateFileWarning,
  DuplicateInvoiceNumberWarning,
  ListSupplierInvoicesOptions,
  SupplierInvoice,
  SupplierInvoiceLine,
  SupplierInvoiceStatus,
  SupplierPriceHistory,
  UpdateSupplierInvoiceInput,
  UpdateSupplierInvoiceLineInput,
} from "../types/supplierInvoice.js";

// ── Interface ─────────────────────────────────────────────────────────────────

export interface SupplierInvoiceRepository {
  // ── Invoice header CRUD ────────────────────────────────────────────────────

  createSupplierInvoice(
    input: CreateSupplierInvoiceInput,
  ): Promise<SupplierInvoice>;

  findById(clinicId: string, id: string): Promise<SupplierInvoice | null>;

  listSupplierInvoices(
    clinicId: string,
    options?: ListSupplierInvoicesOptions,
  ): Promise<SupplierInvoice[]>;

  updateSupplierInvoice(
    clinicId: string,
    id: string,
    patch: UpdateSupplierInvoiceInput,
  ): Promise<SupplierInvoice | null>;

  setStatus(
    clinicId: string,
    id: string,
    status: SupplierInvoiceStatus,
    extra?: {
      confirmedByUserId?: string;
      confirmedAt?: Date;
      voidedByUserId?: string;
      voidedAt?: Date;
    },
  ): Promise<SupplierInvoice | null>;

  clearTemporaryExtractionData(
    clinicId: string,
    invoiceId: string,
  ): Promise<void>;

  // ── Receiving lifecycle ────────────────────────────────────────────────────

  /**
   * Mark an invoice as physically received.
   * Called only after all inventory updates for the receiving action complete.
   *
   * @param receivedReference  Optional invoice/delivery reference note.
   */
  markReceived(
    clinicId: string,
    invoiceId: string,
    receivedByUserId: string,
    receivedReference: string | null,
  ): Promise<SupplierInvoice | null>;

  // ── Duplicate detection ────────────────────────────────────────────────────

  findDuplicateFile(
    clinicId: string,
    sha256: string,
    excludeId?: string,
  ): Promise<DuplicateFileWarning | null>;

  findDuplicateInvoiceNumber(
    clinicId: string,
    supplierId: string,
    invoiceNumber: string,
    excludeId?: string,
  ): Promise<DuplicateInvoiceNumberWarning | null>;

  // ── Line items ────────────────────────────────────────────────────────────

  addLine(input: AddSupplierInvoiceLineInput): Promise<SupplierInvoiceLine>;

  findLineById(
    clinicId: string,
    lineId: string,
  ): Promise<SupplierInvoiceLine | null>;

  listLines(
    clinicId: string,
    invoiceId: string,
  ): Promise<SupplierInvoiceLine[]>;

  updateLine(
    clinicId: string,
    lineId: string,
    patch: UpdateSupplierInvoiceLineInput,
  ): Promise<SupplierInvoiceLine | null>;

  removeLine(clinicId: string, lineId: string): Promise<void>;

  removeLinesForInvoice(clinicId: string, invoiceId: string): Promise<void>;

  // ── Supplier catalogue pricing upsert ─────────────────────────────────────

  upsertSupplierCataloguePrice(
    supplierId: string,
    masterCatalogItemId: string,
    newUnitCostCents: number,
    supplierSku: string | null,
  ): Promise<{ catalogueId: string; oldUnitCostCents: number | null }>;

  // ── Price history ─────────────────────────────────────────────────────────

  insertPriceHistory(
    record: Omit<SupplierPriceHistory, "id" | "createdAt">,
  ): Promise<SupplierPriceHistory>;
}

// ── In-memory implementation ──────────────────────────────────────────────────

export function createInMemorySupplierInvoiceRepository(): SupplierInvoiceRepository {
  const invoices: SupplierInvoice[] = [];
  const lines: SupplierInvoiceLine[] = [];
  const priceHistory: SupplierPriceHistory[] = [];

  // Simulated supplier_catalogue store for in-memory price upserts.
  const cataloguePrices: Map<
    string,
    { id: string; unitCostCents: number }
  > = new Map();

  return {
    // ── Invoice header CRUD ────────────────────────────────────────────────

    createSupplierInvoice(
      input: CreateSupplierInvoiceInput,
    ): Promise<SupplierInvoice> {
      const now = new Date();
      const invoice: SupplierInvoice = {
        id: randomUUID(),
        clinicId: input.clinicId,
        supplierId: input.supplierId,
        supplierNameRaw: input.supplierNameRaw,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        status: "ready_for_review",
        subtotalCents: input.subtotalCents,
        taxCents: input.taxCents,
        totalCents: input.totalCents,
        currency: "AUD",
        ocrProvider: input.ocrProvider,
        ocrConfidence: input.ocrConfidence,
        ocrRawResponse: input.ocrRawResponse,
        originalFilename: input.originalFilename,
        fileMimeType: input.fileMimeType,
        fileSha256: input.fileSha256,
        storageKey: null,
        importedByUserId: input.importedByUserId,
        importedByEmail: input.importedByEmail,
        confirmedByUserId: null,
        confirmedAt: null,
        voidedByUserId: null,
        voidedAt: null,
        receivedAt: null,
        receivedByUserId: null,
        receivedReference: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
      };
      invoices.push(invoice);
      return Promise.resolve({ ...invoice });
    },

    findById(
      clinicId: string,
      id: string,
    ): Promise<SupplierInvoice | null> {
      const found = invoices.find(
        (inv) => inv.id === id && inv.clinicId === clinicId,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    listSupplierInvoices(
      clinicId: string,
      options: ListSupplierInvoicesOptions = {},
    ): Promise<SupplierInvoice[]> {
      let result = invoices.filter((inv) => inv.clinicId === clinicId);

      if (options.status) {
        result = result.filter((inv) => inv.status === options.status);
      }
      if (options.supplierId) {
        result = result.filter((inv) => inv.supplierId === options.supplierId);
      }
      if (options.from) {
        const from = options.from;
        result = result.filter(
          (inv) => inv.createdAt.toISOString().slice(0, 10) >= from,
        );
      }
      if (options.to) {
        const to = options.to;
        result = result.filter(
          (inv) => inv.createdAt.toISOString().slice(0, 10) <= to,
        );
      }

      result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const offset = options.offset ?? 0;
      const limit = options.limit ?? 50;
      return Promise.resolve(
        result.slice(offset, offset + limit).map((inv) => ({ ...inv })),
      );
    },

    updateSupplierInvoice(
      clinicId: string,
      id: string,
      patch: UpdateSupplierInvoiceInput,
    ): Promise<SupplierInvoice | null> {
      const idx = invoices.findIndex(
        (inv) => inv.id === id && inv.clinicId === clinicId,
      );
      if (idx === -1) return Promise.resolve(null);

      const existing = invoices[idx];
      if (!existing) return Promise.resolve(null);

      const updated: SupplierInvoice = {
        ...existing,
        ...(patch.supplierId !== undefined && { supplierId: patch.supplierId }),
        ...(patch.supplierNameRaw !== undefined && {
          supplierNameRaw: patch.supplierNameRaw,
        }),
        ...(patch.invoiceNumber !== undefined && {
          invoiceNumber: patch.invoiceNumber,
        }),
        ...(patch.invoiceDate !== undefined && {
          invoiceDate: patch.invoiceDate,
        }),
        ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
        ...(patch.notes !== undefined && { notes: patch.notes }),
        updatedAt: new Date(),
      };
      invoices[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    setStatus(
      clinicId: string,
      id: string,
      status: SupplierInvoiceStatus,
      extra: {
        confirmedByUserId?: string;
        confirmedAt?: Date;
        voidedByUserId?: string;
        voidedAt?: Date;
      } = {},
    ): Promise<SupplierInvoice | null> {
      const idx = invoices.findIndex(
        (inv) => inv.id === id && inv.clinicId === clinicId,
      );
      if (idx === -1) return Promise.resolve(null);

      const existing = invoices[idx];
      if (!existing) return Promise.resolve(null);

      const updated: SupplierInvoice = {
        ...existing,
        status,
        ...(extra.confirmedByUserId !== undefined && {
          confirmedByUserId: extra.confirmedByUserId,
        }),
        ...(extra.confirmedAt !== undefined && {
          confirmedAt: extra.confirmedAt,
        }),
        ...(extra.voidedByUserId !== undefined && {
          voidedByUserId: extra.voidedByUserId,
        }),
        ...(extra.voidedAt !== undefined && { voidedAt: extra.voidedAt }),
        updatedAt: new Date(),
      };
      invoices[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    clearTemporaryExtractionData(
      clinicId: string,
      invoiceId: string,
    ): Promise<void> {
      const idx = invoices.findIndex(
        (inv) => inv.id === invoiceId && inv.clinicId === clinicId,
      );
      if (idx !== -1) {
        const existing = invoices[idx];
        if (existing) {
          invoices[idx] = {
            ...existing,
            ocrConfidence: null,
            ocrRawResponse: {},
            storageKey: null,
            updatedAt: new Date(),
          };
        }
      }
      return Promise.resolve();
    },

    // ── Duplicate detection ──────────────────────────────────────────────────

    findDuplicateFile(
      clinicId: string,
      sha256: string,
      excludeId?: string,
    ): Promise<DuplicateFileWarning | null> {
      const found = invoices.find(
        (inv) =>
          inv.clinicId === clinicId &&
          inv.fileSha256 === sha256 &&
          inv.id !== excludeId,
      );
      if (!found) return Promise.resolve(null);
      return Promise.resolve({ existingInvoiceId: found.id, importedAt: found.createdAt });
    },

    findDuplicateInvoiceNumber(
      clinicId: string,
      supplierId: string,
      invoiceNumber: string,
      excludeId?: string,
    ): Promise<DuplicateInvoiceNumberWarning | null> {
      const found = invoices.find(
        (inv) =>
          inv.clinicId === clinicId &&
          inv.supplierId === supplierId &&
          inv.invoiceNumber === invoiceNumber &&
          inv.status !== "voided" &&
          inv.status !== "cancelled" &&
          inv.id !== excludeId,
      );
      if (!found) return Promise.resolve(null);
      return Promise.resolve({
        existingInvoiceId: found.id,
        existingStatus: found.status,
      });
    },

    // ── Line items ────────────────────────────────────────────────────────────

    addLine(
      input: AddSupplierInvoiceLineInput,
    ): Promise<SupplierInvoiceLine> {
      const now = new Date();
      const subtotalCents = Math.round(input.quantity * input.unitPriceCents);
      const taxCents = Math.round(
        (subtotalCents * input.taxRateBasisPoints) / 10_000,
      );
      const totalCents = subtotalCents + taxCents;

      const line: SupplierInvoiceLine = {
        id: randomUUID(),
        clinicId: input.clinicId,
        supplierInvoiceId: input.supplierInvoiceId,
        masterCatalogItemId: input.masterCatalogItemId,
        masterProductName: null,
        supplierCatalogueId: input.supplierCatalogueId,
        ocrDescription: input.ocrDescription,
        ocrSku: input.ocrSku,
        ocrConfidence: input.ocrConfidence,
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents,
        subtotalCents,
        taxRateBasisPoints: input.taxRateBasisPoints,
        taxCents,
        totalCents,
        sortOrder: input.sortOrder,
        isMatched: input.isMatched,
        matchMethod: input.matchMethod,
        reviewDecision: input.reviewDecision ?? null,
        productCreationData: null,
        createdAt: now,
        updatedAt: now,
      };
      lines.push(line);
      return Promise.resolve({ ...line });
    },

    findLineById(
      clinicId: string,
      lineId: string,
    ): Promise<SupplierInvoiceLine | null> {
      const found = lines.find(
        (l) => l.id === lineId && l.clinicId === clinicId,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    listLines(
      clinicId: string,
      invoiceId: string,
    ): Promise<SupplierInvoiceLine[]> {
      return Promise.resolve(
        lines
          .filter(
            (l) =>
              l.clinicId === clinicId && l.supplierInvoiceId === invoiceId,
          )
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((l) => ({ ...l })),
      );
    },

    updateLine(
      clinicId: string,
      lineId: string,
      patch: UpdateSupplierInvoiceLineInput,
    ): Promise<SupplierInvoiceLine | null> {
      const idx = lines.findIndex(
        (l) => l.id === lineId && l.clinicId === clinicId,
      );
      if (idx === -1) return Promise.resolve(null);

      const existing = lines[idx];
      if (!existing) return Promise.resolve(null);

      const quantity =
        patch.quantity !== undefined ? patch.quantity : existing.quantity;
      const unitPriceCents =
        patch.unitPriceCents !== undefined
          ? patch.unitPriceCents
          : existing.unitPriceCents;
      const taxRateBasisPoints =
        patch.taxRateBasisPoints !== undefined
          ? patch.taxRateBasisPoints
          : existing.taxRateBasisPoints;

      const subtotalCents = Math.round(quantity * unitPriceCents);
      const taxCents = Math.round(
        (subtotalCents * taxRateBasisPoints) / 10_000,
      );
      const totalCents = subtotalCents + taxCents;

      const updated: SupplierInvoiceLine = {
        ...existing,
        ...(patch.ocrDescription !== undefined && {
          ocrDescription: patch.ocrDescription,
        }),
        ...(patch.ocrSku !== undefined && { ocrSku: patch.ocrSku }),
        quantity,
        unitPriceCents,
        subtotalCents,
        taxRateBasisPoints,
        taxCents,
        totalCents,
        ...(patch.masterCatalogItemId !== undefined && {
          masterCatalogItemId: patch.masterCatalogItemId,
        }),
        ...(patch.supplierCatalogueId !== undefined && {
          supplierCatalogueId: patch.supplierCatalogueId,
        }),
        ...(patch.isMatched !== undefined && { isMatched: patch.isMatched }),
        ...(patch.matchMethod !== undefined && {
          matchMethod: patch.matchMethod,
        }),
        ...(patch.reviewDecision !== undefined && {
          reviewDecision: patch.reviewDecision,
        }),
        ...(patch.productCreationData !== undefined && {
          productCreationData: patch.productCreationData,
        }),
        updatedAt: new Date(),
      };
      lines[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    removeLine(clinicId: string, lineId: string): Promise<void> {
      const idx = lines.findIndex(
        (l) => l.id === lineId && l.clinicId === clinicId,
      );
      if (idx !== -1) lines.splice(idx, 1);
      return Promise.resolve();
    },

    removeLinesForInvoice(clinicId: string, invoiceId: string): Promise<void> {
      for (let idx = lines.length - 1; idx >= 0; idx--) {
        const line = lines[idx];
        if (line?.clinicId === clinicId && line.supplierInvoiceId === invoiceId) {
          lines.splice(idx, 1);
        }
      }
      return Promise.resolve();
    },

    // ── Receiving lifecycle ──────────────────────────────────────────────────

    markReceived(
      clinicId: string,
      invoiceId: string,
      receivedByUserId: string,
      receivedReference: string | null,
    ): Promise<SupplierInvoice | null> {
      const idx = invoices.findIndex(
        (inv) => inv.id === invoiceId && inv.clinicId === clinicId,
      );
      if (idx === -1) return Promise.resolve(null);
      const existing = invoices[idx];
      if (!existing) return Promise.resolve(null);
      const now = new Date();
      const updated: SupplierInvoice = {
        ...existing,
        receivedAt: now,
        receivedByUserId,
        receivedReference,
        updatedAt: now,
      };
      invoices[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    // ── Supplier catalogue pricing ────────────────────────────────────────────

    upsertSupplierCataloguePrice(
      supplierId: string,
      masterCatalogItemId: string,
      newUnitCostCents: number,
      supplierSku: string | null,
    ): Promise<{ catalogueId: string; oldUnitCostCents: number | null }> {
      void supplierSku;
      const key = `${supplierId}:${masterCatalogItemId}`;
      const existing = cataloguePrices.get(key);
      const catalogueId = existing?.id ?? randomUUID();

      cataloguePrices.set(key, { id: catalogueId, unitCostCents: newUnitCostCents });

      return Promise.resolve({
        catalogueId,
        oldUnitCostCents: existing?.unitCostCents ?? null,
      });
    },

    // ── Price history ─────────────────────────────────────────────────────────

    insertPriceHistory(
      record: Omit<SupplierPriceHistory, "id" | "createdAt">,
    ): Promise<SupplierPriceHistory> {
      const entry: SupplierPriceHistory = {
        ...record,
        id: randomUUID(),
        createdAt: new Date(),
      };
      priceHistory.push(entry);
      return Promise.resolve({ ...entry });
    },
  };
}
