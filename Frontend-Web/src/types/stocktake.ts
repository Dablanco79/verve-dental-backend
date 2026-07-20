// ── Stocktake Status ──────────────────────────────────────────────────────────

export type StocktakeStatus = "draft" | "in_progress" | "completed" | "cancelled";

export const STOCKTAKE_STATUS_LABELS: Record<StocktakeStatus, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

// ── Session ───────────────────────────────────────────────────────────────────

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

  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;

  createdAt: string;
  updatedAt: string;

  // Present on list responses (view type).
  totalLines?: number;
  countedLines?: number;
};

// ── Line ──────────────────────────────────────────────────────────────────────

export type StocktakeLine = {
  id: string;
  sessionId: string;
  clinicId: string;
  clinicInventoryItemId: string;
  masterCatalogItemId: string;

  /**
   * Snapshot fields — frozen at session-start (migration 020).
   * These values represent the product and inventory state when the session
   * was started and must never change due to later catalogue edits.
   */
  productName: string;
  category: string;
  stockUnit: string;
  primaryBarcode: string | null;

  expectedQuantity: number;
  countedQuantity: number | null;
  variance: number | null;
  unitCostCents: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;

  // Enriched fields (present when returned from the lines endpoint)
  masterSku?: string;
  varianceValueCents?: number | null;
};

// ── Paginated sessions ────────────────────────────────────────────────────────

export type StocktakeSessionsPage = {
  items: StocktakeSession[];
  total: number;
  limit: number;
  offset: number;
};

// ── Request / Response types ──────────────────────────────────────────────────

export type CreateStocktakeSessionRequest = {
  name: string;
};

export type UpdateStocktakeSessionRequest = {
  name?: string;
};

export type UpdateStocktakeLineRequest = {
  countedQuantity: number | null;
  notes?: string | null;
};

export type CompleteStocktakeResponse = {
  session: StocktakeSession;
  adjustmentsApplied: number;
};

// ── Filter helpers ────────────────────────────────────────────────────────────

export type StocktakeSessionFilters = {
  limit?: number;
  offset?: number;
  status?: StocktakeStatus;
};
