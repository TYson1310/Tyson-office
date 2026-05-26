import type { User } from "@supabase/supabase-js";

type AuthErrorLike = {
  code?: string | null;
  message?: string | null;
};

type AuthClientLike = {
  auth: {
    getUser: () => Promise<{
      data: { user: User | null };
      error: AuthErrorLike | null;
    }>;
    signOut: (options?: {
      scope?: "global" | "local" | "others";
    }) => Promise<unknown>;
  };
};

export function isRefreshTokenNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const authError = error as AuthErrorLike;
  const message = authError.message?.toLowerCase() ?? "";

  return (
    authError.code === "refresh_token_not_found" ||
    (message.includes("refresh token") &&
      (message.includes("not found") || message.includes("invalid")))
  );
}

async function clearLocalSession(supabase: AuthClientLike) {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Ignore sign-out cleanup errors while recovering from stale auth cookies.
  }
}

export async function getUserSafely(supabase: AuthClientLike) {
  try {
    const result = await supabase.auth.getUser();

    if (isRefreshTokenNotFoundError(result.error)) {
      await clearLocalSession(supabase);

      return {
        data: { user: null as User | null },
        error: null,
      };
    }

    return result;
  } catch (error) {
    if (isRefreshTokenNotFoundError(error)) {
      await clearLocalSession(supabase);

      return {
        data: { user: null as User | null },
        error: null,
      };
    }

    throw error;
  }
}
