"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useAppNotifications } from "@/contexts/NotificationContext";

type DeleteVendorAdjustmentButtonProps = {
  adjustmentId: string;
  adjustmentNumber: string;
  inventoryImpact: boolean;
  disabled?: boolean;
};

export function DeleteVendorAdjustmentButton({
  adjustmentId,
  adjustmentNumber,
  inventoryImpact,
  disabled = false,
}: DeleteVendorAdjustmentButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    if (
      !window.confirm(
        inventoryImpact
          ? `Delete draft adjustment ${adjustmentNumber}? No inventory has been posted yet, but the draft record and attachment will be removed.`
          : `Delete draft adjustment ${adjustmentNumber}?`,
      )
    ) {
      return;
    }

    setIsDeleting(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/vendor-adjustments?id=${encodeURIComponent(adjustmentId)}`,
          {
            method: "DELETE",
          },
        );
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to delete adjustment");
        }

        router.refresh();
      } catch (error) {
        notifyError(
          error instanceof Error ? error.message : "Failed to delete adjustment",
        );
      } finally {
        setIsDeleting(false);
      }
    })();
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={disabled || isDeleting}
      className="app-icon-button app-danger-icon-button disabled:cursor-not-allowed disabled:opacity-60"
      title="Delete adjustment"
      aria-label="Delete adjustment"
    >
      {isDeleting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  );
}
