import { getLatestLotteryEftSweepDate } from "./eft-periods.ts";

export function getLotteryCashInHandPaidEftSweepDate({
  businessDate,
  cashInHandCutoffDate,
}: {
  businessDate: string;
  cashInHandCutoffDate: string;
}) {
  const businessSweepDate = getLatestLotteryEftSweepDate(businessDate);
  const cutoffSweepDate = getLatestLotteryEftSweepDate(cashInHandCutoffDate);

  return businessSweepDate > cutoffSweepDate
    ? businessSweepDate
    : cutoffSweepDate;
}
