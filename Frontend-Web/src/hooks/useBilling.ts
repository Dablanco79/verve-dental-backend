import { useCallback, useEffect, useState } from "react";

import { createApiClient } from "../api/client.js";
import { loadConfig } from "../config/index.js";
import type { Invoice, InvoiceFilters, RecordPaymentRequest } from "../types/billing.js";

const apiClient = createApiClient(loadConfig());

export type UseBillingResult = {
  invoices: Invoice[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  recordSettlement: (
    invoiceId: string,
    payload: RecordPaymentRequest,
  ) => Promise<void>;
};

/**
 * Fetches the internal invoice ledger for a clinic and exposes a
 * `recordSettlement` action for the settlement modal.
 *
 * Automatically re-fetches when clinicId or filters change.
 */
export function useBilling(
  clinicId: string | undefined,
  filters: InvoiceFilters = {},
): UseBillingResult {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersKey = JSON.stringify(filters);

  const fetch = useCallback(() => {
    if (!clinicId) return;

    setIsLoading(true);
    setError(null);

    void apiClient
      .listInvoices(clinicId, filters)
      .then((result) => {
        setInvoices(result);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load invoices");
        setInvoices([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, filtersKey]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const recordSettlement = useCallback(
    async (invoiceId: string, payload: RecordPaymentRequest): Promise<void> => {
      if (!clinicId) throw new Error("No clinic selected");
      await apiClient.recordPayment(clinicId, invoiceId, payload);
      fetch();
    },
    [clinicId, fetch],
  );

  return { invoices, isLoading, error, refetch: fetch, recordSettlement };
}
