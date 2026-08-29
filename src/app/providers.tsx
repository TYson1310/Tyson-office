"use client";

import { SidebarProvider } from "@/components/Layouts/sidebar/sidebar-context";
import {
  AuthProvider,
  type InitialAuthState,
} from "@/contexts/AuthContext";
import {
  StoreProvider,
  type InitialStoreState,
} from "@/contexts/StoreContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { ThemeProvider } from "@/lib/theme";

export function Providers({
  children,
  initialAuthState,
  initialStoreState,
}: {
  children: React.ReactNode;
  initialAuthState?: InitialAuthState | null;
  initialStoreState?: InitialStoreState | null;
}) {
  return (
    <ThemeProvider
      defaultTheme="light"
      attribute="class"
      enableSystem={false}
      forcedTheme="light"
    >
      <AuthProvider initialAuthState={initialAuthState}>
        <StoreProvider initialStoreState={initialStoreState}>
          <NotificationProvider>
            <SidebarProvider>{children}</SidebarProvider>
          </NotificationProvider>
        </StoreProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
