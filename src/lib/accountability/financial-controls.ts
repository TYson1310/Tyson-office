import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export const FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE =
  "Apply Supabase migration 202605200004_financial_accountability_controls.sql before using financial accountability controls.";

type SchemaError = {
  code?: string | null;
  message?: string | null;
};

function getErrorMessage(error: SchemaError | null | undefined) {
  return error?.message?.toLowerCase() ?? "";
}

export function isMissingFinancialAccountabilityMigration(
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
    "cash_vault_adjustments",
    "paid_reference",
    "paid_notes",
    "void_reason",
    "voided_at",
    "voided_by",
    "vendor_invoice_id",
    "manual_adjustment",
    "vendor_invoice_receipt",
    "inventory_movements_movement_type_check",
    "bank_deposits_status_check",
  ].some((token) => message.includes(token));
}

export async function loadFinancialAccountabilityStatus(
  supabase: SupabaseServerClient,
  storeKey: string,
) {
  noStore();

  const checks = await Promise.all([
    supabase
      .from("bank_deposits")
      .select("id,status,void_reason,voided_by,voided_at")
      .eq("store_key", storeKey)
      .limit(1),
    supabase
      .from("cash_vault_adjustments")
      .select("id")
      .eq("store_key", storeKey)
      .limit(1),
    supabase
      .from("inventory_movements")
      .select("id,vendor_invoice_id")
      .eq("store_key", storeKey)
      .limit(1),
    supabase
      .from("lottery_eft_weekly_status")
      .select("sweep_date,paid_reference,paid_notes")
      .eq("store_key", storeKey)
      .limit(1),
  ]);
  const missingMigration = checks.some((check) =>
    isMissingFinancialAccountabilityMigration(check.error),
  );
  const otherError = checks.find(
    (check) =>
      check.error && !isMissingFinancialAccountabilityMigration(check.error),
  )?.error;

  if (otherError) {
    return {
      available: false,
      warnings: [
        otherError.message ??
          "Financial accountability migration status could not be checked.",
      ],
    };
  }

  if (missingMigration) {
    return {
      available: false,
      warnings: [FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE],
    };
  }

  return {
    available: true,
    warnings: [] as string[],
  };
}
