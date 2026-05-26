import { NextRequest, NextResponse } from "next/server";
import { canAccessPath } from "@/lib/auth/route-access";
import { PROFILE_SELECT, type ProfileRecord } from "@/lib/auth/shared";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { UserRole } from "@/types/erp.types";
import {
  calculatePayStatementTotals,
  selectPayStatementsWithFallback,
} from "@/lib/payroll/pay-statements";

type PayStatementDocumentRow = {
  id: string;
  employee_id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  gross_pay: number;
  deductions_total: number;
  net_pay: number;
  regular_hours?: number | null;
  overtime_hours: number | null;
  hourly_rate?: number | null;
  overtime_multiplier?: number | null;
  bonus_amount: number | null;
  status: "draft" | "scheduled" | "paid" | "archived";
  notes: string | null;
  pay_statement_deductions:
    | {
        id: string;
        label: string;
        amount: number;
        sort_order: number | null;
      }[]
    | null;
};

export const dynamic = "force-dynamic";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDepositAccount(profile: ProfileRecord | null) {
  if (!profile?.bank_name || !profile.bank_account_last4) {
    return "Direct deposit not configured";
  }

  return `${profile.bank_name} •••• ${profile.bank_account_last4}`;
}

function getStatusLabel(status: PayStatementDocumentRow["status"]) {
  if (status === "archived") {
    return "Archived";
  }

  if (status === "paid") {
    return "Paid";
  }

  if (status === "scheduled") {
    return "Scheduled";
  }

  return "Draft";
}

function renderPayStatementHtml(input: {
  employeeName: string;
  employeeRole: string;
  employeeNumber: string;
  department: string;
  managerName: string;
  depositAccount: string;
  statement: PayStatementDocumentRow;
  calculation: ReturnType<typeof calculatePayStatementTotals>;
  deductionRows: Array<{ label: string; amount: number }>;
}) {
  const {
    employeeName,
    employeeRole,
    employeeNumber,
    department,
    managerName,
  } = input;
  const { depositAccount, statement, calculation, deductionRows } = input;
  const deductionMarkup =
    deductionRows.length > 0
      ? deductionRows
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.label)}</td>
                <td class="amount">${formatCurrency(row.amount)}</td>
              </tr>
            `,
          )
          .join("")
      : `
        <tr>
          <td>No deductions recorded</td>
          <td class="amount">${formatCurrency(0)}</td>
        </tr>
      `;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pay Statement - ${escapeHtml(statement.period_label)}</title>
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: #f4f6fb;
        color: #162033;
        font-family: "Segoe UI", Arial, sans-serif;
      }

      .page {
        max-width: 960px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }

      .toolbar {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 20px;
      }

      .print-button {
        border: 0;
        border-radius: 999px;
        background: #1d4ed8;
        color: white;
        padding: 12px 18px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
      }

      .sheet {
        background: white;
        border-radius: 28px;
        padding: 28px;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
      }

      .header {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        align-items: flex-start;
        border-bottom: 1px solid #d9dfec;
        padding-bottom: 22px;
      }

      .eyebrow {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #51607a;
      }

      h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.1;
      }

      .status {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 8px 12px;
        background: #e0f2fe;
        color: #075985;
        font-size: 13px;
        font-weight: 700;
      }

      .meta-grid,
      .summary-grid {
        display: grid;
        gap: 14px;
        margin-top: 24px;
      }

      .meta-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }

      .summary-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }

      .card {
        border: 1px solid #d9dfec;
        border-radius: 20px;
        padding: 16px 18px;
        background: #fbfcff;
      }

      .label {
        margin: 0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #60708d;
      }

      .value {
        margin: 8px 0 0;
        font-size: 18px;
        font-weight: 700;
      }

      .section {
        margin-top: 28px;
      }

      .section h2 {
        margin: 0 0 14px;
        font-size: 18px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 12px 0;
        border-bottom: 1px solid #e4e9f2;
        font-size: 14px;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: #60708d;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .amount {
        text-align: right;
        white-space: nowrap;
      }

      .notes {
        border: 1px dashed #c6d2e6;
        border-radius: 18px;
        padding: 16px;
        background: #fcfdff;
        color: #3f4b61;
        white-space: pre-wrap;
      }

      @media print {
        body {
          background: white;
        }

        .page {
          padding: 0;
        }

        .toolbar {
          display: none;
        }

        .sheet {
          box-shadow: none;
          border-radius: 0;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="toolbar">
        <button class="print-button" type="button" onclick="window.print()">Print</button>
      </div>
      <main class="sheet">
        <section class="header">
          <div>
            <p class="eyebrow">Payroll Document</p>
            <h1>Pay Statement</h1>
            <p>${escapeHtml(statement.period_label)} • ${formatDate(statement.period_start)} to ${formatDate(statement.period_end)}</p>
          </div>
          <div class="status">${escapeHtml(getStatusLabel(statement.status))}</div>
        </section>

        <section class="meta-grid">
          <div class="card">
            <p class="label">Employee</p>
            <p class="value">${escapeHtml(employeeName)}</p>
          </div>
          <div class="card">
            <p class="label">Position</p>
            <p class="value">${escapeHtml(employeeRole)}</p>
          </div>
          <div class="card">
            <p class="label">Employee Number</p>
            <p class="value">${escapeHtml(employeeNumber)}</p>
          </div>
          <div class="card">
            <p class="label">Pay Date</p>
            <p class="value">${formatDate(statement.pay_date)}</p>
          </div>
          <div class="card">
            <p class="label">Department</p>
            <p class="value">${escapeHtml(department)}</p>
          </div>
          <div class="card">
            <p class="label">Manager</p>
            <p class="value">${escapeHtml(managerName)}</p>
          </div>
        </section>

        <section class="summary-grid">
          <div class="card">
            <p class="label">Paid Hours</p>
            <p class="value">${calculation.regularHours.toFixed(2)}</p>
          </div>
          <div class="card">
            <p class="label">Hourly Rate</p>
            <p class="value">${formatCurrency(calculation.hourlyRate)}</p>
          </div>
          <div class="card">
            <p class="label">Bonus</p>
            <p class="value">${formatCurrency(calculation.bonusAmount)}</p>
          </div>
          <div class="card">
            <p class="label">Net Pay</p>
            <p class="value">${formatCurrency(calculation.netPay)}</p>
          </div>
          <div class="card">
            <p class="label">Gross Pay</p>
            <p class="value">${formatCurrency(calculation.grossPay)}</p>
          </div>
          <div class="card">
            <p class="label">Deposit Account</p>
            <p class="value">${escapeHtml(depositAccount)}</p>
          </div>
        </section>

        <section class="section">
          <h2>Earnings</h2>
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th class="amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Base pay</td>
                <td class="amount">${formatCurrency(calculation.regularPay)}</td>
              </tr>
              <tr>
                <td>Bonus</td>
                <td class="amount">${formatCurrency(calculation.bonusAmount)}</td>
              </tr>
              <tr>
                <td><strong>Gross pay</strong></td>
                <td class="amount"><strong>${formatCurrency(calculation.grossPay)}</strong></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="section">
          <h2>Deductions</h2>
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th class="amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${deductionMarkup}
              <tr>
                <td><strong>Total deductions</strong></td>
                <td class="amount"><strong>${formatCurrency(calculation.deductionsTotal)}</strong></td>
              </tr>
            </tbody>
          </table>
        </section>

        ${
          statement.notes
            ? `<section class="section">
                <h2>Notes</h2>
                <div class="notes">${escapeHtml(statement.notes)}</div>
              </section>`
            : ""
        }
      </main>
    </div>
  </body>
</html>`;
}

export async function GET(request: NextRequest) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { message: "Supabase configuration required" },
        { status: 503 },
      );
    }

    const statementId =
      request.nextUrl.searchParams.get("statementId")?.trim() ?? "";

    if (!statementId) {
      return NextResponse.json(
        { message: "Missing required query: statementId" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { data: statement, error: statementError } =
      await selectPayStatementsWithFallback<PayStatementDocumentRow>(
        async (select) =>
          supabase
            .from("pay_statements")
            .select(
              `${select},pay_statement_deductions(id,label,amount,sort_order)`,
            )
            .eq("id", statementId)
            .returns<PayStatementDocumentRow[]>()
            .single(),
      );

    if (statementError || !statement) {
      const statusCode = statementError?.code === "PGRST116" ? 404 : 500;
      return NextResponse.json(
        { message: statementError?.message ?? "Payroll statement not found" },
        { status: statusCode },
      );
    }

    const { data: currentProfile, error: currentProfileError } = await supabase
      .from("profiles")
      .select("role,permissions")
      .eq("id", user.id)
      .maybeSingle<{ role: UserRole | null; permissions: string[] | null }>();

    if (currentProfileError) {
      return NextResponse.json(
        {
          message:
            currentProfileError.message ?? "Failed to verify payroll access",
        },
        { status: 500 },
      );
    }

    const canViewManagedPayroll = canAccessPath(
      "/payroll",
      currentProfile?.role,
      currentProfile?.permissions,
    );
    const canViewOwnPayroll =
      statement.employee_id === user.id &&
      canAccessPath(
        "/employee/payroll",
        currentProfile?.role,
        currentProfile?.permissions,
      );

    if (!canViewManagedPayroll && !canViewOwnPayroll) {
      return NextResponse.json(
        { message: "Forbidden: payroll document access denied" },
        { status: 403 },
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", statement.employee_id)
      .maybeSingle<ProfileRecord>();

    const calculation = calculatePayStatementTotals({
      explicitGrossPay: statement.gross_pay,
      explicitNetPay: statement.net_pay,
      deductionsTotal: statement.deductions_total,
      bonusAmount: statement.bonus_amount,
      regularHours: statement.regular_hours,
      overtimeHours: statement.overtime_hours,
      hourlyRate: statement.hourly_rate,
      overtimeMultiplier: statement.overtime_multiplier,
    });

    const deductionRows = [...(statement.pay_statement_deductions ?? [])]
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((row) => ({
        label: row.label,
        amount: Number(row.amount ?? 0),
      }));

    const html = renderPayStatementHtml({
      employeeName:
        profile?.full_name?.trim() || profile?.email?.trim() || "Employee",
      employeeRole: profile?.position_title ?? profile?.role ?? "Employee",
      employeeNumber: profile?.employee_number ?? "Not assigned",
      department: profile?.department ?? "Unassigned",
      managerName: profile?.manager_name ?? "Unassigned",
      depositAccount: formatDepositAccount(profile),
      statement,
      calculation,
      deductionRows,
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Payroll document GET error:", error);
    return NextResponse.json(
      { message: "Failed to load payroll document" },
      { status: 500 },
    );
  }
}
