import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "./useAuth.js";
import type { UserRole } from "../types/index.js";

type RoleRouteProps = {
  /**
   * Roles permitted to access the child routes.
   * Any other role (including unauthenticated) is redirected.
   */
  allowedRoles: UserRole[];
  /** Redirect target when the role check fails. Defaults to "/". */
  redirectTo?: string;
};

/**
 * Route guard that enforces a role-based access check independently of any
 * module:* permission grants.  Use this when a set of pages must remain
 * exclusive to specific roles regardless of what explicit grants a user holds.
 *
 * Example — master product catalogue administration (manager/admin only):
 *   <Route element={<RoleRoute allowedRoles={["owner_admin", "group_practice_manager"]} />}>
 *     <Route path="/inventory/master-products" element={<MasterProductsPage />} />
 *   </Route>
 *
 * An unauthenticated visitor is redirected to "/login".
 * An authenticated user whose role is not in `allowedRoles` is redirected to
 * `redirectTo` (default "/").
 */
export function RoleRoute({ allowedRoles, redirectTo = "/" }: RoleRouteProps) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}
