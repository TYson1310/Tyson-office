"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { StatusBadge } from "@/components/erp/status-badge";
import { inventoryStatusTone } from "@/components/erp/tone-maps";
import { DeleteInventoryItemButton } from "@/components/inventory/delete-inventory-item-button";
import {
  EditInventoryItemButton,
  type EditableInventoryRecord,
} from "@/components/inventory/edit-inventory-item-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type InventoryStatus = "Healthy" | "Reorder" | "Critical" | "Backorder";

type InventorySupplierOption = {
  id: string;
  name: string;
};

type InventoryLedgerRow = EditableInventoryRecord & {
  latestInvoiceHref?: string;
  latestInvoiceNumber?: string;
  latestInvoiceReceiptDateLabel?: string;
  supplierName: string;
  status: InventoryStatus;
};

type InventoryStockLedgerTableProps = {
  products: InventoryLedgerRow[];
  quantityAdjustmentsAvailable: boolean;
  showDeleteActions: boolean;
  suppliers: InventorySupplierOption[];
  showInventoryActions: boolean;
};

const INPUT_CLASSNAME = "app-input";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function InventoryStockLedgerTable({
  products,
  quantityAdjustmentsAvailable,
  showDeleteActions,
  suppliers,
  showInventoryActions,
}: InventoryStockLedgerTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<InventoryStatus | "all">(
    "all",
  );
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());
  const categories = useMemo(
    () =>
      Array.from(new Set(products.map((product) => product.category))).sort(
        (left, right) => left.localeCompare(right),
      ),
    [products],
  );

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const matchesCategory =
          categoryFilter === "all" || product.category === categoryFilter;
        const matchesStatus =
          statusFilter === "all" || product.status === statusFilter;
        const matchesSearch =
          deferredSearch.length === 0 ||
          product.name.toLowerCase().includes(deferredSearch) ||
          product.sku.toLowerCase().includes(deferredSearch) ||
          product.barcode.toLowerCase().includes(deferredSearch) ||
          product.category.toLowerCase().includes(deferredSearch) ||
          product.supplierName.toLowerCase().includes(deferredSearch) ||
          product.location.toLowerCase().includes(deferredSearch) ||
          (product.latestInvoiceNumber ?? "")
            .toLowerCase()
            .includes(deferredSearch);

        return matchesCategory && matchesStatus && matchesSearch;
      }),
    [categoryFilter, deferredSearch, products, statusFilter],
  );

  return (
    <>
      <div className="mb-4 grid gap-3 lg:grid-cols-[1.2fr_220px_220px_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-dark-5 dark:text-dark-6" />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className={`${INPUT_CLASSNAME} pl-10`}
            placeholder="Search UPC, product, supplier, invoice, or SKU"
          />
        </label>

        {/* <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className={INPUT_CLASSNAME}
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as InventoryStatus | "all")
          }
          className={INPUT_CLASSNAME}
        >
          <option value="all">All statuses</option>
          <option value="Healthy">Healthy</option>
          <option value="Reorder">Reorder</option>
          <option value="Critical">Critical</option>
          <option value="Backorder">Backorder</option>
        </select>*/}

        <div className="flex items-center text-sm text-dark-5 dark:text-dark-6">
          Showing {filteredProducts.length} of {products.length} products
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>UPC</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Sell Price</TableHead>
            <TableHead>Status</TableHead>
            {showInventoryActions ? (
              <TableHead className="text-right">Action</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredProducts.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={showInventoryActions ? 7 : 6}
                className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
              >
                {products.length === 0
                  ? "No inventory items are available for this store yet."
                  : "No products match the current search or filters."}
              </TableCell>
            </TableRow>
          ) : (
            filteredProducts.map((product) => (
              <TableRow key={product.id}>
                <TableCell>
                  {product.barcode ? (
                    <span className="font-mono text-sm text-dark dark:text-white">
                      {product.barcode}
                    </span>
                  ) : (
                    <span className="text-xs text-dark-5 dark:text-dark-6">
                      No UPC
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-medium text-dark dark:text-white">
                    {product.name}
                  </div>
                  <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                    {product.location || "Floor not assigned"}
                  </div>
                  {product.latestInvoiceHref && product.latestInvoiceNumber ? (
                    <Link
                      href={product.latestInvoiceHref}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition hover:text-primary/80"
                      title={`Open invoice ${product.latestInvoiceNumber}`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Invoice {product.latestInvoiceNumber}
                      {product.latestInvoiceReceiptDateLabel
                        ? ` · ${product.latestInvoiceReceiptDateLabel}`
                        : ""}
                    </Link>
                  ) : null}
                </TableCell>
                <TableCell>{product.supplierName}</TableCell>
                <TableCell className="text-right">
                  <div className="font-semibold text-dark dark:text-white">
                    {formatCurrency(product.cost)} / item
                  </div>
                  <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                    {product.quantity} qty ·{" "}
                    {formatCurrency(product.cost * product.quantity)} total
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold text-dark dark:text-white">
                  {formatCurrency(product.price)}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    tone={inventoryStatusTone[product.status] ?? "slate"}
                  >
                    {product.status}
                  </StatusBadge>
                </TableCell>
                {showInventoryActions ? (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <EditInventoryItemButton
                        product={product}
                        quantityAdjustmentsAvailable={
                          quantityAdjustmentsAvailable
                        }
                        suppliers={suppliers}
                      />
                      {showDeleteActions ? (
                        <DeleteInventoryItemButton
                          productId={product.id}
                          productName={product.name}
                          productSku={product.sku}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}
