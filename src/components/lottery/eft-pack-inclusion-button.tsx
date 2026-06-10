"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, X } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useAppNotifications } from "@/contexts/NotificationContext";

type EftPackInclusionButtonProps = {
  canManage: boolean;
  disabledReason?: string;
  inventoryId: string;
  packLabel: string;
  packValue: number | null;
  sweepDate: string;
};

type EftBulkPackInclusionButtonProps = {
  canManage: boolean;
  disabledReason?: string;
  inventoryIds: string[];
  packCount: number;
  sweepDate: string;
  totalValue: number;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

function formatCurrency(value: number | null) {
  return value === null ? "unknown value" : currencyFormatter.format(value);
}

export function EftPackInclusionButton({
  canManage,
  disabledReason,
  inventoryId,
  packLabel,
  packValue,
  sweepDate,
}: EftPackInclusionButtonProps) {
  const router = useRouter();
  const { error: notifyError, success } = useAppNotifications();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const isDisabled = !canManage || Boolean(disabledReason) || isSubmitting;

  async function settlePack() {
    if (isDisabled) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/lottery/eft-pack-inclusions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inventoryId,
          sweepDate,
        }),
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Failed to settle scratch pack to EFT");
      }

      success("Scratch pack settled to EFT.");
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error.message
          : "Failed to settle scratch pack to EFT",
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
            ? "Settle this scratch pack value to the selected EFT"
            : "Only admins, managers, and accountants can settle packs to EFT")
        }
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {isSubmitting ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        Settle
      </button>

      {isOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-md rounded-[24px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">
                    Settle pack to EFT
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    This adds the scratch pack value to the selected EFT week.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !isSubmitting && setIsOpen(false)}
                  className="app-icon-button"
                  aria-label="Close settle pack dialog"
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-6 py-6">
                <dl className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Pack</dt>
                    <dd className="font-semibold text-slate-950">
                      {packLabel}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Pack value</dt>
                    <dd className="font-semibold text-slate-950">
                      {formatCurrency(packValue)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-500">EFT sweep</dt>
                    <dd className="font-semibold text-slate-950">
                      {sweepDate}
                    </dd>
                  </div>
                </dl>

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
                    onClick={() => void settlePack()}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isSubmitting ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Settling
                      </>
                    ) : (
                      "Confirm settle"
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

export function EftBulkPackInclusionButton({
  canManage,
  disabledReason,
  inventoryIds,
  packCount,
  sweepDate,
  totalValue,
}: EftBulkPackInclusionButtonProps) {
  const router = useRouter();
  const { error: notifyError, success } = useAppNotifications();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const isDisabled =
    !canManage ||
    Boolean(disabledReason) ||
    isSubmitting ||
    inventoryIds.length === 0;

  async function settlePacks() {
    if (isDisabled) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/lottery/eft-pack-inclusions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inventoryIds,
          sweepDate,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        failed?: Array<{ error: string; inventoryId: string }>;
        settled?: unknown[];
      };

      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Failed to settle scratch packs to EFT");
      }

      const settledCount = body.settled?.length ?? 0;
      const failedCount = body.failed?.length ?? 0;

      if (failedCount > 0) {
        notifyError(
          `${settledCount} settled, ${failedCount} failed. Refresh and review remaining packs.`,
        );
      } else {
        success(`${settledCount} scratch pack settlement approved.`);
      }

      setIsOpen(false);
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error.message
          : "Failed to settle scratch packs to EFT",
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
            ? "Approve all due scratch packs for the selected EFT"
            : "Only admins, managers, and accountants can settle packs to EFT")
        }
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {isSubmitting ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        Settle all due
      </button>

      {isOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-md rounded-[24px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">
                    Settle due packs to EFT
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    This approves all currently due scratch pack values for the
                    selected EFT week.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !isSubmitting && setIsOpen(false)}
                  className="app-icon-button"
                  aria-label="Close bulk settle dialog"
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-6 py-6">
                <dl className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Packs</dt>
                    <dd className="font-semibold text-slate-950">
                      {packCount}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Total pack value</dt>
                    <dd className="font-semibold text-slate-950">
                      {formatCurrency(totalValue)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-500">EFT sweep</dt>
                    <dd className="font-semibold text-slate-950">
                      {sweepDate}
                    </dd>
                  </div>
                </dl>

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
                    onClick={() => void settlePacks()}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isSubmitting ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Settling
                      </>
                    ) : (
                      "Confirm settle all"
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
