/**
 * PilotResetPage
 *
 * PILOT RESET — DESTRUCTIVE TEST UTILITY
 *
 * This page deletes pilot/test operational data from a selected clinic.
 * It is hidden entirely unless VITE_PILOT_RESET_ENABLED=true and the
 * authenticated user is owner_admin.
 *
 * Steps:
 *   1 → Select Clinic
 *   2 → Select Mode (Operational / Full Pilot)
 *   3 → Preview Reset (calls /preview, shows counts)
 *   4 → MFA Re-authentication
 *   5 → Typed Confirmation Phrase
 *   6 → Execute (calls /execute)
 *   7 → Result Summary
 */

import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../auth/useAuth.js";
import { useSelectedClinic } from "../clinic/useSelectedClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import { createApiClient } from "../api/client.js";
import type {
  PilotResetMode,
  PilotResetPreviewData,
  PilotResetExecuteData,
} from "../api/client.js";
import type { ClinicOption } from "../clinic/clinicContext.js";

type Step =
  | "select_clinic"
  | "select_mode"
  | "preview"
  | "mfa"
  | "confirm"
  | "executing"
  | "result";

const apiClient = createApiClient(loadConfig());

// ─── Sub-components ───────────────────────────────────────────────────────────

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fff3cd",
        border: "2px solid #e6a800",
        borderRadius: "6px",
        padding: "12px 16px",
        marginBottom: "16px",
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function DangerBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fde8e8",
        border: "2px solid #c0392b",
        borderRadius: "6px",
        padding: "12px 16px",
        marginBottom: "16px",
        fontWeight: 600,
        color: "#c0392b",
      }}
    >
      {children}
    </div>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #eee" }}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SubCountRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0 2px 16px", borderBottom: "1px dashed #f0f0f0", fontSize: "12px", color: "#555" }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function PilotResetPage() {
  const { user } = useAuth();
  const { availableClinics } = useSelectedClinic();
  const config = loadConfig();

  // All hooks must be called unconditionally (Rules of Hooks)
  const [step, setStep] = useState<Step>("select_clinic");
  const [selectedClinic, setSelectedClinic] = useState<ClinicOption | null>(null);
  const [mode, setMode] = useState<PilotResetMode>("operational");
  const [preview, setPreview] = useState<PilotResetPreviewData | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PilotResetExecuteData | null>(null);
  // Tracks whether the preview nonce has expired client-side while on Step 5.
  // The backend is always authoritative; this is a UX-only guard.
  const [previewExpired, setPreviewExpired] = useState(false);

  // Arm a countdown timer whenever the user reaches the confirmation step.
  // Cleared when they leave the step so no timer leaks exist.
  useEffect(() => {
    if (step !== "confirm" || !preview) {
      setPreviewExpired(false);
      return;
    }
    const expiresAt = Date.parse(preview.previewExpiresAt);
    if (Date.now() >= expiresAt) {
      setPreviewExpired(true);
      return;
    }
    const msUntilExpiry = expiresAt - Date.now();
    const timer = setTimeout(() => { setPreviewExpired(true); }, msUntilExpiry);
    return () => { clearTimeout(timer); };
  }, [step, preview]);

  // Guard: feature flag + role (after all hooks)
  if (!config.pilotResetEnabled || user?.role !== "owner_admin") {
    return <Navigate to="/" replace />;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleSelectClinic(clinic: ClinicOption) {
    setError(null);
    setPreviewExpired(false);
    setSelectedClinic(clinic);
    setPreview(null);
    setMfaCode("");
    setConfirmationPhrase("");
    setStep("select_mode");
  }

  function handleSelectMode(selectedMode: PilotResetMode) {
    setError(null);
    setMode(selectedMode);
    setPreview(null);
    setStep("preview");
  }

  async function handlePreview() {
    if (!selectedClinic) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.previewPilotReset({
        clinicId: selectedClinic.id,
        mode,
      });
      setPreview(data);
      setStep("mfa");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleMfaSubmit() {
    if (mfaCode.length !== 6 || !/^\d{6}$/.test(mfaCode)) {
      setError("Please enter a valid 6-digit TOTP code from your authenticator app.");
      return;
    }
    setError(null);
    setStep("confirm");
  }

  async function handleExecute() {
    if (!selectedClinic || !preview) return;
    if (confirmationPhrase !== preview.expectedConfirmationPhrase) {
      setError("Confirmation phrase does not match. Please type it exactly as shown.");
      return;
    }

    // Client-side expiry guard — avoids a network round-trip when the user
    // has already been shown the "Preview expired" banner. The backend is
    // always the authoritative validator; this only improves UX.
    if (Date.now() >= Date.parse(preview.previewExpiresAt)) {
      setPreviewExpired(true);
      setError("Preview has expired. Please re-run Preview before executing.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setStep("executing");

    try {
      const data = await apiClient.executePilotReset({
        clinicId: selectedClinic.id,
        mode,
        previewToken: preview.previewToken,
        mfaCode,
        confirmationPhrase,
      });
      setResult(data);
      setStep("result");
    } catch (err) {
      // Return to Step 5. confirmationPhrase is preserved so the user does
      // not need to retype it. The error banner is set BEFORE setStep so
      // that both state updates are batched into the same render, and no
      // separate effect clears the message before the user sees it.
      setError(err instanceof Error ? err.message : "Execution failed. Please try again.");
      setStep("confirm");
    } finally {
      setIsLoading(false);
    }
  }

  function handleReset() {
    setStep("select_clinic");
    setSelectedClinic(null);
    setPreview(null);
    setMfaCode("");
    setConfirmationPhrase("");
    setResult(null);
    setError(null);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "24px" }}>
        <DangerBanner>
          PILOT RESET — DESTRUCTIVE TEST UTILITY
          <div style={{ fontWeight: 400, marginTop: "4px", fontSize: "14px" }}>
            This feature deletes pilot/test operational data. Do not use in production.
          </div>
        </DangerBanner>

        {/* ── Step 1: Select Clinic ──────────────────────────────────────── */}
        {step === "select_clinic" && (
          <div>
            <h2>Step 1 — Select Clinic</h2>
            <p>Select the clinic whose pilot/test data you want to reset. No data will be deleted until the final Execute step.</p>
            {availableClinics.length === 0 ? (
              <p>No clinics available.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0 }}>
                {availableClinics.map((clinic) => (
                  <li key={clinic.id} style={{ marginBottom: "8px" }}>
                    <button
                      type="button"
                      onClick={() => { handleSelectClinic(clinic); }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "12px 16px",
                        border: "1px solid #ccc",
                        borderRadius: "6px",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <strong>{clinic.name}</strong>
                      <div style={{ fontSize: "12px", color: "#666" }}>
                        ID: {clinic.id}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Step 2: Select Mode ────────────────────────────────────────── */}
        {step === "select_mode" && selectedClinic && (
          <div>
            <h2>Step 2 — Select Reset Mode</h2>
            <p>
              Clinic: <strong>{selectedClinic.name}</strong>
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <button
                type="button"
                onClick={() => { handleSelectMode("operational"); }}
                style={{
                  padding: "16px",
                  border: "2px solid #0066cc",
                  borderRadius: "6px",
                  background: "#f0f7ff",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <strong>OPERATIONAL RESET</strong>
                <p style={{ margin: "4px 0 0", fontSize: "14px" }}>
                  Clears procurement and inventory transactions while preserving product, supplier and clinic configuration.
                </p>
              </button>
              <button
                type="button"
                onClick={() => { handleSelectMode("full_pilot"); }}
                style={{
                  padding: "16px",
                  border: "2px solid #c0392b",
                  borderRadius: "6px",
                  background: "#fde8e8",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <strong>FULL PILOT RESET</strong>
                <p style={{ margin: "4px 0 0", fontSize: "14px" }}>
                  Returns this clinic to a clean operational starting point while preserving users, global suppliers, global Master Products, security and immutable audit history.
                </p>
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setError(null); setStep("select_clinic"); }}
              style={{ marginTop: "16px", padding: "8px 16px" }}
            >
              ← Back
            </button>
          </div>
        )}

        {/* ── Step 3: Preview ────────────────────────────────────────────── */}
        {step === "preview" && selectedClinic && (
          <div>
            <h2>Step 3 — Preview Reset</h2>
            <p>
              Clinic: <strong>{selectedClinic.name}</strong> | Mode:{" "}
              <strong>{mode === "operational" ? "Operational Reset" : "Full Pilot Reset"}</strong>
            </p>
            <p>
              Click <strong>Preview Reset</strong> to see exactly what will be deleted.
              No data will be changed at this step.
            </p>
            {error && <DangerBanner>{error}</DangerBanner>}
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={() => { setError(null); setStep("select_mode"); }}
                style={{ padding: "10px 20px" }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => { void handlePreview(); }}
                disabled={isLoading}
                style={{
                  padding: "10px 24px",
                  background: "#0066cc",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: isLoading ? "not-allowed" : "pointer",
                }}
              >
                {isLoading ? "Loading preview…" : "Preview Reset"}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: MFA (shows preview results + MFA input) ──────────── */}
        {step === "mfa" && preview && selectedClinic && (
          <div>
            <h2>Preview Results & MFA Verification</h2>

            {preview.blockers.length > 0 && (
              <DangerBanner>
                <strong>BLOCKED — Cannot proceed:</strong>
                <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
                  {preview.blockers.map((b, i) => (
                    <li key={i}>{b.message}</li>
                  ))}
                </ul>
              </DangerBanner>
            )}

            {preview.warnings.length > 0 && (
              <WarningBanner>
                <strong>Warnings:</strong>
                <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </WarningBanner>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div style={{ border: "1px solid #ccc", borderRadius: "6px", padding: "16px" }}>
                <h3 style={{ margin: "0 0 12px", color: "#c0392b" }}>WILL BE DELETED</h3>
                <CountRow label="Purchasing Drafts" value={preview.deleteCounts.purchasingDrafts} />
                <CountRow label="Purchase Orders (total DB records)" value={preview.deleteCounts.draftPurchaseOrders} />
                <SubCountRow label="↳ Operational (with product lines)" value={preview.deleteCounts.draftPurchaseOrdersOperational} />
                {preview.deleteCounts.draftPurchaseOrdersEmpty > 0 && (
                  <SubCountRow label="↳ Empty / abandoned records" value={preview.deleteCounts.draftPurchaseOrdersEmpty} />
                )}
                <CountRow label="PO Lines (total DB records)" value={preview.deleteCounts.draftPoLines} />
                <SubCountRow label="↳ Active product lines" value={preview.deleteCounts.draftPoLinesActive} />
                {preview.deleteCounts.draftPoLinesHistorical > 0 && (
                  <SubCountRow label="↳ Historical (cancelled / received)" value={preview.deleteCounts.draftPoLinesHistorical} />
                )}
                <CountRow label="Stocktake Sessions" value={preview.deleteCounts.stocktakeSessions} />
                <CountRow label="Stocktake Lines" value={preview.deleteCounts.stocktakeLines} />
                <CountRow label="Supplier Invoices" value={preview.deleteCounts.supplierInvoices} />
                <CountRow label="Invoice / OCR Lines" value={preview.deleteCounts.supplierInvoiceLines} />
                <CountRow label="Supplier Price History" value={preview.deleteCounts.supplierPriceHistory} />
                {mode === "full_pilot" && (
                  <>
                    <CountRow label="Product-Supplier Links" value={preview.deleteCounts.productSuppliers} />
                    <CountRow label="Contract Prices" value={preview.deleteCounts.supplierContractPrices} />
                    <CountRow label="Supplier Contracts" value={preview.deleteCounts.supplierContracts} />
                    <CountRow label="Procurement Policies" value={preview.deleteCounts.procurementPolicies} />
                    <CountRow label="Supplier Relationships" value={preview.deleteCounts.supplierRelationships} />
                    <CountRow label="Clinic Products (permanently removed)" value={preview.deleteCounts.clinicInventoryItemsDeleted} />
                  </>
                )}
              </div>
              <div style={{ border: "1px solid #ccc", borderRadius: "6px", padding: "16px" }}>
                <h3 style={{ margin: "0 0 12px", color: "#27ae60" }}>WILL BE PRESERVED</h3>
                {preview.preserved.map((item, i) => (
                  <div key={i} style={{ padding: "3px 0", fontSize: "14px" }}>
                    ✓ {item}
                  </div>
                ))}
              </div>
            </div>

            {mode === "full_pilot" && preview.deleteCounts.clinicInventoryItemsSoftZeroed > 0 && (
              <div style={{ border: "1px solid #e67e22", borderRadius: "6px", padding: "16px", marginBottom: "16px", background: "#fef9f0" }}>
                <h3 style={{ margin: "0 0 6px", color: "#e67e22" }}>WILL BE SOFT-ZEROED (rows retained)</h3>
                <p style={{ margin: "0 0 10px", fontSize: "13px", color: "#555" }}>
                  These clinic inventory records <strong>cannot be permanently removed</strong> because they are
                  referenced by append-only inventory adjustment history (required for audit compliance).
                  The <strong>row is kept</strong> but all operational values — current quantity, reorder point,
                  cost overrides, and supplier preference — will be <strong>reset to zero or cleared</strong>.
                </p>
                <CountRow label="Clinic Products (soft-zeroed — row retained, inventory cleared)" value={preview.deleteCounts.clinicInventoryItemsSoftZeroed} />
              </div>
            )}

            {mode === "full_pilot" && preview.orphanCounts.orphanMasterProductCandidates > 0 && (
              <WarningBanner>
                <strong>Orphan Master Products:</strong> {preview.orphanCounts.orphanMasterProductCandidates} Master Product(s) would become globally unreferenced.
                They are preserved — manual cleanup required separately.
              </WarningBanner>
            )}

            <p style={{ fontSize: "12px", color: "#666" }}>
              Preview expires at: {new Date(preview.previewExpiresAt).toLocaleTimeString()}
            </p>

            {preview.blockers.length === 0 && (
              <div style={{ marginTop: "16px", borderTop: "1px solid #ccc", paddingTop: "16px" }}>
                <h3>Step 4 — MFA Re-authentication</h3>
                <p>Enter the current 6-digit code from your authenticator app to continue.</p>
                {error && <DangerBanner>{error}</DangerBanner>}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => { setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6)); }}
                    placeholder="000000"
                    autoComplete="one-time-code"
                    style={{
                      padding: "10px 14px",
                      fontSize: "20px",
                      letterSpacing: "6px",
                      width: "140px",
                      border: "2px solid #ccc",
                      borderRadius: "6px",
                      fontFamily: "monospace",
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleMfaSubmit}
                    disabled={mfaCode.length !== 6}
                    style={{
                      padding: "10px 24px",
                      background: mfaCode.length === 6 ? "#0066cc" : "#ccc",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: mfaCode.length === 6 ? "pointer" : "not-allowed",
                    }}
                  >
                    Verify MFA →
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => { setError(null); setPreviewExpired(false); setStep("preview"); setPreview(null); setMfaCode(""); }}
              style={{ marginTop: "16px", padding: "8px 16px" }}
            >
              ← Re-run Preview
            </button>
          </div>
        )}

        {/* ── Step 5: Typed Confirmation ──────────────────────────────────── */}
        {step === "confirm" && preview && selectedClinic && (
          <div>
            <h2>Step 5 — Typed Confirmation</h2>
            <DangerBanner>
              You are about to permanently delete {mode === "operational" ? "operational transaction" : "pilot"} data
              from <strong>{selectedClinic.name}</strong>.
              <br />
              This action CANNOT be undone.
            </DangerBanner>

            {previewExpired ? (
              <DangerBanner>
                Preview expired. Re-run Preview before executing.
              </DangerBanner>
            ) : (
              <p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
                Preview expires at:{" "}
                <strong>{new Date(preview.previewExpiresAt).toLocaleTimeString()}</strong>
                {" "}— complete this step before then.
              </p>
            )}

            {error && <DangerBanner>{error}</DangerBanner>}

            <p>Type exactly:</p>
            <div
              style={{
                background: "#f4f4f4",
                border: "1px solid #ccc",
                borderRadius: "6px",
                padding: "12px 16px",
                fontFamily: "monospace",
                fontSize: "16px",
                letterSpacing: "1px",
                marginBottom: "12px",
                userSelect: "all",
              }}
            >
              {preview.expectedConfirmationPhrase}
            </div>
            <input
              type="text"
              value={confirmationPhrase}
              onChange={(e) => { setConfirmationPhrase(e.target.value); }}
              placeholder="Type the phrase above exactly…"
              disabled={previewExpired}
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: "14px",
                border: "2px solid #ccc",
                borderRadius: "6px",
                marginBottom: "16px",
                fontFamily: "monospace",
                boxSizing: "border-box",
                opacity: previewExpired ? 0.5 : 1,
              }}
            />
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={() => { setError(null); setStep("mfa"); setConfirmationPhrase(""); }}
                style={{ padding: "10px 20px" }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => { void handleExecute(); }}
                disabled={
                  previewExpired ||
                  confirmationPhrase !== preview.expectedConfirmationPhrase ||
                  isLoading
                }
                style={{
                  padding: "10px 24px",
                  background:
                    !previewExpired && confirmationPhrase === preview.expectedConfirmationPhrase
                      ? "#c0392b"
                      : "#ccc",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor:
                    !previewExpired && confirmationPhrase === preview.expectedConfirmationPhrase
                      ? "pointer"
                      : "not-allowed",
                  fontWeight: 700,
                }}
              >
                Execute Pilot Reset
              </button>
            </div>
          </div>
        )}

        {/* ── Step 6: Executing ──────────────────────────────────────────── */}
        {step === "executing" && (
          <div style={{ textAlign: "center", padding: "48px" }}>
            <p style={{ fontSize: "18px", fontWeight: 600 }}>Executing Pilot Reset…</p>
            <p style={{ color: "#666" }}>
              Please do not close this page. The reset is running inside a single database transaction.
            </p>
          </div>
        )}

        {/* ── Step 7: Result ─────────────────────────────────────────────── */}
        {step === "result" && result && selectedClinic && (
          <div>
            <div
              style={{
                background: "#d4edda",
                border: "2px solid #27ae60",
                borderRadius: "6px",
                padding: "16px",
                marginBottom: "16px",
              }}
            >
              <h2 style={{ margin: 0, color: "#155724" }}>Pilot Reset Completed</h2>
            </div>
            <p>
              <strong>Clinic:</strong> {result.clinic.name}
            </p>
            <p>
              <strong>Mode:</strong>{" "}
              {result.mode === "operational" ? "Operational Reset" : "Full Pilot Reset"}
            </p>
            <p>
              <strong>Completed:</strong> {new Date(result.completedAt).toLocaleString()}
            </p>
            <p>
              <strong>Audit Reference:</strong>{" "}
              <code style={{ fontSize: "12px" }}>{result.auditReference}</code>
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "16px" }}>
              <div style={{ border: "1px solid #ccc", borderRadius: "6px", padding: "16px" }}>
                <h3 style={{ margin: "0 0 12px" }}>Rows Deleted</h3>
                <CountRow label="Purchasing Drafts" value={result.deletedCounts.purchasingDrafts} />
                <CountRow label="Purchase Orders" value={result.deletedCounts.draftPurchaseOrders} />
                <CountRow label="PO Lines" value={result.deletedCounts.draftPoLines} />
                <CountRow label="Stocktake Sessions" value={result.deletedCounts.stocktakeSessions} />
                <CountRow label="Stocktake Lines" value={result.deletedCounts.stocktakeLines} />
                <CountRow label="Supplier Invoices" value={result.deletedCounts.supplierInvoices} />
                <CountRow label="Invoice Lines" value={result.deletedCounts.supplierInvoiceLines} />
                {mode === "full_pilot" && (
                  <>
                    <CountRow label="Supplier Relationships" value={result.deletedCounts.supplierRelationships} />
                    <CountRow label="Clinic Products (deleted)" value={result.deletedCounts.clinicInventoryItemsDeleted} />
                    <CountRow label="Clinic Products (soft-zeroed)" value={result.deletedCounts.clinicInventoryItemsSoftZeroed} />
                  </>
                )}
              </div>
              <div style={{ border: "1px solid #ccc", borderRadius: "6px", padding: "16px" }}>
                <h3 style={{ margin: "0 0 12px" }}>Post-Reset Checks</h3>
                {result.postResetChecks.map((check, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "3px 0",
                      fontSize: "13px",
                      color: check.passed ? "#155724" : "#c0392b",
                    }}
                  >
                    <span>{check.name}</span>
                    <strong>{check.passed ? "PASS" : "FAIL"}</strong>
                  </div>
                ))}
                {result.postResetChecks.some((c) => !c.passed) && (
                  <DangerBanner>
                    One or more post-reset checks failed. Review the above and contact support.
                  </DangerBanner>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleReset}
              style={{
                marginTop: "24px",
                padding: "10px 24px",
                background: "#555",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Start New Reset
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
