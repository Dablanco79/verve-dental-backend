import type { DatabasePool } from "../db/pool.js";
import type {
  CreateSupplierRelationshipInput,
  SupplierRelationship,
  SupplierRelationshipStatus,
  UpdateSupplierRelationshipInput,
} from "../types/supplierRelationship.js";
import { AppError } from "../types/errors.js";
import type { SupplierRelationshipRepository } from "./supplierRelationshipRepository.js";

// ─── DB row shape ──────────────────────────────────────────────────────────────

type SupplierRelationshipRow = {
  id: string;
  supplier_id: string;
  clinic_id: string;
  relationship_status: string;
  preferred_supplier: boolean;
  account_number: string | null;
  customer_number: string | null;
  credit_terms: string | null;
  credit_limit_cents: number | null;
  ordering_email: string | null;
  delivery_address: string | null;
  invoice_address: string | null;
  representative_name: string | null;
  representative_email: string | null;
  representative_phone: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

const SELECT_COLUMNS = `
  id, supplier_id, clinic_id, relationship_status, preferred_supplier,
  account_number, customer_number, credit_terms, credit_limit_cents,
  ordering_email, delivery_address, invoice_address,
  representative_name, representative_email, representative_phone,
  notes, created_at, updated_at
`.trim();

function toSupplierRelationship(row: SupplierRelationshipRow): SupplierRelationship {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    clinicId: row.clinic_id,
    relationshipStatus: row.relationship_status as SupplierRelationshipStatus,
    preferredSupplier: row.preferred_supplier,
    accountNumber: row.account_number,
    customerNumber: row.customer_number,
    creditTerms: row.credit_terms,
    creditLimitCents: row.credit_limit_cents,
    orderingEmail: row.ordering_email,
    deliveryAddress: row.delivery_address,
    invoiceAddress: row.invoice_address,
    representativeName: row.representative_name,
    representativeEmail: row.representative_email,
    representativePhone: row.representative_phone,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Implementation ────────────────────────────────────────────────────────────

export function createPostgresSupplierRelationshipRepository(
  pool: DatabasePool,
): SupplierRelationshipRepository {
  return {
    async listByClinic(
      clinicId: string,
      options: { status?: SupplierRelationshipStatus } = {},
    ): Promise<SupplierRelationship[]> {
      const params: unknown[] = [clinicId];
      let whereClause = "WHERE clinic_id = $1";

      if (options.status !== undefined) {
        params.push(options.status);
        whereClause += ` AND relationship_status = $${String(params.length)}`;
      }

      const { rows } = await pool.query<SupplierRelationshipRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM supplier_relationships
         ${whereClause}
         ORDER BY created_at ASC`,
        params,
      );
      return rows.map(toSupplierRelationship);
    },

    async listBySupplier(supplierId: string): Promise<SupplierRelationship[]> {
      const { rows } = await pool.query<SupplierRelationshipRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM supplier_relationships
         WHERE supplier_id = $1
         ORDER BY created_at ASC`,
        [supplierId],
      );
      return rows.map(toSupplierRelationship);
    },

    async getById(
      relationshipId: string,
    ): Promise<SupplierRelationship | null> {
      const { rows } = await pool.query<SupplierRelationshipRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM supplier_relationships
         WHERE id = $1`,
        [relationshipId],
      );
      return rows[0] ? toSupplierRelationship(rows[0]) : null;
    },

    async findByClinicAndSupplier(
      clinicId: string,
      supplierId: string,
    ): Promise<SupplierRelationship | null> {
      const { rows } = await pool.query<SupplierRelationshipRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM supplier_relationships
         WHERE clinic_id = $1
           AND supplier_id = $2`,
        [clinicId, supplierId],
      );
      return rows[0] ? toSupplierRelationship(rows[0]) : null;
    },

    async create(
      clinicId: string,
      input: CreateSupplierRelationshipInput,
    ): Promise<SupplierRelationship> {
      try {
        const { rows } = await pool.query<SupplierRelationshipRow>(
          `INSERT INTO supplier_relationships
             (supplier_id, clinic_id, relationship_status, preferred_supplier,
              account_number, customer_number, credit_terms, credit_limit_cents,
              ordering_email, delivery_address, invoice_address,
              representative_name, representative_email, representative_phone,
              notes)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING ${SELECT_COLUMNS}`,
          [
            input.supplierId,
            clinicId,
            input.relationshipStatus ?? "active",
            input.preferredSupplier ?? false,
            input.accountNumber ?? null,
            input.customerNumber ?? null,
            input.creditTerms ?? null,
            input.creditLimitCents ?? null,
            input.orderingEmail ?? null,
            input.deliveryAddress ?? null,
            input.invoiceAddress ?? null,
            input.representativeName ?? null,
            input.representativeEmail ?? null,
            input.representativePhone ?? null,
            input.notes ?? null,
          ],
        );

        const row = rows[0];
        if (!row) {
          throw new AppError(500, "INTERNAL_ERROR", "Failed to create supplier relationship");
        }
        return toSupplierRelationship(row);
      } catch (err: unknown) {
        // Postgres unique constraint violation (supplier_id, clinic_id)
        if (
          typeof err === "object" &&
          err !== null &&
          (err as { code?: string }).code === "23505"
        ) {
          throw new AppError(
            409,
            "DUPLICATE_SUPPLIER_RELATIONSHIP",
            "A relationship between this supplier and clinic already exists",
          );
        }
        throw err;
      }
    },

    async update(
      relationshipId: string,
      input: UpdateSupplierRelationshipInput,
    ): Promise<SupplierRelationship | null> {
      const sets: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      let p = 1;

      const push = (col: string, value: unknown): void => {
        sets.push(`${col} = $${String(p++)}`);
        params.push(value);
      };

      if (input.relationshipStatus !== undefined)
        push("relationship_status", input.relationshipStatus);
      if (input.preferredSupplier !== undefined)
        push("preferred_supplier", input.preferredSupplier);
      if (input.accountNumber !== undefined)
        push("account_number", input.accountNumber);
      if (input.customerNumber !== undefined)
        push("customer_number", input.customerNumber);
      if (input.creditTerms !== undefined) push("credit_terms", input.creditTerms);
      if (input.creditLimitCents !== undefined)
        push("credit_limit_cents", input.creditLimitCents);
      if (input.orderingEmail !== undefined)
        push("ordering_email", input.orderingEmail);
      if (input.deliveryAddress !== undefined)
        push("delivery_address", input.deliveryAddress);
      if (input.invoiceAddress !== undefined)
        push("invoice_address", input.invoiceAddress);
      if (input.representativeName !== undefined)
        push("representative_name", input.representativeName);
      if (input.representativeEmail !== undefined)
        push("representative_email", input.representativeEmail);
      if (input.representativePhone !== undefined)
        push("representative_phone", input.representativePhone);
      if (input.notes !== undefined) push("notes", input.notes);

      if (sets.length === 1) {
        return this.getById(relationshipId);
      }

      params.push(relationshipId);
      const { rows } = await pool.query<SupplierRelationshipRow>(
        `UPDATE supplier_relationships
         SET ${sets.join(", ")}
         WHERE id = $${String(p)}
         RETURNING ${SELECT_COLUMNS}`,
        params,
      );

      return rows[0] ? toSupplierRelationship(rows[0]) : null;
    },

    async deactivate(
      relationshipId: string,
    ): Promise<SupplierRelationship | null> {
      const { rows } = await pool.query<SupplierRelationshipRow>(
        `UPDATE supplier_relationships
         SET relationship_status = 'inactive', updated_at = now()
         WHERE id = $1
         RETURNING ${SELECT_COLUMNS}`,
        [relationshipId],
      );
      return rows[0] ? toSupplierRelationship(rows[0]) : null;
    },
  };
}
