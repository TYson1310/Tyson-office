export type VendorDocumentKind = "adjustment" | "invoice";

export function getVendorDocumentHref(
  kind: VendorDocumentKind,
  id: string,
  options?: { download?: boolean },
) {
  const params = new URLSearchParams({
    id,
    kind,
  });

  if (options?.download) {
    params.set("download", "1");
  }

  return `/api/vendors/document?${params.toString()}`;
}
