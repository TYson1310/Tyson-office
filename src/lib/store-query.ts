export type StoreQueryValue = string | string[] | undefined;

export function normalizeStoreId(value: StoreQueryValue) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function createStoreHref(path: string, storeId?: string) {
  if (!storeId) {
    return path;
  }

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}store=${encodeURIComponent(storeId)}`;
}
