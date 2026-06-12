import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/useAuth.js";
import { canManageUsers } from "../../utils/roles.js";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate("/login");
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
          {user && canManageUsers(user.role) ? (
            <>
              <NavLink to="/users">Users</NavLink>
              <NavLink to="/purchase-orders">Purchase Orders</NavLink>
            </>
          ) : null}
        </nav>

        <div className="app-shell__user">
          {user ? (
            <>
              <NavLink to="/account" className="app-shell__user-link">
                {user.email}
              </NavLink>
              <button
                type="button"
                className="app-shell__logout"
                onClick={() => void handleLogout()}
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
