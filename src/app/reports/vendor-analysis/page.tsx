import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { ReportDownloadButton } from "@/components/reports/report-download-button";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, getOperationsDataset } from "@/lib/erp/operations";
import { buildVendorAnalysisRows } from "@/lib/erp/reporting";

export default async function VendorAnalysisPage() {
  const dataset = await getOperationsDataset();
  const vendors = buildVendorAnalysisRows(dataset);
  const totalVendorSpend = vendors.reduce(
    (sum, vendor) => sum + vendor.spent,
    0,
  );
  const totalAdjustments = vendors.reduce(
    (sum, vendor) => sum + vendor.adjustments,
    0,
  );
  const averageOnTime =
    vendors.length === 0
      ? 0
      : vendors.reduce((sum, vendor) => sum + vendor.onTime, 0) /
        vendors.length;
  const topVendor = vendors[0];
  const totalOpenBalance = vendors.reduce(
    (sum, vendor) => sum + vendor.openBalance,
    0,
  );
  const totalAvailableCredit = vendors.reduce(
    (sum, vendor) => sum + vendor.availableCredit,
    0,
  );
  const metrics = [
    {
      label: "Total Vendor Spend",
      value: formatCurrency(totalVendorSpend),
      change: "Recorded",
      detail: "posted supplier activity",
      tone: "blue" as const,
    },
    {
      label: "Credits & Returns",
      value: formatCurrency(totalAdjustments),
      change: "Approved",
      detail: "supplier deductions and credits",
      tone: "violet" as const,
    },
    {
      label: "Top Vendor",
      value: topVendor?.name ?? "No data",
      change: topVendor ? formatCurrency(topVendor.spent) : "No spend",
      detail: "largest supplier by spend",
      tone: "green" as const,
    },
    {
      label: "Average Reliability",
      value: `${averageOnTime.toFixed(1)}%`,
      change: "On-time",
      detail: "average supplier consistency",
      tone: "amber" as const,
    },
    {
      label: "Available Credit",
      value: formatCurrency(totalAvailableCredit),
      change: "Usable",
      detail: "supplier credit currently open",
      tone: "green" as const,
    },
    {
      label: "Outstanding A/P",
      value: formatCurrency(totalOpenBalance),
      change: "Open balance",
      detail: "unpaid vendor exposure",
      tone: "amber" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Vendor Spending Analysis" />

      <div className="mb-6 flex justify-end">
        <div className="flex flex-wrap gap-2">
          <ReportDownloadButton report="vendor-analysis" />
          <ReportDownloadButton
            report="vendor-ledger"
            label="Download vendor ledger"
          />
        </div>
      </div>

      <div className="space-y-6">
        {dataset.source !== "database" && (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Supabase vendor records are not available. This page is showing an
            empty live state.
          </div>
        )}

        <OperationsCompatibilityNotice
          warnings={dataset.compatibilityWarnings}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <SectionCard
          title="Vendor Performance"
          description="Spend, invoice volume, reliability, and current exposure by supplier."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Spent</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Avg Invoice</TableHead>
                <TableHead className="text-right">Reliability</TableHead>
                <TableHead className="text-right">Available Credit</TableHead>
                <TableHead className="text-right">Open Balance</TableHead>
                <TableHead className="text-right">Open POs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map((vendor) => (
                <TableRow key={vendor.id}>
                  <TableCell className="font-medium text-dark dark:text-white">
                      {vendor.name}
                  </TableCell>
                  <TableCell className="text-right">
                      {formatCurrency(vendor.spent)}
                  </TableCell>
                  <TableCell className="text-right">
                      {formatCurrency(vendor.adjustments)}
                  </TableCell>
                  <TableCell className="text-right">{vendor.invoices}</TableCell>
                  <TableCell className="text-right">
                      {formatCurrency(vendor.avgInvoice)}
                  </TableCell>
                  <TableCell className="text-right">
                      {vendor.onTime.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right">
                      {formatCurrency(vendor.availableCredit)}
                  </TableCell>
                  <TableCell className="text-right">
                      {formatCurrency(vendor.openBalance)}
                  </TableCell>
                  <TableCell className="text-right">
                      {vendor.activePurchaseOrders}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
    </>
  );
}
