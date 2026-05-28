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

type VendorPaymentMode = "multiple" | "single";

type VendorPaymentInvoiceAllocation = {
  amountPaid: string;
  invoiceId: string;
};

type VendorPaymentFormState = {
  supplierId: string;
  invoiceId: string;
  invoicePayments: VendorPaymentInvoiceAllocation[];
  amountPaid: string;
  paymentMode: VendorPaymentMode;
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
  defaultPaymentMode?: VendorPaymentMode;
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

function getPayableInvoices(
  invoices: VendorPaymentInvoiceOption[],
  supplierId: string,
) {
  return invoices.filter(
    (invoice) =>
      invoice.supplierId === supplierId &&
      invoice.status !== "cancelled" &&
      invoice.netBalance > 0,
  );
}

function formatCurrencyAmount(currency: string, value: number) {
  return `${currency} ${Math.abs(value).toFixed(2)}`;
}

function buildInitialFormState(
  invoices: VendorPaymentInvoiceOption[],
  defaultSupplierId?: string,
  defaultInvoiceId?: string,
  defaultAmount?: number,
  defaultPaymentMode?: VendorPaymentMode,
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
    invoicePayments: [],
    amountPaid: suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "",
    paymentMode:
      defaultPaymentMode ?? (defaultInvoiceId ? "single" : "multiple"),
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
  defaultPaymentMode,
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
      defaultPaymentMode,
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
        defaultPaymentMode,
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
        defaultPaymentMode,
        resolvedDefaultPaymentDate,
      ),
    );
    setError("");
    setIsSubmitting(false);
  };

  const filteredInvoices = formState.supplierId
    ? invoices.filter((invoice) => invoice.supplierId === formState.supplierId)
    : invoices;
  const payableInvoices = formState.supplierId
    ? getPayableInvoices(invoices, formState.supplierId)
    : [];
  const selectedInvoice =
    invoices.find((invoice) => invoice.id === formState.invoiceId) ?? null;
  const selectedBatchPayments = formState.invoicePayments
    .map((payment) => {
      const invoice = invoices.find((entry) => entry.id === payment.invoiceId);
      const amountPaid = normalizeVendorPaymentAmount(payment.amountPaid);

      return invoice && amountPaid > 0
        ? {
            amountPaid,
            invoice,
          }
        : null;
    })
    .filter(
      (
        payment,
      ): payment is {
        amountPaid: number;
        invoice: VendorPaymentInvoiceOption;
      } => Boolean(payment),
    );
  const batchTotal = selectedBatchPayments.reduce(
    (total, payment) => total + payment.amountPaid,
    0,
  );

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
        invoicePayments: current.invoicePayments.filter((payment) =>
          invoices.some(
            (invoice) =>
              invoice.id === payment.invoiceId &&
              invoice.supplierId === supplierId,
          ),
        ),
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

  const handlePaymentModeChange = (paymentMode: VendorPaymentMode) => {
    setFormState((current) => ({
      ...current,
      paymentMode,
      invoiceId: paymentMode === "single" ? current.invoiceId : "",
      invoicePayments:
        paymentMode === "multiple" ? current.invoicePayments : [],
      amountPaid:
        paymentMode === "single" ? current.amountPaid : batchTotal.toFixed(2),
    }));
  };

  const toggleBatchInvoice = (invoice: VendorPaymentInvoiceOption) => {
    setFormState((current) => {
      const alreadySelected = current.invoicePayments.some(
        (payment) => payment.invoiceId === invoice.id,
      );

      return {
        ...current,
        invoicePayments: alreadySelected
          ? current.invoicePayments.filter(
              (payment) => payment.invoiceId !== invoice.id,
            )
          : [
              ...current.invoicePayments,
              {
                invoiceId: invoice.id,
                amountPaid: invoice.netBalance.toFixed(2),
              },
            ],
      };
    });
  };

  const updateBatchInvoiceAmount = (invoiceId: string, amountPaid: string) => {
    setFormState((current) => ({
      ...current,
      invoicePayments: current.invoicePayments.map((payment) =>
        payment.invoiceId === invoiceId
          ? {
              ...payment,
              amountPaid,
            }
          : payment,
      ),
    }));
  };

  const selectAllPayableInvoices = () => {
    setFormState((current) => ({
      ...current,
      invoicePayments: payableInvoices.map((invoice) => ({
        invoiceId: invoice.id,
        amountPaid: invoice.netBalance.toFixed(2),
      })),
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (
      formState.paymentMode === "multiple" &&
      selectedBatchPayments.length === 0
    ) {
      setError("Select at least one invoice to pay.");
      return;
    }

    if (
      formState.paymentMode === "multiple" &&
      formState.invoicePayments.some(
        (payment) => normalizeVendorPaymentAmount(payment.amountPaid) <= 0,
      )
    ) {
      setError("Every selected invoice needs a payment amount.");
      return;
    }

    const overpaidBatchInvoice = selectedBatchPayments.find(
      (payment) => payment.amountPaid > payment.invoice.netBalance + 0.005,
    );

    if (formState.paymentMode === "multiple" && overpaidBatchInvoice) {
      setError(
        `Payment for invoice ${overpaidBatchInvoice.invoice.invoiceNumber} cannot exceed its balance.`,
      );
      return;
    }

    setIsSubmitting(true);

    void (async () => {
      try {
        const paymentPayload =
          formState.paymentMode === "multiple"
            ? {
                supplierId: formState.supplierId,
                invoicePayments: selectedBatchPayments.map((payment) => ({
                  invoiceId: payment.invoice.id,
                  amountPaid: payment.amountPaid,
                })),
                amountPaid: batchTotal,
                paymentDate: formState.paymentDate,
                paymentMethod: formState.paymentMethod,
                referenceNumber: formState.referenceNumber,
                notes: formState.notes,
              }
            : {
                supplierId: formState.supplierId,
                invoiceId: formState.invoiceId || undefined,
                amountPaid: normalizeVendorPaymentAmount(formState.amountPaid),
                paymentDate: formState.paymentDate,
                paymentMethod: formState.paymentMethod,
                referenceNumber: formState.referenceNumber,
                notes: formState.notes,
              };
        const response = await fetch("/api/vendor-payments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(paymentPayload),
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
            <div className="modal-card-scroll max-w-4xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
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
                        Payment type
                      </label>
                      <select
                        value={formState.paymentMode}
                        onChange={(event) =>
                          handlePaymentModeChange(
                            event.target.value as VendorPaymentMode,
                          )
                        }
                        className={INPUT_CLASSNAME}
                      >
                        <option value="multiple">Pay multiple invoices</option>
                        <option value="single">
                          Single invoice or supplier-level
                        </option>
                      </select>
                    </div>

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

                    {formState.paymentMode === "single" ? (
                      <>
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
                              ? `Current balance: ${formatCurrencyAmount(
                                  selectedInvoice.currency,
                                  selectedInvoice.netBalance,
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
                      </>
                    ) : (
                      <div className="md:col-span-2">
                        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <label className="block text-sm font-medium text-dark dark:text-white">
                            Invoices to pay
                          </label>
                          <button
                            type="button"
                            onClick={selectAllPayableInvoices}
                            disabled={
                              !formState.supplierId ||
                              payableInvoices.length === 0
                            }
                            className="text-left text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:text-dark-5"
                          >
                            Select all open invoices
                          </button>
                        </div>
                        <div className="rounded-2xl border border-stroke dark:border-dark-3">
                          {!formState.supplierId ? (
                            <div className="px-4 py-6 text-sm text-dark-5 dark:text-dark-6">
                              Select a supplier to choose invoices.
                            </div>
                          ) : payableInvoices.length === 0 ? (
                            <div className="px-4 py-6 text-sm text-dark-5 dark:text-dark-6">
                              This supplier has no open invoice balances.
                            </div>
                          ) : (
                            <div className="divide-y divide-stroke dark:divide-dark-3">
                              {payableInvoices.map((invoice) => {
                                const selectedPayment =
                                  formState.invoicePayments.find(
                                    (payment) =>
                                      payment.invoiceId === invoice.id,
                                  );

                                return (
                                  <div
                                    key={invoice.id}
                                    className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_11rem]"
                                  >
                                    <label className="flex min-w-0 items-start gap-3">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(selectedPayment)}
                                        onChange={() =>
                                          toggleBatchInvoice(invoice)
                                        }
                                        className="mt-1 h-4 w-4 rounded border-stroke text-primary focus:ring-primary"
                                      />
                                      <span className="min-w-0">
                                        <span className="block truncate text-sm font-semibold text-dark dark:text-white">
                                          {invoice.invoiceNumber}
                                        </span>
                                        <span className="mt-1 block text-xs text-dark-5 dark:text-dark-6">
                                          Balance{" "}
                                          {formatCurrencyAmount(
                                            invoice.currency,
                                            invoice.netBalance,
                                          )}
                                        </span>
                                      </span>
                                    </label>
                                    <CurrencyInput
                                      value={selectedPayment?.amountPaid ?? ""}
                                      currency={invoice.currency}
                                      disabled={!selectedPayment}
                                      onValueChange={(decimalValue) =>
                                        updateBatchInvoiceAmount(
                                          invoice.id,
                                          decimalValue,
                                        )
                                      }
                                      className={INPUT_CLASSNAME}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-dark dark:text-white">
                          Batch total:{" "}
                          {selectedBatchPayments[0]?.invoice.currency ?? "USD"}{" "}
                          {batchTotal.toFixed(2)}
                        </div>
                      </div>
                    )}

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
