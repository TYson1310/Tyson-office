import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { StoreScopeBanner } from "@/components/erp/store-scope-banner";
import { DailyCloseoutShell } from "@/components/daily-closeout/daily-closeout-shell";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { loadLotteryEodReconciliationData } from "@/lib/lottery/eod-reconciliation";
import { getServerStoreContext } from "@/lib/stores/server";

export const metadata: Metadata = { title: "Daily Close Out" };

export default async function DailyCloseoutPage() {
  const storeContext = await getServerStoreContext();
  const todayDate = getTodayIsoDateInTimeZone(storeContext.activeStore?.timeZone ?? "UTC");
  const data = await loadLotteryEodReconciliationData({ date: todayDate });

  return (
    <>
      <Breadcrumb pageName="Daily Close Out" />
      <StoreScopeBanner storeKey={storeContext.activeStore?.storeKey} storeName={storeContext.activeStore?.name} timeZone={storeContext.activeStore?.timeZone} />
      <DailyCloseoutShell canSelectDate={storeContext.isAdmin} data={data} todayDate={todayDate} />
    </>
  );
}
