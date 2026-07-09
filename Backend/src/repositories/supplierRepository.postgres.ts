import type { DatabasePool } from "../db/pool.js";
import type {
  CreateSupplierInput,
  Supplier,
  UpdateSupplierInput,
} from "../types/supplier.js";
import type { SupplierRepository } from "./supplierRepository.js";

// ─── Row type ─────────────────────────────────────────────────────────────────

type SupplierRow = {
  // ── Core ─────────────────────────────────────────────────────────────────────
  id: string;
  supplier_name: string;
  supplier_code: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  abn: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  // ── Sprint 4C metadata ────────────────────────────────────────────────────
  legal_name: string | null;
  trading_name: string | null;
  country_code: string;
  currency_code: string;
  industry_category: string | null;
  healthcare_subcategory: string | null;
  supplier_category: string | null;
  verified: boolean;
  api_available: boolean;
  catalogue_available: boolean;
  live_pricing: boolean;
  online_ordering: boolean;
  preferred_comm_method: string | null;
  logo_storage_key: string | null;
  created_by_clinic_id: string | null;
  is_public: boolean;
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
    abn: row.abn,
    address: row.address,
    notes: row.notes,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // ── Sprint 4C metadata ──────────────────────────────────────────────────
    legalName: row.legal_name,
    tradingName: row.trading_name,
    countryCode: row.country_code,
    currencyCode: row.currency_code,
    industryCategory: row.industry_category,
    healthcareSubcategory: row.healthcare_subcategory,
    supplierCategory: row.supplier_category,
    verified: row.verified,
    apiAvailable: row.api_available,
    catalogueAvailable: row.catalogue_available,
    livePricing: row.live_pricing,
    onlineOrdering: row.online_ordering,
    preferredCommMethod: row.preferred_comm_method,
    logoStorageKey: row.logo_storage_key,
    createdByClinicId: row.created_by_clinic_id,
    isPublic: row.is_public,
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

    async findSupplierByName(name: string): Promise<Supplier | null> {
      const { rows } = await pool.query<SupplierRow>(
        `SELECT * FROM suppliers WHERE LOWER(supplier_name) = LOWER($1) LIMIT 1`,
        [name.trim()],
      );
      return rows[0] ? mapSupplier(rows[0]) : null;
    },

    async findSupplierByAbn(abn: string): Promise<Supplier | null> {
      const normalized = abn.replace(/[\s-]/g, "");
      const { rows } = await pool.query<SupplierRow>(
        `SELECT * FROM suppliers WHERE REPLACE(REPLACE(abn, ' ', ''), '-', '') = $1 LIMIT 1`,
        [normalized],
      );
      return rows[0] ? mapSupplier(rows[0]) : null;
    },

    async findSupplierByEmail(email: string): Promise<Supplier | null> {
      const { rows } = await pool.query<SupplierRow>(
        `SELECT * FROM suppliers WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email.trim()],
      );
      return rows[0] ? mapSupplier(rows[0]) : null;
    },

    async findSupplierByPhone(phone: string): Promise<Supplier | null> {
      const digitsOnly = phone.replace(/\D/g, "");
      const { rows } = await pool.query<SupplierRow>(
        `SELECT * FROM suppliers WHERE REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = $1 LIMIT 1`,
        [digitsOnly],
      );
      return rows[0] ? mapSupplier(rows[0]) : null;
    },

    async findSupplierByWebsiteDomain(domain: string): Promise<Supplier | null> {
      const normalized = domain.toLowerCase();
      const { rows } = await pool.query<SupplierRow>(
        `SELECT * FROM suppliers
         WHERE LOWER(REGEXP_REPLACE(REGEXP_REPLACE(website, '^https?://(www\\.)?', '', 'i'), '/.*$', '')) = $1
         LIMIT 1`,
        [normalized],
      );
      return rows[0] ? mapSupplier(rows[0]) : null;
    },

    async createSupplier(input: CreateSupplierInput): Promise<Supplier> {
      const { rows } = await pool.query<SupplierRow>(
        `INSERT INTO suppliers
           (supplier_name, supplier_code, contact_name, email, phone, website, abn, address, notes,
            legal_name, trading_name, country_code, currency_code,
            industry_category, healthcare_subcategory, supplier_category,
            verified, api_available, catalogue_available, live_pricing, online_ordering,
            preferred_comm_method, logo_storage_key, created_by_clinic_id, is_public)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13,
            $14, $15, $16,
            $17, $18, $19, $20, $21,
            $22, $23, $24, $25)
         RETURNING *`,
        [
          input.supplierName,
          input.supplierCode ?? null,
          input.contactName ?? null,
          input.email ?? null,
          input.phone ?? null,
          input.website ?? null,
          input.abn ?? null,
          input.address ?? null,
          input.notes ?? null,
          // Sprint 4C
          input.legalName ?? null,
          input.tradingName ?? null,
          input.countryCode ?? "AU",
          input.currencyCode ?? "AUD",
          input.industryCategory ?? null,
          input.healthcareSubcategory ?? null,
          input.supplierCategory ?? null,
          input.verified ?? false,
          input.apiAvailable ?? false,
          input.catalogueAvailable ?? false,
          input.livePricing ?? false,
          input.onlineOrdering ?? false,
          input.preferredCommMethod ?? null,
          input.logoStorageKey ?? null,
          input.createdByClinicId ?? null,
          input.isPublic ?? true,
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

      // ── Core fields ────────────────────────────────────────────────────────
      if (input.supplierName !== undefined) addField("supplier_name", input.supplierName);
      if (input.supplierCode !== undefined) addField("supplier_code", input.supplierCode);
      if (input.contactName !== undefined) addField("contact_name", input.contactName);
      if (input.email !== undefined) addField("email", input.email);
      if (input.phone !== undefined) addField("phone", input.phone);
      if (input.website !== undefined) addField("website", input.website);
      if (input.abn !== undefined) addField("abn", input.abn);
      if (input.address !== undefined) addField("address", input.address);
      if (input.notes !== undefined) addField("notes", input.notes);
      if (input.active !== undefined) addField("active", input.active);
      // ── Sprint 4C metadata ─────────────────────────────────────────────────
      if (input.legalName !== undefined) addField("legal_name", input.legalName);
      if (input.tradingName !== undefined) addField("trading_name", input.tradingName);
      if (input.countryCode !== undefined) addField("country_code", input.countryCode);
      if (input.currencyCode !== undefined) addField("currency_code", input.currencyCode);
      if (input.industryCategory !== undefined) addField("industry_category", input.industryCategory);
      if (input.healthcareSubcategory !== undefined)
        addField("healthcare_subcategory", input.healthcareSubcategory);
      if (input.supplierCategory !== undefined) addField("supplier_category", input.supplierCategory);
      if (input.verified !== undefined) addField("verified", input.verified);
      if (input.apiAvailable !== undefined) addField("api_available", input.apiAvailable);
      if (input.catalogueAvailable !== undefined)
        addField("catalogue_available", input.catalogueAvailable);
      if (input.livePricing !== undefined) addField("live_pricing", input.livePricing);
      if (input.onlineOrdering !== undefined) addField("online_ordering", input.onlineOrdering);
      if (input.preferredCommMethod !== undefined)
        addField("preferred_comm_method", input.preferredCommMethod);
      if (input.logoStorageKey !== undefined) addField("logo_storage_key", input.logoStorageKey);
      if (input.isPublic !== undefined) addField("is_public", input.isPublic);

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
