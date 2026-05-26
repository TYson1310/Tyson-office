import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupportedUserRole, UserRole } from "@/types/erp.types";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import { collapseUserRole } from "@/lib/auth/shared";
import { getDefaultPermissions } from "@/lib/auth/shared";
import { getServerStoreContext } from "@/lib/stores/server";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

type EmployeeStatus = "active" | "inactive" | "on-leave";

type EmployeeProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole | null;
  store_key: string | null;
  status: EmployeeStatus | null;
  permissions: string[] | null;
  department: string | null;
  position_title: string | null;
  manager_name: string | null;
  employee_number: string | null;
  pay_frequency: string | null;
  phone?: string | null;
  monthly_salary?: number | null;
  hourly_rate?: number | null;
  created_at: string;
  updated_at: string;
};

type EmployeeDirectoryRecord = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  storeKey: string;
  status: EmployeeStatus;
  joinDate: string;
  hourlyRate: number;
  phone: string;
  permissions: string[];
  department: string;
  position: string;
  managerName: string;
  employeeNumber: string;
  payFrequency: string;
  createdAt: string;
  updatedAt: string;
};

const PROFILE_SELECT_BASE =
  "id,email,full_name,role,store_key,status,permissions,department,position_title,manager_name,employee_number,pay_frequency,created_at,updated_at";
const PROFILE_SELECT_WITH_STAFF_FIELDS = `${PROFILE_SELECT_BASE},phone,monthly_salary,hourly_rate`;
const STAFF_ASSIGNABLE_PERMISSIONS = new Set([
  "view:dashboard",
  "view:staff",
  "view:shifts",
  "view:inventory",
  "view:vendors",
  "view:expenses",
  "view:bank_deposits",
  "view:approvals",
  "view:products",
  "view:reports",
  "view:managed_payroll",
  "view:sales",
  "create:sales",
  "view:lottery",
  "view:scratch_delivery",
  "view:scratch_cards",
  "view:lottery_reconciliation",
  "view:lottery_eft",
  "view:lottery_reports",
  "view:profile",
  "view:schedule",
  "view:payroll",
  "view:performance",
  "view:orders",
  "view:suppliers",
  "view:financials",
  "update:inventory",
  "manage:payroll_adjustments",
]);

type PermissionResolutionOptions = {
  actorRole: SupportedUserRole;
  actorPermissions: string[] | null | undefined;
};

function isMissingStaffFieldsError(
  error: { message?: string | null } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    message.includes("profiles.phone") ||
    message.includes("profiles.monthly_salary") ||
    message.includes("profiles.hourly_rate") ||
    message.includes("'phone' column of 'profiles'") ||
    message.includes("'monthly_salary' column of 'profiles'") ||
    message.includes("'hourly_rate' column of 'profiles'")
  );
}

function buildLegacySafeProfilePayload(
  body: Record<string, unknown>,
  role: UserRole,
  status: EmployeeStatus,
  storeKey: string,
  fallbackPermissions?: string[] | null,
  permissionOptions?: PermissionResolutionOptions,
) {
  const payload = buildProfilePayload(
    body,
    role,
    status,
    storeKey,
    fallbackPermissions,
    permissionOptions,
  ) as Record<string, unknown>;

  delete payload.phone;
  delete payload.monthly_salary;
  delete payload.hourly_rate;

  return payload;
}

async function selectProfilesWithFallback<T>(
  execute: (select: string) => Promise<{
    data: T | null;
    error: { message?: string; code?: string } | null;
  }>,
) {
  const primaryResult = await execute(PROFILE_SELECT_WITH_STAFF_FIELDS);

  if (!primaryResult.error || !isMissingStaffFieldsError(primaryResult.error)) {
    return primaryResult;
  }

  return execute(PROFILE_SELECT_BASE);
}

function normalizeRole(role: unknown): SupportedUserRole {
  if (typeof role === "string") {
    return collapseUserRole(role as UserRole);
  }

  return "employee";
}

function normalizeStatus(status: unknown): EmployeeStatus {
  if (status === "inactive" || status === "on-leave") {
    return status;
  }

  if (status === "suspended") {
    return "inactive";
  }

  return "active";
}

function mapProfileRowToDirectoryRecord(
  row: EmployeeProfileRow,
): EmployeeDirectoryRecord {
  return {
    id: row.id,
    name: (row.full_name ?? row.email ?? "Employee").trim(),
    email: row.email ?? "",
    role: collapseUserRole(row.role ?? "employee"),
    storeKey: row.store_key ?? "default",
    status: row.status ?? "active",
    joinDate: row.created_at.slice(0, 10),
    hourlyRate: Number(row.hourly_rate ?? 0),
    phone: row.phone ?? "",
    permissions: row.permissions ?? [],
    department: row.department ?? "",
    position: row.position_title ?? "",
    managerName: row.manager_name ?? "",
    employeeNumber: row.employee_number ?? "",
    payFrequency: row.pay_frequency ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateTemporaryPassword() {
  return `${randomBytes(9).toString("base64url")}Aa1!`;
}

function buildFullName(body: Record<string, unknown>) {
  const fallbackName = [body.firstName, body.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return String(body.fullName ?? fallbackName ?? "").trim();
}

function resolvePermissions(
  body: Record<string, unknown>,
  role: UserRole,
  fallbackPermissions?: string[] | null,
  options?: PermissionResolutionOptions,
) {
  const requestedPermissions = Array.isArray(body.permissions)
    ? body.permissions.filter(
        (permission): permission is string =>
          typeof permission === "string" && permission.trim().length > 0,
      )
    : [];
  const basePermissions =
    requestedPermissions.length > 0
      ? requestedPermissions
      : (fallbackPermissions ?? getDefaultPermissions(role));

  if (role === "admin") {
    return options?.actorRole === "admin" ? getDefaultPermissions("admin") : [];
  }

  const uniquePermissions = Array.from(
    new Set(basePermissions.map((permission) => permission.trim())),
  ).filter((permission) => STAFF_ASSIGNABLE_PERMISSIONS.has(permission));

  if (!options || options.actorRole === "admin") {
    return uniquePermissions;
  }

  const actorPermissions =
    options.actorPermissions ?? getDefaultPermissions(options.actorRole);

  if (actorPermissions.includes("*")) {
    return uniquePermissions;
  }

  const actorPermissionSet = new Set(actorPermissions);
  return uniquePermissions.filter((permission) =>
    actorPermissionSet.has(permission),
  );
}

function buildProfilePayload(
  body: Record<string, unknown>,
  role: UserRole,
  status: EmployeeStatus,
  storeKey: string,
  fallbackPermissions?: string[] | null,
  permissionOptions?: PermissionResolutionOptions,
) {
  const legacySalary =
    typeof body.salary === "number"
      ? body.salary
      : typeof body.salary === "string" && body.salary.trim().length > 0
        ? Number(body.salary)
        : undefined;
  const hourlyRate =
    typeof body.hourlyRate === "number"
      ? body.hourlyRate
      : typeof body.hourlyRate === "string" && body.hourlyRate.trim().length > 0
        ? Number(body.hourlyRate)
        : undefined;

  return {
    email: typeof body.email === "string" ? body.email : undefined,
    full_name: buildFullName(body) || null,
    role,
    store_key: storeKey,
    status,
    permissions: resolvePermissions(
      body,
      role,
      fallbackPermissions,
      permissionOptions,
    ),
    department:
      typeof body.department === "string" && body.department.trim().length > 0
        ? body.department.trim()
        : null,
    position_title:
      typeof body.position === "string" && body.position.trim().length > 0
        ? body.position.trim()
        : null,
    manager_name:
      typeof body.managerName === "string" && body.managerName.trim().length > 0
        ? body.managerName.trim()
        : null,
    employee_number:
      typeof body.employeeNumber === "string" &&
      body.employeeNumber.trim().length > 0
        ? body.employeeNumber.trim()
        : null,
    pay_frequency:
      typeof body.payFrequency === "string" &&
      body.payFrequency.trim().length > 0
        ? body.payFrequency.trim()
        : null,
    phone:
      typeof body.phone === "string" && body.phone.trim().length > 0
        ? body.phone.trim()
        : null,
    monthly_salary: legacySalary,
    hourly_rate: hourlyRate ?? 0,
  };
}

function buildAuthBanDuration(status: EmployeeStatus) {
  return status === "inactive" ? "876000h" : "none";
}

async function requireStaffManagerAccess() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await getUserSafely(supabase);

  if (userError || !user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,full_name,permissions")
    .eq("id", user.id)
    .single<{
      role: UserRole | null;
      full_name: string | null;
      permissions: string[] | null;
    }>();

  if (profileError) {
    return {
      error: NextResponse.json(
        { error: profileError.message ?? "Failed to load current user" },
        { status: 500 },
      ),
    };
  }

  const role = collapseUserRole(profile?.role ?? "employee");

  if (!canAccessPath("/admin/staff", profile?.role, profile?.permissions)) {
    return {
      error: NextResponse.json(
        { error: "Forbidden: admin or manager access required" },
        { status: 403 },
      ),
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { error: "Select a store before managing staff" },
        { status: 400 },
      ),
    };
  }

  return {
    supabase,
    currentUser: user,
    currentUserRole: role,
    currentUserPermissions:
      profile?.permissions ?? getDefaultPermissions(profile?.role ?? role),
    currentUserName: profile?.full_name ?? user.email ?? "User",
    activeStoreKey: storeContext.activeStoreKey,
  };
}

async function getTargetProfile(
  id: string,
  adminClient: ReturnType<typeof createAdminClient>,
) {
  const { data, error } = await selectProfilesWithFallback<EmployeeProfileRow>(
    async (select) =>
      adminClient
        .from("profiles")
        .select(select)
        .eq("id", id)
        .returns<EmployeeProfileRow[]>()
        .single(),
  );

  if (error || !data) {
    return {
      error: NextResponse.json(
        { error: error?.message ?? "Employee not found" },
        { status: error?.code === "PGRST116" ? 404 : 500 },
      ),
    };
  }

  return { data };
}

function getConfigurationError() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase configuration required" },
      { status: 503 },
    );
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is required for staff login provisioning",
      },
      { status: 503 },
    );
  }

  return null;
}

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Supabase configuration required" },
        { status: 503 },
      );
    }

    const access = await requireStaffManagerAccess();

    if (access.error) {
      return access.error;
    }

    const { supabase, activeStoreKey } = access;
    const { data, error } = await selectProfilesWithFallback<
      EmployeeProfileRow[]
    >(async (select) =>
      supabase
        .from("profiles")
        .select(select)
        .neq("role", "admin")
        .eq("store_key", activeStoreKey)
        .order("full_name", { ascending: true })
        .returns<EmployeeProfileRow[]>(),
    );

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to fetch employees" },
        { status: 500 },
      );
    }

    return NextResponse.json((data ?? []).map(mapProfileRowToDirectoryRecord));
  } catch (error) {
    console.error("Employees GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch employees" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const configurationError = getConfigurationError();

    if (configurationError) {
      return configurationError;
    }

    const access = await requireStaffManagerAccess();

    if (access.error) {
      return access.error;
    }

    const { currentUserRole, activeStoreKey } = access;
    const permissionOptions = {
      actorRole: currentUserRole,
      actorPermissions: access.currentUserPermissions,
    } satisfies PermissionResolutionOptions;
    const body = (await request.json()) as Record<string, unknown>;
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const fullName = buildFullName(body);
    const requestedPassword =
      typeof body.password === "string" ? body.password.trim() : "";

    if (!email || !fullName) {
      return NextResponse.json(
        { error: "Missing required fields: fullName and email" },
        { status: 400 },
      );
    }

    const role = normalizeRole(body.role);
    const status = normalizeStatus(body.status);

    if (role === "admin" && currentUserRole !== "admin") {
      return NextResponse.json(
        { error: "Only admins can create admin accounts" },
        { status: 403 },
      );
    }

    if (requestedPassword && currentUserRole !== "admin") {
      return NextResponse.json(
        { error: "Only admins can set a custom password when creating staff" },
        { status: 403 },
      );
    }

    if (requestedPassword && requestedPassword.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 },
      );
    }

    const adminClient = createAdminClient();
    const password = requestedPassword || generateTemporaryPassword();
    const permissions = resolvePermissions(
      body,
      role,
      undefined,
      permissionOptions,
    );
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          role,
          store_key: activeStoreKey,
          permissions,
          department:
            typeof body.department === "string"
              ? body.department.trim()
              : undefined,
          position_title:
            typeof body.position === "string"
              ? body.position.trim()
              : undefined,
        },
      });

    if (authError || !authData.user) {
      const statusCode =
        authError?.message?.toLowerCase().includes("already been registered") ||
        authError?.message?.toLowerCase().includes("already registered")
          ? 409
          : 500;

      return NextResponse.json(
        { error: authError?.message ?? "Failed to create staff login" },
        { status: statusCode },
      );
    }

    let { data, error } = await adminClient
      .from("profiles")
      .update(
        buildProfilePayload(
          { ...body, email, fullName },
          role,
          status,
          activeStoreKey,
          undefined,
          permissionOptions,
        ),
      )
      .eq("id", authData.user.id)
      .select(PROFILE_SELECT_WITH_STAFF_FIELDS)
      .returns<EmployeeProfileRow[]>()
      .single();

    if (error && isMissingStaffFieldsError(error)) {
      ({ data, error } = await adminClient
        .from("profiles")
        .update(
          buildLegacySafeProfilePayload(
            { ...body, email, fullName },
            role,
            status,
            activeStoreKey,
            undefined,
            permissionOptions,
          ),
        )
        .eq("id", authData.user.id)
        .select(PROFILE_SELECT_BASE)
        .returns<EmployeeProfileRow[]>()
        .single());
    }

    if (error || !data) {
      await adminClient.auth.admin.deleteUser(authData.user.id);

      return NextResponse.json(
        { error: error?.message ?? "Failed to create employee profile" },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: activeStoreKey,
      entityType: "employee",
      entityId: data.id,
      action: "employee.created",
      summary: `Staff account created: ${data.full_name ?? data.email ?? data.id}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole,
      metadata: {
        employeeEmail: data.email,
        employeeRole: data.role,
        employeeStatus: data.status,
        department: data.department,
        positionTitle: data.position_title,
      },
    });

    return NextResponse.json(
      {
        employee: mapProfileRowToDirectoryRecord(data),
        temporaryPassword: requestedPassword ? null : password,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Employees POST error:", error);
    return NextResponse.json(
      { error: "Failed to create employee" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const configurationError = getConfigurationError();

    if (configurationError) {
      return configurationError;
    }

    const access = await requireStaffManagerAccess();

    if (access.error) {
      return access.error;
    }

    const { currentUserRole, activeStoreKey } = access;
    const permissionOptions = {
      actorRole: currentUserRole,
      actorPermissions: access.currentUserPermissions,
    } satisfies PermissionResolutionOptions;
    const body = (await request.json()) as Record<string, unknown>;
    const id =
      typeof body.id === "string"
        ? body.id
        : typeof body.userId === "string"
          ? body.userId
          : "";

    if (!id) {
      return NextResponse.json(
        { error: "Missing required field: id" },
        { status: 400 },
      );
    }

    const adminClient = createAdminClient();
    const targetResult = await getTargetProfile(id, adminClient);

    if (targetResult.error) {
      return targetResult.error;
    }

    const targetProfile = targetResult.data;

    if ((targetProfile.store_key ?? "default") !== activeStoreKey) {
      return NextResponse.json(
        { error: "Employee not found in the active store" },
        { status: 404 },
      );
    }

    if (targetProfile.role === "admin") {
      return NextResponse.json(
        { error: "Admin accounts cannot be managed from this endpoint" },
        { status: 403 },
      );
    }

    const role = normalizeRole(body.role ?? targetProfile.role);
    const status = normalizeStatus(body.status ?? targetProfile.status);

    if (role === "admin" && currentUserRole !== "admin") {
      return NextResponse.json(
        { error: "Only admins can assign the admin role" },
        { status: 403 },
      );
    }

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : (targetProfile.email ?? "");
    const fullName = buildFullName(body) || targetProfile.full_name || "";
    const permissions = resolvePermissions(
      body,
      role,
      targetProfile.permissions,
      permissionOptions,
    );

    const { error: authError } = await adminClient.auth.admin.updateUserById(
      id,
      {
        email,
        ban_duration: buildAuthBanDuration(status),
        user_metadata: {
          full_name: fullName,
          role,
          store_key: activeStoreKey,
          permissions,
          department:
            typeof body.department === "string"
              ? body.department.trim()
              : (targetProfile.department ?? undefined),
          position_title:
            typeof body.position === "string"
              ? body.position.trim()
              : (targetProfile.position_title ?? undefined),
        },
      },
    );

    if (authError) {
      return NextResponse.json(
        { error: authError.message ?? "Failed to update staff login" },
        { status: 500 },
      );
    }

    let { data, error } = await adminClient
      .from("profiles")
      .update(
        buildProfilePayload(
          { ...body, email, fullName },
          role,
          status,
          activeStoreKey,
          targetProfile.permissions,
          permissionOptions,
        ),
      )
      .eq("id", id)
      .select(PROFILE_SELECT_WITH_STAFF_FIELDS)
      .returns<EmployeeProfileRow[]>()
      .single();

    if (error && isMissingStaffFieldsError(error)) {
      ({ data, error } = await adminClient
        .from("profiles")
        .update(
          buildLegacySafeProfilePayload(
            { ...body, email, fullName },
            role,
            status,
            activeStoreKey,
            targetProfile.permissions,
            permissionOptions,
          ),
        )
        .eq("id", id)
        .select(PROFILE_SELECT_BASE)
        .returns<EmployeeProfileRow[]>()
        .single());
    }

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to update employee profile" },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: activeStoreKey,
      entityType: "employee",
      entityId: data.id,
      action: "employee.updated",
      summary: `Staff account updated: ${data.full_name ?? data.email ?? data.id}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole,
      metadata: {
        employeeEmail: data.email,
        previousRole: targetProfile.role,
        nextRole: data.role,
        previousStatus: targetProfile.status,
        nextStatus: data.status,
        department: data.department,
        positionTitle: data.position_title,
      },
    });

    return NextResponse.json(mapProfileRowToDirectoryRecord(data));
  } catch (error) {
    console.error("Employees PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update employee" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const configurationError = getConfigurationError();

    if (configurationError) {
      return configurationError;
    }

    const access = await requireStaffManagerAccess();

    if (access.error) {
      return access.error;
    }

    const id = request.nextUrl.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const targetResult = await getTargetProfile(id, adminClient);

    if (targetResult.error) {
      return targetResult.error;
    }

    if (targetResult.data.role === "admin") {
      return NextResponse.json(
        { error: "Admin accounts cannot be deleted from this endpoint" },
        { status: 403 },
      );
    }

    if ((targetResult.data.store_key ?? "default") !== access.activeStoreKey) {
      return NextResponse.json(
        { error: "Employee not found in the active store" },
        { status: 404 },
      );
    }

    const { error: authError } = await adminClient.auth.admin.updateUserById(
      id,
      {
        ban_duration: buildAuthBanDuration("inactive"),
      },
    );

    if (authError) {
      return NextResponse.json(
        { error: authError.message ?? "Failed to revoke employee login" },
        { status: 500 },
      );
    }

    const { data: updatedProfile, error: profileError } = await adminClient
      .from("profiles")
      .update({ status: "inactive" })
      .eq("id", id)
      .select(PROFILE_SELECT_BASE)
      .returns<EmployeeProfileRow[]>()
      .single();

    if (profileError || !updatedProfile) {
      return NextResponse.json(
        {
          error:
            profileError?.message ?? "Failed to deactivate employee profile",
        },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "employee",
      entityId: id,
      action: "employee.deactivated",
      summary: `Staff account deactivated: ${updatedProfile.full_name ?? updatedProfile.email ?? id}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole,
      metadata: {
        employeeEmail: updatedProfile.email,
        employeeRole: updatedProfile.role,
        previousStatus: targetResult.data.status ?? "active",
        nextStatus: updatedProfile.status ?? "inactive",
      },
    });

    return NextResponse.json({ success: true, status: updatedProfile.status });
  } catch (error) {
    console.error("Employees DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to deactivate employee" },
      { status: 500 },
    );
  }
}
