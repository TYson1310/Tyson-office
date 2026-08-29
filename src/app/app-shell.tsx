"use client";

import { Sidebar } from "@/components/Layouts/sidebar";
import { Header } from "@/components/Layouts/header";
import { useAuth } from "@/contexts/AuthContext";
import { useStore } from "@/contexts/StoreContext";
import NextTopLoader from "nextjs-toploader";
import type { PropsWithChildren } from "react";
import { usePathname } from "next/navigation";

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const { user, isLoading: isAuthLoading } = useAuth();
  const {
    activeStore,
    accessibleStores,
    isLoading: isStoreLoading,
  } = useStore();
  const isAuthRoute = pathname?.startsWith("/auth");
  const isPrivateAdminRoute = pathname?.startsWith("/private-admin");
  const isBootstrappingApp =
    !isAuthRoute &&
    !isPrivateAdminRoute &&
    ((isAuthLoading && !user) ||
      (!!user &&
        isStoreLoading &&
        !activeStore &&
        accessibleStores.length === 0));

  return (
    <>
      <NextTopLoader color="#0D9488" showSpinner={false} />

      {isAuthRoute || isPrivateAdminRoute ? (
        children
      ) : (
        <div className="flex min-h-screen w-full">
          <Sidebar />

          <div className="relative min-w-0 flex-1">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden"
            >
              <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(13,148,136,0.14),transparent_62%)]" />
              <div className="absolute right-[-6rem] top-16 h-72 w-72 rounded-full bg-teal-200/20 blur-3xl" />
              <div className="absolute bottom-10 left-[-5rem] h-64 w-64 rounded-full bg-cyan-200/25 blur-3xl" />
            </div>

            <div className="relative">
              <Header />

              <main className="mx-auto w-full max-w-screen-2xl min-w-0 p-3 sm:p-4 md:p-6 2xl:p-10">
                {children}
              </main>
            </div>
          </div>

          {isBootstrappingApp ? (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/22 backdrop-blur-sm">
              <div className="rounded-2xl border border-white/60 bg-white/92 px-5 py-4 shadow-[0_20px_50px_rgba(15,23,42,0.16)]">
                <div className="flex items-center gap-3 text-sm font-medium text-slate-700">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
                  Restoring workspace
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
