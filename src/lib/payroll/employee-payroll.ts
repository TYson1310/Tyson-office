import { createClient } from "@/lib/supabase/server";
import { getPayrollDocumentsBucket, isSupabaseConfigured } from "@/lib/supabase/env";
import type { ProfileRecord } from "@/lib/auth/shared";
import {
  calculatePayStatementTotals,
  selectPayStatementsWithFallback,
} from "@/lib/payroll/pay-statements";
import { requireActiveStoreContext } from "@/lib/stores/server";
import { unstable_noStore as noStore } from "next/cache";

export type PayrollPageData = {
  source: "database" | "unconfigured" | "error";
  employee: {
    id: string;
    name: string;
    role: string;
    employeeNumber: string;
    department: string;
    directDepositAccount: string;
    payFrequency: string;
    nextPayDate: string;
    manager: string;
  };
  statements: {
    id: string;
    period: string;
    payDate: string;
    gross: number;
    deductions: number;
    net: number;
    paidHours: number;
    hourlyRate: number;
    bonus: number;
    status: "Paid" | "Scheduled";
  }[];
  documents: {
    id: string;
    name: string;
    category: "Pay Statement" | "Tax Summary" | "Deposit Advice";
    period: string;
    issuedOn: string;
    status: "Ready" | "Paid" | "Filed";
    href: string;
  }[];
  deductionBreakdown: {
    label: string;
    amount: number;
    tone: "amber" | "blue" | "violet" | "green";
  }[];
};

type PayStatementRow = {
  id: string;
  period_label: string;
  pay_date: string;
  gross_pay: number;
  deductions_total: number;
  net_pay: number;
  regular_hours?: number | null;
  overtime_hours: number | null;
  hourly_rate?: number | null;
  overtime_multiplier?: number | null;
  bonus_amount: number | null;
  status: "paid" | "scheduled" | "draft" | "archived";
  pay_statement_deductions:
    | {
        id: string;
        label: string;
        amount: number;
        sort_order: number | null;
      }[]
    | null;
};

type PayrollDocumentRow = {
  id: string;
  name: string;
  category: "pay_statement" | "tax_summary" | "deposit_advice";
  pay_statement_id: string | null;
  period_label: string;
  issued_on: string;
  status: "ready" | "paid" | "filed";
  storage_bucket: string | null;
  storage_path: string | null;
  external_url: string | null;
};

type PayrollPageDocument = PayrollPageData["documents"][number];

type DisplayPayrollDocument = PayrollPageDocument & {
  issuedOnRaw: string;
};

export function getPayrollStatementDocumentHref(statementId: string) {
  return `/api/payroll/document?statementId=${encodeURIComponent(statementId)}`;
}

export async function getEmployeePayrollPageData(
  userId?: string,
  profile?: ProfileRecord | null,
): Promise<PayrollPageData> {
  noStore();

  if (!isSupabaseConfigured() || !userId) {
    return createEmptyPayrollPageData("unconfigured", userId, profile);
  }

  try {
    const { activeStoreKey } = await requireActiveStoreContext();
    const supabase = await createClient();

    const { data: statementRows } = await selectPayStatementsWithFallback<PayStatementRow[]>(
      async (select) =>
        supabase
          .from("pay_statements")
          .select(`${select},pay_statement_deductions(id,label,amount,sort_order)`)
          .eq("employee_id", userId)
          .eq("store_key", activeStoreKey)
          .order("pay_date", { ascending: false })
          .returns<PayStatementRow[]>(),
    );

    const { data: documentRows } = await supabase
      .from("payroll_documents")
      .select(
        "id,name,category,pay_statement_id,period_label,issued_on,status,storage_bucket,storage_path,external_url",
      )
      .eq("employee_id", userId)
      .eq("store_key", activeStoreKey)
      .order("issued_on", { ascending: false })
      .returns<PayrollDocumentRow[]>();

    const statements =
      statementRows?.map((statement) => {
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

        return {
          id: statement.id,
          period: statement.period_label,
          payDate: formatDate(statement.pay_date),
          gross: Number(statement.gross_pay ?? 0),
          deductions: Number(statement.deductions_total ?? 0),
          net: Number(statement.net_pay ?? 0),
          paidHours: calculation.regularHours,
          hourlyRate: calculation.hourlyRate,
          bonus: Number(statement.bonus_amount ?? 0),
          status: (
            statement.status === "scheduled"
              ? "Scheduled"
              : statement.status === "draft"
                ? "Scheduled"
                : "Paid"
          ) as "Paid" | "Scheduled",
        };
      }) ?? [];

    const storedDocuments =
      (await Promise.all(
        (documentRows ?? []).map(async (document) => ({
          id: document.id,
          name: sentenceCase(document.name),
          category: mapDocumentCategory(document.category),
          period: document.period_label,
          issuedOnRaw: document.issued_on,
          issuedOn: formatDate(document.issued_on),
          status: mapDocumentStatus(document.status),
          href: await resolveDocumentHref(supabase, document),
        })),
      )) ?? [];

    const payStatementDocumentIds = new Set(
      (documentRows ?? [])
        .filter(
          (document) =>
            document.category === "pay_statement" &&
            typeof document.pay_statement_id === "string" &&
            document.pay_statement_id.length > 0,
        )
        .map((document) => document.pay_statement_id as string),
    );

    const fallbackDocuments: DisplayPayrollDocument[] = (statementRows ?? [])
      .filter((statement) => !payStatementDocumentIds.has(statement.id))
      .map((statement) => ({
        id: `generated-pay-statement-${statement.id}`,
        name: "Pay Statement",
        category: "Pay Statement" as const,
        period: statement.period_label,
        issuedOnRaw: statement.pay_date,
        issuedOn: formatDate(statement.pay_date),
        status:
          statement.status === "paid" || statement.status === "archived"
            ? ("Paid" as const)
            : ("Ready" as const),
        href: getPayrollStatementDocumentHref(statement.id),
      }));

    const documents = [...storedDocuments, ...fallbackDocuments]
      .sort((left, right) => right.issuedOnRaw.localeCompare(left.issuedOnRaw))
      .map(({ issuedOnRaw, ...document }) => document);

    const deductionMap = new Map<string, number>();

    (statementRows ?? []).forEach((statement) => {
      if (statement.status !== "paid" && statement.status !== "archived") {
        return;
      }

      (statement.pay_statement_deductions ?? []).forEach((deduction) => {
        deductionMap.set(
          deduction.label,
          (deductionMap.get(deduction.label) ?? 0) + Number(deduction.amount ?? 0),
        );
      });
    });

    const deductionBreakdown = Array.from(deductionMap.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([label, amount], index) => ({
        label,
        amount,
        tone: (["amber", "blue", "violet", "green"][index] ??
          "green") as "amber" | "blue" | "violet" | "green",
      }));

    const currentStatement = statements.find(
      (statement) => statement.status === "Scheduled",
    );

    return {
      source: "database",
      employee: {
        id: userId,
        name: profile?.full_name ?? "Employee",
        role: profile?.position_title ?? roleLabel(profile?.role),
        employeeNumber: profile?.employee_number ?? "Not assigned",
        department: profile?.department ?? "Unassigned",
        directDepositAccount: formatDepositAccount(profile),
        payFrequency: profile?.pay_frequency ?? "Bi-weekly",
        nextPayDate: currentStatement?.payDate ?? "Not scheduled",
        manager: profile?.manager_name ?? "Unassigned",
      },
      statements,
      documents,
      deductionBreakdown,
    };
  } catch (error) {
    console.error("Failed to load employee payroll page data:", error);
    return createEmptyPayrollPageData("error", userId, profile);
  }
}

async function resolveDocumentHref(
  supabase: Awaited<ReturnType<typeof createClient>>,
  document: PayrollDocumentRow,
) {
  if (document.external_url) {
    return document.external_url;
  }

  if (!document.storage_path) {
    return document.pay_statement_id
      ? getPayrollStatementDocumentHref(document.pay_statement_id)
      : "#";
  }

  const bucket = document.storage_bucket ?? getPayrollDocumentsBucket();
  const { data } = await supabase.storage
    .from(bucket)
    .createSignedUrl(document.storage_path, 60 * 15);

  return data?.signedUrl ?? "#";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric", timeZone: "UTC",
  }).format(new Date(value));
}

function mapDocumentCategory(category: PayrollDocumentRow["category"]) {
  if (category === "deposit_advice") {
    return "Deposit Advice" as const;
  }

  if (category === "tax_summary") {
    return "Tax Summary" as const;
  }

  return "Pay Statement" as const;
}

function mapDocumentStatus(status: PayrollDocumentRow["status"]) {
  if (status === "paid") {
    return "Paid" as const;
  }

  if (status === "filed") {
    return "Filed" as const;
  }

  return "Ready" as const;
}

function sentenceCase(value: string) {
  return value
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function roleLabel(role?: string | null) {
  if (!role) {
    return "Employee";
  }

  return role
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDepositAccount(profile?: ProfileRecord | null) {
  if (!profile?.bank_name || !profile.bank_account_last4) {
    return "Direct deposit not configured";
  }

  return `${profile.bank_name} •••• ${profile.bank_account_last4}`;
}

function createEmptyPayrollPageData(
  source: Exclude<PayrollPageData["source"], "database">,
  userId?: string,
  profile?: ProfileRecord | null,
): PayrollPageData {
  return {
    source,
    employee: {
      id: userId ?? "unassigned",
      name: profile?.full_name ?? "Employee",
      role: profile?.position_title ?? roleLabel(profile?.role),
      employeeNumber: profile?.employee_number ?? "Not assigned",
      department: profile?.department ?? "Unassigned",
      directDepositAccount: formatDepositAccount(profile),
      payFrequency: profile?.pay_frequency ?? "Not configured",
      nextPayDate: "Not scheduled",
      manager: profile?.manager_name ?? "Unassigned",
    },
    statements: [],
    documents: [],
    deductionBreakdown: [],
  };
}
