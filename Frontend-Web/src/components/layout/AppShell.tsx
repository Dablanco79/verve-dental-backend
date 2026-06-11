import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <p className="app-shell__eyebrow">Verve Dental</p>
        <h1>Operational Suite</h1>
      </header>
      <main className="app-shell__main">{children}</main>
    </div>
  );
}
