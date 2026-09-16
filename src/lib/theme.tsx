"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const THEME_STORAGE_KEY = "theme:v2";
const LEGACY_THEME_STORAGE_KEY = "theme";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  resolvedTheme: ResolvedTheme;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = "theme",
  attribute = "class",
  enableSystem = true,
  enableColorScheme = true,
  forcedTheme,
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  attribute?: string;
  enableSystem?: boolean;
  enableColorScheme?: boolean;
  forcedTheme?: ResolvedTheme | undefined;
}) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme;

    try {
      const currentKey = storageKey === "theme" ? THEME_STORAGE_KEY : storageKey;
      const legacyKey = storageKey === "theme" ? LEGACY_THEME_STORAGE_KEY : null;
      const stored = localStorage.getItem(currentKey) as Theme | null;

      if (stored && ["light", "dark", "system"].includes(stored)) {
        return stored as Theme;
      }

      if (legacyKey) {
        const legacyStored = localStorage.getItem(legacyKey) as Theme | null;
        if (legacyStored && ["light", "dark", "system"].includes(legacyStored)) {
          localStorage.setItem(currentKey, legacyStored);
          localStorage.removeItem(legacyKey);
          return legacyStored as Theme;
        }
      }

      return defaultTheme;
    } catch {
      return defaultTheme;
    }
  });

  const getSystemTheme = useCallback((): ResolvedTheme => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, []);

  const applyThemeToDocument = useCallback(
    (resolved: ResolvedTheme) => {
      if (attribute === "class") {
        document.documentElement.classList.toggle("dark", resolved === "dark");
      } else {
        if (resolved) {
          document.documentElement.setAttribute(attribute, resolved);
        } else {
          document.documentElement.removeAttribute(attribute);
        }
      }

      if (enableColorScheme) {
        try {
          document.documentElement.style.colorScheme = resolved === "dark" ? "dark" : "light";
        } catch {}
      }
    },
    [attribute, enableColorScheme],
  );

  const resolveTheme = useCallback(
    (t: Theme): ResolvedTheme => {
      if (forcedTheme) return forcedTheme;
      if (t === "system" && enableSystem) {
        return getSystemTheme();
      }

      return t === "dark" ? "dark" : "light";
    },
    [forcedTheme, enableSystem, getSystemTheme],
  );

  const [resolvedThemeState, setResolvedThemeState] = useState<ResolvedTheme>(() =>
    resolveTheme(theme),
  );

  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedThemeState(resolved);
    applyThemeToDocument(resolved);

  }, [theme, resolveTheme, applyThemeToDocument]);

  // Listen for system preference changes when using `system`
  useEffect(() => {
    if (!enableSystem || typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handle = () => {
      const resolved = resolveTheme(theme);
      setResolvedThemeState(resolved);
      applyThemeToDocument(resolved);
    };

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handle);
    } else {
      // fallback
      // @ts-ignore
      mql.addListener(handle);
    }

    return () => {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", handle);
      } else {
        // @ts-ignore
        mql.removeListener(handle);
      }
    };
  }, [enableSystem, resolveTheme, theme, applyThemeToDocument]);

  // Sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === storageKey) {
        try {
          const newValue = (e.newValue as Theme) || defaultTheme;
          setThemeState(newValue);
        } catch {}
      }
    };

    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [storageKey, defaultTheme]);

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(() => {
        try {
          const currentKey = storageKey === "theme" ? THEME_STORAGE_KEY : storageKey;
          const legacyKey = storageKey === "theme" ? LEGACY_THEME_STORAGE_KEY : null;
          localStorage.setItem(currentKey, t);
          if (legacyKey) {
            localStorage.removeItem(legacyKey);
          }
        } catch {}
        return t;
      });
    },
    [storageKey],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme: resolvedThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);

  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return ctx;
}
