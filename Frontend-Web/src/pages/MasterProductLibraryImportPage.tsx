import { useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { MasterProductImportResult } from "../types/inventory.js";
import { canManageProducts } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

function outcomeLabel(outcome: MasterProductImportResult["rows"][number]["outcome"]): string {
  switch (outcome) {
    case "imported":
      return "Imported";
    case "skipped_duplicate":
      return "Skipped (duplicate)";
    case "skipped_invalid":
      return "Skipped (invalid)";
    default:
      return outcome;
  }
}

function outcomeBadgeClass(outcome: MasterProductImportResult["rows"][number]["outcome"]): string {
  if (outcome === "imported") return "inventory-badge inventory-badge--ok";
  return "inventory-badge inventory-badge--low";
}

export function MasterProductLibraryImportPage() {
  const { user } = useAuth();
  const { clinicId, clinicName, isAllClinicsScope } = useOperationalClinic();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [provisionClinic, setProvisionClinic] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [result, setResult] = useState<MasterProductImportResult | null>(null);

  if (!user) return null;

  if (!canManageProducts(user.role)) {
    return (
      <AppShell>
        <section className="status-card">
          <h2>Access Denied</h2>
          <p className="status-card__error">
            You do not have permission to import the Master Product Library. Only practice
            managers and administrators can perform this action.
          </p>
          <Link to="/inventory/products" className="link-button">
            Back to products
          </Link>
        </section>
      </AppShell>
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setApiError(null);
    setResult(null);
  }

  async function handleSubmit(): Promise<void> {
    if (!selectedFile) {
      setApiError("Choose a CSV or XLSX file to import.");
      return;
    }

    setIsSubmitting(true);
    setApiError(null);
    setResult(null);

    try {
      const targetClinicId = provisionClinic && !isAllClinicsScope ? clinicId : undefined;
      const importResult = await apiClient.importMasterProductLibrary(
        selectedFile,
        targetClinicId,
      );
      setResult(importResult);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : "Failed to import Master Product Library");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <section className="status-card inventory-page__section">
        <div className="status-card__header">
          <div>
            <h2>Master Product Library import</h2>
            <p className="inventory-page__subtitle">
              Bulk-import a curated Dental Master Product Library (XLSX/CSV) into catalogue
              products. This creates catalogue entries only — it never creates stock movements
              or increases inventory quantities.
            </p>
          </div>
          <Link to="/inventory/products" className="link-button">
            Back to products
          </Link>
        </div>

        <div className="inventory-receiving-callout" role="status">
          <h3>Required columns</h3>
          <p>
            <code>display_name</code>, <code>category</code>, and <code>status</code> are
            required for every row. <code>subcategory</code>, <code>brand</code>,{" "}
            <code>variant_attributes</code>, <code>default_unit</code>, and <code>notes</code>{" "}
            are optional. Products already matching an existing catalogue entry by normalised
            display name + category are skipped automatically.
          </p>
        </div>

        <div className="product-form__field product-form__full">
          <label>
            Master Product Library file (.csv, .xlsx, .xls)
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS.join(",")}
              onChange={handleFileChange}
            />
          </label>
        </div>

        {isAllClinicsScope ? (
          <p className="inventory-page__subtitle">
            Select a single clinic from the clinic selector to also provision imported products
            into that clinic&apos;s inventory at zero quantity. Without a clinic selected, this
            import only creates catalogue products.
          </p>
        ) : (
          <div className="product-form__field">
            <label>
              <input
                type="checkbox"
                checked={provisionClinic}
                onChange={(event) => {
                  setProvisionClinic(event.target.checked);
                }}
              />
              {" "}Also add new products to {clinicName ?? user.homeClinicName}&apos;s inventory
              at zero quantity on hand
            </label>
          </div>
        )}

        <div className="product-form__actions">
          <button
            type="button"
            disabled={isSubmitting || !selectedFile}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {isSubmitting ? "Importing…" : "Import library"}
          </button>
        </div>

        {apiError ? (
          <p className="status-card__error" role="alert">
            {apiError}
          </p>
        ) : null}

        {result ? (
          <div className="inventory-table-wrap">
            <div className="inventory-summary">
              <span>{result.totalRows} rows processed</span>
              <span className="inventory-summary__ok">{result.imported} imported</span>
              <span>{result.skippedDuplicates} duplicates skipped</span>
              <span>{result.skippedInvalid} invalid rows skipped</span>
            </div>
            <table className="inventory-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Display name</th>
                  <th scope="col">Category</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>{row.displayName ?? "—"}</td>
                    <td>{row.category ?? "—"}</td>
                    <td>
                      <span className={outcomeBadgeClass(row.outcome)}>
                        {outcomeLabel(row.outcome)}
                      </span>
                    </td>
                    <td>{row.errors.length > 0 ? row.errors.join("; ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
