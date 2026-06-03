"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useAppNotifications } from "@/contexts/NotificationContext";

type EftPackInclusionButtonProps = {
  canManage: boolean;
  disabledReason?: string;
  inventoryId: string;
  packLabel: string;
  packValue: number | null;
  sweepDate: string;
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
  const isDisabled = !canManage || Boolean(disabledReason) || isSubmitting;

  async function settlePack() {
    if (isDisabled) {
      return;
    }

    const confirmed = window.confirm(
      `Settle ${packLabel} (${formatCurrency(
        packValue,
      )}) to EFT sweep ${sweepDate}?`,
    );

    if (!confirmed) {
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
        throw new Error(body.error ?? "Failed to settle sold-out pack to EFT");
      }

      success("Sold-out pack settled to EFT.");
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error.message
          : "Failed to settle sold-out pack to EFT",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void settlePack()}
      disabled={isDisabled}
      title={
        disabledReason ??
        (canManage
          ? "Settle this sold-out pack value to the selected EFT"
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
  );
}
