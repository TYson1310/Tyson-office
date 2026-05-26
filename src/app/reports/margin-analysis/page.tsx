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
import {
  calculateProductMarginPercent,
  formatCurrency,
  getOperationsDataset,
} from "@/lib/erp/operations";
import {
  buildMarginCategoryRows,
  buildMarginProductRows,
} from "@/lib/erp/reporting";

export default async function MarginAnalysisPage() {
  const dataset = await getOperationsDataset();
  const categories = buildMarginCategoryRows(dataset);
  const products = buildMarginProductRows(dataset);
  const topMargins = [...products]
    .sort((left, right) => right.margin - left.margin)
    .slice(0, 5);
  const lowMargins = [...products]
    .filter((product) => product.margin < product.targetMargin)
    .sort((left, right) => left.margin - right.margin)
    .slice(0, 5);
  const averageMargin =
    products.length === 0
      ? 0
      : products.reduce(
          (sum, product) => sum + calculateProductMarginPercent(product),
          0,
        ) / products.length;
  const belowTargetCount = products.filter(
    (product) => product.margin < product.targetMargin,
  ).length;
  const lowMarginCount = products.filter(
    (product) => product.margin < 20,
  ).length;
  const metrics = [
    {
      label: "Average Margin",
      value: `${averageMargin.toFixed(1)}%`,
      change: `${products.length} products`,
      detail: "tracked product portfolio",
      tone: "blue" as const,
    },
    {
      label: "Products Below Target",
      value: belowTargetCount,
      change: "Need action",
      detail: "below configured target margin",
      tone: "amber" as const,
    },
    {
      label: "Low Margin Products",
      value: lowMarginCount,
      change: "<20% margin",
      detail: "highest risk to profitability",
      tone: "red" as const,
    },
    {
      label: "Products Tracked",
      value: products.length,
      change: "Active",
      detail: "included in margin analysis",
      tone: "green" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Margin Analysis" />

      <div className="mb-6 flex justify-end">
        <ReportDownloadButton report="margin-analysis" />
      </div>

      <div className="space-y-6">
        {dataset.source !== "database" && (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Supabase product data is not available. This page is showing an
            empty live state.
          </div>
        )}

        <OperationsCompatibilityNotice
          warnings={dataset.compatibilityWarnings}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
          <SectionCard
            title="Category Margins"
            description="Current margin health grouped by product category."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Avg Margin</TableHead>
                  <TableHead className="text-right">Products</TableHead>
                  <TableHead className="text-right">Below Target</TableHead>
                  <TableHead className="text-right">Low Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => (
                  <TableRow key={category.category}>
                    <TableCell className="font-medium text-dark dark:text-white">
                        {category.category}
                    </TableCell>
                    <TableCell className="text-right">
                        {category.averageMargin.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                        {category.productCount}
                    </TableCell>
                    <TableCell className="text-right">
                        {category.belowTargetCount}
                    </TableCell>
                    <TableCell className="text-right">
                        {category.lowMarginCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard
            title="At-Risk Products"
            description="Products currently below their target margin."
          >
            <div className="space-y-3">
              {lowMargins.length === 0 ? (
                <p className="text-sm text-dark-5 dark:text-dark-6">
                  No products are currently below their target margin.
                </p>
              ) : (
                lowMargins.map((product) => (
                  <div
                    key={product.id}
                    className="rounded-lg border border-stroke p-4 dark:border-dark-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-dark dark:text-white">
                          {product.name}
                        </p>
                        <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                          {product.sku} · {product.category}
                        </p>
                        <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                          Cost {formatCurrency(product.cost)} · Price{" "}
                          {formatCurrency(product.price)}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-red">
                          {product.margin.toFixed(1)}%
                        </div>
                        <div className="text-xs text-dark-5 dark:text-dark-6">
                          Target {product.targetMargin.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Top Margin Products"
          description="Best current gross margin performers in the catalog."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {topMargins.map((product) => (
              <div
                key={product.id}
                className="rounded-lg border border-stroke p-4 dark:border-dark-3"
              >
                <div className="text-sm text-dark-5 dark:text-dark-6">
                  {product.sku}
                </div>
                <div className="mt-2 font-medium text-dark dark:text-white">
                  {product.name}
                </div>
                <div className="mt-4 text-2xl font-bold text-green">
                  {product.margin.toFixed(1)}%
                </div>
                <div className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                  {formatCurrency(product.cost)} cost ·{" "}
                  {formatCurrency(product.price)} price
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
