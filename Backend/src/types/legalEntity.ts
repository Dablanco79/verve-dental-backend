/**
 * Sprint 4B — Legal Entity Foundation.
 *
 * A Legal Entity is a registered business/tax entity within an Organisation.
 * It is the layer that holds ABN/tax identifiers and will later be able to
 * sign supplier contracts.
 *
 * Design constraints:
 *   • Scoped to an Organisation (organisation_id is required on create).
 *   • `status` mirrors the Organisation pattern — string enum so future states
 *     can be added without a schema migration.
 *   • No delete operation — entities are deactivated via status = 'inactive'.
 *   • country_code and currency_code default to AU/AUD (Australian platform).
 *
 * Example hierarchy:
 *   Organisation: JD Dental Group
 *   └── Legal Entity: JD Dental Holdings Pty Ltd  (ABN 12 345 678 901)
 *   └── Legal Entity: JD Operations Pty Ltd       (ABN 98 765 432 109)
 */

export type LegalEntityStatus = "active" | "inactive";

export type LegalEntity = {
  id: string;
  organisationId: string;
  legalName: string;
  tradingName: string | null;
  abn: string | null;
  taxId: string | null;
  countryCode: string;
  currencyCode: string;
  registeredAddress: string | null;
  status: LegalEntityStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateLegalEntityInput = {
  /** Optional — allows deterministic seeding; omit for server-generated UUID. */
  id?: string;
  legalName: string;
  tradingName?: string | null;
  abn?: string | null;
  taxId?: string | null;
  /** Defaults to 'AU' when omitted. */
  countryCode?: string;
  /** Defaults to 'AUD' when omitted. */
  currencyCode?: string;
  registeredAddress?: string | null;
  status?: LegalEntityStatus;
};

export type UpdateLegalEntityInput = {
  legalName?: string;
  tradingName?: string | null;
  abn?: string | null;
  taxId?: string | null;
  countryCode?: string;
  currencyCode?: string;
  registeredAddress?: string | null;
  status?: LegalEntityStatus;
};
