import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "./useAuth.js";

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <p className="loading-message">Loading session…</p>;
  }

  if (!user) {
    const sessionExpired = window.sessionStorage.getItem("verve.sessionExpired") === "1";
    if (sessionExpired) {
      window.sessionStorage.removeItem("verve.sessionExpired");
    }
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location.pathname + location.search,
          message: sessionExpired ? "Your session expired. Please log in again." : undefined,
        }}
      />
    );
  }

  return <Outlet />;
}
