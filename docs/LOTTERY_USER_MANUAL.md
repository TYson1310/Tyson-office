# Lottery Management System - User Manual & Workflow Guide

## Table of Contents

1. [Overview](#overview)
2. [Key Concepts](#key-concepts)
3. [Lottery Dashboard](#lottery-dashboard)
4. [Workflows](#workflows)
   - [Daily End-of-Day Reconciliation](#daily-end-of-day-reconciliation)
   - [EFT Management](#eft-electronic-funds-transfer-management)
   - [Cash Advances](#cash-advances)
   - [Scratch Pack Settlements](#scratch-pack-settlements)
5. [Reports & Analytics](#reports--analytics)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The Lottery Management System is an integrated module within TYson Office ERP that handles day-to-day lottery operations, including:

- **Scratch card inventory management** and sales reconciliation
- **End-of-day (EOD) reconciliation** for accurate lottery cash accounting
- **Electronic Funds Transfer (EFT) management** for lottery settlements with state authorities
- **Cash advances** for lottery operations and inventory replenishment
- **Performance reporting** for lottery game analysis and historical tracking
- **Pack settlements** for scratch card inventory movements

This system ensures accurate cash accounting, compliance with state lottery requirements, and clear financial visibility for lottery operations.

---

## Key Concepts

### Scratch Cards

Scratch cards are lottery tickets sold to customers. Each scratch card has:
- A unique pack number
- Denomination (ticket price)
- Game name and ID
- Quantity in a pack (typically 25, 30, or more cards)
- Cost and selling price information

### Cash Sources

The lottery system tracks two distinct cash sources:
1. **Store Till** - Regular retail sales and cash operations
2. **Lottery Till** - Cash specifically from lottery ticket sales

This separation ensures clear accounting and settlement with lottery authorities.

### Pack Inclusions (EFT)

When scratch card packs are included for EFT (Electronic Funds Transfer) settlement, they are marked as "included" and:
- Are set aside for settlement with state authorities
- Cannot be reversed until the settlement period closes
- Generate the payout amounts due to customers

### Settlement Status

Packs can have the following statuses in the EFT system:
- **Active** - Available for sale, not yet included in settlement
- **Included** - Set aside for EFT settlement with authorities
- **Settled** - Payment received from authorities
- **Reversed** - Reversal of a previously included pack

### Cash Accounting

The system uses specific transaction types to track lottery cash movement:
- `lottery_cash_advance_to_vault` - Money advanced from lottery till to store vault
- `lottery_cash_advance_payback_from_vault` - Money returned from vault to lottery till
- `lottery_till_close` - Closing balance of lottery till on a given day
- `bank_deposit_lottery` - Deposit of lottery cash to bank

---

## Lottery Dashboard

### Accessing the Lottery Dashboard

Navigate to **Lottery > Dashboard** from the main menu.

### Dashboard Components

#### 1. **Inventory Summary**
Displays real-time scratch card inventory information:
- **Total Packs on Hand** - Current number of scratch card packs in inventory
- **Total Inventory Value** - Total cost value of all packs held
- **Active Packs** - Packs available for sale
- **Included Packs** - Packs set aside for EFT settlement

#### 2. **Scratch Ledger**
Shows the detail of scratch card inventory movements:
- Pack opening/closing balances
- Pack additions (new inventory received)
- Pack inclusions (packs set aside for settlement)
- Pack reversals (if needed)
- Settlement dates and amounts

#### 3. **Cash Summary**
Displays key lottery cash metrics:
- **Opening Cash** - Starting lottery cash balance for the current period
- **Total Sales** - Cash received from scratch card sales
- **Cash Advances** - Money advanced from lottery operations to other areas
- **Current Cash Balance** - Current lottery till balance
- **Reconciliation Status** - Whether daily reconciliation is complete

#### 4. **Source Information**
Shows which store location the data is from (store-scoped).

---

## Workflows

### Daily End-of-Day Reconciliation

**Purpose:** Verify that lottery cash received matches the scratch cards sold at the end of each business day.

#### Step 1: Navigate to Reconciliation

1. Go to **Lottery > EOD Reconciliation**
2. Select the date you want to reconcile (default is today)
3. If you're an admin, you can select a past date by clicking the date picker

#### Step 2: Verify Inventory

The system displays:
- **Opening Packs** - Number of packs at the start of the day
- **Packs Sold** - Scratch cards sold during the day
- **Closing Packs** - Remaining packs at end of day
- **Packs Included in Settlement** - Packs set aside for EFT

**Action:** Confirm the physical inventory matches the system records. If there are discrepancies, document them.

#### Step 3: Verify Cash

The reconciliation shows:
- **Opening Till Balance** - Cash at start of day
- **Cash From Sales** - Money from scratch card sales during the day
- **Cash Advances** - Any money taken out for operations
- **Expected Closing Balance** - Calculated expected cash
- **Actual Cash Counted** - Physical cash count
- **Variance** - Difference between expected and actual
- **Variance %** - Variance as a percentage of expected cash

**Action:** Count the physical cash in the lottery till and enter the actual amount. The system will calculate and display any variance.

#### Step 4: Reconciliation Rules

For successful reconciliation:
- If variance is **≤ $0.01**, reconciliation is **automatically approved**
- If variance is **> $0.01**, a manager or admin must review and approve the discrepancy
- Once approved, the EOD reconciliation is locked and cannot be edited

#### Step 5: Variance Resolution

If you have a variance:
1. **Double-check your count** - Recount the physical cash
2. **Review the daily records** - Check for any missing sales entries
3. **Investigate adjustments** - Look for any manual adjustments made during the day
4. **Document the variance** - Add a note explaining the discrepancy
5. **Seek approval** - Have a manager or admin approve the variance before moving forward

**Example:** If expected cash is $1,500.00 but you counted $1,500.05, the variance of $0.05 exceeds the $0.01 tolerance and requires approval.

#### Step 6: Post Reconciliation

Once reconciliation is approved, the system:
- Locks the day's data from further edits
- Records the official closing cash balance
- Updates inventory balances
- Prepares data for reporting and EFT settlement

---

### EFT (Electronic Funds Transfer) Management

**Purpose:** Prepare lottery cash settlements with state authorities and track payment status.

#### Step 1: Access EFT Management

1. Go to **Lottery > EFT (Electronic Funds Transfer)**
2. Select the settlement period (sweep) and time window using filters
3. View the list of scratch card packs and their settlement status

#### Step 2: Understand the EFT Data

The EFT page displays daily rows showing:
- **Date** - The business day
- **Packs Sold** - Number of scratch card packs sold that day
- **Sales Amount** - Total revenue from scratch card sales
- **Payout Due** - Amount owed to customers (based on winning cards)
- **Settlement Status** - Whether the day is included in EFT settlement
- **Payment Status** - Whether payment from authorities has been received
- **Net Amount Due** - Net cash due to/from state authorities

#### Step 3: Include Packs for Settlement

To mark packs for EFT settlement (inclusion):

**Single Pack Inclusion:**
1. Click the **"Include"** button on the desired date row
2. Confirm the action
3. The pack(s) for that day are now set aside for settlement

**Bulk Pack Inclusion:**
1. Click **"Include All Unincluded"** button at the top
2. Select the date range for bulk inclusion
3. Confirm - all unincluded packs in the range will be marked for settlement
4. The system will display a summary of included packs and totals

**What happens when you include packs:**
- Packs are marked as "included" in the ledger
- Payout amounts are calculated and locked
- The settlement amount is generated for submission to authorities
- Included packs cannot be sold or reversed (until reversal is explicitly processed)

#### Step 4: Monitor Payment Status

After packs are included, track payment status:

- **Status: Pending** - Packs included but payment not yet received
- **Status: Paid** - State authorities have paid the settlement amount
- **Status: Partial** - Partial payment received (rare, but possible)

**To Mark Payment Received:**
1. Click the **"Mark as Paid"** button once payment is received
2. Enter the payment date (system defaults to current date)
3. Optionally enter the payment amount if different from expected
4. Confirm the action

Once marked as paid, packs are considered "settled" and are no longer pending.

#### Step 5: Handle Pack Reversals

If you need to reverse a previously included pack (rare circumstances):

1. Click the **"Reverse Pack"** button on an included pack
2. Select a reversal reason from the dropdown:
   - **Damaged Pack** - Pack received damaged
   - **Inventory Adjustment** - Correction to inventory records
   - **Settlement Correction** - Correction to settlement amount
   - **Other** - Manually specify another reason
3. Enter any additional notes
4. Confirm the reversal

**Important:** Pack reversals should only be done with manager/admin approval and must be documented for audit purposes.

#### Step 6: Monitor EFT Summary

The page displays summary metrics:
- **Total Included Packs** - Number of packs currently set aside for settlement
- **Total Settlement Amount** - Total money due to/from authorities
- **Paid Amount** - Total payments received so far
- **Pending Amount** - Still awaiting payment
- **Sweep Status** - Overall status of the settlement period

---

### Cash Advances

**Purpose:** Manage cash movements between the lottery till and the main store vault.

#### Accessing Cash Advances

Cash advances for lottery operations are managed through:
- **Admin > Bank Deposits** - Look for the "Lottery Cash Advances" section
- Alternatively: Navigate to **Lottery > Cash Advances** (redirects to bank deposits)

#### Types of Lottery Cash Advances

1. **Advance To Vault** (Lottery Till → Store Vault)
   - Money being removed from lottery operations to the main store vault
   - Example: Depositing lottery cash collected
   - Reduces lottery till balance

2. **Payback From Vault** (Store Vault → Lottery Till)
   - Money being returned from vault to lottery operations
   - Example: Restocking lottery till with opening float
   - Increases lottery till balance

#### Submitting a Cash Advance

1. Go to **Admin > Bank Deposits**
2. Scroll to "Lottery Cash Advances" section
3. Click **"Add Cash Advance"** button
4. Fill in the form:
   - **Type**: Select "To Vault" or "From Vault"
   - **Amount**: Enter the cash amount
   - **Date**: Select the transaction date
   - **Notes**: Add any relevant notes (optional)
5. Click **"Submit"** or **"Request Approval"** depending on your role
6. If required, manager approves the pending request
7. Once approved, the transaction is recorded in the cash vault ledger

#### Viewing Cash Advance History

In the Bank Deposits section:
- View all pending cash advance requests
- See approval status
- Track historical cash advances
- Verify posted amounts

#### Cash Advance Impact

When a cash advance is recorded:
- Lottery till balance is updated accordingly
- Store vault balance reflects the movement
- Transaction appears in cash vault activity report
- Amount is available for bank deposit if moving to vault

---

### Scratch Pack Settlements

**Purpose:** Track the movement and settlement of scratch card inventory.

#### Settlement Workflow

Scratch packs follow this lifecycle:

```
New Packs Received
        ↓
Active Inventory (Available for Sale)
        ↓
Included for EFT Settlement
        ↓
Settlement with Authorities
        ↓
Closed/Settled
```

#### Key Settlement Metrics Tracked

For each settlement batch, the system tracks:
- **Packs Included** - Number of packs set aside
- **Sales Amount** - Gross sales from those packs
- **Customer Payouts** - Amount due to customers on winning cards
- **State/Authority Fees** - Any fees charged
- **Net Settlement Amount** - Amount due to or from authorities
- **Payment Date** - When payment was received
- **Settlement Status** - Complete, pending, or adjusted

#### Viewing Settlement Details

1. Go to **Lottery > EFT**
2. Select a date range to view
3. Each daily row shows settlement information
4. Click on a specific date for detailed pack information
5. View associated payout and settlement amounts

#### Reconciling Settlements

After authorities provide a settlement statement:

1. Go to **Lottery > Reports** to view detailed game performance
2. Cross-reference the statement amounts with system records
3. Identify any discrepancies
4. If adjustments are needed:
   - Contact the settlement administrator
   - Request a reversal or adjustment
   - Document the correction reason
5. Update the payment status once reconciliation is complete

---

## Reports & Analytics

### Accessing Lottery Reports

Navigate to **Lottery > Reports** to view comprehensive lottery performance data.

### Report Filters

**Date Range Selection:**
- **7 Days** - Last week's performance
- **14 Days** - Last two weeks (default)
- **30 Days** - Last month
- **90 Days** - Last quarter

**Custom Range:**
- Use the date picker to select a specific date range (1-90 days maximum)

### Report Metrics

#### Summary Metrics

- **Total Sales** - Gross revenue from scratch card sales in the period
- **Total Payouts** - Amount paid out to winners
- **Net Payout** - Sales minus payouts
- **Short/Over** - Difference between expected and actual settled amounts
- **Settlement Status** - Overview of pending vs. settled transactions

#### Daily Breakdown Table

Each row represents a business day and shows:

| Column | Description |
|--------|-------------|
| **Date** | Business day |
| **Packs Sold** | Number of scratch card packs sold |
| **Sales** | Total cash from sales |
| **Payouts** | Total owed to winners |
| **Net Amount** | Sales minus payouts |
| **Status** | Short/Balanced/Over |
| **Settlement** | Included/Pending/Settled |

#### Status Definitions

- **Balanced** - Sales and payouts reconcile correctly (Short/Over = $0.00)
- **Short** - More payouts than sales (negative Short/Over, indicates potential error)
- **Over** - More sales than payouts (positive Short/Over, normal variance)

### Game Performance Details

Expand the "Game Performance" section to see:

- **Game Name** - Lottery game title
- **Packs Sold** - Number of packs for this game
- **Total Sales** - Revenue from this game
- **Average Payout %** - Percentage of sales paid to winners
- **Trend** - Performance trend vs. previous period

### Exporting Reports

1. Click **"Download Report"** button (top right)
2. Select export format:
   - CSV - For spreadsheet analysis
   - PDF - For printing or sharing
3. The system generates and downloads the report
4. Use the exported file for:
   - Audits
   - Management reviews
   - Authority submissions
   - Historical analysis

### Report Uses

- **Daily Review** - Monitor lottery performance each day
- **Weekly Check** - Identify trending issues or opportunities
- **Authority Compliance** - Support reports to state lottery authorities
- **Management Analysis** - Evaluate game performance and store profitability
- **Variance Investigation** - Identify and investigate discrepancies
- **Audit Trail** - Maintain historical records for audits

---

## Best Practices

### Daily Operations

1. **Complete EOD Reconciliation Daily**
   - Reconcile lottery till at the end of each business day
   - Document any variances and get proper approvals
   - Never leave reconciliation for "tomorrow"

2. **Verify Physical Inventory**
   - Count scratch card packs regularly
   - Match system counts to physical inventory
   - Report any unexplained discrepancies immediately

3. **Monitor Cash Balances**
   - Check lottery till cash balance at shift changes
   - Keep opening float at consistent, planned level
   - Log all cash advances with notes

4. **Validate Sales Records**
   - Ensure all daily sales are entered into the system
   - Cross-check POS records with lottery system
   - Correct any missing or duplicate entries immediately

### Settlement & Compliance

5. **Review EFT Regularly**
   - Check EFT status weekly
   - Ensure packs are properly included in settlement periods
   - Verify payment receipt within expected timeframes

6. **Reconcile Authority Statements**
   - As soon as you receive a statement from authorities, reconcile it
   - Identify any discrepancies
   - Escalate issues to management

7. **Maintain Reversal Documentation**
   - If reverting included packs, document the reason thoroughly
   - Get proper approvals before reversing
   - Keep supporting documentation

8. **Archive Reports**
   - Save period-end reports for compliance
   - Keep exported files for audit purposes
   - Organize by date and settlement period

### Financial Accuracy

9. **Use Correct Tolerances**
   - Remember the $0.01 variance tolerance for daily reconciliation
   - Larger variances must be investigated and approved
   - Don't override tolerance rules for approval

10. **Separate Cash Sources**
    - Keep lottery cash separate from store till cash
    - Use proper cash advance procedures
    - Track bank deposits separately

11. **Timely Record Keeping**
    - Enter all transactions same day if possible
    - Avoid bulk retroactive entries
    - Use clear descriptions in notes

### Risk Management

12. **Reduce Variance Risk**
    - Count cash carefully using standard procedures
    - Use consistent counting methods
    - Consider team count verification for large amounts

13. **Prevent Lost Packs**
    - Implement pack inventory controls
    - Secure unsold packs in a designated area
    - Track pack movements in the system

14. **Audit Trail**
    - All system changes are logged
    - Reversals and adjustments are recorded
    - Review audit logs periodically for irregularities

---

## Troubleshooting

### Common Issues & Solutions

#### Issue: EOD Reconciliation Shows Large Variance

**Problem:** Actual cash counted differs significantly from expected balance.

**Investigation Steps:**
1. **Recount the cash** - Perform a careful second count
2. **Check for missed sales** - Review the day's sales records for any entries
3. **Look for previous day carry-over** - Verify opening balance was correct
4. **Review adjustments** - Check if any manual adjustments were made
5. **Examine cash advances** - Verify all cash advances were recorded
6. **Check for unposted deposits** - Confirm no deposits are pending

**Resolution:**
- Once root cause is found, adjust the system or physical cash accordingly
- Document the cause and correction
- Submit for manager approval if variance exceeds $0.01

#### Issue: Pack Inclusion Not Appearing in EFT

**Problem:** Packs you included don't show in the EFT settlement list.

**Causes & Solutions:**
1. **Wrong date range** - Verify you're viewing the correct date range in EFT
2. **Packs from future date** - Can't include packs with future dates; check the date
3. **Already included** - Packs may already be in a different settlement batch
4. **System error** - Refresh the page and try again

**Action:**
- Verify the inclusion was successful by checking the daily reconciliation page
- Contact support if packs still don't appear after refresh

#### Issue: Cannot Reverse an Included Pack

**Problem:** Reverse button is disabled or not available.

**Causes:**
1. **Pack already settled** - Cannot reverse packs that have been marked as paid
2. **Settlement period closed** - Closed settlement periods cannot be modified
3. **Insufficient permissions** - Your role may not allow reversals
4. **Pack marked paid** - Paid packs cannot be reversed

**Resolution:**
- If pack is marked paid, contact a manager to unmark it first
- If settlement is closed, you'll need a special authority to re-open it
- Check your user permissions; may need manager/admin role for reversals

#### Issue: Payment Not Appearing in System

**Problem:** You received payment from authorities but it's not showing in the system.

**Steps:**
1. Go to **Lottery > EFT**
2. Find the settlement period that was paid
3. Click the **"Mark as Paid"** button
4. Enter the payment date
5. Enter the payment amount if different from expected
6. Confirm the action

**If amount doesn't match expected:**
- Document the discrepancy
- Contact authorities to verify amounts
- Investigate for potential fees or adjustments
- Record the actual amount received

#### Issue: Cash Advance Not Recorded

**Problem:** Cash advance was submitted but doesn't appear in history.

**Check:**
1. Verify the advance was actually submitted (not just drafted)
2. If required, confirm manager approval was given
3. Check the date filter - may be outside current date range
4. Look in the "Pending" section if not yet approved

**Resolution:**
- If draft, resubmit the cash advance
- If pending approval, follow up with approver
- If lost, may need to resubmit with confirmation

#### Issue: Scratch Inventory Doesn't Match Physical Count

**Problem:** System shows different number of packs than actual physical count.

**Troubleshooting:**
1. **Verify the system date** - Are you looking at today or a past date?
2. **Check for recent movements** - Any packs recently included for settlement?
3. **Review additions** - Were new packs received but not yet entered?
4. **Investigate variance transactions** - Any pack reversals or adjustments?
5. **Confirm reconciliation** - Is today's reconciliation complete?

**Resolution:**
- If recent transaction, wait for EOD reconciliation to complete
- If physical count is correct, submit inventory adjustment with documentation
- Contact manager to investigate for lost/damaged/misallocated packs

#### Issue: Cannot Access Lottery Section

**Problem:** Lottery menu items not visible or access denied.

**Causes:**
1. **Insufficient permissions** - Your role may not include lottery access
2. **Store scope issue** - You may not be scoped to a lottery-enabled store
3. **Session expired** - Try logging out and logging back in
4. **Feature disabled** - Lottery module may not be enabled for your store

**Resolution:**
- Contact your admin to verify your role has lottery permissions
- Ensure you're scoped to the correct store with lottery operations
- Clear your browser cache and log back in
- Check with store manager that lottery module is configured

#### Issue: Reports Not Loading or Showing Old Data

**Problem:** Lottery reports page is slow or showing outdated information.

**Steps:**
1. **Refresh the page** - Press Ctrl+R (or Cmd+R on Mac)
2. **Clear browser cache** - Clear cached data and reload
3. **Try a different date range** - See if specific dates load
4. **Try downloading** - Sometimes download works when viewing doesn't
5. **Check system status** - Confirm the ERP is responding normally

**If Still Issues:**
- Contact IT support with the specific date range and error message
- May be a database query performance issue
- Provide error message or screenshot

---

## Getting Help

### Resources

- **Internal Documentation** - Check the docs folder for additional guides
- **System Admin** - Contact your store manager or system administrator
- **Error Messages** - Read and note error messages for support tickets
- **Audit Log** - Use the audit trail to track what changed and when

### Reporting Issues

When reporting a lottery system issue, include:
1. What you were trying to do
2. What happened (expected vs. actual)
3. Date/time of the issue
4. Screenshot if applicable
5. Error message (if any)
6. Which browser or device you're using

### Escalation

- **Tier 1:** Store Manager
- **Tier 2:** System Administrator
- **Tier 3:** Development Team

---

## Version Information

- **Document Version:** 1.0
- **Last Updated:** June 2024
- **System:** TYson Office ERP
- **Module:** Lottery Management System

For updates or corrections to this manual, contact your system administrator.
