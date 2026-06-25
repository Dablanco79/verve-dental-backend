import { randomUUID } from "node:crypto";

import type {
  CreateSupplierInput,
  Supplier,
  UpdateSupplierInput,
} from "../types/supplier.js";

// ─── Repository interface ─────────────────────────────────────────────────────

export interface SupplierRepository {
  listSuppliers(options?: { active?: boolean }): Promise<Supplier[]>;
  findSupplierById(supplierId: string): Promise<Supplier | null>;
  findSupplierByCode(supplierCode: string): Promise<Supplier | null>;
  /** Exact case-insensitive match on supplier_name. */
  findSupplierByName(name: string): Promise<Supplier | null>;
  /** Exact match on ABN after stripping whitespace/dashes. */
  findSupplierByAbn(abn: string): Promise<Supplier | null>;
  createSupplier(input: CreateSupplierInput): Promise<Supplier>;
  updateSupplier(
    supplierId: string,
    input: UpdateSupplierInput,
  ): Promise<Supplier | null>;
}

// ─── In-memory implementation ─────────────────────────────────────────────────

export function createInMemorySupplierRepository(): SupplierRepository {
  const suppliers: Supplier[] = [];

  return {
    listSuppliers(options = {}): Promise<Supplier[]> {
      let result = suppliers.map((s) => ({ ...s }));
      if (options.active !== undefined) {
        result = result.filter((s) => s.active === options.active);
      }
      result.sort(
        (a, b) => a.supplierName.localeCompare(b.supplierName),
      );
      return Promise.resolve(result);
    },

    findSupplierById(supplierId: string): Promise<Supplier | null> {
      const found = suppliers.find((s) => s.id === supplierId);
      return Promise.resolve(found ? { ...found } : null);
    },

    findSupplierByCode(supplierCode: string): Promise<Supplier | null> {
      const normalized = supplierCode.trim().toUpperCase();
      const found = suppliers.find(
        (s) => s.supplierCode?.toUpperCase() === normalized,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    findSupplierByName(name: string): Promise<Supplier | null> {
      const normalized = name.trim().toLowerCase();
      const found = suppliers.find(
        (s) => s.supplierName.toLowerCase() === normalized,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    findSupplierByAbn(abn: string): Promise<Supplier | null> {
      const normalized = abn.replace(/[\s-]/g, "");
      const found = suppliers.find(
        (s) => s.abn !== null && s.abn.replace(/[\s-]/g, "") === normalized,
      );
      return Promise.resolve(found ? { ...found } : null);
    },

    createSupplier(input: CreateSupplierInput): Promise<Supplier> {
      const now = new Date();
      const record: Supplier = {
        id: randomUUID(),
        supplierName: input.supplierName,
        supplierCode: input.supplierCode ?? null,
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        website: input.website ?? null,
        abn: input.abn ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        active: true,
        createdAt: now,
        updatedAt: now,
        // ── Sprint 4C metadata ────────────────────────────────────────────────
        legalName: input.legalName ?? null,
        tradingName: input.tradingName ?? null,
        countryCode: input.countryCode ?? "AU",
        currencyCode: input.currencyCode ?? "AUD",
        industryCategory: input.industryCategory ?? null,
        healthcareSubcategory: input.healthcareSubcategory ?? null,
        supplierCategory: input.supplierCategory ?? null,
        verified: input.verified ?? false,
        apiAvailable: input.apiAvailable ?? false,
        catalogueAvailable: input.catalogueAvailable ?? false,
        livePricing: input.livePricing ?? false,
        onlineOrdering: input.onlineOrdering ?? false,
        preferredCommMethod: input.preferredCommMethod ?? null,
        logoStorageKey: input.logoStorageKey ?? null,
        createdByClinicId: input.createdByClinicId ?? null,
        isPublic: input.isPublic ?? true,
      };
      suppliers.push(record);
      return Promise.resolve({ ...record });
    },

    updateSupplier(
      supplierId: string,
      input: UpdateSupplierInput,
    ): Promise<Supplier | null> {
      const idx = suppliers.findIndex((s) => s.id === supplierId);
      if (idx === -1) return Promise.resolve(null);

      const existing = suppliers[idx];
      if (!existing) return Promise.resolve(null);

      const updated: Supplier = {
        ...existing,
        ...(input.supplierName !== undefined && { supplierName: input.supplierName }),
        ...(input.supplierCode !== undefined && { supplierCode: input.supplierCode }),
        ...(input.contactName !== undefined && { contactName: input.contactName }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.website !== undefined && { website: input.website }),
        ...(input.abn !== undefined && { abn: input.abn }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.active !== undefined && { active: input.active }),
        // ── Sprint 4C metadata ────────────────────────────────────────────────
        ...(input.legalName !== undefined && { legalName: input.legalName }),
        ...(input.tradingName !== undefined && { tradingName: input.tradingName }),
        ...(input.countryCode !== undefined && { countryCode: input.countryCode }),
        ...(input.currencyCode !== undefined && { currencyCode: input.currencyCode }),
        ...(input.industryCategory !== undefined && { industryCategory: input.industryCategory }),
        ...(input.healthcareSubcategory !== undefined && {
          healthcareSubcategory: input.healthcareSubcategory,
        }),
        ...(input.supplierCategory !== undefined && { supplierCategory: input.supplierCategory }),
        ...(input.verified !== undefined && { verified: input.verified }),
        ...(input.apiAvailable !== undefined && { apiAvailable: input.apiAvailable }),
        ...(input.catalogueAvailable !== undefined && {
          catalogueAvailable: input.catalogueAvailable,
        }),
        ...(input.livePricing !== undefined && { livePricing: input.livePricing }),
        ...(input.onlineOrdering !== undefined && { onlineOrdering: input.onlineOrdering }),
        ...(input.preferredCommMethod !== undefined && {
          preferredCommMethod: input.preferredCommMethod,
        }),
        ...(input.logoStorageKey !== undefined && { logoStorageKey: input.logoStorageKey }),
        ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
        updatedAt: new Date(),
      };
      suppliers[idx] = updated;
      return Promise.resolve({ ...updated });
    },
  };
}
