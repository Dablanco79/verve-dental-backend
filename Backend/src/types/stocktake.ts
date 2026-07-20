// ── Stocktake Status ──────────────────────────────────────────────────────────

export const STOCKTAKE_STATUSES = [
  "draft",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

// ── Stocktake Session ─────────────────────────────────────────────────────────

export type StocktakeSession = {
  id: string;
  clinicId: string;
  name: string;
  status: StocktakeStatus;

  createdByUserId: string;
  createdByEmail: string;

  startedByUserId: string | null;
  startedByEmail: string | null;

  completedByUserId: string | null;
  completedByEmail: string | null;

  cancelledByUserId: string | null;
  cancelledByEmail: string | null;

  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
};

// ── Stocktake Line ────────────────────────────────────────────────────────────

export type StocktakeLine = {
  id: string;
  sessionId: string;
  clinicId: string;
  clinicInventoryItemId: string;
  masterCatalogItemId: string;

  /**
   * Snapshot fields — frozen at session-start.
   * These values must never change even if the master product or inventory
   * item is subsequently renamed, re-categorised, or its barcode is updated.
   */
  productName: string;
  category: string;
  stockUnit: string;
  primaryBarcode: string | null;

  /** Snapshot of quantity on hand at session-start. Immutable. */
  expectedQuantity: number;

  /** Staff-entered count. null until line is counted. */
  countedQuantity: number | null;

  /** variance = counted − expected. null when countedQuantity is null. */
  variance: number | null;

  /** Unit cost snapshot at session-start (cents). Used for variance value. */
  unitCostCents: number;

  notes: string | null;

  createdAt: Date;
  updatedAt: Date;
};

// ── Stocktake Line View (with derived variance value and master SKU) ──────────

export type StocktakeLineView = StocktakeLine & {
  /** Current master SKU (stable identifier — OK to join dynamically). */
  masterSku: string;
  /** varianceValueCents = variance * unitCostCents. null when variance is null. */
  varianceValueCents: number | null;
};

// ── Stocktake Session View (with summary counts) ──────────────────────────────

export type StocktakeSessionView = StocktakeSession & {
  totalLines: number;
  countedLines: number;
};

// ── Input types ───────────────────────────────────────────────────────────────

export type CreateStocktakeSessionInput = {
  clinicId: string;
  name: string;
  createdByUserId: string;
  createdByEmail: string;
};

export type UpdateStocktakeSessionInput = {
  name?: string;
};

export type UpdateStocktakeLineInput = {
  countedQuantity: number | null;
  notes?: string | null;
};

// ── Paginated list ────────────────────────────────────────────────────────────

export type StocktakeSessionsPage = {
  items: StocktakeSessionView[];
  total: number;
  limit: number;
  offset: number;
};
