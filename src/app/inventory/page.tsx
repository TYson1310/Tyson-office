import type { Metadata } from "next";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import {
  InventoryStockLedgerTable,
  type InventoryStatus,
} from "@/components/inventory/stock-ledger-table";
import {
  formatCurrency,
  getInventoryStatus,
  getOperationsDataset,
} from "@/lib/erp/operations";
import { loadFinancialAccountabilityStatus } from "@/lib/accountability/financial-controls";
import { formatDateTime } from "@/lib/date-time";
import { canManageProductRecords } from "@/lib/products/api";
import { requireActiveStoreContext } from "@/lib/stores/server";
import { getUserSafely } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserRole } from "@/types/erp.types";

export const metadata: Metadata = {
  title: "Inventory",
};

function formatMovementType(
  type:
    | "vendor_return"
    | "vendor_return_reversal"
    | "manual_adjustment"
    | "vendor_invoice_receipt",
) {
  if (type === "vendor_return") {
    return "Vendor Return";
  }

  if (type === "vendor_return_reversal") {
    return "Return Reversal";
  }

  if (type === "vendor_invoice_receipt") {
    return "Invoice Receipt";
  }

  return "Manual Adjustment";
}

function formatMovementTimestamp(value: Date, timeZone: string) {
  return formatDateTime(value, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

export default async function InventoryPage() {
  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const dataset = await getOperationsDataset();
  let canEditInventory = false;
  let accountabilityStatus = {
    available: dataset.source === "database",
    warnings: [] as string[],
  };

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await getUserSafely(supabase);

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle<{ role: UserRole | null }>();

      canEditInventory = canManageProductRecords(profile?.role);
    }

    accountabilityStatus = await loadFinancialAccountabilityStatus(
      supabase,
      activeStoreKey,
    );
  }

  const inventoryValue = dataset.products.reduce(
    (sum, product) => sum + product.cost * product.quantity,
    0,
  );
  const lowStockCount = dataset.products.filter((product) => {
    const status = getInventoryStatus(product);
    return (
      status === "Reorder" || status === "Critical" || status === "Backorder"
    );
  }).length;
  const outOfStockCount = dataset.products.filter(
    (product) => product.quantity <= 0,
  ).length;
  const stockMetrics = [
    {
      label: "Tracked SKUs",
      value: `${dataset.products.length}`,
      change: "Active",
      detail: "catalog items in this store",
      tone: "blue" as const,
    },
    {
      label: "Low stock",
      value: `${lowStockCount}`,
      change: "Replenish",
      detail: "items below target coverage",
      tone: "amber" as const,
    },
    {
      label: "Out of stock",
      value: `${outOfStockCount}`,
      change: "Urgent",
      detail: "items affecting demand right now",
      tone: "red" as const,
    },
    {
      label: "Inventory value",
      value: formatCurrency(inventoryValue),
      change: "At cost",
      detail: "current stock valuation",
      tone: "green" as const,
    },
  ];

  const replenishmentQueue = dataset.products
    .map((product) => ({
      ...product,
      status: getInventoryStatus(product),
      needed: Math.max(product.reorderLevel * 2 - product.quantity, 0),
    }))
    .filter((product) => product.status !== "Healthy")
    .sort((left, right) => right.needed - left.needed);

  const coverageCategories = ["Produce", "Bakery", "Dairy", "Beverages"];
  const supplierOptions = [...dataset.suppliers]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
    }));
  const showInventoryActions =
    dataset.source === "database" && canEditInventory;
  const stockLedgerProducts = dataset.products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    supplierId: product.supplierId ?? "",
    supplierName: product.supplierName ?? "Unassigned",
    location: product.location ?? "",
    quantity: product.quantity,
    itemsPerPack: product.itemsPerPack,
    reorderLevel: product.reorderLevel,
    dailyVelocity: product.dailyVelocity,
    cost: product.cost,
    price: product.price,
    targetMarginPercent: product.targetMarginPercent,
    status: getInventoryStatus(product) as InventoryStatus,
  }));

  return (
    <>
      <Breadcrumb pageName="Inventory" />

      {dataset.source !== "database" && (
        <div className="mb-6 rounded-[24px] border border-dashed border-primary/30 bg-primary/5 px-5 py-4 text-sm text-dark-5 dark:text-dark-6">
          Supabase inventory records are not available yet. Configure the
          database connection to load stock positions here.
        </div>
      )}

      <OperationsCompatibilityNotice
        warnings={[
          ...dataset.compatibilityWarnings,
          ...accountabilityStatus.warnings,
        ]}
        className="mb-6"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stockMetrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mt-6">
        <SectionCard
          title="Stock ledger"
          description="Quantity on hand, reorder pressure, margin, and location"
        >
          <InventoryStockLedgerTable
            quantityAdjustmentsAvailable={accountabilityStatus.available}
            products={stockLedgerProducts}
            suppliers={supplierOptions}
            showInventoryActions={showInventoryActions}
          />
        </SectionCard>

        {/* <div className="grid gap-6">
          <SectionCard
            title="Replenishment queue"
            description="Suggested buying priority based on shelf cover"
          >
            <div className="space-y-3">
              {replenishmentQueue.length === 0 ? (
                <div className="rounded-lg border border-dashed border-stroke px-4 py-6 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
                  No replenishment actions are required right now.
                </div>
              ) : (
                replenishmentQueue.map((product) => (
                  <div
                    key={product.id}
                    className="rounded-lg border border-stroke p-4 dark:border-dark-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-dark dark:text-white">
                        {product.name}
                      </div>
                      <StatusBadge tone={inventoryStatusTone[product.status] ?? "slate"}>
                        {product.status}
                      </StatusBadge>
                    </div>
                    <div className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                      {product.supplierName ?? "Unassigned supplier"}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span>Recommended PO</span>
                      <span className="font-semibold text-dark dark:text-white">
                        {product.needed} units
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Coverage snapshot"
            description="Approximate stock cover by category"
          >
            <div className="space-y-4">
              {coverageCategories.map((category) => {
                const items = dataset.products.filter(
                  (product) => product.category === category,
                );
                const cover =
                  items.reduce((total, product) => {
                    return total + product.quantity / Math.max(product.dailyVelocity, 1);
                  }, 0) / Math.max(items.length, 1);
                const width = Math.min(Math.round((cover / 14) * 100), 100);

                return (
                  <div key={category}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-dark dark:text-white">
                        {category}
                      </span>
                      <span className="text-dark-5 dark:text-dark-6">
                        {cover.toFixed(1)} days
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-2 dark:bg-dark-2">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>*/}
      </div>

      <div className="mt-6">
        <SectionCard
          title="Recent Stock Movements"
          description={`Audit trail for invoice receipts, supplier returns, reversals, and manual stock corrections. Recorded times are shown in ${activeStore.timeZone}.`}
        >
          {dataset.inventoryMovements.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Movement</TableHead>
                  <TableHead className="text-right">Qty Delta</TableHead>
                  <TableHead className="text-right">Before</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataset.inventoryMovements.slice(0, 20).map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>
                      {formatMovementTimestamp(
                        movement.createdAt,
                        activeStore.timeZone,
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-dark dark:text-white">
                        {movement.productName}
                      </div>
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        {movement.productSku}
                      </div>
                    </TableCell>
                    <TableCell>
                      {formatMovementType(movement.movementType)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        movement.quantityDelta < 0 ? "text-red" : "text-green"
                      }`}
                    >
                      {movement.quantityDelta > 0 ? "+" : ""}
                      {movement.quantityDelta}
                    </TableCell>
                    <TableCell className="text-right">
                      {movement.quantityBefore}
                    </TableCell>
                    <TableCell className="text-right">
                      {movement.quantityAfter}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-dark dark:text-white">
                        {movement.adjustmentNumber ?? "Adjustment"}
                      </div>
                      {movement.notes ? (
                        <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                          {movement.notes}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-[20px] border border-dashed border-stroke px-5 py-10 text-center text-dark-5 dark:border-dark-3 dark:text-dark-6">
              No inventory movement history has been recorded yet.
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
