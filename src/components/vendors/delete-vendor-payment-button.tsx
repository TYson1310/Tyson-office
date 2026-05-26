"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useAppNotifications } from "@/contexts/NotificationContext";

type DeleteVendorPaymentButtonProps = {
  paymentId: string;
  referenceNumber: string;
  disabled?: boolean;
};

export function DeleteVendorPaymentButton({
  paymentId,
  referenceNumber,
  disabled = false,
}: DeleteVendorPaymentButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    if (
      !window.confirm(
        `Delete payment ${referenceNumber}? This will also recalculate the linked invoice balance.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/vendor-payments?id=${encodeURIComponent(paymentId)}`,
          {
            method: "DELETE",
          },
        );
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to delete vendor payment");
        }

        router.refresh();
      } catch (error) {
        notifyError(
          error instanceof Error ? error.message : "Failed to delete vendor payment",
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
      title="Delete payment"
      aria-label="Delete payment"
    >
      {isDeleting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  );
}
