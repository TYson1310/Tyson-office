export const APP_BROWSER_STORAGE_AUDIT = {
  preferenceKeys: {
    theme: "theme:v2",
    reportCategory: "reports:selectedCategory:v1",
  },
  authKeys: ["authSession"],
  legacyKeys: {
    theme: "theme",
    reportCategory: "reports:selectedCategory",
  },
} as const;

export function getBrowserStorageAuditSummary() {
  if (typeof window === "undefined") {
    return {
      authKeys: [],
      legacyKeys: [],
      preferenceKeys: [],
      totalEntries: 0,
    };
  }

  const summary = {
    authKeys: [] as string[],
    legacyKeys: [] as string[],
    preferenceKeys: [] as string[],
    totalEntries: 0,
  };

  for (const key of APP_BROWSER_STORAGE_AUDIT.authKeys) {
    try {
      if (window.localStorage.getItem(key) !== null || window.sessionStorage.getItem(key) !== null) {
        summary.authKeys.push(key);
      }
    } catch {
      // ignore storage access issues during audit
    }
  }

  for (const key of Object.values(APP_BROWSER_STORAGE_AUDIT.legacyKeys)) {
    try {
      if (window.localStorage.getItem(key) !== null || window.sessionStorage.getItem(key) !== null) {
        summary.legacyKeys.push(key);
      }
    } catch {
      // ignore storage access issues during audit
    }
  }

  for (const key of Object.values(APP_BROWSER_STORAGE_AUDIT.preferenceKeys)) {
    try {
      if (window.localStorage.getItem(key) !== null || window.sessionStorage.getItem(key) !== null) {
        summary.preferenceKeys.push(key);
      }
    } catch {
      // ignore storage access issues during audit
    }
  }

  summary.totalEntries =
    summary.authKeys.length +
    summary.legacyKeys.length +
    summary.preferenceKeys.length;

  return summary;
}

export function logBrowserStorageAudit() {
  if (typeof window === "undefined") {
    return;
  }

  const summary = getBrowserStorageAuditSummary();
  if (summary.totalEntries === 0) {
    return;
  }

  console.info("Browser storage audit:", summary);
}

export function clearOnlyStaleAppStorage(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  const staleKeys = Array.from(
    new Set([
      ...APP_BROWSER_STORAGE_AUDIT.authKeys,
      ...Object.values(APP_BROWSER_STORAGE_AUDIT.legacyKeys),
      ...Object.values(APP_BROWSER_STORAGE_AUDIT.preferenceKeys),
    ]),
  );

  const removedKeys: string[] = [];

  for (const key of staleKeys) {
    let wasPresent = false;

    try {
      wasPresent = window.localStorage.getItem(key) !== null || wasPresent;
      window.localStorage.removeItem(key);
    } catch {
      // ignore storage access issues
    }

    try {
      wasPresent = window.sessionStorage.getItem(key) !== null || wasPresent;
      window.sessionStorage.removeItem(key);
    } catch {
      // ignore storage access issues
    }

    if (wasPresent) {
      removedKeys.push(key);
    }
  }

  try {
    localStorage.setItem(
      "app:last-stale-storage-cleared-at",
      new Date().toISOString(),
    );
  } catch {
    // ignore storage access issues
  }

  return removedKeys;
}
