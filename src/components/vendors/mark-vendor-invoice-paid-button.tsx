"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Loader2 } from "lucide-react";
import type { VendorInvoiceActionRecord } from "@/components/vendors/vendor-invoice-action-types";
import { useAppNotifications } from "@/contexts/NotificationContext";

type MarkVendorInvoicePaidButtonProps = {
  invoice: VendorInvoiceActionRecord;
  disabled?: boolean;
};

export function MarkVendorInvoicePaidButton({
  invoice,
  disabled = false,
}: MarkVendorInvoicePaidButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isAlreadyPaid = invoice.status === "paid";
  const settlementAmount = Math.max(
    invoice.total - invoice.adjustmentAmount,
    0,
  );

  const handleMarkPaid = () => {
    if (isAlreadyPaid || disabled) {
      return;
    }

    if (
      !window.confirm(
        `Mark invoice ${invoice.invoiceNumber} as paid for ${settlementAmount.toFixed(2)} ${invoice.currency}?`,
      )
    ) {
      return;
    }

    setIsSubmitting(true);

    void (async () => {
      try {
        const response = await fetch("/api/vendor-invoices", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: invoice.id,
            supplierId: invoice.supplierId,
            invoiceNumber: invoice.invoiceNumber,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            total: invoice.total,
            currency: invoice.currency,
            description: invoice.description,
            status: "paid",
            paidAmount: settlementAmount,
            notes: invoice.notes,
          }),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to mark invoice as paid");
        }

        router.refresh();
      } catch (error) {
        notifyError(
          error instanceof Error ? error.message : "Failed to mark invoice as paid",
        );
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <button
      type="button"
      onClick={handleMarkPaid}
      disabled={disabled || isSubmitting || isAlreadyPaid}
      className="app-icon-button app-success-icon-button disabled:cursor-not-allowed disabled:opacity-50"
      title={isAlreadyPaid ? "Invoice already paid" : "Mark invoice as paid"}
      aria-label={
        isAlreadyPaid ? "Invoice already paid" : "Mark invoice as paid"
      }
    >
      {isSubmitting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <DollarSign className="h-4 w-4" />
      )}
    </button>
  );
}
