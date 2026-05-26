import { NextRequest, NextResponse } from "next/server";
import {
  applyPrivateAdminSession,
  appendPrivateAdminAuditEvent,
  checkPrivateAdminLoginRateLimit,
  clearPrivateAdminLoginFailures,
  clearPrivateAdminSession,
  isPrivateAdminPortalConfigured,
  matchesPrivateAdminLinkToken,
  recordPrivateAdminLoginFailure,
  verifyPrivateAdminMasterPassword,
} from "@/lib/private-admin-portal";

type Params = Promise<{ token: string }>;

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  if (!isPrivateAdminPortalConfigured()) {
    return NextResponse.json(
      { error: "Private admin portal is not configured" },
      { status: 503 },
    );
  }

  if (!matchesPrivateAdminLinkToken(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rateLimit = await checkPrivateAdminLoginRateLimit(
    token,
    request.headers,
  );

  if (rateLimit.limited) {
    await appendPrivateAdminAuditEvent({
      action: "private_admin.login_blocked",
      request,
      result: "blocked",
      token,
    });

    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  const body = (await request.json()) as { masterPassword?: unknown };
  const masterPassword =
    typeof body.masterPassword === "string" ? body.masterPassword : "";

  if (!verifyPrivateAdminMasterPassword(masterPassword)) {
    const failedAttempt = await recordPrivateAdminLoginFailure(
      token,
      request.headers,
    );

    if (failedAttempt.limited) {
      await appendPrivateAdminAuditEvent({
        action: "private_admin.login_blocked",
        request,
        result: "blocked",
        token,
      });

      return NextResponse.json(
        { error: "Too many failed attempts. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(failedAttempt.retryAfterSeconds),
          },
        },
      );
    }

    await appendPrivateAdminAuditEvent({
      action: "private_admin.login_failed",
      request,
      result: "failure",
      token,
    });

    return NextResponse.json(
      { error: "Invalid master password" },
      { status: 401 },
    );
  }

  await clearPrivateAdminLoginFailures(token, request.headers);
  await appendPrivateAdminAuditEvent({
    action: "private_admin.login_succeeded",
    request,
    result: "success",
    token,
  });

  return applyPrivateAdminSession(NextResponse.json({ success: true }), token);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  if (!matchesPrivateAdminLinkToken(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await appendPrivateAdminAuditEvent({
    action: "private_admin.logged_out",
    request,
    result: "success",
    token,
  });

  return clearPrivateAdminSession(NextResponse.json({ success: true }));
}
