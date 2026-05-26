# TYson Office UAT Checklist

Use this document for structured user acceptance testing before release, after major feature work, and after Supabase migration changes.

## 1. Test Session Record

- Test date:
- Environment:
- Build / commit:
- Tester:
- Store under test:
- Secondary store for isolation checks:

## 2. Status Legend

Mark one status for each scenario:

- `[ ] Pass`
- `[ ] Fail`
- `[ ] N/A`

If a scenario fails, log the defect using the template at the end of this file.

## 3. Preflight Checklist

- [ ] Production-like `.env.local` values are present
- [ ] Latest Supabase migrations are applied
- [ ] `payroll-documents` bucket exists and is accessible
- [ ] `vendor-invoices` bucket exists and is accessible
- [ ] Test users exist for `admin`, `manager`, `accountant`, `cashier`, `warehouse`, and `employee`
- [ ] At least two stores exist with distinct data
- [ ] Browser console is open during testing

## 4. Automated Validation

Run before manual UAT:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Optional browser smoke:

```bash
npx playwright install chromium
npm run test:e2e
```

Expected result:

- All commands pass
- No auth/bootstrap errors appear
- `/api/health` reports healthy configured services

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Notes:

---

## 5. UAT Scenarios

### UAT-001 Admin Access

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: `admin`

Steps:

1. Log in as `admin`.
2. Confirm redirect goes to store selection.
3. Select a store.
4. Open `/admin/dashboard`.
5. Open `/admin/settings`.
6. Open `/admin/audit-logs`.
7. Open `/admin/staff`.
8. Open `/vendors/invoices`.
9. Open `/payroll`.
10. Open `/reports/profit`.
11. Open `/inventory`.

Expected result:

- Admin can reach all listed pages.
- No unauthorized redirect occurs.
- No console errors appear.

Notes:

### UAT-002 Manager Access

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: `manager`

Steps:

1. Log in as `manager`.
2. Confirm redirect goes to `/admin/dashboard`.
3. Open `/admin/dashboard`, `/admin/staff`, `/admin/shift-management`, `/vendors/invoices`, `/payroll`, and `/reports/sales`.
4. Try to open `/admin/settings`, `/admin/audit-logs`, and `/admin/store-selection`.

Expected result:

- Manager can access the allowed operations pages.
- Restricted pages deny access or redirect appropriately.
- No protected finance/admin page loads incorrectly.

Notes:

### UAT-003 Accountant Access

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: `accountant`

Steps:

1. Log in as `accountant`.
2. Confirm redirect goes to `/admin/approvals`.
3. Open `/admin/approvals`, `/vendors/invoices`, `/payroll`, and `/reports/vendor-analysis`.
4. Try to open `/admin/staff`, `/admin/settings`, and `/admin/dashboard`.

Expected result:

- Accountant can access approvals, vendor, payroll, and reports.
- Restricted staff/settings/dashboard pages do not open.

Notes:

### UAT-004 Cashier Access Restriction

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: `cashier`

Steps:

1. Log in as `cashier`.
2. Confirm redirect goes to `/sales/daily-entry`.
3. Use the sales entry screen normally.
4. Try to open `/admin/dashboard`, `/vendors/invoices`, `/payroll`, and `/reports/sales`.

Expected result:

- Cashier can use sales entry.
- Cashier cannot reach admin, vendor, payroll, or reports pages.

Notes:

### UAT-005 Warehouse Access Restriction

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: `warehouse`

Steps:

1. Log in as `warehouse`.
2. Confirm redirect goes to `/inventory`.
3. Open `/inventory` and `/shifts`.
4. Try to open `/admin/dashboard`, `/vendors/invoices`, `/payroll`, and `/reports/profit`.

Expected result:

- Warehouse can access inventory and shifts.
- Warehouse cannot reach restricted finance/admin areas.

Notes:

### UAT-006 Employee Self-Service Access

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: `employee`

Steps:

1. Log in as `employee`.
2. Confirm redirect goes to `/employee/payroll`.
3. Open `/employee/payroll`, `/employee/profile`, and `/shifts`.
4. Update bank details in the profile.
5. Try to open `/admin/dashboard`, `/vendors/invoices`, `/payroll`, and `/reports/payroll-analysis`.

Expected result:

- Employee can access payroll, profile, and shifts only.
- Bank details save successfully.
- Restricted areas remain blocked.

Notes:

### UAT-007 Store Isolation

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Precondition:

- `Store A` and `Store B` both exist.

Steps:

1. In `Store A`, create one vendor invoice, one expense, one payroll statement, and one manual payroll shift.
2. Switch to `Store B`.
3. Open vendor invoices, expenses, payroll, reports, and shifts.

Expected result:

- `Store A` records do not appear in `Store B`.
- Totals and exports remain store-scoped.

Notes:

### UAT-008 Sales Entry Create And Edit

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: `cashier` or `admin`

Steps:

1. Log one payment entry for today.
2. Log one product entry for today.
3. Edit one unreconciled entry from today.
4. Refresh the page.

Expected result:

- Both entries save successfully.
- Edited values persist after refresh.
- Updated totals reflect the edit.

Notes:

### UAT-009 Sales Reconcile And Reverse

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: `admin`

Steps:

1. Reverse one unreconciled same-day sales entry.
2. Confirm the reversal row is created.
3. Reconcile the day.
4. Attempt to reverse a reconciled entry.

Expected result:

- Original row remains in history.
- Reversal row is a separate offsetting entry with opposite amount.
- Net totals reconcile correctly.
- Reversal of reconciled sales is blocked.

Notes:

### UAT-010 Staff Create, Update, Deactivate

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Roles: `admin`, `manager`

Steps:

1. As `admin`, create a staff member with a custom password.
2. Confirm staff profile fields save, including department, position, employee number, pay frequency, and manager.
3. As `manager`, edit that staff profile.
4. As `admin`, deactivate the staff member.
5. Attempt login with that deactivated account.

Expected result:

- Staff account is created successfully.
- Profile updates persist.
- Deactivation changes status to inactive.
- Login is revoked.
- Employee record remains visible for history.

Notes:

### UAT-011 Shift Clocking And Manual Payroll Entries

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Roles: `employee`, `admin`

Steps:

1. As staff, clock in.
2. As staff, clock out.
3. As `admin`, verify the shift.
4. Add a manual payroll shift for the same employee.
5. Open the admin shift screen.
6. Open the employee shift screen.

Expected result:

- Clock logs and manual payroll entries are shown in separate lists.
- `Hours Today` reflects clocked time only.
- Manual entries remain available for payroll but do not mix into clocked-hours totals.

Notes:

### UAT-012 Regular Payroll Lifecycle

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: `admin`, `manager`, or `accountant`

Steps:

1. Create manual payroll shifts for one employee.
2. Generate a payroll statement.
3. Change status from `Draft` to `Scheduled`.
4. Change status from `Scheduled` to `Paid`.
5. Archive the payroll statement from the table action.
6. Open the employee payroll page.

Expected result:

- Payroll statement is generated successfully.
- Status changes save correctly.
- Archived payroll remains visible and read-only.
- Employee can open the payroll document.

Notes:

### UAT-013 Off-Cycle Payroll And Overlap Control

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: `admin`, `manager`, or `accountant`

Steps:

1. Create an off-cycle payroll for one employee using a date range with manual shifts.
2. Attempt to create another payroll for the same employee with an overlapping range.
3. Attempt to create an off-cycle payroll for a range with no manual shifts.

Expected result:

- Valid off-cycle payroll is created.
- Overlapping payroll creation is blocked.
- Empty-range payroll creation shows a clear error.

Notes:

### UAT-014 Expenses Draft, Approve, Void

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Roles: creator plus separate approver

Steps:

1. Create a draft expense.
2. Try to approve it as the same user who created it.
3. Approve it as a different authorized user.
4. Void the approved expense.
5. Open profit reporting.

Expected result:

- Expense starts as draft.
- Self-approval is blocked.
- Approved expense affects reporting.
- Voided expense remains in ledger but no longer affects net profit.

Notes:

### UAT-015 Vendor Directory Lifecycle

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: vendor manager role

Steps:

1. Add a vendor.
2. Edit the vendor.
3. Deactivate the vendor from the action button.
4. Refresh the vendor directory.

Expected result:

- Vendor create and update save correctly.
- Deactivated vendor remains listed with inactive status.
- Vendor is not hard-deleted.

Notes:

### UAT-016 Vendor Invoice Intake And Cancel

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: vendor manager role

Steps:

1. Upload a supplier invoice PDF.
2. Review extracted items and product matches.
3. Save the invoice.
4. Confirm the invoice appears in history.
5. Cancel an invoice that has no posted payments and no active adjustments.
6. Reopen the invoice history list.

Expected result:

- Invoice upload succeeds.
- Review screen warns if extracted totals do not reconcile.
- Invoice saves with the correct supplier and amount.
- Cancelled invoice remains in history with status `cancelled`.
- Source PDF remains available.

Notes:

### UAT-017 Vendor Payments

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: vendor manager role

Steps:

1. Record a partial posted payment against an invoice.
2. Confirm invoice balance updates.
3. Void the payment.
4. Refresh the invoice and payment history.

Expected result:

- Posted payment appears in payment history.
- Invoice balance reflects the payment.
- Voided payment remains visible with `void` status.
- Invoice balance recalculates after void.

Notes:

### UAT-018 Supplier Adjustments And Inventory Impact

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Roles: creator plus separate approver

Steps:

1. Create a draft supplier adjustment.
2. Try to approve it as the creator.
3. Approve it as a different authorized user.
4. If inventory impact is enabled, confirm stock changes.
5. Void the approved adjustment.
6. Recheck stock and invoice balance.

Expected result:

- Adjustment starts as draft.
- Self-approval is blocked.
- Approved adjustment affects payable balance.
- Inventory impact applies on approval and reverses on void.
- Adjustment remains in the ledger.

Notes:

### UAT-019 Reports And CSV Exports

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Role: authorized reporting user

Steps:

1. Download CSVs for dashboard, sales, profit, margin, vendor, payroll analysis, and employee payroll.
2. Open each CSV.
3. Compare each export against the on-screen totals.

Expected result:

- Each report downloads successfully.
- Headers are present.
- Store-scoped data matches the UI.
- Cancelled, voided, and archived records follow business rules in exports.

Notes:

### UAT-020 Audit Log Coverage

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Precondition:

- Perform at least one action from sales, payroll, expenses, vendor invoices, vendor payments, vendor updates, employee updates, and supplier adjustments.

Steps:

1. Open `/admin/audit-logs`.
2. Find the events created during this test run.
3. Verify actor name, role, summary, and metadata accuracy where shown.

Expected result:

- Audit log contains entries for the tested operational and finance mutations.
- No critical workflow from this UAT session is missing from the ledger unexpectedly.

Notes:

### UAT-021 Compatibility And Migration State

Status:

- [ ] Pass
- [ ] Fail
- [ ] N/A

Steps:

1. Visit dashboard, vendors, payroll, inventory, approvals, and reports after deploy.
2. Look for any compatibility-mode warning banner.

Expected result:

- No compatibility warning appears when migrations are current.
- If warning appears, treat it as a schema/deployment mismatch and do not sign off.

Notes:

## 6. Final Release Sign-Off

Mark only after all applicable scenarios above are complete.

- [ ] `lint` passed
- [ ] `typecheck` passed
- [ ] `test` passed
- [ ] `build` passed
- [ ] Role access verified
- [ ] Store isolation verified
- [ ] Sales lifecycle verified
- [ ] Payroll lifecycle verified
- [ ] Expense approval flow verified
- [ ] Vendor AP flow verified
- [ ] Reports and exports verified
- [ ] Audit coverage verified
- [ ] No critical console errors
- [ ] No compatibility warnings
- [ ] Ready for release

Sign-off notes:

## 7. Defect Log Template

Copy this block for each failed scenario:

```text
Title:
Scenario ID:
Environment:
User role:
Store:
Page / route:
Steps to reproduce:
Expected result:
Actual result:
Screenshot / console error:
Severity:
Owner:
```
