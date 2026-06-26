import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth.js";
import { ALL_CLINICS_DASHBOARD_SCOPE } from "../../clinic/clinicContext.js";
import { useSelectedClinic } from "../../clinic/useSelectedClinic.js";
import {
  canManageBilling,
  canManageClinics,
  canManageUsers,
  canViewAnalytics,
  canViewClinicSettings,
  canViewLaborForecast,
  canViewMaterialsForecast,
  canManageSuppliers,
} from "../../utils/roles.js";


type AppShellProps = {
  children: ReactNode;
};

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

export function AppShell({ children }: AppShellProps) {
  const { user, logout } = useAuth();
  const {
    selectedClinic,
    selectedDashboardScope,
    availableClinics,
    canSwitchClinics,
    canSelectAllClinics,
    isLoadingClinics,
    clinicError,
    hasClinicProvider,
    setDashboardScope,
  } = useSelectedClinic();
  const navigate = useNavigate();
  const scopeLabel =
    selectedDashboardScope?.type === "all_clinics"
      ? "All Clinics"
      : selectedClinic?.name;
  const selectorValue =
    selectedDashboardScope?.type === "all_clinics"
      ? ALL_CLINICS_DASHBOARD_SCOPE
      : selectedClinic?.id ?? "";

  async function handleLogout(): Promise<void> {
    await logout();
    await navigate("/login");
  }

  const navGroups: NavGroup[] = user
    ? [
        {
          label: "Daily",
          items: [{ to: "/", label: "Daily Hub", end: true }],
        },
        {
          label: "Operations",
          items: [
            { to: "/inventory", label: "Inventory" },
            ...(canViewMaterialsForecast(user.role)
              ? [{ to: "/forecast/materials", label: "Materials Forecast" }]
              : []),
            ...(canViewLaborForecast(user.role)
              ? [{ to: "/forecast/labor", label: "Labor Forecast" }]
              : []),
          ],
        },
        {
          label: "Procurement",
          items: [
            ...(canManageSuppliers(user.role) ? [{ to: "/suppliers", label: "Suppliers" }] : []),
            ...(canManageSuppliers(user.role)
              ? [{ to: "/supplier-intelligence", label: "Supplier Intelligence" }]
              : []),
            ...(canManageUsers(user.role)
              ? [{ to: "/purchase-orders", label: "Purchase Orders" }]
              : []),
          ],
        },
        {
          label: "People",
          items: [
            { to: "/roster", label: "Roster" },
            { to: "/my-shifts", label: "My Shifts" },
            { to: "/timesheets", label: "Timesheets" },
            { to: "/leave", label: "Leave" },
          ],
        },
        {
          label: "Reporting",
          items: [
            ...(canViewAnalytics(user.role) ? [{ to: "/analytics", label: "Analytics" }] : []),
            ...(canViewAnalytics(user.role)
              ? [{ to: "/analytics/audit", label: "Audit Events" }]
              : []),
            ...(canManageBilling(user.role) ? [{ to: "/billing", label: "Billing" }] : []),
          ],
        },
        {
          label: "Admin / Settings",
          items: [
            ...(canManageClinics(user.role) ? [{ to: "/settings/clinics", label: "Clinics" }] : []),
            ...(canManageUsers(user.role) ? [{ to: "/users", label: "Users" }] : []),
            ...(canViewClinicSettings(user.role)
              ? [{ to: "/settings/clinic", label: "Clinic Settings" }]
              : []),
          ],
        },
      ].filter((group) => group.items.length > 0)
    : [];

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__brand">
          <p className="app-shell__eyebrow">Verve Dental</p>
          <h1>Operational Suite</h1>
          {hasClinicProvider && selectedClinic ? (
            <p className="app-shell__scope">
              Current scope: <strong>{scopeLabel}</strong>
            </p>
          ) : null}
        </div>

        <div className="app-shell__tools">
          {hasClinicProvider && selectedClinic ? (
            <div className="app-shell__clinic-control">
              <label className="app-shell__clinic-label" htmlFor="clinic-scope">
                Clinic scope
              </label>
              {canSwitchClinics ? (
                <select
                  id="clinic-scope"
                  className="app-shell__clinic-select"
                  value={selectorValue}
                  onChange={(event) => {
                    if (event.target.value === ALL_CLINICS_DASHBOARD_SCOPE) {
                      setDashboardScope({ type: "all_clinics" });
                      return;
                    }
                    setDashboardScope({ type: "clinic", clinicId: event.target.value });
                  }}
                  disabled={isLoadingClinics}
                >
                  {canSelectAllClinics ? (
                    <option value={ALL_CLINICS_DASHBOARD_SCOPE}>All Clinics</option>
                  ) : null}
                  {availableClinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="app-shell__clinic-fixed">{selectedClinic.name}</span>
              )}
              {clinicError ? <span className="app-shell__clinic-error">{clinicError}</span> : null}
            </div>
          ) : null}

          {user ? (
            <div className="app-shell__user">
              <NavLink to="/account" className="app-shell__user-link">
                {user.email}
              </NavLink>
              <NavLink to="/settings/security" className="app-shell__user-link">
                Security
              </NavLink>
              <button
                type="button"
                className="app-shell__logout"
                onClick={() => { void handleLogout(); }}
              >
                Log out
              </button>
            </div>
          ) : null}
        </div>

        <nav className="app-shell__nav" aria-label="Main navigation">
          {navGroups.map((group) => (
            <section key={group.label} className="app-shell__nav-group">
              <p className="app-shell__nav-heading">{group.label}</p>
              <div className="app-shell__nav-links">
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </section>
          ))}
        </nav>
      </header>
      <main className="app-shell__main">{children}</main>
    </div>
  );
}
