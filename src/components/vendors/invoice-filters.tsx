"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { VendorInvoiceSupplierOption } from "@/lib/vendors/invoice-processing";

export function InvoiceFilters({
  initialQ,
  initialStatus,
  initialVendorId,
  suppliers,
}: {
  initialQ?: string;
  initialStatus?: string;
  initialVendorId?: string;
  suppliers: VendorInvoiceSupplierOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilters = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    
    Object.entries(updates).forEach(([key, value]) => {
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });

    router.push(`/vendors/invoices?${params.toString()}`);
  };

  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center">
      <form
        className="flex w-full flex-1 flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          updateFilters({ q: formData.get("q") as string });
        }}
      >
        <input
          name="q"
          defaultValue={initialQ}
          placeholder="Search by vendor, number, or description..."
          className="w-full min-w-0 rounded-lg border border-stroke bg-transparent px-4 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 sm:max-w-sm"
        />
        <button
          type="submit"
          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90 sm:w-auto"
        >
          Search
        </button>
      </form>

      <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
        <select
          className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 sm:w-auto"
          onChange={(e) => updateFilters({ status: e.target.value })}
          defaultValue={initialStatus || "all"}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 sm:w-auto"
          onChange={(e) => updateFilters({ vendorId: e.target.value })}
          defaultValue={initialVendorId || "all"}
        >
          <option value="all">All vendors</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
