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
