import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractClientIpAddress } from "@/lib/auth/login-activity-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/supabase/env";

const PRIVATE_ADMIN_SESSION_COOKIE = "harbor_private_admin_session";
const PRIVATE_ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;
const PRIVATE_ADMIN_LOGIN_ATTEMPT_LIMIT = 5;
const PRIVATE_ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const PRIVATE_ADMIN_LOGIN_LOCK_MS = 15 * 60 * 1000;

type PrivateAdminLoginAttempt = {
  blockedUntil: number;
  count: number;
  resetAt: number;
};

type PrivateAdminLoginAttemptRow = {
  attempt_count: number;
  blocked_until: string | null;
  reset_at: string;
};

type PrivateAdminAuditResult = "blocked" | "failure" | "success";

const privateAdminLoginAttempts = ((
  globalThis as typeof globalThis & {
    __harborPrivateAdminLoginAttempts?: Map<string, PrivateAdminLoginAttempt>;
  }
).__harborPrivateAdminLoginAttempts ??= new Map());

function digestValue(value: string) {
  return createHash("sha256").update(value).digest();
}

function digestHex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function compareValues(left: string, right: string) {
  return timingSafeEqual(digestValue(left), digestValue(right));
}

export function getPrivateAdminLinkToken() {
  return process.env.PRIVATE_ADMIN_LINK_TOKEN?.trim() ?? "";
}

export function getPrivateAdminMasterPassword() {
  return process.env.PRIVATE_ADMIN_MASTER_PASSWORD ?? "";
}

export function isPrivateAdminPortalConfigured() {
  return Boolean(getPrivateAdminLinkToken() && getPrivateAdminMasterPassword());
}

export function matchesPrivateAdminLinkToken(token: string) {
  const expectedToken = getPrivateAdminLinkToken();

  if (!expectedToken || !token) {
    return false;
  }

  return compareValues(token, expectedToken);
}

export function verifyPrivateAdminMasterPassword(password: string) {
  const expectedPassword = getPrivateAdminMasterPassword();

  if (!expectedPassword || !password) {
    return false;
  }

  return compareValues(password, expectedPassword);
}

function getPrivateAdminLoginAttemptKey(token: string, headers: Headers) {
  const clientIp = extractClientIpAddress(headers) ?? "unknown";
  return `${clientIp}:${digestHex(token)}`;
}

function isMissingPrivateAdminRelation(
  error: { message?: string | null } | null | undefined,
  relation: string,
) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes(relation) &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("relation"))
  );
}

function getPrivateAdminLoginAttempt(
  token: string,
  headers: Headers,
  now = Date.now(),
) {
  const key = getPrivateAdminLoginAttemptKey(token, headers);
  const existing = privateAdminLoginAttempts.get(key);

  if (!existing || existing.resetAt <= now) {
    const freshAttempt = {
      blockedUntil: 0,
      count: 0,
      resetAt: now + PRIVATE_ADMIN_LOGIN_WINDOW_MS,
    };

    privateAdminLoginAttempts.set(key, freshAttempt);
    return { key, attempt: freshAttempt };
  }

  return { key, attempt: existing };
}

function toRetryAfterSeconds(blockedUntil: number, now: number) {
  return Math.max(1, Math.ceil((blockedUntil - now) / 1000));
}

function checkMemoryPrivateAdminLoginRateLimit(
  token: string,
  headers: Headers,
) {
  const now = Date.now();
  const { attempt } = getPrivateAdminLoginAttempt(token, headers, now);

  if (attempt.blockedUntil > now) {
    return {
      limited: true,
      retryAfterSeconds: toRetryAfterSeconds(attempt.blockedUntil, now),
    };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

function recordMemoryPrivateAdminLoginFailure(token: string, headers: Headers) {
  const now = Date.now();
  const { attempt } = getPrivateAdminLoginAttempt(token, headers, now);

  attempt.count += 1;

  if (attempt.count >= PRIVATE_ADMIN_LOGIN_ATTEMPT_LIMIT) {
    attempt.blockedUntil = now + PRIVATE_ADMIN_LOGIN_LOCK_MS;
    attempt.resetAt = attempt.blockedUntil;

    return {
      limited: true,
      retryAfterSeconds: toRetryAfterSeconds(attempt.blockedUntil, now),
    };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

function clearMemoryPrivateAdminLoginFailures(token: string, headers: Headers) {
  privateAdminLoginAttempts.delete(
    getPrivateAdminLoginAttemptKey(token, headers),
  );
}

function parseTime(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadPersistentPrivateAdminAttempt(
  attemptKey: string,
  now: number,
) {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("private_admin_login_attempts")
    .select("attempt_count,blocked_until,reset_at")
    .eq("attempt_key", attemptKey)
    .maybeSingle<PrivateAdminLoginAttemptRow>();

  if (error) {
    if (isMissingPrivateAdminRelation(error, "private_admin_login_attempts")) {
      return { fallback: true as const };
    }

    console.error(
      "Failed to load private admin login attempts:",
      error.message,
    );
    return { fallback: true as const };
  }

  if (!data || parseTime(data.reset_at) <= now) {
    return {
      fallback: false as const,
      attempt: {
        blockedUntil: 0,
        count: 0,
        resetAt: now + PRIVATE_ADMIN_LOGIN_WINDOW_MS,
      },
    };
  }

  return {
    fallback: false as const,
    attempt: {
      blockedUntil: parseTime(data.blocked_until),
      count: data.attempt_count,
      resetAt: parseTime(data.reset_at),
    },
  };
}

async function savePersistentPrivateAdminAttempt(
  attemptKey: string,
  attempt: PrivateAdminLoginAttempt,
) {
  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("private_admin_login_attempts")
    .upsert(
      {
        attempt_key: attemptKey,
        attempt_count: attempt.count,
        blocked_until:
          attempt.blockedUntil > 0
            ? new Date(attempt.blockedUntil).toISOString()
            : null,
        reset_at: new Date(attempt.resetAt).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "attempt_key" },
    );

  if (error) {
    console.error("Failed to save private admin login attempt:", error.message);
    return false;
  }

  return true;
}

export async function checkPrivateAdminLoginRateLimit(
  token: string,
  headers: Headers,
) {
  if (!isSupabaseAdminConfigured()) {
    return checkMemoryPrivateAdminLoginRateLimit(token, headers);
  }

  const now = Date.now();
  const attemptKey = getPrivateAdminLoginAttemptKey(token, headers);
  const loaded = await loadPersistentPrivateAdminAttempt(attemptKey, now);

  if (loaded.fallback) {
    return checkMemoryPrivateAdminLoginRateLimit(token, headers);
  }

  const { attempt } = loaded;

  if (attempt.blockedUntil > now) {
    return {
      limited: true,
      retryAfterSeconds: toRetryAfterSeconds(attempt.blockedUntil, now),
    };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

export async function recordPrivateAdminLoginFailure(
  token: string,
  headers: Headers,
) {
  if (!isSupabaseAdminConfigured()) {
    return recordMemoryPrivateAdminLoginFailure(token, headers);
  }

  const now = Date.now();
  const attemptKey = getPrivateAdminLoginAttemptKey(token, headers);
  const loaded = await loadPersistentPrivateAdminAttempt(attemptKey, now);

  if (loaded.fallback) {
    return recordMemoryPrivateAdminLoginFailure(token, headers);
  }

  const attempt = loaded.attempt;
  attempt.count += 1;

  if (attempt.count >= PRIVATE_ADMIN_LOGIN_ATTEMPT_LIMIT) {
    attempt.blockedUntil = now + PRIVATE_ADMIN_LOGIN_LOCK_MS;
    attempt.resetAt = attempt.blockedUntil;
    await savePersistentPrivateAdminAttempt(attemptKey, attempt);

    return {
      limited: true,
      retryAfterSeconds: toRetryAfterSeconds(attempt.blockedUntil, now),
    };
  }

  await savePersistentPrivateAdminAttempt(attemptKey, attempt);
  return { limited: false, retryAfterSeconds: 0 };
}

export async function clearPrivateAdminLoginFailures(
  token: string,
  headers: Headers,
) {
  if (!isSupabaseAdminConfigured()) {
    clearMemoryPrivateAdminLoginFailures(token, headers);
    return;
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("private_admin_login_attempts")
    .delete()
    .eq("attempt_key", getPrivateAdminLoginAttemptKey(token, headers));

  if (error) {
    if (isMissingPrivateAdminRelation(error, "private_admin_login_attempts")) {
      clearMemoryPrivateAdminLoginFailures(token, headers);
      return;
    }

    console.error(
      "Failed to clear private admin login attempts:",
      error.message,
    );
  }
}

export async function appendPrivateAdminAuditEvent({
  action,
  metadata = {},
  request,
  result,
  targetId,
  targetStoreKey,
  targetType,
  token,
}: {
  action: string;
  metadata?: Record<string, unknown>;
  request: NextRequest;
  result: PrivateAdminAuditResult;
  targetId?: string | null;
  targetStoreKey?: string | null;
  targetType?: string | null;
  token: string;
}) {
  if (!isSupabaseAdminConfigured()) {
    return { success: false as const, compatibilityMode: true };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("private_admin_audit_events")
    .insert({
      action,
      result,
      target_id: targetId ?? null,
      target_store_key: targetStoreKey ?? null,
      target_type: targetType ?? null,
      token_hash: digestHex(token),
      ip_address: extractClientIpAddress(request.headers) ?? null,
      user_agent: request.headers.get("user-agent")?.trim() || null,
      metadata,
    });

  if (!error) {
    return { success: true as const, compatibilityMode: false };
  }

  if (isMissingPrivateAdminRelation(error, "private_admin_audit_events")) {
    console.warn(
      "Private admin audit ledger is unavailable until the latest migration is applied.",
    );
    return { success: false as const, compatibilityMode: true };
  }

  console.error("Failed to append private admin audit event:", error.message);
  return { success: false as const, compatibilityMode: false };
}

function createPrivateAdminSessionValue(token: string) {
  const issuedAt = Date.now();
  return `${issuedAt}.${createPrivateAdminSessionSignature(token, issuedAt)}`;
}

function createPrivateAdminSessionSignature(token: string, issuedAt: number) {
  const expectedPassword = getPrivateAdminMasterPassword();

  return createHash("sha256")
    .update(`${token}:${expectedPassword}:${issuedAt}`)
    .digest("hex");
}

function isPrivateAdminSessionValueValid(token: string, value: string) {
  const [issuedAtValue, signature] = value.split(".");
  const issuedAt = Number(issuedAtValue);

  if (!Number.isFinite(issuedAt) || !signature) {
    return false;
  }

  const ageMs = Date.now() - issuedAt;

  if (ageMs < 0 || ageMs > PRIVATE_ADMIN_SESSION_TTL_SECONDS * 1000) {
    return false;
  }

  return compareValues(
    signature,
    createPrivateAdminSessionSignature(token, issuedAt),
  );
}

export async function hasPrivateAdminSession(token: string) {
  if (!matchesPrivateAdminLinkToken(token)) {
    return false;
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(PRIVATE_ADMIN_SESSION_COOKIE)?.value;

  if (!sessionCookie) {
    return false;
  }

  return isPrivateAdminSessionValueValid(token, sessionCookie);
}

export function applyPrivateAdminSession(
  response: NextResponse,
  token: string,
) {
  response.cookies.set({
    name: PRIVATE_ADMIN_SESSION_COOKIE,
    value: createPrivateAdminSessionValue(token),
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: PRIVATE_ADMIN_SESSION_TTL_SECONDS,
    path: "/",
  });

  return response;
}

export function clearPrivateAdminSession(response: NextResponse) {
  response.cookies.set({
    name: PRIVATE_ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/",
  });

  return response;
}

export async function requirePrivateAdminSession(token: string) {
  if (!isPrivateAdminPortalConfigured()) {
    return {
      error: NextResponse.json(
        { error: "Private admin portal is not configured" },
        { status: 503 },
      ),
    };
  }

  if (!matchesPrivateAdminLinkToken(token)) {
    return {
      error: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }

  if (!(await hasPrivateAdminSession(token))) {
    return {
      error: NextResponse.json(
        { error: "Master password required" },
        { status: 401 },
      ),
    };
  }

  return { error: null };
}
