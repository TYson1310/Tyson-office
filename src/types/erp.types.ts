// ERP Type Definitions

// User & Authentication
export type SupportedUserRole = "admin" | "manager" | "employee";
export type UserRole =
  | SupportedUserRole
  | "cashier"
  | "warehouse"
  | "accountant";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  storeKey?: string;
  avatar?: string;
  status: "active" | "inactive" | "on-leave";
  permissions: string[];
  departmentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Authentication
export interface AuthUser extends User {
  token?: string;
  tokenExpiry?: Date;
}

export interface AuthSession {
  user: AuthUser;
  token: string;
  expiresAt: Date;
  isAuthenticated: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthContextType {
  user: AuthUser | null;
  session: AuthSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<AuthSession>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
}

// Inventory & Products
export interface Product {
  id: string;
  name: string;
  description: string;
  sku: string;
  category: string;
  price: number;
  cost: number;
  quantity: number;
  itemsPerPack: number;
  reorderLevel: number;
  barcode?: string;
  images?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovement {
  id: string;
  productId: string;
  type: "in" | "out" | "adjustment" | "return";
  quantity: number;
  reason: string;
  reference?: string;
  userId: string;
  timestamp: Date;
}

// Orders & Invoices
export interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  total: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
  paymentStatus: "pending" | "partial" | "completed" | "refunded";
  paymentMethod?: "cash" | "card" | "check" | "transfer";
  createdBy: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Suppliers
export interface Supplier {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  paymentTerms?: string;
  rating?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: "draft" | "sent" | "confirmed" | "received" | "cancelled";
  expectedDelivery: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Employees & Payroll
export interface Employee {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  baseSalary: number;
  hireDate: Date;
  status: "active" | "inactive" | "on-leave";
  performanceRating?: number;
  documents?: string[];
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  bankDetails?: {
    accountNumber: string;
    bankName: string;
    routingNumber: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface Payroll {
  id: string;
  employeeId: string;
  month: string;
  baseSalary: number;
  bonuses: number;
  deductions: number;
  netSalary: number;
  status: "draft" | "approved" | "processed" | "paid";
  approvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PayrollPaymentMethod =
  | "direct_deposit"
  | "check"
  | "cash"
  | "bank_transfer"
  | "payroll_card"
  | "other";

export interface Attendance {
  id: string;
  employeeId: string;
  date: Date;
  status: "present" | "absent" | "leave" | "holiday" | "late";
  hoursWorked?: number;
  clockInTime?: Date;
  clockOutTime?: Date;
}

export interface Schedule {
  id: string;
  employeeId: string;
  startDate: Date;
  endDate: Date;
  shifts: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  }[];
}

export interface Performance {
  id: string;
  employeeId: string;
  period: string;
  rating: number;
  feedback: string;
  reviewedBy: string;
  createdAt: Date;
}

export interface Task {
  id: string;
  assignedTo: string;
  assignedBy: string;
  title: string;
  description: string;
  status: "pending" | "in-progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high";
  dueDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Financial Reports
export interface SalesReport {
  period: string;
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
  topProducts: Product[];
  byPaymentMethod: Record<PaymentMethod, number>;
}

export interface FinancialSummary {
  period: string;
  revenue: number;
  cogs: number;
  expenses: number;
  grossProfit: number;
  netProfit: number;
  profitMargin: number;
}

export type ExpenseRecordStatus = "draft" | "approved" | "void";

export interface RecurringExpenseTemplate {
  id: string;
  category: string;
  defaultAmount: number;
  defaultTaxAmount: number;
  description: string;
  dueDayOfMonth: number;
  active: boolean;
  supplierId?: string;
  vendorName?: string;
  paymentMethod?: string;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseCategoryBudget {
  id: string;
  category: string;
  budgetMonth: Date;
  budgetAmount: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseRecord {
  id: string;
  category: string;
  amount: number;
  subtotalAmount: number;
  taxAmount: number;
  description: string;
  date: Date;
  status: ExpenseRecordStatus;
  supplierId?: string;
  vendorName?: string;
  paymentMethod?: string;
  notes?: string;
  approvalNote?: string;
  voidNote?: string;
  recurringTemplateId?: string;
  recurringPeriodMonth?: Date;
  attachmentName?: string;
  attachmentUrl?: string;
  attachmentDownloadUrl?: string;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: Date;
  voidedBy?: string;
  voidedAt?: Date;
  attachments?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// Dashboard KPIs
export interface AdminDashboardKPI {
  activeStaff: number;
  monthlyPayroll: number;
  inventoryValue: number;
  monthlyRevenue: number;
  openOrders: number;
  lowStockItems: number;
  pendingExpenses: number;
  staffPerformanceAvg: number;
}

export interface EmployeeDashboardKPI {
  employeeId: string;
  attendanceRate: number;
  performanceRating: number;
  leaveBalance: number;
  upcomingShifts: number;
  tasksOverdue: number;
  lastPayslipDate: Date;
}

// Store Settings
export interface StoreSettings {
  storeName: string;
  storeEmail: string;
  storePhone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  taxRate: number;
  currency: string;
  timeZone: string;
  receiptFormat?: string;
}

// ===== PHASE 2: SALES & PAYROLL =====

// Sales & Daily Transactions
export type PaymentMethod = string;

export interface DailyTransaction {
  id: string;
  date: Date;
  amount: number;
  paymentMethod: PaymentMethod;
  productType: string;
  description?: string;
  userId: string;
  reconciled: boolean;
  reconciledBy?: string;
  reconciledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DailySalesSummary {
  id: string;
  date: Date;
  grossSales: number;
  paymentTotal: number;
  productTotal: number;
  cashSales: number;
  cashlessSales: number;
  lineCount: number;
  paymentBreakdown: Record<string, number>;
  productBreakdown: Record<string, number>;
  reconciled: boolean;
  reconciledBy?: string;
  reconciledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyReconciliation {
  id: string;
  date: Date;
  openingFloat: number;
  closingFloat: number;
  cashCounted: number;
  totalPayouts: number;
  totalCashSales: number;
  totalCardSales: number;
  totalExpected: number;
  totalActual: number;
  variance: number;
  variancePercent: number;
  productBreakdown: Record<string, number>;
  reconciliedBy: string;
  reconciliedAt: Date;
  notes?: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesReport {
  date: Date;
  totalSales: number;
  byPaymentMethod: Record<PaymentMethod, number>;
  transactionCount: number;
  avgTransactionValue: number;
}

// Timeclock & Payroll
export interface TimeclockEntry {
  id: string;
  employeeId: string;
  date: Date;
  clockInTime: Date;
  clockOutTime?: Date;
  totalHours?: number;
  status: "clocked_in" | "clocked_out" | "missed" | "on_leave";
  location?: string;
  device?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Timesheet {
  id: string;
  employeeId: string;
  weekStartDate: Date;
  weekEndDate: Date;
  entries: TimeclockEntry[];
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  status: "draft" | "submitted" | "approved" | "rejected";
  approvedBy?: string;
  approvedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GrossPay {
  regularPay: number;
  overtimePay: number;
  bonuses: number;
  allowances: number;
  total: number;
}

export interface PayrollDeductions {
  incomeTax: number;
  socialSecurity: number;
  healthInsurance: number;
  employeeAdvance?: number;
  other?: number;
  total: number;
}

export interface Paystub {
  id: string;
  employeeId: string;
  period: string;
  periodStartDate: Date;
  periodEndDate: Date;
  baseSalary: number;
  regularHours: number;
  hourlyRate: number;
  overtimeMultiplier: number;
  grossPay: GrossPay;
  deductions: PayrollDeductions;
  netPay: number;
  ytdGross: number;
  ytdTax: number;
  ytdNet: number;
  paymentMethod: PayrollPaymentMethod;
  status: "draft" | "processed" | "paid" | "archived";
  issuedAt: Date;
  paidAt?: Date;
  pdfUrl?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayrollRun {
  id: string;
  period: string;
  periodStartDate: Date;
  periodEndDate: Date;
  employeeCount: number;
  totalGrossPay: number;
  totalDeductions: number;
  totalNetPay: number;
  status: "draft" | "submitted" | "approved" | "processed" | "paid";
  submittedBy?: string;
  submittedAt?: Date;
  approvedBy?: string;
  approvedAt?: Date;
  processedBy?: string;
  processedAt?: Date;
  paystubs: Paystub[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ===== PHASE 3: VENDORS & PRODUCTS =====

// Vendor Management
export type APStatus = "pending" | "paid" | "overdue" | "cancelled";
export type PaymentTerms = "net30" | "net60" | "net90" | "cod" | "prepaid";

export interface Vendor {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  paymentTerms: PaymentTerms;
  accountNumber: string;
  taxId?: string;
  bankDetails?: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    routingNumber?: string;
    swift?: string;
  };
  status: "active" | "inactive" | "blacklisted";
  rating?: number;
  totalSpent?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Invoice {
  id: string;
  vendorId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  pdfFileName?: string;
  pdfMimeType?: string;
  pdfUrl?: string;
  description?: string;
  status: APStatus;
  paidAmount?: number;
  notes?: string;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type VendorAdjustmentType =
  | "return"
  | "credit_note"
  | "shortage"
  | "damage"
  | "rebate"
  | "other";

export type VendorAdjustmentStatus = "draft" | "approved" | "void";
export type VendorPaymentStatus = "posted" | "void";

export type InventoryMovementType =
  | "vendor_return"
  | "vendor_return_reversal"
  | "manual_adjustment"
  | "vendor_invoice_receipt";

export interface VendorAdjustmentItem {
  id: string;
  productId?: string;
  description: string;
  quantity: number;
  unitCost: number;
  amount: number;
}

export interface VendorAdjustment {
  id: string;
  vendorId: string;
  invoiceId?: string;
  adjustmentNumber: string;
  adjustmentType: VendorAdjustmentType;
  status: VendorAdjustmentStatus;
  amount: number;
  currency: string;
  adjustmentDate: Date;
  reason?: string;
  notes?: string;
  inventoryImpact: boolean;
  attachmentName?: string;
  attachmentMimeType?: string;
  attachmentUrl?: string;
  items: VendorAdjustmentItem[];
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: Date;
  voidedBy?: string;
  voidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface VendorPayment {
  id: string;
  vendorId: string;
  invoiceId?: string;
  status: VendorPaymentStatus;
  amountPaid: number;
  paymentDate: Date;
  paymentMethod: "cash" | "card" | "check";
  referenceNumber: string;
  notes?: string;
  approvedBy?: string;
  approvedAt?: Date;
  voidedBy?: string;
  voidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryMovement {
  id: string;
  productId?: string;
  vendorAdjustmentId?: string;
  vendorInvoiceId?: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  unitCost: number;
  totalAmount: number;
  productName: string;
  productSku: string;
  notes?: string;
  createdBy?: string;
  createdAt: Date;
}

export interface APAgingReport {
  vendorId: string;
  vendorName: string;
  current: number;
  overdue30: number;
  overdue60: number;
  overdue90plus: number;
  total: number;
}

// Product & Margin Engine
export interface MarginCalculation {
  id: string;
  productId: string;
  landingCost: number;
  targetMarginPercent: number;
  markup: number;
  breakEvenPrice: number;
  sellingPrice: number;
  profitPerUnit: number;
  marginPercent: number;
  calculatedAt: Date;
}

export interface CostAlert {
  id: string;
  productId: string;
  productName: string;
  vendorId: string;
  oldCost: number;
  newCost: number;
  costDifference: number;
  percentageIncrease: number;
  alertStatus: "new" | "acknowledged" | "resolved";
  impactOnMargin: number;
  recommendedSellingPrice?: number;
  detectedAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

// ===== PHASE 4: REPORTING SUITE =====

export interface DashboardMetric {
  id: string;
  name: string;
  value: number;
  previousValue?: number;
  percentageChange?: number;
  trend?: "up" | "down" | "stable";
  format?: "currency" | "percent" | "number";
}

export interface SalesAnalytic {
  date: Date;
  totalSales: number;
  byPaymentMethod: Record<PaymentMethod, number>;
  transactionCount: number;
  avgTransactionValue: number;
}

export interface ProfitAnalytic {
  date: Date;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  operatingExpenses: number;
  netProfit: number;
  netMarginPercent: number;
}

export interface VendorSpendAnalytic {
  vendorId: string;
  vendorName: string;
  totalSpent: number;
  averageInvoiceAmount: number;
  invoiceCount: number;
  averagePaymentDays: number;
  onTimePaymentRate: number;
  period: string;
}

export interface PayrollAnalytic {
  period: string;
  employeeCount: number;
  totalGrossPay: number;
  totalDeductions: number;
  totalNetPay: number;
  averagePayPerEmployee: number;
  turnoverRate: number;
  overtimeHours: number;
  overtimeCost: number;
}

export interface MarginAnalytic {
  date: Date;
  productCount: number;
  averageMargin: number;
  marginsIncreased: number;
  marginsDecreased: number;
  lowMarginProducts: Array<{ productName: string; margin: number }>;
  highMarginProducts: Array<{ productName: string; margin: number }>;
}

export interface Report {
  id: string;
  type: "sales" | "profit" | "vendor" | "payroll" | "margin" | "dashboard";
  period: string;
  startDate: Date;
  endDate: Date;
  data: Record<string, any>;
  generatedBy: string;
  exportFormat?: "csv" | "pdf" | "excel";
  createdAt: Date;
  updatedAt: Date;
}

// Cash Vault & Bank Deposits
export interface BankDeposit {
  id: string;
  amount: number;
  date: Date;
  notes?: string;
  slipPhotoUrl?: string;
  slipPhotoPath?: string;
  status?: "posted" | "void";
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: Date;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CashVaultMovementType =
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

export interface CashVaultTransaction {
  id: string;
  sourceTable: string;
  sourceId: string;
  movementType: CashVaultMovementType;
  businessDate: Date;
  amount: number;
  details: string;
  metadata: Record<string, unknown>;
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
