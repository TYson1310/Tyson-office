"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import { useAppNotifications } from "@/contexts/NotificationContext";
import { VendorModal } from "@/components/vendors/vendor-modal";
import {
  VENDOR_PAYMENT_METHOD_LABELS,
  VENDOR_PAYMENT_METHODS,
  normalizeVendorPaymentMethod,
  type VendorPaymentMethod,
} from "@/lib/vendors/payments";

type EditVendorPaymentButtonProps = {
  disabled?: boolean;
  paymentId: string;
  paymentMethod: string;
  referenceNumber: string;
};

export function EditVendorPaymentButton({
  disabled = false,
  paymentId,
  paymentMethod,
  referenceNumber,
}: EditVendorPaymentButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<VendorPaymentMethod>(() =>
      normalizeVendorPaymentMethod(paymentMethod),
    );

  const closeModal = () => {
    setIsOpen(false);
    setIsSubmitting(false);
    setSelectedPaymentMethod(normalizeVendorPaymentMethod(paymentMethod));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
            paymentMethod: selectedPaymentMethod,
          }),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to update vendor payment type");
        }

        closeModal();
        router.refresh();
      } catch (error) {
        notifyError(
          error instanceof Error
            ? error.message
            : "Failed to update vendor payment type",
        );
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={disabled || isSubmitting}
        className="app-icon-button disabled:cursor-not-allowed disabled:opacity-60"
        title="Edit payment type"
        aria-label="Edit payment type"
      >
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Pencil className="h-4 w-4" />
        )}
      </button>

      {isOpen ? (
        <VendorModal>
          <div className="modal-shell z-99999 bg-dark/50">
            <div className="modal-card max-w-md rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    Edit payment type
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Payment {referenceNumber}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="app-icon-button"
                  aria-label="Close payment type dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-6">
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                  Payment type
                </label>
                <select
                  value={selectedPaymentMethod}
                  onChange={(event) =>
                    setSelectedPaymentMethod(
                      event.target.value as VendorPaymentMethod,
                    )
                  }
                  className="app-input"
                >
                  {VENDOR_PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {VENDOR_PAYMENT_METHOD_LABELS[method]}
                    </option>
                  ))}
                </select>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-full border border-stroke px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Save type
                  </button>
                </div>
              </form>
            </div>
          </div>
        </VendorModal>
      ) : null}
    </>
  );
}
