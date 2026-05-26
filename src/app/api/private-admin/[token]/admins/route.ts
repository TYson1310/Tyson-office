import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDefaultPermissions } from "@/lib/auth/shared";
import {
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  appendPrivateAdminAuditEvent,
  requirePrivateAdminSession,
} from "@/lib/private-admin-portal";

type Params = Promise<{ token: string }>;
type AdminStatus = "active" | "inactive" | "on-leave";

type AdminProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "admin" | null;
  status: AdminStatus | null;
  permissions: string[] | null;
  created_at: string;
  updated_at: string;
};

type AdminRecord = {
  id: string;
  email: string;
  fullName: string;
  status: AdminStatus;
  createdAt: string;
  updatedAt: string;
  permissions: string[];
};

const ADMIN_PROFILE_SELECT =
  "id,email,full_name,role,status,permissions,created_at,updated_at";

function normalizeStatus(status: unknown): AdminStatus {
  if (status === "inactive" || status === "on-leave") {
    return status;
  }

  return "active";
}

function buildFullName(body: Record<string, unknown>) {
  const fullName =
    typeof body.fullName === "string"
      ? body.fullName
      : typeof body.name === "string"
        ? body.name
        : "";

  return fullName.trim();
}

function mapAdminProfile(row: AdminProfileRow): AdminRecord {
  return {
    id: row.id,
    email: row.email ?? "",
    fullName: row.full_name ?? row.email ?? "Admin",
    status: row.status ?? "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    permissions: row.permissions ?? getDefaultPermissions("admin"),
  };
}

function buildAdminProfilePayload(
  body: Record<string, unknown>,
  email: string,
) {
  return {
    email,
    full_name: buildFullName(body) || null,
    role: "admin" as const,
    status: normalizeStatus(body.status),
    permissions: getDefaultPermissions("admin"),
  };
}

function generateTemporaryPassword() {
  return `${randomBytes(9).toString("base64url")}Aa1!`;
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
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for admin provisioning" },
      { status: 503 },
    );
  }

  return null;
}

async function getAuthorizedAdminClient(token: string) {
  const configurationError = getConfigurationError();

  if (configurationError) {
    return { error: configurationError };
  }

  const access = await requirePrivateAdminSession(token);

  if (access.error) {
    return { error: access.error };
  }

  return { adminClient: createAdminClient() };
}

async function getAdminProfile(
  id: string,
  adminClient: ReturnType<typeof createAdminClient>,
) {
  const { data, error } = await adminClient
    .from("profiles")
    .select(ADMIN_PROFILE_SELECT)
    .eq("id", id)
    .eq("role", "admin")
    .returns<AdminProfileRow[]>()
    .single();

  if (error || !data) {
    return {
      error: NextResponse.json(
        { error: "Admin account not found" },
        { status: 404 },
      ),
    };
  }

  return { data };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const { token } = await params;
    const access = await getAuthorizedAdminClient(token);

    if (access.error) {
      return access.error;
    }

    const { data, error } = await access.adminClient
      .from("profiles")
      .select(ADMIN_PROFILE_SELECT)
      .eq("role", "admin")
      .order("created_at", { ascending: true })
      .returns<AdminProfileRow[]>();

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to fetch admins" },
        { status: 500 },
      );
    }

    return NextResponse.json((data ?? []).map(mapAdminProfile));
  } catch (error) {
    console.error("Private admin GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch admins" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const { token } = await params;
    const access = await getAuthorizedAdminClient(token);

    if (access.error) {
      return access.error;
    }

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

    const password = requestedPassword || generateTemporaryPassword();
    const permissions = getDefaultPermissions("admin");
    const { data: authData, error: authError } =
      await access.adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          role: "admin",
          permissions,
        },
      });

    if (authError || !authData.user) {
      const statusCode =
        authError?.message?.toLowerCase().includes("already been registered") ||
        authError?.message?.toLowerCase().includes("already registered")
          ? 409
          : 500;

      return NextResponse.json(
        { error: authError?.message ?? "Failed to create admin login" },
        { status: statusCode },
      );
    }

    const { data, error } = await access.adminClient
      .from("profiles")
      .update(buildAdminProfilePayload(body, email))
      .eq("id", authData.user.id)
      .select(ADMIN_PROFILE_SELECT)
      .returns<AdminProfileRow[]>()
      .single();

    if (error || !data) {
      await access.adminClient.auth.admin.deleteUser(authData.user.id);

      return NextResponse.json(
        { error: error?.message ?? "Failed to create admin profile" },
        { status: 500 },
      );
    }

    await appendPrivateAdminAuditEvent({
      action: "private_admin.admin_created",
      metadata: {
        email,
        temporaryPasswordGenerated: !requestedPassword,
      },
      request,
      result: "success",
      targetId: data.id,
      targetType: "admin",
      token,
    });

    return NextResponse.json(
      {
        admin: mapAdminProfile(data),
        temporaryPassword: requestedPassword ? null : password,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Private admin POST error:", error);
    return NextResponse.json(
      { error: "Failed to create admin" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const { token } = await params;
    const access = await getAuthorizedAdminClient(token);

    if (access.error) {
      return access.error;
    }

    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";

    if (!id) {
      return NextResponse.json(
        { error: "Missing required field: id" },
        { status: 400 },
      );
    }

    const target = await getAdminProfile(id, access.adminClient);

    if (target.error) {
      return target.error;
    }

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : (target.data.email ?? "");
    const fullName = buildFullName(body) || (target.data.full_name ?? "");
    const nextPassword =
      typeof body.password === "string" ? body.password.trim() : "";

    if (!email || !fullName) {
      return NextResponse.json(
        { error: "Missing required fields: fullName and email" },
        { status: 400 },
      );
    }

    const authUpdatePayload: {
      email: string;
      password?: string;
      user_metadata: {
        full_name: string;
        role: "admin";
        permissions: string[];
      };
    } = {
      email,
      user_metadata: {
        full_name: fullName,
        role: "admin",
        permissions: getDefaultPermissions("admin"),
      },
    };

    if (nextPassword) {
      authUpdatePayload.password = nextPassword;
    }

    const { error: authError } =
      await access.adminClient.auth.admin.updateUserById(id, authUpdatePayload);

    if (authError) {
      return NextResponse.json(
        { error: authError.message ?? "Failed to update admin login" },
        { status: 500 },
      );
    }

    const { data, error } = await access.adminClient
      .from("profiles")
      .update(buildAdminProfilePayload({ ...body, fullName }, email))
      .eq("id", id)
      .select(ADMIN_PROFILE_SELECT)
      .returns<AdminProfileRow[]>()
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to update admin profile" },
        { status: 500 },
      );
    }

    await appendPrivateAdminAuditEvent({
      action: "private_admin.admin_updated",
      metadata: {
        email,
        passwordChanged: Boolean(nextPassword),
        previousEmail: target.data.email,
      },
      request,
      result: "success",
      targetId: data.id,
      targetType: "admin",
      token,
    });

    return NextResponse.json(mapAdminProfile(data));
  } catch (error) {
    console.error("Private admin PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update admin" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const { token } = await params;
    const access = await getAuthorizedAdminClient(token);

    if (access.error) {
      return access.error;
    }

    const id = request.nextUrl.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const target = await getAdminProfile(id, access.adminClient);

    if (target.error) {
      return target.error;
    }

    const { count, error: countError } = await access.adminClient
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    if (countError) {
      return NextResponse.json(
        { error: countError.message ?? "Failed to validate admin count" },
        { status: 500 },
      );
    }

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "At least one admin account must remain active" },
        { status: 409 },
      );
    }

    const { error } = await access.adminClient.auth.admin.deleteUser(id);

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to delete admin login" },
        { status: 500 },
      );
    }

    await appendPrivateAdminAuditEvent({
      action: "private_admin.admin_deleted",
      metadata: {
        email: target.data.email,
        fullName: target.data.full_name,
      },
      request,
      result: "success",
      targetId: id,
      targetType: "admin",
      token,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Private admin DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete admin" },
      { status: 500 },
    );
  }
}
