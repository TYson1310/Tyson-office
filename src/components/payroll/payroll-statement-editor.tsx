"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Settings2, X } from "lucide-react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { ModalPortal } from "@/components/ui/modal-portal";
import {
  DEFAULT_PAYROLL_PAYMENT_METHOD,
  PAYROLL_PAYMENT_METHOD_OPTIONS,
} from "@/lib/payroll/payment-methods";
import type {
  PayrollDeductions,
  PayrollPaymentMethod,
} from "@/types/erp.types";

type PayrollStatementEditorProps = {
  statementId: string;
  employeeName: string;
  periodLabel: string;
  initialGrossPay: number;
  initialBonusAmount: number;
  initialPaymentMethod?: string | null;
  initialDeductionsTotal: number;
  initialDeductionRows?: Array<{
    id: string;
    label: string;
    amount: number;
    sort_order: number | null;
  }> | null;
  allowAdjustments?: boolean;
  disabled?: boolean;
};

type DeductionFormState = {
  incomeTax: string;
  socialSecurity: string;
  healthInsurance: string;
  employeeAdvance: string;
  other: string;
};

function toCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function toNumber(value: string) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.max(normalized, 0) : 0;
}

function mapDeductionFormState(
  deductionRows: PayrollStatementEditorProps["initialDeductionRows"],
  totalDeductions: number,
): DeductionFormState {
  const summary = {
    incomeTax: 0,
    socialSecurity: 0,
    healthInsurance: 0,
    employeeAdvance: 0,
    other: 0,
  };

  (deductionRows ?? []).forEach((row) => {
    const label = row.label.trim().toLowerCase();
    const amount = Number(row.amount ?? 0);

    if (label.includes("income") && label.includes("tax")) {
      summary.incomeTax += amount;
      return;
    }

    if (label.includes("social")) {
      summary.socialSecurity += amount;
      return;
    }

    if (label.includes("health")) {
      summary.healthInsurance += amount;
      return;
    }

    if (label.includes("advance")) {
      summary.employeeAdvance += amount;
      return;
    }

    summary.other += amount;
  });

  if (
    summary.incomeTax === 0 &&
    summary.socialSecurity === 0 &&
    summary.healthInsurance === 0 &&
    summary.employeeAdvance === 0 &&
    summary.other === 0 &&
    totalDeductions > 0
  ) {
    summary.other = totalDeductions;
  }

  return {
    incomeTax: summary.incomeTax > 0 ? summary.incomeTax.toFixed(2) : "",
    socialSecurity:
      summary.socialSecurity > 0 ? summary.socialSecurity.toFixed(2) : "",
    healthInsurance:
      summary.healthInsurance > 0 ? summary.healthInsurance.toFixed(2) : "",
    employeeAdvance:
      summary.employeeAdvance > 0 ? summary.employeeAdvance.toFixed(2) : "",
    other: summary.other > 0 ? summary.other.toFixed(2) : "",
  };
}

export function PayrollStatementEditor({
  statementId,
  employeeName,
  periodLabel,
  initialGrossPay,
  initialBonusAmount,
  initialPaymentMethod,
  initialDeductionsTotal,
  initialDeductionRows,
  allowAdjustments = true,
  disabled = false,
}: PayrollStatementEditorProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PayrollPaymentMethod>(
    DEFAULT_PAYROLL_PAYMENT_METHOD,
  );
  const [bonusAmount, setBonusAmount] = useState("");
  const [deductions, setDeductions] = useState<DeductionFormState>({
    incomeTax: "",
    socialSecurity: "",
    healthInsurance: "",
    employeeAdvance: "",
    other: "",
  });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const resetForm = () => {
    setPaymentMethod(
      PAYROLL_PAYMENT_METHOD_OPTIONS.some(
        (option) => option.value === initialPaymentMethod,
      )
        ? (initialPaymentMethod as PayrollPaymentMethod)
        : DEFAULT_PAYROLL_PAYMENT_METHOD,
    );
    setDeductions(
      mapDeductionFormState(initialDeductionRows, initialDeductionsTotal),
    );
    setBonusAmount(initialBonusAmount > 0 ? initialBonusAmount.toFixed(2) : "");
    setError("");
    setIsSaving(false);
  };

  const basePayBeforeBonus = useMemo(
    () => Math.max(initialGrossPay - initialBonusAmount, 0),
    [initialBonusAmount, initialGrossPay],
  );

  const nextBonusAmount = useMemo(() => toNumber(bonusAmount), [bonusAmount]);

  const totalDeductions = useMemo(
    () =>
      toNumber(deductions.incomeTax) +
      toNumber(deductions.socialSecurity) +
      toNumber(deductions.healthInsurance) +
      toNumber(deductions.employeeAdvance) +
      toNumber(deductions.other),
    [deductions],
  );

  const projectedGrossPay = useMemo(
    () =>
      allowAdjustments ? basePayBeforeBonus + nextBonusAmount : initialGrossPay,
    [allowAdjustments, basePayBeforeBonus, initialGrossPay, nextBonusAmount],
  );

  const projectedNetPay = useMemo(
    () =>
      allowAdjustments
        ? Math.max(projectedGrossPay - totalDeductions, 0)
        : Math.max(initialGrossPay - initialDeductionsTotal, 0),
    [
      allowAdjustments,
      initialDeductionsTotal,
      initialGrossPay,
      projectedGrossPay,
      totalDeductions,
    ],
  );

  const handleOpen = () => {
    if (disabled) {
      return;
    }

    resetForm();
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    resetForm();
  };

  const handleSave = () => {
    setError("");
    setIsSaving(true);

    void (async () => {
      try {
        const payloadData: Record<string, unknown> = {
          paymentMethod,
        };

        if (allowAdjustments) {
          const nextDeductions: PayrollDeductions = {
            incomeTax: toNumber(deductions.incomeTax),
            socialSecurity: toNumber(deductions.socialSecurity),
            healthInsurance: toNumber(deductions.healthInsurance),
            employeeAdvance: toNumber(deductions.employeeAdvance),
            other: toNumber(deductions.other),
            total: totalDeductions,
          };

          payloadData.bonusAmount = nextBonusAmount;
          payloadData.grossPay = {
            bonuses: nextBonusAmount,
            total: projectedGrossPay,
          };
          payloadData.deductions = nextDeductions;
        }

        const response = await fetch("/api/payroll", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "paystub",
            id: statementId,
            data: payloadData,
          }),
        });
        const body = (await response.json()) as { message?: string };

        if (!response.ok) {
          throw new Error(body.message ?? "Failed to update payroll record");
        }

        handleClose();
        router.refresh();
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Failed to update payroll record",
        );
        setIsSaving(false);
      }
    })();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className="app-icon-button app-icon-button-accent disabled:cursor-not-allowed disabled:opacity-50"
        title={
          disabled
            ? "Archived payroll statements are read-only"
            : allowAdjustments
              ? "Manage payroll payment method, bonus, and deductions"
              : "Manage payroll payment method"
        }
        aria-label={
          allowAdjustments
            ? "Manage payroll payment method, bonus, and deductions"
            : "Manage payroll payment method"
        }
      >
        <Settings2 className="h-4 w-4" />
      </button>

      {isOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-2xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    Payroll statement controls
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    {employeeName} · {periodLabel}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="app-icon-button"
                  aria-label="Close payroll statement controls"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="custom-scrollbar max-h-[calc(100vh-12rem)] overflow-y-auto px-6 py-6">
                {error ? (
                  <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
                  <div className="space-y-5">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Payment method
                      </label>
                      <select
                        value={paymentMethod}
                        onChange={(event) =>
                          setPaymentMethod(
                            event.target.value as PayrollPaymentMethod,
                          )
                        }
                        className="app-input"
                      >
                        {PAYROLL_PAYMENT_METHOD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {allowAdjustments ? (
                      <>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                            Bonus
                          </label>
                          <CurrencyInput
                            value={bonusAmount}
                            onValueChange={(decimalValue) =>
                              setBonusAmount(decimalValue)
                            }
                            className="app-input"
                          />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          {[
                            { key: "incomeTax", label: "Income Tax" },
                            { key: "socialSecurity", label: "Social Security" },
                            {
                              key: "healthInsurance",
                              label: "Health Insurance",
                            },
                            {
                              key: "employeeAdvance",
                              label: "Employee Advance",
                            },
                            { key: "other", label: "Other" },
                          ].map((field) => (
                            <label key={field.key} className="block">
                              <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                                {field.label}
                              </span>
                              <CurrencyInput
                                value={
                                  deductions[
                                    field.key as keyof DeductionFormState
                                  ]
                                }
                                onValueChange={(decimalValue) =>
                                  setDeductions((current) => ({
                                    ...current,
                                    [field.key]: decimalValue,
                                  }))
                                }
                                className="app-input"
                              />
                            </label>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="rounded-2xl border border-stroke bg-slate-50 px-4 py-3 text-sm text-dark-5 dark:border-dark-3 dark:bg-dark-3 dark:text-dark-6">
                        Bonus and deduction controls require payroll adjustment
                        access.
                      </div>
                    )}
                  </div>

                  <div className="app-muted-panel rounded-[24px] p-5">
                    <div className="space-y-4">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                          Gross Pay
                        </div>
                        <div className="mt-2 text-xl font-semibold text-slate-950">
                          {toCurrency(initialGrossPay)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                          Bonus
                        </div>
                        <div className="mt-2 text-xl font-semibold text-slate-950">
                          {toCurrency(
                            allowAdjustments
                              ? nextBonusAmount
                              : initialBonusAmount,
                          )}
                        </div>
                      </div>

                      {allowAdjustments ? (
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                            Gross Pay Preview
                          </div>
                          <div className="mt-2 text-xl font-semibold text-slate-950">
                            {toCurrency(projectedGrossPay)}
                          </div>
                        </div>
                      ) : null}

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                          Total Deductions
                        </div>
                        <div className="mt-2 text-xl font-semibold text-slate-950">
                          {toCurrency(
                            allowAdjustments
                              ? totalDeductions
                              : initialDeductionsTotal,
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                          {allowAdjustments ? "Net Pay Preview" : "Net Pay"}
                        </div>
                        <div className="mt-2 text-xl font-semibold text-slate-950">
                          {toCurrency(projectedNetPay)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="app-secondary-button"
                    disabled={isSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Save changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}
