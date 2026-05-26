"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { StatusBadge } from "@/components/erp/status-badge";
import { inventoryStatusTone } from "@/components/erp/tone-maps";
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
  supplierName: string;
  status: InventoryStatus;
};

type InventoryStockLedgerTableProps = {
  products: InventoryLedgerRow[];
  quantityAdjustmentsAvailable: boolean;
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
          product.category.toLowerCase().includes(deferredSearch) ||
          product.supplierName.toLowerCase().includes(deferredSearch) ||
          product.location.toLowerCase().includes(deferredSearch);

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
            placeholder="Search SKU, product, supplier, or location"
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
            <TableHead>SKU</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Stock</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Sell price</TableHead>
            {showInventoryActions ? (
              <TableHead className="text-right">Edit</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredProducts.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={showInventoryActions ? 8 : 7}
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
                <TableCell className="font-semibold text-dark dark:text-white">
                  {product.sku}
                </TableCell>
                <TableCell>
                  <div className="font-medium text-dark dark:text-white">
                    {product.name}
                  </div>
                  <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                    {product.location || "Floor not assigned"}
                  </div>
                </TableCell>
                <TableCell>{product.category}</TableCell>
                <TableCell>{product.supplierName}</TableCell>
                <TableCell>
                  <div className="font-medium text-dark dark:text-white">
                    {product.quantity} units
                  </div>
                  <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                    {product.itemsPerPack} / pack • Reorder at{" "}
                    {product.reorderLevel} • {product.dailyVelocity.toFixed(1)}
                    /day
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge
                    tone={inventoryStatusTone[product.status] ?? "slate"}
                  >
                    {product.status}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-right font-semibold text-dark dark:text-white">
                  {formatCurrency(product.price)}
                </TableCell>
                {showInventoryActions ? (
                  <TableCell className="text-right">
                    <EditInventoryItemButton
                      product={product}
                      quantityAdjustmentsAvailable={
                        quantityAdjustmentsAvailable
                      }
                      suppliers={suppliers}
                    />
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
