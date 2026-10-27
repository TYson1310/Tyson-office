import { collapseUserRole } from "@/lib/auth/shared";
import { canAccessPath } from "@/lib/auth/route-access";
import type { UserRole } from "@/types/erp.types";
import { createStoreHref } from "@/lib/store-query";

const ROLE_HOME_CANDIDATES: Record<
  ReturnType<typeof collapseUserRole>,
  string[]
> = {
  admin: ["/admin/store-selection", "/admin/dashboard"],
  manager: [
    "/admin/dashboard",
    "/admin/staff",
    "/admin/shift-management",
    "/admin/reports",
    "/vendors/directory",
    "/inventory",
    "/admin/expenses",
    "/admin/bank-deposits",
    "/admin/approvals",
    "/daily-closeout",
    "/lottery",
    "/scratch-cards/delivery-scan",
    "/scratch-cards/audit",
    "/lottery/reconciliation",
    "/lottery/eft",
    "/lottery/reports",
    "/payroll",
    "/employee/profile",
    "/employee/payroll",
    "/shifts",
  ],
  employee: [
    "/employee/payroll",
    "/shifts",
    "/daily-closeout",
    "/lottery",
    "/scratch-cards/delivery-scan",
    "/scratch-cards/audit",
    "/lottery/reconciliation",
    "/lottery/eft",
    "/lottery/reports",
    "/employee/profile",
  ],
};

export function getPostLoginRedirectPath(
  role: UserRole,
  storeKey?: string,
  permissions?: string[] | null,
) {
  const supportedRole = collapseUserRole(role);
  const candidatePath =
    ROLE_HOME_CANDIDATES[supportedRole].find((pathname) =>
      canAccessPath(pathname, role, permissions),
    ) ?? "/unauthorized";

  if (candidatePath === "/admin/store-selection") {
    return candidatePath;
  }

  return createStoreHref(candidatePath, storeKey);
}
