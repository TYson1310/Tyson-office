import { unstable_noStore as noStore } from "next/cache";
import type {
  BankDeposit,
  CashSource,
  CashVaultTransaction,
  DailyReconciliation,
  DailySalesSummary,
  ExpenseCategoryBudget,
  DailyTransaction,
  ExpenseRecord,
  ExpenseRecordStatus,
  InventoryMovement,
  Order,
  PaymentMethod,
  Product,
  RecurringExpenseTemplate,
  Supplier,
  UserRole,
  VendorAdjustment,
  VendorPayment,
  Invoice,
} from "@/types/erp.types";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  getExpenseDocumentDownloadHref,
  getExpenseDocumentHref,
} from "@/lib/expenses/documents";
import { requireActiveStoreContext } from "@/lib/stores/server";
import { normalizeExpenseCategory } from "@/lib/expenses/categories";
import { isPostedVendorAdjustmentStatus } from "@/lib/vendors/adjustments";
import { getVendorDocumentHref } from "@/lib/vendors/documents";
import {
  isPostedVendorPaymentStatus,
  normalizeVendorPaymentMethod,
} from "@/lib/vendors/payments";
import {
  addDaysToIsoDateKey,
  dateKeyToUtcNoonDate,
  formatDateOnly,
  getIsoDateKeyInTimeZone,
  getTodayIsoDateInTimeZone,
  parseStoredDate,
  toIsoDateKey,
} from "@/lib/date-time";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type QueryCollectionResult<T> = {
  data: T[] | null;
  error: { message?: string | null } | null;
};
type CompatibilityQueryCollectionResult<T> = QueryCollectionResult<T> & {
  compatibilityWarnings?: string[];
};

export type DataSource = "database" | "unconfigured" | "error";

const INVENTORY_MOVEMENT_HISTORY_LIMIT = 5000;
const INVENTORY_MOVEMENT_PAGE_SIZE = 1000;
const PRODUCT_CATALOG_LIMIT = 10000;
const PRODUCT_CATALOG_PAGE_SIZE = 1000;

export type OperationsEmployee = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: "active" | "inactive" | "on-leave";
  department?: string;
  positionTitle?: string;
  employeeNumber?: string;
  payFrequency?: string;
};

export type OperationsProduct = Product & {
  supplierId?: string;
  supplierName?: string;
  location?: string;
  dailyVelocity: number;
  targetMarginPercent: number;
};

export type OperationsSupplier = Supplier & {
  contact: string;
  category?: string;
  paymentTermsLabel?: string;
  accountNumber?: string;
  status: "active" | "inactive" | "blacklisted";
  reliabilityPercent: number;
  leadTimeDays: number;
};

export type OperationsOrder = {
  id: string;
  orderNumber: string;
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerSegment?: string;
  channel: string;
  itemCount: number;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentStatus: "Paid" | "Pending" | "Overdue";
  fulfillmentStatus: "Ready" | "Picking" | "Packed" | "Delivered";
  paymentMethod?: PaymentMethod;
  promisedDate?: Date;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
  items: {
    id: string;
    orderId: string;
    productId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
  }[];
};

export type OperationsPurchaseOrder = {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  lineCount: number;
  amount: number;
  eta?: Date;
  status: "Open" | "Approved" | "Delayed" | "Received";
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type OperationsVendorInvoice = Invoice & {
  vendorName: string;
  vendorEmail?: string;
  paidAmount: number;
  status: "pending" | "paid" | "overdue" | "cancelled";
  adjustmentAmount: number;
  netBalance: number;
};

export type OperationsVendorPayment = VendorPayment & {
  vendorName: string;
  invoiceNumber?: string;
};

export type OperationsVendorAdjustment = VendorAdjustment & {
  vendorName: string;
  invoiceNumber?: string;
};

export type OperationsInventoryMovement = InventoryMovement & {
  adjustmentNumber?: string;
};

export type OperationsRecurringExpenseTemplate = RecurringExpenseTemplate;
export type OperationsExpenseCategoryBudget = ExpenseCategoryBudget;

export type OperationsExpense = ExpenseRecord;

export type OperationsSalesEntry = DailyTransaction;

export type OperationsSalesSummary = DailySalesSummary;

export type OperationsSalesReconciliation = DailyReconciliation;

export type OperationsPayrollDue = {
  id: string;
  employeeId: string;
  employeeName: string;
  periodLabel: string;
  payDate: Date;
  netPay: number;
  status: "Scheduled" | "Draft";
};

export type OperationsCashPayrollPayment = {
  id: string;
  employeeId: string;
  employeeName: string;
  periodLabel: string;
  payDate: Date;
  netPay: number;
};

export type OperationsBankDeposit = BankDeposit;

export type OperationsCashVaultTransaction = CashVaultTransaction;

export type SalesSeriesPoint = {
  currentDateLabel?: string;
  label: string;
  previousDateLabel?: string;
  previousValue?: number;
  value: number;
};

export type OperationsDataset = {
  source: DataSource;
  compatibilityMode: boolean;
  compatibilityWarnings: string[];
  employees: OperationsEmployee[];
  products: OperationsProduct[];
  suppliers: OperationsSupplier[];
  orders: OperationsOrder[];
  purchaseOrders: OperationsPurchaseOrder[];
  vendorInvoices: OperationsVendorInvoice[];
  vendorPayments: OperationsVendorPayment[];
  vendorAdjustments: OperationsVendorAdjustment[];
  inventoryMovements: OperationsInventoryMovement[];
  recurringExpenseTemplates: OperationsRecurringExpenseTemplate[];
  expenseCategoryBudgets: OperationsExpenseCategoryBudget[];
  expenses: OperationsExpense[];
  salesEntries: OperationsSalesEntry[];
  salesSummaries: OperationsSalesSummary[];
  salesReconciliations: OperationsSalesReconciliation[];
  payrollDues: OperationsPayrollDue[];
  cashPayrollPayments: OperationsCashPayrollPayment[];
  bankDeposits: OperationsBankDeposit[];
  cashVaultTransactions: OperationsCashVaultTransaction[];
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole | null;
  status: "active" | "inactive" | "on-leave" | null;
  department: string | null;
  position_title: string | null;
  employee_number: string | null;
  pay_frequency: string | null;
};

type RelatedRecord<T> = T | T[] | null;

type ProductRow = {
  id: string;
  supplier_id: string | null;
  name: string;
  description: string | null;
  sku: string;
  barcode?: string | null;
  category: string;
  price: number | string;
  cost: number | string;
  quantity: number;
  items_per_pack: number | string;
  reorder_level: number;
  location: string | null;
  daily_velocity: number | string;
  target_margin_percent: number | string;
  created_at: string;
  updated_at: string;
  suppliers?: RelatedRecord<{ id: string; name: string }>;
};

async function fetchProductsResult(
  supabase: SupabaseServerClient,
  storeKey: string,
): Promise<CompatibilityQueryCollectionResult<ProductRow>> {
  const selectWithBarcode =
    "id,supplier_id,name,description,sku,barcode,category,price,cost,quantity,items_per_pack,reorder_level,location,daily_velocity,target_margin_percent,created_at,updated_at,suppliers(id,name)";
  const selectLegacy =
    "id,supplier_id,name,description,sku,category,price,cost,quantity,items_per_pack,reorder_level,location,daily_velocity,target_margin_percent,created_at,updated_at,suppliers(id,name)";

  const fetchPagedProducts = async (selectClause: string) => {
    const rows: ProductRow[] = [];

    for (
      let from = 0;
      from < PRODUCT_CATALOG_LIMIT;
      from += PRODUCT_CATALOG_PAGE_SIZE
    ) {
      const to = Math.min(
        from + PRODUCT_CATALOG_PAGE_SIZE - 1,
        PRODUCT_CATALOG_LIMIT - 1,
      );
      const page = await supabase
        .from("products")
        .select(selectClause)
        .eq("store_key", storeKey)
        .order("name", { ascending: true })
        .range(from, to);

      if (page.error) {
        return {
          data: rows,
          error: page.error,
        } satisfies QueryCollectionResult<ProductRow>;
      }

      rows.push(...((page.data ?? []) as unknown as ProductRow[]));

      if ((page.data ?? []).length < PRODUCT_CATALOG_PAGE_SIZE) {
        break;
      }
    }

    return {
      data: rows,
      error: null,
    } satisfies QueryCollectionResult<ProductRow>;
  };

  const result = await fetchPagedProducts(selectWithBarcode);

  if (
    result.error &&
    isMissingSchemaField(result.error, "products", ["barcode"])
  ) {
    const legacy = await fetchPagedProducts(selectLegacy);

    if (!legacy.error) {
      return {
        data: (legacy.data ?? []).map((row) => ({
          ...row,
          barcode: null,
        })),
        error: null,
        compatibilityWarnings: [
          "Product UPC/barcode fields are unavailable until the product barcode migration is applied.",
        ],
      };
    }
  }

  return result as CompatibilityQueryCollectionResult<ProductRow>;
}

type SupplierRow = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  category: string | null;
  payment_terms: "net30" | "net60" | "net90" | "cod" | "prepaid";
  account_number: string | null;
  status: "active" | "inactive" | "blacklisted";
  rating: number | string;
  reliability_percent: number | string;
  lead_time_days: number;
  created_at: string;
  updated_at: string;
};

type SalesOrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  description: string | null;
  quantity: number;
  unit_price: number | string;
  discount: number | string | null;
  total: number | string;
};

type SalesOrderRow = {
  id: string;
  order_number: string;
  customer_id: string | null;
  channel: string;
  item_count: number;
  subtotal: number | string;
  tax: number | string;
  discount: number | string;
  total: number | string;
  payment_status: "Paid" | "Pending" | "Overdue";
  fulfillment_status: "Ready" | "Picking" | "Packed" | "Delivered";
  payment_method: PaymentMethod | null;
  promised_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  customers?: RelatedRecord<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    segment: string | null;
  }>;
  sales_order_items?: SalesOrderItemRow[] | null;
};

type PurchaseOrderRow = {
  id: string;
  po_number: string;
  supplier_id: string;
  line_count: number;
  amount: number | string;
  eta: string | null;
  status: "Open" | "Approved" | "Delayed" | "Received";
  notes: string | null;
  created_at: string;
  updated_at: string;
  suppliers?: RelatedRecord<{ id: string; name: string }>;
};

type VendorInvoiceRow = {
  id: string;
  supplier_id: string;
  invoice_number: string;
  amount: number | string;
  currency: string;
  issue_date: string;
  due_date: string;
  pdf_file_name?: string | null;
  pdf_mime_type?: string | null;
  pdf_path?: string | null;
  pdf_url: string | null;
  description: string | null;
  status: "pending" | "paid" | "overdue" | "cancelled";
  paid_amount: number | string;
  notes: string | null;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
  suppliers?: RelatedRecord<{ id: string; name: string; email: string | null }>;
};

type VendorPaymentRow = {
  id: string;
  supplier_id: string;
  vendor_invoice_id: string | null;
  status: "posted" | "void";
  amount_paid: number | string;
  payment_date: string;
  payment_method: string;
  reference_number: string;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
  suppliers?: RelatedRecord<{ id: string; name: string }>;
  vendor_invoices?: RelatedRecord<{ id: string; invoice_number: string }>;
};

type LegacyVendorPaymentRow = Omit<
  VendorPaymentRow,
  "status" | "voided_by" | "voided_at"
>;

type VendorAdjustmentItemRow = {
  id: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_cost: number | string;
  amount: number | string;
};

type VendorAdjustmentRow = {
  id: string;
  supplier_id: string;
  vendor_invoice_id: string | null;
  adjustment_number: string;
  adjustment_type:
    | "return"
    | "credit_note"
    | "shortage"
    | "damage"
    | "rebate"
    | "other";
  amount: number | string;
  currency: string;
  adjustment_date: string;
  reason: string | null;
  notes: string | null;
  status: "draft" | "approved" | "void";
  inventory_impact: boolean;
  approved_by: string | null;
  approved_at: string | null;
  voided_by: string | null;
  voided_at: string | null;
  attachment_name: string | null;
  attachment_path?: string | null;
  attachment_mime_type?: string | null;
  attachment_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  suppliers?: RelatedRecord<{ id: string; name: string }>;
  vendor_invoices?: RelatedRecord<{ id: string; invoice_number: string }>;
  vendor_adjustment_items?: VendorAdjustmentItemRow[] | null;
};

type LegacyVendorAdjustmentRow = Omit<
  VendorAdjustmentRow,
  | "status"
  | "approved_by"
  | "approved_at"
  | "voided_by"
  | "voided_at"
  | "attachment_name"
  | "attachment_url"
>;

type InventoryMovementRow = {
  id: string;
  product_id: string | null;
  vendor_adjustment_id: string | null;
  vendor_invoice_id?: string | null;
  movement_type:
    | "vendor_return"
    | "vendor_return_reversal"
    | "manual_adjustment"
    | "vendor_invoice_receipt";
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  unit_cost: number | string;
  total_amount: number | string;
  product_name: string;
  product_sku: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  vendor_adjustments?: RelatedRecord<{ id: string; adjustment_number: string }>;
  vendor_invoices?: RelatedRecord<{
    id: string;
    invoice_number: string;
    supplier_id?: string | null;
    suppliers?: RelatedRecord<{ id: string; name: string }>;
  }>;
};

type ExpenseRow = {
  id: string;
  category: string;
  amount: number | string;
  subtotal_amount: number | string | null;
  tax_amount: number | string | null;
  description: string;
  supplier_id: string | null;
  vendor_name: string | null;
  payment_method: string | null;
  notes: string | null;
  approval_note: string | null;
  void_note: string | null;
  recurring_template_id: string | null;
  recurring_period_month: string | null;
  attachment_name: string | null;
  attachment_path: string | null;
  attachment_url: string | null;
  status: ExpenseRecordStatus | null;
  expense_date: string;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type LegacyExpenseRow = Omit<
  ExpenseRow,
  | "subtotal_amount"
  | "tax_amount"
  | "supplier_id"
  | "vendor_name"
  | "payment_method"
  | "notes"
  | "approval_note"
  | "void_note"
  | "recurring_template_id"
  | "recurring_period_month"
  | "attachment_name"
  | "attachment_path"
  | "attachment_url"
  | "status"
  | "approved_at"
  | "created_by"
>;

type RecurringExpenseTemplateRow = {
  id: string;
  category: string;
  default_amount: number | string;
  default_tax_amount: number | string | null;
  description: string;
  due_day_of_month: number;
  supplier_id: string | null;
  vendor_name: string | null;
  payment_method: string | null;
  notes: string | null;
  active: boolean | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type ExpenseCategoryBudgetRow = {
  id: string;
  category: string;
  budget_month: string;
  budget_amount: number | string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type DailySalesSummaryRow = {
  id: string;
  business_date: string;
  gross_sales: number | string;
  payment_total: number | string;
  product_total: number | string;
  cash_sales: number | string;
  cashless_sales: number | string;
  line_count: number | null;
  payment_breakdown: Record<string, number | string> | null;
  product_breakdown: Record<string, number | string> | null;
  reconciled: boolean;
  reconciled_by: string | null;
  reconciled_at: string | null;
  created_at: string;
  updated_at: string;
};

type DailySalesReconciliationRow = {
  id: string;
  reconciliation_date: string;
  opening_float: number | string;
  closing_float: number | string;
  cash_counted: number | string;
  total_payouts: number | string;
  total_cash_sales: number | string;
  total_card_sales: number | string;
  total_expected: number | string;
  total_actual: number | string;
  variance: number | string;
  variance_percent: number | string;
  product_breakdown: Record<string, number> | null;
  reconciled_by: string | null;
  reconciled_at: string;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
};

type PayrollDueRow = {
  id: string;
  employee_id: string;
  period_label: string;
  pay_date: string;
  net_pay: number | string;
  status: "scheduled" | "draft" | "paid";
  payment_method: string | null;
  created_at: string;
  updated_at: string;
};

type BankDepositRow = {
  id: string;
  amount: number | string;
  cash_source?: CashSource | null;
  deposit_date: string;
  notes: string | null;
  slip_photo_url: string | null;
  slip_photo_path: string | null;
  status?: "posted" | "void" | null;
  void_reason?: string | null;
  voided_by?: string | null;
  voided_at?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type CashVaultTransactionRow = {
  id: string;
  source_table: string;
  source_id: string;
  movement_type:
    | "cash_sale"
    | "sales_payout"
    | "cash_variance"
    | "cash_expense"
    | "vendor_payment_cash"
    | "payroll_cash"
    | "bank_deposit"
    | "lottery_cash_advance_to_vault"
    | "lottery_cash_advance_payback_from_vault"
    | "opening_balance"
    | "manual_adjustment";
  cash_source?: CashSource | null;
  business_date: string;
  amount: number | string;
  details: string;
  metadata: Record<string, unknown> | null;
  recorded_at: string;
  created_at: string;
  updated_at: string;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

export function formatDate(value: Date, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
    year: "numeric",
  }).format(value);
}

export function formatShortDate(value: Date, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(value);
}

export function formatMonthLabel(value: Date, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
    timeZone,
  }).format(value);
}

export function getInventoryStatus(
  product: Pick<OperationsProduct, "quantity" | "reorderLevel">,
) {
  if (product.quantity <= 0) {
    return "Backorder";
  }

  if (product.quantity <= Math.max(1, Math.floor(product.reorderLevel / 2))) {
    return "Critical";
  }

  if (product.quantity <= product.reorderLevel) {
    return "Reorder";
  }

  return "Healthy";
}

export function getInvoiceNetBalance(
  invoice: Pick<OperationsVendorInvoice, "amount" | "paidAmount"> & {
    adjustmentAmount?: number;
    netBalance?: number;
  },
) {
  if (typeof invoice.netBalance === "number") {
    return invoice.netBalance;
  }

  return (
    invoice.amount - (invoice.paidAmount ?? 0) - (invoice.adjustmentAmount ?? 0)
  );
}

export function getOutstandingInvoiceBalance(
  invoice: Pick<OperationsVendorInvoice, "amount" | "paidAmount"> & {
    adjustmentAmount?: number;
    netBalance?: number;
  },
) {
  return Math.max(getInvoiceNetBalance(invoice), 0);
}

export function getSupplierAdjustmentTotal(
  dataset: OperationsDataset,
  supplierId: string,
) {
  return dataset.vendorAdjustments
    .filter(
      (adjustment) =>
        adjustment.vendorId === supplierId &&
        isPostedVendorAdjustmentStatus(adjustment.status),
    )
    .reduce((sum, adjustment) => sum + adjustment.amount, 0);
}

export function getSupplierPaymentTotal(
  dataset: OperationsDataset,
  supplierId: string,
) {
  return dataset.vendorPayments
    .filter(
      (payment) =>
        payment.vendorId === supplierId &&
        isPostedVendorPaymentStatus(payment.status),
    )
    .reduce((sum, payment) => sum + payment.amountPaid, 0);
}

export function getSupplierNetPayable(
  dataset: OperationsDataset,
  supplierId: string,
) {
  const invoiceBalance = dataset.vendorInvoices
    .filter((invoice) => invoice.vendorId === supplierId)
    .reduce((sum, invoice) => sum + getInvoiceNetBalance(invoice), 0);
  const unallocatedAdjustments = dataset.vendorAdjustments
    .filter(
      (adjustment) =>
        adjustment.vendorId === supplierId &&
        !adjustment.invoiceId &&
        isPostedVendorAdjustmentStatus(adjustment.status),
    )
    .reduce((sum, adjustment) => sum + adjustment.amount, 0);

  return invoiceBalance - unallocatedAdjustments;
}

export function getSupplierAvailableCredit(
  dataset: OperationsDataset,
  supplierId: string,
) {
  return Math.max(-getSupplierNetPayable(dataset, supplierId), 0);
}

export function calculateProductMarginPercent(
  product: Pick<OperationsProduct, "price" | "cost">,
) {
  if (product.price <= 0) {
    return 0;
  }

  return ((product.price - product.cost) / product.price) * 100;
}

export function getSupplierOpenBalance(
  dataset: OperationsDataset,
  supplierId: string,
) {
  return Math.max(getSupplierNetPayable(dataset, supplierId), 0);
}

export function getSupplierActivePurchaseOrders(
  dataset: OperationsDataset,
  supplierId: string,
) {
  return dataset.purchaseOrders.filter(
    (order) => order.supplierId === supplierId && order.status !== "Received",
  ).length;
}

export function calculateOrderCost(
  order: OperationsOrder,
  products: OperationsProduct[],
) {
  const productMap = new Map(products.map((product) => [product.id, product]));

  return order.items.reduce((sum, item) => {
    if (!item.productId) {
      return sum;
    }

    const product = productMap.get(item.productId);
    if (!product) {
      return sum;
    }

    return sum + product.cost * item.quantity;
  }, 0);
}

export function getMonthToDateFinancials(
  dataset: OperationsDataset,
  options: { startDate?: Date; startDateKey?: string; timeZone?: string } = {},
) {
  const start = options.startDate ?? startOfMonth(new Date());
  const startDateKey = options.startDateKey ?? toIsoDateKey(start);
  const timeZone = options.timeZone ?? "UTC";
  const isOnOrAfterStart = (value: Date) => {
    if (!startDateKey) {
      return value >= start;
    }

    const valueDateKey =
      getIsoDateKeyInTimeZone(value, timeZone) ?? toIsoDateKey(value);

    return Boolean(valueDateKey && valueDateKey >= startDateKey);
  };
  const monthOrders = dataset.orders.filter((order) =>
    isOnOrAfterStart(order.createdAt),
  );
  const revenue = monthOrders.reduce((sum, order) => sum + order.total, 0);
  const cogs = monthOrders.reduce(
    (sum, order) => sum + calculateOrderCost(order, dataset.products),
    0,
  );
  const grossProfit = revenue - cogs;
  const expenses = dataset.expenses
    .filter(
      (expense) =>
        expense.status === "approved" && isOnOrAfterStart(expense.date),
    )
    .reduce((sum, expense) => sum + expense.amount, 0);
  const netProfit = grossProfit - expenses;

  return {
    revenue,
    cogs,
    grossProfit,
    grossMarginPercent: revenue === 0 ? 0 : (grossProfit / revenue) * 100,
    expenses,
    netProfit,
    netMarginPercent: revenue === 0 ? 0 : (netProfit / revenue) * 100,
  };
}

export function buildSalesSeries(
  summaries: OperationsSalesSummary[],
  timeZone = "UTC",
) {
  const todayKey = getTodayIsoDateInTimeZone(timeZone);
  const salesByDate = new Map<string, number>();

  summaries.forEach((summary) => {
    const dateKey = toIsoDateKey(summary.date);

    if (!dateKey) {
      return;
    }

    salesByDate.set(
      dateKey,
      (salesByDate.get(dateKey) ?? 0) + summary.grossSales,
    );
  });

  const getSalesForDate = (dateKey: string) => salesByDate.get(dateKey) ?? 0;
  const daily = Array.from({ length: 7 }, (_, index) => {
    const dateKey = addDaysToIsoDateKey(todayKey, -(6 - index));
    const previousDateKey = addDaysToIsoDateKey(dateKey, -7);

    return {
      currentDateLabel: formatDateOnly(
        dateKey,
        { day: "numeric", month: "short", weekday: "short" },
        dateKey,
      ),
      label: formatDateOnly(dateKey, { weekday: "short" }, dateKey),
      previousDateLabel: formatDateOnly(
        previousDateKey,
        { day: "numeric", month: "short", weekday: "short" },
        previousDateKey,
      ),
      previousValue: getSalesForDate(previousDateKey),
      value: getSalesForDate(dateKey),
    };
  });

  const now = dateKeyToUtcNoonDate(todayKey);
  const monthly = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
    const monthKey = date.toISOString().slice(0, 7);
    const value = summaries
      .filter((summary) => toIsoDateKey(summary.date)?.slice(0, 7) === monthKey)
      .reduce((sum, summary) => sum + summary.grossSales, 0);

    return {
      label: formatMonthLabel(date),
      value,
    };
  });

  const yearly = Array.from({ length: 4 }, (_, index) => {
    const year = now.getFullYear() - (3 - index);
    const yearKey = String(year);
    const value = summaries
      .filter((summary) => toIsoDateKey(summary.date)?.slice(0, 4) === yearKey)
      .reduce((sum, summary) => sum + summary.grossSales, 0);

    return {
      label: `${year}`,
      value,
    };
  });

  return { daily, monthly, yearly };
}

function getSupabaseErrorMessage(
  error: { message?: string | null } | null | undefined,
) {
  return error?.message?.toLowerCase() ?? "";
}

function isMissingSchemaField(
  error: { message?: string | null } | null | undefined,
  relation: string,
  fields: string[],
) {
  const message = getSupabaseErrorMessage(error);
  return (
    (message.includes("does not exist") || message.includes("schema cache")) &&
    message.includes(relation.toLowerCase()) &&
    fields.some((field) => message.includes(field.toLowerCase()))
  );
}

function isMissingRelation(
  error: { message?: string | null } | null | undefined,
  relation: string,
) {
  const message = getSupabaseErrorMessage(error);
  return (
    (message.includes("does not exist") || message.includes("schema cache")) &&
    message.includes(relation.toLowerCase())
  );
}

async function fetchVendorPaymentsResult(
  supabase: SupabaseServerClient,
  storeKey: string,
): Promise<CompatibilityQueryCollectionResult<VendorPaymentRow>> {
  const primary = await supabase
    .from("vendor_payments")
    .select(
      "id,supplier_id,vendor_invoice_id,status,amount_paid,payment_date,payment_method,reference_number,notes,approved_by,approved_at,voided_by,voided_at,created_at,updated_at,suppliers(id,name),vendor_invoices(id,invoice_number)",
    )
    .eq("store_key", storeKey)
    .order("payment_date", { ascending: false });

  if (
    !primary.error ||
    !isMissingSchemaField(primary.error, "vendor_payments", [
      "status",
      "voided_by",
      "voided_at",
    ])
  ) {
    return primary as CompatibilityQueryCollectionResult<VendorPaymentRow>;
  }

  const legacy = await supabase
    .from("vendor_payments")
    .select(
      "id,supplier_id,vendor_invoice_id,amount_paid,payment_date,payment_method,reference_number,notes,approved_by,approved_at,created_at,updated_at,suppliers(id,name),vendor_invoices(id,invoice_number)",
    )
    .eq("store_key", storeKey)
    .order("payment_date", { ascending: false });

  if (legacy.error) {
    return legacy as CompatibilityQueryCollectionResult<VendorPaymentRow>;
  }

  return {
    data: ((legacy.data ?? []) as LegacyVendorPaymentRow[]).map((row) => ({
      ...row,
      status: "posted",
      voided_by: null,
      voided_at: null,
    })),
    error: null,
    compatibilityWarnings: [
      "Vendor payments are running without posted and void status fields.",
    ],
  };
}

async function fetchVendorInvoicesResult(
  supabase: SupabaseServerClient,
  storeKey: string,
): Promise<CompatibilityQueryCollectionResult<VendorInvoiceRow>> {
  const primary = await supabase
    .from("vendor_invoices")
    .select(
      "id,supplier_id,invoice_number,amount,currency,issue_date,due_date,pdf_file_name,pdf_mime_type,pdf_path,pdf_url,description,status,paid_amount,notes,uploaded_at,created_at,updated_at,suppliers(id,name,email)",
    )
    .eq("store_key", storeKey)
    .order("due_date", { ascending: true });

  if (
    !primary.error ||
    !isMissingSchemaField(primary.error, "vendor_invoices", [
      "pdf_file_name",
      "pdf_mime_type",
      "pdf_path",
    ])
  ) {
    return primary as CompatibilityQueryCollectionResult<VendorInvoiceRow>;
  }

  const legacy = await supabase
    .from("vendor_invoices")
    .select(
      "id,supplier_id,invoice_number,amount,currency,issue_date,due_date,pdf_url,description,status,paid_amount,notes,uploaded_at,created_at,updated_at,suppliers(id,name,email)",
    )
    .eq("store_key", storeKey)
    .order("due_date", { ascending: true });

  if (legacy.error) {
    return legacy as CompatibilityQueryCollectionResult<VendorInvoiceRow>;
  }

  return {
    data: ((legacy.data ?? []) as VendorInvoiceRow[]).map((row) => ({
      ...row,
      pdf_file_name: null,
      pdf_mime_type: null,
      pdf_path: null,
    })),
    error: null,
    compatibilityWarnings: [
      "Vendor invoice documents are running without private storage path fields.",
    ],
  };
}

async function fetchVendorAdjustmentsResult(
  supabase: SupabaseServerClient,
  storeKey: string,
): Promise<CompatibilityQueryCollectionResult<VendorAdjustmentRow>> {
  const primary = await supabase
    .from("vendor_adjustments")
    .select(
      "id,supplier_id,vendor_invoice_id,adjustment_number,adjustment_type,amount,currency,adjustment_date,reason,notes,status,inventory_impact,approved_by,approved_at,voided_by,voided_at,attachment_name,attachment_path,attachment_url,attachment_mime_type,created_by,created_at,updated_at,suppliers(id,name),vendor_invoices(id,invoice_number),vendor_adjustment_items(id,product_id,description,quantity,unit_cost,amount)",
    )
    .eq("store_key", storeKey)
    .order("adjustment_date", { ascending: false });

  if (
    !primary.error ||
    !isMissingSchemaField(primary.error, "vendor_adjustments", [
      "status",
      "approved_by",
      "approved_at",
      "voided_by",
      "voided_at",
      "attachment_name",
      "attachment_path",
      "attachment_url",
      "attachment_mime_type",
    ])
  ) {
    return primary as CompatibilityQueryCollectionResult<VendorAdjustmentRow>;
  }

  const legacy = await supabase
    .from("vendor_adjustments")
    .select(
      "id,supplier_id,vendor_invoice_id,adjustment_number,adjustment_type,amount,currency,adjustment_date,reason,notes,inventory_impact,created_by,created_at,updated_at,suppliers(id,name),vendor_invoices(id,invoice_number),vendor_adjustment_items(id,product_id,description,quantity,unit_cost,amount)",
    )
    .eq("store_key", storeKey)
    .order("adjustment_date", { ascending: false });

  if (legacy.error) {
    return legacy as CompatibilityQueryCollectionResult<VendorAdjustmentRow>;
  }

  return {
    data: ((legacy.data ?? []) as LegacyVendorAdjustmentRow[]).map((row) => ({
      ...row,
      status: "approved",
      approved_by: row.created_by ?? null,
      approved_at: row.created_at,
      voided_by: null,
      voided_at: null,
      attachment_name: null,
      attachment_path: null,
      attachment_mime_type: null,
      attachment_url: null,
    })),
    error: null,
    compatibilityWarnings: [
      "Supplier adjustments are running without approval history and attachment fields.",
    ],
  };
}

async function fetchInventoryMovementsResult(
  supabase: SupabaseServerClient,
  storeKey: string,
): Promise<CompatibilityQueryCollectionResult<InventoryMovementRow>> {
  const fetchPagedInventoryMovements = async (selectClause: string) => {
    const rows: InventoryMovementRow[] = [];

    for (
      let from = 0;
      from < INVENTORY_MOVEMENT_HISTORY_LIMIT;
      from += INVENTORY_MOVEMENT_PAGE_SIZE
    ) {
      const to = Math.min(
        from + INVENTORY_MOVEMENT_PAGE_SIZE - 1,
        INVENTORY_MOVEMENT_HISTORY_LIMIT - 1,
      );
      const page = await supabase
        .from("inventory_movements")
        .select(selectClause)
        .eq("store_key", storeKey)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (page.error) {
        return {
          data: rows,
          error: page.error,
        } satisfies QueryCollectionResult<InventoryMovementRow>;
      }

      rows.push(...((page.data ?? []) as unknown as InventoryMovementRow[]));

      if ((page.data ?? []).length < INVENTORY_MOVEMENT_PAGE_SIZE) {
        break;
      }
    }

    return {
      data: rows,
      error: null,
    } satisfies QueryCollectionResult<InventoryMovementRow>;
  };

  const result = await fetchPagedInventoryMovements(
    "id,product_id,vendor_adjustment_id,vendor_invoice_id,movement_type,quantity_delta,quantity_before,quantity_after,unit_cost,total_amount,product_name,product_sku,notes,created_by,created_at,vendor_adjustments(id,adjustment_number),vendor_invoices(id,invoice_number,supplier_id,suppliers(id,name))",
  );

  if (result.error && isMissingRelation(result.error, "inventory_movements")) {
    return {
      data: [],
      error: null,
      compatibilityWarnings: [
        "Inventory movement history is unavailable until the inventory ledger migration is applied.",
      ],
    };
  }

  if (
    result.error &&
    isMissingSchemaField(result.error, "inventory_movements", [
      "vendor_invoice_id",
    ])
  ) {
    const legacy = await fetchPagedInventoryMovements(
      "id,product_id,vendor_adjustment_id,movement_type,quantity_delta,quantity_before,quantity_after,unit_cost,total_amount,product_name,product_sku,notes,created_by,created_at,vendor_adjustments(id,adjustment_number)",
    );

    if (!legacy.error) {
      return {
        data: (legacy.data ?? []).map((row) => ({
          ...row,
          vendor_invoice_id: null,
          vendor_invoices: null,
        })) as InventoryMovementRow[],
        error: null,
        compatibilityWarnings: [
          "Inventory movement history is running without vendor invoice receipt links.",
        ],
      };
    }
  }

  return result as CompatibilityQueryCollectionResult<InventoryMovementRow>;
}

async function fetchRecurringExpenseTemplatesResult(
  supabase: SupabaseServerClient,
  storeKey: string,
): Promise<CompatibilityQueryCollectionResult<RecurringExpenseTemplateRow>> {
  const primary = await supabase
    .from("recurring_expense_templates")
    .select(
      "id,category,default_amount,default_tax_amount,description,due_day_of_month,supplier_id,vendor_name,payment_method,notes,active,created_by,updated_by,created_at,updated_at",
    )
    .eq("store_key", storeKey)
    .order("active", { ascending: false })
    .order("due_day_of_month", { ascending: true })
    .order("description", { ascending: true });

  if (
    primary.error &&
    isMissingRelation(primary.error, "recurring_expense_templates")
  ) {
    return {
      data: [],
      error: null,
      compatibilityWarnings: [
        "Recurring expense templates are unavailable until the recurring expense migration is applied.",
      ],
    };
  }

  if (
    primary.error &&
    isMissingSchemaField(primary.error, "recurring_expense_templates", [
      "default_tax_amount",
      "supplier_id",
    ])
  ) {
    const legacy = await supabase
      .from("recurring_expense_templates")
      .select(
        "id,category,default_amount,description,due_day_of_month,vendor_name,payment_method,notes,active,created_by,updated_by,created_at,updated_at",
      )
      .eq("store_key", storeKey)
      .order("active", { ascending: false })
      .order("due_day_of_month", { ascending: true })
      .order("description", { ascending: true });

    if (!legacy.error) {
      return {
        data: (
          legacy.data as Omit<
            RecurringExpenseTemplateRow,
            "default_tax_amount" | "supplier_id"
          >[]
        ).map((row) => ({
          ...row,
          default_tax_amount: 0,
          supplier_id: null,
        })),
        error: null,
        compatibilityWarnings: [
          "Recurring expense tax defaults and vendor linkage are unavailable until the latest expense migration is applied.",
        ],
      };
    }

    return legacy as CompatibilityQueryCollectionResult<RecurringExpenseTemplateRow>;
  }

  return primary as CompatibilityQueryCollectionResult<RecurringExpenseTemplateRow>;
}

async function fetchExpenseCategoryBudgetsResult(
  supabase: SupabaseServerClient,
  storeKey: string,
): Promise<CompatibilityQueryCollectionResult<ExpenseCategoryBudgetRow>> {
  const result = await supabase
    .from("expense_category_budgets")
    .select(
      "id,category,budget_month,budget_amount,created_by,updated_by,created_at,updated_at",
    )
    .eq("store_key", storeKey)
    .order("budget_month", { ascending: false })
    .order("category", { ascending: true });

  if (
    result.error &&
    isMissingRelation(result.error, "expense_category_budgets")
  ) {
    return {
      data: [],
      error: null,
      compatibilityWarnings: [
        "Expense budgets are unavailable until the budget-vs-actual migration is applied.",
      ],
    };
  }

  return result as CompatibilityQueryCollectionResult<ExpenseCategoryBudgetRow>;
}

async function fetchExpensesResult(
  supabase: SupabaseServerClient,
  storeKey: string,
): Promise<CompatibilityQueryCollectionResult<ExpenseRow>> {
  const primary = await supabase
    .from("expense_records")
    .select(
      "id,category,amount,subtotal_amount,tax_amount,description,supplier_id,vendor_name,payment_method,notes,approval_note,void_note,recurring_template_id,recurring_period_month,attachment_name,attachment_path,attachment_url,status,expense_date,approved_by,approved_at,created_by,created_at,updated_at",
    )
    .eq("store_key", storeKey)
    .order("expense_date", { ascending: false });

  if (
    primary.error &&
    isMissingSchemaField(primary.error, "expense_records", [
      "subtotal_amount",
      "tax_amount",
      "supplier_id",
      "recurring_template_id",
      "recurring_period_month",
    ])
  ) {
    const current = await supabase
      .from("expense_records")
      .select(
        "id,category,amount,description,vendor_name,payment_method,notes,approval_note,void_note,attachment_name,attachment_path,attachment_url,status,expense_date,approved_by,approved_at,created_by,created_at,updated_at",
      )
      .eq("store_key", storeKey)
      .order("expense_date", { ascending: false });

    if (!current.error) {
      return {
        data: (
          (current.data ?? []) as Omit<
            ExpenseRow,
            | "subtotal_amount"
            | "tax_amount"
            | "supplier_id"
            | "recurring_template_id"
            | "recurring_period_month"
          >[]
        ).map((row) => ({
          ...row,
          subtotal_amount: row.amount,
          tax_amount: 0,
          supplier_id: null,
          recurring_template_id: null,
          recurring_period_month: null,
        })),
        error: null,
        compatibilityWarnings: [
          "Expense tax splits, vendor linkage, and recurring links are unavailable until the latest expense migration is applied.",
        ],
      };
    }

    return current as CompatibilityQueryCollectionResult<ExpenseRow>;
  }

  if (
    !primary.error ||
    !isMissingSchemaField(primary.error, "expense_records", [
      "vendor_name",
      "payment_method",
      "notes",
      "subtotal_amount",
      "tax_amount",
      "supplier_id",
      "approval_note",
      "void_note",
      "recurring_template_id",
      "recurring_period_month",
      "attachment_name",
      "attachment_path",
      "attachment_url",
      "status",
      "approved_at",
      "created_by",
    ])
  ) {
    return primary as CompatibilityQueryCollectionResult<ExpenseRow>;
  }

  const legacy = await supabase
    .from("expense_records")
    .select(
      "id,category,amount,description,expense_date,approved_by,created_at,updated_at",
    )
    .eq("store_key", storeKey)
    .order("expense_date", { ascending: false });

  if (legacy.error) {
    return legacy as CompatibilityQueryCollectionResult<ExpenseRow>;
  }

  return {
    data: ((legacy.data ?? []) as LegacyExpenseRow[]).map((row) => ({
      ...row,
      vendor_name: null,
      payment_method: null,
      notes: null,
      subtotal_amount: row.amount,
      tax_amount: 0,
      supplier_id: null,
      approval_note: null,
      void_note: null,
      recurring_template_id: null,
      recurring_period_month: null,
      attachment_name: null,
      attachment_path: null,
      attachment_url: null,
      status: "approved",
      approved_at: row.created_at,
      created_by: null,
    })),
    error: null,
    compatibilityWarnings: [
      "Expense records are running without payment detail and approval metadata fields.",
    ],
  };
}

function resolveExpenseAttachmentUrl(
  expense: Pick<ExpenseRow, "id" | "attachment_path" | "attachment_url">,
) {
  if (expense.attachment_path) {
    return getExpenseDocumentHref(expense.id);
  }

  return expense.attachment_url ?? undefined;
}

function resolveExpenseAttachmentDownloadUrl(
  expense: Pick<ExpenseRow, "id" | "attachment_path" | "attachment_url">,
) {
  if (expense.attachment_path) {
    return getExpenseDocumentDownloadHref(expense.id);
  }

  return expense.attachment_url ?? undefined;
}

async function fetchCashVaultTransactionsResult(
  supabase: SupabaseServerClient,
  storeKey: string,
): Promise<CompatibilityQueryCollectionResult<CashVaultTransactionRow>> {
  const primary = await supabase
    .from("cash_vault_transactions")
    .select(
      "id,source_table,source_id,movement_type,cash_source,business_date,amount,details,metadata,recorded_at,created_at,updated_at",
    )
    .eq("store_key", storeKey)
    .eq("cash_source", "store_till")
    .order("recorded_at", { ascending: false })
    .order("business_date", { ascending: false });

  if (
    primary.error &&
    isMissingRelation(primary.error, "cash_vault_transactions")
  ) {
    return {
      data: [],
      error: null,
      compatibilityWarnings: [
        "Cash vault ledger is unavailable until the latest cash movement migration is applied.",
      ],
    };
  }

  if (
    primary.error &&
    isMissingSchemaField(primary.error, "cash_vault_transactions", [
      "cash_source",
    ])
  ) {
    const legacy = await supabase
      .from("cash_vault_transactions")
      .select(
        "id,source_table,source_id,movement_type,business_date,amount,details,metadata,recorded_at,created_at,updated_at",
      )
      .eq("store_key", storeKey)
      .order("recorded_at", { ascending: false })
      .order("business_date", { ascending: false });

    return {
      ...(legacy as CompatibilityQueryCollectionResult<CashVaultTransactionRow>),
      compatibilityWarnings: [
        "Cash source tracking is unavailable until the bank deposit cash-source migration is applied.",
      ],
    };
  }

  return primary as CompatibilityQueryCollectionResult<CashVaultTransactionRow>;
}

function isNextRedirectError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("digest" in error && typeof error.digest === "string") {
    return error.digest.includes("NEXT_REDIRECT");
  }

  if ("message" in error && typeof error.message === "string") {
    return error.message.includes("NEXT_REDIRECT");
  }

  return false;
}

export async function getOperationsDataset(): Promise<OperationsDataset> {
  noStore();

  if (!isSupabaseConfigured()) {
    return createEmptyOperationsDataset("unconfigured");
  }

  try {
    const storeContext = await requireActiveStoreContext();
    const supabase = await createClient();
    const storeKey = storeContext.activeStoreKey;
    const [
      profilesResult,
      productsResult,
      suppliersResult,
      ordersResult,
      purchaseOrdersResult,
      invoicesResult,
      paymentsResult,
      adjustmentsResult,
      inventoryMovementsResult,
      recurringExpenseTemplatesResult,
      expenseCategoryBudgetsResult,
      expensesResult,
      salesSummariesResult,
      reconciliationsResult,
      payrollDuesResult,
      bankDepositsResult,
      cashVaultTransactionsResult,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id,email,full_name,role,status,department,position_title,employee_number,pay_frequency",
        )
        .eq("store_key", storeKey)
        .order("full_name", { ascending: true }),
      fetchProductsResult(supabase, storeKey),
      supabase
        .from("suppliers")
        .select(
          "id,name,contact_name,email,phone,address,city,postal_code,country,category,payment_terms,account_number,status,rating,reliability_percent,lead_time_days,created_at,updated_at",
        )
        .eq("store_key", storeKey)
        .order("name", { ascending: true }),
      supabase
        .from("sales_orders")
        .select(
          "id,order_number,customer_id,channel,item_count,subtotal,tax,discount,total,payment_status,fulfillment_status,payment_method,promised_date,created_by,created_at,updated_at,customers(id,name,email,phone,segment),sales_order_items(id,order_id,product_id,description,quantity,unit_price,discount,total)",
        )
        .eq("store_key", storeKey)
        .order("created_at", { ascending: false }),
      supabase
        .from("purchase_orders")
        .select(
          "id,po_number,supplier_id,line_count,amount,eta,status,notes,created_at,updated_at,suppliers(id,name)",
        )
        .eq("store_key", storeKey)
        .order("eta", { ascending: true }),
      fetchVendorInvoicesResult(supabase, storeKey),
      fetchVendorPaymentsResult(supabase, storeKey),
      fetchVendorAdjustmentsResult(supabase, storeKey),
      fetchInventoryMovementsResult(supabase, storeKey),
      fetchRecurringExpenseTemplatesResult(supabase, storeKey),
      fetchExpenseCategoryBudgetsResult(supabase, storeKey),
      fetchExpensesResult(supabase, storeKey),
      supabase
        .from("daily_sales_summaries")
        .select(
          "id,business_date,gross_sales,payment_total,product_total,cash_sales,cashless_sales,line_count,payment_breakdown,product_breakdown,reconciled,reconciled_by,reconciled_at,created_at,updated_at",
        )
        .eq("store_key", storeKey)
        .order("business_date", { ascending: false }),
      supabase
        .from("daily_sales_reconciliations")
        .select(
          "id,reconciliation_date,opening_float,closing_float,cash_counted,total_payouts,total_cash_sales,total_card_sales,total_expected,total_actual,variance,variance_percent,product_breakdown,reconciled_by,reconciled_at,notes,status,created_at,updated_at",
        )
        .eq("store_key", storeKey)
        .order("reconciliation_date", { ascending: false }),
      supabase
        .from("pay_statements")
        .select(
          "id,employee_id,period_label,pay_date,net_pay,status,payment_method,created_at,updated_at",
        )
        .eq("store_key", storeKey)
        .or(
          "status.in.(scheduled,draft),and(status.eq.paid,payment_method.eq.cash)",
        )
        .order("pay_date", { ascending: true }),
      supabase
        .from("bank_deposits")
        .select("*")
        .eq("store_key", storeKey)
        .order("deposit_date", { ascending: false }),
      fetchCashVaultTransactionsResult(supabase, storeKey),
    ]);

    const firstError = [
      profilesResult.error,
      productsResult.error,
      suppliersResult.error,
      ordersResult.error,
      purchaseOrdersResult.error,
      invoicesResult.error,
      paymentsResult.error,
      adjustmentsResult.error,
      inventoryMovementsResult.error,
      recurringExpenseTemplatesResult.error,
      expenseCategoryBudgetsResult.error,
      expensesResult.error,
      salesSummariesResult.error,
      reconciliationsResult.error,
      payrollDuesResult.error,
      bankDepositsResult.error,
      cashVaultTransactionsResult.error,
    ].find(Boolean);

    if (firstError) {
      throw firstError;
    }

    const compatibilityWarnings = Array.from(
      new Set([
        ...(productsResult.compatibilityWarnings ?? []),
        ...(paymentsResult.compatibilityWarnings ?? []),
        ...(adjustmentsResult.compatibilityWarnings ?? []),
        ...(inventoryMovementsResult.compatibilityWarnings ?? []),
        ...(recurringExpenseTemplatesResult.compatibilityWarnings ?? []),
        ...(expenseCategoryBudgetsResult.compatibilityWarnings ?? []),
        ...(expensesResult.compatibilityWarnings ?? []),
        ...(cashVaultTransactionsResult.compatibilityWarnings ?? []),
      ]),
    );

    const employees = ((profilesResult.data ?? []) as ProfileRow[]).map(
      (row) => ({
        id: row.id,
        email: row.email ?? "",
        name: row.full_name ?? row.email ?? "User",
        role: row.role ?? "employee",
        status: row.status ?? "active",
        department: row.department ?? undefined,
        positionTitle: row.position_title ?? undefined,
        employeeNumber: row.employee_number ?? undefined,
        payFrequency: row.pay_frequency ?? undefined,
      }),
    );

    const products = ((productsResult.data ?? []) as ProductRow[]).map(
      (row) => {
        const supplier = firstRelated(row.suppliers);

        return {
          id: row.id,
          supplierId: row.supplier_id ?? undefined,
          supplierName: supplier?.name ?? undefined,
          name: row.name,
          description: row.description ?? "",
          sku: row.sku,
          barcode: row.barcode ?? undefined,
          category: row.category,
          price: toNumber(row.price),
          cost: toNumber(row.cost),
          quantity: row.quantity,
          itemsPerPack: Math.max(1, Math.round(toNumber(row.items_per_pack))),
          reorderLevel: row.reorder_level,
          location: row.location ?? undefined,
          dailyVelocity: toNumber(row.daily_velocity),
          targetMarginPercent: toNumber(row.target_margin_percent),
          createdAt: toDate(row.created_at),
          updatedAt: toDate(row.updated_at),
        };
      },
    );

    const suppliers = ((suppliersResult.data ?? []) as SupplierRow[]).map(
      (row) => ({
        id: row.id,
        name: row.name,
        contact: row.contact_name ?? "",
        email: row.email ?? "",
        phone: row.phone ?? "",
        address: row.address ?? "",
        city: row.city ?? "",
        postalCode: row.postal_code ?? "",
        country: row.country ?? "USA",
        paymentTerms: row.payment_terms,
        rating: toNumber(row.rating),
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
        category: row.category ?? undefined,
        paymentTermsLabel: row.payment_terms.toUpperCase(),
        accountNumber: row.account_number ?? undefined,
        status: row.status,
        reliabilityPercent: toNumber(row.reliability_percent),
        leadTimeDays: row.lead_time_days,
      }),
    );

    const orders = ((ordersResult.data ?? []) as SalesOrderRow[]).map((row) => {
      const customer = firstRelated(row.customers);

      return {
        id: row.id,
        orderNumber: row.order_number,
        customerId: row.customer_id ?? undefined,
        customerName: customer?.name ?? "Walk-in customer",
        customerEmail: customer?.email ?? undefined,
        customerPhone: customer?.phone ?? undefined,
        customerSegment: customer?.segment ?? undefined,
        channel: row.channel,
        itemCount: row.item_count,
        subtotal: toNumber(row.subtotal),
        tax: toNumber(row.tax),
        discount: toNumber(row.discount),
        total: toNumber(row.total),
        paymentStatus: row.payment_status,
        fulfillmentStatus: row.fulfillment_status,
        paymentMethod: row.payment_method ?? undefined,
        promisedDate: row.promised_date ? toDate(row.promised_date) : undefined,
        createdBy: row.created_by ?? undefined,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
        items: (row.sales_order_items ?? []).map((item) => ({
          id: item.id,
          orderId: item.order_id,
          productId: item.product_id ?? undefined,
          description: item.description ?? "Line item",
          quantity: item.quantity,
          unitPrice: toNumber(item.unit_price),
          discount: toNumber(item.discount ?? 0),
          total: toNumber(item.total),
        })),
      };
    });

    const purchaseOrders = (
      (purchaseOrdersResult.data ?? []) as PurchaseOrderRow[]
    ).map((row) => {
      const supplier = firstRelated(row.suppliers);

      return {
        id: row.id,
        poNumber: row.po_number,
        supplierId: row.supplier_id,
        supplierName: supplier?.name ?? "Supplier",
        lineCount: row.line_count,
        amount: toNumber(row.amount),
        eta: row.eta ? toDate(row.eta) : undefined,
        status: row.status,
        notes: row.notes ?? undefined,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
      };
    });

    const vendorPayments = (
      (paymentsResult.data ?? []) as VendorPaymentRow[]
    ).map((row) => {
      const supplier = firstRelated(row.suppliers);
      const invoice = firstRelated(row.vendor_invoices);

      return {
        id: row.id,
        vendorId: row.supplier_id,
        vendorName: supplier?.name ?? "Vendor",
        invoiceId: row.vendor_invoice_id ?? undefined,
        invoiceNumber: invoice?.invoice_number ?? undefined,
        status: row.status,
        amountPaid: toNumber(row.amount_paid),
        paymentDate: toDate(row.payment_date),
        paymentMethod: normalizeVendorPaymentMethod(row.payment_method),
        referenceNumber: row.reference_number,
        notes: row.notes ?? undefined,
        approvedBy: row.approved_by ?? undefined,
        approvedAt: row.approved_at ? toDate(row.approved_at) : undefined,
        voidedBy: row.voided_by ?? undefined,
        voidedAt: row.voided_at ? toDate(row.voided_at) : undefined,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
      };
    });

    const vendorAdjustments = (
      (adjustmentsResult.data ?? []) as VendorAdjustmentRow[]
    ).map((row) => {
      const supplier = firstRelated(row.suppliers);
      const invoice = firstRelated(row.vendor_invoices);

      return {
        id: row.id,
        vendorId: row.supplier_id,
        vendorName: supplier?.name ?? "Vendor",
        invoiceId: row.vendor_invoice_id ?? undefined,
        invoiceNumber: invoice?.invoice_number ?? undefined,
        adjustmentNumber: row.adjustment_number,
        adjustmentType: row.adjustment_type,
        status: row.status,
        amount: toNumber(row.amount),
        currency: row.currency,
        adjustmentDate: toDate(row.adjustment_date),
        reason: row.reason ?? undefined,
        notes: row.notes ?? undefined,
        inventoryImpact: row.inventory_impact,
        attachmentName: row.attachment_name ?? undefined,
        attachmentMimeType: row.attachment_mime_type ?? undefined,
        attachmentUrl:
          row.attachment_path || row.attachment_url
            ? getVendorDocumentHref("adjustment", row.id)
            : undefined,
        createdBy: row.created_by ?? undefined,
        approvedBy: row.approved_by ?? undefined,
        approvedAt: row.approved_at ? toDate(row.approved_at) : undefined,
        voidedBy: row.voided_by ?? undefined,
        voidedAt: row.voided_at ? toDate(row.voided_at) : undefined,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
        items: (row.vendor_adjustment_items ?? []).map((item) => ({
          id: item.id,
          productId: item.product_id ?? undefined,
          description: item.description,
          quantity: item.quantity,
          unitCost: toNumber(item.unit_cost),
          amount: toNumber(item.amount),
        })),
      };
    });

    const inventoryMovements = (
      (inventoryMovementsResult.data ?? []) as InventoryMovementRow[]
    ).map((row) => {
      const adjustment = firstRelated(row.vendor_adjustments);
      const invoice = firstRelated(row.vendor_invoices);
      const invoiceSupplier = firstRelated(invoice?.suppliers);

      return {
        id: row.id,
        productId: row.product_id ?? undefined,
        vendorAdjustmentId: row.vendor_adjustment_id ?? undefined,
        vendorInvoiceId: row.vendor_invoice_id ?? undefined,
        vendorId: invoice?.supplier_id ?? invoiceSupplier?.id ?? undefined,
        vendorName: invoiceSupplier?.name ?? undefined,
        adjustmentNumber:
          adjustment?.adjustment_number ?? invoice?.invoice_number ?? undefined,
        movementType: row.movement_type,
        quantityDelta: row.quantity_delta,
        quantityBefore: row.quantity_before,
        quantityAfter: row.quantity_after,
        unitCost: toNumber(row.unit_cost),
        totalAmount: toNumber(row.total_amount),
        productName: row.product_name,
        productSku: row.product_sku,
        notes: row.notes ?? undefined,
        createdBy: row.created_by ?? undefined,
        createdAt: toDate(row.created_at),
      };
    });

    const adjustmentsByInvoice = vendorAdjustments.reduce((map, adjustment) => {
      if (
        !adjustment.invoiceId ||
        !isPostedVendorAdjustmentStatus(adjustment.status)
      ) {
        return map;
      }

      map.set(
        adjustment.invoiceId,
        (map.get(adjustment.invoiceId) ?? 0) + adjustment.amount,
      );

      return map;
    }, new Map<string, number>());

    const vendorInvoices = (
      (invoicesResult.data ?? []) as VendorInvoiceRow[]
    ).map((row) => {
      const supplier = firstRelated(row.suppliers);
      const adjustmentAmount = adjustmentsByInvoice.get(row.id) ?? 0;
      const netBalance =
        toNumber(row.amount) - toNumber(row.paid_amount) - adjustmentAmount;

      return {
        id: row.id,
        vendorId: row.supplier_id,
        vendorName: supplier?.name ?? "Vendor",
        vendorEmail: supplier?.email ?? undefined,
        invoiceNumber: row.invoice_number,
        amount: toNumber(row.amount),
        currency: row.currency,
        issueDate: toDate(row.issue_date),
        dueDate: toDate(row.due_date),
        pdfFileName: row.pdf_file_name ?? undefined,
        pdfMimeType: row.pdf_mime_type ?? undefined,
        pdfUrl:
          row.pdf_path || row.pdf_url
            ? getVendorDocumentHref("invoice", row.id)
            : undefined,
        description: row.description ?? undefined,
        status: row.status,
        paidAmount: toNumber(row.paid_amount),
        adjustmentAmount,
        netBalance,
        notes: row.notes ?? undefined,
        uploadedAt: toDate(row.uploaded_at),
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
      };
    });

    const expenses = ((expensesResult.data ?? []) as ExpenseRow[]).map(
      (row) => ({
        id: row.id,
        category: normalizeExpenseCategory(row.category) ?? "Other",
        amount: toNumber(row.amount),
        subtotalAmount: toNumber(row.subtotal_amount ?? row.amount),
        taxAmount: toNumber(row.tax_amount ?? 0),
        description: row.description,
        supplierId: row.supplier_id ?? undefined,
        vendorName: row.vendor_name ?? undefined,
        paymentMethod: row.payment_method ?? undefined,
        notes: row.notes ?? undefined,
        approvalNote: row.approval_note ?? undefined,
        voidNote: row.void_note ?? undefined,
        recurringTemplateId: row.recurring_template_id ?? undefined,
        recurringPeriodMonth: row.recurring_period_month
          ? toDate(row.recurring_period_month)
          : undefined,
        attachmentName: row.attachment_name ?? undefined,
        attachmentUrl: resolveExpenseAttachmentUrl(row),
        attachmentDownloadUrl: resolveExpenseAttachmentDownloadUrl(row),
        date: toDate(row.expense_date),
        status: normalizeExpenseStatus(row.status),
        approvedBy: row.approved_by ?? undefined,
        approvedAt: row.approved_at ? toDate(row.approved_at) : undefined,
        createdBy: row.created_by ?? undefined,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
      }),
    );

    const recurringExpenseTemplates = (
      (recurringExpenseTemplatesResult.data ??
        []) as RecurringExpenseTemplateRow[]
    ).map((row) => ({
      id: row.id,
      category: normalizeExpenseCategory(row.category) ?? "Other",
      defaultAmount: toNumber(row.default_amount),
      defaultTaxAmount: toNumber(row.default_tax_amount ?? 0),
      description: row.description,
      dueDayOfMonth: Math.max(1, Math.min(31, row.due_day_of_month)),
      supplierId: row.supplier_id ?? undefined,
      vendorName: row.vendor_name ?? undefined,
      paymentMethod: row.payment_method ?? undefined,
      notes: row.notes ?? undefined,
      active: row.active ?? true,
      createdBy: row.created_by ?? undefined,
      updatedBy: row.updated_by ?? undefined,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    }));

    const expenseCategoryBudgets = (
      (expenseCategoryBudgetsResult.data ?? []) as ExpenseCategoryBudgetRow[]
    ).map((row) => ({
      id: row.id,
      category: normalizeExpenseCategory(row.category) ?? "Other",
      budgetMonth: toDate(row.budget_month),
      budgetAmount: toNumber(row.budget_amount),
      createdBy: row.created_by ?? undefined,
      updatedBy: row.updated_by ?? undefined,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    }));

    const salesSummaries = (
      (salesSummariesResult.data ?? []) as DailySalesSummaryRow[]
    ).map((row) => ({
      id: row.id,
      date: toDate(row.business_date),
      grossSales: toNumber(row.gross_sales),
      paymentTotal: toNumber(row.payment_total),
      productTotal: toNumber(row.product_total),
      cashSales: toNumber(row.cash_sales),
      cashlessSales: toNumber(row.cashless_sales),
      lineCount: Number(row.line_count ?? 0),
      paymentBreakdown: Object.fromEntries(
        Object.entries(row.payment_breakdown ?? {}).map(([key, value]) => [
          key,
          toNumber(value),
        ]),
      ),
      productBreakdown: Object.fromEntries(
        Object.entries(row.product_breakdown ?? {}).map(([key, value]) => [
          key,
          toNumber(value),
        ]),
      ),
      reconciled: row.reconciled,
      reconciledBy: row.reconciled_by ?? undefined,
      reconciledAt: row.reconciled_at ? toDate(row.reconciled_at) : undefined,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    }));
    const salesEntries = salesSummaries.map((summary) => ({
      id: summary.id,
      date: summary.date,
      amount: summary.grossSales,
      paymentMethod: "__summary__",
      productType: "__summary__",
      description: "",
      userId: summary.reconciledBy ?? "system",
      reconciled: summary.reconciled,
      reconciledBy: summary.reconciledBy,
      reconciledAt: summary.reconciledAt,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    }));

    const salesReconciliations = (
      (reconciliationsResult.data ?? []) as DailySalesReconciliationRow[]
    ).map((row) => ({
      id: row.id,
      date: toDate(row.reconciliation_date),
      openingFloat: toNumber(row.opening_float),
      closingFloat: toNumber(row.closing_float),
      cashCounted: toNumber(row.cash_counted),
      totalPayouts: toNumber(row.total_payouts),
      totalCashSales: toNumber(row.total_cash_sales),
      totalCardSales: toNumber(row.total_card_sales),
      totalExpected: toNumber(row.total_expected),
      totalActual: toNumber(row.total_actual),
      variance: toNumber(row.variance),
      variancePercent: toNumber(row.variance_percent),
      productBreakdown: row.product_breakdown ?? {},
      reconciliedBy: row.reconciled_by ?? "system",
      reconciliedAt: toDate(row.reconciled_at),
      notes: row.notes ?? undefined,
      status: row.status,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    }));

    const employeeMap = new Map(
      employees.map((employee) => [employee.id, employee]),
    );
    const payStatementRows = (payrollDuesResult.data ?? []) as PayrollDueRow[];
    const payrollDues = payStatementRows
      .filter((row) => row.status !== "paid")
      .map((row) => ({
        id: row.id,
        employeeId: row.employee_id,
        employeeName: employeeMap.get(row.employee_id)?.name ?? "Employee",
        periodLabel: row.period_label,
        payDate: toDate(row.pay_date),
        netPay: toNumber(row.net_pay),
        status:
          row.status === "draft" ? ("Draft" as const) : ("Scheduled" as const),
      }));
    const cashPayrollPayments = payStatementRows
      .filter(
        (row) =>
          row.status === "paid" && row.payment_method?.toLowerCase() === "cash",
      )
      .map((row) => ({
        id: row.id,
        employeeId: row.employee_id,
        employeeName: employeeMap.get(row.employee_id)?.name ?? "Employee",
        periodLabel: row.period_label,
        payDate: toDate(row.pay_date),
        netPay: toNumber(row.net_pay),
      }));

    const bankDeposits = (
      (bankDepositsResult.data ?? []) as BankDepositRow[]
    ).map((row) => ({
      id: row.id,
      amount: toNumber(row.amount),
      cashSource: row.cash_source ?? "store_till",
      date: toDate(row.deposit_date),
      notes: row.notes ?? undefined,
      slipPhotoUrl: row.slip_photo_url ?? undefined,
      slipPhotoPath: row.slip_photo_path ?? undefined,
      status: row.status ?? "posted",
      voidReason: row.void_reason ?? undefined,
      voidedBy: row.voided_by ?? undefined,
      voidedAt: row.voided_at ? toDate(row.voided_at) : undefined,
      createdBy: row.created_by ?? undefined,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    }));
    const cashVaultTransactions = (
      (cashVaultTransactionsResult.data ?? []) as CashVaultTransactionRow[]
    ).map((row) => ({
      id: row.id,
      sourceTable: row.source_table,
      sourceId: row.source_id,
      movementType: row.movement_type,
      cashSource: row.cash_source ?? "store_till",
      businessDate: toDate(row.business_date),
      amount: toNumber(row.amount),
      details: row.details,
      metadata:
        row.metadata && typeof row.metadata === "object" ? row.metadata : {},
      recordedAt: toDate(row.recorded_at),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    }));

    return {
      source: "database",
      compatibilityMode: compatibilityWarnings.length > 0,
      compatibilityWarnings,
      employees,
      products,
      suppliers,
      orders,
      purchaseOrders,
      vendorInvoices,
      vendorPayments,
      vendorAdjustments,
      inventoryMovements,
      recurringExpenseTemplates,
      expenseCategoryBudgets,
      expenses,
      salesEntries,
      salesSummaries,
      salesReconciliations,
      payrollDues,
      cashPayrollPayments,
      bankDeposits,
      cashVaultTransactions,
    };
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    const message =
      error && typeof error === "object" && "message" in error
        ? (error as { message?: string | null }).message
        : error;
    console.error("Failed to load operations dataset from Supabase:", message);
    return createEmptyOperationsDataset("error");
  }
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function firstRelated<T>(value: RelatedRecord<T> | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function toDate(value: string | Date) {
  return parseStoredDate(value);
}

function normalizeExpenseStatus(
  value: ExpenseRecordStatus | null | undefined,
): ExpenseRecordStatus {
  if (value === "void") {
    return "void";
  }

  return value === "draft" ? "draft" : "approved";
}

function addDays(base: Date, days: number) {
  const value = new Date(base);
  value.setDate(value.getDate() + days);
  return value;
}

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function createEmptyOperationsDataset(
  source: Exclude<DataSource, "database">,
): OperationsDataset {
  return {
    source,
    compatibilityMode: false,
    compatibilityWarnings: [],
    employees: [],
    products: [],
    suppliers: [],
    orders: [],
    purchaseOrders: [],
    vendorInvoices: [],
    vendorPayments: [],
    vendorAdjustments: [],
    inventoryMovements: [],
    recurringExpenseTemplates: [],
    expenseCategoryBudgets: [],
    expenses: [],
    salesEntries: [],
    salesSummaries: [],
    salesReconciliations: [],
    payrollDues: [],
    cashPayrollPayments: [],
    bankDeposits: [],
    cashVaultTransactions: [],
  };
}
