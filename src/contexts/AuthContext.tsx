"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  PROFILE_SELECT,
  mapSupabaseSessionToAuthSession,
  type ProfileRecord,
} from "@/lib/auth/shared";
import { isRefreshTokenNotFoundError } from "@/lib/supabase/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type {
  AuthContextType,
  AuthSession,
  AuthUser,
  LoginCredentials,
} from "@/types/erp.types";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type BrowserSupabaseClient = ReturnType<typeof createSupabaseClient>;
export type InitialAuthState = {
  user: Omit<AuthUser, "createdAt" | "updatedAt" | "tokenExpiry"> & {
    createdAt: string;
    updatedAt: string;
    tokenExpiry?: string | null;
  };
};

function hydrateInitialUser(
  initialAuthState?: InitialAuthState | null,
): AuthUser | null {
  if (!initialAuthState?.user) {
    return null;
  }

  return {
    ...initialAuthState.user,
    createdAt: new Date(initialAuthState.user.createdAt),
    updatedAt: new Date(initialAuthState.user.updatedAt),
    tokenExpiry: initialAuthState.user.tokenExpiry
      ? new Date(initialAuthState.user.tokenExpiry)
      : undefined,
  };
}

async function loadProfile(
  supabase: BrowserSupabaseClient,
  userId: string,
): Promise<ProfileRecord | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle<ProfileRecord>();

  if (error) {
    console.error("Failed to load profile:", error);
    return null;
  }

  return data ?? null;
}

async function buildSupabaseSession(
  supabase: BrowserSupabaseClient,
  nextSession: Session,
) {
  const profile = await loadProfile(supabase, nextSession.user.id);
  return mapSupabaseSessionToAuthSession(nextSession, profile);
}

async function recordLoginActivity(accessToken: string) {
  try {
    const response = await fetch("/api/auth/login-activity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accessToken }),
      keepalive: true,
    });

    if (!response.ok) {
      console.error("Failed to record login activity:", await response.text());
    }
  } catch (error) {
    console.error("Failed to record login activity:", error);
  }
}

export const AuthProvider = ({
  children,
  initialAuthState,
}: {
  children: ReactNode;
  initialAuthState?: InitialAuthState | null;
}) => {
  const initialUser = useMemo(
    () => hydrateInitialUser(initialAuthState),
    [initialAuthState],
  );
  const [user, setUser] = useState<AuthSession["user"] | null>(initialUser);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [supabase] = useState<BrowserSupabaseClient | null>(() =>
    isSupabaseConfigured() ? createSupabaseClient() : null,
  );

  useEffect(() => {
    if (!supabase) {
      localStorage.removeItem("authSession");
      document.cookie =
        "authSession=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      setUser(null);
      setSession(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const syncSupabaseSession = async (nextSession: Session | null) => {
      if (!isMounted) {
        return;
      }

      if (!nextSession) {
        setUser(null);
        setSession(null);
        setIsLoading(false);
        return;
      }

      try {
        const authSession = await buildSupabaseSession(supabase, nextSession);

        if (!isMounted) {
          return;
        }

        setUser(authSession.user);
        setSession(authSession);
      } catch (error) {
        console.error("Failed to sync auth session:", error);

        if (isMounted) {
          setUser(null);
          setSession(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    const initializeSupabaseAuth = async () => {
      try {
        const {
          data: { session: existingSession },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          if (isRefreshTokenNotFoundError(error)) {
            await supabase.auth.signOut({ scope: "local" });
            await syncSupabaseSession(null);
            return;
          }

          throw error;
        }

        await syncSupabaseSession(existingSession);
      } catch (error) {
        if (!isRefreshTokenNotFoundError(error)) {
          console.error("Failed to initialize Supabase auth:", error);
        }

        if (isMounted) {
          setUser(null);
          setSession(null);
          setIsLoading(false);
        }
      }
    };

    void initializeSupabaseAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncSupabaseSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [initialUser, supabase]);

  const login = async (credentials: LoginCredentials): Promise<AuthSession> => {
    setIsLoading(true);

    try {
      if (!supabase) {
        throw new Error("Supabase auth is not configured");
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data.session) {
        throw new Error("Login failed");
      }

      const authSession = await buildSupabaseSession(supabase, data.session);

      if (authSession.user.role === "admin") {
        try {
          await fetch("/api/store-context", { method: "DELETE" });
        } catch (storeError) {
          console.error(
            "Failed to clear admin store context on login:",
            storeError,
          );
        }
      }

      setUser(authSession.user);
      setSession(authSession);
      void recordLoginActivity(data.session.access_token);

      return authSession;
    } catch (error) {
      console.error("Login error:", error);
      throw error instanceof Error ? error : new Error("Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    if (!supabase) {
      setUser(null);
      setSession(null);
      return;
    }

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      try {
        await fetch("/api/store-context", { method: "DELETE" });
      } catch (storeError) {
        console.error("Failed to clear store context:", storeError);
      }
      setUser(null);
      setSession(null);
    }
  };

  const refreshToken = async () => {
    if (!supabase) {
      await logout();
      return;
    }

    try {
      const { data, error } = await supabase.auth.refreshSession();

      if (error || !data.session) {
        if (error && !isRefreshTokenNotFoundError(error)) {
          console.error("Token refresh error:", error);
        }

        await logout();
        return;
      }

      const authSession = await buildSupabaseSession(supabase, data.session);
      setUser(authSession.user);
      setSession(authSession);
    } catch (error) {
      if (!isRefreshTokenNotFoundError(error)) {
        console.error("Token refresh error:", error);
      }

      await logout();
    }
  };

  const value: AuthContextType = {
    user,
    session,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refreshToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
};
