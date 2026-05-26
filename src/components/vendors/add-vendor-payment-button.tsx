"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Loader2, X } from "lucide-react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { VendorFormMessage } from "@/components/vendors/vendor-form-message";
import { VendorModal } from "@/components/vendors/vendor-modal";
import { useStore } from "@/contexts/StoreContext";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import type { VendorInvoiceSupplierOption } from "@/lib/vendors/invoice-processing";
import {
  VENDOR_PAYMENT_METHOD_LABELS,
  VENDOR_PAYMENT_METHODS,
  normalizeVendorPaymentAmount,
  type VendorPaymentInvoiceOption,
} from "@/lib/vendors/payments";

type VendorPaymentFormState = {
  supplierId: string;
  invoiceId: string;
  amountPaid: string;
  paymentDate: string;
  paymentMethod: (typeof VENDOR_PAYMENT_METHODS)[number];
  referenceNumber: string;
  notes: string;
};

type AddVendorPaymentButtonProps = {
  suppliers: VendorInvoiceSupplierOption[];
  invoices: VendorPaymentInvoiceOption[];
  defaultSupplierId?: string;
  defaultInvoiceId?: string;
  defaultAmount?: number;
  defaultPaymentDate?: string;
  disabled?: boolean;
  disabledReason?: string;
  iconOnly?: boolean;
};

const INPUT_CLASSNAME = "app-input";

const TEXTAREA_CLASSNAME = `${INPUT_CLASSNAME} min-h-28 resize-y`;

function todayKey(timeZone = "UTC") {
  return getTodayIsoDateInTimeZone(timeZone);
}

function buildInitialFormState(
  invoices: VendorPaymentInvoiceOption[],
  defaultSupplierId?: string,
  defaultInvoiceId?: string,
  defaultAmount?: number,
  defaultPaymentDate?: string,
): VendorPaymentFormState {
  const selectedInvoice = invoices.find(
    (invoice) => invoice.id === defaultInvoiceId,
  );
  const suggestedAmount =
    typeof defaultAmount === "number"
      ? defaultAmount
      : Math.max(selectedInvoice?.netBalance ?? 0, 0);

  return {
    supplierId: selectedInvoice?.supplierId ?? defaultSupplierId ?? "",
    invoiceId: selectedInvoice?.id ?? "",
    amountPaid: suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "",
    paymentDate: defaultPaymentDate ?? todayKey(),
    paymentMethod: "bank_transfer",
    referenceNumber: "",
    notes: "",
  };
}

export function AddVendorPaymentButton({
  suppliers,
  invoices,
  defaultSupplierId,
  defaultInvoiceId,
  defaultAmount,
  defaultPaymentDate,
  disabled = false,
  disabledReason,
  iconOnly = false,
}: AddVendorPaymentButtonProps) {
  const router = useRouter();
  const { activeStore } = useStore();
  const resolvedDefaultPaymentDate =
    defaultPaymentDate ?? todayKey(activeStore?.timeZone);
  const [isOpen, setIsOpen] = useState(false);
  const [formState, setFormState] = useState<VendorPaymentFormState>(
    buildInitialFormState(
      invoices,
      defaultSupplierId,
      defaultInvoiceId,
      defaultAmount,
      resolvedDefaultPaymentDate,
    ),
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openModal = () => {
    setFormState(
      buildInitialFormState(
        invoices,
        defaultSupplierId,
        defaultInvoiceId,
        defaultAmount,
        resolvedDefaultPaymentDate,
      ),
    );
    setError("");
    setIsSubmitting(false);
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    setFormState(
      buildInitialFormState(
        invoices,
        defaultSupplierId,
        defaultInvoiceId,
        defaultAmount,
        resolvedDefaultPaymentDate,
      ),
    );
    setError("");
    setIsSubmitting(false);
  };

  const filteredInvoices = formState.supplierId
    ? invoices.filter((invoice) => invoice.supplierId === formState.supplierId)
    : invoices;
  const selectedInvoice =
    invoices.find((invoice) => invoice.id === formState.invoiceId) ?? null;

  const handleSupplierChange = (supplierId: string) => {
    setFormState((current) => {
      const nextInvoice =
        current.invoiceId &&
        invoices.find(
          (invoice) =>
            invoice.id === current.invoiceId &&
            invoice.supplierId === supplierId,
        )
          ? current.invoiceId
          : "";

      const nextSelectedInvoice = invoices.find(
        (invoice) => invoice.id === nextInvoice,
      );

      return {
        ...current,
        supplierId,
        invoiceId: nextInvoice,
        amountPaid:
          nextSelectedInvoice && nextSelectedInvoice.netBalance > 0
            ? nextSelectedInvoice.netBalance.toFixed(2)
            : current.amountPaid,
      };
    });
  };

  const handleInvoiceChange = (invoiceId: string) => {
    const invoice = invoices.find((entry) => entry.id === invoiceId);

    setFormState((current) => ({
      ...current,
      invoiceId,
      supplierId: invoice?.supplierId ?? current.supplierId,
      amountPaid:
        invoice && invoice.netBalance > 0
          ? invoice.netBalance.toFixed(2)
          : current.amountPaid,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    void (async () => {
      try {
        const response = await fetch("/api/vendor-payments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            supplierId: formState.supplierId,
            invoiceId: formState.invoiceId || undefined,
            amountPaid: normalizeVendorPaymentAmount(formState.amountPaid),
            paymentDate: formState.paymentDate,
            paymentMethod: formState.paymentMethod,
            referenceNumber: formState.referenceNumber,
            notes: formState.notes,
          }),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to record vendor payment");
        }

        closeModal();
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to record vendor payment",
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
        onClick={openModal}
        disabled={disabled}
        title={disabledReason ?? "Record vendor payment"}
        aria-label="Record vendor payment"
        className={
          iconOnly
            ? "app-icon-button app-success-icon-button disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300"
        }
      >
        <DollarSign className="h-4 w-4" />
        {iconOnly ? null : "Record payment"}
      </button>

      {isOpen ? (
        <VendorModal>
          <div className="modal-shell z-99999 bg-dark/50">
            <div className="modal-card-scroll max-w-3xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    Record vendor payment
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Log full or partial supplier payments with payment method,
                    date, and reference details.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="app-icon-button"
                  aria-label="Close vendor payment dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="custom-scrollbar overflow-y-auto px-6 py-6">
                <form onSubmit={handleSubmit}>
                  {error ? (
                    <VendorFormMessage
                      tone="error"
                      title="Unable to record vendor payment"
                      className="mb-4"
                    >
                      {error}
                    </VendorFormMessage>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Supplier
                      </label>
                      <select
                        required
                        value={formState.supplierId}
                        onChange={(event) =>
                          handleSupplierChange(event.target.value)
                        }
                        className={INPUT_CLASSNAME}
                      >
                        <option value="">Select a supplier</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Linked invoice
                      </label>
                      <select
                        value={formState.invoiceId}
                        onChange={(event) =>
                          handleInvoiceChange(event.target.value)
                        }
                        className={INPUT_CLASSNAME}
                      >
                        <option value="">Supplier-level payment</option>
                        {filteredInvoices.map((invoice) => (
                          <option key={invoice.id} value={invoice.id}>
                            {invoice.invoiceNumber}
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                        {selectedInvoice
                          ? `Current balance: ${selectedInvoice.currency} ${Math.abs(
                              selectedInvoice.netBalance,
                            ).toFixed(
                              2,
                            )}${selectedInvoice.netBalance < 0 ? " credit" : " due"}`
                          : "If no invoice is selected, the payment is logged at the supplier level only."}
                      </p>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Amount paid
                      </label>
                      <CurrencyInput
                        required
                        value={formState.amountPaid}
                        currency={selectedInvoice?.currency ?? "USD"}
                        onValueChange={(decimalValue) =>
                          setFormState((current) => ({
                            ...current,
                            amountPaid: decimalValue,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Payment date
                      </label>
                      <input
                        required
                        type="date"
                        value={formState.paymentDate}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            paymentDate: event.target.value,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Payment method
                      </label>
                      <select
                        value={formState.paymentMethod}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            paymentMethod: event.target
                              .value as VendorPaymentFormState["paymentMethod"],
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      >
                        {VENDOR_PAYMENT_METHODS.map((method) => (
                          <option key={method} value={method}>
                            {VENDOR_PAYMENT_METHOD_LABELS[method]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Reference number
                      </label>
                      <input
                        value={formState.referenceNumber}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            referenceNumber: event.target.value,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                        placeholder="Optional. Auto-generated if blank."
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Notes
                      </label>
                      <textarea
                        value={formState.notes}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        className={TEXTAREA_CLASSNAME}
                        placeholder="Optional payment notes"
                      />
                    </div>
                  </div>

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
                      Save payment
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </VendorModal>
      ) : null}
    </>
  );
}
