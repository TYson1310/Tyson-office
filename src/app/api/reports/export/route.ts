import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import { getCurrentUser } from "@/lib/auth/session";
import {
  dateKeyToUtcNoonDate,
  getCurrentMonthStartIsoDateInTimeZone,
  getTodayIsoDateInTimeZone,
} from "@/lib/date-time";
import {
  getMonthToDateFinancials,
  getOperationsDataset,
  getOutstandingInvoiceBalance,
} from "@/lib/erp/operations";
import {
  buildBreakEvenRows,
  buildCostAlertRows,
  buildExpenseCategoryRows,
  buildExecutiveAlerts,
  buildMarginCategoryRows,
  buildMarginProductRows,
  buildMonthlyFinancialHistory,
  buildPaymentBreakdown,
  buildRecentSalesTrend,
  buildTopProductRows,
  buildVendorAnalysisRows,
  buildVendorLedgerRows,
} from "@/lib/erp/reporting";
import { getEmployeePayrollPageData } from "@/lib/payroll/employee-payroll";
import {
  getPayrollAnalysisRowsForStore,
  type PayrollAnalysisPeriodRow,
} from "@/lib/payroll/reporting";
import { buildLotteryReportExportRows } from "@/lib/lottery/reporting";
import {
  buildCsv,
  buildReportFilename,
  type ReportExportKey,
} from "@/lib/reports/export";
import { getServerStoreContext } from "@/lib/stores/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function round(value: number, digits = 2) {
  const precision = 10 ** digits;
  return Math.round(value * precision) / precision;
}

function normalizeReportKey(value: string | null): ReportExportKey | null {
  switch (value) {
    case "dashboard":
    case "lottery":
    case "sales":
    case "profit":
    case "margin-analysis":
    case "vendor-analysis":
    case "vendor-ledger":
    case "payroll-analysis":
    case "employee-payroll":
      return value;
    default:
      return null;
  }
}

function getReportAccessPath(report: ReportExportKey) {
  switch (report) {
    case "lottery":
      return "/lottery/reports";
    case "vendor-ledger":
      return "/vendors/invoices";
    case "employee-payroll":
      return "/employee/payroll";
    case "dashboard":
      return "/reports/dashboard";
    case "sales":
      return "/reports/sales";
    case "profit":
      return "/reports/profit";
    case "margin-analysis":
      return "/reports/margin-analysis";
    case "vendor-analysis":
      return "/reports/vendor-analysis";
    case "payroll-analysis":
      return "/reports/payroll-analysis";
  }
}

async function requireReportExportAccess(report: ReportExportKey) {
  if (!isSupabaseConfigured()) {
    return { auth: null, activeStoreKey: null };
  }

  const auth = await getCurrentUser();

  if (!auth?.user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (
    !canAccessPath(
      getReportAccessPath(report),
      auth.appUser.role,
      auth.appUser.permissions,
    )
  ) {
    return {
      error: NextResponse.json(
        { error: "Forbidden: report export access denied" },
        { status: 403 },
      ),
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { error: "Select a store before exporting reports" },
        { status: 400 },
      ),
    };
  }

  return {
    auth,
    activeStoreKey: storeContext.activeStoreKey,
    activeStoreTimeZone: storeContext.activeStore?.timeZone ?? "UTC",
  };
}

function createCsvResponse(
  report: ReportExportKey,
  rows: Parameters<typeof buildCsv>[0],
  filenameDateKey: string,
) {
  const csv = buildCsv(rows);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildReportFilename(report, filenameDateKey)}"`,
      "Cache-Control": "no-store",
    },
  });
}

function buildDashboardExportRows(timeZone: string) {
  return getOperationsDataset().then((dataset) => {
    const financials = getMonthToDateFinancials(dataset, {
      startDate: dateKeyToUtcNoonDate(
        getCurrentMonthStartIsoDateInTimeZone(timeZone),
      ),
      startDateKey: getCurrentMonthStartIsoDateInTimeZone(timeZone),
      timeZone,
    });
    const paymentBreakdown = buildPaymentBreakdown(dataset);
    const topProducts = buildTopProductRows(dataset);
    const alerts = buildExecutiveAlerts(dataset);
    const totalTransactions = dataset.salesSummaries.reduce(
      (sum, summary) => sum + summary.lineCount,
      0,
    );
    const averageTicket =
      totalTransactions === 0
        ? 0
        : dataset.salesSummaries.reduce(
            (sum, summary) => sum + summary.grossSales,
            0,
          ) / totalTransactions;
    const outstandingPayables = dataset.vendorInvoices.reduce(
      (sum, invoice) => sum + getOutstandingInvoiceBalance(invoice),
      0,
    );

    return [
      {
        section: "summary",
        metric: "MTD Revenue",
        value: round(financials.revenue),
      },
      {
        section: "summary",
        metric: "Gross Profit",
        value: round(financials.grossProfit),
      },
      {
        section: "summary",
        metric: "Net Profit",
        value: round(financials.netProfit),
      },
      {
        section: "summary",
        metric: "Profit Margin Percent",
        value: round(financials.netMarginPercent),
      },
      {
        section: "summary",
        metric: "Total Logged Entries",
        value: totalTransactions,
      },
      {
        section: "summary",
        metric: "Average Logged Amount",
        value: round(averageTicket),
      },
      {
        section: "summary",
        metric: "Pending Payroll",
        value: round(
          dataset.payrollDues.reduce((sum, due) => sum + due.netPay, 0),
        ),
      },
      {
        section: "quick_stats",
        metric: "Active Vendors",
        value: dataset.suppliers.filter(
          (supplier) => supplier.status === "active",
        ).length,
      },
      {
        section: "quick_stats",
        metric: "Products",
        value: dataset.products.length,
      },
      {
        section: "quick_stats",
        metric: "Employees",
        value: dataset.employees.length,
      },
      {
        section: "quick_stats",
        metric: "Outstanding A/P",
        value: round(outstandingPayables),
      },
      ...paymentBreakdown.map((row) => ({
        section: "payment_breakdown",
        paymentMethod: row.method,
        amount: round(row.amount),
        percent: round(row.percent),
      })),
      ...topProducts.map((row) => ({
        section: "top_products",
        name: row.name,
        sku: row.sku,
        units: row.units,
        revenue: round(row.revenue),
      })),
      ...(alerts.length > 0
        ? alerts.map((alert, index) => ({
            section: "alerts",
            order: index + 1,
            alert,
          }))
        : [
            {
              section: "alerts",
              order: 1,
              alert: "No current operational alerts.",
            },
          ]),
    ];
  });
}

function buildSalesExportRows() {
  return getOperationsDataset().then((dataset) => {
    const dailyData = buildRecentSalesTrend(dataset);
    const paymentBreakdown = buildPaymentBreakdown(dataset);
    const totalSales = dailyData.reduce((sum, day) => sum + day.sales, 0);
    const totalTransactions = dailyData.reduce(
      (sum, day) => sum + day.transactions,
      0,
    );
    const averageTransaction =
      totalTransactions === 0 ? 0 : totalSales / totalTransactions;
    const topPaymentMethod = paymentBreakdown[0];

    return [
      {
        section: "summary",
        metric: "7-Day Revenue",
        value: round(totalSales),
      },
      {
        section: "summary",
        metric: "Logged Entries",
        value: totalTransactions,
      },
      {
        section: "summary",
        metric: "Average Logged Amount",
        value: round(averageTransaction),
      },
      {
        section: "summary",
        metric: "Top Payment Method",
        value: topPaymentMethod?.method ?? "No data",
      },
      {
        section: "summary",
        metric: "Top Payment Method Amount",
        value: round(topPaymentMethod?.amount ?? 0),
      },
      ...dailyData.map((row) => ({
        section: "daily_sales",
        label: row.label,
        sales: round(row.sales),
        transactions: row.transactions,
      })),
      ...paymentBreakdown.map((row) => ({
        section: "payment_breakdown",
        method: row.method,
        amount: round(row.amount),
        percent: round(row.percent),
      })),
    ];
  });
}

function buildProfitExportRows(timeZone: string) {
  return getOperationsDataset().then((dataset) => {
    const currentMonthStart = dateKeyToUtcNoonDate(
      getCurrentMonthStartIsoDateInTimeZone(timeZone),
    );
    const periods = buildMonthlyFinancialHistory(dataset);
    const expenseCategories = buildExpenseCategoryRows(dataset, {
      start: currentMonthStart,
    });
    const draftExpenseTotal = dataset.expenses
      .filter((expense) => expense.status === "draft")
      .reduce((sum, expense) => sum + expense.amount, 0);
    const latest = periods[periods.length - 1];
    const averageMargin =
      periods.length === 0
        ? 0
        : periods.reduce((sum, period) => sum + period.margin, 0) /
          periods.length;
    const bestPeriod = [...periods].sort(
      (left, right) => right.margin - left.margin,
    )[0];
    const ytdProfit = periods.reduce((sum, period) => sum + period.profit, 0);

    return [
      {
        section: "summary",
        metric: "Average Profit Margin Percent",
        value: round(averageMargin),
      },
      {
        section: "summary",
        metric: "Best Period",
        value: bestPeriod?.label ?? "No data",
      },
      {
        section: "summary",
        metric: "Best Period Margin Percent",
        value: round(bestPeriod?.margin ?? 0),
      },
      {
        section: "summary",
        metric: "Tracked Profit",
        value: round(ytdProfit),
      },
      {
        section: "summary",
        metric: "Latest Period",
        value: latest?.label ?? "No data",
      },
      {
        section: "summary",
        metric: "Latest Period Profit",
        value: round(latest?.profit ?? 0),
      },
      {
        section: "summary",
        metric: "Draft Expenses Excluded",
        value: round(draftExpenseTotal),
      },
      ...periods.map((period) => ({
        section: "monthly_financials",
        period: period.label,
        revenue: round(period.revenue),
        cogs: round(period.cogs),
        operatingExpenses: round(period.opex),
        netProfit: round(period.profit),
        marginPercent: round(period.margin),
      })),
      ...expenseCategories.map((category) => ({
        section: "current_month_expense_breakdown",
        category: category.category,
        total: round(category.total),
        entries: category.entries,
        sharePercent: round(category.share),
        averageAmount: round(category.averageAmount),
      })),
    ];
  });
}

function buildMarginExportRows() {
  return getOperationsDataset().then((dataset) => {
    const categories = buildMarginCategoryRows(dataset);
    const products = buildMarginProductRows(dataset);
    const topMargins = [...products]
      .sort((left, right) => right.margin - left.margin)
      .slice(0, 5);
    const lowMargins = [...products]
      .filter((product) => product.margin < product.targetMargin)
      .sort((left, right) => left.margin - right.margin)
      .slice(0, 5);
    const averageMargin =
      products.length === 0
        ? 0
        : products.reduce((sum, product) => sum + product.margin, 0) /
          products.length;
    const belowTargetCount = products.filter(
      (product) => product.margin < product.targetMargin,
    ).length;
    const lowMarginCount = products.filter(
      (product) => product.margin < 20,
    ).length;
    const breakEvenRows = buildBreakEvenRows(dataset).slice(0, 10);
    const costAlerts = buildCostAlertRows(dataset).slice(0, 10);

    return [
      {
        section: "summary",
        metric: "Average Margin Percent",
        value: round(averageMargin),
      },
      {
        section: "summary",
        metric: "Products Below Target",
        value: belowTargetCount,
      },
      {
        section: "summary",
        metric: "Low Margin Products",
        value: lowMarginCount,
      },
      {
        section: "summary",
        metric: "Products Tracked",
        value: products.length,
      },
      ...categories.map((category) => ({
        section: "category_margins",
        category: category.category,
        averageMarginPercent: round(category.averageMargin),
        productCount: category.productCount,
        belowTargetCount: category.belowTargetCount,
        lowMarginCount: category.lowMarginCount,
      })),
      ...lowMargins.map((product) => ({
        section: "at_risk_products",
        name: product.name,
        sku: product.sku,
        category: product.category,
        cost: round(product.cost),
        price: round(product.price),
        marginPercent: round(product.margin),
        targetMarginPercent: round(product.targetMargin),
      })),
      ...topMargins.map((product) => ({
        section: "top_margin_products",
        name: product.name,
        sku: product.sku,
        category: product.category,
        cost: round(product.cost),
        price: round(product.price),
        marginPercent: round(product.margin),
        targetMarginPercent: round(product.targetMargin),
      })),
      ...breakEvenRows.map((row) => ({
        section: "break_even",
        productName: row.productName,
        sku: row.sku,
        inventoryInvestment: round(row.inventoryInvestment),
        sellingPrice: round(row.sellingPrice),
        profitPerUnit: round(row.profitPerUnit),
        breakEvenUnits:
          row.breakEvenUnits !== null ? round(row.breakEvenUnits) : "",
        breakEvenRevenue:
          row.breakEvenRevenue !== null ? round(row.breakEvenRevenue) : "",
        currentSalesVolume: row.currentSalesVolume,
        marginPercent: round(row.margin),
        daysToBreakEven:
          row.daysToBreakEven !== null ? round(row.daysToBreakEven) : "",
      })),
      ...costAlerts.map((row) => ({
        section: "cost_alerts",
        productName: row.productName,
        sku: row.productSku,
        vendorName: row.vendorName,
        currentCost: round(row.currentCost),
        currentPrice: round(row.currentPrice),
        currentMarginPercent: round(row.currentMargin),
        targetMarginPercent: round(row.targetMargin),
        marginGapPercent: round(row.marginGap),
        quantityOnHand: row.quantityOnHand,
        recommendedPrice:
          row.recommendedPrice !== null ? round(row.recommendedPrice) : "",
        severity: row.severity,
        detectedAt: row.detectedAt,
      })),
    ];
  });
}

function buildVendorExportRows() {
  return getOperationsDataset().then((dataset) => {
    const vendors = buildVendorAnalysisRows(dataset);
    const totalVendorSpend = vendors.reduce(
      (sum, vendor) => sum + vendor.spent,
      0,
    );
    const totalAdjustments = vendors.reduce(
      (sum, vendor) => sum + vendor.adjustments,
      0,
    );
    const averageOnTime =
      vendors.length === 0
        ? 0
        : vendors.reduce((sum, vendor) => sum + vendor.onTime, 0) /
          vendors.length;
    const topVendor = vendors[0];
    const totalOpenBalance = vendors.reduce(
      (sum, vendor) => sum + vendor.openBalance,
      0,
    );
    const totalAvailableCredit = vendors.reduce(
      (sum, vendor) => sum + vendor.availableCredit,
      0,
    );

    return [
      {
        section: "summary",
        metric: "Total Vendor Spend",
        value: round(totalVendorSpend),
      },
      {
        section: "summary",
        metric: "Credits And Returns",
        value: round(totalAdjustments),
      },
      {
        section: "summary",
        metric: "Top Vendor",
        value: topVendor?.name ?? "No data",
      },
      {
        section: "summary",
        metric: "Top Vendor Spend",
        value: round(topVendor?.spent ?? 0),
      },
      {
        section: "summary",
        metric: "Average Reliability Percent",
        value: round(averageOnTime),
      },
      {
        section: "summary",
        metric: "Available Credit",
        value: round(totalAvailableCredit),
      },
      {
        section: "summary",
        metric: "Outstanding A/P",
        value: round(totalOpenBalance),
      },
      ...vendors.map((vendor) => ({
        section: "vendor_performance",
        vendor: vendor.name,
        spent: round(vendor.spent),
        adjustments: round(vendor.adjustments),
        invoices: vendor.invoices,
        averageInvoice: round(vendor.avgInvoice),
        reliabilityPercent: round(vendor.onTime),
        availableCredit: round(vendor.availableCredit),
        openBalance: round(vendor.openBalance),
        openPurchaseOrders: vendor.activePurchaseOrders,
        rating: round(vendor.rating),
      })),
    ];
  });
}

function buildVendorLedgerExportRows(supplierId?: string) {
  return getOperationsDataset().then((dataset) => {
    const rows = buildVendorLedgerRows(dataset, { supplierId });
    const selectedSupplierName =
      supplierId &&
      dataset.suppliers.find((supplier) => supplier.id === supplierId)?.name;

    return [
      {
        section: "summary",
        metric: "Supplier scope",
        value: selectedSupplierName ?? "All suppliers",
      },
      {
        section: "summary",
        metric: "Ledger rows",
        value: rows.length,
      },
      ...rows.map((row) => ({
        section: "vendor_ledger",
        supplier: row.supplierName,
        entryDate: row.entryDate,
        entryType: row.entryType,
        reference: row.reference,
        linkedInvoiceNumber: row.linkedInvoiceNumber ?? "",
        description: row.description,
        status: row.status,
        debit: round(row.debit),
        credit: round(row.credit),
        runningBalance: round(row.runningBalance),
      })),
    ];
  });
}

function buildPayrollExportRows(
  payrollData: PayrollAnalysisPeriodRow[],
  employeeCount: number,
) {
  const totalGrossPay = payrollData.reduce((sum, row) => sum + row.grossPay, 0);
  const totalDeductions = payrollData.reduce(
    (sum, row) => sum + row.deductions,
    0,
  );
  const totalNetPay = payrollData.reduce((sum, row) => sum + row.netPay, 0);
  const averagePerEmployee =
    employeeCount === 0 ? 0 : totalGrossPay / employeeCount;
  const deductionRate =
    totalGrossPay === 0 ? 0 : (totalDeductions / totalGrossPay) * 100;

  return [
    {
      section: "summary",
      metric: "Total Payroll",
      value: round(totalGrossPay),
    },
    {
      section: "summary",
      metric: "Average Per Employee",
      value: round(averagePerEmployee),
    },
    {
      section: "summary",
      metric: "Total Net Pay",
      value: round(totalNetPay),
    },
    {
      section: "summary",
      metric: "Deduction Rate Percent",
      value: round(deductionRate),
    },
    ...payrollData.map((period) => ({
      section: "payroll_periods",
      period: period.period,
      payDate: period.payDate,
      employees: period.employees,
      grossPay: round(period.grossPay),
      deductions: round(period.deductions),
      netPay: round(period.netPay),
    })),
  ];
}

async function buildEmployeePayrollExportRows() {
  const auth = isSupabaseConfigured() ? await getCurrentUser() : null;
  const payrollData = await getEmployeePayrollPageData(
    auth?.user.id,
    auth?.profile,
  );
  const { employee, statements, documents, deductionBreakdown } = payrollData;
  const currentStatement =
    statements.find((statement) => statement.status === "Scheduled") ??
    statements[0] ??
    null;
  const paidStatements = statements.filter(
    (statement) => statement.status === "Paid",
  );
  const ytdGross = paidStatements.reduce(
    (sum, statement) => sum + statement.gross,
    0,
  );
  const ytdDeductions = paidStatements.reduce(
    (sum, statement) => sum + statement.deductions,
    0,
  );
  const ytdNet = paidStatements.reduce(
    (sum, statement) => sum + statement.net,
    0,
  );
  const totalBonus = paidStatements.reduce(
    (sum, statement) => sum + statement.bonus,
    0,
  );
  const averageNet =
    paidStatements.length > 0 ? ytdNet / paidStatements.length : 0;
  const deductionRate = ytdGross === 0 ? 0 : (ytdDeductions / ytdGross) * 100;

  return [
    {
      section: "employee_profile",
      name: employee.name,
      role: employee.role,
      employeeNumber: employee.employeeNumber,
      department: employee.department,
      manager: employee.manager,
      payFrequency: employee.payFrequency,
      nextPayDate: employee.nextPayDate,
      directDepositAccount: employee.directDepositAccount,
    },
    {
      section: "summary",
      metric: "Next Take Home",
      value: round(currentStatement?.net ?? 0),
    },
    {
      section: "summary",
      metric: "Total Earnings YTD",
      value: round(ytdGross),
    },
    {
      section: "summary",
      metric: "Net Paid YTD",
      value: round(ytdNet),
    },
    {
      section: "summary",
      metric: "Average Net Per Cycle",
      value: round(averageNet),
    },
    {
      section: "summary",
      metric: "Total Deductions YTD",
      value: round(ytdDeductions),
    },
    {
      section: "summary",
      metric: "Deduction Rate Percent",
      value: round(deductionRate),
    },
    {
      section: "summary",
      metric: "Paid Payroll Cycles",
      value: paidStatements.length,
    },
    {
      section: "summary",
      metric: "Total Bonus",
      value: round(totalBonus),
    },
    ...statements.map((statement) => ({
      section: "pay_statements",
      period: statement.period,
      payDate: statement.payDate,
      gross: round(statement.gross),
      deductions: round(statement.deductions),
      net: round(statement.net),
      paidHours: round(statement.paidHours),
      hourlyRate: round(statement.hourlyRate),
      bonus: round(statement.bonus),
      status: statement.status,
    })),
    ...documents.map((document) => ({
      section: "documents",
      name: document.name,
      category: document.category,
      period: document.period,
      issuedOn: document.issuedOn,
      status: document.status,
      href: document.href,
    })),
    ...deductionBreakdown.map((row) => ({
      section: "deduction_breakdown",
      label: row.label,
      amount: round(row.amount),
      tone: row.tone,
    })),
  ];
}

export async function GET(request: NextRequest) {
  const report = normalizeReportKey(
    request.nextUrl.searchParams.get("report")?.trim() ?? null,
  );
  const supplierId =
    request.nextUrl.searchParams.get("supplierId")?.trim() || undefined;
  const days = Number(request.nextUrl.searchParams.get("days") ?? undefined);

  if (!report) {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }

  const access = await requireReportExportAccess(report);

  if ("error" in access) {
    return access.error;
  }

  try {
    const activeStoreTimeZone = access.activeStoreTimeZone ?? "UTC";
    const filenameDateKey = getTodayIsoDateInTimeZone(activeStoreTimeZone);

    if (access.activeStoreKey && access.auth?.user) {
      const supabase = await createClient();
      await appendAuditEvent({
        supabase,
        storeKey: access.activeStoreKey,
        entityType: "report_export",
        entityId: report,
        action: "reports.exported",
        summary: `Report exported: ${report}`,
        actorId: access.auth.user.id,
        actorName: access.auth.appUser.name,
        actorRole: access.auth.appUser.role,
        metadata: {
          days: Number.isFinite(days) ? days : null,
          report,
          supplierId: supplierId ?? null,
        },
      });
    }

    switch (report) {
      case "dashboard":
        return createCsvResponse(
          report,
          await buildDashboardExportRows(activeStoreTimeZone),
          filenameDateKey,
        );
      case "lottery":
        return createCsvResponse(
          report,
          await buildLotteryReportExportRows({ days }),
          filenameDateKey,
        );
      case "sales":
        return createCsvResponse(
          report,
          await buildSalesExportRows(),
          filenameDateKey,
        );
      case "profit":
        return createCsvResponse(
          report,
          await buildProfitExportRows(activeStoreTimeZone),
          filenameDateKey,
        );
      case "margin-analysis":
        return createCsvResponse(
          report,
          await buildMarginExportRows(),
          filenameDateKey,
        );
      case "vendor-analysis":
        return createCsvResponse(
          report,
          await buildVendorExportRows(),
          filenameDateKey,
        );
      case "vendor-ledger":
        return createCsvResponse(
          report,
          await buildVendorLedgerExportRows(supplierId),
          filenameDateKey,
        );
      case "payroll-analysis": {
        const dataset = await getOperationsDataset();
        const payrollData = access.activeStoreKey
          ? await getPayrollAnalysisRowsForStore(access.activeStoreKey)
          : [];

        return createCsvResponse(
          report,
          buildPayrollExportRows(payrollData, dataset.employees.length),
          filenameDateKey,
        );
      }
      case "employee-payroll":
        return createCsvResponse(
          report,
          await buildEmployeePayrollExportRows(),
          filenameDateKey,
        );
      default:
        return NextResponse.json({ error: "Invalid report" }, { status: 400 });
    }
  } catch (error) {
    console.error("Report export error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to export report",
      },
      { status: 500 },
    );
  }
}
