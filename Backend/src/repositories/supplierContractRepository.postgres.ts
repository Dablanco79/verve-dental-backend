import type { DatabasePool } from "../db/pool.js";
import type {
  CreateSupplierContractInput,
  SupplierContract,
  SupplierContractStatus,
  UpdateSupplierContractInput,
} from "../types/supplierContract.js";
import { AppError } from "../types/errors.js";
import type { SupplierContractRepository } from "./supplierContractRepository.js";

// ─── DB row shape ──────────────────────────────────────────────────────────────

type SupplierContractRow = {
  id: string;
  supplier_relationship_id: string;
  contract_name: string;
  contract_number: string | null;
  status: string;
  start_date: Date;
  end_date: Date;
  renewal_notice_days: number;
  payment_terms: string;
  freight_terms: string | null;
  minimum_order_value_cents: number | null;
  rebate_description: string | null;
  estimated_annual_commitment_cents: number | null;
  annual_spend_target_cents: number | null;
  contract_document_storage_key: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

const SELECT_COLUMNS = `
  id, supplier_relationship_id, contract_name, contract_number,
  status, start_date, end_date, renewal_notice_days,
  payment_terms, freight_terms, minimum_order_value_cents,
  rebate_description, estimated_annual_commitment_cents,
  annual_spend_target_cents, contract_document_storage_key,
  notes, created_at, updated_at
`.trim();

function toSupplierContract(row: SupplierContractRow): SupplierContract {
  return {
    id: row.id,
    supplierRelationshipId: row.supplier_relationship_id,
    contractName: row.contract_name,
    contractNumber: row.contract_number,
    status: row.status as SupplierContractStatus,
    startDate: row.start_date,
    endDate: row.end_date,
    renewalNoticeDays: row.renewal_notice_days,
    paymentTerms: row.payment_terms,
    freightTerms: row.freight_terms,
    minimumOrderValueCents: row.minimum_order_value_cents,
    rebateDescription: row.rebate_description,
    estimatedAnnualCommitmentCents: row.estimated_annual_commitment_cents,
    annualSpendTargetCents: row.annual_spend_target_cents,
    contractDocumentStorageKey: row.contract_document_storage_key,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Implementation ────────────────────────────────────────────────────────────

export function createPostgresSupplierContractRepository(
  pool: DatabasePool,
): SupplierContractRepository {
  return {
    async listByRelationship(
      relationshipId: string,
      options: { status?: SupplierContractStatus } = {},
    ): Promise<SupplierContract[]> {
      const params: unknown[] = [relationshipId];
      let whereClause = "WHERE supplier_relationship_id = $1";

      if (options.status !== undefined) {
        params.push(options.status);
        whereClause += ` AND status = $${String(params.length)}`;
      }

      const { rows } = await pool.query<SupplierContractRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM supplier_contracts
         ${whereClause}
         ORDER BY start_date DESC`,
        params,
      );
      return rows.map(toSupplierContract);
    },

    async getById(contractId: string): Promise<SupplierContract | null> {
      const { rows } = await pool.query<SupplierContractRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM supplier_contracts
         WHERE id = $1`,
        [contractId],
      );
      return rows[0] ? toSupplierContract(rows[0]) : null;
    },

    async create(
      relationshipId: string,
      input: CreateSupplierContractInput,
    ): Promise<SupplierContract> {
      try {
        const { rows } = await pool.query<SupplierContractRow>(
          `INSERT INTO supplier_contracts
             (supplier_relationship_id, contract_name, contract_number,
              status, start_date, end_date, renewal_notice_days,
              payment_terms, freight_terms, minimum_order_value_cents,
              rebate_description, estimated_annual_commitment_cents,
              annual_spend_target_cents, contract_document_storage_key, notes)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING ${SELECT_COLUMNS}`,
          [
            relationshipId,
            input.contractName,
            input.contractNumber ?? null,
            input.status ?? "draft",
            input.startDate,
            input.endDate,
            input.renewalNoticeDays ?? 0,
            input.paymentTerms,
            input.freightTerms ?? null,
            input.minimumOrderValueCents ?? null,
            input.rebateDescription ?? null,
            input.estimatedAnnualCommitmentCents ?? null,
            input.annualSpendTargetCents ?? null,
            input.contractDocumentStorageKey ?? null,
            input.notes ?? null,
          ],
        );

        const row = rows[0];
        if (!row) {
          throw new AppError(
            500,
            "INTERNAL_ERROR",
            "Failed to create supplier contract",
          );
        }
        return toSupplierContract(row);
      } catch (err: unknown) {
        // Postgres partial unique index violation: only one active contract per relationship
        if (
          typeof err === "object" &&
          err !== null &&
          (err as { code?: string }).code === "23505"
        ) {
          throw new AppError(
            409,
            "DUPLICATE_ACTIVE_CONTRACT",
            "An active contract already exists for this supplier relationship",
          );
        }
        throw err;
      }
    },

    async update(
      contractId: string,
      input: UpdateSupplierContractInput,
    ): Promise<SupplierContract | null> {
      const sets: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      let p = 1;

      const push = (col: string, value: unknown): void => {
        sets.push(`${col} = $${String(p++)}`);
        params.push(value);
      };

      if (input.contractName !== undefined) push("contract_name", input.contractName);
      if (input.contractNumber !== undefined) push("contract_number", input.contractNumber);
      if (input.status !== undefined) push("status", input.status);
      if (input.startDate !== undefined) push("start_date", input.startDate);
      if (input.endDate !== undefined) push("end_date", input.endDate);
      if (input.renewalNoticeDays !== undefined) push("renewal_notice_days", input.renewalNoticeDays);
      if (input.paymentTerms !== undefined) push("payment_terms", input.paymentTerms);
      if (input.freightTerms !== undefined) push("freight_terms", input.freightTerms);
      if (input.minimumOrderValueCents !== undefined) push("minimum_order_value_cents", input.minimumOrderValueCents);
      if (input.rebateDescription !== undefined) push("rebate_description", input.rebateDescription);
      if (input.estimatedAnnualCommitmentCents !== undefined) push("estimated_annual_commitment_cents", input.estimatedAnnualCommitmentCents);
      if (input.annualSpendTargetCents !== undefined) push("annual_spend_target_cents", input.annualSpendTargetCents);
      if (input.contractDocumentStorageKey !== undefined) push("contract_document_storage_key", input.contractDocumentStorageKey);
      if (input.notes !== undefined) push("notes", input.notes);

      if (sets.length === 1) {
        return this.getById(contractId);
      }

      params.push(contractId);

      try {
        const { rows } = await pool.query<SupplierContractRow>(
          `UPDATE supplier_contracts
           SET ${sets.join(", ")}
           WHERE id = $${String(p)}
           RETURNING ${SELECT_COLUMNS}`,
          params,
        );
        return rows[0] ? toSupplierContract(rows[0]) : null;
      } catch (err: unknown) {
        if (
          typeof err === "object" &&
          err !== null &&
          (err as { code?: string }).code === "23505"
        ) {
          throw new AppError(
            409,
            "DUPLICATE_ACTIVE_CONTRACT",
            "An active contract already exists for this supplier relationship",
          );
        }
        throw err;
      }
    },

    async expire(contractId: string): Promise<SupplierContract | null> {
      const { rows } = await pool.query<SupplierContractRow>(
        `UPDATE supplier_contracts
         SET status = 'expired', updated_at = now()
         WHERE id = $1
         RETURNING ${SELECT_COLUMNS}`,
        [contractId],
      );
      return rows[0] ? toSupplierContract(rows[0]) : null;
    },

    async terminate(contractId: string): Promise<SupplierContract | null> {
      const { rows } = await pool.query<SupplierContractRow>(
        `UPDATE supplier_contracts
         SET status = 'terminated', updated_at = now()
         WHERE id = $1
         RETURNING ${SELECT_COLUMNS}`,
        [contractId],
      );
      return rows[0] ? toSupplierContract(rows[0]) : null;
    },

    async findActiveByRelationship(
      relationshipId: string,
      excludeContractId?: string,
    ): Promise<SupplierContract | null> {
      const params: unknown[] = [relationshipId];
      let excludeClause = "";
      if (excludeContractId !== undefined) {
        params.push(excludeContractId);
        excludeClause = ` AND id != $${String(params.length)}`;
      }

      const { rows } = await pool.query<SupplierContractRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM supplier_contracts
         WHERE supplier_relationship_id = $1
           AND status = 'active'${excludeClause}
         LIMIT 1`,
        params,
      );
      return rows[0] ? toSupplierContract(rows[0]) : null;
    },
  };
}
