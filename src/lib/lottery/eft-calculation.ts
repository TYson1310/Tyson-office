export type LotteryEftFormulaInput = {
  administrativeFees?: number;
  bondingFee?: number;
  grossSales: number;
  payoutCommissionRate: number;
  promoCredits?: number;
  prizePayouts: number;
  retailerCommissionRate: number;
  ticketCancels: number;
};

export type LotteryEftFormulaResult = {
  administrativeFees: number;
  bondingFee: number;
  grossSales: number;
  netEftDue: number;
  netTicketSales: number;
  payoutCommissionCredit: number;
  promoCredits: number;
  retailerCommissionCredit: number;
  ticketCancels: number;
  totalCommissions: number;
  totalCredits: number;
  totalPayouts: number;
};

function normalizeMoney(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

function normalizePercent(value: number | string | null | undefined) {
  const normalized = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 0;
  }

  return Math.min(normalized, 100);
}

export function calculateLotteryEftFormula({
  administrativeFees: administrativeFeeInput,
  bondingFee: bondingFeeInput,
  grossSales: grossSalesInput,
  payoutCommissionRate: payoutCommissionRateInput,
  promoCredits: promoCreditsInput,
  prizePayouts,
  retailerCommissionRate: retailerCommissionRateInput,
  ticketCancels: ticketCancelsInput,
}: LotteryEftFormulaInput): LotteryEftFormulaResult {
  const administrativeFees = normalizeMoney(administrativeFeeInput);
  const bondingFee = normalizeMoney(bondingFeeInput);
  const grossSales = normalizeMoney(grossSalesInput);
  const payoutCommissionRate = normalizePercent(payoutCommissionRateInput);
  const retailerCommissionRate = normalizePercent(retailerCommissionRateInput);
  const ticketCancels = normalizeMoney(ticketCancelsInput);
  const promoCredits = normalizeMoney(promoCreditsInput);
  const totalPayouts = normalizeMoney(prizePayouts);
  const netTicketSales = normalizeMoney(grossSales - ticketCancels);
  const retailerCommissionCredit = normalizeMoney(
    netTicketSales * (retailerCommissionRate / 100),
  );
  const payoutCommissionCredit = normalizeMoney(
    totalPayouts * (payoutCommissionRate / 100),
  );
  const totalCommissions = normalizeMoney(
    retailerCommissionCredit + payoutCommissionCredit,
  );
  const totalCredits = normalizeMoney(
    ticketCancels + totalPayouts + totalCommissions + promoCredits,
  );
  const netEftDue = normalizeMoney(
    netTicketSales -
      totalCommissions -
      totalPayouts -
      promoCredits +
      bondingFee +
      administrativeFees,
  );

  return {
    administrativeFees,
    bondingFee,
    grossSales,
    netEftDue,
    netTicketSales,
    payoutCommissionCredit,
    promoCredits,
    retailerCommissionCredit,
    ticketCancels,
    totalCommissions,
    totalCredits,
    totalPayouts,
  };
}
