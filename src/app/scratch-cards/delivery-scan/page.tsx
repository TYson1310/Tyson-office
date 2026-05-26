import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { DeliveryScanScreen } from "@/components/scratch-cards/delivery-scan-screen";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { loadScratchDeliveryLedgerData } from "@/lib/scratch-cards/data";
import { getServerStoreContext } from "@/lib/stores/server";

export const metadata: Metadata = {
  title: "Delivery Scan",
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

export default async function DeliveryScanPage({ searchParams }: PageProps) {
  const { date } = await searchParams;
  const storeContext = await getServerStoreContext();
  const todayDate = getTodayIsoDateInTimeZone(
    storeContext.activeStore?.timeZone ?? "UTC",
  );
  const selectedDate = storeContext.isAdmin
    ? parseSelectedDate(date, todayDate)
    : todayDate;
  const deliveryLedgerData = await loadScratchDeliveryLedgerData();

  return (
    <>
      <Breadcrumb pageName="Delivery Scan" />
      <DeliveryScanScreen
        canSelectDate={storeContext.isAdmin}
        deliveryLedger={deliveryLedgerData.ledger}
        ledgerErrorMessage={deliveryLedgerData.errorMessage}
        selectedDate={selectedDate}
        todayDate={todayDate}
      />
    </>
  );
}
