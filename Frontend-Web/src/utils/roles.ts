import type { UserRole } from "../types/index.js";

export function canManageProducts(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}
