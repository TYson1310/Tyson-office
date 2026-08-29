"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlusCircle, X } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";

type AdjustmentType = "opening_balance" | "manual_adjustment";

const INPUT_CLASSNAME = "app-input";

export function CashVaultAdjustmentButton({
  disabled = false,
  timeZone,
}: {
  disabled?: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [adjustmentType, setAdjustmentType] =
    useState<AdjustmentType>("manual_adjustment");
  const [adjustmentDate, setAdjustmentDate] = useState(() =>
    getTodayIsoDateInTimeZone(timeZone),
  );
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");

  function resetForm() {
    setAdjustmentType("manual_adjustment");
    setAdjustmentDate(getTodayIsoDateInTimeZone(timeZone));
    setAmount("");
    setReason("");
    setReferenceNumber("");
    setError("");
  }

  useEffect(() => {
    if (isOpen) {
      setAdjustmentDate(getTodayIsoDateInTimeZone(timeZone));
    }
  }, [isOpen, timeZone]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const parsedAmount = Number(amount);

      if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
        throw new Error("Enter a non-zero adjustment amount.");
      }

      if (!reason.trim()) {
        throw new Error("Enter a reason for the adjustment.");
      }

      const response = await fetch("/api/cash-vault-adjustments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          adjustmentDate,
          adjustmentType,
          amount: Math.round(parsedAmount * 100) / 100,
          reason: reason.trim(),
          referenceNumber: referenceNumber.trim(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to record cash adjustment.");
      }

      setIsOpen(false);
      resetForm();
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to record cash adjustment.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetForm();
          setIsOpen(true);
        }}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:hover:bg-dark-3"
      >
        <PlusCircle className="h-4 w-4" />
        Adjust Cash
      </button>

      {isOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-xl rounded-[24px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">
                    Cash vault adjustment
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Record an opening balance or documented correction.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !isSubmitting && setIsOpen(false)}
                  className="app-icon-button"
                  aria-label="Close cash adjustment dialog"
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
                {error ? (
                  <div className="rounded-lg bg-red/10 p-3 text-sm text-red">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Type
                    </label>
                    <select
                      value={adjustmentType}
                      onChange={(event) =>
                        setAdjustmentType(event.target.value as AdjustmentType)
                      }
                      className={INPUT_CLASSNAME}
                      disabled={isSubmitting}
                    >
                      <option value="manual_adjustment">Adjustment</option>
                      <option value="opening_balance">Opening balance</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Date
                    </label>
                    <input
                      type="date"
                      required
                      value={adjustmentDate}
                      onChange={(event) =>
                        setAdjustmentDate(event.target.value)
                      }
                      className={INPUT_CLASSNAME}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                    Amount
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className={INPUT_CLASSNAME}
                    placeholder="Use negative for cash removed"
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                    Reference
                  </label>
                  <input
                    value={referenceNumber}
                    onChange={(event) => setReferenceNumber(event.target.value)}
                    className={INPUT_CLASSNAME}
                    placeholder="Count sheet, receipt, or approval reference"
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                    Reason
                  </label>
                  <textarea
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className={`${INPUT_CLASSNAME} min-h-24 resize-y`}
                    placeholder="Why this cash adjustment is needed"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    disabled={isSubmitting}
                    className="app-secondary-button-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving
                      </>
                    ) : (
                      "Save adjustment"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}
