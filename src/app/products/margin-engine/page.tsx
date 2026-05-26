import type { Metadata } from "next";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { MarginEngineWorkbench } from "@/components/products/margin-engine-workbench";
import {
  calculateProductMarginPercent,
  getOperationsDataset,
} from "@/lib/erp/operations";
import { canManageProductRecords } from "@/lib/products/api";
import { getUserSafely } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/erp.types";

export const metadata: Metadata = {
  title: "Margin Engine",
};

function calculatePerItemCost(cost: number, quantity: number) {
  return quantity > 0 ? cost / quantity : cost;
}

export default async function MarginEnginePage() {
  const dataset = await getOperationsDataset();
  let canEditLedger = false;

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await getUserSafely(supabase);

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle<{ role: UserRole | null }>();

      canEditLedger = canManageProductRecords(profile?.role);
    }
  }

  const products = [...dataset.products]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((product) => {
      const cost = calculatePerItemCost(product.cost, product.quantity);

      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        category: product.category,
        supplierName: product.supplierName ?? "Unassigned supplier",
        location: product.location ?? "Floor not assigned",
        cost,
        ledgerCost: product.cost,
        price: product.price,
        quantity: product.quantity,
        reorderLevel: product.reorderLevel,
        dailyVelocity: product.dailyVelocity,
        targetMarginPercent: product.targetMarginPercent,
        currentMarginPercent: calculateProductMarginPercent({
          price: product.price,
          cost,
        }),
      };
    });

  return (
    <div className="space-y-4">
      {dataset.source !== "database" && (
        <div className="rounded-[18px] border border-dashed border-primary/30 bg-primary/5 px-4 py-3 text-sm text-dark-5 dark:text-dark-6">
          Supabase product records are not available yet. The margin engine is
          using an empty live state until the database connection is configured.
        </div>
      )}

      <OperationsCompatibilityNotice warnings={dataset.compatibilityWarnings} />

      <MarginEngineWorkbench
        products={products}
        compact
        canEditLedger={canEditLedger}
      />
    </div>
  );
}
