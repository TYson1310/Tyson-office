"use client";

import {
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CurrencyInput } from "@/components/ui/currency-input";
import { VendorFormMessage } from "@/components/vendors/vendor-form-message";
import { VendorModal } from "@/components/vendors/vendor-modal";
import {
  buildInvoiceDescription,
  calculateInvoiceItemCostPerPiece,
  calculateInvoiceItemUnitCount,
  calculateDueDateFromPaymentTerms,
  findSuggestedProductId,
  findSuggestedSupplierId,
  INVOICE_UPLOAD_ACCEPT,
  isAllowedInvoiceFile,
  MAX_INVOICE_UPLOAD_BYTES,
  normalizeInvoiceAmount,
  normalizeInvoiceCurrency,
  normalizeInvoicePieceCount,
  normalizeInvoiceItems,
  normalizeInvoiceText,
  reconcileInvoiceTotals,
} from "@/lib/vendors/invoice-processing";
import type {
  InvoiceExtractionResponse,
  InvoiceVerificationPayload,
} from "@/types/types";
import type {
  VendorInvoiceProductOption,
  VendorInvoiceSupplierOption,
} from "@/lib/vendors/invoice-processing";

type UploadInvoiceButtonProps = {
  suppliers: VendorInvoiceSupplierOption[];
  products: VendorInvoiceProductOption[];
  disabled?: boolean;
  disabledReason?: string;
};

type ApiErrorResponse = {
  error?: string;
};

type InvoiceEntryMode = "manual" | "upload";

type InvoiceWorkflowStep = "upload" | "verify";

const INPUT_CLASSNAME = "app-input";

const TEXTAREA_CLASSNAME = `${INPUT_CLASSNAME} min-h-28 resize-y`;

const INITIAL_FORM_STATE: InvoiceVerificationPayload = {
  supplierId: "",
  invoiceNumber: "",
  issueDate: "",
  dueDate: "",
  vendorName: "",
  vendorAddress: "",
  customerName: "",
  items: [],
  subtotal: 0,
  tax: 0,
  total: 0,
  currency: "USD",
  description: "",
  notes: "",
};

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function readJson<T>(response: Response) {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

export function UploadInvoiceButton({
  suppliers,
  products,
  disabled = false,
  disabledReason,
}: UploadInvoiceButtonProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<InvoiceEntryMode>("upload");
  const [step, setStep] = useState<InvoiceWorkflowStep>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formState, setFormState] = useState(INITIAL_FORM_STATE);
  const [error, setError] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const closeModal = () => {
    setIsOpen(false);
    setEntryMode("upload");
    setStep("upload");
    setSelectedFile(null);
    setFormState(INITIAL_FORM_STATE);
    setError("");
    setIsExtracting(false);
    setIsSubmitting(false);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    setError("");
    setSelectedFile(file);
    setStep("upload");

    if (!file) {
      return;
    }

    if (!isAllowedInvoiceFile(file.name, file.type)) {
      setSelectedFile(null);
      setError("Upload a PDF, PNG, JPG, or WEBP invoice.");
      return;
    }

    if (file.size > MAX_INVOICE_UPLOAD_BYTES) {
      setSelectedFile(null);
      setError("Invoice file must be 10MB or smaller.");
    }
  };

  const handleManualInvoice = () => {
    setEntryMode("manual");
    setStep("verify");
    setSelectedFile(null);
    setFormState(INITIAL_FORM_STATE);
    setError("");
  };

  const handleProcessInvoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedFile) {
      setError("Choose an invoice file to process.");
      return;
    }

    setError("");
    setIsExtracting(true);

    try {
      const requestBody = new FormData();
      requestBody.append("file", selectedFile);

      const response = await fetch("/api/vendor-invoices/extract", {
        method: "POST",
        body: requestBody,
      });
      const body = await readJson<InvoiceExtractionResponse | ApiErrorResponse>(
        response,
      );

      if (!response.ok || ("error" in body && body.error)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "Failed to process invoice",
        );
      }

      const extractedInvoice =
        "invoice" in body && body.invoice ? body.invoice : {};
      const invoiceNumber = normalizeInvoiceText(
        extractedInvoice.invoiceNumber,
      );
      const issueDate = normalizeInvoiceText(extractedInvoice.issueDate);
      const suggestedSupplierId = findSuggestedSupplierId(
        normalizeInvoiceText(extractedInvoice.vendorName),
        suppliers,
      );
      const selectedSupplier = suppliers.find(
        (supplier) => supplier.id === suggestedSupplierId,
      );
      const items = normalizeInvoiceItems(extractedInvoice.items);

      setFormState({
        supplierId: suggestedSupplierId,
        invoiceNumber,
        issueDate,
        dueDate:
          normalizeInvoiceText(extractedInvoice.dueDate) ||
          calculateDueDateFromPaymentTerms(
            issueDate,
            selectedSupplier?.paymentTerms,
          ),
        vendorName: normalizeInvoiceText(extractedInvoice.vendorName),
        vendorAddress: normalizeInvoiceText(extractedInvoice.vendorAddress),
        customerName: normalizeInvoiceText(extractedInvoice.customerName),
        items: items.map((item) => ({
          ...item,
          matchedProductId:
            findSuggestedProductId(
              item.description,
              suggestedSupplierId,
              products,
            ) || undefined,
        })),
        subtotal: normalizeInvoiceAmount(extractedInvoice.subtotal),
        tax: normalizeInvoiceAmount(extractedInvoice.tax),
        total: normalizeInvoiceAmount(extractedInvoice.total),
        currency: normalizeInvoiceCurrency(extractedInvoice.currency),
        description:
          normalizeInvoiceText(extractedInvoice.description) ||
          buildInvoiceDescription(items) ||
          "",
        notes: "",
      });
      setEntryMode("upload");
      setStep("verify");
    } catch (processError) {
      setError(
        processError instanceof Error
          ? processError.message
          : "Failed to process invoice",
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSupplierChange = (supplierId: string) => {
    const supplier = suppliers.find((item) => item.id === supplierId);

    setFormState((current) => ({
      ...current,
      supplierId,
      dueDate:
        current.dueDate ||
        calculateDueDateFromPaymentTerms(
          current.issueDate,
          supplier?.paymentTerms,
        ),
      items: current.items.map((item) => ({
        ...item,
        matchedProductId:
          findSuggestedProductId(item.description, supplierId, products) ||
          undefined,
      })),
    }));
  };

  const supplierProducts = formState.supplierId
    ? products
        .filter((product) => product.supplierId === formState.supplierId)
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (entryMode === "upload" && !selectedFile) {
      setError("The processed invoice file is missing. Select it again.");
      setStep("upload");
      return;
    }

    const selectedFormSupplier = suppliers.find(
      (supplier) => supplier.id === formState.supplierId,
    );

    if (
      !formState.invoiceNumber ||
      !formState.issueDate ||
      !formState.dueDate ||
      (!formState.supplierId &&
        !normalizeInvoiceText(
          formState.vendorName || selectedFormSupplier?.name,
        )) ||
      formState.total <= 0
    ) {
      setError(
        "Review the vendor, invoice number, issue date, due date, and total before saving.",
      );
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const requestBody = new FormData();
      if (selectedFile) {
        requestBody.append("file", selectedFile);
      }
      requestBody.append("payload", JSON.stringify(formState));

      const response = await fetch("/api/vendor-invoices", {
        method: "POST",
        body: requestBody,
      });
      const body = await readJson<ApiErrorResponse>(response);

      if (!response.ok || body.error) {
        throw new Error(body.error ?? "Failed to save invoice");
      }

      closeModal();
      startRefresh(() => router.refresh());
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to save invoice",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedSupplier = suppliers.find(
    (supplier) => supplier.id === formState.supplierId,
  );
  const totalsReconciliation = reconcileInvoiceTotals(formState);
  const isPdfInvoice = Boolean(
    selectedFile &&
      (selectedFile.type === "application/pdf" ||
        selectedFile.name.toLowerCase().endsWith(".pdf")),
  );
  const formatInvoiceAmount = (amount: number) =>
    `${normalizeInvoiceCurrency(formState.currency)} ${amount.toFixed(2)}`;
  const reconciliationWarnings = [
    totalsReconciliation.hasLineItemsSubtotalMismatch
      ? `Extracted line items add up to ${formatInvoiceAmount(totalsReconciliation.lineItemsTotal)}, but subtotal is ${formatInvoiceAmount(totalsReconciliation.subtotal)}.`
      : null,
    totalsReconciliation.hasSubtotalTaxTotalMismatch
      ? `Subtotal plus tax equals ${formatInvoiceAmount(totalsReconciliation.expectedTotalFromSubtotal)}, but total is ${formatInvoiceAmount(totalsReconciliation.total)}.`
      : null,
    isPdfInvoice && totalsReconciliation.hasMismatch
      ? "If this is a multi-page PDF, later-page line items or totals may have been missed. Review every page before saving."
      : null,
  ].filter((warning): warning is string => Boolean(warning));

  const updateLineItemCount = (
    index: number,
    field: "quantity" | "itemsPerPack",
    value: string,
  ) => {
    setFormState((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: normalizeInvoicePieceCount(value) || 0,
            }
          : item,
      ),
    }));
  };

  const updateLineItemMatch = (index: number, productId: string) => {
    setFormState((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              matchedProductId: normalizeInvoiceText(productId) || undefined,
            }
          : item,
      ),
    }));
  };

  const buildMarginEngineHref = (index: number) => {
    const item = formState.items[index];

    if (!item) {
      return "";
    }

    const costPerItem = calculateInvoiceItemCostPerPiece(item);
    const packQuantity = normalizeInvoicePieceCount(item.quantity);
    const itemsPerPack = normalizeInvoicePieceCount(item.itemsPerPack);

    if (costPerItem <= 0 || packQuantity <= 0 || itemsPerPack <= 0) {
      return "";
    }

    return `/products/margin-engine?landingCost=${costPerItem.toFixed(2)}&source=${encodeURIComponent(formState.invoiceNumber || "invoice")}&line=${encodeURIComponent(item.description)}&lineAmount=${encodeURIComponent(item.amount.toFixed(2))}&packs=${encodeURIComponent(String(packQuantity))}&itemsPerPack=${encodeURIComponent(String(itemsPerPack))}`;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={disabled || isRefreshing}
        className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300"
        title={disabledReason}
      >
        <FileText className="h-4 w-4" />
        Log invoice
      </button>

      {isOpen ? (
        <VendorModal>
          <div className="modal-shell z-99999 bg-dark/50">
            <div className="modal-card-scroll max-w-4xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    Invoice processing
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Upload and extract a source document, or enter an invoice
                    manually when no copy is available.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-full border border-stroke p-2 text-dark-5 transition hover:bg-gray-2 dark:border-dark-3 dark:hover:bg-dark-2"
                  aria-label="Close invoice processing dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="border-b border-stroke px-6 py-3 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
                {step === "upload"
                  ? "Choose OCR upload or manual invoice entry"
                  : entryMode === "manual"
                    ? "Manual entry: enter vendor invoice details"
                    : "Step 2 of 2: Review and save verified invoice data"}
              </div>

              <div className="custom-scrollbar overflow-y-auto px-6 py-6">
                {step === "upload" ? (
                  <form onSubmit={handleProcessInvoice}>
                    {error ? (
                      <VendorFormMessage
                        tone="error"
                        title="Unable to process invoice"
                        className="mb-4"
                      >
                        {error}
                      </VendorFormMessage>
                    ) : null}

                    <div className="mb-6 grid gap-4 md:grid-cols-2">
                      <div className="rounded-[22px] border border-stroke p-5 dark:border-dark-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <Upload className="h-5 w-5" />
                          </span>
                          <div>
                            <h3 className="font-semibold text-dark dark:text-white">
                              OCR from invoice copy
                            </h3>
                            <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                              Upload a PDF or image and review extracted totals.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-stroke p-5 dark:border-dark-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <FileText className="h-5 w-5" />
                          </span>
                          <div>
                            <h3 className="font-semibold text-dark dark:text-white">
                              Manual invoice entry
                            </h3>
                            <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                              Log vendor invoices without OCR or attachment.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleManualInvoice}
                          className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-dark/90 dark:bg-white dark:text-dark"
                        >
                          Enter manually
                        </button>
                      </div>
                    </div>

                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Invoice file
                    </label>
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-[24px] border border-dashed border-primary/40 bg-primary/5 px-6 py-10 text-center transition hover:border-primary hover:bg-primary/10">
                      <FileText className="h-10 w-10 text-primary" />
                      <span className="mt-4 text-base font-semibold text-dark dark:text-white">
                        Choose a supplier invoice
                      </span>
                      <span className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                        PDF, PNG, JPG, or WEBP up to 10MB
                      </span>
                      <input
                        type="file"
                        accept={INVOICE_UPLOAD_ACCEPT}
                        onChange={handleFileChange}
                        className="sr-only"
                      />
                    </label>

                    {selectedFile ? (
                      <div className="mt-4 rounded-[20px] border border-stroke px-4 py-4 dark:border-dark-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-dark dark:text-white">
                              {selectedFile.name}
                            </div>
                            <div className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                              {formatFileSize(selectedFile.size)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedFile(null);
                              setError("");
                            }}
                            className="text-sm font-medium text-primary"
                          >
                            Remove
                          </button>
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
                        disabled={!selectedFile || isExtracting}
                        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        {isExtracting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        Extract invoice
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleSubmit}>
                    {error ? (
                      <VendorFormMessage
                        tone="error"
                        title="Unable to save invoice"
                        className="mb-4"
                      >
                        {error}
                      </VendorFormMessage>
                    ) : null}

                    {reconciliationWarnings.length > 0 ? (
                      <VendorFormMessage
                        tone="warning"
                        title="Extracted invoice totals need review"
                        className="mb-4"
                      >
                        <div>
                          The extracted amounts do not reconcile yet. You can
                          still save after reviewing them.
                        </div>
                        <ul className="mt-3 list-disc space-y-1 pl-5">
                          {reconciliationWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </VendorFormMessage>
                    ) : null}

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                          Matched vendor
                        </label>
                        <select
                          value={formState.supplierId}
                          onChange={(event) =>
                            handleSupplierChange(event.target.value)
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
                        {selectedSupplier ? (
                          <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                            Payment terms:{" "}
                            {selectedSupplier.paymentTerms?.toUpperCase() ??
                              "Not set"}
                          </p>
                        ) : normalizeInvoiceText(formState.vendorName) ? (
                          <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                            No existing vendor is matched. Saving will create{" "}
                            <span className="font-semibold text-dark dark:text-white">
                              {normalizeInvoiceText(formState.vendorName)}
                            </span>{" "}
                            automatically.
                          </p>
                        ) : null}
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
                          placeholder="INV-10042"
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
                            setFormState((current) => {
                              const supplier = suppliers.find(
                                (item) => item.id === current.supplierId,
                              );
                              const issueDate = event.target.value;

                              return {
                                ...current,
                                issueDate,
                                dueDate:
                                  current.dueDate ||
                                  calculateDueDateFromPaymentTerms(
                                    issueDate,
                                    supplier?.paymentTerms,
                                  ),
                              };
                            })
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
                          Currency
                        </label>
                        <input
                          required
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
                          Total
                        </label>
                        <CurrencyInput
                          required
                          value={formState.total}
                          currency={formState.currency || "USD"}
                          onValueChange={(decimalValue) =>
                            setFormState((current) => ({
                              ...current,
                              total: normalizeInvoiceAmount(decimalValue),
                            }))
                          }
                          className={INPUT_CLASSNAME}
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                          Subtotal
                        </label>
                        <CurrencyInput
                          value={formState.subtotal}
                          currency={formState.currency || "USD"}
                          onValueChange={(decimalValue) =>
                            setFormState((current) => ({
                              ...current,
                              subtotal: normalizeInvoiceAmount(decimalValue),
                            }))
                          }
                          className={INPUT_CLASSNAME}
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                          Tax
                        </label>
                        <CurrencyInput
                          value={formState.tax}
                          currency={formState.currency || "USD"}
                          onValueChange={(decimalValue) =>
                            setFormState((current) => ({
                              ...current,
                              tax: normalizeInvoiceAmount(decimalValue),
                            }))
                          }
                          className={INPUT_CLASSNAME}
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                          {entryMode === "manual"
                            ? "Vendor name"
                            : "Extracted vendor name"}
                        </label>
                        <input
                          value={formState.vendorName}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              vendorName: event.target.value,
                            }))
                          }
                          className={INPUT_CLASSNAME}
                          placeholder={
                            entryMode === "manual"
                              ? (selectedSupplier?.name ??
                                "Optional vendor name")
                              : "Supplier name from invoice"
                          }
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                          Bill-to customer
                        </label>
                        <input
                          value={formState.customerName}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              customerName: event.target.value,
                            }))
                          }
                          className={INPUT_CLASSNAME}
                          placeholder="Customer or business unit"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                          Vendor address
                        </label>
                        <input
                          value={formState.vendorAddress}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              vendorAddress: event.target.value,
                            }))
                          }
                          className={INPUT_CLASSNAME}
                          placeholder={
                            entryMode === "manual"
                              ? "Optional vendor address"
                              : "Extracted vendor address"
                          }
                        />
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
                          placeholder="Office supplies, ingredient shipment, etc."
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
                          placeholder="Optional notes for the accounts payable team"
                        />
                      </div>
                    </div>

                    {formState.items.length > 0 ? (
                      <div className="mt-6 rounded-[20px] border border-stroke dark:border-dark-3">
                        <div className="border-b border-stroke px-4 py-3 text-sm font-medium text-dark dark:border-dark-3 dark:text-white">
                          Extracted line items
                          <div className="mt-1 text-xs font-normal text-dark-5 dark:text-dark-6">
                            Products are matched inside the selected supplier
                            only. Leave the match blank to create a new supplier
                            product.
                          </div>
                        </div>
                        <div className="custom-scrollbar overflow-x-auto">
                          <Table className="min-w-full text-left text-sm">
                            <TableHeader>
                              <TableRow>
                                <TableHead>Description</TableHead>
                                <TableHead>Product match</TableHead>
                                <TableHead className="text-right">
                                  Qty
                                </TableHead>
                                <TableHead className="text-right">
                                  Items / pack
                                </TableHead>
                                <TableHead className="text-right">
                                  Amount
                                </TableHead>
                                <TableHead className="text-right">
                                  Per item
                                </TableHead>
                                <TableHead className="text-right">
                                  Action
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {formState.items.map((item, index) => {
                                const marginHref = buildMarginEngineHref(index);
                                const perItemCost =
                                  calculateInvoiceItemCostPerPiece(item);
                                const totalUnits =
                                  calculateInvoiceItemUnitCount(item);

                                return (
                                  <TableRow
                                    key={`${item.description}-${index}`}
                                  >
                                    <TableCell className="text-dark dark:text-white">
                                      <div className="font-medium">
                                        {item.description}
                                      </div>
                                      {totalUnits > 0 ? (
                                        <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                                          {totalUnits} total items
                                        </div>
                                      ) : null}
                                    </TableCell>
                                    <TableCell>
                                      <select
                                        value={item.matchedProductId ?? ""}
                                        onChange={(event) =>
                                          updateLineItemMatch(
                                            index,
                                            event.target.value,
                                          )
                                        }
                                        className="min-w-[250px] rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-primary"
                                        disabled={!formState.supplierId}
                                      >
                                        <option value="">
                                          Create new supplier product
                                        </option>
                                        {supplierProducts.map((product) => (
                                          <option
                                            key={product.id}
                                            value={product.id}
                                          >
                                            {product.name} · {product.sku}
                                          </option>
                                        ))}
                                      </select>
                                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                                        {item.matchedProductId
                                          ? "Existing supplier product will be updated."
                                          : "A new supplier product will be created if no safe match exists."}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.quantity || ""}
                                        onChange={(event) =>
                                          updateLineItemCount(
                                            index,
                                            "quantity",
                                            event.target.value,
                                          )
                                        }
                                        className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-right text-sm text-gray-900 outline-none transition focus:border-primary"
                                        placeholder="0"
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={item.itemsPerPack ?? ""}
                                        onChange={(event) =>
                                          updateLineItemCount(
                                            index,
                                            "itemsPerPack",
                                            event.target.value,
                                          )
                                        }
                                        className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-right text-sm text-gray-900 outline-none transition focus:border-primary"
                                        placeholder="24"
                                      />
                                    </TableCell>
                                    <TableCell className="text-right font-semibold text-dark dark:text-white">
                                      {item.amount.toFixed(2)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {perItemCost > 0 ? (
                                        <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                                          {formState.currency}{" "}
                                          {perItemCost.toFixed(2)}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-dark-5 dark:text-dark-6">
                                          Add items / pack
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {marginHref ? (
                                        <a
                                          href={marginHref}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center rounded-full bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                                        >
                                          Check margin
                                        </a>
                                      ) : (
                                        <span className="text-xs text-dark-5 dark:text-dark-6">
                                          Set items / pack
                                        </span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-6 flex justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setStep("upload");
                          setEntryMode("upload");
                          setError("");
                        }}
                        className="rounded-full border border-stroke px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                      >
                        {entryMode === "manual"
                          ? "Back to options"
                          : "Back to upload"}
                      </button>
                      <div className="flex gap-3">
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
                          Save invoice
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </VendorModal>
      ) : null}
    </>
  );
}
