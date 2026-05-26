import { NextRequest, NextResponse } from "next/server";
import { getPostLoginRedirectPath } from "@/lib/auth/redirect-path";
import { isPublicPagePath } from "@/lib/auth/public-routes";
import { canAccessPath } from "@/lib/auth/route-access";
import { updateSession } from "@/lib/supabase/proxy";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublicRoute = isPublicPagePath(pathname);

  let response = NextResponse.next({
    request,
  });

  let isAuthenticated = false;

  if (isSupabaseConfigured()) {
    const { response: updatedResponse, appUser } = await updateSession(request);
    response = updatedResponse;
    isAuthenticated = Boolean(appUser);

    if (
      appUser &&
      !isPublicRoute &&
      pathname !== "/" &&
      !canAccessPath(pathname, appUser.role, appUser.permissions)
    ) {
      return NextResponse.redirect(
        new URL(
          getPostLoginRedirectPath(
            appUser.role,
            appUser.storeKey,
            appUser.permissions,
          ),
          request.url,
        ),
      );
    }
  }

  if (!isAuthenticated && !isPublicRoute) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  if (isAuthenticated && pathname.startsWith("/auth/login")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
