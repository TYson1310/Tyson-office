import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { EodReconciliationWorkbench } from "@/components/lottery/eod-reconciliation-workbench";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { loadLotteryEodReconciliationData } from "@/lib/lottery/eod-reconciliation";
import { getServerStoreContext } from "@/lib/stores/server";

export const metadata: Metadata = {
  title: "Lottery EOD Reconciliation",
};

type PageProps = {
  searchParams: Promise<{
    date?: string | string[];
  }>;
};

function parseSelectedDate(
  value: string | string[] | undefined,
  todayDate: string,
) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(normalized)) {
    return todayDate;
  }

  return normalized > todayDate ? todayDate : normalized;
}

export default async function LotteryEodReconciliationPage({
  searchParams,
}: PageProps) {
  const { date } = await searchParams;
  const storeContext = await getServerStoreContext();
  const todayDate = getTodayIsoDateInTimeZone(
    storeContext.activeStore?.timeZone ?? "UTC",
  );
  const selectedDate = storeContext.isAdmin
    ? parseSelectedDate(date, todayDate)
    : todayDate;
  const data = await loadLotteryEodReconciliationData({ date: selectedDate });

  return (
    <>
      <Breadcrumb pageName="Lottery EOD Reconciliation" />
      <EodReconciliationWorkbench
        canSelectDate={storeContext.isAdmin}
        data={data}
        todayDate={todayDate}
      />
    </>
  );
}
