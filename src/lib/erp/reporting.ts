import {
  calculateOrderCost,
  calculateProductMarginPercent,
  formatMonthLabel,
  getSupplierAdjustmentTotal,
  getSupplierPaymentTotal,
  getSupplierAvailableCredit,
  getOutstandingInvoiceBalance,
  getSupplierActivePurchaseOrders,
  getSupplierOpenBalance,
  type OperationsDataset,
} from "@/lib/erp/operations";
import { normalizeExpenseCategory } from "@/lib/expenses/categories";
import { isPostedVendorAdjustmentStatus } from "@/lib/vendors/adjustments";
import { isPostedVendorPaymentStatus } from "@/lib/vendors/payments";

export type SalesTrendRow = {
  label: string;
  sales: number;
  transactions: number;
};

export type PaymentBreakdownRow = {
  method: string;
  amount: number;
  percent: number;
};

export type ExpenseCategoryRow = {
  category: string;
  total: number;
  entries: number;
  share: number;
  averageAmount: number;
};

export type MonthlyFinancialRow = {
  label: string;
  revenue: number;
  cogs: number;
  opex: number;
  profit: number;
  margin: number;
};

export type MarginCategoryRow = {
  category: string;
  averageMargin: number;
  productCount: number;
  belowTargetCount: number;
  lowMarginCount: number;
};

export type MarginProductRow = {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  cost: number;
  margin: number;
  targetMargin: number;
  quantity: number;
};

export type VendorAnalysisRow = {
  id: string;
  name: string;
  spent: number;
  adjustments: number;
  invoices: number;
  avgInvoice: number;
  onTime: number;
  rating: number;
  openBalance: number;
  availableCredit: number;
  activePurchaseOrders: number;
};

export type VendorLedgerRow = {
  supplierId: string;
  supplierName: string;
  entryDate: Date;
  entryType: "invoice" | "payment" | "adjustment";
  reference: string;
  linkedInvoiceNumber?: string;
  description: string;
  status: string;
  debit: number;
  credit: number;
  runningBalance: number;
};

export type ApprovalQueueRow = {
  id: string;
  category: "supplier_adjustment" | "expense";
  title: string;
  description: string;
  entryDate: Date;
  createdAt: Date;
  amount: number;
  href: string;
};

export type ActionNotificationRow = {
  id: string;
  tone: "red" | "amber" | "blue";
  title: string;
  detail: string;
  href: string;
};

export type BreakEvenRow = {
  id: string;
  productName: string;
  sku: string;
  inventoryInvestment: number;
  sellingPrice: number;
  profitPerUnit: number;
  breakEvenUnits: number | null;
  breakEvenRevenue: number | null;
  currentSalesVolume: number;
  margin: number;
  daysToBreakEven: number | null;
};

export type CostAlertRow = {
  id: string;
  productName: string;
  productSku: string;
  vendorName: string;
  currentCost: number;
  currentPrice: number;
  currentMargin: number;
  targetMargin: number;
  marginGap: number;
  quantityOnHand: number;
  recommendedPrice: number | null;
  detectedAt: Date;
  severity: "critical" | "warning";
};

export type OperationalActivityRow = {
  id: string;
  timestamp: Date;
  userName: string;
  userRole: string;
  action: string;
  entity: string;
  details: string;
  status: "success" | "warning" | "failure";
};

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function daysBetween(start: Date, end: Date) {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function getApprovedExpensesInRange(
  dataset: OperationsDataset,
  start?: Date,
  end?: Date,
) {
  return dataset.expenses.filter((expense) => {
    if (expense.status !== "approved") {
      return false;
    }

    if (start && expense.date < start) {
      return false;
    }

    if (end && expense.date >= end) {
      return false;
    }

    return true;
  });
}

export function buildRecentSalesTrend(
  dataset: OperationsDataset,
  days = 7,
): SalesTrendRow[] {
  const today = new Date();

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - (days - 1 - index),
    );
    const daySummaries = dataset.salesSummaries.filter(
      (summary) => summary.date.toDateString() === date.toDateString(),
    );

    return {
      label: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(date),
      sales: daySummaries.reduce((sum, summary) => sum + summary.grossSales, 0),
      transactions: daySummaries.reduce(
        (sum, summary) => sum + summary.lineCount,
        0,
      ),
    };
  });
}

export function buildPaymentBreakdown(
  dataset: OperationsDataset,
): PaymentBreakdownRow[] {
  const amountByMethod = new Map<string, number>();

  dataset.salesSummaries.forEach((summary) => {
    Object.entries(summary.paymentBreakdown).forEach(([method, amount]) => {
      amountByMethod.set(method, (amountByMethod.get(method) ?? 0) + amount);
    });
  });

  const total = Array.from(amountByMethod.values()).reduce(
    (sum, amount) => sum + amount,
    0,
  );

  return Array.from(amountByMethod.entries())
    .map(([method, amount]) => ({
      method: titleCase(method),
      amount,
      percent: total === 0 ? 0 : (amount / total) * 100,
    }))
    .sort((left, right) => right.amount - left.amount);
}

export function buildMonthlyFinancialHistory(
  dataset: OperationsDataset,
  months = 6,
): MonthlyFinancialRow[] {
  const currentMonth = monthStart(new Date());

  return Array.from({ length: months }, (_, index) => {
    const month = addMonths(currentMonth, -(months - 1 - index));
    const nextMonth = addMonths(month, 1);
    const orders = dataset.orders.filter(
      (order) => order.createdAt >= month && order.createdAt < nextMonth,
    );
    const revenue = orders.reduce((sum, order) => sum + order.total, 0);
    const cogs = orders.reduce(
      (sum, order) => sum + calculateOrderCost(order, dataset.products),
      0,
    );
    const opex = getApprovedExpensesInRange(dataset, month, nextMonth).reduce(
      (sum, expense) => sum + expense.amount,
      0,
    );
    const profit = revenue - cogs - opex;

    return {
      label: formatMonthLabel(month),
      revenue,
      cogs,
      opex,
      profit,
      margin: revenue === 0 ? 0 : (profit / revenue) * 100,
    };
  });
}

export function buildExpenseCategoryRows(
  dataset: OperationsDataset,
  options?: {
    start?: Date;
    end?: Date;
  },
): ExpenseCategoryRow[] {
  const rows = new Map<string, { total: number; entries: number }>();
  const expenses = getApprovedExpensesInRange(
    dataset,
    options?.start,
    options?.end,
  );
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  expenses.forEach((expense) => {
    const category = normalizeExpenseCategory(expense.category) ?? "Other";
    const current = rows.get(category) ?? { total: 0, entries: 0 };
    current.total += expense.amount;
    current.entries += 1;
    rows.set(category, current);
  });

  return Array.from(rows.entries())
    .map(([category, values]) => ({
      category,
      total: values.total,
      entries: values.entries,
      share: total === 0 ? 0 : (values.total / total) * 100,
      averageAmount: values.entries === 0 ? 0 : values.total / values.entries,
    }))
    .sort((left, right) => right.total - left.total);
}

export function buildMarginCategoryRows(
  dataset: OperationsDataset,
): MarginCategoryRow[] {
  const byCategory = new Map<string, MarginProductRow[]>();

  buildMarginProductRows(dataset).forEach((product) => {
    const category = product.category || "Uncategorized";
    const current = byCategory.get(category) ?? [];
    current.push(product);
    byCategory.set(category, current);
  });

  return Array.from(byCategory.entries())
    .map(([category, products]) => ({
      category,
      averageMargin:
        products.reduce((sum, product) => sum + product.margin, 0) /
        products.length,
      productCount: products.length,
      belowTargetCount: products.filter(
        (product) => product.margin < product.targetMargin,
      ).length,
      lowMarginCount: products.filter((product) => product.margin < 20).length,
    }))
    .sort((left, right) => right.averageMargin - left.averageMargin);
}

export function buildMarginProductRows(
  dataset: OperationsDataset,
): MarginProductRow[] {
  return dataset.products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    price: product.price,
    cost: product.cost,
    margin: calculateProductMarginPercent(product),
    targetMargin: product.targetMarginPercent,
    quantity: product.quantity,
  }));
}

export function buildVendorAnalysisRows(
  dataset: OperationsDataset,
): VendorAnalysisRow[] {
  return dataset.suppliers
    .map((supplier) => {
      const invoices = dataset.vendorInvoices.filter(
        (invoice) => invoice.vendorId === supplier.id,
      );
      const spent = getSupplierPaymentTotal(dataset, supplier.id);

      return {
        id: supplier.id,
        name: supplier.name,
        spent,
        adjustments: getSupplierAdjustmentTotal(dataset, supplier.id),
        invoices: invoices.length,
        avgInvoice:
          invoices.length === 0
            ? 0
            : invoices.reduce((sum, invoice) => sum + invoice.amount, 0) /
              invoices.length,
        onTime: supplier.reliabilityPercent,
        rating: Number(supplier.rating ?? 0),
        openBalance: getSupplierOpenBalance(dataset, supplier.id),
        availableCredit: getSupplierAvailableCredit(dataset, supplier.id),
        activePurchaseOrders: getSupplierActivePurchaseOrders(
          dataset,
          supplier.id,
        ),
      };
    })
    .sort((left, right) => right.spent - left.spent);
}

export function buildVendorLedgerRows(
  dataset: OperationsDataset,
  options?: {
    supplierId?: string;
  },
): VendorLedgerRow[] {
  const selectedSupplierId = options?.supplierId;
  const supplierFilter = (supplierId: string) =>
    !selectedSupplierId || supplierId === selectedSupplierId;
  const typeOrder = {
    invoice: 0,
    payment: 1,
    adjustment: 2,
  } as const;
  const rawEntries = [
    ...dataset.vendorInvoices
      .filter((invoice) => supplierFilter(invoice.vendorId))
      .map((invoice) => ({
        supplierId: invoice.vendorId,
        supplierName: invoice.vendorName,
        entryDate: invoice.issueDate,
        entryType: "invoice" as const,
        reference: invoice.invoiceNumber,
        linkedInvoiceNumber: invoice.invoiceNumber,
        description: invoice.description ?? `Invoice ${invoice.invoiceNumber}`,
        status: invoice.status,
        debit: invoice.amount,
        credit: 0,
      })),
    ...dataset.vendorPayments
      .filter(
        (payment) =>
          supplierFilter(payment.vendorId) &&
          isPostedVendorPaymentStatus(payment.status),
      )
      .map((payment) => ({
        supplierId: payment.vendorId,
        supplierName: payment.vendorName,
        entryDate: payment.paymentDate,
        entryType: "payment" as const,
        reference: payment.referenceNumber,
        linkedInvoiceNumber: payment.invoiceNumber,
        description:
          payment.notes?.trim() || `Payment ${payment.referenceNumber}`,
        status: payment.status,
        debit: 0,
        credit: payment.amountPaid,
      })),
    ...dataset.vendorAdjustments
      .filter(
        (adjustment) =>
          supplierFilter(adjustment.vendorId) &&
          isPostedVendorAdjustmentStatus(adjustment.status),
      )
      .map((adjustment) => ({
        supplierId: adjustment.vendorId,
        supplierName: adjustment.vendorName,
        entryDate: adjustment.adjustmentDate,
        entryType: "adjustment" as const,
        reference: adjustment.adjustmentNumber,
        linkedInvoiceNumber: adjustment.invoiceNumber,
        description:
          adjustment.reason?.trim() ||
          adjustment.adjustmentType.replace(/_/g, " "),
        status: adjustment.status,
        debit: 0,
        credit: adjustment.amount,
      })),
  ].sort((left, right) => {
    const supplierCompare = left.supplierName.localeCompare(right.supplierName);

    if (supplierCompare !== 0) {
      return supplierCompare;
    }

    const dateCompare = left.entryDate.getTime() - right.entryDate.getTime();

    if (dateCompare !== 0) {
      return dateCompare;
    }

    return typeOrder[left.entryType] - typeOrder[right.entryType];
  });

  const balances = new Map<string, number>();

  return rawEntries.map((entry) => {
    const runningBalance =
      (balances.get(entry.supplierId) ?? 0) + entry.debit - entry.credit;
    balances.set(entry.supplierId, runningBalance);

    return {
      ...entry,
      runningBalance,
    };
  });
}

export function buildApprovalQueueRows(
  dataset: OperationsDataset,
): ApprovalQueueRow[] {
  return [
    ...dataset.vendorAdjustments
      .filter((adjustment) => adjustment.status === "draft")
      .map((adjustment) => ({
        id: adjustment.id,
        category: "supplier_adjustment" as const,
        title: adjustment.adjustmentNumber,
        description: `${adjustment.vendorName} • ${adjustment.adjustmentType.replace(
          /_/g,
          " ",
        )}`,
        entryDate: adjustment.adjustmentDate,
        createdAt: adjustment.createdAt,
        amount: adjustment.amount,
        href: "/vendors/invoices",
      })),
    ...dataset.expenses
      .filter((expense) => expense.status === "draft")
      .map((expense) => ({
        id: expense.id,
        category: "expense" as const,
        title: expense.description,
        description: expense.category,
        entryDate: expense.date,
        createdAt: expense.createdAt,
        amount: expense.amount,
        href: "/admin/expenses",
      })),
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export function buildActionNotifications(
  dataset: OperationsDataset,
): ActionNotificationRow[] {
  const overdueInvoices = dataset.vendorInvoices.filter(
    (invoice) =>
      invoice.status === "overdue" && getOutstandingInvoiceBalance(invoice) > 0,
  );
  const draftAdjustments = dataset.vendorAdjustments.filter(
    (adjustment) => adjustment.status === "draft",
  );
  const draftExpenses = dataset.expenses.filter(
    (expense) => expense.status === "draft",
  );
  const notifications: ActionNotificationRow[] = [];

  if (overdueInvoices.length > 0) {
    notifications.push({
      id: "overdue-invoices",
      tone: "red",
      title: `${overdueInvoices.length} overdue vendor invoice${
        overdueInvoices.length === 1 ? "" : "s"
      } need attention`,
      detail: `${overdueInvoices
        .reduce(
          (sum, invoice) => sum + getOutstandingInvoiceBalance(invoice),
          0,
        )
        .toFixed(2)} remains unpaid across overdue invoices.`,
      href: "/vendors/invoices",
    });
  }

  if (draftAdjustments.length > 0) {
    notifications.push({
      id: "draft-adjustments",
      tone: "amber",
      title: `${draftAdjustments.length} supplier adjustment draft${
        draftAdjustments.length === 1 ? "" : "s"
      } waiting for approval`,
      detail: `${draftAdjustments
        .reduce((sum, adjustment) => sum + adjustment.amount, 0)
        .toFixed(2)} is still excluded from payables until approved.`,
      href: "/admin/approvals",
    });
  }

  if (draftExpenses.length > 0) {
    notifications.push({
      id: "draft-expenses",
      tone: "blue",
      title: `${draftExpenses.length} expense draft${
        draftExpenses.length === 1 ? "" : "s"
      } waiting for approval`,
      detail: `${draftExpenses
        .reduce((sum, expense) => sum + expense.amount, 0)
        .toFixed(2)} is still excluded from net profit.`,
      href: "/admin/approvals",
    });
  }

  return notifications;
}

export function buildBreakEvenRows(dataset: OperationsDataset): BreakEvenRow[] {
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);

  const unitsByProduct = new Map<string, number>();

  dataset.orders
    .filter((order) => order.createdAt >= monthAgo)
    .forEach((order) => {
      order.items.forEach((item) => {
        if (!item.productId) {
          return;
        }

        unitsByProduct.set(
          item.productId,
          (unitsByProduct.get(item.productId) ?? 0) + item.quantity,
        );
      });
    });

  return dataset.products
    .map((product) => {
      const profitPerUnit = product.price - product.cost;
      const inventoryInvestment = product.cost * Math.max(product.quantity, 0);
      const currentSalesVolume = unitsByProduct.get(product.id) ?? 0;
      const breakEvenUnits =
        profitPerUnit > 0 ? inventoryInvestment / profitPerUnit : null;
      const breakEvenRevenue =
        breakEvenUnits !== null ? breakEvenUnits * product.price : null;
      const dailyVelocity =
        currentSalesVolume > 0 ? currentSalesVolume / 30 : 0;
      const daysToBreakEven =
        breakEvenUnits !== null && dailyVelocity > 0
          ? breakEvenUnits / dailyVelocity
          : null;

      return {
        id: product.id,
        productName: product.name,
        sku: product.sku,
        inventoryInvestment,
        sellingPrice: product.price,
        profitPerUnit,
        breakEvenUnits,
        breakEvenRevenue,
        currentSalesVolume,
        margin: calculateProductMarginPercent(product),
        daysToBreakEven,
      };
    })
    .sort((left, right) => {
      if (left.daysToBreakEven === null) return 1;
      if (right.daysToBreakEven === null) return -1;
      return left.daysToBreakEven - right.daysToBreakEven;
    });
}

export function buildCostAlertRows(dataset: OperationsDataset): CostAlertRow[] {
  return dataset.products
    .map((product) => {
      const currentMargin = calculateProductMarginPercent(product);
      const marginGap = currentMargin - product.targetMarginPercent;
      const targetRatio = Math.min(
        Math.max(product.targetMarginPercent / 100, 0),
        0.95,
      );
      const recommendedPrice =
        targetRatio >= 1 ? null : product.cost / (1 - targetRatio);

      if (currentMargin >= product.targetMarginPercent && currentMargin > 0) {
        return null;
      }

      return {
        id: product.id,
        productName: product.name,
        productSku: product.sku,
        vendorName: product.supplierName ?? "Unassigned",
        currentCost: product.cost,
        currentPrice: product.price,
        currentMargin,
        targetMargin: product.targetMarginPercent,
        marginGap,
        quantityOnHand: product.quantity,
        recommendedPrice:
          recommendedPrice && Number.isFinite(recommendedPrice)
            ? recommendedPrice
            : null,
        detectedAt: product.updatedAt,
        severity:
          currentMargin <= 0 || marginGap <= -10 ? "critical" : "warning",
      };
    })
    .filter((alert): alert is CostAlertRow => alert !== null)
    .sort((left, right) => left.marginGap - right.marginGap);
}

export function buildOperationalActivityRows(
  dataset: OperationsDataset,
): OperationalActivityRow[] {
  const employeeMap = new Map(
    dataset.employees.map((employee) => [employee.id, employee]),
  );
  const rows: OperationalActivityRow[] = [];

  dataset.orders.forEach((order) => {
    const employee = order.createdBy ? employeeMap.get(order.createdBy) : null;

    rows.push({
      id: `order-${order.id}`,
      timestamp: order.createdAt,
      userName: employee?.name ?? "System",
      userRole: employee?.role ?? "system",
      action: "Sales order created",
      entity: "Sales Orders",
      details: `${order.orderNumber} via ${order.channel}`,
      status: "success",
    });
  });

  dataset.vendorPayments.forEach((payment) => {
    const isPosted = isPostedVendorPaymentStatus(payment.status);

    rows.push({
      id: `payment-${payment.id}`,
      timestamp: isPosted
        ? payment.paymentDate
        : (payment.voidedAt ?? payment.updatedAt),
      userName: "System",
      userRole: "accounting",
      action: isPosted ? "Vendor payment recorded" : "Vendor payment voided",
      entity: "Vendor Payments",
      details:
        `${payment.vendorName} ${payment.invoiceNumber ? `for ${payment.invoiceNumber}` : ""}`.trim(),
      status: isPosted ? "success" : "warning",
    });
  });

  dataset.vendorInvoices.forEach((invoice) => {
    rows.push({
      id: `invoice-${invoice.id}`,
      timestamp: invoice.updatedAt,
      userName: "System",
      userRole: "accounts payable",
      action:
        invoice.status === "overdue"
          ? "Vendor invoice overdue"
          : "Vendor invoice updated",
      entity: "Vendor Invoices",
      details: `${invoice.invoiceNumber} from ${invoice.vendorName}`,
      status: invoice.status === "overdue" ? "warning" : "success",
    });
  });

  dataset.vendorAdjustments.forEach((adjustment) => {
    rows.push({
      id: `adjustment-${adjustment.id}`,
      timestamp:
        adjustment.status === "void"
          ? (adjustment.voidedAt ?? adjustment.updatedAt)
          : adjustment.adjustmentDate,
      userName: "System",
      userRole: "accounts payable",
      action:
        adjustment.status === "void"
          ? "Supplier adjustment voided"
          : adjustment.status === "approved"
            ? "Supplier adjustment approved"
            : "Supplier adjustment drafted",
      entity: "Vendor Adjustments",
      details: `${adjustment.adjustmentNumber} for ${adjustment.vendorName}`,
      status:
        adjustment.status === "void"
          ? "warning"
          : adjustment.inventoryImpact
            ? "warning"
            : "success",
    });
  });

  dataset.salesReconciliations.forEach((reconciliation) => {
    const employee = employeeMap.get(reconciliation.reconciliedBy);

    rows.push({
      id: `reconciliation-${reconciliation.id}`,
      timestamp: reconciliation.reconciliedAt,
      userName: employee?.name ?? "System",
      userRole: employee?.role ?? "system",
      action: "Sales day reconciled",
      entity: "Sales Reconciliation",
      details: `${reconciliation.date.toLocaleDateString("en-US", { timeZone: "UTC" })} variance ${reconciliation.variance.toFixed(2)}`,
      status: reconciliation.variance === 0 ? "success" : "warning",
    });
  });

  dataset.purchaseOrders.forEach((purchaseOrder) => {
    rows.push({
      id: `po-${purchaseOrder.id}`,
      timestamp: purchaseOrder.updatedAt,
      userName: "System",
      userRole: "procurement",
      action:
        purchaseOrder.status === "Delayed"
          ? "Purchase order delayed"
          : "Purchase order updated",
      entity: "Purchase Orders",
      details: `${purchaseOrder.poNumber} with ${purchaseOrder.supplierName}`,
      status: purchaseOrder.status === "Delayed" ? "warning" : "success",
    });
  });

  dataset.expenses.forEach((expense) => {
    rows.push({
      id: `expense-${expense.id}`,
      timestamp: expense.createdAt,
      userName: "System",
      userRole: "finance",
      action: "Expense recorded",
      entity: "Expenses",
      details: `${expense.category} ${expense.amount.toFixed(2)}`,
      status: "success",
    });
  });

  return rows
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime())
    .slice(0, 40);
}

export function buildTopProductRows(dataset: OperationsDataset, limit = 5) {
  const productMap = new Map(
    dataset.products.map((product) => [product.id, product]),
  );
  const totals = new Map<
    string,
    { name: string; sku: string; units: number; revenue: number }
  >();

  dataset.orders.forEach((order) => {
    order.items.forEach((item) => {
      if (!item.productId) {
        return;
      }

      const product = productMap.get(item.productId);

      if (!product) {
        return;
      }

      const current = totals.get(item.productId) ?? {
        name: product.name,
        sku: product.sku,
        units: 0,
        revenue: 0,
      };

      current.units += item.quantity;
      current.revenue += item.total;
      totals.set(item.productId, current);
    });
  });

  return Array.from(totals.values())
    .sort((left, right) => right.units - left.units)
    .slice(0, limit);
}

export function buildExecutiveAlerts(dataset: OperationsDataset) {
  const overduePayables = dataset.vendorInvoices
    .filter((invoice) => invoice.status === "overdue")
    .reduce((sum, invoice) => sum + getOutstandingInvoiceBalance(invoice), 0);
  const availableSupplierCredits = dataset.suppliers.reduce(
    (sum, supplier) => sum + getSupplierAvailableCredit(dataset, supplier.id),
    0,
  );
  const lowMarginCount = buildCostAlertRows(dataset).length;
  const delayedPurchaseOrders = dataset.purchaseOrders.filter(
    (purchaseOrder) => purchaseOrder.status === "Delayed",
  ).length;
  const unreconciledSalesDays = dataset.salesSummaries.filter(
    (summary) => !summary.reconciled,
  ).length;
  const draftExpenseCount = dataset.expenses.filter(
    (expense) => expense.status === "draft",
  ).length;

  return [
    overduePayables > 0
      ? `${overduePayables.toFixed(2)} in overdue payables`
      : null,
    availableSupplierCredits > 0
      ? `${availableSupplierCredits.toFixed(2)} in supplier credits available`
      : null,
    lowMarginCount > 0
      ? `${lowMarginCount} products below target margin`
      : null,
    delayedPurchaseOrders > 0
      ? `${delayedPurchaseOrders} delayed purchase orders`
      : null,
    unreconciledSalesDays > 0
      ? `${unreconciledSalesDays} sales days still unreconciled`
      : null,
    draftExpenseCount > 0
      ? `${draftExpenseCount} expenses still in draft`
      : null,
  ].filter((alert): alert is string => alert !== null);
}

export function calculateCashOnHand(dataset: OperationsDataset): number {
  if (dataset.cashVaultTransactions.length > 0) {
    return dataset.cashVaultTransactions.reduce(
      (sum, transaction) => sum + transaction.amount,
      0,
    );
  }

  const cashSales = dataset.salesSummaries.reduce(
    (sum, s) => sum + s.cashSales,
    0,
  );
  const salesPayouts = dataset.salesReconciliations
    .filter((reconciliation) => reconciliation.status === "approved")
    .reduce((sum, reconciliation) => sum + reconciliation.totalPayouts, 0);
  const salesVariance = dataset.salesReconciliations
    .filter((reconciliation) => reconciliation.status === "approved")
    .reduce((sum, reconciliation) => sum + reconciliation.variance, 0);
  const cashExpenses = dataset.expenses
    .filter((e) => e.status === "approved" && e.paymentMethod === "cash")
    .reduce((sum, e) => sum + e.amount, 0);
  const cashVendorPayments = dataset.vendorPayments
    .filter(
      (payment) =>
        payment.status === "posted" && payment.paymentMethod === "cash",
    )
    .reduce((sum, payment) => sum + payment.amountPaid, 0);
  const cashPayrollPayments = dataset.cashPayrollPayments.reduce(
    (sum, payment) => sum + payment.netPay,
    0,
  );
  const totalDeposits = dataset.bankDeposits
    .filter((deposit) => deposit.status !== "void")
    .reduce((sum, d) => sum + d.amount, 0);

  return (
    cashSales -
    salesPayouts -
    salesVariance -
    cashExpenses -
    cashVendorPayments -
    cashPayrollPayments -
    totalDeposits
  );
}

export function buildScheduleCoverageNotice(dataset: OperationsDataset) {
  const activeEmployees = dataset.employees.filter(
    (employee) => employee.status === "active",
  );
  const latestSalesEntry = dataset.salesSummaries[0];

  if (!latestSalesEntry) {
    return "No recent attendance or scheduling records are available yet.";
  }

  const ageInDays = daysBetween(latestSalesEntry.date, new Date());

  if (ageInDays > 7) {
    return "Recent attendance or shift records are not available in Supabase.";
  }

  return `${activeEmployees.length} active employees with recent operational activity recorded.`;
}
