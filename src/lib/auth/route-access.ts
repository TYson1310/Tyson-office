import { collapseUserRole, getDefaultPermissions } from "./shared.ts";
import type { SupportedUserRole, UserRole } from "../../types/erp.types.ts";

export type RouteAccessRule = {
  prefix: string;
  roles: SupportedUserRole[];
  permissions?: string[];
};

export const ADMIN_SURFACE_ROLES: SupportedUserRole[] = ["admin", "manager"];

const ROUTE_ACCESS_RULES: RouteAccessRule[] = [
  { prefix: "/admin/login-tracking", roles: ["admin"] },
  { prefix: "/admin/settings", roles: ["admin"] },
  { prefix: "/admin/store-selection", roles: ["admin"] },
  { prefix: "/admin/store-health", roles: ["admin"] },
  { prefix: "/admin/audit-logs", roles: ["admin"] },
  { prefix: "/admin/owner-command-center", roles: ["admin"] },
  { prefix: "/admin/loss-prevention", roles: ["admin"] },
  { prefix: "/admin/sales-logs", roles: ["admin"] },
  {
    prefix: "/admin/dashboard",
    roles: ["admin", "manager"],
    permissions: ["view:dashboard"],
  },
  {
    prefix: "/admin/staff",
    roles: ["admin", "manager"],
    permissions: ["view:staff"],
  },
  {
    prefix: "/admin/shift-management",
    roles: ["admin", "manager"],
    permissions: ["view:shifts"],
  },
  {
    prefix: "/admin/reports",
    roles: ["admin", "manager"],
    permissions: ["view:reports"],
  },
  {
    prefix: "/vendors",
    roles: ["admin", "manager"],
    permissions: ["view:vendors"],
  },
  {
    prefix: "/payroll",
    roles: ["admin", "manager"],
    permissions: ["view:managed_payroll"],
  },
  {
    prefix: "/reports/payroll-analysis",
    roles: ["admin", "manager"],
    permissions: ["view:managed_payroll"],
  },
  {
    prefix: "/reports",
    roles: ["admin", "manager"],
    permissions: ["view:reports"],
  },
  {
    prefix: "/inventory",
    roles: ["admin", "manager"],
    permissions: ["view:inventory"],
  },
  {
    prefix: "/daily-closeout",
    roles: ["admin", "manager", "employee"],
    permissions: ["view:sales"],
  },
  {
    prefix: "/scratch-cards/delivery-scan",
    roles: ["admin", "manager", "employee"],
    permissions: ["view:scratch_delivery"],
  },
  {
    prefix: "/scratch-cards/audit",
    roles: ["admin", "manager", "employee"],
    permissions: ["view:scratch_cards"],
  },
  {
    prefix: "/scratch-cards",
    roles: ["admin", "manager", "employee"],
    permissions: ["view:scratch_cards"],
  },
  {
    prefix: "/lottery/reconciliation",
    roles: ["admin", "manager", "employee"],
    permissions: ["view:lottery_reconciliation"],
  },
  {
    prefix: "/lottery/cash-advances",
    roles: ["admin", "manager"],
    permissions: ["view:bank_deposits"],
  },
  {
    prefix: "/lottery/eft",
    roles: ["admin", "manager", "employee"],
    permissions: ["view:lottery_eft"],
  },
  {
    prefix: "/lottery/reports",
    roles: ["admin", "manager", "employee"],
    permissions: ["view:lottery_reports"],
  },
  {
    prefix: "/lottery",
    roles: ["admin", "manager", "employee"],
    permissions: ["view:lottery"],
  },
  {
    prefix: "/admin/expenses",
    roles: ["admin", "manager"],
    permissions: ["view:expenses"],
  },
  {
    prefix: "/admin/bank-deposits",
    roles: ["admin", "manager"],
    permissions: ["view:bank_deposits"],
  },
  { prefix: "/admin", roles: ["admin", "manager"] },
  {
    prefix: "/admin/approvals",
    roles: ["admin", "manager"],
    permissions: ["view:approvals"],
  },
  {
    prefix: "/employee/profile",
    roles: ["manager", "employee"],
    permissions: ["view:profile"],
  },
  {
    prefix: "/employee/payroll",
    roles: ["manager", "employee"],
    permissions: ["view:payroll"],
  },
  {
    prefix: "/shifts",
    roles: ["manager", "employee"],
    permissions: ["view:schedule"],
  },
];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getRouteAccessRule(pathname: string) {
  return ROUTE_ACCESS_RULES.reduce<RouteAccessRule | null>(
    (bestMatch, rule) => {
      if (!matchesPrefix(pathname, rule.prefix)) {
        return bestMatch;
      }

      if (!bestMatch || rule.prefix.length > bestMatch.prefix.length) {
        return rule;
      }

      return bestMatch;
    },
    null,
  );
}

export function canAccessAdminSurface(role: UserRole | null | undefined) {
  return Boolean(role && ADMIN_SURFACE_ROLES.includes(collapseUserRole(role)));
}

function hasMatchingPermission(
  permissions: string[] | null | undefined,
  requiredPermissions: string[] | undefined,
  allowedRoles: SupportedUserRole[],
  supportedRole: SupportedUserRole,
  permissionRole: UserRole,
) {
  if (!allowedRoles.includes(supportedRole)) {
    return false;
  }

  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true;
  }

  const effectivePermissions =
    permissions ?? getDefaultPermissions(permissionRole);

  if (effectivePermissions.includes("*")) {
    return true;
  }

  return requiredPermissions.some((permission) =>
    effectivePermissions.includes(permission),
  );
}

export function canAccessAdminSurfaceByPermissions(
  role: UserRole | null | undefined,
  permissions: string[] | null | undefined,
) {
  if (!role) {
    return false;
  }

  if (collapseUserRole(role) === "admin") {
    return true;
  }

  return ROUTE_ACCESS_RULES.some(
    (rule) =>
      rule.prefix !== "/admin" &&
      rule.prefix.startsWith("/admin/") &&
      canAccessPath(rule.prefix, role, permissions),
  );
}

export function canAccessPath(
  pathname: string,
  role: UserRole | null | undefined,
  permissions?: string[] | null,
) {
  const matchingRule = getRouteAccessRule(pathname);

  if (!matchingRule) {
    return false;
  }

  if (!role) {
    return false;
  }

  const supportedRole = collapseUserRole(role);

  return hasMatchingPermission(
    permissions,
    matchingRule.permissions,
    matchingRule.roles,
    supportedRole,
    role,
  );
}

export function canAccessAnyProtectedPath(
  role: UserRole | null | undefined,
  permissions?: string[] | null,
) {
  if (!role) {
    return false;
  }

  return ROUTE_ACCESS_RULES.some(
    (rule) =>
      rule.prefix !== "/admin" && canAccessPath(rule.prefix, role, permissions),
  );
}
