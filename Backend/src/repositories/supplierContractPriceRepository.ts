import { randomUUID } from "node:crypto";

import type {
  CreateSupplierContractPriceInput,
  SupplierContractPrice,
  SupplierContractPriceType,
  UpdateSupplierContractPriceInput,
} from "../types/supplierContractPrice.js";

// ─── Seed constants ───────────────────────────────────────────────────────────

/**
 * Fixed UUIDs for demo supplier contract price records seeded in development / test.
 * Must be stable across restarts for idempotent seeding.
 */
export const SEED_CONTRACT_PRICE_GLOVES_ID =
  "ffffffff-0000-4000-8000-000000000001";
export const SEED_CONTRACT_PRICE_COMPOSITE_ID =
  "ffffffff-0000-4000-8000-000000000002";
export const SEED_CONTRACT_PRICE_MATRIX_ID =
  "ffffffff-0000-4000-8000-000000000003";
export const SEED_CONTRACT_PRICE_GLOVES_PROMO_ID =
  "ffffffff-0000-4000-8000-000000000004";

// ─── Repository interface ─────────────────────────────────────────────────────

export interface SupplierContractPriceRepository {
  /** All prices for a given contract, ordered by effective_from descending. */
  listByContract(contractId: string): Promise<SupplierContractPrice[]>;

  /** Fetch a single price by its UUID, or null when not found. */
  getById(priceId: string): Promise<SupplierContractPrice | null>;

  /**
   * Create a new negotiated price line attached to a contract.
   */
  create(
    contractId: string,
    input: CreateSupplierContractPriceInput,
  ): Promise<SupplierContractPrice>;

  /**
   * Partial update — only keys present in `input` are written.
   * Returns null when the priceId does not exist.
   */
  update(
    priceId: string,
    input: UpdateSupplierContractPriceInput,
  ): Promise<SupplierContractPrice | null>;

  /**
   * Soft-expire: sets effective_to to today.
   * No hard delete is ever performed.
   * Returns null when the priceId does not exist.
   */
  expire(priceId: string): Promise<SupplierContractPrice | null>;

  /**
   * Returns the current active price for a given contract + product combination.
   * "Active" means effectiveFrom <= asOf AND (effectiveTo IS NULL OR effectiveTo >= asOf).
   *
   * Optional filters:
   *   asOf     — evaluation date (defaults to today)
   *   quantity — matches against min/max quantity tier
   *   priceType — filter by 'contract' or 'promotional'
   *
   * When multiple prices match, returns the one with the latest effectiveFrom.
   */
  findCurrentPrice(
    contractId: string,
    masterCatalogItemId: string,
    options?: {
      asOf?: Date;
      quantity?: number;
      priceType?: SupplierContractPriceType;
    },
  ): Promise<SupplierContractPrice | null>;
}

// ─── In-memory seed data ──────────────────────────────────────────────────────

// Resolved from seed constants in sibling repository files (avoids circular deps).
const DENTAL_DEPOT_CONTRACT_ID = "eeeeeeee-0000-4000-8000-000000000001";
const CATALOG_NITRILE_GLOVES = "d1111111-1111-4111-8111-111111111111";
const CATALOG_COMPOSITE_RESIN = "d3333333-3333-4333-8333-333333333333";
const CATALOG_MATRIX_BANDS = "d6666666-6666-4666-8666-666666666666";

const SEED_PRICES: SupplierContractPrice[] = [
  {
    id: SEED_CONTRACT_PRICE_GLOVES_ID,
    supplierContractId: DENTAL_DEPOT_CONTRACT_ID,
    masterCatalogItemId: CATALOG_NITRILE_GLOVES,
    priceType: "contract",
    unitPriceCents: 1320,
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    minimumQuantity: null,
    maximumQuantity: null,
    currencyCode: "AUD",
    notes: null,
    createdAt: new Date("2025-12-15"),
    updatedAt: new Date("2025-12-15"),
  },
  {
    id: SEED_CONTRACT_PRICE_COMPOSITE_ID,
    supplierContractId: DENTAL_DEPOT_CONTRACT_ID,
    masterCatalogItemId: CATALOG_COMPOSITE_RESIN,
    priceType: "contract",
    unitPriceCents: 4690,
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    minimumQuantity: null,
    maximumQuantity: null,
    currencyCode: "AUD",
    notes: null,
    createdAt: new Date("2025-12-15"),
    updatedAt: new Date("2025-12-15"),
  },
  {
    id: SEED_CONTRACT_PRICE_MATRIX_ID,
    supplierContractId: DENTAL_DEPOT_CONTRACT_ID,
    masterCatalogItemId: CATALOG_MATRIX_BANDS,
    priceType: "contract",
    unitPriceCents: 2410,
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    minimumQuantity: null,
    maximumQuantity: null,
    currencyCode: "AUD",
    notes: null,
    createdAt: new Date("2025-12-15"),
    updatedAt: new Date("2025-12-15"),
  },
  {
    id: SEED_CONTRACT_PRICE_GLOVES_PROMO_ID,
    supplierContractId: DENTAL_DEPOT_CONTRACT_ID,
    masterCatalogItemId: CATALOG_NITRILE_GLOVES,
    priceType: "promotional",
    unitPriceCents: 1280,
    effectiveFrom: new Date("2026-07-01"),
    effectiveTo: new Date("2026-07-31"),
    minimumQuantity: null,
    maximumQuantity: null,
    currencyCode: "AUD",
    notes: "End-of-financial-year promotional pricing",
    createdAt: new Date("2025-12-15"),
    updatedAt: new Date("2025-12-15"),
  },
];

// ─── In-memory implementation ─────────────────────────────────────────────────

export function createInMemorySupplierContractPriceRepository(): SupplierContractPriceRepository {
  const store: SupplierContractPrice[] = SEED_PRICES.map((p) => ({ ...p }));

  function isActiveOn(price: SupplierContractPrice, asOf: Date): boolean {
    return (
      price.effectiveFrom <= asOf &&
      (price.effectiveTo === null || price.effectiveTo >= asOf)
    );
  }

  return {
    listByContract(contractId: string): Promise<SupplierContractPrice[]> {
      const result = store
        .filter((p) => p.supplierContractId === contractId)
        .map((p) => ({ ...p }));
      result.sort(
        (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
      );
      return Promise.resolve(result);
    },

    getById(priceId: string): Promise<SupplierContractPrice | null> {
      const found = store.find((p) => p.id === priceId);
      return Promise.resolve(found ? { ...found } : null);
    },

    async create(
      contractId: string,
      input: CreateSupplierContractPriceInput,
    ): Promise<SupplierContractPrice> {
      const now = new Date();
      const record: SupplierContractPrice = {
        id: randomUUID(),
        supplierContractId: contractId,
        masterCatalogItemId: input.masterCatalogItemId,
        priceType: input.priceType ?? "contract",
        unitPriceCents: input.unitPriceCents,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        minimumQuantity: input.minimumQuantity ?? null,
        maximumQuantity: input.maximumQuantity ?? null,
        currencyCode: input.currencyCode ?? "AUD",
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.push(record);
      return Promise.resolve({ ...record });
    },

    update(
      priceId: string,
      input: UpdateSupplierContractPriceInput,
    ): Promise<SupplierContractPrice | null> {
      const idx = store.findIndex((p) => p.id === priceId);
      const existing = store[idx];
      if (idx === -1 || !existing) return Promise.resolve(null);

      const updated: SupplierContractPrice = {
        ...existing,
        ...(input.priceType !== undefined && { priceType: input.priceType }),
        ...(input.unitPriceCents !== undefined && {
          unitPriceCents: input.unitPriceCents,
        }),
        ...(input.effectiveFrom !== undefined && {
          effectiveFrom: input.effectiveFrom,
        }),
        ...(input.effectiveTo !== undefined && {
          effectiveTo: input.effectiveTo,
        }),
        ...(input.minimumQuantity !== undefined && {
          minimumQuantity: input.minimumQuantity,
        }),
        ...(input.maximumQuantity !== undefined && {
          maximumQuantity: input.maximumQuantity,
        }),
        ...(input.currencyCode !== undefined && {
          currencyCode: input.currencyCode,
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
        updatedAt: new Date(),
      };
      store[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    expire(priceId: string): Promise<SupplierContractPrice | null> {
      const idx = store.findIndex((p) => p.id === priceId);
      const existing = store[idx];
      if (idx === -1 || !existing) return Promise.resolve(null);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const updated: SupplierContractPrice = {
        ...existing,
        effectiveTo: today,
        updatedAt: new Date(),
      };
      store[idx] = updated;
      return Promise.resolve({ ...updated });
    },

    findCurrentPrice(
      contractId: string,
      masterCatalogItemId: string,
      options: {
        asOf?: Date;
        quantity?: number;
        priceType?: SupplierContractPriceType;
      } = {},
    ): Promise<SupplierContractPrice | null> {
      const asOf = options.asOf ?? new Date();
      const { quantity, priceType } = options;

      const candidates = store.filter((p) => {
        if (p.supplierContractId !== contractId) return false;
        if (p.masterCatalogItemId !== masterCatalogItemId) return false;
        if (!isActiveOn(p, asOf)) return false;
        if (priceType !== undefined && p.priceType !== priceType) return false;
        if (quantity !== undefined) {
          if (p.minimumQuantity !== null && quantity < p.minimumQuantity)
            return false;
          if (p.maximumQuantity !== null && quantity > p.maximumQuantity)
            return false;
        }
        return true;
      });

      // Prefer the most recently effective price.
      candidates.sort(
        (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
      );
      const found = candidates[0];
      return Promise.resolve(found ? { ...found } : null);
    },
  };
}
