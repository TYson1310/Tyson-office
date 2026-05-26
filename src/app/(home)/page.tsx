import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPostLoginRedirectPath } from "@/lib/auth/redirect-path";
import { getCurrentUser } from "@/lib/auth/session";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: BRAND.name,
};

export default async function HomePage() {
  const auth = await getCurrentUser();

  if (!auth?.user) {
    redirect("/auth/login");
  }

  redirect(
    getPostLoginRedirectPath(
      auth.appUser.role,
      auth.appUser.storeKey,
      auth.appUser.permissions,
    ),
  );
}
