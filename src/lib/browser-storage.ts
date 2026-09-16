export const AUTH_SESSION_STORAGE_KEYS = ["authSession"] as const;

export function clearEphemeralBrowserStorage() {
  if (typeof window === "undefined") {
    return;
  }

  for (const key of AUTH_SESSION_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage access errors; preserve all user data in the app's real sources.
    }

    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Ignore storage access errors; preserve all user data in the app's real sources.
    }
  }
}
