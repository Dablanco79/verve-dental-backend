import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth.js";
import {
  canManageBilling,
  canManageUsers,
  canViewAnalytics,
  canViewClinicSettings,
  canViewLaborForecast,
} from "../../utils/roles.js";


type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    await navigate("/login");
  }

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__brand">
          <p className="app-shell__eyebrow">Verve Dental</p>
          <h1>Operational Suite</h1>
        </div>

        <nav className="app-shell__nav" aria-label="Main navigation">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/inventory">Inventory</NavLink>
          <NavLink to="/roster">Roster</NavLink>
          <NavLink to="/my-shifts">My Shifts</NavLink>
          <NavLink to="/timesheets">Timesheets</NavLink>
          <NavLink to="/leave">Leave</NavLink>
          {user && canManageUsers(user.role) ? (
            <>
              <NavLink to="/users">Users</NavLink>
              <NavLink to="/purchase-orders">Purchase Orders</NavLink>
            </>
          ) : null}
          {user && canViewLaborForecast(user.role) ? (
            <NavLink to="/forecast/labor">Labor Forecast</NavLink>
          ) : null}
          {user && canManageBilling(user.role) ? (
            <NavLink to="/billing">Billing</NavLink>
          ) : null}
          {user && canViewAnalytics(user.role) ? (
            <NavLink to="/analytics">Analytics</NavLink>
          ) : null}
          {user && canViewClinicSettings(user.role) ? (
            <NavLink to="/settings/clinic">Clinic Settings</NavLink>
          ) : null}
        </nav>

        <div className="app-shell__user">
          {user ? (
            <>
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
            </>
          ) : null}
        </div>
      </header>
      <main className="app-shell__main">{children}</main>
    </div>
  );
}
