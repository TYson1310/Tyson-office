# Supabase + Vercel Setup

## 1. Create the database

Use the Supabase integration in the Vercel Marketplace:

1. Open your Vercel project.
2. Go to `Storage`.
3. Install `Supabase`.
4. Pick the region closest to your Vercel deployment region.

Vercel will inject the environment variables into the project automatically.

## 2. Required environment variables

For local development, copy `.env.example` to `.env.local` and set:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
NEXT_PUBLIC_SUPABASE_PAYROLL_BUCKET=payroll-documents
```

## 3. Run the SQL

Run every file in `supabase/migrations` in filename order.

If you use the Supabase CLI:

```bash
supabase db push
```

If you are using the SQL editor, run the migration files in lexical order.

`supabase/seed.sql` and `supabase/seed_commerce.sql` are intentionally no-op placeholders now. Running the setup should not insert demo payroll, supplier, customer, order, or sales data.

## 4. Create your first users

Create your real users in Supabase Auth.

For the first admin user, include auth metadata like:

```json
{
  "role": "admin",
  "full_name": "Your Admin Name",
  "store_key": "default"
}
```

For non-admin users, omit `role` or set it to one of the supported roles (`manager`, `employee`, `cashier`, `warehouse`, or `accountant`). If `store_key` is omitted, the profile defaults to `default`.

When a user is created, the `handle_new_user()` trigger inserts the matching `public.profiles` row automatically.

If you created auth users before running the auth/profile migrations, run `202604180002_backfill_profiles.sql` once to create any missing `public.profiles` rows.

## 5. Storage structure

Use these Supabase Storage buckets:

- `payroll-documents`
- `vendor-invoices`

Recommended payroll folder layout:

```text
payroll-documents/
  <auth-user-id>/
    pay-statement-2026-04-11.pdf
    deposit-advice-2026-04-11.pdf
```

The app generates signed URLs server-side for the current employee's documents.

## 6. Current migration scope

The current migration set makes these parts production-ready:

- Authentication session handling
- Employee profile lookup and profile updates
- Employee payroll statements and payroll document metadata
- Home dashboard KPIs and sales chart
- Daily sales entry and closeout persistence
- Customers, suppliers, orders, inventory, vendor invoices, vendor payments, and expense data
- Supplier dues and payroll dues panels
- Store, store settings, and storage-bucket bootstrap records required by the app

The migrations do not insert demo business data. After setup, create live records through the app or through your own environment-specific scripts.
