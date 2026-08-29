# TYson Office

TYson Office is a private multi-store ERP built on Next.js, React, and Supabase. It is designed for day-to-day store operations: staff management, shift tracking, manual payroll processing, vendor invoice capture, expense tracking, product margin review, sales logging, and reporting.

This app is currently configured as a private internal system, not a public marketing site.

## What The App Does

- Multi-store access with store-scoped data
- Role-based access for `admin`, `manager`, `accountant`, `cashier`, `warehouse`, and `employee`
- Staff management and employee profile details
- Self-service clock in / clock out for staff
- Admin verification of shift logs
- Manual payroll entry and payroll statement management
- Employee payroll document access
- Vendor directory and AI-assisted invoice extraction
- Vendor payments, returns, and supplier deductions tracking
- Approval workflow and attachment support for supplier adjustments
- Posted/void vendor payment audit trail with supplier ledger export
- Store-scoped accounting close controls and approval queue
- Product margin engine and editable margin ledger
- Sales daily entry and sales reconciliation
- General expense tracking for true net profit
- Downloadable reports
- Browser smoke tests for deployment validation
- Private admin portal protected by a secret link token and master password


## Documentation

### User Guides & Manuals

- **[Lottery Management System User Manual](./docs/LOTTERY_USER_MANUAL.md)** - Comprehensive guide for daily lottery operations, including EOD reconciliation, EFT management, cash advances, scratch pack settlements, and reporting workflows.

### Other Resources

- See `/docs` folder for additional setup guides and technical documentation.

## Core Business Rules

- Payroll runs from manual payroll entries only.
- Clock in / clock out logs are tracked separately for attendance and verification.
- General expenses are store-scoped and feed net profit reporting.
- Vendor invoices are supplier-scoped to avoid accidental product merging across suppliers.
- Paid vendor invoice status is derived from posted payments and approved supplier adjustments.
- Voided vendor payments remain on the ledger for audit history but stop affecting invoice balances.
- Accounting close dates block edits, approvals, voids, and deletions for vendor and expense records through the closed date.
- Inventory movement history records approved supplier return postings and reversals.
- The app is no-indexed by default through `robots.txt` and metadata.

## Mathematical And Statistical Logic

The app contains business math across sales, cash control, inventory, vendors, payroll, expenses, reports, and lottery operations. Financial amounts are generally rounded to cents with `Math.round(value * 100) / 100`; invoice piece quantities round to three decimals. Percent and rate inputs are clamped to valid ranges, commonly `0` to `100`, and target product margins are capped below `95%` to avoid impossible price calculations.

### Shared Numeric Rules

- Sales closeout matching uses a `0.01` tolerance between payment totals and product totals.
- Vendor invoice reconciliation uses a `0.05` tolerance for line, subtotal, tax, and total mismatches.
- Lottery report day ranges are clamped to safe windows, such as `1` to `90` days for reports and `1` to `52` weeks for EFT history.
- Negative or invalid numeric inputs are normalized before calculations so dashboards and reports do not show `NaN` or infinite values.

### Sales, Cash, And Deposits

- Daily sales payment totals are grouped by enabled payment method, and product totals are grouped by enabled sales detail type.
- `totalByPayment = sum(payment line amounts)`.
- `totalByProduct = sum(product line amounts)`.
- `cashSales = sum(payment methods where store settings mark the method as cash-counted)`.
- `cashlessSales = totalByPayment - cashSales`.
- Sales closeout unlocks only when payment lines and product lines both exist and `abs(totalByPayment - totalByProduct) <= 0.01`.
- Gross sales use the payment total when it is materially non-zero; otherwise the product total is used.
- Daily expected cash is `openingFloat + cashSales - totalPayouts`.
- Daily cash variance is `expectedCash - actualCashCounted`.
- Daily variance percent is `(expectedCash - actualCashCounted) / (expectedCash || 1) * 100`.
- Bank deposit preview is `cashCounted - closingFloat`.
- Product breakdown percentages are `productAmount / totalProductAmount * 100`.
- Cash vault activity records cash sales as positive movement, payouts as negative movement, bank deposits as negative movement, and voided deposits as excluded movement.
- Sales cash variance is inverted when posted to the cash vault so shortages reduce cash on hand and overages increase cash on hand.
- Fallback cash on hand equals cash sales minus approved sales payouts, approved sales variance, approved cash expenses, posted cash vendor payments, cash payroll payments, and non-voided bank deposits.

### Vendors, Invoices, And Product Costs

- Invoice net balance is `invoiceAmount - postedPayments - approvedAdjustments`, rounded to cents.
- Invoice status is paid when net balance is `<= 0.005`, overdue when the due date has passed and balance is positive, pending when still open, and cancelled when explicitly cancelled.
- Supplier net payable is `sum(invoice net balances) - unallocated approved adjustments`.
- Supplier open balance is `max(netPayable, 0)`.
- Supplier available credit is `max(-netPayable, 0)`.
- Vendor ledger running balance adds invoice debits and subtracts posted payment or approved adjustment credits.
- Supplier adjustment item amount is `quantity * unitCost` when both values are positive; otherwise the normalized amount is used.
- Adjustment inventory impact aggregates by product and recomputes weighted unit cost as `totalAmount / totalQuantity`.
- Invoice line total is `sum(invoice item amounts)`.
- Expected invoice total from subtotal is `subtotal + tax`.
- Invoice mismatch flags trigger when line totals, subtotal, tax, or total differ by more than `0.05`.
- Invoice item unit count is `quantity * itemsPerPack`.
- Invoice cost per piece is `itemAmount / unitCount`.
- Product catalog cost falls back through item amount per inventory quantity, unit price per pack, and unit price when detailed pack information is missing.
- Selling price for a target gross margin is `cost / (1 - clampedMarginRatio)`.
- Product cost review compares latest and previous receipt costs with `increaseAmount = latestCost - previousCost`.
- Product cost increase percent is `increaseAmount / previousCost * 100`.
- Default cost review warning threshold is `5%`, with same-vendor and cross-vendor comparisons sorted by increase percent and receipt date.

### Expenses, Budgets, And Recurring Costs

- Expense subtotal is `totalAmount - taxAmount`, rounded to cents.
- Expense validation requires total amount greater than zero, tax amount at least zero, and tax amount no greater than total.
- Duplicate expense detection compares rounded amount, normalized category, vendor or supplier, normalized description, non-void status, and dates within `7` days.
- Monthly budget actuals are approved expense sums grouped by normalized category.
- Budget variance is `budgetAmount - actualAmount`.
- Budget status is `unbudgeted` when budget is zero and actual is positive, `over_budget` when variance is negative, `under_budget` when variance is positive, and `on_target` when variance is zero.
- Budget summaries total budget, actual, and variance, then count categories by status.
- Recurring expense due day is clamped from `1` to `31` and then clamped again to the number of days in the target month.

### Payroll, Shifts, And Staff Metrics

- Pay statement regular hours combine regular input hours and legacy overtime hours.
- Current generated overtime pay is `0`, and generated overtime multiplier is `1`.
- If hourly rate is positive and explicit gross pay is not supplied, `regularPay = regularHours * hourlyRate` and `grossPay = regularPay + bonus`.
- If explicit gross pay is supplied, `regularPay = max(grossPay - bonus, 0)`.
- Net pay is explicit net pay when supplied; otherwise `max(grossPay - deductions, 0)`.
- Payroll editor base pay before bonus is `max(initialGrossPay - initialBonusAmount, 0)`.
- Projected gross payroll is `basePayBeforeBonus + newBonusAmount`.
- Projected net payroll is `max(projectedGross - totalDeductions, 0)`.
- Payroll period analysis groups pay statements by period, then sums gross pay, deductions, and net pay while counting employees.
- Employee year-to-date metrics sum paid gross, deductions, net pay, and bonuses.
- Employee average net pay is `yearToDateNetPay / paidPayCycles`.
- Employee deduction rate is `yearToDateDeductions / yearToDateGrossPay`.
- Shift duration is calculated from local start and end times, supports overnight shifts, converts milliseconds to hours, and rounds to two decimals.
- Scheduled shift hours are `max(durationHours - unpaidBreakMinutes / 60, 0)`.
- Open shift hours are calculated from clock-in time to the current reference time.
- Attendance flags use thresholds of `10` minutes late, `15` minutes missed clock-out after scheduled end, `10` minutes early finish, and overtime above scheduled hours by more than `0.25` hours.
- Finalized payroll shift hours sum verified closed shifts by date.
- Staff dashboard averages include active staff count, average hourly rate, and average permission count per staff member.

### Inventory, Margins, And Product Risk

- Product margin percent is `(price - cost) / price * 100`, with `0` margin when price is not positive.
- Inventory value is `sum(productCost * quantityOnHand)`.
- Inventory status is `Backorder` when quantity is `<= 0`, `Critical` when quantity is `<= max(1, floor(reorderLevel / 2))`, `Reorder` when quantity is `<= reorderLevel`, and `Healthy` otherwise.
- Replenishment need is `max(reorderLevel * 2 - quantityOnHand, 0)`.
- Product days of cover is `quantityOnHand / dailyVelocity` when daily velocity is positive.
- Category coverage average is the average of `quantityOnHand / max(dailyVelocity, 1)`.
- Coverage progress percent is `min(round(daysCover / 14 * 100), 100)`.
- Inventory priority score is `stockStatusPriority * 100 + max(targetMargin - currentMargin, 0)` plus vendor cost-risk boosts.
- Vendor cost-risk boosts add `50` for same-vendor cost increases and `35` for cross-vendor cost differences.
- Manual product quantity updates record movement quantity as `quantityAfter - quantityBefore`.
- Manual product movement total amount is `quantityDelta * unitCost`, rounded to cents.

### Reports, Dashboards, And Financial Analytics

- Sales series aggregate gross sales daily for `7` days, monthly for `12` months, and yearly for `4` years.
- Recent sales trends sum gross sales and sales line count by day.
- Payment breakdown percent is `paymentMethodAmount / totalPayments * 100`.
- Monthly financial revenue is `sum(order totals)`.
- Monthly cost of goods sold is `sum(productCost * quantity)` across order items.
- Monthly operating expense is approved expense total for the period.
- Monthly profit is `revenue - costOfGoodsSold - operatingExpense`.
- Monthly profit margin is `profit / revenue * 100`.
- Month-to-date gross profit is `revenue - costOfGoodsSold`.
- Month-to-date gross margin is `grossProfit / revenue * 100`.
- Month-to-date net profit is `grossProfit - approvedExpenses`.
- Month-to-date net margin is `netProfit / revenue * 100`.
- Expense category share is `categoryTotal / totalExpenseAmount * 100`.
- Expense category average is `categoryTotal / entryCount`.
- Margin reports calculate average margin, products below target, and low-margin products below `20%`.
- Vendor analysis uses posted payment spend, approved adjustment totals, average invoice amount, supplier reliability percent, open balance, and available credit.
- Top product reports group order items by product, then sum units and revenue.
- Product break-even profit per unit is `price - cost`.
- Product break-even inventory investment is `cost * max(quantityOnHand, 0)`.
- Product break-even units are `inventoryInvestment / profitPerUnit` when profit per unit is positive.
- Product break-even revenue is `breakEvenUnits * price`.
- Product current sales volume is units sold in the last `30` days.
- Product daily velocity is `currentSalesVolume / 30`.
- Product days to break even is `breakEvenUnits / dailyVelocity` when daily velocity is positive.
- Cost alert margin gap is `currentMargin - targetMargin`.
- Cost alert recommended price is `cost / (1 - targetMarginRatio)`.
- Cost alert severity is critical when current margin is `<= 0` or margin gap is `<= -10`; otherwise it is warning.
- Executive alerts count and sum overdue payables, supplier credits, low-margin products, delayed purchase orders, unreconciled sales, and draft expenses.
- Sales report average transaction is `totalSales / totalTransactions`.
- Profit report average margin averages period margins, best period chooses maximum margin, and year-to-date profit sums period profit.
- Payroll report average per employee is `totalGrossPay / employeeCount`.
- Payroll deduction rate is `totalDeductions / totalGrossPay * 100`.
- Vendor report average on-time score is the average supplier reliability percent.
- Report exports round numeric financial values to two decimals.

### Lottery, Scratch Cards, And EFT

- Lottery money values are normalized to cents, and commission rates are clamped to `0` through `100`.
- Scratch tickets sold are `endTicket - startTicket`.
- If a ticket reset is allowed, scratch ticket start becomes `000` and tickets sold use the ending ticket value.
- Scratch expected sales are `ticketsSold * ticketPrice`.
- Scratch short or over amount is `expectedSales - posSales`.
- Scratch status is short when the amount is positive, over when negative, and balanced when zero.
- End-of-day scratch audits use the prior ending ticket as the next starting ticket, except newly activated packs may reset when no previous sold audit exists.
- Final scratch ticket number is `ticketCount - 1`.
- Sold-out pack remaining tickets are `ticketLimit - startTicket`.
- Sold-out expected sales are `remainingTickets * ticketPrice`.
- Lottery expected cash is `max(openingCashFloat + scratchSales + terminalSales - ticketCancels - drawPayouts - scratchPayouts - cashingBonus, 0)`.
- Lottery short or over is `expectedCash - tillCash`.
- Lottery cash movement excluding float is `scratchSales + terminalSales - drawPayouts - scratchPayouts - cashingBonus - ticketCancels`.
- Lottery EFT net ticket sales are `grossSales - ticketCancels`.
- EFT retailer commission credit is `netTicketSales * retailerCommissionRate / 100`.
- EFT payout commission credit is `totalPayouts * payoutCommissionRate / 100`.
- EFT total commission is retailer commission plus payout commission.
- EFT total credits are `ticketCancels + totalPayouts + totalCommissions + promoCredits`.
- EFT net due is `netTicketSales - totalCommissions - totalPayouts - promoCredits + bondingFee + administrativeFees`.
- Dashboard scratch EFT sales include retired fully settled packs at `ticketCount * ticketPrice`, with reversal audits removing settlements.
- Gross lottery sales are `scratchSales + drawSales`.
- Lottery net sales are `max(grossLotterySales - ticketCancels, 0)`.
- Lottery payouts are `drawPayouts + scratchPayouts + cashingBonus`.
- Paid EFT amount uses explicit paid amount when non-negative; otherwise it uses calculated net EFT due.
- Lottery cash-in-hand timeline combines expected daily movement, cash advances, paybacks, lottery deposits, and paid EFT withdrawals in chronological order.
- Cash after EFT includes paid EFT withdrawals; available cash before EFT excludes paid EFT withdrawals.
- Cash advance impact is `paybacksReceived - advancesTaken`.
- Open cash advance balance is `max(advanceAmount - postedPaybacks, 0)`.
- Lottery report daily rows sum scratch sales, draw sales, gross sales, payouts, cancels, expected cash, counted cash, short/over amount, and tickets sold.
- Lottery report summary sums daily values and counts balanced, short, over, and pending days.
- Average daily lottery gross is `grossSales / numberOfDays`.
- Lottery game performance groups by game, sums calculated scratch revenue, estimates tickets sold as `round(scratchSales / ticketPrice)` when needed, and sorts by scratch sales.
- Lottery inventory pack value is `ticketCount * ticketPrice`.
- Returned lottery pack value is explicit returned value or `returnedTicketCount * ticketPrice`.

### Loss Prevention And Owner Controls

- Loss-prevention cash gap is `cashSales - sameDayDeposits`.
- Loss-prevention cash gap rows appear when `abs(cashGap) >= 1`.
- High-severity loss-prevention cash gaps use `abs(cashGap) >= 100`.
- Sales reconciliation variance rows appear when `abs(variance) >= 1`.
- High-severity sales variance uses `abs(variance) >= 100`.
- Owner command center today cash gap is `todayCashSales - todayDeposits`.
- Owner command center month metrics sum net sales, cash sales, and deposits from the start of the month.
- Owner total money due is `vendorDue + payrollDue + max(unpaidEftDue, 0)`.
- Owner attention items sort by severity score, then date.
- Deposit matching treats `abs(cashGap) < 1` as matched and gaps `>= 100` as red risk.

### Admin Utility Metrics

- Store health backup age is calculated from the latest backup timestamp in hours, floored at zero.
- Backup age display switches from hours to days and hours when age exceeds one day.
- Store health warning counts are derived from backup manifest warnings.

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Supabase Auth, Postgres, and Storage
- Gemini for vendor invoice extraction

## Requirements

- Node.js 20 or newer
- npm
- Supabase project
- Supabase CLI and Docker Desktop for local database backups
- Gemini API key for invoice extraction

## Environment Variables

Create `.env.local` from `.env.example` and set real values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | Canonical production URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side admin access for protected operations |
| `NEXT_PUBLIC_SUPABASE_PAYROLL_BUCKET` | Yes | Payroll document bucket, usually `payroll-documents` |
| `NEXT_PUBLIC_SUPABASE_VENDOR_INVOICE_BUCKET` | Yes | Vendor invoice bucket, usually `vendor-invoices` |
| `PRIVATE_ADMIN_LINK_TOKEN` | Recommended | Secret token for `/private-admin/[token]` |
| `PRIVATE_ADMIN_MASTER_PASSWORD` | Recommended | Master password for the private admin portal |
| `GEMINI_API_KEY` | Required for invoice extraction | Google Gemini API key |
| `GEMINI_INVOICE_MODEL` | Optional | Invoice extraction model, default `gemini-2.5-flash` |
| `SUPABASE_DB_URL` | Required for local backups | Supabase Postgres connection string used by `npm run backup:local` |
| `SUPABASE_BACKUP_DIR` | Optional | Local backup output folder, default `backups/supabase` |
| `SUPABASE_BACKUP_STORAGE_BUCKETS` | Optional | Comma-separated Storage buckets to download during backups |

Notes:

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported as a fallback, but `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is preferred.
- If `PRIVATE_ADMIN_LINK_TOKEN` and `PRIVATE_ADMIN_MASTER_PASSWORD` are missing, the private admin portal will stay disabled.

## Database Setup

Apply the SQL files in `supabase/migrations` in order.

Current migration set:

- `202604180001_auth_payroll_foundation.sql`
- `202604180002_backfill_profiles.sql`
- `202604180003_commerce_operations_foundation.sql`
- `202604180004_profiles_admin_management.sql`
- `202604180005_profiles_staff_fields.sql`
- `202604190001_hourly_payroll_fields.sql`
- `202604190002_shift_time_entries.sql`
- `202604190003_shift_overlap_constraint.sql`
- `202604190004_payroll_run_frequency_lock.sql`
- `202604190005_store_settings_configuration.sql`
- `202604200001_vendor_invoice_storage.sql`
- `202604200002_multi_store_foundation.sql`
- `202604210001_store_settings_store_backfill.sql`
- `202604210002_shift_verification_self_service.sql`
- `202604210003_general_expense_tracking.sql`
- `202604210004_vendor_adjustments.sql`
- `202604210005_vendor_adjustment_controls_inventory_ledger.sql`
- `202604220001_financial_controls_and_vendor_payment_status.sql`

If you use the Supabase CLI:

```bash
supabase db push
```

If you are not using the CLI, run the migration files in order in the Supabase SQL editor.

## Storage Setup

Create these Supabase Storage buckets:

- `payroll-documents`
- `vendor-invoices`

If you use different bucket names, update the matching env vars.

The `vendor-invoices` bucket also stores supplier adjustment attachments such as credit notes and return documents.

## Local Backups

Run a full local backup of Supabase Postgres and configured Supabase Storage buckets:

```bash
npm run backup:local
```

Use `npm run backup:db` for database-only dumps or `npm run backup:storage` for storage-only downloads.

See `docs/local-backups.md` for setup, scheduling, and restore steps.

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Useful validation commands:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Publish Guide

### Option 1: Deploy To Vercel

1. Push this project to GitHub.
2. Import the repo into Vercel.
3. Add all environment variables from `.env.example` in the Vercel project settings.
4. Set `NEXT_PUBLIC_APP_URL` to your real production domain.
5. Make sure your Supabase migrations have already been applied.
6. Make sure the storage buckets exist.
7. Deploy.

After deploy:

1. Open `/api/health` and confirm the service flags are `true` for the features you configured.
2. Confirm `storage.payrollDocuments` and `storage.vendorInvoices` are `true`.
3. Log in as an admin.
4. Set store settings and confirm the active store context is correct.
5. Test staff creation, invoice upload, approvals, vendor payments, shift logging, payroll document access, and report export.

### Option 2: Self-Host With Node

Build:

```bash
npm install
npm run build
```

Start:

```bash
npm run start
```

Run it behind a reverse proxy such as Nginx or Caddy and serve it over HTTPS.

### Production Checklist

- All env vars are set to real values
- Supabase migrations are fully applied
- Storage buckets exist
- At least one admin user can sign in
- Private admin token and password are configured if you need the private admin portal
- Invoice extraction works with a real Gemini key
- `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` pass before release
- Domain, HTTPS, and cookies are working in production

### Search Engine Note

This app is configured as a private ERP. It is intentionally no-indexed.

If you want a public site instead, review:

- `src/app/robots.ts`
- `src/app/layout.tsx`

## User Manual

### Login And Store Access

- Users sign in at `/auth/login`.
- Admins can be required to choose an active store before using store-scoped pages.
- Most operational data is filtered by the active store.

### Admin And Manager Workflow

#### 1. Staff Management

Go to `/admin/staff`.

Use this page to:

- Create staff accounts
- Assign roles
- Assign store access
- Set employee details such as department, position title, employee number, pay frequency, and manager name
- Let admins set the initial password at creation time

#### 2. Shift Management

Go to `/admin/shift-management`.

Use this page to:

- Review staff clock in / clock out activity
- Verify automatic shift logs
- Keep manual payroll entries separate from clock logs
- Add manual payroll shifts for payroll processing

Important:

- Automatic shift logs are for attendance.
- Manual payroll entries are what payroll uses.

#### 3. Payroll

Go to `/payroll`.

Use this page to:

- Review recent payroll statements
- Change payroll status between draft, scheduled, and paid
- Delete payroll statements if needed

Employee payroll documents are generated from pay statements and are available to staff in their payroll area.

#### 4. Vendors And Invoices

Go to:

- `/vendors/directory`
- `/vendors/invoices`

Use these pages to:

- Manage suppliers
- Upload invoice files
- Review AI-extracted invoice data before saving
- Match invoice lines to existing supplier products or create new supplier products safely
- Record full or partial vendor payments with date, method, and reference details
- Void posted vendor payments instead of deleting them so the audit trail stays intact
- Save supplier returns, credit notes, shortages, rebates, and other deductions as drafts or approve them immediately
- Attach supplier credit notes, return authorizations, and supporting evidence to adjustments
- Void approved adjustments instead of deleting them so the audit trail stays intact
- Let invoice balance, overdue state, and paid state update automatically from the invoice ledger
- Apply inventory-impact supplier returns so stock is reduced when goods are sent back
- Download a vendor ledger export with invoices, posted payments, approved adjustments, and running balances

Invoice extraction notes:

- Supported files: PDF, PNG, JPG, WEBP
- Max file size: 10 MB
- Multi-page PDFs can be uploaded
- Review the warning banner if totals do not reconcile, especially on multi-page PDFs

#### 5. Expenses

Go to `/admin/expenses`.

Use this page to:

- Track store-level operating expenses
- Approve expenses that should count toward profit reporting
- Keep draft expenses out of net profit until they are approved

#### 6. Approval Queue

Go to `/admin/approvals`.

Use this page to:

- Approve draft supplier adjustments
- Approve draft expenses
- Review the oldest pending finance work first

#### 7. Accounting Controls

Go to `/admin/settings`.

Use the `Accounting controls` section to:

- Close books through a store-specific date
- Block edits, approvals, voids, and deletions inside closed accounting periods
- Reopen a period by clearing or changing the close-through date

#### 8. Products And Margins

Go to `/products/margin-engine`.

Use this page to:

- Review product costs and sell prices
- Edit the product margin ledger
- Open margin checks from invoice lines when pack sizes are known

#### 9. Sales

Go to `/sales/daily-entry` and `/admin/sales-logs`.

Use these pages to:

- Enter daily sales
- Review and reconcile sales days
- Audit store sales history

#### 10. Reports

Go to `/admin/reports` or the individual report pages.

Available reporting includes:

- Executive dashboard
- Sales
- Profit
- Margin analysis
- Vendor analysis
- Payroll analysis
- Employee payroll

Reports can be downloaded, including the raw vendor ledger export.

### Employee Workflow

#### My Shift

Go to `/shifts`.

Employees can:

- Clock in
- Clock out
- Review their automatic shift history
- View manual payroll entries separately

#### My Profile

Go to `/employee/profile`.

Employees can:

- Review their profile details
- Add or update their own bank details

#### Earnings

Go to `/employee/payroll`.

Employees can:

- Review pay statements
- Open payroll documents

### Accountant Workflow

Accountants can access vendor invoices, expenses, reports, and payroll-related reporting without needing full admin access.

### Private Admin Portal

If configured, the private admin portal is available at:

```text
/private-admin/<PRIVATE_ADMIN_LINK_TOKEN>
```

Use it for high-trust administration tasks. Access requires:

- The correct link token
- The configured master password

## Recommended Release Process

1. Pull the latest code.
2. Run `npm install`.
3. Run `npm run lint`.
4. Run `npm run typecheck`.
5. Run `npm run build`.
6. Apply new Supabase migrations.
7. Verify environment variables in the deployment platform.
8. Deploy.
9. Smoke test login, store selection, staff creation, shifts, payroll, invoices, expenses, approvals, and reports.

## Troubleshooting

### Invalid Refresh Token

If you see refresh token errors, the browser may still hold stale Supabase auth cookies. Reload once or sign out and back in.

### Invoice Extraction Fails

Check:

- `GEMINI_API_KEY`
- file size under 10 MB
- file type is supported
- outbound network access from your server

### Private Admin Portal Returns 503

Set:

- `PRIVATE_ADMIN_LINK_TOKEN`
- `PRIVATE_ADMIN_MASTER_PASSWORD`

### Reports Or Store Data Look Wrong

Confirm:

- the correct active store is selected
- all store-related migrations were applied
- the affected records have the correct `store_key`

### Accounting Period Lock Blocks A Change

If a vendor invoice, vendor payment, supplier adjustment, or expense cannot be changed, check the `Accounting controls` close-through date in `/admin/settings`. Reopen the period there before retrying the action.

## Current Validation Status

The current codebase passes:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

The repo now includes unit coverage for vendor accounting helpers and related business logic.
