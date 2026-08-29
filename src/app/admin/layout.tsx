import type { PropsWithChildren } from "react";
import { redirect } from "next/navigation";
import { getPostLoginRedirectPath } from "@/lib/auth/redirect-path";
import { canAccessAdminSurfaceByPermissions } from "@/lib/auth/route-access";
import { requireCurrentUser } from "@/lib/auth/session";

export default async function AdminLayout({ children }: PropsWithChildren) {
  const auth = await requireCurrentUser();

  if (
    !canAccessAdminSurfaceByPermissions(
      auth.appUser.role,
      auth.appUser.permissions,
    )
  ) {
    redirect(
      getPostLoginRedirectPath(
        auth.appUser.role,
        auth.appUser.storeKey,
        auth.appUser.permissions,
      ),
    );
  }

  return children;
}
