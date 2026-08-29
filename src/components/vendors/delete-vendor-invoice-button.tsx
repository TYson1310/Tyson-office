"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useAppNotifications } from "@/contexts/NotificationContext";

type DeleteVendorInvoiceButtonProps = {
  invoiceId: string;
  invoiceNumber: string;
  disabled?: boolean;
};

export function DeleteVendorInvoiceButton({
  invoiceId,
  invoiceNumber,
  disabled = false,
}: DeleteVendorInvoiceButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    if (
      !window.confirm(
        `Cancel invoice ${invoiceNumber}? The payable record and source PDF will stay on file, but the invoice will be marked cancelled.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/vendor-invoices?id=${encodeURIComponent(invoiceId)}`,
          {
            method: "DELETE",
          },
        );
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to cancel vendor invoice");
        }

        router.refresh();
      } catch (error) {
        notifyError(
          error instanceof Error ? error.message : "Failed to cancel vendor invoice",
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
      title="Cancel invoice"
      aria-label="Cancel invoice"
    >
      {isDeleting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  );
}
