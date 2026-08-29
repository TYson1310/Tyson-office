# Push Vendor Invoice With Playwright

This script logs into the app with a real user session, then posts an invoice to `POST /api/vendor-invoices`.

## File

- `scripts/push-invoice-playwright.mjs`

## Required environment variables

- `APP_BASE_URL` (example: `http://localhost:3000`)
- `APP_EMAIL`
- `APP_PASSWORD`
- `INVOICE_JSON_PATH` (required)

## Expected invoice JSON shape

The script maps from the extracted JSON format you shared (fields such as `invoice_number`, `invoice_date`, `payment_due_date`, `vendor`, `bill_to`, `line_items`, `totals`, `discounts`, and `out_of_stock_items`).

## Dry run

```bash
APP_BASE_URL="http://localhost:3000"
APP_EMAIL="you@company.com"
APP_PASSWORD="your-password"
INVOICE_JSON_PATH="/absolute/path/to/invoice.json"
npm run invoice:push:playwright -- --dry-run
```

## Push invoice

```bash
APP_BASE_URL="http://localhost:3000"
APP_EMAIL="you@company.com"
APP_PASSWORD="your-password"
INVOICE_JSON_PATH="/absolute/path/to/invoice.json"
npm run invoice:push:playwright
```

## Optional flags

- `--invoice=/absolute/path/to/invoice.json`
- `--base-url=http://localhost:3000`
- `--email=you@company.com`
- `--password=your-password`
- `--headed` (shows browser)
- `--dry-run`
