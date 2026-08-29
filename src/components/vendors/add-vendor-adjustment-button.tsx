"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CurrencyInput } from "@/components/ui/currency-input";
import { useStore } from "@/contexts/StoreContext";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { VendorFormMessage } from "@/components/vendors/vendor-form-message";
import { VendorModal } from "@/components/vendors/vendor-modal";
import type { VendorInvoiceSupplierOption } from "@/lib/vendors/invoice-processing";
import {
  VENDOR_ADJUSTMENT_STATUS_LABELS,
  VENDOR_ADJUSTMENT_TYPE_LABELS,
  VENDOR_ADJUSTMENT_TYPES,
  normalizeVendorAdjustmentAmount,
  normalizeVendorAdjustmentQuantity,
  type VendorAdjustmentInvoiceOption,
  type VendorAdjustmentProductOption,
} from "@/lib/vendors/adjustments";

type VendorAdjustmentLineItemState = {
  productId: string;
  description: string;
  quantity: string;
  unitCost: string;
};

type VendorAdjustmentFormState = {
  supplierId: string;
  invoiceId: string;
  adjustmentType: (typeof VENDOR_ADJUSTMENT_TYPES)[number];
  status: "draft" | "approved";
  adjustmentDate: string;
  currency: string;
  amount: string;
  reason: string;
  notes: string;
  inventoryImpact: boolean;
  items: VendorAdjustmentLineItemState[];
};

type AddVendorAdjustmentButtonProps = {
  suppliers: VendorInvoiceSupplierOption[];
  invoices: VendorAdjustmentInvoiceOption[];
  products: VendorAdjustmentProductOption[];
  defaultSupplierId?: string;
  defaultInvoiceId?: string;
  defaultAdjustmentDate?: string;
  disabled?: boolean;
  disabledReason?: string;
  iconOnly?: boolean;
};

const INPUT_CLASSNAME = "app-input";

const TEXTAREA_CLASSNAME = `${INPUT_CLASSNAME} min-h-28 resize-y`;

function todayKey(timeZone = "UTC") {
  return getTodayIsoDateInTimeZone(timeZone);
}

function createEmptyLineItem(): VendorAdjustmentLineItemState {
  return {
    productId: "",
    description: "",
    quantity: "1",
    unitCost: "",
  };
}

function buildInitialFormState(
  invoices: VendorAdjustmentInvoiceOption[],
  defaultSupplierId?: string,
  defaultInvoiceId?: string,
  defaultAdjustmentDate?: string,
): VendorAdjustmentFormState {
  const selectedInvoice = invoices.find(
    (invoice) => invoice.id === defaultInvoiceId,
  );

  return {
    supplierId: selectedInvoice?.supplierId ?? defaultSupplierId ?? "",
    invoiceId: selectedInvoice?.id ?? "",
    adjustmentType: "return",
    status: "draft",
    adjustmentDate: defaultAdjustmentDate ?? todayKey(),
    currency: selectedInvoice?.currency ?? "USD",
    amount: "",
    reason: "",
    notes: "",
    inventoryImpact: false,
    items: [],
  };
}

function calculateLineAmount(item: VendorAdjustmentLineItemState) {
  const quantity = normalizeVendorAdjustmentQuantity(item.quantity);
  const unitCost = normalizeVendorAdjustmentAmount(item.unitCost);
  return normalizeVendorAdjustmentAmount(quantity * unitCost);
}

export function AddVendorAdjustmentButton({
  suppliers,
  invoices,
  products,
  defaultSupplierId,
  defaultInvoiceId,
  defaultAdjustmentDate,
  disabled = false,
  disabledReason,
  iconOnly = false,
}: AddVendorAdjustmentButtonProps) {
  const router = useRouter();
  const { activeStore } = useStore();
  const resolvedDefaultAdjustmentDate =
    defaultAdjustmentDate ?? todayKey(activeStore?.timeZone);
  const [isOpen, setIsOpen] = useState(false);
  const [formState, setFormState] = useState<VendorAdjustmentFormState>(
    buildInitialFormState(
      invoices,
      defaultSupplierId,
      defaultInvoiceId,
      resolvedDefaultAdjustmentDate,
    ),
  );
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openModal = () => {
    setFormState(
      buildInitialFormState(
        invoices,
        defaultSupplierId,
        defaultInvoiceId,
        resolvedDefaultAdjustmentDate,
      ),
    );
    setAttachment(null);
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
        resolvedDefaultAdjustmentDate,
      ),
    );
    setAttachment(null);
    setError("");
    setIsSubmitting(false);
  };

  const filteredInvoices = formState.supplierId
    ? invoices.filter((invoice) => invoice.supplierId === formState.supplierId)
    : invoices;
  const filteredProducts = formState.supplierId
    ? products.filter((product) => product.supplierId === formState.supplierId)
    : [];
  const selectedInvoice =
    invoices.find((invoice) => invoice.id === formState.invoiceId) ?? null;
  const computedAmount = normalizeVendorAdjustmentAmount(
    formState.items.reduce((sum, item) => sum + calculateLineAmount(item), 0),
  );
  const effectiveAmount = formState.inventoryImpact
    ? computedAmount
    : normalizeVendorAdjustmentAmount(formState.amount);

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

      return {
        ...current,
        supplierId,
        invoiceId: nextInvoice,
        currency:
          invoices.find((invoice) => invoice.id === nextInvoice)?.currency ??
          current.currency,
      };
    });
  };

  const handleInvoiceChange = (invoiceId: string) => {
    const invoice = invoices.find((entry) => entry.id === invoiceId);

    setFormState((current) => ({
      ...current,
      invoiceId,
      supplierId: invoice?.supplierId ?? current.supplierId,
      currency: invoice?.currency ?? current.currency,
    }));
  };

  const handleInventoryImpactChange = (inventoryImpact: boolean) => {
    setFormState((current) => ({
      ...current,
      inventoryImpact,
      amount: inventoryImpact ? "" : current.amount,
      items: inventoryImpact
        ? current.items.length > 0
          ? current.items
          : [createEmptyLineItem()]
        : [],
    }));
  };

  const updateLineItem = (
    index: number,
    field: keyof VendorAdjustmentLineItemState,
    value: string,
  ) => {
    setFormState((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value,
            }
          : item,
      ),
    }));
  };

  const handleProductChange = (index: number, productId: string) => {
    const product = filteredProducts.find((entry) => entry.id === productId);

    setFormState((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              productId,
              description: product?.name ?? item.description,
              unitCost: product ? product.cost.toFixed(2) : item.unitCost,
            }
          : item,
      ),
    }));
  };

  const addLineItem = () => {
    setFormState((current) => ({
      ...current,
      items: [...current.items, createEmptyLineItem()],
    }));
  };

  const removeLineItem = (index: number) => {
    setFormState((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    void (async () => {
      try {
        const formData = new FormData();
        formData.set(
          "payload",
          JSON.stringify({
            supplierId: formState.supplierId,
            invoiceId: formState.invoiceId || undefined,
            adjustmentType: formState.adjustmentType,
            status: formState.status,
            adjustmentDate: formState.adjustmentDate,
            currency: formState.currency,
            amount: effectiveAmount,
            reason: formState.reason,
            notes: formState.notes,
            inventoryImpact: formState.inventoryImpact,
            items: formState.inventoryImpact
              ? formState.items.map((item) => ({
                  productId: item.productId,
                  description: item.description,
                  quantity: item.quantity,
                  unitCost: item.unitCost,
                  amount: calculateLineAmount(item),
                }))
              : [],
          }),
        );

        if (attachment) {
          formData.set("attachment", attachment);
        }

        const response = await fetch("/api/vendor-adjustments", {
          method: "POST",
          body: formData,
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to create supplier adjustment");
        }

        closeModal();
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to create supplier adjustment",
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
        title={disabledReason ?? "Track supplier return or deduction"}
        aria-label="Track supplier return or deduction"
        className={
          iconOnly
            ? "app-icon-button text-amber-700 hover:border-amber-200 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        <RotateCcw className="h-4 w-4" />
        {iconOnly ? null : "Add return / deduction"}
      </button>

      {isOpen ? (
        <VendorModal>
          <div className="modal-shell z-99999 bg-dark/50">
            <div className="modal-card-scroll max-w-4xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    Supplier return or deduction
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Track supplier returns, credit notes, shortages, rebates,
                    and other A/P deductions without editing the original
                    invoice. Drafts can be reviewed before they hit payables or
                    stock.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-full border border-stroke p-2 text-dark-5 transition hover:bg-gray-2 dark:border-dark-3 dark:hover:bg-dark-2"
                  aria-label="Close supplier adjustment dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="custom-scrollbar overflow-y-auto px-6 py-6">
                <form onSubmit={handleSubmit}>
                  {error ? (
                    <VendorFormMessage
                      tone="error"
                      title="Unable to save supplier adjustment"
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
                        <option value="">
                          Supplier-level credit / deduction
                        </option>
                        {filteredInvoices.map((invoice) => (
                          <option key={invoice.id} value={invoice.id}>
                            {invoice.invoiceNumber}
                          </option>
                        ))}
                      </select>
                      {selectedInvoice ? (
                        <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                          Current invoice balance: {selectedInvoice.currency}{" "}
                          {Math.abs(selectedInvoice.netBalance).toFixed(2)}
                          {selectedInvoice.netBalance < 0 ? " credit" : " due"}
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Adjustment type
                      </label>
                      <select
                        value={formState.adjustmentType}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            adjustmentType: event.target
                              .value as VendorAdjustmentFormState["adjustmentType"],
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      >
                        {VENDOR_ADJUSTMENT_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {VENDOR_ADJUSTMENT_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Adjustment date
                      </label>
                      <input
                        required
                        type="date"
                        value={formState.adjustmentDate}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            adjustmentDate: event.target.value,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Workflow status
                      </label>
                      <select
                        value={formState.status}
                        onChange={() => undefined}
                        className={INPUT_CLASSNAME}
                        disabled
                      >
                        <option value="draft">
                          {VENDOR_ADJUSTMENT_STATUS_LABELS.draft}
                        </option>
                      </select>
                      <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                        New supplier adjustments are always created as drafts.
                        Another manager or owner must approve them before they
                        affect payables or inventory.
                      </p>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Currency
                      </label>
                      <input
                        value={formState.currency}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            currency: event.target.value.toUpperCase(),
                          }))
                        }
                        className={INPUT_CLASSNAME}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Amount
                      </label>
                      <CurrencyInput
                        required
                        value={
                          formState.inventoryImpact
                            ? effectiveAmount.toFixed(2)
                            : formState.amount
                        }
                        currency={formState.currency || "USD"}
                        onValueChange={(decimalValue) =>
                          setFormState((current) => ({
                            ...current,
                            amount: decimalValue,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                        disabled={formState.inventoryImpact}
                      />
                      <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                        {formState.inventoryImpact
                          ? "Calculated from return line items and held until approval."
                          : "This amount will reduce supplier payables after approval."}
                      </p>
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Supporting document
                      </label>
                      <input
                        type="file"
                        accept=".pdf,image/png,image/jpeg,image/webp"
                        onChange={(event) =>
                          setAttachment(event.target.files?.[0] ?? null)
                        }
                        className={INPUT_CLASSNAME}
                      />
                      <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                        Optional credit note, return authorization, supplier
                        memo, or damaged-goods evidence. Max 10MB.
                      </p>
                      {attachment ? (
                        <div className="mt-2 text-xs font-medium text-dark dark:text-white">
                          Selected: {attachment.name}
                        </div>
                      ) : null}
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-2 flex items-center gap-3 text-sm font-medium text-dark dark:text-white">
                        <input
                          type="checkbox"
                          checked={formState.inventoryImpact}
                          onChange={(event) =>
                            handleInventoryImpactChange(event.target.checked)
                          }
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        Apply inventory impact
                      </label>
                      <p className="text-xs text-dark-5 dark:text-dark-6">
                        Enable this for supplier returns that should reduce
                        on-hand stock after approval.
                      </p>
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Reason
                      </label>
                      <input
                        value={formState.reason}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            reason: event.target.value,
                          }))
                        }
                        className={INPUT_CLASSNAME}
                        placeholder="Returned spoiled stock, vendor short-shipped, rebate credit, etc."
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
                        placeholder="Optional internal notes for the purchasing or accounting team"
                      />
                    </div>
                  </div>

                  {formState.inventoryImpact ? (
                    <div className="mt-6 rounded-[20px] border border-stroke dark:border-dark-3">
                      <div className="flex items-center justify-between gap-3 border-b border-stroke px-4 py-3 dark:border-dark-3">
                        <div>
                          <div className="text-sm font-medium text-dark dark:text-white">
                            Return items
                          </div>
                          <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                            Quantities will be removed from the selected
                            supplier products.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={addLineItem}
                          className="inline-flex items-center gap-2 rounded-full border border-stroke px-3 py-1.5 text-sm font-medium text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                        >
                          <Plus className="h-4 w-4" />
                          Add item
                        </button>
                      </div>
                      <div className="custom-scrollbar overflow-x-auto">
                        <Table className="min-w-full text-left text-sm">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Product</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead className="text-right">
                                Unit cost
                              </TableHead>
                              <TableHead className="text-right">
                                Amount
                              </TableHead>
                              <TableHead className="text-right">
                                Action
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {formState.items.map((item, index) => {
                              const selectedProduct =
                                filteredProducts.find(
                                  (product) => product.id === item.productId,
                                ) ?? null;

                              return (
                                <TableRow
                                  key={`${item.productId || "line"}-${index}`}
                                >
                                  <TableCell>
                                    <select
                                      value={item.productId}
                                      onChange={(event) =>
                                        handleProductChange(
                                          index,
                                          event.target.value,
                                        )
                                      }
                                      className="min-w-[240px] rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-primary"
                                    >
                                      <option value="">
                                        Select a supplier product
                                      </option>
                                      {filteredProducts.map((product) => (
                                        <option
                                          key={product.id}
                                          value={product.id}
                                        >
                                          {product.name} · {product.sku}
                                        </option>
                                      ))}
                                    </select>
                                    {selectedProduct ? (
                                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                                        {selectedProduct.quantity} on hand
                                      </div>
                                    ) : null}
                                  </TableCell>
                                  <TableCell>
                                    <input
                                      value={item.description}
                                      onChange={(event) =>
                                        updateLineItem(
                                          index,
                                          "description",
                                          event.target.value,
                                        )
                                      }
                                      className="min-w-[220px] rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-primary"
                                      placeholder="Description"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      value={item.quantity}
                                      onChange={(event) =>
                                        updateLineItem(
                                          index,
                                          "quantity",
                                          event.target.value,
                                        )
                                      }
                                      className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-right text-sm text-gray-900 outline-none transition focus:border-primary"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <CurrencyInput
                                      value={item.unitCost}
                                      currency={formState.currency || "USD"}
                                      showSymbol={false}
                                      onValueChange={(decimalValue) =>
                                        updateLineItem(
                                          index,
                                          "unitCost",
                                          decimalValue,
                                        )
                                      }
                                      className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-right text-sm text-gray-900 outline-none transition focus:border-primary"
                                    />
                                  </TableCell>
                                  <TableCell className="text-right font-semibold text-dark dark:text-white">
                                    {formState.currency}{" "}
                                    {calculateLineAmount(item).toFixed(2)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <button
                                      type="button"
                                      onClick={() => removeLineItem(index)}
                                      className="app-icon-button app-danger-icon-button"
                                      aria-label="Remove return line"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ) : null}

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
                      Save draft
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
