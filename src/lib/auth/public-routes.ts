export const PUBLIC_PAGE_PREFIXES = [
  "/auth/login",
  "/private-admin",
  "/unauthorized",
];

export function isPublicPagePath(pathname: string) {
  return PUBLIC_PAGE_PREFIXES.some((route) => pathname.startsWith(route));
}
