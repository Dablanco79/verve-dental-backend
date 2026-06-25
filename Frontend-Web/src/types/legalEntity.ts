export type LegalEntityStatus = "active" | "inactive";

export type LegalEntityData = {
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
  createdAt: string;
  updatedAt: string;
};

export type CreateLegalEntityData = {
  legalName: string;
  tradingName?: string | null;
  abn?: string | null;
  taxId?: string | null;
  countryCode?: string;
  currencyCode?: string;
  registeredAddress?: string | null;
  status?: LegalEntityStatus;
};

export type UpdateLegalEntityData = {
  legalName?: string;
  tradingName?: string | null;
  abn?: string | null;
  taxId?: string | null;
  countryCode?: string;
  currencyCode?: string;
  registeredAddress?: string | null;
  status?: LegalEntityStatus;
};
