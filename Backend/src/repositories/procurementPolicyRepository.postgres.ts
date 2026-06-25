import type { DatabasePool } from "../db/pool.js";
import type {
  CreateProcurementPolicyInput,
  ProcurementPolicy,
  ProcurementPolicyStatus,
  ReorderStrategy,
  UpdateProcurementPolicyInput,
} from "../types/procurementPolicy.js";
import type { ProcurementPolicyRepository } from "./procurementPolicyRepository.js";

// ─── DB row shape ─────────────────────────────────────────────────────────────

type ProcurementPolicyRow = {
  id: string;
  clinic_id: string;
  supplier_relationship_id: string;
  master_catalog_item_id: string | null;
  policy_name: string;
  policy_status: string;
  priority: number;
  preferred_supplier: boolean;
  allow_fallback: boolean;
  fallback_priority: number | null;
  minimum_order_quantity: number | null;
  preferred_order_day: string | null;
  preferred_delivery_day: string | null;
  price_difference_threshold_percent: string | null;
  approval_required: boolean;
  reorder_strategy: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

const SELECT_COLUMNS = `
  id, clinic_id, supplier_relationship_id, master_catalog_item_id,
  policy_name, policy_status, priority, preferred_supplier, allow_fallback,
  fallback_priority, minimum_order_quantity, preferred_order_day,
  preferred_delivery_day, price_difference_threshold_percent,
  approval_required, reorder_strategy, notes, created_at, updated_at
`.trim();

function toPolicy(row: ProcurementPolicyRow): ProcurementPolicy {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    supplierRelationshipId: row.supplier_relationship_id,
    masterCatalogItemId: row.master_catalog_item_id,
    policyName: row.policy_name,
    policyStatus: row.policy_status as ProcurementPolicyStatus,
    priority: row.priority,
    preferredSupplier: row.preferred_supplier,
    allowFallback: row.allow_fallback,
    fallbackPriority: row.fallback_priority,
    minimumOrderQuantity: row.minimum_order_quantity,
    preferredOrderDay: row.preferred_order_day,
    preferredDeliveryDay: row.preferred_delivery_day,
    priceDifferenceThresholdPercent:
      row.price_difference_threshold_percent !== null
        ? parseFloat(row.price_difference_threshold_percent)
        : null,
    approvalRequired: row.approval_required,
    reorderStrategy: row.reorder_strategy as ReorderStrategy,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Implementation ───────────────────────────────────────────────────────────

export function createPostgresProcurementPolicyRepository(
  pool: DatabasePool,
): ProcurementPolicyRepository {
  return {
    async listByClinic(
      clinicId: string,
      options: { status?: ProcurementPolicyStatus } = {},
    ): Promise<ProcurementPolicy[]> {
      const params: unknown[] = [clinicId];
      let whereClause = "WHERE clinic_id = $1";

      if (options.status !== undefined) {
        params.push(options.status);
        whereClause += ` AND policy_status = $${String(params.length)}`;
      }

      const { rows } = await pool.query<ProcurementPolicyRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM procurement_policies
         ${whereClause}
         ORDER BY priority ASC, created_at ASC`,
        params,
      );
      return rows.map(toPolicy);
    },

    async listByRelationship(
      supplierRelationshipId: string,
    ): Promise<ProcurementPolicy[]> {
      const { rows } = await pool.query<ProcurementPolicyRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM procurement_policies
         WHERE supplier_relationship_id = $1
         ORDER BY priority ASC, created_at ASC`,
        [supplierRelationshipId],
      );
      return rows.map(toPolicy);
    },

    async getById(policyId: string): Promise<ProcurementPolicy | null> {
      const { rows } = await pool.query<ProcurementPolicyRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM procurement_policies
         WHERE id = $1`,
        [policyId],
      );
      return rows[0] ? toPolicy(rows[0]) : null;
    },

    async create(
      clinicId: string,
      input: CreateProcurementPolicyInput,
    ): Promise<ProcurementPolicy> {
      const { rows } = await pool.query<ProcurementPolicyRow>(
        `INSERT INTO procurement_policies
           (clinic_id, supplier_relationship_id, master_catalog_item_id,
            policy_name, policy_status, priority, preferred_supplier,
            allow_fallback, fallback_priority, minimum_order_quantity,
            preferred_order_day, preferred_delivery_day,
            price_difference_threshold_percent, approval_required,
            reorder_strategy, notes)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16)
         RETURNING ${SELECT_COLUMNS}`,
        [
          clinicId,
          input.supplierRelationshipId,
          input.masterCatalogItemId ?? null,
          input.policyName,
          input.policyStatus ?? "active",
          input.priority,
          input.preferredSupplier ?? false,
          input.allowFallback ?? false,
          input.fallbackPriority ?? null,
          input.minimumOrderQuantity ?? null,
          input.preferredOrderDay ?? null,
          input.preferredDeliveryDay ?? null,
          input.priceDifferenceThresholdPercent ?? null,
          input.approvalRequired ?? false,
          input.reorderStrategy ?? "standard",
          input.notes ?? null,
        ],
      );

      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create procurement policy — no row returned");
      }
      return toPolicy(row);
    },

    async update(
      policyId: string,
      input: UpdateProcurementPolicyInput,
    ): Promise<ProcurementPolicy | null> {
      const sets: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      let p = 1;

      const push = (col: string, value: unknown): void => {
        sets.push(`${col} = $${String(p++)}`);
        params.push(value);
      };

      if (input.policyName !== undefined) push("policy_name", input.policyName);
      if (input.policyStatus !== undefined)
        push("policy_status", input.policyStatus);
      if (input.priority !== undefined) push("priority", input.priority);
      if (input.preferredSupplier !== undefined)
        push("preferred_supplier", input.preferredSupplier);
      if (input.allowFallback !== undefined)
        push("allow_fallback", input.allowFallback);
      if (input.fallbackPriority !== undefined)
        push("fallback_priority", input.fallbackPriority);
      if (input.minimumOrderQuantity !== undefined)
        push("minimum_order_quantity", input.minimumOrderQuantity);
      if (input.preferredOrderDay !== undefined)
        push("preferred_order_day", input.preferredOrderDay);
      if (input.preferredDeliveryDay !== undefined)
        push("preferred_delivery_day", input.preferredDeliveryDay);
      if (input.priceDifferenceThresholdPercent !== undefined)
        push(
          "price_difference_threshold_percent",
          input.priceDifferenceThresholdPercent,
        );
      if (input.approvalRequired !== undefined)
        push("approval_required", input.approvalRequired);
      if (input.reorderStrategy !== undefined)
        push("reorder_strategy", input.reorderStrategy);
      if (input.notes !== undefined) push("notes", input.notes);

      if (sets.length === 1) {
        return this.getById(policyId);
      }

      params.push(policyId);
      const { rows } = await pool.query<ProcurementPolicyRow>(
        `UPDATE procurement_policies
         SET ${sets.join(", ")}
         WHERE id = $${String(p)}
         RETURNING ${SELECT_COLUMNS}`,
        params,
      );

      return rows[0] ? toPolicy(rows[0]) : null;
    },

    async deactivate(policyId: string): Promise<ProcurementPolicy | null> {
      const { rows } = await pool.query<ProcurementPolicyRow>(
        `UPDATE procurement_policies
         SET policy_status = 'inactive', updated_at = now()
         WHERE id = $1
         RETURNING ${SELECT_COLUMNS}`,
        [policyId],
      );
      return rows[0] ? toPolicy(rows[0]) : null;
    },

    async findActivePreferred(
      clinicId: string,
      masterCatalogItemId: string | null,
      excludePolicyId?: string,
    ): Promise<ProcurementPolicy | null> {
      const params: unknown[] = [clinicId];
      let sql = `SELECT ${SELECT_COLUMNS}
         FROM procurement_policies
         WHERE clinic_id = $1
           AND preferred_supplier = true
           AND policy_status = 'active'`;

      if (masterCatalogItemId === null) {
        sql += " AND master_catalog_item_id IS NULL";
      } else {
        params.push(masterCatalogItemId);
        sql += ` AND master_catalog_item_id = $${String(params.length)}`;
      }

      if (excludePolicyId !== undefined) {
        params.push(excludePolicyId);
        sql += ` AND id <> $${String(params.length)}`;
      }

      sql += " LIMIT 1";

      const { rows } = await pool.query<ProcurementPolicyRow>(sql, params);
      return rows[0] ? toPolicy(rows[0]) : null;
    },

    async findActiveByPriority(
      clinicId: string,
      masterCatalogItemId: string | null,
      priority: number,
      excludePolicyId?: string,
    ): Promise<ProcurementPolicy[]> {
      const params: unknown[] = [clinicId, priority];
      let sql = `SELECT ${SELECT_COLUMNS}
         FROM procurement_policies
         WHERE clinic_id = $1
           AND priority = $2
           AND policy_status = 'active'`;

      if (masterCatalogItemId === null) {
        sql += " AND master_catalog_item_id IS NULL";
      } else {
        params.push(masterCatalogItemId);
        sql += ` AND master_catalog_item_id = $${String(params.length)}`;
      }

      if (excludePolicyId !== undefined) {
        params.push(excludePolicyId);
        sql += ` AND id <> $${String(params.length)}`;
      }

      const { rows } = await pool.query<ProcurementPolicyRow>(sql, params);
      return rows.map(toPolicy);
    },
  };
}
