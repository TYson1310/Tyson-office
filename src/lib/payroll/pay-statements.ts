type QueryError = {
  message?: string | null;
  code?: string | null;
};

const PAY_STATEMENT_SELECT_LEGACY_BASE =
  "id,employee_id,period_label,period_start,period_end,pay_date,gross_pay,deductions_total,net_pay,overtime_hours,bonus_amount,status,notes,created_at,updated_at";

export const PAY_STATEMENT_SELECT_BASE = `${PAY_STATEMENT_SELECT_LEGACY_BASE},payment_method`;

const PAY_STATEMENT_SELECT_LEGACY_WITH_HOURLY_FIELDS = `${PAY_STATEMENT_SELECT_LEGACY_BASE},regular_hours,hourly_rate,overtime_multiplier`;

export const PAY_STATEMENT_SELECT_WITH_HOURLY_FIELDS = `${PAY_STATEMENT_SELECT_BASE},regular_hours,hourly_rate,overtime_multiplier`;

export const PAY_STATEMENT_SELECT_WITH_HOURLY_FIELDS_AND_DEDUCTIONS =
  `${PAY_STATEMENT_SELECT_WITH_HOURLY_FIELDS},pay_statement_deductions(id,label,amount,sort_order)`;

export function isMissingHourlyPayrollFieldsError(
  error: QueryError | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    message.includes("pay_statements.regular_hours") ||
    message.includes("pay_statements.hourly_rate") ||
    message.includes("pay_statements.overtime_multiplier") ||
    message.includes("'regular_hours' column of 'pay_statements'") ||
    message.includes("'hourly_rate' column of 'pay_statements'") ||
    message.includes("'overtime_multiplier' column of 'pay_statements'")
  );
}

export function isMissingPaymentMethodFieldError(
  error: QueryError | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    message.includes("pay_statements.payment_method") ||
    message.includes("'payment_method' column of 'pay_statements'")
  );
}

export async function selectPayStatementsWithFallback<T>(
  execute: (
    select: string,
  ) => Promise<{ data: T | null; error: QueryError | null }>,
) {
  const selectAttempts = [
    PAY_STATEMENT_SELECT_WITH_HOURLY_FIELDS,
    PAY_STATEMENT_SELECT_LEGACY_WITH_HOURLY_FIELDS,
    PAY_STATEMENT_SELECT_BASE,
    PAY_STATEMENT_SELECT_LEGACY_BASE,
  ];

  let lastResult:
    | {
        data: T | null;
        error: QueryError | null;
      }
    | undefined;

  for (const select of selectAttempts) {
    const result = await execute(select);
    lastResult = result;

    if (!result.error) {
      return result;
    }

    if (
      !isMissingHourlyPayrollFieldsError(result.error) &&
      !isMissingPaymentMethodFieldError(result.error)
    ) {
      return result;
    }
  }

  return lastResult ?? execute(PAY_STATEMENT_SELECT_LEGACY_BASE);
}

function toFiniteNumber(value: unknown) {
  const normalized =
    typeof value === "string" && value.trim().length === 0 ? 0 : Number(value ?? 0);

  return Number.isFinite(normalized) ? normalized : 0;
}

export function calculatePayStatementTotals(input: {
  explicitGrossPay?: unknown;
  explicitNetPay?: unknown;
  deductionsTotal?: unknown;
  bonusAmount?: unknown;
  regularHours?: unknown;
  overtimeHours?: unknown;
  hourlyRate?: unknown;
  overtimeMultiplier?: unknown;
}) {
  const explicitGrossPay =
    input.explicitGrossPay === undefined ? undefined : toFiniteNumber(input.explicitGrossPay);
  const bonusAmount = toFiniteNumber(input.bonusAmount);
  const deductionsTotal = toFiniteNumber(input.deductionsTotal);
  const regularHoursInput = toFiniteNumber(input.regularHours);
  const legacyOvertimeHours = toFiniteNumber(input.overtimeHours);
  const regularHours = regularHoursInput + legacyOvertimeHours;
  const overtimeHours = 0;
  const hourlyRate = toFiniteNumber(input.hourlyRate);
  const overtimeMultiplier = 1;
  const usesHourlyCalculation = hourlyRate > 0 && explicitGrossPay === undefined;

  let regularPay = 0;
  let grossPay = 0;

  if (usesHourlyCalculation) {
    regularPay = regularHours * hourlyRate;
    grossPay = regularPay + bonusAmount;
  } else {
    grossPay = explicitGrossPay ?? 0;
    regularPay = Math.max(grossPay - bonusAmount, 0);
  }

  const netPay =
    input.explicitNetPay === undefined
      ? Math.max(grossPay - deductionsTotal, 0)
      : toFiniteNumber(input.explicitNetPay);

  return {
    bonusAmount,
    deductionsTotal,
    grossPay,
    hourlyRate,
    netPay,
    overtimeHours,
    overtimeMultiplier,
    overtimePay: 0,
    regularHours,
    regularPay,
    usesHourlyCalculation,
  };
}
