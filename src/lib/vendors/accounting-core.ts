export function deriveVendorInvoiceStatus(input: {
  dueDate: string;
  netBalance: number;
}) {
  if (input.netBalance <= 0.005) {
    return "paid" as const;
  }

  const dueDate = new Date(`${input.dueDate}T00:00:00.000Z`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!Number.isNaN(dueDate.getTime()) && dueDate < today) {
    return "overdue" as const;
  }

  return "pending" as const;
}

export function calculateVendorInvoiceNetBalance(input: {
  invoiceAmount: number;
  totalPayments: number;
  totalAdjustments: number;
}) {
  return (
    Math.round(
      (input.invoiceAmount - input.totalPayments - input.totalAdjustments) * 100,
    ) / 100
  );
}
