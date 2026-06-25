/**
 * Supplier Contract Price Service — Sprint 4G.
 *
 * Business logic for managing negotiated line-item pricing under supplier
 * contracts.  Pricing is informational only in this sprint — no purchasing
 * behaviour is affected.
 *
 * RBAC:
 *   owner_admin              — full access across all clinics
 *   group_practice_manager   — full access to own clinic's contract prices
 *   clinical_staff           — read-only access to own clinic's contract prices
 *
 * Validation:
 *   • unit_price_cents must be > 0.
 *   • effective_to must be after effective_from when provided.
 *   • minimum_quantity >= 1 when provided.
 *   • maximum_quantity >= minimum_quantity when both are provided.
 *   • Only one active price per (contract, product, priceType, qty-tier).
 *
 * Soft expiry only — no hard deletes.
 */

import type { AuthenticatedUser } from "../types/auth.js";
import type {
  CreateSupplierContractPriceInput,
  SupplierContractPrice,
  SupplierContractPriceType,
  UpdateSupplierContractPriceInput,
} from "../types/supplierContractPrice.js";
import type { SupplierContractPriceRepository } from "../repositories/supplierContractPriceRepository.js";
import type { SupplierContractRepository } from "../repositories/supplierContractRepository.js";
import type { SupplierRelationshipRepository } from "../repositories/supplierRelationshipRepository.js";
import { AppError } from "../types/errors.js";

export type SupplierContractPriceService = ReturnType<
  typeof createSupplierContractPriceService
>;

export function createSupplierContractPriceService(
  priceRepo: SupplierContractPriceRepository,
  contractRepo: SupplierContractRepository,
  relationshipRepo: SupplierRelationshipRepository,
) {
  // ── Tenant / role guards ────────────────────────────────────────────────────

  function assertTenantAccess(
    caller: AuthenticatedUser,
    clinicId: string,
  ): void {
    if (caller.role !== "owner_admin" && caller.homeClinicId !== clinicId) {
      throw new AppError(
        403,
        "SUPPLIER_CONTRACT_PRICE_TENANT_VIOLATION",
        "Access denied: you do not belong to this clinic",
      );
    }
  }

  function assertWriteAccess(caller: AuthenticatedUser): void {
    if (caller.role === "clinical_staff") {
      throw new AppError(
        403,
        "SUPPLIER_CONTRACT_PRICE_FORBIDDEN",
        "Clinical staff have read-only access to supplier contract prices",
      );
    }
  }

  /** Resolves clinicId from a contract ID, throwing 404 when not found. */
  async function resolveClinicIdFromContractId(
    contractId: string,
  ): Promise<string> {
    const contract = await contractRepo.getById(contractId);
    if (!contract) {
      throw new AppError(
        404,
        "SUPPLIER_CONTRACT_NOT_FOUND",
        `Supplier contract '${contractId}' not found`,
      );
    }
    const rel = await relationshipRepo.getById(contract.supplierRelationshipId);
    if (!rel) {
      throw new AppError(
        404,
        "SUPPLIER_RELATIONSHIP_NOT_FOUND",
        `Supplier relationship '${contract.supplierRelationshipId}' not found`,
      );
    }
    return rel.clinicId;
  }

  /** Resolves clinicId from an existing price record. */
  async function resolveClinicIdFromPrice(
    price: SupplierContractPrice,
  ): Promise<string> {
    return resolveClinicIdFromContractId(price.supplierContractId);
  }

  // ── Domain validation ───────────────────────────────────────────────────────

  function validateEffectiveDates(
    effectiveFrom: Date,
    effectiveTo: Date | null | undefined,
  ): void {
    if (effectiveTo != null && effectiveTo <= effectiveFrom) {
      throw new AppError(
        400,
        "SUPPLIER_CONTRACT_PRICE_INVALID_DATES",
        "effective_to must be after effective_from",
      );
    }
  }

  function validateUnitPrice(unitPriceCents: number): void {
    if (!Number.isInteger(unitPriceCents) || unitPriceCents <= 0) {
      throw new AppError(
        400,
        "SUPPLIER_CONTRACT_PRICE_INVALID_PRICE",
        "unit_price_cents must be a positive integer",
      );
    }
  }

  function validateQuantityTier(
    minimumQuantity: number | null | undefined,
    maximumQuantity: number | null | undefined,
  ): void {
    if (minimumQuantity != null && minimumQuantity < 1) {
      throw new AppError(
        400,
        "SUPPLIER_CONTRACT_PRICE_INVALID_QUANTITY",
        "minimum_quantity must be >= 1 when provided",
      );
    }
    if (
      minimumQuantity != null &&
      maximumQuantity != null &&
      maximumQuantity < minimumQuantity
    ) {
      throw new AppError(
        400,
        "SUPPLIER_CONTRACT_PRICE_INVALID_QUANTITY",
        "maximum_quantity must be >= minimum_quantity when both are provided",
      );
    }
  }

  /**
   * Returns true when two date ranges overlap.
   * null effectiveTo means open-ended (no expiry).
   */
  function dateRangesOverlap(
    aFrom: Date,
    aTo: Date | null,
    bFrom: Date,
    bTo: Date | null,
  ): boolean {
    const aEnd = aTo ?? new Date(8_640_000_000_000_000); // max date
    const bEnd = bTo ?? new Date(8_640_000_000_000_000);
    return aFrom <= bEnd && bFrom <= aEnd;
  }

  /**
   * Enforces the business rule: only one active price per
   * (contract, product, priceType, qty-tier).
   */
  async function assertNoDuplicateActivePrice(
    contractId: string,
    masterCatalogItemId: string,
    priceType: SupplierContractPriceType,
    effectiveFrom: Date,
    effectiveTo: Date | null,
    minimumQuantity: number | null,
    maximumQuantity: number | null,
    excludePriceId?: string,
  ): Promise<void> {
    const existing = await priceRepo.listByContract(contractId);

    const conflict = existing.find((p) => {
      if (p.id === excludePriceId) return false;
      if (p.masterCatalogItemId !== masterCatalogItemId) return false;
      if (p.priceType !== priceType) return false;
      // Same quantity tier: both fields must match (null === null).
      if (p.minimumQuantity !== minimumQuantity) return false;
      if (p.maximumQuantity !== maximumQuantity) return false;
      // Check for date range overlap.
      return dateRangesOverlap(
        p.effectiveFrom,
        p.effectiveTo,
        effectiveFrom,
        effectiveTo,
      );
    });

    if (conflict) {
      throw new AppError(
        409,
        "DUPLICATE_ACTIVE_CONTRACT_PRICE",
        `An overlapping ${priceType} price already exists for this product and quantity tier (id: ${conflict.id})`,
      );
    }
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  return {
    async listByContract(
      caller: AuthenticatedUser,
      contractId: string,
    ): Promise<SupplierContractPrice[]> {
      const clinicId = await resolveClinicIdFromContractId(contractId);
      assertTenantAccess(caller, clinicId);
      return priceRepo.listByContract(contractId);
    },

    async getById(
      caller: AuthenticatedUser,
      priceId: string,
    ): Promise<SupplierContractPrice> {
      const price = await priceRepo.getById(priceId);
      if (!price) {
        throw new AppError(
          404,
          "SUPPLIER_CONTRACT_PRICE_NOT_FOUND",
          "Supplier contract price not found",
        );
      }
      const clinicId = await resolveClinicIdFromPrice(price);
      assertTenantAccess(caller, clinicId);
      return price;
    },

    async create(
      caller: AuthenticatedUser,
      contractId: string,
      input: CreateSupplierContractPriceInput,
    ): Promise<SupplierContractPrice> {
      const clinicId = await resolveClinicIdFromContractId(contractId);
      assertTenantAccess(caller, clinicId);
      assertWriteAccess(caller);

      validateUnitPrice(input.unitPriceCents);
      validateEffectiveDates(input.effectiveFrom, input.effectiveTo);
      validateQuantityTier(input.minimumQuantity, input.maximumQuantity);

      const priceType = input.priceType ?? "contract";
      await assertNoDuplicateActivePrice(
        contractId,
        input.masterCatalogItemId,
        priceType,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.minimumQuantity ?? null,
        input.maximumQuantity ?? null,
      );

      return priceRepo.create(contractId, input);
    },

    async update(
      caller: AuthenticatedUser,
      priceId: string,
      input: UpdateSupplierContractPriceInput,
    ): Promise<SupplierContractPrice> {
      const existing = await priceRepo.getById(priceId);
      if (!existing) {
        throw new AppError(
          404,
          "SUPPLIER_CONTRACT_PRICE_NOT_FOUND",
          "Supplier contract price not found",
        );
      }
      const clinicId = await resolveClinicIdFromPrice(existing);
      assertTenantAccess(caller, clinicId);
      assertWriteAccess(caller);

      const effectiveFrom = input.effectiveFrom ?? existing.effectiveFrom;
      const effectiveTo =
        input.effectiveTo !== undefined ? input.effectiveTo : existing.effectiveTo;
      const unitPriceCents = input.unitPriceCents ?? existing.unitPriceCents;
      const minimumQuantity =
        input.minimumQuantity !== undefined
          ? input.minimumQuantity
          : existing.minimumQuantity;
      const maximumQuantity =
        input.maximumQuantity !== undefined
          ? input.maximumQuantity
          : existing.maximumQuantity;
      const priceType = input.priceType ?? existing.priceType;

      if (input.unitPriceCents !== undefined) {
        validateUnitPrice(unitPriceCents);
      }
      if (input.effectiveFrom !== undefined || input.effectiveTo !== undefined) {
        validateEffectiveDates(effectiveFrom, effectiveTo);
      }
      validateQuantityTier(minimumQuantity, maximumQuantity);

      await assertNoDuplicateActivePrice(
        existing.supplierContractId,
        existing.masterCatalogItemId,
        priceType,
        effectiveFrom,
        effectiveTo,
        minimumQuantity,
        maximumQuantity,
        priceId,
      );

      const updated = await priceRepo.update(priceId, input);
      if (!updated) {
        throw new AppError(
          500,
          "INTERNAL_ERROR",
          "Failed to update supplier contract price",
        );
      }
      return updated;
    },

    async expire(
      caller: AuthenticatedUser,
      priceId: string,
    ): Promise<SupplierContractPrice> {
      const existing = await priceRepo.getById(priceId);
      if (!existing) {
        throw new AppError(
          404,
          "SUPPLIER_CONTRACT_PRICE_NOT_FOUND",
          "Supplier contract price not found",
        );
      }
      const clinicId = await resolveClinicIdFromPrice(existing);
      assertTenantAccess(caller, clinicId);
      assertWriteAccess(caller);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      if (existing.effectiveTo !== null && existing.effectiveTo <= today) {
        throw new AppError(
          409,
          "SUPPLIER_CONTRACT_PRICE_ALREADY_EXPIRED",
          "Supplier contract price is already expired",
        );
      }

      const updated = await priceRepo.expire(priceId);
      if (!updated) {
        throw new AppError(
          500,
          "INTERNAL_ERROR",
          "Failed to expire supplier contract price",
        );
      }
      return updated;
    },

    async findCurrentPrice(
      caller: AuthenticatedUser,
      contractId: string,
      masterCatalogItemId: string,
      options?: {
        asOf?: Date;
        quantity?: number;
        priceType?: SupplierContractPriceType;
      },
    ): Promise<SupplierContractPrice | null> {
      const clinicId = await resolveClinicIdFromContractId(contractId);
      assertTenantAccess(caller, clinicId);
      return priceRepo.findCurrentPrice(contractId, masterCatalogItemId, options);
    },
  };
}
