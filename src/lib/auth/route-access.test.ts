import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { isPublicPagePath } from "./public-routes.ts";
import { canAccessPath, getRouteAccessRule } from "./route-access.ts";

const APP_DIR = join(process.cwd(), "src", "app");

function walkPages(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      return walkPages(fullPath);
    }

    return entry === "page.tsx" ? [fullPath] : [];
  });
}

function pageFileToPathname(filePath: string) {
  const relativePath = relative(APP_DIR, filePath);
  const segments = relativePath
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !segment.startsWith("(") || !segment.endsWith(")"));

  if (segments.length === 0) {
    return "/";
  }

  return `/${segments.join("/")}`;
}

test("all non-public app pages have explicit route access rules", () => {
  const missingRoutes = walkPages(APP_DIR)
    .map(pageFileToPathname)
    .filter((pathname) => pathname !== "/" && !isPublicPagePath(pathname))
    .filter((pathname) => !getRouteAccessRule(pathname));

  assert.deepEqual(missingRoutes, []);
});

test("route access denies unknown protected paths", () => {
  assert.equal(canAccessPath("/unregistered-admin-page", "admin", ["*"]), false);
});

test("configured routes still honor admin wildcard permissions", () => {
  assert.equal(canAccessPath("/admin/dashboard", "admin", ["*"]), true);
  assert.equal(canAccessPath("/admin/settings", "manager", ["*"]), false);
});
