import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  calculateLotteryCashAdvanceImpact,
  roundLotteryCashAdvanceMoney,
} from "./cash-advance-calculation";

export {
  calculateLotteryCashAdvanceImpact,
  roundLotteryCashAdvanceMoney,
} from "./cash-advance-calculation";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type SchemaError = {
  code?: string | null;
  message?: string | null;
};

export const LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE =
  "Apply the latest lottery cash advance Supabase migrations before using lottery cash advances.";

export type LotteryCashAdvanceStatus = "open" | "paid" | "partial" | "void";

export type LotteryCashAdvanceRecord = {
  id: string;
  advanceDate: string;
  personName: string;
  amount: number;
  amountRepaid: number;
  balance: number;
  reason: string;
  expectedPaybackDate?: string;
  notes?: string;
  sendToCashVault: boolean;
  status: LotteryCashAdvanceStatus;
  createdAt: string;
};

export type LotteryCashAdvanceSummary = {
  available: boolean;
  warning?: string;
  dailyAdvanceTotal: number;
  dailyPaybackTotal: number;
  dailyNetCashImpact: number;
  openBalance: number;
  openAdvances: LotteryCashAdvanceRecord[];
};

type LotteryCashAdvanceRow = {
  id: string;
  advance_date: string;
  person_name: string;
  amount: number | string;
  reason: string;
  expected_payback_date: string | null;
  notes: string | null;
  send_to_cash_vault?: boolean | null;
  status: "posted" | "void";
  created_at: string;
};

type LotteryCashAdvancePaymentRow = {
  id: string;
  advance_id: string;
  payment_date: string;
  amount: number | string;
  status: "posted" | "void";
};

function getErrorMessage(error: SchemaError | null | undefined) {
  return error?.message?.toLowerCase() ?? "";
}

export function isMissingLotteryCashAdvanceMigration(
  error: SchemaError | null | undefined,
) {
  const message = getErrorMessage(error);

  if (!message) {
    return false;
  }

  const missingSchema =
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("violates check constraint");

  if (!missingSchema) {
    return false;
  }

  return [
    "lottery_cash_advances",
    "lottery_cash_advance_payments",
    "lottery_cash_advance_to_vault",
    "lottery_cash_advance_payback_from_vault",
    "cash_vault_transactions_movement_type_check",
    "send_to_cash_vault",
  ].some((token) => message.includes(token));
}

function getEmptyCashAdvanceSummary(
  warning?: string,
): LotteryCashAdvanceSummary {
  return {
    available: !warning,
    warning,
    dailyAdvanceTotal: 0,
    dailyNetCashImpact: 0,
    dailyPaybackTotal: 0,
    openAdvances: [],
    openBalance: 0,
  };
}

function getAdvanceStatus(input: {
  baseStatus: "posted" | "void";
  amount: number;
  amountRepaid: number;
}): LotteryCashAdvanceStatus {
  if (input.baseStatus === "void") {
    return "void";
  }

  if (input.amountRepaid <= 0) {
    return "open";
  }

  return input.amountRepaid >= input.amount ? "paid" : "partial";
}

function sumPostedPayments(
  payments: LotteryCashAdvancePaymentRow[],
  advanceId: string,
) {
  return roundLotteryCashAdvanceMoney(
    payments
      .filter(
        (payment) =>
          payment.advance_id === advanceId && payment.status === "posted",
      )
      .reduce(
        (total, payment) =>
          total + roundLotteryCashAdvanceMoney(payment.amount),
        0,
      ),
  );
}

export async function loadLotteryCashAdvanceSummary(input: {
  supabase: SupabaseServerClient;
  storeKey: string;
  businessDate: string;
}): Promise<LotteryCashAdvanceSummary> {
  noStore();

  const { supabase, storeKey, businessDate } = input;
  const [dailyAdvancesResult, dailyPaymentsResult, postedAdvancesResult] =
    await Promise.all([
      supabase
        .from("lottery_cash_advances")
        .select(
          "id,advance_date,person_name,amount,reason,expected_payback_date,notes,send_to_cash_vault,status,created_at",
        )
        .eq("store_key", storeKey)
        .eq("advance_date", businessDate)
        .eq("status", "posted")
        .returns<LotteryCashAdvanceRow[]>(),
      supabase
        .from("lottery_cash_advance_payments")
        .select("id,advance_id,payment_date,amount,status")
        .eq("store_key", storeKey)
        .eq("payment_date", businessDate)
        .eq("status", "posted")
        .returns<LotteryCashAdvancePaymentRow[]>(),
      supabase
        .from("lottery_cash_advances")
        .select(
          "id,advance_date,person_name,amount,reason,expected_payback_date,notes,send_to_cash_vault,status,created_at",
        )
        .eq("store_key", storeKey)
        .eq("status", "posted")
        .order("advance_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<LotteryCashAdvanceRow[]>(),
    ]);

  const schemaError = [
    dailyAdvancesResult.error,
    dailyPaymentsResult.error,
    postedAdvancesResult.error,
  ].find((error) => isMissingLotteryCashAdvanceMigration(error));

  if (schemaError) {
    return getEmptyCashAdvanceSummary(LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE);
  }

  const firstError = [
    dailyAdvancesResult.error,
    dailyPaymentsResult.error,
    postedAdvancesResult.error,
  ].find(Boolean);

  if (firstError) {
    return getEmptyCashAdvanceSummary(
      firstError.message ?? "Lottery cash advances could not be loaded.",
    );
  }

  const postedAdvances = postedAdvancesResult.data ?? [];
  const advanceIds = postedAdvances.map((advance) => advance.id);
  let postedAdvancePayments: LotteryCashAdvancePaymentRow[] = [];

  if (advanceIds.length > 0) {
    const paymentsResult = await supabase
      .from("lottery_cash_advance_payments")
      .select("id,advance_id,payment_date,amount,status")
      .eq("store_key", storeKey)
      .in("advance_id", advanceIds)
      .eq("status", "posted")
      .returns<LotteryCashAdvancePaymentRow[]>();

    if (isMissingLotteryCashAdvanceMigration(paymentsResult.error)) {
      return getEmptyCashAdvanceSummary(LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE);
    }

    if (paymentsResult.error) {
      return getEmptyCashAdvanceSummary(
        paymentsResult.error.message ??
          "Lottery cash advance payments could not be loaded.",
      );
    }

    postedAdvancePayments = paymentsResult.data ?? [];
  }

  const dailyAdvanceTotal = roundLotteryCashAdvanceMoney(
    (dailyAdvancesResult.data ?? []).reduce(
      (total, advance) => total + roundLotteryCashAdvanceMoney(advance.amount),
      0,
    ),
  );
  const dailyPaybackTotal = roundLotteryCashAdvanceMoney(
    (dailyPaymentsResult.data ?? []).reduce(
      (total, payment) => total + roundLotteryCashAdvanceMoney(payment.amount),
      0,
    ),
  );
  const openAdvances = postedAdvances
    .map((advance) => {
      const amount = roundLotteryCashAdvanceMoney(advance.amount);
      const amountRepaid = sumPostedPayments(postedAdvancePayments, advance.id);
      const balance = roundLotteryCashAdvanceMoney(
        Math.max(amount - amountRepaid, 0),
      );
      const status = getAdvanceStatus({
        amount,
        amountRepaid,
        baseStatus: advance.status,
      });

      return {
        id: advance.id,
        advanceDate: advance.advance_date,
        amount,
        amountRepaid,
        balance,
        createdAt: advance.created_at,
        expectedPaybackDate: advance.expected_payback_date ?? undefined,
        notes: advance.notes ?? undefined,
        personName: advance.person_name,
        reason: advance.reason,
        sendToCashVault: Boolean(advance.send_to_cash_vault),
        status,
      };
    })
    .filter((advance) => advance.status !== "paid");
  const openBalance = roundLotteryCashAdvanceMoney(
    openAdvances.reduce((total, advance) => total + advance.balance, 0),
  );

  return {
    available: true,
    dailyAdvanceTotal,
    dailyNetCashImpact: calculateLotteryCashAdvanceImpact({
      advancesTaken: dailyAdvanceTotal,
      paybacksReceived: dailyPaybackTotal,
    }),
    dailyPaybackTotal,
    openAdvances,
    openBalance,
  };
}
