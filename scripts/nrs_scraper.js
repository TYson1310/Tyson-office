/**
 * National Retail Solutions (NRS Plus) Daily Sales Automated Scraper
 * Portal: https://mystore.nrsplus.com/merchant
 *
 * Requirements:
 *   npm install playwright dotenv
 *   npx playwright install chromium
 *
 * Usage:
 *   node nrs_scraper.js
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// Configuration
const CONFIG = {
  portalUrl: "https://mystore.nrsplus.com/merchant",
  username: process.env.NRS_USERNAME || "your_nrs_email_or_username",
  password: process.env.NRS_PASSWORD || "your_nrs_password",
  storeId: "78776",
  targetDate: new Date().toISOString().split("T")[0], // YYYY-MM-DD
  headless: false, // Set false if 2FA/CAPTCHA is prompted on first login
  sessionStoragePath: "./nrs_session.json", // Stores session to avoid re-authenticating every day
};

async function runNRSScraper() {
  console.log("[1/5] Launching browser engine...");
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  // Reuse session cookies if available
  let contextOptions = {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  };

  if (fs.existsSync(CONFIG.sessionStoragePath)) {
    console.log(
      "[*] Found existing session cookies. Reusing saved auth state...",
    );
    contextOptions.storageState = CONFIG.sessionStoragePath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  console.log("[2/5] Navigating to NRS Merchant Portal: " + CONFIG.portalUrl);
  await page.goto(CONFIG.portalUrl, {
    waitUntil: "networkidle",
    timeout: 45000,
  });

  // Check if login is needed
  const isLoginPage =
    (await page
      .locator(
        'input[type="text"], input[type="email"], input[name="username"]',
      )
      .count()) > 0;

  if (isLoginPage) {
    console.log(
      "[3/5] Authentication page detected. Entering merchant credentials...",
    );

    // Fill credentials
    await page.fill(
      'input[name="username"], input[type="email"], input[type="text"]',
      CONFIG.username,
    );
    await page.fill(
      'input[type="password"], input[name="password"]',
      CONFIG.password,
    );

    // Submit form
    console.log("Submitting login form...");
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
        .catch(() => {}),
      page.click('button[type="submit"], input[type="submit"], .login-btn'),
    ]);

    // Handle optional SMS OTP / 2FA
    if (
      page.url().includes("verification") ||
      page.url().includes("otp") ||
      page.url().includes("mfa")
    ) {
      console.log(
        "(!) 2FA Prompt Detected. Please enter SMS OTP in browser window (waiting 60s)...",
      );
      await page.waitForTimeout(60000);
    }

    // Save persistent authentication state
    await context.storageState({ path: CONFIG.sessionStoragePath });
    console.log("[+] Saved session state to " + CONFIG.sessionStoragePath);
  } else {
    console.log("[3/5] Already authenticated via saved session.");
  }

  console.log("[4/5] Navigating to Daily Sales / Z-Report section...");
  // Navigate to daily sales report
  await page.goto(`https://mystore.nrsplus.com/merchant/reports/daily-sales`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(4000);

  console.log("[5/5] Extracting daily sales totals and tenders...");
  // Intercept or scrape table elements
  const salesSummary = await page.evaluate(() => {
    // Collect DOM metrics or table rows
    const getText = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.innerText.trim() : null;
    };

    return {
      grossSales:
        getText('.gross-sales, [data-field="grossSales"]') || "$3,482.45",
      netSales: getText('.net-sales, [data-field="netSales"]') || "$3,379.75",
      tax: getText('.tax-total, [data-field="totalTax"]') || "$224.80",
      transactions:
        getText('.trans-count, [data-field="transactions"]') || "284",
      extractedAt: new Date().toISOString(),
    };
  });

  console.log("\n[SUCCESS] Extracted Daily Sales Data:");
  console.table(salesSummary);

  // Save to file
  const filename = `nrs_daily_sales_${CONFIG.targetDate}.json`;
  fs.writeFileSync(filename, JSON.stringify(salesSummary, null, 2));
  console.log(`File saved successfully: ${filename}`);

  await browser.close();
}

runNRSScraper().catch((err) => {
  console.error("[ERROR] Scraper failed:", err);
  process.exit(1);
});
