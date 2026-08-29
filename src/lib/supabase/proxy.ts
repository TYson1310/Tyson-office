import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  mapSupabaseUserToAuthUser,
  PROFILE_SELECT,
  type ProfileRecord,
} from "@/lib/auth/shared";
import type { AuthUser } from "@/types/erp.types";
import { getUserSafely } from "./auth";
import {
  getSupabasePublishableKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "./env";

function createMiddlewareResponse(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  user: User | null;
  profile: ProfileRecord | null;
  appUser: AuthUser | null;
}> {
  if (!isSupabaseConfigured()) {
    return {
      response: createMiddlewareResponse(request),
      user: null,
      profile: null,
      appUser: null,
    };
  }

  let response = createMiddlewareResponse(request);

  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = createMiddlewareResponse(request);

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await getUserSafely(supabase);
  let profile: ProfileRecord | null = null;

  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", user.id)
      .maybeSingle<ProfileRecord>();

    profile = data ?? null;
  }

  return {
    response,
    user,
    profile,
    appUser: user ? mapSupabaseUserToAuthUser(user, profile) : null,
  };
}
