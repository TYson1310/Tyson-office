"use client";

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { StoreSummary } from "@/lib/stores/shared";

type StoreContextValue = {
  activeStore: StoreSummary | null;
  accessibleStores: StoreSummary[];
  isLoading: boolean;
  isAdmin: boolean;
  needsSelection: boolean;
  refreshStoreContext: () => Promise<void>;
  selectStore: (storeKey: string) => Promise<void>;
};

type StoreContextPayload = {
  activeStore: StoreSummary | null;
  accessibleStores: StoreSummary[];
  isAdmin: boolean;
  needsSelection: boolean;
};

export type InitialStoreState = StoreContextPayload;

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

async function readJson<T>(response: Response) {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

export function StoreProvider({
  children,
  initialStoreState,
}: {
  children: ReactNode;
  initialStoreState?: InitialStoreState | null;
}) {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [activeStore, setActiveStore] = useState<StoreSummary | null>(
    initialStoreState?.activeStore ?? null,
  );
  const [accessibleStores, setAccessibleStores] = useState<StoreSummary[]>(
    initialStoreState?.accessibleStores ?? [],
  );
  const [isAdmin, setIsAdmin] = useState(Boolean(initialStoreState?.isAdmin));
  const [needsSelection, setNeedsSelection] = useState(
    Boolean(initialStoreState?.needsSelection),
  );
  const [isLoading, setIsLoading] = useState(!initialStoreState);

  const refreshStoreContext = useCallback(async () => {
    if (!isAuthenticated) {
      setActiveStore(null);
      setAccessibleStores([]);
      setIsAdmin(false);
      setNeedsSelection(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/store-context", { cache: "no-store" });
      const payload = await readJson<StoreContextPayload & { error?: string }>(response);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setActiveStore(null);
          setAccessibleStores([]);
          setIsAdmin(false);
          setNeedsSelection(false);
          return;
        }

        throw new Error(payload.error ?? "Failed to load store context");
      }

      setActiveStore(payload.activeStore);
      setAccessibleStores(payload.accessibleStores ?? []);
      setIsAdmin(Boolean(payload.isAdmin));
      setNeedsSelection(Boolean(payload.needsSelection));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const selectStore = useCallback(async (storeKey: string) => {
    const response = await fetch("/api/store-context", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ storeKey }),
    });
    const payload = await readJson<StoreContextPayload & { error?: string }>(response);

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to select store");
    }

    setActiveStore(payload.activeStore);
    setAccessibleStores(payload.accessibleStores ?? []);
    setIsAdmin(Boolean(payload.isAdmin));
    setNeedsSelection(Boolean(payload.needsSelection));
  }, []);

  const skipInitialRefresh = useMemo(
    () => Boolean(initialStoreState),
    [initialStoreState],
  );
  const [hasSkippedInitialRefresh, setHasSkippedInitialRefresh] = useState(false);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    if (skipInitialRefresh && !hasSkippedInitialRefresh) {
      setHasSkippedInitialRefresh(true);
      return;
    }

    void refreshStoreContext();
  }, [
    hasSkippedInitialRefresh,
    isAuthLoading,
    refreshStoreContext,
    skipInitialRefresh,
  ]);

  const value = useMemo<StoreContextValue>(
    () => ({
      activeStore,
      accessibleStores,
      isLoading,
      isAdmin,
      needsSelection,
      refreshStoreContext,
      selectStore,
    }),
    [
      activeStore,
      accessibleStores,
      isAdmin,
      isLoading,
      needsSelection,
      refreshStoreContext,
      selectStore,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);

  if (!context) {
    throw new Error("useStore must be used within a StoreProvider");
  }

  return context;
}
