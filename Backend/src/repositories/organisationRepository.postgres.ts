import type { DatabasePool } from "../db/pool.js";
import type {
  CreateOrganisationInput,
  Organisation,
  OrganisationStatus,
  UpdateOrganisationInput,
} from "../types/organisation.js";
import { AppError } from "../types/errors.js";
import type { OrganisationRepository } from "./organisationRepository.js";

// ─── DB row shape ──────────────────────────────────────────────────────────────

type OrganisationRow = {
  id: string;
  name: string;
  status: string;
  created_at: Date;
  updated_at: Date;
};

const SELECT_COLUMNS = `id, name, status, created_at, updated_at`;

function toOrganisation(row: OrganisationRow): Organisation {
  return {
    id: row.id,
    name: row.name,
    status: row.status as OrganisationStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Implementation ────────────────────────────────────────────────────────────

export function createPostgresOrganisationRepository(
  pool: DatabasePool,
): OrganisationRepository {
  return {
    async findById(id: string): Promise<Organisation | null> {
      const { rows } = await pool.query<OrganisationRow>(
        `SELECT ${SELECT_COLUMNS} FROM organisations WHERE id = $1`,
        [id],
      );
      return rows[0] ? toOrganisation(rows[0]) : null;
    },

    async findAll(): Promise<Organisation[]> {
      const { rows } = await pool.query<OrganisationRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM organisations
         ORDER BY name ASC`,
      );
      return rows.map(toOrganisation);
    },

    async create(input: CreateOrganisationInput): Promise<Organisation> {
      const idClause = input.id ? "$1" : "gen_random_uuid()";
      const params: unknown[] = [];
      let p = 1;

      const idParam = input.id ? params.push(input.id) && p++ : null;
      const nameParam = params.push(input.name) && p++;
      const statusParam = params.push(input.status ?? "active") && p++;

      void idParam;

      const { rows } = await pool.query<OrganisationRow>(
        `INSERT INTO organisations (id, name, status)
         VALUES (${idClause}, $${String(nameParam)}, $${String(statusParam)})
         RETURNING ${SELECT_COLUMNS}`,
        params,
      );

      const row = rows[0];
      if (!row) {
        throw new AppError(500, "INTERNAL_ERROR", "Failed to create organisation");
      }
      return toOrganisation(row);
    },

    async update(
      id: string,
      input: UpdateOrganisationInput,
    ): Promise<Organisation | null> {
      const sets: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      let p = 1;

      const push = (col: string, value: unknown): void => {
        sets.push(`${col} = $${String(p++)}`);
        params.push(value);
      };

      if (input.name !== undefined) push("name", input.name);
      if (input.status !== undefined) push("status", input.status);

      if (sets.length === 1) {
        return this.findById(id);
      }

      params.push(id);
      const { rows } = await pool.query<OrganisationRow>(
        `UPDATE organisations
         SET ${sets.join(", ")}
         WHERE id = $${String(p)}
         RETURNING ${SELECT_COLUMNS}`,
        params,
      );

      return rows[0] ? toOrganisation(rows[0]) : null;
    },
  };
}
