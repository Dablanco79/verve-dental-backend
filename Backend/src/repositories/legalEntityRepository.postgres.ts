import type { DatabasePool } from "../db/pool.js";
import type {
  CreateLegalEntityInput,
  LegalEntity,
  LegalEntityStatus,
  UpdateLegalEntityInput,
} from "../types/legalEntity.js";
import { AppError } from "../types/errors.js";
import type { LegalEntityRepository } from "./legalEntityRepository.js";

// ─── DB row shape ──────────────────────────────────────────────────────────────

type LegalEntityRow = {
  id: string;
  organisation_id: string;
  legal_name: string;
  trading_name: string | null;
  abn: string | null;
  tax_id: string | null;
  country_code: string;
  currency_code: string;
  registered_address: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
};

const SELECT_COLUMNS = `
  id, organisation_id, legal_name, trading_name, abn, tax_id,
  country_code, currency_code, registered_address, status,
  created_at, updated_at
`.trim();

function toLegalEntity(row: LegalEntityRow): LegalEntity {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    legalName: row.legal_name,
    tradingName: row.trading_name,
    abn: row.abn,
    taxId: row.tax_id,
    countryCode: row.country_code,
    currencyCode: row.currency_code,
    registeredAddress: row.registered_address,
    status: row.status as LegalEntityStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Implementation ────────────────────────────────────────────────────────────

export function createPostgresLegalEntityRepository(
  pool: DatabasePool,
): LegalEntityRepository {
  return {
    async listByOrganisation(organisationId: string): Promise<LegalEntity[]> {
      const { rows } = await pool.query<LegalEntityRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM legal_entities
         WHERE organisation_id = $1
         ORDER BY legal_name ASC`,
        [organisationId],
      );
      return rows.map(toLegalEntity);
    },

    async getById(id: string): Promise<LegalEntity | null> {
      const { rows } = await pool.query<LegalEntityRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM legal_entities
         WHERE id = $1`,
        [id],
      );
      return rows[0] ? toLegalEntity(rows[0]) : null;
    },

    async create(
      organisationId: string,
      input: CreateLegalEntityInput,
    ): Promise<LegalEntity> {
      const idClause = input.id ? "$1" : "gen_random_uuid()";
      const params: unknown[] = [];
      let p = 1;

      const idParam = input.id ? params.push(input.id) && p++ : null;
      void idParam;

      const orgParam = params.push(organisationId) && p++;
      const legalNameParam = params.push(input.legalName) && p++;
      const tradingNameParam = params.push(input.tradingName ?? null) && p++;
      const abnParam = params.push(input.abn ?? null) && p++;
      const taxIdParam = params.push(input.taxId ?? null) && p++;
      const countryCodeParam = params.push(input.countryCode ?? "AU") && p++;
      const currencyCodeParam = params.push(input.currencyCode ?? "AUD") && p++;
      const registeredAddressParam =
        params.push(input.registeredAddress ?? null) && p++;
      const statusParam = params.push(input.status ?? "active") && p++;

      const { rows } = await pool.query<LegalEntityRow>(
        `INSERT INTO legal_entities
           (id, organisation_id, legal_name, trading_name, abn, tax_id,
            country_code, currency_code, registered_address, status)
         VALUES
           (${idClause},
            $${String(orgParam)}, $${String(legalNameParam)},
            $${String(tradingNameParam)}, $${String(abnParam)},
            $${String(taxIdParam)}, $${String(countryCodeParam)},
            $${String(currencyCodeParam)}, $${String(registeredAddressParam)},
            $${String(statusParam)})
         RETURNING ${SELECT_COLUMNS}`,
        params,
      );

      const row = rows[0];
      if (!row) {
        throw new AppError(
          500,
          "INTERNAL_ERROR",
          "Failed to create legal entity",
        );
      }
      return toLegalEntity(row);
    },

    async update(
      id: string,
      input: UpdateLegalEntityInput,
    ): Promise<LegalEntity | null> {
      const sets: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      let p = 1;

      const push = (col: string, value: unknown): void => {
        sets.push(`${col} = $${String(p++)}`);
        params.push(value);
      };

      if (input.legalName !== undefined) push("legal_name", input.legalName);
      if (input.tradingName !== undefined) push("trading_name", input.tradingName);
      if (input.abn !== undefined) push("abn", input.abn);
      if (input.taxId !== undefined) push("tax_id", input.taxId);
      if (input.countryCode !== undefined) push("country_code", input.countryCode);
      if (input.currencyCode !== undefined) push("currency_code", input.currencyCode);
      if (input.registeredAddress !== undefined)
        push("registered_address", input.registeredAddress);
      if (input.status !== undefined) push("status", input.status);

      if (sets.length === 1) {
        return this.getById(id);
      }

      params.push(id);
      const { rows } = await pool.query<LegalEntityRow>(
        `UPDATE legal_entities
         SET ${sets.join(", ")}
         WHERE id = $${String(p)}
         RETURNING ${SELECT_COLUMNS}`,
        params,
      );

      return rows[0] ? toLegalEntity(rows[0]) : null;
    },
  };
}
