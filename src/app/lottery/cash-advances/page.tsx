import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { StoreScopeBanner } from "@/components/erp/store-scope-banner";
import { LotteryCashAdvancesPanel } from "@/components/lottery/lottery-cash-advances-panel";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { loadLotteryCashAdvanceSummary } from "@/lib/lottery/cash-advances";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { requireActiveStoreContext } from "@/lib/stores/server";

export const metadata: Metadata = {
  title: "Lottery Cash Advances",
};

export default async function LotteryCashAdvancesPage() {
  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const businessDate = getTodayIsoDateInTimeZone(activeStore.timeZone);
  const summary = isSupabaseConfigured()
    ? await loadLotteryCashAdvanceSummary({
        supabase: await createClient(),
        storeKey: activeStoreKey,
        businessDate,
      })
    : {
        available: false,
        dailyAdvanceTotal: 0,
        dailyNetCashImpact: 0,
        dailyPaybackTotal: 0,
        openAdvanceBalance: 0,
        openAdvances: [],
        openBalance: 0,
        warning: "Supabase is not configured.",
      };

  return (
    <div className="mx-auto max-w-5xl">
      <Breadcrumb pageName="Lottery Cash Advances" />
      <StoreScopeBanner
        storeKey={activeStoreKey}
        storeName={activeStore.name}
        timeZone={activeStore.timeZone}
      />
      <LotteryCashAdvancesPanel
        available={summary.available}
        businessDate={businessDate}
        dailyAdvanceTotal={summary.dailyAdvanceTotal}
        dailyNetCashImpact={summary.dailyNetCashImpact}
        dailyPaybackTotal={summary.dailyPaybackTotal}
        openAdvanceBalance={summary.openBalance}
        openAdvances={summary.openAdvances}
        warning={summary.warning}
      />
    </div>
  );
}
