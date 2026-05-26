import "@/css/satoshi.css";
import "@/css/style.css";

import type { PropsWithChildren } from "react";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPostLoginRedirectPath } from "@/lib/auth/redirect-path";
import { isPublicPagePath } from "@/lib/auth/public-routes";
import { canAccessPath, getRouteAccessRule } from "@/lib/auth/route-access";
import { getCurrentUser } from "@/lib/auth/session";
import { BRAND } from "@/lib/brand";
import { getSiteUrl } from "@/lib/site";
import { getServerStoreContext } from "@/lib/stores/server";
import { AppShell } from "./app-shell";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  applicationName: BRAND.name,
  title: {
    default: BRAND.name,
    template: `%s | ${BRAND.name}`,
  },
  description:
    "TYson Office is a multi-store operations platform for sales, inventory, vendors, payroll, and reporting.",
  manifest: "/site.webmanifest",
  icons: {
    icon: "/images/favicon.ico",
    shortcut: "/images/favicon.ico",
    apple: "/images/favicon.ico",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
  appleWebApp: {
    capable: true,
    title: BRAND.name,
    statusBarStyle: "default",
  },
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f766e",
};

async function getRequestPathname() {
  const headerList = await headers();

  return headerList.get("x-pathname");
}

export default async function RootLayout({ children }: PropsWithChildren) {
  const pathname = await getRequestPathname();
  const auth = await getCurrentUser();
  const shouldRequireAuth =
    pathname !== null && !isPublicPagePath(pathname);

  if (shouldRequireAuth && !auth) {
    redirect("/auth/login");
  }

  if (
    auth &&
    pathname &&
    !isPublicPagePath(pathname) &&
    pathname !== "/" &&
    !canAccessPath(pathname, auth.appUser.role, auth.appUser.permissions)
  ) {
    redirect(
      getPostLoginRedirectPath(
        auth.appUser.role,
        auth.appUser.storeKey,
        auth.appUser.permissions,
      ),
    );
  }

  const storeContext = await getServerStoreContext();
  const initialAuthState = auth
    ? {
        user: {
          ...auth.appUser,
          createdAt: auth.appUser.createdAt.toISOString(),
          updatedAt: auth.appUser.updatedAt.toISOString(),
          tokenExpiry: auth.appUser.tokenExpiry?.toISOString() ?? null,
        },
      }
    : null;

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers
          initialAuthState={initialAuthState}
          initialStoreState={storeContext}
        >
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
