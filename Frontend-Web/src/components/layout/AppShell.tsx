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
  canManageProducts,
} from "../../utils/roles.js";


type AppShellProps = {
  children: ReactNode;
};

type NavItem = {
  to: string;
  label: string;
  icon: string;
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
  const profileInitials = user?.email.slice(0, 2).toUpperCase() ?? "VB";
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
          items: [{ to: "/", label: "Daily Hub", icon: "DH", end: true }],
        },
        {
          label: "Operations",
          items: [
            { to: "/inventory", label: "Inventory", icon: "IN" },
            ...(canManageProducts(user.role)
              ? [{ to: "/inventory/products", label: "Products", icon: "PR" }]
              : []),
            ...(canViewMaterialsForecast(user.role)
              ? [{ to: "/forecast/materials", label: "Materials Forecast", icon: "MF" }]
              : []),
            ...(canViewLaborForecast(user.role)
              ? [{ to: "/forecast/labor", label: "Labor Forecast", icon: "LF" }]
              : []),
          ],
        },
        {
          label: "Procurement",
          items: [
            ...(canManageSuppliers(user.role) ? [{ to: "/suppliers", label: "Suppliers", icon: "SU" }] : []),
            ...(canManageSuppliers(user.role)
              ? [{ to: "/supplier-intelligence", label: "Supplier Intelligence", icon: "SI" }]
              : []),
            ...(canManageUsers(user.role)
              ? [{ to: "/purchase-orders", label: "Purchase Orders", icon: "PO" }]
              : []),
          ],
        },
        {
          label: "People",
          items: [
            { to: "/roster", label: "Roster", icon: "RO" },
            { to: "/my-shifts", label: "My Shifts", icon: "MS" },
            { to: "/timesheets", label: "Timesheets", icon: "TS" },
            { to: "/leave", label: "Leave", icon: "LV" },
          ],
        },
        {
          label: "Reporting",
          items: [
            ...(canViewAnalytics(user.role) ? [{ to: "/analytics", label: "Analytics", icon: "AN" }] : []),
            ...(canViewAnalytics(user.role)
              ? [{ to: "/analytics/audit", label: "Audit Events", icon: "AU" }]
              : []),
            ...(canManageBilling(user.role) ? [{ to: "/billing", label: "Billing", icon: "BL" }] : []),
          ],
        },
        {
          label: "Admin / Settings",
          items: [
            ...(canManageUsers(user.role) ? [{ to: "/pilot-setup", label: "Pilot Setup", icon: "PS" }] : []),
            ...(canManageClinics(user.role)
              ? [{ to: "/settings/clinics", label: "Clinics", icon: "CL" }]
              : []),
            ...(canManageUsers(user.role) ? [{ to: "/users", label: "Users", icon: "US" }] : []),
            ...(canViewClinicSettings(user.role)
              ? [{ to: "/settings/clinic", label: "Clinic Settings", icon: "CS" }]
              : []),
          ],
        },
      ].filter((group) => group.items.length > 0)
    : [];

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <div className="app-shell__brand">
          <span className="app-shell__logo-mark" aria-hidden="true">V</span>
          <div>
            <h1>verve</h1>
            <p className="app-shell__eyebrow">Operational Suite</p>
          </div>
        </div>

        <nav className="app-shell__nav" aria-label="Main navigation">
          {navGroups.map((group) => (
            <section key={group.label} className="app-shell__nav-group">
              <p className="app-shell__nav-heading">{group.label}</p>
              <div className="app-shell__nav-links">
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end}>
                    <span className="app-shell__nav-icon" aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </section>
          ))}
        </nav>

        {hasClinicProvider && selectedClinic ? (
          <div className="app-shell__sidebar-scope">
            <span className="app-shell__sidebar-scope-label">Current Clinic</span>
            <strong>{scopeLabel}</strong>
            <span>Change clinic from the header</span>
          </div>
        ) : null}
      </aside>

      <div className="app-shell__workspace">
        <header className="app-shell__header">
          <div className="app-shell__header-controls app-shell__header-controls--primary">
            <div className="app-shell__selector app-shell__selector--static" aria-label="Organisation selector">
              <span className="app-shell__selector-icon" aria-hidden="true">OG</span>
              <span>
                <span className="app-shell__selector-value">Verve Dental Group</span>
                <span className="app-shell__selector-label">Organisation</span>
              </span>
            </div>

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
          </div>

          <div className="app-shell__search" role="search">
            <span aria-hidden="true">Search</span>
            <input type="search" placeholder="Search products, suppliers, staff..." aria-label="Global search" />
            <kbd>Ctrl + K</kbd>
          </div>

          <div className="app-shell__header-controls app-shell__header-controls--secondary">
            <button type="button" className="app-shell__date-range" aria-label="Date range">
              15 - 21 May 2026
            </button>
            <button type="button" className="app-shell__icon-button" aria-label="Notifications">
              <span aria-hidden="true">N</span>
              <span className="app-shell__notification-dot" />
            </button>
            <button type="button" className="app-shell__icon-button" aria-label="Help">
              <span aria-hidden="true">?</span>
            </button>
            {user ? (
              <div className="app-shell__user">
                <NavLink to="/account" className="app-shell__profile">
                  <span className="app-shell__avatar" aria-hidden="true">{profileInitials}</span>
                  <span>
                    <span className="app-shell__profile-name">{user.email}</span>
                    <span className="app-shell__profile-role">{user.role.replace(/_/g, " ")}</span>
                  </span>
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
        </header>

        <main className="app-shell__main">{children}</main>
      </div>
    </div>
  );
}
