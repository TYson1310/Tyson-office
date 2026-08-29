import { NextRequest, NextResponse } from "next/server";
import {
  decodeSupabaseAccessTokenClaims,
  extractClientIpAddress,
  isLoginActivityRelationMissing,
  parseUserAgent,
} from "@/lib/auth/login-activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured, isSupabaseConfigured } from "@/lib/supabase/env";
import type { UserRole } from "@/types/erp.types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LoginActivityRequestBody = {
  accessToken?: unknown;
};

type ProfileSnapshot = {
  email: string | null;
  full_name: string | null;
  role: UserRole | null;
  store_key: string | null;
};

function getFallbackDisplayName(email: string | null | undefined) {
  if (!email) {
    return "User";
  }

  return email.split("@")[0] || "User";
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Supabase auth is not configured" },
        { status: 503 },
      );
    }

    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json(
        { error: "Supabase admin access is not configured" },
        { status: 503 },
      );
    }

    const body = (await request.json()) as LoginActivityRequestBody;
    const accessToken =
      typeof body.accessToken === "string" ? body.accessToken.trim() : "";

    if (!accessToken) {
      return NextResponse.json(
        { error: "An access token is required" },
        { status: 400 },
      );
    }

    const adminClient = createAdminClient();
    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("email,full_name,role,store_key")
      .eq("id", user.id)
      .maybeSingle<ProfileSnapshot>();

    if (profileError) {
      return NextResponse.json(
        { error: profileError.message ?? "Failed to load profile" },
        { status: 500 },
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found for authenticated user" },
        { status: 404 },
      );
    }

    const claims = decodeSupabaseAccessTokenClaims(accessToken);
    const signedInAt = claims.iat
      ? new Date(claims.iat * 1000).toISOString()
      : new Date().toISOString();
    const userAgent = request.headers.get("user-agent")?.trim() || "Unknown";
    const parsedUserAgent = parseUserAgent(userAgent);
    const activityPayload = {
      session_id: claims.session_id ?? null,
      user_id: user.id,
      email: profile.email ?? user.email ?? "",
      full_name:
        profile.full_name ??
        user.user_metadata.full_name ??
        user.user_metadata.name ??
        getFallbackDisplayName(user.email),
      role:
        profile.role ??
        (typeof user.user_metadata.role === "string"
          ? user.user_metadata.role
          : "employee"),
      assigned_store_key: profile.store_key ?? null,
      ip_address: extractClientIpAddress(request.headers) ?? null,
      user_agent: userAgent,
      browser_name: parsedUserAgent.browserName ?? null,
      browser_version: parsedUserAgent.browserVersion ?? null,
      os_name: parsedUserAgent.osName ?? null,
      os_version: parsedUserAgent.osVersion ?? null,
      device_type: parsedUserAgent.deviceType,
      device_name: parsedUserAgent.deviceName ?? null,
      metadata: {
        aal: claims.aal ?? null,
        authMethods: Array.isArray(claims.amr)
          ? claims.amr
              .map((entry) => entry?.method)
              .filter((value): value is string => Boolean(value))
          : [],
      },
      signed_in_at: signedInAt,
      last_seen_at: new Date().toISOString(),
    };

    const query = claims.session_id
      ? adminClient
          .from("login_activity")
          .upsert(activityPayload, { onConflict: "session_id" })
      : adminClient.from("login_activity").insert(activityPayload);
    const { error: insertError } = await query;

    if (insertError) {
      if (isLoginActivityRelationMissing(insertError)) {
        return NextResponse.json(
          {
            error:
              "Login tracking table is missing. Run the latest Supabase migration.",
          },
          { status: 503 },
        );
      }

      return NextResponse.json(
        { error: insertError.message ?? "Failed to record login activity" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        sessionId: claims.session_id ?? null,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Login activity POST error:", error);
    return NextResponse.json(
      { error: "Failed to record login activity" },
      { status: 500 },
    );
  }
}
