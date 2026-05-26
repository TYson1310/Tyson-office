import { expect, test, type Page } from "@playwright/test";
import { loadE2EEnv } from "./load-env";

loadE2EEnv();

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

async function completeStoreSelectionIfNeeded(page: Page) {
  if (!page.url().includes("/admin/store-selection")) {
    return;
  }

  const firstStoreButton = page.locator("button").filter({
    hasText: "Open workspace",
  }).first();

  await expect(firstStoreButton).toBeVisible();
  await firstStoreButton.click();
  await page.waitForURL((url) => url.pathname === "/admin/dashboard");
}

async function loginAsAdmin(page: Page) {
  if (!adminEmail || !adminPassword) {
    test.skip(true, "E2E admin credentials are not configured.");
  }

  await page.goto("/auth/login");
  await page.getByLabel("Email Address").fill(adminEmail ?? "");
  await page.getByLabel("Password").fill(adminPassword ?? "");
  await page.getByRole("button", { name: /sign in/i }).click();

  const loginResult = await Promise.race([
    page
      .waitForURL((url) => !url.pathname.startsWith("/auth/login"), {
        timeout: 30_000,
      })
      .then(() => "signed-in" as const),
    page
      .getByText(/invalid login credentials|invalid email or password/i)
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => "invalid-credentials" as const),
  ]);

  if (loginResult === "invalid-credentials") {
    throw new Error(
      "Configured E2E admin credentials are invalid. Set E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD to a valid admin user, or set E2E_SYNC_ADMIN_USER=1 with SUPABASE_SERVICE_ROLE_KEY so Playwright global setup can sync the test user before tests.",
    );
  }

  await completeStoreSelectionIfNeeded(page);
}

test("admin finance smoke flow loads core operational pages", async ({ page }) => {
  test.skip(!adminEmail || !adminPassword, "E2E admin credentials are not configured.");

  await loginAsAdmin(page);

  await page.goto("/admin/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Operations intelligence")).toBeVisible();

  await page.goto("/vendors/invoices", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Payment History")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /download vendor ledger/i }),
  ).toBeVisible();

  await page.goto("/admin/approvals", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Expense approvals")).toBeVisible();

  await page.goto("/admin/expenses", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Expense ledger")).toBeVisible();

  await page.goto("/payroll", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Recent payrolls")).toBeVisible();

  await page.goto("/reports/vendor-analysis", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Vendor Performance")).toBeVisible();

  await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Accounting controls")).toBeVisible();
});
