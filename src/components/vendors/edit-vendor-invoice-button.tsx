"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { VendorFormMessage } from "@/components/vendors/vendor-form-message";
import { VendorModal } from "@/components/vendors/vendor-modal";
import type { VendorInvoiceSupplierOption } from "@/lib/vendors/invoice-processing";

type VendorInvoiceStatus = "pending" | "paid" | "overdue" | "cancelled";
type InvoiceStatus = "pending" | "cancelled";

export type EditableVendorInvoiceRecord = {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  total: number;
  currency: string;
  description: string;
  status: VendorInvoiceStatus;
  paidAmount: number;
  adjustmentAmount: number;
  netBalance: number;
  notes: string;
};

type InvoiceEditFormState = {
  supplierId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  total: string;
  currency: string;
  description: string;
  status: InvoiceStatus;
  notes: string;
};

type EditVendorInvoiceButtonProps = {
  invoice: EditableVendorInvoiceRecord;
  suppliers: VendorInvoiceSupplierOption[];
  disabled?: boolean;
  iconOnly?: boolean;
};

const INPUT_CLASSNAME = "app-input";

const TEXTAREA_CLASSNAME = `${INPUT_CLASSNAME} min-h-28 resize-y`;

function buildInitialFormState(
  invoice: EditableVendorInvoiceRecord,
): InvoiceEditFormState {
  return {
    supplierId: invoice.supplierId,
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    total: invoice.total.toFixed(2),
    currency: invoice.currency,
    description: invoice.description,
    status: invoice.status === "cancelled" ? "cancelled" : "pending",
    notes: invoice.notes,
  };
}

export function EditVendorInvoiceButton({
  invoice,
  suppliers,
  disabled = false,
  iconOnly = false,
}: EditVendorInvoiceButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [formState, setFormState] = useState<InvoiceEditFormState>(
    buildInitialFormState(invoice),
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openModal = () => {
    setFormState(buildInitialFormState(invoice));
    setError("");
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    setFormState(buildInitialFormState(invoice));
    setError("");
    setIsSubmitting(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
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
            supplierId: formState.supplierId,
            invoiceNumber: formState.invoiceNumber,
            issueDate: formState.issueDate,
            dueDate: formState.dueDate,
            total: formState.total,
            currency: formState.currency,
            description: formState.description,
            status: formState.status,
            notes: formState.notes,
          }),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to update vendor invoice");
        }

        closeModal();
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to update vendor invoice",
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
        className={
          iconOnly
            ? "app-icon-button app-icon-button-accent disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex items-center gap-2 rounded-full border border-stroke px-3 py-1.5 text-sm font-medium text-dark transition hover:bg-gray-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
        }
        title="Edit invoice"
        aria-label="Edit invoice"
      >
        <Pencil className="h-4 w-4" />
        {iconOnly ? null : "Edit"}
      </button>

      {isOpen ? (
        <VendorModal>
          <div className="modal-shell z-99999 bg-dark/50">
            <div className="modal-card-scroll max-w-3xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    Edit invoice
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Update the payable record. Uploaded line items and synced
                    products are not recalculated from this form.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="app-icon-button"
                  aria-label="Close edit invoice dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="custom-scrollbar overflow-y-auto px-6 py-6">
                <form onSubmit={handleSubmit}>
                  {error ? (
                    <VendorFormMessage
                      tone="error"
                      title="Unable to save invoice changes"
                      className="mb-4"
                    >
                      {error}
                    </VendorFormMessage>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Vendor
                      </label>
                      <select
                        required
                        value={formState.supplierId}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            supplierId: event.target.value,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      >
                        <option value="">Select a vendor</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Invoice number
                      </label>
                      <input
                        required
                        value={formState.invoiceNumber}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            invoiceNumber: event.target.value,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Issue date
                      </label>
                      <input
                        required
                        type="date"
                        value={formState.issueDate}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            issueDate: event.target.value,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Due date
                      </label>
                      <input
                        required
                        type="date"
                        value={formState.dueDate}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            dueDate: event.target.value,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Total amount
                      </label>
                      <CurrencyInput
                        required
                        value={formState.total}
                        currency={formState.currency || "USD"}
                        onValueChange={(decimalValue) =>
                          setFormState((current) => ({
                            ...current,
                            total: decimalValue,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Currency
                      </label>
                      <input
                        required
                        maxLength={8}
                        value={formState.currency}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            currency: event.target.value.toUpperCase(),
                          }))
                        }
                        className={INPUT_CLASSNAME}
                        placeholder="USD"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Status
                      </label>
                      <select
                        value={formState.status}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            status: event.target.value as InvoiceStatus,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      >
                        <option value="pending">Pending / Auto</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                      <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                        Paid and overdue are calculated automatically from
                        posted payments, supplier adjustments, and the due date.
                      </p>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Settlement summary
                      </label>
                      <div className="rounded-lg border border-stroke bg-gray-1 px-4 py-3 text-sm text-dark dark:border-dark-3 dark:bg-dark-2 dark:text-white">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-dark-5 dark:text-dark-6">
                            Recorded payments
                          </span>
                          <span className="font-medium">
                            {invoice.currency} {invoice.paidAmount.toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-dark-5 dark:text-dark-6">
                            Supplier adjustments
                          </span>
                          <span className="font-medium">
                            {invoice.currency}{" "}
                            {invoice.adjustmentAmount.toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 border-t border-stroke pt-2 dark:border-dark-3">
                          <span className="text-dark-5 dark:text-dark-6">
                            Current balance
                          </span>
                          <span
                            className={
                              invoice.netBalance < 0
                                ? "font-semibold text-green"
                                : "font-semibold"
                            }
                          >
                            {invoice.currency}{" "}
                            {Math.abs(invoice.netBalance).toFixed(2)}{" "}
                            {invoice.netBalance < 0 ? "credit" : "due"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Description
                      </label>
                      <input
                        value={formState.description}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                        placeholder="Office supplies invoice"
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
                        placeholder="Internal notes"
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
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40"
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {isSubmitting ? "Saving..." : "Save changes"}
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
