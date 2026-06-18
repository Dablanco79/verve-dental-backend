import type { DatabasePool } from "../db/pool.js";
import { withTenantContext } from "../db/tenantContext.js";
import { AppError } from "../types/errors.js";
import type {
  AuditEvent,
  AuditEventsPage,
  AuditEntityType,
  CreateAuditEventInput,
  ListAuditEventsOptions,
} from "../types/analytics.js";
import type { AnalyticsRepository } from "./analyticsRepository.js";

// ─────────────────────────────────────────────────────────────────────────────
// Row mapper
// ─────────────────────────────────────────────────────────────────────────────

type AuditEventRow = {
  id: string;
  clinic_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string;
  actor_email: string;
  metadata: Record<string, unknown>;
  created_at: Date;
};

function rowToEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    entityType: row.entity_type as AuditEntityType,
    entityId: row.entity_id,
    action: row.action,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Postgres implementation
// ─────────────────────────────────────────────────────────────────────────────

export function createPostgresAnalyticsRepository(
  pool: DatabasePool,
): AnalyticsRepository {
  return {
    async recordEvent(input: CreateAuditEventInput): Promise<AuditEvent> {
      const result = await pool.query<AuditEventRow>(
        `INSERT INTO audit_events
           (clinic_id, entity_type, entity_id, action,
            actor_id, actor_email, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.clinicId,
          input.entityType,
          input.entityId,
          input.action,
          input.actorId,
          input.actorEmail,
          JSON.stringify(input.metadata),
        ],
      );
      const row = result.rows[0];
      if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create audit event");
      return rowToEvent(row);
    },

    async recordEventAdmin(input: CreateAuditEventInput): Promise<AuditEvent> {
      return withTenantContext(
        pool,
        input.clinicId,
        async (client) => {
          const result = await client.query<AuditEventRow>(
            `INSERT INTO audit_events
               (clinic_id, entity_type, entity_id, action,
                actor_id, actor_email, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              input.clinicId,
              input.entityType,
              input.entityId,
              input.action,
              input.actorId,
              input.actorEmail,
              JSON.stringify(input.metadata),
            ],
          );
          const row = result.rows[0];
          if (!row) throw new AppError(500, "INTERNAL_ERROR", "Failed to create audit event");
          return rowToEvent(row);
        },
        true, // ownerAdmin=true — bypasses clinic_id RLS check for auth events
      );
    },

    async listEvents(
      clinicId: string,
      options: ListAuditEventsOptions = {},
    ): Promise<AuditEventsPage> {
      const {
        entityType,
        actorId,
        entityId,
        from,
        to,
        limit = 50,
        offset = 0,
      } = options;

      const conditions: string[] = ["clinic_id = $1"];
      const params: unknown[] = [clinicId];
      let idx = 2;

      if (entityType !== undefined) {
        conditions.push(`entity_type = $${String(idx++)}`);
        params.push(entityType);
      }
      if (actorId !== undefined) {
        conditions.push(`actor_id = $${String(idx++)}`);
        params.push(actorId);
      }
      if (entityId !== undefined) {
        conditions.push(`entity_id = $${String(idx++)}`);
        params.push(entityId);
      }
      if (from !== undefined) {
        conditions.push(`created_at >= $${String(idx++)}`);
        params.push(from);
      }
      if (to !== undefined) {
        conditions.push(`created_at <= $${String(idx++)}`);
        params.push(to);
      }

      const where = conditions.join(" AND ");

      // COUNT query for total (no LIMIT/OFFSET).
      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM audit_events WHERE ${where}`,
        params,
      );
      const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

      // Paginated query.
      params.push(limit, offset);
      const dataResult = await pool.query<AuditEventRow>(
        `SELECT * FROM audit_events
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT $${String(idx)} OFFSET $${String(idx + 1)}`,
        params,
      );

      return {
        events: dataResult.rows.map(rowToEvent),
        total,
        limit,
        offset,
      };
    },

    async getEvent(id: string, clinicId: string): Promise<AuditEvent | null> {
      const result = await pool.query<AuditEventRow>(
        `SELECT * FROM audit_events WHERE id = $1 AND clinic_id = $2`,
        [id, clinicId],
      );
      return result.rows[0] ? rowToEvent(result.rows[0]) : null;
    },
  };
}
