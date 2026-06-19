import type { DatabasePool } from "../db/pool.js";
import type {
  CreateSupplierInput,
  Supplier,
  UpdateSupplierInput,
} from "../types/supplier.js";
import type { SupplierRepository } from "./supplierRepository.js";

// ─── Row type ─────────────────────────────────────────────────────────────────

type SupplierRow = {
  id: string;
  supplier_name: string;
  supplier_code: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

// ─── Mapper ───────────────────────────────────────────────────────────────────

function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    supplierName: row.supplier_name,
    supplierCode: row.supplier_code,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    website: row.website,
    notes: row.notes,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createPostgresSupplierRepository(
  pool: DatabasePool,
): SupplierRepository {
  return {
    async listSuppliers(options = {}): Promise<Supplier[]> {
      const params: unknown[] = [];
      let idx = 1;
      let whereClause = "";

      if (options.active !== undefined) {
        params.push(options.active);
        whereClause = `WHERE active = $${String(idx++)}`;
      }

      const { rows } = await pool.query<SupplierRow>(
        `SELECT * FROM suppliers ${whereClause} ORDER BY supplier_name`,
        params,
      );
      return rows.map(mapSupplier);
    },

    async findSupplierById(supplierId: string): Promise<Supplier | null> {
      const { rows } = await pool.query<SupplierRow>(
        `SELECT * FROM suppliers WHERE id = $1`,
        [supplierId],
      );
      return rows[0] ? mapSupplier(rows[0]) : null;
    },

    async findSupplierByCode(supplierCode: string): Promise<Supplier | null> {
      const { rows } = await pool.query<SupplierRow>(
        `SELECT * FROM suppliers WHERE UPPER(supplier_code) = UPPER($1) LIMIT 1`,
        [supplierCode],
      );
      return rows[0] ? mapSupplier(rows[0]) : null;
    },

    async createSupplier(input: CreateSupplierInput): Promise<Supplier> {
      const { rows } = await pool.query<SupplierRow>(
        `INSERT INTO suppliers
           (supplier_name, supplier_code, contact_name, email, phone, website, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.supplierName,
          input.supplierCode ?? null,
          input.contactName ?? null,
          input.email ?? null,
          input.phone ?? null,
          input.website ?? null,
          input.notes ?? null,
        ],
      );
      if (!rows[0]) throw new Error("INSERT supplier returned no rows");
      return mapSupplier(rows[0]);
    },

    async updateSupplier(
      supplierId: string,
      input: UpdateSupplierInput,
    ): Promise<Supplier | null> {
      const setClauses: string[] = [];
      const params: unknown[] = [];

      let idx = 1;
      const addField = (col: string, val: unknown) => {
        params.push(val);
        setClauses.push(`${col} = $${String(idx++)}`);
      };

      if (input.supplierName !== undefined) addField("supplier_name", input.supplierName);
      if (input.supplierCode !== undefined) addField("supplier_code", input.supplierCode);
      if (input.contactName !== undefined) addField("contact_name", input.contactName);
      if (input.email !== undefined) addField("email", input.email);
      if (input.phone !== undefined) addField("phone", input.phone);
      if (input.website !== undefined) addField("website", input.website);
      if (input.notes !== undefined) addField("notes", input.notes);
      if (input.active !== undefined) addField("active", input.active);

      if (setClauses.length === 0) {
        return this.findSupplierById(supplierId);
      }

      setClauses.push(`updated_at = now()`);
      params.push(supplierId);

      const { rows } = await pool.query<SupplierRow>(
        `UPDATE suppliers SET ${setClauses.join(", ")}
         WHERE id = $${String(idx)}
         RETURNING *`,
        params,
      );
      return rows[0] ? mapSupplier(rows[0]) : null;
    },
  };
}
