"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, RotateCcw, X } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useAppNotifications } from "@/contexts/NotificationContext";
import type { LotteryEftPaymentStatus } from "@/lib/lottery/eft";

type EftPaidStatusControlProps = {
  canManage: boolean;
  expectedAmount: number;
  paidAmount: number | null;
  paidNotes: string | null;
  paidReference: string | null;
  status: LotteryEftPaymentStatus;
  sweepDate: string;
};

export function EftPaidStatusControl({
  canManage,
  expectedAmount,
  paidAmount,
  paidNotes,
  paidReference,
  status,
  sweepDate,
}: EftPaidStatusControlProps) {
  const router = useRouter();
  const { error: notifyError, success } = useAppNotifications();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const isPaid = status === "paid";
  const [amount, setAmount] = useState(() =>
    String(paidAmount ?? Math.max(expectedAmount, 0)),
  );
  const [reference, setReference] = useState(paidReference ?? "");
  const [notes, setNotes] = useState(paidNotes ?? "");

  useEffect(() => {
    setAmount(String(paidAmount ?? Math.max(expectedAmount, 0)));
    setReference(paidReference ?? "");
    setNotes(paidNotes ?? "");
  }, [expectedAmount, paidAmount, paidNotes, paidReference, sweepDate]);

  async function updateStatus(nextStatus: LotteryEftPaymentStatus) {
    if (!canManage || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const paidAmountValue = Number(amount);

      if (
        nextStatus === "paid" &&
        (!Number.isFinite(paidAmountValue) || paidAmountValue < 0)
      ) {
        throw new Error("Enter a valid paid amount.");
      }

      if (
        nextStatus === "paid" &&
        reference.trim().length === 0 &&
        notes.trim().length === 0
      ) {
        throw new Error("Enter a bank reference or note.");
      }

      const response = await fetch("/api/lottery/eft-weekly-status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paidAmount:
            nextStatus === "paid"
              ? Math.round(paidAmountValue * 100) / 100
              : null,
          paidNotes: nextStatus === "paid" ? notes.trim() : null,
          paidReference: nextStatus === "paid" ? reference.trim() : null,
          status: nextStatus,
          sweepDate,
        }),
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Failed to update EFT status");
      }

      success(
        nextStatus === "paid"
          ? "EFT week marked paid."
          : "EFT week marked unpaid.",
      );
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : "Failed to update EFT status",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePaidSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void updateStatus("paid");
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {!isPaid ? (
        <>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            disabled={!canManage || isSubmitting}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
            title={
              canManage
                ? "Mark EFT week paid"
                : "Only admins can change EFT paid status"
            }
          >
            <CheckCircle2 className="h-4 w-4" />
            <span className="sr-only">Mark EFT week paid</span>
          </button>

          {isOpen ? (
            <ModalPortal>
              <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
                <div className="modal-card max-w-lg rounded-[24px] bg-white shadow-1 dark:bg-gray-dark">
                  <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                    <div>
                      <h2 className="text-lg font-semibold text-dark dark:text-white">
                        Mark EFT paid
                      </h2>
                      <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                        Record the actual bank withdrawal and reference.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => !isSubmitting && setIsOpen(false)}
                      className="app-icon-button"
                      aria-label="Close EFT paid dialog"
                      disabled={isSubmitting}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <form
                    onSubmit={handlePaidSubmit}
                    className="space-y-4 px-6 py-6"
                  >
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Paid amount
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                          $
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={amount}
                          onChange={(event) => setAmount(event.target.value)}
                          disabled={isSubmitting}
                          className="app-input pl-7"
                          aria-label="EFT paid amount"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Bank reference
                      </label>
                      <input
                        value={reference}
                        onChange={(event) => setReference(event.target.value)}
                        disabled={isSubmitting}
                        className="app-input"
                        placeholder="ACH trace, memo, or bank ref"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Notes
                      </label>
                      <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        disabled={isSubmitting}
                        className="app-input min-h-24 resize-y"
                        placeholder="Reason for any rounded or different amount"
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
                        className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        {isSubmitting ? (
                          <>
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                            Saving
                          </>
                        ) : (
                          "Save paid"
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </ModalPortal>
          ) : null}
        </>
      ) : null}

      {isPaid ? (
        <button
          type="button"
          onClick={() => void updateStatus("unpaid")}
          disabled={!canManage || isSubmitting}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55 dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:hover:bg-dark-3"
          title={
            canManage
              ? "Mark EFT week unpaid"
              : "Only admins can change EFT paid status"
          }
        >
          <RotateCcw className="h-4 w-4" />
          <span className="sr-only">Mark EFT week unpaid</span>
        </button>
      ) : null}
    </div>
  );
}
