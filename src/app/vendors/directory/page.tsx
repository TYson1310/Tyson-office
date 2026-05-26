import { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import {
  AddVendorButton,
  type EditableVendorRecord,
} from "@/components/vendors/add-vendor-button";
import { DeleteVendorButton } from "@/components/vendors/delete-vendor-button";
import {
  formatCurrency,
  getOperationsDataset,
  getSupplierOpenBalance,
} from "@/lib/erp/operations";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isPostedVendorPaymentStatus } from "@/lib/vendors/payments";

export const metadata: Metadata = {
  title: "Vendor Directory",
};

function supplierStatusTone(status: string) {
  if (status === "active") {
    return "green";
  }

  if (status === "inactive") {
    return "slate";
  }

  return "red";
}

export default async function VendorDirectoryPage() {
  const dataset = await getOperationsDataset();
  const canManageVendors = dataset.source === "database";
  const vendorActionDisabledMessage =
    dataset.source === "unconfigured"
      ? "Supabase must be configured to manage vendors."
      : "Vendor actions are unavailable until vendor data loads successfully.";
  const totalSpent = dataset.vendorPayments.reduce(
    (sum, payment) =>
      isPostedVendorPaymentStatus(payment.status)
        ? sum + payment.amountPaid
        : sum,
    0,
  );
  const averageRating =
    dataset.suppliers.reduce(
      (sum, supplier) => sum + (supplier.rating ?? 0),
      0,
    ) / Math.max(dataset.suppliers.length, 1);
  const activeVendors = dataset.suppliers.filter(
    (supplier) => supplier.status === "active",
  ).length;
  const overdueVendors = new Set(
    dataset.vendorInvoices
      .filter((invoice) => invoice.status === "overdue")
      .map((invoice) => invoice.vendorId),
  ).size;
  const metrics = [
    {
      label: "Vendors",
      value: `${dataset.suppliers.length}`,
      change: `${activeVendors} active`,
      detail: "supplier records in directory",
      tone: "blue" as const,
    },
    {
      label: "Average rating",
      value: averageRating.toFixed(1),
      change: "Service",
      detail: "current supplier score",
      tone: "green" as const,
    },
    {
      label: "Total paid",
      value: formatCurrency(totalSpent),
      change: "Recorded",
      detail: "vendor payments logged",
      tone: "violet" as const,
    },
    {
      label: "Overdue vendors",
      value: `${overdueVendors}`,
      change: "Review",
      detail: "vendors with past-due invoices",
      tone: "amber" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Vendor Directory" />

      {dataset.source === "unconfigured" ? (
        <div className="mb-6 rounded-[24px] border border-dashed border-primary/30 bg-primary/5 px-5 py-4 text-sm text-dark-5 dark:text-dark-6">
          Supabase supplier records are not available yet. Configure the
          database connection to load the vendor directory here.
        </div>
      ) : dataset.source === "error" ? (
        <div className="mb-6 rounded-[24px] border border-red/20 bg-red/5 px-5 py-4 text-sm text-red">
          Vendor records could not be loaded for the active store. Check the
          current store selection and Supabase data access.
        </div>
      ) : null}

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
          title="Vendor management"
          description="Supplier contacts, payment terms, and current status"
          action={
            <AddVendorButton
              disabled={!canManageVendors}
              disabledMessage={vendorActionDisabledMessage}
            />
          }
        >
          <Table totalRows={dataset.suppliers.length}>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Email & Phone</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead className="text-right">Total dues</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataset.suppliers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                  >
                    {dataset.source === "database"
                      ? "No vendors are available yet. Add a vendor to populate this table."
                      : dataset.source === "unconfigured"
                        ? "Vendor data is unavailable until the database connection is configured."
                        : "Vendor data could not be loaded for the active store."}
                  </TableCell>
                </TableRow>
              ) : (
                dataset.suppliers.map((supplier) => {
                  const totalDues = getSupplierOpenBalance(dataset, supplier.id);
                  const editableSupplier: EditableVendorRecord = {
                    id: supplier.id,
                    name: supplier.name,
                    contactName: supplier.contact,
                    email: supplier.email,
                    phone: supplier.phone,
                    category: supplier.category ?? "",
                    city: supplier.city,
                    paymentTerms:
                      (supplier.paymentTerms ??
                        "net30") as EditableVendorRecord["paymentTerms"],
                    status: supplier.status,
                  };

                  return (
                    <TableRow key={supplier.id}>
                      <TableCell className="font-semibold text-dark dark:text-white">
                        {supplier.name}
                      </TableCell>
                      <TableCell>{supplier.contact || "-"}</TableCell>
                      <TableCell>
                        <div className="text-dark dark:text-white">
                          {supplier.email || "-"}
                        </div>
                        <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                          {supplier.phone || "-"}
                        </div>
                      </TableCell>
                      <TableCell>
                        {supplier.paymentTerms?.toUpperCase() ?? "-"}
                      </TableCell>
                      <TableCell className="text-right font-medium text-dark dark:text-white">
                        {formatCurrency(totalDues)}
                      </TableCell>
                      <TableCell>{supplier.rating?.toFixed(1) ?? "0.0"}</TableCell>
                      <TableCell>
                        <StatusBadge tone={supplierStatusTone(supplier.status)}>
                          {supplier.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <AddVendorButton
                            vendor={editableSupplier}
                            iconOnly
                            disabled={!canManageVendors}
                            disabledMessage={vendorActionDisabledMessage}
                          />
                          <DeleteVendorButton
                            vendorId={supplier.id}
                            vendorName={supplier.name}
                            disabled={!canManageVendors}
                            disabledMessage={vendorActionDisabledMessage}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
    </>
  );
}
