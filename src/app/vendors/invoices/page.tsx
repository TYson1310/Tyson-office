import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { ReportDownloadButton } from "@/components/reports/report-download-button";
import { AddVendorPaymentButton } from "@/components/vendors/add-vendor-payment-button";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { AddVendorAdjustmentButton } from "@/components/vendors/add-vendor-adjustment-button";
import { DeleteVendorAdjustmentButton } from "@/components/vendors/delete-vendor-adjustment-button";
import { VendorAdjustmentStatusButton } from "@/components/vendors/vendor-adjustment-status-button";
import { EditVendorPaymentButton } from "@/components/vendors/edit-vendor-payment-button";
import { VendorPaymentStatusButton } from "@/components/vendors/vendor-payment-status-button";
import { DeleteVendorInvoiceButton } from "@/components/vendors/delete-vendor-invoice-button";
import { VendorAttachmentActions } from "@/components/vendors/vendor-attachment-actions";
import { UploadInvoiceButton } from "@/components/vendors/upload-invoice-button";
import { ViewVendorInvoiceButton } from "@/components/vendors/view-vendor-invoice-button";
import {
  EditVendorInvoiceButton,
  type EditableVendorInvoiceRecord,
} from "@/components/vendors/edit-vendor-invoice-button";
import { InvoiceFilters } from "@/components/vendors/invoice-filters";
import type { VendorInvoiceActionRecord } from "@/components/vendors/vendor-invoice-action-types";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import type {
  VendorInvoiceProductOption,
  VendorInvoiceSupplierOption,
} from "@/lib/vendors/invoice-processing";
import {
  formatCurrency,
  getOperationsDataset,
  getSupplierAvailableCredit,
  getSupplierOpenBalance,
} from "@/lib/erp/operations";
import type {
  VendorAdjustmentInvoiceOption,
  VendorAdjustmentProductOption,
} from "@/lib/vendors/adjustments";
import {
  VENDOR_ADJUSTMENT_STATUS_LABELS,
  isPostedVendorAdjustmentStatus,
} from "@/lib/vendors/adjustments";
import {
  VENDOR_PAYMENT_STATUS_LABELS,
  formatVendorPaymentMethod,
  isPostedVendorPaymentStatus,
  type VendorPaymentInvoiceOption,
} from "@/lib/vendors/payments";
import { requireActiveStoreContext } from "@/lib/stores/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Vendor Invoices",
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function invoiceStatusTone(
  status: "pending" | "paid" | "overdue" | "cancelled",
) {
  if (status === "paid") {
    return "green" as const;
  }

  if (status === "overdue") {
    return "red" as const;
  }

  if (status === "cancelled") {
    return "slate" as const;
  }

  return "amber" as const;
}

function adjustmentTypeTone(type: string) {
  if (type === "return" || type === "credit_note" || type === "rebate") {
    return "green" as const;
  }

  if (type === "damage" || type === "shortage") {
    return "amber" as const;
  }

  return "slate" as const;
}

function adjustmentStatusTone(status: "draft" | "approved" | "void") {
  if (status === "approved") {
    return "green" as const;
  }

  if (status === "draft") {
    return "amber" as const;
  }

  return "slate" as const;
}

function paymentStatusTone(status: "posted" | "void") {
  return status === "posted" ? ("green" as const) : ("slate" as const);
}

function formatInvoiceBalance(balance: number) {
  if (balance < 0) {
    return `Credit ${formatCurrency(Math.abs(balance))}`;
  }

  return formatCurrency(balance);
}

interface PageProps {
  searchParams: Promise<{
    q?: string;
    status?: string;
    vendorId?: string;
  }>;
}

export default async function VendorInvoicesPage({ searchParams }: PageProps) {
  const { q, status, vendorId } = await searchParams;
  const { activeStore } = await requireActiveStoreContext();
  const todayDateKey = getTodayIsoDateInTimeZone(activeStore.timeZone);
  const dataset = await getOperationsDataset();
  const canManageInvoices = dataset.source === "database";
  const selectedVendorId = vendorId && vendorId !== "all" ? vendorId : null;
  const selectedVendorName = selectedVendorId
    ? dataset.suppliers.find((supplier) => supplier.id === selectedVendorId)
        ?.name
    : null;
  const selectedVendorLabel =
    selectedVendorName ?? (selectedVendorId ? "Selected vendor" : null);

  let filteredInvoices = [...dataset.vendorInvoices].sort(
    (left, right) => right.issueDate.getTime() - left.issueDate.getTime(),
  );

  if (q) {
    const query = q.toLowerCase();
    filteredInvoices = filteredInvoices.filter(
      (invoice) =>
        invoice.invoiceNumber.toLowerCase().includes(query) ||
        invoice.vendorName.toLowerCase().includes(query) ||
        (invoice.description &&
          invoice.description.toLowerCase().includes(query)),
    );
  }

  if (status && status !== "all") {
    filteredInvoices = filteredInvoices.filter(
      (invoice) => invoice.status === status,
    );
  }

  if (selectedVendorId) {
    filteredInvoices = filteredInvoices.filter(
      (invoice) => invoice.vendorId === selectedVendorId,
    );
  }

  let filteredAdjustments = [...dataset.vendorAdjustments].sort(
    (left, right) =>
      right.adjustmentDate.getTime() - left.adjustmentDate.getTime(),
  );

  if (q) {
    const query = q.toLowerCase();
    filteredAdjustments = filteredAdjustments.filter(
      (adjustment) =>
        adjustment.adjustmentNumber.toLowerCase().includes(query) ||
        adjustment.vendorName.toLowerCase().includes(query) ||
        (adjustment.invoiceNumber &&
          adjustment.invoiceNumber.toLowerCase().includes(query)) ||
        adjustment.status.toLowerCase().includes(query) ||
        (adjustment.reason &&
          adjustment.reason.toLowerCase().includes(query)) ||
        (adjustment.notes && adjustment.notes.toLowerCase().includes(query)) ||
        (adjustment.attachmentName &&
          adjustment.attachmentName.toLowerCase().includes(query)),
    );
  }

  if (selectedVendorId) {
    filteredAdjustments = filteredAdjustments.filter(
      (adjustment) => adjustment.vendorId === selectedVendorId,
    );
  }

  let filteredPayments = [...dataset.vendorPayments].sort(
    (left, right) => right.paymentDate.getTime() - left.paymentDate.getTime(),
  );

  if (q) {
    const query = q.toLowerCase();
    filteredPayments = filteredPayments.filter(
      (payment) =>
        payment.vendorName.toLowerCase().includes(query) ||
        payment.referenceNumber.toLowerCase().includes(query) ||
        payment.status.toLowerCase().includes(query) ||
        (payment.invoiceNumber &&
          payment.invoiceNumber.toLowerCase().includes(query)) ||
        (payment.notes && payment.notes.toLowerCase().includes(query)),
    );
  }

  if (selectedVendorId) {
    filteredPayments = filteredPayments.filter(
      (payment) => payment.vendorId === selectedVendorId,
    );
  }

  const supplierOptions = dataset.suppliers.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    paymentTerms:
      supplier.paymentTerms as VendorInvoiceSupplierOption["paymentTerms"],
  }));
  const productOptions = dataset.products.map((product) => ({
    id: product.id,
    supplierId: product.supplierId ?? "",
    name: product.name,
    description: product.description,
    sku: product.sku,
  })) satisfies VendorInvoiceProductOption[];
  const adjustmentProductOptions = dataset.products.map((product) => ({
    id: product.id,
    supplierId: product.supplierId ?? "",
    name: product.name,
    sku: product.sku,
    cost: product.cost,
    quantity: product.quantity,
  })) satisfies VendorAdjustmentProductOption[];
  const adjustmentInvoiceOptions = dataset.vendorInvoices.map((invoice) => ({
    id: invoice.id,
    supplierId: invoice.vendorId,
    invoiceNumber: invoice.invoiceNumber,
    currency: invoice.currency,
    amount: invoice.amount,
    netBalance: invoice.netBalance,
  })) satisfies VendorAdjustmentInvoiceOption[];
  const paymentInvoiceOptions = dataset.vendorInvoices.map((invoice) => ({
    id: invoice.id,
    supplierId: invoice.vendorId,
    invoiceNumber: invoice.invoiceNumber,
    currency: invoice.currency,
    netBalance: invoice.netBalance,
    status: invoice.status,
  })) satisfies VendorPaymentInvoiceOption[];

  const metricInvoices = selectedVendorId
    ? dataset.vendorInvoices.filter(
        (invoice) => invoice.vendorId === selectedVendorId,
      )
    : dataset.vendorInvoices;
  const metricPayments = selectedVendorId
    ? dataset.vendorPayments.filter(
        (payment) => payment.vendorId === selectedVendorId,
      )
    : dataset.vendorPayments;
  const metricAdjustments = selectedVendorId
    ? dataset.vendorAdjustments.filter(
        (adjustment) => adjustment.vendorId === selectedVendorId,
      )
    : dataset.vendorAdjustments;
  const metricSuppliers = selectedVendorId
    ? dataset.suppliers.filter((supplier) => supplier.id === selectedVendorId)
    : dataset.suppliers;

  const totalInvoiced = metricInvoices.reduce(
    (sum, inv) => sum + inv.amount,
    0,
  );
  const totalPaid = metricPayments
    .filter((payment) => isPostedVendorPaymentStatus(payment.status))
    .reduce((sum, payment) => sum + payment.amountPaid, 0);
  const approvedAdjustments = metricAdjustments.filter((adjustment) =>
    isPostedVendorAdjustmentStatus(adjustment.status),
  );
  const draftAdjustmentCount = metricAdjustments.filter(
    (adjustment) => adjustment.status === "draft",
  ).length;
  const totalAdjustments = approvedAdjustments.reduce(
    (sum, adjustment) => sum + adjustment.amount,
    0,
  );
  const totalPending = metricSuppliers.reduce(
    (sum, supplier) => sum + getSupplierOpenBalance(dataset, supplier.id),
    0,
  );
  const availableSupplierCredit = metricSuppliers.reduce(
    (sum, supplier) => sum + getSupplierAvailableCredit(dataset, supplier.id),
    0,
  );

  const metrics = [
    {
      label: "Total invoiced",
      value: formatCurrency(totalInvoiced),
      change: selectedVendorLabel ?? "All time",
      detail: selectedVendorId
        ? `${metricInvoices.length} invoice${
            metricInvoices.length === 1 ? "" : "s"
          } logged`
        : "gross supplier billings",
      tone: "blue" as const,
    },
    {
      label: "Total paid",
      value: formatCurrency(totalPaid),
      change: selectedVendorLabel ?? "Settled",
      detail: selectedVendorId
        ? "posted payments for this vendor"
        : "confirmed disbursements",
      tone: "green" as const,
    },
    {
      label: "Returns / Deductions",
      value: formatCurrency(totalAdjustments),
      change: "Approved",
      detail:
        draftAdjustmentCount > 0
          ? `${draftAdjustmentCount} drafts pending approval`
          : "supplier credits and returns posted",
      tone: "violet" as const,
    },
    {
      label: "Outstanding",
      value: formatCurrency(totalPending),
      change: selectedVendorLabel ?? "Open",
      detail:
        availableSupplierCredit > 0
          ? `${formatCurrency(availableSupplierCredit)} supplier credit available`
          : selectedVendorId
            ? "current vendor A/P balance"
            : "current net A/P balance",
      tone: "amber" as const,
    },
  ];

  const invoiceUploadDisabledReason =
    dataset.source !== "database"
      ? "Supabase must be configured to log invoices."
      : dataset.suppliers.length === 0
        ? "Add a vendor before logging invoices."
        : undefined;

  return (
    <>
      <Breadcrumb pageName="Vendor Invoices" />

      <OperationsCompatibilityNotice
        warnings={dataset.compatibilityWarnings}
        className="mb-6"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mt-6">
        <SectionCard
          title="Invoice repository"
          description="Comprehensive list of all logged supplier invoices"
          action={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end [&>a]:px-3 [&>a]:py-1.5 [&>a]:text-xs [&>a_svg]:h-3.5 [&>a_svg]:w-3.5 [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-xs [&>button_svg]:h-3.5 [&>button_svg]:w-3.5">
              <AddVendorPaymentButton
                suppliers={supplierOptions}
                invoices={paymentInvoiceOptions}
                defaultPaymentDate={todayDateKey}
                disabled={Boolean(invoiceUploadDisabledReason)}
                disabledReason={invoiceUploadDisabledReason}
              />
              <AddVendorAdjustmentButton
                suppliers={supplierOptions}
                invoices={adjustmentInvoiceOptions}
                products={adjustmentProductOptions}
                defaultAdjustmentDate={todayDateKey}
                disabled={Boolean(invoiceUploadDisabledReason)}
                disabledReason={invoiceUploadDisabledReason}
              />
              <UploadInvoiceButton
                suppliers={supplierOptions}
                products={productOptions}
                disabled={Boolean(invoiceUploadDisabledReason)}
                disabledReason={invoiceUploadDisabledReason}
              />
              <ReportDownloadButton
                report="vendor-ledger"
                label={
                  selectedVendorName
                    ? `Download ${selectedVendorName} ledger`
                    : "Download vendor ledger"
                }
                params={{
                  supplierId: selectedVendorId ?? undefined,
                }}
              />
            </div>
          }
        >
          <InvoiceFilters
            initialQ={q}
            initialStatus={status}
            initialVendorId={vendorId}
            suppliers={supplierOptions}
          />

          {filteredInvoices.length > 0 ? (
            <Table totalRows={filteredInvoices.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Issue Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Adjustments</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => {
                  const actionInvoice: VendorInvoiceActionRecord = {
                    id: invoice.id,
                    vendorName: invoice.vendorName,
                    supplierId: invoice.vendorId,
                    invoiceNumber: invoice.invoiceNumber,
                    issueDate: invoice.issueDate.toISOString().slice(0, 10),
                    dueDate: invoice.dueDate.toISOString().slice(0, 10),
                    total: invoice.amount,
                    currency: invoice.currency,
                    description: invoice.description ?? "",
                    status: invoice.status,
                    paidAmount: invoice.paidAmount,
                    adjustmentAmount: invoice.adjustmentAmount,
                    notes: invoice.notes ?? "",
                    pdfFileName: invoice.pdfFileName,
                    pdfMimeType: invoice.pdfMimeType,
                    pdfUrl: invoice.pdfUrl,
                  };

                  const editableInvoice: EditableVendorInvoiceRecord = {
                    ...actionInvoice,
                    adjustmentAmount: invoice.adjustmentAmount,
                    netBalance: invoice.netBalance,
                  };

                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-semibold text-dark dark:text-white">
                        {invoice.vendorName}
                      </TableCell>
                      <TableCell>{invoice.invoiceNumber}</TableCell>
                      <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                      <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(invoice.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(invoice.adjustmentAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            invoice.netBalance < 0
                              ? "font-semibold text-green"
                              : "font-semibold text-dark dark:text-white"
                          }
                        >
                          {formatInvoiceBalance(invoice.netBalance)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={invoiceStatusTone(invoice.status)}>
                          {invoice.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <AddVendorPaymentButton
                            suppliers={supplierOptions}
                            invoices={paymentInvoiceOptions}
                            defaultSupplierId={invoice.vendorId}
                            defaultInvoiceId={invoice.id}
                            defaultAmount={Math.max(invoice.netBalance, 0)}
                            defaultPaymentDate={todayDateKey}
                            iconOnly
                            disabled={!canManageInvoices}
                          />
                          <ViewVendorInvoiceButton invoice={actionInvoice} />
                          <EditVendorInvoiceButton
                            invoice={editableInvoice}
                            suppliers={supplierOptions}
                            disabled={!canManageInvoices}
                            iconOnly
                          />
                          <DeleteVendorInvoiceButton
                            invoiceId={invoice.id}
                            invoiceNumber={invoice.invoiceNumber}
                            disabled={!canManageInvoices}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-[20px] border border-dashed border-stroke px-5 py-10 text-center text-dark-5 dark:border-dark-3 dark:text-dark-6">
              {q || status || selectedVendorId
                ? "No invoices match your search criteria."
                : "No vendor invoices have been processed yet."}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          title="Returns & Deductions"
          description="Draft, approved, and void supplier returns or deductions tracked separately from invoices."
          action={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <AddVendorPaymentButton
                suppliers={supplierOptions}
                invoices={paymentInvoiceOptions}
                defaultPaymentDate={todayDateKey}
                disabled={Boolean(invoiceUploadDisabledReason)}
                disabledReason={invoiceUploadDisabledReason}
              />
              <AddVendorAdjustmentButton
                suppliers={supplierOptions}
                invoices={adjustmentInvoiceOptions}
                products={adjustmentProductOptions}
                defaultAdjustmentDate={todayDateKey}
                disabled={Boolean(invoiceUploadDisabledReason)}
                disabledReason={invoiceUploadDisabledReason}
              />
            </div>
          }
        >
          {filteredAdjustments.length > 0 ? (
            <Table totalRows={filteredAdjustments.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Adjustment #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Inventory</TableHead>
                  <TableHead>Attachment</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAdjustments.map((adjustment) => (
                  <TableRow key={adjustment.id}>
                    <TableCell className="font-semibold text-dark dark:text-white">
                      {adjustment.vendorName}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-dark dark:text-white">
                        {adjustment.adjustmentNumber}
                      </div>
                      {adjustment.reason ? (
                        <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                          {adjustment.reason}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={adjustmentTypeTone(adjustment.adjustmentType)}
                      >
                        {adjustment.adjustmentType.replace(/_/g, " ")}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={adjustmentStatusTone(adjustment.status)}
                      >
                        {VENDOR_ADJUSTMENT_STATUS_LABELS[adjustment.status]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      {adjustment.invoiceNumber ?? "Supplier-level"}
                    </TableCell>
                    <TableCell>
                      {formatDate(adjustment.adjustmentDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(adjustment.amount)}
                    </TableCell>
                    <TableCell>
                      {adjustment.inventoryImpact
                        ? `${adjustment.items.reduce(
                            (sum, item) => sum + item.quantity,
                            0,
                          )} units ${
                            adjustment.status === "approved"
                              ? "posted"
                              : adjustment.status === "void"
                                ? "reversed"
                                : "pending"
                          }`
                        : "No stock change"}
                    </TableCell>
                    <TableCell>
                      {adjustment.attachmentUrl ? (
                        <VendorAttachmentActions
                          href={adjustment.attachmentUrl}
                          downloadHref={`${adjustment.attachmentUrl}&download=1`}
                          label={
                            adjustment.attachmentName ?? "Supporting document"
                          }
                          kindHint={
                            adjustment.attachmentMimeType ??
                            adjustment.attachmentName
                          }
                        />
                      ) : (
                        "No file"
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {adjustment.status === "draft" ? (
                          <>
                            <VendorAdjustmentStatusButton
                              adjustmentId={adjustment.id}
                              adjustmentNumber={adjustment.adjustmentNumber}
                              action="approved"
                              inventoryImpact={adjustment.inventoryImpact}
                              disabled={!canManageInvoices}
                            />
                            <DeleteVendorAdjustmentButton
                              adjustmentId={adjustment.id}
                              adjustmentNumber={adjustment.adjustmentNumber}
                              inventoryImpact={adjustment.inventoryImpact}
                              disabled={!canManageInvoices}
                            />
                          </>
                        ) : adjustment.status === "approved" ? (
                          <VendorAdjustmentStatusButton
                            adjustmentId={adjustment.id}
                            adjustmentNumber={adjustment.adjustmentNumber}
                            action="void"
                            inventoryImpact={adjustment.inventoryImpact}
                            disabled={!canManageInvoices}
                          />
                        ) : (
                          <span className="text-xs text-dark-5 dark:text-dark-6">
                            Locked
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-[20px] border border-dashed border-stroke px-5 py-10 text-center text-dark-5 dark:border-dark-3 dark:text-dark-6">
              {q || vendorId
                ? "No supplier returns or deductions match your filters."
                : "No supplier returns or deductions have been recorded yet."}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          title="Payment History"
          description="Logged vendor payments, references, and linked invoice settlements."
          action={
            <AddVendorPaymentButton
              suppliers={supplierOptions}
              invoices={paymentInvoiceOptions}
              defaultPaymentDate={todayDateKey}
              disabled={Boolean(invoiceUploadDisabledReason)}
              disabledReason={invoiceUploadDisabledReason}
            />
          }
        >
          {filteredPayments.length > 0 ? (
            <Table totalRows={filteredPayments.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-semibold text-dark dark:text-white">
                      {payment.vendorName}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-dark dark:text-white">
                        {payment.referenceNumber}
                      </div>
                      {payment.notes ? (
                        <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                          {payment.notes}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {payment.invoiceNumber ?? "Supplier-level"}
                    </TableCell>
                    <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                    <TableCell>
                      {formatVendorPaymentMethod(payment.paymentMethod)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={paymentStatusTone(payment.status)}>
                        {VENDOR_PAYMENT_STATUS_LABELS[payment.status]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(payment.amountPaid)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {payment.status === "posted" ? (
                          <>
                            <EditVendorPaymentButton
                              paymentId={payment.id}
                              paymentMethod={payment.paymentMethod}
                              referenceNumber={payment.referenceNumber}
                              disabled={!canManageInvoices}
                            />
                            <VendorPaymentStatusButton
                              paymentId={payment.id}
                              referenceNumber={payment.referenceNumber}
                              disabled={!canManageInvoices}
                            />
                          </>
                        ) : (
                          <span className="text-xs text-dark-5 dark:text-dark-6">
                            Locked
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-[20px] border border-dashed border-stroke px-5 py-10 text-center text-dark-5 dark:border-dark-3 dark:text-dark-6">
              {q || vendorId
                ? "No vendor payments match your filters."
                : "No vendor payments have been recorded yet."}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
