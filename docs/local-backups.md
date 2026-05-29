# Local Supabase Backups

This app stores operational data in Supabase Postgres and documents in Supabase Storage. A hosting outage for the Next.js app should not delete Supabase data, but a suspended/deleted Supabase project or provider failure can. Keep an offline copy you control.

## Recommended Strategy

1. Keep the Supabase migrations in git.
2. Run `npm run backup:local` from a trusted office computer or server every day.
3. Copy the generated `backups/supabase/<timestamp>` folder to another device or cloud drive.
4. Periodically test restore into a separate Supabase project.

For important business data, the strongest option is a paid Supabase plan with managed backups or PITR plus this local export. The local export protects you if the cloud account disappears; managed backups protect you from accidental bad writes and short recovery windows.

## What Gets Backed Up

- `database/roles.sql`
- `database/schema.sql`
- `database/data.sql`
- Files from the configured Supabase Storage buckets
- `manifest.json` with backup contents and warnings

The database dump is created with the Supabase CLI because it wraps `pg_dump` with Supabase-compatible filters.

## Setup

Install the Supabase CLI and Docker Desktop. The CLI uses Docker for database dumps.

Add these values to `.env.local`:

```bash
SUPABASE_DB_URL="postgresql://postgres.<project-ref>:<db-password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
SUPABASE_BACKUP_DIR=backups/supabase
SUPABASE_BACKUP_STORAGE_BUCKETS=payroll-documents,vendor-invoices,expense-documents
```

`SUPABASE_DB_URL` should be the Session Pooler connection string from Supabase Dashboard > Connect. Replace the password placeholder with the database password.

## Run A Backup

```bash
npm run backup:local
```

Database only:

```bash
npm run backup:db
```

Storage files only:

```bash
npm run backup:storage
```

Backup files are intentionally ignored by git.

## Schedule Daily On macOS

Use `crontab -e` and add a line like this, adjusting the project path and npm path if needed:

```cron
0 2 * * * cd "/Users/tyson/Downloads/Tyson-office-main 2" && /usr/local/bin/npm run backup:local >> "$HOME/tyson-office-backups.log" 2>&1
```

If `npm` is somewhere else, run `which npm` and use that path.

## Restore Database

Create a new Supabase project, enable any required extensions, then restore with `psql`:

```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file backups/supabase/<timestamp>/database/roles.sql \
  --file backups/supabase/<timestamp>/database/schema.sql \
  --command "SET session_replication_role = replica" \
  --file backups/supabase/<timestamp>/database/data.sql \
  --dbname "$NEW_SUPABASE_DB_URL"
```

After restoring the database, upload the backed-up storage files from `backups/supabase/<timestamp>/storage` to matching buckets in the new Supabase project. For large buckets, use Supabase Storage S3 access with `rclone`, AWS CLI, or another S3-compatible client.

## Security Notes

- Never commit `.env`, `.env.local`, or `backups/`.
- The `SUPABASE_SERVICE_ROLE_KEY` can read private storage files. Keep local backups encrypted if they leave the office machine.
- Rotate any keys that were ever committed or shared.
