const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isSupabaseConfigured() {
  const isPlaceHolder =
    supabaseUrl === "..." ||
    supabasePublishableKey === "..." ||
    supabasePublishableKey === "your-supabase-anon-key";

  return Boolean(
    supabaseUrl &&
      supabasePublishableKey &&
      supabaseUrl.startsWith("http") &&
      !isPlaceHolder,
  );
}

export function isSupabaseAdminConfigured() {
  return Boolean(
    isSupabaseConfigured() &&
      supabaseServiceRoleKey &&
      !supabaseServiceRoleKey.startsWith("your-"),
  );
}

export function getSupabaseUrl() {
  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }

  return supabaseUrl;
}

export function getSupabasePublishableKey() {
  if (!supabasePublishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return supabasePublishableKey;
}

export function getSupabaseServiceRoleKey() {
  if (!supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return supabaseServiceRoleKey;
}

export function getPayrollDocumentsBucket() {
  return process.env.NEXT_PUBLIC_SUPABASE_PAYROLL_BUCKET ?? "payroll-documents";
}

export function getVendorInvoiceDocumentsBucket() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_VENDOR_INVOICE_BUCKET ?? "vendor-invoices"
  );
}

export function getExpenseDocumentsBucket() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_EXPENSE_DOCUMENT_BUCKET ??
    "expense-documents"
  );
}
