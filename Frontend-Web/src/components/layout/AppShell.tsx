import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../../auth/useAuth.js";
import { canManageUsers } from "../../utils/roles.js";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { user } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <p className="app-shell__eyebrow">Verve Dental</p>
        <h1>Operational Suite</h1>
        <nav className="app-shell__nav" aria-label="Main navigation">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/inventory">Inventory</NavLink>
          {user && canManageUsers(user.role) ? (
            <NavLink to="/users">Users</NavLink>
          ) : null}
        </nav>
      </header>
      <main className="app-shell__main">{children}</main>
    </div>
  );
}
