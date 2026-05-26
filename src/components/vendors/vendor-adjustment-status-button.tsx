"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, Loader2 } from "lucide-react";
import { useAppNotifications } from "@/contexts/NotificationContext";

type VendorAdjustmentStatusButtonProps = {
  adjustmentId: string;
  adjustmentNumber: string;
  action: "approved" | "void";
  inventoryImpact: boolean;
  disabled?: boolean;
};

export function VendorAdjustmentStatusButton({
  adjustmentId,
  adjustmentNumber,
  action,
  inventoryImpact,
  disabled = false,
}: VendorAdjustmentStatusButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const confirmationMessage =
    action === "approved"
      ? inventoryImpact
        ? `Approve adjustment ${adjustmentNumber}? This will reduce on-hand stock and post the supplier credit.`
        : `Approve adjustment ${adjustmentNumber}? This will post the supplier credit to payables.`
      : inventoryImpact
        ? `Void adjustment ${adjustmentNumber}? This will restore the inventory and remove the posted supplier credit.`
        : `Void adjustment ${adjustmentNumber}? This will remove the posted supplier credit from payables.`;

  const handleClick = () => {
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    setIsSubmitting(true);

    void (async () => {
      try {
        const response = await fetch("/api/vendor-adjustments", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: adjustmentId,
            status: action,
          }),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to update adjustment");
        }

        router.refresh();
      } catch (error) {
        notifyError(
          error instanceof Error ? error.message : "Failed to update adjustment",
        );
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isSubmitting}
      className={
        action === "approved"
          ? "app-icon-button app-success-icon-button disabled:cursor-not-allowed disabled:opacity-60"
          : "app-icon-button text-amber-700 hover:border-amber-200 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
      }
      title={action === "approved" ? "Approve adjustment" : "Void adjustment"}
      aria-label={
        action === "approved" ? "Approve adjustment" : "Void adjustment"
      }
    >
      {isSubmitting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : action === "approved" ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <Ban className="h-4 w-4" />
      )}
    </button>
  );
}
