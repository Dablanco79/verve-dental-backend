import type { UserRole } from "../types/index.js";

export function canManageProducts(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

export function canManageUsers(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

export function canManageRoster(role: UserRole): boolean {
  return role === "owner_admin" || role === "group_practice_manager";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  owner_admin: "Owner / Admin",
  group_practice_manager: "Practice Manager",
  clinical_staff: "Clinical Staff",
};
