import type {
  AuthSession,
  AuthUser,
  SupportedUserRole,
  UserRole,
} from "@/types/erp.types";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";

export type ProfileRecord = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole | null;
  store_key: string | null;
  status: AuthUser["status"] | null;
  permissions: string[] | null;
  avatar_url: string | null;
  department: string | null;
  position_title: string | null;
  manager_name: string | null;
  employee_number: string | null;
  pay_frequency: string | null;
  bank_name: string | null;
  bank_account_last4: string | null;
};

export const PROFILE_SELECT =
  "id,email,full_name,role,store_key,status,permissions,avatar_url,department,position_title,manager_name,employee_number,pay_frequency,bank_name,bank_account_last4";

const VALID_ROLES: UserRole[] = [
  "admin",
  "manager",
  "employee",
  "cashier",
  "warehouse",
  "accountant",
];

export function collapseUserRole(
  role: UserRole | string | null | undefined,
): SupportedUserRole {
  if (role === "admin") {
    return "admin";
  }

  if (role === "manager" || role === "accountant") {
    return "manager";
  }

  return "employee";
}

export function getDefaultPermissions(role: UserRole) {
  const supportedRole = collapseUserRole(role);

  if (supportedRole === "admin") {
    return ["*"];
  }

  if (supportedRole === "manager") {
    return [
      "view:dashboard",
      "view:staff",
      "view:shifts",
      "view:vendors",
      "view:inventory",
      "view:payroll",
      "view:reports",
      "view:profile",
      "view:schedule",
      "view:sales",
      "create:sales",
      "view:lottery",
      "view:scratch_delivery",
      "view:scratch_cards",
      "view:lottery_reconciliation",
      "view:lottery_eft",
      "view:lottery_reports",
      "view:expenses",
      "view:bank_deposits",
      "view:approvals",
      "view:products",
      "manage:payroll_adjustments",
    ];
  }

  return [
    "view:profile",
    "view:schedule",
    "view:payroll",
    "view:performance",
    "view:sales",
    "create:sales",
    "view:lottery",
    "view:scratch_delivery",
    "view:scratch_cards",
    "view:lottery_reconciliation",
    "view:lottery_eft",
    "view:lottery_reports",
  ];
}

function normalizeRole(role: unknown): UserRole {
  if (typeof role === "string" && VALID_ROLES.includes(role as UserRole)) {
    return collapseUserRole(role as UserRole);
  }

  return "employee";
}

function normalizeStatus(status: unknown): AuthUser["status"] {
  if (status === "inactive" || status === "on-leave") {
    return status;
  }

  return "active";
}

export function mapSupabaseUserToAuthUser(
  user: SupabaseUser,
  profile?: ProfileRecord | null,
): AuthUser {
  const role = normalizeRole(profile?.role ?? user.user_metadata.role);
  const permissions = profile?.permissions ?? getDefaultPermissions(role);
  const fallbackName =
    user.user_metadata.full_name ??
    user.user_metadata.name ??
    user.email?.split("@")[0] ??
    "User";

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? "",
    name: profile?.full_name ?? fallbackName,
    role,
    storeKey: profile?.store_key ?? undefined,
    avatar: profile?.avatar_url ?? user.user_metadata.avatar_url ?? undefined,
    status: normalizeStatus(profile?.status ?? user.user_metadata.status),
    permissions,
    departmentId: profile?.department ?? undefined,
    createdAt: new Date(user.created_at ?? Date.now()),
    updatedAt: new Date(user.updated_at ?? user.created_at ?? Date.now()),
  };
}

export function mapSupabaseSessionToAuthSession(
  session: Session,
  profile?: ProfileRecord | null,
): AuthSession {
  return {
    user: {
      ...mapSupabaseUserToAuthUser(session.user, profile),
      token: session.access_token,
      tokenExpiry: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    },
    token: session.access_token,
    expiresAt: new Date((session.expires_at ?? 0) * 1000),
    isAuthenticated: true,
  };
}
