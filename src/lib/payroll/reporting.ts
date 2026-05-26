import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type PayStatementRow = {
  employee_id: string;
  period_label: string;
  pay_date: string;
  gross_pay: number;
  deductions_total: number;
  net_pay: number;
};

export type PayrollAnalysisPeriodRow = {
  period: string;
  payDate: string;
  employees: number;
  grossPay: number;
  deductions: number;
  netPay: number;
};

export async function getPayrollAnalysisRowsForStore(activeStoreKey: string) {
  if (!isSupabaseConfigured()) {
    return [] as PayrollAnalysisPeriodRow[];
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pay_statements")
    .select("employee_id,period_label,pay_date,gross_pay,deductions_total,net_pay")
    .eq("store_key", activeStoreKey)
    .order("pay_date", { ascending: false })
    .returns<PayStatementRow[]>();

  if (error) {
    throw error;
  }

  const byPeriod = new Map<string, PayrollAnalysisPeriodRow>();

  (data ?? []).forEach((row) => {
    const current = byPeriod.get(row.period_label) ?? {
      period: row.period_label,
      payDate: row.pay_date,
      employees: 0,
      grossPay: 0,
      deductions: 0,
      netPay: 0,
    };

    current.employees += 1;
    current.grossPay += Number(row.gross_pay ?? 0);
    current.deductions += Number(row.deductions_total ?? 0);
    current.netPay += Number(row.net_pay ?? 0);
    current.payDate = row.pay_date > current.payDate ? row.pay_date : current.payDate;
    byPeriod.set(row.period_label, current);
  });

  return Array.from(byPeriod.values()).sort((left, right) =>
    right.payDate.localeCompare(left.payDate),
  );
}
