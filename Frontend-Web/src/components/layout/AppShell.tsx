import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Boxes,
  Building,
  Building2,
  CalendarDays,
  CalendarOff,
  ClipboardList,
  Clock,
  Database,
  FileDown,
  LayoutDashboard,
  LineChart,
  Menu,
  Package,
  Receipt,
  RotateCcw,
  Settings2,
  Shield,
  ShoppingCart,
  Timer,
  TrendingDown,
  UserCog,
  Users,
  Wrench,
  X,
} from "lucide-react";

import { useAuth } from "../../auth/useAuth.js";
import { ALL_CLINICS_DASHBOARD_SCOPE } from "../../clinic/clinicContext.js";
import { useSelectedClinic } from "../../clinic/useSelectedClinic.js";
import { loadConfig } from "../../config/index.js";
import {
  canManageBilling,
  canManageClinics,
  canManageProcurement,
  canManageUsers,
  canViewAnalytics,
  canViewClinicSettings,
  canViewLaborForecast,
  canViewMaterialsForecast,
  canManageSuppliers,
  canManageProducts,
  canPerformStocktake,
} from "../../utils/roles.js";


type AppShellProps = {
  children: ReactNode;
};

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

export function AppShell({ children }: AppShellProps) {
  const { user, logout } = useAuth();
  const appConfig = loadConfig();
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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

  function closeNav(): void {
    setMobileNavOpen(false);
  }

  const navGroups: NavGroup[] = user
    ? [
        {
          label: "Daily",
          items: [{ to: "/", label: "Daily Hub", icon: LayoutDashboard, end: true }],
        },
        {
          label: "Operations",
          items: [
            { to: "/inventory", label: "Inventory", icon: Package },
            ...(canPerformStocktake()
              ? [{ to: "/inventory/stocktakes", label: "Stocktake", icon: ClipboardList }]
              : []),
            ...(canManageProducts(user.role)
              ? [{ to: "/inventory/products", label: "Products", icon: Boxes }]
              : []),
            { to: "/inventory/master-products", label: "Master Products", icon: Database },
            ...(canManageProducts(user.role)
              ? [{ to: "/inventory/catalogue-import", label: "Catalogue Import", icon: FileDown }]
              : []),
            ...(canManageProducts(user.role)
              ? [
                  {
                    to: "/inventory/master-product-library-import",
                    label: "Master Product Library",
                    icon: BookOpen,
                  },
                ]
              : []),
            ...(canViewMaterialsForecast(user.role)
              ? [{ to: "/forecast/materials", label: "Materials Forecast", icon: TrendingDown }]
              : []),
            ...(canViewLaborForecast(user.role)
              ? [{ to: "/forecast/labor", label: "Labor Forecast", icon: Users }]
              : []),
          ],
        },
        {
          label: "Procurement",
          items: [
            ...(canManageSuppliers(user.role) ? [{ to: "/suppliers", label: "Suppliers & Invoices", icon: Building2 }] : []),
            ...(canManageSuppliers(user.role)
              ? [{ to: "/supplier-intelligence", label: "Supplier Intelligence", icon: LineChart }]
              : []),
            ...(canManageProcurement(user.role)
              ? [{ to: "/purchase-orders", label: "Purchase Orders", icon: ShoppingCart }]
              : []),
          ],
        },
        {
          label: "People",
          items: [
            { to: "/roster", label: "Roster", icon: CalendarDays },
            { to: "/my-shifts", label: "My Shifts", icon: Clock },
            { to: "/timesheets", label: "Timesheets", icon: Timer },
            { to: "/leave", label: "Leave", icon: CalendarOff },
          ],
        },
        {
          label: "Reporting",
          items: [
            ...(canViewAnalytics(user.role) ? [{ to: "/analytics", label: "Analytics", icon: BarChart3 }] : []),
            ...(canViewAnalytics(user.role)
              ? [{ to: "/analytics/audit", label: "Audit Events", icon: Shield }]
              : []),
            ...(canManageBilling(user.role) ? [{ to: "/billing", label: "Billing", icon: Receipt }] : []),
          ],
        },
        {
          label: "Admin / Settings",
          items: [
            ...(canManageUsers(user.role) ? [{ to: "/pilot-setup", label: "Pilot Setup", icon: Wrench }] : []),
            ...(canManageClinics(user.role)
              ? [{ to: "/settings/clinics", label: "Clinics", icon: Building }]
              : []),
            ...(canManageUsers(user.role) ? [{ to: "/users", label: "Users", icon: UserCog }] : []),
            ...(canViewClinicSettings(user.role)
              ? [{ to: "/settings/clinic", label: "Clinic Settings", icon: Settings2 }]
              : []),
            ...(appConfig.pilotResetEnabled && user.role === "owner_admin"
              ? [{ to: "/admin/pilot-reset", label: "Pilot Reset", icon: RotateCcw }]
              : []),
          ],
        },
      ].filter((group) => group.items.length > 0)
    : [];

  return (
    <div className={`app-shell${mobileNavOpen ? " app-shell--nav-open" : ""}`}>

      {/* Mobile navigation backdrop — closes drawer on outside tap */}
      {mobileNavOpen ? (
        <div
          className="app-shell__mobile-backdrop"
          onClick={closeNav}
          aria-hidden="true"
        />
      ) : null}

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
                {group.items.map((item) => {
                    const NavIcon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={closeNav}
                      >
                        <span className="app-shell__nav-icon" aria-hidden="true">
                          <NavIcon size={16} strokeWidth={1.75} />
                        </span>
                        <span>{item.label}</span>
                      </NavLink>
                    );
                  })}
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

          {/* Hamburger — visible on mobile only (hidden ≥641px via CSS) */}
          <button
            type="button"
            className="app-shell__mobile-menu-btn"
            onClick={() => { setMobileNavOpen((prev) => !prev); }}
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileNavOpen}
          >
            {mobileNavOpen ? <X size={20} strokeWidth={2} /> : <Menu size={20} strokeWidth={2} />}
          </button>

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

          <div className="app-shell__header-controls app-shell__header-controls--secondary">
            {user ? (
              <div className="app-shell__user">
                <NavLink to="/account" className="app-shell__profile">
                  <span className="app-shell__avatar" aria-hidden="true">{profileInitials}</span>
                  <span className="app-shell__profile-text">
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
