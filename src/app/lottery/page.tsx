import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { LotteryDashboard } from "@/components/lottery/lottery-dashboard";
import { loadLotteryDashboardData } from "@/lib/lottery/dashboard";

export const metadata: Metadata = {
  title: "Lottery Dashboard",
};

export default async function LotteryDashboardPage() {
  const dashboardData = await loadLotteryDashboardData();

  return (
    <>
      <Breadcrumb pageName="Lottery Dashboard" />
      <LotteryDashboard
        cashTransactions={dashboardData.cashTransactions}
        errorMessage={dashboardData.errorMessage}
        inventorySummary={dashboardData.inventorySummary}
        scratchLedger={dashboardData.scratchLedger}
        source={dashboardData.source}
        summary={dashboardData.summary}
        timeZone={dashboardData.timeZone}
      />
    </>
  );
}
