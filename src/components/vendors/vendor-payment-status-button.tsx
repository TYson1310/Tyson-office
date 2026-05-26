"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { useAppNotifications } from "@/contexts/NotificationContext";

type VendorPaymentStatusButtonProps = {
  paymentId: string;
  referenceNumber: string;
  disabled?: boolean;
};

export function VendorPaymentStatusButton({
  paymentId,
  referenceNumber,
  disabled = false,
}: VendorPaymentStatusButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClick = () => {
    if (
      !window.confirm(
        `Void payment ${referenceNumber}? This will restore the linked invoice balance and keep the payment in the audit trail.`,
      )
    ) {
      return;
    }

    setIsSubmitting(true);

    void (async () => {
      try {
        const response = await fetch("/api/vendor-payments", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: paymentId,
            status: "void",
          }),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to void vendor payment");
        }

        router.refresh();
      } catch (error) {
        notifyError(
          error instanceof Error ? error.message : "Failed to void vendor payment",
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
      className="app-icon-button text-amber-700 hover:border-amber-200 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
      title="Void payment"
      aria-label="Void payment"
    >
      {isSubmitting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Ban className="h-4 w-4" />
      )}
    </button>
  );
}
