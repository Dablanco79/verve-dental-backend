/**
 * StocktakeService — Workflow 2.1: Stocktake & Inventory Reconciliation.
 *
 * Design principles:
 *  - Inventory is NEVER updated directly; all quantity changes go through
 *    inventoryRepository.recordAdjustment (adjustmentType: 'stocktake_adjustment').
 *  - Every lifecycle event is recorded to the audit trail.
 *  - Business rules (valid transitions, RBAC checks) live here, not in the controller.
 *  - Product snapshot fields (name, category, stockUnit) are captured from the
 *    live inventory view at session-start and stored immutably on each line.
 */

import type { InventoryRepository } from "../repositories/inventoryRepository.js";
import type { StocktakeRepository } from "../repositories/stocktakeRepository.js";
import type { CreateAuditEventInput } from "../types/analytics.js";
import type {
  CreateStocktakeSessionInput,
  StocktakeLine,
  StocktakeLineView,
  StocktakeSession,
  StocktakeSessionView,
  StocktakeSessionsPage,
  StocktakeStatus,
  UpdateStocktakeLineInput,
  UpdateStocktakeSessionInput,
} from "../types/stocktake.js";
import { AppError } from "../types/errors.js";

type AuditWriter = {
  recordEvent(input: CreateAuditEventInput): Promise<unknown>;
};

export type StocktakeActor = {
  id: string;
  email: string;
  role: string;
};

const MANAGE_ROLES = ["owner_admin", "group_practice_manager"] as const;
type ManageRole = (typeof MANAGE_ROLES)[number];

function assertCanManage(actor: StocktakeActor): asserts actor is StocktakeActor & { role: ManageRole } {
  if (!MANAGE_ROLES.includes(actor.role as ManageRole)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only managers and administrators can perform this action",
    );
  }
}

export function createStocktakeService(
  stocktakeRepository: StocktakeRepository,
  inventoryRepository: InventoryRepository,
  auditWriter?: AuditWriter,
) {
  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function requireSession(
    clinicId: string,
    sessionId: string,
  ): Promise<StocktakeSession> {
    const session = await stocktakeRepository.findSessionById(clinicId, sessionId);
    if (!session) {
      throw new AppError(404, "STOCKTAKE_NOT_FOUND", "Stocktake session not found");
    }
    return session;
  }

  function assertStatus(
    session: StocktakeSession,
    ...allowed: StocktakeStatus[]
  ): void {
    if (!allowed.includes(session.status)) {
      throw new AppError(
        409,
        "INVALID_STATUS_TRANSITION",
        `Cannot perform this action on a ${session.status} session`,
      );
    }
  }

  function fireAudit(
    input: CreateAuditEventInput,
  ): void {
    auditWriter?.recordEvent(input).catch((err: unknown) => {
      console.error("[Stocktake Audit Failure]:", err);
    });
  }

  // ── Public methods ───────────────────────────────────────────────────────────

  return {
    // LIST SESSIONS ────────────────────────────────────────────────────────────

    listSessions(
      clinicId: string,
      options?: { limit?: number; offset?: number; status?: StocktakeStatus },
    ): Promise<StocktakeSessionsPage> {
      return stocktakeRepository.listSessions(clinicId, options);
    },

    // GET SESSION ──────────────────────────────────────────────────────────────

    async getSession(
      clinicId: string,
      sessionId: string,
    ): Promise<StocktakeSessionView> {
      const session = await stocktakeRepository.findSessionById(clinicId, sessionId);
      if (!session) {
        throw new AppError(404, "STOCKTAKE_NOT_FOUND", "Stocktake session not found");
      }
      return session as StocktakeSessionView;
    },

    // CREATE SESSION ───────────────────────────────────────────────────────────

    async createSession(
      input: Omit<CreateStocktakeSessionInput, never>,
      actor: StocktakeActor,
    ): Promise<StocktakeSession> {
      assertCanManage(actor);

      const session = await stocktakeRepository.createSession(input);

      fireAudit({
        clinicId: input.clinicId,
        entityType: "inventory_adjustment",
        entityId: session.id,
        action: "stocktake_session_created",
        actorId: actor.id,
        actorEmail: actor.email,
        metadata: { sessionId: session.id, name: session.name },
      });

      return session;
    },

    // UPDATE SESSION (name only — draft only) ──────────────────────────────────

    async updateSession(
      clinicId: string,
      sessionId: string,
      input: UpdateStocktakeSessionInput,
      actor: StocktakeActor,
    ): Promise<StocktakeSession> {
      assertCanManage(actor);
      const session = await requireSession(clinicId, sessionId);
      assertStatus(session, "draft");

      const updated = await stocktakeRepository.updateSession(clinicId, sessionId, input);
      if (!updated) {
        throw new AppError(404, "STOCKTAKE_NOT_FOUND", "Stocktake session not found");
      }
      return updated;
    },

    // START SESSION ────────────────────────────────────────────────────────────
    // Transitions: draft → in_progress
    // Creates one stocktake_line per clinic_inventory_item, snapshotting:
    //   - expectedQuantity (quantity on hand at this moment)
    //   - unitCostCents (cost at this moment)
    //   - productName, category, stockUnit (from the live inventory view)
    //   - primaryBarcode (looked up by the repository at INSERT time)

    async startSession(
      clinicId: string,
      sessionId: string,
      actor: StocktakeActor,
    ): Promise<StocktakeSession> {
      assertCanManage(actor);
      const session = await requireSession(clinicId, sessionId);
      assertStatus(session, "draft");

      // Load the entire clinic inventory to create one line per item.
      const inventoryItems = await inventoryRepository.listClinicInventory(clinicId);

      if (inventoryItems.length === 0) {
        throw new AppError(
          400,
          "NO_INVENTORY",
          "Cannot start a stocktake session — this clinic has no inventory items",
        );
      }

      const now = new Date();

      // Update status first to prevent duplicate starts.
      const updated = await stocktakeRepository.updateSessionStatus(
        clinicId,
        sessionId,
        "in_progress",
        { field: "started", userId: actor.id, email: actor.email, timestamp: now },
      );

      if (!updated) {
        throw new AppError(404, "STOCKTAKE_NOT_FOUND", "Stocktake session not found");
      }

      // Create snapshot lines.  Product name, category and stock unit are frozen
      // from the live inventory view.  Primary barcode is captured by the repository
      // (Postgres: via barcode_mappings subquery; in-memory: null).
      await stocktakeRepository.createLines(
        inventoryItems.map((item) => ({
          sessionId,
          clinicId,
          clinicInventoryItemId: item.id,
          masterCatalogItemId: item.masterCatalogItemId,
          productName: item.name,
          category: item.category,
          stockUnit: item.stockUnit,
          expectedQuantity: item.quantityOnHand,
          countedQuantity: null,
          unitCostCents: item.unitCostCents,
          notes: null,
        })),
      );

      fireAudit({
        clinicId,
        entityType: "inventory_adjustment",
        entityId: sessionId,
        action: "stocktake_session_started",
        actorId: actor.id,
        actorEmail: actor.email,
        metadata: {
          sessionId,
          linesCreated: inventoryItems.length,
          startedAt: now.toISOString(),
        },
      });

      return updated;
    },

    // CANCEL SESSION ───────────────────────────────────────────────────────────
    // Transitions: draft | in_progress → cancelled

    async cancelSession(
      clinicId: string,
      sessionId: string,
      actor: StocktakeActor,
    ): Promise<StocktakeSession> {
      assertCanManage(actor);
      const session = await requireSession(clinicId, sessionId);
      assertStatus(session, "draft", "in_progress");

      const now = new Date();
      const updated = await stocktakeRepository.updateSessionStatus(
        clinicId,
        sessionId,
        "cancelled",
        { field: "cancelled", userId: actor.id, email: actor.email, timestamp: now },
      );

      if (!updated) {
        throw new AppError(404, "STOCKTAKE_NOT_FOUND", "Stocktake session not found");
      }

      fireAudit({
        clinicId,
        entityType: "inventory_adjustment",
        entityId: sessionId,
        action: "stocktake_session_cancelled",
        actorId: actor.id,
        actorEmail: actor.email,
        metadata: { sessionId, cancelledAt: now.toISOString() },
      });

      return updated;
    },

    // COMPLETE SESSION ─────────────────────────────────────────────────────────
    // Transitions: in_progress → completed
    //
    // REQUIRES that every line has been counted (countedQuantity is not null).
    // A countedQuantity of zero is valid — it means the item was physically
    // counted and found to be absent.
    //
    // For every line where variance ≠ 0, calls inventoryRepository.recordAdjustment
    // (type: 'stocktake_adjustment') to update stock.  This keeps the full audit trail.

    async completeSession(
      clinicId: string,
      sessionId: string,
      actor: StocktakeActor,
    ): Promise<{ session: StocktakeSession; adjustmentsApplied: number }> {
      assertCanManage(actor);
      const session = await requireSession(clinicId, sessionId);
      assertStatus(session, "in_progress");

      // ── Finding 1: Block completion when any line is uncounted ────────────────
      // Load all lines for this session and count those with countedQuantity = null.
      // countedQuantity = 0 is valid (item was counted as zero); only null is blocked.
      const allLines = await stocktakeRepository.listLines(clinicId, sessionId);
      const uncountedLines = allLines.filter((l) => l.countedQuantity === null);

      if (uncountedLines.length > 0) {
        throw new AppError(
          400,
          "UNCOUNTED_LINES",
          `Cannot complete stocktake: ${String(uncountedLines.length)} item${
            uncountedLines.length === 1 ? "" : "s"
          } have not been counted. ` +
            "Every inventory item must have a count (including zero) before completion.",
        );
      }

      // Collect lines with a non-zero variance.
      const varianceLines = await stocktakeRepository.listVarianceLines(
        clinicId,
        sessionId,
      );

      // Apply adjustments via the existing inventory service pattern.
      let adjustmentsApplied = 0;
      for (const line of varianceLines) {
        if (line.variance === null) continue;

        // Read the CURRENT quantity on hand (not the snapshot) for before/after.
        const currentItem = await inventoryRepository.findClinicInventoryItem(
          clinicId,
          line.clinicInventoryItemId,
        );
        if (!currentItem) continue;

        const quantityAfter = currentItem.quantityOnHand + line.variance;
        // Do not allow negative stock from a stocktake.
        const safeAfter = Math.max(0, quantityAfter);
        const safeDelta = safeAfter - currentItem.quantityOnHand;

        if (safeDelta === 0) continue;

        await inventoryRepository.updateQuantity(
          clinicId,
          line.clinicInventoryItemId,
          safeAfter,
        );

        await inventoryRepository.recordAdjustment({
          clinicId,
          clinicInventoryItemId: line.clinicInventoryItemId,
          masterCatalogItemId: line.masterCatalogItemId,
          adjustmentType: "stocktake_adjustment" as import("../types/inventory.js").AdjustmentType,
          quantityDelta: safeDelta,
          quantityBefore: currentItem.quantityOnHand,
          quantityAfter: safeAfter,
          reason: `Stocktake: ${session.name}`,
          performedByUserId: actor.id,
          performedByEmail: actor.email,
          referenceId: sessionId,
        });

        adjustmentsApplied++;
      }

      const now = new Date();
      const updated = await stocktakeRepository.updateSessionStatus(
        clinicId,
        sessionId,
        "completed",
        { field: "completed", userId: actor.id, email: actor.email, timestamp: now },
      );

      if (!updated) {
        throw new AppError(404, "STOCKTAKE_NOT_FOUND", "Stocktake session not found");
      }

      fireAudit({
        clinicId,
        entityType: "inventory_adjustment",
        entityId: sessionId,
        action: "stocktake_session_completed",
        actorId: actor.id,
        actorEmail: actor.email,
        metadata: {
          sessionId,
          adjustmentsApplied,
          completedAt: now.toISOString(),
        },
      });

      return { session: updated, adjustmentsApplied };
    },

    // LIST LINES ───────────────────────────────────────────────────────────────

    async listLines(
      clinicId: string,
      sessionId: string,
    ): Promise<StocktakeLineView[]> {
      await requireSession(clinicId, sessionId);
      return stocktakeRepository.listLines(clinicId, sessionId);
    },

    // UPDATE LINE COUNT ────────────────────────────────────────────────────────
    // Available to all authenticated roles (clinical_staff may count).

    async updateLine(
      clinicId: string,
      sessionId: string,
      lineId: string,
      input: UpdateStocktakeLineInput,
      actor: StocktakeActor,
    ): Promise<StocktakeLine> {
      const session = await requireSession(clinicId, sessionId);
      assertStatus(session, "in_progress");

      const line = await stocktakeRepository.findLineById(clinicId, lineId);
      if (!line || line.sessionId !== sessionId) {
        throw new AppError(404, "STOCKTAKE_LINE_NOT_FOUND", "Stocktake line not found");
      }

      if (
        input.countedQuantity !== null &&
        (!Number.isInteger(input.countedQuantity) || input.countedQuantity < 0)
      ) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "countedQuantity must be a non-negative integer",
        );
      }

      const updated = await stocktakeRepository.updateLine(clinicId, lineId, input);
      if (!updated) {
        throw new AppError(404, "STOCKTAKE_LINE_NOT_FOUND", "Stocktake line not found");
      }

      fireAudit({
        clinicId,
        entityType: "inventory_adjustment",
        entityId: lineId,
        action: "stocktake_count_updated",
        actorId: actor.id,
        actorEmail: actor.email,
        metadata: {
          sessionId,
          lineId,
          countedQuantity: input.countedQuantity,
          variance: updated.variance,
        },
      });

      return updated;
    },
  };
}

export type StocktakeService = ReturnType<typeof createStocktakeService>;
