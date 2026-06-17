import type { DatabasePool } from "../db/pool.js";
import type {
  Clinic,
  ClinicSubscriptionTier,
  CreateClinicInput,
  UpdateClinicInput,
} from "../types/clinic.js";
import type { ClinicRepository } from "./clinicRepository.js";

// ─── DB row shape ─────────────────────────────────────────────────────────────

type ClinicRow = {
  id: string;
  name: string;
  abn: string | null;
  address_line1: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  timezone: string;
  subscription_tier: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

const SELECT_COLUMNS = `
  id, name, abn, address_line1, suburb, state, postcode,
  timezone, subscription_tier, is_active, created_at, updated_at
`;

function toClinic(row: ClinicRow): Clinic {
  return {
    id: row.id,
    name: row.name,
    abn: row.abn,
    addressLine1: row.address_line1,
    suburb: row.suburb,
    state: row.state,
    postcode: row.postcode,
    timezone: row.timezone,
    subscriptionTier: row.subscription_tier as ClinicSubscriptionTier,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Implementation ──────────────────────────────────────────────────────────

export function createPostgresClinicRepository(
  pool: DatabasePool,
): ClinicRepository {
  return {
    async findById(id: string): Promise<Clinic | null> {
      const { rows } = await pool.query<ClinicRow>(
        `SELECT ${SELECT_COLUMNS} FROM clinics WHERE id = $1`,
        [id],
      );
      return rows[0] ? toClinic(rows[0]) : null;
    },

    async findAll(): Promise<Clinic[]> {
      const { rows } = await pool.query<ClinicRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM clinics
         WHERE is_active = true
         ORDER BY name ASC`,
      );
      return rows.map(toClinic);
    },

    async create(input: CreateClinicInput): Promise<Clinic> {
      // Use the caller-supplied id (for seeding with fixed UUIDs) or fall back
      // to the database-generated gen_random_uuid().
      const idClause = input.id ? "$1" : "gen_random_uuid()";
      const params: unknown[] = [];
      let nextParam = 1;

      const idParam = input.id ? params.push(input.id) && nextParam++ : null;
      const nameParam = params.push(input.name) && nextParam++;
      const abnParam = params.push(input.abn ?? null) && nextParam++;
      const addr1Param = params.push(input.addressLine1 ?? null) && nextParam++;
      const suburbParam = params.push(input.suburb ?? null) && nextParam++;
      const stateParam = params.push(input.state ?? null) && nextParam++;
      const postcodeParam = params.push(input.postcode ?? null) && nextParam++;
      const tzParam =
        params.push(input.timezone ?? "Australia/Sydney") && nextParam++;
      const tierParam =
        params.push(input.subscriptionTier ?? "standard") && nextParam++;

      void idParam; // suppress unused-var lint; used inline in the query string.

      const { rows } = await pool.query<ClinicRow>(
        `INSERT INTO clinics
           (id, name, abn, address_line1, suburb, state, postcode,
            timezone, subscription_tier, is_active)
         VALUES
           (${idClause}, $${String(nameParam)}, $${String(abnParam)}, $${String(addr1Param)},
            $${String(suburbParam)}, $${String(stateParam)}, $${String(postcodeParam)},
            $${String(tzParam)}, $${String(tierParam)}, true)
         RETURNING ${SELECT_COLUMNS}`,
        params,
      );

      const row = rows[0];
      if (!row) throw new Error("Clinic INSERT returned no row — database error");
      return toClinic(row);
    },

    async update(id: string, input: UpdateClinicInput): Promise<Clinic | null> {
      // Dynamically build the SET clause — only columns present in `input` are
      // written.  updated_at is always refreshed.
      const sets: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      let p = 1;

      const push = (sql: string, value: unknown): void => {
        sets.push(`${sql} = $${String(p++)}`);
        params.push(value);
      };

      if (input.name !== undefined) push("name", input.name);
      if (input.abn !== undefined) push("abn", input.abn);
      if (input.addressLine1 !== undefined) push("address_line1", input.addressLine1);
      if (input.suburb !== undefined) push("suburb", input.suburb);
      if (input.state !== undefined) push("state", input.state);
      if (input.postcode !== undefined) push("postcode", input.postcode);
      if (input.timezone !== undefined) push("timezone", input.timezone);
      if (input.isActive !== undefined) push("is_active", input.isActive);

      // Nothing changed besides updated_at — skip the round-trip and return
      // the current record as-is.
      if (sets.length === 1) {
        return this.findById(id);
      }

      params.push(id);
      const { rows } = await pool.query<ClinicRow>(
        `UPDATE clinics
         SET ${sets.join(", ")}
         WHERE id = $${String(p)}
         RETURNING ${SELECT_COLUMNS}`,
        params,
      );

      return rows[0] ? toClinic(rows[0]) : null;
    },
  };
}
