"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RotateCcw, X } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useAppNotifications } from "@/contexts/NotificationContext";

type EftPackReversalButtonProps = {
  canManage: boolean;
  disabledReason?: string;
  includedDate: string | null;
  inventoryId: string;
  packLabel: string;
  packValue: number | null;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

function formatCurrency(value: number | null) {
  return value === null ? "unknown value" : currencyFormatter.format(value);
}

export function EftPackReversalButton({
  canManage,
  disabledReason,
  includedDate,
  inventoryId,
  packLabel,
  packValue,
}: EftPackReversalButtonProps) {
  const router = useRouter();
  const { error: notifyError, success } = useAppNotifications();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const normalizedReason = reason.trim();
  const isDisabled = !canManage || Boolean(disabledReason) || isSubmitting;
  const canSubmit = normalizedReason.length >= 6 && !isSubmitting;

  async function reversePackSettlement() {
    if (isDisabled || !canSubmit) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/lottery/eft-pack-inclusions", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inventoryId,
          reason: normalizedReason,
        }),
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Failed to reverse EFT settlement");
      }

      success("Sold-out pack EFT settlement reversed.");
      setIsOpen(false);
      setReason("");
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error.message
          : "Failed to reverse EFT settlement",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={isDisabled}
        title={
          disabledReason ??
          (canManage
            ? "Reverse this pack settlement so it can be settled again"
            : "Only admins, managers, and accountants can reverse pack settlements")
        }
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {isSubmitting ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcw className="h-3.5 w-3.5" />
        )}
        Reverse
      </button>

      {isOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-md rounded-[24px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">
                    Reverse EFT settlement
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    This removes the pack value from EFT and puts the pack back
                    in the sold-out ledger.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !isSubmitting && setIsOpen(false)}
                  className="app-icon-button"
                  aria-label="Close reverse pack dialog"
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-6 py-6">
                <dl className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-amber-700">Pack</dt>
                    <dd className="font-semibold text-slate-950">
                      {packLabel}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-amber-700">Pack value</dt>
                    <dd className="font-semibold text-slate-950">
                      {formatCurrency(packValue)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-amber-700">Settlement date</dt>
                    <dd className="font-semibold text-slate-950">
                      {includedDate ?? "-"}
                    </dd>
                  </div>
                </dl>

                <div>
                  <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                    Reversal reason
                  </label>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={isSubmitting}
                    className="app-input min-h-24 resize-y"
                    placeholder="Example: settled to the wrong EFT week"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Required for the audit log.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    disabled={isSubmitting}
                    className="app-secondary-button-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void reversePackSettlement()}
                    disabled={!canSubmit}
                    className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isSubmitting ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Reversing
                      </>
                    ) : (
                      "Confirm reverse"
                    )}
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
