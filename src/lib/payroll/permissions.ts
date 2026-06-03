import { collapseUserRole, getDefaultPermissions } from "@/lib/auth/shared";
import type { UserRole } from "@/types/erp.types";

export const MANAGE_PAYROLL_ADJUSTMENTS_PERMISSION =
  "manage:payroll_adjustments";

export function canManagePayrollAdjustments(
  role: UserRole | null | undefined,
  permissions: string[] | null | undefined,
) {
  if (!role) {
    return false;
  }

  const supportedRole = collapseUserRole(role);

  if (supportedRole === "admin") {
    return true;
  }

  const effectivePermissions = permissions ?? getDefaultPermissions(role);

  return (
    effectivePermissions.includes("*") ||
    effectivePermissions.includes(MANAGE_PAYROLL_ADJUSTMENTS_PERMISSION)
  );
}
