/**
 * StocktakeListPage — Workflow 2.1: Stocktake & Inventory Reconciliation
 *
 * Displays all stocktake sessions for the selected clinic.
 * Managers can create, start, complete and cancel sessions.
 * All roles can view and continue active sessions.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { createApiClient } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { useOperationalClinic } from "../clinic/useOperationalClinic.js";
import { AppShell } from "../components/layout/AppShell.js";
import { loadConfig } from "../config/index.js";
import type { StocktakeSession, StocktakeStatus } from "../types/stocktake.js";
import { STOCKTAKE_STATUS_LABELS } from "../types/stocktake.js";
import { canManageStocktake } from "../utils/roles.js";

const apiClient = createApiClient(loadConfig());

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusBadgeClass(status: StocktakeStatus): string {
  const map: Record<StocktakeStatus, string> = {
    draft: "stocktake-status-badge stocktake-status-badge--draft",
    in_progress: "stocktake-status-badge stocktake-status-badge--in-progress",
    completed: "stocktake-status-badge stocktake-status-badge--completed",
    cancelled: "stocktake-status-badge stocktake-status-badge--cancelled",
  };
  return map[status];
}

function progressText(session: StocktakeSession): string {
  if (session.totalLines === undefined) return "";
  const counted = session.countedLines ?? 0;
  const total = session.totalLines;
  if (total === 0) return "No items";
  const pct = Math.round((counted / total) * 100);
  return `${String(counted)} / ${String(total)} (${String(pct)}%)`;
}

// ── Create Session Modal ───────────────────────────────────────────────────────

type CreateModalProps = {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
};

function CreateSessionModal({ onClose, onCreate }: CreateModalProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Session name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create stocktake session">
      <div className="modal modal--sm">
        <header className="stocktake-modal__header">
          <h2 className="stocktake-modal__title">New Stocktake Session</h2>
          <button
            className="stocktake-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
          <div className="stocktake-modal__body">
            {error && <p className="stocktake-field-error">{error}</p>}
            <label className="stocktake-form-field">
              <span className="stocktake-form-field__label">Session Name</span>
              <input
                className="stocktake-input"
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); }}
                placeholder="e.g. Monthly Stocktake — July 2026"
                maxLength={255}
                required
                autoFocus
              />
            </label>
          </div>

          <footer className="stocktake-modal__footer">
            <button
              type="button"
              className="stocktake-btn stocktake-btn--secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="stocktake-btn stocktake-btn--primary"
              disabled={saving || !name.trim()}
            >
              {saving ? "Creating…" : "Create Session"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function StocktakeListPage() {
  const { user } = useAuth();
  const { clinicId, clinicName } = useOperationalClinic();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<StocktakeSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StocktakeStatus | "">("");

  const isManager = user ? canManageStocktake(user.role) : false;

  const loadSessions = useCallback(async () => {
    if (!clinicId) return;
    setIsLoading(true);
    setError(null);
    try {
      const page = await apiClient.listStocktakeSessions(clinicId, {
        status: statusFilter || undefined,
        limit: 100,
      });
      setSessions(page.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stocktake sessions.");
    } finally {
      setIsLoading(false);
    }
  }, [clinicId, statusFilter]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function handleCreate(name: string) {
    if (!clinicId) return;
    const session = await apiClient.createStocktakeSession(clinicId, { name });
    setShowCreateModal(false);
    await navigate(`/inventory/stocktakes/${session.id}`);
  }

  async function handleCancel(sessionId: string) {
    if (!clinicId) return;
    setActionError(null);
    try {
      await apiClient.cancelStocktakeSession(clinicId, sessionId);
      await loadSessions();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to cancel session.");
    }
  }

  if (!clinicId) {
    return (
      <AppShell>
        <div className="stocktake-page">
          <div className="stocktake-page__header">
            <div className="stocktake-page__header-left">
              <nav className="stocktake-page__nav" aria-label="Breadcrumb">
                <Link to="/inventory" className="stocktake-page__nav-link">Inventory</Link>
                <span className="stocktake-page__nav-sep" aria-hidden="true">/</span>
                <span className="stocktake-page__nav-current">Stocktake</span>
              </nav>
              <h1 className="stocktake-page__title">Stocktake Sessions</h1>
            </div>
          </div>
          <div className="stocktake-page__empty" role="status">
            <p>Select a specific clinic to view or start a stocktake.</p>
            <p className="stocktake-page__empty-hint">
              Stocktake is always clinic-specific. Use the clinic selector to choose a clinic.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="stocktake-page">
        {/* Header */}
        <div className="stocktake-page__header">
          <div className="stocktake-page__header-left">
            <nav className="stocktake-page__nav" aria-label="Breadcrumb">
              <Link to="/inventory" className="stocktake-page__nav-link">Inventory</Link>
              <span className="stocktake-page__nav-sep" aria-hidden="true">/</span>
              <span className="stocktake-page__nav-current">Stocktake</span>
            </nav>
            <h1 className="stocktake-page__title">Stocktake Sessions</h1>
            <p className="stocktake-page__subtitle">
              Count and reconcile stock for {clinicName}.
            </p>
          </div>
          {isManager && (
            <div className="stocktake-page__actions">
              <button
                className="stocktake-btn stocktake-btn--primary"
                onClick={() => { setShowCreateModal(true); }}
              >
                + New Session
              </button>
            </div>
          )}
        </div>

        {/* Filters — reuse existing billing-filters component styles */}
        <div className="billing-filters">
          <label className="billing-filters__field">
            <span className="billing-filters__label">Status</span>
            <select
              className="billing-filters__control"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as StocktakeStatus | ""); }}
            >
              <option value="">All statuses</option>
              {(Object.keys(STOCKTAKE_STATUS_LABELS) as StocktakeStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STOCKTAKE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Error banners */}
        {error && (
          <div className="stocktake-alert stocktake-alert--error" role="alert">
            {error}
            <button className="stocktake-alert__dismiss" onClick={() => { setError(null); }}>Dismiss</button>
          </div>
        )}
        {actionError && (
          <div className="stocktake-alert stocktake-alert--error" role="alert">
            {actionError}
            <button className="stocktake-alert__dismiss" onClick={() => { setActionError(null); }}>Dismiss</button>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <p className="stocktake-page__loading" aria-live="polite">Loading sessions…</p>
        )}

        {/* Empty state */}
        {!isLoading && sessions.length === 0 && (
          <div className="stocktake-page__empty">
            <p>No stocktake sessions found.</p>
            {isManager && (
              <button
                className="stocktake-btn stocktake-btn--primary"
                onClick={() => { setShowCreateModal(true); }}
              >
                Create your first session
              </button>
            )}
          </div>
        )}

        {/* Sessions table */}
        {!isLoading && sessions.length > 0 && (
          <div className="stocktake-page__table-wrap">
            <table className="stocktake-page__table" aria-label="Stocktake sessions">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Created</th>
                  <th>Started</th>
                  <th>Created By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td>
                      <Link
                        to={`/inventory/stocktakes/${session.id}`}
                        className="table-link"
                      >
                        {session.name}
                      </Link>
                    </td>
                    <td>
                      <span className={statusBadgeClass(session.status)}>
                        {STOCKTAKE_STATUS_LABELS[session.status]}
                      </span>
                    </td>
                    <td className="stocktake-page__col--num">
                      {session.status !== "draft" ? progressText(session) : "—"}
                    </td>
                    <td>{formatDate(session.createdAt)}</td>
                    <td>
                      {session.startedAt ? formatDate(session.startedAt) : "—"}
                    </td>
                    <td>{session.createdByEmail}</td>
                    <td>
                      <div className="table-actions">
                        {(session.status === "draft" || session.status === "in_progress") && (
                          <Link
                            to={`/inventory/stocktakes/${session.id}`}
                            className="stocktake-btn stocktake-btn--sm stocktake-btn--secondary"
                          >
                            {session.status === "draft" ? "View" : "Continue"}
                          </Link>
                        )}
                        {session.status === "completed" && (
                          <Link
                            to={`/inventory/stocktakes/${session.id}`}
                            className="stocktake-btn stocktake-btn--sm stocktake-btn--secondary"
                          >
                            View
                          </Link>
                        )}
                        {isManager &&
                          (session.status === "draft" || session.status === "in_progress") && (
                            <button
                              className="stocktake-btn stocktake-btn--sm stocktake-btn--danger"
                              onClick={() => { void handleCancel(session.id); }}
                            >
                              Cancel
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateSessionModal
          onClose={() => { setShowCreateModal(false); }}
          onCreate={handleCreate}
        />
      )}
    </AppShell>
  );
}
