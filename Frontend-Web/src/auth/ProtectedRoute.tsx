import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "./useAuth.js";

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <p className="loading-message">Loading session…</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
