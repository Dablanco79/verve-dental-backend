/**
 * PostgreSQL-backed StocktakeRepository.
 *
 * All queries are tenant-scoped via clinic_id.  Row-level security is enabled
 * on both stocktake_sessions and stocktake_lines and enforced via the
 * app.current_clinic_id session variable set by the RLS pool hook.
 *
 * Since migration 020 the following fields are stored as immutable snapshots
 * on stocktake_lines and are read directly from the row — no dynamic JOIN to
 * master_catalog_items is needed for these:
 *   product_name, category, stock_unit, primary_barcode
 *
 * master_sku is still joined from master_catalog_items (SKU is a stable,
 * immutable identifier in practice and does not affect audit integrity).
 */

import type { DatabasePool } from "../db/pool.js";
import type {
  CreateStocktakeSessionInput,
  StocktakeLine,
  StocktakeLineView,
  StocktakeSession,
  StocktakeSessionView,
  StocktakeStatus,
} from "../types/stocktake.js";
import type { CreateStocktakeLineInput, StocktakeRepository } from "./stocktakeRepository.js";

// ── Row types ─────────────────────────────────────────────────────────────────

type SessionRow = {
  id: string;
  clinic_id: string;
  name: string;
  status: string;
  created_by_user_id: string;
  created_by_email: string;
  started_by_user_id: string | null;
  started_by_email: string | null;
  completed_by_user_id: string | null;
  completed_by_email: string | null;
  cancelled_by_user_id: string | null;
  cancelled_by_email: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  total_lines?: string;
  counted_lines?: string;
};

type LineRow = {
  id: string;
  session_id: string;
  clinic_id: string;
  clinic_inventory_item_id: string;
  master_catalog_item_id: string;
  // Snapshot fields (stored at session-start — migration 020)
  product_name: string;
  category: string;
  stock_unit: string;
  primary_barcode: string | null;
  expected_quantity: number;
  counted_quantity: number | null;
  variance: number | null;
  unit_cost_cents: number;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  // Only present in view queries (JOIN to master_catalog_items for SKU)
  master_sku?: string;
};

// ── Converters ────────────────────────────────────────────────────────────────

function toSession(row: SessionRow): StocktakeSession {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    status: row.status as StocktakeStatus,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    startedByUserId: row.started_by_user_id,
    startedByEmail: row.started_by_email,
    completedByUserId: row.completed_by_user_id,
    completedByEmail: row.completed_by_email,
    cancelledByUserId: row.cancelled_by_user_id,
    cancelledByEmail: row.cancelled_by_email,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSessionView(row: SessionRow): StocktakeSessionView {
  return {
    ...toSession(row),
    totalLines: parseInt(row.total_lines ?? "0", 10),
    countedLines: parseInt(row.counted_lines ?? "0", 10),
  };
}

function toLine(row: LineRow): StocktakeLine {
  return {
    id: row.id,
    sessionId: row.session_id,
    clinicId: row.clinic_id,
    clinicInventoryItemId: row.clinic_inventory_item_id,
    masterCatalogItemId: row.master_catalog_item_id,
    productName: row.product_name,
    category: row.category,
    stockUnit: row.stock_unit,
    primaryBarcode: row.primary_barcode ?? null,
    expectedQuantity: row.expected_quantity,
    countedQuantity: row.counted_quantity,
    variance: row.variance,
    unitCostCents: row.unit_cost_cents,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toLineView(row: LineRow): StocktakeLineView {
  const line = toLine(row);
  const varianceValueCents =
    line.variance !== null ? line.variance * line.unitCostCents : null;
  return {
    ...line,
    masterSku: row.master_sku ?? "",
    varianceValueCents,
  };
}

// ── Session SELECT with aggregated line counts ─────────────────────────────────

const SESSION_VIEW_SELECT = `
  ss.*,
  COUNT(sl.id)::text AS total_lines,
  COUNT(sl.id) FILTER (WHERE sl.counted_quantity IS NOT NULL)::text AS counted_lines
FROM stocktake_sessions ss
LEFT JOIN stocktake_lines sl
  ON sl.session_id = ss.id AND sl.clinic_id = ss.clinic_id
`;

// ── Line SELECT: reads snapshot fields from stored columns ─────────────────────
//
// Since migration 020, product_name / category / stock_unit / primary_barcode
// are stored directly on stocktake_lines.  We only JOIN master_catalog_items
// to retrieve the master SKU (a stable identifier, not an audit-critical field).

const LINE_VIEW_SELECT = `
  sl.*,
  mci.sku AS master_sku
FROM stocktake_lines sl
JOIN master_catalog_items mci ON mci.id = sl.master_catalog_item_id
`;

// ── Repository factory ────────────────────────────────────────────────────────

export function createPostgresStocktakeRepository(
  pool: DatabasePool,
): StocktakeRepository {
  return {
    async createSession(input: CreateStocktakeSessionInput) {
      const { rows } = await pool.query<SessionRow>(
        `INSERT INTO stocktake_sessions
           (clinic_id, name, status, created_by_user_id, created_by_email)
         VALUES ($1, $2, 'draft', $3, $4)
         RETURNING *`,
        [
          input.clinicId,
          input.name,
          input.createdByUserId,
          input.createdByEmail,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error("Failed to create stocktake session");
      return toSession(row);
    },

    async findSessionById(clinicId, sessionId) {
      const { rows } = await pool.query<SessionRow>(
        `SELECT ${SESSION_VIEW_SELECT}
         WHERE ss.clinic_id = $1 AND ss.id = $2
         GROUP BY ss.id`,
        [clinicId, sessionId],
      );
      const row = rows[0];
      return row ? toSessionView(row) : null;
    },

    async listSessions(clinicId, options) {
      const limit = Math.min(options?.limit ?? 50, 100);
      const offset = options?.offset ?? 0;
      const statusFilter = options?.status;

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM stocktake_sessions
         WHERE clinic_id = $1
           ${statusFilter ? "AND status = $2" : ""}`,
        statusFilter ? [clinicId, statusFilter] : [clinicId],
      );
      const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

      const { rows } = await pool.query<SessionRow>(
        `SELECT ${SESSION_VIEW_SELECT}
         WHERE ss.clinic_id = $1
           ${statusFilter ? "AND ss.status = $2" : ""}
         GROUP BY ss.id
         ORDER BY ss.created_at DESC
         LIMIT $${statusFilter ? "3" : "2"} OFFSET $${statusFilter ? "4" : "3"}`,
        statusFilter
          ? [clinicId, statusFilter, limit, offset]
          : [clinicId, limit, offset],
      );

      return {
        items: rows.map(toSessionView),
        total,
        limit,
        offset,
      };
    },

    async updateSession(clinicId, sessionId, input) {
      if (Object.keys(input).length === 0) {
        return this.findSessionById(clinicId, sessionId);
      }
      const { rows } = await pool.query<SessionRow>(
        `UPDATE stocktake_sessions
         SET name = COALESCE($3, name),
             updated_at = NOW()
         WHERE clinic_id = $1 AND id = $2
         RETURNING *`,
        [clinicId, sessionId, input.name ?? null],
      );
      const row = rows[0];
      return row ? toSession(row) : null;
    },

    async updateSessionStatus(clinicId, sessionId, status, actor) {
      const fieldMap = {
        started: {
          userCol: "started_by_user_id",
          emailCol: "started_by_email",
          tsCol: "started_at",
        },
        completed: {
          userCol: "completed_by_user_id",
          emailCol: "completed_by_email",
          tsCol: "completed_at",
        },
        cancelled: {
          userCol: "cancelled_by_user_id",
          emailCol: "cancelled_by_email",
          tsCol: "cancelled_at",
        },
      };
      const { userCol, emailCol, tsCol } = fieldMap[actor.field];

      const { rows } = await pool.query<SessionRow>(
        `UPDATE stocktake_sessions
         SET status = $3,
             ${userCol} = $4,
             ${emailCol} = $5,
             ${tsCol} = $6,
             updated_at = NOW()
         WHERE clinic_id = $1 AND id = $2
         RETURNING *`,
        [clinicId, sessionId, status, actor.userId, actor.email, actor.timestamp],
      );
      const row = rows[0];
      return row ? toSession(row) : null;
    },

    async createLines(inputs: CreateStocktakeLineInput[]) {
      if (inputs.length === 0) return [];

      // 10 parameters per row; primary_barcode is looked up from barcode_mappings
      // at INSERT time via a scalar subquery so the snapshot is captured atomically.
      const values: unknown[] = [];
      const placeholders = inputs.map((input, i) => {
        const base = i * 10;
        values.push(
          input.sessionId,               // base+1
          input.clinicId,                // base+2
          input.clinicInventoryItemId,   // base+3
          input.masterCatalogItemId,     // base+4
          input.expectedQuantity,        // base+5
          input.countedQuantity ?? null, // base+6
          input.unitCostCents,           // base+7
          input.productName,             // base+8
          input.category,                // base+9
          input.stockUnit,               // base+10
        );
        const p = (n: number) => `$${String(n)}`;
        // The barcode subquery references the same master_catalog_item_id parameter
        // (base+4) so no extra parameter slot is needed.
        const mcIdRef = p(base + 4);
        return (
          `(${p(base + 1)}, ${p(base + 2)}, ${p(base + 3)}, ${p(base + 4)}, ` +
          `${p(base + 5)}, ${p(base + 6)}, ${p(base + 7)}, ${p(base + 8)}, ` +
          `${p(base + 9)}, ${p(base + 10)}, ` +
          `(SELECT bm.barcode_value FROM barcode_mappings bm ` +
          `WHERE bm.master_catalog_item_id = ${mcIdRef} AND bm.is_primary = TRUE LIMIT 1))`
        );
      });

      const { rows } = await pool.query<LineRow>(
        `INSERT INTO stocktake_lines
           (session_id, clinic_id, clinic_inventory_item_id, master_catalog_item_id,
            expected_quantity, counted_quantity, unit_cost_cents,
            product_name, category, stock_unit, primary_barcode)
         VALUES ${placeholders.join(", ")}
         RETURNING *`,
        values,
      );
      return rows.map(toLine);
    },

    async listLines(clinicId, sessionId) {
      const { rows } = await pool.query<LineRow>(
        `SELECT ${LINE_VIEW_SELECT}
         WHERE sl.clinic_id = $1 AND sl.session_id = $2
         ORDER BY sl.category ASC, sl.product_name ASC`,
        [clinicId, sessionId],
      );
      return rows.map(toLineView);
    },

    async findLineById(clinicId, lineId) {
      const { rows } = await pool.query<LineRow>(
        `SELECT * FROM stocktake_lines
         WHERE clinic_id = $1 AND id = $2`,
        [clinicId, lineId],
      );
      const row = rows[0];
      return row ? toLine(row) : null;
    },

    async updateLine(clinicId, lineId, input) {
      const { rows } = await pool.query<LineRow>(
        `UPDATE stocktake_lines
         SET counted_quantity = $3,
             notes = COALESCE($4, notes),
             updated_at = NOW()
         WHERE clinic_id = $1 AND id = $2
         RETURNING *`,
        [clinicId, lineId, input.countedQuantity, input.notes ?? null],
      );
      const row = rows[0];
      return row ? toLine(row) : null;
    },

    async listVarianceLines(clinicId, sessionId) {
      const { rows } = await pool.query<LineRow>(
        `SELECT ${LINE_VIEW_SELECT}
         WHERE sl.clinic_id = $1
           AND sl.session_id = $2
           AND sl.counted_quantity IS NOT NULL
           AND sl.counted_quantity <> sl.expected_quantity
         ORDER BY sl.category ASC, sl.product_name ASC`,
        [clinicId, sessionId],
      );
      return rows.map(toLineView);
    },
  };
}
