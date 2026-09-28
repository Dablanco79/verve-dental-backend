import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./useAuth.js";

type PermissionRouteProps = {
  /** The module:* permission string required to access the wrapped routes. */
  permission: string;
  /** Where to redirect when permission is absent. Defaults to "/". */
  redirectTo?: string;
};

/**
 * Route guard that checks for a specific permission in the user's token.
 * Redirects to `redirectTo` (default: "/") when the permission is absent.
 * Must be used as a React Router element (renders <Outlet /> on pass).
 *
 * Usage:
 *   <Route element={<PermissionRoute permission="module:timesheets" />}>
 *     <Route path="/timesheets" element={<TimesheetsPage />} />
 *   </Route>
 */
export function PermissionRoute({ permission, redirectTo = "/" }: PermissionRouteProps) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.permissions.includes(permission)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}
